# GameBakery.ai Philosophy

> **목적**: GameBakery.ai 프로젝트의 핵심 철학과 설계 원칙

---

## 1. 미션

**"AI-First"**

GameBakery.ai는 AI-First 게임 개발 플랫폼이다.

| AI-First 원칙 | 설명 |
|---------------|------|
| **AI가 코드를 생성** | 개발자는 검토하고 테스트로 검증 |
| **AI가 콘텐츠를 생성** | 에디터 API로 레벨, 밸런스, 대화 생성 |
| **AI가 테스트를 실행** | CLI + TickGenerator로 결정론적 E2E |

### 핵심 설계

| 관점 | 설명 | AI 친화적 이유 |
|------|------|----------------|
| **콘텐츠 = 데이터** | JSON으로 분리 | AI가 API로 직접 편집 가능 |
| **런타임 = 순수 로직** | 결정론적 엔진 | AI가 예측 가능한 결과 검증 |
| **CLI = 텍스트 I/O** | 텍스트 기반 검증 | AI가 입출력 시퀀스 생성/검증 |

### 핵심 가치

```
Game Editor (React) ← 기획자/AI가 콘텐츠 편집
       │
       │ JSON/Binary
       ▼
Game Runtime (TypeScript) ← 순수 로직 실행
       │
       │ UIEvent
       ▼
View (CLI/GUI) ← 렌더링만 담당
```

---

## 2. 아키텍처 철학

### 2.1 의존성 분리 (Dependency Gravity)

```
[Lv.0] Primitives     ← 상수, 타입, 에러 (의존성 없음)
[Lv.1] Domain         ← 순수 비즈니스 로직 (Lv.0만 참조)
[Lv.2] Application    ← UseCase, Port 정의 (Lv.0-1 참조)
[Lv.3] Infrastructure ← Adapter 구현체 (Lv.0-2 참조)
[Lv.3] ViewModel      ← Core → UIEvent 투영 (Lv.0-2 참조)
```

**원칙**: 의존성은 항상 위 → 아래로만 흐른다.

### 2.2 순수 로직 (Pure Logic)

Core (Primitives + Domain + Application)는 **순수하게 유지**한다:
- 외부 I/O 없음
- 부작용(side effect) 없음
- 동일 입력 → 동일 출력

**왜 중요한가?**
- 테스트 용이성: Mock 없이 단위 테스트 가능
- 결정론적: 재현 가능한 버그
- 이식성: 플랫폼 독립적

### 2.3 View = 빈 껍데기

View(CLI/GUI)는 RenderCommand를 받아 **그리기만** 한다:
- 비즈니스 로직 0%
- 상태 관리 0%
- 판단/계산 0%

---

## 3. 테스트 철학

### 3.1 순수 로직 → 높은 커버리지

의존성 분리 + 순수 로직 덕분에 **테스트 커버리지 극대화** 가능:

| 레이어 | 테스트 유형 | 목표 커버리지 |
|--------|-------------|---------------|
| Primitives | Unit | 100% |
| Domain | Unit | 100% |
| Application | Integration | 100% |
| Infrastructure | Integration | 80%+ |
| ViewModel | Integration | 80%+ |

### 3.2 CLI + TickGenerator = E2E 극대화

**핵심 인사이트**: CLI와 TickGenerator를 활용하면 E2E 테스트도 결정론적으로 실행 가능

```
MockTickGenerator.simulateTick(16.66)  ← 정확한 시간 제어
ManualTickGenerator.tick(16.66, 60)    ← CLI에서 1초 시뮬레이션
```

| 전통적 E2E | GameBakery.ai E2E |
|-----------|-------------------|
| 불안정 (타이밍 의존) | 결정론적 (tick 제어) |
| 느림 (실제 렌더링) | 빠름 (CLI 텍스트 출력) |
| 디버깅 어려움 | 재현 가능 |

### 3.3 AI-First TDD

> "Code is Black Box, Test is Trust"

AI가 생성한 코드는 테스트로만 신뢰한다. 따라서:
- 모든 공개 API에 테스트 필수
- 테스트가 명세서 역할
- 최대 커버리지 = 최대 신뢰

---

## 4. 설계 결정

### Q1: 왜 게임이 아닌 에디터인가?

게임 콘텐츠는 **데이터**로 분리해야:
- 기획자가 코드 없이 편집 가능
- AI가 API로 콘텐츠 생성 가능
- 런타임 코드 변경 없이 콘텐츠 업데이트

### Q2: 왜 CLI를 먼저 만드는가?

CLI는 테스트 자동화의 핵심:
- 텍스트 입출력 → 자동화 용이
- tick 명령어 → 결정론적 시간 제어
- GUI 없이 전체 로직 검증

### Q3: 왜 TickGenerator를 분리하는가?

시간을 제어해야 테스트가 결정론적:
- BrowserTickGenerator: RAF 기반 (프로덕션)
- ManualTickGenerator: 수동 tick (CLI)
- MockTickGenerator: 결정적 시뮬레이션 (테스트)

---

## 5. 관련 문서

| 번호 | 문서 | 내용 |
|------|------|------|
| 01 | [01-ai-first-development.md](01-ai-first-development.md) | AI-First 개발 철학, Scorecard |
| 02 | [02-ai-first-tdd.md](02-ai-first-tdd.md) | TDD 가이드라인, 커버리지 기준 |
| 11 | [11-gamebakery-ai-architecture.md](11-gamebakery-ai-architecture.md) | 아키텍처 상세 |
| 12 | [12-gamebakery-ai-workflow.md](12-gamebakery-ai-workflow.md) | 개발 워크플로우 |
| 13 | [13-gamebakery-ai-tick-time-system.md](13-gamebakery-ai-tick-time-system.md) | Tick/Time 시스템 명세 |
