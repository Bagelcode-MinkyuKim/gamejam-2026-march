import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import characterImage from '../../../assets/images/same-character/park-sangmin.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const LANE_COUNT = 4
const PERFECT_WINDOW_MS = 50
const GOOD_WINDOW_MS = 120
const PERFECT_SCORE = 3
const GOOD_SCORE = 1
const FEVER_COMBO_THRESHOLD = 20
const FEVER_DURATION_MS = 8000
const FEVER_MULTIPLIER = 3
const GOLDEN_NOTE_CHANCE = 0.08
const GOLDEN_NOTE_MULTIPLIER = 3
const HIT_LINE_Y = 0.85
const NOTE_SPAWN_Y = -0.05
const INITIAL_BPM = 100
const MAX_BPM = 180
const BPM_INCREASE_PER_SECOND = 2.8
const NOTE_TRAVEL_DURATION_MS = 1800
const LOW_TIME_THRESHOLD_MS = 5000
const FLASH_DURATION_MS = 200
const JUDGMENT_DISPLAY_MS = 400

const LANE_COLORS = ['#ef4444', '#22c55e', '#3b82f6', '#f59e0b'] as const
const LANE_LABELS = ['A', 'S', 'D', 'F'] as const

interface Note {
  readonly id: number
  readonly lane: number
  readonly targetTimeMs: number
  readonly isGolden: boolean
  alive: boolean
  judged: boolean
}

type JudgmentKind = 'perfect' | 'good' | 'miss'

interface JudgmentDisplay {
  readonly kind: JudgmentKind
  readonly lane: number
  readonly expiresAt: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeBpm(elapsedMs: number): number {
  return Math.min(MAX_BPM, INITIAL_BPM + (elapsedMs / 1000) * BPM_INCREASE_PER_SECOND)
}

function generatePattern(bpm: number): number[] {
  const beatsPerPattern = 4
  const pattern: number[] = []
  const beatIntervalMs = 60000 / bpm

  for (let beat = 0; beat < beatsPerPattern; beat += 1) {
    const laneCount = beat === 0 || beat === 2 ? 1 : Math.random() < 0.3 ? 2 : 1
    const usedLanes = new Set<number>()

    for (let n = 0; n < laneCount; n += 1) {
      let lane: number
      do {
        lane = Math.floor(Math.random() * LANE_COUNT)
      } while (usedLanes.has(lane))
      usedLanes.add(lane)
      pattern.push(lane)
    }

    if (beat < beatsPerPattern - 1 && bpm > 130 && Math.random() < 0.25) {
      const offbeatLane = Math.floor(Math.random() * LANE_COUNT)
      pattern.push(offbeatLane + LANE_COUNT)
    }
  }

  return pattern
}

function noteYPosition(currentTimeMs: number, targetTimeMs: number): number {
  const timeDiff = targetTimeMs - currentTimeMs
  const progress = 1 - timeDiff / NOTE_TRAVEL_DURATION_MS
  return NOTE_SPAWN_Y + progress * (HIT_LINE_Y - NOTE_SPAWN_Y)
}

function DrumCircleGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [perfectCount, setPerfectCount] = useState(0)
  const [goodCount, setGoodCount] = useState(0)
  const [missCount, setMissCount] = useState(0)
  const [judgmentDisplays, setJudgmentDisplays] = useState<JudgmentDisplay[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [currentBpm, setCurrentBpm] = useState(INITIAL_BPM)
  const [laneFlash, setLaneFlash] = useState<(number | null)[]>(() => Array(LANE_COUNT).fill(null))
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const perfectCountRef = useRef(0)
  const goodCountRef = useRef(0)
  const missCountRef = useRef(0)
  const notesRef = useRef<Note[]>([])
  const nextNoteIdRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const gameStartTimeRef = useRef<number | null>(null)
  const nextPatternTimeRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const showJudgment = useCallback((kind: JudgmentKind, lane: number) => {
    const now = performance.now()
    setJudgmentDisplays((previous) => [
      ...previous.filter((j) => j.expiresAt > now),
      { kind, lane, expiresAt: now + JUDGMENT_DISPLAY_MS },
    ])
  }, [])

  const flashLane = useCallback((lane: number) => {
    setLaneFlash((previous) => {
      const next = [...previous]
      next[lane] = performance.now()
      return next
    })
    setTimeout(() => {
      setLaneFlash((previous) => {
        const next = [...previous]
        if (next[lane] !== null && performance.now() - next[lane]! > FLASH_DURATION_MS * 0.8) {
          next[lane] = null
        }
        return next
      })
    }, FLASH_DURATION_MS)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const handleLaneHit = useCallback(
    (lane: number) => {
      if (finishedRef.current) {
        return
      }

      flashLane(lane)

      const currentElapsed = elapsedMsRef.current
      const activeNotes = notesRef.current.filter((n) => n.alive && !n.judged && n.lane === lane)

      if (activeNotes.length === 0) {
        comboRef.current = 0
        setCombo(0)
        missCountRef.current += 1
        setMissCount(missCountRef.current)
        showJudgment('miss', lane)
        playAudio(tapHitAudioRef, 0.2, 0.7)
        effects.triggerShake(3)
        return
      }

      let closestNote: Note | null = null
      let closestDiff = Infinity

      for (const note of activeNotes) {
        const diff = Math.abs(currentElapsed - note.targetTimeMs)
        if (diff < closestDiff) {
          closestDiff = diff
          closestNote = note
        }
      }

      if (closestNote === null || closestDiff > GOOD_WINDOW_MS) {
        comboRef.current = 0
        setCombo(0)
        missCountRef.current += 1
        setMissCount(missCountRef.current)
        showJudgment('miss', lane)
        playAudio(tapHitAudioRef, 0.2, 0.7)
        effects.triggerShake(3)
        return
      }

      closestNote.judged = true
      closestNote.alive = false

      if (closestDiff <= PERFECT_WINDOW_MS) {
        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)
        if (nextCombo > maxComboRef.current) {
          maxComboRef.current = nextCombo
          setMaxCombo(nextCombo)
        }

        const comboBonus = Math.floor(nextCombo / 10)
        const goldenMult = closestNote.isGolden ? GOLDEN_NOTE_MULTIPLIER : 1
        const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
        const earned = (PERFECT_SCORE + comboBonus) * goldenMult * feverMult
        scoreRef.current += earned
        setScore(scoreRef.current)
        perfectCountRef.current += 1
        setPerfectCount(perfectCountRef.current)
        showJudgment('perfect', lane)
        playAudio(tapHitStrongAudioRef, 0.6, 1.0 + nextCombo * 0.005)

        // Activate fever at combo threshold
        if (nextCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
        }

        // Visual effects for perfect hit
        const laneX = 50 + lane * 80
        effects.comboHitBurst(laneX, 300, nextCombo, earned)
      } else {
        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)
        if (nextCombo > maxComboRef.current) {
          maxComboRef.current = nextCombo
          setMaxCombo(nextCombo)
        }

        const goldenMult = closestNote.isGolden ? GOLDEN_NOTE_MULTIPLIER : 1
        const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
        const earned = GOOD_SCORE * goldenMult * feverMult
        scoreRef.current += earned
        setScore(scoreRef.current)
        goodCountRef.current += 1
        setGoodCount(goodCountRef.current)
        showJudgment('good', lane)
        playAudio(tapHitAudioRef, 0.45, 1.0)

        // Visual effects for good hit
        const laneX = 50 + lane * 80
        effects.spawnParticles(3, laneX, 300)
        effects.showScorePopup(earned, laneX, 280)
      }
    },
    [flashLane, playAudio, showJudgment],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }

      if (finishedRef.current) {
        return
      }

      const keyMap: Record<string, number> = {
        KeyA: 0,
        KeyS: 1,
        KeyD: 2,
        KeyF: 3,
        ArrowLeft: 0,
        ArrowDown: 1,
        ArrowUp: 2,
        ArrowRight: 3,
      }

      const lane = keyMap[event.code]
      if (lane !== undefined) {
        event.preventDefault()
        handleLaneHit(lane)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleLaneHit, onExit])

  useEffect(() => {
    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    return () => {
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    gameStartTimeRef.current = null
    nextPatternTimeRef.current = NOTE_TRAVEL_DURATION_MS

    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) {
        lastFrameAtRef.current = now
        gameStartTimeRef.current = now
      }

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      elapsedMsRef.current += deltaMs
      const elapsedMs = elapsedMsRef.current

      const bpm = computeBpm(elapsedMs)
      setCurrentBpm(bpm)

      if (elapsedMs >= nextPatternTimeRef.current) {
        const beatIntervalMs = 60000 / bpm
        const pattern = generatePattern(bpm)
        const patternStartTime = nextPatternTimeRef.current

        let beatIndex = 0
        for (const entry of pattern) {
          const isOffbeat = entry >= LANE_COUNT
          const lane = isOffbeat ? entry - LANE_COUNT : entry
          const timeOffset = isOffbeat
            ? beatIndex * beatIntervalMs - beatIntervalMs * 0.5
            : beatIndex * beatIntervalMs

          const noteId = nextNoteIdRef.current
          nextNoteIdRef.current += 1

          notesRef.current.push({
            id: noteId,
            lane,
            targetTimeMs: patternStartTime + timeOffset,
            isGolden: Math.random() < GOLDEN_NOTE_CHANCE,
            alive: true,
            judged: false,
          })

          if (!isOffbeat) {
            beatIndex += 1
          }
        }

        nextPatternTimeRef.current = patternStartTime + 4 * beatIntervalMs
      }

      // Fever timer countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      const missWindow = GOOD_WINDOW_MS + 80
      for (const note of notesRef.current) {
        if (note.alive && !note.judged && elapsedMs > note.targetTimeMs + missWindow) {
          note.alive = false
          note.judged = true
          comboRef.current = 0
          setCombo(0)
          missCountRef.current += 1
          setMissCount(missCountRef.current)
        }
      }

      notesRef.current = notesRef.current.filter(
        (n) => n.alive || elapsedMs - n.targetTimeMs < 500,
      )

      setNotes([...notesRef.current])

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
  }, [finishGame])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const elapsedMs = ROUND_DURATION_MS - remainingMs
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  const activeJudgments = useMemo(() => {
    const now = performance.now()
    return judgmentDisplays.filter((j) => j.expiresAt > now)
  }, [judgmentDisplays, notes])

  return (
    <section className="mini-game-panel drum-circle-panel" aria-label="drum-circle-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .drum-circle-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1a0a0a 0%, #0d0d1a 40%, #1a0f05 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          position: relative;
          overflow: hidden;
        }

        .drum-circle-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px 8px;
          background: linear-gradient(135deg, rgba(234,88,12,0.3) 0%, rgba(154,52,18,0.2) 100%);
          border-bottom: 1px solid rgba(234,88,12,0.2);
          flex-shrink: 0;
        }

        .drum-circle-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .drum-circle-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #ea580c;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(234,88,12,0.5);
        }

        .drum-circle-header-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .drum-circle-score {
          font-size: 24px;
          font-weight: 800;
          color: #fb923c;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 14px rgba(234,88,12,0.6);
        }

        .drum-circle-best {
          font-size: 10px;
          color: #fdba74;
          margin: 0;
          opacity: 0.7;
        }

        .drum-circle-header-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .drum-circle-time {
          font-size: 18px;
          font-weight: 700;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .drum-circle-time.low-time {
          color: #ef4444;
          animation: drum-circle-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes drum-circle-pulse {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }

        .drum-circle-meta-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          padding: 6px 16px;
          font-size: 11px;
          color: #fdba74;
          flex-shrink: 0;
        }

        .drum-circle-meta-row p {
          margin: 0;
        }

        .drum-circle-meta-row strong {
          color: #e4e4e7;
          font-weight: 700;
        }

        .drum-circle-stats-row {
          display: flex;
          justify-content: center;
          gap: 14px;
          padding: 0 16px 4px;
          font-size: 10px;
          flex-shrink: 0;
        }

        .drum-circle-stat {
          font-weight: 700;
          letter-spacing: 0.3px;
        }

        .drum-circle-stat.perfect {
          color: #facc15;
          text-shadow: 0 0 6px rgba(250,204,21,0.4);
        }

        .drum-circle-stat.good {
          color: #22c55e;
          text-shadow: 0 0 6px rgba(34,197,94,0.4);
        }

        .drum-circle-stat.miss {
          color: #ef4444;
          text-shadow: 0 0 6px rgba(239,68,68,0.4);
        }

        .drum-circle-stage {
          position: relative;
          flex: 1;
          margin: 0 12px;
          background: linear-gradient(180deg, #0f0f23 0%, #1a1a2e 50%, #0f0f23 100%);
          border-radius: 12px;
          overflow: hidden;
          border: 2px solid rgba(234,88,12,0.25);
          box-shadow: inset 0 0 30px rgba(0,0,0,0.5);
          min-height: 0;
        }

        .drum-circle-lanes {
          display: flex;
          height: 100%;
        }

        .drum-circle-lane {
          flex: 1;
          position: relative;
          border-right: 1px solid rgba(255,255,255,0.04);
          transition: background 0.15s;
        }

        .drum-circle-lane.flash {
          background: rgba(255, 255, 255, 0.08);
        }

        .drum-circle-note {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 36px;
          height: 14px;
          border-radius: 7px;
          box-shadow: 0 0 10px currentColor;
        }

        .drum-circle-hit-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 3px;
          background: linear-gradient(90deg, rgba(234,88,12,0.6), rgba(255,255,255,0.35), rgba(234,88,12,0.6));
          pointer-events: none;
          box-shadow: 0 0 8px rgba(234,88,12,0.3);
        }

        .drum-circle-judgment {
          position: absolute;
          top: 70%;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          font-weight: 800;
          pointer-events: none;
          animation: drum-circle-judgment-pop 0.4s ease-out forwards;
        }

        .drum-circle-judgment.perfect {
          color: #facc15;
          text-shadow: 0 0 8px rgba(250,204,21,0.6);
        }

        .drum-circle-judgment.good {
          color: #22c55e;
          text-shadow: 0 0 8px rgba(34,197,94,0.6);
        }

        .drum-circle-judgment.miss {
          color: #ef4444;
          text-shadow: 0 0 8px rgba(239,68,68,0.6);
        }

        @keyframes drum-circle-judgment-pop {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.3); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.8); }
        }

        .drum-circle-pad-row {
          display: flex;
          gap: 8px;
          padding: 10px 12px;
          flex-shrink: 0;
        }

        .drum-circle-pad {
          flex: 1;
          padding: 16px 0;
          border-radius: 12px;
          border: 2px solid;
          color: #fff;
          font-size: 18px;
          font-weight: 800;
          cursor: pointer;
          transition: transform 0.08s, box-shadow 0.1s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          box-shadow: 0 4px 12px rgba(0,0,0,0.4);
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .drum-circle-pad:active,
        .drum-circle-pad.active {
          transform: scale(0.93);
          filter: brightness(1.3);
          box-shadow: 0 0 16px currentColor;
        }

        .drum-circle-footer {
          display: flex;
          justify-content: center;
          padding: 6px 16px 12px;
          flex-shrink: 0;
        }

        .drum-circle-exit-btn {
          padding: 7px 22px;
          border-radius: 20px;
          border: 1px solid rgba(234,88,12,0.3);
          background: rgba(234,88,12,0.1);
          color: #fdba74;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }

        .drum-circle-exit-btn:active {
          transform: scale(0.95);
          background: rgba(234,88,12,0.2);
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="drum-circle-header">
        <div className="drum-circle-header-left">
          <img className="drum-circle-avatar" src={characterImage} alt="character" />
          <div className="drum-circle-header-info">
            <p className="drum-circle-score">{score.toLocaleString()}</p>
            <p className="drum-circle-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="drum-circle-header-right">
          <p className={`drum-circle-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      <div className="drum-circle-meta-row">
        <p className="drum-circle-combo">
          COMBO <strong>{combo}</strong>
          {comboLabel && (
            <span className="ge-combo-label" style={{ color: comboColor, marginLeft: 4, fontSize: 10 }}>{comboLabel}</span>
          )}
        </p>
        <p className="drum-circle-bpm">
          BPM <strong>{Math.round(currentBpm)}</strong>
        </p>
        <p className="drum-circle-max-combo">
          MAX <strong>{maxCombo}</strong>
        </p>
        {isFever && (
          <p style={{ color: '#facc15', fontSize: 10, fontWeight: 800, margin: 0, animation: 'drum-circle-pulse 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div className="drum-circle-stats-row">
        <span className="drum-circle-stat perfect">Perfect {perfectCount}</span>
        <span className="drum-circle-stat good">Good {goodCount}</span>
        <span className="drum-circle-stat miss">Miss {missCount}</span>
      </div>

      <div className="drum-circle-stage">
        <div className="drum-circle-lanes">
          {Array.from({ length: LANE_COUNT }, (_, laneIndex) => (
            <div
              className={`drum-circle-lane ${laneFlash[laneIndex] !== null ? 'flash' : ''}`}
              key={`lane-${laneIndex}`}
              style={{ borderColor: LANE_COLORS[laneIndex] }}
            >
              {notes
                .filter((n) => n.lane === laneIndex && n.alive)
                .map((note) => {
                  const yPos = noteYPosition(elapsedMs, note.targetTimeMs)
                  if (yPos < NOTE_SPAWN_Y || yPos > 1.05) {
                    return null
                  }

                  return (
                    <div
                      className="drum-circle-note"
                      key={note.id}
                      style={{
                        top: `${yPos * 100}%`,
                        backgroundColor: note.isGolden ? '#fbbf24' : LANE_COLORS[laneIndex],
                        boxShadow: note.isGolden ? '0 0 12px #fbbf24, 0 0 4px #fbbf24' : undefined,
                        height: note.isGolden ? 18 : undefined,
                        width: note.isGolden ? 42 : undefined,
                      }}
                    />
                  )
                })}

              {activeJudgments
                .filter((j) => j.lane === laneIndex)
                .map((j, i) => (
                  <div
                    className={`drum-circle-judgment ${j.kind}`}
                    key={`judgment-${laneIndex}-${i}`}
                  >
                    {j.kind === 'perfect' ? 'PERFECT' : j.kind === 'good' ? 'GOOD' : 'MISS'}
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="drum-circle-hit-line" style={{ top: `${HIT_LINE_Y * 100}%` }} />
      </div>

      <div className="drum-circle-pad-row">
        {Array.from({ length: LANE_COUNT }, (_, laneIndex) => (
          <button
            className={`drum-circle-pad ${laneFlash[laneIndex] !== null ? 'active' : ''}`}
            key={`pad-${laneIndex}`}
            type="button"
            style={{
              backgroundColor: LANE_COLORS[laneIndex],
              borderColor: LANE_COLORS[laneIndex],
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              handleLaneHit(laneIndex)
            }}
          >
            {LANE_LABELS[laneIndex]}
          </button>
        ))}
      </div>

      <div className="drum-circle-footer">
        <button className="drum-circle-exit-btn" type="button" onClick={onExit}>
          허브로 돌아가기
        </button>
      </div>
    </section>
  )
}

export const drumCircleModule: MiniGameModule = {
  manifest: {
    id: 'drum-circle',
    title: 'Drum Circle',
    description: '내려오는 비트에 맞춰 드럼을 쳐라! 리듬 게임!',
    unlockCost: 55,
    baseReward: 17,
    scoreRewardMultiplier: 1.25,
    accentColor: '#ea580c',
  },
  Component: DrumCircleGame,
}
