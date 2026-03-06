import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import dcPerfectSfx from '../../../assets/sounds/drum-circle-perfect.mp3'
import dcGoodSfx from '../../../assets/sounds/drum-circle-good.mp3'
import dcMissSfx from '../../../assets/sounds/drum-circle-miss.mp3'
import dcFeverSfx from '../../../assets/sounds/drum-circle-fever.mp3'
import dcComboSfx from '../../../assets/sounds/drum-circle-combo.mp3'
import dcGoldenSfx from '../../../assets/sounds/drum-circle-golden.mp3'
import dcDrumrollSfx from '../../../assets/sounds/drum-circle-drumroll.mp3'
import dcSpeedRushSfx from '../../../assets/sounds/drum-circle-speedrush.mp3'
import drumCircleBgmLoop from '../../../assets/sounds/generated/drum-circle/drum-circle-bgm-loop.mp3'
import dsTimeWarnSfx from '../../../assets/sounds/dance-step-time-warning.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { getActiveBgmTrack, playBackgroundAudio as playSharedBgm, stopBackgroundAudio as stopSharedBgm } from '../../gui/sound-manager'
import {
  computeBpm,
  computeDifficultyLevel,
  computeJudgmentWindows,
  FEVER_COMBO_THRESHOLD,
  FEVER_DURATION_MS,
  FEVER_MULTIPLIER,
  GOLDEN_NOTE_MULTIPLIER,
  GOOD_SCORE,
  HIT_LINE_Y,
  HOLD_NOTE_BONUS,
  LANE_COUNT,
  LOW_TIME_THRESHOLD_MS,
  NOTE_SPAWN_Y,
  noteYPosition,
  PERFECT_SCORE,
  ROUND_DURATION_MS,
  schedulePattern,
  SPEED_RUSH_BPM_BOOST,
  SPEED_RUSH_CHANCE,
  SPEED_RUSH_DURATION_MS,
  SPEED_RUSH_ELAPSED_MS,
  type DrumCircleNote as Note,
  generatePattern,
} from './logic'

const FLASH_DURATION_MS = 200
const JUDGMENT_DISPLAY_MS = 400
const DRUMROLL_WINDOW_MS = 800
const DRUMROLL_MIN_TAPS = 4
const DRUMROLL_BONUS_PER_TAP = 2
const DRUM_CIRCLE_BGM_VOLUME = 0.24

const LANE_COLORS = ['#ff2222', '#22ff44', '#2266ff', '#ffaa00'] as const
const LANE_LABELS = ['A', 'S', 'D', 'F'] as const

type JudgmentKind = 'perfect' | 'good' | 'miss'

interface JudgmentDisplay {
  readonly kind: JudgmentKind
  readonly lane: number
  readonly expiresAt: number
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
  const [currentBpm, setCurrentBpm] = useState(() => computeBpm(0, 0))
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
  const stageRef = useRef<HTMLDivElement | null>(null)

  const playAudio = useCallback((key: string, vol: number, rate = 1) => {
    const a = audioRefs.current[key]
    if (!a) return
    a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const ensureBgm = useCallback(() => {
    playSharedBgm(drumCircleBgmLoop, DRUM_CIRCLE_BGM_VOLUME)
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

  const getLaneEffectPosition = useCallback((lane: number) => {
    const stage = stageRef.current
    if (stage === null) {
      return { x: 52 + lane * 84, y: 380 }
    }

    const laneWidth = stage.clientWidth / LANE_COUNT
    return {
      x: stage.offsetLeft + laneWidth * (lane + 0.5),
      y: stage.offsetTop + stage.clientHeight * (HIT_LINE_Y - 0.05),
    }
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
      const { perfectMs, goodMs } = computeJudgmentWindows(currentElapsed)
      const activeNotes = notesRef.current.filter((n) => n.alive && !n.judged && n.lane === lane)
      const { x: laneX, y: laneY } = getLaneEffectPosition(lane)

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

      if (!closest || closestDiff > goodMs) {
        comboRef.current = 0; setCombo(0)
        missCountRef.current += 1; setMissCount(missCountRef.current)
        showJudgment('miss', lane); playAudio('miss', 0.35); effects.triggerShake(3)
        return
      }

      closest.judged = true; closest.alive = false

      if (closestDiff <= perfectMs) {
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
          playAudio('golden', 0.6); effects.triggerFlash('rgba(255,170,0,0.4)'); effects.spawnParticles(6, laneX, laneY)
        } else { playAudio('perfect', 0.55, 1.0 + nc * 0.005) }
        if (nc >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
          feverRef.current = true; feverRemainingMsRef.current = FEVER_DURATION_MS
          setIsFever(true); setFeverRemainingMs(FEVER_DURATION_MS)
          effects.triggerFlash('rgba(255,255,0,0.5)'); playAudio('fever', 0.6)
        }
        if (nc >= 10 && nc % 10 === 0 && nc > comboMilestoneRef.current) {
          comboMilestoneRef.current = nc; playAudio('combo', 0.5, 1 + (nc / 50) * 0.3)
        }
        effects.comboHitBurst(laneX, laneY, nc, earned)
      } else {
        const nc = comboRef.current + 1; comboRef.current = nc; setCombo(nc)
        if (nc > maxComboRef.current) { maxComboRef.current = nc; setMaxCombo(nc) }
        const gm = closest.isGolden ? GOLDEN_NOTE_MULTIPLIER : 1
        const fm = feverRef.current ? FEVER_MULTIPLIER : 1
        const earned = GOOD_SCORE * gm * fm
        scoreRef.current += earned; setScore(scoreRef.current)
        goodCountRef.current += 1; setGoodCount(goodCountRef.current)
        showJudgment('good', lane); playAudio('good', 0.45)
        effects.spawnParticles(3, laneX, laneY); effects.showScorePopup(earned, laneX, laneY - 28)
      }
    },
    [flashLane, getLaneEffectPosition, playAudio, showJudgment],
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
    ensureBgm()
    return () => {
      if (getActiveBgmTrack() === drumCircleBgmLoop) {
        stopSharedBgm()
      }
    }
  }, [ensureBgm])

  useEffect(() => {
    const srcs: Record<string, string> = {
      perfect: dcPerfectSfx, good: dcGoodSfx, miss: dcMissSfx,
      fever: dcFeverSfx, combo: dcComboSfx, golden: dcGoldenSfx,
      drumroll: dcDrumrollSfx, speedrush: dcSpeedRushSfx,
      timewarn: dsTimeWarnSfx, gameover: gameOverHitSfx,
    }
    for (const [k, s] of Object.entries(srcs)) { const a = new Audio(s); a.preload = 'auto'; audioRefs.current[k] = a }
    return () => {
      for (const audio of Object.values(audioRefs.current)) {
        audio?.pause()
        if (audio) audio.currentTime = 0
      }
      audioRefs.current = {}
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    nextPatternTimeRef.current = 0
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
      while (elapsed >= nextPatternTimeRef.current) {
        const patternElapsed = nextPatternTimeRef.current
        const patternBpm = computeBpm(patternElapsed, rushBoost)
        const pattern = generatePattern(patternBpm, patternElapsed)
        const scheduled = schedulePattern({
          pattern,
          bpm: patternBpm,
          elapsedMs: patternElapsed,
          spawnTimeMs: nextPatternTimeRef.current,
          nextNoteId: nextNoteIdRef.current,
        })
        notesRef.current = [...notesRef.current, ...scheduled.notes]
          .sort((left, right) => left.targetTimeMs - right.targetTimeMs || left.lane - right.lane)
        nextNoteIdRef.current = scheduled.nextNoteId
        nextPatternTimeRef.current = scheduled.nextPatternSpawnTimeMs
      }

      // Fever
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      // Miss expired
      const { goodMs } = computeJudgmentWindows(elapsed)
      const missW = goodMs + 80
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
  const difficultyLevel = computeDifficultyLevel(elapsedMs)
  const activeJudgments = useMemo(() => {
    const now = performance.now()
    return judgmentDisplays.filter((j) => j.expiresAt > now)
  }, [judgmentDisplays, notes])

  return (
    <section
      className={`mini-game-panel drum-circle-panel dc-panel ${isFever ? 'dc-fever' : ''} ${isSpeedRush ? 'dc-rush' : ''}`}
      aria-label="drum-circle-game"
      style={{
        width: '100%',
        maxWidth: '432px',
        height: '100%',
        minHeight: 0,
        margin: '0 auto',
        padding: 0,
        overflow: 'hidden',
        position: 'relative',
        ...effects.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        .dc-panel {
          --dc-accent: #ff7b27;
          --dc-accent-soft: #ffd278;
          --dc-panel-line: rgba(255, 123, 39, 0.2);
          display: flex; flex-direction: column; align-items: stretch; width: 100%; height: 100%;
          background:
            radial-gradient(circle at 50% -10%, rgba(255, 123, 39, 0.24), transparent 42%),
            linear-gradient(180deg, #180b08 0%, #090909 100%);
          font-family: 'Press Start 2P', monospace;
          user-select: none; -webkit-user-select: none;
          touch-action: manipulation;
          position: relative; overflow: hidden; image-rendering: pixelated;
          padding: 0 !important;
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
        .dc-hdr {
          display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px;
          padding: 18px 18px 14px; border-bottom: 3px solid var(--dc-panel-line); flex-shrink: 0;
          width: 100%; align-self: stretch;
          background: linear-gradient(180deg, rgba(26, 13, 9, 0.95), rgba(11, 11, 11, 0.92));
        }
        .dc-hdr-side { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
        .dc-hdr-side.right { align-items: flex-end; }
        .dc-hdr-caption { font-size: 11px; color: #d2a37c; margin: 0; }
        .dc-time { font-size: 30px; color: #f7f5ef; margin: 0; font-variant-numeric: tabular-nums; line-height: 1; }
        .dc-time.low { color: #ff3333; animation: dc-blink 0.5s steps(2) infinite; }
        @keyframes dc-blink { 50% { opacity: 0; } }
        .dc-score-wrap { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; min-width: 0; }
        .dc-score-label { margin: 0; font-size: 11px; color: #ffddb7; }
        .dc-score { font-size: 40px; color: #fff2c6; margin: 0; line-height: 1; text-shadow: 0 0 12px rgba(255, 123, 39, 0.32); }
        .dc-best { font-size: 11px; color: #ffb77a; margin: 0; }
        .dc-chip {
          display: inline-flex; align-items: center; justify-content: center;
          min-height: 38px; padding: 8px 12px; border: 2px solid rgba(255, 123, 39, 0.5);
          border-radius: 999px; color: #fff5e3; background: rgba(255, 123, 39, 0.12); font-size: 11px;
        }
        .dc-chip.level { color: #ffd278; }
        .dc-status {
          display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px;
          padding: 12px 10px; font-size: 12px; color: #e5d7c6; flex-shrink: 0; border-bottom: 2px solid #1c1c1c;
          width: 100%; align-self: stretch;
        }
        .dc-pill { margin: 0; padding: 9px 12px; border-radius: 999px; background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.08); }
        .dc-pill strong { color: #fff; }
        .dc-fever-tag { color: #ffcc00; animation: dc-blink 0.3s steps(2) infinite; }
        .dc-rush-tag { color: #ff6600; animation: dc-blink 0.25s steps(2) infinite; }
        .dc-drumroll-tag { color: #ffaa00; animation: dc-blink 0.2s steps(2) infinite; }
        .dc-stats {
          display: flex; justify-content: center; gap: 8px; padding: 0 10px 12px;
          font-size: 12px; flex-shrink: 0;
          width: 100%; align-self: stretch;
        }
        .dc-stat {
          min-width: 82px; text-align: center; padding: 10px 12px; border-radius: 16px;
          background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.08); font-weight: 700;
        }
        .dc-stat.p { color: #ffcc00; } .dc-stat.g { color: #22ff44; } .dc-stat.m { color: #ff6666; }
        .dc-stage {
          position: relative; flex: 1; margin: 0 4px;
          background:
            linear-gradient(180deg, rgba(255, 123, 39, 0.08), transparent 18%),
            repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 28px),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 24px), #0a0a0a;
          width: auto; align-self: stretch; border: 3px solid rgba(255, 123, 39, 0.22); border-radius: 18px; overflow: hidden; min-height: 0;
          box-shadow: inset 0 0 0 2px rgba(255,255,255,0.04), 0 0 24px rgba(255, 123, 39, 0.1);
        }
        .dc-lanes { display: flex; height: 100%; }
        .dc-lane { flex: 1; position: relative; border-right: 1px solid rgba(255,255,255,0.05); transition: none; }
        .dc-lane.flash { background: rgba(255,255,255,0.12); }
        .dc-note {
          position: absolute; left: 50%; transform: translateX(-50%);
          width: min(84px, calc(100% - 8px)); height: 24px; border-radius: 10px; border: 2px solid rgba(255,255,255,0.18);
          box-shadow: 0 0 16px rgba(0,0,0,0.3), 2px 3px 0 rgba(0,0,0,0.6);
        }
        .dc-note.golden { animation: dc-gold-fx 0.4s steps(2) infinite; box-shadow: 0 0 10px #ffaa00, 2px 3px 0 rgba(0,0,0,0.6); }
        .dc-note.hold { height: 42px; width: min(92px, calc(100% - 6px)); border: 2px solid rgba(255,255,255,0.5); }
        @keyframes dc-gold-fx { 50% { filter: brightness(1.8); } }
        .dc-hitline {
          position: absolute; left: 0; right: 0; height: 8px;
          background: linear-gradient(90deg, transparent, #ff6600 12%, #ffd278 50%, #ff6600 88%, transparent);
          pointer-events: none; box-shadow: 0 0 14px #ff6600;
        }
        .dc-jdg { position: absolute; top: 69%; left: 50%; transform: translateX(-50%); font-size: 16px; font-weight: 800; pointer-events: none; text-shadow: 2px 2px 0 rgba(0,0,0,0.65); animation: dc-jdg-pop 0.4s steps(4) forwards; }
        .dc-jdg.perfect { color: #ffcc00; } .dc-jdg.good { color: #22ff44; } .dc-jdg.miss { color: #ff2222; }
        @keyframes dc-jdg-pop { 0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.45); } 100% { opacity: 0; transform: translateX(-50%) translateY(-28px) scale(0.82); } }
        .dc-pads { display: flex; gap: 6px; width: 100%; align-self: stretch; padding: 12px 4px calc(18px + env(safe-area-inset-bottom, 0px)); flex-shrink: 0; }
        .dc-pad {
          flex: 1; min-height: 118px; padding: 18px 0 14px; border: 4px solid; border-radius: 20px;
          color: #fff; font-size: 32px; font-weight: 900; cursor: pointer; transition: none;
          -webkit-tap-highlight-color: transparent; touch-action: manipulation;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.5); font-family: 'Press Start 2P', monospace;
          background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)), #111;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 18px rgba(0,0,0,0.22);
        }
        .dc-pad:active, .dc-pad.active { filter: brightness(2); transform: scale(0.92); box-shadow: inset 0 0 0 2px rgba(255,255,255,0.3); }
        .dc-pad-sub { display: block; font-size: 12px; opacity: 0.55; margin-top: 10px; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="dc-hdr">
        <div className="dc-hdr-side">
          <p className="dc-hdr-caption">TIME</p>
          <p className={`dc-time ${isLowTime ? 'low' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
        </div>
        <div className="dc-score-wrap">
          <p className="dc-score-label">SCORE</p>
          <p className="dc-score">{score.toLocaleString()}</p>
          <p className="dc-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="dc-hdr-side right">
          <span className="dc-chip">BPM {Math.round(currentBpm)}</span>
          <span className="dc-chip level">LV {difficultyLevel}</span>
        </div>
      </div>

      <div className="dc-status">
        <p className="dc-pill">COMBO <strong>{combo}</strong>{comboLabel && <span style={{ color: comboColor, marginLeft: 6 }}>{comboLabel}</span>}</p>
        <p className="dc-pill">MAX <strong>{maxCombo}</strong></p>
        {isFever && <span className="dc-pill dc-fever-tag">FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</span>}
        {isSpeedRush && <span className="dc-pill dc-rush-tag">SPEED RUSH!</span>}
        {drumrollCount >= DRUMROLL_MIN_TAPS && <span className="dc-pill dc-drumroll-tag">ROLL x{drumrollCount}!</span>}
      </div>

      <div className="dc-stats">
        <span className="dc-stat p">P:{perfectCount}</span>
        <span className="dc-stat g">G:{goodCount}</span>
        <span className="dc-stat m">M:{missCount}</span>
      </div>

      <div className="dc-stage" ref={stageRef}>
        <div className="dc-lanes">
          {Array.from({ length: LANE_COUNT }, (_, li) => (
            <div className={`dc-lane ${laneFlash[li] !== null ? 'flash' : ''}`} key={`lane-${li}`}>
              {notes.filter((n) => n.lane === li && n.alive).map((note) => {
                const yPos = noteYPosition(elapsedMs, note.targetTimeMs, note.travelDurationMs)
                if (yPos < NOTE_SPAWN_Y - 0.02 || yPos > 1.05) return null
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
