import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import hitSfx from '../../../assets/sounds/ball-bounce-hit.mp3'
import perfectSfx from '../../../assets/sounds/ball-bounce-perfect.mp3'
import feverSfx from '../../../assets/sounds/ball-bounce-fever.mp3'
import wallSfx from '../../../assets/sounds/ball-bounce-wall.mp3'
import powerupSfx from '../../../assets/sounds/ball-bounce-powerup.mp3'
import fallSfx from '../../../assets/sounds/ball-bounce-fall.mp3'
import comboSfx from '../../../assets/sounds/ball-bounce-combo.mp3'

// ─── Constants ────────────────────────────────────
const BASE_GRAVITY = 0.0012
const GRAVITY_INCREASE_PER_BOUNCE = 0.000015
const MAX_GRAVITY = 0.0028
const BOUNCE_VELOCITY = -0.58
const STRONG_BOUNCE_VELOCITY = -0.74
const FEVER_COMBO_THRESHOLD = 10
const FEVER_SCORE_MULTIPLIER = 3
const WALL_BOUNCE_DAMPING = 0.82
const HORIZONTAL_TAP_FORCE = 0.3
const BALL_RADIUS = 22
const TAP_RADIUS_TOLERANCE = 65
const PERFECT_TAP_RADIUS = 28
const COMBO_DECAY_MS = 2200
const HEIGHT_SCORE_DIVISOR = 70

// PowerUp types
const POWERUP_TYPES = ['shield', 'magnet', 'double', 'slow', 'giant'] as const
type PowerUpType = typeof POWERUP_TYPES[number]
const POWERUP_EMOJIS: Record<PowerUpType, string> = {
  shield: '🛡️', magnet: '🧲', double: '✖️2', slow: '🐌', giant: '🔴',
}
const POWERUP_DURATION_MS = 5000
const POWERUP_SPAWN_INTERVAL_MS = 8000
const POWERUP_SIZE = 28

// Obstacle
const OBSTACLE_SPAWN_INTERVAL_MS = 12000
const OBSTACLE_SPEED = 0.08

// Star collectible
const STAR_SPAWN_INTERVAL_MS = 4000
const STAR_SIZE = 18
const STAR_POINTS = 5

// Platform
const PLATFORM_SPAWN_CHANCE = 0.18
const PLATFORM_WIDTH = 55
const PLATFORM_HEIGHT = 7
const PLATFORM_DURATION_MS = 5000

// Trail
const MAX_TRAIL_POINTS = 12

const COMBO_COLORS = [
  '#f43f5e', '#fb923c', '#facc15', '#4ade80', '#22d3ee', '#818cf8', '#e879f9',
] as const

// ─── Types ────────────────────────────────────────
interface Platform { x: number; y: number; remainingMs: number }
interface PowerUp { x: number; y: number; type: PowerUpType; remainingMs: number }
interface Obstacle { x: number; y: number; w: number; h: number; vx: number }
interface Star { x: number; y: number; collected: boolean }
interface TrailPoint { x: number; y: number; age: number }

// ─── Helpers ──────────────────────────────────────
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
function comboColor(combo: number): string {
  if (combo <= 0) return COMBO_COLORS[0]
  return COMBO_COLORS[combo % COMBO_COLORS.length]
}

// ─── Component ────────────────────────────────────
function BallBounceMiniGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects({ maxParticles: 40 })
  const containerRef = useRef<HTMLDivElement | null>(null)
  const arenaRef = useRef<HTMLDivElement | null>(null)

  // Measured arena size
  const [, setArenaW] = useState(320)
  const [arenaH, setArenaH] = useState(568)
  const arenaWRef = useRef(320)
  const arenaHRef = useRef(568)

  // Ball state
  const [ballX, setBallX] = useState(160)
  const [ballY, setBallY] = useState(300)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxHeight, setMaxHeight] = useState(0)
  const [bounceCount, setBounceCount] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [powerUps, setPowerUps] = useState<PowerUp[]>([])
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [trail, setTrail] = useState<TrailPoint[]>([])
  const [activePowerUp, setActivePowerUp] = useState<PowerUpType | null>(null)
  const [powerUpTimer, setPowerUpTimer] = useState(0)
  const [ballScale, setBallScale] = useState(1)
  const [hasShield, setHasShield] = useState(false)
  const [comboLabel, setComboLabel] = useState('')
  const [dangerZone, setDangerZone] = useState(false)
  const [milestone, setMilestone] = useState('')

  // Refs for game loop
  const ballXRef = useRef(160)
  const ballYRef = useRef(300)
  const vxRef = useRef(0)
  const vyRef = useRef(-0.35)
  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxHeightRef = useRef(0)
  const bounceCountRef = useRef(0)
  const lastBounceAtRef = useRef(0)
  const finishedRef = useRef(false)
  const gravityRef = useRef(BASE_GRAVITY)
  const platformsRef = useRef<Platform[]>([])
  const powerUpsRef = useRef<PowerUp[]>([])
  const obstaclesRef = useRef<Obstacle[]>([])
  const starsRef = useRef<Star[]>([])
  const trailRef = useRef<TrailPoint[]>([])
  const activePowerUpRef = useRef<PowerUpType | null>(null)
  const powerUpTimerRef = useRef(0)
  const ballScaleRef = useRef(1)
  const hasShieldRef = useRef(false)
  const lastPowerUpSpawnRef = useRef(0)
  const lastObstacleSpawnRef = useRef(0)
  const lastStarSpawnRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const elapsedMsRef = useRef(0)
  const feverActiveRef = useRef(false)
  const trailCounterRef = useRef(0)
  const lastMilestoneRef = useRef(0)
  const milestoneTimerRef = useRef<number | null>(null)

  // Audio refs
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({
    hit: null, perfect: null, fever: null, wall: null,
    powerup: null, fall: null, combo: null,
  })

  const playSfx = useCallback((key: string, volume: number, rate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  // ─── Measure arena ─────────────────────────────
  const measuredRef = useRef(false)
  useEffect(() => {
    const measure = () => {
      const el = arenaRef.current
      if (!el) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) {
        arenaWRef.current = w
        arenaHRef.current = h
        setArenaW(w)
        setArenaH(h)
        if (!measuredRef.current) {
          measuredRef.current = true
          ballXRef.current = w / 2
          ballYRef.current = h * 0.55
          setBallX(w / 2)
          setBallY(h * 0.55)
        }
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // ─── Computed arena boundaries ──────────────────
  const floorY = () => arenaHRef.current - BALL_RADIUS * ballScaleRef.current

  // ─── Audio init ─────────────────────────────────
  useEffect(() => {
    const sources: Record<string, string> = {
      hit: hitSfx, perfect: perfectSfx, fever: feverSfx,
      wall: wallSfx, powerup: powerupSfx, fall: fallSfx, combo: comboSfx,
    }
    for (const [key, src] of Object.entries(sources)) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioRefs.current[key] = a
    }
    return () => {
      for (const a of Object.values(audioRefs.current)) {
        if (a) { a.pause(); a.currentTime = 0 }
      }
      effects.cleanup()
    }
  }, [])

  // ─── Finish game ────────────────────────────────
  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setGameOver(true)
    playSfx('fall', 0.7, 0.9)
    effects.triggerShake(12, 300)
    effects.triggerFlash('rgba(239,68,68,0.4)', 200)

    const elapsedMs = Math.max(Math.round(DEFAULT_FRAME_MS), Math.round(elapsedMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playSfx, effects])

  // ─── Apply power-up ─────────────────────────────
  const applyPowerUp = useCallback((type: PowerUpType) => {
    activePowerUpRef.current = type
    powerUpTimerRef.current = POWERUP_DURATION_MS
    setActivePowerUp(type)
    setPowerUpTimer(POWERUP_DURATION_MS)
    playSfx('powerup', 0.5)
    effects.triggerFlash('rgba(250,204,21,0.3)', 120)

    switch (type) {
      case 'shield':
        hasShieldRef.current = true
        setHasShield(true)
        break
      case 'giant':
        ballScaleRef.current = 1.6
        setBallScale(1.6)
        break
      case 'slow':
        gravityRef.current = BASE_GRAVITY * 0.5
        break
      case 'double':
      case 'magnet':
        break
    }
  }, [playSfx, effects])

  const clearPowerUp = useCallback(() => {
    const prev = activePowerUpRef.current
    activePowerUpRef.current = null
    powerUpTimerRef.current = 0
    setActivePowerUp(null)
    setPowerUpTimer(0)
    if (prev === 'giant') { ballScaleRef.current = 1; setBallScale(1) }
    if (prev === 'slow') { gravityRef.current = Math.min(MAX_GRAVITY, BASE_GRAVITY + bounceCountRef.current * GRAVITY_INCREASE_PER_BOUNCE) }
    if (prev === 'shield') { hasShieldRef.current = false; setHasShield(false) }
  }, [])

  // ─── Handle tap ─────────────────────────────────
  const handleTap = useCallback((clientX: number, clientY: number) => {
    if (finishedRef.current) return
    const arena = arenaRef.current
    if (!arena) return

    const rect = arena.getBoundingClientRect()
    const scaleX = arenaWRef.current / rect.width
    const scaleY = arenaHRef.current / rect.height
    const tapX = (clientX - rect.left) * scaleX
    const tapY = (clientY - rect.top) * scaleY

    const dx = tapX - ballXRef.current
    const dy = tapY - ballYRef.current
    const dist = Math.hypot(dx, dy)
    const effectiveRadius = TAP_RADIUS_TOLERANCE * ballScaleRef.current

    if (dist > effectiveRadius) return

    const now = performance.now()
    const isPerfect = dist <= PERFECT_TAP_RADIUS * ballScaleRef.current
    const isComboKept = (now - lastBounceAtRef.current) <= COMBO_DECAY_MS
    const nextCombo = isComboKept ? comboRef.current + 1 : 1
    comboRef.current = nextCombo
    setCombo(nextCombo)
    lastBounceAtRef.current = now

    const nextBounce = bounceCountRef.current + 1
    bounceCountRef.current = nextBounce
    setBounceCount(nextBounce)

    // Gravity increase
    if (activePowerUpRef.current !== 'slow') {
      gravityRef.current = Math.min(MAX_GRAVITY, BASE_GRAVITY + nextBounce * GRAVITY_INCREASE_PER_BOUNCE)
    }

    // Fever
    const feverNow = nextCombo >= FEVER_COMBO_THRESHOLD
    if (feverNow && !feverActiveRef.current) {
      playSfx('fever', 0.55)
      effects.triggerFlash('rgba(250,204,21,0.4)', 150)
    }
    feverActiveRef.current = feverNow
    setIsFever(feverNow)

    // Score
    const heightRatio = 1 - (ballYRef.current / arenaHRef.current)
    const heightBonus = Math.floor(heightRatio * 10)
    const comboBonus = Math.floor(nextCombo / 3)
    const perfectBonus = isPerfect ? 5 : 0
    let pts = 1 + heightBonus + comboBonus + perfectBonus
    if (feverNow) pts *= FEVER_SCORE_MULTIPLIER
    if (activePowerUpRef.current === 'double') pts *= 2
    const nextScore = scoreRef.current + pts
    scoreRef.current = nextScore
    setScore(nextScore)

    // Milestone check
    const milestones = [50, 100, 200, 500, 1000, 2000, 5000]
    for (const m of milestones) {
      if (nextScore >= m && lastMilestoneRef.current < m) {
        lastMilestoneRef.current = m
        setMilestone(`${m} POINTS!`)
        effects.triggerFlash('rgba(250,204,21,0.5)', 200)
        effects.spawnParticles(8, arenaWRef.current / 2, arenaHRef.current * 0.3, ['🎉', '🏆', '💯', '🔥'])
        effects.triggerShake(4, 200)
        if (milestoneTimerRef.current) clearTimeout(milestoneTimerRef.current)
        milestoneTimerRef.current = window.setTimeout(() => setMilestone(''), 1500)
        break
      }
    }

    // Combo label
    const label = getComboLabel(nextCombo)
    setComboLabel(label)

    // Spawn platform
    if (Math.random() < PLATFORM_SPAWN_CHANCE) {
      const pX = Math.random() * (arenaWRef.current - PLATFORM_WIDTH)
      const pY = floorY() - 50 - Math.random() * (arenaHRef.current * 0.4)
      platformsRef.current = [...platformsRef.current, { x: pX, y: pY, remainingMs: PLATFORM_DURATION_MS }]
    }

    // Bounce
    vyRef.current = isPerfect ? STRONG_BOUNCE_VELOCITY : BOUNCE_VELOCITY
    const normDx = (tapX - ballXRef.current) / effectiveRadius
    vxRef.current = -normDx * HORIZONTAL_TAP_FORCE

    // Effects
    effects.comboHitBurst(tapX, tapY, nextCombo, pts,
      isPerfect ? ['✨', '⭐', '💎', '🌟'] : undefined)
    if (isPerfect) {
      effects.triggerFlash('rgba(255,255,255,0.5)', 60)
      playSfx('perfect', 0.5, 1 + nextCombo * 0.015)
    } else {
      playSfx('hit', 0.45, 1 + nextCombo * 0.01)
    }
    if (nextCombo > 0 && nextCombo % 5 === 0) {
      playSfx('combo', 0.4, 0.9 + nextCombo * 0.01)
    }
  }, [playSfx, effects, applyPowerUp])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    handleTap(e.clientX, e.clientY)
  }, [handleTap])

  // ─── ESC handler ────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit])

  // ─── Game loop ──────────────────────────────────
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs

      const AW = arenaWRef.current
      const AH = arenaHRef.current
      const scale = ballScaleRef.current
      const br = BALL_RADIUS * scale
      const fy = AH - br
      const cy = br
      const wl = br
      const wr = AW - br

      // PowerUp timer
      if (activePowerUpRef.current) {
        powerUpTimerRef.current -= deltaMs
        setPowerUpTimer(Math.max(0, powerUpTimerRef.current))
        if (powerUpTimerRef.current <= 0) clearPowerUp()
      }

      // Gravity
      const grav = activePowerUpRef.current === 'slow' ? BASE_GRAVITY * 0.5 : gravityRef.current
      vyRef.current += grav * deltaMs

      let nx = ballXRef.current + vxRef.current * deltaMs
      let ny = ballYRef.current + vyRef.current * deltaMs

      // Wall collision
      if (nx <= wl) {
        nx = wl; vxRef.current = Math.abs(vxRef.current) * WALL_BOUNCE_DAMPING
        playSfx('wall', 0.25)
        effects.spawnParticles(3, nx, ny, ['💫'], 'circle')
      } else if (nx >= wr) {
        nx = wr; vxRef.current = -Math.abs(vxRef.current) * WALL_BOUNCE_DAMPING
        playSfx('wall', 0.25)
        effects.spawnParticles(3, nx, ny, ['💫'], 'circle')
      }
      if (ny <= cy) { ny = cy; vyRef.current = Math.abs(vyRef.current) * 0.3 }

      // Platform collision
      let onPlat = false
      for (const p of platformsRef.current) {
        if (ny + br >= p.y && ny + br <= p.y + PLATFORM_HEIGHT + 5 &&
            nx >= p.x - br && nx <= p.x + PLATFORM_WIDTH + br && vyRef.current > 0) {
          ny = p.y - br
          vyRef.current = BOUNCE_VELOCITY * 0.75
          onPlat = true
          effects.spawnParticles(2, nx, p.y, ['💨'], 'circle')
          break
        }
      }

      // Obstacle collision
      for (let i = obstaclesRef.current.length - 1; i >= 0; i--) {
        const ob = obstaclesRef.current[i]
        ob.x += ob.vx * deltaMs
        if (ob.x < -ob.w || ob.x > AW + ob.w) {
          obstaclesRef.current.splice(i, 1)
          continue
        }
        if (nx + br > ob.x && nx - br < ob.x + ob.w &&
            ny + br > ob.y && ny - br < ob.y + ob.h) {
          if (hasShieldRef.current) {
            hasShieldRef.current = false
            setHasShield(false)
            obstaclesRef.current.splice(i, 1)
            effects.triggerFlash('rgba(59,130,246,0.4)', 100)
            effects.spawnParticles(5, nx, ny, ['🛡️', '💥'], 'emoji')
            effects.triggerShake(6, 100)
          } else {
            vyRef.current = 0.3
            effects.triggerShake(8, 150)
            effects.triggerFlash('rgba(239,68,68,0.3)', 100)
            effects.spawnParticles(4, nx, ny, ['💥', '💢'])
          }
        }
      }

      // Star collection + magnet pull
      for (let i = starsRef.current.length - 1; i >= 0; i--) {
        const s = starsRef.current[i]
        if (s.collected) continue
        const magnetRange = activePowerUpRef.current === 'magnet' ? 120 : 0
        // Magnet: pull stars towards ball
        if (magnetRange > 0) {
          const sdx = nx - s.x
          const sdy = ny - s.y
          const sDist = Math.hypot(sdx, sdy)
          if (sDist < magnetRange && sDist > 1) {
            const pull = 0.15 * deltaMs / 16
            s.x += (sdx / sDist) * pull * Math.min(sDist, 30)
            s.y += (sdy / sDist) * pull * Math.min(sDist, 30)
          }
        }
        const collectDist = br + STAR_SIZE + (magnetRange > 0 ? 20 : 0)
        if (Math.hypot(nx - s.x, ny - s.y) < collectDist) {
          s.collected = true
          const starPts = STAR_POINTS * (feverActiveRef.current ? FEVER_SCORE_MULTIPLIER : 1)
          scoreRef.current += starPts
          setScore(scoreRef.current)
          effects.showScorePopup(starPts, s.x, s.y, '#fbbf24')
          effects.spawnParticles(3, s.x, s.y, ['⭐', '✨'], 'emoji')
          playSfx('powerup', 0.3, 1.3)
        }
      }

      // PowerUp collection
      for (let i = powerUpsRef.current.length - 1; i >= 0; i--) {
        const pu = powerUpsRef.current[i]
        pu.remainingMs -= deltaMs
        if (pu.remainingMs <= 0) { powerUpsRef.current.splice(i, 1); continue }
        if (Math.hypot(nx - pu.x, ny - pu.y) < br + POWERUP_SIZE) {
          applyPowerUp(pu.type)
          powerUpsRef.current.splice(i, 1)
          effects.spawnParticles(5, pu.x, pu.y, [POWERUP_EMOJIS[pu.type]], 'emoji')
        }
      }

      // Decay platforms
      platformsRef.current = platformsRef.current
        .map(p => ({ ...p, remainingMs: p.remainingMs - deltaMs }))
        .filter(p => p.remainingMs > 0)
      // Clean collected stars
      starsRef.current = starsRef.current.filter(s => !s.collected)

      // Floor check
      if (ny >= fy && !onPlat) {
        if (hasShieldRef.current) {
          hasShieldRef.current = false
          setHasShield(false)
          vyRef.current = STRONG_BOUNCE_VELOCITY
          ny = fy - 1
          effects.triggerFlash('rgba(59,130,246,0.5)', 120)
          effects.spawnParticles(6, nx, fy, ['🛡️', '💫', '✨'])
          effects.triggerShake(6, 100)
        } else {
          finishGame()
          animationFrameRef.current = null
          return
        }
      }

      // Spawners
      const elapsed = elapsedMsRef.current
      if (elapsed - lastPowerUpSpawnRef.current > POWERUP_SPAWN_INTERVAL_MS && bounceCountRef.current > 3) {
        lastPowerUpSpawnRef.current = elapsed
        const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
        powerUpsRef.current.push({
          x: 30 + Math.random() * (AW - 60),
          y: 60 + Math.random() * (AH * 0.5),
          type, remainingMs: 6000,
        })
      }
      if (elapsed - lastObstacleSpawnRef.current > OBSTACLE_SPAWN_INTERVAL_MS && bounceCountRef.current > 8) {
        lastObstacleSpawnRef.current = elapsed
        const fromLeft = Math.random() > 0.5
        obstaclesRef.current.push({
          x: fromLeft ? -40 : AW + 10,
          y: 80 + Math.random() * (AH * 0.5),
          w: 30 + Math.random() * 20, h: 12,
          vx: (fromLeft ? 1 : -1) * OBSTACLE_SPEED,
        })
      }
      if (elapsed - lastStarSpawnRef.current > STAR_SPAWN_INTERVAL_MS) {
        lastStarSpawnRef.current = elapsed
        starsRef.current.push({
          x: 30 + Math.random() * (AW - 60),
          y: 40 + Math.random() * (AH * 0.4),
          collected: false,
        })
      }

      // Trail
      trailCounterRef.current += deltaMs
      if (trailCounterRef.current > 30) {
        trailCounterRef.current = 0
        trailRef.current = [{ x: nx, y: ny, age: 0 }, ...trailRef.current.slice(0, MAX_TRAIL_POINTS - 1)]
      }
      trailRef.current = trailRef.current
        .map(t => ({ ...t, age: t.age + deltaMs }))
        .filter(t => t.age < 400)

      ballXRef.current = nx
      ballYRef.current = ny
      setBallX(nx)
      setBallY(ny)

      // Danger zone detection (bottom 15% of arena)
      const dangerThreshold = AH * 0.85
      setDangerZone(ny > dangerThreshold && bounceCountRef.current > 0)

      // Max height
      const curHeight = Math.max(0, fy - ny)
      if (curHeight > maxHeightRef.current) {
        maxHeightRef.current = curHeight
        setMaxHeight(curHeight)
      }

      // Height score
      if (bounceCountRef.current > 0) {
        const hScore = Math.floor(curHeight / HEIGHT_SCORE_DIVISOR)
        if (hScore > 0) {
          scoreRef.current += hScore
          setScore(scoreRef.current)
        }
      }

      // Sync state
      setPlatforms([...platformsRef.current])
      setPowerUps([...powerUpsRef.current])
      setObstacles([...obstaclesRef.current])
      setStars(starsRef.current.filter(s => !s.collected))
      setTrail([...trailRef.current])

      effects.updateParticles()
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
  }, [finishGame, clearPowerUp, applyPowerUp, playSfx, effects])

  // ─── Render helpers ─────────────────────────────
  const ballCol = comboColor(combo)
  const br = BALL_RADIUS * ballScale
  const shadowSize = clamp(4 + combo * 1.5, 4, 18)
  const heightPct = clamp((maxHeight / (arenaH - 50)) * 100, 0, 100)
  const curHeightPct = clamp(((arenaH - BALL_RADIUS - ballY) / (arenaH - 50)) * 100, 0, 100)
  const displayBest = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const puTimerPct = activePowerUp ? (powerUpTimer / POWERUP_DURATION_MS) * 100 : 0
  const heightBgHue = clamp(curHeightPct * 1.2, 0, 120)
  const bgGrad = isFever
    ? `linear-gradient(180deg, hsl(${heightBgHue}, 15%, 96%) 0%, hsl(${heightBgHue + 20}, 12%, 90%) 50%, hsl(${heightBgHue + 40}, 10%, 87%) 100%)`
    : 'linear-gradient(180deg, #f8f7f2 0%, #ede9df 50%, #e8e5dc 100%)'

  return (
    <section
      ref={containerRef}
      className="mini-game-panel ball-bounce-panel"
      aria-label="ball-bounce-mini-game"
      style={{
        maxWidth: '432px', width: '100%', aspectRatio: '9/16',
        margin: '0 auto', overflow: 'hidden', position: 'relative',
        background: bgGrad,
        borderRadius: '12px',
        transition: 'background 500ms ease',
        ...effects.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        @keyframes bb-fever { 0%,100%{opacity:.7;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
        @keyframes bb-float { 0%{transform:translateY(0)} 50%{transform:translateY(-6px)} 100%{transform:translateY(0)} }
        @keyframes bb-pulse-ring { 0%{transform:scale(1);opacity:.6} 100%{transform:scale(2.5);opacity:0} }
        @keyframes bb-star-spin { 0%{transform:rotate(0)} 100%{transform:rotate(360deg)} }
        @keyframes bb-obstacle-glow { 0%,100%{box-shadow:0 0 6px rgba(239,68,68,.4)} 50%{box-shadow:0 0 14px rgba(239,68,68,.8)} }
        @keyframes bb-powerup-bob { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-4px) scale(1.1)} }
        @keyframes bb-shield-pulse { 0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,.4)} 50%{box-shadow:0 0 0 8px rgba(59,130,246,.15)} }
        @keyframes bb-combo-pop { 0%{transform:scale(0) translateY(10px);opacity:0} 30%{transform:scale(1.3) translateY(-5px);opacity:1} 100%{transform:scale(1) translateY(0);opacity:1} }
        @keyframes bb-danger-pulse { 0%,100%{opacity:.15} 50%{opacity:.35} }
        @keyframes bb-milestone { 0%{transform:scale(0) rotate(-10deg);opacity:0} 30%{transform:scale(1.2) rotate(3deg);opacity:1} 60%{transform:scale(0.95) rotate(-1deg)} 100%{transform:scale(1) rotate(0);opacity:1} }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* ─── HUD ─────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '10px 14px 6px', display: 'flex', flexDirection: 'column', gap: '4px',
        background: 'linear-gradient(180deg, rgba(248,247,242,0.95) 0%, transparent 100%)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: '24px', fontWeight: 800, color: '#1f2937', textShadow: '0 1px 0 rgba(0,0,0,0.1)' }}>
            {score.toLocaleString()}
          </span>
          <span style={{ fontSize: '10px', color: '#9ca3af' }}>
            BEST {displayBest.toLocaleString()}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#6b7280' }}>
          <span>Bounce <strong style={{ color: '#1f2937' }}>{bounceCount}</strong></span>
          <span style={{ color: ballCol, fontWeight: 700 }}>
            COMBO <strong>{combo}</strong>
          </span>
          <span>Max <strong style={{ color: '#1f2937' }}>{Math.floor(maxHeight)}</strong></span>
        </div>

        {/* Fever banner */}
        {isFever && (
          <div style={{
            textAlign: 'center', color: '#fbbf24', fontWeight: 800, fontSize: '12px',
            textShadow: '0 0 10px #f59e0b', animation: 'bb-fever 0.35s ease-in-out infinite alternate',
          }}>
            FEVER x{FEVER_SCORE_MULTIPLIER}
          </div>
        )}

        {/* Combo label */}
        {comboLabel && combo >= 3 && (
          <div style={{
            textAlign: 'center', fontSize: '14px', fontWeight: 800,
            color: getComboColor(combo), textShadow: `0 0 8px ${getComboColor(combo)}`,
            animation: 'bb-combo-pop 0.3s ease-out',
          }}>
            {comboLabel}
          </div>
        )}

        {/* Active powerup indicator */}
        {activePowerUp && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center',
          }}>
            <span style={{ fontSize: '16px' }}>{POWERUP_EMOJIS[activePowerUp]}</span>
            <div style={{
              flex: 1, maxWidth: '120px', height: '6px', borderRadius: '3px',
              background: 'rgba(0,0,0,0.1)', overflow: 'hidden',
            }}>
              <div style={{
                width: `${puTimerPct}%`, height: '100%', borderRadius: '3px',
                background: 'linear-gradient(90deg, #fbbf24, #f59e0b)',
                transition: 'width 100ms linear',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* ─── Height meter ────────────────────── */}
      <div style={{
        position: 'absolute', left: '6px', top: '80px', bottom: '20px', width: '6px',
        borderRadius: '3px', background: 'rgba(0,0,0,0.06)', zIndex: 5, overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', bottom: 0, width: '100%', borderRadius: '3px',
          height: `${heightPct}%`, background: 'rgba(251,191,36,0.3)',
          transition: 'height 200ms ease',
        }} />
        <div style={{
          position: 'absolute', bottom: 0, width: '100%', borderRadius: '3px',
          height: `${curHeightPct}%`, background: ballCol,
          transition: 'height 50ms ease',
        }} />
      </div>

      {/* ─── Arena ───────────────────────────── */}
      <div
        ref={arenaRef}
        onPointerDown={handlePointerDown}
        role="presentation"
        style={{
          position: 'absolute', inset: 0, cursor: gameOver ? 'default' : 'pointer',
          touchAction: 'none',
        }}
      >
        {/* Floor */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px',
          background: 'linear-gradient(90deg, #ef4444, #dc2626)',
          boxShadow: '0 -2px 12px rgba(239,68,68,0.3)',
        }} />

        {/* Floor danger zone */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: '30px',
          background: 'linear-gradient(0deg, rgba(239,68,68,0.08) 0%, transparent 100%)',
          pointerEvents: 'none',
        }} />

        {/* Danger warning overlay */}
        {dangerZone && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            border: '3px solid rgba(239,68,68,0.4)',
            borderRadius: 'inherit',
            animation: 'bb-danger-pulse 0.5s ease-in-out infinite',
            zIndex: 8,
          }} />
        )}

        {/* Milestone banner */}
        {milestone && (
          <div style={{
            position: 'absolute', top: '35%', left: 0, right: 0,
            textAlign: 'center', fontSize: '20px', fontWeight: 800,
            color: '#fbbf24', textShadow: '0 2px 12px rgba(245,158,11,0.6), 0 0 20px rgba(250,204,21,0.4)',
            animation: 'bb-milestone 0.5s ease-out',
            zIndex: 15, pointerEvents: 'none',
          }}>
            {milestone}
          </div>
        )}

        {/* Platforms */}
        {platforms.map((p, i) => (
          <div key={`p-${i}`} style={{
            position: 'absolute', left: p.x, top: p.y,
            width: PLATFORM_WIDTH, height: PLATFORM_HEIGHT,
            background: 'linear-gradient(90deg, #22d3ee, #06b6d4)',
            borderRadius: 4, opacity: Math.min(1, p.remainingMs / 1000),
            boxShadow: '0 2px 8px rgba(34,211,238,0.35)',
          }} />
        ))}

        {/* Obstacles */}
        {obstacles.map((ob, i) => (
          <div key={`ob-${i}`} style={{
            position: 'absolute', left: ob.x, top: ob.y, width: ob.w, height: ob.h,
            background: 'linear-gradient(90deg, #ef4444, #dc2626)',
            borderRadius: 3, animation: 'bb-obstacle-glow 1s ease-in-out infinite',
          }} />
        ))}

        {/* Stars */}
        {stars.map((s, i) => (
          <div key={`s-${i}`} style={{
            position: 'absolute', left: s.x - STAR_SIZE / 2, top: s.y - STAR_SIZE / 2,
            width: STAR_SIZE, height: STAR_SIZE, fontSize: `${STAR_SIZE}px`, lineHeight: 1,
            animation: 'bb-star-spin 3s linear infinite, bb-float 1.5s ease-in-out infinite',
          }}>
            ⭐
          </div>
        ))}

        {/* PowerUps */}
        {powerUps.map((pu, i) => (
          <div key={`pu-${i}`} style={{
            position: 'absolute', left: pu.x - POWERUP_SIZE / 2, top: pu.y - POWERUP_SIZE / 2,
            width: POWERUP_SIZE, height: POWERUP_SIZE, fontSize: `${POWERUP_SIZE - 4}px`,
            lineHeight: 1, textAlign: 'center',
            animation: 'bb-powerup-bob 1s ease-in-out infinite',
            opacity: Math.min(1, pu.remainingMs / 1000),
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
          }}>
            {POWERUP_EMOJIS[pu.type]}
          </div>
        ))}

        {/* Trail */}
        {trail.map((t, i) => {
          const progress = t.age / 400
          const size = br * 2 * (1 - progress * 0.7)
          return (
            <div key={`t-${i}`} style={{
              position: 'absolute',
              left: t.x - size / 2, top: t.y - size / 2,
              width: size, height: size, borderRadius: '50%',
              background: ballCol, opacity: (1 - progress) * 0.25,
              pointerEvents: 'none',
            }} />
          )
        })}

        {/* Ball shadow */}
        <div style={{
          position: 'absolute',
          left: ballX - br * 0.6, top: arenaH - 8,
          width: br * 1.2, height: 4, borderRadius: '50%',
          background: 'rgba(0,0,0,0.12)',
          transform: `scaleX(${clamp(1 - (arenaH - ballY) / arenaH * 0.5, 0.3, 1)})`,
          pointerEvents: 'none',
        }} />

        {/* Ball */}
        <div style={{
          position: 'absolute',
          left: ballX - br, top: ballY - br,
          width: br * 2, height: br * 2, borderRadius: '50%',
          background: `radial-gradient(circle at 35% 35%, ${ballCol}dd, ${ballCol})`,
          boxShadow: [
            `0 ${shadowSize}px ${shadowSize * 2}px ${ballCol}44`,
            `inset 0 -${br * 0.3}px ${br * 0.5}px rgba(0,0,0,0.2)`,
            `inset 0 ${br * 0.2}px ${br * 0.4}px rgba(255,255,255,0.4)`,
            hasShield ? '0 0 0 4px rgba(59,130,246,0.5)' : '',
          ].filter(Boolean).join(', '),
          transition: 'width 200ms ease, height 200ms ease',
          animation: hasShield ? 'bb-shield-pulse 1s ease-in-out infinite' : undefined,
        }}>
          {/* Highlight */}
          <div style={{
            position: 'absolute', top: '15%', left: '25%',
            width: '30%', height: '20%', borderRadius: '50%',
            background: 'rgba(255,255,255,0.5)',
          }} />

          {/* Fever glow ring */}
          {isFever && (
            <div style={{
              position: 'absolute', inset: '-8px', borderRadius: '50%',
              border: '2px solid rgba(250,204,21,0.6)',
              animation: 'bb-pulse-ring 0.8s ease-out infinite',
              pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* Game Over overlay */}
        {gameOver && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '12px', zIndex: 20, backdropFilter: 'blur(3px)',
          }}>
            <p style={{
              fontSize: '28px', fontWeight: 800, color: '#fff',
              textShadow: '0 3px 8px rgba(0,0,0,0.5)',
              margin: 0,
            }}>
              GAME OVER
            </p>
            <p style={{
              fontSize: '16px', color: '#fbbf24', fontWeight: 700,
              margin: 0, textShadow: '0 2px 4px rgba(0,0,0,0.3)',
            }}>
              Score: {score.toLocaleString()}
            </p>
            <p style={{
              fontSize: '11px', color: '#d1d5db', margin: 0,
            }}>
              Bounces: {bounceCount} | Max Height: {Math.floor(maxHeight)}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

export const ballBounceMiniModule: MiniGameModule = {
  manifest: {
    id: 'ball-bounce-mini',
    title: 'Ball Bounce',
    description: 'Tap ball to bounce! Floor = Game Over!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#e11d48',
  },
  Component: BallBounceMiniGame,
}
