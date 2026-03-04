# AI-First TDD Philosophy

## Philosophy of AI-First TDD
1. **No More Red-Green-Refactor, But Generate Best Code**: AI는 처음부터 최선의 코드를 생성한다.
2. **Code is Black Box, Test is Trust**: 개발자에게 AI 코드는 블랙박스다. 테스트만이 신뢰의 유일한 근거다.
3. **Maximum Coverage = Maximum Confidence**: 최대한 많은 케이스를 커버할수록 안정감이 높아진다.

## Test Guidelines

### Unit Test
- **목적**: AI가 생성한 개별 함수가 명세대로 동작하는지 검증
- **대상**: Primitives, Domain 레이어
- **원칙**:
  - 모든 공개 함수는 테스트 필수 (블랙박스의 최소 단위)
  - Edge case로 AI 코드의 견고함 확인
  - 테스트가 명세서 역할: 이름만 보고 동작 파악 가능하게

### Integration Test
- **목적**: AI가 생성한 모듈들이 조합되었을 때도 신뢰할 수 있는지 검증
- **대상**: Application, Infrastructure 레이어
- **원칙**:
  - UseCase 전체 플로우 검증
  - 실패 시나리오로 AI 코드의 에러 핸들링 확인
  - Mock/Stub으로 외부 의존성 격리

### E2E Test
- **목적**: 전체 블랙박스가 사용자 시나리오대로 동작하는지 최종 검증
- **대상**: CLI Client 기반 전체 시스템
- **원칙**:
  - Happy path + 주요 실패 시나리오 커버
  - 실제 환경과 유사한 설정
  - 이 테스트가 통과하면 배포해도 안심

## Coverage Standards

### 목표 커버리지
- **Core (Primitives/Domain/Application)**: 100% (비즈니스 로직 핵심)
- **Infrastructure**: 80% 이상
- **CLI/GUI Client**: 60% 이상 (E2E로 보완)

### 예외 사항
- Boilerplate 코드 (getter/setter)
- 외부 라이브러리 래퍼 (단순 전달)
