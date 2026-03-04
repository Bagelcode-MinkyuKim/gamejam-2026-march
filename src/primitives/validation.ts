import { GameHubError } from './errors'
import type { MiniGameId, PlayerProgress } from './types'
import { MINI_GAME_IDS } from './types'

const miniGameIdSet = new Set<string>(MINI_GAME_IDS)

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new GameHubError('INVALID_PROGRESS', `${label} must be a finite number`)
  }
}

function assertNonNegativeNumber(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label)
  if (value < 0) {
    throw new GameHubError('INVALID_PROGRESS', `${label} must not be negative`)
  }
}

function assertMiniGameId(value: unknown, label: string): asserts value is MiniGameId {
  if (typeof value !== 'string' || !miniGameIdSet.has(value)) {
    throw new GameHubError('INVALID_PROGRESS', `${label} must be one of supported mini game ids`)
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new GameHubError('INVALID_PROGRESS', `${label} must be an object`)
  }
}

export function createEmptyScoreMap(): Record<MiniGameId, number> {
  return {
    'tap-dash': 0,
    'timing-shot': 0,
    'lane-dodge': 0,
    'run-run': 0,
    'same-character': 0,
  }
}

export function createInitialProgress(initialCoins: number, unlockedMiniGameIds: MiniGameId[]): PlayerProgress {
  assertNonNegativeNumber(initialCoins, 'initialCoins')
  if (unlockedMiniGameIds.length === 0) {
    throw new GameHubError('INVALID_CONFIG', 'At least one starter mini game is required')
  }

  for (const id of unlockedMiniGameIds) {
    assertMiniGameId(id, 'starterUnlockedGameIds[]')
  }

  return {
    coins: initialCoins,
    unlockedMiniGameIds: [...new Set(unlockedMiniGameIds)],
    playCounts: createEmptyScoreMap(),
    bestScores: createEmptyScoreMap(),
  }
}

export function assertValidProgress(value: unknown): asserts value is PlayerProgress {
  assertRecord(value, 'progress')

  assertNonNegativeNumber(value.coins, 'progress.coins')

  if (!Array.isArray(value.unlockedMiniGameIds)) {
    throw new GameHubError('INVALID_PROGRESS', 'progress.unlockedMiniGameIds must be an array')
  }

  for (const [index, id] of value.unlockedMiniGameIds.entries()) {
    assertMiniGameId(id, `progress.unlockedMiniGameIds[${index}]`)
  }

  assertRecord(value.playCounts, 'progress.playCounts')
  assertRecord(value.bestScores, 'progress.bestScores')

  for (const id of MINI_GAME_IDS) {
    assertNonNegativeNumber(value.playCounts[id], `progress.playCounts.${id}`)
    assertNonNegativeNumber(value.bestScores[id], `progress.bestScores.${id}`)
  }
}
