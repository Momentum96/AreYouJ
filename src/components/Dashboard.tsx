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
}

export const Dashboard = ({ tasks, appName, isLoadingTasks = false, onTaskDeleted }: DashboardProps) => {
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
