# AreYouJ Project Index

## Project Overview

**AreYouJ?** - Claude Code 통합 개발 환경
React + Node.js 기반의 로컬 Claude 인터페이스로 PTY 기반 직접 제어 방식 채택

## Tech Stack

- **Frontend**: React 19.1.0 + TypeScript + Vite + Tailwind CSS
- **Backend**: Node.js + Express + WebSocket
- **Database**: SQLite3
- **Architecture**: PTY 기반 직접 프로세스 제어
- **UI Components**: Radix UI + Lucide React

## Architecture Patterns

- **PTY Direct Control**: 터미널 프로세스를 직접 제어하는 방식
- **WebSocket Communication**: 실시간 양방향 통신
- **SQLite Integration**: 로컬 데이터베이스 기반 상태 관리
- **Component-based UI**: React 컴포넌트 구조

### Planned Architecture (Dynamic Session Orchestration)
- **SessionOrchestrator**: 동적 세션 생성/관리 시스템
- **No-Timeout Persistence**: 수동 종료까지 세션 지속
- **Central Monitoring**: Orchestration 페이지에서 통합 관리
- **Session Isolation**: 세션별 독립적 메시지 큐 및 PTY 프로세스

## Key Files

- `server/index.js` - Express 서버 및 WebSocket 핸들러
- `server/data/settings.json` - 설정 관리
- `src/` - React 프론트엔드 코드
- `docs/tasks.db` - SQLite 데이터베이스

## Development Focus

현재 **Dynamic Session Orchestration Architecture** 에 집중 ([[2025-08-22]])
- SessionOrchestrator 기반 동적 세션 관리 시스템
- 어떤 디렉토리에서든 즉시 세션 시작 가능
- 타임아웃 없는 세션 지속성 및 중앙 모니터링
- Orchestration → Automation 페이지 플로우 구현

### Previous Focus
- 모바일 알림 및 원격 모니터링 시스템 개선 완료
- Omnara 방식 분석을 통한 개선점 도출
- 네트워크 접근성 및 CORS 이슈 해결

## Team Preferences

- Korean language preferred for documentation
- 단계별 사고과정 중시
- 실용적이고 구체적인 해결책 선호
- 코드의 'why'와 'how' 설명 중시