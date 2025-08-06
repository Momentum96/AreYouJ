import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Plus, Play, Square, RotateCcw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { apiClient, type QueueMessage, type QueueStatus } from '../utils/api';
import { wsClient } from '../utils/websocket';
import { ClaudeTerminalRenderer } from '../utils/claude-terminal.js';

export const Automation = () => {
  const [messages, setMessages] = useState<QueueMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  // Claude Terminal Renderer (Claude-Autopilot style)
  const terminalRenderer = useRef<ClaudeTerminalRenderer>(new ClaudeTerminalRenderer());
  const terminalRef = useRef<HTMLDivElement>(null);

  // Initialize terminal renderer
  useEffect(() => {
    terminalRenderer.current = new ClaudeTerminalRenderer();
  }, []);

  // Initialize WebSocket connection and load initial data
  useEffect(() => {
    // Load initial data
    loadQueue();
    loadStatus();
    
    // Set up WebSocket event handlers first
    const handleConnection = (message) => {
      setWsConnected(message.data.status === 'connected');
      if (message.data.status === 'connected') {
        // Check if Claude session info is available
        if (message.data.claudeSession) {
          setSessionReady(message.data.claudeSession.sessionReady);
        }
        
        // Handle initial Claude output (Claude-Autopilot style)
        if (message.data.initialOutput && message.data.initialOutput.hasOutput && terminalRef.current && terminalRenderer.current) {
          console.log('🖥️ Rendering initial Claude output:', message.data.initialOutput);
          terminalRenderer.current.renderOutput(message.data.initialOutput.currentScreen, terminalRef.current);
        }
      }
    };

    const handleQueueUpdate = (message) => {
      setMessages(message.data.messages);
    };

    const handleStatusUpdate = (message) => {
      setStatus(message.data);
      setIsProcessing(message.data.processing.isProcessing);
    };

    const handleProcessingStarted = (message) => {
      // No UI feedback needed
    };

    const handleProcessingStopped = () => {
      // No UI feedback needed
    };

    // New Claude session event handlers
    const handleSessionStatus = (message) => {
      const { status, sessionReady: ready, details } = message.data;
      setSessionReady(ready || false);
    };

    // Removed handleTerminalOutput - Claude-Autopilot style uses only claude-output event

    const handleClaudeOutput = (message) => {
      // Claude-Autopilot style output handling - render to actual terminal
      if (message.data.cleared) {
        // Output was cleared
        if (terminalRef.current && terminalRenderer.current) {
          terminalRenderer.current.clear(terminalRef.current);
        }
      } else if (message.data.output) {
        // Render full Claude terminal output
        if (terminalRef.current && terminalRenderer.current) {
          terminalRenderer.current.renderOutput(message.data.output, terminalRef.current);
        }
      }
    };

    const handleMessageStatus = (message) => {
      // Message status changes handled silently  
    };

    const handleSessionError = (message) => {
      // Session errors handled silently
    };

    const handleProcessError = (message) => {
      const errorData = message.data;
      
      // Claude PTY JSON 로그는 정상적인 시스템 메시지이므로 무시
      if (errorData.includes('[PTY-JSON]') && errorData.includes('"type": "log"')) {
        // 정상적인 PTY 로그 - 무시하거나 디버그용으로만 표시
        if (process.env.NODE_ENV === 'development') {
          console.log('PTY Log:', errorData);
        }
        return;
      }
      
      // Real errors handled silently
    };

    // Register event handlers
    wsClient.on('connection', handleConnection);
    wsClient.on('queue-update', handleQueueUpdate);
    wsClient.on('status-update', handleStatusUpdate);
    wsClient.on('processing-started', handleProcessingStarted);
    wsClient.on('processing-stopped', handleProcessingStopped);
    
    // Claude session event handlers (Claude-Autopilot style)
    wsClient.on('session-status', handleSessionStatus);
    wsClient.on('claude-output', handleClaudeOutput);
    wsClient.on('message-status', handleMessageStatus);
    wsClient.on('session-error', handleSessionError);
    wsClient.on('process-error', handleProcessError);

    // Set up WebSocket connection
    const connectWebSocket = async () => {
      try {
        if (!wsClient.isConnected()) {
          await wsClient.connect();
          console.log('✅ WebSocket connected');
        }
      } catch (error) {
        console.error('❌ WebSocket connection failed:', error);
      }
    };

    connectWebSocket();

    // Cleanup on unmount - remove specific handlers
    return () => {
      wsClient.off('connection', handleConnection);
      wsClient.off('queue-update', handleQueueUpdate);
      wsClient.off('status-update', handleStatusUpdate);
      wsClient.off('processing-started', handleProcessingStarted);
      wsClient.off('processing-stopped', handleProcessingStopped);
      
      // Remove Claude session event handlers (Claude-Autopilot style)
      wsClient.off('session-status', handleSessionStatus);
      wsClient.off('claude-output', handleClaudeOutput);
      wsClient.off('message-status', handleMessageStatus);
      wsClient.off('session-error', handleSessionError);
      wsClient.off('process-error', handleProcessError);
      // Don't disconnect here to prevent React StrictMode issues
    };
  }, []);

  // Removed handleTerminalOutputEvent - Claude-Autopilot style uses direct terminal rendering



  const loadQueue = async () => {
    try {
      const response = await apiClient.getQueue();
      setMessages(response.messages);
      setError(null);
    } catch (error) {
      console.error('Failed to load queue:', error);
      setError('큐 데이터를 불러올 수 없습니다');
    }
  };

  const loadStatus = async () => {
    try {
      const response = await apiClient.getStatus();
      setStatus(response);
      setIsProcessing(response.processing.isProcessing);
      setError(null);
    } catch (error) {
      console.error('Failed to load status:', error);
      setError('상태 정보를 불러올 수 없습니다');
    }
  };

  const addMessage = async () => {
    if (!newMessage.trim() || isLoading) return;
    
    const messageText = newMessage.trim();
    setIsLoading(true);
    
    try {
      const response = await apiClient.addMessage(messageText);
      setNewMessage('');
      
      // Claude-Autopilot style: Auto-processing handled automatically
      
      // WebSocket이 연결되어 있으면 자동으로 업데이트되므로 수동 새로고침 불필요
      if (!wsConnected) {
        await loadQueue();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to add message:', error);
      setError('메시지 추가에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };


  const removeMessage = async (id: string) => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await apiClient.deleteMessage(id);
      if (!wsConnected) {
        await loadQueue();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to remove message:', error);
      setError('메시지 삭제에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const clearQueue = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await apiClient.clearQueue();
      if (!wsConnected) {
        await loadQueue();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to clear queue:', error);
      setError('큐 비우기에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const startProcessing = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    
    // Claude-Autopilot style: Only start session, not processing
    if (!sessionReady) {
      
      try {
        // Start session only (not processing)
        const response = await fetch('http://localhost:5001/api/session/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error('Failed to start session');
        }
        
        const data = await response.json();
        
        if (data.success) {
          setSessionReady(true);
        }
        
        setError(null);
      } catch (error) {
        console.error('Failed to start Claude session:', error);
        setError('Claude 세션 시작에 실패했습니다');
      }
    }
    
    setIsLoading(false);
  };

  const stopClaudeSession = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await apiClient.stopClaudeSession();
      setSessionReady(false);
      setIsProcessing(false);
      
      // 상태 업데이트가 WebSocket을 통해 자동으로 처리됨
      if (!wsConnected) {
        await loadStatus();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to stop Claude session:', error);
      setError('Claude 세션 종료에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: QueueMessage['status']) => {
    switch (status) {
      case 'pending': return 'bg-yellow-500';
      case 'processing': return 'bg-blue-500';
      case 'completed': return 'bg-green-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-gray-500';
    }
  };

  const getStatusText = (status: QueueMessage['status']) => {
    switch (status) {
      case 'pending': return '대기';
      case 'processing': return '처리중';
      case 'completed': return '완료';
      case 'error': return '오류';
      default: return '알 수 없음';
    }
  };

  const stats = status?.queue || {
    total: messages.length,
    pending: messages.filter(m => m.status === 'pending').length,
    processing: messages.filter(m => m.status === 'processing').length,
    completed: messages.filter(m => m.status === 'completed').length,
    error: messages.filter(m => m.status === 'error').length
  };

  return (
    <div className="w-full h-full flex flex-col p-6 gap-4">
      {/* Header Section */}
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-primary truncate">Claude Automation</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Claude 세션을 시작한 후 메시지를 추가하면 자동으로 처리됩니다
          </p>
          {error && (
            <div className="mt-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-md">
              {error}
            </div>
          )}
        </div>
        
        {/* Status Indicators */}
        <div className="flex items-center gap-4 flex-shrink-0">
          {/* WebSocket Status */}
          <div className="flex items-center gap-2">
            {wsConnected ? (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-xs text-green-500 hidden sm:inline">실시간</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-xs text-red-500 hidden sm:inline">오프라인</span>
              </>
            )}
          </div>
          
          {/* Claude Session Status */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${sessionReady ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
            <span className="text-xs text-muted-foreground hidden md:inline">
              Claude: {sessionReady ? '준비됨' : '세션 시작 중...'}
            </span>
          </div>
          
          {/* Processing Status */}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isProcessing ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className="text-xs text-muted-foreground hidden md:inline">
              {isLoading ? '로딩중...' : isProcessing ? '처리중' : '대기중'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-5 gap-4">
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-primary">{stats.total}</div>
          <div className="text-sm text-muted-foreground">전체</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-yellow-500">{stats.pending}</div>
          <div className="text-sm text-muted-foreground">대기</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-blue-500">{stats.processing}</div>
          <div className="text-sm text-muted-foreground">처리중</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-green-500">{stats.completed}</div>
          <div className="text-sm text-muted-foreground">완료</div>
        </Card>
        <Card className="p-4 text-center">
          <div className="text-2xl font-bold text-red-500">{stats.error}</div>
          <div className="text-sm text-muted-foreground">오류</div>
        </Card>
      </div>

      {/* Main Content Section - This uses flex-1 like TaskTable */}
      <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left Panel: Queue Management & Controls */}
        <div className="flex flex-col gap-4 h-fit lg:h-full">
          {/* Message Queue */}
          <Card className="flex flex-col overflow-hidden flex-1">
            <div className="p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">메시지 큐</h2>
                <Badge variant="outline" className="text-xs">
                  {messages.length}개
                </Badge>
              </div>
            </div>
            
            {/* Add Message */}
            <div className="p-4 border-b border-border flex-shrink-0">
              <div className="flex gap-2">
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Claude에게 보낼 메시지를 입력하세요..."
                  className="flex-1 h-20 p-3 bg-background border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      addMessage();
                    }
                  }}
                />
                <Button onClick={addMessage} disabled={!newMessage.trim() || isLoading} size="sm" className="self-start">
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline ml-1">{isLoading ? '추가중...' : '추가'}</span>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 hidden sm:block">
                Ctrl/Cmd + Enter로 빠르게 추가
              </p>
            </div>
            
            {/* Message List */}
            <div className="flex-1 overflow-auto">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-muted-foreground">
                  <div className="text-center">
                    <div className="text-4xl mb-2">📝</div>
                    <p className="text-sm">메시지를 추가해보세요</p>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className="group flex items-start gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${getStatusColor(message.status)}`}></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm break-words">{message.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {getStatusText(message.status)}
                          </Badge>
                          <span className="text-xs text-muted-foreground hidden sm:inline">
                            {new Date(message.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMessage(message.id)}
                        disabled={isLoading}
                        className="opacity-60 group-hover:opacity-100 hover:text-red-500 transition-all disabled:opacity-30 flex-shrink-0"
                        title="메시지 삭제"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          {/* Control Panel */}
          <Card className="flex flex-col">
            <div className="p-4 border-b border-border flex-shrink-0">
              <h2 className="text-lg font-semibold">제어판</h2>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={startProcessing}
                  disabled={sessionReady || isLoading}
                  className="flex items-center justify-center gap-2 text-sm"
                  variant={sessionReady ? "secondary" : "default"}
                >
                  <Play className="w-4 h-4" />
                  <span className="hidden sm:inline">{isLoading ? '시작중...' : sessionReady ? '세션 실행중' : '세션 시작'}</span>
                  <span className="sm:hidden">{sessionReady ? '실행중' : '시작'}</span>
                </Button>
                <Button
                  onClick={stopClaudeSession}
                  disabled={!sessionReady || isLoading}
                  variant="destructive"
                  className="flex items-center justify-center gap-2 text-sm"
                >
                  <Square className="w-4 h-4" />
                  <span className="hidden sm:inline">{isLoading ? '세션 종료중...' : '세션 종료'}</span>
                  <span className="sm:hidden">종료</span>
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Panel: Terminal Output */}
        <Card className="flex flex-col overflow-hidden h-fit lg:h-full">
          <div className="p-4 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">실시간 출력</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                <span className="text-muted-foreground text-xs hidden sm:inline">
                  {wsConnected ? '연결됨' : '연결 끊김'}
                </span>
                <span className={`w-2 h-2 rounded-full ${sessionReady ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'}`}></span>
                <span className="text-muted-foreground text-xs hidden sm:inline">
                  {sessionReady ? 'Claude 준비됨' : 'Claude 시작 중...'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Terminal */}
          <div className="flex-1 overflow-hidden p-4">
            <div className="bg-black/95 text-green-400 font-mono text-sm rounded-lg border border-gray-700 flex flex-col h-full overflow-hidden">
              {/* Terminal header */}
              <div className="flex items-center justify-between px-4 py-2 bg-gray-800/50 border-b border-gray-600 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  </div>
                  <span className="text-gray-400 text-xs ml-2">Claude Terminal</span>
                </div>
                <div className="text-gray-500 text-xs hidden sm:block">
                  {new Date().toLocaleTimeString()}
                </div>
              </div>
              
              {/* Terminal content */}
              <div className="flex-1 overflow-auto">
                <div 
                  ref={terminalRef}
                  className="p-4 min-h-full text-sm font-mono text-green-400"
                  style={{
                    backgroundColor: 'transparent',
                    fontFamily: 'Monaco, "Lucida Console", monospace'
                  }}
                >
                  {/* Default message when no output */}
                  <div className="text-gray-500 text-xs flex items-center gap-2">
                    <span className="animate-pulse">●</span>
                    실시간 Claude 터미널 출력 대기 중...
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};