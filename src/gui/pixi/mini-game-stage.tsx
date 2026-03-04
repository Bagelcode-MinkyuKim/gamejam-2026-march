import { Application } from '@pixi/react'
import type { CSSProperties } from 'react'
import type { MiniGameId } from '../../primitives/types'
import { MOBILE_VIEWPORT, MINI_GAME_STAGE_HEIGHT } from '../../primitives/constants'
import stageBackground from '../../../assets/images/bg-stage-bright-pixel.png'
import tapDashCharacter from '../../../assets/images/character-tap-dash-pixel-transparent.png'
import timingShotCharacter from '../../../assets/images/character-timing-shot-pixel-transparent.png'
import laneDodgeCharacter from '../../../assets/images/character-lane-dodge-pixel-transparent.png'
import sameCharacterStageImage from '../../../assets/images/same-character/park-sangmin.png'

export type StageTransitionState = 'idle' | 'enter' | 'exit'

interface StageVisualConfig {
  readonly backgroundColor: number
  readonly glowColor: string
  readonly accentColor: string
  readonly backgroundImageSrc: string
  readonly characterImageSrc: string
  readonly particleColors: readonly [string, string]
}

const STAGE_VISUAL_BY_GAME: Record<MiniGameId, StageVisualConfig> = {
  'tap-dash': {
    backgroundColor: 0x0e1b30,
    glowColor: '#fb923c',
    accentColor: '#f97316',
    backgroundImageSrc: stageBackground,
    characterImageSrc: tapDashCharacter,
    particleColors: ['#fde68a', '#fda4af'],
  },
  'timing-shot': {
    backgroundColor: 0x2f5a96,
    glowColor: '#7dd3fc',
    accentColor: '#38bdf8',
    backgroundImageSrc: stageBackground,
    characterImageSrc: timingShotCharacter,
    particleColors: ['#bae6fd', '#a5f3fc'],
  },
  'lane-dodge': {
    backgroundColor: 0x1f5e69,
    glowColor: '#6ee7b7',
    accentColor: '#22c55e',
    backgroundImageSrc: stageBackground,
    characterImageSrc: laneDodgeCharacter,
    particleColors: ['#bbf7d0', '#6ee7b7'],
  },
  'same-character': {
    backgroundColor: 0x2b1e10,
    glowColor: '#fbbf24',
    accentColor: '#f59e0b',
    backgroundImageSrc: stageBackground,
    characterImageSrc: sameCharacterStageImage,
    particleColors: ['#fde68a', '#f59e0b'],
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
  const isFocusedMode = gameId === 'tap-dash'
  const stageHeight = isFocusedMode ? 160 : MINI_GAME_STAGE_HEIGHT

  return (
    <div
      className={`pixi-stage-shell transition-${transitionState} ${isFocusedMode ? 'focus-mode' : ''}`}
      style={{ '--stage-height': `${stageHeight}px` } as CSSProperties}
    >
      <Application
        width={MOBILE_VIEWPORT.width}
        height={stageHeight}
        antialias
        backgroundColor={visual.backgroundColor}
      />

      {isFocusedMode ? null : (
        <div className="stage-vfx-layer" aria-hidden>
          <img className="stage-background-image" src={visual.backgroundImageSrc} alt="" />
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
      )}

      <div className="pixi-stage-overlay">
        <p className="pixi-stage-label">{isFocusedMode ? 'FOCUS MODE' : 'NOW PLAYING'}</p>
        <h2>{title}</h2>
      </div>
    </div>
  )
}
