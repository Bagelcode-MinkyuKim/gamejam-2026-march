---
name: game-eye-qa
description: HTML5 game QA and testing with game-eye. This skill should be used when developing, testing, or debugging HTML5 canvas games (PixiJS v7/v8, GDevelop). Provides structured scene graph inspection, keyboard/mouse input simulation, assertion-based verification, and automated test loops — all without screenshots or VLM. Use when the user wants to verify game behavior, run game QA, test game features, or debug rendering issues.
---

# game-eye QA — AI Agent의 게임 테스트 도구

game-eye는 AI 에이전트가 HTML5 게임을 구조적으로 파악하고 자율적으로 검증하기 위한 CLI 도구.
스크린샷/VLM 없이 씬 그래프를 YAML로 추출하여 게임 상태를 직접 읽고, assert로 검증.

## 사전 요구

- game-eye v0.5.0+ 설치됨 (`game-eye --version`으로 확인)
- 게임이 dev 서버에서 실행 중 (예: `npm run dev` → `http://localhost:5173`)

## 핵심 워크플로우

### 1. 엔진 감지

```bash
game-eye detect <url>
```
게임 엔진과 버전을 자동 감지. 지원: PixiJS v7/v8, GDevelop.

### 2. 원샷 명령 (세션 없이)

빠른 확인에 사용. 매번 브라우저를 열고 닫음.

```bash
game-eye screenshot <url> --viewport 1280x800 -o /tmp/game.png
game-eye snapshot <url> --visible-only
game-eye debug-eval <url> 'document.title'
```

### 3. 세션 모드 (핵심)

브라우저를 열어두고 반복 작업. 게임 QA의 주요 방식.

```bash
# 터미널 1: 세션 시작 (--head로 브라우저 보이게)
game-eye session start <url> --head --viewport 1280x800

# 터미널 2: 명령 전송
game-eye session assert-no-errors           # 건강 확인
game-eye session assert '$("player").visible === true'  # 씬 그래프 검증
game-eye session input --key ArrowRight     # 키 입력
game-eye session screenshot -o /tmp/ss.png  # 스크린샷
game-eye session stop                       # 종료
```

## Assert 패턴 (v0.5.0)

### $() 헬퍼 — 씬 그래프에서 이름으로 오브젝트 검색

순수 JavaScript. 새 DSL 아님.

```bash
# 오브젝트 존재/가시성
game-eye session assert '$("player").visible === true'

# 텍스트 내용
game-eye session assert '$("scoreText").text.includes("100")'

# 위치
game-eye session assert '$("enemy").x > 100 && $("enemy").y < 500'
```

$() 접근 가능 속성 (raw PixiJS DisplayObject): `.visible`, `.x`, `.y`, `.text`, `.alpha`, `.width`, `.height`, `.rotation`, `.scale`, `.label`, `.children`, `.interactive`, `.parent`

### JavaScript 직접 접근

window 전역 변수에 노출된 게임 상태도 검증 가능.

```bash
game-eye session assert 'window.gameState.score > 0'
game-eye session assert 'window.gameState.level === 2'
```

### 실패 시 context

$() 사용 시 실패하면 오브젝트의 실제 속성값이 context로 함께 출력됨.

```yaml
ok: false
data:
  pass: false
  context:
    $("player"):
      x: 50        # ← 이래서 실패
      y: 200
      visible: true
```

### exit code

- pass → exit 0
- fail → exit 1
- `&&` 체이닝으로 에이전트 루프 분기 가능

## 입력 시뮬레이션

### 단일 키

```bash
game-eye session input --key ArrowRight
game-eye session input --key Space
game-eye session input --key z
```

### 연속 키 (replay)

```bash
game-eye session replay --keys "ArrowUp,ArrowLeft,ArrowLeft,ArrowLeft" --wait-frame --delay 120
```

**중요: 애니메이션 기반 게임에서는 `--delay`를 게임의 ANIM_DURATION 이상으로 설정.**
`--wait-frame` 단독은 2 rAF(~33ms)만 대기하므로 애니메이션(100ms+)을 커버하지 못함.
`--wait-frame --delay <ms>` 조합을 권장.

### 마우스

```bash
game-eye session input --action move --click-x 400 --click-y 300
game-eye session input --action drag --click-x 100 --click-y 100 --to-x 400 --to-y 400
```

## 에이전트 개발 루프 (핵심 패턴)

코드 수정 → 검증 → 실패하면 수정 → 다시 검증.

```bash
game-eye session reload \
  && game-eye session wait-until '$("gameWorld").visible === true' --timeout 5000 \
  && game-eye session assert-no-errors \
  && game-eye session assert '$("player").visible === true' \
  && echo "PASS" || echo "FAIL"
```

### 단계별 설명

1. **reload**: 코드 수정 후 페이지 리로드 (세션 유지)
2. **wait-until**: 게임 로딩 완료 대기 (조건 기반, 고정 sleep 아님)
3. **assert-no-errors**: 콘솔 에러 + 네트워크 에러 제로 검증
4. **assert**: 게임 상태/씬 그래프 검증
5. **&&**: 하나라도 실패하면 즉시 중단

### wait-until 옵션

```bash
game-eye session wait-until '<expr>' --timeout 5000 --interval 200
```
기본: 5초 타임아웃, 200ms 폴링.

## 디버깅 도구

### 콘솔 로그

```bash
game-eye session console           # 수집된 로그 조회
game-eye session console --clear   # 조회 후 클리어
```

### 네트워크 에러

```bash
game-eye session network-errors          # 404, CORS 등
game-eye session network-errors --clear
```

### JS 평가

```bash
game-eye session eval 'JSON.stringify(window.gameState, null, 2)'
```

## 주의사항

- **PixiJS v8은 `.label` (not `.name`)**: 오브젝트 이름 설정 시 `.label` 사용
- **씬 그래프 이름 불일치**: 코드의 변수명과 씬 그래프 name이 다를 수 있음. `eval`로 먼저 확인
- **`if (animating) return` 패턴**: 많은 게임이 애니메이션 중 입력을 무시. replay delay를 충분히 줄 것
- **세션 충돌**: 세션이 실행 중이면 standalone 명령(screenshot, snapshot 등)이 실패. 먼저 `session stop`

## 전체 CLI 레퍼런스

상세 명령어 목록과 플래그는 [references/cli-reference.md](references/cli-reference.md) 참조.
또는 `game-eye --help`, `game-eye session --help`로 직접 확인.
