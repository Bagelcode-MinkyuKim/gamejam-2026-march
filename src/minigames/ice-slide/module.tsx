import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/seo-taiji.png'
import swooshSfx from '../../../assets/sounds/ice-slide-swoosh.mp3'
import crackSfx from '../../../assets/sounds/ice-slide-crack.mp3'
import clearSfx from '../../../assets/sounds/ice-slide-clear.mp3'
import stageClearSfx from '../../../assets/sounds/ice-slide-stage-clear.mp3'
import teleportSfx from '../../../assets/sounds/ice-slide-teleport.mp3'
import feverSfx from '../../../assets/sounds/ice-slide-fever.mp3'
import gemSfx from '../../../assets/sounds/ice-slide-gem.mp3'
import snowflakeSfx from '../../../assets/sounds/ice-slide-snowflake.mp3'
import gameoverSfx from '../../../assets/sounds/ice-slide-gameover.mp3'
import bgmSrc from '../../../assets/sounds/ice-slide-bgm.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

void clearSfx

// --- Config ---
const GRID_SIZE = 8
const INITIAL_DURATION_MS = 30000
const MAX_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 10000
const MOVE_ANIMATION_MS = 100
const BONUS_THRESHOLD_MOVES = 8
const BONUS_PER_SAVED_MOVE = 3
const BASE_CLEAR_SCORE = 20
const SCORE_ESCALATION = 5
const STREAK_MULTIPLIER_THRESHOLD = 3
const TIME_BONUS_BASE = 8000
const TIME_BONUS_PER_STAGE = 1000
const SPEED_BONUS_THRESHOLD_MS = 8000
const SPEED_BONUS_SCORE = 15
const FEVER_STREAK_THRESHOLD = 5
const FEVER_MULTIPLIER = 2
const GEM_SCORE = 10
const SNOWFLAKE_TIME_BONUS = 3000
const SWIPE_DEAD_ZONE = 20
const STAGE_TRANSITION_MS = 600
const WALL_HIT_COOLDOWN_MS = 200

// --- Types ---
type CellType = 'ice' | 'wall' | 'exit' | 'crack' | 'teleport' | 'gem' | 'spring' | 'snowflake'
type Direction = 'up' | 'down' | 'left' | 'right'

interface Position { readonly row: number; readonly col: number }

interface StageLayout {
  readonly grid: CellType[][]
  readonly start: Position
  readonly exit: Position
  readonly teleportPairs?: [Position, Position][]
}

// --- Pixel art tile characters ---
const TILE_CHARS: Record<CellType, string> = {
  ice: '',
  wall: '',
  exit: 'GO',
  crack: '~',
  teleport: '@',
  gem: '*',
  spring: '^',
  snowflake: '+',
}

// --- BFS Solver for ice sliding ---
function slideOnIce(grid: CellType[][], from: Position, direction: Direction): { destination: Position; passedCells: Position[]; hitWall: boolean } {
  let row = from.row
  let col = from.col
  const passed: Position[] = []
  let hitWall = false
  const dRow = direction === 'up' ? -1 : direction === 'down' ? 1 : 0
  const dCol = direction === 'left' ? -1 : direction === 'right' ? 1 : 0

  while (true) {
    const nextRow = row + dRow
    const nextCol = col + dCol
    if (nextRow < 0 || nextRow >= GRID_SIZE || nextCol < 0 || nextCol >= GRID_SIZE) { hitWall = true; break }
    const nextCell = grid[nextRow][nextCol]
    if (nextCell === 'wall') { hitWall = true; break }
    row = nextRow
    col = nextCol
    passed.push({ row, col })
    if (nextCell === 'exit' || nextCell === 'teleport' || nextCell === 'crack' || nextCell === 'spring') break
  }
  return { destination: { row, col }, passedCells: passed, hitWall }
}

function canSolveFrom(grid: CellType[][], from: Position, exit: Position, teleportPairs?: [Position, Position][]): boolean {
  const exitKey = `${exit.row},${exit.col}`
  const visited = new Set<string>()
  const queue: Position[] = [from]
  visited.add(`${from.row},${from.col}`)

  const directions: Direction[] = ['up', 'down', 'left', 'right']

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dir of directions) {
      const { destination } = slideOnIce(grid, current, dir)
      const key = `${destination.row},${destination.col}`
      if (key === exitKey) return true

      const destCell = grid[destination.row][destination.col]
      let finalPos = destination
      if (destCell === 'teleport' && teleportPairs) {
        for (const [a, b] of teleportPairs) {
          if (a.row === destination.row && a.col === destination.col) { finalPos = b; break }
          if (b.row === destination.row && b.col === destination.col) { finalPos = a; break }
        }
      }
      if (destCell === 'spring') {
        const reverseDir: Direction = dir === 'up' ? 'down' : dir === 'down' ? 'up' : dir === 'left' ? 'right' : 'left'
        const bounce = slideOnIce(grid, destination, reverseDir)
        finalPos = bounce.destination
        const bounceKey = `${finalPos.row},${finalPos.col}`
        if (bounceKey === exitKey) return true
        if (!visited.has(bounceKey)) { visited.add(bounceKey); queue.push(finalPos) }
        continue
      }

      const finalKey = `${finalPos.row},${finalPos.col}`
      if (finalKey === exitKey) return true
      if (!visited.has(finalKey)) { visited.add(finalKey); queue.push(finalPos) }
    }
  }
  return false
}

function canSolveStage(stage: StageLayout): boolean {
  return canSolveFrom(stage.grid, stage.start, stage.exit, stage.teleportPairs)
}

// --- Procedural stage generation (path-first approach) ---
function generateStage(stageNumber: number): StageLayout {
  const maxAttempts = 100
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stage = buildStageWithPath(stageNumber)
    if (canSolveStage(stage)) return stage
  }
  return makeFallbackStage(stageNumber)
}

function makeEmptyGrid(): CellType[][] {
  const grid: CellType[][] = Array.from({ length: GRID_SIZE }, () => Array<CellType>(GRID_SIZE).fill('ice'))
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (r === 0 || r === GRID_SIZE - 1 || c === 0 || c === GRID_SIZE - 1) grid[r][c] = 'wall'
    }
  }
  return grid
}

function buildStageWithPath(stageNumber: number): StageLayout {
  const grid = makeEmptyGrid()
  const difficulty = Math.min(stageNumber, 15)

  // Pick start corner region and exit on opposite side
  const startRow = Math.random() < 0.5 ? 1 : GRID_SIZE - 2
  const startCol = Math.random() < 0.5 ? 1 : GRID_SIZE - 2
  const start: Position = { row: startRow, col: startCol }

  // Exit on opposite side
  const exitRow = startRow === 1 ? GRID_SIZE - 1 : 0
  const exitCol = 1 + Math.floor(Math.random() * (GRID_SIZE - 2))
  grid[exitRow][exitCol] = 'exit'
  const exit: Position = { row: exitRow, col: exitCol }

  // Ensure the inner cell adjacent to exit is clear
  const exitAdjacentRow = exitRow === 0 ? 1 : GRID_SIZE - 2
  grid[exitAdjacentRow][exitCol] = 'ice'

  // Build guaranteed path using waypoints with stopper walls
  // Strategy: create 2-4 waypoints between start and exit, place walls to stop at each
  const waypointCount = 2 + Math.floor(Math.random() * 2) // 2-3 waypoints
  const waypoints: Position[] = [start]

  for (let i = 0; i < waypointCount; i++) {
    const prev = waypoints[waypoints.length - 1]
    // Pick a random inner position reachable by sliding (same row or col, or create stopper)
    let wp: Position
    if (i % 2 === 0) {
      // Horizontal move: same row, different col
      const targetCol = 1 + Math.floor(Math.random() * (GRID_SIZE - 2))
      wp = { row: prev.row, col: targetCol }
      // Place stopper wall AFTER the waypoint in the slide direction
      const stopCol = targetCol > prev.col ? Math.min(targetCol + 1, GRID_SIZE - 1) : Math.max(targetCol - 1, 0)
      if (stopCol > 0 && stopCol < GRID_SIZE - 1 && grid[prev.row][stopCol] === 'ice') {
        grid[prev.row][stopCol] = 'wall'
      }
    } else {
      // Vertical move: same col, different row
      const targetRow = 1 + Math.floor(Math.random() * (GRID_SIZE - 2))
      wp = { row: targetRow, col: prev.col }
      const stopRow = targetRow > prev.row ? Math.min(targetRow + 1, GRID_SIZE - 1) : Math.max(targetRow - 1, 0)
      if (stopRow > 0 && stopRow < GRID_SIZE - 1 && grid[stopRow][prev.col] === 'ice') {
        grid[stopRow][prev.col] = 'wall'
      }
    }
    // Ensure waypoint cell is ice
    if (wp.row > 0 && wp.row < GRID_SIZE - 1 && wp.col > 0 && wp.col < GRID_SIZE - 1) {
      grid[wp.row][wp.col] = 'ice'
    }
    waypoints.push(wp)
  }

  // Clear the path between consecutive waypoints (ensure no walls block slides)
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]
    const b = waypoints[i + 1]
    if (a.row === b.row) {
      const minC = Math.min(a.col, b.col)
      const maxC = Math.max(a.col, b.col)
      for (let c = minC; c <= maxC; c++) {
        if (grid[a.row][c] === 'wall' && !(a.row === 0 || a.row === GRID_SIZE - 1 || c === 0 || c === GRID_SIZE - 1)) {
          grid[a.row][c] = 'ice'
        }
      }
    } else if (a.col === b.col) {
      const minR = Math.min(a.row, b.row)
      const maxR = Math.max(a.row, b.row)
      for (let r = minR; r <= maxR; r++) {
        if (grid[r][a.col] === 'wall' && !(r === 0 || r === GRID_SIZE - 1 || a.col === 0 || a.col === GRID_SIZE - 1)) {
          grid[r][a.col] = 'ice'
        }
      }
    }
  }

  // Also clear path from last waypoint to exit column/row
  const lastWp = waypoints[waypoints.length - 1]
  // Clear column to exit
  const minR2 = Math.min(lastWp.row, exitAdjacentRow)
  const maxR2 = Math.max(lastWp.row, exitAdjacentRow)
  for (let r = minR2; r <= maxR2; r++) {
    if (grid[r][exitCol] === 'wall' && r > 0 && r < GRID_SIZE - 1) {
      grid[r][exitCol] = 'ice'
    }
  }

  // Add random extra walls for difficulty (only on non-path cells)
  const wallBudget = Math.floor(3 + difficulty * 1.2)
  const innerCells: Position[] = []
  for (let r = 1; r < GRID_SIZE - 1; r++) {
    for (let c = 1; c < GRID_SIZE - 1; c++) {
      if (grid[r][c] === 'ice' && !(r === start.row && c === start.col)) {
        innerCells.push({ row: r, col: c })
      }
    }
  }
  const shuffled = innerCells.sort(() => Math.random() - 0.5)
  let wallsPlaced = 0
  for (const pos of shuffled) {
    if (wallsPlaced >= wallBudget) break
    // Don't block exit adjacent cell
    if (pos.row === exitAdjacentRow && pos.col === exitCol) continue
    grid[pos.row][pos.col] = 'wall'
    // Quick solvability check - revert if blocks path
    if (!canSolveFrom(grid, start, exit)) {
      grid[pos.row][pos.col] = 'ice'
    } else {
      wallsPlaced++
    }
  }

  // Place special tiles on remaining ice cells
  const freeCells = innerCells.filter(p =>
    grid[p.row][p.col] === 'ice' && !(p.row === start.row && p.col === start.col)
  ).sort(() => Math.random() - 0.5)
  let idx = 0

  // Gems
  const gemCount = Math.min(Math.floor(difficulty / 2) + 1, 4)
  for (let i = 0; i < gemCount && idx < freeCells.length; i++, idx++) {
    grid[freeCells[idx].row][freeCells[idx].col] = 'gem'
  }

  // Snowflakes (stage 2+)
  if (stageNumber >= 1) {
    const snowCount = Math.min(Math.floor(difficulty / 3) + 1, 2)
    for (let i = 0; i < snowCount && idx < freeCells.length; i++, idx++) {
      grid[freeCells[idx].row][freeCells[idx].col] = 'snowflake'
    }
  }

  // Crack tiles (stage 3+) - place carefully, verify solvability after each
  if (stageNumber >= 2) {
    const crackCount = Math.min(Math.floor((difficulty - 1) / 3), 3)
    for (let i = 0; i < crackCount && idx < freeCells.length; i++, idx++) {
      const cell = freeCells[idx]
      grid[cell.row][cell.col] = 'crack'
      // Simulate crack becoming wall and verify still solvable from start
      const testGrid = deepCopyGrid(grid)
      testGrid[cell.row][cell.col] = 'wall'
      if (!canSolveFrom(testGrid, start, exit)) {
        grid[cell.row][cell.col] = 'ice' // revert, too dangerous
      }
    }
  }

  return { grid, start, exit }
}

function makeFallbackStage(stageNumber = 0): StageLayout {
  // Deterministic fallback stages that are guaranteed solvable
  const patterns: StageLayout[] = [
    {
      grid: [
        ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'ice',  'ice',  'wall', 'ice',  'ice',  'ice',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'wall', 'ice',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'exit', 'wall'],
      ],
      start: { row: 1, col: 1 }, exit: { row: 7, col: 6 },
    },
    {
      grid: [
        ['wall', 'wall', 'wall', 'exit', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'gem',  'wall'],
        ['wall', 'ice',  'wall', 'ice',  'ice',  'wall', 'ice',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'ice',  'wall'],
        ['wall', 'wall', 'ice',  'ice',  'ice',  'ice',  'wall', 'wall'],
        ['wall', 'ice',  'ice',  'wall', 'ice',  'ice',  'ice',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ],
      start: { row: 6, col: 1 }, exit: { row: 0, col: 3 },
    },
    {
      grid: [
        ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
        ['wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'ice',  'wall'],
        ['wall', 'ice',  'wall', 'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'ice',  'ice',  'wall', 'ice',  'wall', 'ice',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'wall', 'ice',  'ice',  'wall', 'ice',  'gem',  'wall'],
        ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
        ['wall', 'wall', 'wall', 'wall', 'exit', 'wall', 'wall', 'wall'],
      ],
      start: { row: 1, col: 1 }, exit: { row: 7, col: 4 },
    },
  ]
  return deepCopyStage(patterns[stageNumber % patterns.length])
}

function deepCopyStage(stage: StageLayout): StageLayout {
  return { grid: deepCopyGrid(stage.grid), start: { ...stage.start }, exit: { ...stage.exit }, teleportPairs: stage.teleportPairs }
}

function deepCopyGrid(grid: CellType[][]): CellType[][] {
  return grid.map(row => [...row])
}

function reverseDirection(d: Direction): Direction {
  return d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left'
}

// --- Trail ---
interface TrailDot { id: number; row: number; col: number }
interface PixelSparkle { id: number; x: number; y: number; color: string }

// Generate initial stage ONCE outside component to avoid multiple random generations
const INITIAL_STAGE = generateStage(0)
const INITIAL_GRID = deepCopyGrid(INITIAL_STAGE.grid)

function IceSlideGame({ onFinish, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(INITIAL_DURATION_MS)
  const [stagesCleared, setStagesCleared] = useState(0)
  const [moveCount, setMoveCount] = useState(0)
  const [playerPos, setPlayerPos] = useState<Position>(INITIAL_STAGE.start)
  const [targetPos, setTargetPos] = useState<Position | null>(null)
  const [isSliding, setIsSliding] = useState(false)
  const [isClearFlash, setIsClearFlash] = useState(false)
  const [streak, setStreak] = useState(0)
  const [lastClearBonusText, setLastClearBonusText] = useState('')
  const [isFever, setIsFever] = useState(false)
  const [liveGrid, setLiveGrid] = useState<CellType[][]>(() => deepCopyGrid(INITIAL_GRID))
  const [trails, setTrails] = useState<TrailDot[]>([])
  const [gemsCollected, setGemsCollected] = useState(0)
  const [showTeleportFlash, setShowTeleportFlash] = useState(false)
  const [playerDirection, setPlayerDirection] = useState<Direction>('down')
  const [stageTransition, setStageTransition] = useState(false)
  const [sparkles, setSparkles] = useState<PixelSparkle[]>([])
  const [wallHitEffect, setWallHitEffect] = useState(false)
  const [springBounce, setSpringBounce] = useState(false)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(INITIAL_DURATION_MS)
  const stagesClearedRef = useRef(0)
  const moveCountRef = useRef(0)
  const currentStageRef = useRef<StageLayout>(INITIAL_STAGE)
  const playerPosRef = useRef<Position>(INITIAL_STAGE.start)
  const finishedRef = useRef(false)
  const isSlidingRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const clearFlashTimerRef = useRef<number | null>(null)
  const streakRef = useRef(0)
  const stageStartMsRef = useRef(0)
  const isFeverRef = useRef(false)
  const bonusTextTimerRef = useRef<number | null>(null)
  const liveGridRef = useRef<CellType[][]>(deepCopyGrid(INITIAL_GRID))
  const trailIdRef = useRef(0)
  const gemsRef = useRef(0)
  const sparkleIdRef = useRef(0)
  const wallHitTimerRef = useRef<number | null>(null)
  const touchIdRef = useRef<number | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const audioCache = useRef<Record<string, HTMLAudioElement>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  // BGM loop
  useEffect(() => {
    const bgm = new Audio(bgmSrc)
    bgm.loop = true
    bgm.volume = 0.3
    bgmRef.current = bgm
    void bgm.play().catch(() => {})
    return () => { bgm.pause(); bgm.currentTime = 0; bgmRef.current = null }
  }, [])

  const playSound = useCallback((src: string, volume = 0.5, rate = 1) => {
    let audio = audioCache.current[src]
    if (!audio) { audio = new Audio(src); audio.preload = 'auto'; audioCache.current[src] = audio }
    audio.currentTime = 0; audio.volume = volume; audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
  }

  const addTrails = useCallback((cells: Position[]) => {
    const newTrails = cells.map(c => ({ id: ++trailIdRef.current, row: c.row, col: c.col }))
    setTrails(prev => [...prev, ...newTrails])
    window.setTimeout(() => {
      setTrails(prev => prev.filter(t => !newTrails.some(nt => nt.id === t.id)))
    }, 500)
  }, [])

  const spawnSparkles = useCallback((cx: number, cy: number, color: string, count = 6) => {
    const newSparkles: PixelSparkle[] = []
    for (let i = 0; i < count; i++) {
      newSparkles.push({ id: ++sparkleIdRef.current, x: cx + (Math.random() - 0.5) * 60, y: cy + (Math.random() - 0.5) * 60, color })
    }
    setSparkles(prev => [...prev, ...newSparkles])
    window.setTimeout(() => {
      setSparkles(prev => prev.filter(s => !newSparkles.some(ns => ns.id === s.id)))
    }, 500)
  }, [])

  const handleTeleport = useCallback((pos: Position): Position | null => {
    const stage = currentStageRef.current
    if (!stage.teleportPairs) return null
    for (const [a, b] of stage.teleportPairs) {
      if (a.row === pos.row && a.col === pos.col) return b
      if (b.row === pos.row && b.col === pos.col) return a
    }
    return null
  }, [])

  const advanceStage = useCallback(() => {
    const clearedMoves = moveCountRef.current
    const savedMoves = Math.max(0, BONUS_THRESHOLD_MOVES - clearedMoves)
    const escalation = stagesClearedRef.current * SCORE_ESCALATION
    const nextStreak = streakRef.current + 1
    streakRef.current = nextStreak
    setStreak(nextStreak)

    const streakMult = nextStreak >= STREAK_MULTIPLIER_THRESHOLD ? 1 + Math.floor(nextStreak / STREAK_MULTIPLIER_THRESHOLD) * 0.5 : 1
    const elapsedOnStageMs = (INITIAL_DURATION_MS - remainingMsRef.current) - stageStartMsRef.current
    const speedBonus = elapsedOnStageMs < SPEED_BONUS_THRESHOLD_MS ? SPEED_BONUS_SCORE : 0

    if (nextStreak >= FEVER_STREAK_THRESHOLD && !isFeverRef.current) {
      isFeverRef.current = true; setIsFever(true)
      effects.triggerFlash('#ffdd57'); playSound(feverSfx, 0.6)
    }
    const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1

    const gemBonus = gemsRef.current * GEM_SCORE
    const baseClearScore = BASE_CLEAR_SCORE + escalation + savedMoves * BONUS_PER_SAVED_MOVE + speedBonus + gemBonus
    const clearScore = Math.round(baseClearScore * streakMult * feverMult)
    const nextScore = scoreRef.current + clearScore
    scoreRef.current = nextScore; setScore(nextScore)

    // Time bonus - increases with stages cleared
    const timeBonus = TIME_BONUS_BASE + Math.min(stagesClearedRef.current * TIME_BONUS_PER_STAGE, 15000)
    remainingMsRef.current = Math.min(MAX_DURATION_MS, remainingMsRef.current + timeBonus)

    const bonusParts: string[] = [`+${clearScore}`]
    if (speedBonus > 0) bonusParts.push('SPEED!')
    if (gemBonus > 0) bonusParts.push(`GEM+${gemBonus}`)
    if (streakMult > 1) bonusParts.push(`x${streakMult.toFixed(1)}`)
    if (isFeverRef.current) bonusParts.push('FEVER!')
    bonusParts.push(`+${(timeBonus / 1000).toFixed(0)}s`)
    setLastClearBonusText(bonusParts.join(' '))
    clearTimeoutSafe(bonusTextTimerRef)
    bonusTextTimerRef.current = window.setTimeout(() => { bonusTextTimerRef.current = null; setLastClearBonusText('') }, 1800)

    const nextStagesCleared = stagesClearedRef.current + 1
    stagesClearedRef.current = nextStagesCleared; setStagesCleared(nextStagesCleared)
    moveCountRef.current = 0; setMoveCount(0); gemsRef.current = 0; setGemsCollected(0)

    setStageTransition(true)
    playSound(stageClearSfx, 0.6, 1.0 + nextStagesCleared * 0.02)
    effects.comboHitBurst(170, 300, nextStreak, clearScore)

    window.setTimeout(() => {
      const nextStage = generateStage(nextStagesCleared)
      currentStageRef.current = nextStage
      playerPosRef.current = nextStage.start; setPlayerPos(nextStage.start)
      const newGrid = deepCopyGrid(nextStage.grid)
      liveGridRef.current = newGrid; setLiveGrid(newGrid); setTrails([])
      stageStartMsRef.current = INITIAL_DURATION_MS - remainingMsRef.current
      setStageTransition(false)

      setIsClearFlash(true)
      clearTimeoutSafe(clearFlashTimerRef)
      clearFlashTimerRef.current = window.setTimeout(() => { clearFlashTimerRef.current = null; setIsClearFlash(false) }, 400)
    }, STAGE_TRANSITION_MS)
  }, [playSound, effects])

  const executeSlide = useCallback((direction: Direction, fromSpring = false) => {
    if (finishedRef.current || (isSlidingRef.current && !fromSpring)) return

    const grid = liveGridRef.current
    const from = playerPosRef.current
    const { destination, passedCells, hitWall } = slideOnIce(grid, from, direction)
    if (destination.row === from.row && destination.col === from.col) {
      if (hitWall) {
        playSound(crackSfx, 0.3, 1.5)
        setWallHitEffect(true)
        clearTimeoutSafe(wallHitTimerRef)
        wallHitTimerRef.current = window.setTimeout(() => { wallHitTimerRef.current = null; setWallHitEffect(false) }, WALL_HIT_COOLDOWN_MS)
        effects.triggerShake(4)
      }
      return
    }

    isSlidingRef.current = true; setIsSliding(true)
    if (!fromSpring) {
      const nextMoveCount = moveCountRef.current + 1
      moveCountRef.current = nextMoveCount; setMoveCount(nextMoveCount)
    }
    setPlayerDirection(direction)

    playSound(swooshSfx, 0.35, 0.9 + Math.random() * 0.2)
    effects.triggerShake(2)
    addTrails(passedCells)

    for (const cell of passedCells) {
      const cellType = grid[cell.row][cell.col]
      if (cellType === 'gem') {
        grid[cell.row][cell.col] = 'ice'
        gemsRef.current += 1; setGemsCollected(g => g + 1)
        playSound(gemSfx, 0.5, 1.0 + gemsRef.current * 0.1)
        const gemScore = GEM_SCORE * (isFeverRef.current ? FEVER_MULTIPLIER : 1)
        scoreRef.current += gemScore; setScore(scoreRef.current)
        spawnSparkles((cell.col / GRID_SIZE) * 100 + 6, (cell.row / GRID_SIZE) * 100 + 6, '#fbbf24')
        effects.showScorePopup(gemScore, (cell.col / GRID_SIZE) * 340, (cell.row / GRID_SIZE) * 340)
      } else if (cellType === 'snowflake') {
        grid[cell.row][cell.col] = 'ice'
        remainingMsRef.current = Math.min(MAX_DURATION_MS, remainingMsRef.current + SNOWFLAKE_TIME_BONUS)
        playSound(snowflakeSfx, 0.5)
        spawnSparkles((cell.col / GRID_SIZE) * 100 + 6, (cell.row / GRID_SIZE) * 100 + 6, '#93c5fd', 8)
        effects.triggerFlash('#bfdbfe')
      }
    }

    const destCell = grid[destination.row][destination.col]
    if (destCell === 'crack') {
      grid[destination.row][destination.col] = 'wall'
      liveGridRef.current = grid.map(r => [...r]); setLiveGrid(liveGridRef.current)
      playSound(crackSfx, 0.5)
      effects.triggerShake(6)
      spawnSparkles((destination.col / GRID_SIZE) * 100 + 6, (destination.row / GRID_SIZE) * 100 + 6, '#8899aa', 10)
    }

    setTargetPos(destination)
    playerPosRef.current = destination

    window.setTimeout(() => {
      setPlayerPos(destination); setTargetPos(null)
      isSlidingRef.current = false; setIsSliding(false)

      const stage = currentStageRef.current
      const curCell = liveGridRef.current[destination.row]?.[destination.col]

      // Check if stage is still solvable after crack/state changes
      if (curCell !== 'exit' && !(curCell === 'teleport' || curCell === 'spring')) {
        const stillSolvable = canSolveFrom(liveGridRef.current, destination, stage.exit, stage.teleportPairs)
        if (!stillSolvable) {
          effects.triggerFlash('#e94560')
          effects.triggerShake(8)
          window.setTimeout(() => finishGame(), 600)
          return
        }
      }

      if (curCell === 'spring') {
        setSpringBounce(true)
        playSound(swooshSfx, 0.5, 1.8)
        effects.triggerFlash('#86efac')
        window.setTimeout(() => {
          setSpringBounce(false)
          const bounceDir = reverseDirection(direction)
          executeSlide(bounceDir, true)
        }, 150)
        return
      }

      if (curCell === 'teleport') {
        const teleportDest = handleTeleport(destination)
        if (teleportDest) {
          playSound(teleportSfx, 0.5)
          setShowTeleportFlash(true); effects.triggerFlash('#a855f7')
          playerPosRef.current = teleportDest; setPlayerPos(teleportDest)
          spawnSparkles((teleportDest.col / GRID_SIZE) * 100 + 6, (teleportDest.row / GRID_SIZE) * 100 + 6, '#c084fc', 8)
          window.setTimeout(() => setShowTeleportFlash(false), 300)
          if (teleportDest.row === stage.exit.row && teleportDest.col === stage.exit.col) advanceStage()
          return
        }
      }

      if (destination.row === stage.exit.row && destination.col === stage.exit.col) advanceStage()
    }, MOVE_ANIMATION_MS)
  }, [advanceStage, playSound, effects, addTrails, handleTeleport, spawnSparkles])

  const handleMove = useCallback((direction: Direction) => {
    if (stageTransition) return
    executeSlide(direction)
  }, [executeSlide, stageTransition])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(clearFlashTimerRef); clearTimeoutSafe(bonusTextTimerRef); clearTimeoutSafe(wallHitTimerRef)
    if (bgmRef.current) { bgmRef.current.pause() }
    const elapsedMs = Math.max(1, MAX_DURATION_MS - remainingMsRef.current)
    playSound(gameoverSfx, 0.6, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(elapsedMs) })
  }, [onFinish, playSound])

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finishedRef.current) return
      const map: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
      const dir = map[e.code]
      if (dir) { e.preventDefault(); handleMove(dir) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleMove])

  // Touch/swipe
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      const t = e.touches[0]; touchIdRef.current = t.identifier; touchStartRef.current = { x: t.clientX, y: t.clientY }
    }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || touchIdRef.current === null) return
    let t: React.Touch | null = null
    for (let i = 0; i < e.changedTouches.length; i++) { if (e.changedTouches[i].identifier === touchIdRef.current) { t = e.changedTouches[i]; break } }
    if (!t) return
    const dx = t.clientX - touchStartRef.current.x; const dy = t.clientY - touchStartRef.current.y
    touchIdRef.current = null; touchStartRef.current = null
    if (Math.abs(dx) < SWIPE_DEAD_ZONE && Math.abs(dy) < SWIPE_DEAD_ZONE) return
    handleMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
  }, [handleMove])

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
      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      effects.updateParticles()
      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => { if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }; lastFrameAtRef.current = null; effects.cleanup() }
  }, [finishGame])

  useEffect(() => { return () => { clearTimeoutSafe(clearFlashTimerRef); clearTimeoutSafe(bonusTextTimerRef); clearTimeoutSafe(wallHitTimerRef); audioCache.current = {} } }, [])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const comboLabel = getComboLabel(stagesCleared)
  const comboColor = getComboColor(stagesCleared)
  const streakMult = streak >= STREAK_MULTIPLIER_THRESHOLD ? 1 + Math.floor(streak / STREAK_MULTIPLIER_THRESHOLD) * 0.5 : 1
  const timePercent = (remainingMs / MAX_DURATION_MS) * 100
  const playerFlip = playerDirection === 'left' ? 'scaleX(-1)' : 'scaleX(1)'

  return (
    <section className="mini-game-panel ice-slide-panel" aria-label="ice-slide-game" style={{ ...effects.getShakeStyle(), position: 'relative' }}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .ice-slide-panel {
          display: flex; flex-direction: column; align-items: center;
          width: 100%; max-width: 432px; margin: 0 auto; height: 100%;
          background: #1a1a2e;
          user-select: none; -webkit-user-select: none; touch-action: none; overflow: hidden;
          padding: 0; box-sizing: border-box;
          font-family: 'Press Start 2P', monospace;
          image-rendering: pixelated;
          position: relative;
        }
        .ice-slide-panel::after {
          content: ''; position: absolute; inset: 0; z-index: 50; pointer-events: none;
          background: repeating-linear-gradient(0deg, transparent 0px, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px);
        }

        .ice-slide-hud {
          display: flex; justify-content: space-between; align-items: center;
          width: 100%; padding: 12px 16px;
          background: #16213e; border-bottom: 4px solid #0f3460;
          flex-shrink: 0; z-index: 2;
        }
        .ice-slide-hud-avatar {
          width: 56px; height: 56px; image-rendering: pixelated;
          border: 3px solid #e94560; box-shadow: 0 0 0 2px #1a1a2e;
        }
        .ice-slide-score-col { display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1; }
        .ice-slide-score {
          font-size: 42px; font-weight: 900; color: #e94560; margin: 0;
          text-shadow: 3px 3px 0 #0f3460, 0 0 12px rgba(233,69,96,0.4);
          text-align: center; width: 100%;
        }
        .ice-slide-best { font-size: 11px; color: #536878; margin: 0; text-align: center; }
        .ice-slide-time-col { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .ice-slide-time {
          font-size: 26px; font-weight: bold; color: #53cf6a; margin: 0;
          text-shadow: 2px 2px 0 #0f3460; transition: color 0.2s;
        }
        .ice-slide-time.low-time { color: #e94560; animation: px-blink 0.4s steps(2) infinite; }
        @keyframes px-blink { 50% { opacity: 0; } }
        .ice-slide-time-bar { width: 90px; height: 10px; background: #16213e; border: 2px solid #0f3460; }
        .ice-slide-time-bar-fill { height: 100%; transition: width 0.1s linear; }

        .ice-slide-meta {
          display: flex; justify-content: center; gap: 16px;
          font-size: 13px; color: #536878; padding: 8px 12px; flex-shrink: 0;
        }
        .ice-slide-meta strong { color: #53cf6a; }

        .ice-slide-board-area {
          flex: 1; min-height: 0; width: 100%;
          display: flex; align-items: center; justify-content: center;
          padding: 4px; box-sizing: border-box; position: relative;
        }
        .ice-slide-board-wrapper {
          position: relative; width: 100%; max-width: 400px;
          aspect-ratio: 1; max-height: 100%;
        }
        .ice-slide-board {
          display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr);
          width: 100%; height: 100%;
          border: 3px solid #0f3460; background: #0f3460; gap: 1px;
          image-rendering: pixelated; transition: border-color 0.2s;
        }
        .ice-slide-board.clear-flash { border-color: #53cf6a; box-shadow: 0 0 0 3px #53cf6a; }
        .ice-slide-board.fever-board { border-color: #e94560; animation: px-fever-border 0.3s steps(2) infinite; }
        @keyframes px-fever-border { 50% { border-color: #ffd700; } }
        .ice-slide-board.wall-hit { animation: px-wall-shake 0.15s steps(3); }
        @keyframes px-wall-shake { 25% { transform: translate(-2px, 0); } 50% { transform: translate(2px, 0); } 75% { transform: translate(-1px, 0); } }

        .ice-slide-cell { position: relative; width: 100%; height: 100%; }
        .ice-slide-cell-ice { background: #c8e6ff; box-shadow: inset -1px -1px 0 #9bc4e2, inset 1px 1px 0 #e8f4ff; }
        .ice-slide-cell-wall { background: #2a4a7f; box-shadow: inset -1px -1px 0 #1a2a4f, inset 1px 1px 0 #3a6aaf; }
        .ice-slide-cell-exit { background: #53cf6a; box-shadow: inset -1px -1px 0 #2a8f3a, inset 1px 1px 0 #7aef9a; animation: px-exit-blink 1s steps(2) infinite; }
        @keyframes px-exit-blink { 50% { background: #7aef9a; } }
        .ice-slide-cell-crack {
          background: #9ab0c4; position: relative;
          box-shadow: inset -1px -1px 0 #7a90a4, inset 1px 1px 0 #bad0e4;
        }
        .ice-slide-cell-crack::after {
          content: ''; position: absolute; top: 25%; left: 35%; width: 30%; height: 50%;
          border-left: 2px solid rgba(0,0,0,0.3); border-bottom: 1px solid rgba(0,0,0,0.2);
          transform: rotate(-15deg);
        }
        .ice-slide-cell-teleport {
          background: #9b59b6; animation: px-tp-blink 0.8s steps(2) infinite;
          box-shadow: inset -1px -1px 0 #6a2980, inset 1px 1px 0 #c39adb;
        }
        @keyframes px-tp-blink { 50% { background: #c39adb; } }
        .ice-slide-cell-gem {
          background: #c8e6ff; position: relative;
          box-shadow: inset -1px -1px 0 #9bc4e2, inset 1px 1px 0 #e8f4ff;
        }
        .ice-slide-cell-spring {
          background: #53cf6a; position: relative;
          box-shadow: inset -1px -1px 0 #2a8f3a, inset 1px 1px 0 #7aef9a;
        }
        .ice-slide-cell-snowflake {
          background: #c8e6ff; position: relative;
          box-shadow: inset -1px -1px 0 #9bc4e2, inset 1px 1px 0 #e8f4ff;
        }

        .ice-slide-cell-char {
          position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
          font-family: 'Press Start 2P', monospace;
          pointer-events: none; line-height: 1;
          text-shadow: 1px 1px 0 rgba(0,0,0,0.3);
        }
        .cell-char-exit { color: #1a5a2a; font-size: 10px; font-weight: 900; }
        .cell-char-gem { color: #ffd700; font-size: 16px; animation: px-gem-bob 0.6s steps(3) infinite; }
        @keyframes px-gem-bob { 33% { transform: translate(-50%, -55%); } 66% { transform: translate(-50%, -45%); } }
        .cell-char-spring { color: #1a5a2a; font-size: 16px; }
        .cell-char-snowflake { color: #4a9eff; font-size: 14px; animation: px-snow-spin 1s steps(4) infinite; }
        @keyframes px-snow-spin { 25% { transform: translate(-50%, -50%) rotate(90deg); } 50% { transform: translate(-50%, -50%) rotate(180deg); } 75% { transform: translate(-50%, -50%) rotate(270deg); } }
        .cell-char-teleport { color: #e8d0ff; font-size: 14px; }
        .cell-char-crack { color: #5a7080; font-size: 12px; }

        .ice-slide-player {
          position: absolute; width: calc(100% / 8); height: calc(100% / 8);
          display: flex; align-items: center; justify-content: center;
          pointer-events: none; z-index: 10; transition: none;
        }
        .ice-slide-player.sliding { transition: left ${MOVE_ANIMATION_MS}ms ease-out, top ${MOVE_ANIMATION_MS}ms ease-out; }
        .ice-slide-player-sprite {
          width: 110%; height: 110%; image-rendering: pixelated; object-fit: contain;
          filter: drop-shadow(2px 2px 0 rgba(0,0,0,0.5));
        }
        .ice-slide-player.spring-bounce .ice-slide-player-sprite { animation: px-spring-squash 0.15s steps(2); }
        @keyframes px-spring-squash { 50% { transform: scaleY(0.6) scaleX(1.3); } }

        .ice-slide-trail {
          position: absolute; width: calc(100% / 8); height: calc(100% / 8);
          pointer-events: none; z-index: 5;
          display: flex; align-items: center; justify-content: center;
        }
        .ice-slide-trail-dot { width: 6px; height: 6px; background: #4a9eff; animation: px-trail 0.4s steps(4) forwards; }
        @keyframes px-trail { to { opacity: 0; transform: scale(0); } }

        .ice-slide-sparkle {
          position: absolute; width: 6px; height: 6px; z-index: 15; pointer-events: none;
          animation: px-sparkle 0.4s steps(4) forwards;
        }
        @keyframes px-sparkle { 0% { opacity: 1; transform: scale(2); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0); } }

        .ice-slide-dpad {
          display: grid;
          grid-template-areas: '. up .' 'left center right' '. down .';
          grid-template-columns: 88px 88px 88px; grid-template-rows: 68px 68px 68px;
          gap: 4px; flex-shrink: 0; padding: 8px 0 8px;
        }
        .ice-slide-dpad-btn {
          border: 3px solid #0f3460; background: #16213e; color: #4a9eff;
          font-size: 26px; font-family: 'Press Start 2P', monospace;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: 3px 3px 0 #0a0a1e; -webkit-tap-highlight-color: transparent;
        }
        .ice-slide-dpad-btn:active { transform: translate(3px, 3px); box-shadow: none; background: #0f3460; }
        .ice-slide-dpad-btn:disabled { opacity: 0.3; cursor: default; }
        .ice-slide-dpad-up { grid-area: up; }
        .ice-slide-dpad-down { grid-area: down; }
        .ice-slide-dpad-left { grid-area: left; }
        .ice-slide-dpad-right { grid-area: right; }

        .ice-slide-bonus-text {
          font-size: 16px; font-weight: 900; color: #ffd700;
          text-shadow: 2px 2px 0 #0f3460;
          animation: px-bonus-pop 0.3s steps(3);
          text-align: center; min-height: 24px; margin: 0; flex-shrink: 0;
        }
        @keyframes px-bonus-pop { 0% { transform: scale(0.5); } 50% { transform: scale(1.4); } 100% { transform: scale(1); } }
        .ice-slide-fever-banner {
          font-size: 16px; font-weight: 900; color: #e94560; letter-spacing: 3px;
          text-shadow: 2px 2px 0 #0f3460;
          animation: px-fever-text 0.3s steps(2) infinite alternate;
          text-align: center; margin: 0; flex-shrink: 0;
        }
        @keyframes px-fever-text { to { color: #ffd700; } }

        .ice-slide-swipe-hint {
          font-size: 10px; color: #2a3a5a; text-align: center; margin: 0 0 2px; flex-shrink: 0;
          font-family: 'Press Start 2P', monospace;
        }
        .ice-slide-teleport-flash {
          position: absolute; inset: 0; z-index: 15; pointer-events: none;
          background: rgba(155,89,182,0.3); animation: px-tp-flash 0.3s steps(3) forwards;
        }
        @keyframes px-tp-flash { to { opacity: 0; } }

        .ice-slide-stage-transition {
          position: absolute; inset: 0; z-index: 30; pointer-events: none;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Press Start 2P', monospace;
        }
        .ice-slide-stage-transition-bg {
          position: absolute; inset: 0; background: #1a1a2e;
          animation: px-stage-wipe ${STAGE_TRANSITION_MS}ms steps(8) forwards;
        }
        @keyframes px-stage-wipe {
          0% { clip-path: inset(0 0 100% 0); } 30% { clip-path: inset(0 0 0 0); }
          70% { clip-path: inset(0 0 0 0); } 100% { clip-path: inset(100% 0 0 0); }
        }
        .ice-slide-stage-text {
          position: relative; z-index: 31; font-size: 28px; color: #53cf6a;
          text-shadow: 3px 3px 0 #0a0a1e;
          animation: px-stage-text ${STAGE_TRANSITION_MS}ms steps(4);
        }
        @keyframes px-stage-text {
          0% { opacity: 0; transform: scale(0.5); } 20% { opacity: 1; transform: scale(1.2); }
          80% { opacity: 1; transform: scale(1); } 100% { opacity: 0; }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {comboLabel && (
        <div style={{ position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 20, fontSize: 18, fontWeight: 900, color: comboColor, textShadow: '2px 2px 0 #0a0a1e', fontFamily: "'Press Start 2P', monospace" }}>
          {comboLabel}
        </div>
      )}

      {stageTransition && (
        <div className="ice-slide-stage-transition">
          <div className="ice-slide-stage-transition-bg" />
          <div className="ice-slide-stage-text">STAGE {stagesCleared + 1}</div>
        </div>
      )}

      <div className="ice-slide-hud">
        <img src={characterSprite} alt="" className="ice-slide-hud-avatar" />
        <div className="ice-slide-score-col">
          <p className="ice-slide-score">{score.toLocaleString()}</p>
          <p className="ice-slide-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="ice-slide-time-col">
          <p className={`ice-slide-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}</p>
          <div className="ice-slide-time-bar">
            <div className="ice-slide-time-bar-fill" style={{ width: `${timePercent}%`, background: timePercent > 30 ? '#53cf6a' : timePercent > 10 ? '#ffd700' : '#e94560' }} />
          </div>
        </div>
      </div>

      <div className="ice-slide-meta">
        <span>STG <strong>{stagesCleared + 1}</strong></span>
        <span>MOV <strong>{moveCount}</strong></span>
        <span>STK <strong style={{ color: streak >= STREAK_MULTIPLIER_THRESHOLD ? '#ffd700' : '#53cf6a' }}>{streak}</strong></span>
        {streakMult > 1 && <span style={{ color: '#ffd700' }}>x{streakMult.toFixed(1)}</span>}
        {gemsCollected > 0 && <span style={{ color: '#ffd700' }}>GEM {gemsCollected}</span>}
      </div>

      {isFever && <p className="ice-slide-fever-banner">!! FEVER x{FEVER_MULTIPLIER} !!</p>}
      {lastClearBonusText && <p className="ice-slide-bonus-text">{lastClearBonusText}</p>}
      {!lastClearBonusText && !isFever && <div style={{ minHeight: 24, flexShrink: 0 }} />}

      <div className="ice-slide-board-area" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} role="presentation">
        <div className="ice-slide-board-wrapper">
          <div className={`ice-slide-board ${isClearFlash ? 'clear-flash' : ''} ${isFever ? 'fever-board' : ''} ${wallHitEffect ? 'wall-hit' : ''}`}>
            {liveGrid.map((row, ri) =>
              row.map((cell, ci) => (
                <div key={`${ri}-${ci}`} className={`ice-slide-cell ice-slide-cell-${cell}`}>
                  {TILE_CHARS[cell] && <span className={`ice-slide-cell-char cell-char-${cell}`}>{TILE_CHARS[cell]}</span>}
                </div>
              )),
            )}
          </div>

          {trails.map(t => (
            <div key={t.id} className="ice-slide-trail" style={{ left: `${(t.col / GRID_SIZE) * 100}%`, top: `${(t.row / GRID_SIZE) * 100}%` }}>
              <div className="ice-slide-trail-dot" />
            </div>
          ))}

          {sparkles.map(s => (
            <div key={s.id} className="ice-slide-sparkle" style={{ left: `${s.x}%`, top: `${s.y}%`, background: s.color }} />
          ))}

          <div
            className={`ice-slide-player ${isSliding ? 'sliding' : ''} ${springBounce ? 'spring-bounce' : ''}`}
            style={{
              left: `${((isSliding && targetPos ? targetPos.col : playerPos.col) / GRID_SIZE) * 100}%`,
              top: `${((isSliding && targetPos ? targetPos.row : playerPos.row) / GRID_SIZE) * 100}%`,
            }}
          >
            <img src={characterSprite} alt="" className="ice-slide-player-sprite" style={{ transform: playerFlip }} />
          </div>

          {showTeleportFlash && <div className="ice-slide-teleport-flash" />}
        </div>
      </div>

      <div className="ice-slide-dpad">
        <button className="ice-slide-dpad-btn ice-slide-dpad-up" type="button" onClick={() => handleMove('up')} disabled={isSliding || stageTransition}>^</button>
        <button className="ice-slide-dpad-btn ice-slide-dpad-left" type="button" onClick={() => handleMove('left')} disabled={isSliding || stageTransition}>&lt;</button>
        <button className="ice-slide-dpad-btn ice-slide-dpad-right" type="button" onClick={() => handleMove('right')} disabled={isSliding || stageTransition}>&gt;</button>
        <button className="ice-slide-dpad-btn ice-slide-dpad-down" type="button" onClick={() => handleMove('down')} disabled={isSliding || stageTransition}>v</button>
      </div>

      <p className="ice-slide-swipe-hint">SWIPE OR D-PAD</p>
    </section>
  )
}

export const iceSlideModule: MiniGameModule = {
  manifest: {
    id: 'ice-slide',
    title: 'Ice Slide',
    description: '8BIT ICE PUZZLE! CRACK, SPRING, TELEPORT, GEM!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#4a9eff',
  },
  Component: IceSlideGame,
}
