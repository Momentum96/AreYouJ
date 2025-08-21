/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Play, Square, Trash2, Wifi, WifiOff, ChevronUp, ChevronDown, Edit, Save, X, Bell, BellOff } from 'lucide-react';
import { apiClient, type QueueMessage, type QueueStatus } from '../utils/api';
import { wsClient } from '../utils/websocket';
import { ClaudeTerminalRenderer } from '../utils/claude-terminal.js';
import NotificationManager from '../utils/notifications.js';

export const Automation = () => {
  const [messages, setMessages] = useState<QueueMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [isStoppingSession, setIsStoppingSession] = useState(false);
  const [isClearingQueue, setIsClearingQueue] = useState(false);
  const [isSendingKey, setIsSendingKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setStatus] = useState<QueueStatus | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<'idle' | 'starting' | 'ready' | 'error'>('idle');
  
  // 메시지 수정 관련 상태들
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // 알림 관련 상태들
  const [notificationsEnabled, setNotificationsEnabled] = useState(NotificationManager.isEnabled());
  const [notificationPermission, setNotificationPermission] = useState<'granted' | 'denied' | 'default'>('default');

  // Claude Terminal Renderer (Claude-Autopilot style)
  const terminalRenderer = useRef<ClaudeTerminalRenderer>(new ClaudeTerminalRenderer());
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  const checkSessionStatus = useCallback(async () => {
    try {
      const response = await apiClient.getStatus();
      const isSessionReady = response.claude?.sessionReady || false;
      setSessionStatus(isSessionReady ? 'ready' : 'idle');

      // Update terminal state based on session status only if there's no real terminal content
      if (terminalRef.current) {
        const currentContent = terminalRef.current.innerHTML;

        // Only update terminal if there's no real content
        if (!hasRealTerminalContent(currentContent)) {
          if (isSessionReady) {
            // Session is ready, show ready message
            terminalRef.current.innerHTML = `
              <div class="text-gray-500 text-xs flex items-center gap-2">
                <span class="text-green-400 animate-pulse">●</span>
                Claude 세션이 준비되었습니다. 메시지를 전송하세요.
              </div>
            `;
          } else {
            // Session not ready, show neutral waiting message
            terminalRef.current.innerHTML = `
              <div class="text-gray-500 text-xs flex items-center gap-2">
                <span class="text-gray-400">●</span>
                Claude 터미널 대기 중...
              </div>
            `;
          }
        }
        // If there's real terminal content, don't touch it
      }
    } catch (error) {
      console.error('Failed to check session status:', error);
    }
  }, []);

  // Initialize terminal renderer
  useEffect(() => {
    terminalRenderer.current = new ClaudeTerminalRenderer();
  }, [checkSessionStatus]);

  // Initialize component and set up event handlers for global WebSocket
  useEffect(() => {
    console.log('🤖 Automation component initializing...');
    
    // Load initial data
    loadQueue();
    loadStatus();
    
    // Check current session status when component mounts
    checkSessionStatus();
    
    // 알림 권한 자동 요청
    const initializeNotifications = async () => {
      if (NotificationManager.isSupported()) {
        const currentPermission = Notification.permission;
        setNotificationPermission(currentPermission);
        
        // 권한이 아직 결정되지 않은 경우 자동으로 요청
        if (currentPermission === 'default') {
          console.log('🔔 자동으로 알림 권한을 요청합니다...');
          const granted = await NotificationManager.requestPermission();
          setNotificationPermission(granted ? 'granted' : 'denied');
          
          if (granted) {
            console.log('✅ 알림 권한이 허용되었습니다!');
            // 권한 허용 시 테스트 알림 (약간의 지연 후)
            setTimeout(() => {
              NotificationManager.showTestNotification();
            }, 1000);
          } else {
            console.log('❌ 알림 권한이 거부되었습니다.');
          }
        }
      }
    };
    
    // 컴포넌트 마운트 직후 알림 권한 요청
    initializeNotifications();
    
    // Check if we need to auto-start processing when returning to this page
    setTimeout(() => {
      checkAndTriggerAutoProcessing();
    }, 1000);

    // Check if WebSocket is already connected from global App
    setWsConnected(wsClient.isConnected());
    
    // Set up WebSocket event handlers
    const handleConnection = (message: any) => {
      console.log('🔌 WebSocket connection event in Automation:', message.data);
      setWsConnected(message.data.status === 'connected');
      if (message.data.status === 'connected') {
        // Check if Claude session info is available
        if (message.data.claudeSession) {
          setSessionStatus(message.data.claudeSession.sessionReady ? 'ready' : 'idle');
        }
        
        // Handle initial Claude output (Claude-Autopilot style)
        if (message.data.initialOutput && message.data.initialOutput.hasOutput && terminalRef.current && terminalRenderer.current) {
          console.log('🖥️ Rendering initial Claude output:', message.data.initialOutput);
          terminalRenderer.current.renderOutput(message.data.initialOutput.currentScreen, terminalRef.current);
          
          // Auto-scroll to bottom after initial rendering
          setTimeout(() => {
            if (terminalScrollRef.current) {
              terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
            }
          }, 100);
        } else if (message.data.claudeSession && message.data.claudeSession.sessionReady) {
          // Session is ready but no initial output, check current state only if no real content
          if (terminalRef.current) {
            const currentContent = terminalRef.current.innerHTML;
            
            // Only call checkSessionStatus if there's no real terminal content
            if (!hasRealTerminalContent(currentContent)) {
              checkSessionStatus();
            }
          } else {
            checkSessionStatus();
          }
        }
      }
    };

    const handleQueueUpdate = (message: any) => {
      const newMessages = message.data.messages;
      
      // 상태 변경 감지를 위해 이전 메시지들과 비교
      setMessages(prevMessages => {
        console.log('🔄 메시지 큐 업데이트 수신:', {
          newCount: newMessages.length,
          oldCount: prevMessages.length,
          notificationsEnabled,
          notificationPermission
        });

        // 상태 변경 감지 및 알림 처리
        newMessages.forEach((newMsg: QueueMessage) => {
          const oldMsg = prevMessages.find(m => m.id === newMsg.id);
          
          // 상태가 변경된 경우 로그 출력
          if (oldMsg && oldMsg.status !== newMsg.status) {
            console.log(`📢 상태 변경 감지: [${newMsg.id}] ${oldMsg.status} → ${newMsg.status}`);
            
            // processing, completed, error 상태일 때만 알림
            if (['processing', 'completed', 'error'].includes(newMsg.status)) {
              
              // 현재 알림 상태를 실시간으로 체크
              const currentNotificationEnabled = NotificationManager.isEnabled();
              const currentNotificationPermission = Notification.permission;
              
              console.log('🔔 알림 조건 체크:', {
                상태: newMsg.status,
                메시지: newMsg.message.substring(0, 50) + '...',
                알림활성화: currentNotificationEnabled,
                브라우저권한: currentNotificationPermission
              });
              
              if (currentNotificationEnabled && currentNotificationPermission === 'granted') {
                console.log('✅ 알림 전송 중...');
                NotificationManager.showTaskNotification(
                  newMsg.status, 
                  newMsg.message,
                  newMsg.id
                );
              } else {
                console.log('❌ 알림 전송 실패 - 조건 불만족');
              }
            }
          }
        });
        
        return newMessages;
      });
    };

    const handleStatusUpdate = (message: any) => {
      setStatus(message.data);
    };

    const handleProcessingStarted = () => {
      // No UI feedback needed
    };

    const handleProcessingStopped = () => {
      // No UI feedback needed
    };

    // New Claude session event handlers
    const handleSessionStatus = (message: any) => {
      const { sessionReady: ready } = message.data;
      setSessionStatus(ready ? 'ready' : 'idle');
    };

    const handleClaudeOutput = (message: any) => {
      // Claude-Autopilot style output handling - render to actual terminal
      if (message.data.cleared) {
        // Output was cleared
        if (terminalRef.current && terminalRenderer.current) {
          terminalRenderer.current.clear(terminalRef.current);
        }
      } else if (message.data.output) {
        // Render full Claude terminal output
        if (terminalRef.current && terminalRenderer.current) {
          // Check if user was already at the bottom before rendering
          const wasAtBottom = terminalScrollRef.current ? 
            (terminalScrollRef.current.scrollTop + terminalScrollRef.current.clientHeight >= terminalScrollRef.current.scrollHeight - 50) : true;
          
          terminalRenderer.current.renderOutput(message.data.output, terminalRef.current);
          
          // Only auto-scroll if user was already at bottom (smart scroll)
          if (wasAtBottom && terminalScrollRef.current) {
            terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
          }
        }
      }
    };

    const handleMessageStatus = () => {
      // Message status changes handled silently
    };

    const handleSessionError = () => {
      // Session errors handled silently
    };

    const handleProcessError = (message: any) => {
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

    // Handle working directory changes
    const handleWorkingDirectoryChanged = () => {
      console.log('Working directory changed in Automation, refreshing queue...');
      // Reload queue for new working directory
      loadQueue();
      loadStatus();
    };

    // Remove any existing handlers first to prevent duplicates
    wsClient.off('connection', handleConnection);
    wsClient.off('queue-update', handleQueueUpdate);
    wsClient.off('status-update', handleStatusUpdate);
    wsClient.off('processing-started', handleProcessingStarted);
    wsClient.off('processing-stopped', handleProcessingStopped);
    wsClient.off('session-status', handleSessionStatus);
    wsClient.off('claude-output', handleClaudeOutput);
    wsClient.off('message-status', handleMessageStatus);
    wsClient.off('session-error', handleSessionError);
    wsClient.off('process-error', handleProcessError);
    wsClient.off('working-directory-changed', handleWorkingDirectoryChanged);

    // Register event handlers using global WebSocket
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
    wsClient.on('working-directory-changed', handleWorkingDirectoryChanged);

    // Cleanup on unmount - remove specific handlers only
    return () => {
      console.log('🧹 Automation component cleanup - removing event handlers');
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
      wsClient.off('working-directory-changed', handleWorkingDirectoryChanged);
      
      // Note: WebSocket connection is managed globally by App component
    };
  }, [checkSessionStatus]);

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
      setError(null);
    } catch (error) {
      console.error('Failed to load status:', error);
      setError('상태 정보를 불러올 수 없습니다');
    }
  };


  // Check and trigger auto-processing if conditions are met
  const checkAndTriggerAutoProcessing = async () => {
    try {
      const [queueResponse, statusResponse] = await Promise.all([
        apiClient.getQueue(),
        apiClient.getStatus()
      ]);
      
      const hasPendingMessages = queueResponse.messages.some((m: any) => m.status === 'pending');
      const isSessionReady = statusResponse.claude?.sessionReady || false;
      const isCurrentlyProcessing = statusResponse.processing?.isProcessing || false;
      
      console.log('🔍 Auto-processing check:', {
        hasPendingMessages,
        isSessionReady,
        isCurrentlyProcessing,
        pendingCount: queueResponse.messages.filter((m: any) => m.status === 'pending').length
      });
      
      if (hasPendingMessages && isSessionReady && !isCurrentlyProcessing) {
        console.log('✅ Auto-starting processing - conditions met');
        // Trigger auto-processing by calling the server's auto-start trigger endpoint
        await fetch('http://localhost:5001/api/processing/auto-start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        console.log('❌ Auto-processing not triggered:', {
          reason: !hasPendingMessages ? 'No pending messages' : 
                  !isSessionReady ? 'Session not ready' :
                  isCurrentlyProcessing ? 'Already processing' : 'Unknown'
        });
      }
    } catch (error) {
      console.error('Failed to check auto-processing conditions:', error);
    }
  };

  // Helper function to check if terminal has real Claude content
  const hasRealTerminalContent = (content: string) => {
    if (!content || content.trim() === '') return false;
    
    // Status messages we want to replace
    const statusMessages = ['대기 중...', '준비되었습니다', '종료되었습니다', '시작하는 중...'];
    if (statusMessages.some(msg => content.includes(msg))) {
      return false;
    }
    
    // Real Claude terminal indicators
    const realContentIndicators = [
      'Welcome to Claude',
      '/help',
      'cwd:',
      'Tips for getting started:',
      '? for shortcuts',
      'Run /init',
      'Use Claude to help',
      'Be as specific',
      'Run /terminal-setup'
    ];
    
    return realContentIndicators.some(indicator => content.includes(indicator));
  };

  // 알림 관련 함수들
  // 알림 권한 요청 함수 (필요시 수동으로 호출 가능)
  const requestNotificationPermission = async () => {
    if (!NotificationManager.isSupported()) {
      alert('이 브라우저는 알림을 지원하지 않습니다.');
      return;
    }

    const granted = await NotificationManager.requestPermission();
    setNotificationPermission(granted ? 'granted' : 'denied');
    
    if (granted) {
      NotificationManager.showTestNotification();
    } else {
      alert('알림 권한이 거부되었습니다. 브라우저 설정에서 수동으로 허용해주세요.');
    }
  };

  const addMessage = async () => {
    // 입력 검증 강화
    if (!newMessage.trim() || isLoading) return;
    
    const messageText = newMessage.trim();
    
    // 메시지 길이 검증
    if (messageText.length > 10000) {
      setError('메시지는 10,000자를 초과할 수 없습니다.');
      return;
    }
    
    // 기본적인 XSS 방지 검증 - 단순하고 안전한 접근법
    const dangerousTags = ['<script', '<iframe', '<object', '<embed', 'javascript:', 'data:text/html'];
    const lowerMessage = messageText.toLowerCase();
    const hasDangerousContent = dangerousTags.some(tag => lowerMessage.includes(tag));
    
    if (hasDangerousContent) {
      setError('보안상 위험한 내용이 포함되어 있습니다.');
      return;
    }
    
    setIsLoading(true);
    
    try {
      await apiClient.addMessage(messageText);
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

  // 메시지 수정 모드 시작
  const startEditMessage = (message: QueueMessage) => {
    if (editingMessageId) return; // 이미 다른 메시지를 편집 중이면 차단
    
    setEditingMessageId(message.id);
    setEditingText(message.message);
    setNewMessage(message.message); // textarea에 현재 메시지 내용 표시
  };

  // 메시지 수정 저장
  const saveEditMessage = async () => {
    if (!editingMessageId || isLoading) return;
    
    const messageText = newMessage.trim();
    if (!messageText) {
      setError('메시지 내용을 입력해주세요');
      return;
    }
    
    // 메시지가 변경되지 않았으면 편집 모드만 종료
    if (messageText === editingText) {
      setEditingMessageId(null);
      setEditingText('');
      setNewMessage('');
      return;
    }
    
    setIsLoading(true);
    try {
      await apiClient.updateMessage(editingMessageId, messageText);
      
      // 편집 모드 종료
      setEditingMessageId(null);
      setEditingText('');
      setNewMessage('');
      
      // WebSocket이 연결되어 있으면 자동으로 업데이트되므로 수동 새로고침 불필요
      if (!wsConnected) {
        await loadQueue();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to update message:', error);
      setError('메시지 수정에 실패했습니다');
    } finally {
      setIsLoading(false);
    }
  };

  // 메시지 수정 취소
  const cancelEdit = () => {
    setEditingMessageId(null);
    setEditingText('');
    setNewMessage('');
    setError(null); // 에러 메시지도 클리어
  };

  const clearQueue = async () => {
    if (isClearingQueue) return;
    
    setIsClearingQueue(true);
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
      setIsClearingQueue(false);
    }
  };

  const startProcessing = async () => {
    if (isStartingSession) return;
    
    setIsStartingSession(true);
    
    // Claude-Autopilot style: Only start session, not processing
    if (sessionStatus !== 'ready') {
      
      try {
        // 세션 시작 상태로 변경
        setSessionStatus('starting');
        
        // 세션 시작 전 터미널 상태 메시지 표시
        if (terminalRef.current) {
          terminalRef.current.innerHTML = `
            <div class="text-gray-500 text-xs flex items-center gap-2">
              <span class="animate-pulse text-blue-400">●</span>
              Claude 세션을 시작하는 중...
            </div>
          `;
        }
        
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
          setSessionStatus('ready');
        }
        
        setError(null);
      } catch (error) {
        console.error('Failed to start Claude session:', error);
        setError('Claude 세션 시작에 실패했습니다');
        setSessionStatus('error');
        
        // 오류 시 초기 대기 메시지로 복원
        if (terminalRef.current) {
          terminalRef.current.innerHTML = `
            <div class="text-gray-500 text-xs flex items-center gap-2">
              <span class="text-red-400">●</span>
              Claude 세션 시작에 실패했습니다.
            </div>
          `;
        }
      }
    }
    
    setIsStartingSession(false);
  };

  const stopClaudeSession = async () => {
    if (isStoppingSession) return;
    
    setIsStoppingSession(true);
    try {
      await apiClient.stopClaudeSession();
      setSessionStatus('idle');
      
      // 터미널 클리어 및 세션 종료 메시지 표시
      if (terminalRef.current && terminalRenderer.current) {
        terminalRenderer.current.clear(terminalRef.current);
        // 세션 종료 메시지를 터미널에 표시
        setTimeout(() => {
          if (terminalRef.current) {
            terminalRef.current.innerHTML = `
              <div class="text-gray-500 text-xs flex items-center gap-2">
                <span class="text-red-400">●</span>
                Claude 세션이 종료되었습니다. 세션 시작 버튼을 눌러 다시 연결하세요.
              </div>
            `;
          }
        }, 100);
      }
      
      // 상태 업데이트가 WebSocket을 통해 자동으로 처리됨
      if (!wsConnected) {
        await loadStatus();
      }
      setError(null);
    } catch (error) {
      console.error('Failed to stop Claude session:', error);
      setError('Claude 세션 종료에 실패했습니다');
    } finally {
      setIsStoppingSession(false);
    }
  };

  // 키 전송 함수 (ESC, Enter 등)
  const sendKeyToClaudeTerminal = async (key: string) => {
    if (isSendingKey) return;
    
    setIsSendingKey(true);
    try {
      await apiClient.sendKeypress(key);
      setError(null);
    } catch (error) {
      console.error(`Failed to send ${key} key:`, error);
      setError(`${key} 키 전송에 실패했습니다`);
    } finally {
      setIsSendingKey(false);
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

  // 메시지 큐 카드와 동일한 로직 사용 - messages 상태에서 직접 통계 계산
  const stats = {
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
          {/* Notification Status Indicator */}
          <div
            className="flex items-center gap-2 px-2 py-1"
            title={
              notificationPermission === 'granted' && notificationsEnabled 
                ? "알림 활성화됨" 
                : notificationPermission === 'denied'
                ? "알림 권한 거부됨"
                : notificationPermission === 'default'
                ? "알림 권한 대기 중"
                : "알림 비활성화됨"
            }
          >
            {(() => {
              if (notificationPermission === 'granted' && notificationsEnabled) {
                return (
                  <>
                    <Bell className="w-4 h-4 text-blue-500" />
                    <span className="text-xs text-blue-500 hidden sm:inline">알림 켜짐</span>
                  </>
                );
              } else if (notificationPermission === 'denied') {
                return (
                  <>
                    <BellOff className="w-4 h-4 text-red-500" />
                    <span className="text-xs text-red-500 hidden sm:inline">권한 거부됨</span>
                  </>
                );
              } else if (notificationPermission === 'default') {
                return (
                  <>
                    <Bell className="w-4 h-4 text-yellow-500" />
                    <span className="text-xs text-yellow-500 hidden sm:inline">권한 요청</span>
                  </>
                );
              } else {
                return (
                  <>
                    <BellOff className="w-4 h-4 text-gray-500" />
                    <span className="text-xs text-gray-500 hidden sm:inline">알림 꺼짐</span>
                  </>
                );
              }
            })()}
          </div>

          {/* WebSocket Status */}
          <div className="flex items-center gap-2">
            {wsConnected ? (
              <>
                <Wifi className="w-4 h-4 text-green-500" />
                <span className="text-xs text-green-500 hidden sm:inline">서버 온라인</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-500" />
                <span className="text-xs text-red-500 hidden sm:inline">서버 오프라인</span>
              </>
            )}
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

      {/* Main Content Section - Dashboard's TaskTable position */}
      <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
        {/* Left Panel: Message Queue (단독) */}
        <Card className="flex flex-col overflow-hidden min-h-0">
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
            {editingMessageId && (
              <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                    📝 메시지 수정 모드
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelEdit}
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-red-500"
                  >
                    <X className="w-3 h-3 mr-1" />
                    취소
                  </Button>
                </div>
              </div>
            )}
            <textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder={editingMessageId ? "메시지를 수정하세요..." : "Claude에게 보낼 메시지를 입력하세요..."}
              className={`w-full h-20 p-3 bg-background border rounded-md resize-none focus:outline-none focus:ring-2 text-sm ${
                editingMessageId 
                  ? 'border-blue-300 focus:ring-blue-500' 
                  : 'border-border focus:ring-primary'
              }`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  editingMessageId ? saveEditMessage() : addMessage();
                } else if (e.key === 'Escape' && editingMessageId) {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              {editingMessageId 
                ? "Ctrl/Cmd + Enter로 수정 저장 또는 위의 저장 버튼 클릭" 
                : "Ctrl/Cmd + Enter로 빠르게 추가"
              }
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
                {[...messages].reverse().map((message) => (
                  <div key={message.id} className={`group flex items-start gap-3 p-3 rounded-lg transition-colors ${
                    editingMessageId === message.id 
                      ? 'bg-blue-50 dark:bg-blue-900/20 border-2 border-blue-200 dark:border-blue-800' 
                      : 'bg-muted/30 hover:bg-muted/50'
                  }`}>
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
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      {message.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => editingMessageId === message.id ? saveEditMessage() : startEditMessage(message)}
                          disabled={isLoading || (editingMessageId && editingMessageId !== message.id)}
                          className={`opacity-60 group-hover:opacity-100 transition-all disabled:opacity-30 ${
                            editingMessageId === message.id 
                              ? 'text-green-600 hover:text-green-700' 
                              : 'hover:text-blue-500'
                          }`}
                          title={editingMessageId === message.id ? "메시지 저장" : "메시지 수정"}
                        >
                          {editingMessageId === message.id ? (
                            <Save className="w-4 h-4" />
                          ) : (
                            <Edit className="w-4 h-4" />
                          )}
                        </Button>
                      )}
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* Right Panel: Control Panel + Terminal Output */}
        <div className="flex flex-col gap-4 min-h-0">
          {/* Control Panel */}
          <Card className="flex flex-col flex-shrink-0">
            <div className="p-4 border-b border-border flex-shrink-0">
              <h2 className="text-lg font-semibold">제어판</h2>
            </div>
            <div className="p-4">
              <div className="grid grid-cols-3 gap-2">
                <Button
                  onClick={startProcessing}
                  disabled={sessionStatus === 'ready' || isStartingSession}
                  className="flex items-center justify-center gap-2 text-sm"
                  variant={sessionStatus === 'ready' ? "secondary" : "default"}
                >
                  <Play className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {isStartingSession ? '시작중...' : 
                     sessionStatus === 'ready' ? '세션 실행중' : 
                     '세션 시작'}
                  </span>
                  <span className="sm:hidden">
                    {sessionStatus === 'ready' ? '실행중' : '시작'}
                  </span>
                </Button>
                <Button
                  onClick={stopClaudeSession}
                  disabled={sessionStatus !== 'ready' || isStoppingSession}
                  variant="destructive"
                  className="flex items-center justify-center gap-2 text-sm"
                >
                  <Square className="w-4 h-4" />
                  <span className="hidden sm:inline">{isStoppingSession ? '종료중...' : '세션 종료'}</span>
                  <span className="sm:hidden">종료</span>
                </Button>
                <Button
                  onClick={clearQueue}
                  variant="outline"
                  disabled={messages.length === 0 || isClearingQueue}
                  className="flex items-center justify-center gap-2 text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  <span className="hidden sm:inline">{isClearingQueue ? '비우는중...' : '큐 비우기'}</span>
                  <span className="sm:hidden">비우기</span>
                </Button>
              </div>
            </div>
          </Card>

          {/* Terminal Output */}
          <Card className="flex flex-col overflow-hidden flex-1 min-h-0">
            <div className="p-4 border-b border-border flex-shrink-0">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">실시간 출력</h2>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`w-2 h-2 rounded-full ${
                    sessionStatus === 'ready' ? 'bg-green-500 animate-pulse' : 
                    sessionStatus === 'starting' ? 'bg-yellow-500 animate-pulse' :
                    sessionStatus === 'error' ? 'bg-red-500' :
                    'bg-gray-500 animate-pulse'
                  }`}></span>
                  <span className="text-muted-foreground text-xs hidden sm:inline">
                    {sessionStatus === 'ready' ? 'Claude 세션 연결됨' : 
                     sessionStatus === 'starting' ? 'Claude 세션 시작 중...' :
                     sessionStatus === 'error' ? 'Claude 세션 오류' :
                     'Claude 세션 대기'}
                  </span>
                </div>
              </div>
              
              {/* 키 전송 버튼들 */}
              {sessionStatus === 'ready' && (
                <div className="flex gap-2 flex-wrap items-center">
                  <Button
                    onClick={() => sendKeyToClaudeTerminal('escape')}
                    disabled={sessionStatus !== 'ready' || isSendingKey}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    ESC
                  </Button>
                  <Button
                    onClick={() => sendKeyToClaudeTerminal('enter')}
                    disabled={sessionStatus !== 'ready' || isSendingKey}
                    variant="outline"
                    size="sm"
                    className="text-xs"
                  >
                    Enter
                  </Button>
                  <Button
                    onClick={() => sendKeyToClaudeTerminal('up')}
                    disabled={sessionStatus !== 'ready' || isSendingKey}
                    variant="outline"
                    size="sm"
                    className="text-xs flex items-center gap-1"
                  >
                    <ChevronUp className="w-3 h-3" />
                    Up
                  </Button>
                  <Button
                    onClick={() => sendKeyToClaudeTerminal('down')}
                    disabled={sessionStatus !== 'ready' || isSendingKey}
                    variant="outline"
                    size="sm"
                    className="text-xs flex items-center gap-1"
                  >
                    <ChevronDown className="w-3 h-3" />
                    Down
                  </Button>
                </div>
              )}
            </div>
            
            {/* Terminal */}
            <div className="flex-1 p-4 min-h-0">
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
                  <div className="text-gray-500 text-xs hidden sm:block">
                    {new Date().toLocaleTimeString()}
                  </div>
                </div>
                
                {/* Terminal content - This is where scroll should happen */}
                <div 
                  ref={terminalScrollRef}
                  className="flex-1 overflow-auto"
                >
                  <div 
                    ref={terminalRef}
                    className="p-4 text-sm font-mono text-green-400"
                    style={{
                      backgroundColor: 'transparent',
                      fontFamily: 'Monaco, "Lucida Console", monospace'
                    }}
                  >
                    {/* Default message will be set by checkSessionStatus */}
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};