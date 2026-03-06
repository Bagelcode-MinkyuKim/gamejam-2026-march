export const VIEWBOX_WIDTH = 360
export const VIEWBOX_HEIGHT = 640
export const GROUND_Y = VIEWBOX_HEIGHT - 72

export const GAME_TIMEOUT_MS = 120_000
export const MAX_SHOTS = 15
export const GRAVITY = 260

export const CANNON_X = 58
export const CANNON_Y = GROUND_Y - 8
export const MIN_ANGLE_DEG = 8
export const MAX_ANGLE_DEG = 82
export const DEFAULT_ANGLE_DEG = 46
export const MIN_POWER = 120
export const MAX_POWER = 460
export const POWER_FILL_SPEED = 420

export const TARGET_RADIUS = 16
export const TARGET_MIN_X = 192
export const TARGET_MAX_X = VIEWBOX_WIDTH - 34
export const TARGET_MIN_Y = 88
export const TARGET_MAX_Y = VIEWBOX_HEIGHT - 190
export const MOVING_TARGET_SPEED = 42
export const PROJECTILE_RADIUS = 6
export const POWERUP_RADIUS = 15
export const TRAIL_MAX_LENGTH = 90
export const EXPLOSION_DURATION_MS = 420
export const RESULT_DISPLAY_MS = 780

const PERFECT_HIT_RADIUS = 8
const GOOD_HIT_RADIUS = 18
const OK_HIT_RADIUS = 28
const NEAR_HIT_RADIUS = 42
const WIND_MAX = 88

export type PowerupType = 'double' | 'big-target' | 'slow-wind' | 'extra-shot'
export type PortalLock = 'entry' | 'exit' | null
export type TargetAxis = 'x' | 'y'
export type ObstacleKind = 'wall' | 'reflector'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Velocity {
  readonly x: number
  readonly y: number
}

export interface ProjectilePreview extends Point {
  readonly vx: number
  readonly vy: number
}

export interface TargetInfo extends Point {
  readonly radius: number
  readonly isBonus: boolean
  readonly moving: boolean
  readonly direction: number
  readonly speed: number
  readonly axis: TargetAxis
}

export interface Obstacle {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly kind: ObstacleKind
}

export interface PowerupItem extends Point {
  readonly type: PowerupType
  readonly collected: boolean
}

export interface PortalPair {
  readonly entry: Point
  readonly exit: Point
  readonly radius: number
}

export interface WindTunnel {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly force: number
}

export interface BombHazard extends Point {
  readonly radius: number
  readonly vy: number
  readonly active: boolean
}

export interface ShotLayout {
  readonly targets: TargetInfo[]
  readonly wind: number
  readonly obstacle: Obstacle | null
  readonly powerup: PowerupItem | null
  readonly portalPair: PortalPair | null
  readonly windTunnel: WindTunnel | null
  readonly bomb: BombHazard | null
  readonly gimmicks: string[]
}

export const POWERUP_TYPES: readonly PowerupType[] = ['double', 'big-target', 'slow-wind', 'extra-shot'] as const

export const POWERUP_COLORS: Record<PowerupType, string> = {
  double: '#f6bd32',
  'big-target': '#64e59c',
  'slow-wind': '#7dd3fc',
  'extra-shot': '#f9a8d4',
}

export const POWERUP_LABELS: Record<PowerupType, string> = {
  double: '2X',
  'big-target': 'BIG',
  'slow-wind': 'CALM',
  'extra-shot': '+1',
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function degToRad(value: number): number {
  return (value * Math.PI) / 180
}

export function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function createLaunchVelocity(angleDeg: number, power: number): Velocity {
  const angleRad = degToRad(angleDeg)
  return {
    x: Math.cos(angleRad) * power,
    y: -Math.sin(angleRad) * power,
  }
}

export function scoreForDistance(distance: number, targetRadius: number): { score: number; label: string } {
  if (distance <= PERFECT_HIT_RADIUS) return { score: 100, label: 'PERFECT!' }
  if (distance <= GOOD_HIT_RADIUS) return { score: 60, label: 'GOOD!' }
  if (distance <= targetRadius + OK_HIT_RADIUS * 0.5) return { score: 30, label: 'OK' }
  if (distance <= targetRadius + NEAR_HIT_RADIUS * 0.5) return { score: 10, label: 'NEAR' }
  return { score: 0, label: 'MISS' }
}

export function stepMovingTargets(targets: readonly TargetInfo[], deltaSec: number): TargetInfo[] {
  return targets.map((target) => {
    if (!target.moving) return target
    if (target.axis === 'x') {
      let nextX = target.x + target.direction * target.speed * deltaSec
      let nextDirection = target.direction
      if (nextX < TARGET_MIN_X || nextX > TARGET_MAX_X) {
        nextDirection *= -1
        nextX = clampNumber(nextX, TARGET_MIN_X, TARGET_MAX_X)
      }
      return { ...target, x: nextX, direction: nextDirection }
    }

    let nextY = target.y + target.direction * target.speed * deltaSec
    let nextDirection = target.direction
    if (nextY < TARGET_MIN_Y || nextY > TARGET_MAX_Y) {
      nextDirection *= -1
      nextY = clampNumber(nextY, TARGET_MIN_Y, TARGET_MAX_Y)
    }
    return { ...target, y: nextY, direction: nextDirection }
  })
}

export function pointInsideRect(
  point: Point,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

export function applyWindTunnelForce(
  projectile: ProjectilePreview,
  windTunnel: WindTunnel | null,
  deltaSec: number,
): ProjectilePreview {
  if (windTunnel === null || !pointInsideRect(projectile, windTunnel)) {
    return projectile
  }

  return {
    ...projectile,
    vx: projectile.vx + windTunnel.force * deltaSec,
    vy: projectile.vy - 24 * deltaSec,
  }
}

export function stepBombHazard(bomb: BombHazard | null, deltaSec: number): BombHazard | null {
  if (bomb === null || !bomb.active) return bomb
  let nextY = bomb.y + bomb.vy * deltaSec
  let nextVy = bomb.vy
  if (nextY < 132 || nextY > GROUND_Y - 104) {
    nextVy *= -1
    nextY = clampNumber(nextY, 132, GROUND_Y - 104)
  }
  return { ...bomb, y: nextY, vy: nextVy }
}

export function resolvePortalTeleport(
  projectile: ProjectilePreview,
  portalPair: PortalPair | null,
  lockedSide: PortalLock,
): { projectile: ProjectilePreview; lockedSide: PortalLock; didTeleport: boolean } {
  if (portalPair === null) {
    return { projectile, lockedSide: null, didTeleport: false }
  }

  const entryDistance = distanceBetween(projectile, portalPair.entry)
  const exitDistance = distanceBetween(projectile, portalPair.exit)

  let nextLock = lockedSide
  if (lockedSide === 'entry' && entryDistance > portalPair.radius * 1.35) nextLock = null
  if (lockedSide === 'exit' && exitDistance > portalPair.radius * 1.35) nextLock = null

  const norm = normalizeVelocity(projectile.vx, projectile.vy)
  const offset = portalPair.radius + 6

  if (nextLock === null && entryDistance <= portalPair.radius) {
    return {
      projectile: {
        ...projectile,
        x: portalPair.exit.x + norm.x * offset,
        y: portalPair.exit.y + norm.y * offset,
      },
      lockedSide: 'exit',
      didTeleport: true,
    }
  }

  if (nextLock === null && exitDistance <= portalPair.radius) {
    return {
      projectile: {
        ...projectile,
        x: portalPair.entry.x + norm.x * offset,
        y: portalPair.entry.y + norm.y * offset,
      },
      lockedSide: 'entry',
      didTeleport: true,
    }
  }

  return { projectile, lockedSide: nextLock, didTeleport: false }
}

export function createShotLayout(shotNumber: number, random: () => number = Math.random): ShotLayout {
  const targets = createTargets(shotNumber, random)
  const obstacle = shotNumber >= 3 ? createObstacle(shotNumber, random) : null
  const powerup = shotNumber >= 5 && shotNumber % 2 === 1 ? createPowerup(shotNumber, random) : null
  const portalPair = shotNumber >= 6 && shotNumber % 3 === 0 ? createPortalPair(random) : null
  const windTunnel = shotNumber >= 8 && shotNumber % 3 === 2 ? createWindTunnel(shotNumber, random) : null
  const bomb = shotNumber >= 10 && shotNumber % 4 === 2 ? createBomb(random) : null

  const gimmicks: string[] = []
  if (targets.some((target) => target.moving)) gimmicks.push('MOVE')
  if (targets.length > 1) gimmicks.push(targets.length === 3 ? 'TRIO' : 'DUO')
  if (targets.some((target) => target.isBonus)) gimmicks.push('BONUS')
  if (obstacle !== null) gimmicks.push(obstacle.kind === 'reflector' ? 'REFLECT' : 'WALL')
  if (powerup !== null) gimmicks.push(POWERUP_LABELS[powerup.type])
  if (portalPair !== null) gimmicks.push('PORTAL')
  if (windTunnel !== null) gimmicks.push('JET')
  if (bomb !== null) gimmicks.push('BOMB')

  return {
    targets,
    wind: randomWind(shotNumber, random),
    obstacle,
    powerup,
    portalPair,
    windTunnel,
    bomb,
    gimmicks,
  }
}

function createTargets(shotNumber: number, random: () => number): TargetInfo[] {
  const targetCount = shotNumber >= 12 ? 3 : shotNumber >= 7 ? 2 : 1
  return Array.from({ length: targetCount }, (_, index) => {
    const laneBase = TARGET_MIN_X + 34 + index * 52
    const x = clampNumber(laneBase + randomBetween(-16, 18, random), TARGET_MIN_X, TARGET_MAX_X)
    const yBand = TARGET_MIN_Y + ((shotNumber * 41 + index * 67) % (TARGET_MAX_Y - TARGET_MIN_Y - 1))
    const y = clampNumber(yBand + randomBetween(-24, 24, random), TARGET_MIN_Y, TARGET_MAX_Y)
    const moving = shotNumber >= 4 && (index === 0 || shotNumber >= 9)
    return {
      x,
      y,
      radius: shotNumber >= 11 && index > 0 ? TARGET_RADIUS - 2 : TARGET_RADIUS,
      isBonus: shotNumber >= 2 && ((shotNumber + index) % 2 === 0),
      moving,
      direction: random() < 0.5 ? -1 : 1,
      speed: MOVING_TARGET_SPEED + ((shotNumber + index) % 4) * 10,
      axis: shotNumber >= 9 && index % 2 === 1 ? 'x' : 'y',
    }
  })
}

function createObstacle(shotNumber: number, random: () => number): Obstacle {
  return {
    x: randomBetween(176, 246, random),
    y: randomBetween(220, 384, random),
    width: shotNumber >= 9 ? 34 : 28,
    height: shotNumber >= 9 ? 96 : 78,
    kind: shotNumber % 4 === 0 ? 'reflector' : 'wall',
  }
}

function createPowerup(shotNumber: number, random: () => number): PowerupItem {
  return {
    x: randomBetween(146, 312, random),
    y: randomBetween(156, 402, random),
    type: POWERUP_TYPES[shotNumber % POWERUP_TYPES.length],
    collected: false,
  }
}

function createPortalPair(random: () => number): PortalPair {
  return {
    entry: {
      x: randomBetween(196, 234, random),
      y: randomBetween(148, 262, random),
    },
    exit: {
      x: randomBetween(284, 330, random),
      y: randomBetween(284, 424, random),
    },
    radius: 18,
  }
}

function createWindTunnel(shotNumber: number, random: () => number): WindTunnel {
  const force = (shotNumber % 2 === 0 ? 1 : -1) * (44 + shotNumber * 2)
  return {
    x: randomBetween(188, 246, random),
    y: randomBetween(170, 346, random),
    width: 88,
    height: 64,
    force,
  }
}

function createBomb(random: () => number): BombHazard {
  return {
    x: randomBetween(224, 322, random),
    y: randomBetween(142, 190, random),
    radius: 14,
    vy: random() < 0.5 ? 74 : -74,
    active: true,
  }
}

function randomWind(shotNumber: number, random: () => number): number {
  const maxStrength = Math.min(WIND_MAX, 22 + shotNumber * 5)
  const strength = Math.round(randomBetween(10, maxStrength, random))
  return (random() < 0.5 ? -1 : 1) * strength
}

function randomBetween(min: number, max: number, random: () => number): number {
  return min + (max - min) * random()
}

function normalizeVelocity(vx: number, vy: number): Velocity {
  const length = Math.hypot(vx, vy)
  if (length <= 0.0001) {
    return { x: 1, y: -1 }
  }
  return { x: vx / length, y: vy / length }
}
