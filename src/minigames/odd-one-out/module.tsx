import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const TIME_PENALTY_MS = 2000
const TIME_BONUS_THRESHOLD_MS = 3000
const TIME_BONUS_MS = 1500
const LOW_TIME_THRESHOLD_MS = 5000
const FLASH_DURATION_MS = 300

const GRID_PROGRESSION = [4, 5, 6] as const
const ROUNDS_PER_GRID = 3

const BASE_HUE_SHIFT = 40
const MIN_HUE_SHIFT = 6
const HUE_SHIFT_DECAY = 2.5

const FEVER_STREAK_THRESHOLD = 5
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const STREAK_BONUS_STEP = 3

const SHAPE_TYPES = ['circle', 'square', 'diamond', 'triangle'] as const
type ShapeType = (typeof SHAPE_TYPES)[number]

interface CellData {
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
  readonly shape: ShapeType
  readonly isOdd: boolean
}

function generateRound(gridSize: number, round: number): { cells: CellData[]; oddIndex: number } {
  const totalCells = gridSize * gridSize
  const oddIndex = Math.floor(Math.random() * totalCells)

  const baseHue = Math.floor(Math.random() * 360)
  const baseSaturation = 60 + Math.floor(Math.random() * 25)
  const baseLightness = 45 + Math.floor(Math.random() * 20)

  const hueShift = Math.max(MIN_HUE_SHIFT, BASE_HUE_SHIFT - round * HUE_SHIFT_DECAY)
  const shiftDirection = Math.random() > 0.5 ? 1 : -1
  const oddHue = (baseHue + hueShift * shiftDirection + 360) % 360

  const shape = SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)]

  const cells: CellData[] = []
  for (let i = 0; i < totalCells; i += 1) {
    const isOdd = i === oddIndex
    cells.push({
      hue: isOdd ? oddHue : baseHue,
      saturation: baseSaturation,
      lightness: baseLightness,
      shape,
      isOdd,
    })
  }

  return { cells, oddIndex }
}

function toGridSize(round: number): number {
  const gridIndex = Math.min(Math.floor(round / ROUNDS_PER_GRID), GRID_PROGRESSION.length - 1)
  return GRID_PROGRESSION[gridIndex]
}

function cellColor(cell: CellData): string {
  return `hsl(${cell.hue}, ${cell.saturation}%, ${cell.lightness}%)`
}

function ShapeCell({ cell, size, onClick }: { cell: CellData; size: number; onClick: () => void }) {
  const color = cellColor(cell)
  const innerSize = size * 0.72
  const shapeStyle: React.CSSProperties = {
    width: innerSize,
    height: innerSize,
    backgroundColor: color,
  }

  let shapeClassName = 'odd-one-out-shape'
  switch (cell.shape) {
    case 'circle':
      shapeClassName += ' odd-one-out-shape-circle'
      break
    case 'square':
      shapeClassName += ' odd-one-out-shape-square'
      break
    case 'diamond':
      shapeClassName += ' odd-one-out-shape-diamond'
      break
    case 'triangle':
      shapeClassName += ' odd-one-out-shape-triangle'
      break
  }

  return (
    <button
      className="odd-one-out-cell"
      type="button"
      onClick={onClick}
      style={{ width: size, height: size }}
    >
      {cell.shape === 'triangle' ? (
        <div
          className={shapeClassName}
          style={{
            width: 0,
            height: 0,
            borderLeft: `${innerSize * 0.5}px solid transparent`,
            borderRight: `${innerSize * 0.5}px solid transparent`,
            borderBottom: `${innerSize * 0.86}px solid ${color}`,
            backgroundColor: 'transparent',
          }}
        />
      ) : (
        <div className={shapeClassName} style={shapeStyle} />
      )}
    </button>
  )
}

function OddOneOutGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [round, setRound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [cells, setCells] = useState<CellData[]>([])
  const [gridSize, setGridSize] = useState<number>(GRID_PROGRESSION[0])
  const [flashState, setFlashState] = useState<'none' | 'correct' | 'wrong'>('none')
  const [roundStartTime, setRoundStartTime] = useState(0)
  const [streak, setStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const roundRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const roundStartTimeRef = useRef(0)
  const interactableRef = useRef(true)
  const streakRef = useRef(0)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)

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

  const startNewRound = useCallback(
    (nextRound: number) => {
      const nextGridSize = toGridSize(nextRound)
      const { cells: nextCells } = generateRound(nextGridSize, nextRound)

      roundRef.current = nextRound
      setRound(nextRound)
      setGridSize(nextGridSize)
      setCells(nextCells)
      interactableRef.current = true

      const now = window.performance.now()
      roundStartTimeRef.current = now
      setRoundStartTime(now)
    },
    [],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(flashTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.64, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleCellTap = useCallback(
    (index: number) => {
      if (finishedRef.current || !interactableRef.current) {
        return
      }

      const tappedCell = cells[index]
      if (!tappedCell) {
        return
      }

      interactableRef.current = false

      if (tappedCell.isOdd) {
        const now = window.performance.now()
        const solveTimeMs = now - roundStartTimeRef.current

        const nextStreak = streakRef.current + 1
        streakRef.current = nextStreak
        setStreak(nextStreak)

        // Streak multiplier: +1 per STREAK_BONUS_STEP streak
        const streakMultiplier = 1 + Math.floor(nextStreak / STREAK_BONUS_STEP)
        const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
        const earned = 1 * streakMultiplier * feverMult
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        if (solveTimeMs < TIME_BONUS_THRESHOLD_MS) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
        }

        // Activate fever mode
        if (nextStreak >= FEVER_STREAK_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
        }

        setFlashState('correct')
        playAudio(tapHitStrongAudioRef, 0.56, 1 + Math.min(0.3, nextScore * 0.015))

        // Visual effects for correct
        effects.comboHitBurst(160, 200, nextStreak, earned)
        effects.triggerFlash('rgba(34,197,94,0.3)')

        clearTimeoutSafe(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashState('none')
          startNewRound(roundRef.current + 1)
        }, FLASH_DURATION_MS)
      } else {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - TIME_PENALTY_MS)
        setRemainingMs(remainingMsRef.current)

        streakRef.current = 0
        setStreak(0)

        // End fever on wrong
        if (feverRef.current) {
          feverRef.current = false
          feverRemainingMsRef.current = 0
          setIsFever(false)
          setFeverRemainingMs(0)
        }

        setFlashState('wrong')
        playAudio(tapHitAudioRef, 0.5, 0.8)

        // Visual effects for wrong
        effects.triggerShake(5)
        effects.triggerFlash('rgba(239,68,68,0.4)')

        clearTimeoutSafe(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashState('none')
          interactableRef.current = true
        }, FLASH_DURATION_MS)

        if (remainingMsRef.current <= 0) {
          finishGame()
        }
      }
    },
    [cells, finishGame, playAudio, startNewRound],
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

    startNewRound(0)

    return () => {
      clearTimeoutSafe(flashTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
    }
  }, [startNewRound])

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

      // Fever timer countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      effects.updateParticles()

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
  }, [finishGame])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const hueShift = Math.max(MIN_HUE_SHIFT, BASE_HUE_SHIFT - round * HUE_SHIFT_DECAY)
  const cellSize = Math.floor(280 / gridSize)
  const comboLabel = getComboLabel(streak)
  const comboColor = getComboColor(streak)

  return (
    <section className="mini-game-panel odd-one-out-panel" aria-label="odd-one-out-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .odd-one-out-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #365314 0%, #3f6212 30%, #1e293b 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
        }

        .odd-one-out-header {
          background: linear-gradient(135deg, #84cc16, #65a30d);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .odd-one-out-header-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.4);
          object-fit: contain;
          background: rgba(255,255,255,0.15);
          flex-shrink: 0;
        }

        .odd-one-out-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .odd-one-out-header-score-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .odd-one-out-score-strip {
          display: none;
        }

        .odd-one-out-score {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          margin: 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .odd-one-out-best {
          font-size: 10px;
          color: rgba(255,255,255,0.6);
          margin: 0;
          font-weight: 600;
        }

        .odd-one-out-time {
          font-size: 18px;
          font-weight: 700;
          color: rgba(255,255,255,0.9);
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s;
        }

        .odd-one-out-time.low-time {
          color: #fca5a5;
          animation: odd-one-out-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes odd-one-out-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.7; transform: scale(1.08); }
        }

        .odd-one-out-meta-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 8px 16px;
        }

        .odd-one-out-meta-row p {
          font-size: 11px;
          color: rgba(255,255,255,0.6);
          margin: 0;
          font-weight: 600;
        }

        .odd-one-out-meta-row strong {
          color: #fff;
          font-size: 12px;
        }

        .odd-one-out-arena {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 12px;
          padding: 12px;
          border-radius: 16px;
          border: 2px solid rgba(132,204,22,0.3);
          background: rgba(132,204,22,0.08);
          transition: border-color 0.15s, background-color 0.15s;
        }

        .odd-one-out-arena.flash-correct {
          border-color: #22c55e;
          background: rgba(34, 197, 94, 0.15);
        }

        .odd-one-out-arena.flash-wrong {
          border-color: #ef4444;
          background: rgba(239, 68, 68, 0.12);
        }

        .odd-one-out-grid {
          display: grid;
        }

        .odd-one-out-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          margin: 0;
          border: 2px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.06);
          cursor: pointer;
          transition: transform 0.1s;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
          -webkit-tap-highlight-color: transparent;
        }

        .odd-one-out-cell:active {
          transform: scale(0.92);
        }

        .odd-one-out-shape {
          transition: background-color 0.15s;
        }

        .odd-one-out-shape-circle {
          border-radius: 50%;
        }

        .odd-one-out-shape-square {
          border-radius: 3px;
        }

        .odd-one-out-shape-diamond {
          border-radius: 3px;
          transform: rotate(45deg);
        }

        .odd-one-out-shape-triangle {
          /* handled inline */
        }

        .odd-one-out-character {
          width: 40px;
          height: 40px;
          object-fit: contain;
          flex-shrink: 0;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.2);
        }

        .odd-one-out-hint {
          min-height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 8px 16px;
        }

        .odd-one-out-feedback {
          font-size: 13px;
          font-weight: bold;
          margin: 0;
          text-align: center;
        }

        .odd-one-out-feedback.correct {
          color: #4ade80;
          animation: odd-one-out-pop 0.3s ease-out;
        }

        .odd-one-out-feedback.wrong {
          color: #f87171;
          animation: odd-one-out-shake 0.3s ease-out;
        }

        .odd-one-out-feedback.neutral {
          color: rgba(255,255,255,0.5);
          font-weight: normal;
        }

        .odd-one-out-exit-btn {
          padding: 10px 16px;
          margin: 4px 12px 12px;
          font-size: 13px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          background: transparent;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .odd-one-out-exit-btn:active {
          background: rgba(255,255,255,0.08);
        }

        @keyframes odd-one-out-pop {
          0% { transform: scale(0.8); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes odd-one-out-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="odd-one-out-header">
        <img className="odd-one-out-header-avatar" src={taeJinaImage} alt="태진아" />
        <div className="odd-one-out-header-info">
          <div className="odd-one-out-header-score-row">
            <p className="odd-one-out-score">{score.toLocaleString()}</p>
            <p className="odd-one-out-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <p className={`odd-one-out-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="odd-one-out-meta-row">
        <p className="odd-one-out-round">
          ROUND <strong>{round + 1}</strong>
        </p>
        <p className="odd-one-out-grid-info">
          GRID <strong>{gridSize}x{gridSize}</strong>
        </p>
        <p className="odd-one-out-difficulty">
          SHIFT <strong>{Math.round(hueShift)}</strong>
        </p>
        {comboLabel && (
          <p className="ge-combo-label" style={{ color: comboColor, fontSize: 10 }}>{comboLabel} x{streak}</p>
        )}
        {isFever && (
          <p style={{ color: '#facc15', fontSize: 10, fontWeight: 800, margin: 0, animation: 'odd-one-out-pulse 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div
        className={`odd-one-out-arena ${flashState === 'correct' ? 'flash-correct' : ''} ${flashState === 'wrong' ? 'flash-wrong' : ''}`}
      >
        <div
          className="odd-one-out-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridSize}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${gridSize}, ${cellSize}px)`,
            gap: 4,
            justifyContent: 'center',
            alignContent: 'center',
          }}
        >
          {cells.map((cell, index) => (
            <ShapeCell
              key={`cell-${round}-${index}`}
              cell={cell}
              size={cellSize}
              onClick={() => handleCellTap(index)}
            />
          ))}
        </div>
      </div>

      <div className="odd-one-out-hint">
        {flashState === 'correct' && <p className="odd-one-out-feedback correct">+1 CORRECT!</p>}
        {flashState === 'wrong' && <p className="odd-one-out-feedback wrong">WRONG! -2s</p>}
        {flashState === 'none' && <p className="odd-one-out-feedback neutral">Find the different one!</p>}
      </div>

      <button className="odd-one-out-exit-btn" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const oddOneOutModule: MiniGameModule = {
  manifest: {
    id: 'odd-one-out',
    title: 'Odd One Out',
    description: '미묘하게 다른 하나를 찾아라! 점점 어려워지는 색 구분!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#84cc16',
  },
  Component: OddOneOutGame,
}
