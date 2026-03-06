import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/seo-taiji.png'
import swooshSfx from '../../../assets/sounds/ice-slide-swoosh.mp3'
import crackSfx from '../../../assets/sounds/ice-slide-crack.mp3'
import clearSfx from '../../../assets/sounds/ice-slide-clear.mp3'
import teleportSfx from '../../../assets/sounds/ice-slide-teleport.mp3'
import feverSfx from '../../../assets/sounds/ice-slide-fever.mp3'
import gemSfx from '../../../assets/sounds/ice-slide-gem.mp3'
import gameoverSfx from '../../../assets/sounds/ice-slide-gameover.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const GRID_SIZE = 8
const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 10000
const MOVE_ANIMATION_MS = 120
const BONUS_THRESHOLD_MOVES = 8
const BONUS_PER_SAVED_MOVE = 3
const BASE_CLEAR_SCORE = 20
const SCORE_ESCALATION = 5

const STREAK_MULTIPLIER_THRESHOLD = 3
const TIME_BONUS_BASE = 2000
const TIME_BONUS_PER_STAGE = 500
const SPEED_BONUS_THRESHOLD_MS = 8000
const SPEED_BONUS_SCORE = 15
const FEVER_STREAK_THRESHOLD = 5
const FEVER_MULTIPLIER = 2
const GEM_SCORE = 10

const SWIPE_DEAD_ZONE = 20

type CellType = 'ice' | 'wall' | 'exit' | 'crack' | 'teleport' | 'gem'

interface Position {
  readonly row: number
  readonly col: number
}

interface StageLayout {
  readonly grid: CellType[][]
  readonly start: Position
  readonly exit: Position
  readonly teleportPairs?: [Position, Position][]
}

const STAGE_LAYOUTS: StageLayout[] = [
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
  {
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'ice',  'ice',  'wall', 'ice',  'ice',  'ice',  'wall'],
      ['wall', 'wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'wall'],
      ['wall', 'ice',  'ice',  'wall', 'ice',  'ice',  'gem',  'wall'],
      ['wall', 'ice',  'wall', 'ice',  'wall', 'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
      ['wall', 'ice',  'wall', 'wall', 'ice',  'wall', 'ice',  'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'exit', 'wall'],
    ],
    start: { row: 1, col: 5 },
    exit: { row: 7, col: 6 },
  },
  {
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'ice',  'ice',  'wall'],
      ['wall', 'ice',  'wall', 'wall', 'ice',  'wall', 'ice',  'wall'],
      ['wall', 'ice',  'crack','ice',  'wall', 'ice',  'ice',  'wall'],
      ['wall', 'wall', 'ice',  'wall', 'ice',  'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'wall', 'gem',  'wall'],
      ['wall', 'ice',  'wall', 'ice',  'wall', 'ice',  'ice',  'wall'],
      ['wall', 'exit', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ],
    start: { row: 1, col: 6 },
    exit: { row: 7, col: 1 },
  },
  {
    grid: [
      ['wall',     'wall', 'wall', 'wall',     'wall', 'wall', 'wall', 'wall'],
      ['wall',     'ice',  'ice',  'ice',      'wall', 'ice',  'ice',  'wall'],
      ['wall',     'wall', 'ice',  'wall',     'ice',  'ice',  'wall', 'wall'],
      ['wall',     'ice',  'ice',  'teleport', 'ice',  'wall', 'ice',  'wall'],
      ['wall',     'ice',  'wall', 'wall',     'ice',  'ice',  'ice',  'wall'],
      ['wall',     'ice',  'crack','ice',      'wall', 'wall', 'ice',  'wall'],
      ['wall',     'wall', 'ice',  'wall',     'ice',  'teleport','ice','wall'],
      ['wall',     'wall', 'wall', 'wall',     'wall', 'exit', 'wall', 'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 5 },
    teleportPairs: [[{ row: 3, col: 3 }, { row: 6, col: 5 }]],
  },
  {
    grid: [
      ['wall', 'wall', 'wall', 'exit', 'wall',  'wall', 'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',   'wall', 'gem',  'wall'],
      ['wall', 'wall', 'crack','wall', 'ice',   'ice',  'ice',  'wall'],
      ['wall', 'ice',  'ice',  'ice',  'wall',  'ice',  'wall', 'wall'],
      ['wall', 'ice',  'wall', 'ice',  'crack', 'ice',  'ice',  'wall'],
      ['wall', 'ice',  'ice',  'wall', 'wall',  'ice',  'wall', 'wall'],
      ['wall', 'gem',  'wall', 'ice',  'ice',   'ice',  'ice',  'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall',  'wall', 'wall', 'wall'],
    ],
    start: { row: 6, col: 6 },
    exit: { row: 0, col: 3 },
  },
  // Stage 6: teleport heavy
  {
    grid: [
      ['wall',     'wall',     'wall', 'wall', 'wall',     'wall', 'wall',     'wall'],
      ['wall',     'ice',      'ice',  'wall', 'teleport', 'ice',  'ice',      'wall'],
      ['wall',     'wall',     'ice',  'ice',  'ice',      'wall', 'crack',    'wall'],
      ['wall',     'ice',      'gem',  'wall', 'ice',      'ice',  'ice',      'wall'],
      ['wall',     'teleport', 'wall', 'ice',  'wall',     'ice',  'wall',     'wall'],
      ['wall',     'ice',      'ice',  'ice',  'crack',    'wall', 'ice',      'wall'],
      ['wall',     'ice',      'wall', 'wall', 'ice',      'ice',  'teleport', 'wall'],
      ['wall',     'wall',     'wall', 'wall', 'wall',     'exit', 'wall',     'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 5 },
    teleportPairs: [
      [{ row: 1, col: 4 }, { row: 4, col: 1 }],
      [{ row: 6, col: 6 }, { row: 1, col: 4 }],
    ],
  },
  // Stage 7: crack maze
  {
    grid: [
      ['wall', 'wall', 'wall', 'wall',  'wall',  'wall', 'wall', 'wall'],
      ['wall', 'ice',  'crack','ice',   'ice',   'crack','ice',  'wall'],
      ['wall', 'ice',  'wall', 'wall',  'ice',   'wall', 'ice',  'wall'],
      ['wall', 'crack','ice',  'gem',   'wall',  'ice',  'crack','wall'],
      ['wall', 'wall', 'ice',  'wall',  'crack', 'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'crack', 'ice',   'wall', 'ice',  'wall'],
      ['wall', 'gem',  'wall', 'ice',   'wall',  'ice',  'ice',  'wall'],
      ['wall', 'wall', 'wall', 'wall',  'wall',  'wall', 'exit', 'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 6 },
  },
]

type Direction = 'up' | 'down' | 'left' | 'right'

interface SlideResult {
  readonly destination: Position
  readonly passedCells: Position[]
}

function slideOnIce(grid: CellType[][], from: Position, direction: Direction): SlideResult {
  let row = from.row
  let col = from.col
  const passed: Position[] = []

  const dRow = direction === 'up' ? -1 : direction === 'down' ? 1 : 0
  const dCol = direction === 'left' ? -1 : direction === 'right' ? 1 : 0

  while (true) {
    const nextRow = row + dRow
    const nextCol = col + dCol

    if (nextRow < 0 || nextRow >= GRID_SIZE || nextCol < 0 || nextCol >= GRID_SIZE) break
    const nextCell = grid[nextRow][nextCol]
    if (nextCell === 'wall') break

    row = nextRow
    col = nextCol
    passed.push({ row, col })

    if (nextCell === 'exit' || nextCell === 'teleport') break
    if (nextCell === 'crack') break // stop on crack tiles
  }

  return { destination: { row, col }, passedCells: passed }
}

function getStageByIndex(index: number): StageLayout {
  return STAGE_LAYOUTS[index % STAGE_LAYOUTS.length]
}

function deepCopyGrid(grid: CellType[][]): CellType[][] {
  return grid.map(row => [...row])
}

// --- Trail effect ---
interface TrailDot {
  id: number
  row: number
  col: number
  createdAt: number
}

function IceSlideGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [stagesCleared, setStagesCleared] = useState(0)
  const [moveCount, setMoveCount] = useState(0)
  const [currentStageIndex, setCurrentStageIndex] = useState(0)
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

  // Touch tracking
  const touchIdRef = useRef<number | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  // Audio refs
  const audioCache = useRef<Record<string, HTMLAudioElement>>({})

  const currentStage = useMemo(() => getStageByIndex(currentStageIndex), [currentStageIndex])

  const playSound = useCallback((src: string, volume = 0.5, rate = 1) => {
    let audio = audioCache.current[src]
    if (!audio) {
      audio = new Audio(src)
      audio.preload = 'auto'
      audioCache.current[src] = audio
    }
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const addTrails = useCallback((cells: Position[]) => {
    const now = performance.now()
    const newTrails = cells.map(c => ({
      id: ++trailIdRef.current,
      row: c.row,
      col: c.col,
      createdAt: now,
    }))
    setTrails(prev => [...prev, ...newTrails])
    // Clean old trails after animation
    window.setTimeout(() => {
      setTrails(prev => prev.filter(t => !newTrails.some(nt => nt.id === t.id)))
    }, 600)
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
      isFeverRef.current = true
      setIsFever(true)
      effects.triggerFlash('#38bdf8')
      playSound(feverSfx, 0.6)
    }
    const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1

    const gemBonus = gemsRef.current * GEM_SCORE
    const baseClearScore = BASE_CLEAR_SCORE + escalation + savedMoves * BONUS_PER_SAVED_MOVE + speedBonus + gemBonus
    const clearScore = Math.round(baseClearScore * streakMult * feverMult)

    const nextScore = scoreRef.current + clearScore
    scoreRef.current = nextScore
    setScore(nextScore)

    const timeBonus = TIME_BONUS_BASE + Math.min(stagesClearedRef.current * TIME_BONUS_PER_STAGE, 5000)
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + timeBonus)

    const bonusParts: string[] = [`+${clearScore}`]
    if (speedBonus > 0) bonusParts.push('SPEED!')
    if (gemBonus > 0) bonusParts.push(`GEM+${gemBonus}`)
    if (streakMult > 1) bonusParts.push(`x${streakMult.toFixed(1)}`)
    if (isFeverRef.current) bonusParts.push('FEVER!')
    setLastClearBonusText(bonusParts.join(' '))
    clearTimeoutSafe(bonusTextTimerRef)
    bonusTextTimerRef.current = window.setTimeout(() => {
      bonusTextTimerRef.current = null
      setLastClearBonusText('')
    }, 1500)

    const nextStagesCleared = stagesClearedRef.current + 1
    stagesClearedRef.current = nextStagesCleared
    setStagesCleared(nextStagesCleared)

    moveCountRef.current = 0
    setMoveCount(0)
    gemsRef.current = 0
    setGemsCollected(0)

    const nextStageIndex = currentStageIndexRef.current + 1
    currentStageIndexRef.current = nextStageIndex
    setCurrentStageIndex(nextStageIndex)

    const nextStage = getStageByIndex(nextStageIndex)
    playerPosRef.current = nextStage.start
    setPlayerPos(nextStage.start)

    const newGrid = deepCopyGrid(nextStage.grid)
    liveGridRef.current = newGrid
    setLiveGrid(newGrid)
    setTrails([])

    stageStartMsRef.current = ROUND_DURATION_MS - remainingMsRef.current

    setIsClearFlash(true)
    clearTimeoutSafe(clearFlashTimerRef)
    clearFlashTimerRef.current = window.setTimeout(() => {
      clearFlashTimerRef.current = null
      setIsClearFlash(false)
    }, 400)

    playSound(clearSfx, 0.6, 1.1 + nextStagesCleared * 0.03)
    effects.comboHitBurst(170, 170, nextStreak, clearScore)
  }, [playSound, effects])

  const handleMove = useCallback(
    (direction: Direction) => {
      if (finishedRef.current || isSlidingRef.current) return

      const grid = liveGridRef.current
      const from = playerPosRef.current
      const { destination, passedCells } = slideOnIce(grid, from, direction)

      if (destination.row === from.row && destination.col === from.col) return

      isSlidingRef.current = true
      setIsSliding(true)

      const nextMoveCount = moveCountRef.current + 1
      moveCountRef.current = nextMoveCount
      setMoveCount(nextMoveCount)

      playSound(swooshSfx, 0.4, 0.95 + Math.random() * 0.1)
      effects.triggerShake(3)
      addTrails(passedCells)

      // Collect gems along the path
      for (const cell of passedCells) {
        if (grid[cell.row][cell.col] === 'gem') {
          grid[cell.row][cell.col] = 'ice'
          gemsRef.current += 1
          setGemsCollected(g => g + 1)
          playSound(gemSfx, 0.5, 1.0 + gemsRef.current * 0.1)
          effects.showScorePopup(GEM_SCORE, (cell.col / GRID_SIZE) * 340, (cell.row / GRID_SIZE) * 340)
          const gemScore = GEM_SCORE * (isFeverRef.current ? FEVER_MULTIPLIER : 1)
          scoreRef.current += gemScore
          setScore(scoreRef.current)
        }
      }

      // Handle crack tiles
      const destCell = grid[destination.row][destination.col]
      if (destCell === 'crack') {
        grid[destination.row][destination.col] = 'wall'
        liveGridRef.current = [...grid.map(r => [...r])]
        setLiveGrid(liveGridRef.current)
        playSound(crackSfx, 0.5)
        effects.triggerShake(5)
      }

      setTargetPos(destination)
      playerPosRef.current = destination

      window.setTimeout(() => {
        setPlayerPos(destination)
        setTargetPos(null)
        isSlidingRef.current = false
        setIsSliding(false)

        const stage = getStageByIndex(currentStageIndexRef.current)

        // Check teleport
        if (grid[destination.row]?.[destination.col] === 'teleport') {
          const teleportDest = handleTeleport(destination, currentStageIndexRef.current)
          if (teleportDest) {
            playSound(teleportSfx, 0.5)
            setShowTeleportFlash(true)
            effects.triggerFlash('#a855f7')
            playerPosRef.current = teleportDest
            setPlayerPos(teleportDest)
            window.setTimeout(() => setShowTeleportFlash(false), 300)

            if (teleportDest.row === stage.exit.row && teleportDest.col === stage.exit.col) {
              advanceStage()
            }
            return
          }
        }

        if (destination.row === stage.exit.row && destination.col === stage.exit.col) {
          advanceStage()
        }
      }, MOVE_ANIMATION_MS)
    },
    [advanceStage, playSound, effects, addTrails, handleTeleport],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(clearFlashTimerRef)
    clearTimeoutSafe(bonusTextTimerRef)

    const elapsedMs = Math.max(1, ROUND_DURATION_MS - remainingMsRef.current)
    playSound(gameoverSfx, 0.6, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(elapsedMs) })
  }, [onFinish, playSound])

  const handleExit = useCallback(() => {
    playSound(swooshSfx, 0.42, 1.02)
    onExit()
  }, [onExit, playSound])

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current) return
      if (event.code === 'Escape') { event.preventDefault(); handleExit(); return }
      switch (event.code) {
        case 'ArrowUp': case 'KeyW': event.preventDefault(); handleMove('up'); break
        case 'ArrowDown': case 'KeyS': event.preventDefault(); handleMove('down'); break
        case 'ArrowLeft': case 'KeyA': event.preventDefault(); handleMove('left'); break
        case 'ArrowRight': case 'KeyD': event.preventDefault(); handleMove('right'); break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleMove, handleExit])

  // Touch/swipe controls
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      const t = e.touches[0]
      touchIdRef.current = t.identifier
      touchStartRef.current = { x: t.clientX, y: t.clientY }
    }
  }, [])

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || touchIdRef.current === null) return
    let t: React.Touch | null = null
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchIdRef.current) {
        t = e.changedTouches[i]; break
      }
    }
    if (!t) return
    const dx = t.clientX - touchStartRef.current.x
    const dy = t.clientY - touchStartRef.current.y
    touchIdRef.current = null
    touchStartRef.current = null
    if (Math.abs(dx) < SWIPE_DEAD_ZONE && Math.abs(dy) < SWIPE_DEAD_ZONE) return
    if (Math.abs(dx) > Math.abs(dy)) {
      handleMove(dx > 0 ? 'right' : 'left')
    } else {
      handleMove(dy > 0 ? 'down' : 'up')
    }
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
    return () => {
      if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
      lastFrameAtRef.current = null
      effects.cleanup()
    }
  }, [finishGame])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      clearTimeoutSafe(clearFlashTimerRef)
      clearTimeoutSafe(bonusTextTimerRef)
      audioCache.current = {}
    }
  }, [])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const comboLabel = getComboLabel(stagesCleared)
  const comboColor = getComboColor(stagesCleared)
  const streakMult = streak >= STREAK_MULTIPLIER_THRESHOLD ? 1 + Math.floor(streak / STREAK_MULTIPLIER_THRESHOLD) * 0.5 : 1
  const timePercent = (remainingMs / ROUND_DURATION_MS) * 100

  return (
    <section
      className="mini-game-panel ice-slide-panel"
      aria-label="ice-slide-game"
      style={{ ...effects.getShakeStyle(), position: 'relative' }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .ice-slide-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 432px;
          margin: 0 auto;
          height: 100%;
          background: linear-gradient(180deg, #0c1929 0%, #0f2744 30%, #162d50 60%, #0e1f3a 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          overflow: hidden;
          padding: 0;
          box-sizing: border-box;
        }

        .ice-slide-hud {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 8px 12px;
          background: linear-gradient(180deg, rgba(56,189,248,0.22) 0%, rgba(56,189,248,0.05) 100%);
          border-bottom: 1px solid rgba(56,189,248,0.25);
          flex-shrink: 0;
        }

        .ice-slide-hud-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 2px solid #38bdf8;
          object-fit: cover;
          box-shadow: 0 0 10px rgba(56,189,248,0.4);
        }

        .ice-slide-score-col {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
        }

        .ice-slide-score {
          font-size: 24px;
          font-weight: 900;
          color: #38bdf8;
          margin: 0;
          text-shadow: 0 0 12px rgba(56,189,248,0.5);
        }

        .ice-slide-best {
          font-size: 9px;
          color: #64748b;
          margin: 0;
        }

        .ice-slide-time-col {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .ice-slide-time {
          font-size: 18px;
          font-weight: bold;
          color: #e2e8f0;
          margin: 0;
          transition: color 0.2s;
        }

        .ice-slide-time.low-time {
          color: #ef4444;
          animation: ice-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes ice-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.05); }
        }

        .ice-slide-time-bar {
          width: 60px;
          height: 3px;
          background: #1e3a5f;
          border-radius: 2px;
          overflow: hidden;
        }

        .ice-slide-time-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #ef4444, #38bdf8);
          transition: width 0.3s;
          border-radius: 2px;
        }

        .ice-slide-meta {
          display: flex;
          justify-content: center;
          gap: 12px;
          font-size: 10px;
          color: #94a3b8;
          padding: 3px 8px;
          flex-shrink: 0;
        }

        .ice-slide-meta strong { color: #38bdf8; }

        .ice-slide-board-area {
          flex: 1;
          min-height: 0;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px;
          box-sizing: border-box;
          position: relative;
        }

        .ice-slide-board-wrapper {
          position: relative;
          width: 100%;
          max-width: 400px;
          aspect-ratio: 1;
          max-height: 100%;
        }

        .ice-slide-board {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          grid-template-rows: repeat(8, 1fr);
          width: 100%;
          height: 100%;
          border-radius: 8px;
          overflow: hidden;
          border: 3px solid #1e3a5f;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          background: #1e3a5f;
          gap: 1px;
          transition: box-shadow 0.3s, border-color 0.3s;
        }

        .ice-slide-board.clear-flash {
          box-shadow: 0 0 30px 8px rgba(56, 189, 248, 0.7);
          border-color: #38bdf8;
        }

        .ice-slide-board.fever-board {
          border-color: #f59e0b;
          box-shadow: 0 0 20px 4px rgba(245, 158, 11, 0.5);
          animation: fever-glow 0.6s ease-in-out infinite alternate;
        }

        @keyframes fever-glow {
          from { box-shadow: 0 0 16px 2px rgba(245, 158, 11, 0.3); }
          to { box-shadow: 0 0 24px 6px rgba(245, 158, 11, 0.6); }
        }

        .ice-slide-cell {
          position: relative;
          width: 100%;
          height: 100%;
        }

        .ice-slide-cell-ice {
          background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 40%, #93c5fd 100%);
          box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6);
        }

        .ice-slide-cell-wall {
          background: linear-gradient(135deg, #1e3a5f 0%, #1e40af 50%, #1e3a8a 100%);
          box-shadow: inset 0 -2px 3px rgba(0, 0, 0, 0.3);
        }

        .ice-slide-cell-exit {
          background: linear-gradient(135deg, #86efac 0%, #4ade80 50%, #22c55e 100%);
          box-shadow: inset 0 1px 3px rgba(255, 255, 255, 0.5);
          animation: exit-glow 1.2s ease-in-out infinite alternate;
        }

        .ice-slide-cell-crack {
          background: linear-gradient(135deg, #c7d2e0 0%, #a0b4c8 40%, #8899aa 100%);
          box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.3);
          position: relative;
        }

        .ice-slide-cell-crack::after {
          content: '';
          position: absolute;
          top: 20%; left: 30%; width: 40%; height: 60%;
          background: linear-gradient(45deg, transparent 30%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.15) 32%, transparent 32%,
                      transparent 50%, rgba(0,0,0,0.12) 50%, rgba(0,0,0,0.12) 52%, transparent 52%,
                      transparent 70%, rgba(0,0,0,0.1) 70%, rgba(0,0,0,0.1) 72%, transparent 72%);
        }

        .ice-slide-cell-teleport {
          background: linear-gradient(135deg, #c084fc 0%, #a855f7 50%, #7c3aed 100%);
          box-shadow: inset 0 1px 3px rgba(255, 255, 255, 0.4);
          animation: teleport-pulse 1s ease-in-out infinite alternate;
        }

        @keyframes teleport-pulse {
          from { box-shadow: inset 0 1px 3px rgba(255,255,255,0.4), 0 0 4px rgba(168,85,247,0.4); }
          to { box-shadow: inset 0 1px 3px rgba(255,255,255,0.4), 0 0 12px rgba(168,85,247,0.8); }
        }

        .ice-slide-cell-gem {
          background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 40%, #93c5fd 100%);
          box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.6);
          position: relative;
        }

        .ice-slide-gem-icon {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          font-size: 14px;
          animation: gem-bob 1.2s ease-in-out infinite alternate;
          filter: drop-shadow(0 0 4px rgba(251,191,36,0.6));
        }

        @keyframes gem-bob {
          from { transform: translate(-50%, -50%) scale(0.9); }
          to { transform: translate(-50%, -55%) scale(1.1); }
        }

        @keyframes exit-glow {
          from { box-shadow: inset 0 1px 3px rgba(255,255,255,0.5), 0 0 4px rgba(74,222,128,0.4); }
          to { box-shadow: inset 0 1px 3px rgba(255,255,255,0.5), 0 0 12px rgba(74,222,128,0.8); }
        }

        .ice-slide-exit-marker {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          font-size: 8px;
          font-weight: bold;
          color: #166534;
          text-shadow: 0 1px 1px rgba(255,255,255,0.5);
          pointer-events: none;
        }

        .ice-slide-teleport-icon {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          font-size: 12px;
          filter: drop-shadow(0 0 4px rgba(168,85,247,0.6));
        }

        .ice-slide-player {
          position: absolute;
          width: calc(100% / 8);
          height: calc(100% / 8);
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 10;
          transition: none;
        }

        .ice-slide-player.sliding {
          transition: left ${MOVE_ANIMATION_MS}ms ease-out, top ${MOVE_ANIMATION_MS}ms ease-out;
        }

        .ice-slide-player-dot {
          width: 70%;
          height: 70%;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #fbbf24, #f59e0b, #d97706);
          box-shadow: 0 2px 8px rgba(217, 119, 6, 0.6), inset 0 -2px 4px rgba(0, 0, 0, 0.15), 0 0 12px rgba(251,191,36,0.3);
          border: 2px solid #fbbf24;
          animation: player-glow 1.5s ease-in-out infinite alternate;
        }

        @keyframes player-glow {
          from { box-shadow: 0 2px 8px rgba(217,119,6,0.6), 0 0 8px rgba(251,191,36,0.2); }
          to { box-shadow: 0 2px 8px rgba(217,119,6,0.6), 0 0 16px rgba(251,191,36,0.5); }
        }

        .ice-slide-trail {
          position: absolute;
          width: calc(100% / 8);
          height: calc(100% / 8);
          pointer-events: none;
          z-index: 5;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .ice-slide-trail-dot {
          width: 30%;
          height: 30%;
          border-radius: 50%;
          background: rgba(56, 189, 248, 0.5);
          animation: trail-fade 0.5s ease-out forwards;
        }

        @keyframes trail-fade {
          from { opacity: 0.7; transform: scale(1.2); }
          to { opacity: 0; transform: scale(0.3); }
        }

        .ice-slide-dpad {
          display: grid;
          grid-template-areas:
            '. up .'
            'left center right'
            '. down .';
          grid-template-columns: 52px 52px 52px;
          grid-template-rows: 44px 44px 44px;
          gap: 3px;
          flex-shrink: 0;
          padding: 4px 0 6px;
        }

        .ice-slide-dpad-btn {
          border: 2px solid #1e5a8a;
          border-radius: 10px;
          background: linear-gradient(180deg, #1e3a5f 0%, #163050 100%);
          color: #93c5fd;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 0 #0c2340, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.06s, box-shadow 0.06s;
          -webkit-tap-highlight-color: transparent;
        }

        .ice-slide-dpad-btn:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #0c2340;
          background: linear-gradient(180deg, #264a6f 0%, #1e3a5f 100%);
        }

        .ice-slide-dpad-btn:disabled { opacity: 0.3; cursor: default; }

        .ice-slide-dpad-up { grid-area: up; }
        .ice-slide-dpad-down { grid-area: down; }
        .ice-slide-dpad-left { grid-area: left; }
        .ice-slide-dpad-right { grid-area: right; }

        .ice-slide-bonus-text {
          font-size: 16px;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.7);
          animation: bonus-pop 0.4s ease-out;
          text-align: center;
          min-height: 22px;
          margin: 0;
          flex-shrink: 0;
        }

        @keyframes bonus-pop {
          0% { transform: scale(0.5) translateY(10px); opacity: 0; }
          60% { transform: scale(1.3) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        .ice-slide-fever-banner {
          font-size: 13px;
          font-weight: 900;
          color: #f59e0b;
          letter-spacing: 4px;
          text-shadow: 0 0 14px rgba(245, 158, 11, 0.7);
          animation: fever-flash 0.3s ease-in-out infinite alternate;
          text-align: center;
          margin: 0;
          flex-shrink: 0;
        }

        @keyframes fever-flash {
          from { opacity: 0.6; transform: scale(1); }
          to { opacity: 1; transform: scale(1.05); }
        }

        .ice-slide-actions {
          display: flex;
          gap: 8px;
          padding: 0 0 8px;
          flex-shrink: 0;
        }

        .ice-slide-actions button {
          font-size: 11px;
          font-weight: 700;
          padding: 6px 16px;
          border: 2px solid #1e5a8a;
          border-radius: 8px;
          background: linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%);
          color: #fff;
          cursor: pointer;
          box-shadow: 0 3px 0 #075985;
          transition: transform 0.06s, box-shadow 0.06s;
        }

        .ice-slide-actions button:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #075985;
        }

        .ice-slide-actions button:last-child {
          background: transparent;
          color: #94a3b8;
          border-color: #475569;
          box-shadow: none;
        }

        .ice-slide-teleport-flash {
          position: absolute;
          inset: 0;
          background: radial-gradient(circle, rgba(168,85,247,0.4) 0%, transparent 70%);
          z-index: 15;
          pointer-events: none;
          animation: tp-flash 0.3s ease-out forwards;
        }

        @keyframes tp-flash {
          from { opacity: 1; } to { opacity: 0; }
        }

        .ice-slide-swipe-hint {
          font-size: 9px;
          color: #475569;
          text-align: center;
          margin: 0;
          flex-shrink: 0;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      {comboLabel && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 20, fontSize: 20, fontWeight: 900, color: comboColor, textShadow: `0 0 12px ${comboColor}` }}>
          {comboLabel}
        </div>
      )}

      {/* HUD */}
      <div className="ice-slide-hud">
        <img src={characterSprite} alt="" className="ice-slide-hud-avatar" />
        <div className="ice-slide-score-col">
          <p className="ice-slide-score">{score.toLocaleString()}</p>
          <p className="ice-slide-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="ice-slide-time-col">
          <p className={`ice-slide-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
          <div className="ice-slide-time-bar">
            <div className="ice-slide-time-bar-fill" style={{ width: `${timePercent}%` }} />
          </div>
        </div>
      </div>

      {/* Meta row */}
      <div className="ice-slide-meta">
        <span>Stage <strong>{stagesCleared + 1}</strong></span>
        <span>Moves <strong>{moveCount}</strong></span>
        <span>Streak <strong style={{ color: streak >= STREAK_MULTIPLIER_THRESHOLD ? '#f59e0b' : '#38bdf8' }}>{streak}</strong></span>
        {streakMult > 1 && <span style={{ color: '#f59e0b', fontWeight: 'bold' }}>x{streakMult.toFixed(1)}</span>}
        {gemsCollected > 0 && <span style={{ color: '#fbbf24' }}>Gems {gemsCollected}</span>}
      </div>

      {isFever && <p className="ice-slide-fever-banner">FEVER x{FEVER_MULTIPLIER}</p>}
      {lastClearBonusText && <p className="ice-slide-bonus-text">{lastClearBonusText}</p>}
      {!lastClearBonusText && !isFever && <div style={{ minHeight: 22, flexShrink: 0 }} />}

      {/* Game board area - fills remaining space */}
      <div
        className="ice-slide-board-area"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        role="presentation"
      >
        <div className="ice-slide-board-wrapper">
          <div className={`ice-slide-board ${isClearFlash ? 'clear-flash' : ''} ${isFever ? 'fever-board' : ''}`}>
            {liveGrid.map((row, rowIndex) =>
              row.map((cell, colIndex) => (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  className={`ice-slide-cell ice-slide-cell-${cell}`}
                >
                  {cell === 'exit' && <span className="ice-slide-exit-marker">EXIT</span>}
                  {cell === 'teleport' && <span className="ice-slide-teleport-icon">🌀</span>}
                  {cell === 'gem' && <span className="ice-slide-gem-icon">💎</span>}
                </div>
              )),
            )}
          </div>

          {/* Trail effects */}
          {trails.map(t => (
            <div
              key={t.id}
              className="ice-slide-trail"
              style={{
                left: `${(t.col / GRID_SIZE) * 100}%`,
                top: `${(t.row / GRID_SIZE) * 100}%`,
              }}
            >
              <div className="ice-slide-trail-dot" />
            </div>
          ))}

          {/* Player */}
          <div
            className={`ice-slide-player ${isSliding ? 'sliding' : ''}`}
            style={{
              left: `${((isSliding && targetPos ? targetPos.col : playerPos.col) / GRID_SIZE) * 100}%`,
              top: `${((isSliding && targetPos ? targetPos.row : playerPos.row) / GRID_SIZE) * 100}%`,
            }}
          >
            <div className="ice-slide-player-dot" />
          </div>

          {showTeleportFlash && <div className="ice-slide-teleport-flash" />}
        </div>
      </div>

      {/* D-pad controls */}
      <div className="ice-slide-dpad">
        <button className="ice-slide-dpad-btn ice-slide-dpad-up" type="button" onClick={() => handleMove('up')} disabled={isSliding} aria-label="Up">▲</button>
        <button className="ice-slide-dpad-btn ice-slide-dpad-left" type="button" onClick={() => handleMove('left')} disabled={isSliding} aria-label="Left">◀</button>
        <button className="ice-slide-dpad-btn ice-slide-dpad-right" type="button" onClick={() => handleMove('right')} disabled={isSliding} aria-label="Right">▶</button>
        <button className="ice-slide-dpad-btn ice-slide-dpad-down" type="button" onClick={() => handleMove('down')} disabled={isSliding} aria-label="Down">▼</button>
      </div>

      <p className="ice-slide-swipe-hint">Swipe or D-pad to slide</p>

      <div className="ice-slide-actions">
        <button type="button" onClick={finishGame}>End</button>
        <button type="button" onClick={handleExit}>Exit</button>
      </div>
    </section>
  )
}

export const iceSlideModule: MiniGameModule = {
  manifest: {
    id: 'ice-slide',
    title: 'Ice Slide',
    description: '빙판 위에서 미끄러져 출구를 찾아라! 크랙, 텔레포트, 젬까지!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#38bdf8',
  },
  Component: IceSlideGame,
}
