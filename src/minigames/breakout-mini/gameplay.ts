export type BreakoutBrickGimmick = 'none' | 'shock'

export interface BreakoutBrickProfile {
  readonly unbreakable: boolean
  readonly maxHp: number
  readonly gimmick: BreakoutBrickGimmick
}

export interface BreakoutShockwaveBrick {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly alive: boolean
  readonly unbreakable: boolean
}

export const BREAKOUT_DETACH_DISTANCE_PX = 12
export const BREAKOUT_SHOCK_STAGE = 2
export const BREAKOUT_SHOCK_RADIUS = 56

export function createBreakoutBrickProfile(stage: number, row: number, col: number): BreakoutBrickProfile {
  const unbreakable = stage >= 3 && (row + col + stage) % 11 === 0
  const twoHit = !unbreakable && stage >= 2 && (row * 3 + col + stage) % 5 === 0
  const gimmick =
    !unbreakable && stage >= BREAKOUT_SHOCK_STAGE && (row * 5 + col * 3 + stage) % 9 === 0
      ? 'shock'
      : 'none'

  return {
    unbreakable,
    maxHp: unbreakable ? 999 : twoHit ? 2 : 1,
    gimmick,
  }
}

export function shouldDetachBallFromPad(
  currentPadX: number,
  targetPadX: number,
  thresholdPx = BREAKOUT_DETACH_DISTANCE_PX,
): boolean {
  return Math.abs(targetPadX - currentPadX) >= thresholdPx
}

export function getShockwaveTargetIds(
  bricks: readonly BreakoutShockwaveBrick[],
  originId: number,
  radius = BREAKOUT_SHOCK_RADIUS,
): number[] {
  const origin = bricks.find((brick) => brick.id === originId)
  if (origin === undefined) return []

  const radiusSquared = radius * radius

  return bricks
    .filter((brick) => {
      if (brick.id === originId || !brick.alive || brick.unbreakable) return false
      const dx = brick.x - origin.x
      const dy = brick.y - origin.y
      return dx * dx + dy * dy <= radiusSquared
    })
    .map((brick) => brick.id)
}
