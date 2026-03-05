import { describe, expect, it } from 'vitest'
import { completeMiniGame, toHubSnapshot, unlockMiniGame } from './hub-policy'
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
    id: 'gogunbuntu',
    title: '고군분투',
    description: 'desc',
    unlockCost: 120,
    baseReward: 18,
    scoreRewardMultiplier: 1,
    accentColor: '#22c55e',
  },
]

describe('hub-policy', () => {
  it('해금 시 코인이 차감되고 상태가 열린다', () => {
    const progress = createInitialProgress(100, ['tap-dash'])
    const result = unlockMiniGame(progress, manifests, 'run-run')

    expect(result.spentCoins).toBe(60)
    expect(result.updatedProgress.coins).toBe(40)
    expect(result.updatedProgress.unlockedMiniGameIds).toContain('run-run')
  })

  it('코인이 부족하면 해금에 실패한다', () => {
    const progress = createInitialProgress(10, ['tap-dash'])

    expect(() => unlockMiniGame(progress, manifests, 'run-run')).toThrowError(/Need 60 coins/)
  })

  it('플레이 완료 시 보상, 플레이 횟수, 최고점이 갱신된다', () => {
    const progress = createInitialProgress(100, ['tap-dash'])
    const completed = completeMiniGame(progress, manifests, 'tap-dash', {
      score: 15,
      durationMs: 5000,
    })

    expect(completed.earnedCoins).toBe(23)
    expect(completed.updatedProgress.coins).toBe(123)
    expect(completed.updatedProgress.playCounts['tap-dash']).toBe(1)
    expect(completed.updatedProgress.bestScores['tap-dash']).toBe(15)
  })

  it('잠긴 게임은 활성 상태 스냅샷을 만들 수 없다', () => {
    const progress = createInitialProgress(30, ['tap-dash'])

    expect(() => toHubSnapshot(progress, manifests, 'run-run', 'run-run')).toThrowError(
      /Cannot activate a locked mini game/,
    )
  })
})
