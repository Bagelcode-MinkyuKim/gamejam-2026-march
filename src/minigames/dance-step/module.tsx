import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import dsPerfectSfx from '../../../assets/sounds/dance-step-perfect.mp3'
import dsGoodSfx from '../../../assets/sounds/dance-step-good.mp3'
import dsMissSfx from '../../../assets/sounds/dance-step-miss.mp3'
import dsFeverSfx from '../../../assets/sounds/dance-step-fever.mp3'
import dsComboSfx from '../../../assets/sounds/dance-step-combo.mp3'
import dsTimeWarnSfx from '../../../assets/sounds/dance-step-time-warning.mp3'
import dsLevelUpSfx from '../../../assets/sounds/dance-step-levelup.mp3'
import dsChainSfx from '../../../assets/sounds/dance-step-chain.mp3'
import dsBgm from '../../../assets/sounds/dance-step-bgm.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import characterImage from '../../../assets/images/same-character/kim-yeonja.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// ─── Timing ──────────────────────────────────────────────────
const ROUND_DURATION_MS = 45000
const LOW_TIME_THRESHOLD_MS = 5000

// ─── Arrow travel & spawn ────────────────────────────────────
const ARROW_TRAVEL_DURATION_MS = 2000
const ARROW_SPAWN_INTERVAL_START_MS = 1400
const ARROW_SPAWN_INTERVAL_MIN_MS = 300
const ARROW_SPAWN_ACCELERATION = 0.88
const ARROW_SPAWN_STEP_INTERVAL_MS = 4000

// ─── Hit windows ─────────────────────────────────────────────
const TARGET_LINE_Y_PERCENT = 18
const PERFECT_WINDOW_MS = 120
const GOOD_WINDOW_MS = 280
const OK_WINDOW_MS = 420

// ─── Scoring ─────────────────────────────────────────────────
const SCORE_PERFECT = 5
const SCORE_GOOD = 2
const SCORE_OK = 1
const SCORE_MISS = -1
const COMBO_BONUS_THRESHOLD = 10
const COMBO_BONUS_MULTIPLIER = 0.5

// ─── Fever / Freeze / Special ────────────────────────────────
const FEVER_COMBO_THRESHOLD = 15
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const DOUBLE_ARROW_ELAPSED_MS = 8000
const DOUBLE_ARROW_CHANCE = 0.3
const TRIPLE_ARROW_ELAPSED_MS = 20000
const TRIPLE_ARROW_CHANCE = 0.15
const RAINBOW_ARROW_ELAPSED_MS = 12000
const RAINBOW_ARROW_CHANCE = 0.10
const RAINBOW_MULTIPLIER = 5
const BOSS_ARROW_ELAPSED_MS = 18000
const BOSS_ARROW_CHANCE = 0.06
const BOSS_MULTIPLIER = 10
const FREEZE_COMBO_THRESHOLD = 25
const FREEZE_DURATION_MS = 3000

// ─── Bonus time pickup ──────────────────────────────────────
const TIME_BONUS_COMBO_THRESHOLD = 20
const TIME_BONUS_MS = 3000

// ─── Speed / Difficulty ──────────────────────────────────────
const SPEED_LEVEL_INTERVAL_MS = 6000
const MAX_SPEED_LEVEL = 8
const ARROW_SPEED_SCALE_PER_LEVEL = 0.06

const FEEDBACK_DURATION_MS = 400

// ─── Types ───────────────────────────────────────────────────
type Direction = 'up' | 'down' | 'left' | 'right'
const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'] as const

const DIRECTION_SYMBOLS: Record<Direction, string> = {
  up: '\u25B2', down: '\u25BC', left: '\u25C0', right: '\u25B6',
}

const DIRECTION_COLORS: Record<Direction, string> = {
  up: '#ff3377', down: '#33bbff', left: '#33ff77', right: '#ffcc33',
}

const DIRECTION_KEY_MAP: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
}

// ─── Swipe detection ─────────────────────────────────────────
const SWIPE_THRESHOLD = 30
const SWIPE_MAX_TIME_MS = 300

interface FallingArrow {
  readonly id: number
  readonly direction: Direction
  readonly spawnedAtMs: number
  readonly isRainbow: boolean
  readonly isBoss: boolean
  readonly isHold: boolean
  readonly holdDurationMs: number
  consumed: boolean
  holdProgress: number
}

type HitGrade = 'perfect' | 'good' | 'ok' | 'miss'

interface HitFeedback {
  readonly grade: HitGrade
  readonly direction: Direction
  readonly expiresAtMs: number
}

function pickRandomDirection(prev?: Direction): Direction {
  const c = DIRECTIONS.filter((d) => d !== prev)
  return c[Math.floor(Math.random() * c.length)]
}

function computeArrowYPercent(ageMs: number, travelMs: number): number {
  return 100 - (ageMs / travelMs) * (100 - TARGET_LINE_Y_PERCENT)
}

function computeSpawnInterval(elapsedMs: number): number {
  const steps = Math.floor(elapsedMs / ARROW_SPAWN_STEP_INTERVAL_MS)
  let interval = ARROW_SPAWN_INTERVAL_START_MS
  for (let i = 0; i < steps; i += 1) interval *= ARROW_SPAWN_ACCELERATION
  return Math.max(ARROW_SPAWN_INTERVAL_MIN_MS, interval)
}

function computeTravelDuration(speedLevel: number): number {
  return ARROW_TRAVEL_DURATION_MS * (1 - (speedLevel - 1) * ARROW_SPEED_SCALE_PER_LEVEL)
}

// ─── Component ───────────────────────────────────────────────
function DanceStepGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [arrows, setArrows] = useState<FallingArrow[]>([])
  const [feedbacks, setFeedbacks] = useState<HitFeedback[]>([])
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [isFreeze, setIsFreeze] = useState(false)
  const [speedLevel, setSpeedLevel] = useState(1)
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [chainDir, setChainDir] = useState<Direction | null>(null)
  const [chainCount, setChainCount] = useState(0)
  const [totalPerfects, setTotalPerfects] = useState(0)
  const [totalGoods, setTotalGoods] = useState(0)
  const [totalMisses, setTotalMisses] = useState(0)
  const [activeButtons, setActiveButtons] = useState<Set<Direction>>(new Set())
  const [timeBonusFlash, setTimeBonusFlash] = useState(false)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const realElapsedMsRef = useRef(0)
  const gameElapsedMsRef = useRef(0)
  const arrowsRef = useRef<FallingArrow[]>([])
  const feedbacksRef = useRef<HitFeedback[]>([])
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const nextArrowIdRef = useRef(0)
  const lastSpawnAtRef = useRef(0)
  const lastDirectionRef = useRef<Direction | undefined>(undefined)
  const lowTimeSecondRef = useRef<number | null>(null)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const freezeRef = useRef(false)
  const freezeRemainingMsRef = useRef(0)
  const perfectStreakRef = useRef(0)
  const lastSpeedLevelRef = useRef(1)
  const comboMilestoneRef = useRef(0)
  const chainDirRef = useRef<Direction | null>(null)
  const chainCountRef = useRef(0)
  const totalPerfectsRef = useRef(0)
  const totalGoodsRef = useRef(0)
  const totalMissesRef = useRef(0)
  const timeBonusGivenRef = useRef(false)
  // Swipe tracking
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const playAudio = useCallback((key: string, volume: number, rate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const addFeedback = useCallback((grade: HitGrade, direction: Direction) => {
    const fb: HitFeedback = { grade, direction, expiresAtMs: gameElapsedMsRef.current + FEEDBACK_DURATION_MS }
    feedbacksRef.current = [...feedbacksRef.current, fb]
    setFeedbacks(feedbacksRef.current)
  }, [])

  const applyHit = useCallback(
    (grade: HitGrade, direction: Direction, isRainbow: boolean, isBoss: boolean) => {
      if (grade === 'miss') {
        scoreRef.current = Math.max(0, scoreRef.current + SCORE_MISS)
        setScore(scoreRef.current)
        comboRef.current = 0; setCombo(0)
        perfectStreakRef.current = 0; setPerfectStreak(0)
        chainDirRef.current = null; chainCountRef.current = 0
        setChainDir(null); setChainCount(0)
        totalMissesRef.current += 1; setTotalMisses(totalMissesRef.current)
        addFeedback('miss', direction)
        playAudio('miss', 0.4)
        effects.triggerShake(5)
        effects.triggerFlash('rgba(255,0,0,0.3)')
        return
      }

      const basePoints = grade === 'perfect' ? SCORE_PERFECT : grade === 'good' ? SCORE_GOOD : SCORE_OK
      const currentCombo = comboRef.current + 1
      comboRef.current = currentCombo; setCombo(currentCombo)
      if (currentCombo > maxComboRef.current) {
        maxComboRef.current = currentCombo; setMaxCombo(currentCombo)
      }

      if (grade === 'perfect') {
        perfectStreakRef.current += 1; setPerfectStreak(perfectStreakRef.current)
        totalPerfectsRef.current += 1; setTotalPerfects(totalPerfectsRef.current)
      } else {
        perfectStreakRef.current = 0; setPerfectStreak(0)
        if (grade === 'good') { totalGoodsRef.current += 1; setTotalGoods(totalGoodsRef.current) }
      }

      // Chain bonus
      if (chainDirRef.current === direction) {
        chainCountRef.current += 1
      } else {
        chainDirRef.current = direction; chainCountRef.current = 1
      }
      setChainDir(chainDirRef.current); setChainCount(chainCountRef.current)
      const chainBonus = chainCountRef.current >= 3 ? Math.floor(chainCountRef.current / 3) * 2 : 0
      if (chainCountRef.current >= 3 && chainCountRef.current % 3 === 0) {
        playAudio('chain', 0.5, 1 + chainCountRef.current * 0.05)
        effects.triggerFlash(`rgba(${direction === 'up' ? '255,51,119' : direction === 'down' ? '51,187,255' : direction === 'left' ? '51,255,119' : '255,204,51'},0.25)`)
      }

      const comboBonus = currentCombo >= COMBO_BONUS_THRESHOLD
        ? Math.floor(basePoints * COMBO_BONUS_MULTIPLIER * Math.floor(currentCombo / COMBO_BONUS_THRESHOLD))
        : 0
      const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
      const specialMult = isBoss ? BOSS_MULTIPLIER : isRainbow ? RAINBOW_MULTIPLIER : 1
      const streakBonus = perfectStreakRef.current >= 5 ? Math.floor(perfectStreakRef.current / 5) * 3 : 0
      const totalPoints = (basePoints + comboBonus + chainBonus + streakBonus) * feverMult * specialMult
      scoreRef.current += totalPoints; setScore(scoreRef.current)

      // Fever activation
      if (currentCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
        feverRef.current = true
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setIsFever(true); setFeverRemainingMs(FEVER_DURATION_MS)
        effects.triggerFlash('rgba(255,255,0,0.5)')
        playAudio('fever', 0.6)
      }

      // Freeze activation
      if (currentCombo >= FREEZE_COMBO_THRESHOLD && !freezeRef.current && currentCombo % FREEZE_COMBO_THRESHOLD === 0) {
        freezeRef.current = true
        freezeRemainingMsRef.current = FREEZE_DURATION_MS
        setIsFreeze(true)
        effects.triggerFlash('rgba(0,128,255,0.5)')
      }

      // Time bonus at threshold
      if (currentCombo >= TIME_BONUS_COMBO_THRESHOLD && !timeBonusGivenRef.current) {
        timeBonusGivenRef.current = true
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
        setRemainingMs(remainingMsRef.current)
        setTimeBonusFlash(true)
        setTimeout(() => setTimeBonusFlash(false), 1200)
        effects.showScorePopup(3, 216, 200)
        effects.triggerFlash('rgba(0,255,128,0.4)')
      }

      // Combo milestone
      if (currentCombo >= 10 && currentCombo % 10 === 0 && currentCombo > comboMilestoneRef.current) {
        comboMilestoneRef.current = currentCombo
        playAudio('combo', 0.5, 1 + (currentCombo / 50) * 0.3)
      }

      addFeedback(grade, direction)
      const dirIndex = DIRECTIONS.indexOf(direction)
      const hitX = 54 + dirIndex * 108

      if (grade === 'perfect') {
        playAudio('perfect', 0.55, 1 + currentCombo * 0.008)
        effects.comboHitBurst(hitX, 120, currentCombo, totalPoints)
      } else if (grade === 'good') {
        playAudio('good', 0.45, 1 + currentCombo * 0.006)
        effects.spawnParticles(4, hitX, 120)
        effects.showScorePopup(totalPoints, hitX, 100)
      } else {
        playAudio('good', 0.3, 0.9)
        effects.spawnParticles(2, hitX, 120)
        effects.showScorePopup(totalPoints, hitX, 100)
      }

      if (isBoss) {
        effects.triggerFlash('rgba(255,0,255,0.5)')
        effects.spawnParticles(12, hitX, 120)
        effects.triggerShake(6)
      } else if (isRainbow) {
        effects.triggerFlash('rgba(168,85,247,0.4)')
        effects.spawnParticles(8, hitX, 120)
      }
    },
    [addFeedback, playAudio],
  )

  const handleDirectionInput = useCallback(
    (direction: Direction) => {
      if (finishedRef.current) return

      // Visual button flash
      setActiveButtons((prev) => new Set(prev).add(direction))
      setTimeout(() => setActiveButtons((prev) => { const n = new Set(prev); n.delete(direction); return n }), 100)

      const currentArrows = arrowsRef.current
      const now = gameElapsedMsRef.current
      let bestArrow: FallingArrow | null = null
      let bestDistance = Infinity
      const currentTravelMs = computeTravelDuration(lastSpeedLevelRef.current)

      for (const arrow of currentArrows) {
        if (arrow.consumed || arrow.direction !== direction) continue
        const yPercent = computeArrowYPercent(now - arrow.spawnedAtMs, currentTravelMs)
        const dist = Math.abs(yPercent - TARGET_LINE_Y_PERCENT)
        if (dist < bestDistance) { bestDistance = dist; bestArrow = arrow }
      }

      if (!bestArrow) { applyHit('miss', direction, false, false); return }

      const targetAge = currentTravelMs * ((100 - TARGET_LINE_Y_PERCENT) / 100)
      const timeDiff = Math.abs((now - bestArrow.spawnedAtMs) - targetAge)
      const { isRainbow, isBoss } = bestArrow
      bestArrow.consumed = true
      arrowsRef.current = currentArrows.filter((a) => a.id !== bestArrow!.id)
      setArrows([...arrowsRef.current])

      if (timeDiff <= PERFECT_WINDOW_MS) applyHit('perfect', direction, isRainbow, isBoss)
      else if (timeDiff <= GOOD_WINDOW_MS) applyHit('good', direction, isRainbow, isBoss)
      else if (timeDiff <= OK_WINDOW_MS) applyHit('ok', direction, isRainbow, isBoss)
      else applyHit('miss', direction, false, false)
    },
    [applyHit],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current.currentTime = 0 }
    playAudio('gameover', 0.6, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)) })
  }, [onFinish, playAudio])

  // ─── Audio setup ───────────────────────────────────────────
  useEffect(() => {
    const srcs: Record<string, string> = {
      perfect: dsPerfectSfx, good: dsGoodSfx, miss: dsMissSfx,
      fever: dsFeverSfx, combo: dsComboSfx, timewarn: dsTimeWarnSfx,
      levelup: dsLevelUpSfx, chain: dsChainSfx, gameover: gameOverHitSfx,
    }
    for (const [key, src] of Object.entries(srcs)) {
      const a = new Audio(src); a.preload = 'auto'; audioRefs.current[key] = a
    }
    // BGM
    const bgm = new Audio(dsBgm)
    bgm.loop = true; bgm.volume = 0.25; bgm.preload = 'auto'
    bgmRef.current = bgm
    void bgm.play().catch(() => {})
    return () => {
      audioRefs.current = {}
      if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current.currentTime = 0; bgmRef.current = null }
      effects.cleanup()
    }
  }, [])

  // ─── Keyboard input ────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      const dir = DIRECTION_KEY_MAP[e.code]
      if (dir) { e.preventDefault(); handleDirectionInput(dir) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDirectionInput, onExit])

  // ─── Swipe input on arena ──────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStartRef.current.x
    const dy = t.clientY - touchStartRef.current.y
    const dt = Date.now() - touchStartRef.current.t
    touchStartRef.current = null
    if (dt > SWIPE_MAX_TIME_MS) return
    const absDx = Math.abs(dx)
    const absDy = Math.abs(dy)
    if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) return
    let dir: Direction
    if (absDx > absDy) dir = dx > 0 ? 'right' : 'left'
    else dir = dy > 0 ? 'down' : 'up'
    handleDirectionInput(dir)
  }, [handleDirectionInput])

  // ─── Game loop ─────────────────────────────────────────────
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const rawDelta = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // realElapsed drives timer; gameElapsed drives arrow logic
      realElapsedMsRef.current += rawDelta
      const gameDelta = freezeRef.current ? rawDelta * 0.3 : rawDelta
      gameElapsedMsRef.current += gameDelta
      remainingMsRef.current = Math.max(0, remainingMsRef.current - rawDelta)
      setRemainingMs(remainingMsRef.current)

      // Low time warning
      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== sec) { lowTimeSecondRef.current = sec; playAudio('timewarn', 0.3, 1.2) }
      } else lowTimeSecondRef.current = null

      // Fever timer
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - rawDelta)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      // Freeze timer
      if (freezeRef.current) {
        freezeRemainingMsRef.current = Math.max(0, freezeRemainingMsRef.current - rawDelta)
        if (freezeRemainingMsRef.current <= 0) { freezeRef.current = false; setIsFreeze(false) }
      }

      // Speed level (based on real elapsed, not game elapsed)
      const sl = Math.min(MAX_SPEED_LEVEL, 1 + Math.floor(realElapsedMsRef.current / SPEED_LEVEL_INTERVAL_MS))
      if (sl !== lastSpeedLevelRef.current) {
        lastSpeedLevelRef.current = sl
        setSpeedLevel(sl)
        playAudio('levelup', 0.4, 0.9 + sl * 0.1)
        effects.triggerFlash('rgba(255,255,255,0.25)')
      }

      // Spawn arrows (based on game elapsed so freeze slows spawning)
      const spawnInterval = computeSpawnInterval(gameElapsedMsRef.current)
      if (gameElapsedMsRef.current - lastSpawnAtRef.current >= spawnInterval) {
        const direction = pickRandomDirection(lastDirectionRef.current)
        lastDirectionRef.current = direction
        const elapsed = realElapsedMsRef.current
        const isBoss = elapsed > BOSS_ARROW_ELAPSED_MS && Math.random() < BOSS_ARROW_CHANCE
        const isRainbow = !isBoss && elapsed > RAINBOW_ARROW_ELAPSED_MS && Math.random() < RAINBOW_ARROW_CHANCE
        const isHold = false
        const holdDurationMs = 0

        arrowsRef.current = [...arrowsRef.current, {
          id: nextArrowIdRef.current++, direction, spawnedAtMs: gameElapsedMsRef.current,
          isRainbow, isBoss, isHold, holdDurationMs, consumed: false, holdProgress: 0,
        }]

        // Double arrow
        if (elapsed > DOUBLE_ARROW_ELAPSED_MS && Math.random() < DOUBLE_ARROW_CHANCE) {
          const dir2 = pickRandomDirection(direction)
          arrowsRef.current = [...arrowsRef.current, {
            id: nextArrowIdRef.current++, direction: dir2, spawnedAtMs: gameElapsedMsRef.current,
            isRainbow: false, isBoss: false, isHold: false, holdDurationMs: 0, consumed: false, holdProgress: 0,
          }]
        }

        // Triple arrow (late game)
        if (elapsed > TRIPLE_ARROW_ELAPSED_MS && Math.random() < TRIPLE_ARROW_CHANCE) {
          const usedDirs = new Set([direction])
          for (let i = 0; i < 2; i++) {
            const available = DIRECTIONS.filter((d) => !usedDirs.has(d))
            if (available.length === 0) break
            const dir3 = available[Math.floor(Math.random() * available.length)]
            usedDirs.add(dir3)
            arrowsRef.current = [...arrowsRef.current, {
              id: nextArrowIdRef.current++, direction: dir3, spawnedAtMs: gameElapsedMsRef.current,
              isRainbow: false, isBoss: false, isHold: false, holdDurationMs: 0, consumed: false, holdProgress: 0,
            }]
          }
        }
        lastSpawnAtRef.current = gameElapsedMsRef.current
      }

      // Expire arrows
      const currentTravelMs = computeTravelDuration(lastSpeedLevelRef.current)
      const expThresh = currentTravelMs * 1.15
      const missed: FallingArrow[] = []
      const surviving: FallingArrow[] = []
      for (const a of arrowsRef.current) {
        const age = gameElapsedMsRef.current - a.spawnedAtMs
        if (!a.consumed && age > expThresh) missed.push(a)
        else if (age <= expThresh || a.consumed) surviving.push(a)
      }
      for (const m of missed) {
        scoreRef.current = Math.max(0, scoreRef.current + SCORE_MISS)
        setScore(scoreRef.current)
        comboRef.current = 0; setCombo(0)
        perfectStreakRef.current = 0; setPerfectStreak(0)
        totalMissesRef.current += 1; setTotalMisses(totalMissesRef.current)
        feedbacksRef.current = [...feedbacksRef.current, { grade: 'miss' as HitGrade, direction: m.direction, expiresAtMs: gameElapsedMsRef.current + FEEDBACK_DURATION_MS }]
      }
      arrowsRef.current = surviving
      setArrows([...surviving])

      const af = feedbacksRef.current.filter((fb) => fb.expiresAtMs > gameElapsedMsRef.current)
      if (af.length !== feedbacksRef.current.length) { feedbacksRef.current = af; setFeedbacks(af) }
      effects.updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
      lastFrameAtRef.current = null
    }
  }, [finishGame, playAudio])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const latestFeedback = feedbacks.length > 0 ? feedbacks[feedbacks.length - 1] : null
  const currentTravelMs = computeTravelDuration(speedLevel)

  return (
    <section
      className={`mini-game-panel ds-panel ${isFever ? 'ds-fever' : ''} ${isFreeze ? 'ds-freeze' : ''}`}
      aria-label="dance-step-game"
      style={{ ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .ds-panel {
          display: flex; flex-direction: column; width: 100%; height: 100%;
          background: linear-gradient(180deg, #0d0d1a 0%, #1a0a2e 50%, #0d0d1a 100%);
          font-family: 'Press Start 2P', monospace;
          user-select: none; -webkit-user-select: none;
          touch-action: none;
          position: relative; overflow: hidden;
          image-rendering: pixelated;
          max-width: 432px; margin: 0 auto;
        }

        .ds-panel::before {
          content: ''; position: absolute; inset: 0; z-index: 50; pointer-events: none;
          background: repeating-linear-gradient(0deg, rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 3px);
          mix-blend-mode: multiply;
        }

        .ds-panel.ds-fever {
          animation: ds-fever-bg 0.4s steps(2) infinite;
        }
        .ds-panel.ds-freeze {
          background: linear-gradient(180deg, #0a1a2e 0%, #0a2040 50%, #0a1a2e 100%);
        }

        @keyframes ds-fever-bg {
          0% { background: linear-gradient(180deg, #2e0a00 0%, #1a0800 50%, #0d0d1a 100%); }
          50% { background: linear-gradient(180deg, #0d0d1a 0%, #1a0a2e 50%, #0d0d1a 100%); }
        }

        /* ── Header ── */
        .ds-hdr {
          display: flex; flex-direction: column; align-items: center;
          padding: 10px 12px 6px; flex-shrink: 0;
          background: rgba(0,0,0,0.4);
          border-bottom: 3px solid rgba(255,51,119,0.4);
        }
        .ds-score-row {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          width: 100%;
        }
        .ds-avatar {
          width: 48px; height: 48px; border: 2px solid #ff3377;
          image-rendering: pixelated; object-fit: cover; flex-shrink: 0;
        }
        .ds-score-block { text-align: center; flex: 1; }
        .ds-score {
          font-size: clamp(32px, 10vw, 52px); color: #ff3377; margin: 0; line-height: 1;
          text-shadow: 0 0 12px rgba(255,51,119,0.6), 2px 2px 0 #000;
        }
        .ds-best { font-size: 9px; color: #886688; margin: 2px 0 0; }
        .ds-time-block { text-align: center; flex-shrink: 0; }
        .ds-time {
          font-size: clamp(20px, 6vw, 28px); color: #eee; margin: 0;
          font-variant-numeric: tabular-nums;
        }
        .ds-time.low { color: #ff3333; animation: ds-blink 0.5s steps(2) infinite; }
        @keyframes ds-blink { 50% { opacity: 0; } }
        .ds-spd {
          font-size: 9px; color: #ff3377; padding: 2px 6px;
          border: 1px solid #ff3377; margin-top: 2px; display: inline-block;
        }

        /* ── Status bar ── */
        .ds-status {
          display: flex; justify-content: center; align-items: center; gap: 10px;
          padding: 4px 8px; font-size: 10px; color: #bbb; flex-shrink: 0;
          background: rgba(0,0,0,0.3);
        }
        .ds-status p { margin: 0; }
        .ds-status strong { color: #fff; font-size: 12px; }
        .ds-fever-tag { color: #ffcc00; animation: ds-blink 0.3s steps(2) infinite; font-size: 11px; }
        .ds-freeze-tag { color: #33bbff; animation: ds-blink 0.4s steps(2) infinite; font-size: 11px; }
        .ds-chain-tag { font-size: 9px; font-weight: 700; }
        .ds-time-bonus { color: #33ff77; animation: ds-bonus-flash 1.2s ease-out forwards; font-size: 11px; }
        @keyframes ds-bonus-flash {
          0% { opacity: 1; transform: scale(1.3); }
          100% { opacity: 0; transform: scale(1); }
        }

        /* ── Feedback row ── */
        .ds-fb-row {
          min-height: 32px; text-align: center; flex-shrink: 0; padding: 2px 0;
          display: flex; align-items: center; justify-content: center;
        }
        .ds-fb {
          font-size: clamp(18px, 5vw, 26px); animation: ds-fb-pop 0.3s steps(4) forwards;
          display: inline-block; text-shadow: 2px 2px 0 #000;
        }
        .ds-fb.perfect { color: #33ff77; }
        .ds-fb.good { color: #ffcc33; }
        .ds-fb.ok { color: #ff8833; }
        .ds-fb.miss { color: #ff3333; }
        @keyframes ds-fb-pop {
          0% { transform: scale(1.8); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .ds-streak { font-size: 10px; color: #33ff77; margin-left: 6px; }

        /* ── Arena ── */
        .ds-arena {
          position: relative; flex: 1; margin: 0 4px;
          background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 25%),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 1px, transparent 1px, transparent 20px);
          border: 3px solid rgba(255,51,119,0.3); overflow: hidden; min-height: 0;
        }

        .ds-lane-divider {
          position: absolute; top: 0; bottom: 0; width: 1px;
          background: rgba(255,255,255,0.06);
        }

        .ds-target {
          position: absolute; left: 0; right: 0; height: 4px; z-index: 2; pointer-events: none;
          background: #ff3377;
          box-shadow: 0 0 12px #ff3377, 0 0 24px rgba(255,51,119,0.4);
        }

        .ds-target-zone {
          position: absolute; left: 0; right: 0; z-index: 1; pointer-events: none;
          background: linear-gradient(180deg, rgba(255,51,119,0.08) 0%, rgba(255,51,119,0.15) 50%, rgba(255,51,119,0.08) 100%);
        }

        .ds-arrow {
          position: absolute; pointer-events: none; z-index: 3;
          font-size: clamp(28px, 8vw, 38px); font-weight: 900;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.9);
          transition: none;
          filter: drop-shadow(0 0 4px currentColor);
        }

        .ds-arrow.near {
          animation: ds-arrow-pulse 0.15s steps(2) infinite;
          filter: drop-shadow(0 0 8px currentColor) brightness(1.3);
        }
        @keyframes ds-arrow-pulse { 50% { filter: drop-shadow(0 0 12px currentColor) brightness(2); } }

        .ds-arrow.rainbow {
          animation: ds-rainbow 0.25s steps(4) infinite;
          font-size: clamp(32px, 9vw, 42px);
        }
        @keyframes ds-rainbow {
          0% { color: #ff3377; } 25% { color: #33bbff; } 50% { color: #33ff77; } 75% { color: #ffcc33; }
        }

        .ds-arrow.boss {
          font-size: clamp(38px, 11vw, 50px);
          animation: ds-boss-glow 0.3s steps(3) infinite;
          filter: drop-shadow(0 0 8px #ff00ff);
        }
        @keyframes ds-boss-glow {
          0% { color: #ff00ff; } 33% { color: #ff33ff; } 66% { color: #cc00cc; }
        }

        .ds-lane-label {
          position: absolute; transform: translateX(-50%);
          font-size: clamp(14px, 4vw, 20px); opacity: 0.06; bottom: 8px;
        }

        /* ── Buttons ── */
        .ds-btns {
          display: grid; grid-template-columns: repeat(4, 1fr);
          gap: 6px; padding: 8px 6px 12px; flex-shrink: 0;
          background: rgba(0,0,0,0.3);
        }

        .ds-btn {
          display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
          padding: 14px 4px; border: 3px solid; background: rgba(0,0,0,0.6);
          cursor: pointer; transition: none;
          -webkit-tap-highlight-color: transparent; touch-action: manipulation;
          font-family: 'Press Start 2P', monospace;
          min-height: 64px;
        }

        .ds-btn:active, .ds-btn.active {
          filter: brightness(2.5); transform: scale(0.92);
          box-shadow: inset 0 0 0 2px rgba(255,255,255,0.4), 0 0 16px currentColor;
        }

        .ds-btn-sym { font-size: clamp(24px, 7vw, 34px); }
        .ds-btn-lbl { font-size: 7px; opacity: 0.5; }

        /* ── Stats overlay ── */
        .ds-stats {
          display: flex; justify-content: center; gap: 12px;
          padding: 3px 0; font-size: 8px; color: #888;
          background: rgba(0,0,0,0.2); flex-shrink: 0;
        }
        .ds-stats span { display: flex; align-items: center; gap: 3px; }
        .ds-stats .perf-count { color: #33ff77; }
        .ds-stats .good-count { color: #ffcc33; }
        .ds-stats .miss-count { color: #ff3333; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Header - score centered, large */}
      <div className="ds-hdr">
        <div className="ds-score-row">
          <img className="ds-avatar" src={characterImage} alt="" />
          <div className="ds-score-block">
            <p className="ds-score">{score.toLocaleString()}</p>
            <p className="ds-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
          <div className="ds-time-block">
            <p className={`ds-time ${isLowTime ? 'low' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
            <span className="ds-spd">LV.{speedLevel}</span>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="ds-status">
        <p>COMBO <strong>{combo}</strong>{comboLabel && <span style={{ color: comboColor, marginLeft: 4, fontSize: 10 }}>{comboLabel}</span>}</p>
        {combo > 0 && <p>MAX <strong>{maxCombo}</strong></p>}
        {isFever && <span className="ds-fever-tag">FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</span>}
        {isFreeze && <span className="ds-freeze-tag">FREEZE!</span>}
        {chainCount >= 3 && chainDir && (
          <span className="ds-chain-tag" style={{ color: DIRECTION_COLORS[chainDir] }}>CHAIN x{chainCount}</span>
        )}
        {timeBonusFlash && <span className="ds-time-bonus">+{TIME_BONUS_MS / 1000}s!</span>}
      </div>

      {/* Stats */}
      <div className="ds-stats">
        <span className="perf-count">P:{totalPerfects}</span>
        <span className="good-count">G:{totalGoods}</span>
        <span className="miss-count">M:{totalMisses}</span>
      </div>

      {/* Feedback */}
      <div className="ds-fb-row">
        {latestFeedback && (
          <span className={`ds-fb ${latestFeedback.grade}`}>
            {latestFeedback.grade === 'perfect' ? 'PERFECT!' : latestFeedback.grade === 'good' ? 'GOOD!' : latestFeedback.grade === 'ok' ? 'OK' : 'MISS'}
            {perfectStreak >= 3 && latestFeedback.grade === 'perfect' && <span className="ds-streak">x{perfectStreak}</span>}
          </span>
        )}
      </div>

      {/* Arena */}
      <div
        className="ds-arena"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Lane dividers */}
        {[1, 2, 3].map((i) => (
          <div key={i} className="ds-lane-divider" style={{ left: `${i * 25}%` }} />
        ))}

        {/* Target zone glow */}
        <div className="ds-target-zone" style={{ top: `${TARGET_LINE_Y_PERCENT - 4}%`, height: '8%' }} />
        <div className="ds-target" style={{ top: `${TARGET_LINE_Y_PERCENT}%` }} />

        {arrows.map((arrow) => {
          const age = gameElapsedMsRef.current - arrow.spawnedAtMs
          const y = computeArrowYPercent(age, currentTravelMs)
          if (y < -10 || y > 110) return null
          const li = DIRECTIONS.indexOf(arrow.direction)
          const near = Math.abs(y - TARGET_LINE_Y_PERCENT) < 6
          return (
            <div
              key={arrow.id}
              className={`ds-arrow ${arrow.direction} ${near ? 'near' : ''} ${arrow.isRainbow ? 'rainbow' : ''} ${arrow.isBoss ? 'boss' : ''}`}
              style={{
                top: `${y}%`, left: `${12.5 + li * 25}%`,
                color: arrow.isBoss ? '#ff00ff' : arrow.isRainbow ? undefined : DIRECTION_COLORS[arrow.direction],
                transform: `translate(-50%, -50%) scale(${near ? 1.25 : 1})`,
                opacity: y < TARGET_LINE_Y_PERCENT ? 0.3 : 1,
              }}
            >
              {arrow.isBoss ? '\u2605' : DIRECTION_SYMBOLS[arrow.direction]}
            </div>
          )
        })}

        {/* Lane labels at bottom */}
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', pointerEvents: 'none', zIndex: 4 }}>
          {DIRECTIONS.map((dir, i) => (
            <div key={dir} className="ds-lane-label" style={{ left: `${12.5 + i * 25}%`, color: DIRECTION_COLORS[dir], position: 'absolute' }}>
              {DIRECTION_SYMBOLS[dir]}
            </div>
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="ds-btns">
        {DIRECTIONS.map((dir) => (
          <button
            key={dir}
            className={`ds-btn ${activeButtons.has(dir) ? 'active' : ''}`}
            type="button"
            onPointerDown={(e) => { e.preventDefault(); handleDirectionInput(dir) }}
            style={{ borderColor: DIRECTION_COLORS[dir], color: DIRECTION_COLORS[dir] }}
          >
            <span className="ds-btn-sym">{DIRECTION_SYMBOLS[dir]}</span>
            <span className="ds-btn-lbl">{dir.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export const danceStepModule: MiniGameModule = {
  manifest: {
    id: 'dance-step',
    title: 'Dance Step',
    description: 'Tap arrows in order! DDR-style dance!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#ff3377',
  },
  Component: DanceStepGame,
}
