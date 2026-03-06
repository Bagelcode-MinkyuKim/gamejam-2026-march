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
import shuffleSfx from '../../../assets/sounds/spot-diff-shuffle.mp3'
import freezeSfx from '../../../assets/sounds/spot-diff-freeze.mp3'
import perfectSfx from '../../../assets/sounds/spot-diff-perfect.mp3'
import streakSfx from '../../../assets/sounds/spot-diff-streak.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import spotDiffBgmLoop from '../../../assets/sounds/dance-step-bgm.mp3'
import { getActiveBgmTrack, playBackgroundAudio as playSharedBgm, stopBackgroundAudio as stopSharedBgm } from '../../gui/sound-manager'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// === TIMING ===
const ROUND_DURATION_MS = 30_000
const TIME_PENALTY_MS = 3_000
const WRONG_FLASH_MS = 300
const CORRECT_FLASH_MS = 400
const LOW_TIME_MS = 5_000
const ROUND_TRANSITION_MS = 700

// === SCORING ===
const BASE_SCORE = 100
const SPEED_BONUS_WINDOW_MS = 5_000
const SPEED_BONUS_PTS = 50
const PERFECT_THRESHOLD_MS = 1_000
const PERFECT_BONUS_PTS = 200
const FAST_FIND_TIME_BONUS_MS = 1_500
const FAST_FIND_THRESHOLD_MS = 2_000

// === FEVER ===
const FEVER_STREAK = 5
const FEVER_MULT = 3
const FEVER_DURATION_MS = 8_000

// === GRID ===
const GRID_SIZES: readonly number[] = [3, 4, 4, 5, 5, 6]
const MAX_GRID = 6

// === BONUS ===
const BONUS_INTERVAL = 3
const TIME_BONUS_MS = 5_000
const DOUBLE_SCORE_ROUNDS = 2

// === SHUFFLE (new feature) ===
const SHUFFLE_START_ROUND = 4
const SHUFFLE_INTERVAL_MS = 4_000

// === FREEZE (new feature) ===
const FREEZE_CHANCE = 0.15
const FREEZE_DURATION_MS = 3_000

// === STREAK MILESTONE ===
const STREAK_MILESTONE = 5

// === HARD MODE FEATURES ===
const GLITCH_START_ROUND = 2
const GLITCH_PENALTY_MS = 4_500
const BLACKOUT_START_ROUND = 4
const BLACKOUT_DURATION_MS = 900
const BLACKOUT_INTERVAL_MS = 5_400
const BLACKOUT_MIN_INTERVAL_MS = 3_000
const SHUFFLE_MIN_INTERVAL_MS = 2_200
const SPOT_DIFF_BGM_VOLUME = 0.24

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
  readonly isFreeze?: boolean
  readonly isJammer?: boolean
}

type BonusType = 'time' | 'double' | null

function pickTwo(excludeId?: string): [CharacterEntry, CharacterEntry] {
  const pool = CHARACTER_POOL.filter((c) => c.id !== excludeId)
  const src = pool.length >= 2 ? pool : CHARACTER_POOL
  const i = Math.floor(Math.random() * src.length)
  const a = src[i]
  const rest = src.filter((c) => c.id !== a.id)
  const j = Math.floor(Math.random() * rest.length)
  return [a, rest[j]]
}

function pickUniqueIndexes(total: number, count: number, blocked: ReadonlySet<number>): number[] {
  const indexes: number[] = []
  while (indexes.length < count && blocked.size + indexes.length < total) {
    const nextIndex = Math.floor(Math.random() * total)
    if (blocked.has(nextIndex) || indexes.includes(nextIndex)) continue
    indexes.push(nextIndex)
  }
  return indexes
}

function buildGrid(gridSize: number, round: number, prevMainId?: string, addFreeze = false, jammerCount = 0): GridCell[] {
  const total = gridSize * gridSize
  const [main, odd] = pickTwo(round > 0 ? prevMainId : undefined)
  const oddIdx = Math.floor(Math.random() * total)

  let freezeIdx = -1
  if (addFreeze) {
    const [nextFreezeIdx] = pickUniqueIndexes(total, 1, new Set([oddIdx]))
    freezeIdx = nextFreezeIdx ?? -1
  }

  const blocked = new Set<number>([oddIdx])
  if (freezeIdx >= 0) blocked.add(freezeIdx)
  const jammerSet = new Set(pickUniqueIndexes(total, jammerCount, blocked))

  const cells: GridCell[] = []
  for (let i = 0; i < total; i++) {
    cells.push({
      character: i === oddIdx ? odd : main,
      isDifferent: i === oddIdx,
      cellIndex: i,
      isFreeze: i === freezeIdx,
      isJammer: jammerSet.has(i),
    })
  }
  return cells
}

function shuffleGrid(cells: GridCell[]): GridCell[] {
  const arr = [...cells]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = arr[i]
    arr[i] = { ...arr[j], cellIndex: i }
    arr[j] = { ...temp, cellIndex: j }
  }
  return arr
}

function getGridSize(round: number): number {
  return round < GRID_SIZES.length ? GRID_SIZES[round] : MAX_GRID
}

function getBonus(round: number): BonusType {
  if (round > 0 && round % BONUS_INTERVAL === 0) return Math.random() < 0.5 ? 'time' : 'double'
  return null
}

function getJammerCount(round: number): number {
  if (round < GLITCH_START_ROUND) return 0
  if (round < 4) return 1
  if (round < 6) return 2
  return 3
}

function getShuffleIntervalMs(round: number): number {
  const roundPressure = Math.max(0, round - SHUFFLE_START_ROUND)
  return Math.max(SHUFFLE_MIN_INTERVAL_MS, SHUFFLE_INTERVAL_MS - roundPressure * 350)
}

function getBlackoutIntervalMs(round: number): number {
  const roundPressure = Math.max(0, round - BLACKOUT_START_ROUND)
  return Math.max(BLACKOUT_MIN_INTERVAL_MS, BLACKOUT_INTERVAL_MS - roundPressure * 350)
}

function getFreezeChance(round: number): number {
  if (round < 3) return FREEZE_CHANCE * 0.7
  if (round < 5) return FREEZE_CHANCE * 0.55
  return FREEZE_CHANCE * 0.45
}

function createPixelStars(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() < 0.3 ? 3 : 2,
    delay: Math.random() * 3,
    dur: 1.5 + Math.random() * 2,
  }))
}

// === Pixel Stars Background Component ===
function PixelStars({ count }: { count: number }) {
  const [stars, setStars] = useState(() => createPixelStars(count))

  useEffect(() => {
    setStars(createPixelStars(count))
  }, [count])

  return (
    <div className="sd-pixel-stars" aria-hidden>
      {stars.map((s) => (
        <div
          key={s.id}
          className="sd-star"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            animationDelay: `${s.delay}s`,
            animationDuration: `${s.dur}s`,
          }}
        />
      ))}
    </div>
  )
}

function SpotDiffGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [round, setRound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [grid, setGrid] = useState<GridCell[]>(() => buildGrid(GRID_SIZES[0], 0))
  const [gridSize, setGridSize] = useState(GRID_SIZES[0])
  const [wrongFlashIdx, setWrongFlashIdx] = useState<number | null>(null)
  const [correctFlashIdx, setCorrectFlashIdx] = useState<number | null>(null)
  const [isGameOver, setIsGameOver] = useState(false)
  const [streak, setStreak] = useState(0)
  const [maxStreak, setMaxStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [showTransition, setShowTransition] = useState(false)
  const [transitionText, setTransitionText] = useState('')
  const [transitionSub, setTransitionSub] = useState('')
  const [doubleLeft, setDoubleLeft] = useState(0)
  const [timeBonusPopup, setTimeBonusPopup] = useState(false)
  const [isFrozen, setIsFrozen] = useState(false)
  const [showPerfect, setShowPerfect] = useState(false)
  const [showStreakMilestone, setShowStreakMilestone] = useState(0)
  const [shuffleFlash, setShuffleFlash] = useState(false)
  const [cellEntryKey, setCellEntryKey] = useState(0)
  const [showGlitchTrap, setShowGlitchTrap] = useState(false)
  const [isBlackout, setIsBlackout] = useState(false)

  const effects = useGameEffects()
  const {
    cleanup: cleanupEffects,
    comboHitBurst,
    flashColor,
    getShakeStyle,
    isFlashing,
    particles,
    scorePopups,
    triggerFlash,
    triggerShake,
    updateParticles,
  } = effects

  const scoreRef = useRef(0)
  const roundRef = useRef(0)
  const remainingRef = useRef(ROUND_DURATION_MS)
  const gridRef = useRef(grid)
  const gridSizeRef = useRef(GRID_SIZES[0])
  const finishedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const roundStartRef = useRef(0)
  const wrongTimerRef = useRef<number | null>(null)
  const correctTimerRef = useRef<number | null>(null)
  const prevMainRef = useRef<string | undefined>(undefined)
  const streakRef = useRef(0)
  const maxStreakRef = useRef(0)
  const feverRef = useRef(false)
  const feverMsRef = useRef(0)
  const transTimerRef = useRef<number | null>(null)
  const doubleRef = useRef(0)
  const timeWarnRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const frozenRef = useRef(false)
  const frozenMsRef = useRef(0)
  const shuffleTimerRef = useRef(0)
  const glitchTimerRef = useRef<number | null>(null)
  const blackoutTimerRef = useRef(0)
  const blackoutMsRef = useRef(0)

  const audioRef = useRef<Record<string, HTMLAudioElement | null>>({})

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) { window.clearTimeout(ref.current); ref.current = null }
  }

  const play = useCallback((key: string, vol: number, rate = 1) => {
    const a = audioRef.current[key]
    if (!a) return
    a.currentTime = 0
    a.volume = vol
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const ensureBgm = useCallback(() => {
    playSharedBgm(spotDiffBgmLoop, SPOT_DIFF_BGM_VOLUME)
  }, [])

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setIsGameOver(true)
    play('gameOver', 0.7, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(Math.max(16, ROUND_DURATION_MS - remainingRef.current)) })
  }, [onFinish, play])

  const advance = useCallback((now: number) => {
    const next = roundRef.current + 1
    roundRef.current = next
    setRound(next)

    const gs = getGridSize(next)
    gridSizeRef.current = gs
    setGridSize(gs)

    const mainId = gridRef.current.find((c) => !c.isDifferent)?.character.id
    prevMainRef.current = mainId

    const bonus = getBonus(next)
    const featureTags = [`${gs}x${gs} GRID`]
    if (bonus === 'time') {
      remainingRef.current = Math.min(ROUND_DURATION_MS, remainingRef.current + TIME_BONUS_MS)
      setRemainingMs(remainingRef.current)
      setTimeBonusPopup(true)
      setTimeout(() => setTimeBonusPopup(false), 1200)
      featureTags.push('+5s TIME')
    } else if (bonus === 'double') {
      doubleRef.current = DOUBLE_SCORE_ROUNDS
      setDoubleLeft(DOUBLE_SCORE_ROUNDS)
      featureTags.push('x2 SCORE')
    }

    const jammerCount = getJammerCount(next)
    if (jammerCount > 0) featureTags.push(`GLITCH x${jammerCount}`)
    if (next >= SHUFFLE_START_ROUND) featureTags.push('SHUFFLE')
    if (next >= BLACKOUT_START_ROUND) featureTags.push('BLACKOUT')
    const trans = `ROUND ${next + 1}`
    const sub = featureTags.join(' / ')
    setTransitionText(trans)
    setTransitionSub(sub)
    setShowTransition(true)
    play('roundClear', 0.5)

    clearTimer(transTimerRef)
    transTimerRef.current = window.setTimeout(() => { setShowTransition(false); transTimerRef.current = null }, ROUND_TRANSITION_MS)

    const addFreeze = Math.random() < getFreezeChance(next)
    const g = buildGrid(gs, next, mainId, addFreeze, jammerCount)
    gridRef.current = g
    setGrid(g)
    setCellEntryKey((k) => k + 1)

    roundStartRef.current = now
    timeWarnRef.current = false
    shuffleTimerRef.current = 0
    blackoutTimerRef.current = 0
    blackoutMsRef.current = 0
    setIsBlackout(false)

    if (doubleRef.current > 0) { doubleRef.current--; setDoubleLeft(doubleRef.current) }
  }, [play])

  const handleTap = useCallback((cell: GridCell) => {
    if (finishedRef.current || showTransition) return
    ensureBgm()
    const now = window.performance.now()

    // Freeze power-up tap
    if (cell.isFreeze && !cell.isDifferent) {
      frozenRef.current = true
      frozenMsRef.current = FREEZE_DURATION_MS
      setIsFrozen(true)
      play('freeze', 0.6)
      triggerFlash('rgba(100,200,255,0.4)')
      // Remove freeze cell
      const updated = gridRef.current.map((c) => c.cellIndex === cell.cellIndex ? { ...c, isFreeze: false } : c)
      gridRef.current = updated
      setGrid(updated)
      return
    }

    if (cell.isJammer && !cell.isDifferent) {
      remainingRef.current = Math.max(0, remainingRef.current - GLITCH_PENALTY_MS)
      setRemainingMs(remainingRef.current)
      streakRef.current = 0
      setStreak(0)

      setShowGlitchTrap(true)
      clearTimer(glitchTimerRef)
      glitchTimerRef.current = window.setTimeout(() => {
        glitchTimerRef.current = null
        setShowGlitchTrap(false)
      }, 900)

      const glitchedGrid = shuffleGrid(
        gridRef.current.map((entry) =>
          entry.cellIndex === cell.cellIndex ? { ...entry, isJammer: false } : entry,
        ),
      )
      gridRef.current = glitchedGrid
      setGrid(glitchedGrid)
      setCellEntryKey((k) => k + 1)
      setShuffleFlash(true)
      setTimeout(() => setShuffleFlash(false), 300)

      play('wrong', 0.55, 0.72)
      triggerShake(10)
      triggerFlash('rgba(239,68,68,0.55)')

      if (remainingRef.current <= 0) finish()
      return
    }

    if (cell.isDifferent) {
      const elapsed = now - roundStartRef.current
      const speedBonus = elapsed < SPEED_BONUS_WINDOW_MS ? Math.round(SPEED_BONUS_PTS * (1 - elapsed / SPEED_BONUS_WINDOW_MS)) : 0
      const isPerfect = elapsed < PERFECT_THRESHOLD_MS
      const perfectBonus = isPerfect ? PERFECT_BONUS_PTS : 0
      const roundMult = 1 + roundRef.current * 0.2
      const feverMul = feverRef.current ? FEVER_MULT : 1
      const doubleMul = doubleRef.current > 0 ? 2 : 1
      const earned = Math.round((BASE_SCORE + speedBonus + perfectBonus) * roundMult * feverMul * doubleMul)

      scoreRef.current += earned
      setScore(scoreRef.current)

      const ns = streakRef.current + 1
      streakRef.current = ns
      setStreak(ns)
      if (ns > maxStreakRef.current) { maxStreakRef.current = ns; setMaxStreak(ns) }

      // Perfect flash
      if (isPerfect) {
        setShowPerfect(true)
        play('perfect', 0.6)
        setTimeout(() => setShowPerfect(false), 800)
      }

      // Streak milestone
      if (ns > 0 && ns % STREAK_MILESTONE === 0) {
        setShowStreakMilestone(ns)
        play('streak', 0.5)
        setTimeout(() => setShowStreakMilestone(0), 1000)
      }

      // Fever activation
      if (ns >= FEVER_STREAK && !feverRef.current) {
        feverRef.current = true
        feverMsRef.current = FEVER_DURATION_MS
        setIsFever(true)
        setFeverMs(FEVER_DURATION_MS)
        triggerFlash('rgba(250,204,21,0.5)')
        play('fever', 0.6)
      } else if (ns > 1) {
        play('combo', 0.4, 1 + ns * 0.04)
      }

      // Fast find time bonus
      if (elapsed < FAST_FIND_THRESHOLD_MS) {
        remainingRef.current = Math.min(ROUND_DURATION_MS, remainingRef.current + FAST_FIND_TIME_BONUS_MS)
        setRemainingMs(remainingRef.current)
      }

      setCorrectFlashIdx(cell.cellIndex)
      clearTimer(correctTimerRef)
      correctTimerRef.current = window.setTimeout(() => { correctTimerRef.current = null; setCorrectFlashIdx(null) }, CORRECT_FLASH_MS)

      play('correct', 0.6, 1 + roundRef.current * 0.03)

      // Burst at cell position
      const cont = containerRef.current
      if (cont) {
        const arena = cont.querySelector('.sd-arena')
        if (arena) {
          const ar = arena.getBoundingClientRect()
          const cr = cont.getBoundingClientRect()
          const col = cell.cellIndex % gridSizeRef.current
          const row = Math.floor(cell.cellIndex / gridSizeRef.current)
          const cw = ar.width / gridSizeRef.current
          const ch = ar.height / gridSizeRef.current
          comboHitBurst(ar.left - cr.left + col * cw + cw / 2, ar.top - cr.top + row * ch + ch / 2, ns, earned)
        }
      }

      triggerFlash('rgba(34,197,94,0.3)')
      advance(now)
    } else {
      remainingRef.current = Math.max(0, remainingRef.current - TIME_PENALTY_MS)
      setRemainingMs(remainingRef.current)
      streakRef.current = 0
      setStreak(0)

      setWrongFlashIdx(cell.cellIndex)
      clearTimer(wrongTimerRef)
      wrongTimerRef.current = window.setTimeout(() => { wrongTimerRef.current = null; setWrongFlashIdx(null) }, WRONG_FLASH_MS)

      play('wrong', 0.5, 0.8)
      triggerShake(8)
      triggerFlash('rgba(239,68,68,0.4)')

      if (remainingRef.current <= 0) finish()
    }
  }, [advance, comboHitBurst, ensureBgm, finish, play, showTransition, triggerFlash, triggerShake])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [onExit])

  useEffect(() => {
    ensureBgm()
    return () => {
      if (getActiveBgmTrack() === spotDiffBgmLoop) {
        stopSharedBgm()
      }
    }
  }, [ensureBgm])

  useEffect(() => {
    const audioMap = audioRef.current
    for (const e of CHARACTER_POOL) {
      const img = new Image(); img.decoding = 'sync'; img.src = e.imageSrc; void img.decode?.().catch(() => {})
    }
    const sfx: Record<string, string> = {
      correct: correctSfx, wrong: wrongSfx, fever: feverSfx, combo: comboSfx,
      timeWarning: timeWarningSfx, roundClear: roundClearSfx,
      shuffle: shuffleSfx, freeze: freezeSfx, perfect: perfectSfx, streak: streakSfx,
      gameOver: gameOverHitSfx,
    }
    for (const [k, s] of Object.entries(sfx)) { const a = new Audio(s); a.preload = 'auto'; audioMap[k] = a }

    return () => {
      clearTimer(wrongTimerRef); clearTimer(correctTimerRef); clearTimer(transTimerRef); clearTimer(glitchTimerRef)
      for (const k of Object.keys(audioMap)) audioMap[k] = null
      cleanupEffects()
    }
  }, [cleanupEffects])

  useEffect(() => {
    roundStartRef.current = window.performance.now()

    const step = (now: number) => {
      if (finishedRef.current) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now

      // Time (skip if frozen)
      if (!frozenRef.current) {
        remainingRef.current = Math.max(0, remainingRef.current - dt)
        setRemainingMs(remainingRef.current)
      } else {
        frozenMsRef.current -= dt
        if (frozenMsRef.current <= 0) { frozenRef.current = false; setIsFrozen(false) }
      }

      // Fever
      if (feverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - dt)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      // Time warning
      if (remainingRef.current <= LOW_TIME_MS && remainingRef.current > 0 && !timeWarnRef.current) {
        timeWarnRef.current = true
        play('timeWarning', 0.4)
      }

      // Shuffle mechanic (high rounds)
      if (roundRef.current >= SHUFFLE_START_ROUND && !frozenRef.current) {
        shuffleTimerRef.current += dt
        if (shuffleTimerRef.current >= getShuffleIntervalMs(roundRef.current)) {
          shuffleTimerRef.current = 0
          const shuffled = shuffleGrid(gridRef.current)
          gridRef.current = shuffled
          setGrid(shuffled)
          setShuffleFlash(true)
          play('shuffle', 0.4)
          setTimeout(() => setShuffleFlash(false), 300)
        }
      }

      // Blackout mechanic (late rounds)
      if (roundRef.current >= BLACKOUT_START_ROUND) {
        if (blackoutMsRef.current > 0) {
          blackoutMsRef.current = Math.max(0, blackoutMsRef.current - dt)
          if (blackoutMsRef.current <= 0) {
            setIsBlackout(false)
          }
        } else if (!frozenRef.current) {
          blackoutTimerRef.current += dt
          if (blackoutTimerRef.current >= getBlackoutIntervalMs(roundRef.current)) {
            blackoutTimerRef.current = 0
            blackoutMsRef.current = BLACKOUT_DURATION_MS
            setIsBlackout(true)
            triggerFlash('rgba(15,23,42,0.42)')
          }
        }
      }

      updateParticles()

      if (remainingRef.current <= 0) { finish(); rafRef.current = null; return }
      rafRef.current = window.requestAnimationFrame(step)
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }; lastFrameRef.current = null }
  }, [finish, play, triggerFlash, updateParticles])

  const bestDisp = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLow = remainingMs <= LOW_TIME_MS && remainingMs > 0
  const timeSec = (remainingMs / 1000).toFixed(1)
  const combo = getComboLabel(streak)
  const comboCol = getComboColor(streak)
  const timePct = Math.max(0, Math.min(100, (remainingMs / ROUND_DURATION_MS) * 100))
  const feverPct = isFever ? Math.max(0, (feverMs / FEVER_DURATION_MS) * 100) : 0
  const timeNote = isBlackout ? 'BLACKOUT' : isFrozen ? 'TIME STOP' : isFever ? 'FEVER RUSH' : doubleLeft > 0 ? 'DOUBLE SCORE' : 'CHAIN BONUS'

  return (
    <section
      ref={containerRef}
      className="mini-game-panel sd-panel"
      aria-label="spot-diff-game"
      style={{ maxWidth: '468px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .sd-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #1a1a2e;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
          font-family: 'Press Start 2P', monospace;
          position: relative;
          image-rendering: pixelated;
        }

        .sd-topbar {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 14px 14px 6px;
          gap: 12px;
          z-index: 3;
          position: relative;
        }

        .sd-game-chip {
          margin: 0;
          font-size: 10px;
          color: #f8fafc;
          background: rgba(15,23,42,0.9);
          border: 2px solid #60a5fa;
          padding: 9px 12px;
          box-shadow: 0 0 0 2px rgba(96,165,250,0.2);
        }

        /* CRT Scanlines */
        .sd-panel::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.08) 2px,
            rgba(0,0,0,0.08) 4px
          );
          pointer-events: none;
          z-index: 50;
        }

        /* Pixel Stars */
        .sd-pixel-stars {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          pointer-events: none;
          z-index: 0;
        }
        .sd-star {
          position: absolute;
          background: #fff;
          opacity: 0;
          animation: sd-twinkle var(--dur, 2s) ease-in-out infinite;
        }
        @keyframes sd-twinkle {
          0%, 100% { opacity: 0; }
          50% { opacity: 0.8; }
        }

        /* Top HUD */
        .sd-hud {
          display: flex;
          align-items: stretch;
          justify-content: space-between;
          padding: 6px 14px 10px;
          gap: 10px;
          z-index: 2;
          position: relative;
        }

        .sd-hud-card {
          background: linear-gradient(180deg, rgba(15,52,96,0.92) 0%, rgba(22,33,62,0.92) 100%);
          border: 2px solid rgba(96,165,250,0.35);
          box-shadow: inset 0 0 0 2px rgba(15,23,42,0.55);
          padding: 10px 12px 9px;
        }

        .sd-score-box {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
          flex: 1.25;
        }

        .sd-score {
          font-size: clamp(26px, 7vw, 38px);
          color: #facc15;
          margin: 0;
          line-height: 1.2;
          text-shadow: 2px 2px 0 #92400e, 0 0 8px rgba(250,204,21,0.3);
        }

        .sd-meta-label {
          font-size: 10px;
          color: #93c5fd;
          margin: 0 0 4px;
          text-shadow: 1px 1px 0 #082f49;
        }

        .sd-meta-label-right {
          text-align: right;
        }

        .sd-best {
          font-size: 9px;
          color: #c4b5fd;
          margin: 0;
        }

        .sd-round-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          flex: 0.95;
        }

        .sd-round-value {
          font-size: clamp(22px, 6vw, 32px);
          color: #22d3ee;
          margin: 0;
          line-height: 1;
          text-shadow: 2px 2px 0 #0e7490;
        }

        .sd-grid-text {
          font-size: 9px;
          color: #67e8f9;
          margin: 0;
          background: rgba(6,182,212,0.2);
          padding: 4px 7px;
          border: 1px solid rgba(6,182,212,0.4);
        }

        .sd-time-box {
          text-align: right;
          flex: 1;
        }

        .sd-time {
          font-size: clamp(23px, 6vw, 34px);
          color: #4ade80;
          margin: 0;
          font-variant-numeric: tabular-nums;
          line-height: 1.2;
          text-shadow: 2px 2px 0 #14532d;
          transition: color 0.2s;
        }

        .sd-time-note {
          font-size: 9px;
          color: #bfdbfe;
          margin: 6px 0 0;
        }

        .sd-time.low {
          color: #ef4444;
          text-shadow: 2px 2px 0 #7f1d1d, 0 0 12px rgba(239,68,68,0.5);
          animation: sd-blink 0.4s step-end infinite;
        }

        .sd-time.frozen {
          color: #67e8f9;
          text-shadow: 2px 2px 0 #164e63, 0 0 12px rgba(103,232,249,0.5);
        }

        @keyframes sd-blink {
          50% { opacity: 0.3; }
        }

        /* Time Bar */
        .sd-time-bar-bg {
          height: 10px;
          background: #16213e;
          margin: 0 14px 4px;
          border: 2px solid #374151;
          z-index: 2;
          position: relative;
        }

        .sd-time-bar {
          height: 100%;
          transition: width 0.1s linear;
          image-rendering: pixelated;
        }

        /* Status Row */
        .sd-status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 6px 14px 8px;
          min-height: 36px;
          z-index: 2;
          position: relative;
          flex-wrap: wrap;
        }

        .sd-combo {
          font-size: 11px;
          margin: 0;
          animation: sd-combo-bounce 0.3s ease-out;
        }

        @keyframes sd-combo-bounce {
          0% { transform: scale(1.5); }
          100% { transform: scale(1); }
        }

        .sd-fever-pill {
          font-size: 9px;
          color: #1a1a2e;
          background: #facc15;
          padding: 5px 10px;
          border: 2px solid #eab308;
          animation: sd-fever-flash 0.3s step-end infinite;
        }

        @keyframes sd-fever-flash {
          50% { background: #fbbf24; border-color: #f59e0b; }
        }

        .sd-double-pill {
          font-size: 9px;
          color: #fff;
          background: #7c3aed;
          padding: 5px 10px;
          border: 2px solid #a78bfa;
        }

        .sd-frozen-pill {
          font-size: 9px;
          color: #1a1a2e;
          background: #67e8f9;
          padding: 5px 10px;
          border: 2px solid #22d3ee;
          animation: sd-freeze-pulse 0.5s step-end infinite;
        }

        @keyframes sd-freeze-pulse {
          50% { opacity: 0.6; }
        }

        .sd-blackout-pill {
          font-size: 9px;
          color: #e2e8f0;
          background: #0f172a;
          padding: 5px 10px;
          border: 2px solid #64748b;
          animation: sd-blink 0.45s step-end infinite;
        }

        /* Fever Bar */
        .sd-fever-bar-bg {
          height: 4px;
          background: #16213e;
          margin: 0 12px 2px;
          border: 1px solid #92400e;
          z-index: 2;
          position: relative;
        }

        .sd-fever-bar {
          height: 100%;
          background: #facc15;
          transition: width 0.1s linear;
        }

        /* Arena */
        .sd-arena {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px 10px;
          position: relative;
          min-height: 0;
          z-index: 2;
        }

        .sd-arena.over {
          opacity: 0.3;
          pointer-events: none;
          filter: grayscale(0.8);
        }

        .sd-blackout-mask {
          position: absolute;
          inset: 6px 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(circle at center, rgba(15,23,42,0.12) 0%, rgba(15,23,42,0.76) 72%),
            repeating-linear-gradient(0deg, rgba(2,6,23,0.14), rgba(2,6,23,0.14) 2px, rgba(2,6,23,0.28) 2px, rgba(2,6,23,0.28) 4px);
          border: 2px solid rgba(148,163,184,0.4);
          pointer-events: none;
          z-index: 6;
        }

        .sd-blackout-text {
          margin: 0;
          font-size: clamp(16px, 5vw, 24px);
          color: rgba(226,232,240,0.92);
          text-shadow: 2px 2px 0 #020617;
          opacity: 0.9;
        }

        .sd-grid {
          justify-content: center;
          align-items: center;
        }

        .sd-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 2px;
          border: 3px solid #374151;
          background: #0f3460;
          cursor: pointer;
          transition: transform 0.08s;
          outline: none;
          -webkit-tap-highlight-color: transparent;
          position: relative;
          overflow: hidden;
          animation: sd-cell-in 0.25s ease-out backwards;
        }

        .sd-cell:active {
          transform: scale(0.88);
        }

        .sd-cell:hover {
          border-color: #60a5fa;
          background: #1e3a5f;
        }

        .sd-cell.wrong {
          background: #7f1d1d;
          border-color: #ef4444;
          animation: sd-cell-shake 0.3s step-end;
          box-shadow: 0 0 0 2px #ef4444, inset 0 0 8px rgba(239,68,68,0.5);
        }

        .sd-cell.correct {
          background: #14532d;
          border-color: #22c55e;
          animation: sd-cell-pop 0.35s ease-out;
          box-shadow: 0 0 0 2px #22c55e, inset 0 0 8px rgba(34,197,94,0.5);
        }

        .sd-cell.freeze-cell {
          border-color: #22d3ee;
          animation: sd-freeze-glow 1s step-end infinite;
        }

        .sd-cell.freeze-cell::before {
          content: '';
          position: absolute;
          top: 2px; right: 2px;
          width: 8px; height: 8px;
          background: #67e8f9;
          z-index: 3;
          clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
        }

        @keyframes sd-freeze-glow {
          50% { border-color: #67e8f9; background: #0e4456; }
        }

        .sd-cell.jammer {
          border-color: #fb7185;
        }

        .sd-cell[data-threat='jammer']::after {
          content: '';
          position: absolute;
          left: 4px;
          bottom: 4px;
          width: 10px;
          height: 10px;
          background: #fb7185;
          clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
          opacity: 0.95;
          box-shadow: 0 0 10px rgba(251,113,133,0.55);
        }

        .sd-cell.shuffle-flash {
          animation: sd-shuffle-spin 0.3s ease-out !important;
        }

        @keyframes sd-cell-in {
          from { transform: scale(0) rotate(180deg); opacity: 0; }
          to { transform: scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes sd-cell-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          50% { transform: translateX(4px); }
          75% { transform: translateX(-2px); }
        }

        @keyframes sd-cell-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.25); }
          100% { transform: scale(1); }
        }

        @keyframes sd-shuffle-spin {
          0% { transform: rotateY(0deg); }
          50% { transform: rotateY(90deg); }
          100% { transform: rotateY(0deg); }
        }

        .sd-cell-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
          image-rendering: pixelated;
        }

        /* Bottom Bar */
        .sd-bottom {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 10px 14px 14px;
          gap: 10px;
          z-index: 2;
          position: relative;
          flex-wrap: wrap;
        }

        .sd-tip-pill {
          font-size: 9px;
          color: #dbeafe;
          background: rgba(15,23,42,0.72);
          border: 2px solid rgba(96,165,250,0.35);
          padding: 6px 10px;
        }

        .sd-tip-pill.warn {
          color: #fecaca;
          border-color: rgba(248,113,113,0.5);
        }

        .sd-tip-pill.danger {
          color: #ffe4e6;
          border-color: rgba(251,113,133,0.55);
          background: rgba(76,5,25,0.72);
        }

        .sd-tip-pill.cool {
          color: #cffafe;
          border-color: rgba(34,211,238,0.5);
        }

        /* Overlays */
        .sd-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 40;
          pointer-events: none;
        }

        .sd-trans-box {
          background: #16213e;
          border: 4px solid #facc15;
          padding: 16px 28px;
          text-align: center;
          animation: sd-trans-in 0.25s ease-out;
          box-shadow: 0 0 20px rgba(250,204,21,0.3);
        }

        .sd-trans-title {
          font-size: clamp(16px, 4vw, 22px);
          color: #facc15;
          margin: 0 0 6px;
          text-shadow: 2px 2px 0 #92400e;
        }

        .sd-trans-sub {
          font-size: 8px;
          color: #67e8f9;
          margin: 0;
        }

        @keyframes sd-trans-in {
          from { transform: scale(0.3); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .sd-perfect-popup {
          position: absolute;
          top: 35%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: clamp(18px, 5vw, 26px);
          color: #f0abfc;
          text-shadow: 2px 2px 0 #701a75, 0 0 16px rgba(240,171,252,0.5);
          z-index: 42;
          animation: sd-perfect-fly 0.8s ease-out forwards;
          pointer-events: none;
        }

        @keyframes sd-perfect-fly {
          0% { transform: translate(-50%, -50%) scale(2); opacity: 0; }
          30% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -80%) scale(0.8); opacity: 0; }
        }

        .sd-streak-popup {
          position: absolute;
          top: 42%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: clamp(12px, 3.5vw, 18px);
          color: #fbbf24;
          text-shadow: 2px 2px 0 #92400e;
          z-index: 42;
          animation: sd-streak-fly 1s ease-out forwards;
          pointer-events: none;
        }

        @keyframes sd-streak-fly {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          20% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          70% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -70%); opacity: 0; }
        }

        .sd-time-bonus-popup {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 14px;
          color: #4ade80;
          text-shadow: 2px 2px 0 #14532d;
          z-index: 42;
          animation: sd-bonus-fly 1.2s ease-out forwards;
          pointer-events: none;
        }

        @keyframes sd-bonus-fly {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          20% { transform: translate(-50%, -50%) scale(1.2); opacity: 1; }
          80% { transform: translate(-50%, -70%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -90%); opacity: 0; }
        }

        .sd-glitch-popup {
          position: absolute;
          top: 46%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: clamp(14px, 4.5vw, 22px);
          color: #fb7185;
          text-shadow: 2px 2px 0 #881337, -2px 0 0 rgba(34,211,238,0.7);
          z-index: 42;
          animation: sd-glitch-fly 0.9s ease-out forwards;
          pointer-events: none;
        }

        @keyframes sd-glitch-fly {
          0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
          20% { transform: translate(-51%, -50%) scale(1.15); opacity: 1; }
          40% { transform: translate(-49%, -50%) scale(0.96); }
          100% { transform: translate(-50%, -78%) scale(0.86); opacity: 0; }
        }

        /* Game Over */
        .sd-gameover {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(26,26,46,0.92);
          z-index: 45;
          animation: sd-trans-in 0.4s ease-out;
        }

        .sd-go-title {
          font-size: clamp(20px, 6vw, 30px);
          color: #ef4444;
          margin: 0 0 12px;
          text-shadow: 3px 3px 0 #7f1d1d;
          animation: sd-blink 0.6s step-end infinite;
        }

        .sd-go-score {
          font-size: clamp(28px, 8vw, 40px);
          color: #facc15;
          margin: 0 0 8px;
          text-shadow: 3px 3px 0 #92400e;
        }

        .sd-go-detail {
          font-size: 8px;
          color: #a78bfa;
          margin: 3px 0;
        }

        .sd-go-best {
          font-size: 10px;
          color: #4ade80;
          margin: 10px 0 0;
          text-shadow: 1px 1px 0 #14532d;
          animation: sd-blink 0.5s step-end infinite;
        }
      `}</style>

      <PixelStars count={30} />
      <FlashOverlay isFlashing={isFlashing} flashColor={flashColor} />
      <ParticleRenderer particles={particles} />
      <ScorePopupRenderer popups={scorePopups} />

      <div className="sd-topbar">
        <p className="sd-game-chip">SPOT DIFF</p>
      </div>

      {/* HUD */}
      <div className="sd-hud">
        <div className="sd-score-box sd-hud-card">
          <p className="sd-meta-label">SCORE</p>
          <p className="sd-score">{score.toLocaleString()}</p>
          <p className="sd-best">BEST {bestDisp.toLocaleString()}</p>
        </div>
        <div className="sd-round-box sd-hud-card">
          <p className="sd-meta-label">ROUND</p>
          <p className="sd-round-value">{round + 1}</p>
          <p className="sd-grid-text">{gridSize}x{gridSize} GRID</p>
        </div>
        <div className="sd-time-box sd-hud-card">
          <p className="sd-meta-label sd-meta-label-right">TIME</p>
          <p className={`sd-time ${isLow ? 'low' : ''} ${isFrozen ? 'frozen' : ''}`}>
            {isFrozen ? 'FREEZE' : `${timeSec}s`}
          </p>
          <p className="sd-time-note">{timeNote}</p>
        </div>
      </div>

      {/* Time Bar */}
      <div className="sd-time-bar-bg">
        <div className="sd-time-bar" style={{
          width: `${timePct}%`,
          background: isFrozen ? '#67e8f9' : isLow ? '#ef4444' : isFever ? '#facc15' : '#4ade80',
        }} />
      </div>

      {/* Status */}
      <div className="sd-status">
        {combo && <p className="sd-combo" style={{ color: comboCol, textShadow: `1px 1px 0 rgba(0,0,0,0.5)` }}>{combo} x{streak}</p>}
        {isFever && <span className="sd-fever-pill">FEVER x{FEVER_MULT} {(feverMs / 1000).toFixed(1)}s</span>}
        {doubleLeft > 0 && <span className="sd-double-pill">x2 ({doubleLeft})</span>}
        {isFrozen && <span className="sd-frozen-pill">FROZEN!</span>}
        {isBlackout && <span className="sd-blackout-pill">BLACKOUT</span>}
      </div>

      {isFever && (
        <div className="sd-fever-bar-bg">
          <div className="sd-fever-bar" style={{ width: `${feverPct}%` }} />
        </div>
      )}

      {/* Arena */}
      <div className={`sd-arena ${isGameOver ? 'over' : ''}`}>
        <div
          className="sd-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
            gridTemplateRows: `repeat(${gridSize}, 1fr)`,
            gap: gridSize <= 4 ? '5px' : '3px',
            width: '100%',
            height: '100%',
            maxWidth: '400px',
            maxHeight: '100%',
            aspectRatio: '1/1',
          }}
        >
          {grid.map((cell, i) => {
            const isWrong = wrongFlashIdx === cell.cellIndex
            const isCorrect = correctFlashIdx === cell.cellIndex
            let cls = 'sd-cell'
            if (isWrong) cls += ' wrong'
            if (isCorrect) cls += ' correct'
            if (cell.isFreeze) cls += ' freeze-cell'
            if (cell.isJammer) cls += ' jammer'
            if (shuffleFlash) cls += ' shuffle-flash'

            return (
              <button
                key={`${cellEntryKey}-${cell.cellIndex}`}
                className={cls}
                type="button"
                onClick={() => handleTap(cell)}
                disabled={isGameOver}
                data-threat={cell.isJammer ? 'jammer' : undefined}
                style={{ animationDelay: `${i * 0.02}s` }}
              >
                <img className="sd-cell-img" src={cell.character.imageSrc} alt={cell.character.name} draggable={false} />
              </button>
            )
          })}
        </div>
        {isBlackout && (
          <div className="sd-blackout-mask" aria-hidden>
            <p className="sd-blackout-text">BLACKOUT</p>
          </div>
        )}
      </div>

      {/* Bottom */}
      <div className="sd-bottom">
        <span className="sd-tip-pill">ODD ONE = SCORE</span>
        <span className="sd-tip-pill warn">MISS: -{TIME_PENALTY_MS / 1000}s</span>
        <span className="sd-tip-pill danger">GLITCH: -{GLITCH_PENALTY_MS / 1000}s</span>
        <span className="sd-tip-pill cool">FREEZE STOPS TIME</span>
      </div>

      {/* Round Transition */}
      {showTransition && (
        <div className="sd-overlay">
          <div className="sd-trans-box">
            <p className="sd-trans-title">{transitionText}</p>
            <p className="sd-trans-sub">{transitionSub}</p>
          </div>
        </div>
      )}

      {/* Perfect */}
      {showPerfect && <div className="sd-perfect-popup">PERFECT!</div>}

      {/* Glitch Trap */}
      {showGlitchTrap && <div className="sd-glitch-popup">GLITCH TRAP!</div>}

      {/* Streak Milestone */}
      {showStreakMilestone > 0 && <div className="sd-streak-popup">{showStreakMilestone} STREAK!</div>}

      {/* Time Bonus */}
      {timeBonusPopup && <div className="sd-time-bonus-popup">+5s BONUS!</div>}

      {/* Game Over */}
      {isGameOver && (
        <div className="sd-gameover">
          <p className="sd-go-title">GAME OVER</p>
          <p className="sd-go-score">{score.toLocaleString()}</p>
          <p className="sd-go-detail">ROUND {round + 1}</p>
          <p className="sd-go-detail">MAX STREAK: {maxStreak}</p>
          {score > bestScore && bestScore > 0 && <p className="sd-go-best">NEW BEST!</p>}
        </div>
      )}
    </section>
  )
}

export const spotDiffModule: MiniGameModule = {
  manifest: {
    id: 'spot-diff',
    title: 'Spot Diff',
    description: 'Find the odd one while glitches, blackout, and shuffles pile on.',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#6366f1',
  },
  Component: SpotDiffGame,
}
