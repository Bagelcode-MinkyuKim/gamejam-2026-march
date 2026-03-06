import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

import correctSfx from '../../../assets/sounds/odd-one-out-correct.mp3'
import wrongSfx from '../../../assets/sounds/odd-one-out-wrong.mp3'
import feverSfx from '../../../assets/sounds/odd-one-out-fever.mp3'
import comboSfx from '../../../assets/sounds/odd-one-out-combo.mp3'
import timeWarningSfx from '../../../assets/sounds/odd-one-out-time-warning.mp3'
import levelUpSfx from '../../../assets/sounds/odd-one-out-level-up.mp3'
import timeBonusSfx from '../../../assets/sounds/odd-one-out-time-bonus.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// --- Constants ---
const ROUND_DURATION_MS = 30000
const TIME_PENALTY_MS = 2000
const TIME_BONUS_THRESHOLD_MS = 3000
const TIME_BONUS_MS = 1500
const LOW_TIME_THRESHOLD_MS = 5000
const FLASH_DURATION_MS = 250

const GRID_PROGRESSION = [3, 4, 5, 6, 7] as const
const ROUNDS_PER_GRID = 3

const BASE_HUE_SHIFT = 45
const MIN_HUE_SHIFT = 5
const HUE_SHIFT_DECAY = 2.0

const FEVER_STREAK_THRESHOLD = 5
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const STREAK_BONUS_STEP = 3

// Powerup constants
const HINT_COOLDOWN_MS = 12000
const HINT_DURATION_MS = 2000
const TIME_FREEZE_COOLDOWN_MS = 20000
const TIME_FREEZE_DURATION_MS = 3000
const DOUBLE_POINTS_COOLDOWN_MS = 15000
const DOUBLE_POINTS_DURATION_MS = 6000

const SHAPE_TYPES = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star'] as const
type ShapeType = (typeof SHAPE_TYPES)[number]

// Difficulty modes that change visual challenge
type DifficultyMode = 'hue' | 'saturation' | 'lightness' | 'shape-mix' | 'size-mix'

interface CellData {
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
  readonly shape: ShapeType
  readonly isOdd: boolean
  readonly scale: number
}

function pickDifficultyMode(round: number): DifficultyMode {
  if (round < 6) return 'hue'
  if (round < 12) {
    const modes: DifficultyMode[] = ['hue', 'saturation', 'lightness']
    return modes[round % modes.length]
  }
  const modes: DifficultyMode[] = ['hue', 'saturation', 'lightness', 'shape-mix', 'size-mix']
  return modes[round % modes.length]
}

function generateRound(gridSize: number, round: number): { cells: CellData[]; oddIndex: number } {
  const totalCells = gridSize * gridSize
  const oddIndex = Math.floor(Math.random() * totalCells)
  const mode = pickDifficultyMode(round)

  const baseHue = Math.floor(Math.random() * 360)
  const baseSaturation = 60 + Math.floor(Math.random() * 25)
  const baseLightness = 45 + Math.floor(Math.random() * 20)
  const shape = SHAPE_TYPES[Math.floor(Math.random() * SHAPE_TYPES.length)]

  const hueShift = Math.max(MIN_HUE_SHIFT, BASE_HUE_SHIFT - round * HUE_SHIFT_DECAY)
  const shiftDirection = Math.random() > 0.5 ? 1 : -1

  const cells: CellData[] = []
  for (let i = 0; i < totalCells; i += 1) {
    const isOdd = i === oddIndex
    let cellHue = baseHue
    let cellSat = baseSaturation
    let cellLight = baseLightness
    let cellShape = shape
    let cellScale = 1

    if (isOdd) {
      switch (mode) {
        case 'hue':
          cellHue = (baseHue + hueShift * shiftDirection + 360) % 360
          break
        case 'saturation':
          cellSat = Math.max(20, Math.min(100, baseSaturation + (Math.random() > 0.5 ? 20 : -20)))
          break
        case 'lightness':
          cellLight = Math.max(25, Math.min(75, baseLightness + (Math.random() > 0.5 ? 15 : -15)))
          break
        case 'shape-mix':
          cellHue = (baseHue + hueShift * shiftDirection + 360) % 360
          const otherShapes = SHAPE_TYPES.filter(s => s !== shape)
          cellShape = otherShapes[Math.floor(Math.random() * otherShapes.length)]
          break
        case 'size-mix':
          cellHue = (baseHue + hueShift * 0.5 * shiftDirection + 360) % 360
          cellScale = Math.random() > 0.5 ? 0.7 : 1.3
          break
      }
    }

    cells.push({
      hue: cellHue,
      saturation: cellSat,
      lightness: cellLight,
      shape: cellShape,
      isOdd,
      scale: cellScale,
    })
  }

  return { cells, oddIndex }
}

function toGridSize(round: number): number {
  const gridIndex = Math.min(Math.floor(round / ROUNDS_PER_GRID), GRID_PROGRESSION.length - 1)
  return GRID_PROGRESSION[gridIndex]
}

function cellColor(cell: CellData): string {
  return `hsl(${cell.hue}, ${cell.saturation}%, ${cell.lightness}%)`
}

function ShapeCell({ cell, size, onClick, isHinted, isFever }: {
  cell: CellData; size: number; onClick: () => void; isHinted: boolean; isFever: boolean
}) {
  const color = cellColor(cell)
  const innerSize = size * 0.68 * cell.scale
  const hintGlow = isHinted && cell.isOdd ? '0 0 12px 4px rgba(250,204,21,0.8)' : 'none'
  const feverBorder = isFever ? '2px solid rgba(250,204,21,0.4)' : '2px solid rgba(255, 255, 255, 0.08)'

  const renderShape = () => {
    const base: React.CSSProperties = {
      width: innerSize,
      height: innerSize,
      backgroundColor: color,
      transition: 'transform 0.15s, background-color 0.15s',
      boxShadow: hintGlow,
    }

    switch (cell.shape) {
      case 'circle':
        return <div style={{ ...base, borderRadius: '50%' }} />
      case 'square':
        return <div style={{ ...base, borderRadius: 3 }} />
      case 'diamond':
        return <div style={{ ...base, borderRadius: 3, transform: 'rotate(45deg)' }} />
      case 'triangle':
        return (
          <div style={{
            width: 0, height: 0,
            borderLeft: `${innerSize * 0.5}px solid transparent`,
            borderRight: `${innerSize * 0.5}px solid transparent`,
            borderBottom: `${innerSize * 0.86}px solid ${color}`,
            backgroundColor: 'transparent',
            filter: isHinted && cell.isOdd ? 'drop-shadow(0 0 8px rgba(250,204,21,0.8))' : 'none',
          }} />
        )
      case 'hexagon':
        return (
          <div style={{
            ...base,
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
          }} />
        )
      case 'star':
        return (
          <div style={{
            ...base,
            clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
          }} />
        )
    }
  }

  return (
    <button
      className="ooo-cell"
      type="button"
      onClick={onClick}
      style={{
        width: size, height: size,
        border: feverBorder,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0, margin: 0,
        borderRadius: 10,
        background: 'rgba(255, 255, 255, 0.05)',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
        transition: 'transform 0.1s, box-shadow 0.15s',
      }}
    >
      {renderShape()}
    </button>
  )
}

function OddOneOutGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [round, setRound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [cells, setCells] = useState<CellData[]>([])
  const [gridSize, setGridSize] = useState<number>(GRID_PROGRESSION[0])
  const [flashState, setFlashState] = useState<'none' | 'correct' | 'wrong'>('none')
  const [streak, setStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [isHinting, setIsHinting] = useState(false)
  const [hintCooldownMs, setHintCooldownMs] = useState(0)
  const [isTimeFrozen, setIsTimeFrozen] = useState(false)
  const [freezeCooldownMs, setFreezeCooldownMs] = useState(0)
  const [isDoublePoints, setIsDoublePoints] = useState(false)
  const [doubleCooldownMs, setDoubleCooldownMs] = useState(0)
  const [roundAnim, setRoundAnim] = useState(false)
  const [timeWarningPlayed, setTimeWarningPlayed] = useState(false)
  const [perfectRounds, setPerfectRounds] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const roundRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const roundStartTimeRef = useRef(0)
  const interactableRef = useRef(true)
  const streakRef = useRef(0)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const isTimeFrozenRef = useRef(false)
  const freezeCooldownMsRef = useRef(0)
  const freezeRemainingMsRef = useRef(0)
  const hintCooldownMsRef = useRef(0)
  const hintRemainingMsRef = useRef(0)
  const isDoublePointsRef = useRef(false)
  const doubleCooldownMsRef = useRef(0)
  const doubleRemainingMsRef = useRef(0)
  const timeWarningPlayedRef = useRef(false)
  const perfectRoundsRef = useRef(0)
  const wrongThisRoundRef = useRef(false)
  const lastGridSizeRef = useRef(GRID_PROGRESSION[0])

  // Audio refs
  const audioCache = useRef<Record<string, HTMLAudioElement>>({})

  const getAudio = useCallback((src: string) => {
    if (!audioCache.current[src]) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioCache.current[src] = audio
    }
    return audioCache.current[src]
  }, [])

  const playAudio = useCallback((src: string, volume = 0.5, rate = 1) => {
    const audio = getAudio(src)
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [getAudio])

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const startNewRound = useCallback(
    (nextRound: number) => {
      const nextGridSize = toGridSize(nextRound)
      const { cells: nextCells } = generateRound(nextGridSize, nextRound)

      roundRef.current = nextRound
      setRound(nextRound)
      setGridSize(nextGridSize)
      setCells(nextCells)
      interactableRef.current = true
      wrongThisRoundRef.current = false

      // Grid size changed - play level up
      if (nextGridSize !== lastGridSizeRef.current && nextRound > 0) {
        playAudio(levelUpSfx, 0.5)
        effects.triggerFlash('rgba(132,204,22,0.4)')
      }
      lastGridSizeRef.current = nextGridSize

      // Round transition animation
      setRoundAnim(true)
      setTimeout(() => setRoundAnim(false), 300)

      const now = window.performance.now()
      roundStartTimeRef.current = now
    },
    [playAudio, effects],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(flashTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverHitSfx, 0.64, 0.95)
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  // --- Powerup handlers ---
  const activateHint = useCallback(() => {
    if (hintCooldownMsRef.current > 0 || finishedRef.current) return
    setIsHinting(true)
    hintRemainingMsRef.current = HINT_DURATION_MS
    hintCooldownMsRef.current = HINT_COOLDOWN_MS
    setHintCooldownMs(HINT_COOLDOWN_MS)
    playAudio(comboSfx, 0.3, 1.2)
    setTimeout(() => setIsHinting(false), HINT_DURATION_MS)
  }, [playAudio])

  const activateTimeFreeze = useCallback(() => {
    if (freezeCooldownMsRef.current > 0 || finishedRef.current) return
    isTimeFrozenRef.current = true
    setIsTimeFrozen(true)
    freezeRemainingMsRef.current = TIME_FREEZE_DURATION_MS
    freezeCooldownMsRef.current = TIME_FREEZE_COOLDOWN_MS
    setFreezeCooldownMs(TIME_FREEZE_COOLDOWN_MS)
    playAudio(timeBonusSfx, 0.4, 0.8)
    effects.triggerFlash('rgba(59,130,246,0.3)')
  }, [playAudio, effects])

  const activateDoublePoints = useCallback(() => {
    if (doubleCooldownMsRef.current > 0 || finishedRef.current) return
    isDoublePointsRef.current = true
    setIsDoublePoints(true)
    doubleRemainingMsRef.current = DOUBLE_POINTS_DURATION_MS
    doubleCooldownMsRef.current = DOUBLE_POINTS_COOLDOWN_MS
    setDoubleCooldownMs(DOUBLE_POINTS_COOLDOWN_MS)
    playAudio(comboSfx, 0.4, 1.5)
    effects.triggerFlash('rgba(168,85,247,0.3)')
  }, [playAudio, effects])

  const handleCellTap = useCallback(
    (index: number) => {
      if (finishedRef.current || !interactableRef.current) return
      const tappedCell = cells[index]
      if (!tappedCell) return

      interactableRef.current = false

      if (tappedCell.isOdd) {
        const now = window.performance.now()
        const solveTimeMs = now - roundStartTimeRef.current

        const nextStreak = streakRef.current + 1
        streakRef.current = nextStreak
        setStreak(nextStreak)

        // Score calculation
        const streakMultiplier = 1 + Math.floor(nextStreak / STREAK_BONUS_STEP)
        const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
        const doubleMult = isDoublePointsRef.current ? 2 : 1
        // Speed bonus: extra points for fast solve
        const speedBonus = solveTimeMs < 1000 ? 2 : solveTimeMs < 2000 ? 1 : 0
        const earned = (1 + speedBonus) * streakMultiplier * feverMult * doubleMult
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        // Time bonus for fast solve
        if (solveTimeMs < TIME_BONUS_THRESHOLD_MS) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
          playAudio(timeBonusSfx, 0.3, 1.1)
        }

        // Perfect round tracking
        if (!wrongThisRoundRef.current) {
          perfectRoundsRef.current += 1
          setPerfectRounds(perfectRoundsRef.current)
        }

        // Activate fever mode
        if (nextStreak >= FEVER_STREAK_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
          playAudio(feverSfx, 0.5)
        }

        // Sound
        if (nextStreak > 1 && nextStreak % STREAK_BONUS_STEP === 0) {
          playAudio(comboSfx, 0.5, 1 + Math.min(0.5, nextStreak * 0.05))
        } else {
          playAudio(correctSfx, 0.5, 1 + Math.min(0.3, nextScore * 0.01))
        }

        setFlashState('correct')

        // Visual effects
        const gridEl = document.querySelector('.ooo-grid')
        const rect = gridEl?.getBoundingClientRect()
        const centerX = rect ? (rect.left + rect.width / 2) : 200
        const centerY = rect ? (rect.top + rect.height / 2) : 300
        effects.comboHitBurst(centerX, centerY, nextStreak, earned)
        effects.triggerFlash('rgba(34,197,94,0.3)')

        clearTimeoutSafe(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashState('none')
          startNewRound(roundRef.current + 1)
        }, FLASH_DURATION_MS)
      } else {
        wrongThisRoundRef.current = true
        remainingMsRef.current = Math.max(0, remainingMsRef.current - TIME_PENALTY_MS)
        setRemainingMs(remainingMsRef.current)

        streakRef.current = 0
        setStreak(0)

        if (feverRef.current) {
          feverRef.current = false
          feverRemainingMsRef.current = 0
          setIsFever(false)
          setFeverRemainingMs(0)
        }

        setFlashState('wrong')
        playAudio(wrongSfx, 0.5, 0.8)
        effects.triggerShake(6)
        effects.triggerFlash('rgba(239,68,68,0.4)')

        clearTimeoutSafe(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashState('none')
          interactableRef.current = true
        }, FLASH_DURATION_MS)

        if (remainingMsRef.current <= 0) {
          finishGame()
        }
      }
    },
    [cells, finishGame, playAudio, startNewRound, effects],
  )

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
    startNewRound(0)
    return () => {
      clearTimeoutSafe(flashTimerRef)
      effects.cleanup()
    }
  }, [startNewRound])

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

      // Time countdown (skip if frozen)
      if (!isTimeFrozenRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
        setRemainingMs(remainingMsRef.current)
      }

      // Time warning
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        setTimeWarningPlayed(true)
        playAudio(timeWarningSfx, 0.4)
      }

      // Fever timer
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Time freeze timer
      if (isTimeFrozenRef.current) {
        freezeRemainingMsRef.current = Math.max(0, freezeRemainingMsRef.current - deltaMs)
        if (freezeRemainingMsRef.current <= 0) {
          isTimeFrozenRef.current = false
          setIsTimeFrozen(false)
        }
      }

      // Double points timer
      if (isDoublePointsRef.current) {
        doubleRemainingMsRef.current = Math.max(0, doubleRemainingMsRef.current - deltaMs)
        if (doubleRemainingMsRef.current <= 0) {
          isDoublePointsRef.current = false
          setIsDoublePoints(false)
        }
      }

      // Cooldown timers
      if (hintCooldownMsRef.current > 0) {
        hintCooldownMsRef.current = Math.max(0, hintCooldownMsRef.current - deltaMs)
        setHintCooldownMs(hintCooldownMsRef.current)
      }
      if (freezeCooldownMsRef.current > 0) {
        freezeCooldownMsRef.current = Math.max(0, freezeCooldownMsRef.current - deltaMs)
        setFreezeCooldownMs(freezeCooldownMsRef.current)
      }
      if (doubleCooldownMsRef.current > 0) {
        doubleCooldownMsRef.current = Math.max(0, doubleCooldownMsRef.current - deltaMs)
        setDoubleCooldownMs(doubleCooldownMsRef.current)
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
  }, [finishGame, playAudio, effects])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const hueShift = Math.max(MIN_HUE_SHIFT, BASE_HUE_SHIFT - round * HUE_SHIFT_DECAY)
  const diffMode = pickDifficultyMode(round)
  const comboLabel = getComboLabel(streak)
  const comboColor = getComboColor(streak)

  // Dynamic cell size to fill available space
  const gap = 3
  const gridPadding = 12
  const availableWidth = 432 - gridPadding * 2 - 24 // max-width minus padding
  const cellSize = Math.floor((availableWidth - gap * (gridSize - 1)) / gridSize)

  const timerPercent = (remainingMs / ROUND_DURATION_MS) * 100
  const timerColor = isLowTime ? '#ef4444' : isTimeFrozen ? '#3b82f6' : '#84cc16'

  return (
    <section
      className="mini-game-panel ooo-panel"
      aria-label="odd-one-out-game"
      style={{
        maxWidth: '432px',
        width: '100%',
        height: '100%',
        margin: '0 auto',
        overflow: 'hidden',
        position: 'relative',
        ...effects.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .ooo-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 50%, #e8e5dc 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
        }
        .ooo-panel.fever-active {
          background: linear-gradient(180deg, #fef9c3 0%, #fde68a 50%, #f5f4ef 100%);
        }

        .ooo-header {
          padding: 14px 16px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .ooo-score-block {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .ooo-score {
          font-size: clamp(28px, 8vw, 36px);
          font-weight: 900;
          color: #1e293b;
          margin: 0;
          line-height: 1.1;
        }

        .ooo-best {
          font-size: 10px;
          color: #94a3b8;
          margin: 0;
          font-weight: 600;
        }

        .ooo-round-badge {
          background: #84cc16;
          color: #fff;
          font-size: 11px;
          font-weight: 800;
          padding: 4px 10px;
          border-radius: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .ooo-timer-bar {
          height: 6px;
          margin: 0 16px;
          border-radius: 3px;
          background: rgba(0,0,0,0.08);
          overflow: hidden;
          position: relative;
        }

        .ooo-timer-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.1s linear, background-color 0.3s;
        }

        .ooo-time-text {
          text-align: center;
          font-size: 14px;
          font-weight: 700;
          color: #64748b;
          margin: 4px 0 2px;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s;
        }
        .ooo-time-text.low-time {
          color: #ef4444;
          animation: ooo-pulse 0.5s ease-in-out infinite alternate;
        }
        .ooo-time-text.frozen {
          color: #3b82f6;
        }

        @keyframes ooo-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.7; transform: scale(1.05); }
        }

        .ooo-status-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 4px 16px;
          min-height: 28px;
          flex-wrap: wrap;
        }

        .ooo-status-tag {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 8px;
          text-transform: uppercase;
        }

        .ooo-arena {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${gridPadding}px;
          position: relative;
          min-height: 0;
        }

        .ooo-grid {
          display: grid;
          transition: opacity 0.2s, transform 0.2s;
        }
        .ooo-grid.round-enter {
          animation: ooo-grid-enter 0.3s ease-out;
        }

        @keyframes ooo-grid-enter {
          0% { opacity: 0; transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }

        .ooo-cell:active {
          transform: scale(0.9) !important;
        }

        .ooo-powerup-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 8px 16px;
        }

        .ooo-powerup-btn {
          flex: 1;
          max-width: 120px;
          padding: 8px 4px;
          border: 2px solid rgba(0,0,0,0.1);
          border-radius: 12px;
          background: #fff;
          font-size: 11px;
          font-weight: 700;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          -webkit-tap-highlight-color: transparent;
          position: relative;
          overflow: hidden;
        }
        .ooo-powerup-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .ooo-powerup-btn:not(:disabled):active {
          transform: scale(0.95);
          background: #f0fdf4;
        }
        .ooo-powerup-btn.active {
          border-color: #84cc16;
          background: #f0fdf4;
        }
        .ooo-powerup-icon {
          font-size: 18px;
          line-height: 1;
        }
        .ooo-powerup-cd {
          font-size: 9px;
          color: #94a3b8;
        }

        .ooo-feedback-row {
          min-height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 4px 16px 8px;
        }

        .ooo-feedback {
          font-size: 15px;
          font-weight: 800;
          margin: 0;
          text-align: center;
        }
        .ooo-feedback.correct {
          color: #16a34a;
          animation: ooo-pop 0.3s ease-out;
        }
        .ooo-feedback.wrong {
          color: #dc2626;
          animation: ooo-shake-text 0.3s ease-out;
        }
        .ooo-feedback.neutral {
          color: #94a3b8;
          font-weight: 600;
          font-size: 13px;
        }

        .ooo-info-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 2px 16px;
          font-size: 10px;
          color: #94a3b8;
          font-weight: 600;
        }
        .ooo-info-bar strong {
          color: #475569;
        }

        @keyframes ooo-pop {
          0% { transform: scale(0.6); opacity: 0; }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes ooo-shake-text {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }

        .ooo-fever-banner {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: clamp(32px, 10vw, 48px);
          font-weight: 900;
          color: #facc15;
          text-shadow: 0 2px 8px rgba(0,0,0,0.3), 0 0 20px rgba(250,204,21,0.5);
          animation: ooo-fever-in 0.5s ease-out forwards;
          pointer-events: none;
          z-index: 10;
          white-space: nowrap;
        }
        @keyframes ooo-fever-in {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          60% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }

        .ooo-freeze-overlay {
          position: absolute;
          inset: 0;
          background: rgba(59,130,246,0.06);
          pointer-events: none;
          z-index: 5;
          border: 3px solid rgba(59,130,246,0.2);
          border-radius: inherit;
          animation: ooo-freeze-pulse 1s ease-in-out infinite alternate;
        }
        @keyframes ooo-freeze-pulse {
          from { border-color: rgba(59,130,246,0.15); }
          to { border-color: rgba(59,130,246,0.35); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Header */}
      <div className="ooo-header">
        <div className="ooo-score-block">
          <p className="ooo-score">{score.toLocaleString()}</p>
          <p className="ooo-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <span className="ooo-round-badge">R{round + 1} / {gridSize}x{gridSize}</span>
      </div>

      {/* Timer bar */}
      <div className="ooo-timer-bar">
        <div
          className="ooo-timer-fill"
          style={{
            width: `${timerPercent}%`,
            backgroundColor: timerColor,
          }}
        />
      </div>
      <p className={`ooo-time-text ${isLowTime ? 'low-time' : ''} ${isTimeFrozen ? 'frozen' : ''}`}>
        {isTimeFrozen ? 'FROZEN ' : ''}{(remainingMs / 1000).toFixed(1)}s
      </p>

      {/* Status tags */}
      <div className="ooo-status-row">
        {comboLabel && (
          <span className="ooo-status-tag" style={{ color: comboColor, background: `${comboColor}18` }}>
            {comboLabel} x{streak}
          </span>
        )}
        {isFever && (
          <span className="ooo-status-tag" style={{ color: '#d97706', background: 'rgba(250,204,21,0.2)', animation: 'ooo-pulse 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </span>
        )}
        {isDoublePoints && (
          <span className="ooo-status-tag" style={{ color: '#7c3aed', background: 'rgba(168,85,247,0.15)' }}>
            x2 PTS
          </span>
        )}
        {streak >= 3 && !comboLabel && (
          <span className="ooo-status-tag" style={{ color: '#16a34a', background: 'rgba(34,197,94,0.1)' }}>
            STREAK {streak}
          </span>
        )}
      </div>

      {/* Game arena */}
      <div className={`ooo-arena ${isFever ? 'fever-active' : ''}`}>
        {isTimeFrozen && <div className="ooo-freeze-overlay" />}
        <div
          className={`ooo-grid ${roundAnim ? 'round-enter' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${gridSize}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${gridSize}, ${cellSize}px)`,
            gap,
            justifyContent: 'center',
            alignContent: 'center',
          }}
        >
          {cells.map((cell, index) => (
            <ShapeCell
              key={`cell-${round}-${index}`}
              cell={cell}
              size={cellSize}
              onClick={() => handleCellTap(index)}
              isHinted={isHinting}
              isFever={isFever}
            />
          ))}
        </div>
      </div>

      {/* Info bar */}
      <div className="ooo-info-bar">
        <span>SHIFT <strong>{Math.round(hueShift)}</strong></span>
        <span>MODE <strong>{diffMode.toUpperCase()}</strong></span>
        <span>PERFECT <strong>{perfectRounds}</strong></span>
      </div>

      {/* Powerup buttons */}
      <div className="ooo-powerup-row">
        <button
          className={`ooo-powerup-btn ${isHinting ? 'active' : ''}`}
          type="button"
          onClick={activateHint}
          disabled={hintCooldownMs > 0 || finishedRef.current}
        >
          <span className="ooo-powerup-icon">🔍</span>
          <span>Hint</span>
          {hintCooldownMs > 0 && <span className="ooo-powerup-cd">{(hintCooldownMs / 1000).toFixed(0)}s</span>}
        </button>
        <button
          className={`ooo-powerup-btn ${isTimeFrozen ? 'active' : ''}`}
          type="button"
          onClick={activateTimeFreeze}
          disabled={freezeCooldownMs > 0 || finishedRef.current}
        >
          <span className="ooo-powerup-icon">❄️</span>
          <span>Freeze</span>
          {freezeCooldownMs > 0 && <span className="ooo-powerup-cd">{(freezeCooldownMs / 1000).toFixed(0)}s</span>}
        </button>
        <button
          className={`ooo-powerup-btn ${isDoublePoints ? 'active' : ''}`}
          type="button"
          onClick={activateDoublePoints}
          disabled={doubleCooldownMs > 0 || finishedRef.current}
        >
          <span className="ooo-powerup-icon">⭐</span>
          <span>x2 Pts</span>
          {doubleCooldownMs > 0 && <span className="ooo-powerup-cd">{(doubleCooldownMs / 1000).toFixed(0)}s</span>}
        </button>
      </div>

      {/* Feedback */}
      <div className="ooo-feedback-row">
        {flashState === 'correct' && <p className="ooo-feedback correct">CORRECT!</p>}
        {flashState === 'wrong' && <p className="ooo-feedback wrong">WRONG -2s</p>}
        {flashState === 'none' && <p className="ooo-feedback neutral">Find the different one!</p>}
      </div>
    </section>
  )
}

export const oddOneOutModule: MiniGameModule = {
  manifest: {
    id: 'odd-one-out',
    title: 'Odd One Out',
    description: 'Find the odd color out! Gets harder!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#84cc16',
  },
  Component: OddOneOutGame,
}
