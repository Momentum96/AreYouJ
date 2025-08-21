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

## Key Files

- `server/index.js` - Express 서버 및 WebSocket 핸들러
- `server/data/settings.json` - 설정 관리
- `src/` - React 프론트엔드 코드
- `docs/tasks.db` - SQLite 데이터베이스

## Development Focus

현재 **모바일 알림 및 원격 모니터링 시스템** 개선에 집중
- Omnara 방식 분석을 통한 개선점 도출
- 사용자 경험 향상을 위한 UI/UX 개선
- 다중 프로젝트/에이전트 관리 기능 검토

## Team Preferences

- Korean language preferred for documentation
- 단계별 사고과정 중시
- 실용적이고 구체적인 해결책 선호
- 코드의 'why'와 'how' 설명 중시