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

const MAX_DIFFICULTY_RAMP_MS = 90000

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

  const fallSpeed = 0.32 + difficultyRatio * 0.46 + ratioSquared * 0.4
  const spawnIntervalMs = Math.round(840 - difficultyRatio * 410 - ratioSquared * 270)
  const maxActiveNotes = Math.floor(3 + difficultyRatio * 4 + ratioSquared * 5)
  const perfectZone = 0.038 - difficultyRatio * 0.012 - ratioSquared * 0.006
  const goodZone = 0.08 - difficultyRatio * 0.022 - ratioSquared * 0.012

  const golden = 0.05 + difficultyRatio * 0.13
  const double = elapsedSec >= 12 ? 0.03 + difficultyRatio * 0.12 : 0
  const hold = elapsedSec >= 22 ? 0.02 + difficultyRatio * 0.1 : 0
  const multiSpawn = elapsedSec >= 10 ? 0.04 + difficultyRatio * 0.41 : 0
  const dangerLevel = Math.round(difficultyRatio * 100)

  return {
    difficultyRatio,
    dangerLevel,
    label: getBeatCatchDifficultyLabel(dangerLevel),
    fallSpeed,
    spawnIntervalMs: Math.max(160, spawnIntervalMs),
    maxActiveNotes: Math.min(12, maxActiveNotes),
    perfectZone: Math.max(0.018, perfectZone),
    goodZone: Math.max(0.04, goodZone),
    specialChances: {
      golden: clampNumber(golden, 0, 0.2),
      double: clampNumber(double, 0, 0.15),
      hold: clampNumber(hold, 0, 0.12),
      multiSpawn: clampNumber(multiSpawn, 0, 0.45),
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
