import { useEffect, useState, useCallback, useRef } from "react";
import "./App.css";
import { Dashboard } from "./components/Dashboard";
import { Automation } from "./components/Automation";
import { ProjectHomePathSetting } from "./components/ProjectHomePathSetting";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { Task } from "./types/task";

type NavigationTab = 'dashboard' | 'automation';

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NavigationTab>('dashboard');
  const [projectPath, setProjectPath] = useState<string>('');
  const [isLoadingTasks, setIsLoadingTasks] = useState<boolean>(false);

  // 레이스 컨디션 방지를 위한 ref들
  const isRequestInProgressRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // fetchTasks 함수를 컴포넌트 레벨로 이동하고 useCallback으로 최적화
  const fetchTasks = useCallback(async (showLoading = false) => {
    // 이미 요청이 진행 중이면 건너뛰기
    if (isRequestInProgressRef.current) {
      console.log('Skipping fetch - request already in progress');
      return;
    }

    try {
      isRequestInProgressRef.current = true;
      if (showLoading) setIsLoadingTasks(true);
      
      // 이전 요청이 있다면 취소
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();
      
      const response = await fetch("/api/tasks?t=" + new Date().getTime(), {
        signal: abortControllerRef.current.signal
      });
      
      if (!response.ok) {
        throw new Error(
          `태스크 데이터를 불러오는데 실패했습니다. (${response.status}: ${response.statusText})`
        );
      }
      const data = await response.json();

      setTasks(data.tasks || []);
      setProjectPath(data.projectHomePath || '');
      if (error) setError(null); // 성공 시 이전 에러 초기화
    } catch (err) {
      // AbortError는 무시 (정상적인 요청 취소)
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('Request aborted');
        return;
      }
      
      const errorMessage =
        err instanceof Error
          ? err.message
          : "알 수 없는 오류가 발생했습니다.";
      console.error("Tasks fetch error:", errorMessage);
      setError(errorMessage);
    } finally {
      isRequestInProgressRef.current = false;
      if (showLoading) setIsLoadingTasks(false);
    }
  }, [error]);

  // 초기 데이터 로딩 및 주기적 업데이트
  useEffect(() => {
    // 즉시 실행
    fetchTasks();

    // 5초마다 데이터 새로고침
    const intervalId = setInterval(() => fetchTasks(), 5000);
    
    return () => {
      clearInterval(intervalId);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchTasks]);

  // WebSocket을 통한 설정 변경 감지
  useEffect(() => {
    const connectWebSocket = () => {
      const ws = new WebSocket(`ws://${window.location.host}`);
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          // 프로젝트 경로 변경 시 tasks 새로고침
          if (message.type === 'settings-update') {
            const newProjectPath = message.data.settings.projectHomePath;
            if (newProjectPath !== projectPath) {
              console.log('Project path changed, refreshing tasks...');
              // 로딩 상태를 보여주면서 tasks를 새로고침
              setTimeout(() => {
                fetchTasks(true); // 기존 fetchTasks 함수 재사용
              }, 100);
            }
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      return ws;
    };

    const ws = connectWebSocket();
    return () => {
      ws.close();
    };
  }, [projectPath, error]);

  useEffect(() => {
    // 프로젝트 이름을 대시보드 제목으로 변환
    const formatTitle = (name: string) => {
      return (
        name
          .split("-")
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ") + " Dashboard"
      );
    };

    document.title = formatTitle(__APP_NAME__);
  }, []);


  // 에러 발생 시에만 에러 화면 표시
  if (error && tasks.length === 0) {
    return (
      <div className="dark w-full h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-red-400 text-lg">{error}</div>
      </div>
    );
  }

  const formatAppName = (name: string) => {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  return (
    <ErrorBoundary>
      <div className="dark w-full h-screen bg-background text-foreground overflow-hidden">
      {/* Navigation Bar */}
      <div className="w-full border-b border-border bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center space-x-8">
            <h1 className="text-2xl font-bold text-primary">
              {formatAppName(__APP_NAME__)}
            </h1>
            <nav className="flex space-x-1">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'dashboard'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                📊 Dashboard
              </button>
              <button
                onClick={() => setActiveTab('automation')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === 'automation'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                🤖 Automation
              </button>
            </nav>
          </div>
          <div className="flex items-center">
            <ProjectHomePathSetting />
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="w-full h-[calc(100vh-73px)] overflow-hidden">
        {activeTab === 'dashboard' ? (
          <Dashboard tasks={tasks} appName={__APP_NAME__} isLoadingTasks={isLoadingTasks} />
        ) : (
          <Automation />
        )}
      </div>

      {/* Error Toast */}
      {error && (
        <div className="absolute bottom-4 right-4 bg-red-500 text-white p-2 rounded-md text-sm shadow-lg">
          {error}
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
