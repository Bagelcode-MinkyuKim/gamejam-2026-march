import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import correctSfx from '../../../assets/sounds/spot-diff-correct.mp3'
import wrongSfx from '../../../assets/sounds/spot-diff-wrong.mp3'
import feverSfx from '../../../assets/sounds/spot-diff-fever.mp3'
import comboSfx from '../../../assets/sounds/spot-diff-combo.mp3'
import timeWarningSfx from '../../../assets/sounds/spot-diff-time-warning.mp3'
import roundClearSfx from '../../../assets/sounds/spot-diff-round-clear.mp3'
import hintSfx from '../../../assets/sounds/spot-diff-hint.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30_000
const TIME_PENALTY_MS = 3_000
const WRONG_FLASH_DURATION_MS = 300
const CORRECT_FLASH_DURATION_MS = 400
const LOW_TIME_THRESHOLD_MS = 5_000

const BASE_SCORE_PER_FIND = 100
const SPEED_BONUS_MAX_MS = 5_000
const SPEED_BONUS_POINTS = 50
const FAST_FIND_TIME_BONUS_MS = 1_500
const FAST_FIND_THRESHOLD_MS = 2_000

const FEVER_STREAK_THRESHOLD = 5
const FEVER_MULTIPLIER = 3
const FEVER_DURATION_MS = 8_000

const HINT_DELAY_MS = 6_000
const HINT_PULSE_SPEED = 0.004

const ROUND_TRANSITION_MS = 800

const GRID_SIZES: readonly number[] = [3, 4, 4, 5, 5, 6]
const MAX_GRID_SIZE = 6

const BONUS_ROUND_INTERVAL = 3
const TIME_BONUS_REWARD_MS = 5_000
const DOUBLE_SCORE_ROUNDS = 2

interface CharacterEntry {
  readonly id: string
  readonly name: string
  readonly imageSrc: string
}

const CHARACTER_POOL: readonly CharacterEntry[] = [
  { id: 'kim-yeonja', name: 'Kim Yeonja', imageSrc: kimYeonjaImage },
  { id: 'park-sangmin', name: 'Park Sangmin', imageSrc: parkSangminImage },
  { id: 'park-wankyu', name: 'Park Wankyu', imageSrc: parkWankyuImage },
  { id: 'seo-taiji', name: 'Seo Taiji', imageSrc: seoTaijiImage },
  { id: 'song-changsik', name: 'Song Changsik', imageSrc: songChangsikImage },
  { id: 'tae-jina', name: 'Tae Jina', imageSrc: taeJinaImage },
]

interface GridCell {
  readonly character: CharacterEntry
  readonly isDifferent: boolean
  readonly cellIndex: number
}

type BonusType = 'time' | 'double' | null

function pickTwoDistinctCharacters(excludeId?: string): [CharacterEntry, CharacterEntry] {
  const available = CHARACTER_POOL.filter((c) => c.id !== excludeId)
  const source = available.length >= 2 ? available : CHARACTER_POOL
  const firstIndex = Math.floor(Math.random() * source.length)
  const first = source[firstIndex]
  const remaining = source.filter((c) => c.id !== first.id)
  const secondIndex = Math.floor(Math.random() * remaining.length)
  const second = remaining[secondIndex]
  return [first, second]
}

function buildGrid(gridSize: number, round: number, previousMainId?: string): GridCell[] {
  const totalCells = gridSize * gridSize
  const [mainChar, oddChar] = pickTwoDistinctCharacters(round > 0 ? previousMainId : undefined)
  const oddIndex = Math.floor(Math.random() * totalCells)

  const cells: GridCell[] = []
  for (let i = 0; i < totalCells; i++) {
    const isDifferent = i === oddIndex
    cells.push({
      character: isDifferent ? oddChar : mainChar,
      isDifferent,
      cellIndex: i,
    })
  }
  return cells
}

function getGridSizeForRound(round: number): number {
  if (round < GRID_SIZES.length) {
    return GRID_SIZES[round]
  }
  return MAX_GRID_SIZE
}

function getBonusForRound(round: number): BonusType {
  if (round > 0 && round % BONUS_ROUND_INTERVAL === 0) {
    return Math.random() < 0.5 ? 'time' : 'double'
  }
  return null
}

function SpotDiffGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [round, setRound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [grid, setGrid] = useState<GridCell[]>(() => buildGrid(GRID_SIZES[0], 0))
  const [gridSize, setGridSize] = useState(GRID_SIZES[0])
  const [wrongFlashIndex, setWrongFlashIndex] = useState<number | null>(null)
  const [correctFlashIndex, setCorrectFlashIndex] = useState<number | null>(null)
  const [isGameOver, setIsGameOver] = useState(false)
  const [streak, setStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [hintOpacity, setHintOpacity] = useState(0)
  const [showRoundTransition, setShowRoundTransition] = useState(false)
  const [roundTransitionText, setRoundTransitionText] = useState('')
  const [doubleScoreRoundsLeft, setDoubleScoreRoundsLeft] = useState(0)
  const [timeBonusPopup, setTimeBonusPopup] = useState(false)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const roundRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const gridRef = useRef(grid)
  const gridSizeRef = useRef(GRID_SIZES[0])
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const roundStartMsRef = useRef(0)
  const wrongFlashTimerRef = useRef<number | null>(null)
  const correctFlashTimerRef = useRef<number | null>(null)
  const previousMainCharIdRef = useRef<string | undefined>(undefined)
  const streakRef = useRef(0)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const hintTimerRef = useRef(0)
  const hintPhaseRef = useRef(0)
  const roundTransitionTimerRef = useRef<number | null>(null)
  const doubleScoreRef = useRef(0)
  const timeWarningPlayedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const audioPoolRef = useRef<Record<string, HTMLAudioElement | null>>({})

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback(
    (key: string, volume: number, playbackRate = 1) => {
      const audio = audioPoolRef.current[key]
      if (audio === null || audio === undefined) return
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
    setIsGameOver(true)
    playAudio('gameOver', 0.7, 0.95)
    const elapsedMs = Math.round(Math.max(16, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  const advanceRound = useCallback(
    (now: number) => {
      const nextRound = roundRef.current + 1
      roundRef.current = nextRound
      setRound(nextRound)

      const nextGridSize = getGridSizeForRound(nextRound)
      gridSizeRef.current = nextGridSize
      setGridSize(nextGridSize)

      const mainCharId = gridRef.current.find((c) => !c.isDifferent)?.character.id
      previousMainCharIdRef.current = mainCharId

      // Round transition
      const bonus = getBonusForRound(nextRound)
      if (bonus === 'time') {
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_REWARD_MS)
        setRemainingMs(remainingMsRef.current)
        setTimeBonusPopup(true)
        setTimeout(() => setTimeBonusPopup(false), 1200)
      } else if (bonus === 'double') {
        doubleScoreRef.current = DOUBLE_SCORE_ROUNDS
        setDoubleScoreRoundsLeft(DOUBLE_SCORE_ROUNDS)
      }

      // Show round transition
      let transText = `ROUND ${nextRound + 1}`
      if (bonus === 'time') transText += ' +5s!'
      else if (bonus === 'double') transText += ' x2!'
      setRoundTransitionText(transText)
      setShowRoundTransition(true)
      playAudio('roundClear', 0.5)

      clearTimeoutSafe(roundTransitionTimerRef)
      roundTransitionTimerRef.current = window.setTimeout(() => {
        setShowRoundTransition(false)
        roundTransitionTimerRef.current = null
      }, ROUND_TRANSITION_MS)

      const nextGrid = buildGrid(nextGridSize, nextRound, mainCharId)
      gridRef.current = nextGrid
      setGrid(nextGrid)

      roundStartMsRef.current = now
      hintTimerRef.current = 0
      hintPhaseRef.current = 0
      setHintOpacity(0)
      timeWarningPlayedRef.current = false

      if (doubleScoreRef.current > 0) {
        doubleScoreRef.current--
        setDoubleScoreRoundsLeft(doubleScoreRef.current)
      }
    },
    [playAudio],
  )

  const handleCellTap = useCallback(
    (cell: GridCell) => {
      if (finishedRef.current || showRoundTransition) return

      const now = window.performance.now()

      if (cell.isDifferent) {
        const elapsedSinceRoundStart = now - roundStartMsRef.current
        const speedBonus = elapsedSinceRoundStart < SPEED_BONUS_MAX_MS
          ? Math.round(SPEED_BONUS_POINTS * (1 - elapsedSinceRoundStart / SPEED_BONUS_MAX_MS))
          : 0
        const roundMultiplier = 1 + roundRef.current * 0.2
        const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
        const doubleMult = doubleScoreRef.current > 0 ? 2 : 1
        const earned = Math.round((BASE_SCORE_PER_FIND + speedBonus) * roundMultiplier * feverMult * doubleMult)

        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        const nextStreak = streakRef.current + 1
        streakRef.current = nextStreak
        setStreak(nextStreak)

        if (nextStreak >= FEVER_STREAK_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
          playAudio('fever', 0.6)
        } else if (nextStreak > 1) {
          playAudio('combo', 0.4, 1 + nextStreak * 0.05)
        }

        if (elapsedSinceRoundStart < FAST_FIND_THRESHOLD_MS) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FAST_FIND_TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
        }

        setCorrectFlashIndex(cell.cellIndex)
        clearTimeoutSafe(correctFlashTimerRef)
        correctFlashTimerRef.current = window.setTimeout(() => {
          correctFlashTimerRef.current = null
          setCorrectFlashIndex(null)
        }, CORRECT_FLASH_DURATION_MS)

        playAudio('correct', 0.6, 1 + roundRef.current * 0.03)

        // Get cell position for effects
        const container = containerRef.current
        if (container) {
          const gridArea = container.querySelector('.spot-diff-arena')
          if (gridArea) {
            const rect = gridArea.getBoundingClientRect()
            const containerRect = container.getBoundingClientRect()
            const col = cell.cellIndex % gridSizeRef.current
            const row = Math.floor(cell.cellIndex / gridSizeRef.current)
            const cellW = rect.width / gridSizeRef.current
            const cellH = rect.height / gridSizeRef.current
            const cx = rect.left - containerRect.left + col * cellW + cellW / 2
            const cy = rect.top - containerRect.top + row * cellH + cellH / 2
            effects.comboHitBurst(cx, cy, nextStreak, earned)
          }
        }

        effects.triggerFlash('rgba(34,197,94,0.25)')

        advanceRound(now)
      } else {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - TIME_PENALTY_MS)
        setRemainingMs(remainingMsRef.current)

        streakRef.current = 0
        setStreak(0)

        setWrongFlashIndex(cell.cellIndex)
        clearTimeoutSafe(wrongFlashTimerRef)
        wrongFlashTimerRef.current = window.setTimeout(() => {
          wrongFlashTimerRef.current = null
          setWrongFlashIndex(null)
        }, WRONG_FLASH_DURATION_MS)

        playAudio('wrong', 0.5, 0.8)

        effects.triggerShake(6)
        effects.triggerFlash('rgba(239,68,68,0.4)')

        if (remainingMsRef.current <= 0) {
          finishGame()
        }
      }
    },
    [advanceRound, finishGame, playAudio, showRoundTransition, effects],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

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
    for (const entry of CHARACTER_POOL) {
      const img = new Image()
      img.decoding = 'sync'
      img.src = entry.imageSrc
      void img.decode?.().catch(() => {})
    }

    const sfxMap: Record<string, string> = {
      correct: correctSfx,
      wrong: wrongSfx,
      fever: feverSfx,
      combo: comboSfx,
      timeWarning: timeWarningSfx,
      roundClear: roundClearSfx,
      hint: hintSfx,
      gameOver: gameOverHitSfx,
    }

    for (const [key, src] of Object.entries(sfxMap)) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioPoolRef.current[key] = a
    }

    return () => {
      clearTimeoutSafe(wrongFlashTimerRef)
      clearTimeoutSafe(correctFlashTimerRef)
      clearTimeoutSafe(roundTransitionTimerRef)
      for (const key of Object.keys(audioPoolRef.current)) {
        audioPoolRef.current[key] = null
      }
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    roundStartMsRef.current = window.performance.now()

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

      // Fever timer
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Hint system: after HINT_DELAY_MS, pulse the odd cell
      hintTimerRef.current += deltaMs
      if (hintTimerRef.current > HINT_DELAY_MS) {
        hintPhaseRef.current += deltaMs * HINT_PULSE_SPEED
        const pulse = (Math.sin(hintPhaseRef.current) + 1) / 2
        setHintOpacity(0.15 + pulse * 0.35)
      }

      // Time warning sound
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > 0 && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        playAudio('timeWarning', 0.4)
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
  }, [finishGame, playAudio])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const timeSeconds = (remainingMs / 1000).toFixed(1)

  const comboLabel = getComboLabel(streak)
  const comboColor = getComboColor(streak)

  const timeBarPercent = Math.max(0, Math.min(100, (remainingMs / ROUND_DURATION_MS) * 100))
  const feverBarPercent = isFever ? Math.max(0, (feverRemainingMs / FEVER_DURATION_MS) * 100) : 0

  return (
    <section
      ref={containerRef}
      className="mini-game-panel spot-diff-panel"
      aria-label="spot-diff-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .spot-diff-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 50%, #e8e5dc 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
          font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        }

        .spot-diff-top-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 16px 6px;
          gap: 8px;
        }

        .spot-diff-score-area {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .spot-diff-score {
          font-size: clamp(28px, 7vw, 36px);
          font-weight: 900;
          color: #1f2937;
          margin: 0;
          line-height: 1;
        }

        .spot-diff-best {
          font-size: 11px;
          color: #9ca3af;
          margin: 0;
          font-weight: 600;
        }

        .spot-diff-round-badge {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .spot-diff-round-badge span {
          background: #374151;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 12px;
        }

        .spot-diff-grid-badge {
          background: #6b7280;
          color: #fff;
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 8px;
        }

        .spot-diff-time-area {
          text-align: right;
        }

        .spot-diff-time {
          font-size: clamp(22px, 6vw, 30px);
          font-weight: 800;
          color: #374151;
          margin: 0;
          font-variant-numeric: tabular-nums;
          line-height: 1;
          transition: color 0.2s;
        }

        .spot-diff-time.low-time {
          color: #ef4444;
          animation: spot-diff-pulse 0.5s ease-in-out infinite alternate;
        }

        .spot-diff-time-bar-wrap {
          height: 6px;
          background: rgba(0,0,0,0.08);
          border-radius: 3px;
          margin: 0 16px 4px;
          overflow: hidden;
        }

        .spot-diff-time-bar {
          height: 100%;
          border-radius: 3px;
          transition: width 0.1s linear, background-color 0.3s;
        }

        .spot-diff-status-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 2px 16px 6px;
          min-height: 24px;
        }

        .spot-diff-combo-text {
          font-size: 14px;
          font-weight: 800;
          margin: 0;
          text-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }

        .spot-diff-fever-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          background: linear-gradient(135deg, #f59e0b, #eab308);
          color: #fff;
          font-size: 12px;
          font-weight: 800;
          padding: 3px 10px;
          border-radius: 12px;
          animation: spot-diff-fever-glow 0.4s ease-in-out infinite alternate;
          box-shadow: 0 2px 8px rgba(245,158,11,0.4);
        }

        .spot-diff-fever-bar {
          height: 4px;
          background: rgba(245,158,11,0.2);
          border-radius: 2px;
          margin: 0 16px 2px;
          overflow: hidden;
        }

        .spot-diff-fever-bar-inner {
          height: 100%;
          background: linear-gradient(90deg, #f59e0b, #eab308);
          border-radius: 2px;
          transition: width 0.1s linear;
        }

        .spot-diff-double-badge {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          color: #fff;
          font-size: 12px;
          font-weight: 800;
          padding: 3px 10px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(139,92,246,0.3);
        }

        .spot-diff-arena {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px;
          position: relative;
          min-height: 0;
        }

        .spot-diff-arena.game-over {
          opacity: 0.4;
          pointer-events: none;
          filter: grayscale(0.5);
        }

        .spot-diff-grid {
          justify-content: center;
          align-items: center;
        }

        .spot-diff-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 3px;
          border: 2px solid rgba(107,114,128,0.2);
          border-radius: 10px;
          background: rgba(255, 255, 255, 0.7);
          cursor: pointer;
          transition: transform 0.1s, background 0.15s, border-color 0.15s, box-shadow 0.15s;
          outline: none;
          box-shadow: 0 2px 6px rgba(0,0,0,0.08);
          -webkit-tap-highlight-color: transparent;
          position: relative;
          overflow: hidden;
        }

        .spot-diff-cell:active {
          transform: scale(0.92);
        }

        .spot-diff-cell:hover {
          border-color: rgba(107,114,128,0.4);
          box-shadow: 0 3px 10px rgba(0,0,0,0.12);
        }

        .spot-diff-cell.wrong {
          background: rgba(239, 68, 68, 0.25);
          border-color: #ef4444;
          animation: spot-diff-shake 0.3s ease-in-out;
          box-shadow: 0 0 12px rgba(239,68,68,0.3);
        }

        .spot-diff-cell.correct {
          background: rgba(34, 197, 94, 0.25);
          border-color: #22c55e;
          animation: spot-diff-pop 0.4s ease-out;
          box-shadow: 0 0 12px rgba(34,197,94,0.3);
        }

        .spot-diff-cell.hint-glow {
          box-shadow: 0 0 16px rgba(250,204,21,var(--hint-opacity, 0));
          border-color: rgba(250,204,21, calc(var(--hint-opacity, 0) * 0.8));
        }

        .spot-diff-cell-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
        }

        .spot-diff-bottom-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 16px 12px;
          gap: 8px;
        }

        .spot-diff-hint-text {
          font-size: 13px;
          color: #9ca3af;
          margin: 0;
          font-weight: 500;
        }

        .spot-diff-penalty-text {
          font-size: 11px;
          color: #ef4444;
          margin: 0;
          font-weight: 600;
          opacity: 0.7;
        }

        .spot-diff-exit-btn {
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 600;
          color: #9ca3af;
          background: transparent;
          border: 1px solid rgba(107,114,128,0.2);
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .spot-diff-exit-btn:active {
          background: rgba(0,0,0,0.04);
        }

        .spot-diff-round-transition {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
          pointer-events: none;
        }

        .spot-diff-round-transition-inner {
          background: rgba(31,41,55,0.9);
          color: #fff;
          font-size: clamp(24px, 6vw, 32px);
          font-weight: 900;
          padding: 16px 32px;
          border-radius: 16px;
          animation: spot-diff-round-in 0.4s ease-out;
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          text-align: center;
        }

        .spot-diff-time-bonus-popup {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: #fff;
          font-size: 24px;
          font-weight: 900;
          padding: 12px 24px;
          border-radius: 14px;
          z-index: 25;
          animation: spot-diff-pop-up 1.2s ease-out forwards;
          box-shadow: 0 4px 20px rgba(34,197,94,0.4);
          pointer-events: none;
        }

        @keyframes spot-diff-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        @keyframes spot-diff-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }

        @keyframes spot-diff-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }

        @keyframes spot-diff-round-in {
          0% { transform: scale(0.5); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes spot-diff-pop-up {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          20% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
          80% { transform: translate(-50%, -70%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -90%); opacity: 0; }
        }

        @keyframes spot-diff-fever-glow {
          from { box-shadow: 0 2px 8px rgba(245,158,11,0.4); }
          to { box-shadow: 0 2px 16px rgba(245,158,11,0.7); }
        }

        .spot-diff-game-over-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(31,41,55,0.85);
          z-index: 30;
          animation: spot-diff-round-in 0.4s ease-out;
        }

        .spot-diff-game-over-title {
          font-size: clamp(32px, 8vw, 42px);
          font-weight: 900;
          color: #fff;
          margin: 0 0 8px;
          text-shadow: 0 3px 8px rgba(0,0,0,0.3);
        }

        .spot-diff-game-over-score {
          font-size: clamp(40px, 10vw, 56px);
          font-weight: 900;
          color: #facc15;
          margin: 0 0 4px;
        }

        .spot-diff-game-over-detail {
          font-size: 14px;
          color: rgba(255,255,255,0.7);
          margin: 2px 0;
        }

        .spot-diff-game-over-best {
          font-size: 16px;
          color: #22c55e;
          font-weight: 700;
          margin: 8px 0 0;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Top Bar */}
      <div className="spot-diff-top-bar">
        <div className="spot-diff-score-area">
          <p className="spot-diff-score">{score.toLocaleString()}</p>
          <p className="spot-diff-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="spot-diff-round-badge">
          <span>R{round + 1}</span>
          <span className="spot-diff-grid-badge">{gridSize}x{gridSize}</span>
        </div>
        <div className="spot-diff-time-area">
          <p className={`spot-diff-time ${isLowTime ? 'low-time' : ''}`}>{timeSeconds}s</p>
        </div>
      </div>

      {/* Time Bar */}
      <div className="spot-diff-time-bar-wrap">
        <div
          className="spot-diff-time-bar"
          style={{
            width: `${timeBarPercent}%`,
            backgroundColor: isLowTime ? '#ef4444' : isFever ? '#f59e0b' : '#22c55e',
          }}
        />
      </div>

      {/* Status Row */}
      <div className="spot-diff-status-row">
        {comboLabel && (
          <p className="spot-diff-combo-text" style={{ color: comboColor }}>
            {comboLabel} x{streak}
          </p>
        )}
        {isFever && (
          <div className="spot-diff-fever-badge">
            FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </div>
        )}
        {doubleScoreRoundsLeft > 0 && (
          <div className="spot-diff-double-badge">
            x2 SCORE ({doubleScoreRoundsLeft})
          </div>
        )}
      </div>

      {/* Fever Bar */}
      {isFever && (
        <div className="spot-diff-fever-bar">
          <div className="spot-diff-fever-bar-inner" style={{ width: `${feverBarPercent}%` }} />
        </div>
      )}

      {/* Arena - Full Height */}
      <div className={`spot-diff-arena ${isGameOver ? 'game-over' : ''}`}>
        <div
          className="spot-diff-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
            gridTemplateRows: `repeat(${gridSize}, 1fr)`,
            gap: gridSize <= 4 ? '6px' : '4px',
            width: '100%',
            height: '100%',
            maxWidth: '400px',
            maxHeight: '100%',
            aspectRatio: '1/1',
          }}
        >
          {grid.map((cell) => {
            const isWrongFlash = wrongFlashIndex === cell.cellIndex
            const isCorrectFlash = correctFlashIndex === cell.cellIndex
            const showHint = cell.isDifferent && hintOpacity > 0 && !isCorrectFlash
            let cellClass = 'spot-diff-cell'
            if (isWrongFlash) cellClass += ' wrong'
            if (isCorrectFlash) cellClass += ' correct'
            if (showHint) cellClass += ' hint-glow'

            return (
              <button
                key={`cell-${round}-${cell.cellIndex}`}
                className={cellClass}
                type="button"
                onClick={() => handleCellTap(cell)}
                disabled={isGameOver}
                style={showHint ? { '--hint-opacity': hintOpacity } as React.CSSProperties : undefined}
              >
                <img
                  className="spot-diff-cell-img"
                  src={cell.character.imageSrc}
                  alt={cell.character.name}
                  draggable={false}
                />
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="spot-diff-bottom-bar">
        <div>
          <p className="spot-diff-hint-text">Find the odd one out!</p>
          <p className="spot-diff-penalty-text">Wrong: -{TIME_PENALTY_MS / 1000}s</p>
        </div>
        <button className="spot-diff-exit-btn" type="button" onClick={handleExit}>
          EXIT
        </button>
      </div>

      {/* Round Transition Overlay */}
      {showRoundTransition && (
        <div className="spot-diff-round-transition">
          <div className="spot-diff-round-transition-inner">
            {roundTransitionText}
          </div>
        </div>
      )}

      {/* Time Bonus Popup */}
      {timeBonusPopup && (
        <div className="spot-diff-time-bonus-popup">+5s TIME BONUS!</div>
      )}

      {/* Game Over Overlay */}
      {isGameOver && (
        <div className="spot-diff-game-over-overlay">
          <p className="spot-diff-game-over-title">GAME OVER</p>
          <p className="spot-diff-game-over-score">{score.toLocaleString()}</p>
          <p className="spot-diff-game-over-detail">Round {round + 1} reached</p>
          <p className="spot-diff-game-over-detail">Max streak: {streak}</p>
          {score > bestScore && bestScore > 0 && (
            <p className="spot-diff-game-over-best">NEW BEST!</p>
          )}
        </div>
      )}
    </section>
  )
}

export const spotDiffModule: MiniGameModule = {
  manifest: {
    id: 'spot-diff',
    title: 'Spot Diff',
    description: 'Find the different one! Faster = higher score!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#6366f1',
  },
  Component: SpotDiffGame,
}
