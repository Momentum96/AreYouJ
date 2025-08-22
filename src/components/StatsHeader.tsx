import { AnimatedCounter } from "@/components/ui/animated-counter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CircularProgress } from "@/components/ui/circular-progress";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { exportToExcel } from "@/lib/utils";
import { FileDown } from "lucide-react";
import { useState } from "react";
import type { Task, TaskStats } from "../types/task";

interface StatsHeaderProps {
  stats: TaskStats;
  tasks: Task[];
  appName: string;
}

export const StatsHeader = ({ stats, tasks, appName }: StatsHeaderProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleExport = async (includeDetails: boolean) => {
    const today = new Date();
    const formattedDate = `${today.getFullYear()}${(today.getMonth() + 1)
      .toString()
      .padStart(2, "0")}${today.getDate().toString().padStart(2, "0")}`;
    try {
      await exportToExcel(tasks, `${appName}-tasks-${formattedDate}`, includeDetails);
      setIsModalOpen(false); // Close modal after export
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

    return (
      <Card>
      <CardContent className="py-4 px-4 md:px-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 md:gap-8">
            <div className="text-center md:text-left">
              <p className="text-xs font-medium text-muted-foreground">
                All Task
              </p>
              <p className="text-lg md:text-xl font-bold">
                <AnimatedCounter value={stats.total} duration={1500} />
              </p>
            </div>
            <div className="text-center md:text-left">
              <p className="text-xs font-medium text-muted-foreground">
                Completed Task
              </p>
              <p className="text-lg md:text-xl font-bold text-green-400">
                <AnimatedCounter value={stats.completed} duration={1500} />
              </p>
            </div>
            <div className="text-center md:text-left">
              <p className="text-xs font-medium text-muted-foreground">
                Remaining Task
              </p>
              <p className="text-lg md:text-xl font-bold text-blue-400">
                <AnimatedCounter
                  value={stats.total - stats.completed}
                  duration={1800}
                />
              </p>
            </div>
          </div>

          <div className="flex items-center justify-center md:justify-end gap-4 md:gap-6">
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs md:text-sm">
                  <FileDown className="w-3 h-3 md:w-4 md:h-4 mr-1 md:mr-2" />
                  <span className="hidden sm:inline">Export to </span>Excel
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Export Options</DialogTitle>
                  <DialogDescription>
                    Would you like to include the 'details' column in the Excel
                    export? It may contain a lot of text.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="secondary"
                    onClick={() => handleExport(false)}
                  >
                    Export without Details
                  </Button>
                  <Button onClick={() => handleExport(true)}>
                    Include Details & Export
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <CircularProgress
              value={stats.progress}
              size={60}
              strokeWidth={5}
              showValue={true}
              duration={1500}
              className="md:w-20 md:h-20"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
