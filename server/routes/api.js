import express from 'express';
import fs from 'fs';
import path from 'path';
import { broadcastToClients } from '../websocket/index.js';
import { getClaudeSession } from '../claude/session-manager.js';

const router = express.Router();

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

claudeSession.on('session-ended', () => {
  console.log('❌ Claude session ended');
  processingStatus.isProcessing = false;
  processingStatus.currentMessage = null;
  
  broadcastToClients({
    type: 'processing-stopped',
    data: { reason: 'Claude session ended' }
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
    createdAt: new Date().toISOString(),
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
    await claudeSession.stop();
    
    res.json({
      success: true,
      message: 'Claude session stopped',
      status: claudeSession.getStatus()
    });
  } catch (error) {
    console.error('❌ Failed to stop Claude session:', error);
    res.status(500).json({
      error: `Failed to stop Claude session: ${error.message}`
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


export default router;