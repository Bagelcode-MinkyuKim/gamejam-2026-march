import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import characterImg from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 30000
const GRID_SIZE = 4
const GRID_CELL_COUNT = GRID_SIZE * GRID_SIZE
const SCORE_CORRECT = 3
const SCORE_WRONG = -1
const INITIAL_POOL_SIZE = 8
const POOL_GROWTH_PER_ROUND = 2
const MAX_POOL_SIZE = 24
const FEEDBACK_DURATION_MS = 300
const SHUFFLE_ANIMATION_MS = 200
const LOW_TIME_THRESHOLD_MS = 5000

// --- Gimmick constants ---
const COMBO_MULTIPLIER_STEP = 0.3
const SPEED_BONUS_THRESHOLD_MS = 2000
const SPEED_BONUS_POINTS = 3
const TIME_BONUS_PER_CORRECT_MS = 200
const FEVER_COMBO_THRESHOLD = 6
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 2

const EMOJI_POOL: string[] = [
  '\u{1F600}', '\u{1F60E}', '\u{1F929}', '\u{1F631}', '\u{1F973}', '\u{1F634}',
  '\u{1F914}', '\u{1F624}', '\u{1F976}', '\u{1F92F}', '\u{1F608}', '\u{1F47B}',
  '\u{1F480}', '\u{1F916}', '\u{1F47D}', '\u{1F383}', '\u{1F436}', '\u{1F431}',
  '\u{1F43C}', '\u{1F98A}', '\u{1F438}', '\u{1F981}', '\u{1F427}', '\u{1F419}',
]

function pickRandom(array: string[]): string {
  return array[Math.floor(Math.random() * array.length)]
}

function buildGrid(targetEmoji: string, poolSize: number): string[] {
  const availablePool = EMOJI_POOL.slice(0, poolSize)
  const distractors = availablePool.filter((e) => e !== targetEmoji)
  const targetIndex = Math.floor(Math.random() * GRID_CELL_COUNT)

  const cells: string[] = []
  for (let i = 0; i < GRID_CELL_COUNT; i += 1) {
    if (i === targetIndex) {
      cells.push(targetEmoji)
    } else {
      cells.push(pickRandom(distractors))
    }
  }

  return cells
}

function pickNewTarget(currentTarget: string, poolSize: number): string {
  const pool = EMOJI_POOL.slice(0, poolSize)
  const candidates = pool.filter((e) => e !== currentTarget)
  return pickRandom(candidates.length > 0 ? candidates : pool)
}

function computePoolSize(round: number): number {
  return Math.min(MAX_POOL_SIZE, INITIAL_POOL_SIZE + (round - 1) * POOL_GROWTH_PER_ROUND)
}

type CellFeedback = { index: number; kind: 'correct' | 'wrong' }

function EmojiMatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [round, setRound] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [targetEmoji, setTargetEmoji] = useState(() => pickRandom(EMOJI_POOL.slice(0, INITIAL_POOL_SIZE)))
  const [grid, setGrid] = useState<string[]>(() => buildGrid(targetEmoji, INITIAL_POOL_SIZE))
  const [cellFeedback, setCellFeedback] = useState<CellFeedback | null>(null)
  const [isShuffling, setIsShuffling] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [bonusText, setBonusText] = useState('')

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const roundRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const targetEmojiRef = useRef(targetEmoji)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const lastCorrectAtRef = useRef(0)
  const bonusTextTimerRef = useRef<number | null>(null)

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

  const showBonus = useCallback((text: string) => {
    setBonusText(text)
    clearTimeoutSafe(bonusTextTimerRef)
    bonusTextTimerRef.current = window.setTimeout(() => {
      bonusTextTimerRef.current = null
      setBonusText('')
    }, 1000)
  }, [])

  const advanceRound = useCallback(() => {
    const nextRound = roundRef.current + 1
    roundRef.current = nextRound
    setRound(nextRound)

    const nextPoolSize = computePoolSize(nextRound)
    const nextTarget = pickNewTarget(targetEmojiRef.current, nextPoolSize)
    targetEmojiRef.current = nextTarget
    setTargetEmoji(nextTarget)

    setIsShuffling(true)
    const nextGrid = buildGrid(nextTarget, nextPoolSize)
    setTimeout(() => {
      setGrid(nextGrid)
      setIsShuffling(false)
    }, SHUFFLE_ANIMATION_MS)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(feedbackTimerRef)
    clearTimeoutSafe(bonusTextTimerRef)
    playAudio(gameOverAudioRef, 0.64, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (finishedRef.current || isShuffling) return

      const tappedEmoji = grid[cellIndex]
      const isCorrect = tappedEmoji === targetEmojiRef.current

      if (isCorrect) {
        const now = performance.now()
        const timeSinceLastCorrect = now - lastCorrectAtRef.current
        lastCorrectAtRef.current = now

        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        // Combo multiplier
        const comboMult = 1 + nextCombo * COMBO_MULTIPLIER_STEP
        const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1

        // Speed bonus
        const isSpeedBonus = timeSinceLastCorrect > 0 && timeSinceLastCorrect < SPEED_BONUS_THRESHOLD_MS
        const speedBonus = isSpeedBonus ? SPEED_BONUS_POINTS : 0

        const totalPoints = Math.round((SCORE_CORRECT + speedBonus) * comboMult * feverMult)
        const nextScore = scoreRef.current + totalPoints
        scoreRef.current = nextScore
        setScore(nextScore)

        // Time bonus
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CORRECT_MS)

        // Fever activation
        if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playAudio(tapHitStrongAudioRef, 0.7, 1.4)
        }

        const bonusParts: string[] = [`+${totalPoints}`]
        if (isSpeedBonus) bonusParts.push('FAST!')
        if (comboMult > 1.3) bonusParts.push(`x${comboMult.toFixed(1)}`)
        if (isFeverRef.current && nextCombo === FEVER_COMBO_THRESHOLD) bonusParts.push('FEVER!')
        if (bonusParts.length > 1) showBonus(bonusParts.join(' '))

        playAudio(tapHitStrongAudioRef, 0.5, 1 + Math.min(0.3, nextCombo * 0.03))
        effects.triggerFlash()
        effects.spawnParticles(4, 200, 200)

        setCellFeedback({ index: cellIndex, kind: 'correct' })
        clearTimeoutSafe(feedbackTimerRef)
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null
          setCellFeedback(null)
          advanceRound()
        }, FEEDBACK_DURATION_MS)
      } else {
        comboRef.current = 0
        setCombo(0)

        const nextScore = Math.max(0, scoreRef.current + SCORE_WRONG)
        scoreRef.current = nextScore
        setScore(nextScore)

        playAudio(tapHitAudioRef, 0.4, 0.85)
        effects.triggerShake(4)
        effects.triggerFlash('rgba(239,68,68,0.4)')

        setCellFeedback({ index: cellIndex, kind: 'wrong' })
        clearTimeoutSafe(feedbackTimerRef)
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null
          setCellFeedback(null)
        }, FEEDBACK_DURATION_MS)
      }
    },
    [grid, isShuffling, playAudio, advanceRound, showBonus],
  )

  const handleExit = useCallback(() => {
    playAudio(tapHitAudioRef, 0.42, 1.02)
    onExit()
  }, [onExit, playAudio])

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
      clearTimeoutSafe(bonusTextTimerRef)
      effects.cleanup()
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
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

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Fever timer
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
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
    }
  }, [finishGame])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const poolSize = computePoolSize(round)
  const comboMult = 1 + combo * COMBO_MULTIPLIER_STEP

  return (
    <section className="mini-game-panel emoji-match-panel" aria-label="emoji-match-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}

        .emoji-match-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #fbbf24 0%, #fef3c7 25%, #fffbeb 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .em-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px 8px;
          background: linear-gradient(180deg, #f59e0b, #d97706);
          color: white;
        }

        .em-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 3px solid #fde68a;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .em-score {
          margin: 0;
          font-size: 24px;
          font-weight: 800;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .em-best {
          margin: 0;
          font-size: 9px;
          color: rgba(255,255,255,0.7);
        }

        .em-time {
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .em-time.low-time {
          color: #fef2f2;
          animation: em-pulse 0.3s infinite alternate;
        }

        .em-meta {
          display: flex;
          justify-content: center;
          gap: 14px;
          padding: 6px 12px;
          background: rgba(245,158,11,0.1);
          font-size: 12px;
          color: #92400e;
        }

        .em-meta p { margin: 0; }
        .em-meta strong { font-size: 14px; color: #d97706; }

        .em-fever {
          text-align: center;
          font-size: 15px;
          font-weight: 900;
          color: #fff;
          margin: 0;
          padding: 4px 0;
          background: linear-gradient(90deg, #ef4444, #f59e0b, #ef4444);
          letter-spacing: 4px;
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
          animation: em-fever-flash 0.3s infinite alternate;
        }

        .em-bonus {
          text-align: center;
          font-size: 14px;
          font-weight: 800;
          color: #d97706;
          margin: 0;
          padding: 2px 0;
          text-shadow: 0 0 8px rgba(217,119,6,0.4);
          animation: em-bonus-pop 0.4s ease-out;
        }

        .em-target-area {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 10px 16px;
          margin: 6px 14px;
          background: #fff;
          border-radius: 16px;
          border: 3px solid #fbbf24;
          box-shadow: 0 4px 16px rgba(251,191,36,0.25);
        }

        .em-target-label {
          margin: 0;
          font-size: 13px;
          font-weight: 800;
          color: #92400e;
          letter-spacing: 2px;
        }

        .em-target-emoji {
          margin: 0;
          font-size: 42px;
          filter: drop-shadow(0 2px 6px rgba(0,0,0,0.2));
          animation: em-target-bounce 0.4s ease-out;
        }

        .em-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          gap: 8px;
          padding: 8px 16px;
          align-content: center;
          transition: opacity 0.15s;
        }

        .em-grid.shuffling {
          opacity: 0.3;
          transform: scale(0.95);
        }

        .em-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1;
          border: 2px solid #e5e7eb;
          border-radius: 14px;
          background: #fff;
          cursor: pointer;
          transition: all 0.1s;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
          padding: 0;
          touch-action: manipulation;
        }

        .em-cell:active:not(:disabled) {
          transform: scale(0.9);
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }

        .em-cell:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .em-cell-correct {
          background: #dcfce7 !important;
          border-color: #22c55e !important;
          box-shadow: 0 0 16px rgba(34,197,94,0.5) !important;
          transform: scale(1.1);
        }

        .em-cell-wrong {
          background: #fef2f2 !important;
          border-color: #ef4444 !important;
          box-shadow: 0 0 12px rgba(239,68,68,0.3) !important;
          animation: em-shake 0.2s ease-out;
        }

        .em-cell-emoji {
          font-size: 28px;
          pointer-events: none;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15));
        }

        .em-footer {
          padding: 6px 12px 10px;
          text-align: center;
        }

        @keyframes em-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.08); }
        }

        @keyframes em-fever-flash {
          from { opacity: 0.8; }
          to { opacity: 1; }
        }

        @keyframes em-bonus-pop {
          0% { transform: scale(0.5) translateY(6px); opacity: 0; }
          60% { transform: scale(1.15) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        @keyframes em-target-bounce {
          0% { transform: scale(0.6); }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }

        @keyframes em-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
      `}</style>

      {/* Header */}
      <div className="em-header">
        <img className="em-avatar" src={characterImg} alt="Character" />
        <div style={{ flex: 1 }}>
          <p className="em-score">{score.toLocaleString()}</p>
          <p className="em-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`em-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      {/* Meta */}
      <div className="em-meta">
        <p>COMBO <strong>{combo}</strong></p>
        <p>RD <strong>{round}</strong></p>
        {comboMult > 1.3 && <p style={{ color: '#e11d48', fontWeight: 'bold' }}>x{comboMult.toFixed(1)}</p>}
      </div>

      {/* Fever */}
      {isFever && <p className="em-fever">FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)</p>}

      {/* Bonus text */}
      {bonusText && <p className="em-bonus">{bonusText}</p>}

      {/* Target */}
      <div className="em-target-area">
        <p className="em-target-label">FIND</p>
        <p className="em-target-emoji" key={targetEmoji}>{targetEmoji}</p>
      </div>

      {/* Grid */}
      <div className={`em-grid ${isShuffling ? 'shuffling' : ''}`} role="grid">
        {grid.map((emoji, index) => {
          const isFeedbackTarget = cellFeedback?.index === index
          const feedbackClass = isFeedbackTarget
            ? cellFeedback.kind === 'correct' ? 'em-cell-correct' : 'em-cell-wrong'
            : ''
          return (
            <button
              className={`em-cell ${feedbackClass}`}
              key={`cell-${index}`}
              type="button"
              onClick={() => handleCellTap(index)}
              disabled={finishedRef.current || isShuffling || (cellFeedback !== null && cellFeedback.kind === 'correct')}
            >
              <span className="em-cell-emoji">{emoji}</span>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="em-footer">
        <button className="text-button" type="button" onClick={handleExit}>Hub</button>
      </div>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const emojiMatchModule: MiniGameModule = {
  manifest: {
    id: 'emoji-match',
    title: 'Emoji Match',
    description: '\uD0C0\uAC9F \uC774\uBAA8\uC9C0\uB97C \uADF8\uB9AC\uB4DC\uC5D0\uC11C \uBE60\uB974\uAC8C \uCC3E\uC544\uB77C!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#fbbf24',
  },
  Component: EmojiMatchGame,
}
