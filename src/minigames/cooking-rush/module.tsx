import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import chefImg from '../../../assets/images/cooking-rush/chef-character.png'
import meatImg from '../../../assets/images/cooking-rush/ingredient-meat.png'
import veggieImg from '../../../assets/images/cooking-rush/ingredient-veggie.png'
import sauceImg from '../../../assets/images/cooking-rush/ingredient-sauce.png'
import riceImg from '../../../assets/images/cooking-rush/ingredient-rice.png'
import eggImg from '../../../assets/images/cooking-rush/ingredient-egg.png'
import kimchiImg from '../../../assets/images/cooking-rush/ingredient-kimchi.png'
import sizzleSfx from '../../../assets/sounds/cooking-rush-sizzle.mp3'
import dishDoneSfx from '../../../assets/sounds/cooking-rush-dish-done.mp3'
import wrongSfx from '../../../assets/sounds/cooking-rush-wrong.mp3'
import feverSfx from '../../../assets/sounds/cooking-rush-fever.mp3'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 5000
const WRONG_SHAKE_DURATION_MS = 300
const CLEAR_CELEBRATION_DURATION_MS = 500
const TAP_FEEDBACK_DURATION_MS = 180
const BASE_RECIPE_LENGTH = 3
const MAX_RECIPE_LENGTH = 7
const SCORE_STEP_FOR_COMPLEXITY = 3
const COMBO_KEEP_WINDOW_MS = 4000
const BASE_DISH_SCORE = 10
const COMBO_BONUS_PER_STACK = 5

// --- Gimmick constants ---
const VIP_ORDER_CHANCE = 0.15
const VIP_SCORE_MULTIPLIER = 3
const ORDER_TIMER_BASE_MS = 15000
const ORDER_TIMER_MIN_MS = 6000
const ORDER_TIMER_SHRINK_PER_DISH = 300
const TIMER_FAIL_PENALTY = 10
const FEVER_COMBO_THRESHOLD = 5
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 2
const PERFECT_BONUS = 5

// --- New feature constants ---
const POWERUP_CHANCE = 0.12
const TIME_BONUS_MS = 5000
const DOUBLE_SCORE_DURATION_MS = 8000
const FREEZE_DURATION_MS = 5000
const STREAK_MILESTONE = 10
const STREAK_BONUS = 50

type PowerUpType = 'time-bonus' | 'double-score' | 'freeze-timer' | 'auto-fill'
const POWERUP_TYPES: PowerUpType[] = ['time-bonus', 'double-score', 'freeze-timer', 'auto-fill']
const POWERUP_EMOJI: Record<PowerUpType, string> = {
  'time-bonus': '\u{23F0}',
  'double-score': '\u{1F4B0}',
  'freeze-timer': '\u{2744}\u{FE0F}',
  'auto-fill': '\u{2728}',
}

interface Ingredient {
  readonly name: string
  readonly img: string
}

const INGREDIENTS: readonly Ingredient[] = [
  { name: 'Meat', img: meatImg },
  { name: 'Veggie', img: veggieImg },
  { name: 'Sauce', img: sauceImg },
  { name: 'Rice', img: riceImg },
  { name: 'Egg', img: eggImg },
  { name: 'Kimchi', img: kimchiImg },
] as const

function pickRandomIngredient(previousIndex?: number): number {
  const candidates = INGREDIENTS.map((_, index) => index).filter((index) => index !== previousIndex)
  const source = candidates.length > 0 ? candidates : INGREDIENTS.map((_, index) => index)
  return source[Math.floor(Math.random() * source.length)]
}

function createRecipe(length: number): number[] {
  const recipe: number[] = []
  for (let i = 0; i < length; i += 1) {
    recipe.push(pickRandomIngredient(recipe[i - 1]))
  }
  return recipe
}

function toRecipeLength(dishesCompleted: number): number {
  return Math.min(MAX_RECIPE_LENGTH, BASE_RECIPE_LENGTH + Math.floor(dishesCompleted / SCORE_STEP_FOR_COMPLEXITY))
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getOrderTimerMs(dishesCompleted: number): number {
  return Math.max(ORDER_TIMER_MIN_MS, ORDER_TIMER_BASE_MS - dishesCompleted * ORDER_TIMER_SHRINK_PER_DISH)
}

function CookingRushGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [dishesCompleted, setDishesCompleted] = useState(0)
  const [recipe, setRecipe] = useState<number[]>(() => createRecipe(BASE_RECIPE_LENGTH))
  const [progressIndex, setProgressIndex] = useState(0)
  const [isWrongShakeActive, setWrongShakeActive] = useState(false)
  const [isClearActive, setClearActive] = useState(false)
  const [tapFeedbackIndex, setTapFeedbackIndex] = useState<number | null>(null)
  const [tapFeedbackKind, setTapFeedbackKind] = useState<'good' | 'bad'>('good')
  const [isVipOrder, setIsVipOrder] = useState(false)
  const [orderTimerMs, setOrderTimerMs] = useState(ORDER_TIMER_BASE_MS)
  const [orderRemainingMs, setOrderRemainingMs] = useState(ORDER_TIMER_BASE_MS)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [perfectCount, setPerfectCount] = useState(0)
  const [lastDishText, setLastDishText] = useState('')
  const [activePowerUp, setActivePowerUp] = useState<PowerUpType | null>(null)
  const [powerUpMs, setPowerUpMs] = useState(0)
  const [isDoubleScore, setIsDoubleScore] = useState(false)
  const [isFreezeTimer, setIsFreezeTimer] = useState(false)
  const [streak, setStreak] = useState(0)
  const [showStreakBanner, setShowStreakBanner] = useState(false)
  const [screenFlashColor, setScreenFlashColor] = useState('')

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const dishesCompletedRef = useRef(0)
  const recipeRef = useRef<number[]>(recipe)
  const progressIndexRef = useRef(0)
  const lastDishTimeRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const wrongShakeTimerRef = useRef<number | null>(null)
  const clearTimerRef = useRef<number | null>(null)
  const tapFeedbackTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)
  const isVipOrderRef = useRef(false)
  const orderRemainingMsRef = useRef(ORDER_TIMER_BASE_MS)
  const orderTimerMsRef = useRef(ORDER_TIMER_BASE_MS)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const perfectCountRef = useRef(0)
  const dishTextTimerRef = useRef<number | null>(null)
  const isDoubleScoreRef = useRef(false)
  const doubleScoreMsRef = useRef(0)
  const isFreezeTimerRef = useRef(false)
  const freezeMsRef = useRef(0)
  const streakRef = useRef(0)
  const streakBannerTimerRef = useRef<number | null>(null)
  const screenFlashTimerRef = useRef<number | null>(null)

  const sizzleAudioRef = useRef<HTMLAudioElement | null>(null)
  const dishDoneAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
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
      audio.volume = clampNumber(volume, 0, 1)
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const triggerScreenFlash = useCallback((color: string, durationMs = 300) => {
    setScreenFlashColor(color)
    clearTimeoutSafe(screenFlashTimerRef)
    screenFlashTimerRef.current = window.setTimeout(() => {
      screenFlashTimerRef.current = null
      setScreenFlashColor('')
    }, durationMs)
  }, [])

  const showDishText = useCallback((text: string) => {
    setLastDishText(text)
    clearTimeoutSafe(dishTextTimerRef)
    dishTextTimerRef.current = window.setTimeout(() => {
      dishTextTimerRef.current = null
      setLastDishText('')
    }, 1200)
  }, [])

  const triggerWrongShake = useCallback(() => {
    setWrongShakeActive(true)
    clearTimeoutSafe(wrongShakeTimerRef)
    wrongShakeTimerRef.current = window.setTimeout(() => {
      wrongShakeTimerRef.current = null
      setWrongShakeActive(false)
    }, WRONG_SHAKE_DURATION_MS)
  }, [])

  const triggerClear = useCallback(() => {
    setClearActive(true)
    clearTimeoutSafe(clearTimerRef)
    clearTimerRef.current = window.setTimeout(() => {
      clearTimerRef.current = null
      setClearActive(false)
    }, CLEAR_CELEBRATION_DURATION_MS)
  }, [])

  const triggerTapFeedback = useCallback((ingredientIndex: number, kind: 'good' | 'bad') => {
    setTapFeedbackIndex(ingredientIndex)
    setTapFeedbackKind(kind)
    clearTimeoutSafe(tapFeedbackTimerRef)
    tapFeedbackTimerRef.current = window.setTimeout(() => {
      tapFeedbackTimerRef.current = null
      setTapFeedbackIndex(null)
    }, TAP_FEEDBACK_DURATION_MS)
  }, [])

  const applyPowerUp = useCallback((type: PowerUpType) => {
    setActivePowerUp(type)
    switch (type) {
      case 'time-bonus':
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
        setRemainingMs(remainingMsRef.current)
        showDishText(`+${TIME_BONUS_MS / 1000}s!`)
        triggerScreenFlash('rgba(34,197,94,0.4)')
        break
      case 'double-score':
        isDoubleScoreRef.current = true
        doubleScoreMsRef.current = DOUBLE_SCORE_DURATION_MS
        setIsDoubleScore(true)
        setPowerUpMs(DOUBLE_SCORE_DURATION_MS)
        showDishText('DOUBLE SCORE!')
        triggerScreenFlash('rgba(250,204,21,0.4)')
        break
      case 'freeze-timer':
        isFreezeTimerRef.current = true
        freezeMsRef.current = FREEZE_DURATION_MS
        setIsFreezeTimer(true)
        setPowerUpMs(FREEZE_DURATION_MS)
        showDishText('TIME FREEZE!')
        triggerScreenFlash('rgba(96,165,250,0.4)')
        break
      case 'auto-fill':
        if (progressIndexRef.current < recipeRef.current.length) {
          progressIndexRef.current += 1
          setProgressIndex(progressIndexRef.current)
          showDishText('AUTO!')
          triggerScreenFlash('rgba(168,85,247,0.4)')
        }
        break
    }
    window.setTimeout(() => setActivePowerUp(null), 1500)
  }, [showDishText, triggerScreenFlash])

  const startNewRecipe = useCallback((dishes: number, now: number) => {
    const nextLength = toRecipeLength(dishes)
    const nextRecipe = createRecipe(nextLength)
    recipeRef.current = nextRecipe
    setRecipe(nextRecipe)
    progressIndexRef.current = 0
    setProgressIndex(0)
    lastDishTimeRef.current = now

    const nextIsVip = Math.random() < VIP_ORDER_CHANCE + dishes * 0.01
    isVipOrderRef.current = nextIsVip
    setIsVipOrder(nextIsVip)

    const timerMs = getOrderTimerMs(dishes)
    orderTimerMsRef.current = timerMs
    orderRemainingMsRef.current = timerMs
    setOrderTimerMs(timerMs)
    setOrderRemainingMs(timerMs)

    if (Math.random() < POWERUP_CHANCE && dishes > 2) {
      const type = POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)]
      window.setTimeout(() => applyPowerUp(type), 200)
    }
  }, [applyPowerUp])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(wrongShakeTimerRef)
    clearTimeoutSafe(clearTimerRef)
    clearTimeoutSafe(tapFeedbackTimerRef)
    clearTimeoutSafe(dishTextTimerRef)
    clearTimeoutSafe(streakBannerTimerRef)
    clearTimeoutSafe(screenFlashTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const handleIngredientTap = useCallback(
    (ingredientIndex: number) => {
      if (finishedRef.current) return

      const expected = recipeRef.current[progressIndexRef.current]
      if (expected === undefined) return

      const now = window.performance.now()

      if (ingredientIndex === expected) {
        const nextProgress = progressIndexRef.current + 1
        progressIndexRef.current = nextProgress
        setProgressIndex(nextProgress)

        triggerTapFeedback(ingredientIndex, 'good')
        const progressRatio = nextProgress / recipeRef.current.length
        playAudio(sizzleAudioRef, 0.5, 1 + progressRatio * 0.15)

        if (nextProgress === recipeRef.current.length) {
          const timeSinceLastDish = now - lastDishTimeRef.current
          const isComboKept = timeSinceLastDish <= COMBO_KEEP_WINDOW_MS
          const nextCombo = isComboKept ? comboRef.current + 1 : 1
          comboRef.current = nextCombo
          setCombo(nextCombo)

          const nextDishes = dishesCompletedRef.current + 1
          dishesCompletedRef.current = nextDishes
          setDishesCompleted(nextDishes)

          streakRef.current += 1
          setStreak(streakRef.current)
          if (streakRef.current > 0 && streakRef.current % STREAK_MILESTONE === 0) {
            const streakBonus = STREAK_BONUS
            scoreRef.current += streakBonus
            setScore(scoreRef.current)
            setShowStreakBanner(true)
            clearTimeoutSafe(streakBannerTimerRef)
            streakBannerTimerRef.current = window.setTimeout(() => {
              streakBannerTimerRef.current = null
              setShowStreakBanner(false)
            }, 1500)
          }

          if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
            isFeverRef.current = true
            feverMsRef.current = FEVER_DURATION_MS
            setIsFever(true)
            setFeverMs(FEVER_DURATION_MS)
            playAudio(feverAudioRef, 0.6, 1)
            triggerScreenFlash('rgba(239,68,68,0.5)')
          }

          const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
          const vipMult = isVipOrderRef.current ? VIP_SCORE_MULTIPLIER : 1
          const doubleMult = isDoubleScoreRef.current ? 2 : 1

          const isPerfect = true
          let perfectBonus = 0
          if (isPerfect) {
            perfectCountRef.current += 1
            setPerfectCount(perfectCountRef.current)
            perfectBonus = PERFECT_BONUS
          }

          const dishScore = Math.round((BASE_DISH_SCORE + (nextCombo - 1) * COMBO_BONUS_PER_STACK + perfectBonus) * vipMult * feverMult * doubleMult)
          const nextScore = scoreRef.current + dishScore
          scoreRef.current = nextScore
          setScore(nextScore)

          const parts: string[] = [`+${dishScore}`]
          if (isVipOrderRef.current) parts.push('VIP!')
          if (isFeverRef.current) parts.push('FEVER!')
          if (isPerfect) parts.push('PERFECT!')
          if (isDoubleScoreRef.current) parts.push('x2!')
          showDishText(parts.join(' '))

          triggerClear()
          effects.triggerFlash()
          effects.spawnParticles(6, 200, 300)
          playAudio(dishDoneAudioRef, 0.7, 1 + Math.min(0.3, nextCombo * 0.03))

          window.setTimeout(() => {
            if (!finishedRef.current) {
              startNewRecipe(nextDishes, window.performance.now())
            }
          }, CLEAR_CELEBRATION_DURATION_MS)
        }
        return
      }

      // Wrong ingredient
      triggerWrongShake()
      triggerTapFeedback(ingredientIndex, 'bad')
      effects.triggerShake(4)
      effects.triggerFlash('rgba(239,68,68,0.4)')
      playAudio(wrongAudioRef, 0.5, 1)

      streakRef.current = 0
      setStreak(0)
      progressIndexRef.current = 0
      setProgressIndex(0)
    },
    [playAudio, triggerClear, triggerTapFeedback, triggerWrongShake, startNewRecipe, showDishText, triggerScreenFlash],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  useEffect(() => {
    const audios = [
      { ref: sizzleAudioRef, src: sizzleSfx },
      { ref: dishDoneAudioRef, src: dishDoneSfx },
      { ref: wrongAudioRef, src: wrongSfx },
      { ref: feverAudioRef, src: feverSfx },
      { ref: tapHitAudioRef, src: tapHitSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
    ]
    audios.forEach(({ ref, src }) => {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    })

    return () => {
      clearTimeoutSafe(wrongShakeTimerRef)
      clearTimeoutSafe(clearTimerRef)
      clearTimeoutSafe(tapFeedbackTimerRef)
      clearTimeoutSafe(dishTextTimerRef)
      clearTimeoutSafe(streakBannerTimerRef)
      clearTimeoutSafe(screenFlashTimerRef)
      effects.cleanup()
      audios.forEach(({ ref }) => { ref.current = null })
    }
  }, [])

  useEffect(() => {
    lastDishTimeRef.current = window.performance.now()
    orderRemainingMsRef.current = ORDER_TIMER_BASE_MS

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

      if (!isFreezeTimerRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
        setRemainingMs(remainingMsRef.current)
      }

      if (!isFreezeTimerRef.current) {
        orderRemainingMsRef.current = Math.max(0, orderRemainingMsRef.current - deltaMs)
        setOrderRemainingMs(orderRemainingMsRef.current)
      }

      if (orderRemainingMsRef.current <= 0 && !finishedRef.current) {
        scoreRef.current = Math.max(0, scoreRef.current - TIMER_FAIL_PENALTY)
        setScore(scoreRef.current)
        comboRef.current = 0
        setCombo(0)
        streakRef.current = 0
        setStreak(0)
        showDishText(`-${TIMER_FAIL_PENALTY} Time out!`)
        playAudio(wrongAudioRef, 0.4, 0.8)
        startNewRecipe(dishesCompletedRef.current, window.performance.now())
      }

      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      if (isDoubleScoreRef.current) {
        doubleScoreMsRef.current = Math.max(0, doubleScoreMsRef.current - deltaMs)
        setPowerUpMs(doubleScoreMsRef.current)
        if (doubleScoreMsRef.current <= 0) {
          isDoubleScoreRef.current = false
          setIsDoubleScore(false)
        }
      }

      if (isFreezeTimerRef.current) {
        freezeMsRef.current = Math.max(0, freezeMsRef.current - deltaMs)
        setPowerUpMs(freezeMsRef.current)
        if (freezeMsRef.current <= 0) {
          isFreezeTimerRef.current = false
          setIsFreezeTimer(false)
        }
      }

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(tapHitAudioRef, 0.25, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 8000)
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
    }
  }, [finishGame, playAudio, startNewRecipe, showDishText])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const recipeLength = recipe.length
  const orderTimerRatio = orderTimerMs > 0 ? orderRemainingMs / orderTimerMs : 0

  return (
    <section className="mini-game-panel cr-panel" aria-label="cooking-rush-game" style={{ position: 'relative', maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}

        .cr-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background:
            repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.015) 3px, rgba(0,0,0,0.015) 4px),
            linear-gradient(180deg, #78350f 0%, #92400e 6%, #f5f4ef 22%, #ede9df 100%);
          font-family: 'Press Start 2P', 'Courier New', monospace;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          image-rendering: pixelated;
        }

        .cr-screen-flash {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 100;
          animation: cr-flash-fade 0.3s steps(4) forwards;
        }

        @keyframes cr-flash-fade {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        /* ---- HEADER: centered score ---- */
        .cr-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 14px 16px 10px;
          background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(120,53,15,0.85) 100%);
          border-bottom: 4px solid #d97706;
        }

        .cr-score {
          margin: 0;
          font-size: clamp(36px, 10vw, 52px);
          font-weight: 900;
          color: #fef3c7;
          text-shadow: 4px 4px 0 rgba(0,0,0,0.5);
          letter-spacing: 3px;
          line-height: 1;
        }

        .cr-header-sub {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-top: 4px;
        }

        .cr-best {
          margin: 0;
          font-size: 8px;
          font-weight: 700;
          color: rgba(254,243,199,0.5);
          letter-spacing: 1px;
        }

        .cr-time {
          margin: 0;
          font-size: clamp(16px, 4.5vw, 22px);
          font-weight: 900;
          color: #fef3c7;
          font-variant-numeric: tabular-nums;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.4);
        }

        .cr-time.low-time {
          color: #f87171;
          animation: cr-blink 0.4s steps(2) infinite;
        }

        @keyframes cr-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* ---- STATS BAR ---- */
        .cr-stats-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 8px 12px;
          background: rgba(120,53,15,0.1);
          border-bottom: 2px solid rgba(120,53,15,0.15);
        }

        .cr-chef-img {
          width: clamp(44px, 12vw, 56px);
          height: clamp(44px, 12vw, 56px);
          border: 3px solid #d97706;
          box-shadow: 3px 3px 0 rgba(0,0,0,0.3);
          image-rendering: pixelated;
          object-fit: cover;
        }

        .cr-chef-img.cooking {
          animation: cr-chef-cook 0.4s steps(4);
        }

        @keyframes cr-chef-cook {
          0%, 100% { transform: rotate(0deg); }
          25% { transform: rotate(-8deg); }
          75% { transform: rotate(8deg); }
        }

        .cr-stat {
          font-size: clamp(9px, 2.5vw, 12px);
          font-weight: 900;
          color: #78350f;
          letter-spacing: 1px;
        }

        .cr-stat strong {
          font-size: clamp(12px, 3.5vw, 16px);
          color: #ea580c;
        }

        /* ---- BANNERS ---- */
        .cr-fever-banner {
          text-align: center;
          font-size: clamp(18px, 5vw, 24px);
          font-weight: 900;
          color: #fff;
          margin: 0;
          padding: 8px 0;
          background: repeating-linear-gradient(90deg, #ef4444 0px, #ef4444 8px, #f97316 8px, #f97316 16px);
          background-size: 16px 100%;
          animation: cr-fever-scroll 0.3s linear infinite;
          text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
          letter-spacing: 4px;
          border-top: 3px solid #fbbf24;
          border-bottom: 3px solid #fbbf24;
        }

        @keyframes cr-fever-scroll {
          0% { background-position: 0 0; }
          100% { background-position: 16px 0; }
        }

        .cr-powerup-banner {
          text-align: center;
          font-size: clamp(14px, 3.5vw, 18px);
          font-weight: 900;
          margin: 0;
          padding: 6px 0;
          color: #7c3aed;
          background: rgba(124,58,237,0.1);
          border: 2px solid rgba(124,58,237,0.2);
          letter-spacing: 2px;
          animation: cr-powerup-glow 0.5s steps(3) infinite alternate;
        }

        @keyframes cr-powerup-glow {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }

        .cr-streak-banner {
          text-align: center;
          font-size: clamp(20px, 5vw, 28px);
          font-weight: 900;
          margin: 0;
          padding: 8px 0;
          color: #fff;
          background: linear-gradient(135deg, #f59e0b, #ef4444);
          animation: cr-streak-pop 0.5s steps(4);
          text-shadow: 3px 3px 0 rgba(0,0,0,0.4);
          letter-spacing: 3px;
        }

        @keyframes cr-streak-pop {
          0% { transform: scaleY(0); opacity: 0; }
          50% { transform: scaleY(1.1); }
          100% { transform: scaleY(1); opacity: 1; }
        }

        .cr-dish-text {
          text-align: center;
          font-size: clamp(22px, 6vw, 30px);
          font-weight: 900;
          color: #ea580c;
          margin: 0;
          padding: 4px 0;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.15);
          animation: cr-bonus-pop 0.4s steps(4);
          letter-spacing: 2px;
        }

        @keyframes cr-bonus-pop {
          0% { transform: scale(0.5) translateY(8px); opacity: 0; }
          60% { transform: scale(1.15) translateY(-2px); }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        /* ---- RECIPE AREA ---- */
        .cr-recipe-area {
          margin: 8px 12px;
          padding: 12px 14px;
          background: #fefce8;
          border: 3px solid #1a1a2e;
          box-shadow: 4px 4px 0 rgba(0,0,0,0.25);
          transition: all 0.15s steps(3);
        }

        .cr-recipe-area.shake {
          animation: cr-shake 0.3s steps(4);
        }

        .cr-recipe-area.clear-celebration {
          background: #fef08a;
          border-color: #facc15;
          box-shadow: 0 0 20px rgba(250,204,21,0.6), 4px 4px 0 rgba(0,0,0,0.2);
        }

        .cr-recipe-area.vip-order {
          border: 3px solid #fbbf24;
          box-shadow: 0 0 16px rgba(251,191,36,0.5), 4px 4px 0 rgba(0,0,0,0.2);
          background: linear-gradient(135deg, #fffbeb, #fef3c7);
        }

        .cr-recipe-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }

        .cr-recipe-label {
          margin: 0;
          font-size: clamp(10px, 3vw, 14px);
          font-weight: 900;
          color: #78350f;
          letter-spacing: 2px;
        }

        .cr-order-timer {
          width: 80px;
          height: 10px;
          background: #1a1a2e;
          border: 2px solid #78350f;
          overflow: hidden;
        }

        .cr-order-timer-fill {
          height: 100%;
          transition: width 0.1s steps(4);
        }

        .cr-recipe-slots {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .cr-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 6px 8px;
          background: #f3f4f6;
          border: 3px solid #1a1a2e;
          transition: all 0.15s steps(3);
          min-width: 48px;
        }

        .cr-slot.done {
          background: #bbf7d0;
          border-color: #16a34a;
          transform: scale(0.92);
        }

        .cr-slot.current {
          background: #fef3c7;
          border-color: #f59e0b;
          box-shadow: 0 0 10px rgba(245,158,11,0.5), 3px 3px 0 rgba(0,0,0,0.2);
          transform: scale(1.08);
          animation: cr-slot-bounce 0.5s steps(3) infinite alternate;
        }

        @keyframes cr-slot-bounce {
          from { transform: scale(1.06); }
          to { transform: scale(1.12); }
        }

        .cr-slot.complete {
          background: #86efac;
          border-color: #16a34a;
        }

        .cr-slot-img {
          width: clamp(28px, 7vw, 36px);
          height: clamp(28px, 7vw, 36px);
          image-rendering: pixelated;
          object-fit: contain;
        }

        .cr-slot-name {
          font-size: clamp(7px, 2vw, 9px);
          font-weight: 900;
          color: #6b7280;
          letter-spacing: 1px;
        }

        .cr-progress-bar {
          margin-top: 10px;
          height: 8px;
          background: #1a1a2e;
          border: 2px solid #78350f;
          overflow: hidden;
        }

        .cr-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #16a34a);
          transition: width 0.15s steps(6);
        }

        /* ---- INGREDIENT GRID ---- */
        .cr-ingredient-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          padding: 10px 14px;
          align-content: center;
          min-height: 0;
        }

        .cr-ingredient-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: clamp(10px, 2.5vw, 16px) 6px;
          border: 3px solid #1a1a2e;
          background: linear-gradient(180deg, #fff, #f5f4ef);
          cursor: pointer;
          transition: all 0.05s steps(2);
          box-shadow: 4px 4px 0 rgba(0,0,0,0.25);
          touch-action: manipulation;
          image-rendering: pixelated;
        }

        .cr-ingredient-btn:active {
          transform: translate(3px, 3px);
          box-shadow: 1px 1px 0 rgba(0,0,0,0.25);
        }

        .cr-ingredient-btn.tap-good {
          background: linear-gradient(180deg, #bbf7d0, #86efac);
          border-color: #16a34a;
          box-shadow: 0 0 12px rgba(34,197,94,0.5), 3px 3px 0 rgba(0,0,0,0.2);
          transform: translate(2px, 2px);
        }

        .cr-ingredient-btn.tap-bad {
          background: linear-gradient(180deg, #fecaca, #fca5a5);
          border-color: #ef4444;
          box-shadow: 0 0 12px rgba(239,68,68,0.4), 3px 3px 0 rgba(0,0,0,0.2);
          animation: cr-shake 0.2s steps(4);
        }

        .cr-ingredient-btn:disabled {
          opacity: 0.35;
          cursor: default;
        }

        .cr-ingredient-img {
          width: clamp(44px, 11vw, 60px);
          height: clamp(44px, 11vw, 60px);
          image-rendering: pixelated;
          object-fit: contain;
          filter: drop-shadow(2px 2px 0 rgba(0,0,0,0.2));
        }

        .cr-ingredient-name {
          font-size: clamp(11px, 2.8vw, 13px);
          font-weight: 900;
          color: #374151;
          letter-spacing: 1px;
        }

        @keyframes cr-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
      `}</style>

      {/* Pixel font */}
      <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap" rel="stylesheet" />

      {screenFlashColor && (
        <div className="cr-screen-flash" style={{ background: screenFlashColor }} />
      )}

      {/* Header - centered score, bigger text */}
      <div className="cr-header">
        <p className="cr-score">{score.toLocaleString()}</p>
        <div className="cr-header-sub">
          <p className="cr-best">BEST {displayedBestScore.toLocaleString()}</p>
          <p className={`cr-time ${isLowTime ? 'low-time' : ''}`}>
            {isFreezeTimer ? 'FREEZE ' : ''}{(remainingMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      {/* Stats bar with pixel chef */}
      <div className="cr-stats-bar">
        <img className={`cr-chef-img ${isClearActive ? 'cooking' : ''}`} src={chefImg} alt="Chef" />
        <span className="cr-stat">COMBO <strong>{combo}</strong></span>
        <span className="cr-stat">DISH <strong>{dishesCompleted}</strong></span>
        <span className="cr-stat">LV <strong>{recipeLength}</strong></span>
        {streak >= 3 && <span className="cr-stat">STREAK <strong>{streak}</strong></span>}
      </div>

      {/* Fever banner */}
      {isFever && (
        <p className="cr-fever-banner">
          FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
        </p>
      )}

      {/* Power-up banner */}
      {(isDoubleScore || isFreezeTimer) && (
        <p className="cr-powerup-banner">
          {isDoubleScore ? 'DOUBLE SCORE' : ''}{isDoubleScore && isFreezeTimer ? ' + ' : ''}{isFreezeTimer ? 'FREEZE' : ''} ({(powerUpMs / 1000).toFixed(1)}s)
        </p>
      )}

      {/* Streak banner */}
      {showStreakBanner && (
        <p className="cr-streak-banner">
          {streak} STREAK! +{STREAK_BONUS}
        </p>
      )}

      {/* Dish completion text */}
      {lastDishText && <p className="cr-dish-text">{lastDishText}</p>}

      {/* Active powerup indicator */}
      {activePowerUp && (
        <p className="cr-dish-text" style={{ fontSize: '24px' }}>
          {POWERUP_EMOJI[activePowerUp]}
        </p>
      )}

      {/* Recipe area */}
      <div className={`cr-recipe-area ${isWrongShakeActive ? 'shake' : ''} ${isClearActive ? 'clear-celebration' : ''} ${isVipOrder ? 'vip-order' : ''}`}>
        <div className="cr-recipe-header">
          <p className="cr-recipe-label">
            {isVipOrder ? 'VIP x3!' : 'RECIPE'}
          </p>
          <div className="cr-order-timer">
            <div
              className="cr-order-timer-fill"
              style={{
                width: `${orderTimerRatio * 100}%`,
                background: orderTimerRatio > 0.3 ? '#22c55e' : '#ef4444',
              }}
            />
          </div>
        </div>
        <div className="cr-recipe-slots">
          {recipe.map((ingredientIndex, slotIndex) => {
            const ingredient = INGREDIENTS[ingredientIndex]
            const isDone = slotIndex < progressIndex
            const isCurrent = slotIndex === progressIndex
            const isComplete = progressIndex === recipeLength
            return (
              <div
                className={`cr-slot ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${isComplete ? 'complete' : ''}`}
                key={`slot-${slotIndex}`}
              >
                <img className="cr-slot-img" src={ingredient.img} alt={ingredient.name} />
                <span className="cr-slot-name">{ingredient.name}</span>
              </div>
            )
          })}
        </div>
        <div className="cr-progress-bar">
          <div className="cr-progress-fill" style={{ width: `${(progressIndex / recipeLength) * 100}%` }} />
        </div>
      </div>

      {/* Ingredient buttons with pixel art images */}
      <div className="cr-ingredient-grid">
        {INGREDIENTS.map((ingredient, index) => {
          const isTapTarget = tapFeedbackIndex === index
          const feedbackClass = isTapTarget ? `tap-${tapFeedbackKind}` : ''
          return (
            <button
              className={`cr-ingredient-btn ${feedbackClass}`}
              key={ingredient.name}
              type="button"
              onClick={() => handleIngredientTap(index)}
              disabled={progressIndex === recipeLength}
            >
              <img className="cr-ingredient-img" src={ingredient.img} alt={ingredient.name} />
              <span className="cr-ingredient-name">{ingredient.name}</span>
            </button>
          )
        })}
      </div>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const cookingRushModule: MiniGameModule = {
  manifest: {
    id: 'cooking-rush',
    title: 'Cooking Rush',
    description: 'Follow the recipe! Add ingredients in order to cook!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#ea580c',
  },
  Component: CookingRushGame,
}
