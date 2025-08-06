const API_BASE_URL = 'http://localhost:5001/api';

export interface QueueMessage {
  id: string;
  message: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  createdAt: string;
  completedAt?: string;
  output?: string;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
}

export interface QueueStatus {
  status: string;
  queue: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
  };
  processing: {
    isProcessing: boolean;
    currentMessage: string | null;
    totalMessages: number;
    completedMessages: number;
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
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // If this is the last attempt, throw the error
        if (attempt === maxRetries) {
          throw new Error(`API 요청이 ${maxRetries + 1}번의 시도 후 실패했습니다: ${lastError.message}`);
        }

        console.warn(`API request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}`);
        
        // Only retry on network errors, not on HTTP errors that shouldn't be retried
        if (error instanceof TypeError || error.name === 'AbortError') {
          const delay = this.getRetryDelay(attempt);
          console.log(`네트워크 오류로 인해 ${Math.round(delay)}ms 후 재시도합니다...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        // Non-retryable error
        throw lastError;
      }
    }

    throw lastError!;
  }

  private async request<T = any>(
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
        
        throw new Error(errorMessage);
      }
      
      return await response.json();
    } catch (error) {
      const friendlyMessage = customErrorMessage || '요청 처리 중 오류가 발생했습니다';
      const errorMsg = error instanceof Error ? error.message : '알 수 없는 오류';
      
      console.error(`API request failed: ${endpoint}`, error);
      throw new Error(`${friendlyMessage}: ${errorMsg}`);
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

  // Stop processing
  async stopProcessing(): Promise<ApiResponse> {
    return this.request('/processing/stop', {
      method: 'POST',
    }, '작업 처리 중지에 실패했습니다');
  }

  // Health check method
  async healthCheck(): Promise<{ status: string; timestamp: string; service: string }> {
    return this.request('/health', {}, '서버 연결 확인에 실패했습니다');
  }

  // Get connection info for debugging
  getConnectionInfo(): {
    baseUrl: string;
    retryConfig: RetryConfig;
  } {
    return {
      baseUrl: API_BASE_URL,
      retryConfig: this.retryConfig
    };
  }
}

export const apiClient = new ApiClient();