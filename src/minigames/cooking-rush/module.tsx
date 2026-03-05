import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 5000
const WRONG_SHAKE_DURATION_MS = 300
const CLEAR_CELEBRATION_DURATION_MS = 500
const TAP_FEEDBACK_DURATION_MS = 180
const BASE_RECIPE_LENGTH = 3
const MAX_RECIPE_LENGTH = 6
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

interface Ingredient {
  readonly name: string
  readonly emoji: string
}

const INGREDIENTS: readonly Ingredient[] = [
  { name: 'Meat', emoji: '\u{1F969}' },
  { name: 'Veggie', emoji: '\u{1F96C}' },
  { name: 'Sauce', emoji: '\u{1F9F4}' },
  { name: 'Rice', emoji: '\u{1F35A}' },
  { name: 'Egg', emoji: '\u{1F95A}' },
  { name: 'Kimchi', emoji: '\u{1F957}' },
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
      audio.volume = clampNumber(volume, 0, 1)
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

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

  const startNewRecipe = useCallback((dishes: number, now: number) => {
    const nextLength = toRecipeLength(dishes)
    const nextRecipe = createRecipe(nextLength)
    recipeRef.current = nextRecipe
    setRecipe(nextRecipe)
    progressIndexRef.current = 0
    setProgressIndex(0)
    lastDishTimeRef.current = now

    // VIP order chance
    const nextIsVip = Math.random() < VIP_ORDER_CHANCE + dishes * 0.01
    isVipOrderRef.current = nextIsVip
    setIsVipOrder(nextIsVip)

    // Order timer
    const timerMs = getOrderTimerMs(dishes)
    orderTimerMsRef.current = timerMs
    orderRemainingMsRef.current = timerMs
    setOrderTimerMs(timerMs)
    setOrderRemainingMs(timerMs)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(wrongShakeTimerRef)
    clearTimeoutSafe(clearTimerRef)
    clearTimeoutSafe(tapFeedbackTimerRef)
    clearTimeoutSafe(dishTextTimerRef)

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
        playAudio(tapHitAudioRef, 0.5, 1 + progressRatio * 0.15)

        if (nextProgress === recipeRef.current.length) {
          const timeSinceLastDish = now - lastDishTimeRef.current
          const isComboKept = timeSinceLastDish <= COMBO_KEEP_WINDOW_MS
          const nextCombo = isComboKept ? comboRef.current + 1 : 1
          comboRef.current = nextCombo
          setCombo(nextCombo)

          const nextDishes = dishesCompletedRef.current + 1
          dishesCompletedRef.current = nextDishes
          setDishesCompleted(nextDishes)

          // Fever activation
          if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
            isFeverRef.current = true
            feverMsRef.current = FEVER_DURATION_MS
            setIsFever(true)
            setFeverMs(FEVER_DURATION_MS)
          }

          const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
          const vipMult = isVipOrderRef.current ? VIP_SCORE_MULTIPLIER : 1

          // Perfect bonus (no mistakes on this recipe)
          const isPerfect = progressIndexRef.current === recipeRef.current.length
          let perfectBonus = 0
          if (isPerfect) {
            perfectCountRef.current += 1
            setPerfectCount(perfectCountRef.current)
            perfectBonus = PERFECT_BONUS
          }

          const dishScore = Math.round((BASE_DISH_SCORE + (nextCombo - 1) * COMBO_BONUS_PER_STACK + perfectBonus) * vipMult * feverMult)
          const nextScore = scoreRef.current + dishScore
          scoreRef.current = nextScore
          setScore(nextScore)

          const parts: string[] = [`+${dishScore}`]
          if (isVipOrderRef.current) parts.push('VIP!')
          if (isFeverRef.current) parts.push('FEVER!')
          if (isPerfect) parts.push('PERFECT!')
          showDishText(parts.join(' '))

          triggerClear()
          effects.triggerFlash()
          effects.spawnParticles(4, 200, 200)
          playAudio(tapHitStrongAudioRef, 0.7, 1 + Math.min(0.3, nextCombo * 0.03))

          window.setTimeout(() => {
            if (!finishedRef.current) {
              startNewRecipe(nextDishes, window.performance.now())
            }
          }, CLEAR_CELEBRATION_DURATION_MS)
        }
        return
      }

      triggerWrongShake()
      triggerTapFeedback(ingredientIndex, 'bad')
      effects.triggerShake(4)
      effects.triggerFlash('rgba(239,68,68,0.4)')
      playAudio(tapHitAudioRef, 0.4, 0.7)

      progressIndexRef.current = 0
      setProgressIndex(0)
    },
    [playAudio, triggerClear, triggerTapFeedback, triggerWrongShake, startNewRecipe, showDishText],
  )

  const handleExit = useCallback(() => {
    playAudio(tapHitStrongAudioRef, 0.42, 1.02)
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
      clearTimeoutSafe(wrongShakeTimerRef)
      clearTimeoutSafe(clearTimerRef)
      clearTimeoutSafe(tapFeedbackTimerRef)
      clearTimeoutSafe(dishTextTimerRef)
      effects.cleanup()
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
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

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Order timer countdown
      orderRemainingMsRef.current = Math.max(0, orderRemainingMsRef.current - deltaMs)
      setOrderRemainingMs(orderRemainingMsRef.current)

      if (orderRemainingMsRef.current <= 0 && !finishedRef.current) {
        // Order timed out - penalty and new recipe
        scoreRef.current = Math.max(0, scoreRef.current - TIMER_FAIL_PENALTY)
        setScore(scoreRef.current)
        comboRef.current = 0
        setCombo(0)
        showDishText(`-${TIMER_FAIL_PENALTY} Time out!`)
        playAudio(gameOverAudioRef, 0.4, 1.1)
        startNewRecipe(dishesCompletedRef.current, window.performance.now())
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
    <section className="mini-game-panel cooking-rush-panel" aria-label="cooking-rush-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}

        .cooking-rush-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #fef3c7 0%, #fff7ed 30%, #fff 100%);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .cooking-rush-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px 6px;
          background: linear-gradient(180deg, #ea580c, #c2410c);
          color: white;
        }

        .cooking-rush-score {
          margin: 0;
          font-size: 26px;
          font-weight: 800;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .cooking-rush-header-right {
          text-align: right;
        }

        .cooking-rush-best {
          margin: 0;
          font-size: 9px;
          color: rgba(255,255,255,0.7);
        }

        .cooking-rush-time {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
        }

        .cooking-rush-time.low-time {
          color: #fbbf24;
          animation: cooking-rush-pulse 0.3s infinite alternate;
        }

        .cooking-rush-chef-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 6px 12px;
          background: rgba(234,88,12,0.08);
        }

        .cooking-rush-chef-img {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid #ea580c;
          box-shadow: 0 2px 8px rgba(234,88,12,0.3);
        }

        .cooking-rush-meta {
          display: flex;
          gap: 12px;
          font-size: 12px;
          color: #78350f;
        }

        .cooking-rush-meta p { margin: 0; }
        .cooking-rush-meta strong { font-size: 14px; color: #ea580c; }

        .cooking-rush-fever-banner {
          text-align: center;
          font-size: 15px;
          font-weight: 900;
          color: #fff;
          margin: 0;
          padding: 4px 0;
          background: linear-gradient(90deg, #ef4444, #f97316, #ef4444);
          letter-spacing: 4px;
          text-shadow: 0 0 8px rgba(0,0,0,0.3);
          animation: cooking-rush-fever-flash 0.3s infinite alternate;
        }

        .cooking-rush-dish-text {
          text-align: center;
          font-size: 16px;
          font-weight: 800;
          color: #ea580c;
          margin: 0;
          padding: 2px 0;
          text-shadow: 0 0 8px rgba(234,88,12,0.4);
          animation: cooking-rush-bonus-pop 0.4s ease-out;
        }

        .cooking-rush-recipe-area {
          margin: 6px 12px;
          padding: 10px 12px;
          background: #fff;
          border-radius: 14px;
          border: 2px solid #fdba74;
          box-shadow: 0 2px 12px rgba(234,88,12,0.1);
          transition: all 0.15s;
        }

        .cooking-rush-recipe-area.shake {
          animation: cooking-rush-shake 0.3s ease-out;
        }

        .cooking-rush-recipe-area.clear-celebration {
          background: #fef9c3;
          border-color: #facc15;
          box-shadow: 0 0 20px rgba(250,204,21,0.4);
        }

        .cooking-rush-recipe-area.vip-order {
          border: 2px solid #fbbf24;
          box-shadow: 0 0 16px rgba(251,191,36,0.5);
          background: linear-gradient(135deg, #fffbeb, #fef3c7);
        }

        .cooking-rush-recipe-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .cooking-rush-recipe-label {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          color: #92400e;
        }

        .cooking-rush-order-timer {
          width: 70px;
          height: 6px;
          background: #e5e7eb;
          border-radius: 3px;
          overflow: hidden;
        }

        .cooking-rush-order-timer-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.1s linear;
        }

        .cooking-rush-recipe-slots {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .cooking-rush-slot {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 6px 8px;
          border-radius: 10px;
          background: #f3f4f6;
          border: 2px solid #d1d5db;
          transition: all 0.15s;
          min-width: 48px;
        }

        .cooking-rush-slot.done {
          background: #dcfce7;
          border-color: #22c55e;
        }

        .cooking-rush-slot.current {
          background: #fef3c7;
          border-color: #f59e0b;
          box-shadow: 0 0 8px rgba(245,158,11,0.4);
          transform: scale(1.08);
        }

        .cooking-rush-slot.complete {
          background: #bbf7d0;
          border-color: #16a34a;
        }

        .cooking-rush-slot-emoji {
          font-size: 22px;
        }

        .cooking-rush-slot-name {
          font-size: 8px;
          font-weight: 600;
          color: #6b7280;
        }

        .cooking-rush-progress-bar {
          margin-top: 8px;
          height: 5px;
          background: #e5e7eb;
          border-radius: 3px;
          overflow: hidden;
        }

        .cooking-rush-progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #16a34a);
          border-radius: 3px;
          transition: width 0.15s;
        }

        .cooking-rush-ingredient-grid {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          padding: 8px 12px;
          align-content: center;
        }

        .cooking-rush-ingredient-button {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 12px 6px;
          border: 2px solid #d1d5db;
          border-radius: 14px;
          background: #fff;
          cursor: pointer;
          transition: all 0.1s;
          box-shadow: 0 2px 6px rgba(0,0,0,0.06);
          touch-action: manipulation;
        }

        .cooking-rush-ingredient-button:active {
          transform: scale(0.92);
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }

        .cooking-rush-ingredient-button.tap-good {
          background: #dcfce7;
          border-color: #22c55e;
          box-shadow: 0 0 12px rgba(34,197,94,0.4);
          transform: scale(0.95);
        }

        .cooking-rush-ingredient-button.tap-bad {
          background: #fef2f2;
          border-color: #ef4444;
          box-shadow: 0 0 12px rgba(239,68,68,0.3);
          animation: cooking-rush-shake 0.2s ease-out;
        }

        .cooking-rush-ingredient-button:disabled {
          opacity: 0.4;
          cursor: default;
        }

        .cooking-rush-ingredient-emoji {
          font-size: 30px;
          filter: drop-shadow(0 2px 3px rgba(0,0,0,0.15));
        }

        .cooking-rush-ingredient-name {
          font-size: 10px;
          font-weight: 600;
          color: #374151;
        }

        .cooking-rush-footer {
          padding: 6px 12px 10px;
          text-align: center;
        }

        @keyframes cooking-rush-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.08); }
        }

        @keyframes cooking-rush-fever-flash {
          from { opacity: 0.8; }
          to { opacity: 1; }
        }

        @keyframes cooking-rush-bonus-pop {
          0% { transform: scale(0.5) translateY(8px); opacity: 0; }
          60% { transform: scale(1.2) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        @keyframes cooking-rush-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
      `}</style>

      {/* Header */}
      <div className="cooking-rush-header">
        <div>
          <p className="cooking-rush-score">{score.toLocaleString()}</p>
          <p className="cooking-rush-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="cooking-rush-header-right">
          <p className={`cooking-rush-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      {/* Chef + Meta */}
      <div className="cooking-rush-chef-row">
        <img className="cooking-rush-chef-img" src={kimYeonjaSprite} alt="Chef" />
        <div className="cooking-rush-meta">
          <p>COMBO <strong>{combo}</strong></p>
          <p>{'\u{1F372}'} <strong>{dishesCompleted}</strong></p>
          <p>LV <strong>{recipeLength}</strong></p>
          {perfectCount > 0 && <p>{'\u2B50'} <strong>{perfectCount}</strong></p>}
        </div>
      </div>

      {/* Fever banner */}
      {isFever && (
        <p className="cooking-rush-fever-banner">
          FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
        </p>
      )}

      {/* Dish completion text */}
      {lastDishText && <p className="cooking-rush-dish-text">{lastDishText}</p>}

      {/* Recipe area */}
      <div className={`cooking-rush-recipe-area ${isWrongShakeActive ? 'shake' : ''} ${isClearActive ? 'clear-celebration' : ''} ${isVipOrder ? 'vip-order' : ''}`}>
        <div className="cooking-rush-recipe-header">
          <p className="cooking-rush-recipe-label">
            {isVipOrder ? '\u{1F451} VIP Order x3!' : '\u{1F468}\u{200D}\u{1F373} Recipe'}
          </p>
          <div className="cooking-rush-order-timer">
            <div
              className="cooking-rush-order-timer-fill"
              style={{
                width: `${orderTimerRatio * 100}%`,
                background: orderTimerRatio > 0.3 ? '#22c55e' : '#ef4444',
              }}
            />
          </div>
        </div>
        <div className="cooking-rush-recipe-slots">
          {recipe.map((ingredientIndex, slotIndex) => {
            const ingredient = INGREDIENTS[ingredientIndex]
            const isDone = slotIndex < progressIndex
            const isCurrent = slotIndex === progressIndex
            const isComplete = progressIndex === recipeLength
            return (
              <div
                className={`cooking-rush-slot ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${isComplete ? 'complete' : ''}`}
                key={`slot-${slotIndex}`}
              >
                <span className="cooking-rush-slot-emoji">{ingredient.emoji}</span>
                <span className="cooking-rush-slot-name">{ingredient.name}</span>
              </div>
            )
          })}
        </div>
        <div className="cooking-rush-progress-bar">
          <div className="cooking-rush-progress-fill" style={{ width: `${(progressIndex / recipeLength) * 100}%` }} />
        </div>
      </div>

      {/* Ingredient buttons */}
      <div className="cooking-rush-ingredient-grid">
        {INGREDIENTS.map((ingredient, index) => {
          const isTapTarget = tapFeedbackIndex === index
          const feedbackClass = isTapTarget ? `tap-${tapFeedbackKind}` : ''
          return (
            <button
              className={`cooking-rush-ingredient-button ${feedbackClass}`}
              key={ingredient.name}
              type="button"
              onClick={() => handleIngredientTap(index)}
              disabled={progressIndex === recipeLength}
            >
              <span className="cooking-rush-ingredient-emoji">{ingredient.emoji}</span>
              <span className="cooking-rush-ingredient-name">{ingredient.name}</span>
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="cooking-rush-footer">
        <button className="text-button" type="button" onClick={handleExit}>Hub</button>
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
    description: '\uB808\uC2DC\uD53C\uB300\uB85C \uC7AC\uB8CC\uB97C \uC21C\uC11C\uB300\uB85C \uB123\uC5B4 \uC694\uB9AC\uB97C \uC644\uC131\uD558\uB77C!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#ea580c',
  },
  Component: CookingRushGame,
}
