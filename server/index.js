import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import net from 'net';
import apiRoutes from './routes/api.js';
import { setupWebSocket } from './websocket/index.js';
import { getClaudeSession } from './claude/session-manager.js';

const app = express();
const BASE_PORT = parseInt(process.env.PORT) || 5001;

// Function to check if port is available
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    
    server.on('error', () => resolve(false));
  });
}

// Function to find available port
async function findAvailablePort(startPort) {
  let port = startPort;
  
  while (port < startPort + 100) { // Try up to 100 ports
    const isAvailable = await checkPortAvailable(port);
    if (isAvailable) {
      return port;
    }
    port++;
  }
  
  throw new Error(`No available ports found starting from ${startPort}`);
}

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'AreYouJ Backend'
  });
});

// Start server with automatic port resolution
async function startServer() {
  try {
    const PORT = await findAvailablePort(BASE_PORT);
    
    if (PORT !== BASE_PORT) {
      console.log(`⚠️  Port ${BASE_PORT} is in use, using port ${PORT} instead`);
    }
    
    // Create HTTP server
    const server = createServer(app);
    
    // Setup WebSocket
    const wss = new WebSocketServer({ server });
    setupWebSocket(wss);
    
    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('⚡ Trying to find another available port...');
        startServer(); // Retry with next available port
      } else {
        console.error('❌ Server error:', error);
        process.exit(1);
      }
    });
    
    server.listen(PORT, () => {
      console.log('🚀 AreYouJ Backend Server');
      console.log(`📡 HTTP Server: http://localhost:${PORT}`);
      console.log(`🔌 WebSocket Server: ws://localhost:${PORT}`);
      console.log('');
      console.log('🔧 Available endpoints:');
      console.log(`   GET  http://localhost:${PORT}/health`);
      console.log(`   GET  http://localhost:${PORT}/api/status`);
      console.log(`   POST http://localhost:${PORT}/api/queue/add`);
      console.log('');
      console.log('🛑 Press Ctrl+C to stop the server');
    });
    
    // Graceful shutdown - remove existing listeners first to prevent duplicates
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
    
    const shutdown = () => {
      console.log('\n⏹️  Shutting down server...');
      
      // Get Claude session and stop it first
      try {
        const claudeSession = getClaudeSession();
        if (claudeSession) {
          console.log('🛑 Stopping Claude session...');
          claudeSession.stop();
        }
      } catch (error) {
        console.log('Warning: Error stopping Claude session:', error.message);
      }
      
      server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
      });
      
      // Force exit after 5 seconds if server doesn't close gracefully
      setTimeout(() => {
        console.log('⚠️ Force exiting after 5 second timeout');
        process.exit(1);
      }, 5000);
    };
    
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Start the server
startServer();