# Multi-Session Claude Terminal Management System PRD

## Overview

### Problem Statement
현재 AreYouJ 시스템은 단일 Claude 세션만 지원하여, 여러 프로젝트나 디렉터리를 동시에 관리하기 어려운 상황입니다. 개발자가 동시에 여러 작업 환경에서 Claude 자동화를 실행하고 모니터링할 수 있는 시스템이 필요합니다.

### Target Users
- **Primary**: 개인 개발자 (localhost 환경에서 사용)
- **Secondary**: 소규모 팀의 개발 리드 (로컬 네트워크 환경에서 접근)

### Value Proposition
- 여러 프로젝트 디렉터리에서 동시에 Claude 작업 실행 가능
- 각 세션별 독립적인 메시지 큐 관리
- 중앙집중식 터미널 상태 모니터링 대시보드 제공
- 기존 워크플로우 완전 유지 (기존 시스템과 100% 호환)

## Business Context

### Success Metrics
- **Primary KPI**: 동시 실행 가능한 Claude 세션 수 (목표: 5개 이상)
- **User Experience**: 세션 간 전환 시간 < 2초
- **Reliability**: 세션 크래시 시 자동 복구율 > 95%
- **Performance**: 세션당 메모리 사용량 < 200MB

### Market Opportunity
개인 개발자의 멀티 프로젝트 관리 효율성 향상을 통한 생산성 증대

### Competitive Analysis
- **기존 시스템**: 단일 세션, 수동 디렉터리 전환 필요
- **신규 시스템**: 멀티 세션, 중앙집중식 관리, 자동화된 작업 할당

## Core Features

### Feature 1: Multi-Session Claude Manager
**Priority**: P0 (MVP)
**Description**: 기존 SingletonSessionManager를 Multi-SessionManager로 확장

**User Stories**:
- As a developer, I want to run Claude sessions in multiple directories simultaneously so that I can manage multiple projects at once
- As a user, I want each session to maintain its own message queue so that work doesn't interfere between projects

**Acceptance Criteria**:
- [ ] SessionManager가 여러 Claude 인스턴스를 동시에 관리할 수 있다
- [ ] 각 세션은 고유한 세션 ID와 실행 디렉터리를 가진다
- [ ] 세션별로 독립적인 메시지 큐가 유지된다
- [ ] 세션 생성/삭제 시 WebSocket 이벤트가 발생한다

**Technical Requirements**:
```javascript
// 기존: Single instance
const claudeSession = getClaudeSession();

// 신규: Multiple instances with session management
const sessionManager = getMultiSessionManager();
const sessionId = sessionManager.createSession(workingDirectory);
const session = sessionManager.getSession(sessionId);
```

### Feature 2: Claude Terminal Dashboard
**Priority**: P0 (MVP)
**Description**: 모든 실행 중인 Claude 터미널의 통합 관리 대시보드

**User Stories**:
- As a user, I want to see all running Claude terminals in one view so that I can monitor their status
- As a developer, I want to launch new terminals from the dashboard so that I can quickly start work in different directories

**Acceptance Criteria**:
- [ ] 실행 중인 모든 Claude 터미널 목록 표시
- [ ] 터미널별 정보: Index, 실행 디렉터리, 현재 작업, 진행 상황
- [ ] 새 터미널 실행 버튼 (ProjectHomePathSetting 활용)
- [ ] 터미널 종료 기능
- [ ] 실시간 상태 업데이트 (WebSocket 기반)

**Monitoring Priority**:
1. Claude 터미널 구분 Index (001, 002, 003...)
2. 해당 터미널 실행 디렉터리 위치 (`/path/to/project`)
3. 현재 작업 중인 내용 (메시지큐의 현재 처리 중인 메시지 미리보기)
4. 작업 진행 상황: `총 작업/수행된 작업/남은 작업` (예: 5/2/3)
5. Claude 터미널 종료 기능

### Feature 3: Enhanced Task Assignment Logic
**Priority**: P1
**Description**: task-updater.md 프롬프트 기반 디렉터리별 작업 할당 시스템

**User Stories**:
- As a system, I want to assign tasks to the appropriate Claude session based on the target directory
- As a developer, I want tasks to be processed by the Claude session running in the corresponding project directory

**Acceptance Criteria**:
- [ ] 작업 추가 시 대상 디렉터리 자동 감지
- [ ] 해당 디렉터리에서 실행 중인 Claude 세션으로 작업 할당
- [ ] 세션이 없는 경우 새 세션 자동 생성 옵션
- [ ] task-updater.md 프롬프트 기반 작업 수행

### Feature 4: UI Structure Reorganization
**Priority**: P1
**Description**: 기존 UI와 신규 대시보드 통합

**Current State vs New State**:
- **기존 Dashboard**: 유지 (현재 프로젝트 홈 디렉터리의 tasks.db 기반)
- **새 Claude Terminal Dashboard**: 신규 추가 (모든 실행 중인 터미널 관리)
- **Automation 페이지**: 접근 방식 변경 (우클릭 → 상세보기 모달)

**User Stories**:
- As a user, I want the existing Dashboard to remain unchanged so that my current workflow is preserved
- As a user, I want to access detailed terminal information through right-click context menus

**Acceptance Criteria**:
- [ ] 기존 Dashboard 완전 유지 (현재 프로젝트 홈 디렉터리 기반)
- [ ] 새 Claude Terminal Dashboard 추가 (멀티 세션 관리)
- [ ] Automation 페이지를 모달로 변경 (우클릭 → 상세보기)
- [ ] 기존 워크플로우 100% 호환성 유지

## User Experience

### Primary User Personas

**Developer Dave** - 멀티 프로젝트 관리자
- **Pain Points**: 여러 프로젝트 간 Claude 작업 전환이 번거로움
- **Goals**: 동시에 여러 프로젝트에서 Claude 자동화 실행
- **Usage Pattern**: 3-5개 프로젝트를 동시에 모니터링

### User Journey Mapping

```
1. 개발자가 Claude Terminal Dashboard 접근
   → 현재 실행 중인 터미널 확인

2. 새 프로젝트 작업 시작
   → "새 터미널 실행" 버튼 클릭
   → ProjectHomePathSetting으로 디렉터리 선택
   → 해당 디렉터리에서 Claude 세션 시작

3. 작업 할당 및 모니터링
   → Dashboard에서 메시지 큐에 작업 추가
   → 해당 디렉터리의 Claude 터미널에서 자동 처리
   → 실시간 진행 상황 모니터링

4. 세션 관리
   → 작업 완료된 터미널 종료
   → 필요시 새 터미널 추가 실행
```

### Interaction Flows

**터미널 생성 플로우**:
```
사용자 클릭 "새 터미널 실행"
  → ProjectHomePathSetting 모달 열기
  → 디렉터리 선택
  → 세션 생성 요청
  → 백그라운드에서 Claude 프로세스 시작
  → Dashboard에 새 터미널 항목 표시
```

**작업 할당 플로우**:
```
기존 Dashboard에서 메시지 큐 추가
  → 현재 프로젝트 홈 디렉터리 감지
  → 해당 디렉터리에서 실행 중인 세션 찾기
  → 세션의 메시지 큐에 작업 추가
  → 자동으로 순차 처리
```

## Technical Architecture

### System Components

#### 1. Multi-Session Manager
```javascript
class MultiSessionManager extends EventEmitter {
  constructor() {
    this.sessions = new Map(); // sessionId -> ClaudeSession
    this.sessionIndex = 1; // Auto-incrementing index
  }
  
  createSession(workingDirectory, options = {}) {
    const sessionId = `session-${this.sessionIndex++}`;
    const session = new ClaudeSession(sessionId, workingDirectory);
    this.sessions.set(sessionId, session);
    this.emit('session-created', { sessionId, session });
    return sessionId;
  }
  
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }
  
  getAllSessions() {
    return Array.from(this.sessions.entries());
  }
  
  destroySession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.stop();
      this.sessions.delete(sessionId);
      this.emit('session-destroyed', { sessionId });
    }
  }
}
```

#### 2. Enhanced ClaudeSession Class
```javascript
class ClaudeSession extends EventEmitter {
  constructor(sessionId, workingDirectory) {
    super();
    this.sessionId = sessionId;
    this.workingDirectory = workingDirectory;
    this.sessionIndex = sessionId.split('-')[1]; // Extract numeric index
    this.messageQueue = [];
    this.currentlyProcessing = null;
    // ... existing properties
  }
  
  getStatus() {
    return {
      sessionId: this.sessionId,
      sessionIndex: this.sessionIndex,
      workingDirectory: this.workingDirectory,
      sessionReady: this.sessionReady,
      currentlyProcessing: this.currentlyProcessing,
      queueStats: {
        total: this.messageQueue.length,
        pending: this.messageQueue.filter(m => m.status === 'pending').length,
        completed: this.messageQueue.filter(m => m.status === 'completed').length,
        processing: this.messageQueue.filter(m => m.status === 'processing').length
      },
      lastActivity: this.lastActivity
    };
  }
}
```

#### 3. WebSocket Event Extensions
```javascript
// 기존 이벤트 확장
this.emit('session-created', { sessionId, workingDirectory });
this.emit('session-destroyed', { sessionId });
this.emit('session-status-changed', { sessionId, status });
this.emit('multi-session-update', { sessions: this.getAllSessionsStatus() });
```

### Data Models

#### Session State Model
```typescript
interface SessionState {
  sessionId: string;
  sessionIndex: number;
  workingDirectory: string;
  sessionReady: boolean;
  processAlive: boolean;
  currentlyProcessing: MessageItem | null;
  queueStats: {
    total: number;
    pending: number;
    completed: number;
    processing: number;
  };
  lastActivity: number;
  createdAt: string;
  memoryUsage?: number;
}
```

#### Multi-Session API Response
```typescript
interface MultiSessionResponse {
  sessions: SessionState[];
  totalSessions: number;
  activeSessions: number;
  systemResources: {
    memoryUsage: number;
    cpuUsage: number;
  };
}
```

### API Specifications

#### New Endpoints

**GET /api/sessions**
- Response: `MultiSessionResponse`
- Description: 모든 세션 상태 조회

**POST /api/sessions**
```json
{
  "workingDirectory": "/path/to/project",
  "skipPermissions": true
}
```
- Response: `{ sessionId: string, status: SessionState }`

**DELETE /api/sessions/:sessionId**
- Response: `{ success: boolean, message: string }`

**GET /api/sessions/:sessionId/status**
- Response: `SessionState`

**POST /api/sessions/:sessionId/messages**
```json
{
  "message": "task content",
  "priority": "normal"
}
```

### Integration Points

#### Existing System Compatibility
```javascript
// 기존 코드 호환성 유지
export function getClaudeSession() {
  const multiSessionManager = getMultiSessionManager();
  // Default session for backward compatibility
  return multiSessionManager.getDefaultSession() || 
         multiSessionManager.createSession(process.cwd());
}
```

#### WebSocket Integration
```javascript
// 기존 WebSocket 구조 확장
setupWebSocket(wss) {
  const multiSessionManager = getMultiSessionManager();
  
  // Multi-session events
  multiSessionManager.on('session-created', (data) => {
    broadcastToClients({ type: 'multi-session-created', data });
  });
  
  multiSessionManager.on('session-destroyed', (data) => {
    broadcastToClients({ type: 'multi-session-destroyed', data });
  });
  
  // 기존 이벤트들 유지...
}
```

## Non-Functional Requirements

### Performance
- **Session Startup Time**: < 10초 per session
- **Memory Usage**: < 200MB per Claude session
- **WebSocket Latency**: < 100ms for status updates
- **Queue Processing**: 초당 최소 1개 메시지 처리

### Security
- **Access Control**: localhost 및 로컬 네트워크만 접근 허용 (기존 CORS 정책 유지)
- **Process Isolation**: 각 Claude 세션은 독립적인 프로세스에서 실행
- **Resource Limits**: 세션당 CPU/메모리 사용량 모니터링

### Reliability
- **Session Recovery**: 크래시된 세션 자동 재시작
- **Queue Persistence**: 각 세션별 메시지 큐 파일 시스템에 영구 저장
- **Health Monitoring**: 30초마다 세션 상태 확인

### Scalability
- **Concurrent Sessions**: 최대 10개 동시 세션 지원
- **Resource Management**: 비활성 세션 자동 정리 (1시간 비활성 후)
- **Queue Size Limits**: 세션당 최대 100개 메시지 큐 지원

## Development Roadmap

### Phase 1: Core Multi-Session Infrastructure (Week 1-2)
**MVP Scope**:
- [ ] Multi-SessionManager 구현
- [ ] 기존 ClaudeSession 클래스 확장
- [ ] 새로운 API 엔드포인트 구현
- [ ] WebSocket 이벤트 확장

**Success Criteria**:
- 2개 이상의 세션 동시 실행 가능
- 각 세션별 독립적인 메시지 큐 유지
- 기존 시스템 완전 호환성 유지

### Phase 2: Claude Terminal Dashboard UI (Week 2-3)
**Implementation Scope**:
- [ ] Claude Terminal Dashboard 컴포넌트 개발
- [ ] 세션 생성/삭제 UI
- [ ] 실시간 모니터링 뷰
- [ ] ProjectHomePathSetting 통합

**Success Criteria**:
- 모든 실행 중인 터미널 상태 표시
- 새 터미널 실행 및 종료 기능
- 실시간 진행 상황 업데이트

### Phase 3: Enhanced Task Assignment (Week 3-4)
**Implementation Scope**:
- [ ] 디렉터리별 작업 할당 로직
- [ ] task-updater.md 프롬프트 기반 처리
- [ ] 자동 세션 생성 옵션
- [ ] UI 구조 재조직

**Success Criteria**:
- 작업이 올바른 세션으로 자동 할당
- 기존 워크플로우 100% 유지
- Automation 모달 접근 구현

### Phase 4: Optimization & Monitoring (Week 4-5)
**Implementation Scope**:
- [ ] 성능 최적화
- [ ] 리소스 모니터링
- [ ] 에러 핸들링 강화
- [ ] 사용자 경험 개선

**Success Criteria**:
- 5개 이상 세션 안정적 동시 실행
- 메모리 사용량 최적화
- 세션 복구 메커니즘 완성

## Implementation Dependencies

### Task Prioritization
1. **P0 (Critical)**: Multi-SessionManager 핵심 구현
2. **P0 (Critical)**: 기존 시스템 호환성 유지
3. **P1 (High)**: Claude Terminal Dashboard UI
4. **P1 (High)**: WebSocket 이벤트 확장
5. **P2 (Medium)**: 작업 할당 로직 개선
6. **P3 (Low)**: 성능 모니터링 및 최적화

### External Dependencies
- **Existing Components**: ProjectHomePathSetting.tsx (재사용)
- **Backend Services**: 기존 WebSocket 인프라 (확장)
- **File System**: 세션별 큐 저장을 위한 디렉터리 구조
- **Process Management**: Python PTY wrapper 활용

### Team Responsibilities
- **Backend Development**: Multi-SessionManager, API endpoints
- **Frontend Development**: Claude Terminal Dashboard UI
- **Integration**: WebSocket events, existing system compatibility
- **Testing**: Multi-session scenarios, performance validation

## Risk Assessment

### Technical Risks
**Risk**: 다중 Claude 프로세스로 인한 시스템 리소스 과부하
- **Mitigation**: 세션당 리소스 제한 설정, 비활성 세션 자동 정리
- **Probability**: Medium
- **Impact**: High

**Risk**: 기존 시스템 호환성 문제
- **Mitigation**: 철저한 backward compatibility 테스트, 점진적 migration
- **Probability**: Low
- **Impact**: Critical

**Risk**: WebSocket 연결 복잡성 증가
- **Mitigation**: 이벤트 타입 분리, 클라이언트별 필터링
- **Probability**: Medium
- **Impact**: Medium

### Market Risks
**Risk**: 개인용 도구로서 과도한 복잡성
- **Mitigation**: UI 단순화, 기본값 설정 최적화
- **Probability**: Low
- **Impact**: Medium

### Resource Constraints
**Risk**: 개발 일정 지연 (단일 개발자)
- **Mitigation**: MVP 범위 엄격히 제한, 단계적 구현
- **Probability**: Medium
- **Impact**: Low

### Quality Assurance
**Risk**: 멀티세션 환경에서의 디버깅 복잡성
- **Mitigation**: 상세한 로깅 시스템, 세션별 독립적 로그
- **Probability**: High
- **Impact**: Medium

## Success Validation

### MVP Launch Criteria
- [ ] 3개 이상 세션 동시 안정 실행
- [ ] 기존 워크플로우 완전 호환성
- [ ] Claude Terminal Dashboard 기본 기능 완성
- [ ] 세션 생성/삭제 정상 동작
- [ ] 메시지 큐 독립성 유지

### Performance Benchmarks
- Session startup time < 10초
- Memory usage per session < 200MB
- WebSocket event latency < 100ms
- Queue processing rate > 1 message/second

### User Acceptance Criteria
- 기존 사용자가 추가 학습 없이 시스템 사용 가능
- 새로운 기능이 기존 워크플로우를 방해하지 않음
- 멀티 프로젝트 관리 시 생산성 향상 체감

---

## Implementation Guidelines

### Development Approach
1. **기존 시스템 완전 유지**: 모든 변경사항은 additive하게 구현
2. **점진적 확장**: 기존 SingletonSessionManager를 래핑하여 Multi-Session 지원
3. **WebSocket 확장**: 새로운 이벤트 타입 추가, 기존 이벤트 유지
4. **UI 분리**: 기존 Dashboard와 새 Terminal Dashboard 독립적 구현

### Code Quality Standards
- TypeScript 타입 안정성 유지
- React 컴포넌트 재사용성 최대화
- 에러 핸들링 일관성
- 충분한 로깅 및 디버깅 정보 제공

### Testing Strategy
- 단위 테스트: 각 세션 독립성 검증
- 통합 테스트: 멀티세션 동시 실행 시나리오
- 성능 테스트: 리소스 사용량 모니터링
- 호환성 테스트: 기존 워크플로우 검증

이 PRD는 기존 시스템의 안정성을 유지하면서 멀티세션 기능을 점진적으로 도입하는 로드맵을 제시합니다. 개인용 개발 도구로서의 단순함을 유지하면서도 강력한 멀티프로젝트 관리 기능을 제공할 수 있을 것입니다.