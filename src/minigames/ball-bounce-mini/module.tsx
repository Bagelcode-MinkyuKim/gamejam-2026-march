import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const BASE_GRAVITY = 0.0012
const GRAVITY_INCREASE_PER_BOUNCE = 0.00002
const MAX_GRAVITY = 0.0025
const BOUNCE_VELOCITY = -0.62
const STRONG_BOUNCE_VELOCITY = -0.78
const FEVER_COMBO_THRESHOLD = 10
const FEVER_SCORE_MULTIPLIER = 3
const PLATFORM_SPAWN_CHANCE = 0.15
const PLATFORM_WIDTH = 60
const PLATFORM_HEIGHT = 8
const PLATFORM_DURATION_MS = 6000
const WALL_BOUNCE_DAMPING = 0.85
const HORIZONTAL_TAP_FORCE = 0.28
const BALL_RADIUS = 24
const ARENA_WIDTH = 320
const ARENA_HEIGHT = 520
const FLOOR_Y = ARENA_HEIGHT - BALL_RADIUS
const CEILING_Y = BALL_RADIUS
const WALL_LEFT = BALL_RADIUS
const WALL_RIGHT = ARENA_WIDTH - BALL_RADIUS
const INITIAL_BALL_X = ARENA_WIDTH / 2
const INITIAL_BALL_Y = ARENA_HEIGHT * 0.55
const INITIAL_VY = -0.4
const TAP_RADIUS_TOLERANCE = 60
const PERFECT_TAP_RADIUS = 30
const COMBO_DECAY_MS = 2000
const HEIGHT_SCORE_DIVISOR = 80
const MAX_HEIGHT_METER_PX = ARENA_HEIGHT - 60

const COMBO_COLORS = [
  '#f43f5e',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#22d3ee',
  '#818cf8',
  '#e879f9',
] as const

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function comboColor(combo: number): string {
  if (combo <= 0) return COMBO_COLORS[0]
  return COMBO_COLORS[Math.min(combo, COMBO_COLORS.length - 1) % COMBO_COLORS.length]
}

function BallBounceMiniGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [ballX, setBallX] = useState(INITIAL_BALL_X)
  const [ballY, setBallY] = useState(INITIAL_BALL_Y)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxHeight, setMaxHeight] = useState(0)
  const [bounceCount, setBounceCount] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [platforms, setPlatforms] = useState<Array<{ x: number; y: number; remainingMs: number }>>([])
  const [currentGravity, setCurrentGravity] = useState(BASE_GRAVITY)

  const ballXRef = useRef(INITIAL_BALL_X)
  const ballYRef = useRef(INITIAL_BALL_Y)
  const vxRef = useRef(0)
  const vyRef = useRef(INITIAL_VY)
  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxHeightRef = useRef(0)
  const bounceCountRef = useRef(0)
  const lastBounceAtRef = useRef(0)
  const finishedRef = useRef(false)
  const gravityRef = useRef(BASE_GRAVITY)
  const platformsRef = useRef<Array<{ x: number; y: number; remainingMs: number }>>([])
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const elapsedMsRef = useRef(0)
  const arenaRef = useRef<HTMLDivElement | null>(null)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
    const audio = audioRef.current
    if (audio === null) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setGameOver(true)
    playSfx(gameOverAudioRef, 0.65, 0.9)

    const elapsedMs = Math.max(Math.round(DEFAULT_FRAME_MS), Math.round(elapsedMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playSfx])

  const handleTap = useCallback(
    (clientX: number, clientY: number) => {
      if (finishedRef.current) return

      const arena = arenaRef.current
      if (arena === null) return

      const rect = arena.getBoundingClientRect()
      const scaleX = ARENA_WIDTH / rect.width
      const scaleY = ARENA_HEIGHT / rect.height
      const tapX = (clientX - rect.left) * scaleX
      const tapY = (clientY - rect.top) * scaleY

      const dx = tapX - ballXRef.current
      const dy = tapY - ballYRef.current
      const distanceToBall = Math.hypot(dx, dy)

      if (distanceToBall > TAP_RADIUS_TOLERANCE) return

      const now = performance.now()
      const isPerfect = distanceToBall <= PERFECT_TAP_RADIUS
      const timeSinceLastBounce = now - lastBounceAtRef.current
      const isComboKept = timeSinceLastBounce <= COMBO_DECAY_MS
      const nextCombo = isComboKept ? comboRef.current + 1 : 1
      comboRef.current = nextCombo
      setCombo(nextCombo)
      lastBounceAtRef.current = now

      const nextBounceCount = bounceCountRef.current + 1
      bounceCountRef.current = nextBounceCount
      setBounceCount(nextBounceCount)

      // Increase gravity with bounces
      const nextGravity = Math.min(MAX_GRAVITY, BASE_GRAVITY + nextBounceCount * GRAVITY_INCREASE_PER_BOUNCE)
      gravityRef.current = nextGravity
      setCurrentGravity(nextGravity)

      // Fever mode
      const feverActive = nextCombo >= FEVER_COMBO_THRESHOLD
      setIsFever(feverActive)

      const heightRatio = 1 - (ballYRef.current / ARENA_HEIGHT)
      const heightBonus = Math.floor(heightRatio * 10)
      const comboBonus = Math.floor(nextCombo / 3)
      const perfectBonus = isPerfect ? 3 : 0
      let pointsEarned = 1 + heightBonus + comboBonus + perfectBonus
      if (feverActive) {
        pointsEarned *= FEVER_SCORE_MULTIPLIER
      }
      const nextScore = scoreRef.current + pointsEarned
      scoreRef.current = nextScore
      setScore(nextScore)

      // Spawn bonus platform randomly
      if (Math.random() < PLATFORM_SPAWN_CHANCE) {
        const platX = Math.random() * (ARENA_WIDTH - PLATFORM_WIDTH)
        const platY = FLOOR_Y - 60 - Math.random() * 200
        const newPlatform = { x: platX, y: platY, remainingMs: PLATFORM_DURATION_MS }
        platformsRef.current = [...platformsRef.current, newPlatform]
        setPlatforms([...platformsRef.current])
      }

      vyRef.current = isPerfect ? STRONG_BOUNCE_VELOCITY : BOUNCE_VELOCITY

      const normalizedDx = (tapX - ballXRef.current) / TAP_RADIUS_TOLERANCE
      vxRef.current = -normalizedDx * HORIZONTAL_TAP_FORCE

      // Visual effects
      effects.comboHitBurst(tapX, tapY, nextCombo, pointsEarned)
      if (isPerfect) {
        effects.triggerFlash()
      }

      if (isPerfect) {
        playSfx(tapHitStrongAudioRef, 0.55, 1 + nextCombo * 0.02)
      } else {
        playSfx(tapHitAudioRef, 0.45, 1 + nextCombo * 0.015)
      }
    },
    [playSfx],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      handleTap(event.clientX, event.clientY)
    },
    [handleTap],
  )

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
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
      }
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
      elapsedMsRef.current += deltaMs

      vyRef.current += gravityRef.current * deltaMs

      let nextX = ballXRef.current + vxRef.current * deltaMs
      let nextY = ballYRef.current + vyRef.current * deltaMs

      if (nextX <= WALL_LEFT) {
        nextX = WALL_LEFT
        vxRef.current = Math.abs(vxRef.current) * WALL_BOUNCE_DAMPING
      } else if (nextX >= WALL_RIGHT) {
        nextX = WALL_RIGHT
        vxRef.current = -Math.abs(vxRef.current) * WALL_BOUNCE_DAMPING
      }

      if (nextY <= CEILING_Y) {
        nextY = CEILING_Y
        vyRef.current = Math.abs(vyRef.current) * 0.3
      }

      // Platform collision check
      let landedOnPlatform = false
      for (const plat of platformsRef.current) {
        if (
          nextY + BALL_RADIUS >= plat.y &&
          nextY + BALL_RADIUS <= plat.y + PLATFORM_HEIGHT + 5 &&
          nextX >= plat.x - BALL_RADIUS &&
          nextX <= plat.x + PLATFORM_WIDTH + BALL_RADIUS &&
          vyRef.current > 0
        ) {
          nextY = plat.y - BALL_RADIUS
          vyRef.current = BOUNCE_VELOCITY * 0.8
          landedOnPlatform = true
          break
        }
      }

      // Decay platforms
      platformsRef.current = platformsRef.current
        .map((p) => ({ ...p, remainingMs: p.remainingMs - deltaMs }))
        .filter((p) => p.remainingMs > 0)
      setPlatforms([...platformsRef.current])

      if (nextY >= FLOOR_Y && !landedOnPlatform) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      ballXRef.current = nextX
      ballYRef.current = nextY
      setBallX(nextX)
      setBallY(nextY)

      const currentHeight = Math.max(0, FLOOR_Y - nextY)
      if (currentHeight > maxHeightRef.current) {
        maxHeightRef.current = currentHeight
        setMaxHeight(currentHeight)
      }

      const heightScore = Math.floor(currentHeight / HEIGHT_SCORE_DIVISOR)
      if (heightScore > 0 && bounceCountRef.current > 0) {
        const bonusPoints = heightScore
        const nextScore = scoreRef.current + bonusPoints
        scoreRef.current = nextScore
        setScore(nextScore)
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
  }, [finishGame])

  const ballColor = comboColor(combo)
  const ballShadowSize = clampNumber(4 + combo * 2, 4, 20)
  const heightPercent = clampNumber((maxHeight / (ARENA_HEIGHT - 60)) * 100, 0, 100)
  const currentHeightPercent = clampNumber(((FLOOR_Y - ballY) / (ARENA_HEIGHT - 60)) * 100, 0, 100)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  return (
    <section className="mini-game-panel ball-bounce-mini-panel" aria-label="ball-bounce-mini-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <div className="ball-bounce-mini-score-strip">
        <p className="ball-bounce-mini-score">{score.toLocaleString()}</p>
        <p className="ball-bounce-mini-best">BEST {displayedBestScore.toLocaleString()}</p>
      </div>

      <div className="ball-bounce-mini-meta-row">
        <p className="ball-bounce-mini-bounces">
          Bounces <strong>{bounceCount}</strong>
        </p>
        <p className="ball-bounce-mini-combo" style={{ color: ballColor }}>
          COMBO <strong>{combo}</strong>
        </p>
        <p className="ball-bounce-mini-height">
          Max <strong>{Math.floor(maxHeight)}</strong>
        </p>
      </div>
      {isFever && (
        <div style={{ textAlign: 'center', color: '#fbbf24', fontWeight: 800, fontSize: 14, textShadow: '0 0 8px #f59e0b', animation: 'ball-bounce-fever 0.4s ease-in-out infinite alternate' }}>
          FEVER x{FEVER_SCORE_MULTIPLIER}
        </div>
      )}
      <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>
        Gravity: {(currentGravity * 10000).toFixed(0)}%
      </div>
      <style>{`
        @keyframes ball-bounce-fever {
          from { opacity: 0.6; transform: scale(1); }
          to { opacity: 1; transform: scale(1.05); }
        }
      `}</style>

      <div className="ball-bounce-mini-arena-wrapper">
        <div className="ball-bounce-mini-height-meter" role="presentation">
          <div
            className="ball-bounce-mini-height-meter-max"
            style={{ height: `${heightPercent}%` }}
          />
          <div
            className="ball-bounce-mini-height-meter-current"
            style={{ height: `${currentHeightPercent}%` }}
          />
        </div>

        <div
          ref={arenaRef}
          className={`ball-bounce-mini-arena ${gameOver ? 'game-over' : ''}`}
          onPointerDown={handlePointerDown}
          role="presentation"
          style={{
            width: ARENA_WIDTH,
            height: ARENA_HEIGHT,
          }}
        >
          <div className="ball-bounce-mini-floor" />

          {platforms.map((plat, idx) => (
            <div
              key={`plat-${idx}`}
              style={{
                position: 'absolute',
                left: plat.x,
                top: plat.y,
                width: PLATFORM_WIDTH,
                height: PLATFORM_HEIGHT,
                background: `linear-gradient(90deg, #22d3ee, #06b6d4)`,
                borderRadius: 4,
                opacity: Math.min(1, plat.remainingMs / 1000),
                boxShadow: '0 2px 8px rgba(34,211,238,0.4)',
              }}
            />
          ))}

          <div
            className="ball-bounce-mini-ball"
            style={{
              left: ballX - BALL_RADIUS,
              top: ballY - BALL_RADIUS,
              width: BALL_RADIUS * 2,
              height: BALL_RADIUS * 2,
              backgroundColor: ballColor,
              boxShadow: `0 ${ballShadowSize}px ${ballShadowSize * 2}px ${ballColor}66, inset 0 -${BALL_RADIUS * 0.3}px ${BALL_RADIUS * 0.5}px rgba(0,0,0,0.25), inset 0 ${BALL_RADIUS * 0.2}px ${BALL_RADIUS * 0.4}px rgba(255,255,255,0.35)`,
            }}
          >
            <div className="ball-bounce-mini-ball-highlight" />
          </div>

          {gameOver && (
            <div className="ball-bounce-mini-game-over-overlay">
              <p className="ball-bounce-mini-game-over-text">GAME OVER</p>
              <p className="ball-bounce-mini-game-over-score">Score: {score}</p>
            </div>
          )}
        </div>
      </div>

      <div className="ball-bounce-mini-actions">
        <button className="text-button" type="button" onClick={onExit}>
          허브로 돌아가기
        </button>
      </div>
    </section>
  )
}

export const ballBounceMiniModule: MiniGameModule = {
  manifest: {
    id: 'ball-bounce-mini',
    title: 'Ball Bounce',
    description: '공을 탭해서 계속 튕겨라! 바닥에 닿으면 게임 오버!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#e11d48',
  },
  Component: BallBounceMiniGame,
}
