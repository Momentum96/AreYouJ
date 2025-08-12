# AI Project Dashboard - 코드베이스 개선 로드맵

## 📋 현재 상태 평가

**코드베이스 건강도**: 7.5/10

**주요 강점:**
- ✅ 모던 React + TypeScript 스택
- ✅ 실시간 WebSocket 통신 구현
- ✅ Radix UI를 통한 접근성 준수
- ✅ TailwindCSS를 통한 일관된 디자인 시스템
- ✅ Error Boundary를 통한 에러 처리
- ✅ 메모리 누수 방지를 위한 AbortController 사용

**개선 필요 영역:**
- ❌ 대형 컴포넌트 (964줄 Automation.tsx)
- ❌ TypeScript 타입 안전성 부족 (eslint-disable 사용)
- ❌ 상태 관리 최적화 필요
- ❌ 성능 최적화 미흡
- ❌ 보안 강화 필요

---

## 🎯 우선순위별 개선 로드맵

### 🔥 즉시 개선 (1-2주)

#### 1. TypeScript 타입 안전성 강화
**우선순위**: 높음 | **리스크**: 낮음

**현재 문제점:**
```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
```

**개선 방안:**
```typescript
// src/types/automation.ts - 새로 생성
export interface QueueMessage {
  id: string;
  message: string;
  timestamp: Date;
  status: 'pending' | 'processing' | 'completed' | 'error';
  result?: string;
}

export interface SessionStatus {
  status: 'idle' | 'starting' | 'ready' | 'error';
  sessionReady: boolean;
  lastActivity?: Date;
}

export interface WebSocketMessage {
  type: 'queue-update' | 'session-status' | 'terminal-output';
  data: any; // 단계적으로 구체적인 타입으로 개선
}
```

**체크리스트:**
- [ ] `src/types/automation.ts` 파일 생성
- [ ] `Automation.tsx`에서 `any` 타입 제거
- [ ] WebSocket 메시지 타입 정의
- [ ] API 응답 타입 정의

---

#### 2. 대형 컴포넌트 분할 (Automation.tsx)
**우선순위**: 높음 | **리스크**: 중간

**현재 문제점:**
- 964줄의 단일 컴포넌트
- 여러 책임 혼재 (UI, 상태관리, WebSocket, 터미널 렌더링)

**개선 방안:**
```
src/components/automation/
├── AutomationContainer.tsx     # 메인 컨테이너
├── MessageQueue.tsx           # 메시지 큐 관리
├── TerminalDisplay.tsx        # 터미널 출력 표시
├── SessionControls.tsx        # 세션 제어 버튼들
├── MessageInput.tsx           # 메시지 입력 컴포넌트
└── hooks/
    ├── useAutomationState.ts  # 상태 관리 훅
    ├── useWebSocketConnection.ts # WebSocket 연결 훅
    └── useTerminalRenderer.ts # 터미널 렌더링 훅
```

**체크리스트:**
- [ ] 컴포넌트 구조 설계
- [ ] 상태 관리 로직 분리
- [ ] WebSocket 연결 로직 커스텀 훅으로 분리
- [ ] 터미널 렌더링 로직 분리
- [ ] 기존 기능 동일성 검증

---

#### 3. 메모리 누수 방지 개선
**우선순위**: 높음 | **리스크**: 낮음

**현재 문제점:**
```typescript
// App.tsx - 5초마다 폴링하는 interval이 cleanup 안될 가능성
const intervalId = setInterval(() => fetchTasks(), 5000);
```

**개선 방안:**
```typescript
// src/hooks/usePolling.ts - 새로 생성
export const usePolling = (callback: () => void, interval: number, deps: any[]) => {
  const intervalRef = useRef<NodeJS.Timeout>();
  const isActiveRef = useRef(true);
  
  useEffect(() => {
    if (!isActiveRef.current) return;
    
    callback(); // 즉시 실행
    
    intervalRef.current = setInterval(() => {
      if (isActiveRef.current) callback();
    }, interval);
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, deps);
  
  return {
    pause: () => { isActiveRef.current = false; },
    resume: () => { isActiveRef.current = true; }
  };
};
```

**체크리스트:**
- [ ] `usePolling` 커스텀 훅 구현
- [ ] App.tsx에서 적용
- [ ] 탭 비활성화 시 폴링 일시정지 기능 추가
- [ ] WebSocket 재연결 로직 개선

---

### 🔄 중기 개선 (2-4주)

#### 4. React 성능 최적화
**우선순위**: 중간 | **리스크**: 낮음

**개선 방안:**
```typescript
// src/components/Dashboard.tsx 최적화
const Dashboard = React.memo(({ tasks, appName, isLoadingTasks, onTaskDeleted }: DashboardProps) => {
  const sortedTasks = useMemo(() => {
    return tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [tasks]);
  
  const handleTaskDeleted = useCallback(() => {
    onTaskDeleted();
  }, [onTaskDeleted]);
  
  // 컴포넌트 구현...
});
```

**체크리스트:**
- [ ] 주요 컴포넌트에 `React.memo` 적용
- [ ] 무거운 계산에 `useMemo` 적용
- [ ] 이벤트 핸들러에 `useCallback` 적용
- [ ] 불필요한 리렌더링 분석 및 최적화

---

#### 5. 상태 관리 현대화 (Zustand 도입)
**우선순위**: 중간 | **리스크**: 중간

**개선 방안:**
```typescript
// src/stores/automationStore.ts - 새로 생성
import { create } from 'zustand';

interface AutomationStore {
  messages: QueueMessage[];
  sessionStatus: SessionStatus;
  wsConnected: boolean;
  
  // Actions
  addMessage: (message: Omit<QueueMessage, 'id'>) => void;
  updateMessage: (id: string, updates: Partial<QueueMessage>) => void;
  clearMessages: () => void;
  setSessionStatus: (status: SessionStatus) => void;
  setWsConnected: (connected: boolean) => void;
}

export const useAutomationStore = create<AutomationStore>((set, get) => ({
  messages: [],
  sessionStatus: { status: 'idle', sessionReady: false },
  wsConnected: false,
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, { ...message, id: crypto.randomUUID() }]
  })),
  
  updateMessage: (id, updates) => set((state) => ({
    messages: state.messages.map(msg => 
      msg.id === id ? { ...msg, ...updates } : msg
    )
  })),
  
  clearMessages: () => set({ messages: [] }),
  setSessionStatus: (sessionStatus) => set({ sessionStatus }),
  setWsConnected: (wsConnected) => set({ wsConnected })
}));
```

**체크리스트:**
- [ ] Zustand 설치 (`npm install zustand`)
- [ ] `automationStore` 구현
- [ ] `dashboardStore` 구현
- [ ] 기존 useState 로직을 store로 마이그레이션
- [ ] 컴포넌트 간 상태 공유 최적화

---

#### 6. API 에러 처리 강화
**우선순위**: 중간 | **리스크**: 낮음

**개선 방안:**
```typescript
// src/utils/api-client.ts - 새로 생성
export class APIError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: Response
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export class APIClient {
  private baseURL: string;
  
  constructor(baseURL = '/api') {
    this.baseURL = baseURL;
  }
  
  async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃
    
    try {
      const response = await fetch(`${this.baseURL}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers
        }
      });
      
      if (!response.ok) {
        throw new APIError(
          `API 요청 실패: ${response.statusText}`,
          response.status,
          response
        );
      }
      
      return await response.json();
    } catch (error) {
      if (error instanceof APIError) throw error;
      if (error.name === 'AbortError') {
        throw new APIError('요청 시간이 초과되었습니다.', 408);
      }
      throw new APIError('네트워크 오류가 발생했습니다.', 0);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
```

**체크리스트:**
- [ ] `APIClient` 클래스 구현
- [ ] 통합된 에러 처리 로직 구현
- [ ] Retry 로직 추가
- [ ] Toast 알림을 통한 사용자 피드백 개선

---

### 🔮 장기 개선 (4-8주)

#### 7. 백엔드 아키텍처 현대화
**우선순위**: 낮음 | **리스크**: 높음

**개선 방안:**
```javascript
// server/middleware/helmet.js - 새로 생성
import helmet from 'helmet';

export const securityMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

// server/middleware/rateLimit.js
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 100, // IP당 최대 100개 요청
  message: { error: '너무 많은 요청을 보냈습니다. 잠시 후 다시 시도해주세요.' }
});
```

**체크리스트:**
- [ ] Helmet 보안 미들웨어 추가
- [ ] Rate limiting 구현
- [ ] 입력 검증 강화
- [ ] 로깅 시스템 구축
- [ ] Health check 엔드포인트 추가

---

#### 8. 메모리 최적화 (대용량 데이터 처리)
**우선순위**: 낮음 | **리스크**: 중간

**개선 방안:**
```typescript
// src/utils/MemoryOptimizedBuffer.ts - 새로 생성
export class MemoryOptimizedBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;
  private onEvict?: (items: T[]) => void;
  
  constructor(maxSize: number = 1000, onEvict?: (items: T[]) => void) {
    this.maxSize = maxSize;
    this.onEvict = onEvict;
  }
  
  add(item: T): void {
    this.buffer.push(item);
    
    if (this.buffer.length > this.maxSize) {
      const evicted = this.buffer.splice(0, this.buffer.length - this.maxSize);
      this.onEvict?.(evicted);
    }
  }
  
  getAll(): T[] {
    return [...this.buffer];
  }
  
  clear(): void {
    const items = this.buffer.splice(0);
    this.onEvict?.(items);
  }
}

// 터미널 출력에 적용
const terminalBuffer = new MemoryOptimizedBuffer<string>(500, (evicted) => {
  console.log(`${evicted.length}개의 오래된 터미널 라인을 메모리에서 제거했습니다.`);
});
```

**체크리스트:**
- [ ] 메모리 최적화 버퍼 클래스 구현
- [ ] 터미널 출력 메모리 관리 개선
- [ ] 가상 스크롤링 구현 (대량 데이터 렌더링 시)
- [ ] 메모리 사용량 모니터링 도구 추가

---

#### 9. React 렌더링 최적화 (가상화)
**우선순위**: 낮음 | **리스크**: 낮음

**개선 방안:**
```typescript
// src/components/VirtualizedList.tsx - 새로 생성
import { useMemo } from 'react';

interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
}

export function VirtualizedList<T>({ 
  items, 
  itemHeight, 
  containerHeight, 
  renderItem 
}: VirtualizedListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  
  const visibleItems = useMemo(() => {
    const start = Math.floor(scrollTop / itemHeight);
    const end = Math.min(start + Math.ceil(containerHeight / itemHeight) + 1, items.length);
    
    return items.slice(start, end).map((item, index) => ({
      item,
      index: start + index
    }));
  }, [items, scrollTop, itemHeight, containerHeight]);
  
  return (
    <div
      style={{ height: containerHeight, overflow: 'auto' }}
      onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: items.length * itemHeight, position: 'relative' }}>
        {visibleItems.map(({ item, index }) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              top: index * itemHeight,
              height: itemHeight,
              width: '100%'
            }}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**체크리스트:**
- [ ] 가상화된 리스트 컴포넌트 구현
- [ ] 대량 작업 목록에 가상화 적용
- [ ] Intersection Observer를 통한 무한 스크롤 구현
- [ ] 성능 벤치마크 측정

---

## 🔒 보안 개선 권장사항

### 즉시 적용
- [ ] **CSP (Content Security Policy) 설정**
  ```javascript
  // server/index.js에 추가
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  }));
  ```

- [ ] **입력 검증 강화**
  ```javascript
  // server/middleware/validation.js
  import { body, validationResult } from 'express-validator';
  
  export const validateMessage = [
    body('message').isLength({ min: 1, max: 1000 }).trim().escape(),
    (req, res, next) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      next();
    }
  ];
  ```

### 중기 적용
- [ ] **Rate Limiting 구현**
- [ ] **CORS 정책 강화**
- [ ] **API 키 인증 시스템 도입**

### 장기 적용
- [ ] **SSL/TLS 인증서 설정**
- [ ] **보안 헤더 완전 적용**
- [ ] **DOMPurify를 통한 XSS 방지**

---

## ⚡ 성능 최적화 권장사항

### Bundle 최적화
```typescript
// vite.config.ts 개선
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom'],
          'ui': ['@radix-ui/react-dialog', '@radix-ui/react-progress'],
          'utils': ['clsx', 'tailwind-merge']
        }
      }
    }
  }
});
```

### 이미지 최적화
- [ ] WebP 형식 이미지 사용
- [ ] 지연 로딩 (Lazy Loading) 구현
- [ ] 이미지 압축 자동화

### 캐싱 전략
```typescript
// src/utils/cache.ts
export class MemoryCache<T> {
  private cache = new Map<string, { data: T; expiry: number }>();
  
  set(key: string, data: T, ttl: number = 300000): void { // 5분 기본 TTL
    this.cache.set(key, { 
      data, 
      expiry: Date.now() + ttl 
    });
  }
  
  get(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }
}
```

---

## 📋 베스트 프랙티스 가이드라인

### 컴포넌트 설계 원칙
1. **단일 책임 원칙**: 컴포넌트는 하나의 책임만 가져야 함
2. **props 타입 정의**: 모든 props는 명시적 타입 정의
3. **기본값 설정**: 선택적 props에는 기본값 제공
4. **Error Boundary**: 오류 발생 가능 컴포넌트 래핑

### 상태 관리 원칙
1. **로컬 vs 전역**: 컴포넌트 간 공유가 필요한 상태만 전역 관리
2. **불변성 유지**: 상태 업데이트 시 불변성 원칙 준수
3. **정규화**: 중첩된 데이터는 평탄화하여 관리

### 성능 최적화 원칙
1. **메모이제이션**: 비용이 많이 드는 계산은 useMemo 사용
2. **콜백 최적화**: 이벤트 핸들러는 useCallback으로 최적화
3. **컴포넌트 분할**: React.memo로 불필요한 리렌더링 방지

---

## ✅ 코드 리뷰 체크리스트

### TypeScript
- [ ] `any` 타입 사용 금지
- [ ] 모든 함수 매개변수 타입 명시
- [ ] 반환 타입 명시적 선언
- [ ] 인터페이스 vs 타입 적절한 선택

### React
- [ ] 컴포넌트 크기 200줄 이하 유지
- [ ] useEffect 의존성 배열 정확성
- [ ] 메모리 누수 방지 (cleanup 함수)
- [ ] key prop 적절한 사용

### 성능
- [ ] 무거운 계산 메모이제이션
- [ ] 이벤트 핸들러 최적화
- [ ] 불필요한 리렌더링 확인
- [ ] Bundle 크기 모니터링

### 보안
- [ ] 사용자 입력 검증
- [ ] XSS 방지 처리
- [ ] API 엔드포인트 보호
- [ ] 민감한 정보 노출 금지

### 테스트
- [ ] 단위 테스트 커버리지 80% 이상
- [ ] 통합 테스트 주요 플로우
- [ ] E2E 테스트 핵심 기능
- [ ] 에러 케이스 테스트

---

## 📊 진행 상황 추적

### 즉시 개선 (Week 1-2)
- [ ] TypeScript 타입 안전성 강화 (0/4)
- [ ] Automation 컴포넌트 분할 (0/5)
- [ ] 메모리 누수 방지 개선 (0/4)

### 중기 개선 (Week 3-4)
- [ ] React 성능 최적화 (0/4)
- [ ] Zustand 상태 관리 도입 (0/5)
- [ ] API 에러 처리 강화 (0/4)

### 장기 개선 (Week 5-8)
- [ ] 백엔드 아키텍처 현대화 (0/5)
- [ ] 메모리 최적화 구현 (0/4)
- [ ] React 렌더링 최적화 (0/4)

---

## 🚀 다음 단계

1. **즉시 시작**: TypeScript 타입 안전성 강화부터 시작
2. **점진적 마이그레이션**: 기존 기능 보존하면서 단계적 개선
3. **테스트 주도**: 각 개선 단계마다 테스트 코드 작성
4. **성능 측정**: 개선 전후 성능 비교 측정
5. **문서화**: 변경 사항에 대한 문서 업데이트

이 로드맵을 따라 진행하면 코드베이스 품질을 8.5-9.0/10 수준으로 향상시킬 수 있습니다.

---

**마지막 업데이트**: 2025-08-12  
**다음 리뷰 예정일**: 2025-08-19