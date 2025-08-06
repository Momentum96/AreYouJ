import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import EventEmitter from 'events';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ClaudeSessionManager extends EventEmitter {
  constructor() {
    super();
    this.pythonProcess = null;
    this.sessionReady = false;
    this.isStarting = false;
    this.messageQueue = [];
    this.currentlyProcessing = null;
    this.lastActivity = Date.now();
    this.healthCheckInterval = null;
    
    // Debug logging
    this.debugLogFile = path.join(__dirname, '../logs/claude-debug.log');
    this.ensureLogDirectory();
    
    // Bind methods for proper 'this' context
    this.handleProcessData = this.handleProcessData.bind(this);
    this.handleProcessError = this.handleProcessError.bind(this);
    this.handleProcessExit = this.handleProcessExit.bind(this);
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

  debugLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    try {
      fs.appendFileSync(this.debugLogFile, logMessage);
    } catch (error) {
      console.error('Failed to write debug log:', error);
    }
  }

  cleanAnsiSequences(text) {
    // Remove ANSI escape sequences and other terminal control codes
    return text
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape sequences
      .replace(/\x1b\[[\d;]*[HfABCDEFGJKST]/g, '') // Cursor control
      .replace(/\x1b\[[\d;]*m/g, '') // Color codes
      .replace(/\x1b\[[?]?[0-9;]*[hlmKJ]/g, '') // Various ANSI codes
      .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '') // Control characters (except \t, \n, \r)
      .replace(/\r\n/g, '\n') // Normalize line endings
      .replace(/\r/g, '\n'); // Convert remaining \r to \n
  }

  async startSession(skipPermissions = true) {
    if (this.isStarting) {
      this.log('Session already starting...');
      return false;
    }

    if (this.pythonProcess && this.sessionReady) {
      this.log('Session already active');
      return true;
    }

    this.isStarting = true;
    this.log('Starting Claude session...');

    try {
      const wrapperPath = path.join(__dirname, 'claude_pty_wrapper.py');
      const args = ['python3', wrapperPath];
      
      if (skipPermissions) {
        args.push('--skip-permissions');
      }

      this.log(`Executing: ${args.join(' ')}`);

      // Spawn Python process
      this.pythonProcess = spawn(args[0], args.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        detached: false  // Keep process attached to parent
      });

      this.log(`Python process spawned with PID: ${this.pythonProcess.pid}`);

      // Set up event handlers
      this.pythonProcess.stdout.on('data', this.handleProcessData);
      this.pythonProcess.stderr.on('data', this.handleProcessError);
      this.pythonProcess.on('exit', this.handleProcessExit);

      // Wait for session ready signal
      const ready = await this.waitForSessionReady();
      
      if (ready) {
        this.startHealthCheck();
        this.log('✅ Claude session started successfully');
        this.emit('session-started');
        return true;
      } else {
        this.log('❌ Failed to start Claude session');
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

  async waitForSessionReady(timeout = 30000) {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.log('❌ Timeout waiting for session ready');
        resolve(false);
      }, timeout);

      const onReady = () => {
        clearTimeout(timeoutId);
        this.removeListener('session-ready', onReady);
        resolve(true);
      };

      this.on('session-ready', onReady);
    });
  }

  handleProcessData(data) {
    const rawText = data.toString();
    this.debugLog(`Raw stdout data: ${JSON.stringify(rawText)}`);
    
    // Clean ANSI sequences before processing
    const cleanText = this.cleanAnsiSequences(rawText);
    this.debugLog(`Clean stdout data: ${JSON.stringify(cleanText)}`);
    
    const lines = cleanText.split('\n').filter(line => line.trim());

    for (const line of lines) {
      this.debugLog(`Processing line: ${JSON.stringify(line)}`);
      
      try {
        const message = JSON.parse(line);
        this.debugLog(`Parsed JSON message: ${JSON.stringify(message)}`);
        this.handleClaudeMessage(message);
      } catch (error) {
        // Not JSON, treat as regular output
        if (line.trim()) {
          this.log(`Claude output: ${line}`);
          this.debugLog(`Non-JSON output: ${line}`);
          this.emit('claude-output', line);
        }
      }
    }
  }

  handleClaudeMessage(message) {
    this.lastActivity = Date.now();

    switch (message.type) {
      case 'ready':
        this.log('🎉 Claude session is ready');
        this.sessionReady = true;
        this.emit('session-ready');
        break;

      case 'log':
        const logPrefix = message.level === 'error' ? '❌' : 
                         message.level === 'debug' ? '🐛' : 'ℹ️';
        this.log(`${logPrefix} ${message.message}`);
        
        if (message.level === 'error') {
          this.emit('error', new Error(message.message));
        }
        break;

      case 'terminal_output':
        // Real-time terminal output streaming (Claude-Autopilot style)
        this.debugLog(`Terminal output chunk: ${message.data.length} chars, raw: ${message.is_raw}`);
        this.emit('terminal-output', {
          type: 'terminal_chunk',
          data: message.data,
          timestamp: message.timestamp,
          is_raw: message.is_raw
        });
        break;

      case 'screen_clear':
        this.log('🧹 Screen clear detected');
        this.emit('terminal-output', {
          type: 'screen_clear',
          timestamp: message.timestamp
        });
        break;

      case 'output_update':
        this.debugLog(`Output update: ${message.data.length} chars`);
        this.emit('terminal-output', {
          type: 'output_update',
          data: message.data,
          timestamp: message.timestamp
        });
        break;

      case 'response_complete':
        this.log(`✅ Response complete: ${message.output.length} total chars`);
        this.emit('claude-output', message.output);
        this.emit('terminal-output', {
          type: 'response_complete',
          output: message.output,
          timestamp: message.timestamp
        });
        break;

      case 'response_timeout':
        this.log(`⏰ Response timeout: ${message.output.length} chars`);
        this.emit('claude-output', message.output);
        this.emit('terminal-output', {
          type: 'response_timeout',
          output: message.output,
          timestamp: message.timestamp
        });
        break;

      case 'output':
        // Legacy output handling
        this.emit('claude-output', message.content);
        break;

      case 'result':
        this.handleMessageResult(message);
        break;

      case 'pong':
        this.log('🏓 Pong received from Claude session');
        break;

      case 'error':
        this.log(`❌ Claude error: ${message.message}`);
        this.emit('error', new Error(message.message));
        break;

      default:
        this.log(`Unknown message type: ${message.type}`);
    }
  }

  handleMessageResult(message) {
    if (this.currentlyProcessing && message.message_id === this.currentlyProcessing.id) {
      const result = {
        ...this.currentlyProcessing,
        ...message.data,
        completedAt: new Date().toISOString()
      };

      this.log(`✅ Message completed: ${result.status}`);
      this.emit('message-completed', result);
      
      this.currentlyProcessing = null;
      
      // Process next message in queue
      setTimeout(() => this.processNextMessage(), 1000);
    }
  }

  handleProcessError(data) {
    const rawText = data.toString();
    this.debugLog(`Raw stderr data: ${JSON.stringify(rawText)}`);
    
    // Clean ANSI sequences from stderr too
    const cleanText = this.cleanAnsiSequences(rawText);
    this.debugLog(`Clean stderr data: ${JSON.stringify(cleanText)}`);
    
    // Log to console (short version)
    this.log(`Claude stderr: ${cleanText.slice(0, 200)}${cleanText.length > 200 ? '...' : ''}`);
    
    // Try to parse as JSON in case it's a debug message
    const lines = cleanText.split('\n').filter(line => line.trim());
    for (const line of lines) {
      this.debugLog(`Processing stderr line: ${JSON.stringify(line)}`);
      
      if (line.trim().startsWith('{') || line.includes('[PTY-JSON]')) {
        try {
          // Extract JSON from PTY-JSON format
          const jsonStr = line.includes('[PTY-JSON]') ? 
            line.substring(line.indexOf('{')) : line;
          const message = JSON.parse(jsonStr);
          this.debugLog(`Parsed JSON from stderr: ${JSON.stringify(message)}`);
          this.handleClaudeMessage(message);
        } catch (e) {
          // Not JSON, just regular stderr
          this.debugLog(`Non-JSON stderr: ${line}`);
        }
      } else if (line.trim()) {
        this.debugLog(`Regular stderr: ${line}`);
      }
    }
    
    this.emit('process-error', cleanText);
  }

  handleProcessExit(code, signal) {
    this.log(`Claude process exited with code ${code}, signal ${signal}`);
    
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
    
    if (this.currentlyProcessing) {
      this.log(`⚠️ Process exited while processing message: ${this.currentlyProcessing.id}`);
    }
    
    this.sessionReady = false;
    this.currentlyProcessing = null;
    this.pythonProcess = null;
    
    this.stopHealthCheck();
    this.emit('session-ended', { code, signal });
  }

  async sendMessage(messageItem) {
    if (!this.sessionReady || !this.pythonProcess) {
      throw new Error('Claude session not ready');
    }

    const command = {
      action: 'send_message',
      message: messageItem.message,
      message_id: messageItem.id
    };

    this.log(`📤 Sending message: ${messageItem.id}`);
    this.currentlyProcessing = {
      ...messageItem,
      status: 'processing',
      processingStartedAt: new Date().toISOString()
    };

    this.pythonProcess.stdin.write(JSON.stringify(command) + '\n');
    this.emit('message-started', this.currentlyProcessing);
  }

  async addToQueue(messageItem) {
    this.messageQueue.push(messageItem);
    this.log(`📝 Message added to queue: ${messageItem.id} (queue length: ${this.messageQueue.length})`);
    
    // Start processing if not currently processing
    if (!this.currentlyProcessing && this.sessionReady) {
      setTimeout(() => this.processNextMessage(), 500);
    }
  }

  async processNextMessage() {
    if (this.currentlyProcessing || this.messageQueue.length === 0) {
      return;
    }

    const nextMessage = this.messageQueue.shift();
    try {
      await this.sendMessage(nextMessage);
    } catch (error) {
      this.log(`❌ Failed to process message ${nextMessage.id}: ${error.message}`);
      
      const errorResult = {
        ...nextMessage,
        status: 'error',
        error: error.message,
        completedAt: new Date().toISOString()
      };
      
      this.emit('message-completed', errorResult);
      
      // Try next message after delay
      setTimeout(() => this.processNextMessage(), 2000);
    }
  }

  startHealthCheck() {
    this.stopHealthCheck(); // Clear any existing interval
    
    this.healthCheckInterval = setInterval(() => {
      if (this.pythonProcess && this.sessionReady) {
        // Send ping to check if session is alive
        const ping = { action: 'ping' };
        try {
          this.pythonProcess.stdin.write(JSON.stringify(ping) + '\n');
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
      queueLength: this.messageQueue.length,
      currentlyProcessing: this.currentlyProcessing ? this.currentlyProcessing.id : null,
      lastActivity: this.lastActivity,
      processAlive: this.pythonProcess && !this.pythonProcess.killed
    };
  }

  async stop() {
    this.log('🛑 Stopping Claude session...');
    
    if (this.pythonProcess) {
      // Send exit command
      try {
        const exitCommand = { action: 'exit' };
        this.pythonProcess.stdin.write(JSON.stringify(exitCommand) + '\n');
        
        // Wait for graceful exit
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            this.log('⏰ Graceful exit timeout, forcing termination');
            resolve();
          }, 5000);

          this.pythonProcess.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } catch (error) {
        this.log(`Warning: Error during graceful exit: ${error.message}`);
      }
    }

    this.cleanup();
    this.log('✅ Claude session stopped');
  }

  cleanup() {
    this.sessionReady = false;
    this.isStarting = false;
    this.currentlyProcessing = null;
    
    this.stopHealthCheck();

    if (this.pythonProcess) {
      try {
        if (!this.pythonProcess.killed) {
          this.pythonProcess.kill('SIGTERM');
          
          // Force kill after 3 seconds if still alive
          setTimeout(() => {
            if (this.pythonProcess && !this.pythonProcess.killed) {
              this.log('🔪 Force killing Claude process...');
              this.pythonProcess.kill('SIGKILL');
            }
          }, 3000);
        }
      } catch (error) {
        this.log(`Warning: Error during cleanup: ${error.message}`);
      } finally {
        this.pythonProcess = null;
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