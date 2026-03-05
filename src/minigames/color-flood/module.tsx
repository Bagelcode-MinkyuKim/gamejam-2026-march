import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const BOARD_SIZE = 8
const COLOR_COUNT = 6
const MAX_MOVES = 25
const TIME_LIMIT_MS = 60000
const BONUS_PER_REMAINING_MOVE = 10
const CELL_TRANSITION_MS = 280
const BOARD_CLEAR_BONUS = 100

const BOARD_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#8b5cf6',
  '#f97316',
] as const

const COLOR_LABELS = [
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Purple',
  'Orange',
] as const

type CellColor = number

function createRandomBoard(): CellColor[][] {
  const board: CellColor[][] = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const rowCells: CellColor[] = []
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      rowCells.push(Math.floor(Math.random() * COLOR_COUNT))
    }
    board.push(rowCells)
  }
  return board
}

function cloneBoard(board: CellColor[][]): CellColor[][] {
  return board.map((row) => [...row])
}

function getFloodRegion(board: CellColor[][]): boolean[][] {
  const visited: boolean[][] = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    visited.push(new Array<boolean>(BOARD_SIZE).fill(false))
  }

  const targetColor = board[0][0]
  const queue: [number, number][] = [[0, 0]]
  visited[0][0] = true

  const directions: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]

  while (queue.length > 0) {
    const [currentRow, currentCol] = queue.shift()!
    for (const [deltaRow, deltaCol] of directions) {
      const nextRow = currentRow + deltaRow
      const nextCol = currentCol + deltaCol
      if (
        nextRow >= 0 &&
        nextRow < BOARD_SIZE &&
        nextCol >= 0 &&
        nextCol < BOARD_SIZE &&
        !visited[nextRow][nextCol] &&
        board[nextRow][nextCol] === targetColor
      ) {
        visited[nextRow][nextCol] = true
        queue.push([nextRow, nextCol])
      }
    }
  }

  return visited
}

function applyFloodFill(board: CellColor[][], newColor: CellColor): CellColor[][] {
  const currentColor = board[0][0]
  if (currentColor === newColor) {
    return board
  }

  const nextBoard = cloneBoard(board)
  const region = getFloodRegion(board)

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (region[row][col]) {
        nextBoard[row][col] = newColor
      }
    }
  }

  return nextBoard
}

function isBoardSolved(board: CellColor[][]): boolean {
  const targetColor = board[0][0]
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== targetColor) {
        return false
      }
    }
  }
  return true
}

function countFloodedCells(board: CellColor[][]): number {
  const region = getFloodRegion(board)
  let count = 0
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (region[row][col]) {
        count += 1
      }
    }
  }
  return count
}

function ColorFloodGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [board, setBoard] = useState<CellColor[][]>(() => createRandomBoard())
  const [movesRemaining, setMovesRemaining] = useState(MAX_MOVES)
  const [score, setScore] = useState(0)
  const [boardsCleared, setBoardsCleared] = useState(0)
  const [remainingMs, setRemainingMs] = useState(TIME_LIMIT_MS)
  const [changedCells, setChangedCells] = useState<boolean[][]>(() => {
    const empty: boolean[][] = []
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      empty.push(new Array<boolean>(BOARD_SIZE).fill(false))
    }
    return empty
  })
  const [isTransitioning, setIsTransitioning] = useState(false)

  const boardRef = useRef<CellColor[][]>(board)
  const movesRemainingRef = useRef(MAX_MOVES)
  const scoreRef = useRef(0)
  const boardsClearedRef = useRef(0)
  const remainingMsRef = useRef(TIME_LIMIT_MS)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const transitionTimerRef = useRef<number | null>(null)

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
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true
    clearTransitionTimer()

    const elapsedMs = Math.max(16.66, TIME_LIMIT_MS - remainingMsRef.current)
    playAudio(gameOverAudioRef, 0.6, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(elapsedMs),
    })
  }, [clearTransitionTimer, onFinish, playAudio])

  const startNewBoard = useCallback(() => {
    const nextBoard = createRandomBoard()
    boardRef.current = nextBoard
    setBoard(nextBoard)
    movesRemainingRef.current = MAX_MOVES
    setMovesRemaining(MAX_MOVES)
  }, [])

  const handleColorSelect = useCallback(
    (colorIndex: CellColor) => {
      if (finishedRef.current || isTransitioning) {
        return
      }

      const currentBoard = boardRef.current
      const currentTopLeftColor = currentBoard[0][0]

      if (colorIndex === currentTopLeftColor) {
        return
      }

      if (movesRemainingRef.current <= 0) {
        return
      }

      const nextBoard = applyFloodFill(currentBoard, colorIndex)
      boardRef.current = nextBoard

      const nextMovesRemaining = movesRemainingRef.current - 1
      movesRemainingRef.current = nextMovesRemaining
      setMovesRemaining(nextMovesRemaining)

      const changed: boolean[][] = []
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        const rowChanged: boolean[] = []
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          rowChanged.push(currentBoard[row][col] !== nextBoard[row][col])
        }
        changed.push(rowChanged)
      }
      setChangedCells(changed)
      setIsTransitioning(true)
      setBoard(nextBoard)

      const floodedCount = countFloodedCells(nextBoard)
      const floodedRatio = floodedCount / (BOARD_SIZE * BOARD_SIZE)

      if (floodedRatio > 0.6) {
        playAudio(tapHitStrongAudioRef, 0.5, 0.95 + floodedRatio * 0.2)
        effects.triggerFlash('rgba(34,197,94,0.2)')
        effects.spawnParticles(4, 200, 250)
      } else {
        playAudio(tapHitAudioRef, 0.4, 1)
        effects.spawnParticles(2, 200, 250)
      }

      clearTransitionTimer()
      transitionTimerRef.current = window.setTimeout(() => {
        transitionTimerRef.current = null
        setIsTransitioning(false)
        const emptyChanged: boolean[][] = []
        for (let r = 0; r < BOARD_SIZE; r += 1) {
          emptyChanged.push(new Array<boolean>(BOARD_SIZE).fill(false))
        }
        setChangedCells(emptyChanged)
      }, CELL_TRANSITION_MS)

      if (isBoardSolved(nextBoard)) {
        const moveBonus = nextMovesRemaining * BONUS_PER_REMAINING_MOVE
        const clearScore = BOARD_CLEAR_BONUS + moveBonus
        const nextScore = scoreRef.current + clearScore
        scoreRef.current = nextScore
        setScore(nextScore)

        const nextBoardsCleared = boardsClearedRef.current + 1
        boardsClearedRef.current = nextBoardsCleared
        setBoardsCleared(nextBoardsCleared)

        playAudio(tapHitStrongAudioRef, 0.65, 1.1 + nextBoardsCleared * 0.05)
        effects.comboHitBurst(200, 200, nextBoardsCleared * 3, clearScore, ['🎉', '🌟', '✨', '🎊'])
        effects.showScorePopup(clearScore, 200, 180)

        window.setTimeout(() => {
          if (!finishedRef.current) {
            startNewBoard()
          }
        }, CELL_TRANSITION_MS + 200)
        return
      }

      if (nextMovesRemaining <= 0) {
        const floodedScore = Math.floor(floodedCount * 1.5)
        const nextScore = scoreRef.current + floodedScore
        scoreRef.current = nextScore
        setScore(nextScore)

        window.setTimeout(() => {
          if (!finishedRef.current) {
            startNewBoard()
          }
        }, CELL_TRANSITION_MS + 200)
      }
    },
    [clearTransitionTimer, isTransitioning, playAudio, startNewBoard],
  )

  const handleExit = useCallback(() => {
    playAudio(tapHitAudioRef, 0.4, 1)
    onExit()
  }, [onExit, playAudio])

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
      for (const audio of [tapHitAudio, tapHitStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
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

  useEffect(() => {
    return () => {
      clearTransitionTimer()
    }
  }, [clearTransitionTimer])

  const floodedCount = useMemo(() => countFloodedCells(board), [board])
  const totalCells = BOARD_SIZE * BOARD_SIZE
  const floodedPercent = Math.round((floodedCount / totalCells) * 100)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const currentTopLeftColor = board[0][0]
  const isLowTime = remainingMs <= 10000

  return (
    <section className="mini-game-panel color-flood-panel" aria-label="color-flood-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div className="color-flood-score-strip">
        <p className="color-flood-score">{score.toLocaleString()}</p>
        <p className="color-flood-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`color-flood-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="color-flood-meta-row">
        <p className="color-flood-moves">
          MOVES <strong>{movesRemaining}</strong>/{MAX_MOVES}
        </p>
        <p className="color-flood-cleared">
          CLEARED <strong>{boardsCleared}</strong>
        </p>
        <p className="color-flood-progress">
          FILLED <strong>{floodedPercent}%</strong>
        </p>
      </div>

      <div className="color-flood-board" role="grid" aria-label="color-flood-board">
        {board.map((row, rowIndex) => (
          <div className="color-flood-row" key={`row-${rowIndex}`} role="row">
            {row.map((cellColor, colIndex) => {
              const isChanged = changedCells[rowIndex]?.[colIndex] ?? false
              return (
                <div
                  className={`color-flood-cell ${isChanged ? 'changed' : ''}`}
                  key={`cell-${rowIndex}-${colIndex}`}
                  role="gridcell"
                  style={{
                    backgroundColor: BOARD_COLORS[cellColor],
                    transition: isChanged
                      ? `background-color ${CELL_TRANSITION_MS}ms ease-out`
                      : 'none',
                  }}
                  aria-label={`${COLOR_LABELS[cellColor]} cell at row ${rowIndex + 1} column ${colIndex + 1}`}
                />
              )
            })}
          </div>
        ))}
      </div>

      <div className="color-flood-character" style={{ textAlign: 'center', margin: '4px 0' }}>
        <img src={kimYeonjaImage} alt="김연자" style={{ width: '80px', height: '80px', objectFit: 'contain', imageRendering: 'pixelated' }} />
      </div>

      <div className="color-flood-color-buttons" role="group" aria-label="color selection">
        {BOARD_COLORS.map((hex, colorIndex) => {
          const isCurrentColor = colorIndex === currentTopLeftColor
          return (
            <button
              className={`color-flood-color-button ${isCurrentColor ? 'active' : ''}`}
              key={`color-btn-${colorIndex}`}
              type="button"
              disabled={isCurrentColor || movesRemaining <= 0}
              onClick={() => handleColorSelect(colorIndex)}
              style={{ backgroundColor: hex }}
              aria-label={`Select ${COLOR_LABELS[colorIndex]}`}
            >
              {isCurrentColor ? '\u25CF' : ''}
            </button>
          )
        })}
      </div>

      <style>{GAME_EFFECTS_CSS}
      {`
        .color-flood-panel {
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

        .color-flood-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          padding: 0 4px;
        }

        .color-flood-score {
          font-size: 28px;
          font-weight: 800;
          color: #14b8a6;
          margin: 0;
          line-height: 1;
        }

        .color-flood-best {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .color-flood-time {
          font-size: 18px;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0;
          transition: color 0.2s;
        }

        .color-flood-time.low-time {
          color: #ef4444;
          animation: color-flood-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes color-flood-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .color-flood-meta-row {
          display: flex;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 2px 0;
        }

        .color-flood-moves,
        .color-flood-cleared,
        .color-flood-progress {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .color-flood-moves strong,
        .color-flood-cleared strong,
        .color-flood-progress strong {
          color: #14b8a6;
        }

        .color-flood-board {
          width: 100%;
          max-width: 340px;
          aspect-ratio: 1;
          display: flex;
          flex-direction: column;
          gap: 1px;
          background: #1e293b;
          border-radius: 8px;
          overflow: hidden;
          border: 2px solid #334155;
        }

        .color-flood-row {
          display: flex;
          flex: 1;
          gap: 1px;
        }

        .color-flood-cell {
          flex: 1;
          border-radius: 2px;
        }

        .color-flood-cell.changed {
          animation: color-flood-cell-pop 0.28s ease-out;
        }

        @keyframes color-flood-cell-pop {
          0% { transform: scale(0.85); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }

        .color-flood-color-buttons {
          display: flex;
          gap: 8px;
          justify-content: center;
          padding: 4px 0;
        }

        .color-flood-color-button {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 3px solid rgba(255, 255, 255, 0.2);
          cursor: pointer;
          transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
          font-size: 14px;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: inherit;
          padding: 0;
        }

        .color-flood-color-button:hover:not(:disabled) {
          transform: scale(1.1);
          border-color: rgba(255, 255, 255, 0.5);
        }

        .color-flood-color-button:active:not(:disabled) {
          transform: scale(0.92);
        }

        .color-flood-color-button:disabled {
          cursor: default;
          opacity: 0.5;
        }

        .color-flood-color-button.active {
          border-color: #fff;
          box-shadow: 0 0 12px rgba(255, 255, 255, 0.3);
          opacity: 1;
          transform: scale(1.1);
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

export const colorFloodModule: MiniGameModule = {
  manifest: {
    id: 'color-flood',
    title: 'Color Flood',
    description: '색을 선택해 보드를 한 색으로 채워라! 적은 이동으로 클리어하면 고득점!',
    unlockCost: 55,
    baseReward: 18,
    scoreRewardMultiplier: 1.25,
    accentColor: '#14b8a6',
  },
  Component: ColorFloodGame,
}
