import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import parkWankyuImg from '../../../assets/images/same-character/park-wankyu.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const INITIAL_NUMBER_COUNT = 5
const MAX_NUMBER_COUNT = 9
const NUMBER_INCREMENT_PER_ROUND = 1
const TIME_BONUS_BASE_MS = 3000
const TIME_BONUS_DECAY = 0.85
const WRONG_TAP_PENALTY = 5
const CLEAR_BONUS_PER_NUMBER = 10
const WRONG_FLASH_DURATION_MS = 200
const CORRECT_ANIM_DURATION_MS = 300
const LOW_TIME_THRESHOLD_MS = 5000
const GAME_AREA_PADDING = 12
const NUMBER_BUTTON_SIZE = 56
const PLACEMENT_ATTEMPTS = 80

interface NumberTile {
  readonly value: number
  readonly x: number
  readonly y: number
  readonly id: string
}

interface ClearedTile {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly value: number
  readonly clearedAtMs: number
}

function generatePositions(count: number, areaWidth: number, areaHeight: number): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = []
  const safeWidth = Math.max(NUMBER_BUTTON_SIZE + GAME_AREA_PADDING * 2, areaWidth)
  const safeHeight = Math.max(NUMBER_BUTTON_SIZE + GAME_AREA_PADDING * 2, areaHeight)
  const minDistance = NUMBER_BUTTON_SIZE + 4

  for (let index = 0; index < count; index += 1) {
    let placed = false
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt += 1) {
      const x = GAME_AREA_PADDING + Math.random() * (safeWidth - NUMBER_BUTTON_SIZE - GAME_AREA_PADDING * 2)
      const y = GAME_AREA_PADDING + Math.random() * (safeHeight - NUMBER_BUTTON_SIZE - GAME_AREA_PADDING * 2)
      const overlaps = positions.some(
        (existing) => Math.hypot(existing.x - x, existing.y - y) < minDistance,
      )

      if (!overlaps) {
        positions.push({ x, y })
        placed = true
        break
      }
    }

    if (!placed) {
      const fallbackX = GAME_AREA_PADDING + Math.random() * (safeWidth - NUMBER_BUTTON_SIZE - GAME_AREA_PADDING * 2)
      const fallbackY = GAME_AREA_PADDING + Math.random() * (safeHeight - NUMBER_BUTTON_SIZE - GAME_AREA_PADDING * 2)
      positions.push({ x: fallbackX, y: fallbackY })
    }
  }

  return positions
}

function createNumberSet(count: number, round: number, areaWidth: number, areaHeight: number): NumberTile[] {
  const clampedCount = Math.min(count, MAX_NUMBER_COUNT)
  const positions = generatePositions(clampedCount, areaWidth, areaHeight)
  const tiles: NumberTile[] = []

  for (let index = 0; index < clampedCount; index += 1) {
    tiles.push({
      value: index + 1,
      x: positions[index].x,
      y: positions[index].y,
      id: `r${round}-n${index + 1}`,
    })
  }

  return tiles
}

function computeTimeBonus(roundIndex: number): number {
  return Math.round(TIME_BONUS_BASE_MS * Math.pow(TIME_BONUS_DECAY, roundIndex))
}

function NumberSortGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [round, setRound] = useState(1)
  const [nextTarget, setNextTarget] = useState(1)
  const [tiles, setTiles] = useState<NumberTile[]>([])
  const [clearedTiles, setClearedTiles] = useState<ClearedTile[]>([])
  const [isWrongFlash, setWrongFlash] = useState(false)
  const [areaSize, setAreaSize] = useState({ width: 320, height: 320 })

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const roundRef = useRef(1)
  const nextTargetRef = useRef(1)
  const tilesRef = useRef<NumberTile[]>([])
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const wrongFlashTimerRef = useRef<number | null>(null)
  const gameAreaRef = useRef<HTMLDivElement | null>(null)
  const elapsedMsRef = useRef(0)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const getAreaSize = useCallback(() => {
    const element = gameAreaRef.current
    if (element === null) {
      return { width: 320, height: 320 }
    }

    return { width: element.clientWidth, height: element.clientHeight }
  }, [])

  const startNewRound = useCallback(
    (roundNumber: number) => {
      const currentAreaSize = getAreaSize()
      setAreaSize(currentAreaSize)
      const numberCount = Math.min(
        MAX_NUMBER_COUNT,
        INITIAL_NUMBER_COUNT + (roundNumber - 1) * NUMBER_INCREMENT_PER_ROUND,
      )
      const newTiles = createNumberSet(numberCount, roundNumber, currentAreaSize.width, currentAreaSize.height)
      tilesRef.current = newTiles
      setTiles(newTiles)
      setClearedTiles([])
      nextTargetRef.current = 1
      setNextTarget(1)
      roundRef.current = roundNumber
      setRound(roundNumber)
    },
    [getAreaSize],
  )

  const triggerWrongFlash = useCallback(() => {
    setWrongFlash(true)
    clearTimeoutSafe(wrongFlashTimerRef)
    wrongFlashTimerRef.current = window.setTimeout(() => {
      wrongFlashTimerRef.current = null
      setWrongFlash(false)
    }, WRONG_FLASH_DURATION_MS)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(wrongFlashTimerRef)
    playAudio(gameOverAudioRef, 0.6, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleNumberTap = useCallback(
    (tile: NumberTile) => {
      if (finishedRef.current) {
        return
      }

      if (tile.value === nextTargetRef.current) {
        const now = window.performance.now()
        const numberCount = tilesRef.current.length
        const pointsPerNumber = CLEAR_BONUS_PER_NUMBER + (roundRef.current - 1) * 2
        const nextScore = scoreRef.current + pointsPerNumber
        scoreRef.current = nextScore
        setScore(nextScore)

        setClearedTiles((previous) => [
          ...previous,
          {
            id: tile.id,
            x: tile.x,
            y: tile.y,
            value: tile.value,
            clearedAtMs: now,
          },
        ])

        const remainingTiles = tilesRef.current.filter((t) => t.id !== tile.id)
        tilesRef.current = remainingTiles
        setTiles(remainingTiles)

        const nextValue = nextTargetRef.current + 1
        nextTargetRef.current = nextValue
        setNextTarget(nextValue)

        const pitchOffset = (tile.value - 1) / numberCount
        playAudio(tapHitAudioRef, 0.5, 1 + pitchOffset * 0.4)
        effects.spawnParticles(3, tile.x + NUMBER_BUTTON_SIZE / 2, tile.y + NUMBER_BUTTON_SIZE / 2)
        effects.showScorePopup(pointsPerNumber, tile.x + NUMBER_BUTTON_SIZE / 2, tile.y)

        if (nextValue > numberCount) {
          const timeBonus = computeTimeBonus(roundRef.current - 1)
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + timeBonus)
          setRemainingMs(remainingMsRef.current)

          const clearBonus = numberCount * 5 * roundRef.current
          const bonusScore = scoreRef.current + clearBonus
          scoreRef.current = bonusScore
          setScore(bonusScore)

          playAudio(tapHitStrongAudioRef, 0.65, 1.1)
          effects.comboHitBurst(160, 160, roundRef.current * 2, clearBonus, ['🎉', '✨', '🌟'])

          const nextRound = roundRef.current + 1
          startNewRound(nextRound)
        }
      } else {
        const penaltyScore = Math.max(0, scoreRef.current - WRONG_TAP_PENALTY)
        scoreRef.current = penaltyScore
        setScore(penaltyScore)
        triggerWrongFlash()
        playAudio(tapHitAudioRef, 0.4, 0.7)
        effects.triggerShake(5)
        effects.triggerFlash('rgba(239,68,68,0.25)')
      }
    },
    [playAudio, startNewRound, triggerWrongFlash],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  useEffect(() => {
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
      for (const audio of [tapHitAudio, tapHitStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

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
    startNewRound(1)
  }, [startNewRound])

  useEffect(() => {
    lastFrameAtRef.current = null
    elapsedMsRef.current = 0

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
      elapsedMsRef.current += deltaMs

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      setClearedTiles((previous) =>
        previous.filter((ct) => now - ct.clearedAtMs < CORRECT_ANIM_DURATION_MS),
      )

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
  const numberCount = Math.min(
    MAX_NUMBER_COUNT,
    INITIAL_NUMBER_COUNT + (round - 1) * NUMBER_INCREMENT_PER_ROUND,
  )

  return (
    <section className="mini-game-panel number-sort-panel" aria-label="number-sort-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div className="number-sort-score-strip">
        <p className="number-sort-score">{score.toLocaleString()}</p>
        <p className="number-sort-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`number-sort-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="number-sort-meta-row">
        <p className="number-sort-round">
          ROUND <strong>{round}</strong>
        </p>
        <p className="number-sort-target">
          NEXT <strong>{nextTarget > numberCount ? 'CLEAR!' : nextTarget}</strong>
        </p>
        <p className="number-sort-count">
          {numberCount}개
        </p>
      </div>

      <div
        className={`number-sort-arena ${isWrongFlash ? 'miss' : ''}`}
        ref={gameAreaRef}
      >
        {tiles.map((tile) => {
          const isCurrent = tile.value === nextTarget
          return (
            <button
              className={`number-sort-tile ${isCurrent ? 'current' : ''}`}
              key={tile.id}
              type="button"
              style={{
                left: tile.x,
                top: tile.y,
                width: NUMBER_BUTTON_SIZE,
                height: NUMBER_BUTTON_SIZE,
              }}
              onClick={() => handleNumberTap(tile)}
            >
              {tile.value}
            </button>
          )
        })}

        {clearedTiles.map((ct) => (
          <div
            className="number-sort-tile-cleared"
            key={`cleared-${ct.id}`}
            style={{
              left: ct.x,
              top: ct.y,
              width: NUMBER_BUTTON_SIZE,
              height: NUMBER_BUTTON_SIZE,
            }}
          >
            {ct.value}
          </div>
        ))}
      </div>

      <div className="number-sort-character-row">
        <img src={parkWankyuImg} alt="박완규" className="number-sort-character" draggable={false} />
      </div>

      <style>{GAME_EFFECTS_CSS}
      {`
        .number-sort-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 8px;
          width: 100%;
          user-select: none;
          -webkit-user-select: none;
          position: relative;
        }

        .number-sort-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          padding: 0 4px;
        }

        .number-sort-score {
          font-size: 28px;
          font-weight: 800;
          color: #10b981;
          margin: 0;
          line-height: 1;
        }

        .number-sort-best {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .number-sort-time {
          font-size: 18px;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0;
          transition: color 0.2s;
        }

        .number-sort-time.low-time {
          color: #ef4444;
          animation: number-sort-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes number-sort-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .number-sort-meta-row {
          display: flex;
          justify-content: center;
          gap: 16px;
          width: 100%;
          padding: 2px 0;
        }

        .number-sort-round,
        .number-sort-target,
        .number-sort-count {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .number-sort-round strong,
        .number-sort-target strong,
        .number-sort-count strong {
          color: #10b981;
        }

        .number-sort-arena {
          position: relative;
          width: 100%;
          aspect-ratio: 1;
          max-height: 360px;
          background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
          border-radius: 12px;
          overflow: hidden;
        }

        .number-sort-arena.miss {
          animation: number-sort-miss-flash 0.2s ease-out;
        }

        @keyframes number-sort-miss-flash {
          0% { box-shadow: inset 0 0 30px rgba(239, 68, 68, 0.4); }
          100% { box-shadow: inset 0 0 0 rgba(239, 68, 68, 0); }
        }

        .number-sort-tile {
          position: absolute;
          border-radius: 50%;
          border: 3px solid #334155;
          background: linear-gradient(135deg, #1e293b, #334155);
          color: #e2e8f0;
          font-size: 22px;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.1s, border-color 0.15s, box-shadow 0.15s;
          font-family: inherit;
          padding: 0;
        }

        .number-sort-tile:active {
          transform: scale(0.9);
        }

        .number-sort-tile.current {
          border-color: #10b981;
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.4);
          color: #10b981;
        }

        .number-sort-tile-cleared {
          position: absolute;
          border-radius: 50%;
          background: #22c55e;
          color: #fff;
          font-size: 22px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: number-sort-clear-pop 0.3s ease-out forwards;
          pointer-events: none;
        }

        @keyframes number-sort-clear-pop {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.3); }
          100% { opacity: 0; transform: scale(0.5); }
        }

        .number-sort-character-row {
          display: flex;
          justify-content: center;
          padding: 4px 0;
        }

        .number-sort-character {
          width: 80px;
          height: 80px;
          object-fit: contain;
          border-radius: 50%;
          border: 2px solid #10b981;
          background: rgba(16, 185, 129, 0.1);
          opacity: 0.9;
        }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const numberSortModule: MiniGameModule = {
  manifest: {
    id: 'number-sort',
    title: 'Number Sort',
    description: '흩어진 숫자를 1부터 순서대로 터치! 빨리 클리어하면 타임보너스!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#10b981',
  },
  Component: NumberSortGame,
}
