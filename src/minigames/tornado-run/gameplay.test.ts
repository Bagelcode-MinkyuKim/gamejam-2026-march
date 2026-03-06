import { describe, expect, it } from 'vitest'
import {
  DIFFICULTY_STAGES,
  getBlockedHazardLanes,
  getDifficultyStage,
  getDifficultyStageIndex,
  getLaneCueStates,
  pickHazardSpawnLanes,
  type TornadoRunObstaclePreview,
} from './gameplay'

describe('tornado-run gameplay helpers', () => {
  it('promotes difficulty by the furthest progress signal', () => {
    const stage = getDifficultyStage({
      score: 180,
      elapsedMs: 90000,
      level: 2,
    })

    expect(stage.id).toBe('supercell')
    expect(getDifficultyStageIndex(stage)).toBe(4)
  })

  it('reaches the final stage from level progression even with modest score', () => {
    const stage = getDifficultyStage({
      score: 1200,
      elapsedMs: 52000,
      level: 10,
    })

    expect(stage.id).toBe(DIFFICULTY_STAGES.at(-1)?.id)
  })

  it('prioritizes move warnings over rewards in lane cues', () => {
    const obstacles: TornadoRunObstaclePreview[] = [
      { lane: 0, y: 470, type: 'coin', spawnTime: 0 },
      { lane: 1, y: 500, type: 'lightning_warn', spawnTime: 0 },
      { lane: 2, y: 460, type: 'shield', spawnTime: 0 },
    ]

    const cues = getLaneCueStates(obstacles, 680)

    expect(cues[0]).toMatchObject({ kind: 'reward', label: 'COIN' })
    expect(cues[1]).toMatchObject({ kind: 'warning', label: 'MOVE' })
    expect(cues[2]).toMatchObject({ kind: 'item', label: 'ITEM' })
  })

  it('keeps danger priority when reward and obstacle share a lane', () => {
    const obstacles: TornadoRunObstaclePreview[] = [
      { lane: 1, y: 470, type: 'coin', spawnTime: 0 },
      { lane: 1, y: 510, type: 'whirlwind', spawnTime: 0 },
    ]

    const cues = getLaneCueStates(obstacles, 680)

    expect(cues[1].kind).toBe('danger')
    expect(cues[1].label).toBe('AVOID')
  })

  it('marks only imminent hazards as blocked lanes', () => {
    const obstacles: TornadoRunObstaclePreview[] = [
      { lane: 0, y: 450, type: 'whirlwind', spawnTime: 0 },
      { lane: 1, y: 520, type: 'lightning_warn', spawnTime: 0 },
      { lane: 2, y: 180, type: 'coin', spawnTime: 0 },
    ]

    const blocked = getBlockedHazardLanes(obstacles, 680)

    expect([...blocked].sort()).toEqual([0, 1])
  })

  it('never fills the last safe lane when picking new hazard lanes', () => {
    const obstacles: TornadoRunObstaclePreview[] = [
      { lane: 0, y: 470, type: 'whirlwind', spawnTime: 0 },
      { lane: 1, y: 500, type: 'dark_cloud', spawnTime: 0 },
    ]

    const picked = pickHazardSpawnLanes(obstacles, 680, 2)

    expect(picked).not.toContain(2)
  })
})
