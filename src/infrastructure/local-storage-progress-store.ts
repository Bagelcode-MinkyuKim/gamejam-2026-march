import type { IProgressStore } from '../application/ports/progress-store'
import { GameHubError } from '../primitives/errors'
import { assertValidProgress, migrateProgressForCurrentMiniGames } from '../primitives/validation'
import { MINI_GAME_IDS } from '../primitives/types'
import type { MiniGameId, PlayerProgress } from '../primitives/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toNonNegativeNumberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }

  return value
}

function migrateLegacyProgress(value: unknown): PlayerProgress | null {
  if (!isRecord(value)) {
    return null
  }

  const coins = toNonNegativeNumberOrNull(value.coins)
  if (coins === null) {
    return null
  }

  if (!Array.isArray(value.unlockedMiniGameIds)) {
    return null
  }

  const validIdSet = new Set<string>(MINI_GAME_IDS)
  const unlockedMiniGameIds = Array.from(
    new Set(
      value.unlockedMiniGameIds.filter(
        (id): id is MiniGameId => typeof id === 'string' && validIdSet.has(id),
      ),
    ),
  )

  if (unlockedMiniGameIds.length === 0) {
    return null
  }

  const playCountsSource = isRecord(value.playCounts) ? value.playCounts : {}
  const bestScoresSource = isRecord(value.bestScores) ? value.bestScores : {}

  const playCounts = {} as Record<MiniGameId, number>
  const bestScores = {} as Record<MiniGameId, number>

  for (const id of MINI_GAME_IDS) {
    playCounts[id] = toNonNegativeNumberOrNull(playCountsSource[id]) ?? 0
    bestScores[id] = toNonNegativeNumberOrNull(bestScoresSource[id]) ?? 0
  }

  return {
    coins,
    unlockedMiniGameIds,
    playCounts,
    bestScores,
  }
}

export class LocalStorageProgressStore implements IProgressStore {
  private readonly storageKey: string

  constructor(storageKey: string) {
    this.storageKey = storageKey
  }

  async load(): Promise<PlayerProgress | null> {
    const raw = window.localStorage.getItem(this.storageKey)

    if (raw === null) {
      return null
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw) as unknown
    } catch (error) {
      throw new GameHubError('INVALID_PROGRESS', `Stored progress is not valid JSON: ${String(error)}`)
    }

    try {
      const migrated = migrateProgressForCurrentMiniGames(parsed)
      assertValidProgress(migrated)

      if (migrated !== parsed) {
        window.localStorage.setItem(this.storageKey, JSON.stringify(migrated))
      }

      return migrated
    } catch {
      const migratedLegacy = migrateLegacyProgress(parsed)
      if (migratedLegacy === null) {
        throw new GameHubError('INVALID_PROGRESS', 'Stored progress cannot be migrated to current schema')
      }

      const migrated = migrateProgressForCurrentMiniGames(migratedLegacy)
      assertValidProgress(migrated)
      window.localStorage.setItem(this.storageKey, JSON.stringify(migrated))
      return migrated
    }
  }

  async save(progress: PlayerProgress): Promise<void> {
    assertValidProgress(progress)
    const serialized = JSON.stringify(progress)
    window.localStorage.setItem(this.storageKey, serialized)
  }
}
