import { Application } from '@pixi/react'
import type { CSSProperties } from 'react'
import type { MiniGameId } from '../../primitives/types'
import { MOBILE_VIEWPORT, MINI_GAME_STAGE_HEIGHT } from '../../primitives/constants'
import tapDashCharacter from '../../../assets/images/character-tap-dash-pixel-transparent.png'
import sameCharacterStageImage from '../../../assets/images/same-character/park-sangmin.png'
import gogunbuntuStageImage from '../../../assets/images/gogunbuntu/dot-characters/kim-yeonja.png'
import comboFormulaStageImage from '../../../assets/images/same-character/park-wankyu.png'
import chamChamChamStageImage from '../../../assets/images/same-character/tae-jina.png'
import dungaDungaStageImage from '../../../assets/images/same-character/kim-yeonja.png'
import musicMemoryStageImage from '../../../assets/images/same-character/song-changsik.png'

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
  'cham-cham-cham': {
    backgroundColor: 0xfde8ec,
    characterImageSrc: chamChamChamStageImage,
  },
  'intense-cheer': {
    backgroundColor: 0x1a1a2e,
    characterImageSrc: chamChamChamStageImage,
  },
  'dunga-dunga': {
    backgroundColor: 0xfef3c7,
    characterImageSrc: dungaDungaStageImage,
  },
  'fierce-cheer': {
    backgroundColor: 0x1a0533,
    characterImageSrc: chamChamChamStageImage,
  },
  'music-memory': {
    backgroundColor: 0x2d1b4e,
    characterImageSrc: musicMemoryStageImage,
  },
  'dodge-ball': {
    backgroundColor: 0x0f172a,
    characterImageSrc: musicMemoryStageImage,
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
