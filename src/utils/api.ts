const API_BASE_URL = 'http://localhost:5001/api';

export interface QueueMessage {
  id: string;
  message: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  createdAt: string;
  completedAt?: string;
  output?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

// API Error types for better error handling
export class ApiError extends Error {
  public status: number;
  public type: 'network' | 'server' | 'client' | 'timeout' | 'unknown';

  constructor(
    message: string,
    status: number,
    type: 'network' | 'server' | 'client' | 'timeout' | 'unknown' = 'unknown'
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
  }

  static fromResponse(response: Response, message?: string): ApiError {
    const status = response.status;
    let type: ApiError['type'] = 'unknown';
    
    if (status >= 400 && status < 500) {
      type = 'client';
    } else if (status >= 500) {
      type = 'server';
    }

    return new ApiError(
      message || `HTTP ${status}: ${response.statusText}`,
      status,
      type
    );
  }

  static fromNetworkError(error: Error): ApiError {
    if (error.name === 'AbortError') {
      return new ApiError('요청 시간이 초과되었습니다', 408, 'timeout');
    }
    if (error instanceof TypeError) {
      return new ApiError('네트워크 연결에 실패했습니다', 0, 'network');
    }
    return new ApiError(error.message, 0, 'unknown');
  }
}

export interface QueueStatus {
  status: string;
  queue: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    error?: number;
  };
  processing: {
    isProcessing: boolean;
    currentMessage: string | null;
    totalMessages: number;
    completedMessages: number;
  };
  claude?: {
    sessionReady?: boolean;
  };
}

// API retry configuration
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  retryOn: number[];
  timeout: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  retryOn: [408, 429, 500, 502, 503, 504], // HTTP status codes to retry on
  timeout: 30000, // 30 seconds
};

export class ApiClient {
  private retryConfig: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  private getRetryDelay(attempt: number): number {
    const { baseDelay, maxDelay } = this.retryConfig;
    return Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
  }

  private async fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
    const { maxRetries, retryOn, timeout } = this.retryConfig;
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Setup timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        clearTimeout(timeoutId);

        // If response is successful or shouldn't be retried, return it
        if (response.ok || !retryOn.includes(response.status)) {
          return response;
        }

        // Prepare for retry
        if (attempt < maxRetries) {
          console.warn(`API request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${response.status} ${response.statusText}`);
          const delay = this.getRetryDelay(attempt);
          console.log(`Retrying in ${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Last attempt failed
        throw ApiError.fromResponse(response);

      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          const apiError = ApiError.fromNetworkError(lastError);
          throw new ApiError(
            `API 요청이 ${maxRetries + 1}번의 시도 후 실패했습니다: ${apiError.message}`,
            apiError.status,
            apiError.type
          );
        }

        console.warn(`API request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`);
        
        // Only retry on network errors, not on HTTP errors that shouldn't be retried
        if (error instanceof TypeError || (error as Error).name === 'AbortError') {
          const delay = this.getRetryDelay(attempt);
          console.log(`네트워크 오류로 인해 ${Math.round(delay)}ms 후 재시도합니다...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable error
        throw ApiError.fromNetworkError(lastError);
      }
    }

    throw lastError!;
  }

  private async request<T = unknown>(
    endpoint: string,
    options: RequestInit = {},
    customErrorMessage?: string
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;

    try {
      const response = await this.fetchWithRetry(url, options);
      
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        
        try {
          const errorData = await response.json();
          if (errorData.error) {
            errorMessage = errorData.error;
          }
        } catch {
          // Could not parse error response as JSON
        }
        
        throw ApiError.fromResponse(response, errorMessage);
      }
      
      return await response.json();
    } catch (error) {
      const friendlyMessage = customErrorMessage || '요청 처리 중 오류가 발생했습니다';
      
      if (error instanceof ApiError) {
        console.error(`API request failed: ${endpoint}`, {
          status: error.status,
          type: error.type,
          message: error.message
        });
        
        // Provide more specific error messages based on error type
        let specificMessage = friendlyMessage;
        switch (error.type) {
          case 'network':
            specificMessage = '네트워크 연결을 확인해주세요';
            break;
          case 'timeout':
            specificMessage = '서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요';
            break;
          case 'server':
            specificMessage = '서버에 문제가 발생했습니다. 잠시 후 다시 시도해주세요';
            break;
          case 'client':
            specificMessage = error.message; // Use the specific error message for client errors
            break;
        }
        
        throw new ApiError(`${specificMessage}`, error.status, error.type);
      }
      
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      console.error(`API request failed: ${endpoint}`, error);
      throw new ApiError(`${friendlyMessage}: ${errorMsg}`, 0, 'unknown');
    }
  }

  // Get system status
  async getStatus(): Promise<QueueStatus> {
    return this.request('/status', {}, '시스템 상태를 불러오지 못했습니다');
  }

  // Get queue messages
  async getQueue(): Promise<{ messages: QueueMessage[]; total: number }> {
    return this.request('/queue', {}, '큐 데이터를 불러오지 못했습니다');
  }

  // Add message to queue
  async addMessage(message: string): Promise<ApiResponse> {
    if (!message.trim()) {
      throw new Error('메시지 내용을 입력해주세요');
    }

    return this.request('/queue/add', {
      method: 'POST',
      body: JSON.stringify({ message: message.trim() }),
    }, '메시지 추가에 실패했습니다');
  }

  // Delete message from queue
  async deleteMessage(id: string): Promise<ApiResponse> {
    if (!id) {
      throw new Error('삭제할 메시지 ID가 필요합니다');
    }

    return this.request(`/queue/${id}`, {
      method: 'DELETE',
    }, '메시지 삭제에 실패했습니다');
  }

  // Clear queue
  async clearQueue(): Promise<ApiResponse> {
    return this.request('/queue', {
      method: 'DELETE',
    }, '큐 전체 삭제에 실패했습니다');
  }

  // Start processing
  async startProcessing(): Promise<ApiResponse> {
    return this.request('/processing/start', {
      method: 'POST',
    }, '작업 처리 시작에 실패했습니다');
  }

  // Stop processing (legacy - for backward compatibility)
  async stopProcessing(): Promise<ApiResponse> {
    return this.request('/processing/stop', {
      method: 'POST',
    }, '작업 처리 중지에 실패했습니다');
  }

  // Stop Claude session (proper session termination)
  async stopClaudeSession(): Promise<ApiResponse> {
    return this.request('/claude/stop', {
      method: 'POST',
    }, 'Claude 세션 종료에 실패했습니다');
  }

  // Send keypress to Claude terminal (ESC, Enter, etc.)
  async sendKeypress(key: string): Promise<ApiResponse> {
    if (!key || typeof key !== 'string') {
      throw new Error('키 이름을 입력해주세요');
    }

    return this.request('/claude/keypress', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }, `'${key}' 키 전송에 실패했습니다`);
  }

  // Health check method
  async healthCheck(): Promise<{ status: string; timestamp: string; service: string }> {
    return this.request('/health', {}, '서버 연결 확인에 실패했습니다');
  }

  // Get connection info for debugging
  getConnectionInfo(): {
    baseUrl: string;
    retryConfig: RetryConfig;
    timestamp: string;
  } {
    return {
      baseUrl: API_BASE_URL,
      retryConfig: this.retryConfig,
      timestamp: new Date().toISOString()
    };
  }

  // Health check with retry logic
  async healthCheckWithRetry(): Promise<{ 
    status: string; 
    timestamp: string; 
    service: string;
    retryAttempts: number;
  }> {
    let retryAttempts = 0;
    const maxRetries = 3;
    
    while (retryAttempts <= maxRetries) {
      try {
        const result = await this.healthCheck();
        return { ...result, retryAttempts };
      } catch (error) {
        retryAttempts++;
        if (retryAttempts > maxRetries) {
          throw error;
        }
        // 짧은 딜레이 후 재시도
        await new Promise(resolve => setTimeout(resolve, 1000 * retryAttempts));
      }
    }
    
    // TypeScript를 위한 fallback (실제로는 도달하지 않음)
    throw new ApiError('Health check failed after all retries', 500, 'server');
  }

  // Delete task by ID
  async deleteTask(taskId: string): Promise<{
    success: boolean;
    deletedTask: { id: string; title: string };
    remainingTasks: number;
  }> {
    if (!taskId || typeof taskId !== 'string') {
      throw new Error('Task ID를 입력해주세요');
    }

    return this.request(`/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    }, `Task 삭제에 실패했습니다 (ID: ${taskId})`);
  }
}

export const apiClient = new ApiClient();