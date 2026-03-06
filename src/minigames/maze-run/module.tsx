import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

import stepSfx from '../../../assets/sounds/maze-run-step.mp3'
import coinSfx from '../../../assets/sounds/maze-run-coin.mp3'
import clearSfx from '../../../assets/sounds/maze-run-clear.mp3'
import boostSfx from '../../../assets/sounds/maze-run-boost.mp3'
import gameoverSfx from '../../../assets/sounds/maze-run-gameover.mp3'
import wallHitSfx from '../../../assets/sounds/maze-run-wall-hit.mp3'
import timeWarnSfx from '../../../assets/sounds/maze-run-time-warning.mp3'
import comboSfx from '../../../assets/sounds/maze-run-combo.mp3'
import teleportSfx from '../../../assets/sounds/maze-run-teleport.mp3'
import timeBonusSfx from '../../../assets/sounds/maze-run-time-bonus.mp3'

// ─── Constants ────────────────────────────────────────────
const INITIAL_GRID_SIZE = 5
const MAX_GRID_SIZE = 9
const GRID_GROW_EVERY = 3
const ROUND_DURATION_MS = 60000
const CLEAR_BONUS_BASE = 20
const TIME_BONUS_MULTIPLIER = 0.5
const CELL_PX = 36
const WALL_PX = 3
const PLAYER_RADIUS = 12
const EXIT_RADIUS = 12
const MOVE_COOLDOWN_MS = 100

const COIN_SCORE = 8
const COIN_SPAWN_CHANCE = 0.28
const COIN_RADIUS = 6

const SPEED_BOOST_DURATION_MS = 5000
const SPEED_BOOST_COOLDOWN_MS = 40
const SPEED_BOOST_SPAWN_CHANCE = 0.15

const STREAK_MULTIPLIER_STEP = 3
const MAX_STREAK_MULTIPLIER = 5

const TIME_BONUS_MS = 5000
const TIME_BONUS_SCORE = 5
const TIME_BONUS_SPAWN_CHANCE = 0.15

const TRAP_PENALTY_MS = 3000
const TRAP_SPAWN_CHANCE = 0.08

const TELEPORTER_SPAWN_CHANCE = 0.2

const SWIPE_THRESHOLD = 30

// ─── Types & Helpers ─────────────────────────────────────
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

interface CoinItem { readonly row: number; readonly col: number; collected: boolean }
interface SpeedBoost { readonly row: number; readonly col: number; collected: boolean }
interface TimeBonusItem { readonly row: number; readonly col: number; collected: boolean }
interface TrapItem { readonly row: number; readonly col: number; triggered: boolean }
interface Teleporter { readonly row1: number; readonly col1: number; readonly row2: number; readonly col2: number }
interface TrailPoint { readonly x: number; readonly y: number; readonly age: number }

function getGridSize(mazesCleared: number): number {
  return Math.min(MAX_GRID_SIZE, INITIAL_GRID_SIZE + Math.floor(mazesCleared / GRID_GROW_EVERY))
}

function getGridMetrics(gridSize: number) {
  const cellTotalPx = CELL_PX + WALL_PX
  const gridTotalPx = gridSize * cellTotalPx + WALL_PX
  return { cellTotalPx, gridTotalPx }
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
  visited[0][0] = true
  stack.push([0, 0])
  while (stack.length > 0) {
    const [currentRow, currentCol] = stack[stack.length - 1]
    const directions = shuffleArray<Direction>([DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT])
    let found = false
    for (const dir of directions) {
      const nextRow = currentRow + DY[dir]
      const nextCol = currentCol + DX[dir]
      if (nextRow < 0 || nextRow >= gridSize || nextCol < 0 || nextCol >= gridSize) continue
      if (visited[nextRow][nextCol]) continue
      cells[currentRow][currentCol].walls[dir] = false
      cells[nextRow][nextCol].walls[oppositeDirection(dir)] = false
      visited[nextRow][nextCol] = true
      stack.push([nextRow, nextCol])
      found = true
      break
    }
    if (!found) stack.pop()
  }
  return { cells, startRow: 0, startCol: 0, exitRow: gridSize - 1, exitCol: gridSize - 1 }
}

function isStartOrExit(row: number, col: number, startRow: number, startCol: number, exitRow: number, exitCol: number) {
  return (row === startRow && col === startCol) || (row === exitRow && col === exitCol)
}

function generateCoins(gridSize: number, sR: number, sC: number, eR: number, eC: number): CoinItem[] {
  const coins: CoinItem[] = []
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (isStartOrExit(row, col, sR, sC, eR, eC)) continue
      if (Math.random() < COIN_SPAWN_CHANCE) coins.push({ row, col, collected: false })
    }
  }
  return coins
}

function generateSpeedBoost(gridSize: number, sR: number, sC: number, eR: number, eC: number): SpeedBoost | null {
  if (Math.random() > SPEED_BOOST_SPAWN_CHANCE) return null
  for (let i = 0; i < 20; i++) {
    const row = Math.floor(Math.random() * gridSize)
    const col = Math.floor(Math.random() * gridSize)
    if (isStartOrExit(row, col, sR, sC, eR, eC)) continue
    return { row, col, collected: false }
  }
  return null
}

function generateTimeBonus(gridSize: number, sR: number, sC: number, eR: number, eC: number): TimeBonusItem | null {
  if (Math.random() > TIME_BONUS_SPAWN_CHANCE) return null
  for (let i = 0; i < 20; i++) {
    const row = Math.floor(Math.random() * gridSize)
    const col = Math.floor(Math.random() * gridSize)
    if (isStartOrExit(row, col, sR, sC, eR, eC)) continue
    return { row, col, collected: false }
  }
  return null
}

function generateTraps(gridSize: number, sR: number, sC: number, eR: number, eC: number): TrapItem[] {
  const traps: TrapItem[] = []
  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      if (isStartOrExit(row, col, sR, sC, eR, eC)) continue
      if (Math.random() < TRAP_SPAWN_CHANCE) traps.push({ row, col, triggered: false })
    }
  }
  return traps
}

function generateTeleporter(gridSize: number, sR: number, sC: number, eR: number, eC: number): Teleporter | null {
  if (gridSize < 6 || Math.random() > TELEPORTER_SPAWN_CHANCE) return null
  for (let i = 0; i < 30; i++) {
    const r1 = Math.floor(Math.random() * gridSize), c1 = Math.floor(Math.random() * gridSize)
    const r2 = Math.floor(Math.random() * gridSize), c2 = Math.floor(Math.random() * gridSize)
    if (isStartOrExit(r1, c1, sR, sC, eR, eC) || isStartOrExit(r2, c2, sR, sC, eR, eC)) continue
    if (r1 === r2 && c1 === c2) continue
    if (Math.abs(r1 - r2) + Math.abs(c1 - c2) < 3) continue
    return { row1: r1, col1: c1, row2: r2, col2: c2 }
  }
  return null
}

function canMove(maze: MazeGrid, row: number, col: number, dir: Direction): boolean {
  const gs = maze.cells.length
  if (row < 0 || row >= gs || col < 0 || col >= gs) return false
  return !maze.cells[row][col].walls[dir]
}

function cellScreenX(col: number, cellTotalPx: number): number {
  return WALL_PX + col * cellTotalPx + CELL_PX / 2
}

function cellScreenY(row: number, cellTotalPx: number): number {
  return WALL_PX + row * cellTotalPx + CELL_PX / 2
}

// ─── Game Component ──────────────────────────────────────
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
  const [timeBonus, setTimeBonus] = useState<TimeBonusItem | null>(() => generateTimeBonus(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [traps, setTraps] = useState<TrapItem[]>(() => generateTraps(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [teleporter, setTeleporter] = useState<Teleporter | null>(() => generateTeleporter(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [trail, setTrail] = useState<TrailPoint[]>([])
  const [wallBumpDir, setWallBumpDir] = useState<Direction | null>(null)
  const [trapFlash, setTrapFlash] = useState(false)
  const [, setTimeWarningPlayed] = useState(false)

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
  const timeBonusRef = useRef<TimeBonusItem | null>(timeBonus)
  const trapsRef = useRef<TrapItem[]>(traps)
  const teleporterRef = useRef<Teleporter | null>(teleporter)
  const trailRef = useRef<TrailPoint[]>([])
  const timeWarningPlayedRef = useRef(false)

  // Touch swipe refs
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  // Audio refs
  const audioPoolRef = useRef<Record<string, HTMLAudioElement>>({})

  const loadAudio = useCallback((key: string, src: string) => {
    if (!audioPoolRef.current[key]) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioPoolRef.current[key] = a
    }
    return audioPoolRef.current[key]
  }, [])

  const playSfx = useCallback((key: string, volume = 0.5, rate = 1) => {
    const a = audioPoolRef.current[key]
    if (!a) return
    a.currentTime = 0
    a.volume = volume
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  // Load all audio on mount
  useEffect(() => {
    loadAudio('step', stepSfx)
    loadAudio('coin', coinSfx)
    loadAudio('clear', clearSfx)
    loadAudio('boost', boostSfx)
    loadAudio('gameover', gameoverSfx)
    loadAudio('wallHit', wallHitSfx)
    loadAudio('timeWarn', timeWarnSfx)
    loadAudio('combo', comboSfx)
    loadAudio('teleport', teleportSfx)
    loadAudio('timeBonus', timeBonusSfx)
    return () => {
      for (const a of Object.values(audioPoolRef.current)) {
        a.pause()
        a.currentTime = 0
      }
      if (clearFlashTimerRef.current !== null) window.clearTimeout(clearFlashTimerRef.current)
      effects.cleanup()
    }
  }, [])

  const advanceMaze = useCallback(() => {
    const nextCleared = mazesClearedRef.current + 1
    mazesClearedRef.current = nextCleared
    setMazesCleared(nextCleared)

    const timeLeft = remainingMsRef.current
    const timeBonusVal = Math.floor((timeLeft / 1000) * TIME_BONUS_MULTIPLIER)
    const streakMultiplier = Math.min(MAX_STREAK_MULTIPLIER, 1 + Math.floor(nextCleared / STREAK_MULTIPLIER_STEP))
    const clearScore = (CLEAR_BONUS_BASE + timeBonusVal) * streakMultiplier
    const nextScore = scoreRef.current + clearScore
    scoreRef.current = nextScore
    setScore(nextScore)

    const nextGridSize = getGridSize(nextCleared)
    currentGridSizeRef.current = nextGridSize
    setCurrentGridSize(nextGridSize)

    const nextMaze = generateMaze(nextGridSize)
    mazeRef.current = nextMaze
    setMaze(nextMaze)

    const sR = nextMaze.startRow, sC = nextMaze.startCol, eR = nextMaze.exitRow, eC = nextMaze.exitCol
    coinsRef.current = generateCoins(nextGridSize, sR, sC, eR, eC)
    setCoins([...coinsRef.current])
    speedBoostRef.current = generateSpeedBoost(nextGridSize, sR, sC, eR, eC)
    setSpeedBoost(speedBoostRef.current)
    timeBonusRef.current = generateTimeBonus(nextGridSize, sR, sC, eR, eC)
    setTimeBonus(timeBonusRef.current)
    trapsRef.current = generateTraps(nextGridSize, sR, sC, eR, eC)
    setTraps([...trapsRef.current])
    teleporterRef.current = generateTeleporter(nextGridSize, sR, sC, eR, eC)
    setTeleporter(teleporterRef.current)

    playerRowRef.current = sR
    playerColRef.current = sC
    setPlayerRow(sR)
    setPlayerCol(sC)
    trailRef.current = []
    setTrail([])

    setFlashClear(true)
    if (clearFlashTimerRef.current !== null) window.clearTimeout(clearFlashTimerRef.current)
    clearFlashTimerRef.current = window.setTimeout(() => {
      clearFlashTimerRef.current = null
      setFlashClear(false)
    }, 400)

    playSfx('clear', 0.6, 1.1)
    if (streakMultiplier > 1) {
      playSfx('combo', 0.5, 1 + nextCleared * 0.05)
    }

    const { cellTotalPx } = getGridMetrics(nextGridSize)
    effects.comboHitBurst(cellScreenX(sC, cellTotalPx), cellScreenY(sR, cellTotalPx), nextCleared, clearScore)
    if (streakMultiplier > 1) {
      effects.triggerFlash('rgba(250,204,21,0.35)')
    } else {
      effects.triggerFlash('rgba(34,197,94,0.25)')
    }
  }, [playSfx, effects])

  const movePlayer = useCallback(
    (dir: Direction) => {
      if (finishedRef.current) return

      const now = performance.now()
      const cooldown = speedBoostTimerRef.current > 0 ? SPEED_BOOST_COOLDOWN_MS : MOVE_COOLDOWN_MS
      if (now - lastMoveAtRef.current < cooldown) return

      const currentRow = playerRowRef.current
      const currentCol = playerColRef.current

      if (!canMove(mazeRef.current, currentRow, currentCol, dir)) {
        playSfx('wallHit', 0.3, 0.8 + Math.random() * 0.4)
        setWallBumpDir(dir)
        setTimeout(() => setWallBumpDir(null), 150)
        effects.triggerShake(3)
        return
      }

      lastMoveAtRef.current = now
      const nextRow = currentRow + DY[dir]
      const nextCol = currentCol + DX[dir]
      playerRowRef.current = nextRow
      playerColRef.current = nextCol
      setPlayerRow(nextRow)
      setPlayerCol(nextCol)

      playSfx('step', 0.25, 0.9 + Math.random() * 0.2)

      // Trail
      const { cellTotalPx } = getGridMetrics(currentGridSizeRef.current)
      const newTrail = [...trailRef.current, { x: cellScreenX(currentCol, cellTotalPx), y: cellScreenY(currentRow, cellTotalPx), age: 0 }]
      if (newTrail.length > 20) newTrail.shift()
      trailRef.current = newTrail
      setTrail([...newTrail])

      // Check coin
      for (const coin of coinsRef.current) {
        if (!coin.collected && coin.row === nextRow && coin.col === nextCol) {
          coin.collected = true
          scoreRef.current += COIN_SCORE
          setScore(scoreRef.current)
          coinsCollectedRef.current += 1
          setCoinsCollected(coinsCollectedRef.current)
          setCoins([...coinsRef.current])
          playSfx('coin', 0.45, 1.2 + Math.random() * 0.2)
          effects.showScorePopup(COIN_SCORE, cellScreenX(nextCol, cellTotalPx), cellScreenY(nextRow, cellTotalPx) - 10)
        }
      }

      // Check speed boost
      const boost = speedBoostRef.current
      if (boost && !boost.collected && boost.row === nextRow && boost.col === nextCol) {
        boost.collected = true
        speedBoostTimerRef.current = SPEED_BOOST_DURATION_MS
        setIsSpeedBoosted(true)
        setSpeedBoost({ ...boost, collected: true })
        playSfx('boost', 0.5, 1.3)
        effects.triggerFlash('rgba(59,130,246,0.3)')
        effects.showScorePopup(0, cellScreenX(nextCol, cellTotalPx), cellScreenY(nextRow, cellTotalPx) - 10)
      }

      // Check time bonus
      const tb = timeBonusRef.current
      if (tb && !tb.collected && tb.row === nextRow && tb.col === nextCol) {
        tb.collected = true
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
        setRemainingMs(remainingMsRef.current)
        scoreRef.current += TIME_BONUS_SCORE
        setScore(scoreRef.current)
        setTimeBonus({ ...tb, collected: true })
        playSfx('timeBonus', 0.5, 1.1)
        effects.triggerFlash('rgba(52,211,153,0.25)')
        effects.showScorePopup(TIME_BONUS_SCORE, cellScreenX(nextCol, cellTotalPx), cellScreenY(nextRow, cellTotalPx) - 10)
      }

      // Check traps
      for (const trap of trapsRef.current) {
        if (!trap.triggered && trap.row === nextRow && trap.col === nextCol) {
          trap.triggered = true
          remainingMsRef.current = Math.max(0, remainingMsRef.current - TRAP_PENALTY_MS)
          setRemainingMs(remainingMsRef.current)
          setTraps([...trapsRef.current])
          playSfx('wallHit', 0.6, 0.5)
          effects.triggerShake(8)
          effects.triggerFlash('rgba(239,68,68,0.4)')
          setTrapFlash(true)
          setTimeout(() => setTrapFlash(false), 300)
        }
      }

      // Check teleporter
      const tp = teleporterRef.current
      if (tp) {
        if (nextRow === tp.row1 && nextCol === tp.col1) {
          playerRowRef.current = tp.row2
          playerColRef.current = tp.col2
          setPlayerRow(tp.row2)
          setPlayerCol(tp.col2)
          playSfx('teleport', 0.5, 1)
          effects.triggerFlash('rgba(168,85,247,0.3)')
        } else if (nextRow === tp.row2 && nextCol === tp.col2) {
          playerRowRef.current = tp.row1
          playerColRef.current = tp.col1
          setPlayerRow(tp.row1)
          setPlayerCol(tp.col1)
          playSfx('teleport', 0.5, 1)
          effects.triggerFlash('rgba(168,85,247,0.3)')
        }
      }

      // Check exit
      const finalRow = playerRowRef.current
      const finalCol = playerColRef.current
      if (finalRow === mazeRef.current.exitRow && finalCol === mazeRef.current.exitCol) {
        advanceMaze()
      }
    },
    [advanceMaze, playSfx, effects],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    playSfx('gameover', 0.6, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playSfx])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (finishedRef.current) return
      switch (e.code) {
        case 'Escape': e.preventDefault(); onExit(); break
        case 'ArrowUp': case 'KeyW': e.preventDefault(); movePlayer(DIR_UP); break
        case 'ArrowRight': case 'KeyD': e.preventDefault(); movePlayer(DIR_RIGHT); break
        case 'ArrowDown': case 'KeyS': e.preventDefault(); movePlayer(DIR_DOWN); break
        case 'ArrowLeft': case 'KeyA': e.preventDefault(); movePlayer(DIR_LEFT); break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [movePlayer, onExit])

  // Touch swipe on entire game area
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStartRef.current.x
    const dy = t.clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return
    if (Math.abs(dx) > Math.abs(dy)) {
      movePlayer(dx > 0 ? DIR_RIGHT : DIR_LEFT)
    } else {
      movePlayer(dy > 0 ? DIR_DOWN : DIR_UP)
    }
  }, [movePlayer])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Speed boost timer
      if (speedBoostTimerRef.current > 0) {
        speedBoostTimerRef.current = Math.max(0, speedBoostTimerRef.current - deltaMs)
        if (speedBoostTimerRef.current <= 0) setIsSpeedBoosted(false)
      }

      // Trail aging
      if (trailRef.current.length > 0) {
        trailRef.current = trailRef.current
          .map(t => ({ ...t, age: t.age + deltaMs }))
          .filter(t => t.age < 800)
        setTrail([...trailRef.current])
      }

      // Time warning at 10s
      if (remainingMsRef.current <= 10000 && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        setTimeWarningPlayed(true)
        playSfx('timeWarn', 0.5, 1)
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
  }, [finishGame, playSfx, effects])

  // ─── Derived values ────────────────────────────────────
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
    walls.push({ key: 'bt', x: 0, y: 0, width: gtp, height: WALL_PX })
    walls.push({ key: 'bb', x: 0, y: gtp - WALL_PX, width: gtp, height: WALL_PX })
    walls.push({ key: 'bl', x: 0, y: 0, width: WALL_PX, height: gtp })
    walls.push({ key: 'br', x: gtp - WALL_PX, y: 0, width: WALL_PX, height: gtp })
    for (let row = 0; row < gs; row += 1) {
      for (let col = 0; col < gs; col += 1) {
        const cell = maze.cells[row][col]
        const cellX = WALL_PX + col * ctp
        const cellY = WALL_PX + row * ctp
        if (cell.walls[DIR_RIGHT] && col < gs - 1) {
          walls.push({ key: `r-${row}-${col}`, x: cellX + CELL_PX, y: cellY, width: WALL_PX, height: CELL_PX })
        }
        if (cell.walls[DIR_DOWN] && row < gs - 1) {
          walls.push({ key: `d-${row}-${col}`, x: cellX, y: cellY + CELL_PX, width: CELL_PX, height: WALL_PX })
        }
      }
    }
    return walls
  }, [maze])

  const pScreenX = cellScreenX(playerCol, cellTotalPx)
  const pScreenY = cellScreenY(playerRow, cellTotalPx)
  const eScreenX = cellScreenX(maze.exitCol, cellTotalPx)
  const eScreenY = cellScreenY(maze.exitRow, cellTotalPx)

  // Player bump offset
  let playerOffsetX = 0, playerOffsetY = 0
  if (wallBumpDir !== null) {
    playerOffsetX = DX[wallBumpDir] * 3
    playerOffsetY = DY[wallBumpDir] * 3
  }

  // Time progress bar
  const timePercent = (remainingMs / ROUND_DURATION_MS) * 100

  return (
    <section
      className="mini-game-panel maze-run-panel"
      aria-label="maze-run-game"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .maze-run-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1e1b4b 0%, #312e81 30%, #1e293b 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          padding: 0;
          gap: 0;
        }

        .maze-run-topbar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          background: linear-gradient(135deg, #4f46e5, #4338ca);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .maze-run-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.4);
          object-fit: contain;
          background: rgba(255,255,255,0.1);
          flex-shrink: 0;
        }

        .maze-run-score-block {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .maze-run-score {
          margin: 0;
          font-size: 2rem;
          font-weight: 900;
          color: #fff;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          line-height: 1.1;
        }

        .maze-run-best {
          margin: 0;
          font-size: 0.65rem;
          color: rgba(255,255,255,0.5);
          font-weight: 600;
        }

        .maze-run-timer {
          text-align: right;
        }

        .maze-run-timer-text {
          font-size: 1.4rem;
          font-weight: 800;
          font-variant-numeric: tabular-nums;
          color: rgba(255,255,255,0.9);
        }

        .maze-run-timer-low {
          color: #fca5a5;
          animation: mr-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes mr-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.5; transform: scale(1.05); }
        }

        .maze-run-timebar {
          height: 4px;
          background: rgba(255,255,255,0.1);
          border-radius: 2px;
          margin: 0 14px 2px;
          overflow: hidden;
        }

        .maze-run-timebar-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.1s linear, background 0.3s;
        }

        .maze-run-stats {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 4px 14px;
          font-size: 0.7rem;
          font-weight: 700;
          flex-wrap: wrap;
        }

        .maze-run-board {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 4px 8px;
          border-radius: 14px;
          overflow: hidden;
          border: 2px solid rgba(99,102,241,0.4);
          background: #0f0f23;
          transition: box-shadow 0.3s ease;
          min-height: 0;
        }

        .maze-run-board-clear {
          box-shadow: 0 0 28px 6px rgba(34,197,94,0.6);
        }

        .maze-run-board-trap {
          box-shadow: 0 0 28px 6px rgba(239,68,68,0.6);
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
          gap: 4px;
          padding: 10px 0 6px;
        }

        .maze-run-dpad-row {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .maze-run-dpad-center {
          width: 56px;
          height: 56px;
        }

        .maze-run-dpad-btn {
          width: 56px;
          height: 56px;
          border: 2px solid rgba(99,102,241,0.5);
          border-radius: 14px;
          background: linear-gradient(180deg, rgba(79,70,229,0.45) 0%, rgba(49,46,129,0.65) 100%);
          color: #c7d2fe;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.08s, transform 0.06s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          box-shadow: 0 3px 8px rgba(0,0,0,0.3);
        }

        .maze-run-dpad-btn:active {
          background: linear-gradient(180deg, #6366f1 0%, #4f46e5 100%);
          transform: scale(0.9);
        }

        .maze-run-actions {
          display: flex;
          gap: 8px;
          padding: 2px 14px 10px;
          justify-content: center;
        }

        .maze-run-btn {
          padding: 10px 24px;
          border: 2px solid rgba(99,102,241,0.4);
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(79,70,229,0.3) 0%, rgba(49,46,129,0.4) 100%);
          color: #e0e7ff;
          font-size: 0.85rem;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          -webkit-tap-highlight-color: transparent;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }

        .maze-run-btn:active { transform: scale(0.94); }

        .maze-run-btn-ghost {
          background: transparent;
          color: rgba(255,255,255,0.35);
          border-color: rgba(255,255,255,0.12);
          box-shadow: none;
        }

        @keyframes mr-tp-glow {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Top bar */}
      <div className="maze-run-topbar">
        <img className="maze-run-avatar" src={seoTaijiImage} alt="" />
        <div className="maze-run-score-block">
          <p className="maze-run-score">{score}</p>
          <p className="maze-run-best">BEST {displayedBestScore}</p>
        </div>
        <div className="maze-run-timer">
          <span className={`maze-run-timer-text ${isLowTime ? 'maze-run-timer-low' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>

      {/* Time bar */}
      <div className="maze-run-timebar">
        <div
          className="maze-run-timebar-fill"
          style={{
            width: `${timePercent}%`,
            background: isLowTime
              ? 'linear-gradient(90deg, #ef4444, #f97316)'
              : 'linear-gradient(90deg, #22c55e, #4ade80)',
          }}
        />
      </div>

      {/* Stats row */}
      <div className="maze-run-stats">
        <span style={{ color: '#4ade80' }}>CLEARED {mazesCleared}</span>
        {streakMultiplier > 1 && <span style={{ color: '#facc15' }}>x{streakMultiplier}</span>}
        {comboLabel && <span style={{ color: comboColor }}>{comboLabel}</span>}
        <span style={{ color: '#fbbf24' }}>COINS {coinsCollected}</span>
        {isSpeedBoosted && <span style={{ color: '#60a5fa', animation: 'mr-pulse 0.3s ease-in-out infinite alternate' }}>BOOST!</span>}
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>{gridSize}x{gridSize}</span>
      </div>

      {/* Maze board - flex:1 fills all remaining vertical space */}
      <div className={`maze-run-board ${flashClear ? 'maze-run-board-clear' : ''} ${trapFlash ? 'maze-run-board-trap' : ''}`}>
        <svg
          className="maze-run-svg"
          viewBox={`0 0 ${gridTotalPx} ${gridTotalPx}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <radialGradient id="mr-exit-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="mr-player-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={isSpeedBoosted ? '#3b82f6' : '#f59e0b'} stopOpacity="0.4" />
              <stop offset="100%" stopColor={isSpeedBoosted ? '#3b82f6' : '#f59e0b'} stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect x="0" y="0" width={gridTotalPx} height={gridTotalPx} fill="#0f0f23" />

          {/* Exit cell glow */}
          <rect
            x={WALL_PX + maze.exitCol * cellTotalPx + 1}
            y={WALL_PX + maze.exitRow * cellTotalPx + 1}
            width={CELL_PX - 2}
            height={CELL_PX - 2}
            rx="4"
            fill="#22c55e"
            opacity="0.2"
          >
            <animate attributeName="opacity" values="0.15;0.35;0.15" dur="1.4s" repeatCount="indefinite" />
          </rect>

          {/* Trail */}
          {trail.map((t, i) => (
            <circle
              key={`trail-${i}`}
              cx={t.x}
              cy={t.y}
              r={3}
              fill={isSpeedBoosted ? '#60a5fa' : '#fbbf24'}
              opacity={Math.max(0, 1 - t.age / 800) * 0.4}
            />
          ))}

          {/* Coins */}
          {coins.filter(c => !c.collected).map((coin, i) => (
            <g key={`coin-${i}`}>
              <circle
                cx={cellScreenX(coin.col, cellTotalPx)}
                cy={cellScreenY(coin.row, cellTotalPx)}
                r={COIN_RADIUS}
                fill="#fbbf24"
                opacity="0.9"
              >
                <animate attributeName="r" values="4.5;6.5;4.5" dur="1s" repeatCount="indefinite" />
              </circle>
              <circle
                cx={cellScreenX(coin.col, cellTotalPx) - 1.5}
                cy={cellScreenY(coin.row, cellTotalPx) - 1.5}
                r={2}
                fill="#fff"
                opacity="0.5"
              />
            </g>
          ))}

          {/* Speed boost */}
          {speedBoost && !speedBoost.collected && (
            <g>
              <rect
                x={cellScreenX(speedBoost.col, cellTotalPx) - 7}
                y={cellScreenY(speedBoost.row, cellTotalPx) - 7}
                width={14} height={14} rx="3"
                fill="#3b82f6" opacity="0.9"
              >
                <animate attributeName="opacity" values="0.6;1;0.6" dur="0.7s" repeatCount="indefinite" />
              </rect>
              <text
                x={cellScreenX(speedBoost.col, cellTotalPx)}
                y={cellScreenY(speedBoost.row, cellTotalPx) + 3.5}
                textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >S</text>
            </g>
          )}

          {/* Time bonus */}
          {timeBonus && !timeBonus.collected && (
            <g>
              <circle
                cx={cellScreenX(timeBonus.col, cellTotalPx)}
                cy={cellScreenY(timeBonus.row, cellTotalPx)}
                r={7}
                fill="#34d399" opacity="0.85"
              >
                <animate attributeName="r" values="5;7.5;5" dur="1.2s" repeatCount="indefinite" />
              </circle>
              <text
                x={cellScreenX(timeBonus.col, cellTotalPx)}
                y={cellScreenY(timeBonus.row, cellTotalPx) + 3.5}
                textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold"
                style={{ pointerEvents: 'none' }}
              >+T</text>
            </g>
          )}

          {/* Traps */}
          {traps.filter(t => !t.triggered).map((trap, i) => (
            <g key={`trap-${i}`}>
              <rect
                x={cellScreenX(trap.col, cellTotalPx) - 6}
                y={cellScreenY(trap.row, cellTotalPx) - 6}
                width={12} height={12} rx="2"
                fill="#ef4444" opacity="0.2"
              />
              <text
                x={cellScreenX(trap.col, cellTotalPx)}
                y={cellScreenY(trap.row, cellTotalPx) + 3}
                textAnchor="middle" fill="#ef4444" fontSize="7" fontWeight="bold" opacity="0.4"
                style={{ pointerEvents: 'none' }}
              >!</text>
            </g>
          ))}

          {/* Teleporter portals */}
          {teleporter && (
            <>
              <circle
                cx={cellScreenX(teleporter.col1, cellTotalPx)}
                cy={cellScreenY(teleporter.row1, cellTotalPx)}
                r={8}
                fill="none" stroke="#a855f7" strokeWidth="2"
                style={{ animation: 'mr-tp-glow 1s ease-in-out infinite' }}
              />
              <circle
                cx={cellScreenX(teleporter.col1, cellTotalPx)}
                cy={cellScreenY(teleporter.row1, cellTotalPx)}
                r={4}
                fill="#a855f7" opacity="0.5"
              >
                <animate attributeName="r" values="3;5;3" dur="1s" repeatCount="indefinite" />
              </circle>
              <circle
                cx={cellScreenX(teleporter.col2, cellTotalPx)}
                cy={cellScreenY(teleporter.row2, cellTotalPx)}
                r={8}
                fill="none" stroke="#a855f7" strokeWidth="2"
                style={{ animation: 'mr-tp-glow 1s ease-in-out infinite' }}
              />
              <circle
                cx={cellScreenX(teleporter.col2, cellTotalPx)}
                cy={cellScreenY(teleporter.row2, cellTotalPx)}
                r={4}
                fill="#a855f7" opacity="0.5"
              >
                <animate attributeName="r" values="3;5;3" dur="1s" repeatCount="indefinite" />
              </circle>
            </>
          )}

          {/* Walls */}
          {mazeWalls.map((wall) => (
            <rect
              key={wall.key}
              x={wall.x} y={wall.y}
              width={wall.width} height={wall.height}
              fill="#6366f1"
            />
          ))}

          {/* Exit marker */}
          <circle cx={eScreenX} cy={eScreenY} r={EXIT_RADIUS * 1.8} fill="url(#mr-exit-glow)" />
          <circle cx={eScreenX} cy={eScreenY} r={EXIT_RADIUS} fill="#22c55e" opacity="0.85">
            <animate attributeName="r" values="9;13;9" dur="1.2s" repeatCount="indefinite" />
          </circle>
          <text
            x={eScreenX} y={eScreenY + 4}
            textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold"
            style={{ pointerEvents: 'none' }}
          >EXIT</text>

          {/* Player glow */}
          <circle
            cx={pScreenX + playerOffsetX}
            cy={pScreenY + playerOffsetY}
            r={PLAYER_RADIUS * 2}
            fill="url(#mr-player-glow)"
          />

          {/* Player */}
          <circle
            cx={pScreenX + playerOffsetX}
            cy={pScreenY + playerOffsetY}
            r={PLAYER_RADIUS}
            fill={isSpeedBoosted ? '#3b82f6' : '#f59e0b'}
          />
          <circle
            cx={pScreenX + playerOffsetX}
            cy={pScreenY + playerOffsetY}
            r={PLAYER_RADIUS - 3}
            fill={isSpeedBoosted ? '#60a5fa' : '#fbbf24'}
          />
          <circle
            cx={pScreenX + playerOffsetX - 3}
            cy={pScreenY + playerOffsetY - 3}
            r={3}
            fill="#fff" opacity="0.7"
          />
          {isSpeedBoosted && (
            <circle
              cx={pScreenX + playerOffsetX}
              cy={pScreenY + playerOffsetY}
              r={PLAYER_RADIUS + 2}
              fill="none" stroke="#60a5fa" strokeWidth="1.5" opacity="0.6"
            >
              <animate attributeName="r" values={`${PLAYER_RADIUS + 1};${PLAYER_RADIUS + 5};${PLAYER_RADIUS + 1}`} dur="0.6s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;0.2;0.6" dur="0.6s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
      </div>

      {/* D-pad */}
      <div className="maze-run-dpad" role="group" aria-label="controls">
        <div className="maze-run-dpad-row">
          <button className="maze-run-dpad-btn" type="button" onClick={() => movePlayer(DIR_UP)} aria-label="up">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 4 L4 16 L20 16 Z" fill="currentColor" /></svg>
          </button>
        </div>
        <div className="maze-run-dpad-row">
          <button className="maze-run-dpad-btn" type="button" onClick={() => movePlayer(DIR_LEFT)} aria-label="left">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M4 12 L16 4 L16 20 Z" fill="currentColor" /></svg>
          </button>
          <div className="maze-run-dpad-center" />
          <button className="maze-run-dpad-btn" type="button" onClick={() => movePlayer(DIR_RIGHT)} aria-label="right">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M20 12 L8 4 L8 20 Z" fill="currentColor" /></svg>
          </button>
        </div>
        <div className="maze-run-dpad-row">
          <button className="maze-run-dpad-btn" type="button" onClick={() => movePlayer(DIR_DOWN)} aria-label="down">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 20 L4 8 L20 8 Z" fill="currentColor" /></svg>
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="maze-run-actions">
        <button className="maze-run-btn" type="button" onClick={finishGame}>FINISH</button>
        <button className="maze-run-btn maze-run-btn-ghost" type="button" onClick={onExit}>EXIT</button>
      </div>
    </section>
  )
}

export const mazeRunModule: MiniGameModule = {
  manifest: {
    id: 'maze-run',
    title: 'Maze Run',
    description: 'Escape the maze fast! Speed = time bonus!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#4f46e5',
  },
  Component: MazeRunGame,
}
