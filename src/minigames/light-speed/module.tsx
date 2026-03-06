import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// ─── Sounds ──────────────────────────────────────────────
import tapSfx from '../../../assets/sounds/light-speed-tap.mp3'
import perfectSfx from '../../../assets/sounds/light-speed-perfect.mp3'
import goldenSfx from '../../../assets/sounds/light-speed-golden.mp3'
import missSfx from '../../../assets/sounds/light-speed-miss.mp3'
import feverSfx from '../../../assets/sounds/light-speed-fever.mp3'
import levelUpSfx from '../../../assets/sounds/light-speed-level-up.mp3'
import comboBreakSfx from '../../../assets/sounds/light-speed-combo-break.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Game Constants ──────────────────────────────────────
const ROUND_DURATION_MS = 90_000
const INITIAL_HP = 5
const MAX_HP = 5

const FAST_TAP_THRESHOLD_MS = 350
const FAST_TAP_SCORE = 3
const NORMAL_TAP_SCORE = 1

const INITIAL_SPAWN_INTERVAL_MS = 1600
const MIN_SPAWN_INTERVAL_MS = 350
const SPAWN_ACCELERATION = 0.93

const INITIAL_CIRCLE_LIFETIME_MS = 2200
const MIN_CIRCLE_LIFETIME_MS = 700
const LIFETIME_SHRINK_FACTOR = 0.965

const INITIAL_CIRCLE_SIZE = 72
const MIN_CIRCLE_SIZE = 32
const SIZE_SHRINK_FACTOR = 0.988

const MAX_ACTIVE_CIRCLES = 10
const COMBO_DECAY_MS = 2500
const ARENA_PADDING = 0.06

// Golden target
const GOLDEN_SPAWN_INTERVAL = 7
const GOLDEN_SCORE_MULTIPLIER = 3
const GOLDEN_TIME_BONUS_MS = 2000

// Bomb target
const BOMB_SPAWN_INTERVAL = 12

// HP recovery
const HP_RECOVERY_SPAWN_INTERVAL = 18

// Freeze circle: freezes all circles for a few seconds
const FREEZE_SPAWN_INTERVAL = 25
const FREEZE_DURATION_MS = 3000

// Fever mode
const FEVER_COMBO_THRESHOLD = 15
const FEVER_DURATION_MS = 6000
const FEVER_SCORE_MULTIPLIER = 2

// Level system
const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 800, 1200, 1800] as const
const LEVEL_NAMES = ['Spark', 'Flash', 'Bolt', 'Thunder', 'Storm', 'Lightning', 'Nova', 'GODSPEED'] as const

// Multi-tap bonus
const MULTI_TAP_WINDOW_MS = 600
const MULTI_TAP_MIN = 3
const MULTI_TAP_BONUS_PER = 2

// Chain lightning: auto-collect all circles after N rapid taps
const CHAIN_LIGHTNING_TAP_COUNT = 5
const CHAIN_LIGHTNING_WINDOW_MS = 1200

// Rush time: last N seconds with boosted spawn/score
const RUSH_TIME_THRESHOLD_MS = 15000
const RUSH_SPAWN_MULTIPLIER = 0.5
const RUSH_SCORE_MULTIPLIER = 1.5

// Super size buff
const SUPER_SIZE_SPAWN_INTERVAL = 30
const SUPER_SIZE_DURATION_MS = 5000
const SUPER_SIZE_SCALE = 1.5

// ─── Types ───────────────────────────────────────────────
type CircleType = 'normal' | 'golden' | 'hp-recovery' | 'bomb' | 'freeze' | 'super-size'

interface LightCircle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly size: number
  readonly lifetimeMs: number
  readonly spawnedAtMs: number
  readonly color: string
  readonly type: CircleType
}

interface RippleEffect {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly color: string
}

const CIRCLE_COLORS = [
  '#fbbf24', '#f97316', '#ef4444', '#ec4899', '#a855f7',
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16',
] as const

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function pickRandomColor(): string {
  return CIRCLE_COLORS[Math.floor(Math.random() * CIRCLE_COLORS.length)]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getLevel(score: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= LEVEL_THRESHOLDS[i]) return i
  }
  return 0
}

// ─── Component ───────────────────────────────────────────
function LightSpeedGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [hp, setHp] = useState(INITIAL_HP)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [circles, setCircles] = useState<LightCircle[]>([])
  const [popEffects, setPopEffects] = useState<{ id: number; x: number; y: number; text: string; color: string }[]>([])
  const [ripples, setRipples] = useState<RippleEffect[]>([])
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [bgHue, setBgHue] = useState(220)
  const [isFrozen, setIsFrozen] = useState(false)
  const [isRushTime, setIsRushTime] = useState(false)
  const [isSuperSize, setIsSuperSize] = useState(false)
  const [chainLightningActive, setChainLightningActive] = useState(false)

  const effects = useGameEffects()

  // Refs for game loop
  const scoreRef = useRef(0)
  const hpRef = useRef(INITIAL_HP)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const lastTapAtMsRef = useRef(0)
  const circlesRef = useRef<LightCircle[]>([])
  const nextCircleIdRef = useRef(0)
  const nextPopIdRef = useRef(0)
  const nextRippleIdRef = useRef(0)
  const spawnIntervalMsRef = useRef(INITIAL_SPAWN_INTERVAL_MS)
  const circleLifetimeMsRef = useRef(INITIAL_CIRCLE_LIFETIME_MS)
  const circleSizeRef = useRef(INITIAL_CIRCLE_SIZE)
  const timeSinceLastSpawnRef = useRef(0)
  const totalSpawnedRef = useRef(0)
  const levelRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverEndAtRef = useRef(0)
  const multiTapTimesRef = useRef<number[]>([])
  const chainTapTimesRef = useRef<number[]>([])
  const frozenUntilRef = useRef(0)
  const superSizeUntilRef = useRef(0)
  const rushTimeTriggeredRef = useRef(false)

  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const elapsedMsRef = useRef(0)
  const arenaRef = useRef<HTMLDivElement | null>(null)

  // Audio refs
  const audioMapRef = useRef<Record<string, HTMLAudioElement | null>>({})

  const playAudio = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioMapRef.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = clamp(volume, 0, 1)
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  // ── Spawn circle ───────────────────────────────────────
  const spawnCircle = useCallback((elapsedMs: number) => {
    if (circlesRef.current.length >= MAX_ACTIVE_CIRCLES) return

    const baseSize = circleSizeRef.current
    const sizeScale = superSizeUntilRef.current > elapsedMs ? SUPER_SIZE_SCALE : 1
    const size = baseSize * sizeScale
    const halfNorm = (size / 2) / 300
    const x = randomBetween(ARENA_PADDING + halfNorm, 1 - ARENA_PADDING - halfNorm)
    const y = randomBetween(ARENA_PADDING + halfNorm, 1 - ARENA_PADDING - halfNorm)

    const spawnCount = totalSpawnedRef.current + 1

    // Determine circle type by priority
    let circleType: CircleType = 'normal'
    let color = pickRandomColor()
    let circleSize = size

    if (spawnCount % SUPER_SIZE_SPAWN_INTERVAL === 0) {
      circleType = 'super-size'
      color = '#06b6d4'
      circleSize = size * 1.2
    } else if (spawnCount % FREEZE_SPAWN_INTERVAL === 0) {
      circleType = 'freeze'
      color = '#67e8f9'
      circleSize = size * 1.15
    } else if (spawnCount % GOLDEN_SPAWN_INTERVAL === 0) {
      circleType = 'golden'
      color = '#fbbf24'
      circleSize = size * 1.25
    } else if (spawnCount % BOMB_SPAWN_INTERVAL === 0) {
      circleType = 'bomb'
      color = '#1f2937'
      circleSize = size * 1.1
    } else if (spawnCount % HP_RECOVERY_SPAWN_INTERVAL === 0) {
      circleType = 'hp-recovery'
      color = '#22c55e'
      circleSize = size * 1.1
    }

    const circle: LightCircle = {
      id: nextCircleIdRef.current,
      x, y,
      size: circleSize,
      lifetimeMs: circleLifetimeMsRef.current,
      spawnedAtMs: elapsedMs,
      color,
      type: circleType,
    }

    nextCircleIdRef.current += 1
    totalSpawnedRef.current += 1
    circlesRef.current = [...circlesRef.current, circle]
    setCircles(circlesRef.current)
  }, [])

  // ── Effects helpers ────────────────────────────────────
  const addPopEffect = useCallback((x: number, y: number, text: string, color: string) => {
    const popId = nextPopIdRef.current++
    setPopEffects((prev) => [...prev, { id: popId, x, y, text, color }])
    window.setTimeout(() => {
      setPopEffects((prev) => prev.filter((p) => p.id !== popId))
    }, 700)
  }, [])

  const addRipple = useCallback((x: number, y: number, color: string) => {
    const ripId = nextRippleIdRef.current++
    setRipples((prev) => [...prev, { id: ripId, x, y, color }])
    window.setTimeout(() => {
      setRipples((prev) => prev.filter((r) => r.id !== ripId))
    }, 500)
  }, [])

  const activateFever = useCallback(() => {
    isFeverRef.current = true
    feverEndAtRef.current = elapsedMsRef.current + FEVER_DURATION_MS
    setIsFever(true)
    setFeverRemainingMs(FEVER_DURATION_MS)
    playAudio('fever', 0.7)
    effects.triggerFlash('rgba(251,191,36,0.5)', 200)
    effects.triggerShake(8, 200)
    addPopEffect(0.5, 0.3, 'FEVER MODE!', '#fbbf24')
  }, [playAudio, effects, addPopEffect])

  // ── Chain Lightning: auto-collect all normal circles ───
  const triggerChainLightning = useCallback(() => {
    setChainLightningActive(true)
    window.setTimeout(() => setChainLightningActive(false), 400)

    const arenaW = arenaRef.current?.clientWidth ?? 300
    const arenaH = arenaRef.current?.clientHeight ?? 500
    let bonus = 0
    const surviving: LightCircle[] = []

    for (const circle of circlesRef.current) {
      if (circle.type === 'bomb') {
        surviving.push(circle)
        continue
      }
      const tapScore = 2 * (isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1)
      bonus += tapScore
      addRipple(circle.x, circle.y, '#06b6d4')
      effects.spawnParticles(2, circle.x * arenaW, circle.y * arenaH, ['⚡'], 'circle')
    }

    if (bonus > 0) {
      scoreRef.current += bonus
      setScore(scoreRef.current)
      addPopEffect(0.5, 0.4, `CHAIN LIGHTNING! +${bonus}`, '#06b6d4')
      effects.triggerFlash('rgba(6,182,212,0.5)', 200)
      effects.triggerShake(6, 150)
      playAudio('perfect', 0.7, 1.3)
    }

    circlesRef.current = surviving
    setCircles(surviving)
    chainTapTimesRef.current = []
  }, [addPopEffect, addRipple, effects, playAudio])

  // ── Finish ─────────────────────────────────────────────
  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    playAudio('gameover', 0.7, 0.95)
    effects.cleanup()

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio, effects])

  // ── Handle tap ─────────────────────────────────────────
  const handleCircleTap = useCallback((circleId: number) => {
    if (finishedRef.current) return

    const targetIndex = circlesRef.current.findIndex((c) => c.id === circleId)
    if (targetIndex === -1) return

    const target = circlesRef.current[targetIndex]
    const now = elapsedMsRef.current
    const circleAge = now - target.spawnedAtMs
    const isFastTap = circleAge <= FAST_TAP_THRESHOLD_MS

    // Ripple + remove
    addRipple(target.x, target.y, target.color)
    circlesRef.current = circlesRef.current.filter((c) => c.id !== circleId)
    setCircles(circlesRef.current)

    const arenaW = arenaRef.current?.clientWidth ?? 300
    const arenaH = arenaRef.current?.clientHeight ?? 500
    const effectX = target.x * arenaW
    const effectY = target.y * arenaH

    // Always refresh combo timer on any tap (fixes HP recovery combo bug)
    lastTapAtMsRef.current = now

    // Chain lightning tracking (for normal/golden/fast taps)
    if (target.type !== 'bomb') {
      chainTapTimesRef.current.push(now)
      chainTapTimesRef.current = chainTapTimesRef.current.filter((t) => now - t < CHAIN_LIGHTNING_WINDOW_MS)
      if (chainTapTimesRef.current.length >= CHAIN_LIGHTNING_TAP_COUNT) {
        triggerChainLightning()
        return
      }
    }

    // ── Bomb: penalty ──
    if (target.type === 'bomb') {
      hpRef.current = Math.max(0, hpRef.current - 1)
      setHp(hpRef.current)
      comboRef.current = 0
      setCombo(0)
      addPopEffect(target.x, target.y, 'BOMB! -1HP', '#ef4444')
      effects.triggerShake(12, 200)
      effects.triggerFlash('rgba(239,68,68,0.5)', 150)
      playAudio('miss', 0.6, 0.8)
      playAudio('combobreak', 0.5)
      if (hpRef.current <= 0) { finishGame(); return }
      return
    }

    // ── Freeze ──
    if (target.type === 'freeze') {
      frozenUntilRef.current = now + FREEZE_DURATION_MS
      setIsFrozen(true)
      addPopEffect(target.x, target.y, 'FREEZE!', '#67e8f9')
      effects.triggerFlash('rgba(103,232,249,0.4)', 150)
      effects.spawnParticles(6, effectX, effectY, ['❄️', '🧊', '✨'])
      playAudio('golden', 0.6, 0.8)
      // Still give combo
      comboRef.current += 1
      setCombo(comboRef.current)
      return
    }

    // ── Super Size ──
    if (target.type === 'super-size') {
      superSizeUntilRef.current = now + SUPER_SIZE_DURATION_MS
      setIsSuperSize(true)
      addPopEffect(target.x, target.y, 'SUPER SIZE!', '#06b6d4')
      effects.triggerFlash('rgba(6,182,212,0.3)', 120)
      effects.spawnParticles(6, effectX, effectY, ['💎', '🔮', '✨'])
      playAudio('levelup', 0.6, 1.1)
      comboRef.current += 1
      setCombo(comboRef.current)
      return
    }

    // ── HP recovery ──
    if (target.type === 'hp-recovery') {
      if (hpRef.current < MAX_HP) {
        hpRef.current = Math.min(MAX_HP, hpRef.current + 1)
        setHp(hpRef.current)
      }
      comboRef.current += 1
      setCombo(comboRef.current)
      addPopEffect(target.x, target.y, '+1 HP', '#22c55e')
      effects.triggerFlash('rgba(34,197,94,0.3)', 80)
      effects.spawnParticles(5, effectX, effectY, ['💚', '❤️', '✨'])
      playAudio('golden', 0.5, 1.2)
      return
    }

    // ── Normal / Golden scoring ──
    const goldenMult = target.type === 'golden' ? GOLDEN_SCORE_MULTIPLIER : 1
    const feverMult = isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1
    const rushMult = remainingMsRef.current <= RUSH_TIME_THRESHOLD_MS ? RUSH_SCORE_MULTIPLIER : 1
    const baseTapScore = isFastTap ? FAST_TAP_SCORE : NORMAL_TAP_SCORE
    const comboBonus = Math.floor(comboRef.current / 5)
    const totalTapScore = Math.round((baseTapScore + comboBonus) * goldenMult * feverMult * rushMult)

    scoreRef.current += totalTapScore
    setScore(scoreRef.current)

    // Golden time bonus
    if (target.type === 'golden') {
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + GOLDEN_TIME_BONUS_MS)
      setRemainingMs(remainingMsRef.current)
    }

    // Combo
    const nextCombo = comboRef.current + 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    // Multi-tap tracking
    multiTapTimesRef.current.push(now)
    multiTapTimesRef.current = multiTapTimesRef.current.filter((t) => now - t < MULTI_TAP_WINDOW_MS)
    if (multiTapTimesRef.current.length >= MULTI_TAP_MIN) {
      const multiBonus = multiTapTimesRef.current.length * MULTI_TAP_BONUS_PER
      scoreRef.current += multiBonus
      setScore(scoreRef.current)
      addPopEffect(0.5, 0.15, `MULTI x${multiTapTimesRef.current.length}! +${multiBonus}`, '#06b6d4')
      effects.triggerFlash('rgba(6,182,212,0.3)', 60)
      multiTapTimesRef.current = []
    }

    // Level check
    const newLevel = getLevel(scoreRef.current)
    if (newLevel > levelRef.current) {
      levelRef.current = newLevel
      setLevel(newLevel)
      playAudio('levelup', 0.6)
      addPopEffect(0.5, 0.2, `Level: ${LEVEL_NAMES[newLevel]}!`, '#a855f7')
      effects.triggerFlash('rgba(168,85,247,0.4)', 150)
      effects.triggerShake(5, 120)
    }

    // Fever activation
    if (!isFeverRef.current && nextCombo >= FEVER_COMBO_THRESHOLD && nextCombo % FEVER_COMBO_THRESHOLD === 0) {
      activateFever()
    }

    // Score popup
    const scoreText = target.type === 'golden'
      ? `+${totalTapScore} GOLD! +2s`
      : isFastTap
        ? `+${totalTapScore} FAST!`
        : `+${totalTapScore}`

    const popColor = target.type === 'golden'
      ? '#fbbf24'
      : isFastTap ? '#06b6d4' : '#ffffff'

    addPopEffect(target.x, target.y, scoreText, popColor)

    // Visual + audio
    if (target.type === 'golden') {
      effects.comboHitBurst(effectX, effectY, nextCombo, totalTapScore, ['💎', '⭐', '✨', '🌟'])
      playAudio('golden', 0.7, 1.1)
    } else if (isFastTap) {
      effects.comboHitBurst(effectX, effectY, nextCombo, totalTapScore)
      playAudio('perfect', 0.6, 1 + Math.min(0.4, nextCombo * 0.02))
    } else {
      effects.spawnParticles(3, effectX, effectY)
      effects.showScorePopup(totalTapScore, effectX, effectY)
      playAudio('tap', 0.5, 1 + Math.min(0.3, nextCombo * 0.015))
    }

    // Background hue shift
    if (nextCombo > 0 && nextCombo % 5 === 0) {
      setBgHue((prev) => (prev + 20) % 360)
    }
  }, [addPopEffect, addRipple, playAudio, effects, finishGame, activateFever, triggerChainLightning])

  const handleExit = useCallback(() => onExit(), [onExit])

  // ── Keyboard ───────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); handleExit() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  // ── Audio preload ──────────────────────────────────────
  useEffect(() => {
    const sources: Record<string, string> = {
      tap: tapSfx, perfect: perfectSfx, golden: goldenSfx,
      miss: missSfx, fever: feverSfx, levelup: levelUpSfx,
      combobreak: comboBreakSfx, gameover: gameOverHitSfx,
    }
    for (const [key, src] of Object.entries(sources)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioMapRef.current[key] = audio
    }
    return () => {
      effects.cleanup()
      for (const audio of Object.values(audioMapRef.current)) {
        if (audio) { audio.pause(); audio.src = '' }
      }
      audioMapRef.current = {}
    }
  }, [])

  // ── Game Loop ──────────────────────────────────────────
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      effects.updateParticles()

      // Fever timer update
      if (isFeverRef.current) {
        const remaining = feverEndAtRef.current - elapsedMsRef.current
        if (remaining <= 0) {
          isFeverRef.current = false
          setIsFever(false)
          setFeverRemainingMs(0)
        } else {
          setFeverRemainingMs(remaining)
        }
      }

      // Freeze expiry
      if (frozenUntilRef.current > 0 && elapsedMsRef.current >= frozenUntilRef.current) {
        frozenUntilRef.current = 0
        setIsFrozen(false)
      }

      // Super size expiry
      if (superSizeUntilRef.current > 0 && elapsedMsRef.current >= superSizeUntilRef.current) {
        superSizeUntilRef.current = 0
        setIsSuperSize(false)
      }

      // Rush time trigger
      if (!rushTimeTriggeredRef.current && remainingMsRef.current <= RUSH_TIME_THRESHOLD_MS) {
        rushTimeTriggeredRef.current = true
        setIsRushTime(true)
        addPopEffect(0.5, 0.35, 'RUSH TIME! x1.5', '#ef4444')
        effects.triggerFlash('rgba(239,68,68,0.4)', 200)
        effects.triggerShake(6, 150)
        playAudio('fever', 0.5, 1.3)
      }

      // Combo decay
      if (elapsedMsRef.current - lastTapAtMsRef.current > COMBO_DECAY_MS && comboRef.current > 0) {
        if (comboRef.current >= 5) playAudio('combobreak', 0.3)
        comboRef.current = 0
        setCombo(0)
      }

      // Spawn (rush time doubles spawn rate)
      const isFrozenNow = frozenUntilRef.current > elapsedMsRef.current
      timeSinceLastSpawnRef.current += deltaMs
      const rushSpawnMult = remainingMsRef.current <= RUSH_TIME_THRESHOLD_MS ? RUSH_SPAWN_MULTIPLIER : 1
      if (timeSinceLastSpawnRef.current >= spawnIntervalMsRef.current * rushSpawnMult) {
        timeSinceLastSpawnRef.current = 0
        spawnCircle(elapsedMsRef.current)
        spawnIntervalMsRef.current = Math.max(MIN_SPAWN_INTERVAL_MS, spawnIntervalMsRef.current * SPAWN_ACCELERATION)
        circleLifetimeMsRef.current = Math.max(MIN_CIRCLE_LIFETIME_MS, circleLifetimeMsRef.current * LIFETIME_SHRINK_FACTOR)
        circleSizeRef.current = Math.max(MIN_CIRCLE_SIZE, circleSizeRef.current * SIZE_SHRINK_FACTOR)
      }

      // Expired circles → HP loss (freeze pauses lifetime)
      let hpChanged = false
      const currentElapsed = elapsedMsRef.current
      const surviving = circlesRef.current.filter((circle) => {
        const age = currentElapsed - circle.spawnedAtMs
        const effectiveLifetime = isFrozenNow ? circle.lifetimeMs + FREEZE_DURATION_MS : circle.lifetimeMs
        if (age >= effectiveLifetime) {
          if (circle.type !== 'bomb') {
            hpRef.current = Math.max(0, hpRef.current - 1)
            hpChanged = true
          }
          return false
        }
        return true
      })

      if (surviving.length !== circlesRef.current.length) {
        circlesRef.current = surviving
        setCircles(surviving)
      }

      if (hpChanged) {
        setHp(hpRef.current)
        playAudio('miss', 0.5, 1.1)
        effects.triggerShake(7)
        effects.triggerFlash('rgba(239,68,68,0.4)')
        if (hpRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      }

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }

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
  }, [finishGame, playAudio, spawnCircle, effects, addPopEffect])

  // ── Derived state ──────────────────────────────────────
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= 10000
  const isLowHp = hp <= 1
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const feverProgress = isFever ? clamp(feverRemainingMs / FEVER_DURATION_MS, 0, 1) : 0

  const hpHearts = useMemo(() => {
    const hearts: string[] = []
    for (let i = 0; i < MAX_HP; i++) hearts.push(i < hp ? '\u2764' : '\u2661')
    return hearts
  }, [hp])

  return (
    <section
      className="mini-game-panel light-speed-panel"
      aria-label="light-speed-game"
      style={{
        maxWidth: '432px',
        width: '100%',
        height: '100%',
        margin: '0 auto',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        ...effects.getShakeStyle(),
      }}
    >
      <style>{`
        ${GAME_EFFECTS_CSS}

        .light-speed-panel {
          user-select: none;
          -webkit-user-select: none;
          background: linear-gradient(180deg, #0f172a 0%, #1e293b 100%);
        }

        .ls-hud {
          display: flex;
          flex-direction: column;
          gap: 3px;
          padding: 8px 12px 4px;
          flex-shrink: 0;
          z-index: 5;
        }

        .ls-hud-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .ls-score {
          font-size: clamp(24px, 6vw, 32px);
          font-weight: 900;
          color: #fbbf24;
          margin: 0;
          text-shadow: 0 2px 8px rgba(251,191,36,0.5);
          transition: color 0.2s;
        }

        .ls-score.fever {
          animation: ls-fever-pulse 0.3s ease-in-out infinite alternate;
          color: #ff6b35;
          text-shadow: 0 2px 12px rgba(255,107,53,0.8);
        }

        .ls-score.rush {
          color: #ef4444;
          text-shadow: 0 2px 12px rgba(239,68,68,0.8);
        }

        .ls-best {
          font-size: 11px;
          color: #9ca3af;
          margin: 0;
        }

        .ls-hp { margin: 0; font-size: clamp(16px, 4vw, 22px); letter-spacing: 3px; }
        .ls-hp.low { animation: ls-hp-blink 0.4s ease-in-out infinite; }
        .ls-heart-full { color: #ef4444; text-shadow: 0 0 8px rgba(239,68,68,0.7); }
        .ls-heart-empty { color: #374151; }

        .ls-time {
          font-size: clamp(12px, 3vw, 15px);
          color: #d1d5db;
          margin: 0;
          font-variant-numeric: tabular-nums;
          font-weight: 700;
        }
        .ls-time.low-time { color: #ef4444; animation: ls-blink 0.5s ease-in-out infinite; }

        .ls-combo-row { display: flex; align-items: center; gap: 8px; }
        .ls-combo { font-size: 11px; color: #c084fc; margin: 0; }
        .ls-combo strong { font-size: clamp(14px, 3.5vw, 18px); color: #e9d5ff; }

        .ls-status-badges { display: flex; gap: 4px; align-items: center; }
        .ls-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: 6px;
          line-height: 1.3;
        }
        .ls-badge-level { color: #a78bfa; background: rgba(139,92,246,0.15); }
        .ls-badge-rush { color: #ef4444; background: rgba(239,68,68,0.15); animation: ls-blink 0.5s ease-in-out infinite; }
        .ls-badge-frozen { color: #67e8f9; background: rgba(103,232,249,0.15); }
        .ls-badge-super { color: #06b6d4; background: rgba(6,182,212,0.15); }

        .ls-fever-bar {
          height: 3px;
          background: rgba(251,191,36,0.15);
          border-radius: 2px;
          overflow: hidden;
          flex-shrink: 0;
        }
        .ls-fever-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, #fbbf24, #ff6b35);
          transition: width 0.15s linear;
          border-radius: 2px;
        }

        .ls-arena {
          position: relative;
          flex: 1;
          width: 100%;
          overflow: hidden;
          touch-action: manipulation;
        }

        .ls-arena-bg {
          position: absolute;
          inset: 0;
          transition: background 0.5s ease;
          pointer-events: none;
        }

        .ls-arena.fever .ls-arena-bg { animation: ls-fever-bg 0.5s ease-in-out infinite alternate; }
        .ls-arena.rush { border: 2px solid rgba(239,68,68,0.3); animation: ls-rush-border 0.8s ease-in-out infinite alternate; }
        .ls-arena.frozen .ls-arena-bg { background: rgba(103,232,249,0.05) !important; }
        .ls-arena.chain-flash { animation: ls-chain-flash 0.4s ease-out; }

        .ls-circle {
          position: absolute;
          border: none;
          border-radius: 50%;
          background: transparent;
          cursor: pointer;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.04s ease-out;
          z-index: 2;
        }
        .ls-circle:active { transform: translate(-50%, -50%) scale(0.8) !important; }

        .ls-glow {
          position: absolute;
          width: 55%;
          height: 55%;
          border-radius: 50%;
          filter: blur(4px);
        }

        .ls-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 3px solid;
          box-sizing: border-box;
          pointer-events: none;
        }

        .ls-circle-label {
          position: absolute;
          font-weight: 900;
          pointer-events: none;
          z-index: 3;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }

        .ls-pop {
          position: absolute;
          transform: translate(-50%, -50%);
          font-size: clamp(14px, 3.5vw, 18px);
          font-weight: 900;
          pointer-events: none;
          z-index: 10;
          animation: ls-pop-up 0.7s ease-out forwards;
          text-shadow: 0 2px 6px rgba(0,0,0,0.7);
        }

        .ls-ripple {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          z-index: 1;
          animation: ls-ripple-expand 0.5s ease-out forwards;
        }

        .ls-bg-particle {
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
          opacity: 0.15;
          animation: ls-float-particle linear infinite;
        }

        @keyframes ls-pop-up {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1.4); }
          100% { opacity: 0; transform: translate(-50%, -150%) scale(0.7); }
        }

        @keyframes ls-ripple-expand {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0.8; }
          100% { transform: translate(-50%, -50%) scale(3); opacity: 0; }
        }

        @keyframes ls-float-particle {
          0% { transform: translateY(0) rotate(0deg); opacity: 0.15; }
          50% { opacity: 0.25; }
          100% { transform: translateY(-100vh) rotate(360deg); opacity: 0; }
        }

        @keyframes ls-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        @keyframes ls-hp-blink {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.15); }
        }

        @keyframes ls-fever-pulse {
          0% { transform: scale(1); }
          100% { transform: scale(1.05); text-shadow: 0 2px 16px rgba(255,107,53,1); }
        }

        @keyframes ls-fever-bg {
          0% { background: rgba(251,191,36,0.06); }
          100% { background: rgba(255,107,53,0.1); }
        }

        @keyframes ls-rush-border {
          0% { border-color: rgba(239,68,68,0.2); }
          100% { border-color: rgba(239,68,68,0.6); }
        }

        @keyframes ls-chain-flash {
          0% { background: rgba(6,182,212,0.3); }
          100% { background: transparent; }
        }

        @keyframes ls-bomb-pulse {
          0%, 100% { box-shadow: 0 0 8px rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 20px rgba(239,68,68,0.8); }
        }

        @keyframes ls-golden-sparkle {
          0%, 100% { box-shadow: 0 0 8px rgba(251,191,36,0.5); }
          50% { box-shadow: 0 0 24px rgba(251,191,36,1), 0 0 48px rgba(251,191,36,0.3); }
        }

        @keyframes ls-freeze-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(103,232,249,0.5); }
          50% { box-shadow: 0 0 20px rgba(103,232,249,0.9); }
        }

        @keyframes ls-super-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(6,182,212,0.4); }
          50% { box-shadow: 0 0 20px rgba(6,182,212,0.8); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* ── HUD ── */}
      <div className="ls-hud">
        <div className="ls-hud-row">
          <p className={`ls-score ${isFever ? 'fever' : isRushTime ? 'rush' : ''}`}>{score.toLocaleString()}</p>
          <p className="ls-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="ls-hud-row">
          <p className={`ls-hp ${isLowHp ? 'low' : ''}`}>
            {hpHearts.map((heart, i) => (
              <span key={i} className={i < hp ? 'ls-heart-full' : 'ls-heart-empty'}>{heart}</span>
            ))}
          </p>
          <p className={`ls-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
        </div>
        <div className="ls-hud-row">
          <div className="ls-combo-row">
            <p className="ls-combo">COMBO <strong>{combo}</strong></p>
            {comboLabel && (
              <p className="ge-combo-label" style={{ fontSize: '13px', color: comboColor, margin: 0 }}>{comboLabel}</p>
            )}
          </div>
          <div className="ls-status-badges">
            <span className="ls-badge ls-badge-level">{LEVEL_NAMES[level]}</span>
            {isRushTime && <span className="ls-badge ls-badge-rush">RUSH</span>}
            {isFrozen && <span className="ls-badge ls-badge-frozen">FREEZE</span>}
            {isSuperSize && <span className="ls-badge ls-badge-super">BIG</span>}
          </div>
        </div>
        {isFever && (
          <div className="ls-fever-bar">
            <div className="ls-fever-bar-fill" style={{ width: `${feverProgress * 100}%` }} />
          </div>
        )}
      </div>

      {/* ── Arena ── */}
      <div
        ref={arenaRef}
        className={`ls-arena ${isFever ? 'fever' : ''} ${isRushTime ? 'rush' : ''} ${isFrozen ? 'frozen' : ''} ${chainLightningActive ? 'chain-flash' : ''}`}
      >
        <div
          className="ls-arena-bg"
          style={{
            background: isFever
              ? undefined
              : `radial-gradient(ellipse at 50% 40%, hsla(${bgHue}, 60%, 12%, 1) 0%, #0a0a14 100%)`,
          }}
        />

        {/* Background floating particles */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={`bg-p-${i}`}
            className="ls-bg-particle"
            style={{
              left: `${10 + (i * 12) % 80}%`,
              bottom: `-${5 + (i * 7) % 10}%`,
              width: `${2 + (i % 3)}px`,
              height: `${2 + (i % 3)}px`,
              background: CIRCLE_COLORS[i % CIRCLE_COLORS.length],
              animationDuration: `${4 + (i % 4) * 1.5}s`,
              animationDelay: `${(i * 0.7) % 3}s`,
            }}
          />
        ))}

        {/* Ripple effects */}
        {ripples.map((r) => (
          <div
            key={r.id}
            className="ls-ripple"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              width: '60px',
              height: '60px',
              border: `2px solid ${r.color}`,
            }}
          />
        ))}

        {/* Circles */}
        {circles.map((circle) => {
          const age = elapsedMsRef.current - circle.spawnedAtMs
          const isFrozenNow = frozenUntilRef.current > elapsedMsRef.current
          const effectiveLifetime = isFrozenNow ? circle.lifetimeMs + FREEZE_DURATION_MS : circle.lifetimeMs
          const progress = clamp(age / effectiveLifetime, 0, 1)
          const ringScale = 1 - progress
          const pulsePhase = (age / 180) % (Math.PI * 2)
          const pulseScale = 1 + Math.sin(pulsePhase) * 0.1
          const opacity = 0.35 + (1 - progress) * 0.65

          const isBomb = circle.type === 'bomb'
          const isGolden = circle.type === 'golden'
          const isHpRecovery = circle.type === 'hp-recovery'
          const isFreeze = circle.type === 'freeze'
          const isSuperSizeCircle = circle.type === 'super-size'

          let circleAnim: string | undefined
          if (isBomb) circleAnim = 'ls-bomb-pulse 0.6s ease-in-out infinite'
          else if (isGolden) circleAnim = 'ls-golden-sparkle 0.8s ease-in-out infinite'
          else if (isFreeze) circleAnim = 'ls-freeze-glow 1s ease-in-out infinite'
          else if (isSuperSizeCircle) circleAnim = 'ls-super-glow 0.9s ease-in-out infinite'

          return (
            <button
              key={circle.id}
              className="ls-circle"
              type="button"
              onClick={() => handleCircleTap(circle.id)}
              style={{
                left: `${circle.x * 100}%`,
                top: `${circle.y * 100}%`,
                width: circle.size,
                height: circle.size,
                transform: `translate(-50%, -50%) scale(${pulseScale})`,
                opacity: isFrozenNow ? Math.max(opacity, 0.7) : opacity,
                animation: circleAnim,
              }}
            >
              <span
                className="ls-ring"
                style={{
                  transform: `scale(${ringScale})`,
                  borderColor: isBomb ? '#ef4444' : circle.color,
                  borderWidth: (isGolden || isBomb) ? '4px' : (isHpRecovery || isFreeze || isSuperSizeCircle) ? '3px' : '2px',
                }}
              />
              <span
                className="ls-glow"
                style={{
                  backgroundColor: isBomb ? '#ef4444' : circle.color,
                  opacity: isGolden ? 1 : isBomb ? 0.9 : 0.7,
                }}
              />
              {isGolden && <span className="ls-circle-label" style={{ fontSize: '10px', color: '#000' }}>x3</span>}
              {isHpRecovery && <span className="ls-circle-label" style={{ fontSize: '11px', color: '#fff' }}>+HP</span>}
              {isBomb && <span className="ls-circle-label" style={{ fontSize: '13px', color: '#ef4444' }}>X</span>}
              {isFreeze && <span className="ls-circle-label" style={{ fontSize: '9px', color: '#fff' }}>ICE</span>}
              {isSuperSizeCircle && <span className="ls-circle-label" style={{ fontSize: '9px', color: '#fff' }}>BIG</span>}
            </button>
          )
        })}

        {/* Pop effects */}
        {popEffects.map((pop) => (
          <span
            key={pop.id}
            className="ls-pop"
            style={{ left: `${pop.x * 100}%`, top: `${pop.y * 100}%`, color: pop.color }}
          >
            {pop.text}
          </span>
        ))}
      </div>
    </section>
  )
}

export const lightSpeedModule: MiniGameModule = {
  manifest: {
    id: 'light-speed',
    title: 'Light Speed',
    description: 'Tap flashing lights at lightning speed! Avoid bombs, catch gold!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.1,
    accentColor: '#fbbf24',
  },
  Component: LightSpeedGame,
}
