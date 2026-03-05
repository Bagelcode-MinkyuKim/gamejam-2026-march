import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 640

const GRAVITY = 0.0012
const FLAP_VELOCITY = -0.42
const MAX_FALL_VELOCITY = 0.6
const CHARACTER_X = 80
const CHARACTER_SIZE = 40
const CHARACTER_HITBOX_SHRINK = 6

const PIPE_WIDTH = 52
const PIPE_SPEED = 0.16
const PIPE_SPAWN_INTERVAL_MS = 1800
const INITIAL_GAP_HEIGHT = 160
const MIN_GAP_HEIGHT = 100
const GAP_SHRINK_PER_SCORE = 2
const PIPE_MIN_TOP = 60
const PIPE_CAP_HEIGHT = 16
const PIPE_CAP_OVERHANG = 4
const PIPE_COLOR = '#22c55e'
const PIPE_CAP_COLOR = '#16a34a'
const PIPE_BORDER_COLOR = '#15803d'

const GROUND_HEIGHT = 60
const CEILING_Y = 0
const GAME_TIMEOUT_MS = 120000

// Speed escalation: pipe speed increases over time
const PIPE_SPEED_INCREASE_PER_SCORE = 0.003
const MAX_PIPE_SPEED = 0.32

// Coins: spawn between pipes for bonus score
const COIN_RADIUS = 10
const COIN_SCORE = 3
const COIN_SPAWN_CHANCE = 0.6

// Score multiplier: every 10 pipes, next 5 pipes give x2
const MULTIPLIER_TRIGGER_INTERVAL = 10
const MULTIPLIER_DURATION = 5
const MULTIPLIER_VALUE = 2

interface Pipe {
  readonly id: number
  x: number
  readonly gapTop: number
  readonly gapBottom: number
  scored: boolean
}

interface Coin {
  readonly id: number
  x: number
  readonly y: number
  collected: boolean
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeGapHeight(score: number): number {
  return Math.max(MIN_GAP_HEIGHT, INITIAL_GAP_HEIGHT - score * GAP_SHRINK_PER_SCORE)
}

function createPipe(id: number, score: number): Pipe {
  const gapHeight = computeGapHeight(score)
  const maxGapTop = VIEWBOX_HEIGHT - GROUND_HEIGHT - gapHeight - PIPE_MIN_TOP
  const gapTop = PIPE_MIN_TOP + Math.random() * Math.max(0, maxGapTop - PIPE_MIN_TOP)
  return {
    id,
    x: VIEWBOX_WIDTH + PIPE_WIDTH,
    gapTop,
    gapBottom: gapTop + gapHeight,
    scored: false,
  }
}

function checkCollision(
  characterY: number,
  pipes: Pipe[],
): boolean {
  const charTop = characterY - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
  const charBottom = characterY + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK
  const charLeft = CHARACTER_X - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
  const charRight = CHARACTER_X + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK

  if (charTop <= CEILING_Y || charBottom >= VIEWBOX_HEIGHT - GROUND_HEIGHT) {
    return true
  }

  for (const pipe of pipes) {
    const pipeLeft = pipe.x
    const pipeRight = pipe.x + PIPE_WIDTH

    if (charRight > pipeLeft && charLeft < pipeRight) {
      if (charTop < pipe.gapTop || charBottom > pipe.gapBottom) {
        return true
      }
    }
  }

  return false
}

function FlappySingerGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [characterY, setCharacterY] = useState(VIEWBOX_HEIGHT / 2)
  const [velocity, setVelocity] = useState(0)
  const [pipes, setPipes] = useState<Pipe[]>([])
  const [coins, setCoins] = useState<Coin[]>([])
  const [gameStarted, setGameStarted] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isMultiplierActive, setIsMultiplierActive] = useState(false)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const characterYRef = useRef(VIEWBOX_HEIGHT / 2)
  const velocityRef = useRef(0)
  const pipesRef = useRef<Pipe[]>([])
  const coinsRef = useRef<Coin[]>([])
  const gameStartedRef = useRef(false)
  const finishedRef = useRef(false)
  const elapsedMsRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const timeSinceLastPipeRef = useRef(0)
  const nextPipeIdRef = useRef(0)
  const multiplierPipesLeftRef = useRef(0)

  const flapAudioRef = useRef<HTMLAudioElement | null>(null)
  const scoreAudioRef = useRef<HTMLAudioElement | null>(null)
  const crashAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) {
      return
    }

    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const finishRound = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    effects.cleanup()
    const finalDurationMs = elapsedMsRef.current > 0 ? Math.round(elapsedMsRef.current) : Math.round(DEFAULT_FRAME_MS)
    onFinish({
      score: scoreRef.current,
      durationMs: finalDurationMs,
    })
  }, [onFinish])

  const handleFlap = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    if (!gameStartedRef.current) {
      gameStartedRef.current = true
      setGameStarted(true)
    }

    velocityRef.current = FLAP_VELOCITY
    setVelocity(FLAP_VELOCITY)
    playSfx(flapAudioRef.current, 0.4, 1.1)

    // Flap visual effect
    effects.spawnParticles(2, 100, characterYRef.current + 20)
  }, [playSfx])

  const handleTap = useCallback(
    (event: React.PointerEvent | React.MouseEvent) => {
      event.preventDefault()
      handleFlap()
    },
    [handleFlap],
  )

  const rotationDeg = useMemo(() => {
    return clampNumber(velocity * 120, -30, 70)
  }, [velocity])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (event.code === 'Space' || event.code === 'ArrowUp') {
        event.preventDefault()
        handleFlap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleFlap, onExit])

  useEffect(() => {
    const flapAudio = new Audio(tapHitSfx)
    flapAudio.preload = 'auto'
    flapAudioRef.current = flapAudio

    const scoreAudio = new Audio(tapHitStrongSfx)
    scoreAudio.preload = 'auto'
    scoreAudioRef.current = scoreAudio

    const crashAudio = new Audio(gameOverHitSfx)
    crashAudio.preload = 'auto'
    crashAudioRef.current = crashAudio

    return () => {
      effects.cleanup()
      for (const audio of [flapAudio, scoreAudio, crashAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
    }
  }, [])

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

      if (!gameStartedRef.current) {
        animationFrameRef.current = window.requestAnimationFrame(step)
        return
      }

      elapsedMsRef.current += deltaMs
      setElapsedMs(elapsedMsRef.current)

      effects.updateParticles()

      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        setGameOver(true)
        finishRound()
        animationFrameRef.current = null
        return
      }

      const nextVelocity = Math.min(MAX_FALL_VELOCITY, velocityRef.current + GRAVITY * deltaMs)
      velocityRef.current = nextVelocity
      setVelocity(nextVelocity)

      const nextY = characterYRef.current + nextVelocity * deltaMs
      characterYRef.current = nextY
      setCharacterY(nextY)

      // Speed escalation: pipe speed increases with score
      const currentPipeSpeed = Math.min(MAX_PIPE_SPEED, PIPE_SPEED + scoreRef.current * PIPE_SPEED_INCREASE_PER_SCORE)

      timeSinceLastPipeRef.current += deltaMs
      const nextPipes = [...pipesRef.current]
      const nextCoins = [...coinsRef.current]

      if (timeSinceLastPipeRef.current >= PIPE_SPAWN_INTERVAL_MS) {
        timeSinceLastPipeRef.current -= PIPE_SPAWN_INTERVAL_MS
        const newPipe = createPipe(nextPipeIdRef.current, scoreRef.current)
        nextPipeIdRef.current += 1
        nextPipes.push(newPipe)

        // Spawn coin in the gap of the pipe
        if (Math.random() < COIN_SPAWN_CHANCE) {
          const coinY = newPipe.gapTop + (newPipe.gapBottom - newPipe.gapTop) / 2
          nextCoins.push({
            id: nextPipeIdRef.current + 10000,
            x: newPipe.x + PIPE_WIDTH / 2,
            y: coinY,
            collected: false,
          })
        }
      }

      const movedDistance = currentPipeSpeed * deltaMs
      for (const pipe of nextPipes) {
        pipe.x -= movedDistance
      }
      for (const coin of nextCoins) {
        coin.x -= movedDistance
      }

      let nextScore = scoreRef.current
      for (const pipe of nextPipes) {
        if (!pipe.scored && pipe.x + PIPE_WIDTH < CHARACTER_X) {
          pipe.scored = true

          // Multiplier management
          if (multiplierPipesLeftRef.current > 0) {
            multiplierPipesLeftRef.current -= 1
            nextScore += MULTIPLIER_VALUE
            if (multiplierPipesLeftRef.current <= 0) {
              setIsMultiplierActive(false)
            }
          } else {
            nextScore += 1
          }

          // Trigger multiplier at intervals
          if (nextScore > 0 && nextScore % MULTIPLIER_TRIGGER_INTERVAL === 0 && multiplierPipesLeftRef.current <= 0) {
            multiplierPipesLeftRef.current = MULTIPLIER_DURATION
            setIsMultiplierActive(true)
            effects.triggerFlash('rgba(251,191,36,0.3)', 80)
          }

          playSfx(scoreAudioRef.current, 0.5, 1 + nextScore * 0.02)

          // Score visual effect
          const scoreDisplay = multiplierPipesLeftRef.current > 0 ? MULTIPLIER_VALUE : 1
          effects.comboHitBurst(120, characterYRef.current - 30, nextScore, scoreDisplay)
        }
      }

      // Coin collection
      const charTop = characterYRef.current - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
      const charBottom = characterYRef.current + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK
      const charLeft = CHARACTER_X - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
      const charRight = CHARACTER_X + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK
      for (const coin of nextCoins) {
        if (coin.collected) continue
        if (coin.x + COIN_RADIUS > charLeft && coin.x - COIN_RADIUS < charRight &&
            coin.y + COIN_RADIUS > charTop && coin.y - COIN_RADIUS < charBottom) {
          coin.collected = true
          nextScore += COIN_SCORE
          playSfx(flapAudioRef.current, 0.4, 1.4)
          effects.showScorePopup(COIN_SCORE, 120, characterYRef.current - 20, '#fbbf24')
        }
      }

      const visiblePipes = nextPipes.filter((pipe) => pipe.x + PIPE_WIDTH > -10)
      pipesRef.current = visiblePipes
      setPipes([...visiblePipes])

      const visibleCoins = nextCoins.filter((c) => !c.collected && c.x + COIN_RADIUS > -10)
      coinsRef.current = visibleCoins
      setCoins([...visibleCoins])

      if (nextScore !== scoreRef.current) {
        scoreRef.current = nextScore
        setScore(nextScore)
      }

      if (checkCollision(nextY, visiblePipes)) {
        setGameOver(true)
        playSfx(crashAudioRef.current, 0.62, 0.95)
        effects.triggerShake(10)
        effects.triggerFlash('rgba(239,68,68,0.5)')
        finishRound()
        animationFrameRef.current = null
        return
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
  }, [finishRound, playSfx])

  const displayedBestScore = Math.max(bestScore, score)
  const comboLabel = getComboLabel(score)
  const comboColor = getComboColor(score)

  return (
    <section className="mini-game-panel flappy-singer-panel" aria-label="flappy-singer-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>

      <div
        className="flappy-singer-board"
        onPointerDown={handleTap}
        role="presentation"
        style={{ position: 'relative' }}
      >
        <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
        <ParticleRenderer particles={effects.particles} />
        <ScorePopupRenderer popups={effects.scorePopups} />

        <svg
          className="flappy-singer-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="flappy-singer-stage"
        >
          <defs>
            <linearGradient id="flappy-singer-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7dd3fc" />
              <stop offset="100%" stopColor="#bae6fd" />
            </linearGradient>
            <linearGradient id="flappy-singer-ground-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#84cc16" />
              <stop offset="100%" stopColor="#65a30d" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#flappy-singer-sky)" />

          {pipes.map((pipe) => (
            <g key={pipe.id}>
              <rect
                x={pipe.x}
                y={0}
                width={PIPE_WIDTH}
                height={pipe.gapTop}
                fill={PIPE_COLOR}
                stroke={PIPE_BORDER_COLOR}
                strokeWidth="1.5"
              />
              <rect
                x={pipe.x - PIPE_CAP_OVERHANG}
                y={pipe.gapTop - PIPE_CAP_HEIGHT}
                width={PIPE_WIDTH + PIPE_CAP_OVERHANG * 2}
                height={PIPE_CAP_HEIGHT}
                fill={PIPE_CAP_COLOR}
                stroke={PIPE_BORDER_COLOR}
                strokeWidth="1.5"
                rx="2"
              />

              <rect
                x={pipe.x}
                y={pipe.gapBottom}
                width={PIPE_WIDTH}
                height={VIEWBOX_HEIGHT - GROUND_HEIGHT - pipe.gapBottom}
                fill={PIPE_COLOR}
                stroke={PIPE_BORDER_COLOR}
                strokeWidth="1.5"
              />
              <rect
                x={pipe.x - PIPE_CAP_OVERHANG}
                y={pipe.gapBottom}
                width={PIPE_WIDTH + PIPE_CAP_OVERHANG * 2}
                height={PIPE_CAP_HEIGHT}
                fill={PIPE_CAP_COLOR}
                stroke={PIPE_BORDER_COLOR}
                strokeWidth="1.5"
                rx="2"
              />
            </g>
          ))}

          {/* Coins */}
          {coins.map((coin) => (
            <g key={`coin-${coin.id}`}>
              <circle cx={coin.x} cy={coin.y} r={COIN_RADIUS + 4} fill="rgba(251,191,36,0.2)" />
              <circle cx={coin.x} cy={coin.y} r={COIN_RADIUS} fill="#fbbf24" stroke="#ca8a04" strokeWidth="1.5" />
              <circle cx={coin.x - 2} cy={coin.y - 2} r={3} fill="rgba(255,255,255,0.5)" />
            </g>
          ))}

          <rect
            x="0"
            y={VIEWBOX_HEIGHT - GROUND_HEIGHT}
            width={VIEWBOX_WIDTH}
            height={GROUND_HEIGHT}
            fill="url(#flappy-singer-ground-grad)"
          />
          <line
            x1="0"
            y1={VIEWBOX_HEIGHT - GROUND_HEIGHT}
            x2={VIEWBOX_WIDTH}
            y2={VIEWBOX_HEIGHT - GROUND_HEIGHT}
            stroke="#4d7c0f"
            strokeWidth="2"
          />

          <g
            transform={`translate(${CHARACTER_X}, ${characterY}) rotate(${rotationDeg})`}
          >
            <circle
              cx="0"
              cy="4"
              r={CHARACTER_SIZE / 2 - 2}
              fill="rgba(0,0,0,0.15)"
            />
            <image
              href={kimYeonjaSprite}
              x={-CHARACTER_SIZE / 2}
              y={-CHARACTER_SIZE / 2}
              width={CHARACTER_SIZE}
              height={CHARACTER_SIZE}
              preserveAspectRatio="xMidYMid meet"
            />
          </g>
        </svg>

        <div className="flappy-singer-hud">
          <p className="flappy-singer-score">{score}</p>
          <p className="flappy-singer-best">BEST {displayedBestScore}</p>
          {isMultiplierActive && (
            <p style={{ fontSize: '14px', fontWeight: 800, color: '#fbbf24', textAlign: 'center', margin: '2px 0' }}>
              x{MULTIPLIER_VALUE} MULTIPLIER!
            </p>
          )}
          {comboLabel && (
            <p className="ge-combo-label" style={{ fontSize: '16px', color: comboColor, textAlign: 'center', margin: '2px 0' }}>
              {comboLabel}
            </p>
          )}
        </div>

        {!gameStarted && !gameOver && (
          <div className="flappy-singer-start-overlay">
            <p className="flappy-singer-start-text">탭하여 시작!</p>
            <p className="flappy-singer-start-sub">스페이스 / 화면 터치로 날아오르세요</p>
          </div>
        )}

        {gameOver && (
          <div className="flappy-singer-gameover-overlay">
            <p className="flappy-singer-gameover-text">GAME OVER</p>
            <p className="flappy-singer-gameover-score">점수: {score}</p>
          </div>
        )}

        <div className="flappy-singer-overlay-actions">
          <button
            className="flappy-singer-action-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              playSfx(scoreAudioRef.current, 0.5, 1)
              finishRound()
            }}
          >
            종료
          </button>
          <button
            className="flappy-singer-action-button ghost"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            나가기
          </button>
        </div>
      </div>
    </section>
  )
}

export const flappySingerModule: MiniGameModule = {
  manifest: {
    id: 'flappy-singer',
    title: 'Flappy Singer',
    description: '탭으로 날아올라 파이프 사이를 통과하라!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#0ea5e9',
  },
  Component: FlappySingerGame,
}
