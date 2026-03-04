import { Application } from '@pixi/react'
import type { MiniGameId } from '../../primitives/types'
import { MOBILE_VIEWPORT, MINI_GAME_STAGE_HEIGHT } from '../../primitives/constants'

const STAGE_BACKGROUND_BY_GAME: Record<MiniGameId, number> = {
  'tap-dash': 0x17172b,
  'timing-shot': 0x10243f,
  'lane-dodge': 0x0f2f1c,
}

export interface MiniGameStageProps {
  readonly gameId: MiniGameId
  readonly title: string
}

export function MiniGameStage({ gameId, title }: MiniGameStageProps) {
  return (
    <div className="pixi-stage-shell">
      <Application
        width={MOBILE_VIEWPORT.width}
        height={MINI_GAME_STAGE_HEIGHT}
        antialias
        background={STAGE_BACKGROUND_BY_GAME[gameId]}
      />
      <div className="pixi-stage-overlay">
        <p className="pixi-stage-label">NOW PLAYING</p>
        <h2>{title}</h2>
      </div>
    </div>
  )
}
