import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import dsPerfectSfx from '../../../assets/sounds/dance-step-perfect.mp3'
import dsGoodSfx from '../../../assets/sounds/dance-step-good.mp3'
import dsMissSfx from '../../../assets/sounds/dance-step-miss.mp3'
import dsFeverSfx from '../../../assets/sounds/dance-step-fever.mp3'
import dsComboSfx from '../../../assets/sounds/dance-step-combo.mp3'
import dsTimeWarnSfx from '../../../assets/sounds/dance-step-time-warning.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import characterImage from '../../../assets/images/same-character/kim-yeonja.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const LOW_TIME_THRESHOLD_MS = 5000

const ARROW_TRAVEL_DURATION_MS = 1800
const ARROW_SPAWN_INTERVAL_START_MS = 1200
const ARROW_SPAWN_INTERVAL_MIN_MS = 380
const ARROW_SPAWN_ACCELERATION = 0.91
const ARROW_SPAWN_STEP_INTERVAL_MS = 3500

const TARGET_LINE_Y_PERCENT = 20
const PERFECT_WINDOW_MS = 150
const GOOD_WINDOW_MS = 350

const SCORE_PERFECT = 3
const SCORE_GOOD = 1
const SCORE_MISS = -1
const COMBO_BONUS_THRESHOLD = 10
const COMBO_BONUS_MULTIPLIER = 0.5

const FEVER_COMBO_THRESHOLD = 15
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const DOUBLE_ARROW_ELAPSED_MS = 12000
const DOUBLE_ARROW_CHANCE = 0.35
const RAINBOW_ARROW_ELAPSED_MS = 18000
const RAINBOW_ARROW_CHANCE = 0.12
const RAINBOW_MULTIPLIER = 5
const FREEZE_COMBO_THRESHOLD = 25
const FREEZE_DURATION_MS = 3000

const FEEDBACK_DURATION_MS = 400
const SPEED_LEVEL_INTERVAL_MS = 5000

type Direction = 'up' | 'down' | 'left' | 'right'

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'] as const

const DIRECTION_SYMBOLS: Record<Direction, string> = {
  up: '\u2191',
  down: '\u2193',
  left: '\u2190',
  right: '\u2192',
}

const DIRECTION_COLORS: Record<Direction, string> = {
  up: '#f472b6',
  down: '#60a5fa',
  left: '#34d399',
  right: '#fbbf24',
}

const DIRECTION_KEY_MAP: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
}

interface FallingArrow {
  readonly id: number
  readonly direction: Direction
  readonly spawnedAtMs: number
  readonly isRainbow: boolean
  consumed: boolean
}

type HitGrade = 'perfect' | 'good' | 'miss'

interface HitFeedback {
  readonly grade: HitGrade
  readonly direction: Direction
  readonly expiresAtMs: number
}

function pickRandomDirection(previousDirection?: Direction): Direction {
  const candidates = DIRECTIONS.filter((d) => d !== previousDirection)
  return candidates[Math.floor(Math.random() * candidates.length)]
}

function computeArrowYPercent(arrowAgeMs: number, travelDurationMs: number): number {
  const progress = arrowAgeMs / travelDurationMs
  return 100 - progress * (100 - TARGET_LINE_Y_PERCENT)
}

function computeSpawnInterval(elapsedMs: number): number {
  const steps = Math.floor(elapsedMs / ARROW_SPAWN_STEP_INTERVAL_MS)
  let interval = ARROW_SPAWN_INTERVAL_START_MS
  for (let i = 0; i < steps; i += 1) {
    interval *= ARROW_SPAWN_ACCELERATION
  }
  return Math.max(ARROW_SPAWN_INTERVAL_MIN_MS, interval)
}

function gradeColor(grade: HitGrade): string {
  if (grade === 'perfect') return '#22c55e'
  if (grade === 'good') return '#eab308'
  return '#ef4444'
}

function gradeLabel(grade: HitGrade): string {
  if (grade === 'perfect') return 'PERFECT!'
  if (grade === 'good') return 'GOOD'
  return 'MISS'
}

function DanceStepGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [arrows, setArrows] = useState<FallingArrow[]>([])
  const [feedbacks, setFeedbacks] = useState<HitFeedback[]>([])
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [isFreeze, setIsFreeze] = useState(false)
  const [speedLevel, setSpeedLevel] = useState(1)
  const [perfectStreak, setPerfectStreak] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const elapsedMsRef = useRef(0)
  const arrowsRef = useRef<FallingArrow[]>([])
  const feedbacksRef = useRef<HitFeedback[]>([])
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const nextArrowIdRef = useRef(0)
  const lastSpawnAtRef = useRef(0)
  const lastDirectionRef = useRef<Direction | undefined>(undefined)
  const lowTimeSecondRef = useRef<number | null>(null)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const freezeRef = useRef(false)
  const freezeRemainingMsRef = useRef(0)
  const perfectStreakRef = useRef(0)
  const lastSpeedLevelRef = useRef(1)
  const comboMilestoneRef = useRef(0)

  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const goodAudioRef = useRef<HTMLAudioElement | null>(null)
  const missAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const timeWarnAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const addFeedback = useCallback((grade: HitGrade, direction: Direction) => {
    const fb: HitFeedback = {
      grade,
      direction,
      expiresAtMs: elapsedMsRef.current + FEEDBACK_DURATION_MS,
    }
    feedbacksRef.current = [...feedbacksRef.current, fb]
    setFeedbacks(feedbacksRef.current)
  }, [])

  const applyHit = useCallback(
    (grade: HitGrade, direction: Direction, isRainbow: boolean) => {
      if (grade === 'miss') {
        const nextScore = Math.max(0, scoreRef.current + SCORE_MISS)
        scoreRef.current = nextScore
        setScore(nextScore)
        comboRef.current = 0
        setCombo(0)
        perfectStreakRef.current = 0
        setPerfectStreak(0)
        addFeedback('miss', direction)
        playAudio(missAudioRef, 0.4, 1.0)
        effects.triggerShake(4)
        effects.triggerFlash('rgba(239,68,68,0.25)')
        return
      }

      const basePoints = grade === 'perfect' ? SCORE_PERFECT : SCORE_GOOD
      const currentCombo = comboRef.current + 1
      comboRef.current = currentCombo
      setCombo(currentCombo)
      if (currentCombo > maxComboRef.current) {
        maxComboRef.current = currentCombo
        setMaxCombo(currentCombo)
      }

      if (grade === 'perfect') {
        perfectStreakRef.current += 1
        setPerfectStreak(perfectStreakRef.current)
      } else {
        perfectStreakRef.current = 0
        setPerfectStreak(0)
      }

      const comboBonus =
        currentCombo >= COMBO_BONUS_THRESHOLD
          ? Math.floor(basePoints * COMBO_BONUS_MULTIPLIER * Math.floor(currentCombo / COMBO_BONUS_THRESHOLD))
          : 0
      const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
      const rainbowMult = isRainbow ? RAINBOW_MULTIPLIER : 1
      const totalPoints = (basePoints + comboBonus) * feverMult * rainbowMult
      const nextScore = scoreRef.current + totalPoints
      scoreRef.current = nextScore
      setScore(nextScore)

      // Activate fever
      if (currentCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
        feverRef.current = true
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setIsFever(true)
        setFeverRemainingMs(FEVER_DURATION_MS)
        effects.triggerFlash('rgba(250,204,21,0.5)')
        playAudio(feverAudioRef, 0.6)
      }

      // Activate freeze at high combo
      if (currentCombo >= FREEZE_COMBO_THRESHOLD && !freezeRef.current && currentCombo % FREEZE_COMBO_THRESHOLD === 0) {
        freezeRef.current = true
        freezeRemainingMsRef.current = FREEZE_DURATION_MS
        setIsFreeze(true)
        effects.triggerFlash('rgba(96,165,250,0.5)')
      }

      // Combo milestone sound
      if (currentCombo >= 10 && currentCombo % 10 === 0 && currentCombo > comboMilestoneRef.current) {
        comboMilestoneRef.current = currentCombo
        playAudio(comboAudioRef, 0.5, 1 + (currentCombo / 50) * 0.3)
      }

      addFeedback(grade, direction)

      const dirIndex = DIRECTIONS.indexOf(direction)
      const hitX = 60 + dirIndex * 80

      if (grade === 'perfect') {
        playAudio(perfectAudioRef, 0.55, 1 + currentCombo * 0.008)
        effects.comboHitBurst(hitX, 100, currentCombo, totalPoints)
      } else {
        playAudio(goodAudioRef, 0.45, 1 + currentCombo * 0.006)
        effects.spawnParticles(3, hitX, 100)
        effects.showScorePopup(totalPoints, hitX, 80)
      }

      if (isRainbow) {
        effects.triggerFlash('rgba(168,85,247,0.4)')
        effects.spawnParticles(8, hitX, 100)
      }
    },
    [addFeedback, playAudio],
  )

  const handleDirectionInput = useCallback(
    (direction: Direction) => {
      if (finishedRef.current) return

      const currentArrows = arrowsRef.current
      const now = elapsedMsRef.current

      let bestArrow: FallingArrow | null = null
      let bestDistance = Infinity

      for (const arrow of currentArrows) {
        if (arrow.consumed || arrow.direction !== direction) continue
        const arrowAge = now - arrow.spawnedAtMs
        const yPercent = computeArrowYPercent(arrowAge, ARROW_TRAVEL_DURATION_MS)
        const distanceFromTarget = Math.abs(yPercent - TARGET_LINE_Y_PERCENT)
        if (distanceFromTarget < bestDistance) {
          bestDistance = distanceFromTarget
          bestArrow = arrow
        }
      }

      if (bestArrow === null) {
        applyHit('miss', direction, false)
        return
      }

      const arrowAge = now - bestArrow.spawnedAtMs
      const targetAge = ARROW_TRAVEL_DURATION_MS * ((100 - TARGET_LINE_Y_PERCENT) / 100)
      const timeDiff = Math.abs(arrowAge - targetAge)

      const isRainbow = bestArrow.isRainbow
      bestArrow.consumed = true
      arrowsRef.current = currentArrows.filter((a) => a.id !== bestArrow!.id)
      setArrows([...arrowsRef.current])

      if (timeDiff <= PERFECT_WINDOW_MS) {
        applyHit('perfect', direction, isRainbow)
      } else if (timeDiff <= GOOD_WINDOW_MS) {
        applyHit('good', direction, isRainbow)
      } else {
        applyHit('miss', direction, false)
      }
    },
    [applyHit],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    playAudio(gameOverAudioRef, 0.6, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  useEffect(() => {
    const audios = [
      { ref: perfectAudioRef, src: dsPerfectSfx },
      { ref: goodAudioRef, src: dsGoodSfx },
      { ref: missAudioRef, src: dsMissSfx },
      { ref: feverAudioRef, src: dsFeverSfx },
      { ref: comboAudioRef, src: dsComboSfx },
      { ref: timeWarnAudioRef, src: dsTimeWarnSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
    ]
    for (const { ref, src } of audios) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    }
    return () => {
      for (const { ref } of audios) ref.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      const direction = DIRECTION_KEY_MAP[event.code]
      if (direction !== undefined) {
        event.preventDefault()
        handleDirectionInput(direction)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDirectionInput, onExit])

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

      const rawDelta = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // Freeze slows time
      const deltaMs = freezeRef.current ? rawDelta * 0.3 : rawDelta

      elapsedMsRef.current += deltaMs
      remainingMsRef.current = Math.max(0, remainingMsRef.current - rawDelta)
      setRemainingMs(remainingMsRef.current)

      // Low time warning
      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(timeWarnAudioRef, 0.3, 1.2)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      // Fever timer
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - rawDelta)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Freeze timer
      if (freezeRef.current) {
        freezeRemainingMsRef.current = Math.max(0, freezeRemainingMsRef.current - rawDelta)
        if (freezeRemainingMsRef.current <= 0) {
          freezeRef.current = false
          setIsFreeze(false)
        }
      }

      // Speed level
      const newSpeedLevel = Math.min(5, 1 + Math.floor(elapsedMsRef.current / SPEED_LEVEL_INTERVAL_MS))
      if (newSpeedLevel !== lastSpeedLevelRef.current) {
        lastSpeedLevelRef.current = newSpeedLevel
        setSpeedLevel(newSpeedLevel)
      }

      // Spawn arrows
      const spawnInterval = computeSpawnInterval(elapsedMsRef.current)
      if (elapsedMsRef.current - lastSpawnAtRef.current >= spawnInterval) {
        const direction = pickRandomDirection(lastDirectionRef.current)
        lastDirectionRef.current = direction

        const isRainbow = elapsedMsRef.current > RAINBOW_ARROW_ELAPSED_MS && Math.random() < RAINBOW_ARROW_CHANCE

        const newArrow: FallingArrow = {
          id: nextArrowIdRef.current++,
          direction,
          spawnedAtMs: elapsedMsRef.current,
          isRainbow,
          consumed: false,
        }
        arrowsRef.current = [...arrowsRef.current, newArrow]

        if (elapsedMsRef.current > DOUBLE_ARROW_ELAPSED_MS && Math.random() < DOUBLE_ARROW_CHANCE) {
          const secondDir = pickRandomDirection(direction)
          const secondArrow: FallingArrow = {
            id: nextArrowIdRef.current++,
            direction: secondDir,
            spawnedAtMs: elapsedMsRef.current,
            isRainbow: false,
            consumed: false,
          }
          arrowsRef.current = [...arrowsRef.current, secondArrow]
        }

        lastSpawnAtRef.current = elapsedMsRef.current
      }

      // Expire arrows
      const expiredThreshold = ARROW_TRAVEL_DURATION_MS * 1.15
      const missedArrows: FallingArrow[] = []
      const survivingArrows: FallingArrow[] = []
      for (const arrow of arrowsRef.current) {
        const age = elapsedMsRef.current - arrow.spawnedAtMs
        if (!arrow.consumed && age > expiredThreshold) {
          missedArrows.push(arrow)
        } else if (age <= expiredThreshold || arrow.consumed) {
          survivingArrows.push(arrow)
        }
      }

      for (const missed of missedArrows) {
        const nextScore = Math.max(0, scoreRef.current + SCORE_MISS)
        scoreRef.current = nextScore
        setScore(nextScore)
        comboRef.current = 0
        setCombo(0)
        perfectStreakRef.current = 0
        setPerfectStreak(0)
        const fb: HitFeedback = {
          grade: 'miss',
          direction: missed.direction,
          expiresAtMs: elapsedMsRef.current + FEEDBACK_DURATION_MS,
        }
        feedbacksRef.current = [...feedbacksRef.current, fb]
      }

      arrowsRef.current = survivingArrows
      setArrows([...survivingArrows])

      const activeFeedbacks = feedbacksRef.current.filter((fb) => fb.expiresAtMs > elapsedMsRef.current)
      if (activeFeedbacks.length !== feedbacksRef.current.length) {
        feedbacksRef.current = activeFeedbacks
        setFeedbacks(activeFeedbacks)
      }

      effects.updateParticles()

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

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  const latestFeedback = feedbacks.length > 0 ? feedbacks[feedbacks.length - 1] : null

  return (
    <section className="mini-game-panel dance-step-panel" aria-label="dance-step-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .dance-step-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1a0a2e 0%, #0f0f23 40%, #1a0520 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          position: relative;
          overflow: hidden;
        }

        .dance-step-panel.fever-active {
          animation: ds-fever-bg 0.6s ease-in-out infinite alternate;
        }

        .dance-step-panel.freeze-active {
          background: linear-gradient(180deg, #0a1a3e 0%, #0a1530 40%, #051a30 100%) !important;
        }

        @keyframes ds-fever-bg {
          from { background: linear-gradient(180deg, #2a1a0e 0%, #1a1503 40%, #2a1505 100%); }
          to { background: linear-gradient(180deg, #1a0a2e 0%, #0f0f23 40%, #1a0520 100%); }
        }

        .dance-step-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px 6px;
          background: linear-gradient(135deg, rgba(232,121,249,0.3) 0%, rgba(168,85,247,0.2) 100%);
          border-bottom: 1px solid rgba(232,121,249,0.2);
          flex-shrink: 0;
        }

        .dance-step-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .dance-step-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: 2px solid #e879f9;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(232,121,249,0.5);
        }

        .dance-step-header-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .dance-step-score {
          font-size: 26px;
          font-weight: 900;
          color: #e879f9;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 14px rgba(232,121,249,0.6);
        }

        .dance-step-best {
          font-size: 9px;
          color: #d8b4fe;
          margin: 0;
          opacity: 0.7;
        }

        .dance-step-header-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .dance-step-time {
          font-size: 20px;
          font-weight: 800;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .dance-step-time.low-time {
          color: #ef4444;
          animation: dance-step-pulse 0.5s ease-in-out infinite alternate;
        }

        .dance-step-speed-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(232,121,249,0.2);
          color: #e879f9;
        }

        @keyframes dance-step-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.4; transform: scale(1.05); }
        }

        .dance-step-status-bar {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          padding: 4px 12px;
          font-size: 11px;
          color: #d8b4fe;
          flex-shrink: 0;
        }

        .dance-step-status-bar p {
          margin: 0;
        }

        .dance-step-status-bar strong {
          color: #e4e4e7;
          font-weight: 700;
        }

        .ds-fever-badge {
          color: #facc15;
          font-size: 11px;
          font-weight: 800;
          animation: dance-step-pulse 0.3s ease-in-out infinite alternate;
          text-shadow: 0 0 8px rgba(250,204,21,0.6);
        }

        .ds-freeze-badge {
          color: #60a5fa;
          font-size: 11px;
          font-weight: 800;
          animation: dance-step-pulse 0.4s ease-in-out infinite alternate;
          text-shadow: 0 0 8px rgba(96,165,250,0.6);
        }

        .dance-step-feedback {
          font-size: 20px;
          font-weight: 900;
          min-height: 26px;
          text-align: center;
          flex-shrink: 0;
          animation: ge-bounce-in 0.3s ease-out;
          text-shadow: 0 0 14px currentColor;
        }

        .ds-perfect-streak {
          font-size: 10px;
          color: #22c55e;
          font-weight: 700;
        }

        .dance-step-arena {
          position: relative;
          flex: 1;
          margin: 0 6px;
          background: linear-gradient(180deg, #1a1a2e 0%, #0f0f23 100%);
          border-radius: 10px;
          overflow: hidden;
          border: 2px solid rgba(232, 121, 249, 0.2);
          box-shadow: inset 0 0 30px rgba(0,0,0,0.5);
          min-height: 0;
        }

        .dance-step-target-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 6px;
          pointer-events: none;
          z-index: 2;
        }

        .dance-step-target-zone {
          width: 100%;
          height: 100%;
          background: rgba(232, 121, 249, 0.3);
          box-shadow: 0 0 20px rgba(232, 121, 249, 0.4), 0 0 40px rgba(232, 121, 249, 0.1);
        }

        .dance-step-lane-divider {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: rgba(232,121,249,0.06);
          pointer-events: none;
          z-index: 0;
        }

        .dance-step-arrow {
          position: absolute;
          font-size: 38px;
          font-weight: 900;
          pointer-events: none;
          transition: opacity 0.08s;
          text-shadow: 0 0 14px currentColor;
          z-index: 1;
        }

        .dance-step-arrow.rainbow {
          animation: ds-rainbow-glow 0.4s ease-in-out infinite alternate;
          filter: brightness(1.4);
        }

        @keyframes ds-rainbow-glow {
          from { text-shadow: 0 0 18px #a855f7, 0 0 36px #a855f7; filter: brightness(1.4) hue-rotate(0deg); }
          to { text-shadow: 0 0 24px #ec4899, 0 0 48px #ec4899; filter: brightness(1.6) hue-rotate(60deg); }
        }

        .dance-step-lane-labels {
          position: absolute;
          bottom: 8px;
          left: 0;
          right: 0;
          display: flex;
          pointer-events: none;
          z-index: 3;
        }

        .dance-step-lane-label {
          position: absolute;
          transform: translateX(-50%);
          font-size: 22px;
          opacity: 0.12;
          font-weight: 700;
        }

        .dance-step-buttons {
          display: flex;
          gap: 6px;
          padding: 8px 6px;
          flex-shrink: 0;
        }

        .dance-step-dir-button {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 16px 4px;
          border-radius: 14px;
          border: 2px solid;
          background: rgba(255, 255, 255, 0.05);
          cursor: pointer;
          transition: transform 0.06s, background 0.08s, box-shadow 0.08s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }

        .dance-step-dir-button:active {
          transform: scale(0.9);
          background: rgba(255, 255, 255, 0.15);
          box-shadow: 0 0 20px currentColor;
        }

        .dance-step-dir-symbol {
          font-size: 28px;
          font-weight: 900;
        }

        .dance-step-dir-label {
          font-size: 9px;
          opacity: 0.5;
          font-weight: 600;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="dance-step-header">
        <div className="dance-step-header-left">
          <img className="dance-step-avatar" src={characterImage} alt="character" />
          <div className="dance-step-header-info">
            <p className="dance-step-score">{score.toLocaleString()}</p>
            <p className="dance-step-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="dance-step-header-right">
          <p className={`dance-step-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <span className="dance-step-speed-badge">SPD Lv.{speedLevel}</span>
        </div>
      </div>

      <div className="dance-step-status-bar">
        <p>
          COMBO <strong>{combo}</strong>
          {comboLabel && (
            <span style={{ color: comboColor, marginLeft: 4, fontSize: 10, fontWeight: 700 }}>{comboLabel}</span>
          )}
        </p>
        <p>MAX <strong>{maxCombo}</strong></p>
        {isFever && <span className="ds-fever-badge">FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</span>}
        {isFreeze && <span className="ds-freeze-badge">FREEZE</span>}
      </div>

      <div style={{ minHeight: 26, textAlign: 'center', flexShrink: 0 }}>
        {latestFeedback !== null && (
          <div className="dance-step-feedback" style={{ color: gradeColor(latestFeedback.grade) }}>
            {gradeLabel(latestFeedback.grade)}
            {perfectStreak >= 3 && latestFeedback.grade === 'perfect' && (
              <span className="ds-perfect-streak"> x{perfectStreak}</span>
            )}
          </div>
        )}
      </div>

      <div className={`dance-step-arena ${isFever ? 'fever-active' : ''}`}>
        {[1, 2, 3].map((i) => (
          <div key={`div-${i}`} className="dance-step-lane-divider" style={{ left: `${i * 25}%` }} />
        ))}

        <div className="dance-step-target-line" style={{ top: `${TARGET_LINE_Y_PERCENT}%` }}>
          <div className="dance-step-target-zone" />
        </div>

        {arrows.map((arrow) => {
          const age = elapsedMsRef.current - arrow.spawnedAtMs
          const yPercent = computeArrowYPercent(age, ARROW_TRAVEL_DURATION_MS)
          if (yPercent < -10 || yPercent > 110) return null

          const laneIndex = DIRECTIONS.indexOf(arrow.direction)
          const lanePercent = 12.5 + laneIndex * 25

          const distFromTarget = Math.abs(yPercent - TARGET_LINE_Y_PERCENT)
          const isNearTarget = distFromTarget < 8
          const scale = isNearTarget ? 1.25 : 1

          return (
            <div
              key={arrow.id}
              className={`dance-step-arrow ${arrow.direction} ${arrow.isRainbow ? 'rainbow' : ''}`}
              style={{
                top: `${yPercent}%`,
                left: `${lanePercent}%`,
                color: arrow.isRainbow ? '#a855f7' : DIRECTION_COLORS[arrow.direction],
                transform: `translate(-50%, -50%) scale(${scale})`,
                opacity: yPercent < TARGET_LINE_Y_PERCENT ? 0.4 : 1,
              }}
            >
              {arrow.isRainbow ? '\u2726' : DIRECTION_SYMBOLS[arrow.direction]}
            </div>
          )
        })}

        <div className="dance-step-lane-labels">
          {DIRECTIONS.map((dir, index) => (
            <div
              key={dir}
              className="dance-step-lane-label"
              style={{
                left: `${12.5 + index * 25}%`,
                color: DIRECTION_COLORS[dir],
              }}
            >
              {DIRECTION_SYMBOLS[dir]}
            </div>
          ))}
        </div>
      </div>

      <div className="dance-step-buttons">
        {DIRECTIONS.map((dir) => (
          <button
            key={dir}
            className={`dance-step-dir-button ${dir}`}
            type="button"
            onPointerDown={(e) => { e.preventDefault(); handleDirectionInput(dir) }}
            style={{
              borderColor: DIRECTION_COLORS[dir],
              color: DIRECTION_COLORS[dir],
            }}
          >
            <span className="dance-step-dir-symbol">{DIRECTION_SYMBOLS[dir]}</span>
            <span className="dance-step-dir-label">{dir.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export const danceStepModule: MiniGameModule = {
  manifest: {
    id: 'dance-step',
    title: 'Dance Step',
    description: 'Tap arrows in order! DDR-style dance!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#e879f9',
  },
  Component: DanceStepGame,
}
