import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import perfectSfx from '../../../assets/sounds/beat-catch-perfect.mp3'
import goodSfx from '../../../assets/sounds/beat-catch-good.mp3'
import missSfx from '../../../assets/sounds/beat-catch-miss.mp3'
import comboSfx from '../../../assets/sounds/beat-catch-combo.mp3'
import feverSfx from '../../../assets/sounds/beat-catch-fever.mp3'
import goldenSfx from '../../../assets/sounds/beat-catch-golden.mp3'
import levelupSfx from '../../../assets/sounds/beat-catch-levelup.mp3'
import doubleSfx from '../../../assets/sounds/beat-catch-double.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import noteNormalImg from '../../../assets/images/beat-catch/note-normal.png'
import noteGoldenImg from '../../../assets/images/beat-catch/note-golden.png'
import noteDoubleImg from '../../../assets/images/beat-catch/note-double.png'
import noteHoldImg from '../../../assets/images/beat-catch/note-hold.png'
import {
  BEAT_CATCH_FEVER_COMBO as FEVER_COMBO,
  BEAT_CATCH_FEVER_DURATION_MS as FEVER_DURATION_MS,
  BEAT_CATCH_FEVER_MULTIPLIER as FEVER_MULTIPLIER,
  BEAT_CATCH_GOOD_SCORE as GOOD_SCORE,
  BEAT_CATCH_GOLDEN_MULTIPLIER as GOLDEN_MULTIPLIER,
  BEAT_CATCH_HIT_LINE_Y as HIT_LINE_Y,
  BEAT_CATCH_MAX_LIVES as MAX_LIVES,
  BEAT_CATCH_MISS_ZONE as MISS_ZONE,
  BEAT_CATCH_PERFECT_SCORE as PERFECT_SCORE,
  getBeatCatchDifficulty,
  getBeatCatchLevel,
  loseBeatCatchLife,
} from './logic'

// ─── Game Constants ─────────────────────────────────────────────────
const LANE_COUNT = 3

type NoteType = 'normal' | 'golden' | 'double' | 'hold'
type JudgeKind = 'perfect' | 'good' | 'miss'

const LANE_COLORS = ['#f43f5e', '#8b5cf6', '#3b82f6'] as const
const LANE_LABELS = ['LEFT', 'MID', 'RIGHT'] as const
const LANE_KEYS = [['KeyA', 'ArrowLeft', 'Digit1'], ['KeyS', 'ArrowDown', 'Space', 'Digit2'], ['KeyD', 'ArrowRight', 'Digit3']] as const

const NOTE_IMAGES: Record<NoteType, string> = {
  normal: noteNormalImg,
  golden: noteGoldenImg,
  double: noteDoubleImg,
  hold: noteHoldImg,
}

interface Note {
  id: number
  lane: number
  y: number
  type: NoteType
  holdDuration?: number
  holdProgress?: number
  hit: boolean
  missed: boolean
}

interface HitEffect {
  id: number
  lane: number
  kind: JudgeKind
  createdAt: number
}

interface LaneFlash {
  lane: number
  createdAt: number
}

let noteIdCounter = 0

function BeatCatchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [notes, setNotes] = useState<Note[]>([])
  const [hitEffects, setHitEffects] = useState<HitEffect[]>([])
  const [laneFlashes, setLaneFlashes] = useState<LaneFlash[]>([])
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [level, setLevel] = useState(1)
  const [lastJudge, setLastJudge] = useState<JudgeKind | null>(null)
  const [lives, setLives] = useState(MAX_LIVES)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const notesRef = useRef<Note[]>([])
  const hitEffectsRef = useRef<HitEffect[]>([])
  const laneFlashesRef = useRef<LaneFlash[]>([])
  const finishedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const spawnTimerRef = useRef(0)
  const feverRef = useRef(false)
  const feverMsRef = useRef(0)
  const catchCountRef = useRef(0)
  const levelRef = useRef(1)
  const elapsedRef = useRef(0)
  const livesRef = useRef(MAX_LIVES)
  const holdingLanesRef = useRef<Set<number>>(new Set())
  const judgeTimerRef = useRef<number | null>(null)
  const gameAreaRef = useRef<HTMLDivElement | null>(null)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const playAudio = useCallback((name: string, volume = 0.6, rate = 1) => {
    const audio = audioRefs.current[name]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const clearFever = useCallback(() => {
    if (!feverRef.current) return

    feverRef.current = false
    feverMsRef.current = 0
    setIsFever(false)
    setFeverRemainingMs(0)
  }, [])

  const breakCombo = useCallback(() => {
    comboRef.current = 0
    setCombo(0)
    clearFever()
  }, [clearFever])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return

    finishedRef.current = true
    playAudio('gameover', 0.62)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, elapsedRef.current)),
    })
  }, [onFinish, playAudio])

  const spawnNote = useCallback(() => {
    const activeCount = notesRef.current.filter(n => !n.hit && !n.missed).length
    const difficulty = getBeatCatchDifficulty(elapsedRef.current)
    if (activeCount >= difficulty.maxActiveNotes) return

    const chances = difficulty.specialChances
    const lane = Math.floor(Math.random() * LANE_COUNT)

    let type: NoteType = 'normal'
    const roll = Math.random()
    if (roll < chances.hold) {
      type = 'hold'
    } else if (roll < chances.hold + chances.double) {
      type = 'double'
    } else if (roll < chances.hold + chances.double + chances.golden) {
      type = 'golden'
    }

    noteIdCounter += 1
    const note: Note = {
      id: noteIdCounter,
      lane,
      y: -0.05,
      type,
      holdDuration: type === 'hold' ? 600 + Math.random() * 400 : undefined,
      holdProgress: 0,
      hit: false,
      missed: false,
    }

    if (type === 'double') {
      const lane2 = (lane + 1 + Math.floor(Math.random() * 2)) % LANE_COUNT
      noteIdCounter += 1
      const note2: Note = { ...note, id: noteIdCounter, lane: lane2 }
      notesRef.current = [...notesRef.current, note, note2]
    } else {
      notesRef.current = [...notesRef.current, note]
    }

    // Multi-spawn: sometimes spawn extra notes
    if (Math.random() < chances.multiSpawn) {
      const extraLane = Math.floor(Math.random() * LANE_COUNT)
      if (notesRef.current.filter(n => !n.hit && !n.missed && n.lane === extraLane).length === 0) {
        noteIdCounter += 1
        const extraNote: Note = {
          id: noteIdCounter,
          lane: extraLane,
          y: -0.08 - Math.random() * 0.05,
          type: 'normal',
          hit: false,
          missed: false,
          holdProgress: 0,
        }
        notesRef.current = [...notesRef.current, extraNote]
      }
    }
  }, [])

  const addHitEffect = useCallback((lane: number, kind: JudgeKind) => {
    noteIdCounter += 1
    const eff: HitEffect = { id: noteIdCounter, lane, kind, createdAt: performance.now() }
    hitEffectsRef.current = [...hitEffectsRef.current, eff].slice(-12)
    setHitEffects([...hitEffectsRef.current])
  }, [])

  const addLaneFlash = useCallback((lane: number) => {
    const flash: LaneFlash = { lane, createdAt: performance.now() }
    laneFlashesRef.current = [...laneFlashesRef.current, flash].slice(-6)
    setLaneFlashes([...laneFlashesRef.current])
  }, [])

  const registerMiss = useCallback((lane: number, deductLife: boolean) => {
    if (finishedRef.current) return

    breakCombo()
    setLastJudge('miss')
    addHitEffect(lane, 'miss')
    playAudio('miss', deductLife ? 0.5 : 0.38, deductLife ? 0.72 : 0.86)
    effects.triggerShake(deductLife ? 8 : 4)
    effects.triggerFlash('rgba(239,68,68,0.34)')

    if (deductLife) {
      const nextLives = loseBeatCatchLife(livesRef.current)
      livesRef.current = nextLives
      setLives(nextLives)

      if (nextLives <= 0) {
        finishGame()
      }
    }

    if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current)
    judgeTimerRef.current = window.setTimeout(() => { setLastJudge(null) }, 400)
  }, [addHitEffect, breakCombo, effects, finishGame, playAudio])

  const handleLaneHit = useCallback((lane: number) => {
    if (finishedRef.current) return

    const perfectZone = getCurrentPerfectZone()
    const goodZone = getCurrentGoodZone()

    const candidates = notesRef.current
      .filter((n) => n.lane === lane && !n.hit && !n.missed)
      .map((n) => ({ note: n, dist: Math.abs(n.y - HIT_LINE_Y) }))
      .filter((c) => c.dist <= MISS_ZONE)
      .sort((a, b) => a.dist - b.dist)

    if (candidates.length === 0) {
      comboRef.current = 0
      setCombo(0)
      missCountRef.current += 1
      setMissCount(missCountRef.current)
      setLastJudge('miss')
      addHitEffect(lane, 'miss')
      playAudio('miss', 0.4, 0.8)
      effects.triggerShake(4)
      effects.triggerFlash('rgba(239,68,68,0.3)')

      if (feverRef.current) {
        feverRef.current = false
        feverMsRef.current = 0
        setIsFever(false)
        setFeverRemainingMs(0)
      }

      if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current)
      judgeTimerRef.current = window.setTimeout(() => { setLastJudge(null) }, 400)
      return
    }

    const { note, dist } = candidates[0]

    if (note.type === 'hold' && !holdingLanesRef.current.has(lane)) {
      holdingLanesRef.current.add(lane)
    }

    note.hit = true
    const kind: JudgeKind = dist <= perfectZone ? 'perfect' : dist <= goodZone ? 'good' : 'good'

    const nextCombo = comboRef.current + 1
    comboRef.current = nextCombo
    setCombo(nextCombo)
    if (nextCombo > maxComboRef.current) {
      maxComboRef.current = nextCombo
      setMaxCombo(nextCombo)
    }

    const baseScore = kind === 'perfect' ? PERFECT_SCORE : GOOD_SCORE
    const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
    const goldenMult = note.type === 'golden' ? GOLDEN_MULTIPLIER : 1
    const earned = baseScore * nextCombo * feverMult * goldenMult
    scoreRef.current += earned
    setScore(scoreRef.current)

    catchCountRef.current += 1
    setCatchCount(catchCountRef.current)

    if (kind === 'perfect') {
      perfectCountRef.current += 1
      setPerfectCount(perfectCountRef.current)
    } else {
      goodCountRef.current += 1
      setGoodCount(goodCountRef.current)
    }

    // Level up
    const newLevel = Math.floor(catchCountRef.current / CATCHES_PER_LEVEL) + 1
    if (newLevel > levelRef.current) {
      levelRef.current = newLevel
      setLevel(newLevel)
      playAudio('levelup', 0.6)
      effects.triggerFlash('rgba(59,130,246,0.4)')
    }

    // Fever
    if (nextCombo >= FEVER_COMBO && !feverRef.current) {
      feverRef.current = true
      feverMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverRemainingMs(FEVER_DURATION_MS)
      playAudio('fever', 0.7)
      effects.triggerFlash('rgba(250,204,21,0.5)')
    }

    // Sound
    if (note.type === 'golden') {
      playAudio('golden', 0.7)
    } else if (note.type === 'double') {
      playAudio('double', 0.6)
    } else if (nextCombo > 0 && nextCombo % 5 === 0) {
      playAudio('combo', 0.7, 1.0 + Math.min(nextCombo * 0.02, 0.4))
    } else {
      playAudio(kind === 'perfect' ? 'perfect' : 'good', 0.6, 1.0 + Math.min(nextCombo * 0.02, 0.3))
    }

    addHitEffect(lane, kind)
    addLaneFlash(lane)
    setLastJudge(kind)

    const areaRect = gameAreaRef.current?.getBoundingClientRect()
    if (areaRect) {
      const laneWidth = areaRect.width / LANE_COUNT
      const px = lane * laneWidth + laneWidth / 2
      const py = areaRect.height * HIT_LINE_Y
      if (kind === 'perfect') {
        effects.comboHitBurst(px, py, nextCombo, earned, ['\u25C6', '\u2605', '\u2726', '\u2737', '\u2738'])
      } else {
        effects.spawnParticles(3, px, py)
        effects.showScorePopup(earned, px, py - 20)
        effects.triggerFlash('rgba(34,197,94,0.25)')
      }
    }

    if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current)
    judgeTimerRef.current = window.setTimeout(() => { setLastJudge(null) }, 350)

    setNotes([...notesRef.current])
  }, [playAudio, addHitEffect, addLaneFlash, effects, getCurrentPerfectZone, getCurrentGoodZone])

  const handleLaneRelease = useCallback((lane: number) => {
    holdingLanesRef.current.delete(lane)
  }, [])

  // Audio setup
  useEffect(() => {
    const sources: Record<string, string> = {
      perfect: perfectSfx,
      good: goodSfx,
      miss: missSfx,
      combo: comboSfx,
      fever: feverSfx,
      golden: goldenSfx,
      levelup: levelupSfx,
      double: doubleSfx,
      gameover: gameOverHitSfx,
    }
    Object.entries(sources).forEach(([name, src]) => {
      const a = new Audio(src)
      a.preload = 'auto'
      audioRefs.current[name] = a
    })
    return () => {
      Object.keys(sources).forEach((name) => { audioRefs.current[name] = null })
      if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current)
      effects.cleanup()
    }
  }, [])

  // Key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        if ((LANE_KEYS[lane] as readonly string[]).includes(e.code)) {
          e.preventDefault()
          handleLaneHit(lane)
          return
        }
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        if ((LANE_KEYS[lane] as readonly string[]).includes(e.code)) {
          handleLaneRelease(lane)
          return
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [handleLaneHit, handleLaneRelease, onExit])

  // Game loop
  useEffect(() => {
    lastFrameRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const deltaMs = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now
      elapsedRef.current += deltaMs

      // Timer
      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)
      if (remainingMsRef.current <= 0) {
        playAudio('gameover', 0.6)
        finishedRef.current = true
        const elapsed = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
        onFinish({ score: scoreRef.current, durationMs: elapsed })
        rafRef.current = null
        return
      }

      // Update danger level for visual feedback (0-100)
      const t = elapsedRef.current / 1000
      setDangerLevel(Math.min(100, Math.floor(t / ROUND_DURATION_MS * 1000 * 2.5)))

      // Fever countdown
      if (feverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverRemainingMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Spawn notes
      spawnTimerRef.current += deltaMs
      const spawnInterval = getCurrentSpawnInterval()
      if (spawnTimerRef.current >= spawnInterval) {
        spawnTimerRef.current -= spawnInterval
        spawnNote()
      }

      // Move notes
      const fallSpeed = getCurrentFallSpeed()
      const deltaSec = deltaMs / 1000

      for (const note of notesRef.current) {
        if (note.hit || note.missed) continue
        note.y += fallSpeed * deltaSec

        if (note.y > HIT_LINE_Y + MISS_ZONE && !note.hit) {
          note.missed = true
          comboRef.current = 0
          setCombo(0)
          missCountRef.current += 1
          setMissCount(missCountRef.current)

          if (feverRef.current) {
            feverRef.current = false
            feverMsRef.current = 0
            setIsFever(false)
            setFeverRemainingMs(0)
          }
        }
      }

      notesRef.current = notesRef.current.filter((n) => n.y < 1.2)

      const nowPerf = performance.now()
      hitEffectsRef.current = hitEffectsRef.current.filter((e) => nowPerf - e.createdAt < 400)
      laneFlashesRef.current = laneFlashesRef.current.filter((f) => nowPerf - f.createdAt < 200)

      setNotes([...notesRef.current])
      setHitEffects([...hitEffectsRef.current])
      setLaneFlashes([...laneFlashesRef.current])

      effects.updateParticles()
      rafRef.current = window.requestAnimationFrame(step)
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [onFinish, playAudio, spawnNote, getCurrentFallSpeed, getCurrentSpawnInterval])

  // Derived
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_MS
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const speedPct = Math.min(100, ((getCurrentFallSpeed() - INITIAL_FALL_SPEED) / (MAX_FALL_SPEED - INITIAL_FALL_SPEED)) * 100)

  return (
    <section
      className={`mini-game-panel bc-panel ${isFever ? 'bc-fever' : ''}`}
      aria-label="beat-catch-game"
      style={{ ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        /* ─── Pixel Art Font ─── */
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .bc-panel {
          display: flex;
          flex-direction: column;
          width: 100%;
          max-width: 432px;
          aspect-ratio: 6 / 19;
          margin: 0 auto;
          background: linear-gradient(180deg, #0a0a1a 0%, #0d0520 50%, #0a0a1a 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          position: relative;
          overflow: hidden;
          font-family: 'Press Start 2P', monospace;
          image-rendering: pixelated;
        }

        .bc-fever {
          animation: bc-fever-bg 0.5s ease-in-out infinite alternate;
        }

        @keyframes bc-fever-bg {
          from { background: linear-gradient(180deg, #1a1000 0%, #1a0800 50%, #1a1000 100%); }
          to { background: linear-gradient(180deg, #0a0a1a 0%, #0d0520 50%, #0a0a1a 100%); }
        }

        /* ─── Header ─── */
        .bc-hdr {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px 8px;
          background: rgba(0,0,0,0.6);
          border-bottom: 3px solid rgba(244,63,94,0.5);
          flex-shrink: 0;
          z-index: 5;
        }

        .bc-hdr-score {
          font-size: clamp(28px, 9vw, 48px);
          font-weight: 900;
          color: #fb7185;
          margin: 0;
          line-height: 1.1;
          text-shadow: 0 0 16px rgba(244,63,94,0.8), 0 3px 6px rgba(0,0,0,0.7),
                       2px 2px 0 #881337;
          font-family: 'Press Start 2P', monospace;
          letter-spacing: -1px;
        }

        .bc-hdr-best {
          font-size: 7px;
          color: rgba(253,164,175,0.6);
          margin: 3px 0 0;
          font-family: 'Press Start 2P', monospace;
        }

        .bc-hdr-time {
          font-size: clamp(20px, 7vw, 36px);
          font-weight: 800;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
          font-family: 'Press Start 2P', monospace;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.5);
        }

        .bc-hdr-time.low {
          color: #ef4444;
          animation: bc-blink 0.4s infinite alternate;
          text-shadow: 0 0 12px rgba(239,68,68,0.8), 2px 2px 0 #7f1d1d;
        }

        @keyframes bc-blink { from { opacity: 1; } to { opacity: 0.3; } }

        /* ─── Status Bar ─── */
        .bc-stat {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          padding: 4px 10px;
          font-size: 8px;
          color: #a1a1aa;
          flex-shrink: 0;
          z-index: 5;
          background: rgba(0,0,0,0.4);
          font-family: 'Press Start 2P', monospace;
          border-bottom: 2px solid rgba(255,255,255,0.05);
        }

        .bc-stat p { margin: 0; }

        .bc-combo-num {
          color: #facc15 !important;
          font-size: 11px;
          font-weight: 800;
        }

        .bc-fever-tag {
          color: #facc15;
          font-weight: 800;
          animation: bc-blink 0.3s infinite alternate;
          text-shadow: 0 0 8px rgba(250,204,21,0.7);
          font-size: 8px;
        }

        /* ─── Danger/Speed Bar ─── */
        .bc-speed-bar {
          height: 4px;
          background: rgba(255,255,255,0.05);
          flex-shrink: 0;
        }

        .bc-speed-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #f59e0b, #ef4444);
          transition: width 0.3s ease;
          image-rendering: pixelated;
        }

        /* ─── Difficulty Indicator ─── */
        .bc-diff-label {
          position: absolute;
          top: 6px;
          right: 6px;
          font-size: 6px;
          color: rgba(255,255,255,0.4);
          font-family: 'Press Start 2P', monospace;
          z-index: 6;
          pointer-events: none;
        }

        /* ─── Game Area ─── */
        .bc-game {
          flex: 1;
          position: relative;
          display: flex;
          min-height: 0;
          overflow: hidden;
        }

        .bc-lane {
          flex: 1;
          position: relative;
          border-right: 2px solid rgba(255,255,255,0.06);
        }

        .bc-lane:last-child { border-right: none; }

        .bc-lane-bg {
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.1s;
          pointer-events: none;
        }

        .bc-lane.flash .bc-lane-bg {
          opacity: 1;
          animation: bc-lane-flash 0.2s ease-out forwards;
        }

        @keyframes bc-lane-flash {
          0% { opacity: 0.4; }
          100% { opacity: 0; }
        }

        .bc-hit-line {
          position: absolute;
          left: 0;
          right: 0;
          top: ${HIT_LINE_Y * 100}%;
          height: 4px;
          background: repeating-linear-gradient(90deg,
            #f43f5e 0px, #f43f5e 4px,
            transparent 4px, transparent 6px,
            #8b5cf6 6px, #8b5cf6 10px,
            transparent 10px, transparent 12px,
            #3b82f6 12px, #3b82f6 16px,
            transparent 16px, transparent 18px
          );
          z-index: 3;
          box-shadow: 0 0 12px rgba(244,63,94,0.5), 0 0 24px rgba(139,92,246,0.3);
          image-rendering: pixelated;
        }

        .bc-hit-line::before,
        .bc-hit-line::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 20px;
          pointer-events: none;
        }

        .bc-hit-line::before {
          top: -20px;
          background: linear-gradient(180deg, transparent, rgba(255,255,255,0.03));
        }

        .bc-hit-line::after {
          bottom: -20px;
          background: linear-gradient(0deg, transparent, rgba(255,255,255,0.03));
        }

        /* ─── Pixel Art Notes ─── */
        .bc-note {
          position: absolute;
          width: 36px;
          height: 36px;
          transform: translate(-50%, -50%);
          z-index: 4;
          pointer-events: none;
          image-rendering: pixelated;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bc-note-normal {
          filter: drop-shadow(0 0 6px rgba(244,63,94,0.7));
        }

        .bc-note-golden {
          filter: drop-shadow(0 0 10px rgba(250,204,21,0.9));
          animation: bc-golden-pulse 0.3s steps(2) infinite alternate;
        }

        @keyframes bc-golden-pulse {
          from { filter: drop-shadow(0 0 10px rgba(250,204,21,0.9)); }
          to { filter: drop-shadow(0 0 18px rgba(250,204,21,1)) brightness(1.2); }
        }

        .bc-note-double {
          filter: drop-shadow(0 0 8px rgba(139,92,246,0.8));
        }

        .bc-note-hold {
          filter: drop-shadow(0 0 8px rgba(52,211,153,0.8));
          width: 32px;
          height: 48px;
        }

        .bc-note-hit {
          animation: bc-note-hit 0.25s steps(4) forwards;
        }

        @keyframes bc-note-hit {
          0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          50% { transform: translate(-50%, -50%) scale(1.6); opacity: 0.5; }
          100% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
        }

        .bc-note-miss {
          opacity: 0.25;
          filter: grayscale(1);
        }

        .bc-note-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
          image-rendering: pixelated;
          filter: drop-shadow(0 0 4px rgba(255,255,255,0.3));
        }

        /* ─── Hit effects ─── */
        .bc-hit-fx {
          position: absolute;
          top: ${HIT_LINE_Y * 100}%;
          transform: translate(-50%, -50%);
          z-index: 6;
          pointer-events: none;
          animation: bc-hit-ring 0.35s steps(6) forwards;
        }

        @keyframes bc-hit-ring {
          0% { width: 16px; height: 16px; opacity: 1; border-width: 4px; }
          100% { width: 64px; height: 64px; opacity: 0; border-width: 2px; }
        }

        .bc-hit-fx-perfect { border: 4px solid #facc15; border-radius: 2px; }
        .bc-hit-fx-good { border: 4px solid #22c55e; border-radius: 2px; }
        .bc-hit-fx-miss { border: 4px solid #ef4444; border-radius: 2px; }

        /* ─── Judgement popup ─── */
        .bc-judge {
          position: absolute;
          top: ${(HIT_LINE_Y - 0.12) * 100}%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: clamp(18px, 6vw, 28px);
          font-weight: 900;
          z-index: 8;
          pointer-events: none;
          animation: bc-judge-pop 0.35s steps(5) forwards;
          font-family: 'Press Start 2P', monospace;
        }

        .bc-judge-perfect {
          color: #facc15;
          text-shadow: 2px 2px 0 #92400e, 0 0 12px rgba(250,204,21,0.7);
        }
        .bc-judge-good {
          color: #22c55e;
          text-shadow: 2px 2px 0 #14532d, 0 0 8px rgba(34,197,94,0.5);
        }
        .bc-judge-miss {
          color: #ef4444;
          text-shadow: 2px 2px 0 #7f1d1d, 0 0 8px rgba(239,68,68,0.5);
        }

        @keyframes bc-judge-pop {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1.4); }
          100% { opacity: 0; transform: translate(-50%, -70%) scale(0.9); }
        }

        .bc-combo-display {
          position: absolute;
          top: ${(HIT_LINE_Y - 0.22) * 100}%;
          left: 50%;
          transform: translateX(-50%);
          font-size: clamp(14px, 5vw, 22px);
          font-weight: 900;
          color: #facc15;
          z-index: 7;
          pointer-events: none;
          text-shadow: 2px 2px 0 #92400e, 0 0 10px rgba(250,204,21,0.5);
          animation: bc-combo-in 0.2s steps(3);
          font-family: 'Press Start 2P', monospace;
        }

        @keyframes bc-combo-in {
          0% { transform: translateX(-50%) scale(0.5); opacity: 0; }
          60% { transform: translateX(-50%) scale(1.3); }
          100% { transform: translateX(-50%) scale(1); opacity: 1; }
        }

        /* ─── Lane Buttons (Pixel Art) ─── */
        .bc-btns {
          display: flex;
          flex-shrink: 0;
          z-index: 5;
        }

        .bc-lane-btn {
          flex: 1;
          padding: clamp(14px, 4vw, 22px) 0;
          border: none;
          font-size: clamp(10px, 3vw, 14px);
          font-weight: 900;
          letter-spacing: 1px;
          cursor: pointer;
          transition: transform 0.05s, filter 0.05s;
          color: #fff;
          font-family: 'Press Start 2P', monospace;
          text-shadow: 1px 1px 0 rgba(0,0,0,0.5);
          image-rendering: pixelated;
          border-top: 3px solid rgba(255,255,255,0.15);
        }

        .bc-lane-btn:nth-child(1) {
          background: #be123c;
          border-right: 2px solid rgba(0,0,0,0.3);
        }

        .bc-lane-btn:nth-child(2) {
          background: #6d28d9;
          border-right: 2px solid rgba(0,0,0,0.3);
        }

        .bc-lane-btn:nth-child(3) {
          background: #1d4ed8;
        }

        .bc-lane-btn:active {
          transform: scale(0.94);
          filter: brightness(1.4);
        }

        /* ─── Pixel Overlays ─── */
        .bc-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 2;
          background: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 2px,
            rgba(0,0,0,0.12) 2px,
            rgba(0,0,0,0.12) 3px
          );
          image-rendering: pixelated;
        }

        .bc-pixel-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
          background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 1px, transparent 1px, transparent 8px),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.01) 0px, rgba(255,255,255,0.01) 1px, transparent 1px, transparent 8px);
          image-rendering: pixelated;
        }

        .bc-lane-guides {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
        }

        .bc-lane-guide {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: rgba(255,255,255,0.04);
        }

        .bc-bottom-glow {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          height: 20%;
          background: linear-gradient(180deg, transparent, rgba(244,63,94,0.06));
          pointer-events: none;
          z-index: 1;
        }

        /* ─── Level Indicator ─── */
        .bc-level-badge {
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 7px;
          color: rgba(255,255,255,0.3);
          font-family: 'Press Start 2P', monospace;
          z-index: 6;
          pointer-events: none;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Header */}
      <div className="bc-hdr">
        <div>
          <p className="bc-hdr-score">{score.toLocaleString()}</p>
          <p className="bc-hdr-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`bc-hdr-time ${isLowTime ? 'low' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}
        </p>
      </div>

      {/* Status */}
      <div className="bc-stat">
        <p>
          COMBO <span className="bc-combo-num">{combo}</span>
          {comboLabel && <span className="ge-combo-label" style={{ color: comboColor, marginLeft: 3, fontSize: 7 }}>{comboLabel}</span>}
        </p>
        <p>Lv.<strong style={{ color: '#e4e4e7' }}>{level}</strong></p>
        {isFever && <p className="bc-fever-tag">FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</p>}
      </div>

      {/* Speed/Danger Bar */}
      <div className="bc-speed-bar">
        <div className="bc-speed-fill" style={{ width: `${speedPct}%` }} />
      </div>

      {/* Game Area */}
      <div className="bc-game" ref={gameAreaRef}>
        <div className="bc-scanlines" />
        <div className="bc-pixel-grid" />
        <div className="bc-bottom-glow" />

        {dangerLevel > 50 && (
          <span className="bc-diff-label" style={{ color: dangerLevel > 80 ? '#ef4444' : '#f59e0b' }}>
            {dangerLevel > 80 ? 'DANGER!!' : 'SPEED UP!'}
          </span>
        )}

        <span className="bc-level-badge">Lv.{level}</span>

        {Array.from({ length: LANE_COUNT }).map((_, i) => {
          const isFlashing = laneFlashes.some((f) => f.lane === i)
          return (
            <div key={i} className={`bc-lane ${isFlashing ? 'flash' : ''}`}>
              <div className="bc-lane-bg" style={{ background: `radial-gradient(ellipse at 50% ${HIT_LINE_Y * 100}%, ${LANE_COLORS[i]}30, transparent 70%)` }} />
            </div>
          )
        })}

        <div className="bc-hit-line" />

        <div className="bc-lane-guides">
          {Array.from({ length: LANE_COUNT - 1 }).map((_, i) => (
            <div key={i} className="bc-lane-guide" style={{ left: `${((i + 1) / LANE_COUNT) * 100}%` }} />
          ))}
        </div>

        {notes.map((note) => {
          if (note.y < -0.1 || note.y > 1.15) return null
          const laneCenter = (note.lane + 0.5) / LANE_COUNT * 100
          const topPct = note.y * 100

          let typeClass = 'bc-note-normal'
          if (note.type === 'golden') typeClass = 'bc-note-golden'
          else if (note.type === 'double') typeClass = 'bc-note-double'
          else if (note.type === 'hold') typeClass = 'bc-note-hold'

          const stateClass = note.hit ? 'bc-note-hit' : note.missed ? 'bc-note-miss' : ''

          return (
            <div
              key={note.id}
              className={`bc-note ${typeClass} ${stateClass}`}
              style={{ left: `${laneCenter}%`, top: `${topPct}%` }}
            >
              <img src={NOTE_IMAGES[note.type]} alt="" className="bc-note-img" draggable={false} />
            </div>
          )
        })}

        {hitEffects.map((fx) => {
          const laneCenter = (fx.lane + 0.5) / LANE_COUNT * 100
          return (
            <div
              key={fx.id}
              className={`bc-hit-fx bc-hit-fx-${fx.kind}`}
              style={{ left: `${laneCenter}%` }}
            />
          )
        })}

        {lastJudge && (
          <p className={`bc-judge bc-judge-${lastJudge}`} key={`${lastJudge}-${Date.now()}`}>
            {lastJudge === 'perfect' ? 'PERFECT!' : lastJudge === 'good' ? 'GOOD!' : 'MISS'}
          </p>
        )}

        {combo >= 3 && (
          <p className="bc-combo-display" key={combo}>
            {combo}x
          </p>
        )}
      </div>

      {/* Lane buttons */}
      <div className="bc-btns">
        {Array.from({ length: LANE_COUNT }).map((_, i) => (
          <button
            key={i}
            className="bc-lane-btn"
            type="button"
            onPointerDown={(e) => { e.preventDefault(); handleLaneHit(i) }}
            onPointerUp={() => handleLaneRelease(i)}
            onPointerLeave={() => handleLaneRelease(i)}
          >
            {LANE_LABELS[i]}
          </button>
        ))}
      </div>
    </section>
  )
}

export const beatCatchModule: MiniGameModule = {
  manifest: {
    id: 'beat-catch',
    title: 'Beat Catch',
    description: 'Catch falling beats in 3 lanes! Rhythm game!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#f43f5e',
  },
  Component: BeatCatchGame,
}
