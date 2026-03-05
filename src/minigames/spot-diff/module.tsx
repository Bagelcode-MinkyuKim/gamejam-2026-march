import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
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

const GRID_SIZES: readonly number[] = [4, 5, 6]
const MAX_GRID_SIZE = 6

interface CharacterEntry {
  readonly id: string
  readonly name: string
  readonly imageSrc: string
}

const CHARACTER_POOL: readonly CharacterEntry[] = [
  { id: 'kim-yeonja', name: '김연자', imageSrc: kimYeonjaImage },
  { id: 'park-sangmin', name: '박상민', imageSrc: parkSangminImage },
  { id: 'park-wankyu', name: '박완규', imageSrc: parkWankyuImage },
  { id: 'seo-taiji', name: '서태지', imageSrc: seoTaijiImage },
  { id: 'song-changsik', name: '송창식', imageSrc: songChangsikImage },
  { id: 'tae-jina', name: '태진아', imageSrc: taeJinaImage },
]

interface GridCell {
  readonly character: CharacterEntry
  readonly isDifferent: boolean
  readonly cellIndex: number
}

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

function SpotDiffGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [round, setRound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [grid, setGrid] = useState<GridCell[]>(() => buildGrid(GRID_SIZES[0], 0))
  const [gridSize, setGridSize] = useState(GRID_SIZES[0])
  const [roundStartMs, setRoundStartMs] = useState(0)
  const [wrongFlashIndex, setWrongFlashIndex] = useState<number | null>(null)
  const [correctFlashIndex, setCorrectFlashIndex] = useState<number | null>(null)
  const [isGameOver, setIsGameOver] = useState(false)
  const [streak, setStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)

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

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

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
    setIsGameOver(true)
    playAudio(gameOverAudioRef, 0.7, 0.95)
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

      const nextGrid = buildGrid(nextGridSize, nextRound, mainCharId)
      gridRef.current = nextGrid
      setGrid(nextGrid)

      roundStartMsRef.current = now
      setRoundStartMs(now)
    },
    [],
  )

  const handleCellTap = useCallback(
    (cell: GridCell) => {
      if (finishedRef.current) return

      const now = window.performance.now()

      if (cell.isDifferent) {
        const elapsedSinceRoundStart = now - roundStartMsRef.current
        const speedBonus = elapsedSinceRoundStart < SPEED_BONUS_MAX_MS
          ? Math.round(SPEED_BONUS_POINTS * (1 - elapsedSinceRoundStart / SPEED_BONUS_MAX_MS))
          : 0
        const roundMultiplier = 1 + roundRef.current * 0.2
        const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
        const earned = Math.round((BASE_SCORE_PER_FIND + speedBonus) * roundMultiplier * feverMult)

        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        const nextStreak = streakRef.current + 1
        streakRef.current = nextStreak
        setStreak(nextStreak)

        // Activate fever mode at streak threshold
        if (nextStreak >= FEVER_STREAK_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
        }

        // Fast find time bonus
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

        playAudio(tapHitStrongAudioRef, 0.6, 1 + roundRef.current * 0.05)

        // Visual effects for correct find
        effects.comboHitBurst(200, 200, nextStreak, earned)

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

        playAudio(tapHitAudioRef, 0.5, 0.8)

        // Visual effects for wrong tap
        effects.triggerShake(5)
        effects.triggerFlash('rgba(239,68,68,0.4)')

        if (remainingMsRef.current <= 0) {
          finishGame()
        }
      }
    },
    [advanceRound, finishGame, playAudio],
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
    for (const entry of CHARACTER_POOL) {
      const img = new Image()
      img.decoding = 'sync'
      img.src = entry.imageSrc
      void img.decode?.().catch(() => {})
    }

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
      clearTimeoutSafe(wrongFlashTimerRef)
      clearTimeoutSafe(correctFlashTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    roundStartMsRef.current = window.performance.now()
    setRoundStartMs(roundStartMsRef.current)

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

      // Fever timer countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
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
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const timeSeconds = (remainingMs / 1000).toFixed(1)

  const cellSizePx = Math.floor(280 / gridSize)
  const comboLabel = getComboLabel(streak)
  const comboColor = getComboColor(streak)

  return (
    <section className="mini-game-panel spot-diff-panel" aria-label="spot-diff-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .spot-diff-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #831843 0%, #9f1239 30%, #1e293b 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
        }

        .spot-diff-header {
          background: linear-gradient(135deg, #db2777, #be185d);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .spot-diff-header-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.4);
          object-fit: contain;
          background: rgba(255,255,255,0.1);
          flex-shrink: 0;
        }

        .spot-diff-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .spot-diff-header-score-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .spot-diff-score {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          margin: 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .spot-diff-best {
          font-size: 10px;
          color: rgba(255,255,255,0.6);
          margin: 0;
          font-weight: 600;
        }

        .spot-diff-time {
          font-size: 18px;
          color: rgba(255,255,255,0.9);
          margin: 0;
          font-variant-numeric: tabular-nums;
          font-weight: 700;
          transition: color 0.2s;
        }

        .spot-diff-time.low-time {
          color: #fca5a5;
          animation: spot-diff-pulse 0.5s ease-in-out infinite alternate;
        }

        .spot-diff-meta-row {
          display: flex;
          justify-content: center;
          gap: 16px;
          padding: 8px 16px;
        }

        .spot-diff-meta-row p {
          font-size: 12px;
          color: rgba(255,255,255,0.7);
          margin: 0;
          font-weight: 600;
        }

        .spot-diff-meta-row strong {
          color: #fff;
        }

        .spot-diff-arena {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 12px;
          margin: 0 12px;
          border-radius: 16px;
          background: rgba(219, 39, 119, 0.1);
          border: 2px solid rgba(219, 39, 119, 0.25);
          transition: border-color 0.3s, background 0.3s;
        }

        .spot-diff-arena.low-time {
          border-color: rgba(239, 68, 68, 0.5);
          background: rgba(239, 68, 68, 0.1);
        }

        .spot-diff-arena.game-over {
          opacity: 0.5;
          pointer-events: none;
        }

        .spot-diff-grid {
          justify-content: center;
          align-items: center;
        }

        .spot-diff-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
          border: 2px solid rgba(255, 255, 255, 0.15);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.08);
          cursor: pointer;
          transition: transform 0.1s, background 0.15s, border-color 0.15s;
          outline: none;
          box-shadow: 0 2px 4px rgba(0,0,0,0.15);
        }

        .spot-diff-cell:active {
          transform: scale(0.92);
        }

        .spot-diff-cell:hover {
          border-color: rgba(255, 255, 255, 0.3);
        }

        .spot-diff-cell.wrong {
          background: rgba(239, 68, 68, 0.35);
          border-color: #ef4444;
          animation: spot-diff-shake 0.3s ease-in-out;
          box-shadow: 0 0 8px rgba(239,68,68,0.4);
        }

        .spot-diff-cell.correct {
          background: rgba(34, 197, 94, 0.35);
          border-color: #22c55e;
          animation: spot-diff-pop 0.4s ease-out;
          box-shadow: 0 0 8px rgba(34,197,94,0.4);
        }

        .spot-diff-cell-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
        }

        .spot-diff-hint {
          text-align: center;
          padding: 8px 16px 4px;
        }

        .spot-diff-hint p {
          font-size: 13px;
          color: rgba(255,255,255,0.6);
          margin: 2px 0;
        }

        .spot-diff-penalty-info {
          font-size: 11px !important;
          color: #fca5a5 !important;
        }

        .spot-diff-exit-btn {
          padding: 10px 16px;
          margin: 4px 12px 12px;
          font-size: 13px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          background: transparent;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .spot-diff-exit-btn:active {
          background: rgba(255,255,255,0.08);
        }

        @keyframes spot-diff-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        @keyframes spot-diff-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-4px); }
          40% { transform: translateX(4px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }

        @keyframes spot-diff-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="spot-diff-header">
        <img className="spot-diff-header-avatar" src={kimYeonjaImage} alt="김연자" />
        <div className="spot-diff-header-info">
          <div className="spot-diff-header-score-row">
            <p className="spot-diff-score">{score.toLocaleString()}</p>
            <p className="spot-diff-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <p className={`spot-diff-time ${isLowTime ? 'low-time' : ''}`}>{timeSeconds}s</p>
      </div>

      <div className="spot-diff-meta-row">
        <p className="spot-diff-round">
          ROUND <strong>{round + 1}</strong>
        </p>
        <p className="spot-diff-grid-info">
          GRID <strong>{gridSize}x{gridSize}</strong>
        </p>
        {comboLabel && (
          <p className="ge-combo-label" style={{ color: comboColor, fontSize: 13 }}>
            {comboLabel} x{streak}
          </p>
        )}
        {isFever && (
          <p style={{ color: '#facc15', fontSize: 13, fontWeight: 800, margin: 0, animation: 'spot-diff-pulse 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div className={`spot-diff-arena ${isLowTime ? 'low-time' : ''} ${isGameOver ? 'game-over' : ''}`}>
        <div
          className="spot-diff-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridSize}, ${cellSizePx}px)`,
            gridTemplateRows: `repeat(${gridSize}, ${cellSizePx}px)`,
            gap: '4px',
          }}
        >
          {grid.map((cell) => {
            const isWrongFlash = wrongFlashIndex === cell.cellIndex
            const isCorrectFlash = correctFlashIndex === cell.cellIndex
            let cellClass = 'spot-diff-cell'
            if (isWrongFlash) cellClass += ' wrong'
            if (isCorrectFlash) cellClass += ' correct'

            return (
              <button
                key={`cell-${cell.cellIndex}`}
                className={cellClass}
                type="button"
                onClick={() => handleCellTap(cell)}
                disabled={isGameOver}
                style={{ width: cellSizePx, height: cellSizePx }}
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

      <div className="spot-diff-hint">
        <p>다른 캐릭터 하나를 찾아 터치!</p>
        <p className="spot-diff-penalty-info">오답 시 -{TIME_PENALTY_MS / 1000}초</p>
      </div>

      <button className="spot-diff-exit-btn" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const spotDiffModule: MiniGameModule = {
  manifest: {
    id: 'spot-diff',
    title: 'Spot Diff',
    description: '하나만 다른 캐릭터를 찾아라! 빠를수록 고득점!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#db2777',
  },
  Component: SpotDiffGame,
}
