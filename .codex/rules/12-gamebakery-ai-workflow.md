# GameBakery.ai Workflow

> **목적**: 개발 작업을 시작할 때 참조하는 실행 가이드

HTML5 게임 개발 프로세스.

---

## 개발 순서

```
1. Core → 2. Infrastructure → 3. ViewModel → 4. UIEventChannel → 5. TickGenerator → 6. CLI → 7. GUI → 8. Game Editor
```

### Phase 1: Core 구현
- Primitives 레이어: 상수, 타입, 에러, **UIEvent DTO 타입 정의**
- Domain 레이어: 순수 비즈니스 로직
- Application 레이어: UseCase + Port 정의
- **TDD**: Unit Test + Integration Test → 커버리지 100%
- **산출물**: `src/primitives/`, `src/domain/`, `src/application/`

### Phase 2: Infrastructure 구현
- Core의 Outgoing Port 구현 (Adapter)
- HTTP 클라이언트로 Game Editor에서 데이터 로딩
- **TDD**: Integration Test → 커버리지 80%+
- **산출물**: `src/infrastructure/`

### Phase 3: ViewModel 구현
- Core 상태 → UIEvent 투영
- UIEvent Pump 구현 (Channel → ViewModel 연결)
- **TDD**: Integration Test → 커버리지 80%+
- **산출물**: `src/view-model/`

### Phase 4: UIEventChannel 구현
- IUIEventChannel 인터페이스 구현체
- InputEvent Queue + RenderCommand Buffer
- View ↔ ViewModel 통신 계층 완성
- **TDD**: Unit Test → 커버리지 100%
- **산출물**: `src/ui-event-channel/`

### Phase 5: TickGenerator 구현
- BrowserTickGenerator (RAF 기반, GUI용)
- ManualTickGenerator (수동 tick, CLI용)
- MockTickGenerator (테스트용)
- **상세**: [13-gamebakery-ai-tick-time-system.md](13-gamebakery-ai-tick-time-system.md)
- **산출물**: `src/tick-generator/`

### Phase 6: CLI 구현
- 검증용 CLI 클라이언트
- 텍스트 렌더러 + 명령어 파싱
- **TDD**: E2E Test → 커버리지 60%+
- **산출물**: `src/cli/`

### Phase 7: GUI 구현
- PixiJS 기반 Canvas 렌더링
- 입력 처리 (키보드, 마우스, 터치)
- **산출물**: `src/gui/`

### Phase 8: Game Editor 구현
- 웹 기반 콘텐츠 편집 도구 (React)
- 편집 + 저장 + 서빙 통합
- **산출물**: `game-editor/`

---

## 핵심 원칙

### 1. 순수 로직 영역 격리
Core + Infrastructure + ViewModel = 플랫폼 독립적 순수 로직. View를 모른다.

### 2. UIEventChannel 계층
View와 ViewModel 사이에 **독립적인 통신 계층**. 양쪽 직접 참조 금지.

### 3. TickGenerator = 시간의 원천
tick InputEvent의 **유일한 생산자**. CLI/GUI와 직접 통신하지 않음.

### 4. CLI/GUI 동등
둘 다 View 레벨에서 **동등한 렌더러**. 같은 RenderCommand를 다르게 렌더링.

### 5. TypeScript 단일 언어
게임 런타임 + 에디터 모두 TypeScript. AI 컨텍스트 비용 최소화.

---

## 테스트 전략

### AI-First TDD 철학
> "Code is Black Box, Test is Trust" - AI가 생성한 코드는 테스트로만 신뢰한다.

### 커버리지 기준

| 레이어 | 테스트 유형 | 커버리지 | 프레임워크 |
|--------|-------------|----------|------------|
| Core (Primitives/Domain/Application) | Unit + Integration | 100% | Vitest |
| Infrastructure | Integration | 80%+ | Vitest |
| ViewModel | Integration | 80%+ | Vitest |
| UIEventChannel | Unit | 100% | Vitest |
| TickGenerator | Unit | 80%+ | Vitest |
| CLI/GUI | E2E | 60%+ | Playwright |

상세: [02-ai-first-tdd.md](02-ai-first-tdd.md)

---

## 관련 문서

| 번호 | 문서 | 내용 |
|------|------|------|
| 01 | [01-ai-first-development.md](01-ai-first-development.md) | 레이어 구조, 개발 철학, Scorecard |
| 02 | [02-ai-first-tdd.md](02-ai-first-tdd.md) | 테스트 가이드라인, 커버리지 기준 |
| 10 | [11-gamebakery-ai-architecture.md](11-gamebakery-ai-architecture.md) | 아키텍처, 기술 스택, 프로젝트 구조 |
| 12 | [13-gamebakery-ai-tick-time-system.md](13-gamebakery-ai-tick-time-system.md) | Tick/Time 시스템 상세 명세 |
