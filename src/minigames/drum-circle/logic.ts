const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

export const ROUND_DURATION_MS = 30000
export const LANE_COUNT = 4
export const PERFECT_SCORE = 3
export const GOOD_SCORE = 1
export const FEVER_COMBO_THRESHOLD = 20
export const FEVER_DURATION_MS = 8000
export const FEVER_MULTIPLIER = 3
export const GOLDEN_NOTE_MULTIPLIER = 3
export const HOLD_NOTE_BONUS = 5
export const HOLD_NOTE_ELAPSED_MS = 9000
export const HIT_LINE_Y = 0.82
export const NOTE_SPAWN_Y = -0.12
export const LOW_TIME_THRESHOLD_MS = 5000
export const SPEED_RUSH_ELAPSED_MS = 12000
export const SPEED_RUSH_CHANCE = 0.028
export const SPEED_RUSH_DURATION_MS = 4000
export const SPEED_RUSH_BPM_BOOST = 36

const INITIAL_BPM = 94
const MAX_BPM = 188
const INITIAL_TRAVEL_DURATION_MS = 2200
const MIN_TRAVEL_DURATION_MS = 1180
const INITIAL_PERFECT_WINDOW_MS = 64
const MIN_PERFECT_WINDOW_MS = 38
const INITIAL_GOOD_WINDOW_MS = 148
const MIN_GOOD_WINDOW_MS = 92
const BASE_GOLDEN_NOTE_CHANCE = 0.08
const MAX_GOLDEN_NOTE_CHANCE = 0.15
const BASE_HOLD_NOTE_CHANCE = 0.14
const MAX_HOLD_NOTE_CHANCE = 0.24
const BASE_DOUBLE_LANE_CHANCE = 0.16
const MAX_DOUBLE_LANE_CHANCE = 0.42
const MAX_TRIPLE_LANE_CHANCE = 0.14
const BASE_OFFBEAT_CHANCE = 0.12
const MAX_OFFBEAT_CHANCE = 0.32

export interface DrumCircleNote {
  readonly id: number
  readonly lane: number
  readonly targetTimeMs: number
  readonly travelDurationMs: number
  readonly isGolden: boolean
  readonly isHold: boolean
  alive: boolean
  judged: boolean
}

export interface DrumPatternEntry {
  readonly lane: number
  readonly beatIndex: number
  readonly isHold: boolean
  readonly isOffbeat: boolean
}

export interface JudgmentWindows {
  readonly perfectMs: number
  readonly goodMs: number
}

export function getDifficultyProgress(elapsedMs: number): number {
  return clamp(elapsedMs / ROUND_DURATION_MS, 0, 1)
}

export function computeDifficultyLevel(elapsedMs: number): number {
  return Math.min(5, Math.floor(getDifficultyProgress(elapsedMs) * 4.999) + 1)
}

export function computeBpm(elapsedMs: number, rushBoost: number): number {
  const progress = getDifficultyProgress(elapsedMs)
  const curvedRamp = Math.pow(progress, 0.92)
  return Math.min(MAX_BPM, INITIAL_BPM + (MAX_BPM - INITIAL_BPM) * curvedRamp + rushBoost)
}

export function computeTravelDurationMs(elapsedMs: number): number {
  const progress = getDifficultyProgress(elapsedMs)
  return Math.round(
    INITIAL_TRAVEL_DURATION_MS - (INITIAL_TRAVEL_DURATION_MS - MIN_TRAVEL_DURATION_MS) * Math.pow(progress, 0.9),
  )
}

export function computeJudgmentWindows(elapsedMs: number): JudgmentWindows {
  const progress = getDifficultyProgress(elapsedMs)
  return {
    perfectMs: Math.round(INITIAL_PERFECT_WINDOW_MS - (INITIAL_PERFECT_WINDOW_MS - MIN_PERFECT_WINDOW_MS) * progress),
    goodMs: Math.round(INITIAL_GOOD_WINDOW_MS - (INITIAL_GOOD_WINDOW_MS - MIN_GOOD_WINDOW_MS) * progress),
  }
}

function computeGoldenNoteChance(elapsedMs: number): number {
  const progress = getDifficultyProgress(elapsedMs)
  return BASE_GOLDEN_NOTE_CHANCE + (MAX_GOLDEN_NOTE_CHANCE - BASE_GOLDEN_NOTE_CHANCE) * progress
}

function pickUniqueLane(used: Set<number>, random: () => number): number {
  const startLane = Math.floor(random() * LANE_COUNT)
  for (let offset = 0; offset < LANE_COUNT; offset += 1) {
    const lane = (startLane + offset) % LANE_COUNT
    if (!used.has(lane)) {
      used.add(lane)
      return lane
    }
  }
  throw new Error('Could not pick an unused drum lane.')
}

export function generatePattern(
  bpm: number,
  elapsedMs: number,
  random: () => number = Math.random,
): DrumPatternEntry[] {
  const progress = getDifficultyProgress(elapsedMs)
  const holdChance = elapsedMs >= HOLD_NOTE_ELAPSED_MS
    ? BASE_HOLD_NOTE_CHANCE + (MAX_HOLD_NOTE_CHANCE - BASE_HOLD_NOTE_CHANCE) * progress
    : 0
  const doubleLaneChance = BASE_DOUBLE_LANE_CHANCE + (MAX_DOUBLE_LANE_CHANCE - BASE_DOUBLE_LANE_CHANCE) * progress
  const tripleLaneChance = progress > 0.58 ? ((progress - 0.58) / 0.42) * MAX_TRIPLE_LANE_CHANCE : 0
  const offbeatChance = progress > 0.18
    ? BASE_OFFBEAT_CHANCE + (MAX_OFFBEAT_CHANCE - BASE_OFFBEAT_CHANCE) * progress
    : 0

  const pattern: DrumPatternEntry[] = []
  for (let beat = 0; beat < 4; beat += 1) {
    let laneCount = 1
    if (beat > 0 && random() < doubleLaneChance) {
      laneCount = 2
    }
    if (beat > 1 && random() < tripleLaneChance) {
      laneCount = 3
    }

    const usedLanes = new Set<number>()
    for (let noteIndex = 0; noteIndex < laneCount; noteIndex += 1) {
      pattern.push({
        lane: pickUniqueLane(usedLanes, random),
        beatIndex: beat,
        isHold: random() < holdChance,
        isOffbeat: false,
      })
    }

    if (beat > 0 && bpm >= 118 && random() < offbeatChance) {
      pattern.push({
        lane: pickUniqueLane(usedLanes, random),
        beatIndex: beat,
        isHold: false,
        isOffbeat: true,
      })
    }
  }

  return pattern
}

export function schedulePattern({
  pattern,
  bpm,
  elapsedMs,
  spawnTimeMs,
  nextNoteId,
  random = Math.random,
}: {
  pattern: DrumPatternEntry[]
  bpm: number
  elapsedMs: number
  spawnTimeMs: number
  nextNoteId: number
  random?: () => number
}): {
  notes: DrumCircleNote[]
  nextNoteId: number
  nextPatternSpawnTimeMs: number
} {
  const beatMs = 60000 / bpm
  const travelDurationMs = computeTravelDurationMs(elapsedMs)
  const goldenChance = computeGoldenNoteChance(elapsedMs)

  const notes = pattern
    .map<DrumCircleNote>((entry) => ({
      id: nextNoteId++,
      lane: entry.lane,
      targetTimeMs:
        spawnTimeMs
        + travelDurationMs
        + (entry.isOffbeat ? entry.beatIndex * beatMs - beatMs * 0.5 : entry.beatIndex * beatMs),
      travelDurationMs,
      isGolden: !entry.isHold && random() < goldenChance,
      isHold: entry.isHold,
      alive: true,
      judged: false,
    }))
    .sort((left, right) => left.targetTimeMs - right.targetTimeMs || left.lane - right.lane)

  return {
    notes,
    nextNoteId,
    nextPatternSpawnTimeMs: spawnTimeMs + 4 * beatMs,
  }
}

export function noteYPosition(currentMs: number, targetMs: number, travelDurationMs: number): number {
  const progress = 1 - (targetMs - currentMs) / travelDurationMs
  return NOTE_SPAWN_Y + progress * (HIT_LINE_Y - NOTE_SPAWN_Y)
}
