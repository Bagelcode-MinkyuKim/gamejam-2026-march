import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import taeJinaImg from '../../../assets/images/same-character/tae-jina.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 35000
const GRID_SIZE = 3
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const SCORE_PER_CORRECT = 10
const BASE_SHOW_INTERVAL_MS = 600
const MIN_SHOW_INTERVAL_MS = 180
const SHOW_INTERVAL_DECAY = 0.91
const PAUSE_BETWEEN_PHASES_MS = 350
const CELL_HIGHLIGHT_LINGER_MS = 260
const RESULT_FLASH_DURATION_MS = 450
const LOW_TIME_THRESHOLD_MS = 5000

// Combo & streak
const STREAK_BONUS_THRESHOLD = 3
const STREAK_BONUS_SCORE = 5
const PERFECT_SPEED_BONUS = 8

// Time bonuses
const TIME_BONUS_PER_CORRECT_MS = 500
const PERFECT_TIME_BONUS_MS = 1000

// Fever
const FEVER_STREAK = 5
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 2

type GamePhase = 'showing' | 'input' | 'result-correct' | 'result-wrong'

const CELL_COLORS = [
  '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1',
] as const

function pickRandomCell(excludeLast?: number): number {
  let next: number
  do {
    next = Math.floor(Math.random() * CELL_COUNT)
  } while (next === excludeLast)
  return next
}

function computeShowInterval(patternLength: number): number {
  const decayed = BASE_SHOW_INTERVAL_MS * Math.pow(SHOW_INTERVAL_DECAY, patternLength - 1)
  return Math.max(MIN_SHOW_INTERVAL_MS, decayed)
}

function PatternLockGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<GamePhase>('showing')
  const [pattern, setPattern] = useState<number[]>(() => [pickRandomCell()])
  const [showIndex, setShowIndex] = useState(0)
  const [activeCell, setActiveCell] = useState<number | null>(null)
  const [inputIndex, setInputIndex] = useState(0)
  const [resultFlash, setResultFlash] = useState<'correct' | 'wrong' | null>(null)
  const [round, setRound] = useState(1)
  const [streak, setStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [charAnim, setCharAnim] = useState<'' | 'bounce' | 'recoil' | 'dance'>('')
  const [charSpeech, setCharSpeech] = useState<{ text: string; key: number } | null>(null)
  const [floatingText, setFloatingText] = useState<{ text: string; color: string; key: number } | null>(null)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const phaseRef = useRef<GamePhase>('showing')
  const patternRef = useRef<number[]>([pickRandomCell()])
  const showIndexRef = useRef(0)
  const inputIndexRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const pauseTimerRef = useRef<number | null>(null)
  const resultTimerRef = useRef<number | null>(null)
  const streakRef = useRef(0)
  const feverActiveRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const inputStartTimeRef = useRef(0)
  const charSpeechKeyRef = useRef(0)
  const floatingKeyRef = useRef(0)

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

  const showFloat = useCallback((text: string, color: string) => {
    floatingKeyRef.current += 1
    setFloatingText({ text, color, key: floatingKeyRef.current })
  }, [])

  const showSpeech = useCallback((text: string) => {
    charSpeechKeyRef.current += 1
    setCharSpeech({ text, key: charSpeechKeyRef.current })
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(showTimerRef)
    clearTimeoutSafe(pauseTimerRef)
    clearTimeoutSafe(resultTimerRef)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const startShowPhase = useCallback(
    (nextPattern: number[]) => {
      if (finishedRef.current) return
      patternRef.current = nextPattern
      setPattern(nextPattern)
      showIndexRef.current = 0
      setShowIndex(0)
      inputIndexRef.current = 0
      setInputIndex(0)
      phaseRef.current = 'showing'
      setPhase('showing')
      setActiveCell(null)

      const interval = computeShowInterval(nextPattern.length)
      let currentShowStep = 0

      const showNext = () => {
        if (finishedRef.current) return
        if (currentShowStep < nextPattern.length) {
          const cellToShow = nextPattern[currentShowStep]
          setActiveCell(cellToShow)
          showIndexRef.current = currentShowStep
          setShowIndex(currentShowStep)
          playAudio(tapHitAudioRef, 0.3, 0.8 + currentShowStep * 0.05)

          const lingerTimeout = Math.min(interval * 0.7, CELL_HIGHLIGHT_LINGER_MS)
          showTimerRef.current = window.setTimeout(() => {
            setActiveCell(null)
            currentShowStep += 1
            showTimerRef.current = window.setTimeout(() => showNext(), interval * 0.3)
          }, lingerTimeout)
        } else {
          pauseTimerRef.current = window.setTimeout(() => {
            if (finishedRef.current) return
            phaseRef.current = 'input'
            setPhase('input')
            inputIndexRef.current = 0
            setInputIndex(0)
            setActiveCell(null)
            inputStartTimeRef.current = performance.now()
          }, PAUSE_BETWEEN_PHASES_MS)
        }
      }

      pauseTimerRef.current = window.setTimeout(() => showNext(), PAUSE_BETWEEN_PHASES_MS)
    },
    [playAudio],
  )

  const advanceToNextRound = useCallback(() => {
    if (finishedRef.current) return
    const currentPattern = patternRef.current
    const lastCell = currentPattern[currentPattern.length - 1]
    const newCell = pickRandomCell(lastCell)
    const nextPattern = [...currentPattern, newCell]
    setRound((prev) => prev + 1)
    startShowPhase(nextPattern)
  }, [startShowPhase])

  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (finishedRef.current || phaseRef.current !== 'input') return

      const expected = patternRef.current[inputIndexRef.current]
      if (cellIndex === expected) {
        const nextInputIndex = inputIndexRef.current + 1
        inputIndexRef.current = nextInputIndex
        setInputIndex(nextInputIndex)
        setActiveCell(cellIndex)

        const pitchScale = 1 + nextInputIndex * 0.05
        playAudio(tapHitAudioRef, 0.5, pitchScale)
        effects.spawnParticles(2, 200, 300)

        showTimerRef.current = window.setTimeout(() => setActiveCell(null), CELL_HIGHLIGHT_LINGER_MS * 0.6)

        if (nextInputIndex === patternRef.current.length) {
          // Pattern complete!
          const nextStreak = streakRef.current + 1
          streakRef.current = nextStreak
          setStreak(nextStreak)

          let earned = SCORE_PER_CORRECT
          const patLen = patternRef.current.length

          // Length bonus
          earned += Math.floor(patLen * 2)

          // Streak bonus
          if (nextStreak >= STREAK_BONUS_THRESHOLD) {
            earned += STREAK_BONUS_SCORE
          }

          // Speed bonus (completed under expected time)
          const inputDuration = performance.now() - inputStartTimeRef.current
          const expectedTime = patLen * 600
          if (inputDuration < expectedTime * 0.5) {
            earned += PERFECT_SPEED_BONUS
            showFloat(`SPEED +${PERFECT_SPEED_BONUS}`, '#06b6d4')
            showSpeech('FAST!')
          } else if (inputDuration < expectedTime * 0.75) {
            earned += Math.floor(PERFECT_SPEED_BONUS / 2)
            showFloat(`QUICK +${Math.floor(PERFECT_SPEED_BONUS / 2)}`, '#22c55e')
            showSpeech('NICE!')
          } else {
            const speeches = ['OK!', 'YES!', 'GO!']
            showSpeech(speeches[Math.floor(Math.random() * speeches.length)])
          }

          // Fever
          if (feverActiveRef.current) {
            earned *= FEVER_MULTIPLIER
          }

          // Activate fever
          if (nextStreak === FEVER_STREAK && !feverActiveRef.current) {
            feverActiveRef.current = true
            feverRemainingMsRef.current = FEVER_DURATION_MS
            setIsFever(true)
            setFeverRemainingMs(FEVER_DURATION_MS)
            showFloat('FEVER!', '#fbbf24')
            showSpeech('FEVER!!')
            effects.comboHitBurst(200, 300, nextStreak, earned, ['🔥', '⚡', '💥'])
            playAudio(tapHitStrongAudioRef, 0.9, 1.4)
          }

          // Time bonus
          const timeBonus = nextStreak >= STREAK_BONUS_THRESHOLD ? PERFECT_TIME_BONUS_MS : TIME_BONUS_PER_CORRECT_MS
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + timeBonus)
          setRemainingMs(remainingMsRef.current)

          const nextScore = scoreRef.current + earned
          scoreRef.current = nextScore
          setScore(nextScore)

          phaseRef.current = 'result-correct'
          setPhase('result-correct')
          setResultFlash('correct')
          playAudio(tapHitStrongAudioRef, 0.6, 1.1 + nextStreak * 0.03)
          effects.comboHitBurst(200, 300, patLen, earned, ['✨', '🌟', '💫'])
          effects.triggerFlash('rgba(34,197,94,0.3)')
          setCharAnim('bounce')
          setTimeout(() => setCharAnim(''), 500)

          resultTimerRef.current = window.setTimeout(() => {
            setResultFlash(null)
            advanceToNextRound()
          }, RESULT_FLASH_DURATION_MS)
        }
      } else {
        // Wrong!
        streakRef.current = 0
        setStreak(0)
        if (feverActiveRef.current) {
          feverActiveRef.current = false
          feverRemainingMsRef.current = 0
          setIsFever(false)
          setFeverRemainingMs(0)
        }

        phaseRef.current = 'result-wrong'
        setPhase('result-wrong')
        setResultFlash('wrong')
        setActiveCell(cellIndex)
        playAudio(gameOverAudioRef, 0.6, 0.9)
        effects.triggerShake(10)
        effects.triggerFlash('rgba(239,68,68,0.4)')
        effects.spawnParticles(5, 200, 300)
        showFloat('MISS!', '#ef4444')
        setCharAnim('recoil')
        const missSpeeches = ['UGH!', 'NO!', 'OOPS!']
        showSpeech(missSpeeches[Math.floor(Math.random() * missSpeeches.length)])
        setTimeout(() => setCharAnim(''), 500)

        resultTimerRef.current = window.setTimeout(() => {
          setResultFlash(null)
          setActiveCell(null)
          finishGame()
        }, RESULT_FLASH_DURATION_MS)
      }
    },
    [advanceToNextRound, finishGame, playAudio, showFloat, showSpeech],
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
      clearTimeoutSafe(showTimerRef)
      clearTimeoutSafe(pauseTimerRef)
      clearTimeoutSafe(resultTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  useEffect(() => {
    patternRef.current = pattern
    startShowPhase(pattern)

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      if (feverActiveRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverActiveRef.current = false
          setIsFever(false)
          setFeverRemainingMs(0)
        }
      }

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.6, 0.85)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishGame, playAudio])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isInputPhase = phase === 'input'

  return (
    <section className="mini-game-panel pattern-lock-panel" aria-label="pattern-lock-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', padding: 0, ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .pattern-lock-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          padding: 0;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          background: linear-gradient(180deg, #0f0c3e, #1e1b4b, #312e81);
        }

        .pattern-lock-panel.fever-mode {
          animation: pl-fever-bg 0.6s ease-in-out infinite alternate;
        }

        @keyframes pl-fever-bg {
          from { box-shadow: inset 0 0 60px rgba(251,191,36,0.15); }
          to { box-shadow: inset 0 0 100px rgba(251,191,36,0.3); }
        }

        .pl-top-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 10px 16px;
          flex-shrink: 0;
          background: rgba(15,12,62,0.8);
          backdrop-filter: blur(8px);
          z-index: 10;
        }

        .pl-score {
          font-size: clamp(36px, 10vw, 52px);
          font-weight: 900;
          color: #e0e7ff;
          margin: 0;
          line-height: 1;
        }

        .pl-best {
          font-size: 13px;
          color: #64748b;
          margin: 0;
        }

        .pl-time {
          font-size: clamp(24px, 6vw, 32px);
          font-weight: 900;
          color: #c7d2fe;
          margin: 0;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          transition: color 0.3s;
        }

        .pl-time.low-time {
          color: #ef4444;
          animation: pl-time-pulse 0.5s ease infinite alternate;
        }

        @keyframes pl-time-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .pl-info-strip {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          width: 100%;
          padding: 6px 16px;
          flex-shrink: 0;
        }

        .pl-round { font-size: 16px; font-weight: 700; color: #a5b4fc; margin: 0; }
        .pl-streak { font-size: 16px; font-weight: 700; color: #fbbf24; margin: 0; }

        .pl-phase-label {
          font-size: 18px;
          font-weight: 900;
          margin: 0;
          letter-spacing: 2px;
          text-transform: uppercase;
        }

        .pl-phase-showing { color: #fbbf24; animation: pl-phase-blink 0.8s ease infinite alternate; }
        .pl-phase-input { color: #22c55e; }
        .pl-phase-correct { color: #22c55e; }
        .pl-phase-wrong { color: #ef4444; }

        @keyframes pl-phase-blink {
          from { opacity: 0.6; }
          to { opacity: 1; }
        }

        .pl-grid-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          width: 100%;
          position: relative;
        }

        .pl-grid-container {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 20px;
          border-radius: 20px;
          background: rgba(30, 27, 75, 0.7);
          border: 2px solid rgba(99, 102, 241, 0.25);
          transition: border-color 0.3s, box-shadow 0.3s;
        }

        .pl-grid-container.flash-correct {
          border-color: #22c55e;
          box-shadow: 0 0 30px rgba(34, 197, 94, 0.5), inset 0 0 20px rgba(34, 197, 94, 0.15);
          animation: pl-correct-pulse 0.45s ease-out;
        }

        .pl-grid-container.flash-wrong {
          border-color: #ef4444;
          box-shadow: 0 0 30px rgba(239, 68, 68, 0.5), inset 0 0 20px rgba(239, 68, 68, 0.15);
          animation: pattern-lock-shake 0.4s ease-out;
        }

        @keyframes pl-correct-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.04); }
          100% { transform: scale(1); }
        }

        @keyframes pattern-lock-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-8px) rotate(-1deg); }
          30% { transform: translateX(8px) rotate(1deg); }
          45% { transform: translateX(-6px); }
          60% { transform: translateX(6px); }
          75% { transform: translateX(-3px); }
        }

        .pl-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: clamp(10px, 3vw, 16px);
          width: clamp(240px, 70vw, 300px);
          height: clamp(240px, 70vw, 300px);
        }

        .pl-cell {
          position: relative;
          border-radius: 50%;
          border: 3px solid var(--cell-color-dim);
          background: rgba(15, 12, 50, 0.9);
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.15s, border-color 0.2s, box-shadow 0.2s;
          -webkit-tap-highlight-color: transparent;
          outline: none;
          aspect-ratio: 1;
        }

        .pl-cell:disabled { cursor: default; opacity: 0.6; }
        .pl-cell:not(:disabled):active { transform: scale(0.9); }

        .pl-cell-inner {
          width: 55%;
          height: 55%;
          border-radius: 50%;
          background: var(--cell-color-dim);
          transition: background 0.2s, box-shadow 0.2s, transform 0.2s;
        }

        .pl-cell.showing .pl-cell-inner {
          background: var(--cell-color);
          box-shadow: 0 0 24px var(--cell-color), 0 0 48px var(--cell-color);
          transform: scale(1.2);
        }

        .pl-cell.showing {
          border-color: var(--cell-color);
          box-shadow: 0 0 20px var(--cell-color);
          transform: scale(1.05);
        }

        .pl-cell.tapped .pl-cell-inner {
          background: var(--cell-color);
          box-shadow: 0 0 16px var(--cell-color);
          transform: scale(1.1);
        }

        .pl-cell.tapped { border-color: var(--cell-color); }

        .pl-cell.wrong {
          border-color: #ef4444 !important;
          animation: pattern-lock-shake 0.4s ease-out;
        }

        .pl-cell.wrong .pl-cell-inner {
          background: #ef4444 !important;
          box-shadow: 0 0 24px #ef4444 !important;
        }

        .pl-cell.correct .pl-cell-inner {
          background: #22c55e !important;
          box-shadow: 0 0 24px #22c55e !important;
        }

        .pl-cell.correct { border-color: #22c55e !important; }

        .pl-progress {
          display: flex;
          gap: 6px;
          justify-content: center;
          align-items: center;
          min-height: 24px;
          flex-wrap: wrap;
          max-width: 320px;
          padding: 8px 0;
          flex-shrink: 0;
        }

        .pl-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.2);
          border: 2px solid rgba(99, 102, 241, 0.4);
          transition: background 0.2s, border-color 0.2s, transform 0.2s;
        }

        .pl-dot.filled {
          background: #6366f1;
          border-color: #818cf8;
          transform: scale(1.2);
        }

        .pl-dot.current {
          border-color: #a5b4fc;
          animation: pl-dot-blink 0.6s ease-in-out infinite alternate;
        }

        @keyframes pl-dot-blink {
          from { background: rgba(99, 102, 241, 0.2); }
          to { background: rgba(99, 102, 241, 0.6); }
        }

        .pl-mascot-area {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 8px 0 12px 0;
          flex-shrink: 0;
          position: relative;
        }

        .pl-mascot {
          width: clamp(80px, 22vw, 120px);
          height: clamp(80px, 22vw, 120px);
          object-fit: contain;
          transition: filter 0.2s ease;
        }

        .pl-mascot-area.bounce .pl-mascot {
          animation: pl-char-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .pl-mascot-area.recoil .pl-mascot {
          animation: pl-char-recoil 0.4s ease;
        }

        .pl-mascot-area.dance .pl-mascot {
          animation: pl-char-dance 0.8s ease-in-out infinite;
        }

        @keyframes pl-char-bounce {
          0% { transform: scale(1) translateY(0); }
          30% { transform: scale(1.15) translateY(-10px); }
          60% { transform: scale(0.95) translateY(0); }
          100% { transform: scale(1) translateY(0); }
        }

        @keyframes pl-char-recoil {
          0% { transform: scale(1) rotate(0deg); }
          25% { transform: scale(0.85) rotate(-8deg); }
          50% { transform: scale(0.85) rotate(8deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        @keyframes pl-char-dance {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-5px) rotate(-3deg); }
          75% { transform: translateY(-5px) rotate(3deg); }
        }

        .pl-speech {
          position: absolute;
          top: -8px;
          left: 50%;
          transform: translateX(-50%);
          background: #fff;
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          padding: 3px 12px;
          font-size: 13px;
          font-weight: 800;
          white-space: nowrap;
          z-index: 5;
          animation: pl-speech-pop 0.6s ease-out forwards;
          pointer-events: none;
          color: #1f2937;
        }

        @keyframes pl-speech-pop {
          0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.5); }
          25% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.1); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-16px) scale(0.7); }
        }

        .pl-floating-text {
          position: absolute;
          top: 30%;
          left: 50%;
          transform: translateX(-50%);
          font-size: clamp(24px, 7vw, 36px);
          font-weight: 900;
          pointer-events: none;
          animation: pl-float-up 0.8s ease-out forwards;
          z-index: 15;
        }

        @keyframes pl-float-up {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(0.8); }
          30% { opacity: 1; transform: translateX(-50%) translateY(-20px) scale(1.2); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-60px) scale(0.7); }
        }

        .pl-fever-banner {
          position: absolute;
          top: 80px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          background-size: 200% 100%;
          animation: pl-fever-slide 1s linear infinite, pl-fever-pulse 0.4s ease-in-out infinite alternate;
          color: #fff;
          font-size: 18px;
          font-weight: 900;
          padding: 6px 24px;
          border-radius: 16px;
          z-index: 30;
          letter-spacing: 3px;
          pointer-events: none;
        }

        @keyframes pl-fever-slide {
          from { background-position: 0% 0; }
          to { background-position: 200% 0; }
        }

        @keyframes pl-fever-pulse {
          from { transform: translateX(-50%) scale(1); }
          to { transform: translateX(-50%) scale(1.08); }
        }

        .pl-fever-timer {
          width: 80%;
          height: 3px;
          background: rgba(255,255,255,0.3);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 4px;
        }

        .pl-fever-timer-fill {
          height: 100%;
          background: linear-gradient(90deg, #fbbf24, #ef4444);
          border-radius: 2px;
          transition: width 0.1s linear;
        }
      `}</style>

      {/* Top bar */}
      <div className="pl-top-bar">
        <div>
          <p className="pl-score">{score}</p>
          <p className="pl-best">BEST {displayedBestScore}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className={`pl-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      {/* Info strip */}
      <div className="pl-info-strip">
        <p className="pl-round">R{round}</p>
        {streak >= 2 && <p className="pl-streak">x{streak}</p>}
        <p className={`pl-phase-label ${phase === 'showing' ? 'pl-phase-showing' : phase === 'input' ? 'pl-phase-input' : phase === 'result-correct' ? 'pl-phase-correct' : 'pl-phase-wrong'}`}>
          {phase === 'showing' && 'WATCH'}
          {phase === 'input' && 'GO!'}
          {phase === 'result-correct' && 'CLEAR!'}
          {phase === 'result-wrong' && 'MISS!'}
        </p>
        <p style={{ fontSize: '14px', color: '#94a3b8', margin: 0 }}>{pattern.length} tiles</p>
      </div>

      {/* Fever banner */}
      {isFever && (
        <div className="pl-fever-banner">
          FEVER x{FEVER_MULTIPLIER}
          <div className="pl-fever-timer">
            <div className="pl-fever-timer-fill" style={{ width: `${(feverRemainingMs / FEVER_DURATION_MS) * 100}%` }} />
          </div>
        </div>
      )}

      {/* Grid area - fills remaining space */}
      <div className="pl-grid-area">
        {/* Floating text */}
        {floatingText !== null && (
          <span key={floatingText.key} className="pl-floating-text" style={{ color: floatingText.color }}>
            {floatingText.text}
          </span>
        )}

        <div className={`pl-grid-container ${resultFlash === 'correct' ? 'flash-correct' : resultFlash === 'wrong' ? 'flash-wrong' : ''}`}>
          <div className="pl-grid">
            {Array.from({ length: CELL_COUNT }, (_, cellIndex) => {
              const isActive = activeCell === cellIndex
              const isShowingPhase = phase === 'showing'
              const isResultWrong = phase === 'result-wrong' && activeCell === cellIndex
              const isResultCorrect = phase === 'result-correct'
              const cellColor = CELL_COLORS[cellIndex]

              let cellClass = 'pl-cell'
              if (isActive && isShowingPhase) cellClass += ' showing'
              if (isActive && isInputPhase) cellClass += ' tapped'
              if (isResultWrong) cellClass += ' wrong'
              if (isResultCorrect && isActive) cellClass += ' correct'

              return (
                <button
                  className={cellClass}
                  key={cellIndex}
                  type="button"
                  disabled={!isInputPhase}
                  onClick={() => handleCellTap(cellIndex)}
                  style={{ '--cell-color': cellColor, '--cell-color-dim': `${cellColor}33` } as React.CSSProperties}
                />
              )
            })}
          </div>
        </div>

        {/* Progress dots */}
        <div className="pl-progress">
          {pattern.map((_, idx) => (
            <span key={idx} className={`pl-dot ${idx < inputIndex ? 'filled' : ''} ${idx === inputIndex && isInputPhase ? 'current' : ''}`} />
          ))}
        </div>
      </div>

      {/* Character */}
      <div className={`pl-mascot-area ${charAnim} ${isFever ? 'dance' : ''}`}>
        {charSpeech !== null && (
          <span key={charSpeech.key} className="pl-speech">{charSpeech.text}</span>
        )}
        <img
          src={taeJinaImg}
          alt="Tae Jina"
          className="pl-mascot"
          draggable={false}
          style={{
            filter: isFever ? 'brightness(1.3) drop-shadow(0 0 12px rgba(251,191,36,0.5))'
              : resultFlash === 'correct' ? 'brightness(1.2) drop-shadow(0 0 8px rgba(34,197,94,0.4))'
              : resultFlash === 'wrong' ? 'grayscale(0.5) brightness(0.7)'
              : 'drop-shadow(0 2px 6px rgba(0,0,0,0.3))',
          }}
        />
      </div>

      {streak >= 3 && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: '60px', left: '50%', transform: 'translateX(-50%)', fontSize: `${16 + streak * 2}px`, color: getComboColor(streak), zIndex: 20 }}>
          {getComboLabel(streak)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const patternLockModule: MiniGameModule = {
  manifest: {
    id: 'pattern-lock',
    title: 'Pattern Lock',
    description: 'Remember growing patterns and repeat!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.3,
    accentColor: '#6366f1',
  },
  Component: PatternLockGame,
}
