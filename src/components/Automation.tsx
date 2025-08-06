import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Plus, Play, Square, RotateCcw, Trash2, Wifi, WifiOff } from 'lucide-react';
import { apiClient, type QueueMessage, type QueueStatus } from '../utils/api';
import { wsClient } from '../utils/websocket';

export const Automation = () => {
  const [messages, setMessages] = useState<QueueMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [realtimeOutput, setRealtimeOutput] = useState<string[]>([]);
  const [sessionReady, setSessionReady] = useState(false);

  // Terminal output state (Claude-Autopilot style)
  const [terminalContent, setTerminalContent] = useState('');
  const [lastRenderedContent, setLastRenderedContent] = useState('');
  
  // Throttled renderer reference
  const throttledParser = useRef<any>(null);

  // Initialize ANSI parser
  useEffect(() => {
    // Import ANSI parser dynamically to avoid SSR issues
    import('../utils/ansi.js').then(({ ThrottledAnsiParser }) => {
      throttledParser.current = new ThrottledAnsiParser(1000); // 1000ms throttle like Claude-Autopilot
    });
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
        addRealtimeOutput('🔌 WebSocket 연결됨');
        // Check if Claude session info is available
        if (message.data.claudeSession) {
          setSessionReady(message.data.claudeSession.sessionReady);
          addRealtimeOutput(`🤖 Claude 세션: ${message.data.claudeSession.sessionReady ? '준비됨' : '대기중'}`);
        }
      } else if (message.data.status === 'disconnected') {
        addRealtimeOutput('🔌 WebSocket 연결 끊김');
      }
    };

    const handleQueueUpdate = (message) => {
      setMessages(message.data.messages);
      addRealtimeOutput(`📝 큐 업데이트: ${message.data.total}개 메시지`);
    };

    const handleStatusUpdate = (message) => {
      setStatus(message.data);
      setIsProcessing(message.data.processing.isProcessing);
    };

    const handleProcessingStarted = (message) => {
      if (message.data.autoStarted) {
        addRealtimeOutput(`🚀 자동 처리 시작: ${message.data.totalMessages}개 메시지`);
      } else {
        addRealtimeOutput(`🚀 처리 시작: ${message.data.totalMessages}개 메시지`);
      }
    };

    const handleProcessingStopped = () => {
      addRealtimeOutput('⏹️ 처리 중지됨');
    };

    // New Claude session event handlers
    const handleSessionStatus = (message) => {
      const { status, sessionReady: ready, details } = message.data;
      setSessionReady(ready || false);
      
      switch (status) {
        case 'ready':
          addRealtimeOutput('🤖 Claude 세션 준비 완료');
          break;
        case 'stopped':
          addRealtimeOutput('🤖 Claude 세션 종료됨');
          if (details) {
            addRealtimeOutput(`   종료 코드: ${details.code}, 신호: ${details.signal}`);
          }
          break;
        case 'unhealthy':
          addRealtimeOutput('⚠️ Claude 세션 상태 이상 - 재시작 중...');
          break;
      }
    };

    const handleTerminalOutput = (message) => {
      // Real-time terminal output from Claude (Claude-Autopilot style)
      handleTerminalOutputEvent(message.data);
    };

    const handleClaudeOutput = (message) => {
      // Claude-Autopilot style output handling - use full buffer
      if (message.data.cleared) {
        // Output was cleared
        setRealtimeOutput([]);
        setTerminalContent('');
        setLastRenderedContent('');
        addRealtimeOutput('🧹 출력 버퍼가 초기화됨');
      } else if (message.data.output) {
        handleFinalTerminalOutput(message.data.output, true);
      }
    };

    const handleMessageStatus = (message) => {
      const { messageId, status, result, autoProcessed } = message.data;
      
      if (status === 'processing') {
        if (autoProcessed) {
          addRealtimeOutput(`🔄 자동으로 다음 메시지 처리 중: ${messageId.slice(-8)}`);
        } else {
          addRealtimeOutput(`🚀 메시지 처리 시작: ${messageId.slice(-8)}`);
        }
      } else if (status === 'completed' || status === 'error') {
        const statusEmoji = status === 'completed' ? '✅' : '❌';
        addRealtimeOutput(`${statusEmoji} 메시지 ${status === 'completed' ? '완료' : '오류'}: ${messageId.slice(-8)}`);
        
        if (result && result.error) {
          addRealtimeOutput(`   오류: ${result.error}`);
        }
      }
    };

    const handleSessionError = (message) => {
      addRealtimeOutput(`❌ Claude 세션 오류: ${message.data.message}`);
    };

    const handleProcessError = (message) => {
      addRealtimeOutput(`🐛 프로세스 오류: ${message.data.substring(0, 100)}`);
    };

    // Register event handlers
    wsClient.on('connection', handleConnection);
    wsClient.on('queue-update', handleQueueUpdate);
    wsClient.on('status-update', handleStatusUpdate);
    wsClient.on('processing-started', handleProcessingStarted);
    wsClient.on('processing-stopped', handleProcessingStopped);
    
    // New Claude session event handlers
    wsClient.on('session-status', handleSessionStatus);
    wsClient.on('terminal-output', handleTerminalOutput);
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
      
      // Remove new Claude session event handlers
      wsClient.off('session-status', handleSessionStatus);
      wsClient.off('terminal-output', handleTerminalOutput);
      wsClient.off('claude-output', handleClaudeOutput);
      wsClient.off('message-status', handleMessageStatus);
      wsClient.off('session-error', handleSessionError);
      wsClient.off('process-error', handleProcessError);
      // Don't disconnect here to prevent React StrictMode issues
    };
  }, []);

  // Terminal output processing functions (Claude-Autopilot style)
  const handleTerminalOutputEvent = (outputEvent) => {
    if (!throttledParser.current) return;
    
    switch (outputEvent.type) {
      case 'terminal_chunk':
        // Real-time streaming chunk
        setTerminalContent(prev => prev + outputEvent.data);
        // Add raw chunk to output for immediate display
        if (outputEvent.data.trim()) {
          addRealtimeOutput(`> ${outputEvent.data.trim()}`);
        }
        break;
        
      case 'screen_clear':
        // Clear screen detected
        console.log('Screen clear detected');
        setTerminalContent('');
        setLastRenderedContent('');
        setRealtimeOutput(prev => [...prev, '🧹 화면 클리어됨']);
        if (throttledParser.current) {
          throttledParser.current.reset();
        }
        break;
        
      case 'output_update':
        // Accumulated output update
        setTerminalContent(prev => prev + outputEvent.data);
        break;
        
      case 'response_complete':
        // Final complete output
        setTerminalContent(outputEvent.output);
        handleFinalTerminalOutput(outputEvent.output, true);
        addRealtimeOutput('✅ Claude 응답 완료');
        break;
        
      case 'response_timeout':
        // Timeout - use what we have
        setTerminalContent(outputEvent.output);
        handleFinalTerminalOutput(outputEvent.output, true);
        addRealtimeOutput('⏰ Claude 응답 타임아웃');
        break;
    }
  };

  const handleClaudeOutputLegacy = (output) => {
    // Legacy Claude output handling
    if (!throttledParser.current) {
      // Fallback without ANSI parsing
      addRealtimeOutput(`> ${output}`);
      return;
    }
    
    handleFinalTerminalOutput(output, true);
  };

  const handleFinalTerminalOutput = (output, isFinal = false) => {
    if (!throttledParser.current || !output) return;
    
    // Check for clear screen patterns
    import('../utils/ansi.js').then(({ containsClearScreen, cleanAnsiSequences }) => {
      if (containsClearScreen(output)) {
        // Clear screen - replace entire content
        setRealtimeOutput(prev => [...prev, '🧹 Claude 화면 클리어됨']);
        setLastRenderedContent('');
        setTerminalContent(output);
      } else if (output !== lastRenderedContent || isFinal) {
        // Update content if changed
        setTerminalContent(output);
      }
      
      // Use throttled parser to convert ANSI to HTML and display
      throttledParser.current.parse(output, (html, rawContent) => {
        setLastRenderedContent(rawContent);
        
        // Clean ANSI for display and split by lines
        const cleanOutput = cleanAnsiSequences(rawContent);
        const lines = cleanOutput.split('\n').filter(line => line.trim());
        
        if (lines.length > 0) {
          setRealtimeOutput(prev => {
            const newOutput = [...prev];
            lines.forEach(line => {
              if (line.trim()) {
                newOutput.push(`> ${line.trim()}`);
              }
            });
            return newOutput.slice(-100); // Keep last 100 lines
          });
        }
      });
    });
  };

  const addRealtimeOutput = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setRealtimeOutput(prev => [...prev, `[${timestamp}] ${message}`].slice(-50)); // Keep last 50 lines
  };

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
      addRealtimeOutput(`📝 큐에 메시지 추가됨: "${messageText.slice(0, 30)}${messageText.length > 30 ? '...' : ''}"`);
      
      // Claude-Autopilot style: Check if auto-processing started
      if ((response as any).autoProcessing) {
        addRealtimeOutput('🚀 자동으로 메시지 처리를 시작합니다...');
      } else if (!sessionReady) {
        addRealtimeOutput('💡 "세션 시작" 버튼을 눌러서 Claude를 시작하세요');
      } else if (isProcessing) {
        addRealtimeOutput('⏳ 현재 메시지 처리 후 자동으로 처리됩니다');
      }
      
      // WebSocket이 연결되어 있으면 자동으로 업데이트되므로 수동 새로고침 불필요
      if (!wsConnected) {
        await loadQueue();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to add message:', error);
      setError('메시지 추가에 실패했습니다');
      addRealtimeOutput('❌ 메시지 추가 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const removeMessage = async (id: string) => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await apiClient.deleteMessage(id);
      addRealtimeOutput(`🗑️ 메시지 삭제됨: ${id.slice(-8)}`);
      if (!wsConnected) {
        await loadQueue();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to remove message:', error);
      setError('메시지 삭제에 실패했습니다');
      addRealtimeOutput('❌ 메시지 삭제 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const clearQueue = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await apiClient.clearQueue();
      addRealtimeOutput('🧹 큐 전체 삭제됨');
      if (!wsConnected) {
        await loadQueue();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to clear queue:', error);
      setError('큐 비우기에 실패했습니다');
      addRealtimeOutput('❌ 큐 삭제 실패');
    } finally {
      setIsLoading(false);
    }
  };

  const startProcessing = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    
    // Claude-Autopilot style: Only start session, not processing
    if (!sessionReady) {
      addRealtimeOutput('🚀 Claude 세션 시작 중...');
      addRealtimeOutput('📌 세션이 준비되면 메시지가 자동으로 처리됩니다');
      
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
          addRealtimeOutput('✅ Claude 세션이 시작되었습니다');
          addRealtimeOutput('💡 이제 메시지를 추가하면 자동으로 처리됩니다');
          setSessionReady(true);
        }
        
        setError(null);
      } catch (error) {
        console.error('Failed to start Claude session:', error);
        setError('Claude 세션 시작에 실패했습니다');
        addRealtimeOutput('❌ Claude 세션 시작 실패');
      }
    } else {
      // Session already ready
      addRealtimeOutput('ℹ️ Claude 세션이 이미 실행 중입니다');
      addRealtimeOutput('💡 메시지를 추가하면 자동으로 처리됩니다');
    }
    
    setIsLoading(false);
  };

  const stopProcessing = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await apiClient.stopProcessing();
      // WebSocket에서 processing-stopped 이벤트로 처리됨
      if (!wsConnected) {
        await loadStatus();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to stop processing:', error);
      setError('처리 정지에 실패했습니다');
      addRealtimeOutput('❌ 처리 정지 실패');
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
    <div className="p-6 h-full flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-primary">Claude Automation</h1>
          <p className="text-muted-foreground mt-1">
            Claude 세션을 시작한 후 메시지를 추가하면 자동으로 처리됩니다
          </p>
          {error && (
            <div className="mt-2 text-sm text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-1 rounded-md">
              {error}
            </div>
          )}
        </div>
        
        {/* Status Indicators */}
        <div className="flex items-center gap-6">
          {/* WebSocket Status */}
          <div className="flex items-center gap-2">
            {wsConnected ? (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-xs text-green-500">실시간</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-xs text-red-500">오프라인</span>
              </>
            )}
          </div>
          
          {/* Claude Session Status */}
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${sessionReady ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`}></div>
            <span className="text-sm text-muted-foreground">
              Claude: {sessionReady ? '준비됨' : '세션 시작 중...'}
            </span>
          </div>
          
          {/* Processing Status */}
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${isProcessing ? 'bg-blue-500 animate-pulse' : 'bg-gray-400'}`}></div>
            <span className="text-sm text-muted-foreground">
              {isLoading ? '로딩중...' : isProcessing ? '처리중' : '대기중'}
            </span>
          </div>
        </div>
      </div>

      {/* Stats */}
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
          <div className="text-2xl font-bold text-red-500">{stats.error || messages.filter(m => m.status === 'error').length}</div>
          <div className="text-sm text-muted-foreground">오류</div>
        </Card>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-6 min-h-0">
        {/* Left Panel: Queue Management & Controls */}
        <div className="flex flex-col gap-6">
          {/* Message Queue */}
          <Card className="flex flex-col flex-1 min-h-0">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">메시지 큐</h2>
                <Badge variant="outline">
                  {messages.length}개
                </Badge>
              </div>
            </div>
            
            {/* Add Message */}
            <div className="p-4 border-b border-border">
              <div className="flex gap-2">
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Claude에게 보낼 메시지를 입력하세요..."
                  className="flex-1 min-h-[80px] p-3 bg-background border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      addMessage();
                    }
                  }}
                />
                <Button onClick={addMessage} disabled={!newMessage.trim() || isLoading} size="sm">
                  <Plus className="w-4 h-4" />
                  {isLoading ? '추가중...' : '추가'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Ctrl/Cmd + Enter로 빠르게 추가
              </p>
            </div>
            
            {/* Message List - Scrollable area */}
            <div className="flex-1 overflow-auto">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <div className="text-4xl mb-2">📝</div>
                    <p>메시지를 추가해보세요</p>
                  </div>
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  {messages.map((message) => (
                    <div key={message.id} className="group flex items-start gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
                      <div className={`w-2 h-2 rounded-full mt-2 ${getStatusColor(message.status)}`}></div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm break-words">{message.message}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="text-xs">
                            {getStatusText(message.status)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(message.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMessage(message.id)}
                        disabled={isLoading}
                        className="opacity-60 group-hover:opacity-100 hover:text-red-500 transition-all disabled:opacity-30"
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
          <Card className="p-4 flex-shrink-0">
            <h2 className="text-xl font-semibold mb-4">제어판</h2>
            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={startProcessing}
                disabled={sessionReady || isLoading}
                className="flex items-center gap-2"
                variant={sessionReady ? "secondary" : "default"}
              >
                <Play className="w-4 h-4" />
                {isLoading ? '시작중...' : sessionReady ? '세션 실행중' : '세션 시작'}
              </Button>
              <Button
                onClick={stopProcessing}
                disabled={!isProcessing || isLoading}
                variant="destructive"
                className="flex items-center gap-2"
              >
                <Square className="w-4 h-4" />
                {isLoading && isProcessing ? '정지중...' : '정지'}
              </Button>
              <Button
                onClick={clearQueue}
                variant="outline"
                disabled={messages.length === 0 || isLoading}
                className="flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" />
                {isLoading ? '비우는중...' : '큐 비우기'}
              </Button>
              <Button
                onClick={() => { 
                  loadQueue(); 
                  loadStatus(); 
                  addRealtimeOutput('🔄 수동 새로고침 실행');
                }}
                variant="outline"
                disabled={isLoading}
                className="flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                {isLoading ? '새로고침중...' : wsConnected ? '동기화' : '새로고침'}
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Panel: Terminal Output - Full height */}
        <Card className="flex flex-col min-h-0">
          <div className="p-4 border-b border-border flex-shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">실시간 출력</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
                <span className="text-muted-foreground">
                  {wsConnected ? '연결됨' : '연결 끊김'}
                </span>
                <span className={`w-2 h-2 rounded-full ${sessionReady ? 'bg-blue-500 animate-pulse' : 'bg-yellow-500'}`}></span>
                <span className="text-muted-foreground">
                  {sessionReady ? 'Claude 준비됨' : 'Claude 시작 중...'}
                </span>
              </div>
            </div>
          </div>
          
          {/* Terminal - Full remaining height */}
          <div className="flex-1 overflow-auto p-4">
            <div className="bg-black/95 text-green-400 font-mono text-sm rounded-lg border border-gray-700 flex flex-col h-full">
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
                <div className="text-gray-500 text-xs">
                  {new Date().toLocaleTimeString()}
                </div>
              </div>
              
              {/* Terminal content - Scrollable */}
              <div className="flex-1 overflow-auto p-4 space-y-1">
                {realtimeOutput.length === 0 ? (
                  <div className="text-gray-500 text-xs flex items-center gap-2">
                    <span className="animate-pulse">●</span>
                    실시간 출력 대기 중...
                  </div>
                ) : (
                  realtimeOutput.slice(-200).map((line, index) => ( // 최근 200줄만 표시
                    <div 
                      key={index} 
                      className="text-xs text-gray-300 whitespace-pre-wrap break-all"
                      dangerouslySetInnerHTML={{
                        __html: line.replace(/</g, '&lt;').replace(/>/g, '&gt;')
                      }}
                    />
                  ))
                )}
                
                {/* Processing indicator */}
                {isProcessing && (
                  <div className="text-blue-400 animate-pulse flex items-center gap-2">
                    <span>●</span>
                    <span>처리 중...</span>
                  </div>
                )}
                
                {/* Auto-scroll anchor */}
                <div id="terminal-bottom" />
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};