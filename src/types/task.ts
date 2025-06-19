export interface SubTask {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'partial' | 'done';
  notes?: string;
  dependencies: string[];
  priority: 'low' | 'medium' | 'high';
  details: string;
  testStrategy: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'partial' | 'done';
  notes?: string;
  dependencies: string[];
  priority: 'low' | 'medium' | 'high';
  details: string;
  testStrategy: string;
  subtasks?: SubTask[];
}

export interface TaskData {
  tasks: Task[];
}

export interface TaskStats {
  total: number;
  completed: number;
  progress: number;
} 