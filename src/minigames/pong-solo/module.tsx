import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const VIEWBOX_WIDTH = 320
const VIEWBOX_HEIGHT = 480

const BALL_RADIUS = 8
const PADDLE_WIDTH = 64
const PADDLE_HEIGHT = 10
const PADDLE_Y = VIEWBOX_HEIGHT - 36
const PADDLE_CORNER_RATIO = 0.3

const INITIAL_BALL_SPEED = 220
const SPEED_INCREASE_FACTOR = 1.05
const MAX_BALL_SPEED = 720

const WALL_TOP = 0
const WALL_LEFT = 0
const WALL_RIGHT = VIEWBOX_WIDTH

const EDGE_HIT_BONUS = 3
const NORMAL_HIT_SCORE = 1

const NICE_TEXT_DURATION_MS = 600
const GAME_OVER_FLASH_DURATION_MS = 300
const GAME_TIMEOUT_MS = 120000

// Paddle shrink: decreases by this much every N rallies
const PADDLE_SHRINK_INTERVAL = 10
const PADDLE_SHRINK_AMOUNT = 4
const MIN_PADDLE_WIDTH = 32

// Bonus zones: left/right wall bounces within zone give bonus
const BONUS_ZONE_HEIGHT = 80
const BONUS_ZONE_SCORE = 5
const BONUS_ZONE_Y = 60

// Rally milestones: bonus points at thresholds
const RALLY_MILESTONES = [10, 25, 50, 100]
const RALLY_MILESTONE_BONUS = 15

const INITIAL_BALL_ANGLE_MIN = Math.PI * 1.15
const INITIAL_BALL_ANGLE_MAX = Math.PI * 1.85

interface BallState {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function createInitialBall(): BallState {
  const angle = INITIAL_BALL_ANGLE_MIN + Math.random() * (INITIAL_BALL_ANGLE_MAX - INITIAL_BALL_ANGLE_MIN)
  return {
    x: VIEWBOX_WIDTH / 2,
    y: VIEWBOX_HEIGHT / 2,
    vx: Math.cos(angle) * INITIAL_BALL_SPEED,
    vy: Math.sin(angle) * INITIAL_BALL_SPEED,
    speed: INITIAL_BALL_SPEED,
  }
}

function toSpeedLevel(speed: number): number {
  return Math.max(1, Math.round(Math.log(speed / INITIAL_BALL_SPEED) / Math.log(SPEED_INCREASE_FACTOR)) + 1)
}

function PongSoloGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [ball, setBall] = useState<BallState>(createInitialBall)
  const [paddleX, setPaddleX] = useState(VIEWBOX_WIDTH / 2)
  const [niceText, setNiceText] = useState<{ x: number; y: number } | null>(null)
  const [isGameOverFlash, setGameOverFlash] = useState(false)
  const [speedLevel, setSpeedLevel] = useState(1)
  const [currentPaddleWidth, setCurrentPaddleWidth] = useState(PADDLE_WIDTH)
  const [milestoneText, setMilestoneText] = useState<string | null>(null)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const ballRef = useRef<BallState>(ball)
  const paddleXRef = useRef(VIEWBOX_WIDTH / 2)
  const finishedRef = useRef(false)
  const paddleWidthRef = useRef(PADDLE_WIDTH)
  const lastMilestoneRef = useRef(0)
  const milestoneTimerRef = useRef<number | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const elapsedMsRef = useRef(0)
  const niceTimerRef = useRef<number | null>(null)
  const gameOverFlashTimerRef = useRef<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

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

  const triggerNiceText = useCallback((x: number, y: number) => {
    setNiceText({ x, y })
    clearTimeoutSafe(niceTimerRef)
    niceTimerRef.current = window.setTimeout(() => {
      niceTimerRef.current = null
      setNiceText(null)
    }, NICE_TEXT_DURATION_MS)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    setGameOverFlash(true)
    clearTimeoutSafe(gameOverFlashTimerRef)
    gameOverFlashTimerRef.current = window.setTimeout(() => {
      gameOverFlashTimerRef.current = null
      setGameOverFlash(false)
    }, GAME_OVER_FLASH_DURATION_MS)

    playAudio(gameOverAudioRef, 0.62, 0.95)
    effects.triggerShake(8)
    effects.triggerFlash('rgba(239,68,68,0.5)')

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, elapsedMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  const updatePaddleFromClientX = useCallback((clientX: number) => {
    const svg = svgRef.current
    if (svg === null) {
      return
    }

    const rect = svg.getBoundingClientRect()
    const relativeX = (clientX - rect.left) / rect.width
    const svgX = clampNumber(
      relativeX * VIEWBOX_WIDTH,
      PADDLE_WIDTH / 2,
      VIEWBOX_WIDTH - PADDLE_WIDTH / 2,
    )
    paddleXRef.current = svgX
    setPaddleX(svgX)
  }, [])

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
      clearTimeoutSafe(niceTimerRef)
      clearTimeoutSafe(gameOverFlashTimerRef)
      effects.cleanup()
      for (const audio of [tapHitAudio, tapHitStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (finishedRef.current) {
        return
      }

      updatePaddleFromClientX(event.clientX)
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (finishedRef.current) {
        return
      }

      if (event.touches.length > 0) {
        updatePaddleFromClientX(event.touches[0].clientX)
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('touchmove', handleTouchMove, { passive: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('touchmove', handleTouchMove)
    }
  }, [updatePaddleFromClientX])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }

      if (finishedRef.current) {
        return
      }

      const step = 24
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        const nextX = clampNumber(paddleXRef.current - step, PADDLE_WIDTH / 2, VIEWBOX_WIDTH - PADDLE_WIDTH / 2)
        paddleXRef.current = nextX
        setPaddleX(nextX)
        return
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault()
        const nextX = clampNumber(paddleXRef.current + step, PADDLE_WIDTH / 2, VIEWBOX_WIDTH - PADDLE_WIDTH / 2)
        paddleXRef.current = nextX
        setPaddleX(nextX)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
    lastFrameAtRef.current = null
    ballRef.current = createInitialBall()

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

      effects.updateParticles()

      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      const deltaSec = deltaMs / 1000

      const currentBall = ballRef.current
      let nextX = currentBall.x + currentBall.vx * deltaSec
      let nextY = currentBall.y + currentBall.vy * deltaSec
      let nextVx = currentBall.vx
      let nextVy = currentBall.vy
      let nextSpeed = currentBall.speed
      let scored = false
      let isEdgeHit = false

      if (nextX - BALL_RADIUS <= WALL_LEFT) {
        nextX = WALL_LEFT + BALL_RADIUS
        nextVx = Math.abs(nextVx)
      }

      if (nextX + BALL_RADIUS >= WALL_RIGHT) {
        nextX = WALL_RIGHT - BALL_RADIUS
        nextVx = -Math.abs(nextVx)
      }

      if (nextY - BALL_RADIUS <= WALL_TOP) {
        nextY = WALL_TOP + BALL_RADIUS
        nextVy = Math.abs(nextVy)
      }

      // Dynamic paddle width: shrinks every N rallies
      const currentPW = Math.max(MIN_PADDLE_WIDTH, PADDLE_WIDTH - Math.floor(scoreRef.current / PADDLE_SHRINK_INTERVAL) * PADDLE_SHRINK_AMOUNT)
      paddleWidthRef.current = currentPW

      const paddleCenterX = paddleXRef.current
      const paddleLeft = paddleCenterX - currentPW / 2
      const paddleRight = paddleCenterX + currentPW / 2
      const paddleTop = PADDLE_Y - PADDLE_HEIGHT / 2

      if (
        nextVy > 0 &&
        nextY + BALL_RADIUS >= paddleTop &&
        currentBall.y + BALL_RADIUS <= paddleTop + 4 &&
        nextX + BALL_RADIUS >= paddleLeft &&
        nextX - BALL_RADIUS <= paddleRight
      ) {
        nextY = paddleTop - BALL_RADIUS

        const hitPosition = (nextX - paddleCenterX) / (currentPW / 2)
        const clampedHit = clampNumber(hitPosition, -1, 1)

        const cornerDistance = Math.abs(clampedHit)
        isEdgeHit = cornerDistance > (1 - PADDLE_CORNER_RATIO)

        const maxBounceAngle = Math.PI * 0.38
        const bounceAngle = -Math.PI / 2 + clampedHit * maxBounceAngle

        if (isEdgeHit) {
          const edgeBoostAngle = bounceAngle * 1.25
          const clampedEdgeAngle = clampNumber(edgeBoostAngle, -Math.PI * 0.44, Math.PI * 0.44)
          nextVx = Math.sin(clampedEdgeAngle) * nextSpeed
          nextVy = -Math.cos(clampedEdgeAngle) * nextSpeed
        } else {
          nextVx = Math.sin(bounceAngle) * nextSpeed
          nextVy = -Math.cos(bounceAngle) * nextSpeed
        }

        nextSpeed = Math.min(nextSpeed * SPEED_INCREASE_FACTOR, MAX_BALL_SPEED)

        const magnitude = Math.hypot(nextVx, nextVy)
        if (magnitude > 0) {
          nextVx = (nextVx / magnitude) * nextSpeed
          nextVy = (nextVy / magnitude) * nextSpeed
        }

        scored = true
      }

      // Bonus zone scoring: ball bouncing off walls in the bonus zone area
      let bonusZoneHit = false
      if (nextX - BALL_RADIUS <= WALL_LEFT || nextX + BALL_RADIUS >= WALL_RIGHT) {
        if (nextY >= BONUS_ZONE_Y && nextY <= BONUS_ZONE_Y + BONUS_ZONE_HEIGHT) {
          bonusZoneHit = true
        }
      }

      if (nextY - BALL_RADIUS > VIEWBOX_HEIGHT) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      const nextBall: BallState = {
        x: nextX,
        y: nextY,
        vx: nextVx,
        vy: nextVy,
        speed: nextSpeed,
      }
      ballRef.current = nextBall
      setBall(nextBall)

      if (scored) {
        const addedScore = isEdgeHit ? NORMAL_HIT_SCORE + EDGE_HIT_BONUS : NORMAL_HIT_SCORE
        const nextScore = scoreRef.current + addedScore
        scoreRef.current = nextScore
        setScore(nextScore)
        setSpeedLevel(toSpeedLevel(nextSpeed))
        setCurrentPaddleWidth(paddleWidthRef.current)

        // Rally milestone bonuses
        for (const milestone of RALLY_MILESTONES) {
          if (nextScore >= milestone && lastMilestoneRef.current < milestone) {
            lastMilestoneRef.current = milestone
            scoreRef.current += RALLY_MILESTONE_BONUS
            setScore(scoreRef.current)
            setMilestoneText(`${milestone} RALLIES! +${RALLY_MILESTONE_BONUS}`)
            if (milestoneTimerRef.current !== null) window.clearTimeout(milestoneTimerRef.current)
            milestoneTimerRef.current = window.setTimeout(() => {
              milestoneTimerRef.current = null
              setMilestoneText(null)
            }, 1200)
            effects.comboHitBurst(160, 200, milestone, RALLY_MILESTONE_BONUS)
            break
          }
        }

        // Visual effects for paddle hit
        if (isEdgeHit) {
          triggerNiceText(nextX, paddleTop - 20)
          playAudio(tapHitStrongAudioRef, 0.56, 1.04 + scoreRef.current * 0.003)
          effects.comboHitBurst(200, 350, nextScore, addedScore)
        } else {
          playAudio(tapHitAudioRef, 0.44, 1.0 + scoreRef.current * 0.002)
          effects.spawnParticles(3, 200, 350)
          effects.triggerFlash('rgba(255,255,255,0.15)', 50)
          effects.showScorePopup(addedScore, 200, 340)
        }
      }

      // Bonus zone scoring
      if (bonusZoneHit) {
        scoreRef.current += BONUS_ZONE_SCORE
        setScore(scoreRef.current)
        effects.showScorePopup(BONUS_ZONE_SCORE, nextX > VIEWBOX_WIDTH / 2 ? 280 : 40, nextY, '#22c55e')
        playAudio(tapHitAudioRef, 0.3, 1.3)
      }

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
  }, [finishGame, playAudio, triggerNiceText])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const speedPercent = clampNumber(((ball.speed - INITIAL_BALL_SPEED) / (MAX_BALL_SPEED - INITIAL_BALL_SPEED)) * 100, 0, 100)

  const comboLabel = getComboLabel(score)
  const comboColor = getComboColor(score)

  return (
    <section className="mini-game-panel pong-solo-panel" aria-label="pong-solo-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="pong-solo-score-strip">
        <img src={parkWankyuImage} alt="박완규" className="pong-solo-character" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
        <div>
          <p className="pong-solo-score">{score.toLocaleString()}</p>
          <p className="pong-solo-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
      </div>

      <div className="pong-solo-meta-row">
        <p className="pong-solo-speed-label">
          Speed Lv.<strong>{speedLevel}</strong>
        </p>
        <p className="pong-solo-rallies">
          Rallies <strong>{score}</strong>
        </p>
        {currentPaddleWidth < PADDLE_WIDTH && (
          <p style={{ fontSize: '11px', color: '#f97316', margin: 0 }}>
            Paddle {currentPaddleWidth}px
          </p>
        )}
        {comboLabel && (
          <p className="ge-combo-label" style={{ fontSize: '13px', color: comboColor, margin: 0 }}>
            {comboLabel}
          </p>
        )}
      </div>
      {milestoneText && (
        <p style={{ textAlign: 'center', fontSize: '14px', fontWeight: 800, color: '#fbbf24', margin: '2px 0' }}>
          {milestoneText}
        </p>
      )}

      <div className="pong-solo-speed-gauge" role="presentation">
        <div
          className="pong-solo-speed-gauge-fill"
          style={{ width: `${speedPercent}%` }}
        />
      </div>

      <div
        className={`pong-solo-arena ${isGameOverFlash ? 'game-over-flash' : ''}`}
        onPointerMove={(event) => {
          if (!finishedRef.current) {
            updatePaddleFromClientX(event.clientX)
          }
        }}
        onTouchMove={(event) => {
          if (!finishedRef.current && event.touches.length > 0) {
            updatePaddleFromClientX(event.touches[0].clientX)
          }
        }}
        role="presentation"
      >
        <svg
          ref={svgRef}
          className="pong-solo-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="pong-solo-field"
        >
          <rect
            className="pong-solo-bg"
            x="0"
            y="0"
            width={VIEWBOX_WIDTH}
            height={VIEWBOX_HEIGHT}
            rx="8"
          />

          <line
            className="pong-solo-wall-top"
            x1="0"
            y1="2"
            x2={VIEWBOX_WIDTH}
            y2="2"
          />
          <line
            className="pong-solo-wall-left"
            x1="2"
            y1="0"
            x2="2"
            y2={VIEWBOX_HEIGHT}
          />
          <line
            className="pong-solo-wall-right"
            x1={VIEWBOX_WIDTH - 2}
            y1="0"
            x2={VIEWBOX_WIDTH - 2}
            y2={VIEWBOX_HEIGHT}
          />

          <line
            className="pong-solo-danger-line"
            x1="0"
            y1={VIEWBOX_HEIGHT - 4}
            x2={VIEWBOX_WIDTH}
            y2={VIEWBOX_HEIGHT - 4}
          />

          <circle
            className="pong-solo-ball"
            cx={ball.x}
            cy={ball.y}
            r={BALL_RADIUS}
          />

          {/* Bonus zones on walls */}
          <rect
            x={0}
            y={BONUS_ZONE_Y}
            width={6}
            height={BONUS_ZONE_HEIGHT}
            fill="rgba(34,197,94,0.25)"
            rx="2"
          />
          <rect
            x={VIEWBOX_WIDTH - 6}
            y={BONUS_ZONE_Y}
            width={6}
            height={BONUS_ZONE_HEIGHT}
            fill="rgba(34,197,94,0.25)"
            rx="2"
          />

          <rect
            className="pong-solo-paddle"
            x={paddleX - currentPaddleWidth / 2}
            y={PADDLE_Y - PADDLE_HEIGHT / 2}
            width={currentPaddleWidth}
            height={PADDLE_HEIGHT}
            rx="4"
          />

          <rect
            className="pong-solo-paddle-edge left"
            x={paddleX - currentPaddleWidth / 2}
            y={PADDLE_Y - PADDLE_HEIGHT / 2}
            width={currentPaddleWidth * PADDLE_CORNER_RATIO}
            height={PADDLE_HEIGHT}
            rx="4"
          />
          <rect
            className="pong-solo-paddle-edge right"
            x={paddleX + currentPaddleWidth / 2 - currentPaddleWidth * PADDLE_CORNER_RATIO}
            y={PADDLE_Y - PADDLE_HEIGHT / 2}
            width={currentPaddleWidth * PADDLE_CORNER_RATIO}
            height={PADDLE_HEIGHT}
            rx="4"
          />

          {niceText !== null ? (
            <text
              className="pong-solo-nice-text"
              x={niceText.x}
              y={niceText.y}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              NICE! +{EDGE_HIT_BONUS + NORMAL_HIT_SCORE}
            </text>
          ) : null}
        </svg>
      </div>

      <div className="pong-solo-actions">
        <button className="text-button" type="button" onClick={handleExit}>
          허브로 돌아가기
        </button>
      </div>
    </section>
  )
}

export const pongSoloModule: MiniGameModule = {
  manifest: {
    id: 'pong-solo',
    title: 'Pong Solo',
    description: '혼자서 퐁! 공을 계속 튕겨라, 놓치면 게임 오버!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#a855f7',
  },
  Component: PongSoloGame,
}
