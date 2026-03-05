import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 5000
const CORRECT_SCORE = 10
const WRONG_PENALTY = 3
const FEEDBACK_DURATION_MS = 600
const COMBO_KEEP_WINDOW_MS = 4000
const SPEED_BONUS_THRESHOLD_MS = 3000
const SPEED_BONUS_POINTS = 5
const FEVER_COMBO_THRESHOLD = 5
const FEVER_DURATION_MS = 10000
const FEVER_MULTIPLIER = 2
const TIME_BONUS_PER_CORRECT_MS = 500

const DIFFICULTY_THRESHOLDS = [0, 30, 60, 100, 160] as const

type PatternKind = 'arithmetic' | 'geometric' | 'fibonacci' | 'squares' | 'cubes' | 'triangular' | 'primes'

interface SequenceProblem {
  readonly displayed: number[]
  readonly answer: number
  readonly choices: number[]
  readonly patternLabel: string
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
  for (let i = 0; i < length; i++) {
    seq.push(start + sign * diff * i)
  }
  return seq
}

function generateGeometric(length: number, difficulty: number): number[] {
  const ratio = difficulty <= 2 ? randomInt(2, 3) : randomInt(2, 4)
  const start = randomInt(1, 5)
  const seq: number[] = []
  for (let i = 0; i < length; i++) {
    seq.push(start * Math.pow(ratio, i))
  }
  return seq
}

function generateFibonacci(length: number): number[] {
  const a = randomInt(1, 5)
  const b = randomInt(1, 5)
  const seq = [a, b]
  for (let i = 2; i < length; i++) {
    seq.push(seq[i - 1] + seq[i - 2])
  }
  return seq
}

function generateSquares(length: number): number[] {
  const start = randomInt(1, 6)
  const seq: number[] = []
  for (let i = 0; i < length; i++) {
    seq.push((start + i) * (start + i))
  }
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
      if (candidate % d === 0) {
        isPrime = false
        break
      }
    }
    if (isPrime) primes.push(candidate)
    candidate++
  }
  return primes[n - 1]
}

function generatePrimes(length: number): number[] {
  const startIndex = randomInt(1, 6)
  const seq: number[] = []
  for (let i = 0; i < length; i++) {
    seq.push(getNthPrime(startIndex + i))
  }
  return seq
}

function generateSequence(pattern: PatternKind, length: number, difficulty: number): number[] {
  switch (pattern) {
    case 'arithmetic':
      return generateArithmetic(length, difficulty)
    case 'geometric':
      return generateGeometric(length, difficulty)
    case 'fibonacci':
      return generateFibonacci(length)
    case 'squares':
      return generateSquares(length)
    case 'cubes':
      return generateCubes(length)
    case 'triangular':
      return generateTriangular(length)
    case 'primes':
      return generatePrimes(length)
  }
}

function patternToLabel(pattern: PatternKind): string {
  switch (pattern) {
    case 'arithmetic':
      return '등차'
    case 'geometric':
      return '등비'
    case 'fibonacci':
      return '피보나치'
    case 'squares':
      return '제곱수'
    case 'cubes':
      return '세제곱'
    case 'triangular':
      return '삼각수'
    case 'primes':
      return '소수'
  }
}

function generateDistractors(answer: number, count: number): number[] {
  const distractors = new Set<number>()
  const offsets = [1, 2, 3, 5, 7, 10, -1, -2, -3, -5]
  const shuffledOffsets = shuffle(offsets)
  for (const offset of shuffledOffsets) {
    if (distractors.size >= count) break
    const candidate = answer + offset
    if (candidate !== answer && !distractors.has(candidate)) {
      distractors.add(candidate)
    }
  }
  while (distractors.size < count) {
    const candidate = answer + randomInt(-15, 15)
    if (candidate !== answer && !distractors.has(candidate)) {
      distractors.add(candidate)
    }
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
  return { displayed, answer, choices, patternLabel: patternToLabel(pattern) }
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

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
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

  const advanceProblem = useCallback((currentScore: number) => {
    const next = createProblem(currentScore)
    setProblem(next)
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

        // Speed bonus for fast answers
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

        // Time bonus for each correct answer
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CORRECT_MS)
        setRemainingMs(remainingMsRef.current)

        // Activate fever mode
        if (nextCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
        }

        setFeedback({ choiceIndex, kind: 'correct' })
        playAudio(tapHitStrongAudioRef, 0.6, 1 + Math.min(0.3, nextCombo * 0.02))

        // Visual effects for correct answer
        effects.comboHitBurst(200, 300, nextCombo, earned)
      } else {
        const nextScore = Math.max(0, scoreRef.current - WRONG_PENALTY)
        scoreRef.current = nextScore
        setScore(nextScore)

        comboRef.current = 0
        setCombo(0)

        // End fever on wrong answer
        if (feverRef.current) {
          feverRef.current = false
          feverRemainingMsRef.current = 0
          setIsFever(false)
          setFeverRemainingMs(0)
        }

        setFeedback({ choiceIndex, kind: 'wrong' })
        playAudio(tapHitAudioRef, 0.5, 0.8)

        // Visual effects for wrong answer
        effects.triggerShake(5)
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

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

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
    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    lastAnswerAtRef.current = window.performance.now()

    return () => {
      clearTimeoutSafe(feedbackTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
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

      // Fever timer countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
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
  }, [finishGame, playAudio])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const difficulty = getDifficulty(score)
  const difficultyLabels = ['Easy', 'Normal', 'Hard', 'Expert', 'Master']
  const difficultyLabel = difficultyLabels[difficulty] ?? 'Master'
  const timeSeconds = (remainingMs / 1000).toFixed(1)
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  return (
    <section className="mini-game-panel sequence-master-panel" aria-label="sequence-master-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .sequence-master-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1e3a5f 0%, #1e40af 30%, #1e293b 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
        }

        .sequence-master-header {
          background: linear-gradient(135deg, #2563eb, #1d4ed8);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .sequence-master-header-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.4);
          object-fit: contain;
          background: rgba(255,255,255,0.1);
          flex-shrink: 0;
        }

        .sequence-master-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .sequence-master-header-score-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .sequence-master-score-strip {
          display: none;
        }

        .sequence-master-score {
          font-size: 26px;
          font-weight: 800;
          color: #fff;
          margin: 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          letter-spacing: -1px;
        }

        .sequence-master-best {
          font-size: 10px;
          color: rgba(255,255,255,0.6);
          margin: 0;
          font-weight: 600;
        }

        .sequence-master-time {
          font-size: 18px;
          font-weight: 700;
          color: rgba(255,255,255,0.9);
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s;
        }

        .sequence-master-time.low-time {
          color: #fca5a5;
          animation: sequence-master-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes sequence-master-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .sequence-master-meta-row {
          display: flex;
          justify-content: space-between;
          padding: 8px 16px;
        }

        .sequence-master-meta-row p {
          font-size: 13px;
          color: rgba(255,255,255,0.6);
          margin: 0;
        }

        .sequence-master-meta-row strong {
          color: #fff;
          font-weight: 700;
        }

        .sequence-master-sequence-display {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 12px;
          background: rgba(37,99,235,0.12);
          border: 2px solid rgba(37,99,235,0.3);
          border-radius: 16px;
          padding: 20px 16px;
          transition: border-color 0.3s, background 0.3s;
        }

        .sequence-master-sequence-display.low-time {
          border-color: rgba(239,68,68,0.4);
          background: rgba(239,68,68,0.1);
        }

        .sequence-master-sequence-row {
          display: flex;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
          gap: 4px;
        }

        .sequence-master-num {
          font-size: 28px;
          font-weight: 700;
          color: #93c5fd;
          padding: 4px 6px;
          font-variant-numeric: tabular-nums;
        }

        .sequence-master-separator {
          color: rgba(147,197,253,0.4);
          margin-right: 2px;
        }

        .sequence-master-unknown {
          font-size: 34px;
          font-weight: 800;
          color: #60a5fa;
          background: rgba(37,99,235,0.2);
          border: 2px dashed rgba(147,197,253,0.5);
          border-radius: 10px;
          padding: 2px 14px;
          margin-left: 4px;
          animation: sequence-master-bounce 1s ease-in-out infinite alternate;
        }

        @keyframes sequence-master-bounce {
          from { transform: translateY(0); }
          to { transform: translateY(-4px); }
        }

        .sequence-master-choices {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 12px 12px 8px;
        }

        .sequence-master-choice {
          font-size: 22px;
          font-weight: 700;
          padding: 18px 8px;
          border-radius: 14px;
          border: 2px solid rgba(37,99,235,0.35);
          background: linear-gradient(180deg, rgba(37,99,235,0.2) 0%, rgba(37,99,235,0.1) 100%);
          color: #e0e7ff;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
          font-variant-numeric: tabular-nums;
          box-shadow: 0 3px 8px rgba(0,0,0,0.2);
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
        }

        .sequence-master-choice:active:not(:disabled) {
          transform: scale(0.95);
          background: rgba(37,99,235,0.3);
        }

        .sequence-master-choice:disabled {
          cursor: default;
        }

        .sequence-master-choice.correct-flash {
          background: linear-gradient(180deg, #22c55e, #16a34a);
          border-color: #16a34a;
          color: #fff;
          animation: sequence-master-pop 0.3s ease-out;
          box-shadow: 0 0 12px rgba(34,197,94,0.4);
        }

        .sequence-master-choice.wrong-flash {
          background: linear-gradient(180deg, #ef4444, #dc2626);
          border-color: #dc2626;
          color: #fff;
          animation: sequence-master-shake 0.35s ease-out;
        }

        .sequence-master-choice.reveal-correct {
          background: rgba(34,197,94,0.2);
          border-color: #22c55e;
          color: #4ade80;
        }

        .sequence-master-exit-btn {
          padding: 10px 16px;
          margin: 4px 12px 12px;
          font-size: 13px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          background: transparent;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .sequence-master-exit-btn:active {
          background: rgba(255,255,255,0.08);
        }

        @keyframes sequence-master-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.08); }
          100% { transform: scale(1); }
        }

        @keyframes sequence-master-shake {
          0% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
          100% { transform: translateX(0); }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="sequence-master-header">
        <img className="sequence-master-header-avatar" src={songChangsikImage} alt="송창식" />
        <div className="sequence-master-header-info">
          <div className="sequence-master-header-score-row">
            <p className="sequence-master-score">{score.toLocaleString()}</p>
            <p className="sequence-master-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <p className={`sequence-master-time ${isLowTime ? 'low-time' : ''}`}>{timeSeconds}s</p>
      </div>

      <div className="sequence-master-meta-row">
        <p className="sequence-master-combo">
          COMBO <strong>{combo}</strong>
          {comboLabel && (
            <span className="ge-combo-label" style={{ color: comboColor, marginLeft: 6, fontSize: 12 }}>{comboLabel}</span>
          )}
        </p>
        <p className="sequence-master-solved">
          Solved <strong>{solvedCount}</strong>
        </p>
        <p className="sequence-master-difficulty">
          <strong>{difficultyLabel}</strong>
        </p>
        {isFever && (
          <p style={{ color: '#facc15', fontSize: 12, fontWeight: 800, margin: 0, animation: 'sequence-master-pulse 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div className={`sequence-master-sequence-display ${isLowTime ? 'low-time' : ''}`}>
        <div className="sequence-master-sequence-row">
          {problem.displayed.map((num, index) => (
            <span className="sequence-master-num" key={`num-${index}`}>
              {num}
              {index < problem.displayed.length - 1 && <span className="sequence-master-separator">,</span>}
            </span>
          ))}
          <span className="sequence-master-num sequence-master-unknown">?</span>
        </div>
      </div>

      <div className="sequence-master-choices">
        {problem.choices.map((choice, index) => {
          let feedbackClass = ''
          if (feedback !== null) {
            if (feedback.choiceIndex === index) {
              feedbackClass = feedback.kind === 'correct' ? 'correct-flash' : 'wrong-flash'
            } else if (feedback.kind === 'wrong' && choice === problem.answer) {
              feedbackClass = 'reveal-correct'
            }
          }
          return (
            <button
              className={`sequence-master-choice ${feedbackClass}`}
              key={`choice-${index}`}
              type="button"
              onClick={() => handleChoice(index)}
              disabled={lockedRef.current}
            >
              {choice}
            </button>
          )
        })}
      </div>

      <button className="sequence-master-exit-btn" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const sequenceMasterModule: MiniGameModule = {
  manifest: {
    id: 'sequence-master',
    title: 'Sequence Master',
    description: '숫자 패턴을 읽고 다음 수를 맞춰라!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#2563eb',
  },
  Component: SequenceMasterGame,
}
