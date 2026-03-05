import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 480

const GAME_TIMEOUT_MS = 120000
const MAX_SHOTS = 10
const GRAVITY = 280
const CANNON_X = 40
const CANNON_Y = VIEWBOX_HEIGHT - 40
const MIN_ANGLE_DEG = 10
const MAX_ANGLE_DEG = 80
const DEFAULT_ANGLE_DEG = 45
const MIN_POWER = 80
const MAX_POWER = 360
const POWER_FILL_SPEED = 320
const TARGET_RADIUS = 16
const TARGET_MIN_X = 180
const TARGET_MAX_X = VIEWBOX_WIDTH - 30
const TARGET_MIN_Y = 80
const TARGET_MAX_Y = VIEWBOX_HEIGHT - 80
const WIND_MIN = -40
const WIND_MAX = 40
const WIND_ESCALATION_PER_SHOT = 5
const MOVING_TARGET_THRESHOLD = 5
const MOVING_TARGET_SPEED = 30
const BONUS_TARGET_CHANCE = 0.2
const BONUS_TARGET_MULTIPLIER = 3
const HIT_STREAK_BONUS = 15
const PERFECT_HIT_RADIUS = 8
const GOOD_HIT_RADIUS = 24
const OK_HIT_RADIUS = 48
const PERFECT_SCORE = 100
const GOOD_SCORE = 60
const OK_SCORE = 30
const NEAR_SCORE = 10
const TRAIL_MAX_LENGTH = 120
const PROJECTILE_RADIUS = 4
const EXPLOSION_DURATION_MS = 400
const RESULT_DISPLAY_MS = 800

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
}

interface ShotResult {
  readonly score: number
  readonly label: string
  readonly x: number
  readonly y: number
  readonly remainingMs: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randomWind(): number {
  return Math.round(randomBetween(WIND_MIN, WIND_MAX))
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

function scoreForDistance(distance: number): { score: number; label: string } {
  if (distance <= PERFECT_HIT_RADIUS) {
    return { score: PERFECT_SCORE, label: 'PERFECT!' }
  }
  if (distance <= GOOD_HIT_RADIUS) {
    return { score: GOOD_SCORE, label: 'GOOD!' }
  }
  if (distance <= OK_HIT_RADIUS) {
    return { score: OK_SCORE, label: 'OK' }
  }
  if (distance <= OK_HIT_RADIUS * 2) {
    return { score: NEAR_SCORE, label: 'NEAR' }
  }
  return { score: 0, label: 'MISS' }
}

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

function CannonShotGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [angleDeg, setAngleDeg] = useState(DEFAULT_ANGLE_DEG)
  const [power, setPower] = useState(0)
  const [isCharging, setIsCharging] = useState(false)
  const [shotsRemaining, setShotsRemaining] = useState(MAX_SHOTS)
  const [score, setScore] = useState(0)
  const [target, setTarget] = useState<Point>(() => randomTarget())
  const [wind, setWind] = useState(() => randomWind())
  const [projectile, setProjectile] = useState<ProjectileState | null>(null)
  const [trail, setTrail] = useState<Point[]>([])
  const [explosion, setExplosion] = useState<ExplosionState | null>(null)
  const [shotResult, setShotResult] = useState<ShotResult | null>(null)
  const [gamePhase, setGamePhase] = useState<'aiming' | 'flying' | 'result' | 'finished'>('aiming')
  const [hitStreak, setHitStreak] = useState(0)
  const [isBonusTarget, setIsBonusTarget] = useState(false)
  const [shotNumber, setShotNumber] = useState(0)
  const [targetMoving, setTargetMoving] = useState(false)

  const angleRef = useRef(DEFAULT_ANGLE_DEG)
  const powerRef = useRef(0)
  const isChargingRef = useRef(false)
  const shotsRemainingRef = useRef(MAX_SHOTS)
  const scoreRef = useRef(0)
  const targetRef = useRef<Point>(target)
  const windRef = useRef(wind)
  const projectileRef = useRef<ProjectileState | null>(null)
  const trailRef = useRef<Point[]>([])
  const explosionRef = useRef<ExplosionState | null>(null)
  const shotResultRef = useRef<ShotResult | null>(null)
  const gamePhaseRef = useRef<'aiming' | 'flying' | 'result' | 'finished'>('aiming')
  const finishedRef = useRef(false)
  const hitStreakRef = useRef(0)
  const isBonusTargetRef = useRef(false)
  const shotNumberRef = useRef(0)
  const targetMovingRef = useRef(false)
  const targetDirectionRef = useRef(1)
  const elapsedMsRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) {
        return
      }
      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true
    gamePhaseRef.current = 'finished'
    setGamePhase('finished')
    playAudio(gameOverAudioRef, 0.6, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.max(Math.round(DEFAULT_FRAME_MS), MAX_SHOTS * 2000),
    })
  }, [onFinish, playAudio])

  const startNextShot = useCallback(() => {
    if (shotsRemainingRef.current <= 0) {
      finishGame()
      return
    }

    const currentShotNum = shotNumberRef.current + 1
    shotNumberRef.current = currentShotNum
    setShotNumber(currentShotNum)

    const nextTarget = randomTarget()
    // Escalate wind range per shot
    const windRange = Math.min(80, WIND_MAX + currentShotNum * WIND_ESCALATION_PER_SHOT)
    const nextWind = Math.round(randomBetween(-windRange, windRange))
    targetRef.current = nextTarget
    windRef.current = nextWind
    setTarget(nextTarget)
    setWind(nextWind)

    // Moving target after threshold
    const isMoving = currentShotNum >= MOVING_TARGET_THRESHOLD
    targetMovingRef.current = isMoving
    setTargetMoving(isMoving)
    targetDirectionRef.current = Math.random() < 0.5 ? 1 : -1

    // Bonus target chance
    const isBonus = Math.random() < BONUS_TARGET_CHANCE
    isBonusTargetRef.current = isBonus
    setIsBonusTarget(isBonus)

    setTrail([])
    trailRef.current = []
    setProjectile(null)
    projectileRef.current = null
    setExplosion(null)
    explosionRef.current = null
    setShotResult(null)
    shotResultRef.current = null
    gamePhaseRef.current = 'aiming'
    setGamePhase('aiming')
    powerRef.current = 0
    setPower(0)
  }, [finishGame])

  const fireProjectile = useCallback(() => {
    if (gamePhaseRef.current !== 'aiming') {
      return
    }
    const currentPower = powerRef.current
    if (currentPower < MIN_POWER * 0.3) {
      return
    }
    const angleRad = degToRad(angleRef.current)
    const vx = Math.cos(angleRad) * currentPower
    const vy = -Math.sin(angleRad) * currentPower
    const newProjectile: ProjectileState = {
      x: CANNON_X,
      y: CANNON_Y,
      vx,
      vy,
      active: true,
    }
    projectileRef.current = newProjectile
    setProjectile(newProjectile)
    trailRef.current = [{ x: CANNON_X, y: CANNON_Y }]
    setTrail([{ x: CANNON_X, y: CANNON_Y }])
    gamePhaseRef.current = 'flying'
    setGamePhase('flying')
    shotsRemainingRef.current -= 1
    setShotsRemaining(shotsRemainingRef.current)
    playAudio(tapHitStrongAudioRef, 0.6, 0.8 + (currentPower / MAX_POWER) * 0.4)
  }, [playAudio])

  const handlePointerDown = useCallback(() => {
    if (gamePhaseRef.current !== 'aiming') {
      return
    }
    isChargingRef.current = true
    setIsCharging(true)
    powerRef.current = MIN_POWER
    setPower(MIN_POWER)
  }, [])

  const handlePointerUp = useCallback(() => {
    if (!isChargingRef.current) {
      return
    }
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
    onExit()
  }, [onExit])

  useEffect(() => {
    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      for (const audio of [tapHitAudio, tapHitStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
      effects.cleanup()
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
    lastFrameAtRef.current = null

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

      elapsedMsRef.current += deltaMs
      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      // Move target if moving target is active
      if (targetMovingRef.current && (gamePhaseRef.current === 'aiming' || gamePhaseRef.current === 'flying')) {
        const t = targetRef.current
        let nextTY = t.y + targetDirectionRef.current * MOVING_TARGET_SPEED * deltaSec
        if (nextTY < TARGET_MIN_Y || nextTY > TARGET_MAX_Y) {
          targetDirectionRef.current *= -1
          nextTY = clampNumber(nextTY, TARGET_MIN_Y, TARGET_MAX_Y)
        }
        targetRef.current = { x: t.x, y: nextTY }
        setTarget({ x: t.x, y: nextTY })
      }

      if (isChargingRef.current && gamePhaseRef.current === 'aiming') {
        const nextPower = clampNumber(powerRef.current + POWER_FILL_SPEED * deltaSec, MIN_POWER, MAX_POWER)
        powerRef.current = nextPower
        setPower(nextPower)
      }

      if (gamePhaseRef.current === 'flying' && projectileRef.current !== null) {
        const proj = projectileRef.current
        const nextVx = proj.vx + windRef.current * deltaSec
        const nextVy = proj.vy + GRAVITY * deltaSec
        const nextX = proj.x + nextVx * deltaSec
        const nextY = proj.y + nextVy * deltaSec

        const nextTrail = [...trailRef.current, { x: nextX, y: nextY }]
        if (nextTrail.length > TRAIL_MAX_LENGTH) {
          nextTrail.splice(0, nextTrail.length - TRAIL_MAX_LENGTH)
        }
        trailRef.current = nextTrail
        setTrail(nextTrail)

        const isOutOfBounds =
          nextX < -20 || nextX > VIEWBOX_WIDTH + 20 || nextY > VIEWBOX_HEIGHT + 20 || nextY < -100

        const distToTarget = distanceBetween(
          { x: nextX, y: nextY },
          targetRef.current,
        )
        const isHit = distToTarget <= TARGET_RADIUS + PROJECTILE_RADIUS

        if (isHit || isOutOfBounds) {
          const hitResult = scoreForDistance(distToTarget)
          let earnedScore = hitResult.score

          // Bonus target multiplier
          if (earnedScore > 0 && isBonusTargetRef.current) {
            earnedScore *= BONUS_TARGET_MULTIPLIER
          }

          // Hit streak bonus
          if (earnedScore > 0) {
            hitStreakRef.current += 1
            setHitStreak(hitStreakRef.current)
            if (hitStreakRef.current >= 3) {
              earnedScore += HIT_STREAK_BONUS * Math.min(hitStreakRef.current - 2, 5)
            }
          } else {
            hitStreakRef.current = 0
            setHitStreak(0)
          }

          scoreRef.current += earnedScore
          setScore(scoreRef.current)

          projectileRef.current = null
          setProjectile(null)

          explosionRef.current = {
            x: isHit ? targetRef.current.x : nextX,
            y: isHit ? targetRef.current.y : nextY,
            remainingMs: EXPLOSION_DURATION_MS,
          }
          setExplosion(explosionRef.current)

          shotResultRef.current = {
            score: earnedScore,
            label: hitResult.label,
            x: isHit ? targetRef.current.x : nextX,
            y: isHit ? targetRef.current.y : Math.min(nextY, VIEWBOX_HEIGHT - 20),
            remainingMs: RESULT_DISPLAY_MS,
          }
          setShotResult(shotResultRef.current)

          gamePhaseRef.current = 'result'
          setGamePhase('result')

          if (earnedScore > 0) {
            const hitX = isHit ? targetRef.current.x : nextX
            const hitY = isHit ? targetRef.current.y : Math.min(nextY, VIEWBOX_HEIGHT - 20)
            effects.comboHitBurst(hitX, hitY, hitStreakRef.current, earnedScore)
            playAudio(tapHitAudioRef, 0.5, 1 + earnedScore * 0.003)
          } else {
            effects.triggerFlash('rgba(239,68,68,0.4)')
            effects.triggerShake(3)
          }
        } else {
          const nextProjectile: ProjectileState = {
            x: nextX,
            y: nextY,
            vx: nextVx,
            vy: nextVy,
            active: true,
          }
          projectileRef.current = nextProjectile
          setProjectile(nextProjectile)
        }
      }

      if (gamePhaseRef.current === 'result') {
        if (explosionRef.current !== null) {
          const nextExpRemaining = explosionRef.current.remainingMs - deltaMs
          if (nextExpRemaining <= 0) {
            explosionRef.current = null
            setExplosion(null)
          } else {
            explosionRef.current = { ...explosionRef.current, remainingMs: nextExpRemaining }
            setExplosion(explosionRef.current)
          }
        }

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
  }, [finishGame, playAudio, startNextShot])

  const cannonAngleRad = degToRad(angleDeg)
  const cannonBarrelLength = 28
  const cannonTipX = CANNON_X + Math.cos(cannonAngleRad) * cannonBarrelLength
  const cannonTipY = CANNON_Y - Math.sin(cannonAngleRad) * cannonBarrelLength
  const powerPercent = ((power - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const windArrowX = VIEWBOX_WIDTH / 2
  const windArrowY = 24
  const windStrength = Math.abs(wind)
  const windDirection = wind >= 0 ? 'right' : 'left'
  const windArrowLength = clampNumber((windStrength / WIND_MAX) * 40, 4, 40)

  const trailPath = useMemo(() => {
    if (trail.length < 2) {
      return ''
    }
    return trail.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  }, [trail])

  return (
    <section className="mini-game-panel cannon-shot-panel" aria-label="cannon-shot-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <div className="cannon-shot-score-strip">
        <p className="cannon-shot-score">{score.toLocaleString()}</p>
        <p className="cannon-shot-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className="cannon-shot-shots">
          {shotsRemaining} / {MAX_SHOTS}
        </p>
      </div>

      <div className="cannon-shot-wind-row">
        <span className="cannon-shot-wind-label">
          WIND: {windDirection === 'left' ? '<' : ''} {windStrength.toFixed(0)} {windDirection === 'right' ? '>' : ''}
        </span>
        {hitStreak >= 3 && (
          <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 12 }}>
            STREAK x{hitStreak}!
          </span>
        )}
        {isBonusTarget && (
          <span style={{ color: '#a78bfa', fontWeight: 800, fontSize: 12, animation: 'cannon-bonus-pulse 0.5s infinite alternate' }}>
            BONUS x{BONUS_TARGET_MULTIPLIER}
          </span>
        )}
        {targetMoving && (
          <span style={{ color: '#f97316', fontWeight: 600, fontSize: 11 }}>
            MOVING
          </span>
        )}
      </div>
      <style>{`
        @keyframes cannon-bonus-pulse {
          from { opacity: 0.6; }
          to { opacity: 1; }
        }
      `}</style>

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
          preserveAspectRatio="xMidYMid meet"
          aria-label="cannon-shot-field"
        >
          <defs>
            <radialGradient id="cannon-shot-target-gradient">
              <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
              <stop offset="40%" stopColor="#ef4444" stopOpacity="0.8" />
              <stop offset="70%" stopColor="#b91c1c" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0.5" />
            </radialGradient>
            <linearGradient id="cannon-shot-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1e3a5f" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
            <linearGradient id="cannon-shot-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#65a30d" />
              <stop offset="100%" stopColor="#4d7c0f" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT - 36} fill="url(#cannon-shot-sky)" />
          <rect x="0" y={VIEWBOX_HEIGHT - 36} width={VIEWBOX_WIDTH} height="36" fill="url(#cannon-shot-ground)" />

          {wind !== 0 && (
            <g transform={`translate(${windArrowX}, ${windArrowY})`}>
              <line
                x1={wind < 0 ? windArrowLength / 2 : -windArrowLength / 2}
                y1="0"
                x2={wind < 0 ? -windArrowLength / 2 : windArrowLength / 2}
                y2="0"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <polygon
                points={
                  wind > 0
                    ? `${windArrowLength / 2},0 ${windArrowLength / 2 - 5},-3 ${windArrowLength / 2 - 5},3`
                    : `${-windArrowLength / 2},0 ${-windArrowLength / 2 + 5},-3 ${-windArrowLength / 2 + 5},3`
                }
                fill="#fff"
              />
            </g>
          )}

          <circle
            cx={target.x}
            cy={target.y}
            r={isBonusTarget ? TARGET_RADIUS * 1.3 : TARGET_RADIUS}
            fill={isBonusTarget ? '#a78bfa' : 'url(#cannon-shot-target-gradient)'}
            stroke={isBonusTarget ? '#7c3aed' : '#dc2626'}
            strokeWidth={isBonusTarget ? 2.5 : 1.5}
            opacity={isBonusTarget ? 0.9 : 1}
          />
          <circle cx={target.x} cy={target.y} r={PERFECT_HIT_RADIUS} fill="none" stroke="#fff" strokeWidth="0.8" strokeDasharray="2 2" />
          <line x1={target.x - 4} y1={target.y} x2={target.x + 4} y2={target.y} stroke="#fff" strokeWidth="0.8" />
          <line x1={target.x} y1={target.y - 4} x2={target.x} y2={target.y + 4} stroke="#fff" strokeWidth="0.8" />

          {gamePhase === 'aiming' && (
            <g>
              <line
                x1={CANNON_X}
                y1={CANNON_Y}
                x2={CANNON_X + Math.cos(cannonAngleRad) * 60}
                y2={CANNON_Y - Math.sin(cannonAngleRad) * 60}
                stroke="#fff"
                strokeWidth="0.6"
                strokeDasharray="3 3"
                opacity="0.4"
              />
            </g>
          )}

          <g>
            <circle cx={CANNON_X} cy={CANNON_Y} r="10" fill="#374151" stroke="#1f2937" strokeWidth="1.5" />
            <line
              x1={CANNON_X}
              y1={CANNON_Y}
              x2={cannonTipX}
              y2={cannonTipY}
              stroke="#4b5563"
              strokeWidth="6"
              strokeLinecap="round"
            />
            <line
              x1={CANNON_X}
              y1={CANNON_Y}
              x2={cannonTipX}
              y2={cannonTipY}
              stroke="#6b7280"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx={CANNON_X} cy={CANNON_Y + 6} r="8" fill="#52525b" />
            <circle cx={CANNON_X} cy={CANNON_Y + 6} r="6" fill="#71717a" />
          </g>

          {trailPath && (
            <path
              d={trailPath}
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.5"
              strokeLinecap="round"
              opacity="0.6"
            />
          )}

          {projectile !== null && (
            <g>
              <circle cx={projectile.x} cy={projectile.y} r={PROJECTILE_RADIUS + 2} fill="#fbbf24" opacity="0.4" />
              <circle cx={projectile.x} cy={projectile.y} r={PROJECTILE_RADIUS} fill="#1f2937" />
              <circle cx={projectile.x - 1} cy={projectile.y - 1} r="1.5" fill="#6b7280" opacity="0.6" />
            </g>
          )}

          {explosion !== null && (
            <g>
              <circle
                cx={explosion.x}
                cy={explosion.y}
                r={TARGET_RADIUS * (1 + (1 - explosion.remainingMs / EXPLOSION_DURATION_MS) * 1.5)}
                fill="#f59e0b"
                opacity={explosion.remainingMs / EXPLOSION_DURATION_MS}
              />
              <circle
                cx={explosion.x}
                cy={explosion.y}
                r={TARGET_RADIUS * 0.6 * (1 + (1 - explosion.remainingMs / EXPLOSION_DURATION_MS) * 2)}
                fill="#fff"
                opacity={(explosion.remainingMs / EXPLOSION_DURATION_MS) * 0.8}
              />
            </g>
          )}

          {shotResult !== null && (
            <text
              x={shotResult.x}
              y={shotResult.y - 24}
              textAnchor="middle"
              fill={shotResult.score >= GOOD_SCORE ? '#fbbf24' : shotResult.score > 0 ? '#fff' : '#ef4444'}
              fontSize="16"
              fontWeight="bold"
              opacity={clampNumber(shotResult.remainingMs / (RESULT_DISPLAY_MS * 0.5), 0, 1)}
            >
              {shotResult.label} {shotResult.score > 0 ? `+${shotResult.score}` : ''}
            </text>
          )}
        </svg>
      </div>

      <div className="cannon-shot-controls">
        <div className="cannon-shot-angle-control">
          <label className="cannon-shot-angle-label" htmlFor="cannon-shot-angle">
            ANGLE: {angleDeg}deg
          </label>
          <input
            id="cannon-shot-angle"
            className="cannon-shot-angle-slider"
            type="range"
            min={MIN_ANGLE_DEG}
            max={MAX_ANGLE_DEG}
            value={angleDeg}
            onChange={handleAngleChange}
            disabled={gamePhase !== 'aiming'}
          />
        </div>

        <div className="cannon-shot-power-control">
          <p className="cannon-shot-power-label">
            POWER: {Math.round(clampNumber(powerPercent, 0, 100))}%
          </p>
          <div className="cannon-shot-power-bar">
            <div
              className="cannon-shot-power-fill"
              style={{ width: `${clampNumber(powerPercent, 0, 100)}%` }}
            />
          </div>
          <p className="cannon-shot-power-hint">
            {gamePhase === 'aiming'
              ? isCharging
                ? 'Release to fire!'
                : 'Hold to charge power'
              : gamePhase === 'flying'
                ? 'Flying...'
                : gamePhase === 'result'
                  ? ''
                  : 'Game Over'}
          </p>
        </div>
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        Hub
      </button>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const cannonShotModule: MiniGameModule = {
  manifest: {
    id: 'cannon-shot',
    title: 'Cannon Shot',
    description: '각도와 파워를 조절해 타겟을 맞춰라! 10발의 기회!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#b91c1c',
  },
  Component: CannonShotGame,
}
