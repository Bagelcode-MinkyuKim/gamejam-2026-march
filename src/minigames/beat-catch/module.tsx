import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import characterImage from '../../../assets/images/same-character/tae-jina.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const TRACK_RADIUS = 110
const DOT_RADIUS = 14
const TARGET_ANGLE_DEG = 270
const TARGET_HALF_ARC_DEG = 18
const PERFECT_HALF_ARC_DEG = 6
const GOOD_HALF_ARC_DEG = 18
const INITIAL_SPEED_DEG_PER_SEC = 120
const SPEED_INCREMENT_DEG = 20
const CATCHES_PER_SPEED_UP = 5
const MAX_SPEED_DEG_PER_SEC = 480
const PERFECT_SCORE = 5
const GOOD_SCORE = 2
const LOW_TIME_THRESHOLD_MS = 5000
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 3
const DIRECTION_CHANGE_INTERVAL = 7
const GOLDEN_CATCH_CHANCE = 0.1
const GOLDEN_CATCH_MULTIPLIER = 3
const PULSE_DURATION_MS = 300
const SHAKE_DURATION_MS = 300
const VIEWBOX_SIZE = 300
const VIEWBOX_CENTER = VIEWBOX_SIZE / 2

type JudgementKind = 'perfect' | 'good' | 'miss'

function normalizeAngle(angleDeg: number): number {
  let normalized = angleDeg % 360
  if (normalized < 0) {
    normalized += 360
  }
  return normalized
}

function angleDifference(a: number, b: number): number {
  let diff = normalizeAngle(a) - normalizeAngle(b)
  if (diff > 180) {
    diff -= 360
  }
  if (diff < -180) {
    diff += 360
  }
  return Math.abs(diff)
}

function judgeAngle(currentAngleDeg: number): JudgementKind {
  const diff = angleDifference(currentAngleDeg, TARGET_ANGLE_DEG)
  if (diff <= PERFECT_HALF_ARC_DEG) {
    return 'perfect'
  }
  if (diff <= GOOD_HALF_ARC_DEG) {
    return 'good'
  }
  return 'miss'
}

function toSpeedLevel(catchCount: number): number {
  return Math.floor(catchCount / CATCHES_PER_SPEED_UP)
}

function toCurrentSpeed(catchCount: number): number {
  const level = toSpeedLevel(catchCount)
  return Math.min(MAX_SPEED_DEG_PER_SEC, INITIAL_SPEED_DEG_PER_SEC + level * SPEED_INCREMENT_DEG)
}

function angleToSvgCoords(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: VIEWBOX_CENTER + Math.cos(rad) * radius,
    y: VIEWBOX_CENTER + Math.sin(rad) * radius,
  }
}

function describeArc(startDeg: number, endDeg: number, radius: number): string {
  const start = angleToSvgCoords(startDeg, radius)
  const end = angleToSvgCoords(endDeg, radius)
  const sweep = endDeg - startDeg
  const largeArc = Math.abs(sweep) > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

function BeatCatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [catchCount, setCatchCount] = useState(0)
  const [currentAngleDeg, setCurrentAngleDeg] = useState(90)
  const [lastJudgement, setLastJudgement] = useState<JudgementKind | null>(null)
  const [isPulseActive, setIsPulseActive] = useState(false)
  const [isShakeActive, setIsShakeActive] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [isGoldenActive, setIsGoldenActive] = useState(false)
  const [directionSign, setDirectionSign] = useState(1)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const catchCountRef = useRef(0)
  const angleDegRef = useRef(90)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const shakeTimerRef = useRef<number | null>(null)
  const judgementTimerRef = useRef<number | null>(null)
  const canTapRef = useRef(true)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const goldenActiveRef = useRef(false)
  const directionSignRef = useRef(1)

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

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(pulseTimerRef)
    clearTimeoutSafe(shakeTimerRef)
    clearTimeoutSafe(judgementTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const triggerPulse = useCallback(() => {
    setIsPulseActive(true)
    clearTimeoutSafe(pulseTimerRef)
    pulseTimerRef.current = window.setTimeout(() => {
      pulseTimerRef.current = null
      setIsPulseActive(false)
    }, PULSE_DURATION_MS)
  }, [])

  const triggerShake = useCallback(() => {
    setIsShakeActive(true)
    clearTimeoutSafe(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsShakeActive(false)
    }, SHAKE_DURATION_MS)
  }, [])

  const handleTap = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    if (!canTapRef.current) {
      return
    }

    canTapRef.current = false
    clearTimeoutSafe(judgementTimerRef)
    judgementTimerRef.current = window.setTimeout(() => {
      judgementTimerRef.current = null
      canTapRef.current = true
      setLastJudgement(null)
    }, 400)

    const judgement = judgeAngle(angleDegRef.current)
    setLastJudgement(judgement)

    if (judgement === 'perfect') {
      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      setCombo(nextCombo)

      const goldenMult = goldenActiveRef.current ? GOLDEN_CATCH_MULTIPLIER : 1
      const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
      const earned = PERFECT_SCORE * nextCombo * goldenMult * feverMult
      const nextScore = scoreRef.current + earned
      scoreRef.current = nextScore
      setScore(nextScore)

      const nextCatchCount = catchCountRef.current + 1
      catchCountRef.current = nextCatchCount
      setCatchCount(nextCatchCount)

      // Activate fever at combo threshold
      if (nextCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
        feverRef.current = true
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setIsFever(true)
        setFeverRemainingMs(FEVER_DURATION_MS)
        effects.triggerFlash('rgba(250,204,21,0.5)')
      }

      // Direction reversal every N catches
      if (nextCatchCount % DIRECTION_CHANGE_INTERVAL === 0) {
        directionSignRef.current *= -1
        setDirectionSign(directionSignRef.current)
        effects.triggerFlash('rgba(147,51,234,0.3)')
      }

      // Roll for next golden beat
      goldenActiveRef.current = Math.random() < GOLDEN_CATCH_CHANCE
      setIsGoldenActive(goldenActiveRef.current)

      triggerPulse()
      playAudio(tapHitStrongAudioRef, 0.7, 1.0 + Math.min(nextCombo * 0.03, 0.3))

      // Visual effects for perfect
      effects.comboHitBurst(200, 180, nextCombo, earned)
    } else if (judgement === 'good') {
      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      setCombo(nextCombo)

      const goldenMult = goldenActiveRef.current ? GOLDEN_CATCH_MULTIPLIER : 1
      const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
      const earned = GOOD_SCORE * nextCombo * goldenMult * feverMult
      const nextScore = scoreRef.current + earned
      scoreRef.current = nextScore
      setScore(nextScore)

      const nextCatchCount = catchCountRef.current + 1
      catchCountRef.current = nextCatchCount
      setCatchCount(nextCatchCount)

      // Roll for next golden beat
      goldenActiveRef.current = Math.random() < GOLDEN_CATCH_CHANCE
      setIsGoldenActive(goldenActiveRef.current)

      playAudio(tapHitAudioRef, 0.5, 1.0 + Math.min(nextCombo * 0.02, 0.2))

      // Visual effects for good
      effects.spawnParticles(4, 200, 180)
      effects.showScorePopup(earned, 200, 160)
      effects.triggerFlash('rgba(34,197,94,0.3)')
    } else {
      comboRef.current = 0
      setCombo(0)

      // End fever on miss
      if (feverRef.current) {
        feverRef.current = false
        feverRemainingMsRef.current = 0
        setIsFever(false)
        setFeverRemainingMs(0)
      }

      goldenActiveRef.current = false
      setIsGoldenActive(false)

      triggerShake()
      playAudio(tapHitAudioRef, 0.3, 0.7)

      // Visual effects for miss
      effects.triggerShake(5)
      effects.triggerFlash('rgba(239,68,68,0.3)')
    }
  }, [playAudio, triggerPulse, triggerShake])

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
      clearTimeoutSafe(pulseTimerRef)
      clearTimeoutSafe(shakeTimerRef)
      clearTimeoutSafe(judgementTimerRef)
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
        return
      }

      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault()
        handleTap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleTap, onExit])

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

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.64, 0.95)
        finishGame()
        animationFrameRef.current = null
        return
      }

      // Fever timer countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      const speed = toCurrentSpeed(catchCountRef.current)
      const angleDelta = speed * (deltaMs / 1000) * directionSignRef.current
      angleDegRef.current = normalizeAngle(angleDegRef.current + angleDelta)
      setCurrentAngleDeg(angleDegRef.current)

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
  }, [finishGame, playAudio])

  const speedLevel = toSpeedLevel(catchCount)
  const currentSpeed = toCurrentSpeed(catchCount)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  const dotPosition = angleToSvgCoords(currentAngleDeg, TRACK_RADIUS)

  const targetArcStart = TARGET_ANGLE_DEG - TARGET_HALF_ARC_DEG
  const targetArcEnd = TARGET_ANGLE_DEG + TARGET_HALF_ARC_DEG
  const perfectArcStart = TARGET_ANGLE_DEG - PERFECT_HALF_ARC_DEG
  const perfectArcEnd = TARGET_ANGLE_DEG + PERFECT_HALF_ARC_DEG

  const targetArcPath = describeArc(targetArcStart, targetArcEnd, TRACK_RADIUS)
  const perfectArcPath = describeArc(perfectArcStart, perfectArcEnd, TRACK_RADIUS)

  const targetMarkerPosition = angleToSvgCoords(TARGET_ANGLE_DEG, TRACK_RADIUS)

  const judgementLabel =
    lastJudgement === 'perfect'
      ? 'PERFECT!'
      : lastJudgement === 'good'
        ? 'GOOD!'
        : lastJudgement === 'miss'
          ? 'MISS'
          : null

  const judgementClass =
    lastJudgement === 'perfect'
      ? 'beat-catch-judgement-perfect'
      : lastJudgement === 'good'
        ? 'beat-catch-judgement-good'
        : lastJudgement === 'miss'
          ? 'beat-catch-judgement-miss'
          : ''

  const arenaClass = [
    'beat-catch-arena',
    isPulseActive ? 'pulse' : '',
    isShakeActive ? 'shake' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className="mini-game-panel beat-catch-panel" aria-label="beat-catch-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .beat-catch-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1a0a12 0%, #0d0d1a 40%, #1a0510 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          position: relative;
          overflow: hidden;
        }

        .beat-catch-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px 8px;
          background: linear-gradient(135deg, rgba(244,63,94,0.3) 0%, rgba(190,18,60,0.2) 100%);
          border-bottom: 1px solid rgba(244,63,94,0.2);
          flex-shrink: 0;
        }

        .beat-catch-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .beat-catch-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #f43f5e;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(244,63,94,0.5);
        }

        .beat-catch-header-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .beat-catch-score {
          font-size: 26px;
          font-weight: 800;
          color: #fb7185;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 14px rgba(244,63,94,0.6);
        }

        .beat-catch-best {
          font-size: 10px;
          color: #fda4af;
          margin: 0;
          opacity: 0.7;
        }

        .beat-catch-header-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .beat-catch-time {
          font-size: 18px;
          font-weight: 700;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s ease;
        }

        .beat-catch-time.low-time {
          color: #ef4444;
          animation: beat-catch-blink 0.5s ease-in-out infinite alternate;
        }

        @keyframes beat-catch-blink {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }

        .beat-catch-meta-row {
          display: flex;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          padding: 6px 16px;
          font-size: 12px;
          color: #fda4af;
          flex-shrink: 0;
        }

        .beat-catch-meta-row p {
          margin: 0;
        }

        .beat-catch-meta-row strong {
          color: #e4e4e7;
          font-weight: 700;
        }

        .beat-catch-combo strong {
          color: #facc15 !important;
        }

        .beat-catch-game-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 8px 16px;
          min-height: 0;
        }

        .beat-catch-arena {
          position: relative;
          width: 260px;
          height: 260px;
          cursor: pointer;
          transition: transform 0.15s ease;
          flex-shrink: 0;
        }

        .beat-catch-arena.pulse {
          animation: beat-catch-pulse 0.3s ease-out;
        }

        .beat-catch-arena.shake {
          animation: beat-catch-shake 0.3s ease-out;
        }

        @keyframes beat-catch-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }

        @keyframes beat-catch-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        .beat-catch-svg {
          width: 100%;
          height: 100%;
          filter: drop-shadow(0 0 20px rgba(244,63,94,0.15));
        }

        .beat-catch-track {
          fill: none;
          stroke: #3f3f46;
          stroke-width: 3;
        }

        .beat-catch-target-arc {
          stroke: rgba(250, 204, 21, 0.18);
        }

        .beat-catch-perfect-arc {
          stroke: rgba(244, 63, 94, 0.35);
        }

        .beat-catch-target-marker {
          fill: #facc15;
          filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.7));
        }

        .beat-catch-dot {
          fill: #f43f5e;
          filter: drop-shadow(0 0 8px rgba(244, 63, 94, 0.7));
          transition: fill 0.15s ease;
        }

        .beat-catch-dot.perfect {
          fill: #facc15;
          filter: drop-shadow(0 0 12px rgba(250, 204, 21, 0.9));
        }

        .beat-catch-dot.good {
          fill: #22c55e;
          filter: drop-shadow(0 0 10px rgba(34, 197, 94, 0.8));
        }

        .beat-catch-center-ring {
          fill: rgba(244, 63, 94, 0.12);
          stroke: #f43f5e;
          stroke-width: 2;
        }

        .beat-catch-center-text {
          fill: #f43f5e;
          font-size: 14px;
          font-weight: 800;
          letter-spacing: 1px;
        }

        .beat-catch-judgement {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 28px;
          font-weight: 900;
          pointer-events: none;
          animation: beat-catch-judgement-pop 0.4s ease-out forwards;
          text-shadow: 0 2px 10px rgba(0, 0, 0, 0.6);
          margin: 0;
        }

        .beat-catch-judgement-perfect {
          color: #facc15;
        }

        .beat-catch-judgement-good {
          color: #22c55e;
        }

        .beat-catch-judgement-miss {
          color: #ef4444;
        }

        @keyframes beat-catch-judgement-pop {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
          }
          30% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.2);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -70%) scale(1);
          }
        }

        .beat-catch-tap-button {
          width: 100%;
          max-width: 260px;
          padding: 16px 0;
          border: none;
          border-radius: 16px;
          background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
          color: #fff;
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 2px;
          cursor: pointer;
          transition: transform 0.1s ease, box-shadow 0.1s ease;
          box-shadow: 0 4px 18px rgba(244, 63, 94, 0.45), 0 0 30px rgba(244,63,94,0.15);
          flex-shrink: 0;
        }

        .beat-catch-tap-button:active {
          transform: scale(0.95);
          box-shadow: 0 2px 10px rgba(244, 63, 94, 0.3);
        }

        .beat-catch-footer {
          display: flex;
          justify-content: center;
          padding: 8px 16px 14px;
          flex-shrink: 0;
        }

        .beat-catch-exit-btn {
          padding: 7px 22px;
          border-radius: 20px;
          border: 1px solid rgba(244,63,94,0.3);
          background: rgba(244,63,94,0.1);
          color: #fda4af;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }

        .beat-catch-exit-btn:active {
          transform: scale(0.95);
          background: rgba(244,63,94,0.2);
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="beat-catch-header">
        <div className="beat-catch-header-left">
          <img className="beat-catch-avatar" src={characterImage} alt="character" />
          <div className="beat-catch-header-info">
            <p className="beat-catch-score">{score.toLocaleString()}</p>
            <p className="beat-catch-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="beat-catch-header-right">
          <p className={`beat-catch-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      <div className="beat-catch-meta-row">
        <p className="beat-catch-combo">
          COMBO <strong>{combo}</strong>
          {comboLabel && (
            <span className="ge-combo-label" style={{ color: comboColor, marginLeft: 4, fontSize: 11 }}>{comboLabel}</span>
          )}
        </p>
        <p className="beat-catch-speed-level">
          SPEED <strong>Lv.{speedLevel + 1}</strong>
        </p>
        <p className="beat-catch-speed-value">{currentSpeed.toFixed(0)} deg/s {directionSign < 0 ? '(REV)' : ''}</p>
        {isGoldenActive && (
          <p style={{ color: '#fbbf24', fontSize: 11, fontWeight: 800, margin: 0, textShadow: '0 0 8px rgba(251,191,36,0.6)' }}>GOLDEN!</p>
        )}
        {isFever && (
          <p style={{ color: '#facc15', fontSize: 11, fontWeight: 800, margin: 0, animation: 'beat-catch-blink 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div className="beat-catch-game-area">
        <div className={arenaClass} onClick={handleTap} role="button" tabIndex={0} aria-label="tap-area">
          <svg
            className="beat-catch-svg"
            viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <circle
              className="beat-catch-track"
              cx={VIEWBOX_CENTER}
              cy={VIEWBOX_CENTER}
              r={TRACK_RADIUS}
            />

            <path
              className="beat-catch-target-arc"
              d={targetArcPath}
              fill="none"
              strokeWidth="22"
              strokeLinecap="round"
            />

            <path
              className="beat-catch-perfect-arc"
              d={perfectArcPath}
              fill="none"
              strokeWidth="22"
              strokeLinecap="round"
            />

            <circle
              className="beat-catch-target-marker"
              cx={targetMarkerPosition.x}
              cy={targetMarkerPosition.y}
              r="6"
            />

            <circle
              className={`beat-catch-dot ${lastJudgement === 'perfect' ? 'perfect' : lastJudgement === 'good' ? 'good' : ''}`}
              cx={dotPosition.x}
              cy={dotPosition.y}
              r={isGoldenActive ? DOT_RADIUS + 4 : DOT_RADIUS}
              style={isGoldenActive ? { fill: '#fbbf24', filter: 'drop-shadow(0 0 10px rgba(251, 191, 36, 0.9))' } : undefined}
            />

            <circle
              className="beat-catch-center-ring"
              cx={VIEWBOX_CENTER}
              cy={VIEWBOX_CENTER}
              r="28"
            />
            <text
              className="beat-catch-center-text"
              x={VIEWBOX_CENTER}
              y={VIEWBOX_CENTER + 2}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              TAP
            </text>
          </svg>

          {judgementLabel !== null && (
            <p className={`beat-catch-judgement ${judgementClass}`}>{judgementLabel}</p>
          )}
        </div>

        <button className="beat-catch-tap-button" type="button" onClick={handleTap}>
          CATCH!
        </button>
      </div>

      <div className="beat-catch-footer">
        <button className="beat-catch-exit-btn" type="button" onClick={onExit}>
          허브로 돌아가기
        </button>
      </div>
    </section>
  )
}

export const beatCatchModule: MiniGameModule = {
  manifest: {
    id: 'beat-catch',
    title: 'Beat Catch',
    description: '회전하는 공이 타겟에 올 때 정확히 탭! 타이밍 게임!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#f43f5e',
  },
  Component: BeatCatchGame,
}
