import EventEmitter from 'events';

/**
 * OutputThrottler - Advanced output buffering and throttling system
 * 
 * Extracted from ClaudeSessionManager's output management logic.
 * Provides sophisticated output handling:
 * - Throttled output emission to prevent UI freezing
 * - Intelligent buffer management with overflow protection
 * - Clear screen pattern detection
 * - Auto-clear functionality
 * - Memory-efficient garbage collection hints
 */
export class OutputThrottler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.throttleMs = options.throttleMs || 1000;
    this.autoClearMs = options.autoClearMs || 30000;
    this.maxBufferSize = options.maxBufferSize || 100000; // 100KB
    this.trimRatio = options.trimRatio || 0.75; // Keep 75% when trimming
    this.gcThreshold = options.gcThreshold || 200000; // 200KB triggers GC hint
    
    // State
    this.outputBuffer = '';
    this.currentScreenBuffer = '';
    this.lastOutputTime = 0;
    
    // Timers
    this.outputTimer = null;
    this.autoClearTimer = null;
    
    // Clear screen patterns (ANSI escape sequences)
    this.clearScreenPatterns = [
      '\x1b[2J',        // Clear entire screen
      '\x1b[H\x1b[2J',  // Home cursor + clear screen
      '\x1b[2J\x1b[H',  // Clear screen + home cursor
      '\x1b[1;1H\x1b[2J', // Position cursor + clear screen
      '\x1b[2J\x1b[1;1H', // Clear screen + position cursor
      '\x1b[3J'         // Clear screen and scrollback
    ];
    
    // Statistics
    this.stats = {
      totalOutputReceived: 0,
      totalFlushes: 0,
      totalClears: 0,
      bufferTrims: 0,
      gcTriggers: 0,
      clearScreenDetections: 0
    };
  }

  /**
   * Process incoming output data
   * @param {string} output - Raw output data
   * @param {Object} options - Processing options
   */
  processOutput(output, options = {}) {
    if (typeof output !== 'string') {
      throw new Error('Output must be a string');
    }
    
    this.stats.totalOutputReceived++;
    this.outputBuffer += output;
    
    // Handle buffer overflow
    this.handleBufferOverflow();
    
    // Detect and handle clear screen patterns
    this.handleClearScreen();
    
    // Update current screen buffer
    this.currentScreenBuffer = this.outputBuffer;
    
    // Apply throttling
    this.applyThrottling(options);
    
    // Setup auto-clear if enabled
    this.setupAutoClear();
    
    this.emit('output-processed', {
      bufferLength: this.outputBuffer.length,
      screenBufferLength: this.currentScreenBuffer.length,
      stats: { ...this.stats }
    });
  }

  /**
   * Handle buffer overflow with memory-efficient approach
   * @private
   */
  handleBufferOverflow() {
    if (this.outputBuffer.length <= this.maxBufferSize) {
      return;
    }
    
    const oldLength = this.outputBuffer.length;
    const targetSize = Math.floor(this.maxBufferSize * this.trimRatio);
    
    // Memory-efficient trimming
    const trimmedBuffer = this.outputBuffer.slice(-targetSize);
    this.outputBuffer = null; // Help GC by nullifying old reference
    this.outputBuffer = trimmedBuffer;
    
    this.stats.bufferTrims++;
    
    this.emit('buffer-trimmed', {
      oldLength,
      newLength: this.outputBuffer.length,
      targetSize,
      trimCount: this.stats.bufferTrims
    });
    
    // Suggest garbage collection for large buffer operations
    if (oldLength > this.gcThreshold && global.gc) {
      this.stats.gcTriggers++;
      setImmediate(() => {
        global.gc();
        this.emit('gc-triggered', {
          oldLength,
          gcTriggerCount: this.stats.gcTriggers
        });
      });
    }
  }

  /**
   * Detect and handle clear screen patterns
   * @private
   */
  handleClearScreen() {
    let foundClearScreen = false;
    let lastClearScreenIndex = -1;
    
    for (const pattern of this.clearScreenPatterns) {
      const index = this.outputBuffer.lastIndexOf(pattern);
      if (index > lastClearScreenIndex) {
        lastClearScreenIndex = index;
        foundClearScreen = true;
      }
    }
    
    if (foundClearScreen) {
      this.stats.clearScreenDetections++;
      
      const newScreen = this.outputBuffer.substring(lastClearScreenIndex);
      this.currentScreenBuffer = newScreen;
      this.outputBuffer = this.currentScreenBuffer;
      
      this.emit('clear-screen-detected', {
        patternIndex: lastClearScreenIndex,
        newBufferLength: this.outputBuffer.length,
        detectionCount: this.stats.clearScreenDetections
      });
    }
  }

  /**
   * Apply output throttling
   * @private
   */
  applyThrottling(options = {}) {
    const now = Date.now();
    const timeSinceLastOutput = now - this.lastOutputTime;
    const forceFlush = options.forceFlush || false;
    
    if (forceFlush || timeSinceLastOutput >= this.throttleMs) {
      this.flushOutput();
    } else if (!this.outputTimer) {
      const delay = this.throttleMs - timeSinceLastOutput;
      this.outputTimer = setTimeout(() => {
        this.flushOutput();
      }, delay);
    }
  }

  /**
   * Setup auto-clear timer
   * @private
   */
  setupAutoClear() {
    if (this.autoClearMs <= 0 || this.autoClearTimer) {
      return;
    }
    
    this.autoClearTimer = setTimeout(() => {
      this.clearOutput();
    }, this.autoClearMs);
  }

  /**
   * Flush buffered output
   */
  flushOutput() {
    if (this.currentScreenBuffer.length === 0) {
      return;
    }
    
    const output = this.currentScreenBuffer;
    this.lastOutputTime = Date.now();
    this.stats.totalFlushes++;
    
    // Clear timer
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
    
    this.emit('output-flushed', {
      outputLength: output.length,
      flushCount: this.stats.totalFlushes,
      timestamp: this.lastOutputTime
    });
    
    // Emit the actual output
    this.emit('output', output);
  }

  /**
   * Clear output buffers
   */
  clearOutput() {
    const clearedLength = this.currentScreenBuffer.length;
    this.stats.totalClears++;
    
    this.outputBuffer = '';
    this.currentScreenBuffer = '';
    
    // Clear timers
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
    if (this.autoClearTimer) {
      clearTimeout(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    
    this.emit('output-cleared', {
      clearedLength,
      clearCount: this.stats.totalClears
    });
  }

  /**
   * Force flush output immediately
   */
  forceFlush() {
    this.applyThrottling({ forceFlush: true });
  }

  /**
   * Get current buffer contents
   */
  getCurrentBuffer() {
    return this.currentScreenBuffer;
  }

  /**
   * Get buffer length
   */
  getBufferLength() {
    return this.currentScreenBuffer.length;
  }

  /**
   * Check if buffer is empty
   */
  isEmpty() {
    return this.currentScreenBuffer.length === 0;
  }

  /**
   * Get throttler statistics
   */
  getStats() {
    return {
      ...this.stats,
      bufferLength: this.outputBuffer.length,
      screenBufferLength: this.currentScreenBuffer.length,
      hasActiveThrottleTimer: this.outputTimer !== null,
      hasActiveClearTimer: this.autoClearTimer !== null,
      lastOutputTime: this.lastOutputTime,
      timeSinceLastOutput: Date.now() - this.lastOutputTime
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalOutputReceived: 0,
      totalFlushes: 0,
      totalClears: 0,
      bufferTrims: 0,
      gcTriggers: 0,
      clearScreenDetections: 0
    };
    
    this.emit('stats-reset');
  }

  /**
   * Update configuration
   */
  updateConfig(options = {}) {
    const oldConfig = {
      throttleMs: this.throttleMs,
      autoClearMs: this.autoClearMs,
      maxBufferSize: this.maxBufferSize,
      trimRatio: this.trimRatio,
      gcThreshold: this.gcThreshold
    };
    
    if (typeof options.throttleMs === 'number') {
      this.throttleMs = Math.max(0, options.throttleMs);
    }
    if (typeof options.autoClearMs === 'number') {
      this.autoClearMs = Math.max(0, options.autoClearMs);
    }
    if (typeof options.maxBufferSize === 'number') {
      this.maxBufferSize = Math.max(1000, options.maxBufferSize);
    }
    if (typeof options.trimRatio === 'number') {
      this.trimRatio = Math.max(0.1, Math.min(0.9, options.trimRatio));
    }
    if (typeof options.gcThreshold === 'number') {
      this.gcThreshold = Math.max(10000, options.gcThreshold);
    }
    
    this.emit('config-updated', { oldConfig, newConfig: this.getConfig() });
  }

  /**
   * Get current configuration
   */
  getConfig() {
    return {
      throttleMs: this.throttleMs,
      autoClearMs: this.autoClearMs,
      maxBufferSize: this.maxBufferSize,
      trimRatio: this.trimRatio,
      gcThreshold: this.gcThreshold
    };
  }

  /**
   * Cleanup all timers and resources
   */
  cleanup() {
    if (this.outputTimer) {
      clearTimeout(this.outputTimer);
      this.outputTimer = null;
    }
    if (this.autoClearTimer) {
      clearTimeout(this.autoClearTimer);
      this.autoClearTimer = null;
    }
    
    this.outputBuffer = '';
    this.currentScreenBuffer = '';
    this.removeAllListeners();
    
    this.emit('cleanup-completed');
  }

  /**
   * Static method to create a simple throttler for basic use cases
   */
  static createSimple(throttleMs = 1000, callback) {
    const throttler = new OutputThrottler({ throttleMs, autoClearMs: 0 });
    
    if (typeof callback === 'function') {
      throttler.on('output', callback);
    }
    
    return {
      process: (output) => throttler.processOutput(output),
      flush: () => throttler.forceFlush(),
      clear: () => throttler.clearOutput(),
      cleanup: () => throttler.cleanup()
    };
  }
}

export default OutputThrottler;