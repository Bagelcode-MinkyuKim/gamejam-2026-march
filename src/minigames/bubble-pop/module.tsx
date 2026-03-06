import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import popSfx from '../../../assets/sounds/bubble-pop-pop.mp3'
import bombSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverSfx from '../../../assets/sounds/game-over-hit.mp3'
import goldenSfx from '../../../assets/sounds/bubble-pop-golden.mp3'
import freezeSfx from '../../../assets/sounds/bubble-pop-freeze.mp3'
import heartSfx from '../../../assets/sounds/bubble-pop-heart.mp3'
import feverSfx from '../../../assets/sounds/bubble-pop-fever.mp3'
import comboMilestoneSfx from '../../../assets/sounds/combo-milestone.mp3'
import bgmLoop from '../../../assets/sounds/gameplay-bgm-loop.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// ─── Lives System ──────────────────────────────────────
const MAX_LIVES = 3

// ─── Bubble Sizes ──────────────────────────────────────
const BUBBLE_MIN_RADIUS = 22
const BUBBLE_MAX_RADIUS = 54
const BUBBLE_SMALL_THRESHOLD = 32

// ─── Movement ──────────────────────────────────────────
const BUBBLE_RISE_SPEED_BASE_MIN = 55
const BUBBLE_RISE_SPEED_BASE_MAX = 100
const BUBBLE_SWAY_AMPLITUDE = 14
const BUBBLE_SWAY_SPEED = 2.0

// ─── Spawn ─────────────────────────────────────────────
const BUBBLE_SPAWN_INTERVAL_BASE_MS = 600
const BUBBLE_SPAWN_INTERVAL_MIN_MS = 250
const BUBBLE_MAX_COUNT = 22

// ─── Base Probabilities (increase with difficulty) ─────
const BOMB_PROB_BASE = 0.18
const BOMB_PROB_MAX = 0.40
const GOLDEN_PROB = 0.05
const FREEZE_PROB = 0.04
const HEART_PROB = 0.035
const SHIELD_PROB = 0.03
const DOUBLE_PROB = 0.03
const MAGNET_PROB = 0.025

// ─── Scoring ───────────────────────────────────────────
const SCORE_SMALL = 3
const SCORE_LARGE = 1
const SCORE_GOLDEN = 15
const SCORE_FREEZE_BONUS = 5
const SCORE_HEART_BONUS = 3
const COMBO_DECAY_MS = 1400
const COMBO_MULTIPLIER_STEP = 5
const MAX_COMBO_MULTIPLIER = 6

// ─── Power-up Durations ────────────────────────────────
const FEVER_COMBO_THRESHOLD = 10
const FEVER_DURATION_MS = 6000
const FEVER_SCORE_MULTIPLIER = 2
const FREEZE_DURATION_MS = 3500
const SHIELD_DURATION_MS = 8000
const DOUBLE_DURATION_MS = 8000
const MAGNET_DURATION_MS = 6000

const POP_ANIMATION_MS = 280

const BUBBLE_COLORS = ['#93c5fd', '#f9a8d4', '#86efac', '#fde68a', '#c4b5fd', '#fdba74'] as const

type BubbleType = 'normal' | 'bomb' | 'golden' | 'freeze' | 'heart' | 'shield' | 'double' | 'magnet'

interface Bubble {
  readonly id: number
  x: number
  y: number
  readonly radius: number
  readonly color: string
  readonly type: BubbleType
  readonly riseSpeed: number
  readonly swayPhase: number
  readonly spawnX: number
}

interface PopEffect {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly radius: number
  readonly type: BubbleType
  readonly startedAt: number
}

let nextBubbleId = 0

function getDifficulty(score: number) {
  const level = Math.min(10, Math.floor(score / 30))
  const t = level / 10
  return {
    bombProb: BOMB_PROB_BASE + (BOMB_PROB_MAX - BOMB_PROB_BASE) * t,
    speedMul: 1 + t * 0.8,
    spawnInterval: BUBBLE_SPAWN_INTERVAL_BASE_MS - t * (BUBBLE_SPAWN_INTERVAL_BASE_MS - BUBBLE_SPAWN_INTERVAL_MIN_MS),
    level,
  }
}

function pickBubbleType(bombProb: number): BubbleType {
  const r = Math.random()
  let cumulative = 0
  cumulative += bombProb
  if (r < cumulative) return 'bomb'
  cumulative += GOLDEN_PROB
  if (r < cumulative) return 'golden'
  cumulative += FREEZE_PROB
  if (r < cumulative) return 'freeze'
  cumulative += HEART_PROB
  if (r < cumulative) return 'heart'
  cumulative += SHIELD_PROB
  if (r < cumulative) return 'shield'
  cumulative += DOUBLE_PROB
  if (r < cumulative) return 'double'
  cumulative += MAGNET_PROB
  if (r < cumulative) return 'magnet'
  return 'normal'
}

function bubbleColor(type: BubbleType): string {
  switch (type) {
    case 'bomb': return '#ef4444'
    case 'golden': return '#fbbf24'
    case 'freeze': return '#67e8f9'
    case 'heart': return '#f472b6'
    case 'shield': return '#a78bfa'
    case 'double': return '#34d399'
    case 'magnet': return '#f97316'
    default: return BUBBLE_COLORS[Math.floor(Math.random() * BUBBLE_COLORS.length)]
  }
}

function bubbleEmoji(type: BubbleType): string | null {
  switch (type) {
    case 'bomb': return '💣'
    case 'golden': return '⭐'
    case 'freeze': return '❄️'
    case 'heart': return '💖'
    case 'shield': return '🛡️'
    case 'double': return '2x'
    case 'magnet': return '🧲'
    default: return null
  }
}

function createBubble(stageW: number, stageH: number, bombProb: number, speedMul: number): Bubble {
  const type = pickBubbleType(bombProb)
  const isSpecial = type !== 'normal' && type !== 'bomb'
  const radius = isSpecial
    ? BUBBLE_MIN_RADIUS + 6
    : BUBBLE_MIN_RADIUS + Math.random() * (BUBBLE_MAX_RADIUS - BUBBLE_MIN_RADIUS)
  const x = radius + Math.random() * Math.max(1, stageW - radius * 2)
  const baseSpeed = BUBBLE_RISE_SPEED_BASE_MIN + Math.random() * (BUBBLE_RISE_SPEED_BASE_MAX - BUBBLE_RISE_SPEED_BASE_MIN)
  return {
    id: nextBubbleId++,
    x,
    y: stageH + radius,
    radius,
    color: bubbleColor(type),
    type,
    riseSpeed: baseSpeed * speedMul,
    swayPhase: Math.random() * Math.PI * 2,
    spawnX: x,
  }
}

function toComboMultiplier(combo: number): number {
  return Math.min(MAX_COMBO_MULTIPLIER, 1 + Math.floor(combo / COMBO_MULTIPLIER_STEP))
}

function BubblePopGame({ onFinish, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [lives, setLives] = useState(MAX_LIVES)
  const [combo, setCombo] = useState(0)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [popEffects, setPopEffects] = useState<PopEffect[]>([])
  const [isFever, setIsFever] = useState(false)
  const [isFrozen, setIsFrozen] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [hasDouble, setHasDouble] = useState(false)
  const [hasMagnet, setHasMagnet] = useState(false)
  const [stageSize, setStageSize] = useState({ w: 380, h: 680 })

  const scoreRef = useRef(0)
  const livesRef = useRef(MAX_LIVES)
  const comboRef = useRef(0)
  const lastComboAtRef = useRef(0)
  const bubblesRef = useRef<Bubble[]>([])
  const popEffectsRef = useRef<PopEffect[]>([])
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const lastSpawnAtRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const startTimeRef = useRef(0)
  const feverRef = useRef(false)
  const feverEndRef = useRef(0)
  const frozenRef = useRef(false)
  const frozenEndRef = useRef(0)
  const shieldRef = useRef(false)
  const shieldEndRef = useRef(0)
  const doubleRef = useRef(false)
  const doubleEndRef = useRef(0)
  const magnetRef = useRef(false)
  const magnetEndRef = useRef(0)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const playAudio = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (bgmRef.current) bgmRef.current.pause()
    playAudio('gameOver', 0.6, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, elapsedMsRef.current))
    onFinish({ score: Math.max(0, scoreRef.current), durationMs: elapsedMs })
  }, [onFinish, playAudio])

  // Measure stage
  useEffect(() => {
    const measure = () => {
      if (stageRef.current) {
        const rect = stageRef.current.getBoundingClientRect()
        setStageSize({ w: rect.width, h: rect.height })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const handleBubbleTap = useCallback((bubbleId: number) => {
    if (finishedRef.current) return
    const now = performance.now()
    const idx = bubblesRef.current.findIndex((b) => b.id === bubbleId)
    if (idx === -1) return
    const bubble = bubblesRef.current[idx]

    // Remove bubble
    popEffectsRef.current = [...popEffectsRef.current, { id: bubble.id, x: bubble.x, y: bubble.y, radius: bubble.radius, type: bubble.type, startedAt: now }]
    setPopEffects([...popEffectsRef.current])
    bubblesRef.current = bubblesRef.current.filter((b) => b.id !== bubbleId)
    setBubbles([...bubblesRef.current])

    const scoreMul = (feverRef.current ? FEVER_SCORE_MULTIPLIER : 1) * (doubleRef.current ? 2 : 1)

    // ─── BOMB ───
    if (bubble.type === 'bomb') {
      if (shieldRef.current) {
        shieldRef.current = false
        setHasShield(false)
        effects.spawnParticles(4, bubble.x, bubble.y, ['🛡️', '✨'])
        playAudio('pop', 0.4, 0.8)
        return
      }
      const nextLives = livesRef.current - 1
      livesRef.current = nextLives
      setLives(nextLives)
      comboRef.current = 0
      setCombo(0)
      playAudio('bomb', 0.55, 0.7)
      effects.triggerShake(10)
      effects.triggerFlash('rgba(239,68,68,0.25)')
      effects.spawnParticles(5, bubble.x, bubble.y, ['💥', '💢', '🔥'])
      if (nextLives <= 0) finishGame()
      return
    }

    // ─── GOLDEN ───
    if (bubble.type === 'golden') {
      const earned = Math.round(SCORE_GOLDEN * scoreMul)
      scoreRef.current += earned
      setScore(scoreRef.current)
      playAudio('golden', 0.6)
      effects.spawnParticles(7, bubble.x, bubble.y, ['⭐', '🌟', '💎', '✨'])
      effects.showScorePopup(earned, bubble.x, bubble.y, '#fbbf24')
      advanceCombo(now)
      return
    }

    // ─── FREEZE ───
    if (bubble.type === 'freeze') {
      frozenRef.current = true
      frozenEndRef.current = now + FREEZE_DURATION_MS
      setIsFrozen(true)
      playAudio('freeze', 0.5)
      effects.spawnParticles(5, bubble.x, bubble.y, ['❄️', '🧊', '💠'])
      const earned = Math.round(SCORE_FREEZE_BONUS * scoreMul)
      scoreRef.current += earned
      setScore(scoreRef.current)
      effects.showScorePopup(earned, bubble.x, bubble.y, '#67e8f9')
      return
    }

    // ─── HEART (restore 1 life) ───
    if (bubble.type === 'heart') {
      if (livesRef.current < MAX_LIVES) {
        livesRef.current = Math.min(MAX_LIVES, livesRef.current + 1)
        setLives(livesRef.current)
      }
      playAudio('heart', 0.55)
      effects.spawnParticles(5, bubble.x, bubble.y, ['💖', '💗', '💕', '❤️'])
      const earned = Math.round(SCORE_HEART_BONUS * scoreMul)
      scoreRef.current += earned
      setScore(scoreRef.current)
      effects.showScorePopup(earned, bubble.x, bubble.y, '#f472b6')
      return
    }

    // ─── SHIELD ───
    if (bubble.type === 'shield') {
      shieldRef.current = true
      shieldEndRef.current = now + SHIELD_DURATION_MS
      setHasShield(true)
      playAudio('golden', 0.5, 1.2)
      effects.spawnParticles(5, bubble.x, bubble.y, ['🛡️', '✨', '💫'])
      effects.showScorePopup(0, bubble.x, bubble.y, '#a78bfa')
      return
    }

    // ─── DOUBLE ───
    if (bubble.type === 'double') {
      doubleRef.current = true
      doubleEndRef.current = now + DOUBLE_DURATION_MS
      setHasDouble(true)
      playAudio('golden', 0.5, 1.3)
      effects.spawnParticles(5, bubble.x, bubble.y, ['2️⃣', '✨', '💫'])
      return
    }

    // ─── MAGNET ───
    if (bubble.type === 'magnet') {
      magnetRef.current = true
      magnetEndRef.current = now + MAGNET_DURATION_MS
      setHasMagnet(true)
      playAudio('golden', 0.5, 0.9)
      effects.spawnParticles(5, bubble.x, bubble.y, ['🧲', '✨'])
      return
    }

    // ─── NORMAL ───
    const isSmall = bubble.radius <= BUBBLE_SMALL_THRESHOLD
    const basePoints = isSmall ? SCORE_SMALL : SCORE_LARGE
    advanceCombo(now)
    const multiplier = toComboMultiplier(comboRef.current) * scoreMul
    const earned = Math.round(basePoints * multiplier)
    scoreRef.current += earned
    setScore(scoreRef.current)

    const pitchBoost = Math.min(0.4, comboRef.current * 0.03)
    playAudio('pop', 0.45, 1 + pitchBoost)

    if (comboRef.current >= FEVER_COMBO_THRESHOLD && !feverRef.current) {
      feverRef.current = true
      feverEndRef.current = now + FEVER_DURATION_MS
      setIsFever(true)
      playAudio('fever', 0.6)
      effects.triggerShake(5)
    }

    if (comboRef.current > 0 && comboRef.current % 10 === 0) {
      playAudio('combo', 0.5)
    }

    if (comboRef.current >= 5) {
      const intensity = Math.min(6, 2 + comboRef.current * 0.2)
      effects.triggerShake(intensity, 80)
      const particleCount = Math.min(6, 3 + Math.floor(comboRef.current / 8))
      effects.spawnParticles(particleCount, bubble.x, bubble.y)
      effects.showScorePopup(earned, bubble.x, bubble.y, comboRef.current > 10 ? '#fbbf24' : '#fff')
    } else {
      effects.spawnParticles(2, bubble.x, bubble.y, ['✨', '💫'])
      effects.showScorePopup(earned, bubble.x, bubble.y)
    }
  }, [playAudio, effects, finishGame])

  function advanceCombo(now: number) {
    const timeSince = now - lastComboAtRef.current
    comboRef.current = timeSince <= COMBO_DECAY_MS ? comboRef.current + 1 : 1
    setCombo(comboRef.current)
    lastComboAtRef.current = now
  }

  // Audio setup
  useEffect(() => {
    const sources: [string, string][] = [
      ['pop', popSfx], ['bomb', bombSfx], ['gameOver', gameOverSfx],
      ['golden', goldenSfx], ['freeze', freezeSfx], ['heart', heartSfx],
      ['fever', feverSfx], ['combo', comboMilestoneSfx],
    ]
    for (const [key, src] of sources) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioRefs.current[key] = a
    }
    const bgm = new Audio(bgmLoop)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = 0.2
    bgmRef.current = bgm
    void bgm.play().catch(() => {})

    return () => {
      for (const key of Object.keys(audioRefs.current)) {
        const a = audioRefs.current[key]
        if (a) { a.pause(); a.currentTime = 0 }
        audioRefs.current[key] = null
      }
      bgm.pause()
      bgm.currentTime = 0
      bgmRef.current = null
    }
  }, [])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null
    startTimeRef.current = performance.now()

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs

      // Power-up expiries
      if (frozenRef.current && now >= frozenEndRef.current) { frozenRef.current = false; setIsFrozen(false) }
      if (feverRef.current && now >= feverEndRef.current) { feverRef.current = false; setIsFever(false) }
      if (shieldRef.current && now >= shieldEndRef.current) { shieldRef.current = false; setHasShield(false) }
      if (doubleRef.current && now >= doubleEndRef.current) { doubleRef.current = false; setHasDouble(false) }
      if (magnetRef.current && now >= magnetEndRef.current) { magnetRef.current = false; setHasMagnet(false) }

      const deltaSeconds = deltaMs / 1000
      const sw = stageSize.w
      const sh = stageSize.h
      const diff = getDifficulty(scoreRef.current)

      // Update bubbles
      const updated: Bubble[] = []
      for (const bubble of bubblesRef.current) {
        const speed = frozenRef.current ? bubble.riseSpeed * 0.12 : bubble.riseSpeed
        const nextY = bubble.y - speed * deltaSeconds
        if (nextY + bubble.radius < 0) continue
        const elapsed = elapsedMsRef.current / 1000
        let swayX = bubble.spawnX + Math.sin(elapsed * BUBBLE_SWAY_SPEED + bubble.swayPhase) * BUBBLE_SWAY_AMPLITUDE

        // Magnet: pull normal bubbles toward center
        if (magnetRef.current && bubble.type === 'normal') {
          const centerX = sw / 2
          swayX += (centerX - swayX) * 0.02
        }

        updated.push({ ...bubble, x: Math.max(bubble.radius, Math.min(sw - bubble.radius, swayX)), y: nextY })
      }

      // Spawn
      const timeSinceLastSpawn = now - lastSpawnAtRef.current
      if (timeSinceLastSpawn >= diff.spawnInterval && updated.length < BUBBLE_MAX_COUNT) {
        updated.push(createBubble(sw, sh, diff.bombProb, diff.speedMul))
        lastSpawnAtRef.current = now
      }

      bubblesRef.current = updated
      setBubbles([...updated])

      // Pop effects cleanup
      popEffectsRef.current = popEffectsRef.current.filter((p) => now - p.startedAt < POP_ANIMATION_MS)
      setPopEffects([...popEffectsRef.current])

      // Combo decay
      if (now - lastComboAtRef.current > COMBO_DECAY_MS && comboRef.current > 0) {
        comboRef.current = 0
        setCombo(0)
      }

      effects.updateParticles()
      animationFrameRef.current = requestAnimationFrame(step)
    }

    animationFrameRef.current = requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
      lastFrameAtRef.current = null
      effects.cleanup()
    }
  }, [finishGame, stageSize, effects])

  const comboMultiplier = toComboMultiplier(combo)
  const displayedBestScore = useMemo(() => Math.max(bestScore, Math.max(0, score)), [bestScore, score])
  const diff = getDifficulty(score)

  return (
    <section
      className="mini-game-panel bubble-pop-panel"
      aria-label="bubble-pop-game"
      style={{ width: '100%', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', ...effects.getShakeStyle() }}
    >
      {/* Top HUD */}
      <div className="bp-hud-top">
        <div className="bp-hud-left">
          <p className="bp-score">{Math.max(0, score).toLocaleString()}</p>
          <p className="bp-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="bp-hud-center">
          <div className="bp-lives">
            {Array.from({ length: MAX_LIVES }, (_, i) => (
              <span key={i} className={`bp-life ${i < lives ? 'alive' : 'dead'}`}>
                {i < lives ? '❤️' : '🖤'}
              </span>
            ))}
          </div>
          {diff.level > 0 && <p className="bp-level">Lv.{diff.level}</p>}
        </div>
        <div className="bp-hud-right">
          {combo >= 2 && (
            <p className="bp-combo">
              {combo} <span className="bp-combo-label">COMBO</span>
              <br />
              <span className="bp-multiplier">x{comboMultiplier}{feverRef.current ? ' FEVER' : ''}</span>
            </p>
          )}
        </div>
      </div>

      {/* Status badges */}
      <div className="bp-status-row">
        {isFever && <span className="bp-badge bp-badge-fever">FEVER x{FEVER_SCORE_MULTIPLIER}</span>}
        {isFrozen && <span className="bp-badge bp-badge-freeze">FREEZE</span>}
        {hasShield && <span className="bp-badge bp-badge-shield">SHIELD</span>}
        {hasDouble && <span className="bp-badge bp-badge-double">x2 SCORE</span>}
        {hasMagnet && <span className="bp-badge bp-badge-magnet">MAGNET</span>}
      </div>

      {/* Game Stage */}
      <div
        ref={stageRef}
        className={`bp-stage ${isFever ? 'fever' : ''} ${isFrozen ? 'frozen' : ''}`}
        role="presentation"
      >
        {bubbles.map((bubble) => {
          const emoji = bubbleEmoji(bubble.type)
          return (
            <div
              key={bubble.id}
              className={`bp-bubble bp-bt-${bubble.type} ${bubble.radius <= BUBBLE_SMALL_THRESHOLD ? 'small' : 'large'}`}
              style={{
                left: `${bubble.x}px`,
                top: `${bubble.y}px`,
                width: `${bubble.radius * 2}px`,
                height: `${bubble.radius * 2}px`,
                backgroundColor: bubble.color,
              }}
              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handleBubbleTap(bubble.id) }}
              role="button"
              tabIndex={-1}
            >
              {emoji && <span className="bp-icon">{emoji}</span>}
            </div>
          )
        })}

        {popEffects.map((pop) => {
          const now = performance.now()
          const progress = Math.min(1, (now - pop.startedAt) / POP_ANIMATION_MS)
          return (
            <div
              key={`pop-${pop.id}`}
              className={`bp-pop bp-pop-${pop.type}`}
              style={{
                left: `${pop.x}px`, top: `${pop.y}px`,
                width: `${pop.radius * 2}px`, height: `${pop.radius * 2}px`,
                transform: `translate(-50%, -50%) scale(${1 + progress * 0.7})`,
                opacity: 1 - progress,
              }}
            />
          )
        })}

        <div className="bp-hint-row">
          <span className="bp-hint" style={{ color: '#93c5fd' }}>Small +{SCORE_SMALL}</span>
          <span className="bp-hint" style={{ color: '#86efac' }}>Big +{SCORE_LARGE}</span>
          <span className="bp-hint" style={{ color: '#fbbf24' }}>Gold +{SCORE_GOLDEN}</span>
          <span className="bp-hint" style={{ color: '#ef4444' }}>Bomb = MISS</span>
        </div>
      </div>

      {combo >= 3 && (
        <div className="ge-combo-label" style={{
          position: 'absolute', top: '110px', left: '50%',
          transform: 'translateX(-50%)',
          fontSize: `${Math.min(48, 20 + combo)}px`,
          color: getComboColor(combo), zIndex: 30,
        }}>
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <style>{GAME_EFFECTS_CSS}{`
        .bubble-pop-panel {
          user-select: none;
          -webkit-user-select: none;
          background: linear-gradient(180deg, #0c1445 0%, #1a2980 40%, #26d0ce 100%);
        }
        .bp-hud-top {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 10px 14px 2px; z-index: 20; flex-shrink: 0;
        }
        .bp-hud-left { display: flex; flex-direction: column; }
        .bp-score {
          font-size: clamp(36px, 9vw, 52px); font-weight: 900; color: #06b6d4;
          margin: 0; line-height: 1; text-shadow: 0 2px 8px rgba(6,182,212,0.4);
        }
        .bp-best {
          font-size: clamp(13px, 3.5vw, 16px); font-weight: 600; color: #94a3b8; margin: 2px 0 0;
        }
        .bp-hud-center {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .bp-lives { display: flex; gap: 4px; }
        .bp-life { font-size: clamp(24px, 6vw, 34px); transition: transform 0.2s; }
        .bp-life.dead { opacity: 0.3; filter: grayscale(1); }
        .bp-level {
          font-size: clamp(12px, 3vw, 15px); font-weight: 700; color: #fbbf24;
          margin: 0; text-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }
        .bp-hud-right { text-align: right; }
        .bp-combo {
          font-size: clamp(20px, 5vw, 28px); font-weight: 800; color: #fbbf24;
          margin: 0; line-height: 1.1; text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        .bp-combo-label { font-size: 0.6em; font-weight: 600; }
        .bp-multiplier { color: #f97316; font-weight: 900; font-size: 0.75em; }
        .bp-status-row {
          display: flex; justify-content: center; gap: 8px; padding: 0 14px 2px;
          min-height: 24px; z-index: 20; flex-shrink: 0; flex-wrap: wrap;
        }
        .bp-badge {
          font-size: clamp(12px, 3vw, 15px); font-weight: 800;
          padding: 2px 10px; border-radius: 16px; letter-spacing: 0.5px;
        }
        .bp-badge-fever {
          background: linear-gradient(90deg, #f59e0b, #ef4444); color: #fff;
          animation: bp-badge-pulse 0.5s ease-in-out infinite alternate;
          box-shadow: 0 0 12px rgba(245,158,11,0.4);
        }
        .bp-badge-freeze {
          background: linear-gradient(90deg, #22d3ee, #3b82f6); color: #fff;
          box-shadow: 0 0 12px rgba(34,211,238,0.4);
        }
        .bp-badge-shield {
          background: linear-gradient(90deg, #8b5cf6, #a78bfa); color: #fff;
          box-shadow: 0 0 12px rgba(139,92,246,0.4);
        }
        .bp-badge-double {
          background: linear-gradient(90deg, #10b981, #34d399); color: #fff;
          box-shadow: 0 0 12px rgba(16,185,129,0.4);
        }
        .bp-badge-magnet {
          background: linear-gradient(90deg, #f97316, #fb923c); color: #fff;
          box-shadow: 0 0 12px rgba(249,115,22,0.4);
        }
        .bp-stage {
          flex: 1; position: relative; overflow: hidden; touch-action: none;
          transition: box-shadow 0.5s;
        }
        .bp-stage.fever { box-shadow: inset 0 0 50px rgba(251,191,36,0.15); }
        .bp-stage.frozen { box-shadow: inset 0 0 50px rgba(34,211,238,0.2); }
        .bp-bubble {
          position: absolute; border-radius: 50%; transform: translate(-50%, -50%);
          cursor: pointer; display: flex; align-items: center; justify-content: center;
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.1), inset 3px 3px 8px rgba(255,255,255,0.3);
          border: 2px solid rgba(255,255,255,0.3);
        }
        .bp-bubble:active { transform: translate(-50%, -50%) scale(0.85); }
        .bp-bt-bomb {
          border-color: rgba(220,38,38,0.5);
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.2), 0 0 10px rgba(239,68,68,0.4);
        }
        .bp-bt-golden {
          border-color: rgba(251,191,36,0.6);
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 14px rgba(251,191,36,0.5);
          animation: bp-glow 1s ease-in-out infinite alternate;
        }
        .bp-bt-freeze {
          border-color: rgba(103,232,249,0.6);
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 12px rgba(103,232,249,0.4);
        }
        .bp-bt-heart {
          border-color: rgba(244,114,182,0.6);
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 12px rgba(244,114,182,0.4);
          animation: bp-heartbeat 0.8s ease-in-out infinite;
        }
        .bp-bt-shield {
          border-color: rgba(167,139,250,0.6);
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 12px rgba(167,139,250,0.4);
        }
        .bp-bt-double {
          border-color: rgba(52,211,153,0.6);
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 12px rgba(52,211,153,0.4);
        }
        .bp-bt-magnet {
          border-color: rgba(249,115,22,0.6);
          box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 12px rgba(249,115,22,0.4);
          animation: bp-spin 3s linear infinite;
        }
        .bp-icon {
          font-size: clamp(16px, 4.5vw, 26px); pointer-events: none;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
        }
        .bp-pop {
          position: absolute; border-radius: 50%; pointer-events: none;
        }
        .bp-pop-normal { background: radial-gradient(circle, rgba(255,255,255,0.6) 0%, rgba(147,197,253,0.3) 60%, transparent 100%); }
        .bp-pop-bomb { background: radial-gradient(circle, rgba(255,100,100,0.7) 0%, rgba(239,68,68,0.3) 60%, transparent 100%); }
        .bp-pop-golden { background: radial-gradient(circle, rgba(255,255,200,0.7) 0%, rgba(251,191,36,0.3) 60%, transparent 100%); }
        .bp-pop-freeze { background: radial-gradient(circle, rgba(200,255,255,0.7) 0%, rgba(103,232,249,0.3) 60%, transparent 100%); }
        .bp-pop-heart { background: radial-gradient(circle, rgba(255,200,220,0.7) 0%, rgba(244,114,182,0.3) 60%, transparent 100%); }
        .bp-pop-shield { background: radial-gradient(circle, rgba(200,180,255,0.7) 0%, rgba(167,139,250,0.3) 60%, transparent 100%); }
        .bp-pop-double { background: radial-gradient(circle, rgba(180,255,220,0.7) 0%, rgba(52,211,153,0.3) 60%, transparent 100%); }
        .bp-pop-magnet { background: radial-gradient(circle, rgba(255,200,160,0.7) 0%, rgba(249,115,22,0.3) 60%, transparent 100%); }
        .bp-hint-row {
          position: absolute; bottom: 6px; left: 0; right: 0;
          display: flex; justify-content: center; gap: 6px;
          pointer-events: none; opacity: 0.45; z-index: 5;
        }
        .bp-hint {
          font-size: clamp(10px, 2.5vw, 12px); font-weight: 700;
          padding: 1px 5px; border-radius: 4px; background: rgba(0,0,0,0.4);
        }
        @keyframes bp-badge-pulse {
          from { opacity: 1; } to { opacity: 0.7; }
        }
        @keyframes bp-glow {
          from { box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 10px rgba(251,191,36,0.3); }
          to { box-shadow: inset -3px -3px 8px rgba(0,0,0,0.08), 0 0 22px rgba(251,191,36,0.7); }
        }
        @keyframes bp-heartbeat {
          0%, 100% { transform: translate(-50%, -50%) scale(1); }
          50% { transform: translate(-50%, -50%) scale(1.1); }
        }
        @keyframes bp-spin {
          from { } to { }
        }
      `}</style>
    </section>
  )
}

export const bubblePopModule: MiniGameModule = {
  manifest: {
    id: 'bubble-pop',
    title: 'Bubble Pop',
    description: 'Pop the bubbles! 3 bombs and it\'s game over! Gets harder as you score!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#06b6d4',
  },
  Component: BubblePopGame,
}
