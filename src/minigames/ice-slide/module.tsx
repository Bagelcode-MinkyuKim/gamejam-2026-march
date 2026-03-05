import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/seo-taiji.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const GRID_SIZE = 8
const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 10000
const MOVE_ANIMATION_MS = 150
const BONUS_THRESHOLD_MOVES = 8
const BONUS_PER_SAVED_MOVE = 3
const BASE_CLEAR_SCORE = 20
const SCORE_ESCALATION = 5

// --- Gimmick constants ---
const STREAK_MULTIPLIER_THRESHOLD = 3
const TIME_BONUS_BASE = 2000
const TIME_BONUS_PER_STAGE = 500
const SPEED_BONUS_THRESHOLD_MS = 8000
const SPEED_BONUS_SCORE = 15
const FEVER_STREAK_THRESHOLD = 5
const FEVER_MULTIPLIER = 2

type CellType = 'ice' | 'wall' | 'exit'

interface Position {
  readonly row: number
  readonly col: number
}

interface StageLayout {
  readonly grid: CellType[][]
  readonly start: Position
  readonly exit: Position
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
      ['wall', 'ice',  'ice',  'wall', 'ice',  'ice',  'ice',  'wall'],
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
      ['wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'ice',  'wall'],
      ['wall', 'wall', 'ice',  'wall', 'ice',  'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'wall', 'ice',  'wall'],
      ['wall', 'ice',  'wall', 'ice',  'wall', 'ice',  'ice',  'wall'],
      ['wall', 'exit', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ],
    start: { row: 1, col: 6 },
    exit: { row: 7, col: 1 },
  },
  {
    grid: [
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'ice',  'wall'],
      ['wall', 'wall', 'ice',  'wall', 'ice',  'ice',  'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'wall', 'ice',  'wall'],
      ['wall', 'ice',  'wall', 'wall', 'ice',  'ice',  'ice',  'wall'],
      ['wall', 'ice',  'ice',  'ice',  'wall', 'wall', 'ice',  'wall'],
      ['wall', 'wall', 'ice',  'wall', 'ice',  'ice',  'ice',  'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'exit', 'wall', 'wall'],
    ],
    start: { row: 1, col: 1 },
    exit: { row: 7, col: 5 },
  },
  {
    grid: [
      ['wall', 'wall', 'wall', 'exit', 'wall', 'wall', 'wall', 'wall'],
      ['wall', 'ice',  'ice',  'ice',  'ice',  'wall', 'ice',  'wall'],
      ['wall', 'wall', 'ice',  'wall', 'ice',  'ice',  'ice',  'wall'],
      ['wall', 'ice',  'ice',  'ice',  'wall', 'ice',  'wall', 'wall'],
      ['wall', 'ice',  'wall', 'ice',  'ice',  'ice',  'ice',  'wall'],
      ['wall', 'ice',  'ice',  'wall', 'wall', 'ice',  'wall', 'wall'],
      ['wall', 'ice',  'wall', 'ice',  'ice',  'ice',  'ice',  'wall'],
      ['wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
    ],
    start: { row: 6, col: 6 },
    exit: { row: 0, col: 3 },
  },
]

type Direction = 'up' | 'down' | 'left' | 'right'

function slideOnIce(grid: CellType[][], from: Position, direction: Direction): Position {
  let row = from.row
  let col = from.col

  const dRow = direction === 'up' ? -1 : direction === 'down' ? 1 : 0
  const dCol = direction === 'left' ? -1 : direction === 'right' ? 1 : 0

  while (true) {
    const nextRow = row + dRow
    const nextCol = col + dCol

    if (nextRow < 0 || nextRow >= GRID_SIZE || nextCol < 0 || nextCol >= GRID_SIZE) {
      break
    }

    const nextCell = grid[nextRow][nextCol]

    if (nextCell === 'wall') {
      break
    }

    row = nextRow
    col = nextCol

    if (nextCell === 'exit') {
      break
    }
  }

  return { row, col }
}

function getStageByIndex(index: number): StageLayout {
  return STAGE_LAYOUTS[index % STAGE_LAYOUTS.length]
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

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const stagesClearedRef = useRef(0)
  const moveCountRef = useRef(0)
  const totalMovesRef = useRef(0)
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

  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const currentStage = useMemo(() => getStageByIndex(currentStageIndex), [currentStageIndex])

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

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const advanceStage = useCallback(() => {
    const clearedMoves = moveCountRef.current
    const savedMoves = Math.max(0, BONUS_THRESHOLD_MOVES - clearedMoves)
    const escalation = stagesClearedRef.current * SCORE_ESCALATION

    // Streak tracking
    const nextStreak = streakRef.current + 1
    streakRef.current = nextStreak
    setStreak(nextStreak)

    // Streak multiplier
    const streakMult = nextStreak >= STREAK_MULTIPLIER_THRESHOLD ? 1 + Math.floor(nextStreak / STREAK_MULTIPLIER_THRESHOLD) * 0.5 : 1

    // Speed bonus
    const elapsedOnStageMs = (ROUND_DURATION_MS - remainingMsRef.current) - stageStartMsRef.current
    const speedBonus = elapsedOnStageMs < SPEED_BONUS_THRESHOLD_MS ? SPEED_BONUS_SCORE : 0

    // Fever mode
    if (nextStreak >= FEVER_STREAK_THRESHOLD && !isFeverRef.current) {
      isFeverRef.current = true
      setIsFever(true)
      effects.triggerFlash('#38bdf8')
    }
    const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1

    const baseClearScore = BASE_CLEAR_SCORE + escalation + savedMoves * BONUS_PER_SAVED_MOVE + speedBonus
    const clearScore = Math.round(baseClearScore * streakMult * feverMult)

    const nextScore = scoreRef.current + clearScore
    scoreRef.current = nextScore
    setScore(nextScore)

    // Time bonus
    const timeBonus = TIME_BONUS_BASE + Math.min(stagesClearedRef.current * TIME_BONUS_PER_STAGE, 5000)
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + timeBonus)

    // Build bonus text
    const bonusParts: string[] = [`+${clearScore}`]
    if (speedBonus > 0) bonusParts.push('SPEED!')
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

    const nextStageIndex = currentStageIndexRef.current + 1
    currentStageIndexRef.current = nextStageIndex
    setCurrentStageIndex(nextStageIndex)

    const nextStage = getStageByIndex(nextStageIndex)
    playerPosRef.current = nextStage.start
    setPlayerPos(nextStage.start)

    stageStartMsRef.current = ROUND_DURATION_MS - remainingMsRef.current

    setIsClearFlash(true)
    clearTimeoutSafe(clearFlashTimerRef)
    clearFlashTimerRef.current = window.setTimeout(() => {
      clearFlashTimerRef.current = null
      setIsClearFlash(false)
    }, 400)

    playAudio(tapStrongAudioRef, 0.6, 1.1 + nextStagesCleared * 0.03)
    effects.comboHitBurst(170, 170, nextStreak, clearScore)
  }, [playAudio])

  const handleMove = useCallback(
    (direction: Direction) => {
      if (finishedRef.current || isSlidingRef.current) {
        return
      }

      const stage = getStageByIndex(currentStageIndexRef.current)
      const from = playerPosRef.current
      const destination = slideOnIce(stage.grid, from, direction)

      if (destination.row === from.row && destination.col === from.col) {
        return
      }

      isSlidingRef.current = true
      setIsSliding(true)

      const nextMoveCount = moveCountRef.current + 1
      moveCountRef.current = nextMoveCount
      setMoveCount(nextMoveCount)

      totalMovesRef.current += 1

      playAudio(tapAudioRef, 0.4, 0.95 + Math.random() * 0.1)
      effects.triggerShake(3)
      effects.spawnParticles(2, 170, 170)

      setTargetPos(destination)
      playerPosRef.current = destination

      window.setTimeout(() => {
        setPlayerPos(destination)
        setTargetPos(null)
        isSlidingRef.current = false
        setIsSliding(false)

        if (
          destination.row === stage.exit.row &&
          destination.col === stage.exit.col
        ) {
          advanceStage()
        }
      }, MOVE_ANIMATION_MS)
    },
    [advanceStage, playAudio],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(clearFlashTimerRef)
    clearTimeoutSafe(bonusTextTimerRef)

    const elapsedMs = Math.max(1, ROUND_DURATION_MS - remainingMsRef.current)
    playAudio(gameOverAudioRef, 0.6, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(elapsedMs),
    })
  }, [onFinish, playAudio])

  const handleExit = useCallback(() => {
    playAudio(tapStrongAudioRef, 0.42, 1.02)
    onExit()
  }, [onExit, playAudio])

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
      clearTimeoutSafe(clearFlashTimerRef)
      clearTimeoutSafe(bonusTextTimerRef)
      tapAudioRef.current = null
      tapStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current) {
        return
      }

      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }

      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          event.preventDefault()
          handleMove('up')
          break
        case 'ArrowDown':
        case 'KeyS':
          event.preventDefault()
          handleMove('down')
          break
        case 'ArrowLeft':
        case 'KeyA':
          event.preventDefault()
          handleMove('left')
          break
        case 'ArrowRight':
        case 'KeyD':
          event.preventDefault()
          handleMove('right')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleMove, handleExit])

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

  const slidingStyle = useMemo(() => {
    if (targetPos === null) {
      return undefined
    }

    return {
      '--slide-to-row': targetPos.row,
      '--slide-to-col': targetPos.col,
      animationDuration: `${MOVE_ANIMATION_MS}ms`,
    } as React.CSSProperties
  }, [targetPos])

  const comboLabel = getComboLabel(stagesCleared)
  const comboColor = getComboColor(stagesCleared)
  const streakMult = streak >= STREAK_MULTIPLIER_THRESHOLD ? 1 + Math.floor(streak / STREAK_MULTIPLIER_THRESHOLD) * 0.5 : 1

  return (
    <section className="mini-game-panel ice-slide-panel" aria-label="ice-slide-game" style={{...effects.getShakeStyle(), position: 'relative'}}>
      <style>{GAME_EFFECTS_CSS}
      {`
        .ice-slide-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 0 0 8px;
          width: 100%;
          max-width: 432px;
          aspect-ratio: 9 / 16;
          margin: 0 auto;
          height: 100%;
          background: linear-gradient(180deg, #0c1929 0%, #0f2744 30%, #162d50 60%, #0e1f3a 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          overflow: hidden;
        }

        .ice-slide-hud-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #38bdf8;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(56,189,248,0.4);
          flex-shrink: 0;
        }

        .ice-slide-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          max-width: 400px;
          padding: 8px 14px;
          background: linear-gradient(180deg, rgba(56,189,248,0.22) 0%, rgba(56,189,248,0.05) 100%);
          border-bottom: 1px solid rgba(56,189,248,0.25);
        }

        .ice-slide-score {
          font-size: 22px;
          font-weight: bold;
          color: #0ea5e9;
          margin: 0;
          text-shadow: 1px 1px 0 #bae6fd;
        }

        .ice-slide-best {
          font-size: 9px;
          color: #64748b;
          margin: 0;
        }

        .ice-slide-time {
          font-size: 16px;
          font-weight: bold;
          color: #e2e8f0;
          margin: 0;
          transition: color 0.2s;
        }

        .ice-slide-time.low-time {
          color: #ef4444;
          animation: ice-slide-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes ice-slide-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .ice-slide-meta-row {
          display: flex;
          justify-content: center;
          gap: 14px;
          font-size: 9px;
          color: #94a3b8;
          margin: 0;
          padding: 2px 8px;
        }

        .ice-slide-meta-row strong {
          color: #38bdf8;
        }

        .ice-slide-board-wrapper {
          position: relative;
          width: 100%;
          max-width: 340px;
          aspect-ratio: 1;
          margin: 4px 0;
        }

        .ice-slide-board {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          grid-template-rows: repeat(8, 1fr);
          width: 100%;
          height: 100%;
          border-radius: 6px;
          overflow: hidden;
          border: 3px solid #1e3a5f;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
          background: #1e3a5f;
          gap: 1px;
        }

        .ice-slide-board.clear-flash {
          box-shadow: 0 0 20px 4px rgba(56, 189, 248, 0.6);
        }

        .ice-slide-board.fever-board {
          border-color: #f59e0b;
          box-shadow: 0 0 16px 2px rgba(245, 158, 11, 0.4);
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
          animation: ice-slide-exit-glow 1.2s ease-in-out infinite alternate;
        }

        @keyframes ice-slide-exit-glow {
          from { box-shadow: inset 0 1px 3px rgba(255, 255, 255, 0.5), 0 0 4px rgba(74, 222, 128, 0.4); }
          to { box-shadow: inset 0 1px 3px rgba(255, 255, 255, 0.5), 0 0 10px rgba(74, 222, 128, 0.8); }
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
          animation: ice-slide-move var(--slide-duration, 150ms) ease-out forwards;
        }

        .ice-slide-player-dot {
          width: 65%;
          height: 65%;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #fbbf24, #f59e0b, #d97706);
          box-shadow: 0 2px 6px rgba(217, 119, 6, 0.5), inset 0 -2px 4px rgba(0, 0, 0, 0.15);
          border: 2px solid #fbbf24;
        }

        .ice-slide-exit-marker {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 10px;
          font-weight: bold;
          color: #166534;
          text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
          pointer-events: none;
        }

        .ice-slide-dpad {
          display: grid;
          grid-template-areas:
            '. up .'
            'left . right'
            '. down .';
          grid-template-columns: 56px 56px 56px;
          grid-template-rows: 46px 46px 46px;
          gap: 3px;
          margin-top: 4px;
        }

        .ice-slide-dpad-btn {
          border: 2px solid #1e5a8a;
          border-radius: 8px;
          background: linear-gradient(180deg, #1e3a5f 0%, #163050 100%);
          color: #93c5fd;
          font-size: 18px;
          font-weight: bold;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 0 #0c2340, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
          -webkit-tap-highlight-color: transparent;
        }

        .ice-slide-dpad-btn:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #0c2340;
          background: linear-gradient(180deg, #264a6f 0%, #1e3a5f 100%);
        }

        .ice-slide-dpad-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }

        .ice-slide-dpad-up { grid-area: up; }
        .ice-slide-dpad-down { grid-area: down; }
        .ice-slide-dpad-left { grid-area: left; }
        .ice-slide-dpad-right { grid-area: right; }

        .ice-slide-actions {
          display: flex;
          gap: 10px;
          margin-top: 6px;
        }

        .ice-slide-actions button {
          font-size: 11px;
          font-weight: 700;
          padding: 8px 18px;
          border: 2px solid #1e5a8a;
          border-radius: 8px;
          background: linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%);
          color: #fff;
          cursor: pointer;
          box-shadow: 0 3px 0 #075985, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
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

        .ice-slide-actions button:last-child:active {
          background: rgba(75,85,99,0.2);
        }

        .ice-slide-bonus-text {
          font-size: 14px;
          font-weight: 800;
          color: #fbbf24;
          text-shadow: 0 0 8px rgba(251, 191, 36, 0.6);
          animation: ice-slide-bonus-pop 0.4s ease-out;
          text-align: center;
          min-height: 20px;
          margin: 0;
        }

        @keyframes ice-slide-bonus-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

        .ice-slide-fever-banner {
          font-size: 12px;
          font-weight: 900;
          color: #f59e0b;
          letter-spacing: 3px;
          text-shadow: 0 0 12px rgba(245, 158, 11, 0.6);
          animation: ice-slide-fever-flash 0.3s ease-in-out infinite alternate;
          text-align: center;
          margin: 0;
        }

        @keyframes ice-slide-fever-flash {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      {comboLabel && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 20, fontSize: 18, color: comboColor }}>
          {comboLabel}
        </div>
      )}

      <div className="ice-slide-score-strip">
        <img src={characterSprite} alt="character" className="ice-slide-hud-avatar" />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p className="ice-slide-score">{score.toLocaleString()}</p>
          <p className="ice-slide-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`ice-slide-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="ice-slide-meta-row">
        <p>
          Stage <strong>{stagesCleared + 1}</strong>
        </p>
        <p>
          Cleared <strong>{stagesCleared}</strong>
        </p>
        <p>
          Moves <strong>{moveCount}</strong>
        </p>
        <p>
          Streak <strong style={{ color: streak >= STREAK_MULTIPLIER_THRESHOLD ? '#f59e0b' : '#0ea5e9' }}>{streak}</strong>
        </p>
        {streakMult > 1 && (
          <p style={{ color: '#f59e0b', fontWeight: 'bold' }}>
            x{streakMult.toFixed(1)}
          </p>
        )}
      </div>

      {isFever && <p className="ice-slide-fever-banner">FEVER x{FEVER_MULTIPLIER}</p>}
      {lastClearBonusText && <p className="ice-slide-bonus-text">{lastClearBonusText}</p>}

      <div className="ice-slide-board-wrapper">
        <div className={`ice-slide-board ${isClearFlash ? 'clear-flash' : ''} ${isFever ? 'fever-board' : ''}`}>
          {currentStage.grid.map((row, rowIndex) =>
            row.map((cell, colIndex) => (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={`ice-slide-cell ice-slide-cell-${cell}`}
              >
                {cell === 'exit' && (
                  <span className="ice-slide-exit-marker">EXIT</span>
                )}
              </div>
            )),
          )}
        </div>

        <div
          className={`ice-slide-player ${isSliding ? 'sliding' : ''}`}
          style={{
            left: `${(playerPos.col / GRID_SIZE) * 100}%`,
            top: `${(playerPos.row / GRID_SIZE) * 100}%`,
            ...(isSliding && targetPos !== null
              ? {
                  transition: `left ${MOVE_ANIMATION_MS}ms ease-out, top ${MOVE_ANIMATION_MS}ms ease-out`,
                  left: `${(targetPos.col / GRID_SIZE) * 100}%`,
                  top: `${(targetPos.row / GRID_SIZE) * 100}%`,
                }
              : {}),
            ...slidingStyle,
          }}
        >
          <div className="ice-slide-player-dot" />
        </div>
      </div>

      <div className="ice-slide-dpad">
        <button
          className="ice-slide-dpad-btn ice-slide-dpad-up"
          type="button"
          onClick={() => handleMove('up')}
          disabled={isSliding}
          aria-label="Move up"
        >
          ^
        </button>
        <button
          className="ice-slide-dpad-btn ice-slide-dpad-left"
          type="button"
          onClick={() => handleMove('left')}
          disabled={isSliding}
          aria-label="Move left"
        >
          &lt;
        </button>
        <button
          className="ice-slide-dpad-btn ice-slide-dpad-right"
          type="button"
          onClick={() => handleMove('right')}
          disabled={isSliding}
          aria-label="Move right"
        >
          &gt;
        </button>
        <button
          className="ice-slide-dpad-btn ice-slide-dpad-down"
          type="button"
          onClick={() => handleMove('down')}
          disabled={isSliding}
          aria-label="Move down"
        >
          v
        </button>
      </div>

      <div className="ice-slide-actions">
        <button type="button" onClick={finishGame}>
          End Game
        </button>
        <button type="button" onClick={handleExit}>
          Exit
        </button>
      </div>
    </section>
  )
}

export const iceSlideModule: MiniGameModule = {
  manifest: {
    id: 'ice-slide',
    title: 'Ice Slide',
    description: '\uBE59\uD310 \uC704\uC5D0\uC11C \uBBF8\uB044\uB7EC\uC838 \uCD9C\uAD6C\uB97C \uCC3E\uC544\uB77C! \uD37C\uC990 \uB7EC\uB108!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#38bdf8',
  },
  Component: IceSlideGame,
}
