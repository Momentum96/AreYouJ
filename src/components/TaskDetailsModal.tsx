import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import type { SubTask, Task } from '../types/task';

interface TaskDetailsModalProps {
  task: Task | SubTask | null;
  isOpen: boolean;
  onClose: () => void;
}

// 상태를 표시하는 뱃지 컴포넌트
const StatusBadge = ({ status }: { status: 'pending' | 'partial' | 'done' }) => {
  const colors = {
    pending: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
    partial: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    done: 'bg-green-500/20 text-green-300 border-green-500/30',
  };

  const text = {
    pending: '대기',
    partial: '진행중',
    done: '완료'
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
    low: '낮음',
    medium: '보통',
    high: '높음'
  }

  return (
    <Badge variant="outline" className={`whitespace-nowrap ${colors[priority]}`}>
      {text[priority]}
    </Badge>
  );
};

// ISO 날짜 문자열을 'YYYY-MM-DD HH:MM:SS' 형식으로 변환
const formatISODate = (isoString: string) => {
  const date = new Date(isoString);
  const pad = (num: number) => num.toString().padStart(2, '0');

  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  const seconds = pad(date.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// 마크다운 형태의 텍스트를 간단하게 렌더링하는 컴포넌트
const MarkdownRenderer = ({ content }: { content: string }) => {
  const renderContent = (text: string) => {
    // 코드 블록 처리
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const parts = text.split(codeBlockRegex);
    
    return parts.map((part, index) => {
      if (index % 3 === 0) {
        // 일반 텍스트 부분
        return part.split('\n').map((line, lineIndex) => {
          // 헤딩 처리
          if (line.startsWith('### ')) {
            return <h3 key={lineIndex} className="text-md font-semibold mt-4 mb-2">{line.substring(4)}</h3>;
          }
          if (line.startsWith('## ')) {
            return <h2 key={lineIndex} className="text-lg font-semibold mt-4 mb-2">{line.substring(3)}</h2>;
          }
          if (line.startsWith('# ')) {
            return <h1 key={lineIndex} className="text-xl font-bold mt-4 mb-2">{line.substring(2)}</h1>;
          }
          // 리스트 처리
          if (line.startsWith('- ')) {
            return <li key={lineIndex} className="ml-4 list-disc">{line.substring(2)}</li>;
          }
          if (line.match(/^\d+\. /)) {
            return <li key={lineIndex} className="ml-4 list-decimal">{line.replace(/^\d+\. /, '')}</li>;
          }
          // 인라인 코드 처리
          const inlineCodeRegex = /`([^`]+)`/g;
          const textWithCode = line.replace(inlineCodeRegex, '<code class="bg-muted px-1 py-0.5 rounded text-sm font-mono">$1</code>');
          
          return line.trim() ? <p key={lineIndex} className="mb-2" dangerouslySetInnerHTML={{ __html: textWithCode }} /> : <br key={lineIndex} />;
        });
      } else if (index % 3 === 1) {
        // 언어 부분 (무시)
        return null;
      } else {
        // 코드 블록 내용
        return (
          <pre key={index} className="bg-muted p-3 rounded-md overflow-x-auto mb-4">
            <code className="text-sm font-mono">{part}</code>
          </pre>
        );
      }
    });
  };

  return <div className="prose prose-sm max-w-none">{renderContent(content)}</div>;
};

export const TaskDetailsModal = ({ task, isOpen, onClose }: TaskDetailsModalProps) => {
  if (!task) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{task.id}</span>
            <span>{task.title}</span>
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </DialogTitle>
          <DialogDescription className="text-left pt-1">
            {task.description}
          </DialogDescription>
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2">
            <span>
              <strong>createdAt:</strong> {formatISODate(task.createdAt)}
            </span>
            <span>
              <strong>updatedAt:</strong> {formatISODate(task.updatedAt)}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-6 pt-4">
          {/* 기본 정보 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="font-semibold mb-2">Dependencies</h3>
              <p className="text-sm text-muted-foreground">
                {task.dependencies.length > 0 ? task.dependencies.join(', ') : '없음'}
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Notes</h3>
              <p className="text-sm text-muted-foreground">{task.notes || '없음'}</p>
            </div>
          </div>

          {/* Details 섹션 */}
          {'details' in task && task.details && (
            <div>
              <h3 className="font-semibold mb-3 text-lg">상세 내용</h3>
              <div className="border rounded-lg p-4 bg-muted/20">
                <MarkdownRenderer content={task.details} />
              </div>
            </div>
          )}

          {/* Test Strategy 섹션 */}
          {'testStrategy' in task && task.testStrategy && (
            <div>
              <h3 className="font-semibold mb-3 text-lg">테스트 전략</h3>
              <div className="border rounded-lg p-4 bg-muted/20">
                <MarkdownRenderer content={task.testStrategy} />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}; 