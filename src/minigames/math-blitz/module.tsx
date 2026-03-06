import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'

import correctSfx from '../../../assets/sounds/math-blitz-correct.mp3'
import wrongSfx from '../../../assets/sounds/math-blitz-wrong.mp3'
import comboSfx from '../../../assets/sounds/math-blitz-combo.mp3'
import feverSfx from '../../../assets/sounds/math-blitz-fever.mp3'
import timeWarningSfx from '../../../assets/sounds/math-blitz-time-warning.mp3'
import levelUpSfx from '../../../assets/sounds/math-blitz-level-up.mp3'
import fastBonusSfx from '../../../assets/sounds/math-blitz-fast-bonus.mp3'
import streakSfx from '../../../assets/sounds/math-blitz-streak.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 30000
const BASE_SCORE_CORRECT = 10
const PENALTY_WRONG = 5
const MAX_TIME_BONUS = 10
const TIME_BONUS_WINDOW_MS = 3000
const CORRECT_FLASH_DURATION_MS = 300
const WRONG_SHAKE_DURATION_MS = 400
const LOW_TIME_THRESHOLD_MS = 5000
const FAST_ANSWER_THRESHOLD_MS = 1500
const FAST_ANSWER_TIME_BONUS_MS = 500
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_PROBLEMS = 5
const FEVER_SCORE_MULTIPLIER = 3
const PERFECT_STREAK_MILESTONE = 15
const PERFECT_STREAK_BONUS = 50

// Time attack mode: every N correct answers speeds up the timer drain
const TIME_ATTACK_SPEED_INTERVAL = 10
const TIME_ATTACK_SPEED_BOOST = 0.15

// Number of choices increases with difficulty
const BASE_CHOICES = 4
const MAX_CHOICES = 6
const CHOICES_TIER_THRESHOLD = 3

const CHARACTERS = [
  parkSangminImage, kimYeonjaImage, parkWankyuImage,
  seoTaijiImage, songChangsikImage, taeJinaImage,
]

type Operator = '+' | '-' | 'x' | '÷'

interface MathProblem {
  readonly left: number
  readonly right: number
  readonly operator: Operator
  readonly answer: number
  readonly choices: readonly number[]
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

function toDifficultyTier(score: number): number {
  if (score < 30) return 0
  if (score < 80) return 1
  if (score < 150) return 2
  if (score < 250) return 3
  return 4
}

function pickOperator(tier: number): Operator {
  if (tier <= 0) return Math.random() < 0.5 ? '+' : '-'
  if (tier === 1) {
    const roll = Math.random()
    if (roll < 0.4) return '+'
    if (roll < 0.75) return '-'
    return 'x'
  }
  if (tier === 2) {
    const roll = Math.random()
    if (roll < 0.25) return '+'
    if (roll < 0.5) return '-'
    if (roll < 0.8) return 'x'
    return '÷'
  }
  const roll = Math.random()
  if (roll < 0.2) return '+'
  if (roll < 0.4) return '-'
  if (roll < 0.7) return 'x'
  return '÷'
}

function pickOperands(operator: Operator, tier: number): { left: number; right: number } {
  const ranges: [number, number][] = [
    [1, 10], [2, 20], [5, 50], [10, 99], [20, 150],
  ]
  const safeTier = clampNumber(tier, 0, ranges.length - 1)
  const [rangeMin, rangeMax] = ranges[safeTier]

  if (operator === 'x') {
    const multiplyRanges: [number, number][] = [
      [1, 9], [2, 9], [2, 12], [3, 15], [4, 20],
    ]
    const [mMin, mMax] = multiplyRanges[safeTier]
    const left = Math.floor(Math.random() * (mMax - mMin + 1)) + mMin
    const right = Math.floor(Math.random() * (mMax - mMin + 1)) + mMin
    return { left, right }
  }

  if (operator === '÷') {
    const divRanges: [number, number][] = [
      [1, 5], [2, 9], [2, 12], [3, 15], [4, 20],
    ]
    const [dMin, dMax] = divRanges[safeTier]
    const right = Math.floor(Math.random() * (dMax - dMin + 1)) + dMin
    const quotient = Math.floor(Math.random() * (dMax - dMin + 1)) + dMin
    return { left: right * quotient, right }
  }

  let left = Math.floor(Math.random() * (rangeMax - rangeMin + 1)) + rangeMin
  let right = Math.floor(Math.random() * (rangeMax - rangeMin + 1)) + rangeMin

  if (operator === '-' && left < right) {
    const temp = left
    left = right
    right = temp
  }

  return { left, right }
}

function computeAnswer(left: number, right: number, operator: Operator): number {
  if (operator === '+') return left + right
  if (operator === '-') return left - right
  if (operator === '÷') return Math.round(left / right)
  return left * right
}

function generateWrongChoices(answer: number, count: number): number[] {
  const wrongs = new Set<number>()
  const maxAttempts = count * 20
  for (let attempt = 0; attempt < maxAttempts && wrongs.size < count; attempt += 1) {
    const offsetMagnitude = Math.max(1, Math.floor(Math.abs(answer) * 0.3))
    const offset = Math.floor(Math.random() * offsetMagnitude * 2 + 1) - offsetMagnitude
    const candidate = answer + (offset === 0 ? (Math.random() < 0.5 ? 1 : -1) : offset)
    if (candidate !== answer && !wrongs.has(candidate)) {
      wrongs.add(candidate)
    }
  }
  while (wrongs.size < count) {
    const fallback = answer + (wrongs.size + 1) * (Math.random() < 0.5 ? 1 : -1)
    if (fallback !== answer && !wrongs.has(fallback)) {
      wrongs.add(fallback)
    }
  }
  return Array.from(wrongs)
}

function generateProblem(score: number): MathProblem {
  const tier = toDifficultyTier(score)
  const operator = pickOperator(tier)
  const { left, right } = pickOperands(operator, tier)
  const answer = computeAnswer(left, right, operator)
  const numChoices = tier >= CHOICES_TIER_THRESHOLD ? MAX_CHOICES : BASE_CHOICES
  const wrongChoices = generateWrongChoices(answer, numChoices - 1)
  const choices = shuffleArray([answer, ...wrongChoices])
  return { left, right, operator, answer, choices }
}

function toComboMultiplier(combo: number): number {
  if (combo < 3) return 1
  if (combo < 6) return 1.5
  if (combo < 10) return 2
  if (combo < 15) return 3
  return 4
}

const TIER_COLORS = ['#4ade80', '#60a5fa', '#f59e0b', '#ef4444', '#a855f7']
const TIER_LABELS = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER']
const TIER_BG = [
  'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)',
  'linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)',
  'linear-gradient(180deg, #fffbeb 0%, #fef3c7 100%)',
  'linear-gradient(180deg, #fef2f2 0%, #fecaca 100%)',
  'linear-gradient(180deg, #faf5ff 0%, #e9d5ff 100%)',
]

const MATH_BLITZ_CSS = `
.math-blitz-panel {
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 100%);
  font-family: 'Press Start 2P', monospace;
  user-select: none;
  touch-action: manipulation;
}

.mb-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px 8px;
  gap: 8px;
}

.mb-score-box {
  text-align: center;
}

.mb-score-value {
  font-size: clamp(1.4rem, 5vw, 2rem);
  font-weight: 900;
  color: #1f2937;
  text-shadow: 2px 2px 0 rgba(0,0,0,0.1);
  margin: 0;
  line-height: 1;
}

.mb-score-label {
  font-size: 0.5rem;
  color: #6b7280;
  margin: 2px 0 0;
}

.mb-best-badge {
  font-size: 0.45rem;
  color: #9ca3af;
  background: rgba(0,0,0,0.05);
  border-radius: 4px;
  padding: 2px 6px;
}

.mb-timer-bar {
  margin: 0 16px 6px;
  height: 10px;
  background: rgba(0,0,0,0.08);
  border-radius: 5px;
  overflow: hidden;
  border: 2px solid rgba(0,0,0,0.1);
  position: relative;
}

.mb-timer-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.1s linear, background 0.3s;
}

.mb-timer-text {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.4rem;
  font-weight: 800;
  color: #1f2937;
  text-shadow: 0 0 4px rgba(255,255,255,0.8);
}

.mb-info-strip {
  display: flex;
  justify-content: space-around;
  padding: 4px 16px 6px;
  font-size: 0.5rem;
  color: #4b5563;
}

.mb-info-item {
  text-align: center;
  margin: 0;
}

.mb-info-item strong {
  display: block;
  font-size: 0.7rem;
  color: #1f2937;
}

.mb-tier-badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 0.5rem;
  font-weight: 900;
  color: #fff;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.3);
  border: 2px solid rgba(0,0,0,0.15);
  margin: 0 auto;
}

.mb-fever-banner {
  text-align: center;
  font-size: 0.7rem;
  font-weight: 900;
  padding: 6px;
  margin: 0 16px;
  border-radius: 6px;
  animation: mb-fever-pulse 0.4s steps(2) infinite;
}

@keyframes mb-fever-pulse {
  0%, 100% { background: #fbbf24; color: #7c2d12; transform: scale(1); }
  50% { background: #f59e0b; color: #fff; transform: scale(1.02); }
}

.mb-problem-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  position: relative;
  min-height: 0;
}

.mb-character {
  width: clamp(100px, 28vw, 140px);
  height: clamp(100px, 28vw, 140px);
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 4px 0 rgba(0,0,0,0.2));
  transition: transform 0.15s, filter 0.15s;
}

.mb-character.correct-bounce {
  animation: mb-char-bounce 0.3s steps(3);
}

.mb-character.wrong-wobble {
  animation: mb-char-wobble 0.4s steps(4);
}

@keyframes mb-char-bounce {
  0% { transform: scale(1) translateY(0); }
  50% { transform: scale(1.15) translateY(-12px); }
  100% { transform: scale(1) translateY(0); }
}

@keyframes mb-char-wobble {
  0% { transform: rotate(0deg); filter: brightness(0.7) saturate(0.3); }
  25% { transform: rotate(-8deg); }
  50% { transform: rotate(8deg); }
  75% { transform: rotate(-4deg); }
  100% { transform: rotate(0deg); filter: none; }
}

.mb-operator-icon {
  font-size: clamp(1.8rem, 6vw, 2.4rem);
  font-weight: 900;
  margin: 8px 0;
  transition: color 0.2s, transform 0.2s;
}

.mb-operator-icon.op-plus { color: #22c55e; }
.mb-operator-icon.op-minus { color: #3b82f6; }
.mb-operator-icon.op-multiply { color: #f59e0b; }
.mb-operator-icon.op-divide { color: #ef4444; }

.mb-problem-text {
  font-size: clamp(2rem, 7vw, 3rem);
  font-weight: 900;
  color: #1f2937;
  text-shadow: 3px 3px 0 rgba(0,0,0,0.08);
  margin: 0;
  text-align: center;
  letter-spacing: 2px;
  line-height: 1.2;
}

.mb-problem-text.low-time {
  animation: mb-problem-urgent 0.5s steps(2) infinite;
}

@keyframes mb-problem-urgent {
  0%, 100% { color: #1f2937; }
  50% { color: #ef4444; }
}

.mb-choices-grid {
  display: grid;
  gap: 8px;
  padding: 12px 16px 16px;
}

.mb-choices-grid.cols-4 {
  grid-template-columns: 1fr 1fr;
}

.mb-choices-grid.cols-6 {
  grid-template-columns: 1fr 1fr 1fr;
}

.mb-choice-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: clamp(56px, 12vw, 72px);
  border: 3px solid #6b7280;
  border-radius: 8px;
  background: linear-gradient(180deg, #fbfaf6 0%, #f0eeea 100%);
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(1rem, 4vw, 1.4rem);
  font-weight: 900;
  color: #1f2937;
  cursor: pointer;
  box-shadow: 0 3px 0 #9ca3af;
  transition: transform 0.08s, box-shadow 0.08s;
  padding: 8px;
}

.mb-choice-btn:active {
  transform: translateY(2px);
  box-shadow: 0 1px 0 #9ca3af;
}

.mb-choice-btn.correct-flash {
  background: linear-gradient(180deg, #bbf7d0 0%, #86efac 100%) !important;
  border-color: #22c55e !important;
  animation: mb-correct-pop 0.3s steps(3);
  color: #166534;
}

.mb-choice-btn.wrong-shake {
  background: linear-gradient(180deg, #fecaca 0%, #fca5a5 100%) !important;
  border-color: #ef4444 !important;
  animation: mb-wrong-shake 0.4s steps(4);
  color: #991b1b;
}

@keyframes mb-correct-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.08); }
  100% { transform: scale(1); }
}

@keyframes mb-wrong-shake {
  0% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  50% { transform: translateX(6px); }
  75% { transform: translateX(-3px); }
  100% { transform: translateX(0); }
}

.mb-exit-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 36px;
  height: 36px;
  border: 2px solid #9ca3af;
  border-radius: 6px;
  background: rgba(255,255,255,0.7);
  font-family: 'Press Start 2P', monospace;
  font-size: 0.6rem;
  color: #6b7280;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.mb-combo-burst {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: clamp(1.2rem, 4vw, 1.6rem);
  font-weight: 900;
  pointer-events: none;
  animation: mb-combo-fly 0.6s steps(6) forwards;
  text-shadow: 2px 2px 0 rgba(0,0,0,0.2);
  z-index: 20;
}

@keyframes mb-combo-fly {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
  30% { opacity: 1; transform: translate(-50%, -80%) scale(1.3); }
  100% { opacity: 0; transform: translate(-50%, -120%) scale(0.8); }
}

.mb-fast-bonus-indicator {
  position: absolute;
  top: 30%;
  right: 16px;
  font-size: 0.6rem;
  font-weight: 900;
  color: #10b981;
  animation: mb-fast-fly 0.8s steps(4) forwards;
  pointer-events: none;
}

@keyframes mb-fast-fly {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-30px); }
}

.mb-streak-indicator {
  position: absolute;
  top: 40%;
  left: 50%;
  font-size: 0.7rem;
  font-weight: 900;
  color: #a855f7;
  animation: mb-streak-pop 1s steps(5) forwards;
  pointer-events: none;
  text-align: center;
  white-space: nowrap;
}

@keyframes mb-streak-pop {
  0% { opacity: 0; transform: translate(-50%, 0) scale(0.3); }
  20% { opacity: 1; transform: translate(-50%, -10px) scale(1.2); }
  80% { opacity: 1; transform: translate(-50%, -20px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -40px) scale(0.8); }
}

.mb-level-up-flash {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 15;
  animation: mb-level-flash 0.6s steps(3) forwards;
}

@keyframes mb-level-flash {
  0% { background: rgba(255,255,255,0); }
  30% { background: rgba(255,255,255,0.6); }
  100% { background: rgba(255,255,255,0); }
}

.mb-time-pulse {
  animation: mb-time-pulse-anim 1s steps(2) infinite;
}

@keyframes mb-time-pulse-anim {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
`

function MathBlitzGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [solvedCount, setSolvedCount] = useState(0)
  const [problem, setProblem] = useState<MathProblem>(() => generateProblem(0))
  const [correctFlashIndex, setCorrectFlashIndex] = useState<number | null>(null)
  const [wrongShakeIndex, setWrongShakeIndex] = useState<number | null>(null)
  const [isFever, setIsFever] = useState(false)
  const [feverProblemsLeft, setFeverProblemsLeft] = useState(0)
  const [charImage, setCharImage] = useState(() => CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)])
  const [charAnim, setCharAnim] = useState<'idle' | 'correct' | 'wrong'>('idle')
  const [comboBurstText, setComboBurstText] = useState<string | null>(null)
  const [comboBurstKey, setComboBurstKey] = useState(0)
  const [showFastBonus, setShowFastBonus] = useState(false)
  const [fastBonusKey, setFastBonusKey] = useState(0)
  const [showStreak, setShowStreak] = useState(false)
  const [streakKey, setStreakKey] = useState(0)
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [levelUpKey, setLevelUpKey] = useState(0)
  const [timeSpeed, setTimeSpeed] = useState(1)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const solvedCountRef = useRef(0)
  const problemRef = useRef(problem)
  const problemStartMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const correctFlashTimerRef = useRef<number | null>(null)
  const wrongShakeTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)
  const isFeverRef = useRef(false)
  const feverProblemsLeftRef = useRef(0)
  const lastPerfectStreakRef = useRef(0)
  const lastTierRef = useRef(0)
  const timeSpeedRef = useRef(1)

  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  const getAudio = useCallback((src: string): HTMLAudioElement => {
    let audio = audioPoolRef.current.get(src)
    if (!audio) {
      audio = new Audio(src)
      audio.preload = 'auto'
      audioPoolRef.current.set(src, audio)
    }
    return audio
  }, [])

  const playAudio = useCallback((src: string, volume: number, playbackRate = 1) => {
    const audio = getAudio(src)
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [getAudio])

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const advanceProblem = useCallback((nextScore: number) => {
    const nextProblem = generateProblem(nextScore)
    problemRef.current = nextProblem
    setProblem(nextProblem)
    problemStartMsRef.current = window.performance.now()

    // Change character on new tier
    const newTier = toDifficultyTier(nextScore)
    if (newTier !== lastTierRef.current) {
      lastTierRef.current = newTier
      setCharImage(CHARACTERS[newTier % CHARACTERS.length])
      setShowLevelUp(true)
      setLevelUpKey(k => k + 1)
      playAudio(levelUpSfx, 0.5)
      setTimeout(() => setShowLevelUp(false), 600)
    }
  }, [playAudio])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(correctFlashTimerRef)
    clearTimeoutSafe(wrongShakeTimerRef)
    effects.cleanup()
    playAudio(gameOverHitSfx, 0.6, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, effects, playAudio])

  const handleChoiceTap = useCallback(
    (choiceValue: number, choiceIndex: number) => {
      if (finishedRef.current) return

      const currentProblem = problemRef.current
      const now = window.performance.now()

      if (choiceValue === currentProblem.answer) {
        const reactionMs = now - problemStartMsRef.current
        const timeBonus = reactionMs < TIME_BONUS_WINDOW_MS
          ? Math.round(MAX_TIME_BONUS * (1 - reactionMs / TIME_BONUS_WINDOW_MS))
          : 0

        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        // Character animation
        setCharAnim('correct')
        setTimeout(() => setCharAnim('idle'), 300)

        // Fever mode management
        if (isFeverRef.current) {
          feverProblemsLeftRef.current -= 1
          if (feverProblemsLeftRef.current <= 0) {
            isFeverRef.current = false
            setIsFever(false)
            setFeverProblemsLeft(0)
          } else {
            setFeverProblemsLeft(feverProblemsLeftRef.current)
          }
        } else if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverProblemsLeftRef.current = FEVER_DURATION_PROBLEMS
          setIsFever(true)
          setFeverProblemsLeft(FEVER_DURATION_PROBLEMS)
          effects.triggerFlash('rgba(251,191,36,0.5)', 150)
          playAudio(feverSfx, 0.6)
        }

        const feverMult = isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1
        const multiplier = toComboMultiplier(nextCombo) * feverMult
        const earned = Math.round((BASE_SCORE_CORRECT + timeBonus) * multiplier)
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        // Fast answer time bonus
        if (reactionMs < FAST_ANSWER_THRESHOLD_MS) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FAST_ANSWER_TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
          setShowFastBonus(true)
          setFastBonusKey(k => k + 1)
          playAudio(fastBonusSfx, 0.35)
          setTimeout(() => setShowFastBonus(false), 800)
        }

        // Perfect streak milestone bonus
        const streakMilestone = Math.floor(nextCombo / PERFECT_STREAK_MILESTONE)
        if (streakMilestone > lastPerfectStreakRef.current) {
          lastPerfectStreakRef.current = streakMilestone
          scoreRef.current += PERFECT_STREAK_BONUS
          setScore(scoreRef.current)
          effects.showScorePopup(PERFECT_STREAK_BONUS, 200, 200, '#a855f7')
          setShowStreak(true)
          setStreakKey(k => k + 1)
          playAudio(streakSfx, 0.5)
          setTimeout(() => setShowStreak(false), 1000)
        }

        // Time attack speed-up
        const nextSolved = solvedCountRef.current + 1
        solvedCountRef.current = nextSolved
        setSolvedCount(nextSolved)
        if (nextSolved > 0 && nextSolved % TIME_ATTACK_SPEED_INTERVAL === 0) {
          const newSpeed = timeSpeedRef.current + TIME_ATTACK_SPEED_BOOST
          timeSpeedRef.current = newSpeed
          setTimeSpeed(newSpeed)
        }

        // Visual feedback
        setCorrectFlashIndex(choiceIndex)
        clearTimeoutSafe(correctFlashTimerRef)
        correctFlashTimerRef.current = window.setTimeout(() => {
          correctFlashTimerRef.current = null
          setCorrectFlashIndex(null)
        }, CORRECT_FLASH_DURATION_MS)

        // Combo burst text
        if (nextCombo >= 3) {
          const label = getComboLabel(nextCombo)
          if (label) {
            setComboBurstText(`${label} +${earned}`)
            setComboBurstKey(k => k + 1)
            setTimeout(() => setComboBurstText(null), 600)
          }
          playAudio(comboSfx, 0.4, 1 + Math.min(0.4, nextCombo * 0.025))
        } else {
          playAudio(correctSfx, 0.5, 1 + Math.min(0.3, nextCombo * 0.02))
        }

        // Particle effects
        effects.comboHitBurst(200, 300, nextCombo, earned)

        advanceProblem(nextScore)
      } else {
        const nextScore = Math.max(0, scoreRef.current - PENALTY_WRONG)
        scoreRef.current = nextScore
        setScore(nextScore)
        comboRef.current = 0
        setCombo(0)
        isFeverRef.current = false
        feverProblemsLeftRef.current = 0
        setIsFever(false)
        setFeverProblemsLeft(0)
        lastPerfectStreakRef.current = 0

        setCharAnim('wrong')
        setTimeout(() => setCharAnim('idle'), 400)

        setWrongShakeIndex(choiceIndex)
        clearTimeoutSafe(wrongShakeTimerRef)
        wrongShakeTimerRef.current = window.setTimeout(() => {
          wrongShakeTimerRef.current = null
          setWrongShakeIndex(null)
        }, WRONG_SHAKE_DURATION_MS)

        playAudio(wrongSfx, 0.5, 0.9)
        effects.triggerShake(5)
        effects.triggerFlash('rgba(239,68,68,0.3)')
      }
    },
    [advanceProblem, playAudio, effects],
  )

  const handleExit = useCallback(() => {
    playAudio(wrongSfx, 0.3, 1)
    onExit()
  }, [onExit, playAudio])

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

  useEffect(() => {
    // Preload all sounds
    ;[correctSfx, wrongSfx, comboSfx, feverSfx, timeWarningSfx, levelUpSfx, fastBonusSfx, streakSfx, gameOverHitSfx].forEach(src => getAudio(src))

    return () => {
      clearTimeoutSafe(correctFlashTimerRef)
      clearTimeoutSafe(wrongShakeTimerRef)
      effects.cleanup()
      audioPoolRef.current.clear()
    }
  }, [])

  useEffect(() => {
    problemStartMsRef.current = window.performance.now()

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

      // Time attack: timer drains faster as you solve more
      const scaledDelta = deltaMs * timeSpeedRef.current
      remainingMsRef.current = Math.max(0, remainingMsRef.current - scaledDelta)
      setRemainingMs(remainingMsRef.current)

      effects.updateParticles()

      // Low time warning sound
      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(timeWarningSfx, 0.25, 1.2 - nextLowTimeSecond * 0.03)
        }
      } else {
        lowTimeSecondRef.current = null
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
  }, [finishGame, playAudio, effects])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboMultiplier = toComboMultiplier(combo)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const tier = toDifficultyTier(score)
  const tierLabel = TIER_LABELS[clampNumber(tier, 0, TIER_LABELS.length - 1)]
  const tierColor = TIER_COLORS[clampNumber(tier, 0, TIER_COLORS.length - 1)]
  const tierBg = TIER_BG[clampNumber(tier, 0, TIER_BG.length - 1)]
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const timerPercent = (remainingMs / ROUND_DURATION_MS) * 100
  const timerColor = isLowTime ? '#ef4444' : isFever ? '#f59e0b' : '#4ade80'
  const operatorClass = problem.operator === '+' ? 'op-plus' : problem.operator === '-' ? 'op-minus' : problem.operator === 'x' ? 'op-multiply' : 'op-divide'
  const choicesGridClass = problem.choices.length > 4 ? 'cols-6' : 'cols-4'

  return (
    <section
      className="mini-game-panel math-blitz-panel"
      aria-label="math-blitz-game"
      style={{
        maxWidth: '432px',
        margin: '0 auto',
        overflow: 'hidden',
        position: 'relative',
        height: '100%',
        background: tierBg,
        ...effects.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}{MATH_BLITZ_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {showLevelUp && <div className="mb-level-up-flash" key={levelUpKey} />}

      <button className="mb-exit-btn" type="button" onClick={handleExit}>X</button>

      {/* Header: Score + Best */}
      <div className="mb-header">
        <div className="mb-score-box">
          <p className="mb-score-value">{score.toLocaleString()}</p>
          <p className="mb-score-label">SCORE</p>
        </div>
        <span className="mb-tier-badge" style={{ background: tierColor }}>{tierLabel}</span>
        <p className="mb-best-badge">BEST {displayedBestScore.toLocaleString()}</p>
      </div>

      {/* Timer Bar */}
      <div className={`mb-timer-bar ${isLowTime ? 'mb-time-pulse' : ''}`}>
        <div className="mb-timer-fill" style={{ width: `${timerPercent}%`, background: timerColor }} />
        <span className="mb-timer-text" style={{ color: isLowTime ? '#ef4444' : '#4b5563' }}>
          {(remainingMs / 1000).toFixed(1)}s
          {timeSpeed > 1 && ` x${timeSpeed.toFixed(1)}`}
        </span>
      </div>

      {/* Info Strip */}
      <div className="mb-info-strip">
        <p className="mb-info-item">COMBO<strong style={{ color: comboColor }}>{combo}</strong></p>
        <p className="mb-info-item">x<strong>{comboMultiplier}</strong></p>
        <p className="mb-info-item">SOLVED<strong>{solvedCount}</strong></p>
      </div>

      {/* Fever Banner */}
      {isFever && (
        <div className="mb-fever-banner">
          FEVER x{FEVER_SCORE_MULTIPLIER}! ({feverProblemsLeft} left)
        </div>
      )}

      {/* Combo Label */}
      {comboLabel && (
        <p style={{ textAlign: 'center', fontSize: 'clamp(0.7rem, 3vw, 1rem)', fontWeight: 900, color: comboColor, margin: '2px 0', fontFamily: "'Press Start 2P', monospace" }}>
          {comboLabel}
        </p>
      )}

      {/* Problem Area */}
      <div className="mb-problem-area">
        {/* Combo Burst */}
        {comboBurstText && (
          <span className="mb-combo-burst" key={comboBurstKey} style={{ color: comboColor }}>
            {comboBurstText}
          </span>
        )}

        {/* Fast Bonus Indicator */}
        {showFastBonus && (
          <span className="mb-fast-bonus-indicator" key={fastBonusKey}>+TIME!</span>
        )}

        {/* Streak Indicator */}
        {showStreak && (
          <span className="mb-streak-indicator" key={streakKey}>STREAK +{PERFECT_STREAK_BONUS}!</span>
        )}

        <img
          src={charImage}
          alt="character"
          className={`mb-character ${charAnim === 'correct' ? 'correct-bounce' : charAnim === 'wrong' ? 'wrong-wobble' : ''}`}
        />

        <span className={`mb-operator-icon ${operatorClass}`}>
          {problem.operator}
        </span>

        <p className={`mb-problem-text ${isLowTime ? 'low-time' : ''}`}>
          {problem.left} {problem.operator} {problem.right} = ?
        </p>
      </div>

      {/* Choices Grid */}
      <div className={`mb-choices-grid ${choicesGridClass}`}>
        {problem.choices.map((choice, index) => {
          const isCorrectFlash = correctFlashIndex === index
          const isWrongShake = wrongShakeIndex === index
          let choiceClass = 'mb-choice-btn'
          if (isCorrectFlash) choiceClass += ' correct-flash'
          if (isWrongShake) choiceClass += ' wrong-shake'
          if (isFever) choiceClass += ' fever-btn'

          return (
            <button
              className={choiceClass}
              key={`choice-${index}-${choice}`}
              type="button"
              onClick={() => handleChoiceTap(choice, index)}
              style={isFever ? { borderColor: '#f59e0b', boxShadow: '0 3px 0 #d97706, 0 0 8px rgba(245,158,11,0.3)' } : undefined}
            >
              {choice}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export const mathBlitzModule: MiniGameModule = {
  manifest: {
    id: 'math-blitz',
    title: 'Math Blitz',
    description: 'Solve math problems fast! Speed = high score!',
    unlockCost: 25,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#6366f1',
  },
  Component: MathBlitzGame,
}
