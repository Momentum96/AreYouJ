// WebSocket connection management
import { WebSocket } from 'ws';
import { getClaudeSession } from '../claude/session-manager.js';
import { getCurrentClaudeOutput } from '../routes/api.js';

let connectedClients = new Set();
let heartbeatInterval = null;

// Heartbeat configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CLIENT_TIMEOUT = 60000; // 60 seconds

export function setupWebSocket(wss) {
  const claudeSession = getClaudeSession();
  
  // Setup Claude session event listeners for WebSocket broadcasting
  setupClaudeSessionEvents(claudeSession);
  
  // Setup heartbeat mechanism
  setupHeartbeat();
  
  wss.on('connection', (ws, req) => {
    console.log(`🔌 WebSocket client connected from ${req.socket.remoteAddress}`);
    
    // Initialize client metadata
    ws.isAlive = true;
    ws.lastPong = Date.now();
    
    connectedClients.add(ws);
    
    // Get current Claude output from API routes module
    const currentClaudeOutput = getCurrentClaudeOutput();
    
    // Send welcome message with current session status AND current Claude output
    ws.send(JSON.stringify({
      type: 'connection',
      data: { 
        status: 'connected',
        claudeSession: claudeSession.getStatus(),
        initialOutput: currentClaudeOutput // Claude-Autopilot style
      },
      timestamp: new Date().toISOString()
    }));
    
    // Handle messages from client
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleWebSocketMessage(ws, message);
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format',
          timestamp: new Date().toISOString()
        }));
      }
    });
    
    // Handle pong responses for heartbeat
    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastPong = Date.now();
    });
    
    // Handle client disconnect
    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket client disconnected (code: ${code}, reason: ${reason})`);
      connectedClients.delete(ws);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connectedClients.delete(ws);
    });
  });
}

// Setup heartbeat mechanism to detect dead connections
function setupHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const deadConnections = [];
    
    connectedClients.forEach(ws => {
      if (!ws.isAlive || (now - ws.lastPong) > CLIENT_TIMEOUT) {
        console.log('🔌 Detected dead WebSocket connection, terminating...');
        deadConnections.push(ws);
        return;
      }
      
      // Send ping to check if connection is still alive
      ws.isAlive = false;
      try {
        ws.ping();
      } catch (error) {
        console.error('Failed to ping WebSocket client:', error);
        deadConnections.push(ws);
      }
    });
    
    // Clean up dead connections gracefully
    deadConnections.forEach(ws => {
      try {
        // Try graceful close first
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1001, 'Connection timeout');
          
          // Fallback to terminate after short delay if close doesn't work
          setTimeout(() => {
            if (ws.readyState !== WebSocket.CLOSED) {
              ws.terminate();
            }
          }, 1000);
        } else {
          ws.terminate();
        }
      } catch (error) {
        console.error('Error closing dead connection:', error);
        try {
          ws.terminate();
        } catch (terminateError) {
          console.error('Error terminating connection:', terminateError);
        }
      }
      connectedClients.delete(ws);
    });
    
    if (deadConnections.length > 0) {
      console.log(`🧹 Cleaned up ${deadConnections.length} dead WebSocket connections`);
    }
  }, HEARTBEAT_INTERVAL);
}

// Cleanup function for graceful shutdown
export function cleanupWebSocket() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  
  connectedClients.forEach(ws => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1001, 'Server shutting down');
      }
    } catch (error) {
      console.error('Error closing WebSocket connection:', error);
    }
  });
  
  connectedClients.clear();
  console.log('🔌 WebSocket cleanup completed');
}

function setupClaudeSessionEvents(claudeSession) {
  // Session status events
  claudeSession.on('session-started', () => {
    broadcastToClients({ 
      type: 'session-status', 
      data: { status: 'ready', sessionReady: true } 
    });
  });

  claudeSession.on('session-ended', (details) => {
    broadcastToClients({ 
      type: 'session-status', 
      data: { status: 'stopped', sessionReady: false, details } 
    });
  });

  claudeSession.on('session-unhealthy', () => {
    broadcastToClients({ 
      type: 'session-status', 
      data: { status: 'unhealthy', sessionReady: false } 
    });
  });

  // Claude output events
  claudeSession.on('claude-output', (output) => {
    broadcastToClients({ 
      type: 'claude-output', 
      data: output 
    });
  });

  // Removed terminal-output event - Claude-Autopilot style uses direct claude-output

  // Message processing events
  claudeSession.on('message-started', (messageItem) => {
    broadcastToClients({ 
      type: 'message-status', 
      data: { 
        messageId: messageItem.id, 
        status: 'processing',
        message: messageItem
      } 
    });
  });

  claudeSession.on('message-completed', (result) => {
    broadcastToClients({ 
      type: 'message-status', 
      data: { 
        messageId: result.id, 
        status: result.status,
        result: result
      } 
    });
  });

  // Error events
  claudeSession.on('error', (error) => {
    broadcastToClients({ 
      type: 'session-error', 
      data: { 
        message: error.message,
        stack: error.stack
      } 
    });
  });

  // Process errors
  claudeSession.on('process-error', (errorText) => {
    broadcastToClients({ 
      type: 'process-error', 
      data: errorText 
    });
  });
}

function handleWebSocketMessage(ws, message) {
  const { type, data } = message;
  
  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString()
      }));
      break;
      
    case 'subscribe':
      // Handle subscription to specific events
      ws.send(JSON.stringify({
        type: 'subscribed',
        channel: data.channel,
        timestamp: new Date().toISOString()
      }));
      break;
      
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`,
        timestamp: new Date().toISOString()
      }));
  }
}

// Debouncing mechanism for broadcasts
const broadcastQueue = new Map(); // message type -> {message, timeoutId}
const DEBOUNCE_DELAY = 300; // 300ms debounce

// Broadcast message to all connected clients with debouncing
export function broadcastToClients(message) {
  if (connectedClients.size === 0) {
    return; // No clients to broadcast to
  }

  // For certain message types, apply debouncing
  const debouncedTypes = ['task-update', 'tasks-reloaded', 'subtask-update', 'task-deleted', 'subtask-deleted'];
  
  if (debouncedTypes.includes(message.type)) {
    const existingBroadcast = broadcastQueue.get(message.type);
    
    // Clear existing timeout if any
    if (existingBroadcast) {
      clearTimeout(existingBroadcast.timeoutId);
    }
    
    // Set new timeout
    const timeoutId = setTimeout(() => {
      _doBroadcast(message);
      broadcastQueue.delete(message.type);
    }, DEBOUNCE_DELAY);
    
    broadcastQueue.set(message.type, { message, timeoutId });
    return;
  }
  
  // For non-debounced messages, broadcast immediately
  _doBroadcast(message);
}

// Internal function to perform actual broadcast
function _doBroadcast(message) {
  const messageString = JSON.stringify({
    ...message,
    timestamp: new Date().toISOString()
  });
  
  const deadConnections = [];
  
  connectedClients.forEach(ws => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(messageString);
      } else if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        deadConnections.push(ws);
      }
    } catch (error) {
      console.error('Error broadcasting to WebSocket client:', error);
      deadConnections.push(ws);
    }
  });
  
  // Clean up dead connections
  deadConnections.forEach(ws => {
    connectedClients.delete(ws);
  });
  
  if (deadConnections.length > 0) {
    console.log(`🧹 Removed ${deadConnections.length} dead connections during broadcast`);
  }
}

// Send message to specific client
export function sendToClient(ws, message) {
  try {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...message,
        timestamp: new Date().toISOString()
      }));
      return true;
    } else {
      console.warn('Attempted to send message to non-open WebSocket connection');
      return false;
    }
  } catch (error) {
    console.error('Error sending message to WebSocket client:', error);
    // Remove from connected clients if it's in the set
    if (connectedClients.has(ws)) {
      connectedClients.delete(ws);
    }
    return false;
  }
}