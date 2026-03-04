import type { IProgressStore } from './ports/progress-store'
import { completeMiniGame, toHubSnapshot, unlockMiniGame } from '../domain/hub-policy'
import { createInitialProgress } from '../primitives/validation'
import type { HubSnapshot, MiniGameId, MiniGameManifest, MiniGameResult, PlayerProgress } from '../primitives/types'

export interface HubBootstrapConfig {
  readonly initialCoins: number
  readonly starterUnlockedGameIds: ReadonlyArray<MiniGameId>
}

export interface CompleteGameResponse {
  readonly snapshot: HubSnapshot
  readonly earnedCoins: number
  readonly newBestScore: boolean
}

export class GameHubUseCases {
  private readonly progressStore: IProgressStore
  private readonly manifests: MiniGameManifest[]
  private readonly bootstrapConfig: HubBootstrapConfig

  constructor(progressStore: IProgressStore, manifests: MiniGameManifest[], bootstrapConfig: HubBootstrapConfig) {
    this.progressStore = progressStore
    this.manifests = manifests
    this.bootstrapConfig = bootstrapConfig
  }

  async loadHub(selectedGameId: MiniGameId, activeGameId: MiniGameId | null): Promise<HubSnapshot> {
    const progress = await this.loadOrCreateProgress()
    return toHubSnapshot(progress, this.manifests, selectedGameId, activeGameId)
  }

  async unlockGame(
    gameId: MiniGameId,
    selectedGameId: MiniGameId,
    activeGameId: MiniGameId | null,
  ): Promise<HubSnapshot> {
    const progress = await this.loadOrCreateProgress()
    const result = unlockMiniGame(progress, this.manifests, gameId)
    await this.progressStore.save(result.updatedProgress)
    return toHubSnapshot(result.updatedProgress, this.manifests, selectedGameId, activeGameId)
  }

  async completeGame(
    gameId: MiniGameId,
    result: MiniGameResult,
    selectedGameId: MiniGameId,
  ): Promise<CompleteGameResponse> {
    const progress = await this.loadOrCreateProgress()
    const completion = completeMiniGame(progress, this.manifests, gameId, result)
    await this.progressStore.save(completion.updatedProgress)

    return {
      snapshot: toHubSnapshot(completion.updatedProgress, this.manifests, selectedGameId, null),
      earnedCoins: completion.earnedCoins,
      newBestScore: completion.newBestScore,
    }
  }

  private async loadOrCreateProgress() {
    const loaded = await this.progressStore.load()

    if (loaded !== null) {
      const migrated = this.addMissingStarterUnlocks(loaded)
      if (migrated !== loaded) {
        await this.progressStore.save(migrated)
      }
      return migrated
    }

    const created = createInitialProgress(
      this.bootstrapConfig.initialCoins,
      [...this.bootstrapConfig.starterUnlockedGameIds],
    )

    await this.progressStore.save(created)
    return created
  }

  private addMissingStarterUnlocks(progress: PlayerProgress): PlayerProgress {
    const missing = this.bootstrapConfig.starterUnlockedGameIds.filter(
      (starterId) => !progress.unlockedMiniGameIds.includes(starterId),
    )

    if (missing.length === 0) {
      return progress
    }

    return {
      ...progress,
      unlockedMiniGameIds: [...progress.unlockedMiniGameIds, ...missing],
    }
  }
}
