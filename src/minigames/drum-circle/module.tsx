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
import dcDrumrollSfx from '../../../assets/sounds/drum-circle-drumroll.mp3'
import dcSpeedRushSfx from '../../../assets/sounds/drum-circle-speedrush.mp3'
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
const HOLD_NOTE_ELAPSED_MS = 12000
const HOLD_NOTE_CHANCE = 0.18
const HOLD_NOTE_BONUS = 5
const HIT_LINE_Y = 0.85
const NOTE_SPAWN_Y = -0.05
const INITIAL_BPM = 100
const MAX_BPM = 200
const BPM_INCREASE_PER_SECOND = 3.2
const NOTE_TRAVEL_DURATION_MS = 1800
const LOW_TIME_THRESHOLD_MS = 5000
const FLASH_DURATION_MS = 200
const JUDGMENT_DISPLAY_MS = 400
const SPEED_RUSH_ELAPSED_MS = 15000
const SPEED_RUSH_CHANCE = 0.02
const SPEED_RUSH_DURATION_MS = 4000
const SPEED_RUSH_BPM_BOOST = 40
const DRUMROLL_WINDOW_MS = 800
const DRUMROLL_MIN_TAPS = 4
const DRUMROLL_BONUS_PER_TAP = 2

const LANE_COLORS = ['#ff2222', '#22ff44', '#2266ff', '#ffaa00'] as const
const LANE_LABELS = ['A', 'S', 'D', 'F'] as const

interface Note {
  readonly id: number
  readonly lane: number
  readonly targetTimeMs: number
  readonly isGolden: boolean
  readonly isHold: boolean
  alive: boolean
  judged: boolean
}

type JudgmentKind = 'perfect' | 'good' | 'miss'

interface JudgmentDisplay {
  readonly kind: JudgmentKind
  readonly lane: number
  readonly expiresAt: number
}

function computeBpm(elapsedMs: number, rushBoost: number): number {
  return Math.min(MAX_BPM, INITIAL_BPM + (elapsedMs / 1000) * BPM_INCREASE_PER_SECOND + rushBoost)
}

function generatePattern(bpm: number, elapsedMs: number): number[] {
  const pattern: number[] = []
  for (let beat = 0; beat < 4; beat += 1) {
    const laneCount = beat === 0 || beat === 2 ? 1 : Math.random() < 0.3 ? 2 : 1
    const used = new Set<number>()
    for (let n = 0; n < laneCount; n += 1) {
      let lane: number
      do { lane = Math.floor(Math.random() * LANE_COUNT) } while (used.has(lane))
      used.add(lane)
      pattern.push(elapsedMs > HOLD_NOTE_ELAPSED_MS && Math.random() < HOLD_NOTE_CHANCE ? lane + 100 : lane)
    }
    if (beat < 3 && bpm > 130 && Math.random() < 0.25) pattern.push(Math.floor(Math.random() * LANE_COUNT) + LANE_COUNT)
  }
  return pattern
}

function noteYPosition(currentMs: number, targetMs: number): number {
  const progress = 1 - (targetMs - currentMs) / NOTE_TRAVEL_DURATION_MS
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
  const [isSpeedRush, setIsSpeedRush] = useState(false)
  const [drumrollCount, setDrumrollCount] = useState(0)

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
  const lowTimeSecondRef = useRef<number | null>(null)
  const speedRushRef = useRef(false)
  const speedRushRemainingRef = useRef(0)
  const recentTapsRef = useRef<number[]>([])
  const drumrollCountRef = useRef(0)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const playAudio = useCallback((key: string, vol: number, rate = 1) => {
    const a = audioRefs.current[key]
    if (!a) return
    a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const showJudgment = useCallback((kind: JudgmentKind, lane: number) => {
    const now = performance.now()
    setJudgmentDisplays((prev) => [...prev.filter((j) => j.expiresAt > now), { kind, lane, expiresAt: now + JUDGMENT_DISPLAY_MS }])
  }, [])

  const flashLane = useCallback((lane: number) => {
    setLaneFlash((prev) => { const n = [...prev]; n[lane] = performance.now(); return n })
    setTimeout(() => {
      setLaneFlash((prev) => { const n = [...prev]; if (n[lane] !== null && performance.now() - n[lane]! > FLASH_DURATION_MS * 0.8) n[lane] = null; return n })
    }, FLASH_DURATION_MS)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    playAudio('gameover', 0.6, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)) })
  }, [onFinish, playAudio])

  const handleLaneHit = useCallback(
    (lane: number) => {
      if (finishedRef.current) return
      flashLane(lane)

      const now = performance.now()
      recentTapsRef.current = [...recentTapsRef.current.filter((t) => now - t < DRUMROLL_WINDOW_MS), now]
      if (recentTapsRef.current.length >= DRUMROLL_MIN_TAPS) {
        const bonus = (recentTapsRef.current.length - DRUMROLL_MIN_TAPS + 1) * DRUMROLL_BONUS_PER_TAP
        scoreRef.current += bonus; setScore(scoreRef.current)
        drumrollCountRef.current = recentTapsRef.current.length; setDrumrollCount(drumrollCountRef.current)
        if (recentTapsRef.current.length === DRUMROLL_MIN_TAPS) {
          playAudio('drumroll', 0.5); effects.triggerFlash('rgba(255,170,0,0.3)')
        }
      } else { drumrollCountRef.current = 0; setDrumrollCount(0) }

      const currentElapsed = elapsedMsRef.current
      const activeNotes = notesRef.current.filter((n) => n.alive && !n.judged && n.lane === lane)

      if (activeNotes.length === 0) {
        comboRef.current = 0; setCombo(0)
        missCountRef.current += 1; setMissCount(missCountRef.current)
        showJudgment('miss', lane); playAudio('miss', 0.35)
        effects.triggerShake(4); effects.triggerFlash('rgba(255,0,0,0.25)')
        return
      }

      let closest: Note | null = null; let closestDiff = Infinity
      for (const note of activeNotes) {
        const diff = Math.abs(currentElapsed - note.targetTimeMs)
        if (diff < closestDiff) { closestDiff = diff; closest = note }
      }

      if (!closest || closestDiff > GOOD_WINDOW_MS) {
        comboRef.current = 0; setCombo(0)
        missCountRef.current += 1; setMissCount(missCountRef.current)
        showJudgment('miss', lane); playAudio('miss', 0.35); effects.triggerShake(3)
        return
      }

      closest.judged = true; closest.alive = false
      const laneX = 30 + lane * 95

      if (closestDiff <= PERFECT_WINDOW_MS) {
        const nc = comboRef.current + 1; comboRef.current = nc; setCombo(nc)
        if (nc > maxComboRef.current) { maxComboRef.current = nc; setMaxCombo(nc) }
        const cb = Math.floor(nc / 10)
        const gm = closest.isGolden ? GOLDEN_NOTE_MULTIPLIER : 1
        const fm = feverRef.current ? FEVER_MULTIPLIER : 1
        const hb = closest.isHold ? HOLD_NOTE_BONUS : 0
        const earned = (PERFECT_SCORE + cb + hb) * gm * fm
        scoreRef.current += earned; setScore(scoreRef.current)
        perfectCountRef.current += 1; setPerfectCount(perfectCountRef.current)
        showJudgment('perfect', lane)
        if (closest.isGolden) {
          playAudio('golden', 0.6); effects.triggerFlash('rgba(255,170,0,0.4)'); effects.spawnParticles(6, laneX, 300)
        } else { playAudio('perfect', 0.55, 1.0 + nc * 0.005) }
        if (nc >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
          feverRef.current = true; feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true); setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(255,255,0,0.5)'); playAudio('fever', 0.6)
        }
        if (nc >= 10 && nc % 10 === 0 && nc > comboMilestoneRef.current) {
          comboMilestoneRef.current = nc; playAudio('combo', 0.5, 1 + (nc / 50) * 0.3)
        }
        effects.comboHitBurst(laneX, 300, nc, earned)
      } else {
        const nc = comboRef.current + 1; comboRef.current = nc; setCombo(nc)
        if (nc > maxComboRef.current) { maxComboRef.current = nc; setMaxCombo(nc) }
        const gm = closest.isGolden ? GOLDEN_NOTE_MULTIPLIER : 1
        const fm = feverRef.current ? FEVER_MULTIPLIER : 1
        const earned = GOOD_SCORE * gm * fm
        scoreRef.current += earned; setScore(scoreRef.current)
        goodCountRef.current += 1; setGoodCount(goodCountRef.current)
        showJudgment('good', lane); playAudio('good', 0.45)
        effects.spawnParticles(3, laneX, 300); effects.showScorePopup(earned, laneX, 280)
      }
    },
    [flashLane, playAudio, showJudgment],
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (finishedRef.current) return
      const km: Record<string, number> = { KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, ArrowLeft: 0, ArrowDown: 1, ArrowUp: 2, ArrowRight: 3 }
      const lane = km[e.code]
      if (lane !== undefined) { e.preventDefault(); handleLaneHit(lane) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleLaneHit, onExit])

  useEffect(() => {
    const srcs: Record<string, string> = {
      perfect: dcPerfectSfx, good: dcGoodSfx, miss: dcMissSfx,
      fever: dcFeverSfx, combo: dcComboSfx, golden: dcGoldenSfx,
      drumroll: dcDrumrollSfx, speedrush: dcSpeedRushSfx,
      timewarn: dsTimeWarnSfx, gameover: gameOverHitSfx,
    }
    for (const [k, s] of Object.entries(srcs)) { const a = new Audio(s); a.preload = 'auto'; audioRefs.current[k] = a }
    return () => { audioRefs.current = {}; effects.cleanup() }
  }, [])

  useEffect(() => {
    nextPatternTimeRef.current = NOTE_TRAVEL_DURATION_MS
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)
      elapsedMsRef.current += deltaMs
      const elapsed = elapsedMsRef.current

      // Speed Rush
      if (!speedRushRef.current && elapsed > SPEED_RUSH_ELAPSED_MS && Math.random() < SPEED_RUSH_CHANCE) {
        speedRushRef.current = true; speedRushRemainingRef.current = SPEED_RUSH_DURATION_MS
        setIsSpeedRush(true); playAudio('speedrush', 0.5); effects.triggerFlash('rgba(255,100,0,0.4)')
      }
      if (speedRushRef.current) {
        speedRushRemainingRef.current = Math.max(0, speedRushRemainingRef.current - deltaMs)
        if (speedRushRemainingRef.current <= 0) { speedRushRef.current = false; setIsSpeedRush(false) }
      }

      const rushBoost = speedRushRef.current ? SPEED_RUSH_BPM_BOOST : 0
      const bpm = computeBpm(elapsed, rushBoost)
      setCurrentBpm(bpm)

      // Low time
      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== sec) { lowTimeSecondRef.current = sec; playAudio('timewarn', 0.3, 1.2) }
      } else lowTimeSecondRef.current = null

      // Spawn
      if (elapsed >= nextPatternTimeRef.current) {
        const beatMs = 60000 / bpm
        const pattern = generatePattern(bpm, elapsed)
        const start = nextPatternTimeRef.current
        let bi = 0
        for (const entry of pattern) {
          const isHold = entry >= 100; const isOff = !isHold && entry >= LANE_COUNT
          const lane = isHold ? entry - 100 : isOff ? entry - LANE_COUNT : entry
          const offset = isOff ? bi * beatMs - beatMs * 0.5 : bi * beatMs
          notesRef.current.push({
            id: nextNoteIdRef.current++, lane, targetTimeMs: start + offset,
            isGolden: !isHold && Math.random() < GOLDEN_NOTE_CHANCE, isHold,
            alive: true, judged: false,
          })
          if (!isOff && !isHold) bi += 1
        }
        nextPatternTimeRef.current = start + 4 * beatMs
      }

      // Fever
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      // Miss expired
      const missW = GOOD_WINDOW_MS + 80
      for (const note of notesRef.current) {
        if (note.alive && !note.judged && elapsed > note.targetTimeMs + missW) {
          note.alive = false; note.judged = true
          comboRef.current = 0; setCombo(0)
          missCountRef.current += 1; setMissCount(missCountRef.current)
        }
      }
      notesRef.current = notesRef.current.filter((n) => n.alive || elapsed - n.targetTimeMs < 500)
      setNotes([...notesRef.current])
      effects.updateParticles()
      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => { if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }; lastFrameAtRef.current = null }
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
  const bpmLevel = currentBpm < 120 ? 1 : currentBpm < 150 ? 2 : currentBpm < 180 ? 3 : 4

  return (
    <section className={`mini-game-panel dc-panel ${isFever ? 'dc-fever' : ''} ${isSpeedRush ? 'dc-rush' : ''}`} aria-label="drum-circle-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        .dc-panel {
          display: flex; flex-direction: column; height: 100%;
          background: #0a0a0a;
          font-family: 'Press Start 2P', monospace;
          user-select: none; -webkit-user-select: none;
          touch-action: manipulation;
          position: relative; overflow: hidden; image-rendering: pixelated;
        }
        .dc-panel::before {
          content: ''; position: absolute; inset: 0; z-index: 50; pointer-events: none;
          background: repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 3px);
          mix-blend-mode: multiply;
        }
        .dc-panel.dc-fever { animation: dc-fever-fx 0.4s steps(2) infinite; }
        .dc-panel.dc-rush { border: 3px solid #ff6600; animation: dc-rush-fx 0.3s steps(2) infinite; }
        @keyframes dc-fever-fx { 0% { background: #1a0a00; } 50% { background: #0a0a0a; } }
        @keyframes dc-rush-fx { 0% { border-color: #ff6600; } 50% { border-color: #ff0000; } }
        .dc-hdr { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; border-bottom: 3px solid #333; flex-shrink: 0; background: #111; }
        .dc-hdr-left { display: flex; align-items: center; gap: 6px; }
        .dc-avatar { width: 32px; height: 32px; border: 2px solid #ff6600; image-rendering: pixelated; object-fit: cover; }
        .dc-score { font-size: 16px; color: #ff6600; margin: 0; line-height: 1.2; }
        .dc-best { font-size: 6px; color: #886644; margin: 0; }
        .dc-hdr-right { text-align: right; }
        .dc-time { font-size: 14px; color: #eee; margin: 0; font-variant-numeric: tabular-nums; }
        .dc-time.low { color: #ff3333; animation: dc-blink 0.5s steps(2) infinite; }
        @keyframes dc-blink { 50% { opacity: 0; } }
        .dc-bpm { font-size: 7px; color: #ff6600; padding: 1px 4px; border: 1px solid #ff6600; margin-top: 2px; display: inline-block; }
        .dc-status { display: flex; justify-content: center; align-items: center; gap: 8px; padding: 3px 8px; font-size: 7px; color: #aaa; flex-shrink: 0; border-bottom: 2px solid #222; }
        .dc-status p { margin: 0; } .dc-status strong { color: #fff; }
        .dc-fever-tag { color: #ffcc00; animation: dc-blink 0.3s steps(2) infinite; }
        .dc-rush-tag { color: #ff6600; animation: dc-blink 0.25s steps(2) infinite; font-size: 7px; }
        .dc-drumroll-tag { color: #ffaa00; font-size: 7px; animation: dc-blink 0.2s steps(2) infinite; }
        .dc-stats { display: flex; justify-content: center; gap: 10px; padding: 0 8px 2px; font-size: 7px; flex-shrink: 0; }
        .dc-stat { font-weight: 700; } .dc-stat.p { color: #ffcc00; } .dc-stat.g { color: #22ff44; } .dc-stat.m { color: #ff2222; }
        .dc-stage {
          position: relative; flex: 1; margin: 0 4px;
          background: repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 25%), repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 20px), #0a0a0a;
          border: 3px solid #333; overflow: hidden; min-height: 0;
        }
        .dc-lanes { display: flex; height: 100%; }
        .dc-lane { flex: 1; position: relative; border-right: 2px solid rgba(255,255,255,0.04); transition: none; }
        .dc-lane.flash { background: rgba(255,255,255,0.12); }
        .dc-note { position: absolute; left: 50%; transform: translateX(-50%); width: 36px; height: 12px; box-shadow: 2px 2px 0 rgba(0,0,0,0.6); }
        .dc-note.golden { animation: dc-gold-fx 0.4s steps(2) infinite; box-shadow: 0 0 6px #ffaa00, 2px 2px 0 rgba(0,0,0,0.6); }
        .dc-note.hold { height: 20px; width: 40px; border: 2px solid rgba(255,255,255,0.5); }
        @keyframes dc-gold-fx { 50% { filter: brightness(1.8); } }
        .dc-hitline { position: absolute; left: 0; right: 0; height: 4px; background: #ff6600; pointer-events: none; box-shadow: 0 0 8px #ff6600; }
        .dc-jdg { position: absolute; top: 70%; left: 50%; transform: translateX(-50%); font-size: 8px; font-weight: 800; pointer-events: none; animation: dc-jdg-pop 0.4s steps(4) forwards; }
        .dc-jdg.perfect { color: #ffcc00; } .dc-jdg.good { color: #22ff44; } .dc-jdg.miss { color: #ff2222; }
        @keyframes dc-jdg-pop { 0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.5); } 100% { opacity: 0; transform: translateX(-50%) translateY(-20px) scale(0.8); } }
        .dc-pads { display: flex; gap: 4px; padding: 6px 4px; flex-shrink: 0; }
        .dc-pad { flex: 1; padding: 14px 0; border: 3px solid; color: #fff; font-size: 16px; font-weight: 900; cursor: pointer; transition: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; text-shadow: 2px 2px 0 rgba(0,0,0,0.5); font-family: 'Press Start 2P', monospace; background: #111; }
        .dc-pad:active, .dc-pad.active { filter: brightness(2); transform: scale(0.92); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.3); }
        .dc-pad-sub { display: block; font-size: 6px; opacity: 0.5; margin-top: 2px; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="dc-hdr">
        <div className="dc-hdr-left">
          <img className="dc-avatar" src={characterImage} alt="" />
          <div>
            <p className="dc-score">{score.toLocaleString()}</p>
            <p className="dc-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="dc-hdr-right">
          <p className={`dc-time ${isLowTime ? 'low' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <span className="dc-bpm">BPM{Math.round(currentBpm)} LV.{bpmLevel}</span>
        </div>
      </div>

      <div className="dc-status">
        <p>COMBO <strong>{combo}</strong>{comboLabel && <span style={{ color: comboColor, marginLeft: 4 }}>{comboLabel}</span>}</p>
        <p>MAX <strong>{maxCombo}</strong></p>
        {isFever && <span className="dc-fever-tag">FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</span>}
        {isSpeedRush && <span className="dc-rush-tag">SPEED RUSH!</span>}
        {drumrollCount >= DRUMROLL_MIN_TAPS && <span className="dc-drumroll-tag">ROLL x{drumrollCount}!</span>}
      </div>

      <div className="dc-stats">
        <span className="dc-stat p">P:{perfectCount}</span>
        <span className="dc-stat g">G:{goodCount}</span>
        <span className="dc-stat m">M:{missCount}</span>
      </div>

      <div className="dc-stage">
        <div className="dc-lanes">
          {Array.from({ length: LANE_COUNT }, (_, li) => (
            <div className={`dc-lane ${laneFlash[li] !== null ? 'flash' : ''}`} key={`lane-${li}`}>
              {notes.filter((n) => n.lane === li && n.alive).map((note) => {
                const yPos = noteYPosition(elapsedMs, note.targetTimeMs)
                if (yPos < NOTE_SPAWN_Y || yPos > 1.05) return null
                return (
                  <div className={`dc-note ${note.isGolden ? 'golden' : ''} ${note.isHold ? 'hold' : ''}`} key={note.id}
                    style={{ top: `${yPos * 100}%`, backgroundColor: note.isGolden ? '#ffaa00' : LANE_COLORS[li] }}
                  />
                )
              })}
              {activeJudgments.filter((j) => j.lane === li).map((j, i) => (
                <div className={`dc-jdg ${j.kind}`} key={`j-${li}-${i}`}>
                  {j.kind === 'perfect' ? 'PERFECT' : j.kind === 'good' ? 'GOOD' : 'MISS'}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="dc-hitline" style={{ top: `${HIT_LINE_Y * 100}%` }} />
      </div>

      <div className="dc-pads">
        {Array.from({ length: LANE_COUNT }, (_, li) => (
          <button className={`dc-pad ${laneFlash[li] !== null ? 'active' : ''}`} key={`pad-${li}`} type="button"
            style={{ borderColor: LANE_COLORS[li], color: LANE_COLORS[li] }}
            onPointerDown={(e) => { e.preventDefault(); handleLaneHit(li) }}
          >
            {LANE_LABELS[li]}
            <span className="dc-pad-sub">TAP</span>
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
    accentColor: '#ff6600',
  },
  Component: DrumCircleGame,
}
