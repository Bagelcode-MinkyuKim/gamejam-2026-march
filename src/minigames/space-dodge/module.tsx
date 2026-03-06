import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'

import meteorHitSfx from '../../../assets/sounds/space-dodge-meteor-hit.mp3'
import starCollectSfx from '../../../assets/sounds/space-dodge-star-collect.mp3'
import shieldSfx from '../../../assets/sounds/space-dodge-shield.mp3'
import burstWarningSfx from '../../../assets/sounds/space-dodge-burst-warning.mp3'
import comboSfx from '../../../assets/sounds/space-dodge-combo.mp3'
import magnetSfx from '../../../assets/sounds/space-dodge-magnet.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import dodgeSfx from '../../../assets/sounds/space-dodge-dodge.mp3'
import hpRestoreSfx from '../../../assets/sounds/space-dodge-hp-restore.mp3'
import slowSfx from '../../../assets/sounds/space-dodge-slow.mp3'
import levelUpSfx from '../../../assets/sounds/space-dodge-level-up.mp3'
import coinSfx from '../../../assets/sounds/space-dodge-coin.mp3'
import dangerSfx from '../../../assets/sounds/space-dodge-danger.mp3'
import laserSfx from '../../../assets/sounds/space-dodge-laser.mp3'
import dashSfx from '../../../assets/sounds/space-dodge-dash.mp3'

// ─── Stage: 9:16 aspect, fills entire container ────────────────
const STAGE_WIDTH = 390
const STAGE_HEIGHT = 693

// ─── Player ───────────────────────────────────────────────────────
const PLAYER_SIZE = 72
const PLAYER_COLLIDER_RADIUS = 26
const PLAYER_Y_OFFSET = 100
const PLAYER_LERP_SPEED = 0.18

// ─── HP ───────────────────────────────────────────────────────
const INITIAL_HP = 3
const MAX_HP = 5

// ─── Meteors ──────────────────────────────────────────────────
const METEOR_BASE_SPEED = 150
const METEOR_MAX_SPEED = 420
const METEOR_SPEED_RAMP_PER_SECOND = 6.5
const METEOR_BASE_INTERVAL_MS = 1100
const METEOR_MIN_INTERVAL_MS = 240
const METEOR_INTERVAL_RAMP_PER_SECOND = 20
const METEOR_MIN_RADIUS = 13
const METEOR_MAX_RADIUS = 28

// ─── Boss Meteor ──────────────────────────────────────────────
const BOSS_INTERVAL_SEC = 30
const BOSS_RADIUS = 50
const BOSS_SPEED = 60
const BOSS_HP = 5
const BOSS_SCORE = 200

// ─── Stars & Coins ───────────────────────────────────────────────
const STAR_SPEED = 110
const STAR_INTERVAL_MS = 5000
const STAR_RADIUS = 15
const STAR_BONUS_SCORE = 50

const COIN_SPEED = 100
const COIN_INTERVAL_MS = 8000
const COIN_RADIUS = 12
const COIN_BONUS_SCORE = 30

// ─── Scoring ──────────────────────────────────────────────────────
const SCORE_PER_SECOND = 12
const HIT_INVINCIBILITY_MS = 1200

// ─── Shield ───────────────────────────────────────────────────────
const SHIELD_INTERVAL_MS = 14000
const SHIELD_RADIUS = 16
const SHIELD_SPEED = 95
const SHIELD_DURATION_MS = 3500

// ─── Magnet ───────────────────────────────────────────────────────
const MAGNET_INTERVAL_MS = 18000
const MAGNET_RADIUS = 16
const MAGNET_SPEED = 85
const MAGNET_DURATION_MS = 5000
const MAGNET_PULL_RANGE = 160
const MAGNET_PULL_STRENGTH = 300

// ─── SlowMotion ───────────────────────────────────────────────────
const SLOW_INTERVAL_MS = 22000
const SLOW_RADIUS = 14
const SLOW_SPEED = 80
const SLOW_DURATION_MS = 3000
const SLOW_FACTOR = 0.4

// ─── Dash ─────────────────────────────────────────────────────────
const DASH_COOLDOWN_MS = 2500
const DASH_DISTANCE = 120
const DASH_INVINCIBILITY_MS = 400

// ─── Survival & Danger ───────────────────────────────────────────
const HP_RESTORE_INTERVAL_SEC = 25
const METEOR_BURST_INTERVAL_SEC = 12
const METEOR_BURST_COUNT = 7

// ─── Warning Laser ───────────────────────────────────────────────
const LASER_INTERVAL_SEC = 20
const LASER_WARN_MS = 1200
const LASER_ACTIVE_MS = 400
const LASER_WIDTH = 50

// ─── Combo ────────────────────────────────────────────────────────
const COMBO_WINDOW_MS = 3000
const COMBO_MULTIPLIERS = [1, 1.2, 1.5, 2, 3] as const

// ─── Level System ─────────────────────────────────────────────────
const LEVEL_THRESHOLDS = [0, 15, 35, 60, 90, 130, 180] as const
const LEVEL_NAMES = ['SECTOR 1', 'SECTOR 2', 'ASTEROID BELT', 'NEBULA ZONE', 'DARK SPACE', 'BLACK HOLE', 'BEYOND'] as const

// ─── Colors ───────────────────────────────────────────────────────
const METEOR_COLORS = ['#6b7280', '#78716c', '#a8a29e', '#57534e', '#9ca3af', '#dc2626', '#ea580c'] as const
const STAR_COLOR = '#facc15'
const STAR_GLOW_COLOR = '#fde047'
const COIN_COLOR = '#f59e0b'
const SHIELD_COLOR = '#38bdf8'
const MAGNET_COLOR = '#a855f7'
const SLOW_COLOR = '#34d399'
const BOSS_COLOR = '#ef4444'

// ─── Background hue by level ─────────────────────────────────────
const LEVEL_BG_HUES = [220, 250, 180, 280, 310, 0, 45] as const

// ─── Trail ────────────────────────────────────────────────────────
const TRAIL_LENGTH = 10
const TRAIL_INTERVAL_MS = 35

// ─── Types ────────────────────────────────────────────────────────
interface Meteor {
  readonly id: number
  readonly x: number
  y: number
  readonly radius: number
  readonly speed: number
  readonly color: string
  readonly rotation: number
  readonly rotationSpeed: number
  readonly isFire: boolean
  readonly isBoss: boolean
  hp: number
}

interface Star {
  readonly id: number
  x: number
  y: number
  readonly speed: number
}

interface Coin {
  readonly id: number
  x: number
  y: number
  readonly speed: number
}

interface PowerUp {
  readonly id: number
  x: number
  y: number
  readonly speed: number
  readonly type: 'shield' | 'magnet' | 'slow'
}

interface Laser {
  readonly x: number
  readonly warnStartMs: number
  readonly activeStartMs: number
  readonly endMs: number
}

interface TrailDot {
  readonly x: number
  readonly y: number
  readonly age: number
}

interface DashGhost {
  readonly x: number
  readonly y: number
  readonly opacity: number
  readonly time: number
}

interface Explosion {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly startMs: number
  readonly color: string
}

// ─── Utils ────────────────────────────────────────────────────────
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rng(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function circlesCollide(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy <= (ar + br) * (ar + br)
}

function createStarPoints(cx: number, cy: number, outerR: number, innerR: number, pts: number): string {
  const result: string[] = []
  const step = Math.PI / pts
  for (let i = 0; i < pts * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const a = i * step - Math.PI / 2
    result.push(`${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`)
  }
  return result.join(' ')
}

function getLevel(elapsedSec: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (elapsedSec >= LEVEL_THRESHOLDS[i]) return i
  }
  return 0
}

// ─── Component ────────────────────────────────────────────────────
function SpaceDodgeGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [playerX, setPlayerX] = useState(STAGE_WIDTH / 2)
  const [hp, setHp] = useState(INITIAL_HP)
  const [score, setScore] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [meteors, setMeteors] = useState<Meteor[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [coins, setCoins] = useState<Coin[]>([])
  const [powerUps, setPowerUps] = useState<PowerUp[]>([])
  const [isInvincible, setIsInvincible] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [hasMagnet, setHasMagnet] = useState(false)
  const [hasSlow, setHasSlow] = useState(false)
  const [statusText, setStatusText] = useState('Drag to dodge!')
  const [combo, setCombo] = useState(0)
  const [trail, setTrail] = useState<TrailDot[]>([])
  const [lasers, setLasers] = useState<Laser[]>([])
  const [nebulaHue, setNebulaHue] = useState(220)
  const [level, setLevel] = useState(0)
  const [dashCooldownPct, setDashCooldownPct] = useState(0)
  const [explosions, setExplosions] = useState<Explosion[]>([])
  const [dashGhosts, setDashGhosts] = useState<DashGhost[]>([])
  const [isDashing, setIsDashing] = useState(false)
  const [levelUpFlash, setLevelUpFlash] = useState(false)

  const effects = useGameEffects()

  // ─── Refs ─────────────────────────────────────────────────────
  const playerXRef = useRef(STAGE_WIDTH / 2)
  const targetXRef = useRef(STAGE_WIDTH / 2)
  const hpRef = useRef(INITIAL_HP)
  const scoreRef = useRef(0)
  const bonusScoreRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const meteorsRef = useRef<Meteor[]>([])
  const starsRef = useRef<Star[]>([])
  const coinsRef = useRef<Coin[]>([])
  const powerUpsRef = useRef<PowerUp[]>([])
  const lasersRef = useRef<Laser[]>([])
  const explosionsRef = useRef<Explosion[]>([])
  const dashGhostsRef = useRef<DashGhost[]>([])
  const nextIdRef = useRef(0)
  const lastMeteorSpawnRef = useRef(0)
  const lastStarSpawnRef = useRef(0)
  const lastCoinSpawnRef = useRef(0)
  const lastShieldSpawnRef = useRef(0)
  const lastMagnetSpawnRef = useRef(0)
  const lastSlowSpawnRef = useRef(0)
  const shieldActiveUntilRef = useRef(0)
  const magnetActiveUntilRef = useRef(0)
  const slowActiveUntilRef = useRef(0)
  const lastHpRestoreSecRef = useRef(0)
  const lastBurstSecRef = useRef(0)
  const lastLaserSecRef = useRef(0)
  const lastBossSecRef = useRef(0)
  const invincibleUntilRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const isPointerDownRef = useRef(false)
  const comboRef = useRef(0)
  const comboTimerRef = useRef(0)
  const trailRef = useRef<TrailDot[]>([])
  const lastTrailRef = useRef(0)
  const dodgeStreakRef = useRef(0)
  const levelRef = useRef(0)
  const lastDashRef = useRef(0)
  const dashActiveUntilRef = useRef(0)
  const lastDoubleTapRef = useRef(0)
  const lastTapXRef = useRef(0)

  // ─── Audio Refs ───────────────────────────────────────────────
  const meteorHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const starCollectAudioRef = useRef<HTMLAudioElement | null>(null)
  const shieldAudioRef = useRef<HTMLAudioElement | null>(null)
  const burstWarningAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const magnetAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)
  const dodgeAudioRef = useRef<HTMLAudioElement | null>(null)
  const hpRestoreAudioRef = useRef<HTMLAudioElement | null>(null)
  const slowAudioRef = useRef<HTMLAudioElement | null>(null)
  const levelUpAudioRef = useRef<HTMLAudioElement | null>(null)
  const coinAudioRef = useRef<HTMLAudioElement | null>(null)
  const dangerAudioRef = useRef<HTMLAudioElement | null>(null)
  const laserAudioRef = useRef<HTMLAudioElement | null>(null)
  const dashAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) return
    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const finishRound = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    const finalDurationMs = elapsedMsRef.current > 0 ? Math.round(elapsedMsRef.current) : Math.round(DEFAULT_FRAME_MS)
    const finalScore = Math.floor((elapsedMsRef.current / 1000) * SCORE_PER_SECOND) + bonusScoreRef.current
    playSfx(gameOverAudioRef.current, 0.65, 0.9)
    setStatusText('GAME OVER')
    effects.triggerShake(14)
    effects.triggerFlash('rgba(239,68,68,0.6)')
    onFinish({ score: finalScore, durationMs: finalDurationMs })
  }, [onFinish, playSfx, effects])

  // ─── Dash ───────────────────────────────────────────────────────
  const triggerDash = useCallback((direction: number) => {
    const now = elapsedMsRef.current
    if (now - lastDashRef.current < DASH_COOLDOWN_MS) return
    lastDashRef.current = now
    dashActiveUntilRef.current = now + DASH_INVINCIBILITY_MS
    const newX = clamp(playerXRef.current + direction * DASH_DISTANCE, PLAYER_SIZE / 2, STAGE_WIDTH - PLAYER_SIZE / 2)
    // ghost trail
    const ghost: DashGhost = { x: playerXRef.current, y: STAGE_HEIGHT - PLAYER_Y_OFFSET, opacity: 0.6, time: now }
    dashGhostsRef.current = [...dashGhostsRef.current, ghost]
    playerXRef.current = newX
    targetXRef.current = newX
    setPlayerX(newX)
    setIsDashing(true)
    playSfx(dashAudioRef.current, 0.5, 1.2)
    effects.spawnParticles(4, newX, STAGE_HEIGHT - PLAYER_Y_OFFSET)
    setTimeout(() => setIsDashing(false), 200)
  }, [playSfx, effects])

  // ─── Input Handling ───────────────────────────────────────────
  const updateTargetX = useCallback((clientX: number) => {
    const el = stageRef.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const relX = (clientX - rect.left) / rect.width
    targetXRef.current = clamp(relX * STAGE_WIDTH, PLAYER_SIZE / 2, STAGE_WIDTH - PLAYER_SIZE / 2)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    isPointerDownRef.current = true
    const now = Date.now()
    const el = stageRef.current
    if (el) {
      const rect = el.getBoundingClientRect()
      const tapX = (e.clientX - rect.left) / rect.width * STAGE_WIDTH
      // Double tap = dash
      if (now - lastDoubleTapRef.current < 300 && Math.abs(tapX - lastTapXRef.current) < 80) {
        const direction = tapX > STAGE_WIDTH / 2 ? 1 : -1
        triggerDash(direction)
        lastDoubleTapRef.current = 0
      } else {
        lastDoubleTapRef.current = now
        lastTapXRef.current = tapX
      }
    }
    updateTargetX(e.clientX)
  }, [updateTargetX, triggerDash])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current && e.pointerType === 'mouse') return
    updateTargetX(e.clientX)
  }, [updateTargetX])

  const handlePointerUp = useCallback(() => { isPointerDownRef.current = false }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (finishedRef.current) return
      if (e.code === 'ArrowLeft') { e.preventDefault(); targetXRef.current = clamp(targetXRef.current - 40, PLAYER_SIZE / 2, STAGE_WIDTH - PLAYER_SIZE / 2) }
      if (e.code === 'ArrowRight') { e.preventDefault(); targetXRef.current = clamp(targetXRef.current + 40, PLAYER_SIZE / 2, STAGE_WIDTH - PLAYER_SIZE / 2) }
      // Space = dash in facing direction
      if (e.code === 'Space') {
        e.preventDefault()
        const dir = targetXRef.current > playerXRef.current ? 1 : -1
        triggerDash(dir)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit, triggerDash])

  // ─── Audio Init ───────────────────────────────────────────────
  useEffect(() => {
    const audios = [
      { ref: meteorHitAudioRef, src: meteorHitSfx },
      { ref: starCollectAudioRef, src: starCollectSfx },
      { ref: shieldAudioRef, src: shieldSfx },
      { ref: burstWarningAudioRef, src: burstWarningSfx },
      { ref: comboAudioRef, src: comboSfx },
      { ref: magnetAudioRef, src: magnetSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
      { ref: dodgeAudioRef, src: dodgeSfx },
      { ref: hpRestoreAudioRef, src: hpRestoreSfx },
      { ref: slowAudioRef, src: slowSfx },
      { ref: levelUpAudioRef, src: levelUpSfx },
      { ref: coinAudioRef, src: coinSfx },
      { ref: dangerAudioRef, src: dangerSfx },
      { ref: laserAudioRef, src: laserSfx },
      { ref: dashAudioRef, src: dashSfx },
    ]
    const instances: HTMLAudioElement[] = []
    for (const { ref, src } of audios) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
      instances.push(audio)
    }
    return () => {
      effects.cleanup()
      for (const a of instances) { a.pause(); a.currentTime = 0 }
    }
  }, [])

  // ─── Game Loop ────────────────────────────────────────────────
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const rawDelta = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      const isSlowActive = elapsedMsRef.current < slowActiveUntilRef.current
      const timeScale = isSlowActive ? SLOW_FACTOR : 1
      const deltaMs = rawDelta * timeScale
      const deltaSec = deltaMs / 1000

      elapsedMsRef.current += rawDelta
      setElapsedMs(elapsedMsRef.current)

      effects.updateParticles()

      const elapsed = elapsedMsRef.current
      const elapsedSec = elapsed / 1000

      // ─── Level System ───────────────────────────────────
      const newLevel = getLevel(elapsedSec)
      if (newLevel > levelRef.current) {
        levelRef.current = newLevel
        setLevel(newLevel)
        setStatusText(LEVEL_NAMES[newLevel] ?? `SECTOR ${newLevel + 1}`)
        playSfx(levelUpAudioRef.current, 0.6, 1)
        effects.triggerFlash('rgba(250,204,21,0.3)', 120)
        effects.triggerShake(4)
        setLevelUpFlash(true)
        setTimeout(() => setLevelUpFlash(false), 600)
      }

      // Nebula hue shift based on level
      const baseHue = LEVEL_BG_HUES[Math.min(newLevel, LEVEL_BG_HUES.length - 1)]
      setNebulaHue(baseHue + Math.sin(elapsedSec * 0.05) * 20)

      // ─── Player Movement ──────────────────────────────────
      const curX = playerXRef.current
      const nextX = curX + (targetXRef.current - curX) * PLAYER_LERP_SPEED
      playerXRef.current = nextX
      setPlayerX(nextX)

      // ─── Dash Cooldown ──────────────────────────────────
      const dashCd = clamp(1 - (elapsed - lastDashRef.current) / DASH_COOLDOWN_MS, 0, 1)
      setDashCooldownPct(dashCd)

      // ─── Trail ────────────────────────────────────────────
      if (elapsed - lastTrailRef.current > TRAIL_INTERVAL_MS) {
        lastTrailRef.current = elapsed
        const newTrail = [{ x: nextX, y: STAGE_HEIGHT - PLAYER_Y_OFFSET, age: 0 }, ...trailRef.current].slice(0, TRAIL_LENGTH)
        trailRef.current = newTrail
        setTrail(newTrail)
      }

      // ─── Difficulty ───────────────────────────────────────
      const meteorSpeed = Math.min(METEOR_MAX_SPEED, METEOR_BASE_SPEED + elapsedSec * METEOR_SPEED_RAMP_PER_SECOND)
      const meteorInterval = Math.max(METEOR_MIN_INTERVAL_MS, METEOR_BASE_INTERVAL_MS - elapsedSec * METEOR_INTERVAL_RAMP_PER_SECOND)

      // ─── Spawn Meteors ────────────────────────────────────
      if (elapsed - lastMeteorSpawnRef.current >= meteorInterval) {
        lastMeteorSpawnRef.current = elapsed
        const r = rng(METEOR_MIN_RADIUS, METEOR_MAX_RADIUS)
        const isFire = Math.random() < 0.15 + elapsedSec * 0.003
        meteorsRef.current = [...meteorsRef.current, {
          id: nextIdRef.current++, x: rng(r, STAGE_WIDTH - r), y: -r,
          radius: r, speed: meteorSpeed * rng(0.8, 1.2),
          color: isFire ? '#ef4444' : METEOR_COLORS[Math.floor(Math.random() * METEOR_COLORS.length)],
          rotation: Math.random() * Math.PI * 2, rotationSpeed: rng(-4, 4), isFire,
          isBoss: false, hp: 1,
        }]
      }

      // ─── Boss Meteor ──────────────────────────────────────
      const bossSec = Math.floor(elapsedSec / BOSS_INTERVAL_SEC)
      if (bossSec > lastBossSecRef.current && elapsedSec > 20) {
        lastBossSecRef.current = bossSec
        playSfx(dangerAudioRef.current, 0.7, 0.8)
        setStatusText('BOSS METEOR INCOMING!')
        effects.triggerFlash('rgba(239,68,68,0.25)', 150)
        effects.triggerShake(8)
        meteorsRef.current = [...meteorsRef.current, {
          id: nextIdRef.current++, x: STAGE_WIDTH / 2, y: -BOSS_RADIUS * 2,
          radius: BOSS_RADIUS, speed: BOSS_SPEED,
          color: BOSS_COLOR, rotation: 0, rotationSpeed: 1.5,
          isFire: true, isBoss: true, hp: BOSS_HP,
        }]
      }

      // ─── Spawn Stars ──────────────────────────────────────
      if (elapsed - lastStarSpawnRef.current >= STAR_INTERVAL_MS) {
        lastStarSpawnRef.current = elapsed
        starsRef.current = [...starsRef.current, {
          id: nextIdRef.current++, x: rng(STAR_RADIUS + 10, STAGE_WIDTH - STAR_RADIUS - 10),
          y: -STAR_RADIUS, speed: STAR_SPEED,
        }]
      }

      // ─── Spawn Coins ──────────────────────────────────────
      if (elapsed - lastCoinSpawnRef.current >= COIN_INTERVAL_MS) {
        lastCoinSpawnRef.current = elapsed
        coinsRef.current = [...coinsRef.current, {
          id: nextIdRef.current++, x: rng(COIN_RADIUS + 10, STAGE_WIDTH - COIN_RADIUS - 10),
          y: -COIN_RADIUS, speed: COIN_SPEED,
        }]
      }

      // ─── Spawn Power-ups ──────────────────────────────────
      if (elapsed - lastShieldSpawnRef.current >= SHIELD_INTERVAL_MS) {
        lastShieldSpawnRef.current = elapsed
        powerUpsRef.current = [...powerUpsRef.current, {
          id: nextIdRef.current++, x: rng(20, STAGE_WIDTH - 20), y: -SHIELD_RADIUS, speed: SHIELD_SPEED, type: 'shield',
        }]
      }
      if (elapsed - lastMagnetSpawnRef.current >= MAGNET_INTERVAL_MS) {
        lastMagnetSpawnRef.current = elapsed
        powerUpsRef.current = [...powerUpsRef.current, {
          id: nextIdRef.current++, x: rng(20, STAGE_WIDTH - 20), y: -MAGNET_RADIUS, speed: MAGNET_SPEED, type: 'magnet',
        }]
      }
      if (elapsed - lastSlowSpawnRef.current >= SLOW_INTERVAL_MS) {
        lastSlowSpawnRef.current = elapsed
        powerUpsRef.current = [...powerUpsRef.current, {
          id: nextIdRef.current++, x: rng(20, STAGE_WIDTH - 20), y: -SLOW_RADIUS, speed: SLOW_SPEED, type: 'slow',
        }]
      }

      // ─── Meteor Burst ─────────────────────────────────────
      const burstSec = Math.floor(elapsedSec / METEOR_BURST_INTERVAL_SEC)
      if (burstSec > lastBurstSecRef.current) {
        lastBurstSecRef.current = burstSec
        playSfx(burstWarningAudioRef.current, 0.55, 1)
        for (let b = 0; b < METEOR_BURST_COUNT; b++) {
          const r = rng(METEOR_MIN_RADIUS, METEOR_MAX_RADIUS)
          meteorsRef.current = [...meteorsRef.current, {
            id: nextIdRef.current++, x: rng(r, STAGE_WIDTH - r), y: -r - b * 35,
            radius: r, speed: meteorSpeed * rng(0.9, 1.4),
            color: METEOR_COLORS[Math.floor(Math.random() * METEOR_COLORS.length)],
            rotation: Math.random() * Math.PI * 2, rotationSpeed: rng(-4, 4),
            isFire: Math.random() < 0.3, isBoss: false, hp: 1,
          }]
        }
        setStatusText('METEOR BURST!')
        effects.triggerFlash('rgba(249,115,22,0.35)', 100)
        effects.triggerShake(6)
      }

      // ─── Warning Laser ────────────────────────────────────
      const laserSec = Math.floor(elapsedSec / LASER_INTERVAL_SEC)
      if (laserSec > lastLaserSecRef.current && elapsedSec > 10) {
        lastLaserSecRef.current = laserSec
        playSfx(laserAudioRef.current, 0.45, 1)
        const lx = rng(LASER_WIDTH, STAGE_WIDTH - LASER_WIDTH)
        const newLaser: Laser = {
          x: lx, warnStartMs: elapsed, activeStartMs: elapsed + LASER_WARN_MS, endMs: elapsed + LASER_WARN_MS + LASER_ACTIVE_MS,
        }
        lasersRef.current = [...lasersRef.current, newLaser]
      }

      // ─── HP Restore ───────────────────────────────────────
      const hpRestoreSec = Math.floor(elapsedSec / HP_RESTORE_INTERVAL_SEC)
      if (hpRestoreSec > lastHpRestoreSecRef.current && hpRef.current < MAX_HP) {
        lastHpRestoreSecRef.current = hpRestoreSec
        hpRef.current = Math.min(MAX_HP, hpRef.current + 1)
        setHp(hpRef.current)
        setStatusText('+1 HP!')
        playSfx(hpRestoreAudioRef.current, 0.5, 1)
        effects.triggerFlash('rgba(34,197,94,0.3)', 80)
      }

      // ─── Combo Decay ──────────────────────────────────────
      if (comboRef.current > 0 && elapsed > comboTimerRef.current) {
        comboRef.current = 0
        setCombo(0)
      }

      // ─── Explosions decay ──────────────────────────────────
      explosionsRef.current = explosionsRef.current.filter(e => elapsed - e.startMs < 500)
      dashGhostsRef.current = dashGhostsRef.current.filter(g => elapsed - g.time < 400)

      // ─── Move & Collide ───────────────────────────────────
      const playerY = STAGE_HEIGHT - PLAYER_Y_OFFSET
      const shieldActive = elapsed < shieldActiveUntilRef.current
      const magnetActive = elapsed < magnetActiveUntilRef.current
      const slowActive = elapsed < slowActiveUntilRef.current
      const dashActive = elapsed < dashActiveUntilRef.current
      const isCurrentlyInvincible = elapsed < invincibleUntilRef.current || shieldActive || dashActive

      if (shieldActive !== hasShield) setHasShield(shieldActive)
      if (magnetActive !== hasMagnet) setHasMagnet(magnetActive)
      if (slowActive !== hasSlow) setHasSlow(slowActive)

      let hitThisFrame = false

      // ─── Meteors ──────────────────────────────────────────
      const nextMeteors: Meteor[] = []
      for (const m of meteorsRef.current) {
        const updated = { ...m, y: m.y + m.speed * deltaSec }

        // Boss meteor: player collision damages boss
        if (m.isBoss && shieldActive &&
          circlesCollide(playerXRef.current, playerY, PLAYER_COLLIDER_RADIUS + 10, updated.x, updated.y, updated.radius)) {
          updated.hp -= 1
          if (updated.hp <= 0) {
            bonusScoreRef.current += BOSS_SCORE
            effects.comboHitBurst(updated.x, updated.y, 12, BOSS_SCORE)
            effects.triggerShake(10)
            playSfx(comboAudioRef.current, 0.6, 0.8)
            explosionsRef.current = [...explosionsRef.current, {
              id: nextIdRef.current++, x: updated.x, y: updated.y, radius: BOSS_RADIUS * 2, startMs: elapsed, color: '#ef4444',
            }]
            setStatusText(`BOSS DESTROYED! +${BOSS_SCORE}`)
            continue
          }
          effects.spawnParticles(3, updated.x, updated.y)
          playSfx(meteorHitAudioRef.current, 0.4, 0.9)
          nextMeteors.push(updated)
          continue
        }

        if (updated.y > STAGE_HEIGHT + updated.radius + 20) {
          if (!m.isBoss) {
            dodgeStreakRef.current++
            if (dodgeStreakRef.current % 10 === 0) {
              bonusScoreRef.current += 20
              effects.comboHitBurst(STAGE_WIDTH / 2, 80, 4, 20)
              setStatusText(`${dodgeStreakRef.current} Dodge Streak!`)
              if (dodgeStreakRef.current % 30 === 0) playSfx(dodgeAudioRef.current, 0.4, 1.2)
            }
          }
          continue
        }

        // Laser damage to meteors
        let laserDestroyed = false
        for (const laser of lasersRef.current) {
          if (elapsed >= laser.activeStartMs && elapsed < laser.endMs) {
            if (Math.abs(updated.x - laser.x) < LASER_WIDTH / 2 + updated.radius) {
              laserDestroyed = true
              effects.spawnParticles(4, updated.x, updated.y)
              bonusScoreRef.current += 10
              explosionsRef.current = [...explosionsRef.current, {
                id: nextIdRef.current++, x: updated.x, y: updated.y, radius: updated.radius * 1.5, startMs: elapsed, color: m.color,
              }]
              break
            }
          }
        }
        if (laserDestroyed) continue

        if (!isCurrentlyInvincible && !hitThisFrame &&
          circlesCollide(playerXRef.current, playerY, PLAYER_COLLIDER_RADIUS, updated.x, updated.y, updated.radius)) {
          hitThisFrame = true
          dodgeStreakRef.current = 0
          const dmg = m.isFire ? 2 : 1
          const nextHp = hpRef.current - dmg
          hpRef.current = Math.max(0, nextHp)
          setHp(Math.max(0, nextHp))
          invincibleUntilRef.current = elapsed + HIT_INVINCIBILITY_MS
          setIsInvincible(true)
          playSfx(meteorHitAudioRef.current, 0.6, m.isFire ? 0.8 : 1)
          setStatusText(m.isFire ? `FIRE HIT! -${dmg} HP` : `Hit! HP ${Math.max(0, nextHp)}`)
          effects.triggerShake(m.isFire ? 12 : 7)
          effects.triggerFlash(m.isFire ? 'rgba(220,38,38,0.5)' : 'rgba(239,68,68,0.4)')
          effects.spawnParticles(m.isFire ? 8 : 5, playerXRef.current, playerY)
          comboRef.current = 0
          setCombo(0)
          // Warning sound when low HP
          if (Math.max(0, nextHp) === 1) playSfx(dangerAudioRef.current, 0.5, 1.2)

          if (Math.max(0, nextHp) <= 0) {
            meteorsRef.current = nextMeteors
            setMeteors(nextMeteors)
            finishRound()
            animationFrameRef.current = null
            return
          }
          continue
        }
        nextMeteors.push(updated)
      }
      meteorsRef.current = nextMeteors

      // ─── Stars ────────────────────────────────────────────
      const nextStars: Star[] = []
      let collectedStar = false
      for (const s of starsRef.current) {
        let sx = s.x
        let sy = s.y + s.speed * deltaSec
        if (magnetActive) {
          const dx = playerXRef.current - sx
          const dy = playerY - sy
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAGNET_PULL_RANGE && dist > 1) {
            sx += (dx / dist) * MAGNET_PULL_STRENGTH * deltaSec
            sy += (dy / dist) * MAGNET_PULL_STRENGTH * deltaSec
          }
        }
        const updated = { ...s, x: sx, y: sy }
        if (updated.y > STAGE_HEIGHT + STAR_RADIUS + 20) continue
        if (circlesCollide(playerXRef.current, playerY, PLAYER_COLLIDER_RADIUS, updated.x, updated.y, STAR_RADIUS)) {
          const mult = COMBO_MULTIPLIERS[Math.min(comboRef.current, COMBO_MULTIPLIERS.length - 1)]
          const pts = Math.floor(STAR_BONUS_SCORE * mult)
          bonusScoreRef.current += pts
          collectedStar = true
          comboRef.current = Math.min(comboRef.current + 1, COMBO_MULTIPLIERS.length - 1)
          comboTimerRef.current = elapsed + COMBO_WINDOW_MS
          setCombo(comboRef.current)
          setStatusText(comboRef.current > 1 ? `COMBO x${mult}! +${pts}` : `+${pts}`)
          effects.comboHitBurst(playerXRef.current, playerY - 30, 5, pts)
          if (comboRef.current >= 2) playSfx(comboAudioRef.current, 0.45, 1 + comboRef.current * 0.15)
          continue
        }
        nextStars.push(updated)
      }
      starsRef.current = nextStars
      if (collectedStar) playSfx(starCollectAudioRef.current, 0.5, 1.2)

      // ─── Coins ────────────────────────────────────────────
      const nextCoins: Coin[] = []
      let collectedCoin = false
      for (const c of coinsRef.current) {
        let cx = c.x
        let cy = c.y + c.speed * deltaSec
        if (magnetActive) {
          const dx = playerXRef.current - cx
          const dy = playerY - cy
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAGNET_PULL_RANGE && dist > 1) {
            cx += (dx / dist) * MAGNET_PULL_STRENGTH * deltaSec
            cy += (dy / dist) * MAGNET_PULL_STRENGTH * deltaSec
          }
        }
        const updated = { ...c, x: cx, y: cy }
        if (updated.y > STAGE_HEIGHT + COIN_RADIUS + 20) continue
        if (circlesCollide(playerXRef.current, playerY, PLAYER_COLLIDER_RADIUS, updated.x, updated.y, COIN_RADIUS)) {
          const mult = COMBO_MULTIPLIERS[Math.min(comboRef.current, COMBO_MULTIPLIERS.length - 1)]
          const pts = Math.floor(COIN_BONUS_SCORE * mult)
          bonusScoreRef.current += pts
          collectedCoin = true
          comboRef.current = Math.min(comboRef.current + 1, COMBO_MULTIPLIERS.length - 1)
          comboTimerRef.current = elapsed + COMBO_WINDOW_MS
          setCombo(comboRef.current)
          effects.comboHitBurst(playerXRef.current, playerY - 30, 4, pts)
          continue
        }
        nextCoins.push(updated)
      }
      coinsRef.current = nextCoins
      if (collectedCoin) playSfx(coinAudioRef.current, 0.45, 1.4)

      // ─── Power-ups ────────────────────────────────────────
      const nextPowerUps: PowerUp[] = []
      for (const pu of powerUpsRef.current) {
        const updated = { ...pu, y: pu.y + pu.speed * deltaSec }
        if (updated.y > STAGE_HEIGHT + 20) continue
        const puRadius = pu.type === 'shield' ? SHIELD_RADIUS : pu.type === 'magnet' ? MAGNET_RADIUS : SLOW_RADIUS
        if (circlesCollide(playerXRef.current, playerY, PLAYER_COLLIDER_RADIUS, updated.x, updated.y, puRadius)) {
          if (pu.type === 'shield') {
            shieldActiveUntilRef.current = elapsed + SHIELD_DURATION_MS
            setHasShield(true)
            setStatusText('SHIELD!')
            playSfx(shieldAudioRef.current, 0.5, 1)
            effects.triggerFlash('rgba(56,189,248,0.3)', 80)
          } else if (pu.type === 'magnet') {
            magnetActiveUntilRef.current = elapsed + MAGNET_DURATION_MS
            setHasMagnet(true)
            setStatusText('MAGNET!')
            playSfx(magnetAudioRef.current, 0.5, 1)
            effects.triggerFlash('rgba(168,85,247,0.3)', 80)
          } else {
            slowActiveUntilRef.current = elapsed + SLOW_DURATION_MS
            setHasSlow(true)
            setStatusText('SLOW MOTION!')
            playSfx(slowAudioRef.current, 0.5, 1)
            effects.triggerFlash('rgba(52,211,153,0.3)', 80)
          }
          effects.spawnParticles(6, playerXRef.current, playerY)
          continue
        }
        nextPowerUps.push(updated)
      }
      powerUpsRef.current = nextPowerUps

      // ─── Lasers ───────────────────────────────────────────
      const playerHitByLaser = !isCurrentlyInvincible && lasersRef.current.some(
        l => elapsed >= l.activeStartMs && elapsed < l.endMs && Math.abs(playerXRef.current - l.x) < LASER_WIDTH / 2 + PLAYER_COLLIDER_RADIUS
      )
      if (playerHitByLaser && !hitThisFrame) {
        hitThisFrame = true
        dodgeStreakRef.current = 0
        hpRef.current = Math.max(0, hpRef.current - 1)
        setHp(hpRef.current)
        invincibleUntilRef.current = elapsed + HIT_INVINCIBILITY_MS
        setIsInvincible(true)
        playSfx(meteorHitAudioRef.current, 0.7, 1.2)
        setStatusText('LASER HIT!')
        effects.triggerShake(10)
        effects.triggerFlash('rgba(239,68,68,0.5)')
        effects.spawnParticles(6, playerXRef.current, playerY)
        if (hpRef.current <= 0) { finishRound(); animationFrameRef.current = null; return }
      }
      lasersRef.current = lasersRef.current.filter(l => elapsed < l.endMs)

      // ─── Invincibility visual ─────────────────────────────
      if (isCurrentlyInvincible && elapsed >= invincibleUntilRef.current && !shieldActive && !dashActive) {
        setIsInvincible(false)
      }

      // ─── Score ────────────────────────────────────────────
      const currentScore = Math.floor(elapsedSec * SCORE_PER_SECOND) + bonusScoreRef.current
      scoreRef.current = currentScore
      setScore(currentScore)
      setMeteors([...meteorsRef.current])
      setStars([...starsRef.current])
      setCoins([...coinsRef.current])
      setPowerUps([...powerUpsRef.current])
      setLasers([...lasersRef.current])
      setExplosions([...explosionsRef.current])
      setDashGhosts([...dashGhostsRef.current])

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
  }, [finishRound, playSfx, effects])

  const displayedBestScore = Math.max(bestScore, score)
  const playerY = STAGE_HEIGHT - PLAYER_Y_OFFSET
  const hearts = useMemo(() => {
    const r: string[] = []
    for (let i = 0; i < MAX_HP; i++) r.push(i < hp ? '\u2764\uFE0F' : '\uD83E\uDE76')
    return r
  }, [hp])

  const comboMult = COMBO_MULTIPLIERS[Math.min(combo, COMBO_MULTIPLIERS.length - 1)]
  const levelName = LEVEL_NAMES[Math.min(level, LEVEL_NAMES.length - 1)]

  return (
    <section className="mini-game-panel space-dodge-panel" aria-label="space-dodge-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div
        className="space-dodge-stage"
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        role="presentation"
      >
        <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
        <ParticleRenderer particles={effects.particles} />
        <ScorePopupRenderer popups={effects.scorePopups} />

        {/* Level-up flash overlay */}
        {levelUpFlash && <div className="space-dodge-level-flash" />}

        <svg
          className="space-dodge-svg"
          viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          aria-label="space-dodge-field"
        >
          <defs>
            <radialGradient id="sd-star-glow">
              <stop offset="0%" stopColor={STAR_GLOW_COLOR} stopOpacity="0.8" />
              <stop offset="100%" stopColor={STAR_COLOR} stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sd-nebula">
              <stop offset="0%" stopColor={`hsl(${nebulaHue}, 60%, 25%)`} stopOpacity="0.3" />
              <stop offset="60%" stopColor={`hsl(${nebulaHue + 30}, 40%, 15%)`} stopOpacity="0.1" />
              <stop offset="100%" stopColor="transparent" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sd-nebula2">
              <stop offset="0%" stopColor={`hsl(${nebulaHue + 60}, 50%, 20%)`} stopOpacity="0.25" />
              <stop offset="100%" stopColor="transparent" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="sd-laser-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(239,68,68,0)" />
              <stop offset="20%" stopColor="rgba(239,68,68,0.8)" />
              <stop offset="80%" stopColor="rgba(239,68,68,0.8)" />
              <stop offset="100%" stopColor="rgba(239,68,68,0)" />
            </linearGradient>
            <filter id="sd-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="sd-pixel-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Background nebulae */}
          <circle cx={STAGE_WIDTH * 0.3} cy={STAGE_HEIGHT * 0.25} r="160" fill="url(#sd-nebula)" />
          <circle cx={STAGE_WIDTH * 0.8} cy={STAGE_HEIGHT * 0.6} r="120" fill="url(#sd-nebula)" />
          <circle cx={STAGE_WIDTH * 0.5} cy={STAGE_HEIGHT * 0.85} r="100" fill="url(#sd-nebula2)" />

          {/* Starfield (parallax layers) */}
          {Array.from({ length: 70 }, (_, i) => {
            const layer = i % 3
            const speedMult = 0.2 + layer * 0.2
            const sx = ((i * 97 + 13) % STAGE_WIDTH)
            const sy = ((i * 53 + 7 + (elapsedMs * 0.025 * speedMult)) % STAGE_HEIGHT)
            const size = 0.4 + layer * 0.4
            const twinkle = 0.3 + Math.sin(elapsedMs * 0.003 + i * 1.7) * 0.25
            const color = layer === 2 ? '#eff6ff' : layer === 1 ? '#dbeafe' : '#93c5fd'
            return <circle key={`bg-${i}`} cx={sx} cy={sy} r={size} fill={color} opacity={twinkle + layer * 0.1} />
          })}

          {/* Warning Lasers */}
          {lasers.map((laser, li) => {
            const isWarning = elapsedMs >= laser.warnStartMs && elapsedMs < laser.activeStartMs
            const isActive = elapsedMs >= laser.activeStartMs && elapsedMs < laser.endMs
            if (!isWarning && !isActive) return null
            const warningBlink = Math.sin(elapsedMs * 0.02) > 0
            return (
              <g key={`laser-${li}`}>
                {isWarning && warningBlink && (
                  <rect x={laser.x - LASER_WIDTH / 2} y={0} width={LASER_WIDTH} height={STAGE_HEIGHT}
                    fill="rgba(239,68,68,0.08)" stroke="rgba(239,68,68,0.3)" strokeWidth="1" strokeDasharray="8 4" />
                )}
                {isActive && (
                  <>
                    <rect x={laser.x - LASER_WIDTH / 2} y={0} width={LASER_WIDTH} height={STAGE_HEIGHT}
                      fill="url(#sd-laser-grad)" opacity="0.7" filter="url(#sd-glow)" />
                    <rect x={laser.x - LASER_WIDTH / 4} y={0} width={LASER_WIDTH / 2} height={STAGE_HEIGHT}
                      fill="rgba(255,255,255,0.3)" />
                  </>
                )}
              </g>
            )
          })}

          {/* Explosions */}
          {explosions.map((exp) => {
            const age = (elapsedMs - exp.startMs) / 500
            if (age > 1) return null
            const r = exp.radius * (0.3 + age * 0.7)
            const opacity = 1 - age
            return (
              <g key={`exp-${exp.id}`}>
                <circle cx={exp.x} cy={exp.y} r={r} fill={exp.color} opacity={opacity * 0.4} />
                <circle cx={exp.x} cy={exp.y} r={r * 0.6} fill="white" opacity={opacity * 0.5} />
                {Array.from({ length: 6 }, (_, pi) => {
                  const angle = (pi / 6) * Math.PI * 2 + age * 2
                  const px = exp.x + Math.cos(angle) * r * 0.8
                  const py = exp.y + Math.sin(angle) * r * 0.8
                  return <circle key={`ep-${pi}`} cx={px} cy={py} r={2} fill={exp.color} opacity={opacity} />
                })}
              </g>
            )
          })}

          {/* Dash ghosts */}
          {dashGhosts.map((g, gi) => {
            const age = (elapsedMs - g.time) / 400
            if (age > 1) return null
            return (
              <image key={`dg-${gi}`} href={seoTaijiSprite}
                x={g.x - PLAYER_SIZE / 2} y={g.y - PLAYER_SIZE / 2}
                width={PLAYER_SIZE} height={PLAYER_SIZE}
                opacity={(1 - age) * 0.4}
                preserveAspectRatio="xMidYMid meet"
                style={{ filter: 'hue-rotate(180deg) brightness(1.5)' }} />
            )
          })}

          {/* Player trail */}
          {trail.map((dot, ti) => (
            <circle key={`trail-${ti}`} cx={dot.x} cy={dot.y}
              r={PLAYER_SIZE * 0.22 * (1 - ti / TRAIL_LENGTH)}
              fill={isDashing ? 'rgba(250,204,21,0.25)' : 'rgba(56,189,248,0.15)'} opacity={1 - ti / TRAIL_LENGTH} />
          ))}

          {/* Meteors */}
          {meteors.map((m) => {
            const rot = m.rotation + (elapsedMs / 1000) * m.rotationSpeed
            if (m.isBoss) {
              const pulse = 0.9 + Math.sin(elapsedMs * 0.008) * 0.1
              return (
                <g key={`m-${m.id}`}>
                  {/* Boss danger aura */}
                  <circle cx={m.x} cy={m.y} r={m.radius * 2} fill="rgba(239,68,68,0.08)" />
                  <circle cx={m.x} cy={m.y} r={m.radius * 1.4 * pulse} fill="rgba(239,68,68,0.15)" />
                  {/* Boss body */}
                  <g transform={`translate(${m.x},${m.y}) rotate(${(rot * 180) / Math.PI})`}>
                    <ellipse cx={0} cy={0} rx={m.radius * pulse} ry={m.radius * 0.85 * pulse} fill={m.color} stroke="#991b1b" strokeWidth="2" />
                    <ellipse cx={-m.radius * 0.2} cy={-m.radius * 0.15} rx={m.radius * 0.3} ry={m.radius * 0.2} fill="rgba(255,255,255,0.15)" />
                    {/* Boss eye */}
                    <circle cx={0} cy={0} r={m.radius * 0.2} fill="#fbbf24" />
                    <circle cx={m.radius * 0.05} cy={m.radius * 0.05} r={m.radius * 0.1} fill="#000" />
                  </g>
                  {/* HP bar */}
                  <rect x={m.x - 25} y={m.y - m.radius - 12} width={50} height={6} rx={3} fill="rgba(0,0,0,0.5)" />
                  <rect x={m.x - 25} y={m.y - m.radius - 12} width={50 * (m.hp / BOSS_HP)} height={6} rx={3} fill="#ef4444" />
                </g>
              )
            }
            return (
              <g key={`m-${m.id}`}>
                <circle cx={m.x} cy={m.y + 3} r={m.radius} fill="rgba(0,0,0,0.25)" />
                {m.isFire && <circle cx={m.x} cy={m.y} r={m.radius * 1.5} fill="rgba(239,68,68,0.15)" />}
                <g transform={`translate(${m.x},${m.y}) rotate(${(rot * 180) / Math.PI})`}>
                  <ellipse cx={0} cy={0} rx={m.radius} ry={m.radius * 0.78} fill={m.color} />
                  <ellipse cx={-m.radius * 0.25} cy={-m.radius * 0.2} rx={m.radius * 0.35} ry={m.radius * 0.25} fill="rgba(255,255,255,0.15)" />
                  <circle cx={m.radius * 0.2} cy={m.radius * 0.15} r={m.radius * 0.15} fill="rgba(0,0,0,0.2)" />
                </g>
                {m.isFire && (
                  <circle cx={m.x} cy={m.y - m.radius * 0.5} r={m.radius * 0.3}
                    fill="#fbbf24" opacity={0.6 + Math.sin(elapsedMs * 0.015 + m.id) * 0.3} />
                )}
              </g>
            )
          })}

          {/* Stars */}
          {stars.map((s) => (
            <g key={`s-${s.id}`}>
              <circle cx={s.x} cy={s.y} r={STAR_RADIUS * 2.5} fill="url(#sd-star-glow)" />
              <polygon points={createStarPoints(s.x, s.y, STAR_RADIUS, STAR_RADIUS * 0.45, 5)}
                fill={STAR_COLOR} stroke="#ca8a04" strokeWidth="1" filter="url(#sd-pixel-glow)" />
              <circle cx={s.x - 3} cy={s.y - 3} r={3} fill="rgba(255,255,255,0.6)" />
            </g>
          ))}

          {/* Coins */}
          {coins.map((c) => {
            const wobble = Math.sin(elapsedMs * 0.008 + c.id) * 0.3
            return (
              <g key={`c-${c.id}`}>
                <circle cx={c.x} cy={c.y} r={COIN_RADIUS * 2} fill="rgba(245,158,11,0.15)" />
                <ellipse cx={c.x} cy={c.y} rx={COIN_RADIUS * (0.7 + wobble * 0.3)} ry={COIN_RADIUS}
                  fill={COIN_COLOR} stroke="#b45309" strokeWidth="1.5" />
                <text x={c.x} y={c.y + 4} textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold">$</text>
              </g>
            )
          })}

          {/* Power-ups */}
          {powerUps.map((pu) => {
            const color = pu.type === 'shield' ? SHIELD_COLOR : pu.type === 'magnet' ? MAGNET_COLOR : SLOW_COLOR
            const label = pu.type === 'shield' ? 'S' : pu.type === 'magnet' ? 'M' : 'T'
            const pulse = 0.8 + Math.sin(elapsedMs * 0.008 + pu.id) * 0.2
            return (
              <g key={`pu-${pu.id}`}>
                <circle cx={pu.x} cy={pu.y} r={20 * pulse} fill={`${color}22`} />
                <circle cx={pu.x} cy={pu.y} r={14} fill={color} stroke="white" strokeWidth="2" opacity="0.9" filter="url(#sd-pixel-glow)" />
                <text x={pu.x} y={pu.y + 4} textAnchor="middle" fill="white" fontSize="11" fontWeight="bold">{label}</text>
              </g>
            )
          })}

          {/* Magnet range indicator */}
          {hasMagnet && (
            <circle cx={playerX} cy={playerY} r={MAGNET_PULL_RANGE}
              fill="none" stroke={MAGNET_COLOR} strokeWidth="1.5" strokeDasharray="6 4"
              opacity={0.25 + Math.sin(elapsedMs * 0.006) * 0.15} />
          )}

          {/* Shield active ring */}
          {hasShield && (
            <>
              <circle cx={playerX} cy={playerY} r={PLAYER_SIZE * 0.62}
                fill="none" stroke={SHIELD_COLOR} strokeWidth="3"
                opacity={0.5 + Math.sin(elapsedMs * 0.01) * 0.3} filter="url(#sd-glow)" />
              <circle cx={playerX} cy={playerY} r={PLAYER_SIZE * 0.62}
                fill="rgba(56,189,248,0.08)" />
            </>
          )}

          {/* Player shadow */}
          <ellipse cx={playerX} cy={playerY + PLAYER_SIZE * 0.42} rx={PLAYER_SIZE * 0.35} ry={5} fill="rgba(0,200,255,0.25)" />

          {/* Player */}
          <image
            className={`space-dodge-player ${isInvincible ? 'space-dodge-blink' : ''} ${isDashing ? 'space-dodge-dash-glow' : ''}`}
            href={seoTaijiSprite}
            x={playerX - PLAYER_SIZE / 2} y={playerY - PLAYER_SIZE / 2}
            width={PLAYER_SIZE} height={PLAYER_SIZE}
            preserveAspectRatio="xMidYMid meet"
          />

          {/* Engine glow (bigger, more dynamic) */}
          <ellipse cx={playerX} cy={playerY + PLAYER_SIZE * 0.46}
            rx={8 + Math.sin(elapsedMs * 0.012) * 4}
            ry={14 + Math.sin(elapsedMs * 0.015) * 5}
            fill="rgba(56,189,248,0.5)" />
          <ellipse cx={playerX} cy={playerY + PLAYER_SIZE * 0.46}
            rx={4} ry={8 + Math.sin(elapsedMs * 0.018) * 3}
            fill="rgba(255,255,255,0.7)" />
          {/* Side thrusters when dashing */}
          {isDashing && (
            <>
              <ellipse cx={playerX - PLAYER_SIZE * 0.35} cy={playerY + PLAYER_SIZE * 0.2} rx={5} ry={10} fill="rgba(250,204,21,0.6)" />
              <ellipse cx={playerX + PLAYER_SIZE * 0.35} cy={playerY + PLAYER_SIZE * 0.2} rx={5} ry={10} fill="rgba(250,204,21,0.6)" />
            </>
          )}

          {/* Slow-motion overlay */}
          {hasSlow && (
            <rect x={0} y={0} width={STAGE_WIDTH} height={STAGE_HEIGHT}
              fill="rgba(52,211,153,0.06)" />
          )}

          {/* Low HP vignette */}
          {hp === 1 && (
            <rect x={0} y={0} width={STAGE_WIDTH} height={STAGE_HEIGHT}
              fill="none" stroke="rgba(239,68,68,0.4)" strokeWidth="20"
              opacity={0.4 + Math.sin(elapsedMs * 0.008) * 0.3} />
          )}
        </svg>

        {/* HUD */}
        <div className="space-dodge-hud">
          <div className="space-dodge-hud-top">
            <div className="space-dodge-hearts">
              {hearts.map((h, i) => <span key={`hp-${i}`} className="space-dodge-heart">{h}</span>)}
            </div>
            <div className="space-dodge-score-area">
              <p className="space-dodge-score">{score}</p>
              {combo > 0 && <p className="space-dodge-combo">x{comboMult} COMBO</p>}
            </div>
            <p className="space-dodge-best">BEST {displayedBestScore}</p>
          </div>
          <div className="space-dodge-hud-sub">
            <p className="space-dodge-level">{levelName}</p>
            <p className="space-dodge-time">{(elapsedMs / 1000).toFixed(1)}s</p>
          </div>

          {/* Active power-up indicators */}
          <div className="space-dodge-powerup-bar">
            {hasShield && <span className="space-dodge-pu-badge" style={{ background: SHIELD_COLOR }}>SHIELD</span>}
            {hasMagnet && <span className="space-dodge-pu-badge" style={{ background: MAGNET_COLOR }}>MAGNET</span>}
            {hasSlow && <span className="space-dodge-pu-badge" style={{ background: SLOW_COLOR }}>SLOW</span>}
          </div>
        </div>

        {/* Dash cooldown indicator */}
        <div className="space-dodge-dash-indicator">
          <div className="space-dodge-dash-fill" style={{ height: `${(1 - dashCooldownPct) * 100}%` }} />
          <span className="space-dodge-dash-label">{dashCooldownPct <= 0 ? 'DASH' : ''}</span>
        </div>

        <p className="space-dodge-status">{statusText}</p>

        <div className="space-dodge-overlay-actions">
          <button className="space-dodge-action-button" type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { playSfx(meteorHitAudioRef.current, 0.5, 1); finishRound() }}>
            FINISH
          </button>
          <button className="space-dodge-action-button ghost" type="button"
            onPointerDown={(e) => e.stopPropagation()} onClick={onExit}>
            EXIT
          </button>
        </div>
      </div>

      <style>{`
        ${GAME_EFFECTS_CSS}

        .space-dodge-panel {
          background: #030712;
          color: #e2e8f0;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100%;
          overflow: hidden;
          user-select: none;
          touch-action: none;
          image-rendering: pixelated;
        }

        .space-dodge-stage {
          position: relative;
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, #020617 0%, #0c1426 30%, #162033 60%, #1a2540 100%);
          overflow: hidden;
        }

        .space-dodge-svg {
          display: block;
          width: 100%;
          height: 100%;
        }

        .space-dodge-player {
          filter: drop-shadow(0 0 12px rgba(56, 189, 248, 0.7));
          transition: opacity 0.05s;
          image-rendering: pixelated;
        }

        .space-dodge-dash-glow {
          filter: drop-shadow(0 0 18px rgba(250, 204, 21, 0.9)) drop-shadow(0 0 6px rgba(255,255,255,0.5));
        }

        .space-dodge-blink {
          animation: space-dodge-blink-anim 0.15s infinite alternate;
        }

        @keyframes space-dodge-blink-anim {
          0% { opacity: 1; }
          100% { opacity: 0.2; }
        }

        .space-dodge-level-flash {
          position: absolute;
          inset: 0;
          background: rgba(250, 204, 21, 0.15);
          animation: space-dodge-level-flash-anim 0.6s ease-out forwards;
          pointer-events: none;
          z-index: 15;
        }

        @keyframes space-dodge-level-flash-anim {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }

        .space-dodge-hud {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          padding: 12px 14px 6px;
          pointer-events: none;
          z-index: 10;
        }

        .space-dodge-hud-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .space-dodge-hud-sub {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-top: 2px;
        }

        .space-dodge-hearts {
          display: flex;
          gap: 3px;
          font-size: 20px;
        }

        .space-dodge-heart { display: inline-block; }

        .space-dodge-score-area {
          flex: 1;
          text-align: center;
        }

        .space-dodge-score {
          margin: 0;
          font-size: 36px;
          font-weight: 800;
          color: #f8fafc;
          text-shadow: 0 2px 12px rgba(56, 189, 248, 0.5);
          font-family: monospace;
        }

        .space-dodge-combo {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: #facc15;
          text-shadow: 0 1px 6px rgba(250, 204, 21, 0.5);
          animation: space-dodge-combo-pulse 0.6s ease-in-out infinite alternate;
        }

        @keyframes space-dodge-combo-pulse {
          0% { transform: scale(1); }
          100% { transform: scale(1.12); }
        }

        .space-dodge-best {
          margin: 0;
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          text-align: right;
          min-width: 60px;
          font-family: monospace;
        }

        .space-dodge-level {
          margin: 0;
          font-size: 11px;
          font-weight: 700;
          color: #facc15;
          text-shadow: 0 0 6px rgba(250,204,21,0.4);
          letter-spacing: 1px;
          font-family: monospace;
        }

        .space-dodge-time {
          margin: 0;
          font-size: 12px;
          color: #64748b;
          font-family: monospace;
        }

        .space-dodge-powerup-bar {
          display: flex;
          justify-content: center;
          gap: 6px;
          margin-top: 4px;
        }

        .space-dodge-pu-badge {
          padding: 2px 10px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 700;
          color: white;
          animation: space-dodge-pu-glow 1s ease-in-out infinite alternate;
          font-family: monospace;
        }

        @keyframes space-dodge-pu-glow {
          0% { opacity: 0.7; }
          100% { opacity: 1; }
        }

        .space-dodge-dash-indicator {
          position: absolute;
          right: 10px;
          bottom: 70px;
          width: 28px;
          height: 80px;
          background: rgba(0,0,0,0.4);
          border-radius: 14px;
          border: 2px solid rgba(56,189,248,0.3);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          align-items: center;
          z-index: 10;
        }

        .space-dodge-dash-fill {
          width: 100%;
          background: linear-gradient(180deg, #38bdf8, #0ea5e9);
          border-radius: 0 0 14px 14px;
          transition: height 0.1s;
        }

        .space-dodge-dash-label {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 8px;
          font-weight: 700;
          color: white;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
          font-family: monospace;
          writing-mode: vertical-rl;
          letter-spacing: 1px;
        }

        .space-dodge-status {
          position: absolute;
          bottom: 65px;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 16px;
          font-weight: 700;
          color: #cbd5e1;
          margin: 0;
          pointer-events: none;
          z-index: 10;
          text-shadow: 0 1px 8px rgba(0, 0, 0, 0.9);
          font-family: monospace;
        }

        .space-dodge-overlay-actions {
          position: absolute;
          bottom: 14px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          gap: 10px;
          z-index: 20;
        }

        .space-dodge-action-button {
          padding: 10px 22px;
          border: none;
          border-radius: 10px;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          background: rgba(30, 58, 95, 0.9);
          color: #e2e8f0;
          backdrop-filter: blur(4px);
          transition: background 0.15s;
          font-family: monospace;
        }

        .space-dodge-action-button:hover { background: rgba(30, 58, 95, 1); }

        .space-dodge-action-button.ghost {
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
        }

        .space-dodge-action-button.ghost:hover { background: rgba(255, 255, 255, 0.14); }
      `}</style>
    </section>
  )
}

export const spaceDodgeModule: MiniGameModule = {
  manifest: {
    id: 'space-dodge',
    title: 'Space Dodge',
    description: 'Dodge meteors, collect stars & coins! Dash to dodge! Boss meteors appear!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#1e3a5f',
  },
  Component: SpaceDodgeGame,
}
