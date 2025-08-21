// Claude Terminal Renderer - Based on Claude-Autopilot implementation
// This module handles ANSI sequence parsing and terminal screen rendering

// 터미널 렌더링 관련 상수들 - 매직 넘버 제거
const TERMINAL_CONSTANTS = {
  // 렌더링 성능 관련
  RENDER_THROTTLE_MS: 500,
  SCROLL_THRESHOLD: 50,
  
  // 시각적 피드백 관련
  FEEDBACK_DURATION: 800,
  FEEDBACK_BORDER_COLOR: '#00ff88',
  FEEDBACK_BOX_SHADOW: '0 0 20px rgba(0, 255, 136, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
  DEFAULT_BORDER_COLOR: '#4a9eff',
  DEFAULT_BOX_SHADOW: '0 0 20px rgba(74, 158, 255, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
  
  // ANSI 코드 관련
  RESET_CODE: 0,
  BOLD_CODE: 1,
  DIM_CODE: 2,
  ITALIC_CODE: 3,
  REVERSE_CODE: 7,
  BOLD_OFF_CODE: 22,
  ITALIC_OFF_CODE: 23,
  REVERSE_OFF_CODE: 27,
  DEFAULT_FG_CODE: 39,
  
  // 256-color mode codes
  COLOR_256_PREFIX: 38,
  COLOR_256_TYPE: 5,
  
  // 스타일 관련
  LINE_HEIGHT: 1.4,
  CLEAR_MESSAGE_DELAY: 100,
} as const;

// 타입 정의
interface AnsiColors {
  [key: number]: string;
}

interface StyleState {
  color: string | null;
  bold: boolean;
  italic: boolean;
  dim: boolean;
  reverse: boolean;
}

// HTML utility functions
function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ANSI Color palette for 256-color mode
function getAnsiColors(): AnsiColors {
    return {
    // Standard colors (0-15)
        0: '#000000', 1: '#cd0000', 2: '#00cd00', 3: '#cdcd00', 4: '#0000ee', 5: '#cd00cd', 6: '#00cdcd', 7: '#e5e5e5',
        8: '#7f7f7f', 9: '#ff0000', 10: '#00ff00', 11: '#ffff00', 12: '#5c5cff', 13: '#ff00ff', 14: '#00ffff', 15: '#ffffff',
        // More colors including common Claude colors
        52: '#5f0000', 88: '#870000', 124: '#af0000', 160: '#d70000', 196: '#ff0000',
        114: '#87d787', 118: '#87ff00', 148: '#afd700', 154: '#afff00',
        174: '#d787af', 175: '#d787d7', 176: '#d787ff', 177: '#d7af5f', 178: '#d7af87',
        179: '#d7afaf', 180: '#d7afd7', 181: '#d7afff', 182: '#d7d75f', 183: '#d7d787',
        184: '#d7d7af', 185: '#d7d7d7', 186: '#d7d7ff', 187: '#d7ff5f', 188: '#d7ff87',
        189: '#d7ffaf', 190: '#d7ffd7', 191: '#d7ffff', 192: '#ff5f5f', 193: '#ff5f87',
        194: '#ff5faf', 195: '#ff5fd7', 197: '#ff875f', 198: '#ff8787',
        199: '#ff87af', 200: '#ff87d7', 201: '#ff87ff', 202: '#ffaf5f', 203: '#ffaf87',
        204: '#ffafaf', 205: '#ffafd7', 206: '#ffafff', 207: '#ffd75f', 208: '#ffd787',
        209: '#ffd7af', 210: '#ffd7d7', 211: '#ffd7ff', 212: '#ffff5f', 213: '#ffff87',
        214: '#ffffaf', 215: '#ffffd7', 216: '#ffffff',
        // Claude specific colors
        220: '#ffd700', 231: '#ffffff',
        // Grays and commonly used colors
        232: '#080808', 233: '#121212', 234: '#1c1c1c', 235: '#262626', 236: '#303030', 237: '#3a3a3a',
        238: '#444444', 239: '#4e4e4e', 240: '#585858', 241: '#626262', 242: '#6c6c6c', 243: '#767676',
        245: '#8a8a8a', 247: '#9e9e9e', 248: '#a8a8a8', 249: '#b2b2b2',
        250: '#bcbcbc', 251: '#c6c6c6', 252: '#d0d0d0', 253: '#dadada', 254: '#e4e4e4', 255: '#eeeeee'
    };
}

function processAnsiInText(text: string): string {
    let html = '';
    let currentStyles: StyleState = {
        color: null,
        bold: false,
        italic: false,
        dim: false,
        reverse: false
    };

    const ansiColors = getAnsiColors();

    // Split text into parts: text and ANSI escape sequences
    const parts = text.split(/(\x1b\[[0-9;]*m)/);

    for (const part of parts) {
        if (part.startsWith('\x1b[') && part.endsWith('m')) {
            // This is an ANSI color/style code
            const codes = part.slice(2, -1).split(';').filter(c => c !== '').map(Number);

            for (const code of codes) {
                if (code === TERMINAL_CONSTANTS.RESET_CODE || code === TERMINAL_CONSTANTS.DEFAULT_FG_CODE) {
                    // Reset or default foreground color
                    currentStyles.color = null;
                    currentStyles.bold = false;
                    currentStyles.italic = false;
                    currentStyles.dim = false;
                    currentStyles.reverse = false;
                } else if (code === TERMINAL_CONSTANTS.BOLD_CODE) {
                    currentStyles.bold = true;
                } else if (code === TERMINAL_CONSTANTS.BOLD_OFF_CODE) {
                    currentStyles.bold = false;
                    currentStyles.dim = false;
                } else if (code === TERMINAL_CONSTANTS.DIM_CODE) {
                    currentStyles.dim = true;
                } else if (code === TERMINAL_CONSTANTS.ITALIC_CODE) {
                    currentStyles.italic = true;
                } else if (code === TERMINAL_CONSTANTS.ITALIC_OFF_CODE) {
                    currentStyles.italic = false;
                } else if (code === TERMINAL_CONSTANTS.REVERSE_CODE) {
                    currentStyles.reverse = true;
                } else if (code === TERMINAL_CONSTANTS.REVERSE_OFF_CODE) {
                    currentStyles.reverse = false;
                }
            }

            // Handle 256-color mode (38;5;n)
            for (let j = 0; j < codes.length - 2; j++) {
                if (codes[j] === TERMINAL_CONSTANTS.COLOR_256_PREFIX && codes[j + 1] === TERMINAL_CONSTANTS.COLOR_256_TYPE) {
                    const colorCode = codes[j + 2];
                    currentStyles.color = ansiColors[colorCode] || '#ffffff';
                    break;
                }
            }
        } else if (part.length > 0) {
            // This is actual text content - sanitize it
            let style = '';
            if (currentStyles.color) style += `color: ${currentStyles.color};`;
            if (currentStyles.bold) style += 'font-weight: bold;';
            if (currentStyles.italic) style += 'font-style: italic;';
            if (currentStyles.dim) style += 'opacity: 0.6;';
            if (currentStyles.reverse) style += 'background-color: #ffffff; color: #000000;';

            // Sanitize HTML characters
            const escapedText = escapeHtml(part);

            if (style) {
                html += `<span style="${style}">${escapedText}</span>`;
            } else {
                html += escapedText;
            }
        }
    }

    return html;
}

export function parseAnsiToHtml(text: string): string {
    // Remove cursor control sequences that don't affect display
    text = text.replace(/\x1b\[\?25[lh]/g, ''); // Show/hide cursor
    text = text.replace(/\x1b\[\?2004[lh]/g, ''); // Bracketed paste mode
    text = text.replace(/\x1b\[\?1004[lh]/g, ''); // Focus reporting
    // Don't remove clear screen codes - let performClaudeRender detect them
    // text = text.replace(/\x1b\[[2-3]J/g, ''); // Clear screen codes
    text = text.replace(/\x1b\[H/g, ''); // Move cursor to home

    // Process the text line by line to handle carriage returns properly
    const lines = text.split('\n');
    const processedLines: string[] = [];

    for (const lineText of lines) {
    // Handle carriage returns within the line
        const parts = lineText.split('\r');
        let finalLine = '';

        for (let i = 0; i < parts.length; i++) {
            if (i === parts.length - 1) {
                // Last part - append normally
                finalLine += processAnsiInText(parts[i]);
            } else {
                // Not the last part - this will be overwritten by the next part
                finalLine = processAnsiInText(parts[i]);
            }
        }

        processedLines.push(finalLine);
    }

    return processedLines.join('\n');
}

// Check if output contains screen clearing commands
export function containsClearScreen(output: string): boolean {
    return output.includes('\x1b[2J') || output.includes('\x1b[3J') || output.includes('\x1b[H');
}

// Simple hash function for content comparison (Claude-Autopilot style)
function simpleHash(str: string): string {
    let hash = 0;
    if (str.length === 0) return hash.toString();
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
}

// Claude Terminal Renderer Class (Claude-Autopilot style)
export class ClaudeTerminalRenderer {
    private claudeContent: string = '';
    private lastParsedContent: string = '';
    private lastParsedHtml: string = '';
    private lastContentHash: string = ''; // Hash-based duplicate detection
    private lastClaudeRenderTime: number = 0;
    private pendingClaudeOutput: string = '';
    private claudeRenderTimer: NodeJS.Timeout | null = null;

    constructor() {
        // 모든 초기화는 프로퍼티 선언에서 수행
    }

    // Main render function with hash-based duplicate detection (Claude-Autopilot style)
    renderOutput(output: string, terminalElement: HTMLElement | null): void {
        if (!terminalElement) return;

        try {
            // Hash-based duplicate detection (Claude-Autopilot style)
            const contentHash = simpleHash(output);
            if (contentHash === this.lastContentHash && !containsClearScreen(output)) {
                // Content hasn't changed, skip rendering
                console.log('📋 Skipping render - content unchanged (hash match)');
                return;
            }

            // Check if this output contains screen clearing commands
            if (containsClearScreen(output)) {
                // Clear screen - replace entire content
                this.claudeContent = output;
                this.lastContentHash = contentHash;
                terminalElement.innerHTML = '';
                
                // Reset cache since this is a new screen
                this.lastParsedContent = '';
                this.lastParsedHtml = '';
                
                // Parse and render the new content (remove clear screen codes after detection)
                const contentToRender = output.replace(/\x1b\[[2-3]J/g, '').replace(/\x1b\[H/g, '');
                const htmlOutput = parseAnsiToHtml(contentToRender);
                this.lastParsedContent = output;
                this.lastParsedHtml = htmlOutput;
                
                const outputElement = document.createElement('div');
                outputElement.style.cssText = `white-space: pre; word-wrap: break-word; line-height: ${TERMINAL_CONSTANTS.LINE_HEIGHT}; font-family: inherit;`;
                outputElement.innerHTML = htmlOutput;
                terminalElement.appendChild(outputElement);
                
                // Add visual feedback effect for clear screen (Claude-Autopilot style)
                this.addVisualFeedback(terminalElement);
            } else {
                // No clear screen - this is the complete current screen content from backend
                this.claudeContent = output;
                this.lastContentHash = contentHash;
                
                let htmlOutput: string;
                if (output === this.lastParsedContent && this.lastParsedHtml) {
                    // Use cached result
                    htmlOutput = this.lastParsedHtml;
                    console.log('📋 Using cached ANSI parsing result');
                } else {
                    // Parse new content
                    htmlOutput = parseAnsiToHtml(this.claudeContent);
                    this.lastParsedContent = output;
                    this.lastParsedHtml = htmlOutput;
                    console.log('🔄 Parsing ANSI content');
                }
                
                // Optimize DOM updates - only update if HTML content actually changed
                let existingElement = terminalElement.querySelector('.claude-content') as HTMLElement;
                if (!existingElement) {
                    // First time setup
                    terminalElement.innerHTML = '';
                    existingElement = document.createElement('div');
                    existingElement.className = 'claude-content';
                    existingElement.style.cssText = `white-space: pre; word-wrap: break-word; line-height: ${TERMINAL_CONSTANTS.LINE_HEIGHT}; font-family: inherit;`;
                    terminalElement.appendChild(existingElement);
                }
                
                // Only update DOM if HTML content actually changed (Claude-Autopilot style)
                if (existingElement.innerHTML !== htmlOutput) {
                    existingElement.innerHTML = htmlOutput;
                    console.log('🎨 Updated DOM with new content');
                    
                    // Add visual feedback effect (Claude-Autopilot style)
                    this.addVisualFeedback(terminalElement);
                } else {
                    console.log('📋 DOM unchanged - HTML content identical');
                }
            }

            // Smart auto-scroll (only if user was at bottom)
            const scrollContainer = terminalElement.parentElement;
            if (scrollContainer && scrollContainer.classList.contains('overflow-auto')) {
                // Check if user was at bottom before content change
                const wasAtBottom = scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - TERMINAL_CONSTANTS.SCROLL_THRESHOLD;
                if (wasAtBottom || containsClearScreen(output)) {
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;
                }
            } else {
                const wasAtBottom = terminalElement.scrollTop + terminalElement.clientHeight >= terminalElement.scrollHeight - TERMINAL_CONSTANTS.SCROLL_THRESHOLD;
                if (wasAtBottom || containsClearScreen(output)) {
                    terminalElement.scrollTop = terminalElement.scrollHeight;
                }
            }
            
        } catch (error) {
            console.error('Terminal rendering error:', error);
        }
    }

    // Visual feedback effect for terminal updates (Claude-Autopilot style)
    private addVisualFeedback(terminalElement: HTMLElement): void {
        if (!terminalElement) return;
        
        try {
            // Find the scroll container (usually the parent with overflow-auto)
            const scrollContainer = terminalElement.parentElement;
            const targetElement = (scrollContainer && scrollContainer.classList.contains('overflow-auto')) 
                ? scrollContainer 
                : terminalElement;
            
            // Store original styles
            const originalBorderColor = targetElement.style.borderColor;
            const originalBoxShadow = targetElement.style.boxShadow;
            
            // Apply feedback effect (green flash - Claude-Autopilot style)
            targetElement.style.borderColor = TERMINAL_CONSTANTS.FEEDBACK_BORDER_COLOR;
            targetElement.style.boxShadow = TERMINAL_CONSTANTS.FEEDBACK_BOX_SHADOW;
            
            // Restore original styles after delay
            setTimeout(() => {
                try {
                    targetElement.style.borderColor = originalBorderColor || TERMINAL_CONSTANTS.DEFAULT_BORDER_COLOR;
                    targetElement.style.boxShadow = originalBoxShadow || TERMINAL_CONSTANTS.DEFAULT_BOX_SHADOW;
                } catch (error) {
                    // Ignore errors if element was removed
                }
            }, TERMINAL_CONSTANTS.FEEDBACK_DURATION);
            
        } catch (error) {
            console.error('Visual feedback error:', error);
        }
    }

    // Throttled version for high-frequency updates
    appendOutput(output: string, terminalElement: HTMLElement | null): void {
        try {
            // Store the latest output
            this.pendingClaudeOutput = output;
            
            // Check if we need to throttle
            const now = Date.now();
            const timeSinceLastRender = now - this.lastClaudeRenderTime;
            
            if (timeSinceLastRender >= TERMINAL_CONSTANTS.RENDER_THROTTLE_MS) {
                // Enough time has passed, render immediately
                this.lastClaudeRenderTime = now;
                this.renderOutput(output, terminalElement);
            } else {
                // Throttle - schedule a render
                if (this.claudeRenderTimer) {
                    clearTimeout(this.claudeRenderTimer);
                }
                
                const remainingTime = TERMINAL_CONSTANTS.RENDER_THROTTLE_MS - timeSinceLastRender;
                this.claudeRenderTimer = setTimeout(() => {
                    this.lastClaudeRenderTime = Date.now();
                    this.renderOutput(this.pendingClaudeOutput, terminalElement);
                    this.claudeRenderTimer = null;
                }, remainingTime);
            }
        } catch (error) {
            console.error('Terminal append error:', error);
        }
    }

    // Clear terminal
    clear(terminalElement: HTMLElement | null): void {
        if (terminalElement) {
            terminalElement.innerHTML = '<div style="color: #666; font-style: italic;">Terminal cleared...</div>';
            
            // Always scroll to bottom after clear (clear is intentional)
            const scrollContainer = terminalElement.parentElement;
            if (scrollContainer && scrollContainer.classList.contains('overflow-auto')) {
                setTimeout(() => {
                    if (scrollContainer) {
                        scrollContainer.scrollTop = scrollContainer.scrollHeight;
                    }
                }, TERMINAL_CONSTANTS.CLEAR_MESSAGE_DELAY);
            } else {
                setTimeout(() => {
                    if (terminalElement) {
                        terminalElement.scrollTop = terminalElement.scrollHeight;
                    }
                }, TERMINAL_CONSTANTS.CLEAR_MESSAGE_DELAY);
            }
        }
        this.claudeContent = '';
        this.lastParsedContent = '';
        this.lastParsedHtml = '';
        this.lastContentHash = ''; // Reset hash on clear
    }

    // Resource cleanup method for memory leak prevention
    dispose(): void {
        if (this.claudeRenderTimer) {
            clearTimeout(this.claudeRenderTimer);
            this.claudeRenderTimer = null;
        }
        
        // Clear all cached content
        this.claudeContent = '';
        this.lastParsedContent = '';
        this.lastParsedHtml = '';
        this.lastContentHash = '';
        this.pendingClaudeOutput = '';
    }
}