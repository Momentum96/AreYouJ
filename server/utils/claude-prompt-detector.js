import EventEmitter from 'events';

/**
 * ClaudePromptDetector - Advanced Claude prompt and permission detection
 * 
 * Extracted from the massive waitForPrompt method in ClaudeSessionManager.
 * Provides sophisticated pattern matching for various Claude states:
 * - Ready prompts
 * - Permission requests
 * - Output stabilization detection
 * - Enhanced error handling
 */
export class ClaudePromptDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.debounceThresholdMs = options.debounceThresholdMs || 2000;
    this.timeoutMs = options.timeoutMs || 3600000; // 1 hour default
    this.stabilizationTimeMs = options.stabilizationTimeMs || 4000;
    this.longStabilizationTimeMs = options.longStabilizationTimeMs || 8000;
    this.minContentLength = options.minContentLength || 100;
    
    // Timers
    this.screenAnalysisTimer = null;
    this.timeoutTimer = null;
    
    // State tracking
    this.lastOutputTime = Date.now();
    this.waitingForPermission = false;
    
    // Pattern definitions
    this.readyPatterns = [
      // Primary indicators (most reliable)
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
    
    this.permissionPrompts = [
      // Direct permission requests
      'Do you want to make this edit to',
      'Do you want to create', 
      'Do you want to delete',
      'Do you want to read',
      'Would you like to',
      'Proceed with',
      'Continue?',
      
      // Additional permission patterns
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
  }

  /**
   * Wait for Claude to reach ready state
   * @param {EventEmitter} outputEmitter - Emitter that fires 'claude-output' events
   * @param {function} getScreenBuffer - Function that returns current screen buffer
   * @returns {Promise<boolean>} - Resolves true when ready, false on timeout
   */
  async waitForReady(outputEmitter, getScreenBuffer) {
    return new Promise((resolve, reject) => {
      // Input validation
      if (!outputEmitter || typeof outputEmitter.on !== 'function') {
        reject(new Error('Output emitter must be an EventEmitter'));
        return;
      }
      if (typeof getScreenBuffer !== 'function') {
        reject(new Error('getScreenBuffer must be a function'));
        return;
      }
      
      this.lastOutputTime = Date.now();
      this.waitingForPermission = false;
      
      // Track output timing
      const outputTracker = () => {
        this.lastOutputTime = Date.now();
        this.emit('output-received');
      };
      
      outputEmitter.on('claude-output', outputTracker);
      
      // Setup cleanup
      const cleanup = () => {
        if (this.screenAnalysisTimer) {
          clearTimeout(this.screenAnalysisTimer);
          this.screenAnalysisTimer = null;
        }
        if (this.timeoutTimer) {
          clearTimeout(this.timeoutTimer);
          this.timeoutTimer = null;
        }
        outputEmitter.off('claude-output', outputTracker);
      };
      
      // Main analysis function
      const analyzeCurrentScreen = () => {
        try {
          const timeSinceLastOutput = Date.now() - this.lastOutputTime;
          const screenBuffer = getScreenBuffer() || '';
          
          this.emit('screen-analysis', { 
            bufferLength: screenBuffer.length, 
            timeSinceLastOutput,
            waitingForPermission: this.waitingForPermission
          });
          
          // Permission prompt detection
          const result = this.analyzePermissionState(screenBuffer, timeSinceLastOutput);
          if (result.continueAnalysis) {
            this.scheduleNextAnalysis(analyzeCurrentScreen);
            return;
          }
          
          // Ready state detection
          const readyResult = this.analyzeReadyState(screenBuffer, timeSinceLastOutput);
          if (readyResult.isReady) {
            cleanup();
            this.emit('ready-detected', { 
              method: readyResult.method, 
              pattern: readyResult.pattern,
              priority: readyResult.priority
            });
            resolve(true);
          } else {
            this.scheduleNextAnalysis(analyzeCurrentScreen);
          }
        } catch (error) {
          cleanup();
          this.emit('analysis-error', { error: error.message });
          reject(error);
        }
      };
      
      // Setup timeout with health check
      this.timeoutTimer = setTimeout(() => {
        cleanup();
        this.emit('timeout', { timeoutMs: this.timeoutMs });
        resolve(false); // Return false instead of rejecting for timeout
      }, this.timeoutMs);
      
      // Start analysis
      this.scheduleNextAnalysis(analyzeCurrentScreen);
    });
  }

  /**
   * Analyze screen for permission prompts
   * @private
   */
  analyzePermissionState(screenBuffer, timeSinceLastOutput) {
    const detectedPrompts = this.permissionPrompts.filter(prompt => 
      screenBuffer.toLowerCase().includes(prompt.toLowerCase())
    );
    
    const hasPermissionPrompt = detectedPrompts.length > 0;
    const hasPermissionContext = screenBuffer.includes('[Y/n]') || 
                                screenBuffer.includes('[y/N]') ||
                                screenBuffer.includes('(y/n)') ||
                                screenBuffer.includes('Enter/Space/Escape') ||
                                /\[(yes|no|y|n|enter|space|esc)\]/i.test(screenBuffer);
    
    if (this.waitingForPermission) {
      // Check if permission resolved
      const permissionResolved = screenBuffer.includes('? for shortcuts') ||
                                /operation.*complete/i.test(screenBuffer) ||
                                /task.*finished/i.test(screenBuffer) ||
                                /changes.*applied/i.test(screenBuffer) ||
                                /successfully/i.test(screenBuffer) ||
                                this.readyPatterns.some(pattern => pattern.test(screenBuffer));
      
      if (permissionResolved) {
        this.emit('permission-resolved');
        this.waitingForPermission = false;
        return { continueAnalysis: false };
      } else {
        const stillWaitingForInput = detectedPrompts.length > 0 || hasPermissionContext ||
                                   screenBuffer.includes('waiting') ||
                                   screenBuffer.includes('pending');
        
        this.emit('permission-waiting', { 
          activePrompts: detectedPrompts,
          stillWaiting: stillWaitingForInput
        });
        return { continueAnalysis: true };
      }
    }
    
    if ((hasPermissionPrompt || hasPermissionContext) && !this.waitingForPermission) {
      this.emit('permission-detected', { 
        prompts: detectedPrompts,
        hasContext: hasPermissionContext
      });
      this.waitingForPermission = true;
      return { continueAnalysis: true };
    }
    
    return { continueAnalysis: false };
  }

  /**
   * Analyze screen for ready state
   * @private
   */
  analyzeReadyState(screenBuffer, timeSinceLastOutput) {
    // Enhanced pattern matching with priority system
    let matchedPattern = null;
    let matchPriority = 0;
    let matchMethod = 'pattern';
    
    for (let i = 0; i < this.readyPatterns.length; i++) {
      const pattern = this.readyPatterns[i];
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
        
        this.emit('pattern-matched', { 
          pattern: pattern.source, 
          direct: directMatch, 
          json: jsonMatch, 
          priority 
        });
      }
    }
    
    const isReady = matchedPattern !== null;
    
    if (isReady && timeSinceLastOutput >= this.debounceThresholdMs) {
      return { 
        isReady: true, 
        method: 'pattern', 
        pattern: matchedPattern.source, 
        priority: matchPriority 
      };
    } else if (isReady) {
      this.emit('pattern-detected-waiting-stability', { 
        pattern: matchedPattern.source,
        timeSinceLastOutput,
        debounceThreshold: this.debounceThresholdMs
      });
      return { isReady: false };
    } else {
      // Alternative detection methods
      const hasSubstantialContent = screenBuffer.length > this.minContentLength;
      const hasStabilized = timeSinceLastOutput >= this.stabilizationTimeMs;
      const looksLikePrompt = screenBuffer.trim().endsWith('>') || screenBuffer.trim().endsWith('$');
      
      if (hasSubstantialContent && hasStabilized && looksLikePrompt) {
        return { 
          isReady: true, 
          method: 'stabilization-with-prompt',
          pattern: 'prompt-like-ending'
        };
      } else if (hasSubstantialContent && timeSinceLastOutput >= this.longStabilizationTimeMs) {
        return { 
          isReady: true, 
          method: 'long-stabilization',
          pattern: 'extended-timeout'
        };
      }
      
      this.emit('ready-check-failed', {
        hasSubstantialContent,
        hasStabilized,
        looksLikePrompt,
        timeSinceLastOutput
      });
      
      return { isReady: false };
    }
  }

  /**
   * Schedule next analysis
   * @private
   */
  scheduleNextAnalysis(analyzeFunction) {
    this.screenAnalysisTimer = setTimeout(analyzeFunction, 500);
  }

  /**
   * Check if text contains ready patterns
   * @param {string} text - Text to check
   * @returns {Object} - Analysis result
   */
  static checkReadyPatterns(text) {
    const detector = new ClaudePromptDetector();
    const result = detector.analyzeReadyState(text, 5000); // Assume sufficient time passed
    return {
      isReady: result.isReady,
      method: result.method,
      pattern: result.pattern
    };
  }

  /**
   * Check if text contains permission prompts
   * @param {string} text - Text to check
   * @returns {Object} - Analysis result
   */
  static checkPermissionPrompts(text) {
    const detector = new ClaudePromptDetector();
    const detectedPrompts = detector.permissionPrompts.filter(prompt => 
      text.toLowerCase().includes(prompt.toLowerCase())
    );
    
    const hasPermissionContext = text.includes('[Y/n]') || 
                                text.includes('[y/N]') ||
                                text.includes('(y/n)') ||
                                /\[(yes|no|y|n|enter|space|esc)\]/i.test(text);
    
    return {
      hasPermissionPrompt: detectedPrompts.length > 0,
      detectedPrompts,
      hasPermissionContext,
      needsUserInput: detectedPrompts.length > 0 || hasPermissionContext
    };
  }

  /**
   * Cleanup all timers and listeners
   */
  cleanup() {
    if (this.screenAnalysisTimer) {
      clearTimeout(this.screenAnalysisTimer);
      this.screenAnalysisTimer = null;
    }
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.removeAllListeners();
  }
}

export default ClaudePromptDetector;