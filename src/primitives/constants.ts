import type { MiniGameId } from './types'

export const HUB_STORAGE_KEY = 'bagel-miniheaven-progress-v1'

export const MOBILE_VIEWPORT = {
  width: 432,
  height: 768,
} as const

export const MINI_GAME_STAGE_HEIGHT = 420

export const HUB_BOOTSTRAP_CONFIG = {
  initialCoins: 30,
  starterUnlockedGameIds: ['run-run', 'tap-dash'] as MiniGameId[],
}

export const CURRENCY_LABEL = 'Bagel Coin'
