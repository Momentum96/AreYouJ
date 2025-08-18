# AreYouJ - 프로젝트 분석

## 🎯 프로젝트 개요

**AreYouJ**는 작업 관리와 진행 상황을 시각적으로 추적할 수 있는 Electron 기반의 데스크톱 애플리케이션입니다. 프로젝트의 작업들을 체계적으로 관리하고, 실시간으로 상태를 모니터링할 수 있는 대시보드를 제공합니다.

### 핵심 기능
- 📊 **실시간 작업 통계** - 전체/완료/진행중 작업 현황
- 🔍 **스마트 필터링** - 상태, 우선순위, 검색어 기반 필터링
- 📱 **반응형 테이블** - 작업 목록의 직관적인 표시
- 🖥️ **크로스 플랫폼** - Windows, macOS, Linux 지원
- 🔄 **자동 동기화** - 5초마다 데이터 자동 새로고침

## 🏗️ 기술 스택

### Frontend Framework
- **React 19.1.0** - 최신 React 기반 UI 구성
- **TypeScript** - 타입 안전성을 위한 정적 타입 시스템
- **Vite 6.3.5** - 빠른 개발 서버 및 빌드 도구

### UI & Styling
- **Tailwind CSS 4.1.10** - 유틸리티 우선 CSS 프레임워크
- **Radix UI** - 접근성이 뛰어난 headless UI 컴포넌트
  - Dialog, Progress, Collapsible, Context Menu 등
- **Lucide React** - 아이콘 라이브러리
- **Class Variance Authority** - 조건부 스타일링

### Desktop Application
- **Electron 36.5.0** - 크로스 플랫폼 데스크톱 앱
- **System Tray 지원** - 백그라운드 실행 및 트레이 아이콘
- **IPC 통신** - 메인/렌더러 프로세스 간 안전한 통신

### 개발 도구
- **ESLint** - 코드 품질 관리
- **PostCSS** - CSS 후처리
- **Electron Builder** - 앱 패키징 및 배포

## 📁 프로젝트 구조

```
areyouj/
├── src/
│   ├── components/          # React 컴포넌트
│   │   ├── Dashboard.tsx    # 메인 대시보드
│   │   ├── StatsHeader.tsx  # 통계 헤더
│   │   ├── TaskFilter.tsx   # 필터링 컴포넌트
│   │   ├── TaskTable.tsx    # 작업 테이블
│   │   └── ui/             # 재사용 가능한 UI 컴포넌트
│   ├── hooks/              # 커스텀 React 훅
│   │   ├── useTaskStats.ts  # 작업 통계 관리
│   │   └── useTaskFilter.ts # 필터링 로직
│   ├── types/              # TypeScript 타입 정의
│   │   └── task.ts         # Task 관련 타입
│   └── App.tsx             # 메인 앱 컴포넌트
├── electron/               # Electron 메인 프로세스
│   ├── main.cjs           # 메인 프로세스 로직
│   └── preload.cjs        # 프리로드 스크립트
├── public/                 # 정적 자산
│   └── tasks.json         # 작업 데이터 (개발용)
└── prompt/                # 프로젝트 가이드라인
    ├── memory-management.md
    ├── prd.md
    └── task-breakdown.md
```

## 🔧 핵심 컴포넌트 분석

### 1. App.tsx (src/App.tsx:1)
- **Electron 환경 감지** - 브라우저/Electron 환경에 따른 분기 처리
- **데이터 로딩** - JSON 파일 또는 IPC를 통한 작업 데이터 로딩
- **자동 새로고침** - 5초 간격으로 데이터 동기화
- **키보드 단축키** - Ctrl+M(최소화), F11(전체화면) 지원
- **에러 처리** - 우아한 에러 상태 표시

### 2. Dashboard.tsx (src/components/Dashboard.tsx:1)
- **통계 계산** - useTaskStats 훅을 통한 실시간 통계
- **필터링** - useTaskFilter 훅을 통한 다중 조건 필터링
- **컴포넌트 조합** - StatsHeader, TaskFilter, TaskTable 통합

### 3. Task 타입 시스템 (src/types/task.ts:1)
```typescript
interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'partial' | 'done';
  priority: 'low' | 'medium' | 'high';
  subtasks: SubTask[];
  // ... 추가 메타데이터
}
```

### 4. Electron 메인 프로세스 (electron/main.cjs:1)
- **창 관리** - 최소화, 최대화, 트레이 숨김/표시
- **시스템 트레이** - 백그라운드 실행 지원
- **IPC 핸들러** - 보안이 강화된 프로세스 간 통신
- **파일 시스템** - tasks.json 읽기 기능

## 🎨 사용자 경험 (UX)

### 반응형 디자인
- **Dark 테마** - 눈의 피로를 줄이는 어두운 테마
- **그리드 레이아웃** - 다양한 화면 크기에 적응
- **애니메이션** - 부드러운 상태 전환

### 접근성
- **ARIA 레이블** - 스크린 리더 지원
- **키보드 네비게이션** - 마우스 없이도 조작 가능
- **색상 대비** - WCAG 가이드라인 준수

## 🔄 데이터 플로우

1. **초기 로딩** - App.tsx에서 tasks.json 또는 IPC를 통해 데이터 fetch
2. **상태 관리** - React useState를 통한 로컬 상태 관리
3. **필터링** - useTaskFilter 훅에서 실시간 필터링 로직 처리
4. **통계 계산** - useTaskStats 훅에서 파생 상태 계산
5. **UI 업데이트** - 상태 변경 시 자동 리렌더링

## 🚀 개발 & 빌드

### 개발 환경
```bash
npm run dev          # 웹 개발 서버 시작
npm run electron-dev # Electron + 웹 서버 동시 실행
```

### 프로덕션 빌드
```bash
npm run build        # 웹 빌드
npm run electron-build # Electron 앱 실행
npm run dist         # 배포용 패키지 생성
```

### 플랫폼별 빌드
- **macOS** - DMG 패키지
- **Windows** - NSIS 인스톨러
- **Linux** - AppImage

## 📊 현재 상태 분석

### 완료된 기능
- ✅ 기본 프로젝트 구조 설정
- ✅ React + TypeScript + Vite 구성
- ✅ Electron 데스크톱 앱 통합
- ✅ UI 컴포넌트 라이브러리 (Radix UI + Tailwind)
- ✅ 작업 필터링 시스템
- ✅ 통계 대시보드
- ✅ 시스템 트레이 지원

### 진행 중인 작업
- 🟡 Dialog 컴포넌트 구현 (src/components/TaskDetailsModal.tsx:1)
- 🟡 API 통합 준비

### 향후 개선 사항
- 🔜 백엔드 API 연동
- 🔜 작업 수정/추가 기능
- 🔜 데이터 내보내기 (Excel 지원)
- 🔜 알림 시스템
- 🔜 테마 커스터마이징

## 🎯 프로젝트의 특장점

1. **모던 기술 스택** - 최신 React 19와 Electron 36을 활용한 현대적 아키텍처
2. **타입 안전성** - 엄격한 TypeScript 설정으로 런타임 오류 최소화
3. **사용자 중심 설계** - 직관적인 UI와 편리한 키보드 단축키
4. **확장 가능한 구조** - 모듈화된 컴포넌트와 훅으로 유지보수성 확보
5. **크로스 플랫폼** - 단일 코드베이스로 모든 OS 지원

이 프로젝트는 현대적인 데스크톱 애플리케이션의 모범 사례를 잘 보여주는 잘 구조화된 프로젝트입니다. 특히 Electron과 React의 조합, 그리고 체계적인 상태 관리와 타입 시스템이 인상적입니다.