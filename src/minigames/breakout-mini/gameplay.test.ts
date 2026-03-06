import { describe, expect, it } from 'vitest'

import {
  BREAKOUT_DETACH_DISTANCE_PX,
  createBreakoutBrickProfile,
  getShockwaveTargetIds,
  shouldDetachBallFromPad,
} from './gameplay'

describe('breakout-mini gameplay helpers', () => {
  it('keeps early-stage bricks free of gimmicks and introduces shock bricks later', () => {
    expect(createBreakoutBrickProfile(1, 0, 0).gimmick).toBe('none')

    const laterStageProfiles = Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 8 }, (_, col) => createBreakoutBrickProfile(3, row, col)),
    ).flat()

    expect(laterStageProfiles.some((profile) => profile.gimmick === 'shock')).toBe(true)
    expect(laterStageProfiles.some((profile) => profile.unbreakable)).toBe(true)
  })

  it('detaches the ball only after meaningful paddle movement', () => {
    expect(shouldDetachBallFromPad(180, 180 + BREAKOUT_DETACH_DISTANCE_PX - 1)).toBe(false)
    expect(shouldDetachBallFromPad(180, 180 + BREAKOUT_DETACH_DISTANCE_PX)).toBe(true)
    expect(shouldDetachBallFromPad(180, 180 - BREAKOUT_DETACH_DISTANCE_PX)).toBe(true)
  })

  it('selects only nearby breakable bricks for the shockwave', () => {
    const ids = getShockwaveTargetIds(
      [
        { id: 1, x: 100, y: 100, alive: false, unbreakable: false },
        { id: 2, x: 130, y: 108, alive: true, unbreakable: false },
        { id: 3, x: 145, y: 132, alive: true, unbreakable: false },
        { id: 4, x: 210, y: 210, alive: true, unbreakable: false },
        { id: 5, x: 126, y: 120, alive: true, unbreakable: true },
      ],
      1,
      56,
    )

    expect(ids).toEqual([2, 3])
  })
})
