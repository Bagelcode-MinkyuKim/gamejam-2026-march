# GameBakery.ai Tick & Time System

> **목적**: Tick/Time 시스템 구현 시 참조하는 기술 명세

게임 시간과 틱 시스템의 상세 명세.

---

## 1. 핵심 개념

### 1.1 Frame, Update, Tick, DeltaTime

| 개념 | 설명 |
|------|------|
| **Frame** | 화면이 한 번 그려지는 단위 (렌더링 단위) |
| **Update** | 프레임마다 호출되는 행위/함수 (게임 루프) |
| **Tick** | 게임 로직이 한 번 실행되는 이벤트 |
| **DeltaTime** | tick 간 경과 시간 (밀리초) |

### 1.2 개념 관계도

```
+----------+  triggers   +----------+  belongsTo  +----------+
|  Update  | ----------> |   Tick   | ----------> |  Frame   |
+----------+             +----------+             +----------+
                              |
                              | hasDuration
                              v
                         +----------+
                         | DeltaTime|
                         +----------+
```

**HTML5/TypeScript 용어 매핑:**
- `requestAnimationFrame()` 콜백 → Update (행위)
- `performance.now()` 기반 계산 → DeltaTime (값)
- 프레임 → Frame (렌더링 단위)
- TickGenerator가 tick InputEvent 발행 → Tick (이벤트)

### 1.3 프레임 드랍과 DeltaTime

현실에서는 프레임 드랍이 발생한다. 하지만 게임 시간은 밀리면 안 된다.

```
이상적 (60fps):  Frame1(16.66ms) → Frame2(16.66ms) → Frame3(16.66ms)
현실 (드랍):     Frame1(16.66ms) → Frame2(50ms) → Frame3(16.66ms)
```

**원칙**: DeltaTime이 달라도 게임 시간은 정확히 흘러야 한다.

---

## 2. TickGenerator

### 2.1 역할 정의

**TickGenerator = 시간의 원천 + tick InputEvent의 유일한 생산자**

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
│  │  ← RenderCommand[]              tick InputEvent →        │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

| 역할 | 설명 |
|------|------|
| **시간의 원천** | deltaMs를 계산하여 tick InputEvent 생성 |
| **루프 드라이버** | RAF/setInterval로 게임 루프 구동 |
| **tick 발행자** | UIEvent Channel에 tick InputEvent 발행 |
| **독립적 존재** | CLI/GUI와 직접 통신하지 않음 (Channel 경유) |

### 2.2 TickGenerator vs CLI/GUI 관계

| 구분 | CLI | GUI | TickGenerator |
|------|-----|-----|---------------|
| **역할** | 텍스트 렌더링 + 명령어 입력 | 그래픽 렌더링 + 입력 처리 | tick 생성 |
| **InputEvent 생산** | 명령어 파싱 → InputEvent | DOM 이벤트 → InputEvent | tick InputEvent |
| **RenderCommand 소비** | 텍스트로 출력 | Canvas에 렌더링 | 소비하지 않음 |
| **tick 처리** | 수동 (`tick 16.66 60`) | 자동 (RAF) | 생성만 함 |

### 2.3 구현 패턴

#### ITickGenerator 인터페이스

```typescript
// src/tick-generator/tick-generator.ts

export interface ITickGenerator {
    start(): void;
    stop(): void;
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    isRunning(): boolean;
}
```

#### BrowserTickGenerator (GUI용)

```typescript
// src/tick-generator/browser-tick-generator.ts

export class BrowserTickGenerator implements ITickGenerator {
    private channel: IUIEventChannel;
    private running = false;
    private paused = false;
    private lastTime = 0;
    private rafId: number | null = null;

    constructor(channel: IUIEventChannel) {
        this.channel = channel;
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.loop(this.lastTime);
    }

    stop(): void {
        this.running = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    pause(): void {
        this.paused = true;
    }

    resume(): void {
        if (this.paused) {
            this.paused = false;
            this.lastTime = performance.now();  // 시간 점프 방지
        }
    }

    private loop(now: number): void {
        if (!this.running) return;

        if (!this.paused) {
            const deltaMs = now - this.lastTime;
            this.lastTime = now;

            // tick InputEvent 발행 (유일한 역할)
            this.channel.publishInput({
                type: 'tick',
                deltaMs,
                timestamp: now
            });
        }

        this.rafId = requestAnimationFrame((t) => this.loop(t));
    }

    isPaused(): boolean { return this.paused; }
    isRunning(): boolean { return this.running; }
}
```

#### ManualTickGenerator (CLI용)

```typescript
// src/tick-generator/manual-tick-generator.ts

export class ManualTickGenerator implements ITickGenerator {
    private channel: IUIEventChannel;

    constructor(channel: IUIEventChannel) {
        this.channel = channel;
    }

    // CLI 명령어: tick 16.66 60
    tick(deltaMs: number, count = 1): void {
        for (let i = 0; i < count; i++) {
            this.channel.publishInput({
                type: 'tick',
                deltaMs,
                timestamp: Date.now()
            });
        }
    }

    // ITickGenerator 구현 (CLI에서는 no-op)
    start(): void { /* CLI는 수동 */ }
    stop(): void {}
    pause(): void {}
    resume(): void {}
    isPaused(): boolean { return false; }
    isRunning(): boolean { return false; }
}
```

#### MockTickGenerator (테스트용)

```typescript
// src/tick-generator/mock-tick-generator.ts

export class MockTickGenerator implements ITickGenerator {
    public tickHistory: { deltaMs: number; timestamp: number }[] = [];
    private channel: IUIEventChannel;

    constructor(channel: IUIEventChannel) {
        this.channel = channel;
    }

    // 테스트에서 직접 호출
    simulateTick(deltaMs: number): void {
        const timestamp = this.tickHistory.length * deltaMs;
        this.tickHistory.push({ deltaMs, timestamp });
        this.channel.publishInput({ type: 'tick', deltaMs, timestamp });
    }

    // 1초 (60fps) 시뮬레이션
    simulate1Second(): void {
        for (let i = 0; i < 60; i++) {
            this.simulateTick(16.66);
        }
    }

    start(): void {}
    stop(): void {}
    pause(): void {}
    resume(): void {}
    isPaused(): boolean { return false; }
    isRunning(): boolean { return false; }
}
```

---

## 3. Tick & Time System

### 3.1 Tick 전달 경로

View와 ViewModel은 **UIEvent Channel로만 통신**한다.

```
TickGenerator ──(tick InputEvent)──► UIEvent Channel
                                           │
                                           │ UIEvent Pump
                                           ▼
                                      ViewModel.tick(deltaMs)
                                           │
                                           ▼
                                      Core.tick(deltaMs)
```

### 3.2 클라이언트별 Tick 공급 패턴

| 클라이언트 | TickGenerator | 설명 |
|------------|---------------|------|
| **GUI (Canvas)** | BrowserTickGenerator | RAF 기반 자동 tick |
| **CLI Client** | ManualTickGenerator | 수동 tick 명령어 |
| **테스트** | MockTickGenerator | 결정적 tick 시뮬레이션 |

```
GUI:  BrowserTickGenerator.start() → RAF → tick InputEvent → Channel
CLI:  ManualTickGenerator.tick(16.66, 60) → tick InputEvent × 60 → Channel
Test: MockTickGenerator.simulate1Second() → tick InputEvent × 60 → Channel
```

### 3.3 TickConfig (Primitives)

```typescript
// src/primitives/tick-config.ts

/**
 * 게임 속도 조절 설정
 */
export interface TickConfig {
    timeScale: number;      // 0.0 ~ 10.0 (1.0 = 정상 속도)
    paused: boolean;        // true면 delta=0
    useFixedDelta: boolean; // true면 fixedDelta 사용
    fixedDelta: number;     // 고정 delta (E2E 테스트용, ms)
}

export const DEFAULT_TICK_CONFIG: TickConfig = {
    timeScale: 1.0,
    paused: false,
    useFixedDelta: false,
    fixedDelta: 16.66,
};
```

**용도:**
- `timeScale`: 게임 속도 조절 (슬로모션, 빠른 재생)
- `paused`: 일시정지
- `fixedDelta`: E2E 테스트에서 결정적(deterministic) 결과 보장

---

## 4. 설계 원칙

### 4.1 Core는 시간을 모른다

Core는 **delta만 받는다**. 현재 시각, 프레임레이트, 실제 경과 시간을 알 필요 없음.

```
❌ Core가 Date.now() 호출
✅ Core가 delta를 파라미터로 받음
```

### 4.2 TickGenerator = 시간의 유일한 원천

tick InputEvent는 **TickGenerator만 생산**한다. CLI/GUI는 tick을 생성하지 않음.

```
✅ TickGenerator가 tick InputEvent 발행 → Channel → Pump → ViewModel
❌ GUI가 직접 ViewModel.tick() 호출
```

### 4.3 View ↔ ViewModel 직접 참조 금지

View(CLI/GUI)와 ViewModel은 **UIEvent Channel로만 통신**한다.

```
✅ View → InputEvent → Channel → Pump → ViewModel → RenderCommand → Channel → View
❌ View가 직접 ViewModel 참조
```

### 4.4 TimeScale은 Core가 적용

delta에 TimeScale을 곱하는 것은 **Core 내부**에서 처리.

```typescript
const scaledDelta = deltaMs * this.config.timeScale;
```

### 4.5 E2E 테스트는 MockTickGenerator 사용

**결정적 결과**를 보장하려면 MockTickGenerator 사용:

```typescript
const mockTick = new MockTickGenerator(channel);
mockTick.simulateTick(16.66);  // 정확히 16.66ms
mockTick.simulateTick(16.66);  // 정확히 16.66ms
// → 항상 동일한 결과 보장
```

---

## 5. 체크리스트

### Core 설계 시
- [ ] ViewModel의 `tick(delta)`가 유일한 시간 입력 경로인가?
- [ ] TimeScale 적용 로직이 Core 내부에 있는가?
- [ ] TickConfig가 Primitives에 정의되어 있는가?

### TickGenerator 구현 시
- [ ] ITickGenerator 인터페이스를 구현하는가?
- [ ] BrowserTickGenerator는 RAF 기반인가?
- [ ] ManualTickGenerator는 수동 tick을 지원하는가?
- [ ] MockTickGenerator는 결정적 시뮬레이션을 지원하는가?
- [ ] tick InputEvent만 생산하는가? (다른 역할 없음)

### CLI Client 구현 시
- [ ] `tick <deltaTime>` 명령어로 ManualTickGenerator.tick() 호출하는가?
- [ ] `tick <deltaTime> <count>` 형태로 여러 틱을 실행할 수 있는가?
- [ ] 프레임 드랍 시뮬레이션이 가능한가? (다양한 deltaTime 값)

### GUI Client 구현 시
- [ ] BrowserTickGenerator를 사용하는가?
- [ ] TickGenerator가 시작되면 tick InputEvent가 Channel에 발행되는가?
- [ ] pause/resume이 정상 동작하는가?

### 테스트 시
- [ ] MockTickGenerator를 사용하여 결정적 테스트가 가능한가?
- [ ] simulate1Second() 등 헬퍼 메서드가 있는가?
- [ ] tickHistory로 발행된 tick을 검증할 수 있는가?
