import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import simonCorrectSfx from '../../../assets/sounds/simon-says-correct.mp3'
import simonWrongSfx from '../../../assets/sounds/simon-says-wrong.mp3'
import simonFeverSfx from '../../../assets/sounds/simon-says-fever.mp3'
import simonLevelUpSfx from '../../../assets/sounds/simon-says-level-up.mp3'
import simonBeepSfx from '../../../assets/sounds/simon-says-beep.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 45000
const LOW_TIME_THRESHOLD_MS = 10000
const POINTS_PER_LEVEL = 10
const SEQUENCE_SHOW_INTERVAL_MS = 600
const SEQUENCE_SHOW_DURATION_MS = 400
const PAUSE_BEFORE_PLAY_MS = 500
const SUCCESS_FLASH_DURATION_MS = 400
const FAIL_FLASH_DURATION_MS = 300

const MIN_SHOW_INTERVAL_MS = 250
const MIN_SHOW_DURATION_MS = 180
const SHOW_SPEED_FACTOR = 0.92

const FEVER_STREAK_THRESHOLD = 5
const FEVER_DURATION_LEVELS = 3
const FEVER_BONUS_MULTIPLIER = 2
const FEVER_TIME_BONUS_MS = 3000

const FAST_CLEAR_THRESHOLD_MS = 4000
const FAST_CLEAR_BONUS = 5

type SimonColor = 'red' | 'blue' | 'green' | 'yellow'

const SIMON_COLORS: readonly SimonColor[] = ['red', 'blue', 'green', 'yellow'] as const

const COLOR_MAP: Record<SimonColor, { hex: string; brightHex: string; glowHex: string; label: string; emoji: string }> = {
  red: { hex: '#ef4444', brightHex: '#fca5a5', glowHex: '#ff6b6b', label: 'Red', emoji: '🔴' },
  blue: { hex: '#3b82f6', brightHex: '#93c5fd', glowHex: '#60a5fa', label: 'Blue', emoji: '🔵' },
  green: { hex: '#22c55e', brightHex: '#86efac', glowHex: '#4ade80', label: 'Green', emoji: '🟢' },
  yellow: { hex: '#eab308', brightHex: '#fde047', glowHex: '#facc15', label: 'Yellow', emoji: '🟡' },
} as const

type GamePhase = 'watch' | 'play' | 'result'

const FEVER_COLORS: readonly SimonColor[] = ['red', 'blue'] as const

function pickRandomColor(isFever = false): SimonColor {
  const pool = isFever ? FEVER_COLORS : SIMON_COLORS
  return pool[Math.floor(Math.random() * pool.length)]
}

function extendSequence(sequence: SimonColor[], isFever = false): SimonColor[] {
  return [...sequence, pickRandomColor(isFever)]
}

function getShowTiming(level: number): { interval: number; duration: number } {
  let interval = SEQUENCE_SHOW_INTERVAL_MS
  let duration = SEQUENCE_SHOW_DURATION_MS
  for (let i = 1; i < level; i += 1) {
    interval = Math.max(MIN_SHOW_INTERVAL_MS, interval * SHOW_SPEED_FACTOR)
    duration = Math.max(MIN_SHOW_DURATION_MS, duration * SHOW_SPEED_FACTOR)
  }
  return { interval: Math.round(interval), duration: Math.round(duration) }
}

const SIMON_CSS = `
${GAME_EFFECTS_CSS}

.ss-root {
  max-width: 432px;
  width: 100%;
  height: 100vh;
  height: 100svh;
  margin: 0 auto;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 50%, #e8e5dc 100%);
}

.ss-root.fever-active {
  background: linear-gradient(180deg, #fef3c7 0%, #fde68a 30%, #fbbf24 100%);
}

@keyframes ss-fever-pulse {
  0% { transform: scale(1); text-shadow: 0 0 8px #f59e0b; }
  50% { transform: scale(1.06); text-shadow: 0 0 20px #f59e0b, 0 0 40px #fbbf24; }
  100% { transform: scale(1); text-shadow: 0 0 8px #f59e0b; }
}

@keyframes ss-btn-glow {
  0% { box-shadow: 0 0 12px var(--ss-glow), inset 0 0 8px rgba(255,255,255,0.3); }
  50% { box-shadow: 0 0 28px var(--ss-glow), 0 0 48px var(--ss-glow), inset 0 0 16px rgba(255,255,255,0.5); }
  100% { box-shadow: 0 0 12px var(--ss-glow), inset 0 0 8px rgba(255,255,255,0.3); }
}

@keyframes ss-ripple {
  0% { transform: scale(0.6); opacity: 0.8; }
  100% { transform: scale(2.2); opacity: 0; }
}

@keyframes ss-score-pop {
  0% { transform: scale(1); }
  30% { transform: scale(1.3); }
  100% { transform: scale(1); }
}

@keyframes ss-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}

@keyframes ss-dot-bounce {
  0% { transform: scale(1); }
  50% { transform: scale(1.5); }
  100% { transform: scale(1); }
}

@keyframes ss-phase-enter {
  0% { transform: translateY(-10px); opacity: 0; }
  100% { transform: translateY(0); opacity: 1; }
}

@keyframes ss-time-pulse {
  0% { color: #ef4444; transform: scale(1); }
  50% { color: #dc2626; transform: scale(1.08); }
  100% { color: #ef4444; transform: scale(1); }
}

@keyframes ss-streak-fill {
  0% { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

.ss-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px 8px;
  flex-shrink: 0;
}

.ss-score-block {
  text-align: center;
  flex: 1;
}

.ss-score-value {
  font-size: clamp(1.8rem, 6vw, 2.6rem);
  font-weight: 900;
  color: #1f2937;
  margin: 0;
  line-height: 1.1;
}

.ss-score-value.pop {
  animation: ss-score-pop 0.3s ease-out;
}

.ss-best-label {
  font-size: 0.55rem;
  color: #9ca3af;
  margin: 2px 0 0;
}

.ss-time-box {
  text-align: right;
  min-width: 70px;
}

.ss-time-value {
  font-size: clamp(1.2rem, 4vw, 1.6rem);
  font-weight: 800;
  color: #374151;
  margin: 0;
}

.ss-time-value.low-time {
  animation: ss-time-pulse 0.6s ease-in-out infinite;
}

.ss-level-box {
  text-align: left;
  min-width: 70px;
}

.ss-level-value {
  font-size: clamp(1rem, 3vw, 1.3rem);
  font-weight: 800;
  color: #4b5563;
  margin: 0;
}

.ss-info-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px 4px;
  flex-shrink: 0;
  min-height: 28px;
}

.ss-fever-banner {
  font-size: clamp(0.9rem, 3vw, 1.2rem);
  font-weight: 900;
  color: #f59e0b;
  text-align: center;
  animation: ss-fever-pulse 0.6s ease-in-out infinite;
  margin: 0;
}

.ss-streak-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 24px;
  flex-shrink: 0;
}

.ss-streak-track {
  flex: 1;
  height: 6px;
  background: #d1d5db;
  border-radius: 3px;
  overflow: hidden;
}

.ss-streak-fill {
  height: 100%;
  background: linear-gradient(90deg, #a78bfa, #8b5cf6);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.ss-streak-fill.fever {
  background: linear-gradient(90deg, #fbbf24, #f59e0b);
}

.ss-streak-label {
  font-size: 0.5rem;
  color: #6b7280;
  white-space: nowrap;
}

.ss-phase-label {
  text-align: center;
  font-size: clamp(1rem, 3.5vw, 1.4rem);
  font-weight: 800;
  color: #4b5563;
  margin: 4px 0;
  flex-shrink: 0;
  animation: ss-phase-enter 0.3s ease-out;
}

.ss-phase-label.watch { color: #3b82f6; }
.ss-phase-label.play { color: #22c55e; }
.ss-phase-label.success { color: #f59e0b; }
.ss-phase-label.fail { color: #ef4444; animation: ss-shake 0.3s ease-in-out; }

.ss-grid-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  min-height: 0;
}

.ss-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: clamp(8px, 2vw, 14px);
  width: 100%;
  max-width: 360px;
  aspect-ratio: 1;
}

.ss-btn {
  position: relative;
  border: none;
  border-radius: clamp(16px, 4vw, 24px);
  background: var(--ss-color);
  cursor: pointer;
  transition: transform 0.08s, filter 0.08s, box-shadow 0.15s;
  overflow: hidden;
  box-shadow: 0 4px 0 rgba(0,0,0,0.25), 0 0 0 3px rgba(0,0,0,0.08);
  outline: none;
}

.ss-btn:active:not(:disabled) {
  transform: scale(0.94) translateY(2px);
  box-shadow: 0 1px 0 rgba(0,0,0,0.25);
}

.ss-btn:disabled {
  filter: brightness(0.55) saturate(0.4);
  cursor: default;
}

.ss-btn.active {
  filter: brightness(1.5) saturate(1.3);
  transform: scale(1.04);
  --ss-glow: var(--ss-glow-color);
  animation: ss-btn-glow 0.4s ease-in-out;
  box-shadow: 0 0 20px var(--ss-glow-color), 0 4px 0 rgba(0,0,0,0.2);
}

.ss-btn-inner {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(ellipse at 35% 30%, rgba(255,255,255,0.45) 0%, transparent 60%);
}

.ss-btn-ripple {
  position: absolute;
  width: 60%;
  height: 60%;
  top: 20%;
  left: 20%;
  border-radius: 50%;
  background: rgba(255,255,255,0.4);
  animation: ss-ripple 0.5s ease-out forwards;
  pointer-events: none;
}

.ss-dots-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
  min-height: 36px;
}

.ss-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid rgba(0,0,0,0.15);
  transition: background-color 0.2s, transform 0.2s, box-shadow 0.2s;
}

.ss-dot.done {
  transform: scale(0.8);
  opacity: 0.5;
}

.ss-dot.current {
  transform: scale(1.3);
  box-shadow: 0 0 8px rgba(255,255,255,0.8);
  animation: ss-dot-bounce 0.4s ease-in-out;
}

.ss-dot.revealed {
  transform: scale(1.1);
}

.ss-combo-label {
  text-align: center;
  font-weight: 900;
  margin: 0;
  flex-shrink: 0;
}
`

function SimonSaysGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<GamePhase>('watch')
  const [sequence, setSequence] = useState<SimonColor[]>(() => [pickRandomColor()])
  const [activeColor, setActiveColor] = useState<SimonColor | null>(null)
  const [playerIndex, setPlayerIndex] = useState(0)
  const [successFlash, setSuccessFlash] = useState(false)
  const [failFlash, setFailFlash] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [consecutiveClears, setConsecutiveClears] = useState(0)
  const [scorePop, setScorePop] = useState(false)
  const [showRipple, setShowRipple] = useState<SimonColor | null>(null)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const levelRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const phaseRef = useRef<GamePhase>('watch')
  const sequenceRef = useRef<SimonColor[]>(sequence)
  const playerIndexRef = useRef(0)
  const finishedRef = useRef(false)
  const consecutiveClearsRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverLevelsRemainingRef = useRef(0)
  const levelStartAtRef = useRef(performance.now())
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const showSequenceTimerRef = useRef<number | null>(null)
  const successFlashTimerRef = useRef<number | null>(null)
  const failFlashTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)

  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const levelUpAudioRef = useRef<HTMLAudioElement | null>(null)
  const beepAudioRef = useRef<HTMLAudioElement | null>(null)
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

  const startShowingSequence = useCallback(
    (seq: SimonColor[]) => {
      phaseRef.current = 'watch'
      setPhase('watch')
      playerIndexRef.current = 0
      setPlayerIndex(0)

      const { interval, duration } = getShowTiming(levelRef.current)
      let showIndex = 0

      const showNext = () => {
        if (finishedRef.current) return
        if (showIndex >= seq.length) {
          setActiveColor(null)
          showSequenceTimerRef.current = window.setTimeout(() => {
            showSequenceTimerRef.current = null
            if (!finishedRef.current) {
              phaseRef.current = 'play'
              setPhase('play')
              levelStartAtRef.current = performance.now()
            }
          }, PAUSE_BEFORE_PLAY_MS)
          return
        }

        const color = seq[showIndex]
        setActiveColor(color)
        playAudio(beepAudioRef, 0.4, 0.85 + showIndex * 0.08)

        showSequenceTimerRef.current = window.setTimeout(() => {
          setActiveColor(null)
          showIndex += 1
          showSequenceTimerRef.current = window.setTimeout(showNext, interval - duration)
        }, duration)
      }

      showSequenceTimerRef.current = window.setTimeout(showNext, PAUSE_BEFORE_PLAY_MS)
    },
    [playAudio],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(showSequenceTimerRef)
    clearTimeoutSafe(successFlashTimerRef)
    clearTimeoutSafe(failFlashTimerRef)
    effects.cleanup()

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const advanceToNextLevel = useCallback(() => {
    if (finishedRef.current) return

    const clearTimeMs = performance.now() - levelStartAtRef.current
    const fastClearBonus = clearTimeMs < FAST_CLEAR_THRESHOLD_MS ? FAST_CLEAR_BONUS : 0
    const feverMultiplier = isFeverRef.current ? FEVER_BONUS_MULTIPLIER : 1
    const earned = (POINTS_PER_LEVEL + fastClearBonus) * feverMultiplier

    const nextScore = scoreRef.current + earned
    scoreRef.current = nextScore
    setScore(nextScore)
    setScorePop(true)
    setTimeout(() => setScorePop(false), 300)

    const nextLevel = levelRef.current + 1
    levelRef.current = nextLevel
    setLevel(nextLevel)

    consecutiveClearsRef.current += 1
    setConsecutiveClears(consecutiveClearsRef.current)

    if (isFeverRef.current) {
      feverLevelsRemainingRef.current -= 1
      if (feverLevelsRemainingRef.current <= 0) {
        isFeverRef.current = false
        setIsFever(false)
      }
    } else if (consecutiveClearsRef.current >= FEVER_STREAK_THRESHOLD) {
      isFeverRef.current = true
      setIsFever(true)
      feverLevelsRemainingRef.current = FEVER_DURATION_LEVELS
      consecutiveClearsRef.current = 0
      setConsecutiveClears(0)
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FEVER_TIME_BONUS_MS)
      setRemainingMs(remainingMsRef.current)
      playAudio(feverAudioRef, 0.7)
      effects.triggerFlash('rgba(251,191,36,0.5)', 300)
      effects.spawnParticles(15, 200, 200)
    }

    const nextSequence = extendSequence(sequenceRef.current, isFeverRef.current)
    sequenceRef.current = nextSequence
    setSequence(nextSequence)

    setSuccessFlash(true)
    clearTimeoutSafe(successFlashTimerRef)
    successFlashTimerRef.current = window.setTimeout(() => {
      successFlashTimerRef.current = null
      setSuccessFlash(false)
      startShowingSequence(nextSequence)
    }, SUCCESS_FLASH_DURATION_MS)

    effects.comboHitBurst(200, 300, nextLevel, earned)
    effects.showScorePopup(earned, 200, 280, isFeverRef.current ? '#fbbf24' : '#22c55e')

    if (fastClearBonus > 0) {
      effects.showScorePopup(fastClearBonus, 260, 240, '#fbbf24')
    }

    playAudio(levelUpAudioRef, 0.6, 1 + Math.min(0.3, nextLevel * 0.02))
  }, [playAudio, startShowingSequence])

  const handleGameOver = useCallback(() => {
    if (finishedRef.current) return

    consecutiveClearsRef.current = 0
    setConsecutiveClears(0)
    isFeverRef.current = false
    setIsFever(false)
    feverLevelsRemainingRef.current = 0

    phaseRef.current = 'result'
    setPhase('result')
    setFailFlash(true)
    playAudio(wrongAudioRef, 0.7)
    playAudio(gameOverAudioRef, 0.5, 0.95)

    effects.triggerShake(10)
    effects.triggerFlash('rgba(239,68,68,0.5)', 200)

    clearTimeoutSafe(failFlashTimerRef)
    failFlashTimerRef.current = window.setTimeout(() => {
      failFlashTimerRef.current = null
      setFailFlash(false)
      finishGame()
    }, FAIL_FLASH_DURATION_MS)
  }, [finishGame, playAudio])

  const handleColorTap = useCallback(
    (color: SimonColor) => {
      if (finishedRef.current || phaseRef.current !== 'play') return

      const expectedColor = sequenceRef.current[playerIndexRef.current]
      if (color !== expectedColor) {
        handleGameOver()
        return
      }

      setActiveColor(color)
      setShowRipple(color)
      setTimeout(() => setShowRipple(null), 500)
      playAudio(correctAudioRef, 0.5, 1 + playerIndexRef.current * 0.05)

      effects.spawnParticles(4, 200, 350)
      effects.triggerFlash(`${COLOR_MAP[color].glowHex}33`, 80)

      window.setTimeout(() => {
        if (!finishedRef.current) setActiveColor(null)
      }, 150)

      const nextIndex = playerIndexRef.current + 1
      playerIndexRef.current = nextIndex
      setPlayerIndex(nextIndex)

      if (nextIndex >= sequenceRef.current.length) {
        advanceToNextLevel()
      }
    },
    [advanceToNextLevel, handleGameOver, playAudio],
  )

  const handleExit = useCallback(() => {
    playAudio(beepAudioRef, 0.3, 1)
    onExit()
  }, [onExit, playAudio])

  useEffect(() => {
    const audioEntries: [{ current: HTMLAudioElement | null }, string][] = [
      [correctAudioRef, simonCorrectSfx],
      [wrongAudioRef, simonWrongSfx],
      [feverAudioRef, simonFeverSfx],
      [levelUpAudioRef, simonLevelUpSfx],
      [beepAudioRef, simonBeepSfx],
      [gameOverAudioRef, gameOverHitSfx],
    ]

    for (const [ref, src] of audioEntries) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    }

    return () => {
      clearTimeoutSafe(showSequenceTimerRef)
      clearTimeoutSafe(successFlashTimerRef)
      clearTimeoutSafe(failFlashTimerRef)
      effects.cleanup()
      for (const [ref] of audioEntries) ref.current = null
    }
  }, [])

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
    startShowingSequence(sequenceRef.current)
  }, [])

  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)
      effects.updateParticles()

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(beepAudioRef, 0.25, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 12000)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.6, 0.95)
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
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const phaseLabel = isFever
    ? (phase === 'watch' ? 'FEVER! Memorize!' : phase === 'play' ? 'FEVER! x2 Score!' : 'Game Over!')
    : (phase === 'watch' ? 'Watch carefully!' : phase === 'play' ? 'Your turn!' : 'Game Over!')

  const comboLabel = getComboLabel(level)
  const comboColor = getComboColor(level)

  const streakRatio = isFever
    ? feverLevelsRemainingRef.current / FEVER_DURATION_LEVELS
    : consecutiveClears / FEVER_STREAK_THRESHOLD

  return (
    <section className={`mini-game-panel ss-root ${isFever ? 'fever-active' : ''}`} aria-label="simon-says-game" style={effects.getShakeStyle()}>
      <style>{SIMON_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="ss-header">
        <div className="ss-level-box">
          <p className="ss-level-value">LV.{level}</p>
        </div>
        <div className="ss-score-block">
          <p className={`ss-score-value ${scorePop ? 'pop' : ''}`}>{score.toLocaleString()}</p>
          <p className="ss-best-label">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="ss-time-box">
          <p className={`ss-time-value ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      <div className="ss-streak-bar">
        <span className="ss-streak-label">{isFever ? 'FEVER' : 'STREAK'}</span>
        <div className="ss-streak-track">
          <div className={`ss-streak-fill ${isFever ? 'fever' : ''}`} style={{ width: `${Math.min(100, streakRatio * 100)}%` }} />
        </div>
        <span className="ss-streak-label">{isFever ? `${feverLevelsRemainingRef.current} left` : `${consecutiveClears}/${FEVER_STREAK_THRESHOLD}`}</span>
      </div>

      <div className="ss-info-row">
        {isFever ? (
          <p className="ss-fever-banner">FEVER MODE x{FEVER_BONUS_MULTIPLIER}</p>
        ) : comboLabel ? (
          <p className="ss-combo-label" style={{ fontSize: 'clamp(0.9rem, 3vw, 1.2rem)', color: comboColor }}>{comboLabel}</p>
        ) : null}
      </div>

      <p className={`ss-phase-label ${phase} ${successFlash ? 'success' : ''} ${failFlash ? 'fail' : ''}`}>
        {phaseLabel}
      </p>

      <div className="ss-grid-wrap">
        <div className="ss-grid">
          {SIMON_COLORS.map((color) => {
            const info = COLOR_MAP[color]
            const isActive = activeColor === color
            const isDisabled = phase !== 'play' || finishedRef.current

            return (
              <button
                className={`ss-btn ${isActive ? 'active' : ''}`}
                key={color}
                type="button"
                disabled={isDisabled}
                onClick={() => handleColorTap(color)}
                aria-label={info.label}
                style={{
                  '--ss-color': info.hex,
                  '--ss-glow-color': info.glowHex,
                } as React.CSSProperties}
              >
                <span className="ss-btn-inner" />
                {showRipple === color && <span className="ss-btn-ripple" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="ss-dots-row">
        {sequence.map((color, index) => {
          const isDone = phase === 'play' && index < playerIndex
          const isCurrent = phase === 'play' && index === playerIndex
          const isRevealed = phase === 'watch'

          return (
            <span
              className={`ss-dot ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${isRevealed ? 'revealed' : ''}`}
              key={`dot-${index}`}
              style={{
                backgroundColor: isRevealed || isDone ? COLOR_MAP[color].hex : isCurrent ? '#ffffff' : '#4b5563',
              }}
            />
          )
        })}
      </div>
    </section>
  )
}

export const simonSaysModule: MiniGameModule = {
  manifest: {
    id: 'simon-says',
    title: 'Simon Says',
    description: 'RGBY! Remember color order and repeat!',
    unlockCost: 40,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#22c55e',
  },
  Component: SimonSaysGame,
}
