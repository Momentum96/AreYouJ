import { useTaskStats } from '../hooks/useTaskStats';
import type { Task } from '../types/task';
import { StatsHeader } from './StatsHeader';
import { TaskTable } from './TaskTable';

interface DashboardProps {
  tasks: Task[];
}

export const Dashboard = ({ tasks }: DashboardProps) => {
  const stats = useTaskStats(tasks);

  return (
    <div className="w-full h-full flex flex-col p-6">
      <StatsHeader stats={stats} />
      <TaskTable tasks={tasks} />
    </div>
  );
}; 