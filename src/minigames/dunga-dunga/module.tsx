import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'

import moleNormalImg from '../../../assets/images/dunga-dunga/mole-normal.png'
import moleGoldenImg from '../../../assets/images/dunga-dunga/mole-golden.png'
import moleBombImg from '../../../assets/images/dunga-dunga/mole-bomb.png'
import moleFreezeImg from '../../../assets/images/dunga-dunga/mole-freeze.png'
import holeImg from '../../../assets/images/dunga-dunga/hole.png'
import hammerSprite from '../../../assets/images/dunga-dunga/hammer.png'

import whackHitSfx from '../../../assets/sounds/dunga-dunga/whack-hit.mp3'
import goldenHitSfx from '../../../assets/sounds/dunga-dunga/golden-hit.mp3'
import bombHitSfx from '../../../assets/sounds/dunga-dunga/bomb-hit.mp3'
import freezeHitSfx from '../../../assets/sounds/dunga-dunga/freeze-hit.mp3'
import feverStartSfx from '../../../assets/sounds/dunga-dunga/fever-start.mp3'
import molePopSfx from '../../../assets/sounds/dunga-dunga/mole-pop.mp3'
import comboSfx from '../../../assets/sounds/dunga-dunga/combo.mp3'
import moleEscapeSfx from '../../../assets/sounds/dunga-dunga/mole-escape.mp3'

/* ── Constants ── */
const GRID_COLS = 3
const GRID_ROWS = 3
const HOLE_COUNT = GRID_COLS * GRID_ROWS

const GAME_DURATION_MS = 30_000
const NORMAL_SCORE = 1
const GOLDEN_SCORE = 10
const GOLDEN_TIME_BONUS_MS = 3_000
const BOMB_PENALTY = -5
const FREEZE_DURATION_MS = 3_000

const FEVER_MAX = 100
const FEVER_PER_HIT = 15
const FEVER_DECAY_RATE = 6
const FEVER_DURATION_MS = 6_000

const BASE_SPAWN_INTERVAL_MS = 1000
const FEVER_SPAWN_INTERVAL_MS = 500
const MIN_SPAWN_INTERVAL_MS = 550
const BASE_MAX_ACTIVE = 2
const FEVER_MAX_ACTIVE = 5

const GOLDEN_CHANCE = 0.08
const GOLDEN_CHANCE_FEVER = 0.2
const BOMB_CHANCE = 0.12
const FREEZE_CHANCE = 0.06

const MOLE_SHOW_DURATION_MS = 1400
const MOLE_SHOW_DURATION_FEVER_MS = 900
const MIN_SHOW_DURATION_MS = 700

const PARTICLE_LIFETIME_MS = 600
const PARTICLE_COUNT_NORMAL = 8
const PARTICLE_COUNT_GOLDEN = 14
const PARTICLE_COUNT_BOMB = 10
const SHAKE_DURATION_MS = 150
const SHAKE_INTENSITY = 5
const GOLDEN_SHAKE_INTENSITY = 10
const BOMB_SHAKE_INTENSITY = 14
const HAMMER_DURATION_MS = 350

const COMBO_MULTIPLIER_THRESHOLDS = [
  { combo: 20, mult: 4 },
  { combo: 10, mult: 3 },
  { combo: 5, mult: 2 },
]

/* ── Types ── */
type MoleType = 'normal' | 'golden' | 'bomb' | 'freeze'

const MOLE_ASSETS: Record<MoleType, string> = {
  normal: moleNormalImg,
  golden: moleGoldenImg,
  bomb: moleBombImg,
  freeze: moleFreezeImg,
}

const HIT_COLORS = ['#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4', '#22c55e'] as const
const GOLDEN_COLORS = ['#fbbf24', '#fde68a', '#fff', '#f59e0b', '#fcd34d', '#fffbeb'] as const
const BOMB_COLORS = ['#ef4444', '#dc2626', '#991b1b', '#fca5a5', '#7f1d1d', '#f87171'] as const
const FREEZE_COLORS = ['#38bdf8', '#7dd3fc', '#bae6fd', '#0ea5e9', '#e0f2fe', '#fff'] as const

interface Mole {
  readonly id: number
  readonly holeIndex: number
  readonly type: MoleType
  readonly spawnedAtMs: number
  readonly durationMs: number
  hit: boolean
  hitAtMs: number
  escaped: boolean
}

interface Particle {
  readonly id: number
  readonly holeIndex: number
  readonly angle: number
  readonly speed: number
  readonly size: number
  readonly color: string
  readonly createdAtMs: number
}

interface HammerStrike {
  readonly id: number
  readonly holeIndex: number
  readonly createdAtMs: number
  readonly moleType: MoleType
}

interface HitFeedback {
  readonly id: number
  readonly holeIndex: number
  readonly text: string
  readonly moleType: MoleType
  readonly createdAtMs: number
}

interface GameModel {
  elapsedMs: number
  remainingMs: number
  score: number
  fever: number
  isFeverActive: boolean
  feverRemainingMs: number
  lastSpawnAtMs: number
  nextMoleId: number
  moles: Mole[]
  comboCount: number
  maxCombo: number
  hitFeedbacks: HitFeedback[]
  nextFeedbackId: number
  particles: Particle[]
  nextParticleId: number
  shakeUntilMs: number
  shakeIntensity: number
  lastComboPopMs: number
  hammerStrikes: HammerStrike[]
  nextHammerId: number
  isFrozen: boolean
  frozenUntilMs: number
  totalHits: number
  totalMisses: number
  bombsHit: number
}

interface RenderState {
  readonly elapsedMs: number
  readonly remainingMs: number
  readonly score: number
  readonly fever: number
  readonly isFeverActive: boolean
  readonly moles: readonly Mole[]
  readonly hitFeedbacks: readonly HitFeedback[]
  readonly particles: readonly Particle[]
  readonly hammerStrikes: readonly HammerStrike[]
  readonly comboCount: number
  readonly maxCombo: number
  readonly shakeX: number
  readonly shakeY: number
  readonly lastComboPopMs: number
  readonly isFrozen: boolean
  readonly totalHits: number
  readonly totalMisses: number
}

/* ── Sound helpers ── */
function playSfx(src: string, vol = 0.5) {
  try {
    const a = new Audio(src)
    a.volume = vol
    a.play().catch(() => {})
  } catch {}
}

/* ── Pure logic ── */
function createInitialModel(): GameModel {
  return {
    elapsedMs: 0,
    remainingMs: GAME_DURATION_MS,
    score: 0,
    fever: 0,
    isFeverActive: false,
    feverRemainingMs: 0,
    lastSpawnAtMs: 0,
    nextMoleId: 0,
    moles: [],
    comboCount: 0,
    maxCombo: 0,
    hitFeedbacks: [],
    nextFeedbackId: 0,
    particles: [],
    nextParticleId: 0,
    shakeUntilMs: 0,
    shakeIntensity: 0,
    lastComboPopMs: -9999,
    hammerStrikes: [],
    nextHammerId: 0,
    isFrozen: false,
    frozenUntilMs: 0,
    totalHits: 0,
    totalMisses: 0,
    bombsHit: 0,
  }
}

function buildRenderState(model: GameModel): RenderState {
  let shakeX = 0
  let shakeY = 0
  if (model.elapsedMs < model.shakeUntilMs) {
    const t = (model.shakeUntilMs - model.elapsedMs) / SHAKE_DURATION_MS
    const intensity = model.shakeIntensity * t
    shakeX = (Math.random() - 0.5) * 2 * intensity
    shakeY = (Math.random() - 0.5) * 2 * intensity
  }
  return {
    elapsedMs: model.elapsedMs,
    remainingMs: model.remainingMs,
    score: model.score,
    fever: model.fever,
    isFeverActive: model.isFeverActive,
    moles: model.moles,
    hitFeedbacks: model.hitFeedbacks,
    particles: model.particles,
    hammerStrikes: model.hammerStrikes,
    comboCount: model.comboCount,
    maxCombo: model.maxCombo,
    shakeX,
    shakeY,
    lastComboPopMs: model.lastComboPopMs,
    isFrozen: model.isFrozen,
    totalHits: model.totalHits,
    totalMisses: model.totalMisses,
  }
}

function getOccupiedHoles(moles: Mole[]): Set<number> {
  const s = new Set<number>()
  for (const m of moles) if (!m.hit && !m.escaped) s.add(m.holeIndex)
  return s
}

function getComboMultiplier(combo: number): number {
  for (const t of COMBO_MULTIPLIER_THRESHOLDS) {
    if (combo >= t.combo) return t.mult
  }
  return 1
}

function getDifficultyFactor(elapsedMs: number): number {
  return Math.min(1, elapsedMs / GAME_DURATION_MS)
}

function spawnParticles(model: GameModel, holeIndex: number, type: MoleType): void {
  const countMap: Record<MoleType, number> = {
    normal: PARTICLE_COUNT_NORMAL,
    golden: PARTICLE_COUNT_GOLDEN,
    bomb: PARTICLE_COUNT_BOMB,
    freeze: PARTICLE_COUNT_NORMAL,
  }
  const colorMap: Record<MoleType, readonly string[]> = {
    normal: HIT_COLORS,
    golden: GOLDEN_COLORS,
    bomb: BOMB_COLORS,
    freeze: FREEZE_COLORS,
  }
  const count = countMap[type]
  const colors = colorMap[type]
  for (let i = 0; i < count; i++) {
    model.particles.push({
      id: model.nextParticleId,
      holeIndex,
      angle: (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5,
      speed: 40 + Math.random() * 60 + (type === 'golden' ? 30 : type === 'bomb' ? 20 : 0),
      size: 3 + Math.random() * 5 + (type === 'golden' ? 2 : 0),
      color: colors[Math.floor(Math.random() * colors.length)],
      createdAtMs: model.elapsedMs,
    })
    model.nextParticleId += 1
  }
}

function pickMoleType(model: GameModel): MoleType {
  const r = Math.random()
  const goldenChance = model.isFeverActive ? GOLDEN_CHANCE_FEVER : GOLDEN_CHANCE
  if (r < goldenChance) return 'golden'
  if (r < goldenChance + BOMB_CHANCE) return 'bomb'
  if (r < goldenChance + BOMB_CHANCE + FREEZE_CHANCE) return 'freeze'
  return 'normal'
}

function spawnMole(model: GameModel): void {
  const diff = getDifficultyFactor(model.elapsedMs)
  const maxActive = model.isFeverActive
    ? FEVER_MAX_ACTIVE
    : Math.min(BASE_MAX_ACTIVE + Math.floor(diff * 3), 5)
  const activeMoles = model.moles.filter((m) => !m.hit && !m.escaped)
  if (activeMoles.length >= maxActive) return

  const occupied = getOccupiedHoles(model.moles)
  const available: number[] = []
  for (let i = 0; i < HOLE_COUNT; i++) {
    if (!occupied.has(i)) available.push(i)
  }
  if (available.length === 0) return

  const holeIndex = available[Math.floor(Math.random() * available.length)]
  const type = pickMoleType(model)

  const baseDuration = model.isFeverActive ? MOLE_SHOW_DURATION_FEVER_MS : MOLE_SHOW_DURATION_MS
  const durationMs = Math.max(MIN_SHOW_DURATION_MS, baseDuration - diff * 400)

  model.moles.push({
    id: model.nextMoleId,
    holeIndex,
    type,
    spawnedAtMs: model.elapsedMs,
    durationMs,
    hit: false,
    hitAtMs: 0,
    escaped: false,
  })
  model.nextMoleId += 1
  playSfx(molePopSfx, 0.2)
}

/* ── Component ── */
function DungaDungaGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const initialModel = useMemo(() => createInitialModel(), [])
  const modelRef = useRef<GameModel>(initialModel)
  const [renderState, setRenderState] = useState<RenderState>(() => buildRenderState(initialModel))
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)

  const finishRound = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    const model = modelRef.current
    setRenderState(buildRenderState(model))
    onFinish({
      score: Math.max(0, model.score),
      durationMs: Math.max(Math.round(model.elapsedMs), Math.round(DEFAULT_FRAME_MS)),
    })
  }, [onFinish])

  const handleWhack = useCallback((moleId: number) => {
    const model = modelRef.current
    if (finishedRef.current) return

    const mole = model.moles.find((m) => m.id === moleId)
    if (!mole || mole.hit || mole.escaped) return

    mole.hit = true
    mole.hitAtMs = model.elapsedMs

    // Hammer strike
    model.hammerStrikes.push({
      id: model.nextHammerId,
      holeIndex: mole.holeIndex,
      createdAtMs: model.elapsedMs,
      moleType: mole.type,
    })
    model.nextHammerId += 1

    // Particles
    spawnParticles(model, mole.holeIndex, mole.type)

    let feedbackText = ''

    if (mole.type === 'bomb') {
      // Bomb: penalty
      model.score += BOMB_PENALTY
      model.comboCount = 0
      model.bombsHit += 1
      model.shakeUntilMs = model.elapsedMs + SHAKE_DURATION_MS * 2
      model.shakeIntensity = BOMB_SHAKE_INTENSITY
      feedbackText = `${BOMB_PENALTY} BOOM!`
      playSfx(bombHitSfx, 0.6)
    } else if (mole.type === 'freeze') {
      // Freeze: stop timer
      model.isFrozen = true
      model.frozenUntilMs = model.elapsedMs + FREEZE_DURATION_MS
      model.comboCount += 1
      model.totalHits += 1
      model.shakeUntilMs = model.elapsedMs + SHAKE_DURATION_MS
      model.shakeIntensity = SHAKE_INTENSITY
      feedbackText = 'FREEZE!'
      playSfx(freezeHitSfx, 0.5)
    } else if (mole.type === 'golden') {
      // Golden: big score + time bonus
      const mult = getComboMultiplier(model.comboCount)
      const pts = GOLDEN_SCORE * mult
      model.score += pts
      model.comboCount += 1
      model.totalHits += 1
      model.remainingMs += GOLDEN_TIME_BONUS_MS
      model.shakeUntilMs = model.elapsedMs + SHAKE_DURATION_MS
      model.shakeIntensity = GOLDEN_SHAKE_INTENSITY
      feedbackText = `+${pts} +3s`
      playSfx(goldenHitSfx, 0.6)
    } else {
      // Normal
      const mult = getComboMultiplier(model.comboCount)
      const pts = NORMAL_SCORE * mult
      model.score += pts
      model.comboCount += 1
      model.totalHits += 1
      model.shakeUntilMs = model.elapsedMs + SHAKE_DURATION_MS
      model.shakeIntensity = SHAKE_INTENSITY
      feedbackText = mult > 1 ? `+${pts} x${mult}` : `+${pts}`
      playSfx(whackHitSfx, 0.45)
    }

    // Track max combo
    if (model.comboCount > model.maxCombo) {
      model.maxCombo = model.comboCount
    }

    // Fever gauge (only for non-bomb)
    if (mole.type !== 'bomb') {
      model.fever = Math.min(FEVER_MAX, model.fever + FEVER_PER_HIT)
      if (model.fever >= FEVER_MAX && !model.isFeverActive) {
        model.isFeverActive = true
        model.feverRemainingMs = FEVER_DURATION_MS
        playSfx(feverStartSfx, 0.6)
      }
    }

    // Combo pop
    if (model.comboCount >= 5 && model.comboCount % 5 === 0) {
      model.lastComboPopMs = model.elapsedMs
      playSfx(comboSfx, 0.5)
    }

    // Hit feedback
    model.hitFeedbacks.push({
      id: model.nextFeedbackId,
      holeIndex: mole.holeIndex,
      text: feedbackText,
      moleType: mole.type,
      createdAtMs: model.elapsedMs,
    })
    model.nextFeedbackId += 1

    setRenderState(buildRenderState(model))
  }, [])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) {
        lastFrameAtRef.current = now
      }

      const rawDelta = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const model = modelRef.current
      const deltaSec = rawDelta / 1000

      model.elapsedMs += rawDelta

      // Freeze logic: timer doesn't tick down while frozen
      if (model.isFrozen) {
        if (model.elapsedMs >= model.frozenUntilMs) {
          model.isFrozen = false
        }
      } else {
        model.remainingMs -= rawDelta
      }

      if (model.remainingMs <= 0) {
        model.remainingMs = 0
        finishRound()
        return
      }

      // Fever decay
      if (!model.isFeverActive) {
        model.fever = Math.max(0, model.fever - FEVER_DECAY_RATE * deltaSec)
      } else {
        model.feverRemainingMs -= rawDelta
        if (model.feverRemainingMs <= 0) {
          model.isFeverActive = false
          model.feverRemainingMs = 0
          model.fever = 0
        }
      }

      // Clean up moles (track escapes)
      model.moles = model.moles.filter((mole) => {
        if (mole.hit) return model.elapsedMs - mole.hitAtMs < 300
        if (mole.escaped) return false
        const age = model.elapsedMs - mole.spawnedAtMs
        if (age >= mole.durationMs) {
          // Mole escaped
          if (mole.type === 'normal' || mole.type === 'golden') {
            model.totalMisses += 1
            model.comboCount = 0
          }
          mole.escaped = true
          playSfx(moleEscapeSfx, 0.15)
          return false
        }
        return true
      })

      // Spawn moles
      const diff = getDifficultyFactor(model.elapsedMs)
      const baseInterval = model.isFeverActive ? FEVER_SPAWN_INTERVAL_MS : BASE_SPAWN_INTERVAL_MS
      const spawnInterval = Math.max(MIN_SPAWN_INTERVAL_MS, baseInterval - diff * 300)
      if (model.elapsedMs - model.lastSpawnAtMs >= spawnInterval) {
        spawnMole(model)
        if (model.isFeverActive && Math.random() < 0.5) {
          spawnMole(model)
        }
        model.lastSpawnAtMs = model.elapsedMs
      }

      // Clean particles / feedbacks / hammers
      model.hitFeedbacks = model.hitFeedbacks.filter(
        (fb) => model.elapsedMs - fb.createdAtMs < 800
      )
      model.particles = model.particles.filter(
        (p) => model.elapsedMs - p.createdAtMs < PARTICLE_LIFETIME_MS
      )
      model.hammerStrikes = model.hammerStrikes.filter(
        (h) => model.elapsedMs - h.createdAtMs < HAMMER_DURATION_MS
      )

      setRenderState(buildRenderState(model))
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
  }, [finishRound])

  const displayedBestScore = Math.max(bestScore, renderState.score)
  const timerSec = Math.max(0, Math.ceil(renderState.remainingMs / 1000))
  const feverPercent = Math.min(100, (renderState.fever / FEVER_MAX) * 100)
  const isUrgent = timerSec <= 5
  const comboPopAge = renderState.elapsedMs - renderState.lastComboPopMs
  const showComboPop = comboPopAge < 800
  const comboMult = getComboMultiplier(renderState.comboCount)

  return (
    <section className="mini-game-panel dd-panel" aria-label="dunga-dunga-game">
      <div
        className={`dd-stage ${renderState.isFrozen ? 'frozen' : ''}`}
        style={{
          transform: `translate(${renderState.shakeX}px, ${renderState.shakeY}px)`,
        }}
      >
        {/* ── Score (centered, big) ── */}
        <div className="dd-score-center">
          <span className="dd-score-value">{renderState.score}</span>
          {comboMult > 1 && (
            <span className="dd-score-mult">x{comboMult}</span>
          )}
        </div>

        {/* ── HUD row: timer left, combo/best right ── */}
        <div className="dd-hud">
          <div className="dd-timer-block">
            <span className={`dd-timer ${isUrgent ? 'urgent' : ''}`}>{timerSec}</span>
            <span className="dd-timer-unit">s</span>
          </div>
          <div className="dd-info-block">
            {renderState.comboCount >= 3 && (
              <span className="dd-combo-badge">{renderState.comboCount} COMBO</span>
            )}
            <span className="dd-best">BEST {displayedBestScore}</span>
          </div>
        </div>

        {/* ── Fever bar ── */}
        <div className="dd-fever-bar-wrap">
          <div
            className={`dd-fever-bar ${renderState.isFeverActive ? 'active' : ''}`}
            style={{ width: `${feverPercent}%` }}
          />
          <span className="dd-fever-label">
            {renderState.isFeverActive ? 'FEVER!' : renderState.isFrozen ? 'FROZEN!' : 'FEVER'}
          </span>
        </div>

        {/* ── Combo pop ── */}
        {showComboPop && renderState.comboCount >= 5 && (
          <div
            className={`dd-combo-pop ${renderState.comboCount >= 15 ? 'mega' : renderState.comboCount >= 10 ? 'super' : ''}`}
            style={{ opacity: Math.max(0, 1 - comboPopAge / 800) }}
          >
            {renderState.comboCount}x COMBO!
          </div>
        )}

        {/* ── Grid (3x3) ── */}
        <div className="dd-grid">
          {Array.from({ length: HOLE_COUNT }, (_, holeIndex) => {
            const mole = renderState.moles.find(
              (m) => m.holeIndex === holeIndex && !m.escaped
            )
            const feedback = renderState.hitFeedbacks.find(
              (fb) => fb.holeIndex === holeIndex
            )
            const holeParticles = renderState.particles.filter(
              (p) => p.holeIndex === holeIndex
            )
            const hammer = renderState.hammerStrikes.find(
              (h) => h.holeIndex === holeIndex
            )

            const isHit = mole?.hit ?? false
            const hitAge = isHit && mole ? renderState.elapsedMs - mole.hitAtMs : 0
            const age = mole && !isHit ? renderState.elapsedMs - mole.spawnedAtMs : 0
            const progress = mole && !isHit ? Math.min(1, age / mole.durationMs) : 0
            const isDisappearing = progress > 0.7

            const fbAge = feedback ? renderState.elapsedMs - feedback.createdAtMs : 0
            const fbOpacity = feedback ? Math.max(0, 1 - fbAge / 800) : 0
            const fbOffsetY = feedback ? -36 * (fbAge / 800) : 0
            const fbScale = feedback ? 1 + 0.4 * Math.max(0, 1 - fbAge / 200) : 1

            const hammerAge = hammer ? renderState.elapsedMs - hammer.createdAtMs : 0
            const hammerVisible = hammer && hammerAge < HAMMER_DURATION_MS

            return (
              <div
                className={`dd-hole ${mole && !isHit ? 'occupied' : ''} ${isHit ? 'just-hit' : ''}`}
                key={holeIndex}
              >
                {/* Hole background image */}
                <img className="dd-hole-img" src={holeImg} alt="" draggable={false} />

                {/* Impact flash on hit */}
                {isHit && hitAge < 200 && mole && (
                  <div
                    className={`dd-hit-flash ${mole.type}`}
                    style={{ opacity: Math.max(0, 1 - hitAge / 200) }}
                  />
                )}

                {/* Mole character */}
                {mole && !isHit && (
                  <button
                    className={`dd-mole ${mole.type} ${isDisappearing ? 'disappearing' : 'appearing'}`}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleWhack(mole.id)
                    }}
                    aria-label={`Whack ${mole.type} mole`}
                  >
                    <img
                      className="dd-mole-img"
                      src={MOLE_ASSETS[mole.type]}
                      alt={mole.type}
                      draggable={false}
                    />
                    {mole.type === 'golden' && <div className="dd-golden-glow" />}
                    {mole.type === 'bomb' && <div className="dd-bomb-glow" />}
                    {mole.type === 'freeze' && <div className="dd-freeze-glow" />}
                    {/* Timer ring */}
                    <svg className="dd-mole-timer" viewBox="0 0 36 36">
                      <circle
                        cx="18" cy="18" r="16"
                        fill="none"
                        stroke={mole.type === 'bomb' ? '#ef4444' : mole.type === 'golden' ? '#fbbf24' : mole.type === 'freeze' ? '#38bdf8' : '#fff'}
                        strokeWidth="2"
                        strokeDasharray={`${(1 - progress) * 100} 100`}
                        strokeLinecap="round"
                        opacity={0.6}
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                  </button>
                )}

                {/* Squashed mole (hit animation) */}
                {mole && isHit && hitAge < 300 && (
                  <div
                    className={`dd-mole-squash ${mole.type}`}
                    style={{
                      opacity: Math.max(0, 1 - hitAge / 300),
                      transform: `scaleY(${Math.max(0.1, 0.3 - hitAge / 1000)}) scaleX(${1 + hitAge / 600})`,
                    }}
                  >
                    <img
                      className="dd-mole-img"
                      src={MOLE_ASSETS[mole.type]}
                      alt=""
                      draggable={false}
                    />
                  </div>
                )}

                {/* Hammer strike */}
                {hammerVisible && (
                  <img
                    className={`dd-hammer ${hammerAge < 80 ? 'striking' : 'recoiling'}`}
                    src={hammerSprite}
                    alt=""
                    draggable={false}
                    style={{
                      opacity: hammerAge > 250 ? Math.max(0, 1 - (hammerAge - 250) / 100) : 1,
                    }}
                  />
                )}

                {/* Particles */}
                {holeParticles.map((p) => {
                  const pAge = renderState.elapsedMs - p.createdAtMs
                  const t = pAge / PARTICLE_LIFETIME_MS
                  const dist = p.speed * t
                  const px = Math.cos(p.angle) * dist
                  const py = Math.sin(p.angle) * dist - 20 * t * t
                  const pOpacity = Math.max(0, 1 - t)
                  const pScale = 1 - t * 0.5
                  return (
                    <div
                      className="dd-particle"
                      key={p.id}
                      style={{
                        left: `calc(50% + ${px}px)`,
                        top: `calc(50% + ${py}px)`,
                        width: p.size * pScale,
                        height: p.size * pScale,
                        backgroundColor: p.color,
                        opacity: pOpacity,
                      }}
                    />
                  )
                })}

                {/* Score feedback */}
                {feedback && fbOpacity > 0 && (
                  <div
                    className={`dd-feedback ${feedback.moleType}`}
                    style={{
                      opacity: fbOpacity,
                      transform: `translate(-50%, ${fbOffsetY}px) scale(${fbScale})`,
                    }}
                  >
                    {feedback.text}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Fever overlay */}
        {renderState.isFeverActive && (
          <div className="dd-fever-overlay" aria-hidden />
        )}

        {/* Freeze overlay */}
        {renderState.isFrozen && (
          <div className="dd-freeze-overlay" aria-hidden />
        )}

        {/* Stage actions */}
        <div className="dd-stage-actions">
          <button className="dd-stage-btn" type="button" onClick={() => finishRound()}>
            FINISH
          </button>
          <button className="dd-stage-btn ghost" type="button" onClick={onExit}>
            EXIT
          </button>
        </div>
      </div>
    </section>
  )
}

export const dungaDungaModule: MiniGameModule = {
  manifest: {
    id: 'dunga-dunga',
    title: 'Whack-a-Mole',
    description: 'Whack moles from 9 holes! Avoid bombs, catch golden moles!',
    unlockCost: 0,
    baseReward: 22,
    scoreRewardMultiplier: 0.9,
    accentColor: '#f59e0b',
  },
  Component: DungaDungaGame,
}
