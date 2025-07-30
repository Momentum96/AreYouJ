export interface BaseTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in-progress' | 'done';
  notes: string;
  dependencies: string[];
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
}

export interface Task extends BaseTask {
  details: string;
  testStrategy: string;
  subtasks: SubTask[];
}

export interface SubTask extends BaseTask {
  details?: string;
  testStrategy?: string;
}

export interface TaskData {
  tasks: Task[];
}

export interface TaskStats {
  total: number;
  completed: number;
  progress: number;
}

export interface FilterOptions {
  status: ('pending' | 'in-progress' | 'done')[];
  priority: ('low' | 'medium' | 'high')[];
  showMainTasksOnly: boolean;
  showSubTasksOnly: boolean;
}

export interface SearchFilters {
  searchTerm: string;
  filters: FilterOptions;
}