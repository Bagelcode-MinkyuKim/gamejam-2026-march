import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, GAME_EFFECTS_CSS } from '../shared/game-effects'
import starImg from '../../../assets/images/star-catch/star.png'
import goldenStarImg from '../../../assets/images/star-catch/golden-star.png'
import bombImg from '../../../assets/images/star-catch/bomb.png'
import magnetImg from '../../../assets/images/star-catch/magnet.png'
import shieldImg from '../../../assets/images/star-catch/shield.png'
import freezeImg from '../../../assets/images/star-catch/freeze.png'
import timeBonusImg from '../../../assets/images/star-catch/time-bonus.png'
import basketImg from '../../../assets/images/star-catch/basket.png'
import catchSfx from '../../../assets/sounds/star-catch/catch.mp3'
import goldenCatchSfx from '../../../assets/sounds/star-catch/golden-catch.mp3'
import bombHitSfx from '../../../assets/sounds/star-catch/bomb-hit.mp3'
import powerupSfx from '../../../assets/sounds/star-catch/powerup.mp3'
import feverSfx from '../../../assets/sounds/star-catch/fever.mp3'
import comboMilestoneSfx from '../../../assets/sounds/star-catch/combo-milestone.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Game Config ───
const MAX_LIVES = 3

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
const ITEM_SIZE_FREEZE = 52
const ITEM_SIZE_TIME = 48

const BASE_FALL_SPEED = 160
const MAX_FALL_SPEED = 500
const SPEED_INCREASE_PER_POINT = 2.8

const STAR_SCORE = 1
const GOLDEN_STAR_SCORE = 5
const BOMB_PENALTY = 3
const MISS_PENALTY = 1

const SPAWN_INTERVAL_BASE_MS = 580
const SPAWN_INTERVAL_MIN_MS = 180
const SPAWN_INTERVAL_DECREASE_PER_POINT = 6

const GOLDEN_STAR_CHANCE = 0.12
const BOMB_CHANCE = 0.28
const MAGNET_CHANCE = 0.035
const SHIELD_CHANCE = 0.035
const FREEZE_CHANCE = 0.03
const TIME_BONUS_CHANCE = 0.04

const COMBO_FEVER_THRESHOLD = 10
const FEVER_DURATION_MS = 5000
const FEVER_SCORE_MULTIPLIER = 3
const MAGNET_DURATION_MS = 4000
const MAGNET_PULL_SPEED = 320
const SHIELD_DURATION_MS = 6000
const FREEZE_DURATION_MS = 3000
const TIME_BONUS_MS = 3000

const STAR_SHOWER_INTERVAL_MS = 12000
const STAR_SHOWER_COUNT = 8

const WAVE_INTERVAL_MS = 10000

const CATCH_FLASH_DURATION_MS = 180
const MISS_FLASH_DURATION_MS = 250

// ─── Types ───
type ItemKind = 'star' | 'golden' | 'bomb' | 'magnet' | 'shield' | 'freeze' | 'time'

interface FallingItem {
  readonly id: number
  kind: ItemKind
  x: number
  y: number
  size: number
  speed: number
  caught: boolean
  trail: { x: number; y: number; opacity: number }[]
}

interface BgStar {
  x: number
  y: number
  size: number
  speed: number
  opacity: number
  twinklePhase: number
}

interface PixelExplosion {
  id: number
  x: number
  y: number
  age: number
  maxAge: number
  color: string
  pixels: { dx: number; dy: number; vx: number; vy: number; size: number }[]
}

// ─── Helpers ───
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rng(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function computeFallSpeed(score: number): number {
  return clamp(BASE_FALL_SPEED + score * SPEED_INCREASE_PER_POINT, BASE_FALL_SPEED, MAX_FALL_SPEED)
}

function computeSpawnInterval(score: number): number {
  return clamp(SPAWN_INTERVAL_BASE_MS - score * SPAWN_INTERVAL_DECREASE_PER_POINT, SPAWN_INTERVAL_MIN_MS, SPAWN_INTERVAL_BASE_MS)
}

function pickItemKind(isFever: boolean): ItemKind {
  if (isFever) return Math.random() < 0.7 ? 'golden' : 'star'
  const roll = Math.random()
  let t = 0
  t += TIME_BONUS_CHANCE; if (roll < t) return 'time'
  t += FREEZE_CHANCE; if (roll < t) return 'freeze'
  t += MAGNET_CHANCE; if (roll < t) return 'magnet'
  t += SHIELD_CHANCE; if (roll < t) return 'shield'
  t += BOMB_CHANCE; if (roll < t) return 'bomb'
  t += GOLDEN_STAR_CHANCE; if (roll < t) return 'golden'
  return 'star'
}

function itemSize(kind: ItemKind): number {
  const map: Record<ItemKind, number> = { star: ITEM_SIZE_STAR, golden: ITEM_SIZE_GOLDEN, bomb: ITEM_SIZE_BOMB, magnet: ITEM_SIZE_MAGNET, shield: ITEM_SIZE_SHIELD, freeze: ITEM_SIZE_FREEZE, time: ITEM_SIZE_TIME }
  return map[kind]
}

function itemImg(kind: ItemKind): string {
  const map: Record<ItemKind, string> = { star: starImg, golden: goldenStarImg, bomb: bombImg, magnet: magnetImg, shield: shieldImg, freeze: freezeImg, time: timeBonusImg }
  return map[kind]
}

function createItem(id: number, score: number, isFever: boolean, wave: number): FallingItem {
  const kind = pickItemKind(isFever)
  const size = itemSize(kind)
  const margin = size / 2 + 8
  const x = rng(margin, ARENA_WIDTH - margin)
  const speedMul = kind === 'golden' ? 0.85 : kind === 'bomb' ? 1.1 : (kind === 'magnet' || kind === 'shield' || kind === 'freeze' || kind === 'time') ? 0.7 : 1
  const waveMul = 1 + wave * 0.08
  const speed = computeFallSpeed(score) * speedMul * (isFever ? 1.3 : 1) * waveMul
  return { id, kind, x, y: -size, size, speed, caught: false, trail: [] }
}

function createBgStars(count: number): BgStar[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * ARENA_WIDTH,
    y: Math.random() * ARENA_HEIGHT,
    size: rng(1, 3),
    speed: rng(8, 25),
    opacity: rng(0.15, 0.45),
    twinklePhase: Math.random() * Math.PI * 2,
  }))
}

function createPixelExplosion(id: number, x: number, y: number, color: string, count: number): PixelExplosion {
  const pixels = Array.from({ length: count }, () => ({
    dx: 0, dy: 0,
    vx: rng(-120, 120),
    vy: rng(-180, -30),
    size: rng(2, 5),
  }))
  return { id, x, y, age: 0, maxAge: 600, color, pixels }
}

function isItemCaughtByBasket(item: FallingItem, basketX: number): boolean {
  const bLeft = basketX - BASKET_WIDTH / 2
  const bRight = basketX + BASKET_WIDTH / 2
  const bTop = BASKET_Y - BASKET_HEIGHT / 2
  const bBottom = BASKET_Y + BASKET_HEIGHT / 2
  const half = item.size / 2
  return item.x + half > bLeft && item.x - half < bRight && item.y + half > bTop && item.y - half < bBottom
}

// ─── Component ───
function StarCatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [wave, setWave] = useState(0)
  const [lives, setLives] = useState(MAX_LIVES)
  const [basketX, setBasketX] = useState(ARENA_WIDTH / 2)
  const [items, setItems] = useState<FallingItem[]>([])
  const [catchFlash, setCatchFlash] = useState<'good' | 'great' | 'bad' | 'power' | null>(null)
  const [scorePopups, setScorePopups] = useState<{ id: number; value: number; x: number; y: number; text?: string }[]>([])
  const [isFever, setIsFever] = useState(false)
  const [hasMagnet, setHasMagnet] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [isFrozen, setIsFrozen] = useState(false)
  const [pixelExplosions, setPixelExplosions] = useState<PixelExplosion[]>([])
  const [bgStars] = useState(() => createBgStars(50))
  const [bgStarPositions, setBgStarPositions] = useState<BgStar[]>(() => bgStars)

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const waveRef = useRef(0)
  const livesRef = useRef(MAX_LIVES)
  const elapsedMsRef = useRef(0)
  const basketXRef = useRef(ARENA_WIDTH / 2)
  const itemsRef = useRef<FallingItem[]>([])
  const nextItemIdRef = useRef(0)
  const nextPopupIdRef = useRef(0)
  const nextExplosionIdRef = useRef(0)
  const timeSinceLastSpawnRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const arenaRef = useRef<HTMLDivElement | null>(null)
  const catchFlashTimerRef = useRef<number | null>(null)
  const isFeverRef = useRef(false)
  const feverTimerRef = useRef<number | null>(null)
  const hasMagnetRef = useRef(false)
  const magnetTimerRef = useRef<number | null>(null)
  const hasShieldRef = useRef(false)
  const shieldTimerRef = useRef<number | null>(null)
  const isFrozenRef = useRef(false)
  const freezeTimerRef = useRef<number | null>(null)
  const starShowerTimerRef = useRef(0)
  const waveTimerRef = useRef(0)
  const bgStarsRef = useRef(bgStars)
  const pixelExplosionsRef = useRef<PixelExplosion[]>([])
  const globalTimeRef = useRef(0)

  // Audio refs
  const catchAudioRef = useRef<HTMLAudioElement | null>(null)
  const goldenCatchAudioRef = useRef<HTMLAudioElement | null>(null)
  const bombHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const powerupAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboMilestoneAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) { window.clearTimeout(ref.current); ref.current = null }
  }

  const play = useCallback((ref: { current: HTMLAudioElement | null }, vol: number, rate = 1) => {
    const a = ref.current
    if (!a) return
    a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const triggerCatchFlash = useCallback((kind: 'good' | 'great' | 'bad' | 'power') => {
    setCatchFlash(kind)
    clearTimer(catchFlashTimerRef)
    catchFlashTimerRef.current = window.setTimeout(() => { catchFlashTimerRef.current = null; setCatchFlash(null) }, kind === 'bad' ? MISS_FLASH_DURATION_MS : CATCH_FLASH_DURATION_MS)
  }, [])

  const addPopup = useCallback((value: number, x: number, y: number, text?: string) => {
    const id = nextPopupIdRef.current++
    setScorePopups(prev => [...prev, { id, value, x, y, text }])
    window.setTimeout(() => setScorePopups(prev => prev.filter(p => p.id !== id)), 900)
  }, [])

  const spawnExplosion = useCallback((x: number, y: number, color: string, count: number) => {
    const ex = createPixelExplosion(nextExplosionIdRef.current++, x, y, color, count)
    pixelExplosionsRef.current = [...pixelExplosionsRef.current, ex]
  }, [])

  const activateFever = useCallback(() => {
    isFeverRef.current = true; setIsFever(true); clearTimer(feverTimerRef)
    feverTimerRef.current = window.setTimeout(() => { feverTimerRef.current = null; isFeverRef.current = false; setIsFever(false) }, FEVER_DURATION_MS)
  }, [])
  const activateMagnet = useCallback(() => {
    hasMagnetRef.current = true; setHasMagnet(true); clearTimer(magnetTimerRef)
    magnetTimerRef.current = window.setTimeout(() => { magnetTimerRef.current = null; hasMagnetRef.current = false; setHasMagnet(false) }, MAGNET_DURATION_MS)
  }, [])
  const activateShield = useCallback(() => {
    hasShieldRef.current = true; setHasShield(true); clearTimer(shieldTimerRef)
    shieldTimerRef.current = window.setTimeout(() => { shieldTimerRef.current = null; hasShieldRef.current = false; setHasShield(false) }, SHIELD_DURATION_MS)
  }, [])
  const activateFreeze = useCallback(() => {
    isFrozenRef.current = true; setIsFrozen(true); clearTimer(freezeTimerRef)
    freezeTimerRef.current = window.setTimeout(() => { freezeTimerRef.current = null; isFrozenRef.current = false; setIsFrozen(false) }, FREEZE_DURATION_MS)
  }, [])

  const updateBasketFromClient = useCallback((clientX: number) => {
    const arena = arenaRef.current
    if (!arena) return
    const rect = arena.getBoundingClientRect()
    const relativeX = clientX - rect.left
    const arenaScale = ARENA_WIDTH / rect.width
    const nextX = clamp(relativeX * arenaScale, BASKET_WIDTH / 2, ARENA_WIDTH - BASKET_WIDTH / 2)
    basketXRef.current = nextX; setBasketX(nextX)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimer(catchFlashTimerRef); clearTimer(feverTimerRef); clearTimer(magnetTimerRef); clearTimer(shieldTimerRef); clearTimer(freezeTimerRef)
    play(gameOverAudioRef, 0.6, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, elapsedMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, play])

  // Escape key
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit])

  // Audio init
  useEffect(() => {
    const audios: [string, { current: HTMLAudioElement | null }][] = [
      [catchSfx, catchAudioRef], [goldenCatchSfx, goldenCatchAudioRef], [bombHitSfx, bombHitAudioRef],
      [powerupSfx, powerupAudioRef], [feverSfx, feverAudioRef], [comboMilestoneSfx, comboMilestoneAudioRef],
      [gameOverHitSfx, gameOverAudioRef],
    ]
    const els: HTMLAudioElement[] = []
    for (const [src, ref] of audios) {
      const a = new Audio(src); a.preload = 'auto'; ref.current = a; els.push(a)
    }
    return () => {
      clearTimer(catchFlashTimerRef); clearTimer(feverTimerRef); clearTimer(magnetTimerRef); clearTimer(shieldTimerRef); clearTimer(freezeTimerRef)
      for (const a of els) { a.pause(); a.currentTime = 0 }
      for (const [, ref] of audios) ref.current = null
    }
  }, [])

  // Game loop
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      globalTimeRef.current += deltaMs
      const frozen = isFrozenRef.current

      // Timer (freeze pauses timer too)
      if (!frozen) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      }
      setRemainingMs(remainingMsRef.current)

      // Low time tick sound
      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== sec) { lowTimeSecondRef.current = sec; play(catchAudioRef, 0.15, 1.5) }
      } else { lowTimeSecondRef.current = null }

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }

      const deltaSec = deltaMs / 1000
      const currentItems = itemsRef.current
      let scoreChanged = false, comboChanged = false, waveChanged = false
      let nextScore = scoreRef.current, nextCombo = comboRef.current

      // BG stars
      const bgS = bgStarsRef.current
      for (const s of bgS) {
        s.y += s.speed * deltaSec * (frozen ? 0.2 : 1)
        s.twinklePhase += deltaSec * 2
        if (s.y > ARENA_HEIGHT) { s.y = -2; s.x = Math.random() * ARENA_WIDTH }
      }
      setBgStarPositions([...bgS])

      // Difficulty wave
      if (!frozen) {
        waveTimerRef.current += deltaMs
        if (waveTimerRef.current >= WAVE_INTERVAL_MS) {
          waveTimerRef.current -= WAVE_INTERVAL_MS
          waveRef.current += 1; waveChanged = true
        }
      }

      // Star shower
      starShowerTimerRef.current += deltaMs
      if (starShowerTimerRef.current >= STAR_SHOWER_INTERVAL_MS) {
        starShowerTimerRef.current -= STAR_SHOWER_INTERVAL_MS
        for (let i = 0; i < STAR_SHOWER_COUNT; i++) {
          const ni = createItem(nextItemIdRef.current++, scoreRef.current, isFeverRef.current, waveRef.current)
          ni.kind = 'golden'; ni.size = ITEM_SIZE_GOLDEN; ni.speed *= 0.7; ni.x = rng(30, ARENA_WIDTH - 30)
          itemsRef.current = [...itemsRef.current, ni]
        }
        play(comboMilestoneAudioRef, 0.4, 1.2)
        addPopup(0, ARENA_WIDTH / 2, ARENA_HEIGHT / 4, 'STAR SHOWER!')
      }

      // Update pixel explosions
      const exps = pixelExplosionsRef.current
      for (const ex of exps) {
        ex.age += deltaMs
        for (const p of ex.pixels) { p.dx += p.vx * deltaSec; p.dy += p.vy * deltaSec; p.vy += 400 * deltaSec }
      }
      pixelExplosionsRef.current = exps.filter(e => e.age < e.maxAge)
      setPixelExplosions([...pixelExplosionsRef.current])

      // Update items
      for (const item of currentItems) {
        if (item.caught) continue
        const speedMul = frozen ? 0.08 : 1

        // Magnet pull
        if (hasMagnetRef.current && item.kind !== 'bomb') {
          const dx = basketXRef.current - item.x
          if (Math.abs(dx) > 5) {
            item.x = clamp(item.x + (dx / Math.abs(dx)) * MAGNET_PULL_SPEED * deltaSec, item.size / 2, ARENA_WIDTH - item.size / 2)
          }
        }

        item.y += item.speed * deltaSec * speedMul

        // Trail
        item.trail.push({ x: item.x, y: item.y, opacity: 0.5 })
        if (item.trail.length > 4) item.trail.shift()
        for (const t of item.trail) t.opacity -= deltaSec * 3
        item.trail = item.trail.filter(t => t.opacity > 0.05)

        // Catch check
        if (isItemCaughtByBasket(item, basketXRef.current)) {
          item.caught = true
          const px = item.x * (100 / ARENA_WIDTH)
          const py = BASKET_Y * (100 / ARENA_HEIGHT)

          if (item.kind === 'bomb') {
            if (hasShieldRef.current) {
              hasShieldRef.current = false; setHasShield(false); clearTimer(shieldTimerRef)
              triggerCatchFlash('power'); play(powerupAudioRef, 0.5, 0.8)
              addPopup(0, item.x, BASKET_Y, 'BLOCKED!')
              spawnExplosion(item.x, BASKET_Y, '#34d399', 12)
              effects.spawnParticles(6, px, py, ['*', '+', 'o'])
            } else {
              const penalty = Math.min(nextScore, BOMB_PENALTY)
              nextScore = Math.max(0, nextScore - BOMB_PENALTY); nextCombo = 0
              scoreChanged = true; comboChanged = true
              triggerCatchFlash('bad'); play(bombHitAudioRef, 0.55)
              addPopup(-penalty, item.x, BASKET_Y)
              effects.triggerShake(3)
              spawnExplosion(item.x, BASKET_Y, '#ef4444', 16)
              effects.spawnParticles(8, px, py, ['*', 'x', '!'])
            }
          } else if (item.kind === 'magnet') {
            activateMagnet(); triggerCatchFlash('power'); play(powerupAudioRef, 0.5, 1.3)
            addPopup(0, item.x, BASKET_Y, 'MAGNET!'); spawnExplosion(item.x, BASKET_Y, '#3b82f6', 10)
            effects.spawnParticles(6, px, py, ['*', '+'])
          } else if (item.kind === 'shield') {
            activateShield(); triggerCatchFlash('power'); play(powerupAudioRef, 0.5, 1.1)
            addPopup(0, item.x, BASKET_Y, 'SHIELD!'); spawnExplosion(item.x, BASKET_Y, '#34d399', 10)
            effects.spawnParticles(6, px, py, ['*', '+'])
          } else if (item.kind === 'freeze') {
            activateFreeze(); triggerCatchFlash('power'); play(powerupAudioRef, 0.5, 0.7)
            addPopup(0, item.x, BASKET_Y, 'FREEZE!'); spawnExplosion(item.x, BASKET_Y, '#22d3ee', 14)
            effects.spawnParticles(8, px, py, ['*', '+', 'o'])
          } else if (item.kind === 'time') {
            remainingMsRef.current = Math.min(remainingMsRef.current + TIME_BONUS_MS, ROUND_DURATION_MS + 10000)
            triggerCatchFlash('power'); play(powerupAudioRef, 0.5, 1.4)
            addPopup(0, item.x, BASKET_Y, '+3s!'); spawnExplosion(item.x, BASKET_Y, '#4ade80', 10)
            effects.spawnParticles(6, px, py, ['*', '+'])
          } else if (item.kind === 'golden') {
            const fMul = isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1
            const cMul = 1 + Math.floor(nextCombo / 5) * 0.5
            const pts = Math.round(GOLDEN_STAR_SCORE * fMul * cMul)
            nextScore += pts; nextCombo += 1; scoreChanged = true; comboChanged = true
            triggerCatchFlash('great'); play(goldenCatchAudioRef, 0.55, 1.1 + nextCombo * 0.015)
            addPopup(pts, item.x, BASKET_Y); spawnExplosion(item.x, BASKET_Y, '#fbbf24', 12)
            effects.comboHitBurst(px, py, nextCombo, pts, ['*', '+', 'o'])
          } else {
            const fMul = isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1
            const cMul = 1 + Math.floor(nextCombo / 5) * 0.5
            const pts = Math.round(STAR_SCORE * fMul * cMul)
            nextScore += pts; nextCombo += 1; scoreChanged = true; comboChanged = true
            triggerCatchFlash('good'); play(catchAudioRef, 0.45, 1 + nextCombo * 0.008)
            addPopup(pts, item.x, BASKET_Y); spawnExplosion(item.x, BASKET_Y, '#fbbf24', 8)
            effects.spawnParticles(3, px, py, ['*', '+'])
          }

          // Combo milestones: every 5 combo, play sound
          if (nextCombo > 0 && nextCombo % 5 === 0 && nextCombo !== comboRef.current) {
            play(comboMilestoneAudioRef, 0.45, 1 + nextCombo * 0.02)
          }

          // Fever activation
          if (nextCombo >= COMBO_FEVER_THRESHOLD && !isFeverRef.current && nextCombo % COMBO_FEVER_THRESHOLD === 0) {
            activateFever(); play(feverAudioRef, 0.55)
            effects.spawnParticles(15, 50, 50, ['*', '+', 'o', '!', '#'])
            addPopup(0, ARENA_WIDTH / 2, ARENA_HEIGHT / 3, 'FEVER TIME!')
          }
        }

        // Miss: item fell past basket without being caught
        if (!item.caught && item.y > ARENA_HEIGHT + 20) {
          if (item.kind === 'star' || item.kind === 'golden') {
            // Miss penalty: reset combo, lose points
            if (nextCombo > 0) { nextCombo = 0; comboChanged = true }
            const penalty = Math.min(nextScore, MISS_PENALTY)
            if (penalty > 0) { nextScore -= penalty; scoreChanged = true }
          }
        }
      }

      if (scoreChanged) { scoreRef.current = nextScore; setScore(nextScore) }
      if (comboChanged) { comboRef.current = nextCombo; if (nextCombo > maxComboRef.current) maxComboRef.current = nextCombo; setCombo(nextCombo) }
      if (waveChanged) setWave(waveRef.current)

      itemsRef.current = currentItems.filter(item => !item.caught && item.y < ARENA_HEIGHT + 60)

      // Spawn
      timeSinceLastSpawnRef.current += deltaMs
      const spawnInt = computeSpawnInterval(scoreRef.current) * (isFeverRef.current ? 0.6 : 1) * (frozen ? 2 : 1)
      if (timeSinceLastSpawnRef.current >= spawnInt) {
        timeSinceLastSpawnRef.current -= spawnInt
        const ni = createItem(nextItemIdRef.current++, scoreRef.current, isFeverRef.current, waveRef.current)
        itemsRef.current = [...itemsRef.current, ni]
      }

      setItems([...itemsRef.current])
      effects.updateParticles()
      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null; lastFrameAtRef.current = null; effects.cleanup()
    }
  }, [addPopup, finishGame, play, triggerCatchFlash, activateFever, activateMagnet, activateShield, activateFreeze, spawnExplosion])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => { e.preventDefault(); updateBasketFromClient(e.clientX) }, [updateBasketFromClient])
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => { e.preventDefault(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); updateBasketFromClient(e.clientX) }, [updateBasketFromClient])
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => { if (e.touches.length > 0) updateBasketFromClient(e.touches[0].clientX) }, [updateBasketFromClient])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const basketLeftPct = ((basketX - BASKET_WIDTH / 2) / ARENA_WIDTH) * 100
  const basketWidthPct = (BASKET_WIDTH / ARENA_WIDTH) * 100
  const basketTopPct = ((BASKET_Y - BASKET_HEIGHT / 2) / ARENA_HEIGHT) * 100
  const comboColor = combo >= 20 ? '#ff6b6b' : combo >= 10 ? '#fbbf24' : combo >= 5 ? '#60a5fa' : '#94a3b8'

  return (
    <section className="mini-game-panel star-catch-panel" aria-label="star-catch-game" style={{ maxWidth: '432px', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div
        className={`star-catch-arena ${isFever ? 'fever-mode' : ''} ${isFrozen ? 'frozen-mode' : ''} ${catchFlash === 'bad' ? 'miss-flash' : ''}`}
        ref={arenaRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onTouchMove={handleTouchMove} role="presentation"
      >
        {/* Scanline overlay */}
        <div className="star-catch-scanlines" />

        {/* BG stars with twinkle */}
        {bgStarPositions.map((s, i) => (
          <div key={`bg-${i}`} className="star-catch-bg-star" style={{ left: `${(s.x / ARENA_WIDTH) * 100}%`, top: `${(s.y / ARENA_HEIGHT) * 100}%`, width: `${s.size}px`, height: `${s.size}px`, opacity: s.opacity * (0.6 + 0.4 * Math.sin(s.twinklePhase)) }} />
        ))}

        {/* HUD */}
        <div className="star-catch-hud">
          <div className="star-catch-hud-left">
            <p className="star-catch-score pixel-font">{score.toLocaleString()}</p>
            <p className="star-catch-best pixel-font">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
          <div className="star-catch-hud-center">
            {combo >= 3 && <p className="star-catch-combo pixel-font" style={{ color: comboColor }}>{combo}x COMBO</p>}
            {wave > 0 && <p className="star-catch-wave pixel-font">WAVE {wave + 1}</p>}
          </div>
          <div className="star-catch-hud-right">
            <p className={`star-catch-time pixel-font ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
            <div className="star-catch-powerups">
              {hasMagnet && <img src={magnetImg} alt="magnet" className="star-catch-powerup-img" />}
              {hasShield && <img src={shieldImg} alt="shield" className="star-catch-powerup-img" />}
              {isFrozen && <img src={freezeImg} alt="freeze" className="star-catch-powerup-img freeze-pulse" />}
            </div>
          </div>
        </div>

        {/* Fever banner */}
        {isFever && <div className="star-catch-fever-banner pixel-font">FEVER x{FEVER_SCORE_MULTIPLIER}</div>}
        {/* Frozen banner */}
        {isFrozen && <div className="star-catch-freeze-banner pixel-font">FREEZE!</div>}

        {/* Pixel explosions */}
        {pixelExplosions.map(ex => {
          const alpha = 1 - ex.age / ex.maxAge
          return ex.pixels.map((p, pi) => (
            <div key={`ex-${ex.id}-${pi}`} className="star-catch-pixel" style={{
              left: `${((ex.x + p.dx) / ARENA_WIDTH) * 100}%`,
              top: `${((ex.y + p.dy) / ARENA_HEIGHT) * 100}%`,
              width: `${p.size}px`, height: `${p.size}px`,
              background: ex.color, opacity: alpha,
            }} />
          ))
        })}

        {/* Item trails */}
        {items.map(item => item.trail.map((t, ti) => {
          const lp = ((t.x - item.size / 4) / ARENA_WIDTH) * 100
          const tp = ((t.y - item.size / 4) / ARENA_HEIGHT) * 100
          const sp = (item.size * 0.4 / ARENA_WIDTH) * 100
          const c = item.kind === 'golden' ? '#fde68a' : item.kind === 'bomb' ? '#ef4444' : item.kind === 'magnet' ? '#3b82f6' : item.kind === 'shield' ? '#34d399' : item.kind === 'freeze' ? '#22d3ee' : item.kind === 'time' ? '#4ade80' : '#fbbf24'
          return <div key={`tr-${item.id}-${ti}`} className="star-catch-pixel" style={{ left: `${lp}%`, top: `${tp}%`, width: `${sp}%`, aspectRatio: '1', background: c, opacity: t.opacity * 0.6 }} />
        }))}

        {/* Items */}
        {items.map(item => {
          const lp = ((item.x - item.size / 2) / ARENA_WIDTH) * 100
          const tp = ((item.y - item.size / 2) / ARENA_HEIGHT) * 100
          const wp = (item.size / ARENA_WIDTH) * 100
          const hp = (item.size / ARENA_HEIGHT) * 100
          return (
            <div className={`star-catch-item ${item.kind}`} key={item.id} style={{ left: `${lp}%`, top: `${tp}%`, width: `${wp}%`, height: `${hp}%` }}>
              <img src={itemImg(item.kind)} alt={item.kind} className="star-catch-item-img" draggable={false} />
            </div>
          )
        })}

        {/* Score popups */}
        {scorePopups.map(p => (
          <div className={`star-catch-popup pixel-font ${p.text ? 'text-popup' : p.value < 0 ? 'negative' : p.value >= 5 ? 'great' : 'positive'}`} key={p.id} style={{ left: `${(p.x / ARENA_WIDTH) * 100}%`, top: `${(p.y / ARENA_HEIGHT) * 100}%` }}>
            {p.text ? p.text : p.value > 0 ? `+${p.value}` : `${p.value}`}
          </div>
        ))}

        {/* Basket */}
        <div className={`star-catch-basket ${catchFlash ? `flash-${catchFlash}` : ''} ${hasMagnet ? 'magnet-glow' : ''} ${hasShield ? 'shield-glow' : ''} ${isFrozen ? 'frozen-glow' : ''}`}
          style={{ left: `${basketLeftPct}%`, top: `${basketTopPct}%`, width: `${basketWidthPct}%` }}>
          <img src={basketImg} alt="basket" className="star-catch-basket-img" draggable={false} />
        </div>
      </div>

      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .pixel-font {
          font-family: 'Press Start 2P', 'Courier New', monospace;
        }

        .star-catch-panel {
          display: flex; flex-direction: column; width: 100%; height: 100%;
          user-select: none; -webkit-user-select: none; position: relative; padding: 0; gap: 0;
        }

        .star-catch-arena {
          position: relative; width: 100%; flex: 1; min-height: 0;
          background: linear-gradient(180deg, #080810 0%, #0c1020 30%, #101830 60%, #182040 100%);
          overflow: hidden; touch-action: none; image-rendering: pixelated;
        }

        .star-catch-scanlines {
          position: absolute; inset: 0; z-index: 20; pointer-events: none;
          background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.08) 2px, rgba(0,0,0,0.08) 4px);
        }

        .star-catch-arena.fever-mode {
          background: linear-gradient(180deg, #180808 0%, #281410 30%, #382018 60%, #482818 100%);
          animation: fever-bg 0.5s ease-in-out infinite alternate;
        }
        @keyframes fever-bg { from { filter: brightness(1); } to { filter: brightness(1.12); } }

        .star-catch-arena.frozen-mode {
          background: linear-gradient(180deg, #081018 0%, #0c1828 30%, #102038 60%, #183050 100%);
        }

        .star-catch-arena.miss-flash { animation: miss-flash 0.25s ease-out; }
        @keyframes miss-flash {
          0% { box-shadow: inset 0 0 40px rgba(239,68,68,0.3); }
          100% { box-shadow: inset 0 0 0 rgba(239,68,68,0); }
        }

        .star-catch-bg-star {
          position: absolute; background: #fff; pointer-events: none; image-rendering: pixelated;
        }

        .star-catch-pixel {
          position: absolute; pointer-events: none; image-rendering: pixelated;
        }

        .star-catch-hud {
          position: absolute; top: 0; left: 0; right: 0;
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 14px 14px 0; z-index: 10; pointer-events: none;
        }
        .star-catch-hud-left, .star-catch-hud-right { display: flex; flex-direction: column; gap: 4px; }
        .star-catch-hud-center { display: flex; flex-direction: column; align-items: center; gap: 2px; }

        .star-catch-score {
          font-size: clamp(28px, 8vw, 40px); color: #f59e0b; margin: 0; line-height: 1.2;
          text-shadow: 0 2px 0 #b45309, 0 4px 8px rgba(0,0,0,0.5);
        }
        .star-catch-best { font-size: 8px; color: #64748b; margin: 0; }
        .star-catch-combo {
          font-size: clamp(14px, 4vw, 20px); margin: 0; line-height: 1;
          text-shadow: 0 2px 0 rgba(0,0,0,0.5); animation: combo-bounce 0.3s ease-out;
        }
        @keyframes combo-bounce { 0% { transform: scale(1.6); } 40% { transform: scale(0.85); } 100% { transform: scale(1); } }

        .star-catch-wave { font-size: 8px; color: #94a3b8; margin: 0; opacity: 0.7; }

        .star-catch-time {
          font-size: clamp(16px, 5vw, 24px); color: #e2e8f0; margin: 0; text-align: right;
          text-shadow: 0 2px 0 rgba(0,0,0,0.5); transition: color 0.2s;
        }
        .star-catch-time.low-time { color: #ef4444; animation: pulse 0.5s ease-in-out infinite alternate; }
        @keyframes pulse { from { opacity: 1; } to { opacity: 0.5; } }

        .star-catch-powerups { display: flex; gap: 4px; justify-content: flex-end; }
        .star-catch-powerup-img {
          width: 24px; height: 24px; image-rendering: pixelated; object-fit: contain;
          animation: pu-pulse 0.8s ease-in-out infinite alternate;
        }
        .star-catch-powerup-img.freeze-pulse {
          animation: pu-pulse 0.3s ease-in-out infinite alternate;
          filter: drop-shadow(0 0 6px rgba(34,211,238,0.8));
        }
        @keyframes pu-pulse { from { transform: scale(1); } to { transform: scale(1.15); } }

        .star-catch-fever-banner {
          position: absolute; top: 56px; left: 50%; transform: translateX(-50%);
          font-size: 20px; color: #fbbf24; z-index: 11; pointer-events: none; letter-spacing: 2px;
          text-shadow: 0 2px 0 #92400e, 0 0 16px rgba(251,191,36,0.8);
          animation: fever-text 0.6s ease-in-out infinite alternate;
        }
        @keyframes fever-text { from { transform: translateX(-50%) scale(1); } to { transform: translateX(-50%) scale(1.08); } }

        .star-catch-freeze-banner {
          position: absolute; top: 56px; left: 50%; transform: translateX(-50%);
          font-size: 18px; color: #22d3ee; z-index: 11; pointer-events: none; letter-spacing: 3px;
          text-shadow: 0 2px 0 #0e7490, 0 0 16px rgba(34,211,238,0.8);
          animation: freeze-text 0.4s ease-in-out infinite alternate;
        }
        @keyframes freeze-text { from { opacity: 0.7; } to { opacity: 1; } }

        .star-catch-item {
          position: absolute; display: flex; align-items: center; justify-content: center; pointer-events: none;
        }
        .star-catch-item-img {
          width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; pointer-events: none;
        }
        .star-catch-item.star { filter: drop-shadow(0 0 4px rgba(251,191,36,0.5)); animation: star-spin 2.5s linear infinite; }
        @keyframes star-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .star-catch-item.golden { filter: drop-shadow(0 0 10px rgba(253,230,138,0.8)); animation: golden-pulse 0.35s ease-in-out infinite alternate; }
        @keyframes golden-pulse { from { transform: scale(1); } to { transform: scale(1.15); filter: drop-shadow(0 0 16px rgba(253,230,138,1)); } }
        .star-catch-item.bomb { filter: drop-shadow(0 0 6px rgba(239,68,68,0.5)); animation: bomb-wobble 0.35s ease-in-out infinite alternate; }
        @keyframes bomb-wobble { from { transform: rotate(-10deg); } to { transform: rotate(10deg); } }
        .star-catch-item.magnet-item, .star-catch-item.magnet { filter: drop-shadow(0 0 8px rgba(59,130,246,0.6)); animation: pu-float 0.6s ease-in-out infinite alternate; }
        .star-catch-item.shield-item, .star-catch-item.shield { filter: drop-shadow(0 0 8px rgba(52,211,153,0.6)); animation: pu-float 0.6s ease-in-out infinite alternate; }
        .star-catch-item.freeze { filter: drop-shadow(0 0 8px rgba(34,211,238,0.6)); animation: freeze-spin 3s linear infinite; }
        @keyframes freeze-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .star-catch-item.time { filter: drop-shadow(0 0 8px rgba(74,222,128,0.6)); animation: time-bounce 0.5s ease-in-out infinite alternate; }
        @keyframes time-bounce { from { transform: translateY(-3px); } to { transform: translateY(3px); } }
        @keyframes pu-float { from { transform: translateY(-2px) scale(1); } to { transform: translateY(2px) scale(1.08); } }

        .star-catch-basket {
          position: absolute; height: ${(BASKET_HEIGHT / ARENA_HEIGHT) * 100}%;
          display: flex; align-items: center; justify-content: center; transition: none; overflow: visible;
          filter: drop-shadow(0 3px 8px rgba(124,58,237,0.5));
        }
        .star-catch-basket-img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; pointer-events: none; }
        .star-catch-basket.magnet-glow { filter: drop-shadow(0 0 12px rgba(59,130,246,0.7)) drop-shadow(0 3px 8px rgba(59,130,246,0.4)); }
        .star-catch-basket.shield-glow { filter: drop-shadow(0 0 12px rgba(52,211,153,0.7)) drop-shadow(0 3px 8px rgba(52,211,153,0.4)); }
        .star-catch-basket.frozen-glow { filter: drop-shadow(0 0 12px rgba(34,211,238,0.7)) drop-shadow(0 3px 8px rgba(34,211,238,0.4)); }
        .star-catch-basket.flash-good { filter: drop-shadow(0 0 10px rgba(251,191,36,0.6)); }
        .star-catch-basket.flash-great { filter: drop-shadow(0 0 16px rgba(253,230,138,1)); animation: great-flash 0.2s ease-out; }
        .star-catch-basket.flash-bad { filter: drop-shadow(0 0 12px rgba(239,68,68,0.7)); animation: basket-shake 0.25s ease-out; }
        .star-catch-basket.flash-power { filter: drop-shadow(0 0 16px rgba(96,165,250,0.8)); animation: great-flash 0.25s ease-out; }
        @keyframes great-flash { 0% { transform: scale(1.15); } 100% { transform: scale(1); } }
        @keyframes basket-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-3px); } }

        .star-catch-popup {
          position: absolute; font-size: 16px; pointer-events: none;
          animation: popup-rise 0.9s ease-out forwards; transform: translateX(-50%);
          text-shadow: 0 2px 0 rgba(0,0,0,0.8); z-index: 15;
        }
        .star-catch-popup.positive { color: #fbbf24; font-size: 18px; }
        .star-catch-popup.great { color: #fde68a; font-size: 22px; }
        .star-catch-popup.negative { color: #ef4444; font-size: 20px; }
        .star-catch-popup.text-popup { color: #60a5fa; font-size: 16px; letter-spacing: 2px; }
        @keyframes popup-rise {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.4); }
          50% { opacity: 1; }
          100% { opacity: 0; transform: translateX(-50%) translateY(-80px) scale(0.6); }
        }
      `}</style>
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
