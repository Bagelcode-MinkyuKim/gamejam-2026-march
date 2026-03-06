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
const PX = 4 // pixel unit size
const CHARACTER_RADIUS = 10
const CHARACTER_SIZE = 48
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

// ─── Dash ───────────────────────────────────────────────────
const DASH_COOLDOWN_MS = 2000
const DASH_DISTANCE = 80
const DASH_INVINCIBILITY_MS = 300

// ─── Ball spawning ──────────────────────────────────────────
const INITIAL_SPAWN_INTERVAL_MS = 1000
const MIN_SPAWN_INTERVAL_MS = 200
const SPAWN_INTERVAL_DECAY_PER_SECOND = 25
const INITIAL_BALL_SPEED = 100
const MAX_BALL_SPEED = 320
const BALL_SPEED_INCREASE_PER_SECOND = 7

// ─── Stage / Wave ───────────────────────────────────────────
const STAGE_INTERVAL_MS = 12000
const WAVE_BALL_COUNT_BASE = 6
const WAVE_BALL_COUNT_INCREASE = 3
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

const BALL_COLORS = [PAL.red, PAL.orange, PAL.yellow, PAL.green, PAL.cyan, PAL.purple, PAL.pink] as const

type BallPattern = 'random' | 'spiral' | 'cross' | 'rain' | 'sniper' | 'split'
type PowerUpKind = 'shield' | 'slowmo' | 'heal' | 'bomb' | 'magnet'

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

function rand(min: number, max: number) { return min + Math.random() * (max - min) }
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function spawnPowerUp(id: number, elapsed: number): PowerUp {
  const kinds: PowerUpKind[] = ['shield', 'slowmo', 'heal', 'bomb', 'magnet']
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
  const patterns: BallPattern[] = ['random', 'rain', 'cross', 'spiral', 'sniper', 'split']
  return patterns[stage % patterns.length]
}

function getPUColor(k: PowerUpKind): string {
  switch (k) { case 'shield': return PAL.cyan; case 'slowmo': return PAL.purple; case 'heal': return PAL.green; case 'bomb': return PAL.red; case 'magnet': return PAL.orange }
}

function getPULabel(k: PowerUpKind): string {
  switch (k) { case 'shield': return 'SH'; case 'slowmo': return 'SL'; case 'heal': return 'HP'; case 'bomb': return 'BM'; case 'magnet': return 'MG' }
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
  const [stageFlash, setStageFlash] = useState('')
  const [dashCooldownMs, setDashCooldownMs] = useState(0)
  const [dashTrails, setDashTrails] = useState<DashTrail[]>([])
  const [magnetActive, setMagnetActive] = useState(false)
  const [pixelExplosions, setPixelExplosions] = useState<PixelExplosion[]>([])
  const [isFever, setIsFever] = useState(false)
  const [totalCoins, setTotalCoins] = useState(0)

  const effects = useGameEffects()

  const r = useRef({
    playerX: VW / 2, playerY: VH * 0.72, hp: MAX_HP, score: 0, elapsedMs: 0,
    balls: [] as Ball[], nextBallId: 0, spawnTimer: 0, invincibleTimer: 0,
    finished: false, cleared: false, animFrame: null as number | null,
    lastFrameAt: null as number | null, pointerActive: false,
    lastScorePopupMs: 0, powerUps: [] as PowerUp[], nextPUId: 0, lastPUSpawnMs: 0,
    shieldTimerMs: 0, slowmoTimerMs: 0, lastMilestone: 0,
    combo: 0, lastComboMs: 0, stage: 1, lastStageMs: 0,
    dashCooldownMs: 0, dashTrails: [] as DashTrail[], magnetTimerMs: 0,
    coins: [] as Coin[], nextCoinId: 0, totalCoins: 0,
    pixelExplosions: [] as PixelExplosion[], nextExpId: 0,
    isFever: false,
  })

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const arenaRef = useRef<HTMLDivElement | null>(null)

  const playSfx = useCallback((key: string, vol = 0.5, rate = 1) => {
    const a = audioRefs.current[key]; if (!a) return
    a.currentTime = 0; a.volume = Math.min(1, vol); a.playbackRate = rate
    void a.play().catch(() => {})
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
    effects.triggerShake(12); effects.triggerFlash('rgba(255,255,255,0.6)')
    s.score += s.balls.length * 10; setScore(s.score)
  }, [spawnPixelExplosion, playSfx, effects])

  // ─── Pointer ──────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); r.current.pointerActive = true
    const t = clientToArena(e.clientX, e.clientY); r.current.playerX = t.x; r.current.playerY = t.y; setPlayerX(t.x); setPlayerY(t.y)
  }, [clientToArena])
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!r.current.pointerActive && e.pointerType === 'mouse' && e.buttons === 0) return
    const t = clientToArena(e.clientX, e.clientY); r.current.playerX = t.x; r.current.playerY = t.y; setPlayerX(t.x); setPlayerY(t.y)
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
    const img = new Image(); img.src = characterSprite; void img.decode?.().catch(() => {})
    return () => { for (const a of Object.values(audioRefs.current)) { if (a) { a.pause(); a.currentTime = 0 } }; effects.cleanup() }
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

      // ── Fever mode ──
      const wasFever = s.isFever
      s.isFever = s.combo >= FEVER_COMBO_THRESHOLD
      if (s.isFever !== wasFever) setIsFever(s.isFever)
      const scoreMult = s.isFever ? FEVER_SCORE_MULTIPLIER : 1

      // ── Score ──
      const timeScore = Math.floor((s.elapsedMs / 1000) * SCORE_PER_SECOND * scoreMult)
      const comboBonus = s.combo * COMBO_BONUS_PER_LEVEL
      if (!s.cleared && s.elapsedMs >= CLEAR_TIME_MS) {
        s.cleared = true; setIsCleared(true)
        s.score = timeScore + CLEAR_BONUS + comboBonus; setScore(s.score)
        playSfx('levelup', 0.8, 1.2); effects.comboHitBurst(VW / 2, VH / 2, 10, CLEAR_BONUS)
        setStageFlash('STAGE CLEAR!!'); setTimeout(() => setStageFlash(''), 2000)
      } else {
        s.score = (s.cleared ? timeScore + CLEAR_BONUS : timeScore) + comboBonus; setScore(s.score)
      }

      // ── Combo decay ──
      if (s.combo > 0 && now - s.lastComboMs > COMBO_DECAY_MS) { s.combo = 0; setCombo(0) }

      // ── Timers ──
      if (s.invincibleTimer > 0) { s.invincibleTimer = Math.max(0, s.invincibleTimer - deltaMs); setIsInvincible(s.invincibleTimer > 0) }
      if (s.dashCooldownMs > 0) { s.dashCooldownMs = Math.max(0, s.dashCooldownMs - deltaMs); setDashCooldownMs(s.dashCooldownMs) }
      if (s.shieldTimerMs > 0) { s.shieldTimerMs = Math.max(0, s.shieldTimerMs - deltaMs); setShieldTimerMs(s.shieldTimerMs) }
      if (s.slowmoTimerMs > 0) { s.slowmoTimerMs = Math.max(0, s.slowmoTimerMs - deltaMs); setSlowmoTimerMs(s.slowmoTimerMs) }
      if (s.magnetTimerMs > 0) { s.magnetTimerMs = Math.max(0, s.magnetTimerMs - deltaMs); setMagnetActive(s.magnetTimerMs > 0) }

      // ── Survival milestones ──
      const curMilestone = Math.floor(s.elapsedMs / 1000 / 10)
      if (curMilestone > s.lastMilestone) {
        s.lastMilestone = curMilestone; s.score += 100 * scoreMult; setScore(s.score)
        effects.comboHitBurst(s.playerX, s.playerY - 30, curMilestone, 100)
        playSfx('milestone', 0.5, 1.1)
      }

      // ── Stage system ──
      const curStage = Math.floor(s.elapsedMs / STAGE_INTERVAL_MS) + 1
      if (curStage > s.stage) {
        s.stage = curStage; setStage(curStage)
        const isBoss = curStage % BOSS_STAGE_INTERVAL === 0
        if (isBoss) {
          setStageFlash(`BOSS WAVE ${curStage}`); playSfx('boss', 0.7)
          effects.triggerFlash('rgba(255,0,77,0.4)')
        } else {
          setStageFlash(`STAGE ${curStage}`); playSfx('warning', 0.5)
          effects.triggerFlash('rgba(255,236,39,0.25)')
        }
        setTimeout(() => setStageFlash(''), 1500)

        const pattern = isBoss ? 'sniper' as BallPattern : getPatternForStage(curStage)
        const count = isBoss ? WAVE_BALL_COUNT_BASE + curStage * 2 : WAVE_BALL_COUNT_BASE + curStage * WAVE_BALL_COUNT_INCREASE
        const spd = Math.min(MAX_BALL_SPEED, INITIAL_BALL_SPEED + (s.elapsedMs / 1000) * BALL_SPEED_INCREASE_PER_SECOND)
        for (let i = 0; i < count; i++) {
          s.balls.push(spawnBall(s.nextBallId++, isBoss ? spd * 1.3 : spd, pattern, s.playerX, s.playerY))
        }
        if (curStage % 2 === 0) {
          for (let i = 0; i < 3; i++) s.balls.push(spawnBall(s.nextBallId++, spd * 0.8, 'split', s.playerX, s.playerY))
        }
      }

      // ── Power-up spawn ──
      if (s.elapsedMs - s.lastPUSpawnMs >= POWERUP_SPAWN_INTERVAL_MS) {
        s.lastPUSpawnMs = s.elapsedMs; s.powerUps.push(spawnPowerUp(s.nextPUId++, s.elapsedMs)); setPowerUps([...s.powerUps])
      }

      // ── Power-up collect ──
      const magDist = s.magnetTimerMs > 0 ? 100 : POWERUP_COLLECT_DISTANCE
      for (const pu of s.powerUps) {
        if (pu.collected) continue
        if (s.elapsedMs - pu.spawnedAt > 12000) { pu.collected = true; continue }
        if (Math.abs(s.playerX - pu.x) < magDist && Math.abs(s.playerY - pu.y) < magDist) {
          pu.collected = true; spawnPixelExplosion(pu.x, pu.y, getPUColor(pu.kind), 8)
          switch (pu.kind) {
            case 'shield': s.shieldTimerMs = SHIELD_DURATION_MS; setShieldTimerMs(SHIELD_DURATION_MS); effects.triggerFlash('rgba(41,173,255,0.3)'); playSfx('shield', 0.5); break
            case 'slowmo': s.slowmoTimerMs = SLOWMO_DURATION_MS; setSlowmoTimerMs(SLOWMO_DURATION_MS); effects.triggerFlash('rgba(126,37,83,0.3)'); playSfx('slowmo', 0.5); break
            case 'heal': if (s.hp < MAX_HP) { s.hp++; setHp(s.hp) }; playSfx('hitStrong', 0.4, 1.3); effects.triggerFlash('rgba(0,228,54,0.3)'); break
            case 'bomb': clearAllBalls(); break
            case 'magnet': s.magnetTimerMs = 6000; setMagnetActive(true); effects.triggerFlash('rgba(255,163,0,0.3)'); playSfx('hitStrong', 0.4, 0.8); break
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
          effects.showScorePopup(COIN_SCORE * scoreMult, c.x, c.y - 10)
        }
      }
      s.coins = s.coins.filter(c => !c.collected); setCoins([...s.coins])

      const slowMult = s.slowmoTimerMs > 0 ? SLOWMO_FACTOR : 1

      // ── Regular ball spawn ──
      const elSec = s.elapsedMs / 1000
      const ballSpeed = Math.min(MAX_BALL_SPEED, INITIAL_BALL_SPEED + elSec * BALL_SPEED_INCREASE_PER_SECOND) * slowMult
      const spawnInterval = Math.max(MIN_SPAWN_INTERVAL_MS, INITIAL_SPAWN_INTERVAL_MS - elSec * SPAWN_INTERVAL_DECAY_PER_SECOND)
      s.spawnTimer += deltaMs
      while (s.spawnTimer >= spawnInterval) {
        s.spawnTimer -= spawnInterval
        const pat: BallPattern = Math.random() < 0.12 ? 'sniper' : Math.random() < 0.08 ? 'split' : 'random'
        s.balls.push(spawnBall(s.nextBallId++, ballSpeed, pat, s.playerX, s.playerY))
      }

      // ── Update balls ──
      const updated: Ball[] = []; let hitDetected = false; let nearMissCount = 0
      for (const ball of s.balls) {
        const nx = ball.x + ball.vx * dt * slowMult, ny = ball.y + ball.vy * dt * slowMult
        if (isBallOOB({ ...ball, x: nx, y: ny })) {
          const pd = Math.hypot(s.playerX - ball.x, s.playerY - ball.y)
          if (pd < NEAR_MISS_DISTANCE + CHARACTER_RADIUS) nearMissCount++
          // Coin drop chance
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
        // Split ball edge detection
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

      // ── Near miss combo ──
      if (nearMissCount > 0 && !hitDetected) {
        s.combo += nearMissCount; s.lastComboMs = now; setCombo(s.combo)
        if (s.combo >= 3) { playSfx('combo', 0.4, 0.9 + Math.min(s.combo * 0.04, 0.5)); effects.showScorePopup(s.combo * COMBO_BONUS_PER_LEVEL, s.playerX, s.playerY - 40) }
        if (s.combo === FEVER_COMBO_THRESHOLD) { playSfx('levelup', 0.6); effects.triggerFlash('rgba(255,236,39,0.4)') }
      }

      // ── Hit ──
      if (hitDetected) {
        s.hp--; setHp(s.hp); s.invincibleTimer = INVINCIBILITY_MS; setIsInvincible(true)
        setHitFlash(true); setTimeout(() => setHitFlash(false), HIT_FLASH_MS)
        s.combo = 0; setCombo(0); effects.triggerShake(12); effects.triggerFlash('rgba(255,0,77,0.5)')
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
        s.lastScorePopupMs = s.elapsedMs; effects.showScorePopup(Math.floor(5 * SCORE_PER_SECOND * scoreMult), s.playerX, s.playerY - 30)
      }
      effects.updateParticles(); s.animFrame = window.requestAnimationFrame(step)
    }
    r.current.animFrame = window.requestAnimationFrame(step)
    return () => { if (r.current.animFrame !== null) { window.cancelAnimationFrame(r.current.animFrame); r.current.animFrame = null }; r.current.lastFrameAt = null }
  }, [finishGame, playSfx, effects, spawnPixelExplosion, clearAllBalls])

  const displayedBest = Math.max(bestScore, score)
  const hearts = Array.from({ length: MAX_HP }, (_, i) => i < hp)
  const elapsedSec = elapsedMs / 1000
  const invBlink = isInvincible && Math.floor(elapsedMs / 80) % 2 === 0
  const dashReady = dashCooldownMs <= 0
  const dashPct = dashCooldownMs > 0 ? 1 - dashCooldownMs / DASH_COOLDOWN_MS : 1
  const feverBlink = isFever && Math.floor(elapsedMs / 200) % 2 === 0

  return (
    <section className="mini-game-panel db-panel" aria-label="dodge-ball-game" style={{ maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        .db-panel { display:flex; flex-direction:column; width:100%; height:100%; background:${PAL.bg0}; user-select:none; -webkit-user-select:none; touch-action:manipulation; font-family:'Press Start 2P',monospace; image-rendering:pixelated; }
        .db-panel * { image-rendering:pixelated; }

        .db-hud { display:flex; justify-content:space-between; align-items:flex-start; width:100%; padding:6px 8px; background:${PAL.bg1}; border-bottom:2px solid ${PAL.dark}; z-index:10; flex-shrink:0; gap:4px; }
        .db-hud-col { display:flex; flex-direction:column; align-items:center; gap:1px; }

        .db-score { font-size:16px; color:${PAL.yellow}; margin:0; line-height:1.2; text-shadow: 2px 2px ${PAL.black}; }
        .db-best { font-size:6px; color:${PAL.mid}; margin:0; }
        .db-time { font-size:10px; color:${PAL.white}; margin:0; }
        .db-stage-label { font-size:7px; color:${PAL.cyan}; margin:0; }
        .db-hearts { font-size:12px; margin:0; display:flex; gap:1px; }
        .db-heart-alive { color:${PAL.red}; text-shadow:0 0 4px ${PAL.red}; }
        .db-heart-lost { color:${PAL.dark}; }
        .db-combo { font-size:12px; color:${PAL.yellow}; text-shadow:2px 2px ${PAL.black}; animation:db-pulse .3s ease; }
        .db-fever { font-size:8px; color:${PAL.red}; animation:db-pulse .2s ease infinite alternate; text-shadow:0 0 8px ${PAL.red}; }
        .db-coins { font-size:7px; color:${PAL.yellow}; margin:0; }

        @keyframes db-pulse { from{transform:scale(1)} to{transform:scale(1.2)} }

        .db-status { display:flex; gap:3px; flex-wrap:wrap; justify-content:center; }
        .db-pill { font-size:6px; padding:1px 4px; border:1px solid; color:${PAL.white}; }

        .db-arena-wrap { flex:1; width:100%; position:relative; overflow:hidden; min-height:0; }
        .db-arena { position:absolute; inset:0; background:${PAL.bg0}; cursor:none; }
        .db-arena.hit-flash { background:${PAL.red}20; }
        .db-arena.fever-bg { background:${PAL.bg1}; }

        .db-svg { width:100%; height:100%; display:block; shape-rendering:crispEdges; }

        .db-scanlines { position:absolute; inset:0; pointer-events:none; z-index:5; background:repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px); }
        .db-crt { position:absolute; inset:0; pointer-events:none; z-index:6; box-shadow:inset 0 0 60px rgba(0,0,0,0.4); }

        .db-stage-banner { position:absolute; top:45%; left:50%; transform:translate(-50%,-50%); font-size:14px; color:${PAL.yellow}; text-shadow:2px 2px ${PAL.black},0 0 20px ${PAL.yellow}80; z-index:20; pointer-events:none; animation:db-banner 1.5s ease forwards; text-align:center; white-space:nowrap; }
        @keyframes db-banner { 0%{opacity:0;transform:translate(-50%,-50%) scale(2.5)} 15%{opacity:1;transform:translate(-50%,-50%) scale(1)} 75%{opacity:1} 100%{opacity:0;transform:translate(-50%,-50%) scale(0.8)} }

        .db-footer { display:flex; justify-content:space-between; align-items:center; width:100%; padding:4px 8px; flex-shrink:0; z-index:10; background:${PAL.bg1}; border-top:2px solid ${PAL.dark}; }
        .db-btn { padding:6px 14px; border:2px solid ${PAL.red}; background:${PAL.bg1}; color:${PAL.white}; font-size:8px; font-family:'Press Start 2P',monospace; cursor:pointer; }
        .db-btn:active { background:${PAL.red}; }
        .db-btn.ghost { border-color:${PAL.dark}; color:${PAL.mid}; }
        .db-btn.ghost:active { background:${PAL.dark}; }

        .db-dash-bar { width:40px; height:8px; border:1px solid ${PAL.dark}; position:relative; overflow:hidden; }
        .db-dash-fill { position:absolute; left:0; top:0; bottom:0; background:${PAL.cyan}; transition:width .1s; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* ── HUD ── */}
      <div className="db-hud">
        <div className="db-hud-col">
          <p className="db-score">{String(score).padStart(6, '0')}</p>
          <p className="db-best">HI {String(displayedBest).padStart(6, '0')}</p>
        </div>
        <div className="db-hud-col">
          <p className="db-time">{elapsedSec.toFixed(1)}s</p>
          <p className="db-stage-label">STG {stage}</p>
          {isCleared && <p style={{ fontSize: '6px', color: PAL.yellow, margin: 0, animation: 'db-pulse .5s infinite alternate' }}>CLEAR!</p>}
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

            {/* Balls (pixel squares!) */}
            {balls.map(ball => (
              <g key={`ball-${ball.id}`}>
                {/* Shadow */}
                <rect x={ball.x - ball.size / 2 + 1} y={ball.y - ball.size / 2 + 1} width={ball.size} height={ball.size} fill={PAL.black} opacity="0.4" />
                {/* Body */}
                <rect x={ball.x - ball.size / 2} y={ball.y - ball.size / 2} width={ball.size} height={ball.size} fill={ball.color} />
                {/* Highlight */}
                <rect x={ball.x - ball.size / 2} y={ball.y - ball.size / 2} width={ball.size / 2} height={ball.size / 2} fill={PAL.white} opacity="0.25" />
                {/* Sniper crosshair */}
                {ball.pattern === 'sniper' && <>
                  <rect x={ball.x - ball.size - 2} y={ball.y - 0.5} width={ball.size * 2 + 4} height="1" fill={PAL.red} opacity="0.5" />
                  <rect x={ball.x - 0.5} y={ball.y - ball.size - 2} width="1" height={ball.size * 2 + 4} fill={PAL.red} opacity="0.5" />
                </>}
                {/* Split ball indicator */}
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
          </svg>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="db-footer">
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <div className="db-dash-bar"><div className="db-dash-fill" style={{ width: `${dashPct * 100}%` }} /></div>
          <span style={{ fontSize: '6px', color: dashReady ? PAL.cyan : PAL.dark }}>DASH</span>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button className="db-btn" type="button" onClick={() => { playSfx('hitStrong', 0.5); finishGame() }}>END</button>
          <button className="db-btn ghost" type="button" onClick={onExit}>EXIT</button>
        </div>
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
