import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaAvatar from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import perfectSfx from '../../../assets/sounds/rhythm-tap-perfect.mp3'
import missSfx from '../../../assets/sounds/rhythm-tap-miss.mp3'
import feverSfx from '../../../assets/sounds/rhythm-tap-fever.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// --- HP system ---
const MAX_HP = 100
const MISS_HP_DAMAGE = 20
const GOOD_HP_HEAL = 2
const PERFECT_HP_HEAL = 5
const LOW_HP_THRESHOLD = 30

// --- Rhythm ---
const INITIAL_BPM = 72
const MAX_BPM = 160
const BPM_INCREASE_PER_SECOND = 3.2
const TARGET_RING_RADIUS = 80
const SHRINK_START_RADIUS = 220
const PERFECT_THRESHOLD = 8
const GOOD_THRESHOLD = 22
const PERFECT_SCORE = 3
const GOOD_SCORE = 1
const JUDGMENT_DISPLAY_MS = 480
const PULSE_DURATION_MS = 300
const RING_STROKE_WIDTH = 5
const TARGET_STROKE_WIDTH = 4
const SVG_SIZE = 340
const SVG_CENTER = SVG_SIZE / 2

// --- Fever ---
const FEVER_COMBO_THRESHOLD = 15
const FEVER_DURATION_MS = 10000
const FEVER_PERFECT_THRESHOLD = 14
const FEVER_GOOD_THRESHOLD = 30
const FEVER_SCORE_MULTIPLIER = 2
const FEVER_HP_HEAL = 15
const PERFECT_STREAK_BONUS_THRESHOLD = 5
const PERFECT_STREAK_BONUS_SCORE = 10

type Judgment = 'PERFECT!' | 'GOOD' | 'MISS'

interface BeatNote {
  readonly id: number
  readonly spawnedAt: number
  readonly beatDurationMs: number
}

interface HitRipple {
  readonly id: number
  readonly createdAt: number
  readonly color: string
}

function bpmToBeatMs(bpm: number): number {
  return 60000 / bpm
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function currentBpm(elapsedMs: number): number {
  return Math.min(MAX_BPM, INITIAL_BPM + (elapsedMs / 1000) * BPM_INCREASE_PER_SECOND)
}

function radiusForNote(note: BeatNote, now: number): number {
  const elapsed = now - note.spawnedAt
  const progress = clampNumber(elapsed / note.beatDurationMs, 0, 1)
  return SHRINK_START_RADIUS + (TARGET_RING_RADIUS - SHRINK_START_RADIUS) * progress
}

function judgeRadius(radius: number, isFever: boolean): Judgment {
  const distance = Math.abs(radius - TARGET_RING_RADIUS)
  const perfectThresh = isFever ? FEVER_PERFECT_THRESHOLD : PERFECT_THRESHOLD
  const goodThresh = isFever ? FEVER_GOOD_THRESHOLD : GOOD_THRESHOLD
  if (distance <= perfectThresh) return 'PERFECT!'
  if (distance <= goodThresh) return 'GOOD'
  return 'MISS'
}

function judgmentScore(judgment: Judgment): number {
  if (judgment === 'PERFECT!') return PERFECT_SCORE
  if (judgment === 'GOOD') return GOOD_SCORE
  return 0
}

function judgmentColor(judgment: Judgment): string {
  if (judgment === 'PERFECT!') return '#ec4899'
  if (judgment === 'GOOD') return '#facc15'
  return '#ef4444'
}

function ringColor(judgment: Judgment | null, isFever: boolean): string {
  if (judgment === 'PERFECT!') return '#ec4899'
  if (judgment === 'GOOD') return '#facc15'
  if (judgment === 'MISS') return '#ef4444'
  return isFever ? '#fbbf24' : '#a855f7'
}

function RhythmTapGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [hp, setHp] = useState(MAX_HP)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [activeNotes, setActiveNotes] = useState<BeatNote[]>([])
  const [judgment, setJudgment] = useState<Judgment | null>(null)
  const [isPulseActive, setPulseActive] = useState(false)
  const [currentBpmDisplay, setCurrentBpmDisplay] = useState(INITIAL_BPM)
  const [isFeverMode, setIsFeverMode] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [hitRipples, setHitRipples] = useState<HitRipple[]>([])
  const [bgPulseIntensity, setBgPulseIntensity] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [renderNow, setRenderNow] = useState(() => performance.now())

  const scoreRef = useRef(0)
  const hpRef = useRef(MAX_HP)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const activeNotesRef = useRef<BeatNote[]>([])
  const nextNoteIdRef = useRef(0)
  const lastBeatSpawnAtRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const gameStartAtRef = useRef<number | null>(null)
  const judgmentTimerRef = useRef<number | null>(null)
  const pulseTimerRef = useRef<number | null>(null)
  const feverActiveRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const perfectStreakRef = useRef(0)
  const rippleIdRef = useRef(0)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const missAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const applyHpChange = useCallback((delta: number) => {
    hpRef.current = clampNumber(hpRef.current + delta, 0, MAX_HP)
    setHp(hpRef.current)
  }, [])

  const addHitRipple = useCallback((color: string) => {
    rippleIdRef.current += 1
    const ripple: HitRipple = { id: rippleIdRef.current, createdAt: performance.now(), color }
    setHitRipples(prev => [...prev, ripple].slice(-4))
  }, [])

  const activateFever = useCallback(() => {
    feverActiveRef.current = true
    feverRemainingMsRef.current = FEVER_DURATION_MS
    setIsFeverMode(true)
    setFeverRemainingMs(FEVER_DURATION_MS)
    applyHpChange(FEVER_HP_HEAL)
    playAudio(feverAudioRef, 0.6)
  }, [playAudio, applyHpChange])

  const deactivateFever = useCallback(() => {
    feverActiveRef.current = false
    feverRemainingMsRef.current = 0
    setIsFeverMode(false)
    setFeverRemainingMs(0)
  }, [])

  const showJudgment = useCallback((j: Judgment) => {
    setJudgment(j)
    clearTimeoutSafe(judgmentTimerRef)
    judgmentTimerRef.current = window.setTimeout(() => {
      judgmentTimerRef.current = null
      setJudgment(null)
    }, JUDGMENT_DISPLAY_MS)
  }, [])

  const triggerPulse = useCallback(() => {
    setPulseActive(true)
    clearTimeoutSafe(pulseTimerRef)
    pulseTimerRef.current = window.setTimeout(() => {
      pulseTimerRef.current = null
      setPulseActive(false)
    }, PULSE_DURATION_MS)
  }, [])

  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(judgmentTimerRef)
    clearTimeoutSafe(pulseTimerRef)
    playAudio(gameOverAudioRef, 0.64, 0.95)

    const elapsed = gameStartAtRef.current !== null ? performance.now() - gameStartAtRef.current : 0
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, elapsed))
    onFinishRef.current({
      score: Math.max(0, scoreRef.current),
      durationMs: elapsedMs,
    })
  }, [playAudio])

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    const notes = activeNotesRef.current
    if (notes.length === 0) {
      comboRef.current = 0
      setCombo(0)
      perfectStreakRef.current = 0
      setPerfectStreak(0)
      applyHpChange(-MISS_HP_DAMAGE)
      showJudgment('MISS')
      playAudio(missAudioRef, 0.4)
      effects.triggerShake(5)
      effects.triggerFlash('rgba(239,68,68,0.25)')
      addHitRipple('#ef4444')
      if (feverActiveRef.current) deactivateFever()
      if (hpRef.current <= 0) finishGame()
      return
    }

    const now = window.performance.now()
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (let i = 0; i < notes.length; i++) {
      const r = radiusForNote(notes[i], now)
      const d = Math.abs(r - TARGET_RING_RADIUS)
      if (d < bestDistance) {
        bestDistance = d
        bestIndex = i
      }
    }

    const closestNote = notes[bestIndex]
    const radius = radiusForNote(closestNote, now)
    const j = judgeRadius(radius, feverActiveRef.current)
    let delta = judgmentScore(j)

    if (feverActiveRef.current && delta > 0) {
      delta *= FEVER_SCORE_MULTIPLIER
    }

    if (j === 'PERFECT!') {
      const nextPerfectStreak = perfectStreakRef.current + 1
      perfectStreakRef.current = nextPerfectStreak
      setPerfectStreak(nextPerfectStreak)
      applyHpChange(PERFECT_HP_HEAL)
      if (nextPerfectStreak > 0 && nextPerfectStreak % PERFECT_STREAK_BONUS_THRESHOLD === 0) {
        delta += PERFECT_STREAK_BONUS_SCORE
        effects.comboHitBurst(130, 130, nextPerfectStreak, PERFECT_STREAK_BONUS_SCORE, ['\u26a1', '\u{1f48e}', '\u{1f31f}'])
        effects.showScorePopup(PERFECT_STREAK_BONUS_SCORE, 130, 80)
      }
    } else if (j === 'GOOD') {
      perfectStreakRef.current = 0
      setPerfectStreak(0)
      applyHpChange(GOOD_HP_HEAL)
    } else {
      perfectStreakRef.current = 0
      setPerfectStreak(0)
      applyHpChange(-MISS_HP_DAMAGE)
    }

    const nextScore = Math.max(0, scoreRef.current + delta)
    scoreRef.current = nextScore
    setScore(nextScore)

    setBgPulseIntensity(Math.min(1, comboRef.current / 30))

    if (j === 'MISS') {
      comboRef.current = 0
      setCombo(0)
      playAudio(missAudioRef, 0.4)
      effects.triggerShake(5)
      effects.triggerFlash('rgba(239,68,68,0.25)')
      addHitRipple('#ef4444')
      if (feverActiveRef.current) deactivateFever()
      if (hpRef.current <= 0) finishGame()
    } else {
      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      setCombo(nextCombo)
      if (nextCombo > maxComboRef.current) {
        maxComboRef.current = nextCombo
        setMaxCombo(nextCombo)
      }

      if (nextCombo === FEVER_COMBO_THRESHOLD && !feverActiveRef.current) {
        activateFever()
        effects.comboHitBurst(130, 130, nextCombo, delta, ['\u{1f525}', '\u26a1', '\u{1f4a5}', '\u{1f31f}'])
      } else if (j === 'PERFECT!') {
        playAudio(perfectAudioRef, 0.5, 1 + nextCombo * 0.008)
        triggerPulse()
        effects.comboHitBurst(130, 130, nextCombo, delta)
        addHitRipple('#ec4899')
      } else {
        playAudio(tapHitAudioRef, 0.45, 1 + nextCombo * 0.005)
        effects.triggerFlash(feverActiveRef.current ? 'rgba(251,191,36,0.3)' : 'rgba(250,204,21,0.2)')
        effects.spawnParticles(3, 130, 130)
        effects.showScorePopup(delta, 130, 100)
        addHitRipple('#facc15')
      }
    }

    showJudgment(j)

    const nextNotes = [...notes]
    nextNotes.splice(bestIndex, 1)
    activeNotesRef.current = nextNotes
    setActiveNotes(nextNotes)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- effects methods are stable refs
  }, [activateFever, applyHpChange, deactivateFever, finishGame, playAudio, showJudgment, triggerPulse, addHitRipple])

  useEffect(() => {
    const audioSources = [
      { ref: tapHitAudioRef, src: tapHitSfx },
      { ref: tapHitStrongAudioRef, src: tapHitStrongSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
      { ref: perfectAudioRef, src: perfectSfx },
      { ref: missAudioRef, src: missSfx },
      { ref: feverAudioRef, src: feverSfx },
    ]
    for (const { ref, src } of audioSources) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    }

    return () => {
      clearTimeoutSafe(judgmentTimerRef)
      clearTimeoutSafe(pulseTimerRef)
      for (const { ref } of audioSources) ref.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault()
        handleTap()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, onExit])

  useEffect(() => {
    gameStartAtRef.current = null
    lastBeatSpawnAtRef.current = 0

    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (gameStartAtRef.current === null) {
        gameStartAtRef.current = now
        lastFrameAtRef.current = now
        lastBeatSpawnAtRef.current = now
      }

      if (lastFrameAtRef.current === null) {
        lastFrameAtRef.current = now
      }

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // Elapsed time display
      const totalElapsed = now - gameStartAtRef.current
      setElapsedSec(Math.floor(totalElapsed / 1000))

      // Fever timer
      if (feverActiveRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          deactivateFever()
        }
      }

      const elapsedMs = now - gameStartAtRef.current
      const bpm = currentBpm(elapsedMs)
      setCurrentBpmDisplay(Math.round(bpm))
      const beatMs = bpmToBeatMs(bpm)

      if (now - lastBeatSpawnAtRef.current >= beatMs) {
        const noteId = nextNoteIdRef.current
        nextNoteIdRef.current += 1
        const newNote: BeatNote = {
          id: noteId,
          spawnedAt: now,
          beatDurationMs: beatMs,
        }
        const nextNotes = [...activeNotesRef.current, newNote]
        activeNotesRef.current = nextNotes
        setActiveNotes(nextNotes)
        lastBeatSpawnAtRef.current = now
      }

      // Expired notes = MISS
      const expiredNotes: number[] = []
      const survivingNotes: BeatNote[] = []
      for (const note of activeNotesRef.current) {
        const r = radiusForNote(note, now)
        if (r <= TARGET_RING_RADIUS - GOOD_THRESHOLD - 10) {
          expiredNotes.push(note.id)
        } else {
          survivingNotes.push(note)
        }
      }

      if (expiredNotes.length > 0) {
        for (let i = 0; i < expiredNotes.length; i++) {
          hpRef.current = clampNumber(hpRef.current - MISS_HP_DAMAGE, 0, MAX_HP)
          comboRef.current = 0
          setCombo(0)
          perfectStreakRef.current = 0
          setPerfectStreak(0)
        }
        setHp(hpRef.current)
        showJudgment('MISS')
        if (feverActiveRef.current) deactivateFever()
        activeNotesRef.current = survivingNotes
        setActiveNotes(survivingNotes)
      }

      // Ripple cleanup
      setHitRipples(prev => prev.filter(r => now - r.createdAt < 600))
      // Pulse decay
      setBgPulseIntensity(prev => Math.max(0, prev - deltaMs * 0.001))
      // Drive ring animation
      setRenderNow(now)

      // HP 0 = game over
      if (hpRef.current <= 0) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- effects is a stable hook return
  }, [deactivateFever, finishGame, showJudgment])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const hpPercent = (hp / MAX_HP) * 100
  const comboLabel = combo >= 2 ? `${combo} COMBO` : ''

  const noteCircles = useMemo(() => {
    return activeNotes.map((note) => {
      const r = radiusForNote(note, renderNow)
      const progress = clampNumber((renderNow - note.spawnedAt) / note.beatDurationMs, 0, 1)
      const opacity = 0.3 + progress * 0.7
      return { id: note.id, radius: Math.max(0, r), opacity }
    })
  }, [activeNotes, renderNow])

  return (
    <section
      className={`mini-game-panel rhythm-tap-panel ${isFeverMode ? 'rhythm-tap-fever' : ''}`}
      aria-label="rhythm-tap-game"
      style={{ maxWidth: '432px', margin: '0 auto', overflow: 'hidden', position: 'relative', height: '100%' }}
    >
      <style>{GAME_EFFECTS_CSS}
      {`
        .rhythm-tap-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
          padding: 0;
          user-select: none;
          -webkit-user-select: none;
          background: #f5f4ef;
        }

        .rhythm-tap-panel.rhythm-tap-fever {
          animation: rhythm-tap-fever-bg 0.5s ease-in-out infinite alternate;
        }

        @keyframes rhythm-tap-fever-bg {
          from { box-shadow: inset 0 0 40px rgba(251,191,36,0.08); }
          to { box-shadow: inset 0 0 60px rgba(251,191,36,0.18); }
        }

        .rhythm-tap-top-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 16px 18px 6px;
          box-sizing: border-box;
          flex-shrink: 0;
        }

        .rhythm-tap-score {
          font-size: clamp(56px, 16vw, 76px);
          font-weight: 900;
          color: #ec4899;
          margin: 0;
          letter-spacing: -1px;
        }

        .rhythm-tap-fever .rhythm-tap-score {
          color: #f59e0b;
        }

        .rhythm-tap-right-block {
          text-align: right;
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .rhythm-tap-elapsed {
          font-size: clamp(28px, 8vw, 38px);
          font-weight: 800;
          color: #6b7280;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .rhythm-tap-best {
          font-size: 16px;
          color: #9ca3af;
          margin: 0;
          font-weight: 600;
        }

        .rhythm-tap-hp-bar {
          width: 100%;
          height: 14px;
          background: #e8e5dc;
          border-radius: 5px;
          margin: 0 16px;
          overflow: hidden;
          flex-shrink: 0;
          box-sizing: border-box;
          max-width: calc(100% - 32px);
        }

        .rhythm-tap-hp-fill {
          height: 100%;
          border-radius: 5px;
          transition: width 0.15s ease-out, background 0.3s;
        }

        .rhythm-tap-hp-fill.healthy {
          background: linear-gradient(90deg, #22c55e, #4ade80);
        }

        .rhythm-tap-hp-fill.warning {
          background: linear-gradient(90deg, #f59e0b, #fbbf24);
        }

        .rhythm-tap-hp-fill.danger {
          background: linear-gradient(90deg, #ef4444, #f87171);
          animation: rhythm-tap-hp-blink 0.4s ease-in-out infinite alternate;
        }

        @keyframes rhythm-tap-hp-blink {
          from { opacity: 1; }
          to { opacity: 0.6; }
        }

        .rhythm-tap-info-strip {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          width: 100%;
          padding: 4px 16px;
          flex-shrink: 0;
        }

        .rhythm-tap-info-strip p {
          margin: 0;
          font-size: clamp(18px, 5vw, 22px);
          color: #6b7280;
          font-weight: 600;
        }

        .rhythm-tap-info-strip strong {
          color: #374151;
          font-weight: 800;
        }

        .rhythm-tap-combo-label strong {
          color: #d97706 !important;
          font-size: clamp(22px, 6vw, 30px);
        }

        .rhythm-tap-perfect-streak {
          font-size: clamp(16px, 4.5vw, 20px);
          color: #ec4899 !important;
          font-weight: 700;
        }

        .rhythm-tap-perfect-streak strong {
          color: #ec4899 !important;
        }

        .rhythm-tap-fever-banner {
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          color: #fff;
          font-size: clamp(24px, 6vw, 32px);
          font-weight: 900;
          padding: 10px 32px;
          border-radius: 18px;
          letter-spacing: 3px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          animation: rhythm-tap-fever-pulse 0.4s ease-in-out infinite alternate;
          text-align: center;
          flex-shrink: 0;
          margin: 2px 0;
        }

        @keyframes rhythm-tap-fever-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.06); }
        }

        .rhythm-tap-fever-timer {
          width: 100%;
          height: 4px;
          background: rgba(255,255,255,0.3);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 3px;
        }

        .rhythm-tap-fever-timer-fill {
          height: 100%;
          background: #fff;
          border-radius: 2px;
          transition: width 0.1s linear;
        }

        .rhythm-tap-arena {
          position: relative;
          flex: 1;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          background: radial-gradient(circle, rgba(168,85,247,0.06) 0%, transparent 60%);
          outline: none;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          min-height: 0;
        }

        .rhythm-tap-fever .rhythm-tap-arena {
          background: radial-gradient(circle, rgba(251,191,36,0.08) 0%, transparent 60%);
        }

        .rhythm-tap-arena:active .rhythm-tap-svg-wrapper {
          transform: scale(0.96);
        }

        .rhythm-tap-arena.pulse .rhythm-tap-svg-wrapper {
          animation: rhythm-tap-pulse-ring 0.3s ease-out;
        }

        .rhythm-tap-arena.miss-shake .rhythm-tap-svg-wrapper {
          animation: rhythm-tap-shake 0.3s ease-out;
        }

        @keyframes rhythm-tap-pulse-ring {
          0% { filter: drop-shadow(0 0 0 rgba(236,72,153,0)); transform: scale(1); }
          50% { filter: drop-shadow(0 0 20px rgba(236,72,153,0.4)); transform: scale(1.04); }
          100% { filter: drop-shadow(0 0 0 rgba(236,72,153,0)); transform: scale(1); }
        }

        @keyframes rhythm-tap-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }

        .rhythm-tap-svg-wrapper {
          width: clamp(320px, 85vw, 420px);
          height: clamp(320px, 85vw, 420px);
          position: relative;
          transition: transform 0.1s ease-out;
        }

        .rhythm-tap-svg {
          width: 100%;
          height: 100%;
        }

        .rhythm-tap-target-ring {
          transition: stroke 0.15s;
        }

        .rhythm-tap-shrink-ring {
          pointer-events: none;
        }

        .rhythm-tap-hit-ripple {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          pointer-events: none;
          animation: rhythm-tap-ripple-expand 0.6s ease-out forwards;
        }

        @keyframes rhythm-tap-ripple-expand {
          0% { width: 80px; height: 80px; opacity: 0.7; border-width: 5px; }
          100% { width: 320px; height: 320px; opacity: 0; border-width: 1px; }
        }

        .rhythm-tap-judgment {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          animation: rhythm-tap-judgment-pop 0.48s ease-out forwards;
          z-index: 5;
        }

        .rhythm-tap-judgment-text {
          font-size: clamp(52px, 15vw, 68px);
          font-weight: 900;
          letter-spacing: 2px;
          text-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        @keyframes rhythm-tap-judgment-pop {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          15% { opacity: 1; transform: translate(-50%, -50%) scale(1.3); }
          30% { transform: translate(-50%, -50%) scale(1); }
          80% { opacity: 1; transform: translate(-50%, -60%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -80%) scale(0.9); }
        }

        .rhythm-tap-combo-display {
          position: absolute;
          bottom: 8%;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
          animation: rhythm-tap-combo-bounce 0.3s ease-out;
        }

        .rhythm-tap-combo-number {
          font-size: clamp(60px, 20vw, 84px);
          font-weight: 900;
          color: rgba(217,119,6,0.25);
          letter-spacing: -2px;
        }

        @keyframes rhythm-tap-combo-bounce {
          0% { transform: translateX(-50%) scale(1.4); opacity: 0.6; }
          100% { transform: translateX(-50%) scale(1); opacity: 1; }
        }

        .rhythm-tap-mascot-strip {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 4px 16px 8px;
          flex-shrink: 0;
          width: 100%;
          box-sizing: border-box;
        }

        .rhythm-tap-mascot {
          width: 60px;
          height: 60px;
          object-fit: contain;
          border-radius: 50%;
          border: 3px solid #ec4899;
          background: rgba(236,72,153,0.08);
          transition: transform 0.2s;
          flex-shrink: 0;
        }

        .rhythm-tap-fever .rhythm-tap-mascot {
          border-color: #fbbf24;
          box-shadow: 0 0 12px rgba(251,191,36,0.4);
        }

        .rhythm-tap-mascot.bounce {
          animation: rhythm-tap-mascot-bounce 0.3s ease-out;
        }

        @keyframes rhythm-tap-mascot-bounce {
          0% { transform: scale(1) translateY(0); }
          40% { transform: scale(1.15) translateY(-4px); }
          100% { transform: scale(1) translateY(0); }
        }

        .rhythm-tap-scoring-guide {
          display: flex;
          gap: 10px;
          justify-content: center;
        }

        .rhythm-tap-guide-item {
          font-size: clamp(15px, 4vw, 18px);
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 8px;
          background: rgba(0,0,0,0.05);
        }

        .rhythm-tap-guide-item.perfect { color: #ec4899; }
        .rhythm-tap-guide-item.good { color: #d97706; }
        .rhythm-tap-guide-item.miss { color: #ef4444; }

        .rhythm-tap-combo-pop {
          position: absolute;
          top: 38%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-weight: 900;
          letter-spacing: 2px;
          pointer-events: none;
          z-index: 20;
          animation: rhythm-tap-combo-pop-anim 0.4s ease-out;
          text-shadow: 0 1px 6px rgba(0,0,0,0.15);
        }

        @keyframes rhythm-tap-combo-pop-anim {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(1.8) rotate(-4deg); }
          40% { opacity: 1; transform: translate(-50%, -50%) scale(0.95) rotate(1deg); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1) rotate(0deg); }
        }

        .rhythm-tap-bg-glow {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 100%;
          height: 100%;
          pointer-events: none;
          z-index: 0;
          border-radius: 50%;
          transition: opacity 0.3s;
        }
      `}</style>

      {/* Background glow based on combo */}
      <div
        className="rhythm-tap-bg-glow"
        style={{
          background: isFeverMode
            ? `radial-gradient(circle, rgba(251,191,36,${0.05 + bgPulseIntensity * 0.08}) 0%, transparent 60%)`
            : `radial-gradient(circle, rgba(168,85,247,${0.03 + bgPulseIntensity * 0.06}) 0%, transparent 60%)`,
        }}
      />

      <div className="rhythm-tap-top-bar">
        <div>
          <p className="rhythm-tap-score">{score.toLocaleString()}</p>
          <p className="rhythm-tap-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="rhythm-tap-right-block">
          <p className="rhythm-tap-elapsed">{elapsedSec}s</p>
        </div>
      </div>

      {/* HP Bar */}
      <div className="rhythm-tap-hp-bar">
        <div
          className={`rhythm-tap-hp-fill ${hpPercent > 50 ? 'healthy' : hpPercent > LOW_HP_THRESHOLD ? 'warning' : 'danger'}`}
          style={{ width: `${hpPercent}%` }}
        />
      </div>

      <div className="rhythm-tap-info-strip">
        <p>BPM <strong>{currentBpmDisplay}</strong></p>
        <p className="rhythm-tap-combo-label">
          {comboLabel && <strong>{comboLabel}</strong>}
        </p>
        <p>MAX <strong>{maxCombo}</strong></p>
        {perfectStreak >= 3 && (
          <p className="rhythm-tap-perfect-streak">
            PERFECT x<strong>{perfectStreak}</strong>
          </p>
        )}
      </div>

      {isFeverMode && (
        <div className="rhythm-tap-fever-banner">
          FEVER x{FEVER_SCORE_MULTIPLIER}
          <div className="rhythm-tap-fever-timer">
            <div className="rhythm-tap-fever-timer-fill" style={{ width: `${(feverRemainingMs / FEVER_DURATION_MS) * 100}%` }} />
          </div>
        </div>
      )}

      <div
        className={`rhythm-tap-arena ${isPulseActive ? 'pulse' : ''} ${judgment === 'MISS' ? 'miss-shake' : ''}`}
        onPointerDown={(e) => { e.preventDefault(); handleTap() }}
        role="button"
        tabIndex={0}
        aria-label="Tap area"
      >
        <div className="rhythm-tap-svg-wrapper">
          <svg
            className="rhythm-tap-svg"
            viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <circle
              className="rhythm-tap-target-ring"
              cx={SVG_CENTER}
              cy={SVG_CENTER}
              r={TARGET_RING_RADIUS}
              fill="none"
              stroke={ringColor(judgment, isFeverMode)}
              strokeWidth={TARGET_STROKE_WIDTH}
              opacity={0.6}
            />

            <circle
              className="rhythm-tap-target-fill"
              cx={SVG_CENTER}
              cy={SVG_CENTER}
              r={TARGET_RING_RADIUS}
              fill={ringColor(judgment, isFeverMode)}
              opacity={0.08}
            />

            <circle
              cx={SVG_CENTER}
              cy={SVG_CENTER}
              r={TARGET_RING_RADIUS + (isFeverMode ? FEVER_GOOD_THRESHOLD : GOOD_THRESHOLD)}
              fill="none"
              stroke={isFeverMode ? '#d97706' : '#a855f7'}
              strokeWidth={1}
              opacity={0.15}
              strokeDasharray="4 4"
            />
            <circle
              cx={SVG_CENTER}
              cy={SVG_CENTER}
              r={Math.max(0, TARGET_RING_RADIUS - (isFeverMode ? FEVER_GOOD_THRESHOLD : GOOD_THRESHOLD))}
              fill="none"
              stroke={isFeverMode ? '#d97706' : '#a855f7'}
              strokeWidth={1}
              opacity={0.15}
              strokeDasharray="4 4"
            />

            {noteCircles.map((nc) => (
              <circle
                key={nc.id}
                className="rhythm-tap-shrink-ring"
                cx={SVG_CENTER}
                cy={SVG_CENTER}
                r={nc.radius}
                fill="none"
                stroke={isFeverMode ? '#fbbf24' : '#ec4899'}
                strokeWidth={RING_STROKE_WIDTH}
                opacity={nc.opacity}
              />
            ))}

            <circle
              cx={SVG_CENTER}
              cy={SVG_CENTER}
              r={8}
              fill={isFeverMode ? '#fbbf24' : '#ec4899'}
              opacity={0.9}
            />
          </svg>

          {/* Hit ripples */}
          {hitRipples.map((r) => (
            <div
              key={r.id}
              className="rhythm-tap-hit-ripple"
              style={{ borderStyle: 'solid', borderColor: r.color }}
            />
          ))}

          {judgment !== null && (
            <div
              className="rhythm-tap-judgment"
              style={{ color: judgmentColor(judgment) }}
            >
              <span className="rhythm-tap-judgment-text">{judgment}</span>
            </div>
          )}

          {combo >= 3 && (
            <div className="rhythm-tap-combo-display">
              <span className="rhythm-tap-combo-number">{combo}</span>
            </div>
          )}
        </div>
      </div>

      <div className="rhythm-tap-mascot-strip">
        <img
          className={`rhythm-tap-mascot ${isPulseActive ? 'bounce' : ''}`}
          src={kimYeonjaAvatar}
          alt="avatar"
          draggable={false}
        />
        <div className="rhythm-tap-scoring-guide">
          <span className="rhythm-tap-guide-item perfect">PERFECT +{PERFECT_SCORE}{isFeverMode ? ` x${FEVER_SCORE_MULTIPLIER}` : ''}</span>
          <span className="rhythm-tap-guide-item good">GOOD +{GOOD_SCORE}{isFeverMode ? ` x${FEVER_SCORE_MULTIPLIER}` : ''}</span>
          <span className="rhythm-tap-guide-item miss">MISS -{MISS_HP_DAMAGE}HP</span>
        </div>
      </div>

      {combo >= 3 && (
        <div
          key={combo}
          className="rhythm-tap-combo-pop"
          style={{
            color: getComboColor(combo),
            fontSize: `${Math.min(32, 16 + combo * 0.4)}px`,
          }}
        >
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const rhythmTapModule: MiniGameModule = {
  manifest: {
    id: 'rhythm-tap',
    title: 'Rhythm Tap',
    description: '\uC218\uCD95\uD558\uB294 \uC6D0\uC744 \uD0C0\uC774\uBC0D\uC5D0 \uB9DE\uCDB0 \uD0ED! MISS\uD558\uBA74 \uCCB4\uB825\uC774 \uAE4E\uC5EC\uC694',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#ec4899',
  },
  Component: RhythmTapGame,
}
