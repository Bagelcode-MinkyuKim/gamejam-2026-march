import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, GAME_EFFECTS_CSS } from '../shared/game-effects'
import starImg from '../../../assets/images/star-catch/star.png'
import goldenStarImg from '../../../assets/images/star-catch/golden-star.png'
import bombImg from '../../../assets/images/star-catch/bomb.png'
import magnetImg from '../../../assets/images/star-catch/magnet.png'
import shieldImg from '../../../assets/images/star-catch/shield.png'
import basketImg from '../../../assets/images/star-catch/basket.png'

const ROUND_DURATION_MS = 30000
const LOW_TIME_THRESHOLD_MS = 5000

const ARENA_WIDTH = 432
const ARENA_HEIGHT = 768

const BASKET_WIDTH = 110
const BASKET_HEIGHT = 56
const BASKET_Y = ARENA_HEIGHT - 72

const ITEM_SIZE_STAR = 52
const ITEM_SIZE_GOLDEN = 64
const ITEM_SIZE_BOMB = 56
const ITEM_SIZE_MAGNET = 52
const ITEM_SIZE_SHIELD = 52

const BASE_FALL_SPEED = 170
const MAX_FALL_SPEED = 480
const SPEED_INCREASE_PER_POINT = 3.0

const STAR_SCORE = 1
const GOLDEN_STAR_SCORE = 5
const BOMB_PENALTY = 3

const SPAWN_INTERVAL_BASE_MS = 620
const SPAWN_INTERVAL_MIN_MS = 220
const SPAWN_INTERVAL_DECREASE_PER_POINT = 7

const GOLDEN_STAR_CHANCE = 0.12
const BOMB_CHANCE = 0.30
const MAGNET_CHANCE = 0.04
const SHIELD_CHANCE = 0.04

const CATCH_FLASH_DURATION_MS = 200
const MISS_FLASH_DURATION_MS = 300

const COMBO_FEVER_THRESHOLD = 10
const FEVER_DURATION_MS = 5000
const FEVER_SCORE_MULTIPLIER = 3
const MAGNET_DURATION_MS = 4000
const MAGNET_PULL_SPEED = 320
const SHIELD_DURATION_MS = 6000

const STAR_SHOWER_INTERVAL_MS = 12000
const STAR_SHOWER_COUNT = 8

type ItemKind = 'star' | 'golden' | 'bomb' | 'magnet' | 'shield'

interface FallingItem {
  readonly id: number
  readonly kind: ItemKind
  readonly x: number
  y: number
  readonly size: number
  readonly speed: number
  caught: boolean
  trail: { x: number; y: number; opacity: number }[]
}

interface BgStar {
  x: number
  y: number
  size: number
  speed: number
  opacity: number
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

function pickItemKind(isFever: boolean): ItemKind {
  if (isFever) {
    return Math.random() < 0.7 ? 'golden' : 'star'
  }
  const roll = Math.random()
  let threshold = 0
  threshold += MAGNET_CHANCE
  if (roll < threshold) return 'magnet'
  threshold += SHIELD_CHANCE
  if (roll < threshold) return 'shield'
  threshold += BOMB_CHANCE
  if (roll < threshold) return 'bomb'
  threshold += GOLDEN_STAR_CHANCE
  if (roll < threshold) return 'golden'
  return 'star'
}

function itemSize(kind: ItemKind): number {
  if (kind === 'golden') return ITEM_SIZE_GOLDEN
  if (kind === 'bomb') return ITEM_SIZE_BOMB
  if (kind === 'magnet') return ITEM_SIZE_MAGNET
  if (kind === 'shield') return ITEM_SIZE_SHIELD
  return ITEM_SIZE_STAR
}

function createItem(id: number, score: number, isFever: boolean): FallingItem {
  const kind = pickItemKind(isFever)
  const size = itemSize(kind)
  const margin = size / 2 + 8
  const x = randomBetween(margin, ARENA_WIDTH - margin)
  const speedMul = kind === 'golden' ? 0.85 : kind === 'bomb' ? 1.1 : kind === 'magnet' || kind === 'shield' ? 0.75 : 1
  const speed = computeFallSpeed(score) * speedMul * (isFever ? 1.3 : 1)

  return { id, kind, x, y: -size, size, speed, caught: false, trail: [] }
}

function createBgStars(count: number): BgStar[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * ARENA_WIDTH,
    y: Math.random() * ARENA_HEIGHT,
    size: randomBetween(1, 3),
    speed: randomBetween(8, 30),
    opacity: randomBetween(0.15, 0.5),
  }))
}

function isItemCaughtByBasket(item: FallingItem, basketX: number): boolean {
  const basketLeft = basketX - BASKET_WIDTH / 2
  const basketRight = basketX + BASKET_WIDTH / 2
  const basketTop = BASKET_Y - BASKET_HEIGHT / 2
  const basketBottom = BASKET_Y + BASKET_HEIGHT / 2
  const itemHalfSize = item.size / 2

  return (
    item.x + itemHalfSize > basketLeft &&
    item.x - itemHalfSize < basketRight &&
    item.y + itemHalfSize > basketTop &&
    item.y - itemHalfSize < basketBottom
  )
}

function StarCatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [basketX, setBasketX] = useState(ARENA_WIDTH / 2)
  const [items, setItems] = useState<FallingItem[]>([])
  const [catchFlash, setCatchFlash] = useState<'good' | 'great' | 'bad' | 'power' | null>(null)
  const [scorePopups, setScorePopups] = useState<{ id: number; value: number; x: number; y: number; text?: string }[]>([])
  const [isFever, setIsFever] = useState(false)
  const [hasMagnet, setHasMagnet] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [bgStars] = useState(() => createBgStars(40))
  const [bgStarPositions, setBgStarPositions] = useState<BgStar[]>(() => bgStars)

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
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

  const isFeverRef = useRef(false)
  const feverTimerRef = useRef<number | null>(null)
  const hasMagnetRef = useRef(false)
  const magnetTimerRef = useRef<number | null>(null)
  const hasShieldRef = useRef(false)
  const shieldTimerRef = useRef<number | null>(null)

  const starShowerTimerRef = useRef(0)
  const bgStarsRef = useRef(bgStars)

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

  const triggerCatchFlash = useCallback((kind: 'good' | 'great' | 'bad' | 'power') => {
    setCatchFlash(kind)
    clearTimeoutSafe(catchFlashTimerRef)
    const duration = kind === 'bad' ? MISS_FLASH_DURATION_MS : CATCH_FLASH_DURATION_MS
    catchFlashTimerRef.current = window.setTimeout(() => {
      catchFlashTimerRef.current = null
      setCatchFlash(null)
    }, duration)
  }, [])

  const addScorePopup = useCallback((value: number, x: number, y: number, text?: string) => {
    const id = nextPopupIdRef.current
    nextPopupIdRef.current += 1
    setScorePopups((prev) => [...prev, { id, value, x, y, text }])
    window.setTimeout(() => {
      setScorePopups((prev) => prev.filter((p) => p.id !== id))
    }, 900)
  }, [])

  const activateFever = useCallback(() => {
    isFeverRef.current = true
    setIsFever(true)
    clearTimeoutSafe(feverTimerRef)
    feverTimerRef.current = window.setTimeout(() => {
      feverTimerRef.current = null
      isFeverRef.current = false
      setIsFever(false)
    }, FEVER_DURATION_MS)
  }, [])

  const activateMagnet = useCallback(() => {
    hasMagnetRef.current = true
    setHasMagnet(true)
    clearTimeoutSafe(magnetTimerRef)
    magnetTimerRef.current = window.setTimeout(() => {
      magnetTimerRef.current = null
      hasMagnetRef.current = false
      setHasMagnet(false)
    }, MAGNET_DURATION_MS)
  }, [])

  const activateShield = useCallback(() => {
    hasShieldRef.current = true
    setHasShield(true)
    clearTimeoutSafe(shieldTimerRef)
    shieldTimerRef.current = window.setTimeout(() => {
      shieldTimerRef.current = null
      hasShieldRef.current = false
      setHasShield(false)
    }, SHIELD_DURATION_MS)
  }, [])

  const updateBasketFromClient = useCallback((clientX: number) => {
    const arena = arenaRef.current
    if (arena === null) return
    const rect = arena.getBoundingClientRect()
    const relativeX = clientX - rect.left
    const arenaScale = ARENA_WIDTH / rect.width
    const nextX = clampNumber(relativeX * arenaScale, BASKET_WIDTH / 2, ARENA_WIDTH - BASKET_WIDTH / 2)
    basketXRef.current = nextX
    setBasketX(nextX)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(catchFlashTimerRef)
    clearTimeoutSafe(feverTimerRef)
    clearTimeoutSafe(magnetTimerRef)
    clearTimeoutSafe(shieldTimerRef)
    playAudio(gameOverAudioRef, 0.64, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

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
      clearTimeoutSafe(feverTimerRef)
      clearTimeoutSafe(magnetTimerRef)
      clearTimeoutSafe(shieldTimerRef)
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
      let comboChanged = false
      let nextScore = scoreRef.current
      let nextCombo = comboRef.current

      // Update background stars
      const bgS = bgStarsRef.current
      for (const star of bgS) {
        star.y += star.speed * deltaSec
        if (star.y > ARENA_HEIGHT) {
          star.y = -2
          star.x = Math.random() * ARENA_WIDTH
        }
      }
      setBgStarPositions([...bgS])

      // Star shower
      starShowerTimerRef.current += deltaMs
      if (starShowerTimerRef.current >= STAR_SHOWER_INTERVAL_MS) {
        starShowerTimerRef.current -= STAR_SHOWER_INTERVAL_MS
        for (let i = 0; i < STAR_SHOWER_COUNT; i++) {
          const newItem = createItem(nextItemIdRef.current, scoreRef.current, isFeverRef.current)
          const overriddenItem: FallingItem = {
            ...newItem,
            kind: 'golden',
            size: ITEM_SIZE_GOLDEN,
            speed: newItem.speed * 0.7,
            x: randomBetween(30, ARENA_WIDTH - 30),
          }
          nextItemIdRef.current += 1
          itemsRef.current = [...itemsRef.current, overriddenItem]
        }
        // no flash
      }

      for (const item of currentItems) {
        if (item.caught) continue

        // Magnet effect: pull non-bomb items toward basket
        if (hasMagnetRef.current && item.kind !== 'bomb') {
          const dx = basketXRef.current - item.x
          const dist = Math.abs(dx)
          if (dist > 5) {
            const pullX = (dx / dist) * MAGNET_PULL_SPEED * deltaSec
            ;(item as { x: number }).x = clampNumber(item.x + pullX, item.size / 2, ARENA_WIDTH - item.size / 2)
          }
        }

        item.y += item.speed * deltaSec

        // Trail effect
        item.trail.push({ x: item.x, y: item.y, opacity: 0.6 })
        if (item.trail.length > 5) item.trail.shift()
        for (const t of item.trail) {
          t.opacity -= deltaSec * 2.5
        }
        item.trail = item.trail.filter((t) => t.opacity > 0.05)

        if (!item.caught && isItemCaughtByBasket(item, basketXRef.current)) {
          item.caught = true

          if (item.kind === 'bomb') {
            if (hasShieldRef.current) {
              // Shield blocks bomb
              hasShieldRef.current = false
              setHasShield(false)
              clearTimeoutSafe(shieldTimerRef)
              triggerCatchFlash('power')
              playAudio(tapHitStrongAudioRef, 0.5, 0.8)
              addScorePopup(0, item.x, BASKET_Y, 'BLOCKED!')
              effects.spawnParticles(6, item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), ['🛡️', '✨', '💫'])
            } else {
              const penalty = Math.min(nextScore, BOMB_PENALTY)
              nextScore = Math.max(0, nextScore - BOMB_PENALTY)
              nextCombo = 0
              scoreChanged = true
              comboChanged = true
              triggerCatchFlash('bad')
              playAudio(tapHitAudioRef, 0.5, 0.7)
              addScorePopup(-penalty, item.x, BASKET_Y)
              effects.triggerShake(3)
              effects.spawnParticles(8, item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), ['💥', '💢', '🔥', '😵'])
            }
          } else if (item.kind === 'magnet') {
            activateMagnet()
            triggerCatchFlash('power')
            playAudio(tapHitStrongAudioRef, 0.55, 1.3)
            addScorePopup(0, item.x, BASKET_Y, 'MAGNET!')
            effects.spawnParticles(6, item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), ['🧲', '✨', '💫'])
          } else if (item.kind === 'shield') {
            activateShield()
            triggerCatchFlash('power')
            playAudio(tapHitStrongAudioRef, 0.55, 1.1)
            addScorePopup(0, item.x, BASKET_Y, 'SHIELD!')
            effects.spawnParticles(6, item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), ['🛡️', '✨', '💫'])
          } else if (item.kind === 'golden') {
            const feverMul = isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1
            const comboMul = 1 + Math.floor(nextCombo / 5) * 0.5
            const pts = Math.round(GOLDEN_STAR_SCORE * feverMul * comboMul)
            nextScore += pts
            nextCombo += 1
            scoreChanged = true
            comboChanged = true
            triggerCatchFlash('great')
            playAudio(tapHitStrongAudioRef, 0.6, 1.15 + nextCombo * 0.02)
            addScorePopup(pts, item.x, BASKET_Y)
            effects.comboHitBurst(item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), nextCombo, pts, ['🌟', '✨', '💫', '🔥'])
          } else {
            const feverMul = isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1
            const comboMul = 1 + Math.floor(nextCombo / 5) * 0.5
            const pts = Math.round(STAR_SCORE * feverMul * comboMul)
            nextScore += pts
            nextCombo += 1
            scoreChanged = true
            comboChanged = true
            triggerCatchFlash('good')
            playAudio(tapHitAudioRef, 0.4, 1 + nextCombo * 0.01)
            addScorePopup(pts, item.x, BASKET_Y)
            effects.spawnParticles(3, item.x * (100 / ARENA_WIDTH), BASKET_Y * (100 / ARENA_HEIGHT), ['⭐', '✨'])
          }

          // Check fever activation
          if (nextCombo >= COMBO_FEVER_THRESHOLD && !isFeverRef.current && nextCombo % COMBO_FEVER_THRESHOLD === 0) {
            activateFever()
            effects.spawnParticles(15, 50, 50, ['🔥', '⭐', '🌟', '💫', '✨', '🎉'])
            addScorePopup(0, ARENA_WIDTH / 2, ARENA_HEIGHT / 3, 'FEVER TIME!')
          }
        }
      }

      if (scoreChanged) {
        scoreRef.current = nextScore
        setScore(nextScore)
      }
      if (comboChanged) {
        comboRef.current = nextCombo
        if (nextCombo > maxComboRef.current) maxComboRef.current = nextCombo
        setCombo(nextCombo)
      }

      const aliveItems = currentItems.filter((item) => !item.caught && item.y < ARENA_HEIGHT + 60)
      itemsRef.current = aliveItems

      timeSinceLastSpawnRef.current += deltaMs
      const spawnInterval = computeSpawnInterval(scoreRef.current) * (isFeverRef.current ? 0.6 : 1)
      if (timeSinceLastSpawnRef.current >= spawnInterval) {
        timeSinceLastSpawnRef.current -= spawnInterval
        const newItem = createItem(nextItemIdRef.current, scoreRef.current, isFeverRef.current)
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
  }, [addScorePopup, finishGame, playAudio, triggerCatchFlash, activateFever, activateMagnet, activateShield])

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

  const basketLeftPercent = ((basketX - BASKET_WIDTH / 2) / ARENA_WIDTH) * 100
  const basketWidthPercent = (BASKET_WIDTH / ARENA_WIDTH) * 100
  const basketTopPercent = ((BASKET_Y - BASKET_HEIGHT / 2) / ARENA_HEIGHT) * 100

  const comboColor = combo >= 20 ? '#ff6b6b' : combo >= 10 ? '#fbbf24' : combo >= 5 ? '#60a5fa' : '#94a3b8'

  return (
    <section
      className="mini-game-panel star-catch-panel"
      aria-label="star-catch-game"
      style={{ maxWidth: '432px', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}
    >
      <div
        className={`star-catch-arena ${isFever ? 'fever-mode' : ''} ${catchFlash === 'bad' ? 'miss-flash' : ''} ${catchFlash === 'good' || catchFlash === 'great' ? 'catch-flash' : ''} ${catchFlash === 'power' ? 'power-flash' : ''}`}
        ref={arenaRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onTouchMove={handleTouchMove}
        role="presentation"
      >
        {/* Background stars */}
        {bgStarPositions.map((star, i) => (
          <div
            key={`bg-${i}`}
            className="star-catch-bg-star"
            style={{
              left: `${(star.x / ARENA_WIDTH) * 100}%`,
              top: `${(star.y / ARENA_HEIGHT) * 100}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              opacity: star.opacity,
            }}
          />
        ))}

        {/* HUD overlay */}
        <div className="star-catch-hud">
          <div className="star-catch-hud-left">
            <p className="star-catch-score">{score.toLocaleString()}</p>
            <p className="star-catch-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
          <div className="star-catch-hud-center">
            {combo >= 3 && (
              <p className="star-catch-combo" style={{ color: comboColor }}>
                {combo}x COMBO
              </p>
            )}
          </div>
          <div className="star-catch-hud-right">
            <p className={`star-catch-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
            <div className="star-catch-powerups">
              {hasMagnet && <span className="star-catch-powerup-icon magnet-active">🧲</span>}
              {hasShield && <span className="star-catch-powerup-icon shield-active">🛡️</span>}
            </div>
          </div>
        </div>

        {/* Fever banner */}
        {isFever && (
          <div className="star-catch-fever-banner">
            FEVER x{FEVER_SCORE_MULTIPLIER}
          </div>
        )}

        {/* Item trails */}
        {items.map((item) =>
          item.trail.map((t, ti) => {
            const leftP = ((t.x - item.size / 4) / ARENA_WIDTH) * 100
            const topP = ((t.y - item.size / 4) / ARENA_HEIGHT) * 100
            const sizeP = (item.size * 0.5 / ARENA_WIDTH) * 100
            const trailColor = item.kind === 'golden' ? 'rgba(253,230,138,' : item.kind === 'bomb' ? 'rgba(239,68,68,' : item.kind === 'magnet' ? 'rgba(59,130,246,' : item.kind === 'shield' ? 'rgba(52,211,153,' : 'rgba(251,191,36,'
            return (
              <div
                key={`trail-${item.id}-${ti}`}
                className="star-catch-trail"
                style={{
                  left: `${leftP}%`,
                  top: `${topP}%`,
                  width: `${sizeP}%`,
                  aspectRatio: '1',
                  background: `radial-gradient(circle, ${trailColor}${t.opacity}) 0%, ${trailColor}0) 100%)`,
                  borderRadius: '50%',
                }}
              />
            )
          }),
        )}

        {/* Items */}
        {items.map((item) => {
          const leftPercent = ((item.x - item.size / 2) / ARENA_WIDTH) * 100
          const topPercent = ((item.y - item.size / 2) / ARENA_HEIGHT) * 100
          const sizeWPercent = (item.size / ARENA_WIDTH) * 100
          const sizeHPercent = (item.size / ARENA_HEIGHT) * 100

          let className = 'star-catch-item'
          let imgSrc = starImg

          if (item.kind === 'star') {
            className += ' star'
            imgSrc = starImg
          } else if (item.kind === 'golden') {
            className += ' golden'
            imgSrc = goldenStarImg
          } else if (item.kind === 'magnet') {
            className += ' magnet-item'
            imgSrc = magnetImg
          } else if (item.kind === 'shield') {
            className += ' shield-item'
            imgSrc = shieldImg
          } else {
            className += ' bomb'
            imgSrc = bombImg
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
              <img src={imgSrc} alt={item.kind} className="star-catch-item-img" draggable={false} />
            </div>
          )
        })}

        {/* Score popups */}
        {scorePopups.map((popup) => {
          const leftPercent = (popup.x / ARENA_WIDTH) * 100
          const topPercent = (popup.y / ARENA_HEIGHT) * 100
          return (
            <div
              className={`star-catch-popup ${popup.text ? 'text-popup' : popup.value < 0 ? 'negative' : popup.value >= 5 ? 'great' : 'positive'}`}
              key={popup.id}
              style={{ left: `${leftPercent}%`, top: `${topPercent}%` }}
            >
              {popup.text ? popup.text : popup.value > 0 ? `+${popup.value}` : `${popup.value}`}
            </div>
          )
        })}

        {/* Basket */}
        <div
          className={`star-catch-basket ${catchFlash !== null ? `flash-${catchFlash}` : ''} ${hasMagnet ? 'magnet-glow' : ''} ${hasShield ? 'shield-glow' : ''}`}
          style={{
            left: `${basketLeftPercent}%`,
            top: `${basketTopPercent}%`,
            width: `${basketWidthPercent}%`,
          }}
        >
          <img src={basketImg} alt="basket" className="star-catch-basket-img" draggable={false} />
        </div>
      </div>

      <style>{GAME_EFFECTS_CSS}
      {`
        .star-catch-panel {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          position: relative;
          padding: 0;
          gap: 0;
        }

        .star-catch-arena {
          position: relative;
          width: 100%;
          flex: 1;
          min-height: 0;
          background: linear-gradient(180deg, #0a0e1a 0%, #111827 40%, #1e293b 100%);
          overflow: hidden;
          touch-action: none;
        }

        .star-catch-arena.fever-mode {
          background: linear-gradient(180deg, #1a0a0a 0%, #2d1810 40%, #3b2518 100%);
          animation: star-catch-fever-bg 0.5s ease-in-out infinite alternate;
        }

        @keyframes star-catch-fever-bg {
          from { filter: brightness(1); }
          to { filter: brightness(1.15); }
        }

        .star-catch-arena.miss-flash {
          animation: star-catch-miss-flash 0.3s ease-out;
        }

        @keyframes star-catch-miss-flash {
          0% { box-shadow: inset 0 0 40px rgba(239, 68, 68, 0.3); }
          100% { box-shadow: inset 0 0 0 rgba(239, 68, 68, 0); }
        }

        .star-catch-bg-star {
          position: absolute;
          background: #fff;
          border-radius: 50%;
          pointer-events: none;
        }

        .star-catch-hud {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 16px 18px 0;
          z-index: 10;
          pointer-events: none;
        }

        .star-catch-hud-left,
        .star-catch-hud-right {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .star-catch-hud-center {
          display: flex;
          flex-direction: column;
          align-items: center;
        }

        .star-catch-score {
          font-size: clamp(52px, 14vw, 72px);
          font-weight: 900;
          color: #f59e0b;
          margin: 0;
          line-height: 1;
          text-shadow: 0 2px 12px rgba(245,158,11,0.5), 0 0 24px rgba(245,158,11,0.2);
          letter-spacing: -1px;
        }

        .star-catch-best {
          font-size: 16px;
          font-weight: 700;
          color: #64748b;
          margin: 0;
        }

        .star-catch-combo {
          font-size: clamp(32px, 9vw, 44px);
          font-weight: 900;
          margin: 0;
          line-height: 1;
          text-shadow: 0 2px 12px rgba(0,0,0,0.6);
          animation: star-catch-combo-bounce 0.3s ease-out;
          letter-spacing: 1px;
        }

        @keyframes star-catch-combo-bounce {
          0% { transform: scale(1.6); }
          40% { transform: scale(0.85); }
          100% { transform: scale(1); }
        }

        .star-catch-time {
          font-size: clamp(30px, 8vw, 40px);
          font-weight: 800;
          color: #e2e8f0;
          margin: 0;
          text-align: right;
          transition: color 0.2s;
          text-shadow: 0 1px 6px rgba(0,0,0,0.4);
        }

        .star-catch-time.low-time {
          color: #ef4444;
          animation: star-catch-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes star-catch-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.1); }
        }

        .star-catch-powerups {
          display: flex;
          gap: 4px;
          justify-content: flex-end;
        }

        .star-catch-powerup-icon {
          font-size: 26px;
          animation: star-catch-powerup-pulse 0.8s ease-in-out infinite alternate;
        }

        .star-catch-powerup-icon.magnet-active {
          filter: drop-shadow(0 0 6px rgba(59,130,246,0.8));
        }

        .star-catch-powerup-icon.shield-active {
          filter: drop-shadow(0 0 6px rgba(52,211,153,0.8));
        }

        @keyframes star-catch-powerup-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.2); }
        }

        .star-catch-fever-banner {
          position: absolute;
          top: 60px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 38px;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 16px rgba(251,191,36,0.8), 0 0 32px rgba(245,158,11,0.5);
          animation: star-catch-fever-text 0.6s ease-in-out infinite alternate;
          z-index: 11;
          pointer-events: none;
          letter-spacing: 4px;
        }

        @keyframes star-catch-fever-text {
          from { transform: translateX(-50%) scale(1); opacity: 1; }
          to { transform: translateX(-50%) scale(1.1); opacity: 0.8; }
        }

        .star-catch-trail {
          position: absolute;
          pointer-events: none;
        }

        .star-catch-item {
          position: absolute;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
        }

        .star-catch-item-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: pixelated;
          pointer-events: none;
        }

        .star-catch-item.star {
          filter: drop-shadow(0 0 6px rgba(251, 191, 36, 0.6));
          animation: star-catch-star-spin 2s linear infinite;
        }

        @keyframes star-catch-star-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .star-catch-item.golden {
          filter: drop-shadow(0 0 14px rgba(253, 230, 138, 0.9));
          animation: star-catch-golden-pulse 0.3s ease-in-out infinite alternate;
        }

        @keyframes star-catch-golden-pulse {
          from { transform: scale(1); filter: drop-shadow(0 0 14px rgba(253, 230, 138, 0.9)); }
          to { transform: scale(1.2); filter: drop-shadow(0 0 22px rgba(253, 230, 138, 1)); }
        }

        .star-catch-item.bomb {
          filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.6));
          animation: star-catch-bomb-wobble 0.4s ease-in-out infinite alternate;
        }

        @keyframes star-catch-bomb-wobble {
          from { transform: rotate(-8deg); }
          to { transform: rotate(8deg); }
        }

        .star-catch-item.magnet-item {
          filter: drop-shadow(0 0 10px rgba(59,130,246,0.7));
          animation: star-catch-powerup-float 0.6s ease-in-out infinite alternate;
        }

        .star-catch-item.shield-item {
          filter: drop-shadow(0 0 10px rgba(52,211,153,0.7));
          animation: star-catch-powerup-float 0.6s ease-in-out infinite alternate;
        }

        @keyframes star-catch-powerup-float {
          from { transform: translateY(-2px) scale(1); }
          to { transform: translateY(2px) scale(1.1); }
        }

        .star-catch-basket {
          position: absolute;
          height: ${(BASKET_HEIGHT / ARENA_HEIGHT) * 100}%;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: none;
          overflow: visible;
          filter: drop-shadow(0 4px 12px rgba(124, 58, 237, 0.5));
        }

        .star-catch-basket-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: pixelated;
          pointer-events: none;
        }

        .star-catch-basket.magnet-glow {
          filter: drop-shadow(0 0 16px rgba(59,130,246,0.7)) drop-shadow(0 4px 12px rgba(59,130,246,0.4));
        }

        .star-catch-basket.shield-glow {
          filter: drop-shadow(0 0 16px rgba(52,211,153,0.7)) drop-shadow(0 4px 12px rgba(52,211,153,0.4));
        }

        .star-catch-basket.flash-good {
          filter: drop-shadow(0 0 14px rgba(251, 191, 36, 0.7)) drop-shadow(0 4px 10px rgba(124, 58, 237, 0.5));
        }

        .star-catch-basket.flash-great {
          filter: drop-shadow(0 0 20px rgba(253, 230, 138, 1)) drop-shadow(0 0 36px rgba(251, 191, 36, 0.5));
          animation: star-catch-great-flash 0.2s ease-out;
        }

        .star-catch-basket.flash-bad {
          filter: drop-shadow(0 0 16px rgba(239, 68, 68, 0.8)) drop-shadow(0 0 28px rgba(239, 68, 68, 0.3));
          animation: star-catch-shake 0.3s ease-out;
        }

        .star-catch-basket.flash-power {
          filter: drop-shadow(0 0 20px rgba(96, 165, 250, 0.9)) drop-shadow(0 0 36px rgba(96, 165, 250, 0.4));
          animation: star-catch-great-flash 0.3s ease-out;
        }

        @keyframes star-catch-great-flash {
          0% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }

        @keyframes star-catch-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(3px); }
        }

        .star-catch-popup {
          position: absolute;
          font-size: 32px;
          font-weight: 900;
          pointer-events: none;
          animation: star-catch-popup-rise 0.9s ease-out forwards;
          transform: translateX(-50%);
          text-shadow: 0 2px 8px rgba(0,0,0,0.7);
          z-index: 15;
        }

        .star-catch-popup.positive {
          color: #fbbf24;
          font-size: 36px;
          text-shadow: 0 0 10px rgba(251,191,36,0.4), 0 2px 6px rgba(0,0,0,0.6);
        }

        .star-catch-popup.great {
          color: #fde68a;
          font-size: 44px;
          text-shadow: 0 0 14px rgba(253,230,138,0.6), 0 2px 8px rgba(0,0,0,0.6);
        }

        .star-catch-popup.negative {
          color: #ef4444;
          font-size: 38px;
          text-shadow: 0 0 10px rgba(239,68,68,0.4), 0 2px 6px rgba(0,0,0,0.6);
        }

        .star-catch-popup.text-popup {
          color: #60a5fa;
          font-size: 38px;
          letter-spacing: 3px;
          text-shadow: 0 0 16px rgba(96,165,250,0.7), 0 2px 8px rgba(0,0,0,0.7);
        }

        @keyframes star-catch-popup-rise {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.5); }
          50% { opacity: 1; }
          100% { opacity: 0; transform: translateX(-50%) translateY(-100px) scale(0.6); }
        }
      `}</style>
      {/* FlashOverlay removed — no white blinks */}
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const starCatchModule: MiniGameModule = {
  manifest: {
    id: 'star-catch',
    title: 'Star Catch',
    description: 'Catch falling stars! Combo for Fever Mode!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.1,
    accentColor: '#f59e0b',
  },
  Component: StarCatchGame,
}
