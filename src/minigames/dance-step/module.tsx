import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import dsPerfectSfx from '../../../assets/sounds/dance-step-perfect.mp3'
import dsGoodSfx from '../../../assets/sounds/dance-step-good.mp3'
import dsMissSfx from '../../../assets/sounds/dance-step-miss.mp3'
import dsFeverSfx from '../../../assets/sounds/dance-step-fever.mp3'
import dsComboSfx from '../../../assets/sounds/dance-step-combo.mp3'
import dsTimeWarnSfx from '../../../assets/sounds/dance-step-time-warning.mp3'
import dsLevelUpSfx from '../../../assets/sounds/dance-step-levelup.mp3'
import dsChainSfx from '../../../assets/sounds/dance-step-chain.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import characterImage from '../../../assets/images/same-character/kim-yeonja.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const LOW_TIME_THRESHOLD_MS = 5000

const ARROW_TRAVEL_DURATION_MS = 1800
const ARROW_SPAWN_INTERVAL_START_MS = 1200
const ARROW_SPAWN_INTERVAL_MIN_MS = 350
const ARROW_SPAWN_ACCELERATION = 0.90
const ARROW_SPAWN_STEP_INTERVAL_MS = 3500

const TARGET_LINE_Y_PERCENT = 20
const PERFECT_WINDOW_MS = 150
const GOOD_WINDOW_MS = 350

const SCORE_PERFECT = 3
const SCORE_GOOD = 1
const SCORE_MISS = -1
const COMBO_BONUS_THRESHOLD = 10
const COMBO_BONUS_MULTIPLIER = 0.5

const FEVER_COMBO_THRESHOLD = 15
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const DOUBLE_ARROW_ELAPSED_MS = 10000
const DOUBLE_ARROW_CHANCE = 0.35
const RAINBOW_ARROW_ELAPSED_MS = 16000
const RAINBOW_ARROW_CHANCE = 0.12
const RAINBOW_MULTIPLIER = 5
const BOSS_ARROW_ELAPSED_MS = 20000
const BOSS_ARROW_CHANCE = 0.06
const BOSS_MULTIPLIER = 10
const FREEZE_COMBO_THRESHOLD = 25
const FREEZE_DURATION_MS = 3000

const FEEDBACK_DURATION_MS = 400
const SPEED_LEVEL_INTERVAL_MS = 5000

type Direction = 'up' | 'down' | 'left' | 'right'

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'] as const

// Pixel art block arrows
const DIRECTION_SYMBOLS: Record<Direction, string> = {
  up: '\u25B2',
  down: '\u25BC',
  left: '\u25C0',
  right: '\u25B6',
}

const DIRECTION_COLORS: Record<Direction, string> = {
  up: '#ff3377',
  down: '#33bbff',
  left: '#33ff77',
  right: '#ffcc33',
}

const DIRECTION_KEY_MAP: Record<string, Direction> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
}

interface FallingArrow {
  readonly id: number
  readonly direction: Direction
  readonly spawnedAtMs: number
  readonly isRainbow: boolean
  readonly isBoss: boolean
  consumed: boolean
}

type HitGrade = 'perfect' | 'good' | 'miss'

interface HitFeedback {
  readonly grade: HitGrade
  readonly direction: Direction
  readonly expiresAtMs: number
}

function pickRandomDirection(prev?: Direction): Direction {
  const c = DIRECTIONS.filter((d) => d !== prev)
  return c[Math.floor(Math.random() * c.length)]
}

function computeArrowYPercent(ageMs: number, travelMs: number): number {
  return 100 - (ageMs / travelMs) * (100 - TARGET_LINE_Y_PERCENT)
}

function computeSpawnInterval(elapsedMs: number): number {
  const steps = Math.floor(elapsedMs / ARROW_SPAWN_STEP_INTERVAL_MS)
  let interval = ARROW_SPAWN_INTERVAL_START_MS
  for (let i = 0; i < steps; i += 1) interval *= ARROW_SPAWN_ACCELERATION
  return Math.max(ARROW_SPAWN_INTERVAL_MIN_MS, interval)
}

function DanceStepGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [arrows, setArrows] = useState<FallingArrow[]>([])
  const [feedbacks, setFeedbacks] = useState<HitFeedback[]>([])
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [isFreeze, setIsFreeze] = useState(false)
  const [speedLevel, setSpeedLevel] = useState(1)
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [chainDir, setChainDir] = useState<Direction | null>(null)
  const [chainCount, setChainCount] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const elapsedMsRef = useRef(0)
  const arrowsRef = useRef<FallingArrow[]>([])
  const feedbacksRef = useRef<HitFeedback[]>([])
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const nextArrowIdRef = useRef(0)
  const lastSpawnAtRef = useRef(0)
  const lastDirectionRef = useRef<Direction | undefined>(undefined)
  const lowTimeSecondRef = useRef<number | null>(null)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const freezeRef = useRef(false)
  const freezeRemainingMsRef = useRef(0)
  const perfectStreakRef = useRef(0)
  const lastSpeedLevelRef = useRef(1)
  const comboMilestoneRef = useRef(0)
  const chainDirRef = useRef<Direction | null>(null)
  const chainCountRef = useRef(0)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const playAudio = useCallback((key: string, volume: number, rate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const addFeedback = useCallback((grade: HitGrade, direction: Direction) => {
    const fb: HitFeedback = { grade, direction, expiresAtMs: elapsedMsRef.current + FEEDBACK_DURATION_MS }
    feedbacksRef.current = [...feedbacksRef.current, fb]
    setFeedbacks(feedbacksRef.current)
  }, [])

  const applyHit = useCallback(
    (grade: HitGrade, direction: Direction, isRainbow: boolean, isBoss: boolean) => {
      if (grade === 'miss') {
        scoreRef.current = Math.max(0, scoreRef.current + SCORE_MISS)
        setScore(scoreRef.current)
        comboRef.current = 0
        setCombo(0)
        perfectStreakRef.current = 0
        setPerfectStreak(0)
        chainDirRef.current = null
        chainCountRef.current = 0
        setChainDir(null)
        setChainCount(0)
        addFeedback('miss', direction)
        playAudio('miss', 0.4)
        effects.triggerShake(5)
        effects.triggerFlash('rgba(255,0,0,0.3)')
        return
      }

      const basePoints = grade === 'perfect' ? SCORE_PERFECT : SCORE_GOOD
      const currentCombo = comboRef.current + 1
      comboRef.current = currentCombo
      setCombo(currentCombo)
      if (currentCombo > maxComboRef.current) {
        maxComboRef.current = currentCombo
        setMaxCombo(currentCombo)
      }

      if (grade === 'perfect') {
        perfectStreakRef.current += 1
        setPerfectStreak(perfectStreakRef.current)
      } else {
        perfectStreakRef.current = 0
        setPerfectStreak(0)
      }

      // Chain bonus — same direction streak
      if (chainDirRef.current === direction) {
        chainCountRef.current += 1
      } else {
        chainDirRef.current = direction
        chainCountRef.current = 1
      }
      setChainDir(chainDirRef.current)
      setChainCount(chainCountRef.current)
      const chainBonus = chainCountRef.current >= 3 ? Math.floor(chainCountRef.current / 3) * 2 : 0
      if (chainCountRef.current >= 3 && chainCountRef.current % 3 === 0) {
        playAudio('chain', 0.5, 1 + chainCountRef.current * 0.05)
        effects.triggerFlash(`rgba(${direction === 'up' ? '255,51,119' : direction === 'down' ? '51,187,255' : direction === 'left' ? '51,255,119' : '255,204,51'},0.3)`)
      }

      const comboBonus = currentCombo >= COMBO_BONUS_THRESHOLD
        ? Math.floor(basePoints * COMBO_BONUS_MULTIPLIER * Math.floor(currentCombo / COMBO_BONUS_THRESHOLD))
        : 0
      const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
      const specialMult = isBoss ? BOSS_MULTIPLIER : isRainbow ? RAINBOW_MULTIPLIER : 1
      const totalPoints = (basePoints + comboBonus + chainBonus) * feverMult * specialMult
      scoreRef.current += totalPoints
      setScore(scoreRef.current)

      // Fever
      if (currentCombo >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
        feverRef.current = true
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setIsFever(true)
        setFeverRemainingMs(FEVER_DURATION_MS)
        effects.triggerFlash('rgba(255,255,0,0.5)')
        playAudio('fever', 0.6)
      }

      // Freeze
      if (currentCombo >= FREEZE_COMBO_THRESHOLD && !freezeRef.current && currentCombo % FREEZE_COMBO_THRESHOLD === 0) {
        freezeRef.current = true
        freezeRemainingMsRef.current = FREEZE_DURATION_MS
        setIsFreeze(true)
        effects.triggerFlash('rgba(0,128,255,0.5)')
      }

      // Combo milestone
      if (currentCombo >= 10 && currentCombo % 10 === 0 && currentCombo > comboMilestoneRef.current) {
        comboMilestoneRef.current = currentCombo
        playAudio('combo', 0.5, 1 + (currentCombo / 50) * 0.3)
      }

      addFeedback(grade, direction)
      const dirIndex = DIRECTIONS.indexOf(direction)
      const hitX = 60 + dirIndex * 80

      if (grade === 'perfect') {
        playAudio('perfect', 0.55, 1 + currentCombo * 0.008)
        effects.comboHitBurst(hitX, 100, currentCombo, totalPoints)
      } else {
        playAudio('good', 0.45, 1 + currentCombo * 0.006)
        effects.spawnParticles(3, hitX, 100)
        effects.showScorePopup(totalPoints, hitX, 80)
      }

      if (isBoss) {
        effects.triggerFlash('rgba(255,0,255,0.5)')
        effects.spawnParticles(12, hitX, 100)
        effects.triggerShake(6)
      } else if (isRainbow) {
        effects.triggerFlash('rgba(168,85,247,0.4)')
        effects.spawnParticles(8, hitX, 100)
      }
    },
    [addFeedback, playAudio],
  )

  const handleDirectionInput = useCallback(
    (direction: Direction) => {
      if (finishedRef.current) return
      const currentArrows = arrowsRef.current
      const now = elapsedMsRef.current
      let bestArrow: FallingArrow | null = null
      let bestDistance = Infinity

      for (const arrow of currentArrows) {
        if (arrow.consumed || arrow.direction !== direction) continue
        const yPercent = computeArrowYPercent(now - arrow.spawnedAtMs, ARROW_TRAVEL_DURATION_MS)
        const dist = Math.abs(yPercent - TARGET_LINE_Y_PERCENT)
        if (dist < bestDistance) { bestDistance = dist; bestArrow = arrow }
      }

      if (!bestArrow) { applyHit('miss', direction, false, false); return }

      const targetAge = ARROW_TRAVEL_DURATION_MS * ((100 - TARGET_LINE_Y_PERCENT) / 100)
      const timeDiff = Math.abs((now - bestArrow.spawnedAtMs) - targetAge)
      const { isRainbow, isBoss } = bestArrow
      bestArrow.consumed = true
      arrowsRef.current = currentArrows.filter((a) => a.id !== bestArrow!.id)
      setArrows([...arrowsRef.current])

      if (timeDiff <= PERFECT_WINDOW_MS) applyHit('perfect', direction, isRainbow, isBoss)
      else if (timeDiff <= GOOD_WINDOW_MS) applyHit('good', direction, isRainbow, isBoss)
      else applyHit('miss', direction, false, false)
    },
    [applyHit],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    playAudio('gameover', 0.6, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)) })
  }, [onFinish, playAudio])

  useEffect(() => {
    const srcs: Record<string, string> = {
      perfect: dsPerfectSfx, good: dsGoodSfx, miss: dsMissSfx,
      fever: dsFeverSfx, combo: dsComboSfx, timewarn: dsTimeWarnSfx,
      levelup: dsLevelUpSfx, chain: dsChainSfx, gameover: gameOverHitSfx,
    }
    for (const [key, src] of Object.entries(srcs)) {
      const a = new Audio(src); a.preload = 'auto'; audioRefs.current[key] = a
    }
    return () => { audioRefs.current = {}; effects.cleanup() }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      const dir = DIRECTION_KEY_MAP[e.code]
      if (dir) { e.preventDefault(); handleDirectionInput(dir) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleDirectionInput, onExit])

  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const rawDelta = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const deltaMs = freezeRef.current ? rawDelta * 0.3 : rawDelta
      elapsedMsRef.current += deltaMs
      remainingMsRef.current = Math.max(0, remainingMsRef.current - rawDelta)
      setRemainingMs(remainingMsRef.current)

      // Low time
      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== sec) { lowTimeSecondRef.current = sec; playAudio('timewarn', 0.3, 1.2) }
      } else lowTimeSecondRef.current = null

      // Fever timer
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - rawDelta)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      // Freeze timer
      if (freezeRef.current) {
        freezeRemainingMsRef.current = Math.max(0, freezeRemainingMsRef.current - rawDelta)
        if (freezeRemainingMsRef.current <= 0) { freezeRef.current = false; setIsFreeze(false) }
      }

      // Speed level
      const sl = Math.min(5, 1 + Math.floor(elapsedMsRef.current / SPEED_LEVEL_INTERVAL_MS))
      if (sl !== lastSpeedLevelRef.current) {
        lastSpeedLevelRef.current = sl
        setSpeedLevel(sl)
        playAudio('levelup', 0.4, 0.9 + sl * 0.1)
        effects.triggerFlash('rgba(255,255,255,0.2)')
      }

      // Spawn
      const spawnInterval = computeSpawnInterval(elapsedMsRef.current)
      if (elapsedMsRef.current - lastSpawnAtRef.current >= spawnInterval) {
        const direction = pickRandomDirection(lastDirectionRef.current)
        lastDirectionRef.current = direction
        const elapsed = elapsedMsRef.current
        const isBoss = elapsed > BOSS_ARROW_ELAPSED_MS && Math.random() < BOSS_ARROW_CHANCE
        const isRainbow = !isBoss && elapsed > RAINBOW_ARROW_ELAPSED_MS && Math.random() < RAINBOW_ARROW_CHANCE

        arrowsRef.current = [...arrowsRef.current, {
          id: nextArrowIdRef.current++, direction, spawnedAtMs: elapsed, isRainbow, isBoss, consumed: false,
        }]

        if (elapsed > DOUBLE_ARROW_ELAPSED_MS && Math.random() < DOUBLE_ARROW_CHANCE) {
          arrowsRef.current = [...arrowsRef.current, {
            id: nextArrowIdRef.current++, direction: pickRandomDirection(direction), spawnedAtMs: elapsed, isRainbow: false, isBoss: false, consumed: false,
          }]
        }
        lastSpawnAtRef.current = elapsed
      }

      // Expire
      const expThresh = ARROW_TRAVEL_DURATION_MS * 1.15
      const missed: FallingArrow[] = []
      const surviving: FallingArrow[] = []
      for (const a of arrowsRef.current) {
        const age = elapsedMsRef.current - a.spawnedAtMs
        if (!a.consumed && age > expThresh) missed.push(a)
        else if (age <= expThresh || a.consumed) surviving.push(a)
      }
      for (const m of missed) {
        scoreRef.current = Math.max(0, scoreRef.current + SCORE_MISS)
        setScore(scoreRef.current)
        comboRef.current = 0; setCombo(0)
        perfectStreakRef.current = 0; setPerfectStreak(0)
        feedbacksRef.current = [...feedbacksRef.current, { grade: 'miss' as HitGrade, direction: m.direction, expiresAtMs: elapsedMsRef.current + FEEDBACK_DURATION_MS }]
      }
      arrowsRef.current = surviving
      setArrows([...surviving])

      const af = feedbacksRef.current.filter((fb) => fb.expiresAtMs > elapsedMsRef.current)
      if (af.length !== feedbacksRef.current.length) { feedbacksRef.current = af; setFeedbacks(af) }
      effects.updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => { if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }; lastFrameAtRef.current = null }
  }, [finishGame, playAudio])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const latestFeedback = feedbacks.length > 0 ? feedbacks[feedbacks.length - 1] : null

  return (
    <section className={`mini-game-panel ds-panel ${isFever ? 'ds-fever' : ''} ${isFreeze ? 'ds-freeze' : ''}`} aria-label="dance-step-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .ds-panel {
          display: flex; flex-direction: column; height: 100%;
          background: #0a0a0a;
          font-family: 'Press Start 2P', monospace;
          user-select: none; -webkit-user-select: none;
          touch-action: manipulation;
          position: relative; overflow: hidden;
          image-rendering: pixelated;
        }

        .ds-panel::before {
          content: ''; position: absolute; inset: 0; z-index: 50; pointer-events: none;
          background: repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 3px);
          mix-blend-mode: multiply;
        }

        .ds-panel.ds-fever { background: #1a0a00; animation: ds-fever-flash 0.4s steps(2) infinite; }
        .ds-panel.ds-freeze { background: #000a1a; }

        @keyframes ds-fever-flash {
          0% { background: #1a0a00; }
          50% { background: #0a0a0a; }
        }

        .ds-hdr {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 8px; border-bottom: 3px solid #333; flex-shrink: 0;
          background: #111;
        }
        .ds-hdr-left { display: flex; align-items: center; gap: 6px; }
        .ds-avatar {
          width: 32px; height: 32px; border: 2px solid #ff3377;
          image-rendering: pixelated; object-fit: cover;
        }
        .ds-score { font-size: 16px; color: #ff3377; margin: 0; line-height: 1.2; }
        .ds-best { font-size: 6px; color: #884466; margin: 0; }
        .ds-hdr-right { text-align: right; }
        .ds-time { font-size: 14px; color: #eee; margin: 0; font-variant-numeric: tabular-nums; }
        .ds-time.low { color: #ff3333; animation: ds-blink 0.5s steps(2) infinite; }
        @keyframes ds-blink { 50% { opacity: 0; } }
        .ds-spd { font-size: 7px; color: #ff3377; padding: 1px 4px; border: 1px solid #ff3377; margin-top: 2px; display: inline-block; }

        .ds-status {
          display: flex; justify-content: center; align-items: center; gap: 8px;
          padding: 3px 8px; font-size: 7px; color: #aaa; flex-shrink: 0;
          border-bottom: 2px solid #222;
        }
        .ds-status p { margin: 0; }
        .ds-status strong { color: #fff; }
        .ds-fever-tag { color: #ffcc00; animation: ds-blink 0.3s steps(2) infinite; }
        .ds-freeze-tag { color: #33bbff; animation: ds-blink 0.4s steps(2) infinite; }
        .ds-chain-tag { font-size: 7px; font-weight: 700; }

        .ds-fb-row { min-height: 22px; text-align: center; flex-shrink: 0; padding: 2px 0; }
        .ds-fb {
          font-size: 14px; animation: ds-fb-pop 0.3s steps(4) forwards;
          display: inline-block;
        }
        .ds-fb.perfect { color: #33ff77; }
        .ds-fb.good { color: #ffcc33; }
        .ds-fb.miss { color: #ff3333; }
        @keyframes ds-fb-pop {
          0% { transform: scale(1.5); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .ds-streak { font-size: 7px; color: #33ff77; margin-left: 4px; }

        .ds-arena {
          position: relative; flex: 1; margin: 0 4px;
          background:
            repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 25%),
            repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 20px),
            #0a0a0a;
          border: 3px solid #333; overflow: hidden; min-height: 0;
        }

        .ds-target {
          position: absolute; left: 0; right: 0; height: 4px; z-index: 2; pointer-events: none;
          background: #ff3377;
          box-shadow: 0 0 8px #ff3377, 0 0 16px rgba(255,51,119,0.3);
        }

        .ds-arrow {
          position: absolute; pointer-events: none; z-index: 1;
          font-size: 28px; font-weight: 900;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.8);
          transition: none;
        }

        .ds-arrow.near { animation: ds-arrow-pulse 0.2s steps(2) infinite; }
        @keyframes ds-arrow-pulse { 50% { filter: brightness(1.8); } }

        .ds-arrow.rainbow {
          animation: ds-rainbow 0.3s steps(4) infinite;
        }
        @keyframes ds-rainbow {
          0% { color: #ff3377; } 25% { color: #33bbff; } 50% { color: #33ff77; } 75% { color: #ffcc33; }
        }

        .ds-arrow.boss {
          font-size: 42px;
          animation: ds-boss-glow 0.3s steps(3) infinite;
          filter: drop-shadow(0 0 6px #ff00ff);
        }
        @keyframes ds-boss-glow {
          0% { color: #ff00ff; } 33% { color: #ff33ff; } 66% { color: #cc00cc; }
        }

        .ds-lane-label {
          position: absolute; transform: translateX(-50%);
          font-size: 16px; opacity: 0.08; bottom: 6px;
        }

        .ds-btns {
          display: flex; gap: 4px; padding: 6px 4px; flex-shrink: 0;
        }

        .ds-btn {
          flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px;
          padding: 12px 2px; border: 3px solid; background: #111;
          cursor: pointer; transition: none;
          -webkit-tap-highlight-color: transparent; touch-action: manipulation;
          font-family: 'Press Start 2P', monospace;
        }

        .ds-btn:active {
          filter: brightness(2); transform: scale(0.92);
          box-shadow: inset 0 0 0 2px rgba(255,255,255,0.3);
        }

        .ds-btn-sym { font-size: 22px; }
        .ds-btn-lbl { font-size: 6px; opacity: 0.5; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="ds-hdr">
        <div className="ds-hdr-left">
          <img className="ds-avatar" src={characterImage} alt="" />
          <div>
            <p className="ds-score">{score.toLocaleString()}</p>
            <p className="ds-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="ds-hdr-right">
          <p className={`ds-time ${isLowTime ? 'low' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <span className="ds-spd">LV.{speedLevel}</span>
        </div>
      </div>

      <div className="ds-status">
        <p>COMBO <strong>{combo}</strong>{comboLabel && <span style={{ color: comboColor, marginLeft: 4 }}>{comboLabel}</span>}</p>
        <p>MAX <strong>{maxCombo}</strong></p>
        {isFever && <span className="ds-fever-tag">FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</span>}
        {isFreeze && <span className="ds-freeze-tag">FREEZE!</span>}
        {chainCount >= 3 && chainDir && (
          <span className="ds-chain-tag" style={{ color: DIRECTION_COLORS[chainDir] }}>CHAIN x{chainCount}</span>
        )}
      </div>

      <div className="ds-fb-row">
        {latestFeedback && (
          <span className={`ds-fb ${latestFeedback.grade}`}>
            {latestFeedback.grade === 'perfect' ? 'PERFECT!' : latestFeedback.grade === 'good' ? 'GOOD' : 'MISS'}
            {perfectStreak >= 3 && latestFeedback.grade === 'perfect' && <span className="ds-streak">x{perfectStreak}</span>}
          </span>
        )}
      </div>

      <div className="ds-arena">
        <div className="ds-target" style={{ top: `${TARGET_LINE_Y_PERCENT}%` }} />

        {arrows.map((arrow) => {
          const age = elapsedMsRef.current - arrow.spawnedAtMs
          const y = computeArrowYPercent(age, ARROW_TRAVEL_DURATION_MS)
          if (y < -10 || y > 110) return null
          const li = DIRECTIONS.indexOf(arrow.direction)
          const near = Math.abs(y - TARGET_LINE_Y_PERCENT) < 8
          return (
            <div
              key={arrow.id}
              className={`ds-arrow ${arrow.direction} ${near ? 'near' : ''} ${arrow.isRainbow ? 'rainbow' : ''} ${arrow.isBoss ? 'boss' : ''}`}
              style={{
                top: `${y}%`, left: `${12.5 + li * 25}%`,
                color: arrow.isBoss ? '#ff00ff' : arrow.isRainbow ? undefined : DIRECTION_COLORS[arrow.direction],
                transform: `translate(-50%, -50%) scale(${near ? 1.2 : 1})`,
                opacity: y < TARGET_LINE_Y_PERCENT ? 0.35 : 1,
              }}
            >
              {arrow.isBoss ? '\u2605' : DIRECTION_SYMBOLS[arrow.direction]}
            </div>
          )
        })}

        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, display: 'flex', pointerEvents: 'none', zIndex: 3 }}>
          {DIRECTIONS.map((dir, i) => (
            <div key={dir} className="ds-lane-label" style={{ left: `${12.5 + i * 25}%`, color: DIRECTION_COLORS[dir], position: 'absolute' }}>
              {DIRECTION_SYMBOLS[dir]}
            </div>
          ))}
        </div>
      </div>

      <div className="ds-btns">
        {DIRECTIONS.map((dir) => (
          <button key={dir} className="ds-btn" type="button"
            onPointerDown={(e) => { e.preventDefault(); handleDirectionInput(dir) }}
            style={{ borderColor: DIRECTION_COLORS[dir], color: DIRECTION_COLORS[dir] }}
          >
            <span className="ds-btn-sym">{DIRECTION_SYMBOLS[dir]}</span>
            <span className="ds-btn-lbl">{dir.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export const danceStepModule: MiniGameModule = {
  manifest: {
    id: 'dance-step',
    title: 'Dance Step',
    description: 'Tap arrows in order! DDR-style dance!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#ff3377',
  },
  Component: DanceStepGame,
}
