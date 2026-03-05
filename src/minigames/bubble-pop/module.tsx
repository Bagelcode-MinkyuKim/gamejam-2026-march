import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import taeJinaSprite from '../../../assets/images/same-character/tae-jina.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const LOW_TIME_THRESHOLD_MS = 5000

const BUBBLE_MIN_RADIUS = 18
const BUBBLE_MAX_RADIUS = 42
const BUBBLE_SMALL_THRESHOLD = 26
const BUBBLE_RISE_SPEED_MIN = 28
const BUBBLE_RISE_SPEED_MAX = 68
const BUBBLE_SWAY_AMPLITUDE = 12
const BUBBLE_SWAY_SPEED = 1.8
const BUBBLE_SPAWN_INTERVAL_MS = 420
const BUBBLE_SPAWN_INTERVAL_MIN_MS = 180
const BUBBLE_SPAWN_ACCEL_PER_SECOND = 8
const BUBBLE_MAX_COUNT = 28
const BOMB_PROBABILITY = 0.15

const SCORE_SMALL = 3
const SCORE_LARGE = 1
const SCORE_BOMB = -5
const SCORE_GOLDEN = 15
const COMBO_DECAY_MS = 1200
const COMBO_MULTIPLIER_STEP = 5
const MAX_COMBO_MULTIPLIER = 5

const GOLDEN_PROBABILITY = 0.06
const FEVER_COMBO_THRESHOLD = 10
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 2
const FEVER_TIME_BONUS_MS = 2000

const POP_ANIMATION_MS = 320

const STAGE_WIDTH = 360
const STAGE_HEIGHT = 560

const BUBBLE_COLORS = ['#93c5fd', '#f9a8d4', '#86efac', '#fde68a', '#c4b5fd', '#fdba74'] as const

interface Bubble {
  readonly id: number
  x: number
  y: number
  readonly radius: number
  readonly color: string
  readonly isBomb: boolean
  readonly riseSpeed: number
  readonly swayPhase: number
  readonly spawnX: number
}

interface PopEffect {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly isBomb: boolean
  readonly startedAt: number
}

let nextBubbleId = 0

function createBubble(): Bubble {
  const radius = BUBBLE_MIN_RADIUS + Math.random() * (BUBBLE_MAX_RADIUS - BUBBLE_MIN_RADIUS)
  const isBomb = Math.random() < BOMB_PROBABILITY
  const x = radius + Math.random() * (STAGE_WIDTH - radius * 2)
  return {
    id: nextBubbleId++,
    x,
    y: STAGE_HEIGHT + radius,
    radius,
    color: isBomb ? '#ef4444' : BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)],
    isBomb,
    riseSpeed: BUBBLE_RISE_SPEED_MIN + Math.random() * (BUBBLE_RISE_SPEED_MAX - BUBBLE_RISE_SPEED_MIN),
    swayPhase: Math.random() * Math.PI * 2,
    spawnX: x,
  }
}

function toComboMultiplier(combo: number): number {
  return Math.min(MAX_COMBO_MULTIPLIER, 1 + Math.floor(combo / COMBO_MULTIPLIER_STEP))
}

function BubblePopGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [popEffects, setPopEffects] = useState<PopEffect[]>([])

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const lastComboAtRef = useRef(0)
  const bubblesRef = useRef<Bubble[]>([])
  const popEffectsRef = useRef<PopEffect[]>([])
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const lastSpawnAtRef = useRef(0)
  const elapsedMsRef = useRef(0)

  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapStrongAudioRef = useRef<HTMLAudioElement | null>(null)
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
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.64, 0.95)
    onFinish({
      score: Math.max(0, scoreRef.current),
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleBubbleTap = useCallback(
    (bubbleId: number) => {
      if (finishedRef.current) {
        return
      }

      const now = window.performance.now()
      const bubbleIndex = bubblesRef.current.findIndex((b) => b.id === bubbleId)
      if (bubbleIndex === -1) {
        return
      }

      const bubble = bubblesRef.current[bubbleIndex]

      popEffectsRef.current = [
        ...popEffectsRef.current,
        {
          id: bubble.id,
          x: bubble.x,
          y: bubble.y,
          radius: bubble.radius,
          isBomb: bubble.isBomb,
          startedAt: now,
        },
      ]
      setPopEffects([...popEffectsRef.current])

      bubblesRef.current = bubblesRef.current.filter((b) => b.id !== bubbleId)
      setBubbles([...bubblesRef.current])

      if (bubble.isBomb) {
        const nextScore = scoreRef.current + SCORE_BOMB
        scoreRef.current = nextScore
        setScore(nextScore)
        comboRef.current = 0
        setCombo(0)
        playAudio(tapStrongAudioRef, 0.6, 0.7)
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.35)')
        effects.spawnParticles(5, bubble.x, bubble.y, ['💥', '💢', '🔥'])
        return
      }

      const isSmall = bubble.radius <= BUBBLE_SMALL_THRESHOLD
      const basePoints = isSmall ? SCORE_SMALL : SCORE_LARGE

      const timeSinceLastCombo = now - lastComboAtRef.current
      if (timeSinceLastCombo <= COMBO_DECAY_MS) {
        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)
      } else {
        comboRef.current = 1
        setCombo(1)
      }
      lastComboAtRef.current = now

      const multiplier = toComboMultiplier(comboRef.current)
      const earned = basePoints * multiplier
      const nextScore = scoreRef.current + earned
      scoreRef.current = nextScore
      setScore(nextScore)

      const pitchBoost = Math.min(0.4, comboRef.current * 0.03)
      playAudio(tapAudioRef, 0.5, 1 + pitchBoost)

      if (comboRef.current >= 5) {
        effects.comboHitBurst(bubble.x, bubble.y, comboRef.current, earned)
      } else {
        effects.spawnParticles(3, bubble.x, bubble.y, ['✨', '💫', '⭐'])
        effects.showScorePopup(earned, bubble.x, bubble.y)
      }
    },
    [playAudio],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

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
    const tapAudio = new Audio(tapHitSfx)
    tapAudio.preload = 'auto'
    tapAudioRef.current = tapAudio

    const tapStrongAudio = new Audio(tapHitStrongSfx)
    tapStrongAudio.preload = 'auto'
    tapStrongAudioRef.current = tapStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      for (const audio of [tapAudio, tapStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
      tapAudioRef.current = null
      tapStrongAudioRef.current = null
      gameOverAudioRef.current = null
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
      elapsedMsRef.current += deltaMs

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      const deltaSeconds = deltaMs / 1000

      const currentBubbles = bubblesRef.current
      const updatedBubbles: Bubble[] = []
      for (const bubble of currentBubbles) {
        const nextY = bubble.y - bubble.riseSpeed * deltaSeconds
        if (nextY + bubble.radius < 0) {
          continue
        }
        const elapsed = elapsedMsRef.current / 1000
        const swayX = bubble.spawnX + Math.sin(elapsed * BUBBLE_SWAY_SPEED + bubble.swayPhase) * BUBBLE_SWAY_AMPLITUDE
        updatedBubbles.push({
          ...bubble,
          x: swayX,
          y: nextY,
        })
      }

      const elapsedSeconds = elapsedMsRef.current / 1000
      const currentSpawnInterval = Math.max(
        BUBBLE_SPAWN_INTERVAL_MIN_MS,
        BUBBLE_SPAWN_INTERVAL_MS - elapsedSeconds * BUBBLE_SPAWN_ACCEL_PER_SECOND,
      )
      const timeSinceLastSpawn = now - lastSpawnAtRef.current
      if (timeSinceLastSpawn >= currentSpawnInterval && updatedBubbles.length < BUBBLE_MAX_COUNT) {
        updatedBubbles.push(createBubble())
        lastSpawnAtRef.current = now
      }

      bubblesRef.current = updatedBubbles
      setBubbles([...updatedBubbles])

      const currentPops = popEffectsRef.current.filter((p) => now - p.startedAt < POP_ANIMATION_MS)
      popEffectsRef.current = currentPops
      setPopEffects([...currentPops])

      const timeSinceLastCombo = now - lastComboAtRef.current
      if (timeSinceLastCombo > COMBO_DECAY_MS && comboRef.current > 0) {
        comboRef.current = 0
        setCombo(0)
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
      effects.cleanup()
    }
  }, [finishGame])

  const comboMultiplier = toComboMultiplier(combo)
  const displayedBestScore = useMemo(() => Math.max(bestScore, Math.max(0, score)), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0

  return (
    <section className="mini-game-panel bubble-pop-panel" aria-label="bubble-pop-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <img src={taeJinaSprite} alt="태진아" className="bubble-pop-character" />
      <div className="bubble-pop-score-strip">
        <p className="bubble-pop-score">{Math.max(0, score).toLocaleString()}</p>
        <p className="bubble-pop-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`bubble-pop-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="bubble-pop-meta-row">
        <p className="bubble-pop-combo">
          COMBO <strong>{combo}</strong>
        </p>
        <p className="bubble-pop-multiplier">
          x<strong>{comboMultiplier}</strong>
        </p>
      </div>

      <div className="bubble-pop-stage" role="presentation">
        {bubbles.map((bubble) => (
          <div
            key={bubble.id}
            className={`bubble-pop-bubble ${bubble.isBomb ? 'bomb' : ''} ${bubble.radius <= BUBBLE_SMALL_THRESHOLD ? 'small' : 'large'}`}
            style={{
              left: `${(bubble.x / STAGE_WIDTH) * 100}%`,
              top: `${(bubble.y / STAGE_HEIGHT) * 100}%`,
              width: `${bubble.radius * 2}px`,
              height: `${bubble.radius * 2}px`,
              backgroundColor: bubble.color,
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              handleBubbleTap(bubble.id)
            }}
            role="button"
            tabIndex={-1}
          >
            {bubble.isBomb && <span className="bubble-pop-bomb-icon">X</span>}
          </div>
        ))}

        {popEffects.map((pop) => {
          const now = window.performance.now()
          const progress = Math.min(1, (now - pop.startedAt) / POP_ANIMATION_MS)
          const scale = 1 + progress * 0.6
          const opacity = 1 - progress
          return (
            <div
              key={`pop-${pop.id}`}
              className={`bubble-pop-effect ${pop.isBomb ? 'bomb' : ''}`}
              style={{
                left: `${(pop.x / STAGE_WIDTH) * 100}%`,
                top: `${(pop.y / STAGE_HEIGHT) * 100}%`,
                width: `${pop.radius * 2}px`,
                height: `${pop.radius * 2}px`,
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity,
              }}
            />
          )
        })}

        <div className="bubble-pop-score-hint">
          <span className="bubble-pop-hint-small">Small = {SCORE_SMALL}pt</span>
          <span className="bubble-pop-hint-large">Large = {SCORE_LARGE}pt</span>
          <span className="bubble-pop-hint-bomb">Bomb = {SCORE_BOMB}pt</span>
        </div>
      </div>

      {combo >= 3 && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)', fontSize: `${14 + combo}px`, color: getComboColor(combo), zIndex: 20 }}>
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>

      <style>{GAME_EFFECTS_CSS}
      {`
        .bubble-pop-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 8px;
          width: 100%;
          user-select: none;
          -webkit-user-select: none;
          position: relative;
        }

        .bubble-pop-character {
          position: absolute;
          bottom: 60px;
          right: 8px;
          width: 88px;
          height: 88px;
          object-fit: contain;
          opacity: 0.85;
          pointer-events: none;
          z-index: 10;
          filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
        }

        .bubble-pop-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          padding: 0 4px;
        }

        .bubble-pop-score {
          font-size: 28px;
          font-weight: 800;
          color: #06b6d4;
          margin: 0;
          line-height: 1;
        }

        .bubble-pop-best {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .bubble-pop-time {
          font-size: 18px;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0;
          transition: color 0.2s;
        }

        .bubble-pop-time.low-time {
          color: #ef4444;
          animation: bubble-pop-pulse 0.5s ease-in-out infinite alternate;
        }

        .bubble-pop-meta-row {
          display: flex;
          justify-content: center;
          gap: 16px;
          width: 100%;
          padding: 2px 0;
        }

        .bubble-pop-combo,
        .bubble-pop-multiplier {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .bubble-pop-combo strong,
        .bubble-pop-multiplier strong {
          color: #fbbf24;
        }

        .bubble-pop-stage {
          position: relative;
          width: 100%;
          aspect-ratio: ${STAGE_WIDTH} / ${STAGE_HEIGHT};
          max-height: 560px;
          background: linear-gradient(180deg, #0c1445 0%, #1a2980 40%, #26d0ce 100%);
          border-radius: 12px;
          overflow: hidden;
          touch-action: none;
        }

        .bubble-pop-bubble {
          position: absolute;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: none;
          box-shadow: inset -4px -4px 8px rgba(0, 0, 0, 0.12), inset 4px 4px 8px rgba(255, 255, 255, 0.3);
          border: 2px solid rgba(255, 255, 255, 0.35);
        }

        .bubble-pop-bubble:active {
          transform: translate(-50%, -50%) scale(0.9);
        }

        .bubble-pop-bubble.bomb {
          border-color: rgba(220, 38, 38, 0.6);
          box-shadow: inset -4px -4px 8px rgba(0, 0, 0, 0.25), 0 0 12px rgba(239, 68, 68, 0.4);
        }

        .bubble-pop-bomb-icon {
          font-size: 18px;
          font-weight: 900;
          color: #fff;
          text-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
          pointer-events: none;
        }

        .bubble-pop-effect {
          position: absolute;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.8) 0%, rgba(147, 197, 253, 0.4) 60%, transparent 100%);
          pointer-events: none;
        }

        .bubble-pop-effect.bomb {
          background: radial-gradient(circle, rgba(255, 100, 100, 0.9) 0%, rgba(239, 68, 68, 0.5) 60%, transparent 100%);
        }

        .bubble-pop-score-hint {
          position: absolute;
          bottom: 8px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          gap: 12px;
          pointer-events: none;
          opacity: 0.6;
        }

        .bubble-pop-hint-small,
        .bubble-pop-hint-large,
        .bubble-pop-hint-bomb {
          font-size: 12px;
          font-weight: 600;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(0, 0, 0, 0.4);
        }

        .bubble-pop-hint-small {
          color: #93c5fd;
        }

        .bubble-pop-hint-large {
          color: #86efac;
        }

        .bubble-pop-hint-bomb {
          color: #fca5a5;
        }

        @keyframes bubble-pop-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }
      `}</style>
    </section>
  )
}

export const bubblePopModule: MiniGameModule = {
  manifest: {
    id: 'bubble-pop',
    title: 'Bubble Pop',
    description: '떠오르는 버블을 터뜨려라! 작은 버블일수록 고득점, 폭탄은 조심!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#06b6d4',
  },
  Component: BubblePopGame,
}
