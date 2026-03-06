import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import revealSfx from '../../../assets/sounds/mine-sweep-reveal.mp3'
import flagSfx from '../../../assets/sounds/mine-sweep-flag.mp3'
import explodeSfx from '../../../assets/sounds/mine-sweep-explode.mp3'
import clearSfx from '../../../assets/sounds/mine-sweep-clear.mp3'
import chainSfx from '../../../assets/sounds/mine-sweep-chain.mp3'
import feverSfx from '../../../assets/sounds/mine-sweep-fever.mp3'
import warningSfx from '../../../assets/sounds/mine-sweep-warning.mp3'
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
const HINT_COST = 5
const SHIELD_COST = 15
const TIME_BONUS_COST = 10
const TIME_BONUS_MS = 10000

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
  hinted: boolean
}

type BoardState = {
  cells: CellState[][]
  minesPlaced: boolean
}

const NUMBER_COLORS: Record<number, string> = {
  1: '#4a90d9',
  2: '#5cb85c',
  3: '#d9534f',
  4: '#9b59b6',
  5: '#8b0000',
  6: '#17a2b8',
  7: '#2c3e50',
  8: '#7f8c8d',
}

function createEmptyBoard(): BoardState {
  const cells: CellState[][] = []
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowCells: CellState[] = []
    for (let col = 0; col < GRID_SIZE; col += 1) {
      rowCells.push({ isMine: false, adjacentMines: 0, opened: false, flagged: false, hinted: false })
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

const MINE_SWEEP_CSS = `
.ms-panel {
  max-width: 432px;
  width: 100%;
  height: 100%;
  margin: 0 auto;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  background:
    repeating-linear-gradient(0deg, rgba(139,119,101,0.03) 0px, transparent 2px, transparent 4px),
    linear-gradient(180deg, #ede9df 0%, #e2ddd3 100%);
  padding: 8px;
  gap: 6px;
}
.ms-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #3a3a4a;
  border: 3px solid #2a2a38;
  border-radius: 6px;
  box-shadow: inset 0 -2px 0 #4a4a5a, 0 2px 0 #1a1a28;
}
.ms-score {
  margin: 0;
  font-size: clamp(1rem, 3.5vw, 1.4rem);
  color: #fbbf24;
  text-shadow: 0 0 6px rgba(251,191,36,0.6), 2px 2px 0 #1a1a28;
}
.ms-best {
  margin: 0;
  font-size: clamp(0.45rem, 1.5vw, 0.55rem);
  color: #9ca3af;
}
.ms-time {
  margin: 0;
  font-size: clamp(0.9rem, 3vw, 1.2rem);
  color: #5cb85c;
  text-shadow: 2px 2px 0 #1a1a28;
}
.ms-time.low-time {
  color: #ef4444;
  animation: ms-time-pulse 0.5s ease-in-out infinite alternate;
}
@keyframes ms-time-pulse {
  from { opacity: 0.6; transform: scale(1); }
  to { opacity: 1; transform: scale(1.08); }
}
.ms-info-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: rgba(58,58,74,0.85);
  border: 2px solid #2a2a38;
  border-radius: 4px;
  gap: 8px;
}
.ms-info-item {
  margin: 0;
  font-size: clamp(0.42rem, 1.4vw, 0.52rem);
  color: #d1d5db;
  display: flex;
  align-items: center;
  gap: 4px;
}
.ms-info-item strong {
  color: #fbbf24;
  font-size: clamp(0.55rem, 1.8vw, 0.65rem);
}
.ms-fever-banner {
  text-align: center;
  color: #fbbf24;
  font-weight: 800;
  font-size: clamp(0.6rem, 2vw, 0.8rem);
  animation: ms-fever-pulse 0.5s ease-in-out infinite alternate;
  text-shadow: 0 0 8px #f59e0b, 0 0 16px rgba(245,158,11,0.4);
  padding: 4px;
  background: linear-gradient(90deg, transparent, rgba(251,191,36,0.1), transparent);
  border-radius: 4px;
}
@keyframes ms-fever-pulse {
  from { opacity: 0.7; transform: scale(1); }
  to { opacity: 1; transform: scale(1.05); }
}
.ms-grid-wrapper {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  min-height: 0;
}
.ms-grid-wrapper.game-over {
  filter: saturate(0.3) brightness(0.8);
}
.ms-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  gap: 2px;
  width: 100%;
  max-width: 400px;
  aspect-ratio: 1;
  padding: 4px;
  background: #2a2a38;
  border: 3px solid #1a1a28;
  border-radius: 4px;
  box-shadow: inset 0 0 8px rgba(0,0,0,0.3), 0 4px 0 #1a1a28;
}
.ms-cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  cursor: pointer;
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(0.55rem, 2.2vw, 0.85rem);
  font-weight: 800;
  transition: transform 0.08s;
  -webkit-user-select: none;
  user-select: none;
  touch-action: manipulation;
  image-rendering: pixelated;
}
.ms-cell.closed {
  background: linear-gradient(135deg, #7a8899 0%, #5a6877 50%, #4a5867 100%);
  border-top: 2px solid #9aabb8;
  border-left: 2px solid #8a9aa8;
  border-bottom: 2px solid #3a4857;
  border-right: 2px solid #3a4857;
  box-shadow: inset 0 0 2px rgba(255,255,255,0.15);
}
.ms-cell.closed:hover:not(:disabled) {
  background: linear-gradient(135deg, #8a98a9 0%, #6a7887 50%, #5a6877 100%);
  transform: scale(1.04);
}
.ms-cell.closed:active:not(:disabled) {
  border-top: 2px solid #3a4857;
  border-left: 2px solid #3a4857;
  border-bottom: 2px solid #9aabb8;
  border-right: 2px solid #8a9aa8;
  transform: scale(0.96);
}
.ms-cell.opened {
  background: #ddd8cd;
  border: 1px solid #c5c0b5;
}
.ms-cell.mine {
  background: #4a4a5a;
}
.ms-cell.hit {
  background: #c0392b !important;
  animation: ms-cell-explode 0.4s ease-out;
}
@keyframes ms-cell-explode {
  0% { transform: scale(1); }
  30% { transform: scale(1.3); }
  100% { transform: scale(1); }
}
.ms-cell.flagged {
  background: linear-gradient(135deg, #6a7a89 0%, #4a5a69 100%);
  border-top: 2px solid #8a9aa8;
  border-left: 2px solid #8a9aa8;
  border-bottom: 2px solid #3a4857;
  border-right: 2px solid #3a4857;
}
.ms-cell.hinted {
  animation: ms-hint-glow 1s ease-in-out infinite alternate;
}
@keyframes ms-hint-glow {
  from { box-shadow: inset 0 0 4px rgba(92,184,92,0.3); }
  to { box-shadow: inset 0 0 8px rgba(92,184,92,0.7); }
}
.ms-cell-opened-anim {
  animation: ms-cell-open 0.2s ease-out;
}
@keyframes ms-cell-open {
  from { transform: scale(0.7); opacity: 0.5; }
  to { transform: scale(1); opacity: 1; }
}
.ms-flag {
  color: #d9534f;
  font-size: clamp(0.5rem, 2vw, 0.75rem);
  text-shadow: 1px 1px 0 #1a1a28;
}
.ms-mine-icon {
  font-size: clamp(0.5rem, 2vw, 0.75rem);
  color: #1a1a28;
  text-shadow: 0 0 4px rgba(239,68,68,0.8);
}
.ms-mine-icon.hit-icon {
  color: #fff;
  text-shadow: 0 0 8px #ef4444, 0 0 16px rgba(239,68,68,0.6);
  animation: ms-mine-flash 0.3s ease-in-out infinite alternate;
}
@keyframes ms-mine-flash {
  from { opacity: 0.8; }
  to { opacity: 1; }
}
.ms-number {
  text-shadow: 1px 1px 0 rgba(0,0,0,0.2);
}
.ms-progress-bar {
  width: 100%;
  height: 6px;
  background: #2a2a38;
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid #1a1a28;
}
.ms-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #5cb85c, #4a90d9);
  transition: width 0.3s ease;
  border-radius: 3px;
}
.ms-progress-fill.fever {
  background: linear-gradient(90deg, #fbbf24, #f59e0b, #fbbf24);
  background-size: 200% 100%;
  animation: ms-fever-bar 0.6s linear infinite;
}
@keyframes ms-fever-bar {
  from { background-position: 0% 0%; }
  to { background-position: 200% 0%; }
}
.ms-power-bar {
  display: flex;
  gap: 4px;
  padding: 4px;
}
.ms-power-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 4px;
  background: linear-gradient(180deg, #4a5a6a, #3a4a5a);
  border: 2px solid #2a3a4a;
  border-top-color: #6a7a8a;
  border-left-color: #5a6a7a;
  border-radius: 4px;
  color: #d1d5db;
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(0.32rem, 1.2vw, 0.4rem);
  cursor: pointer;
  transition: transform 0.1s;
  box-shadow: 0 2px 0 #1a2a3a;
}
.ms-power-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, #5a6a7a, #4a5a6a);
  transform: translateY(-1px);
}
.ms-power-btn:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: none;
}
.ms-power-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
.ms-power-icon {
  font-size: clamp(0.7rem, 2.5vw, 1rem);
}
.ms-power-cost {
  color: #fbbf24;
  font-size: clamp(0.28rem, 1vw, 0.35rem);
}
.ms-hint-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  font-size: clamp(0.35rem, 1.2vw, 0.42rem);
  color: #9ca3af;
  gap: 4px;
}
.ms-exit-btn {
  padding: 6px 12px;
  background: linear-gradient(180deg, #5a4a4a, #4a3a3a);
  border: 2px solid #3a2a2a;
  border-top-color: #7a6a6a;
  border-left-color: #6a5a5a;
  border-radius: 4px;
  color: #e5e5e5;
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(0.35rem, 1.2vw, 0.42rem);
  cursor: pointer;
  box-shadow: 0 2px 0 #2a1a1a;
  text-align: center;
}
.ms-exit-btn:hover {
  background: linear-gradient(180deg, #6a5a5a, #5a4a4a);
}
.ms-combo-label {
  text-align: center;
  font-size: clamp(0.5rem, 1.8vw, 0.65rem);
  font-weight: 800;
  padding: 2px;
}
.ms-board-clear-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.3);
  z-index: 10;
  animation: ms-clear-fade 0.6s ease-out forwards;
}
@keyframes ms-clear-fade {
  0% { opacity: 0; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.1); }
  100% { opacity: 0; transform: scale(1.3); }
}
.ms-clear-text {
  color: #fbbf24;
  font-size: clamp(1.5rem, 6vw, 2.5rem);
  font-weight: 800;
  text-shadow: 0 0 12px #f59e0b, 3px 3px 0 #1a1a28;
  animation: ms-clear-bounce 0.6s ease-out;
}
@keyframes ms-clear-bounce {
  0% { transform: scale(0); }
  60% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
.ms-cell-reveal-cascade {
  animation: ms-cascade-pop 0.25s ease-out;
}
@keyframes ms-cascade-pop {
  0% { transform: scale(0.5) rotate(-10deg); opacity: 0; }
  60% { transform: scale(1.1) rotate(2deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}
.ms-time-bar {
  width: 100%;
  height: 4px;
  background: #2a2a38;
  border-radius: 2px;
  overflow: hidden;
}
.ms-time-fill {
  height: 100%;
  transition: width 0.1s linear;
  border-radius: 2px;
}
`

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
  const [showClearOverlay, setShowClearOverlay] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [openedCellKeys, setOpenedCellKeys] = useState<Set<string>>(new Set())
  const [flagMode, setFlagMode] = useState(false)

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
  const warningPlayedRef = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)

  const revealAudioRef = useRef<HTMLAudioElement | null>(null)
  const flagAudioRef = useRef<HTMLAudioElement | null>(null)
  const explodeAudioRef = useRef<HTMLAudioElement | null>(null)
  const clearAudioRef = useRef<HTMLAudioElement | null>(null)
  const chainAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const warningAudioRef = useRef<HTMLAudioElement | null>(null)

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) return
      audio.currentTime = 0
      audio.volume = Math.min(1, Math.max(0, volume))
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const getCellCenter = useCallback((row: number, col: number): [number, number] => {
    const grid = gridRef.current
    if (!grid) return [col * 48 + 24, row * 48 + 24]
    const rect = grid.getBoundingClientRect()
    const cellW = rect.width / GRID_SIZE
    const cellH = rect.height / GRID_SIZE
    return [col * cellW + cellW / 2, row * cellH + cellH / 2]
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const handleMineHit = useCallback(
    (row: number, col: number) => {
      if (hasShield) {
        setHasShield(false)
        const nextBoard = cloneBoard(boardRef.current)
        nextBoard.cells[row][col].flagged = true
        boardRef.current = nextBoard
        setBoard(nextBoard)
        playAudio(flagAudioRef, 0.6, 1.2)
        effects.triggerFlash('rgba(92,184,92,0.4)')
        effects.triggerShake(3)
        const [cx, cy] = getCellCenter(row, col)
        effects.showScorePopup(0, cx, cy)
        effects.spawnParticles(4, cx, cy, ['*'])
        return
      }

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

      playAudio(explodeAudioRef, 0.8, 0.9)
      effects.triggerFlash('rgba(239,68,68,0.5)')
      effects.triggerShake(10)
      const [cx, cy] = getCellCenter(row, col)
      effects.spawnParticles(8, cx, cy, ['*', 'x', '#'])

      window.setTimeout(() => { finishGame() }, 1200)
    },
    [finishGame, playAudio, hasShield, getCellCenter],
  )

  const startNewBoard = useCallback(() => {
    const nextBoard = createEmptyBoard()
    boardRef.current = nextBoard
    setBoard(nextBoard)
    setHitMinePos(null)
    setGameOver(false)
    setOpenedCellKeys(new Set())
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
    if (boardDurationMs < FAST_CLEAR_THRESHOLD_MS) bonus += FAST_CLEAR_BONUS
    if (feverActive) bonus *= FEVER_SCORE_MULTIPLIER

    const nextScore = scoreRef.current + bonus
    scoreRef.current = nextScore
    setScore(nextScore)

    if (feverActive) {
      playAudio(feverAudioRef, 0.7, 1.0)
    } else {
      playAudio(clearAudioRef, 0.7, 1.0 + nextCleared * 0.05)
    }
    effects.comboHitBurst(200, 200, nextCleared, bonus)
    effects.triggerFlash(feverActive ? 'rgba(250,204,21,0.5)' : 'rgba(34,197,94,0.4)')

    setShowClearOverlay(true)
    window.setTimeout(() => { setShowClearOverlay(false) }, 600)

    window.setTimeout(() => {
      if (!finishedRef.current) startNewBoard()
    }, 700)
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
        const newKeys = new Set(openedCellKeys)
        for (let r = 0; r < GRID_SIZE; r += 1) {
          for (let c = 0; c < GRID_SIZE; c += 1) {
            if (nextBoard.cells[r][c].opened) newKeys.add(`${r}-${c}`)
          }
        }
        setOpenedCellKeys(newKeys)

        const isChainReveal = opened >= CHAIN_REVEAL_THRESHOLD
        const points = isChainReveal ? opened * CHAIN_REVEAL_MULTIPLIER : opened
        const nextScore = scoreRef.current + points
        scoreRef.current = nextScore
        setScore(nextScore)

        if (isChainReveal) {
          playAudio(chainAudioRef, 0.6, 1 + opened * 0.02)
        } else {
          playAudio(revealAudioRef, 0.5, 1 + opened * 0.05)
        }

        const [cx, cy] = getCellCenter(row, col)
        effects.showScorePopup(points, cx, cy)
        if (opened >= 5) {
          effects.comboHitBurst(cx, cy, opened, points)
        } else {
          effects.spawnParticles(Math.min(opened, 4), cx, cy)
          effects.triggerShake(Math.min(opened, 4))
        }
      }

      const totalOpened = countOpenedSafe(nextBoard)
      if (totalOpened === getSafeCells(currentLevelRef.current)) {
        handleBoardClear()
      }
    },
    [gameOver, handleBoardClear, handleMineHit, playAudio, openedCellKeys, getCellCenter],
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

      playAudio(flagAudioRef, 0.5, nextBoard.cells[row][col].flagged ? 1.0 : 0.8)
    },
    [gameOver, playAudio],
  )

  const handleCellAction = useCallback(
    (row: number, col: number) => {
      if (flagMode) {
        toggleFlag(row, col)
      } else {
        openCell(row, col)
      }
    },
    [flagMode, openCell, toggleFlag],
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
        if (flagMode) {
          openCell(row, col)
        } else {
          toggleFlag(row, col)
        }
      }, LONG_PRESS_MS)
    },
    [gameOver, toggleFlag, openCell, flagMode],
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

      handleCellAction(row, col)
    },
    [handleCellAction],
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

  const useHint = useCallback(() => {
    if (scoreRef.current < HINT_COST || !boardRef.current.minesPlaced || gameOver) return

    const currentBoard = boardRef.current
    const safeClosed: [number, number][] = []
    for (let r = 0; r < GRID_SIZE; r += 1) {
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const cell = currentBoard.cells[r][c]
        if (!cell.opened && !cell.flagged && !cell.isMine && !cell.hinted) {
          safeClosed.push([r, c])
        }
      }
    }
    if (safeClosed.length === 0) return

    const nextScore = scoreRef.current - HINT_COST
    scoreRef.current = nextScore
    setScore(nextScore)

    const [hr, hc] = safeClosed[Math.floor(Math.random() * safeClosed.length)]
    const nextBoard = cloneBoard(currentBoard)
    nextBoard.cells[hr][hc].hinted = true
    boardRef.current = nextBoard
    setBoard(nextBoard)
    playAudio(revealAudioRef, 0.4, 1.5)
    const [cx, cy] = getCellCenter(hr, hc)
    effects.spawnParticles(2, cx, cy, ['?'])
  }, [gameOver, playAudio, getCellCenter])

  const useShield = useCallback(() => {
    if (scoreRef.current < SHIELD_COST || hasShield || gameOver) return
    const nextScore = scoreRef.current - SHIELD_COST
    scoreRef.current = nextScore
    setScore(nextScore)
    setHasShield(true)
    playAudio(flagAudioRef, 0.6, 1.3)
    effects.triggerFlash('rgba(92,184,92,0.3)')
  }, [hasShield, gameOver, playAudio])

  const useTimeBonus = useCallback(() => {
    if (scoreRef.current < TIME_BONUS_COST || gameOver) return
    const nextScore = scoreRef.current - TIME_BONUS_COST
    scoreRef.current = nextScore
    setScore(nextScore)
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
    setRemainingMs(remainingMsRef.current)
    playAudio(clearAudioRef, 0.5, 1.2)
    effects.triggerFlash('rgba(74,144,217,0.3)')
  }, [gameOver, playAudio])

  useEffect(() => {
    const audios: [{ current: HTMLAudioElement | null }, string][] = [
      [revealAudioRef, revealSfx],
      [flagAudioRef, flagSfx],
      [explodeAudioRef, explodeSfx],
      [clearAudioRef, clearSfx],
      [chainAudioRef, chainSfx],
      [feverAudioRef, feverSfx],
      [warningAudioRef, warningSfx],
    ]
    for (const [ref, src] of audios) {
      const a = new Audio(src)
      a.preload = 'auto'
      ref.current = a
    }

    return () => {
      for (const [ref] of audios) ref.current = null
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
        onExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      effects.updateParticles()

      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !warningPlayedRef.current) {
        warningPlayedRef.current = true
        playAudio(warningAudioRef, 0.5, 1.0)
      }

      if (remainingMsRef.current <= 0) {
        playAudio(explodeAudioRef, 0.5, 0.7)
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
  const totalSafe = getSafeCells(currentLevelRef.current)
  const openedSafe = useMemo(() => countOpenedSafe(board), [board])
  const progressPct = totalSafe > 0 ? (openedSafe / totalSafe) * 100 : 0
  const timeBarPct = (remainingMs / ROUND_DURATION_MS) * 100
  const timeBarColor = isLowTime ? '#ef4444' : remainingMs < 30000 ? '#f59e0b' : '#5cb85c'

  const getCellDisplay = (cell: CellState, row: number, col: number): React.ReactNode => {
    if (cell.flagged && !cell.opened) {
      return <span className="ms-flag">F</span>
    }

    if (!cell.opened) {
      if (cell.hinted) {
        return <span style={{ color: '#5cb85c', fontSize: 'clamp(0.4rem, 1.5vw, 0.6rem)' }}>?</span>
      }
      return null
    }

    if (cell.isMine) {
      const isHit = hitMinePos !== null && hitMinePos[0] === row && hitMinePos[1] === col
      return <span className={`ms-mine-icon ${isHit ? 'hit-icon' : ''}`}>*</span>
    }

    if (cell.adjacentMines > 0) {
      return (
        <span className="ms-number" style={{ color: NUMBER_COLORS[cell.adjacentMines] ?? '#1f2937' }}>
          {cell.adjacentMines}
        </span>
      )
    }

    return null
  }

  return (
    <section className="mini-game-panel ms-panel" aria-label="mine-sweep-mini-game" style={effects.getShakeStyle()}>
      <style>{GAME_EFFECTS_CSS}</style>
      <style>{MINE_SWEEP_CSS}</style>

      <div className="ms-header">
        <div>
          <p className="ms-score">{score.toLocaleString()}</p>
          <p className="ms-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`ms-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="ms-time-bar">
        <div className="ms-time-fill" style={{ width: `${timeBarPct}%`, background: timeBarColor }} />
      </div>

      <div className="ms-info-bar">
        <p className="ms-info-item">
          * <strong>{minesRemaining}</strong>
        </p>
        <p className="ms-info-item">
          Lv.<strong>{currentLevel + 1}</strong>
        </p>
        <p className="ms-info-item">
          CLR <strong>{boardsCleared}</strong>
        </p>
        {hasShield && (
          <p className="ms-info-item" style={{ color: '#5cb85c' }}>
            SHIELD
          </p>
        )}
      </div>

      <div className="ms-progress-bar">
        <div className={`ms-progress-fill ${isFever ? 'fever' : ''}`} style={{ width: `${progressPct}%` }} />
      </div>

      {isFever && (
        <div className="ms-fever-banner">
          FEVER x{FEVER_SCORE_MULTIPLIER}
        </div>
      )}

      <div className={`ms-grid-wrapper ${gameOver ? 'game-over' : ''}`}>
        <div className="ms-grid" ref={gridRef}>
          {board.cells.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const cellKey = `${row}-${col}`
              const isOpened = cell.opened
              const isMine = cell.isMine && cell.opened
              const isHit = hitMinePos !== null && hitMinePos[0] === row && hitMinePos[1] === col
              const isNewlyOpened = isOpened && openedCellKeys.has(cellKey)

              return (
                <button
                  key={cellKey}
                  type="button"
                  className={`ms-cell ${isOpened ? 'opened' : 'closed'} ${isMine ? 'mine' : ''} ${isHit ? 'hit' : ''} ${cell.flagged && !cell.opened ? 'flagged' : ''} ${cell.hinted && !cell.opened ? 'hinted' : ''} ${isNewlyOpened ? 'ms-cell-reveal-cascade' : ''}`}
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
        {showClearOverlay && (
          <div className="ms-board-clear-overlay">
            <span className="ms-clear-text">CLEAR!</span>
          </div>
        )}
      </div>

      <div className="ms-power-bar">
        <button
          type="button"
          className="ms-power-btn"
          onClick={() => setFlagMode(!flagMode)}
          style={flagMode ? { background: 'linear-gradient(180deg, #8b4a4a, #6a3a3a)', borderColor: '#d9534f' } : undefined}
        >
          <span className="ms-power-icon">F</span>
          <span>{flagMode ? 'FLAG ON' : 'FLAG'}</span>
        </button>
        <button type="button" className="ms-power-btn" onClick={useHint} disabled={score < HINT_COST || !board.minesPlaced || gameOver}>
          <span className="ms-power-icon">?</span>
          <span>HINT</span>
          <span className="ms-power-cost">-{HINT_COST}pt</span>
        </button>
        <button type="button" className="ms-power-btn" onClick={useShield} disabled={score < SHIELD_COST || hasShield || gameOver}>
          <span className="ms-power-icon">#</span>
          <span>SHIELD</span>
          <span className="ms-power-cost">-{SHIELD_COST}pt</span>
        </button>
        <button type="button" className="ms-power-btn" onClick={useTimeBonus} disabled={score < TIME_BONUS_COST || gameOver}>
          <span className="ms-power-icon">+</span>
          <span>+10s</span>
          <span className="ms-power-cost">-{TIME_BONUS_COST}pt</span>
        </button>
      </div>

      {boardsCleared > 0 && getComboLabel(boardsCleared) !== '' && (
        <div className="ms-combo-label" style={{ color: getComboColor(boardsCleared) }}>
          {getComboLabel(boardsCleared)}
        </div>
      )}

      <div className="ms-hint-bar">
        <span>TAP: {flagMode ? 'FLAG' : 'OPEN'}</span>
        <span>|</span>
        <span>HOLD: {flagMode ? 'OPEN' : 'FLAG'}</span>
      </div>

      <button className="ms-exit-btn" type="button" onClick={onExit}>
        EXIT
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
    description: 'Open all safe tiles avoiding mines!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#64748b',
  },
  Component: MineSweepMiniGame,
}
