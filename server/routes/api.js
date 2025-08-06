import express from 'express';
import { broadcastToClients } from '../websocket/index.js';
import { getClaudeSession } from '../claude/session-manager.js';

const router = express.Router();

// Simple in-memory storage (나중에 실제 구현으로 교체)
let messageQueue = [];
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

// Get Claude session instance
const claudeSession = getClaudeSession();

// Set up Claude session event handlers
claudeSession.on('session-started', () => {
  console.log('🎉 Claude session started successfully');
  broadcastToClients({
    type: 'claude-session',
    data: { status: 'started', ready: true }
  });
});

claudeSession.on('session-ended', () => {
  console.log('❌ Claude session ended');
  processingStatus.isProcessing = false;
  processingStatus.currentMessage = null;
  
  broadcastToClients({
    type: 'claude-session', 
    data: { status: 'ended', ready: false }
  });
  
  broadcastToClients({
    type: 'processing-stopped',
    data: { reason: 'Claude session ended' }
  });
});

claudeSession.on('message-started', (message) => {
  console.log(`📤 Claude processing message: ${message.id}`);
  
  // Update message status in queue
  const queueMessage = messageQueue.find(m => m.id === message.id);
  if (queueMessage) {
    queueMessage.status = 'processing';
    queueMessage.processingStartedAt = message.processingStartedAt;
  }
  
  processingStatus.currentMessage = message.id;
  
  broadcastToClients({
    type: 'queue-update',
    data: { messages: messageQueue, total: messageQueue.length }
  });
  
  broadcastToClients({
    type: 'message-processing',
    data: { messageId: message.id, status: 'started' }
  });
});

claudeSession.on('message-completed', (result) => {
  console.log(`✅ Claude completed message: ${result.id} (${result.status})`);
  
  // Update message in queue
  const queueMessage = messageQueue.find(m => m.id === result.id);
  if (queueMessage) {
    queueMessage.status = result.status;
    queueMessage.completedAt = result.completedAt;
    queueMessage.output = result.output || null;
    queueMessage.error = result.error || null;
  }
  
  processingStatus.currentMessage = null;
  processingStatus.isProcessing = false; // Mark as not processing
  
  if (result.status === 'completed') {
    processingStatus.completedMessages++;
  }
  
  broadcastToClients({
    type: 'queue-update',
    data: { messages: messageQueue, total: messageQueue.length }
  });
  
  broadcastToClients({
    type: 'message-completed',
    data: { 
      messageId: result.id, 
      status: result.status,
      output: result.output,
      error: result.error
    }
  });
  
  // Auto-process next message if available (Claude-Autopilot style)
  const claudeStatus = claudeSession.getStatus();
  const pendingMessages = messageQueue.filter(m => m.status === 'pending');
  const processingMessages = messageQueue.filter(m => m.status === 'processing');
  
  if (claudeStatus.sessionReady && pendingMessages.length > 0 && processingMessages.length === 0) {
    console.log('🔄 Auto-processing next message in queue...');
    
    const nextMessage = pendingMessages[0];
    processingStatus.isProcessing = true;
    processingStatus.currentMessage = nextMessage.id;
    
    // Process next message after a short delay
    setTimeout(async () => {
      try {
        await claudeSession.addToQueue(nextMessage);
        
        broadcastToClients({
          type: 'message-status',
          data: {
            messageId: nextMessage.id,
            status: 'processing',
            autoProcessed: true
          }
        });
      } catch (error) {
        console.error('❌ Failed to auto-process next message:', error);
        processingStatus.isProcessing = false;
        processingStatus.currentMessage = null;
      }
    }, 500); // Small delay between messages
    
  } else if (pendingMessages.length === 0 && processingMessages.length === 0) {
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

claudeSession.on('error', (error) => {
  console.error('❌ Claude session error:', error.message);
  broadcastToClients({
    type: 'claude-error',
    data: { error: error.message, timestamp: new Date().toISOString() }
  });
});

// Get system status  
router.get('/status', (req, res) => {
  const claudeStatus = claudeSession.getStatus();
  
  res.json({
    status: claudeStatus.sessionReady ? 'ready' : 'not-ready',
    queue: {
      total: messageQueue.length,
      pending: messageQueue.filter(m => m.status === 'pending').length,
      processing: messageQueue.filter(m => m.status === 'processing').length,
      completed: messageQueue.filter(m => m.status === 'completed').length
    },
    processing: processingStatus,
    claude: {
      sessionReady: claudeStatus.sessionReady,
      isStarting: claudeStatus.isStarting,
      queueLength: claudeStatus.queueLength,
      currentlyProcessing: claudeStatus.currentlyProcessing,
      lastActivity: claudeStatus.lastActivity,
      processAlive: claudeStatus.processAlive
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

  messageQueue.push(newMessage);

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
        completed: messageQueue.filter(m => m.status === 'completed').length
      },
      processing: processingStatus
    }
  });

  // Auto-start processing if conditions are met (Claude-Autopilot style)
  const claudeStatus = claudeSession.getStatus();
  const hasProcessingMessages = messageQueue.some(m => m.status === 'processing');
  const hasPendingMessages = messageQueue.some(m => m.status === 'pending');
  
  const shouldAutoStart = (
    claudeStatus.sessionReady && 
    !hasProcessingMessages && 
    hasPendingMessages &&
    !processingStatus.isProcessing
  );
  
  if (shouldAutoStart) {
    console.log('🚀 Auto-starting message processing (session ready, has pending messages)');
    
    // Auto-process the first pending message
    processingStatus.isProcessing = true;
    processingStatus.currentMessage = newMessage.id;
    processingStatus.totalMessages = messageQueue.filter(m => m.status === 'pending').length;
    
    // Process message after a short delay
    setTimeout(async () => {
      try {
        await claudeSession.addToQueue(newMessage);
        
        broadcastToClients({
          type: 'processing-started',
          data: { 
            totalMessages: processingStatus.totalMessages,
            autoStarted: true
          }
        });
      } catch (error) {
        console.error('❌ Auto-start failed:', error);
        processingStatus.isProcessing = false;
        processingStatus.currentMessage = null;
      }
    }, 200);
  }

  res.json({
    success: true,
    message: 'Message added to queue',
    messageId: newMessage.id,
    queueLength: messageQueue.length,
    autoProcessing: shouldAutoStart
  });
});

// Delete message from queue
router.delete('/queue/:id', (req, res) => {
  const { id } = req.params;
  const messageIndex = messageQueue.findIndex(m => m.id === id);
  
  if (messageIndex === -1) {
    return res.status(404).json({
      error: 'Message not found'
    });
  }

  const deletedMessage = messageQueue.splice(messageIndex, 1)[0];
  
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
        completed: messageQueue.filter(m => m.status === 'completed').length
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
  const clearedCount = messageQueue.length;
  messageQueue = [];
  
  // Also clear Claude output buffer
  claudeOutputBuffer = '';
  claudeCurrentScreen = '';
  lastClaudeOutputTime = 0;
  
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
        completed: messageQueue.filter(m => m.status === 'completed').length
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
    
    await claudeSession.addToQueue(nextMessage);
    
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
          completed: messageQueue.filter(m => m.status === 'completed').length
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

export default router;