import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/song-changsik.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

// ─── Sound imports ──────────────────────────────────────────
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import dodgeSfxFile from '../../../assets/sounds/dodge-ball-dodge.mp3'
import hitSfxFile from '../../../assets/sounds/dodge-ball-hit.mp3'
import shieldSfxFile from '../../../assets/sounds/dodge-ball-shield.mp3'
import slowmoSfxFile from '../../../assets/sounds/dodge-ball-slowmo.mp3'
import comboSfxFile from '../../../assets/sounds/dodge-ball-combo.mp3'
import milestoneSfxFile from '../../../assets/sounds/dodge-ball-milestone.mp3'
import warningSfxFile from '../../../assets/sounds/dodge-ball-warning.mp3'
import dashSfxFile from '../../../assets/sounds/dodge-ball-dash.mp3'
import bombSfxFile from '../../../assets/sounds/dodge-ball-bomb.mp3'
import coinSfxFile from '../../../assets/sounds/dodge-ball-coin.mp3'
import bossSfxFile from '../../../assets/sounds/dodge-ball-boss.mp3'
import levelupSfxFile from '../../../assets/sounds/dodge-ball-levelup.mp3'
import splitSfxFile from '../../../assets/sounds/dodge-ball-split.mp3'
import bgmFile from '../../../assets/sounds/dodge-ball-bgm.mp3'
import nearmissSfxFile from '../../../assets/sounds/dodge-ball-nearmiss.mp3'
import puAppearSfxFile from '../../../assets/sounds/dodge-ball-powerup-appear.mp3'
import feverSfxFile from '../../../assets/sounds/dodge-ball-fever.mp3'
import multiplierSfxFile from '../../../assets/sounds/dodge-ball-multiplier.mp3'

// ─── Retro Pixel Palette ────────────────────────────────────
const PAL = {
  bg0: '#0a0a1a', bg1: '#141428', bg2: '#1e1e3c',
  red: '#ff004d', orange: '#ffa300', yellow: '#ffec27',
  green: '#00e436', cyan: '#29adff', blue: '#1d2b53',
  purple: '#7e2553', pink: '#ff77a8', white: '#fff1e8',
  light: '#c2c3c7', mid: '#83769c', dark: '#5f574f',
  black: '#000000',
} as const

// ─── Layout ─────────────────────────────────────────────────
const VW = 256
const VH = 448
const PX = 4
const CHARACTER_RADIUS = 10
const CHARACTER_SIZE = 36
const BALL_SIZE = 8
const MAX_HP = 5
const CLEAR_TIME_MS = 60000
const CLEAR_BONUS = 1000
const INVINCIBILITY_MS = 1200
const HIT_FLASH_MS = 150
const SCORE_PER_SECOND = 15

// ─── Power-ups ──────────────────────────────────────────────
const SHIELD_DURATION_MS = 4000
const SLOWMO_DURATION_MS = 5000
const SLOWMO_FACTOR = 0.35
const POWERUP_SPAWN_INTERVAL_MS = 6000
const POWERUP_SIZE = 12
const POWERUP_COLLECT_DISTANCE = 32
const SCORE_MULT_DURATION_MS = 8000

// ─── Dash ───────────────────────────────────────────────────
const DASH_COOLDOWN_MS = 2000
const DASH_DISTANCE = 80
const DASH_INVINCIBILITY_MS = 300

// ─── Ball spawning (EASY START → HARD LATER) ────────────────
const GRACE_PERIOD_MS = 3000
const INITIAL_SPAWN_INTERVAL_MS = 2500
const MIN_SPAWN_INTERVAL_MS = 200
const SPAWN_INTERVAL_DECAY_PER_SECOND = 10
const INITIAL_BALL_SPEED = 55
const MAX_BALL_SPEED = 320
const BALL_SPEED_INCREASE_PER_SECOND = 3.5

// ─── Stage / Wave ───────────────────────────────────────────
const STAGE_INTERVAL_MS = 15000
const WAVE_BALL_COUNT_BASE = 3
const WAVE_BALL_COUNT_INCREASE = 2
const BOSS_STAGE_INTERVAL = 3

// ─── Combo ──────────────────────────────────────────────────
const NEAR_MISS_DISTANCE = 36
const COMBO_DECAY_MS = 2500
const COMBO_BONUS_PER_LEVEL = 8
const FEVER_COMBO_THRESHOLD = 10
const FEVER_SCORE_MULTIPLIER = 3

// ─── Coin system ────────────────────────────────────────────
const COIN_SPAWN_CHANCE = 0.12
const COIN_SIZE = 8
const COIN_COLLECT_DISTANCE = 28
const COIN_SCORE = 25
const COIN_LIFETIME_MS = 6000

// ─── Edge warning ───────────────────────────────────────────
const EDGE_WARN_DIST = 60

const BALL_COLORS = [PAL.red, PAL.orange, PAL.yellow, PAL.green, PAL.cyan, PAL.purple, PAL.pink] as const

type BallPattern = 'random' | 'spiral' | 'cross' | 'rain' | 'sniper' | 'split'
type PowerUpKind = 'shield' | 'slowmo' | 'heal' | 'bomb' | 'magnet' | 'x2'

interface PowerUp {
  readonly id: number; readonly kind: PowerUpKind
  readonly x: number; readonly y: number
  collected: boolean; spawnedAt: number
}

interface Ball {
  readonly id: number; x: number; y: number; vx: number; vy: number
  readonly color: string; readonly pattern: BallPattern
  readonly size: number; splittable: boolean; hp: number
}

interface Coin {
  readonly id: number; readonly x: number; readonly y: number
  collected: boolean; spawnedAt: number
}

interface DashTrail {
  x: number; y: number; opacity: number; createdAt: number
}

interface PixelExplosion {
  id: number; x: number; y: number; createdAt: number
  pixels: Array<{ dx: number; dy: number; vx: number; vy: number; color: string }>
}

interface EdgeWarning {
  side: 'top' | 'bottom' | 'left' | 'right'
  pos: number // position along that edge
  color: string
}

function rand(min: number, max: number) { return min + Math.random() * (max - min) }
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function spawnPowerUp(id: number, elapsed: number, stage: number): PowerUp {
  const baseKinds: PowerUpKind[] = ['shield', 'slowmo', 'heal', 'bomb', 'magnet']
  const kinds: PowerUpKind[] = stage >= 2 ? [...baseKinds, 'x2'] : baseKinds
  return { id, kind: kinds[Math.floor(Math.random() * kinds.length)], x: 20 + Math.random() * (VW - 40), y: 40 + Math.random() * (VH - 100), collected: false, spawnedAt: elapsed }
}

function spawnBall(id: number, speed: number, pattern: BallPattern, tx?: number, ty?: number): Ball {
  let x: number, y: number, vx: number, vy: number
  const m = BALL_SIZE + 4
  const size = pattern === 'rain' ? BALL_SIZE * 0.6 : pattern === 'sniper' ? BALL_SIZE * 1.4 : pattern === 'split' ? BALL_SIZE * 1.6 : BALL_SIZE

  if (pattern === 'rain') {
    x = rand(m, VW - m); y = -m; vx = rand(-15, 15); vy = speed
  } else if (pattern === 'sniper' && tx !== undefined && ty !== undefined) {
    const side = Math.floor(Math.random() * 4)
    switch (side) { case 0: x = rand(m, VW - m); y = -m; break; case 1: x = rand(m, VW - m); y = VH + m; break; case 2: x = -m; y = rand(m, VH - m); break; default: x = VW + m; y = rand(m, VH - m) }
    const dx = tx - x, dy = ty - y, d = Math.hypot(dx, dy)
    vx = (dx / d) * speed * 1.4; vy = (dy / d) * speed * 1.4
  } else if (pattern === 'spiral') {
    const a = Math.random() * Math.PI * 2
    x = VW / 2 + Math.cos(a) * (VW / 2 + m); y = VH / 2 + Math.sin(a) * (VH / 2 + m)
    const tc = Math.atan2(VH / 2 - y, VW / 2 - x) + 0.6
    vx = Math.cos(tc) * speed; vy = Math.sin(tc) * speed
  } else if (pattern === 'cross') {
    if (Math.random() < 0.5) { x = Math.random() < 0.5 ? -m : VW + m; y = VH / 2 + rand(-60, 60); vx = x < 0 ? speed : -speed; vy = rand(-25, 25) }
    else { x = VW / 2 + rand(-60, 60); y = Math.random() < 0.5 ? -m : VH + m; vx = rand(-25, 25); vy = y < 0 ? speed : -speed }
  } else if (pattern === 'split') {
    const side = Math.floor(Math.random() * 4)
    switch (side) { case 0: x = rand(m, VW - m); y = -m; break; case 1: x = rand(m, VW - m); y = VH + m; break; case 2: x = -m; y = rand(m, VH - m); break; default: x = VW + m; y = rand(m, VH - m) }
    const ttx = rand(40, VW - 40), tty = rand(40, VH - 40), dx = ttx - x, dy = tty - y, d = Math.hypot(dx, dy)
    vx = (dx / d) * speed * 0.7; vy = (dy / d) * speed * 0.7
  } else {
    const side = Math.floor(Math.random() * 4)
    switch (side) { case 0: x = rand(m, VW - m); y = -m; break; case 1: x = rand(m, VW - m); y = VH + m; break; case 2: x = -m; y = rand(m, VH - m); break; default: x = VW + m; y = rand(m, VH - m) }
    const ttx = rand(30, VW - 30), tty = rand(30, VH - 30), dx = ttx - x, dy = tty - y, d = Math.hypot(dx, dy)
    vx = (dx / d) * speed; vy = (dy / d) * speed
  }

  const color = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
  return { id, x, y, vx, vy, color, pattern, size, splittable: pattern === 'split', hp: pattern === 'split' ? 2 : 1 }
}

function isBallOOB(b: Ball): boolean { const m = BALL_SIZE + 60; return b.x < -m || b.x > VW + m || b.y < -m || b.y > VH + m }
function rectCollide(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean { return Math.abs(ax - bx) < ar + br && Math.abs(ay - by) < ar + br }

function getPatternForStage(stage: number): BallPattern {
  if (stage <= 2) return ['random', 'rain'][stage % 2] as BallPattern
  const patterns: BallPattern[] = ['random', 'rain', 'cross', 'spiral', 'sniper', 'split']
  return patterns[stage % patterns.length]
}

function getPUColor(k: PowerUpKind): string {
  switch (k) { case 'shield': return PAL.cyan; case 'slowmo': return PAL.purple; case 'heal': return PAL.green; case 'bomb': return PAL.red; case 'magnet': return PAL.orange; case 'x2': return PAL.yellow }
}

function getPULabel(k: PowerUpKind): string {
  switch (k) { case 'shield': return 'SH'; case 'slowmo': return 'SL'; case 'heal': return 'HP'; case 'bomb': return 'BM'; case 'magnet': return 'MG'; case 'x2': return 'x2' }
}

function computeEdgeWarnings(balls: Ball[]): EdgeWarning[] {
  const warnings: EdgeWarning[] = []
  for (const b of balls) {
    if (b.x >= 0 && b.x <= VW && b.y >= 0 && b.y <= VH) continue
    if (b.y < -EDGE_WARN_DIST + 10 && b.y > -EDGE_WARN_DIST * 3 && b.vy > 0) warnings.push({ side: 'top', pos: clamp(b.x, 8, VW - 8), color: b.color })
    else if (b.y > VH + EDGE_WARN_DIST - 10 && b.y < VH + EDGE_WARN_DIST * 3 && b.vy < 0) warnings.push({ side: 'bottom', pos: clamp(b.x, 8, VW - 8), color: b.color })
    if (b.x < -EDGE_WARN_DIST + 10 && b.x > -EDGE_WARN_DIST * 3 && b.vx > 0) warnings.push({ side: 'left', pos: clamp(b.y, 8, VH - 8), color: b.color })
    else if (b.x > VW + EDGE_WARN_DIST - 10 && b.x < VW + EDGE_WARN_DIST * 3 && b.vx < 0) warnings.push({ side: 'right', pos: clamp(b.y, 8, VH - 8), color: b.color })
  }
  return warnings
}

// ─────────────────────────────────────────────────────────────
function DodgeBallGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [playerX, setPlayerX] = useState(VW / 2)
  const [playerY, setPlayerY] = useState(VH * 0.72)
  const [hp, setHp] = useState(MAX_HP)
  const [score, setScore] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [balls, setBalls] = useState<Ball[]>([])
  const [isHitFlash, setHitFlash] = useState(false)
  const [isInvincible, setIsInvincible] = useState(false)
  const [isCleared, setIsCleared] = useState(false)
  const [powerUps, setPowerUps] = useState<PowerUp[]>([])
  const [coins, setCoins] = useState<Coin[]>([])
  const [shieldTimerMs, setShieldTimerMs] = useState(0)
  const [slowmoTimerMs, setSlowmoTimerMs] = useState(0)
  const [combo, setCombo] = useState(0)
  const [stage, setStage] = useState(1)
  const [stageFlash, setStageFlash] = useState('GET READY!')
  const [dashCooldownMs, setDashCooldownMs] = useState(0)
  const [dashTrails, setDashTrails] = useState<DashTrail[]>([])
  const [magnetActive, setMagnetActive] = useState(false)
  const [pixelExplosions, setPixelExplosions] = useState<PixelExplosion[]>([])
  const [isFever, setIsFever] = useState(false)
  const [totalCoins, setTotalCoins] = useState(0)
  const [scoreMultTimerMs, setScoreMultTimerMs] = useState(0)
  const [nearMissFlash, setNearMissFlash] = useState(false)

  const effects = useGameEffects()
  const effectsRef = useRef(effects)
  effectsRef.current = effects

  const r = useRef({
    playerX: VW / 2, playerY: VH * 0.72, hp: MAX_HP, score: 0, elapsedMs: 0,
    balls: [] as Ball[], nextBallId: 0, spawnTimer: 0, invincibleTimer: 0,
    finished: false, cleared: false, animFrame: null as number | null,
    lastFrameAt: null as number | null, pointerActive: false,
    lastScorePopupMs: 0, pointerOffsetX: 0, pointerOffsetY: 0,
    powerUps: [] as PowerUp[], nextPUId: 0, lastPUSpawnMs: 0,
    shieldTimerMs: 0, slowmoTimerMs: 0, lastMilestone: 0,
    combo: 0, lastComboMs: 0, stage: 1, lastStageMs: 0,
    dashCooldownMs: 0, dashTrails: [] as DashTrail[], magnetTimerMs: 0,
    coins: [] as Coin[], nextCoinId: 0, totalCoins: 0,
    pixelExplosions: [] as PixelExplosion[], nextExpId: 0,
    isFever: false, scoreMultTimerMs: 0, graceShown: false,
    stageTransitionUntil: 0, // ms timestamp until which no new balls spawn (stage transition grace)
  })

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const arenaRef = useRef<HTMLDivElement | null>(null)

  const playSfx = useCallback((key: string, vol = 0.5, rate = 1) => {
    const a = audioRefs.current[key]; if (!a) return
    a.currentTime = 0; a.volume = Math.min(1, vol); a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  // Convert SVG viewBox coords to screen px (for score popups)
  const arenaToScreen = useCallback((vx: number, vy: number) => {
    const el = arenaRef.current; if (!el) return { x: vx, y: vy }
    const rc = el.getBoundingClientRect()
    return { x: rc.left + (vx / VW) * rc.width, y: rc.top + (vy / VH) * rc.height }
  }, [])

  const spawnPixelExplosion = useCallback((x: number, y: number, color: string, count = 12) => {
    const pixels = Array.from({ length: count }, () => ({
      dx: 0, dy: 0,
      vx: (Math.random() - 0.5) * 200,
      vy: (Math.random() - 0.5) * 200,
      color: Math.random() < 0.5 ? color : PAL.white,
    }))
    const exp: PixelExplosion = { id: r.current.nextExpId++, x, y, createdAt: performance.now(), pixels }
    r.current.pixelExplosions.push(exp)
    setPixelExplosions([...r.current.pixelExplosions])
  }, [])

  const finishGame = useCallback(() => {
    if (r.current.finished) return
    r.current.finished = true
    if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current.currentTime = 0 }
    onFinish({ score: r.current.score, durationMs: r.current.elapsedMs > 0 ? Math.round(r.current.elapsedMs) : Math.round(DEFAULT_FRAME_MS) })
  }, [onFinish])

  const clientToArena = useCallback((cx: number, cy: number) => {
    const el = arenaRef.current; if (!el) return { x: VW / 2, y: VH / 2 }
    const rc = el.getBoundingClientRect()
    return { x: clamp((cx - rc.left) * (VW / rc.width), CHARACTER_RADIUS, VW - CHARACTER_RADIUS), y: clamp((cy - rc.top) * (VH / rc.height), CHARACTER_RADIUS, VH - CHARACTER_RADIUS) }
  }, [])

  const performDash = useCallback((tx: number, ty: number) => {
    const s = r.current; if (s.dashCooldownMs > 0 || s.finished) return
    const dx = tx - s.playerX, dy = ty - s.playerY, d = Math.hypot(dx, dy); if (d < 8) return
    const dd = Math.min(DASH_DISTANCE, d)
    const nx = clamp(s.playerX + (dx / d) * dd, CHARACTER_RADIUS, VW - CHARACTER_RADIUS)
    const ny = clamp(s.playerY + (dy / d) * dd, CHARACTER_RADIUS, VH - CHARACTER_RADIUS)
    const trails: DashTrail[] = Array.from({ length: 4 }, (_, i) => ({ x: s.playerX + (nx - s.playerX) * (i / 4), y: s.playerY + (ny - s.playerY) * (i / 4), opacity: 0.5 - i * 0.1, createdAt: performance.now() }))
    s.dashTrails = [...s.dashTrails, ...trails]; setDashTrails([...s.dashTrails])
    s.playerX = nx; s.playerY = ny; setPlayerX(nx); setPlayerY(ny)
    s.dashCooldownMs = DASH_COOLDOWN_MS; setDashCooldownMs(DASH_COOLDOWN_MS)
    s.invincibleTimer = Math.max(s.invincibleTimer, DASH_INVINCIBILITY_MS); setIsInvincible(true)
    playSfx('dash', 0.5); spawnPixelExplosion(nx, ny, PAL.cyan, 6)
  }, [playSfx, spawnPixelExplosion])

  const clearAllBalls = useCallback(() => {
    const s = r.current
    for (const b of s.balls) { spawnPixelExplosion(b.x, b.y, b.color, 6) }
    s.balls = []; setBalls([]); playSfx('bomb', 0.7)
    effectsRef.current.triggerShake(12); effectsRef.current.triggerFlash('rgba(255,255,255,0.6)')
    s.score += s.balls.length * 10; setScore(s.score)
  }, [spawnPixelExplosion, playSfx])

  // ─── Pointer (drag-relative, no teleport) ────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); r.current.pointerActive = true
    const t = clientToArena(e.clientX, e.clientY)
    r.current.pointerOffsetX = t.x - r.current.playerX
    r.current.pointerOffsetY = t.y - r.current.playerY
    // Start BGM on first interaction
    if (bgmRef.current && bgmRef.current.paused) {
      bgmRef.current.volume = 0.25; bgmRef.current.loop = true
      void bgmRef.current.play().catch(() => {})
    }
  }, [clientToArena])
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!r.current.pointerActive && e.pointerType === 'mouse' && e.buttons === 0) return
    const t = clientToArena(e.clientX, e.clientY)
    const nx = clamp(t.x - r.current.pointerOffsetX, CHARACTER_RADIUS, VW - CHARACTER_RADIUS)
    const ny = clamp(t.y - r.current.pointerOffsetY, CHARACTER_RADIUS, VH - CHARACTER_RADIUS)
    r.current.playerX = nx; r.current.playerY = ny; setPlayerX(nx); setPlayerY(ny)
  }, [clientToArena])
  const handlePointerUp = useCallback(() => { r.current.pointerActive = false }, [])
  const handleDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => { e.preventDefault(); const t = clientToArena(e.clientX, e.clientY); performDash(t.x, t.y) }, [clientToArena, performDash])

  // ─── Init audio ───────────────────────────────────────────
  useEffect(() => {
    const load = (k: string, src: string) => { const a = new Audio(src); a.preload = 'auto'; audioRefs.current[k] = a }
    load('hit', tapHitSfx); load('hitStrong', tapHitStrongSfx); load('gameOver', gameOverHitSfx)
    load('dodge', dodgeSfxFile); load('ballHit', hitSfxFile); load('shield', shieldSfxFile)
    load('slowmo', slowmoSfxFile); load('combo', comboSfxFile); load('milestone', milestoneSfxFile)
    load('warning', warningSfxFile); load('dash', dashSfxFile)
    load('bomb', bombSfxFile); load('coin', coinSfxFile); load('boss', bossSfxFile)
    load('levelup', levelupSfxFile); load('split', splitSfxFile)
    load('nearmiss', nearmissSfxFile); load('puAppear', puAppearSfxFile)
    load('fever', feverSfxFile); load('multiplier', multiplierSfxFile)
    // BGM
    const bgm = new Audio(bgmFile); bgm.preload = 'auto'; bgm.loop = true; bgm.volume = 0.25; bgmRef.current = bgm
    const img = new Image(); img.src = characterSprite; void img.decode?.().catch(() => {})
    // Grace period banner
    setTimeout(() => setStageFlash(''), 2500)
    return () => {
      for (const a of Object.values(audioRefs.current)) { if (a) { a.pause(); a.currentTime = 0 } }
      if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current.currentTime = 0 }
      effectsRef.current.cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Keyboard ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (r.current.finished) return
      const step = 16; let nx = r.current.playerX, ny = r.current.playerY
      switch (e.code) {
        case 'ArrowLeft': case 'KeyA': nx -= step; break; case 'ArrowRight': case 'KeyD': nx += step; break
        case 'ArrowUp': case 'KeyW': ny -= step; break; case 'ArrowDown': case 'KeyS': ny += step; break
        case 'Space': e.preventDefault(); performDash(nx + (Math.random() - 0.5) * 40, ny - 50); return
        default: return
      }
      e.preventDefault(); nx = clamp(nx, CHARACTER_RADIUS, VW - CHARACTER_RADIUS); ny = clamp(ny, CHARACTER_RADIUS, VH - CHARACTER_RADIUS)
      r.current.playerX = nx; r.current.playerY = ny; setPlayerX(nx); setPlayerY(ny)
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey)
  }, [onExit, performDash])

  // ─── Game loop ────────────────────────────────────────────
  useEffect(() => {
    r.current.lastFrameAt = null

    const step = (now: number) => {
      const s = r.current
      if (s.finished) { s.animFrame = null; return }
      if (s.lastFrameAt === null) s.lastFrameAt = now
      const deltaMs = Math.min(now - s.lastFrameAt, MAX_FRAME_DELTA_MS)
      s.lastFrameAt = now; const dt = deltaMs / 1000
      s.elapsedMs += deltaMs; setElapsedMs(s.elapsedMs)

      // ── Grace period ──
      const inGrace = s.elapsedMs < GRACE_PERIOD_MS
      if (!s.graceShown && s.elapsedMs >= GRACE_PERIOD_MS) {
        s.graceShown = true
        setStageFlash('GO!'); setTimeout(() => setStageFlash(''), 1000)
        effectsRef.current.triggerFlash('rgba(0,228,54,0.3)')
      }

      // ── Fever mode ──
      const wasFever = s.isFever
      s.isFever = s.combo >= FEVER_COMBO_THRESHOLD
      if (s.isFever && !wasFever) { setIsFever(true); playSfx('fever', 0.6) }
      if (!s.isFever && wasFever) setIsFever(false)
      const scoreMultPU = s.scoreMultTimerMs > 0 ? 2 : 1
      const scoreMult = (s.isFever ? FEVER_SCORE_MULTIPLIER : 1) * scoreMultPU

      // ── Timers ──
      if (s.invincibleTimer > 0) { s.invincibleTimer = Math.max(0, s.invincibleTimer - deltaMs); setIsInvincible(s.invincibleTimer > 0) }
      if (s.dashCooldownMs > 0) { s.dashCooldownMs = Math.max(0, s.dashCooldownMs - deltaMs); setDashCooldownMs(s.dashCooldownMs) }
      if (s.shieldTimerMs > 0) { s.shieldTimerMs = Math.max(0, s.shieldTimerMs - deltaMs); setShieldTimerMs(s.shieldTimerMs) }
      if (s.slowmoTimerMs > 0) { s.slowmoTimerMs = Math.max(0, s.slowmoTimerMs - deltaMs); setSlowmoTimerMs(s.slowmoTimerMs) }
      if (s.magnetTimerMs > 0) { s.magnetTimerMs = Math.max(0, s.magnetTimerMs - deltaMs); setMagnetActive(s.magnetTimerMs > 0) }
      if (s.scoreMultTimerMs > 0) { s.scoreMultTimerMs = Math.max(0, s.scoreMultTimerMs - deltaMs); setScoreMultTimerMs(s.scoreMultTimerMs) }

      // ── Score ──
      const timeScore = Math.floor((s.elapsedMs / 1000) * SCORE_PER_SECOND * scoreMult)
      const comboBonus = s.combo * COMBO_BONUS_PER_LEVEL
      if (!s.cleared && s.elapsedMs >= CLEAR_TIME_MS) {
        s.cleared = true; setIsCleared(true)
        s.score = timeScore + CLEAR_BONUS + comboBonus; setScore(s.score)
        playSfx('levelup', 0.8, 1.2); const clsp = arenaToScreen(VW / 2, VH / 2); effectsRef.current.comboHitBurst(clsp.x, clsp.y, 10, CLEAR_BONUS)
        setStageFlash('STAGE CLEAR!!'); setTimeout(() => setStageFlash(''), 2000)
      } else {
        s.score = (s.cleared ? timeScore + CLEAR_BONUS : timeScore) + comboBonus; setScore(s.score)
      }

      // ── Combo decay ──
      if (s.combo > 0 && now - s.lastComboMs > COMBO_DECAY_MS) { s.combo = 0; setCombo(0) }

      // ── Survival milestones ──
      const curMilestone = Math.floor(s.elapsedMs / 1000 / 10)
      if (curMilestone > s.lastMilestone) {
        s.lastMilestone = curMilestone; s.score += 100 * scoreMult; setScore(s.score)
        const msp = arenaToScreen(s.playerX, s.playerY - 30); effectsRef.current.comboHitBurst(msp.x, msp.y, curMilestone, 100)
        playSfx('milestone', 0.5, 1.1)
      }

      // ── Stage system (with transition grace period) ──
      const curStage = Math.floor(Math.max(0, s.elapsedMs - GRACE_PERIOD_MS) / STAGE_INTERVAL_MS) + 1
      const inStageTransition = now < s.stageTransitionUntil
      if (curStage > s.stage) {
        s.stage = curStage; setStage(curStage)
        const isBoss = curStage % BOSS_STAGE_INTERVAL === 0
        if (isBoss) {
          setStageFlash(`BOSS WAVE ${curStage}`); playSfx('boss', 0.7)
          effectsRef.current.triggerFlash('rgba(255,0,77,0.4)')
        } else {
          setStageFlash(`STAGE ${curStage}`); playSfx('warning', 0.5)
          effectsRef.current.triggerFlash('rgba(255,236,39,0.25)')
        }
        setTimeout(() => setStageFlash(''), 1500)
        // 1.5s grace before wave balls spawn
        s.stageTransitionUntil = now + 1500

        const pattern = isBoss ? 'sniper' as BallPattern : getPatternForStage(curStage)
        const count = isBoss ? WAVE_BALL_COUNT_BASE + curStage * 2 : WAVE_BALL_COUNT_BASE + curStage * WAVE_BALL_COUNT_INCREASE
        const spd = Math.min(MAX_BALL_SPEED, INITIAL_BALL_SPEED + (s.elapsedMs / 1000) * BALL_SPEED_INCREASE_PER_SECOND)
        // Delayed spawn: schedule balls after transition grace
        setTimeout(() => {
          if (r.current.finished) return
          for (let i = 0; i < count; i++) {
            r.current.balls.push(spawnBall(r.current.nextBallId++, isBoss ? spd * 1.3 : spd, pattern, r.current.playerX, r.current.playerY))
          }
          if (curStage >= 3 && curStage % 2 === 0) {
            for (let i = 0; i < 2; i++) r.current.balls.push(spawnBall(r.current.nextBallId++, spd * 0.8, 'split', r.current.playerX, r.current.playerY))
          }
        }, 1500)
      }

      // ── Power-up spawn ──
      if (!inGrace && s.elapsedMs - s.lastPUSpawnMs >= POWERUP_SPAWN_INTERVAL_MS) {
        s.lastPUSpawnMs = s.elapsedMs
        s.powerUps.push(spawnPowerUp(s.nextPUId++, s.elapsedMs, s.stage))
        setPowerUps([...s.powerUps])
        playSfx('puAppear', 0.35, 1.2)
      }

      // ── Power-up collect ──
      const magDist = s.magnetTimerMs > 0 ? 100 : POWERUP_COLLECT_DISTANCE
      for (const pu of s.powerUps) {
        if (pu.collected) continue
        if (s.elapsedMs - pu.spawnedAt > 12000) { pu.collected = true; continue }
        if (Math.abs(s.playerX - pu.x) < magDist && Math.abs(s.playerY - pu.y) < magDist) {
          pu.collected = true; spawnPixelExplosion(pu.x, pu.y, getPUColor(pu.kind), 8)
          switch (pu.kind) {
            case 'shield': s.shieldTimerMs = SHIELD_DURATION_MS; setShieldTimerMs(SHIELD_DURATION_MS); effectsRef.current.triggerFlash('rgba(41,173,255,0.3)'); playSfx('shield', 0.5); break
            case 'slowmo': s.slowmoTimerMs = SLOWMO_DURATION_MS; setSlowmoTimerMs(SLOWMO_DURATION_MS); effectsRef.current.triggerFlash('rgba(126,37,83,0.3)'); playSfx('slowmo', 0.5); break
            case 'heal': if (s.hp < MAX_HP) { s.hp++; setHp(s.hp) }; playSfx('hitStrong', 0.4, 1.3); effectsRef.current.triggerFlash('rgba(0,228,54,0.3)'); break
            case 'bomb': clearAllBalls(); break
            case 'magnet': s.magnetTimerMs = 6000; setMagnetActive(true); effectsRef.current.triggerFlash('rgba(255,163,0,0.3)'); playSfx('hitStrong', 0.4, 0.8); break
            case 'x2': s.scoreMultTimerMs = SCORE_MULT_DURATION_MS; setScoreMultTimerMs(SCORE_MULT_DURATION_MS); effectsRef.current.triggerFlash('rgba(255,236,39,0.3)'); playSfx('multiplier', 0.5); break
          }
          setPowerUps([...s.powerUps])
        }
      }
      s.powerUps = s.powerUps.filter(pu => !pu.collected)

      // ── Coin collect ──
      for (const c of s.coins) {
        if (c.collected) continue
        if (s.elapsedMs - c.spawnedAt > COIN_LIFETIME_MS) { c.collected = true; continue }
        const cd = s.magnetTimerMs > 0 ? 80 : COIN_COLLECT_DISTANCE
        if (Math.abs(s.playerX - c.x) < cd && Math.abs(s.playerY - c.y) < cd) {
          c.collected = true; s.score += COIN_SCORE * scoreMult; s.totalCoins++; setTotalCoins(s.totalCoins); setScore(s.score)
          playSfx('coin', 0.5, 1 + s.totalCoins * 0.02)
          spawnPixelExplosion(c.x, c.y, PAL.yellow, 4)
          const csp = arenaToScreen(c.x, c.y - 10); effectsRef.current.showScorePopup(COIN_SCORE * scoreMult, csp.x, csp.y)
        }
      }
      s.coins = s.coins.filter(c => !c.collected); setCoins([...s.coins])

      const slowMult = s.slowmoTimerMs > 0 ? SLOWMO_FACTOR : 1

      // ── Regular ball spawn (skip during grace & stage transition) ──
      if (!inGrace && !inStageTransition) {
        const elSec = Math.max(0, (s.elapsedMs - GRACE_PERIOD_MS) / 1000)
        const ballSpeed = Math.min(MAX_BALL_SPEED, INITIAL_BALL_SPEED + elSec * BALL_SPEED_INCREASE_PER_SECOND) * slowMult
        const spawnInterval = Math.max(MIN_SPAWN_INTERVAL_MS, INITIAL_SPAWN_INTERVAL_MS - elSec * SPAWN_INTERVAL_DECAY_PER_SECOND)
        s.spawnTimer += deltaMs
        while (s.spawnTimer >= spawnInterval) {
          s.spawnTimer -= spawnInterval
          // Early game: only random+rain. Later: add sniper/split
          let pat: BallPattern = 'random'
          if (elSec > 30) pat = Math.random() < 0.12 ? 'sniper' : Math.random() < 0.08 ? 'split' : 'random'
          else if (elSec > 15) pat = Math.random() < 0.06 ? 'sniper' : 'random'
          else pat = Math.random() < 0.2 ? 'rain' : 'random'
          s.balls.push(spawnBall(s.nextBallId++, ballSpeed, pat, s.playerX, s.playerY))
        }
      }

      // ── Update balls ──
      const updated: Ball[] = []; let hitDetected = false; let nearMissCount = 0
      for (const ball of s.balls) {
        const nx = ball.x + ball.vx * dt * slowMult, ny = ball.y + ball.vy * dt * slowMult
        if (isBallOOB({ ...ball, x: nx, y: ny })) {
          const pd = Math.hypot(s.playerX - ball.x, s.playerY - ball.y)
          if (pd < NEAR_MISS_DISTANCE + CHARACTER_RADIUS) nearMissCount++
          if (Math.random() < COIN_SPAWN_CHANCE && ball.x > 10 && ball.x < VW - 10 && ball.y > 10 && ball.y < VH - 10) {
            s.coins.push({ id: s.nextCoinId++, x: clamp(ball.x, 16, VW - 16), y: clamp(ball.y, 16, VH - 16), collected: false, spawnedAt: s.elapsedMs })
          }
          continue
        }
        if (s.invincibleTimer <= 0 && rectCollide(s.playerX, s.playerY, CHARACTER_RADIUS, nx, ny, ball.size * 0.8)) {
          if (s.shieldTimerMs > 0) {
            s.shieldTimerMs = 0; setShieldTimerMs(0)
            spawnPixelExplosion(nx, ny, PAL.cyan, 10); playSfx('shield', 0.6, 0.8); continue
          }
          hitDetected = true; spawnPixelExplosion(nx, ny, ball.color, 8); continue
        }
        if (ball.splittable && (nx < 20 || nx > VW - 20 || ny < 20 || ny > VH - 20)) {
          ball.splittable = false
          const angle1 = Math.atan2(ball.vy, ball.vx) + 0.8, angle2 = Math.atan2(ball.vy, ball.vx) - 0.8
          const spd = Math.hypot(ball.vx, ball.vy) * 1.1
          s.balls.push({ id: s.nextBallId++, x: nx, y: ny, vx: Math.cos(angle1) * spd, vy: Math.sin(angle1) * spd, color: ball.color, pattern: 'random', size: BALL_SIZE * 0.7, splittable: false, hp: 1 })
          s.balls.push({ id: s.nextBallId++, x: nx, y: ny, vx: Math.cos(angle2) * spd, vy: Math.sin(angle2) * spd, color: ball.color, pattern: 'random', size: BALL_SIZE * 0.7, splittable: false, hp: 1 })
          playSfx('split', 0.4); spawnPixelExplosion(nx, ny, ball.color, 6)
        }
        updated.push({ ...ball, x: nx, y: ny })
      }
      s.balls = updated; setBalls(updated)

      // ── Near miss combo + visual ──
      if (nearMissCount > 0 && !hitDetected) {
        s.combo += nearMissCount; s.lastComboMs = now; setCombo(s.combo)
        setNearMissFlash(true); setTimeout(() => setNearMissFlash(false), 200)
        playSfx('nearmiss', 0.3, 1 + Math.min(s.combo * 0.03, 0.4))
        if (s.combo >= 3) { playSfx('combo', 0.4, 0.9 + Math.min(s.combo * 0.04, 0.5)); const sp = arenaToScreen(s.playerX, s.playerY - 40); effectsRef.current.showScorePopup(s.combo * COMBO_BONUS_PER_LEVEL, sp.x, sp.y) }
        if (s.combo === FEVER_COMBO_THRESHOLD) { effectsRef.current.triggerFlash('rgba(255,236,39,0.4)') }
      }

      // ── Hit ──
      if (hitDetected) {
        s.hp--; setHp(s.hp); s.invincibleTimer = INVINCIBILITY_MS; setIsInvincible(true)
        setHitFlash(true); setTimeout(() => setHitFlash(false), HIT_FLASH_MS)
        s.combo = 0; setCombo(0); effectsRef.current.triggerShake(12); effectsRef.current.triggerFlash('rgba(255,0,77,0.5)')
        if (s.hp <= 0) { playSfx('gameOver', 0.7, 0.9); finishGame(); s.animFrame = null; return }
        playSfx('ballHit', 0.55)
      }

      // ── Dash trails decay ──
      s.dashTrails = s.dashTrails.filter(t => now - t.createdAt < 350); setDashTrails([...s.dashTrails])

      // ── Pixel explosion update ──
      for (const exp of s.pixelExplosions) {
        for (const p of exp.pixels) { p.dx += p.vx * dt; p.dy += p.vy * dt; p.vy += 200 * dt }
      }
      s.pixelExplosions = s.pixelExplosions.filter(e => now - e.createdAt < 600); setPixelExplosions([...s.pixelExplosions])

      // ── Periodic popup ──
      if (s.elapsedMs - s.lastScorePopupMs > 5000 && !s.finished) {
        s.lastScorePopupMs = s.elapsedMs; const psp = arenaToScreen(s.playerX, s.playerY - 30); effectsRef.current.showScorePopup(Math.floor(5 * SCORE_PER_SECOND * scoreMult), psp.x, psp.y)
      }
      effectsRef.current.updateParticles(); s.animFrame = window.requestAnimationFrame(step)
    }
    r.current.animFrame = window.requestAnimationFrame(step)
    return () => { if (r.current.animFrame !== null) { window.cancelAnimationFrame(r.current.animFrame); r.current.animFrame = null }; r.current.lastFrameAt = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishGame, playSfx, spawnPixelExplosion, clearAllBalls])

  const displayedBest = Math.max(bestScore, score)
  const hearts = Array.from({ length: MAX_HP }, (_, i) => i < hp)
  const elapsedSec = elapsedMs / 1000
  const invBlink = isInvincible && Math.floor(elapsedMs / 80) % 2 === 0
  const dashReady = dashCooldownMs <= 0
  const dashPct = dashCooldownMs > 0 ? 1 - dashCooldownMs / DASH_COOLDOWN_MS : 1
  const feverBlink = isFever && Math.floor(elapsedMs / 200) % 2 === 0
  const edgeWarnings = computeEdgeWarnings(balls)
  const hasScoreMult = scoreMultTimerMs > 0

  return (
    <section className="mini-game-panel db-panel" aria-label="dodge-ball-game" style={{ maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() } as React.CSSProperties}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        .db-panel { display:flex; flex-direction:column; width:100%; height:100%; background:${PAL.bg0}; user-select:none; -webkit-user-select:none; touch-action:manipulation; font-family:'Press Start 2P',monospace; image-rendering:pixelated; }
        .db-panel * { image-rendering:pixelated; }

        .db-hud { display:flex; justify-content:space-between; align-items:flex-start; width:100%; padding:10px 12px; background:${PAL.bg1}; border-bottom:3px solid ${PAL.dark}; z-index:10; flex-shrink:0; gap:6px; }
        .db-hud-col { display:flex; flex-direction:column; align-items:center; gap:3px; }

        .db-score { font-size:28px; color:${PAL.yellow}; margin:0; line-height:1.2; text-shadow: 3px 3px ${PAL.black}; }
        .db-best { font-size:9px; color:${PAL.mid}; margin:0; }
        .db-time { font-size:22px; color:${PAL.white}; margin:0; text-shadow: 2px 2px ${PAL.black}; }
        .db-stage-label { font-size:12px; color:${PAL.cyan}; margin:0; text-shadow: 1px 1px ${PAL.black}; }
        .db-hearts { font-size:20px; margin:0; display:flex; gap:2px; }
        .db-heart-alive { color:${PAL.red}; text-shadow:0 0 6px ${PAL.red}; }
        .db-heart-lost { color:${PAL.dark}; }
        .db-combo { font-size:18px; color:${PAL.yellow}; text-shadow:2px 2px ${PAL.black}; animation:db-pulse .3s ease; }
        .db-fever { font-size:14px; color:${PAL.red}; animation:db-pulse .2s ease infinite alternate; text-shadow:0 0 8px ${PAL.red}; }
        .db-coins { font-size:11px; color:${PAL.yellow}; margin:0; }
        .db-mult { font-size:12px; color:${PAL.yellow}; animation:db-pulse .3s ease infinite alternate; text-shadow:0 0 6px ${PAL.yellow}; margin:0; }

        @keyframes db-pulse { from{transform:scale(1)} to{transform:scale(1.2)} }
        @keyframes db-nearmiss { 0%{opacity:0.6;transform:scale(1.3)} 100%{opacity:0;transform:scale(2)} }

        .db-status { display:flex; gap:4px; flex-wrap:wrap; justify-content:center; }
        .db-pill { font-size:10px; padding:3px 6px; border:2px solid; color:${PAL.white}; }

        .db-arena-wrap { flex:1; width:100%; position:relative; overflow:hidden; min-height:0; }
        .db-arena { position:absolute; inset:0; background:${PAL.bg0}; cursor:none; }
        .db-arena.hit-flash { background:${PAL.red}20; }
        .db-arena.fever-bg { background:${PAL.bg1}; }

        .db-svg { width:100%; height:100%; display:block; shape-rendering:crispEdges; }

        .db-scanlines { position:absolute; inset:0; pointer-events:none; z-index:5; background:repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px); }
        .db-crt { position:absolute; inset:0; pointer-events:none; z-index:6; box-shadow:inset 0 0 60px rgba(0,0,0,0.4); }

        .db-stage-banner { position:absolute; top:45%; left:50%; transform:translate(-50%,-50%); font-size:22px; color:${PAL.yellow}; text-shadow:3px 3px ${PAL.black},0 0 20px ${PAL.yellow}80; z-index:20; pointer-events:none; animation:db-banner 1.5s ease forwards; text-align:center; white-space:nowrap; }
        @keyframes db-banner { 0%{opacity:0;transform:translate(-50%,-50%) scale(2.5)} 15%{opacity:1;transform:translate(-50%,-50%) scale(1)} 75%{opacity:1} 100%{opacity:0;transform:translate(-50%,-50%) scale(0.8)} }

        .db-footer { display:flex; justify-content:center; align-items:center; width:100%; padding:6px 12px; flex-shrink:0; z-index:10; background:${PAL.bg1}; border-top:2px solid ${PAL.dark}; gap:8px; }

        .db-dash-bar { width:80px; height:12px; border:2px solid ${PAL.dark}; position:relative; overflow:hidden; }
        .db-dash-fill { position:absolute; left:0; top:0; bottom:0; background:${PAL.cyan}; transition:width .1s; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* ── HUD ── */}
      <div className="db-hud">
        <div className="db-hud-col">
          <p className="db-score">{score}</p>
          <p className="db-best">HI {displayedBest}</p>
          {hasScoreMult && <p className="db-mult">x2 {(scoreMultTimerMs / 1000).toFixed(0)}s</p>}
        </div>
        <div className="db-hud-col">
          <p className="db-time">{elapsedSec.toFixed(1)}s</p>
          <p className="db-stage-label">STG {stage}</p>
          {isCleared && <p style={{ fontSize: '10px', color: PAL.yellow, margin: 0, animation: 'db-pulse .5s infinite alternate' }}>CLEAR!</p>}
          <div className="db-status">
            {shieldTimerMs > 0 && <span className="db-pill" style={{ borderColor: PAL.cyan }}>SH{(shieldTimerMs / 1000).toFixed(0)}</span>}
            {slowmoTimerMs > 0 && <span className="db-pill" style={{ borderColor: PAL.purple }}>SL{(slowmoTimerMs / 1000).toFixed(0)}</span>}
            {magnetActive && <span className="db-pill" style={{ borderColor: PAL.orange }}>MG</span>}
          </div>
        </div>
        <div className="db-hud-col">
          <p className="db-hearts">
            {hearts.map((alive, i) => <span key={i} className={alive ? 'db-heart-alive' : 'db-heart-lost'}>{alive ? '\u2665' : '\u2661'}</span>)}
          </p>
          {combo >= 3 && <span className="db-combo">x{combo}</span>}
          {isFever && <span className="db-fever">FEVER!</span>}
          <p className="db-coins">{totalCoins} COIN</p>
        </div>
      </div>

      {/* ── Arena ── */}
      <div className="db-arena-wrap">
        <div className={`db-arena ${isHitFlash ? 'hit-flash' : ''} ${isFever ? 'fever-bg' : ''}`} ref={arenaRef}
          onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp} onDoubleClick={handleDoubleClick} role="presentation" style={{ touchAction: 'none' }}>

          {stageFlash && <div className="db-stage-banner">{stageFlash}</div>}
          <div className="db-scanlines" />
          <div className="db-crt" />

          <svg className="db-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
            {/* Grid dots */}
            {Array.from({ length: 15 }, (_, i) => Array.from({ length: 26 }, (_, j) => (
              <rect key={`gd-${i}-${j}`} x={(i + 1) * (VW / 16)} y={(j + 1) * (VH / 27)} width="1" height="1" fill={PAL.bg2} opacity="0.5" />
            )))}

            {/* Border */}
            <rect x="0" y="0" width={VW} height="2" fill={PAL.dark} />
            <rect x="0" y={VH - 2} width={VW} height="2" fill={PAL.dark} />
            <rect x="0" y="0" width="2" height={VH} fill={PAL.dark} />
            <rect x={VW - 2} y="0" width="2" height={VH} fill={PAL.dark} />

            {/* Fever border flash */}
            {feverBlink && <>
              <rect x="0" y="0" width={VW} height="2" fill={PAL.yellow} />
              <rect x="0" y={VH - 2} width={VW} height="2" fill={PAL.yellow} />
              <rect x="0" y="0" width="2" height={VH} fill={PAL.yellow} />
              <rect x={VW - 2} y="0" width="2" height={VH} fill={PAL.yellow} />
            </>}

            {/* Edge warnings (incoming ball indicators) */}
            {edgeWarnings.map((w, i) => {
              const blink = Math.floor(elapsedMs / 100) % 2 === 0
              if (!blink) return null
              if (w.side === 'top') return <rect key={`ew-${i}`} x={w.pos - 4} y={0} width={8} height={4} fill={w.color} opacity="0.7" />
              if (w.side === 'bottom') return <rect key={`ew-${i}`} x={w.pos - 4} y={VH - 4} width={8} height={4} fill={w.color} opacity="0.7" />
              if (w.side === 'left') return <rect key={`ew-${i}`} x={0} y={w.pos - 4} width={4} height={8} fill={w.color} opacity="0.7" />
              return <rect key={`ew-${i}`} x={VW - 4} y={w.pos - 4} width={4} height={8} fill={w.color} opacity="0.7" />
            })}

            {/* Coins */}
            {coins.filter(c => !c.collected).map(c => {
              const age = (elapsedMs - c.spawnedAt) / 1000
              const blink = age > 4 && Math.floor(age * 6) % 2 === 0
              return <g key={`coin-${c.id}`} opacity={blink ? 0.3 : 1}>
                <rect x={c.x - COIN_SIZE / 2} y={c.y - COIN_SIZE / 2} width={COIN_SIZE} height={COIN_SIZE} fill={PAL.yellow} />
                <rect x={c.x - COIN_SIZE / 2 + 2} y={c.y - COIN_SIZE / 2 + 2} width={COIN_SIZE - 4} height={COIN_SIZE - 4} fill={PAL.orange} />
              </g>
            })}

            {/* Power-ups */}
            {powerUps.filter(pu => !pu.collected).map(pu => {
              const blink = Math.floor(elapsedMs / 300) % 2 === 0
              return <g key={`pu-${pu.id}`}>
                <rect x={pu.x - POWERUP_SIZE / 2 - 2} y={pu.y - POWERUP_SIZE / 2 - 2} width={POWERUP_SIZE + 4} height={POWERUP_SIZE + 4} fill={blink ? getPUColor(pu.kind) : PAL.white} opacity="0.3" />
                <rect x={pu.x - POWERUP_SIZE / 2} y={pu.y - POWERUP_SIZE / 2} width={POWERUP_SIZE} height={POWERUP_SIZE} fill={getPUColor(pu.kind)} />
                <text x={pu.x} y={pu.y + 3} textAnchor="middle" fill={PAL.white} fontSize="6" fontFamily="'Press Start 2P',monospace" style={{ pointerEvents: 'none' }}>{getPULabel(pu.kind)}</text>
              </g>
            })}

            {/* Balls */}
            {balls.map(ball => (
              <g key={`ball-${ball.id}`}>
                <rect x={ball.x - ball.size / 2 + 1} y={ball.y - ball.size / 2 + 1} width={ball.size} height={ball.size} fill={PAL.black} opacity="0.4" />
                <rect x={ball.x - ball.size / 2} y={ball.y - ball.size / 2} width={ball.size} height={ball.size} fill={ball.color} />
                <rect x={ball.x - ball.size / 2} y={ball.y - ball.size / 2} width={ball.size / 2} height={ball.size / 2} fill={PAL.white} opacity="0.25" />
                {ball.pattern === 'sniper' && <>
                  <rect x={ball.x - ball.size - 2} y={ball.y - 0.5} width={ball.size * 2 + 4} height="1" fill={PAL.red} opacity="0.5" />
                  <rect x={ball.x - 0.5} y={ball.y - ball.size - 2} width="1" height={ball.size * 2 + 4} fill={PAL.red} opacity="0.5" />
                </>}
                {ball.splittable && <rect x={ball.x - 1} y={ball.y - 1} width="2" height="2" fill={PAL.white} />}
              </g>
            ))}

            {/* Dash trails */}
            {dashTrails.map((t, i) => (
              <rect key={`dt-${i}`} x={t.x - CHARACTER_SIZE / 4} y={t.y - CHARACTER_SIZE / 4} width={CHARACTER_SIZE / 2} height={CHARACTER_SIZE / 2} fill={PAL.cyan} opacity={t.opacity * 0.3} />
            ))}

            {/* Pixel explosions */}
            {pixelExplosions.map(exp => {
              const age = (elapsedMs - exp.createdAt + 1) / 600
              return exp.pixels.map((p, pi) => (
                <rect key={`px-${exp.id}-${pi}`} x={exp.x + p.dx - PX / 2} y={exp.y + p.dy - PX / 2} width={PX} height={PX} fill={p.color} opacity={Math.max(0, 1 - age)} />
              ))
            })}

            {/* Near-miss ring effect */}
            {nearMissFlash && (
              <rect x={playerX - CHARACTER_SIZE * 0.6} y={playerY - CHARACTER_SIZE * 0.6} width={CHARACTER_SIZE * 1.2} height={CHARACTER_SIZE * 1.2}
                fill="none" stroke={PAL.yellow} strokeWidth="1" opacity="0.5">
                <animate attributeName="opacity" values="0.5;0" dur="0.3s" fill="freeze" />
              </rect>
            )}

            {/* Character */}
            <image
              href={characterSprite}
              x={playerX - CHARACTER_SIZE / 2} y={playerY - CHARACTER_SIZE / 2}
              width={CHARACTER_SIZE} height={CHARACTER_SIZE}
              preserveAspectRatio="xMidYMid meet"
              opacity={invBlink ? 0.2 : 1}
              style={{ imageRendering: 'pixelated' }}
            />

            {/* Shield box */}
            {shieldTimerMs > 0 && (
              <rect x={playerX - CHARACTER_RADIUS - 6} y={playerY - CHARACTER_RADIUS - 6} width={(CHARACTER_RADIUS + 6) * 2} height={(CHARACTER_RADIUS + 6) * 2}
                fill="none" stroke={PAL.cyan} strokeWidth="2" strokeDasharray="4 2" opacity="0.7">
                <animate attributeName="stroke-dashoffset" values="0;12" dur="0.5s" repeatCount="indefinite" />
              </rect>
            )}

            {/* Invincible flash border */}
            {isInvincible && shieldTimerMs <= 0 && (
              <rect x={playerX - CHARACTER_RADIUS - 4} y={playerY - CHARACTER_RADIUS - 4} width={(CHARACTER_RADIUS + 4) * 2} height={(CHARACTER_RADIUS + 4) * 2}
                fill="none" stroke={PAL.white} strokeWidth="1" opacity="0.4" strokeDasharray="3 2">
                <animate attributeName="stroke-dashoffset" values="0;10" dur="0.4s" repeatCount="indefinite" />
              </rect>
            )}

            {/* Magnet range */}
            {magnetActive && (
              <rect x={playerX - 50} y={playerY - 50} width="100" height="100" fill="none" stroke={PAL.orange} strokeWidth="1" strokeDasharray="4 4" opacity="0.3">
                <animate attributeName="opacity" values="0.3;0.1;0.3" dur="1s" repeatCount="indefinite" />
              </rect>
            )}

            {/* Score x2 glow */}
            {hasScoreMult && (
              <rect x={playerX - CHARACTER_RADIUS - 8} y={playerY - CHARACTER_RADIUS - 8} width={(CHARACTER_RADIUS + 8) * 2} height={(CHARACTER_RADIUS + 8) * 2}
                fill="none" stroke={PAL.yellow} strokeWidth="1" opacity="0.3">
                <animate attributeName="opacity" values="0.3;0.1;0.3" dur="0.6s" repeatCount="indefinite" />
              </rect>
            )}
          </svg>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="db-footer">
        <div className="db-dash-bar"><div className="db-dash-fill" style={{ width: `${dashPct * 100}%` }} /></div>
        <span style={{ fontSize: '10px', color: dashReady ? PAL.cyan : PAL.dark }}>DASH</span>
      </div>
    </section>
  )
}

export const dodgeBallModule: MiniGameModule = {
  manifest: {
    id: 'dodge-ball',
    title: 'Dodge Ball',
    description: 'Retro arcade dodge! Survive waves, collect coins, go FEVER!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#ff004d',
  },
  Component: DodgeBallGame,
}
