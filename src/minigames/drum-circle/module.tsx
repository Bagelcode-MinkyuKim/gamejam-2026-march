import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import characterImage from '../../../assets/images/same-character/park-sangmin.png'
import dcPerfectSfx from '../../../assets/sounds/drum-circle-perfect.mp3'
import dcGoodSfx from '../../../assets/sounds/drum-circle-good.mp3'
import dcMissSfx from '../../../assets/sounds/drum-circle-miss.mp3'
import dcFeverSfx from '../../../assets/sounds/drum-circle-fever.mp3'
import dcComboSfx from '../../../assets/sounds/drum-circle-combo.mp3'
import dcGoldenSfx from '../../../assets/sounds/drum-circle-golden.mp3'
import dsTimeWarnSfx from '../../../assets/sounds/dance-step-time-warning.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

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
const HOLD_NOTE_ELAPSED_MS = 15000
const HOLD_NOTE_CHANCE = 0.15
const HOLD_NOTE_DURATION_MS = 400
const HOLD_NOTE_BONUS = 5
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
const LANE_EMOJIS = ['\u{1F941}', '\u{1F3B5}', '\u{1F3B6}', '\u{1F525}'] as const

interface Note {
  readonly id: number
  readonly lane: number
  readonly targetTimeMs: number
  readonly isGolden: boolean
  readonly isHold: boolean
  readonly holdDurationMs: number
  alive: boolean
  judged: boolean
  holdCompleted: boolean
}

type JudgmentKind = 'perfect' | 'good' | 'miss'

interface JudgmentDisplay {
  readonly kind: JudgmentKind
  readonly lane: number
  readonly expiresAt: number
}

function computeBpm(elapsedMs: number): number {
  return Math.min(MAX_BPM, INITIAL_BPM + (elapsedMs / 1000) * BPM_INCREASE_PER_SECOND)
}

function generatePattern(bpm: number, elapsedMs: number): number[] {
  const beatsPerPattern = 4
  const pattern: number[] = []

  for (let beat = 0; beat < beatsPerPattern; beat += 1) {
    const laneCount = beat === 0 || beat === 2 ? 1 : Math.random() < 0.3 ? 2 : 1
    const usedLanes = new Set<number>()

    for (let n = 0; n < laneCount; n += 1) {
      let lane: number
      do {
        lane = Math.floor(Math.random() * LANE_COUNT)
      } while (usedLanes.has(lane))
      usedLanes.add(lane)

      if (elapsedMs > HOLD_NOTE_ELAPSED_MS && Math.random() < HOLD_NOTE_CHANCE) {
        pattern.push(lane + 100)
      } else {
        pattern.push(lane)
      }
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
  const [heldLanes, setHeldLanes] = useState<boolean[]>(() => Array(LANE_COUNT).fill(false))

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
  const nextPatternTimeRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const comboMilestoneRef = useRef(0)
  const heldLanesRef = useRef<boolean[]>(Array(LANE_COUNT).fill(false))
  const lowTimeSecondRef = useRef<number | null>(null)

  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const goodAudioRef = useRef<HTMLAudioElement | null>(null)
  const missAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const goldenAudioRef = useRef<HTMLAudioElement | null>(null)
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
    if (finishedRef.current) return
    finishedRef.current = true
    playAudio(gameOverAudioRef, 0.6, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleLaneHit = useCallback(
    (lane: number) => {
      if (finishedRef.current) return

      flashLane(lane)

      const currentElapsed = elapsedMsRef.current
      const activeNotes = notesRef.current.filter((n) => n.alive && !n.judged && n.lane === lane)

      if (activeNotes.length === 0) {
        comboRef.current = 0
        setCombo(0)
        missCountRef.current += 1
        setMissCount(missCountRef.current)
        showJudgment('miss', lane)
        playAudio(missAudioRef, 0.35, 1.0)
        effects.triggerShake(3)
        effects.triggerFlash('rgba(239,68,68,0.2)')
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
        playAudio(missAudioRef, 0.35, 1.0)
        effects.triggerShake(3)
        return
      }

      if (closestNote.isHold && !closestNote.holdCompleted) {
        heldLanesRef.current[lane] = true
        setHeldLanes([...heldLanesRef.current])
      }

      closestNote.judged = true
      closestNote.alive = false

      const laneX = 30 + lane * 95

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
        const holdBonus = closestNote.isHold ? HOLD_NOTE_BONUS : 0
        const earned = (PERFECT_SCORE + comboBonus + holdBonus) * goldenMult * feverMult
        scoreRef.current += earned
        setScore(scoreRef.current)
        perfectCountRef.current += 1
        setPerfectCount(perfectCountRef.current)
        showJudgment('perfect', lane)

        if (closestNote.isGolden) {
          playAudio(goldenAudioRef, 0.6)
          effects.triggerFlash('rgba(251,191,36,0.4)')
          effects.spawnParticles(6, laneX, 300)
        } else {
          playAudio(perfectAudioRef, 0.55, 1.0 + nextCombo * 0.005)
        }

        if (nextCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(250,204,21,0.5)')
          playAudio(feverAudioRef, 0.6)
        }

        if (nextCombo >= 10 && nextCombo % 10 === 0 && nextCombo > comboMilestoneRef.current) {
          comboMilestoneRef.current = nextCombo
          playAudio(comboAudioRef, 0.5, 1 + (nextCombo / 50) * 0.3)
        }

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
        playAudio(goodAudioRef, 0.45, 1.0)

        effects.spawnParticles(3, laneX, 300)
        effects.showScorePopup(earned, laneX, 280)
      }
    },
    [flashLane, playAudio, showJudgment],
  )

  const handleLaneRelease = useCallback((lane: number) => {
    heldLanesRef.current[lane] = false
    setHeldLanes([...heldLanesRef.current])
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (finishedRef.current) return

      const keyMap: Record<string, number> = {
        KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3,
        ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3,
      }
      const lane = keyMap[event.code]
      if (lane !== undefined) {
        event.preventDefault()
        handleLaneHit(lane)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      const keyMap: Record<string, number> = {
        KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3,
        ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3,
      }
      const lane = keyMap[event.code]
      if (lane !== undefined) handleLaneRelease(lane)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleLaneHit, handleLaneRelease, onExit])

  useEffect(() => {
    const audios = [
      { ref: perfectAudioRef, src: dcPerfectSfx },
      { ref: goodAudioRef, src: dcGoodSfx },
      { ref: missAudioRef, src: dcMissSfx },
      { ref: feverAudioRef, src: dcFeverSfx },
      { ref: comboAudioRef, src: dcComboSfx },
      { ref: goldenAudioRef, src: dcGoldenSfx },
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
    nextPatternTimeRef.current = NOTE_TRAVEL_DURATION_MS

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

      elapsedMsRef.current += deltaMs
      const elapsedMs = elapsedMsRef.current

      const bpm = computeBpm(elapsedMs)
      setCurrentBpm(bpm)

      // Low time warning
      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextSec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextSec) {
          lowTimeSecondRef.current = nextSec
          playAudio(timeWarnAudioRef, 0.3, 1.2)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      // Spawn patterns
      if (elapsedMs >= nextPatternTimeRef.current) {
        const beatIntervalMs = 60000 / bpm
        const pattern = generatePattern(bpm, elapsedMs)
        const patternStartTime = nextPatternTimeRef.current

        let beatIndex = 0
        for (const entry of pattern) {
          const isHoldEncoded = entry >= 100
          const isOffbeat = !isHoldEncoded && entry >= LANE_COUNT
          const lane = isHoldEncoded ? entry - 100 : isOffbeat ? entry - LANE_COUNT : entry
          const timeOffset = isOffbeat
            ? beatIndex * beatIntervalMs - beatIntervalMs * 0.5
            : beatIndex * beatIntervalMs

          const noteId = nextNoteIdRef.current
          nextNoteIdRef.current += 1

          notesRef.current.push({
            id: noteId,
            lane,
            targetTimeMs: patternStartTime + timeOffset,
            isGolden: !isHoldEncoded && Math.random() < GOLDEN_NOTE_CHANCE,
            isHold: isHoldEncoded,
            holdDurationMs: isHoldEncoded ? HOLD_NOTE_DURATION_MS : 0,
            alive: true,
            judged: false,
            holdCompleted: false,
          })

          if (!isOffbeat && !isHoldEncoded) {
            beatIndex += 1
          }
        }

        nextPatternTimeRef.current = patternStartTime + 4 * beatIntervalMs
      }

      // Fever timer
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Miss expired notes
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
  }, [finishGame, playAudio])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const elapsedMs = ROUND_DURATION_MS - remainingMs
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  const activeJudgments = useMemo(() => {
    const now = performance.now()
    return judgmentDisplays.filter((j) => j.expiresAt > now)
  }, [judgmentDisplays, notes])

  const bpmLevel = currentBpm < 120 ? 1 : currentBpm < 150 ? 2 : 3

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

        .drum-circle-panel.fever-active {
          animation: dc-fever-bg 0.5s ease-in-out infinite alternate;
        }

        @keyframes dc-fever-bg {
          from { background: linear-gradient(180deg, #2a1a05 0%, #1a1003 40%, #2a0f05 100%); }
          to { background: linear-gradient(180deg, #1a0a0a 0%, #0d0d1a 40%, #1a0f05 100%); }
        }

        .drum-circle-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px 6px;
          background: linear-gradient(135deg, rgba(234,88,12,0.3) 0%, rgba(154,52,18,0.2) 100%);
          border-bottom: 1px solid rgba(234,88,12,0.2);
          flex-shrink: 0;
        }

        .drum-circle-header-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .drum-circle-avatar {
          width: 38px;
          height: 38px;
          border-radius: 50%;
          border: 2px solid #ea580c;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(234,88,12,0.5);
        }

        .drum-circle-header-info {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .drum-circle-score {
          font-size: 26px;
          font-weight: 900;
          color: #fb923c;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 14px rgba(234,88,12,0.6);
        }

        .drum-circle-best {
          font-size: 9px;
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
          font-size: 20px;
          font-weight: 800;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .drum-circle-time.low-time {
          color: #ef4444;
          animation: drum-circle-pulse 0.5s ease-in-out infinite alternate;
        }

        .dc-bpm-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: 4px;
          background: rgba(234,88,12,0.2);
          color: #fb923c;
        }

        @keyframes drum-circle-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.4; transform: scale(1.05); }
        }

        .drum-circle-status-bar {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          padding: 4px 12px;
          font-size: 11px;
          color: #fdba74;
          flex-shrink: 0;
        }

        .drum-circle-status-bar p {
          margin: 0;
        }

        .drum-circle-status-bar strong {
          color: #e4e4e7;
          font-weight: 700;
        }

        .dc-fever-badge {
          color: #facc15;
          font-size: 11px;
          font-weight: 800;
          animation: drum-circle-pulse 0.3s ease-in-out infinite alternate;
          text-shadow: 0 0 8px rgba(250,204,21,0.6);
        }

        .drum-circle-stats-row {
          display: flex;
          justify-content: center;
          gap: 14px;
          padding: 0 12px 2px;
          font-size: 10px;
          flex-shrink: 0;
        }

        .drum-circle-stat { font-weight: 700; letter-spacing: 0.3px; }
        .drum-circle-stat.perfect { color: #facc15; text-shadow: 0 0 6px rgba(250,204,21,0.4); }
        .drum-circle-stat.good { color: #22c55e; text-shadow: 0 0 6px rgba(34,197,94,0.4); }
        .drum-circle-stat.miss { color: #ef4444; text-shadow: 0 0 6px rgba(239,68,68,0.4); }

        .drum-circle-stage {
          position: relative;
          flex: 1;
          margin: 0 6px;
          background: linear-gradient(180deg, #0f0f23 0%, #1a1a2e 50%, #0f0f23 100%);
          border-radius: 10px;
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
          transition: background 0.12s;
        }

        .drum-circle-lane.flash {
          background: rgba(255, 255, 255, 0.1);
        }

        .drum-circle-lane.held {
          background: rgba(255, 255, 255, 0.06);
        }

        .drum-circle-note {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          width: 40px;
          height: 16px;
          border-radius: 8px;
          box-shadow: 0 0 12px currentColor;
        }

        .drum-circle-note.golden {
          box-shadow: 0 0 14px #fbbf24, 0 0 6px #fbbf24;
          animation: dc-golden-pulse 0.5s ease-in-out infinite alternate;
        }

        .drum-circle-note.hold-note {
          border-radius: 4px;
          border: 2px solid rgba(255,255,255,0.4);
        }

        @keyframes dc-golden-pulse {
          from { filter: brightness(1); }
          to { filter: brightness(1.5); }
        }

        .drum-circle-hit-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 4px;
          background: linear-gradient(90deg, rgba(234,88,12,0.6), rgba(255,255,255,0.4), rgba(234,88,12,0.6));
          pointer-events: none;
          box-shadow: 0 0 10px rgba(234,88,12,0.4);
        }

        .drum-circle-judgment {
          position: absolute;
          top: 70%;
          left: 50%;
          transform: translateX(-50%);
          font-size: 12px;
          font-weight: 800;
          pointer-events: none;
          animation: drum-circle-judgment-pop 0.4s ease-out forwards;
        }

        .drum-circle-judgment.perfect { color: #facc15; text-shadow: 0 0 10px rgba(250,204,21,0.7); }
        .drum-circle-judgment.good { color: #22c55e; text-shadow: 0 0 10px rgba(34,197,94,0.7); }
        .drum-circle-judgment.miss { color: #ef4444; text-shadow: 0 0 10px rgba(239,68,68,0.7); }

        @keyframes drum-circle-judgment-pop {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.4); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-24px) scale(0.7); }
        }

        .drum-circle-pad-row {
          display: flex;
          gap: 6px;
          padding: 8px 6px;
          flex-shrink: 0;
        }

        .drum-circle-pad {
          flex: 1;
          padding: 18px 0;
          border-radius: 14px;
          border: 2px solid;
          color: #fff;
          font-size: 20px;
          font-weight: 900;
          cursor: pointer;
          transition: transform 0.06s, box-shadow 0.08s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          box-shadow: 0 4px 14px rgba(0,0,0,0.4);
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .drum-circle-pad:active,
        .drum-circle-pad.active {
          transform: scale(0.9);
          filter: brightness(1.3);
          box-shadow: 0 0 20px currentColor;
        }

        .drum-circle-pad-label {
          display: block;
          font-size: 9px;
          opacity: 0.6;
          margin-top: 2px;
        }

        .dc-beat-pulse {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 3px;
          pointer-events: none;
          opacity: 0.5;
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
          <span className="dc-bpm-badge">BPM {Math.round(currentBpm)} Lv.{bpmLevel}</span>
        </div>
      </div>

      <div className="drum-circle-status-bar">
        <p>
          COMBO <strong>{combo}</strong>
          {comboLabel && (
            <span style={{ color: comboColor, marginLeft: 4, fontSize: 10, fontWeight: 700 }}>{comboLabel}</span>
          )}
        </p>
        <p>MAX <strong>{maxCombo}</strong></p>
        {isFever && <span className="dc-fever-badge">FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</span>}
      </div>

      <div className="drum-circle-stats-row">
        <span className="drum-circle-stat perfect">Perfect {perfectCount}</span>
        <span className="drum-circle-stat good">Good {goodCount}</span>
        <span className="drum-circle-stat miss">Miss {missCount}</span>
      </div>

      <div className={`drum-circle-stage ${isFever ? 'fever-active' : ''}`}>
        <div className="drum-circle-lanes">
          {Array.from({ length: LANE_COUNT }, (_, laneIndex) => (
            <div
              className={`drum-circle-lane ${laneFlash[laneIndex] !== null ? 'flash' : ''} ${heldLanes[laneIndex] ? 'held' : ''}`}
              key={`lane-${laneIndex}`}
              style={{ borderColor: LANE_COLORS[laneIndex] }}
            >
              {notes
                .filter((n) => n.lane === laneIndex && n.alive)
                .map((note) => {
                  const yPos = noteYPosition(elapsedMs, note.targetTimeMs)
                  if (yPos < NOTE_SPAWN_Y || yPos > 1.05) return null

                  return (
                    <div
                      className={`drum-circle-note ${note.isGolden ? 'golden' : ''} ${note.isHold ? 'hold-note' : ''}`}
                      key={note.id}
                      style={{
                        top: `${yPos * 100}%`,
                        backgroundColor: note.isGolden ? '#fbbf24' : LANE_COLORS[laneIndex],
                        height: note.isHold ? 24 : undefined,
                        width: note.isHold ? 44 : undefined,
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

              <div className="dc-beat-pulse" style={{ background: LANE_COLORS[laneIndex] }} />
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
            onPointerUp={() => handleLaneRelease(laneIndex)}
            onPointerLeave={() => handleLaneRelease(laneIndex)}
          >
            {LANE_LABELS[laneIndex]}
            <span className="drum-circle-pad-label">{LANE_EMOJIS[laneIndex]}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export const drumCircleModule: MiniGameModule = {
  manifest: {
    id: 'drum-circle',
    title: 'Drum Circle',
    description: 'Hit drums to the beat! Rhythm game!',
    unlockCost: 55,
    baseReward: 17,
    scoreRewardMultiplier: 1.25,
    accentColor: '#ea580c',
  },
  Component: DrumCircleGame,
}
