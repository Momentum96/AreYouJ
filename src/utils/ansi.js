/**
 * ANSI to HTML converter based on Claude-Autopilot implementation
 * Converts ANSI escape sequences to styled HTML
 */

// ANSI Color palette for 256-color mode (like Claude-Autopilot)
const ansiColors = {
  // Standard colors (0-15)
  0: '#000000', 1: '#cd0000', 2: '#00cd00', 3: '#cdcd00', 4: '#0000ee', 5: '#cd00cd', 6: '#00cdcd', 7: '#e5e5e5',
  8: '#7f7f7f', 9: '#ff0000', 10: '#00ff00', 11: '#ffff00', 12: '#5c5cff', 13: '#ff00ff', 14: '#00ffff', 15: '#ffffff',
  
  // Extended colors including common Claude colors
  52: '#5f0000', 88: '#870000', 124: '#af0000', 160: '#d70000', 196: '#ff0000',
  114: '#87d787', 118: '#87ff00', 148: '#afd700', 154: '#afff00', 190: '#d7ff00',
  174: '#d787af', 175: '#d787d7', 176: '#d787ff', 177: '#d7af5f', 178: '#d7af87',
  179: '#d7afaf', 180: '#d7afd7', 181: '#d7afff', 182: '#d7d75f', 183: '#d7d787',
  184: '#d7d7af', 185: '#d7d7d7', 186: '#d7d7ff', 187: '#d7ff5f', 188: '#d7ff87',
  189: '#d7ffaf', 190: '#d7ffd7', 191: '#d7ffff', 192: '#ff5f5f', 193: '#ff5f87',
  194: '#ff5faf', 195: '#ff5fd7', 196: '#ff5fff', 197: '#ff875f', 198: '#ff8787',
  199: '#ff87af', 200: '#ff87d7', 201: '#ff87ff', 202: '#ffaf5f', 203: '#ffaf87',
  204: '#ffafaf', 205: '#ffafd7', 206: '#ffafff', 207: '#ffd75f', 208: '#ffd787',
  209: '#ffd7af', 210: '#ffd7d7', 211: '#ffd7ff', 212: '#ffff5f', 213: '#ffff87',
  214: '#ffffaf', 215: '#ffffd7', 216: '#ffffff',
  
  // Claude specific colors
  220: '#ffd700', 231: '#ffffff', 244: '#808080', 246: '#949494',
  
  // Grays and commonly used colors
  232: '#080808', 233: '#121212', 234: '#1c1c1c', 235: '#262626', 236: '#303030', 237: '#3a3a3a',
  238: '#444444', 239: '#4e4e4e', 240: '#585858', 241: '#626262', 242: '#6c6c6c', 243: '#767676',
  244: '#808080', 245: '#8a8a8a', 246: '#949494', 247: '#9e9e9e', 248: '#a8a8a8', 249: '#b2b2b2',
  250: '#bcbcbc', 251: '#c6c6c6', 252: '#d0d0d0', 253: '#dadada', 254: '#e4e4e4', 255: '#eeeeee'
};

// ANSI Clear screen patterns (from Claude-Autopilot constants)
export const ANSI_CLEAR_SCREEN_PATTERNS = [
  '\x1b[2J',           // Clear entire screen
  '\x1b[H\x1b[2J',     // Move cursor to home + clear screen
  '\x1b[2J\x1b[H',     // Clear screen + move cursor to home
  '\x1b[1;1H\x1b[2J',  // Move cursor to 1,1 + clear screen
  '\x1b[2J\x1b[1;1H',  // Clear screen + move cursor to 1,1
  '\x1b[3J'            // Clear entire screen and scrollback
];

/**
 * Check if text contains clear screen patterns
 */
export function containsClearScreen(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return ANSI_CLEAR_SCREEN_PATTERNS.some(pattern => text.includes(pattern));
}

/**
 * Convert ANSI escape sequences to HTML (based on Claude-Autopilot implementation)
 */
export function parseAnsiToHtml(text) {
  if (!text || typeof text !== 'string') return '';

  let html = '';
  let currentStyles = {
    color: null,
    background: null,
    bold: false,
    italic: false,
    underline: false
  };

  // Split text by ANSI escape sequences
  const ansiRegex = /\x1b\[([0-9;]*)([a-zA-Z])/g;
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      html += escapeHtml(textBefore);
    }

    // Process the escape sequence
    const codes = match[1].split(';').filter(code => code !== '').map(Number);
    const command = match[2];

    if (command === 'm') {
      // SGR (Select Graphic Rendition) codes
      processSgrCodes(codes, currentStyles);
    }
    // Ignore cursor movement and other commands for now

    lastIndex = ansiRegex.lastIndex;
  }

  // Add remaining text
  const remainingText = text.slice(lastIndex);
  if (remainingText) {
    html += escapeHtml(remainingText);
  }

  return html;
}

/**
 * Process SGR (Select Graphic Rendition) codes
 */
function processSgrCodes(codes, currentStyles) {
  if (codes.length === 0) {
    codes = [0]; // Default to reset
  }

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];

    switch (code) {
      case 0: // Reset
        currentStyles.color = null;
        currentStyles.background = null;
        currentStyles.bold = false;
        currentStyles.italic = false;
        currentStyles.underline = false;
        break;

      case 1: // Bold
        currentStyles.bold = true;
        break;

      case 3: // Italic
        currentStyles.italic = true;
        break;

      case 4: // Underline
        currentStyles.underline = true;
        break;

      case 22: // Normal intensity
        currentStyles.bold = false;
        break;

      case 23: // Not italic
        currentStyles.italic = false;
        break;

      case 24: // Not underlined
        currentStyles.underline = false;
        break;

      // Foreground colors (30-37, 90-97)
      case 30: case 31: case 32: case 33: case 34: case 35: case 36: case 37:
        currentStyles.color = ansiColors[code - 30] || '#ffffff';
        break;

      case 90: case 91: case 92: case 93: case 94: case 95: case 96: case 97:
        currentStyles.color = ansiColors[code - 90 + 8] || '#ffffff';
        break;

      // Background colors (40-47, 100-107)
      case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47:
        currentStyles.background = ansiColors[code - 40] || '#000000';
        break;

      case 100: case 101: case 102: case 103: case 104: case 105: case 106: case 107:
        currentStyles.background = ansiColors[code - 100 + 8] || '#000000';
        break;

      // 256-color mode
      case 38: // Foreground 256-color
        if (i + 2 < codes.length && codes[i + 1] === 5) {
          const colorCode = codes[i + 2];
          currentStyles.color = ansiColors[colorCode] || '#ffffff';
          i += 2; // Skip the next two codes
        }
        break;

      case 48: // Background 256-color
        if (i + 2 < codes.length && codes[i + 1] === 5) {
          const colorCode = codes[i + 2];
          currentStyles.background = ansiColors[colorCode] || '#000000';
          i += 2; // Skip the next two codes
        }
        break;

      case 39: // Default foreground
        currentStyles.color = null;
        break;

      case 49: // Default background
        currentStyles.background = null;
        break;
    }
  }
}

/**
 * Apply current styles to HTML
 */
function applyStylesToHtml(html, styles) {
  if (!styles.color && !styles.background && !styles.bold && !styles.italic && !styles.underline) {
    return html;
  }

  let styleStr = '';
  const styleProps = [];

  if (styles.color) {
    styleProps.push(`color: ${styles.color}`);
  }

  if (styles.background) {
    styleProps.push(`background-color: ${styles.background}`);
  }

  if (styles.bold) {
    styleProps.push('font-weight: bold');
  }

  if (styles.italic) {
    styleProps.push('font-style: italic');
  }

  if (styles.underline) {
    styleProps.push('text-decoration: underline');
  }

  if (styleProps.length > 0) {
    styleStr = ` style="${styleProps.join('; ')}"`;
  }

  return `<span${styleStr}>${html}</span>`;
}

/**
 * Escape HTML characters
 */
function escapeHtml(text) {
  const htmlEscapes = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };

  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

/**
 * Clean ANSI sequences from text
 */
export function cleanAnsiSequences(text) {
  if (!text || typeof text !== 'string') return '';
  
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') // ANSI escape sequences
    .replace(/\x1b\[[\d;]*[HfABCDEFGJKST]/g, '') // Cursor control
    .replace(/\x1b\[[\d;]*m/g, '') // Color codes
    .replace(/\x1b\[[?]?[0-9;]*[hlmKJ]/g, '') // Various ANSI codes
    .replace(/[\x00-\x08\x0E-\x1F\x7F]/g, '') // Control characters (except \t, \n, \r)
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\r/g, '\n'); // Convert remaining \r to \n
}

/**
 * Throttled ANSI parser (like Claude-Autopilot)
 */
export class ThrottledAnsiParser {
  constructor(throttleMs = 1000) { // Claude-Autopilot uses 1 second
    this.throttleMs = throttleMs;
    this.pendingContent = null;
    this.lastParsedContent = '';
    this.lastParsedHtml = '';
    this.lastContentHash = '';
    this.renderTimer = null;
    this.lastRenderTime = 0;
    this.claudeOutputBuffer = '';
    this.lastClearScreenIndex = 0;
  }

  parse(content, callback) {
    if (!content) return;
    
    // Add to buffer (Claude-Autopilot style)
    this.claudeOutputBuffer += content;
    
    // Buffer size limit (100KB like Claude-Autopilot)
    if (this.claudeOutputBuffer.length > 100000) {
      // Keep 75% and remove the rest
      this.claudeOutputBuffer = this.claudeOutputBuffer.substring(this.claudeOutputBuffer.length * 0.25);
    }
    
    // Hash-based change detection (like Claude-Autopilot)
    const contentHash = this.claudeOutputBuffer.length + '_' + 
                       (this.claudeOutputBuffer.slice(0, 100) + this.claudeOutputBuffer.slice(-100));
    
    if (contentHash === this.lastContentHash) {
      // No changes, skip rendering
      return;
    }
    
    this.lastContentHash = contentHash;
    this.pendingContent = this.claudeOutputBuffer;

    const now = Date.now();
    const timeSinceLastRender = now - this.lastRenderTime;

    if (timeSinceLastRender >= this.throttleMs) {
      // Enough time has passed, render immediately
      this.renderContent(callback);
    } else {
      // Schedule a delayed render if not already scheduled
      if (!this.renderTimer) {
        const delay = this.throttleMs - timeSinceLastRender;
        this.renderTimer = setTimeout(() => {
          this.renderContent(callback);
        }, delay);
      }
    }
  }

  renderContent(callback) {
    if (!this.pendingContent) return;

    const content = this.pendingContent;
    this.pendingContent = null;
    this.lastRenderTime = Date.now();

    // Clear the timer
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }

    // Check for clear screen patterns (Claude-Autopilot style)
    let contentToRender = content;
    for (const pattern of ANSI_CLEAR_SCREEN_PATTERNS) {
      const index = content.lastIndexOf(pattern);
      if (index > this.lastClearScreenIndex) {
        this.lastClearScreenIndex = index;
        // Start from the clear screen position
        contentToRender = content.substring(index);
        break;
      }
    }

    // Remove the clear screen commands themselves
    contentToRender = contentToRender.replace(/\x1b\[[2-3]J/g, '').replace(/\x1b\[H/g, '');

    // Use cached parsing if content hasn't changed (Claude-Autopilot optimization)
    let html;
    if (contentToRender === this.lastParsedContent && this.lastParsedHtml) {
      html = this.lastParsedHtml;
    } else {
      // Parse and cache the result
      html = parseAnsiToHtml(contentToRender);
      this.lastParsedContent = contentToRender;
      this.lastParsedHtml = html;
    }

    callback(html, contentToRender);
  }

  reset() {
    this.pendingContent = null;
    this.lastParsedContent = '';
    this.lastParsedHtml = '';
    this.lastContentHash = '';
    this.claudeOutputBuffer = '';
    this.lastClearScreenIndex = 0;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.lastRenderTime = 0;
  }
}