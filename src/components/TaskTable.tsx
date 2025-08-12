import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ChevronDown, Send, CheckCircle, AlertCircle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { SubTask, Task } from '../types/task';
import { TaskDetailsModal } from './TaskDetailsModal';
import { CircularProgress } from '@/components/ui/circular-progress';
import { apiClient } from '../utils/api';

interface TaskTableProps {
  tasks: Task[];
  isLoading?: boolean;
}

// 성능 최적화를 위해 상수를 컴포넌트 외부로 이동
const STATUS_COLORS = {
  pending: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  'in-progress': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  done: 'bg-green-500/20 text-green-300 border-green-500/30',
} as const;

const STATUS_TEXT = {
  pending: 'Pending',
  'in-progress': 'In Progress',
  done: 'Done'
} as const;

// 상태를 표시하는 뱃지 컴포넌트
const StatusBadge = ({ status }: { status: 'pending' | 'in-progress' | 'done' }) => {

  return (
    <Badge variant="outline" className={`whitespace-nowrap ${STATUS_COLORS[status]}`}>
      {STATUS_TEXT[status]}
    </Badge>
  );
};

const PRIORITY_COLORS = {
  low: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  medium: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
  high: 'bg-red-500/20 text-red-300 border-red-500/30',
} as const;

const PRIORITY_TEXT = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
} as const;

// 우선순위를 표시하는 뱃지 컴포넌트
const PriorityBadge = ({ priority }: { priority: 'low' | 'medium' | 'high' }) => {
  return (
    <Badge variant="outline" className={`whitespace-nowrap ${PRIORITY_COLORS[priority]}`}>
      {PRIORITY_TEXT[priority]}
    </Badge>
  );
};

// 그리드 셀 공통 스타일
const gridCellClass = "px-4 py-3 text-sm border-r border-border last:border-r-0";

// 서브태스크 행 컴포넌트
const SubTaskRow = ({ 
  subtask, 
  onShowDetails,
  onAddToQueue,
  isAddingToQueue
}: { 
  subtask: SubTask; 
  onShowDetails: (task: SubTask) => void;
  onAddToQueue: (taskId: string) => void;
  isAddingToQueue: string | null;
}) => (
  <ContextMenu>
    <ContextMenuTrigger asChild>
      <div className="grid grid-cols-7 bg-muted/30 hover:bg-muted/40 border-b border-border animate-in fade-in-0 slide-in-from-top-2 duration-300">
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
        <div className={`${gridCellClass} flex justify-center items-center`}>
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onAddToQueue(subtask.id);
            }}
            disabled={isAddingToQueue === subtask.id}
            className="h-8 px-2 text-xs"
          >
            {isAddingToQueue === subtask.id ? (
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <Send className="w-3 h-3 mr-1" />
                Queue
              </>
            )}
          </Button>
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

export const TaskTable = ({ tasks, isLoading = false }: TaskTableProps) => {
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [selectedTask, setSelectedTask] = useState<Task | SubTask | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isAddingToQueue, setIsAddingToQueue] = useState<string | null>(null);
  
  // Notification timeout 관리를 위한 ref
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 컴포넌트 언마운트 시 timeout 정리
  useEffect(() => {
    return () => {
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
        notificationTimeoutRef.current = null;
      }
    };
  }, []);

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

  const addTaskToQueue = async (taskId: string) => {
    if (isAddingToQueue) return;
    
    setIsAddingToQueue(taskId);
    
    try {
      const message = `agent-progress-tracker 에이전트를 활용해여 Task ${taskId}을(를) 수행하세요. 다른 Tasks들은 별도로 제가 요청을 드릴테니 해당 문제를 집중해서 해결해주세요. Think Hard, Mega Think, Ultrathink`;
      
      await apiClient.addMessage(message);
      
      // 성공 알림 표시
      setNotification({
        message: `Task ${taskId}가 메시지 큐에 등록되었습니다!`,
        type: 'success'
      });
      
      // 이전 timeout이 있다면 정리
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
      
      // 3초 후 알림 자동 제거
      notificationTimeoutRef.current = setTimeout(() => {
        setNotification(null);
        notificationTimeoutRef.current = null;
      }, 3000);
      
    } catch (error) {
      console.error('Failed to add task to queue:', error);
      setNotification({
        message: '메시지 큐 등록에 실패했습니다.',
        type: 'error'
      });
      
      // 이전 timeout이 있다면 정리
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
      }
      
      notificationTimeoutRef.current = setTimeout(() => {
        setNotification(null);
        notificationTimeoutRef.current = null;
      }, 3000);
    } finally {
      setIsAddingToQueue(null);
    }
  };

  return (
    <>
      <div className="flex-1 overflow-auto border rounded-lg bg-card">
        {/* 헤더 */}
        <div className="grid grid-cols-7 bg-muted/50 border-b border-border">
          <div className={`${gridCellClass} font-semibold`}>ID</div>
          <div className={`${gridCellClass} font-semibold`}>Title</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Status</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Priority</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Dependencies</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Notes</div>
          <div className={`${gridCellClass} font-semibold text-center`}>Actions</div>
        </div>

        {/* 바디 */}
        <div>
          {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16 space-y-4">
                <CircularProgress value={0} size={64} showValue={false} />
                <p className="text-sm text-muted-foreground">프로젝트 경로 변경 중...</p>
              </div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 space-y-2">
              <p className="text-sm text-muted-foreground">작업이 없습니다.</p>
            </div>
          ) : (
            tasks.map((task) => {
            const isExpanded = expandedTasks.has(task.id);
            const hasSubtasks = task.subtasks && task.subtasks.length > 0;

            return (
              <Collapsible key={task.id} open={isExpanded}>
                {/* 메인 태스크 행 */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div 
                      className={`grid grid-cols-7 border-b border-border ${
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
                      <div className={`${gridCellClass} flex justify-center items-center`}>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            addTaskToQueue(task.id);
                          }}
                          disabled={isAddingToQueue === task.id}
                          className="h-8 px-2 text-xs"
                        >
                          {isAddingToQueue === task.id ? (
                            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <>
                              <Send className="w-3 h-3 mr-1" />
                              Queue
                            </>
                          )}
                        </Button>
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
                          <SubTaskRow 
                            subtask={subtask} 
                            onShowDetails={showTaskDetails}
                            onAddToQueue={addTaskToQueue}
                            isAddingToQueue={isAddingToQueue}
                          />
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                )}
              </Collapsible>
            );
          }))}
        </div>
      </div>

      {/* 상세보기 모달 */}
      <TaskDetailsModal 
        task={selectedTask} 
        isOpen={isModalOpen} 
        onClose={closeModal} 
      />

      {/* 알림 */}
      {notification && (
        <div className="fixed bottom-4 right-4 z-50 max-w-md">
          <Alert className={
            notification.type === 'success' 
              ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
              : "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
          }>
            {notification.type === 'success' ? (
              <CheckCircle className="h-4 w-4 text-green-600" />
            ) : (
              <AlertCircle className="h-4 w-4 text-red-600" />
            )}
            <AlertTitle className={
              notification.type === 'success'
                ? "text-green-800 dark:text-green-200"
                : "text-red-800 dark:text-red-200"
            }>
              {notification.type === 'success' ? '성공' : '오류'}
            </AlertTitle>
            <AlertDescription className={
              notification.type === 'success'
                ? "text-green-700 dark:text-green-300"
                : "text-red-700 dark:text-red-300"
            }>
              {notification.message}
            </AlertDescription>
          </Alert>
        </div>
      )}
    </>
  );
};
