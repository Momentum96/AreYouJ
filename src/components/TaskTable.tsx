import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import type { SubTask, Task } from '../types/task';
import { TaskDetailsModal } from './TaskDetailsModal';

interface TaskTableProps {
  tasks: Task[];
}

// 상태를 표시하는 뱃지 컴포넌트
const StatusBadge = ({ status }: { status: 'pending' | 'partial' | 'done' }) => {
  const colors = {
    pending: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    partial: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    done: 'bg-green-500/20 text-green-300 border-green-500/30',
  };

  const text = {
    pending: 'Pending',
    partial: 'In Progress',
    done: 'Done'
  }

  return (
    <Badge variant="outline" className={`whitespace-nowrap ${colors[status]}`}>
      {text[status]}
    </Badge>
  );
};

// 우선순위를 표시하는 뱃지 컴포넌트
const PriorityBadge = ({ priority }: { priority: 'low' | 'medium' | 'high' }) => {
  const colors = {
    low: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    medium: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    high: 'bg-red-500/20 text-red-300 border-red-500/30',
  };
  
  const text = {
    low: 'Low',
    medium: 'Medium',
    high: 'High'
  }

  return (
    <Badge variant="outline" className={`whitespace-nowrap ${colors[priority]}`}>
      {text[priority]}
    </Badge>
  );
};

// 그리드 셀 공통 스타일
const gridCellClass = "px-4 py-3 text-sm border-r border-border last:border-r-0";

// 서브태스크 행 컴포넌트
const SubTaskRow = ({ subtask, onShowDetails }: { subtask: SubTask; onShowDetails: (task: SubTask) => void }) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>
      <div className="grid grid-cols-6 bg-muted/30 hover:bg-muted/40 border-b border-border animate-in fade-in-0 slide-in-from-top-2 duration-300">
        <div className={`${gridCellClass} pl-12 font-mono`}>{subtask.id}</div>
        <div className={gridCellClass}>
          <div className="space-y-1">
            <p className="font-medium">{subtask.title}</p>
            <p className="text-xs text-muted-foreground line-clamp-2">{subtask.description}</p>
          </div>
        </div>
        <div className={`${gridCellClass} flex justify-center items-center`}>
          <StatusBadge status={subtask.status} />
        </div>
        <div className={`${gridCellClass} flex justify-center items-center`}>
          <PriorityBadge priority={subtask.priority} />
        </div>
        <div className={`${gridCellClass} font-mono text-xs text-center`}>
          {subtask.dependencies.length > 0 ? subtask.dependencies.join(', ') : '-'}
        </div>
        <div className={gridCellClass}>
          <p className="text-xs text-muted-foreground break-words">
            {subtask.notes || 'None'}
          </p>
        </div>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem onClick={() => onShowDetails(subtask)}>
        View Details
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
);

export const TaskTable = ({ tasks }: TaskTableProps) => {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | SubTask | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const toggleTask = (taskId: string) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedTasks(newExpanded);
  };

  const showTaskDetails = (task: Task | SubTask) => {
    setSelectedTask(task);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedTask(null);
  };

  return (
    <>
      <div className="flex-1 overflow-auto border rounded-lg bg-card">
        {/* 헤더 */}
        <div className="grid grid-cols-6 bg-muted/50 border-b border-border">
          <div className={`${gridCellClass} font-semibold`}>ID</div>
          <div className={`${gridCellClass} font-semibold`}>Title</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Status</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Priority</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Dependencies</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Notes</div>
        </div>

        {/* 바디 */}
        <div>
          {tasks.map((task) => {
            const isExpanded = expandedTasks.has(task.id);
            const hasSubtasks = task.subtasks && task.subtasks.length > 0;

            return (
              <Collapsible key={task.id} open={isExpanded}>
                {/* 메인 태스크 행 */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div 
                      className={`grid grid-cols-6 border-b border-border ${
                        hasSubtasks 
                          ? 'cursor-pointer hover:bg-muted/30' 
                          : 'hover:bg-muted/20'
                      } transition-colors`}
                      onClick={() => hasSubtasks && toggleTask(task.id)}
                    >
                      <div className={`${gridCellClass} font-mono`}>
                        <div className="flex items-center gap-2">
                          {hasSubtasks ? (
                            <Button variant="ghost" size="sm" className="h-4 w-4 p-0 hover:bg-muted/80">
                              <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                                <ChevronDown className="h-3 w-3" />
                              </div>
                            </Button>
                          ) : (
                            <div className="w-4 h-4" />
                          )}
                          {task.id}
                        </div>
                      </div>
                      <div className={gridCellClass}>
                        <div className="space-y-1">
                          <p className="font-medium">{task.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {task.description}
                          </p>
                        </div>
                      </div>
                      <div className={`${gridCellClass} flex justify-center items-center`}>
                        <StatusBadge status={task.status} />
                      </div>
                      <div className={`${gridCellClass} flex justify-center items-center`}>
                        <PriorityBadge priority={task.priority} />
                      </div>
                      <div className={`${gridCellClass} font-mono text-xs text-center`}>
                        {task.dependencies.length > 0 ? task.dependencies.join(', ') : '-'}
                      </div>
                      <div className={gridCellClass}>
                        <p className="text-xs text-muted-foreground break-words">
                          {task.notes || 'None'}
                        </p>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => showTaskDetails(task)}>
                      View Details
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                
                {/* 서브태스크가 있을 경우 렌더링 */}
                {hasSubtasks && (
                  <CollapsibleContent className="data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up overflow-hidden">
                    <div className={`data-[state=closed]:opacity-0 data-[state=open]:opacity-100 transition-opacity duration-100`}>
                      {task.subtasks!.map((subtask, index) => (
                        <div 
                          key={subtask.id} 
                          className={`${isExpanded ? 'animate-in fade-in-0 slide-in-from-top-1 duration-300' : ''}`}
                          style={{ animationDelay: isExpanded ? `${index * 50}ms` : '0ms' }}
                        >
                          <SubTaskRow subtask={subtask} onShowDetails={showTaskDetails} />
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                )}
              </Collapsible>
            );
          })}
        </div>
      </div>

      {/* 상세보기 모달 */}
      <TaskDetailsModal 
        task={selectedTask} 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />
    </>
  );
};
