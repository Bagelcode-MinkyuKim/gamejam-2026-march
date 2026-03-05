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
import bgmLoop from '../../../assets/sounds/gogunbuntu/gogunbuntu-bgm-loop.mp3'

const STAGE_VIEW_WIDTH = 360
const STAGE_VIEW_HEIGHT = 560
const GROUND_SCREEN_OFFSET = 86

const PLAYER_WIDTH = 86
const PLAYER_HEIGHT = 86
const PLAYER_FEET_OFFSET = 16
const PLAYER_COLLIDER_RADIUS = 17
const PLAYER_START_X = 60
const PLAYER_START_Y = 20

const BASE_RUN_SPEED = 188
const MAX_RUN_SPEED = 436
const RUN_ACCELERATION = 84
const AIR_DRAG = 0.9992

const GRAVITY = -2250
const JUMP_VELOCITY = 968
const JUMP_CUTOFF_MULTIPLIER = 0.4
const COYOTE_TIME_MS = 134
const JUMP_BUFFER_MS = 150

const HOOK_RANGE = 332
const HOOK_MIN_LENGTH = 72
const HOOK_RELEASE_BOOST = 228
const HOOK_PULL_ACCEL = 586
const CHAIN_COMBO_WINDOW_MS = 2050

const MIN_SEGMENT_LENGTH = 220
const MAX_SEGMENT_LENGTH = 420
const MIN_GAP_LENGTH = 90
const MAX_GAP_LENGTH = 248
const GROUND_MIN_HEIGHT = 0
const GROUND_MAX_HEIGHT = 128

const ANCHOR_MIN_HEIGHT = 146
const ANCHOR_MAX_HEIGHT = 292
const ANCHOR_RADIUS = 20

const OBSTACLE_MIN_HEIGHT = 80
const OBSTACLE_MAX_HEIGHT = 230
const OBSTACLE_SIZE = 58
const OBSTACLE_COLLIDER_RADIUS = 20

const COIN_RADIUS = 16
const COIN_SIZE = 36

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
    name: '김연자',
    imageSrc: kimYeonjaDotCharacter,
  },
  {
    name: '박상민',
    imageSrc: parkSangminDotCharacter,
  },
] as const

type EffectKind = 'spark' | 'smoke'

interface GroundSegment {
  readonly id: number
  readonly startX: number
  readonly endX: number
  readonly y: number
}

interface AnchorPoint {
  readonly id: number
  readonly x: number
  readonly y: number
}

interface Obstacle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly radius: number
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

interface RopeState {
  readonly active: boolean
  readonly anchorX: number
  readonly anchorY: number
  readonly length: number
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
    if (x >= segment.startX && x <= segment.endX) {
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
    { id: 0, startX: -240, endX: 420, y: 0 },
    { id: 1, startX: 500, endX: 880, y: 12 },
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
    hookQueued: false,
    hookTargetX: null,
    hookTargetY: null,
    rope: {
      active: false,
      anchorX: 0,
      anchorY: 0,
      length: 0,
    },
    statusText: '점프와 훅으로 지형을 돌파하세요.',
    nextGroundId: 2,
    nextAnchorId: 0,
    nextObstacleId: 0,
    nextCoinId: 0,
    nextFxId: 0,
    lastTrailSpawnMs: 0,
    lastGeneratedX: 880,
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

function extendWorld(model: WorldModel, minAheadX: number): void {
  while (model.lastGeneratedX < minAheadX) {
    const previous = model.groundSegments[model.groundSegments.length - 1]
    const segmentIndex = model.nextGroundId
    const runProgress = getRunProgress(model.playerX)
    const segmentLength = randomBetween(
      MIN_SEGMENT_LENGTH + 16 * (1 - runProgress),
      MAX_SEGMENT_LENGTH - 44 * runProgress,
    )

    const adaptiveGapMin = MIN_GAP_LENGTH * lerpNumber(0.56, 1.02, runProgress)
    const adaptiveGapMax = MAX_GAP_LENGTH * lerpNumber(0.52, 0.96, runProgress)
    const gapLength = randomBetween(adaptiveGapMin, adaptiveGapMax)

    const nextStartX = previous.endX + gapLength
    const nextEndX = nextStartX + segmentLength
    const fallVariance = lerpNumber(18, 36, runProgress)
    const climbVariance = lerpNumber(34, 56, runProgress)
    const nextY = clampNumber(previous.y + randomBetween(-fallVariance, climbVariance), GROUND_MIN_HEIGHT, GROUND_MAX_HEIGHT)

    const nextSegment: GroundSegment = {
      id: segmentIndex,
      startX: nextStartX,
      endX: nextEndX,
      y: nextY,
    }

    model.groundSegments = [...model.groundSegments, nextSegment]
    model.nextGroundId += 1
    model.lastGeneratedX = nextEndX

    const gapCenterX = previous.endX + gapLength * 0.5 + randomBetween(-18, 18)
    const earlyAnchorLowering = lerpNumber(32, 0, runProgress)
    const anchorY =
      Math.max(previous.y, nextY) +
      randomBetween(ANCHOR_MIN_HEIGHT - earlyAnchorLowering, ANCHOR_MAX_HEIGHT - earlyAnchorLowering * 0.36)
    model.anchors = [
      ...model.anchors,
      {
        id: model.nextAnchorId,
        x: gapCenterX,
        y: anchorY,
      },
    ]
    model.nextAnchorId += 1

    const obstacleChance = lerpNumber(0.12, 0.56, runProgress)
    if (Math.random() < obstacleChance) {
      const obstacleX = nextStartX + randomBetween(72, Math.max(108, nextEndX - nextStartX - 78))
      const obstacleY = nextY + randomBetween(OBSTACLE_MIN_HEIGHT, OBSTACLE_MAX_HEIGHT)
      model.obstacles = [
        ...model.obstacles,
        {
          id: model.nextObstacleId,
          x: obstacleX,
          y: obstacleY,
          radius: OBSTACLE_COLLIDER_RADIUS,
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
      model.coins = [
        ...model.coins,
        {
          id: model.nextCoinId,
          x: gapCenterX,
          y: anchorY - randomBetween(30, 70),
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
    return false
  }

  model.playerVy = JUMP_VELOCITY
  model.grounded = false
  model.coyoteMs = 0
  model.jumpBufferMs = 0
  model.statusText = '점프!'
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
    model.statusText = '훅 실패! 닿는 앵커가 없습니다.'
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
  }

  const withinComboWindow = model.elapsedMs - model.lastHookAttachAtMs <= CHAIN_COMBO_WINDOW_MS
  model.comboChain = withinComboWindow ? model.comboChain + 1 : 1
  model.bestComboChain = Math.max(model.bestComboChain, model.comboChain)
  model.lastHookAttachAtMs = model.elapsedMs
  if (model.comboChain >= 2) {
    const comboAttachBonus = (model.comboChain - 1) * 6
    model.trickPoints += comboAttachBonus
    model.statusText = `훅 체인 x${model.comboChain} +${comboAttachBonus}`
  } else {
    model.statusText = '훅 부착!'
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
  const comboReleaseBonus = Math.max(0, model.comboChain - 1) * 5
  if (releaseSpeed >= 580) {
    const releaseBonus = SCORE_TRICK_BONUS + comboReleaseBonus
    model.trickPoints += releaseBonus
    model.statusText = `릴리즈 보너스 +${releaseBonus}`
  } else {
    model.statusText = '릴리즈!'
  }

  model.rope = {
    active: false,
    anchorX: 0,
    anchorY: 0,
    length: 0,
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

    const bgmAudio = new Audio(bgmLoop)
    bgmAudio.preload = 'auto'
    bgmAudio.loop = true
    bgmAudio.volume = 0.34
    bgmAudioRef.current = bgmAudio

    return () => {
      for (const audio of [hookShootAudio, jumpAudio, coinAudio, hitAudio, bgmAudio]) {
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

      if (event.code === 'Space' || event.code === 'KeyK') {
        event.preventDefault()
        unlockAudio()
        const model = modelRef.current
        model.hookQueued = true
        return
      }

      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault()
        unlockAudio()
        const model = modelRef.current
        model.jumpHeld = true
        model.jumpQueued = true
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        const model = modelRef.current
        model.jumpHeld = false
        model.jumpCutRequested = true
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [unlockAudio])

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
      const deltaSec = deltaMs / 1000
      const currentModel = modelRef.current

      currentModel.elapsedMs += deltaMs
      const runProgress = getRunProgress(currentModel.playerX)
      const targetSpeed = lerpNumber(BASE_RUN_SPEED, MAX_RUN_SPEED, runProgress)
      currentModel.speed = Math.min(targetSpeed, currentModel.speed + RUN_ACCELERATION * deltaSec)

      if (currentModel.coyoteMs > 0) {
        currentModel.coyoteMs = Math.max(0, currentModel.coyoteMs - deltaMs)
      }
      if (currentModel.jumpBufferMs > 0) {
        currentModel.jumpBufferMs = Math.max(0, currentModel.jumpBufferMs - deltaMs)
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
        currentModel.playerVy *= JUMP_CUTOFF_MULTIPLIER
      }
      currentModel.jumpCutRequested = false

      if (currentModel.rope.active) {
        currentModel.playerVx += 60 * deltaSec
        currentModel.playerVy += GRAVITY * deltaSec

        currentModel.playerX += currentModel.playerVx * deltaSec
        currentModel.playerY += currentModel.playerVy * deltaSec

        const deltaX = currentModel.playerX - currentModel.rope.anchorX
        const deltaY = currentModel.playerY - currentModel.rope.anchorY
        const distance = Math.hypot(deltaX, deltaY) || 1
        const normalX = deltaX / distance
        const normalY = deltaY / distance

        currentModel.playerX = currentModel.rope.anchorX + normalX * currentModel.rope.length
        currentModel.playerY = currentModel.rope.anchorY + normalY * currentModel.rope.length

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

        currentModel.grounded = false
      } else {
        const previousGrounded = currentModel.grounded
        const targetGround = getGroundSegmentAtX(currentModel.groundSegments, currentModel.playerX)

        if (currentModel.grounded) {
          currentModel.playerVx = Math.max(currentModel.playerVx, currentModel.speed)
          if (targetGround === null) {
            currentModel.grounded = false
            currentModel.coyoteMs = COYOTE_TIME_MS
          }
        }

        if (!currentModel.grounded) {
          currentModel.playerVy += GRAVITY * deltaSec
          currentModel.playerVx = Math.max(currentModel.playerVx * AIR_DRAG, currentModel.speed * 0.72)
        }

        currentModel.playerX += currentModel.playerVx * deltaSec
        currentModel.playerY += currentModel.playerVy * deltaSec

        const landingGround = getGroundSegmentAtX(currentModel.groundSegments, currentModel.playerX)
        if (landingGround !== null && currentModel.playerY <= landingGround.y && currentModel.playerVy <= 0) {
          currentModel.playerY = landingGround.y
          currentModel.playerVy = 0
          currentModel.grounded = true
          currentModel.coyoteMs = COYOTE_TIME_MS
          if (!previousGrounded) {
            currentModel.comboChain = 0
            currentModel.statusText = '착지 성공. 다시 점프/훅!'
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

      if (currentModel.elapsedMs - currentModel.lastTrailSpawnMs >= TRAIL_INTERVAL_MS && Math.abs(currentModel.playerVx) > 290) {
        currentModel.lastTrailSpawnMs = currentModel.elapsedMs
        pushBurst(currentModel, 'smoke', currentModel.playerX - 18, currentModel.playerY + 8)
      }

      let didCollectCoin = false
      currentModel.coins = currentModel.coins.filter((coin) => {
        const isHit = collideCircles(
          currentModel.playerX,
          currentModel.playerY + 14,
          PLAYER_COLLIDER_RADIUS,
          coin.x,
          coin.y,
          COIN_RADIUS,
        )

        if (isHit) {
          currentModel.coinsCollected += 1
          currentModel.statusText = `코인 획득 +${SCORE_COIN_BONUS}`
          pushBurst(currentModel, 'spark', coin.x, coin.y)
          didCollectCoin = true
          return false
        }

        return true
      })

      if (didCollectCoin) {
        playSfx(coinAudioRef.current, 0.55)
      }

      const isObstacleHit = currentModel.obstacles.some((obstacle) => {
        return collideCircles(
          currentModel.playerX,
          currentModel.playerY + 10,
          PLAYER_COLLIDER_RADIUS,
          obstacle.x,
          obstacle.y,
          obstacle.radius,
        )
      })

      if (isObstacleHit) {
        finishRound('장애물 충돌!', true)
        animationFrameRef.current = null
        return
      }

      if (currentModel.playerY < -280) {
        finishRound('추락했습니다.', true)
        animationFrameRef.current = null
        return
      }

      currentModel.cameraX = Math.max(0, currentModel.playerX - CAMERA_LEAD_X)
      extendWorld(currentModel, currentModel.cameraX + WORLD_AHEAD_PADDING)
      trimWorld(currentModel)
      updateScore(currentModel)
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
      if (finishedRef.current) {
        return
      }

      unlockAudio()
      queueHookFromScreenPoint(event.clientX, event.clientY)
    },
    [queueHookFromScreenPoint, unlockAudio],
  )

  const handleJumpButton = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    unlockAudio()
    const model = modelRef.current
    model.jumpHeld = true
    queueJump()
  }, [queueJump, unlockAudio])

  const handleJumpButtonRelease = useCallback(() => {
    const model = modelRef.current
    model.jumpHeld = false
    model.jumpCutRequested = true
  }, [])

  const handleHookButton = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    unlockAudio()
    const model = modelRef.current
    model.hookQueued = true
  }, [unlockAudio])

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
  const playerRotation = clampNumber(renderState.playerVy * 0.023, -32, 28)

  return (
    <section className="mini-game-panel gogunbuntu-panel" aria-label="gogunbuntu-game">
      <div className="gogunbuntu-stage" ref={stageRef} onPointerDown={handleStagePointerDown} role="presentation">
        <div
          className="gogunbuntu-bg-layer far"
          style={{
            backgroundImage: `url(${gogunbuntuBg})`,
            backgroundPositionX: `${-renderState.cameraX * 0.16 * viewportScale}px`,
          }}
        />
        <div
          className="gogunbuntu-bg-layer near"
          style={{
            backgroundImage: `url(${gogunbuntuBg})`,
            backgroundPositionX: `${-renderState.cameraX * 0.34 * viewportScale}px`,
          }}
        />

        <svg className="gogunbuntu-rope-overlay" viewBox={`0 0 ${stageViewport.width} ${stageViewport.height}`} aria-hidden>
          {renderState.rope.active ? (
            <line
              x1={worldToScreen(renderState.playerX, renderState.playerY + 20, renderState.cameraX, stageViewport).x}
              y1={worldToScreen(renderState.playerX, renderState.playerY + 20, renderState.cameraX, stageViewport).y}
              x2={worldToScreen(renderState.rope.anchorX, renderState.rope.anchorY, renderState.cameraX, stageViewport).x}
              y2={worldToScreen(renderState.rope.anchorX, renderState.rope.anchorY, renderState.cameraX, stageViewport).y}
              className="gogunbuntu-rope-line"
              style={{
                strokeWidth: clampNumber(viewportScale * 3.8, 2.2, 6.6),
              }}
            />
          ) : null}
        </svg>

        {renderState.groundSegments.map((segment) => {
          const left = stageViewport.originX + (segment.startX - renderState.cameraX) * viewportScale
          const width = (segment.endX - segment.startX) * viewportScale
          const bottom = stageViewport.originY + (GROUND_SCREEN_OFFSET + segment.y - 8) * viewportScale
          return (
            <div
              className="gogunbuntu-ground-segment"
              key={segment.id}
              style={{
                left,
                width,
                bottom,
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
          const point = worldToScreen(obstacle.x, obstacle.y, renderState.cameraX, stageViewport)
          return (
            <img
              className="gogunbuntu-obstacle"
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
          className="gogunbuntu-player"
          src={selectedPlayerSkin.imageSrc}
          alt={`${selectedPlayerSkin.name} runner`}
          style={{
            left: playerScreen.left,
            top: playerScreen.top,
            width: playerRenderWidth,
            height: playerRenderHeight,
            transform: `rotate(${playerRotation.toFixed(2)}deg)`,
          }}
        />

        <div className="gogunbuntu-hud">
          <p className="gogunbuntu-score">{renderState.score.toLocaleString()}</p>
          <p className="gogunbuntu-best">BEST {displayedBestScore.toLocaleString()}</p>
          <p className="gogunbuntu-meta">캐릭터 {selectedPlayerSkin.name}</p>
          <p className="gogunbuntu-meta">
            속도 {Math.round(renderState.speed)} · 코인 {renderState.coinsCollected} · 체인 x{Math.max(1, renderState.comboChain)}
          </p>
        </div>

        <p className="gogunbuntu-status">{renderState.statusText}</p>
        <p className="gogunbuntu-hint">훅: 터치/Space/K · 점프: W/↑</p>

        <div className="gogunbuntu-controls">
          <button
            className="gogunbuntu-control-button hook"
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation()
              handleHookButton()
            }}
          >
            훅
          </button>
          <button
            className="gogunbuntu-control-button jump"
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation()
              handleJumpButton()
            }}
            onPointerUp={(event) => {
              event.stopPropagation()
              handleJumpButtonRelease()
            }}
            onPointerCancel={(event) => {
              event.stopPropagation()
              handleJumpButtonRelease()
            }}
          >
            점프
          </button>
        </div>

        <div className="gogunbuntu-stage-actions">
          <button
            className="gogunbuntu-stage-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => finishRound('라운드 종료', false)}
          >
            종료
          </button>
          <button
            className="gogunbuntu-stage-button ghost"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            나가기
          </button>
        </div>
      </div>
    </section>
  )
}

export const gogunbuntuModule: MiniGameModule = {
  manifest: {
    id: 'gogunbuntu',
    title: '고군분투',
    description: '점프와 훅 스윙으로 지형을 넘고 장애물을 피하며 최대 점수를 노리는 액션 러너',
    unlockCost: 0,
    baseReward: 24,
    scoreRewardMultiplier: 0.95,
    accentColor: '#0ea5e9',
  },
  Component: GogunbuntuGame,
}
