import { useTaskStats } from "../hooks/useTaskStats";
import type { Task } from "../types/task";
import { StatsHeader } from "./StatsHeader";
import { TaskTable } from "./TaskTable";

interface DashboardProps {
  tasks: Task[];
  appName: string;
}

export const Dashboard = ({ tasks, appName }: DashboardProps) => {
  const stats = useTaskStats(tasks);

  return (
    <div className="w-full h-full flex flex-col p-6">
      <StatsHeader stats={stats} tasks={tasks} appName={appName} />
      <TaskTable tasks={tasks} />
    </div>
  );
};
