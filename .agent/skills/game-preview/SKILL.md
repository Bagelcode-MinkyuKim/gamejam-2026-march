---
name: game-preview
description: Local game preview and browser launch. Automatically starts a local server and opens the game in the browser. Triggers on "run game", "preview", "launch game", "open in browser", "test game", "게임 실행", "미리보기", "실행해줘"
---

# Game Preview — 게임 실행 및 미리보기

게임 프로젝트의 로컬 서버를 시작하고 브라우저에서 바로 확인할 수 있게 합니다.
비개발자도 한 마디로 게임을 실행할 수 있도록 자동화합니다.

## 절차

### Step 1: 프로젝트 탐색

프로젝트 루트에서 게임 파일 위치를 찾는다:

```
탐색 우선순위:
1. playforge.config.json → gameDir 필드에서 경로 확인
2. game/index.html → game/ 디렉토리
3. index.html → 현재 디렉토리
4. dist/index.html → 빌드 출력 디렉토리
```

index.html을 찾지 못하면 사용자에게 위치를 물어본다.

### Step 2: 서버 도구 감지 및 실행

아래 순서로 사용 가능한 도구를 찾고, 첫 번째로 발견된 도구를 사용한다:

#### 우선순위 1: npx serve (권장)

```bash
npx --version  # npm/npx 설치 확인
```

사용 가능하면:
```bash
npx serve <gameDir> -p 3000 --no-clipboard &
```

#### 우선순위 2: python http.server

```bash
python3 --version || python --version  # Python 설치 확인
```

사용 가능하면:
```bash
cd <gameDir> && python3 -m http.server 3000 &
# 또는
cd <gameDir> && python -m http.server 3000 &
```

#### 도구 없음

Node.js와 Python이 모두 없으면 **VSCode Live Server 확장** 설치를 안내한다:

```
로컬 서버 도구를 찾을 수 없습니다.

가장 쉬운 방법: VSCode Live Server 확장 설치
1. VSCode 왼쪽 사이드바에서 확장(Extensions) 아이콘 클릭
2. "Live Server" 검색 → Ritwick Dey 제작 확장 설치
3. index.html 파일을 우클릭 → "Open with Live Server" 클릭

설치 후 에이전트에게 다시 "게임 실행해줘"라고 요청하세요.
```

### Step 3: 서버 시작 확인

서버가 시작된 후 접속 가능 여부를 확인한다:

```bash
# 서버 응답 확인 (최대 5초 대기)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

200 응답이 오면 성공. 실패하면 포트 충돌 확인:
```bash
# 포트 사용 중이면 다른 포트 시도 (3001, 3002, ...)
```

### Step 4: 로컬 IP 확인 (필수)

서버 시작 후, **반드시** 로컬 IP를 확인한다. 이 단계를 생략하지 않는다:

```bash
# Windows
ipconfig | grep -A5 "Wi-Fi" | grep "IPv4"
# 또는
ipconfig | grep "IPv4"

# Mac/Linux
ifconfig | grep "inet " | grep -v 127.0.0.1
```

### Step 5: 결과 안내

서버가 시작되면 **localhost와 로컬 IP 주소를 모두** 사용자에게 안내한다:

```
게임이 실행 중입니다!

🌐 PC 브라우저: http://localhost:<PORT>
📱 모바일 (같은 Wi-Fi): http://<로컬IP>:<PORT>

서버를 중지하려면 터미널에서 Ctrl+C를 누르세요.
```

**중요**: 모바일 테스트를 위해 로컬 IP 주소를 반드시 함께 안내한다. localhost만 안내하지 않는다.

---

## 추가 옵션

### 모바일 뷰포트 시뮬레이션 (game-eye 사용)

사용자가 "모바일에서 어떻게 보여?" 라고 물으면:

```bash
# game-eye로 모바일 뷰포트 스크린샷
game-eye screenshot http://localhost:3000 --viewport 390x844 -o mobile-preview.png
```

### 포트 지정

사용자가 특정 포트를 요청하면 해당 포트 사용:
```
/game-preview 8080  → 포트 8080 사용
```

### 이미 서버가 실행 중일 때

localhost:3000이 이미 응답하면:
```
기존 서버가 이미 실행 중입니다: http://localhost:3000
새 서버를 시작할까요? (기존 서버를 중지하고 재시작)
```

---

## file:// 직접 열기를 권장하지 않는 이유

브라우저에서 `file://` 로 HTML을 직접 열면:
- **CORS 에러**: PixiJS/Three.js 에셋 로딩 실패
- **ES 모듈 실패**: `<script type="module">` 동작 안 함
- **Web API 제한**: localStorage, fetch 등 일부 API 차단

반드시 HTTP 서버를 통해 실행해야 합니다.
