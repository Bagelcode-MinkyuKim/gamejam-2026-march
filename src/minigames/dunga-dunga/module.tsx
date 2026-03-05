import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikSprite from '../../../assets/images/same-character/song-changsik.png'
import taeJinaSprite from '../../../assets/images/same-character/tae-jina.png'
import hammerSprite from '../../../assets/images/dunga-dunga/hammer.png'

const GRID_COLS = 4
const GRID_ROWS = 4
const HOLE_COUNT = GRID_COLS * GRID_ROWS

const GAME_DURATION_MS = 30_000
const NORMAL_SCORE = 1
const GOLDEN_SCORE = 10
const GOLDEN_TIME_BONUS_MS = 3_000

const FEVER_MAX = 100
const FEVER_PER_HIT = 12
const FEVER_DECAY_RATE = 8
const FEVER_DURATION_MS = 6_000

const NORMAL_SPAWN_INTERVAL_MS = 900
const FEVER_SPAWN_INTERVAL_MS = 500
const NORMAL_MAX_ACTIVE = 3
const FEVER_MAX_ACTIVE = 6
const GOLDEN_CHANCE_IN_FEVER = 0.15

const MOLE_SHOW_DURATION_MS = 1_200
const MOLE_SHOW_DURATION_FEVER_MS = 900

const PARTICLE_LIFETIME_MS = 600
const PARTICLE_COUNT_NORMAL = 6
const PARTICLE_COUNT_GOLDEN = 12
const SHAKE_DURATION_MS = 150
const SHAKE_INTENSITY = 4
const GOLDEN_SHAKE_INTENSITY = 8
const HAMMER_DURATION_MS = 350

const SINGERS = [
  { name: '김연자', imageSrc: kimYeonjaSprite },
  { name: '박상민', imageSrc: parkSangminSprite },
  { name: '박완규', imageSrc: parkWankyuSprite },
  { name: '서태지', imageSrc: seoTaijiSprite },
  { name: '송창식', imageSrc: songChangsikSprite },
  { name: '태진아', imageSrc: taeJinaSprite },
] as const

const HIT_COLORS = ['#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4', '#22c55e'] as const
const GOLDEN_COLORS = ['#fbbf24', '#fde68a', '#fff', '#f59e0b', '#fcd34d', '#fffbeb'] as const

interface Mole {
  readonly id: number
  readonly holeIndex: number
  readonly singerIndex: number
  readonly isGolden: boolean
  readonly spawnedAtMs: number
  readonly durationMs: number
  hit: boolean
  hitAtMs: number
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
  readonly isGolden: boolean
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
  hitFeedbacks: HitFeedback[]
  nextFeedbackId: number
  particles: Particle[]
  nextParticleId: number
  shakeUntilMs: number
  shakeIntensity: number
  lastComboPopMs: number
  hammerStrikes: HammerStrike[]
  nextHammerId: number
}

interface HitFeedback {
  readonly id: number
  readonly holeIndex: number
  readonly text: string
  readonly isGolden: boolean
  readonly createdAtMs: number
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
  readonly shakeX: number
  readonly shakeY: number
  readonly lastComboPopMs: number
}

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
    hitFeedbacks: [],
    nextFeedbackId: 0,
    particles: [],
    nextParticleId: 0,
    shakeUntilMs: 0,
    shakeIntensity: 0,
    lastComboPopMs: -9999,
    hammerStrikes: [],
    nextHammerId: 0,
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
    shakeX,
    shakeY,
    lastComboPopMs: model.lastComboPopMs,
  }
}

function getOccupiedHoles(moles: Mole[]): Set<number> {
  const occupied = new Set<number>()
  for (const mole of moles) {
    if (!mole.hit) {
      occupied.add(mole.holeIndex)
    }
  }
  return occupied
}

function spawnParticles(model: GameModel, holeIndex: number, isGolden: boolean): void {
  const count = isGolden ? PARTICLE_COUNT_GOLDEN : PARTICLE_COUNT_NORMAL
  const colors = isGolden ? GOLDEN_COLORS : HIT_COLORS
  for (let i = 0; i < count; i++) {
    model.particles.push({
      id: model.nextParticleId,
      holeIndex,
      angle: (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5,
      speed: 40 + Math.random() * 60 + (isGolden ? 30 : 0),
      size: 3 + Math.random() * 4 + (isGolden ? 2 : 0),
      color: colors[Math.floor(Math.random() * colors.length)],
      createdAtMs: model.elapsedMs,
    })
    model.nextParticleId += 1
  }
}

function spawnMole(model: GameModel): void {
  const maxActive = model.isFeverActive ? FEVER_MAX_ACTIVE : NORMAL_MAX_ACTIVE
  const activeMoles = model.moles.filter((m) => !m.hit)
  if (activeMoles.length >= maxActive) return

  const occupied = getOccupiedHoles(model.moles)
  const available: number[] = []
  for (let i = 0; i < HOLE_COUNT; i++) {
    if (!occupied.has(i)) available.push(i)
  }
  if (available.length === 0) return

  const holeIndex = available[Math.floor(Math.random() * available.length)]
  const singerIndex = Math.floor(Math.random() * SINGERS.length)
  const isGolden = model.isFeverActive && Math.random() < GOLDEN_CHANCE_IN_FEVER
  const durationMs = model.isFeverActive ? MOLE_SHOW_DURATION_FEVER_MS : MOLE_SHOW_DURATION_MS

  model.moles.push({
    id: model.nextMoleId,
    holeIndex,
    singerIndex,
    isGolden,
    spawnedAtMs: model.elapsedMs,
    durationMs,
    hit: false,
    hitAtMs: 0,
  })
  model.nextMoleId += 1
}

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
      score: model.score,
      durationMs: Math.max(Math.round(model.elapsedMs), Math.round(DEFAULT_FRAME_MS)),
    })
  }, [onFinish])

  const handleWhack = useCallback((moleId: number) => {
    const model = modelRef.current
    if (finishedRef.current) return

    const mole = model.moles.find((m) => m.id === moleId)
    if (!mole || mole.hit) return

    mole.hit = true
    mole.hitAtMs = model.elapsedMs
    const points = mole.isGolden ? GOLDEN_SCORE : NORMAL_SCORE
    model.score += points
    model.comboCount += 1

    if (mole.isGolden) {
      model.remainingMs += GOLDEN_TIME_BONUS_MS
    }

    model.fever = Math.min(FEVER_MAX, model.fever + FEVER_PER_HIT)
    if (model.fever >= FEVER_MAX && !model.isFeverActive) {
      model.isFeverActive = true
      model.feverRemainingMs = FEVER_DURATION_MS
    }

    // Particles
    spawnParticles(model, mole.holeIndex, mole.isGolden)

    // Hammer strike
    model.hammerStrikes.push({
      id: model.nextHammerId,
      holeIndex: mole.holeIndex,
      createdAtMs: model.elapsedMs,
      isGolden: mole.isGolden,
    })
    model.nextHammerId += 1

    // Screen shake
    model.shakeUntilMs = model.elapsedMs + SHAKE_DURATION_MS
    model.shakeIntensity = mole.isGolden ? GOLDEN_SHAKE_INTENSITY : SHAKE_INTENSITY

    // Combo pop
    if (model.comboCount >= 3) {
      model.lastComboPopMs = model.elapsedMs
    }

    // Feedback text
    let feedbackText: string
    if (mole.isGolden) {
      feedbackText = `+${GOLDEN_SCORE} +3s`
    } else if (model.comboCount >= 5) {
      feedbackText = `+${NORMAL_SCORE} x${model.comboCount}`
    } else {
      feedbackText = `+${NORMAL_SCORE}`
    }

    model.hitFeedbacks.push({
      id: model.nextFeedbackId,
      holeIndex: mole.holeIndex,
      text: feedbackText,
      isGolden: mole.isGolden,
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
      model.remainingMs -= rawDelta

      if (model.remainingMs <= 0) {
        model.remainingMs = 0
        finishRound()
        return
      }

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

      model.moles = model.moles.filter((mole) => {
        if (mole.hit) return model.elapsedMs - mole.hitAtMs < 300
        const age = model.elapsedMs - mole.spawnedAtMs
        return age < mole.durationMs
      })

      const hasActiveMoles = model.moles.some((m) => !m.hit)
      if (!hasActiveMoles && model.moles.length === 0) {
        model.comboCount = 0
      }

      const spawnInterval = model.isFeverActive ? FEVER_SPAWN_INTERVAL_MS : NORMAL_SPAWN_INTERVAL_MS
      if (model.elapsedMs - model.lastSpawnAtMs >= spawnInterval) {
        spawnMole(model)
        if (model.isFeverActive && Math.random() < 0.5) {
          spawnMole(model)
        }
        model.lastSpawnAtMs = model.elapsedMs
      }

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
  const showComboPop = comboPopAge < 600

  return (
    <section className="mini-game-panel dunga-dunga-panel" aria-label="dunga-dunga-game">
      <div
        className="dunga-dunga-stage"
        style={{
          transform: `translate(${renderState.shakeX}px, ${renderState.shakeY}px)`,
        }}
      >
        {/* HUD */}
        <div className="dunga-dunga-hud">
          <div className="dunga-dunga-hud-top">
            <div className="dunga-dunga-timer-block">
              <span className={`dunga-dunga-timer ${isUrgent ? 'urgent' : ''}`}>{timerSec}</span>
              <span className="dunga-dunga-timer-unit">초</span>
            </div>
            <div className="dunga-dunga-score-block">
              <span className="dunga-dunga-score">{renderState.score}</span>
              <span className="dunga-dunga-best">BEST {displayedBestScore}</span>
            </div>
          </div>
          <div className="dunga-dunga-fever-bar-container">
            <div
              className={`dunga-dunga-fever-bar ${renderState.isFeverActive ? 'active' : ''}`}
              style={{ width: `${feverPercent}%` }}
            />
            <span className="dunga-dunga-fever-label">
              {renderState.isFeverActive ? 'FEVER!' : 'FEVER'}
            </span>
          </div>
        </div>

        {/* Combo pop */}
        {showComboPop && renderState.comboCount >= 3 && (
          <div
            className={`dunga-dunga-combo-pop ${renderState.comboCount >= 10 ? 'mega' : renderState.comboCount >= 5 ? 'super' : ''}`}
            style={{ opacity: Math.max(0, 1 - comboPopAge / 600) }}
          >
            {renderState.comboCount}x COMBO!
          </div>
        )}

        {/* Grid */}
        <div className="dunga-dunga-grid">
          {Array.from({ length: HOLE_COUNT }, (_, holeIndex) => {
            const mole = renderState.moles.find(
              (m) => m.holeIndex === holeIndex
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
            const isDisappearing = progress > 0.75

            const fbAge = feedback ? renderState.elapsedMs - feedback.createdAtMs : 0
            const fbOpacity = feedback ? Math.max(0, 1 - fbAge / 800) : 0
            const fbOffsetY = feedback ? -28 * (fbAge / 800) : 0
            const fbScale = feedback ? 1 + 0.3 * Math.max(0, 1 - fbAge / 200) : 1

            const hammerAge = hammer ? renderState.elapsedMs - hammer.createdAtMs : 0
            const hammerVisible = hammer && hammerAge < HAMMER_DURATION_MS

            return (
              <div
                className={`dunga-dunga-hole ${mole && !isHit ? 'occupied' : ''} ${isHit ? 'just-hit' : ''}`}
                key={holeIndex}
              >
                <div className="dunga-dunga-hole-bg" />

                {/* Impact flash on hit */}
                {isHit && hitAge < 200 && (
                  <div
                    className={`dunga-dunga-hit-flash ${mole?.isGolden ? 'golden' : ''}`}
                    style={{ opacity: Math.max(0, 1 - hitAge / 200) }}
                  />
                )}

                {mole && !isHit && (
                  <button
                    className={`dunga-dunga-mole ${mole.isGolden ? 'golden' : ''} ${isDisappearing ? 'disappearing' : 'appearing'}`}
                    type="button"
                    onPointerDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      handleWhack(mole.id)
                    }}
                    aria-label={`Whack ${SINGERS[mole.singerIndex].name}`}
                  >
                    <img
                      className="dunga-dunga-mole-img"
                      src={SINGERS[mole.singerIndex].imageSrc}
                      alt={SINGERS[mole.singerIndex].name}
                      draggable={false}
                    />
                    {mole.isGolden && <div className="dunga-dunga-golden-glow" />}
                  </button>
                )}

                {/* Squashed mole (hit animation) */}
                {mole && isHit && hitAge < 300 && (
                  <div
                    className={`dunga-dunga-mole-squash ${mole.isGolden ? 'golden' : ''}`}
                    style={{
                      opacity: Math.max(0, 1 - hitAge / 300),
                      transform: `scaleY(${Math.max(0.1, 0.3 - hitAge / 1000)}) scaleX(${1 + hitAge / 600})`,
                    }}
                  >
                    <img
                      className="dunga-dunga-mole-img"
                      src={SINGERS[mole.singerIndex].imageSrc}
                      alt=""
                      draggable={false}
                    />
                  </div>
                )}

                {/* Hammer strike */}
                {hammerVisible && (
                  <img
                    className={`dunga-dunga-hammer ${hammerAge < 80 ? 'striking' : 'recoiling'}`}
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
                      className="dunga-dunga-particle"
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
                    className={`dunga-dunga-feedback ${feedback.isGolden ? 'golden' : ''}`}
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
          <div className="dunga-dunga-fever-overlay" aria-hidden />
        )}

        {/* Stage actions */}
        <div className="dunga-dunga-stage-actions">
          <button
            className="dunga-dunga-stage-button"
            type="button"
            onClick={() => finishRound()}
          >
            종료
          </button>
          <button
            className="dunga-dunga-stage-button ghost"
            type="button"
            onClick={onExit}
          >
            나가기
          </button>
        </div>
      </div>
    </section>
  )
}

export const dungaDungaModule: MiniGameModule = {
  manifest: {
    id: 'dunga-dunga',
    title: '두더지 잡기',
    description: '16개 구멍에서 출몰하는 가수들을 터치해 잡고, 피버 게이지를 채워 황금 가수를 노려보세요',
    unlockCost: 0,
    baseReward: 22,
    scoreRewardMultiplier: 0.9,
    accentColor: '#f59e0b',
  },
  Component: DungaDungaGame,
}
