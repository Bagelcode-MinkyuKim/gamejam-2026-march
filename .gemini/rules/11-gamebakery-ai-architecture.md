# GameBakery.ai Architecture

> **목적**: 시스템 구조를 설계/리뷰할 때 참조하는 문서

HTML5 게임 아키텍처 정의.

---

## 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────┐
│                        HTML5 Game Project                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   [Game Editor] ←──── 기획자 (웹 UI) + AI (API)                 │
│         │                                                        │
│         │ 편집 + 저장 + 서빙                                      │
│         ▼                                                        │
│   [Game Data] (JSON)                                            │
│         │                                                        │
│         │ HTTP 로딩                                               │
│         ▼                                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      순수 로직 영역                         │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  [Lv.2] Core (Domain + Application)                 │  │  │
│  │  │         순수 비즈니스 로직, UseCase, Port 정의        │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                          ▲                                 │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  [Lv.3] Infrastructure (Adapter)                    │  │  │
│  │  │         HTTP Loader, 외부 시스템 연동                 │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                          ▲                                 │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  [Lv.3] ViewModel                                   │  │  │
│  │  │         Core 상태 → UIEvent 투영                     │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                             ▲                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    UIEventChannel                          │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │   InputEvent →              ← RenderCommand         │  │  │
│  │  │   (tick, keydown, mouse)    (sprite, text, audio)   │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │           UIEvent Pump (Channel ↔ ViewModel 연결)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                             ▲                                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                       View 레벨                            │  │
│  │  ┌─────────┐    ┌─────────┐    ┌───────────────────┐      │  │
│  │  │   CLI   │    │   GUI   │    │   TickGenerator   │      │  │
│  │  │ (동등)  │    │ (동등)  │    │     (특별)        │      │  │
│  │  │         │    │         │    │                   │      │  │
│  │  │텍스트출력│    │ Canvas  │    │ 시간의 원천       │      │  │
│  │  │명령어파싱│    │ PixiJS  │    │ tick 생성자       │      │  │
│  │  └─────────┘    └─────────┘    └───────────────────┘      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 핵심 설계 결정

| 원칙 | 설명 |
|------|------|
| **순수 로직 영역** | Core + Infrastructure + ViewModel = 플랫폼 독립적 순수 로직 |
| **UIEventChannel 계층** | View ↔ ViewModel 사이의 **독립적 통신 계층** (양쪽 직접 참조 금지) |
| **View 레벨 구성** | CLI(동등) + GUI(동등) + TickGenerator(특별) |
| **TickGenerator** | tick InputEvent의 **유일한 생산자** → 상세: [13-gamebakery-ai-tick-time-system.md](13-gamebakery-ai-tick-time-system.md) |
| **TypeScript 단일 언어** | 게임 런타임 + 에디터 모두 TypeScript |

---

## 기술 스택

| 레이어 | 언어 | 위치 | 비고 |
|--------|------|------|------|
| Primitives | TypeScript | src/primitives/ | 상수, 타입, 에러, UIEvent DTO |
| Domain | TypeScript | src/domain/ | 순수 비즈니스 로직 |
| Application | TypeScript | src/application/ | UseCase, Port 정의 |
| Infrastructure | TypeScript | src/infrastructure/ | HTTP Loader, Adapter |
| ViewModel | TypeScript | src/view-model/ | Core 상태 → UIEvent 투영 |
| **UIEventChannel** | TypeScript | src/ui-event-channel/ | **View ↔ ViewModel 통신 계층** |
| CLI | TypeScript | src/cli/ | 검증용 CLI (텍스트 렌더러) |
| GUI | TypeScript | src/gui/ | 배포용 Canvas 렌더링 (PixiJS) |
| TickGenerator | TypeScript | src/tick-generator/ | 시간 원천, tick 생성 |
| Game Editor | React (TypeScript) | game-editor/ | 웹 기반 편집 + 서빙 |
| Game Data | JSON | game-data/ | 공유 데이터 저장소 |

### 핵심
- **TypeScript 통일** - AI 컨텍스트 비용 최소화
- **npm packages** - 레이어별 모듈 분리

---

## 프로젝트 구조

```
repository-root/
├── src/                            # 게임 런타임 (TypeScript)
│   ├── primitives/                 # Level 0 - 상수, 타입, 에러, UIEvent DTO
│   │   ├── types.ts
│   │   ├── errors.ts
│   │   ├── input-event.ts          # InputEvent 타입 정의
│   │   ├── render-command.ts       # RenderCommand 타입 정의
│   │   └── ui-event-channel.ts     # IUIEventChannel 인터페이스
│   ├── domain/                     # Level 1 - 순수 비즈니스 로직
│   ├── application/                # Level 2 - UseCase, Port 정의
│   ├── infrastructure/             # Level 3 - HTTP Loader
│   ├── view-model/                 # Level 3 - Core 상태 → UIEvent 투영
│   │   ├── view-model.ts
│   │   └── ui-event-pump.ts        # Channel → ViewModel 연결
│   ├── ui-event-channel/           # Level 3.5 - View ↔ ViewModel 통신 계층
│   │   ├── ui-event-channel.ts     # IUIEventChannel 구현체
│   │   ├── input-event-queue.ts    # InputEvent 큐
│   │   └── render-command-buffer.ts # RenderCommand 버퍼
│   ├── tick-generator/             # Level 4 - 시간 원천
│   │   ├── browser-tick-generator.ts   # RAF 기반 (GUI용)
│   │   └── manual-tick-generator.ts    # 수동 tick (CLI용)
│   ├── cli/                        # Level 4 - 검증용 CLI
│   │   ├── cli-renderer.ts
│   │   └── cli-main.ts
│   └── gui/                        # Level 4 - 배포용 Canvas 렌더링
│       ├── pixi-renderer.ts
│       ├── input-handler.ts
│       └── gui-main.ts
│
├── game-editor/                    # Game Editor (React)
│   ├── src/
│   │   ├── components/             # React 컴포넌트
│   │   ├── api/                    # 내부 API (편집 + 저장)
│   │   └── server/                 # 서빙 로직
│   └── package.json
│
├── game-data/                      # Game Data (JSON)
│   ├── levels/                     # 레벨 데이터
│   ├── balance/                    # 밸런스 데이터
│   └── assets/                     # 에셋 메타데이터
│
├── .codex/                         # Codex 설정
│   ├── rules/                      # AI 규칙
│   ├── skills/                     # AI 스킬
│   └── scripts/                    # AI 스크립트
│
└── docs/                           # 문서
```

---

## 의존성 규칙

```
┌─────────────────────────────────────────────────────────────┐
│                        View 레벨                             │
│   CLI / GUI / TickGenerator                                 │
│         │                                                    │
└─────────┼───────────────────────────────────────────────────┘
          │ publish/consume
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    UIEventChannel 계층                       │
│   InputEvent Queue ←────────→ RenderCommand Buffer          │
│         │                                                    │
└─────────┼───────────────────────────────────────────────────┘
          │ UIEvent Pump
          ▼
┌─────────────────────────────────────────────────────────────┐
│                      순수 로직 영역                          │
│   ViewModel                                                  │
│         │                                                    │
│         ▼                                                    │
│   Infrastructure                                             │
│         │                                                    │
│         ▼                                                    │
│   Application                                                │
│         │                                                    │
│         ▼                                                    │
│   Domain                                                     │
│         │                                                    │
│         ▼                                                    │
│   Primitives                                                 │
└─────────────────────────────────────────────────────────────┘
```

**핵심 규칙:**
1. **단방향 의존성**: 상위 레벨은 하위 레벨만 참조
2. **UIEventChannel 격리**: View ↔ ViewModel 직접 참조 금지, UIEventChannel 계층을 통해서만 통신
3. **Port 방화벽**: Application Port는 Primitives 타입만 노출

---

## UIEvent 통신 패턴

### 데이터 흐름

```
┌─────────────────────────────────────────────────────────────────┐
│                         View 레벨                                │
│  ┌─────────┐    ┌─────────┐    ┌───────────────────┐           │
│  │   CLI   │    │   GUI   │    │   TickGenerator   │           │
│  │(Renderer)│    │(Renderer)│    │    (Driver)      │           │
│  └────┬────┘    └────┬────┘    └─────────┬─────────┘           │
│       │ consume      │ consume           │ produce              │
│       ▼              ▼                   ▼                      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                   UIEvent Channel                         │  │
│  │  ← RenderCommand[]              InputEvent(tick) →       │  │
│  │  ← RenderCommand[]              InputEvent(keydown) →    │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ UIEvent Pump
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        순수 로직 영역                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                      ViewModel                            │  │
│  │   handleInput(InputEvent) → Core 호출                     │  │
│  │   tick(deltaMs) → Core.tick() → RenderCommand[] 생성     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                 Core (Domain + Application)               │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 역할 분담

| 컴포넌트 | 역할 | InputEvent | RenderCommand |
|----------|------|------------|---------------|
| **TickGenerator** | 시간의 원천, 루프 드라이버 | tick **생산** | - |
| **CLI** | 텍스트 렌더러 + 명령어 파싱 | keydown 등 **생산** | **소비** (텍스트 출력) |
| **GUI** | Canvas 렌더러 + 입력 처리 | keydown/mouse 등 **생산** | **소비** (PixiJS 렌더링) |
| **ViewModel** | 상태 투영 | **소비** (Pump 경유) | **생산** |

---

## 관련 문서

| 번호 | 문서 | 내용 |
|------|------|------|
| 11 | [12-gamebakery-ai-workflow.md](12-gamebakery-ai-workflow.md) | 개발 순서, 핵심 원칙, 테스트 전략 |
| 12 | [13-gamebakery-ai-tick-time-system.md](13-gamebakery-ai-tick-time-system.md) | Tick/Time 시스템 상세 명세 |
| 13 | [14-gamebakery-ai-2d-tech-stack.md](14-gamebakery-ai-2d-tech-stack.md) | 2D 게임 기술 스택 (PixiJS) |
| 14 | [15-gamebakery-ai-3d-tech-stack.md](15-gamebakery-ai-3d-tech-stack.md) | 3D 게임 기술 스택 (Three.js) |
