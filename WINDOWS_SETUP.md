# Windows 설치 가이드

## 필수 요구사항

### 1. WSL2 설치
```powershell
# PowerShell을 관리자 권한으로 실행
wsl --install
# 재부팅 후
wsl --update
```

### 2. Ubuntu 설치 (WSL 내에서)
```bash
# Windows Store에서 Ubuntu 설치 또는
wsl --install -d Ubuntu
```

### 3. Claude Code 설치 (WSL Ubuntu 내에서)
```bash
# Node.js 설치
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs

# Claude Code 설치 (WSL 내에서)
npm install -g @anthropic-ai/claude-code
```

### 4. Python 환경 설정 (WSL Ubuntu 내에서)
```bash
sudo apt update
sudo apt install python3 python3-pip
```

## 실행 방법

### Windows PowerShell/CMD에서:
```cmd
cd ai-project-dashboard
npm install
npm start
```

## 문제 해결

### WSL 연결 문제
- WSL이 실행 중인지 확인: `wsl --list --verbose`
- Claude Code가 WSL에서 작동하는지 확인: `wsl claude --version`

### 포트 충돌
- Windows 방화벽에서 5001, 5173 포트 허용
- `netstat -an | findstr :5001` 포트 사용 확인

## 알려진 제한사항

- WSL2가 필수적으로 필요함
- 첫 실행 시 WSL 초기화에 시간이 걸릴 수 있음
- Windows 터미널 환경과 다소 다른 동작 가능성