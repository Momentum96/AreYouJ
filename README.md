# AI Project Dashboard

**AI와 함께 프로젝트를 체계적으로 관리하는 데스크톱 대시보드 앱**

React + Electron으로 구축된 크로스 플랫폼 작업 관리 도구입니다. AI 어시스턴트가 생성한 작업 목록을 실시간으로 추적하고 관리할 수 있습니다.

![Demo](./images/demo.png)

## 🚀 5분 만에 시작하기

### 1단계: 설치 및 실행

```bash
# 프로젝트 클론
git clone https://github.com/your-username/ai-project-dashboard.git
cd ai-project-dashboard

# 의존성 설치
npm install

# 대시보드 실행 (웹 버전)
npm run dev
# 또는 데스크톱 앱으로 실행
npm run electron-dev
```

### 2단계: AI와 첫 대화해보기

**Cursor 사용자라면:**

- 이 프로젝트를 Cursor에서 열기만 하면 됩니다
- `.cursor/` 폴더의 규칙들이 자동으로 적용됩니다
- Cursor의 Chat에서 "새 프로젝트 PRD 만들어줘"라고 말해보세요

**다른 AI 도구 사용자라면:**

- `prompt/` 폴더의 마크다운 파일을 AI에게 복사해서 붙여넣으세요
- 예: `prompt/prd.md` 내용을 ChatGPT에 붙여넣고 대화 시작

### 3단계: 작업 목록 확인

- AI가 `docs/tasks.json` 파일을 생성하거나 업데이트하면
- 대시보드에서 실시간으로 작업 목록과 진행률을 확인할 수 있습니다

## 💡 이 도구가 해결하는 문제

**기존 AI 개발의 한계:**

- 🔄 대화 세션이 바뀔 때마다 컨텍스트 손실
- 📊 프로젝트 전체 진행 상황을 파악하기 어려움
- 💸 별도 작업 관리 도구의 추가 비용

**이 도구의 해결책:**

- ✅ AI 규칙을 통한 일관된 작업 관리
- 📈 실시간 대시보드로 진행률 시각화
- 💰 이미 구독 중인 AI 도구 최대 활용

## 🔄 작업 워크플로우

```
1. 아이디어 → 2. AI 대화 → 3. tasks.json 생성 → 4. 대시보드 관리
```

### 1️⃣ 아이디어 단계

새로운 프로젝트나 기능 아이디어가 있을 때

### 2️⃣ AI 대화 단계

**.cursor/ 규칙의 역할:**

- Cursor에서 이 프로젝트를 열면 `.cursor/rules/` 폴더의 마크다운 파일들이 AI에게 자동으로 전달됩니다
- 각 파일은 특정 상황에서 AI가 어떻게 도와줄지 정의합니다:
  - `prd.md`: 아이디어를 구체적인 제품 문서로 변환
  - `task-breakdown.md`: PRD를 개발 가능한 작업 목록으로 분해
  - `task-updater.md`: 작업 진행 상황을 JSON에 반영

**대화 예시:**

```
사용자: "새로운 채팅 앱 아이디어가 있어. PRD로 만들어줘"
AI: [prd.md 규칙 적용] "어떤 사용자를 타겟으로 하시나요? 핵심 기능은..."

사용자: "이 PRD를 바탕으로 개발 계획 세워줘"
AI: [task-breakdown.md 규칙 적용] tasks.json 파일 생성

사용자: "1.2번 작업 완료했어"
AI: [task-updater.md 규칙 적용] tasks.json 업데이트
```

### 3️⃣ tasks.json 생성

AI가 `docs/tasks.json` 파일을 생성/업데이트합니다:

```json
{
  "tasks": [
    {
      "id": "1",
      "title": "사용자 인증 시스템",
      "status": "pending",
      "priority": "high",
      "subtasks": [...]
    }
  ]
}
```

### 4️⃣ 대시보드 관리

- 📊 **실시간 통계**: 전체/완료/진행중 작업 수
- 🔍 **스마트 필터**: 상태, 우선순위별 필터링
- 📱 **반응형 테이블**: 작업 목록 직관적 표시
- 🔄 **자동 동기화**: 5초마다 JSON 파일 체크

## 🛠️ 지원하는 AI 도구

| AI 도구         | 사용 방법                | 자동 적용 |
| --------------- | ------------------------ | --------- |
| **Cursor**      | 프로젝트 열기만 하면 됨  | ✅ 자동   |
| **Claude Code** | 이미 설정 완료           | ✅ 자동   |
| **Gemini CLI**  | 이미 설정 완료           | ✅ 자동   |
| **ChatGPT**     | `prompt/` 폴더 파일 복사 | ❌ 수동   |
| **Claude Web**  | `prompt/` 폴더 파일 복사 | ❌ 수동   |

## 📋 사용 가능한 AI 명령어

### PRD 생성

```
"새로운 프로젝트 아이디어가 있는데 PRD로 만들어줘"
"아이디어를 체계화해서 PRD 문서로 작성해줘"
```

### 작업 목록 생성

```
"이 PRD를 바탕으로 개발 계획을 세워줘"
"PRD에서 구체적인 작업 목록을 만들어줘"
```

### 진행 상황 관리

```
"프로젝트 대시보드를 보여줘"
"다음에 할 작업이 뭐야?"
"작업 1.2 완료했어. 메모에 'API 연동 완료'라고 적어줘"
```

## 🖥️ 실행 옵션

### 웹 버전 (개발용)

```bash
npm run dev
# http://localhost:5173에서 확인
```

### 데스크톱 앱

```bash
# 개발 모드
npm run electron-dev

# 프로덕션 빌드
npm run build
npm run electron

# 배포용 패키지 생성
npm run dist
```

## ✨ 주요 기능

- 🔄 **실시간 동기화**: tasks.json 변경 시 자동 새로고침
- 📊 **진행률 시각화**: 애니메이션 카운터와 원형 진행 표시
- 🔍 **고급 필터링**: 상태, 우선순위, 검색어로 작업 분류
- 📱 **크로스 플랫폼**: Windows, macOS, Linux 지원
- ⌨️ **키보드 단축키**: Ctrl+M(최소화), F11(전체화면)
- 🌙 **다크 테마**: 개발자 친화적 인터페이스
- 📤 **데이터 내보내기**: Excel 형식 지원

## 🎯 사용 팁

### 효과적인 AI 대화법

1. **단계별 접근**: PRD → 작업분해 → 진행관리 순서로
2. **구체적 요청**: "1.2번 작업 완료"보다는 "사용자 로그인 API 구현 완료"
3. **정기적 업데이트**: 작업 완료 시마다 AI에게 알려주기

### 프로젝트 구조 이해

```
ai-project-dashboard/
├── .cursor/rules/          # Cursor AI 규칙 (자동 적용)
├── prompt/                 # 다른 AI 도구용 규칙 (수동 복사)
├── docs/
│   ├── tasks.json         # AI가 생성하는 작업 데이터
│   └── PROJECT_ANALYSIS.md # 프로젝트 분석 문서
├── src/                   # React 앱 소스코드
└── electron/              # 데스크톱 앱 설정
```

### tasks.json 직접 편집

필요시 `docs/tasks.json`을 직접 수정할 수 있습니다:

```json
{
  "tasks": [
    {
      "id": "1",
      "title": "작업 제목",
      "description": "상세 설명",
      "status": "pending|partial|done",
      "priority": "high|medium|low",
      "subtasks": [...]
    }
  ]
}
```

## 🔧 기술 스택

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Desktop**: Electron 36
- **Build**: Vite 6
- **UI**: Shadcn/UI, Radix UI, Lucide React
- **Data**: JSON 기반 로컬 스토리지

## 🤝 기여하기

1. Fork 후 브랜치 생성
2. `.cursor/rules/` 또는 `prompt/` 폴더의 AI 규칙 개선
3. 새로운 대시보드 기능 추가
4. Pull Request 생성

## 📚 더 알아보기

- [프로젝트 상세 분석](./docs/PROJECT_ANALYSIS.md)
- [개발자 가이드](./.cursor/rules/code-guideline.md)
- [Claude Task Master](https://github.com/eyaltoledano/claude-task-master) (영감을 받은 프로젝트)
