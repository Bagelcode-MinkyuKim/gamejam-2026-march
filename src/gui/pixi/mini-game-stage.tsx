import { Application } from '@pixi/react'
import type { CSSProperties } from 'react'
import type { MiniGameId } from '../../primitives/types'
import { MOBILE_VIEWPORT, MINI_GAME_STAGE_HEIGHT } from '../../primitives/constants'
import tapDashCharacter from '../../../assets/images/character-tap-dash-pixel-transparent.png'
import timingShotCharacter from '../../../assets/images/character-timing-shot-pixel-transparent.png'
import laneDodgeCharacter from '../../../assets/images/character-lane-dodge-pixel-transparent.png'
import sameCharacterStageImage from '../../../assets/images/same-character/park-sangmin.png'
import gogunbuntuStageImage from '../../../assets/images/gogunbuntu/dot-characters/kim-yeonja.png'
import comboFormulaStageImage from '../../../assets/images/same-character/park-wankyu.png'

export type StageTransitionState = 'idle' | 'enter' | 'exit'

interface StageVisualConfig {
  readonly backgroundColor: number
  readonly characterImageSrc: string
}

const STAGE_VISUAL_BY_GAME: Record<MiniGameId, StageVisualConfig> = {
  'tap-dash': {
    backgroundColor: 0xeeece6,
    characterImageSrc: tapDashCharacter,
  },
  'timing-shot': {
    backgroundColor: 0xe9e7e2,
    characterImageSrc: timingShotCharacter,
  },
  'lane-dodge': {
    backgroundColor: 0xece9e3,
    characterImageSrc: laneDodgeCharacter,
  },
  'run-run': {
    backgroundColor: 0xe7e2d8,
    characterImageSrc: tapDashCharacter,
  },
  'same-character': {
    backgroundColor: 0xe8e4da,
    characterImageSrc: sameCharacterStageImage,
  },
  'gogunbuntu': {
    backgroundColor: 0x0f172a,
    characterImageSrc: gogunbuntuStageImage,
  },
  'combo-formula': {
    backgroundColor: 0xdef3fb,
    characterImageSrc: comboFormulaStageImage,
  },
}

export interface MiniGameStageProps {
  readonly gameId: MiniGameId
  readonly title: string
  readonly transitionState: StageTransitionState
}

export function MiniGameStage({ gameId, title, transitionState }: MiniGameStageProps) {
  const visual = STAGE_VISUAL_BY_GAME[gameId]
  const isFocusedMode = gameId === 'tap-dash'
  const stageHeight = isFocusedMode ? 280 : MINI_GAME_STAGE_HEIGHT

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
        <div className="stage-character-shell" aria-hidden>
          <img className="stage-character" src={visual.characterImageSrc} alt={`${title} character`} />
        </div>
      )}
    </div>
  )
}
