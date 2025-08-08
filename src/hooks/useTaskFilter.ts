import { useMemo, useState } from 'react';
import type { Task, SubTask, FilterOptions } from '../types/task';

const defaultFilters: FilterOptions = {
  status: ['pending', 'in-progress', 'done'],
  priority: ['low', 'medium', 'high'],
  showMainTasksOnly: false,
  showSubTasksOnly: false,
};

export const useTaskFilter = (tasks: Task[]) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<FilterOptions>(defaultFilters);

  const filteredTasks = useMemo(() => {
    if (!tasks.length) return [];

    return tasks.filter(task => {
      // 검색어 필터링
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = searchTerm === '' || 
        task.title.toLowerCase().includes(searchLower) ||
        task.description.toLowerCase().includes(searchLower) ||
        task.notes.toLowerCase().includes(searchLower) ||
        task.id.toLowerCase().includes(searchLower) ||
        (task.subtasks && task.subtasks.some((subtask: SubTask) =>
          subtask.title.toLowerCase().includes(searchLower) ||
          subtask.description.toLowerCase().includes(searchLower) ||
          subtask.notes.toLowerCase().includes(searchLower) ||
          subtask.id.toLowerCase().includes(searchLower)
        ));

      if (!matchesSearch) return false;

      // 상태 필터링
      const matchesStatus = filters.status.includes(task.status);
      
      // 우선순위 필터링
      const matchesPriority = filters.priority.includes(task.priority);
      
      // 메인 태스크만 보기
      if (filters.showMainTasksOnly) {
        return matchesStatus && matchesPriority && (!task.subtasks || task.subtasks.length === 0);
      }
      
      // 서브 태스크가 있는 태스크만 보기
      if (filters.showSubTasksOnly) {
        return matchesStatus && matchesPriority && task.subtasks && task.subtasks.length > 0;
      }

      return matchesStatus && matchesPriority;
    }).map(task => {
      // 서브태스크도 검색어에 따라 필터링
      if (task.subtasks && task.subtasks.length > 0 && searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const filteredSubtasks = task.subtasks.filter((subtask: SubTask) => {
          const subtaskMatches = 
            subtask.title.toLowerCase().includes(searchLower) ||
            subtask.description.toLowerCase().includes(searchLower) ||
            subtask.notes.toLowerCase().includes(searchLower) ||
            subtask.id.toLowerCase().includes(searchLower);
          
          const statusMatches = filters.status.includes(subtask.status);
          const priorityMatches = filters.priority.includes(subtask.priority);
          
          return subtaskMatches && statusMatches && priorityMatches;
        });

        // 원본 태스크에서 매치되거나, 서브태스크에서 매치되는 경우 포함
        const taskMatches = 
          task.title.toLowerCase().includes(searchLower) ||
          task.description.toLowerCase().includes(searchLower) ||
          task.notes.toLowerCase().includes(searchLower) ||
          task.id.toLowerCase().includes(searchLower);

        if (taskMatches || filteredSubtasks.length > 0) {
          return {
            ...task,
            subtasks: filteredSubtasks
          };
        }
        return null;
      }
      
      return task;
    }).filter(task => task !== null) as Task[];
  }, [tasks, searchTerm, filters]);

  const updateFilter = (key: keyof FilterOptions, value: FilterOptions[keyof FilterOptions]) => {
    setFilters(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const toggleStatusFilter = (status: 'pending' | 'in-progress' | 'done') => {
    setFilters(prev => ({
      ...prev,
      status: prev.status.includes(status)
        ? prev.status.filter(s => s !== status)
        : [...prev.status, status]
    }));
  };

  const togglePriorityFilter = (priority: 'low' | 'medium' | 'high') => {
    setFilters(prev => ({
      ...prev,
      priority: prev.priority.includes(priority)
        ? prev.priority.filter(p => p !== priority)
        : [...prev.priority, priority]
    }));
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
    setSearchTerm('');
  };

  const hasActiveFilters = useMemo(() => {
    return searchTerm !== '' ||
           filters.status.length !== 3 ||
           filters.priority.length !== 3 ||
           filters.showMainTasksOnly ||
           filters.showSubTasksOnly;
  }, [searchTerm, filters]);

  return {
    searchTerm,
    setSearchTerm,
    filters,
    filteredTasks,
    updateFilter,
    toggleStatusFilter,
    togglePriorityFilter,
    resetFilters,
    hasActiveFilters
  };
};