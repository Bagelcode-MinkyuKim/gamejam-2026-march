---
name: mobile-check
description: Audit HTML5 game projects for mobile/Android deployment readiness. Runs static checks (viewport/scaling/input/audio/playforge config) and runtime checks with game-eye (portrait/landscape layout bounds, canvas sync, resize reflow). Use when the user wants to check mobile compatibility, verify Android readiness, or run a mobile audit before building APK/AAB. Triggers on "모바일 체크", "mobile check", "모바일 검사", "안드로이드 준비", "배포 전 점검", "터치 확인".
---

# Mobile Check — 모바일 배포 준비 감사

HTML5 게임 프로젝트를 검사하여 Android(PlayForge APK/AAB) 배포 전 리스크를 조기에 차단한다.
정적 패턴 검사만으로 끝내지 않고, `game-eye` 런타임 검증(모바일 뷰포트 실측)까지 수행한다.

## 실행 방법

```
/mobile-check              # 현재 프로젝트 루트 스캔
/mobile-check src/         # 특정 디렉토리만 스캔
/mobile-check --runtime http://localhost:3000
/mobile-check --strict --runtime http://localhost:3000
```

## 감사 모드

| 모드 | 포함 검사 | 권장 시점 |
|------|----------|----------|
| 기본 | 정적 검사(A~G) | 개발 중 수시 점검 |
| `--runtime` | 정적 + 런타임(L1~L5) | 기능 완료 직후 |
| `--strict` | 정적 + 런타임 + 강화 게이트 | 배포/빌드 직전, CI |

## 감사 절차

### Step 0: 런타임 준비 (`--runtime` 또는 `--strict`)

1. 점검 URL 확보:
   - 사용자가 URL 제공 시 해당 URL 사용
   - 미제공 시 `http://localhost:3000` 시도
   - 응답 없으면 `game-preview` 스킬로 서버 실행 시도
2. `game-eye --version` 확인
3. 검사 뷰포트 2종 고정:
   - Portrait: `390x844`
   - Landscape: `844x390`

### Step 1: 파일 수집 (정적 검사)

프로젝트에서 다음 파일을 찾는다:
- `*.html` — viewport, CSS 검사
- `*.js`, `*.ts`, `*.jsx`, `*.tsx` — 입력, 해상도, 오디오 패턴 검사
- `playforge.config.json` — 배포 설정 검사
- `style.css`, `*.css` — 레이아웃 검사

### Step 2: 정적 카테고리별 검사 (A~G)

각 항목을 검사하고 PASS / WARN / FAIL 판정을 내린다.

---

## 검사 항목

### A. Viewport & HTML (index.html 기준)

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| V1 | `width=device-width` | FAIL | viewport meta에 포함 필수 |
| V2 | `initial-scale=1.0` | FAIL | viewport meta에 포함 필수 |
| V3 | `user-scalable=no` | FAIL | 핀치줌 방지 필수 |
| V4 | `maximum-scale=1.0` | WARN | 권장 (이중 안전장치) |

**모범 패턴:**
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

### B. CSS 레이아웃

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| C1 | `overflow: hidden` on body/html | WARN | 스크롤 방지 |
| C2 | `margin: 0` on body | WARN | 기본 마진 제거 |
| C3 | `canvas { display: block }` | WARN | 인라인 간격 제거 |

**모범 패턴:**
```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
canvas { display: block; }
```

### C. 해상도 & 스케일링

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| R1 | 캔버스 스케일링 전략 | FAIL | 다음 중 하나 필수: (a) `resizeTo: window`, (b) scaleToFit 함수, (c) CSS 100% 크기 |
| R2 | `devicePixelRatio` 사용 | WARN | 고해상도 디바이스 대응 |
| R3 | `resize` 이벤트 리스너 | WARN | 화면 변경 대응 |
| R4 | 초기 레이아웃 호출 위치 | WARN | 첫 렌더 이전에 레이아웃이 고정값으로 계산되지 않는지 확인 |

**모범 패턴 — 고정 해상도 + letterbox:**
```javascript
const GAME_WIDTH = 400;
const GAME_HEIGHT = 600;

const app = new PIXI.Application({
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});

function scaleToFit() {
  const scaleX = window.innerWidth / GAME_WIDTH;
  const scaleY = window.innerHeight / GAME_HEIGHT;
  const scale = Math.min(scaleX, scaleY);
  app.canvas.style.width = GAME_WIDTH * scale + "px";
  app.canvas.style.height = GAME_HEIGHT * scale + "px";
  app.canvas.style.position = "absolute";
  app.canvas.style.left = (window.innerWidth - GAME_WIDTH * scale) / 2 + "px";
  app.canvas.style.top = (window.innerHeight - GAME_HEIGHT * scale) / 2 + "px";
}
window.addEventListener("resize", scaleToFit);
scaleToFit();
```

**모범 패턴 — 반응형 fullscreen:**
```javascript
const app = new PIXI.Application({
  resizeTo: window,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
});
```

**초기 타이밍 주의:**
```javascript
// app.init / renderer 준비 후 레이아웃 계산
await app.init({ resizeTo: window });
requestAnimationFrame(() => layout());
```

### D. 입력 (가장 중요)

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| I1 | 터치/포인터 입력 존재 | FAIL | `pointerdown`, `pointerup`, `pointermove`, `touchstart` 중 하나 이상 |
| I2 | `mousedown`/`mouseup` 사용 | WARN | `pointerdown`/`pointerup`으로 교체 권장 |
| I3 | `keydown` 전용 조작 | FAIL | 키보드만으로 게임 조작 시 터치 대안 필수 |
| I4 | `eventMode: "static"` (PixiJS) | INFO | PixiJS 오브젝트의 이벤트 수신 설정 확인 |

**판정 로직 (I3):**
- `keydown`/`keyup`/`addEventListener('key` 패턴이 있고
- `pointerdown`/`touchstart`/`on('pointer` 패턴이 없으면
- → FAIL: "키보드 전용 조작 감지. 모바일에서는 터치 입력이 필수입니다."

**마우스→포인터 교체 가이드:**
```
mousedown  → pointerdown   (터치 + 마우스 + 스타일러스 통합)
mouseup    → pointerup
mousemove  → pointermove
click      → OK (터치에서도 동작하나, 300ms 지연 가능)
```

**터치 대안 패턴 예시:**
```javascript
// 가상 조이스틱 영역
const leftHalf = new PIXI.Graphics()
  .rect(0, 0, GAME_WIDTH / 2, GAME_HEIGHT)
  .fill({ color: 0x000000, alpha: 0.001 });
leftHalf.eventMode = "static";
leftHalf.on("pointerdown", () => moveLeft());

const rightHalf = new PIXI.Graphics()
  .rect(GAME_WIDTH / 2, 0, GAME_WIDTH / 2, GAME_HEIGHT)
  .fill({ color: 0x000000, alpha: 0.001 });
rightHalf.eventMode = "static";
rightHalf.on("pointerdown", () => moveRight());
```

### E. 오디오

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| A1 | autoplay 사용 | WARN | `new Audio()` 직후 `.play()` 또는 `autoplay` 속성 감지 시 경고 |

**모범 패턴:**
```javascript
// 첫 유저 인터랙션 후 오디오 시작
let audioStarted = false;
inputLayer.on("pointerdown", () => {
  if (!audioStarted) {
    bgm.play();
    audioStarted = true;
  }
});
```

### F. PlayForge 배포 설정

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| P1 | `playforge.config.json` 존재 | INFO | 없으면 "배포 설정 미생성. `playforge init` 필요" 안내 |
| P2 | `orientation` 설정 | INFO | 미설정 시 기본값 안내 |
| P3 | `gameDir` 경로 유효성 | WARN | 지정된 경로에 index.html이 있는지 확인 |
| P4 | `gameDir` 내부 오프라인 실행 가능성 | WARN | 핵심 런타임이 CDN 의존이면 경고 |

### G. 외부 리소스 의존성

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| N1 | 런타임 CDN 의존 | WARN | Pixi/Three 핵심 스크립트가 외부 CDN이면 경고 |
| N2 | 폰트 CDN 의존 | WARN | `@import`/`<link>` 외부 폰트 의존 시 경고 |
| N3 | 절대 URL 에셋 참조 | WARN | `https://` 고정 URL 에셋 사용 시 경고 |

---

## 런타임 검사 항목 (`--runtime` / `--strict`)

정적 검사 통과 후에도 깨지는 문제를 잡기 위해 아래를 수행한다.

### H. Runtime Layout & Viewport Sync

| ID | 검사 | 심각도 | 판정 기준 |
|----|------|--------|----------|
| L1 | 주요 오브젝트 화면 내 배치 | FAIL | 390x844, 844x390에서 주요 UI/플레이어 bounds가 화면 내부 |
| L2 | Canvas-Viewport 동기화 | FAIL | `canvas.width/height`, `style.width/height`, `window.inner*` 정합 |
| L3 | 앱 내부 screen 정합 | WARN | `app.screen`과 실제 viewport가 과도하게 불일치하면 경고 |
| L4 | resize/orientation 재흐름 | FAIL | `resize` 후에도 L1 유지 |
| L5 | 초기 프레임 레이아웃 안정성 | FAIL | 첫 스냅샷에서 깨지고 `resize` 후만 정상인 경우 실패 |

### 런타임 검사 절차 예시

```bash
# 1) 엔진 감지
game-eye detect <url>

# 2) Portrait 스냅샷/스크린샷
game-eye snapshot <url> --viewport 390x844 --visible-only --format json
game-eye screenshot <url> --viewport 390x844 -o mobile-390x844.png

# 3) Landscape 스냅샷/스크린샷
game-eye snapshot <url> --viewport 844x390 --visible-only --format json
game-eye screenshot <url> --viewport 844x390 -o mobile-844x390.png

# 4) 캔버스-뷰포트 정합
game-eye debug-eval <url> "(() => { const c=document.querySelector('canvas'); return { w: window.innerWidth, h: window.innerHeight, cw: c?.width, ch: c?.height, sw: c?.style.width, sh: c?.style.height }; })()"

# 5) resize 재흐름 확인
game-eye debug-eval <url> "window.dispatchEvent(new Event('resize')); 'ok'"
game-eye snapshot <url> --viewport 390x844 --visible-only --format json
```

### L1 주요 오브젝트 판정 가이드

다음 이름/라벨 우선으로 bounds 검사:
- `player`
- `score`, `scoreText`, `life`, `lifeText`, `time`, `timeText`, `combo`, `comboText`
- `title`, `headline`, `headlineText`
- `message`, `messageText`
- `startButton`, `playButton`

판정 기준:
- `x >= 0`
- `y >= 0`
- `x + width <= viewportWidth`
- `y + height <= viewportHeight`

오브젝트 이름이 없으면:
- FAIL로 처리하지 않고 INFO/WARN으로 "stable label 추가 권장" 출력

---

## Step 3: 결과 리포트 출력

아래 형식으로 결과를 출력한다:

```
## Mobile Check 결과

### 요약
- FAIL: N개 (배포 전 반드시 수정)
- WARN: N개 (권장 수정)
- PASS: N개
- INFO: N개
- Gate: PASS|BLOCKED

### 상세

#### A. Viewport & HTML
- [PASS] V1: width=device-width ✓
- [FAIL] V3: user-scalable=no 누락
  → 수정: <meta name="viewport"> 에 user-scalable=no 추가

#### B. CSS 레이아웃
- [WARN] C1: body에 overflow: hidden 없음
  → 수정: body { overflow: hidden; } 추가

#### C. 해상도 & 스케일링
...

#### D. 입력
- [FAIL] I3: keydown 전용 조작 (터치 대안 없음)
  → src/game.js:45 — addEventListener('keydown', ...)
  → 터치 대안 구현 필요. 위 "터치 대안 패턴 예시" 참고

#### E. 오디오
...

#### F. PlayForge 설정
...

#### H. Runtime Layout & Viewport Sync
- [FAIL] L1: 390x844에서 headlineText가 우측 클리핑
  → 런타임 좌표 재계산 필요 (`resize`/초기 렌더 타이밍 점검)
```

## Step 4: 수정 제안

FAIL/WARN 항목이 있으면 수정 여부를 사용자에게 확인한다:

- **자동 수정 가능**: V1-V4 (viewport), C1-C3 (CSS) — 코드 패턴이 명확하여 직접 수정 가능
- **가이드만 제공**: I1-I4 (입력), R1-R4 (해상도), L1-L5 (런타임) — 게임 로직 의존
- **안내만**: P1-P4 (PlayForge), A1 (오디오), N1-N3 (외부 리소스)

## Strict Gate 규칙 (`--strict`)

`--strict`에서는 아래 중 하나라도 해당하면 `Gate: BLOCKED`:
- FAIL 1개 이상
- WARN 중 아래 항목 존재: `V4`, `R2`, `P1`, `P3`, `N1`, `L3`

즉, 배포 직전에는 "기능은 되지만 위험한 상태"도 차단한다.

## CI 권장 사용

```bash
# 예시: 배포 전 파이프라인
/mobile-check --strict --runtime http://localhost:3000
```

실행 결과에 `Gate: BLOCKED`가 나오면 빌드/배포를 중단한다.

## 참고: PlayForge WebView 제약사항

PlayForge가 생성하는 Android 앱의 WebView 환경:
- **Fullscreen + Immersive 모드**: 상태바/네비바 숨김
- **하드웨어 가속**: WebGL 지원 (android:hardwareAccelerated="true")
- **오리엔테이션**: 빌드 타임 고정 (런타임 변경 불가)
- **로딩 URL**: `file:///android_asset/game/index.html` (로컬 파일)
- **JavaScript**: 활성화됨
- **DOM Storage**: 활성화됨
- **미디어 자동재생**: 유저 제스처 불필요 설정이나, 안전을 위해 첫 인터랙션 후 재생 권장
- **네트워크 품질 편차**: 외부 CDN 의존 리소스는 초기 로딩 실패 리스크가 있으므로 번들/로컬 자산 권장
