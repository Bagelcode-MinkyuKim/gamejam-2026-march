import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import parkSangminImg from '../../../assets/images/same-character/park-sangmin.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const LOW_TIME_THRESHOLD_MS = 5000
const CORRECT_SCORE = 1
const WRONG_PENALTY = 2
const COMBO_BONUS_THRESHOLD = 5
const COMBO_BONUS_SCORE = 3
const BASE_DISPLAY_MS = 2400
const MIN_DISPLAY_MS = 600
const DISPLAY_MS_REDUCTION_PER_SCORE = 40
const FEEDBACK_DURATION_MS = 320
const SHAKE_DURATION_MS = 400
const COMBO_PULSE_DURATION_MS = 500
const NEW_QUESTION_DELAY_MS = 280

const FEVER_COMBO_THRESHOLD = 10
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 2
const FEVER_TIME_BONUS_MS = 3000
const EXTRA_COLORS_SCORE_THRESHOLD = 15

const BASE_COLORS: readonly ColorEntry[] = [
  { name: '\uBE68\uAC15', hex: '#ef4444' },
  { name: '\uD30C\uB791', hex: '#3b82f6' },
  { name: '\uCD08\uB85D', hex: '#22c55e' },
  { name: '\uB178\uB791', hex: '#eab308' },
  { name: '\uBCF4\uB77C', hex: '#8b5cf6' },
]

const EXTRA_COLORS: readonly ColorEntry[] = [
  { name: '\uD558\uB298', hex: '#06b6d4' },
  { name: '\uBD84\uD64D', hex: '#ec4899' },
  { name: '\uC8FC\uD669', hex: '#f97316' },
]

interface ColorEntry {
  readonly name: string
  readonly hex: string
}

interface Question {
  readonly text: string
  readonly textColor: string
  readonly isMatch: boolean
}

function pickRandom<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

function getActiveColors(score: number): readonly ColorEntry[] {
  if (score >= EXTRA_COLORS_SCORE_THRESHOLD + 10) return [...BASE_COLORS, ...EXTRA_COLORS]
  if (score >= EXTRA_COLORS_SCORE_THRESHOLD) return [...BASE_COLORS, EXTRA_COLORS[0], EXTRA_COLORS[1]]
  return BASE_COLORS
}

function generateQuestion(colors: readonly ColorEntry[]): Question {
  const textColor: ColorEntry = pickRandom(colors)
  const isMatch = Math.random() < 0.4
  if (isMatch) {
    return { text: textColor.name, textColor: textColor.hex, isMatch: true }
  }
  const candidates = colors.filter((c) => c.hex !== textColor.hex)
  const displayColor: ColorEntry = pickRandom(candidates)
  return { text: textColor.name, textColor: displayColor.hex, isMatch: false }
}

function calculateDisplayMs(score: number): number {
  return Math.max(MIN_DISPLAY_MS, BASE_DISPLAY_MS - score * DISPLAY_MS_REDUCTION_PER_SCORE)
}

function ColorMatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [question, setQuestion] = useState<Question>(() => generateQuestion(BASE_COLORS))
  const [questionVisible, setQuestionVisible] = useState(true)
  const [feedbackType, setFeedbackType] = useState<'correct' | 'wrong' | null>(null)
  const [isShaking, setIsShaking] = useState(false)
  const [isComboPulse, setIsComboPulse] = useState(false)
  const [floatingScore, setFloatingScore] = useState<{ value: string; key: number } | null>(null)
  const [isFeverMode, setIsFeverMode] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const questionRef = useRef<Question>(question)
  const finishedRef = useRef(false)
  const waitingNextRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const questionTimerRef = useRef(0)
  const feedbackTimerRef = useRef<number | null>(null)
  const shakeTimerRef = useRef<number | null>(null)
  const comboPulseTimerRef = useRef<number | null>(null)
  const nextQuestionTimerRef = useRef<number | null>(null)
  const floatingKeyRef = useRef(0)
  const feverRemainingMsRef = useRef(0)
  const feverActiveRef = useRef(false)

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
      if (audio === null) return
      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const activateFever = useCallback(() => {
    feverActiveRef.current = true
    feverRemainingMsRef.current = FEVER_DURATION_MS
    setIsFeverMode(true)
    setFeverRemainingMs(FEVER_DURATION_MS)
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FEVER_TIME_BONUS_MS)
    setRemainingMs(remainingMsRef.current)
  }, [])

  const deactivateFever = useCallback(() => {
    feverActiveRef.current = false
    feverRemainingMsRef.current = 0
    setIsFeverMode(false)
    setFeverRemainingMs(0)
  }, [])

  const advanceQuestion = useCallback(() => {
    const colors = getActiveColors(Math.max(0, scoreRef.current))
    const next = generateQuestion(colors)
    questionRef.current = next
    setQuestion(next)
    setQuestionVisible(true)
    questionTimerRef.current = 0
    waitingNextRef.current = false
  }, [])

  const scheduleNextQuestion = useCallback(() => {
    waitingNextRef.current = true
    setQuestionVisible(false)
    clearTimeoutSafe(nextQuestionTimerRef)
    nextQuestionTimerRef.current = window.setTimeout(() => {
      nextQuestionTimerRef.current = null
      if (!finishedRef.current) {
        advanceQuestion()
      }
    }, NEW_QUESTION_DELAY_MS)
  }, [advanceQuestion])

  const triggerFeedback = useCallback((type: 'correct' | 'wrong') => {
    setFeedbackType(type)
    clearTimeoutSafe(feedbackTimerRef)
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null
      setFeedbackType(null)
    }, FEEDBACK_DURATION_MS)
  }, [])

  const triggerShake = useCallback(() => {
    setIsShaking(true)
    clearTimeoutSafe(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsShaking(false)
    }, SHAKE_DURATION_MS)
  }, [])

  const triggerComboPulse = useCallback(() => {
    setIsComboPulse(true)
    clearTimeoutSafe(comboPulseTimerRef)
    comboPulseTimerRef.current = window.setTimeout(() => {
      comboPulseTimerRef.current = null
      setIsComboPulse(false)
    }, COMBO_PULSE_DURATION_MS)
  }, [])

  const showFloatingScore = useCallback((value: string) => {
    floatingKeyRef.current += 1
    setFloatingScore({ value, key: floatingKeyRef.current })
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true

    clearTimeoutSafe(feedbackTimerRef)
    clearTimeoutSafe(shakeTimerRef)
    clearTimeoutSafe(comboPulseTimerRef)
    clearTimeoutSafe(nextQuestionTimerRef)

    playAudio(gameOverAudioRef, 0.64, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: Math.max(0, scoreRef.current),
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleAnswer = useCallback(
    (playerSaysMatch: boolean) => {
      if (finishedRef.current || waitingNextRef.current) return

      const currentQuestion = questionRef.current
      const isCorrect = playerSaysMatch === currentQuestion.isMatch

      if (isCorrect) {
        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        let earned = CORRECT_SCORE
        const isComboBonus = nextCombo > 0 && nextCombo % COMBO_BONUS_THRESHOLD === 0
        if (isComboBonus) {
          earned += COMBO_BONUS_SCORE
        }

        // Apply fever multiplier
        if (feverActiveRef.current) {
          earned *= FEVER_SCORE_MULTIPLIER
        }

        // Trigger fever mode at threshold
        if (nextCombo === FEVER_COMBO_THRESHOLD && !feverActiveRef.current) {
          activateFever()
          playAudio(tapHitStrongAudioRef, 0.8, 1.3)
          showFloatingScore(`FEVER! +${earned}`)
          effects.comboHitBurst(200, 200, nextCombo, earned, ['🔥', '⚡', '💥', '🌟'])
        } else if (isComboBonus) {
          triggerComboPulse()
          playAudio(tapHitStrongAudioRef, 0.6, 1.1 + Math.min(0.3, nextCombo * 0.02))
          showFloatingScore(`+${earned} COMBO!`)
          effects.comboHitBurst(200, 200, nextCombo, earned)
        } else {
          playAudio(tapHitAudioRef, 0.5, 1 + Math.min(0.2, nextCombo * 0.015))
          showFloatingScore(feverActiveRef.current ? `+${earned} FEVER!` : `+${earned}`)
          effects.triggerFlash(feverActiveRef.current ? 'rgba(251,191,36,0.3)' : 'rgba(34,197,94,0.3)')
          effects.spawnParticles(feverActiveRef.current ? 5 : 3, 200, 200)
        }

        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)
        triggerFeedback('correct')
      } else {
        comboRef.current = 0
        setCombo(0)

        // End fever on wrong answer
        if (feverActiveRef.current) {
          deactivateFever()
        }

        const nextScore = scoreRef.current - WRONG_PENALTY
        scoreRef.current = nextScore
        setScore(nextScore)
        triggerFeedback('wrong')
        triggerShake()
        effects.triggerShake(6)
        effects.triggerFlash('rgba(239,68,68,0.3)')
        playAudio(tapHitAudioRef, 0.4, 0.7)
        showFloatingScore(`-${WRONG_PENALTY}`)
      }

      scheduleNextQuestion()
    },
    [activateFever, deactivateFever, playAudio, scheduleNextQuestion, showFloatingScore, triggerComboPulse, triggerFeedback, triggerShake],
  )

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
      clearTimeoutSafe(feedbackTimerRef)
      clearTimeoutSafe(shakeTimerRef)
      clearTimeoutSafe(comboPulseTimerRef)
      clearTimeoutSafe(nextQuestionTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current) return

      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }

      if (event.code === 'ArrowLeft' || event.code === 'KeyA' || event.code === 'KeyO') {
        event.preventDefault()
        handleAnswer(true)
        return
      }

      if (event.code === 'ArrowRight' || event.code === 'KeyD' || event.code === 'KeyX') {
        event.preventDefault()
        handleAnswer(false)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleAnswer, handleExit])

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

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Tick fever timer
      if (feverActiveRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          deactivateFever()
        }
      }

      if (!waitingNextRef.current) {
        questionTimerRef.current += deltaMs
        const displayLimit = calculateDisplayMs(Math.max(0, scoreRef.current))
        if (questionTimerRef.current >= displayLimit) {
          comboRef.current = 0
          setCombo(0)
          if (feverActiveRef.current) {
            deactivateFever()
          }
          scheduleNextQuestion()
        }
      }

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
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
  }, [deactivateFever, finishGame, scheduleNextQuestion])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayMs = calculateDisplayMs(Math.max(0, score))
  const timeBarPercent = waitingNextRef.current ? 0 : Math.max(0, 100 - (questionTimerRef.current / displayMs) * 100)
  const activeColorCount = getActiveColors(Math.max(0, score)).length

  const panelClass = [
    'mini-game-panel',
    'color-match-panel',
    isShaking ? 'color-match-shake' : '',
    feedbackType === 'correct' ? 'color-match-correct-flash' : '',
    feedbackType === 'wrong' ? 'color-match-wrong-flash' : '',
    isFeverMode ? 'color-match-fever' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={panelClass} aria-label="color-match-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}
      {`
        .color-match-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 16px 12px;
          position: relative;
          overflow: hidden;
        }

        .color-match-panel.color-match-fever {
          animation: color-match-fever-bg 0.6s ease-in-out infinite alternate;
        }

        @keyframes color-match-fever-bg {
          from { box-shadow: inset 0 0 60px rgba(251,191,36,0.15); }
          to { box-shadow: inset 0 0 80px rgba(251,191,36,0.3); }
        }

        .color-match-fever-banner {
          position: absolute;
          top: 40px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          color: #fff;
          font-size: 18px;
          font-weight: 900;
          padding: 6px 24px;
          border-radius: 20px;
          z-index: 30;
          letter-spacing: 3px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          animation: color-match-fever-pulse 0.4s ease-in-out infinite alternate;
          pointer-events: none;
        }

        @keyframes color-match-fever-pulse {
          from { transform: translateX(-50%) scale(1); }
          to { transform: translateX(-50%) scale(1.08); }
        }

        .color-match-fever-timer {
          width: 80%;
          height: 4px;
          background: rgba(255,255,255,0.2);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 4px;
        }

        .color-match-fever-timer-fill {
          height: 100%;
          background: linear-gradient(90deg, #fbbf24, #ef4444);
          border-radius: 2px;
          transition: width 0.1s linear;
        }

        .color-match-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          padding: 0 4px;
        }

        .color-match-score {
          font-size: 28px;
          font-weight: bold;
          color: #1f2937;
          margin: 0;
          transition: transform 0.15s ease;
        }

        .color-match-score.negative {
          color: #ef4444;
        }

        .color-match-best {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
          letter-spacing: 1px;
        }

        .color-match-time {
          font-size: 13px;
          color: #4b5563;
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s ease;
        }

        .color-match-time.low-time {
          color: #ef4444;
          animation: color-match-time-pulse 0.5s ease infinite alternate;
        }

        @keyframes color-match-time-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.08); }
        }

        .color-match-meta-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          width: 100%;
          padding: 0 4px;
        }

        .color-match-combo {
          font-size: 11px;
          color: #6b7280;
          margin: 0;
          transition: transform 0.2s ease, color 0.2s ease;
        }

        .color-match-combo.active {
          color: #f59e0b;
        }

        .color-match-combo.pulse {
          animation: color-match-combo-burst 0.5s ease;
          color: #f59e0b;
        }

        @keyframes color-match-combo-burst {
          0% { transform: scale(1); }
          30% { transform: scale(1.5); }
          100% { transform: scale(1); }
        }

        .color-match-speed {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
        }

        .color-match-colors-label {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
        }

        .color-match-question-timer {
          width: 100%;
          height: 6px;
          background: #e5e7eb;
          border-radius: 3px;
          overflow: hidden;
          margin: 2px 0;
        }

        .color-match-question-timer-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          border-radius: 3px;
          transition: width 0.1s linear;
        }

        .color-match-question-timer-fill.urgent {
          background: linear-gradient(90deg, #ef4444, #f59e0b);
        }

        .color-match-question-timer-fill.fever {
          background: linear-gradient(90deg, #fbbf24, #ef4444, #fbbf24);
          background-size: 200% 100%;
          animation: color-match-fever-bar 0.8s linear infinite;
        }

        @keyframes color-match-fever-bar {
          from { background-position: 0% 0; }
          to { background-position: 200% 0; }
        }

        .color-match-arena {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 160px;
          padding: 20px 16px;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(255,255,255,0.9), rgba(248,248,248,0.95));
          border: 2px solid #e5e7eb;
          position: relative;
          overflow: hidden;
        }

        .color-match-fever .color-match-arena {
          border-color: #fbbf24;
          background: linear-gradient(180deg, rgba(255,251,235,0.95), rgba(254,243,199,0.95));
        }

        .color-match-word {
          font-size: 42px;
          font-weight: bold;
          margin: 0;
          text-align: center;
          user-select: none;
          transition: opacity 0.15s ease, transform 0.15s ease;
          line-height: 1.3;
          letter-spacing: 4px;
        }

        .color-match-word.hidden {
          opacity: 0;
          transform: scale(0.8);
        }

        .color-match-word.visible {
          opacity: 1;
          transform: scale(1);
          animation: color-match-word-appear 0.25s ease-out;
        }

        @keyframes color-match-word-appear {
          from { opacity: 0; transform: scale(0.5) rotate(-5deg); }
          to { opacity: 1; transform: scale(1) rotate(0deg); }
        }

        .color-match-hint {
          font-size: 12px;
          color: #9ca3af;
          margin: 8px 0 0 0;
          text-align: center;
        }

        .color-match-floating-score {
          position: absolute;
          top: 20%;
          left: 50%;
          transform: translateX(-50%);
          font-size: 22px;
          font-weight: bold;
          pointer-events: none;
          animation: color-match-float-up 0.7s ease-out forwards;
          z-index: 10;
        }

        .color-match-floating-score.positive {
          color: #22c55e;
        }

        .color-match-floating-score.negative {
          color: #ef4444;
        }

        .color-match-floating-score.bonus {
          color: #f59e0b;
          font-size: 26px;
        }

        @keyframes color-match-float-up {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
          60% { opacity: 1; transform: translateX(-50%) translateY(-40px) scale(1.15); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-70px) scale(0.8); }
        }

        .color-match-buttons {
          display: flex;
          gap: 12px;
          width: 100%;
          padding: 4px 0;
        }

        .color-match-button {
          flex: 1;
          padding: 18px 8px;
          border-radius: 14px;
          border: 3px solid;
          font-size: 15px;
          font-weight: bold;
          cursor: pointer;
          user-select: none;
          transition: transform 0.1s ease, box-shadow 0.1s ease, filter 0.1s ease;
          position: relative;
          overflow: hidden;
          font-family: inherit;
          letter-spacing: 1px;
        }

        .color-match-button:active {
          transform: scale(0.94);
        }

        .color-match-button.match {
          background: linear-gradient(180deg, #bbf7d0 0%, #86efac 100%);
          border-color: #22c55e;
          color: #166534;
          box-shadow: 0 4px 0 #16a34a, 0 6px 12px rgba(34, 197, 94, 0.25);
        }

        .color-match-button.match:active {
          box-shadow: 0 1px 0 #16a34a;
          transform: scale(0.94) translateY(3px);
        }

        .color-match-button.no-match {
          background: linear-gradient(180deg, #fecaca 0%, #fca5a5 100%);
          border-color: #ef4444;
          color: #991b1b;
          box-shadow: 0 4px 0 #dc2626, 0 6px 12px rgba(239, 68, 68, 0.25);
        }

        .color-match-button.no-match:active {
          box-shadow: 0 1px 0 #dc2626;
          transform: scale(0.94) translateY(3px);
        }

        .color-match-button .color-match-button-icon {
          font-size: 28px;
          display: block;
          margin-bottom: 4px;
        }

        .color-match-button .color-match-button-label {
          font-size: 11px;
          display: block;
        }

        .color-match-shake {
          animation: color-match-shake-anim 0.4s ease;
        }

        @keyframes color-match-shake-anim {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-8px); }
          30% { transform: translateX(8px); }
          45% { transform: translateX(-6px); }
          60% { transform: translateX(6px); }
          75% { transform: translateX(-3px); }
          90% { transform: translateX(3px); }
        }

        .color-match-correct-flash {
          animation: color-match-correct-glow 0.32s ease;
        }

        @keyframes color-match-correct-glow {
          0% { box-shadow: inset 0 0 0 rgba(34, 197, 94, 0); }
          50% { box-shadow: inset 0 0 40px rgba(34, 197, 94, 0.15); }
          100% { box-shadow: inset 0 0 0 rgba(34, 197, 94, 0); }
        }

        .color-match-wrong-flash {
          animation: color-match-wrong-glow 0.32s ease;
        }

        @keyframes color-match-wrong-glow {
          0% { box-shadow: inset 0 0 0 rgba(239, 68, 68, 0); }
          50% { box-shadow: inset 0 0 40px rgba(239, 68, 68, 0.18); }
          100% { box-shadow: inset 0 0 0 rgba(239, 68, 68, 0); }
        }

        .color-match-exit-row {
          margin-top: 4px;
        }
      `}</style>

      {isFeverMode && (
        <div className="color-match-fever-banner">
          FEVER x{FEVER_SCORE_MULTIPLIER}
          <div className="color-match-fever-timer">
            <div className="color-match-fever-timer-fill" style={{ width: `${(feverRemainingMs / FEVER_DURATION_MS) * 100}%` }} />
          </div>
        </div>
      )}

      <div className="color-match-score-strip">
        <p className={`color-match-score ${score < 0 ? 'negative' : ''}`}>{score}</p>
        <p className="color-match-best">BEST {displayedBestScore}</p>
        <p className={`color-match-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="color-match-meta-row">
        <p className={`color-match-combo ${combo >= COMBO_BONUS_THRESHOLD ? 'active' : ''} ${isComboPulse ? 'pulse' : ''}`}>
          COMBO <strong>{combo}</strong>
        </p>
        <p className="color-match-speed">
          {'\uD45C\uC2DC'} <strong>{(displayMs / 1000).toFixed(1)}s</strong>
        </p>
        {activeColorCount > BASE_COLORS.length && (
          <p className="color-match-colors-label">
            {activeColorCount}{'\uC0C9'}
          </p>
        )}
      </div>

      <div className="color-match-question-timer">
        <div
          className={`color-match-question-timer-fill ${isFeverMode ? 'fever' : timeBarPercent < 30 ? 'urgent' : ''}`}
          style={{ width: `${timeBarPercent}%` }}
        />
      </div>

      <div className="color-match-arena">
        <p
          className={`color-match-word ${questionVisible ? 'visible' : 'hidden'}`}
          style={{ color: question.textColor }}
        >
          {question.text}
        </p>
        <p className="color-match-hint">
          {'\uAE00\uC790 \uC0C9\uACFC \uB2E8\uC5B4\uAC00 \uAC19\uC73C\uBA74 O, \uB2E4\uB974\uBA74 X'}
        </p>
        <img
          src={parkSangminImg}
          alt="park-sangmin"
          style={{
            width: '80px',
            height: '80px',
            objectFit: 'contain',
            marginTop: '8px',
            opacity: 0.85,
            filter: isFeverMode ? 'brightness(1.3) saturate(1.5)' : feedbackType === 'correct' ? 'brightness(1.2)' : feedbackType === 'wrong' ? 'grayscale(0.5)' : 'none',
            transition: 'filter 0.2s ease',
          }}
        />

        {floatingScore !== null ? (
          <span
            key={floatingScore.key}
            className={`color-match-floating-score ${
              floatingScore.value.startsWith('-') ? 'negative' : floatingScore.value.includes('COMBO') || floatingScore.value.includes('FEVER') ? 'bonus' : 'positive'
            }`}
          >
            {floatingScore.value}
          </span>
        ) : null}
      </div>

      <div className="color-match-buttons">
        <button className="color-match-button match" type="button" onClick={() => handleAnswer(true)}>
          <span className="color-match-button-icon">O</span>
          <span className="color-match-button-label">{'\uC77C\uCE58'}</span>
        </button>
        <button className="color-match-button no-match" type="button" onClick={() => handleAnswer(false)}>
          <span className="color-match-button-icon">X</span>
          <span className="color-match-button-label">{'\uBD88\uC77C\uCE58'}</span>
        </button>
      </div>

      {combo >= 3 && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', fontSize: `${16 + combo}px`, color: getComboColor(combo), zIndex: 20 }}>
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="color-match-exit-row">
        <button className="text-button" type="button" onClick={handleExit}>
          {'\uD5C8\uBE0C\uB85C \uB3CC\uC544\uAC00\uAE30'}
        </button>
      </div>
    </section>
  )
}

export const colorMatchModule: MiniGameModule = {
  manifest: {
    id: 'color-match',
    title: 'Color Match',
    description: '\uC0C9 \uC774\uB984\uACFC \uAE00\uC790 \uC0C9\uC774 \uC77C\uCE58\uD558\uB294\uC9C0 \uBE60\uB974\uAC8C \uD310\uB2E8\uD558\uB77C! \uC2A4\uD2B8\uB8F9 \uD14C\uC2A4\uD2B8 \uCC4C\uB9B0\uC9C0',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#3b82f6',
  },
  Component: ColorMatchGame,
}
