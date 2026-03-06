import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterImg from '../../../assets/images/same-character/kim-yeonja.png'

// Sound imports
import correctSfx from '../../../assets/sounds/emoji-match-correct.mp3'
import wrongSfx from '../../../assets/sounds/emoji-match-wrong.mp3'
import comboSfx from '../../../assets/sounds/emoji-match-combo.mp3'
import feverSfx from '../../../assets/sounds/emoji-match-fever.mp3'
import shuffleSfx from '../../../assets/sounds/emoji-match-shuffle.mp3'
import timeWarnSfx from '../../../assets/sounds/emoji-match-time-warning.mp3'
import speedBonusSfx from '../../../assets/sounds/emoji-match-speed-bonus.mp3'
import bombSfx from '../../../assets/sounds/emoji-match-bomb.mp3'
import gameOverSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Constants ────────────────────────────────────────────

const ROUND_DURATION_MS = 45000
const GRID_SIZE = 4
const GRID_CELL_COUNT = GRID_SIZE * GRID_SIZE
const SCORE_CORRECT = 5
const SCORE_WRONG = -2
const INITIAL_POOL_SIZE = 8
const POOL_GROWTH_PER_ROUND = 2
const MAX_POOL_SIZE = 24
const FEEDBACK_DURATION_MS = 250
const SHUFFLE_ANIMATION_MS = 180
const LOW_TIME_THRESHOLD_MS = 8000

// Gimmick constants
const COMBO_MULTIPLIER_STEP = 0.25
const SPEED_BONUS_THRESHOLD_MS = 1500
const SPEED_BONUS_POINTS = 5
const TIME_BONUS_PER_CORRECT_MS = 300
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 3

// Special emoji constants
const BOMB_CHANCE = 0.08
const RAINBOW_CHANCE = 0.06
const FREEZE_CHANCE = 0.05
const FREEZE_DURATION_MS = 3000
const BOMB_EMOJI = '\u{1F4A3}'
const RAINBOW_EMOJI = '\u{1F308}'
const FREEZE_EMOJI = '\u{2744}\u{FE0F}'

const COMBO_MILESTONE_THRESHOLDS = [5, 10, 15, 25, 40] as const

const EMOJI_POOL: string[] = [
  '\u{1F600}', '\u{1F60E}', '\u{1F929}', '\u{1F631}', '\u{1F973}', '\u{1F634}',
  '\u{1F914}', '\u{1F624}', '\u{1F976}', '\u{1F92F}', '\u{1F608}', '\u{1F47B}',
  '\u{1F480}', '\u{1F916}', '\u{1F47D}', '\u{1F383}', '\u{1F436}', '\u{1F431}',
  '\u{1F43C}', '\u{1F98A}', '\u{1F438}', '\u{1F981}', '\u{1F427}', '\u{1F419}',
]

const PARTICLE_EMOJIS = ['\u{2728}', '\u{1F31F}', '\u{1F4AB}', '\u{26A1}', '\u{1F525}', '\u{1F4A5}', '\u{1F308}', '\u{1F48E}'] as const
const PARTICLE_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'] as const

// ─── Helpers ──────────────────────────────────────────────

function pickRandom<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

function buildGrid(targetEmoji: string, poolSize: number): string[] {
  const availablePool = EMOJI_POOL.slice(0, poolSize)
  const distractors = availablePool.filter((e) => e !== targetEmoji)
  const targetCount = 1 + Math.floor(Math.random() * 2) // 1-2 targets
  const targetIndices = new Set<number>()
  while (targetIndices.size < targetCount) {
    targetIndices.add(Math.floor(Math.random() * GRID_CELL_COUNT))
  }

  const cells: string[] = []
  for (let i = 0; i < GRID_CELL_COUNT; i += 1) {
    if (targetIndices.has(i)) {
      cells.push(targetEmoji)
    } else {
      // Small chance for special emojis
      const rand = Math.random()
      if (rand < BOMB_CHANCE) {
        cells.push(BOMB_EMOJI)
      } else if (rand < BOMB_CHANCE + RAINBOW_CHANCE) {
        cells.push(RAINBOW_EMOJI)
      } else if (rand < BOMB_CHANCE + RAINBOW_CHANCE + FREEZE_CHANCE) {
        cells.push(FREEZE_EMOJI)
      } else {
        cells.push(pickRandom(distractors))
      }
    }
  }
  return cells
}

function pickNewTarget(currentTarget: string, poolSize: number): string {
  const pool = EMOJI_POOL.slice(0, poolSize)
  const candidates = pool.filter((e) => e !== currentTarget)
  return pickRandom(candidates.length > 0 ? candidates : pool)
}

function computePoolSize(round: number): number {
  return Math.min(MAX_POOL_SIZE, INITIAL_POOL_SIZE + (round - 1) * POOL_GROWTH_PER_ROUND)
}

function getComboLabel(combo: number): string {
  if (combo < 3) return ''
  if (combo < 5) return 'NICE!'
  if (combo < 10) return 'GREAT!'
  if (combo < 15) return 'AMAZING!'
  if (combo < 25) return 'FANTASTIC!'
  return 'GODLIKE!'
}

function getComboColor(combo: number): string {
  if (combo < 5) return '#22c55e'
  if (combo < 10) return '#3b82f6'
  if (combo < 15) return '#f59e0b'
  if (combo < 25) return '#ef4444'
  return '#a855f7'
}

// ─── Particle / Floating types ────────────────────────────

interface Particle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly emoji: string
  readonly size: number
  readonly createdAt: number
  readonly color: string
}

interface FloatingText {
  readonly id: number
  readonly text: string
  readonly x: number
  readonly y: number
  readonly color: string
  readonly size: number
  readonly createdAt: number
}

type CellFeedback = { index: number; kind: 'correct' | 'wrong' | 'bomb' | 'rainbow' | 'freeze' }

// ─── Game Component ───────────────────────────────────────

function EmojiMatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [round, setRound] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [targetEmoji, setTargetEmoji] = useState(() => pickRandom(EMOJI_POOL.slice(0, INITIAL_POOL_SIZE)))
  const [grid, setGrid] = useState<string[]>(() => buildGrid(targetEmoji, INITIAL_POOL_SIZE))
  const [cellFeedback, setCellFeedback] = useState<CellFeedback | null>(null)
  const [isShuffling, setIsShuffling] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [isFrozen, setIsFrozen] = useState(false)
  const [frozenMs, setFrozenMs] = useState(0)
  const [particles, setParticles] = useState<Particle[]>([])
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([])
  const [isShaking, setIsShaking] = useState(false)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [isFlashing, setIsFlashing] = useState(false)
  const [flashColor, setFlashColor] = useState('rgba(255,255,255,0.6)')
  const [bgHue, setBgHue] = useState(40)
  const [milestoneFlash, setMilestoneFlash] = useState<string | null>(null)
  const [gamePhase, setGamePhase] = useState<'playing' | 'finished'>('playing')
  const [correctCount, setCorrectCount] = useState(0)
  const [cellScales, setCellScales] = useState<number[]>(Array(GRID_CELL_COUNT).fill(1))
  const [, setTimeWarningPlayed] = useState(false)
  const [isNewRecord, setIsNewRecord] = useState(false)

  // Refs for RAF-safe state
  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const roundRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const targetEmojiRef = useRef(targetEmoji)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const isFrozenRef = useRef(false)
  const frozenMsRef = useRef(0)
  const lastCorrectAtRef = useRef(0)
  const particleIdRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const floatingTextIdRef = useRef(0)
  const floatingTextsRef = useRef<FloatingText[]>([])
  const shakeTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const milestoneTimerRef = useRef<number | null>(null)
  const lastMilestoneRef = useRef(0)
  const correctCountRef = useRef(0)
  const gridRef = useRef(grid)
  gridRef.current = grid

  // Audio refs
  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const shuffleAudioRef = useRef<HTMLAudioElement | null>(null)
  const timeWarnAudioRef = useRef<HTMLAudioElement | null>(null)
  const speedBonusAudioRef = useRef<HTMLAudioElement | null>(null)
  const bombAudioRef = useRef<HTMLAudioElement | null>(null)
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
      audio.volume = Math.min(1, Math.max(0, volume))
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  // Particles
  const spawnParticles = useCallback((count: number, centerX: number, centerY: number, customEmojis?: readonly string[]) => {
    const now = performance.now()
    const emojis = customEmojis ?? PARTICLE_EMOJIS
    const newParticles: Particle[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8
      const speed = 100 + Math.random() * 220
      particleIdRef.current += 1
      newParticles.push({
        id: particleIdRef.current,
        x: centerX + (Math.random() - 0.5) * 30,
        y: centerY + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        emoji: pickRandom(emojis),
        size: 8 + Math.random() * 12,
        createdAt: now,
        color: pickRandom(PARTICLE_COLORS),
      })
    }
    const merged = [...particlesRef.current, ...newParticles].slice(-40)
    particlesRef.current = merged
    setParticles(merged)
  }, [])

  // Floating text
  const spawnFloatingText = useCallback((text: string, x: number, y: number, color: string, size = 20) => {
    floatingTextIdRef.current += 1
    const ft: FloatingText = {
      id: floatingTextIdRef.current,
      text, x, y, color, size,
      createdAt: performance.now(),
    }
    const merged = [...floatingTextsRef.current, ft].slice(-10)
    floatingTextsRef.current = merged
    setFloatingTexts(merged)
  }, [])

  // Effects
  const triggerShake = useCallback((intensity: number) => {
    setIsShaking(true)
    setShakeIntensity(intensity)
    clearTimeoutSafe(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsShaking(false)
      setShakeIntensity(0)
    }, 120)
  }, [])

  const triggerFlash = useCallback((color = 'rgba(255,255,255,0.6)', durationMs = 80) => {
    setIsFlashing(true)
    setFlashColor(color)
    clearTimeoutSafe(flashTimerRef)
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      setIsFlashing(false)
    }, durationMs)
  }, [])

  const triggerMilestone = useCallback((text: string) => {
    setMilestoneFlash(text)
    clearTimeoutSafe(milestoneTimerRef)
    milestoneTimerRef.current = window.setTimeout(() => {
      milestoneTimerRef.current = null
      setMilestoneFlash(null)
    }, 1200)
  }, [])

  // Cell tap animation
  const animateCell = useCallback((index: number) => {
    setCellScales(prev => {
      const next = [...prev]
      next[index] = 1.15
      return next
    })
    setTimeout(() => {
      setCellScales(prev => {
        const next = [...prev]
        next[index] = 1
        return next
      })
    }, 150)
  }, [])

  const advanceRound = useCallback(() => {
    const nextRound = roundRef.current + 1
    roundRef.current = nextRound
    setRound(nextRound)

    // Bonus every 5 rounds
    if (nextRound % 5 === 0) {
      const bonusTime = 2000
      const bonusScore = 10 * nextRound
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + bonusTime)
      scoreRef.current += bonusScore
      setScore(scoreRef.current)
      playAudio(comboAudioRef, 0.6, 1.3)
      triggerMilestone(`ROUND ${nextRound} BONUS!`)
      spawnFloatingText(`+${bonusScore} +${bonusTime / 1000}s`, 150, 200, '#a855f7', 26)
      spawnParticles(12, 200, 250, ['\u{1F389}', '\u{1F38A}', '\u{2728}', '\u{1F31F}'])
      triggerShake(8)
      triggerFlash('rgba(168,85,247,0.4)', 150)
    }

    const nextPoolSize = computePoolSize(nextRound)
    const nextTarget = pickNewTarget(targetEmojiRef.current, nextPoolSize)
    targetEmojiRef.current = nextTarget
    setTargetEmoji(nextTarget)

    setIsShuffling(true)
    playAudio(shuffleAudioRef, 0.35, 1.1)
    const nextGrid = buildGrid(nextTarget, nextPoolSize)
    setTimeout(() => {
      setGrid(nextGrid)
      setIsShuffling(false)
    }, SHUFFLE_ANIMATION_MS)
  }, [playAudio, spawnFloatingText, spawnParticles, triggerMilestone, triggerShake, triggerFlash])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setGamePhase('finished')
    clearTimeoutSafe(feedbackTimerRef)
    playAudio(gameOverAudioRef, 0.64, 0.95)

    if (scoreRef.current > bestScore) {
      setTimeout(() => setIsNewRecord(true), 800)
    }

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio, bestScore])

  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (finishedRef.current || isShuffling || gamePhase !== 'playing') return
      if (cellFeedback !== null && cellFeedback.kind === 'correct') return

      const tappedEmoji = gridRef.current[cellIndex]
      animateCell(cellIndex)

      // Calculate cell center for particles
      const col = cellIndex % GRID_SIZE
      const row = Math.floor(cellIndex / GRID_SIZE)
      const cellW = 90 // approximate
      const cellH = 90
      const px = 16 + col * (cellW + 8) + cellW / 2
      const py = 200 + row * (cellH + 8) + cellH / 2

      // Special emoji: Bomb
      if (tappedEmoji === BOMB_EMOJI) {
        playAudio(bombAudioRef, 0.5)
        triggerShake(12)
        triggerFlash('rgba(255,165,0,0.5)', 150)
        spawnParticles(15, px, py, ['\u{1F4A5}', '\u{1F525}', '\u{26A1}', '\u{1F4AB}'])
        spawnFloatingText('BOMB! +15', px - 30, py - 40, '#f97316', 24)

        const bombScore = 15 * (isFeverRef.current ? FEVER_MULTIPLIER : 1)
        scoreRef.current += bombScore
        setScore(scoreRef.current)

        setCellFeedback({ index: cellIndex, kind: 'bomb' })
        clearTimeoutSafe(feedbackTimerRef)
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null
          setCellFeedback(null)
          advanceRound()
        }, FEEDBACK_DURATION_MS)
        return
      }

      // Special emoji: Rainbow (wildcard - always correct)
      if (tappedEmoji === RAINBOW_EMOJI) {
        playAudio(speedBonusAudioRef, 0.5, 1.2)
        triggerFlash('rgba(147,51,234,0.4)', 120)
        spawnParticles(10, px, py, ['\u{1F308}', '\u{2728}', '\u{1F31F}', '\u{1F4AB}'])
        spawnFloatingText('RAINBOW! +20', px - 40, py - 40, '#a855f7', 24)

        const rainbowScore = 20 * (isFeverRef.current ? FEVER_MULTIPLIER : 1)
        scoreRef.current += rainbowScore
        setScore(scoreRef.current)

        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)
        if (nextCombo > maxComboRef.current) { maxComboRef.current = nextCombo; setMaxCombo(nextCombo) }

        setCellFeedback({ index: cellIndex, kind: 'rainbow' })
        clearTimeoutSafe(feedbackTimerRef)
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null
          setCellFeedback(null)
          advanceRound()
        }, FEEDBACK_DURATION_MS)
        return
      }

      // Special emoji: Freeze
      if (tappedEmoji === FREEZE_EMOJI) {
        playAudio(comboAudioRef, 0.5, 0.8)
        triggerFlash('rgba(56,189,248,0.5)', 200)
        spawnParticles(8, px, py, ['\u{2744}\u{FE0F}', '\u{1F4A0}', '\u{1F9CA}'])
        spawnFloatingText('FREEZE!', px - 30, py - 40, '#38bdf8', 26)

        isFrozenRef.current = true
        frozenMsRef.current = FREEZE_DURATION_MS
        setIsFrozen(true)
        setFrozenMs(FREEZE_DURATION_MS)

        setCellFeedback({ index: cellIndex, kind: 'freeze' })
        clearTimeoutSafe(feedbackTimerRef)
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null
          setCellFeedback(null)
        }, FEEDBACK_DURATION_MS)
        return
      }

      const isCorrect = tappedEmoji === targetEmojiRef.current

      if (isCorrect) {
        const now = performance.now()
        const timeSinceLastCorrect = now - lastCorrectAtRef.current
        lastCorrectAtRef.current = now

        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)
        if (nextCombo > maxComboRef.current) { maxComboRef.current = nextCombo; setMaxCombo(nextCombo) }

        correctCountRef.current += 1
        setCorrectCount(correctCountRef.current)

        // Scoring
        const comboMult = 1 + nextCombo * COMBO_MULTIPLIER_STEP
        const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
        const isSpeedBonus = timeSinceLastCorrect > 0 && timeSinceLastCorrect < SPEED_BONUS_THRESHOLD_MS
        const speedBonus = isSpeedBonus ? SPEED_BONUS_POINTS : 0
        const totalPoints = Math.round((SCORE_CORRECT + speedBonus) * comboMult * feverMult)
        scoreRef.current += totalPoints
        setScore(scoreRef.current)

        // Time bonus
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CORRECT_MS)

        // Fever activation
        if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playAudio(feverAudioRef, 0.6)
          spawnParticles(16, px, py, ['\u{1F525}', '\u{26A1}', '\u{1F31F}', '\u{1F4A5}'])
          spawnFloatingText('FEVER x3!', px - 40, py - 60, '#ef4444', 30)
          triggerShake(12)
        }

        // Combo milestones
        for (const threshold of COMBO_MILESTONE_THRESHOLDS) {
          if (nextCombo === threshold && lastMilestoneRef.current < threshold) {
            lastMilestoneRef.current = threshold
            playAudio(comboAudioRef, 0.6, 0.8 + threshold * 0.01)
            triggerMilestone(`${threshold} COMBO!`)
            spawnParticles(12, 200, 300, ['\u{1F31F}', '\u{2728}', '\u{1F4AB}'])
            break
          }
        }

        // Speed bonus feedback
        if (isSpeedBonus) {
          playAudio(speedBonusAudioRef, 0.4)
          spawnFloatingText('FAST!', px + 20, py - 30, '#14b8a6', 18)
        }

        // Sound
        const pitch = 1 + Math.min(0.4, nextCombo * 0.03)
        playAudio(correctAudioRef, 0.5, pitch)

        // Effects
        const particleCount = Math.min(10, 4 + Math.floor(nextCombo / 3))
        spawnParticles(particleCount, px, py)
        spawnFloatingText(`+${totalPoints}`, px, py - 20, isFeverRef.current ? '#ef4444' : '#fbbf24', 22 + Math.min(8, nextCombo))
        triggerFlash()
        triggerShake(Math.min(8, 2 + nextCombo * 0.3))
        setBgHue(prev => (prev + 20 + Math.random() * 15) % 360)

        setCellFeedback({ index: cellIndex, kind: 'correct' })
        clearTimeoutSafe(feedbackTimerRef)
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null
          setCellFeedback(null)
          advanceRound()
        }, FEEDBACK_DURATION_MS)
      } else {
        // Wrong tap
        comboRef.current = 0
        setCombo(0)
        lastMilestoneRef.current = 0

        const penalty = Math.abs(SCORE_WRONG)
        scoreRef.current = Math.max(0, scoreRef.current + SCORE_WRONG)
        setScore(scoreRef.current)

        playAudio(wrongAudioRef, 0.45, 0.85)
        triggerShake(6)
        triggerFlash('rgba(239,68,68,0.4)')
        spawnFloatingText(`-${penalty}`, px, py - 20, '#ef4444', 20)

        setCellFeedback({ index: cellIndex, kind: 'wrong' })
        clearTimeoutSafe(feedbackTimerRef)
        feedbackTimerRef.current = window.setTimeout(() => {
          feedbackTimerRef.current = null
          setCellFeedback(null)
        }, FEEDBACK_DURATION_MS)
      }
    },
    [isShuffling, cellFeedback, gamePhase, playAudio, advanceRound, spawnParticles, spawnFloatingText, triggerShake, triggerFlash, triggerMilestone, animateCell],
  )

  const handleExit = useCallback(() => {
    playAudio(wrongAudioRef, 0.3, 1.02)
    onExit()
  }, [onExit, playAudio])

  // Key handler
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

  // Audio preload
  useEffect(() => {
    const audioSources = [
      { ref: correctAudioRef, src: correctSfx },
      { ref: wrongAudioRef, src: wrongSfx },
      { ref: comboAudioRef, src: comboSfx },
      { ref: feverAudioRef, src: feverSfx },
      { ref: shuffleAudioRef, src: shuffleSfx },
      { ref: timeWarnAudioRef, src: timeWarnSfx },
      { ref: speedBonusAudioRef, src: speedBonusSfx },
      { ref: bombAudioRef, src: bombSfx },
      { ref: gameOverAudioRef, src: gameOverSfx },
    ]
    for (const { ref, src } of audioSources) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    }
    return () => {
      clearTimeoutSafe(feedbackTimerRef)
      clearTimeoutSafe(shakeTimerRef)
      clearTimeoutSafe(flashTimerRef)
      clearTimeoutSafe(milestoneTimerRef)
      for (const { ref } of audioSources) ref.current = null
    }
  }, [])

  // Main game loop
  useEffect(() => {
    lastFrameAtRef.current = null

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

      // Frozen timer
      if (isFrozenRef.current) {
        frozenMsRef.current = Math.max(0, frozenMsRef.current - deltaMs)
        setFrozenMs(frozenMsRef.current)
        if (frozenMsRef.current <= 0) {
          isFrozenRef.current = false
          setIsFrozen(false)
        }
      }

      // Only count down if not frozen
      if (!isFrozenRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      }
      setRemainingMs(remainingMsRef.current)

      // Time warning sound
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > LOW_TIME_THRESHOLD_MS - 100) {
        setTimeWarningPlayed(prev => {
          if (!prev) {
            playAudio(timeWarnAudioRef, 0.4)
            return true
          }
          return prev
        })
      }

      // Fever timer
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      // Particle cleanup
      const aliveParticles = particlesRef.current.filter(p => now - p.createdAt < 700)
      if (aliveParticles.length !== particlesRef.current.length) {
        particlesRef.current = aliveParticles
        setParticles(aliveParticles)
      }

      // Floating text cleanup
      const aliveTexts = floatingTextsRef.current.filter(ft => now - ft.createdAt < 1200)
      if (aliveTexts.length !== floatingTextsRef.current.length) {
        floatingTextsRef.current = aliveTexts
        setFloatingTexts(aliveTexts)
      }

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

  // Derived state
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const comboMult = 1 + combo * COMBO_MULTIPLIER_STEP
  const comboLabel = getComboLabel(combo)
  const timerSeconds = (remainingMs / 1000).toFixed(1)
  const progressPercent = ((ROUND_DURATION_MS - remainingMs) / ROUND_DURATION_MS) * 100

  const shakeStyle = isShaking
    ? { transform: `translate(${(Math.random() - 0.5) * shakeIntensity * 2}px, ${(Math.random() - 0.5) * shakeIntensity * 2}px)` }
    : undefined

  return (
    <section
      className="mini-game-panel emoji-match-panel"
      aria-label="emoji-match-game"
      style={{
        position: 'relative',
        maxWidth: '432px',
        width: '100%',
        height: '100%',
        margin: '0 auto',
        overflow: 'hidden',
        ...shakeStyle,
      }}
    >
      <style>{`
        .emoji-match-panel {
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 50%, #e8e5dc 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          font-family: 'Segoe UI', system-ui, sans-serif;
        }

        .em-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px 8px;
          background: linear-gradient(180deg, #f59e0b, #d97706);
          color: white;
          flex-shrink: 0;
        }

        .em-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 3px solid #fde68a;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .em-score-area { flex: 1; }

        .em-score {
          margin: 0;
          font-size: clamp(26px, 7vw, 34px);
          font-weight: 900;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          transition: color 0.15s;
        }

        .em-score.fever-score {
          color: #fef08a;
          text-shadow: 0 0 12px rgba(254,240,138,0.6);
        }

        .em-best {
          margin: 0;
          font-size: 10px;
          color: rgba(255,255,255,0.7);
        }

        .em-timer-area { text-align: right; }

        .em-time {
          margin: 0;
          font-size: clamp(22px, 6vw, 28px);
          font-weight: 900;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
          transition: color 0.15s;
        }

        .em-time.low-time {
          color: #fef2f2;
          animation: em-pulse 0.3s infinite alternate;
        }

        .em-time.frozen-time {
          color: #7dd3fc;
          text-shadow: 0 0 12px rgba(56,189,248,0.6);
        }

        .em-progress-bar {
          height: 6px;
          background: #d4d0c8;
          flex-shrink: 0;
          overflow: hidden;
        }

        .em-progress-fill {
          height: 100%;
          transition: width 0.1s linear, background 0.3s;
        }

        .em-status-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          padding: 4px 14px;
          min-height: 28px;
          flex-shrink: 0;
          flex-wrap: wrap;
        }

        .em-combo {
          font-size: 13px;
          color: #6b7280;
          margin: 0;
        }

        .em-combo strong {
          font-size: clamp(18px, 5vw, 24px);
          color: #d97706;
        }

        .em-combo-label {
          font-size: 16px;
          font-weight: 900;
          margin: 0;
          animation: em-bounce-in 0.3s ease-out;
        }

        .em-fever-banner {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 14px;
          font-weight: 900;
          color: #ef4444;
          animation: em-fever-flash 0.2s ease-in-out infinite alternate;
          text-shadow: 0 0 10px rgba(239,68,68,0.5);
        }

        .em-frozen-banner {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 14px;
          font-weight: 900;
          color: #38bdf8;
          animation: em-frozen-glow 0.4s ease-in-out infinite alternate;
          text-shadow: 0 0 10px rgba(56,189,248,0.5);
        }

        .em-round-badge {
          font-size: 11px;
          font-weight: 700;
          color: #9ca3af;
          margin: 0;
        }

        .em-fever-gauge {
          height: 10px;
          margin: 0 14px 2px;
          background: #e8e5dc;
          border-radius: 5px;
          overflow: hidden;
          position: relative;
          flex-shrink: 0;
        }

        .em-fever-gauge-fill {
          height: 100%;
          border-radius: 5px;
          transition: width 0.15s ease-out;
        }

        .em-fever-gauge-label {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 7px;
          font-weight: 800;
          color: #92400e;
          letter-spacing: 1px;
        }

        .em-target-area {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 10px 16px;
          margin: 4px 14px;
          background: #fff;
          border-radius: 16px;
          border: 3px solid #fbbf24;
          box-shadow: 0 4px 16px rgba(251,191,36,0.25);
          flex-shrink: 0;
        }

        .em-target-area.fever-target {
          border-color: #ef4444;
          box-shadow: 0 0 20px rgba(239,68,68,0.3);
          animation: em-fever-border 0.3s ease-in-out infinite alternate;
        }

        .em-target-area.frozen-target {
          border-color: #38bdf8;
          box-shadow: 0 0 20px rgba(56,189,248,0.3);
        }

        .em-target-label {
          margin: 0;
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 900;
          color: #92400e;
          letter-spacing: 3px;
        }

        .em-target-emoji {
          margin: 0;
          font-size: clamp(44px, 12vw, 56px);
          filter: drop-shadow(0 2px 6px rgba(0,0,0,0.2));
          animation: em-target-bounce 0.35s ease-out;
        }

        .em-grid-wrapper {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px 12px;
          min-height: 0;
        }

        .em-grid {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          gap: clamp(6px, 2vw, 10px);
          width: 100%;
          max-width: 380px;
          transition: opacity 0.15s, transform 0.15s;
        }

        .em-grid.shuffling {
          opacity: 0.2;
          transform: scale(0.92) rotate(2deg);
        }

        .em-cell {
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1;
          border: 2.5px solid #d4d0c8;
          border-radius: clamp(12px, 3vw, 18px);
          background: #fff;
          cursor: pointer;
          transition: transform 0.08s, box-shadow 0.08s, border-color 0.08s, background 0.08s;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
          padding: 0;
          touch-action: manipulation;
          position: relative;
          overflow: hidden;
        }

        .em-cell:active:not(:disabled) {
          transform: scale(0.88) !important;
        }

        .em-cell:disabled {
          opacity: 0.5;
          cursor: default;
        }

        .em-cell-correct {
          background: #dcfce7 !important;
          border-color: #22c55e !important;
          box-shadow: 0 0 20px rgba(34,197,94,0.6) !important;
          transform: scale(1.12);
        }

        .em-cell-wrong {
          background: #fef2f2 !important;
          border-color: #ef4444 !important;
          box-shadow: 0 0 16px rgba(239,68,68,0.4) !important;
          animation: em-shake 0.2s ease-out;
        }

        .em-cell-bomb {
          background: #fff7ed !important;
          border-color: #f97316 !important;
          box-shadow: 0 0 24px rgba(249,115,22,0.6) !important;
          animation: em-bomb-burst 0.3s ease-out;
        }

        .em-cell-rainbow {
          background: linear-gradient(135deg, #fef3c7, #ddd6fe, #cffafe) !important;
          border-color: #a855f7 !important;
          box-shadow: 0 0 24px rgba(168,85,247,0.5) !important;
          animation: em-rainbow-shimmer 0.3s ease-out;
        }

        .em-cell-freeze {
          background: #e0f2fe !important;
          border-color: #38bdf8 !important;
          box-shadow: 0 0 24px rgba(56,189,248,0.6) !important;
        }

        .em-cell-emoji {
          font-size: clamp(28px, 8vw, 40px);
          pointer-events: none;
          filter: drop-shadow(0 1px 3px rgba(0,0,0,0.15));
          transition: transform 0.08s;
        }

        .em-cell-special {
          position: absolute;
          top: 2px;
          right: 2px;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: em-special-pulse 0.6s infinite alternate;
        }

        .em-footer {
          padding: 6px 12px 10px;
          text-align: center;
          flex-shrink: 0;
        }

        .em-footer-stats {
          display: flex;
          justify-content: space-around;
          font-size: 11px;
          color: #9ca3af;
          margin-bottom: 4px;
        }

        .em-footer-stats p { margin: 0; }

        /* Finished overlay */
        .em-finished-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 30;
          background: rgba(0, 0, 0, 0.65);
          animation: em-fade-in 0.3s ease-out;
          gap: 10px;
        }

        .em-finished-label {
          font-size: 16px;
          color: rgba(255,255,255,0.7);
          margin: 0;
        }

        .em-finished-score {
          font-size: clamp(42px, 12vw, 58px);
          font-weight: 900;
          color: #fff;
          text-shadow: 0 4px 20px rgba(0,0,0,0.4);
          margin: 0;
          animation: em-countdown-pop 0.6s ease-out;
        }

        .em-new-record {
          font-size: clamp(22px, 7vw, 30px);
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 20px rgba(251,191,36,0.8);
          animation: em-new-record-enter 0.6s ease-out, em-pulse 0.4s 0.6s ease-in-out infinite alternate;
          margin: 0;
          letter-spacing: 3px;
        }

        /* Milestone overlay */
        .em-milestone-overlay {
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 25;
          pointer-events: none;
          animation: em-milestone-bg 1.2s ease-out forwards;
        }

        .em-milestone-text {
          font-size: clamp(32px, 10vw, 48px);
          font-weight: 900;
          color: #fff;
          text-shadow: 0 0 30px rgba(251,191,36,0.8), 0 4px 20px rgba(0,0,0,0.4);
          animation: em-milestone-pop 0.5s ease-out;
          letter-spacing: 4px;
        }

        /* Flash overlay */
        .em-flash-overlay {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 15;
          transition: opacity 0.08s;
        }

        /* Floating text */
        .em-floating-text {
          position: absolute;
          pointer-events: none;
          font-weight: 900;
          text-shadow: 0 2px 6px rgba(0,0,0,0.4);
          z-index: 20;
          animation: em-float-up 1.2s ease-out forwards;
        }

        /* Particle */
        .em-particle {
          position: absolute;
          pointer-events: none;
          z-index: 18;
        }

        /* Animations */
        @keyframes em-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.08); }
        }

        @keyframes em-bounce-in {
          0% { transform: scale(0.5) translateY(8px); opacity: 0; }
          60% { transform: scale(1.2) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        @keyframes em-fever-flash {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }

        @keyframes em-fever-border {
          from { border-color: #ef4444; box-shadow: 0 0 10px rgba(239,68,68,0.2); }
          to { border-color: #f97316; box-shadow: 0 0 24px rgba(239,68,68,0.5); }
        }

        @keyframes em-frozen-glow {
          from { opacity: 0.7; text-shadow: 0 0 6px rgba(56,189,248,0.3); }
          to { opacity: 1; text-shadow: 0 0 16px rgba(56,189,248,0.8); }
        }

        @keyframes em-target-bounce {
          0% { transform: scale(0.5); }
          55% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }

        @keyframes em-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }

        @keyframes em-bomb-burst {
          0% { transform: scale(1); }
          30% { transform: scale(1.3); }
          100% { transform: scale(1.05); }
        }

        @keyframes em-rainbow-shimmer {
          0% { transform: scale(1); filter: hue-rotate(0deg); }
          50% { transform: scale(1.15); filter: hue-rotate(90deg); }
          100% { transform: scale(1.05); filter: hue-rotate(180deg); }
        }

        @keyframes em-special-pulse {
          from { opacity: 0.5; transform: scale(0.8); }
          to { opacity: 1; transform: scale(1.2); }
        }

        @keyframes em-float-up {
          0% { opacity: 1; transform: translateY(0) scale(1.3); }
          100% { opacity: 0; transform: translateY(-70px) scale(0.6); }
        }

        @keyframes em-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes em-countdown-pop {
          0% { transform: scale(2.5); opacity: 0; }
          40% { transform: scale(0.85); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes em-new-record-enter {
          0% { opacity: 0; transform: scale(2.5); }
          60% { opacity: 1; transform: scale(0.9); }
          100% { opacity: 1; transform: scale(1); }
        }

        @keyframes em-milestone-bg {
          0% { background: rgba(251,191,36,0.3); }
          30% { background: rgba(251,191,36,0.1); }
          100% { background: transparent; }
        }

        @keyframes em-milestone-pop {
          0% { transform: scale(0) rotate(-10deg); }
          50% { transform: scale(1.3) rotate(3deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>

      {/* Header */}
      <div className="em-header">
        <img className="em-avatar" src={characterImg} alt="Character" />
        <div className="em-score-area">
          <p className={`em-score ${isFever ? 'fever-score' : ''}`}>{score.toLocaleString()}</p>
          <p className="em-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="em-timer-area">
          <p className={`em-time ${isLowTime ? 'low-time' : ''} ${isFrozen ? 'frozen-time' : ''}`}>
            {isFrozen ? '\u2744\uFE0F' : ''}{timerSeconds}s
          </p>
        </div>
      </div>

      {/* Progress */}
      <div className="em-progress-bar">
        <div
          className="em-progress-fill"
          style={{
            width: `${progressPercent}%`,
            background: isFever
              ? 'linear-gradient(90deg, #ef4444, #f97316, #ef4444)'
              : isFrozen
                ? 'linear-gradient(90deg, #38bdf8, #7dd3fc, #38bdf8)'
                : isLowTime
                  ? 'linear-gradient(90deg, #ef4444, #f59e0b)'
                  : `hsl(${bgHue}, 65%, 55%)`,
          }}
        />
      </div>

      {/* Status row */}
      <div className="em-status-row">
        <p className="em-combo">
          COMBO <strong>{combo}</strong>
        </p>
        {comboLabel && (
          <p className="em-combo-label" key={combo} style={{ color: getComboColor(combo) }}>
            {comboLabel}
          </p>
        )}
        {comboMult > 1.25 && (
          <p style={{ margin: 0, fontSize: '13px', fontWeight: 800, color: '#e11d48' }}>x{comboMult.toFixed(1)}</p>
        )}
        {isFever && (
          <span className="em-fever-banner">
            {'\u{1F525}'} FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
          </span>
        )}
        {isFrozen && (
          <span className="em-frozen-banner">
            {'\u{2744}\u{FE0F}'} FREEZE ({(frozenMs / 1000).toFixed(1)}s)
          </span>
        )}
        <p className="em-round-badge">RD {round}</p>
      </div>

      {/* Fever gauge */}
      {!isFever && combo > 0 && (
        <div className="em-fever-gauge">
          <div
            className="em-fever-gauge-fill"
            style={{
              width: `${Math.min(100, (combo / FEVER_COMBO_THRESHOLD) * 100)}%`,
              background: combo >= FEVER_COMBO_THRESHOLD - 2
                ? 'linear-gradient(90deg, #f97316, #ef4444)'
                : 'linear-gradient(90deg, #fbbf24, #f59e0b)',
            }}
          />
          <span className="em-fever-gauge-label">
            {combo >= FEVER_COMBO_THRESHOLD - 2 ? 'ALMOST!' : `${combo}/${FEVER_COMBO_THRESHOLD}`}
          </span>
        </div>
      )}

      {/* Target */}
      <div className={`em-target-area ${isFever ? 'fever-target' : ''} ${isFrozen ? 'frozen-target' : ''}`}>
        <p className="em-target-label">FIND</p>
        <p className="em-target-emoji" key={targetEmoji}>{targetEmoji}</p>
      </div>

      {/* Grid */}
      <div className="em-grid-wrapper">
        <div className={`em-grid ${isShuffling ? 'shuffling' : ''}`} role="grid">
          {grid.map((emoji, index) => {
            const isFeedbackTarget = cellFeedback?.index === index
            let feedbackClass = ''
            if (isFeedbackTarget) {
              switch (cellFeedback.kind) {
                case 'correct': feedbackClass = 'em-cell-correct'; break
                case 'wrong': feedbackClass = 'em-cell-wrong'; break
                case 'bomb': feedbackClass = 'em-cell-bomb'; break
                case 'rainbow': feedbackClass = 'em-cell-rainbow'; break
                case 'freeze': feedbackClass = 'em-cell-freeze'; break
              }
            }
            const isSpecial = emoji === BOMB_EMOJI || emoji === RAINBOW_EMOJI || emoji === FREEZE_EMOJI
            const specialColor = emoji === BOMB_EMOJI ? '#f97316' : emoji === RAINBOW_EMOJI ? '#a855f7' : '#38bdf8'

            return (
              <button
                className={`em-cell ${feedbackClass}`}
                key={`cell-${index}`}
                type="button"
                onClick={() => handleCellTap(index)}
                disabled={finishedRef.current || isShuffling || (cellFeedback !== null && cellFeedback.kind === 'correct')}
                style={{ transform: `scale(${cellScales[index]})` }}
              >
                <span className="em-cell-emoji">{emoji}</span>
                {isSpecial && <span className="em-cell-special" style={{ background: specialColor }} />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="em-footer">
        <div className="em-footer-stats">
          <p>{correctCount} hits</p>
          <p>max combo {maxCombo}</p>
        </div>
        <button className="text-button" type="button" onClick={handleExit}>Hub</button>
      </div>

      {/* Flash overlay */}
      {isFlashing && (
        <div className="em-flash-overlay" style={{ background: flashColor }} />
      )}

      {/* Milestone overlay */}
      {milestoneFlash && (
        <div className="em-milestone-overlay">
          <p className="em-milestone-text">{milestoneFlash}</p>
        </div>
      )}

      {/* Finished overlay */}
      {gamePhase === 'finished' && (
        <div className="em-finished-overlay">
          <p className="em-finished-label">FINAL SCORE</p>
          <p className="em-finished-score">{score.toLocaleString()}</p>
          {isNewRecord && <p className="em-new-record">NEW RECORD!</p>}
          <p className="em-finished-label">{correctCount} correct / max combo {maxCombo}</p>
        </div>
      )}

      {/* Floating texts */}
      {floatingTexts.map((ft) => {
        const age = performance.now() - ft.createdAt
        const progress = Math.min(1, age / 1200)
        return (
          <span
            key={ft.id}
            className="em-floating-text"
            style={{
              left: `${ft.x}px`,
              top: `${ft.y}px`,
              color: ft.color,
              fontSize: `${ft.size}px`,
              opacity: 1 - progress,
              transform: `translateY(${-60 * progress}px) scale(${1.3 - progress * 0.5})`,
            }}
          >
            {ft.text}
          </span>
        )
      })}

      {/* Particles */}
      {particles.map((p) => {
        const age = performance.now() - p.createdAt
        const progress = Math.min(1, age / 700)
        const x = p.x + p.vx * progress * 0.35
        const y = p.y + p.vy * progress * 0.35 - 25 * progress
        return (
          <span
            key={p.id}
            className="em-particle"
            style={{
              left: `${x}px`,
              top: `${y}px`,
              fontSize: `${p.size + 6}px`,
              opacity: 1 - progress,
              transform: `scale(${1 - progress * 0.5}) rotate(${progress * 200}deg)`,
            }}
          >
            {p.emoji}
          </span>
        )
      })}
    </section>
  )
}

export const emojiMatchModule: MiniGameModule = {
  manifest: {
    id: 'emoji-match',
    title: 'Emoji Match',
    description: '\uD0C0\uAC9F \uC774\uBAA8\uC9C0\uB97C \uADF8\uB9AC\uB4DC\uC5D0\uC11C \uBE60\uB974\uAC8C \uCC3E\uC544\uB77C! \uD3ED\uD0C4/\uBB34\uC9C0\uAC1C/\uD504\uB9AC\uC988 \uD2B9\uC218 \uC544\uC774\uD15C!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#fbbf24',
  },
  Component: EmojiMatchGame,
}
