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

// ─── Layout: 9:16 full vertical ────────────────────────────
const VW = 360
const VH = 640
const CHARACTER_RADIUS = 22
const CHARACTER_SIZE = 68
const BALL_RADIUS = 10
const MAX_HP = 3
const CLEAR_TIME_MS = 30000
const CLEAR_BONUS = 500
const INVINCIBILITY_MS = 1000
const HIT_FLASH_MS = 120
const SCORE_PER_SECOND = 10
const SHIELD_DURATION_MS = 3000
const SLOWMO_DURATION_MS = 4000
const SLOWMO_FACTOR = 0.4
const POWERUP_SPAWN_INTERVAL_MS = 7000
const POWERUP_RADIUS = 16
const POWERUP_COLLECT_DISTANCE = 40
const SURVIVAL_MILESTONE_INTERVAL_S = 10
const SURVIVAL_MILESTONE_BONUS = 100

// ─── Dash ───────────────────────────────────────────────────
const DASH_COOLDOWN_MS = 2500
const DASH_DISTANCE = 100
const DASH_INVINCIBILITY_MS = 300
const DASH_TRAIL_COUNT = 5

// ─── Ball spawning ──────────────────────────────────────────
const INITIAL_SPAWN_INTERVAL_MS = 1200
const MIN_SPAWN_INTERVAL_MS = 280
const SPAWN_INTERVAL_DECAY_PER_SECOND = 30
const INITIAL_BALL_SPEED = 130
const MAX_BALL_SPEED = 380
const BALL_SPEED_INCREASE_PER_SECOND = 8

// ─── Wave system ────────────────────────────────────────────
const WAVE_INTERVAL_MS = 10000
const WAVE_BALL_COUNT_BASE = 5
const WAVE_BALL_COUNT_INCREASE = 2

// ─── Combo ──────────────────────────────────────────────────
const NEAR_MISS_DISTANCE = 50
const COMBO_DECAY_MS = 2000
const COMBO_BONUS_PER_LEVEL = 5

const BALL_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'] as const

// ─── Ball patterns ──────────────────────────────────────────
type BallPattern = 'random' | 'spiral' | 'cross' | 'rain' | 'sniper'

type PowerUpKind = 'shield' | 'slowmo' | 'heal' | 'magnet'

interface PowerUp {
  readonly id: number
  readonly kind: PowerUpKind
  readonly x: number
  readonly y: number
  collected: boolean
  spawnedAt: number
}

interface Ball {
  readonly id: number
  x: number
  y: number
  vx: number
  vy: number
  readonly color: string
  readonly pattern: BallPattern
  readonly size: number
  trail: Array<{ x: number; y: number }>
}

interface DashTrail {
  x: number
  y: number
  opacity: number
  createdAt: number
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function spawnPowerUp(id: number, elapsed: number): PowerUp {
  const kinds: PowerUpKind[] = ['shield', 'slowmo', 'heal', 'magnet']
  const kind = kinds[Math.floor(Math.random() * kinds.length)]
  const x = 40 + Math.random() * (VW - 80)
  const y = 60 + Math.random() * (VH - 160)
  return { id, kind, x, y, collected: false, spawnedAt: elapsed }
}

function spawnBall(id: number, speed: number, pattern: BallPattern, targetX?: number, targetY?: number): Ball {
  let x: number, y: number, vx: number, vy: number
  const margin = BALL_RADIUS + 4
  const size = pattern === 'rain' ? BALL_RADIUS * 0.7 : (pattern === 'sniper' ? BALL_RADIUS * 1.3 : BALL_RADIUS)

  if (pattern === 'rain') {
    x = randomBetween(margin, VW - margin)
    y = -margin
    vx = randomBetween(-20, 20)
    vy = speed
  } else if (pattern === 'sniper' && targetX !== undefined && targetY !== undefined) {
    const side = Math.floor(Math.random() * 4)
    switch (side) {
      case 0: x = randomBetween(margin, VW - margin); y = -margin; break
      case 1: x = randomBetween(margin, VW - margin); y = VH + margin; break
      case 2: x = -margin; y = randomBetween(margin, VH - margin); break
      default: x = VW + margin; y = randomBetween(margin, VH - margin); break
    }
    const dx = targetX - x, dy = targetY - y
    const d = Math.hypot(dx, dy)
    vx = (dx / d) * speed * 1.3
    vy = (dy / d) * speed * 1.3
  } else if (pattern === 'spiral') {
    const angle = Math.random() * Math.PI * 2
    x = VW / 2 + Math.cos(angle) * (VW / 2 + margin)
    y = VH / 2 + Math.sin(angle) * (VH / 2 + margin)
    const toCenter = Math.atan2(VH / 2 - y, VW / 2 - x) + 0.5
    vx = Math.cos(toCenter) * speed
    vy = Math.sin(toCenter) * speed
  } else if (pattern === 'cross') {
    const axis = Math.random() < 0.5
    if (axis) {
      x = Math.random() < 0.5 ? -margin : VW + margin
      y = VH / 2 + randomBetween(-80, 80)
      vx = x < 0 ? speed : -speed
      vy = randomBetween(-30, 30)
    } else {
      x = VW / 2 + randomBetween(-80, 80)
      y = Math.random() < 0.5 ? -margin : VH + margin
      vx = randomBetween(-30, 30)
      vy = y < 0 ? speed : -speed
    }
  } else {
    const side = Math.floor(Math.random() * 4)
    const innerPad = 40
    switch (side) {
      case 0: x = randomBetween(margin, VW - margin); y = -margin; break
      case 1: x = randomBetween(margin, VW - margin); y = VH + margin; break
      case 2: x = -margin; y = randomBetween(margin, VH - margin); break
      default: x = VW + margin; y = randomBetween(margin, VH - margin); break
    }
    const tx = randomBetween(innerPad, VW - innerPad)
    const ty = randomBetween(innerPad, VH - innerPad)
    const dx = tx - x, dy = ty - y
    const d = Math.hypot(dx, dy)
    vx = (dx / d) * speed
    vy = (dy / d) * speed
  }

  const color = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
  return { id, x, y, vx, vy, color, pattern, size, trail: [] }
}

function isBallOutOfBounds(ball: Ball): boolean {
  const margin = BALL_RADIUS + 80
  return ball.x < -margin || ball.x > VW + margin || ball.y < -margin || ball.y > VH + margin
}

function circlesCollide(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx, dy = ay - by
  const cr = ar + br
  return dx * dx + dy * dy <= cr * cr
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function getPatternForWave(wave: number): BallPattern {
  const patterns: BallPattern[] = ['random', 'rain', 'cross', 'spiral', 'sniper']
  return patterns[wave % patterns.length]
}

function getPowerUpEmoji(kind: PowerUpKind): string {
  switch (kind) {
    case 'shield': return 'S'
    case 'slowmo': return 'M'
    case 'heal': return '+'
    case 'magnet': return 'G'
  }
}

function getPowerUpColor(kind: PowerUpKind): string {
  switch (kind) {
    case 'shield': return '#3b82f6'
    case 'slowmo': return '#a855f7'
    case 'heal': return '#22c55e'
    case 'magnet': return '#f59e0b'
  }
}

function DodgeBallGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [playerX, setPlayerX] = useState(VW / 2)
  const [playerY, setPlayerY] = useState(VH * 0.7)
  const [hp, setHp] = useState(MAX_HP)
  const [score, setScore] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [balls, setBalls] = useState<Ball[]>([])
  const [isHitFlash, setHitFlash] = useState(false)
  const [isInvincible, setIsInvincible] = useState(false)
  const [isCleared, setIsCleared] = useState(false)
  const [powerUps, setPowerUps] = useState<PowerUp[]>([])
  const [shieldTimerMs, setShieldTimerMs] = useState(0)
  const [slowmoTimerMs, setSlowmoTimerMs] = useState(0)
  const [combo, setCombo] = useState(0)
  const [waveNumber, setWaveNumber] = useState(0)
  const [waveFlash, setWaveFlash] = useState(false)
  const [dashCooldownMs, setDashCooldownMs] = useState(0)
  const [dashTrails, setDashTrails] = useState<DashTrail[]>([])
  const [magnetActive, setMagnetActive] = useState(false)

  const effects = useGameEffects()

  const refs = useRef({
    playerX: VW / 2,
    playerY: VH * 0.7,
    hp: MAX_HP,
    score: 0,
    elapsedMs: 0,
    balls: [] as Ball[],
    nextBallId: 0,
    spawnTimer: 0,
    invincibleTimer: 0,
    finished: false,
    cleared: false,
    animFrame: null as number | null,
    lastFrameAt: null as number | null,
    pointerActive: false,
    pointerTarget: null as { x: number; y: number } | null,
    lastScorePopupMs: 0,
    powerUps: [] as PowerUp[],
    nextPowerUpId: 0,
    lastPowerUpSpawnMs: 0,
    shieldTimerMs: 0,
    slowmoTimerMs: 0,
    lastMilestone: 0,
    combo: 0,
    lastComboMs: 0,
    waveNumber: 0,
    lastWaveMs: 0,
    dashCooldownMs: 0,
    dashTrails: [] as DashTrail[],
    magnetTimerMs: 0,
  })

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const arenaRef = useRef<HTMLDivElement | null>(null)

  const playSfx = useCallback((key: string, volume = 0.5, rate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const finishGame = useCallback(() => {
    if (refs.current.finished) return
    refs.current.finished = true
    const finalDurationMs = refs.current.elapsedMs > 0 ? Math.round(refs.current.elapsedMs) : Math.round(DEFAULT_FRAME_MS)
    onFinish({ score: refs.current.score, durationMs: finalDurationMs })
  }, [onFinish])

  const clientToArena = useCallback((clientX: number, clientY: number) => {
    const arena = arenaRef.current
    if (!arena) return { x: VW / 2, y: VH / 2 }
    const rect = arena.getBoundingClientRect()
    return {
      x: clamp((clientX - rect.left) * (VW / rect.width), CHARACTER_RADIUS, VW - CHARACTER_RADIUS),
      y: clamp((clientY - rect.top) * (VH / rect.height), CHARACTER_RADIUS, VH - CHARACTER_RADIUS),
    }
  }, [])

  const performDash = useCallback((targetX: number, targetY: number) => {
    const r = refs.current
    if (r.dashCooldownMs > 0 || r.finished) return
    const dx = targetX - r.playerX, dy = targetY - r.playerY
    const d = Math.hypot(dx, dy)
    if (d < 10) return
    const dashDist = Math.min(DASH_DISTANCE, d)
    const nx = r.playerX + (dx / d) * dashDist
    const ny = r.playerY + (dy / d) * dashDist
    const cx = clamp(nx, CHARACTER_RADIUS, VW - CHARACTER_RADIUS)
    const cy = clamp(ny, CHARACTER_RADIUS, VH - CHARACTER_RADIUS)

    // Add dash trails
    const trails: DashTrail[] = []
    for (let i = 0; i < DASH_TRAIL_COUNT; i++) {
      const t = i / DASH_TRAIL_COUNT
      trails.push({
        x: r.playerX + (cx - r.playerX) * t,
        y: r.playerY + (cy - r.playerY) * t,
        opacity: 0.6 - t * 0.4,
        createdAt: performance.now(),
      })
    }
    r.dashTrails = [...r.dashTrails, ...trails]
    setDashTrails([...r.dashTrails])

    r.playerX = cx
    r.playerY = cy
    setPlayerX(cx)
    setPlayerY(cy)
    r.dashCooldownMs = DASH_COOLDOWN_MS
    setDashCooldownMs(DASH_COOLDOWN_MS)
    r.invincibleTimer = Math.max(r.invincibleTimer, DASH_INVINCIBILITY_MS)
    setIsInvincible(true)

    playSfx('dash', 0.5)
    effects.spawnParticles(4, cx, cy)
  }, [playSfx, effects])

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const r = refs.current
    r.pointerActive = true
    const target = clientToArena(event.clientX, event.clientY)
    r.pointerTarget = target
    r.playerX = target.x
    r.playerY = target.y
    setPlayerX(target.x)
    setPlayerY(target.y)
  }, [clientToArena])

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const r = refs.current
    if (!r.pointerActive && event.pointerType === 'mouse' && event.buttons === 0) return
    const target = clientToArena(event.clientX, event.clientY)
    r.pointerTarget = target
    r.playerX = target.x
    r.playerY = target.y
    setPlayerX(target.x)
    setPlayerY(target.y)
  }, [clientToArena])

  const handlePointerUp = useCallback(() => {
    refs.current.pointerActive = false
  }, [])

  const handleDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = clientToArena(event.clientX, event.clientY)
    performDash(target.x, target.y)
  }, [clientToArena, performDash])

  // ─── Init audio ───────────────────────────────────────────
  useEffect(() => {
    const loadAudio = (key: string, src: string | null) => {
      if (!src) return
      const a = new Audio(src)
      a.preload = 'auto'
      audioRefs.current[key] = a
    }
    loadAudio('hit', tapHitSfx)
    loadAudio('hitStrong', tapHitStrongSfx)
    loadAudio('gameOver', gameOverHitSfx)
    loadAudio('dodge', dodgeSfxFile)
    loadAudio('ballHit', hitSfxFile)
    loadAudio('shield', shieldSfxFile)
    loadAudio('slowmo', slowmoSfxFile)
    loadAudio('combo', comboSfxFile)
    loadAudio('milestone', milestoneSfxFile)
    loadAudio('warning', warningSfxFile)
    loadAudio('dash', dashSfxFile)

    const charImage = new Image()
    charImage.src = characterSprite
    void charImage.decode?.().catch(() => {})

    return () => {
      for (const a of Object.values(audioRefs.current)) {
        if (a) { a.pause(); a.currentTime = 0 }
      }
      effects.cleanup()
    }
  }, [])

  // ─── Keyboard ─────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return }
      if (refs.current.finished) return
      const step = 20
      let nx = refs.current.playerX, ny = refs.current.playerY
      switch (event.code) {
        case 'ArrowLeft': case 'KeyA': nx -= step; break
        case 'ArrowRight': case 'KeyD': nx += step; break
        case 'ArrowUp': case 'KeyW': ny -= step; break
        case 'ArrowDown': case 'KeyS': ny += step; break
        case 'Space':
          event.preventDefault()
          performDash(nx + (Math.random() - 0.5) * 60, ny - 60)
          return
        default: return
      }
      event.preventDefault()
      nx = clamp(nx, CHARACTER_RADIUS, VW - CHARACTER_RADIUS)
      ny = clamp(ny, CHARACTER_RADIUS, VH - CHARACTER_RADIUS)
      refs.current.playerX = nx
      refs.current.playerY = ny
      setPlayerX(nx)
      setPlayerY(ny)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit, performDash])

  // ─── Game loop ────────────────────────────────────────────
  useEffect(() => {
    refs.current.lastFrameAt = null

    const step = (now: number) => {
      const r = refs.current
      if (r.finished) { r.animFrame = null; return }

      if (r.lastFrameAt === null) r.lastFrameAt = now
      const deltaMs = Math.min(now - r.lastFrameAt, MAX_FRAME_DELTA_MS)
      r.lastFrameAt = now
      const dt = deltaMs / 1000

      r.elapsedMs += deltaMs
      setElapsedMs(r.elapsedMs)

      // ── Score ──
      const timeScore = Math.floor((r.elapsedMs / 1000) * SCORE_PER_SECOND)
      const comboBonus = r.combo * COMBO_BONUS_PER_LEVEL
      if (!r.cleared && r.elapsedMs >= CLEAR_TIME_MS) {
        r.cleared = true
        setIsCleared(true)
        r.score = timeScore + CLEAR_BONUS + comboBonus
        setScore(r.score)
        playSfx('milestone', 0.7, 1.2)
        effects.comboHitBurst(VW / 2, VH / 2, 10, CLEAR_BONUS)
      } else {
        const base = r.cleared ? timeScore + CLEAR_BONUS : timeScore
        r.score = base + comboBonus
        setScore(r.score)
      }

      // ── Combo decay ──
      if (r.combo > 0 && now - r.lastComboMs > COMBO_DECAY_MS) {
        r.combo = 0
        setCombo(0)
      }

      // ── Invincibility ──
      if (r.invincibleTimer > 0) {
        r.invincibleTimer = Math.max(0, r.invincibleTimer - deltaMs)
        setIsInvincible(r.invincibleTimer > 0)
      }

      // ── Dash cooldown ──
      if (r.dashCooldownMs > 0) {
        r.dashCooldownMs = Math.max(0, r.dashCooldownMs - deltaMs)
        setDashCooldownMs(r.dashCooldownMs)
      }

      // ── Shield timer ──
      if (r.shieldTimerMs > 0) {
        r.shieldTimerMs = Math.max(0, r.shieldTimerMs - deltaMs)
        setShieldTimerMs(r.shieldTimerMs)
      }

      // ── Slow-mo timer ──
      if (r.slowmoTimerMs > 0) {
        r.slowmoTimerMs = Math.max(0, r.slowmoTimerMs - deltaMs)
        setSlowmoTimerMs(r.slowmoTimerMs)
      }

      // ── Magnet timer ──
      if (r.magnetTimerMs > 0) {
        r.magnetTimerMs = Math.max(0, r.magnetTimerMs - deltaMs)
        setMagnetActive(r.magnetTimerMs > 0)
      }

      // ── Survival milestones ──
      const currentMilestone = Math.floor(r.elapsedMs / 1000 / SURVIVAL_MILESTONE_INTERVAL_S)
      if (currentMilestone > r.lastMilestone) {
        r.lastMilestone = currentMilestone
        r.score += SURVIVAL_MILESTONE_BONUS
        setScore(r.score)
        effects.comboHitBurst(r.playerX, r.playerY - 40, currentMilestone, SURVIVAL_MILESTONE_BONUS)
        playSfx('milestone', 0.5, 1.1)
      }

      // ── Wave system ──
      const currentWave = Math.floor(r.elapsedMs / WAVE_INTERVAL_MS)
      if (currentWave > r.waveNumber) {
        r.waveNumber = currentWave
        setWaveNumber(currentWave)
        setWaveFlash(true)
        setTimeout(() => setWaveFlash(false), 1200)
        playSfx('warning', 0.6)
        effects.triggerFlash('rgba(255,200,0,0.3)')

        const pattern = getPatternForWave(currentWave)
        const count = WAVE_BALL_COUNT_BASE + currentWave * WAVE_BALL_COUNT_INCREASE
        const speed = Math.min(MAX_BALL_SPEED, INITIAL_BALL_SPEED + (r.elapsedMs / 1000) * BALL_SPEED_INCREASE_PER_SECOND)
        for (let i = 0; i < count; i++) {
          const b = spawnBall(r.nextBallId++, speed, pattern, r.playerX, r.playerY)
          r.balls.push(b)
        }
      }

      // ── Power-up spawning ──
      if (r.elapsedMs - r.lastPowerUpSpawnMs >= POWERUP_SPAWN_INTERVAL_MS) {
        r.lastPowerUpSpawnMs = r.elapsedMs
        const newPU = spawnPowerUp(r.nextPowerUpId++, r.elapsedMs)
        r.powerUps.push(newPU)
        setPowerUps([...r.powerUps])
      }

      // ── Power-up collection ──
      const magnetDist = r.magnetTimerMs > 0 ? 120 : POWERUP_COLLECT_DISTANCE
      for (const pu of r.powerUps) {
        if (pu.collected) continue
        // Auto-expire after 12s
        if (r.elapsedMs - pu.spawnedAt > 12000) { pu.collected = true; continue }
        const dx = r.playerX - pu.x, dy = r.playerY - pu.y
        if (dx * dx + dy * dy <= magnetDist * magnetDist) {
          pu.collected = true
          switch (pu.kind) {
            case 'shield':
              r.shieldTimerMs = SHIELD_DURATION_MS
              setShieldTimerMs(SHIELD_DURATION_MS)
              effects.triggerFlash('rgba(59,130,246,0.3)')
              playSfx('shield', 0.5)
              break
            case 'slowmo':
              r.slowmoTimerMs = SLOWMO_DURATION_MS
              setSlowmoTimerMs(SLOWMO_DURATION_MS)
              effects.triggerFlash('rgba(168,85,247,0.3)')
              playSfx('slowmo', 0.5)
              break
            case 'heal':
              if (r.hp < MAX_HP) {
                r.hp++
                setHp(r.hp)
                effects.triggerFlash('rgba(34,197,94,0.3)')
                effects.showScorePopup(0, r.playerX, r.playerY - 40)
              }
              playSfx('hitStrong', 0.4, 1.3)
              break
            case 'magnet':
              r.magnetTimerMs = 5000
              setMagnetActive(true)
              effects.triggerFlash('rgba(245,158,11,0.3)')
              playSfx('hitStrong', 0.4, 0.8)
              break
          }
          effects.spawnParticles(5, pu.x, pu.y)
          setPowerUps([...r.powerUps])
        }
      }
      r.powerUps = r.powerUps.filter(pu => !pu.collected)

      const slowMult = r.slowmoTimerMs > 0 ? SLOWMO_FACTOR : 1

      // ── Regular ball spawning ──
      const elapsedSec = r.elapsedMs / 1000
      const currentBallSpeed = Math.min(MAX_BALL_SPEED, INITIAL_BALL_SPEED + elapsedSec * BALL_SPEED_INCREASE_PER_SECOND) * slowMult
      const currentSpawnInterval = Math.max(MIN_SPAWN_INTERVAL_MS, INITIAL_SPAWN_INTERVAL_MS - elapsedSec * SPAWN_INTERVAL_DECAY_PER_SECOND)

      r.spawnTimer += deltaMs
      while (r.spawnTimer >= currentSpawnInterval) {
        r.spawnTimer -= currentSpawnInterval
        const pattern: BallPattern = Math.random() < 0.15 ? 'sniper' : 'random'
        r.balls.push(spawnBall(r.nextBallId++, currentBallSpeed, pattern, r.playerX, r.playerY))
      }

      // ── Update balls ──
      const updated: Ball[] = []
      let hitDetected = false
      let nearMissCount = 0

      for (const ball of r.balls) {
        const nx = ball.x + ball.vx * dt * slowMult
        const ny = ball.y + ball.vy * dt * slowMult

        if (isBallOutOfBounds({ ...ball, x: nx, y: ny })) {
          // Near miss check
          const pdx = r.playerX - ball.x, pdy = r.playerY - ball.y
          const pd = Math.hypot(pdx, pdy)
          if (pd < NEAR_MISS_DISTANCE + CHARACTER_RADIUS) {
            nearMissCount++
          }
          continue
        }

        if (r.invincibleTimer <= 0 && circlesCollide(r.playerX, r.playerY, CHARACTER_RADIUS, nx, ny, ball.size)) {
          if (r.shieldTimerMs > 0) {
            r.shieldTimerMs = 0
            setShieldTimerMs(0)
            effects.triggerFlash('rgba(59,130,246,0.5)')
            effects.spawnParticles(8, r.playerX, r.playerY)
            playSfx('shield', 0.6, 0.8)
            continue
          }
          hitDetected = true
          continue
        }

        // Update trail
        ball.trail = [...ball.trail.slice(-3), { x: ball.x, y: ball.y }]
        updated.push({ ...ball, x: nx, y: ny, trail: ball.trail })
      }

      r.balls = updated
      setBalls(updated)

      // ── Near miss combo ──
      if (nearMissCount > 0 && !hitDetected) {
        r.combo += nearMissCount
        r.lastComboMs = now
        setCombo(r.combo)
        if (r.combo >= 3) {
          playSfx('combo', 0.4, 0.9 + Math.min(r.combo * 0.05, 0.5))
          effects.showScorePopup(r.combo * COMBO_BONUS_PER_LEVEL, r.playerX, r.playerY - 50)
        }
      }

      // ── Hit detection ──
      if (hitDetected) {
        r.hp--
        setHp(r.hp)
        r.invincibleTimer = INVINCIBILITY_MS
        setIsInvincible(true)
        setHitFlash(true)
        setTimeout(() => setHitFlash(false), HIT_FLASH_MS)
        r.combo = 0
        setCombo(0)

        effects.triggerShake(10)
        effects.triggerFlash('rgba(239,68,68,0.5)')
        effects.spawnParticles(8, r.playerX, r.playerY)

        if (r.hp <= 0) {
          playSfx('gameOver', 0.65, 0.95)
          finishGame()
          r.animFrame = null
          return
        }
        playSfx('ballHit', 0.55)
      }

      // ── Dash trails decay ──
      r.dashTrails = r.dashTrails.filter(t => now - t.createdAt < 400)
      setDashTrails([...r.dashTrails])

      // ── Periodic score popup ──
      if (r.elapsedMs - r.lastScorePopupMs > 5000 && !r.finished) {
        r.lastScorePopupMs = r.elapsedMs
        effects.showScorePopup(Math.floor(5 * SCORE_PER_SECOND), r.playerX, r.playerY - 40)
        effects.spawnParticles(3, r.playerX, r.playerY)
      }

      effects.updateParticles()
      r.animFrame = window.requestAnimationFrame(step)
    }

    refs.current.animFrame = window.requestAnimationFrame(step)
    return () => {
      if (refs.current.animFrame !== null) {
        window.cancelAnimationFrame(refs.current.animFrame)
        refs.current.animFrame = null
      }
      refs.current.lastFrameAt = null
    }
  }, [finishGame, playSfx, effects, performDash])

  const displayedBestScore = Math.max(bestScore, score)
  const hearts = Array.from({ length: MAX_HP }, (_, i) => i < hp)
  const elapsedSec = elapsedMs / 1000
  const invincibleBlink = isInvincible && Math.floor(elapsedMs / 80) % 2 === 0
  const dashReady = dashCooldownMs <= 0
  const dashPct = dashCooldownMs > 0 ? 1 - dashCooldownMs / DASH_COOLDOWN_MS : 1

  return (
    <section
      className="mini-game-panel dodge-ball-panel"
      aria-label="dodge-ball-game"
      style={{
        maxWidth: '432px',
        width: '100%',
        height: '100%',
        margin: '0 auto',
        overflow: 'hidden',
        position: 'relative',
        ...effects.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .dodge-ball-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, #0f0a1e 0%, #1a0a2e 30%, #0f172a 70%, #020617 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .dodge-ball-hud {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 6px 10px;
          background: linear-gradient(180deg, rgba(220,38,38,0.2) 0%, transparent 100%);
          z-index: 10;
          flex-shrink: 0;
        }

        .dodge-ball-hud-left,
        .dodge-ball-hud-center,
        .dodge-ball-hud-right {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .dodge-ball-score {
          font-size: 2rem;
          font-weight: 900;
          color: #dc2626;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 12px rgba(220,38,38,0.5);
        }

        .dodge-ball-best {
          font-size: 10px;
          color: #6b7280;
          margin: 0;
        }

        .dodge-ball-time {
          font-size: 1.2rem;
          font-weight: 700;
          color: #e5e7eb;
          margin: 0;
        }

        .dodge-ball-clear-badge {
          font-size: 14px;
          font-weight: 900;
          color: #fbbf24;
          margin: 0;
          animation: dodge-ball-pulse 0.5s ease-in-out infinite alternate;
          text-shadow: 0 0 10px rgba(251,191,36,0.6);
        }

        @keyframes dodge-ball-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.15); }
        }

        .dodge-ball-hearts {
          font-size: 22px;
          margin: 0;
          display: flex;
          gap: 2px;
        }

        .dodge-ball-heart.alive { color: #ef4444; filter: drop-shadow(0 0 4px rgba(239,68,68,0.5)); }
        .dodge-ball-heart.lost { color: #374151; }

        .dodge-ball-arena-wrap {
          flex: 1;
          width: 100%;
          position: relative;
          overflow: hidden;
          min-height: 0;
        }

        .dodge-ball-arena {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 50% 40%, #1e293b 0%, #0f172a 50%, #020617 100%);
          cursor: none;
          transition: background 0.12s;
        }

        .dodge-ball-arena.hit-flash {
          background: radial-gradient(ellipse at 50% 40%, #3d1215 0%, #0f172a 50%, #020617 100%);
        }

        .dodge-ball-arena.cleared {
          background: radial-gradient(ellipse at 50% 40%, #1e293b 0%, #1a1a2e 50%, #0a0a1a 100%);
        }

        .dodge-ball-svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        .dodge-ball-trail {
          opacity: 0.3;
        }

        .dodge-ball-ball {
          filter: drop-shadow(0 0 6px currentColor);
        }

        .dodge-ball-character {
          filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));
          transition: opacity 0.05s;
        }

        .dodge-ball-character.blink { opacity: 0.3; }

        .dodge-ball-shield-ring {
          animation: dodge-shield-spin 0.8s linear infinite;
        }

        @keyframes dodge-shield-spin {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: 20; }
        }

        .dodge-ball-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 6px 10px;
          flex-shrink: 0;
          z-index: 10;
        }

        .dodge-ball-action-button {
          padding: 8px 20px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(180deg, #ef4444 0%, #b91c1c 100%);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 3px 0 #7f1d1d, 0 4px 8px rgba(0,0,0,0.3);
        }

        .dodge-ball-action-button:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #7f1d1d;
        }

        .dodge-ball-action-button.ghost {
          background: transparent;
          color: #6b7280;
          border: 1px solid #374151;
          box-shadow: none;
        }

        .dodge-ball-combo {
          font-size: 1.5rem;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 12px rgba(251,191,36,0.6);
          animation: dodge-ball-pulse 0.3s ease-in-out;
        }

        .dodge-ball-wave-banner {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 2.5rem;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 20px rgba(251,191,36,0.8), 0 4px 8px rgba(0,0,0,0.5);
          z-index: 20;
          pointer-events: none;
          animation: dodge-wave-in 1.2s ease-out forwards;
        }

        @keyframes dodge-wave-in {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(2); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(0.8); }
        }

        .dodge-ball-dash-indicator {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          font-weight: 900;
          position: relative;
          overflow: hidden;
        }

        .dodge-ball-dash-fill {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(59,130,246,0.4);
          transition: height 0.1s;
        }

        .dodge-ball-status-bar {
          display: flex;
          gap: 4px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
        }

        .dodge-ball-status-pill {
          font-size: 9px;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 6px;
          color: #fff;
        }

        .dodge-ball-warning-ring {
          animation: dodge-warning-pulse 0.5s ease-in-out infinite;
        }

        @keyframes dodge-warning-pulse {
          0%, 100% { r: 80; opacity: 0; }
          50% { r: 120; opacity: 0.3; }
        }

        .dodge-ball-grid-line {
          stroke: rgba(100,116,139,0.08);
          stroke-width: 0.5;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* ── HUD ── */}
      <div className="dodge-ball-hud">
        <div className="dodge-ball-hud-left">
          <p className="dodge-ball-score">{score}</p>
          <p className="dodge-ball-best">BEST {displayedBestScore}</p>
        </div>
        <div className="dodge-ball-hud-center">
          <p className="dodge-ball-time">{elapsedSec.toFixed(1)}s</p>
          {isCleared && <p className="dodge-ball-clear-badge">CLEAR!</p>}
          <div className="dodge-ball-status-bar">
            {shieldTimerMs > 0 && <span className="dodge-ball-status-pill" style={{ background: '#3b82f6' }}>SHIELD {(shieldTimerMs / 1000).toFixed(1)}</span>}
            {slowmoTimerMs > 0 && <span className="dodge-ball-status-pill" style={{ background: '#a855f7' }}>SLOW {(slowmoTimerMs / 1000).toFixed(1)}</span>}
            {magnetActive && <span className="dodge-ball-status-pill" style={{ background: '#f59e0b' }}>MAGNET</span>}
          </div>
        </div>
        <div className="dodge-ball-hud-right">
          <p className="dodge-ball-hearts">
            {hearts.map((alive, i) => (
              <span key={i} className={`dodge-ball-heart ${alive ? 'alive' : 'lost'}`}>
                {alive ? '\u2764' : '\u2661'}
              </span>
            ))}
          </p>
          {combo >= 3 && <span className="dodge-ball-combo">x{combo}</span>}
        </div>
      </div>

      {/* ── Arena ── */}
      <div className="dodge-ball-arena-wrap">
        <div
          className={`dodge-ball-arena ${isHitFlash ? 'hit-flash' : ''} ${isCleared ? 'cleared' : ''}`}
          ref={arenaRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onDoubleClick={handleDoubleClick}
          role="presentation"
          style={{ touchAction: 'none' }}
        >
          {waveFlash && <div className="dodge-ball-wave-banner">WAVE {waveNumber}</div>}

          <svg className="dodge-ball-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="none">
            {/* Grid lines for depth */}
            {Array.from({ length: 7 }, (_, i) => (
              <line key={`gv-${i}`} className="dodge-ball-grid-line" x1={(i + 1) * (VW / 8)} y1="0" x2={(i + 1) * (VW / 8)} y2={VH} />
            ))}
            {Array.from({ length: 9 }, (_, i) => (
              <line key={`gh-${i}`} className="dodge-ball-grid-line" x1="0" y1={(i + 1) * (VH / 10)} x2={VW} y2={(i + 1) * (VH / 10)} />
            ))}

            {/* Danger zone border glow */}
            <rect x="2" y="2" width={VW - 4} height={VH - 4} fill="none" stroke="rgba(220,38,38,0.15)" strokeWidth="2" rx="4" />

            {/* Power-ups */}
            {powerUps.filter(pu => !pu.collected).map((pu) => (
              <g key={`pu-${pu.id}`}>
                <circle cx={pu.x} cy={pu.y} r={POWERUP_RADIUS + 6} fill="none" stroke={getPowerUpColor(pu.kind)} strokeWidth="1" opacity="0.3">
                  <animate attributeName="r" values={`${POWERUP_RADIUS + 4};${POWERUP_RADIUS + 10};${POWERUP_RADIUS + 4}`} dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0.1;0.3" dur="1.5s" repeatCount="indefinite" />
                </circle>
                <circle cx={pu.x} cy={pu.y} r={POWERUP_RADIUS} fill={getPowerUpColor(pu.kind)} opacity="0.85">
                  <animate attributeName="r" values={`${POWERUP_RADIUS - 2};${POWERUP_RADIUS + 2};${POWERUP_RADIUS - 2}`} dur="1s" repeatCount="indefinite" />
                </circle>
                <text x={pu.x} y={pu.y + 5} textAnchor="middle" fill="#fff" fontSize="13" fontWeight="bold" style={{ pointerEvents: 'none' }}>
                  {getPowerUpEmoji(pu.kind)}
                </text>
              </g>
            ))}

            {/* Ball trails */}
            {balls.map((ball) => ball.trail.map((t, ti) => (
              <circle
                key={`trail-${ball.id}-${ti}`}
                cx={t.x} cy={t.y}
                r={ball.size * (0.3 + ti * 0.15)}
                fill={ball.color}
                opacity={0.08 + ti * 0.04}
              />
            )))}

            {/* Balls */}
            {balls.map((ball) => (
              <g key={`ball-${ball.id}`}>
                <circle
                  className="dodge-ball-ball"
                  cx={ball.x} cy={ball.y}
                  r={ball.size}
                  fill={ball.color}
                />
                {ball.pattern === 'sniper' && (
                  <circle cx={ball.x} cy={ball.y} r={ball.size + 4} fill="none" stroke="#ef4444" strokeWidth="1" opacity="0.5" />
                )}
              </g>
            ))}

            {/* Dash trails */}
            {dashTrails.map((t, i) => (
              <image
                key={`dt-${i}`}
                href={characterSprite}
                x={t.x - CHARACTER_SIZE / 2}
                y={t.y - CHARACTER_SIZE / 2}
                width={CHARACTER_SIZE}
                height={CHARACTER_SIZE}
                opacity={t.opacity * 0.4}
                preserveAspectRatio="xMidYMid meet"
              />
            ))}

            {/* Warning indicator when sniper balls target you */}
            {balls.some(b => b.pattern === 'sniper') && (
              <circle className="dodge-ball-warning-ring" cx={playerX} cy={playerY} r={80} fill="none" stroke="#ef4444" strokeWidth="1.5" />
            )}

            {/* Character */}
            <image
              className={`dodge-ball-character ${invincibleBlink ? 'blink' : ''}`}
              href={characterSprite}
              x={playerX - CHARACTER_SIZE / 2}
              y={playerY - CHARACTER_SIZE / 2}
              width={CHARACTER_SIZE}
              height={CHARACTER_SIZE}
              preserveAspectRatio="xMidYMid meet"
              opacity={invincibleBlink ? 0.3 : 1}
            />

            {/* Shield visual */}
            {shieldTimerMs > 0 && (
              <circle
                cx={playerX} cy={playerY}
                r={CHARACTER_RADIUS + 10}
                fill="none"
                stroke="rgba(59,130,246,0.6)"
                strokeWidth="3"
                strokeDasharray="8 4"
                className="dodge-ball-shield-ring"
              />
            )}

            {/* Invincible ring */}
            {isInvincible && shieldTimerMs <= 0 && (
              <circle
                cx={playerX} cy={playerY}
                r={CHARACTER_RADIUS + 6}
                fill="none"
                stroke="rgba(255,255,255,0.3)"
                strokeWidth="1.5"
                strokeDasharray="5 3"
                className="dodge-ball-shield-ring"
              />
            )}

            {/* Magnet field */}
            {magnetActive && (
              <circle
                cx={playerX} cy={playerY}
                r={120}
                fill="none"
                stroke="rgba(245,158,11,0.2)"
                strokeWidth="1"
                strokeDasharray="4 4"
              >
                <animate attributeName="r" values="100;130;100" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}
          </svg>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="dodge-ball-footer">
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <div
            className="dodge-ball-dash-indicator"
            style={{ border: `2px solid ${dashReady ? '#3b82f6' : '#374151'}`, color: dashReady ? '#3b82f6' : '#374151' }}
          >
            <div className="dodge-ball-dash-fill" style={{ height: `${dashPct * 100}%` }} />
            <span style={{ zIndex: 1 }}>D</span>
          </div>
          <span style={{ fontSize: '10px', color: '#6b7280' }}>Double-tap to dash</span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="dodge-ball-action-button" type="button" onClick={() => { playSfx('hitStrong', 0.5); finishGame() }}>FINISH</button>
          <button className="dodge-ball-action-button ghost" type="button" onClick={onExit}>EXIT</button>
        </div>
      </div>
    </section>
  )
}

export const dodgeBallModule: MiniGameModule = {
  manifest: {
    id: 'dodge-ball',
    title: 'Dodge Ball',
    description: 'Dodge balls from all sides! Dash, combo, survive!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#dc2626',
  },
  Component: DodgeBallGame,
}
