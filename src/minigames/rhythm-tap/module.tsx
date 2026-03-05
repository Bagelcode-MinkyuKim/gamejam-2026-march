import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaAvatar from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const INITIAL_BPM = 72
const MAX_BPM = 160
const BPM_INCREASE_PER_SECOND = 3.2
const TARGET_RING_RADIUS = 60
const SHRINK_START_RADIUS = 180
const PERFECT_THRESHOLD = 8
const GOOD_THRESHOLD = 22
const PERFECT_SCORE = 3
const GOOD_SCORE = 1
const MISS_PENALTY = 1
const LOW_TIME_THRESHOLD_MS = 5000
const JUDGMENT_DISPLAY_MS = 480
const PULSE_DURATION_MS = 300
const RING_STROKE_WIDTH = 4
const TARGET_STROKE_WIDTH = 3
const SVG_SIZE = 280
const SVG_CENTER = SVG_SIZE / 2

const FEVER_COMBO_THRESHOLD = 15
const FEVER_DURATION_MS = 10000
const FEVER_PERFECT_THRESHOLD = 14
const FEVER_GOOD_THRESHOLD = 30
const FEVER_SCORE_MULTIPLIER = 2
const FEVER_TIME_BONUS_MS = 3000
const PERFECT_STREAK_BONUS_THRESHOLD = 5
const PERFECT_STREAK_BONUS_SCORE = 10

type Judgment = 'PERFECT!' | 'GOOD' | 'MISS'

interface BeatNote {
  readonly id: number
  readonly spawnedAt: number
  readonly beatDurationMs: number
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
  return -MISS_PENALTY
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
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [activeNotes, setActiveNotes] = useState<BeatNote[]>([])
  const [judgment, setJudgment] = useState<Judgment | null>(null)
  const [isPulseActive, setPulseActive] = useState(false)
  const [currentBpmDisplay, setCurrentBpmDisplay] = useState(INITIAL_BPM)
  const [isFeverMode, setIsFeverMode] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [perfectStreak, setPerfectStreak] = useState(0)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
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

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(judgmentTimerRef)
    clearTimeoutSafe(pulseTimerRef)
    playAudio(gameOverAudioRef, 0.64, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: Math.max(0, scoreRef.current),
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    const notes = activeNotesRef.current
    if (notes.length === 0) {
      const nextCombo = 0
      comboRef.current = nextCombo
      setCombo(nextCombo)
      perfectStreakRef.current = 0
      setPerfectStreak(0)
      const nextScore = Math.max(0, scoreRef.current - MISS_PENALTY)
      scoreRef.current = nextScore
      setScore(nextScore)
      showJudgment('MISS')
      playAudio(gameOverAudioRef, 0.25, 1.3)
      if (feverActiveRef.current) deactivateFever()
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

    // Apply fever multiplier
    if (feverActiveRef.current && delta > 0) {
      delta *= FEVER_SCORE_MULTIPLIER
    }

    // Perfect streak bonus
    if (j === 'PERFECT!') {
      const nextPerfectStreak = perfectStreakRef.current + 1
      perfectStreakRef.current = nextPerfectStreak
      setPerfectStreak(nextPerfectStreak)
      if (nextPerfectStreak > 0 && nextPerfectStreak % PERFECT_STREAK_BONUS_THRESHOLD === 0) {
        delta += PERFECT_STREAK_BONUS_SCORE
        effects.comboHitBurst(130, 130, nextPerfectStreak, PERFECT_STREAK_BONUS_SCORE, ['⚡', '💎', '🌟'])
        effects.showScorePopup(PERFECT_STREAK_BONUS_SCORE, 130, 80)
      }
    } else {
      perfectStreakRef.current = 0
      setPerfectStreak(0)
    }

    const nextScore = Math.max(0, scoreRef.current + delta)
    scoreRef.current = nextScore
    setScore(nextScore)

    if (j === 'MISS') {
      comboRef.current = 0
      setCombo(0)
      playAudio(gameOverAudioRef, 0.25, 1.3)
      effects.triggerShake(5)
      effects.triggerFlash('rgba(239,68,68,0.25)')
      if (feverActiveRef.current) deactivateFever()
    } else {
      const nextCombo = comboRef.current + 1
      comboRef.current = nextCombo
      setCombo(nextCombo)
      if (nextCombo > maxComboRef.current) {
        maxComboRef.current = nextCombo
        setMaxCombo(nextCombo)
      }

      // Trigger fever
      if (nextCombo === FEVER_COMBO_THRESHOLD && !feverActiveRef.current) {
        activateFever()
        playAudio(tapHitStrongAudioRef, 0.8, 1.3)
        effects.comboHitBurst(130, 130, nextCombo, delta, ['🔥', '⚡', '💥', '🌟'])
      } else if (j === 'PERFECT!') {
        playAudio(tapHitStrongAudioRef, 0.55, 1 + nextCombo * 0.008)
        triggerPulse()
        effects.comboHitBurst(130, 130, nextCombo, delta)
      } else {
        playAudio(tapHitAudioRef, 0.45, 1 + nextCombo * 0.005)
        effects.triggerFlash(feverActiveRef.current ? 'rgba(251,191,36,0.3)' : 'rgba(250,204,21,0.2)')
        effects.spawnParticles(3, 130, 130)
        effects.showScorePopup(delta, 130, 100)
      }
    }

    showJudgment(j)

    const nextNotes = [...notes]
    nextNotes.splice(bestIndex, 1)
    activeNotesRef.current = nextNotes
    setActiveNotes(nextNotes)
  }, [activateFever, deactivateFever, playAudio, showJudgment, triggerPulse])

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
      clearTimeoutSafe(judgmentTimerRef)
      clearTimeoutSafe(pulseTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
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
          const nextScore = Math.max(0, scoreRef.current - MISS_PENALTY)
          scoreRef.current = nextScore
          setScore(nextScore)
          comboRef.current = 0
          setCombo(0)
          perfectStreakRef.current = 0
          setPerfectStreak(0)
        }
        if (expiredNotes.length > 0) {
          showJudgment('MISS')
          if (feverActiveRef.current) deactivateFever()
        }
        activeNotesRef.current = survivingNotes
        setActiveNotes(survivingNotes)
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
  }, [deactivateFever, finishGame, showJudgment])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const comboLabel = combo >= 2 ? `${combo} COMBO` : ''

  const noteCircles = useMemo(() => {
    const now = window.performance.now()
    return activeNotes.map((note) => {
      const r = radiusForNote(note, now)
      const progress = clampNumber((now - note.spawnedAt) / note.beatDurationMs, 0, 1)
      const opacity = 0.3 + progress * 0.7
      return { id: note.id, radius: Math.max(0, r), opacity }
    })
  }, [activeNotes, remainingMs])

  return (
    <section className={`mini-game-panel rhythm-tap-panel ${isFeverMode ? 'rhythm-tap-fever' : ''}`} aria-label="rhythm-tap-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div className="rhythm-tap-score-strip">
        <p className="rhythm-tap-score">{score.toLocaleString()}</p>
        <p className="rhythm-tap-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`rhythm-tap-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="rhythm-tap-meta-row">
        <p className="rhythm-tap-bpm">
          BPM <strong>{currentBpmDisplay}</strong>
        </p>
        <p className="rhythm-tap-combo-label">
          {comboLabel && <strong>{comboLabel}</strong>}
        </p>
        <p className="rhythm-tap-max-combo">
          MAX <strong>{maxCombo}</strong>
        </p>
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
        onClick={handleTap}
        role="button"
        tabIndex={0}
        aria-label="Tap area"
      >
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

          {/* Show wider zones during fever */}
          <circle
            cx={SVG_CENTER}
            cy={SVG_CENTER}
            r={TARGET_RING_RADIUS + (isFeverMode ? FEVER_GOOD_THRESHOLD : GOOD_THRESHOLD)}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1}
            opacity={0.12}
            strokeDasharray="4 4"
          />
          <circle
            cx={SVG_CENTER}
            cy={SVG_CENTER}
            r={Math.max(0, TARGET_RING_RADIUS - (isFeverMode ? FEVER_GOOD_THRESHOLD : GOOD_THRESHOLD))}
            fill="none"
            stroke="#ffffff"
            strokeWidth={1}
            opacity={0.12}
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
            r={6}
            fill={isFeverMode ? '#fbbf24' : '#ec4899'}
            opacity={0.9}
          />
        </svg>

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

        <p className="rhythm-tap-tap-hint">TAP!</p>
      </div>

      <div className="rhythm-tap-mascot-row">
        <img
          className={`rhythm-tap-mascot ${isPulseActive ? 'bounce' : ''}`}
          src={kimYeonjaAvatar}
          alt="avatar"
          draggable={false}
        />
      </div>

      <div className="rhythm-tap-scoring-guide">
        <span className="rhythm-tap-guide-item perfect">PERFECT +{PERFECT_SCORE}{isFeverMode ? ` x${FEVER_SCORE_MULTIPLIER}` : ''}</span>
        <span className="rhythm-tap-guide-item good">GOOD +{GOOD_SCORE}{isFeverMode ? ` x${FEVER_SCORE_MULTIPLIER}` : ''}</span>
        <span className="rhythm-tap-guide-item miss">MISS -{MISS_PENALTY}</span>
      </div>

      {combo >= 3 && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -80px)', fontSize: `${14 + combo}px`, color: getComboColor(combo), zIndex: 20 }}>
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>

      <style>{GAME_EFFECTS_CSS}
      {`
        .rhythm-tap-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 12px 8px;
          user-select: none;
          -webkit-user-select: none;
        }

        .rhythm-tap-panel.rhythm-tap-fever {
          animation: rhythm-tap-fever-bg 0.5s ease-in-out infinite alternate;
        }

        @keyframes rhythm-tap-fever-bg {
          from { box-shadow: inset 0 0 40px rgba(251,191,36,0.1); }
          to { box-shadow: inset 0 0 60px rgba(251,191,36,0.25); }
        }

        .rhythm-tap-fever-banner {
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          color: #fff;
          font-size: 16px;
          font-weight: 900;
          padding: 4px 20px;
          border-radius: 16px;
          letter-spacing: 3px;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          animation: rhythm-tap-fever-pulse 0.4s ease-in-out infinite alternate;
          text-align: center;
        }

        @keyframes rhythm-tap-fever-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.06); }
        }

        .rhythm-tap-fever-timer {
          width: 100%;
          height: 3px;
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

        .rhythm-tap-perfect-streak {
          font-size: 11px;
          color: #ec4899 !important;
          font-weight: 700;
        }

        .rhythm-tap-perfect-streak strong {
          color: #ec4899 !important;
        }

        .rhythm-tap-score-strip {
          display: flex;
          align-items: baseline;
          justify-content: center;
          gap: 12px;
          width: 100%;
        }

        .rhythm-tap-score {
          font-size: 28px;
          font-weight: 800;
          color: #ec4899;
          margin: 0;
          letter-spacing: -1px;
        }

        .rhythm-tap-best {
          font-size: 12px;
          color: #a1a1aa;
          margin: 0;
          font-weight: 600;
        }

        .rhythm-tap-time {
          font-size: 16px;
          font-weight: 700;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
          transition: color 0.2s;
        }

        .rhythm-tap-time.low-time {
          color: #ef4444;
          animation: rhythm-tap-time-blink 0.5s ease-in-out infinite alternate;
        }

        @keyframes rhythm-tap-time-blink {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .rhythm-tap-meta-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          width: 100%;
          margin: 0;
        }

        .rhythm-tap-meta-row p {
          margin: 0;
          font-size: 12px;
          color: #a1a1aa;
          font-weight: 500;
        }

        .rhythm-tap-meta-row strong {
          color: #e4e4e7;
          font-weight: 700;
        }

        .rhythm-tap-combo-label strong {
          color: #facc15 !important;
          font-size: 13px;
        }

        .rhythm-tap-arena {
          position: relative;
          width: 260px;
          height: 260px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(236,72,153,0.06) 0%, transparent 70%);
          transition: transform 0.1s ease-out, box-shadow 0.15s;
          outline: none;
          -webkit-tap-highlight-color: transparent;
        }

        .rhythm-tap-fever .rhythm-tap-arena {
          background: radial-gradient(circle, rgba(251,191,36,0.12) 0%, transparent 70%);
        }

        .rhythm-tap-arena:active {
          transform: scale(0.96);
        }

        .rhythm-tap-arena.pulse {
          animation: rhythm-tap-pulse 0.3s ease-out;
        }

        .rhythm-tap-arena.miss-shake {
          animation: rhythm-tap-shake 0.3s ease-out;
        }

        @keyframes rhythm-tap-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(236,72,153,0.5);
            transform: scale(1);
          }
          50% {
            box-shadow: 0 0 40px 20px rgba(236,72,153,0.2);
            transform: scale(1.04);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(236,72,153,0);
            transform: scale(1);
          }
        }

        @keyframes rhythm-tap-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
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

        .rhythm-tap-judgment {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          pointer-events: none;
          animation: rhythm-tap-judgment-pop 0.48s ease-out forwards;
        }

        .rhythm-tap-judgment-text {
          font-size: 28px;
          font-weight: 900;
          letter-spacing: 2px;
          text-shadow: 0 2px 12px rgba(0,0,0,0.6);
        }

        @keyframes rhythm-tap-judgment-pop {
          0% {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.5);
          }
          15% {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1.3);
          }
          30% {
            transform: translate(-50%, -50%) scale(1);
          }
          80% {
            opacity: 1;
            transform: translate(-50%, -60%) scale(1);
          }
          100% {
            opacity: 0;
            transform: translate(-50%, -80%) scale(0.9);
          }
        }

        .rhythm-tap-combo-display {
          position: absolute;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          pointer-events: none;
          animation: rhythm-tap-combo-bounce 0.3s ease-out;
        }

        .rhythm-tap-combo-number {
          font-size: 42px;
          font-weight: 900;
          color: rgba(250,204,21,0.35);
          letter-spacing: -2px;
        }

        @keyframes rhythm-tap-combo-bounce {
          0% { transform: translateX(-50%) scale(1.4); opacity: 0.6; }
          100% { transform: translateX(-50%) scale(1); opacity: 1; }
        }

        .rhythm-tap-tap-hint {
          position: absolute;
          bottom: -4px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 14px;
          color: #71717a;
          margin: 0;
          pointer-events: none;
          font-weight: 600;
          letter-spacing: 2px;
        }

        .rhythm-tap-mascot-row {
          display: flex;
          justify-content: center;
          margin: 0;
        }

        .rhythm-tap-mascot {
          width: 80px;
          height: 80px;
          object-fit: contain;
          border-radius: 50%;
          border: 2px solid #ec4899;
          background: rgba(236,72,153,0.08);
          transition: transform 0.2s;
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
          40% { transform: scale(1.15) translateY(-6px); }
          100% { transform: scale(1) translateY(0); }
        }

        .rhythm-tap-scoring-guide {
          display: flex;
          gap: 12px;
          justify-content: center;
          margin: 4px 0 0;
        }

        .rhythm-tap-guide-item {
          font-size: 13px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 6px;
          background: rgba(255,255,255,0.06);
        }

        .rhythm-tap-guide-item.perfect {
          color: #ec4899;
        }

        .rhythm-tap-guide-item.good {
          color: #facc15;
        }

        .rhythm-tap-guide-item.miss {
          color: #ef4444;
        }
      `}</style>
    </section>
  )
}

export const rhythmTapModule: MiniGameModule = {
  manifest: {
    id: 'rhythm-tap',
    title: 'Rhythm Tap',
    description: '\uC218\uCD95\uD558\uB294 \uC6D0\uC774 \uD0C0\uAC9F\uC5D0 \uB9DE\uC744 \uB54C \uC815\uD655\uD788 \uD0ED! \uB9AC\uB4EC\uAC10\uC744 \uC99D\uBA85\uD558\uB77C',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#ec4899',
  },
  Component: RhythmTapGame,
}
