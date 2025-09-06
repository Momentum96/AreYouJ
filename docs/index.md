# AreYouJ Project Index

## 프로젝트 개요
**AreYouJ**는 Claude Code와 통합된 프로젝트 관리 대시보드입니다. React + Node.js 기반으로 구축되어 있으며, 현재 단일 Claude 세션을 지원합니다.

## 기술 스택

### Frontend
- **Framework**: React 19.1.0 + TypeScript
- **Build Tool**: Vite 6.3.5
- **UI Library**: Radix UI + Tailwind CSS 4.1.10
- **Desktop**: Electron 36.5.0

### Backend
- **Runtime**: Node.js + Express.js
- **Session Management**: ClaudeSessionManager (싱글톤)
- **Communication**: WebSocket + PTY Wrapper
- **Claude Integration**: Python PTY Wrapper

## 핵심 아키텍처

### 현재 세션 관리 구조
- **ClaudeSessionManager**: 단일 Claude 세션 관리
- **Location**: `server/claude/session-manager.js:16`
- **Pattern**: 싱글톤 인스턴스 (`getClaudeSession()`)
- **Features**: 메시지 큐, 자동 처리, 상태 복구, 디렉토리별 큐 관리

### 주요 컴포넌트
- `server/claude/claude_pty_wrapper.py` - Python PTY 래퍼
- `server/websocket/index.js` - WebSocket 통신
- `server/routes/api.js` - REST API 엔드포인트
- `src/components/Automation.tsx` - 프론트엔드 터미널 UI

## 개발 기록

### 진행 중인 마일스톤
- **다중 Claude 세션 지원** (Opcode ProcessRegistry 패턴 포팅)
- 목표: 여러 프로젝트/컨텍스트를 동시에 관리
- 참조: [[2025-09-04#multi-session-architecture]]

## 프로젝트 컨벤션

### 아키텍처 패턴
- Singleton 패턴 (현재 세션 관리)
- Event-driven 통신
- PTY 기반 터미널 래핑
- 메시지 큐 시스템

### 코딩 스타일
- TypeScript strict mode
- 명시적 에러 처리
- 비동기 작업: async/await 선호
- 로깅: 타임스탬프 포함한 구조적 로깅

## 활성 개발 영역

### 현재 초점
- 다중 세션 아키텍처 설계
- SessionRegistry 패턴 구현
- 레거시 호환성 유지
- UI/UX 최적화

### 다음 우선순위
- [ ] SessionRegistry 클래스 구현
- [ ] ClaudeSession 클래스 분리
- [ ] 프론트엔드 세션 탭 UI
- [ ] API 확장 및 네임스페이싱

## 설정 정보

### 중요 파일
- 설정: `server/data/settings.json`
- 큐 데이터: `server/data/queues/`
- 로그: `server/logs/claude-debug.log`

### 개발 명령어
```bash
npm run dev          # 웹 개발 서버
npm run electron-dev # Electron + 웹 서버
npm run build        # 프로덕션 빌드
```