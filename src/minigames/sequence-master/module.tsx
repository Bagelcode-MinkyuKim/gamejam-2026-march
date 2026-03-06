import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

import correctSfx from '../../../assets/sounds/sequence-correct.mp3'
import wrongSfx from '../../../assets/sounds/sequence-wrong.mp3'
import comboSfx from '../../../assets/sounds/sequence-combo.mp3'
import feverSfx from '../../../assets/sounds/sequence-fever.mp3'
import levelupSfx from '../../../assets/sounds/sequence-levelup.mp3'
import timeWarningSfx from '../../../assets/sounds/sequence-time-warning.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import perfectSfx from '../../../assets/sounds/sequence-perfect.mp3'
import bossSfx from '../../../assets/sounds/sequence-boss.mp3'
import lifeLostSfx from '../../../assets/sounds/sequence-life-lost.mp3'
import powerupSfx from '../../../assets/sounds/sequence-powerup.mp3'

// ─── Constants ──────────────────────────────────────────
const ROUND_DURATION_MS = 90000
const LOW_TIME_THRESHOLD_MS = 15000
const CRITICAL_TIME_THRESHOLD_MS = 5000
const CORRECT_SCORE = 10
const WRONG_PENALTY = 5
const FEEDBACK_DURATION_MS = 450
const COMBO_KEEP_WINDOW_MS = 4500
const SPEED_BONUS_THRESHOLD_MS = 1800
const SPEED_BONUS_POINTS = 8
const FEVER_COMBO_THRESHOLD = 5
const FEVER_DURATION_MS = 8000
const FEVER_MULTIPLIER = 3
const TIME_BONUS_PER_CORRECT_MS = 1200
const HINT_COOLDOWN_MS = 12000
const HINT_PENALTY = 3
const STREAK_MILESTONE = 10
const INITIAL_LIVES = 3
const MAX_LIVES = 5
const BOSS_INTERVAL = 8
const BOSS_BONUS_SCORE = 30
const BOSS_BONUS_TIME_MS = 5000
const PERFECT_THRESHOLD_MS = 1200

const DIFFICULTY_THRESHOLDS = [0, 30, 60, 100, 160] as const
const PIXEL_CHARS = [songChangsikImage, seoTaijiImage, kimYeonjaImage, taeJinaImage]

type PatternKind = 'arithmetic' | 'geometric' | 'fibonacci' | 'squares' | 'cubes' | 'triangular' | 'primes'
type PowerUpKind = 'freeze' | 'double' | 'heal'

interface SequenceProblem {
  readonly displayed: number[]
  readonly answer: number
  readonly choices: number[]
  readonly patternLabel: string
  readonly patternKind: PatternKind
  readonly isBoss: boolean
}

interface ActivePowerUp {
  kind: PowerUpKind
  remainingMs: number
}

// ─── Utility ──────────────────────────────────────────
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

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ─── Game Logic ──────────────────────────────────────────
function getDifficulty(score: number): number {
  for (let i = DIFFICULTY_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= DIFFICULTY_THRESHOLDS[i]) return i
  }
  return 0
}

function getAvailablePatterns(difficulty: number): PatternKind[] {
  const patterns: PatternKind[] = ['arithmetic']
  if (difficulty >= 1) patterns.push('geometric', 'squares')
  if (difficulty >= 2) patterns.push('fibonacci', 'triangular')
  if (difficulty >= 3) patterns.push('cubes', 'primes')
  return patterns
}

function getSequenceLength(difficulty: number, isBoss: boolean): number {
  const base = difficulty <= 1 ? 4 : difficulty <= 2 ? 5 : 6
  return isBoss ? base + 1 : base
}

function generateArithmetic(length: number, difficulty: number): number[] {
  const diff = difficulty <= 1 ? randomInt(1, 5) : randomInt(2, 12)
  const start = randomInt(1, 20)
  const sign = difficulty >= 2 && Math.random() < 0.3 ? -1 : 1
  return Array.from({ length }, (_, i) => start + sign * diff * i)
}

function generateGeometric(length: number, difficulty: number): number[] {
  const ratio = difficulty <= 2 ? randomInt(2, 3) : randomInt(2, 4)
  const start = randomInt(1, 5)
  return Array.from({ length }, (_, i) => start * Math.pow(ratio, i))
}

function generateFibonacci(length: number): number[] {
  const seq = [randomInt(1, 5), randomInt(1, 5)]
  for (let i = 2; i < length; i++) seq.push(seq[i - 1] + seq[i - 2])
  return seq
}

function generateSquares(length: number): number[] {
  const start = randomInt(1, 6)
  return Array.from({ length }, (_, i) => (start + i) * (start + i))
}

function generateCubes(length: number): number[] {
  const start = randomInt(1, 4)
  return Array.from({ length }, (_, i) => { const n = start + i; return n * n * n })
}

function generateTriangular(length: number): number[] {
  const start = randomInt(1, 5)
  return Array.from({ length }, (_, i) => { const n = start + i; return (n * (n + 1)) / 2 })
}

function getNthPrime(n: number): number {
  const primes: number[] = []
  let c = 2
  while (primes.length < n) {
    let ok = true
    for (let d = 2; d * d <= c; d++) { if (c % d === 0) { ok = false; break } }
    if (ok) primes.push(c)
    c++
  }
  return primes[n - 1]
}

function generatePrimes(length: number): number[] {
  const s = randomInt(1, 6)
  return Array.from({ length }, (_, i) => getNthPrime(s + i))
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

const PATTERN_LABELS: Record<PatternKind, string> = {
  arithmetic: 'ADD', geometric: 'MUL', fibonacci: 'FIB',
  squares: 'SQR', cubes: 'CUB', triangular: 'TRI', primes: 'PRM',
}

function generateDistractors(answer: number, count: number): number[] {
  const distractors = new Set<number>()
  for (const offset of shuffle([1, 2, 3, 5, 7, 10, -1, -2, -3, -5])) {
    if (distractors.size >= count) break
    const c = answer + offset
    if (c !== answer) distractors.add(c)
  }
  while (distractors.size < count) {
    const c = answer + randomInt(-15, 15)
    if (c !== answer) distractors.add(c)
  }
  return Array.from(distractors).slice(0, count)
}

function createProblem(score: number, solvedCount: number): SequenceProblem {
  const difficulty = getDifficulty(score)
  const patterns = getAvailablePatterns(difficulty)
  const pattern = pickRandom(patterns)
  const isBoss = solvedCount > 0 && solvedCount % BOSS_INTERVAL === 0
  const length = getSequenceLength(difficulty, isBoss)
  const fullSequence = generateSequence(pattern, length + 1, difficulty)
  const displayed = fullSequence.slice(0, length)
  const answer = fullSequence[length]
  const distractors = generateDistractors(answer, 3)
  const choices = shuffle([answer, ...distractors])
  return { displayed, answer, choices, patternLabel: PATTERN_LABELS[pattern], patternKind: pattern, isBoss }
}

function shouldDropPowerUp(): PowerUpKind | null {
  if (Math.random() > 0.12) return null
  return pickRandom(['freeze', 'double', 'heal'] as const)
}

const POWER_UP_LABELS: Record<PowerUpKind, string> = { freeze: 'FREEZE', double: 'x2 PTS', heal: '+1 HP' }
const POWER_UP_COLORS: Record<PowerUpKind, string> = { freeze: '#67e8f9', double: '#fbbf24', heal: '#f87171' }
const POWER_UP_DURATION: Record<PowerUpKind, number> = { freeze: 5000, double: 8000, heal: 0 }

type FeedbackState = { choiceIndex: number; kind: 'correct' | 'wrong' } | null

// ─── Component ──────────────────────────────────────────
function SequenceMasterGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [problem, setProblem] = useState<SequenceProblem>(() => createProblem(0, 0))
  const [solvedCount, setSolvedCount] = useState(0)
  const [feedback, setFeedback] = useState<FeedbackState>(null)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [showHint, setShowHint] = useState(false)
  const [hintAvailableMs, setHintAvailableMs] = useState(0)
  const [showLevelUp, setShowLevelUp] = useState<string | null>(null)
  const [timeBonusAnim, setTimeBonusAnim] = useState(false)
  const [streak, setStreak] = useState(0)
  const [showStreakMilestone, setShowStreakMilestone] = useState(false)
  const [numberRevealIndex, setNumberRevealIndex] = useState(-1)
  const [lives, setLives] = useState(INITIAL_LIVES)
  const [showPerfect, setShowPerfect] = useState(false)
  const [charImage, setCharImage] = useState(songChangsikImage)
  const [charReaction, setCharReaction] = useState<'idle' | 'happy' | 'sad' | 'fever'>('idle')
  const [activePowerUp, setActivePowerUp] = useState<ActivePowerUp | null>(null)
  const [showPowerUpGet, setShowPowerUpGet] = useState<PowerUpKind | null>(null)
  const [showBossLabel, setShowBossLabel] = useState(false)
  const [pixelStars, setPixelStars] = useState(0) // 0-3 stars based on speed

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
  const livesRef = useRef(INITIAL_LIVES)
  const activePowerUpRef = useRef<ActivePowerUp | null>(null)
  const freezeActiveRef = useRef(false)
  const doubleActiveRef = useRef(false)

  // Audio refs
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
  }

  const playAudio = useCallback((name: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[name]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  // Number reveal animation
  useEffect(() => {
    setNumberRevealIndex(-1)
    let cancelled = false
    const timers = problem.displayed.map((_, i) =>
      window.setTimeout(() => { if (!cancelled) setNumberRevealIndex(i) }, i * 60)
    )
    return () => { cancelled = true; timers.forEach(t => window.clearTimeout(t)) }
  }, [problem])

  // Boss label animation
  useEffect(() => {
    if (problem.isBoss) {
      setShowBossLabel(true)
      playAudio('boss', 0.6)
      const t = window.setTimeout(() => setShowBossLabel(false), 1500)
      return () => window.clearTimeout(t)
    }
  }, [problem, playAudio])

  const advanceProblem = useCallback((currentScore: number, currentSolved: number) => {
    const next = createProblem(currentScore, currentSolved)
    setProblem(next)
    setShowHint(false)
    setPixelStars(0)
    lastAnswerAtRef.current = window.performance.now()
    lockedRef.current = false
    // Random character change
    if (Math.random() < 0.3) setCharImage(pickRandom(PIXEL_CHARS))
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(feedbackTimerRef)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const useHint = useCallback(() => {
    if (hintAvailableMsRef.current > 0 || finishedRef.current || lockedRef.current || showHint) return
    setShowHint(true)
    hintAvailableMsRef.current = HINT_COOLDOWN_MS
    setHintAvailableMs(HINT_COOLDOWN_MS)
    const nextScore = Math.max(0, scoreRef.current - HINT_PENALTY)
    scoreRef.current = nextScore
    setScore(nextScore)
  }, [showHint])

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

        // Speed star rating
        const stars = timeSinceLast < PERFECT_THRESHOLD_MS ? 3 : timeSinceLast < SPEED_BONUS_THRESHOLD_MS ? 2 : 1
        setPixelStars(stars)

        // Perfect answer
        if (stars === 3) {
          setShowPerfect(true)
          playAudio('perfect', 0.5)
          window.setTimeout(() => setShowPerfect(false), 800)
        }

        // Streak milestone
        if (nextStreak > 0 && nextStreak % STREAK_MILESTONE === 0) {
          setShowStreakMilestone(true)
          window.setTimeout(() => setShowStreakMilestone(false), 1500)
        }

        const speedBonus = timeSinceLast < SPEED_BONUS_THRESHOLD_MS ? SPEED_BONUS_POINTS : 0
        const comboBonus = Math.floor(nextCombo / 3) * 2
        const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
        const doubleMult = doubleActiveRef.current ? 2 : 1
        const bossBonus = problem.isBoss ? BOSS_BONUS_SCORE : 0
        const earned = ((CORRECT_SCORE + comboBonus + speedBonus) * feverMult * doubleMult) + bossBonus
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        const nextSolved = solvedCountRef.current + 1
        solvedCountRef.current = nextSolved
        setSolvedCount(nextSolved)

        // Time bonus
        const timeBonus = problem.isBoss ? BOSS_BONUS_TIME_MS : TIME_BONUS_PER_CORRECT_MS
        if (!freezeActiveRef.current) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + timeBonus)
          setRemainingMs(remainingMsRef.current)
        }
        setTimeBonusAnim(true)
        window.setTimeout(() => setTimeBonusAnim(false), 600)

        // Level up check
        const newDiff = getDifficulty(nextScore)
        if (newDiff > prevDiffRef.current) {
          prevDiffRef.current = newDiff
          const labels = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER']
          setShowLevelUp(labels[newDiff] ?? 'MASTER')
          playAudio('levelup', 0.7)
          effects.triggerFlash('rgba(96,165,250,0.5)')
          window.setTimeout(() => setShowLevelUp(null), 2000)
        }

        // Fever mode
        if (nextCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          setCharReaction('fever')
          effects.triggerFlash('rgba(250,204,21,0.5)')
          playAudio('fever', 0.7)
        }

        // Power-up drop
        const powerDrop = shouldDropPowerUp()
        if (powerDrop) {
          if (powerDrop === 'heal') {
            if (livesRef.current < MAX_LIVES) {
              livesRef.current += 1
              setLives(livesRef.current)
            }
          } else {
            const dur = POWER_UP_DURATION[powerDrop]
            activePowerUpRef.current = { kind: powerDrop, remainingMs: dur }
            setActivePowerUp({ kind: powerDrop, remainingMs: dur })
            if (powerDrop === 'freeze') freezeActiveRef.current = true
            if (powerDrop === 'double') doubleActiveRef.current = true
          }
          setShowPowerUpGet(powerDrop)
          playAudio('powerup', 0.6)
          window.setTimeout(() => setShowPowerUpGet(null), 1200)
        }

        setFeedback({ choiceIndex, kind: 'correct' })
        setCharReaction('happy')
        window.setTimeout(() => setCharReaction(feverRef.current ? 'fever' : 'idle'), 600)

        if (nextCombo >= 3) {
          playAudio('combo', 0.6, 1 + Math.min(0.4, nextCombo * 0.03))
        } else {
          playAudio('correct', 0.6, 1 + Math.min(0.3, nextCombo * 0.02))
        }

        effects.comboHitBurst(200, 300, nextCombo, earned)
      } else {
        // Wrong answer
        const nextScore = Math.max(0, scoreRef.current - WRONG_PENALTY)
        scoreRef.current = nextScore
        setScore(nextScore)

        comboRef.current = 0
        setCombo(0)
        streakRef.current = 0
        setStreak(0)

        // Lose a life
        livesRef.current = Math.max(0, livesRef.current - 1)
        setLives(livesRef.current)

        if (feverRef.current) {
          feverRef.current = false
          feverRemainingMsRef.current = 0
          setIsFever(false)
          setFeverRemainingMs(0)
        }

        setFeedback({ choiceIndex, kind: 'wrong' })
        setCharReaction('sad')
        window.setTimeout(() => setCharReaction('idle'), 800)

        if (livesRef.current <= 0) {
          playAudio('gameover', 0.64, 0.95)
          window.setTimeout(() => finishGame(), 600)
        } else {
          playAudio('lifelost', 0.5)
        }

        playAudio('wrong', 0.5, 0.8)
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.5)')
      }

      clearTimeoutSafe(feedbackTimerRef)
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null
        setFeedback(null)
        if (!finishedRef.current) advanceProblem(scoreRef.current, solvedCountRef.current)
      }, FEEDBACK_DURATION_MS)
    },
    [problem, playAudio, advanceProblem, finishGame, effects],
  )

  const handleExit = useCallback(() => { onExit() }, [onExit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); handleExit() }
      if (event.code === 'KeyH') { event.preventDefault(); useHint() }
      const keyMap: Record<string, number> = { 'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3 }
      if (event.code in keyMap) { event.preventDefault(); handleChoice(keyMap[event.code]) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, useHint, handleChoice])

  useEffect(() => {
    const sources: Record<string, string> = {
      correct: correctSfx, wrong: wrongSfx, combo: comboSfx, fever: feverSfx,
      levelup: levelupSfx, timewarning: timeWarningSfx, gameover: gameOverHitSfx,
      perfect: perfectSfx, boss: bossSfx, lifelost: lifeLostSfx, powerup: powerupSfx,
    }
    for (const [name, src] of Object.entries(sources)) {
      const a = new Audio(src); a.preload = 'auto'; audioRefs.current[name] = a
    }
    lastAnswerAtRef.current = window.performance.now()
    return () => {
      clearTimeoutSafe(feedbackTimerRef)
      for (const name of Object.keys(audioRefs.current)) audioRefs.current[name] = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // Time countdown (freeze pauses timer)
      if (!freezeActiveRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
        setRemainingMs(remainingMsRef.current)
      }

      // Hint cooldown
      if (hintAvailableMsRef.current > 0) {
        hintAvailableMsRef.current = Math.max(0, hintAvailableMsRef.current - deltaMs)
        setHintAvailableMs(hintAvailableMsRef.current)
      }

      // Fever countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      // Power-up countdown
      if (activePowerUpRef.current) {
        activePowerUpRef.current.remainingMs -= deltaMs
        if (activePowerUpRef.current.remainingMs <= 0) {
          if (activePowerUpRef.current.kind === 'freeze') freezeActiveRef.current = false
          if (activePowerUpRef.current.kind === 'double') doubleActiveRef.current = false
          activePowerUpRef.current = null
          setActivePowerUp(null)
        } else {
          setActivePowerUp({ ...activePowerUpRef.current })
        }
      }

      // Time warning
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        playAudio('timewarning', 0.5)
      }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
        playAudio('gameover', 0.64, 0.95)
        finishGame()
        animationFrameRef.current = null
        return
      }

      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null; lastFrameAtRef.current = null
    }
  }, [finishGame, playAudio, effects])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const isCriticalTime = remainingMs <= CRITICAL_TIME_THRESHOLD_MS
  const difficulty = getDifficulty(score)
  const difficultyLabels = ['LV.1', 'LV.2', 'LV.3', 'LV.4', 'LV.5']
  const difficultyColors = ['#4ade80', '#60a5fa', '#fbbf24', '#f87171', '#c084fc']
  const difficultyLabel = difficultyLabels[difficulty] ?? 'LV.5'
  const difficultyColor = difficultyColors[difficulty] ?? '#c084fc'
  const timeSeconds = Math.ceil(remainingMs / 1000)
  const timeProgressPercent = (remainingMs / ROUND_DURATION_MS) * 100
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  return (
    <section className="mini-game-panel sm-px" aria-label="sequence-master-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .sm-px {
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
          image-rendering: pixelated;
          position: relative;
        }

        /* Scanline overlay */
        .sm-px::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 50;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.08) 2px,
            rgba(0,0,0,0.08) 4px
          );
        }

        /* ── Pixel Header ── */
        .sm-px-header {
          background: #16213e;
          padding: 8px 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          border-bottom: 4px solid #0f3460;
          flex-shrink: 0;
        }

        .sm-px-char-wrap {
          width: 48px;
          height: 48px;
          border: 3px solid #0f3460;
          background: #1a1a2e;
          flex-shrink: 0;
          overflow: hidden;
          position: relative;
        }

        .sm-px-char-wrap img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          image-rendering: pixelated;
          transition: transform 0.15s steps(2);
        }

        .sm-px-char-wrap.happy img { transform: scale(1.1) translateY(-2px); }
        .sm-px-char-wrap.sad img { transform: scale(0.9) translateY(2px); filter: brightness(0.7); }
        .sm-px-char-wrap.fever img { animation: sm-px-char-fever 0.3s steps(2) infinite alternate; }

        @keyframes sm-px-char-fever {
          from { transform: scale(1.05) rotate(-3deg); }
          to { transform: scale(1.1) rotate(3deg); }
        }

        .sm-px-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }

        .sm-px-score {
          font-size: 16px;
          color: #e2e8f0;
          margin: 0;
          text-shadow: 2px 2px 0 #0f3460;
        }

        .sm-px-best {
          font-size: 7px;
          color: #64748b;
          margin: 0;
        }

        /* ── Lives (pixel hearts) ── */
        .sm-px-lives {
          display: flex;
          gap: 3px;
          flex-shrink: 0;
        }

        .sm-px-heart {
          width: 16px;
          height: 14px;
          position: relative;
        }

        .sm-px-heart::before, .sm-px-heart::after {
          content: '';
          position: absolute;
          background: #f87171;
          image-rendering: pixelated;
        }

        .sm-px-heart::before {
          width: 16px; height: 10px; top: 2px; left: 0;
          clip-path: polygon(0 40%, 25% 0, 50% 30%, 75% 0, 100% 40%, 50% 100%);
        }

        .sm-px-heart.empty::before { background: #374151; }
        .sm-px-heart.lost { animation: sm-px-heart-break 0.4s ease-out; }

        @keyframes sm-px-heart-break {
          0% { transform: scale(1); }
          30% { transform: scale(1.3); }
          100% { transform: scale(1); opacity: 0.5; }
        }

        /* ── Time Bar ── */
        .sm-px-timebar {
          height: 8px;
          background: #16213e;
          border-bottom: 2px solid #0f3460;
          padding: 1px 2px;
          flex-shrink: 0;
          position: relative;
        }

        .sm-px-timebar-fill {
          height: 100%;
          transition: width 0.15s steps(4);
          image-rendering: pixelated;
        }

        .sm-px-timebar.flash { animation: sm-px-time-flash 0.5s steps(3); }

        @keyframes sm-px-time-flash {
          0% { background: #16213e; }
          50% { background: #22c55e; }
          100% { background: #16213e; }
        }

        .sm-px-time-text {
          position: absolute;
          right: 6px;
          top: -1px;
          font-size: 6px;
          color: #94a3b8;
        }

        .sm-px-time-text.warn { color: #fbbf24; animation: sm-px-blink 0.5s steps(1) infinite; }
        .sm-px-time-text.danger { color: #ef4444; animation: sm-px-blink 0.25s steps(1) infinite; }

        @keyframes sm-px-blink { 0% { opacity: 1; } 50% { opacity: 0; } }

        /* ── Meta Row ── */
        .sm-px-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 10px;
          flex-shrink: 0;
          gap: 4px;
        }

        .sm-px-tag {
          font-size: 7px;
          padding: 3px 6px;
          border: 2px solid;
          display: inline-block;
        }

        /* ── Fever Bar ── */
        .sm-px-fever {
          background: #1a1a2e;
          border-top: 2px solid #facc15;
          border-bottom: 2px solid #facc15;
          padding: 4px 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
          animation: sm-px-fever-bg 0.4s steps(2) infinite alternate;
        }

        @keyframes sm-px-fever-bg {
          from { background: #1a1a2e; }
          to { background: #2d2006; }
        }

        .sm-px-fever-text {
          font-size: 10px;
          color: #facc15;
          margin: 0;
          text-shadow: 2px 2px 0 #78350f;
        }

        .sm-px-fever-timer { font-size: 8px; color: #fbbf24; margin: 0; }

        /* ── Power-up indicator ── */
        .sm-px-powerup-bar {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 3px 10px;
          background: rgba(0,0,0,0.3);
          flex-shrink: 0;
        }

        .sm-px-powerup-label { font-size: 7px; margin: 0; }
        .sm-px-powerup-meter {
          flex: 1;
          height: 4px;
          background: #1e293b;
        }
        .sm-px-powerup-meter-fill {
          height: 100%;
          transition: width 0.15s steps(4);
        }

        /* ── Main Sequence Area ── */
        .sm-px-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 10px;
          gap: 10px;
          min-height: 0;
          position: relative;
        }

        .sm-px-pattern-tag {
          font-size: 8px;
          color: #94a3b8;
          padding: 2px 8px;
          border: 2px solid #334155;
          background: #1e293b;
          animation: sm-px-tag-in 0.2s steps(3);
        }

        @keyframes sm-px-tag-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .sm-px-seq-box {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 2px;
          padding: 14px 10px;
          background: #16213e;
          border: 3px solid #0f3460;
          width: 100%;
          min-height: 72px;
          transition: border-color 0.2s steps(2);
        }

        .sm-px-seq-box.boss-box { border-color: #f59e0b; box-shadow: 0 0 0 2px #78350f; }
        .sm-px-seq-box.low-time-box { border-color: #dc2626; }
        .sm-px-seq-box.fever-box { border-color: #facc15; }

        .sm-px-num-cell {
          font-size: clamp(18px, 5.5vw, 28px);
          color: #93c5fd;
          padding: 2px 4px;
          text-shadow: 2px 2px 0 #1e3a5f;
          opacity: 0;
          transition: opacity 0.1s steps(2);
        }

        .sm-px-num-cell.on { opacity: 1; }

        .sm-px-sep { color: #334155; font-size: 14px; margin: 0 1px; }

        .sm-px-mystery {
          font-size: clamp(24px, 7vw, 36px);
          color: #60a5fa;
          background: #0f3460;
          border: 2px dashed #3b82f6;
          padding: 2px 12px;
          animation: sm-px-mystery-blink 0.8s steps(1) infinite;
          text-shadow: 2px 2px 0 #1e3a5f;
        }

        @keyframes sm-px-mystery-blink {
          0% { border-color: #3b82f6; }
          50% { border-color: #1d4ed8; }
        }

        /* Stars */
        .sm-px-stars {
          display: flex;
          gap: 4px;
          height: 14px;
        }

        .sm-px-star {
          width: 12px;
          height: 12px;
          display: inline-block;
          clip-path: polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
        }

        .sm-px-star.filled { background: #fbbf24; animation: sm-px-star-pop 0.3s steps(3); }
        .sm-px-star.empty { background: #374151; }

        @keyframes sm-px-star-pop {
          0% { transform: scale(0); }
          60% { transform: scale(1.4); }
          100% { transform: scale(1); }
        }

        /* ── Hint ── */
        .sm-px-hint {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 20px;
        }

        .sm-px-hint-btn {
          font-family: 'Press Start 2P', monospace;
          font-size: 7px;
          color: #fbbf24;
          background: #1e293b;
          border: 2px solid #fbbf24;
          padding: 4px 8px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .sm-px-hint-btn:disabled {
          color: #475569;
          border-color: #334155;
          cursor: default;
        }

        .sm-px-hint-btn:active:not(:disabled) { background: #334155; }

        .sm-px-hint-cd { font-size: 6px; color: #475569; }

        /* ── Choices ── */
        .sm-px-choices {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 8px 10px;
          flex-shrink: 0;
        }

        .sm-px-btn {
          font-family: 'Press Start 2P', monospace;
          font-size: clamp(14px, 4vw, 20px);
          padding: 16px 6px;
          border: 3px solid #334155;
          background: #1e293b;
          color: #cbd5e1;
          cursor: pointer;
          transition: all 0.08s steps(2);
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          text-shadow: 1px 1px 0 #0f172a;
          position: relative;
        }

        .sm-px-btn::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          background: #0f172a;
        }

        .sm-px-btn:active:not(:disabled) {
          transform: translateY(2px);
          border-color: #60a5fa;
        }

        .sm-px-btn:active:not(:disabled)::after { height: 0; }

        .sm-px-btn:disabled { cursor: default; }

        .sm-px-btn.correct-flash {
          background: #166534 !important;
          border-color: #22c55e !important;
          color: #4ade80 !important;
          animation: sm-px-correct-anim 0.35s steps(4);
        }

        .sm-px-btn.wrong-flash {
          background: #7f1d1d !important;
          border-color: #ef4444 !important;
          color: #fca5a5 !important;
          animation: sm-px-shake 0.35s steps(6);
        }

        .sm-px-btn.reveal-correct {
          border-color: #22c55e !important;
          color: #4ade80 !important;
        }

        .sm-px-btn.hint-x {
          border-color: #991b1b !important;
          color: #475569 !important;
          background: #1a1a2e !important;
          text-decoration: line-through;
        }

        @keyframes sm-px-correct-anim {
          0% { transform: scale(1); }
          30% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }

        @keyframes sm-px-shake {
          0% { transform: translateX(0); }
          16% { transform: translateX(-5px); }
          33% { transform: translateX(5px); }
          50% { transform: translateX(-3px); }
          66% { transform: translateX(3px); }
          100% { transform: translateX(0); }
        }

        /* ── Bottom ── */
        .sm-px-bottom {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 10px 10px;
          flex-shrink: 0;
        }

        .sm-px-exit {
          font-family: 'Press Start 2P', monospace;
          font-size: 7px;
          color: #475569;
          background: transparent;
          border: 2px solid #334155;
          padding: 4px 10px;
          cursor: pointer;
          -webkit-tap-highlight-color: transparent;
        }

        .sm-px-exit:active { border-color: #475569; }

        .sm-px-streak { font-size: 7px; color: #f59e0b; }

        /* ── Overlays ── */
        .sm-px-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          pointer-events: none;
          z-index: 30;
        }

        .sm-px-levelup-txt {
          font-size: 20px;
          color: #60a5fa;
          text-shadow: 3px 3px 0 #1e3a5f, -1px -1px 0 #93c5fd;
          animation: sm-px-levelup 2s steps(6) forwards;
        }

        @keyframes sm-px-levelup {
          0% { transform: scale(0); opacity: 0; }
          15% { transform: scale(1.3); opacity: 1; }
          30% { transform: scale(1); opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-20px); }
        }

        .sm-px-streak-txt {
          font-size: 14px;
          color: #f59e0b;
          text-shadow: 2px 2px 0 #78350f;
          animation: sm-px-levelup 1.5s steps(6) forwards;
        }

        .sm-px-perfect-txt {
          font-size: 18px;
          color: #fbbf24;
          text-shadow: 2px 2px 0 #92400e;
          animation: sm-px-perfect 0.8s steps(4) forwards;
        }

        @keyframes sm-px-perfect {
          0% { transform: scale(0) rotate(-10deg); opacity: 0; }
          30% { transform: scale(1.4) rotate(5deg); opacity: 1; }
          60% { transform: scale(1) rotate(0deg); opacity: 1; }
          100% { opacity: 0; transform: translateY(-15px); }
        }

        .sm-px-boss-txt {
          font-size: 16px;
          color: #f87171;
          text-shadow: 2px 2px 0 #7f1d1d;
          animation: sm-px-boss-flash 1.5s steps(3) forwards;
        }

        @keyframes sm-px-boss-flash {
          0% { transform: scale(0); opacity: 0; }
          10% { transform: scale(1.5); opacity: 1; }
          20% { transform: scale(0.9); }
          30% { transform: scale(1.1); }
          50% { transform: scale(1); opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; }
        }

        .sm-px-powerup-get {
          font-size: 12px;
          text-shadow: 2px 2px 0 #0f172a;
          animation: sm-px-powerup-pop 1.2s steps(4) forwards;
          position: absolute;
          top: 40%;
          z-index: 35;
        }

        @keyframes sm-px-powerup-pop {
          0% { transform: scale(0); opacity: 0; }
          20% { transform: scale(1.5); opacity: 1; }
          40% { transform: scale(1); opacity: 1; }
          80% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-30px); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Overlays */}
      {showLevelUp && (
        <div className="sm-px-overlay"><span className="sm-px-levelup-txt">LEVEL UP! {showLevelUp}</span></div>
      )}
      {showStreakMilestone && (
        <div className="sm-px-overlay"><span className="sm-px-streak-txt">{streak} STREAK!</span></div>
      )}
      {showPerfect && (
        <div className="sm-px-overlay"><span className="sm-px-perfect-txt">PERFECT!</span></div>
      )}
      {showBossLabel && (
        <div className="sm-px-overlay"><span className="sm-px-boss-txt">BOSS ROUND!</span></div>
      )}
      {showPowerUpGet && (
        <span className="sm-px-powerup-get" style={{ color: POWER_UP_COLORS[showPowerUpGet], left: '50%', transform: 'translateX(-50%)' }}>
          {POWER_UP_LABELS[showPowerUpGet]}
        </span>
      )}

      {/* Header */}
      <div className="sm-px-header">
        <div className={`sm-px-char-wrap ${charReaction}`}>
          <img src={charImage} alt="" />
        </div>
        <div className="sm-px-header-info">
          <p className="sm-px-score">{score.toLocaleString()}</p>
          <p className="sm-px-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="sm-px-lives">
          {Array.from({ length: MAX_LIVES }, (_, i) => (
            <span key={i} className={`sm-px-heart ${i < lives ? '' : 'empty'}`} />
          ))}
        </div>
      </div>

      {/* Time Bar */}
      <div className={`sm-px-timebar ${timeBonusAnim ? 'flash' : ''}`}>
        <div
          className="sm-px-timebar-fill"
          style={{
            width: `${timeProgressPercent}%`,
            background: isCriticalTime ? '#ef4444' : isLowTime ? '#fbbf24' : '#3b82f6',
          }}
        />
        <span className={`sm-px-time-text ${isCriticalTime ? 'danger' : isLowTime ? 'warn' : ''}`}>
          {freezeActiveRef.current ? 'FROZEN' : `${timeSeconds}s`}
        </span>
      </div>

      {/* Meta */}
      <div className="sm-px-meta">
        <span className="sm-px-tag" style={{ color: combo > 0 ? comboColor : '#475569', borderColor: combo > 0 ? comboColor : '#334155' }}>
          x{combo} {comboLabel ?? ''}
        </span>
        <span className="sm-px-tag" style={{ color: '#94a3b8', borderColor: '#334155' }}>
          #{solvedCount}
        </span>
        <span className="sm-px-tag" style={{ color: difficultyColor, borderColor: difficultyColor }}>
          {difficultyLabel}
        </span>
      </div>

      {/* Fever */}
      {isFever && (
        <div className="sm-px-fever">
          <p className="sm-px-fever-text">FEVER x{FEVER_MULTIPLIER}!</p>
          <p className="sm-px-fever-timer">{(feverRemainingMs / 1000).toFixed(1)}s</p>
        </div>
      )}

      {/* Active Power-up */}
      {activePowerUp && (
        <div className="sm-px-powerup-bar">
          <p className="sm-px-powerup-label" style={{ color: POWER_UP_COLORS[activePowerUp.kind] }}>
            {POWER_UP_LABELS[activePowerUp.kind]}
          </p>
          <div className="sm-px-powerup-meter">
            <div
              className="sm-px-powerup-meter-fill"
              style={{
                width: `${(activePowerUp.remainingMs / POWER_UP_DURATION[activePowerUp.kind]) * 100}%`,
                background: POWER_UP_COLORS[activePowerUp.kind],
              }}
            />
          </div>
        </div>
      )}

      {/* Main Area */}
      <div className="sm-px-main">
        {showHint && <span className="sm-px-pattern-tag">{problem.patternLabel}</span>}

        <div className={`sm-px-seq-box ${problem.isBoss ? 'boss-box' : isFever ? 'fever-box' : isLowTime ? 'low-time-box' : ''}`}>
          {problem.displayed.map((num, index) => (
            <span key={`n-${index}`}>
              <span className={`sm-px-num-cell ${numberRevealIndex >= index ? 'on' : ''}`}>{num}</span>
              {index < problem.displayed.length - 1 && <span className="sm-px-sep">,</span>}
            </span>
          ))}
          <span className="sm-px-sep">,</span>
          <span className="sm-px-num-cell sm-px-mystery on">?</span>
        </div>

        {/* Stars */}
        <div className="sm-px-stars">
          {[0, 1, 2].map(i => (
            <span key={i} className={`sm-px-star ${i < pixelStars ? 'filled' : 'empty'}`} />
          ))}
        </div>

        {/* Hint */}
        <div className="sm-px-hint">
          <button
            className="sm-px-hint-btn"
            onClick={useHint}
            disabled={hintAvailableMs > 0 || showHint}
            type="button"
          >
            HINT -{HINT_PENALTY}PT
          </button>
          {hintAvailableMs > 0 && (
            <span className="sm-px-hint-cd">{Math.ceil(hintAvailableMs / 1000)}s</span>
          )}
        </div>
      </div>

      {/* Choices */}
      <div className="sm-px-choices">
        {problem.choices.map((choice, index) => {
          let fc = ''
          if (feedback !== null) {
            if (feedback.choiceIndex === index) {
              fc = feedback.kind === 'correct' ? 'correct-flash' : 'wrong-flash'
            } else if (feedback.kind === 'wrong' && choice === problem.answer) {
              fc = 'reveal-correct'
            }
          }
          const isHintX = showHint && !feedback && choice !== problem.answer && index === problem.choices.findIndex(c => c !== problem.answer)
          return (
            <button
              className={`sm-px-btn ${fc} ${isHintX ? 'hint-x' : ''}`}
              key={`c-${index}`}
              type="button"
              onClick={() => handleChoice(index)}
              disabled={lockedRef.current || isHintX}
            >
              {choice}
            </button>
          )
        })}
      </div>

      {/* Bottom */}
      <div className="sm-px-bottom">
        <button className="sm-px-exit" type="button" onClick={handleExit}>EXIT</button>
        {streak >= 3 && <span className="sm-px-streak">{streak} STREAK</span>}
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
