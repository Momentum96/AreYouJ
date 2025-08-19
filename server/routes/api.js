import express from 'express';
import fs from 'fs';
import path from 'path';
import { broadcastToClients } from '../websocket/index.js';
import { getClaudeSession } from '../claude/session-manager.js';
import sqliteManager from '../db/sqlite.js';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const SETTINGS_FILE = path.join(__dirname, '../data/settings.json');

const router = express.Router();

// Settings management functions
function loadSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      const defaultSettings = {
        projectHomePath: process.cwd(),
        recentPaths: []
      };
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2));
      return defaultSettings;
    }
    const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading settings:', error);
    return { projectHomePath: process.cwd(), recentPaths: [] };
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

// 최근 경로 관리 함수
function addToRecentPaths(settings, newPath) {
  // recentPaths가 없으면 초기화
  if (!settings.recentPaths) {
    settings.recentPaths = [];
  }
  
  // 이미 있는 경로면 제거 (중복 방지)
  settings.recentPaths = settings.recentPaths.filter(path => path !== newPath);
  
  // 맨 앞에 추가
  settings.recentPaths.unshift(newPath);
  
  // 최대 5개까지만 유지
  if (settings.recentPaths.length > 5) {
    settings.recentPaths = settings.recentPaths.slice(0, 5);
  }
  
  return settings;
}

// Processing status (session manager handles queue now)
let processingStatus = {
  isProcessing: false,
  currentMessage: null,
  totalMessages: 0,
  completedMessages: 0
};

// Claude Output Buffer (Claude-Autopilot style)
let claudeOutputBuffer = '';
let claudeCurrentScreen = '';
let lastClaudeOutputTime = 0;

// Export function to get current Claude output
export function getCurrentClaudeOutput() {
  return {
    currentScreen: claudeCurrentScreen,
    bufferLength: claudeOutputBuffer.length,
    lastOutputTime: lastClaudeOutputTime,
    hasOutput: claudeCurrentScreen.length > 0
  };
}

// Get Claude session instance
const claudeSession = getClaudeSession();

// Set up Claude session event handlers
// Removed duplicate session-started handler - WebSocket module handles this

claudeSession.on('session-ended', (eventData) => {
  const { code, signal, interruptedMessage, resetMessagesCount, remainingQueueLength } = eventData;
  
  console.log(`❌ Claude session ended (code: ${code}, signal: ${signal})`);
  
  if (interruptedMessage) {
    console.log(`🔄 Interrupted message: ${interruptedMessage.id}`);
  }
  
  if (resetMessagesCount > 0) {
    console.log(`🔄 Reset ${resetMessagesCount} processing messages to pending status`);
  }
  
  // Update local processing status
  processingStatus.isProcessing = false;
  processingStatus.currentMessage = null;
  
  // Get updated queue from session manager
  const messageQueue = claudeSession.getMessageQueue();
  
  // Broadcast comprehensive session-ended event
  broadcastToClients({
    type: 'session-ended',
    data: { 
      reason: 'Claude session ended',
      exitCode: code,
      signal: signal,
      interruptedMessage: interruptedMessage ? {
        id: interruptedMessage.id,
        message: interruptedMessage.message.substring(0, 100) + '...'
      } : null,
      resetMessagesCount,
      remainingQueueLength
    }
  });
  
  // Broadcast updated queue status
  broadcastToClients({
    type: 'queue-update',
    data: { 
      messages: messageQueue, 
      total: messageQueue.length,
      resetCount: resetMessagesCount
    }
  });
  
  // Broadcast processing stopped
  broadcastToClients({
    type: 'processing-stopped',
    data: { 
      reason: 'Claude session ended',
      wasInterrupted: !!interruptedMessage,
      resetMessagesCount
    }
  });
});

// Handle manual session stops
claudeSession.on('session-manually-stopped', (eventData) => {
  const { interruptedMessage, resetMessagesCount, remainingQueueLength } = eventData;
  
  console.log('🛑 Claude session manually stopped by user');
  
  if (interruptedMessage) {
    console.log(`🔄 Interrupted message: ${interruptedMessage.id}`);
  }
  
  if (resetMessagesCount > 0) {
    console.log(`🔄 Reset ${resetMessagesCount} processing messages to pending status`);
  }
  
  // Update local processing status
  processingStatus.isProcessing = false;
  processingStatus.currentMessage = null;
  
  // Get updated queue from session manager
  const messageQueue = claudeSession.getMessageQueue();
  
  // Broadcast manual stop event
  broadcastToClients({
    type: 'session-manually-stopped',
    data: { 
      reason: 'User stopped Claude session',
      interruptedMessage: interruptedMessage ? {
        id: interruptedMessage.id,
        message: interruptedMessage.message.substring(0, 100) + '...'
      } : null,
      resetMessagesCount,
      remainingQueueLength
    }
  });
  
  // Broadcast updated queue status
  broadcastToClients({
    type: 'queue-update',
    data: { 
      messages: messageQueue, 
      total: messageQueue.length,
      resetCount: resetMessagesCount
    }
  });
  
  // Broadcast processing stopped
  broadcastToClients({
    type: 'processing-stopped',
    data: { 
      reason: 'User stopped Claude session',
      wasInterrupted: !!interruptedMessage,
      resetMessagesCount
    }
  });
});

// Handle processing stopped due to error
claudeSession.on('processing-stopped-due-to-error', (eventData) => {
  const { error } = eventData;
  
  console.log(`❌ Processing stopped due to session error: ${error.errorMessage}`);
  
  // Update local processing status
  processingStatus.isProcessing = false;
  processingStatus.currentMessage = null;
  
  // Get current queue from session manager
  const messageQueue = claudeSession.getMessageQueue();
  
  // Broadcast error-based stop event
  broadcastToClients({
    type: 'processing-stopped-due-to-error',
    data: { 
      reason: 'Session error prevented further processing',
      error: {
        type: error.errorType,
        message: error.errorMessage,
        messageId: error.messageId,
        timestamp: error.timestamp
      }
    }
  });
  
  // Broadcast updated queue status
  broadcastToClients({
    type: 'queue-update',
    data: { 
      messages: messageQueue, 
      total: messageQueue.length
    }
  });
});

claudeSession.on('message-started', (message) => {
  console.log(`📤 Claude processing message: ${message.id}`);
  
  processingStatus.currentMessage = message.id;
  processingStatus.isProcessing = true;
  
  // Get current queue from session manager
  const messageQueue = claudeSession.getMessageQueue();
  
  broadcastToClients({
    type: 'queue-update',
    data: { messages: messageQueue, total: messageQueue.length }
  });
});


claudeSession.on('message-completed', (result) => {
  console.log(`✅ Claude completed message: ${result.id} (${result.status})`);
  
  processingStatus.currentMessage = null;
  processingStatus.isProcessing = false;
  
  if (result.status === 'completed') {
    processingStatus.completedMessages++;
  }
  
  // Get current queue from session manager
  const messageQueue = claudeSession.getMessageQueue();
  
  broadcastToClients({
    type: 'queue-update',
    data: { messages: messageQueue, total: messageQueue.length }
  });
  
  // Check if all messages are processed
  const pendingMessages = messageQueue.filter(m => m.status === 'pending');
  const processingMessages = messageQueue.filter(m => m.status === 'processing');
  
  if (pendingMessages.length === 0 && processingMessages.length === 0) {
    console.log('🏁 All messages processed');
    broadcastToClients({
      type: 'processing-completed',
      data: { 
        totalProcessed: processingStatus.completedMessages,
        completedAt: new Date().toISOString()
      }
    });
  }
});

claudeSession.on('claude-output', (output) => {
  // Update Claude output buffer (Claude-Autopilot style)
  claudeOutputBuffer += output;
  lastClaudeOutputTime = Date.now();
  
  // Handle screen clearing patterns
  const clearScreenPatterns = ['\x1b[2J', '\x1b[H\x1b[2J', '\x1b[2J\x1b[H', '\x1b[1;1H\x1b[2J', '\x1b[2J\x1b[1;1H', '\x1b[3J'];
  let foundClearScreen = false;
  let lastClearScreenIndex = -1;
  
  for (const pattern of clearScreenPatterns) {
    const index = claudeOutputBuffer.lastIndexOf(pattern);
    if (index > lastClearScreenIndex) {
      lastClearScreenIndex = index;
      foundClearScreen = true;
    }
  }
  
  if (foundClearScreen) {
    // Clear screen detected - use content after clear screen
    claudeCurrentScreen = claudeOutputBuffer.substring(lastClearScreenIndex);
    claudeOutputBuffer = claudeCurrentScreen;
  } else {
    // No clear screen - current screen is entire buffer
    claudeCurrentScreen = claudeOutputBuffer;
  }
  
  // Buffer size limit (100KB like Claude-Autopilot)
  if (claudeOutputBuffer.length > 100000) {
    claudeOutputBuffer = claudeOutputBuffer.substring(claudeOutputBuffer.length * 0.25);
    claudeCurrentScreen = claudeOutputBuffer;
  }
  
  // Broadcast current screen (not just the chunk)
  broadcastToClients({
    type: 'claude-output',
    data: { 
      output: claudeCurrentScreen,
      fullBuffer: claudeOutputBuffer,
      timestamp: new Date().toISOString() 
    }
  });
});

// Removed duplicate error handler - WebSocket module handles this

// Get system status  
router.get('/status', (req, res) => {
  const claudeStatus = claudeSession.getStatus();
  const messageQueue = claudeSession.getMessageQueue();
  
  res.json({
    status: claudeStatus.sessionReady ? 'ready' : 'not-ready',
    queue: {
      total: messageQueue.length,
      pending: messageQueue.filter(m => m.status === 'pending').length,
      processing: messageQueue.filter(m => m.status === 'processing').length,
      completed: messageQueue.filter(m => m.status === 'completed').length,
      error: messageQueue.filter(m => m.status === 'error').length
    },
    processing: processingStatus,
    claude: {
      sessionReady: claudeStatus.sessionReady,
      isStarting: claudeStatus.isStarting,
      currentlyProcessing: claudeStatus.currentlyProcessing,
      lastActivity: claudeStatus.lastActivity,
      processAlive: claudeStatus.processAlive,
      screenBufferSize: claudeStatus.screenBufferSize
    },
    output: {
      currentScreen: claudeCurrentScreen,
      bufferLength: claudeOutputBuffer.length,
      lastOutputTime: lastClaudeOutputTime
    }
  });
});

// Get queue messages
router.get('/queue', (req, res) => {
  const messageQueue = claudeSession.getMessageQueue();
  res.json({
    messages: messageQueue,
    total: messageQueue.length
  });
});

// Add message to queue (Claude-Autopilot style with auto-processing)
router.post('/queue/add', async (req, res) => {
  const { message } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      error: 'Message is required and must be a string'
    });
  }

  const newMessage = {
    id: Date.now().toString(),
    message: message.trim(),
    status: 'pending',
    createdAt: claudeSession.createLocalTimeString(),
    completedAt: null,
    output: null
  };

  // Add message to session manager's queue (this triggers auto-processing)
  claudeSession.addMessageToQueue(newMessage);
  
  const messageQueue = claudeSession.getMessageQueue();

  // Broadcast queue update
  broadcastToClients({
    type: 'queue-update',
    data: {
      messages: messageQueue,
      total: messageQueue.length
    }
  });

  // Broadcast status update
  broadcastToClients({
    type: 'status-update',
    data: {
      status: 'ready',
      queue: {
        total: messageQueue.length,
        pending: messageQueue.filter(m => m.status === 'pending').length,
        processing: messageQueue.filter(m => m.status === 'processing').length,
        completed: messageQueue.filter(m => m.status === 'completed').length,
        error: messageQueue.filter(m => m.status === 'error').length
      },
      processing: processingStatus
    }
  });

  res.json({
    success: true,
    message: 'Message added to queue',
    messageId: newMessage.id,
    queueLength: messageQueue.length,
    autoProcessing: true
  });
});

// Update message in queue
router.put('/queue/:id', (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  
  if (!message || typeof message !== 'string') {
    return res.status(400).json({
      error: 'Message is required and must be a string'
    });
  }

  const updatedMessage = claudeSession.updateMessageInQueue(id, message.trim());
  
  if (!updatedMessage) {
    return res.status(404).json({
      error: 'Message not found'
    });
  }

  const messageQueue = claudeSession.getMessageQueue();
  
  // Broadcast queue update
  broadcastToClients({
    type: 'queue-update',
    data: {
      messages: messageQueue,
      total: messageQueue.length
    }
  });

  // Broadcast status update
  broadcastToClients({
    type: 'status-update',
    data: {
      status: 'ready',
      queue: {
        total: messageQueue.length,
        pending: messageQueue.filter(m => m.status === 'pending').length,
        processing: messageQueue.filter(m => m.status === 'processing').length,
        completed: messageQueue.filter(m => m.status === 'completed').length,
        error: messageQueue.filter(m => m.status === 'error').length
      },
      processing: processingStatus
    }
  });
  
  res.json({
    success: true,
    message: 'Message updated in queue',
    updatedMessage
  });
});

// Delete message from queue
router.delete('/queue/:id', (req, res) => {
  const { id } = req.params;
  
  const deletedMessage = claudeSession.removeMessageFromQueue(id);
  
  if (!deletedMessage) {
    return res.status(404).json({
      error: 'Message not found'
    });
  }

  const messageQueue = claudeSession.getMessageQueue();
  
  // Broadcast queue update
  broadcastToClients({
    type: 'queue-update',
    data: {
      messages: messageQueue,
      total: messageQueue.length
    }
  });

  // Broadcast status update
  broadcastToClients({
    type: 'status-update',
    data: {
      status: 'ready',
      queue: {
        total: messageQueue.length,
        pending: messageQueue.filter(m => m.status === 'pending').length,
        processing: messageQueue.filter(m => m.status === 'processing').length,
        completed: messageQueue.filter(m => m.status === 'completed').length,
        error: messageQueue.filter(m => m.status === 'error').length
      },
      processing: processingStatus
    }
  });
  
  res.json({
    success: true,
    message: 'Message deleted from queue',
    deletedMessage
  });
});

// Clear queue
router.delete('/queue', (req, res) => {
  const messageQueue = claudeSession.getMessageQueue();
  const clearedCount = messageQueue.length;
  
  // Clear session manager's queue
  claudeSession.clearMessageQueue();
  
  // Also clear Claude output buffer
  claudeOutputBuffer = '';
  claudeCurrentScreen = '';
  lastClaudeOutputTime = 0;
  
  const emptyQueue = claudeSession.getMessageQueue();
  
  // Broadcast queue update
  broadcastToClients({
    type: 'queue-update',
    data: {
      messages: emptyQueue,
      total: emptyQueue.length
    }
  });

  // Broadcast status update
  broadcastToClients({
    type: 'status-update',
    data: {
      status: 'ready',
      queue: {
        total: emptyQueue.length,
        pending: 0,
        processing: 0,
        completed: 0,
        error: 0
      },
      processing: processingStatus
    }
  });

  // Broadcast output cleared
  broadcastToClients({
    type: 'claude-output',
    data: { 
      output: '',
      fullBuffer: '',
      timestamp: new Date().toISOString(),
      cleared: true
    }
  });
  
  res.json({
    success: true,
    message: `Cleared ${clearedCount} messages from queue and output buffer`
  });
});

// Start Claude session only (Claude-Autopilot style)
router.post('/session/start', async (req, res) => {
  try {
    const claudeStatus = claudeSession.getStatus();
    
    if (claudeStatus.sessionReady) {
      return res.json({
        success: true,
        message: 'Claude session already running',
        status: claudeStatus
      });
    }
    
    console.log('🚀 Starting Claude session only (not processing messages yet)...');
    const started = await claudeSession.startSession();
    
    if (!started) {
      return res.status(500).json({
        error: 'Failed to start Claude session'
      });
    }
    
    // Session started, but NOT processing messages yet
    broadcastToClients({
      type: 'session-status',
      data: {
        status: 'ready',
        sessionReady: true,
        details: { message: 'Claude session ready to receive messages' }
      }
    });
    
    res.json({
      success: true,
      message: 'Claude session started and ready',
      status: claudeSession.getStatus()
    });
    
  } catch (error) {
    console.error('❌ Failed to start Claude session:', error);
    res.status(500).json({
      error: `Failed to start Claude session: ${error.message}`
    });
  }
});

// Process next message (if session is ready)
router.post('/processing/next', async (req, res) => {
  try {
    const claudeStatus = claudeSession.getStatus();
    
    if (!claudeStatus.sessionReady) {
      return res.status(400).json({
        error: 'Claude session not ready. Start session first.'
      });
    }
    
    if (processingStatus.isProcessing) {
      return res.status(400).json({
        error: 'Already processing a message'
      });
    }
    
    const pendingMessages = messageQueue.filter(m => m.status === 'pending');
    if (pendingMessages.length === 0) {
      return res.status(400).json({
        error: 'No pending messages to process'
      });
    }
    
    // Process next pending message
    const nextMessage = pendingMessages[0];
    processingStatus.isProcessing = true;
    processingStatus.currentMessage = nextMessage.id;
    
    await claudeSession.sendMessage(nextMessage);
    
    broadcastToClients({
      type: 'message-status',
      data: {
        messageId: nextMessage.id,
        status: 'processing'
      }
    });
    
    res.json({
      success: true,
      message: 'Processing next message',
      messageId: nextMessage.id
    });
    
  } catch (error) {
    console.error('❌ Failed to process next message:', error);
    res.status(500).json({
      error: `Failed to process next message: ${error.message}`
    });
  }
});

// Start processing (DEPRECATED - for backward compatibility)
router.post('/processing/start', async (req, res) => {
  // This endpoint now just starts the session
  // Actual message processing happens automatically
  return res.redirect(307, '/api/session/start');
});

// Auto-start processing (triggered when returning to automation page)
router.post('/processing/auto-start', async (req, res) => {
  try {
    console.log('🔄 Auto-start processing triggered from frontend');
    
    const claudeStatus = claudeSession.getStatus();
    const messageQueue = claudeSession.getMessageQueue();
    
    if (!claudeStatus.sessionReady) {
      return res.status(400).json({
        error: 'Claude session not ready',
        claudeStatus
      });
    }
    
    const hasPendingMessages = messageQueue.some(m => m.status === 'pending');
    if (!hasPendingMessages) {
      return res.json({
        success: true,
        message: 'No pending messages to process',
        queueLength: messageQueue.length
      });
    }
    
    if (claudeStatus.currentlyProcessing) {
      return res.json({
        success: true,
        message: 'Already processing messages',
        currentMessage: claudeStatus.currentlyProcessing
      });
    }
    
    // Trigger auto-processing
    console.log('✅ Triggering auto-start processing via session manager');
    claudeSession.tryAutoStartProcessing();
    
    res.json({
      success: true,
      message: 'Auto-processing triggered successfully',
      queueLength: messageQueue.length,
      pendingCount: messageQueue.filter(m => m.status === 'pending').length
    });
    
  } catch (error) {
    console.error('❌ Failed to trigger auto-start processing:', error);
    res.status(500).json({
      error: `Failed to trigger auto-start processing: ${error.message}`
    });
  }
});

// Stop processing (with Claude integration)
router.post('/processing/stop', async (req, res) => {
  try {
    processingStatus.isProcessing = false;
    processingStatus.currentMessage = null;
    
    // Note: We don't stop the Claude session, just stop adding new messages
    // Current message will complete, but no new messages will be processed
    console.log('🛑 Processing stopped by user');
    
    // Broadcast status update
    broadcastToClients({
      type: 'status-update',
      data: {
        status: 'ready',
        queue: {
          total: messageQueue.length,
          pending: messageQueue.filter(m => m.status === 'pending').length,
          processing: messageQueue.filter(m => m.status === 'processing').length,
          completed: messageQueue.filter(m => m.status === 'completed').length,
        error: messageQueue.filter(m => m.status === 'error').length
        },
        processing: processingStatus
      }
    });

    // Broadcast processing stopped
    broadcastToClients({
      type: 'processing-stopped',
      data: { reason: 'User stopped processing' }
    });
    
    res.json({
      success: true,
      message: 'Processing stopped',
      status: processingStatus,
      claude: claudeSession.getStatus()
    });

  } catch (error) {
    console.error('❌ Failed to stop processing:', error);
    res.status(500).json({
      error: `Failed to stop processing: ${error.message}`
    });
  }
});

// Claude session management endpoints
router.post('/claude/start', async (req, res) => {
  try {
    const started = await claudeSession.startSession();
    
    if (started) {
      res.json({
        success: true,
        message: 'Claude session started',
        status: claudeSession.getStatus()
      });
    } else {
      res.status(500).json({
        error: 'Failed to start Claude session'
      });
    }
  } catch (error) {
    console.error('❌ Failed to start Claude session:', error);
    res.status(500).json({
      error: `Failed to start Claude session: ${error.message}`
    });
  }
});

router.post('/claude/stop', async (req, res) => {
  try {
    const statusBefore = claudeSession.getStatus();
    const queueBefore = claudeSession.getMessageQueue();
    
    console.log('🛑 Stopping Claude session via API request');
    console.log(`📊 Session status before stop: ${JSON.stringify(statusBefore)}`);
    console.log(`📊 Queue before stop: ${queueBefore.length} messages`);
    
    await claudeSession.stop();
    
    const statusAfter = claudeSession.getStatus();
    const queueAfter = claudeSession.getMessageQueue();
    
    // Count any messages that were reset from processing to pending
    const processingBefore = queueBefore.filter(m => m.status === 'processing').length;
    const pendingAfter = queueAfter.filter(m => m.status === 'pending').length;
    const pendingBefore = queueBefore.filter(m => m.status === 'pending').length;
    const resetCount = Math.max(0, pendingAfter - pendingBefore);
    
    console.log(`📊 Messages reset to pending: ${resetCount}`);
    
    res.json({
      success: true,
      message: 'Claude session stopped successfully',
      statusBefore: {
        sessionReady: statusBefore.sessionReady,
        currentlyProcessing: statusBefore.currentlyProcessing,
        processAlive: statusBefore.processAlive
      },
      statusAfter: statusAfter,
      queueInfo: {
        totalMessages: queueAfter.length,
        pendingMessages: queueAfter.filter(m => m.status === 'pending').length,
        completedMessages: queueAfter.filter(m => m.status === 'completed').length,
        errorMessages: queueAfter.filter(m => m.status === 'error').length,
        resetCount: resetCount
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Failed to stop Claude session:', error);
    res.status(500).json({
      success: false,
      error: `Failed to stop Claude session: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }
});

router.get('/claude/status', (req, res) => {
  res.json({
    success: true,
    status: claudeSession.getStatus()
  });
});

// Claude 키 전송 (ESC, Enter 등)
router.post('/claude/keypress', (req, res) => {
  try {
    const { key } = req.body;
    
    if (!key || typeof key !== 'string') {
      return res.status(400).json({
        error: 'Key is required and must be a string'
      });
    }

    // 지원되는 키 목록
    const supportedKeys = ['escape', 'enter', 'up', 'down', 'left', 'right', 'space', 'tab'];
    
    if (!supportedKeys.includes(key)) {
      return res.status(400).json({
        error: `Unsupported key: ${key}. Supported keys: ${supportedKeys.join(', ')}`
      });
    }

    const claudeStatus = claudeSession.getStatus();
    
    if (!claudeStatus.sessionReady) {
      return res.status(400).json({
        error: 'Claude session not ready. Start session first.'
      });
    }

    claudeSession.sendKeyToClaudeProcess(key);
    
    res.json({
      success: true,
      message: `Key '${key}' sent to Claude successfully`,
      key: key,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Failed to send keypress:', error);
    res.status(500).json({
      error: `Failed to send keypress: ${error.message}`
    });
  }
});

// Settings management endpoints
// Get settings
router.get('/settings', (req, res) => {
  try {
    const settings = loadSettings();
    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('❌ Failed to get settings:', error);
    res.status(500).json({
      error: `Failed to get settings: ${error.message}`
    });
  }
});

// Update project home path
router.put('/settings/home-path', (req, res) => {
  try {
    const { projectHomePath } = req.body;
    
    if (!projectHomePath || typeof projectHomePath !== 'string') {
      return res.status(400).json({
        error: 'projectHomePath is required and must be a string'
      });
    }

    // Validate path exists
    if (!fs.existsSync(projectHomePath)) {
      return res.status(400).json({
        error: 'The specified path does not exist'
      });
    }

    // Check if path is a directory
    const stats = fs.statSync(projectHomePath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        error: 'The specified path is not a directory'
      });
    }

    const settings = loadSettings();
    const oldPath = settings.projectHomePath;
    settings.projectHomePath = projectHomePath;
    
    // 새로운 경로가 다르면 최근 경로에 추가
    if (oldPath !== projectHomePath) {
      addToRecentPaths(settings, projectHomePath);
    }
    
    const saved = saveSettings(settings);
    if (!saved) {
      return res.status(500).json({
        error: 'Failed to save settings'
      });
    }

    // Update Claude session manager's working directory if changed
    if (oldPath !== projectHomePath) {
      claudeSession.setWorkingDirectory(projectHomePath);
    }

    // Broadcast settings update
    broadcastToClients({
      type: 'settings-update',
      data: { settings }
    });

    res.json({
      success: true,
      message: 'Project home path updated successfully',
      settings
    });
  } catch (error) {
    console.error('❌ Failed to update project home path:', error);
    res.status(500).json({
      error: `Failed to update project home path: ${error.message}`
    });
  }
});

// Tasks management endpoint
// Get tasks from SQLite database
router.get('/tasks', async (req, res) => {
  try {
    const settings = loadSettings();
    const projectHomePath = settings.projectHomePath;
    const dbPath = path.join(projectHomePath, 'docs', 'tasks.db');
    
    // Check if SQLite database exists
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({
        error: 'tasks.db not found in project docs directory',
        path: dbPath,
        projectHomePath
      });
    }

    // Initialize SQLite manager if needed
    if (!sqliteManager.getDB()) {
      await sqliteManager.initDB(projectHomePath);
    }

    // Get all tasks from SQLite in JSON-compatible format
    const tasksData = await sqliteManager.getAllTasks();
    
    res.json({
      success: true,
      projectHomePath,
      dbPath,
      ...tasksData
    });
  } catch (error) {
    console.error('❌ Failed to load tasks:', error);
    res.status(500).json({
      error: `Failed to load tasks: ${error.message}`,
      projectHomePath: loadSettings().projectHomePath
    });
  }
});

// Delete task by ID
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const settings = loadSettings();
    const projectHomePath = settings.projectHomePath;
    const dbPath = path.join(projectHomePath, 'docs', 'tasks.db');
    
    // Check if SQLite database exists
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({
        error: 'tasks.db not found in project docs directory',
        path: dbPath,
        projectHomePath
      });
    }

    // Initialize SQLite manager if needed
    if (!sqliteManager.getDB()) {
      await sqliteManager.initDB(projectHomePath);
    }

    // Delete task from SQLite database
    const result = await sqliteManager.deleteTask(id);
    
    // Get remaining task count efficiently
    const remainingTasks = await sqliteManager.getTaskCount();
    
    res.json({
      success: true,
      deletedTask: result.deletedTask,
      remainingTasks: remainingTasks
    });
  } catch (error) {
    console.error('❌ Failed to delete task:', error);
    
    // Handle specific error cases
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
        projectHomePath: loadSettings().projectHomePath
      });
    }
    
    res.status(500).json({
      error: `Failed to delete task: ${error.message}`,
      projectHomePath: loadSettings().projectHomePath
    });
  }
});

// Delete subtask by task ID and subtask ID
router.delete('/tasks/:taskId/subtasks/:subtaskId', async (req, res) => {
  try {
    const { taskId, subtaskId } = req.params;
    const settings = loadSettings();
    const projectHomePath = settings.projectHomePath;
    const dbPath = path.join(projectHomePath, 'docs', 'tasks.db');
    
    // Check if SQLite database exists
    if (!fs.existsSync(dbPath)) {
      return res.status(404).json({
        error: 'tasks.db not found in project docs directory',
        path: dbPath,
        projectHomePath
      });
    }

    // Initialize SQLite manager if needed
    if (!sqliteManager.getDB()) {
      await sqliteManager.initDB(projectHomePath);
    }

    // Delete subtask from SQLite database
    const result = await sqliteManager.deleteSubtask(taskId, subtaskId);
    
    // Get remaining subtask count efficiently
    const remainingSubtasks = await sqliteManager.getSubtaskCount(taskId);
    
    res.json({
      success: true,
      deletedSubtask: result.deletedSubtask,
      remainingSubtasks: remainingSubtasks
    });
  } catch (error) {
    console.error('❌ Failed to delete subtask:', error);
    
    // Handle specific error cases
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
        projectHomePath: loadSettings().projectHomePath
      });
    }
    
    res.status(500).json({
      error: `Failed to delete subtask: ${error.message}`,
      projectHomePath: loadSettings().projectHomePath
    });
  }
});

// Directory browser endpoints
// List directories in a given path
router.get('/directories', (req, res) => {
  try {
    const { path: requestedPath } = req.query;
    const targetPath = requestedPath || process.env.HOME || process.cwd();
    
    if (!fs.existsSync(targetPath)) {
      return res.status(400).json({
        error: 'Path does not exist'
      });
    }

    const stats = fs.statSync(targetPath);
    if (!stats.isDirectory()) {
      return res.status(400).json({
        error: 'Path is not a directory'
      });
    }

    const items = fs.readdirSync(targetPath, { withFileTypes: true });
    const directories = items
      .filter(item => item.isDirectory() && !item.name.startsWith('.'))
      .map(item => ({
        name: item.name,
        path: path.join(targetPath, item.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Add parent directory option if not at root
    const parentPath = path.dirname(targetPath);
    const canGoUp = parentPath !== targetPath;

    res.json({
      success: true,
      currentPath: targetPath,
      canGoUp,
      parentPath: canGoUp ? parentPath : null,
      directories
    });
  } catch (error) {
    console.error('❌ Failed to list directories:', error);
    res.status(500).json({
      error: `Failed to list directories: ${error.message}`
    });
  }
});

// Handle working directory changes
claudeSession.on('working-directory-changed', (data) => {
  console.log(`📁 Working directory changed: ${data.oldDir} → ${data.newDir}`);
  
  // Broadcast working directory change to clients
  broadcastToClients({
    type: 'working-directory-changed',
    data: {
      oldDir: data.oldDir,
      newDir: data.newDir,
      messages: data.messageQueue,
      total: data.messageQueue.length
    }
  });
});

export default router;