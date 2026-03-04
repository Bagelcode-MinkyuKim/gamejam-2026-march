import { describe, expect, it } from 'vitest'
import { assertValidProgress, createInitialProgress, migrateProgressForCurrentMiniGames } from './validation'

describe('validation migrateProgressForCurrentMiniGames', () => {
  it('기존 저장 데이터에 신규 게임 키가 없으면 0점으로 보정한다', () => {
    const legacyProgress = {
      coins: 120,
      unlockedMiniGameIds: ['tap-dash', 'timing-shot'],
      playCounts: {
        'tap-dash': 3,
        'timing-shot': 2,
        'lane-dodge': 1,
      },
      bestScores: {
        'tap-dash': 33,
        'timing-shot': 61,
        'lane-dodge': 21,
      },
    }

    const migrated = migrateProgressForCurrentMiniGames(legacyProgress)
    assertValidProgress(migrated)

    expect(migrated.unlockedMiniGameIds).toContain('same-character')
    expect(migrated.playCounts['same-character']).toBe(0)
    expect(migrated.bestScores['same-character']).toBe(0)
  })

  it('이미 최신 스키마면 객체를 그대로 반환한다', () => {
    const latest = createInitialProgress(30, ['tap-dash'])
    const migrated = migrateProgressForCurrentMiniGames(latest)

    expect(migrated).toBe(latest)
  })

  it('초기 진행 데이터 생성 시 same-character를 기본 해금한다', () => {
    const created = createInitialProgress(30, ['tap-dash'])
    expect(created.unlockedMiniGameIds).toContain('same-character')
  })
})
