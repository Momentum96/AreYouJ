import { spawn } from 'child_process';
import path from 'path';
import EventEmitter from 'events';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import crypto from 'crypto';
import { ClaudePromptDetector } from '../utils/claude-prompt-detector.js';
import { OutputThrottler } from '../utils/output-throttler.js';
import { ProcessManager } from '../utils/process-manager.js';
import { QueuePersistenceManager } from '../utils/queue-persistence.js';

/**
 * SessionInstance - Individual session representation with independent resources
 * 
 * Represents a single Claude session with:
 * - UUID-based identification
 * - Independent message queue management
 * - Dedicated PTY process isolation
 * - Real-time status tracking (running/idle/busy/error)
 * - Activity monitoring and metrics
 */
export class SessionInstance extends EventEmitter {
  constructor(workingDirectory, userConfig = {}) {
    super();
    
    // Input validation
    if (!workingDirectory || typeof workingDirectory !== 'string') {
      throw new Error('Working directory is required and must be a string');
    }
    if (typeof userConfig !== 'object' || userConfig === null) {
      throw new Error('User config must be an object');
    }
    
    // Core session properties
    this.id = uuidv4();
    this.workingDirectory = path.resolve(workingDirectory);
    this.startTime = new Date();
    this.lastActivity = new Date();
    this.status = 'initializing'; // initializing -> running -> idle/busy/error
    this.currentTask = null;
    
    // Process management
    this.claudeProcess = null;
    this.processReady = false;
    this.isStarting = false;
    this.isStopping = false;
    
    // Independent message queue for this session
    this.messageQueue = [];
    this.currentlyProcessing = null;
    this.queueSequence = 0; // For message ordering
    
    // Configuration
    this.userConfig = { ...userConfig };
    this.maxRetries = userConfig.maxRetries || 3;
    
    // Race condition prevention
    this._processingScheduled = false;
    this._forceKillTimer = null;
    
    // Initialize utility managers
    this.outputThrottler = new OutputThrottler({
      throttleMs: userConfig.outputThrottleMs || 1000,
      autoClearMs: userConfig.outputAutoClearMs || 30000,
      maxBufferSize: userConfig.maxBufferSize || 100000
    });
    
    this.promptDetector = new ClaudePromptDetector({
      debounceThresholdMs: userConfig.debounceThresholdMs || 2000,
      timeoutMs: userConfig.timeoutMs || 3600000
    });
    
    this.processManager = new ProcessManager({
      gracefulTimeoutMs: userConfig.gracefulTimeoutMs || 2000,
      maxRetries: this.maxRetries
    });
    
    this.queuePersistence = new QueuePersistenceManager({
      baseDataDir: userConfig.baseDataDir,
      autoSaveInterval: userConfig.autoSaveInterval || 30000
    });
    
    // Setup utility event forwarding
    this.setupUtilityEventForwarding();
    
    // Activity tracking
    this.metrics = {
      messagesProcessed: 0,
      totalProcessingTime: 0,
      errorsCount: 0,
      averageResponseTime: 0,
      lastProcessingTime: 0
    };
    
    // Health monitoring
    this.healthCheckInterval = null;
    this.sessionTimeout = null;
    
    this.log(`SessionInstance created for directory: ${this.workingDirectory}`);
    
    // Load existing queue
    this.loadQueueFromPersistence();
  }

  /**
   * Setup event forwarding from utility managers
   * @private
   */
  setupUtilityEventForwarding() {
    // Output throttler events
    this.outputThrottler.on('output', (output) => {
      this.emit('session-output', { sessionId: this.id, output, timestamp: new Date().toISOString() });
    });
    
    this.outputThrottler.on('buffer-trimmed', (data) => {
      this.emit('buffer-trimmed', { sessionId: this.id, ...data });
    });
    
    // Process manager events
    this.processManager.on('process-spawned', (data) => {
      this.emit('process-spawned', { sessionId: this.id, ...data });
    });
    
    this.processManager.on('process-exited', (data) => {
      this.emit('process-exited', { sessionId: this.id, ...data });
    });
    
    this.processManager.on('process-error', (data) => {
      this.emit('process-error', { sessionId: this.id, ...data });
    });
    
    // Prompt detector events
    this.promptDetector.on('ready-detected', (data) => {
      this.emit('prompt-ready', { sessionId: this.id, ...data });
    });
    
    this.promptDetector.on('permission-detected', (data) => {
      this.emit('permission-prompt', { sessionId: this.id, ...data });
    });
    
    // Queue persistence events
    this.queuePersistence.on('queue-saved', (data) => {
      this.emit('queue-saved', { sessionId: this.id, ...data });
    });
    
    this.queuePersistence.on('queue-loaded', (data) => {
      this.emit('queue-loaded', { sessionId: this.id, ...data });
    });
  }

  /**
   * Load queue from persistence
   * @private
   */
  async loadQueueFromPersistence() {
    try {
      this.messageQueue = await this.queuePersistence.loadQueue(this.workingDirectory);
      this.log('info', `Loaded ${this.messageQueue.length} messages from persistence`);
      
      // Enable auto-save
      this.queuePersistence.enableAutoSave(this.workingDirectory, () => this.messageQueue);
      
    } catch (error) {
      this.log('warn', `Failed to load queue from persistence: ${error.message}`);
      this.messageQueue = [];
    }
  }

  /**
   * Initialize and start the Claude session
   * @returns {Promise<boolean>} Success status
   */
  async initialize() {
    if (this.isStarting) {
      this.log('Session already initializing...');
      return false;
    }

    if (this.processReady) {
      this.log('Session already initialized');
      return true;
    }

    this.isStarting = true;
    this.status = 'initializing';
    
    try {
      this.log('info', 'Starting Claude process...');
      
      // Use ProcessManager to spawn Claude process
      this.processId = await this.processManager.spawnClaudeProcess(this.workingDirectory, {
        skipPermissions: this.userConfig.skipPermissions
      });
      
      const processStatus = this.processManager.getProcessStatus(this.processId);
      if (!processStatus) {
        throw new Error('Failed to get process status after spawning');
      }
      
      // Get the actual process object for stdio access
      const processInfo = this.processManager.processes.get(this.processId);
      this.claudeProcess = processInfo.process;
      
      this.log('info', `Claude process spawned with PID: ${this.claudeProcess.pid}`);
      
      // Setup process event handlers
      this.setupProcessHandlers();
      
      // Wait for Claude to be ready using PromptDetector
      const readySuccess = await this.promptDetector.waitForReady(
        this.outputThrottler,
        () => this.outputThrottler.getCurrentBuffer()
      );
      
      if (readySuccess) {
        this.processReady = true;
        this.status = 'running';
        this.lastActivity = new Date();
        
        this.startHealthMonitoring();
        this.log('✅ Claude session initialized successfully');
        this.emit('session-ready', { sessionId: this.id });
        
        return true;
      } else {
        throw new Error('Claude process failed to reach ready state');
      }
      
    } catch (error) {
      this.log(`❌ Failed to initialize session: ${error.message}`);
      this.status = 'error';
      this.cleanup();
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  /**
   * Setup event handlers for the Claude process
   * @private
   */
  setupProcessHandlers() {
    this.claudeProcess.stdout.on('data', (data) => {
      this.handleProcessOutput(data);
    });
    
    this.claudeProcess.stderr.on('data', (data) => {
      this.handleProcessError(data);
    });
    
    this.claudeProcess.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });
    
    this.claudeProcess.on('error', (error) => {
      this.log(`❌ Process error: ${error.message}`);
      this.status = 'error';
      this.emit('session-error', { sessionId: this.id, error: error.message });
    });
  }

  /**
   * Handle output from Claude process
   * @private
   */
  handleProcessOutput(data) {
    const rawText = data.toString();
    this.lastActivity = new Date();
    
    // Use OutputThrottler to process output
    this.outputThrottler.processOutput(rawText);
    
    // Update status based on activity
    if (this.status === 'idle' && this.currentlyProcessing) {
      this.status = 'busy';
    }
  }

  /**
   * Handle error output from Claude process
   * @private
   */
  handleProcessError(data) {
    const rawText = data.toString();
    this.log(`Claude stderr: ${rawText.slice(0, 200)}${rawText.length > 200 ? '...' : ''}`);
    this.emit('session-error-output', { sessionId: this.id, error: rawText });
  }

  /**
   * Handle Claude process exit
   * @private
   */
  handleProcessExit(code, signal) {
    this.log(`Claude process exited with code ${code}, signal ${signal}`);
    
    this.processReady = false;
    this.status = code === 0 ? 'stopped' : 'error';
    
    // Reset any processing messages to pending
    if (this.currentlyProcessing) {
      const message = this.messageQueue.find(m => m.id === this.currentlyProcessing.id);
      if (message && message.status === 'processing') {
        message.status = 'pending';
        this.log(`🔄 Reset interrupted message ${message.id} to pending`);
      }
      this.currentlyProcessing = null;
    }
    
    this.cleanup();
    this.emit('session-ended', { 
      sessionId: this.id, 
      code, 
      signal,
      finalStatus: this.status
    });
  }


  /**
   * Add message to this session's queue
   * @param {string} message - Message content
   * @param {Object} options - Message options
   * @returns {Object} Message object
   */
  addMessageToQueue(message, options = {}) {
    // Input validation and type safety
    if (typeof message !== 'string' || !message.trim()) {
      throw new Error('Message must be a non-empty string');
    }
    if (typeof options !== 'object' || options === null) {
      throw new Error('Options must be an object');
    }
    
    const messageObj = {
      id: uuidv4(),
      message: message.trim(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      sequence: ++this.queueSequence,
      sessionId: this.id,
      ...options
    };
    
    this.messageQueue.push(messageObj);
    this.log('info', `Added message to queue: ${messageObj.id} (queue length: ${this.messageQueue.length})`);
    
    // Save queue to persistence
    this.queuePersistence.saveQueue(this.workingDirectory, this.messageQueue).catch(error => {
      this.log('error', `Failed to save queue: ${error.message}`);
    });
    
    this.emit('message-queued', { sessionId: this.id, message: messageObj });
    
    // Auto-start processing if session is ready (with race condition prevention)
    if (this.processReady && !this.currentlyProcessing && !this._processingScheduled) {
      this._processingScheduled = true;
      setTimeout(() => {
        this._processingScheduled = false;
        this.processNextMessage();
      }, 200);
    }
    
    return messageObj;
  }

  /**
   * Process the next pending message in queue
   * @returns {Promise<void>}
   */
  async processNextMessage() {
    if (!this.processReady || this.status === 'error') {
      this.log('❌ Cannot process messages - session not ready');
      return;
    }
    
    if (this.currentlyProcessing) {
      this.log('❌ Cannot process messages - already processing');
      return;
    }
    
    const message = this.messageQueue.find(m => m.status === 'pending');
    if (!message) {
      this.status = 'idle';
      return;
    }
    
    this.log(`📋 Processing message: ${message.id}`);
    this.currentlyProcessing = message;
    this.currentTask = message.message.substring(0, 50) + '...';
    message.status = 'processing';
    message.processingStartedAt = new Date().toISOString();
    this.status = 'busy';
    
    this.emit('message-started', { sessionId: this.id, message });
    
    try {
      const startTime = Date.now();
      
      // Send message to Claude
      await this.sendMessageToProcess(message);
      
      // Wait for completion
      await this.waitForProcessingComplete();
      
      // Calculate processing time
      const processingTime = Date.now() - startTime;
      message.processingTimeMs = processingTime;
      message.completedAt = new Date().toISOString();
      message.status = 'completed';
      
      // Update metrics
      this.updateMetrics(processingTime, true);
      
      this.log(`✅ Message ${message.id} completed in ${(processingTime / 1000).toFixed(1)}s`);
      this.emit('message-completed', { sessionId: this.id, message });
      
    } catch (error) {
      this.log(`❌ Error processing message ${message.id}: ${error.message}`);
      
      message.status = 'error';
      message.error = error.message;
      message.errorAt = new Date().toISOString();
      
      this.updateMetrics(0, false);
      this.emit('message-error', { sessionId: this.id, message, error: error.message });
    }
    
    // Reset processing state
    this.currentlyProcessing = null;
    this.currentTask = null;
    this.status = 'idle';
    
    // Continue with next message
    setTimeout(() => this.processNextMessage(), 1000);
  }

  /**
   * Send message to Claude process
   * @private
   */
  async sendMessageToProcess(messageObj) {
    if (!this.claudeProcess?.stdin) {
      throw new Error('Claude process not available');
    }
    
    const messageText = messageObj.message;
    const messageBytes = Buffer.byteLength(messageText, 'utf8');
    const CHUNK_SIZE = messageBytes < 10000 ? 2048 : 4096;
    const chunkDelay = messageBytes < 10000 ? 100 : 150;
    
    this.log(`📝 Sending message (${messageBytes} bytes in ${Math.ceil(messageBytes / CHUNK_SIZE)} chunks)`);
    
    // Send message in chunks
    const messageBuffer = Buffer.from(messageText, 'utf8');
    for (let i = 0; i < messageBuffer.length; i += CHUNK_SIZE) {
      const chunk = messageBuffer.subarray(i, Math.min(i + CHUNK_SIZE, messageBuffer.length));
      
      await new Promise((resolve, reject) => {
        this.claudeProcess.stdin.write(chunk, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      await new Promise(resolve => setTimeout(resolve, chunkDelay));
    }
    
    // Send carriage return to submit
    await new Promise((resolve, reject) => {
      this.claudeProcess.stdin.write('\r', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    this.log('✅ Message sent successfully');
  }

  /**
   * Wait for Claude to complete processing and return to prompt
   * @private
   */
  async waitForProcessingComplete() {
    try {
      const result = await this.promptDetector.waitForPrompt({
        timeout: 300000, // 5 minutes
        debounceMs: 2000,
        source: 'processing-completion'
      });
      
      if (!result.success) {
        throw new Error(`Processing completion timeout: ${result.reason}`);
      }
      
      return result;
    } catch (error) {
      this.log('error', `Failed to wait for processing completion: ${error.message}`);
      throw error;
    }
  }


  /**
   * Update session metrics
   * @private
   */
  updateMetrics(processingTime, success) {
    if (success) {
      this.metrics.messagesProcessed++;
      this.metrics.totalProcessingTime += processingTime;
      this.metrics.lastProcessingTime = processingTime;
      this.metrics.averageResponseTime = Math.round(
        this.metrics.totalProcessingTime / this.metrics.messagesProcessed
      );
    } else {
      this.metrics.errorsCount++;
    }
    
    this.emit('metrics-updated', { 
      sessionId: this.id, 
      metrics: { ...this.metrics }
    });
  }

  /**
   * Start health monitoring
   * @private
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds
  }

  /**
   * Perform health check
   * @private
   */
  performHealthCheck() {
    if (!this.claudeProcess || this.claudeProcess.killed) {
      this.log('⚠️ Health check failed - process is dead');
      this.status = 'error';
      this.emit('session-unhealthy', { sessionId: this.id, reason: 'process_dead' });
      return;
    }
    
    // Check for stuck processing (over 10 minutes)
    if (this.currentlyProcessing) {
      const processingTime = Date.now() - new Date(this.currentlyProcessing.processingStartedAt).getTime();
      if (processingTime > 600000) { // 10 minutes
        this.log('⚠️ Health check failed - processing stuck');
        this.status = 'error';
        this.emit('session-unhealthy', { sessionId: this.id, reason: 'processing_stuck' });
      }
    }
  }

  /**
   * Get current session status
   */
  getStatus() {
    return {
      id: this.id,
      workingDirectory: this.workingDirectory,
      status: this.status,
      startTime: this.startTime,
      lastActivity: this.lastActivity,
      currentTask: this.currentTask,
      processReady: this.processReady,
      queueLength: this.messageQueue.length,
      currentlyProcessing: this.currentlyProcessing?.id || null,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Get message queue for this session
   */
  getMessageQueue() {
    return [...this.messageQueue];
  }

  /**
   * Remove message from queue
   */
  removeMessage(messageId) {
    const index = this.messageQueue.findIndex(m => m.id === messageId);
    if (index === -1) return null;
    
    const message = this.messageQueue[index];
    if (message.status === 'processing') {
      this.log(`❌ Cannot remove message ${messageId} - currently processing`);
      return null;
    }
    
    this.messageQueue.splice(index, 1);
    this.log(`🗑️ Removed message ${messageId} from queue`);
    
    this.emit('message-removed', { sessionId: this.id, messageId });
    return message;
  }

  /**
   * Stop and cleanup the session
   */
  async stop() {
    if (this.isStopping) {
      this.log('warn', 'Session already stopping...');
      return;
    }
    
    this.isStopping = true;
    this.log('info', 'Stopping session...');
    
    // Reset any processing message
    if (this.currentlyProcessing) {
      const message = this.messageQueue.find(m => m.id === this.currentlyProcessing.id);
      if (message && message.status === 'processing') {
        message.status = 'pending';
        this.log('info', `Reset processing message ${message.id} to pending`);
      }
      this.currentlyProcessing = null;
    }
    
    // Save final queue state
    try {
      await this.queuePersistence.saveQueue(this.workingDirectory, this.messageQueue);
    } catch (error) {
      this.log('error', `Failed to save final queue state: ${error.message}`);
    }
    
    // Terminate process using ProcessManager
    if (this.processId) {
      try {
        const terminated = await this.processManager.terminateProcess(this.processId);
        this.log('info', `Process termination ${terminated ? 'successful' : 'failed'}`);
      } catch (error) {
        this.log('error', `Error terminating process: ${error.message}`);
      }
    }
    
    this.status = 'stopping';
    this.cleanup();
    
    this.log('info', 'Session stopped');
    this.emit('session-stopped', { sessionId: this.id });
  }

  /**
   * Cleanup resources
   * @private
   */
  cleanup() {
    this.processReady = false;
    
    // Cleanup utility managers
    if (this.outputThrottler) {
      this.outputThrottler.cleanup();
    }
    
    if (this.promptDetector) {
      this.promptDetector.cleanup();
    }
    
    if (this.queuePersistence) {
      this.queuePersistence.disableAutoSave(this.workingDirectory);
    }
    
    // Clear timers
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    if (this._forceKillTimer) {
      clearTimeout(this._forceKillTimer);
      this._forceKillTimer = null;
    }
    
    // Process cleanup is handled by ProcessManager in stop() method
    // No need to directly manipulate claudeProcess here
    
    this.removeAllListeners();
  }

  /**
   * Structured logging method
   * @param {string} level - Log level (info, warn, error, debug)
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   * @private
   */
  log(level = 'info', message, metadata = {}) {
    // Support legacy single-parameter usage
    if (typeof level === 'string' && !message) {
      message = level;
      level = 'info';
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      sessionId: this.id.slice(0, 8),
      workingDirectory: this.workingDirectory,
      status: this.status,
      message,
      ...metadata
    };
    
    // For development, pretty print; for production, use JSON
    if (process.env.NODE_ENV === 'production') {
      console.log(JSON.stringify(logEntry));
    } else {
      console.log(`[${logEntry.timestamp}] [${level.toUpperCase()}] [SessionInstance:${logEntry.sessionId}] ${message}`);
      if (Object.keys(metadata).length > 0) {
        console.log('  Metadata:', metadata);
      }
    }
  }
}

export default SessionInstance;