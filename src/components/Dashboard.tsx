import { useTaskStats } from "../hooks/useTaskStats";
import { useTaskFilter } from "../hooks/useTaskFilter";
import type { Task } from "../types/task";
import { StatsHeader } from "./StatsHeader";
import { TaskFilter } from "./TaskFilter";
import { TaskTable } from "./TaskTable";

interface DashboardProps {
  tasks: Task[];
  appName: string;
  isLoadingTasks?: boolean;
  onTaskDeleted?: () => void;
  error?: string | null;
}

export const Dashboard = ({ tasks, appName, isLoadingTasks = false, onTaskDeleted, error }: DashboardProps) => {
  const {
    searchTerm,
    setSearchTerm,
    filters,
    filteredTasks,
    toggleStatusFilter,
    togglePriorityFilter,
    updateFilter,
    resetFilters,
    hasActiveFilters
  } = useTaskFilter(tasks);
  
  // 전체 작업에 대한 통계 (필터링 영향 없음)
  const overallStats = useTaskStats(tasks);

  return (
    <div className="w-full h-full flex flex-col p-6 gap-4">
      <StatsHeader stats={overallStats} tasks={tasks} appName={appName} />
      
      {/* Error Message for tasks.json not found */}
      {error && error.includes('tasks.json') && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
          <div className="flex items-center space-x-2">
            <span className="text-yellow-500">⚠️</span>
            <div className="flex-1">
              <p className="text-yellow-400 font-medium">프로젝트 설정 필요</p>
              <p className="text-yellow-300/80 text-sm mt-1">{error}</p>
              <p className="text-yellow-300/60 text-xs mt-2">
                우측 상단에서 프로젝트 경로를 다른 디렉토리로 변경하거나, 현재 프로젝트에 docs/tasks.json 파일을 생성해주세요.
              </p>
            </div>
          </div>
        </div>
      )}
      
      <TaskFilter
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        filters={filters}
        onToggleStatusFilter={toggleStatusFilter}
        onTogglePriorityFilter={togglePriorityFilter}
        onUpdateFilter={updateFilter}
        onResetFilters={resetFilters}
        hasActiveFilters={hasActiveFilters}
        totalTasks={tasks.length}
        filteredCount={filteredTasks.length}
      />
      <TaskTable tasks={filteredTasks} isLoading={isLoadingTasks} onTaskDeleted={onTaskDeleted} />
    </div>
  );
};
