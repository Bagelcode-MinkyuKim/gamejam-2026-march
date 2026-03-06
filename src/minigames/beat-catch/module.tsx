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
import gameplayBgmLoop from '../../../assets/sounds/gameplay-bgm-loop.mp3'
import reverseSfx from '../../../assets/sounds/beat-catch-reverse.mp3'
import tapSfx from '../../../assets/sounds/light-speed-tap.mp3'
import lifeLostSfx from '../../../assets/sounds/flappy-singer-lifelost.mp3'
import spotlightSfx from '../../../assets/sounds/combo-milestone.mp3'
import rushSfx from '../../../assets/sounds/speed-tap-rush-time.mp3'
import goldRainSfx from '../../../assets/sounds/light-speed-golden.mp3'
import startSfx from '../../../assets/sounds/countdown-start.mp3'
import holdStartSfx from '../../../assets/sounds/countdown-tick.mp3'
import holdCompleteSfx from '../../../assets/sounds/drum-circle-hold-complete.mp3'
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
  BEAT_CATCH_GOLD_RAIN_DURATION_MS as GOLD_RAIN_DURATION_MS,
  BEAT_CATCH_GOLD_RAIN_INTERVAL_MS as GOLD_RAIN_INTERVAL_MS,
  BEAT_CATCH_GOLD_RAIN_START_MS as GOLD_RAIN_START_MS,
  BEAT_CATCH_HIT_LINE_Y as HIT_LINE_Y,
  BEAT_CATCH_MAX_LIVES as MAX_LIVES,
  BEAT_CATCH_MISS_ZONE as MISS_ZONE,
  BEAT_CATCH_PERFECT_SCORE as PERFECT_SCORE,
  BEAT_CATCH_REVERSE_DURATION_MS as REVERSE_DURATION_MS,
  BEAT_CATCH_REVERSE_INTERVAL_MS as REVERSE_INTERVAL_MS,
  BEAT_CATCH_REVERSE_START_MS as REVERSE_START_MS,
  BEAT_CATCH_RUSH_DURATION_MS as RUSH_DURATION_MS,
  BEAT_CATCH_RUSH_INTERVAL_MS as RUSH_INTERVAL_MS,
  BEAT_CATCH_RUSH_SPAWN_MULTIPLIER as RUSH_SPAWN_MULTIPLIER,
  BEAT_CATCH_RUSH_SPEED_MULTIPLIER as RUSH_SPEED_MULTIPLIER,
  BEAT_CATCH_RUSH_START_MS as RUSH_START_MS,
  BEAT_CATCH_SPOTLIGHT_DURATION_MS as SPOTLIGHT_DURATION_MS,
  BEAT_CATCH_SPOTLIGHT_INTERVAL_MS as SPOTLIGHT_INTERVAL_MS,
  BEAT_CATCH_SPOTLIGHT_MULTIPLIER as SPOTLIGHT_MULTIPLIER,
  BEAT_CATCH_SPOTLIGHT_START_MS as SPOTLIGHT_START_MS,
  getBeatCatchDifficulty,
  getBeatCatchLevel,
  loseBeatCatchLife,
} from './logic'

// ─── Game Constants ─────────────────────────────────────────────────
const LANE_COUNT = 3
const MODE_BANNER_DURATION_MS = 1400
const BGM_VOLUME = 0.56
const GOLD_RAIN_GOLDEN_CHANCE = 0.58
const HOLD_SCORE_MULTIPLIER = 1.45

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
  holdJudge?: Exclude<JudgeKind, 'miss'>
  holding?: boolean
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
  const [elapsedMs, setElapsedMs] = useState(0)
  const [lastJudge, setLastJudge] = useState<JudgeKind | null>(null)
  const [lives, setLives] = useState(MAX_LIVES)
  const [rushRemainingMs, setRushRemainingMs] = useState(0)
  const [reverseRemainingMs, setReverseRemainingMs] = useState(0)
  const [goldRainRemainingMs, setGoldRainRemainingMs] = useState(0)
  const [spotlightLane, setSpotlightLane] = useState<number | null>(null)
  const [spotlightRemainingMs, setSpotlightRemainingMs] = useState(0)
  const [modeBanner, setModeBanner] = useState<string | null>(null)

  const effects = useGameEffects()
  const {
    particles,
    scorePopups,
    isFlashing,
    flashColor,
    triggerShake,
    triggerFlash,
    spawnParticles,
    showScorePopup,
    comboHitBurst,
    updateParticles,
    cleanup: cleanupEffects,
    getShakeStyle,
  } = effects

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
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const bgmStartedRef = useRef(false)
  const rushMsRef = useRef(0)
  const reverseMsRef = useRef(0)
  const goldRainMsRef = useRef(0)
  const spotlightMsRef = useRef(0)
  const spotlightLaneRef = useRef<number | null>(null)
  const nextRushAtRef = useRef(RUSH_START_MS)
  const nextReverseAtRef = useRef(REVERSE_START_MS)
  const nextGoldRainAtRef = useRef(GOLD_RAIN_START_MS)
  const nextSpotlightAtRef = useRef(SPOTLIGHT_START_MS)
  const modeBannerTimerRef = useRef<number | null>(null)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const playAudio = useCallback((name: string, volume = 0.6, rate = 1) => {
    const audio = audioRefs.current[name]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const stopBgm = useCallback(() => {
    const bgm = bgmRef.current
    if (!bgm) return
    bgm.pause()
    bgm.currentTime = 0
  }, [])

  const ensureBgm = useCallback(() => {
    const bgm = bgmRef.current
    if (!bgm || finishedRef.current) return
    if (!bgmStartedRef.current) {
      bgmStartedRef.current = true
      playAudio('start', 0.32)
    }
    bgm.loop = true
    bgm.volume = BGM_VOLUME
    if (bgm.paused) {
      void bgm.play().catch(() => {})
    }
  }, [playAudio])

  const mapInputLane = useCallback((inputLane: number) => {
    return reverseMsRef.current > 0 ? LANE_COUNT - 1 - inputLane : inputLane
  }, [])

  const announceMode = useCallback((message: string) => {
    setModeBanner(message)
    if (modeBannerTimerRef.current) clearTimeout(modeBannerTimerRef.current)
    modeBannerTimerRef.current = window.setTimeout(() => {
      setModeBanner(null)
      modeBannerTimerRef.current = null
    }, MODE_BANNER_DURATION_MS)
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
    stopBgm()
    playAudio('gameover', 0.62)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, elapsedRef.current)),
    })
  }, [onFinish, playAudio, stopBgm])

  const spawnNote = useCallback(() => {
    const activeCount = notesRef.current.filter(n => !n.hit && !n.missed).length
    const difficulty = getBeatCatchDifficulty(elapsedRef.current)
    if (activeCount >= difficulty.maxActiveNotes) return

    const chances = difficulty.specialChances
    const rushActive = rushMsRef.current > 0
    const goldRainActive = goldRainMsRef.current > 0
    const spotlightLaneIndex = spotlightLaneRef.current
    const spotlightBias = spotlightLaneIndex !== null && spotlightMsRef.current > 0 && Math.random() < 0.66
    const lane = spotlightBias ? spotlightLaneIndex : Math.floor(Math.random() * LANE_COUNT)
    const effectiveHoldChance = Math.min(0.18, chances.hold + (rushActive ? 0.03 : 0))
    const effectiveDoubleChance = Math.min(0.22, chances.double + (rushActive ? 0.04 : 0))
    const effectiveGoldenChance = goldRainActive
      ? Math.min(0.54, Math.max(GOLD_RAIN_GOLDEN_CHANCE, chances.golden + 0.38))
      : chances.golden

    let type: NoteType = 'normal'
    const roll = Math.random()
    if (roll < effectiveHoldChance) {
      type = 'hold'
    } else if (roll < effectiveHoldChance + effectiveDoubleChance) {
      type = 'double'
    } else if (roll < effectiveHoldChance + effectiveDoubleChance + effectiveGoldenChance) {
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
    const multiSpawnChance = Math.min(0.72, chances.multiSpawn + (rushActive ? 0.18 : 0) + (goldRainActive ? 0.08 : 0))
    if (Math.random() < multiSpawnChance) {
      const extraSpotlightBias = spotlightLaneIndex !== null && spotlightMsRef.current > 0 && Math.random() < 0.7
      const extraLane = extraSpotlightBias ? spotlightLaneIndex : Math.floor(Math.random() * LANE_COUNT)
      if (notesRef.current.filter(n => !n.hit && !n.missed && n.lane === extraLane).length === 0) {
        noteIdCounter += 1
        const extraNote: Note = {
          id: noteIdCounter,
          lane: extraLane,
          y: -0.08 - Math.random() * 0.05,
          type: goldRainActive && Math.random() < 0.52 ? 'golden' : 'normal',
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

  const activateRush = useCallback(() => {
    rushMsRef.current = RUSH_DURATION_MS
    setRushRemainingMs(RUSH_DURATION_MS)
    announceMode('JAM RUSH')
    playAudio('rush', 0.56)
    triggerFlash('rgba(249,115,22,0.28)')
  }, [announceMode, playAudio, triggerFlash])

  const activateReverse = useCallback(() => {
    reverseMsRef.current = REVERSE_DURATION_MS
    setReverseRemainingMs(REVERSE_DURATION_MS)
    announceMode('REVERSE MODE')
    playAudio('reverse', 0.58)
    triggerFlash('rgba(139,92,246,0.26)')
  }, [announceMode, playAudio, triggerFlash])

  const activateGoldRain = useCallback(() => {
    goldRainMsRef.current = GOLD_RAIN_DURATION_MS
    setGoldRainRemainingMs(GOLD_RAIN_DURATION_MS)
    announceMode('GOLD RAIN')
    playAudio('goldrain', 0.6)
    triggerFlash('rgba(250,204,21,0.28)')
  }, [announceMode, playAudio, triggerFlash])

  const activateSpotlight = useCallback(() => {
    const lane = Math.floor(Math.random() * LANE_COUNT)
    spotlightLaneRef.current = lane
    spotlightMsRef.current = SPOTLIGHT_DURATION_MS
    setSpotlightLane(lane)
    setSpotlightRemainingMs(SPOTLIGHT_DURATION_MS)
    addLaneFlash(lane)
    announceMode(`${LANE_LABELS[lane]} SPOTLIGHT`)
    playAudio('spotlight', 0.5)
    triggerFlash('rgba(250,204,21,0.22)')
  }, [addLaneFlash, announceMode, playAudio, triggerFlash])

  const registerMiss = useCallback((lane: number, deductLife: boolean) => {
    if (finishedRef.current) return

    breakCombo()
    setLastJudge('miss')
    addHitEffect(lane, 'miss')
    if (deductLife) {
      playAudio('miss', 0.42, 0.76)
      playAudio('lifelost', 0.58)
      triggerShake(7)
      triggerFlash('rgba(239,68,68,0.32)')
    } else {
      playAudio('tap', 0.16, 0.96)
    }

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
  }, [addHitEffect, breakCombo, finishGame, playAudio, triggerFlash, triggerShake])

  const resolveCatch = useCallback((note: Note, kind: Exclude<JudgeKind, 'miss'>, soundMode: 'regular' | 'hold-complete' = 'regular') => {
    const nextCombo = comboRef.current + 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    const baseScore = kind === 'perfect' ? PERFECT_SCORE : GOOD_SCORE
    const feverMult = feverRef.current ? FEVER_MULTIPLIER : 1
    const goldenMult = note.type === 'golden' ? GOLDEN_MULTIPLIER : 1
    const holdMult = note.type === 'hold' ? HOLD_SCORE_MULTIPLIER : 1
    const goldRainMult = goldRainMsRef.current > 0 && note.type === 'golden' ? 2 : 1
    const spotlightMult = spotlightLaneRef.current === note.lane && spotlightMsRef.current > 0 ? SPOTLIGHT_MULTIPLIER : 1
    const earned = baseScore * nextCombo * feverMult * goldenMult * holdMult * goldRainMult * spotlightMult
    scoreRef.current += earned
    setScore(scoreRef.current)

    catchCountRef.current += 1

    const newLevel = getBeatCatchLevel(catchCountRef.current)
    if (newLevel > levelRef.current) {
      levelRef.current = newLevel
      setLevel(newLevel)
      playAudio('levelup', 0.6)
      triggerFlash('rgba(59,130,246,0.4)')
    }

    if (nextCombo >= FEVER_COMBO && !feverRef.current) {
      feverRef.current = true
      feverMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverRemainingMs(FEVER_DURATION_MS)
      playAudio('fever', 0.7)
      triggerFlash('rgba(250,204,21,0.5)')
    }

    if (soundMode === 'hold-complete') {
      playAudio('holdcomplete', 0.62, kind === 'perfect' ? 1.06 : 1.02)
    } else if (goldRainMult > 1) {
      playAudio('goldrain', 0.5, 1.06)
    } else if (note.type === 'golden') {
      playAudio('golden', 0.7)
    } else if (note.type === 'double') {
      playAudio('double', 0.6)
    } else if (spotlightMult > 1) {
      playAudio('spotlight', 0.44, 1.05)
    } else if (nextCombo > 0 && nextCombo % 5 === 0) {
      playAudio('combo', 0.7, 1.0 + Math.min(nextCombo * 0.02, 0.4))
    } else {
      playAudio(kind === 'perfect' ? 'perfect' : 'good', 0.6, 1.0 + Math.min(nextCombo * 0.02, 0.3))
    }

    addHitEffect(note.lane, kind)
    addLaneFlash(note.lane)
    setLastJudge(kind)

    const areaRect = gameAreaRef.current?.getBoundingClientRect()
    if (areaRect) {
      const laneWidth = areaRect.width / LANE_COUNT
      const px = note.lane * laneWidth + laneWidth / 2
      const py = areaRect.height * HIT_LINE_Y
      if (kind === 'perfect') {
        comboHitBurst(px, py, nextCombo, earned, ['◆', '★', '✦', '✷', '✸'])
      } else {
        spawnParticles(3, px, py)
        showScorePopup(earned, px, py - 20)
        triggerFlash(soundMode === 'hold-complete' ? 'rgba(52,211,153,0.28)' : 'rgba(34,197,94,0.25)')
      }

      if (spotlightMult > 1 || soundMode === 'hold-complete') {
        addLaneFlash(note.lane)
        spawnParticles(soundMode === 'hold-complete' ? 5 : 4, px, py - 10)
      }
    }

    if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current)
    judgeTimerRef.current = window.setTimeout(() => { setLastJudge(null) }, 350)
  }, [addHitEffect, addLaneFlash, comboHitBurst, playAudio, showScorePopup, spawnParticles, triggerFlash])

  const handleLaneHit = useCallback((inputLane: number) => {
    if (finishedRef.current) return
    ensureBgm()

    const lane = mapInputLane(inputLane)

    const difficulty = getBeatCatchDifficulty(elapsedRef.current)
    const perfectZone = difficulty.perfectZone
    const goodZone = difficulty.goodZone

    const candidates = notesRef.current
      .filter((n) => n.lane === lane && !n.hit && !n.missed && !n.holding)
      .map((n) => ({ note: n, dist: Math.abs(n.y - HIT_LINE_Y) }))
      .filter((c) => c.dist <= MISS_ZONE)
      .sort((a, b) => a.dist - b.dist)

    if (candidates.length === 0) {
      registerMiss(lane, false)
      return
    }

    const { note, dist } = candidates[0]
    const kind: Exclude<JudgeKind, 'miss'> = dist <= perfectZone ? 'perfect' : dist <= goodZone ? 'good' : 'good'

    if (note.type === 'hold') {
      holdingLanesRef.current.add(lane)
      note.holding = true
      note.holdJudge = kind
      note.holdProgress = 0
      note.y = HIT_LINE_Y
      playAudio('holdstart', 0.44, kind === 'perfect' ? 1.04 : 0.98)
      addLaneFlash(lane)
      setLastJudge(kind)
      if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current)
      judgeTimerRef.current = window.setTimeout(() => { setLastJudge(null) }, 350)
      setNotes([...notesRef.current])
      return
    }

    note.hit = true
    resolveCatch(note, kind)
    setNotes([...notesRef.current])
  }, [addLaneFlash, ensureBgm, mapInputLane, playAudio, registerMiss, resolveCatch])

  const handleLaneRelease = useCallback((inputLane: number) => {
    holdingLanesRef.current.delete(mapInputLane(inputLane))
  }, [mapInputLane])

  // Audio setup
  useEffect(() => {
    const sources: Record<string, string> = {
      start: startSfx,
      holdstart: holdStartSfx,
      holdcomplete: holdCompleteSfx,
      perfect: perfectSfx,
      good: goodSfx,
      miss: missSfx,
      tap: tapSfx,
      combo: comboSfx,
      fever: feverSfx,
      golden: goldenSfx,
      levelup: levelupSfx,
      double: doubleSfx,
      rush: rushSfx,
      reverse: reverseSfx,
      goldrain: goldRainSfx,
      lifelost: lifeLostSfx,
      spotlight: spotlightSfx,
      gameover: gameOverHitSfx,
    }
    const audioMap = audioRefs.current
    Object.entries(sources).forEach(([name, src]) => {
      const a = new Audio(src)
      a.preload = 'auto'
      audioMap[name] = a
    })
    const bgm = new Audio(gameplayBgmLoop)
    bgm.loop = true
    bgm.preload = 'auto'
    bgm.volume = BGM_VOLUME
    bgmRef.current = bgm
    return () => {
      Object.keys(sources).forEach((name) => { audioMap[name] = null })
      if (modeBannerTimerRef.current) clearTimeout(modeBannerTimerRef.current)
      if (judgeTimerRef.current) clearTimeout(judgeTimerRef.current)
      bgmStartedRef.current = false
      stopBgm()
      bgmRef.current = null
      cleanupEffects()
    }
  }, [cleanupEffects, stopBgm])

  useEffect(() => {
    const activateAudio = () => {
      ensureBgm()
    }
    window.addEventListener('pointerdown', activateAudio, true)
    window.addEventListener('keydown', activateAudio, true)
    return () => {
      window.removeEventListener('pointerdown', activateAudio, true)
      window.removeEventListener('keydown', activateAudio, true)
    }
  }, [ensureBgm])

  // Key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      for (let lane = 0; lane < LANE_COUNT; lane++) {
        if ((LANE_KEYS[lane] as readonly string[]).includes(e.code)) {
          e.preventDefault()
          if (e.repeat) return
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
      setElapsedMs(elapsedRef.current)

      if (rushMsRef.current > 0) {
        rushMsRef.current = Math.max(0, rushMsRef.current - deltaMs)
        setRushRemainingMs(rushMsRef.current)
      }

      if (reverseMsRef.current > 0) {
        reverseMsRef.current = Math.max(0, reverseMsRef.current - deltaMs)
        setReverseRemainingMs(reverseMsRef.current)
      }

      if (goldRainMsRef.current > 0) {
        goldRainMsRef.current = Math.max(0, goldRainMsRef.current - deltaMs)
        setGoldRainRemainingMs(goldRainMsRef.current)
      }

      if (spotlightMsRef.current > 0) {
        spotlightMsRef.current = Math.max(0, spotlightMsRef.current - deltaMs)
        setSpotlightRemainingMs(spotlightMsRef.current)
        if (spotlightMsRef.current <= 0) {
          spotlightLaneRef.current = null
          setSpotlightLane(null)
        }
      }

      if (elapsedRef.current >= nextRushAtRef.current) {
        nextRushAtRef.current += RUSH_INTERVAL_MS
        if (rushMsRef.current <= 0) {
          activateRush()
        }
      }

      if (elapsedRef.current >= nextSpotlightAtRef.current) {
        nextSpotlightAtRef.current += SPOTLIGHT_INTERVAL_MS
        if (spotlightMsRef.current <= 0) {
          activateSpotlight()
        }
      }

      if (elapsedRef.current >= nextReverseAtRef.current) {
        nextReverseAtRef.current += REVERSE_INTERVAL_MS
        if (reverseMsRef.current <= 0) {
          activateReverse()
        }
      }

      if (elapsedRef.current >= nextGoldRainAtRef.current) {
        nextGoldRainAtRef.current += GOLD_RAIN_INTERVAL_MS
        if (goldRainMsRef.current <= 0) {
          activateGoldRain()
        }
      }

      // Fever countdown
      if (feverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverRemainingMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          clearFever()
        }
      }

      // Spawn notes
      spawnTimerRef.current += deltaMs
      const difficulty = getBeatCatchDifficulty(elapsedRef.current)
      const rushSpawnMultiplier = rushMsRef.current > 0 ? RUSH_SPAWN_MULTIPLIER : 1
      const spawnInterval = Math.max(90, difficulty.spawnIntervalMs * rushSpawnMultiplier)
      while (spawnTimerRef.current >= spawnInterval) {
        spawnTimerRef.current -= spawnInterval
        spawnNote()
      }

      // Move notes
      const fallSpeed = difficulty.fallSpeed * (rushMsRef.current > 0 ? RUSH_SPEED_MULTIPLIER : 1)
      const deltaSec = deltaMs / 1000
      const bgm = bgmRef.current
      if (bgm) {
        bgm.volume = BGM_VOLUME
        bgm.playbackRate = 1 + difficulty.difficultyRatio * 0.08 + (rushMsRef.current > 0 ? 0.08 : 0)
      }

      for (const note of notesRef.current) {
        if (note.hit || note.missed) continue

        if (note.type === 'hold' && note.holding) {
          note.y = HIT_LINE_Y
          if (!holdingLanesRef.current.has(note.lane)) {
            note.holding = false
            note.missed = true
            registerMiss(note.lane, true)
            if (finishedRef.current) {
              rafRef.current = null
              return
            }
            continue
          }

          note.holdProgress = Math.min(note.holdDuration ?? 0, (note.holdProgress ?? 0) + deltaMs)
          if ((note.holdDuration ?? 0) > 0 && (note.holdProgress ?? 0) >= (note.holdDuration ?? 0)) {
            note.holding = false
            note.hit = true
            holdingLanesRef.current.delete(note.lane)
            resolveCatch(note, note.holdJudge ?? 'good', 'hold-complete')
          }
          continue
        }

        note.y += fallSpeed * deltaSec

        if (note.y > HIT_LINE_Y + MISS_ZONE && !note.hit) {
          note.missed = true
          registerMiss(note.lane, true)
          if (finishedRef.current) {
            rafRef.current = null
            return
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

      updateParticles()
      if (finishedRef.current) { rafRef.current = null; return }
      rafRef.current = window.requestAnimationFrame(step)
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [activateGoldRain, activateReverse, activateRush, activateSpotlight, clearFever, registerMiss, resolveCatch, spawnNote, updateParticles])

  // Derived
  const difficulty = useMemo(() => getBeatCatchDifficulty(elapsedMs), [elapsedMs])
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const lifeSlots = useMemo(() => Array.from({ length: MAX_LIVES }, (_, i) => i < lives), [lives])
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const speedPct = difficulty.dangerLevel
  const survivedSeconds = elapsedMs / 1000
  const difficultyColor = difficulty.dangerLevel >= 85 ? '#ef4444' : difficulty.dangerLevel >= 60 ? '#f59e0b' : '#60a5fa'
  const isCriticalLife = lives <= 1
  const isRushMode = rushRemainingMs > 0
  const isReverseMode = reverseRemainingMs > 0
  const isGoldRainMode = goldRainRemainingMs > 0
  const isSpotlightMode = spotlightLane !== null && spotlightRemainingMs > 0
  const spotlightLaneLabel = spotlightLane === null ? null : LANE_LABELS[spotlightLane]

  return (
    <section
      className={`mini-game-panel bc-panel ${isFever ? 'bc-fever' : ''} ${isCriticalLife ? 'bc-critical' : ''} ${isRushMode ? 'bc-rush' : ''} ${isReverseMode ? 'bc-reverse' : ''} ${isGoldRainMode ? 'bc-gold-rain' : ''}`}
      aria-label="beat-catch-game"
      style={{ ...getShakeStyle() }}
      onPointerDown={ensureBgm}
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

        .bc-panel.bc-critical::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          box-shadow: inset 0 0 0 4px rgba(239,68,68,0.45), inset 0 0 42px rgba(127,29,29,0.65);
          animation: bc-critical-pulse 0.7s ease-in-out infinite alternate;
          z-index: 7;
        }

        .bc-fever {
          animation: bc-fever-bg 0.5s ease-in-out infinite alternate;
        }

        .bc-panel.bc-reverse {
          background: linear-gradient(180deg, #080d1c 0%, #120822 48%, #0a0a1a 100%);
        }

        .bc-panel.bc-rush {
          background: linear-gradient(180deg, #140b02 0%, #251105 48%, #0a0a1a 100%);
        }

        .bc-panel.bc-gold-rain {
          box-shadow: inset 0 0 48px rgba(250, 204, 21, 0.12);
        }

        @keyframes bc-critical-pulse {
          from { opacity: 0.5; }
          to { opacity: 1; }
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

        .bc-hdr-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 6px;
        }

        .bc-hdr-chip {
          margin: 0;
          padding: 6px 8px 5px;
          font-size: 7px;
          border: 2px solid rgba(96,165,250,0.55);
          color: #dbeafe;
          background: rgba(30,41,59,0.8);
          box-shadow: 0 0 12px rgba(59,130,246,0.24);
        }

        .bc-hdr-chip.hot {
          border-color: rgba(245,158,11,0.7);
          color: #fde68a;
          background: rgba(120,53,15,0.55);
          box-shadow: 0 0 14px rgba(245,158,11,0.28);
        }

        .bc-hdr-chip.critical {
          border-color: rgba(239,68,68,0.82);
          color: #fecaca;
          background: rgba(127,29,29,0.7);
          box-shadow: 0 0 18px rgba(239,68,68,0.35);
          animation: bc-blink 0.45s infinite alternate;
        }

        .bc-lives {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: clamp(18px, 5vw, 24px);
        }

        .bc-life {
          line-height: 1;
          transition: opacity 0.12s ease, transform 0.12s ease;
          text-shadow: 0 0 8px rgba(244,63,94,0.35);
        }

        .bc-life.alive {
          color: #fb7185;
        }

        .bc-life.lost {
          color: rgba(251,113,133,0.18);
          filter: grayscale(1);
        }

        @keyframes bc-blink { from { opacity: 1; } to { opacity: 0.3; } }

        /* ─── Status Bar ─── */
        .bc-stat {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px 12px;
          padding: 6px 10px;
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

        .bc-stat-strong {
          color: #e4e4e7;
        }

        .bc-fever-tag {
          color: #facc15;
          font-weight: 800;
          animation: bc-blink 0.3s infinite alternate;
          text-shadow: 0 0 8px rgba(250,204,21,0.7);
          font-size: 8px;
        }

        .bc-mode-chip {
          padding: 4px 6px;
          border: 2px solid rgba(255,255,255,0.12);
          color: #f8fafc;
          background: rgba(15,23,42,0.75);
          box-shadow: 0 0 12px rgba(15,23,42,0.28);
        }

        .bc-mode-chip.reverse {
          border-color: rgba(168,85,247,0.65);
          color: #e9d5ff;
          background: rgba(76,29,149,0.55);
        }

        .bc-mode-chip.rush {
          border-color: rgba(249,115,22,0.72);
          color: #fed7aa;
          background: rgba(124,45,18,0.58);
        }

        .bc-mode-chip.gold-rain {
          border-color: rgba(250,204,21,0.78);
          color: #fef3c7;
          background: rgba(133,77,14,0.62);
          box-shadow: 0 0 14px rgba(250,204,21,0.26);
        }

        .bc-mode-chip.spotlight {
          border-color: rgba(250,204,21,0.72);
          color: #fef08a;
          background: rgba(113,63,18,0.58);
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
          top: 10px;
          right: 10px;
          font-size: 7px;
          padding: 4px 6px;
          border: 2px solid rgba(255,255,255,0.16);
          background: rgba(10,10,26,0.76);
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

        .bc-lane.spotlight .bc-lane-bg {
          opacity: 0.8;
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
          width: 82px;
          height: 82px;
          transform: translate(-50%, -50%);
          z-index: 4;
          pointer-events: none;
          image-rendering: pixelated;
          border-radius: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .bc-note-normal {
          filter: drop-shadow(0 0 8px rgba(244,63,94,0.7));
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
          filter: drop-shadow(0 0 10px rgba(139,92,246,0.8));
        }

        .bc-note-hold {
          filter: drop-shadow(0 0 10px rgba(52,211,153,0.8));
          width: 76px;
          height: 128px;
        }

        .bc-note-holding {
          animation: bc-hold-charge 0.24s steps(2) infinite alternate;
          box-shadow: inset 0 0 0 3px rgba(167,243,208,0.24);
        }

        @keyframes bc-hold-charge {
          from { filter: drop-shadow(0 0 10px rgba(52,211,153,0.8)) brightness(1); }
          to { filter: drop-shadow(0 0 18px rgba(52,211,153,1)) brightness(1.14); }
        }

        .bc-note-spotlight {
          filter: drop-shadow(0 0 14px rgba(250,204,21,0.95)) brightness(1.08);
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

        .bc-hold-meter {
          position: absolute;
          left: 10px;
          right: 10px;
          bottom: 8px;
          height: 36px;
          border: 2px solid rgba(167,243,208,0.55);
          background: rgba(2,44,34,0.48);
          box-shadow: inset 0 0 10px rgba(6,95,70,0.24);
        }

        .bc-hold-fill {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(180deg, rgba(110,231,183,0.62), rgba(16,185,129,0.94));
          transition: height 0.06s linear;
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

        .bc-mode-banner {
          position: absolute;
          top: 44px;
          left: 50%;
          transform: translateX(-50%);
          padding: 8px 10px 7px;
          border: 2px solid rgba(255,255,255,0.14);
          background: rgba(15,23,42,0.82);
          color: #f8fafc;
          font-size: 8px;
          z-index: 8;
          pointer-events: none;
          text-shadow: 0 0 8px rgba(255,255,255,0.18);
          animation: bc-mode-banner-pop 0.28s steps(4);
        }

        @keyframes bc-mode-banner-pop {
          0% { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(0.9); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
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

        .bc-lane-btn.spotlight {
          box-shadow: inset 0 0 0 3px rgba(250,204,21,0.55), 0 -4px 18px rgba(250,204,21,0.2);
          filter: brightness(1.08);
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

      <FlashOverlay isFlashing={isFlashing} flashColor={flashColor} />
      <ParticleRenderer particles={particles} />
      <ScorePopupRenderer popups={scorePopups} />

      {/* Header */}
      <div className="bc-hdr">
        <div>
          <p className="bc-hdr-score">{score.toLocaleString()}</p>
          <p className="bc-hdr-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="bc-hdr-right">
          <p className={`bc-hdr-chip ${difficulty.dangerLevel >= 85 ? 'critical' : difficulty.dangerLevel >= 60 ? 'hot' : ''}`}>
            {difficulty.label}
          </p>
          <div className="bc-lives" aria-label={`beat-catch-lives-${lives}`}>
            {lifeSlots.map((alive, i) => (
              <span key={i} className={`bc-life ${alive ? 'alive' : 'lost'}`}>
                {alive ? '♥' : '♡'}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="bc-stat">
        <p>
          COMBO <span className="bc-combo-num">{combo}</span>
          {comboLabel && <span className="ge-combo-label" style={{ color: comboColor, marginLeft: 3, fontSize: 7 }}>{comboLabel}</span>}
        </p>
        <p>Lv.<strong className="bc-stat-strong">{level}</strong></p>
        <p>SURVIVE <strong className="bc-stat-strong">{survivedSeconds.toFixed(1)}s</strong></p>
        {isFever && <p className="bc-fever-tag">FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</p>}
        {isRushMode && <p className="bc-mode-chip rush">RUSH {(rushRemainingMs / 1000).toFixed(1)}s</p>}
        {isReverseMode && <p className="bc-mode-chip reverse">REVERSE {(reverseRemainingMs / 1000).toFixed(1)}s</p>}
        {isGoldRainMode && <p className="bc-mode-chip gold-rain">GOLD RAIN x2 {(goldRainRemainingMs / 1000).toFixed(1)}s</p>}
        {isSpotlightMode && spotlightLaneLabel && (
          <p className="bc-mode-chip spotlight">
            {spotlightLaneLabel} x{SPOTLIGHT_MULTIPLIER} {(spotlightRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
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

        <span className="bc-diff-label" style={{ color: difficultyColor }}>
          {difficulty.label} {speedPct}%
        </span>

        <span className="bc-level-badge">Lv.{level}</span>
        {modeBanner && <p className="bc-mode-banner">{modeBanner}</p>}

        {Array.from({ length: LANE_COUNT }).map((_, i) => {
          const isFlashing = laneFlashes.some((f) => f.lane === i)
          const isSpotlightLane = spotlightLane === i && isSpotlightMode
          return (
            <div key={i} className={`bc-lane ${isFlashing ? 'flash' : ''} ${isSpotlightLane ? 'spotlight' : ''}`}>
              <div
                className="bc-lane-bg"
                style={{
                  background: isSpotlightLane
                    ? `radial-gradient(ellipse at 50% ${HIT_LINE_Y * 100}%, rgba(250,204,21,0.32), ${LANE_COLORS[i]}40, transparent 74%)`
                    : `radial-gradient(ellipse at 50% ${HIT_LINE_Y * 100}%, ${LANE_COLORS[i]}30, transparent 70%)`,
                }}
              />
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

          const stateClass = note.hit ? 'bc-note-hit' : note.missed ? 'bc-note-miss' : note.holding ? 'bc-note-holding' : ''
          const spotlightClass = spotlightLane === note.lane && isSpotlightMode ? 'bc-note-spotlight' : ''
          const holdProgressPct = note.type === 'hold' && note.holding && note.holdDuration
            ? Math.min(100, ((note.holdProgress ?? 0) / note.holdDuration) * 100)
            : 0

          return (
            <div
              key={note.id}
              className={`bc-note ${typeClass} ${stateClass} ${spotlightClass}`}
              style={{ left: `${laneCenter}%`, top: `${topPct}%` }}
            >
              <img src={NOTE_IMAGES[note.type]} alt="" className="bc-note-img" draggable={false} />
              {note.type === 'hold' && note.holding && (
                <div className="bc-hold-meter">
                  <div className="bc-hold-fill" style={{ height: `${holdProgressPct}%` }} />
                </div>
              )}
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
          <p className={`bc-judge bc-judge-${lastJudge}`}>
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
            className={`bc-lane-btn ${spotlightLane === i && isSpotlightMode ? 'spotlight' : ''}`}
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
