import { describe, expect, it } from 'vitest'
import {
  computeBpm,
  computeDifficultyLevel,
  computeJudgmentWindows,
  generatePattern,
  noteYPosition,
  NOTE_SPAWN_Y,
  ROUND_DURATION_MS,
  schedulePattern,
  type DrumPatternEntry,
} from './logic'

describe('drum circle logic', () => {
  it('ramps bpm and difficulty over time', () => {
    expect(computeDifficultyLevel(0)).toBe(1)
    expect(computeDifficultyLevel(ROUND_DURATION_MS - 1)).toBe(5)
    expect(computeBpm(ROUND_DURATION_MS, 0)).toBeGreaterThan(computeBpm(0, 0))
  })

  it('shrinks judgment windows as time passes', () => {
    const early = computeJudgmentWindows(0)
    const late = computeJudgmentWindows(ROUND_DURATION_MS)

    expect(late.perfectMs).toBeLessThan(early.perfectMs)
    expect(late.goodMs).toBeLessThan(early.goodMs)
  })

  it('schedules notes to start from the top before the hit line', () => {
    const pattern: DrumPatternEntry[] = [
      { lane: 1, beatIndex: 0, isHold: false, isOffbeat: false },
    ]

    const { notes, nextPatternSpawnTimeMs } = schedulePattern({
      pattern,
      bpm: 120,
      elapsedMs: 0,
      spawnTimeMs: 0,
      nextNoteId: 7,
      random: () => 0.99,
    })

    expect(notes).toHaveLength(1)
    expect(notes[0]?.id).toBe(7)
    expect(notes[0]?.targetTimeMs).toBe(notes[0]?.travelDurationMs)
    expect(noteYPosition(0, notes[0]!.targetTimeMs, notes[0]!.travelDurationMs)).toBeCloseTo(NOTE_SPAWN_Y, 5)
    expect(nextPatternSpawnTimeMs).toBe(2000)
  })

  it('builds denser syncopated patterns later in the round', () => {
    const earlyPattern = generatePattern(100, 0, () => 0.99)
    const latePattern = generatePattern(180, ROUND_DURATION_MS, () => 0)

    expect(earlyPattern.filter((entry) => entry.isOffbeat)).toHaveLength(0)
    expect(latePattern.some((entry) => entry.isOffbeat)).toBe(true)

    const lateBeatCounts = latePattern
      .filter((entry) => !entry.isOffbeat)
      .reduce<Record<number, number>>((acc, entry) => {
        acc[entry.beatIndex] = (acc[entry.beatIndex] ?? 0) + 1
        return acc
      }, {})

    expect(Object.values(lateBeatCounts).some((count) => count >= 2)).toBe(true)
  })
})
