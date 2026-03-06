import { describe, expect, it } from 'vitest'
import { assertValidProgress, createInitialProgress, migrateProgressForCurrentMiniGames } from './validation'

describe('validation migrateProgressForCurrentMiniGames', () => {
  it('backfills missing game keys with zero scores in legacy data', () => {
    const legacyProgress = {
      coins: 120,
      unlockedMiniGameIds: ['tap-dash', 'run-run'],
      playCounts: {
        'tap-dash': 3,
        'run-run': 2,
      },
      bestScores: {
        'tap-dash': 33,
        'run-run': 61,
      },
    }

    const migrated = migrateProgressForCurrentMiniGames(legacyProgress)
    assertValidProgress(migrated)

    expect(migrated.unlockedMiniGameIds).toContain('same-character')
    expect(migrated.playCounts['same-character']).toBe(0)
    expect(migrated.bestScores['same-character']).toBe(0)
  })

  it('returns the same object if already up-to-date', () => {
    const latest = createInitialProgress(30, ['tap-dash'])
    const migrated = migrateProgressForCurrentMiniGames(latest)

    expect(migrated).toBe(latest)
  })

  it('unlocks same-character by default on initial progress creation', () => {
    const created = createInitialProgress(30, ['tap-dash'])
    expect(created.unlockedMiniGameIds).toContain('same-character')
  })
})
