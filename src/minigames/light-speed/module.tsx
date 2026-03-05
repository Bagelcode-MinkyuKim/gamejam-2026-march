import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 120000
const INITIAL_HP = 3
const MAX_HP = 3

const FAST_TAP_THRESHOLD_MS = 400
const FAST_TAP_SCORE = 3
const NORMAL_TAP_SCORE = 1

const INITIAL_SPAWN_INTERVAL_MS = 1800
const MIN_SPAWN_INTERVAL_MS = 400
const SPAWN_ACCELERATION = 0.92

const INITIAL_CIRCLE_LIFETIME_MS = 2400
const MIN_CIRCLE_LIFETIME_MS = 800
const LIFETIME_SHRINK_FACTOR = 0.96

const INITIAL_CIRCLE_SIZE = 80
const MIN_CIRCLE_SIZE = 36
const SIZE_SHRINK_FACTOR = 0.985

const MAX_ACTIVE_CIRCLES = 8
const COMBO_DECAY_MS = 3000

const ARENA_PADDING = 0.08

// Golden target: appears every N spawns, worth 3x score
const GOLDEN_SPAWN_INTERVAL = 8
const GOLDEN_SCORE_MULTIPLIER = 3
const GOLDEN_COLOR = '#fbbf24'

// HP recovery: appears every N spawns, restores 1 HP
const HP_RECOVERY_SPAWN_INTERVAL = 15

interface LightCircle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly size: number
  readonly lifetimeMs: number
  readonly spawnedAtMs: number
  readonly color: string
  readonly isGolden: boolean
  readonly isHpRecovery: boolean
}

const CIRCLE_COLORS = [
  '#fbbf24',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#a855f7',
  '#6366f1',
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#84cc16',
] as const

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickRandomColor(): string {
  return CIRCLE_COLORS[Math.floor(Math.random() * CIRCLE_COLORS.length)]
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function LightSpeedGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [hp, setHp] = useState(INITIAL_HP)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [circles, setCircles] = useState<LightCircle[]>([])
  const [popEffects, setPopEffects] = useState<{ id: number; x: number; y: number; text: string; color: string }[]>([])

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const hpRef = useRef(INITIAL_HP)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const lastTapAtMsRef = useRef(0)
  const circlesRef = useRef<LightCircle[]>([])
  const nextCircleIdRef = useRef(0)
  const nextPopIdRef = useRef(0)
  const spawnIntervalMsRef = useRef(INITIAL_SPAWN_INTERVAL_MS)
  const circleLifetimeMsRef = useRef(INITIAL_CIRCLE_LIFETIME_MS)
  const circleSizeRef = useRef(INITIAL_CIRCLE_SIZE)
  const timeSinceLastSpawnRef = useRef(0)
  const totalSpawnedRef = useRef(0)

  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const elapsedMsRef = useRef(0)

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
      audio.volume = clampNumber(volume, 0, 1)
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const spawnCircle = useCallback((elapsedMs: number) => {
    if (circlesRef.current.length >= MAX_ACTIVE_CIRCLES) {
      return
    }

    const size = circleSizeRef.current
    const halfSize = size / 2
    const x = randomBetween(ARENA_PADDING + halfSize / 300, 1 - ARENA_PADDING - halfSize / 300)
    const y = randomBetween(ARENA_PADDING + halfSize / 400, 1 - ARENA_PADDING - halfSize / 400)

    const spawnCount = totalSpawnedRef.current + 1
    const isGolden = spawnCount % GOLDEN_SPAWN_INTERVAL === 0
    const isHpRecovery = !isGolden && spawnCount % HP_RECOVERY_SPAWN_INTERVAL === 0

    const circle: LightCircle = {
      id: nextCircleIdRef.current,
      x,
      y,
      size: isGolden ? size * 1.3 : isHpRecovery ? size * 1.1 : size,
      lifetimeMs: circleLifetimeMsRef.current,
      spawnedAtMs: elapsedMs,
      color: isGolden ? GOLDEN_COLOR : isHpRecovery ? '#ef4444' : pickRandomColor(),
      isGolden,
      isHpRecovery,
    }

    nextCircleIdRef.current += 1
    totalSpawnedRef.current += 1
    circlesRef.current = [...circlesRef.current, circle]
    setCircles(circlesRef.current)
  }, [])

  const addPopEffect = useCallback((x: number, y: number, text: string, color: string) => {
    const popId = nextPopIdRef.current
    nextPopIdRef.current += 1

    setPopEffects((prev) => [...prev, { id: popId, x, y, text, color }])

    window.setTimeout(() => {
      setPopEffects((prev) => prev.filter((p) => p.id !== popId))
    }, 600)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    playAudio(gameOverAudioRef, 0.7, 0.95)
    effects.cleanup()

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleCircleTap = useCallback(
    (circleId: number) => {
      if (finishedRef.current) {
        return
      }

      const targetIndex = circlesRef.current.findIndex((c) => c.id === circleId)
      if (targetIndex === -1) {
        return
      }

      const target = circlesRef.current[targetIndex]
      const now = elapsedMsRef.current
      const circleAge = now - target.spawnedAtMs
      const isFastTap = circleAge <= FAST_TAP_THRESHOLD_MS

      // HP recovery circle
      if (target.isHpRecovery) {
        if (hpRef.current < MAX_HP) {
          hpRef.current = Math.min(MAX_HP, hpRef.current + 1)
          setHp(hpRef.current)
        }
        circlesRef.current = circlesRef.current.filter((c) => c.id !== circleId)
        setCircles(circlesRef.current)
        addPopEffect(target.x, target.y, '+1 HP', '#ef4444')
        const effectX = target.x * 300
        const effectY = target.y * 400
        effects.triggerFlash('rgba(239,68,68,0.3)', 60)
        effects.spawnParticles(5, effectX, effectY)
        playAudio(tapHitStrongAudioRef, 0.5, 1.2)
        return
      }

      const goldenMultiplier = target.isGolden ? GOLDEN_SCORE_MULTIPLIER : 1
      const tapScore = (isFastTap ? FAST_TAP_SCORE : NORMAL_TAP_SCORE) * goldenMultiplier
      const comboBonus = Math.floor(comboRef.current / 5)
      const totalTapScore = tapScore + comboBonus

      const nextScore = scoreRef.current + totalTapScore
      scoreRef.current = nextScore
      setScore(nextScore)

      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      lastTapAtMsRef.current = now
      setCombo(nextCombo)

      circlesRef.current = circlesRef.current.filter((c) => c.id !== circleId)
      setCircles(circlesRef.current)

      const scoreText = target.isGolden ? `+${totalTapScore} GOLD!` : `+${totalTapScore}`
      addPopEffect(target.x, target.y, scoreText, target.isGolden ? '#fbbf24' : isFastTap ? '#fbbf24' : '#ffffff')

      // Visual effects for circle tap
      const effectX = target.x * 300
      const effectY = target.y * 400
      if (isFastTap || target.isGolden) {
        effects.comboHitBurst(effectX, effectY, nextCombo, totalTapScore)
        playAudio(tapHitStrongAudioRef, 0.6, target.isGolden ? 1.3 : 1 + Math.min(0.4, nextCombo * 0.02))
      } else {
        effects.spawnParticles(3, effectX, effectY)
        effects.triggerFlash('rgba(255,255,255,0.2)', 50)
        effects.showScorePopup(totalTapScore, effectX, effectY)
        playAudio(tapHitAudioRef, 0.5, 1 + Math.min(0.3, nextCombo * 0.015))
      }
    },
    [addPopEffect, playAudio],
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
      effects.cleanup()
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
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

      effects.updateParticles()

      if (elapsedMsRef.current - lastTapAtMsRef.current > COMBO_DECAY_MS && comboRef.current > 0) {
        comboRef.current = 0
        setCombo(0)
      }

      timeSinceLastSpawnRef.current += deltaMs
      if (timeSinceLastSpawnRef.current >= spawnIntervalMsRef.current) {
        timeSinceLastSpawnRef.current = 0
        spawnCircle(elapsedMsRef.current)

        spawnIntervalMsRef.current = Math.max(
          MIN_SPAWN_INTERVAL_MS,
          spawnIntervalMsRef.current * SPAWN_ACCELERATION,
        )
        circleLifetimeMsRef.current = Math.max(
          MIN_CIRCLE_LIFETIME_MS,
          circleLifetimeMsRef.current * LIFETIME_SHRINK_FACTOR,
        )
        circleSizeRef.current = Math.max(
          MIN_CIRCLE_SIZE,
          circleSizeRef.current * SIZE_SHRINK_FACTOR,
        )
      }

      let hpChanged = false
      const currentElapsed = elapsedMsRef.current
      const survivingCircles = circlesRef.current.filter((circle) => {
        const age = currentElapsed - circle.spawnedAtMs
        if (age >= circle.lifetimeMs) {
          hpRef.current = Math.max(0, hpRef.current - 1)
          hpChanged = true
          return false
        }
        return true
      })

      if (survivingCircles.length !== circlesRef.current.length) {
        circlesRef.current = survivingCircles
        setCircles(survivingCircles)
      }

      if (hpChanged) {
        setHp(hpRef.current)
        playAudio(gameOverAudioRef, 0.4, 1.2)

        // Visual effects for HP loss
        effects.triggerShake(7)
        effects.triggerFlash('rgba(239,68,68,0.4)')

        if (hpRef.current <= 0) {
          finishGame()
          animationFrameRef.current = null
          return
        }
      }

      if (remainingMsRef.current <= 0) {
        finishGame()
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
  }, [finishGame, playAudio, spawnCircle])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= 5000
  const isLowHp = hp === 1

  const hpHearts = useMemo(() => {
    const hearts: string[] = []
    for (let i = 0; i < MAX_HP; i += 1) {
      hearts.push(i < hp ? '\u2764' : '\u2661')
    }
    return hearts
  }, [hp])

  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  return (
    <section className="mini-game-panel light-speed-panel" aria-label="light-speed-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}

        .light-speed-panel {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 10px;
          user-select: none;
          -webkit-user-select: none;
        }

        .light-speed-hud {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .light-speed-hud-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }

        .light-speed-score {
          font-size: 20px;
          font-weight: bold;
          color: #fbbf24;
          margin: 0;
          text-shadow: 0 1px 4px rgba(251, 191, 36, 0.4);
        }

        .light-speed-best {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
        }

        .light-speed-hp {
          margin: 0;
          font-size: 16px;
          letter-spacing: 4px;
        }

        .light-speed-hp.low {
          animation: light-speed-hp-blink 0.5s ease-in-out infinite;
        }

        .light-speed-heart-full {
          color: #ef4444;
          text-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
        }

        .light-speed-heart-empty {
          color: #4b5563;
        }

        .light-speed-time {
          font-size: 12px;
          color: #d1d5db;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .light-speed-time.low-time {
          color: #ef4444;
          animation: light-speed-blink 0.6s ease-in-out infinite;
        }

        .light-speed-combo {
          font-size: 10px;
          color: #c084fc;
          margin: 0;
        }

        .light-speed-combo strong {
          font-size: 13px;
          color: #e9d5ff;
        }

        .light-speed-arena {
          position: relative;
          width: 100%;
          aspect-ratio: 3 / 4;
          max-height: 420px;
          border-radius: 12px;
          background: radial-gradient(ellipse at center, #1a1a2e 0%, #0f0f1a 100%);
          border: 2px solid #fbbf2440;
          overflow: hidden;
          touch-action: manipulation;
        }

        .light-speed-circle {
          position: absolute;
          border: none;
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.05s ease-out;
          z-index: 1;
        }

        .light-speed-circle:active {
          transform: translate(-50%, -50%) scale(0.85) !important;
        }

        .light-speed-glow {
          position: absolute;
          width: 60%;
          height: 60%;
          border-radius: 50%;
          filter: blur(4px);
          opacity: 0.7;
        }

        .light-speed-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 3px solid;
          box-sizing: border-box;
          pointer-events: none;
          opacity: 0.8;
        }

        .light-speed-pop {
          position: absolute;
          transform: translate(-50%, -50%);
          font-size: 14px;
          font-weight: bold;
          pointer-events: none;
          z-index: 10;
          animation: light-speed-pop-up 0.6s ease-out forwards;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
        }

        @keyframes light-speed-pop-up {
          0% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.2);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -120%) scale(0.8);
          }
        }

        @keyframes light-speed-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        @keyframes light-speed-hp-blink {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="light-speed-hud">
        <div className="light-speed-hud-row">
          <p className="light-speed-score">{score.toLocaleString()}</p>
          <p className="light-speed-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="light-speed-hud-row">
          <p className={`light-speed-hp ${isLowHp ? 'low' : ''}`}>
            {hpHearts.map((heart, i) => (
              <span key={i} className={i < hp ? 'light-speed-heart-full' : 'light-speed-heart-empty'}>
                {heart}
              </span>
            ))}
          </p>
          <p className={`light-speed-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
        </div>
        <div className="light-speed-hud-row">
          <p className="light-speed-combo">
            COMBO <strong>{combo}</strong>
          </p>
          {comboLabel && (
            <p className="ge-combo-label" style={{ fontSize: '14px', color: comboColor, margin: 0 }}>
              {comboLabel}
            </p>
          )}
        </div>
      </div>

      <img
          src={taeJinaImage}
          alt="tae-jina"
          className="light-speed-character"
          style={{
            width: '64px',
            height: '64px',
            objectFit: 'contain',
            alignSelf: 'center',
            opacity: 0.9,
            filter: combo >= 10 ? 'brightness(1.3) drop-shadow(0 0 6px #fbbf24)' : 'none',
            transition: 'filter 0.3s ease',
          }}
        />

      <div className="light-speed-arena">
        {circles.map((circle) => {
          const age = elapsedMsRef.current - circle.spawnedAtMs
          const progress = clampNumber(age / circle.lifetimeMs, 0, 1)
          const ringScale = 1 - progress
          const pulsePhase = (age / 200) % (Math.PI * 2)
          const pulseScale = 1 + Math.sin(pulsePhase) * 0.08
          const opacity = 0.4 + (1 - progress) * 0.6

          return (
            <button
              key={circle.id}
              className="light-speed-circle"
              type="button"
              onClick={() => handleCircleTap(circle.id)}
              style={{
                left: `${circle.x * 100}%`,
                top: `${circle.y * 100}%`,
                width: circle.size,
                height: circle.size,
                transform: `translate(-50%, -50%) scale(${pulseScale})`,
                opacity,
                '--circle-color': circle.color,
                '--ring-scale': ringScale,
              } as React.CSSProperties}
            >
              <span
                className="light-speed-ring"
                style={{
                  transform: `scale(${ringScale})`,
                  borderColor: circle.color,
                  borderWidth: circle.isGolden ? '4px' : circle.isHpRecovery ? '4px' : '3px',
                }}
              />
              <span
                className="light-speed-glow"
                style={{ backgroundColor: circle.color, opacity: circle.isGolden ? 1 : circle.isHpRecovery ? 0.9 : 0.7 }}
              />
              {circle.isGolden && (
                <span style={{ position: 'absolute', fontSize: '10px', fontWeight: 900, color: '#000', pointerEvents: 'none', zIndex: 2 }}>x3</span>
              )}
              {circle.isHpRecovery && (
                <span style={{ position: 'absolute', fontSize: '12px', fontWeight: 900, color: '#fff', pointerEvents: 'none', zIndex: 2 }}>+HP</span>
              )}
            </button>
          )
        })}

        {popEffects.map((pop) => (
          <span
            key={pop.id}
            className="light-speed-pop"
            style={{
              left: `${pop.x * 100}%`,
              top: `${pop.y * 100}%`,
              color: pop.color,
            }}
          >
            {pop.text}
          </span>
        ))}
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const lightSpeedModule: MiniGameModule = {
  manifest: {
    id: 'light-speed',
    title: 'Light Speed',
    description: '나타나는 빛을 번개처럼 빠르게 터치! 놓치면 HP 감소!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.1,
    accentColor: '#fbbf24',
  },
  Component: LightSpeedGame,
}
