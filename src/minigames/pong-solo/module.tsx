import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import pongPaddleHitSfx from '../../../assets/sounds/pong-paddle-hit.mp3'
import pongWallBounceSfx from '../../../assets/sounds/pong-wall-bounce.mp3'
import pongPowerupSfx from '../../../assets/sounds/pong-powerup.mp3'
import pongComboSfx from '../../../assets/sounds/pong-combo.mp3'
import pongSpeedUpSfx from '../../../assets/sounds/pong-speed-up.mp3'
import pongBrickBreakSfx from '../../../assets/sounds/pong-brick-break.mp3'
import pongDashSfx from '../../../assets/sounds/pong-dash.mp3'
import pongMilestoneSfx from '../../../assets/sounds/pong-milestone.mp3'
import pongShieldSfx from '../../../assets/sounds/pong-shield.mp3'
import pongWaveSfx from '../../../assets/sounds/pong-wave.mp3'
import pongBallLostSfx from '../../../assets/sounds/pong-ball-lost.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Constants ──────────────────────────────────────────────
const BALL_RADIUS = 8
const PADDLE_HEIGHT = 12
const PADDLE_INITIAL_WIDTH = 80
const PADDLE_CORNER_RATIO = 0.25

const INITIAL_BALL_SPEED = 260
const SPEED_INCREASE_FACTOR = 1.035
const MAX_BALL_SPEED = 900

const EDGE_HIT_BONUS = 3
const NORMAL_HIT_SCORE = 1

const GAME_TIMEOUT_MS = 120_000

const PADDLE_SHRINK_INTERVAL = 15
const PADDLE_SHRINK_AMOUNT = 3
const MIN_PADDLE_WIDTH = 32

const RALLY_MILESTONES = [10, 25, 50, 100, 200]
const RALLY_MILESTONE_BONUS = 15

const INITIAL_BALL_ANGLE_MIN = Math.PI * 1.15
const INITIAL_BALL_ANGLE_MAX = Math.PI * 1.85

// Power-ups
const POWERUP_DROP_CHANCE = 0.2
const POWERUP_SIZE = 18
const POWERUP_FALL_SPEED = 120
const POWERUP_DURATION_MS = 7000
const POWERUP_TYPES = ['wide-paddle', 'multi-ball', 'slow-motion', 'magnet', 'shield', 'fireball'] as const
type PowerUpType = typeof POWERUP_TYPES[number]

// Bricks
const BRICK_ROWS = 4
const BRICK_COLS = 7
const BRICK_HEIGHT = 12
const BRICK_GAP = 2
const BRICK_TOP_OFFSET = 8
const BRICK_SCORE = 2
const BRICK_RESPAWN_MS = 14_000

// Score zones
const SCORE_ZONE_COUNT = 3
const SCORE_ZONE_HEIGHT = 50
const SCORE_ZONE_BONUS = 5

// Trail
const TRAIL_LENGTH = 12

// Wave system
const WAVE_INTERVAL_MS = 18_000

// Fever
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_MS = 5000
const FEVER_SCORE_MULTIPLIER = 3

// Dash
const DASH_COOLDOWN_MS = 1200
const DASH_DISTANCE = 80

// Pixel sizes for dot rendering
const PX = 2 // base pixel unit for dot style

interface Vec2 { x: number; y: number }
interface BallState { x: number; y: number; vx: number; vy: number; speed: number; trail: Vec2[]; isFireball: boolean; spin: number }
interface PowerUp { id: number; type: PowerUpType; x: number; y: number }
interface Brick { row: number; col: number; alive: boolean; hp: number; color: string }
interface ImpactBurst { id: number; x: number; y: number; createdAt: number; color: string; size: number }
interface FloatingText { id: number; x: number; y: number; text: string; color: string; createdAt: number; size?: number }
interface PixelParticle { id: number; x: number; y: number; vx: number; vy: number; color: string; life: number; maxLife: number; size: number }

// ─── Helpers ────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function createInitialBall(cx: number, cy: number): BallState {
  const angle = INITIAL_BALL_ANGLE_MIN + Math.random() * (INITIAL_BALL_ANGLE_MAX - INITIAL_BALL_ANGLE_MIN)
  return { x: cx, y: cy, vx: Math.cos(angle) * INITIAL_BALL_SPEED, vy: Math.sin(angle) * INITIAL_BALL_SPEED, speed: INITIAL_BALL_SPEED, trail: [], isFireball: false, spin: 0 }
}

const BRICK_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

function createBricks(): Brick[] {
  const bricks: Brick[] = []
  for (let r = 0; r < BRICK_ROWS; r++)
    for (let c = 0; c < BRICK_COLS; c++)
      bricks.push({ row: r, col: c, alive: true, hp: r === 0 ? 2 : 1, color: BRICK_COLORS[(r + c) % BRICK_COLORS.length] })
  return bricks
}

function getBrickRect(brick: Brick, fieldW: number) {
  const bw = (fieldW - BRICK_GAP * (BRICK_COLS + 1)) / BRICK_COLS
  return { x: BRICK_GAP + brick.col * (bw + BRICK_GAP), y: BRICK_TOP_OFFSET + brick.row * (BRICK_HEIGHT + BRICK_GAP), w: bw, h: BRICK_HEIGHT }
}

const PU_COLOR: Record<PowerUpType, string> = { 'wide-paddle': '#22c55e', 'multi-ball': '#a855f7', 'slow-motion': '#3b82f6', 'magnet': '#f59e0b', 'shield': '#06b6d4', 'fireball': '#ef4444' }
const PU_LABEL: Record<PowerUpType, string> = { 'wide-paddle': 'WIDE', 'multi-ball': 'MULTI', 'slow-motion': 'SLOW', 'magnet': 'MAGNET', 'shield': 'SHIELD', 'fireball': 'FIRE' }

// Pixel-art style drawing helpers
function drawPixelRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  // Snap to pixel grid
  const sx = Math.round(x / PX) * PX
  const sy = Math.round(y / PX) * PX
  const sw = Math.round(w / PX) * PX
  const sh = Math.round(h / PX) * PX
  ctx.fillRect(sx, sy, sw, sh)
}

function drawPixelCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color
  const steps = Math.max(8, Math.ceil(r / PX) * 4)
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2
    const px = cx + Math.cos(angle) * r
    const py = cy + Math.sin(angle) * r
    const sx = Math.round(px / PX) * PX
    const sy = Math.round(py / PX) * PX
    ctx.fillRect(sx, sy, PX, PX)
  }
  // Fill interior
  for (let fy = cy - r; fy <= cy + r; fy += PX) {
    const dx = Math.sqrt(r * r - (fy - cy) * (fy - cy))
    const sx = Math.round((cx - dx) / PX) * PX
    const ex = Math.round((cx + dx) / PX) * PX
    ctx.fillRect(sx, Math.round(fy / PX) * PX, ex - sx, PX)
  }
}

// ─── GameState (mutable, RAF-driven) ────────────────────────
interface GameState {
  score: number; finished: boolean; elapsedMs: number; lastFrameAt: number | null
  paddleX: number; paddleWidth: number
  balls: BallState[]; bricks: Brick[]; powerUps: PowerUp[]
  activePowerUps: Record<string, number>
  impactBursts: ImpactBurst[]; floatingTexts: FloatingText[]
  pixelParticles: PixelParticle[]
  speedLevel: number; rallyCount: number; lastMilestone: number
  brickRespawnTimer: number; waveTimer: number; waveNumber: number
  fieldW: number; fieldH: number
  nextId: number; comboCount: number; lastHitTime: number
  shieldActive: boolean; magnetActive: boolean
  scoreZones: { y: number; side: 'left' | 'right' }[]
  // New features
  feverMode: boolean; feverEndTime: number
  lastDashTime: number
  screenShakeAmount: number; screenShakeDecay: number
  bricksDestroyed: number
  totalBounces: number
}

function initState(): GameState {
  return {
    score: 0, finished: false, elapsedMs: 0, lastFrameAt: null,
    paddleX: 0, paddleWidth: PADDLE_INITIAL_WIDTH,
    balls: [], bricks: [], powerUps: [],
    activePowerUps: {},
    impactBursts: [], floatingTexts: [],
    pixelParticles: [],
    speedLevel: 1, rallyCount: 0, lastMilestone: 0,
    brickRespawnTimer: 0, waveTimer: 0, waveNumber: 0,
    fieldW: 320, fieldH: 560,
    nextId: 0, comboCount: 0, lastHitTime: 0,
    shieldActive: false, magnetActive: false,
    scoreZones: [],
    feverMode: false, feverEndTime: 0,
    lastDashTime: 0,
    screenShakeAmount: 0, screenShakeDecay: 0,
    bricksDestroyed: 0,
    totalBounces: 0,
  }
}

// ─── Component ──────────────────────────────────────────────
function PongSoloGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [comboDisplay, setComboDisplay] = useState(0)

  const effects = useGameEffects()
  const effectsRef = useRef(effects)
  effectsRef.current = effects

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const stateRef = useRef<GameState>(initState())
  const rafRef = useRef<number | null>(null)
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  const playAudio = useCallback((key: string, volume = 0.5, rate = 1) => {
    const a = audioRefs.current[key]
    if (!a) return
    a.currentTime = 0; a.volume = Math.min(1, volume); a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const finishGame = useCallback(() => {
    const s = stateRef.current
    if (s.finished) return
    s.finished = true
    playAudio('gameOver', 0.6)
    s.screenShakeAmount = 15
    effectsRef.current.triggerFlash('rgba(239,68,68,0.5)')
    setScore(s.score)
    onFinishRef.current({ score: s.score, durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, s.elapsedMs)) })
  }, [playAudio])

  // Init audio
  useEffect(() => {
    const srcs: Record<string, string> = {
      paddleHit: pongPaddleHitSfx, wallBounce: pongWallBounceSfx,
      powerup: pongPowerupSfx, combo: pongComboSfx, speedUp: pongSpeedUpSfx,
      brickBreak: pongBrickBreakSfx, dash: pongDashSfx, milestone: pongMilestoneSfx,
      shield: pongShieldSfx, wave: pongWaveSfx, ballLost: pongBallLostSfx,
      gameOver: gameOverHitSfx,
    }
    for (const [k, src] of Object.entries(srcs)) { const a = new Audio(src); a.preload = 'auto'; audioRefs.current[k] = a }
    return () => { for (const a of Object.values(audioRefs.current)) { if (a) { a.pause(); a.currentTime = 0 } }; audioRefs.current = {} }
  }, [])

  // Input
  useEffect(() => {
    let lastTapTime = 0
    let lastTapX = 0

    const updatePaddle = (clientX: number) => {
      const c = canvasRef.current; if (!c || stateRef.current.finished) return
      const r = c.getBoundingClientRect(); const rel = (clientX - r.left) / r.width; const s = stateRef.current
      s.paddleX = clamp(rel * s.fieldW, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
    }

    const tryDash = (clientX: number) => {
      const s = stateRef.current; const now = performance.now()
      if (now - s.lastDashTime < DASH_COOLDOWN_MS) return
      const c = canvasRef.current; if (!c) return
      const r = c.getBoundingClientRect(); const rel = (clientX - r.left) / r.width
      const targetX = rel * s.fieldW
      const dir = targetX > s.paddleX ? 1 : -1
      s.paddleX = clamp(s.paddleX + dir * DASH_DISTANCE, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
      s.lastDashTime = now
      playAudio('dash', 0.4)
      // Dash trail particles
      for (let i = 0; i < 6; i++) {
        s.pixelParticles.push({
          id: s.nextId++, x: s.paddleX + (Math.random() - 0.5) * s.paddleWidth,
          y: s.fieldH - 38, vx: -dir * (30 + Math.random() * 50), vy: -Math.random() * 40,
          color: '#f97316', life: 300, maxLife: 300, size: 3,
        })
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const now = performance.now()
      if (now - lastTapTime < 300 && Math.abs(e.clientX - lastTapX) < 80) {
        tryDash(e.clientX)
      }
      lastTapTime = now; lastTapX = e.clientX
      updatePaddle(e.clientX)
    }
    const onP = (e: PointerEvent) => updatePaddle(e.clientX)
    const onT = (e: TouchEvent) => { if (e.touches.length > 0) updatePaddle(e.touches[0].clientX) }
    const onK = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      const s = stateRef.current; if (s.finished) return
      const step = 28
      if (e.code === 'ArrowLeft') s.paddleX = clamp(s.paddleX - step, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
      if (e.code === 'ArrowRight') s.paddleX = clamp(s.paddleX + step, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
      // Dash with shift+arrow
      if (e.shiftKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        const dir = e.code === 'ArrowLeft' ? -1 : 1
        const now = performance.now()
        if (now - s.lastDashTime >= DASH_COOLDOWN_MS) {
          s.paddleX = clamp(s.paddleX + dir * DASH_DISTANCE, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
          s.lastDashTime = now
          playAudio('dash', 0.4)
        }
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onP)
    window.addEventListener('touchmove', onT, { passive: true })
    window.addEventListener('keydown', onK)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onP)
      window.removeEventListener('touchmove', onT)
      window.removeEventListener('keydown', onK)
    }
  }, [onExit, playAudio])

  // ─── Main game loop ───────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current; const canvas = canvasRef.current
    if (!container || !canvas) return

    const resize = () => {
      const w = container.clientWidth; const h = container.clientHeight
      canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`
      stateRef.current.fieldW = w; stateRef.current.fieldH = h
    }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(container)

    const s = stateRef.current
    Object.assign(s, initState(), { fieldW: s.fieldW, fieldH: s.fieldH })
    s.paddleX = s.fieldW / 2
    s.balls = [createInitialBall(s.fieldW / 2, s.fieldH * 0.5)]
    s.bricks = createBricks()
    s.scoreZones = Array.from({ length: SCORE_ZONE_COUNT }, (_, i) => ({
      y: 80 + i * 120 + Math.random() * 40,
      side: i % 2 === 0 ? 'left' as const : 'right' as const,
    }))

    const ctx = canvas.getContext('2d')!
    const dpr = devicePixelRatio

    const nid = () => s.nextId++

    const addFloat = (x: number, y: number, text: string, color: string, now: number, size?: number) => {
      s.floatingTexts.push({ id: nid(), x, y, text, color, createdAt: now, size })
    }

    const addBurst = (x: number, y: number, color: string, now: number, size = 20) => {
      s.impactBursts.push({ id: nid(), x, y, createdAt: now, color, size })
    }

    const spawnPixelParticles = (x: number, y: number, color: string, count: number, speed = 80) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const spd = speed * (0.3 + Math.random() * 0.7)
        s.pixelParticles.push({
          id: nid(), x, y,
          vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
          color, life: 400 + Math.random() * 300, maxLife: 700, size: PX + Math.floor(Math.random() * 2) * PX,
        })
      }
    }

    const triggerShake = (amount: number) => {
      s.screenShakeAmount = Math.max(s.screenShakeAmount, amount)
    }

    const step = (now: number) => {
      if (s.finished) { rafRef.current = null; return }
      if (s.lastFrameAt === null) s.lastFrameAt = now
      const rawDt = Math.min(now - s.lastFrameAt, MAX_FRAME_DELTA_MS)
      s.lastFrameAt = now; s.elapsedMs += rawDt

      if (s.elapsedMs >= GAME_TIMEOUT_MS) { finishGame(); return }

      const dt = rawDt / 1000
      const isSlow = s.activePowerUps['slow-motion'] != null && s.activePowerUps['slow-motion'] > now
      const scaledDt = dt * (isSlow ? 0.5 : 1)
      s.magnetActive = s.activePowerUps['magnet'] != null && s.activePowerUps['magnet'] > now
      s.shieldActive = s.activePowerUps['shield'] != null && s.activePowerUps['shield'] > now

      // Fever mode
      if (s.feverMode && now > s.feverEndTime) {
        s.feverMode = false
      }

      // Screen shake decay
      if (s.screenShakeAmount > 0) {
        s.screenShakeAmount *= 0.88
        if (s.screenShakeAmount < 0.3) s.screenShakeAmount = 0
      }

      // Paddle width — use full bottom area
      const basePW = Math.max(MIN_PADDLE_WIDTH, PADDLE_INITIAL_WIDTH - Math.floor(s.rallyCount / PADDLE_SHRINK_INTERVAL) * PADDLE_SHRINK_AMOUNT)
      const isWide = s.activePowerUps['wide-paddle'] != null && s.activePowerUps['wide-paddle'] > now
      s.paddleWidth = isWide ? Math.min(basePW * 1.6, s.fieldW * 0.5) : basePW
      const paddleY = s.fieldH - 30 // Closer to bottom edge!
      const W = s.fieldW; const H = s.fieldH
      const scoreMultiplier = s.feverMode ? FEVER_SCORE_MULTIPLIER : 1

      // Brick respawn
      s.brickRespawnTimer += rawDt
      if (s.brickRespawnTimer >= BRICK_RESPAWN_MS) {
        s.brickRespawnTimer = 0
        const dead = s.bricks.filter(b => !b.alive)
        for (let i = 0; i < Math.min(4, dead.length); i++) { dead[i].alive = true; dead[i].hp = 1 }
      }

      // Wave system
      s.waveTimer += rawDt
      if (s.waveTimer >= WAVE_INTERVAL_MS) {
        s.waveTimer = 0; s.waveNumber++
        const newRow = s.waveNumber + BRICK_ROWS
        for (let c = 0; c < BRICK_COLS; c++) {
          s.bricks.push({ row: newRow % 6, col: c, alive: true, hp: Math.min(3, 1 + Math.floor(s.waveNumber / 2)), color: BRICK_COLORS[(s.waveNumber + c) % BRICK_COLORS.length] })
        }
        addFloat(W / 2, H * 0.3, `WAVE ${s.waveNumber}!`, '#f59e0b', now, 14)
        playAudio('wave', 0.5)
        triggerShake(4)
      }

      // ── Update balls ──
      const newBalls: BallState[] = []
      for (const ball of s.balls) {
        let nx = ball.x + ball.vx * scaledDt
        let ny = ball.y + ball.vy * scaledDt
        let nvx = ball.vx; let nvy = ball.vy; let nspeed = ball.speed
        let spin = ball.spin * 0.995 // Decay spin

        // Magnet: curve ball toward paddle
        if (s.magnetActive && nvy > 0) {
          const dx = s.paddleX - nx
          nvx += dx * 2.5 * scaledDt
        }

        // Spin effect — curve ball
        if (Math.abs(spin) > 0.1) {
          nvx += spin * 50 * scaledDt
        }

        // Walls
        if (nx - BALL_RADIUS <= 0) {
          nx = BALL_RADIUS; nvx = Math.abs(nvx)
          playAudio('wallBounce', 0.2); s.totalBounces++
          spawnPixelParticles(BALL_RADIUS, ny, '#a78bfa', 3, 40)
        }
        if (nx + BALL_RADIUS >= W) {
          nx = W - BALL_RADIUS; nvx = -Math.abs(nvx)
          playAudio('wallBounce', 0.2); s.totalBounces++
          spawnPixelParticles(W - BALL_RADIUS, ny, '#a78bfa', 3, 40)
        }
        if (ny - BALL_RADIUS <= 0) {
          ny = BALL_RADIUS; nvy = Math.abs(nvy)
          playAudio('wallBounce', 0.2); s.totalBounces++
          spawnPixelParticles(nx, BALL_RADIUS, '#a78bfa', 3, 40)
        }

        // Score zones on walls
        for (const zone of s.scoreZones) {
          const hitWall = (zone.side === 'left' && nx - BALL_RADIUS <= 2) || (zone.side === 'right' && nx + BALL_RADIUS >= W - 2)
          if (hitWall && ny >= zone.y && ny <= zone.y + SCORE_ZONE_HEIGHT) {
            const pts = SCORE_ZONE_BONUS * scoreMultiplier
            s.score += pts; setScore(s.score)
            addFloat(zone.side === 'left' ? 30 : W - 30, ny, `+${pts}`, '#22c55e', now)
            addBurst(zone.side === 'left' ? 3 : W - 3, ny, '#22c55e', now, 15)
            spawnPixelParticles(zone.side === 'left' ? 3 : W - 3, ny, '#22c55e', 5)
          }
        }

        // Bricks
        for (const brick of s.bricks) {
          if (!brick.alive) continue
          const br = getBrickRect(brick, W)
          if (nx + BALL_RADIUS > br.x && nx - BALL_RADIUS < br.x + br.w && ny + BALL_RADIUS > br.y && ny - BALL_RADIUS < br.y + br.h) {
            // Fireball pierces through!
            if (!ball.isFireball) {
              brick.hp--
            } else {
              brick.hp = 0
            }
            if (brick.hp <= 0) {
              brick.alive = false
              s.bricksDestroyed++
              const pts = BRICK_SCORE * scoreMultiplier
              s.score += pts; setScore(s.score)
              addBurst(br.x + br.w / 2, br.y + br.h / 2, brick.color, now, 25)
              spawnPixelParticles(br.x + br.w / 2, br.y + br.h / 2, brick.color, 8, 100)
              playAudio('brickBreak', 0.4, 0.9 + Math.random() * 0.3)
              triggerShake(2)
              // Power-up drop
              if (Math.random() < POWERUP_DROP_CHANCE) {
                const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
                s.powerUps.push({ id: nid(), type, x: br.x + br.w / 2, y: br.y + br.h })
              }
            } else {
              addFloat(br.x + br.w / 2, br.y, 'CRACK', '#fbbf24', now)
              spawnPixelParticles(br.x + br.w / 2, br.y + br.h / 2, '#fbbf24', 4, 50)
            }
            // Fireball goes through, otherwise reflect
            if (!ball.isFireball) {
              const overlapL = (nx + BALL_RADIUS) - br.x
              const overlapR = (br.x + br.w) - (nx - BALL_RADIUS)
              const overlapT = (ny + BALL_RADIUS) - br.y
              const overlapB = (br.y + br.h) - (ny - BALL_RADIUS)
              const minOverlap = Math.min(overlapL, overlapR, overlapT, overlapB)
              if (minOverlap === overlapT || minOverlap === overlapB) nvy = -nvy
              else nvx = -nvx
              break
            }
          }
        }

        // Paddle
        const pLeft = s.paddleX - s.paddleWidth / 2
        const pRight = s.paddleX + s.paddleWidth / 2
        const pTop = paddleY - PADDLE_HEIGHT / 2

        if (nvy > 0 && ny + BALL_RADIUS >= pTop && ball.y + BALL_RADIUS <= pTop + 10 && nx + BALL_RADIUS >= pLeft && nx - BALL_RADIUS <= pRight) {
          ny = pTop - BALL_RADIUS
          const hitPos = clamp((nx - s.paddleX) / (s.paddleWidth / 2), -1, 1)
          const isEdge = Math.abs(hitPos) > (1 - PADDLE_CORNER_RATIO)
          const maxA = Math.PI * 0.38; const ang = -Math.PI / 2 + hitPos * maxA

          // Add spin based on hit position
          spin = hitPos * 2.5

          if (isEdge) {
            const ea = clamp(ang * 1.25, -Math.PI * 0.44, Math.PI * 0.44)
            nvx = Math.sin(ea) * nspeed; nvy = -Math.cos(ea) * nspeed
          } else {
            nvx = Math.sin(ang) * nspeed; nvy = -Math.cos(ang) * nspeed
          }

          nspeed = Math.min(nspeed * SPEED_INCREASE_FACTOR, MAX_BALL_SPEED)
          const mag = Math.hypot(nvx, nvy)
          if (mag > 0) { nvx = (nvx / mag) * nspeed; nvy = (nvy / mag) * nspeed }

          s.rallyCount++
          const added = (isEdge ? NORMAL_HIT_SCORE + EDGE_HIT_BONUS : NORMAL_HIT_SCORE) * scoreMultiplier
          s.score += added; setScore(s.score)

          // Combo
          if (now - s.lastHitTime < 2500) {
            s.comboCount++
            if (s.comboCount >= 3) setComboDisplay(s.comboCount)

            // Fever mode trigger
            if (s.comboCount >= FEVER_COMBO_THRESHOLD && !s.feverMode) {
              s.feverMode = true
              s.feverEndTime = now + FEVER_DURATION_MS
              addFloat(W / 2, H * 0.35, 'FEVER MODE!', '#ff6b35', now, 16)
              triggerShake(8)
              effectsRef.current.triggerFlash('rgba(255,107,53,0.3)', 200)
              playAudio('combo', 0.7, 1.3)
              spawnPixelParticles(W / 2, H / 2, '#ff6b35', 20, 150)
            }

            if (s.comboCount >= 5 && s.comboCount % 5 === 0) {
              const bonus = s.comboCount * 2 * scoreMultiplier
              s.score += bonus; setScore(s.score)
              playAudio('combo', 0.5, 1 + s.comboCount * 0.015)
              addFloat(W / 2, H * 0.4, `${s.comboCount}x COMBO +${bonus}`, '#fbbf24', now, 13)
              effectsRef.current.triggerFlash('rgba(251,191,36,0.2)', 100)
              spawnPixelParticles(W / 2, H * 0.4, '#fbbf24', 12, 120)
            }
          } else { s.comboCount = 1; setComboDisplay(0) }
          s.lastHitTime = now

          if (isEdge) {
            playAudio('paddleHit', 0.55, 1.1 + s.rallyCount * 0.003)
            addBurst(nx, pTop, '#f97316', now, 28)
            addFloat(nx, pTop - 16, `EDGE +${added}`, '#ef4444', now, 11)
            spawnPixelParticles(nx, pTop, '#f97316', 6, 80)
            triggerShake(3)
          } else {
            playAudio('paddleHit', 0.4, 1.0 + s.rallyCount * 0.002)
            spawnPixelParticles(nx, pTop, '#a78bfa', 3, 40)
          }

          // Milestones
          for (const m of RALLY_MILESTONES) {
            if (s.rallyCount >= m && s.lastMilestone < m) {
              s.lastMilestone = m
              const mBonus = RALLY_MILESTONE_BONUS * scoreMultiplier
              s.score += mBonus; setScore(s.score)
              playAudio('milestone', 0.6)
              addFloat(W / 2, H * 0.35, `${m} RALLIES! +${mBonus}`, '#a855f7', now, 14)
              triggerShake(6)
              effectsRef.current.triggerFlash('rgba(168,85,247,0.2)', 150)
              spawnPixelParticles(W / 2, H * 0.35, '#a855f7', 15, 130)
              break
            }
          }

          s.speedLevel = Math.max(1, Math.round(Math.log(nspeed / INITIAL_BALL_SPEED) / Math.log(SPEED_INCREASE_FACTOR)) + 1)
          if (s.speedLevel > 1 && s.speedLevel % 5 === 0) playAudio('speedUp', 0.3)
        }

        // Out of bounds
        if (ny - BALL_RADIUS > H) {
          if (s.shieldActive) {
            ny = H - BALL_RADIUS - 2; nvy = -Math.abs(nvy) * 0.8
            s.activePowerUps['shield'] = 0; s.shieldActive = false
            addFloat(W / 2, H - 60, 'SHIELD SAVE!', '#06b6d4', now, 13)
            addBurst(nx, H - 10, '#06b6d4', now, 30)
            playAudio('shield', 0.5)
            triggerShake(4)
            spawnPixelParticles(nx, H - 10, '#06b6d4', 10, 100)
          } else if (s.balls.length <= 1) {
            playAudio('ballLost', 0.5)
            finishGame(); return
          } else {
            playAudio('ballLost', 0.3)
            continue
          }
        }

        const trail = [...ball.trail, { x: nx, y: ny }].slice(-TRAIL_LENGTH)
        newBalls.push({ x: nx, y: ny, vx: nvx, vy: nvy, speed: nspeed, trail, isFireball: ball.isFireball, spin })
      }
      s.balls = newBalls

      // Power-ups
      s.powerUps = s.powerUps.filter(pu => {
        pu.y += POWERUP_FALL_SPEED * scaledDt
        if (pu.y + POWERUP_SIZE / 2 >= paddleY - PADDLE_HEIGHT / 2 &&
            pu.x > s.paddleX - s.paddleWidth / 2 - POWERUP_SIZE / 2 &&
            pu.x < s.paddleX + s.paddleWidth / 2 + POWERUP_SIZE / 2) {
          s.activePowerUps[pu.type] = now + POWERUP_DURATION_MS
          playAudio('powerup', 0.5)
          addFloat(pu.x, pu.y - 20, PU_LABEL[pu.type], PU_COLOR[pu.type], now, 12)
          spawnPixelParticles(pu.x, pu.y, PU_COLOR[pu.type], 8, 60)
          if (pu.type === 'multi-ball' && s.balls.length < 6) {
            const base = s.balls[0]
            if (base) {
              for (let i = 0; i < 2; i++) {
                const spread = (i === 0 ? -1 : 1) * (0.4 + Math.random() * 0.3)
                s.balls.push({ x: base.x, y: base.y, vx: base.vx * spread - base.vy * 0.5, vy: base.vy * 0.9, speed: base.speed * 0.9, trail: [], isFireball: false, spin: 0 })
              }
            }
          }
          if (pu.type === 'fireball') {
            for (const b of s.balls) b.isFireball = true
            addFloat(W / 2, H * 0.4, 'FIREBALL!', '#ef4444', now, 15)
            triggerShake(5)
          }
          return false
        }
        return pu.y < H + POWERUP_SIZE
      })

      // Update pixel particles
      s.pixelParticles = s.pixelParticles.filter(p => {
        p.x += p.vx * dt; p.y += p.vy * dt
        p.vy += 120 * dt // gravity
        p.life -= rawDt
        return p.life > 0
      })
      if (s.pixelParticles.length > 100) s.pixelParticles = s.pixelParticles.slice(-80)

      // Cleanup
      s.impactBursts = s.impactBursts.filter(b => now - b.createdAt < 500)
      s.floatingTexts = s.floatingTexts.filter(t => now - t.createdAt < 1000)

      // Fireball timeout
      if (s.activePowerUps['fireball'] != null && s.activePowerUps['fireball'] <= now) {
        for (const b of s.balls) b.isFireball = false
      }

      // ══════════════════ RENDER ══════════════════
      ctx.save(); ctx.scale(dpr, dpr)

      // Screen shake offset
      let shakeX = 0, shakeY = 0
      if (s.screenShakeAmount > 0) {
        shakeX = (Math.random() - 0.5) * s.screenShakeAmount * 2
        shakeY = (Math.random() - 0.5) * s.screenShakeAmount * 2
        ctx.translate(shakeX, shakeY)
      }

      // BG — dark pixel grid
      ctx.fillStyle = '#0a0820'; ctx.fillRect(-5, -5, W + 10, H + 10)

      // Pixel grid pattern
      ctx.fillStyle = 'rgba(80,60,160,0.04)'
      for (let gx = 0; gx < W; gx += 8) {
        for (let gy = 0; gy < H; gy += 8) {
          if ((gx + gy) % 16 === 0) ctx.fillRect(gx, gy, 8, 8)
        }
      }

      // Fever overlay
      if (s.feverMode) {
        const feverPulse = 0.06 + 0.04 * Math.sin(now * 0.008)
        ctx.fillStyle = `rgba(255,107,53,${feverPulse})`
        ctx.fillRect(0, 0, W, H)
        // Fever border glow
        ctx.strokeStyle = `rgba(255,107,53,${0.3 + 0.2 * Math.sin(now * 0.01)})`
        ctx.lineWidth = 3
        ctx.strokeRect(1, 1, W - 2, H - 2)
      }

      // Speed lines (more intense with pixel style)
      const mainBall = s.balls[0]
      if (mainBall && mainBall.speed > INITIAL_BALL_SPEED * 1.3) {
        const spInt = clamp((mainBall.speed - INITIAL_BALL_SPEED * 1.3) / (MAX_BALL_SPEED - INITIAL_BALL_SPEED * 1.3), 0, 1)
        ctx.fillStyle = `rgba(167,139,250,${0.15 * spInt})`
        for (let i = 0; i < 16; i++) {
          const sx = Math.round((Math.random() * W) / PX) * PX
          const sy = Math.round((Math.random() * H) / PX) * PX
          const len = Math.round((20 + Math.random() * 40) / PX) * PX
          ctx.fillRect(sx, sy, PX, len)
        }
      }

      // Score zones on walls — pixel style
      for (const zone of s.scoreZones) {
        const zx = zone.side === 'left' ? 0 : W - 6
        // Animated glow
        const zAlpha = 0.15 + 0.08 * Math.sin(now * 0.004 + zone.y)
        ctx.fillStyle = `rgba(34,197,94,${zAlpha})`
        for (let zy = zone.y; zy < zone.y + SCORE_ZONE_HEIGHT; zy += PX) {
          ctx.fillRect(zx, zy, 6, PX)
        }
        // $ sign in pixel
        ctx.fillStyle = 'rgba(34,197,94,0.6)'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'
        ctx.fillText('$', zx + 3, zone.y + SCORE_ZONE_HEIGHT / 2 + 3)
      }

      // Shield indicator at bottom — pixel dashes
      if (s.shieldActive) {
        const shieldPulse = 0.4 + 0.2 * Math.sin(now * 0.006)
        ctx.fillStyle = `rgba(6,182,212,${shieldPulse})`
        for (let sx = 0; sx < W; sx += 8) {
          if (Math.floor(sx / 8) % 2 === 0) {
            ctx.fillRect(sx, H - 4, 6, 3)
          }
        }
      }

      // Bricks — pixel art style with highlights & shadows
      for (const brick of s.bricks) {
        if (!brick.alive) continue
        const br = getBrickRect(brick, W)
        // Main brick body
        drawPixelRect(ctx, br.x, br.y, br.w, br.h, brick.color)
        // Pixel highlight (top-left light)
        ctx.fillStyle = 'rgba(255,255,255,0.35)'
        ctx.fillRect(br.x + PX, br.y, br.w - PX * 2, PX)
        ctx.fillRect(br.x, br.y, PX, br.h - PX)
        // Shadow (bottom-right)
        ctx.fillStyle = 'rgba(0,0,0,0.3)'
        ctx.fillRect(br.x + PX, br.y + br.h - PX, br.w - PX, PX)
        ctx.fillRect(br.x + br.w - PX, br.y + PX, PX, br.h - PX * 2)
        // HP indicator
        if (brick.hp > 1) {
          ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillText(`${brick.hp}`, br.x + br.w / 2, br.y + br.h / 2)
        }
        // Glow for high HP
        if (brick.hp >= 3) {
          ctx.shadowColor = brick.color; ctx.shadowBlur = 6
          ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(br.x, br.y, br.w, br.h)
          ctx.shadowBlur = 0
        }
      }

      // Power-ups falling — pixel diamonds
      for (const pu of s.powerUps) {
        const pulse = 0.85 + 0.15 * Math.sin(now * 0.008)
        const puSize = POWERUP_SIZE * pulse
        const color = PU_COLOR[pu.type]
        ctx.save()
        ctx.translate(pu.x, pu.y)
        ctx.rotate(now * 0.003)
        // Diamond shape pixel art
        ctx.fillStyle = color
        const hs = puSize / 2
        ctx.fillRect(-PX, -hs, PX * 2, puSize) // vertical
        ctx.fillRect(-hs, -PX, puSize, PX * 2) // horizontal
        ctx.fillRect(-hs + PX * 2, -PX * 2, puSize - PX * 4, PX * 4)
        ctx.fillRect(-PX * 2, -hs + PX * 2, PX * 4, puSize - PX * 4)
        // Label
        ctx.rotate(-now * 0.003) // counter-rotate for text
        ctx.fillStyle = '#fff'; ctx.font = 'bold 6px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(PU_LABEL[pu.type].charAt(0), 0, 0)
        ctx.restore()
      }

      // Ball trails — pixel dots that fade
      for (const ball of s.balls) {
        for (let i = 0; i < ball.trail.length; i++) {
          const t = i / ball.trail.length
          const trailColor = ball.isFireball ? `rgba(239,68,68,${t * 0.5})` : `rgba(168,85,247,${t * 0.4})`
          const tSize = PX * Math.max(1, Math.ceil(t * (BALL_RADIUS / PX)))
          drawPixelRect(ctx, ball.trail[i].x - tSize / 2, ball.trail[i].y - tSize / 2, tSize, tSize, trailColor)
        }
      }

      // Balls — pixel circle
      for (const ball of s.balls) {
        ctx.save()
        if (ball.isFireball) {
          // Fireball glow
          ctx.shadowColor = '#ef4444'; ctx.shadowBlur = 16
          drawPixelCircle(ctx, ball.x, ball.y, BALL_RADIUS + 2, 'rgba(239,68,68,0.3)')
          drawPixelCircle(ctx, ball.x, ball.y, BALL_RADIUS, '#ff6b35')
          drawPixelCircle(ctx, ball.x, ball.y, BALL_RADIUS - 2, '#fbbf24')
          // Fire particles
          spawnPixelParticles(ball.x, ball.y, '#ef4444', 1, 20)
        } else {
          ctx.shadowColor = s.magnetActive ? '#f59e0b' : '#a855f7'; ctx.shadowBlur = 12
          drawPixelCircle(ctx, ball.x, ball.y, BALL_RADIUS, '#fff')
          // Highlight pixel
          ctx.fillStyle = s.magnetActive ? 'rgba(245,158,11,0.5)' : 'rgba(168,85,247,0.5)'
          ctx.fillRect(Math.round((ball.x - 2) / PX) * PX, Math.round((ball.y - 2) / PX) * PX, PX * 2, PX * 2)
        }
        ctx.shadowBlur = 0
        ctx.restore()
      }

      // Paddle — pixel art with edge marks
      const pw = s.paddleWidth; const pY = paddleY
      // Main paddle body
      const paddleColor = s.feverMode ? '#ff6b35' : isWide ? '#22c55e' : '#f97316'
      drawPixelRect(ctx, s.paddleX - pw / 2, pY - PADDLE_HEIGHT / 2, pw, PADDLE_HEIGHT, paddleColor)
      // Highlight top edge
      ctx.fillStyle = 'rgba(255,255,255,0.5)'
      ctx.fillRect(Math.round((s.paddleX - pw / 2 + PX) / PX) * PX, Math.round((pY - PADDLE_HEIGHT / 2) / PX) * PX, Math.round((pw - PX * 2) / PX) * PX, PX)
      // Shadow bottom edge
      ctx.fillStyle = 'rgba(0,0,0,0.3)'
      ctx.fillRect(Math.round((s.paddleX - pw / 2) / PX) * PX, Math.round((pY + PADDLE_HEIGHT / 2 - PX) / PX) * PX, Math.round(pw / PX) * PX, PX)
      // Edge zone markers
      const ew = pw * PADDLE_CORNER_RATIO
      ctx.fillStyle = 'rgba(239,68,68,0.5)'
      drawPixelRect(ctx, s.paddleX - pw / 2, pY - PADDLE_HEIGHT / 2, ew, PADDLE_HEIGHT, 'rgba(239,68,68,0.5)')
      drawPixelRect(ctx, s.paddleX + pw / 2 - ew, pY - PADDLE_HEIGHT / 2, ew, PADDLE_HEIGHT, 'rgba(239,68,68,0.5)')
      // Paddle glow
      if (s.feverMode) {
        ctx.shadowColor = '#ff6b35'; ctx.shadowBlur = 20
        ctx.fillStyle = 'rgba(255,107,53,0.1)'; ctx.fillRect(s.paddleX - pw / 2, pY - PADDLE_HEIGHT / 2, pw, PADDLE_HEIGHT)
        ctx.shadowBlur = 0
      }

      // Danger line (pixel dashes)
      if (!s.shieldActive) {
        ctx.fillStyle = 'rgba(239,68,68,0.2)'
        for (let dx = 0; dx < W; dx += 10) {
          if (Math.floor(dx / 10) % 2 === 0) ctx.fillRect(dx, H - 3, 8, PX)
        }
      }

      // Pixel particles
      for (const p of s.pixelParticles) {
        const alpha = clamp(p.life / p.maxLife, 0, 1)
        ctx.fillStyle = p.color
        ctx.globalAlpha = alpha
        ctx.fillRect(Math.round(p.x / PX) * PX, Math.round(p.y / PX) * PX, p.size, p.size)
      }
      ctx.globalAlpha = 1

      // Impact bursts — pixel rings
      for (const b of s.impactBursts) {
        const age = (now - b.createdAt) / 500; if (age >= 1) continue
        const r = b.size * (0.3 + age * 0.7); const alpha = 1 - age
        ctx.globalAlpha = alpha
        // Pixel cross burst
        ctx.fillStyle = b.color
        const hb = Math.round(r / PX) * PX
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2 + age * 3
          const bx = b.x + Math.cos(a) * hb
          const by = b.y + Math.sin(a) * hb
          ctx.fillRect(Math.round(bx / PX) * PX, Math.round(by / PX) * PX, PX * 2, PX * 2)
        }
        ctx.globalAlpha = 1
      }

      // Floating texts — pixel font style
      for (const ft of s.floatingTexts) {
        const age = (now - ft.createdAt) / 1000; if (age >= 1) continue
        const alpha = 1 - age * age; const yOff = -age * 35
        ctx.save(); ctx.globalAlpha = alpha
        const fontSize = ft.size || 10
        ctx.font = `bold ${fontSize}px "Press Start 2P", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        // Text shadow for readability
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(ft.text, ft.x + 1, ft.y + yOff + 1)
        ctx.fillStyle = ft.color; ctx.fillText(ft.text, ft.x, ft.y + yOff)
        ctx.restore()
      }

      // ── HUD (pixel styled) ──
      // Top bar background
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      for (let hx = 4; hx < W - 4; hx += PX) ctx.fillRect(hx, 0, PX, BRICK_TOP_OFFSET - 2)

      // Score (big, left)
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px "Press Start 2P", monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top'
      // We actually don't draw HUD on the bricks area since bricks start at BRICK_TOP_OFFSET
      // HUD goes into the bottom area instead

      // Bottom HUD strip
      const hudY = H - 14
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, hudY - 2, W, 16)

      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px "Press Start 2P", monospace'; ctx.textAlign = 'left'
      ctx.fillText(`${s.score}`, 6, hudY)
      ctx.textAlign = 'right'; ctx.fillStyle = '#a78bfa'
      ctx.fillText(`Lv.${s.speedLevel}`, W - 6, hudY)

      // Timer
      const remainSec = Math.max(0, Math.ceil((GAME_TIMEOUT_MS - s.elapsedMs) / 1000))
      ctx.textAlign = 'center'; ctx.fillStyle = remainSec <= 10 ? '#ef4444' : 'rgba(255,255,255,0.4)'
      ctx.font = '7px "Press Start 2P", monospace'
      ctx.fillText(`${remainSec}s`, W / 2, hudY)

      // Combo display
      if (s.comboCount >= 3) {
        ctx.fillStyle = s.feverMode ? '#ff6b35' : '#fbbf24'; ctx.textAlign = 'right'
        ctx.font = 'bold 8px "Press Start 2P", monospace'
        ctx.fillText(`x${s.comboCount}`, W - 6, hudY - 12)
      }

      // Best score
      ctx.textAlign = 'center'; ctx.font = '6px "Press Start 2P", monospace'; ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillText(`BEST ${Math.max(bestScore, s.score)}`, W / 2, hudY - 12)

      // Ball count
      if (s.balls.length > 1) {
        ctx.fillStyle = '#a855f7'; ctx.font = '7px "Press Start 2P", monospace'; ctx.textAlign = 'left'
        ctx.fillText(`x${s.balls.length}`, 6, hudY - 12)
      }

      // Active power-up indicators (top right corner, small pixel boxes)
      const activePUs = Object.entries(s.activePowerUps).filter(([, exp]) => exp > now)
      if (activePUs.length > 0) {
        let puX = W - 6
        for (const [type, exp] of activePUs) {
          const rem = clamp((exp - now) / POWERUP_DURATION_MS, 0, 1)
          const color = PU_COLOR[type as PowerUpType]
          // Small colored bar
          ctx.fillStyle = color; ctx.globalAlpha = 0.7
          const barW = 20 * rem
          ctx.fillRect(puX - 20, 4, barW, 4)
          ctx.globalAlpha = 1
          ctx.fillStyle = color; ctx.font = '5px monospace'; ctx.textAlign = 'right'
          ctx.fillText(PU_LABEL[type as PowerUpType].charAt(0), puX, 14)
          puX -= 24
        }
      }

      // Fever banner
      if (s.feverMode) {
        const feverFlash = Math.sin(now * 0.01) > 0
        if (feverFlash) {
          ctx.fillStyle = 'rgba(255,107,53,0.8)'; ctx.font = 'bold 10px "Press Start 2P", monospace'
          ctx.textAlign = 'center'; ctx.fillText('FEVER!', W / 2, BRICK_TOP_OFFSET + BRICK_ROWS * (BRICK_HEIGHT + BRICK_GAP) + 16)
        }
      }

      // Slow motion overlay
      if (isSlow) {
        ctx.fillStyle = 'rgba(59,130,246,0.04)'; ctx.fillRect(0, 0, W, H)
        // Scanlines effect
        ctx.fillStyle = 'rgba(59,130,246,0.06)'
        for (let sy = 0; sy < H; sy += 4) ctx.fillRect(0, sy, W, 1)
      }

      // Dash cooldown indicator near paddle
      const dashReady = now - s.lastDashTime >= DASH_COOLDOWN_MS
      if (dashReady) {
        ctx.fillStyle = 'rgba(249,115,22,0.4)'
        ctx.fillRect(s.paddleX - 3, pY + PADDLE_HEIGHT / 2 + 4, 6, PX)
      }

      ctx.restore()
      effectsRef.current.updateParticles()
      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); rafRef.current = null; ro.disconnect() }
  }, [finishGame, playAudio, bestScore])

  const comboLabel = getComboLabel(score)
  const comboColor = getComboColor(score)

  return (
    <section className="mini-game-panel pong-solo-panel" aria-label="pong-solo-game" style={{
      maxWidth: '432px', margin: '0 auto', width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: '#0a0820',
    }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <div ref={containerRef} style={{ flex: 1, width: '100%', position: 'relative', touchAction: 'none' }}
        onPointerMove={(e) => {
          const c = canvasRef.current; if (!c || stateRef.current.finished) return
          const r = c.getBoundingClientRect(); const rel = (e.clientX - r.left) / r.width; const s = stateRef.current
          s.paddleX = clamp(rel * s.fieldW, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
        }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', imageRendering: 'pixelated' }} />
      </div>
      {comboLabel && (
        <div style={{ position: 'absolute', bottom: '22px', left: '50%', transform: 'translateX(-50%)', color: comboColor, fontSize: '10px', fontWeight: 900, fontFamily: '"Press Start 2P", monospace', textShadow: `0 0 12px ${comboColor}`, pointerEvents: 'none', zIndex: 10 }}>
          {comboLabel}
        </div>
      )}
      {comboDisplay >= 3 && (
        <div style={{ position: 'absolute', top: '8px', left: '50%', transform: 'translateX(-50%)', color: '#fbbf24', fontSize: '9px', fontWeight: 900, fontFamily: '"Press Start 2P", monospace', textShadow: '0 0 8px rgba(251,191,36,0.5)', pointerEvents: 'none', zIndex: 10, animation: 'pulse 0.3s ease-in-out' }}>
          {comboDisplay}x COMBO
        </div>
      )}
    </section>
  )
}

export const pongSoloModule: MiniGameModule = {
  manifest: {
    id: 'pong-solo',
    title: 'Pong Solo',
    description: 'Smash bricks, catch power-ups, survive waves!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#a855f7',
  },
  Component: PongSoloGame,
}
