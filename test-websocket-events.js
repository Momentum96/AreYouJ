#!/usr/bin/env node

/**
 * WebSocket Multi-Session Event Testing Script
 * 
 * Tests the session-aware WebSocket event system for Task 2.2
 * - Connects multiple WebSocket clients
 * - Tests session filtering and subscription management
 * - Validates SessionOrchestrator event broadcasting
 */

import { WebSocket } from 'ws';
import readline from 'readline';

const SERVER_URL = 'ws://localhost:5001';
const TEST_CLIENTS = [];

// ANSI colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  const timestamp = new Date().toISOString();
  console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

function createTestClient(clientName, sessionFilters = ['*'], channelFilters = ['*']) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    const client = {
      name: clientName,
      ws: ws,
      receivedEvents: [],
      sessionFilters: sessionFilters,
      channelFilters: channelFilters
    };
    
    ws.on('open', () => {
      log(`🔌 Client ${clientName} connected to server`, 'green');
      
      // Subscribe to specific sessions and channels
      ws.send(JSON.stringify({
        type: 'subscribe',
        data: {
          sessionIds: sessionFilters,
          channels: channelFilters
        }
      }));
      
      resolve(client);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        client.receivedEvents.push({
          ...message,
          receivedAt: Date.now()
        });
        
        // Log interesting events
        if (['session-created', 'session-terminated', 'session-status-changed', 'session-list-update'].includes(message.type)) {
          log(`📨 ${clientName} received: ${message.type} (sessionId: ${message.sessionId || 'none'})`, 'cyan');
        }
        
        if (message.type === 'connection') {
          log(`✅ ${clientName} connected with clientId: ${message.data.clientId}`, 'blue');
        }
        
      } catch (error) {
        log(`❌ ${clientName} failed to parse message: ${error.message}`, 'red');
      }
    });
    
    ws.on('error', (error) => {
      log(`❌ ${clientName} error: ${error.message}`, 'red');
      reject(error);
    });
    
    ws.on('close', () => {
      log(`🔌 Client ${clientName} disconnected`, 'yellow');
    });
    
    return client;
  });
}

async function testMultipleClients() {
  log('🚀 Starting WebSocket Multi-Session Event Test', 'magenta');
  
  try {
    // Create test clients with different subscription patterns
    const clients = await Promise.all([
      createTestClient('OrchestrationClient', ['*'], ['session-list-update', 'session-created', 'session-terminated']),
      createTestClient('SessionAClient', ['session-a'], ['*']),
      createTestClient('SessionBClient', ['session-b'], ['*']),
      createTestClient('LegacyClient', ['legacy'], ['*']),
      createTestClient('GlobalClient', ['global'], ['*'])
    ]);
    
    TEST_CLIENTS.push(...clients);
    
    log(`📡 Created ${clients.length} test clients with different subscription patterns`, 'green');
    
    // Wait a bit for subscriptions to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test session state requests
    log('🔍 Testing session state requests...', 'blue');
    clients[0].ws.send(JSON.stringify({
      type: 'get-session-state'
    }));
    
    // Test reconnection functionality
    log('🔄 Testing reconnection functionality...', 'blue');
    clients[1].ws.send(JSON.stringify({
      type: 'reconnect',
      data: {
        lastEventTimestamp: Date.now() - 60000, // 1 minute ago
        requestedSessions: ['session-a']
      }
    }));
    
    log('✅ Initial tests completed. Server should now broadcast events.', 'green');
    log('💡 You can now:', 'yellow');
    log('   - Start new Claude sessions from the UI', 'yellow');
    log('   - Terminate sessions', 'yellow');
    log('   - Process messages to see status changes', 'yellow');
    log('   - Check that events are filtered correctly per client', 'yellow');
    
  } catch (error) {
    log(`❌ Test setup failed: ${error.message}`, 'red');
    process.exit(1);
  }
}

function printEventSummary() {
  log('\n📊 Event Summary by Client:', 'magenta');
  
  TEST_CLIENTS.forEach(client => {
    const eventCounts = {};
    client.receivedEvents.forEach(event => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    });
    
    log(`${client.name}:`, 'cyan');
    log(`  Subscriptions: sessions=${JSON.stringify(client.sessionFilters)}, channels=${JSON.stringify(client.channelFilters)}`, 'blue');
    log(`  Total events: ${client.receivedEvents.length}`, 'blue');
    Object.entries(eventCounts).forEach(([eventType, count]) => {
      log(`  - ${eventType}: ${count}`, 'blue');
    });
    log('');
  });
}

function cleanup() {
  log('🧹 Cleaning up test clients...', 'yellow');
  TEST_CLIENTS.forEach(client => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.close();
    }
  });
  printEventSummary();
  process.exit(0);
}

// Setup graceful shutdown
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Setup interactive commands
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', (input) => {
  const command = input.trim().toLowerCase();
  
  switch (command) {
    case 'summary':
    case 's':
      printEventSummary();
      break;
    case 'quit':
    case 'q':
    case 'exit':
      cleanup();
      break;
    case 'help':
    case 'h':
      log('Available commands:', 'yellow');
      log('  summary (s) - Show event summary by client', 'blue');
      log('  quit (q)    - Exit and cleanup', 'blue');
      log('  help (h)    - Show this help', 'blue');
      break;
    default:
      log(`Unknown command: ${command}. Type 'help' for available commands.`, 'red');
  }
});

// Start the test
testMultipleClients().then(() => {
  log('\n💬 Interactive mode started. Type commands:', 'green');
  log('   summary - Show event counts per client', 'blue');
  log('   quit    - Exit test', 'blue');
  log('   help    - Show help', 'blue');
});