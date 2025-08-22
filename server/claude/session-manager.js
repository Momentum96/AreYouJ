import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import EventEmitter from 'events';
import fs from 'fs';
import crypto from 'crypto';
import { ClaudePromptDetector } from '../utils/claude-prompt-detector.js';
import { OutputThrottler } from '../utils/output-throttler.js';
import { ProcessManager } from '../utils/process-manager.js';
import { QueuePersistenceManager } from '../utils/queue-persistence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Queue persistence file paths
const QUEUE_DATA_DIR = path.join(__dirname, '../data');
const QUEUES_DIR = path.join(QUEUE_DATA_DIR, 'queues');
const SETTINGS_FILE_PATH = path.join(QUEUE_DATA_DIR, 'settings.json');

export class ClaudeSessionManager extends EventEmitter {
  constructor() {
    super();
    this.pythonProcess = null;
    this.sessionReady = false;
    this.isStarting = false;
    this.isStopping = false;
    this.messageQueue = []; // Message queue for auto-processing
    this.currentlyProcessing = null;
    this.lastActivity = Date.now();
    this.healthCheckInterval = null;
    this.forceKillTimer = null;
    this.lastStopTime = 0;
    this.currentWorkingDirectory = null; // Current working directory for queue management
    
    // Debug logging
    this.debugLogFile = path.join(__dirname, '../logs/claude-debug.log');
    this.ensureLogDirectory();
    
    // Initialize utility managers
    this.outputThrottler = new OutputThrottler({
      throttleMs: 1000, // 1 second throttle
      autoClearMs: 30000, // 30 seconds auto-clear
      maxBufferSize: 100000 // 100KB max buffer
    });
    
    this.promptDetector = new ClaudePromptDetector({
      debounceThresholdMs: 2000,
      timeoutMs: 3600000
    });
    
    this.processManager = new ProcessManager({
      gracefulTimeoutMs: 2000,
      maxRetries: 3
    });
    
    this.queuePersistence = new QueuePersistenceManager({
      baseDataDir: QUEUE_DATA_DIR
    });
    
    // Setup utility event forwarding
    this.setupUtilityEventForwarding();
    
    // Queue persistence setup
    this.ensureQueueDataDirectory();
    this.loadCurrentWorkingDirectory();
    this.loadQueueFromFile();
    
    // Bind methods for proper 'this' context
    this.handleProcessData = this.handleProcessData.bind(this);
    this.handleProcessError = this.handleProcessError.bind(this);
    this.handleProcessExit = this.handleProcessExit.bind(this);
  }
  
  /**
   * Setup event forwarding from utility managers
   * @private
   */
  setupUtilityEventForwarding() {
    // Forward OutputThrottler events
    this.outputThrottler.on('output', (output) => {
      this.emit('claude-output', output);
    });
    
    this.outputThrottler.on('output-cleared', (data) => {
      this.log(`🧹 Output cleared: ${data.clearedLength} characters`);
    });
    
    // Forward PromptDetector events
    this.promptDetector.on('prompt-detected', (data) => {
      this.log(`🎯 Prompt detected: ${data.type} (confidence: ${data.confidence})`);
    });
    
    this.promptDetector.on('permission-prompt-detected', (data) => {
      this.log(`🔒 Permission prompt detected: ${data.action}`);
    });
    
    // Forward ProcessManager events
    this.processManager.on('process-spawned', (data) => {
      this.log(`🚀 Process spawned: ${data.processId} (PID: ${data.pid})`);
    });
    
    this.processManager.on('process-exited', (data) => {
      this.log(`⚰️ Process exited: ${data.processId} (code: ${data.exitCode})`);
    });
  }

  // Message queue management (Claude-Autopilot style)
  addMessageToQueue(messageItem) {
    this.messageQueue.push(messageItem);
    this.log(`📥 Added message to queue: ${messageItem.id}`);
    
    // Save queue using QueuePersistenceManager
    if (this.currentWorkingDirectory) {
      this.queuePersistence.saveQueue(this.currentWorkingDirectory, this.messageQueue).catch(error => {
        this.log(`⚠️ Failed to save queue after adding message: ${error.message}`);
      });
    }
    
    // Try auto-start processing if session is ready
    if (this.sessionReady && !this.currentlyProcessing) {
      setTimeout(() => {
        this.tryAutoStartProcessing();
      }, 200);
    }
  }

  getMessageQueue() {
    return this.messageQueue;
  }

  // Update specific message in queue (used by API)
  updateMessageInQueue(messageId, newMessage) {
    const messageIndex = this.messageQueue.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return null;
    }
    
    // Only allow updating pending messages
    if (this.messageQueue[messageIndex].status !== 'pending') {
      this.log(`❌ Cannot update message ${messageId} - status is ${this.messageQueue[messageIndex].status}`);
      return null;
    }
    
    const oldMessage = this.messageQueue[messageIndex].message;
    this.messageQueue[messageIndex].message = newMessage;
    this.log(`📝 Updated message in queue: ${messageId} (${oldMessage.substring(0, 50)}... → ${newMessage.substring(0, 50)}...)`);
    
    // Save queue using QueuePersistenceManager
    if (this.currentWorkingDirectory) {
      this.queuePersistence.saveQueue(this.currentWorkingDirectory, this.messageQueue).catch(error => {
        this.log(`⚠️ Failed to save queue after update: ${error.message}`);
      });
    }
    
    return this.messageQueue[messageIndex];
  }

  // Remove specific message from queue (used by API)
  removeMessageFromQueue(messageId) {
    const messageIndex = this.messageQueue.findIndex(m => m.id === messageId);
    if (messageIndex === -1) {
      return null;
    }
    
    const deletedMessage = this.messageQueue.splice(messageIndex, 1)[0];
    this.log(`🗑️ Removed message from queue: ${messageId}`);
    
    // Save queue to file
    this.saveQueueToFile().catch(error => {
      this.log(`⚠️ Failed to save queue after removal: ${error.message}`);
    });
    
    return deletedMessage;
  }

  clearMessageQueue() {
    this.messageQueue = [];
    this.log('🗑️ Message queue cleared');
    
    // Save empty queue to file
    this.saveQueueToFile().catch(error => {
      this.log(`⚠️ Failed to save cleared queue: ${error.message}`);
    });
  }

  ensureLogDirectory() {
    const logDir = path.dirname(this.debugLogFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    // Clear previous log file
    try {
      if (fs.existsSync(this.debugLogFile)) {
        fs.writeFileSync(this.debugLogFile, '');
      }
    } catch (error) {
      console.error('Failed to clear debug log:', error);
    }
  }

  // Queue persistence methods
  ensureQueueDataDirectory() {
    try {
      if (!fs.existsSync(QUEUE_DATA_DIR)) {
        fs.mkdirSync(QUEUE_DATA_DIR, { recursive: true });
        this.log('📁 Created queue data directory');
      }
      if (!fs.existsSync(QUEUES_DIR)) {
        fs.mkdirSync(QUEUES_DIR, { recursive: true });
        this.log('📁 Created queues directory');
      }
    } catch (error) {
      console.error('Failed to create queue data directory:', error);
    }
  }

  // Working directory management
  loadCurrentWorkingDirectory() {
    try {
      if (fs.existsSync(SETTINGS_FILE_PATH)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE_PATH, 'utf8'));
        this.currentWorkingDirectory = settings.projectHomePath || process.cwd();
      } else {
        this.currentWorkingDirectory = process.cwd();
      }
      this.log(`📁 Current working directory: ${this.currentWorkingDirectory}`);
    } catch (error) {
      console.error('Failed to load working directory:', error);
      this.currentWorkingDirectory = process.cwd();
    }
  }

  setWorkingDirectory(workingDir) {
    if (this.currentWorkingDirectory !== workingDir) {
      // Save current queue before switching
      this.saveQueueToFile().catch(error => {
        this.log(`⚠️ Failed to save queue before switching directory: ${error.message}`);
      });
      
      // Update working directory
      const oldDir = this.currentWorkingDirectory;
      this.currentWorkingDirectory = workingDir;
      
      // Load queue for new directory
      this.loadQueueFromFile();
      
      this.log(`📁 Switched working directory: ${oldDir} → ${workingDir}`);
      this.emit('working-directory-changed', { oldDir, newDir: workingDir, messageQueue: this.messageQueue });
    }
  }

  generateDirectoryHash(dirPath) {
    return crypto.createHash('sha256').update(dirPath).digest('hex').substring(0, 16);
  }

  getQueueFilePath() {
    if (!this.currentWorkingDirectory) {
      return path.join(QUEUE_DATA_DIR, 'queue.json'); // fallback to old location
    }
    
    const dirHash = this.generateDirectoryHash(this.currentWorkingDirectory);
    const queueDir = path.join(QUEUES_DIR, dirHash);
    
    // Ensure directory exists
    try {
      if (!fs.existsSync(queueDir)) {
        fs.mkdirSync(queueDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create queue directory:', error);
    }
    
    return path.join(queueDir, 'queue.json');
  }

  // Create local time string (Korean timezone)
  createLocalTimeString() {
    const now = new Date();
    const koreaTime = new Date(now.getTime() + (9 * 60 * 60 * 1000)); // UTC+9
    return koreaTime.toISOString().replace('Z', '+09:00');
  }

  // Migration helper: Move old global queue to current working directory
  migrateOldQueueIfNeeded() {
    const oldQueuePath = path.join(QUEUE_DATA_DIR, 'queue.json');
    const newQueuePath = this.getQueueFilePath();
    
    // If old queue exists but new one doesn't, migrate
    if (fs.existsSync(oldQueuePath) && !fs.existsSync(newQueuePath)) {
      try {
        const oldQueueData = fs.readFileSync(oldQueuePath, 'utf8');
        fs.writeFileSync(newQueuePath, oldQueueData, 'utf8');
        this.log(`📦 Migrated old queue to working directory: ${newQueuePath}`);
        
        // Optionally remove old queue after successful migration
        // fs.unlinkSync(oldQueuePath);
      } catch (error) {
        console.error('Failed to migrate old queue:', error);
      }
    }
  }

  async loadQueueFromFile() {
    if (!this.currentWorkingDirectory) {
      this.log('📁 No working directory set, starting with empty queue');
      this.messageQueue = [];
      return;
    }

    try {
      // Use QueuePersistenceManager to load queue
      const savedQueue = await this.queuePersistence.loadQueue(this.currentWorkingDirectory);
      
      if (Array.isArray(savedQueue)) {
        this.messageQueue = savedQueue;
        this.log(`📁 Loaded ${this.messageQueue.length} messages via QueuePersistenceManager`);
        
        // Log queue contents for debugging
        const pending = this.messageQueue.filter(m => m.status === 'pending').length;
        const completed = this.messageQueue.filter(m => m.status === 'completed').length;
        const processing = this.messageQueue.filter(m => m.status === 'processing').length;
        const error = this.messageQueue.filter(m => m.status === 'error').length;
        
        this.log(`📊 Queue stats - Pending: ${pending}, Completed: ${completed}, Processing: ${processing}, Error: ${error}`);
        
        // Reset any 'processing' messages to 'pending' on startup (they were interrupted)
        let resetCount = 0;
        this.messageQueue.forEach(message => {
          if (message.status === 'processing') {
            message.status = 'pending';
            resetCount++;
            this.log(`🔄 Reset interrupted message ${message.id} from processing to pending`);
          }
        });
        
        if (resetCount > 0) {
          // Save the reset changes using QueuePersistenceManager
          this.queuePersistence.saveQueue(this.currentWorkingDirectory, this.messageQueue).catch(error => {
            this.log(`⚠️ Failed to save queue after reset: ${error.message}`);
          });
        }
      } else {
        this.log('📁 No valid queue found, starting with empty queue');
        this.messageQueue = [];
      }
    } catch (error) {
      console.error('Failed to load queue via QueuePersistenceManager:', error);
      this.log('❌ Failed to load queue, starting with empty queue');
      this.messageQueue = [];
    }
  }

  async saveQueueToFile() {
    if (!this.currentWorkingDirectory) {
      this.log('📁 No working directory set, cannot save queue');
      return;
    }

    try {
      // Use QueuePersistenceManager to save queue
      await this.queuePersistence.saveQueue(this.currentWorkingDirectory, this.messageQueue);
      this.debugLog(`💾 Saved ${this.messageQueue.length} messages via QueuePersistenceManager`);
    } catch (error) {
      console.error('Failed to save queue via QueuePersistenceManager:', error);
      this.log('❌ Failed to save queue');
      throw error;
    }
  }

  debugLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    try {
      fs.appendFileSync(this.debugLogFile, logMessage);
    } catch (error) {
      console.error('Failed to write debug log:', error);
    }
  }

  // Removed cleanAnsiSequences - we now preserve ANSI sequences for terminal rendering

  async ensureCompleteCleanup() {
    if (this.pythonProcess) {
      this.log('⚠️ Found existing process during startup, cleaning up...');
      await this.forceCleanup();
    }
    
    // Clear any pending timers
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
    
    // Reset all state
    this.sessionReady = false;
    this.isStopping = false;
    this.currentlyProcessing = null;
  }

  async forceCleanup() {
    return new Promise((resolve) => {
      if (!this.pythonProcess) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.pythonProcess = null;
        resolve();
      };

      if (this.pythonProcess.killed) {
        cleanup();
        return;
      }

      this.pythonProcess.removeAllListeners();
      this.pythonProcess.on('exit', cleanup);

      try {
        this.pythonProcess.kill('SIGKILL');
        this.log('🔪 Force killed existing process');
      } catch (error) {
        this.log(`Warning: Error force killing process: ${error.message}`);
        cleanup();
      }

      // Fallback timeout
      setTimeout(() => {
        cleanup();
      }, 2000);
    });
  }

  loadSettings() {
    try {
      if (fs.existsSync(SETTINGS_FILE_PATH)) {
        const data = fs.readFileSync(SETTINGS_FILE_PATH, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.log(`Warning: Failed to load settings: ${error.message}`);
    }
    
    // Default settings
    return {
      projectHomePath: process.cwd()
    };
  }

  async startSession(skipPermissions = true) {
    if (this.isStarting) {
      this.log('Session already starting...');
      return false;
    }

    if (this.isStopping) {
      this.log('Session is currently stopping, please wait...');
      return false;
    }

    if (this.pythonProcess && this.sessionReady) {
      this.log('Session already active');
      return true;
    }

    // Prevent rapid restart (wait at least 1 second after stop)
    const timeSinceLastStop = Date.now() - this.lastStopTime;
    if (timeSinceLastStop < 1000) {
      this.log(`⏳ Waiting ${1000 - timeSinceLastStop}ms before restart to prevent conflicts...`);
      await new Promise(resolve => setTimeout(resolve, 1000 - timeSinceLastStop));
    }

    // Ensure complete cleanup before starting
    await this.ensureCompleteCleanup();

    this.isStarting = true;
    this.log('Starting Claude session...');

    try {
      const settings = this.loadSettings();
      const projectHomePath = settings.projectHomePath || process.cwd();
      
      // Use ProcessManager to spawn Claude process
      const processId = await this.processManager.spawnClaudeProcess(projectHomePath, {
        skipPermissions: skipPermissions,
        additionalArgs: []
      });
      
      this.log(`Claude process spawned via ProcessManager: ${processId}`);
      
      // Get process info from ProcessManager
      const processInfo = this.processManager.getProcessStatus(processId);
      this.pythonProcess = this.processManager.processes.get(processId).process;
      this.processId = processId;
      
      this.log(`Python process spawned with PID: ${processInfo.pid}`);
      this.currentScreenBuffer = '';

      // Set up event handlers for legacy compatibility
      this.pythonProcess.stdout.on('data', this.handleProcessData);
      this.pythonProcess.stderr.on('data', this.handleProcessError);
      this.pythonProcess.on('exit', this.handleProcessExit);

      // Wait for Claude to be ready using PromptDetector
      const ready = await this.promptDetector.waitForPrompt({
        timeout: 60000,
        debounceMs: 500,
        source: 'session-startup'
      });
      
      if (ready.success) {
        this.sessionReady = true;
        this.startHealthCheck();
        this.log('✅ Claude session started successfully');
        this.emit('session-started');
        
        // Claude-Autopilot style: Auto-start processing if there are pending messages in queue
        setTimeout(() => {
          this.tryAutoStartProcessing();
        }, 500);
        
        return true;
      } else {
        this.log(`❌ Failed to start Claude session: ${ready.reason}`);
        this.cleanup();
        return false;
      }

    } catch (error) {
      this.log(`❌ Error starting Claude session: ${error.message}`);
      this.cleanup();
      return false;
    } finally {
      this.isStarting = false;
    }
  }


  // Removed waitForSessionReady - replaced with Claude-Autopilot style waitForClaudeReady

  handleProcessData(data) {
    const rawText = data.toString();
    this.lastActivity = Date.now();
    
    // Use OutputThrottler for sophisticated output handling
    this.outputThrottler.processOutput(rawText);
    
    // Update current screen buffer for legacy compatibility
    this.currentScreenBuffer = this.outputThrottler.getCurrentBuffer();
  }


  // Claude-Autopilot style: we handle raw terminal output directly, no JSON message parsing needed

  // Removed handleMessageResult - Claude-Autopilot style completion detection in waitForPrompt

  handleProcessError(data) {
    const rawText = data.toString();
    this.debugLog(`Raw stderr data: ${JSON.stringify(rawText)}`);
    
    // Log debug output from Python PTY wrapper (Claude-Autopilot style)
    if (rawText.includes('[PTY]')) {
      this.debugLog(`PTY Debug: ${rawText.trim()}`);
    } else {
      this.log(`Claude stderr: ${rawText.slice(0, 200)}${rawText.length > 200 ? '...' : ''}`);
      this.emit('process-error', rawText);
    }
  }

  validateMessageQueueIntegrity() {
    let hasIssues = false;
    
    // Ensure only one message is in 'processing' state
    const processingMessages = this.messageQueue.filter(m => m.status === 'processing');
    
    if (processingMessages.length > 1) {
      this.log(`⚠️ Queue integrity issue: ${processingMessages.length} messages in processing state`);
      hasIssues = true;
      
      // Keep the most recently started message, reset others to pending
      const sortedByStartTime = processingMessages.sort((a, b) => 
        new Date(b.processingStartedAt || 0) - new Date(a.processingStartedAt || 0)
      );
      
      // Reset all but the most recent processing message
      sortedByStartTime.slice(1).forEach(msg => {
        msg.status = 'pending';
        delete msg.processingStartedAt;
        this.log(`🔄 Reset message ${msg.id} from processing to pending (integrity check)`);
      });
      
      // Update currentlyProcessing to match the kept message
      if (sortedByStartTime.length > 0) {
        this.currentlyProcessing = sortedByStartTime[0];
      }
    }
    
    // Verify currentlyProcessing matches queue state
    if (this.currentlyProcessing) {
      const queueMessage = this.messageQueue.find(m => m.id === this.currentlyProcessing.id);
      if (!queueMessage) {
        this.log(`⚠️ currentlyProcessing references non-existent message: ${this.currentlyProcessing.id}`);
        this.currentlyProcessing = null;
        hasIssues = true;
      } else if (queueMessage.status !== 'processing') {
        this.log(`⚠️ currentlyProcessing message has status ${queueMessage.status}, expected 'processing'`);
        this.currentlyProcessing = null;
        hasIssues = true;
      }
    }
    
    // Check for orphaned processing messages
    const orphanedProcessing = this.messageQueue.filter(m => 
      m.status === 'processing' && (!this.currentlyProcessing || m.id !== this.currentlyProcessing.id)
    );
    
    if (orphanedProcessing.length > 0) {
      this.log(`⚠️ Found ${orphanedProcessing.length} orphaned processing messages`);
      orphanedProcessing.forEach(msg => {
        msg.status = 'pending';
        delete msg.processingStartedAt;
        this.log(`🔄 Reset orphaned processing message ${msg.id} to pending`);
      });
      hasIssues = true;
    }
    
    if (hasIssues) {
      this.saveQueueToFile().catch(error => {
        this.log(`⚠️ Failed to save queue after integrity check: ${error.message}`);
      });
      this.emit('queue-integrity-restored', { 
        processingCount: processingMessages.length,
        orphanedCount: orphanedProcessing.length,
        timestamp: this.createLocalTimeString()
      });
    }
    
    return !hasIssues;
  }

  handleProcessExit(code, signal) {
    this.log(`Claude process exited with code ${code}, signal ${signal}`);
    
    // Clear force kill timer since process has exited
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
    
    // Log additional debug information
    if (code !== 0) {
      this.log(`❌ Process exited with non-zero code: ${code}`);
      if (signal) {
        this.log(`❌ Process killed by signal: ${signal}`);
      }
    }
    
    if (this.messageQueue.length > 0) {
      this.log(`⚠️ Process exited with ${this.messageQueue.length} messages still in queue`);
    }
    
    // Handle interrupted processing message
    let interruptedMessage = null;
    if (this.currentlyProcessing) {
      this.log(`⚠️ Process exited while processing message: ${this.currentlyProcessing.id}`);
      interruptedMessage = this.currentlyProcessing;
      
      // Reset interrupted message back to pending status
      const messageInQueue = this.messageQueue.find(m => m.id === this.currentlyProcessing.id);
      if (messageInQueue && messageInQueue.status === 'processing') {
        messageInQueue.status = 'pending';
        messageInQueue.error = null; // Clear any previous error
        this.log(`🔄 Reset interrupted message ${messageInQueue.id} from processing to pending`);
      }
    }
    
    // Reset all processing messages to pending (safety measure)
    let resetCount = 0;
    this.messageQueue.forEach(message => {
      if (message.status === 'processing') {
        message.status = 'pending';
        message.error = null;
        resetCount++;
        this.log(`🔄 Reset processing message ${message.id} to pending status`);
      }
    });
    
    if (resetCount > 0) {
      this.log(`🔄 Reset ${resetCount} processing messages to pending status`);
      // Save queue with updated message statuses
      this.saveQueueToFile().catch(error => {
        this.log(`⚠️ Failed to save queue after session end: ${error.message}`);
      });
    }
    
    // Clean up state
    this.sessionReady = false;
    this.currentlyProcessing = null;
    this.pythonProcess = null;
    this.isStarting = false;
    this.isStopping = false;
    
    this.stopHealthCheck();
    
    // Emit session-ended event with additional context
    this.emit('session-ended', { 
      code, 
      signal, 
      interruptedMessage,
      resetMessagesCount: resetCount,
      remainingQueueLength: this.messageQueue.length
    });
  }


  async sendMessageToClaudeProcess(messageItem, retryCount = 0) {
    const maxRetries = 3;
    
    if (!this.pythonProcess || !this.pythonProcess.stdin) {
      if (retryCount < maxRetries) {
        this.log(`❌ Claude process not available, attempting restart (retry ${retryCount + 1}/${maxRetries})`);
        
        // Apply progressive delay for retries
        const retryDelay = 2000 * Math.pow(2, retryCount); // 2s, 4s, 8s
        this.log(`⏳ Waiting ${retryDelay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        
        const restarted = await this.startSession();
        if (!restarted) {
          throw new Error('Failed to restart Claude session');
        }
        
        return this.sendMessageToClaudeProcess(messageItem, retryCount + 1);
      } else {
        throw new Error(`Claude process not available after ${maxRetries} retries`);
      }
    }

    try {
      // Log message details for debugging (Claude-Autopilot style)
      const messagePreview = messageItem.message.length > 100 
        ? messageItem.message.substring(0, 100) + '...' 
        : messageItem.message;
      const hasNewlines = messageItem.message.includes('\n');
      const lineCount = messageItem.message.split('\n').length;
      
      this.log(`📝 Sending message to Claude process:`);
      this.log(`   Preview: "${messagePreview}"`);
      this.log(`   Length: ${messageItem.message.length} chars`);
      this.log(`   Has newlines: ${hasNewlines} (${lineCount} lines)`);
      
      if (this.pythonProcess.stdin.destroyed || !this.pythonProcess.stdin.writable) {
        throw new Error('Claude process stdin is not writable');
      }
      
      // Calculate message size and chunks (Claude-Autopilot style)
      const messageBytes = Buffer.byteLength(messageItem.message, 'utf8');
      const chunks = Math.ceil(messageBytes / 1024);
      this.log(`📝 Message size: ${messageBytes} bytes (${chunks} chunks)`);
      
      // Optimized message chunking - adaptive chunk size and delays
      const messageBuffer = Buffer.from(messageItem.message, 'utf8');
      const totalSize = messageBuffer.length;
      
      // Adaptive chunk size: larger chunks for bigger messages
      let CHUNK_SIZE = totalSize < 10000 ? 2048 : 4096; // 2KB or 4KB chunks
      let chunkDelay = totalSize < 10000 ? 100 : 150; // Shorter delays for small messages
      
      this.log(`📝 Optimized chunking: ${Math.ceil(totalSize / CHUNK_SIZE)} chunks of ${CHUNK_SIZE} bytes with ${chunkDelay}ms delays`);
      
      for (let i = 0; i < messageBuffer.length; i += CHUNK_SIZE) {
        const chunk = messageBuffer.subarray(i, Math.min(i + CHUNK_SIZE, messageBuffer.length));
        
        await new Promise((resolve, reject) => {
          if (!this.pythonProcess || !this.pythonProcess.stdin) {
            reject(new Error('Claude process not available'));
            return;
          }
          this.pythonProcess.stdin.write(chunk, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        
        // Adaptive delay - shorter for smaller chunks, longer for last chunk
        const isLastChunk = (i + CHUNK_SIZE >= messageBuffer.length);
        const delay = isLastChunk ? chunkDelay + 100 : chunkDelay;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      this.log(`📝 Message sent in ${chunks} chunks`);
      
      // Extra wait to ensure last chunk is fully processed
      await new Promise(resolve => setTimeout(resolve, 300));
      
      this.log(`📝 Sending carriage return to submit message...`);
      
      if (!this.pythonProcess || !this.pythonProcess.stdin) {
        throw new Error('Claude process stdin became unavailable');
      }
      
      if (this.pythonProcess.stdin.destroyed || !this.pythonProcess.stdin.writable) {
        throw new Error('Claude process stdin is not writable');
      }
      
      // Send carriage return as a completely separate operation
      await new Promise((resolve, reject) => {
        if (!this.pythonProcess || !this.pythonProcess.stdin) {
          reject(new Error('Claude process not available'));
          return;
        }
        this.pythonProcess.stdin.write('\r', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      this.log(`✅ Message sent to Claude process successfully`);
      
    } catch (error) {
      this.log(`❌ Error sending message to Claude: ${error.message}`);
      
      if (retryCount < maxRetries) {
        this.log(`🔄 Retrying message send (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return this.sendMessageToClaudeProcess(messageItem, retryCount + 1);
      } else {
        throw new Error(`Failed to send message after ${maxRetries} retries: ${error.message}`);
      }
    }
  }

  waitForPrompt() {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess || !this.pythonProcess.stdout) {
        this.log('❌ Claude process not available for prompt waiting');
        reject(new Error('Claude process not available'));
        return;
      }

    const DEBOUNCE_THRESHOLD_MS = 2000;
    const TIMEOUT_MS = 3600000; // 1 hour timeout as safety net (Claude-Autopilot style)
    let waitingForPermission = false;
    let screenAnalysisTimer = null;
    let timeoutTimer = null;
    let lastOutputTime = Date.now();

    const readyPatterns = [
      // Primary indicators (most reliable - Claude-Autopilot style)
      /\? for shortcuts/i,
      /\\u001b\[2m\\u001b\[38;5;244m│\\u001b\[39m\\u001b\[22m\s>/,
      
      // Secondary indicators (common prompt patterns)
      />\s*$/,
      /\$\s*$/,
      
      // Claude-specific indicators
      /Bypassing Permissions/i,
      /Welcome to Claude Code/i,
      
      // Terminal prompt indicators
      /\u276F/,  // Unicode prompt character
      /❯/,      // Alternative prompt character
      
      // Enhanced context indicators
      /pwd:/i,
      /cwd:/i,
      /claude.*ready/i,
      /claude.*>.*$/im,
      
      // ANSI escape sequence patterns for prompts
      /\u001b\[.*?m\s*>\s*\u001b\[.*?m/,
      /\u001b\[\d+;\d+m.*>\s*$/,
      
      // Multi-line prompt detection
      /^.*\n.*>\s*$/m,
      /^.*│.*>\s*$/m,
      
      // Fallback patterns for edge cases
      /Ready for input/i,
      /Press.*key/i,
      /Continue.*press/i
    ];

    // Enhanced permission prompt detection (Claude-Autopilot style)
    const permissionPrompts = [
      // Direct permission requests
      'Do you want to make this edit to',
      'Do you want to create', 
      'Do you want to delete',
      'Do you want to read',
      'Would you like to',
      'Proceed with',
      'Continue?',
      
      // Additional permission patterns from Claude-Autopilot
      'Press Enter to continue',
      'Press any key to continue',
      'Confirm this action',
      'Are you sure',
      'Type y to confirm',
      'Type yes to proceed',
      
      // Claude Code specific patterns
      'Allow Claude Code to',
      'Grant permission to',
      'Approve this',
      'Review and confirm'
    ];

    const cleanup = () => {
      if (screenAnalysisTimer) {
        clearTimeout(screenAnalysisTimer);
        screenAnalysisTimer = null;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const analyzeCurrentScreen = () => {
      const timeSinceLastOutput = Date.now() - lastOutputTime;
      const screenBuffer = this.currentScreenBuffer || '';
      
      this.debugLog(`🔍 Analyzing screen (${screenBuffer.length} chars, ${timeSinceLastOutput}ms since last output)`);
      
      // Enhanced permission prompt detection with context analysis (moved up for scope)
      const detectedPrompts = permissionPrompts.filter(prompt => 
        screenBuffer.toLowerCase().includes(prompt.toLowerCase())
      );
      
      const hasPermissionPrompt = detectedPrompts.length > 0;
      const hasMultiplePrompts = detectedPrompts.length > 1;
      
      // Additional context clues for permission prompts
      const hasPermissionContext = screenBuffer.includes('[Y/n]') || 
                                  screenBuffer.includes('[y/N]') ||
                                  screenBuffer.includes('(y/n)') ||
                                  screenBuffer.includes('Enter/Space/Escape') ||
                                  /\[(yes|no|y|n|enter|space|esc)\]/i.test(screenBuffer);
      
      if (waitingForPermission) {
        // Enhanced permission resolution detection
        const permissionResolved = screenBuffer.includes('? for shortcuts') ||
                                  /operation.*complete/i.test(screenBuffer) ||
                                  /task.*finished/i.test(screenBuffer) ||
                                  /changes.*applied/i.test(screenBuffer) ||
                                  /successfully/i.test(screenBuffer) ||
                                  // Check if we're back to a normal prompt state
                                  readyPatterns.some(pattern => pattern.test(screenBuffer));
        
        if (permissionResolved) {
          this.log(`✅ Permission resolved - back to normal processing (detected completion indicators)`);
          waitingForPermission = false;
        } else {
          // Check if permission prompt is still active
          const stillWaitingForInput = detectedPrompts.length > 0 || hasPermissionContext ||
                                     screenBuffer.includes('waiting') ||
                                     screenBuffer.includes('pending');
          
          this.debugLog(`🔐 Still waiting for permission response (active prompts: ${stillWaitingForInput})`);
          screenAnalysisTimer = setTimeout(analyzeCurrentScreen, 500);
          return;
        }
      }
      
      if ((hasPermissionPrompt || hasPermissionContext) && !waitingForPermission) {
        const promptDetails = detectedPrompts.length > 0 ? detectedPrompts.join(', ') : 'context indicators';
        this.log(`🔐 Permission prompt detected: ${promptDetails} (multiple: ${hasMultiplePrompts}, context: ${hasPermissionContext})`);
        waitingForPermission = true;
        screenAnalysisTimer = setTimeout(analyzeCurrentScreen, 500);
        return;
      }
      
      // Enhanced pattern matching with priority system (Claude-Autopilot style)
      let matchedPattern = null;
      let matchPriority = 0;
      
      for (let i = 0; i < readyPatterns.length; i++) {
        const pattern = readyPatterns[i];
        const jsonScreen = JSON.stringify(screenBuffer);
        const directMatch = pattern.test(screenBuffer);
        const jsonMatch = pattern.test(jsonScreen);
        
        if (directMatch || jsonMatch) {
          // Primary patterns (index 0-1) have highest priority
          const priority = i < 2 ? 3 : (i < 4 ? 2 : 1);
          
          if (priority > matchPriority) {
            matchedPattern = pattern;
            matchPriority = priority;
          }
          
          this.debugLog(`🎯 Pattern matched: ${pattern.source} (direct: ${directMatch}, json: ${jsonMatch}, priority: ${priority})`);
        }
      }
      
      const isReady = matchedPattern !== null;
      
      if (isReady && timeSinceLastOutput >= DEBOUNCE_THRESHOLD_MS) {
        this.log(`✅ Claude is ready! Pattern: ${matchedPattern.source} (priority: ${matchPriority}, stable for: ${timeSinceLastOutput}ms)`);
        safeResolve();
      } else if (isReady) {
        this.debugLog(`⏳ Ready pattern detected but waiting for stability (${timeSinceLastOutput}ms < ${DEBOUNCE_THRESHOLD_MS}ms, pattern: ${matchedPattern.source})`);
        screenAnalysisTimer = setTimeout(analyzeCurrentScreen, 500);
      } else {
        // Enhanced alternative detection with multiple criteria (Claude-Autopilot style)
        const hasSubstantialContent = screenBuffer.length > 100;
        const hasStabilized = timeSinceLastOutput >= 4000;
        const looksLikePrompt = screenBuffer.trim().endsWith('>') || screenBuffer.trim().endsWith('$');
        
        if (hasSubstantialContent && hasStabilized && looksLikePrompt) {
          this.log(`✅ Claude is ready (detected by output stabilization + prompt indicators)`);
          safeResolve();
          return;
        } else if (hasSubstantialContent && timeSinceLastOutput >= 8000) {
          // Extra long stabilization as fallback
          this.log(`✅ Claude is ready (detected by long stabilization period)`);
          safeResolve();
          return;
        }
        
        this.debugLog(`⏱️ No ready pattern detected, continuing analysis (content: ${hasSubstantialContent}, stable: ${hasStabilized}, prompt-like: ${looksLikePrompt})`);
        screenAnalysisTimer = setTimeout(analyzeCurrentScreen, 500);
      }
    };

    // Track output updates for timing
    const outputTracker = (data) => {
      lastOutputTime = Date.now();
    };
    
    // Add temporary listener for output timing
    this.on('claude-output', outputTracker);
    
    // Safe cleanup function to prevent memory leaks
    const safeCleanup = () => {
      cleanup();
      if (this.listenerCount('claude-output') > 0) {
        this.off('claude-output', outputTracker);
      }
    };
    
    // Safe resolve/reject functions
    const safeResolve = () => {
      safeCleanup();
      resolve();
    };
    
    const safeReject = (error) => {
      safeCleanup();
      reject(error);
    };

    // Set up timeout with session health check
    let extendedTimeoutUsed = false;
    
    timeoutTimer = setTimeout(() => {
      this.log(`⏱️ Safety timeout check after ${TIMEOUT_MS / 60000} minutes - checking session health`);
      
      // Check if Claude session is still alive
      if (!this.pythonProcess || this.pythonProcess.killed || this.pythonProcess.exitCode !== null) {
        this.log(`❌ Claude process died during long operation`);
        safeReject(new Error('Claude process died during operation'));
        return;
      }
      
      // Check if we're still receiving output (task might still be running)
      const timeSinceLastOutput = Date.now() - lastOutputTime;
      if (timeSinceLastOutput < 300000) { // If output within last 5 minutes (more generous)
        this.log(`⏳ Still receiving output (${Math.round(timeSinceLastOutput/1000)}s ago), extending timeout (Claude-Autopilot style)`);
        
        // Clear current timer and set new one to prevent race condition
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        timeoutTimer = setTimeout(() => {
          this.log(`❌ Safety timeout after extended period (1 hour total)`);
          safeReject(new Error('Safety timeout - Claude may be stuck or task is extremely long-running'));
        }, 1800000); // Additional 30 minutes (total becomes 1.5 hours)
      } else {
        this.log(`❌ No recent output for ${Math.round(timeSinceLastOutput/1000)}s, timing out`);
        safeReject(new Error('Timeout - no output from Claude for extended period'));
      }
    }, TIMEOUT_MS);

    // Start screen analysis
    screenAnalysisTimer = setTimeout(analyzeCurrentScreen, 500);
    }); // Close Promise
  }

  // Removed addToQueue - Claude-Autopilot style sends messages directly

  // Removed processNextMessage - Claude-Autopilot style processes messages immediately when sendMessage is called

  startHealthCheck() {
    this.stopHealthCheck(); // Clear any existing interval
    
    this.healthCheckInterval = setInterval(() => {
      if (this.pythonProcess && this.sessionReady) {
        // Just check if process is alive, don't send ping to Claude CLI
        try {
          if (this.pythonProcess.killed || this.pythonProcess.exitCode !== null) {
            this.log(`❌ Claude process died, attempting restart...`);
            this.handleUnhealthySession();
          }
        } catch (error) {
          this.log(`❌ Health check failed: ${error.message}`);
          this.handleUnhealthySession();
        }
      }
    }, 30000); // Check every 30 seconds
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  handleUnhealthySession() {
    this.log('🏥 Session appears unhealthy, attempting restart...');
    this.emit('session-unhealthy');
    
    // Cleanup and restart
    this.cleanup();
    setTimeout(() => {
      this.startSession();
    }, 5000);
  }

  getStatus() {
    return {
      sessionReady: this.sessionReady,
      isStarting: this.isStarting,
      currentlyProcessing: this.currentlyProcessing ? this.currentlyProcessing.id : null,
      lastActivity: this.lastActivity,
      processAlive: this.pythonProcess && !this.pythonProcess.killed,
      screenBufferSize: this.currentScreenBuffer ? this.currentScreenBuffer.length : 0
    };
  }

  async stop() {
    if (this.isStopping) {
      this.log('Already stopping session...');
      return;
    }

    this.isStopping = true;
    this.log('🛑 Stopping Claude session...');
    
    // Handle interrupted processing message before stopping
    let interruptedMessage = null;
    let resetCount = 0;
    
    if (this.currentlyProcessing) {
      this.log(`⚠️ Stopping session while processing message: ${this.currentlyProcessing.id}`);
      interruptedMessage = this.currentlyProcessing;
      
      // Reset interrupted message back to pending status
      const messageInQueue = this.messageQueue.find(m => m.id === this.currentlyProcessing.id);
      if (messageInQueue && messageInQueue.status === 'processing') {
        messageInQueue.status = 'pending';
        messageInQueue.error = null; // Clear any previous error
        resetCount++;
        this.log(`🔄 Reset interrupted message ${messageInQueue.id} from processing to pending`);
      }
    }
    
    // Reset any other processing messages to pending (safety measure)
    this.messageQueue.forEach(message => {
      if (message.status === 'processing' && message.id !== (interruptedMessage?.id)) {
        message.status = 'pending';
        message.error = null;
        resetCount++;
        this.log(`🔄 Reset processing message ${message.id} to pending status`);
      }
    });
    
    if (resetCount > 0) {
      this.log(`🔄 Reset ${resetCount} processing messages to pending status`);
      // Save queue with updated message statuses using QueuePersistenceManager
      if (this.currentWorkingDirectory) {
        this.queuePersistence.saveQueue(this.currentWorkingDirectory, this.messageQueue).catch(error => {
          this.log(`⚠️ Failed to save queue after manual stop: ${error.message}`);
        });
      }
    }
    
    // Use ProcessManager for graceful process termination
    if (this.processId) {
      try {
        const success = await this.processManager.terminateProcess(this.processId);
        if (success) {
          this.log('✅ Process terminated gracefully via ProcessManager');
        } else {
          this.log('⚠️ Process termination via ProcessManager failed');
        }
      } catch (error) {
        this.log(`⚠️ Error during ProcessManager termination: ${error.message}`);
      }
    } else if (this.pythonProcess && !this.pythonProcess.killed) {
      // Fallback to legacy termination for compatibility
      try {
        this.pythonProcess.kill('SIGTERM');
      } catch (error) {
        this.log(`⚠️ Error during fallback termination: ${error.message}`);
      }
    }

    this.cleanup();
    this.lastStopTime = Date.now();
    this.isStopping = false;
    
    // Emit manual stop event with additional context
    this.emit('session-manually-stopped', { 
      interruptedMessage,
      resetMessagesCount: resetCount,
      remainingQueueLength: this.messageQueue.length
    });
    
    this.log('✅ Claude session stopped');
  }

  tryAutoStartProcessing() {
    this.log('🔍 Auto-start check triggered');
    
    // Validate queue integrity first
    this.validateMessageQueueIntegrity();
    
    if (!this.sessionReady) {
      this.log('❌ Auto-start conditions not met - session not ready');
      return;
    }
    
    if (this.currentlyProcessing) {
      this.log('❌ Auto-start conditions not met - already processing message');
      return;
    }
    
    if (this.messageQueue.length === 0) {
      this.log('❌ Auto-start conditions not met - no pending messages');
      return;
    }
    
    const hasPendingMessages = this.messageQueue.some(msg => msg.status === 'pending');
    if (!hasPendingMessages) {
      this.log('❌ Auto-start conditions not met - no pending messages');
      return;
    }
    
    this.log('✅ Auto-start conditions met - starting message processing');
    this.emit('auto-start-processing');
    
    // Trigger message processing after short delay
    setTimeout(() => {
      this.processNextMessage();
    }, 200);
  }

  async processNextMessage() {
    this.log('--- PROCESSING NEXT MESSAGE ---');
    
    if (this.messageQueue.length === 0) {
      this.log('Queue empty - waiting for new messages');
      return;
    }

    const message = this.messageQueue.find(m => m.status === 'pending');
    if (!message) {
      this.log('No pending messages found');
      return;
    }

    if (!this.pythonProcess || !this.sessionReady) {
      this.log('❌ Claude process not available or session not ready');
      return;
    }

    this.log(`📋 Processing message: ${message.id}`);
    this.log(`📋 Message preview: "${message.message.substring(0, 100)}${message.message.length > 100 ? '...' : ''}"`);
    message.status = 'processing';
    message.processingStartedAt = this.createLocalTimeString();
    this.currentlyProcessing = message;
    this.emit('message-started', message);

    try {
      // Claude-Autopilot style: Send message and wait for completion
      this.log('⏰ Sending message and waiting for Claude response...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay like Claude-Autopilot
      
      await this.sendMessageToClaudeProcess(message);
      
      this.log('⏰ Waiting for Claude to process message and show prompt...');
      await this.waitForPrompt();
      
      const processingTime = Date.now() - new Date(message.processingStartedAt).getTime();
      this.log(`✅ Message ${message.id} completed in ${(processingTime / 1000).toFixed(1)}s`);
      message.status = 'completed';
      message.completedAt = this.createLocalTimeString();
      message.processingTimeMs = processingTime;
      this.currentlyProcessing = null;
      this.emit('message-completed', message);
      
      // Save queue with updated message status
      this.saveQueueToFile().catch(error => {
        this.log(`⚠️ Failed to save queue after completion: ${error.message}`);
      });
      
      // Continue processing next message after a delay (Claude-Autopilot style)
      setTimeout(async () => {
        this.log('Processing next message after delay...');
        try {
          await this.processNextMessage();
        } catch (error) {
          this.log(`❌ Error in delayed message processing: ${error.message}`);
          this.emit('processing-error', { error: error.message, messageId: 'delayed-processing' });
        }
      }, 2000);
      
    } catch (error) {
      this.log(`❌ Error processing message ${message.id}: ${error.message}`);
      
      // Enhanced error handling with context
      const processingTime = message.processingStartedAt ? 
        Date.now() - new Date(message.processingStartedAt).getTime() : 0;
      
      const errorContext = {
        messageId: message.id,
        errorType: error.name || 'UnknownError',
        errorMessage: error.message,
        timestamp: this.createLocalTimeString(),
        sessionStatus: this.getStatus(),
        processingTimeMs: processingTime,
        isTimeout: error.message.includes('Timeout') || error.message.includes('timeout')
      };
      
      message.status = 'error';
      message.error = `Processing failed: ${error.message}`;
      message.errorContext = errorContext;
      this.currentlyProcessing = null;
      
      // Log detailed error information
      this.log(`❌ Error context: ${JSON.stringify(errorContext, null, 2)}`);
      
      this.emit('message-completed', message);
      
      // Save queue with updated message status
      this.saveQueueToFile().catch(error => {
        this.log(`⚠️ Failed to save queue after error: ${error.message}`);
      });
      
      // If this is a session-related error, don't continue processing
      if (error.message.includes('Claude process not available') || 
          error.message.includes('session not ready') ||
          error.message.includes('stdin is not writable')) {
        this.log(`❌ Session-related error detected, stopping auto-processing`);
        this.emit('processing-stopped-due-to-error', { error: errorContext });
        return;
      }
      
      // Check if timeout error and session is still healthy
      if (error.message.includes('Timeout') || error.message.includes('timeout')) {
        this.log(`⏱️ Timeout error detected - checking if Claude is still processing`);
        
        // Wait for potential completion before continuing
        setTimeout(async () => {
          try {
            // Check if Claude returned to ready state
            const readyPatterns = [/\? for shortcuts/i, /❯/, />\s*$/, /\$\s*$/];
            const screenBuffer = this.currentScreenBuffer || '';
            const isReady = readyPatterns.some(pattern => pattern.test(screenBuffer));
            
            if (isReady) {
              this.log(`✅ Claude returned to ready state after timeout - continuing`);
              await this.processNextMessage();
            } else {
              this.log(`❌ Claude still not ready after timeout - stopping processing`);
              this.emit('processing-stopped-due-to-error', { error: errorContext });
            }
          } catch (error) {
            this.log(`❌ Error in timeout recovery: ${error.message}`);
            this.emit('processing-error', { error: error.message, messageId: message.id });
          }
        }, 5000);
      } else {
        // Continue processing next message after other types of errors
        setTimeout(async () => {
          try {
            await this.processNextMessage();
          } catch (error) {
            this.log(`❌ Error in error recovery processing: ${error.message}`);
            this.emit('processing-error', { error: error.message, messageId: message.id });
          }
        }, 2000);
      }
    }
  }

  // Claude-Autopilot 스타일: 키 전송 기능 (ESC, Enter 등)
  sendKeyToClaudeProcess(key) {
    if (!this.pythonProcess || !this.pythonProcess.stdin) {
      this.log(`❌ Cannot send keypress: Claude process not available`);
      throw new Error('Claude process not available for keypress input');
    }

    this.log(`⌨️ Sending keypress: ${key}`);
    
    try {
      switch (key) {
        case 'up':
          this.pythonProcess.stdin.write('\x1b[A');
          break;
        case 'down':
          this.pythonProcess.stdin.write('\x1b[B');
          break;
        case 'left':
          this.pythonProcess.stdin.write('\x1b[D');
          break;
        case 'right':
          this.pythonProcess.stdin.write('\x1b[C');
          break;
        case 'enter':
          this.pythonProcess.stdin.write('\r');
          break;
        case 'escape':
          this.pythonProcess.stdin.write('\x1b');
          break;
        case 'space':
          this.pythonProcess.stdin.write(' ');
          break;
        case 'tab':
          this.pythonProcess.stdin.write('\t');
          break;
        default:
          this.log(`❌ Unknown key: ${key}`);
          throw new Error(`Unknown key command: ${key}`);
      }
      this.log(`✅ Keypress '${key}' sent successfully`);
    } catch (error) {
      this.log(`❌ Failed to send keypress '${key}': ${error.message}`);
      throw new Error(`Failed to send keypress '${key}': ${error.message}`);
    }
  }

  cleanup() {
    this.sessionReady = false;
    this.isStarting = false;
    this.currentlyProcessing = null;
    
    this.stopHealthCheck();

    // Clear any existing force kill timer
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
    
    // Clear output timers (Claude-Autopilot style)
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
    if (this.autoClearTimer) {
      clearTimeout(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    
    // Clear output buffers
    this.outputBuffer = '';
    this.currentScreenBuffer = '';

    if (this.pythonProcess) {
      try {
        if (!this.pythonProcess.killed) {
          this.pythonProcess.kill('SIGTERM');
          
          // Store timer reference for cleanup
          this.forceKillTimer = setTimeout(() => {
            if (this.pythonProcess && !this.pythonProcess.killed) {
              this.log('🔪 Force killing Claude process...');
              try {
                this.pythonProcess.kill('SIGKILL');
              } catch (error) {
                this.log(`Warning: Error force killing process: ${error.message}`);
              }
            }
            this.forceKillTimer = null;
          }, 3000);
        }
      } catch (error) {
        this.log(`Warning: Error during cleanup: ${error.message}`);
      } finally {
        // Don't set pythonProcess to null immediately, let exit handler do it
        // This prevents race conditions with the force kill timer
      }
    }
  }


  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [ClaudeSession] ${message}`);
  }
}

// Singleton instance
let claudeSessionManager = null;

export function getClaudeSession() {
  if (!claudeSessionManager) {
    claudeSessionManager = new ClaudeSessionManager();
  }
  return claudeSessionManager;
}