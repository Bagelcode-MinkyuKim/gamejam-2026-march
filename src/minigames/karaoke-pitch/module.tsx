import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterImage from '../../../assets/images/same-character/song-changsik.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import perfectSfx from '../../../assets/sounds/karaoke-perfect.mp3'
import goodSfx from '../../../assets/sounds/karaoke-good.mp3'
import missSfx from '../../../assets/sounds/karaoke-miss.mp3'
import feverSfx from '../../../assets/sounds/karaoke-fever.mp3'
import comboSfx from '../../../assets/sounds/karaoke-combo.mp3'
import timeWarningSfx from '../../../assets/sounds/karaoke-time-warning.mp3'
import gameOverSfx from '../../../assets/sounds/karaoke-game-over.mp3'

// ─── Game Constants ─────────────────────────────────────────────────
const ROUND_DURATION_MS = 35000
const PITCH_BAR_WIDTH = 64
const TARGET_RADIUS = 20
const PLAYER_INDICATOR_RADIUS = 16

// Accuracy thresholds
const ACCURACY_PERFECT_THRESHOLD = 0.04
const ACCURACY_GOOD_THRESHOLD = 0.12
const ACCURACY_OK_THRESHOLD = 0.25

// Scoring
const SCORE_PER_SECOND_PERFECT = 150
const SCORE_PER_SECOND_GOOD = 70
const SCORE_PER_SECOND_OK = 30

// Time
const LOW_TIME_THRESHOLD_MS = 5000

// Streak & Fever
const PERFECT_STREAK_THRESHOLD_MS = 1500
const FEVER_TRIGGER_STREAKS = 3
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const STREAK_MILESTONE_BONUS = 80

// Combo
const COMBO_DECAY_MS = 600
const COMBO_BONUS_BASE = 10

// Difficulty phases
const PHASE_EASY_MS = 8000
const PHASE_MEDIUM_MS = 20000

// Pitch movement
const SINE_BASE_PERIOD_MS = 3500
const SINE_MIN_PERIOD_MS = 1200
const SINE_PERIOD_DECAY_PER_MS = 0.06
const SINE_SECONDARY_AMPLITUDE = 0.22
const SINE_SECONDARY_PERIOD_RATIO = 2.73

// Bonus notes
const BONUS_NOTE_INTERVAL_MS = 4000
const BONUS_NOTE_DURATION_MS = 2000
const BONUS_NOTE_SCORE = 200
const BONUS_NOTE_RADIUS = 0.08

// Visual
const NOTE_EMOJIS = ['🎵', '🎶', '🎤', '🎼', '🎹', '🎸', '🎺', '🎻'] as const
const PERFECT_EMOJIS = ['✨', '💫', '⭐', '🌟'] as const

// ─── Helpers ────────────────────────────────────────────────────────

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeTargetPosition(elapsedMs: number): number {
  const difficultyFactor = elapsedMs < PHASE_EASY_MS ? 0.7
    : elapsedMs < PHASE_MEDIUM_MS ? 1.0 : 1.3
  const currentPeriod = Math.max(SINE_MIN_PERIOD_MS, SINE_BASE_PERIOD_MS - elapsedMs * SINE_PERIOD_DECAY_PER_MS)
  const primaryPhase = (elapsedMs / currentPeriod) * Math.PI * 2
  const secondaryPhase = (elapsedMs / (currentPeriod * SINE_SECONDARY_PERIOD_RATIO)) * Math.PI * 2
  const tertiaryPhase = (elapsedMs / (currentPeriod * 0.37)) * Math.PI * 2
  const primary = Math.sin(primaryPhase)
  const secondary = Math.sin(secondaryPhase) * SINE_SECONDARY_AMPLITUDE * difficultyFactor
  const tertiary = Math.sin(tertiaryPhase) * 0.08 * difficultyFactor
  return clampNumber((primary + secondary + tertiary) * 0.5 + 0.5, 0.02, 0.98)
}

function computeAccuracy(targetNormalized: number, playerNormalized: number): number {
  return Math.abs(targetNormalized - playerNormalized)
}

function accuracyToLabel(distance: number): string {
  if (distance <= ACCURACY_PERFECT_THRESHOLD) return 'PERFECT'
  if (distance <= ACCURACY_GOOD_THRESHOLD) return 'GOOD'
  if (distance <= ACCURACY_OK_THRESHOLD) return 'OK'
  return 'MISS'
}

function accuracyToColor(distance: number): string {
  if (distance <= ACCURACY_PERFECT_THRESHOLD) return '#22c55e'
  if (distance <= ACCURACY_GOOD_THRESHOLD) return '#84cc16'
  if (distance <= ACCURACY_OK_THRESHOLD) return '#facc15'
  return '#ef4444'
}

function accuracyToScoreRate(distance: number): number {
  if (distance <= ACCURACY_PERFECT_THRESHOLD) return SCORE_PER_SECOND_PERFECT
  if (distance <= ACCURACY_GOOD_THRESHOLD) return SCORE_PER_SECOND_GOOD
  if (distance <= ACCURACY_OK_THRESHOLD) return SCORE_PER_SECOND_OK
  return 0
}

function getDifficultyLabel(elapsedMs: number): string {
  if (elapsedMs < PHASE_EASY_MS) return 'EASY'
  if (elapsedMs < PHASE_MEDIUM_MS) return 'NORMAL'
  return 'HARD'
}

function getDifficultyColor(elapsedMs: number): string {
  if (elapsedMs < PHASE_EASY_MS) return '#22c55e'
  if (elapsedMs < PHASE_MEDIUM_MS) return '#facc15'
  return '#ef4444'
}

// ─── Bonus Note Type ────────────────────────────────────────────────

interface BonusNote {
  id: number
  position: number
  spawnedAt: number
  collected: boolean
}

// ─── Main Component ─────────────────────────────────────────────────

function KaraokePitchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [targetPosition, setTargetPosition] = useState(0.5)
  const [playerPosition, setPlayerPosition] = useState(0.5)
  const [accuracyDistance, setAccuracyDistance] = useState(0.5)
  const [totalAccuracySum, setTotalAccuracySum] = useState(0)
  const [totalAccuracySamples, setTotalAccuracySamples] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [perfectStreakCount, setPerfectStreakCount] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [bonusNotes, setBonusNotes] = useState<BonusNote[]>([])
  const [elapsedDisplay, setElapsedDisplay] = useState(0)
  const [vignette, setVignette] = useState(false)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const elapsedMsRef = useRef(0)
  const playerPositionRef = useRef(0.5)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const totalAccuracySumRef = useRef(0)
  const totalAccuracySamplesRef = useRef(0)
  const isDraggingRef = useRef(false)
  const pitchBarRef = useRef<HTMLDivElement | null>(null)
  const lastFeedbackSoundMsRef = useRef(0)
  const lastPerfectParticleMsRef = useRef(0)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const perfectStreakMsRef = useRef(0)
  const perfectStreakCountRef = useRef(0)
  const lastMilestoneMsRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const lastComboTickMsRef = useRef(0)
  const bonusNotesRef = useRef<BonusNote[]>([])
  const bonusNoteIdRef = useRef(0)
  const lastBonusSpawnMsRef = useRef(0)
  const lastTimeWarnMsRef = useRef(0)

  // Audio refs
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const goodAudioRef = useRef<HTMLAudioElement | null>(null)
  const missAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const timeWarningAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    playAudio(gameOverAudioRef, 0.5)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const updatePlayerFromClientY = useCallback((clientY: number) => {
    const barElement = pitchBarRef.current
    if (barElement === null) return
    const rect = barElement.getBoundingClientRect()
    const relativeY = clientY - rect.top
    const normalized = clampNumber(1 - relativeY / rect.height, 0, 1)
    playerPositionRef.current = normalized
    setPlayerPosition(normalized)
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      isDraggingRef.current = true
      ;(event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId)
      updatePlayerFromClientY(event.clientY)
    },
    [updatePlayerFromClientY],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      event.preventDefault()
      updatePlayerFromClientY(event.clientY)
    },
    [updatePlayerFromClientY],
  )

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false
    ;(event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId)
  }, [])

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  // Setup audio
  useEffect(() => {
    perfectAudioRef.current = new Audio(perfectSfx)
    goodAudioRef.current = new Audio(goodSfx)
    missAudioRef.current = new Audio(missSfx)
    feverAudioRef.current = new Audio(feverSfx)
    comboAudioRef.current = new Audio(comboSfx)
    timeWarningAudioRef.current = new Audio(timeWarningSfx)
    gameOverAudioRef.current = new Audio(gameOverSfx)

    const allAudios = [
      perfectAudioRef, goodAudioRef, missAudioRef, feverAudioRef,
      comboAudioRef, timeWarningAudioRef, gameOverAudioRef,
    ]
    allAudios.forEach(ref => { if (ref.current) ref.current.preload = 'auto' })

    return () => {
      allAudios.forEach(ref => { ref.current = null })
      effects.cleanup()
    }
  }, [])

  // Keyboard
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

  // Prevent scroll on touch
  useEffect(() => {
    const handleTouchMove = (event: TouchEvent) => {
      if (isDraggingRef.current) event.preventDefault()
    }
    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => window.removeEventListener('touchmove', handleTouchMove)
  }, [])

  // Main game loop
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

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)
      setElapsedDisplay(elapsedMsRef.current)

      const currentTarget = computeTargetPosition(elapsedMsRef.current)
      setTargetPosition(currentTarget)

      const distance = computeAccuracy(currentTarget, playerPositionRef.current)
      setAccuracyDistance(distance)

      // ─── Combo system ───
      if (distance <= ACCURACY_GOOD_THRESHOLD) {
        lastComboTickMsRef.current = elapsedMsRef.current
        comboRef.current += 1
        if (comboRef.current > maxComboRef.current) maxComboRef.current = comboRef.current
      } else if (elapsedMsRef.current - lastComboTickMsRef.current > COMBO_DECAY_MS) {
        if (comboRef.current > 0) {
          comboRef.current = 0
          setVignette(true)
          setTimeout(() => setVignette(false), 200)
        }
      }
      setCombo(comboRef.current)
      setMaxCombo(maxComboRef.current)

      // ─── Fever timer countdown ───
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // ─── Track perfect streaks ───
      if (distance <= ACCURACY_PERFECT_THRESHOLD) {
        perfectStreakMsRef.current += deltaMs
        if (perfectStreakMsRef.current >= PERFECT_STREAK_THRESHOLD_MS) {
          perfectStreakMsRef.current -= PERFECT_STREAK_THRESHOLD_MS
          perfectStreakCountRef.current += 1
          setPerfectStreakCount(perfectStreakCountRef.current)

          if (elapsedMsRef.current - lastMilestoneMsRef.current > 500) {
            lastMilestoneMsRef.current = elapsedMsRef.current
            const bonus = STREAK_MILESTONE_BONUS + comboRef.current * 2
            scoreRef.current += bonus
            effects.showScorePopup(bonus, 50, 100)
            playAudio(comboAudioRef, 0.4, 1.0 + perfectStreakCountRef.current * 0.05)
            effects.spawnParticles(4, 50, 100, PERFECT_EMOJIS)
          }

          if (perfectStreakCountRef.current >= FEVER_TRIGGER_STREAKS && !feverRef.current) {
            feverRef.current = true
            feverRemainingMsRef.current = FEVER_DURATION_MS
            setIsFever(true)
            setFeverRemainingMs(FEVER_DURATION_MS)
            effects.triggerFlash('rgba(250,204,21,0.6)')
            effects.triggerShake(8, 300)
            playAudio(feverAudioRef, 0.6)
          }
        }
      } else {
        perfectStreakMsRef.current = 0
      }

      // ─── Scoring ───
      const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
      const comboMult = 1 + Math.min(comboRef.current * 0.02, 1.0)
      const scoreRate = accuracyToScoreRate(distance)
      const scoreGain = scoreRate * (deltaMs / 1000) * feverMult * comboMult
      const comboBonus = comboRef.current > 5 ? COMBO_BONUS_BASE * (deltaMs / 1000) * (comboRef.current / 10) : 0
      scoreRef.current += scoreGain + comboBonus
      setScore(Math.floor(scoreRef.current))

      totalAccuracySumRef.current += 1 - distance
      totalAccuracySamplesRef.current += 1
      setTotalAccuracySum(totalAccuracySumRef.current)
      setTotalAccuracySamples(totalAccuracySamplesRef.current)

      // ─── Sound feedback ───
      if (elapsedMsRef.current - lastFeedbackSoundMsRef.current > 500) {
        if (distance <= ACCURACY_PERFECT_THRESHOLD) {
          lastFeedbackSoundMsRef.current = elapsedMsRef.current
          playAudio(perfectAudioRef, 0.25, 0.8 + currentTarget * 0.4)
        } else if (distance <= ACCURACY_GOOD_THRESHOLD) {
          lastFeedbackSoundMsRef.current = elapsedMsRef.current
          playAudio(goodAudioRef, 0.2, 0.9 + currentTarget * 0.3)
        } else if (distance > ACCURACY_OK_THRESHOLD && elapsedMsRef.current - lastFeedbackSoundMsRef.current > 1200) {
          lastFeedbackSoundMsRef.current = elapsedMsRef.current
          playAudio(missAudioRef, 0.15)
        }
      }

      // ─── Particle effects ───
      if (distance <= ACCURACY_PERFECT_THRESHOLD && elapsedMsRef.current - lastPerfectParticleMsRef.current > 600) {
        lastPerfectParticleMsRef.current = elapsedMsRef.current
        effects.spawnParticles(3, 40, 200 * (1 - playerPositionRef.current) + 60, NOTE_EMOJIS)
        effects.triggerFlash('rgba(34,197,94,0.12)')
      }

      // ─── Bonus notes ───
      if (elapsedMsRef.current - lastBonusSpawnMsRef.current > BONUS_NOTE_INTERVAL_MS && elapsedMsRef.current > 3000) {
        lastBonusSpawnMsRef.current = elapsedMsRef.current
        bonusNoteIdRef.current += 1
        const newNote: BonusNote = {
          id: bonusNoteIdRef.current,
          position: 0.1 + Math.random() * 0.8,
          spawnedAt: elapsedMsRef.current,
          collected: false,
        }
        bonusNotesRef.current = [...bonusNotesRef.current, newNote]
      }

      // Check bonus note collection
      const updatedNotes = bonusNotesRef.current.map(note => {
        if (note.collected) return note
        const noteAge = elapsedMsRef.current - note.spawnedAt
        if (noteAge > BONUS_NOTE_DURATION_MS) return { ...note, collected: true }
        if (Math.abs(playerPositionRef.current - note.position) < BONUS_NOTE_RADIUS) {
          scoreRef.current += BONUS_NOTE_SCORE * feverMult
          effects.comboHitBurst(50, 200 * (1 - note.position) + 60, 5, BONUS_NOTE_SCORE, NOTE_EMOJIS)
          playAudio(perfectAudioRef, 0.4, 1.5)
          return { ...note, collected: true }
        }
        return note
      }).filter(note => {
        if (note.collected) return (elapsedMsRef.current - note.spawnedAt) < BONUS_NOTE_DURATION_MS + 500
        return true
      })
      bonusNotesRef.current = updatedNotes
      setBonusNotes([...updatedNotes])

      // ─── Time warning ───
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > 0) {
        if (elapsedMsRef.current - lastTimeWarnMsRef.current > 1000) {
          lastTimeWarnMsRef.current = elapsedMsRef.current
          playAudio(timeWarningAudioRef, 0.3)
          effects.triggerShake(2, 100)
        }
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
  }, [finishGame, playAudio, effects])

  const accuracyLabel = accuracyToLabel(accuracyDistance)
  const accuracyColor = accuracyToColor(accuracyDistance)
  const overallAccuracyPercent = totalAccuracySamples > 0 ? (totalAccuracySum / totalAccuracySamples) * 100 : 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, Math.floor(scoreRef.current)), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const diffLabel = getDifficultyLabel(elapsedDisplay)
  const diffColor = getDifficultyColor(elapsedDisplay)

  const targetTopPercent = (1 - targetPosition) * 100
  const playerTopPercent = (1 - playerPosition) * 100
  const timePercent = (remainingMs / ROUND_DURATION_MS) * 100

  const trailSegments = useMemo(() => {
    const tPos = (1 - targetPosition) * 100
    const pPos = (1 - playerPosition) * 100
    const minPos = Math.min(tPos, pPos)
    const maxPos = Math.max(tPos, pPos)
    const height = maxPos - minPos
    return [{ top: minPos, height: Math.max(height, 0.5), color: accuracyColor }]
  }, [targetPosition, playerPosition, accuracyColor])

  return (
    <section className="mini-game-panel kp-panel" aria-label="karaoke-pitch-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .kp-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1a0a2e 0%, #0d0d1a 40%, #0f0826 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          position: relative;
          overflow: hidden;
        }

        .kp-vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 12;
          box-shadow: inset 0 0 60px rgba(239,68,68,0.5);
          animation: kp-vignette-fade 0.3s ease-out forwards;
        }

        @keyframes kp-vignette-fade {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        .kp-fever-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
          background: linear-gradient(180deg, rgba(250,204,21,0.08) 0%, transparent 30%, transparent 70%, rgba(250,204,21,0.08) 100%);
          animation: kp-fever-pulse 0.8s ease-in-out infinite alternate;
        }

        @keyframes kp-fever-pulse {
          from { opacity: 0.5; }
          to { opacity: 1; }
        }

        .kp-time-bar {
          height: 4px;
          background: #27272a;
          flex-shrink: 0;
          position: relative;
          z-index: 2;
        }

        .kp-time-bar-fill {
          height: 100%;
          transition: width 0.1s linear;
          border-radius: 0 2px 2px 0;
        }

        .kp-hud {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px 4px;
          flex-shrink: 0;
          z-index: 2;
        }

        .kp-hud-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .kp-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 2px solid #d946ef;
          object-fit: cover;
          box-shadow: 0 0 10px rgba(217,70,239,0.5);
        }

        .kp-score {
          font-size: 28px;
          font-weight: 900;
          color: #e879f9;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 16px rgba(217,70,239,0.6);
          font-variant-numeric: tabular-nums;
        }

        .kp-best {
          font-size: 9px;
          color: #d8b4fe;
          margin: 0;
          opacity: 0.6;
        }

        .kp-hud-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .kp-time {
          font-size: 20px;
          font-weight: 800;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .kp-time.low-time {
          color: #ef4444;
          animation: kp-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes kp-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.05); }
        }

        .kp-status-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 2px 12px 4px;
          flex-shrink: 0;
          z-index: 2;
        }

        .kp-accuracy-label {
          font-size: 22px;
          font-weight: 900;
          margin: 0;
          letter-spacing: 2px;
          text-shadow: 0 0 14px currentColor;
          transition: color 0.12s ease;
        }

        .kp-combo-badge {
          font-size: 13px;
          font-weight: 800;
          padding: 2px 8px;
          border-radius: 10px;
          background: rgba(217,70,239,0.2);
          border: 1px solid rgba(217,70,239,0.4);
          color: #e879f9;
        }

        .kp-fever-badge {
          font-size: 13px;
          font-weight: 900;
          padding: 2px 10px;
          border-radius: 10px;
          background: rgba(250,204,21,0.2);
          border: 1px solid rgba(250,204,21,0.5);
          color: #facc15;
          animation: kp-pulse 0.3s ease-in-out infinite alternate;
          text-shadow: 0 0 8px rgba(250,204,21,0.6);
        }

        .kp-diff-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 6px;
          border: 1px solid;
          opacity: 0.8;
        }

        .kp-arena {
          display: flex;
          flex-direction: row;
          align-items: stretch;
          gap: 8px;
          flex: 1;
          padding: 4px 10px 6px;
          min-height: 0;
          overflow: hidden;
          z-index: 2;
        }

        .kp-bar-container {
          width: ${PITCH_BAR_WIDTH}px;
          flex-shrink: 0;
          position: relative;
          cursor: grab;
          border-radius: 14px;
          background: #18181b;
          border: 2px solid rgba(217,70,239,0.15);
          overflow: hidden;
          box-shadow: inset 0 0 20px rgba(0,0,0,0.4);
        }

        .kp-bar-container:active {
          cursor: grabbing;
          border-color: rgba(217,70,239,0.4);
          box-shadow: inset 0 0 20px rgba(0,0,0,0.4), 0 0 16px rgba(217,70,239,0.3);
        }

        .kp-bar-container.fever-active {
          border-color: rgba(250,204,21,0.4);
          box-shadow: inset 0 0 20px rgba(0,0,0,0.4), 0 0 16px rgba(250,204,21,0.3);
        }

        .kp-bar-track {
          position: absolute;
          inset: 8px 6px;
          border-radius: 8px;
          background: linear-gradient(to bottom, #312e81, #1e1b4b, #0f172a, #1e1b4b, #312e81);
        }

        .kp-trail {
          position: absolute;
          left: 0;
          right: 0;
          border-radius: 4px;
          transition: background-color 0.12s ease;
        }

        .kp-target-zone {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          width: ${TARGET_RADIUS * 2}px;
          height: ${TARGET_RADIUS * 2}px;
          border-radius: 50%;
          border: 3px solid;
          transition: top 0.05s linear, border-color 0.12s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .kp-target-zone.fever-target {
          box-shadow: 0 0 20px rgba(250,204,21,0.6);
        }

        .kp-target-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          transition: background-color 0.12s ease;
        }

        .kp-player-indicator {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          width: ${PLAYER_INDICATOR_RADIUS * 2}px;
          height: ${PLAYER_INDICATOR_RADIUS * 2}px;
          border-radius: 50%;
          border: 2px solid #ffffffcc;
          transition: background-color 0.12s ease, box-shadow 0.12s ease;
        }

        .kp-bonus-note {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 24px;
          animation: kp-bonus-float 0.5s ease-in-out infinite alternate;
          filter: drop-shadow(0 0 8px rgba(250,204,21,0.8));
          pointer-events: none;
          z-index: 3;
        }

        @keyframes kp-bonus-float {
          from { transform: translate(-50%, -50%) scale(1); }
          to { transform: translate(-50%, -50%) scale(1.15); }
        }

        .kp-scale-marks {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .kp-scale-mark {
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          background: #ffffff12;
        }

        .kp-waveform {
          flex: 1;
          min-width: 0;
          position: relative;
          border-radius: 14px;
          background: #18181b;
          border: 2px solid rgba(217,70,239,0.15);
          overflow: hidden;
          box-shadow: inset 0 0 20px rgba(0,0,0,0.4);
        }

        .kp-waveform.fever-wave {
          border-color: rgba(250,204,21,0.3);
        }

        .kp-waveform canvas {
          width: 100%;
          height: 100%;
          display: block;
        }

        .kp-glow-ring {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          width: ${TARGET_RADIUS * 3}px;
          height: ${TARGET_RADIUS * 3}px;
          border-radius: 50%;
          border: 2px solid;
          opacity: 0.3;
          pointer-events: none;
          animation: kp-glow-expand 1s ease-out infinite;
        }

        @keyframes kp-glow-expand {
          from { transform: translate(-50%, -50%) scale(0.6); opacity: 0.5; }
          to { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
        }

        .kp-accuracy-bar {
          height: 3px;
          background: #27272a;
          border-radius: 2px;
          overflow: hidden;
          width: 60px;
        }

        .kp-accuracy-bar-fill {
          height: 100%;
          border-radius: 2px;
          transition: width 0.3s ease, background-color 0.3s ease;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {vignette && <div className="kp-vignette" />}
      {isFever && <div className="kp-fever-bg" />}

      {/* Time bar */}
      <div className="kp-time-bar">
        <div
          className="kp-time-bar-fill"
          style={{
            width: `${timePercent}%`,
            background: isLowTime
              ? 'linear-gradient(90deg, #ef4444, #f97316)'
              : isFever
                ? 'linear-gradient(90deg, #facc15, #f59e0b)'
                : 'linear-gradient(90deg, #d946ef, #a855f7)',
          }}
        />
      </div>

      {/* HUD */}
      <div className="kp-hud">
        <div className="kp-hud-left">
          <img className="kp-avatar" src={characterImage} alt="" />
          <div>
            <p className="kp-score">{Math.floor(score).toLocaleString()}</p>
            <p className="kp-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="kp-hud-right">
          <p className={`kp-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
          <div className="kp-accuracy-bar">
            <div
              className="kp-accuracy-bar-fill"
              style={{
                width: `${overallAccuracyPercent}%`,
                backgroundColor: overallAccuracyPercent > 80 ? '#22c55e' : overallAccuracyPercent > 50 ? '#facc15' : '#ef4444',
              }}
            />
          </div>
        </div>
      </div>

      {/* Status row */}
      <div className="kp-status-row">
        <p className="kp-accuracy-label" style={{ color: accuracyColor }}>
          {accuracyLabel}
        </p>
        {combo >= 3 && (
          <span className="kp-combo-badge">
            {combo}x COMBO
          </span>
        )}
        {perfectStreakCount > 0 && (
          <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 800, textShadow: '0 0 6px rgba(34,197,94,0.4)' }}>
            STREAK {perfectStreakCount}
          </span>
        )}
        {isFever && (
          <span className="kp-fever-badge">
            FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(0)}s
          </span>
        )}
        <span className="kp-diff-badge" style={{ color: diffColor, borderColor: diffColor }}>
          {diffLabel}
        </span>
      </div>

      {/* Arena */}
      <div className="kp-arena">
        <div
          className={`kp-bar-container ${isFever ? 'fever-active' : ''}`}
          ref={pitchBarRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          role="slider"
          aria-label="pitch-slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(playerPosition * 100)}
        >
          <div className="kp-bar-track">
            {trailSegments.map((seg, i) => (
              <div
                key={i}
                className="kp-trail"
                style={{
                  top: `${seg.top}%`,
                  height: `${seg.height}%`,
                  backgroundColor: seg.color,
                  opacity: isFever ? 0.55 : 0.35,
                }}
              />
            ))}

            {/* Bonus notes on bar */}
            {bonusNotes.filter(n => !n.collected).map(note => {
              const noteAge = elapsedDisplay - note.spawnedAt
              const opacity = noteAge > BONUS_NOTE_DURATION_MS * 0.7 ? 0.4 : 1
              return (
                <div
                  key={note.id}
                  className="kp-bonus-note"
                  style={{
                    top: `${(1 - note.position) * 100}%`,
                    opacity,
                  }}
                >
                  🎵
                </div>
              )
            })}

            {/* Glow ring around target */}
            {accuracyDistance <= ACCURACY_PERFECT_THRESHOLD && (
              <div
                className="kp-glow-ring"
                style={{
                  top: `${targetTopPercent}%`,
                  borderColor: '#22c55e',
                }}
              />
            )}

            <div
              className={`kp-target-zone ${isFever ? 'fever-target' : ''}`}
              style={{
                top: `${targetTopPercent}%`,
                borderColor: isFever ? '#facc15' : accuracyColor,
              }}
            >
              <div
                className="kp-target-dot"
                style={{ backgroundColor: isFever ? '#facc15' : accuracyColor }}
              />
            </div>

            <div
              className="kp-player-indicator"
              style={{
                top: `${playerTopPercent}%`,
                backgroundColor: accuracyColor,
                boxShadow: `0 0 14px ${accuracyColor}88, 0 0 28px ${accuracyColor}44`,
              }}
            />

            <div className="kp-scale-marks">
              {[0, 20, 40, 60, 80, 100].map((mark) => (
                <div key={mark} className="kp-scale-mark" style={{ top: `${mark}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div className={`kp-waveform ${isFever ? 'fever-wave' : ''}`}>
          <KaraokePitchWaveform
            targetPosition={targetPosition}
            playerPosition={playerPosition}
            accuracyColor={accuracyColor}
            elapsedMs={elapsedDisplay}
            isFever={isFever}
            combo={combo}
          />
        </div>
      </div>
    </section>
  )
}

// ─── Waveform Canvas ────────────────────────────────────────────────

function KaraokePitchWaveform({
  targetPosition,
  playerPosition,
  accuracyColor,
  elapsedMs,
  isFever,
  combo,
}: {
  targetPosition: number
  playerPosition: number
  accuracyColor: string
  elapsedMs: number
  isFever: boolean
  combo: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const historyRef = useRef<{ target: number; player: number; color: string }[]>([])
  const MAX_HISTORY = 250

  useEffect(() => {
    historyRef.current.push({
      target: targetPosition,
      player: playerPosition,
      color: accuracyColor,
    })
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift()
    }

    const canvas = canvasRef.current
    if (canvas === null) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.floor(rect.width * dpr)
    const height = Math.floor(rect.height * dpr)

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    ctx.clearRect(0, 0, width, height)

    const history = historyRef.current
    const len = history.length
    if (len < 2) return

    const padding = 10 * dpr
    const drawWidth = width - padding * 2
    const drawHeight = height - padding * 2

    // Grid lines
    ctx.strokeStyle = '#ffffff08'
    ctx.lineWidth = 1 * dpr
    for (let i = 0; i <= 4; i++) {
      const y = padding + (i / 4) * drawHeight
      ctx.beginPath()
      ctx.moveTo(padding, y)
      ctx.lineTo(padding + drawWidth, y)
      ctx.stroke()
    }

    // Target line (glow)
    ctx.lineWidth = 3 * dpr
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    // Target glow
    ctx.strokeStyle = isFever ? '#facc1540' : '#d946ef30'
    ctx.lineWidth = 6 * dpr
    ctx.beginPath()
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (MAX_HISTORY - 1)) * drawWidth
      const y = padding + (1 - history[i].target) * drawHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Target line
    ctx.strokeStyle = isFever ? '#facc1588' : '#d946ef66'
    ctx.lineWidth = 2.5 * dpr
    ctx.beginPath()
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (MAX_HISTORY - 1)) * drawWidth
      const y = padding + (1 - history[i].target) * drawHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Player line glow
    ctx.strokeStyle = accuracyColor + '30'
    ctx.lineWidth = 6 * dpr
    ctx.beginPath()
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (MAX_HISTORY - 1)) * drawWidth
      const y = padding + (1 - history[i].player) * drawHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Player line
    ctx.strokeStyle = '#ffffffaa'
    ctx.lineWidth = 2.5 * dpr
    ctx.beginPath()
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (MAX_HISTORY - 1)) * drawWidth
      const y = padding + (1 - history[i].player) * drawHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Current position dots
    const lastEntry = history[len - 1]
    const lastX = padding + ((len - 1) / (MAX_HISTORY - 1)) * drawWidth
    const lastTargetY = padding + (1 - lastEntry.target) * drawHeight
    const lastPlayerY = padding + (1 - lastEntry.player) * drawHeight

    // Target dot glow
    const targetGlowSize = isFever ? 12 : 8
    const gradient = ctx.createRadialGradient(lastX, lastTargetY, 0, lastX, lastTargetY, targetGlowSize * dpr)
    gradient.addColorStop(0, isFever ? '#facc15' : '#d946ef')
    gradient.addColorStop(1, 'transparent')
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(lastX, lastTargetY, targetGlowSize * dpr, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = isFever ? '#facc15' : '#d946ef'
    ctx.beginPath()
    ctx.arc(lastX, lastTargetY, 4 * dpr, 0, Math.PI * 2)
    ctx.fill()

    // Player dot glow
    const playerGlowSize = combo > 10 ? 14 : 10
    const pGradient = ctx.createRadialGradient(lastX, lastPlayerY, 0, lastX, lastPlayerY, playerGlowSize * dpr)
    pGradient.addColorStop(0, lastEntry.color)
    pGradient.addColorStop(1, 'transparent')
    ctx.fillStyle = pGradient
    ctx.beginPath()
    ctx.arc(lastX, lastPlayerY, playerGlowSize * dpr, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = lastEntry.color
    ctx.beginPath()
    ctx.arc(lastX, lastPlayerY, 5 * dpr, 0, Math.PI * 2)
    ctx.fill()

    // Distance line
    ctx.strokeStyle = lastEntry.color + '44'
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([4 * dpr, 4 * dpr])
    ctx.beginPath()
    ctx.moveTo(lastX, lastTargetY)
    ctx.lineTo(lastX, lastPlayerY)
    ctx.stroke()
    ctx.setLineDash([])

    // Combo display in waveform
    if (combo >= 5) {
      ctx.fillStyle = '#ffffff'
      ctx.font = `bold ${16 * dpr}px sans-serif`
      ctx.textAlign = 'center'
      ctx.fillText(`${combo}x`, width / 2, padding + 20 * dpr)
    }
  }, [targetPosition, playerPosition, accuracyColor, elapsedMs, isFever, combo])

  return <canvas ref={canvasRef} />
}

// ─── Module Export ───────────────────────────────────────────────────

export const karaokePitchModule: MiniGameModule = {
  manifest: {
    id: 'karaoke-pitch',
    title: 'Karaoke Pitch',
    description: 'Match the pitch! Track targets for combos & fever!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#d946ef',
  },
  Component: KaraokePitchGame,
}
