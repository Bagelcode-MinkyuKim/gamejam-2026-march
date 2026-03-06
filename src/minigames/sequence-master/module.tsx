import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// Sound imports
import correctSfx from '../../../assets/sounds/sequence-correct.mp3'
import wrongSfx from '../../../assets/sounds/sequence-wrong.mp3'
import comboSfx from '../../../assets/sounds/sequence-combo.mp3'
import feverSfx from '../../../assets/sounds/sequence-fever.mp3'
import levelupSfx from '../../../assets/sounds/sequence-levelup.mp3'
import timeWarningSfx from '../../../assets/sounds/sequence-time-warning.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 10000
const CRITICAL_TIME_THRESHOLD_MS = 5000
const CORRECT_SCORE = 10
const WRONG_PENALTY = 3
const FEEDBACK_DURATION_MS = 500
const COMBO_KEEP_WINDOW_MS = 4000
const SPEED_BONUS_THRESHOLD_MS = 2000
const SPEED_BONUS_POINTS = 5
const FEVER_COMBO_THRESHOLD = 5
const FEVER_DURATION_MS = 10000
const FEVER_MULTIPLIER = 2
const TIME_BONUS_PER_CORRECT_MS = 800
const HINT_COOLDOWN_MS = 15000
const HINT_PENALTY = 5
const STREAK_MILESTONE = 10

const DIFFICULTY_THRESHOLDS = [0, 30, 60, 100, 160] as const

type PatternKind = 'arithmetic' | 'geometric' | 'fibonacci' | 'squares' | 'cubes' | 'triangular' | 'primes'

interface SequenceProblem {
  readonly displayed: number[]
  readonly answer: number
  readonly choices: number[]
  readonly patternLabel: string
  readonly patternKind: PatternKind
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shuffle<T>(arr: T[]): T[] {
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function getDifficulty(score: number): number {
  let level = 0
  for (let i = DIFFICULTY_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= DIFFICULTY_THRESHOLDS[i]) {
      level = i
      break
    }
  }
  return level
}

function getAvailablePatterns(difficulty: number): PatternKind[] {
  const patterns: PatternKind[] = ['arithmetic']
  if (difficulty >= 1) patterns.push('geometric', 'squares')
  if (difficulty >= 2) patterns.push('fibonacci', 'triangular')
  if (difficulty >= 3) patterns.push('cubes', 'primes')
  return patterns
}

function getSequenceLength(difficulty: number): number {
  if (difficulty <= 1) return 4
  if (difficulty <= 2) return 5
  return 6
}

function generateArithmetic(length: number, difficulty: number): number[] {
  const diff = difficulty <= 1 ? randomInt(1, 5) : randomInt(2, 12)
  const start = randomInt(1, 20)
  const sign = difficulty >= 2 && Math.random() < 0.3 ? -1 : 1
  const seq: number[] = []
  for (let i = 0; i < length; i++) seq.push(start + sign * diff * i)
  return seq
}

function generateGeometric(length: number, difficulty: number): number[] {
  const ratio = difficulty <= 2 ? randomInt(2, 3) : randomInt(2, 4)
  const start = randomInt(1, 5)
  const seq: number[] = []
  for (let i = 0; i < length; i++) seq.push(start * Math.pow(ratio, i))
  return seq
}

function generateFibonacci(length: number): number[] {
  const a = randomInt(1, 5)
  const b = randomInt(1, 5)
  const seq = [a, b]
  for (let i = 2; i < length; i++) seq.push(seq[i - 1] + seq[i - 2])
  return seq
}

function generateSquares(length: number): number[] {
  const start = randomInt(1, 6)
  const seq: number[] = []
  for (let i = 0; i < length; i++) seq.push((start + i) * (start + i))
  return seq
}

function generateCubes(length: number): number[] {
  const start = randomInt(1, 4)
  const seq: number[] = []
  for (let i = 0; i < length; i++) {
    const n = start + i
    seq.push(n * n * n)
  }
  return seq
}

function generateTriangular(length: number): number[] {
  const start = randomInt(1, 5)
  const seq: number[] = []
  for (let i = 0; i < length; i++) {
    const n = start + i
    seq.push((n * (n + 1)) / 2)
  }
  return seq
}

function getNthPrime(n: number): number {
  const primes: number[] = []
  let candidate = 2
  while (primes.length < n) {
    let isPrime = true
    for (let d = 2; d * d <= candidate; d++) {
      if (candidate % d === 0) { isPrime = false; break }
    }
    if (isPrime) primes.push(candidate)
    candidate++
  }
  return primes[n - 1]
}

function generatePrimes(length: number): number[] {
  const startIndex = randomInt(1, 6)
  const seq: number[] = []
  for (let i = 0; i < length; i++) seq.push(getNthPrime(startIndex + i))
  return seq
}

function generateSequence(pattern: PatternKind, length: number, difficulty: number): number[] {
  switch (pattern) {
    case 'arithmetic': return generateArithmetic(length, difficulty)
    case 'geometric': return generateGeometric(length, difficulty)
    case 'fibonacci': return generateFibonacci(length)
    case 'squares': return generateSquares(length)
    case 'cubes': return generateCubes(length)
    case 'triangular': return generateTriangular(length)
    case 'primes': return generatePrimes(length)
  }
}

function patternToLabel(pattern: PatternKind): string {
  switch (pattern) {
    case 'arithmetic': return 'Arithmetic'
    case 'geometric': return 'Geometric'
    case 'fibonacci': return 'Fibonacci'
    case 'squares': return 'Square'
    case 'cubes': return 'Cubic'
    case 'triangular': return 'Triangular'
    case 'primes': return 'Prime'
  }
}

function patternToEmoji(pattern: PatternKind): string {
  switch (pattern) {
    case 'arithmetic': return '+'
    case 'geometric': return 'x'
    case 'fibonacci': return 'F'
    case 'squares': return 'n2'
    case 'cubes': return 'n3'
    case 'triangular': return 'tri'
    case 'primes': return 'P'
  }
}

function generateDistractors(answer: number, count: number): number[] {
  const distractors = new Set<number>()
  const offsets = [1, 2, 3, 5, 7, 10, -1, -2, -3, -5]
  const shuffledOffsets = shuffle(offsets)
  for (const offset of shuffledOffsets) {
    if (distractors.size >= count) break
    const candidate = answer + offset
    if (candidate !== answer && !distractors.has(candidate)) distractors.add(candidate)
  }
  while (distractors.size < count) {
    const candidate = answer + randomInt(-15, 15)
    if (candidate !== answer && !distractors.has(candidate)) distractors.add(candidate)
  }
  return Array.from(distractors).slice(0, count)
}

function createProblem(score: number): SequenceProblem {
  const difficulty = getDifficulty(score)
  const patterns = getAvailablePatterns(difficulty)
  const pattern = patterns[Math.floor(Math.random() * patterns.length)]
  const length = getSequenceLength(difficulty)
  const fullSequence = generateSequence(pattern, length + 1, difficulty)
  const displayed = fullSequence.slice(0, length)
  const answer = fullSequence[length]
  const distractors = generateDistractors(answer, 3)
  const choices = shuffle([answer, ...distractors])
  return { displayed, answer, choices, patternLabel: patternToLabel(pattern), patternKind: pattern }
}

type FeedbackState = { choiceIndex: number; kind: 'correct' | 'wrong' } | null

function SequenceMasterGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [problem, setProblem] = useState<SequenceProblem>(() => createProblem(0))
  const [solvedCount, setSolvedCount] = useState(0)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [showHint, setShowHint] = useState(false)
  const [hintAvailableMs, setHintAvailableMs] = useState(0)
  const [, setPrevDifficulty] = useState(0)
  const [showLevelUp, setShowLevelUp] = useState<string | null>(null)
  const [timeBonusAnim, setTimeBonusAnim] = useState(false)
  const [streak, setStreak] = useState(0)
  const [showStreakMilestone, setShowStreakMilestone] = useState(false)
  const [numberRevealIndex, setNumberRevealIndex] = useState(-1)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const solvedCountRef = useRef(0)
  const finishedRef = useRef(false)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const lastAnswerAtRef = useRef(0)
  const lockedRef = useRef(false)
  const hintAvailableMsRef = useRef(0)
  const streakRef = useRef(0)
  const prevDiffRef = useRef(0)
  const timeWarningPlayedRef = useRef(false)

  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const levelupAudioRef = useRef<HTMLAudioElement | null>(null)
  const timeWarningAudioRef = useRef<HTMLAudioElement | null>(null)
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
      audio.volume = Math.min(1, volume)
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  // Number reveal animation
  useEffect(() => {
    setNumberRevealIndex(-1)
    let cancelled = false
    const timers: number[] = []
    problem.displayed.forEach((_, i) => {
      timers.push(window.setTimeout(() => {
        if (!cancelled) setNumberRevealIndex(i)
      }, i * 80))
    })
    return () => { cancelled = true; timers.forEach(t => window.clearTimeout(t)) }
  }, [problem])

  const advanceProblem = useCallback((currentScore: number) => {
    const next = createProblem(currentScore)
    setProblem(next)
    setShowHint(false)
    lastAnswerAtRef.current = window.performance.now()
    lockedRef.current = false
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(feedbackTimerRef)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const useHint = useCallback(() => {
    if (hintAvailableMsRef.current > 0 || finishedRef.current || lockedRef.current) return
    setShowHint(true)
    hintAvailableMsRef.current = HINT_COOLDOWN_MS
    setHintAvailableMs(HINT_COOLDOWN_MS)
    // Small score penalty for using hint
    const nextScore = Math.max(0, scoreRef.current - HINT_PENALTY)
    scoreRef.current = nextScore
    setScore(nextScore)
  }, [])

  const handleChoice = useCallback(
    (choiceIndex: number) => {
      if (finishedRef.current || lockedRef.current) return

      const chosen = problem.choices[choiceIndex]
      const isCorrect = chosen === problem.answer
      lockedRef.current = true

      if (isCorrect) {
        const now = window.performance.now()
        const timeSinceLast = now - lastAnswerAtRef.current
        const keptCombo = timeSinceLast <= COMBO_KEEP_WINDOW_MS || comboRef.current === 0
        const nextCombo = keptCombo ? comboRef.current + 1 : 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        const nextStreak = streakRef.current + 1
        streakRef.current = nextStreak
        setStreak(nextStreak)

        // Streak milestone
        if (nextStreak > 0 && nextStreak % STREAK_MILESTONE === 0) {
          setShowStreakMilestone(true)
          window.setTimeout(() => setShowStreakMilestone(false), 1500)
        }

        const speedBonus = timeSinceLast < SPEED_BONUS_THRESHOLD_MS ? SPEED_BONUS_POINTS : 0
        const comboBonus = Math.floor(nextCombo / 5)
        const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
        const earned = (CORRECT_SCORE + comboBonus + speedBonus) * feverMult
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        const nextSolved = solvedCountRef.current + 1
        solvedCountRef.current = nextSolved
        setSolvedCount(nextSolved)

        // Time bonus
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CORRECT_MS)
        setRemainingMs(remainingMsRef.current)
        setTimeBonusAnim(true)
        window.setTimeout(() => setTimeBonusAnim(false), 600)

        // Check level up
        const newDiff = getDifficulty(nextScore)
        if (newDiff > prevDiffRef.current) {
          prevDiffRef.current = newDiff
          setPrevDifficulty(newDiff)
          const labels = ['Easy', 'Normal', 'Hard', 'Expert', 'Master']
          setShowLevelUp(labels[newDiff] ?? 'Master')
          playAudio(levelupAudioRef, 0.7)
          effects.triggerFlash('rgba(59,130,246,0.5)')
          window.setTimeout(() => setShowLevelUp(null), 2000)
        }

        // Fever mode
        if (nextCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
          playAudio(feverAudioRef, 0.7)
        }

        setFeedback({ choiceIndex, kind: 'correct' })

        // Sound: combo or correct
        if (nextCombo >= 3) {
          playAudio(comboAudioRef, 0.6, 1 + Math.min(0.4, nextCombo * 0.03))
        } else {
          playAudio(correctAudioRef, 0.6, 1 + Math.min(0.3, nextCombo * 0.02))
        }

        effects.comboHitBurst(200, 300, nextCombo, earned)
      } else {
        const nextScore = Math.max(0, scoreRef.current - WRONG_PENALTY)
        scoreRef.current = nextScore
        setScore(nextScore)

        comboRef.current = 0
        setCombo(0)
        streakRef.current = 0
        setStreak(0)

        if (feverRef.current) {
          feverRef.current = false
          feverRemainingMsRef.current = 0
          setIsFever(false)
          setFeverRemainingMs(0)
        }

        setFeedback({ choiceIndex, kind: 'wrong' })
        playAudio(wrongAudioRef, 0.5, 0.8)
        effects.triggerShake(6)
        effects.triggerFlash('rgba(239,68,68,0.4)')
      }

      clearTimeoutSafe(feedbackTimerRef)
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null
        setFeedback(null)
        advanceProblem(scoreRef.current)
      }, FEEDBACK_DURATION_MS)
    },
    [problem, playAudio, advanceProblem],
  )

  const handleExit = useCallback(() => { onExit() }, [onExit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); handleExit() }
      if (event.code === 'KeyH') { event.preventDefault(); useHint() }
      // Number keys 1-4 for quick answer
      const keyMap: Record<string, number> = { 'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3 }
      if (event.code in keyMap) { event.preventDefault(); handleChoice(keyMap[event.code]) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, useHint, handleChoice])

  useEffect(() => {
    const preloadAudio = (src: string) => {
      const audio = new Audio(src)
      audio.preload = 'auto'
      return audio
    }
    correctAudioRef.current = preloadAudio(correctSfx)
    wrongAudioRef.current = preloadAudio(wrongSfx)
    comboAudioRef.current = preloadAudio(comboSfx)
    feverAudioRef.current = preloadAudio(feverSfx)
    levelupAudioRef.current = preloadAudio(levelupSfx)
    timeWarningAudioRef.current = preloadAudio(timeWarningSfx)
    gameOverAudioRef.current = preloadAudio(gameOverHitSfx)

    lastAnswerAtRef.current = window.performance.now()

    return () => {
      clearTimeoutSafe(feedbackTimerRef)
      correctAudioRef.current = null
      wrongAudioRef.current = null
      comboAudioRef.current = null
      feverAudioRef.current = null
      levelupAudioRef.current = null
      timeWarningAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Hint cooldown
      if (hintAvailableMsRef.current > 0) {
        hintAvailableMsRef.current = Math.max(0, hintAvailableMsRef.current - deltaMs)
        setHintAvailableMs(hintAvailableMsRef.current)
      }

      // Fever countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Time warning sound
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        playAudio(timeWarningAudioRef, 0.5)
      }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.64, 0.95)
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
  }, [finishGame, playAudio, effects])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const isCriticalTime = remainingMs <= CRITICAL_TIME_THRESHOLD_MS
  const difficulty = getDifficulty(score)
  const difficultyLabels = ['Easy', 'Normal', 'Hard', 'Expert', 'Master']
  const difficultyColors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7']
  const difficultyLabel = difficultyLabels[difficulty] ?? 'Master'
  const difficultyColor = difficultyColors[difficulty] ?? '#a855f7'
  const timeSeconds = (remainingMs / 1000).toFixed(1)
  const timeProgressPercent = (remainingMs / ROUND_DURATION_MS) * 100
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const hintCooldownPercent = hintAvailableMs > 0 ? (hintAvailableMs / HINT_COOLDOWN_MS) * 100 : 0

  return (
    <section className="mini-game-panel sm-panel" aria-label="sequence-master-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .sm-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #0f172a 0%, #1e3a5f 40%, #1e293b 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
          font-family: 'Segoe UI', system-ui, sans-serif;
        }

        /* ── Header ── */
        .sm-header {
          background: linear-gradient(135deg, rgba(37,99,235,0.3), rgba(30,58,95,0.6));
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 2px solid rgba(59,130,246,0.3);
          flex-shrink: 0;
        }

        .sm-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid rgba(96,165,250,0.5);
          object-fit: contain;
          background: rgba(59,130,246,0.15);
          flex-shrink: 0;
        }

        .sm-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .sm-score-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .sm-score {
          font-size: 28px;
          font-weight: 900;
          color: #fff;
          margin: 0;
          text-shadow: 0 2px 8px rgba(59,130,246,0.5);
          letter-spacing: -1px;
          font-variant-numeric: tabular-nums;
        }

        .sm-best {
          font-size: 10px;
          color: rgba(255,255,255,0.5);
          margin: 0;
          font-weight: 600;
        }

        .sm-time-block {
          text-align: right;
          flex-shrink: 0;
        }

        .sm-time {
          font-size: 20px;
          font-weight: 800;
          color: rgba(255,255,255,0.9);
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s;
        }

        .sm-time.low-time {
          color: #fca5a5;
          animation: sm-pulse 0.5s ease-in-out infinite alternate;
        }

        .sm-time.critical-time {
          color: #ef4444;
          animation: sm-pulse 0.25s ease-in-out infinite alternate;
          text-shadow: 0 0 10px rgba(239,68,68,0.6);
        }

        @keyframes sm-pulse { from { opacity: 1; } to { opacity: 0.4; } }

        /* ── Time Progress Bar ── */
        .sm-time-bar-wrap {
          height: 4px;
          background: rgba(255,255,255,0.08);
          flex-shrink: 0;
          overflow: hidden;
        }

        .sm-time-bar {
          height: 100%;
          transition: width 0.1s linear, background 0.5s;
          border-radius: 0 2px 2px 0;
        }

        .sm-time-bonus-flash {
          animation: sm-time-bonus-pulse 0.6s ease-out;
        }

        @keyframes sm-time-bonus-pulse {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.6); }
          50% { box-shadow: 0 0 12px 4px rgba(34,197,94,0.4); }
          100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
        }

        /* ── Meta Row ── */
        .sm-meta-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 14px;
          flex-shrink: 0;
        }

        .sm-meta-row p {
          font-size: 12px;
          color: rgba(255,255,255,0.5);
          margin: 0;
          font-weight: 600;
        }

        .sm-meta-row strong { color: #fff; font-weight: 800; }

        .sm-combo-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 800;
          background: rgba(59,130,246,0.2);
          border: 1px solid rgba(59,130,246,0.3);
          transition: all 0.2s;
        }

        .sm-difficulty-badge {
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 800;
          border: 1px solid;
        }

        /* ── Fever Banner ── */
        .sm-fever-banner {
          background: linear-gradient(90deg, rgba(250,204,21,0.15), rgba(245,158,11,0.2), rgba(250,204,21,0.15));
          border-top: 1px solid rgba(250,204,21,0.3);
          border-bottom: 1px solid rgba(250,204,21,0.3);
          padding: 4px 14px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          animation: sm-fever-glow 0.5s ease-in-out infinite alternate;
          flex-shrink: 0;
        }

        @keyframes sm-fever-glow {
          from { background: linear-gradient(90deg, rgba(250,204,21,0.1), rgba(245,158,11,0.15), rgba(250,204,21,0.1)); }
          to { background: linear-gradient(90deg, rgba(250,204,21,0.2), rgba(245,158,11,0.3), rgba(250,204,21,0.2)); }
        }

        .sm-fever-text {
          color: #facc15;
          font-size: 14px;
          font-weight: 900;
          margin: 0;
          letter-spacing: 2px;
          text-shadow: 0 0 8px rgba(250,204,21,0.5);
        }

        .sm-fever-timer {
          color: #fbbf24;
          font-size: 12px;
          font-weight: 700;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        /* ── Sequence Display (main area, fills remaining space) ── */
        .sm-sequence-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 12px 14px;
          gap: 12px;
          min-height: 0;
          position: relative;
        }

        .sm-pattern-label {
          font-size: 13px;
          color: rgba(147,197,253,0.7);
          margin: 0;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 2px;
        }

        .sm-sequence-box {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 6px;
          padding: 16px 14px;
          background: rgba(37,99,235,0.1);
          border: 2px solid rgba(59,130,246,0.25);
          border-radius: 16px;
          width: 100%;
          min-height: 80px;
          transition: border-color 0.3s, background 0.3s;
        }

        .sm-sequence-box.low-time {
          border-color: rgba(239,68,68,0.4);
          background: rgba(239,68,68,0.08);
        }

        .sm-sequence-box.fever {
          border-color: rgba(250,204,21,0.4);
          background: rgba(250,204,21,0.06);
        }

        .sm-num {
          font-size: clamp(24px, 7vw, 36px);
          font-weight: 800;
          color: #93c5fd;
          padding: 2px 4px;
          font-variant-numeric: tabular-nums;
          opacity: 0;
          transform: translateY(8px);
          transition: opacity 0.15s ease-out, transform 0.15s ease-out;
        }

        .sm-num.revealed {
          opacity: 1;
          transform: translateY(0);
        }

        .sm-arrow {
          color: rgba(147,197,253,0.35);
          font-size: 18px;
          font-weight: 400;
        }

        .sm-unknown {
          font-size: clamp(32px, 9vw, 44px);
          font-weight: 900;
          color: #60a5fa;
          background: rgba(37,99,235,0.15);
          border: 2px dashed rgba(96,165,250,0.5);
          border-radius: 12px;
          padding: 2px 16px;
          animation: sm-question-bounce 1.2s ease-in-out infinite alternate;
          text-shadow: 0 0 16px rgba(96,165,250,0.4);
        }

        @keyframes sm-question-bounce {
          0% { transform: translateY(0) scale(1); }
          100% { transform: translateY(-6px) scale(1.05); }
        }

        /* ── Hint ── */
        .sm-hint-area {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 28px;
        }

        .sm-hint-btn {
          font-size: 11px;
          font-weight: 700;
          color: rgba(250,204,21,0.8);
          background: rgba(250,204,21,0.1);
          border: 1px solid rgba(250,204,21,0.3);
          border-radius: 8px;
          padding: 4px 10px;
          cursor: pointer;
          transition: all 0.15s;
          -webkit-tap-highlight-color: transparent;
          position: relative;
          overflow: hidden;
        }

        .sm-hint-btn:disabled {
          color: rgba(255,255,255,0.3);
          background: rgba(255,255,255,0.05);
          border-color: rgba(255,255,255,0.1);
          cursor: default;
        }

        .sm-hint-btn:active:not(:disabled) {
          transform: scale(0.95);
          background: rgba(250,204,21,0.2);
        }

        .sm-hint-cooldown-bar {
          position: absolute;
          bottom: 0;
          left: 0;
          height: 2px;
          background: rgba(250,204,21,0.5);
          transition: width 0.1s linear;
        }

        .sm-hint-text {
          font-size: 13px;
          color: #fbbf24;
          margin: 0;
          font-weight: 700;
          animation: sm-hint-appear 0.3s ease-out;
        }

        @keyframes sm-hint-appear {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        /* ── Choices ── */
        .sm-choices {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 10px 14px;
          flex-shrink: 0;
        }

        .sm-choice {
          font-size: clamp(20px, 5.5vw, 26px);
          font-weight: 800;
          padding: 20px 8px;
          border-radius: 14px;
          border: 2px solid rgba(59,130,246,0.3);
          background: linear-gradient(180deg, rgba(37,99,235,0.15) 0%, rgba(30,64,175,0.1) 100%);
          color: #e0e7ff;
          cursor: pointer;
          transition: background 0.12s, border-color 0.12s, transform 0.08s;
          font-variant-numeric: tabular-nums;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          position: relative;
          overflow: hidden;
        }

        .sm-choice::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 50%);
          pointer-events: none;
        }

        .sm-choice:active:not(:disabled) {
          transform: scale(0.94);
          background: rgba(37,99,235,0.25);
        }

        .sm-choice:disabled { cursor: default; }

        .sm-choice.correct-flash {
          background: linear-gradient(180deg, #22c55e, #16a34a) !important;
          border-color: #16a34a !important;
          color: #fff !important;
          animation: sm-pop 0.35s ease-out;
          box-shadow: 0 0 20px rgba(34,197,94,0.5);
        }

        .sm-choice.wrong-flash {
          background: linear-gradient(180deg, #ef4444, #dc2626) !important;
          border-color: #dc2626 !important;
          color: #fff !important;
          animation: sm-shake 0.35s ease-out;
        }

        .sm-choice.reveal-correct {
          background: rgba(34,197,94,0.15) !important;
          border-color: #22c55e !important;
          color: #4ade80 !important;
        }

        .sm-choice.hint-highlight {
          border-color: rgba(239,68,68,0.5) !important;
          background: rgba(239,68,68,0.1) !important;
          color: rgba(255,255,255,0.3) !important;
        }

        /* ── Bottom Bar ── */
        .sm-bottom-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 14px 12px;
          flex-shrink: 0;
        }

        .sm-exit-btn {
          font-size: 12px;
          font-weight: 600;
          color: rgba(255,255,255,0.4);
          background: transparent;
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 8px;
          padding: 6px 14px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .sm-exit-btn:active { background: rgba(255,255,255,0.06); }

        .sm-streak-badge {
          font-size: 11px;
          font-weight: 700;
          color: #f59e0b;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        /* ── Level Up Overlay ── */
        .sm-levelup-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 20;
          animation: sm-levelup-in 0.5s ease-out;
        }

        .sm-levelup-text {
          font-size: 36px;
          font-weight: 900;
          color: #fff;
          text-shadow: 0 0 20px rgba(59,130,246,0.8), 0 4px 12px rgba(0,0,0,0.4);
          animation: sm-levelup-scale 2s ease-out forwards;
        }

        @keyframes sm-levelup-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes sm-levelup-scale {
          0% { transform: scale(0.5); opacity: 0; }
          20% { transform: scale(1.2); opacity: 1; }
          40% { transform: scale(1); opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; transform: scale(1.1) translateY(-20px); }
        }

        /* ── Streak Milestone ── */
        .sm-streak-milestone {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 24px;
          font-weight: 900;
          color: #f59e0b;
          text-shadow: 0 0 16px rgba(245,158,11,0.6);
          pointer-events: none;
          z-index: 15;
          animation: sm-streak-pop 1.5s ease-out forwards;
        }

        @keyframes sm-streak-pop {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          20% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          40% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -70%) scale(0.9); }
        }

        @keyframes sm-pop {
          0% { transform: scale(1); }
          40% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }

        @keyframes sm-shake {
          0% { transform: translateX(0); }
          20% { transform: translateX(-7px); }
          40% { transform: translateX(7px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
          100% { transform: translateX(0); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Level Up Overlay */}
      {showLevelUp && (
        <div className="sm-levelup-overlay">
          <span className="sm-levelup-text">LEVEL UP! {showLevelUp}</span>
        </div>
      )}

      {/* Streak Milestone */}
      {showStreakMilestone && (
        <div className="sm-streak-milestone">
          {streak} STREAK!
        </div>
      )}

      {/* Header */}
      <div className="sm-header">
        <img className="sm-avatar" src={songChangsikImage} alt="" />
        <div className="sm-header-info">
          <div className="sm-score-row">
            <p className="sm-score">{score.toLocaleString()}</p>
            <p className="sm-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="sm-time-block">
          <p className={`sm-time ${isCriticalTime ? 'critical-time' : isLowTime ? 'low-time' : ''}`}>{timeSeconds}s</p>
        </div>
      </div>

      {/* Time Progress Bar */}
      <div className={`sm-time-bar-wrap ${timeBonusAnim ? 'sm-time-bonus-flash' : ''}`}>
        <div
          className="sm-time-bar"
          style={{
            width: `${timeProgressPercent}%`,
            background: isCriticalTime
              ? '#ef4444'
              : isLowTime
                ? '#f59e0b'
                : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
          }}
        />
      </div>

      {/* Meta Row */}
      <div className="sm-meta-row">
        <span className="sm-combo-tag" style={{
          borderColor: combo > 0 ? comboColor : 'rgba(59,130,246,0.3)',
          color: combo > 0 ? comboColor : 'rgba(255,255,255,0.5)',
          background: combo > 0 ? `${comboColor}15` : 'rgba(59,130,246,0.1)',
        }}>
          x{combo}
          {comboLabel && <span style={{ fontSize: 10 }}>{comboLabel}</span>}
        </span>
        <p>Solved <strong>{solvedCount}</strong></p>
        <span className="sm-difficulty-badge" style={{ color: difficultyColor, borderColor: `${difficultyColor}60` }}>
          {difficultyLabel}
        </span>
      </div>

      {/* Fever Banner */}
      {isFever && (
        <div className="sm-fever-banner">
          <p className="sm-fever-text">FEVER x{FEVER_MULTIPLIER}</p>
          <p className="sm-fever-timer">{(feverRemainingMs / 1000).toFixed(1)}s</p>
        </div>
      )}

      {/* Sequence Display Area */}
      <div className="sm-sequence-area">
        {showHint && (
          <p className="sm-pattern-label">{problem.patternLabel} Pattern ({patternToEmoji(problem.patternKind)})</p>
        )}

        <div className={`sm-sequence-box ${isFever ? 'fever' : isLowTime ? 'low-time' : ''}`}>
          {problem.displayed.map((num, index) => (
            <span key={`num-${index}`}>
              <span className={`sm-num ${numberRevealIndex >= index ? 'revealed' : ''}`}>{num}</span>
              {index < problem.displayed.length - 1 && <span className="sm-arrow">, </span>}
            </span>
          ))}
          <span className="sm-arrow">, </span>
          <span className="sm-num sm-unknown revealed">?</span>
        </div>

        <div className="sm-hint-area">
          <button
            className="sm-hint-btn"
            onClick={useHint}
            disabled={hintAvailableMs > 0 || showHint}
            type="button"
          >
            HINT (-{HINT_PENALTY}pt)
            {hintAvailableMs > 0 && (
              <span className="sm-hint-cooldown-bar" style={{ width: `${hintCooldownPercent}%` }} />
            )}
          </button>
          {hintAvailableMs > 0 && (
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{Math.ceil(hintAvailableMs / 1000)}s</span>
          )}
        </div>
      </div>

      {/* Choices */}
      <div className="sm-choices">
        {problem.choices.map((choice, index) => {
          let feedbackClass = ''
          if (feedback !== null) {
            if (feedback.choiceIndex === index) {
              feedbackClass = feedback.kind === 'correct' ? 'correct-flash' : 'wrong-flash'
            } else if (feedback.kind === 'wrong' && choice === problem.answer) {
              feedbackClass = 'reveal-correct'
            }
          }
          // Hint: eliminate one wrong answer
          const isHintEliminated = showHint && !feedback && choice !== problem.answer && index === problem.choices.findIndex(c => c !== problem.answer)
          return (
            <button
              className={`sm-choice ${feedbackClass} ${isHintEliminated ? 'hint-highlight' : ''}`}
              key={`choice-${index}`}
              type="button"
              onClick={() => handleChoice(index)}
              disabled={lockedRef.current || isHintEliminated}
            >
              {choice}
            </button>
          )
        })}
      </div>

      {/* Bottom Bar */}
      <div className="sm-bottom-bar">
        <button className="sm-exit-btn" type="button" onClick={handleExit}>EXIT</button>
        {streak >= 3 && (
          <span className="sm-streak-badge">
            {streak} streak
          </span>
        )}
      </div>
    </section>
  )
}

export const sequenceMasterModule: MiniGameModule = {
  manifest: {
    id: 'sequence-master',
    title: 'Sequence Master',
    description: 'Read the number pattern, guess the next!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#2563eb',
  },
  Component: SequenceMasterGame,
}
