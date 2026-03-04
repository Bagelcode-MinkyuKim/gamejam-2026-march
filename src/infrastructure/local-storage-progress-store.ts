import type { IProgressStore } from '../application/ports/progress-store'
import { GameHubError } from '../primitives/errors'
import { assertValidProgress, migrateProgressForCurrentMiniGames } from '../primitives/validation'
import type { PlayerProgress } from '../primitives/types'

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

    const migrated = migrateProgressForCurrentMiniGames(parsed)
    assertValidProgress(migrated)

    if (migrated !== parsed) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(migrated))
    }

    return migrated
  }

  async save(progress: PlayerProgress): Promise<void> {
    assertValidProgress(progress)
    const serialized = JSON.stringify(progress)
    window.localStorage.setItem(this.storageKey, serialized)
  }
}
