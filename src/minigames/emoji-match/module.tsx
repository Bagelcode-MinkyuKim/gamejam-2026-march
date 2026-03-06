import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterImg from '../../../assets/images/same-character/kim-yeonja.png'

// 8-bit sound imports
import correctSfx from '../../../assets/sounds/emoji-match-correct-8bit.mp3'
import wrongSfx from '../../../assets/sounds/emoji-match-wrong-8bit.mp3'
import comboSfx from '../../../assets/sounds/emoji-match-combo-8bit.mp3'
import feverSfx from '../../../assets/sounds/emoji-match-fever-8bit.mp3'
import shuffleSfx from '../../../assets/sounds/emoji-match-shuffle-8bit.mp3'
import mysterySfx from '../../../assets/sounds/emoji-match-mystery-8bit.mp3'
import perfectSfx from '../../../assets/sounds/emoji-match-perfect-8bit.mp3'
import dangerSfx from '../../../assets/sounds/emoji-match-danger-8bit.mp3'
import gameOverSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Constants ────────────────────────────────────────────

const ROUND_DURATION_MS = 45000
const GRID_SIZE = 4
const GRID_CELL_COUNT = GRID_SIZE * GRID_SIZE
const SCORE_CORRECT = 5
const SCORE_WRONG = -2
const INITIAL_POOL_SIZE = 8
const POOL_GROWTH_PER_ROUND = 2
const MAX_POOL_SIZE = 20
const FEEDBACK_DURATION_MS = 220
const SHUFFLE_ANIMATION_MS = 160
const LOW_TIME_THRESHOLD_MS = 8000

// Gimmick
const COMBO_MULTIPLIER_STEP = 0.25
const SPEED_BONUS_THRESHOLD_MS = 1500
const SPEED_BONUS_POINTS = 5
const TIME_BONUS_PER_CORRECT_MS = 350
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 3

// Special items
const BOMB_CHANCE = 0.07
const MYSTERY_CHANCE = 0.06
const FREEZE_CHANCE = 0.05
const BOMB_EMOJI = '\u{1F4A3}'
const MYSTERY_EMOJI = '\u{2753}'
const FREEZE_EMOJI = '\u{2744}\u{FE0F}'
const FREEZE_DURATION_MS = 3000

const COMBO_MILESTONES = [5, 10, 15, 25, 40] as const

// Pixel art item pool — retro game sprites as styled emoji
const ITEM_POOL = [
  { emoji: '\u{2764}\u{FE0F}', label: 'HEART', color: '#ef4444' },
  { emoji: '\u{2B50}', label: 'STAR', color: '#eab308' },
  { emoji: '\u{1F48E}', label: 'GEM', color: '#3b82f6' },
  { emoji: '\u{1F451}', label: 'CROWN', color: '#f59e0b' },
  { emoji: '\u{1F525}', label: 'FIRE', color: '#f97316' },
  { emoji: '\u{26A1}', label: 'BOLT', color: '#facc15' },
  { emoji: '\u{1F31F}', label: 'GLOW', color: '#a855f7' },
  { emoji: '\u{1F480}', label: 'SKULL', color: '#9ca3af' },
  { emoji: '\u{1F47E}', label: 'ALIEN', color: '#22c55e' },
  { emoji: '\u{1F916}', label: 'ROBOT', color: '#6366f1' },
  { emoji: '\u{1F34E}', label: 'APPLE', color: '#dc2626' },
  { emoji: '\u{1F344}', label: 'SHROOM', color: '#b91c1c' },
  { emoji: '\u{1F3AE}', label: 'PAD', color: '#7c3aed' },
  { emoji: '\u{1F3B2}', label: 'DICE', color: '#f472b6' },
  { emoji: '\u{1F3AF}', label: 'TARGET', color: '#ef4444' },
  { emoji: '\u{1F52E}', label: 'ORB', color: '#8b5cf6' },
  { emoji: '\u{1F6E1}\u{FE0F}', label: 'SHIELD', color: '#3b82f6' },
  { emoji: '\u{2694}\u{FE0F}', label: 'SWORD', color: '#6b7280' },
  { emoji: '\u{1F48A}', label: 'POTION', color: '#14b8a6' },
  { emoji: '\u{1F36D}', label: 'CANDY', color: '#ec4899' },
]

const PIXEL_PARTICLES = ['\u{25A0}', '\u{25AA}', '\u{25AB}', '\u{2588}', '\u{2592}', '\u{2593}'] as const
const NEON_COLORS = ['#00ff88', '#ff0080', '#00ccff', '#ffcc00', '#ff6600', '#cc00ff', '#00ffcc', '#ff3333'] as const

// ─── Helpers ──────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function buildGrid(targetIdx: number, poolSize: number): number[] {
  const targetCount = 1 + Math.floor(Math.random() * 2)
  const targetPositions = new Set<number>()
  while (targetPositions.size < targetCount) {
    targetPositions.add(Math.floor(Math.random() * GRID_CELL_COUNT))
  }

  const cells: number[] = []
  for (let i = 0; i < GRID_CELL_COUNT; i++) {
    if (targetPositions.has(i)) {
      cells.push(targetIdx)
    } else {
      const rand = Math.random()
      if (rand < BOMB_CHANCE) {
        cells.push(-1) // bomb
      } else if (rand < BOMB_CHANCE + MYSTERY_CHANCE) {
        cells.push(-2) // mystery
      } else if (rand < BOMB_CHANCE + MYSTERY_CHANCE + FREEZE_CHANCE) {
        cells.push(-3) // freeze
      } else {
        let distractor = Math.floor(Math.random() * poolSize)
        while (distractor === targetIdx) {
          distractor = Math.floor(Math.random() * poolSize)
        }
        cells.push(distractor)
      }
    }
  }
  return cells
}

function pickNewTarget(current: number, poolSize: number): number {
  let next = Math.floor(Math.random() * poolSize)
  while (next === current && poolSize > 1) {
    next = Math.floor(Math.random() * poolSize)
  }
  return next
}

function computePoolSize(round: number): number {
  return Math.min(MAX_POOL_SIZE, INITIAL_POOL_SIZE + (round - 1) * POOL_GROWTH_PER_ROUND)
}

function getComboLabel(c: number): string {
  if (c < 3) return ''
  if (c < 5) return 'NICE'
  if (c < 10) return 'GREAT'
  if (c < 15) return 'AMAZING'
  if (c < 25) return 'FANTASTIC'
  return 'GODLIKE'
}

// ─── Types ────────────────────────────────────────────────

interface PixelParticle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly char: string
  readonly color: string
  readonly size: number
  readonly createdAt: number
}

interface FloatText {
  readonly id: number
  readonly text: string
  readonly x: number
  readonly y: number
  readonly color: string
  readonly size: number
  readonly createdAt: number
}

type CellFB = { index: number; kind: 'correct' | 'wrong' | 'bomb' | 'mystery' | 'freeze' }

// Mystery block rewards
type MysteryReward = 'points' | 'time' | 'fever' | 'doubleNext'

function rollMysteryReward(): MysteryReward {
  const r = Math.random()
  if (r < 0.35) return 'points'
  if (r < 0.6) return 'time'
  if (r < 0.85) return 'fever'
  return 'doubleNext'
}

// ─── Game Component ───────────────────────────────────────

function EmojiMatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [round, setRound] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [targetIdx, setTargetIdx] = useState(() => Math.floor(Math.random() * INITIAL_POOL_SIZE))
  const [grid, setGrid] = useState<number[]>(() => buildGrid(targetIdx, INITIAL_POOL_SIZE))
  const [cellFB, setCellFB] = useState<CellFB | null>(null)
  const [isShuffling, setIsShuffling] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [isFrozen, setIsFrozen] = useState(false)
  const [frozenMs, setFrozenMs] = useState(0)
  const [isDoubleNext, setIsDoubleNext] = useState(false)
  const [particles, setParticles] = useState<PixelParticle[]>([])
  const [floats, setFloats] = useState<FloatText[]>([])
  const [isShaking, setIsShaking] = useState(false)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [flashColor, setFlashColor] = useState('')
  const [bgHue, setBgHue] = useState(220)
  const [milestone, setMilestone] = useState<string | null>(null)
  const [phase, setPhase] = useState<'playing' | 'finished'>('playing')
  const [correctCount, setCorrectCount] = useState(0)
  const [perfectRounds, setPerfectRounds] = useState(0)
  const [, setWrongInRound] = useState(false)
  const [, setDangerPlayed] = useState(false)
  const [isNewRecord, setIsNewRecord] = useState(false)
  const [crtFlicker, setCrtFlicker] = useState(false)

  // Refs
  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const roundRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const targetIdxRef = useRef(targetIdx)
  const finishedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const fbTimerRef = useRef<number | null>(null)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const isFrozenRef = useRef(false)
  const frozenMsRef = useRef(0)
  const isDoubleNextRef = useRef(false)
  const lastCorrectRef = useRef(0)
  const pIdRef = useRef(0)
  const particlesRef = useRef<PixelParticle[]>([])
  const ftIdRef = useRef(0)
  const floatsRef = useRef<FloatText[]>([])
  const shakeTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const msTimerRef = useRef<number | null>(null)
  const lastMsRef = useRef(0)
  const correctCountRef = useRef(0)
  const perfectRoundsRef = useRef(0)
  const wrongInRoundRef = useRef(false)
  const gridRef = useRef(grid)
  gridRef.current = grid

  // Audio refs
  const correctARef = useRef<HTMLAudioElement | null>(null)
  const wrongARef = useRef<HTMLAudioElement | null>(null)
  const comboARef = useRef<HTMLAudioElement | null>(null)
  const feverARef = useRef<HTMLAudioElement | null>(null)
  const shuffleARef = useRef<HTMLAudioElement | null>(null)
  const mysteryARef = useRef<HTMLAudioElement | null>(null)
  const perfectARef = useRef<HTMLAudioElement | null>(null)
  const dangerARef = useRef<HTMLAudioElement | null>(null)
  const gameOverARef = useRef<HTMLAudioElement | null>(null)

  const clrTimer = (r: { current: number | null }) => {
    if (r.current !== null) { window.clearTimeout(r.current); r.current = null }
  }

  const playA = useCallback((r: { current: HTMLAudioElement | null }, vol: number, rate = 1) => {
    const a = r.current
    if (!a) return
    a.currentTime = 0
    a.volume = Math.min(1, Math.max(0, vol))
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  // Pixel particles
  const spawnPixels = useCallback((count: number, cx: number, cy: number, colors?: readonly string[]) => {
    const now = performance.now()
    const cols = colors ?? NEON_COLORS
    const np: PixelParticle[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.9
      const speed = 120 + Math.random() * 250
      pIdRef.current++
      np.push({
        id: pIdRef.current,
        x: cx + (Math.random() - 0.5) * 20,
        y: cy + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        char: pick(PIXEL_PARTICLES),
        color: pick(cols),
        size: 10 + Math.random() * 16,
        createdAt: now,
      })
    }
    const merged = [...particlesRef.current, ...np].slice(-50)
    particlesRef.current = merged
    setParticles(merged)
  }, [])

  const spawnFloat = useCallback((text: string, x: number, y: number, color: string, size = 20) => {
    ftIdRef.current++
    const f: FloatText = { id: ftIdRef.current, text, x, y, color, size, createdAt: performance.now() }
    const merged = [...floatsRef.current, f].slice(-12)
    floatsRef.current = merged
    setFloats(merged)
  }, [])

  const shake = useCallback((intensity: number) => {
    setIsShaking(true)
    setShakeIntensity(intensity)
    clrTimer(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsShaking(false)
      setShakeIntensity(0)
    }, 120)
  }, [])

  const flash = useCallback((color: string, dur = 80) => {
    setFlashColor(color)
    clrTimer(flashTimerRef)
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      setFlashColor('')
    }, dur)
  }, [])

  const showMilestone = useCallback((text: string) => {
    setMilestone(text)
    clrTimer(msTimerRef)
    msTimerRef.current = window.setTimeout(() => { msTimerRef.current = null; setMilestone(null) }, 1200)
  }, [])

  const triggerCrtFlicker = useCallback(() => {
    setCrtFlicker(true)
    setTimeout(() => setCrtFlicker(false), 100)
  }, [])

  const advanceRound = useCallback(() => {
    // Perfect round check
    if (!wrongInRoundRef.current) {
      perfectRoundsRef.current++
      setPerfectRounds(perfectRoundsRef.current)
      const bonus = 15 + roundRef.current * 2
      scoreRef.current += bonus
      setScore(scoreRef.current)
      playA(perfectARef, 0.5, 1.1)
      spawnFloat(`PERFECT! +${bonus}`, 160, 120, '#00ff88', 24)
      spawnPixels(10, 200, 200, ['#00ff88', '#00ffcc', '#88ff00'])
    }

    const nextRound = roundRef.current + 1
    roundRef.current = nextRound
    setRound(nextRound)
    setWrongInRound(false)
    wrongInRoundRef.current = false

    // Bonus every 5 rounds
    if (nextRound % 5 === 0) {
      const bonusTime = 2000
      const bonusScore = 10 * nextRound
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + bonusTime)
      scoreRef.current += bonusScore
      setScore(scoreRef.current)
      playA(comboARef, 0.6, 1.3)
      showMilestone(`STAGE ${nextRound}`)
      spawnFloat(`+${bonusScore} +${bonusTime / 1000}s`, 150, 180, '#ffcc00', 26)
      spawnPixels(14, 200, 250, ['#ffcc00', '#ff6600', '#ff0080'])
      shake(10)
      flash('rgba(255,204,0,0.3)', 150)
      triggerCrtFlicker()
    }

    const nextPoolSize = computePoolSize(nextRound)
    const nextTarget = pickNewTarget(targetIdxRef.current, nextPoolSize)
    targetIdxRef.current = nextTarget
    setTargetIdx(nextTarget)

    setIsShuffling(true)
    playA(shuffleARef, 0.35, 1.1 + Math.random() * 0.2)
    const nextGrid = buildGrid(nextTarget, nextPoolSize)
    setTimeout(() => {
      setGrid(nextGrid)
      setIsShuffling(false)
    }, SHUFFLE_ANIMATION_MS)
  }, [playA, spawnFloat, spawnPixels, showMilestone, shake, flash, triggerCrtFlicker])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setPhase('finished')
    clrTimer(fbTimerRef)
    playA(gameOverARef, 0.64, 0.95)
    triggerCrtFlicker()

    if (scoreRef.current > bestScore) {
      setTimeout(() => setIsNewRecord(true), 800)
    }

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playA, bestScore, triggerCrtFlicker])

  const handleCellTap = useCallback((cellIndex: number) => {
    if (finishedRef.current || isShuffling || phase !== 'playing') return
    if (cellFB !== null && cellFB.kind === 'correct') return

    const cellVal = gridRef.current[cellIndex]
    const col = cellIndex % GRID_SIZE
    const row = Math.floor(cellIndex / GRID_SIZE)
    const px = 16 + col * 92 + 42
    const py = 260 + row * 92 + 42

    // --- Bomb ---
    if (cellVal === -1) {
      playA(comboARef, 0.5, 0.8)
      shake(14)
      flash('rgba(255,100,0,0.5)', 150)
      spawnPixels(18, px, py, ['#ff6600', '#ff0000', '#ffcc00', '#ff3333'])
      const bombScore = 15 * (isFeverRef.current ? FEVER_MULTIPLIER : 1) * (isDoubleNextRef.current ? 2 : 1)
      if (isDoubleNextRef.current) { isDoubleNextRef.current = false; setIsDoubleNext(false) }
      scoreRef.current += bombScore
      setScore(scoreRef.current)
      spawnFloat(`BOOM +${bombScore}`, px - 30, py - 30, '#ff6600', 24)
      triggerCrtFlicker()
      setCellFB({ index: cellIndex, kind: 'bomb' })
      clrTimer(fbTimerRef)
      fbTimerRef.current = window.setTimeout(() => { fbTimerRef.current = null; setCellFB(null); advanceRound() }, FEEDBACK_DURATION_MS)
      return
    }

    // --- Mystery ---
    if (cellVal === -2) {
      playA(mysteryARef, 0.5)
      const reward = rollMysteryReward()
      let rewardText = ''
      let rewardColor = '#ffcc00'

      switch (reward) {
        case 'points': {
          const pts = 25 * (isFeverRef.current ? FEVER_MULTIPLIER : 1)
          scoreRef.current += pts
          setScore(scoreRef.current)
          rewardText = `+${pts} PTS`
          rewardColor = '#00ff88'
          break
        }
        case 'time': {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + 5000)
          rewardText = '+5s TIME'
          rewardColor = '#00ccff'
          break
        }
        case 'fever': {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playA(feverARef, 0.5)
          rewardText = 'FEVER!'
          rewardColor = '#ff0080'
          break
        }
        case 'doubleNext': {
          isDoubleNextRef.current = true
          setIsDoubleNext(true)
          rewardText = 'x2 NEXT'
          rewardColor = '#cc00ff'
          break
        }
      }

      spawnPixels(12, px, py, ['#ffcc00', '#cc00ff', '#00ff88', '#00ccff'])
      spawnFloat(`? ${rewardText}`, px - 40, py - 30, rewardColor, 22)
      shake(6)
      flash('rgba(204,0,255,0.3)', 120)
      triggerCrtFlicker()

      setCellFB({ index: cellIndex, kind: 'mystery' })
      clrTimer(fbTimerRef)
      fbTimerRef.current = window.setTimeout(() => { fbTimerRef.current = null; setCellFB(null); advanceRound() }, FEEDBACK_DURATION_MS + 100)
      return
    }

    // --- Freeze ---
    if (cellVal === -3) {
      playA(comboARef, 0.5, 0.7)
      flash('rgba(0,180,255,0.4)', 200)
      spawnPixels(10, px, py, ['#00ccff', '#88ddff', '#00ff88'])
      spawnFloat('FREEZE!', px - 30, py - 30, '#00ccff', 24)
      isFrozenRef.current = true
      frozenMsRef.current = FREEZE_DURATION_MS
      setIsFrozen(true)
      setFrozenMs(FREEZE_DURATION_MS)

      setCellFB({ index: cellIndex, kind: 'freeze' })
      clrTimer(fbTimerRef)
      fbTimerRef.current = window.setTimeout(() => { fbTimerRef.current = null; setCellFB(null) }, FEEDBACK_DURATION_MS)
      return
    }

    // --- Correct ---
    const isCorrect = cellVal === targetIdxRef.current
    if (isCorrect) {
      const now = performance.now()
      const timeSinceLast = now - lastCorrectRef.current
      lastCorrectRef.current = now

      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      setCombo(nextCombo)
      if (nextCombo > maxComboRef.current) { maxComboRef.current = nextCombo; setMaxCombo(nextCombo) }
      correctCountRef.current++
      setCorrectCount(correctCountRef.current)

      const comboMult = 1 + nextCombo * COMBO_MULTIPLIER_STEP
      const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
      const doubleMult = isDoubleNextRef.current ? 2 : 1
      const isSpeed = timeSinceLast > 0 && timeSinceLast < SPEED_BONUS_THRESHOLD_MS
      const speedBonus = isSpeed ? SPEED_BONUS_POINTS : 0
      const totalPts = Math.round((SCORE_CORRECT + speedBonus) * comboMult * feverMult * doubleMult)

      if (isDoubleNextRef.current) { isDoubleNextRef.current = false; setIsDoubleNext(false) }

      scoreRef.current += totalPts
      setScore(scoreRef.current)
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CORRECT_MS)

      // Fever
      if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
        isFeverRef.current = true
        feverMsRef.current = FEVER_DURATION_MS
        setIsFever(true)
        setFeverMs(FEVER_DURATION_MS)
        playA(feverARef, 0.6)
        spawnPixels(20, px, py, ['#ff0080', '#ff3333', '#ff6600', '#ffcc00'])
        spawnFloat('FEVER x3!', px - 40, py - 50, '#ff0080', 30)
        shake(14)
        triggerCrtFlicker()
      }

      // Combo milestones
      for (const ms of COMBO_MILESTONES) {
        if (nextCombo === ms && lastMsRef.current < ms) {
          lastMsRef.current = ms
          playA(comboARef, 0.6, 0.8 + ms * 0.01)
          showMilestone(`${ms} COMBO!`)
          spawnPixels(14, 200, 300, ['#ffcc00', '#ff0080', '#00ff88'])
          triggerCrtFlicker()
          break
        }
      }

      if (isSpeed) {
        spawnFloat('FAST!', px + 20, py - 20, '#00ffcc', 16)
      }

      const pitch = 1 + Math.min(0.5, nextCombo * 0.04)
      playA(correctARef, 0.5, pitch)

      const pCount = Math.min(12, 5 + Math.floor(nextCombo / 3))
      const itemColor = ITEM_POOL[cellVal]?.color ?? '#00ff88'
      spawnPixels(pCount, px, py, [itemColor, '#00ff88', '#ffcc00', '#00ccff'])
      spawnFloat(`+${totalPts}`, px, py - 20, isFeverRef.current ? '#ff0080' : '#00ff88', 22 + Math.min(10, nextCombo))
      flash('rgba(0,255,136,0.3)')
      shake(Math.min(10, 2 + nextCombo * 0.3))
      setBgHue(prev => (prev + 15 + Math.random() * 10) % 360)

      setCellFB({ index: cellIndex, kind: 'correct' })
      clrTimer(fbTimerRef)
      fbTimerRef.current = window.setTimeout(() => { fbTimerRef.current = null; setCellFB(null); advanceRound() }, FEEDBACK_DURATION_MS)
    } else {
      // --- Wrong ---
      comboRef.current = 0
      setCombo(0)
      lastMsRef.current = 0
      wrongInRoundRef.current = true
      setWrongInRound(true)

      scoreRef.current = Math.max(0, scoreRef.current + SCORE_WRONG)
      setScore(scoreRef.current)

      playA(wrongARef, 0.45, 0.85)
      shake(8)
      flash('rgba(255,0,0,0.4)')
      spawnFloat(`-${Math.abs(SCORE_WRONG)}`, px, py - 20, '#ff3333', 18)
      spawnPixels(4, px, py, ['#ff3333', '#ff0000'])
      triggerCrtFlicker()

      setCellFB({ index: cellIndex, kind: 'wrong' })
      clrTimer(fbTimerRef)
      fbTimerRef.current = window.setTimeout(() => { fbTimerRef.current = null; setCellFB(null) }, FEEDBACK_DURATION_MS)
    }
  }, [isShuffling, cellFB, phase, playA, advanceRound, spawnPixels, spawnFloat, shake, flash, showMilestone, triggerCrtFlicker])

  // Key handler
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit])

  // Audio preload
  useEffect(() => {
    const srcs = [
      { ref: correctARef, src: correctSfx },
      { ref: wrongARef, src: wrongSfx },
      { ref: comboARef, src: comboSfx },
      { ref: feverARef, src: feverSfx },
      { ref: shuffleARef, src: shuffleSfx },
      { ref: mysteryARef, src: mysterySfx },
      { ref: perfectARef, src: perfectSfx },
      { ref: dangerARef, src: dangerSfx },
      { ref: gameOverARef, src: gameOverSfx },
    ]
    for (const { ref, src } of srcs) { const a = new Audio(src); a.preload = 'auto'; ref.current = a }
    return () => {
      clrTimer(fbTimerRef); clrTimer(shakeTimerRef); clrTimer(flashTimerRef); clrTimer(msTimerRef)
      for (const { ref } of srcs) ref.current = null
    }
  }, [])

  // Main game loop
  useEffect(() => {
    lastFrameRef.current = null
    const step = (now: number) => {
      if (finishedRef.current) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now

      // Frozen
      if (isFrozenRef.current) {
        frozenMsRef.current = Math.max(0, frozenMsRef.current - dt)
        setFrozenMs(frozenMsRef.current)
        if (frozenMsRef.current <= 0) { isFrozenRef.current = false; setIsFrozen(false) }
      }

      if (!isFrozenRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - dt)
      }
      setRemainingMs(remainingMsRef.current)

      // Danger sound
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > LOW_TIME_THRESHOLD_MS - 100) {
        setDangerPlayed(prev => { if (!prev) { playA(dangerARef, 0.4); return true }; return prev })
      }

      // Fever
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - dt)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { isFeverRef.current = false; setIsFever(false) }
      }

      // Cleanup particles
      const ap = particlesRef.current.filter(p => now - p.createdAt < 700)
      if (ap.length !== particlesRef.current.length) { particlesRef.current = ap; setParticles(ap) }
      const af = floatsRef.current.filter(f => now - f.createdAt < 1200)
      if (af.length !== floatsRef.current.length) { floatsRef.current = af; setFloats(af) }

      if (remainingMsRef.current <= 0) { finishGame(); rafRef.current = null; return }
      rafRef.current = window.requestAnimationFrame(step)
    }
    rafRef.current = window.requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }; lastFrameRef.current = null }
  }, [finishGame, playA])

  // Derived
  const displayBest = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLow = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const comboMult = 1 + combo * COMBO_MULTIPLIER_STEP
  const comboLabel = getComboLabel(combo)
  const timerSec = (remainingMs / 1000).toFixed(1)
  const progress = ((ROUND_DURATION_MS - remainingMs) / ROUND_DURATION_MS) * 100
  const targetItem = ITEM_POOL[targetIdx]

  const shakeStyle = isShaking
    ? { transform: `translate(${(Math.random() - 0.5) * shakeIntensity * 2}px, ${(Math.random() - 0.5) * shakeIntensity * 2}px)` }
    : undefined

  return (
    <section
      className={`mini-game-panel em-retro ${crtFlicker ? 'crt-flicker' : ''}`}
      aria-label="emoji-match-game"
      style={{ position: 'relative', maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', ...shakeStyle }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .em-retro {
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, #0a0a1a 0%, #0f0f2e 50%, #1a0a2e 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          font-family: 'Press Start 2P', monospace;
          image-rendering: pixelated;
          color: #e0e0e0;
        }

        /* CRT scanline overlay */
        .em-retro::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.12) 2px,
            rgba(0,0,0,0.12) 4px
          );
          pointer-events: none;
          z-index: 50;
        }

        .em-retro.crt-flicker::after {
          background: repeating-linear-gradient(
            0deg,
            rgba(255,255,255,0.03),
            rgba(255,255,255,0.03) 2px,
            rgba(0,0,0,0.15) 2px,
            rgba(0,0,0,0.15) 4px
          );
        }

        /* Header */
        .em-hdr {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px 6px;
          background: linear-gradient(180deg, rgba(0,255,136,0.15), rgba(0,0,0,0));
          border-bottom: 2px solid #00ff88;
          flex-shrink: 0;
        }

        .em-avatar {
          width: 36px;
          height: 36px;
          border-radius: 4px;
          border: 2px solid #00ff88;
          image-rendering: pixelated;
          box-shadow: 0 0 8px rgba(0,255,136,0.4);
        }

        .em-sc { flex: 1; }

        .em-sc-val {
          margin: 0;
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 400;
          color: #00ff88;
          text-shadow: 0 0 8px rgba(0,255,136,0.6);
        }

        .em-sc-val.fever { color: #ff0080; text-shadow: 0 0 12px rgba(255,0,128,0.8); }

        .em-sc-best {
          margin: 0;
          font-size: 7px;
          color: #4a5568;
        }

        .em-timer {
          margin: 0;
          font-size: clamp(12px, 3.5vw, 16px);
          color: #00ccff;
          text-shadow: 0 0 6px rgba(0,204,255,0.5);
          text-align: right;
        }

        .em-timer.low { color: #ff3333; animation: em-blink 0.3s infinite alternate; text-shadow: 0 0 10px rgba(255,51,51,0.8); }
        .em-timer.frozen { color: #00ccff; text-shadow: 0 0 12px rgba(0,204,255,0.8); }

        /* Progress bar */
        .em-pbar {
          height: 4px;
          background: #1a1a3a;
          flex-shrink: 0;
        }

        .em-pfill {
          height: 100%;
          transition: width 0.1s linear;
        }

        /* Status */
        .em-status {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          padding: 4px 10px;
          min-height: 24px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }

        .em-combo-text {
          font-size: 8px;
          color: #6b7280;
          margin: 0;
        }

        .em-combo-text strong { font-size: 12px; color: #ffcc00; }

        .em-combo-lbl {
          font-size: 10px;
          font-weight: 400;
          margin: 0;
          animation: em-pop 0.3s ease-out;
          text-shadow: 0 0 8px currentColor;
        }

        .em-fever-lbl {
          font-size: 9px;
          color: #ff0080;
          margin: 0;
          animation: em-blink 0.2s infinite alternate;
          text-shadow: 0 0 10px rgba(255,0,128,0.6);
        }

        .em-frozen-lbl {
          font-size: 9px;
          color: #00ccff;
          margin: 0;
          animation: em-glow 0.4s infinite alternate;
          text-shadow: 0 0 10px rgba(0,204,255,0.6);
        }

        .em-double-lbl {
          font-size: 8px;
          color: #cc00ff;
          margin: 0;
          animation: em-glow 0.5s infinite alternate;
        }

        .em-rd { font-size: 7px; color: #4a5568; margin: 0; }

        /* Fever gauge */
        .em-fgauge {
          height: 8px;
          margin: 0 10px 2px;
          background: #1a1a3a;
          border: 1px solid #333;
          flex-shrink: 0;
          position: relative;
          overflow: hidden;
        }

        .em-fgauge-fill {
          height: 100%;
          transition: width 0.15s ease-out;
        }

        .em-fgauge-lbl {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 5px;
          color: #aaa;
          letter-spacing: 1px;
        }

        /* Target area */
        .em-target {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 8px 14px;
          margin: 4px 10px;
          background: rgba(0,255,136,0.05);
          border: 2px solid #00ff88;
          box-shadow: 0 0 12px rgba(0,255,136,0.2), inset 0 0 20px rgba(0,255,136,0.05);
          flex-shrink: 0;
        }

        .em-target.fever-t { border-color: #ff0080; box-shadow: 0 0 16px rgba(255,0,128,0.3); }
        .em-target.frozen-t { border-color: #00ccff; box-shadow: 0 0 16px rgba(0,204,255,0.3); }

        .em-target-lbl {
          margin: 0;
          font-size: 10px;
          color: #00ff88;
          letter-spacing: 3px;
        }

        .em-target-icon {
          margin: 0;
          font-size: clamp(36px, 10vw, 48px);
          filter: drop-shadow(0 0 8px currentColor);
          animation: em-pop 0.3s ease-out;
        }

        /* Grid */
        .em-grid-wrap {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px 10px;
          min-height: 0;
        }

        .em-grid {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          gap: clamp(5px, 1.5vw, 8px);
          width: 100%;
          max-width: 380px;
          transition: opacity 0.12s, transform 0.12s;
        }

        .em-grid.shuffling {
          opacity: 0.15;
          transform: scale(0.9);
        }

        .em-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1;
          border: 2px solid #333;
          background: #0f0f2e;
          cursor: pointer;
          transition: all 0.06s;
          box-shadow: inset 0 0 8px rgba(0,0,0,0.5);
          padding: 0;
          touch-action: manipulation;
          position: relative;
        }

        .em-cell:active:not(:disabled) {
          transform: scale(0.85) !important;
          box-shadow: inset 0 0 16px rgba(0,255,136,0.3);
        }

        .em-cell:disabled { opacity: 0.4; cursor: default; }

        .em-cell-correct {
          background: rgba(0,255,136,0.15) !important;
          border-color: #00ff88 !important;
          box-shadow: 0 0 20px rgba(0,255,136,0.6), inset 0 0 12px rgba(0,255,136,0.2) !important;
        }

        .em-cell-wrong {
          background: rgba(255,0,0,0.15) !important;
          border-color: #ff3333 !important;
          box-shadow: 0 0 16px rgba(255,0,0,0.4) !important;
          animation: em-shake 0.2s ease-out;
        }

        .em-cell-bomb {
          background: rgba(255,100,0,0.2) !important;
          border-color: #ff6600 !important;
          box-shadow: 0 0 24px rgba(255,100,0,0.6) !important;
          animation: em-explode 0.3s ease-out;
        }

        .em-cell-mystery {
          background: rgba(204,0,255,0.2) !important;
          border-color: #cc00ff !important;
          box-shadow: 0 0 24px rgba(204,0,255,0.5) !important;
          animation: em-pop 0.3s ease-out;
        }

        .em-cell-freeze {
          background: rgba(0,204,255,0.15) !important;
          border-color: #00ccff !important;
          box-shadow: 0 0 20px rgba(0,204,255,0.5) !important;
        }

        .em-item {
          font-size: clamp(26px, 7vw, 36px);
          pointer-events: none;
          filter: drop-shadow(0 0 4px rgba(255,255,255,0.3));
          image-rendering: auto;
        }

        .em-special-dot {
          position: absolute;
          top: 3px;
          right: 3px;
          width: 6px;
          height: 6px;
          animation: em-blink 0.5s infinite alternate;
        }

        /* Footer */
        .em-foot {
          padding: 4px 10px 8px;
          text-align: center;
          flex-shrink: 0;
          border-top: 1px solid #222;
        }

        .em-foot-stats {
          display: flex;
          justify-content: space-around;
          font-size: 7px;
          color: #4a5568;
          margin-bottom: 4px;
        }

        .em-foot-stats p { margin: 0; }

        /* Overlays */
        .em-flash-ov {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 15;
          transition: opacity 0.06s;
        }

        .em-ms-ov {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 25;
          pointer-events: none;
          animation: em-ms-bg 1.2s ease-out forwards;
        }

        .em-ms-text {
          font-size: clamp(18px, 6vw, 28px);
          color: #ffcc00;
          text-shadow: 0 0 30px rgba(255,204,0,0.8), 0 0 60px rgba(255,0,128,0.4);
          animation: em-ms-pop 0.5s ease-out;
          letter-spacing: 3px;
        }

        .em-fin-ov {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 30;
          background: rgba(0,0,0,0.8);
          animation: em-fade-in 0.3s ease-out;
          gap: 8px;
        }

        .em-fin-label { font-size: 10px; color: #6b7280; margin: 0; }

        .em-fin-score {
          font-size: clamp(24px, 8vw, 36px);
          color: #00ff88;
          text-shadow: 0 0 20px rgba(0,255,136,0.8);
          margin: 0;
          animation: em-pop 0.6s ease-out;
        }

        .em-fin-record {
          font-size: clamp(14px, 5vw, 20px);
          color: #ffcc00;
          text-shadow: 0 0 20px rgba(255,204,0,0.8);
          animation: em-pop 0.6s ease-out, em-blink 0.4s 0.6s infinite alternate;
          margin: 0;
          letter-spacing: 2px;
        }

        .em-float {
          position: absolute;
          pointer-events: none;
          text-shadow: 0 0 8px currentColor;
          z-index: 20;
          animation: em-float-up 1.2s ease-out forwards;
        }

        .em-px {
          position: absolute;
          pointer-events: none;
          z-index: 18;
          text-shadow: 0 0 6px currentColor;
        }

        /* Animations */
        @keyframes em-blink { from { opacity: 0.6; } to { opacity: 1; } }
        @keyframes em-glow { from { opacity: 0.7; text-shadow: 0 0 4px currentColor; } to { opacity: 1; text-shadow: 0 0 16px currentColor; } }

        @keyframes em-pop {
          0% { transform: scale(0.3); opacity: 0; }
          60% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes em-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }

        @keyframes em-explode {
          0% { transform: scale(1); }
          30% { transform: scale(1.4); }
          100% { transform: scale(1); }
        }

        @keyframes em-float-up {
          0% { opacity: 1; transform: translateY(0) scale(1.2); }
          100% { opacity: 0; transform: translateY(-65px) scale(0.5); }
        }

        @keyframes em-fade-in { from { opacity: 0; } to { opacity: 1; } }

        @keyframes em-ms-bg {
          0% { background: rgba(255,204,0,0.2); }
          30% { background: rgba(255,204,0,0.05); }
          100% { background: transparent; }
        }

        @keyframes em-ms-pop {
          0% { transform: scale(0) rotate(-15deg); }
          50% { transform: scale(1.3) rotate(3deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>

      {/* Header */}
      <div className="em-hdr">
        <img className="em-avatar" src={characterImg} alt="avatar" />
        <div className="em-sc">
          <p className={`em-sc-val ${isFever ? 'fever' : ''}`}>{score.toLocaleString()}</p>
          <p className="em-sc-best">BEST {displayBest.toLocaleString()}</p>
        </div>
        <div>
          <p className={`em-timer ${isLow ? 'low' : ''} ${isFrozen ? 'frozen' : ''}`}>
            {isFrozen ? '\u2744' : ''}{timerSec}s
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="em-pbar">
        <div className="em-pfill" style={{
          width: `${progress}%`,
          background: isFever ? 'linear-gradient(90deg, #ff0080, #ff6600)' :
            isFrozen ? '#00ccff' : isLow ? '#ff3333' : `hsl(${bgHue}, 80%, 50%)`,
        }} />
      </div>

      {/* Status row */}
      <div className="em-status">
        <p className="em-combo-text">COMBO <strong>{combo}</strong></p>
        {comboLabel && <p className="em-combo-lbl" key={combo} style={{ color: combo >= 15 ? '#ff0080' : '#ffcc00' }}>{comboLabel}</p>}
        {comboMult > 1.25 && <p style={{ margin: 0, fontSize: '8px', color: '#ff0080' }}>x{comboMult.toFixed(1)}</p>}
        {isFever && <p className="em-fever-lbl">{'\u{1F525}'} FEVER x{FEVER_MULTIPLIER} {(feverMs / 1000).toFixed(1)}s</p>}
        {isFrozen && <p className="em-frozen-lbl">{'\u2744'} FREEZE {(frozenMs / 1000).toFixed(1)}s</p>}
        {isDoubleNext && <p className="em-double-lbl">x2 NEXT</p>}
        <p className="em-rd">RD{round}</p>
      </div>

      {/* Fever gauge */}
      {!isFever && combo > 0 && (
        <div className="em-fgauge">
          <div className="em-fgauge-fill" style={{
            width: `${Math.min(100, (combo / FEVER_COMBO_THRESHOLD) * 100)}%`,
            background: combo >= FEVER_COMBO_THRESHOLD - 2
              ? 'linear-gradient(90deg, #ff0080, #ff3333)'
              : 'linear-gradient(90deg, #ffcc00, #ff6600)',
            boxShadow: combo >= FEVER_COMBO_THRESHOLD - 2 ? '0 0 8px rgba(255,0,128,0.5)' : undefined,
          }} />
          <span className="em-fgauge-lbl">
            {combo >= FEVER_COMBO_THRESHOLD - 2 ? 'ALMOST!' : `${combo}/${FEVER_COMBO_THRESHOLD}`}
          </span>
        </div>
      )}

      {/* Target */}
      <div className={`em-target ${isFever ? 'fever-t' : ''} ${isFrozen ? 'frozen-t' : ''}`}>
        <p className="em-target-lbl">FIND</p>
        <p className="em-target-icon" key={targetIdx} style={{ color: targetItem?.color }}>
          {targetItem?.emoji}
        </p>
      </div>

      {/* Grid */}
      <div className="em-grid-wrap">
        <div className={`em-grid ${isShuffling ? 'shuffling' : ''}`} role="grid">
          {grid.map((val, i) => {
            const isFB = cellFB?.index === i
            let fbClass = ''
            if (isFB) {
              switch (cellFB.kind) {
                case 'correct': fbClass = 'em-cell-correct'; break
                case 'wrong': fbClass = 'em-cell-wrong'; break
                case 'bomb': fbClass = 'em-cell-bomb'; break
                case 'mystery': fbClass = 'em-cell-mystery'; break
                case 'freeze': fbClass = 'em-cell-freeze'; break
              }
            }

            let emoji = ''
            let specialColor = ''
            if (val === -1) { emoji = BOMB_EMOJI; specialColor = '#ff6600' }
            else if (val === -2) { emoji = MYSTERY_EMOJI; specialColor = '#cc00ff' }
            else if (val === -3) { emoji = FREEZE_EMOJI; specialColor = '#00ccff' }
            else { emoji = ITEM_POOL[val]?.emoji ?? '?' }
            const isSpecial = val < 0

            return (
              <button
                className={`em-cell ${fbClass}`}
                key={`c-${i}`}
                type="button"
                onClick={() => handleCellTap(i)}
                disabled={finishedRef.current || isShuffling || (cellFB !== null && cellFB.kind === 'correct')}
              >
                <span className="em-item">{emoji}</span>
                {isSpecial && <span className="em-special-dot" style={{ background: specialColor, boxShadow: `0 0 6px ${specialColor}` }} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="em-foot">
        <div className="em-foot-stats">
          <p>{correctCount} HIT</p>
          <p>MAX {maxCombo}</p>
          <p>PERF {perfectRounds}</p>
        </div>
        <button className="text-button" type="button" onClick={onExit} style={{ fontFamily: "'Press Start 2P', monospace", fontSize: '8px' }}>
          HUB
        </button>
      </div>

      {/* Flash */}
      {flashColor && <div className="em-flash-ov" style={{ background: flashColor }} />}

      {/* Milestone */}
      {milestone && <div className="em-ms-ov"><p className="em-ms-text">{milestone}</p></div>}

      {/* Finished */}
      {phase === 'finished' && (
        <div className="em-fin-ov">
          <p className="em-fin-label">GAME OVER</p>
          <p className="em-fin-score">{score.toLocaleString()}</p>
          {isNewRecord && <p className="em-fin-record">NEW RECORD!</p>}
          <p className="em-fin-label">{correctCount} HIT / MAX COMBO {maxCombo} / PERFECT {perfectRounds}</p>
        </div>
      )}

      {/* Floating texts */}
      {floats.map(f => {
        const age = performance.now() - f.createdAt
        const p = Math.min(1, age / 1200)
        return (
          <span key={f.id} className="em-float" style={{
            left: `${f.x}px`, top: `${f.y}px`, color: f.color, fontSize: `${f.size}px`,
            opacity: 1 - p, transform: `translateY(${-55 * p}px) scale(${1.2 - p * 0.4})`,
          }}>
            {f.text}
          </span>
        )
      })}

      {/* Pixel particles */}
      {particles.map(px => {
        const age = performance.now() - px.createdAt
        const p = Math.min(1, age / 700)
        const x = px.x + px.vx * p * 0.3
        const y = px.y + px.vy * p * 0.3 - 20 * p
        return (
          <span key={px.id} className="em-px" style={{
            left: `${x}px`, top: `${y}px`, color: px.color, fontSize: `${px.size}px`,
            opacity: 1 - p, transform: `scale(${1 - p * 0.5})`,
          }}>
            {px.char}
          </span>
        )
      })}
    </section>
  )
}

export const emojiMatchModule: MiniGameModule = {
  manifest: {
    id: 'emoji-match',
    title: 'Pixel Match',
    description: 'Retro dot style! Find and tap the target item!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#00ff88',
  },
  Component: EmojiMatchGame,
}
