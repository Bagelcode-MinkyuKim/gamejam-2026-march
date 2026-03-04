import { GameHubError } from '../primitives/errors'
import type {
  CompleteResult,
  HubSnapshot,
  MiniGameId,
  MiniGameManifest,
  MiniGameResult,
  PlayerProgress,
  UnlockResult,
} from '../primitives/types'

function cloneProgress(progress: PlayerProgress): PlayerProgress {
  return {
    coins: progress.coins,
    unlockedMiniGameIds: [...progress.unlockedMiniGameIds],
    playCounts: { ...progress.playCounts },
    bestScores: { ...progress.bestScores },
  }
}

function toManifestMap(manifests: MiniGameManifest[]): Record<MiniGameId, MiniGameManifest> {
  const map = {} as Record<MiniGameId, MiniGameManifest>

  for (const manifest of manifests) {
    map[manifest.id] = manifest
  }

  return map
}

function assertKnownGame(gameId: MiniGameId, manifestMap: Record<MiniGameId, MiniGameManifest>): void {
  if (!manifestMap[gameId]) {
    throw new GameHubError('UNKNOWN_GAME', `Mini game not found: ${gameId}`)
  }
}

export function isUnlocked(progress: PlayerProgress, gameId: MiniGameId): boolean {
  return progress.unlockedMiniGameIds.includes(gameId)
}

export function unlockMiniGame(
  progress: PlayerProgress,
  manifests: MiniGameManifest[],
  gameId: MiniGameId,
): UnlockResult {
  const manifestMap = toManifestMap(manifests)
  assertKnownGame(gameId, manifestMap)

  if (isUnlocked(progress, gameId)) {
    return {
      updatedProgress: cloneProgress(progress),
      spentCoins: 0,
    }
  }

  const cost = manifestMap[gameId].unlockCost

  if (progress.coins < cost) {
    throw new GameHubError('INSUFFICIENT_COINS', `Need ${cost} coins to unlock ${gameId}`)
  }

  const next = {
    coins: progress.coins - cost,
    unlockedMiniGameIds: [...progress.unlockedMiniGameIds, gameId],
    playCounts: { ...progress.playCounts },
    bestScores: { ...progress.bestScores },
  }

  return {
    updatedProgress: next,
    spentCoins: cost,
  }
}

export function completeMiniGame(
  progress: PlayerProgress,
  manifests: MiniGameManifest[],
  gameId: MiniGameId,
  result: MiniGameResult,
): CompleteResult {
  const manifestMap = toManifestMap(manifests)
  assertKnownGame(gameId, manifestMap)

  if (!isUnlocked(progress, gameId)) {
    throw new GameHubError('LOCKED_GAME', `Mini game is locked: ${gameId}`)
  }

  if (!Number.isFinite(result.score) || result.score < 0) {
    throw new GameHubError('INVALID_RESULT', 'result.score must be a non-negative finite number')
  }

  if (!Number.isFinite(result.durationMs) || result.durationMs <= 0) {
    throw new GameHubError('INVALID_RESULT', 'result.durationMs must be a positive finite number')
  }

  const manifest = manifestMap[gameId]
  const earnedCoins = manifest.baseReward + Math.floor(result.score * manifest.scoreRewardMultiplier)
  const previousBest = progress.bestScores[gameId]
  const nextBestScore = result.score > previousBest ? result.score : previousBest
  const newBestScore = nextBestScore > previousBest

  const next = {
    coins: progress.coins + earnedCoins,
    unlockedMiniGameIds: [...progress.unlockedMiniGameIds],
    playCounts: {
      ...progress.playCounts,
      [gameId]: progress.playCounts[gameId] + 1,
    },
    bestScores: {
      ...progress.bestScores,
      [gameId]: nextBestScore,
    },
  }

  return {
    updatedProgress: next,
    earnedCoins,
    newBestScore,
  }
}

export function toHubSnapshot(
  progress: PlayerProgress,
  manifests: MiniGameManifest[],
  selectedGameId: MiniGameId,
  activeGameId: MiniGameId | null,
): HubSnapshot {
  const manifestMap = toManifestMap(manifests)
  assertKnownGame(selectedGameId, manifestMap)

  if (activeGameId !== null) {
    assertKnownGame(activeGameId, manifestMap)
    if (!isUnlocked(progress, activeGameId)) {
      throw new GameHubError('LOCKED_GAME', `Cannot activate a locked mini game: ${activeGameId}`)
    }
  }

  return {
    coins: progress.coins,
    selectedGameId,
    activeGameId,
    cards: manifests.map((manifest) => ({
      manifest,
      unlocked: isUnlocked(progress, manifest.id),
      playCount: progress.playCounts[manifest.id],
      bestScore: progress.bestScores[manifest.id],
    })),
  }
}
