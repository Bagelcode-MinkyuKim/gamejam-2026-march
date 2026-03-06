import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import perfectSfx from '../../../assets/sounds/beat-catch-perfect.mp3'
import goodSfx from '../../../assets/sounds/beat-catch-good.mp3'
import missSfx from '../../../assets/sounds/beat-catch-miss.mp3'
import comboSfx from '../../../assets/sounds/beat-catch-combo.mp3'
import feverSfx from '../../../assets/sounds/beat-catch-fever.mp3'
import reverseSfx from '../../../assets/sounds/beat-catch-reverse.mp3'
import goldenSfx from '../../../assets/sounds/beat-catch-golden.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// ─── Constants ──────────────────────────────────────────────────────
const ROUND_DURATION_MS = 35000
const DOT_RADIUS = 14
const TARGET_ANGLE_DEG = 270
const TARGET_HALF_ARC_DEG = 20
const PERFECT_HALF_ARC_DEG = 7
const GOOD_HALF_ARC_DEG = 20
const INITIAL_SPEED_DEG_PER_SEC = 110
const SPEED_INCREMENT_DEG = 18
const CATCHES_PER_SPEED_UP = 5
const MAX_SPEED_DEG_PER_SEC = 500
const PERFECT_SCORE = 5
const GOOD_SCORE = 2
const LOW_TIME_THRESHOLD_MS = 5000
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 3
const DIRECTION_CHANGE_INTERVAL = 7
const GOLDEN_CATCH_CHANCE = 0.12
const GOLDEN_CATCH_MULTIPLIER = 3
const PULSE_DURATION_MS = 300
const SHAKE_DURATION_MS = 300
const VIEWBOX_SIZE = 300
const VIEWBOX_CENTER = VIEWBOX_SIZE / 2
const TRACK_RADIUS = 115

// Multi-target feature
const MULTI_TARGET_THRESHOLD = 15 // catches before multi-target appears
const MULTI_TARGET_DURATION_MS = 8000
const MULTI_TARGET_BONUS = 2

// Speed Rush feature
const SPEED_RUSH_INTERVAL_MS = 12000
const SPEED_RUSH_DURATION_MS = 3000
const SPEED_RUSH_MULTIPLIER = 1.8

// Shrink target feature
const SHRINK_START_CATCHES = 20
const MIN_TARGET_ARC_DEG = 10

type JudgementKind = 'perfect' | 'good' | 'miss'

interface MultiTarget {
  angleDeg: number
  collected: boolean
}

function normalizeAngle(angleDeg: number): number {
  let normalized = angleDeg % 360
  if (normalized < 0) normalized += 360
  return normalized
}

function angleDifference(a: number, b: number): number {
  let diff = normalizeAngle(a) - normalizeAngle(b)
  if (diff > 180) diff -= 360
  if (diff < -180) diff += 360
  return Math.abs(diff)
}

function judgeAngle(currentAngleDeg: number, targetArc: number, perfectArc: number): JudgementKind {
  const diff = angleDifference(currentAngleDeg, TARGET_ANGLE_DEG)
  if (diff <= perfectArc) return 'perfect'
  if (diff <= targetArc) return 'good'
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

// Get dynamic target arc that shrinks as catches increase
function getDynamicTargetArc(catchCount: number): number {
  if (catchCount < SHRINK_START_CATCHES) return TARGET_HALF_ARC_DEG
  const shrinkSteps = catchCount - SHRINK_START_CATCHES
  return Math.max(MIN_TARGET_ARC_DEG, TARGET_HALF_ARC_DEG - shrinkSteps * 0.3)
}

function getDynamicPerfectArc(catchCount: number): number {
  if (catchCount < SHRINK_START_CATCHES) return PERFECT_HALF_ARC_DEG
  const shrinkSteps = catchCount - SHRINK_START_CATCHES
  return Math.max(3, PERFECT_HALF_ARC_DEG - shrinkSteps * 0.15)
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
  const [isSpeedRush, setIsSpeedRush] = useState(false)
  const [multiTargets, setMultiTargets] = useState<MultiTarget[]>([])
  const [trailAngles, setTrailAngles] = useState<number[]>([])
  const [perfectStreak, setPerfectStreak] = useState(0)

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
  const speedRushRef = useRef(false)
  const speedRushTimerRef = useRef(0)
  const multiTargetsRef = useRef<MultiTarget[]>([])
  const multiTargetTimerRef = useRef(0)
  const trailAnglesRef = useRef<number[]>([])
  const perfectStreakRef = useRef(0)

  // Audio refs
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const goodAudioRef = useRef<HTMLAudioElement | null>(null)
  const missAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const reverseAudioRef = useRef<HTMLAudioElement | null>(null)
  const goldenAudioRef = useRef<HTMLAudioElement | null>(null)
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
      if (audio === null) return
      audio.currentTime = 0
      audio.volume = Math.min(1, volume)
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(pulseTimerRef)
    clearTimeoutSafe(shakeTimerRef)
    clearTimeoutSafe(judgementTimerRef)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
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

  // Check multi-target hits
  const checkMultiTargetHit = useCallback((currentAngle: number): number => {
    let bonus = 0
    const updated = multiTargetsRef.current.map((t) => {
      if (t.collected) return t
      const diff = angleDifference(currentAngle, t.angleDeg)
      if (diff <= 15) {
        bonus += MULTI_TARGET_BONUS
        return { ...t, collected: true }
      }
      return t
    })
    multiTargetsRef.current = updated
    setMultiTargets(updated)
    return bonus
  }, [])

  const handleTap = useCallback(() => {
    if (finishedRef.current || !canTapRef.current) return

    canTapRef.current = false
    clearTimeoutSafe(judgementTimerRef)
    judgementTimerRef.current = window.setTimeout(() => {
      judgementTimerRef.current = null
      canTapRef.current = true
      setLastJudgement(null)
    }, 400)

    const dynTargetArc = getDynamicTargetArc(catchCountRef.current)
    const dynPerfectArc = getDynamicPerfectArc(catchCountRef.current)
    const judgement = judgeAngle(angleDegRef.current, dynTargetArc, dynPerfectArc)
    setLastJudgement(judgement)

    // Multi-target bonus
    const multiBonus = checkMultiTargetHit(angleDegRef.current)

    if (judgement === 'perfect') {
      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      setCombo(nextCombo)

      perfectStreakRef.current += 1
      setPerfectStreak(perfectStreakRef.current)

      const goldenMult = goldenActiveRef.current ? GOLDEN_CATCH_MULTIPLIER : 1
      const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
      const rushMult = speedRushRef.current ? 2 : 1
      const streakBonus = perfectStreakRef.current >= 5 ? Math.floor(perfectStreakRef.current / 5) : 0
      const earned = (PERFECT_SCORE * nextCombo + streakBonus + multiBonus) * goldenMult * feverMult * rushMult
      const nextScore = scoreRef.current + earned
      scoreRef.current = nextScore
      setScore(nextScore)

      const nextCatchCount = catchCountRef.current + 1
      catchCountRef.current = nextCatchCount
      setCatchCount(nextCatchCount)

      // Fever activation
      if (nextCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
        feverRef.current = true
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setIsFever(true)
        setFeverRemainingMs(FEVER_DURATION_MS)
        effects.triggerFlash('rgba(250,204,21,0.5)')
        playAudio(feverAudioRef, 0.7)
      }

      // Direction reversal
      if (nextCatchCount % DIRECTION_CHANGE_INTERVAL === 0) {
        directionSignRef.current *= -1
        setDirectionSign(directionSignRef.current)
        effects.triggerFlash('rgba(147,51,234,0.3)')
        playAudio(reverseAudioRef, 0.5)
      }

      // Golden roll
      if (goldenActiveRef.current) {
        playAudio(goldenAudioRef, 0.7)
      }
      goldenActiveRef.current = Math.random() < GOLDEN_CATCH_CHANCE
      setIsGoldenActive(goldenActiveRef.current)

      triggerPulse()

      // Sound: combo sound at milestone, otherwise perfect
      if (nextCombo > 0 && nextCombo % 5 === 0) {
        playAudio(comboAudioRef, 0.7, 1.0 + Math.min(nextCombo * 0.02, 0.4))
      } else {
        playAudio(perfectAudioRef, 0.7, 1.0 + Math.min(nextCombo * 0.03, 0.3))
      }

      effects.comboHitBurst(200, 180, nextCombo, earned, ['💥', '⚡', '🔥', '💫', '✨', '🌟', '🎯'])

    } else if (judgement === 'good') {
      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      setCombo(nextCombo)

      perfectStreakRef.current = 0
      setPerfectStreak(0)

      const goldenMult = goldenActiveRef.current ? GOLDEN_CATCH_MULTIPLIER : 1
      const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
      const earned = (GOOD_SCORE * nextCombo + multiBonus) * goldenMult * feverMult
      const nextScore = scoreRef.current + earned
      scoreRef.current = nextScore
      setScore(nextScore)

      const nextCatchCount = catchCountRef.current + 1
      catchCountRef.current = nextCatchCount
      setCatchCount(nextCatchCount)

      goldenActiveRef.current = Math.random() < GOLDEN_CATCH_CHANCE
      setIsGoldenActive(goldenActiveRef.current)

      playAudio(goodAudioRef, 0.5, 1.0 + Math.min(nextCombo * 0.02, 0.2))
      effects.spawnParticles(4, 200, 180)
      effects.showScorePopup(earned, 200, 160)
      effects.triggerFlash('rgba(34,197,94,0.3)')
    } else {
      comboRef.current = 0
      setCombo(0)
      perfectStreakRef.current = 0
      setPerfectStreak(0)

      if (feverRef.current) {
        feverRef.current = false
        feverRemainingMsRef.current = 0
        setIsFever(false)
        setFeverRemainingMs(0)
      }
      goldenActiveRef.current = false
      setIsGoldenActive(false)

      triggerShake()
      playAudio(missAudioRef, 0.5, 0.8)
      effects.triggerShake(6)
      effects.triggerFlash('rgba(239,68,68,0.4)')
    }
  }, [playAudio, triggerPulse, triggerShake, checkMultiTargetHit])

  // Audio setup
  useEffect(() => {
    const audios = [
      { ref: perfectAudioRef, src: perfectSfx },
      { ref: goodAudioRef, src: goodSfx },
      { ref: missAudioRef, src: missSfx },
      { ref: comboAudioRef, src: comboSfx },
      { ref: feverAudioRef, src: feverSfx },
      { ref: reverseAudioRef, src: reverseSfx },
      { ref: goldenAudioRef, src: goldenSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
    ]
    audios.forEach(({ ref, src }) => {
      const a = new Audio(src)
      a.preload = 'auto'
      ref.current = a
    })
    return () => {
      clearTimeoutSafe(pulseTimerRef)
      clearTimeoutSafe(shakeTimerRef)
      clearTimeoutSafe(judgementTimerRef)
      audios.forEach(({ ref }) => { ref.current = null })
      effects.cleanup()
    }
  }, [])

  // Key handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return }
      if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); handleTap() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [handleTap, onExit])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null
    let elapsedSinceStart = 0

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      elapsedSinceStart += deltaMs

      // Timer
      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)
      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.64, 0.95)
        finishGame()
        animationFrameRef.current = null
        return
      }

      // Fever countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Speed Rush timing
      speedRushTimerRef.current += deltaMs
      if (!speedRushRef.current && speedRushTimerRef.current >= SPEED_RUSH_INTERVAL_MS) {
        speedRushRef.current = true
        setIsSpeedRush(true)
        speedRushTimerRef.current = 0
      }
      if (speedRushRef.current) {
        if (speedRushTimerRef.current >= SPEED_RUSH_DURATION_MS) {
          speedRushRef.current = false
          setIsSpeedRush(false)
          speedRushTimerRef.current = 0
        }
      }

      // Multi-target spawning
      if (catchCountRef.current >= MULTI_TARGET_THRESHOLD) {
        multiTargetTimerRef.current += deltaMs
        if (multiTargetsRef.current.length === 0 && multiTargetTimerRef.current >= MULTI_TARGET_DURATION_MS) {
          const targets: MultiTarget[] = []
          for (let i = 0; i < 2 + Math.floor(catchCountRef.current / 20); i++) {
            targets.push({
              angleDeg: normalizeAngle(Math.random() * 360),
              collected: false,
            })
          }
          multiTargetsRef.current = targets
          setMultiTargets(targets)
          multiTargetTimerRef.current = 0
        }
        // Clean collected targets
        const allCollected = multiTargetsRef.current.length > 0 && multiTargetsRef.current.every((t) => t.collected)
        if (allCollected) {
          multiTargetsRef.current = []
          setMultiTargets([])
        }
      }

      // Move dot
      const baseSpeed = toCurrentSpeed(catchCountRef.current)
      const rushMult = speedRushRef.current ? SPEED_RUSH_MULTIPLIER : 1
      const speed = baseSpeed * rushMult
      const angleDelta = speed * (deltaMs / 1000) * directionSignRef.current
      angleDegRef.current = normalizeAngle(angleDegRef.current + angleDelta)
      setCurrentAngleDeg(angleDegRef.current)

      // Trail effect (keep last 8 positions)
      const newTrail = [...trailAnglesRef.current, angleDegRef.current].slice(-8)
      trailAnglesRef.current = newTrail
      setTrailAngles(newTrail)

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

  // Derived state
  const speedLevel = toSpeedLevel(catchCount)
  const currentSpeed = toCurrentSpeed(catchCount)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const dynTargetArc = getDynamicTargetArc(catchCount)
  const dynPerfectArc = getDynamicPerfectArc(catchCount)

  const dotPosition = angleToSvgCoords(currentAngleDeg, TRACK_RADIUS)
  const targetArcStart = TARGET_ANGLE_DEG - dynTargetArc
  const targetArcEnd = TARGET_ANGLE_DEG + dynTargetArc
  const perfectArcStart = TARGET_ANGLE_DEG - dynPerfectArc
  const perfectArcEnd = TARGET_ANGLE_DEG + dynPerfectArc
  const targetArcPath = describeArc(targetArcStart, targetArcEnd, TRACK_RADIUS)
  const perfectArcPath = describeArc(perfectArcStart, perfectArcEnd, TRACK_RADIUS)
  const targetMarkerPosition = angleToSvgCoords(TARGET_ANGLE_DEG, TRACK_RADIUS)

  const judgementLabel = lastJudgement === 'perfect' ? 'PERFECT!' : lastJudgement === 'good' ? 'GOOD!' : lastJudgement === 'miss' ? 'MISS' : null
  const judgementClass = lastJudgement === 'perfect' ? 'bc-j-perfect' : lastJudgement === 'good' ? 'bc-j-good' : lastJudgement === 'miss' ? 'bc-j-miss' : ''

  const arenaClass = ['bc-arena', isPulseActive ? 'pulse' : '', isShakeActive ? 'shake' : ''].filter(Boolean).join(' ')

  return (
    <section
      className={`mini-game-panel bc-panel ${isFever ? 'bc-fever-mode' : ''} ${isSpeedRush ? 'bc-rush-mode' : ''}`}
      aria-label="beat-catch-game"
      style={{ ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .bc-panel {
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

        .bc-fever-mode {
          animation: bc-fever-bg 0.6s ease-in-out infinite alternate;
        }

        @keyframes bc-fever-bg {
          from { background: linear-gradient(180deg, #2d1a00 0%, #1a0d00 40%, #2d1000 100%); }
          to { background: linear-gradient(180deg, #1a0a12 0%, #0d0d1a 40%, #1a0510 100%); }
        }

        .bc-rush-mode::after {
          content: '';
          position: absolute;
          inset: 0;
          border: 3px solid rgba(239,68,68,0.5);
          pointer-events: none;
          z-index: 10;
          animation: bc-rush-border 0.3s ease-in-out infinite alternate;
          border-radius: inherit;
        }

        @keyframes bc-rush-border {
          from { border-color: rgba(239,68,68,0.3); }
          to { border-color: rgba(239,68,68,0.8); }
        }

        /* ─── Header ─── */
        .bc-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px 6px;
          background: linear-gradient(135deg, rgba(244,63,94,0.25) 0%, rgba(190,18,60,0.15) 100%);
          border-bottom: 1px solid rgba(244,63,94,0.15);
          flex-shrink: 0;
        }

        .bc-score-block {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .bc-score {
          font-size: clamp(28px, 7vw, 36px);
          font-weight: 900;
          color: #fb7185;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 14px rgba(244,63,94,0.6);
        }

        .bc-best {
          font-size: 10px;
          color: #fda4af;
          margin: 0;
          opacity: 0.6;
        }

        .bc-time {
          font-size: clamp(20px, 5vw, 26px);
          font-weight: 800;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s ease;
        }

        .bc-time.low-time {
          color: #ef4444;
          animation: bc-blink 0.5s ease-in-out infinite alternate;
        }

        @keyframes bc-blink {
          from { opacity: 1; }
          to { opacity: 0.3; }
        }

        /* ─── Status Bar ─── */
        .bc-status {
          display: flex;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
          padding: 4px 12px;
          font-size: 11px;
          color: #fda4af;
          flex-shrink: 0;
        }

        .bc-status p { margin: 0; }
        .bc-status strong { color: #e4e4e7; font-weight: 700; }

        .bc-combo-value {
          color: #facc15 !important;
          font-size: 13px;
        }

        .bc-fever-badge {
          color: #facc15;
          font-weight: 800;
          animation: bc-blink 0.3s ease-in-out infinite alternate;
          text-shadow: 0 0 8px rgba(250,204,21,0.6);
        }

        .bc-rush-badge {
          color: #ef4444;
          font-weight: 800;
          animation: bc-blink 0.25s ease-in-out infinite alternate;
          text-shadow: 0 0 8px rgba(239,68,68,0.6);
        }

        .bc-golden-badge {
          color: #fbbf24;
          font-weight: 800;
          text-shadow: 0 0 8px rgba(251,191,36,0.6);
        }

        .bc-streak-badge {
          color: #c084fc;
          font-weight: 700;
          font-size: 10px;
        }

        /* ─── Game Area (fills remaining space) ─── */
        .bc-game-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 4px 8px;
          min-height: 0;
          gap: 8px;
        }

        .bc-arena {
          position: relative;
          width: 100%;
          max-width: 380px;
          aspect-ratio: 1;
          cursor: pointer;
          transition: transform 0.15s ease;
          flex-shrink: 1;
          min-height: 0;
        }

        .bc-arena.pulse { animation: bc-pulse 0.3s ease-out; }
        .bc-arena.shake { animation: bc-shake 0.3s ease-out; }

        @keyframes bc-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }

        @keyframes bc-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        .bc-svg {
          width: 100%;
          height: 100%;
          filter: drop-shadow(0 0 20px rgba(244,63,94,0.15));
        }

        .bc-track {
          fill: none;
          stroke: #3f3f46;
          stroke-width: 3;
        }

        .bc-track-glow {
          fill: none;
          stroke: rgba(244,63,94,0.08);
          stroke-width: 16;
        }

        .bc-target-arc { stroke: rgba(250, 204, 21, 0.2); }
        .bc-perfect-arc { stroke: rgba(244, 63, 94, 0.4); }

        .bc-target-marker {
          fill: #facc15;
          filter: drop-shadow(0 0 8px rgba(250, 204, 21, 0.8));
        }

        .bc-dot {
          fill: #f43f5e;
          filter: drop-shadow(0 0 10px rgba(244, 63, 94, 0.8));
          transition: fill 0.15s ease;
        }

        .bc-dot.perfect {
          fill: #facc15;
          filter: drop-shadow(0 0 14px rgba(250, 204, 21, 1));
        }

        .bc-dot.good {
          fill: #22c55e;
          filter: drop-shadow(0 0 12px rgba(34, 197, 94, 0.9));
        }

        .bc-trail {
          fill: #f43f5e;
          opacity: 0.15;
        }

        .bc-multi-target {
          fill: #8b5cf6;
          filter: drop-shadow(0 0 6px rgba(139,92,246,0.8));
          animation: bc-multi-pulse 0.8s ease-in-out infinite alternate;
        }

        .bc-multi-target.collected {
          fill: #22c55e;
          opacity: 0.5;
        }

        @keyframes bc-multi-pulse {
          from { r: 6; opacity: 0.7; }
          to { r: 9; opacity: 1; }
        }

        .bc-center-ring {
          fill: rgba(244, 63, 94, 0.08);
          stroke: #f43f5e;
          stroke-width: 2;
        }

        .bc-center-text {
          fill: #f43f5e;
          font-size: 16px;
          font-weight: 900;
          letter-spacing: 2px;
        }

        .bc-judgement {
          position: absolute;
          top: 42%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: clamp(28px, 8vw, 40px);
          font-weight: 900;
          pointer-events: none;
          animation: bc-judge-pop 0.4s ease-out forwards;
          text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7);
          margin: 0;
          z-index: 5;
        }

        .bc-j-perfect { color: #facc15; }
        .bc-j-good { color: #22c55e; }
        .bc-j-miss { color: #ef4444; }

        @keyframes bc-judge-pop {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
          30% { opacity: 1; transform: translate(-50%, -50%) scale(1.3); }
          100% { opacity: 0; transform: translate(-50%, -70%) scale(1); }
        }

        /* ─── Tap Button ─── */
        .bc-tap-btn {
          width: 100%;
          max-width: 360px;
          padding: clamp(14px, 4vw, 20px) 0;
          border: none;
          border-radius: 18px;
          background: linear-gradient(135deg, #f43f5e 0%, #e11d48 100%);
          color: #fff;
          font-size: clamp(20px, 5vw, 26px);
          font-weight: 900;
          letter-spacing: 3px;
          cursor: pointer;
          transition: transform 0.1s ease, box-shadow 0.1s ease;
          box-shadow: 0 4px 20px rgba(244, 63, 94, 0.5), 0 0 40px rgba(244,63,94,0.15);
          flex-shrink: 0;
        }

        .bc-tap-btn:active {
          transform: scale(0.94);
          box-shadow: 0 2px 10px rgba(244, 63, 94, 0.3);
        }

        /* ─── Combo Overlay ─── */
        .bc-combo-overlay {
          position: absolute;
          top: 12%;
          left: 50%;
          transform: translateX(-50%);
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 800;
          color: #facc15;
          text-shadow: 0 2px 8px rgba(0,0,0,0.5);
          pointer-events: none;
          z-index: 5;
          animation: bc-combo-bounce 0.3s ease-out;
        }

        @keyframes bc-combo-bounce {
          0% { transform: translateX(-50%) scale(0.5); opacity: 0; }
          60% { transform: translateX(-50%) scale(1.2); opacity: 1; }
          100% { transform: translateX(-50%) scale(1); opacity: 1; }
        }

        /* ─── Speed indicator ring ─── */
        .bc-speed-ring {
          fill: none;
          stroke-linecap: round;
          transition: stroke-dashoffset 0.3s ease;
        }

        /* ─── Footer ─── */
        .bc-footer {
          display: flex;
          justify-content: center;
          padding: 6px 16px 10px;
          flex-shrink: 0;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Header */}
      <div className="bc-header">
        <div className="bc-score-block">
          <p className="bc-score">{score.toLocaleString()}</p>
          <p className="bc-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`bc-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      {/* Status */}
      <div className="bc-status">
        <p>
          COMBO <strong className="bc-combo-value">{combo}</strong>
          {comboLabel && (
            <span className="ge-combo-label" style={{ color: comboColor, marginLeft: 4, fontSize: 11 }}>{comboLabel}</span>
          )}
        </p>
        <p>Lv.<strong>{speedLevel + 1}</strong></p>
        {directionSign < 0 && <p style={{ color: '#a78bfa' }}>REV</p>}
        {isGoldenActive && <p className="bc-golden-badge">GOLDEN</p>}
        {isFever && <p className="bc-fever-badge">FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</p>}
        {isSpeedRush && <p className="bc-rush-badge">RUSH!</p>}
        {perfectStreak >= 5 && <p className="bc-streak-badge">STREAK x{perfectStreak}</p>}
      </div>

      {/* Game Area */}
      <div className="bc-game-area">
        <div className={arenaClass} onClick={handleTap} role="button" tabIndex={0} aria-label="tap-area">
          <svg className="bc-svg" viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`} preserveAspectRatio="xMidYMid meet">

            {/* Track glow */}
            <circle className="bc-track-glow" cx={VIEWBOX_CENTER} cy={VIEWBOX_CENTER} r={TRACK_RADIUS} />

            {/* Speed indicator ring */}
            <circle
              className="bc-speed-ring"
              cx={VIEWBOX_CENTER}
              cy={VIEWBOX_CENTER}
              r={TRACK_RADIUS + 12}
              stroke={isFever ? 'rgba(250,204,21,0.3)' : 'rgba(244,63,94,0.15)'}
              strokeWidth="3"
              strokeDasharray={`${2 * Math.PI * (TRACK_RADIUS + 12)}`}
              strokeDashoffset={`${2 * Math.PI * (TRACK_RADIUS + 12) * (1 - currentSpeed / MAX_SPEED_DEG_PER_SEC)}`}
            />

            {/* Main track */}
            <circle className="bc-track" cx={VIEWBOX_CENTER} cy={VIEWBOX_CENTER} r={TRACK_RADIUS} />

            {/* Target arcs */}
            <path className="bc-target-arc" d={targetArcPath} fill="none" strokeWidth="24" strokeLinecap="round" />
            <path className="bc-perfect-arc" d={perfectArcPath} fill="none" strokeWidth="24" strokeLinecap="round" />

            {/* Target marker */}
            <circle className="bc-target-marker" cx={targetMarkerPosition.x} cy={targetMarkerPosition.y} r="7" />

            {/* Multi-targets */}
            {multiTargets.map((t, i) => {
              const pos = angleToSvgCoords(t.angleDeg, TRACK_RADIUS)
              return (
                <circle
                  key={i}
                  className={`bc-multi-target ${t.collected ? 'collected' : ''}`}
                  cx={pos.x}
                  cy={pos.y}
                  r="7"
                />
              )
            })}

            {/* Trail */}
            {trailAngles.map((angle, i) => {
              const pos = angleToSvgCoords(angle, TRACK_RADIUS)
              const opacity = (i + 1) / trailAngles.length * 0.2
              return (
                <circle
                  key={i}
                  className="bc-trail"
                  cx={pos.x}
                  cy={pos.y}
                  r={DOT_RADIUS * 0.6}
                  style={{ opacity }}
                />
              )
            })}

            {/* Main dot */}
            <circle
              className={`bc-dot ${lastJudgement === 'perfect' ? 'perfect' : lastJudgement === 'good' ? 'good' : ''}`}
              cx={dotPosition.x}
              cy={dotPosition.y}
              r={isGoldenActive ? DOT_RADIUS + 5 : DOT_RADIUS}
              style={isGoldenActive ? { fill: '#fbbf24', filter: 'drop-shadow(0 0 12px rgba(251, 191, 36, 1))' } : undefined}
            />

            {/* Center ring */}
            <circle className="bc-center-ring" cx={VIEWBOX_CENTER} cy={VIEWBOX_CENTER} r="30" />
            <text className="bc-center-text" x={VIEWBOX_CENTER} y={VIEWBOX_CENTER + 2} textAnchor="middle" dominantBaseline="middle">
              TAP
            </text>
          </svg>

          {/* Combo overlay */}
          {combo >= 3 && (
            <p className="bc-combo-overlay" key={combo}>
              {combo}x COMBO
            </p>
          )}

          {/* Judgement popup */}
          {judgementLabel !== null && (
            <p className={`bc-judgement ${judgementClass}`}>{judgementLabel}</p>
          )}
        </div>

        <button className="bc-tap-btn" type="button" onClick={handleTap}>
          CATCH!
        </button>
      </div>

      <div className="bc-footer" />
    </section>
  )
}

export const beatCatchModule: MiniGameModule = {
  manifest: {
    id: 'beat-catch',
    title: 'Beat Catch',
    description: 'Tap when the spinning ball hits the target! Timing game!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#f43f5e',
  },
  Component: BeatCatchGame,
}
