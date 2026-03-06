import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import gogunbuntuBg from '../../../assets/images/gogunbuntu/gogunbuntu-bg.png'
import gogunbuntuAnchor from '../../../assets/images/gogunbuntu/gogunbuntu-anchor.png'
import gogunbuntuObstacle from '../../../assets/images/gogunbuntu/gogunbuntu-obstacle.png'
import gogunbuntuCoin from '../../../assets/images/gogunbuntu/gogunbuntu-coin.png'
import gogunbuntuSparkSheet from '../../../assets/images/gogunbuntu/gogunbuntu-spark-sheet.png'
import gogunbuntuSmokeSheet from '../../../assets/images/gogunbuntu/gogunbuntu-smoke-sheet.png'
import kimYeonjaDotCharacter from '../../../assets/images/gogunbuntu/dot-characters/kim-yeonja.png'
import parkSangminDotCharacter from '../../../assets/images/gogunbuntu/dot-characters/park-sangmin.png'
import hookShootSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-hook-shoot.mp3'
import jumpSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-jump.mp3'
import coinSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-coin.mp3'
import hitSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-hit.mp3'
import springSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-spring.mp3'
import boostSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-boost.mp3'
import iceSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-ice.mp3'
import crumbleSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-crumble.mp3'
import fallSfx from '../../../assets/sounds/gogunbuntu/gogunbuntu-fall.mp3'
import bgmLoop from '../../../assets/sounds/gogunbuntu/gogunbuntu-bgm-loop.mp3'

const STAGE_VIEW_WIDTH = 360
const STAGE_VIEW_HEIGHT = 560
const GROUND_SCREEN_OFFSET = 160

const PLAYER_WIDTH = 86
const PLAYER_HEIGHT = 86
const PLAYER_FEET_OFFSET = 4
const PLAYER_COLLIDER_RADIUS = 17
const PLAYER_START_X = 60
const PLAYER_START_Y = 0

const BASE_RUN_SPEED = 220
const MAX_RUN_SPEED = 360
const RUN_ACCELERATION = 60
const AIR_DRAG = 0.996

const GRAVITY_UP = -1600
const GRAVITY_DOWN = -3000
const GRAVITY_APEX = -900
const APEX_THRESHOLD = 100
const JUMP_VELOCITY = 760
const JUMP_CUTOFF_MULTIPLIER = 0.55
const JUMP_CUT_GRACE_MS = 100
const COYOTE_TIME_MS = 140
const JUMP_BUFFER_MS = 140

const HOOK_RANGE = 332
const HOOK_MIN_LENGTH = 72
const HOOK_RELEASE_BOOST = 90
const HOOK_PULL_ACCEL = 280
const HOOK_MAX_SPEED = 480
const CHAIN_COMBO_WINDOW_MS = 2050

const GROUND_MIN_HEIGHT = 0
const GROUND_MAX_HEIGHT = 128

const ANCHOR_MIN_HEIGHT = 146
const ANCHOR_MAX_HEIGHT = 292
const ANCHOR_RADIUS = 20

const OBSTACLE_MIN_HEIGHT = 80
const OBSTACLE_MAX_HEIGHT = 230
const OBSTACLE_SIZE = 58
const OBSTACLE_COLLIDER_RADIUS = 20

const COIN_RADIUS = 26
const COIN_SIZE = 56

const CAMERA_LEAD_X = 132
const WORLD_AHEAD_PADDING = 1160
const WORLD_BEHIND_TRIM = 280

const TRAIL_INTERVAL_MS = 120
const SPARK_LIFETIME_MS = 420
const SMOKE_LIFETIME_MS = 580

const SCORE_DISTANCE_MULTIPLIER = 0.3
const SCORE_COIN_BONUS = 52
const SCORE_CHAIN_BONUS = 28
const SCORE_TRICK_BONUS = 34

const GOGUNBUNTU_PLAYER_SKINS = [
  {
    name: 'Kim Yeonja',
    imageSrc: kimYeonjaDotCharacter,
    flipX: true,
  },
  {
    name: 'Park Sangmin',
    imageSrc: parkSangminDotCharacter,
    flipX: false,
  },
] as const

type EffectKind = 'spark' | 'smoke'
type SegmentGimmick = 'normal' | 'crumble' | 'spring' | 'ice' | 'conveyor' | 'moving' | 'narrow' | 'boost' | 'gravity' | 'vanish' | 'trampoline'

const CRUMBLE_DELAY_MS = 400
const SPRING_BOOST = 1100
const ICE_DRAG = 0.97
const CONVEYOR_SPEED = 120
const MOVING_AMPLITUDE = 50
const MOVING_PERIOD_MS = 2000
const BOOST_SPEED_BONUS = 200
const GRAVITY_FLIP_BOOST = 650
const VANISH_ON_MS = 1400
const VANISH_OFF_MS = 800
const TRAMPOLINE_BOUNCE = 520

interface GroundSegment {
  readonly id: number
  readonly startX: number
  readonly endX: number
  readonly y: number
  readonly gimmick: SegmentGimmick
  crumbleTimer: number
  crumbleActive: boolean
}

interface AnchorPoint {
  readonly id: number
  readonly x: number
  readonly y: number
}

type ObstacleKind = 'spike' | 'laser' | 'swinger' | 'wall'

interface Obstacle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly kind: ObstacleKind
  readonly width: number
  readonly height: number
}

interface CoinPickup {
  readonly id: number
  readonly x: number
  readonly y: number
}

interface FxBurst {
  readonly id: number
  readonly kind: EffectKind
  readonly x: number
  readonly y: number
  readonly createdAtMs: number
  readonly lifetimeMs: number
}

const HOOK_EXTEND_SPEED = 1800
const HOOK_MIN_SPEED_FLOOR = 200

interface RopeState {
  readonly active: boolean
  readonly anchorX: number
  readonly anchorY: number
  readonly length: number
  readonly maxLength: number
  readonly extending: boolean
  currentLength: number
}

interface WorldModel {
  playerX: number
  playerY: number
  playerVx: number
  playerVy: number
  grounded: boolean
  speed: number
  cameraX: number
  elapsedMs: number
  score: number
  coinsCollected: number
  trickPoints: number
  comboChain: number
  bestComboChain: number
  lastHookAttachAtMs: number
  coyoteMs: number
  jumpBufferMs: number
  jumpHeld: boolean
  jumpCutRequested: boolean
  jumpQueued: boolean
  jumpStartMs: number
  doubleJumpAvailable: boolean
  magnetActiveUntil: number
  shieldActiveUntil: number
  hookQueued: boolean
  hookTargetX: number | null
  hookTargetY: number | null
  rope: RopeState
  statusText: string
  nextGroundId: number
  nextAnchorId: number
  nextObstacleId: number
  nextCoinId: number
  nextFxId: number
  lastTrailSpawnMs: number
  lastGeneratedX: number
  groundSegments: GroundSegment[]
  anchors: AnchorPoint[]
  obstacles: Obstacle[]
  coins: CoinPickup[]
  bursts: FxBurst[]
}

interface RenderState {
  readonly playerX: number
  readonly playerY: number
  readonly playerVx: number
  readonly playerVy: number
  readonly grounded: boolean
  readonly cameraX: number
  readonly speed: number
  readonly elapsedMs: number
  readonly score: number
  readonly comboChain: number
  readonly bestComboChain: number
  readonly coinsCollected: number
  readonly statusText: string
  readonly rope: RopeState
  readonly groundSegments: GroundSegment[]
  readonly anchors: AnchorPoint[]
  readonly obstacles: Obstacle[]
  readonly coins: CoinPickup[]
  readonly bursts: FxBurst[]
}

interface ScreenPoint {
  readonly x: number
  readonly y: number
}

interface StageViewport {
  readonly width: number
  readonly height: number
  readonly scale: number
  readonly originX: number
  readonly originY: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function distanceBetween(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

function getGroundSegmentAtX(segments: GroundSegment[], x: number): GroundSegment | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (x >= segment.startX && x <= segment.endX && !segment.crumbleActive) {
      return segment
    }
  }

  return null
}

function createStageViewport(width: number, height: number): StageViewport {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const scale = Math.min(safeWidth / STAGE_VIEW_WIDTH, safeHeight / STAGE_VIEW_HEIGHT)
  const scaledWorldWidth = STAGE_VIEW_WIDTH * scale
  const scaledWorldHeight = STAGE_VIEW_HEIGHT * scale

  return {
    width: safeWidth,
    height: safeHeight,
    scale,
    originX: (safeWidth - scaledWorldWidth) * 0.5,
    originY: safeHeight - scaledWorldHeight,
  }
}

function worldToScreen(x: number, y: number, cameraX: number, viewport: StageViewport): ScreenPoint {
  return {
    x: viewport.originX + (x - cameraX) * viewport.scale,
    y: viewport.originY + (STAGE_VIEW_HEIGHT - (GROUND_SCREEN_OFFSET + y)) * viewport.scale,
  }
}

function collideCircles(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  return distanceBetween(ax, ay, bx, by) <= ar + br
}

function lerpNumber(start: number, end: number, ratio: number): number {
  return start + (end - start) * ratio
}

function getRunProgress(playerX: number): number {
  return clampNumber((playerX - PLAYER_START_X) / 4200, 0, 1)
}

function createInitialModel(): WorldModel {
  const initialSegments: GroundSegment[] = [
    { id: 0, startX: -240, endX: 520, y: 0, gimmick: 'normal', crumbleTimer: 0, crumbleActive: false },
    { id: 1, startX: 600, endX: 1000, y: 0, gimmick: 'normal', crumbleTimer: 0, crumbleActive: false },
    { id: 2, startX: 1080, endX: 1400, y: 16, gimmick: 'normal', crumbleTimer: 0, crumbleActive: false },
  ]

  return {
    playerX: PLAYER_START_X,
    playerY: PLAYER_START_Y,
    playerVx: BASE_RUN_SPEED,
    playerVy: 0,
    grounded: true,
    speed: BASE_RUN_SPEED,
    cameraX: 0,
    elapsedMs: 0,
    score: 0,
    coinsCollected: 0,
    trickPoints: 0,
    comboChain: 0,
    bestComboChain: 0,
    lastHookAttachAtMs: -CHAIN_COMBO_WINDOW_MS,
    coyoteMs: COYOTE_TIME_MS,
    jumpBufferMs: 0,
    jumpHeld: false,
    jumpCutRequested: false,
    jumpQueued: false,
    jumpStartMs: 0,
    doubleJumpAvailable: false,
    magnetActiveUntil: 0,
    shieldActiveUntil: 0,
    hookQueued: false,
    hookTargetX: null,
    hookTargetY: null,
    rope: {
      active: false,
      anchorX: 0,
      anchorY: 0,
      length: 0,
      maxLength: 0,
      extending: false,
      currentLength: 0,
    },
    statusText: 'Jump and hook through terrain.',
    nextGroundId: 3,
    nextAnchorId: 0,
    nextObstacleId: 0,
    nextCoinId: 0,
    nextFxId: 0,
    lastTrailSpawnMs: 0,
    lastGeneratedX: 1400,
    groundSegments: initialSegments,
    anchors: [],
    obstacles: [],
    coins: [],
    bursts: [],
  }
}

function buildRenderState(model: WorldModel): RenderState {
  return {
    playerX: model.playerX,
    playerY: model.playerY,
    playerVx: model.playerVx,
    playerVy: model.playerVy,
    grounded: model.grounded,
    cameraX: model.cameraX,
    speed: model.speed,
    elapsedMs: model.elapsedMs,
    score: model.score,
    comboChain: model.comboChain,
    bestComboChain: model.bestComboChain,
    coinsCollected: model.coinsCollected,
    statusText: model.statusText,
    rope: model.rope,
    groundSegments: model.groundSegments,
    anchors: model.anchors,
    obstacles: model.obstacles,
    coins: model.coins,
    bursts: model.bursts,
  }
}

function pushBurst(model: WorldModel, kind: EffectKind, x: number, y: number): void {
  model.bursts = [
    ...model.bursts,
    {
      id: model.nextFxId,
      kind,
      x,
      y,
      createdAtMs: model.elapsedMs,
      lifetimeMs: kind === 'spark' ? SPARK_LIFETIME_MS : SMOKE_LIFETIME_MS,
    },
  ]
  model.nextFxId += 1
}

function pickGimmick(runProgress: number): SegmentGimmick {
  if (runProgress < 0.08) return 'normal'

  const pool: { gimmick: SegmentGimmick; weight: number; minProgress: number }[] = [
    { gimmick: 'spring', weight: 12, minProgress: 0.08 },
    { gimmick: 'conveyor', weight: 10, minProgress: 0.1 },
    { gimmick: 'boost', weight: 8, minProgress: 0.12 },
    { gimmick: 'trampoline', weight: 10, minProgress: 0.15 },
    { gimmick: 'ice', weight: 8, minProgress: 0.2 },
    { gimmick: 'crumble', weight: 10, minProgress: 0.25 },
    { gimmick: 'moving', weight: 8, minProgress: 0.3 },
    { gimmick: 'narrow', weight: 6, minProgress: 0.35 },
    { gimmick: 'gravity', weight: 5, minProgress: 0.4 },
    { gimmick: 'vanish', weight: 5, minProgress: 0.5 },
  ]

  const gimmickChance = lerpNumber(0.15, 0.55, runProgress)
  if (Math.random() > gimmickChance) return 'normal'

  const eligible = pool.filter((entry) => runProgress >= entry.minProgress)
  const totalWeight = eligible.reduce((sum, entry) => sum + entry.weight, 0)
  let roll = Math.random() * totalWeight
  for (const entry of eligible) {
    roll -= entry.weight
    if (roll <= 0) return entry.gimmick
  }
  return 'normal'
}

function getMaxJumpDistance(speed: number): number {
  const airTime = JUMP_VELOCITY / Math.abs(GRAVITY_UP) + JUMP_VELOCITY / Math.abs(GRAVITY_DOWN)
  return speed * airTime * 0.85
}

function addAnchorForGap(model: WorldModel, prevEndX: number, prevY: number, nextStartX: number, nextY: number): void {
  const gapCenterX = (prevEndX + nextStartX) * 0.5 + randomBetween(-12, 12)
  const anchorY = Math.max(prevY, nextY) + randomBetween(ANCHOR_MIN_HEIGHT * 0.7, ANCHOR_MAX_HEIGHT * 0.8)
  model.anchors = [...model.anchors, { id: model.nextAnchorId, x: gapCenterX, y: anchorY }]
  model.nextAnchorId += 1
}

function generateStairPattern(model: WorldModel, count: number, startX: number, baseY: number, stepUp: boolean): void {
  const stepWidth = randomBetween(70, 110)
  const stepGap = randomBetween(30, 50)
  const stepHeight = randomBetween(14, 24)
  let curX = startX
  let curY = baseY
  for (let i = 0; i < count; i += 1) {
    curY = clampNumber(stepUp ? curY + stepHeight : curY - stepHeight, GROUND_MIN_HEIGHT, GROUND_MAX_HEIGHT)
    const gimmick = i === count - 1 && Math.random() < 0.3 ? pickGimmick(0.3) : 'normal'
    const seg: GroundSegment = {
      id: model.nextGroundId,
      startX: curX,
      endX: curX + stepWidth,
      y: curY,
      gimmick,
      crumbleTimer: 0,
      crumbleActive: false,
    }
    model.groundSegments = [...model.groundSegments, seg]
    model.nextGroundId += 1
    if (i > 0 && stepGap > 40) {
      addAnchorForGap(model, curX - stepGap, curY, curX, curY)
    }
    curX += stepWidth + stepGap
  }
  model.lastGeneratedX = curX - stepGap
}

function extendWorld(model: WorldModel, minAheadX: number): void {
  while (model.lastGeneratedX < minAheadX) {
    const previous = model.groundSegments[model.groundSegments.length - 1]
    const segmentIndex = model.nextGroundId
    const runProgress = getRunProgress(model.playerX)
    const maxJump = getMaxJumpDistance(model.speed)

    const patternRoll = Math.random()
    if (runProgress > 0.15 && patternRoll < 0.12) {
      const stairGap = randomBetween(60, 90)
      const stairStartX = previous.endX + stairGap
      const stairCount = Math.floor(randomBetween(3, 5))
      generateStairPattern(model, stairCount, stairStartX, previous.y, Math.random() > 0.4)
      continue
    }

    const segmentLength = randomBetween(
      lerpNumber(260, 150, runProgress),
      lerpNumber(400, 250, runProgress),
    )

    const minGap = lerpNumber(60, 80, runProgress)
    const maxGap = Math.min(maxJump * 0.9, lerpNumber(120, 200, runProgress))
    const gapLength = randomBetween(minGap, Math.max(minGap + 20, maxGap))

    const needsHook = gapLength > maxJump * 0.6

    const nextStartX = previous.endX + gapLength
    const nextEndX = nextStartX + segmentLength

    const heightRange = lerpNumber(15, 50, runProgress)
    const nextY = clampNumber(
      previous.y + randomBetween(-heightRange, heightRange * 0.5),
      GROUND_MIN_HEIGHT,
      GROUND_MAX_HEIGHT,
    )

    const gimmick = pickGimmick(runProgress)
    const finalEndX = gimmick === 'narrow' ? nextStartX + Math.min(segmentLength, 80) : nextEndX
    const nextSegment: GroundSegment = {
      id: segmentIndex,
      startX: nextStartX,
      endX: finalEndX,
      y: nextY,
      gimmick,
      crumbleTimer: 0,
      crumbleActive: false,
    }

    model.groundSegments = [...model.groundSegments, nextSegment]
    model.nextGroundId += 1
    model.lastGeneratedX = finalEndX

    if (needsHook || Math.random() < 0.7) {
      addAnchorForGap(model, previous.endX, previous.y, nextStartX, nextY)
    }

    const obstacleChance = lerpNumber(0.12, 0.56, runProgress)
    if (Math.random() < obstacleChance) {
      const obstacleX = nextStartX + randomBetween(72, Math.max(108, finalEndX - nextStartX - 78))
      const kindRoll = Math.random()
      let obstacleKind: ObstacleKind = 'spike'
      let obsW = OBSTACLE_SIZE
      let obsH = OBSTACLE_SIZE
      let obsY = nextY + randomBetween(OBSTACLE_MIN_HEIGHT, OBSTACLE_MAX_HEIGHT)
      let obsR = OBSTACLE_COLLIDER_RADIUS

      if (kindRoll < 0.4) {
        obstacleKind = 'spike'
      } else if (kindRoll < 0.6) {
        obstacleKind = 'laser'
        obsW = 12
        obsH = randomBetween(80, 160)
        obsY = nextY + obsH * 0.5 + 20
        obsR = 8
      } else if (kindRoll < 0.8) {
        obstacleKind = 'swinger'
        obsY = nextY + randomBetween(140, 260)
      } else {
        obstacleKind = 'wall'
        obsW = 24
        obsH = randomBetween(60, 120)
        obsY = nextY + obsH * 0.5
        obsR = 14
      }

      model.obstacles = [
        ...model.obstacles,
        {
          id: model.nextObstacleId,
          x: obstacleX,
          y: obsY,
          radius: obsR,
          kind: obstacleKind,
          width: obsW,
          height: obsH,
        },
      ]
      model.nextObstacleId += 1
    }

    const coinCount = Math.random() < lerpNumber(0.72, 0.48, runProgress) ? 2 : 1
    for (let index = 0; index < coinCount; index += 1) {
      const coinX = nextStartX + ((index + 1) / (coinCount + 1)) * (nextEndX - nextStartX) + randomBetween(-16, 16)
      const coinY = nextY + randomBetween(44, 110)
      model.coins = [
        ...model.coins,
        {
          id: model.nextCoinId,
          x: coinX,
          y: coinY,
        },
      ]
      model.nextCoinId += 1
    }

    if (Math.random() < lerpNumber(0.54, 0.34, runProgress)) {
      const gapMidX = (previous.endX + nextStartX) * 0.5
      model.coins = [
        ...model.coins,
        {
          id: model.nextCoinId,
          x: gapMidX,
          y: Math.max(previous.y, nextY) + randomBetween(80, 160),
        },
      ]
      model.nextCoinId += 1
    }
  }
}

function trimWorld(model: WorldModel): void {
  const cutoffX = model.cameraX - WORLD_BEHIND_TRIM
  model.groundSegments = model.groundSegments.filter((segment) => segment.endX >= cutoffX)
  model.anchors = model.anchors.filter((anchor) => anchor.x >= cutoffX)
  model.obstacles = model.obstacles.filter((obstacle) => obstacle.x >= cutoffX)
  model.coins = model.coins.filter((coin) => coin.x >= cutoffX)
  model.bursts = model.bursts.filter((burst) => burst.createdAtMs + burst.lifetimeMs >= model.elapsedMs)
}

function performJump(model: WorldModel): boolean {
  const canJump = model.grounded || model.coyoteMs > 0
  if (!canJump) {
    if (model.doubleJumpAvailable) {
      model.doubleJumpAvailable = false
      model.playerVy = JUMP_VELOCITY * 0.85
      model.jumpStartMs = model.elapsedMs
      model.jumpBufferMs = 0
      return true
    }
    return false
  }

  model.playerVy = JUMP_VELOCITY
  model.grounded = false
  model.coyoteMs = 0
  model.jumpStartMs = model.elapsedMs
  model.jumpBufferMs = 0
  return true
}

function tryAttachHook(model: WorldModel): boolean {
  const candidates = model.anchors
    .map((anchor) => {
      const distance = distanceBetween(model.playerX, model.playerY, anchor.x, anchor.y)
      if (distance > HOOK_RANGE || anchor.x < model.playerX - 16) {
        return null
      }

      const targetXDistance = model.hookTargetX === null ? 0 : Math.abs(anchor.x - model.hookTargetX)
      const targetYDistance = model.hookTargetY === null ? 0 : Math.abs(anchor.y - model.hookTargetY)
      const targetWeight = targetXDistance + targetYDistance * 0.3
      return {
        anchor,
        distance,
        score: distance + targetWeight,
      }
    })
    .filter((candidate): candidate is { anchor: AnchorPoint; distance: number; score: number } => candidate !== null)

  if (candidates.length === 0) {
    model.statusText = 'Hook failed! No anchor in range.'
    return false
  }

  candidates.sort((left, right) => left.score - right.score)
  const chosen = candidates[0]
  const ropeLength = clampNumber(chosen.distance, HOOK_MIN_LENGTH, HOOK_RANGE)

  model.rope = {
    active: true,
    anchorX: chosen.anchor.x,
    anchorY: chosen.anchor.y,
    length: ropeLength,
    maxLength: ropeLength,
    extending: true,
    currentLength: 0,
  }

  const withinComboWindow = model.elapsedMs - model.lastHookAttachAtMs <= CHAIN_COMBO_WINDOW_MS
  model.comboChain = withinComboWindow ? model.comboChain + 1 : 1
  model.bestComboChain = Math.max(model.bestComboChain, model.comboChain)
  model.lastHookAttachAtMs = model.elapsedMs
  if (model.comboChain >= 2) {
    const comboAttachBonus = (model.comboChain - 1) * 6
    model.trickPoints += comboAttachBonus
    model.statusText = `Hook Chain x${model.comboChain} +${comboAttachBonus}`
  } else {
    model.statusText = 'Hook attached!'
  }
  pushBurst(model, 'spark', chosen.anchor.x, chosen.anchor.y)
  return true
}

function releaseHook(model: WorldModel): void {
  if (!model.rope.active) {
    return
  }

  const deltaX = model.playerX - model.rope.anchorX
  const deltaY = model.playerY - model.rope.anchorY
  const distance = Math.hypot(deltaX, deltaY) || 1
  const normalX = deltaX / distance
  const normalY = deltaY / distance

  let tangentX = -normalY
  let tangentY = normalX
  if (tangentX < 0) {
    tangentX *= -1
    tangentY *= -1
  }

  model.playerVx += tangentX * HOOK_RELEASE_BOOST
  model.playerVy += tangentY * HOOK_RELEASE_BOOST * 0.75

  const releaseSpeed = Math.hypot(model.playerVx, model.playerVy)
  if (releaseSpeed > HOOK_MAX_SPEED) {
    const capScale = HOOK_MAX_SPEED / releaseSpeed
    model.playerVx *= capScale
    model.playerVy *= capScale
  }
  const comboReleaseBonus = Math.max(0, model.comboChain - 1) * 5
  if (releaseSpeed >= 580) {
    const releaseBonus = SCORE_TRICK_BONUS + comboReleaseBonus
    model.trickPoints += releaseBonus
    model.statusText = `Release bonus +${releaseBonus}`
  } else {
    model.statusText = 'Release!'
  }

  model.rope = {
    active: false,
    anchorX: 0,
    anchorY: 0,
    length: 0,
    maxLength: 0,
    extending: false,
    currentLength: 0,
  }
  pushBurst(model, 'spark', model.playerX, model.playerY + 10)
}

function updateScore(model: WorldModel): void {
  const distanceScore = Math.max(0, Math.floor((model.playerX - PLAYER_START_X) * SCORE_DISTANCE_MULTIPLIER))
  const chainScore = Math.max(0, model.comboChain - 1) * SCORE_CHAIN_BONUS
  const coinScore = model.coinsCollected * SCORE_COIN_BONUS
  model.score = distanceScore + chainScore + coinScore + model.trickPoints
}

function GogunbuntuGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const initialModel = useMemo(() => createInitialModel(), [])
  const modelRef = useRef<WorldModel>(initialModel)
  const [renderState, setRenderState] = useState<RenderState>(() => buildRenderState(initialModel))
  const selectedPlayerSkin = GOGUNBUNTU_PLAYER_SKINS[Math.abs(bestScore) % GOGUNBUNTU_PLAYER_SKINS.length]
  const [stageViewport, setStageViewport] = useState<StageViewport>(() => createStageViewport(STAGE_VIEW_WIDTH, STAGE_VIEW_HEIGHT))

  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const stageViewportRef = useRef<StageViewport>(stageViewport)

  const hookShootAudioRef = useRef<HTMLAudioElement | null>(null)
  const jumpAudioRef = useRef<HTMLAudioElement | null>(null)
  const coinAudioRef = useRef<HTMLAudioElement | null>(null)
  const hitAudioRef = useRef<HTMLAudioElement | null>(null)
  const springAudioRef = useRef<HTMLAudioElement | null>(null)
  const boostAudioRef = useRef<HTMLAudioElement | null>(null)
  const iceAudioRef = useRef<HTMLAudioElement | null>(null)
  const crumbleAudioRef = useRef<HTMLAudioElement | null>(null)
  const fallAudioRef = useRef<HTMLAudioElement | null>(null)
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const isAudioUnlockedRef = useRef(false)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number) => {
    if (source === null) {
      return
    }

    source.volume = volume
    source.currentTime = 0
    void source.play().catch(() => {})
  }, [])

  const unlockAudio = useCallback(() => {
    if (isAudioUnlockedRef.current) {
      return
    }

    isAudioUnlockedRef.current = true
    if (bgmAudioRef.current !== null) {
      bgmAudioRef.current.currentTime = 0
      void bgmAudioRef.current.play().catch(() => {})
    }
  }, [])

  const finishRound = useCallback(
    (reason: string, failByHit: boolean) => {
      if (finishedRef.current) {
        return
      }

      finishedRef.current = true
      const model = modelRef.current
      model.statusText = reason
      updateScore(model)
      setRenderState(buildRenderState(model))

      if (failByHit) {
        playSfx(hitAudioRef.current, 0.62)
      }

      if (bgmAudioRef.current !== null) {
        bgmAudioRef.current.pause()
      }

      onFinish({
        score: model.score,
        durationMs: Math.max(Math.round(model.elapsedMs), Math.round(DEFAULT_FRAME_MS)),
      })
    },
    [onFinish, playSfx],
  )

  const queueHookFromScreenPoint = useCallback((clientX: number, clientY: number) => {
    const stageElement = stageRef.current
    if (stageElement === null) {
      return
    }

    const rect = stageElement.getBoundingClientRect()
    const clampedX = clampNumber(clientX - rect.left, 0, rect.width)
    const clampedY = clampNumber(clientY - rect.top, 0, rect.height)
    const viewport = stageViewportRef.current
    const localX = (clampedX - viewport.originX) / viewport.scale
    const localY = (clampedY - viewport.originY) / viewport.scale
    const model = modelRef.current
    const worldX = model.cameraX + clampNumber(localX, 0, STAGE_VIEW_WIDTH)
    const worldY = STAGE_VIEW_HEIGHT - clampNumber(localY, 0, STAGE_VIEW_HEIGHT) - GROUND_SCREEN_OFFSET

    model.hookQueued = true
    model.hookTargetX = worldX
    model.hookTargetY = worldY
  }, [])

  const queueJump = useCallback(() => {
    const model = modelRef.current
    model.jumpQueued = true
  }, [])

  const triggerActionPress = useCallback(
    (clientX?: number, clientY?: number) => {
      if (finishedRef.current) {
        return
      }

      unlockAudio()
      const model = modelRef.current

      if (model.rope.active) {
        return
      }

      const canAttemptJump = model.grounded || model.coyoteMs > 0
      if (canAttemptJump) {
        model.jumpHeld = true
        queueJump()
        return
      }

      if (typeof clientX === 'number' && typeof clientY === 'number') {
        queueHookFromScreenPoint(clientX, clientY)
      } else {
        model.hookQueued = true
      }
    },
    [queueHookFromScreenPoint, queueJump, unlockAudio],
  )

  const triggerActionRelease = useCallback(() => {
    const model = modelRef.current
    if (model.jumpHeld) {
      model.jumpHeld = false
      model.jumpCutRequested = true
    }
    if (model.rope.active) {
      model.hookQueued = true
    }
  }, [])

  useEffect(() => {
    const stageElement = stageRef.current
    if (stageElement === null) {
      return
    }

    const updateStageViewport = () => {
      const nextViewport = createStageViewport(stageElement.clientWidth, stageElement.clientHeight)
      stageViewportRef.current = nextViewport
      setStageViewport(nextViewport)
    }

    updateStageViewport()

    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateStageViewport)
    resizeObserver?.observe(stageElement)
    window.addEventListener('resize', updateStageViewport)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateStageViewport)
    }
  }, [])

  useEffect(() => {
    const hookShootAudio = new Audio(hookShootSfx)
    hookShootAudio.preload = 'auto'
    hookShootAudioRef.current = hookShootAudio

    const jumpAudio = new Audio(jumpSfx)
    jumpAudio.preload = 'auto'
    jumpAudioRef.current = jumpAudio

    const coinAudio = new Audio(coinSfx)
    coinAudio.preload = 'auto'
    coinAudioRef.current = coinAudio

    const hitAudio = new Audio(hitSfx)
    hitAudio.preload = 'auto'
    hitAudioRef.current = hitAudio

    const springAudio = new Audio(springSfx)
    springAudio.preload = 'auto'
    springAudioRef.current = springAudio

    const boostAudio = new Audio(boostSfx)
    boostAudio.preload = 'auto'
    boostAudioRef.current = boostAudio

    const iceAudio = new Audio(iceSfx)
    iceAudio.preload = 'auto'
    iceAudioRef.current = iceAudio

    const crumbleAudio = new Audio(crumbleSfx)
    crumbleAudio.preload = 'auto'
    crumbleAudioRef.current = crumbleAudio

    const fallAudio = new Audio(fallSfx)
    fallAudio.preload = 'auto'
    fallAudioRef.current = fallAudio

    const bgmAudio = new Audio(bgmLoop)
    bgmAudio.preload = 'auto'
    bgmAudio.loop = true
    bgmAudio.volume = 0.34
    bgmAudioRef.current = bgmAudio

    return () => {
      for (const audio of [hookShootAudio, jumpAudio, coinAudio, hitAudio, springAudio, boostAudio, iceAudio, crumbleAudio, fallAudio, bgmAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current) {
        return
      }

      const isActionKey =
        event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW' || event.code === 'KeyK'
      if (!isActionKey || event.repeat) {
        return
      }

      event.preventDefault()
      triggerActionPress()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const isActionKey =
        event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW' || event.code === 'KeyK'
      if (!isActionKey) {
        return
      }

      event.preventDefault()
      triggerActionRelease()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [triggerActionPress, triggerActionRelease])

  useEffect(() => {
    const model = modelRef.current
    extendWorld(model, model.cameraX + WORLD_AHEAD_PADDING)
    setRenderState(buildRenderState(model))

    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) {
        lastFrameAtRef.current = now
      }

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const currentModel = modelRef.current
      const simulationStepCount = Math.max(1, Math.ceil(deltaMs / DEFAULT_FRAME_MS))
      const simulationDeltaMs = deltaMs / simulationStepCount

      for (let simulationStep = 0; simulationStep < simulationStepCount; simulationStep += 1) {
        const deltaSec = simulationDeltaMs / 1000
        currentModel.elapsedMs += simulationDeltaMs
        const runProgress = getRunProgress(currentModel.playerX)
        const targetSpeed = lerpNumber(BASE_RUN_SPEED, MAX_RUN_SPEED, runProgress)
        currentModel.speed = Math.min(targetSpeed, currentModel.speed + RUN_ACCELERATION * deltaSec)

        if (currentModel.coyoteMs > 0) {
          currentModel.coyoteMs = Math.max(0, currentModel.coyoteMs - simulationDeltaMs)
        }
        if (currentModel.jumpBufferMs > 0) {
          currentModel.jumpBufferMs = Math.max(0, currentModel.jumpBufferMs - simulationDeltaMs)
        }

        if (currentModel.jumpQueued) {
          const didJump = performJump(currentModel)
          if (didJump) {
            playSfx(jumpAudioRef.current, 0.46)
          } else {
            currentModel.jumpBufferMs = JUMP_BUFFER_MS
          }
        }
        currentModel.jumpQueued = false

        if (currentModel.hookQueued) {
          if (currentModel.rope.active) {
            releaseHook(currentModel)
          } else {
            const didAttach = tryAttachHook(currentModel)
            if (didAttach) {
              playSfx(hookShootAudioRef.current, 0.48)
            }
          }
        }
        currentModel.hookQueued = false
        currentModel.hookTargetX = null
        currentModel.hookTargetY = null

        if (currentModel.jumpCutRequested && currentModel.playerVy > 0) {
          const timeSinceJump = currentModel.elapsedMs - currentModel.jumpStartMs
          if (timeSinceJump >= JUMP_CUT_GRACE_MS) {
            currentModel.playerVy *= JUMP_CUTOFF_MULTIPLIER
          }
        }
        currentModel.jumpCutRequested = false

        if (currentModel.rope.active) {
          if (currentModel.rope.extending) {
            currentModel.rope.currentLength = Math.min(
              currentModel.rope.currentLength + HOOK_EXTEND_SPEED * deltaSec,
              currentModel.rope.maxLength,
            )
            if (currentModel.rope.currentLength >= currentModel.rope.maxLength) {
              currentModel.rope = { ...currentModel.rope, extending: false }
            }
          }

          const activeLength = currentModel.rope.extending
            ? currentModel.rope.currentLength
            : currentModel.rope.length

          currentModel.playerVx += 60 * deltaSec
          let ropeGravity: number
          if (Math.abs(currentModel.playerVy) < APEX_THRESHOLD) {
            ropeGravity = GRAVITY_APEX
          } else if (currentModel.playerVy > 0) {
            ropeGravity = GRAVITY_UP
          } else {
            ropeGravity = GRAVITY_DOWN
          }
          currentModel.playerVy += ropeGravity * deltaSec

          currentModel.playerX += currentModel.playerVx * deltaSec
          currentModel.playerY += currentModel.playerVy * deltaSec

          const deltaX = currentModel.playerX - currentModel.rope.anchorX
          const deltaY = currentModel.playerY - currentModel.rope.anchorY
          const distance = Math.hypot(deltaX, deltaY) || 1
          const normalX = deltaX / distance
          const normalY = deltaY / distance

          if (!currentModel.rope.extending && distance > activeLength) {
            currentModel.playerX = currentModel.rope.anchorX + normalX * activeLength
            currentModel.playerY = currentModel.rope.anchorY + normalY * activeLength
          }

          if (!currentModel.rope.extending) {
            const radialVelocity = currentModel.playerVx * normalX + currentModel.playerVy * normalY
            currentModel.playerVx -= normalX * radialVelocity
            currentModel.playerVy -= normalY * radialVelocity

            let tangentX = -normalY
            let tangentY = normalX
            if (tangentX < 0) {
              tangentX *= -1
              tangentY *= -1
            }
            currentModel.playerVx += tangentX * HOOK_PULL_ACCEL * deltaSec
            currentModel.playerVy += tangentY * HOOK_PULL_ACCEL * deltaSec

            const ropeSpeed = Math.hypot(currentModel.playerVx, currentModel.playerVy)
            if (ropeSpeed > HOOK_MAX_SPEED) {
              const ropeScale = HOOK_MAX_SPEED / ropeSpeed
              currentModel.playerVx *= ropeScale
              currentModel.playerVy *= ropeScale
            }
          }

          currentModel.grounded = false
        } else {
          const previousGrounded = currentModel.grounded
          const targetGround = getGroundSegmentAtX(currentModel.groundSegments, currentModel.playerX)

          if (currentModel.grounded) {
            if (targetGround === null) {
              currentModel.grounded = false
              currentModel.coyoteMs = COYOTE_TIME_MS
            } else {
              currentModel.playerY = targetGround.y

              switch (targetGround.gimmick) {
                case 'crumble':
                  targetGround.crumbleTimer += simulationDeltaMs
                  if (!targetGround.crumbleActive && targetGround.crumbleTimer >= CRUMBLE_DELAY_MS) {
                    targetGround.crumbleActive = true
                    currentModel.grounded = false
                    currentModel.coyoteMs = 0
                    playSfx(crumbleAudioRef.current, 0.5)
                  }
                  break
                case 'spring':
                  currentModel.playerVy = SPRING_BOOST
                  currentModel.grounded = false
                  currentModel.coyoteMs = 0
                  pushBurst(currentModel, 'spark', currentModel.playerX, currentModel.playerY)
                  playSfx(springAudioRef.current, 0.5)
                  break
                case 'ice':
                  currentModel.playerVx = Math.max(currentModel.playerVx * ICE_DRAG, currentModel.speed * 0.6)
                  break
                case 'conveyor':
                  currentModel.playerVx += CONVEYOR_SPEED * deltaSec
                  break
                case 'moving': {
                  const phase = (currentModel.elapsedMs % MOVING_PERIOD_MS) / MOVING_PERIOD_MS
                  const movingY = targetGround.y + Math.sin(phase * Math.PI * 2) * MOVING_AMPLITUDE
                  currentModel.playerY = movingY
                  break
                }
                case 'boost':
                  if (currentModel.playerVx < currentModel.speed + BOOST_SPEED_BONUS) {
                    playSfx(boostAudioRef.current, 0.45)
                  }
                  currentModel.playerVx = Math.max(currentModel.playerVx, currentModel.speed + BOOST_SPEED_BONUS)
                  break
                case 'gravity':
                  currentModel.playerVy = GRAVITY_FLIP_BOOST
                  currentModel.grounded = false
                  currentModel.coyoteMs = 0
                  pushBurst(currentModel, 'spark', currentModel.playerX, currentModel.playerY)
                  break
                case 'vanish': {
                  const vanishCycle = VANISH_ON_MS + VANISH_OFF_MS
                  const vanishPhase = currentModel.elapsedMs % vanishCycle
                  if (vanishPhase >= VANISH_ON_MS) {
                    currentModel.grounded = false
                    currentModel.coyoteMs = 0
                  }
                  break
                }
                case 'trampoline':
                  currentModel.playerVy = TRAMPOLINE_BOUNCE
                  currentModel.grounded = false
                  currentModel.coyoteMs = COYOTE_TIME_MS
                  break
                default:
                  break
              }

              if (currentModel.grounded) {
                currentModel.playerVx = Math.max(currentModel.playerVx, currentModel.speed)
              }
            }
          }

          if (!currentModel.grounded) {
            let gravity: number
            if (Math.abs(currentModel.playerVy) < APEX_THRESHOLD) {
              gravity = GRAVITY_APEX
            } else if (currentModel.playerVy > 0) {
              gravity = GRAVITY_UP
            } else {
              gravity = GRAVITY_DOWN
            }
            currentModel.playerVy += gravity * deltaSec
            const frameDrag = Math.pow(AIR_DRAG, simulationDeltaMs / DEFAULT_FRAME_MS)
            currentModel.playerVx = Math.max(currentModel.playerVx * frameDrag, Math.max(currentModel.speed * 0.85, HOOK_MIN_SPEED_FLOOR))
          }

          const prevY = currentModel.playerY
          currentModel.playerX += currentModel.playerVx * deltaSec
          currentModel.playerY += currentModel.playerVy * deltaSec

          let landingGround = getGroundSegmentAtX(currentModel.groundSegments, currentModel.playerX)
          if (landingGround !== null && landingGround.gimmick === 'vanish') {
            const vanishCycle = VANISH_ON_MS + VANISH_OFF_MS
            const vanishPhase = currentModel.elapsedMs % vanishCycle
            if (vanishPhase >= VANISH_ON_MS) {
              landingGround = null
            }
          }
          let landingY = landingGround !== null ? landingGround.y : 0
          if (landingGround !== null && landingGround.gimmick === 'moving') {
            const landPhase = (currentModel.elapsedMs % MOVING_PERIOD_MS) / MOVING_PERIOD_MS
            landingY = landingGround.y + Math.sin(landPhase * Math.PI * 2) * MOVING_AMPLITUDE
          }
          const wasAbove = prevY >= landingY
          if (landingGround !== null && wasAbove && currentModel.playerY <= landingY && currentModel.playerVy <= 0) {
            currentModel.playerY = landingY
            currentModel.playerVy = 0
            currentModel.grounded = true
            currentModel.doubleJumpAvailable = true
            currentModel.coyoteMs = COYOTE_TIME_MS
            if (!previousGrounded) {
              currentModel.comboChain = 0
              currentModel.statusText = 'Landed! Jump/Hook again!'
            }

            if (currentModel.jumpBufferMs > 0) {
              const didBufferedJump = performJump(currentModel)
              if (didBufferedJump) {
                playSfx(jumpAudioRef.current, 0.46)
              }
            }
          } else {
            if (previousGrounded) {
              currentModel.coyoteMs = COYOTE_TIME_MS
            }
            currentModel.grounded = false
          }
        }

        if (
          currentModel.elapsedMs - currentModel.lastTrailSpawnMs >= TRAIL_INTERVAL_MS &&
          Math.abs(currentModel.playerVx) > 290
        ) {
          currentModel.lastTrailSpawnMs = currentModel.elapsedMs
          pushBurst(currentModel, 'smoke', currentModel.playerX - 18, currentModel.playerY + 8)
        }

        const isMagnetActive = currentModel.elapsedMs < currentModel.magnetActiveUntil
        const collectRadius = isMagnetActive ? PLAYER_COLLIDER_RADIUS + 80 : PLAYER_COLLIDER_RADIUS
        let didCollectCoin = false
        currentModel.coins = currentModel.coins.filter((coin) => {
          const isHit = collideCircles(
            currentModel.playerX,
            currentModel.playerY + 14,
            collectRadius,
            coin.x,
            coin.y,
            COIN_RADIUS,
          )

          if (isHit) {
            currentModel.coinsCollected += 1
            pushBurst(currentModel, 'spark', coin.x, coin.y)
            didCollectCoin = true
            if (currentModel.coinsCollected % 8 === 0) {
              const powerRoll = Math.random()
              if (powerRoll < 0.4) {
                currentModel.magnetActiveUntil = currentModel.elapsedMs + 5000
              } else if (powerRoll < 0.7) {
                currentModel.shieldActiveUntil = currentModel.elapsedMs + 6000
              } else {
                currentModel.doubleJumpAvailable = true
              }
            }
            return false
          }

          return true
        })

        if (didCollectCoin) {
          playSfx(coinAudioRef.current, 0.55)
        }

        const isObstacleHit = currentModel.obstacles.some((obstacle) => {
          let obsX = obstacle.x
          if (obstacle.kind === 'swinger') {
            const swingPhase = (currentModel.elapsedMs % 1600) / 1600
            obsX = obstacle.x + Math.sin(swingPhase * Math.PI * 2) * 40
          }
          if (obstacle.kind === 'wall' || obstacle.kind === 'laser') {
            const dx = Math.abs(currentModel.playerX - obsX)
            const dy = Math.abs((currentModel.playerY + 10) - obstacle.y)
            return dx < (obstacle.width * 0.5 + PLAYER_COLLIDER_RADIUS) &&
                   dy < (obstacle.height * 0.5 + PLAYER_COLLIDER_RADIUS)
          }
          return collideCircles(
            currentModel.playerX,
            currentModel.playerY + 10,
            PLAYER_COLLIDER_RADIUS,
            obsX,
            obstacle.y,
            obstacle.radius,
          )
        })

        if (isObstacleHit) {
          if (currentModel.elapsedMs < currentModel.shieldActiveUntil) {
            currentModel.shieldActiveUntil = 0
            pushBurst(currentModel, 'spark', currentModel.playerX, currentModel.playerY + 20)
          } else {
            finishRound('Obstacle hit!', true)
            animationFrameRef.current = null
            return
          }
        }

        if (currentModel.playerY < -GROUND_SCREEN_OFFSET - PLAYER_HEIGHT) {
          playSfx(fallAudioRef.current, 0.6)
          finishRound('Fell off the platform!', true)
          animationFrameRef.current = null
          return
        }

        currentModel.cameraX = Math.max(0, currentModel.playerX - CAMERA_LEAD_X)
        extendWorld(currentModel, currentModel.cameraX + WORLD_AHEAD_PADDING)
        trimWorld(currentModel)
        updateScore(currentModel)
      }
      setRenderState(buildRenderState(currentModel))

      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      lastFrameAtRef.current = null
    }
  }, [finishRound, playSfx])

  const handleStagePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      triggerActionPress(event.clientX, event.clientY)
    },
    [triggerActionPress],
  )

  const handleStagePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      triggerActionRelease()
    },
    [triggerActionRelease],
  )

  const handleStagePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      triggerActionRelease()
    },
    [triggerActionRelease],
  )

  const viewportScale = stageViewport.scale
  const playerRenderWidth = PLAYER_WIDTH * viewportScale
  const playerRenderHeight = PLAYER_HEIGHT * viewportScale
  const anchorRenderSize = ANCHOR_RADIUS * 2.4 * viewportScale
  const obstacleRenderSize = OBSTACLE_SIZE * viewportScale
  const coinRenderSize = COIN_SIZE * viewportScale
  const fxRenderSize = 56 * viewportScale
  const groundRenderHeight = 22 * viewportScale

  const playerScreen = useMemo(() => {
    const point = worldToScreen(renderState.playerX, renderState.playerY, renderState.cameraX, stageViewport)
    return {
      left: point.x - playerRenderWidth * 0.5,
      top: point.y - playerRenderHeight + PLAYER_FEET_OFFSET * viewportScale,
    }
  }, [playerRenderHeight, playerRenderWidth, renderState.cameraX, renderState.playerX, renderState.playerY, stageViewport, viewportScale])

  const displayedBestScore = Math.max(bestScore, renderState.score)

  return (
    <section className="mini-game-panel gogunbuntu-panel" aria-label="gogunbuntu-game">
      <div
        className="gogunbuntu-stage"
        ref={stageRef}
        onPointerDown={handleStagePointerDown}
        onPointerUp={handleStagePointerUp}
        onPointerCancel={handleStagePointerCancel}
        role="presentation"
      >
        <div className="gogunbuntu-bg-sky" />
        <div
          className="gogunbuntu-bg-layer depth-1"
          style={{
            backgroundImage: `url(${gogunbuntuBg})`,
            backgroundPositionX: `${-renderState.cameraX * 0.06 * viewportScale}px`,
          }}
        />
        <div
          className="gogunbuntu-bg-layer depth-2"
          style={{
            backgroundImage: `url(${gogunbuntuBg})`,
            backgroundPositionX: `${-renderState.cameraX * 0.15 * viewportScale}px`,
          }}
        />
        <div
          className="gogunbuntu-bg-layer depth-3"
          style={{
            backgroundImage: `url(${gogunbuntuBg})`,
            backgroundPositionX: `${-renderState.cameraX * 0.3 * viewportScale}px`,
          }}
        />
        <div className="gogunbuntu-bg-particles" />
        <div
          className="gogunbuntu-bg-ground-streak"
          style={{
            backgroundPositionX: `${-renderState.cameraX * 0.85 * viewportScale}px`,
          }}
        />

        <svg className="gogunbuntu-rope-overlay" viewBox={`0 0 ${stageViewport.width} ${stageViewport.height}`} aria-hidden>
          {renderState.rope.active ? (() => {
            const playerPt = worldToScreen(renderState.playerX, renderState.playerY + 20, renderState.cameraX, stageViewport)
            const anchorPt = worldToScreen(renderState.rope.anchorX, renderState.rope.anchorY, renderState.cameraX, stageViewport)
            let endX = anchorPt.x
            let endY = anchorPt.y
            if (renderState.rope.extending && renderState.rope.maxLength > 0) {
              const progress = renderState.rope.currentLength / renderState.rope.maxLength
              endX = lerpNumber(playerPt.x, anchorPt.x, progress)
              endY = lerpNumber(playerPt.y, anchorPt.y, progress)
            }
            return (
              <line
                x1={playerPt.x}
                y1={playerPt.y}
                x2={endX}
                y2={endY}
                className="gogunbuntu-rope-line"
                style={{
                  strokeWidth: clampNumber(viewportScale * 3.8, 2.2, 6.6),
                }}
              />
            )
          })() : null}
        </svg>

        {renderState.groundSegments.map((segment) => {
          let segmentY = segment.y
          if (segment.gimmick === 'moving') {
            const phase = (renderState.elapsedMs % MOVING_PERIOD_MS) / MOVING_PERIOD_MS
            segmentY = segment.y + Math.sin(phase * Math.PI * 2) * MOVING_AMPLITUDE
          }
          const topLeft = worldToScreen(segment.startX, segmentY, renderState.cameraX, stageViewport)
          const width = (segment.endX - segment.startX) * viewportScale
          const gimmickClass = segment.gimmick !== 'normal' ? ` gimmick-${segment.gimmick}` : ''
          const crumbledClass = segment.crumbleActive ? ' crumbled' : ''
          let vanishHidden = ''
          if (segment.gimmick === 'vanish') {
            const vanishCycle = VANISH_ON_MS + VANISH_OFF_MS
            const vanishPhase = renderState.elapsedMs % vanishCycle
            vanishHidden = vanishPhase >= VANISH_ON_MS ? ' vanish-off' : ' vanish-on'
          }
          return (
            <div
              className={`gogunbuntu-ground-segment${gimmickClass}${crumbledClass}${vanishHidden}`}
              key={segment.id}
              style={{
                left: topLeft.x,
                top: topLeft.y,
                width,
                height: groundRenderHeight,
              }}
            />
          )
        })}

        {renderState.anchors.map((anchor) => {
          const point = worldToScreen(anchor.x, anchor.y, renderState.cameraX, stageViewport)
          return (
            <img
              className="gogunbuntu-anchor"
              key={anchor.id}
              src={gogunbuntuAnchor}
              alt="anchor"
              style={{
                left: point.x - anchorRenderSize * 0.5,
                top: point.y - anchorRenderSize * 0.5,
                width: anchorRenderSize,
                height: anchorRenderSize,
              }}
            />
          )
        })}

        {renderState.obstacles.map((obstacle) => {
          let obsRenderX = obstacle.x
          if (obstacle.kind === 'swinger') {
            const swingPhase = (renderState.elapsedMs % 1600) / 1600
            obsRenderX = obstacle.x + Math.sin(swingPhase * Math.PI * 2) * 40
          }
          const point = worldToScreen(obsRenderX, obstacle.y, renderState.cameraX, stageViewport)
          const obsW = obstacle.width * viewportScale
          const obsH = obstacle.height * viewportScale

          if (obstacle.kind === 'laser') {
            return (
              <div
                className="gogunbuntu-obstacle-laser"
                key={obstacle.id}
                style={{
                  left: point.x - obsW * 0.5,
                  top: point.y - obsH * 0.5,
                  width: obsW,
                  height: obsH,
                }}
              />
            )
          }

          if (obstacle.kind === 'wall') {
            return (
              <div
                className="gogunbuntu-obstacle-wall"
                key={obstacle.id}
                style={{
                  left: point.x - obsW * 0.5,
                  top: point.y - obsH * 0.5,
                  width: obsW,
                  height: obsH,
                }}
              />
            )
          }

          return (
            <img
              className={`gogunbuntu-obstacle${obstacle.kind === 'swinger' ? ' swinger' : ''}`}
              key={obstacle.id}
              src={gogunbuntuObstacle}
              alt="obstacle"
              style={{
                left: point.x - obstacleRenderSize * 0.5,
                top: point.y - obstacleRenderSize * 0.5,
                width: obstacleRenderSize,
                height: obstacleRenderSize,
              }}
            />
          )
        })}

        {renderState.coins.map((coin) => {
          const point = worldToScreen(coin.x, coin.y, renderState.cameraX, stageViewport)
          return (
            <img
              className="gogunbuntu-coin"
              key={coin.id}
              src={gogunbuntuCoin}
              alt="coin"
              style={{
                left: point.x - coinRenderSize * 0.5,
                top: point.y - coinRenderSize * 0.5,
                width: coinRenderSize,
                height: coinRenderSize,
              }}
            />
          )
        })}

        {renderState.bursts.map((burst) => {
          const point = worldToScreen(burst.x, burst.y, renderState.cameraX, stageViewport)
          const progress = clampNumber((renderState.elapsedMs - burst.createdAtMs) / burst.lifetimeMs, 0, 1)
          return (
            <div
              className={`gogunbuntu-fx ${burst.kind}`}
              key={burst.id}
              style={{
                left: point.x - fxRenderSize * 0.5,
                top: point.y - fxRenderSize * 0.5,
                width: fxRenderSize,
                height: fxRenderSize,
                opacity: 1 - progress,
                backgroundImage: `url(${burst.kind === 'spark' ? gogunbuntuSparkSheet : gogunbuntuSmokeSheet})`,
              }}
            />
          )
        })}

        <img
          className={`gogunbuntu-player${renderState.grounded ? ' running' : renderState.rope.active ? ' hooking' : ' airborne'}`}
          src={selectedPlayerSkin.imageSrc}
          alt={`${selectedPlayerSkin.name} runner`}
          style={{
            left: playerScreen.left,
            top: playerScreen.top,
            width: playerRenderWidth,
            height: playerRenderHeight,
            transform: `${selectedPlayerSkin.flipX ? 'scaleX(-1) ' : ''}rotate(${clampNumber(
              renderState.rope.active
                ? Math.atan2(selectedPlayerSkin.flipX ? renderState.playerVy : -renderState.playerVy, renderState.playerVx) * (180 / Math.PI) * 0.35
                : renderState.grounded
                  ? 0
                  : renderState.playerVy * (selectedPlayerSkin.flipX ? 0.005 : -0.005),
              -20, 20,
            ).toFixed(1)}deg)`,
          }}
        />

        <div className="gogunbuntu-hud">
          <p className="gogunbuntu-score">{renderState.score.toLocaleString()}</p>
          <p className="gogunbuntu-best">BEST {displayedBestScore.toLocaleString()}</p>
          <p className="gogunbuntu-meta">
            {Math.round(renderState.playerVx * 0.36)} km/h · Coins {renderState.coinsCollected} · Chain x{Math.max(1, renderState.comboChain)}
          </p>
        </div>

        <div className="gogunbuntu-stage-actions">
          <button
            className="gogunbuntu-stage-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => finishRound('Round FINISH', false)}
          >
            FINISH
          </button>
          <button
            className="gogunbuntu-stage-button ghost"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            EXIT
          </button>
        </div>
      </div>
    </section>
  )
}

export const gogunbuntuModule: MiniGameModule = {
  manifest: {
    id: 'gogunbuntu',
    title: 'Gogunbuntu',
    description: 'Action runner: jump and swing past obstacles for max score',
    unlockCost: 0,
    baseReward: 24,
    scoreRewardMultiplier: 0.95,
    accentColor: '#0ea5e9',
  },
  Component: GogunbuntuGame,
}
