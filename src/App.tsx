import { useEffect, useState } from "react";
import "./App.css";
import { Dashboard } from "./components/Dashboard";
import "./electron.d.ts"; // Import electron types
import type { Task } from "./types/task";

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isElectron, setIsElectron] = useState(false);

  // Electron 환경 감지
  useEffect(() => {
    const checkElectron = () => {
      setIsElectron(
        typeof window !== "undefined" && window.electronAPI !== undefined
      );
    };

    checkElectron();

    // Electron 환경에서만 이벤트 리스너 설정
    if (window.electronAPI) {
      console.log("Running in Electron environment");
      console.log("Platform:", window.electronAPI.platform);
      console.log("Development mode:", window.electronAPI.isDev);
    }
  }, []);

  // 초기 데이터 로딩 및 주기적 업데이트
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        let data;
        if (isElectron) {
          data = await window.electronAPI.getTasks();
          if (data === null) {
            throw new Error(
              "태스크 데이터를 불러오는데 실패했습니다. (Electron Main Process)"
            );
          }
        } else {
          const response = await fetch("/docs/tasks.json?t=" + new Date().getTime());
          if (!response.ok) {
            throw new Error(
              `태스크 데이터를 불러오는데 실패했습니다. (${response.status}: ${response.statusText})`
            );
          }
          data = await response.json();
        }

        setTasks(data.tasks);
        if (error) setError(null); // 성공 시 이전 에러 초기화
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "알 수 없는 오류가 발생했습니다.";
        console.error("Tasks fetch error:", errorMessage);
        setError(errorMessage);
      }
    };

    // 즉시 실행
    fetchTasks();

    // 5초마다 데이터 새로고침
    const intervalId = setInterval(fetchTasks, 5000);
    return () => clearInterval(intervalId);
  }, [error, isElectron]); // isElectron을 dependency에 추가

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

  // 키보드 단축키 처리 (Electron 환경에서만)
  useEffect(() => {
    if (!isElectron) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ctrl+M 또는 Cmd+M으로 최소화
      if ((event.ctrlKey || event.metaKey) && event.key === "m") {
        event.preventDefault();
        window.electronAPI?.minimize();
      }

      // Ctrl+Q 또는 Cmd+Q로 종료 (macOS는 기본 동작 사용)
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "q" &&
        window.electronAPI.platform !== "darwin"
      ) {
        event.preventDefault();
        window.electronAPI?.close();
      }

      // F11로 전체화면 토글
      if (event.key === "F11") {
        event.preventDefault();
        window.electronAPI?.maximize();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isElectron]);

  // 에러 발생 시에만 에러 화면 표시
  if (error && tasks.length === 0) {
    return (
      <div className="dark w-full h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-red-400 text-lg">{error}</div>
        {isElectron && (
          <div className="absolute top-4 right-4 text-xs text-gray-500">
            Electron App • Platform: {window.electronAPI.platform}
            {window.electronAPI.isDev && " • Development Mode"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="dark w-full h-screen bg-background text-foreground overflow-hidden">
      <Dashboard tasks={tasks} appName={__APP_NAME__} />

      {/* Electron 상태 표시 (개발 모드에서만) */}
      {isElectron && window.electronAPI.isDev && (
        <div className="absolute top-4 right-4 text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">
          Electron • {window.electronAPI.platform}
        </div>
      )}

      {/* 백그라운드 업데이트 중 에러 발생 시, 우측 하단에 조용히 표시 */}
      {error && (
        <div className="absolute bottom-4 right-4 bg-red-500 text-white p-2 rounded-md text-sm shadow-lg">
          {error}
        </div>
      )}
    </div>
  );
}

export default App;
