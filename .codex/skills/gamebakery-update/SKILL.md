---
name: gamebakery-update
description: Update GameBakery.ai tools (codeb, playforge, game-eye) and skills to the latest version. Preserves game code and assets while safely updating only tools and skills. Triggers on "update tools", "update skills", "latest version", "GameBakery update", "codeb update", "playforge update", "check version", "업데이트해줘", "최신 버전"
---

# GameBakery.ai 업데이트

게임 코드를 보존하면서 도구와 스킬을 최신 버전으로 업데이트합니다.

## 1. 현재 버전 확인

```bash
codeb version              # codeb 버전
game-eye --version         # game-eye 버전 (미설치 시 오류)
```

> playforge는 리모트 빌드 전용이므로 로컬 설치가 필요 없습니다.

## 2. 도구 업데이트

### codeb (자체 업데이트)

```bash
codeb upgrade              # 최신 버전으로 업데이트
codeb upgrade --check      # 업데이트 확인만 (설치하지 않음)
codeb upgrade --force      # 강제 재설치
```

### game-eye (자체 업데이트)

```bash
game-eye upgrade           # 최신 버전으로 업데이트
game-eye upgrade --check   # 업데이트 확인만
```

## 3. 스킬 업데이트

GitHub Release에서 최신 GameBakery.ai.zip을 다운로드하여 스킬만 교체합니다.

**macOS / Linux:**
```bash
bash .claude/skills/gamebakery-update/scripts/update-tools.sh --skills-only
```

**Windows:**
```powershell
& .\.claude\skills\gamebakery-update\scripts\update-tools.ps1 -SkillsOnly
```

### 스킬 업데이트가 교체하는 파일
- `.claude/skills/`, `.gemini/skills/`, `.codex/skills/`, `.agent/skills/`
- `AGENTS.md` (게임잼 규칙 변경 가능)
- `.claude/rules/`, `.gemini/rules/` 등 규칙 파일

### 절대 건드리지 않는 파일
- `index.html`, `style.css`, `src/` (게임 코드)
- `assets/` (이미지, 사운드, 모델)
- 참가자가 직접 만든 모든 파일

## 4. 업데이트 결과 확인

```bash
codeb version
game-eye --version
```

## 주의사항

- 업데이트 전 `git commit`으로 현재 상태를 저장하는 것을 권장합니다
- `AGENTS.md`가 교체될 수 있으므로 게임잼 규칙이 변경될 수 있습니다
- 네트워크 연결이 필요합니다
