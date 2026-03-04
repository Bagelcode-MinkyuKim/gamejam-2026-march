# Mini Game Hub Architecture (세로형 캐주얼)

## 1) 목표
- 여러 미니게임 중 선택 진입
- 플레이 보상으로 코인 획득
- 코인으로 새 미니게임 해금
- 팀원별 독립 개발이 가능한 모듈 구조 유지

## 2) 레이어 구조

```text
src/
  primitives/        # Lv.0 타입/상수/에러/검증
  domain/            # Lv.1 해금/보상 정책
  application/       # Lv.2 유즈케이스
  infrastructure/    # Lv.3 저장소(LocalStorage/InMemory)
  view-model/        # Lv.3 UI 투영 모델
  ui-event-channel/  # 확장용 이벤트 채널
  tick-generator/    # 확장용 Tick 시스템
  minigames/         # 팀 단위 미니게임 모듈
  gui/               # React + Pixi 허브 UI
  cli/               # 검증용 CLI 엔트리
```

## 3) 미니게임 모듈 계약
- 파일: `src/minigames/contracts.ts`
- 각 팀원은 자신의 폴더(`src/minigames/<game-id>/module.tsx`)만 주로 수정
- 공용 허브 로직(`application/domain`)과 분리되어 충돌 최소화

필수 구현:
1. `manifest`: 제목, 설명, 해금 비용, 보상 파라미터
2. `Component`: `onFinish(result)`와 `onExit()`를 반드시 호출

## 4) 팀 협업 규칙
1. 미니게임 추가 시 `src/minigames/<slug>/module.tsx` 생성
2. `src/minigames/registry.ts`에 모듈 등록
3. `manifest.id`는 `src/primitives/types.ts`의 `MINI_GAME_IDS`에 추가
4. 도메인/유즈케이스 공통 규칙 변경 시 반드시 테스트 동시 수정

## 5) 코드b 에셋 파이프라인
현재는 빠른 프로토타입 단계라 UI는 코드 기반으로 구성되어 있음.
실제 에셋 교체는 아래 순서 권장:

1. 이미지 생성
```bash
codeb cg image generate "casual mobile mini game card icon, clean vector" -o assets/images/game-card-tap-dash.png --aspect-ratio 1:1
```

2. 효과음 생성
```bash
codeb cg audio sfx "arcade tap button click" -o assets/sounds/tap-click.mp3
```

3. 허브 BGM/보이스 필요 시 `codeb cg audio tts` 활용

저장 경로 규칙:
- `assets/images/`
- `assets/sounds/`
- `assets/models/`

## 6) 확장 포인트
- `ui-event-channel/`, `tick-generator/`는 추후 실시간 액션형 미니게임을 위한 확장 슬롯
- 현재 허브 구조를 유지하면서 특정 미니게임만 Pixi 고도화 가능
