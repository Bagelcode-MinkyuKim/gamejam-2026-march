import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import taeJinaImg from '../../../assets/images/same-character/tae-jina.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const GRID_SIZE = 3
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const SCORE_PER_CORRECT = 10
const BASE_SHOW_INTERVAL_MS = 600
const MIN_SHOW_INTERVAL_MS = 200
const SHOW_INTERVAL_DECAY = 0.92
const PAUSE_BETWEEN_PHASES_MS = 400
const CELL_HIGHLIGHT_LINGER_MS = 280
const RESULT_FLASH_DURATION_MS = 500
const LOW_TIME_THRESHOLD_MS = 5000

type GamePhase = 'showing' | 'input' | 'result-correct' | 'result-wrong'

const CELL_COLORS = [
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#6366f1',
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
  const lowTimeSecondRef = useRef<number | null>(null)

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
    clearTimeoutSafe(showTimerRef)
    clearTimeoutSafe(pauseTimerRef)
    clearTimeoutSafe(resultTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const startShowPhase = useCallback(
    (nextPattern: number[]) => {
      if (finishedRef.current) {
        return
      }

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
        if (finishedRef.current) {
          return
        }

        if (currentShowStep < nextPattern.length) {
          const cellToShow = nextPattern[currentShowStep]
          setActiveCell(cellToShow)
          showIndexRef.current = currentShowStep
          setShowIndex(currentShowStep)

          const lingerTimeout = Math.min(interval * 0.7, CELL_HIGHLIGHT_LINGER_MS)
          showTimerRef.current = window.setTimeout(() => {
            setActiveCell(null)
            currentShowStep += 1

            showTimerRef.current = window.setTimeout(() => {
              showNext()
            }, interval * 0.3)
          }, lingerTimeout)
        } else {
          pauseTimerRef.current = window.setTimeout(() => {
            if (finishedRef.current) {
              return
            }

            phaseRef.current = 'input'
            setPhase('input')
            inputIndexRef.current = 0
            setInputIndex(0)
            setActiveCell(null)
          }, PAUSE_BETWEEN_PHASES_MS)
        }
      }

      pauseTimerRef.current = window.setTimeout(() => {
        showNext()
      }, PAUSE_BETWEEN_PHASES_MS)
    },
    [],
  )

  const advanceToNextRound = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    const currentPattern = patternRef.current
    const lastCell = currentPattern[currentPattern.length - 1]
    const newCell = pickRandomCell(lastCell)
    const nextPattern = [...currentPattern, newCell]
    setRound((prev) => prev + 1)
    startShowPhase(nextPattern)
  }, [startShowPhase])

  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (finishedRef.current) {
        return
      }

      if (phaseRef.current !== 'input') {
        return
      }

      const expected = patternRef.current[inputIndexRef.current]
      if (cellIndex === expected) {
        const nextInputIndex = inputIndexRef.current + 1
        inputIndexRef.current = nextInputIndex
        setInputIndex(nextInputIndex)
        setActiveCell(cellIndex)

        const pitchScale = 1 + nextInputIndex * 0.04
        playAudio(tapHitAudioRef, 0.5, pitchScale)

        showTimerRef.current = window.setTimeout(() => {
          setActiveCell(null)
        }, CELL_HIGHLIGHT_LINGER_MS * 0.6)

        if (nextInputIndex === patternRef.current.length) {
          const nextScore = scoreRef.current + SCORE_PER_CORRECT
          scoreRef.current = nextScore
          setScore(nextScore)

          phaseRef.current = 'result-correct'
          setPhase('result-correct')
          setResultFlash('correct')
          playAudio(tapHitStrongAudioRef, 0.6, 1.1)
          effects.comboHitBurst(120, 120, patternRef.current.length, SCORE_PER_CORRECT, ['✨', '🌟', '💫'])

          resultTimerRef.current = window.setTimeout(() => {
            setResultFlash(null)
            advanceToNextRound()
          }, RESULT_FLASH_DURATION_MS)
        }
      } else {
        phaseRef.current = 'result-wrong'
        setPhase('result-wrong')
        setResultFlash('wrong')
        setActiveCell(cellIndex)
        playAudio(gameOverAudioRef, 0.6, 0.9)
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.35)')

        resultTimerRef.current = window.setTimeout(() => {
          setResultFlash(null)
          setActiveCell(null)
          finishGame()
        }, RESULT_FLASH_DURATION_MS)
      }
    },
    [advanceToNextRound, finishGame, playAudio],
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
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  useEffect(() => {
    patternRef.current = pattern
    startShowPhase(pattern)

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

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
        }
      } else {
        lowTimeSecondRef.current = null
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
  const patternProgress = isInputPhase ? `${inputIndex} / ${pattern.length}` : `${pattern.length}칸`

  return (
    <section className="mini-game-panel pattern-lock-panel" aria-label="pattern-lock-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div className="pattern-lock-score-strip">
        <p className="pattern-lock-score">{score.toLocaleString()}</p>
        <p className="pattern-lock-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`pattern-lock-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="pattern-lock-meta-row">
        <p className="pattern-lock-round">
          라운드 <strong>{round}</strong>
        </p>
        <p className="pattern-lock-pattern-length">
          패턴 <strong>{patternProgress}</strong>
        </p>
        <p className="pattern-lock-phase-label">
          {phase === 'showing' && '기억하세요!'}
          {phase === 'input' && '따라하세요!'}
          {phase === 'result-correct' && '정답!'}
          {phase === 'result-wrong' && '틀렸습니다!'}
        </p>
      </div>

      <div
        className={`pattern-lock-grid-container ${
          resultFlash === 'correct' ? 'flash-correct' : resultFlash === 'wrong' ? 'flash-wrong' : ''
        }`}
      >
        <div className="pattern-lock-grid">
          {Array.from({ length: CELL_COUNT }, (_, cellIndex) => {
            const isActive = activeCell === cellIndex
            const isShowingPhase = phase === 'showing'
            const isResultWrong = phase === 'result-wrong' && activeCell === cellIndex
            const isResultCorrect = phase === 'result-correct'
            const cellColor = CELL_COLORS[cellIndex]

            const isAlreadyInput = isInputPhase && cellIndex < inputIndex
              ? patternRef.current.slice(0, inputIndex).includes(cellIndex)
              : false

            let cellClass = 'pattern-lock-cell'
            if (isActive && isShowingPhase) {
              cellClass += ' showing'
            }
            if (isActive && isInputPhase) {
              cellClass += ' tapped'
            }
            if (isResultWrong) {
              cellClass += ' wrong'
            }
            if (isResultCorrect && isActive) {
              cellClass += ' correct'
            }

            return (
              <button
                className={cellClass}
                key={cellIndex}
                type="button"
                disabled={!isInputPhase}
                onClick={() => handleCellTap(cellIndex)}
                style={{
                  '--cell-color': cellColor,
                  '--cell-color-dim': `${cellColor}33`,
                } as React.CSSProperties}
                aria-label={`Cell ${cellIndex + 1}`}
              >
                <span className="pattern-lock-cell-inner" />
              </button>
            )
          })}
        </div>
      </div>

      <div className="pattern-lock-mascot-row">
        <img src={taeJinaImg} alt="태진아" className="pattern-lock-mascot" draggable={false} />
      </div>

      <div className="pattern-lock-input-progress">
        {pattern.map((_, idx) => (
          <span
            className={`pattern-lock-dot ${idx < inputIndex ? 'filled' : ''} ${
              idx === inputIndex && isInputPhase ? 'current' : ''
            }`}
            key={idx}
          />
        ))}
      </div>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>

      <style>{GAME_EFFECTS_CSS}
      {`
        .pattern-lock-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 12px 8px;
          width: 100%;
          box-sizing: border-box;
        }

        .pattern-lock-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          max-width: 340px;
          padding: 0 4px;
        }

        .pattern-lock-score {
          font-size: 28px;
          font-weight: 800;
          color: #e0e7ff;
          margin: 0;
          text-shadow: 0 0 12px rgba(99, 102, 241, 0.5);
        }

        .pattern-lock-best {
          font-size: 12px;
          color: #94a3b8;
          margin: 0;
        }

        .pattern-lock-time {
          font-size: 18px;
          font-weight: 700;
          color: #c7d2fe;
          margin: 0;
          transition: color 0.3s;
        }

        .pattern-lock-time.low-time {
          color: #ef4444;
          animation: pattern-lock-pulse-red 0.5s ease-in-out infinite alternate;
        }

        @keyframes pattern-lock-pulse-red {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .pattern-lock-meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          max-width: 340px;
          padding: 0 4px;
        }

        .pattern-lock-meta-row p {
          margin: 0;
          font-size: 13px;
          color: #94a3b8;
        }

        .pattern-lock-meta-row strong {
          color: #c7d2fe;
        }

        .pattern-lock-phase-label {
          font-weight: 600;
          color: #a5b4fc !important;
          font-size: 14px !important;
        }

        .pattern-lock-grid-container {
          display: flex;
          justify-content: center;
          align-items: center;
          padding: 16px;
          border-radius: 16px;
          background: rgba(30, 27, 75, 0.6);
          border: 2px solid rgba(99, 102, 241, 0.2);
          transition: border-color 0.3s, box-shadow 0.3s;
        }

        .pattern-lock-grid-container.flash-correct {
          border-color: #22c55e;
          box-shadow: 0 0 24px rgba(34, 197, 94, 0.4), inset 0 0 16px rgba(34, 197, 94, 0.1);
          animation: pattern-lock-correct-pulse 0.5s ease-out;
        }

        .pattern-lock-grid-container.flash-wrong {
          border-color: #ef4444;
          box-shadow: 0 0 24px rgba(239, 68, 68, 0.4), inset 0 0 16px rgba(239, 68, 68, 0.1);
          animation: pattern-lock-shake 0.4s ease-out;
        }

        @keyframes pattern-lock-correct-pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }

        @keyframes pattern-lock-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-6px); }
          30% { transform: translateX(6px); }
          45% { transform: translateX(-4px); }
          60% { transform: translateX(4px); }
          75% { transform: translateX(-2px); }
          90% { transform: translateX(2px); }
        }

        .pattern-lock-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          width: 240px;
          height: 240px;
        }

        .pattern-lock-cell {
          position: relative;
          width: 68px;
          height: 68px;
          border-radius: 50%;
          border: 3px solid var(--cell-color-dim);
          background: rgba(15, 12, 50, 0.8);
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.15s, border-color 0.2s, box-shadow 0.2s;
          -webkit-tap-highlight-color: transparent;
          outline: none;
        }

        .pattern-lock-cell:disabled {
          cursor: default;
          opacity: 0.7;
        }

        .pattern-lock-cell:not(:disabled):active {
          transform: scale(0.92);
        }

        .pattern-lock-cell-inner {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: var(--cell-color-dim);
          transition: background 0.2s, box-shadow 0.2s, transform 0.2s;
        }

        .pattern-lock-cell.showing .pattern-lock-cell-inner {
          background: var(--cell-color);
          box-shadow: 0 0 20px var(--cell-color), 0 0 40px var(--cell-color);
          transform: scale(1.15);
        }

        .pattern-lock-cell.showing {
          border-color: var(--cell-color);
          box-shadow: 0 0 16px var(--cell-color);
        }

        .pattern-lock-cell.tapped .pattern-lock-cell-inner {
          background: var(--cell-color);
          box-shadow: 0 0 14px var(--cell-color);
          transform: scale(1.1);
        }

        .pattern-lock-cell.tapped {
          border-color: var(--cell-color);
        }

        .pattern-lock-cell.wrong {
          border-color: #ef4444 !important;
          animation: pattern-lock-shake 0.4s ease-out;
        }

        .pattern-lock-cell.wrong .pattern-lock-cell-inner {
          background: #ef4444 !important;
          box-shadow: 0 0 20px #ef4444 !important;
        }

        .pattern-lock-cell.correct .pattern-lock-cell-inner {
          background: #22c55e !important;
          box-shadow: 0 0 20px #22c55e !important;
        }

        .pattern-lock-cell.correct {
          border-color: #22c55e !important;
        }

        .pattern-lock-input-progress {
          display: flex;
          gap: 6px;
          justify-content: center;
          align-items: center;
          min-height: 20px;
          flex-wrap: wrap;
          max-width: 300px;
        }

        .pattern-lock-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(99, 102, 241, 0.2);
          border: 1.5px solid rgba(99, 102, 241, 0.4);
          transition: background 0.2s, border-color 0.2s, transform 0.2s;
        }

        .pattern-lock-dot.filled {
          background: #6366f1;
          border-color: #818cf8;
          transform: scale(1.15);
        }

        .pattern-lock-dot.current {
          border-color: #a5b4fc;
          animation: pattern-lock-dot-blink 0.6s ease-in-out infinite alternate;
        }

        @keyframes pattern-lock-dot-blink {
          from { background: rgba(99, 102, 241, 0.2); }
          to { background: rgba(99, 102, 241, 0.6); }
        }

        .pattern-lock-mascot-row {
          display: flex;
          justify-content: center;
          padding: 4px 0;
        }

        .pattern-lock-mascot {
          width: 80px;
          height: 80px;
          object-fit: contain;
          border-radius: 50%;
          border: 2px solid #6366f1;
          background: rgba(99, 102, 241, 0.1);
          opacity: 0.9;
        }
      `}</style>
    </section>
  )
}

export const patternLockModule: MiniGameModule = {
  manifest: {
    id: 'pattern-lock',
    title: 'Pattern Lock',
    description: '점점 길어지는 패턴을 기억하고 정확히 따라하라!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.3,
    accentColor: '#6366f1',
  },
  Component: PatternLockGame,
}
