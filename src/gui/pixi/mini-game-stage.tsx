import { Application } from '@pixi/react'
import type { CSSProperties } from 'react'
import type { MiniGameId } from '../../primitives/types'
import { MOBILE_VIEWPORT, MINI_GAME_STAGE_HEIGHT } from '../../primitives/constants'
import tapDashCharacter from '../../../assets/images/character-tap-dash.png'
import timingShotCharacter from '../../../assets/images/character-timing-shot.png'
import laneDodgeCharacter from '../../../assets/images/character-lane-dodge.png'

export type StageTransitionState = 'idle' | 'enter' | 'exit'

interface StageVisualConfig {
  readonly backgroundColor: number
  readonly glowColor: string
  readonly accentColor: string
  readonly characterImageSrc: string
  readonly particleColors: readonly [string, string]
}

const STAGE_VISUAL_BY_GAME: Record<MiniGameId, StageVisualConfig> = {
  'tap-dash': {
    backgroundColor: 0x2a1235,
    glowColor: '#f97316',
    accentColor: '#fb7185',
    characterImageSrc: tapDashCharacter,
    particleColors: ['#fdba74', '#f472b6'],
  },
  'timing-shot': {
    backgroundColor: 0x10243f,
    glowColor: '#38bdf8',
    accentColor: '#0ea5e9',
    characterImageSrc: timingShotCharacter,
    particleColors: ['#67e8f9', '#93c5fd'],
  },
  'lane-dodge': {
    backgroundColor: 0x102b1f,
    glowColor: '#4ade80',
    accentColor: '#22c55e',
    characterImageSrc: laneDodgeCharacter,
    particleColors: ['#86efac', '#34d399'],
  },
}

const PARTICLE_DELAYS = ['0ms', '120ms', '240ms', '360ms', '480ms', '600ms'] as const

export interface MiniGameStageProps {
  readonly gameId: MiniGameId
  readonly title: string
  readonly transitionState: StageTransitionState
}

export function MiniGameStage({ gameId, title, transitionState }: MiniGameStageProps) {
  const visual = STAGE_VISUAL_BY_GAME[gameId]

  return (
    <div className={`pixi-stage-shell transition-${transitionState}`}>
      <Application
        width={MOBILE_VIEWPORT.width}
        height={MINI_GAME_STAGE_HEIGHT}
        antialias
        backgroundColor={visual.backgroundColor}
      />

      <div className="stage-vfx-layer" aria-hidden>
        <div className="stage-gradient-glow" style={{ '--glow': visual.glowColor } as CSSProperties} />
        <div className="stage-energy-wave" style={{ '--accent': visual.accentColor } as CSSProperties} />
        <div className="stage-particle-field">
          {PARTICLE_DELAYS.map((delay, index) => (
            <span
              className="stage-particle"
              key={`${gameId}-${index}`}
              style={
                {
                  '--delay': delay,
                  '--particle-a': visual.particleColors[0],
                  '--particle-b': visual.particleColors[1],
                } as CSSProperties
              }
            />
          ))}
        </div>

        <img className="stage-character" src={visual.characterImageSrc} alt={`${title} character`} />
      </div>

      <div className="pixi-stage-overlay">
        <p className="pixi-stage-label">NOW PLAYING</p>
        <h2>{title}</h2>
      </div>
    </div>
  )
}
