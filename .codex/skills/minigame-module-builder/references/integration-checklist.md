# Integration Checklist

## 1. 파일 추가
- `src/minigames/<game-id>/module.tsx` 생성 여부
- `manifest.id`와 폴더명이 동일한지 확인

## 2. 필수 통합 파일
1. `src/primitives/types.ts`
- `MINI_GAME_IDS`에 신규 id 추가

2. `src/primitives/validation.ts`
- `createEmptyScoreMap()`에 신규 id 키 추가

3. `src/minigames/registry.ts`
- 신규 모듈 import
- `miniGameModules` 배열에 신규 모듈 추가
- `miniGameModuleById` 맵에 신규 항목 추가

## 3. 보상/해금 검토
- `unlockCost`가 게임 난이도 대비 합리적인지
- `baseReward`, `scoreRewardMultiplier` 조합이 과도하지 않은지
- 해금 루프가 막히지 않는지 (초기 코인 대비)

## 4. 테스트/빌드
```bash
npm run lint
npm run test
npm run build
```
- 세 명령이 모두 통과해야 완료로 본다.

## 5. codeb 에셋 적용 타이밍
- 프로토타입 단계: 임시 UI 허용
- 통합 단계: 아래 명령으로 실에셋 생성
```bash
codeb cg image generate "mobile casual mini game icon" -o assets/images/<game-id>-icon.png --aspect-ratio 1:1
codeb cg audio sfx "arcade button click" -o assets/sounds/<game-id>-click.mp3
```
