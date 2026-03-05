import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import parkSangminImg from '../../../assets/images/same-character/park-sangmin.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const GRID_SIZE = 3
const TILE_COUNT = GRID_SIZE * GRID_SIZE
const EMPTY_VALUE = 0
const ROUND_DURATION_MS = 60000
const LOW_TIME_THRESHOLD_MS = 10000
const CLEAR_PULSE_DURATION_MS = 600
const TIME_BONUS_MAX_MS = 20000
const TIME_BONUS_POINTS = 500
const PUZZLE_CLEAR_BASE_POINTS = 1000
const PUZZLE_CLEAR_BONUS_PER_ROUND = 200
const MOVE_PENALTY_THRESHOLD = 40
const MOVE_BONUS_POINTS = 300
const TILE_TRANSITION_MS = 120

type Board = number[]

function isSolvable(tiles: number[]): boolean {
  let inversions = 0
  for (let i = 0; i < tiles.length; i += 1) {
    if (tiles[i] === EMPTY_VALUE) continue
    for (let j = i + 1; j < tiles.length; j += 1) {
      if (tiles[j] === EMPTY_VALUE) continue
      if (tiles[i] > tiles[j]) inversions += 1
    }
  }
  return inversions % 2 === 0
}

function isSolved(board: Board): boolean {
  for (let i = 0; i < TILE_COUNT - 1; i += 1) {
    if (board[i] !== i + 1) return false
  }
  return board[TILE_COUNT - 1] === EMPTY_VALUE
}

function generateSolvableBoard(): Board {
  const tiles = Array.from({ length: TILE_COUNT - 1 }, (_, i) => i + 1)

  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = tiles[i]
    tiles[i] = tiles[j]
    tiles[j] = temp
  }

  tiles.push(EMPTY_VALUE)

  if (!isSolvable(tiles)) {
    if (tiles[0] !== EMPTY_VALUE && tiles[1] !== EMPTY_VALUE) {
      const temp = tiles[0]
      tiles[0] = tiles[1]
      tiles[1] = temp
    } else {
      const temp = tiles[TILE_COUNT - 3]
      tiles[TILE_COUNT - 3] = tiles[TILE_COUNT - 2]
      tiles[TILE_COUNT - 2] = temp
    }
  }

  if (isSolved(tiles)) {
    return generateSolvableBoard()
  }

  return tiles
}

function getEmptyIndex(board: Board): number {
  return board.indexOf(EMPTY_VALUE)
}

function getAdjacentIndices(index: number): number[] {
  const row = Math.floor(index / GRID_SIZE)
  const col = index % GRID_SIZE
  const adjacent: number[] = []
  if (row > 0) adjacent.push((row - 1) * GRID_SIZE + col)
  if (row < GRID_SIZE - 1) adjacent.push((row + 1) * GRID_SIZE + col)
  if (col > 0) adjacent.push(row * GRID_SIZE + (col - 1))
  if (col < GRID_SIZE - 1) adjacent.push(row * GRID_SIZE + (col + 1))
  return adjacent
}

function canMove(tileIndex: number, emptyIndex: number): boolean {
  return getAdjacentIndices(emptyIndex).includes(tileIndex)
}

function moveTile(board: Board, tileIndex: number): Board | null {
  const emptyIndex = getEmptyIndex(board)
  if (!canMove(tileIndex, emptyIndex)) return null
  const next = [...board]
  next[emptyIndex] = next[tileIndex]
  next[tileIndex] = EMPTY_VALUE
  return next
}

function SlidePuzzleGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [board, setBoard] = useState<Board>(() => generateSolvableBoard())
  const [score, setScore] = useState(0)
  const [moves, setMoves] = useState(0)
  const [puzzlesSolved, setPuzzlesSolved] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [isClearPulseActive, setClearPulseActive] = useState(false)
  const [slidingTileIndex, setSlidingTileIndex] = useState<number | null>(null)

  const boardRef = useRef<Board>(board)
  const scoreRef = useRef(0)
  const movesRef = useRef(0)
  const puzzlesSolvedRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const puzzleStartMsRef = useRef(0)
  const totalMovesForPuzzleRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const clearPulseTimerRef = useRef<number | null>(null)

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

  const triggerClearPulse = useCallback(() => {
    setClearPulseActive(true)
    clearTimeoutSafe(clearPulseTimerRef)
    clearPulseTimerRef.current = window.setTimeout(() => {
      clearPulseTimerRef.current = null
      setClearPulseActive(false)
    }, CLEAR_PULSE_DURATION_MS)
  }, [])

  const startNewPuzzle = useCallback(() => {
    const newBoard = generateSolvableBoard()
    boardRef.current = newBoard
    setBoard(newBoard)
    totalMovesForPuzzleRef.current = 0
    puzzleStartMsRef.current = window.performance.now()
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(clearPulseTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.64, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleTileClick = useCallback(
    (tileIndex: number) => {
      if (finishedRef.current) return
      if (boardRef.current[tileIndex] === EMPTY_VALUE) return

      const nextBoard = moveTile(boardRef.current, tileIndex)
      if (nextBoard === null) return

      setSlidingTileIndex(tileIndex)
      setTimeout(() => setSlidingTileIndex(null), TILE_TRANSITION_MS)

      boardRef.current = nextBoard
      setBoard(nextBoard)

      const nextMoves = movesRef.current + 1
      movesRef.current = nextMoves
      setMoves(nextMoves)
      totalMovesForPuzzleRef.current += 1

      playAudio(tapHitAudioRef, 0.4, 1 + Math.random() * 0.1)

      if (isSolved(nextBoard)) {
        const now = window.performance.now()
        const solveDurationMs = now - puzzleStartMsRef.current

        const nextPuzzlesSolved = puzzlesSolvedRef.current + 1
        puzzlesSolvedRef.current = nextPuzzlesSolved
        setPuzzlesSolved(nextPuzzlesSolved)

        let points = PUZZLE_CLEAR_BASE_POINTS + (nextPuzzlesSolved - 1) * PUZZLE_CLEAR_BONUS_PER_ROUND

        const timeRatio = Math.max(0, 1 - solveDurationMs / TIME_BONUS_MAX_MS)
        points += Math.round(timeRatio * TIME_BONUS_POINTS)

        const movesForPuzzle = totalMovesForPuzzleRef.current
        if (movesForPuzzle <= MOVE_PENALTY_THRESHOLD) {
          const moveEfficiency = 1 - movesForPuzzle / MOVE_PENALTY_THRESHOLD
          points += Math.round(moveEfficiency * MOVE_BONUS_POINTS)
        }

        const nextScore = scoreRef.current + points
        scoreRef.current = nextScore
        setScore(nextScore)

        triggerClearPulse()
        playAudio(tapHitStrongAudioRef, 0.6, 1.1)
        effects.comboHitBurst(150, 200, nextPuzzlesSolved * 3, points, ['🎉', '🌟', '✨', '🧩'])
        effects.showScorePopup(points, 150, 170)

        setTimeout(() => {
          if (!finishedRef.current) {
            startNewPuzzle()
          }
        }, CLEAR_PULSE_DURATION_MS)
      }
    },
    [playAudio, startNewPuzzle, triggerClearPulse],
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

    puzzleStartMsRef.current = window.performance.now()

    return () => {
      clearTimeoutSafe(clearPulseTimerRef)
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
  }, [finishGame])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  return (
    <section className="mini-game-panel slide-puzzle-panel" aria-label="slide-puzzle-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div className="slide-puzzle-score-strip">
        <p className="slide-puzzle-score">{score.toLocaleString()}</p>
        <p className="slide-puzzle-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`slide-puzzle-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="slide-puzzle-meta-row">
        <img
          src={parkSangminImg}
          alt="park-sangmin"
          style={{
            width: '80px',
            height: '80px',
            objectFit: 'contain',
            opacity: 0.9,
            filter: isClearPulseActive ? 'brightness(1.3)' : 'none',
            transition: 'filter 0.2s ease',
          }}
        />
        <p className="slide-puzzle-meta">
          이동 <strong>{moves}</strong>
        </p>
        <p className="slide-puzzle-meta">
          클리어 <strong>{puzzlesSolved}</strong>
        </p>
      </div>

      <div className={`slide-puzzle-board ${isClearPulseActive ? 'clear-pulse' : ''}`}>
        {board.map((value, index) => {
          if (value === EMPTY_VALUE) {
            return (
              <div
                className="slide-puzzle-cell empty"
                key={`cell-${index}`}
                style={{
                  gridRow: Math.floor(index / GRID_SIZE) + 1,
                  gridColumn: (index % GRID_SIZE) + 1,
                }}
              />
            )
          }

          const isSliding = slidingTileIndex === index
          const isCorrectPosition = value === index + 1
          const isBoardSolved = isClearPulseActive

          return (
            <button
              className={`slide-puzzle-cell tile ${isSliding ? 'sliding' : ''} ${isCorrectPosition ? 'correct' : ''} ${isBoardSolved ? 'solved-pulse' : ''}`}
              key={`cell-${value}`}
              type="button"
              onClick={() => handleTileClick(index)}
              style={{
                gridRow: Math.floor(index / GRID_SIZE) + 1,
                gridColumn: (index % GRID_SIZE) + 1,
                transition: `all ${TILE_TRANSITION_MS}ms ease-out`,
              }}
            >
              {value}
            </button>
          )
        })}
      </div>

      <style>{GAME_EFFECTS_CSS}
      {`
        .slide-puzzle-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 12px 8px;
          width: 100%;
          user-select: none;
          -webkit-user-select: none;
          position: relative;
        }

        .slide-puzzle-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          padding: 0 4px;
        }

        .slide-puzzle-score {
          font-size: 28px;
          font-weight: 800;
          color: #0ea5e9;
          margin: 0;
          line-height: 1;
        }

        .slide-puzzle-best {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .slide-puzzle-time {
          font-size: 18px;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0;
          transition: color 0.2s;
        }

        .slide-puzzle-time.low-time {
          color: #ef4444;
          animation: slide-puzzle-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes slide-puzzle-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .slide-puzzle-meta-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          width: 100%;
          padding: 4px 0;
        }

        .slide-puzzle-meta {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .slide-puzzle-meta strong {
          color: #0ea5e9;
        }

        .slide-puzzle-board {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          grid-template-rows: repeat(${GRID_SIZE}, 1fr);
          gap: 4px;
          width: 100%;
          max-width: 320px;
          aspect-ratio: 1;
          background: #0f172a;
          border-radius: 12px;
          padding: 8px;
          border: 2px solid #334155;
        }

        .slide-puzzle-board.clear-pulse {
          animation: slide-puzzle-clear 0.6s ease-out;
        }

        @keyframes slide-puzzle-clear {
          0% { box-shadow: 0 0 0 rgba(14, 165, 233, 0); }
          50% { box-shadow: 0 0 30px rgba(14, 165, 233, 0.4); transform: scale(1.02); }
          100% { box-shadow: 0 0 0 rgba(14, 165, 233, 0); transform: scale(1); }
        }

        .slide-puzzle-cell {
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .slide-puzzle-cell.empty {
          background: transparent;
        }

        .slide-puzzle-cell.tile {
          background: linear-gradient(135deg, #1e3a5f, #2563eb);
          border: 2px solid #3b82f6;
          color: #e0f2fe;
          font-size: 28px;
          font-weight: 800;
          cursor: pointer;
          font-family: inherit;
          padding: 0;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .slide-puzzle-cell.tile:active {
          transform: scale(0.95);
        }

        .slide-puzzle-cell.tile.correct {
          background: linear-gradient(135deg, #065f46, #10b981);
          border-color: #34d399;
          color: #d1fae5;
        }

        .slide-puzzle-cell.tile.sliding {
          transition: all ${TILE_TRANSITION_MS}ms ease-out;
        }

        .slide-puzzle-cell.tile.solved-pulse {
          animation: slide-puzzle-tile-glow 0.6s ease-out;
        }

        @keyframes slide-puzzle-tile-glow {
          0% { box-shadow: 0 0 0 rgba(14, 165, 233, 0); }
          50% { box-shadow: 0 0 16px rgba(14, 165, 233, 0.6); }
          100% { box-shadow: 0 0 0 rgba(14, 165, 233, 0); }
        }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const slidePuzzleModule: MiniGameModule = {
  manifest: {
    id: 'slide-puzzle',
    title: 'Slide Puzzle',
    description: '타일을 밀어 숫자를 순서대로 정렬하라! 빠를수록 고득점!',
    unlockCost: 60,
    baseReward: 20,
    scoreRewardMultiplier: 1.3,
    accentColor: '#0ea5e9',
  },
  Component: SlidePuzzleGame,
}
