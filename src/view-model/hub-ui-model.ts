import type { HubSnapshot, MiniGameCardState, MiniGameId } from '../primitives/types'

export interface HubUiCardModel {
  readonly id: MiniGameId
  readonly title: string
  readonly description: string
  readonly unlockCostLabel: string
  readonly rewardLabel: string
  readonly unlocked: boolean
  readonly selected: boolean
  readonly bestScoreLabel: string
  readonly playCountLabel: string
  readonly accentColor: string
}

export interface HubUiModel {
  readonly coinLabel: string
  readonly activeGameTitle: string | null
  readonly cards: HubUiCardModel[]
}

function toCardModel(card: MiniGameCardState, selectedGameId: MiniGameId): HubUiCardModel {
  return {
    id: card.manifest.id,
    title: card.manifest.title,
    description: card.manifest.description,
    unlockCostLabel: `${card.manifest.unlockCost} 코인`,
    rewardLabel: `기본 보상 +${card.manifest.baseReward}`,
    unlocked: card.unlocked,
    selected: card.manifest.id === selectedGameId,
    bestScoreLabel: `베스트 ${card.bestScore}`,
    playCountLabel: `플레이 ${card.playCount}회`,
    accentColor: card.manifest.accentColor,
  }
}

export function projectHubUi(snapshot: HubSnapshot): HubUiModel {
  const active = snapshot.cards.find((card) => card.manifest.id === snapshot.activeGameId)

  return {
    coinLabel: `${snapshot.coins} 코인`,
    activeGameTitle: active ? active.manifest.title : null,
    cards: snapshot.cards.map((card) => toCardModel(card, snapshot.selectedGameId)),
  }
}
