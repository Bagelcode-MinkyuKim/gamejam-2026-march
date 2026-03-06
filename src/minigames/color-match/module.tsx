import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import parkSangminImg from '../../../assets/images/same-character/park-sangmin.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const LOW_TIME_THRESHOLD_MS = 5000
const CORRECT_SCORE = 1
const WRONG_PENALTY = 2
const COMBO_BONUS_THRESHOLD = 5
const COMBO_BONUS_SCORE = 3
const BASE_DISPLAY_MS = 2400
const MIN_DISPLAY_MS = 500
const DISPLAY_MS_REDUCTION_PER_SCORE = 40
const FEEDBACK_DURATION_MS = 320
const SHAKE_DURATION_MS = 400
const COMBO_PULSE_DURATION_MS = 500
const NEW_QUESTION_DELAY_MS = 240

const FEVER_COMBO_THRESHOLD = 10
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 2
const FEVER_TIME_BONUS_MS = 3000
const EXTRA_COLORS_SCORE_THRESHOLD = 15

// Perfect timing bonus
const PERFECT_TIMING_WINDOW_MS = 400
const PERFECT_BONUS_SCORE = 2
const GOOD_TIMING_WINDOW_MS = 800
const GOOD_BONUS_SCORE = 1

// Multi-choice mode
const MULTI_CHOICE_SCORE_THRESHOLD = 20
const MULTI_CHOICE_CHANCE = 0.25

// Level system
const LEVEL_THRESHOLDS = [0, 10, 25, 45, 70, 100] as const
const LEVEL_NAMES = ['Beginner', 'Rookie', 'Pro', 'Master', 'Legend', 'GOD'] as const
const LEVEL_COLORS = ['#6b7280', '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6'] as const

// Speed rush
const SPEED_RUSH_COMBO_THRESHOLD = 7
const SPEED_RUSH_DURATION_MS = 5000
const SPEED_RUSH_SPEED_MULT = 0.7

// Golden question
const GOLDEN_CHANCE = 0.08
const GOLDEN_SCORE_MULTIPLIER = 5
const GOLDEN_SCORE_THRESHOLD = 8

// Shield system
const SHIELD_COMBO_THRESHOLD = 12
const MAX_SHIELDS = 3

// Time bonus
const TIME_BONUS_PER_CORRECT_MS = 200
const PERFECT_TIME_BONUS_MS = 500
const GOLDEN_TIME_BONUS_MS = 1500

// Reverse mode
const REVERSE_SCORE_THRESHOLD = 30
const REVERSE_CHANCE = 0.2

// Freeze power-up
const FREEZE_CHANCE = 0.06
const FREEZE_DURATION_MS = 3000
const FREEZE_SCORE_THRESHOLD = 12

const BASE_COLORS: readonly ColorEntry[] = [
  { name: 'Red', hex: '#ef4444' },
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Green', hex: '#22c55e' },
  { name: 'Yellow', hex: '#eab308' },
  { name: 'Purple', hex: '#8b5cf6' },
]

const EXTRA_COLORS: readonly ColorEntry[] = [
  { name: 'Sky', hex: '#06b6d4' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Orange', hex: '#f97316' },
]

interface ColorEntry {
  readonly name: string
  readonly hex: string
}

interface Question {
  readonly text: string
  readonly textColor: string
  readonly isMatch: boolean
  readonly type: 'normal' | 'multi-choice'
  readonly choices?: readonly string[]
  readonly correctChoice?: number
  readonly isGolden: boolean
  readonly isReverse: boolean
}

function pickRandom<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)]
}

function getActiveColors(score: number): readonly ColorEntry[] {
  if (score >= EXTRA_COLORS_SCORE_THRESHOLD + 10) return [...BASE_COLORS, ...EXTRA_COLORS]
  if (score >= EXTRA_COLORS_SCORE_THRESHOLD) return [...BASE_COLORS, EXTRA_COLORS[0], EXTRA_COLORS[1]]
  return BASE_COLORS
}

function getLevel(score: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= LEVEL_THRESHOLDS[i]) return i
  }
  return 0
}

function generateQuestion(colors: readonly ColorEntry[], enableMultiChoice: boolean, score: number): Question {
  const isGolden = score >= GOLDEN_SCORE_THRESHOLD && Math.random() < GOLDEN_CHANCE
  const isReverse = score >= REVERSE_SCORE_THRESHOLD && Math.random() < REVERSE_CHANCE && !isGolden

  // Multi-choice mode: pick the color that the text is displayed in
  if (enableMultiChoice && Math.random() < MULTI_CHOICE_CHANCE && !isGolden && !isReverse) {
    const textColor = pickRandom(colors)
    const displayColor = pickRandom(colors)
    const shuffled = [...colors].sort(() => Math.random() - 0.5).slice(0, 4)
    if (!shuffled.find(c => c.hex === displayColor.hex)) {
      shuffled[Math.floor(Math.random() * shuffled.length)] = displayColor
    }
    const correctIdx = shuffled.findIndex(c => c.hex === displayColor.hex)
    return {
      text: textColor.name,
      textColor: displayColor.hex,
      isMatch: false,
      type: 'multi-choice',
      choices: shuffled.map(c => c.name),
      correctChoice: correctIdx,
      isGolden: false,
      isReverse: false,
    }
  }

  const textColor: ColorEntry = pickRandom(colors)
  const isMatch = Math.random() < 0.4
  if (isMatch) {
    return { text: textColor.name, textColor: textColor.hex, isMatch: true, type: 'normal', isGolden, isReverse }
  }
  const candidates = colors.filter((c) => c.hex !== textColor.hex)
  const displayColor: ColorEntry = pickRandom(candidates)
  return { text: textColor.name, textColor: displayColor.hex, isMatch: false, type: 'normal', isGolden, isReverse }
}

function calculateDisplayMs(score: number, speedMult: number): number {
  return Math.max(MIN_DISPLAY_MS, (BASE_DISPLAY_MS - score * DISPLAY_MS_REDUCTION_PER_SCORE) * speedMult)
}

function ColorMatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [question, setQuestion] = useState<Question>(() => generateQuestion(BASE_COLORS, false, 0))
  const [questionVisible, setQuestionVisible] = useState(true)
  const [feedbackType, setFeedbackType] = useState<'correct' | 'wrong' | null>(null)
  const [isShaking, setIsShaking] = useState(false)
  const [isComboPulse, setIsComboPulse] = useState(false)
  const [floatingScore, setFloatingScore] = useState<{ value: string; key: number } | null>(null)
  const [isFeverMode, setIsFeverMode] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [isSpeedRush, setIsSpeedRush] = useState(false)
  const [speedRushRemainingMs, setSpeedRushRemainingMs] = useState(0)
  const [timingLabel, setTimingLabel] = useState<{ text: string; color: string; key: number } | null>(null)
  const [bgHue, setBgHue] = useState(0)
  const [streakBurst, setStreakBurst] = useState(false)
  const [perfectCount, setPerfectCount] = useState(0)
  const [shields, setShields] = useState(0)
  const [isFrozen, setIsFrozen] = useState(false)
  const [frozenRemainingMs, setFrozenRemainingMs] = useState(0)
  const [charAnim, setCharAnim] = useState<'' | 'correct-bounce' | 'wrong-recoil' | 'golden-celebrate'>('')
  const [charSpeech, setCharSpeech] = useState<{ text: string; key: number } | null>(null)
  const charSpeechKeyRef = useRef(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const questionRef = useRef<Question>(question)
  const finishedRef = useRef(false)
  const waitingNextRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const questionTimerRef = useRef(0)
  const feedbackTimerRef = useRef<number | null>(null)
  const shakeTimerRef = useRef<number | null>(null)
  const comboPulseTimerRef = useRef<number | null>(null)
  const nextQuestionTimerRef = useRef<number | null>(null)
  const floatingKeyRef = useRef(0)
  const feverRemainingMsRef = useRef(0)
  const feverActiveRef = useRef(false)
  const speedRushActiveRef = useRef(false)
  const speedRushRemainingMsRef = useRef(0)
  const perfectCountRef = useRef(0)
  const timingKeyRef = useRef(0)
  const shieldsRef = useRef(0)
  const frozenActiveRef = useRef(false)
  const frozenRemainingMsRef = useRef(0)

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

  const activateFever = useCallback(() => {
    feverActiveRef.current = true
    feverRemainingMsRef.current = FEVER_DURATION_MS
    setIsFeverMode(true)
    setFeverRemainingMs(FEVER_DURATION_MS)
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FEVER_TIME_BONUS_MS)
    setRemainingMs(remainingMsRef.current)
  }, [])

  const deactivateFever = useCallback(() => {
    feverActiveRef.current = false
    feverRemainingMsRef.current = 0
    setIsFeverMode(false)
    setFeverRemainingMs(0)
  }, [])

  const activateSpeedRush = useCallback(() => {
    speedRushActiveRef.current = true
    speedRushRemainingMsRef.current = SPEED_RUSH_DURATION_MS
    setIsSpeedRush(true)
    setSpeedRushRemainingMs(SPEED_RUSH_DURATION_MS)
  }, [])

  const deactivateSpeedRush = useCallback(() => {
    speedRushActiveRef.current = false
    speedRushRemainingMsRef.current = 0
    setIsSpeedRush(false)
    setSpeedRushRemainingMs(0)
  }, [])

  const getSpeedMult = useCallback(() => {
    return speedRushActiveRef.current ? SPEED_RUSH_SPEED_MULT : 1.0
  }, [])

  const activateFreeze = useCallback(() => {
    frozenActiveRef.current = true
    frozenRemainingMsRef.current = FREEZE_DURATION_MS
    setIsFrozen(true)
    setFrozenRemainingMs(FREEZE_DURATION_MS)
  }, [])

  const deactivateFreeze = useCallback(() => {
    frozenActiveRef.current = false
    frozenRemainingMsRef.current = 0
    setIsFrozen(false)
    setFrozenRemainingMs(0)
  }, [])

  const advanceQuestion = useCallback(() => {
    const colors = getActiveColors(Math.max(0, scoreRef.current))
    const enableMulti = scoreRef.current >= MULTI_CHOICE_SCORE_THRESHOLD
    const next = generateQuestion(colors, enableMulti, scoreRef.current)
    questionRef.current = next
    setQuestion(next)
    setQuestionVisible(true)
    questionTimerRef.current = 0
    waitingNextRef.current = false

    // Random freeze power-up
    if (scoreRef.current >= FREEZE_SCORE_THRESHOLD && Math.random() < FREEZE_CHANCE && !frozenActiveRef.current) {
      activateFreeze()
    }
  }, [activateFreeze])

  const scheduleNextQuestion = useCallback(() => {
    waitingNextRef.current = true
    setQuestionVisible(false)
    clearTimeoutSafe(nextQuestionTimerRef)
    nextQuestionTimerRef.current = window.setTimeout(() => {
      nextQuestionTimerRef.current = null
      if (!finishedRef.current) {
        advanceQuestion()
      }
    }, NEW_QUESTION_DELAY_MS)
  }, [advanceQuestion])

  const triggerFeedback = useCallback((type: 'correct' | 'wrong') => {
    setFeedbackType(type)
    clearTimeoutSafe(feedbackTimerRef)
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null
      setFeedbackType(null)
    }, FEEDBACK_DURATION_MS)
  }, [])

  const triggerShake = useCallback(() => {
    setIsShaking(true)
    clearTimeoutSafe(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsShaking(false)
    }, SHAKE_DURATION_MS)
  }, [])

  const triggerComboPulse = useCallback(() => {
    setIsComboPulse(true)
    clearTimeoutSafe(comboPulseTimerRef)
    comboPulseTimerRef.current = window.setTimeout(() => {
      comboPulseTimerRef.current = null
      setIsComboPulse(false)
    }, COMBO_PULSE_DURATION_MS)
  }, [])

  const showFloatingScore = useCallback((value: string) => {
    floatingKeyRef.current += 1
    setFloatingScore({ value, key: floatingKeyRef.current })
  }, [])

  const showTimingLabel = useCallback((text: string, color: string) => {
    timingKeyRef.current += 1
    setTimingLabel({ text, color, key: timingKeyRef.current })
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true

    clearTimeoutSafe(feedbackTimerRef)
    clearTimeoutSafe(shakeTimerRef)
    clearTimeoutSafe(comboPulseTimerRef)
    clearTimeoutSafe(nextQuestionTimerRef)

    playAudio(gameOverAudioRef, 0.64, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: Math.max(0, scoreRef.current),
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleAnswer = useCallback(
    (playerSaysMatch: boolean) => {
      if (finishedRef.current || waitingNextRef.current) return

      const currentQuestion = questionRef.current
      // Reverse mode: flip the expected answer
      const effectiveMatch = currentQuestion.isReverse ? !currentQuestion.isMatch : currentQuestion.isMatch
      const isCorrect = playerSaysMatch === effectiveMatch

      if (isCorrect) {
        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        let earned = CORRECT_SCORE
        const isComboBonus = nextCombo > 0 && nextCombo % COMBO_BONUS_THRESHOLD === 0
        if (isComboBonus) {
          earned += COMBO_BONUS_SCORE
        }

        // Perfect timing bonus
        const elapsed = questionTimerRef.current
        const displayLimit = calculateDisplayMs(Math.max(0, scoreRef.current), getSpeedMult())
        let timeBonus = TIME_BONUS_PER_CORRECT_MS
        if (elapsed <= PERFECT_TIMING_WINDOW_MS) {
          earned += PERFECT_BONUS_SCORE
          showTimingLabel('PERFECT!', '#fbbf24')
          perfectCountRef.current += 1
          setPerfectCount(perfectCountRef.current)
          timeBonus = PERFECT_TIME_BONUS_MS
        } else if (elapsed <= GOOD_TIMING_WINDOW_MS) {
          earned += GOOD_BONUS_SCORE
          showTimingLabel('GOOD!', '#22c55e')
          timeBonus = TIME_BONUS_PER_CORRECT_MS * 2
        } else if (elapsed > displayLimit * 0.8) {
          showTimingLabel('CLOSE!', '#f97316')
        }

        // Golden question multiplier
        if (currentQuestion.isGolden) {
          earned *= GOLDEN_SCORE_MULTIPLIER
          timeBonus = GOLDEN_TIME_BONUS_MS
          showTimingLabel('GOLDEN!', '#fbbf24')
          effects.comboHitBurst(200, 300, nextCombo, earned, ['💰', '👑', '🌟', '💎'])
          playAudio(tapHitStrongAudioRef, 0.9, 1.5)
        }

        // Apply fever multiplier
        if (feverActiveRef.current) {
          earned *= FEVER_SCORE_MULTIPLIER
        }

        // Multi-choice bonus
        if (currentQuestion.type === 'multi-choice') {
          earned += 2
        }

        // Time bonus
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + timeBonus)
        setRemainingMs(remainingMsRef.current)

        // Shield earn at combo threshold
        if (nextCombo > 0 && nextCombo % SHIELD_COMBO_THRESHOLD === 0 && shieldsRef.current < MAX_SHIELDS) {
          shieldsRef.current += 1
          setShields(shieldsRef.current)
          showTimingLabel(`SHIELD +1`, '#8b5cf6')
          effects.comboHitBurst(200, 300, nextCombo, earned, ['🛡️'])
        }

        // Trigger speed rush
        if (nextCombo === SPEED_RUSH_COMBO_THRESHOLD && !speedRushActiveRef.current && !feverActiveRef.current) {
          activateSpeedRush()
          showFloatingScore(`SPEED RUSH! +${earned}`)
          effects.comboHitBurst(200, 300, nextCombo, earned, ['💨', '⚡', '🏃'])
          playAudio(tapHitStrongAudioRef, 0.7, 1.4)
        }
        // Trigger fever mode at threshold
        else if (nextCombo === FEVER_COMBO_THRESHOLD && !feverActiveRef.current) {
          activateFever()
          playAudio(tapHitStrongAudioRef, 0.8, 1.3)
          showFloatingScore(`FEVER! +${earned}`)
          effects.comboHitBurst(200, 300, nextCombo, earned, ['🔥', '⚡', '💥', '🌟'])
        } else if (isComboBonus) {
          triggerComboPulse()
          playAudio(tapHitStrongAudioRef, 0.6, 1.1 + Math.min(0.3, nextCombo * 0.02))
          showFloatingScore(`+${earned} COMBO!`)
          effects.comboHitBurst(200, 300, nextCombo, earned)
        } else if (!currentQuestion.isGolden) {
          playAudio(tapHitAudioRef, 0.5, 1 + Math.min(0.2, nextCombo * 0.015))
          showFloatingScore(feverActiveRef.current ? `+${earned} 🔥` : `+${earned}`)
          effects.triggerFlash(feverActiveRef.current ? 'rgba(251,191,36,0.3)' : currentQuestion.isReverse ? 'rgba(139,92,246,0.3)' : 'rgba(34,197,94,0.3)')
          effects.spawnParticles(feverActiveRef.current ? 6 : speedRushActiveRef.current ? 4 : 3, 200, 300)
        }

        // Streak burst every 15 combo
        if (nextCombo > 0 && nextCombo % 15 === 0) {
          setStreakBurst(true)
          effects.comboHitBurst(200, 300, nextCombo, earned, ['🌈', '✨', '💎', '⭐', '🎆'])
          setTimeout(() => setStreakBurst(false), 800)
        }

        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)
        setBgHue((nextScore * 7) % 360)
        triggerFeedback('correct')

        // Character animation + speech
        if (currentQuestion.isGolden) {
          setCharAnim('golden-celebrate')
          charSpeechKeyRef.current += 1
          setCharSpeech({ text: 'GOLDEN!!', key: charSpeechKeyRef.current })
        } else {
          setCharAnim('correct-bounce')
          const speeches = nextCombo >= 10 ? ['MAX!', 'FIRE!', 'INSANE!'] : nextCombo >= 5 ? ['NICE!', 'GREAT!', 'YEAH!'] : ['OK!', 'YES!', 'GO!']
          charSpeechKeyRef.current += 1
          setCharSpeech({ text: speeches[Math.floor(Math.random() * speeches.length)], key: charSpeechKeyRef.current })
        }
        setTimeout(() => setCharAnim(''), 500)
      } else {
        // Shield absorbs wrong answer
        if (shieldsRef.current > 0) {
          shieldsRef.current -= 1
          setShields(shieldsRef.current)
          showTimingLabel('SHIELD!', '#8b5cf6')
          showFloatingScore('BLOCKED!')
          effects.triggerFlash('rgba(139,92,246,0.4)')
          effects.spawnParticles(5, 200, 300)
          playAudio(tapHitStrongAudioRef, 0.5, 0.8)
          scheduleNextQuestion()
          return
        }

        comboRef.current = 0
        setCombo(0)

        if (feverActiveRef.current) {
          deactivateFever()
        }
        if (speedRushActiveRef.current) {
          deactivateSpeedRush()
        }

        const nextScore = scoreRef.current - WRONG_PENALTY
        scoreRef.current = nextScore
        setScore(nextScore)
        triggerFeedback('wrong')
        triggerShake()
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.4)')
        effects.spawnParticles(4, 200, 300)
        playAudio(tapHitAudioRef, 0.4, 0.7)
        showFloatingScore(`-${WRONG_PENALTY}`)
        showTimingLabel('MISS!', '#ef4444')

        // Character recoil + speech
        setCharAnim('wrong-recoil')
        charSpeechKeyRef.current += 1
        const missSpeeches = ['UGH!', 'NO!', 'OOPS!', 'AH!']
        setCharSpeech({ text: missSpeeches[Math.floor(Math.random() * missSpeeches.length)], key: charSpeechKeyRef.current })
        setTimeout(() => setCharAnim(''), 500)
      }

      scheduleNextQuestion()
    },
    [activateFever, activateSpeedRush, deactivateFever, deactivateSpeedRush, getSpeedMult, playAudio, scheduleNextQuestion, showFloatingScore, showTimingLabel, triggerComboPulse, triggerFeedback, triggerShake],
  )

  const handleMultiChoice = useCallback(
    (choiceIdx: number) => {
      if (finishedRef.current || waitingNextRef.current) return
      const currentQuestion = questionRef.current
      if (currentQuestion.type !== 'multi-choice') return
      const isCorrect = choiceIdx === currentQuestion.correctChoice
      handleAnswer(isCorrect)
    },
    [handleAnswer],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

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

    return () => {
      clearTimeoutSafe(feedbackTimerRef)
      clearTimeoutSafe(shakeTimerRef)
      clearTimeoutSafe(comboPulseTimerRef)
      clearTimeoutSafe(nextQuestionTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current) return

      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }

      // Multi-choice keys
      if (questionRef.current.type === 'multi-choice') {
        if (event.code === 'Digit1' || event.code === 'Numpad1') { handleMultiChoice(0); return }
        if (event.code === 'Digit2' || event.code === 'Numpad2') { handleMultiChoice(1); return }
        if (event.code === 'Digit3' || event.code === 'Numpad3') { handleMultiChoice(2); return }
        if (event.code === 'Digit4' || event.code === 'Numpad4') { handleMultiChoice(3); return }
      }

      if (event.code === 'ArrowLeft' || event.code === 'KeyA' || event.code === 'KeyO') {
        event.preventDefault()
        handleAnswer(true)
        return
      }

      if (event.code === 'ArrowRight' || event.code === 'KeyD' || event.code === 'KeyX') {
        event.preventDefault()
        handleAnswer(false)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleAnswer, handleExit, handleMultiChoice])

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

      // Tick fever timer
      if (feverActiveRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          deactivateFever()
        }
      }

      // Tick speed rush timer
      if (speedRushActiveRef.current) {
        speedRushRemainingMsRef.current = Math.max(0, speedRushRemainingMsRef.current - deltaMs)
        setSpeedRushRemainingMs(speedRushRemainingMsRef.current)
        if (speedRushRemainingMsRef.current <= 0) {
          deactivateSpeedRush()
        }
      }

      // Tick freeze timer
      if (frozenActiveRef.current) {
        frozenRemainingMsRef.current = Math.max(0, frozenRemainingMsRef.current - deltaMs)
        setFrozenRemainingMs(frozenRemainingMsRef.current)
        if (frozenRemainingMsRef.current <= 0) {
          deactivateFreeze()
        }
      }

      if (!waitingNextRef.current) {
        // Freeze stops question timer
        if (!frozenActiveRef.current) {
          questionTimerRef.current += deltaMs
        }
        const speedMult = speedRushActiveRef.current ? SPEED_RUSH_SPEED_MULT : 1.0
        const displayLimit = calculateDisplayMs(Math.max(0, scoreRef.current), speedMult)
        if (questionTimerRef.current >= displayLimit) {
          comboRef.current = 0
          setCombo(0)
          if (feverActiveRef.current) {
            deactivateFever()
          }
          if (speedRushActiveRef.current) {
            deactivateSpeedRush()
          }
          scheduleNextQuestion()
        }
      }

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      effects.updateParticles()

      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      lastFrameAtRef.current = null
      effects.cleanup()
    }
  }, [deactivateFever, deactivateFreeze, deactivateSpeedRush, finishGame, scheduleNextQuestion])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const speedMult = isSpeedRush ? SPEED_RUSH_SPEED_MULT : 1.0
  const displayMs = calculateDisplayMs(Math.max(0, score), speedMult)
  const timeBarPercent = waitingNextRef.current ? 0 : Math.max(0, 100 - (questionTimerRef.current / displayMs) * 100)
  const activeColorCount = getActiveColors(Math.max(0, score)).length
  const level = getLevel(Math.max(0, score))

  const panelClass = [
    'mini-game-panel',
    'color-match-panel',
    isShaking ? 'color-match-shake' : '',
    feedbackType === 'correct' ? 'color-match-correct-flash' : '',
    feedbackType === 'wrong' ? 'color-match-wrong-flash' : '',
    isFeverMode ? 'color-match-fever' : '',
    isSpeedRush ? 'color-match-speed-rush' : '',
    streakBurst ? 'color-match-streak-burst' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const arenaBackground = isFeverMode
    ? `linear-gradient(180deg, rgba(255,251,235,0.95), rgba(254,243,199,0.95))`
    : isSpeedRush
      ? `linear-gradient(180deg, rgba(224,242,254,0.95), rgba(186,230,253,0.95))`
      : `linear-gradient(180deg, hsla(${bgHue}, 15%, 98%, 0.95), hsla(${bgHue}, 12%, 96%, 0.95))`

  return (
    <section className={panelClass} aria-label="color-match-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', padding: 0, ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}
      {`
        .color-match-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          padding: 0;
          position: relative;
          overflow: hidden;
          height: 100%;
        }

        .color-match-panel.color-match-fever {
          animation: color-match-fever-bg 0.6s ease-in-out infinite alternate;
        }

        .color-match-panel.color-match-speed-rush {
          animation: color-match-speed-rush-bg 0.3s ease-in-out infinite alternate;
        }

        .color-match-panel.color-match-streak-burst {
          animation: color-match-streak-burst-anim 0.8s ease-out;
        }

        @keyframes color-match-fever-bg {
          from { box-shadow: inset 0 0 80px rgba(251,191,36,0.2); }
          to { box-shadow: inset 0 0 120px rgba(251,191,36,0.4); }
        }

        @keyframes color-match-speed-rush-bg {
          from { box-shadow: inset 0 0 60px rgba(59,130,246,0.15); }
          to { box-shadow: inset 0 0 80px rgba(59,130,246,0.3); }
        }

        @keyframes color-match-streak-burst-anim {
          0% { filter: brightness(1); }
          20% { filter: brightness(1.4) saturate(1.5); }
          100% { filter: brightness(1); }
        }

        .color-match-top-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 8px 12px;
          background: rgba(255,255,255,0.85);
          backdrop-filter: blur(8px);
          z-index: 10;
          flex-shrink: 0;
        }

        .color-match-fever-banner {
          position: absolute;
          top: 46px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          background-size: 200% 100%;
          animation: color-match-fever-banner-slide 1s linear infinite, color-match-fever-pulse 0.4s ease-in-out infinite alternate;
          color: #fff;
          font-size: 20px;
          font-weight: 900;
          padding: 8px 28px;
          border-radius: 20px;
          z-index: 30;
          letter-spacing: 4px;
          text-shadow: 0 2px 6px rgba(0,0,0,0.4);
          pointer-events: none;
        }

        @keyframes color-match-fever-banner-slide {
          from { background-position: 0% 0; }
          to { background-position: 200% 0; }
        }

        @keyframes color-match-fever-pulse {
          from { transform: translateX(-50%) scale(1); }
          to { transform: translateX(-50%) scale(1.1); }
        }

        .color-match-speed-rush-banner {
          position: absolute;
          top: 46px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(90deg, #3b82f6, #06b6d4, #3b82f6);
          background-size: 200% 100%;
          animation: color-match-fever-banner-slide 0.8s linear infinite, color-match-speed-rush-pulse 0.3s ease-in-out infinite alternate;
          color: #fff;
          font-size: 16px;
          font-weight: 900;
          padding: 6px 20px;
          border-radius: 16px;
          z-index: 30;
          letter-spacing: 3px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          pointer-events: none;
        }

        @keyframes color-match-speed-rush-pulse {
          from { transform: translateX(-50%) scale(1); }
          to { transform: translateX(-50%) scale(1.05); }
        }

        .color-match-fever-timer {
          width: 80%;
          height: 4px;
          background: rgba(255,255,255,0.3);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 4px;
        }

        .color-match-fever-timer-fill {
          height: 100%;
          background: linear-gradient(90deg, #fbbf24, #ef4444);
          border-radius: 2px;
          transition: width 0.1s linear;
        }

        .color-match-score {
          font-size: clamp(48px, 12vw, 64px);
          font-weight: 900;
          color: #1f2937;
          margin: 0;
          transition: transform 0.15s ease, color 0.2s ease;
          text-shadow: 0 2px 4px rgba(0,0,0,0.12);
          line-height: 1;
        }

        .color-match-score.negative {
          color: #ef4444;
        }

        .color-match-level-badge {
          font-size: 14px;
          font-weight: 800;
          padding: 4px 14px;
          border-radius: 12px;
          letter-spacing: 1px;
          text-transform: uppercase;
          transition: all 0.3s ease;
        }

        .color-match-best {
          font-size: 14px;
          color: #9ca3af;
          margin: 0;
          letter-spacing: 1px;
        }

        .color-match-time {
          font-size: clamp(28px, 7vw, 36px);
          font-weight: 900;
          color: #4b5563;
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s ease;
          line-height: 1;
        }

        .color-match-time.low-time {
          color: #ef4444;
          animation: color-match-time-pulse 0.5s ease infinite alternate;
        }

        @keyframes color-match-time-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.2); }
        }

        .color-match-info-strip {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 14px;
          width: 100%;
          padding: 6px 12px;
          flex-shrink: 0;
        }

        .color-match-combo {
          font-size: 18px;
          font-weight: 800;
          color: #6b7280;
          margin: 0;
          transition: transform 0.2s ease, color 0.2s ease;
        }

        .color-match-combo.active {
          color: #f59e0b;
        }

        .color-match-combo.pulse {
          animation: color-match-combo-burst 0.5s ease;
          color: #f59e0b;
        }

        @keyframes color-match-combo-burst {
          0% { transform: scale(1); }
          30% { transform: scale(1.6); }
          100% { transform: scale(1); }
        }

        .color-match-perfect-count {
          font-size: 14px;
          color: #fbbf24;
          font-weight: 800;
          margin: 0;
        }

        .color-match-question-timer {
          width: 100%;
          height: 8px;
          background: #e5e7eb;
          overflow: hidden;
          flex-shrink: 0;
        }

        .color-match-question-timer-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          transition: width 0.1s linear;
        }

        .color-match-question-timer-fill.urgent {
          background: linear-gradient(90deg, #ef4444, #f59e0b);
          animation: color-match-urgent-flash 0.3s ease infinite alternate;
        }

        @keyframes color-match-urgent-flash {
          from { opacity: 1; }
          to { opacity: 0.6; }
        }

        .color-match-question-timer-fill.fever {
          background: linear-gradient(90deg, #fbbf24, #ef4444, #fbbf24);
          background-size: 200% 100%;
          animation: color-match-fever-bar 0.6s linear infinite;
        }

        .color-match-question-timer-fill.speed-rush {
          background: linear-gradient(90deg, #06b6d4, #3b82f6, #06b6d4);
          background-size: 200% 100%;
          animation: color-match-fever-bar 0.5s linear infinite;
        }

        @keyframes color-match-fever-bar {
          from { background-position: 0% 0; }
          to { background-position: 200% 0; }
        }

        .color-match-arena {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 100%;
          flex: 1;
          padding: 12px 16px;
          position: relative;
          overflow: hidden;
          transition: background 0.5s ease;
        }

        .color-match-word {
          font-size: clamp(52px, 14vw, 72px);
          font-weight: 900;
          margin: 0;
          text-align: center;
          user-select: none;
          transition: opacity 0.15s ease, transform 0.15s ease;
          line-height: 1.2;
          letter-spacing: 4px;
          -webkit-text-stroke: 0px;
        }

        .color-match-word.hidden {
          opacity: 0;
          transform: scale(0.6) rotate(-10deg);
        }

        .color-match-word.visible {
          opacity: 1;
          transform: scale(1) rotate(0deg);
          animation: color-match-word-appear 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes color-match-word-appear {
          from { opacity: 0; transform: scale(0.3) rotate(-15deg); }
          60% { transform: scale(1.1) rotate(2deg); }
          to { opacity: 1; transform: scale(1) rotate(0deg); }
        }

        .color-match-multi-hint {
          font-size: 14px;
          color: #6b7280;
          margin: 8px 0 0 0;
          text-align: center;
          font-weight: 600;
        }

        .color-match-hint {
          font-size: 12px;
          color: #9ca3af;
          margin: 6px 0 0 0;
          text-align: center;
        }

        .color-match-timing-label {
          position: absolute;
          top: 12%;
          left: 50%;
          transform: translateX(-50%);
          font-size: clamp(22px, 6vw, 30px);
          font-weight: 900;
          pointer-events: none;
          animation: color-match-timing-pop 0.6s ease-out forwards;
          z-index: 15;
          letter-spacing: 2px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }

        @keyframes color-match-timing-pop {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(0.5); }
          30% { opacity: 1; transform: translateX(-50%) translateY(-10px) scale(1.3); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-40px) scale(0.8); }
        }

        .color-match-character-container {
          position: relative;
          margin-top: 12px;
        }

        .color-match-character-container.correct-bounce img {
          animation: color-match-char-bounce 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        .color-match-character-container.wrong-recoil img {
          animation: color-match-char-recoil 0.4s ease;
        }

        .color-match-character-container.golden-celebrate img {
          animation: color-match-char-celebrate 0.6s ease;
        }

        .color-match-character-container.fever-dance img {
          animation: color-match-char-dance 0.8s ease-in-out infinite;
        }

        @keyframes color-match-char-bounce {
          0% { transform: scale(1) translateY(0); }
          30% { transform: scale(1.15) translateY(-12px); }
          50% { transform: scale(0.95) translateY(0); }
          70% { transform: scale(1.05) translateY(-4px); }
          100% { transform: scale(1) translateY(0); }
        }

        @keyframes color-match-char-recoil {
          0% { transform: scale(1) rotate(0deg); }
          20% { transform: scale(0.85) rotate(-8deg); }
          40% { transform: scale(0.85) rotate(8deg); }
          60% { transform: scale(0.9) rotate(-4deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        @keyframes color-match-char-celebrate {
          0% { transform: scale(1) rotate(0deg); }
          20% { transform: scale(1.3) rotate(-10deg); }
          40% { transform: scale(1.3) rotate(10deg); }
          60% { transform: scale(1.2) rotate(-5deg); }
          80% { transform: scale(1.1) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        @keyframes color-match-char-dance {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          25% { transform: translateY(-6px) rotate(-3deg); }
          50% { transform: translateY(0) rotate(0deg); }
          75% { transform: translateY(-6px) rotate(3deg); }
        }

        .color-match-char-speech {
          position: absolute;
          top: -28px;
          left: 50%;
          transform: translateX(-50%);
          background: #fff;
          border: 2px solid #e5e7eb;
          border-radius: 12px;
          padding: 3px 10px;
          font-size: 12px;
          font-weight: 800;
          white-space: nowrap;
          z-index: 5;
          animation: color-match-speech-pop 0.5s ease-out forwards;
          pointer-events: none;
        }

        .color-match-char-speech::after {
          content: '';
          position: absolute;
          bottom: -6px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 6px solid transparent;
          border-right: 6px solid transparent;
          border-top: 6px solid #fff;
        }

        @keyframes color-match-speech-pop {
          0% { opacity: 0; transform: translateX(-50%) translateY(8px) scale(0.5); }
          30% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.1); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-12px) scale(0.8); }
        }

        .color-match-floating-score {
          position: absolute;
          top: 25%;
          left: 50%;
          transform: translateX(-50%);
          font-size: clamp(30px, 8vw, 40px);
          font-weight: 900;
          pointer-events: none;
          animation: color-match-float-up 0.8s ease-out forwards;
          z-index: 10;
          text-shadow: 0 2px 6px rgba(0,0,0,0.2);
        }

        .color-match-floating-score.positive {
          color: #22c55e;
        }

        .color-match-floating-score.negative {
          color: #ef4444;
        }

        .color-match-floating-score.bonus {
          color: #f59e0b;
          font-size: clamp(36px, 9vw, 48px);
        }

        @keyframes color-match-float-up {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(0.8); }
          30% { opacity: 1; transform: translateX(-50%) translateY(-30px) scale(1.2); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-80px) scale(0.7); }
        }

        .color-match-buttons {
          display: flex;
          gap: 12px;
          width: 100%;
          padding: 8px 12px;
          flex-shrink: 0;
        }

        .color-match-multi-buttons {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          flex-shrink: 0;
        }

        .color-match-button {
          flex: 1;
          padding: 20px 8px;
          border-radius: 16px;
          border: 3px solid;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          user-select: none;
          transition: transform 0.1s ease, box-shadow 0.1s ease;
          position: relative;
          overflow: hidden;
          font-family: inherit;
          letter-spacing: 1px;
        }

        .color-match-button:active {
          transform: scale(0.93);
        }

        .color-match-button.match {
          background: linear-gradient(180deg, #bbf7d0 0%, #86efac 100%);
          border-color: #22c55e;
          color: #166534;
          box-shadow: 0 5px 0 #16a34a, 0 8px 16px rgba(34, 197, 94, 0.3);
        }

        .color-match-button.match:active {
          box-shadow: 0 1px 0 #16a34a;
          transform: scale(0.93) translateY(4px);
        }

        .color-match-button.no-match {
          background: linear-gradient(180deg, #fecaca 0%, #fca5a5 100%);
          border-color: #ef4444;
          color: #991b1b;
          box-shadow: 0 5px 0 #dc2626, 0 8px 16px rgba(239, 68, 68, 0.3);
        }

        .color-match-button.no-match:active {
          box-shadow: 0 1px 0 #dc2626;
          transform: scale(0.93) translateY(4px);
        }

        .color-match-button.multi-choice {
          background: linear-gradient(180deg, #e0e7ff 0%, #c7d2fe 100%);
          border-color: #6366f1;
          color: #3730a3;
          box-shadow: 0 4px 0 #4f46e5, 0 6px 12px rgba(99, 102, 241, 0.25);
          padding: 14px 8px;
        }

        .color-match-button.multi-choice:active {
          box-shadow: 0 1px 0 #4f46e5;
          transform: scale(0.93) translateY(3px);
        }

        .color-match-button .color-match-button-icon {
          font-size: clamp(36px, 9vw, 48px);
          display: block;
          margin-bottom: 4px;
        }

        .color-match-button .color-match-button-label {
          font-size: 14px;
          display: block;
          font-weight: 700;
        }

        .color-match-shake {
          animation: color-match-shake-anim 0.4s ease;
        }

        @keyframes color-match-shake-anim {
          0%, 100% { transform: translateX(0); }
          12% { transform: translateX(-10px) rotate(-1deg); }
          25% { transform: translateX(10px) rotate(1deg); }
          37% { transform: translateX(-8px) rotate(-0.5deg); }
          50% { transform: translateX(8px) rotate(0.5deg); }
          62% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
          87% { transform: translateX(-2px); }
        }

        .color-match-correct-flash {
          animation: color-match-correct-glow 0.35s ease;
        }

        @keyframes color-match-correct-glow {
          0% { box-shadow: inset 0 0 0 rgba(34, 197, 94, 0); }
          50% { box-shadow: inset 0 0 60px rgba(34, 197, 94, 0.2); }
          100% { box-shadow: inset 0 0 0 rgba(34, 197, 94, 0); }
        }

        .color-match-wrong-flash {
          animation: color-match-wrong-glow 0.35s ease;
        }

        @keyframes color-match-wrong-glow {
          0% { box-shadow: inset 0 0 0 rgba(239, 68, 68, 0); }
          30% { box-shadow: inset 0 0 60px rgba(239, 68, 68, 0.25); }
          100% { box-shadow: inset 0 0 0 rgba(239, 68, 68, 0); }
        }

        /* exit row removed */

        .color-match-bg-orbs {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
          overflow: hidden;
        }

        .color-match-bg-orb {
          position: absolute;
          border-radius: 50%;
          opacity: 0.12;
          filter: blur(40px);
          animation: color-match-orb-float 6s ease-in-out infinite alternate;
        }

        @keyframes color-match-orb-float {
          0% { transform: translate(0, 0) scale(1); }
          100% { transform: translate(20px, -30px) scale(1.2); }
        }

        .color-match-rainbow-bar {
          width: 100%;
          height: 3px;
          background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444);
          background-size: 200% 100%;
          animation: color-match-rainbow-slide 2s linear infinite;
          flex-shrink: 0;
        }

        @keyframes color-match-rainbow-slide {
          from { background-position: 0% 0; }
          to { background-position: 200% 0; }
        }

        .color-match-golden-glow {
          animation: color-match-golden-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes color-match-golden-pulse {
          from { text-shadow: 0 0 12px rgba(251,191,36,0.4); }
          to { text-shadow: 0 0 24px rgba(251,191,36,0.7), 0 0 48px rgba(251,191,36,0.2); }
        }

        .color-match-reverse-indicator {
          font-size: 13px;
          font-weight: 800;
          color: #8b5cf6;
          text-align: center;
          margin: 4px 0 0 0;
          animation: color-match-reverse-blink 0.6s ease infinite alternate;
          letter-spacing: 2px;
        }

        @keyframes color-match-reverse-blink {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }

        .color-match-shield-display {
          display: flex;
          gap: 3px;
          align-items: center;
        }

        .color-match-shield-icon {
          font-size: 14px;
          filter: drop-shadow(0 1px 2px rgba(139,92,246,0.4));
        }

        .color-match-shield-icon.empty {
          opacity: 0.25;
        }

        .color-match-freeze-banner {
          position: absolute;
          top: 46px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(90deg, #06b6d4, #22d3ee, #06b6d4);
          background-size: 200% 100%;
          animation: color-match-fever-banner-slide 1.2s linear infinite, color-match-freeze-pulse 0.5s ease-in-out infinite alternate;
          color: #fff;
          font-size: 16px;
          font-weight: 900;
          padding: 6px 20px;
          border-radius: 16px;
          z-index: 30;
          letter-spacing: 3px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          pointer-events: none;
        }

        @keyframes color-match-freeze-pulse {
          from { transform: translateX(-50%) scale(1); }
          to { transform: translateX(-50%) scale(1.06); }
        }

        .color-match-frozen-overlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at center, rgba(6,182,212,0.08) 0%, transparent 70%);
          pointer-events: none;
          z-index: 1;
          animation: color-match-frozen-shimmer 1.5s ease-in-out infinite alternate;
        }

        @keyframes color-match-frozen-shimmer {
          from { opacity: 0.5; }
          to { opacity: 1; }
        }

        .color-match-golden-arena {
          border: 2px solid #fbbf24;
          box-shadow: inset 0 0 30px rgba(251,191,36,0.15);
        }
      `}</style>

      {/* Top bar with score, level, time */}
      <div className="color-match-top-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <p className={`color-match-score ${score < 0 ? 'negative' : ''}`}>{score}</p>
          <span className="color-match-level-badge" style={{ background: `${LEVEL_COLORS[level]}22`, color: LEVEL_COLORS[level] }}>
            {LEVEL_NAMES[level]}
          </span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className={`color-match-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <p className="color-match-best">BEST {displayedBestScore}</p>
        </div>
      </div>

      {/* Info strip: combo, perfect count, colors */}
      <div className="color-match-info-strip">
        <p className={`color-match-combo ${combo >= COMBO_BONUS_THRESHOLD ? 'active' : ''} ${isComboPulse ? 'pulse' : ''}`}>
          COMBO <strong>{combo}</strong>
        </p>
        {perfectCount > 0 && (
          <p className="color-match-perfect-count">PERFECT x{perfectCount}</p>
        )}
        {activeColorCount > BASE_COLORS.length && (
          <p style={{ fontSize: '11px', color: '#9ca3af', margin: 0 }}>
            {activeColorCount}colors
          </p>
        )}
        {shields > 0 && (
          <div className="color-match-shield-display">
            {Array.from({ length: MAX_SHIELDS }, (_, i) => (
              <span key={i} className={`color-match-shield-icon ${i < shields ? '' : 'empty'}`}>🛡️</span>
            ))}
          </div>
        )}
      </div>

      {/* Question timer bar */}
      <div className="color-match-question-timer">
        <div
          className={`color-match-question-timer-fill ${isFeverMode ? 'fever' : isSpeedRush ? 'speed-rush' : timeBarPercent < 30 ? 'urgent' : ''}`}
          style={{ width: `${timeBarPercent}%` }}
        />
      </div>

      {/* Rainbow bar during fever */}
      {isFeverMode && <div className="color-match-rainbow-bar" />}

      {/* Banners */}
      {isFeverMode && (
        <div className="color-match-fever-banner">
          FEVER x{FEVER_SCORE_MULTIPLIER}
          <div className="color-match-fever-timer">
            <div className="color-match-fever-timer-fill" style={{ width: `${(feverRemainingMs / FEVER_DURATION_MS) * 100}%` }} />
          </div>
        </div>
      )}

      {isSpeedRush && !isFeverMode && (
        <div className="color-match-speed-rush-banner">
          SPEED RUSH
          <div className="color-match-fever-timer">
            <div className="color-match-fever-timer-fill" style={{ width: `${(speedRushRemainingMs / SPEED_RUSH_DURATION_MS) * 100}%`, background: 'linear-gradient(90deg, #06b6d4, #3b82f6)' }} />
          </div>
        </div>
      )}

      {isFrozen && !isFeverMode && !isSpeedRush && (
        <div className="color-match-freeze-banner">
          FREEZE
          <div className="color-match-fever-timer">
            <div className="color-match-fever-timer-fill" style={{ width: `${(frozenRemainingMs / FREEZE_DURATION_MS) * 100}%`, background: 'linear-gradient(90deg, #22d3ee, #06b6d4)' }} />
          </div>
        </div>
      )}

      {/* Main arena - takes up all remaining space */}
      <div className={`color-match-arena ${question.isGolden ? 'color-match-golden-arena' : ''}`} style={{ background: arenaBackground }}>
        {/* Background orbs */}
        <div className="color-match-bg-orbs">
          <div className="color-match-bg-orb" style={{ width: '200px', height: '200px', background: isFeverMode ? '#fbbf24' : '#3b82f6', top: '-20%', left: '-10%', animationDelay: '0s' }} />
          <div className="color-match-bg-orb" style={{ width: '150px', height: '150px', background: isFeverMode ? '#ef4444' : '#8b5cf6', bottom: '-10%', right: '-5%', animationDelay: '2s' }} />
          <div className="color-match-bg-orb" style={{ width: '120px', height: '120px', background: isFeverMode ? '#f59e0b' : '#22c55e', top: '40%', right: '10%', animationDelay: '4s' }} />
        </div>

        {/* Frozen overlay */}
        {isFrozen && <div className="color-match-frozen-overlay" />}

        {/* Timing label */}
        {timingLabel !== null && (
          <span key={timingLabel.key} className="color-match-timing-label" style={{ color: timingLabel.color }}>
            {timingLabel.text}
          </span>
        )}

        {/* The word */}
        <p
          className={`color-match-word ${questionVisible ? 'visible' : 'hidden'} ${question.isGolden ? 'color-match-golden-glow' : ''}`}
          style={{ color: question.isGolden ? '#fbbf24' : question.textColor, position: 'relative', zIndex: 2 }}
        >
          {question.isGolden ? `★ ${question.text} ★` : question.text}
        </p>

        {/* Reverse mode indicator - no other hint text */}
        {question.isReverse && questionVisible && (
          <p className="color-match-reverse-indicator" style={{ marginTop: '4px' }}>REVERSE!</p>
        )}

        {/* Character */}
        <div className={`color-match-character-container ${charAnim} ${isFeverMode ? 'fever-dance' : ''}`}>
          {charSpeech !== null && (
            <span key={charSpeech.key} className="color-match-char-speech" style={{ color: charAnim === 'wrong-recoil' ? '#ef4444' : charAnim === 'golden-celebrate' ? '#fbbf24' : '#22c55e' }}>
              {charSpeech.text}
            </span>
          )}
          <img
            src={parkSangminImg}
            alt="park-sangmin"
            style={{
              width: 'clamp(120px, 35vw, 180px)',
              height: 'clamp(120px, 35vw, 180px)',
              objectFit: 'contain',
              filter: isFeverMode ? 'brightness(1.3) saturate(1.5) drop-shadow(0 0 16px rgba(251,191,36,0.6))'
                : isSpeedRush ? 'brightness(1.2) drop-shadow(0 0 10px rgba(59,130,246,0.5))'
                : isFrozen ? 'brightness(1.1) saturate(0.8) drop-shadow(0 0 10px rgba(6,182,212,0.4))'
                : feedbackType === 'correct' ? 'brightness(1.2) drop-shadow(0 0 8px rgba(34,197,94,0.5))'
                : feedbackType === 'wrong' ? 'grayscale(0.6) brightness(0.7)'
                : 'drop-shadow(0 4px 8px rgba(0,0,0,0.15))',
              transition: 'filter 0.2s ease',
            }}
          />
        </div>

        {/* Floating score */}
        {floatingScore !== null ? (
          <span
            key={floatingScore.key}
            className={`color-match-floating-score ${
              floatingScore.value.startsWith('-') ? 'negative' : floatingScore.value.includes('COMBO') || floatingScore.value.includes('FEVER') || floatingScore.value.includes('RUSH') ? 'bonus' : 'positive'
            }`}
          >
            {floatingScore.value}
          </span>
        ) : null}
      </div>

      {/* Buttons */}
      {question.type === 'multi-choice' && question.choices ? (
        <div className="color-match-multi-buttons">
          {question.choices.map((choice, idx) => (
            <button
              key={idx}
              className="color-match-button multi-choice"
              type="button"
              onClick={() => handleMultiChoice(idx)}
            >
              <span className="color-match-button-label" style={{ fontSize: '14px' }}>{choice}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="color-match-buttons">
          <button className="color-match-button match" type="button" onClick={() => handleAnswer(true)}>
            <span className="color-match-button-icon">O</span>
            <span className="color-match-button-label">MATCH</span>
          </button>
          <button className="color-match-button no-match" type="button" onClick={() => handleAnswer(false)}>
            <span className="color-match-button-icon">X</span>
            <span className="color-match-button-label">MISMATCH</span>
          </button>
        </div>
      )}

      {combo >= 3 && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: '50px', left: '50%', transform: 'translateX(-50%)', fontSize: `${18 + combo}px`, color: getComboColor(combo), zIndex: 20, textShadow: '0 2px 8px rgba(0,0,0,0.2)' }}>
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

{/* exit button removed */}
    </section>
  )
}

export const colorMatchModule: MiniGameModule = {
  manifest: {
    id: 'color-match',
    title: 'Color Match',
    description: '\uC0C9 \uC774\uB984\uACFC \uAE00\uC790 \uC0C9\uC774 \uC77C\uCE58\uD558\uB294\uC9C0 \uBE60\uB974\uAC8C \uD310\uB2E8\uD558\uB77C! \uC2A4\uD2B8\uB8F9 \uD14C\uC2A4\uD2B8 \uCC4C\uB9B0\uC9C0',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#3b82f6',
  },
  Component: ColorMatchGame,
}
