export const TORNADO_RUN_LANE_COUNT = 3
export const TORNADO_RUN_CHARACTER_SIZE = 80
export const TORNADO_RUN_CHARACTER_BOTTOM = 110

const LANE_CUE_LOOKAHEAD_PX = 320
const LANE_CUE_PADDING_PX = 72
const HAZARD_LOOKAHEAD_PX = 210
const HAZARD_RECOVERY_PX = 84

export type TornadoRunObstacleType =
  | 'whirlwind'
  | 'gust'
  | 'dark_cloud'
  | 'lightning_warn'
  | 'lightning'
  | 'coin'
  | 'shield'
  | 'score_zone'
  | 'magnet'
  | 'slowmo'

export interface TornadoRunObstaclePreview {
  readonly lane: number
  readonly y: number
  readonly type: TornadoRunObstacleType
  readonly spawnTime: number
}

export interface TornadoRunDifficultyStage {
  readonly id: string
  readonly label: string
  readonly scoreThreshold: number
  readonly elapsedMsThreshold: number
  readonly levelThreshold: number
  readonly speedMult: number
  readonly spawnMult: number
  readonly tornadoChance: number
  readonly coinChance: number
  readonly itemSpawnMult: number
  readonly gustChance: number
  readonly darkCloudChance: number
  readonly lightningChance: number
  readonly multiChance: number
}

export const DIFFICULTY_STAGES: readonly TornadoRunDifficultyStage[] = [
  {
    id: 'breeze',
    label: 'BREEZE',
    scoreThreshold: 0,
    elapsedMsThreshold: 0,
    levelThreshold: 1,
    speedMult: 1,
    spawnMult: 1,
    tornadoChance: 0.42,
    coinChance: 0.72,
    itemSpawnMult: 1.22,
    gustChance: 0.24,
    darkCloudChance: 0,
    lightningChance: 0,
    multiChance: 0,
  },
  {
    id: 'crosswind',
    label: 'CROSSWIND',
    scoreThreshold: 250,
    elapsedMsThreshold: 18000,
    levelThreshold: 2,
    speedMult: 1.08,
    spawnMult: 0.95,
    tornadoChance: 0.52,
    coinChance: 0.66,
    itemSpawnMult: 1.08,
    gustChance: 0.28,
    darkCloudChance: 0.06,
    lightningChance: 0,
    multiChance: 0.06,
  },
  {
    id: 'storm',
    label: 'STORM',
    scoreThreshold: 700,
    elapsedMsThreshold: 38000,
    levelThreshold: 4,
    speedMult: 1.18,
    spawnMult: 0.86,
    tornadoChance: 0.62,
    coinChance: 0.58,
    itemSpawnMult: 1,
    gustChance: 0.32,
    darkCloudChance: 0.14,
    lightningChance: 0.04,
    multiChance: 0.14,
  },
  {
    id: 'cyclone',
    label: 'CYCLONE',
    scoreThreshold: 1500,
    elapsedMsThreshold: 62000,
    levelThreshold: 6,
    speedMult: 1.32,
    spawnMult: 0.76,
    tornadoChance: 0.72,
    coinChance: 0.52,
    itemSpawnMult: 0.92,
    gustChance: 0.34,
    darkCloudChance: 0.2,
    lightningChance: 0.08,
    multiChance: 0.22,
  },
  {
    id: 'supercell',
    label: 'SUPERCELL',
    scoreThreshold: 2600,
    elapsedMsThreshold: 86000,
    levelThreshold: 8,
    speedMult: 1.48,
    spawnMult: 0.66,
    tornadoChance: 0.8,
    coinChance: 0.46,
    itemSpawnMult: 0.82,
    gustChance: 0.35,
    darkCloudChance: 0.24,
    lightningChance: 0.11,
    multiChance: 0.32,
  },
  {
    id: 'eye-wall',
    label: 'EYE WALL',
    scoreThreshold: 4000,
    elapsedMsThreshold: 105000,
    levelThreshold: 10,
    speedMult: 1.65,
    spawnMult: 0.56,
    tornadoChance: 0.88,
    coinChance: 0.4,
    itemSpawnMult: 0.74,
    gustChance: 0.38,
    darkCloudChance: 0.28,
    lightningChance: 0.14,
    multiChance: 0.46,
  },
] as const

export interface TornadoRunProgressState {
  readonly score: number
  readonly elapsedMs: number
  readonly level: number
}

export function getDifficultyStage(progress: TornadoRunProgressState): TornadoRunDifficultyStage {
  const scoreIndex = findStageIndex(progress.score, 'scoreThreshold')
  const elapsedIndex = findStageIndex(progress.elapsedMs, 'elapsedMsThreshold')
  const levelIndex = findStageIndex(progress.level, 'levelThreshold')
  return DIFFICULTY_STAGES[Math.max(scoreIndex, elapsedIndex, levelIndex)]
}

export function getDifficultyStageIndex(stage: TornadoRunDifficultyStage): number {
  return DIFFICULTY_STAGES.findIndex((candidate) => candidate.id === stage.id)
}

export type TornadoRunLaneCueKind = 'neutral' | 'reward' | 'item' | 'danger' | 'warning'

export interface TornadoRunLaneCueState {
  readonly lane: number
  readonly kind: TornadoRunLaneCueKind
  readonly label: string
  readonly intensity: number
}

export function getLaneCueStates(
  obstacles: readonly TornadoRunObstaclePreview[],
  boardHeight: number,
): readonly TornadoRunLaneCueState[] {
  const playerCenterY =
    boardHeight - TORNADO_RUN_CHARACTER_BOTTOM - TORNADO_RUN_CHARACTER_SIZE / 2
  const cues: TornadoRunLaneCueState[] = Array.from(
    { length: TORNADO_RUN_LANE_COUNT },
    (_, lane) => ({
      lane,
      kind: 'neutral',
      label: '',
      intensity: 0,
    }),
  )

  for (const obstacle of obstacles) {
    const distanceFromPlayer = playerCenterY - obstacle.y
    if (distanceFromPlayer < -LANE_CUE_PADDING_PX || distanceFromPlayer > LANE_CUE_LOOKAHEAD_PX) {
      continue
    }

    const nextCue = getCueForObstacle(obstacle.type)
    const intensity = clamp(1 - distanceFromPlayer / LANE_CUE_LOOKAHEAD_PX, 0.2, 0.98)
    const currentCue = cues[obstacle.lane]
    const shouldReplace =
      getCuePriority(nextCue.kind) > getCuePriority(currentCue.kind) ||
      (nextCue.kind === currentCue.kind && intensity > currentCue.intensity)

    if (shouldReplace) {
      cues[obstacle.lane] = {
        lane: obstacle.lane,
        kind: nextCue.kind,
        label: nextCue.label,
        intensity,
      }
    }
  }

  return cues
}

export function pickHazardSpawnLanes(
  obstacles: readonly TornadoRunObstaclePreview[],
  boardHeight: number,
  desiredCount: number,
): readonly number[] {
  const blockedLanes = getBlockedHazardLanes(obstacles, boardHeight)
  const nextBlockedLanes = new Set<number>(blockedLanes)
  const lanes = shuffleLanes(Array.from({ length: TORNADO_RUN_LANE_COUNT }, (_, lane) => lane))
  const prioritizedLanes = [
    ...lanes.filter((lane) => blockedLanes.has(lane)),
    ...lanes.filter((lane) => !blockedLanes.has(lane)),
  ]
  const selected: number[] = []

  for (const lane of prioritizedLanes) {
    if (selected.length >= desiredCount) {
      break
    }

    const blockedSizeAfterSpawn = nextBlockedLanes.has(lane)
      ? nextBlockedLanes.size
      : nextBlockedLanes.size + 1

    if (blockedSizeAfterSpawn >= TORNADO_RUN_LANE_COUNT) {
      continue
    }

    selected.push(lane)
    nextBlockedLanes.add(lane)
  }

  return selected
}

export function getBlockedHazardLanes(
  obstacles: readonly TornadoRunObstaclePreview[],
  boardHeight: number,
): ReadonlySet<number> {
  const playerTopY = boardHeight - TORNADO_RUN_CHARACTER_BOTTOM - TORNADO_RUN_CHARACTER_SIZE
  const blockedLanes = new Set<number>()

  for (const obstacle of obstacles) {
    if (!blocksLaneSoon(obstacle)) {
      continue
    }

    if (
      obstacle.y >= playerTopY - HAZARD_LOOKAHEAD_PX &&
      obstacle.y <= playerTopY + HAZARD_RECOVERY_PX
    ) {
      blockedLanes.add(obstacle.lane)
    }
  }

  return blockedLanes
}

function findStageIndex(
  currentValue: number,
  key: 'scoreThreshold' | 'elapsedMsThreshold' | 'levelThreshold',
): number {
  let index = 0
  for (let stageIndex = 0; stageIndex < DIFFICULTY_STAGES.length; stageIndex += 1) {
    if (currentValue >= DIFFICULTY_STAGES[stageIndex][key]) {
      index = stageIndex
    }
  }
  return index
}

function getCueForObstacle(type: TornadoRunObstacleType): {
  readonly kind: TornadoRunLaneCueKind
  readonly label: string
} {
  if (type === 'lightning_warn') {
    return { kind: 'warning', label: 'MOVE' }
  }
  if (type === 'coin') {
    return { kind: 'reward', label: 'COIN' }
  }
  if (type === 'shield' || type === 'score_zone' || type === 'magnet' || type === 'slowmo') {
    return { kind: 'item', label: 'ITEM' }
  }
  return { kind: 'danger', label: 'AVOID' }
}

function getCuePriority(kind: TornadoRunLaneCueKind): number {
  if (kind === 'warning') return 4
  if (kind === 'danger') return 3
  if (kind === 'item') return 2
  if (kind === 'reward') return 1
  return 0
}

function blocksLaneSoon(obstacle: TornadoRunObstaclePreview): boolean {
  return (
    obstacle.type === 'whirlwind' ||
    obstacle.type === 'gust' ||
    obstacle.type === 'dark_cloud' ||
    obstacle.type === 'lightning_warn' ||
    obstacle.type === 'lightning'
  )
}

function shuffleLanes(lanes: number[]): number[] {
  const copy = [...lanes]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    const current = copy[index]
    copy[index] = copy[swapIndex]
    copy[swapIndex] = current
  }
  return copy
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
