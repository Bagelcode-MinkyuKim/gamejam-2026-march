export const BEAT_CATCH_MAX_LIVES = 5
export const BEAT_CATCH_HIT_LINE_Y = 0.82
export const BEAT_CATCH_MISS_ZONE = 0.12
export const BEAT_CATCH_PERFECT_SCORE = 10
export const BEAT_CATCH_GOOD_SCORE = 4
export const BEAT_CATCH_FEVER_COMBO = 10
export const BEAT_CATCH_FEVER_DURATION_MS = 5000
export const BEAT_CATCH_FEVER_MULTIPLIER = 3
export const BEAT_CATCH_GOLDEN_MULTIPLIER = 3
export const BEAT_CATCH_CATCHES_PER_LEVEL = 8
export const BEAT_CATCH_REVERSE_START_MS = 14000
export const BEAT_CATCH_REVERSE_INTERVAL_MS = 21000
export const BEAT_CATCH_REVERSE_DURATION_MS = 5000
export const BEAT_CATCH_SPOTLIGHT_START_MS = 8000
export const BEAT_CATCH_SPOTLIGHT_INTERVAL_MS = 16000
export const BEAT_CATCH_SPOTLIGHT_DURATION_MS = 6000
export const BEAT_CATCH_SPOTLIGHT_MULTIPLIER = 2
export const BEAT_CATCH_RUSH_START_MS = 18000
export const BEAT_CATCH_RUSH_INTERVAL_MS = 24000
export const BEAT_CATCH_RUSH_DURATION_MS = 5500
export const BEAT_CATCH_RUSH_SPEED_MULTIPLIER = 1.42
export const BEAT_CATCH_RUSH_SPAWN_MULTIPLIER = 0.76
export const BEAT_CATCH_GOLD_RAIN_START_MS = 11000
export const BEAT_CATCH_GOLD_RAIN_INTERVAL_MS = 20000
export const BEAT_CATCH_GOLD_RAIN_DURATION_MS = 4500

export interface BeatCatchSpecialChances {
  readonly golden: number
  readonly double: number
  readonly hold: number
  readonly multiSpawn: number
}

export interface BeatCatchDifficultySnapshot {
  readonly difficultyRatio: number
  readonly dangerLevel: number
  readonly label: string
  readonly fallSpeed: number
  readonly spawnIntervalMs: number
  readonly maxActiveNotes: number
  readonly perfectZone: number
  readonly goodZone: number
  readonly specialChances: BeatCatchSpecialChances
}

const MAX_DIFFICULTY_RAMP_MS = 68000

function assertNonNegativeNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`)
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`)
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function getBeatCatchDifficultyLabel(dangerLevel: number): string {
  assertNonNegativeNumber(dangerLevel, 'dangerLevel')

  if (dangerLevel >= 85) return 'INSANE'
  if (dangerLevel >= 60) return 'DANGER'
  if (dangerLevel >= 30) return 'RUSH'
  return 'WARMUP'
}

export function getBeatCatchDifficulty(elapsedMs: number): BeatCatchDifficultySnapshot {
  assertNonNegativeNumber(elapsedMs, 'elapsedMs')

  const difficultyRatio = clampNumber(elapsedMs / MAX_DIFFICULTY_RAMP_MS, 0, 1)
  const ratioSquared = difficultyRatio * difficultyRatio
  const elapsedSec = elapsedMs / 1000

  const fallSpeed = 0.56 + difficultyRatio * 0.64 + ratioSquared * 0.66
  const spawnIntervalMs = Math.round(650 - difficultyRatio * 250 - ratioSquared * 300)
  const maxActiveNotes = Math.floor(4 + difficultyRatio * 5 + ratioSquared * 5)
  const perfectZone = 0.038 - difficultyRatio * 0.012 - ratioSquared * 0.006
  const goodZone = 0.08 - difficultyRatio * 0.022 - ratioSquared * 0.012

  const golden = 0.09 + difficultyRatio * 0.15
  const double = elapsedSec >= 4.5 ? 0.06 + difficultyRatio * 0.14 : 0
  const hold = elapsedSec >= 12 ? 0.04 + difficultyRatio * 0.12 : 0
  const multiSpawn = elapsedSec >= 5.5 ? 0.1 + difficultyRatio * 0.4 : 0
  const dangerLevel = Math.round(difficultyRatio * 100)

  return {
    difficultyRatio,
    dangerLevel,
    label: getBeatCatchDifficultyLabel(dangerLevel),
    fallSpeed,
    spawnIntervalMs: Math.max(135, spawnIntervalMs),
    maxActiveNotes: Math.min(13, maxActiveNotes),
    perfectZone: Math.max(0.018, perfectZone),
    goodZone: Math.max(0.04, goodZone),
    specialChances: {
      golden: clampNumber(golden, 0, 0.24),
      double: clampNumber(double, 0, 0.18),
      hold: clampNumber(hold, 0, 0.14),
      multiSpawn: clampNumber(multiSpawn, 0, 0.52),
    },
  }
}

export function loseBeatCatchLife(lives: number): number {
  assertNonNegativeInteger(lives, 'lives')
  return Math.max(0, lives - 1)
}

export function getBeatCatchLevel(catches: number): number {
  assertNonNegativeInteger(catches, 'catches')
  return Math.floor(catches / BEAT_CATCH_CATCHES_PER_LEVEL) + 1
}
