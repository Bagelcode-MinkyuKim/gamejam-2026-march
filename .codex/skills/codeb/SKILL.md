---
name: codeb
description: AI asset generation and utility via codeb CLI. Use when the user needs to (1) generate game images — sprites, backgrounds, UI elements, characters, items, or any visual asset, (2) create or edit 3D models from reference images, (3) generate sound effects — explosions, footsteps, UI sounds, ambient loops, (4) generate voice/narration — NPC dialogue, system announcements, character voices, (5) create effect sprite sheets — fire, smoke, explosion animations, (6) remove or edit image backgrounds, (7) chat with AI models for game logic questions or code help, (8) explore and analyze the codebase with AI, (9) run multi-AI parallel analysis (braintrust), (10) search the web for game dev resources, or (11) analyze gameplay videos. Triggers on "generate asset", "create sprite", "make sound effect", "generate voice", "remove background", "3D model", "codeb", "에셋 생성", "배경 그려줘", "효과음", "캐릭터 이미지"
---

# codeb — AI 종합 도구

## 사전 준비

```bash
codeb login --token aiproxy_xxx   # 토큰 인증 (최초 1회)
codeb whoami                       # 인증 상태 확인
codeb upgrade                      # 최신 버전 유지
```

토큰 발급: https://aiproxy.backoffice.bagelgames.com/console/tokens

## 프로젝트 기본 정책: 이중 에이전트 품질 루프 (이미지)

이 프로젝트에서는 이미지 리소스 생성 시 아래 루프를 기본 적용한다.

1. **Maker Agent**: 프롬프트 설계 + `codeb cg image generate`
2. **Evaluator Agent**: `완성도/퀄리티/풍(style)` 100점 만점 채점
3. **반복 개선**: 총점 90점 미만이면 개선 프롬프트로 재생성
4. **종료 조건**: `totalScore >= 90`

로컬 자동 실행:

```bash
npm run codeb:dual-agent -- \
  --brief "요구사항" \
  --style "원하는 풍/스타일" \
  --asset-name "asset-name" \
  --output-dir "assets/images/generated"
```

---

## Part 1: 콘텐츠 생성 (codeb cg)

### 이미지 생성 · 편집 · 배경제거

```bash
# 생성 (Gemini)
codeb cg image generate "pixel art spaceship" -o assets/images/ship.png
codeb cg image generate "forest background" -o assets/images/bg.png --aspect-ratio 16:9
codeb cg image generate "game character" -o char.png --model pro --remove-bg

# 편집 (기존 이미지 변형)
codeb cg image edit "make it pixel art style" --input source.png -o pixel.png

# 배경 제거
codeb cg image remove-bg --input photo.png -o cutout.png
```

| 플래그 | 설명 |
|--------|------|
| `--model flash/pro` | flash(빠름, 기본) / pro(고품질) |
| `--aspect-ratio` | 1:1, 16:9, 9:16, 4:3, 3:4 |
| `--remove-bg` | 생성 후 자동 배경 제거 |

### 3D 모델 (이미지 → 3D)

**주의: 텍스트→3D가 아닌, 이미지→3D입니다.** 먼저 이미지를 생성한 뒤 3D로 변환합니다.

#### 플랫폼별 기본값

프로젝트 타겟에 따라 아래 값을 기본 적용한다:

| 플래그 | Three.js / PixiJS (웹) | Unity |
|--------|:---:|:---:|
| `--quad` | `false` | `true` |
| 출력 확장자 | `.glb` | `.fbx` |
| `--face-limit` | `8000` | `10000` |
| `--texture-quality` | `standard` | `detailed` |
| `--geometry-quality` | `standard` | `detailed` |
| `--format` (rig/animate) | `glb` | `fbx` |
| `--model-version` (rig) | `v1.0-20240301` | `v1.0-20240301` |
| `--spec` (rig) | `tripo` | `tripo` |

- GameBakery 프로젝트는 기본 **Three.js 타겟**으로 간주
- Unity 프로젝트(`Assets/` 폴더 존재)이면 Unity 타겟 적용
- 사용자가 명시한 플래그는 항상 우선
- **리깅 기본값**: `--model-version v1.0-20240301 --spec tripo` — biped 모델에 최적화되어 본이 정상 회전/애니메이션됨. v2.0이나 mixamo spec 사용 시 본이 움직이지 않는 허수아비 현상이 발생할 수 있음

#### 기본 커맨드 레퍼런스

각 단계의 stdout에서 `Task ID: <uuid>` 줄을 반드시 캡처하여 다음 단계의 `--task-id`에 전달한다.

```bash
# 1단계: 레퍼런스 이미지 생성
codeb cg image generate "low poly character" -o char-ref.png --remove-bg

# 2단계: 이미지 → 3D 모델
codeb cg model3d generate --input char-ref.png -o character.glb              # Three.js
codeb cg model3d generate --input char-ref.png -o character.fbx --quad=true  # Unity
# → stdout 출력 예: "Task ID: a1b2c3d4-... (use this for texture/rig/animate)"

# 3단계: 후처리 (generate의 Task ID 사용)
codeb cg model3d texture --task-id <generate-task-id> -o textured.glb
codeb cg model3d rig --task-id <generate-task-id> --model-version v1.0-20240301 -o rigged.glb  # Three.js
codeb cg model3d rig --task-id <generate-task-id> --model-version v1.0-20240301 -o rigged.fbx  # Unity
# → stdout 출력 예: "Task ID: e5f6g7h8-... (use this for texture/rig/animate)"

# 4단계: 애니메이션 (반드시 rig의 Task ID 사용)
codeb cg model3d animate --task-id <rig-task-id> --animation idle -o character-idle.glb
codeb cg model3d animate --task-id <rig-task-id> --animation walk --format fbx -o character-walk.fbx
```

#### 검증 워크플로우 (바텀업)

3D 에셋은 **단계별로 Director 확인을 받고 진행**한다. 한번에 완성으로 가지 않는다. (규칙: `16-gamebakery-ai-asset-validation.md`)

```
이미지 생성 → [확인] → 3D 변환 → [프리뷰+확인] → 리깅 → [프리뷰+확인] → 애니메이션 → [프리뷰+확인]
   ~5 크레딧       ~10 크레딧         ~10 크레딧          ~10 크레딧/동작
```

**Stage 1: 이미지 생성** (~5 크레딧)

```bash
codeb cg image generate "low poly knight character, T-pose, white background" -o assets/images/knight-ref.png --remove-bg
```

생성 후 Director에게 이미지를 보여주고 확인:

> 레퍼런스 이미지가 생성되었습니다: `assets/images/knight-ref.png`
> 이 이미지를 3D 모델로 변환합니다 (~10 크레딧). 진행 전 확인해 주세요.
>
> Q1. 어떻게 할까요?
> 1-1. 진행 ⭐
> 1-2. 프롬프트 수정 후 재생성
> 1-3. 직접 이미지 제공
> 1-4. 자유서술

**Stage 2: 3D 모델 생성** (~10 크레딧) — Director 승인 후

```bash
codeb cg model3d generate --input assets/images/knight-ref.png -o assets/models/knight.glb
# → Task ID 캡처 → GENERATE_TASK_ID
```

생성 후 `asset-preview` 스킬로 브라우저 프리뷰를 열어 Director에게 확인:

> 3D 모델이 생성되었습니다: `assets/models/knight.glb`
> 브라우저에서 프리뷰를 열었습니다. 마우스로 회전하며 확인해 주세요.
> 다음 단계는 리깅입니다 (~10 크레딧).
>
> Q1. 어떻게 할까요?
> 1-1. 리깅 진행 ⭐
> 1-2. 이미지부터 다시 생성
> 1-3. 3D 생성만 재시도 (옵션 변경)
> 1-4. 자유서술

**Stage 3: 리깅** (~10 크레딧) — Director 승인 후

```bash
codeb cg model3d rig --task-id $GENERATE_TASK_ID --model-version v1.0-20240301 --format glb -o assets/models/knight-rigged.glb
# → Task ID 캡처 → RIG_TASK_ID
```

리깅 후 프리뷰로 Director에게 확인하고, 애니메이션 선택:

> 리깅이 완료되었습니다. 프리뷰에서 확인해 주세요.
> 다음 단계는 애니메이션입니다 (~10 크레딧/동작).
>
> Q1. 어떤 애니메이션을 추가할까요?
> 1-1. idle (대기) ⭐
> 1-2. walk (걷기)
> 1-3. idle + walk + run 세트
> 1-4. 자유서술

**Stage 4: 애니메이션** (~10 크레딧/동작) — Director가 선택한 동작만

```bash
codeb cg model3d animate --task-id $RIG_TASK_ID --animation idle --format glb -o assets/models/knight-idle.glb
```

애니메이션 후 프리뷰로 확인:

> idle 애니메이션이 생성되었습니다. 프리뷰에서 확인해 주세요 (자동 재생).
>
> Q1. 결과가 만족스러우신가요?
> 1-1. 만족, 게임에 통합 ⭐
> 1-2. 다른 애니메이션 추가
> 1-3. 이 애니메이션 재생성
> 1-4. 자유서술

**예외**: Director가 "전부 한번에 해줘"라고 명시하면 일괄 진행. 단, 최종 결과는 반드시 확인.

#### 생성 플래그

| 플래그 | 설명 |
|--------|------|
| `--quad=false` | GLB 출력 (three.js 호환) |
| `--quad=true` | FBX 출력 (Unity 호환) |
| `--face-limit N` | 폴리곤 수 제한 (기본: 플랫폼별) |
| `--texture-quality` | `standard` / `detailed` |
| `--geometry-quality` | `standard` / `detailed` (v3.0+, Ultra Mode) |
| `--task-id` | **(필수)** 이전 단계의 Tripo task ID (texture/rig/animate에서 사용, 빈 값 불가) |
| `--format` | 출력 형식: glb, fbx (기본값은 플랫폼별) |

#### 리깅 옵션

| 플래그 | 설명 |
|--------|------|
| `--rig-type` | `biped`(Tripo 기본), `quadruped`, `hexapod`, `octopod`, `avian`, `serpentine`, `aquatic`. 생략 시 prerig로 자동감지 |
| `--spec` | `tripo`(Tripo 기본) / `mixamo` (업계 표준 본 이름) |
| `--model-version` | 리깅 모델 버전. `v1.0-20240301` (biped 권장, 프리셋 100+개), `v2.0-20250506` (범용, 프리셋 16개) |

#### 애니메이션 프리셋

**중요: 프리셋 이름이 `--model-version`에 따라 다르다.**

**v2.0 (서버 기본)**: `idle`, `walk`, `run`, `jump`, `dive`, `climb`, `turn`, `slash`, `shoot`, `hurt`, `fall`

**v1.0 (biped 전용)**: `biped:idle`, `biped:walk`, `biped:run`, `biped:jump`, `biped:slash`, `biped:shoot`, `biped:hurt`, `biped:fall`, `biped:dance_01`~`biped:dance_06`, `biped:cheer`, `biped:sit` 등 100+개

**비-Biped** (v2.0):
- quadruped: `quadruped:walk`
- hexapod: `hexapod:walk`
- octopod: `octopod:walk`
- serpentine: `serpentine:march`
- aquatic: `aquatic:march`

| 플래그 | 설명 |
|--------|------|
| `--animation` | 프리셋 이름 (위 목록 참조) |
| `--animate-in-place` | 제자리 애니메이션 (이동 없이 동작만) |

#### 텍스처 옵션

| 플래그 | 설명 |
|--------|------|
| `--texture-prompt "설명"` | 텍스처에 커스텀 프롬프트 적용 |
| `--texture-alignment` | `original_image`(기본) / `geometry` |
| `--texture-seed N` | 텍스처 시드 (재현용) |

#### 이미지 입력 팁 (3D 품질에 직접 영향)

- **배경 제거 필수** — `--remove-bg` 사용하거나 흰 배경 이미지 권장
- 정면 또는 3/4 뷰가 최적, 극단적인 각도 피할 것
- 해상도 256px 이상 권장 (최대 6000px)
- 애니메이션용 모델은 이미지 생성 시 **"T-pose"** 또는 **"A-pose"** 명시 권장
  ```bash
  codeb cg image generate "low poly knight character, T-pose, white background" -o knight.png --remove-bg
  ```

#### 애니메이션 대상 가이드

| 적합 (OK) | 부적합 (NG) |
|-----------|------------|
| 인간, 로봇, 애니메 캐릭터 | 동물, 건물, 음식 |
| 팔다리 4개 명확한 캐릭터 | 다리가 붙거나 융합된 모델 |
| 단순한 의상 (1겹) | 악세사리 과다 (안경 여러개 등) |

#### 주의사항

- **[필수] Task ID 체이닝**: generate 결과 출력의 `Task ID: xxx` 값을 반드시 캡처하여 후속 단계(texture/rig/animate)의 `--task-id`에 전달할 것. 빈 값(`--task-id ""`)은 CLI에서 즉시 거부됨
- **[필수] 단계별 Task ID 구분**: texture/rig은 **generate의 task-id**, animate는 **rig의 task-id** 사용. 잘못된 task-id 사용 시 실패
- `--quad=true`는 자동으로 FBX 출력 강제 (GLB와 동시 사용 불가)
- Multiview는 [front, left, back, right] 순서 필수, 최소 2장
- 크레딧 참고: 기본 생성 10, 이미지→3D +10, PBR +10, detailed 텍스처 +10

### 효과음 & 음성

```bash
# 효과음 (ElevenLabs)
codeb cg audio sfx "laser shooting" -o assets/sounds/laser.mp3
codeb cg audio sfx "explosion in a cave" -o boom.mp3 --duration 3.0

# 음성 합성 (ElevenLabs)
codeb cg audio tts "환영합니다!" -o assets/sounds/welcome.mp3
codeb cg audio tts "Game Over" -o gameover.mp3 --voice-id VOICE_ID
```

음성 목록 확인: `codeb voices`

### 이펙트 스프라이트 시트

```bash
codeb cg effect generate fire -d "blue magic fire" -o assets/images/fire-sheet.png
codeb cg effect generate explosion -d "pixel art explosion" -o boom-sheet.png --columns 4 --rows 4
codeb cg effect generate smoke -d "cartoon smoke puff" -o smoke-sheet.png
```

지원 타입: `fire`, `explosion`, `smoke`

---

## Part 2: AI 유틸리티

### AI 채팅 (codeb chat)

```bash
codeb chat openai "게임 물리 엔진 구현 방법 알려줘"
codeb chat anthropic "이 코드의 버그를 찾아줘"
codeb chat openai/gpt-4o "Write a haiku about coding"
codeb chat openai -s "스트리밍으로 응답해줘"   # --stream
```

| 플래그 | 설명 |
|--------|------|
| `-s, --stream` | 실시간 스트리밍 출력 |
| `-t, --temperature` | 생성 온도 (0-2, 기본 0.7) |
| `-m, --max-tokens` | 최대 토큰 수 |
| `--raw` | 응답 내용만 출력 |

### 코드 탐색 (codeb explore)

읽기 전용 도구(glob, grep, read)를 사용하는 에이전틱 루프로 코드베이스를 분석합니다.

```bash
codeb explore openai "프로젝트 구조를 분석해줘"
codeb explore anthropic/claude-opus-4-6 "보안 취약점을 찾아줘"
codeb explore google "main 함수의 역할을 설명해줘"
```

| 플래그 | 설명 |
|--------|------|
| `--max-turns` | 에이전틱 루프 최대 턴 (기본 10) |
| `-S, --system` | 시스템 프롬프트 파일 경로 |

### 다중 AI 병렬 분석 (codeb braintrust)

OpenAI + Anthropic + Google + Moonshot + Perplexity에 동시 요청, 통합 리포트를 생성합니다.

```bash
codeb braintrust my-review "아키텍처 패턴을 분석해줘"
codeb braintrust my-review "이전 분석에서 빠진 부분?" -o report.md
```

같은 세션 이름을 사용하면 이전 대화를 이어갑니다.

### 웹 검색 (codeb search)

Perplexity AI 기반 웹 검색입니다.

```bash
codeb search "PixiJS 8 migration guide"
codeb search --mode academic "game AI pathfinding algorithms"
codeb search --recency week "최신 three.js 업데이트"
codeb search --domain "github.com,stackoverflow.com" "WebGL performance tips"
```

| 플래그 | 설명 |
|--------|------|
| `--mode` | web(기본), academic, sec |
| `--recency` | hour, day, week, month |
| `--domain` | 도메인 필터 (쉼표 구분) |

### 비디오 분석 (codeb video)

Gemini를 사용하여 비디오를 분석합니다. 게임플레이 녹화본이나 레퍼런스 영상 분석에 활용합니다.

```bash
codeb video gameplay.mp4 -o analysis.json
codeb video reference.mp4 -o review.md --format markdown --detail detailed
```

| 플래그 | 설명 |
|--------|------|
| `--format` | json, markdown, text |
| `--detail` | brief, standard(기본), detailed |
| `--resolution` | low(기본), medium, high |

---

## 에셋 관리 규칙

- **파일명**: 영어 소문자 + 하이픈 (예: `player-sprite.png`, `jump-sfx.mp3`)
- **저장 위치**: `assets/images/`, `assets/sounds/`, `assets/models/`
- **프롬프트**: CG 명령어는 영어 프롬프트 권장
- **AI 유틸리티**: 한국어 프롬프트 사용 가능
