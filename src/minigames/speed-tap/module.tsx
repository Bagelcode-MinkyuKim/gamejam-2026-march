import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 10000
const RUSH_TIME_THRESHOLD_MS = 3000
const COMBO_WINDOW_MS = 400
const COMBO_DECAY_MS = 800
const BASE_SCORE_PER_TAP = 1
const RUSH_MULTIPLIER = 2
const SHAKE_DURATION_MS = 120
const FLASH_DURATION_MS = 80
const PARTICLE_LIFETIME_MS = 600
const MAX_PARTICLES = 24
const COUNTDOWN_DURATION_MS = 3000

// --- Gimmick constants ---
const FEVER_COMBO_THRESHOLD = 20
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 3
const GOLDEN_TAP_INTERVAL = 50
const GOLDEN_TAP_TIME_BONUS_MS = 1000

const CHARACTER_FACES = [
  { id: 'park-sangmin', src: parkSangminImage, name: '박상민' },
  { id: 'song-changsik', src: songChangsikImage, name: '송창식' },
  { id: 'tae-jina', src: taeJinaImage, name: '태진아' },
  { id: 'park-wankyu', src: parkWankyuImage, name: '박완규' },
  { id: 'kim-yeonja', src: kimYeonjaImage, name: '김연자' },
  { id: 'seo-taiji', src: seoTaijiImage, name: '서태지' },
] as const

const TAP_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f43f5e', '#a855f7',
] as const

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

function pickRandomFace(previousIndex: number): number {
  let next = Math.floor(Math.random() * CHARACTER_FACES.length)
  while (next === previousIndex && CHARACTER_FACES.length > 1) {
    next = Math.floor(Math.random() * CHARACTER_FACES.length)
  }
  return next
}

function toComboBonus(combo: number): number {
  if (combo < 5) return 0
  if (combo < 10) return 1
  if (combo < 20) return 2
  if (combo < 40) return 4
  return Math.floor(combo / 10)
}

function toComboLabel(combo: number): string {
  if (combo < 5) return ''
  if (combo < 10) return 'NICE!'
  if (combo < 20) return 'GREAT!'
  if (combo < 40) return 'AMAZING!'
  if (combo < 60) return 'FANTASTIC!'
  return 'GODLIKE!'
}

const TAP_EMOJIS = ['💥', '⚡', '🔥', '💫', '✨', '🌟', '💢', '🎯'] as const

function SpeedTapGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [tapCount, setTapCount] = useState(0)
  const [faceIndex, setFaceIndex] = useState(0)
  const [isShaking, setIsShaking] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [particles, setParticles] = useState<Particle[]>([])
  const [bgHue, setBgHue] = useState(0)
  const [gamePhase, setGamePhase] = useState<'countdown' | 'playing' | 'finished'>('countdown')
  const [countdownValue, setCountdownValue] = useState(3)
  const [lastTapScorePopup, setLastTapScorePopup] = useState<{ value: number; key: number } | null>(null)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [isGoldenTap, setIsGoldenTap] = useState(false)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const tapCountRef = useRef(0)
  const lastTapAtRef = useRef(0)
  const faceIndexRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const particleIdRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const bgHueRef = useRef(0)
  const gamePhaseRef = useRef<'countdown' | 'playing' | 'finished'>('countdown')
  const countdownStartRef = useRef(0)
  const gameStartRef = useRef(0)
  const shakeTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const popupKeyRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const goldenTapTimerRef = useRef<number | null>(null)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) return
      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const spawnParticles = useCallback((count: number, centerX: number, centerY: number) => {
    const newParticles: Particle[] = []
    const now = performance.now()
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8
      const speed = 80 + Math.random() * 180
      particleIdRef.current += 1
      newParticles.push({
        id: particleIdRef.current,
        x: centerX + (Math.random() - 0.5) * 40,
        y: centerY + (Math.random() - 0.5) * 40,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: TAP_COLORS[Math.floor(Math.random() * TAP_COLORS.length)],
        size: 6 + Math.random() * 10,
        createdAt: now,
        emoji: TAP_EMOJIS[Math.floor(Math.random() * TAP_EMOJIS.length)],
      })
    }
    const merged = [...particlesRef.current, ...newParticles].slice(-MAX_PARTICLES)
    particlesRef.current = merged
    setParticles(merged)
  }, [])

  const triggerShake = useCallback((intensity: number) => {
    setIsShaking(true)
    setShakeIntensity(intensity)
    clearTimeoutSafe(shakeTimerRef)
    shakeTimerRef.current = window.setTimeout(() => {
      shakeTimerRef.current = null
      setIsShaking(false)
      setShakeIntensity(0)
    }, SHAKE_DURATION_MS)
  }, [])

  const triggerFlash = useCallback(() => {
    setIsFlashing(true)
    clearTimeoutSafe(flashTimerRef)
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = null
      setIsFlashing(false)
    }, FLASH_DURATION_MS)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    gamePhaseRef.current = 'finished'
    setGamePhase('finished')

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.7, 0.9)
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const handleTap = useCallback(() => {
    if (gamePhaseRef.current !== 'playing' || finishedRef.current) return

    const now = performance.now()
    const timeSinceLastTap = now - lastTapAtRef.current
    lastTapAtRef.current = now

    const isCombo = timeSinceLastTap < COMBO_WINDOW_MS
    const nextCombo = isCombo ? comboRef.current + 1 : 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    tapCountRef.current += 1
    setTapCount(tapCountRef.current)

    const isRushTime = remainingMsRef.current <= RUSH_TIME_THRESHOLD_MS
    const rushMultiplier = isRushTime ? RUSH_MULTIPLIER : 1
    const comboBonus = toComboBonus(nextCombo)
    const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
    const tapScore = (BASE_SCORE_PER_TAP + comboBonus) * rushMultiplier * feverMult
    scoreRef.current += tapScore
    setScore(scoreRef.current)

    // Fever activation at combo threshold
    if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
      isFeverRef.current = true
      feverMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverMs(FEVER_DURATION_MS)
    }

    // Golden tap every N taps - bonus time
    if (tapCountRef.current > 0 && tapCountRef.current % GOLDEN_TAP_INTERVAL === 0) {
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + GOLDEN_TAP_TIME_BONUS_MS)
      setIsGoldenTap(true)
      if (goldenTapTimerRef.current !== null) window.clearTimeout(goldenTapTimerRef.current)
      goldenTapTimerRef.current = window.setTimeout(() => {
        goldenTapTimerRef.current = null
        setIsGoldenTap(false)
      }, 500)
    }

    popupKeyRef.current += 1
    setLastTapScorePopup({ value: tapScore, key: popupKeyRef.current })

    const nextFace = pickRandomFace(faceIndexRef.current)
    faceIndexRef.current = nextFace
    setFaceIndex(nextFace)

    bgHueRef.current = (bgHueRef.current + 25 + Math.random() * 15) % 360
    setBgHue(bgHueRef.current)

    const shakeLevel = Math.min(8, 2 + nextCombo * 0.3)
    triggerShake(shakeLevel)
    triggerFlash()

    const particleCount = isRushTime ? 6 : (nextCombo > 10 ? 5 : 3)
    spawnParticles(particleCount, 50 + Math.random() * 200, 50 + Math.random() * 100)

    if (nextCombo > 0 && nextCombo % 10 === 0) {
      playAudio(tapHitStrongAudioRef, 0.6, 0.9 + nextCombo * 0.005)
    } else {
      const rate = 0.9 + Math.min(0.5, nextCombo * 0.015) + Math.random() * 0.1
      playAudio(tapHitAudioRef, 0.5, rate)
    }
  }, [playAudio, spawnParticles, triggerFlash, triggerShake])

  useEffect(() => {
    for (const face of CHARACTER_FACES) {
      const img = new Image()
      img.decoding = 'sync'
      img.src = face.src
      void img.decode?.().catch(() => {})
    }

    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      clearTimeoutSafe(shakeTimerRef)
      clearTimeoutSafe(flashTimerRef)
      if (goldenTapTimerRef.current !== null) window.clearTimeout(goldenTapTimerRef.current)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }

      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault()
        handleTap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, onExit])

  useEffect(() => {
    countdownStartRef.current = performance.now()

    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) {
        lastFrameAtRef.current = now
      }

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      if (gamePhaseRef.current === 'countdown') {
        const countdownElapsed = now - countdownStartRef.current
        const remaining = Math.max(0, COUNTDOWN_DURATION_MS - countdownElapsed)
        const nextValue = Math.ceil(remaining / 1000)
        setCountdownValue(nextValue)
        if (remaining <= 0) {
          gamePhaseRef.current = 'playing'
          setGamePhase('playing')
          gameStartRef.current = now
          lastFrameAtRef.current = now
        }
        animationFrameRef.current = window.requestAnimationFrame(step)
        return
      }

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Fever timer
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      if (comboRef.current > 0) {
        const timeSinceLastTap = now - lastTapAtRef.current
        if (timeSinceLastTap > COMBO_DECAY_MS) {
          comboRef.current = 0
          setCombo(0)
        }
      }

      const aliveParticles = particlesRef.current.filter(
        (p) => now - p.createdAt < PARTICLE_LIFETIME_MS,
      )
      if (aliveParticles.length !== particlesRef.current.length) {
        particlesRef.current = aliveParticles
        setParticles(aliveParticles)
      }

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
      }

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
  }, [finishGame])

  const isRushTime = remainingMs <= RUSH_TIME_THRESHOLD_MS && gamePhase === 'playing'
  const comboLabel = toComboLabel(combo)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const timerSeconds = (remainingMs / 1000).toFixed(1)
  const progressPercent = ((ROUND_DURATION_MS - remainingMs) / ROUND_DURATION_MS) * 100
  const currentFace = CHARACTER_FACES[faceIndex]

  const shakeStyle = isShaking
    ? {
        transform: `translate(${(Math.random() - 0.5) * shakeIntensity * 2}px, ${(Math.random() - 0.5) * shakeIntensity * 2}px)`,
      }
    : undefined

  return (
    <section className="mini-game-panel speed-tap-panel" aria-label="speed-tap-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden' }}>
      <style>{`
        .speed-tap-panel {
          position: relative;
          overflow: hidden;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #f8fafc;
        }

        .speed-tap-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 12px;
          gap: 8px;
        }

        .speed-tap-score {
          font-size: 28px;
          font-weight: bold;
          margin: 0;
          color: #1f2937;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.1);
          transition: color 0.1s;
        }

        .speed-tap-score.rush {
          color: #ef4444;
          animation: speed-tap-pulse 0.3s ease-in-out infinite alternate;
        }

        .speed-tap-best {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
        }

        .speed-tap-timer {
          font-size: 20px;
          font-weight: bold;
          margin: 0;
          color: #374151;
          min-width: 60px;
          text-align: right;
        }

        .speed-tap-timer.low {
          color: #ef4444;
          animation: speed-tap-pulse 0.25s ease-in-out infinite alternate;
        }

        .speed-tap-timer.rush {
          color: #dc2626;
          text-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
        }

        .speed-tap-progress-bar {
          height: 6px;
          background: #e5e7eb;
          border-radius: 3px;
          margin: 0 12px 4px;
          overflow: hidden;
          position: relative;
        }

        .speed-tap-progress-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.1s linear, background 0.3s;
        }

        .speed-tap-rush-banner {
          text-align: center;
          font-size: 18px;
          font-weight: bold;
          color: #ef4444;
          margin: 2px 0;
          animation: speed-tap-rush-flash 0.2s ease-in-out infinite alternate;
          text-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
          letter-spacing: 6px;
        }

        .speed-tap-combo-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          padding: 2px 12px;
          min-height: 28px;
        }

        .speed-tap-combo {
          font-size: 11px;
          color: #6b7280;
          margin: 0;
        }

        .speed-tap-combo strong {
          font-size: 16px;
          color: #f59e0b;
        }

        .speed-tap-combo-label {
          font-size: 13px;
          font-weight: bold;
          margin: 0;
          animation: speed-tap-bounce 0.3s ease-out;
        }

        .speed-tap-tap-zone {
          position: relative;
          flex: 1;
          margin: 4px 12px 8px;
          border-radius: 16px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.15s, box-shadow 0.1s;
          border: 4px solid rgba(0,0,0,0.08);
          overflow: hidden;
        }

        .speed-tap-tap-zone.flash {
          box-shadow: inset 0 0 60px rgba(255, 255, 255, 0.6);
        }

        .speed-tap-tap-zone.rush-zone {
          border-color: rgba(239, 68, 68, 0.4);
          animation: speed-tap-rush-border 0.4s ease-in-out infinite alternate;
        }

        .speed-tap-face {
          width: 140px;
          height: 140px;
          border-radius: 50%;
          border: 4px solid rgba(255, 255, 255, 0.7);
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
          transition: transform 0.08s;
          pointer-events: none;
        }

        .speed-tap-face.tapped {
          transform: scale(1.15);
        }

        .speed-tap-hint {
          font-size: 14px;
          color: rgba(255, 255, 255, 0.8);
          margin: 0;
          pointer-events: none;
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        .speed-tap-tap-count {
          font-size: 13px;
          color: rgba(255, 255, 255, 0.6);
          margin: 0;
          pointer-events: none;
        }

        .speed-tap-particle {
          position: absolute;
          pointer-events: none;
          font-size: 16px;
          animation: speed-tap-particle-fade 0.6s ease-out forwards;
        }

        .speed-tap-score-popup {
          position: absolute;
          top: 30%;
          left: 50%;
          transform: translateX(-50%);
          font-size: 24px;
          font-weight: bold;
          color: #fff;
          text-shadow: 0 2px 8px rgba(0,0,0,0.4);
          pointer-events: none;
          animation: speed-tap-popup-rise 0.5s ease-out forwards;
        }

        .speed-tap-score-popup.rush-popup {
          color: #fbbf24;
          font-size: 28px;
        }

        .speed-tap-countdown {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10;
          background: rgba(0, 0, 0, 0.5);
          border-radius: 16px;
        }

        .speed-tap-countdown-number {
          font-size: 72px;
          font-weight: bold;
          color: #fff;
          text-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          animation: speed-tap-countdown-pop 0.8s ease-out;
        }

        .speed-tap-countdown-go {
          font-size: 48px;
          font-weight: bold;
          color: #fbbf24;
          text-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          animation: speed-tap-countdown-pop 0.5s ease-out;
        }

        .speed-tap-stats {
          display: flex;
          justify-content: space-around;
          padding: 4px 12px;
          font-size: 12px;
          color: #9ca3af;
        }

        .speed-tap-stats p {
          margin: 0;
        }

        .speed-tap-actions {
          display: flex;
          justify-content: center;
          padding: 4px 12px 8px;
        }

        @keyframes speed-tap-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.06); }
        }

        @keyframes speed-tap-bounce {
          0% { transform: scale(0.5) translateY(8px); opacity: 0; }
          60% { transform: scale(1.2) translateY(-2px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        @keyframes speed-tap-rush-flash {
          from { opacity: 0.7; transform: scale(1); }
          to { opacity: 1; transform: scale(1.05); }
        }

        @keyframes speed-tap-rush-border {
          from { border-color: rgba(239, 68, 68, 0.3); }
          to { border-color: rgba(239, 68, 68, 0.8); }
        }

        @keyframes speed-tap-particle-fade {
          0% { opacity: 1; transform: scale(1) translate(0, 0); }
          100% { opacity: 0; transform: scale(0.3) translate(var(--px, 0), var(--py, -40px)); }
        }

        @keyframes speed-tap-popup-rise {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.3); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-50px) scale(0.8); }
        }

        @keyframes speed-tap-countdown-pop {
          0% { transform: scale(2); opacity: 0; }
          40% { transform: scale(0.9); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>

      <div className="speed-tap-header">
        <div>
          <p className={`speed-tap-score ${isRushTime ? 'rush' : ''}`}>{score.toLocaleString()}</p>
          <p className="speed-tap-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`speed-tap-timer ${remainingMs <= 5000 ? 'low' : ''} ${isRushTime ? 'rush' : ''}`}>
          {timerSeconds}s
        </p>
      </div>

      <div className="speed-tap-progress-bar">
        <div
          className="speed-tap-progress-fill"
          style={{
            width: `${progressPercent}%`,
            background: isRushTime
              ? 'linear-gradient(90deg, #ef4444, #f97316, #ef4444)'
              : `hsl(${bgHue}, 70%, 55%)`,
          }}
        />
      </div>

      {isRushTime && <p className="speed-tap-rush-banner">RUSH TIME x2</p>}
      {isFever && (
        <p style={{
          textAlign: 'center', fontSize: 16, fontWeight: 900, color: '#fbbf24',
          margin: '2px 0', letterSpacing: 4,
          textShadow: '0 0 12px rgba(251,191,36,0.7)',
          animation: 'speed-tap-rush-flash 0.2s ease-in-out infinite alternate',
        }}>
          FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
        </p>
      )}
      {isGoldenTap && (
        <p style={{
          textAlign: 'center', fontSize: 14, fontWeight: 800, color: '#fde68a',
          margin: '0', animation: 'speed-tap-bounce 0.5s ease-out',
        }}>
          GOLDEN TAP! +{(GOLDEN_TAP_TIME_BONUS_MS / 1000).toFixed(1)}s
        </p>
      )}

      <div className="speed-tap-combo-row">
        <p className="speed-tap-combo">
          COMBO <strong>{combo}</strong>
        </p>
        {comboLabel && (
          <p
            className="speed-tap-combo-label"
            key={combo}
            style={{ color: TAP_COLORS[combo % TAP_COLORS.length] }}
          >
            {comboLabel}
          </p>
        )}
      </div>

      <div
        className={`speed-tap-tap-zone ${isFlashing ? 'flash' : ''} ${isRushTime ? 'rush-zone' : ''}`}
        style={{
          ...shakeStyle,
          background: isRushTime
            ? `linear-gradient(135deg, hsl(${bgHue}, 80%, 38%), hsl(${(bgHue + 40) % 360}, 90%, 30%))`
            : `linear-gradient(135deg, hsl(${bgHue}, 60%, 50%), hsl(${(bgHue + 60) % 360}, 55%, 45%))`,
        }}
        onPointerDown={(event) => {
          event.preventDefault()
          handleTap()
        }}
        role="button"
        tabIndex={0}
        aria-label="Tap zone"
      >
        {gamePhase === 'countdown' && (
          <div className="speed-tap-countdown">
            {countdownValue > 0 ? (
              <p className="speed-tap-countdown-number" key={countdownValue}>
                {countdownValue}
              </p>
            ) : (
              <p className="speed-tap-countdown-go">GO!</p>
            )}
          </div>
        )}

        <img
          className={`speed-tap-face ${isShaking ? 'tapped' : ''}`}
          src={currentFace.src}
          alt={currentFace.name}
        />
        <p className="speed-tap-hint">
          {gamePhase === 'playing'
            ? isRushTime
              ? 'RUSH! TAP FASTER!'
              : 'TAP! TAP! TAP!'
            : ''}
        </p>
        <p className="speed-tap-tap-count">{tapCount} taps</p>

        {particles.map((p) => {
          const age = performance.now() - p.createdAt
          const progress = Math.min(1, age / PARTICLE_LIFETIME_MS)
          const x = p.x + p.vx * progress * 0.4
          const y = p.y + p.vy * progress * 0.4 - 30 * progress
          return (
            <span
              key={p.id}
              className="speed-tap-particle"
              style={{
                left: `${x}px`,
                top: `${y}px`,
                fontSize: `${p.size + 8}px`,
                opacity: 1 - progress,
                transform: `scale(${1 - progress * 0.6})`,
              }}
            >
              {p.emoji}
            </span>
          )
        })}

        {lastTapScorePopup && (
          <span
            key={lastTapScorePopup.key}
            className={`speed-tap-score-popup ${isRushTime ? 'rush-popup' : ''}`}
          >
            +{lastTapScorePopup.value}
          </span>
        )}
      </div>

      <div className="speed-tap-stats">
        <p>탭 {tapCount}회</p>
        <p>TPS {remainingMs < ROUND_DURATION_MS ? ((tapCount / ((ROUND_DURATION_MS - remainingMs) / 1000)) || 0).toFixed(1) : '0.0'}</p>
        <p>최대콤보 {combo}</p>
      </div>

      <div className="speed-tap-actions">
        <button className="text-button" type="button" onClick={onExit}>
          허브로 돌아가기
        </button>
      </div>
    </section>
  )
}

export const speedTapModule: MiniGameModule = {
  manifest: {
    id: 'speed-tap',
    title: 'Speed Tap',
    description: '10초간 미친듯이 탭해서 최고 점수를 노려라! RUSH TIME에는 점수 2배!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#ef4444',
  },
  Component: SpeedTapGame,
}
