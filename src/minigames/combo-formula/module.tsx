import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import cfTapGoodSfx from '../../../assets/sounds/generated/combo-formula/cf-tap-good.mp3'
import cfTapBadSfx from '../../../assets/sounds/generated/combo-formula/cf-tap-bad.mp3'
import cfTapAccentSfx from '../../../assets/sounds/generated/combo-formula/cf-tap-accent.mp3'
import cfResetSfx from '../../../assets/sounds/generated/combo-formula/cf-reset.mp3'
import cfOkLockedSfx from '../../../assets/sounds/generated/combo-formula/cf-ok-locked.mp3'
import cfOkUnlockSfx from '../../../assets/sounds/generated/combo-formula/cf-ok-unlock.mp3'
import cfOkConfirmSfx from '../../../assets/sounds/generated/combo-formula/cf-ok-confirm.mp3'
import cfFeverGainSfx from '../../../assets/sounds/generated/combo-formula/cf-fever-gain.mp3'
import cfFeverStartSfx from '../../../assets/sounds/generated/combo-formula/cf-fever-start.mp3'
import cfFeverEndSfx from '../../../assets/sounds/generated/combo-formula/cf-fever-end.mp3'
import cfComboMilestoneSfx from '../../../assets/sounds/generated/combo-formula/cf-combo-milestone.mp3'
import cfLowTimeSfx from '../../../assets/sounds/generated/combo-formula/cf-low-time.mp3'
import cfGameOverSfx from '../../../assets/sounds/generated/combo-formula/cf-game-over.mp3'
import cfExitSfx from '../../../assets/sounds/generated/combo-formula/cf-exit.mp3'
import cfComboUpSfx from '../../../assets/sounds/generated/combo-formula/cf-combo-up.mp3'
import cfRecipeCompleteSfx from '../../../assets/sounds/generated/combo-formula/cf-recipe-complete.mp3'
import cfFeverHitSfx from '../../../assets/sounds/generated/combo-formula/cf-fever-hit.mp3'

const ROUND_DURATION_MS = 30000
const FEVER_DURATION_MS = 10000
const FEVER_DECAY_PER_SECOND = 16
const FEVER_GAIN_ON_CORRECT = 22
const COMBO_KEEP_WINDOW_MS = 3000
const BASE_RECIPE_LENGTH = 2
const MAX_RECIPE_LENGTH = 6
const SCORE_STEP_FOR_COMPLEXITY = 36
const OK_REWARD_PER_TOKEN = 3
const CLEAR_PULSE_DURATION_MS = 420
const WRONG_FLASH_DURATION_MS = 200
const TAP_FEEDBACK_DURATION_MS = 220
const OK_UNLOCK_DURATION_MS = 360
const OK_LOCK_SHAKE_DURATION_MS = 260
const LOW_TIME_THRESHOLD_MS = 5000

const CHARACTER_POOL = [
  { id: 'park-sangmin', name: '박상민', color: '#ef4444', imageSrc: parkSangminImage },
  { id: 'song-changsik', name: '송창식', color: '#22c55e', imageSrc: songChangsikImage },
  { id: 'tae-jina', name: '태진아', color: '#22d3ee', imageSrc: taeJinaImage },
  { id: 'park-wankyu', name: '박완규', color: '#f59e0b', imageSrc: parkWankyuImage },
  { id: 'kim-yeonja', name: '김연자', color: '#ec4899', imageSrc: kimYeonjaImage },
  { id: 'seo-taiji', name: '서태지', color: '#8b5cf6', imageSrc: seoTaijiImage },
] as const

type CharacterToken = (typeof CHARACTER_POOL)[number]
type TapFeedback = { tokenId: CharacterToken['id']; kind: 'good' | 'bad' }

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function pickRandomCharacter(previousId?: string): CharacterToken {
  const candidates = CHARACTER_POOL.filter((token) => token.id !== previousId)
  const source = candidates.length > 0 ? candidates : CHARACTER_POOL
  const randomIndex = Math.floor(Math.random() * source.length)
  return source[randomIndex]
}

function createRecipe(length: number): CharacterToken[] {
  const next: CharacterToken[] = []
  for (let index = 0; index < length; index += 1) {
    const previousId = next[index - 1]?.id
    next.push(pickRandomCharacter(previousId))
  }
  return next
}

function toRecipeLength(score: number, feverMode: boolean): number {
  if (feverMode) {
    return BASE_RECIPE_LENGTH
  }

  return clampNumber(BASE_RECIPE_LENGTH + Math.floor(score / SCORE_STEP_FOR_COMPLEXITY), BASE_RECIPE_LENGTH, MAX_RECIPE_LENGTH)
}

function toComboMultiplier(combo: number): number {
  return 2 ** Math.floor(combo / 10)
}

function ComboFormulaGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [feverGauge, setFeverGauge] = useState(0)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [recipe, setRecipe] = useState<CharacterToken[]>(() => createRecipe(BASE_RECIPE_LENGTH))
  const [progressIndex, setProgressIndex] = useState(0)
  const [recipeElapsedMs, setRecipeElapsedMs] = useState(0)
  const [isWrongFlashActive, setWrongFlashActive] = useState(false)
  const [isClearPulseActive, setClearPulseActive] = useState(false)
  const [tapFeedback, setTapFeedback] = useState<TapFeedback | null>(null)
  const [isOkUnlockActive, setOkUnlockActive] = useState(false)
  const [isOkLockedShakeActive, setOkLockedShakeActive] = useState(false)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const feverGaugeRef = useRef(0)
  const feverRemainingRef = useRef(0)
  const recipeRef = useRef<CharacterToken[]>(recipe)
  const progressIndexRef = useRef(0)
  const recipeStartedAtRef = useRef(0)
  const recipeElapsedRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const wrongFlashTimerRef = useRef<number | null>(null)
  const clearPulseTimerRef = useRef<number | null>(null)
  const tapFeedbackTimerRef = useRef<number | null>(null)
  const okUnlockTimerRef = useRef<number | null>(null)
  const okLockedShakeTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)

  const tapGoodAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapAccentAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapBadAudioRef = useRef<HTMLAudioElement | null>(null)
  const resetAudioRef = useRef<HTMLAudioElement | null>(null)
  const okLockedAudioRef = useRef<HTMLAudioElement | null>(null)
  const okUnlockAudioRef = useRef<HTMLAudioElement | null>(null)
  const okConfirmAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverGainAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboUpAudioRef = useRef<HTMLAudioElement | null>(null)
  const recipeCompleteAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboMilestoneAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverStartAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverEndAudioRef = useRef<HTMLAudioElement | null>(null)
  const lowTimeAlertAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)
  const exitAudioRef = useRef<HTMLAudioElement | null>(null)

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) {
        return
      }

      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const triggerWrongFlash = useCallback(() => {
    setWrongFlashActive(true)
    clearTimeoutSafe(wrongFlashTimerRef)
    wrongFlashTimerRef.current = window.setTimeout(() => {
      wrongFlashTimerRef.current = null
      setWrongFlashActive(false)
    }, WRONG_FLASH_DURATION_MS)
  }, [])

  const triggerClearPulse = useCallback(() => {
    setClearPulseActive(true)
    clearTimeoutSafe(clearPulseTimerRef)
    clearPulseTimerRef.current = window.setTimeout(() => {
      clearPulseTimerRef.current = null
      setClearPulseActive(false)
    }, CLEAR_PULSE_DURATION_MS)
  }, [])

  const triggerTapFeedback = useCallback((tokenId: CharacterToken['id'], kind: TapFeedback['kind']) => {
    setTapFeedback({ tokenId, kind })
    clearTimeoutSafe(tapFeedbackTimerRef)
    tapFeedbackTimerRef.current = window.setTimeout(() => {
      tapFeedbackTimerRef.current = null
      setTapFeedback(null)
    }, TAP_FEEDBACK_DURATION_MS)
  }, [])

  const triggerOkUnlock = useCallback(() => {
    setOkUnlockActive(true)
    clearTimeoutSafe(okUnlockTimerRef)
    okUnlockTimerRef.current = window.setTimeout(() => {
      okUnlockTimerRef.current = null
      setOkUnlockActive(false)
    }, OK_UNLOCK_DURATION_MS)
  }, [])

  const triggerOkLockedShake = useCallback(() => {
    setOkLockedShakeActive(true)
    clearTimeoutSafe(okLockedShakeTimerRef)
    okLockedShakeTimerRef.current = window.setTimeout(() => {
      okLockedShakeTimerRef.current = null
      setOkLockedShakeActive(false)
    }, OK_LOCK_SHAKE_DURATION_MS)
  }, [])

  const syncRecipe = useCallback((nextRecipe: CharacterToken[], now: number) => {
    recipeRef.current = nextRecipe
    setRecipe(nextRecipe)
    progressIndexRef.current = 0
    setProgressIndex(0)
    recipeElapsedRef.current = 0
    setRecipeElapsedMs(0)
    recipeStartedAtRef.current = now
  }, [])

  const syncRecipeByScoreAndMode = useCallback(
    (nextScore: number, feverMode: boolean, now: number) => {
      const nextLength = toRecipeLength(nextScore, feverMode)
      syncRecipe(createRecipe(nextLength), now)
    },
    [syncRecipe],
  )

  const enterFeverMode = useCallback(
    (now: number) => {
      feverGaugeRef.current = 0
      setFeverGauge(0)
      feverRemainingRef.current = FEVER_DURATION_MS
      setFeverRemainingMs(FEVER_DURATION_MS)
      syncRecipeByScoreAndMode(scoreRef.current, true, now)
      triggerClearPulse()
      playAudio(feverStartAudioRef, 0.82, 1.03)
    },
    [playAudio, syncRecipeByScoreAndMode, triggerClearPulse],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(wrongFlashTimerRef)
    clearTimeoutSafe(clearPulseTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const handleCharacterTap = useCallback(
    (token: CharacterToken) => {
      if (finishedRef.current) {
        return
      }

      const expected = recipeRef.current[progressIndexRef.current]
      if (!expected) {
        return
      }

      const now = window.performance.now()
      if (token.id === expected.id) {
        const nextScore = scoreRef.current + 1
        scoreRef.current = nextScore
        setScore(nextScore)

        const nextProgress = progressIndexRef.current + 1
        progressIndexRef.current = nextProgress
        setProgressIndex(nextProgress)

        const progressRatio = nextProgress / recipeRef.current.length
        if (feverRemainingRef.current > 0) {
          playAudio(feverHitAudioRef, 0.5, 1 + progressRatio * 0.1)
        } else if (progressRatio >= 0.6) {
          playAudio(tapAccentAudioRef, 0.48, 1 + progressRatio * 0.14)
        } else {
          playAudio(tapGoodAudioRef, 0.46, 1 + progressRatio * 0.16)
        }
        triggerTapFeedback(token.id, 'good')

        if (feverRemainingRef.current <= 0) {
          const nextGauge = Math.min(100, feverGaugeRef.current + FEVER_GAIN_ON_CORRECT)
          feverGaugeRef.current = nextGauge
          setFeverGauge(nextGauge)
          playAudio(feverGainAudioRef, 0.34, 0.96 + nextGauge * 0.0015)
          if (nextGauge >= 100) {
            enterFeverMode(now)
            return
          }
        }

        if (nextProgress === recipeRef.current.length) {
          triggerOkUnlock()
          playAudio(okUnlockAudioRef, 0.5, 1.08)
          playAudio(recipeCompleteAudioRef, 0.44, 1.04)
        }
        return
      }

      const nextScore = Math.max(0, scoreRef.current - 1)
      scoreRef.current = nextScore
      setScore(nextScore)
      triggerWrongFlash()
      triggerTapFeedback(token.id, 'bad')
      playAudio(tapBadAudioRef, 0.46, 0.94)
    },
    [enterFeverMode, playAudio, triggerOkUnlock, triggerTapFeedback, triggerWrongFlash],
  )

  const handleResetInput = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    progressIndexRef.current = 0
    setProgressIndex(0)
    playAudio(resetAudioRef, 0.4, 1)
  }, [playAudio])

  const handleConfirm = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    if (progressIndexRef.current !== recipeRef.current.length) {
      triggerOkLockedShake()
      playAudio(okLockedAudioRef, 0.44, 1)
      return
    }

    const now = window.performance.now()
    const solveDurationMs = now - recipeStartedAtRef.current
    const isComboKept = solveDurationMs <= COMBO_KEEP_WINDOW_MS
    const nextCombo = isComboKept ? comboRef.current + 1 : 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    const comboMultiplier = toComboMultiplier(nextCombo)
    const okReward = recipeRef.current.length * OK_REWARD_PER_TOKEN * comboMultiplier
    const nextScore = scoreRef.current + okReward
    scoreRef.current = nextScore
    setScore(nextScore)

    triggerClearPulse()
    playAudio(okConfirmAudioRef, 0.62, 1 + Math.min(0.16, comboMultiplier * 0.015))
    playAudio(comboUpAudioRef, 0.48, 1 + Math.min(0.22, nextCombo * 0.008))
    if (nextCombo > 0 && nextCombo % 10 === 0) {
      playAudio(comboMilestoneAudioRef, 0.54, 1)
    }

    syncRecipeByScoreAndMode(nextScore, feverRemainingRef.current > 0, now)
  }, [playAudio, syncRecipeByScoreAndMode, triggerClearPulse, triggerOkLockedShake])

  const handleExit = useCallback(() => {
    playAudio(exitAudioRef, 0.42, 1.02)
    onExit()
  }, [onExit, playAudio])

  useEffect(() => {
    for (const token of CHARACTER_POOL) {
      const image = new Image()
      image.decoding = 'sync'
      image.src = token.imageSrc
      void image.decode?.().catch(() => {})
    }

    const tapGoodAudio = new Audio(cfTapGoodSfx)
    tapGoodAudio.preload = 'auto'
    tapGoodAudioRef.current = tapGoodAudio

    const tapAccentAudio = new Audio(cfTapAccentSfx)
    tapAccentAudio.preload = 'auto'
    tapAccentAudioRef.current = tapAccentAudio

    const tapBadAudio = new Audio(cfTapBadSfx)
    tapBadAudio.preload = 'auto'
    tapBadAudioRef.current = tapBadAudio

    const resetAudio = new Audio(cfResetSfx)
    resetAudio.preload = 'auto'
    resetAudioRef.current = resetAudio

    const okLockedAudio = new Audio(cfOkLockedSfx)
    okLockedAudio.preload = 'auto'
    okLockedAudioRef.current = okLockedAudio

    const okUnlockAudio = new Audio(cfOkUnlockSfx)
    okUnlockAudio.preload = 'auto'
    okUnlockAudioRef.current = okUnlockAudio

    const okConfirmAudio = new Audio(cfOkConfirmSfx)
    okConfirmAudio.preload = 'auto'
    okConfirmAudioRef.current = okConfirmAudio

    const feverGainAudio = new Audio(cfFeverGainSfx)
    feverGainAudio.preload = 'auto'
    feverGainAudioRef.current = feverGainAudio

    const feverHitAudio = new Audio(cfFeverHitSfx)
    feverHitAudio.preload = 'auto'
    feverHitAudioRef.current = feverHitAudio

    const comboUpAudio = new Audio(cfComboUpSfx)
    comboUpAudio.preload = 'auto'
    comboUpAudioRef.current = comboUpAudio

    const recipeCompleteAudio = new Audio(cfRecipeCompleteSfx)
    recipeCompleteAudio.preload = 'auto'
    recipeCompleteAudioRef.current = recipeCompleteAudio

    const comboMilestoneAudio = new Audio(cfComboMilestoneSfx)
    comboMilestoneAudio.preload = 'auto'
    comboMilestoneAudioRef.current = comboMilestoneAudio

    const feverStartAudio = new Audio(cfFeverStartSfx)
    feverStartAudio.preload = 'auto'
    feverStartAudioRef.current = feverStartAudio

    const feverEndAudio = new Audio(cfFeverEndSfx)
    feverEndAudio.preload = 'auto'
    feverEndAudioRef.current = feverEndAudio

    const lowTimeAudio = new Audio(cfLowTimeSfx)
    lowTimeAudio.preload = 'auto'
    lowTimeAlertAudioRef.current = lowTimeAudio

    const gameOverAudio = new Audio(cfGameOverSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    const exitAudio = new Audio(cfExitSfx)
    exitAudio.preload = 'auto'
    exitAudioRef.current = exitAudio

    return () => {
      clearTimeoutSafe(wrongFlashTimerRef)
      clearTimeoutSafe(clearPulseTimerRef)
      clearTimeoutSafe(tapFeedbackTimerRef)
      clearTimeoutSafe(okUnlockTimerRef)
      clearTimeoutSafe(okLockedShakeTimerRef)
      tapGoodAudioRef.current = null
      tapAccentAudioRef.current = null
      tapBadAudioRef.current = null
      resetAudioRef.current = null
      okLockedAudioRef.current = null
      okUnlockAudioRef.current = null
      okConfirmAudioRef.current = null
      feverGainAudioRef.current = null
      feverHitAudioRef.current = null
      comboUpAudioRef.current = null
      recipeCompleteAudioRef.current = null
      comboMilestoneAudioRef.current = null
      feverStartAudioRef.current = null
      feverEndAudioRef.current = null
      lowTimeAlertAudioRef.current = null
      gameOverAudioRef.current = null
      exitAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    recipeStartedAtRef.current = window.performance.now()

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

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(lowTimeAlertAudioRef, 0.3, 1 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 11000)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (feverRemainingRef.current > 0) {
        const previousFeverMs = feverRemainingRef.current
        const nextFeverMs = Math.max(0, previousFeverMs - deltaMs)
        feverRemainingRef.current = nextFeverMs
        setFeverRemainingMs(nextFeverMs)

        if (previousFeverMs > 0 && nextFeverMs === 0) {
          playAudio(feverEndAudioRef, 0.64, 0.92)
          syncRecipeByScoreAndMode(scoreRef.current, false, now)
        }
      } else {
        const nextGauge = Math.max(0, feverGaugeRef.current - FEVER_DECAY_PER_SECOND * (deltaMs / 1000))
        feverGaugeRef.current = nextGauge
        setFeverGauge(nextGauge)
      }

      recipeElapsedRef.current = now - recipeStartedAtRef.current
      setRecipeElapsedMs(recipeElapsedRef.current)

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
  }, [finishGame, playAudio, syncRecipeByScoreAndMode])

  const isFeverMode = feverRemainingMs > 0
  const isRecipeSolved = progressIndex === recipe.length
  const comboWindowRemainingMs = Math.max(0, COMBO_KEEP_WINDOW_MS - recipeElapsedMs)
  const nextComboPreview = isRecipeSolved ? (comboWindowRemainingMs > 0 ? combo + 1 : 1) : combo
  const comboMultiplier = toComboMultiplier(combo)
  const okRewardPreview = recipe.length * OK_REWARD_PER_TOKEN * toComboMultiplier(nextComboPreview)
  const feverGaugePercent = clampNumber(feverGauge, 0, 100)
  const feverTimePercent = (feverRemainingMs / FEVER_DURATION_MS) * 100
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const difficultyLabel = `${recipe.length}칸`
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS

  return (
    <section className="mini-game-panel combo-formula-panel" aria-label="combo-formula-game">
      <div className="combo-formula-score-strip">
        <p className="combo-formula-score">{score.toLocaleString()}</p>
        <p className="combo-formula-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`combo-formula-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="combo-formula-meta-row">
        <p className="combo-formula-combo">
          COMBO <strong>{combo}</strong>
        </p>
        <p className="combo-formula-multiplier">
          배수 <strong>x{comboMultiplier}</strong>
        </p>
        <p className="combo-formula-difficulty">
          조합 <strong>{difficultyLabel}</strong>
        </p>
      </div>

      <div className={`combo-formula-gauge ${isFeverMode ? 'fever' : ''} ${isLowTime ? 'low-time' : ''}`} role="presentation">
        <div
          className="combo-formula-gauge-fill"
          style={{
            width: `${isFeverMode ? feverTimePercent : feverGaugePercent}%`,
          }}
        />
        <p className="combo-formula-gauge-label">{isFeverMode ? `피버 ${Math.max(0, feverRemainingMs / 1000).toFixed(1)}s` : '피버 게이지'}</p>
      </div>

      <div
        className={`combo-formula-arena ${isFeverMode ? 'fever' : ''} ${isWrongFlashActive ? 'miss' : ''} ${isClearPulseActive ? 'clear' : ''}`}
      >
        <div className="combo-formula-recipe-board">
          <div className="combo-formula-recipe-row">
            {recipe.map((token, index) => {
              const isDone = index < progressIndex
              const isCurrent = index === progressIndex
              const isTapFeedbackTarget = tapFeedback?.tokenId === token.id
              const tapFeedbackClass = isTapFeedbackTarget ? `tap-${tapFeedback.kind}` : ''
              return (
                <div className="combo-formula-recipe-flow-item" key={`recipe-slot-${token.id}-${index}`}>
                  <div className={`combo-formula-recipe-slot ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${tapFeedbackClass}`}>
                    <img className="combo-formula-avatar" src={token.imageSrc} alt={token.name} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="combo-formula-button-grid">
        {CHARACTER_POOL.map((token) => (
          <button
            className={`combo-formula-char-button ${
              tapFeedback?.tokenId === token.id ? (tapFeedback.kind === 'good' ? 'hit-good' : 'hit-bad') : ''
            }`}
            key={token.id}
            type="button"
            onClick={() => handleCharacterTap(token)}
            disabled={isRecipeSolved}
          >
            <img src={token.imageSrc} alt={token.name} />
          </button>
        ))}
      </div>

      <div className="combo-formula-actions">
        <button className="combo-formula-reset" type="button" onClick={handleResetInput}>
          입력 초기화
        </button>
        <button
          className={`combo-formula-ok ${isRecipeSolved ? 'open' : 'locked'} ${
            isOkUnlockActive ? 'unlock-burst' : ''
          } ${isOkLockedShakeActive ? 'locked-shake' : ''}`}
          type="button"
          onClick={handleConfirm}
          aria-disabled={!isRecipeSolved}
        >
          {isRecipeSolved ? `OK +${okRewardPreview}` : 'OK 잠김'}
        </button>
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const comboFormulaModule: MiniGameModule = {
  manifest: {
    id: 'combo-formula',
    title: 'Combine',
    description: '제시된 캐릭터 조합을 순서대로 입력하고 OK로 확정해 콤보와 피버를 이어가는 게임',
    unlockCost: 180,
    baseReward: 26,
    scoreRewardMultiplier: 0.85,
    accentColor: '#06b6d4',
  },
  Component: ComboFormulaGame,
}
