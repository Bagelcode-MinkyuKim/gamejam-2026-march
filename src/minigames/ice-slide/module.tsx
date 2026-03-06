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
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// suppress unused import warnings
void clearSfx

// --- Config ---
const GRID_SIZE = 8
const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 10000
const MOVE_ANIMATION_MS = 100
const BONUS_THRESHOLD_MOVES = 8
const BONUS_PER_SAVED_MOVE = 3
const BASE_CLEAR_SCORE = 20
const SCORE_ESCALATION = 5
const STREAK_MULTIPLIER_THRESHOLD = 3
const TIME_BONUS_BASE = 2500
const TIME_BONUS_PER_STAGE = 500
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

// --- Stage layouts ---
const STAGE_LAYOUTS: StageLayout[] = [
  // Stage 1: tutorial
  {
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'ice',  'wall'],
      ['wall', 'ice',  'wall', 'ice',  'ice',  'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'ice',  'wall'],
      ['wall', 'wall', 'ice',  'wall', 'ice',  'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'wall', 'ice',  'wall'],
      ['wall', 'ice',  'wall', 'ice',  'ice',  'ice',  'ice',  'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'exit', 'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 6 },
  },
  // Stage 2: gems intro
  {
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'ice',  'ice',  'wall', 'ice',  'gem',  'ice',  'wall'],
      ['wall', 'wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'wall'],
      ['wall', 'ice',  'ice',  'wall', 'ice',  'ice',  'gem',  'wall'],
      ['wall', 'ice',  'wall', 'ice',  'wall', 'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
      ['wall', 'gem',  'wall', 'wall', 'ice',  'wall', 'ice',  'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'exit', 'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 6 },
  },
  // Stage 3: crack + snowflake intro
  {
    grid: [
      ['wall', 'wall',      'wall', 'wall', 'wall', 'wall', 'wall',      'wall'],
      ['wall', 'ice',       'ice',  'ice',  'ice',  'ice',  'ice',       'wall'],
      ['wall', 'ice',       'wall', 'wall', 'ice',  'wall', 'ice',       'wall'],
      ['wall', 'ice',       'crack','ice',  'wall', 'ice',  'snowflake', 'wall'],
      ['wall', 'wall',      'ice',  'wall', 'ice',  'ice',  'wall',      'wall'],
      ['wall', 'snowflake', 'ice',  'ice',  'ice',  'wall', 'gem',       'wall'],
      ['wall', 'ice',       'wall', 'ice',  'wall', 'ice',  'ice',       'wall'],
      ['wall', 'exit',      'wall', 'wall', 'wall', 'wall', 'wall',      'wall'],
    ],
    start: { row: 1, col: 6 },
    exit: { row: 7, col: 1 },
  },
  // Stage 4: spring + teleport
  {
    grid: [
      ['wall',   'wall',   'wall', 'wall',     'wall', 'wall',     'wall', 'wall'],
      ['wall',   'ice',    'ice',  'ice',      'wall', 'ice',      'ice',  'wall'],
      ['wall',   'wall',   'ice',  'wall',     'ice',  'ice',      'wall', 'wall'],
      ['wall',   'spring', 'ice',  'teleport', 'ice',  'wall',     'gem',  'wall'],
      ['wall',   'ice',    'wall', 'wall',     'ice',  'ice',      'ice',  'wall'],
      ['wall',   'ice',    'crack','ice',      'wall', 'wall',     'ice',  'wall'],
      ['wall',   'wall',   'ice',  'wall',     'ice',  'teleport', 'ice',  'wall'],
      ['wall',   'wall',   'wall', 'wall',     'wall', 'exit',     'wall', 'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 5 },
    teleportPairs: [[{ row: 3, col: 3 }, { row: 6, col: 5 }]],
  },
  // Stage 5: multi-path
  {
    grid: [
      ['wall', 'wall',      'wall',  'exit', 'wall',  'wall', 'wall',      'wall'],
      ['wall', 'ice',       'ice',   'ice',  'ice',   'wall', 'gem',       'wall'],
      ['wall', 'wall',      'crack', 'wall', 'ice',   'ice',  'ice',       'wall'],
      ['wall', 'spring',    'ice',   'ice',  'wall',  'ice',  'wall',      'wall'],
      ['wall', 'ice',       'wall',  'ice',  'crack', 'ice',  'snowflake', 'wall'],
      ['wall', 'ice',       'ice',   'wall', 'wall',  'ice',  'wall',      'wall'],
      ['wall', 'snowflake', 'wall',  'ice',  'ice',   'ice',  'gem',       'wall'],
      ['wall', 'wall',      'wall',  'wall', 'wall',  'wall', 'wall',      'wall'],
    ],
    start: { row: 6, col: 6 },
    exit: { row: 0, col: 3 },
  },
  // Stage 6: teleport heavy
  {
    grid: [
      ['wall',     'wall',   'wall', 'wall', 'wall',     'wall', 'wall',      'wall'],
      ['wall',     'ice',    'ice',  'wall', 'teleport', 'ice',  'snowflake', 'wall'],
      ['wall',     'wall',   'ice',  'ice',  'ice',      'wall', 'crack',     'wall'],
      ['wall',     'spring', 'gem',  'wall', 'ice',      'ice',  'ice',       'wall'],
      ['wall',     'teleport','wall','ice',  'wall',     'ice',  'wall',      'wall'],
      ['wall',     'ice',    'ice',  'ice',  'crack',    'wall', 'ice',       'wall'],
      ['wall',     'ice',    'wall', 'wall', 'ice',      'ice',  'teleport',  'wall'],
      ['wall',     'wall',   'wall', 'wall', 'wall',     'exit', 'wall',      'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 5 },
    teleportPairs: [
      [{ row: 1, col: 4 }, { row: 4, col: 1 }],
      [{ row: 6, col: 6 }, { row: 1, col: 4 }],
    ],
  },
  // Stage 7: crack + spring gauntlet
  {
    grid: [
      ['wall', 'wall',   'wall',  'wall',   'wall',   'wall',   'wall',      'wall'],
      ['wall', 'ice',    'crack', 'ice',    'ice',    'crack',  'ice',       'wall'],
      ['wall', 'spring', 'wall',  'wall',   'ice',    'wall',   'ice',       'wall'],
      ['wall', 'crack',  'ice',   'gem',    'wall',   'spring', 'crack',     'wall'],
      ['wall', 'wall',   'ice',   'wall',   'crack',  'ice',    'wall',      'wall'],
      ['wall', 'ice',    'ice',   'crack',  'spring', 'wall',   'ice',       'wall'],
      ['wall', 'gem',    'wall',  'ice',    'wall',   'ice',    'snowflake', 'wall'],
      ['wall', 'wall',   'wall',  'wall',   'wall',   'wall',   'exit',      'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 6 },
  },
  // Stage 8: the gauntlet
  {
    grid: [
      ['wall',  'wall',      'wall',   'wall',      'wall', 'wall',     'wall', 'wall'],
      ['wall',  'ice',       'spring', 'wall',      'gem',  'ice',      'ice',  'wall'],
      ['wall',  'wall',      'ice',    'crack',     'ice',  'wall',     'crack','wall'],
      ['wall',  'teleport',  'ice',    'wall',      'ice',  'spring',   'ice',  'wall'],
      ['wall',  'ice',       'wall',   'snowflake', 'wall', 'ice',      'wall', 'wall'],
      ['wall',  'crack',     'ice',    'ice',       'ice',  'wall',     'gem',  'wall'],
      ['wall',  'ice',       'wall',   'wall',      'spring','teleport','ice',  'wall'],
      ['wall',  'wall',      'wall',   'wall',      'wall', 'exit',     'wall', 'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 5 },
    teleportPairs: [[{ row: 3, col: 1 }, { row: 6, col: 5 }]],
  },
]

// --- Logic helpers ---
interface SlideResult {
  readonly destination: Position
  readonly passedCells: Position[]
  readonly hitWall: boolean
}

function slideOnIce(grid: CellType[][], from: Position, direction: Direction): SlideResult {
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

function reverseDirection(d: Direction): Direction {
  return d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left'
}

function getStageByIndex(index: number): StageLayout {
  return STAGE_LAYOUTS[index % STAGE_LAYOUTS.length]
}

function deepCopyGrid(grid: CellType[][]): CellType[][] {
  return grid.map(row => [...row])
}

// --- Trail ---
interface TrailDot { id: number; row: number; col: number }

// --- Pixel sparkle ---
interface PixelSparkle { id: number; x: number; y: number; color: string }

function IceSlideGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [stagesCleared, setStagesCleared] = useState(0)
  const [moveCount, setMoveCount] = useState(0)
  const [, setCurrentStageIndex] = useState(0)
  const [playerPos, setPlayerPos] = useState<Position>(() => STAGE_LAYOUTS[0].start)
  const [targetPos, setTargetPos] = useState<Position | null>(null)
  const [isSliding, setIsSliding] = useState(false)
  const [isClearFlash, setIsClearFlash] = useState(false)
  const [streak, setStreak] = useState(0)
  const [lastClearBonusText, setLastClearBonusText] = useState('')
  const [isFever, setIsFever] = useState(false)
  const [liveGrid, setLiveGrid] = useState<CellType[][]>(() => deepCopyGrid(STAGE_LAYOUTS[0].grid))
  const [trails, setTrails] = useState<TrailDot[]>([])
  const [gemsCollected, setGemsCollected] = useState(0)
  const [showTeleportFlash, setShowTeleportFlash] = useState(false)
  const [playerDirection, setPlayerDirection] = useState<Direction>('down')
  const [stageTransition, setStageTransition] = useState(false)
  const [sparkles, setSparkles] = useState<PixelSparkle[]>([])
  const [wallHitEffect, setWallHitEffect] = useState(false)
  const [springBounce, setSpringBounce] = useState(false)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const stagesClearedRef = useRef(0)
  const moveCountRef = useRef(0)
  const currentStageIndexRef = useRef(0)
  const playerPosRef = useRef<Position>(STAGE_LAYOUTS[0].start)
  const finishedRef = useRef(false)
  const isSlidingRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const clearFlashTimerRef = useRef<number | null>(null)
  const streakRef = useRef(0)
  const stageStartMsRef = useRef(0)
  const isFeverRef = useRef(false)
  const bonusTextTimerRef = useRef<number | null>(null)
  const liveGridRef = useRef<CellType[][]>(deepCopyGrid(STAGE_LAYOUTS[0].grid))
  const trailIdRef = useRef(0)
  const gemsRef = useRef(0)
  const sparkleIdRef = useRef(0)
  const wallHitTimerRef = useRef<number | null>(null)

  const touchIdRef = useRef<number | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const audioCache = useRef<Record<string, HTMLAudioElement>>({})

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
      newSparkles.push({
        id: ++sparkleIdRef.current,
        x: cx + (Math.random() - 0.5) * 60,
        y: cy + (Math.random() - 0.5) * 60,
        color,
      })
    }
    setSparkles(prev => [...prev, ...newSparkles])
    window.setTimeout(() => {
      setSparkles(prev => prev.filter(s => !newSparkles.some(ns => ns.id === s.id)))
    }, 500)
  }, [])

  const handleTeleport = useCallback((pos: Position, stageIndex: number): Position | null => {
    const stage = getStageByIndex(stageIndex)
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
    const elapsedOnStageMs = (ROUND_DURATION_MS - remainingMsRef.current) - stageStartMsRef.current
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

    const timeBonus = TIME_BONUS_BASE + Math.min(stagesClearedRef.current * TIME_BONUS_PER_STAGE, 5000)
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + timeBonus)

    const bonusParts: string[] = [`+${clearScore}`]
    if (speedBonus > 0) bonusParts.push('SPEED!')
    if (gemBonus > 0) bonusParts.push(`GEM+${gemBonus}`)
    if (streakMult > 1) bonusParts.push(`x${streakMult.toFixed(1)}`)
    if (isFeverRef.current) bonusParts.push('FEVER!')
    setLastClearBonusText(bonusParts.join(' '))
    clearTimeoutSafe(bonusTextTimerRef)
    bonusTextTimerRef.current = window.setTimeout(() => { bonusTextTimerRef.current = null; setLastClearBonusText('') }, 1800)

    const nextStagesCleared = stagesClearedRef.current + 1
    stagesClearedRef.current = nextStagesCleared; setStagesCleared(nextStagesCleared)
    moveCountRef.current = 0; setMoveCount(0); gemsRef.current = 0; setGemsCollected(0)

    // Stage transition animation
    setStageTransition(true)
    playSound(stageClearSfx, 0.6, 1.0 + nextStagesCleared * 0.02)
    effects.comboHitBurst(170, 300, nextStreak, clearScore)

    window.setTimeout(() => {
      const nextStageIndex = currentStageIndexRef.current + 1
      currentStageIndexRef.current = nextStageIndex; setCurrentStageIndex(nextStageIndex)
      const nextStage = getStageByIndex(nextStageIndex)
      playerPosRef.current = nextStage.start; setPlayerPos(nextStage.start)
      const newGrid = deepCopyGrid(nextStage.grid)
      liveGridRef.current = newGrid; setLiveGrid(newGrid); setTrails([])
      stageStartMsRef.current = ROUND_DURATION_MS - remainingMsRef.current
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

    // Collect gems & snowflakes along the path
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
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + SNOWFLAKE_TIME_BONUS)
        playSound(snowflakeSfx, 0.5)
        spawnSparkles((cell.col / GRID_SIZE) * 100 + 6, (cell.row / GRID_SIZE) * 100 + 6, '#93c5fd', 8)
        effects.triggerFlash('#bfdbfe')
      }
    }

    // Handle crack tiles
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

      const stage = getStageByIndex(currentStageIndexRef.current)
      const curCell = liveGridRef.current[destination.row]?.[destination.col]

      // Spring bounce
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

      // Teleport
      if (curCell === 'teleport') {
        const teleportDest = handleTeleport(destination, currentStageIndexRef.current)
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

      // Exit
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
    const elapsedMs = Math.max(1, ROUND_DURATION_MS - remainingMsRef.current)
    playSound(gameoverSfx, 0.6, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(elapsedMs) })
  }, [onFinish, playSound])

  const handleExit = useCallback(() => { playSound(swooshSfx, 0.42, 1.02); onExit() }, [onExit, playSound])

  // Keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finishedRef.current) return
      if (e.code === 'Escape') { e.preventDefault(); handleExit(); return }
      const map: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
      const dir = map[e.code]
      if (dir) { e.preventDefault(); handleMove(dir) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleMove, handleExit])

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
  const timePercent = (remainingMs / ROUND_DURATION_MS) * 100
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
          width: 100%; padding: 6px 10px;
          background: #16213e; border-bottom: 3px solid #0f3460;
          flex-shrink: 0; z-index: 2;
        }
        .ice-slide-hud-avatar {
          width: 32px; height: 32px; image-rendering: pixelated;
          border: 2px solid #e94560; box-shadow: 0 0 0 1px #1a1a2e;
        }
        .ice-slide-score-col { display: flex; flex-direction: column; align-items: center; gap: 2px; }
        .ice-slide-score {
          font-size: 14px; font-weight: 900; color: #e94560; margin: 0;
          text-shadow: 2px 2px 0 #0f3460;
        }
        .ice-slide-best { font-size: 6px; color: #536878; margin: 0; }
        .ice-slide-time-col { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
        .ice-slide-time {
          font-size: 12px; font-weight: bold; color: #53cf6a; margin: 0;
          text-shadow: 1px 1px 0 #0f3460; transition: color 0.2s;
        }
        .ice-slide-time.low-time { color: #e94560; animation: px-blink 0.4s steps(2) infinite; }
        @keyframes px-blink { 50% { opacity: 0; } }
        .ice-slide-time-bar { width: 56px; height: 4px; background: #16213e; border: 1px solid #0f3460; }
        .ice-slide-time-bar-fill { height: 100%; transition: width 0.3s steps(10); }

        .ice-slide-meta {
          display: flex; justify-content: center; gap: 8px;
          font-size: 6px; color: #536878; padding: 3px 6px; flex-shrink: 0;
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
        .cell-char-exit { color: #1a5a2a; font-size: 7px; }
        .cell-char-gem { color: #ffd700; font-size: 12px; animation: px-gem-bob 0.6s steps(3) infinite; }
        @keyframes px-gem-bob { 33% { transform: translate(-50%, -55%); } 66% { transform: translate(-50%, -45%); } }
        .cell-char-spring { color: #1a5a2a; font-size: 12px; }
        .cell-char-snowflake { color: #4a9eff; font-size: 11px; animation: px-snow-spin 1s steps(4) infinite; }
        @keyframes px-snow-spin { 25% { transform: translate(-50%, -50%) rotate(90deg); } 50% { transform: translate(-50%, -50%) rotate(180deg); } 75% { transform: translate(-50%, -50%) rotate(270deg); } }
        .cell-char-teleport { color: #e8d0ff; font-size: 11px; }
        .cell-char-crack { color: #5a7080; font-size: 9px; }

        .ice-slide-player {
          position: absolute; width: calc(100% / 8); height: calc(100% / 8);
          display: flex; align-items: center; justify-content: center;
          pointer-events: none; z-index: 10; transition: none;
        }
        .ice-slide-player.sliding { transition: left ${MOVE_ANIMATION_MS}ms steps(4), top ${MOVE_ANIMATION_MS}ms steps(4); }
        .ice-slide-player-sprite {
          width: 85%; height: 85%; image-rendering: pixelated; object-fit: contain;
          filter: drop-shadow(1px 1px 0 rgba(0,0,0,0.5));
        }
        .ice-slide-player.spring-bounce .ice-slide-player-sprite { animation: px-spring-squash 0.15s steps(2); }
        @keyframes px-spring-squash { 50% { transform: scaleY(0.6) scaleX(1.3); } }

        .ice-slide-trail {
          position: absolute; width: calc(100% / 8); height: calc(100% / 8);
          pointer-events: none; z-index: 5;
          display: flex; align-items: center; justify-content: center;
        }
        .ice-slide-trail-dot { width: 4px; height: 4px; background: #4a9eff; animation: px-trail 0.4s steps(4) forwards; }
        @keyframes px-trail { to { opacity: 0; transform: scale(0); } }

        .ice-slide-sparkle {
          position: absolute; width: 4px; height: 4px; z-index: 15; pointer-events: none;
          animation: px-sparkle 0.4s steps(4) forwards;
        }
        @keyframes px-sparkle { 0% { opacity: 1; transform: scale(2); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: scale(0); } }

        .ice-slide-dpad {
          display: grid;
          grid-template-areas: '. up .' 'left center right' '. down .';
          grid-template-columns: 48px 48px 48px; grid-template-rows: 40px 40px 40px;
          gap: 2px; flex-shrink: 0; padding: 4px 0 4px;
        }
        .ice-slide-dpad-btn {
          border: 2px solid #0f3460; background: #16213e; color: #4a9eff;
          font-size: 14px; font-family: 'Press Start 2P', monospace;
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: 2px 2px 0 #0a0a1e; -webkit-tap-highlight-color: transparent;
        }
        .ice-slide-dpad-btn:active { transform: translate(2px, 2px); box-shadow: none; background: #0f3460; }
        .ice-slide-dpad-btn:disabled { opacity: 0.3; cursor: default; }
        .ice-slide-dpad-up { grid-area: up; }
        .ice-slide-dpad-down { grid-area: down; }
        .ice-slide-dpad-left { grid-area: left; }
        .ice-slide-dpad-right { grid-area: right; }

        .ice-slide-bonus-text {
          font-size: 10px; font-weight: 900; color: #ffd700;
          text-shadow: 2px 2px 0 #0f3460;
          animation: px-bonus-pop 0.3s steps(3);
          text-align: center; min-height: 18px; margin: 0; flex-shrink: 0;
        }
        @keyframes px-bonus-pop { 0% { transform: scale(0.5); } 50% { transform: scale(1.4); } 100% { transform: scale(1); } }
        .ice-slide-fever-banner {
          font-size: 10px; font-weight: 900; color: #e94560; letter-spacing: 3px;
          text-shadow: 2px 2px 0 #0f3460;
          animation: px-fever-text 0.3s steps(2) infinite alternate;
          text-align: center; margin: 0; flex-shrink: 0;
        }
        @keyframes px-fever-text { to { color: #ffd700; } }

        .ice-slide-actions { display: flex; gap: 6px; padding: 0 0 6px; flex-shrink: 0; }
        .ice-slide-actions button {
          font-size: 8px; font-weight: 700; padding: 5px 14px;
          font-family: 'Press Start 2P', monospace;
          border: 2px solid #0f3460; background: #e94560; color: #fff;
          cursor: pointer; box-shadow: 2px 2px 0 #0a0a1e;
        }
        .ice-slide-actions button:active { transform: translate(2px, 2px); box-shadow: none; }
        .ice-slide-actions button:last-child { background: #16213e; color: #536878; border-color: #0f3460; }

        .ice-slide-swipe-hint {
          font-size: 6px; color: #2a3a5a; text-align: center; margin: 0; flex-shrink: 0;
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
          position: relative; z-index: 31; font-size: 16px; color: #53cf6a;
          text-shadow: 2px 2px 0 #0a0a1e;
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
        <div style={{ position: 'absolute', top: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 20, fontSize: 12, fontWeight: 900, color: comboColor, textShadow: '2px 2px 0 #0a0a1e', fontFamily: "'Press Start 2P', monospace" }}>
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
      {!lastClearBonusText && !isFever && <div style={{ minHeight: 18, flexShrink: 0 }} />}

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

      <div className="ice-slide-actions">
        <button type="button" onClick={finishGame}>END</button>
        <button type="button" onClick={handleExit}>EXIT</button>
      </div>
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
