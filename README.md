# AI 프로젝트 대시보드

React, TypeScript, Vite, Electron으로 구축된 AI 지원 작업 관리 데스크톱 애플리케이션입니다. 실시간 작업 추적, 진행률 모니터링, 크로스 플랫폼 호환성을 제공합니다.

## 프로젝트 소개

이 프로젝트는 AI 개발 어시스턴트의 한계를 극복하고자 하는 고민에서 시작되었습니다. React-Native와 같은 최신 프레임워크로 개발할 때, AI는 종종 오래된 정보를 제공하며 대화 세션이 바뀔 때마다 작업의 연속성이 끊기는 문제를 겪곤 합니다.

claude-task-master mcp와 같은 강력한 도구들은 이러한 문제를 해결해주지만, LLM API 기반으로 작동하여 구독료 외에 추가적인 비용 부담이 발생할 수 있습니다.

이 대시보드는 "이미 구독 중인 Cursor, Claude, Gemini 같은 AI 도구를 최대한 활용하여, 특정 대화를 벗어나도 내가 얘기하고 있던 Context에 대한 정보를 유지하면서 보다 정확하고 체계적으로, 정말 내 업무를 함께 수행하는 동료처럼 도와줄 수 있는 AI 기반 프로젝트 관리를 할 수 없을까?" 라는 질문에 대한 해답입니다.

이를 위해 Taskmaster의 핵심 원리를 차용하여, (1) 아이디어를 구체적인 작업 목록(tasks.json)으로 변환해주는 **AI 프롬프트 규칙(Cursor Rules)**과 (2) 생성된 작업 목록을 한눈에 파악하고 관리할 수 있는 데스크톱 대시보드 앱을 만들었습니다.

결과적으로, 여러분은 추가 비용 없이도 AI 어시스턴트에게 프로젝트의 전체 맥락을 제공하고, 체계적인 개발 워크플로우를 유지하며, 진행 상황을 명확하게 추적할 수 있습니다.

해당 프롬프트 규칙은 Cursor Rules 뿐만 아니라 ChatGPT, Claude, Gemini 등 사용하고 있는 다양한 AI 도구에서 대화 시작 전 AI에게 제공하거나 프로젝트 단위로 대화를 관리할 수 있는 기능에서도 사용할 수 있습니다.

## 🚀 빠른 시작

### 개발 환경 설정

```bash
# 1. 종속성 설치
npm install

# 2. 웹 개발서버 시작
npm run dev

# 3. Electron 개발 모드 (웹 서버와 Electron 동시 실행)
npm run electron-dev
```

### 프로덕션 빌드

```bash
# 앱 빌드
npm run build

# Electron 앱 실행
npm run electron

# 배포용 패키지 생성
npm run dist
```

## 📋 사용 가능한 스크립트

| 스크립트               | 설명                                      |
| ---------------------- | ----------------------------------------- |
| `npm run dev`          | Vite 개발 서버 시작 (웹 브라우저용)       |
| `npm run electron-dev` | 개발 모드에서 Electron 앱 실행            |
| `npm run build`        | TypeScript 컴파일 및 프로덕션 빌드        |
| `npm run electron`     | 빌드된 파일로 Electron 앱 실행            |
| `npm run dist`         | 배포용 실행파일 생성 (macOS/Windows/Linux)|
| `npm run lint`         | ESLint 코드 검사                          |
| `npm run preview`      | 빌드된 파일 미리보기                      |

## ✨ 주요 기능

### 📊 대시보드 기능
- **실시간 작업 모니터링**: tasks.json 파일을 5초마다 자동 새로고침
- **진행률 시각화**: 애니메이션 카운터와 원형 진행률 표시
- **상태별 작업 분류**: pending, partial, done 상태로 작업 관리
- **하위 작업 지원**: 계층적 작업 구조와 의존성 관리

### 🖥️ 플랫폼 지원
- **크로스 플랫폼**: macOS, Windows, Linux 지원
- **웹/데스크톱 듀얼 모드**: 브라우저와 Electron 앱 모두 지원
- **키보드 단축키**: 최소화(Ctrl/Cmd+M), 전체화면(F11) 등

### 🎨 UI/UX
- **다크 테마**: 개발자 친화적인 다크 모드 기본 제공
- **반응형 디자인**: Tailwind CSS 기반 현대적 인터페이스
- **컴포넌트 시스템**: Shadcn/UI 기반 재사용 가능한 컴포넌트

## 🛠️ 기술 스택

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Build Tool**: Vite 6.x
- **Desktop**: Electron 36.x
- **UI Components**: Shadcn/UI, Radix UI, Lucide React
- **Data Export**: XLSX 지원

## 📂 프로젝트 구조

```
ai-project-dashboard/
├── src/
│   ├── components/          # React 컴포넌트
│   │   ├── ui/             # Shadcn/UI 컴포넌트
│   │   ├── Dashboard.tsx   # 메인 대시보드
│   │   ├── TaskTable.tsx   # 작업 테이블
│   │   └── ...
│   ├── hooks/              # 커스텀 훅
│   ├── types/              # TypeScript 타입 정의
│   └── lib/                # 유틸리티 함수
├── electron/               # Electron 메인/프리로드 스크립트
├── public/
│   └── tasks.json         # 작업 데이터 파일
└── ...
```

## 🤖 AI 어시스턴트 Cursor Rules 사용법

이 프로젝트에는 개발을 도와주는 4가지 특별한 AI 규칙이 포함되어 있습니다:

### 1. PRD 생성 규칙 (`prd`)

새롭거나 막연한 프로젝트 아이디어를 체계적인 제품 요구사항 문서(PRD)로 만들고 싶을 때 사용합니다. 이 규칙은 사용자가 제품 개요, 핵심 기능, 사용자 경험, 기술 아키텍처 등을 깊이 있게 고민하고 정의할 수 있도록 상세한 질문을 던져 PRD 작성을 돕습니다. 에이전트는 단순히 완성된 프롬프트로부터 문서를 작성하는 것이 아니라, 세부 사항을 구체화하기 위해 질문하는 프로덕트 매니저의 역할을 수행합니다.

**사용법:**

```
"새로운 프로젝트 아이디어가 있는데 PRD로 만들어줘"
"아이디어를 체계화해서 PRD 문서로 작성해줘"
```

### 2. 작업 분해 규칙 (`task-breakdown`)

완성되었거나 잘 정의된 제품 요구사항 문서(PRD)를 제공하고 이를 바탕으로 개발 계획을 생성하도록 요청할 때 사용됩니다. 에이전트는 PRD를 분석하여 제목, 설명, 우선순위, 의존성, 구현 세부 정보, 테스트 전략이 포함된 상세하고 구조화된 작업 및 하위 작업 목록을 생성합니다.

**사용법:**

```
"이 PRD를 바탕으로 개발 계획을 세워줘"
"PRD에서 구체적인 작업 목록을 만들어줘"
```

### 3. 작업 대시보드 규칙 (`task-dashboard`)

구조화된 작업 목록(`tasks.json` 파일 등)이 제공되었을 때, 프로젝트 현황을 보거나 특정 작업을 조회하거나 다음에 할 일을 알고 싶을 때 사용되는 대화형 프로젝트 대시보드입니다. 에이전트는 제공된 데이터를 기반으로 '대시보드 보여줘', '3.1번 작업 보여줘', '다음 작업 뭐야?' 같은 명령어에 응답할 수 있어야 합니다.

**사용법:**

```
"프로젝트 대시보드를 보여줘"
"다음에 할 작업이 뭐야?"
"작업 1.2를 보여줘"
```

### 4. 작업 상태 업데이트 규칙 (`task-updater`)

사용자가 특정 작업의 진행 상황을 알렸을 때 `tasks.json` 파일을 업데이트하는 것을 돕습니다. 변경사항을 반영한 정확한 JSON 업데이트 블록을 생성하고, 부모 작업의 상태를 동기화하며, 다음 할 일을 추천해줍니다.

**사용법:**

```
"태스크 1.2번 작업 거의 다 끝냈어."
"작업 3번 완료했어. 메모에 'API 연동 완료'라고 적어줘."
```

## 📋 tasks.json 파일 형식

대시보드가 읽어오는 작업 데이터는 다음과 같은 JSON 구조를 따릅니다:

```json
{
  "tasks": [
    {
      "id": "1",
      "title": "작업 제목",
      "description": "작업 설명",
      "status": "pending|partial|done",
      "notes": "작업 노트",
      "dependencies": ["이전_작업_id"],
      "priority": "high|medium|low",
      "details": "상세 구현 내용",
      "testStrategy": "테스트 전략",
      "subtasks": [...],
      "createdAt": "2025-06-20T22:27:00Z",
      "updatedAt": "2025-06-20T22:27:00Z"
    }
  ]
}
```

## 💡 사용 팁

1. **tasks.json 편집**: `public/tasks.json` 파일을 수정하면 대시보드가 자동으로 업데이트됩니다
2. **Electron vs 웹**: 개발 중에는 웹 브라우저에서, 배포할 때는 Electron 앱을 사용하세요
3. **키보드 단축키**: Electron 앱에서 `Ctrl/Cmd+M`으로 최소화, `F11`로 전체화면 전환
4. **내보내기**: 작업 데이터를 Excel 파일로 내보낼 수 있습니다

## 🔧 개발자 가이드

### 새 컴포넌트 추가
```bash
# Shadcn/UI 컴포넌트 추가
npx shadcn@latest add [component-name]
```

### 빌드 및 배포
```bash
# 개발 빌드 확인
npm run build && npm run electron

# 배포용 패키지 생성
npm run dist
```

## 📚 Reference

- [프로젝트 소개 영상](https://youtu.be/ktr-4JjDsU0)
- [Claude Task Master](https://github.com/eyaltoledano/claude-task-master)
- [Context7](https://github.com/upstash/context7)
- [Shadcn/UI](https://ui.shadcn.com/)
- [Electron 공식 문서](https://www.electronjs.org/docs)
