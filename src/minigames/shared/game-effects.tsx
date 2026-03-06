import { useCallback, useRef, useState } from 'react'

// ─── Particle System ────────────────────────────────────────────────

const PARTICLE_LIFETIME_MS = 600
const MAX_PARTICLES = 30

export interface Particle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly color: string
  readonly size: number
  readonly createdAt: number
  readonly emoji: string
  readonly type: 'emoji' | 'circle' | 'star'
}

const HIT_EMOJIS = ['💥', '⚡', '🔥', '💫', '✨', '🌟', '💢', '🎯', '💎', '⭐'] as const
const HIT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f43f5e', '#a855f7',
] as const

export interface ScorePopup {
  readonly id: number
  readonly value: number
  readonly x: number
  readonly y: number
  readonly color: string
  readonly createdAt: number
}

// ─── useGameEffects Hook ────────────────────────────────────────────

export interface GameEffectsOptions {
  maxParticles?: number
  particleLifetimeMs?: number
  shakeDecay?: boolean
}

export function useGameEffects(options?: GameEffectsOptions) {
  const maxP = options?.maxParticles ?? MAX_PARTICLES
  const lifetimeMs = options?.particleLifetimeMs ?? PARTICLE_LIFETIME_MS

  const [particles, setParticles] = useState<Particle[]>([])
  const [scorePopups, setScorePopups] = useState<ScorePopup[]>([])
  const [isShaking, setIsShaking] = useState(false)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [isFlashing, setIsFlashing] = useState(false)
  const [flashColor, setFlashColor] = useState('rgba(255,255,255,0.6)')
  const [bgPulseHue, setBgPulseHue] = useState(0)

  const particleIdRef = useRef(0)
  const popupIdRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const popupsRef = useRef<ScorePopup[]>([])
  const shakeTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const shakeEndsAtRef = useRef(0)
  const flashEndsAtRef = useRef(0)

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current)
      ref.current = null
    }
  }

  // Spawn particles at a position
  const spawnParticles = useCallback((
    count: number,
    centerX: number,
    centerY: number,
    customEmojis?: readonly string[],
    type: 'emoji' | 'circle' | 'star' = 'emoji',
  ) => {
    const now = performance.now()
    const emojis = customEmojis ?? HIT_EMOJIS
    const newParticles: Particle[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8
      const speed = 80 + Math.random() * 200
      particleIdRef.current += 1
      newParticles.push({
        id: particleIdRef.current,
        x: centerX + (Math.random() - 0.5) * 30,
        y: centerY + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: HIT_COLORS[Math.floor(Math.random() * HIT_COLORS.length)],
        size: 6 + Math.random() * 10,
        createdAt: now,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
        type,
      })
    }
    const merged = [...particlesRef.current, ...newParticles].slice(-maxP)
    particlesRef.current = merged
    setParticles(merged)
  }, [maxP])

  // Trigger screen shake
  const triggerShake = useCallback((intensity = 5, durationMs = 120) => {
    shakeEndsAtRef.current = performance.now() + durationMs
    setIsShaking(true)
    setShakeIntensity(intensity)
    clearTimer(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      shakeEndsAtRef.current = 0
      setIsShaking(false)
      setShakeIntensity(0)
    }, durationMs)
  }, [])

  // Trigger screen flash
  const triggerFlash = useCallback((color = 'rgba(255,255,255,0.6)', durationMs = 80) => {
    flashEndsAtRef.current = performance.now() + durationMs
    setIsFlashing(true)
    setFlashColor(color)
    clearTimer(flashTimerRef)
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      flashEndsAtRef.current = 0
      setIsFlashing(false)
    }, durationMs)
  }, [])

  // Show score popup
  const showScorePopup = useCallback((value: number, x: number, y: number, color = '#fff') => {
    popupIdRef.current += 1
    const popup: ScorePopup = {
      id: popupIdRef.current,
      value,
      x,
      y,
      color,
      createdAt: performance.now(),
    }
    const merged = [...popupsRef.current, popup].slice(-10)
    popupsRef.current = merged
    setScorePopups(merged)
  }, [])

  // Advance background pulse hue
  const advanceBgHue = useCallback((delta = 25) => {
    setBgPulseHue((prev) => (prev + delta + Math.random() * 15) % 360)
  }, [])

  // Combo hit burst (convenience: shake + flash + particles + popup)
  const comboHitBurst = useCallback((
    x: number,
    y: number,
    comboCount: number,
    scoreValue: number,
    customEmojis?: readonly string[],
  ) => {
    const intensity = Math.min(10, 2 + comboCount * 0.4)
    triggerShake(intensity)
    triggerFlash()
    const particleCount = Math.min(8, 3 + Math.floor(comboCount / 5))
    spawnParticles(particleCount, x, y, customEmojis)
    if (scoreValue > 0) {
      const color = comboCount > 10 ? '#fbbf24' : comboCount > 5 ? '#f97316' : '#fff'
      showScorePopup(scoreValue, x, y, color)
    }
    advanceBgHue()
  }, [triggerShake, triggerFlash, spawnParticles, showScorePopup, advanceBgHue])

  // Update particles (call in RAF loop)
  const updateParticles = useCallback(() => {
    const now = performance.now()
    const alive = particlesRef.current.filter((p) => now - p.createdAt < lifetimeMs)
    if (alive.length !== particlesRef.current.length) {
      particlesRef.current = alive
      setParticles(alive)
    }
    const alivePopups = popupsRef.current.filter((p) => now - p.createdAt < 800)
    if (alivePopups.length !== popupsRef.current.length) {
      popupsRef.current = alivePopups
      setScorePopups(alivePopups)
    }
    if (shakeEndsAtRef.current > 0 && now >= shakeEndsAtRef.current) {
      shakeEndsAtRef.current = 0
      clearTimer(shakeTimerRef)
      setIsShaking(false)
      setShakeIntensity(0)
    }
    if (flashEndsAtRef.current > 0 && now >= flashEndsAtRef.current) {
      flashEndsAtRef.current = 0
      clearTimer(flashTimerRef)
      setIsFlashing(false)
    }
  }, [lifetimeMs])

  // Cleanup
  const cleanup = useCallback(() => {
    clearTimer(shakeTimerRef)
    clearTimer(flashTimerRef)
    shakeEndsAtRef.current = 0
    flashEndsAtRef.current = 0
    setIsShaking(false)
    setShakeIntensity(0)
    setIsFlashing(false)
  }, [])

  // Get shake transform style
  const getShakeStyle = useCallback((): React.CSSProperties | undefined => {
    if (!isShaking) return undefined
    return {
      transform: `translate(${(Math.random() - 0.5) * shakeIntensity * 2}px, ${(Math.random() - 0.5) * shakeIntensity * 2}px)`,
    }
  }, [isShaking, shakeIntensity])

  return {
    particles,
    scorePopups,
    isShaking,
    shakeIntensity,
    isFlashing,
    flashColor,
    bgPulseHue,
    spawnParticles,
    triggerShake,
    triggerFlash,
    showScorePopup,
    advanceBgHue,
    comboHitBurst,
    updateParticles,
    cleanup,
    getShakeStyle,
  }
}

// ─── Effect Renderer Components ─────────────────────────────────────

export function ParticleRenderer({ particles, lifetimeMs = PARTICLE_LIFETIME_MS }: {
  particles: Particle[]
  lifetimeMs?: number
}) {
  // eslint-disable-next-line react-hooks/purity
  const now = performance.now()
  return (
    <>
      {particles.map((p) => {
        const age = now - p.createdAt
        const progress = Math.min(1, age / lifetimeMs)
        const x = p.x + p.vx * progress * 0.4
        const y = p.y + p.vy * progress * 0.4 - 30 * progress
        if (p.type === 'circle') {
          return (
            <div
              key={p.id}
              style={{
                position: 'absolute',
                left: `${x}px`,
                top: `${y}px`,
                width: `${p.size * (1 - progress * 0.5)}px`,
                height: `${p.size * (1 - progress * 0.5)}px`,
                borderRadius: '50%',
                background: p.color,
                opacity: 1 - progress,
                pointerEvents: 'none',
                boxShadow: `0 0 ${p.size}px ${p.color}`,
              }}
            />
          )
        }
        return (
          <span
            key={p.id}
            style={{
              position: 'absolute',
              left: `${x}px`,
              top: `${y}px`,
              fontSize: `${p.size + 8}px`,
              opacity: 1 - progress,
              transform: `scale(${1 - progress * 0.6})`,
              pointerEvents: 'none',
              filter: `drop-shadow(0 0 4px ${p.color})`,
            }}
          >
            {p.emoji}
          </span>
        )
      })}
    </>
  )
}

export function ScorePopupRenderer({ popups }: { popups: ScorePopup[] }) {
  // eslint-disable-next-line react-hooks/purity
  const now = performance.now()
  return (
    <>
      {popups.map((p) => {
        const age = now - p.createdAt
        const progress = Math.min(1, age / 800)
        return (
          <span
            key={p.id}
            style={{
              position: 'absolute',
              left: `${p.x}px`,
              top: `${p.y - progress * 50}px`,
              fontSize: `${24 - progress * 6}px`,
              fontWeight: 'bold',
              color: p.color,
              textShadow: `0 2px 8px rgba(0,0,0,0.5), 0 0 12px ${p.color}`,
              pointerEvents: 'none',
              opacity: 1 - progress,
              transform: `scale(${1 + (1 - progress) * 0.3})`,
              zIndex: 20,
            }}
          >
            +{p.value}
          </span>
        )
      })}
    </>
  )
}

export function FlashOverlay({ isFlashing, flashColor }: {
  isFlashing: boolean
  flashColor: string
}) {
  if (!isFlashing) return null
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: flashColor,
        pointerEvents: 'none',
        zIndex: 15,
        borderRadius: 'inherit',
      }}
    />
  )
}

// ─── CSS Animation Keyframes (inject once) ──────────────────────────

export const GAME_EFFECTS_CSS = `
  @keyframes ge-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.08); }
  }

  @keyframes ge-bounce-in {
    0% { transform: scale(0.3) translateY(10px); opacity: 0; }
    60% { transform: scale(1.15) translateY(-4px); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }

  @keyframes ge-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-4px); }
    75% { transform: translateX(4px); }
  }

  @keyframes ge-glow-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(255,200,0,0.3); }
    50% { box-shadow: 0 0 24px rgba(255,200,0,0.8); }
  }

  @keyframes ge-float-up {
    0% { opacity: 1; transform: translateY(0) scale(1.2); }
    100% { opacity: 0; transform: translateY(-60px) scale(0.7); }
  }

  @keyframes ge-spin-in {
    0% { transform: rotate(-180deg) scale(0); opacity: 0; }
    100% { transform: rotate(0) scale(1); opacity: 1; }
  }

  @keyframes ge-ripple {
    0% { transform: scale(0.5); opacity: 0.8; }
    100% { transform: scale(3); opacity: 0; }
  }

  @keyframes ge-combo-flash {
    0% { background: rgba(255,255,0,0.3); }
    100% { background: transparent; }
  }

  @keyframes ge-score-fly {
    0% { opacity: 1; transform: translateY(0) scale(1.4); }
    100% { opacity: 0; transform: translateY(-50px) scale(0.8); }
  }

  @keyframes ge-hit-ring {
    0% { transform: scale(0.3); opacity: 1; border-width: 4px; }
    100% { transform: scale(2); opacity: 0; border-width: 1px; }
  }

  @keyframes ge-countdown-pop {
    0% { transform: scale(2.5); opacity: 0; }
    40% { transform: scale(0.85); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  @keyframes ge-rush-border {
    0% { border-color: rgba(239, 68, 68, 0.3); }
    100% { border-color: rgba(239, 68, 68, 0.8); }
  }

  @keyframes ge-rainbow-bg {
    0% { filter: hue-rotate(0deg); }
    100% { filter: hue-rotate(360deg); }
  }

  .ge-combo-label {
    animation: ge-bounce-in 0.3s ease-out;
    font-weight: bold;
    text-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }

  .ge-hit-ring {
    position: absolute;
    border: 3px solid rgba(255,255,255,0.8);
    border-radius: 50%;
    pointer-events: none;
    animation: ge-hit-ring 0.4s ease-out forwards;
  }

  .ge-ripple-effect {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
    animation: ge-ripple 0.5s ease-out forwards;
  }
`

// ─── Combo Label Utility ────────────────────────────────────────────

export function getComboLabel(combo: number): string {
  if (combo < 3) return ''
  if (combo < 5) return 'NICE!'
  if (combo < 10) return 'GREAT!'
  if (combo < 20) return 'AMAZING!'
  if (combo < 40) return 'FANTASTIC!'
  if (combo < 60) return 'UNBELIEVABLE!'
  return 'GODLIKE!'
}

export function getComboColor(combo: number): string {
  if (combo < 5) return '#22c55e'
  if (combo < 10) return '#3b82f6'
  if (combo < 20) return '#f59e0b'
  if (combo < 40) return '#ef4444'
  if (combo < 60) return '#ec4899'
  return '#a855f7'
}
