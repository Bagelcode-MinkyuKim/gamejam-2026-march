import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const GRID_SIZE = 8
const BASE_MINE_COUNT = 10
const MINE_INCREASE_PER_LEVEL = 1
const MAX_MINES = 18
const ROUND_DURATION_MS = 60000
const CLEAR_BONUS = 50
const LOW_TIME_THRESHOLD_MS = 10000
const LONG_PRESS_MS = 400
const CHAIN_REVEAL_THRESHOLD = 8
const CHAIN_REVEAL_MULTIPLIER = 3
const FAST_CLEAR_THRESHOLD_MS = 15000
const FAST_CLEAR_BONUS = 30
const FEVER_CLEAR_THRESHOLD = 3
const FEVER_SCORE_MULTIPLIER = 2
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE

function getMineCount(level: number): number {
  return Math.min(MAX_MINES, BASE_MINE_COUNT + level * MINE_INCREASE_PER_LEVEL)
}

function getSafeCells(level: number): number {
  return TOTAL_CELLS - getMineCount(level)
}

type CellState = {
  readonly isMine: boolean
  readonly adjacentMines: number
  opened: boolean
  flagged: boolean
}

type BoardState = {
  cells: CellState[][]
  minesPlaced: boolean
}

const NUMBER_COLORS: Record<number, string> = {
  1: '#3b82f6',
  2: '#22c55e',
  3: '#ef4444',
  4: '#8b5cf6',
  5: '#7f1d1d',
  6: '#0891b2',
  7: '#1f2937',
  8: '#6b7280',
}

function createEmptyBoard(): BoardState {
  const cells: CellState[][] = []
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowCells: CellState[] = []
    for (let col = 0; col < GRID_SIZE; col += 1) {
      rowCells.push({ isMine: false, adjacentMines: 0, opened: false, flagged: false })
    }
    cells.push(rowCells)
  }
  return { cells, minesPlaced: false }
}

function getNeighbors(row: number, col: number): [number, number][] {
  const neighbors: [number, number][] = []
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const nr = row + dr
      const nc = col + dc
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        neighbors.push([nr, nc])
      }
    }
  }
  return neighbors
}

function placeMines(board: BoardState, safeRow: number, safeCol: number, mineCount: number = BASE_MINE_COUNT): void {
  const safeCells = new Set<string>()
  safeCells.add(`${safeRow},${safeCol}`)
  for (const [nr, nc] of getNeighbors(safeRow, safeCol)) {
    safeCells.add(`${nr},${nc}`)
  }

  const candidates: [number, number][] = []
  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      if (!safeCells.has(`${r},${c}`)) {
        candidates.push([r, c])
      }
    }
  }

  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = temp
  }

  const minePositions = candidates.slice(0, mineCount)
  for (const [r, c] of minePositions) {
    board.cells[r][c] = { ...board.cells[r][c], isMine: true }
  }

  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      if (board.cells[r][c].isMine) continue
      let count = 0
      for (const [nr, nc] of getNeighbors(r, c)) {
        if (board.cells[nr][nc].isMine) count += 1
      }
      board.cells[r][c] = { ...board.cells[r][c], adjacentMines: count }
    }
  }

  board.minesPlaced = true
}

function cloneBoard(board: BoardState): BoardState {
  return {
    cells: board.cells.map((row) => row.map((cell) => ({ ...cell }))),
    minesPlaced: board.minesPlaced,
  }
}

function countOpenedSafe(board: BoardState): number {
  let count = 0
  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      if (board.cells[r][c].opened && !board.cells[r][c].isMine) count += 1
    }
  }
  return count
}

function countFlags(board: BoardState): number {
  let count = 0
  for (let r = 0; r < GRID_SIZE; r += 1) {
    for (let c = 0; c < GRID_SIZE; c += 1) {
      if (board.cells[r][c].flagged) count += 1
    }
  }
  return count
}

function floodOpen(board: BoardState, row: number, col: number): number {
  const cell = board.cells[row][col]
  if (cell.opened || cell.flagged || cell.isMine) return 0

  cell.opened = true
  let opened = 1

  if (cell.adjacentMines === 0) {
    for (const [nr, nc] of getNeighbors(row, col)) {
      opened += floodOpen(board, nr, nc)
    }
  }

  return opened
}

function MineSweepMiniGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [board, setBoard] = useState<BoardState>(() => createEmptyBoard())
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [boardsCleared, setBoardsCleared] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [hitMinePos, setHitMinePos] = useState<[number, number] | null>(null)
  const [currentLevel, setCurrentLevel] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [boardStartMs, setBoardStartMs] = useState(0)

  const boardRef = useRef<BoardState>(board)
  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const boardsClearedRef = useRef(0)
  const currentLevelRef = useRef(0)
  const boardStartMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const pointerStartRef = useRef<{ row: number; col: number } | null>(null)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const handleMineHit = useCallback(
    (row: number, col: number) => {
      setGameOver(true)
      setHitMinePos([row, col])

      const nextBoard = cloneBoard(boardRef.current)
      for (let r = 0; r < GRID_SIZE; r += 1) {
        for (let c = 0; c < GRID_SIZE; c += 1) {
          if (nextBoard.cells[r][c].isMine) {
            nextBoard.cells[r][c].opened = true
          }
        }
      }
      boardRef.current = nextBoard
      setBoard(nextBoard)

      playAudio(gameOverAudioRef, 0.7, 0.9)
      effects.triggerFlash('rgba(239,68,68,0.5)')
      effects.triggerShake(8)
      effects.spawnParticles(6, col * 40 + 20, row * 40 + 20, ['💥', '💣', '🔥'])

      window.setTimeout(() => {
        finishGame()
      }, 1200)
    },
    [finishGame, playAudio],
  )

  const startNewBoard = useCallback(() => {
    const nextBoard = createEmptyBoard()
    boardRef.current = nextBoard
    setBoard(nextBoard)
    setHitMinePos(null)
    setGameOver(false)
    boardStartMsRef.current = ROUND_DURATION_MS - remainingMsRef.current
    setBoardStartMs(boardStartMsRef.current)
  }, [])

  const handleBoardClear = useCallback(() => {
    const nextCleared = boardsClearedRef.current + 1
    boardsClearedRef.current = nextCleared
    setBoardsCleared(nextCleared)

    const nextLevel = currentLevelRef.current + 1
    currentLevelRef.current = nextLevel
    setCurrentLevel(nextLevel)

    const feverActive = nextCleared >= FEVER_CLEAR_THRESHOLD
    setIsFever(feverActive)

    let bonus = CLEAR_BONUS
    const boardDurationMs = (ROUND_DURATION_MS - remainingMsRef.current) - boardStartMsRef.current
    if (boardDurationMs < FAST_CLEAR_THRESHOLD_MS) {
      bonus += FAST_CLEAR_BONUS
    }
    if (feverActive) {
      bonus *= FEVER_SCORE_MULTIPLIER
    }

    const nextScore = scoreRef.current + bonus
    scoreRef.current = nextScore
    setScore(nextScore)

    playAudio(tapHitStrongAudioRef, 0.7, feverActive ? 1.4 : 1.2)
    effects.comboHitBurst(160, 160, nextCleared, bonus)
    effects.triggerFlash(feverActive ? 'rgba(250,204,21,0.5)' : 'rgba(34,197,94,0.4)')

    window.setTimeout(() => {
      if (!finishedRef.current) {
        startNewBoard()
      }
    }, 600)
  }, [playAudio, startNewBoard])

  const openCell = useCallback(
    (row: number, col: number) => {
      if (finishedRef.current || gameOver) return

      const currentBoard = boardRef.current
      const cell = currentBoard.cells[row][col]
      if (cell.opened || cell.flagged) return

      const nextBoard = cloneBoard(currentBoard)

      if (!nextBoard.minesPlaced) {
        placeMines(nextBoard, row, col, getMineCount(currentLevelRef.current))
      }

      if (nextBoard.cells[row][col].isMine) {
        boardRef.current = nextBoard
        setBoard(nextBoard)
        handleMineHit(row, col)
        return
      }

      const opened = floodOpen(nextBoard, row, col)
      boardRef.current = nextBoard
      setBoard(nextBoard)

      if (opened > 0) {
        const isChainReveal = opened >= CHAIN_REVEAL_THRESHOLD
        const points = isChainReveal ? opened * CHAIN_REVEAL_MULTIPLIER : opened
        const nextScore = scoreRef.current + points
        scoreRef.current = nextScore
        setScore(nextScore)
        playAudio(tapHitAudioRef, 0.5, 1 + opened * 0.03)
        const cellCenterX = col * 40 + 20
        const cellCenterY = row * 40 + 20
        effects.showScorePopup(points, cellCenterX, cellCenterY)
        if (opened >= 5) {
          effects.comboHitBurst(cellCenterX, cellCenterY, opened, points)
        } else {
          effects.spawnParticles(Math.min(opened, 4), cellCenterX, cellCenterY)
          effects.triggerShake(2)
        }
      }

      const totalOpened = countOpenedSafe(nextBoard)
      if (totalOpened === getSafeCells(currentLevelRef.current)) {
        handleBoardClear()
      }
    },
    [gameOver, handleBoardClear, handleMineHit, playAudio],
  )

  const toggleFlag = useCallback(
    (row: number, col: number) => {
      if (finishedRef.current || gameOver) return

      const currentBoard = boardRef.current
      const cell = currentBoard.cells[row][col]
      if (cell.opened) return

      const nextBoard = cloneBoard(currentBoard)
      nextBoard.cells[row][col].flagged = !nextBoard.cells[row][col].flagged
      boardRef.current = nextBoard
      setBoard(nextBoard)

      playAudio(tapHitAudioRef, 0.3, 0.8)
    },
    [gameOver, playAudio],
  )

  const handlePointerDown = useCallback(
    (row: number, col: number) => {
      if (finishedRef.current || gameOver) return

      pointerStartRef.current = { row, col }
      longPressFiredRef.current = false

      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
      }

      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null
        longPressFiredRef.current = true
        toggleFlag(row, col)
      }, LONG_PRESS_MS)
    },
    [gameOver, toggleFlag],
  )

  const handlePointerUp = useCallback(
    (row: number, col: number) => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }

      if (longPressFiredRef.current) return

      const start = pointerStartRef.current
      if (start === null || start.row !== row || start.col !== col) return

      openCell(row, col)
    },
    [openCell],
  )

  const handlePointerLeave = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleContextMenu = useCallback(
    (event: React.MouseEvent, row: number, col: number) => {
      event.preventDefault()
      toggleFlag(row, col)
    },
    [toggleFlag],
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
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }
      effects.cleanup()
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
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

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.7, 0.95)
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
  }, [finishGame, playAudio])

  const currentMineCount = getMineCount(currentLevelRef.current)
  const flagCount = useMemo(() => countFlags(board), [board])
  const minesRemaining = currentMineCount - flagCount
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0

  const getCellDisplay = (cell: CellState, row: number, col: number): React.ReactNode => {
    if (cell.flagged && !cell.opened) {
      return <span className="mine-sweep-flag">F</span>
    }

    if (!cell.opened) {
      return null
    }

    if (cell.isMine) {
      const isHit = hitMinePos !== null && hitMinePos[0] === row && hitMinePos[1] === col
      return <span className={`mine-sweep-mine ${isHit ? 'mine-sweep-mine-hit' : ''}`}>*</span>
    }

    if (cell.adjacentMines > 0) {
      return (
        <span className="mine-sweep-number" style={{ color: NUMBER_COLORS[cell.adjacentMines] ?? '#1f2937' }}>
          {cell.adjacentMines}
        </span>
      )
    }

    return null
  }

  return (
    <section className="mini-game-panel mine-sweep-mini-panel" aria-label="mine-sweep-mini-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <div className="mine-sweep-score-strip">
        <p className="mine-sweep-score">{score.toLocaleString()}</p>
        <p className="mine-sweep-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`mine-sweep-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="mine-sweep-meta-row">
        <p className="mine-sweep-mines-left">
          Mines <strong>{minesRemaining}</strong>
        </p>
        <p className="mine-sweep-boards-cleared">
          Cleared <strong>{boardsCleared}</strong>
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>
          Lv.{currentLevel + 1}
        </p>
      </div>
      {isFever && (
        <div style={{ textAlign: 'center', color: '#fbbf24', fontWeight: 800, fontSize: 14, animation: 'mine-sweep-fever-pulse 0.5s ease-in-out infinite alternate', textShadow: '0 0 8px #f59e0b' }}>
          FEVER MODE x{FEVER_SCORE_MULTIPLIER}
        </div>
      )}
      <style>{`
        @keyframes mine-sweep-fever-pulse {
          from { opacity: 0.7; transform: scale(1); }
          to { opacity: 1; transform: scale(1.05); }
        }
      `}</style>

      <div className={`mine-sweep-grid-container ${gameOver ? 'mine-sweep-game-over' : ''}`}>
        <div className="mine-sweep-grid">
          {board.cells.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const cellKey = `${row}-${col}`
              const isOpened = cell.opened
              const isMine = cell.isMine && cell.opened
              const isHit = hitMinePos !== null && hitMinePos[0] === row && hitMinePos[1] === col

              return (
                <button
                  key={cellKey}
                  type="button"
                  className={`mine-sweep-cell ${isOpened ? 'opened' : 'closed'} ${isMine ? 'mine' : ''} ${isHit ? 'hit' : ''} ${cell.flagged && !cell.opened ? 'flagged' : ''}`}
                  disabled={gameOver || cell.opened}
                  onPointerDown={() => handlePointerDown(row, col)}
                  onPointerUp={() => handlePointerUp(row, col)}
                  onPointerLeave={handlePointerLeave}
                  onContextMenu={(e) => handleContextMenu(e, row, col)}
                  aria-label={`cell ${row} ${col}`}
                >
                  {getCellDisplay(cell, row, col)}
                </button>
              )
            }),
          )}
        </div>
      </div>

      <div className="mine-sweep-hint">
        <p>Tap to open | Long-press or right-click to flag</p>
      </div>

      {boardsCleared > 0 && getComboLabel(boardsCleared) !== '' && (
        <div className="ge-combo-label" style={{ fontSize: 16, color: getComboColor(boardsCleared), textAlign: 'center' }}>
          {getComboLabel(boardsCleared)}
        </div>
      )}

      <button className="text-button" type="button" onClick={handleExit}>
        Exit to Hub
      </button>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const mineSweepMiniModule: MiniGameModule = {
  manifest: {
    id: 'mine-sweep-mini',
    title: 'Mine Sweep',
    description: '지뢰를 피해 안전한 칸을 모두 열어라!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#64748b',
  },
  Component: MineSweepMiniGame,
}
