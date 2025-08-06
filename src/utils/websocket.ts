type WebSocketMessage = {
  type: string;
  data?: any;
  timestamp?: string;
  message?: string;
};

type MessageHandler = (message: WebSocketMessage) => void;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30000; // Max 30 seconds
  private isConnecting = false;
  private shouldReconnect = true;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private pongTimeout: NodeJS.Timeout | null = null;
  private messageQueue: Array<{type: string, data?: any}> = [];
  private maxQueueSize = 100;

  constructor(private url: string = 'ws://localhost:3001') {}

  connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          console.log('🔌 WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          
          // Start heartbeat
          this.startHeartbeat();
          
          // Process queued messages
          this.processMessageQueue();
          
          this.emit('connection', { status: 'connected' });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            
            // Handle pong responses for heartbeat
            if (message.type === 'pong') {
              this.handlePong();
              return;
            }
            
            this.handleMessage(message);
          } catch (error) {
            console.error('Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('🔌 WebSocket disconnected:', event.code, event.reason);
          this.isConnecting = false;
          this.cleanup();
          
          this.emit('connection', { 
            status: 'disconnected', 
            code: event.code, 
            reason: event.reason,
            attempts: this.reconnectAttempts 
          });
          
          if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error(`🔌 Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
            this.emit('connection', { status: 'failed', maxAttemptsReached: true });
          }
        };

        this.ws.onerror = (error) => {
          console.error('🔌 WebSocket error:', error);
          this.isConnecting = false;
          this.emit('connection', { status: 'error' });
          reject(error);
        };

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    
    // Exponential backoff with jitter
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 1000,
      this.maxReconnectDelay
    );
    
    console.log(`🔌 Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${Math.round(delay)}ms`);
    
    this.reconnectTimeout = setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect().catch((error) => {
          console.error('🔌 Reconnect failed:', error);
          if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.emit('connection', { status: 'failed' });
          }
        });
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    // Send ping every 30 seconds
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping');
        
        // Set timeout for pong response (5 seconds)
        this.pongTimeout = setTimeout(() => {
          console.warn('🔌 Pong timeout - connection may be dead');
          if (this.ws) {
            this.ws.close(1000, 'Ping timeout');
          }
        }, 5000);
      }
    }, 30000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private handlePong(): void {
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  private processMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift();
      if (message) {
        this.ws.send(JSON.stringify(message));
      }
    }
  }

  private queueMessage(type: string, data?: any): void {
    if (this.messageQueue.length >= this.maxQueueSize) {
      // Remove oldest message to make room
      this.messageQueue.shift();
    }
    this.messageQueue.push({ type, data });
  }

  private handleMessage(message: WebSocketMessage): void {
    const handlers = this.handlers.get(message.type) || [];
    handlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('WebSocket message handler error:', error);
      }
    });
  }

  on(type: string, handler: MessageHandler): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, []);
    }
    this.handlers.get(type)!.push(handler);
  }

  off(type: string, handler?: MessageHandler): void {
    if (!handler) {
      this.handlers.delete(type);
    } else {
      const handlers = this.handlers.get(type) || [];
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit(type: string, data: any): void {
    this.handleMessage({ type, data });
  }

  send(type: string, data?: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type, data }));
        return true;
      } catch (error) {
        console.error('Failed to send WebSocket message:', error);
        return false;
      }
    } else {
      // Queue message for when connection is restored
      if (this.shouldReconnect && type !== 'ping') {
        console.warn('WebSocket is not connected. Queueing message:', { type, data });
        this.queueMessage(type, data);
      } else {
        console.warn('WebSocket is not connected. Message discarded:', { type, data });
      }
      return false;
    }
  }

  disconnect(): void {
    console.log('🔌 Manually disconnecting WebSocket');
    this.shouldReconnect = false;
    this.cleanup();
    
    if (this.ws) {
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
    
    // Clear message queue
    this.messageQueue = [];
    this.reconnectAttempts = 0;
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  getConnectionState(): string {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'disconnected';
      default: return 'unknown';
    }
  }

  getConnectionInfo(): {
    state: string;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    isReconnecting: boolean;
    queuedMessages: number;
    url: string;
  } {
    return {
      state: this.getConnectionState(),
      reconnectAttempts: this.reconnectAttempts,
      maxReconnectAttempts: this.maxReconnectAttempts,
      isReconnecting: this.reconnectTimeout !== null,
      queuedMessages: this.messageQueue.length,
      url: this.url
    };
  }

  // Force reconnect manually
  forceReconnect(): Promise<void> {
    console.log('🔌 Force reconnecting WebSocket');
    this.shouldReconnect = true;
    this.reconnectAttempts = 0; // Reset attempts
    
    if (this.ws) {
      this.ws.close(1000, 'Force reconnect');
    }
    
    return this.connect();
  }
}

// Global WebSocket instance
export const wsClient = new WebSocketClient();