import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import EventEmitter from 'events';

/**
 * ProcessManager - Advanced Claude process lifecycle management
 * 
 * Extracted from ClaudeSessionManager's process management logic.
 * Provides robust process handling:
 * - Safe process spawning with environment filtering
 * - Graceful shutdown with fallback force termination
 * - Health monitoring and process state tracking
 * - Error recovery and retry mechanisms
 * - Resource cleanup and leak prevention
 */
export class ProcessManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.gracefulTimeoutMs = options.gracefulTimeoutMs || 2000;
    this.forceKillTimeoutMs = options.forceKillTimeoutMs || 3000;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelayMs = options.retryDelayMs || 1000;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs || 30000;
    
    // State
    this.processes = new Map(); // processId -> ProcessInfo
    this.healthCheckTimer = null;
    
    // Safe environment variables
    this.safeEnvVars = new Set([
      'PATH', 'HOME', 'USER', 'PYTHONPATH', 'PYTHONUNBUFFERED',
      'LANG', 'LC_ALL', 'TERM', 'PWD'
    ]);
    
    // Statistics
    this.stats = {
      processesSpawned: 0,
      processesTerminated: 0,
      gracefulShutdowns: 0,
      forcedKills: 0,
      healthCheckFailures: 0,
      retryAttempts: 0
    };
    
    this.startHealthChecking();
  }

  /**
   * Spawn a new Claude process
   * @param {string} workingDirectory - Working directory for the process
   * @param {Object} options - Spawn options
   * @returns {Promise<string>} - Process ID
   */
  async spawnClaudeProcess(workingDirectory, options = {}) {
    // Input validation
    if (!workingDirectory || typeof workingDirectory !== 'string') {
      throw new Error('Working directory is required and must be a string');
    }
    
    if (!fs.existsSync(workingDirectory)) {
      throw new Error(`Working directory does not exist: ${workingDirectory}`);
    }
    
    const processId = this.generateProcessId();
    const retryCount = options.retryCount || 0;
    
    try {
      this.emit('spawn-attempt', { processId, workingDirectory, retryCount });
      
      // Prepare command and arguments
      const wrapperPath = this.getClaudeWrapperPath();
      const args = this.buildClaudeArgs(workingDirectory, options);
      
      // Create safe environment
      const safeEnv = this.createSafeEnvironment(options.env);
      
      this.emit('spawn-config', {
        processId,
        command: args[0],
        args: args.slice(1),
        workingDirectory,
        envVars: Object.keys(safeEnv)
      });
      
      // Spawn process
      const process = spawn(args[0], args.slice(1), {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: safeEnv,
        cwd: workingDirectory,
        detached: false
      });
      
      // Create process info
      const processInfo = {
        id: processId,
        process: process,
        workingDirectory: workingDirectory,
        startTime: new Date(),
        status: 'starting',
        options: { ...options },
        retryCount: retryCount,
        forceKillTimer: null,
        lastHealthCheck: new Date()
      };
      
      this.processes.set(processId, processInfo);
      this.stats.processesSpawned++;
      
      // Setup process event handlers
      this.setupProcessHandlers(processInfo);
      
      this.emit('process-spawned', {
        processId,
        pid: process.pid,
        workingDirectory,
        spawnCount: this.stats.processesSpawned
      });
      
      return processId;
      
    } catch (error) {
      this.emit('spawn-failed', {
        processId,
        workingDirectory,
        error: error.message,
        retryCount
      });
      
      // Retry logic
      if (retryCount < this.maxRetries) {
        this.stats.retryAttempts++;
        
        this.emit('spawn-retry', {
          processId,
          retryCount: retryCount + 1,
          maxRetries: this.maxRetries,
          delayMs: this.retryDelayMs
        });
        
        await new Promise(resolve => setTimeout(resolve, this.retryDelayMs));
        return this.spawnClaudeProcess(workingDirectory, { 
          ...options, 
          retryCount: retryCount + 1 
        });
      }
      
      throw new Error(`Failed to spawn Claude process after ${this.maxRetries} retries: ${error.message}`);
    }
  }

  /**
   * Terminate a process gracefully
   * @param {string} processId - Process ID to terminate
   * @returns {Promise<boolean>} - Success status
   */
  async terminateProcess(processId) {
    const processInfo = this.processes.get(processId);
    
    if (!processInfo) {
      this.emit('terminate-failed', { processId, reason: 'process_not_found' });
      return false;
    }
    
    const { process } = processInfo;
    
    if (process.killed || process.exitCode !== null) {
      this.emit('terminate-skipped', { processId, reason: 'already_terminated' });
      this.processes.delete(processId);
      return true;
    }
    
    processInfo.status = 'terminating';
    this.emit('terminate-started', { processId, pid: process.pid });
    
    try {
      // Try graceful exit first
      await this.attemptGracefulExit(processInfo);
      
      // Wait for graceful exit or timeout
      const exitResult = await this.waitForExit(processInfo, this.gracefulTimeoutMs);
      
      if (exitResult.success) {
        this.stats.gracefulShutdowns++;
        this.emit('terminate-graceful', { 
          processId, 
          exitCode: exitResult.exitCode,
          signal: exitResult.signal,
          gracefulCount: this.stats.gracefulShutdowns
        });
      } else {
        // Force termination
        await this.forceTerminate(processInfo);
        this.stats.forcedKills++;
        this.emit('terminate-forced', { 
          processId,
          forcedKillCount: this.stats.forcedKills
        });
      }
      
      this.processes.delete(processId);
      this.stats.processesTerminated++;
      
      return true;
      
    } catch (error) {
      this.emit('terminate-error', {
        processId,
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * Get process status
   * @param {string} processId - Process ID
   * @returns {Object|null} - Process status or null if not found
   */
  getProcessStatus(processId) {
    const processInfo = this.processes.get(processId);
    
    if (!processInfo) {
      return null;
    }
    
    const { process } = processInfo;
    
    return {
      id: processId,
      pid: process.pid,
      status: processInfo.status,
      workingDirectory: processInfo.workingDirectory,
      startTime: processInfo.startTime,
      lastHealthCheck: processInfo.lastHealthCheck,
      isAlive: !process.killed && process.exitCode === null,
      exitCode: process.exitCode,
      signalCode: process.signalCode,
      retryCount: processInfo.retryCount
    };
  }

  /**
   * Get all processes status
   * @returns {Array} - Array of process statuses
   */
  getAllProcesses() {
    const processes = [];
    
    for (const [processId] of this.processes) {
      const status = this.getProcessStatus(processId);
      if (status) {
        processes.push(status);
      }
    }
    
    return processes.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
  }

  /**
   * Kill all processes
   * @returns {Promise<void>}
   */
  async killAllProcesses() {
    const processIds = Array.from(this.processes.keys());
    
    this.emit('kill-all-started', { processCount: processIds.length });
    
    const terminationPromises = processIds.map(processId => 
      this.terminateProcess(processId).catch(error => {
        this.emit('kill-all-error', { processId, error: error.message });
        return false;
      })
    );
    
    const results = await Promise.allSettled(terminationPromises);
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    
    this.emit('kill-all-completed', { 
      total: processIds.length, 
      successful: successCount,
      failed: processIds.length - successCount
    });
  }

  /**
   * Setup process event handlers
   * @private
   */
  setupProcessHandlers(processInfo) {
    const { process, id: processId } = processInfo;
    
    process.on('exit', (code, signal) => {
      processInfo.status = 'exited';
      processInfo.exitCode = code;
      processInfo.signalCode = signal;
      
      // Clear force kill timer if active
      if (processInfo.forceKillTimer) {
        clearTimeout(processInfo.forceKillTimer);
        processInfo.forceKillTimer = null;
      }
      
      this.emit('process-exited', {
        processId,
        exitCode: code,
        signal: signal,
        startTime: processInfo.startTime,
        duration: Date.now() - processInfo.startTime.getTime()
      });
    });
    
    process.on('error', (error) => {
      processInfo.status = 'error';
      this.emit('process-error', {
        processId,
        error: error.message,
        pid: process.pid
      });
    });
    
    // Forward stdio events
    process.stdout?.on('data', (data) => {
      this.emit('process-stdout', { processId, data });
    });
    
    process.stderr?.on('data', (data) => {
      this.emit('process-stderr', { processId, data });
    });
  }

  /**
   * Attempt graceful exit
   * @private
   */
  async attemptGracefulExit(processInfo) {
    const { process } = processInfo;
    
    try {
      // Send graceful exit command if stdin is available
      if (process.stdin && !process.stdin.destroyed) {
        const exitCommand = JSON.stringify({ action: 'exit' }) + '\n';
        process.stdin.write(exitCommand);
      } else {
        // Send SIGTERM for graceful shutdown
        process.kill('SIGTERM');
      }
    } catch (error) {
      // If graceful exit fails, we'll fall back to force termination
      this.emit('graceful-exit-failed', {
        processId: processInfo.id,
        error: error.message
      });
    }
  }

  /**
   * Wait for process exit
   * @private
   */
  async waitForExit(processInfo, timeoutMs) {
    const { process } = processInfo;
    
    return new Promise((resolve) => {
      let resolved = false;
      
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        process.removeListener('exit', exitHandler);
      };
      
      const exitHandler = (code, signal) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ success: true, exitCode: code, signal });
      };
      
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve({ success: false });
      }, timeoutMs);
      
      process.once('exit', exitHandler);
      
      // If process is already dead, resolve immediately
      if (process.killed || process.exitCode !== null) {
        resolved = true;
        cleanup();
        resolve({ success: true, exitCode: process.exitCode, signal: process.signalCode });
      }
    });
  }

  /**
   * Force terminate process
   * @private
   */
  async forceTerminate(processInfo) {
    const { process } = processInfo;
    
    if (process.killed || process.exitCode !== null) {
      return;
    }
    
    try {
      process.kill('SIGKILL');
      
      // Set force kill timer for cleanup
      processInfo.forceKillTimer = setTimeout(() => {
        processInfo.forceKillTimer = null;
        this.emit('force-kill-timeout', { processId: processInfo.id });
      }, this.forceKillTimeoutMs);
      
    } catch (error) {
      this.emit('force-kill-error', {
        processId: processInfo.id,
        error: error.message
      });
    }
  }

  /**
   * Start health checking
   * @private
   */
  startHealthChecking() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.healthCheckIntervalMs);
  }

  /**
   * Perform health check on all processes
   * @private
   */
  performHealthCheck() {
    for (const [processId, processInfo] of this.processes) {
      try {
        const { process } = processInfo;
        
        processInfo.lastHealthCheck = new Date();
        
        if (process.killed || process.exitCode !== null) {
          this.stats.healthCheckFailures++;
          this.emit('health-check-failed', {
            processId,
            reason: 'process_dead',
            exitCode: process.exitCode,
            signal: process.signalCode,
            failureCount: this.stats.healthCheckFailures
          });
          
          // Remove dead process
          this.processes.delete(processId);
        } else {
          this.emit('health-check-passed', { processId });
        }
        
      } catch (error) {
        this.stats.healthCheckFailures++;
        this.emit('health-check-error', {
          processId,
          error: error.message,
          failureCount: this.stats.healthCheckFailures
        });
      }
    }
  }

  /**
   * Helper methods
   * @private
   */
  generateProcessId() {
    return `claude_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  getClaudeWrapperPath() {
    return path.join(path.dirname(new URL(import.meta.url).pathname), '../claude/claude_pty_wrapper.py');
  }

  buildClaudeArgs(workingDirectory, options) {
    const args = ['python3', this.getClaudeWrapperPath()];
    
    if (options.skipPermissions !== false) {
      args.push('--skip-permissions');
    }
    
    args.push('--working-dir', workingDirectory);
    
    // Add any additional args from options
    if (options.additionalArgs && Array.isArray(options.additionalArgs)) {
      args.push(...options.additionalArgs);
    }
    
    return args;
  }

  createSafeEnvironment(customEnv = {}) {
    const env = {};
    
    // Add safe environment variables
    for (const varName of this.safeEnvVars) {
      if (process.env[varName]) {
        env[varName] = process.env[varName];
      }
    }
    
    // Add custom environment variables (with safety check)
    for (const [key, value] of Object.entries(customEnv)) {
      if (typeof key === 'string' && typeof value === 'string' && !key.startsWith('_')) {
        env[key] = value;
      }
    }
    
    return env;
  }

  /**
   * Get manager statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeProcesses: this.processes.size,
      healthCheckInterval: this.healthCheckIntervalMs,
      uptime: Date.now() - (this.startTime?.getTime() || Date.now())
    };
  }

  /**
   * Cleanup all resources
   */
  async cleanup() {
    this.emit('cleanup-started');
    
    // Stop health checking
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Kill all processes
    await this.killAllProcesses();
    
    // Clear all data
    this.processes.clear();
    this.removeAllListeners();
    
    this.emit('cleanup-completed');
  }

  /**
   * Static method to spawn a single Claude process
   * @param {string} workingDirectory - Working directory
   * @param {Object} options - Spawn options
   * @returns {Promise<Object>} - Process info with cleanup function
   */
  static async spawnSingle(workingDirectory, options = {}) {
    const manager = new ProcessManager(options);
    const processId = await manager.spawnClaudeProcess(workingDirectory, options);
    const processInfo = manager.getProcessStatus(processId);
    
    return {
      processId,
      process: manager.processes.get(processId).process,
      ...processInfo,
      terminate: () => manager.terminateProcess(processId),
      cleanup: () => manager.cleanup()
    };
  }
}

export default ProcessManager;