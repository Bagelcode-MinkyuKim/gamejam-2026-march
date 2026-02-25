# CHANGELOG

GameBakery.ai 스킬 팩 변경 이력입니다.

## 2026.2.14

- **mentor**: 게임잼 전략 조언 스킬 추가 — Tool-First 마인드셋, 에셋 파이프라인 검증 단계, AI 에이전트 활용법, 시간 관리 등 6가지 조언 카드
- **gemini-lens**: Gemini 네이티브 비전 기반 게임 비주얼 분석 스킬 추가 (Gemini CLI / Antigravity 전용)
- **game-trailer**: 캔버스 네이티브 녹화(canvas-record.js)로 전환, 소스 비율 감지 프리셋 자동 선택, ASO 스크린샷 자동 추출
- **build.sh**: SKILL.md `compatibility` 프론트매터 기반 CLI별 스킬 필터링 지원
- **README / FAQ**: 멘토 조언, 게임 트레일러 섹션 추가

## 2026.2.13

- **스킬 동기화**: game-trailer, agent-browser, codeb, asset-preview 스킬 4개 대상 동기화

## 2026.2.12

- **codeb**: 3D 리깅 문서 개선 — `--model-version`, `--spec` 플래그 문서화, v1.0/v2.0 프리셋 구분, prerig 자동감지 설명 추가
- **ref**: bakery-unity-contentgen 서브모듈 추가

## 2026.2.11

- **game-trailer**: 스킬 구현 — canvas captureStream 녹화, ASO/UA 프리셋 8종, FFmpeg 컷편집
- **agent-browser**: 배포 대상으로 전환 (TEMPLATE_ONLY에서 제거)

## 2026.2.10

- **AGENTS.md**: codeb 에셋 생성 권장 규칙 추가 (placeholder 대신 codeb 사용)
- **playforge**: APK 빌드 전 mobile-check 자동 실행 사전 단계 추가
- **CHANGELOG.md**: 배포 zip에 포함 (참가자가 변경 이력 확인 가능)
- **FAQ**: 업데이트 후 VSCode 재시작 안내 추가

## 2026.2.9

- **gamejam-init**: Node.js 설치 확인 단계 추가 (게임 미리보기에 필요)
- **gamejam-init**: 초기화 완료 후 개발→테스트→빌드 워크플로우 안내 추가
- **game-preview**: 서버 우선순위 변경 (npx serve → python → Live Server 폴백)
- **game-preview**: 로컬 IP 주소 필수 안내 (모바일 테스트용)
- **playforge**: 리모트 빌드 전용 명시, 일상 테스트는 game-preview 안내
- **mobile-check**: game-eye 런타임 검증 추가 (L1~L5), strict gate, 외부 리소스 검사
- **codeb**: 3D 모델 플랫폼별 기본값 (Three.js vs Unity) 및 워크플로우 개선

## 2026.2.8

- **codeb**: Tripo 3D API 정합성 수정 (프리셋/타입명/에셋로직/멀티뷰)
- **codeb**: 3D 모델 스킬 문서 보강 (animate 실패 수정 포함)

## 2026.2.7

- **playforge**: 로컬 빌드 제거, 리모트 빌드 전용으로 전환
- **gamebakery-update**: playforge CLI 설치 스크립트 제거

## 2026.2.6

- **codeb**, **game-eye-qa**, **game-preview**, **mobile-check**, **playforge**, **skill-creator** 스킬 추가
- **agent-browser**: 배포 제외, game-eye로 대체

## 2026.2.5

- 초기 릴리스
- **gamejam-init**, **gamebakery-update** 스킬 포함
