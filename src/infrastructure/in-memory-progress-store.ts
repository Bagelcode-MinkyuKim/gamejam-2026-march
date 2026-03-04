import type { IProgressStore } from '../application/ports/progress-store'
import { assertValidProgress } from '../primitives/validation'
import type { PlayerProgress } from '../primitives/types'

export class InMemoryProgressStore implements IProgressStore {
  private progress: PlayerProgress | null

  constructor(initialProgress: PlayerProgress | null = null) {
    this.progress = initialProgress
  }

  async load(): Promise<PlayerProgress | null> {
    if (this.progress === null) {
      return null
    }

    return {
      coins: this.progress.coins,
      unlockedMiniGameIds: [...this.progress.unlockedMiniGameIds],
      playCounts: { ...this.progress.playCounts },
      bestScores: { ...this.progress.bestScores },
    }
  }

  async save(progress: PlayerProgress): Promise<void> {
    assertValidProgress(progress)
    this.progress = {
      coins: progress.coins,
      unlockedMiniGameIds: [...progress.unlockedMiniGameIds],
      playCounts: { ...progress.playCounts },
      bestScores: { ...progress.bestScores },
    }
  }
}
