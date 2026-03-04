---
name: minigame-module-builder
description: Build and integrate new mini game modules for this Bagel Mini Plaza codebase. Use when the user asks to add a mini game, create a game module, scaffold a new mini game, wire unlock/reward settings, or split mini game work for teammates. Trigger on phrases like "미니게임 추가", "게임 모듈 만들어줘", "새 미니게임", "모듈 스캐폴드", "add mini game module", "scaffold minigame".
---

# Minigame Module Builder

## Overview
미니게임 모듈을 팀 단위로 빠르게 추가하고, 허브 해금/보상 구조에 정확히 연결한다.
현재 프로젝트의 `src/minigames/*` + `src/primitives/*` + `src/minigames/registry.ts` 구조를 기준으로 작업한다.

## Workflow
1. 요구사항을 고정한다.
- 최소 입력을 확정한다: `game id`, `title`, `description`, `unlock cost`, `base reward`, `score reward multiplier`, `accent color`.
- 값이 빠지면 짧게 질문해 확정한다. 추측하지 않는다.

2. 모듈 스캐폴드를 생성한다.
- 아래 스크립트를 우선 사용한다.
```bash
python3 .codex/skills/minigame-module-builder/scripts/scaffold_module.py \
  --id memory-flip \
  --title "Memory Flip" \
  --description "카드를 뒤집어 짝을 맞추는 집중력 게임" \
  --unlock-cost 120 \
  --base-reward 20 \
  --multiplier 0.9 \
  --accent "#8b5cf6"
```
- 생성 결과: `src/minigames/<id>/module.tsx`

3. 허브에 통합한다.
- 반드시 아래 파일을 수정한다.
- `src/primitives/types.ts`: `MINI_GAME_IDS`에 신규 id 추가
- `src/primitives/validation.ts`: `createEmptyScoreMap()`에 신규 id 키 추가
- `src/minigames/registry.ts`: import + `miniGameModules` + `miniGameModuleById`에 신규 모듈 추가
- 필요 시 `src/primitives/constants.ts`의 `starterUnlockedGameIds`를 조정한다.

4. 품질 검증을 실행한다.
```bash
npm run lint
npm run test
npm run build
```
- 실패 시 원인 파일부터 수정 후 재검증한다.

5. 에셋 교체 계획을 반영한다.
- 빠른 프로토타입은 코드 기반 UI로 진행 가능.
- 실제 적용 단계에서는 `codeb`로 이미지/효과음을 생성하고 경로를 `assets/images`, `assets/sounds`에 연결한다.

## Team Rules
- 팀원은 자신의 미니게임 폴더(`src/minigames/<id>/`)를 우선 소유한다.
- 공용 충돌 지점은 `types.ts`, `validation.ts`, `registry.ts` 3개로 제한한다.
- 공용 파일 수정 시 한 번에 하나의 게임만 통합하고 즉시 lint/test/build를 통과시킨다.

## References
- 통합 체크리스트와 리뷰 포인트는 `references/integration-checklist.md`를 따른다.
