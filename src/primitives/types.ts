export const MINI_GAME_IDS = [
  'tap-dash',
  'run-run',
  'same-character',
  'gogunbuntu',
  'combo-formula',
  'cham-cham-cham',
  'intense-cheer',
  'dunga-dunga',
  'fierce-cheer',
  'speed-tap',
  'color-match',
  'rhythm-tap',
  'bubble-pop',
  'star-catch',
  'memory-flip',
  'number-sort',
  'pattern-lock',
  'color-flood',
  'slide-puzzle',
  'quick-draw',
  'simon-says',
  'reaction-test',
  'speed-sort',
  'light-speed',
  'snake-classic',
  'breakout-mini',
  'pong-solo',
  'flappy-singer',
  'space-dodge',
  'math-blitz',
  'tic-tac-pro',
  'mine-sweep-mini',
  'connect-four',
  'rock-scissors',
  'stack-tower',
  'gravity-flip',
  'cannon-shot',
  'ball-bounce-mini',
  'rope-swing',
  'word-chain',
  'spot-diff',
  'maze-run',
  'sequence-master',
  'odd-one-out',
  'music-memory',
  'drum-circle',
  'dance-step',
  'beat-catch',
  'karaoke-pitch',
  'dodge-ball',
  'lava-floor',
  'ice-slide',
  'tornado-run',
  'zombie-run',
  'treasure-dig',
  'cooking-rush',
  'paint-mix',
  'card-flip-speed',
  'emoji-match',
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
