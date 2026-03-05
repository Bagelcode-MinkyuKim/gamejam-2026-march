import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/song-changsik.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const ARENA_WIDTH = 360
const ARENA_HEIGHT = 560
const CHARACTER_RADIUS = 22
const CHARACTER_SIZE = 64
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
const POWERUP_SPAWN_INTERVAL_MS = 8000
const POWERUP_RADIUS = 16
const POWERUP_COLLECT_DISTANCE = 40
const SURVIVAL_MILESTONE_INTERVAL_S = 10
const SURVIVAL_MILESTONE_BONUS = 100

const INITIAL_SPAWN_INTERVAL_MS = 1200
const MIN_SPAWN_INTERVAL_MS = 340
const SPAWN_INTERVAL_DECAY_PER_SECOND = 28
const INITIAL_BALL_SPEED = 120
const MAX_BALL_SPEED = 340
const BALL_SPEED_INCREASE_PER_SECOND = 7.2

const BALL_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'] as const

type PowerUpKind = 'shield' | 'slowmo'

interface PowerUp {
  readonly id: number
  readonly kind: PowerUpKind
  readonly x: number
  readonly y: number
  collected: boolean
}

function spawnPowerUp(id: number): PowerUp {
  const kind: PowerUpKind = Math.random() < 0.5 ? 'shield' : 'slowmo'
  const x = 40 + Math.random() * (ARENA_WIDTH - 80)
  const y = 40 + Math.random() * (ARENA_HEIGHT - 80)
  return { id, kind, x, y, collected: false }
}

interface Ball {
  readonly id: number
  x: number
  y: number
  vx: number
  vy: number
  readonly color: string
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function spawnBall(id: number, speed: number): Ball {
  const side = Math.floor(Math.random() * 4)
  let x: number
  let y: number
  let targetX: number
  let targetY: number

  const margin = BALL_RADIUS + 4
  const innerPadding = 40

  switch (side) {
    case 0:
      x = randomBetween(margin, ARENA_WIDTH - margin)
      y = -margin
      targetX = randomBetween(innerPadding, ARENA_WIDTH - innerPadding)
      targetY = randomBetween(innerPadding, ARENA_HEIGHT - innerPadding)
      break
    case 1:
      x = randomBetween(margin, ARENA_WIDTH - margin)
      y = ARENA_HEIGHT + margin
      targetX = randomBetween(innerPadding, ARENA_WIDTH - innerPadding)
      targetY = randomBetween(innerPadding, ARENA_HEIGHT - innerPadding)
      break
    case 2:
      x = -margin
      y = randomBetween(margin, ARENA_HEIGHT - margin)
      targetX = randomBetween(innerPadding, ARENA_WIDTH - innerPadding)
      targetY = randomBetween(innerPadding, ARENA_HEIGHT - innerPadding)
      break
    default:
      x = ARENA_WIDTH + margin
      y = randomBetween(margin, ARENA_HEIGHT - margin)
      targetX = randomBetween(innerPadding, ARENA_WIDTH - innerPadding)
      targetY = randomBetween(innerPadding, ARENA_HEIGHT - innerPadding)
      break
  }

  const dx = targetX - x
  const dy = targetY - y
  const distance = Math.hypot(dx, dy)
  const vx = (dx / distance) * speed
  const vy = (dy / distance) * speed

  const color = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]

  return { id, x, y, vx, vy, color }
}

function isBallOutOfBounds(ball: Ball): boolean {
  const margin = BALL_RADIUS + 60
  return ball.x < -margin || ball.x > ARENA_WIDTH + margin || ball.y < -margin || ball.y > ARENA_HEIGHT + margin
}

function circlesCollide(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx
  const dy = ay - by
  const combinedRadius = ar + br
  return dx * dx + dy * dy <= combinedRadius * combinedRadius
}

function clampPosition(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function DodgeBallGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [playerX, setPlayerX] = useState(ARENA_WIDTH / 2)
  const [playerY, setPlayerY] = useState(ARENA_HEIGHT / 2)
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
  const [lastMilestone, setLastMilestone] = useState(0)

  const effects = useGameEffects()

  const playerXRef = useRef(ARENA_WIDTH / 2)
  const playerYRef = useRef(ARENA_HEIGHT / 2)
  const hpRef = useRef(MAX_HP)
  const scoreRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const ballsRef = useRef<Ball[]>([])
  const nextBallIdRef = useRef(0)
  const spawnTimerRef = useRef(0)
  const invincibleTimerRef = useRef(0)
  const finishedRef = useRef(false)
  const clearedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const pointerActiveRef = useRef(false)
  const pointerTargetRef = useRef<{ x: number; y: number } | null>(null)
  const lastScorePopupMsRef = useRef(0)
  const powerUpsRef = useRef<PowerUp[]>([])
  const nextPowerUpIdRef = useRef(0)
  const lastPowerUpSpawnMsRef = useRef(0)
  const shieldTimerMsRef = useRef(0)
  const slowmoTimerMsRef = useRef(0)
  const lastMilestoneRef = useRef(0)

  const hitAudioRef = useRef<HTMLAudioElement | null>(null)
  const hitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const arenaRef = useRef<HTMLDivElement | null>(null)

  const playSfx = useCallback((audio: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (audio === null) {
      return
    }

    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const finalDurationMs = elapsedMsRef.current > 0 ? Math.round(elapsedMsRef.current) : Math.round(DEFAULT_FRAME_MS)
    onFinish({
      score: scoreRef.current,
      durationMs: finalDurationMs,
    })
  }, [onFinish])

  const clientToArena = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const arena = arenaRef.current
    if (arena === null) {
      return { x: ARENA_WIDTH / 2, y: ARENA_HEIGHT / 2 }
    }

    const rect = arena.getBoundingClientRect()
    const scaleX = ARENA_WIDTH / rect.width
    const scaleY = ARENA_HEIGHT / rect.height
    return {
      x: clampPosition((clientX - rect.left) * scaleX, CHARACTER_RADIUS, ARENA_WIDTH - CHARACTER_RADIUS),
      y: clampPosition((clientY - rect.top) * scaleY, CHARACTER_RADIUS, ARENA_HEIGHT - CHARACTER_RADIUS),
    }
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      pointerActiveRef.current = true
      const target = clientToArena(event.clientX, event.clientY)
      pointerTargetRef.current = target
      playerXRef.current = target.x
      playerYRef.current = target.y
      setPlayerX(target.x)
      setPlayerY(target.y)
    },
    [clientToArena],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerActiveRef.current && event.pointerType === 'mouse' && event.buttons === 0) {
        return
      }

      const target = clientToArena(event.clientX, event.clientY)
      pointerTargetRef.current = target
      playerXRef.current = target.x
      playerYRef.current = target.y
      setPlayerX(target.x)
      setPlayerY(target.y)
    },
    [clientToArena],
  )

  const handlePointerUp = useCallback(() => {
    pointerActiveRef.current = false
  }, [])

  useEffect(() => {
    const hitAudio = new Audio(tapHitSfx)
    hitAudio.preload = 'auto'
    hitAudioRef.current = hitAudio

    const hitStrongAudio = new Audio(tapHitStrongSfx)
    hitStrongAudio.preload = 'auto'
    hitStrongAudioRef.current = hitStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    const charImage = new Image()
    charImage.src = characterSprite
    void charImage.decode?.().catch(() => {})

    return () => {
      for (const audio of [hitAudio, hitStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }

      if (finishedRef.current) {
        return
      }

      const step = 20
      let nextX = playerXRef.current
      let nextY = playerYRef.current

      switch (event.code) {
        case 'ArrowLeft':
        case 'KeyA':
          nextX -= step
          break
        case 'ArrowRight':
        case 'KeyD':
          nextX += step
          break
        case 'ArrowUp':
        case 'KeyW':
          nextY -= step
          break
        case 'ArrowDown':
        case 'KeyS':
          nextY += step
          break
        default:
          return
      }

      event.preventDefault()
      nextX = clampPosition(nextX, CHARACTER_RADIUS, ARENA_WIDTH - CHARACTER_RADIUS)
      nextY = clampPosition(nextY, CHARACTER_RADIUS, ARENA_HEIGHT - CHARACTER_RADIUS)
      playerXRef.current = nextX
      playerYRef.current = nextY
      setPlayerX(nextX)
      setPlayerY(nextY)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onExit])

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
      setElapsedMs(elapsedMsRef.current)

      const currentScore = Math.floor((elapsedMsRef.current / 1000) * SCORE_PER_SECOND)
      if (!clearedRef.current && elapsedMsRef.current >= CLEAR_TIME_MS) {
        clearedRef.current = true
        setIsCleared(true)
        scoreRef.current = currentScore + CLEAR_BONUS
        setScore(scoreRef.current)
        playSfx(hitStrongAudioRef.current, 0.7, 1.2)

        // Visual effects for clear
        effects.comboHitBurst(180, 280, 10, CLEAR_BONUS)
      } else if (!clearedRef.current) {
        scoreRef.current = currentScore
        setScore(currentScore)
      } else {
        const bonusScore = Math.floor((elapsedMsRef.current / 1000) * SCORE_PER_SECOND) + CLEAR_BONUS
        scoreRef.current = bonusScore
        setScore(bonusScore)
      }

      // Periodic survival score popups every 5 seconds
      if (elapsedMsRef.current - lastScorePopupMsRef.current > 5000 && !finishedRef.current) {
        lastScorePopupMsRef.current = elapsedMsRef.current
        const survivalPoints = Math.floor(5 * SCORE_PER_SECOND)
        effects.showScorePopup(survivalPoints, playerXRef.current, playerYRef.current - 40)
        effects.spawnParticles(3, playerXRef.current, playerYRef.current)
      }

      if (invincibleTimerRef.current > 0) {
        invincibleTimerRef.current = Math.max(0, invincibleTimerRef.current - deltaMs)
        setIsInvincible(invincibleTimerRef.current > 0)
      }

      // Shield timer
      if (shieldTimerMsRef.current > 0) {
        shieldTimerMsRef.current = Math.max(0, shieldTimerMsRef.current - deltaMs)
        setShieldTimerMs(shieldTimerMsRef.current)
      }

      // Slow-mo timer
      if (slowmoTimerMsRef.current > 0) {
        slowmoTimerMsRef.current = Math.max(0, slowmoTimerMsRef.current - deltaMs)
        setSlowmoTimerMs(slowmoTimerMsRef.current)
      }

      // Survival milestones
      const currentMilestone = Math.floor(elapsedMsRef.current / 1000 / SURVIVAL_MILESTONE_INTERVAL_S)
      if (currentMilestone > lastMilestoneRef.current) {
        lastMilestoneRef.current = currentMilestone
        setLastMilestone(currentMilestone)
        scoreRef.current += SURVIVAL_MILESTONE_BONUS
        setScore(scoreRef.current)
        effects.comboHitBurst(playerXRef.current, playerYRef.current - 40, currentMilestone, SURVIVAL_MILESTONE_BONUS)
        playSfx(hitStrongAudioRef.current, 0.5, 1.1)
      }

      // Spawn power-ups periodically
      if (elapsedMsRef.current - lastPowerUpSpawnMsRef.current >= POWERUP_SPAWN_INTERVAL_MS) {
        lastPowerUpSpawnMsRef.current = elapsedMsRef.current
        const newPowerUp = spawnPowerUp(nextPowerUpIdRef.current++)
        powerUpsRef.current = [...powerUpsRef.current, newPowerUp]
        setPowerUps([...powerUpsRef.current])
      }

      // Check power-up collection
      for (const pu of powerUpsRef.current) {
        if (pu.collected) continue
        const dx = playerXRef.current - pu.x
        const dy = playerYRef.current - pu.y
        if (dx * dx + dy * dy <= POWERUP_COLLECT_DISTANCE * POWERUP_COLLECT_DISTANCE) {
          pu.collected = true
          if (pu.kind === 'shield') {
            shieldTimerMsRef.current = SHIELD_DURATION_MS
            setShieldTimerMs(SHIELD_DURATION_MS)
            effects.triggerFlash('rgba(59,130,246,0.3)')
          } else {
            slowmoTimerMsRef.current = SLOWMO_DURATION_MS
            setSlowmoTimerMs(SLOWMO_DURATION_MS)
            effects.triggerFlash('rgba(168,85,247,0.3)')
          }
          playSfx(hitStrongAudioRef.current, 0.5, 1.3)
          setPowerUps([...powerUpsRef.current])
        }
      }
      // Clean up old power-ups
      powerUpsRef.current = powerUpsRef.current.filter(pu => !pu.collected)

      const slowmoMult = slowmoTimerMsRef.current > 0 ? SLOWMO_FACTOR : 1

      const elapsedSec = elapsedMsRef.current / 1000
      const currentBallSpeed = Math.min(MAX_BALL_SPEED, INITIAL_BALL_SPEED + elapsedSec * BALL_SPEED_INCREASE_PER_SECOND) * slowmoMult
      const currentSpawnInterval = Math.max(
        MIN_SPAWN_INTERVAL_MS,
        INITIAL_SPAWN_INTERVAL_MS - elapsedSec * SPAWN_INTERVAL_DECAY_PER_SECOND,
      )

      spawnTimerRef.current += deltaMs
      while (spawnTimerRef.current >= currentSpawnInterval) {
        spawnTimerRef.current -= currentSpawnInterval
        const newBall = spawnBall(nextBallIdRef.current, currentBallSpeed)
        nextBallIdRef.current += 1
        ballsRef.current = [...ballsRef.current, newBall]
      }

      const updatedBalls: Ball[] = []
      let hitDetected = false

      for (const ball of ballsRef.current) {
        const nextX = ball.x + ball.vx * deltaSec
        const nextY = ball.y + ball.vy * deltaSec

        if (isBallOutOfBounds({ ...ball, x: nextX, y: nextY })) {
          continue
        }

        if (
          invincibleTimerRef.current <= 0 &&
          circlesCollide(playerXRef.current, playerYRef.current, CHARACTER_RADIUS, nextX, nextY, BALL_RADIUS)
        ) {
          // Shield absorbs hit
          if (shieldTimerMsRef.current > 0) {
            shieldTimerMsRef.current = 0
            setShieldTimerMs(0)
            effects.triggerFlash('rgba(59,130,246,0.5)')
            effects.spawnParticles(8, playerXRef.current, playerYRef.current)
            continue
          }
          hitDetected = true
          continue
        }

        updatedBalls.push({ ...ball, x: nextX, y: nextY })
      }

      ballsRef.current = updatedBalls
      setBalls(updatedBalls)

      if (hitDetected) {
        const nextHp = hpRef.current - 1
        hpRef.current = nextHp
        setHp(nextHp)

        invincibleTimerRef.current = INVINCIBILITY_MS
        setIsInvincible(true)

        setHitFlash(true)
        window.setTimeout(() => setHitFlash(false), HIT_FLASH_MS)

        // Visual effects for hit
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.5)')
        effects.spawnParticles(6, playerXRef.current, playerYRef.current)

        if (nextHp <= 0) {
          playSfx(gameOverAudioRef.current, 0.65, 0.95)
          finishGame()
          animationFrameRef.current = null
          return
        }

        playSfx(hitAudioRef.current, 0.55, 0.9)
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
  }, [finishGame, playSfx])

  const displayedBestScore = Math.max(bestScore, score)
  const hearts = Array.from({ length: MAX_HP }, (_, i) => i < hp)
  const elapsedSec = elapsedMs / 1000
  const invincibleBlink = isInvincible && Math.floor(elapsedMs / 80) % 2 === 0

  return (
    <section className="mini-game-panel dodge-ball-panel" aria-label="dodge-ball-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .dodge-ball-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, #1a0000 0%, #2d0a0a 30%, #1e1028 70%, #0f0f1a 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .dodge-ball-hud {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          max-width: 400px;
          padding: 8px 12px;
          background: linear-gradient(180deg, rgba(220,38,38,0.25) 0%, rgba(220,38,38,0.08) 100%);
          border-bottom: 1px solid rgba(220,38,38,0.3);
        }

        .dodge-ball-hud-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #dc2626;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(220,38,38,0.4);
        }

        .dodge-ball-hud-left,
        .dodge-ball-hud-center,
        .dodge-ball-hud-right {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .dodge-ball-score {
          font-size: 28px;
          font-weight: 800;
          color: #dc2626;
          margin: 0;
          line-height: 1.1;
        }

        .dodge-ball-best {
          font-size: 11px;
          color: #9ca3af;
          margin: 0;
        }

        .dodge-ball-time {
          font-size: 18px;
          font-weight: 700;
          color: #e5e7eb;
          margin: 0;
        }

        .dodge-ball-clear-badge {
          font-size: 13px;
          font-weight: 800;
          color: #fbbf24;
          margin: 0;
          animation: dodge-ball-pulse 0.6s ease-in-out infinite alternate;
        }

        @keyframes dodge-ball-pulse {
          from { transform: scale(1); opacity: 0.85; }
          to { transform: scale(1.15); opacity: 1; }
        }

        .dodge-ball-hearts {
          font-size: 22px;
          margin: 0;
          display: flex;
          gap: 3px;
        }

        .dodge-ball-heart.alive {
          color: #ef4444;
        }

        .dodge-ball-heart.lost {
          color: #4b5563;
        }

        .dodge-ball-arena {
          position: relative;
          width: 100%;
          max-width: 400px;
          aspect-ratio: ${ARENA_WIDTH} / ${ARENA_HEIGHT};
          background: radial-gradient(ellipse at center, #1e293b 0%, #0f172a 70%, #020617 100%);
          border-radius: 12px;
          overflow: hidden;
          border: 2px solid #334155;
          cursor: none;
          transition: border-color 0.12s;
        }

        .dodge-ball-arena.hit-flash {
          border-color: #ef4444;
          background: radial-gradient(ellipse at center, #2d1215 0%, #0f172a 70%, #020617 100%);
        }

        .dodge-ball-arena.cleared {
          border-color: #fbbf24;
        }

        .dodge-ball-svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        .dodge-ball-ball {
          filter: drop-shadow(0 0 4px currentColor);
        }

        .dodge-ball-character {
          filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
          transition: opacity 0.05s;
        }

        .dodge-ball-character.blink {
          opacity: 0.4;
        }

        .dodge-ball-shield {
          animation: dodge-ball-shield-spin 1s linear infinite;
          transform-origin: center;
        }

        @keyframes dodge-ball-shield-spin {
          from { stroke-dashoffset: 0; }
          to { stroke-dashoffset: 20; }
        }

        .dodge-ball-footer {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 100%;
          max-width: 400px;
        }

        .dodge-ball-hint {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
          text-align: center;
        }

        .dodge-ball-actions {
          display: flex;
          gap: 8px;
        }

        .dodge-ball-action-button {
          padding: 8px 22px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(180deg, #ef4444 0%, #b91c1c 100%);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 3px 0 #7f1d1d, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
        }

        .dodge-ball-action-button:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #7f1d1d, 0 2px 4px rgba(0,0,0,0.3);
        }

        .dodge-ball-action-button.ghost {
          background: transparent;
          color: #9ca3af;
          border: 1px solid #4b5563;
          box-shadow: none;
        }

        .dodge-ball-action-button.ghost:active {
          background: rgba(75,85,99,0.2);
          transform: translateY(1px);
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="dodge-ball-hud">
        <img src={characterSprite} alt="character" className="dodge-ball-hud-avatar" />
        <div className="dodge-ball-hud-left">
          <p className="dodge-ball-score">{score}</p>
          <p className="dodge-ball-best">BEST {displayedBestScore}</p>
        </div>
        <div className="dodge-ball-hud-center">
          <p className="dodge-ball-time">{elapsedSec.toFixed(1)}s</p>
          {isCleared && <p className="dodge-ball-clear-badge">CLEAR!</p>}
          {lastMilestone > 0 && <p style={{ color: '#fbbf24', fontSize: 10, fontWeight: 700, margin: 0 }}>x{lastMilestone} MILESTONE</p>}
          {shieldTimerMs > 0 && <p style={{ color: '#3b82f6', fontSize: 10, fontWeight: 800, margin: 0 }}>SHIELD {(shieldTimerMs / 1000).toFixed(1)}s</p>}
          {slowmoTimerMs > 0 && <p style={{ color: '#a855f7', fontSize: 10, fontWeight: 800, margin: 0 }}>SLOW-MO {(slowmoTimerMs / 1000).toFixed(1)}s</p>}
        </div>
        <div className="dodge-ball-hud-right">
          <p className="dodge-ball-hearts">
            {hearts.map((alive, i) => (
              <span key={`heart-${i}`} className={`dodge-ball-heart ${alive ? 'alive' : 'lost'}`}>
                {alive ? '\u2764' : '\u2661'}
              </span>
            ))}
          </p>
        </div>
      </div>

      <div
        className={`dodge-ball-arena ${isHitFlash ? 'hit-flash' : ''} ${isCleared ? 'cleared' : ''}`}
        ref={arenaRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        role="presentation"
        style={{ touchAction: 'none' }}
      >
        <svg
          className="dodge-ball-svg"
          viewBox={`0 0 ${ARENA_WIDTH} ${ARENA_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <rect x="0" y="0" width={ARENA_WIDTH} height={ARENA_HEIGHT} fill="transparent" />

          {/* Power-ups */}
          {powerUps.filter(pu => !pu.collected).map((pu) => (
            <g key={`pu-${pu.id}`}>
              <circle
                cx={pu.x}
                cy={pu.y}
                r={POWERUP_RADIUS}
                fill={pu.kind === 'shield' ? '#3b82f6' : '#a855f7'}
                opacity="0.85"
              >
                <animate attributeName="r" values={`${POWERUP_RADIUS - 2};${POWERUP_RADIUS + 2};${POWERUP_RADIUS - 2}`} dur="1s" repeatCount="indefinite" />
              </circle>
              <text
                x={pu.x}
                y={pu.y + 4}
                textAnchor="middle"
                fill="#fff"
                fontSize="12"
                fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >
                {pu.kind === 'shield' ? 'S' : 'M'}
              </text>
            </g>
          ))}

          {balls.map((ball) => (
            <circle
              key={`ball-${ball.id}`}
              className="dodge-ball-ball"
              cx={ball.x}
              cy={ball.y}
              r={BALL_RADIUS}
              fill={ball.color}
            />
          ))}

          <image
            className={`dodge-ball-character ${invincibleBlink ? 'blink' : ''}`}
            href={characterSprite}
            x={playerX - CHARACTER_SIZE / 2}
            y={playerY - CHARACTER_SIZE / 2}
            width={CHARACTER_SIZE}
            height={CHARACTER_SIZE}
            preserveAspectRatio="xMidYMid meet"
            opacity={invincibleBlink ? 0.4 : 1}
          />

          {isInvincible && (
            <circle
              className="dodge-ball-shield"
              cx={playerX}
              cy={playerY}
              r={CHARACTER_RADIUS + 6}
              fill="none"
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="2"
              strokeDasharray="6 4"
            />
          )}
        </svg>
      </div>

      <div className="dodge-ball-footer">
        <p className="dodge-ball-hint">
          {hp > 0 ? (isCleared ? '30s 돌파! 계속 살아남아 고득점을 노리세요!' : '터치/드래그로 캐릭터를 움직여 공을 피하세요!') : '게임 오버!'}
        </p>
        <div className="dodge-ball-actions">
          <button
            className="dodge-ball-action-button"
            type="button"
            onClick={() => {
              playSfx(hitStrongAudioRef.current, 0.5, 1)
              finishGame()
            }}
          >
            종료
          </button>
          <button className="dodge-ball-action-button ghost" type="button" onClick={onExit}>
            나가기
          </button>
        </div>
      </div>
    </section>
  )
}

export const dodgeBallModule: MiniGameModule = {
  manifest: {
    id: 'dodge-ball',
    title: 'Dodge Ball',
    description: '사방에서 날아오는 공을 피하라! 생존이 곧 점수!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#dc2626',
  },
  Component: DodgeBallGame,
}
