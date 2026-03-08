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
import simonBgmSfx from '../../../assets/sounds/simon-says-bgm.mp3'
import simonComboSfx from '../../../assets/sounds/simon-says-combo.mp3'
import simonPerfectSfx from '../../../assets/sounds/simon-says-perfect.mp3'
import simonFreezeSfx from '../../../assets/sounds/simon-says-freeze.mp3'
import simonCountdownSfx from '../../../assets/sounds/simon-says-countdown.mp3'
import simonMirrorSfx from '../../../assets/sounds/simon-says-mirror.mp3'

// ─── Game Config ───────────────────────────────────────────────────
const ROUND_DURATION_MS = 50000
const LOW_TIME_THRESHOLD_MS = 10000
const POINTS_PER_LEVEL = 10
const SEQUENCE_SHOW_INTERVAL_MS = 600
const SEQUENCE_SHOW_DURATION_MS = 400
const PAUSE_BEFORE_PLAY_MS = 500
const SUCCESS_FLASH_DURATION_MS = 400
const FAIL_FLASH_DURATION_MS = 300

const MIN_SHOW_INTERVAL_MS = 220
const MIN_SHOW_DURATION_MS = 150
const SHOW_SPEED_FACTOR = 0.91

const FEVER_STREAK_THRESHOLD = 5
const FEVER_DURATION_LEVELS = 3
const FEVER_BONUS_MULTIPLIER = 2
const FEVER_TIME_BONUS_MS = 3000

const FAST_CLEAR_THRESHOLD_MS = 3000
const FAST_CLEAR_BONUS = 5

const PERFECT_STREAK_THRESHOLD = 3
const PERFECT_TIME_BONUS_MS = 2000

const TIME_FREEZE_DURATION_MS = 2000

// Level thresholds for extra colors and mirror mode
const PURPLE_UNLOCK_LEVEL = 7
const ORANGE_UNLOCK_LEVEL = 12
const MIRROR_UNLOCK_LEVEL = 10
const MIRROR_CHANCE = 0.35

// ─── Color System (6 colors) ──────────────────────────────────────
type SimonColor = 'red' | 'blue' | 'green' | 'yellow' | 'purple' | 'orange'

const SIMON_COLORS_BASE: readonly SimonColor[] = ['red', 'blue', 'green', 'yellow'] as const
const SIMON_COLORS_5: readonly SimonColor[] = ['red', 'blue', 'green', 'yellow', 'purple'] as const
const SIMON_COLORS_6: readonly SimonColor[] = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'] as const

const COLOR_MAP: Record<SimonColor, { hex: string; brightHex: string; glowHex: string; label: string; emoji: string }> = {
  red: { hex: '#ef4444', brightHex: '#fca5a5', glowHex: '#ff6b6b', label: 'Red', emoji: '🔴' },
  blue: { hex: '#3b82f6', brightHex: '#93c5fd', glowHex: '#60a5fa', label: 'Blue', emoji: '🔵' },
  green: { hex: '#22c55e', brightHex: '#86efac', glowHex: '#4ade80', label: 'Green', emoji: '🟢' },
  yellow: { hex: '#eab308', brightHex: '#fde047', glowHex: '#facc15', label: 'Yellow', emoji: '🟡' },
  purple: { hex: '#8b5cf6', brightHex: '#c4b5fd', glowHex: '#a78bfa', label: 'Purple', emoji: '🟣' },
  orange: { hex: '#f97316', brightHex: '#fdba74', glowHex: '#fb923c', label: 'Orange', emoji: '🟠' },
} as const

type GamePhase = 'watch' | 'play' | 'result' | 'countdown' | 'freeze'

const FEVER_COLORS: readonly SimonColor[] = ['red', 'blue'] as const

function getActiveColors(level: number): readonly SimonColor[] {
  if (level >= ORANGE_UNLOCK_LEVEL) return SIMON_COLORS_6
  if (level >= PURPLE_UNLOCK_LEVEL) return SIMON_COLORS_5
  return SIMON_COLORS_BASE
}

function pickRandomColor(level: number, isFever = false): SimonColor {
  const pool = isFever ? FEVER_COLORS : getActiveColors(level)
  return pool[Math.floor(Math.random() * pool.length)]
}

function extendSequence(sequence: SimonColor[], level: number, isFever = false): SimonColor[] {
  return [...sequence, pickRandomColor(level, isFever)]
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

function shouldMirror(level: number): boolean {
  return level >= MIRROR_UNLOCK_LEVEL && Math.random() < MIRROR_CHANCE
}

// ─── CSS ───────────────────────────────────────────────────────────
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

.ss-root.freeze-active {
  background: linear-gradient(180deg, #e0f2fe 0%, #bae6fd 30%, #7dd3fc 100%);
}

@keyframes ss-fever-pulse {
  0% { transform: scale(1); text-shadow: 0 0 8px #f59e0b; }
  50% { transform: scale(1.08); text-shadow: 0 0 24px #f59e0b, 0 0 48px #fbbf24; }
  100% { transform: scale(1); text-shadow: 0 0 8px #f59e0b; }
}

@keyframes ss-btn-glow {
  0% { box-shadow: 0 0 16px var(--ss-glow), inset 0 0 10px rgba(255,255,255,0.3); }
  50% { box-shadow: 0 0 36px var(--ss-glow), 0 0 56px var(--ss-glow), inset 0 0 20px rgba(255,255,255,0.5); }
  100% { box-shadow: 0 0 16px var(--ss-glow), inset 0 0 10px rgba(255,255,255,0.3); }
}

@keyframes ss-ripple {
  0% { transform: scale(0.6); opacity: 0.8; }
  100% { transform: scale(2.5); opacity: 0; }
}

@keyframes ss-score-pop {
  0% { transform: scale(1); }
  25% { transform: scale(1.35); }
  100% { transform: scale(1); }
}

@keyframes ss-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(5px); }
}

@keyframes ss-dot-bounce {
  0% { transform: scale(1); }
  50% { transform: scale(1.6); }
  100% { transform: scale(1); }
}

@keyframes ss-phase-enter {
  0% { transform: translateY(-14px) scale(0.8); opacity: 0; }
  100% { transform: translateY(0) scale(1); opacity: 1; }
}

@keyframes ss-time-pulse {
  0% { color: #ef4444; transform: scale(1); }
  50% { color: #dc2626; transform: scale(1.12); }
  100% { color: #ef4444; transform: scale(1); }
}

@keyframes ss-streak-fill {
  0% { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@keyframes ss-countdown-zoom {
  0% { transform: scale(3); opacity: 0; }
  40% { transform: scale(0.9); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@keyframes ss-mirror-rotate {
  0% { transform: rotateY(0deg); }
  50% { transform: rotateY(180deg); }
  100% { transform: rotateY(360deg); }
}

@keyframes ss-freeze-shimmer {
  0% { background-position: -100% 0; }
  100% { background-position: 200% 0; }
}

@keyframes ss-color-unlock {
  0% { transform: scale(0) rotate(-90deg); opacity: 0; }
  60% { transform: scale(1.2) rotate(10deg); opacity: 1; }
  100% { transform: scale(1) rotate(0); opacity: 1; }
}

@keyframes ss-perfect-glow {
  0% { box-shadow: 0 0 0 0 rgba(251,191,36,0.8); }
  50% { box-shadow: 0 0 40px 20px rgba(251,191,36,0.3); }
  100% { box-shadow: 0 0 0 0 rgba(251,191,36,0); }
}

@keyframes ss-shockwave {
  0% { transform: scale(0); opacity: 1; border-width: 4px; }
  100% { transform: scale(3); opacity: 0; border-width: 1px; }
}

.ss-score-area {
  text-align: center;
  padding: 16px 16px 4px;
  flex-shrink: 0;
}

.ss-score-value {
  font-size: clamp(48px, 14vw, 72px);
  font-weight: 900;
  color: #1f2937;
  margin: 0;
  line-height: 1;
  text-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

.ss-score-value.pop {
  animation: ss-score-pop 0.35s ease-out;
}

.ss-score-value.fever-score {
  color: #b45309;
  text-shadow: 0 0 16px rgba(251,191,36,0.6), 0 2px 8px rgba(0,0,0,0.1);
}

.ss-best-label {
  font-size: 16px;
  color: #9ca3af;
  margin: 2px 0 0;
  font-weight: 600;
}

.ss-stats-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 4px 16px 4px;
  flex-shrink: 0;
}

.ss-stat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 18px;
  font-weight: 800;
  color: #4b5563;
  background: rgba(0,0,0,0.06);
  padding: 4px 14px;
  border-radius: 20px;
}

.ss-stat-item .stat-icon {
  font-size: 20px;
}

.ss-time-value {
  font-size: 28px;
  font-weight: 800;
  color: #374151;
}

.ss-time-value.low-time {
  animation: ss-time-pulse 0.5s ease-in-out infinite;
}

.ss-level-value {
  font-size: 18px;
  font-weight: 800;
  color: #4b5563;
}

.ss-info-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 16px 2px;
  flex-shrink: 0;
  min-height: 32px;
}

.ss-fever-banner {
  font-size: clamp(1.1rem, 4vw, 1.5rem);
  font-weight: 900;
  color: #f59e0b;
  text-align: center;
  animation: ss-fever-pulse 0.5s ease-in-out infinite;
  margin: 0;
}

.ss-freeze-banner {
  font-size: clamp(1.1rem, 4vw, 1.5rem);
  font-weight: 900;
  color: #0ea5e9;
  text-align: center;
  animation: ss-fever-pulse 0.5s ease-in-out infinite;
  margin: 0;
  text-shadow: 0 0 12px rgba(14,165,233,0.5);
}

.ss-mirror-banner {
  font-size: clamp(0.9rem, 3vw, 1.2rem);
  font-weight: 800;
  color: #8b5cf6;
  text-align: center;
  margin: 0;
  animation: ss-mirror-rotate 1s ease-in-out;
}

.ss-streak-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 24px;
  flex-shrink: 0;
}

.ss-streak-track {
  flex: 1;
  height: 8px;
  background: #d1d5db;
  border-radius: 4px;
  overflow: hidden;
}

.ss-streak-fill {
  height: 100%;
  background: linear-gradient(90deg, #a78bfa, #8b5cf6);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.ss-streak-fill.fever {
  background: linear-gradient(90deg, #fbbf24, #f59e0b);
}

.ss-streak-label {
  font-size: 12px;
  font-weight: 700;
  color: #6b7280;
  white-space: nowrap;
}

.ss-phase-label {
  text-align: center;
  font-size: clamp(1.2rem, 4.5vw, 1.8rem);
  font-weight: 900;
  color: #4b5563;
  margin: 4px 0;
  flex-shrink: 0;
  animation: ss-phase-enter 0.3s ease-out;
}

.ss-phase-label.watch { color: #3b82f6; }
.ss-phase-label.play { color: #22c55e; }
.ss-phase-label.success { color: #f59e0b; }
.ss-phase-label.fail { color: #ef4444; animation: ss-shake 0.3s ease-in-out; }
.ss-phase-label.freeze { color: #0ea5e9; }

.ss-grid-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 12px;
  min-height: 0;
}

.ss-grid {
  display: grid;
  gap: clamp(8px, 2vw, 12px);
  width: 100%;
  max-width: 380px;
}

.ss-grid.grid-4 {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  aspect-ratio: 1;
}

.ss-grid.grid-5 {
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.ss-grid.grid-6 {
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 1fr 1fr;
}

.ss-btn {
  position: relative;
  border: none;
  border-radius: clamp(18px, 5vw, 28px);
  background: var(--ss-color);
  cursor: pointer;
  transition: transform 0.08s, filter 0.08s, box-shadow 0.15s;
  overflow: hidden;
  box-shadow: 0 6px 0 rgba(0,0,0,0.25), 0 0 0 3px rgba(0,0,0,0.08);
  outline: none;
  min-height: clamp(80px, 22vw, 120px);
}

.ss-grid.grid-5 .ss-btn,
.ss-grid.grid-6 .ss-btn {
  min-height: clamp(70px, 18vw, 100px);
}

.ss-btn:active:not(:disabled) {
  transform: scale(0.92) translateY(3px);
  box-shadow: 0 1px 0 rgba(0,0,0,0.25);
}

.ss-btn:disabled {
  filter: brightness(0.5) saturate(0.35);
  cursor: default;
}

.ss-btn.active {
  filter: brightness(1.6) saturate(1.4);
  transform: scale(1.06);
  --ss-glow: var(--ss-glow-color);
  animation: ss-btn-glow 0.4s ease-in-out;
  box-shadow: 0 0 24px var(--ss-glow-color), 0 4px 0 rgba(0,0,0,0.2);
}

.ss-btn.unlocking {
  animation: ss-color-unlock 0.6s ease-out;
}

.ss-btn-inner {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(ellipse at 35% 30%, rgba(255,255,255,0.5) 0%, transparent 60%);
}

.ss-btn-ripple {
  position: absolute;
  width: 60%;
  height: 60%;
  top: 20%;
  left: 20%;
  border-radius: 50%;
  background: rgba(255,255,255,0.5);
  animation: ss-ripple 0.5s ease-out forwards;
  pointer-events: none;
}

.ss-btn-emoji {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(28px, 8vw, 42px);
  opacity: 0.3;
  pointer-events: none;
}

.ss-dots-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px 14px;
  flex-wrap: wrap;
  flex-shrink: 0;
  min-height: 40px;
}

.ss-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid rgba(0,0,0,0.15);
  transition: background-color 0.2s, transform 0.2s, box-shadow 0.2s;
}

.ss-dot.done {
  transform: scale(0.7);
  opacity: 0.4;
}

.ss-dot.current {
  transform: scale(1.4);
  box-shadow: 0 0 12px rgba(255,255,255,0.9);
  animation: ss-dot-bounce 0.4s ease-in-out;
}

.ss-dot.revealed {
  transform: scale(1.15);
}

.ss-combo-label {
  text-align: center;
  font-weight: 900;
  margin: 0;
  flex-shrink: 0;
}

.ss-countdown-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 25;
  background: rgba(0,0,0,0.2);
  pointer-events: none;
}

.ss-countdown-text {
  font-size: clamp(64px, 20vw, 96px);
  font-weight: 900;
  color: #fff;
  text-shadow: 0 4px 16px rgba(0,0,0,0.4), 0 0 40px rgba(59,130,246,0.5);
  animation: ss-countdown-zoom 0.6s ease-out;
}

.ss-shockwave {
  position: absolute;
  border: 3px solid rgba(251,191,36,0.6);
  border-radius: 50%;
  pointer-events: none;
  animation: ss-shockwave 0.6s ease-out forwards;
}

.ss-freeze-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 18;
  background: linear-gradient(90deg, transparent 0%, rgba(14,165,233,0.1) 50%, transparent 100%);
  background-size: 200% 100%;
  animation: ss-freeze-shimmer 1.5s linear infinite;
}

.ss-bonus-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 13px;
  font-weight: 800;
  margin: 0 4px;
}
`

function SimonSaysGame({ onFinish, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<GamePhase>('countdown')
  const [sequence, setSequence] = useState<SimonColor[]>([])
  const [activeColor, setActiveColor] = useState<SimonColor | null>(null)
  const [playerIndex, setPlayerIndex] = useState(0)
  const [successFlash, setSuccessFlash] = useState(false)
  const [failFlash, setFailFlash] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [isFreeze, setIsFreeze] = useState(false)
  const [isMirror, setIsMirror] = useState(false)
  const [consecutiveClears, setConsecutiveClears] = useState(0)
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [scorePop, setScorePop] = useState(false)
  const [showRipple, setShowRipple] = useState<SimonColor | null>(null)
  const [countdownValue, setCountdownValue] = useState(3)
  const [shockwaves, setShockwaves] = useState<{ id: number; x: number; y: number }[]>([])
  const [newColorUnlocked, setNewColorUnlocked] = useState<SimonColor | null>(null)
  const [lastBonusTag, setLastBonusTag] = useState<string | null>(null)

  const effects = useGameEffects({ maxParticles: 50 })

  const scoreRef = useRef(0)
  const levelRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const phaseRef = useRef<GamePhase>('countdown')
  const sequenceRef = useRef<SimonColor[]>([])
  const playerIndexRef = useRef(0)
  const finishedRef = useRef(false)
  const consecutiveClearsRef = useRef(0)
  const perfectStreakRef = useRef(0)
  const isFeverRef = useRef(false)
  const isFreezeRef = useRef(false)
  const isMirrorRef = useRef(false)
  const feverLevelsRemainingRef = useRef(0)
  const freezeEndsAtRef = useRef(0)
  const levelStartAtRef = useRef(performance.now())
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const showSequenceTimerRef = useRef<number | null>(null)
  const successFlashTimerRef = useRef<number | null>(null)
  const failFlashTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)
  const shockwaveIdRef = useRef(0)
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const prevActiveColorsCountRef = useRef(4)

  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const levelUpAudioRef = useRef<HTMLAudioElement | null>(null)
  const beepAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const freezeAudioRef = useRef<HTMLAudioElement | null>(null)
  const countdownAudioRef = useRef<HTMLAudioElement | null>(null)
  const mirrorAudioRef = useRef<HTMLAudioElement | null>(null)

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
      audio.volume = Math.min(1, Math.max(0, volume))
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const spawnShockwave = useCallback((x: number, y: number) => {
    shockwaveIdRef.current += 1
    const sw = { id: shockwaveIdRef.current, x, y }
    setShockwaves(prev => [...prev, sw])
    setTimeout(() => {
      setShockwaves(prev => prev.filter(s => s.id !== sw.id))
    }, 600)
  }, [])

  // ─── Sequence Display ────────────────────────────────────────────
  const startShowingSequence = useCallback(
    (seq: SimonColor[], mirror = false) => {
      phaseRef.current = 'watch'
      setPhase('watch')
      playerIndexRef.current = 0
      setPlayerIndex(0)
      isMirrorRef.current = mirror
      setIsMirror(mirror)

      if (mirror) {
        playAudio(mirrorAudioRef, 0.5)
      }

      const displaySeq = mirror ? [...seq].reverse() : seq

      const { interval, duration } = getShowTiming(levelRef.current)
      let showIndex = 0

      const showNext = () => {
        if (finishedRef.current) return
        if (showIndex >= displaySeq.length) {
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

        const color = displaySeq[showIndex]
        setActiveColor(color)
        playAudio(beepAudioRef, 0.45, 0.85 + showIndex * 0.06)

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

  // ─── Game Over ───────────────────────────────────────────────────
  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(showSequenceTimerRef)
    clearTimeoutSafe(successFlashTimerRef)
    clearTimeoutSafe(failFlashTimerRef)
    effects.cleanup()

    if (bgmRef.current) {
      bgmRef.current.pause()
      bgmRef.current.currentTime = 0
    }

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  // ─── Level Advance ──────────────────────────────────────────────
  const advanceToNextLevel = useCallback(() => {
    if (finishedRef.current) return

    const clearTimeMs = performance.now() - levelStartAtRef.current
    const isFastClear = clearTimeMs < FAST_CLEAR_THRESHOLD_MS
    const fastClearBonus = isFastClear ? FAST_CLEAR_BONUS : 0
    const feverMultiplier = isFeverRef.current ? FEVER_BONUS_MULTIPLIER : 1
    const earned = (POINTS_PER_LEVEL + fastClearBonus) * feverMultiplier

    const nextScore = scoreRef.current + earned
    scoreRef.current = nextScore
    setScore(nextScore)
    setScorePop(true)
    setTimeout(() => setScorePop(false), 350)

    const nextLevel = levelRef.current + 1
    levelRef.current = nextLevel
    setLevel(nextLevel)

    consecutiveClearsRef.current += 1
    setConsecutiveClears(consecutiveClearsRef.current)

    // Perfect streak (fast clears in a row)
    if (isFastClear) {
      perfectStreakRef.current += 1
      setPerfectStreak(perfectStreakRef.current)

      if (perfectStreakRef.current >= PERFECT_STREAK_THRESHOLD) {
        // Perfect bonus: time freeze!
        perfectStreakRef.current = 0
        setPerfectStreak(0)
        isFreezeRef.current = true
        setIsFreeze(true)
        freezeEndsAtRef.current = performance.now() + TIME_FREEZE_DURATION_MS
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + PERFECT_TIME_BONUS_MS)
        setRemainingMs(remainingMsRef.current)
        playAudio(freezeAudioRef, 0.6)
        playAudio(perfectAudioRef, 0.7)
        spawnShockwave(200, 300)
        effects.spawnParticles(20, 200, 300, ['❄️', '⏸️', '💎', '✨', '🌟'])
        effects.triggerFlash('rgba(14,165,233,0.4)', 300)
        setLastBonusTag('PERFECT! TIME FREEZE')
        setTimeout(() => setLastBonusTag(null), 1500)
      }
    } else {
      perfectStreakRef.current = 0
      setPerfectStreak(0)
    }

    // Check for new color unlock
    const prevColorCount = prevActiveColorsCountRef.current
    const newColorCount = getActiveColors(nextLevel).length
    if (newColorCount > prevColorCount) {
      prevActiveColorsCountRef.current = newColorCount
      const newColor = newColorCount === 5 ? 'purple' : 'orange'
      setNewColorUnlocked(newColor)
      effects.triggerFlash(`${COLOR_MAP[newColor].glowHex}66`, 400)
      effects.spawnParticles(12, 200, 300, [COLOR_MAP[newColor].emoji, '🎉', '⭐', '✨'])
      setLastBonusTag(`NEW COLOR: ${COLOR_MAP[newColor].label.toUpperCase()}!`)
      setTimeout(() => { setNewColorUnlocked(null); setLastBonusTag(null) }, 2000)
    }

    // Fever logic
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
      effects.spawnParticles(18, 200, 300, ['🔥', '⚡', '💥', '🌟', '✨'])
      spawnShockwave(200, 300)
      setLastBonusTag('FEVER MODE x2!')
      setTimeout(() => setLastBonusTag(null), 1500)
    }

    // Combo sound at milestones
    if (nextLevel % 5 === 0) {
      playAudio(comboAudioRef, 0.6, 1 + (nextLevel / 50))
      effects.spawnParticles(10, 200, 200, ['🎯', '💯', '🔥'])
    }

    const nextSequence = extendSequence(sequenceRef.current, nextLevel, isFeverRef.current)
    sequenceRef.current = nextSequence
    setSequence(nextSequence)

    setSuccessFlash(true)
    clearTimeoutSafe(successFlashTimerRef)
    successFlashTimerRef.current = window.setTimeout(() => {
      successFlashTimerRef.current = null
      setSuccessFlash(false)

      // Determine if this level should be mirrored
      const mirror = shouldMirror(nextLevel)
      startShowingSequence(nextSequence, mirror)
    }, SUCCESS_FLASH_DURATION_MS)

    effects.comboHitBurst(200, 300, nextLevel, earned)
    effects.showScorePopup(earned, 200, 280, isFeverRef.current ? '#fbbf24' : '#22c55e')

    if (fastClearBonus > 0) {
      effects.showScorePopup(fastClearBonus, 260, 240, '#fbbf24')
      if (!lastBonusTag) {
        setLastBonusTag('FAST CLEAR!')
        setTimeout(() => setLastBonusTag(null), 1000)
      }
    }

    playAudio(levelUpAudioRef, 0.6, 1 + Math.min(0.35, nextLevel * 0.02))
  }, [playAudio, startShowingSequence, spawnShockwave])

  // ─── Game Over (wrong tap) ──────────────────────────────────────
  const handleGameOver = useCallback(() => {
    if (finishedRef.current) return

    consecutiveClearsRef.current = 0
    setConsecutiveClears(0)
    perfectStreakRef.current = 0
    setPerfectStreak(0)
    isFeverRef.current = false
    setIsFever(false)
    isFreezeRef.current = false
    setIsFreeze(false)
    feverLevelsRemainingRef.current = 0

    phaseRef.current = 'result'
    setPhase('result')
    setFailFlash(true)
    playAudio(wrongAudioRef, 0.7)
    playAudio(gameOverAudioRef, 0.5, 0.95)

    effects.triggerShake(12)
    effects.triggerFlash('rgba(239,68,68,0.5)', 200)
    effects.spawnParticles(8, 200, 300, ['💔', '😵', '💢', '❌'])

    clearTimeoutSafe(failFlashTimerRef)
    failFlashTimerRef.current = window.setTimeout(() => {
      failFlashTimerRef.current = null
      setFailFlash(false)
      finishGame()
    }, FAIL_FLASH_DURATION_MS)
  }, [finishGame, playAudio])

  // ─── Color Tap Handler ──────────────────────────────────────────
  const handleColorTap = useCallback(
    (color: SimonColor) => {
      if (finishedRef.current || phaseRef.current !== 'play') return

      // If mirror mode, the expected sequence is reversed
      const effectiveSequence = isMirrorRef.current
        ? [...sequenceRef.current].reverse()
        : sequenceRef.current
      const expectedColor = effectiveSequence[playerIndexRef.current]

      if (color !== expectedColor) {
        handleGameOver()
        return
      }

      setActiveColor(color)
      setShowRipple(color)
      setTimeout(() => setShowRipple(null), 500)
      playAudio(correctAudioRef, 0.55, 1 + playerIndexRef.current * 0.04)

      // Color-specific particle burst
      const colorInfo = COLOR_MAP[color]
      effects.spawnParticles(5, 200, 350, [colorInfo.emoji, '✨', '⭐'], 'circle')
      effects.triggerFlash(`${colorInfo.glowHex}33`, 80)

      window.setTimeout(() => {
        if (!finishedRef.current) setActiveColor(null)
      }, 150)

      const nextIndex = playerIndexRef.current + 1
      playerIndexRef.current = nextIndex
      setPlayerIndex(nextIndex)

      if (nextIndex >= effectiveSequence.length) {
        advanceToNextLevel()
      }
    },
    [advanceToNextLevel, handleGameOver, playAudio],
  )

  // ─── Audio Setup ────────────────────────────────────────────────
  useEffect(() => {
    const audioEntries: [{ current: HTMLAudioElement | null }, string][] = [
      [correctAudioRef, simonCorrectSfx],
      [wrongAudioRef, simonWrongSfx],
      [feverAudioRef, simonFeverSfx],
      [levelUpAudioRef, simonLevelUpSfx],
      [beepAudioRef, simonBeepSfx],
      [gameOverAudioRef, gameOverHitSfx],
    ]

    const extraEntries: [{ current: HTMLAudioElement | null }, string][] = [
      [comboAudioRef, simonComboSfx],
      [perfectAudioRef, simonPerfectSfx],
      [freezeAudioRef, simonFreezeSfx],
      [countdownAudioRef, simonCountdownSfx],
      [mirrorAudioRef, simonMirrorSfx],
    ]

    for (const [ref, src] of [...audioEntries, ...extraEntries]) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    }

    // BGM
    const bgm = new Audio(simonBgmSfx)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = 0.25
    bgmRef.current = bgm

    return () => {
      clearTimeoutSafe(showSequenceTimerRef)
      clearTimeoutSafe(successFlashTimerRef)
      clearTimeoutSafe(failFlashTimerRef)
      effects.cleanup()
      for (const [ref] of [...audioEntries, ...extraEntries]) ref.current = null
      if (bgmRef.current) {
        bgmRef.current.pause()
        bgmRef.current = null
      }
    }
  }, [])

  // ─── Countdown Start ────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'countdown') return

    let count = 3
    setCountdownValue(count)

    const tick = () => {
      playAudio(countdownAudioRef, 0.5, 1 + (3 - count) * 0.1)
      effects.triggerFlash('rgba(59,130,246,0.2)', 150)

      if (count <= 0) {
        // Start the game
        const initialSeq = [pickRandomColor(1)]
        sequenceRef.current = initialSeq
        setSequence(initialSeq)
        phaseRef.current = 'watch'
        setPhase('watch')

        // Start BGM
        if (bgmRef.current) {
          void bgmRef.current.play().catch(() => {})
        }

        startShowingSequence(initialSeq)
        return
      }

      setCountdownValue(count)
      count -= 1
      setTimeout(tick, 700)
    }

    setTimeout(tick, 300)
  }, [phase === 'countdown'])

  // ─── Game Loop ──────────────────────────────────────────────────
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // Time freeze check
      if (isFreezeRef.current) {
        if (now >= freezeEndsAtRef.current) {
          isFreezeRef.current = false
          setIsFreeze(false)
        }
        // Don't decrease time during freeze
      } else if (phaseRef.current !== 'countdown') {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
        setRemainingMs(remainingMsRef.current)
      }

      effects.updateParticles()

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !isFreezeRef.current) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(beepAudioRef, 0.3, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 12000)
          effects.triggerFlash('rgba(239,68,68,0.12)', 60)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (remainingMsRef.current <= 0 && phaseRef.current !== 'countdown') {
        playAudio(gameOverAudioRef, 0.6, 0.95)
        effects.spawnParticles(10, 200, 300, ['⏰', '💀', '😱', '❌'])
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

  // ─── Derived State ──────────────────────────────────────────────
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && !isFreeze
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const activeColors = useMemo(() => getActiveColors(level), [level])

  const gridClass = activeColors.length <= 4 ? 'grid-4' : activeColors.length === 5 ? 'grid-5' : 'grid-6'

  const phaseLabel = (() => {
    if (phase === 'countdown') return ''
    if (isFreeze) return 'TIME FREEZE!'
    if (isMirror && phase === 'watch') return 'MIRROR MODE!'
    if (isFever) {
      return phase === 'watch' ? 'FEVER! Memorize!' : phase === 'play' ? 'FEVER! x2 Score!' : 'Game Over!'
    }
    return phase === 'watch' ? 'Watch carefully!' : phase === 'play' ? 'Your turn!' : 'Game Over!'
  })()

  const comboLabel = getComboLabel(level)
  const comboColor = getComboColor(level)

  const streakRatio = isFever
    ? feverLevelsRemainingRef.current / FEVER_DURATION_LEVELS
    : consecutiveClears / FEVER_STREAK_THRESHOLD

  const phaseClass = isFreeze ? 'freeze' : phase === 'result' ? (failFlash ? 'fail' : '') : successFlash ? 'success' : phase

  return (
    <section
      className={`mini-game-panel ss-root ${isFever ? 'fever-active' : ''} ${isFreeze ? 'freeze-active' : ''}`}
      aria-label="simon-says-game"
      style={effects.getShakeStyle()}
    >
      <style>{SIMON_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Shockwaves */}
      {shockwaves.map(sw => (
        <div key={sw.id} className="ss-shockwave" style={{
          left: `${sw.x - 50}px`, top: `${sw.y - 50}px`,
          width: '100px', height: '100px',
        }} />
      ))}

      {/* Freeze shimmer overlay */}
      {isFreeze && <div className="ss-freeze-overlay" />}

      {/* Countdown overlay */}
      {phase === 'countdown' && (
        <div className="ss-countdown-overlay">
          <span className="ss-countdown-text" key={countdownValue}>
            {countdownValue > 0 ? countdownValue : 'GO!'}
          </span>
        </div>
      )}

      {/* Score - top center, huge */}
      <div className="ss-score-area">
        <p className={`ss-score-value ${scorePop ? 'pop' : ''} ${isFever ? 'fever-score' : ''}`}>
          {score.toLocaleString()}
        </p>
        <p className="ss-best-label">BEST {displayedBestScore.toLocaleString()}</p>
      </div>

      {/* Stats row: level + timer */}
      <div className="ss-stats-row">
        <div className="ss-stat-item">
          <span className="stat-icon">⭐</span>
          <span className="ss-level-value">LV.{level}</span>
        </div>
        <div className="ss-stat-item">
          <span className="stat-icon">⏱️</span>
          <span className={`ss-time-value ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </span>
        </div>
        {perfectStreak > 0 && (
          <div className="ss-stat-item" style={{ background: 'rgba(251,191,36,0.15)' }}>
            <span className="stat-icon">⚡</span>
            <span style={{ color: '#f59e0b', fontSize: '16px' }}>x{perfectStreak}</span>
          </div>
        )}
      </div>

      {/* Streak bar */}
      <div className="ss-streak-bar">
        <span className="ss-streak-label">{isFever ? 'FEVER' : 'STREAK'}</span>
        <div className="ss-streak-track">
          <div className={`ss-streak-fill ${isFever ? 'fever' : ''}`} style={{ width: `${Math.min(100, streakRatio * 100)}%` }} />
        </div>
        <span className="ss-streak-label">{isFever ? `${feverLevelsRemainingRef.current} left` : `${consecutiveClears}/${FEVER_STREAK_THRESHOLD}`}</span>
      </div>

      {/* Info row: fever / combo / bonus tags */}
      <div className="ss-info-row">
        {isFreeze ? (
          <p className="ss-freeze-banner">TIME FREEZE! +{(PERFECT_TIME_BONUS_MS / 1000).toFixed(0)}s</p>
        ) : isFever ? (
          <p className="ss-fever-banner">FEVER MODE x{FEVER_BONUS_MULTIPLIER}</p>
        ) : isMirror && phase === 'watch' ? (
          <p className="ss-mirror-banner">MIRROR MODE</p>
        ) : comboLabel ? (
          <p className="ss-combo-label" style={{ fontSize: 'clamp(1rem, 3.5vw, 1.4rem)', color: comboColor }}>{comboLabel}</p>
        ) : lastBonusTag ? (
          <span className="ss-bonus-tag" style={{ background: 'rgba(251,191,36,0.2)', color: '#b45309' }}>{lastBonusTag}</span>
        ) : null}
      </div>

      {/* Phase label */}
      {phase !== 'countdown' && (
        <p className={`ss-phase-label ${phaseClass}`}>
          {phaseLabel}
        </p>
      )}

      {/* Color grid */}
      <div className="ss-grid-wrap">
        <div className={`ss-grid ${gridClass}`}>
          {activeColors.map((color) => {
            const info = COLOR_MAP[color]
            const isActive = activeColor === color
            const isDisabled = phase !== 'play' || finishedRef.current
            const isNewUnlock = newColorUnlocked === color

            return (
              <button
                className={`ss-btn ${isActive ? 'active' : ''} ${isNewUnlock ? 'unlocking' : ''}`}
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
                <span className="ss-btn-emoji">{info.emoji}</span>
                {showRipple === color && <span className="ss-btn-ripple" />}
              </button>
            )
          })}
        </div>
      </div>

      {/* Sequence dots */}
      <div className="ss-dots-row">
        {sequence.map((color, index) => {
          const effectiveColor = isMirror ? sequence[sequence.length - 1 - index] : color
          const isDone = phase === 'play' && index < playerIndex
          const isCurrent = phase === 'play' && index === playerIndex
          const isRevealed = phase === 'watch'

          return (
            <span
              className={`ss-dot ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${isRevealed ? 'revealed' : ''}`}
              key={`dot-${index}`}
              style={{
                backgroundColor: isRevealed || isDone
                  ? COLOR_MAP[effectiveColor].hex
                  : isCurrent ? '#ffffff' : '#4b5563',
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
