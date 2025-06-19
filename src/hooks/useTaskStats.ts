import { useMemo } from 'react';
import type { Task, TaskStats } from '../types/task';

export const useTaskStats = (tasks: Task[]): TaskStats => {
  return useMemo(() => {
    let total = 0;
    let completed = 0;

    tasks.forEach((task) => {
      if (task.subtasks && task.subtasks.length > 0) {
        // 서브태스크가 있으면 서브태스크 기준으로 계산
        task.subtasks.forEach((subtask) => {
          total++;
          if (subtask.status === 'done') {
            completed++;
          }
        });
      } else {
        // 서브태스크가 없으면 메인 태스크 기준
        total++;
        if (task.status === 'done') {
          completed++;
        }
      }
    });

    const progress = total > 0 ? (completed / total) * 100 : 0;

    return {
      total,
      completed,
      progress: Math.round(progress * 10) / 10, // 소수점 첫째자리까지
    };
  }, [tasks]);
}; 