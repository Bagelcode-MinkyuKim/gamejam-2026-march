import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import cannonFireSfx from '../../../assets/sounds/cannon-fire.mp3'
import cannonHitSfx from '../../../assets/sounds/cannon-hit.mp3'
import cannonWhooshSfx from '../../../assets/sounds/cannon-whoosh.mp3'
import cannonMissSfx from '../../../assets/sounds/cannon-miss.mp3'
import cannonPerfectSfx from '../../../assets/sounds/cannon-perfect.mp3'
import cannonComboSfx from '../../../assets/sounds/cannon-combo.mp3'
import cannonChargeSfx from '../../../assets/sounds/cannon-charge.mp3'
import cannonPowerupSfx from '../../../assets/sounds/cannon-powerup.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ── Layout: fill 9:16 frame fully ──
const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 640

// ── Game Config ──
const GAME_TIMEOUT_MS = 120000
const MAX_SHOTS = 15
const GRAVITY = 260
const CANNON_X = 40
const CANNON_Y = VIEWBOX_HEIGHT - 60
const MIN_ANGLE_DEG = 5
const MAX_ANGLE_DEG = 85
const DEFAULT_ANGLE_DEG = 45
const MIN_POWER = 100
const MAX_POWER = 420
const POWER_FILL_SPEED = 300
const TARGET_RADIUS = 18
const TARGET_MIN_X = 160
const TARGET_MAX_X = VIEWBOX_WIDTH - 30
const TARGET_MIN_Y = 60
const TARGET_MAX_Y = VIEWBOX_HEIGHT - 140
const WIND_MAX = 40
const WIND_ESCALATION_PER_SHOT = 4
const MOVING_TARGET_THRESHOLD = 4
const MOVING_TARGET_SPEED = 40
const BONUS_TARGET_CHANCE = 0.2
const BONUS_TARGET_MULTIPLIER = 3
const HIT_STREAK_BONUS = 15
const PERFECT_HIT_RADIUS = 10
const GOOD_HIT_RADIUS = 26
const OK_HIT_RADIUS = 50
const PERFECT_SCORE = 100
const GOOD_SCORE = 60
const OK_SCORE = 30
const NEAR_SCORE = 10
const TRAIL_MAX_LENGTH = 150
const PROJECTILE_RADIUS = 5
const EXPLOSION_DURATION_MS = 500
const RESULT_DISPLAY_MS = 900
const POWERUP_RADIUS = 14
const POWERUP_SPAWN_CHANCE = 0.25
const OBSTACLE_SPAWN_CHANCE = 0.3
const OBSTACLE_MIN_SHOT = 3
const MULTI_TARGET_THRESHOLD = 7
const CLOUD_COUNT = 5

// ── Powerup Types ──
type PowerupType = 'double' | 'big-target' | 'slow-wind' | 'extra-shot'
const POWERUP_TYPES: PowerupType[] = ['double', 'big-target', 'slow-wind', 'extra-shot']
const POWERUP_COLORS: Record<PowerupType, string> = {
  'double': '#fbbf24',
  'big-target': '#34d399',
  'slow-wind': '#60a5fa',
  'extra-shot': '#f472b6',
}
const POWERUP_LABELS: Record<PowerupType, string> = {
  'double': '2x',
  'big-target': 'BIG',
  'slow-wind': 'CALM',
  'extra-shot': '+1',
}

interface Point {
  readonly x: number
  readonly y: number
}

interface ProjectileState {
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly active: boolean
}

interface ExplosionState {
  readonly x: number
  readonly y: number
  readonly remainingMs: number
  readonly color: string
}

interface ShotResult {
  readonly score: number
  readonly label: string
  readonly x: number
  readonly y: number
  readonly remainingMs: number
}

interface PowerupItem {
  readonly x: number
  readonly y: number
  readonly type: PowerupType
  readonly collected: boolean
}

interface Obstacle {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface Cloud {
  x: number
  readonly y: number
  readonly width: number
  readonly opacity: number
  readonly speed: number
}

interface TargetInfo {
  x: number
  y: number
  radius: number
  isBonus: boolean
  moving: boolean
  direction: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randomWind(shotNum: number): number {
  const range = Math.min(80, WIND_MAX + shotNum * WIND_ESCALATION_PER_SHOT)
  return Math.round(randomBetween(-range, range))
}

function randomTarget(): Point {
  return {
    x: randomBetween(TARGET_MIN_X, TARGET_MAX_X),
    y: randomBetween(TARGET_MIN_Y, TARGET_MAX_Y),
  }
}

function distanceBetween(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function scoreForDistance(distance: number, targetRadius: number): { score: number; label: string } {
  if (distance <= PERFECT_HIT_RADIUS) return { score: PERFECT_SCORE, label: 'PERFECT!' }
  if (distance <= GOOD_HIT_RADIUS) return { score: GOOD_SCORE, label: 'GOOD!' }
  if (distance <= targetRadius + OK_HIT_RADIUS * 0.5) return { score: OK_SCORE, label: 'OK' }
  if (distance <= targetRadius + OK_HIT_RADIUS) return { score: NEAR_SCORE, label: 'NEAR' }
  return { score: 0, label: 'MISS' }
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function generateClouds(): Cloud[] {
  return Array.from({ length: CLOUD_COUNT }, () => ({
    x: randomBetween(-40, VIEWBOX_WIDTH + 40),
    y: randomBetween(20, VIEWBOX_HEIGHT * 0.5),
    width: randomBetween(40, 90),
    opacity: randomBetween(0.15, 0.35),
    speed: randomBetween(3, 10),
  }))
}

function generateObstacle(shotNum: number): Obstacle | null {
  if (shotNum < OBSTACLE_MIN_SHOT || Math.random() > OBSTACLE_SPAWN_CHANCE) return null
  const w = randomBetween(20, 50)
  const h = randomBetween(30, 80)
  return {
    x: randomBetween(120, VIEWBOX_WIDTH - 80),
    y: randomBetween(VIEWBOX_HEIGHT * 0.3, VIEWBOX_HEIGHT - 120),
    width: w,
    height: h,
  }
}

function generatePowerup(): PowerupItem | null {
  if (Math.random() > POWERUP_SPAWN_CHANCE) return null
  return {
    x: randomBetween(100, VIEWBOX_WIDTH - 40),
    y: randomBetween(80, VIEWBOX_HEIGHT - 160),
    type: POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)],
    collected: false,
  }
}

function CannonShotGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [angleDeg, setAngleDeg] = useState(DEFAULT_ANGLE_DEG)
  const [power, setPower] = useState(0)
  const [isCharging, setIsCharging] = useState(false)
  const [shotsRemaining, setShotsRemaining] = useState(MAX_SHOTS)
  const [score, setScore] = useState(0)
  const [targets, setTargets] = useState<TargetInfo[]>(() => {
    const t = randomTarget()
    return [{ ...t, radius: TARGET_RADIUS, isBonus: false, moving: false, direction: 1 }]
  })
  const [wind, setWind] = useState(() => randomWind(0))
  const [projectile, setProjectile] = useState<ProjectileState | null>(null)
  const [trail, setTrail] = useState<Point[]>([])
  const [explosions, setExplosions] = useState<ExplosionState[]>([])
  const [shotResult, setShotResult] = useState<ShotResult | null>(null)
  const [gamePhase, setGamePhase] = useState<'aiming' | 'flying' | 'result' | 'finished'>('aiming')
  const [hitStreak, setHitStreak] = useState(0)
  const [, setShotNumber] = useState(0)
  const [clouds] = useState(() => generateClouds())
  const [obstacle, setObstacle] = useState<Obstacle | null>(null)
  const [powerup, setPowerup] = useState<PowerupItem | null>(null)
  const [activePowerups, setActivePowerups] = useState<PowerupType[]>([])
  const [screenFlash, setScreenFlash] = useState<string | null>(null)

  const angleRef = useRef(DEFAULT_ANGLE_DEG)
  const powerRef = useRef(0)
  const isChargingRef = useRef(false)
  const shotsRemainingRef = useRef(MAX_SHOTS)
  const scoreRef = useRef(0)
  const targetsRef = useRef<TargetInfo[]>(targets)
  const windRef = useRef(wind)
  const projectileRef = useRef<ProjectileState | null>(null)
  const trailRef = useRef<Point[]>([])
  const explosionsRef = useRef<ExplosionState[]>([])
  const shotResultRef = useRef<ShotResult | null>(null)
  const gamePhaseRef = useRef<'aiming' | 'flying' | 'result' | 'finished'>('aiming')
  const finishedRef = useRef(false)
  const hitStreakRef = useRef(0)
  const shotNumberRef = useRef(0)
  const cloudsRef = useRef(clouds)
  const obstacleRef = useRef<Obstacle | null>(null)
  const powerupRef = useRef<PowerupItem | null>(null)
  const activePowerupsRef = useRef<PowerupType[]>([])
  const elapsedMsRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)

  // Audio refs
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const playAudio = useCallback((name: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[name]
    if (audio === null || audio === undefined) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const stopAudio = useCallback((name: string) => {
    const audio = audioRefs.current[name]
    if (audio === null || audio === undefined) return
    audio.pause()
    audio.currentTime = 0
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    gamePhaseRef.current = 'finished'
    setGamePhase('finished')
    stopAudio('charge')
    playAudio('gameover', 0.6, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.max(Math.round(DEFAULT_FRAME_MS), MAX_SHOTS * 2000),
    })
  }, [onFinish, playAudio, stopAudio])

  const startNextShot = useCallback(() => {
    if (shotsRemainingRef.current <= 0) {
      finishGame()
      return
    }

    const currentShotNum = shotNumberRef.current + 1
    shotNumberRef.current = currentShotNum
    setShotNumber(currentShotNum)

    // Clear active powerups per shot
    activePowerupsRef.current = []
    setActivePowerups([])

    // Generate targets
    const nextTargets: TargetInfo[] = []
    const primaryTarget = randomTarget()
    const isBonus = Math.random() < BONUS_TARGET_CHANCE
    const isMoving = currentShotNum >= MOVING_TARGET_THRESHOLD
    nextTargets.push({
      ...primaryTarget,
      radius: TARGET_RADIUS,
      isBonus,
      moving: isMoving,
      direction: Math.random() < 0.5 ? 1 : -1,
    })

    // Multi-target after threshold
    if (currentShotNum >= MULTI_TARGET_THRESHOLD) {
      const secondTarget = randomTarget()
      nextTargets.push({
        x: clampNumber(secondTarget.x + randomBetween(-60, 60), TARGET_MIN_X, TARGET_MAX_X),
        y: clampNumber(secondTarget.y + randomBetween(-60, 60), TARGET_MIN_Y, TARGET_MAX_Y),
        radius: TARGET_RADIUS * 0.8,
        isBonus: false,
        moving: isMoving && Math.random() > 0.5,
        direction: Math.random() < 0.5 ? 1 : -1,
      })
    }

    targetsRef.current = nextTargets
    setTargets(nextTargets)

    const hasSlowWind = activePowerupsRef.current.includes('slow-wind')
    const nextWind = hasSlowWind ? Math.round(randomWind(currentShotNum) * 0.3) : randomWind(currentShotNum)
    windRef.current = nextWind
    setWind(nextWind)

    // Obstacle
    const nextObstacle = generateObstacle(currentShotNum)
    obstacleRef.current = nextObstacle
    setObstacle(nextObstacle)

    // Powerup
    const nextPowerup = generatePowerup()
    powerupRef.current = nextPowerup
    setPowerup(nextPowerup)

    setTrail([])
    trailRef.current = []
    setProjectile(null)
    projectileRef.current = null
    setExplosions([])
    explosionsRef.current = []
    setShotResult(null)
    shotResultRef.current = null
    gamePhaseRef.current = 'aiming'
    setGamePhase('aiming')
    powerRef.current = 0
    setPower(0)
  }, [finishGame])

  const fireProjectile = useCallback(() => {
    if (gamePhaseRef.current !== 'aiming') return
    const currentPower = powerRef.current
    if (currentPower < MIN_POWER * 0.3) return

    stopAudio('charge')
    const angleRad = degToRad(angleRef.current)
    const vx = Math.cos(angleRad) * currentPower
    const vy = -Math.sin(angleRad) * currentPower
    const newProjectile: ProjectileState = {
      x: CANNON_X, y: CANNON_Y,
      vx, vy, active: true,
    }
    projectileRef.current = newProjectile
    setProjectile(newProjectile)
    trailRef.current = [{ x: CANNON_X, y: CANNON_Y }]
    setTrail([{ x: CANNON_X, y: CANNON_Y }])
    gamePhaseRef.current = 'flying'
    setGamePhase('flying')
    shotsRemainingRef.current -= 1
    setShotsRemaining(shotsRemainingRef.current)
    playAudio('fire', 0.7, 0.8 + (currentPower / MAX_POWER) * 0.4)
    // Delayed whoosh
    setTimeout(() => playAudio('whoosh', 0.3, 0.9 + Math.random() * 0.2), 150)
    // Screen shake on fire
    effects.triggerShake(4)
    // Muzzle flash
    setScreenFlash('rgba(255,200,50,0.3)')
    setTimeout(() => setScreenFlash(null), 80)
  }, [playAudio, stopAudio, effects])

  const handlePointerDown = useCallback(() => {
    if (gamePhaseRef.current !== 'aiming') return
    isChargingRef.current = true
    setIsCharging(true)
    powerRef.current = MIN_POWER
    setPower(MIN_POWER)
    playAudio('charge', 0.25, 0.8)
  }, [playAudio])

  const handlePointerUp = useCallback(() => {
    if (!isChargingRef.current) return
    isChargingRef.current = false
    setIsCharging(false)
    fireProjectile()
  }, [fireProjectile])

  const handleAngleChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const nextAngle = clampNumber(Number(event.target.value), MIN_ANGLE_DEG, MAX_ANGLE_DEG)
    angleRef.current = nextAngle
    setAngleDeg(nextAngle)
  }, [])

  const handleExit = useCallback(() => {
    stopAudio('charge')
    onExit()
  }, [onExit, stopAudio])

  // Audio initialization
  useEffect(() => {
    const audioMap: Record<string, string> = {
      fire: cannonFireSfx,
      hit: cannonHitSfx,
      whoosh: cannonWhooshSfx,
      miss: cannonMissSfx,
      perfect: cannonPerfectSfx,
      combo: cannonComboSfx,
      charge: cannonChargeSfx,
      powerup: cannonPowerupSfx,
      gameover: gameOverHitSfx,
    }
    const entries: [string, HTMLAudioElement][] = []
    for (const [key, src] of Object.entries(audioMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
      entries.push([key, audio])
    }
    return () => {
      for (const [, audio] of entries) {
        audio.pause()
        audio.currentTime = 0
      }
      effects.cleanup()
      audioRefs.current = {}
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  // Main game loop
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const deltaSec = deltaMs / 1000

      elapsedMsRef.current += deltaMs
      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      // Animate clouds
      for (const cloud of cloudsRef.current) {
        cloud.x += cloud.speed * deltaSec
        if (cloud.x > VIEWBOX_WIDTH + 60) cloud.x = -cloud.width - 20
      }

      // Move targets
      if (gamePhaseRef.current === 'aiming' || gamePhaseRef.current === 'flying') {
        let targetsChanged = false
        const updatedTargets = targetsRef.current.map(t => {
          if (!t.moving) return t
          let nextY = t.y + t.direction * MOVING_TARGET_SPEED * deltaSec
          let nextDir = t.direction
          if (nextY < TARGET_MIN_Y || nextY > TARGET_MAX_Y) {
            nextDir *= -1
            nextY = clampNumber(nextY, TARGET_MIN_Y, TARGET_MAX_Y)
          }
          targetsChanged = true
          return { ...t, y: nextY, direction: nextDir }
        })
        if (targetsChanged) {
          targetsRef.current = updatedTargets
          setTargets(updatedTargets)
        }
      }

      // Power charging
      if (isChargingRef.current && gamePhaseRef.current === 'aiming') {
        const nextPower = clampNumber(powerRef.current + POWER_FILL_SPEED * deltaSec, MIN_POWER, MAX_POWER)
        powerRef.current = nextPower
        setPower(nextPower)
      }

      // Flying projectile
      if (gamePhaseRef.current === 'flying' && projectileRef.current !== null) {
        const proj = projectileRef.current
        const nextVx = proj.vx + windRef.current * deltaSec
        const nextVy = proj.vy + GRAVITY * deltaSec
        const nextX = proj.x + nextVx * deltaSec
        const nextY = proj.y + nextVy * deltaSec

        const nextTrail = [...trailRef.current, { x: nextX, y: nextY }]
        if (nextTrail.length > TRAIL_MAX_LENGTH) nextTrail.splice(0, nextTrail.length - TRAIL_MAX_LENGTH)
        trailRef.current = nextTrail
        setTrail(nextTrail)

        // Check powerup collision
        const pu = powerupRef.current
        if (pu !== null && !pu.collected) {
          const distToPu = distanceBetween({ x: nextX, y: nextY }, { x: pu.x, y: pu.y })
          if (distToPu <= POWERUP_RADIUS + PROJECTILE_RADIUS) {
            const collectedPu = { ...pu, collected: true }
            powerupRef.current = collectedPu
            setPowerup(collectedPu)
            activePowerupsRef.current = [...activePowerupsRef.current, pu.type]
            setActivePowerups([...activePowerupsRef.current])
            playAudio('powerup', 0.6)
            effects.comboHitBurst(pu.x, pu.y, 2, 50)

            // Apply instant powerups
            if (pu.type === 'extra-shot') {
              shotsRemainingRef.current += 1
              setShotsRemaining(shotsRemainingRef.current)
            }
            if (pu.type === 'big-target') {
              const bigTargets = targetsRef.current.map(t => ({ ...t, radius: t.radius * 1.5 }))
              targetsRef.current = bigTargets
              setTargets(bigTargets)
            }
            if (pu.type === 'slow-wind') {
              windRef.current = Math.round(windRef.current * 0.3)
              setWind(windRef.current)
            }
          }
        }

        // Check obstacle collision
        const obs = obstacleRef.current
        if (obs !== null) {
          if (nextX >= obs.x && nextX <= obs.x + obs.width &&
              nextY >= obs.y && nextY <= obs.y + obs.height) {
            // Bounce off obstacle
            const fromLeft = proj.x < obs.x
            const fromRight = proj.x > obs.x + obs.width
            const fromTop = proj.y < obs.y
            const bouncedVx = (fromLeft || fromRight) ? -nextVx * 0.6 : nextVx * 0.8
            const bouncedVy = fromTop ? -Math.abs(nextVy) * 0.6 : nextVy * 0.8
            const bouncedProj: ProjectileState = {
              x: proj.x, y: proj.y,
              vx: bouncedVx, vy: bouncedVy, active: true,
            }
            projectileRef.current = bouncedProj
            setProjectile(bouncedProj)
            effects.triggerShake(2)
            playAudio('miss', 0.3, 1.5)
            animationFrameRef.current = window.requestAnimationFrame(step)
            return
          }
        }

        const isOutOfBounds = nextX < -20 || nextX > VIEWBOX_WIDTH + 20 || nextY > VIEWBOX_HEIGHT + 20 || nextY < -120

        // Check target collisions
        let hitAnyTarget = false
        let totalEarned = 0
        let bestLabel = 'MISS'
        let hitX = nextX
        let hitY = Math.min(nextY, VIEWBOX_HEIGHT - 40)
        const newExplosions: ExplosionState[] = []

        for (const t of targetsRef.current) {
          const dist = distanceBetween({ x: nextX, y: nextY }, { x: t.x, y: t.y })
          const isHit = dist <= t.radius + PROJECTILE_RADIUS
          if (isHit) {
            hitAnyTarget = true
            const hitResult = scoreForDistance(dist, t.radius)
            let earned = hitResult.score
            if (earned > 0 && t.isBonus) earned *= BONUS_TARGET_MULTIPLIER
            if (earned > 0 && activePowerupsRef.current.includes('double')) earned *= 2
            totalEarned += earned
            if (hitResult.score > 0) {
              bestLabel = hitResult.label
            }
            hitX = t.x
            hitY = t.y
            newExplosions.push({
              x: t.x, y: t.y,
              remainingMs: EXPLOSION_DURATION_MS,
              color: t.isBonus ? '#a78bfa' : '#f59e0b',
            })
          }
        }

        if (hitAnyTarget || isOutOfBounds) {
          // Hit streak
          if (totalEarned > 0) {
            hitStreakRef.current += 1
            setHitStreak(hitStreakRef.current)
            if (hitStreakRef.current >= 3) {
              totalEarned += HIT_STREAK_BONUS * Math.min(hitStreakRef.current - 2, 5)
              playAudio('combo', 0.5, 0.9 + hitStreakRef.current * 0.05)
            }
          } else {
            hitStreakRef.current = 0
            setHitStreak(0)
          }

          scoreRef.current += totalEarned
          setScore(scoreRef.current)
          projectileRef.current = null
          setProjectile(null)

          if (!hitAnyTarget && isOutOfBounds) {
            newExplosions.push({
              x: clampNumber(nextX, 10, VIEWBOX_WIDTH - 10),
              y: clampNumber(nextY, 10, VIEWBOX_HEIGHT - 20),
              remainingMs: EXPLOSION_DURATION_MS * 0.6,
              color: '#6b7280',
            })
          }

          explosionsRef.current = newExplosions
          setExplosions(newExplosions)

          shotResultRef.current = {
            score: totalEarned, label: bestLabel,
            x: hitX, y: hitY,
            remainingMs: RESULT_DISPLAY_MS,
          }
          setShotResult(shotResultRef.current)
          gamePhaseRef.current = 'result'
          setGamePhase('result')

          if (totalEarned > 0) {
            effects.comboHitBurst(hitX, hitY, hitStreakRef.current, totalEarned)
            if (totalEarned >= PERFECT_SCORE) {
              playAudio('perfect', 0.6)
              effects.triggerFlash('rgba(251,191,36,0.4)')
              effects.triggerShake(6)
            } else {
              playAudio('hit', 0.5, 1 + totalEarned * 0.003)
              effects.triggerShake(3)
            }
          } else {
            playAudio('miss', 0.4)
            effects.triggerFlash('rgba(239,68,68,0.3)')
            effects.triggerShake(2)
          }
        } else {
          projectileRef.current = { x: nextX, y: nextY, vx: nextVx, vy: nextVy, active: true }
          setProjectile(projectileRef.current)
        }
      }

      // Result phase — animate explosions and result text
      if (gamePhaseRef.current === 'result') {
        const updatedExplosions = explosionsRef.current
          .map(e => ({ ...e, remainingMs: e.remainingMs - deltaMs }))
          .filter(e => e.remainingMs > 0)
        explosionsRef.current = updatedExplosions
        setExplosions(updatedExplosions)

        if (shotResultRef.current !== null) {
          const nextResRemaining = shotResultRef.current.remainingMs - deltaMs
          if (nextResRemaining <= 0) {
            shotResultRef.current = null
            setShotResult(null)
            startNextShot()
          } else {
            shotResultRef.current = { ...shotResultRef.current, remainingMs: nextResRemaining }
            setShotResult(shotResultRef.current)
          }
        }
      }

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
  }, [finishGame, playAudio, startNextShot, effects])

  // Derived display values
  const cannonAngleRad = degToRad(angleDeg)
  const cannonBarrelLength = 32
  const cannonTipX = CANNON_X + Math.cos(cannonAngleRad) * cannonBarrelLength
  const cannonTipY = CANNON_Y - Math.sin(cannonAngleRad) * cannonBarrelLength
  const powerPercent = ((power - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const windStrength = Math.abs(wind)
  const windDirection = wind >= 0 ? 'right' : 'left'
  const windArrowLength = clampNumber((windStrength / WIND_MAX) * 40, 4, 40)

  const trailPath = useMemo(() => {
    if (trail.length < 2) return ''
    return trail.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  }, [trail])

  const powerBarColor = powerPercent > 80 ? '#ef4444' : powerPercent > 50 ? '#f59e0b' : '#22c55e'

  return (
    <section
      className="mini-game-panel cannon-shot-panel"
      aria-label="cannon-shot-game"
      style={{ position: 'relative', maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', display: 'flex', flexDirection: 'column', ...effects.getShakeStyle() }}
    >
      {/* HUD Top Bar */}
      <div className="cannon-shot-hud">
        <div className="cannon-shot-hud-left">
          <span className="cannon-shot-hud-score">{score.toLocaleString()}</span>
          <span className="cannon-shot-hud-best">BEST {displayedBestScore.toLocaleString()}</span>
        </div>
        <div className="cannon-shot-hud-center">
          <span className="cannon-shot-hud-wind">
            {windDirection === 'left' ? '\u2190' : ''} WIND {windStrength.toFixed(0)} {windDirection === 'right' ? '\u2192' : ''}
          </span>
          {hitStreak >= 3 && (
            <span className="cannon-shot-hud-streak">STREAK x{hitStreak}!</span>
          )}
        </div>
        <div className="cannon-shot-hud-right">
          <span className="cannon-shot-hud-shots">{shotsRemaining}/{MAX_SHOTS}</span>
          <span className="cannon-shot-hud-shot-label">SHOTS</span>
        </div>
      </div>

      {/* Active powerup badges */}
      {activePowerups.length > 0 && (
        <div className="cannon-shot-powerup-badges">
          {activePowerups.map((p, i) => (
            <span key={i} className="cannon-shot-powerup-badge" style={{ background: POWERUP_COLORS[p] }}>
              {POWERUP_LABELS[p]}
            </span>
          ))}
        </div>
      )}

      {/* SVG Game Board — fills remaining space */}
      <div
        className="cannon-shot-board"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        role="presentation"
      >
        <svg
          className="cannon-shot-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          aria-label="cannon-shot-field"
        >
          <defs>
            <radialGradient id="cs-target-grad">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="30%" stopColor="#ef4444" stopOpacity="0.85" />
              <stop offset="60%" stopColor="#dc2626" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0.4" />
            </radialGradient>
            <radialGradient id="cs-bonus-grad">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#a78bfa" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#6d28d9" stopOpacity="0.4" />
            </radialGradient>
            <linearGradient id="cs-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f172a" />
              <stop offset="40%" stopColor="#1e3a5f" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
            <linearGradient id="cs-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#65a30d" />
              <stop offset="50%" stopColor="#4d7c0f" />
              <stop offset="100%" stopColor="#365314" />
            </linearGradient>
            <filter id="cs-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="cs-shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.3" />
            </filter>
          </defs>

          {/* Sky */}
          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT - 50} fill="url(#cs-sky)" />
          {/* Stars */}
          {Array.from({ length: 20 }, (_, i) => (
            <circle
              key={`star-${i}`}
              cx={(i * 73 + 17) % VIEWBOX_WIDTH}
              cy={(i * 31 + 11) % (VIEWBOX_HEIGHT * 0.35)}
              r={i % 3 === 0 ? 1.5 : 0.8}
              fill="#fff"
              opacity={0.3 + (i % 5) * 0.12}
            />
          ))}

          {/* Clouds */}
          {clouds.map((c, i) => (
            <ellipse
              key={`cloud-${i}`}
              cx={c.x}
              cy={c.y}
              rx={c.width / 2}
              ry={c.width / 4}
              fill="#fff"
              opacity={c.opacity}
            />
          ))}

          {/* Ground with grass detail */}
          <rect x="0" y={VIEWBOX_HEIGHT - 50} width={VIEWBOX_WIDTH} height="50" fill="url(#cs-ground)" />
          {Array.from({ length: 18 }, (_, i) => (
            <line
              key={`grass-${i}`}
              x1={i * 20 + 5}
              y1={VIEWBOX_HEIGHT - 50}
              x2={i * 20 + 5 + (i % 2 === 0 ? 3 : -3)}
              y2={VIEWBOX_HEIGHT - 56 - (i % 3) * 3}
              stroke="#84cc16"
              strokeWidth="1.5"
              opacity="0.6"
            />
          ))}

          {/* Wind indicator */}
          {wind !== 0 && (
            <g transform={`translate(${VIEWBOX_WIDTH / 2}, 30)`}>
              <line
                x1={wind < 0 ? windArrowLength / 2 : -windArrowLength / 2}
                y1="0"
                x2={wind < 0 ? -windArrowLength / 2 : windArrowLength / 2}
                y2="0"
                stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.7"
              />
              <polygon
                points={
                  wind > 0
                    ? `${windArrowLength / 2},0 ${windArrowLength / 2 - 6},-4 ${windArrowLength / 2 - 6},4`
                    : `${-windArrowLength / 2},0 ${-windArrowLength / 2 + 6},-4 ${-windArrowLength / 2 + 6},4`
                }
                fill="#fff" opacity="0.7"
              />
              {/* Wind particles */}
              {Array.from({ length: Math.min(5, Math.ceil(windStrength / 15)) }, (_, i) => (
                <line
                  key={`wind-p-${i}`}
                  x1={-30 + i * 15}
                  y1={-8 + i * 4}
                  x2={-30 + i * 15 + (wind > 0 ? 8 : -8)}
                  y2={-8 + i * 4}
                  stroke="#93c5fd"
                  strokeWidth="1"
                  opacity={0.3 + i * 0.1}
                  strokeDasharray="3 2"
                />
              ))}
            </g>
          )}

          {/* Obstacle */}
          {obstacle !== null && (
            <g filter="url(#cs-shadow)">
              <rect
                x={obstacle.x} y={obstacle.y}
                width={obstacle.width} height={obstacle.height}
                fill="#78716c" stroke="#57534e" strokeWidth="1.5"
                rx="3"
              />
              {/* Brick pattern */}
              {Array.from({ length: Math.floor(obstacle.height / 12) }, (_, row) => (
                <line
                  key={`brick-${row}`}
                  x1={obstacle.x + 2}
                  y1={obstacle.y + row * 12 + 12}
                  x2={obstacle.x + obstacle.width - 2}
                  y2={obstacle.y + row * 12 + 12}
                  stroke="#57534e" strokeWidth="0.5" opacity="0.5"
                />
              ))}
            </g>
          )}

          {/* Powerup */}
          {powerup !== null && !powerup.collected && (
            <g filter="url(#cs-glow)">
              <circle cx={powerup.x} cy={powerup.y} r={POWERUP_RADIUS + 3} fill={POWERUP_COLORS[powerup.type]} opacity="0.3">
                <animate attributeName="r" values={`${POWERUP_RADIUS + 2};${POWERUP_RADIUS + 6};${POWERUP_RADIUS + 2}`} dur="1s" repeatCount="indefinite" />
              </circle>
              <circle cx={powerup.x} cy={powerup.y} r={POWERUP_RADIUS} fill={POWERUP_COLORS[powerup.type]} stroke="#fff" strokeWidth="1.5" />
              <text x={powerup.x} y={powerup.y + 4} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">
                {POWERUP_LABELS[powerup.type]}
              </text>
            </g>
          )}

          {/* Targets */}
          {targets.map((t, i) => (
            <g key={`target-${i}`}>
              {/* Target shadow */}
              <ellipse cx={t.x} cy={t.y + t.radius + 4} rx={t.radius * 0.8} ry={3} fill="#000" opacity="0.15" />
              {/* Outer ring glow */}
              <circle cx={t.x} cy={t.y} r={t.radius + 4} fill="none" stroke={t.isBonus ? '#a78bfa' : '#ef4444'} strokeWidth="1" opacity="0.3">
                <animate attributeName="r" values={`${t.radius + 3};${t.radius + 7};${t.radius + 3}`} dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.3;0.1;0.3" dur="1.5s" repeatCount="indefinite" />
              </circle>
              {/* Main target */}
              <circle
                cx={t.x} cy={t.y} r={t.radius}
                fill={t.isBonus ? 'url(#cs-bonus-grad)' : 'url(#cs-target-grad)'}
                stroke={t.isBonus ? '#7c3aed' : '#dc2626'}
                strokeWidth={2}
              />
              {/* Inner rings */}
              <circle cx={t.x} cy={t.y} r={t.radius * 0.65} fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.5" />
              <circle cx={t.x} cy={t.y} r={t.radius * 0.35} fill="none" stroke="#fff" strokeWidth="0.8" opacity="0.7" />
              {/* Crosshair */}
              <line x1={t.x - 5} y1={t.y} x2={t.x + 5} y2={t.y} stroke="#fff" strokeWidth="1" opacity="0.8" />
              <line x1={t.x} y1={t.y - 5} x2={t.x} y2={t.y + 5} stroke="#fff" strokeWidth="1" opacity="0.8" />
              {/* Bonus label */}
              {t.isBonus && (
                <text x={t.x} y={t.y - t.radius - 6} textAnchor="middle" fill="#a78bfa" fontSize="10" fontWeight="bold" opacity="0.9">
                  x{BONUS_TARGET_MULTIPLIER}
                </text>
              )}
              {/* Moving indicator */}
              {t.moving && (
                <g>
                  <polygon points={`${t.x},${t.y - t.radius - 12} ${t.x - 4},${t.y - t.radius - 8} ${t.x + 4},${t.y - t.radius - 8}`} fill="#f97316" opacity="0.7" />
                  <polygon points={`${t.x},${t.y + t.radius + 12} ${t.x - 4},${t.y + t.radius + 8} ${t.x + 4},${t.y + t.radius + 8}`} fill="#f97316" opacity="0.7" />
                </g>
              )}
            </g>
          ))}

          {/* Aiming guide line */}
          {gamePhase === 'aiming' && (
            <line
              x1={CANNON_X} y1={CANNON_Y}
              x2={CANNON_X + Math.cos(cannonAngleRad) * 80}
              y2={CANNON_Y - Math.sin(cannonAngleRad) * 80}
              stroke="#fff" strokeWidth="0.8" strokeDasharray="4 4" opacity="0.35"
            />
          )}

          {/* Cannon */}
          <g filter="url(#cs-shadow)">
            {/* Cannon base/wheels */}
            <rect x={CANNON_X - 16} y={CANNON_Y + 2} width="32" height="14" rx="4" fill="#44403c" />
            <circle cx={CANNON_X - 8} cy={CANNON_Y + 14} r="6" fill="#57534e" stroke="#44403c" strokeWidth="1.5" />
            <circle cx={CANNON_X + 8} cy={CANNON_Y + 14} r="6" fill="#57534e" stroke="#44403c" strokeWidth="1.5" />
            <circle cx={CANNON_X - 8} cy={CANNON_Y + 14} r="2.5" fill="#78716c" />
            <circle cx={CANNON_X + 8} cy={CANNON_Y + 14} r="2.5" fill="#78716c" />
            {/* Barrel outer */}
            <line
              x1={CANNON_X} y1={CANNON_Y}
              x2={cannonTipX} y2={cannonTipY}
              stroke="#44403c" strokeWidth="10" strokeLinecap="round"
            />
            {/* Barrel inner */}
            <line
              x1={CANNON_X} y1={CANNON_Y}
              x2={cannonTipX} y2={cannonTipY}
              stroke="#6b7280" strokeWidth="6" strokeLinecap="round"
            />
            {/* Barrel highlight */}
            <line
              x1={CANNON_X + 2} y1={CANNON_Y - 2}
              x2={cannonTipX + 1} y2={cannonTipY - 1}
              stroke="#9ca3af" strokeWidth="2" strokeLinecap="round" opacity="0.5"
            />
            {/* Pivot */}
            <circle cx={CANNON_X} cy={CANNON_Y} r="7" fill="#374151" stroke="#1f2937" strokeWidth="2" />
            <circle cx={CANNON_X} cy={CANNON_Y} r="3" fill="#6b7280" />
            {/* Muzzle flash when charging */}
            {isCharging && (
              <circle
                cx={cannonTipX + Math.cos(cannonAngleRad) * 6}
                cy={cannonTipY - Math.sin(cannonAngleRad) * 6}
                r={3 + (power / MAX_POWER) * 5}
                fill="#fbbf24"
                opacity={0.3 + (power / MAX_POWER) * 0.4}
              />
            )}
          </g>

          {/* Trail */}
          {trailPath && (
            <g>
              <path d={trailPath} fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round" opacity="0.3" />
              <path d={trailPath} fill="none" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" opacity="0.6" />
            </g>
          )}

          {/* Projectile */}
          {projectile !== null && (
            <g filter="url(#cs-glow)">
              {/* Glow */}
              <circle cx={projectile.x} cy={projectile.y} r={PROJECTILE_RADIUS + 6} fill="#fbbf24" opacity="0.2" />
              <circle cx={projectile.x} cy={projectile.y} r={PROJECTILE_RADIUS + 3} fill="#f59e0b" opacity="0.35" />
              {/* Ball */}
              <circle cx={projectile.x} cy={projectile.y} r={PROJECTILE_RADIUS} fill="#1f2937" stroke="#374151" strokeWidth="1" />
              {/* Highlight */}
              <circle cx={projectile.x - 1.5} cy={projectile.y - 1.5} r="2" fill="#6b7280" opacity="0.7" />
              {/* Fire trail particles */}
              {trail.length > 3 && Array.from({ length: 3 }, (_, i) => {
                const idx = Math.max(0, trail.length - 2 - i * 3)
                const p = trail[idx]
                if (!p) return null
                return (
                  <circle
                    key={`fire-${i}`}
                    cx={p.x + (Math.random() - 0.5) * 4}
                    cy={p.y + (Math.random() - 0.5) * 4}
                    r={2 + i}
                    fill={i === 0 ? '#fbbf24' : i === 1 ? '#f97316' : '#ef4444'}
                    opacity={0.5 - i * 0.15}
                  />
                )
              })}
            </g>
          )}

          {/* Explosions */}
          {explosions.map((exp, i) => {
            const progress = 1 - exp.remainingMs / EXPLOSION_DURATION_MS
            return (
              <g key={`exp-${i}`}>
                <circle
                  cx={exp.x} cy={exp.y}
                  r={TARGET_RADIUS * (1 + progress * 2.5)}
                  fill={exp.color} opacity={(1 - progress) * 0.7}
                />
                <circle
                  cx={exp.x} cy={exp.y}
                  r={TARGET_RADIUS * 0.5 * (1 + progress * 3)}
                  fill="#fff" opacity={(1 - progress) * 0.6}
                />
                {/* Explosion ring */}
                <circle
                  cx={exp.x} cy={exp.y}
                  r={TARGET_RADIUS * (0.5 + progress * 3)}
                  fill="none" stroke={exp.color}
                  strokeWidth={2 * (1 - progress)}
                  opacity={(1 - progress) * 0.5}
                />
                {/* Explosion sparks */}
                {Array.from({ length: 6 }, (_, j) => {
                  const angle = (j / 6) * Math.PI * 2
                  const dist = TARGET_RADIUS * (0.5 + progress * 3)
                  return (
                    <circle
                      key={`spark-${j}`}
                      cx={exp.x + Math.cos(angle) * dist}
                      cy={exp.y + Math.sin(angle) * dist}
                      r={2 * (1 - progress)}
                      fill="#fff"
                      opacity={(1 - progress) * 0.8}
                    />
                  )
                })}
              </g>
            )
          })}

          {/* Shot Result Text */}
          {shotResult !== null && (
            <g>
              <text
                x={shotResult.x} y={shotResult.y - 30}
                textAnchor="middle"
                fill={shotResult.score >= GOOD_SCORE ? '#fbbf24' : shotResult.score > 0 ? '#fff' : '#ef4444'}
                fontSize="20" fontWeight="bold"
                filter="url(#cs-shadow)"
                opacity={clampNumber(shotResult.remainingMs / (RESULT_DISPLAY_MS * 0.4), 0, 1)}
                transform={`translate(0, ${-20 * (1 - shotResult.remainingMs / RESULT_DISPLAY_MS)})`}
              >
                {shotResult.label}
              </text>
              {shotResult.score > 0 && (
                <text
                  x={shotResult.x} y={shotResult.y - 10}
                  textAnchor="middle"
                  fill="#fbbf24" fontSize="16" fontWeight="bold"
                  filter="url(#cs-shadow)"
                  opacity={clampNumber(shotResult.remainingMs / (RESULT_DISPLAY_MS * 0.4), 0, 1)}
                  transform={`translate(0, ${-20 * (1 - shotResult.remainingMs / RESULT_DISPLAY_MS)})`}
                >
                  +{shotResult.score}
                </text>
              )}
            </g>
          )}
        </svg>
      </div>

      {/* Controls — bottom section */}
      <div className="cannon-shot-controls">
        <div className="cannon-shot-angle-row">
          <span className="cannon-shot-angle-label">{angleDeg}°</span>
          <input
            className="cannon-shot-angle-slider"
            type="range"
            min={MIN_ANGLE_DEG}
            max={MAX_ANGLE_DEG}
            value={angleDeg}
            onChange={handleAngleChange}
            disabled={gamePhase !== 'aiming'}
          />
        </div>

        <div className="cannon-shot-power-row">
          <div className="cannon-shot-power-bar">
            <div
              className="cannon-shot-power-fill"
              style={{ width: `${clampNumber(powerPercent, 0, 100)}%`, background: `linear-gradient(90deg, #22c55e, ${powerBarColor})` }}
            />
          </div>
          <span className="cannon-shot-power-pct">{Math.round(clampNumber(powerPercent, 0, 100))}%</span>
        </div>

        <p className="cannon-shot-hint">
          {gamePhase === 'aiming'
            ? isCharging ? 'RELEASE TO FIRE!' : 'HOLD TO CHARGE'
            : gamePhase === 'flying' ? 'FLYING...'
            : gamePhase === 'result' ? ''
            : 'GAME OVER'}
        </p>
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        Hub
      </button>

      {/* Screen flash overlay */}
      {screenFlash !== null && (
        <div style={{ position: 'absolute', inset: 0, background: screenFlash, pointerEvents: 'none', zIndex: 50 }} />
      )}

      <style>{GAME_EFFECTS_CSS}</style>
      <style>{CANNON_SHOT_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

const CANNON_SHOT_CSS = `
  .cannon-shot-panel {
    background: #0f172a;
    color: #fff;
  }

  .cannon-shot-hud {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px 4px;
    font-size: 0.7rem;
    gap: 6px;
    z-index: 10;
  }
  .cannon-shot-hud-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .cannon-shot-hud-score {
    font-size: 1.4rem;
    font-weight: 800;
    color: #fbbf24;
    text-shadow: 0 1px 4px rgba(0,0,0,0.4);
    line-height: 1;
  }
  .cannon-shot-hud-best {
    font-size: 0.55rem;
    color: #9ca3af;
  }
  .cannon-shot-hud-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .cannon-shot-hud-wind {
    font-size: 0.65rem;
    color: #93c5fd;
    font-weight: 600;
  }
  .cannon-shot-hud-streak {
    color: #fbbf24;
    font-weight: 800;
    font-size: 0.7rem;
    animation: cs-pulse 0.5s infinite alternate;
  }
  .cannon-shot-hud-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .cannon-shot-hud-shots {
    font-size: 1.1rem;
    font-weight: 700;
    color: #fff;
  }
  .cannon-shot-hud-shot-label {
    font-size: 0.5rem;
    color: #6b7280;
  }

  .cannon-shot-powerup-badges {
    display: flex;
    justify-content: center;
    gap: 6px;
    padding: 2px 0;
  }
  .cannon-shot-powerup-badge {
    font-size: 0.6rem;
    font-weight: 800;
    padding: 1px 8px;
    border-radius: 8px;
    color: #000;
    animation: cs-badge-pop 0.3s ease-out;
  }

  .cannon-shot-board {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    touch-action: none;
    user-select: none;
    cursor: pointer;
  }
  .cannon-shot-svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .cannon-shot-controls {
    padding: 6px 12px 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cannon-shot-angle-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cannon-shot-angle-label {
    font-size: 0.9rem;
    font-weight: 700;
    min-width: 36px;
    text-align: center;
    color: #fbbf24;
  }
  .cannon-shot-angle-slider {
    flex: 1;
    accent-color: #b91c1c;
    height: 20px;
  }
  .cannon-shot-power-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cannon-shot-power-bar {
    flex: 1;
    height: 14px;
    background: #1e293b;
    border-radius: 7px;
    overflow: hidden;
    border: 1px solid #334155;
  }
  .cannon-shot-power-fill {
    height: 100%;
    border-radius: 7px;
    transition: width 0.05s linear;
  }
  .cannon-shot-power-pct {
    font-size: 0.8rem;
    font-weight: 700;
    min-width: 36px;
    text-align: right;
    color: #fff;
  }
  .cannon-shot-hint {
    margin: 0;
    font-size: 0.7rem;
    color: #6b7280;
    text-align: center;
    font-weight: 600;
    letter-spacing: 0.5px;
  }

  @keyframes cs-pulse {
    from { opacity: 0.7; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1.05); }
  }
  @keyframes cs-badge-pop {
    from { transform: scale(0); }
    to { transform: scale(1); }
  }
`

export const cannonShotModule: MiniGameModule = {
  manifest: {
    id: 'cannon-shot',
    title: 'Cannon Shot',
    description: 'Aim & fire cannonballs at targets! Collect powerups!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#b91c1c',
  },
  Component: CannonShotGame,
}
