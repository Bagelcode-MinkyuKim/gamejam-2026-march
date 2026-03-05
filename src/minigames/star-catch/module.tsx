import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import songChangsikImg from '../../../assets/images/same-character/song-changsik.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const LOW_TIME_THRESHOLD_MS = 5000

const ARENA_WIDTH = 360
const ARENA_HEIGHT = 560
const BASKET_WIDTH = 72
const BASKET_HEIGHT = 40
const BASKET_Y = ARENA_HEIGHT - 56

const ITEM_SIZE_STAR = 32
const ITEM_SIZE_GOLDEN = 42
const ITEM_SIZE_BOMB = 36

const BASE_FALL_SPEED = 160
const MAX_FALL_SPEED = 420
const SPEED_INCREASE_PER_POINT = 3.2

const STAR_SCORE = 1
const GOLDEN_STAR_SCORE = 5
const BOMB_PENALTY = 3

const SPAWN_INTERVAL_BASE_MS = 680
const SPAWN_INTERVAL_MIN_MS = 280
const SPAWN_INTERVAL_DECREASE_PER_POINT = 8

const GOLDEN_STAR_CHANCE = 0.12
const BOMB_CHANCE = 0.18

const CATCH_FLASH_DURATION_MS = 200
const MISS_FLASH_DURATION_MS = 300

type ItemKind = 'star' | 'golden' | 'bomb'

interface FallingItem {
  readonly id: number
  readonly kind: ItemKind
  readonly x: number
  y: number
  readonly size: number
  readonly speed: number
  caught: boolean
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function computeFallSpeed(score: number): number {
  return clampNumber(BASE_FALL_SPEED + score * SPEED_INCREASE_PER_POINT, BASE_FALL_SPEED, MAX_FALL_SPEED)
}

function computeSpawnInterval(score: number): number {
  return clampNumber(
    SPAWN_INTERVAL_BASE_MS - score * SPAWN_INTERVAL_DECREASE_PER_POINT,
    SPAWN_INTERVAL_MIN_MS,
    SPAWN_INTERVAL_BASE_MS,
  )
}

function pickItemKind(): ItemKind {
  const roll = Math.random()
  if (roll < BOMB_CHANCE) {
    return 'bomb'
  }
  if (roll < BOMB_CHANCE + GOLDEN_STAR_CHANCE) {
    return 'golden'
  }
  return 'star'
}

function itemSize(kind: ItemKind): number {
  if (kind === 'golden') return ITEM_SIZE_GOLDEN
  if (kind === 'bomb') return ITEM_SIZE_BOMB
  return ITEM_SIZE_STAR
}

function createItem(id: number, score: number): FallingItem {
  const kind = pickItemKind()
  const size = itemSize(kind)
  const margin = size / 2 + 8
  const x = randomBetween(margin, ARENA_WIDTH - margin)
  const speed = computeFallSpeed(score) * (kind === 'golden' ? 0.85 : kind === 'bomb' ? 1.1 : 1)

  return {
    id,
    kind,
    x,
    y: -size,
    size,
    speed,
    caught: false,
  }
}

function isItemCaughtByBasket(item: FallingItem, basketX: number): boolean {
  const basketLeft = basketX - BASKET_WIDTH / 2
  const basketRight = basketX + BASKET_WIDTH / 2
  const basketTop = BASKET_Y - BASKET_HEIGHT / 2
  const basketBottom = BASKET_Y + BASKET_HEIGHT / 2

  const itemCenterY = item.y
  const itemHalfSize = item.size / 2

  const horizontalOverlap = item.x + itemHalfSize > basketLeft && item.x - itemHalfSize < basketRight
  const verticalOverlap = itemCenterY + itemHalfSize > basketTop && itemCenterY - itemHalfSize < basketBottom

  return horizontalOverlap && verticalOverlap
}

function StarCatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [basketX, setBasketX] = useState(ARENA_WIDTH / 2)
  const [items, setItems] = useState<FallingItem[]>([])
  const [catchFlash, setCatchFlash] = useState<'good' | 'great' | 'bad' | null>(null)
  const [scorePopups, setScorePopups] = useState<{ id: number; value: number; x: number; y: number }[]>([])

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const basketXRef = useRef(ARENA_WIDTH / 2)
  const itemsRef = useRef<FallingItem[]>([])
  const nextItemIdRef = useRef(0)
  const nextPopupIdRef = useRef(0)
  const timeSinceLastSpawnRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const arenaRef = useRef<HTMLDivElement | null>(null)

  const catchFlashTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)

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

  const triggerCatchFlash = useCallback((kind: 'good' | 'great' | 'bad') => {
    setCatchFlash(kind)
    clearTimeoutSafe(catchFlashTimerRef)
    const duration = kind === 'bad' ? MISS_FLASH_DURATION_MS : CATCH_FLASH_DURATION_MS
    catchFlashTimerRef.current = window.setTimeout(() => {
      catchFlashTimerRef.current = null
      setCatchFlash(null)
    }, duration)
  }, [])

  const addScorePopup = useCallback((value: number, x: number, y: number) => {
    const id = nextPopupIdRef.current
    nextPopupIdRef.current += 1
    setScorePopups((prev) => [...prev, { id, value, x, y }])
    window.setTimeout(() => {
      setScorePopups((prev) => prev.filter((p) => p.id !== id))
    }, 800)
  }, [])

  const updateBasketFromClient = useCallback((clientX: number) => {
    const arena = arenaRef.current
    if (arena === null) {
      return
    }

    const rect = arena.getBoundingClientRect()
    const relativeX = clientX - rect.left
    const arenaScale = ARENA_WIDTH / rect.width
    const nextX = clampNumber(relativeX * arenaScale, BASKET_WIDTH / 2, ARENA_WIDTH - BASKET_WIDTH / 2)
    basketXRef.current = nextX
    setBasketX(nextX)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(catchFlashTimerRef)
    playAudio(gameOverAudioRef, 0.64, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

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
      clearTimeoutSafe(catchFlashTimerRef)
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

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(tapHitAudioRef, 0.2, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 10000)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      const deltaSec = deltaMs / 1000
      const currentItems = itemsRef.current
      let scoreChanged = false
      let nextScore = scoreRef.current

      for (const item of currentItems) {
        if (item.caught) {
          continue
        }

        item.y += item.speed * deltaSec

        if (!item.caught && isItemCaughtByBasket(item, basketXRef.current)) {
          item.caught = true

          if (item.kind === 'bomb') {
            const penalty = Math.min(nextScore, BOMB_PENALTY)
            nextScore = Math.max(0, nextScore - BOMB_PENALTY)
            scoreChanged = true
            triggerCatchFlash('bad')
            playAudio(tapHitAudioRef, 0.5, 0.7)
            addScorePopup(-penalty, item.x, BASKET_Y)
            effects.triggerShake(7)
            effects.triggerFlash('rgba(239,68,68,0.3)')
            effects.spawnParticles(5, item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), ['💥', '💢', '🔥'])
          } else if (item.kind === 'golden') {
            nextScore += GOLDEN_STAR_SCORE
            scoreChanged = true
            triggerCatchFlash('great')
            playAudio(tapHitStrongAudioRef, 0.6, 1.15)
            addScorePopup(GOLDEN_STAR_SCORE, item.x, BASKET_Y)
            effects.comboHitBurst(item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), 5, GOLDEN_STAR_SCORE, ['🌟', '✨', '💫'])
          } else {
            nextScore += STAR_SCORE
            scoreChanged = true
            triggerCatchFlash('good')
            playAudio(tapHitAudioRef, 0.4, 1 + nextScore * 0.005)
            addScorePopup(STAR_SCORE, item.x, BASKET_Y)
            effects.spawnParticles(3, item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), ['⭐', '✨'])
          }
        }
      }

      if (scoreChanged) {
        scoreRef.current = nextScore
        setScore(nextScore)
      }

      const aliveItems = currentItems.filter((item) => !item.caught && item.y < ARENA_HEIGHT + 60)
      itemsRef.current = aliveItems

      timeSinceLastSpawnRef.current += deltaMs
      const spawnInterval = computeSpawnInterval(scoreRef.current)
      if (timeSinceLastSpawnRef.current >= spawnInterval) {
        timeSinceLastSpawnRef.current -= spawnInterval
        const newItem = createItem(nextItemIdRef.current, scoreRef.current)
        nextItemIdRef.current += 1
        itemsRef.current = [...itemsRef.current, newItem]
      }

      setItems([...itemsRef.current])

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
  }, [addScorePopup, finishGame, playAudio, triggerCatchFlash])

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      updateBasketFromClient(event.clientX)
    },
    [updateBasketFromClient],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
      updateBasketFromClient(event.clientX)
    },
    [updateBasketFromClient],
  )

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (event.touches.length > 0) {
        updateBasketFromClient(event.touches[0].clientX)
      }
    },
    [updateBasketFromClient],
  )

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const fallSpeedLabel = Math.round(computeFallSpeed(score))

  const basketLeftPercent = ((basketX - BASKET_WIDTH / 2) / ARENA_WIDTH) * 100
  const basketWidthPercent = (BASKET_WIDTH / ARENA_WIDTH) * 100
  const basketTopPercent = ((BASKET_Y - BASKET_HEIGHT / 2) / ARENA_HEIGHT) * 100

  return (
    <section className="mini-game-panel star-catch-panel" aria-label="star-catch-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div className="star-catch-score-strip">
        <p className="star-catch-score">{score.toLocaleString()}</p>
        <p className="star-catch-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`star-catch-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="star-catch-meta-row">
        <p className="star-catch-speed">
          낙하속도 <strong>{fallSpeedLabel}</strong>
        </p>
      </div>

      <div
        className={`star-catch-arena ${catchFlash === 'bad' ? 'miss-flash' : ''} ${catchFlash === 'good' || catchFlash === 'great' ? 'catch-flash' : ''}`}
        ref={arenaRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onTouchMove={handleTouchMove}
        role="presentation"
      >
        {items.map((item) => {
          const leftPercent = ((item.x - item.size / 2) / ARENA_WIDTH) * 100
          const topPercent = ((item.y - item.size / 2) / ARENA_HEIGHT) * 100
          const sizeWPercent = (item.size / ARENA_WIDTH) * 100
          const sizeHPercent = (item.size / ARENA_HEIGHT) * 100

          let className = 'star-catch-item'
          let content = ''

          if (item.kind === 'star') {
            className += ' star'
            content = '\u2605'
          } else if (item.kind === 'golden') {
            className += ' golden'
            content = '\u2605'
          } else {
            className += ' bomb'
            content = '\uD83D\uDCA3'
          }

          return (
            <div
              className={className}
              key={item.id}
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                width: `${sizeWPercent}%`,
                height: `${sizeHPercent}%`,
              }}
            >
              {content}
            </div>
          )
        })}

        {scorePopups.map((popup) => {
          const leftPercent = (popup.x / ARENA_WIDTH) * 100
          const topPercent = (popup.y / ARENA_HEIGHT) * 100
          return (
            <div
              className={`star-catch-popup ${popup.value < 0 ? 'negative' : popup.value >= 5 ? 'great' : 'positive'}`}
              key={popup.id}
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
              }}
            >
              {popup.value > 0 ? `+${popup.value}` : `${popup.value}`}
            </div>
          )
        })}

        <div
          className={`star-catch-basket ${catchFlash !== null ? `flash-${catchFlash}` : ''}`}
          style={{
            left: `${basketLeftPercent}%`,
            top: `${basketTopPercent}%`,
            width: `${basketWidthPercent}%`,
          }}
        >
          <span className="star-catch-basket-icon">{'\uD83E\uDDFA'}</span>
        </div>
      </div>

      <div className="star-catch-character-row">
        <img src={songChangsikImg} alt="송창식" className="star-catch-character" draggable={false} />
      </div>

      <style>{GAME_EFFECTS_CSS}
      {`
        .star-catch-panel {
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

        .star-catch-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          padding: 0 4px;
        }

        .star-catch-score {
          font-size: 28px;
          font-weight: 800;
          color: #f59e0b;
          margin: 0;
          line-height: 1;
        }

        .star-catch-best {
          font-size: 12px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .star-catch-time {
          font-size: 18px;
          font-weight: 700;
          color: #e2e8f0;
          margin: 0;
          transition: color 0.2s;
        }

        .star-catch-time.low-time {
          color: #ef4444;
          animation: star-catch-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes star-catch-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .star-catch-meta-row {
          display: flex;
          justify-content: center;
          gap: 16px;
          width: 100%;
          padding: 2px 0;
        }

        .star-catch-speed {
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .star-catch-speed strong {
          color: #fbbf24;
        }

        .star-catch-arena {
          position: relative;
          width: 100%;
          aspect-ratio: ${ARENA_WIDTH} / ${ARENA_HEIGHT};
          max-height: 560px;
          background: linear-gradient(180deg, #0f172a 0%, #1e293b 50%, #334155 100%);
          border-radius: 12px;
          overflow: hidden;
          touch-action: none;
        }

        .star-catch-arena.miss-flash {
          animation: star-catch-miss-flash 0.3s ease-out;
        }

        .star-catch-arena.catch-flash {
          animation: star-catch-catch-flash 0.2s ease-out;
        }

        @keyframes star-catch-miss-flash {
          0% { box-shadow: inset 0 0 40px rgba(239, 68, 68, 0.5); }
          100% { box-shadow: inset 0 0 0 rgba(239, 68, 68, 0); }
        }

        @keyframes star-catch-catch-flash {
          0% { box-shadow: inset 0 0 30px rgba(251, 191, 36, 0.4); }
          100% { box-shadow: inset 0 0 0 rgba(251, 191, 36, 0); }
        }

        .star-catch-item {
          position: absolute;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          font-weight: bold;
          text-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        .star-catch-item.star {
          color: #fbbf24;
          font-size: 24px;
          filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.6));
        }

        .star-catch-item.golden {
          color: #fde68a;
          font-size: 32px;
          filter: drop-shadow(0 0 8px rgba(253, 230, 138, 0.8));
          animation: star-catch-golden-pulse 0.4s ease-in-out infinite alternate;
        }

        @keyframes star-catch-golden-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.15); }
        }

        .star-catch-item.bomb {
          font-size: 24px;
          filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.5));
        }

        .star-catch-basket {
          position: absolute;
          height: ${(BASKET_HEIGHT / ARENA_HEIGHT) * 100}%;
          border-radius: 8px;
          background: linear-gradient(180deg, #7c3aed, #6d28d9);
          border: 2px solid #a78bfa;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: left 0.05s linear;
          box-shadow: 0 2px 8px rgba(124, 58, 237, 0.4);
        }

        .star-catch-basket.flash-good {
          box-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
          border-color: #fbbf24;
        }

        .star-catch-basket.flash-great {
          box-shadow: 0 0 16px rgba(253, 230, 138, 0.8);
          border-color: #fde68a;
          animation: star-catch-great-flash 0.2s ease-out;
        }

        .star-catch-basket.flash-bad {
          box-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
          border-color: #ef4444;
          animation: star-catch-shake 0.3s ease-out;
        }

        @keyframes star-catch-great-flash {
          0% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }

        @keyframes star-catch-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-4px); }
          40% { transform: translateX(4px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(2px); }
        }

        .star-catch-basket-icon {
          font-size: 20px;
          pointer-events: none;
        }

        .star-catch-popup {
          position: absolute;
          font-size: 18px;
          font-weight: 800;
          pointer-events: none;
          animation: star-catch-popup-rise 0.8s ease-out forwards;
          transform: translateX(-50%);
          text-shadow: 0 1px 4px rgba(0,0,0,0.5);
        }

        .star-catch-popup.positive {
          color: #fbbf24;
        }

        .star-catch-popup.great {
          color: #fde68a;
          font-size: 22px;
        }

        .star-catch-popup.negative {
          color: #ef4444;
        }

        @keyframes star-catch-popup-rise {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.2); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-60px) scale(0.8); }
        }

        .star-catch-character-row {
          display: flex;
          justify-content: center;
          padding: 4px 0;
        }

        .star-catch-character {
          width: 80px;
          height: 80px;
          object-fit: contain;
          border-radius: 50%;
          border: 2px solid #f59e0b;
          background: rgba(245, 158, 11, 0.1);
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

export const starCatchModule: MiniGameModule = {
  manifest: {
    id: 'star-catch',
    title: 'Star Catch',
    description: '떨어지는 별을 바구니로 받아라! 황금별은 5배 점수!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.1,
    accentColor: '#f59e0b',
  },
  Component: StarCatchGame,
}
