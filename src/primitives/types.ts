export const MINI_GAME_IDS = [
  'tap-dash',
  'timing-shot',
  'lane-dodge',
  'run-run',
  'same-character',
  'gogunbuntu',
  'combo-formula',
] as const

export type MiniGameId = (typeof MINI_GAME_IDS)[number]

export interface MiniGameManifest {
  readonly id: MiniGameId
  readonly title: string
  readonly description: string
  readonly unlockCost: number
  readonly baseReward: number
  readonly scoreRewardMultiplier: number
  readonly accentColor: string
}

export interface MiniGameResult {
  readonly score: number
  readonly durationMs: number
}

export interface PlayerProgress {
  readonly coins: number
  readonly unlockedMiniGameIds: MiniGameId[]
  readonly playCounts: Record<MiniGameId, number>
  readonly bestScores: Record<MiniGameId, number>
}

export interface MiniGameCardState {
  readonly manifest: MiniGameManifest
  readonly unlocked: boolean
  readonly playCount: number
  readonly bestScore: number
}

export interface HubSnapshot {
  readonly coins: number
  readonly selectedGameId: MiniGameId
  readonly activeGameId: MiniGameId | null
  readonly cards: MiniGameCardState[]
}

export interface UnlockResult {
  readonly updatedProgress: PlayerProgress
  readonly spentCoins: number
}

export interface CompleteResult {
  readonly updatedProgress: PlayerProgress
  readonly earnedCoins: number
  readonly newBestScore: boolean
}
