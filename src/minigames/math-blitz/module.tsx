import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 30000
const BASE_SCORE_CORRECT = 10
const PENALTY_WRONG = 5
const MAX_TIME_BONUS = 10
const TIME_BONUS_WINDOW_MS = 3000
const CORRECT_FLASH_DURATION_MS = 300
const WRONG_SHAKE_DURATION_MS = 400
const LOW_TIME_THRESHOLD_MS = 5000

// Fast answer time bonus: adds time to the clock
const FAST_ANSWER_THRESHOLD_MS = 1500
const FAST_ANSWER_TIME_BONUS_MS = 500

// Fever mode: after N consecutive correct, all scores x3 for M problems
const FEVER_COMBO_THRESHOLD = 8
const FEVER_DURATION_PROBLEMS = 5
const FEVER_SCORE_MULTIPLIER = 3

// Perfect streak bonus: extra points for long combos
const PERFECT_STREAK_MILESTONE = 15
const PERFECT_STREAK_BONUS = 50

type Operator = '+' | '-' | 'x'

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
  const roll = Math.random()
  if (roll < 0.3) return '+'
  if (roll < 0.6) return '-'
  return 'x'
}

function pickOperands(operator: Operator, tier: number): { left: number; right: number } {
  const ranges: [number, number][] = [
    [1, 10],
    [2, 20],
    [5, 50],
    [10, 99],
    [20, 150],
  ]
  const safeTier = clampNumber(tier, 0, ranges.length - 1)
  const [rangeMin, rangeMax] = ranges[safeTier]

  if (operator === 'x') {
    const multiplyRanges: [number, number][] = [
      [1, 9],
      [2, 9],
      [2, 12],
      [3, 15],
      [4, 20],
    ]
    const [mMin, mMax] = multiplyRanges[safeTier]
    const left = Math.floor(Math.random() * (mMax - mMin + 1)) + mMin
    const right = Math.floor(Math.random() * (mMax - mMin + 1)) + mMin
    return { left, right }
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
  const wrongChoices = generateWrongChoices(answer, 3)
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

function MathBlitzGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [solvedCount, setSolvedCount] = useState(0)
  const [problem, setProblem] = useState<MathProblem>(() => generateProblem(0))
  const [problemStartMs, setProblemStartMs] = useState(0)
  const [correctFlashIndex, setCorrectFlashIndex] = useState<number | null>(null)
  const [wrongShakeIndex, setWrongShakeIndex] = useState<number | null>(null)
  const [isFever, setIsFever] = useState(false)
  const [feverProblemsLeft, setFeverProblemsLeft] = useState(0)

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

  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
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

  const advanceProblem = useCallback((nextScore: number) => {
    const nextProblem = generateProblem(nextScore)
    problemRef.current = nextProblem
    setProblem(nextProblem)
    problemStartMsRef.current = window.performance.now()
    setProblemStartMs(window.performance.now())
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(correctFlashTimerRef)
    clearTimeoutSafe(wrongShakeTimerRef)
    effects.cleanup()

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

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
          effects.triggerFlash('rgba(251,191,36,0.4)', 100)
        }

        const feverMult = isFeverRef.current ? FEVER_SCORE_MULTIPLIER : 1
        const multiplier = toComboMultiplier(nextCombo) * feverMult
        const earned = Math.round((BASE_SCORE_CORRECT + timeBonus) * multiplier)
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        // Fast answer time bonus: add time to clock
        if (reactionMs < FAST_ANSWER_THRESHOLD_MS) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FAST_ANSWER_TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
        }

        // Perfect streak milestone bonus
        const streakMilestone = Math.floor(nextCombo / PERFECT_STREAK_MILESTONE)
        if (streakMilestone > lastPerfectStreakRef.current) {
          lastPerfectStreakRef.current = streakMilestone
          scoreRef.current += PERFECT_STREAK_BONUS
          setScore(scoreRef.current)
          effects.showScorePopup(PERFECT_STREAK_BONUS, 200, 200, '#a855f7')
        }

        const nextSolved = solvedCountRef.current + 1
        solvedCountRef.current = nextSolved
        setSolvedCount(nextSolved)

        setCorrectFlashIndex(choiceIndex)
        clearTimeoutSafe(correctFlashTimerRef)
        correctFlashTimerRef.current = window.setTimeout(() => {
          correctFlashTimerRef.current = null
          setCorrectFlashIndex(null)
        }, CORRECT_FLASH_DURATION_MS)

        const pitchBoost = 1 + Math.min(0.3, nextCombo * 0.02)
        playAudio(correctAudioRef, 0.5, isFeverRef.current ? pitchBoost + 0.2 : pitchBoost)

        // Correct answer effects
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

        setWrongShakeIndex(choiceIndex)
        clearTimeoutSafe(wrongShakeTimerRef)
        wrongShakeTimerRef.current = window.setTimeout(() => {
          wrongShakeTimerRef.current = null
          setWrongShakeIndex(null)
        }, WRONG_SHAKE_DURATION_MS)

        playAudio(wrongAudioRef, 0.5, 0.9)

        // Wrong answer effects
        effects.triggerShake(5)
        effects.triggerFlash('rgba(239,68,68,0.3)')
      }
    },
    [advanceProblem, playAudio],
  )

  const handleExit = useCallback(() => {
    playAudio(wrongAudioRef, 0.3, 1)
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
    const correctAudio = new Audio(tapHitStrongSfx)
    correctAudio.preload = 'auto'
    correctAudioRef.current = correctAudio

    const wrongAudio = new Audio(tapHitSfx)
    wrongAudio.preload = 'auto'
    wrongAudioRef.current = wrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      clearTimeoutSafe(correctFlashTimerRef)
      clearTimeoutSafe(wrongShakeTimerRef)
      effects.cleanup()
      correctAudioRef.current = null
      wrongAudioRef.current = null
      gameOverAudioRef.current = null
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

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      effects.updateParticles()

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
        }
      } else {
        lowTimeSecondRef.current = null
      }

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
  }, [finishGame, playAudio])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboMultiplier = toComboMultiplier(combo)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const tier = toDifficultyTier(score)
  const tierLabels = ['Easy', 'Normal', 'Hard', 'Expert', 'Master']
  const tierLabel = tierLabels[clampNumber(tier, 0, tierLabels.length - 1)]

  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  return (
    <section className="mini-game-panel math-blitz-panel" aria-label="math-blitz-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="math-blitz-score-strip">
        <p className="math-blitz-score">{score.toLocaleString()}</p>
        <p className="math-blitz-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`math-blitz-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="math-blitz-meta-row">
        <p className="math-blitz-combo">
          COMBO <strong>{combo}</strong>
        </p>
        <p className="math-blitz-multiplier">
          x<strong>{comboMultiplier}</strong>
        </p>
        <p className="math-blitz-solved">
          Solved <strong>{solvedCount}</strong>
        </p>
        <p className="math-blitz-tier">
          <strong>{tierLabel}</strong>
        </p>
      </div>

      {isFever && (
        <p style={{ textAlign: 'center', fontSize: '16px', fontWeight: 800, color: '#f59e0b', margin: '2px 0' }}>
          FEVER x{FEVER_SCORE_MULTIPLIER}! ({feverProblemsLeft} left)
        </p>
      )}

      {comboLabel && (
        <p className="ge-combo-label" style={{ textAlign: 'center', fontSize: '18px', color: comboColor, margin: '2px 0' }}>
          {comboLabel}
        </p>
      )}

      <div className={`math-blitz-problem-area ${isLowTime ? 'low-time' : ''} ${isFever ? 'fever-glow' : ''}`}>
        <img
          src={parkSangminImage}
          alt="park-sangmin"
          style={{
            width: '64px',
            height: '64px',
            objectFit: 'contain',
            marginBottom: '8px',
            opacity: 0.85,
            filter: correctFlashIndex !== null ? 'brightness(1.2)' : wrongShakeIndex !== null ? 'grayscale(0.5)' : 'none',
            transition: 'filter 0.2s ease',
          }}
        />
        <p className="math-blitz-problem-text">
          {problem.left} {problem.operator} {problem.right} = ?
        </p>
      </div>

      <div className="math-blitz-choices-grid">
        {problem.choices.map((choice, index) => {
          const isCorrectFlash = correctFlashIndex === index
          const isWrongShake = wrongShakeIndex === index
          let choiceClass = 'math-blitz-choice-button'
          if (isCorrectFlash) choiceClass += ' correct-flash'
          if (isWrongShake) choiceClass += ' wrong-shake'

          return (
            <button
              className={choiceClass}
              key={`choice-${index}-${choice}`}
              type="button"
              onClick={() => handleChoiceTap(choice, index)}
            >
              {choice}
            </button>
          )
        })}
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const mathBlitzModule: MiniGameModule = {
  manifest: {
    id: 'math-blitz',
    title: 'Math Blitz',
    description: '수학 문제를 번개처럼 풀어라! 빠를수록 고득점!',
    unlockCost: 25,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#6366f1',
  },
  Component: MathBlitzGame,
}
