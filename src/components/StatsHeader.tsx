import { AnimatedCounter } from '@/components/ui/animated-counter';
import { Card, CardContent } from '@/components/ui/card';
import { CircularProgress } from '@/components/ui/circular-progress';
import type { TaskStats } from '../types/task';

interface StatsHeaderProps {
  stats: TaskStats;
}

export const StatsHeader = ({ stats }: StatsHeaderProps) => {
  return (
    <Card className="mb-4">
      <CardContent className="py-4 px-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div>
              <p className="text-xs font-medium text-muted-foreground">All Task</p>
              <p className="text-xl font-bold">
                <AnimatedCounter value={stats.total} duration={1500} />
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Completed Task</p>
              <p className="text-xl font-bold text-green-400">
                <AnimatedCounter value={stats.completed} duration={1500} />
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Remaining Task</p>
              <p className="text-xl font-bold text-blue-400">
                <AnimatedCounter value={stats.total - stats.completed} duration={1800} />
              </p>
            </div>
          </div>
          <div className="flex items-center ml-6">
            <CircularProgress 
              value={stats.progress} 
              size={80} 
              strokeWidth={6}
              showValue={true}
              duration={1500}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}; 