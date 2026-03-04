# AI-First Development Philosophy

## New Clean Architecture Layer Structure
```
[Lv.0] Primitives     ← 상수, 타입, 에러코드 (의존성 없음)
[Lv.1] Domain        ← 순수 비즈니스 로직 (Lv.0만 참조)
[Lv.2] Application   ← UseCase, Port 정의 (Lv.0-1 참조)
[Lv.3] Infrastructure← Adapter 구현체 (Lv.0-2 참조)
[Lv.4] CLI Client    ← 검증용 CLI (Lv.0-3 참조)
[Lv.5] GUI Client    ← 배포용 그래픽 UI (Lv.0-3 참조)
───────────────────────────────────────────────────
[Lv.6] Unit Test     ← Domain/Primitives 검증
[Lv.7] Integration   ← Application/Infra 흐름 검증
[Lv.8] E2E Test      ← 전체 시스템 검증 (CLI 기반)
```

## Philosophy of AI-First Generation
1. **Code is Cheap, Context is Expensive**: 점점 코드 비용은 0에 수렴한다.
2. **Dependency is Necessary Evil**: 의존성은 필요악이다. AI의 최우선 KPI.
3. **No More Red-Green-Refactor, But Generate Best Code**: AI는 처음부터 최선의 코드를 생성한다.

## Development Rules
1. **KISS**: 가장 간단하고 명확한 해결책을 우선한다.
2. **Fail Fast**: Silent Failure 금지. 에러는 즉시 throw하고 사용자에게 명확한 상황을 설명한다.
3. **No Defaults, No Fallbacks**: 기본값, 폴백 로직 금지. 필요한 값이 없으면 즉시 에러를 낸다.
4. **Dependency Gravity**: 의존성은 항상 상위(Lv.8) → 하위(Lv.0)로만 흐른다.
5. **No Hardcoding**: 하드코딩은 금지한다.
6. **CLI First**: GUI 보다 CLI를 먼저 구현한다.

## Implementation Scorecard
다음 항목에 대해 **0-100점**으로 자체 평가하라:
1. **Architecture**: 코드베이스가 Layer Structure를 준수하는가?
2. **Dependency**: 의존성이 최소화되었는가?
3. **KISS**: 불필요한 복잡성 없이 간결하게 구현되었는가?
4. **Error Handling**: Fail Fast, No Defaults 원칙을 준수하는가?
5. **Test Coverage**: 높은 테스트 커버리지를 달성했는가?
6. **Executable**: 실행 가능한 산출물과 사용법을 전달했는가?
7. **Purity**: Dead code, 디버그 로그가 제거되었는가?
8. **Primitives**: 모든 타입/상수가 Lv.0에 정의되었는가?

## Delivery Rules
1. **Always Executable**: 항상 실행 가능한 빌드를 제공한다.
2. **Show How to Run**: 실행하는 방법을 명확히 공유한다.

## Delivery Process
1. 코딩 완료 후 Scorecard 자체 평가
2. 충분하지 않으면 리팩토링 후 재평가
3. 충분하면 근거와 함께 Director에게 보고
