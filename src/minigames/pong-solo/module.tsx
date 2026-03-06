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
import pongChainSfx from '../../../assets/sounds/pong-chain.mp3'
import pongStarSfx from '../../../assets/sounds/pong-star.mp3'
import pongPerfectSfx from '../../../assets/sounds/pong-perfect.mp3'
import pongSoloBgmLoop from '../../../assets/sounds/generated/pong-solo/pong-solo-bgm-loop.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { getActiveBgmTrack, playBackgroundAudio as playSharedBgm, stopBackgroundAudio as stopSharedBgm } from '../../gui/sound-manager'

// ─── DOT GAME PALETTE (Limited 16-color retro palette) ──────
const PAL = {
  bg: '#0b0b1a',
  bgLight: '#151530',
  white: '#f0f0e8',
  black: '#0b0b1a',
  red: '#e84040',
  orange: '#f09048',
  yellow: '#f8d848',
  green: '#40c848',
  cyan: '#40d8d8',
  blue: '#4888f8',
  purple: '#a858f8',
  pink: '#f858a8',
  gray: '#686878',
  darkGray: '#383848',
  gold: '#f8b830',
  fire: '#f86830',
} as const

// ─── Constants ──────────────────────────────────────────────
const PX = 4 // pixel grid size — bigger = more chunky dot feel

const BALL_RADIUS = 6
const PADDLE_HEIGHT = PX * 3 // 12px
const PADDLE_INITIAL_WIDTH = PX * 22 // 88px
const PADDLE_CORNER_RATIO = 0.25

const INITIAL_BALL_SPEED = 240
const SPEED_INCREASE_FACTOR = 1.03
const MAX_BALL_SPEED = 800

const EDGE_HIT_BONUS = 3
const NORMAL_HIT_SCORE = 1

const GAME_TIMEOUT_MS = 120_000

const PADDLE_SHRINK_INTERVAL = 15
const PADDLE_SHRINK_AMOUNT = PX
const MIN_PADDLE_WIDTH = PX * 8 // 32px

const RALLY_MILESTONES = [10, 25, 50, 100, 200]
const RALLY_MILESTONE_BONUS = 15

const INITIAL_BALL_ANGLE_MIN = Math.PI * 1.2
const INITIAL_BALL_ANGLE_MAX = Math.PI * 1.8

// Power-ups
const POWERUP_DROP_CHANCE = 0.22
const POWERUP_SIZE = PX * 4
const POWERUP_FALL_SPEED = 110
const POWERUP_DURATION_MS = 7000
const POWERUP_TYPES = ['wide-paddle', 'multi-ball', 'slow-motion', 'magnet', 'shield', 'fireball', 'gravity-bomb'] as const
type PowerUpType = typeof POWERUP_TYPES[number]

// Bricks
const BRICK_ROWS = 4
const BRICK_COLS = 7
const BRICK_HEIGHT = PX * 3
const BRICK_GAP = PX
const BRICK_TOP_OFFSET = PX * 2
const BRICK_SCORE = 2
const BRICK_RESPAWN_MS = 14_000

// Score zones
const SCORE_ZONE_COUNT = 3
const SCORE_ZONE_HEIGHT = PX * 12
const SCORE_ZONE_BONUS = 5

// Trail
const TRAIL_LENGTH = 10

// Wave system
const WAVE_INTERVAL_MS = 18_000

// Fever
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_MS = 5000
const FEVER_SCORE_MULTIPLIER = 3

// Dash
const DASH_COOLDOWN_MS = 1200
const DASH_DISTANCE = PX * 20

// Chain Lightning
const CHAIN_CHANCE = 0.3
const CHAIN_MAX_DEPTH = 3

// Star Coins
const STAR_COIN_SCORE = 10
const STAR_COIN_MAX = 3
const STAR_COIN_SPAWN_MS = 8000
const STAR_COIN_RADIUS = PX * 2
const STAR_COIN_LIFETIME_MS = 6000

// Perfect Hit
const PERFECT_HIT_ZONE = 0.1
const PERFECT_HIT_MULTIPLIER = 3

// Gravity Bomb
const GRAVITY_BOMB_DURATION_MS = 2000
const GRAVITY_BOMB_FORCE = 300

// Starfield BG
const STAR_COUNT = 50
const PORTAL_INTERVAL_MS = 14_000
const PORTAL_DURATION_MS = 6500
const PORTAL_RADIUS = PX * 5
const PORTAL_SCORE_BONUS = 12
const PORTAL_SPEED_BOOST = 1.08
const PORTAL_COOLDOWN_MS = 700
const PRISM_INTERVAL_MS = 10_000
const PRISM_DURATION_MS = 7000
const PRISM_RADIUS = PX * 5
const PRISM_SCORE_BONUS = 18
const OVERDRIVE_DURATION_MS = 4500
const OVERDRIVE_MULTIPLIER = 2
const PONG_SOLO_BGM_VOLUME = 0.22

interface Vec2 { x: number; y: number }
interface BallState { x: number; y: number; vx: number; vy: number; speed: number; trail: Vec2[]; isFireball: boolean; spin: number; portalCooldownUntil: number }
interface PowerUp { id: number; type: PowerUpType; x: number; y: number }
interface Brick { row: number; col: number; alive: boolean; hp: number; color: string }
interface PixelParticle { id: number; x: number; y: number; vx: number; vy: number; color: string; life: number; maxLife: number; size: number }
interface FloatingText { id: number; x: number; y: number; text: string; color: string; createdAt: number; size?: number }
interface ChainArc { id: number; x1: number; y1: number; x2: number; y2: number; createdAt: number; color: string }
interface StarCoin { id: number; x: number; y: number; spawnAt: number }
interface BgStar { x: number; y: number; size: number; twinkleSpeed: number; phase: number }
interface PortalPair { a: Vec2; b: Vec2; radius: number; expiresAt: number }
interface PrismCore { x: number; y: number; radius: number; vx: number; vy: number; expiresAt: number; phase: number }
interface Shockwave { id: number; x: number; y: number; color: string; createdAt: number; maxRadius: number; durationMs: number }

const PONG_SOLO_UI_CSS = `
@keyframes pong-score-pop {
  0% { transform: scale(0.9); filter: brightness(1.5); }
  70% { transform: scale(1.08); filter: brightness(1.15); }
  100% { transform: scale(1); filter: brightness(1); }
}

@keyframes pong-combo-float {
  0% { transform: translateX(-50%) translateY(4px); opacity: 0.4; }
  100% { transform: translateX(-50%) translateY(0); opacity: 1; }
}
`

// ─── Helpers ────────────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }
function snap(v: number) { return Math.round(v / PX) * PX }

function createInitialBall(cx: number, cy: number): BallState {
  const angle = INITIAL_BALL_ANGLE_MIN + Math.random() * (INITIAL_BALL_ANGLE_MAX - INITIAL_BALL_ANGLE_MIN)
  return { x: cx, y: cy, vx: Math.cos(angle) * INITIAL_BALL_SPEED, vy: Math.sin(angle) * INITIAL_BALL_SPEED, speed: INITIAL_BALL_SPEED, trail: [], isFireball: false, spin: 0, portalCooldownUntil: 0 }
}

const BRICK_COLORS = [PAL.red, PAL.orange, PAL.yellow, PAL.green, PAL.blue, PAL.purple, PAL.pink, PAL.cyan]

function createBricks(): Brick[] {
  const bricks: Brick[] = []
  for (let r = 0; r < BRICK_ROWS; r++)
    for (let c = 0; c < BRICK_COLS; c++)
      bricks.push({ row: r, col: c, alive: true, hp: r === 0 ? 2 : 1, color: BRICK_COLORS[(r + c) % BRICK_COLORS.length] })
  return bricks
}

function getBrickRect(brick: Brick, fieldW: number) {
  const bw = Math.floor((fieldW - BRICK_GAP * (BRICK_COLS + 1)) / BRICK_COLS / PX) * PX
  return { x: BRICK_GAP + brick.col * (bw + BRICK_GAP), y: BRICK_TOP_OFFSET + brick.row * (BRICK_HEIGHT + BRICK_GAP), w: bw, h: BRICK_HEIGHT }
}

const PU_COLOR: Record<PowerUpType, string> = { 'wide-paddle': PAL.green, 'multi-ball': PAL.purple, 'slow-motion': PAL.blue, 'magnet': PAL.gold, 'shield': PAL.cyan, 'fireball': PAL.red, 'gravity-bomb': PAL.pink }
const PU_LABEL: Record<PowerUpType, string> = { 'wide-paddle': 'WIDE', 'multi-ball': 'MULTI', 'slow-motion': 'SLOW', 'magnet': 'MAGNET', 'shield': 'SHIELD', 'fireball': 'FIRE', 'gravity-bomb': 'GRAV' }

// Dot-style drawing — everything snaps to PX grid
function dotRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color
  ctx.fillRect(snap(x), snap(y), snap(w), snap(h))
}

function dotCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color
  const rPx = Math.max(PX, snap(r))
  for (let dy = -rPx; dy <= rPx; dy += PX) {
    const dx = Math.sqrt(rPx * rPx - dy * dy)
    const sx = snap(cx - dx)
    const ex = snap(cx + dx)
    ctx.fillRect(sx, snap(cy + dy), Math.max(PX, ex - sx), PX)
  }
}

function dotDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string) {
  ctx.fillStyle = color
  const h = snap(size / 2)
  for (let dy = -h; dy <= h; dy += PX) {
    const w = h - Math.abs(dy)
    ctx.fillRect(snap(cx - w), snap(cy + dy), Math.max(PX, snap(w * 2)), PX)
  }
}

function dotStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color
  dotRect(ctx, cx - r, cy - PX, r * 2, PX * 2, color)
  dotRect(ctx, cx - PX, cy - r, PX * 2, r * 2, color)
  const d = Math.round(r * 0.7 / PX) * PX
  dotRect(ctx, cx - d, cy - d, PX * 2, PX * 2, color)
  dotRect(ctx, cx + d - PX, cy - d, PX * 2, PX * 2, color)
  dotRect(ctx, cx - d, cy + d - PX, PX * 2, PX * 2, color)
  dotRect(ctx, cx + d - PX, cy + d - PX, PX * 2, PX * 2, color)
}

// ─── GameState ────────────────────────
interface GameState {
  score: number; finished: boolean; elapsedMs: number; lastFrameAt: number | null
  paddleX: number; paddleWidth: number
  balls: BallState[]; bricks: Brick[]; powerUps: PowerUp[]
  activePowerUps: Record<string, number>
  pixelParticles: PixelParticle[]; floatingTexts: FloatingText[]
  chainArcs: ChainArc[]
  speedLevel: number; rallyCount: number; lastMilestone: number
  brickRespawnTimer: number; waveTimer: number; waveNumber: number
  fieldW: number; fieldH: number
  nextId: number; comboCount: number; lastHitTime: number
  shieldActive: boolean; magnetActive: boolean
  scoreZones: { y: number; side: 'left' | 'right' }[]
  feverMode: boolean; feverEndTime: number
  lastDashTime: number
  screenShakeAmount: number
  bricksDestroyed: number; totalBounces: number
  starCoins: StarCoin[]; starCoinTimer: number
  gravBombActive: boolean; gravBombEndTime: number; gravBombX: number; gravBombY: number
  bgStars: BgStar[]
  perfectStreak: number
  portalPair: PortalPair | null; portalTimer: number
  prismCore: PrismCore | null; prismTimer: number
  shockwaves: Shockwave[]
  overdriveEndTime: number
  bannerText: string; bannerColor: string; bannerUntil: number
}

function initState(): GameState {
  return {
    score: 0, finished: false, elapsedMs: 0, lastFrameAt: null,
    paddleX: 0, paddleWidth: PADDLE_INITIAL_WIDTH,
    balls: [], bricks: [], powerUps: [],
    activePowerUps: {},
    pixelParticles: [], floatingTexts: [],
    chainArcs: [],
    speedLevel: 1, rallyCount: 0, lastMilestone: 0,
    brickRespawnTimer: 0, waveTimer: 0, waveNumber: 0,
    fieldW: 320, fieldH: 560,
    nextId: 0, comboCount: 0, lastHitTime: 0,
    shieldActive: false, magnetActive: false,
    scoreZones: [],
    feverMode: false, feverEndTime: 0,
    lastDashTime: 0,
    screenShakeAmount: 0,
    bricksDestroyed: 0, totalBounces: 0,
    starCoins: [], starCoinTimer: 0,
    gravBombActive: false, gravBombEndTime: 0, gravBombX: 0, gravBombY: 0,
    bgStars: [],
    perfectStreak: 0,
    portalPair: null, portalTimer: 0,
    prismCore: null, prismTimer: 0,
    shockwaves: [],
    overdriveEndTime: 0,
    bannerText: '', bannerColor: PAL.white, bannerUntil: 0,
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

  const ensureBgm = useCallback(() => {
    playSharedBgm(pongSoloBgmLoop, PONG_SOLO_BGM_VOLUME)
  }, [])

  const finishGame = useCallback(() => {
    const s = stateRef.current
    if (s.finished) return
    s.finished = true
    if (getActiveBgmTrack() === pongSoloBgmLoop) stopSharedBgm()
    playAudio('gameOver', 0.6)
    s.screenShakeAmount = 18
    effectsRef.current.triggerFlash('rgba(239,68,68,0.6)')
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
      chain: pongChainSfx, star: pongStarSfx, perfect: pongPerfectSfx,
      gameOver: gameOverHitSfx,
    }
    for (const [k, src] of Object.entries(srcs)) { const a = new Audio(src); a.preload = 'auto'; audioRefs.current[k] = a }
    return () => { for (const a of Object.values(audioRefs.current)) { if (a) { a.pause(); a.currentTime = 0 } }; audioRefs.current = {} }
  }, [])

  useEffect(() => {
    ensureBgm()
    const activateAudio = () => ensureBgm()
    window.addEventListener('pointerdown', activateAudio, true)
    window.addEventListener('keydown', activateAudio, true)
    return () => {
      window.removeEventListener('pointerdown', activateAudio, true)
      window.removeEventListener('keydown', activateAudio, true)
      if (getActiveBgmTrack() === pongSoloBgmLoop) stopSharedBgm()
    }
  }, [ensureBgm])

  // Input
  useEffect(() => {
    let lastTapTime = 0; let lastTapX = 0

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
      s.lastDashTime = now; playAudio('dash', 0.4)
      for (let i = 0; i < 8; i++) {
        s.pixelParticles.push({
          id: s.nextId++, x: s.paddleX + (Math.random() - 0.5) * s.paddleWidth,
          y: s.fieldH - 30, vx: -dir * (40 + Math.random() * 60), vy: -(10 + Math.random() * 30),
          color: PAL.orange, life: 350, maxLife: 350, size: PX,
        })
      }
    }

    const onPointerDown = (e: PointerEvent) => {
      const now = performance.now()
      if (now - lastTapTime < 300 && Math.abs(e.clientX - lastTapX) < 80) tryDash(e.clientX)
      lastTapTime = now; lastTapX = e.clientX; updatePaddle(e.clientX)
    }
    const onP = (e: PointerEvent) => updatePaddle(e.clientX)
    const onT = (e: TouchEvent) => { if (e.touches.length > 0) updatePaddle(e.touches[0].clientX) }
    const onK = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      const s = stateRef.current; if (s.finished) return
      const step = PX * 7
      if (e.code === 'ArrowLeft') s.paddleX = clamp(s.paddleX - step, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
      if (e.code === 'ArrowRight') s.paddleX = clamp(s.paddleX + step, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
      if (e.shiftKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
        const dir = e.code === 'ArrowLeft' ? -1 : 1
        const now = performance.now()
        if (now - s.lastDashTime >= DASH_COOLDOWN_MS) {
          s.paddleX = clamp(s.paddleX + dir * DASH_DISTANCE, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
          s.lastDashTime = now; playAudio('dash', 0.4)
        }
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onP)
    window.addEventListener('touchmove', onT, { passive: true })
    window.addEventListener('keydown', onK)
    return () => { window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('pointermove', onP); window.removeEventListener('touchmove', onT); window.removeEventListener('keydown', onK) }
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
      y: snap(80 + i * 120 + Math.random() * 40),
      side: i % 2 === 0 ? 'left' as const : 'right' as const,
    }))
    s.bgStars = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random(), y: Math.random(),
      size: Math.random() > 0.7 ? PX * 2 : PX,
      twinkleSpeed: 0.002 + Math.random() * 0.004,
      phase: Math.random() * Math.PI * 2,
    }))

    const ctx = canvas.getContext('2d')!
    const dpr = devicePixelRatio
    const nid = () => s.nextId++

    const addFloat = (x: number, y: number, text: string, color: string, now: number, size?: number) => {
      s.floatingTexts.push({ id: nid(), x, y, text, color, createdAt: now, size })
    }

    const spawnPx = (x: number, y: number, color: string, count: number, speed = 80) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const spd = speed * (0.3 + Math.random() * 0.7)
        s.pixelParticles.push({ id: nid(), x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd, color, life: 300 + Math.random() * 400, maxLife: 700, size: PX })
      }
    }

    const pushShockwave = (x: number, y: number, color: string, createdAt: number, maxRadius = PX * 14, durationMs = 560) => {
      s.shockwaves.push({ id: nid(), x, y, color, createdAt, maxRadius, durationMs })
    }

    const shake = (amt: number) => { s.screenShakeAmount = Math.max(s.screenShakeAmount, amt) }
    const showBanner = (text: string, color: string, now: number, durationMs = 1400) => {
      s.bannerText = text
      s.bannerColor = color
      s.bannerUntil = now + durationMs
    }

    const chainLightning = (bx: number, by: number, depth: number, now: number) => {
      if (depth >= CHAIN_MAX_DEPTH) return
      const nearby = s.bricks.filter(b => {
        if (!b.alive) return false
        const r = getBrickRect(b, s.fieldW)
        return Math.hypot(r.x + r.w / 2 - bx, r.y + r.h / 2 - by) < 60
      })
      if (nearby.length === 0) return
      const target = nearby[Math.floor(Math.random() * nearby.length)]
      const tr = getBrickRect(target, s.fieldW)
      const tx = tr.x + tr.w / 2; const ty = tr.y + tr.h / 2
      const bonusMul = (s.feverMode ? FEVER_SCORE_MULTIPLIER : 1) * (s.overdriveEndTime > now ? OVERDRIVE_MULTIPLIER : 1)
      s.chainArcs.push({ id: nid(), x1: bx, y1: by, x2: tx, y2: ty, createdAt: now, color: PAL.cyan })
      target.hp = 0; target.alive = false; s.bricksDestroyed++
      s.score += BRICK_SCORE * bonusMul; setScore(s.score)
      spawnPx(tx, ty, PAL.cyan, 8, 100)
      pushShockwave(tx, ty, 'rgba(64,216,216,0.9)', now, PX * 8, 420)
      playAudio('chain', 0.35, 1 + depth * 0.15)
      chainLightning(tx, ty, depth + 1, now)
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
      if (s.feverMode && now > s.feverEndTime) s.feverMode = false
      if (s.gravBombActive && now > s.gravBombEndTime) s.gravBombActive = false
      if (s.bannerUntil <= now) s.bannerText = ''
      if (s.portalPair && now > s.portalPair.expiresAt) s.portalPair = null
      if (s.prismCore && now > s.prismCore.expiresAt) s.prismCore = null
      if (s.screenShakeAmount > 0) { s.screenShakeAmount *= 0.85; if (s.screenShakeAmount < 0.5) s.screenShakeAmount = 0 }

      const basePW = Math.max(MIN_PADDLE_WIDTH, PADDLE_INITIAL_WIDTH - Math.floor(s.rallyCount / PADDLE_SHRINK_INTERVAL) * PADDLE_SHRINK_AMOUNT)
      const isWide = s.activePowerUps['wide-paddle'] != null && s.activePowerUps['wide-paddle'] > now
      s.paddleWidth = isWide ? Math.min(basePW * 1.6, s.fieldW * 0.5) : basePW
      const paddleY = s.fieldH - PX * 7
      const W = s.fieldW; const H = s.fieldH
      const overdriveActive = s.overdriveEndTime > now
      const scoreMul = (s.feverMode ? FEVER_SCORE_MULTIPLIER : 1) * (overdriveActive ? OVERDRIVE_MULTIPLIER : 1)

      // Portal gates + prism core gimmicks
      const gimmickTop = BRICK_TOP_OFFSET + (BRICK_ROWS + Math.min(s.waveNumber, 2)) * (BRICK_HEIGHT + BRICK_GAP) + PX * 8
      const gimmickBottom = paddleY - PX * 12

      s.portalTimer += rawDt
      if (!s.portalPair && s.portalTimer >= PORTAL_INTERVAL_MS && gimmickBottom - gimmickTop > PX * 10) {
        s.portalTimer = 0
        const laneSpan = Math.max(PX * 16, gimmickBottom - gimmickTop)
        const leftX = snap(PX * 10 + Math.random() * Math.max(PX * 8, W * 0.24))
        const rightX = snap(W - PX * 10 - Math.random() * Math.max(PX * 8, W * 0.24))
        const y1 = snap(gimmickTop + Math.random() * laneSpan)
        const y2Base = snap(gimmickTop + Math.random() * laneSpan)
        const y2 = Math.abs(y1 - y2Base) < PX * 8 ? clamp(y2Base + PX * 10, gimmickTop, gimmickBottom) : y2Base
        s.portalPair = {
          a: { x: clamp(leftX, PX * 8, W - PX * 8), y: clamp(y1, gimmickTop, gimmickBottom) },
          b: { x: clamp(rightX, PX * 8, W - PX * 8), y: clamp(y2, gimmickTop, gimmickBottom) },
          radius: PORTAL_RADIUS,
          expiresAt: now + PORTAL_DURATION_MS,
        }
        addFloat(W / 2, H * 0.26, 'WARP GATES', PAL.cyan, now, 12)
        showBanner('WARP GATES OPEN', PAL.cyan, now, 1600)
        playAudio('wave', 0.42, 1.08)
        pushShockwave(W / 2, H * 0.3, 'rgba(64,216,216,0.85)', now, PX * 18, 640)
      }

      s.prismTimer += rawDt
      if (!s.prismCore && s.prismTimer >= PRISM_INTERVAL_MS && gimmickBottom - gimmickTop > PX * 10) {
        s.prismTimer = 0
        s.prismCore = {
          x: snap(PX * 12 + Math.random() * (W - PX * 24)),
          y: snap(gimmickTop + Math.random() * Math.max(PX * 10, gimmickBottom - gimmickTop)),
          radius: PRISM_RADIUS,
          vx: (Math.random() > 0.5 ? 1 : -1) * (48 + Math.random() * 36),
          vy: (Math.random() > 0.5 ? 1 : -1) * (22 + Math.random() * 28),
          expiresAt: now + PRISM_DURATION_MS,
          phase: Math.random() * Math.PI * 2,
        }
        addFloat(W / 2, H * 0.22, 'PRISM CORE', PAL.gold, now, 12)
        showBanner('PRISM CORE ONLINE', PAL.gold, now, 1400)
        playAudio('star', 0.4, 1.06)
      }

      if (s.prismCore) {
        const core = s.prismCore
        core.x += core.vx * scaledDt
        core.y += core.vy * scaledDt
        if (core.x - core.radius <= PX * 6 || core.x + core.radius >= W - PX * 6) core.vx *= -1
        if (core.y - core.radius <= gimmickTop || core.y + core.radius >= gimmickBottom) core.vy *= -1
        core.x = clamp(core.x, PX * 6 + core.radius, W - PX * 6 - core.radius)
        core.y = clamp(core.y, gimmickTop + core.radius, gimmickBottom - core.radius)
      }

      // Star coins spawning
      s.starCoinTimer += rawDt
      if (s.starCoinTimer >= STAR_COIN_SPAWN_MS && s.starCoins.length < STAR_COIN_MAX) {
        s.starCoinTimer = 0
        const brickAreaBottom = BRICK_TOP_OFFSET + (BRICK_ROWS + s.waveNumber) * (BRICK_HEIGHT + BRICK_GAP) + PX * 4
        s.starCoins.push({ id: nid(), x: snap(PX * 8 + Math.random() * (W - PX * 16)), y: snap(brickAreaBottom + Math.random() * (paddleY - brickAreaBottom - PX * 10)), spawnAt: now })
      }
      s.starCoins = s.starCoins.filter(sc => now - sc.spawnAt < STAR_COIN_LIFETIME_MS)

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
        for (let c = 0; c < BRICK_COLS; c++) {
          s.bricks.push({ row: (s.waveNumber + BRICK_ROWS) % 6, col: c, alive: true, hp: Math.min(3, 1 + Math.floor(s.waveNumber / 2)), color: BRICK_COLORS[(s.waveNumber + c) % BRICK_COLORS.length] })
        }
        addFloat(W / 2, H * 0.3, `WAVE ${s.waveNumber}!`, PAL.gold, now, 14)
        playAudio('wave', 0.5); shake(5)
      }

      // Gravity bomb pull
      if (s.gravBombActive) {
        for (const ball of s.balls) {
          const dx = s.gravBombX - ball.x; const dy = s.gravBombY - ball.y
          const dist = Math.max(20, Math.hypot(dx, dy))
          ball.vx += (dx / dist) * GRAVITY_BOMB_FORCE / dist * scaledDt
          ball.vy += (dy / dist) * GRAVITY_BOMB_FORCE / dist * scaledDt
        }
      }

      // ── Update balls ──
      const newBalls: BallState[] = []
      for (const ball of s.balls) {
        let nx = ball.x + ball.vx * scaledDt
        let ny = ball.y + ball.vy * scaledDt
        let nvx = ball.vx; let nvy = ball.vy; let nspeed = ball.speed
        let spin = ball.spin * 0.99
        let portalCooldownUntil = ball.portalCooldownUntil

        if (s.magnetActive && nvy > 0) { nvx += (s.paddleX - nx) * 2.5 * scaledDt }
        if (Math.abs(spin) > 0.1) { nvx += spin * 50 * scaledDt }

        // Walls
        if (nx - BALL_RADIUS <= 0) { nx = BALL_RADIUS; nvx = Math.abs(nvx); playAudio('wallBounce', 0.2); s.totalBounces++; spawnPx(PX, ny, PAL.purple, 3, 40) }
        if (nx + BALL_RADIUS >= W) { nx = W - BALL_RADIUS; nvx = -Math.abs(nvx); playAudio('wallBounce', 0.2); s.totalBounces++; spawnPx(W - PX, ny, PAL.purple, 3, 40) }
        if (ny - BALL_RADIUS <= 0) { ny = BALL_RADIUS; nvy = Math.abs(nvy); playAudio('wallBounce', 0.2); s.totalBounces++; spawnPx(nx, PX, PAL.purple, 3, 40) }

        // Score zones
        for (const zone of s.scoreZones) {
          const hitWall = (zone.side === 'left' && nx - BALL_RADIUS <= PX) || (zone.side === 'right' && nx + BALL_RADIUS >= W - PX)
          if (hitWall && ny >= zone.y && ny <= zone.y + SCORE_ZONE_HEIGHT) {
            s.score += SCORE_ZONE_BONUS * scoreMul; setScore(s.score)
            addFloat(zone.side === 'left' ? PX * 8 : W - PX * 8, ny, `+${SCORE_ZONE_BONUS * scoreMul}`, PAL.green, now)
            spawnPx(zone.side === 'left' ? PX : W - PX, ny, PAL.green, 5)
          }
        }

        // Portal gates
        if (s.portalPair && now >= portalCooldownUntil) {
          const gateAHit = Math.hypot(nx - s.portalPair.a.x, ny - s.portalPair.a.y) <= s.portalPair.radius + BALL_RADIUS
          const gateBHit = Math.hypot(nx - s.portalPair.b.x, ny - s.portalPair.b.y) <= s.portalPair.radius + BALL_RADIUS
          if (gateAHit || gateBHit) {
            const fromGate = gateAHit ? s.portalPair.a : s.portalPair.b
            const toGate = gateAHit ? s.portalPair.b : s.portalPair.a
            const dirX = nvx === 0 ? 0 : nvx / Math.abs(nvx)
            const dirY = nvy === 0 ? -1 : nvy / Math.abs(nvy)
            const boosted = Math.min(MAX_BALL_SPEED, nspeed * PORTAL_SPEED_BOOST)
            const mag = Math.max(1, Math.hypot(nvx, nvy))
            nspeed = boosted
            nvx = (nvx / mag) * boosted
            nvy = (nvy / mag) * boosted
            nx = clamp(toGate.x + dirX * (PORTAL_RADIUS + PX * 2), BALL_RADIUS + PX, W - BALL_RADIUS - PX)
            ny = clamp(toGate.y + dirY * (PORTAL_RADIUS + PX * 2), BALL_RADIUS + PX, H - BALL_RADIUS - PX * 4)
            portalCooldownUntil = now + PORTAL_COOLDOWN_MS
            s.score += PORTAL_SCORE_BONUS * scoreMul; setScore(s.score)
            addFloat(toGate.x, toGate.y - PX * 6, `WARP +${PORTAL_SCORE_BONUS * scoreMul}`, PAL.cyan, now, 10)
            spawnPx(fromGate.x, fromGate.y, PAL.cyan, 10, 150)
            spawnPx(toGate.x, toGate.y, PAL.blue, 14, 180)
            pushShockwave(fromGate.x, fromGate.y, 'rgba(64,216,216,0.9)', now, PX * 10, 420)
            pushShockwave(toGate.x, toGate.y, 'rgba(72,136,248,0.9)', now, PX * 14, 520)
            effectsRef.current.triggerFlash('rgba(64,216,216,0.16)', 110)
            playAudio('chain', 0.4, 1.1)
            shake(6)
            showBanner('WARP BONUS', PAL.cyan, now, 900)
          }
        }

        // Star coin collection
        for (let sci = s.starCoins.length - 1; sci >= 0; sci--) {
          const sc = s.starCoins[sci]
          if (Math.hypot(nx - sc.x, ny - sc.y) < STAR_COIN_RADIUS + BALL_RADIUS + PX) {
            s.score += STAR_COIN_SCORE * scoreMul; setScore(s.score)
            addFloat(sc.x, sc.y - PX * 4, `+${STAR_COIN_SCORE * scoreMul}`, PAL.gold, now, 12)
            spawnPx(sc.x, sc.y, PAL.gold, 10, 100)
            playAudio('star', 0.5, 1.2); shake(3)
            s.starCoins.splice(sci, 1)
          }
        }

        // Prism core
        if (s.prismCore && Math.hypot(nx - s.prismCore.x, ny - s.prismCore.y) <= s.prismCore.radius + BALL_RADIUS + PX) {
          const dx = nx - s.prismCore.x
          const dy = ny - s.prismCore.y
          const dist = Math.max(1, Math.hypot(dx, dy))
          const normalX = dx / dist
          const normalY = dy / dist
          const dot = nvx * normalX + nvy * normalY
          nvx -= 2 * dot * normalX
          nvy -= 2 * dot * normalY
          nspeed = Math.min(MAX_BALL_SPEED, nspeed * 1.06)
          const mag = Math.max(1, Math.hypot(nvx, nvy))
          nvx = (nvx / mag) * nspeed
          nvy = (nvy / mag) * nspeed
          s.score += PRISM_SCORE_BONUS * scoreMul; setScore(s.score)
          s.overdriveEndTime = now + OVERDRIVE_DURATION_MS
          addFloat(s.prismCore.x, s.prismCore.y - PX * 6, `PRISM +${PRISM_SCORE_BONUS * scoreMul}`, PAL.gold, now, 11)
          addFloat(W / 2, H * 0.34, 'OVERDRIVE x2', PAL.gold, now, 14)
          spawnPx(s.prismCore.x, s.prismCore.y, PAL.gold, 18, 180)
          spawnPx(s.prismCore.x, s.prismCore.y, PAL.pink, 12, 130)
          pushShockwave(s.prismCore.x, s.prismCore.y, 'rgba(248,184,48,0.95)', now, PX * 18, 640)
          effectsRef.current.triggerFlash('rgba(248,184,48,0.24)', 160)
          playAudio('milestone', 0.6, 1.18)
          shake(8)
          showBanner('OVERDRIVE x2', PAL.gold, now, 1800)
          s.prismCore = null
        }

        // Bricks
        for (const brick of s.bricks) {
          if (!brick.alive) continue
          const br = getBrickRect(brick, W)
          if (nx + BALL_RADIUS > br.x && nx - BALL_RADIUS < br.x + br.w && ny + BALL_RADIUS > br.y && ny - BALL_RADIUS < br.y + br.h) {
            if (!ball.isFireball) brick.hp--; else brick.hp = 0
            if (brick.hp <= 0) {
              brick.alive = false; s.bricksDestroyed++
              s.score += BRICK_SCORE * scoreMul; setScore(s.score)
              spawnPx(br.x + br.w / 2, br.y + br.h / 2, brick.color, 14, 150)
              pushShockwave(br.x + br.w / 2, br.y + br.h / 2, brick.color, now, PX * 6, 320)
              playAudio('brickBreak', 0.4, 0.9 + Math.random() * 0.3); shake(2)
              if (Math.random() < CHAIN_CHANCE) chainLightning(br.x + br.w / 2, br.y + br.h / 2, 0, now)
              if (Math.random() < POWERUP_DROP_CHANCE) {
                const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
                s.powerUps.push({ id: nid(), type, x: br.x + br.w / 2, y: br.y + br.h })
              }
            } else {
              addFloat(br.x + br.w / 2, br.y, 'CRACK', PAL.yellow, now)
              spawnPx(br.x + br.w / 2, br.y + br.h / 2, PAL.yellow, 4, 50)
            }
            if (!ball.isFireball) {
              const oL = (nx + BALL_RADIUS) - br.x; const oR = (br.x + br.w) - (nx - BALL_RADIUS)
              const oT = (ny + BALL_RADIUS) - br.y; const oB = (br.y + br.h) - (ny - BALL_RADIUS)
              const mn = Math.min(oL, oR, oT, oB)
              if (mn === oT || mn === oB) nvy = -nvy; else nvx = -nvx
              break
            }
          }
        }

        // Paddle
        const pLeft = s.paddleX - s.paddleWidth / 2; const pRight = s.paddleX + s.paddleWidth / 2
        const pTop = paddleY - PADDLE_HEIGHT / 2

        if (nvy > 0 && ny + BALL_RADIUS >= pTop && ball.y + BALL_RADIUS <= pTop + PX * 3 && nx + BALL_RADIUS >= pLeft && nx - BALL_RADIUS <= pRight) {
          ny = pTop - BALL_RADIUS
          const hitPos = clamp((nx - s.paddleX) / (s.paddleWidth / 2), -1, 1)
          const isEdge = Math.abs(hitPos) > (1 - PADDLE_CORNER_RATIO)
          const isPerfect = Math.abs(hitPos) < PERFECT_HIT_ZONE
          const maxA = Math.PI * 0.38; const ang = -Math.PI / 2 + hitPos * maxA
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

          // Perfect hit
          let hitScore = isEdge ? NORMAL_HIT_SCORE + EDGE_HIT_BONUS : NORMAL_HIT_SCORE
          if (isPerfect) {
            hitScore *= PERFECT_HIT_MULTIPLIER; s.perfectStreak++
            addFloat(nx, pTop - PX * 6, s.perfectStreak >= 3 ? `PERFECT x${s.perfectStreak}!` : 'PERFECT!', PAL.gold, now, 12)
            spawnPx(nx, pTop, PAL.gold, 16, 130)
            pushShockwave(nx, pTop, 'rgba(248,184,48,0.95)', now, PX * 10, 420)
            playAudio('perfect', 0.5, 1 + s.perfectStreak * 0.05); shake(4)
            if (s.perfectStreak >= 3) {
              s.score += s.perfectStreak * 5 * scoreMul; setScore(s.score)
              effectsRef.current.triggerFlash('rgba(248,184,48,0.25)', 120)
            }
          } else { s.perfectStreak = 0 }

          const added = hitScore * scoreMul; s.score += added; setScore(s.score)

          // Combo
          if (now - s.lastHitTime < 2500) {
            s.comboCount++
            if (s.comboCount >= 3) setComboDisplay(s.comboCount)
            if (s.comboCount >= FEVER_COMBO_THRESHOLD && !s.feverMode) {
              s.feverMode = true; s.feverEndTime = now + FEVER_DURATION_MS
              addFloat(W / 2, H * 0.35, 'FEVER!', PAL.fire, now, 16)
              shake(10); effectsRef.current.triggerFlash('rgba(248,104,48,0.3)', 200)
              playAudio('combo', 0.7, 1.3); spawnPx(W / 2, H / 2, PAL.fire, 30, 190)
              pushShockwave(W / 2, H / 2, 'rgba(248,104,48,0.95)', now, PX * 18, 620)
            }
            if (s.comboCount >= 5 && s.comboCount % 5 === 0) {
              const bonus = s.comboCount * 2 * scoreMul; s.score += bonus; setScore(s.score)
              playAudio('combo', 0.5, 1 + s.comboCount * 0.02)
              addFloat(W / 2, H * 0.4, `${s.comboCount}x +${bonus}`, PAL.yellow, now, 13)
              effectsRef.current.triggerFlash('rgba(248,216,72,0.2)', 100); spawnPx(W / 2, H * 0.4, PAL.yellow, 12, 120)
            }
          } else { s.comboCount = 1; setComboDisplay(0) }
          s.lastHitTime = now

          if (isEdge) {
            playAudio('paddleHit', 0.55, 1.1 + s.rallyCount * 0.003)
            spawnPx(nx, pTop, PAL.orange, 8, 90); shake(3)
            addFloat(nx, pTop - PX * 4, `EDGE +${added}`, PAL.red, now, 10)
          } else if (!isPerfect) {
            playAudio('paddleHit', 0.4, 1.0 + s.rallyCount * 0.002); spawnPx(nx, pTop, PAL.purple, 3, 40)
          }

          // Milestones
          for (const m of RALLY_MILESTONES) {
            if (s.rallyCount >= m && s.lastMilestone < m) {
              s.lastMilestone = m; s.score += RALLY_MILESTONE_BONUS * scoreMul; setScore(s.score)
              playAudio('milestone', 0.6); addFloat(W / 2, H * 0.35, `${m} RALLIES! +${RALLY_MILESTONE_BONUS * scoreMul}`, PAL.purple, now, 14)
              shake(7); effectsRef.current.triggerFlash('rgba(168,88,248,0.2)', 150); spawnPx(W / 2, H * 0.35, PAL.purple, 22, 170)
              pushShockwave(W / 2, H * 0.35, 'rgba(168,88,248,0.95)', now, PX * 16, 560)
              break
            }
          }
          s.speedLevel = Math.max(1, Math.round(Math.log(nspeed / INITIAL_BALL_SPEED) / Math.log(SPEED_INCREASE_FACTOR)) + 1)
          if (s.speedLevel > 1 && s.speedLevel % 5 === 0) playAudio('speedUp', 0.3)
        }

        // Out of bounds
        if (ny - BALL_RADIUS > H) {
          if (s.shieldActive) {
            ny = H - BALL_RADIUS - PX; nvy = -Math.abs(nvy) * 0.8
            s.activePowerUps['shield'] = 0; s.shieldActive = false
            addFloat(W / 2, H - PX * 15, 'SHIELD!', PAL.cyan, now, 13)
            spawnPx(nx, H - PX * 2, PAL.cyan, 16, 140); playAudio('shield', 0.5); shake(5)
            pushShockwave(nx, H - PX * 2, 'rgba(64,216,216,0.95)', now, PX * 12, 460)
          } else if (s.balls.length <= 1) {
            playAudio('ballLost', 0.5); finishGame(); return
          } else { playAudio('ballLost', 0.3); continue }
        }

        const trail = [...ball.trail, { x: nx, y: ny }].slice(-TRAIL_LENGTH)
        newBalls.push({ x: nx, y: ny, vx: nvx, vy: nvy, speed: nspeed, trail, isFireball: ball.isFireball, spin, portalCooldownUntil })
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
          addFloat(pu.x, pu.y - PX * 5, PU_LABEL[pu.type], PU_COLOR[pu.type], now, 11)
          spawnPx(pu.x, pu.y, PU_COLOR[pu.type], 10, 70)
          if (pu.type === 'multi-ball' && s.balls.length < 6) {
            const base = s.balls[0]
            if (base) {
              for (let i = 0; i < 2; i++) {
                const sp = (i === 0 ? -1 : 1) * (0.4 + Math.random() * 0.3)
                s.balls.push({ x: base.x, y: base.y, vx: base.vx * sp - base.vy * 0.5, vy: base.vy * 0.9, speed: base.speed * 0.9, trail: [], isFireball: false, spin: 0, portalCooldownUntil: 0 })
              }
            }
          }
          if (pu.type === 'fireball') {
            for (const b of s.balls) b.isFireball = true
            addFloat(W / 2, H * 0.4, 'FIREBALL!', PAL.red, now, 15); shake(5)
          }
          if (pu.type === 'gravity-bomb') {
            s.gravBombActive = true; s.gravBombEndTime = now + GRAVITY_BOMB_DURATION_MS
            s.gravBombX = pu.x; s.gravBombY = H * 0.4
            addFloat(pu.x, pu.y - PX * 5, 'GRAVITY!', PAL.pink, now, 13); shake(6)
            spawnPx(pu.x, H * 0.4, PAL.pink, 15, 90)
          }
          return false
        }
        return pu.y < H + POWERUP_SIZE
      })

      // Particle update
      s.pixelParticles = s.pixelParticles.filter(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 100 * dt; p.life -= rawDt; return p.life > 0 })
      if (s.pixelParticles.length > 220) s.pixelParticles = s.pixelParticles.slice(-180)

      s.shockwaves = s.shockwaves.filter(sw => now - sw.createdAt < sw.durationMs)
      s.chainArcs = s.chainArcs.filter(a => now - a.createdAt < 400)
      s.floatingTexts = s.floatingTexts.filter(t => now - t.createdAt < 1000)
      if (s.activePowerUps['fireball'] != null && s.activePowerUps['fireball'] <= now) { for (const b of s.balls) b.isFireball = false }

      // ══════════════════ RENDER ══════════════════
      ctx.save(); ctx.scale(dpr, dpr)
      if (s.screenShakeAmount > 0) ctx.translate((Math.random() - 0.5) * s.screenShakeAmount * 2, (Math.random() - 0.5) * s.screenShakeAmount * 2)

      // BG
      const bgGradient = ctx.createLinearGradient(0, 0, W, H)
      if (overdriveActive) {
        bgGradient.addColorStop(0, '#160a26')
        bgGradient.addColorStop(0.45, '#0b122c')
        bgGradient.addColorStop(1, '#09060f')
      } else if (s.feverMode) {
        bgGradient.addColorStop(0, '#220f17')
        bgGradient.addColorStop(0.45, '#150c21')
        bgGradient.addColorStop(1, '#09060f')
      } else {
        bgGradient.addColorStop(0, PAL.bgLight)
        bgGradient.addColorStop(0.45, '#11112a')
        bgGradient.addColorStop(1, PAL.bg)
      }
      ctx.fillStyle = bgGradient; ctx.fillRect(-8, -8, W + 16, H + 16)

      // Starfield
      for (const star of s.bgStars) {
        const tw = 0.3 + 0.7 * Math.abs(Math.sin(now * star.twinkleSpeed + star.phase))
        ctx.fillStyle = `rgba(240,240,232,${tw * 0.45})`
        ctx.fillRect(snap(star.x * W), snap(star.y * H), star.size, star.size)
      }

      for (let band = 0; band < 3; band++) {
        const bandY = ((now * (0.015 + band * 0.002)) + band * PX * 18) % (H + PX * 16) - PX * 8
        const bandAlpha = overdriveActive ? 0.12 : s.feverMode ? 0.08 : 0.05
        ctx.fillStyle = band % 2 === 0 ? `rgba(72,136,248,${bandAlpha})` : `rgba(168,88,248,${bandAlpha})`
        ctx.fillRect(0, snap(bandY), W, PX * (band + 4))
      }

      // Checkerboard
      ctx.fillStyle = 'rgba(40,30,80,0.06)'
      for (let gx = 0; gx < W; gx += PX * 4) for (let gy = 0; gy < H; gy += PX * 4) {
        if (((gx / (PX * 4)) + (gy / (PX * 4))) % 2 === 0) ctx.fillRect(gx, gy, PX * 4, PX * 4)
      }

      // CRT scanlines
      ctx.fillStyle = 'rgba(0,0,0,0.05)'
      for (let sy = 0; sy < H; sy += PX) ctx.fillRect(0, sy, W, 1)

      // Fever overlay
      if (s.feverMode) {
        ctx.fillStyle = `rgba(248,104,48,${0.05 + 0.04 * Math.sin(now * 0.008)})`; ctx.fillRect(0, 0, W, H)
        ctx.strokeStyle = `rgba(248,104,48,${0.3 + 0.2 * Math.sin(now * 0.01)})`; ctx.lineWidth = PX; ctx.strokeRect(PX, PX, W - PX * 2, H - PX * 2)
      }
      if (overdriveActive) {
        ctx.fillStyle = `rgba(248,184,48,${0.06 + 0.03 * Math.sin(now * 0.012)})`
        ctx.fillRect(0, 0, W, H)
        for (let sx = 0; sx < W; sx += PX * 5) {
          ctx.fillStyle = `rgba(248,184,48,${0.12 + 0.05 * Math.sin(now * 0.01 + sx)})`
          ctx.fillRect(sx, 0, PX, H)
        }
      }

      // Gravity bomb vortex
      if (s.gravBombActive) {
        const ga = (now * 0.005) % (Math.PI * 2)
        for (let i = 0; i < 8; i++) {
          const a = ga + (i / 8) * Math.PI * 2; const r = PX * 8 + PX * 4 * Math.sin(now * 0.003 + i)
          ctx.fillStyle = `rgba(248,88,168,${0.3 + 0.2 * Math.sin(now * 0.006 + i)})`
          ctx.fillRect(snap(s.gravBombX + Math.cos(a) * r), snap(s.gravBombY + Math.sin(a) * r), PX * 2, PX * 2)
        }
        dotCircle(ctx, s.gravBombX, s.gravBombY, PX * 3, 'rgba(248,88,168,0.3)')
      }

      // Speed lines
      const mainBall = s.balls[0]
      if (mainBall && mainBall.speed > INITIAL_BALL_SPEED * 1.3) {
        const si = clamp((mainBall.speed - INITIAL_BALL_SPEED * 1.3) / (MAX_BALL_SPEED - INITIAL_BALL_SPEED * 1.3), 0, 1)
        ctx.fillStyle = overdriveActive ? `rgba(248,184,48,${0.14 * si})` : `rgba(168,88,248,${0.12 * si})`
        for (let i = 0; i < 14; i++) ctx.fillRect(snap(Math.random() * W), snap(Math.random() * H), PX, snap(16 + Math.random() * 32))
      }

      // Portal gates
      if (s.portalPair) {
        const gates = [
          { ...s.portalPair.a, color: 'rgba(64,216,216,0.95)', core: PAL.cyan },
          { ...s.portalPair.b, color: 'rgba(72,136,248,0.95)', core: PAL.blue },
        ]
        for (const [index, gate] of gates.entries()) {
          const pulse = 1 + 0.12 * Math.sin(now * 0.01 + index)
          ctx.save()
          ctx.globalAlpha = 0.22 + 0.1 * Math.sin(now * 0.012 + index)
          dotCircle(ctx, gate.x, gate.y, s.portalPair.radius * 1.6 * pulse, gate.color)
          ctx.globalAlpha = 1
          ctx.strokeStyle = gate.color
          ctx.lineWidth = PX
          ctx.beginPath()
          ctx.arc(gate.x, gate.y, s.portalPair.radius * pulse, 0, Math.PI * 2)
          ctx.stroke()
          ctx.beginPath()
          ctx.arc(gate.x, gate.y, s.portalPair.radius * 0.62 * pulse, 0, Math.PI * 2)
          ctx.stroke()
          for (let i = 0; i < 8; i++) {
            const angle = now * 0.006 + index + (i / 8) * Math.PI * 2
            ctx.fillStyle = gate.core
            ctx.fillRect(
              snap(gate.x + Math.cos(angle) * s.portalPair.radius * 1.15),
              snap(gate.y + Math.sin(angle) * s.portalPair.radius * 1.15),
              PX * 2,
              PX * 2,
            )
          }
          ctx.restore()
        }
      }

      // Prism core
      if (s.prismCore) {
        const pulse = 1 + 0.15 * Math.sin(now * 0.012 + s.prismCore.phase)
        dotDiamond(ctx, s.prismCore.x, s.prismCore.y, s.prismCore.radius * 2.2 * pulse, 'rgba(248,184,48,0.32)')
        dotDiamond(ctx, s.prismCore.x, s.prismCore.y, s.prismCore.radius * 1.6, PAL.gold)
        dotRect(ctx, s.prismCore.x - PX, s.prismCore.y - PX, PX * 2, PX * 2, PAL.white)
        ctx.strokeStyle = 'rgba(248,88,168,0.85)'
        ctx.lineWidth = PX
        ctx.beginPath()
        ctx.arc(s.prismCore.x, s.prismCore.y, s.prismCore.radius * 1.2, 0, Math.PI * 2)
        ctx.stroke()
      }

      // Score zones
      for (const zone of s.scoreZones) {
        const zx = zone.side === 'left' ? 0 : W - PX * 2
        ctx.fillStyle = `rgba(64,200,72,${0.15 + 0.1 * Math.sin(now * 0.004 + zone.y)})`
        for (let zy = zone.y; zy < zone.y + SCORE_ZONE_HEIGHT; zy += PX) ctx.fillRect(zx, zy, PX * 2, PX)
        ctx.fillStyle = 'rgba(64,200,72,0.6)'; ctx.font = `bold ${PX * 2}px monospace`; ctx.textAlign = 'center'
        ctx.fillText('$', zx + PX, zone.y + SCORE_ZONE_HEIGHT / 2 + PX)
      }

      // Shield
      if (s.shieldActive) {
        ctx.fillStyle = `rgba(64,216,216,${0.4 + 0.3 * Math.sin(now * 0.006)})`
        for (let sx = 0; sx < W; sx += PX * 3) if (Math.floor(sx / (PX * 3)) % 2 === 0) ctx.fillRect(sx, H - PX, PX * 2, PX)
      }

      // Bricks
      for (const brick of s.bricks) {
        if (!brick.alive) continue
        const br = getBrickRect(brick, W)
        dotRect(ctx, br.x, br.y, br.w, br.h, brick.color)
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(snap(br.x), snap(br.y), snap(br.w - PX), PX); ctx.fillRect(snap(br.x), snap(br.y), PX, snap(br.h - PX))
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(snap(br.x + PX), snap(br.y + br.h - PX), snap(br.w - PX), PX); ctx.fillRect(snap(br.x + br.w - PX), snap(br.y + PX), PX, snap(br.h - PX))
        if (brick.hp > 1) { ctx.fillStyle = PAL.white; ctx.font = `bold ${PX * 2}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(`${brick.hp}`, br.x + br.w / 2, br.y + br.h / 2 + 1) }
      }

      // Star coins
      for (const sc of s.starCoins) {
        const age = (now - sc.spawnAt) / STAR_COIN_LIFETIME_MS
        ctx.globalAlpha = age > 0.7 ? 1 - (age - 0.7) / 0.3 : 1
        dotStar(ctx, sc.x, sc.y, STAR_COIN_RADIUS * (1 + 0.15 * Math.sin(now * 0.008)), PAL.gold)
        dotRect(ctx, sc.x - PX / 2, sc.y - PX / 2, PX, PX, PAL.yellow)
        ctx.globalAlpha = 1
      }

      // Power-ups
      for (const pu of s.powerUps) {
        dotDiamond(ctx, pu.x, pu.y, POWERUP_SIZE * (0.85 + 0.15 * Math.sin(now * 0.008)), PU_COLOR[pu.type])
        ctx.fillStyle = PAL.white; ctx.font = `bold ${PX * 2}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillText(PU_LABEL[pu.type].charAt(0), snap(pu.x), snap(pu.y) + 1)
      }

      // Ball trails
      for (const ball of s.balls) {
        for (let i = 0; i < ball.trail.length; i++) {
          const t = i / ball.trail.length
          ctx.fillStyle = overdriveActive
            ? (i % 2 === 0 ? PAL.gold : PAL.pink)
            : ball.isFireball ? PAL.red : PAL.purple
          ctx.globalAlpha = t * (overdriveActive ? 0.55 : 0.4)
          const sz = Math.max(PX, snap(BALL_RADIUS * t * 1.5))
          ctx.fillRect(snap(ball.trail[i].x - sz / 2), snap(ball.trail[i].y - sz / 2), sz, sz)
        }
        ctx.globalAlpha = 1
      }

      // Balls
      for (const ball of s.balls) {
        if (ball.isFireball) {
          dotCircle(ctx, ball.x, ball.y, BALL_RADIUS + PX, 'rgba(248,104,48,0.3)')
          dotCircle(ctx, ball.x, ball.y, BALL_RADIUS, PAL.fire)
          dotRect(ctx, ball.x - PX / 2, ball.y - PX / 2, PX, PX, PAL.yellow)
          if (Math.random() > 0.5) spawnPx(ball.x + (Math.random() - 0.5) * BALL_RADIUS, ball.y + (Math.random() - 0.5) * BALL_RADIUS, PAL.red, 1, 25)
        } else {
          if (overdriveActive) dotCircle(ctx, ball.x, ball.y, BALL_RADIUS + PX * 1.4, 'rgba(248,184,48,0.22)')
          dotCircle(ctx, ball.x, ball.y, BALL_RADIUS, PAL.white)
          dotRect(ctx, ball.x - PX, ball.y - PX, PX, PX, overdriveActive ? PAL.gold : s.magnetActive ? PAL.gold : PAL.purple)
        }
      }

      // Paddle
      const pw = s.paddleWidth; const pY = paddleY
      const pColor = overdriveActive ? PAL.gold : s.feverMode ? PAL.fire : isWide ? PAL.green : PAL.orange
      dotRect(ctx, s.paddleX - pw / 2, pY - PADDLE_HEIGHT / 2, pw, PADDLE_HEIGHT, pColor)
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(snap(s.paddleX - pw / 2 + PX), snap(pY - PADDLE_HEIGHT / 2), snap(pw - PX * 2), PX)
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(snap(s.paddleX - pw / 2), snap(pY + PADDLE_HEIGHT / 2 - PX), snap(pw), PX)
      const ew = snap(pw * PADDLE_CORNER_RATIO)
      dotRect(ctx, s.paddleX - pw / 2, pY - PADDLE_HEIGHT / 2, ew, PADDLE_HEIGHT, 'rgba(232,64,64,0.45)')
      dotRect(ctx, s.paddleX + pw / 2 - ew, pY - PADDLE_HEIGHT / 2, ew, PADDLE_HEIGHT, 'rgba(232,64,64,0.45)')
      const perfectW = snap(pw * PERFECT_HIT_ZONE * 2)
      dotRect(ctx, s.paddleX - perfectW / 2, pY - PADDLE_HEIGHT / 2, perfectW, PADDLE_HEIGHT, 'rgba(248,184,48,0.25)')

      // Danger line
      if (!s.shieldActive) { ctx.fillStyle = 'rgba(232,64,64,0.2)'; for (let dx = 0; dx < W; dx += PX * 3) if (Math.floor(dx / (PX * 3)) % 2 === 0) ctx.fillRect(dx, H - PX, PX * 2, PX) }

      // Particles
      for (const p of s.pixelParticles) { ctx.fillStyle = p.color; ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1); ctx.fillRect(snap(p.x), snap(p.y), p.size, p.size) }
      ctx.globalAlpha = 1

      // Shockwaves
      for (const sw of s.shockwaves) {
        const age = (now - sw.createdAt) / sw.durationMs
        if (age >= 1) continue
        const radius = sw.maxRadius * age
        ctx.save()
        ctx.globalAlpha = 1 - age
        ctx.strokeStyle = sw.color
        ctx.lineWidth = PX
        ctx.beginPath()
        ctx.arc(sw.x, sw.y, radius, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      // Chain arcs
      for (const arc of s.chainArcs) {
        const age = (now - arc.createdAt) / 400; if (age >= 1) continue
        ctx.globalAlpha = 1 - age; ctx.fillStyle = arc.color
        for (let i = 0; i <= 8; i++) {
          const t = i / 8
          ctx.fillRect(snap(arc.x1 + (arc.x2 - arc.x1) * t + (Math.random() - 0.5) * PX * 3 * (1 - age)), snap(arc.y1 + (arc.y2 - arc.y1) * t + (Math.random() - 0.5) * PX * 3 * (1 - age)), PX, PX)
        }
        ctx.globalAlpha = 1
      }

      // Floating texts
      for (const ft of s.floatingTexts) {
        const age = (now - ft.createdAt) / 1000; if (age >= 1) continue
        ctx.save(); ctx.globalAlpha = 1 - age * age
        const fs = ft.size || 10
        ctx.font = `bold ${fs}px "Press Start 2P", monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(ft.text, ft.x + 1, ft.y - age * PX * 10 + 1)
        ctx.fillStyle = ft.color; ctx.fillText(ft.text, ft.x, ft.y - age * PX * 10)
        ctx.restore()
      }

      // ── HUD ──
      const hudY = H - PX * 3
      dotRect(ctx, 0, hudY - PX, W, PX * 4, 'rgba(0,0,0,0.6)')
      ctx.fillStyle = overdriveActive ? PAL.gold : PAL.white; ctx.font = `bold ${PX * 3}px "Press Start 2P", monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(`${s.score.toLocaleString()}`, PX * 2, hudY + PX / 2)
      ctx.textAlign = 'right'; ctx.fillStyle = PAL.purple; ctx.font = `bold ${PX * 2}px "Press Start 2P", monospace`
      ctx.fillText(`Lv${s.speedLevel}`, W - PX * 2, hudY + PX / 2)
      const remainSec = Math.max(0, Math.ceil((GAME_TIMEOUT_MS - s.elapsedMs) / 1000))
      ctx.textAlign = 'center'; ctx.fillStyle = remainSec <= 10 ? PAL.red : PAL.gray; ctx.font = `${PX * 2 - 1}px "Press Start 2P", monospace`
      ctx.fillText(`${remainSec}`, W / 2, hudY + PX / 2)
      if (s.comboCount >= 3) { ctx.fillStyle = s.feverMode ? PAL.fire : PAL.yellow; ctx.textAlign = 'center'; ctx.font = `bold ${PX * 2}px "Press Start 2P", monospace`; ctx.fillText(`x${s.comboCount}`, W / 2, hudY - PX * 3) }
      if (s.balls.length > 1) { ctx.fillStyle = PAL.purple; ctx.font = `${PX * 2 - 1}px "Press Start 2P", monospace`; ctx.textAlign = 'left'; ctx.fillText(`x${s.balls.length}`, PX * 2, hudY - PX * 3) }

      // Active power-ups (top)
      const activePUs = Object.entries(s.activePowerUps).filter(([, exp]) => exp > now)
      if (activePUs.length > 0) {
        let puX = W - PX * 2
        for (const [type, exp] of activePUs) {
          const rem = clamp((exp - now) / POWERUP_DURATION_MS, 0, 1); const c = PU_COLOR[type as PowerUpType]
          ctx.fillStyle = c; ctx.globalAlpha = 0.6; dotRect(ctx, puX - PX * 6, PX, PX * 6 * rem, PX, c)
          ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.font = `${PX * 2 - 2}px monospace`; ctx.textAlign = 'right'; ctx.fillText(PU_LABEL[type as PowerUpType].charAt(0), puX, PX * 4)
          puX -= PX * 8
        }
      }

      // Fever banner
      if (s.feverMode && Math.sin(now * 0.012) > 0) {
        ctx.fillStyle = PAL.fire; ctx.font = `bold ${PX * 3}px "Press Start 2P", monospace`; ctx.textAlign = 'center'
        ctx.fillText('FEVER', W / 2, BRICK_TOP_OFFSET + BRICK_ROWS * (BRICK_HEIGHT + BRICK_GAP) + PX * 5)
      }
      if (overdriveActive) {
        ctx.fillStyle = PAL.gold; ctx.font = `bold ${PX * 2}px "Press Start 2P", monospace`; ctx.textAlign = 'center'
        ctx.fillText('OVERDRIVE x2', W / 2, BRICK_TOP_OFFSET + BRICK_ROWS * (BRICK_HEIGHT + BRICK_GAP) + PX * 9)
      }
      if (s.bannerText) {
        ctx.fillStyle = s.bannerColor
        ctx.font = `bold ${PX * 2}px "Press Start 2P", monospace`
        ctx.textAlign = 'center'
        ctx.fillText(s.bannerText, W / 2, PX * 7)
      }

      // Slow motion
      if (isSlow) { ctx.fillStyle = 'rgba(72,136,248,0.04)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = 'rgba(72,136,248,0.08)'; for (let sy = 0; sy < H; sy += PX * 2) ctx.fillRect(0, sy, W, 1) }

      // Dash ready
      if (now - s.lastDashTime >= DASH_COOLDOWN_MS) dotRect(ctx, s.paddleX - PX, pY + PADDLE_HEIGHT / 2 + PX * 2, PX * 2, PX, 'rgba(240,144,72,0.5)')

      // Vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.3)')
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H)

      ctx.restore()
      effectsRef.current.updateParticles()
      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); rafRef.current = null; ro.disconnect() }
  }, [finishGame, playAudio, bestScore])

  const comboLabel = getComboLabel(score)
  const comboColor = getComboColor(score)
  const bestDisplay = Math.max(bestScore, score)

  return (
    <section className="mini-game-panel pong-solo-panel" aria-label="pong-solo-game" style={{
      maxWidth: '432px', margin: '0 auto', width: '100%', height: '100%',
      display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', background: PAL.bg,
    }}>
      <style>{`${GAME_EFFECTS_CSS}\n${PONG_SOLO_UI_CSS}`}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        gap: `${PX * 2}px`,
        padding: `${PX * 3}px ${PX * 3}px ${PX * 2}px`,
        background: 'linear-gradient(180deg, rgba(13,12,34,0.96), rgba(8,8,20,0.88))',
        borderBottom: '1px solid rgba(168,88,248,0.35)',
        boxShadow: '0 10px 28px rgba(0,0,0,0.26)',
        zIndex: 1,
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: 'rgba(240,240,232,0.65)', fontSize: '8px', fontFamily: '"Press Start 2P", monospace' }}>BEST</div>
          <div style={{ color: PAL.cyan, fontSize: '13px', fontWeight: 900, fontFamily: '"Press Start 2P", monospace', textShadow: `0 0 10px ${PAL.cyan}` }}>
            {bestDisplay.toLocaleString()}
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: 'rgba(240,240,232,0.68)', fontSize: '8px', fontFamily: '"Press Start 2P", monospace', marginBottom: '4px' }}>SCORE</div>
          <div
            key={score}
            style={{
              color: PAL.yellow,
              fontSize: '24px',
              fontWeight: 900,
              lineHeight: 1,
              fontFamily: '"Press Start 2P", monospace',
              textShadow: `0 0 16px rgba(248,216,72,0.65)`,
              animation: 'pong-score-pop 180ms ease-out',
            }}
          >
            {score.toLocaleString()}
          </div>
        </div>
        <div style={{ minWidth: 0, textAlign: 'right' }}>
          <div style={{ color: 'rgba(240,240,232,0.65)', fontSize: '8px', fontFamily: '"Press Start 2P", monospace' }}>
            {comboDisplay >= 3 ? 'COMBO' : 'MODE'}
          </div>
          <div style={{ color: comboDisplay >= 3 ? PAL.orange : PAL.purple, fontSize: '11px', fontWeight: 900, fontFamily: '"Press Start 2P", monospace', textShadow: `0 0 10px ${comboDisplay >= 3 ? PAL.orange : PAL.purple}` }}>
            {comboDisplay >= 3 ? `${comboDisplay}x` : 'SOLO'}
          </div>
        </div>
      </div>
      <div ref={containerRef} style={{ flex: 1, width: '100%', position: 'relative', touchAction: 'none' }}
        onPointerMove={(e) => {
          const c = canvasRef.current; if (!c || stateRef.current.finished) return
          const r = c.getBoundingClientRect(); const rel = (e.clientX - r.left) / r.width; const s = stateRef.current
          s.paddleX = clamp(rel * s.fieldW, s.paddleWidth / 2, s.fieldW - s.paddleWidth / 2)
        }}>
        <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', imageRendering: 'pixelated' }} />
        {comboDisplay >= 3 && (
          <div style={{ position: 'absolute', top: `${PX * 3}px`, left: '50%', transform: 'translateX(-50%)', color: PAL.yellow, fontSize: '9px', fontWeight: 900, fontFamily: '"Press Start 2P", monospace', textShadow: '0 0 10px rgba(248,216,72,0.7)', pointerEvents: 'none', zIndex: 10, animation: 'pong-combo-float 180ms ease-out' }}>
            {comboDisplay}x COMBO
          </div>
        )}
      </div>
      {comboLabel && (
        <div style={{ position: 'absolute', bottom: `${PX * 7}px`, left: '50%', transform: 'translateX(-50%)', color: comboColor, fontSize: '10px', fontWeight: 900, fontFamily: '"Press Start 2P", monospace', textShadow: `0 0 12px ${comboColor}`, pointerEvents: 'none', zIndex: 10 }}>
          {comboLabel}
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
    accentColor: '#a858f8',
  },
  Component: PongSoloGame,
}
