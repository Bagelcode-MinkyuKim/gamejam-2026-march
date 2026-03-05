import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const INITIAL_GRID_SIZE = 5
const MAX_GRID_SIZE = 9
const GRID_GROW_EVERY = 3
const ROUND_DURATION_MS = 60000
const CLEAR_BONUS_BASE = 20
const TIME_BONUS_MULTIPLIER = 0.5
const CELL_PX = 40
const WALL_PX = 4
const PLAYER_RADIUS = 14
const EXIT_RADIUS = 14
const MOVE_COOLDOWN_MS = 120

const COIN_SCORE = 8
const COIN_SPAWN_CHANCE = 0.25
const COIN_RADIUS = 6

const SPEED_BOOST_DURATION_MS = 5000
const SPEED_BOOST_COOLDOWN_MS = 50
const SPEED_BOOST_SPAWN_CHANCE = 0.12

const STREAK_MULTIPLIER_STEP = 3
const MAX_STREAK_MULTIPLIER = 5

function getGridSize(mazesCleared: number): number {
  return Math.min(MAX_GRID_SIZE, INITIAL_GRID_SIZE + Math.floor(mazesCleared / GRID_GROW_EVERY))
}

function getGridMetrics(gridSize: number) {
  const cellTotalPx = CELL_PX + WALL_PX
  const gridTotalPx = gridSize * cellTotalPx + WALL_PX
  return { cellTotalPx, gridTotalPx }
}

interface CoinItem {
  readonly row: number
  readonly col: number
  collected: boolean
}

interface SpeedBoost {
  readonly row: number
  readonly col: number
  collected: boolean
}

const DIR_UP = 0
const DIR_RIGHT = 1
const DIR_DOWN = 2
const DIR_LEFT = 3

type Direction = typeof DIR_UP | typeof DIR_RIGHT | typeof DIR_DOWN | typeof DIR_LEFT

const DX: readonly number[] = [0, 1, 0, -1]
const DY: readonly number[] = [-1, 0, 1, 0]

interface Cell {
  readonly walls: [boolean, boolean, boolean, boolean]
}

interface MazeGrid {
  readonly cells: Cell[][]
  readonly startRow: number
  readonly startCol: number
  readonly exitRow: number
  readonly exitCol: number
}

function oppositeDirection(dir: Direction): Direction {
  return ((dir + 2) % 4) as Direction
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

function generateMaze(gridSize: number): MazeGrid {
  const cells: { walls: [boolean, boolean, boolean, boolean] }[][] = []
  for (let row = 0; row < gridSize; row += 1) {
    const rowCells: { walls: [boolean, boolean, boolean, boolean] }[] = []
    for (let col = 0; col < gridSize; col += 1) {
      rowCells.push({ walls: [true, true, true, true] })
    }
    cells.push(rowCells)
  }

  const visited: boolean[][] = []
  for (let row = 0; row < gridSize; row += 1) {
    visited.push(new Array(gridSize).fill(false))
  }

  const stack: [number, number][] = []
  const startRow = 0
  const startCol = 0
  visited[startRow][startCol] = true
  stack.push([startRow, startCol])

  while (stack.length > 0) {
    const [currentRow, currentCol] = stack[stack.length - 1]
    const directions = shuffleArray<Direction>([DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT])

    let found = false
    for (const dir of directions) {
      const nextRow = currentRow + DY[dir]
      const nextCol = currentCol + DX[dir]

      if (nextRow < 0 || nextRow >= gridSize || nextCol < 0 || nextCol >= gridSize) {
        continue
      }

      if (visited[nextRow][nextCol]) {
        continue
      }

      cells[currentRow][currentCol].walls[dir] = false
      cells[nextRow][nextCol].walls[oppositeDirection(dir)] = false
      visited[nextRow][nextCol] = true
      stack.push([nextRow, nextCol])
      found = true
      break
    }

    if (!found) {
      stack.pop()
    }
  }

  const exitRow = gridSize - 1
  const exitCol = gridSize - 1

  return {
    cells,
    startRow,
    startCol,
    exitRow,
    exitCol,
  }
}

function generateCoins(gridSize: number, startRow: number, startCol: number, exitRow: number, exitCol: number): CoinItem[] {
  const coins: CoinItem[] = []
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (row === startRow && col === startCol) continue
      if (row === exitRow && col === exitCol) continue
      if (Math.random() < COIN_SPAWN_CHANCE) {
        coins.push({ row, col, collected: false })
      }
    }
  }
  return coins
}

function generateSpeedBoost(gridSize: number, startRow: number, startCol: number, exitRow: number, exitCol: number): SpeedBoost | null {
  if (Math.random() > SPEED_BOOST_SPAWN_CHANCE) return null
  for (let attempt = 0; attempt < 20; attempt++) {
    const row = Math.floor(Math.random() * gridSize)
    const col = Math.floor(Math.random() * gridSize)
    if (row === startRow && col === startCol) continue
    if (row === exitRow && col === exitCol) continue
    return { row, col, collected: false }
  }
  return null
}

function canMove(maze: MazeGrid, row: number, col: number, dir: Direction): boolean {
  const gridSize = maze.cells.length
  if (row < 0 || row >= gridSize || col < 0 || col >= gridSize) {
    return false
  }
  return !maze.cells[row][col].walls[dir]
}

function cellScreenX(col: number, cellTotalPx: number): number {
  return WALL_PX + col * cellTotalPx + CELL_PX / 2
}

function cellScreenY(row: number, cellTotalPx: number): number {
  return WALL_PX + row * cellTotalPx + CELL_PX / 2
}

function MazeRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const initialGridSize = getGridSize(0)
  const [maze, setMaze] = useState<MazeGrid>(() => generateMaze(initialGridSize))
  const [playerRow, setPlayerRow] = useState(0)
  const [playerCol, setPlayerCol] = useState(0)
  const [score, setScore] = useState(0)
  const [mazesCleared, setMazesCleared] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [flashClear, setFlashClear] = useState(false)
  const [currentGridSize, setCurrentGridSize] = useState(initialGridSize)
  const [coins, setCoins] = useState<CoinItem[]>(() => generateCoins(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [speedBoost, setSpeedBoost] = useState<SpeedBoost | null>(() => generateSpeedBoost(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [isSpeedBoosted, setIsSpeedBoosted] = useState(false)
  const [coinsCollected, setCoinsCollected] = useState(0)

  const effects = useGameEffects()

  const mazeRef = useRef<MazeGrid>(maze)
  const playerRowRef = useRef(0)
  const playerColRef = useRef(0)
  const scoreRef = useRef(0)
  const mazesClearedRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const lastMoveAtRef = useRef(0)
  const clearFlashTimerRef = useRef<number | null>(null)
  const currentGridSizeRef = useRef(initialGridSize)
  const coinsRef = useRef<CoinItem[]>(coins)
  const speedBoostRef = useRef<SpeedBoost | null>(speedBoost)
  const speedBoostTimerRef = useRef(0)
  const coinsCollectedRef = useRef(0)

  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) {
      return
    }
    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const advanceMaze = useCallback(() => {
    const nextCleared = mazesClearedRef.current + 1
    mazesClearedRef.current = nextCleared
    setMazesCleared(nextCleared)

    const timeLeft = remainingMsRef.current
    const timeBonus = Math.floor((timeLeft / 1000) * TIME_BONUS_MULTIPLIER)
    const streakMultiplier = Math.min(MAX_STREAK_MULTIPLIER, 1 + Math.floor(nextCleared / STREAK_MULTIPLIER_STEP))
    const clearScore = (CLEAR_BONUS_BASE + timeBonus) * streakMultiplier
    const nextScore = scoreRef.current + clearScore
    scoreRef.current = nextScore
    setScore(nextScore)

    const nextGridSize = getGridSize(nextCleared)
    currentGridSizeRef.current = nextGridSize
    setCurrentGridSize(nextGridSize)

    const nextMaze = generateMaze(nextGridSize)
    mazeRef.current = nextMaze
    setMaze(nextMaze)

    const nextCoins = generateCoins(nextGridSize, nextMaze.startRow, nextMaze.startCol, nextMaze.exitRow, nextMaze.exitCol)
    coinsRef.current = nextCoins
    setCoins(nextCoins)

    const nextBoost = generateSpeedBoost(nextGridSize, nextMaze.startRow, nextMaze.startCol, nextMaze.exitRow, nextMaze.exitCol)
    speedBoostRef.current = nextBoost
    setSpeedBoost(nextBoost)

    playerRowRef.current = nextMaze.startRow
    playerColRef.current = nextMaze.startCol
    setPlayerRow(nextMaze.startRow)
    setPlayerCol(nextMaze.startCol)

    setFlashClear(true)
    if (clearFlashTimerRef.current !== null) {
      window.clearTimeout(clearFlashTimerRef.current)
    }
    clearFlashTimerRef.current = window.setTimeout(() => {
      clearFlashTimerRef.current = null
      setFlashClear(false)
    }, 350)

    playSfx(tapStrongAudioRef.current, 0.6, 1.1)

    // Visual effects for maze clear
    effects.comboHitBurst(160, 160, nextCleared, clearScore)
    if (streakMultiplier > 1) {
      effects.triggerFlash('rgba(250,204,21,0.3)')
    }
  }, [playSfx])

  const movePlayer = useCallback(
    (dir: Direction) => {
      if (finishedRef.current) {
        return
      }

      const now = performance.now()
      const cooldown = speedBoostTimerRef.current > 0 ? SPEED_BOOST_COOLDOWN_MS : MOVE_COOLDOWN_MS
      if (now - lastMoveAtRef.current < cooldown) {
        return
      }

      const currentRow = playerRowRef.current
      const currentCol = playerColRef.current

      if (!canMove(mazeRef.current, currentRow, currentCol, dir)) {
        return
      }

      lastMoveAtRef.current = now

      const nextRow = currentRow + DY[dir]
      const nextCol = currentCol + DX[dir]
      playerRowRef.current = nextRow
      playerColRef.current = nextCol
      setPlayerRow(nextRow)
      setPlayerCol(nextCol)

      playSfx(tapAudioRef.current, 0.35, 1 + Math.random() * 0.1)

      // Check coin collection
      for (const coin of coinsRef.current) {
        if (!coin.collected && coin.row === nextRow && coin.col === nextCol) {
          coin.collected = true
          const coinScore = COIN_SCORE
          scoreRef.current += coinScore
          setScore(scoreRef.current)
          coinsCollectedRef.current += 1
          setCoinsCollected(coinsCollectedRef.current)
          setCoins([...coinsRef.current])
          playSfx(tapStrongAudioRef.current, 0.4, 1.3)
          const { cellTotalPx } = getGridMetrics(currentGridSizeRef.current)
          effects.showScorePopup(coinScore, cellScreenX(nextCol, cellTotalPx), cellScreenY(nextRow, cellTotalPx) - 10)
        }
      }

      // Check speed boost pickup
      const boost = speedBoostRef.current
      if (boost !== null && !boost.collected && boost.row === nextRow && boost.col === nextCol) {
        boost.collected = true
        speedBoostTimerRef.current = SPEED_BOOST_DURATION_MS
        setIsSpeedBoosted(true)
        setSpeedBoost({ ...boost, collected: true })
        playSfx(tapStrongAudioRef.current, 0.5, 1.5)
        effects.triggerFlash('rgba(59,130,246,0.3)')
      }

      if (nextRow === mazeRef.current.exitRow && nextCol === mazeRef.current.exitCol) {
        advanceMaze()
      }
    },
    [advanceMaze, playSfx],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true
    playSfx(gameOverAudioRef.current, 0.6, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playSfx])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current) {
        return
      }

      switch (event.code) {
        case 'Escape':
          event.preventDefault()
          onExit()
          break
        case 'ArrowUp':
        case 'KeyW':
          event.preventDefault()
          movePlayer(DIR_UP)
          break
        case 'ArrowRight':
        case 'KeyD':
          event.preventDefault()
          movePlayer(DIR_RIGHT)
          break
        case 'ArrowDown':
        case 'KeyS':
          event.preventDefault()
          movePlayer(DIR_DOWN)
          break
        case 'ArrowLeft':
        case 'KeyA':
          event.preventDefault()
          movePlayer(DIR_LEFT)
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [movePlayer, onExit])

  useEffect(() => {
    const tapAudio = new Audio(tapHitSfx)
    tapAudio.preload = 'auto'
    tapAudioRef.current = tapAudio

    const tapStrongAudio = new Audio(tapHitStrongSfx)
    tapStrongAudio.preload = 'auto'
    tapStrongAudioRef.current = tapStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      for (const audio of [tapAudio, tapStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
      if (clearFlashTimerRef.current !== null) {
        window.clearTimeout(clearFlashTimerRef.current)
        clearFlashTimerRef.current = null
      }
      effects.cleanup()
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

      // Speed boost timer
      if (speedBoostTimerRef.current > 0) {
        speedBoostTimerRef.current = Math.max(0, speedBoostTimerRef.current - deltaMs)
        if (speedBoostTimerRef.current <= 0) {
          setIsSpeedBoosted(false)
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
  const isLowTime = remainingMs <= 10000
  const comboLabel = getComboLabel(mazesCleared)
  const comboColor = getComboColor(mazesCleared)
  const gridSize = currentGridSize
  const { cellTotalPx, gridTotalPx } = getGridMetrics(gridSize)
  const streakMultiplier = Math.min(MAX_STREAK_MULTIPLIER, 1 + Math.floor(mazesCleared / STREAK_MULTIPLIER_STEP))

  const mazeWalls = useMemo(() => {
    const gs = maze.cells.length
    const { cellTotalPx: ctp, gridTotalPx: gtp } = getGridMetrics(gs)
    const walls: { key: string; x: number; y: number; width: number; height: number }[] = []

    walls.push({ key: 'border-top', x: 0, y: 0, width: gtp, height: WALL_PX })
    walls.push({ key: 'border-bottom', x: 0, y: gtp - WALL_PX, width: gtp, height: WALL_PX })
    walls.push({ key: 'border-left', x: 0, y: 0, width: WALL_PX, height: gtp })
    walls.push({ key: 'border-right', x: gtp - WALL_PX, y: 0, width: WALL_PX, height: gtp })

    for (let row = 0; row < gs; row += 1) {
      for (let col = 0; col < gs; col += 1) {
        const cell = maze.cells[row][col]
        const cellX = WALL_PX + col * ctp
        const cellY = WALL_PX + row * ctp

        if (cell.walls[DIR_RIGHT] && col < gs - 1) {
          walls.push({
            key: `r-${row}-${col}`,
            x: cellX + CELL_PX,
            y: cellY,
            width: WALL_PX,
            height: CELL_PX,
          })
        }

        if (cell.walls[DIR_DOWN] && row < gs - 1) {
          walls.push({
            key: `d-${row}-${col}`,
            x: cellX,
            y: cellY + CELL_PX,
            width: CELL_PX,
            height: WALL_PX,
          })
        }
      }
    }

    return walls
  }, [maze])

  const pScreenX = cellScreenX(playerCol, cellTotalPx)
  const pScreenY = cellScreenY(playerRow, cellTotalPx)
  const eScreenX = cellScreenX(maze.exitCol, cellTotalPx)
  const eScreenY = cellScreenY(maze.exitRow, cellTotalPx)

  return (
    <section className="mini-game-panel maze-run-panel" aria-label="maze-run-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .maze-run-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1e1b4b 0%, #312e81 30%, #1e293b 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
        }

        .maze-run-header {
          background: linear-gradient(135deg, #4f46e5, #4338ca);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .maze-run-header-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.4);
          object-fit: contain;
          background: rgba(255,255,255,0.1);
          flex-shrink: 0;
        }

        .maze-run-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .maze-run-header-score-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .maze-run-hud {
          display: none;
        }

        .maze-run-score {
          margin: 0;
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          line-height: 1.2;
        }

        .maze-run-best {
          margin: 0;
          font-size: 10px;
          color: rgba(255,255,255,0.6);
          font-weight: 600;
        }

        .maze-run-stats {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 6px 16px;
        }

        .maze-run-cleared {
          font-size: 11px;
          color: #4ade80;
          font-weight: 700;
        }

        .maze-run-time {
          font-size: 16px;
          color: rgba(255,255,255,0.9);
          font-weight: 700;
          font-variant-numeric: tabular-nums;
          margin-left: auto;
        }

        .maze-run-low-time {
          color: #fca5a5;
          animation: maze-run-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes maze-run-pulse {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }

        .maze-run-board {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 8px 12px;
          border-radius: 16px;
          overflow: hidden;
          border: 3px solid rgba(99,102,241,0.5);
          background: #1a1a2e;
          transition: box-shadow 0.3s ease;
          max-height: 320px;
        }

        .maze-run-clear-flash {
          box-shadow: 0 0 24px 4px rgba(34, 197, 94, 0.6);
        }

        .maze-run-svg {
          display: block;
          width: 100%;
          height: 100%;
        }

        .maze-run-dpad {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          padding: 8px 0;
        }

        .maze-run-dpad-row {
          display: flex;
          align-items: center;
          gap: 3px;
        }

        .maze-run-dpad-center {
          width: 52px;
          height: 52px;
        }

        .maze-run-dpad-button {
          width: 52px;
          height: 52px;
          border: 2px solid rgba(99,102,241,0.5);
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(79,70,229,0.4) 0%, rgba(49,46,129,0.6) 100%);
          color: #c7d2fe;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.1s, transform 0.08s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          box-shadow: 0 3px 8px rgba(0,0,0,0.25);
        }

        .maze-run-dpad-button:active {
          background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
          transform: scale(0.92);
          box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        .maze-run-actions {
          display: flex;
          gap: 8px;
          padding: 4px 12px 12px;
          justify-content: center;
        }

        .maze-run-action-button {
          padding: 8px 20px;
          border: 2px solid rgba(99,102,241,0.4);
          border-radius: 10px;
          background: linear-gradient(180deg, rgba(79,70,229,0.3) 0%, rgba(49,46,129,0.4) 100%);
          color: #e0e7ff;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          -webkit-tap-highlight-color: transparent;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }

        .maze-run-action-button:active {
          transform: scale(0.95);
        }

        .maze-run-action-button.ghost {
          background: transparent;
          color: rgba(255,255,255,0.4);
          border-color: rgba(255,255,255,0.15);
          box-shadow: none;
        }

        .maze-run-action-button.ghost:active {
          background: rgba(255,255,255,0.05);
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="maze-run-header">
        <img className="maze-run-header-avatar" src={seoTaijiImage} alt="서태지" />
        <div className="maze-run-header-info">
          <div className="maze-run-header-score-row">
            <p className="maze-run-score">{score}</p>
            <p className="maze-run-best">BEST {displayedBestScore}</p>
          </div>
        </div>
        <span className={`maze-run-time ${isLowTime ? 'maze-run-low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div className="maze-run-stats">
        <span className="maze-run-cleared">CLEARED {mazesCleared}</span>
        {streakMultiplier > 1 && (
          <span style={{ color: '#facc15', fontSize: 11, fontWeight: 800 }}>x{streakMultiplier}</span>
        )}
        {comboLabel && (
          <span className="ge-combo-label" style={{ color: comboColor, fontSize: 11 }}>{comboLabel}</span>
        )}
        <span style={{ color: '#fbbf24', fontSize: 11, fontWeight: 700 }}>COINS {coinsCollected}</span>
        {isSpeedBoosted && (
          <span style={{ color: '#60a5fa', fontSize: 11, fontWeight: 800, animation: 'maze-run-pulse 0.3s ease-in-out infinite alternate' }}>BOOST!</span>
        )}
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>{gridSize}x{gridSize}</span>
      </div>

      <div className={`maze-run-board ${flashClear ? 'maze-run-clear-flash' : ''}`}>
        <svg
          className="maze-run-svg"
          viewBox={`0 0 ${gridTotalPx} ${gridTotalPx}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="maze-grid"
        >
          <rect x="0" y="0" width={gridTotalPx} height={gridTotalPx} fill="#1a1a2e" />

          <rect
            x={WALL_PX + maze.exitCol * cellTotalPx + 2}
            y={WALL_PX + maze.exitRow * cellTotalPx + 2}
            width={CELL_PX - 4}
            height={CELL_PX - 4}
            rx="4"
            fill="#22c55e"
            opacity="0.35"
          >
            <animate attributeName="opacity" values="0.25;0.5;0.25" dur="1.6s" repeatCount="indefinite" />
          </rect>

          {/* Coins */}
          {coins.filter(c => !c.collected).map((coin, i) => (
            <circle
              key={`coin-${i}`}
              cx={cellScreenX(coin.col, cellTotalPx)}
              cy={cellScreenY(coin.row, cellTotalPx)}
              r={COIN_RADIUS}
              fill="#fbbf24"
              opacity="0.9"
            >
              <animate attributeName="r" values="5;7;5" dur="1s" repeatCount="indefinite" />
            </circle>
          ))}

          {/* Speed boost */}
          {speedBoost !== null && !speedBoost.collected && (
            <rect
              x={cellScreenX(speedBoost.col, cellTotalPx) - 7}
              y={cellScreenY(speedBoost.row, cellTotalPx) - 7}
              width={14}
              height={14}
              rx="3"
              fill="#3b82f6"
              opacity="0.9"
            >
              <animate attributeName="opacity" values="0.6;1;0.6" dur="0.8s" repeatCount="indefinite" />
            </rect>
          )}

          {mazeWalls.map((wall) => (
            <rect
              key={wall.key}
              x={wall.x}
              y={wall.y}
              width={wall.width}
              height={wall.height}
              fill="#6366f1"
            />
          ))}

          <circle cx={eScreenX} cy={eScreenY} r={EXIT_RADIUS} fill="#22c55e" opacity="0.8">
            <animate attributeName="r" values="10;14;10" dur="1.2s" repeatCount="indefinite" />
          </circle>
          <text
            x={eScreenX}
            y={eScreenY + 4}
            textAnchor="middle"
            fill="#fff"
            fontSize="11"
            fontWeight="bold"
            style={{ pointerEvents: 'none' }}
          >
            EXIT
          </text>

          <circle cx={pScreenX} cy={pScreenY} r={PLAYER_RADIUS} fill={isSpeedBoosted ? '#3b82f6' : '#f59e0b'} />
          <circle cx={pScreenX} cy={pScreenY} r={PLAYER_RADIUS - 3} fill={isSpeedBoosted ? '#60a5fa' : '#fbbf24'} />
          <circle cx={pScreenX - 3} cy={pScreenY - 3} r={3} fill="#fff" opacity="0.6" />
        </svg>
      </div>

      <div className="maze-run-dpad" role="group" aria-label="direction-controls">
        <div className="maze-run-dpad-row">
          <button
            className="maze-run-dpad-button"
            type="button"
            onClick={() => movePlayer(DIR_UP)}
            aria-label="up"
          >
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path d="M12 4 L4 16 L20 16 Z" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div className="maze-run-dpad-row">
          <button
            className="maze-run-dpad-button"
            type="button"
            onClick={() => movePlayer(DIR_LEFT)}
            aria-label="left"
          >
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path d="M4 12 L16 4 L16 20 Z" fill="currentColor" />
            </svg>
          </button>
          <div className="maze-run-dpad-center" />
          <button
            className="maze-run-dpad-button"
            type="button"
            onClick={() => movePlayer(DIR_RIGHT)}
            aria-label="right"
          >
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path d="M20 12 L8 4 L8 20 Z" fill="currentColor" />
            </svg>
          </button>
        </div>
        <div className="maze-run-dpad-row">
          <button
            className="maze-run-dpad-button"
            type="button"
            onClick={() => movePlayer(DIR_DOWN)}
            aria-label="down"
          >
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path d="M12 20 L4 8 L20 8 Z" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      <div className="maze-run-actions">
        <button className="maze-run-action-button" type="button" onClick={finishGame}>
          종료
        </button>
        <button className="maze-run-action-button ghost" type="button" onClick={onExit}>
          나가기
        </button>
      </div>
    </section>
  )
}

export const mazeRunModule: MiniGameModule = {
  manifest: {
    id: 'maze-run',
    title: 'Maze Run',
    description: '미로를 최대한 빠르게 탈출하라! 빠를수록 타임보너스!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#4f46e5',
  },
  Component: MazeRunGame,
}
