// WebSocket connection management
import { WebSocket } from 'ws';
import { getClaudeSession } from '../claude/session-manager.js';

let connectedClients = new Set();

export function setupWebSocket(wss) {
  const claudeSession = getClaudeSession();
  
  // Setup Claude session event listeners for WebSocket broadcasting
  setupClaudeSessionEvents(claudeSession);
  
  wss.on('connection', (ws, req) => {
    console.log(`🔌 WebSocket client connected from ${req.socket.remoteAddress}`);
    connectedClients.add(ws);
    
    // Send welcome message with current session status
    ws.send(JSON.stringify({
      type: 'connection',
      data: { 
        status: 'connected',
        claudeSession: claudeSession.getStatus()
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
    
    // Handle client disconnect
    ws.on('close', () => {
      console.log('🔌 WebSocket client disconnected');
      connectedClients.delete(ws);
    });
    
    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connectedClients.delete(ws);
    });
  });
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

  // Real-time terminal output (Claude-Autopilot style)
  claudeSession.on('terminal-output', (outputEvent) => {
    broadcastToClients({ 
      type: 'terminal-output', 
      data: outputEvent 
    });
  });

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

// Broadcast message to all connected clients
export function broadcastToClients(message) {
  const messageString = JSON.stringify({
    ...message,
    timestamp: new Date().toISOString()
  });
  
  connectedClients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(messageString);
    }
  });
}

// Send message to specific client
export function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      ...message,
      timestamp: new Date().toISOString()
    }));
  }
}