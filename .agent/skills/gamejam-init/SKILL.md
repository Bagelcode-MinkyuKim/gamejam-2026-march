---
name: gamejam-init
description: Initialize GameBakery.ai development environment. Installs codeb (AI asset generation) and game-eye (game QA) tools and sets up the workspace. Triggers on "new game", "start game", "initialize", "setup", "install tools", "GameBakery-Init", "게임 만들어줘", "초기화", "설치해줘"
---

# GameBakery.ai 초기화

개발에 필요한 도구를 설치하고 환경을 세팅합니다.

## 절차

### 1단계: OS 확인

참가자의 운영체제를 확인합니다 (macOS / Windows / Linux).

### 2단계: Node.js 확인

게임 미리보기(로컬 서버)에 필요합니다.

```bash
node --version
```

설치되어 있으면 이 단계를 건너뛴다.

설치되어 있지 않으면 사용자에게 안내한다:

```
Node.js가 설치되어 있지 않습니다.
게임을 PC/모바일 브라우저에서 미리보기 하려면 Node.js가 필요합니다.

설치 방법:
1. https://nodejs.org 접속
2. LTS (안정 버전) 다운로드
3. 설치 마법사 실행 (Next → Next → Finish)
4. 설치 후 터미널을 재시작하세요

설치가 완료되면 다시 "게임 만들어줘"라고 말씀해주세요.
```

Node.js 설치 없이도 게임 개발 자체는 가능하지만, 미리보기 기능이 제한된다.
사용자가 설치를 원하지 않으면 다음 단계로 진행한다.

### 3단계: codeb 설치

codeb은 AI 에셋 생성 도구입니다 (이미지, 3D 모델, 효과음, 음성 등).

**macOS / Linux:**
```bash
curl -fsSL https://packages.gaia.bagelgames.com/internal-packages/codeb/install.sh | bash
```

**Windows CMD:**
```cmd
curl -fsSL https://packages.gaia.bagelgames.com/internal-packages/codeb/install.bat -o %TEMP%\install.bat && %TEMP%\install.bat
```

**Windows PowerShell:**
```powershell
irm https://packages.gaia.bagelgames.com/internal-packages/codeb/install.bat -OutFile $env:TEMP\install.bat; & cmd /c $env:TEMP\install.bat
```

설치 확인:
```bash
codeb version
```

### 4단계: codeb 인증

```bash
codeb login --token aiproxy_xxx
codeb whoami
```

토큰 발급: https://aiproxy.backoffice.bagelgames.com/console/tokens

### 5단계: game-eye 설치

game-eye는 게임 QA 도구입니다 (씬 그래프 추출, E2E 테스트 등).

**macOS / Linux:**
```bash
curl -fsSL https://packages.gaia.bagelgames.com/internal-packages/game-eye/install.sh | bash
```

**Windows:**
```cmd
curl -fsSL https://packages.gaia.bagelgames.com/internal-packages/game-eye/install.bat -o install.bat && install.bat
```

설치 확인:
```bash
game-eye --version
```

### 6단계: 환경 확인

모든 도구가 정상 설치되었는지 확인합니다:

```bash
node --version      # Node.js 버전 출력 (없으면 미리보기 제한 안내)
codeb version       # codeb 버전 출력
codeb whoami        # 인증 상태 확인
game-eye --version  # game-eye 버전 출력
```

### 7단계: 완료 안내

- "어떤 게임을 만들고 싶으신가요?"
- 2D (pixi.js) vs 3D (three.js) 선택 안내
- codeb으로 에셋 생성 가능 안내

이어서 개발 → 테스트 → 빌드 워크플로우를 안내합니다:

```
✅ 개발 환경이 준비되었습니다!

📝 게임 개발 워크플로우:
1. 게임 코드 작성 → 에이전트에게 "게임 만들어줘"
2. 에셋 생성 → codeb (이미지, 사운드, 3D 모델 등)
3. 테스트 → "게임 실행해줘" (로컬 서버 + 브라우저)
   - 같은 Wi-Fi의 모바일 기기에서도 바로 테스트 가능 (IP+포트 안내)
   - 빌드 없이 웹 브라우저로 바로 확인!
4. Android 빌드 → "APK 빌드해줘" (리모트 빌드 서버)
   - Java, Android SDK 설치 불필요
```

**참고**: 일상적인 테스트는 `game-preview` 스킬(로컬 서버)로 충분합니다. PC 브라우저와 모바일 브라우저 모두 빌드 없이 즉시 확인할 수 있습니다. Android APK/AAB가 실제로 필요한 경우에만 `playforge` 리모트 빌드를 사용합니다.

## 문제 해결

### codeb 설치 실패
- 네트워크 연결 확인
- 터미널을 재시작한 후 다시 시도
- `codeb upgrade --force`로 강제 재설치

### game-eye 설치 실패
- Chrome 브라우저가 필요합니다 (game-eye가 내부적으로 사용)
- 네트워크 연결 확인
- 터미널 재시작 후 재시도

### 권한 오류 (macOS/Linux)
- `chmod +x` 또는 `sudo`가 필요할 수 있음
