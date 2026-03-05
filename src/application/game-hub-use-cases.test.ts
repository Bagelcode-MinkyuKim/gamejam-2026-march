import { describe, expect, it } from 'vitest'
import { GameHubUseCases } from './game-hub-use-cases'
import { InMemoryProgressStore } from '../infrastructure/in-memory-progress-store'
import { createInitialProgress } from '../primitives/validation'
import type { MiniGameManifest } from '../primitives/types'

const manifests: MiniGameManifest[] = [
  {
    id: 'tap-dash',
    title: 'Tap Dash',
    description: 'desc',
    unlockCost: 0,
    baseReward: 8,
    scoreRewardMultiplier: 1,
    accentColor: '#f97316',
  },
  {
    id: 'run-run',
    title: 'Run Run',
    description: 'desc',
    unlockCost: 60,
    baseReward: 12,
    scoreRewardMultiplier: 1,
    accentColor: '#0284c7',
  },
  {
    id: 'same-character',
    title: 'Same Character',
    description: 'desc',
    unlockCost: 90,
    baseReward: 18,
    scoreRewardMultiplier: 1,
    accentColor: '#22c55e',
  },
  {
    id: 'gogunbuntu',
    title: '고군분투',
    description: 'desc',
    unlockCost: 120,
    baseReward: 14,
    scoreRewardMultiplier: 1,
    accentColor: '#ef4444',
  },
]

const bootstrapConfig = {
  initialCoins: 30,
  starterUnlockedGameIds: ['tap-dash'] as const,
}

describe('GameHubUseCases', () => {
  it('최초 로드 시 진행 데이터를 생성한다', async () => {
    const store = new InMemoryProgressStore()
    const useCases = new GameHubUseCases(store, manifests, bootstrapConfig)

    const snapshot = await useCases.loadHub('tap-dash', null)

    expect(snapshot.coins).toBe(30)
    expect(snapshot.cards.find((card) => card.manifest.id === 'tap-dash')?.unlocked).toBe(true)
    expect(snapshot.cards.find((card) => card.manifest.id === 'run-run')?.unlocked).toBe(false)
  })

  it('해금 후 해당 게임이 열린다', async () => {
    const store = new InMemoryProgressStore()
    const useCases = new GameHubUseCases(store, manifests, {
      initialCoins: 100,
      starterUnlockedGameIds: ['tap-dash'],
    })

    const snapshot = await useCases.unlockGame('run-run', 'run-run', null)

    expect(snapshot.coins).toBe(40)
    expect(snapshot.cards.find((card) => card.manifest.id === 'run-run')?.unlocked).toBe(true)
  })

  it('플레이 완료 시 보상 코인이 반영된다', async () => {
    const store = new InMemoryProgressStore()
    const useCases = new GameHubUseCases(store, manifests, bootstrapConfig)

    const result = await useCases.completeGame(
      'tap-dash',
      {
        score: 10,
        durationMs: 4000,
      },
      'tap-dash',
    )

    expect(result.earnedCoins).toBe(18)
    expect(result.snapshot.coins).toBe(48)
    expect(result.snapshot.cards.find((card) => card.manifest.id === 'tap-dash')?.playCount).toBe(1)
  })

  it('기존 저장 데이터에도 스타터 해금 목록을 자동 반영한다', async () => {
    const store = new InMemoryProgressStore(createInitialProgress(30, ['tap-dash']))
    const useCases = new GameHubUseCases(store, manifests, {
      initialCoins: 30,
      starterUnlockedGameIds: ['run-run', 'tap-dash'],
    })

    const snapshot = await useCases.loadHub('run-run', null)

    expect(snapshot.cards.find((card) => card.manifest.id === 'run-run')?.unlocked).toBe(true)
  })
})
