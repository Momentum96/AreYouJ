// WebSocket connection management
import { WebSocket } from 'ws';
import { getClaudeSession } from '../claude/session-manager.js';
import { getCurrentClaudeOutput } from '../routes/api.js';
import { getSessionOrchestrator } from '../orchestration/session-orchestrator.js';

let connectedClients = new Set();
let heartbeatInterval = null;

// Session-aware client management
let clientSubscriptions = new Map(); // ws -> subscription config

// Heartbeat configuration
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const CLIENT_TIMEOUT = 60000; // 60 seconds

// Generate unique client ID
function generateClientId() {
  return Math.random().toString(36).substring(2, 10);
}

export function setupWebSocket(wss) {
  const claudeSession = getClaudeSession();
  const sessionOrchestrator = getSessionOrchestrator();
  
  // Setup Claude session event listeners for WebSocket broadcasting
  setupClaudeSessionEvents(claudeSession);
  
  // Setup SessionOrchestrator event listeners for multi-session management
  setupSessionOrchestratorEvents(sessionOrchestrator);
  
  // Setup heartbeat mechanism
  setupHeartbeat();
  
  wss.on('connection', (ws, req) => {
    console.log(`🔌 WebSocket client connected from ${req.socket.remoteAddress}`);
    
    // Initialize client metadata
    ws.isAlive = true;
    ws.lastPong = Date.now();
    
    connectedClients.add(ws);
    
    // Initialize session-aware subscription for this client
    clientSubscriptions.set(ws, {
      sessionFilters: new Set(['global']), // Default to global events
      channelFilters: new Set(['*']), // Subscribe to all channels by default
      eventBuffer: [], // Buffer events during reconnection
      metadata: {
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        clientId: generateClientId()
      }
    });
    
    // Get current Claude output from API routes module
    const currentClaudeOutput = getCurrentClaudeOutput();
    
    // Get current SessionOrchestrator state
    const sessionOrchestrator = getSessionOrchestrator();
    const orchestratorStats = sessionOrchestrator.getOrchestratorStats();
    const activeSessions = sessionOrchestrator.getAllActiveSessions();
    
    // Send welcome message with current session status AND current Claude output AND orchestrator state
    ws.send(JSON.stringify({
      type: 'connection',
      data: { 
        status: 'connected',
        clientId: clientSubscriptions.get(ws).metadata.clientId,
        claudeSession: claudeSession.getStatus(),
        initialOutput: currentClaudeOutput, // Claude-Autopilot style
        sessionOrchestrator: {
          stats: orchestratorStats,
          activeSessions: activeSessions
        }
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
      const subscription = clientSubscriptions.get(ws);
      const clientId = subscription?.metadata?.clientId || 'unknown';
      console.log(`🔌 WebSocket client ${clientId} disconnected (code: ${code}, reason: ${reason})`);
      
      // Clean up client subscription data
      connectedClients.delete(ws);
      clientSubscriptions.delete(ws);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      const subscription = clientSubscriptions.get(ws);
      const clientId = subscription?.metadata?.clientId || 'unknown';
      console.error(`WebSocket error for client ${clientId}:`, error);
      
      // Clean up client subscription data
      connectedClients.delete(ws);
      clientSubscriptions.delete(ws);
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
  clientSubscriptions.clear(); // Clean up subscription data
  console.log('🔌 WebSocket cleanup completed');
}

function setupClaudeSessionEvents(claudeSession) {
  // Legacy session ID for backward compatibility with single-session mode
  const LEGACY_SESSION_ID = 'legacy';
  
  // Session status events
  claudeSession.on('session-started', () => {
    broadcastToClients({ 
      type: 'session-status',
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
      data: { status: 'ready', sessionReady: true } 
    });
  });

  claudeSession.on('session-ended', (details) => {
    broadcastToClients({ 
      type: 'session-status',
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
      data: { status: 'stopped', sessionReady: false, details } 
    });
  });

  claudeSession.on('session-unhealthy', () => {
    broadcastToClients({ 
      type: 'session-status',
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
      data: { status: 'unhealthy', sessionReady: false } 
    });
  });

  // Claude output events
  claudeSession.on('claude-output', (output) => {
    broadcastToClients({ 
      type: 'claude-output',
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
      data: output 
    });
  });

  // Removed terminal-output event - Claude-Autopilot style uses direct claude-output

  // Message processing events
  claudeSession.on('message-started', (messageItem) => {
    broadcastToClients({ 
      type: 'message-status',
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
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
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
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
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
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
      sessionId: LEGACY_SESSION_ID, // Add sessionId for consistency
      data: errorText 
    });
  });
}

function setupSessionOrchestratorEvents(sessionOrchestrator) {
  // Session lifecycle events
  sessionOrchestrator.on('session-created', (data) => {
    broadcastToClients({
      type: 'session-created',
      sessionId: data.sessionId,
      data: data.metadata
    });
  });

  sessionOrchestrator.on('session-terminated', (data) => {
    broadcastToClients({
      type: 'session-terminated', 
      sessionId: data.sessionId,
      data: data.metadata
    });
  });

  // Session status changes (idle ↔ busy ↔ active)
  sessionOrchestrator.on('session-status-changed', (data) => {
    broadcastToClients({
      type: 'session-status-changed',
      sessionId: data.sessionId,
      data: {
        oldStatus: data.oldStatus,
        newStatus: data.newStatus,
        currentTask: data.currentTask || null,
        metadata: data.metadata,
        timestamp: data.timestamp
      }
    });
  });

  // Session list updates for Orchestration page
  sessionOrchestrator.on('session-list-update', (data) => {
    broadcastToClients({
      type: 'session-list-update',
      data: data
    });
  });

  // Session events (generic events from individual sessions)
  sessionOrchestrator.on('session-event', (data) => {
    broadcastToClients({
      type: 'session-event',
      sessionId: data.sessionId,
      data: {
        event: data.event,
        timestamp: data.timestamp,
        ...data
      }
    });
  });

  // Session output forwarding
  sessionOrchestrator.on('session-output', (data) => {
    broadcastToClients({
      type: 'claude-output',
      sessionId: data.sessionId,
      data: data.output,
      timestamp: data.timestamp
    });
  });

  // Session restoration events
  sessionOrchestrator.on('sessions-restored', (data) => {
    broadcastToClients({
      type: 'sessions-restored',
      data: data
    });
  });

  // Session creation failures
  sessionOrchestrator.on('session-creation-failed', (data) => {
    broadcastToClients({
      type: 'session-creation-failed',
      data: data
    });
  });

  // Session termination failures
  sessionOrchestrator.on('session-termination-failed', (data) => {
    broadcastToClients({
      type: 'session-termination-failed',
      sessionId: data.sessionId,
      data: data
    });
  });
}

function handleWebSocketMessage(ws, message) {
  const { type, data } = message;
  const subscription = clientSubscriptions.get(ws);
  
  if (!subscription) {
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Client subscription not found',
      timestamp: new Date().toISOString()
    }));
    return;
  }
  
  // Update last activity
  subscription.metadata.lastActivity = Date.now();
  
  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({
        type: 'pong',
        timestamp: new Date().toISOString()
      }));
      break;
      
    case 'subscribe':
      handleSubscriptionMessage(ws, data, subscription);
      break;
      
    case 'unsubscribe':
      handleUnsubscriptionMessage(ws, data, subscription);
      break;
      
    case 'reconnect':
      handleClientReconnect(ws, data, subscription);
      break;
      
    case 'get-session-state':
      handleGetSessionState(ws, data, subscription);
      break;
      
    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${type}`,
        timestamp: new Date().toISOString()
      }));
  }
}

// Handle client reconnection requests
function handleClientReconnect(ws, data, subscription) {
  try {
    const { lastEventTimestamp, requestedSessions } = data;
    
    console.log(`🔄 Client ${subscription.metadata.clientId} requesting reconnection with last event: ${lastEventTimestamp}`);
    
    // Reset client state for reconnection
    subscription.metadata.lastActivity = Date.now();
    subscription.metadata.reconnectedAt = Date.now();
    
    // Get current system state
    const claudeSession = getClaudeSession();
    const sessionOrchestrator = getSessionOrchestrator();
    const currentClaudeOutput = getCurrentClaudeOutput();
    
    // Send reconnection response with full state
    ws.send(JSON.stringify({
      type: 'reconnected',
      data: {
        status: 'reconnected',
        clientId: subscription.metadata.clientId,
        claudeSession: claudeSession.getStatus(),
        currentOutput: currentClaudeOutput,
        sessionOrchestrator: {
          stats: sessionOrchestrator.getOrchestratorStats(),
          activeSessions: sessionOrchestrator.getAllActiveSessions()
        },
        subscriptions: {
          sessionFilters: Array.from(subscription.sessionFilters),
          channelFilters: Array.from(subscription.channelFilters)
        }
      },
      timestamp: new Date().toISOString()
    }));
    
    // If client requests specific session states, send them
    if (requestedSessions && Array.isArray(requestedSessions)) {
      requestedSessions.forEach(sessionId => {
        const sessionDetails = sessionOrchestrator.getSessionDetails(sessionId);
        if (sessionDetails) {
          ws.send(JSON.stringify({
            type: 'session-state',
            sessionId: sessionId,
            data: sessionDetails,
            timestamp: new Date().toISOString()
          }));
        }
      });
    }
    
    // Send any buffered events (if eventBuffer had been used)
    if (subscription.eventBuffer && subscription.eventBuffer.length > 0) {
      subscription.eventBuffer.forEach(bufferedEvent => {
        ws.send(JSON.stringify({
          ...bufferedEvent,
          isBuffered: true,
          timestamp: new Date().toISOString()
        }));
      });
      // Clear buffer after sending
      subscription.eventBuffer = [];
    }
    
    console.log(`✅ Client ${subscription.metadata.clientId} reconnected successfully`);
    
  } catch (error) {
    console.error(`❌ Reconnection failed for client:`, error);
    ws.send(JSON.stringify({
      type: 'error',
      message: `Reconnection failed: ${error.message}`,
      timestamp: new Date().toISOString()
    }));
  }
}

// Handle session state requests
function handleGetSessionState(ws, data, subscription) {
  try {
    const { sessionId } = data || {};
    
    if (!sessionId) {
      // Send all active sessions if no specific session requested
      const sessionOrchestrator = getSessionOrchestrator();
      const allSessions = sessionOrchestrator.getAllActiveSessions();
      const stats = sessionOrchestrator.getOrchestratorStats();
      
      ws.send(JSON.stringify({
        type: 'session-list-state',
        data: {
          sessions: allSessions,
          statistics: stats
        },
        timestamp: new Date().toISOString()
      }));
      
    } else {
      // Send specific session details
      const sessionOrchestrator = getSessionOrchestrator();
      const sessionDetails = sessionOrchestrator.getSessionDetails(sessionId);
      
      if (sessionDetails) {
        ws.send(JSON.stringify({
          type: 'session-state',
          sessionId: sessionId,
          data: sessionDetails,
          timestamp: new Date().toISOString()
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: `Session ${sessionId} not found`,
          timestamp: new Date().toISOString()
        }));
      }
    }
    
  } catch (error) {
    console.error(`❌ Get session state failed:`, error);
    ws.send(JSON.stringify({
      type: 'error',
      message: `Failed to get session state: ${error.message}`,
      timestamp: new Date().toISOString()
    }));
  }
}

// Handle subscription requests
function handleSubscriptionMessage(ws, data, subscription) {
  const { sessionIds, channels } = data;
  
  try {
    // Handle session ID subscriptions
    if (sessionIds) {
      if (sessionIds === 'all' || sessionIds === '*') {
        subscription.sessionFilters.add('*'); // Subscribe to all sessions
      } else if (Array.isArray(sessionIds)) {
        sessionIds.forEach(sessionId => {
          subscription.sessionFilters.add(sessionId);
        });
      } else if (typeof sessionIds === 'string') {
        subscription.sessionFilters.add(sessionIds);
      }
    }
    
    // Handle channel subscriptions
    if (channels) {
      if (Array.isArray(channels)) {
        channels.forEach(channel => {
          subscription.channelFilters.add(channel);
        });
      } else if (typeof channels === 'string') {
        subscription.channelFilters.add(channels);
      }
    }
    
    // Send confirmation
    ws.send(JSON.stringify({
      type: 'subscribed',
      data: {
        sessionFilters: Array.from(subscription.sessionFilters),
        channelFilters: Array.from(subscription.channelFilters)
      },
      timestamp: new Date().toISOString()
    }));
    
    console.log(`📡 Client ${subscription.metadata.clientId} subscribed to sessions: ${Array.from(subscription.sessionFilters)}`);
    
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Subscription failed: ${error.message}`,
      timestamp: new Date().toISOString()
    }));
  }
}

// Handle unsubscription requests
function handleUnsubscriptionMessage(ws, data, subscription) {
  const { sessionIds, channels } = data;
  
  try {
    // Handle session ID unsubscriptions
    if (sessionIds) {
      if (sessionIds === 'all' || sessionIds === '*') {
        subscription.sessionFilters.clear();
        subscription.sessionFilters.add('global'); // Keep global events
      } else if (Array.isArray(sessionIds)) {
        sessionIds.forEach(sessionId => {
          subscription.sessionFilters.delete(sessionId);
        });
      } else if (typeof sessionIds === 'string') {
        subscription.sessionFilters.delete(sessionIds);
      }
    }
    
    // Handle channel unsubscriptions
    if (channels) {
      if (Array.isArray(channels)) {
        channels.forEach(channel => {
          subscription.channelFilters.delete(channel);
        });
      } else if (typeof channels === 'string') {
        subscription.channelFilters.delete(channels);
      }
    }
    
    // Send confirmation
    ws.send(JSON.stringify({
      type: 'unsubscribed',
      data: {
        sessionFilters: Array.from(subscription.sessionFilters),
        channelFilters: Array.from(subscription.channelFilters)
      },
      timestamp: new Date().toISOString()
    }));
    
    console.log(`📡 Client ${subscription.metadata.clientId} unsubscribed from sessions: ${Array.from(subscription.sessionFilters)}`);
    
  } catch (error) {
    ws.send(JSON.stringify({
      type: 'error',
      message: `Unsubscription failed: ${error.message}`,
      timestamp: new Date().toISOString()
    }));
  }
}

// Debouncing mechanism for broadcasts
const broadcastQueue = new Map(); // message type -> {message, timeoutId}
const DEBOUNCE_DELAY = 300; // 300ms debounce

// Broadcast message to all connected clients with session filtering and debouncing
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
      _doBroadcastWithSessionFiltering(message);
      broadcastQueue.delete(message.type);
    }, DEBOUNCE_DELAY);
    
    broadcastQueue.set(message.type, { message, timeoutId });
    return;
  }
  
  // For non-debounced messages, broadcast immediately with session filtering
  _doBroadcastWithSessionFiltering(message);
}

// Internal function to perform actual broadcast with session filtering
function _doBroadcastWithSessionFiltering(message) {
  const messageString = JSON.stringify({
    ...message,
    timestamp: new Date().toISOString()
  });
  
  const deadConnections = [];
  let sentCount = 0;
  
  connectedClients.forEach(ws => {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        const subscription = clientSubscriptions.get(ws);
        
        // Check if client should receive this message based on session filtering
        if (shouldClientReceiveMessage(message, subscription)) {
          ws.send(messageString);
          sentCount++;
        }
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
    clientSubscriptions.delete(ws);
  });
  
  if (deadConnections.length > 0) {
    console.log(`🧹 Removed ${deadConnections.length} dead connections during broadcast`);
  }
  
  console.log(`📡 Broadcast ${message.type} to ${sentCount}/${connectedClients.size} clients`);
}

// Internal function to perform actual broadcast (legacy - for backward compatibility)
function _doBroadcast(message) {
  return _doBroadcastWithSessionFiltering(message);
}

// Determine if a client should receive a specific message based on their subscription
function shouldClientReceiveMessage(message, subscription) {
  if (!subscription) {
    return false; // No subscription info = no messages
  }
  
  const { sessionFilters, channelFilters } = subscription;
  const { sessionId, type, data } = message;
  
  // Check channel filters first
  const matchesChannel = channelFilters.has('*') || 
                        channelFilters.has(type) ||
                        Array.from(channelFilters).some(filter => type.includes(filter));
                        
  if (!matchesChannel) {
    return false;
  }
  
  // For messages without sessionId, treat as global events
  if (!sessionId) {
    return sessionFilters.has('global') || sessionFilters.has('*');
  }
  
  // For messages with sessionId, check session filters
  return sessionFilters.has('*') || 
         sessionFilters.has(sessionId) ||
         sessionFilters.has('global'); // Global always gets events
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