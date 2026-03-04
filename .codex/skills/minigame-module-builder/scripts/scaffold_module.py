#!/usr/bin/env python3
"""
Scaffold a new mini game module for Bagel Mini Plaza.

Usage example:
python3 .codex/skills/minigame-module-builder/scripts/scaffold_module.py \
  --id memory-flip \
  --title "Memory Flip" \
  --description "카드를 뒤집어 짝을 맞추는 집중력 게임" \
  --unlock-cost 120 \
  --base-reward 20 \
  --multiplier 0.9 \
  --accent "#8b5cf6"
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scaffold a mini game module")
    parser.add_argument("--id", required=True, help="Mini game id in kebab-case (e.g. memory-flip)")
    parser.add_argument("--title", required=True, help="Display title")
    parser.add_argument("--description", required=True, help="Short description")
    parser.add_argument("--unlock-cost", type=int, required=True, help="Unlock cost (>= 0)")
    parser.add_argument("--base-reward", type=int, required=True, help="Base reward (>= 0)")
    parser.add_argument("--multiplier", type=float, required=True, help="Score reward multiplier (>= 0)")
    parser.add_argument("--accent", required=True, help="Accent color hex (e.g. #8b5cf6)")
    parser.add_argument("--repo-root", default=".", help="Repository root path")
    parser.add_argument("--force", action="store_true", help="Overwrite existing module.tsx")
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", args.id):
        raise ValueError("--id must be kebab-case: lowercase letters, digits, hyphens")

    if args.unlock_cost < 0:
        raise ValueError("--unlock-cost must be >= 0")

    if args.base_reward < 0:
        raise ValueError("--base-reward must be >= 0")

    if args.multiplier < 0:
        raise ValueError("--multiplier must be >= 0")

    if not re.fullmatch(r"#[0-9a-fA-F]{6}", args.accent):
        raise ValueError("--accent must be a hex color like #8b5cf6")


def to_component_name(game_id: str) -> str:
    return "".join(part.capitalize() for part in game_id.split("-")) + "Game"


def to_module_name(game_id: str) -> str:
    parts = game_id.split("-")
    return parts[0] + "".join(part.capitalize() for part in parts[1:]) + "Module"


def build_module_source(args: argparse.Namespace) -> str:
    component_name = to_component_name(args.id)
    module_name = to_module_name(args.id)

    return f'''import {{ useState }} from 'react'
import type {{ MiniGameModule, MiniGameSessionProps }} from '../contracts'

function {component_name}({{ onFinish, onExit }}: MiniGameSessionProps) {{
  const [score, setScore] = useState(0)

  const handleScoreUp = () => {{
    setScore((prev) => prev + 1)
  }}

  const finishGame = () => {{
    onFinish({{
      score,
      durationMs: 3000,
    }})
  }}

  return (
    <section className="mini-game-panel" aria-label="{args.id}-game">
      <h3>{args.title}</h3>
      <p className="mini-game-description">{args.description}</p>
      <p className="mini-game-stat">현재 점수: {{score}}</p>
      <button className="tap-button" type="button" onClick={{handleScoreUp}}>
        점수 +1
      </button>
      <button className="tap-button" type="button" onClick={{finishGame}}>
        라운드 종료
      </button>
      <button className="text-button" type="button" onClick={{onExit}}>
        허브로 돌아가기
      </button>
    </section>
  )
}}

export const {module_name}: MiniGameModule = {{
  manifest: {{
    id: '{args.id}' as never,
    title: '{args.title}',
    description: '{args.description}',
    unlockCost: {args.unlock_cost},
    baseReward: {args.base_reward},
    scoreRewardMultiplier: {args.multiplier},
    accentColor: '{args.accent}',
  }},
  Component: {component_name},
}}
'''


def main() -> int:
    args = parse_args()

    try:
        validate_args(args)
    except ValueError as error:
        print(f"[ERROR] {error}")
        return 1

    repo_root = Path(args.repo_root).resolve()
    module_dir = repo_root / "src" / "minigames" / args.id
    module_path = module_dir / "module.tsx"

    if module_path.exists() and not args.force:
        print(f"[ERROR] Module already exists: {module_path}")
        print("Use --force to overwrite.")
        return 1

    module_dir.mkdir(parents=True, exist_ok=True)
    module_path.write_text(build_module_source(args), encoding="utf-8")

    print(f"[OK] Created: {module_path}")
    print()
    print("Next manual integration steps:")
    print("1) Add id to src/primitives/types.ts -> MINI_GAME_IDS")
    print("2) Add id key to src/primitives/validation.ts -> createEmptyScoreMap()")
    print("3) Register module in src/minigames/registry.ts")
    print("4) Run npm run lint && npm run test && npm run build")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
