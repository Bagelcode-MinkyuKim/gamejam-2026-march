import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'

import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'

import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import goSfx from '../../../assets/sounds/reaction-test-go.mp3'
import tooEarlySfx from '../../../assets/sounds/reaction-test-too-early.mp3'
import perfectSfx from '../../../assets/sounds/reaction-test-perfect.mp3'
import lightningSfx from '../../../assets/sounds/reaction-test-lightning.mp3'
import tickSfx from '../../../assets/sounds/reaction-test-tick.mp3'
import recordSfx from '../../../assets/sounds/reaction-test-record.mp3'

const TOTAL_ROUNDS = 8
const MIN_DELAY_MS = 1500
const MAX_DELAY_MS = 4500
const TOO_EARLY_DISPLAY_MS = 1000
const RESULT_DISPLAY_MS = 1200

const LIGHTNING_ROUND_START = 5
const LIGHTNING_MIN_DELAY_MS = 600
const LIGHTNING_MAX_DELAY_MS = 2000

const FAST_REACTION_THRESHOLD_MS = 250
const STREAK_MULTIPLIER_PER = 0.5

const PARTICLE_LIFETIME_MS = 600
const MAX_PARTICLES = 24

const CHARACTER_FACES = [
  { src: parkSangminImage, name: 'park-sangmin' },
  { src: songChangsikImage, name: 'song-changsik' },
  { src: taeJinaImage, name: 'tae-jina' },
  { src: parkWankyuImage, name: 'park-wankyu' },
  { src: kimYeonjaImage, name: 'kim-yeonja' },
  { src: seoTaijiImage, name: 'seo-taiji' },
] as const

const HIT_EMOJIS = ['💥', '⚡', '🔥', '💫', '✨', '🌟', '💢', '🎯'] as const
const HIT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6',
] as const

type Phase = 'countdown' | 'ready' | 'go' | 'too-early' | 'result' | 'finished'

interface Particle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
  readonly color: string
  readonly size: number
  readonly createdAt: number
  readonly emoji: string
}

interface Ripple {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly createdAt: number
  readonly color: string
}

interface FloatingText {
  readonly id: number
  readonly text: string
  readonly x: number
  readonly y: number
  readonly color: string
  readonly size: number
  readonly createdAt: number
}

function computeScore(avgMs: number): number {
  return Math.max(0, Math.round((500 - avgMs) * 5))
}

function randomDelay(round: number): number {
  if (round >= LIGHTNING_ROUND_START) {
    return LIGHTNING_MIN_DELAY_MS + Math.random() * (LIGHTNING_MAX_DELAY_MS - LIGHTNING_MIN_DELAY_MS)
  }
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)
}

function getReactionGrade(ms: number): { label: string; color: string; emoji: string } {
  if (ms < 150) return { label: 'PERFECT!', color: '#fbbf24', emoji: '⭐' }
  if (ms < 200) return { label: 'AMAZING!', color: '#a855f7', emoji: '💎' }
  if (ms < 250) return { label: 'GREAT!', color: '#22c55e', emoji: '🔥' }
  if (ms < 350) return { label: 'GOOD', color: '#3b82f6', emoji: '👍' }
  if (ms < 500) return { label: 'OK', color: '#9ca3af', emoji: '😐' }
  return { label: 'SLOW', color: '#6b7280', emoji: '🐢' }
}

function pickRandomFace(prev: number): number {
  let next = Math.floor(Math.random() * CHARACTER_FACES.length)
  while (next === prev && CHARACTER_FACES.length > 1) {
    next = Math.floor(Math.random() * CHARACTER_FACES.length)
  }
  return next
}

function ReactionTestGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [phase, setPhase] = useState<Phase>('countdown')
  const [countdownNum, setCountdownNum] = useState(3)
  const [currentRound, setCurrentRound] = useState(0)
  const [reactionTimes, setReactionTimes] = useState<number[]>([])
  const [lastReactionMs, setLastReactionMs] = useState<number | null>(null)
  const [lastGrade, setLastGrade] = useState<{ label: string; color: string; emoji: string } | null>(null)
  const [finalScore, setFinalScore] = useState(0)
  const [fastStreak, setFastStreak] = useState(0)
  const [isLightning, setIsLightning] = useState(false)
  const [faceIndex, setFaceIndex] = useState(0)
  const [isShaking, setIsShaking] = useState(false)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [isFlashing, setIsFlashing] = useState(false)
  const [flashColor, setFlashColor] = useState('rgba(255,255,255,0.6)')
  const [particles, setParticles] = useState<Particle[]>([])
  const [ripples, setRipples] = useState<Ripple[]>([])
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([])
  const [isNewRecord, setIsNewRecord] = useState(false)
  const [pulseScale, setPulseScale] = useState(1)

  const goTimestampRef = useRef(0)
  const delayTimerRef = useRef<number | null>(null)
  const tooEarlyTimerRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const startTimeRef = useRef(performance.now())
  const fastStreakRef = useRef(0)
  const currentRoundRef = useRef(0)
  const faceIndexRef = useRef(0)
  const phaseRef = useRef<Phase>('countdown')

  const particleIdRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const rippleIdRef = useRef(0)
  const floatingTextIdRef = useRef(0)
  const floatingTextsRef = useRef<FloatingText[]>([])
  const animFrameRef = useRef<number | null>(null)

  const shakeTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)

  // Audio refs
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({
    tapHit: null,
    tapHitStrong: null,
    gameOver: null,
    go: null,
    tooEarly: null,
    perfect: null,
    lightning: null,
    tick: null,
    record: null,
  })

  const clearTimerSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback((key: string, volume = 0.5, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (audio === null || audio === undefined) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const spawnParticles = useCallback((count: number, cx: number, cy: number, customEmojis?: readonly string[]) => {
    const now = performance.now()
    const emojis = customEmojis ?? HIT_EMOJIS
    const newP: Particle[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8
      const speed = 80 + Math.random() * 200
      particleIdRef.current += 1
      newP.push({
        id: particleIdRef.current,
        x: cx + (Math.random() - 0.5) * 30,
        y: cy + (Math.random() - 0.5) * 30,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: HIT_COLORS[Math.floor(Math.random() * HIT_COLORS.length)],
        size: 6 + Math.random() * 10,
        createdAt: now,
        emoji: emojis[Math.floor(Math.random() * emojis.length)],
      })
    }
    const merged = [...particlesRef.current, ...newP].slice(-MAX_PARTICLES)
    particlesRef.current = merged
    setParticles(merged)
  }, [])

  const addRipple = useCallback((x: number, y: number, color = 'rgba(255,255,255,0.6)') => {
    rippleIdRef.current += 1
    setRipples(prev => [...prev, { id: rippleIdRef.current, x, y, createdAt: performance.now(), color }].slice(-6))
  }, [])

  const spawnFloatingText = useCallback((text: string, x: number, y: number, color: string, size = 20) => {
    floatingTextIdRef.current += 1
    const ft: FloatingText = { id: floatingTextIdRef.current, text, x, y, color, size, createdAt: performance.now() }
    const merged = [...floatingTextsRef.current, ft].slice(-8)
    floatingTextsRef.current = merged
    setFloatingTexts(merged)
  }, [])

  const triggerShake = useCallback((intensity = 5, durationMs = 120) => {
    setIsShaking(true)
    setShakeIntensity(intensity)
    clearTimerSafe(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsShaking(false)
      setShakeIntensity(0)
    }, durationMs)
  }, [])

  const triggerFlash = useCallback((color = 'rgba(255,255,255,0.6)', durationMs = 80) => {
    setIsFlashing(true)
    setFlashColor(color)
    clearTimerSafe(flashTimerRef)
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      setIsFlashing(false)
    }, durationMs)
  }, [])

  const startRound = useCallback(() => {
    clearTimerSafe(delayTimerRef)
    clearTimerSafe(tooEarlyTimerRef)
    phaseRef.current = 'ready'
    setPhase('ready')
    setLastReactionMs(null)
    setLastGrade(null)

    const round = currentRoundRef.current
    const lightning = round >= LIGHTNING_ROUND_START
    setIsLightning(lightning)

    if (lightning && round === LIGHTNING_ROUND_START) {
      playAudio('lightning', 0.5)
      spawnFloatingText('LIGHTNING!', 100, 80, '#fbbf24', 26)
      triggerShake(8, 200)
      triggerFlash('rgba(251,191,36,0.3)', 150)
    }

    const nextFace = pickRandomFace(faceIndexRef.current)
    faceIndexRef.current = nextFace
    setFaceIndex(nextFace)

    const delay = randomDelay(round)
    delayTimerRef.current = window.setTimeout(() => {
      delayTimerRef.current = null
      goTimestampRef.current = performance.now()
      phaseRef.current = 'go'
      setPhase('go')
      playAudio('go', 0.6)
      triggerFlash('rgba(34,197,94,0.4)', 100)
      setPulseScale(1.15)
      setTimeout(() => setPulseScale(1), 150)
    }, delay)
  }, [playAudio, spawnFloatingText, triggerShake, triggerFlash])

  const handleTap = useCallback((pointerX?: number, pointerY?: number) => {
    if (finishedRef.current) return
    const currentPhase = phaseRef.current

    if (currentPhase === 'countdown') return

    if (currentPhase === 'ready') {
      clearTimerSafe(delayTimerRef)
      phaseRef.current = 'too-early'
      setPhase('too-early')
      playAudio('tooEarly', 0.5)
      triggerShake(6, 150)
      triggerFlash('rgba(249,115,22,0.4)', 100)
      if (pointerX !== undefined && pointerY !== undefined) {
        addRipple(pointerX, pointerY, 'rgba(249,115,22,0.6)')
      }
      spawnFloatingText('TOO EARLY!', 80 + Math.random() * 80, 120 + Math.random() * 40, '#f97316', 22)

      tooEarlyTimerRef.current = window.setTimeout(() => {
        tooEarlyTimerRef.current = null
        startRound()
      }, TOO_EARLY_DISPLAY_MS)
      return
    }

    if (currentPhase === 'go') {
      const now = performance.now()
      const reactionMs = Math.round(now - goTimestampRef.current)
      const clampedMs = Math.min(reactionMs, 9999)
      setLastReactionMs(clampedMs)

      const grade = getReactionGrade(clampedMs)
      setLastGrade(grade)

      const nextTimes = [...reactionTimes, clampedMs]
      setReactionTimes(nextTimes)

      if (clampedMs <= FAST_REACTION_THRESHOLD_MS) {
        fastStreakRef.current += 1
      } else {
        fastStreakRef.current = 0
      }
      setFastStreak(fastStreakRef.current)

      const streakMult = 1 + fastStreakRef.current * STREAK_MULTIPLIER_PER
      const roundScore = Math.round((500 - Math.min(clampedMs, 500)) * streakMult)

      const tapX = pointerX ?? 150
      const tapY = pointerY ?? 200

      if (pointerX !== undefined && pointerY !== undefined) {
        addRipple(pointerX, pointerY, grade.color)
      }

      if (clampedMs < 150) {
        playAudio('perfect', 0.6)
        triggerShake(8, 150)
        triggerFlash('rgba(251,191,36,0.4)', 120)
        spawnParticles(10, tapX, tapY, ['⭐', '💎', '✨', '🌟'])
        spawnFloatingText(`${grade.emoji} ${grade.label}`, 60 + Math.random() * 80, 80, grade.color, 28)
        spawnFloatingText(`+${roundScore}`, 120 + Math.random() * 60, 130, '#fbbf24', 24)
        setPulseScale(1.2)
      } else if (clampedMs < 250) {
        playAudio('tapHitStrong', 0.6, 1.1)
        triggerShake(5, 100)
        triggerFlash('rgba(34,197,94,0.3)', 80)
        spawnParticles(6, tapX, tapY)
        spawnFloatingText(`${grade.emoji} ${grade.label}`, 60 + Math.random() * 80, 100, grade.color, 22)
        spawnFloatingText(`+${roundScore}`, 130 + Math.random() * 50, 140, '#22c55e', 20)
        setPulseScale(1.12)
      } else if (clampedMs < 350) {
        playAudio('tapHit', 0.5, 1.0)
        triggerFlash('rgba(59,130,246,0.2)', 60)
        spawnParticles(4, tapX, tapY)
        spawnFloatingText(`${grade.label}`, 80 + Math.random() * 80, 110, grade.color, 18)
        spawnFloatingText(`+${roundScore}`, 140, 150, grade.color, 18)
        setPulseScale(1.06)
      } else {
        playAudio('tapHit', 0.4, 0.9)
        spawnParticles(2, tapX, tapY)
        spawnFloatingText(`+${roundScore}`, 140, 150, '#9ca3af', 16)
      }

      setTimeout(() => setPulseScale(1), 200)

      if (fastStreakRef.current >= 3) {
        spawnFloatingText(`STREAK x${fastStreakRef.current}!`, 50 + Math.random() * 100, 60, '#f59e0b', 20)
      }

      if (nextTimes.length >= TOTAL_ROUNDS) {
        const avg = nextTimes.reduce((sum, t) => sum + t, 0) / nextTimes.length
        const score = computeScore(avg)
        const streakBonus = Math.round(fastStreakRef.current * 50)
        const totalScore = score + streakBonus
        setFinalScore(totalScore)
        phaseRef.current = 'finished'
        setPhase('finished')
        finishedRef.current = true

        setTimeout(() => {
          playAudio('gameOver', 0.6)
          spawnParticles(12, 150, 200, ['🎉', '🏆', '⭐', '🎊'])
          if (totalScore > bestScore && bestScore > 0) {
            setTimeout(() => {
              setIsNewRecord(true)
              playAudio('record', 0.7)
            }, 800)
          }
        }, 300)
      } else {
        phaseRef.current = 'result'
        setPhase('result')
        const nextRound = nextTimes.length + 1
        currentRoundRef.current = nextRound
        setCurrentRound(nextRound)

        delayTimerRef.current = window.setTimeout(() => {
          delayTimerRef.current = null
          startRound()
        }, RESULT_DISPLAY_MS)
      }
      return
    }

    if (currentPhase === 'result') {
      clearTimerSafe(delayTimerRef)
      startRound()
      return
    }
  }, [reactionTimes, startRound, playAudio, triggerShake, triggerFlash, addRipple, spawnParticles, spawnFloatingText, bestScore])

  // Countdown on mount
  useEffect(() => {
    startTimeRef.current = performance.now()
    let count = 3
    setCountdownNum(3)

    const countdownInterval = setInterval(() => {
      count -= 1
      if (count > 0) {
        setCountdownNum(count)
        playAudio('tick', 0.4, 1.0 + (3 - count) * 0.15)
      } else {
        clearInterval(countdownInterval)
        currentRoundRef.current = 1
        setCurrentRound(1)
        startRound()
      }
    }, 800)

    playAudio('tick', 0.4)

    return () => clearInterval(countdownInterval)
  }, [startRound, playAudio])

  // Preload audio
  useEffect(() => {
    const sources: Record<string, string> = {
      tapHit: tapHitSfx,
      tapHitStrong: tapHitStrongSfx,
      gameOver: gameOverHitSfx,
      go: goSfx,
      tooEarly: tooEarlySfx,
      perfect: perfectSfx,
      lightning: lightningSfx,
      tick: tickSfx,
      record: recordSfx,
    }
    for (const [key, src] of Object.entries(sources)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }

    for (const face of CHARACTER_FACES) {
      const img = new Image()
      img.src = face.src
    }

    return () => {
      clearTimerSafe(delayTimerRef)
      clearTimerSafe(tooEarlyTimerRef)
      clearTimerSafe(shakeTimerRef)
      clearTimerSafe(flashTimerRef)
      for (const key of Object.keys(audioRefs.current)) {
        audioRefs.current[key] = null
      }
    }
  }, [])

  // Animation loop for particle/ripple cleanup
  useEffect(() => {
    const step = () => {
      const now = performance.now()
      const aliveP = particlesRef.current.filter(p => now - p.createdAt < PARTICLE_LIFETIME_MS)
      if (aliveP.length !== particlesRef.current.length) {
        particlesRef.current = aliveP
        setParticles(aliveP)
      }
      const aliveFt = floatingTextsRef.current.filter(ft => now - ft.createdAt < 1200)
      if (aliveFt.length !== floatingTextsRef.current.length) {
        floatingTextsRef.current = aliveFt
        setFloatingTexts(aliveFt)
      }
      setRipples(prev => {
        const filtered = prev.filter(r => now - r.createdAt < 500)
        return filtered.length === prev.length ? prev : filtered
      })
      animFrameRef.current = requestAnimationFrame(step)
    }
    animFrameRef.current = requestAnimationFrame(step)
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return }
      if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); handleTap() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, onExit])

  const onFinishCalledRef = useRef(false)
  const handleFinish = useCallback(() => {
    if (onFinishCalledRef.current) return
    onFinishCalledRef.current = true
    const elapsed = Math.round(Math.max(16.66, performance.now() - startTimeRef.current))
    onFinish({ score: finalScore, durationMs: elapsed })
  }, [finalScore, onFinish])

  const avgReactionMs = reactionTimes.length > 0
    ? Math.round(reactionTimes.reduce((sum, t) => sum + t, 0) / reactionTimes.length)
    : 0

  const currentFace = CHARACTER_FACES[faceIndex]

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    handleTap(event.clientX - rect.left, event.clientY - rect.top)
  }, [handleTap])

  const shakeStyle = isShaking
    ? { transform: `translate(${(Math.random() - 0.5) * shakeIntensity * 2}px, ${(Math.random() - 0.5) * shakeIntensity * 2}px)` }
    : undefined

  return (
    <section className="mini-game-panel rt-panel" aria-label="reaction-test-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden' }}>
      <style>{RT_CSS}</style>

      {/* Header */}
      <div className="rt-header">
        <div>
          <p className="rt-round-indicator">
            {phase === 'countdown' ? 'GET READY' : `Round ${currentRound} / ${TOTAL_ROUNDS}`}
          </p>
          {isLightning && phase !== 'countdown' && phase !== 'finished' && (
            <p className="rt-lightning-badge">LIGHTNING</p>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          {bestScore > 0 && <p className="rt-best">BEST {bestScore.toLocaleString()}</p>}
          {fastStreak >= 2 && (
            <p className="rt-streak">STREAK x{fastStreak} ({(1 + fastStreak * STREAK_MULTIPLIER_PER).toFixed(1)}x)</p>
          )}
        </div>
      </div>

      {/* Progress pips */}
      {reactionTimes.length > 0 && phase !== 'finished' && (
        <div className="rt-progress">
          {reactionTimes.map((time, i) => {
            const g = getReactionGrade(time)
            return (
              <span className="rt-pip" key={`pip-${i}`} style={{ background: g.color, color: '#fff' }}>
                {time}ms
              </span>
            )
          })}
          {Array.from({ length: TOTAL_ROUNDS - reactionTimes.length }).map((_, i) => (
            <span className="rt-pip rt-pip-empty" key={`empty-${i}`}>---</span>
          ))}
        </div>
      )}

      {/* Main tap area */}
      <div
        className={`rt-tap-zone ${phase === 'go' ? 'rt-tap-go' : ''} ${phase === 'ready' ? 'rt-tap-ready' : ''} ${phase === 'too-early' ? 'rt-tap-early' : ''} ${isLightning && phase !== 'finished' && phase !== 'countdown' ? 'rt-tap-lightning' : ''}`}
        style={{
          ...shakeStyle,
          background: phase === 'go'
            ? 'linear-gradient(135deg, #16a34a, #22c55e, #15803d)'
            : phase === 'ready'
              ? 'linear-gradient(135deg, #dc2626, #b91c1c, #991b1b)'
              : phase === 'too-early'
                ? 'linear-gradient(135deg, #f97316, #ea580c, #c2410c)'
                : phase === 'countdown'
                  ? 'linear-gradient(135deg, #4b5563, #374151, #1f2937)'
                  : 'linear-gradient(135deg, #f5f4ef, #ede9df)',
        }}
        onPointerDown={handlePointerDown}
        role="button"
        tabIndex={0}
        aria-label="Tap zone"
      >
        {/* Flash overlay */}
        {isFlashing && (
          <div style={{ position: 'absolute', inset: 0, background: flashColor, pointerEvents: 'none', zIndex: 15, borderRadius: 'inherit' }} />
        )}

        {/* Ripples */}
        {ripples.map(r => (
          <div key={r.id} className="rt-ripple" style={{ left: `${r.x}px`, top: `${r.y}px`, borderColor: r.color }} />
        ))}

        {/* Particles */}
        {particles.map(p => {
          const age = performance.now() - p.createdAt
          const progress = Math.min(1, age / PARTICLE_LIFETIME_MS)
          const x = p.x + p.vx * progress * 0.4
          const y = p.y + p.vy * progress * 0.4 - 30 * progress
          return (
            <span
              key={p.id}
              style={{
                position: 'absolute', left: `${x}px`, top: `${y}px`,
                fontSize: `${p.size + 8}px`, opacity: 1 - progress,
                transform: `scale(${1 - progress * 0.6}) rotate(${progress * 180}deg)`,
                pointerEvents: 'none', zIndex: 10,
                filter: `drop-shadow(0 0 4px ${p.color})`,
              }}
            >
              {p.emoji}
            </span>
          )
        })}

        {/* Floating texts */}
        {floatingTexts.map(ft => {
          const age = performance.now() - ft.createdAt
          const progress = Math.min(1, age / 1200)
          return (
            <span
              key={ft.id}
              className="rt-floating-text"
              style={{
                left: `${ft.x}px`, top: `${ft.y}px`, color: ft.color, fontSize: `${ft.size}px`,
                opacity: 1 - progress,
                transform: `translateY(${-60 * progress}px) scale(${1.2 - progress * 0.4})`,
              }}
            >
              {ft.text}
            </span>
          )
        })}

        {/* Countdown */}
        {phase === 'countdown' && (
          <div className="rt-countdown-container">
            <p className="rt-countdown-num" key={countdownNum}>{countdownNum}</p>
            <p className="rt-countdown-label">GET READY</p>
          </div>
        )}

        {/* Character + phase label */}
        {phase !== 'countdown' && phase !== 'finished' && (
          <div className="rt-character-area" style={{ transform: `scale(${pulseScale})`, transition: 'transform 0.15s ease-out' }}>
            <img
              className="rt-character"
              src={currentFace.src}
              alt={currentFace.name}
            />
            <p className="rt-phase-label" style={{ color: phase === 'go' ? '#fff' : phase === 'too-early' ? '#fff' : 'rgba(255,255,255,0.9)' }}>
              {phase === 'ready' ? 'WAIT...'
                : phase === 'go' ? 'TAP NOW!'
                : phase === 'too-early' ? 'TOO EARLY!'
                : phase === 'result' && lastReactionMs !== null ? `${lastReactionMs}ms`
                : ''}
            </p>
            {phase === 'result' && lastGrade && (
              <p className="rt-grade-label" style={{ color: lastGrade.color }}>
                {lastGrade.emoji} {lastGrade.label}
              </p>
            )}
            {phase === 'ready' && (
              <p className="rt-hint-label">Wait for green...</p>
            )}
            {phase === 'go' && (
              <div className="rt-go-ring" />
            )}
          </div>
        )}

        {/* Finished overlay */}
        {phase === 'finished' && (
          <div className="rt-finished-overlay">
            {isNewRecord && <p className="rt-new-record">NEW RECORD!</p>}
            <p className="rt-finished-label">RESULT</p>

            <div className="rt-times-grid">
              {reactionTimes.map((time, i) => {
                const g = getReactionGrade(time)
                return (
                  <div className="rt-time-row" key={`r-${i}`}>
                    <span className="rt-time-round">R{i + 1}</span>
                    <span className="rt-time-value" style={{ color: g.color }}>{time}ms</span>
                    <span style={{ fontSize: '14px' }}>{g.emoji}</span>
                  </div>
                )
              })}
            </div>

            <div className="rt-avg-block">
              <p className="rt-avg-label">AVG</p>
              <p className="rt-avg-value">{avgReactionMs}ms</p>
            </div>

            <div className="rt-score-block">
              <p className="rt-score-value">{finalScore.toLocaleString()}</p>
              {bestScore > 0 && (
                <p className="rt-score-best">BEST {bestScore.toLocaleString()}</p>
              )}
            </div>

            <div className="rt-final-actions">
              <button className="rt-btn-primary" type="button" onClick={handleFinish}>Complete</button>
              <button className="rt-btn-secondary" type="button" onClick={onExit}>Exit</button>
            </div>
          </div>
        )}
      </div>

      {/* Exit button */}
      {phase !== 'finished' && (
        <div className="rt-bottom-actions">
          <button className="text-button" type="button" onClick={onExit}>Exit</button>
        </div>
      )}
    </section>
  )
}

const RT_CSS = `
  .rt-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #f5f4ef;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  .rt-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px 14px 4px;
  }

  .rt-round-indicator {
    font-size: clamp(16px, 4.5vw, 20px);
    font-weight: 900;
    color: #1f2937;
    margin: 0;
  }

  .rt-lightning-badge {
    font-size: 12px;
    font-weight: 900;
    color: #fbbf24;
    margin: 2px 0 0;
    letter-spacing: 2px;
    animation: rt-pulse 0.4s ease-in-out infinite alternate;
    text-shadow: 0 0 8px rgba(251,191,36,0.5);
  }

  .rt-best {
    font-size: 11px;
    color: #9ca3af;
    margin: 0;
  }

  .rt-streak {
    font-size: 12px;
    font-weight: 800;
    color: #f59e0b;
    margin: 2px 0 0;
    animation: rt-bounce-in 0.3s ease-out;
  }

  .rt-progress {
    display: flex;
    gap: 4px;
    padding: 4px 14px;
    flex-wrap: wrap;
  }

  .rt-pip {
    flex: 1;
    min-width: 0;
    padding: 3px 2px;
    border-radius: 6px;
    text-align: center;
    font-size: 10px;
    font-weight: 700;
    white-space: nowrap;
  }

  .rt-pip-empty {
    background: #e8e5dc;
    color: #9ca3af;
  }

  .rt-tap-zone {
    position: relative;
    flex: 1;
    margin: 6px 14px 0;
    border-radius: 20px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    border: 3px solid rgba(0,0,0,0.06);
    transition: background 0.3s, border-color 0.3s;
  }

  .rt-tap-go {
    border-color: rgba(34,197,94,0.6);
    animation: rt-go-pulse 0.3s ease-in-out infinite alternate;
  }

  .rt-tap-ready {
    border-color: rgba(220,38,38,0.3);
  }

  .rt-tap-early {
    border-color: rgba(249,115,22,0.5);
    animation: rt-shake 0.15s ease-in-out 3;
  }

  .rt-tap-lightning {
    box-shadow: inset 0 0 30px rgba(251,191,36,0.1), 0 0 15px rgba(251,191,36,0.15);
  }

  .rt-character-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 5;
  }

  .rt-character {
    width: clamp(200px, 55vw, 280px);
    height: clamp(200px, 55vw, 280px);
    pointer-events: none;
    filter: drop-shadow(0 6px 20px rgba(0,0,0,0.2));
  }

  .rt-phase-label {
    font-size: clamp(32px, 9vw, 44px);
    font-weight: 900;
    margin: 0;
    text-shadow: 0 3px 12px rgba(0,0,0,0.3);
    letter-spacing: 2px;
    animation: rt-bounce-in 0.2s ease-out;
  }

  .rt-grade-label {
    font-size: clamp(22px, 6vw, 28px);
    font-weight: 900;
    margin: 0;
    text-shadow: 0 2px 8px rgba(0,0,0,0.2);
    animation: rt-bounce-in 0.3s ease-out;
  }

  .rt-hint-label {
    font-size: 14px;
    color: rgba(255,255,255,0.6);
    margin: 4px 0 0;
  }

  .rt-go-ring {
    position: absolute;
    width: 120px;
    height: 120px;
    border: 4px solid rgba(255,255,255,0.5);
    border-radius: 50%;
    animation: rt-ring-expand 0.6s ease-out infinite;
    pointer-events: none;
  }

  .rt-countdown-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    z-index: 5;
  }

  .rt-countdown-num {
    font-size: clamp(80px, 25vw, 120px);
    font-weight: 900;
    color: #fff;
    margin: 0;
    text-shadow: 0 4px 20px rgba(0,0,0,0.4);
    animation: rt-countdown-pop 0.6s ease-out;
  }

  .rt-countdown-label {
    font-size: clamp(18px, 5vw, 24px);
    font-weight: 700;
    color: rgba(255,255,255,0.7);
    margin: 0;
    letter-spacing: 4px;
  }

  .rt-ripple {
    position: absolute;
    pointer-events: none;
    border-radius: 50%;
    border: 3px solid rgba(255,255,255,0.6);
    animation: rt-ripple-expand 0.5s ease-out forwards;
    z-index: 8;
  }

  .rt-floating-text {
    position: absolute;
    pointer-events: none;
    font-weight: 900;
    text-shadow: 0 2px 6px rgba(0,0,0,0.3);
    z-index: 12;
    white-space: nowrap;
  }

  .rt-finished-overlay {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 30;
    background: rgba(0,0,0,0.7);
    border-radius: 20px;
    animation: rt-fade-in 0.3s ease-out;
    gap: 10px;
    padding: 20px;
  }

  .rt-new-record {
    font-size: clamp(22px, 6vw, 28px);
    font-weight: 900;
    color: #fbbf24;
    margin: 0;
    text-shadow: 0 0 20px rgba(251,191,36,0.8), 0 0 40px rgba(251,191,36,0.4);
    animation: rt-countdown-pop 0.6s ease-out, rt-pulse 0.4s 0.6s ease-in-out infinite alternate;
    letter-spacing: 3px;
  }

  .rt-finished-label {
    font-size: 16px;
    color: rgba(255,255,255,0.6);
    margin: 0;
    letter-spacing: 4px;
  }

  .rt-times-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    width: 100%;
    max-width: 260px;
  }

  .rt-time-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .rt-time-round {
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    font-weight: 700;
    min-width: 24px;
  }

  .rt-time-value {
    font-size: 14px;
    font-weight: 800;
  }

  .rt-avg-block {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .rt-avg-label {
    font-size: 14px;
    color: rgba(255,255,255,0.5);
    margin: 0;
    font-weight: 700;
  }

  .rt-avg-value {
    font-size: clamp(28px, 8vw, 36px);
    font-weight: 900;
    color: #fff;
    margin: 0;
    text-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }

  .rt-score-block {
    text-align: center;
  }

  .rt-score-value {
    font-size: clamp(36px, 10vw, 48px);
    font-weight: 900;
    color: #fbbf24;
    margin: 0;
    text-shadow: 0 0 20px rgba(251,191,36,0.5), 0 4px 12px rgba(0,0,0,0.3);
    animation: rt-countdown-pop 0.5s ease-out;
  }

  .rt-score-best {
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    margin: 2px 0 0;
  }

  .rt-final-actions {
    display: flex;
    gap: 12px;
    margin-top: 8px;
  }

  .rt-btn-primary {
    padding: 12px 32px;
    border-radius: 12px;
    border: none;
    background: linear-gradient(135deg, #16a34a, #22c55e);
    color: #fff;
    font-size: 16px;
    font-weight: 800;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(22,163,74,0.4);
  }

  .rt-btn-secondary {
    padding: 12px 24px;
    border-radius: 12px;
    border: 2px solid rgba(255,255,255,0.3);
    background: transparent;
    color: rgba(255,255,255,0.7);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }

  .rt-bottom-actions {
    display: flex;
    justify-content: center;
    padding: 6px 14px 10px;
  }

  @keyframes rt-pulse {
    from { transform: scale(1); }
    to { transform: scale(1.06); }
  }

  @keyframes rt-bounce-in {
    0% { transform: scale(0.5) translateY(8px); opacity: 0; }
    60% { transform: scale(1.15) translateY(-3px); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }

  @keyframes rt-go-pulse {
    from { border-color: rgba(34,197,94,0.4); box-shadow: 0 0 20px rgba(34,197,94,0.2); }
    to { border-color: rgba(34,197,94,0.9); box-shadow: 0 0 40px rgba(34,197,94,0.4); }
  }

  @keyframes rt-shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-6px); }
    75% { transform: translateX(6px); }
  }

  @keyframes rt-ring-expand {
    0% { transform: scale(0.5); opacity: 0.8; }
    100% { transform: scale(3); opacity: 0; }
  }

  @keyframes rt-countdown-pop {
    0% { transform: scale(2.5); opacity: 0; }
    40% { transform: scale(0.9); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  @keyframes rt-ripple-expand {
    0% { width: 0; height: 0; opacity: 0.8; transform: translate(-50%, -50%); }
    100% { width: 120px; height: 120px; opacity: 0; transform: translate(-50%, -50%); }
  }

  @keyframes rt-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
`

export const reactionTestModule: MiniGameModule = {
  manifest: {
    id: 'reaction-test',
    title: 'Reaction Test',
    description: 'Tap when green! 8 rounds, lightning mode after round 5!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#16a34a',
  },
  Component: ReactionTestGame,
}
