import { useEffect, useState } from "react";
import "./App.css";
import { Dashboard } from "./components/Dashboard";
import type { Task } from "./types/task";

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);


  // 초기 데이터 로딩 및 주기적 업데이트
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const response = await fetch("/docs/tasks.json?t=" + new Date().getTime());
        if (!response.ok) {
          throw new Error(
            `태스크 데이터를 불러오는데 실패했습니다. (${response.status}: ${response.statusText})`
          );
        }
        const data = await response.json();

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
  }, [error]);

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

  return (
    <div className="dark w-full h-screen bg-background text-foreground overflow-hidden">
      <Dashboard tasks={tasks} appName={__APP_NAME__} />


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
