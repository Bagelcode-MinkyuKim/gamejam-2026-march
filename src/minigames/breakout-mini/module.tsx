import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import brickHitSfx from '../../../assets/sounds/breakout-brick-hit.mp3'
import paddleHitSfx from '../../../assets/sounds/breakout-paddle-hit.mp3'
import wallHitSfx from '../../../assets/sounds/breakout-wall-hit.mp3'
import powerupSfx from '../../../assets/sounds/breakout-powerup.mp3'
import comboSfx from '../../../assets/sounds/breakout-combo.mp3'
import stageClearSfx from '../../../assets/sounds/breakout-stage-clear.mp3'
import ballLostSfx from '../../../assets/sounds/breakout-ball-lost.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Layout: 9:16 full vertical ────────────────────────────
const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 640

// ─── Paddle ─────────────────────────────────────────────────
const PADDLE_WIDTH = 72
const PADDLE_HEIGHT = 12
const PADDLE_Y = VIEWBOX_HEIGHT - 50
const PADDLE_CORNER_RADIUS = 6
const PADDLE_WIDE_WIDTH = 110
const PADDLE_WIDE_DURATION_MS = 8000

// ─── Ball ───────────────────────────────────────────────────
const BALL_RADIUS = 7
const BALL_INITIAL_SPEED = 240
const BALL_SPEED_INCREMENT = 15
const BALL_MAX_SPEED = 480
const BALL_MIN_VY_RATIO = 0.35

// ─── Bricks ─────────────────────────────────────────────────
const BRICK_ROWS = 6
const BRICK_COLS = 8
const BRICK_WIDTH = 38
const BRICK_HEIGHT = 16
const BRICK_GAP = 3
const BRICK_TOP_OFFSET = 80
const BRICK_LEFT_OFFSET = (VIEWBOX_WIDTH - (BRICK_COLS * BRICK_WIDTH + (BRICK_COLS - 1) * BRICK_GAP)) / 2

// ─── Game Config ────────────────────────────────────────────
const INITIAL_LIVES = 3
const LAUNCH_DELAY_MS = 800
const PARTICLE_COUNT = 8
const PARTICLE_LIFETIME_MS = 420
const SHAKE_DURATION_MS = 150
const SHAKE_INTENSITY = 5

// ─── Multi-ball ─────────────────────────────────────────────
const MULTI_BALL_BRICK_THRESHOLD = 14
const MAX_EXTRA_BALLS = 3

// ─── Unbreakable bricks ────────────────────────────────────
const UNBREAKABLE_STAGE_START = 3
const UNBREAKABLE_COLOR = '#475569'

// ─── 2-hit bricks ──────────────────────────────────────────
const DOUBLE_HIT_STAGE_START = 2
const DOUBLE_HIT_COLOR_DARK = 0.55 // darken factor for 2-hit bricks

// ─── Score ──────────────────────────────────────────────────
const CONSECUTIVE_HIT_BONUS = 5

// ─── Power-up types ─────────────────────────────────────────
type PowerUpType = 'wide' | 'fireball' | 'slow' | 'extra-life' | 'multi-ball' | 'shield' | 'magnet'

const POWERUP_DROP_CHANCE = 0.20
const POWERUP_SPEED = 120
const POWERUP_SIZE = 14

const POWERUP_COLORS: Record<PowerUpType, string> = {
  'wide': '#22c55e',
  'fireball': '#ef4444',
  'slow': '#3b82f6',
  'extra-life': '#ec4899',
  'multi-ball': '#a855f7',
  'shield': '#f59e0b',
  'magnet': '#14b8a6',
}

const POWERUP_LABELS: Record<PowerUpType, string> = {
  'wide': 'W',
  'fireball': 'F',
  'slow': 'S',
  'extra-life': '+',
  'multi-ball': 'M',
  'shield': 'D',
  'magnet': 'G',
}

const POWERUP_WEIGHTS: { type: PowerUpType; weight: number }[] = [
  { type: 'wide', weight: 25 },
  { type: 'fireball', weight: 18 },
  { type: 'slow', weight: 15 },
  { type: 'extra-life', weight: 8 },
  { type: 'multi-ball', weight: 14 },
  { type: 'shield', weight: 12 },
  { type: 'magnet', weight: 8 },
]

// ─── Fireball mode ──────────────────────────────────────────
const FIREBALL_DURATION_MS = 6000

// ─── Slow mode ──────────────────────────────────────────────
const SLOW_DURATION_MS = 5000
const SLOW_FACTOR = 0.55

// ─── Shield ─────────────────────────────────────────────────
const SHIELD_Y = VIEWBOX_HEIGHT - 8

// ─── Magnet ─────────────────────────────────────────────────
const MAGNET_DURATION_MS = 7000
const MAGNET_STRENGTH = 180

// ─── Trail ──────────────────────────────────────────────────
const TRAIL_LENGTH = 8
const TRAIL_INTERVAL_MS = 16

// ─── Types ──────────────────────────────────────────────────
interface Brick {
  readonly id: number
  readonly row: number
  readonly col: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly baseColor: string
  readonly points: number
  readonly unbreakable: boolean
  readonly maxHits: number
  hitsLeft: number
  alive: boolean
  hitFlash: number
}

interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  launched: boolean
}

interface Particle {
  readonly id: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
  createdAtMs: number
  size: number
}

interface PowerUp {
  readonly id: number
  readonly type: PowerUpType
  x: number
  y: number
  createdAtMs: number
}

interface TrailPoint {
  x: number
  y: number
  age: number
}

interface GameState {
  bricks: Brick[]
  ball: Ball
  extraBalls: Ball[]
  paddleX: number
  lives: number
  score: number
  stage: number
  particles: Particle[]
  elapsedMs: number
  launchTimerMs: number
  shakeMs: number
  nextParticleId: number
  nextBrickId: number
  consecutiveHits: number
  totalBricksDestroyed: number
  multiBallsSpawned: number
  powerUps: PowerUp[]
  nextPowerUpId: number
  widePaddleMs: number
  fireballMs: number
  slowMs: number
  shieldActive: boolean
  magnetMs: number
  combo: number
  comboTimerMs: number
  trail: TrailPoint[]
  lastTrailMs: number
  stageClearFlashMs: number
}

const BRICK_COLORS: { color: string; points: number }[] = [
  { color: '#ef4444', points: 50 },
  { color: '#f97316', points: 40 },
  { color: '#eab308', points: 30 },
  { color: '#22c55e', points: 20 },
  { color: '#06b6d4', points: 10 },
  { color: '#8b5cf6', points: 10 },
]

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function darkenColor(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgb(${Math.round(r * factor)},${Math.round(g * factor)},${Math.round(b * factor)})`
}

function pickPowerUpType(): PowerUpType {
  const totalWeight = POWERUP_WEIGHTS.reduce((sum, w) => sum + w.weight, 0)
  let rand = Math.random() * totalWeight
  for (const entry of POWERUP_WEIGHTS) {
    rand -= entry.weight
    if (rand <= 0) return entry.type
  }
  return 'wide'
}

function createBricks(stage: number, startId: number): Brick[] {
  const bricks: Brick[] = []
  let id = startId
  const rows = Math.min(BRICK_ROWS + Math.floor(stage / 2), 9)

  for (let row = 0; row < rows; row += 1) {
    const colorIndex = row % BRICK_COLORS.length
    const { color, points } = BRICK_COLORS[colorIndex]

    for (let col = 0; col < BRICK_COLS; col += 1) {
      const skipPattern = stage > 1 && (row + col + stage) % 7 === 0
      if (skipPattern) continue

      const x = BRICK_LEFT_OFFSET + col * (BRICK_WIDTH + BRICK_GAP)
      const y = BRICK_TOP_OFFSET + row * (BRICK_HEIGHT + BRICK_GAP)
      const isUnbreakable = stage >= UNBREAKABLE_STAGE_START && (row + col + stage) % 11 === 0
      // 2-hit bricks: appear from stage 2+, scattered pattern
      const isDoubleHit = !isUnbreakable && stage >= DOUBLE_HIT_STAGE_START && (row * 3 + col + stage) % 5 === 0
      const maxHits = isUnbreakable ? 999 : isDoubleHit ? 2 : 1

      bricks.push({
        id, row, col, x, y,
        width: BRICK_WIDTH,
        height: BRICK_HEIGHT,
        baseColor: isUnbreakable ? UNBREAKABLE_COLOR : color,
        points: isUnbreakable ? 0 : (points + stage * 2) * maxHits,
        unbreakable: isUnbreakable,
        maxHits,
        hitsLeft: maxHits,
        alive: true,
        hitFlash: 0,
      })
      id += 1
    }
  }
  return bricks
}

function getBrickColor(brick: Brick): string {
  if (brick.unbreakable) return UNBREAKABLE_COLOR
  if (brick.maxHits > 1 && brick.hitsLeft > 1) return darkenColor(brick.baseColor, DOUBLE_HIT_COLOR_DARK)
  return brick.baseColor
}

function createBall(paddleX: number): Ball {
  return {
    x: paddleX,
    y: PADDLE_Y - BALL_RADIUS - 1,
    vx: 0, vy: 0,
    speed: BALL_INITIAL_SPEED,
    launched: false,
  }
}

function launchBall(ball: Ball): void {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3)
  ball.vx = Math.cos(angle) * ball.speed
  ball.vy = Math.sin(angle) * ball.speed
  ball.launched = true
}

function createInitialState(): GameState {
  const paddleX = VIEWBOX_WIDTH / 2
  const bricks = createBricks(1, 0)
  return {
    bricks,
    ball: createBall(paddleX),
    extraBalls: [],
    paddleX,
    lives: INITIAL_LIVES,
    score: 0,
    stage: 1,
    particles: [],
    elapsedMs: 0,
    launchTimerMs: LAUNCH_DELAY_MS,
    shakeMs: 0,
    nextParticleId: 0,
    nextBrickId: bricks.length,
    consecutiveHits: 0,
    totalBricksDestroyed: 0,
    multiBallsSpawned: 0,
    powerUps: [],
    nextPowerUpId: 0,
    widePaddleMs: 0,
    fireballMs: 0,
    slowMs: 0,
    shieldActive: false,
    magnetMs: 0,
    combo: 0,
    comboTimerMs: 0,
    trail: [],
    lastTrailMs: 0,
    stageClearFlashMs: 0,
  }
}

function spawnParticles(state: GameState, x: number, y: number, color: string, count = PARTICLE_COUNT): void {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const speed = 80 + Math.random() * 180
    state.particles.push({
      id: state.nextParticleId,
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      createdAtMs: state.elapsedMs,
      size: 2 + Math.random() * 3,
    })
    state.nextParticleId += 1
  }
}

function rectIntersectsBall(
  rx: number, ry: number, rw: number, rh: number,
  bx: number, by: number, br: number,
): { hit: boolean; normalX: number; normalY: number } {
  const closestX = clampNumber(bx, rx, rx + rw)
  const closestY = clampNumber(by, ry, ry + rh)
  const dx = bx - closestX
  const dy = by - closestY
  const distSq = dx * dx + dy * dy
  if (distSq > br * br) return { hit: false, normalX: 0, normalY: 0 }
  const dist = Math.sqrt(distSq) || 1
  return { hit: true, normalX: dx / dist, normalY: dy / dist }
}

function reflectBall(ball: Ball, normalX: number, normalY: number): void {
  const dot = ball.vx * normalX + ball.vy * normalY
  ball.vx -= 2 * dot * normalX
  ball.vy -= 2 * dot * normalY
  const currentSpeed = Math.hypot(ball.vx, ball.vy) || 1
  ball.vx = (ball.vx / currentSpeed) * ball.speed
  ball.vy = (ball.vy / currentSpeed) * ball.speed
}

function ensureMinVerticalComponent(ball: Ball): void {
  const currentSpeed = Math.hypot(ball.vx, ball.vy) || 1
  const vyRatio = Math.abs(ball.vy) / currentSpeed
  if (vyRatio < BALL_MIN_VY_RATIO) {
    const sign = ball.vy >= 0 ? 1 : -1
    ball.vy = sign * BALL_MIN_VY_RATIO * ball.speed
    const remainingVx = Math.sqrt(ball.speed * ball.speed - ball.vy * ball.vy)
    ball.vx = Math.sign(ball.vx || 1) * remainingVx
  }
}

// ─── CSS ────────────────────────────────────────────────────
const BREAKOUT_CSS = `
  .breakout-panel {
    max-width: 432px;
    width: 100%;
    height: 100%;
    margin: 0 auto;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
  }
  .breakout-hud {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px 4px;
    z-index: 5;
    flex-shrink: 0;
  }
  .breakout-score {
    font-size: 1.4rem;
    color: #fbbf24;
    margin: 0;
    text-shadow: 0 2px 8px rgba(251,191,36,0.4);
  }
  .breakout-best {
    font-size: 0.55rem;
    color: #94a3b8;
    margin: 0;
  }
  .breakout-stage {
    font-size: 0.7rem;
    color: #e2e8f0;
    margin: 0;
    text-shadow: 0 0 8px rgba(255,255,255,0.3);
  }
  .breakout-lives {
    display: flex;
    gap: 4px;
  }
  .breakout-board {
    flex: 1;
    position: relative;
    overflow: hidden;
    touch-action: none;
  }
  .breakout-svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .breakout-powerup-bar {
    display: flex;
    gap: 6px;
    padding: 0 12px 4px;
    min-height: 22px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .breakout-powerup-badge {
    font-size: 0.5rem;
    padding: 2px 8px;
    border-radius: 8px;
    color: #fff;
    font-weight: bold;
    text-shadow: 0 1px 2px rgba(0,0,0,0.5);
  }
  .breakout-combo-text {
    position: absolute;
    top: 45%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 2rem;
    font-weight: bold;
    pointer-events: none;
    z-index: 10;
    text-shadow: 0 4px 16px rgba(0,0,0,0.5), 0 0 20px currentColor;
    animation: breakout-combo-pop 0.4s ease-out;
  }
  @keyframes breakout-combo-pop {
    0% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
    40% { transform: translate(-50%, -50%) scale(0.9); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  }
  .breakout-stage-banner {
    position: absolute;
    top: 35%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 2.2rem;
    color: #fbbf24;
    font-weight: bold;
    pointer-events: none;
    z-index: 12;
    text-shadow: 0 4px 20px rgba(251,191,36,0.6);
    animation: breakout-stage-in 0.6s ease-out;
  }
  @keyframes breakout-stage-in {
    0% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
    50% { transform: translate(-50%, -50%) scale(0.85); opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
  }
`

function BreakoutMiniGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [renderScore, setRenderScore] = useState(0)
  const [renderLives, setRenderLives] = useState(INITIAL_LIVES)
  const [renderStage, setRenderStage] = useState(1)
  const [renderBricks, setRenderBricks] = useState<Brick[]>(() => createBricks(1, 0))
  const [renderBalls, setRenderBalls] = useState<{ x: number; y: number; fireball: boolean; magnet: boolean }[]>([])
  const [renderPaddleX, setRenderPaddleX] = useState(VIEWBOX_WIDTH / 2)
  const [renderPaddleWidth, setRenderPaddleWidth] = useState(PADDLE_WIDTH)
  const [renderParticles, setRenderParticles] = useState<Particle[]>([])
  const [renderShakeX, setRenderShakeX] = useState(0)
  const [renderShakeY, setRenderShakeY] = useState(0)
  const [renderPowerUps, setRenderPowerUps] = useState<PowerUp[]>([])
  const [renderTrail, setRenderTrail] = useState<TrailPoint[]>([])
  const [renderCombo, setRenderCombo] = useState(0)
  const [renderComboLabel, setRenderComboLabel] = useState('')
  const [renderComboColor, setRenderComboColor] = useState('#fff')
  const [renderActivePowerUps, setRenderActivePowerUps] = useState<{ type: PowerUpType; ms: number }[]>([])
  const [renderStageBanner, setRenderStageBanner] = useState(0)
  const [renderShield, setRenderShield] = useState(false)

  const effects = useGameEffects()

  const stateRef = useRef<GameState>(createInitialState())
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const pointerXRef = useRef<number | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const playSfx = useCallback((key: string, volume: number, playbackRate = 1) => {
    const source = audioRefs.current[key]
    if (!source) return
    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const syncRenderState = useCallback((state: GameState) => {
    setRenderScore(state.score)
    setRenderLives(state.lives)
    setRenderStage(state.stage)
    setRenderBricks([...state.bricks])

    const currentPaddleW = state.widePaddleMs > 0 ? PADDLE_WIDE_WIDTH : PADDLE_WIDTH
    setRenderPaddleWidth(currentPaddleW)

    const allBalls = [state.ball, ...state.extraBalls].filter(b => b.launched || !state.ball.launched)
    setRenderBalls(allBalls.map(b => ({ x: b.x, y: b.y, fireball: state.fireballMs > 0, magnet: state.magnetMs > 0 })))

    setRenderPaddleX(state.paddleX)
    setRenderParticles([...state.particles])
    setRenderPowerUps([...state.powerUps])
    setRenderTrail([...state.trail])
    setRenderCombo(state.combo)
    setRenderComboLabel(getComboLabel(state.combo))
    setRenderComboColor(getComboColor(state.combo))
    setRenderStageBanner(state.stageClearFlashMs)
    setRenderShield(state.shieldActive)

    const activePU: { type: PowerUpType; ms: number }[] = []
    if (state.widePaddleMs > 0) activePU.push({ type: 'wide', ms: state.widePaddleMs })
    if (state.fireballMs > 0) activePU.push({ type: 'fireball', ms: state.fireballMs })
    if (state.slowMs > 0) activePU.push({ type: 'slow', ms: state.slowMs })
    if (state.shieldActive) activePU.push({ type: 'shield', ms: 99999 })
    if (state.magnetMs > 0) activePU.push({ type: 'magnet', ms: state.magnetMs })
    setRenderActivePowerUps(activePU)

    if (state.shakeMs > 0) {
      const intensity = (state.shakeMs / SHAKE_DURATION_MS) * SHAKE_INTENSITY
      setRenderShakeX((Math.random() - 0.5) * 2 * intensity)
      setRenderShakeY((Math.random() - 0.5) * 2 * intensity)
    } else {
      setRenderShakeX(0)
      setRenderShakeY(0)
    }
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    const state = stateRef.current
    const elapsedMs = Math.max(Math.round(state.elapsedMs), Math.round(DEFAULT_FRAME_MS))
    playSfx('gameOver', 0.6, 0.95)
    effects.cleanup()
    onFinish({ score: state.score, durationMs: elapsedMs })
  }, [onFinish, playSfx, effects])

  const advanceStage = useCallback((state: GameState) => {
    state.stage += 1
    const newSpeed = Math.min(BALL_MAX_SPEED, state.ball.speed + BALL_SPEED_INCREMENT)
    const bricks = createBricks(state.stage, state.nextBrickId)
    state.bricks = bricks
    state.nextBrickId += bricks.length
    state.ball = createBall(state.paddleX)
    state.ball.speed = newSpeed
    state.launchTimerMs = LAUNCH_DELAY_MS
    state.extraBalls = []
    state.powerUps = []
    state.trail = []
    state.stageClearFlashMs = 1500
    // Stage bonus: +100 * stage
    const stageBonus = 100 * state.stage
    state.score += stageBonus
    playSfx('stageClear', 0.6, 1.1)
    effects.comboHitBurst(180, 320, state.stage * 6, stageBonus)
    effects.triggerFlash('rgba(251,191,36,0.4)', 200)
  }, [playSfx, effects])

  const loseBall = useCallback((state: GameState) => {
    state.lives -= 1
    state.shakeMs = SHAKE_DURATION_MS
    state.combo = 0
    state.comboTimerMs = 0
    state.trail = []
    playSfx('ballLost', 0.5)
    effects.triggerShake(10)
    effects.triggerFlash('rgba(239,68,68,0.5)', 150)
    if (state.lives > 0) {
      state.ball = createBall(state.paddleX)
      state.launchTimerMs = LAUNCH_DELAY_MS
    }
  }, [playSfx, effects])

  const updatePaddleFromPointer = useCallback((state: GameState) => {
    const board = boardRef.current
    if (!board || pointerXRef.current === null) return
    const rect = board.getBoundingClientRect()
    const relativeX = (pointerXRef.current - rect.left) / rect.width
    const currentPaddleW = state.widePaddleMs > 0 ? PADDLE_WIDE_WIDTH : PADDLE_WIDTH
    const targetX = clampNumber(
      relativeX * VIEWBOX_WIDTH,
      currentPaddleW / 2,
      VIEWBOX_WIDTH - currentPaddleW / 2,
    )
    state.paddleX += (targetX - state.paddleX) * 0.4
    state.paddleX = clampNumber(state.paddleX, currentPaddleW / 2, VIEWBOX_WIDTH - currentPaddleW / 2)
  }, [])

  const applyPowerUp = useCallback((state: GameState, type: PowerUpType) => {
    playSfx('powerup', 0.55, 1.1)
    effects.triggerFlash(POWERUP_COLORS[type] + '40', 100)

    switch (type) {
      case 'wide':
        state.widePaddleMs = PADDLE_WIDE_DURATION_MS
        break
      case 'fireball':
        state.fireballMs = FIREBALL_DURATION_MS
        break
      case 'slow':
        state.slowMs = SLOW_DURATION_MS
        break
      case 'extra-life':
        state.lives = Math.min(state.lives + 1, 5)
        effects.spawnParticles(5, VIEWBOX_WIDTH / 2, VIEWBOX_HEIGHT / 2)
        break
      case 'multi-ball': {
        const extraBall = createBall(state.paddleX)
        launchBall(extraBall)
        extraBall.speed = state.ball.speed
        extraBall.vx = -state.ball.vx * 0.8
        extraBall.vy = state.ball.vy
        state.extraBalls.push(extraBall)
        break
      }
      case 'shield':
        state.shieldActive = true
        break
      case 'magnet':
        state.magnetMs = MAGNET_DURATION_MS
        break
    }
  }, [playSfx, effects])

  // Audio setup
  useEffect(() => {
    const sfxMap: Record<string, string> = {
      brickHit: brickHitSfx,
      paddleHit: paddleHitSfx,
      wallHit: wallHitSfx,
      powerup: powerupSfx,
      combo: comboSfx,
      stageClear: stageClearSfx,
      ballLost: ballLostSfx,
      gameOver: gameOverHitSfx,
    }
    const audios: HTMLAudioElement[] = []
    for (const [key, src] of Object.entries(sfxMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
      audios.push(audio)
    }
    return () => {
      effects.cleanup()
      for (const audio of audios) { audio.pause(); audio.currentTime = 0 }
      audioRefs.current = {}
    }
  }, [])

  // Pointer / touch
  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => { pointerXRef.current = e.clientX }
    const handlePointerDown = (e: PointerEvent) => { pointerXRef.current = e.clientX }
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) pointerXRef.current = e.touches[0].clientX
    }
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('touchmove', handleTouchMove)
    }
  }, [])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return }
      if (finishedRef.current) return
      const state = stateRef.current
      const moveStep = 20
      const currentPaddleW = state.widePaddleMs > 0 ? PADDLE_WIDE_WIDTH : PADDLE_WIDTH
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        state.paddleX = clampNumber(state.paddleX - moveStep, currentPaddleW / 2, VIEWBOX_WIDTH - currentPaddleW / 2)
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        state.paddleX = clampNumber(state.paddleX + moveStep, currentPaddleW / 2, VIEWBOX_WIDTH - currentPaddleW / 2)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const rawDeltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const state = stateRef.current
      const slowFactor = state.slowMs > 0 ? SLOW_FACTOR : 1
      const deltaMs = rawDeltaMs * slowFactor
      const deltaSec = deltaMs / 1000
      state.elapsedMs += rawDeltaMs

      effects.updateParticles()
      updatePaddleFromPointer(state)

      // Tick power-up timers
      if (state.widePaddleMs > 0) state.widePaddleMs = Math.max(0, state.widePaddleMs - rawDeltaMs)
      if (state.fireballMs > 0) state.fireballMs = Math.max(0, state.fireballMs - rawDeltaMs)
      if (state.slowMs > 0) state.slowMs = Math.max(0, state.slowMs - rawDeltaMs)
      if (state.magnetMs > 0) state.magnetMs = Math.max(0, state.magnetMs - rawDeltaMs)
      if (state.shakeMs > 0) state.shakeMs = Math.max(0, state.shakeMs - rawDeltaMs)
      if (state.stageClearFlashMs > 0) state.stageClearFlashMs = Math.max(0, state.stageClearFlashMs - rawDeltaMs)

      // Combo timer
      if (state.comboTimerMs > 0) {
        state.comboTimerMs -= rawDeltaMs
        if (state.comboTimerMs <= 0) { state.combo = 0; state.comboTimerMs = 0 }
      }

      // Brick flash decay
      for (const brick of state.bricks) {
        if (brick.hitFlash > 0) brick.hitFlash = Math.max(0, brick.hitFlash - rawDeltaMs)
      }

      // Particles update
      state.particles = state.particles.filter(p => state.elapsedMs - p.createdAtMs < PARTICLE_LIFETIME_MS)
      for (const p of state.particles) {
        p.x += p.vx * deltaSec
        p.y += p.vy * deltaSec
        p.vy += 250 * deltaSec
      }

      // Power-ups fall
      const currentPaddleWForPU = state.widePaddleMs > 0 ? PADDLE_WIDE_WIDTH : PADDLE_WIDTH
      for (let i = state.powerUps.length - 1; i >= 0; i -= 1) {
        const pu = state.powerUps[i]
        pu.y += POWERUP_SPEED * deltaSec
        if (
          pu.y + POWERUP_SIZE >= PADDLE_Y &&
          pu.y - POWERUP_SIZE <= PADDLE_Y + PADDLE_HEIGHT &&
          pu.x >= state.paddleX - currentPaddleWForPU / 2 - POWERUP_SIZE &&
          pu.x <= state.paddleX + currentPaddleWForPU / 2 + POWERUP_SIZE
        ) {
          applyPowerUp(state, pu.type)
          state.powerUps.splice(i, 1)
          continue
        }
        if (pu.y > VIEWBOX_HEIGHT + 20) state.powerUps.splice(i, 1)
      }

      if (!state.ball.launched) {
        state.ball.x = state.paddleX
        state.ball.y = PADDLE_Y - BALL_RADIUS - 1
        state.launchTimerMs -= rawDeltaMs
        if (state.launchTimerMs <= 0) launchBall(state.ball)
        syncRenderState(state)
        animationFrameRef.current = window.requestAnimationFrame(step)
        return
      }

      // Ball trail
      if (state.elapsedMs - state.lastTrailMs > TRAIL_INTERVAL_MS) {
        state.trail.push({ x: state.ball.x, y: state.ball.y, age: 0 })
        if (state.trail.length > TRAIL_LENGTH) state.trail.shift()
        state.lastTrailMs = state.elapsedMs
      }
      for (const tp of state.trail) tp.age += rawDeltaMs

      // Physics substeps
      const subSteps = Math.max(1, Math.ceil(rawDeltaMs / (DEFAULT_FRAME_MS * 0.5)))
      const subDeltaSec = deltaSec / subSteps
      const currentPaddleW = state.widePaddleMs > 0 ? PADDLE_WIDE_WIDTH : PADDLE_WIDTH
      const isFireball = state.fireballMs > 0
      const isMagnet = state.magnetMs > 0

      const processBall = (b: Ball): 'lost' | 'ok' => {
        // Magnet: gently attract ball horizontally toward paddle
        if (isMagnet && b.vy > 0) {
          const dx = state.paddleX - b.x
          b.vx += Math.sign(dx) * MAGNET_STRENGTH * subDeltaSec
          // Re-normalize speed
          const curSpeed = Math.hypot(b.vx, b.vy)
          if (curSpeed > 0) {
            b.vx = (b.vx / curSpeed) * b.speed
            b.vy = (b.vy / curSpeed) * b.speed
          }
          ensureMinVerticalComponent(b)
        }

        b.x += b.vx * subDeltaSec
        b.y += b.vy * subDeltaSec

        // Wall collisions
        if (b.x - BALL_RADIUS <= 0) {
          b.x = BALL_RADIUS; b.vx = Math.abs(b.vx)
          playSfx('wallHit', 0.2, 1.2)
        } else if (b.x + BALL_RADIUS >= VIEWBOX_WIDTH) {
          b.x = VIEWBOX_WIDTH - BALL_RADIUS; b.vx = -Math.abs(b.vx)
          playSfx('wallHit', 0.2, 1.2)
        }
        if (b.y - BALL_RADIUS <= 0) {
          b.y = BALL_RADIUS; b.vy = Math.abs(b.vy)
          playSfx('wallHit', 0.15, 1.4)
        }

        // Out of bounds — check shield first
        if (b.y + BALL_RADIUS >= VIEWBOX_HEIGHT + 20) {
          if (state.shieldActive) {
            state.shieldActive = false
            b.y = SHIELD_Y - BALL_RADIUS
            b.vy = -Math.abs(b.vy)
            playSfx('wallHit', 0.4, 0.6)
            effects.triggerFlash('rgba(245,158,11,0.4)', 100)
            spawnParticles(state, b.x, SHIELD_Y, '#f59e0b', 8)
            return 'ok'
          }
          return 'lost'
        }

        // Paddle collision
        const paddleLeft = state.paddleX - currentPaddleW / 2
        const paddleCollision = rectIntersectsBall(paddleLeft, PADDLE_Y, currentPaddleW, PADDLE_HEIGHT, b.x, b.y, BALL_RADIUS)
        if (paddleCollision.hit && b.vy > 0) {
          b.y = PADDLE_Y - BALL_RADIUS
          state.consecutiveHits = 0
          const hitOffset = (b.x - state.paddleX) / (currentPaddleW / 2)
          const clampedOffset = clampNumber(hitOffset, -0.92, 0.92)
          const bounceAngle = clampedOffset * (Math.PI / 3)
          b.vx = Math.sin(bounceAngle) * b.speed
          b.vy = -Math.cos(bounceAngle) * b.speed
          ensureMinVerticalComponent(b)
          playSfx('paddleHit', 0.4, 1 + Math.abs(clampedOffset) * 0.2)
          spawnParticles(state, b.x, PADDLE_Y, '#e2e8f0', 3)
        }

        // Brick collisions
        let hitCount = 0
        for (const brick of state.bricks) {
          if (!brick.alive) continue
          const col = rectIntersectsBall(brick.x, brick.y, brick.width, brick.height, b.x, b.y, BALL_RADIUS)
          if (!col.hit) continue

          if (brick.unbreakable && !isFireball) {
            if (hitCount === 0) { reflectBall(b, col.normalX, col.normalY); ensureMinVerticalComponent(b) }
            hitCount += 1
            brick.hitFlash = 120
            playSfx('wallHit', 0.2, 0.7)
            spawnParticles(state, brick.x + brick.width / 2, brick.y + brick.height / 2, '#94a3b8', 2)
            continue
          }

          // Handle multi-hit bricks
          brick.hitsLeft -= 1
          brick.hitFlash = 150
          if (brick.hitsLeft <= 0 || isFireball) {
            brick.alive = false
            brick.hitsLeft = 0
            state.consecutiveHits += 1
            state.totalBricksDestroyed += 1
            state.combo += 1
            state.comboTimerMs = 1200

            const hitBonus = state.consecutiveHits > 1 ? CONSECUTIVE_HIT_BONUS * (state.consecutiveHits - 1) : 0
            const comboBonus = state.combo > 2 ? state.combo * 3 : 0
            const totalBrickScore = brick.points + hitBonus + comboBonus
            state.score += totalBrickScore
            hitCount += 1

            spawnParticles(state, brick.x + brick.width / 2, brick.y + brick.height / 2, brick.baseColor, 6)
            effects.spawnParticles(2, brick.x + brick.width / 2, brick.y + brick.height / 2)
            effects.showScorePopup(totalBrickScore, brick.x + brick.width / 2, brick.y + brick.height / 2, brick.baseColor)

            // Drop power-up
            if (Math.random() < POWERUP_DROP_CHANCE) {
              state.powerUps.push({
                id: state.nextPowerUpId++,
                type: pickPowerUpType(),
                x: brick.x + brick.width / 2,
                y: brick.y + brick.height / 2,
                createdAtMs: state.elapsedMs,
              })
            }

            // Multi-ball threshold
            if (state.totalBricksDestroyed % MULTI_BALL_BRICK_THRESHOLD === 0 && state.extraBalls.length < MAX_EXTRA_BALLS) {
              const extraBall = createBall(state.paddleX)
              launchBall(extraBall)
              extraBall.speed = b.speed
              state.extraBalls.push(extraBall)
              effects.triggerFlash('rgba(168,85,247,0.3)', 80)
            }
          } else {
            // Brick damaged but not destroyed
            hitCount += 1
            spawnParticles(state, brick.x + brick.width / 2, brick.y + brick.height / 2, brick.baseColor, 3)
            effects.showScorePopup(Math.floor(brick.points / brick.maxHits), brick.x + brick.width / 2, brick.y + brick.height / 2, '#94a3b8')
            state.score += Math.floor(brick.points / brick.maxHits)
          }

          // Fireball passes through, normal ball reflects on first hit
          if (!isFireball && hitCount === 1) {
            reflectBall(b, col.normalX, col.normalY)
            ensureMinVerticalComponent(b)
          }
        }

        if (hitCount > 0) {
          const pitchBoost = Math.min(0.4, hitCount * 0.1)
          playSfx('brickHit', 0.35 + hitCount * 0.05, 1 + pitchBoost)
          effects.triggerShake(2 + hitCount)
          if (state.combo >= 5 && state.combo % 5 === 0) {
            playSfx('combo', 0.45, 1 + state.combo * 0.01)
            effects.comboHitBurst(b.x, b.y, state.combo, state.combo * 10)
          }
        }

        return 'ok'
      }

      for (let sub = 0; sub < subSteps; sub += 1) {
        const mainResult = processBall(state.ball)
        if (mainResult === 'lost') {
          if (state.extraBalls.length > 0) {
            state.ball = state.extraBalls.shift()!
            playSfx('wallHit', 0.3, 0.8)
          } else {
            loseBall(state)
            if (state.lives <= 0) { syncRenderState(state); finishGame(); return }
            syncRenderState(state)
            animationFrameRef.current = window.requestAnimationFrame(step)
            return
          }
        }

        for (let i = state.extraBalls.length - 1; i >= 0; i -= 1) {
          const eb = state.extraBalls[i]
          if (!eb.launched) continue
          const result = processBall(eb)
          if (result === 'lost') state.extraBalls.splice(i, 1)
        }
      }

      // Stage clear
      const aliveBreakable = state.bricks.filter(b => b.alive && !b.unbreakable)
      if (aliveBreakable.length === 0) advanceStage(state)

      syncRenderState(state)
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
  }, [advanceStage, finishGame, loseBall, playSfx, syncRenderState, updatePaddleFromPointer, applyPowerUp, effects])

  const displayedBestScore = useMemo(() => Math.max(bestScore, renderScore), [bestScore, renderScore])

  const livesDisplay = useMemo(() => {
    const hearts: string[] = []
    for (let i = 0; i < Math.max(INITIAL_LIVES, renderLives); i += 1) {
      hearts.push(i < renderLives ? '#ef4444' : '#374151')
    }
    return hearts
  }, [renderLives])

  return (
    <section className="mini-game-panel breakout-panel" aria-label="breakout-mini-game" style={effects.getShakeStyle()}>
      <style>{BREAKOUT_CSS}{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {renderCombo >= 3 && renderComboLabel && (
        <div className="breakout-combo-text" style={{ color: renderComboColor }} key={renderCombo}>
          {renderCombo}x {renderComboLabel}
        </div>
      )}

      {renderStageBanner > 0 && (
        <div className="breakout-stage-banner" key={`stage-${renderStage}`}>
          STAGE {renderStage}
        </div>
      )}

      <div className="breakout-hud">
        <div>
          <p className="breakout-score">{renderScore.toLocaleString()}</p>
          <p className="breakout-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div style={{ textAlign: 'center' }}>
          <p className="breakout-stage">STAGE {renderStage}</p>
        </div>
        <div className="breakout-lives">
          {livesDisplay.map((color, index) => (
            <svg key={index} width="18" height="18" viewBox="0 0 24 24">
              <path
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                fill={color}
              />
            </svg>
          ))}
        </div>
      </div>

      <div className="breakout-powerup-bar">
        {renderActivePowerUps.map(pu => (
          <span
            key={pu.type}
            className="breakout-powerup-badge"
            style={{
              background: POWERUP_COLORS[pu.type],
              opacity: pu.ms < 2000 && pu.type !== 'shield' ? 0.5 + 0.5 * Math.sin(pu.ms * 0.01) : 1,
            }}
          >
            {pu.type === 'shield' ? 'SHIELD' : `${pu.type.toUpperCase()} ${Math.ceil(pu.ms / 1000)}s`}
          </span>
        ))}
      </div>

      <div className="breakout-board" ref={boardRef} role="presentation">
        <svg
          className="breakout-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="breakout-field"
        >
          <defs>
            <radialGradient id="ball-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fbbf24" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="fireball-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="magnet-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="paddle-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f1f5f9" />
              <stop offset="100%" stopColor="#94a3b8" />
            </linearGradient>
            <linearGradient id="shield-grad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0" />
              <stop offset="30%" stopColor="#f59e0b" stopOpacity="0.8" />
              <stop offset="70%" stopColor="#fbbf24" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
            </linearGradient>
          </defs>

          <g transform={`translate(${renderShakeX.toFixed(2)} ${renderShakeY.toFixed(2)})`}>
            <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="#0f172a" />

            {Array.from({ length: 8 }, (_, i) => (
              <line key={`gl-${i}`} x1={0} y1={80 * i} x2={VIEWBOX_WIDTH} y2={80 * i} stroke="#1e293b" strokeWidth="0.5" opacity="0.3" />
            ))}

            {/* Danger zone */}
            <rect x="0" y={PADDLE_Y + PADDLE_HEIGHT + 10} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT - PADDLE_Y - PADDLE_HEIGHT - 10} fill="rgba(239,68,68,0.05)" />
            <line x1="0" y1={VIEWBOX_HEIGHT - 4} x2={VIEWBOX_WIDTH} y2={VIEWBOX_HEIGHT - 4} stroke="#ef4444" strokeWidth="2" opacity="0.4" />

            {/* Shield barrier */}
            {renderShield && (
              <>
                <rect x="20" y={SHIELD_Y - 2} width={VIEWBOX_WIDTH - 40} height="4" rx="2" fill="url(#shield-grad)" />
                <rect x="20" y={SHIELD_Y - 1} width={VIEWBOX_WIDTH - 40} height="2" rx="1" fill="#fbbf24" opacity="0.6" />
              </>
            )}

            {/* Bricks */}
            {renderBricks.filter(b => b.alive).map(brick => {
              const brickColor = getBrickColor(brick)
              const is2Hit = brick.maxHits > 1 && brick.hitsLeft > 1
              return (
                <g key={brick.id}>
                  <rect
                    x={brick.x} y={brick.y}
                    width={brick.width} height={brick.height}
                    rx="3" fill={brickColor}
                    opacity={brick.hitFlash > 0 ? 0.5 + 0.5 * Math.sin(brick.hitFlash * 0.1) : 1}
                  />
                  {/* Brick shine */}
                  <rect
                    x={brick.x + 2} y={brick.y + 1}
                    width={brick.width - 4} height={4}
                    rx="2"
                    fill={brick.unbreakable ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.3)'}
                  />
                  {/* Brick bottom shadow */}
                  <rect
                    x={brick.x + 1} y={brick.y + brick.height - 3}
                    width={brick.width - 2} height={3}
                    rx="1"
                    fill="rgba(0,0,0,0.2)"
                  />
                  {/* 2-hit brick indicator: inner border */}
                  {is2Hit && (
                    <rect
                      x={brick.x + 2} y={brick.y + 2}
                      width={brick.width - 4} height={brick.height - 4}
                      rx="2" fill="none"
                      stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"
                      strokeDasharray="4 2"
                    />
                  )}
                  {/* Damaged 2-hit brick: crack lines */}
                  {brick.maxHits > 1 && brick.hitsLeft === 1 && (
                    <>
                      <line x1={brick.x + 8} y1={brick.y + 3} x2={brick.x + brick.width / 2} y2={brick.y + brick.height - 3} stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
                      <line x1={brick.x + brick.width - 6} y1={brick.y + 5} x2={brick.x + brick.width / 2 + 4} y2={brick.y + brick.height - 5} stroke="rgba(255,255,255,0.25)" strokeWidth="1" />
                    </>
                  )}
                  {brick.unbreakable && (
                    <>
                      <line x1={brick.x + 4} y1={brick.y + 5} x2={brick.x + brick.width - 4} y2={brick.y + brick.height - 3} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                      <line x1={brick.x + brick.width - 4} y1={brick.y + 5} x2={brick.x + 4} y2={brick.y + brick.height - 3} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
                    </>
                  )}
                </g>
              )
            })}

            {/* Power-ups falling */}
            {renderPowerUps.map(pu => {
              const puColor = POWERUP_COLORS[pu.type]
              const pulseScale = 1 + 0.15 * Math.sin(pu.y * 0.05)
              return (
                <g key={pu.id}>
                  <circle cx={pu.x} cy={pu.y} r={POWERUP_SIZE + 4} fill={puColor} opacity="0.2" />
                  <circle cx={pu.x} cy={pu.y} r={POWERUP_SIZE * pulseScale} fill={puColor} stroke="#fff" strokeWidth="1.5" />
                  <text x={pu.x} y={pu.y + 4} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="'Press Start 2P', monospace">
                    {POWERUP_LABELS[pu.type]}
                  </text>
                </g>
              )
            })}

            {/* Paddle */}
            <rect
              x={renderPaddleX - renderPaddleWidth / 2}
              y={PADDLE_Y}
              width={renderPaddleWidth}
              height={PADDLE_HEIGHT}
              rx={PADDLE_CORNER_RADIUS}
              fill="url(#paddle-grad)"
            />
            <rect
              x={renderPaddleX - renderPaddleWidth / 2 + 4}
              y={PADDLE_Y + 2}
              width={renderPaddleWidth - 8}
              height={3}
              rx="1.5"
              fill="rgba(255,255,255,0.4)"
            />
            <circle cx={renderPaddleX - renderPaddleWidth / 2 + 4} cy={PADDLE_Y + PADDLE_HEIGHT / 2} r="3" fill="rgba(251,191,36,0.4)" />
            <circle cx={renderPaddleX + renderPaddleWidth / 2 - 4} cy={PADDLE_Y + PADDLE_HEIGHT / 2} r="3" fill="rgba(251,191,36,0.4)" />

            {/* Ball trail */}
            {renderTrail.map((tp, i) => {
              const alpha = (i / renderTrail.length) * 0.3
              const size = BALL_RADIUS * (i / renderTrail.length) * 0.7
              const trailColor = renderBalls[0]?.fireball ? '#ef4444' : renderBalls[0]?.magnet ? '#14b8a6' : '#fbbf24'
              return (
                <circle key={i} cx={tp.x} cy={tp.y} r={size} fill={trailColor} opacity={alpha} />
              )
            })}

            {/* Balls */}
            {renderBalls.map((b, i) => {
              const glowId = b.fireball ? 'url(#fireball-glow)' : b.magnet ? 'url(#magnet-glow)' : 'url(#ball-glow)'
              const ballColor = b.fireball ? '#ef4444' : b.magnet ? '#14b8a6' : '#fbbf24'
              return (
                <g key={`ball-${i}`}>
                  <circle cx={b.x} cy={b.y} r={BALL_RADIUS + 6} fill={glowId} />
                  <circle cx={b.x} cy={b.y} r={BALL_RADIUS} fill={ballColor} />
                  <circle cx={b.x - 2} cy={b.y - 2} r={2.5} fill="rgba(255,255,255,0.7)" />
                  {b.fireball && (
                    <circle cx={b.x} cy={b.y} r={BALL_RADIUS + 2} fill="none" stroke="#ff6b35" strokeWidth="1.5" opacity="0.6" />
                  )}
                  {b.magnet && !b.fireball && (
                    <circle cx={b.x} cy={b.y} r={BALL_RADIUS + 3} fill="none" stroke="#14b8a6" strokeWidth="1" opacity="0.4" strokeDasharray="3 3" />
                  )}
                </g>
              )
            })}

            {/* SVG Particles */}
            {renderParticles.map(p => {
              const age = stateRef.current.elapsedMs - p.createdAtMs
              const progress = clampNumber(age / PARTICLE_LIFETIME_MS, 0, 1)
              const opacity = 1 - progress
              const size = p.size * (1 - progress * 0.5)
              return (
                <circle key={p.id} cx={p.x} cy={p.y} r={size} fill={p.color} opacity={opacity} />
              )
            })}

            {/* Walls */}
            <line x1="1" y1="0" x2="1" y2={VIEWBOX_HEIGHT} stroke="#334155" strokeWidth="2" />
            <line x1={VIEWBOX_WIDTH - 1} y1="0" x2={VIEWBOX_WIDTH - 1} y2={VIEWBOX_HEIGHT} stroke="#334155" strokeWidth="2" />
            <line x1="0" y1="1" x2={VIEWBOX_WIDTH} y2="1" stroke="#334155" strokeWidth="2" />
          </g>
        </svg>
      </div>
    </section>
  )
}

export const breakoutMiniModule: MiniGameModule = {
  manifest: {
    id: 'breakout-mini',
    title: 'Breakout',
    description: 'Bounce ball with paddle to break all bricks!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#ef4444',
  },
  Component: BreakoutMiniGame,
}
