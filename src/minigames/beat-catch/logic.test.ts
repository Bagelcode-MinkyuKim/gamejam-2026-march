import { describe, expect, it } from 'vitest'
import {
  BEAT_CATCH_MAX_LIVES,
  getBeatCatchDifficulty,
  getBeatCatchLevel,
  loseBeatCatchLife,
} from './logic'

describe('beat-catch logic', () => {
  it('ramps difficulty upward over time', () => {
    const early = getBeatCatchDifficulty(0)
    const mid = getBeatCatchDifficulty(30000)
    const late = getBeatCatchDifficulty(75000)

    expect(early.label).toBe('WARMUP')
    expect(mid.label).toBe('RUSH')
    expect(late.label).toBe('INSANE')

    expect(mid.fallSpeed).toBeGreaterThan(early.fallSpeed)
    expect(late.fallSpeed).toBeGreaterThan(mid.fallSpeed)
    expect(mid.spawnIntervalMs).toBeLessThan(early.spawnIntervalMs)
    expect(late.spawnIntervalMs).toBeLessThan(mid.spawnIntervalMs)
    expect(mid.maxActiveNotes).toBeGreaterThan(early.maxActiveNotes)
    expect(late.maxActiveNotes).toBeGreaterThan(mid.maxActiveNotes)
    expect(mid.perfectZone).toBeLessThan(early.perfectZone)
    expect(late.specialChances.multiSpawn).toBeGreaterThan(mid.specialChances.multiSpawn)
    expect(getBeatCatchDifficulty(7000).specialChances.multiSpawn).toBeGreaterThan(0)
    expect(getBeatCatchDifficulty(6000).specialChances.double).toBeGreaterThan(0)
  })

  it('fails fast on invalid elapsed time input', () => {
    expect(() => getBeatCatchDifficulty(-1)).toThrowError(/elapsedMs/)
  })

  it('reduces life one step at a time and never drops below zero', () => {
    let lives = BEAT_CATCH_MAX_LIVES
    for (let i = 0; i < BEAT_CATCH_MAX_LIVES + 2; i += 1) {
      lives = loseBeatCatchLife(lives)
    }

    expect(lives).toBe(0)
    expect(() => loseBeatCatchLife(1.5)).toThrowError(/lives/)
  })

  it('levels up every 8 catches', () => {
    expect(getBeatCatchLevel(0)).toBe(1)
    expect(getBeatCatchLevel(7)).toBe(1)
    expect(getBeatCatchLevel(8)).toBe(2)
    expect(getBeatCatchLevel(16)).toBe(3)
  })
})
