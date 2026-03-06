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
import comboHitSfx from '../../../assets/sounds/speed-tap-combo-hit.mp3'
import feverStartSfx from '../../../assets/sounds/speed-tap-fever-start.mp3'
import feverEndSfx from '../../../assets/sounds/speed-tap-fever-end.mp3'
import goldenTapSfx from '../../../assets/sounds/speed-tap-golden-tap.mp3'
import rushTimeSfx from '../../../assets/sounds/speed-tap-rush-time.mp3'
import multiTapSfx from '../../../assets/sounds/speed-tap-multi-tap.mp3'
import newRecordSfx from '../../../assets/sounds/speed-tap-new-record.mp3'
import goldenStarImg from '../../../assets/images/speed-tap/golden-star.png'
import feverFlameImg from '../../../assets/images/speed-tap/fever-flame.png'
import rushBoltImg from '../../../assets/images/speed-tap/rush-bolt.png'
import tapButtonImg from '../../../assets/images/speed-tap/tap-button.png'

const ROUND_DURATION_MS = 10000
const RUSH_TIME_THRESHOLD_MS = 3000
const COMBO_WINDOW_MS = 400
const COMBO_DECAY_MS = 800
const BASE_SCORE_PER_TAP = 1
const RUSH_MULTIPLIER = 2
const SHAKE_DURATION_MS = 120
const FLASH_DURATION_MS = 80
const PARTICLE_LIFETIME_MS = 600
const MAX_PARTICLES = 32

const FEVER_COMBO_THRESHOLD = 20
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 3
const GOLDEN_TAP_INTERVAL = 50
const GOLDEN_TAP_TIME_BONUS_MS = 1000

const COMBO_MILESTONE_THRESHOLDS = [10, 20, 30, 50, 75, 100] as const
const MULTI_TAP_WINDOW_MS = 80
const MULTI_TAP_BONUS = 3

const CHARACTER_FACES = [
  { id: 'park-sangmin', src: parkSangminImage, name: '\ubc15\uc0c1\ubbfc' },
  { id: 'song-changsik', src: songChangsikImage, name: '\uc1a1\ucc3d\uc2dd' },
  { id: 'tae-jina', src: taeJinaImage, name: '\ud0dc\uc9c4\uc544' },
  { id: 'park-wankyu', src: parkWankyuImage, name: '\ubc15\uc644\uaddc' },
  { id: 'kim-yeonja', src: kimYeonjaImage, name: '\uae40\uc5f0\uc790' },
  { id: 'seo-taiji', src: seoTaijiImage, name: '\uc11c\ud0dc\uc9c0' },
] as const

const TAP_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f43f5e', '#a855f7',
] as const

const TAP_EMOJIS = ['\u{1f4a5}', '\u26a1', '\u{1f525}', '\u{1f4ab}', '\u2728', '\u{1f31f}', '\u{1f4a2}', '\u{1f3af}'] as const

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
  readonly type: 'normal' | 'milestone' | 'fever' | 'golden'
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

function SpeedTapGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [tapCount, setTapCount] = useState(0)
  const [faceIndex, setFaceIndex] = useState(0)
  const [isShaking, setIsShaking] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)
  const [particles, setParticles] = useState<Particle[]>([])
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([])
  const [bgHue, setBgHue] = useState(0)
  const [gamePhase, setGamePhase] = useState<'playing' | 'finished'>('playing')
  const [lastTapScorePopup, setLastTapScorePopup] = useState<{ value: number; key: number } | null>(null)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [isGoldenTap, setIsGoldenTap] = useState(false)
  const [, setRushTriggered] = useState(false)
  const [milestoneFlash, setMilestoneFlash] = useState<string | null>(null)
  const [screenPulse, setScreenPulse] = useState(0)
  const [tapRipples, setTapRipples] = useState<Array<{ id: number; x: number; y: number; createdAt: number }>>([])
  const [isNewRecord, setIsNewRecord] = useState(false)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const tapCountRef = useRef(0)
  const lastTapAtRef = useRef(0)
  const faceIndexRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const particleIdRef = useRef(0)
  const particlesRef = useRef<Particle[]>([])
  const floatingTextIdRef = useRef(0)
  const floatingTextsRef = useRef<FloatingText[]>([])
  const bgHueRef = useRef(0)
  const gamePhaseRef = useRef<'playing' | 'finished'>('playing')
  const gameStartRef = useRef(0)
  const shakeTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const popupKeyRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const goldenTapTimerRef = useRef<number | null>(null)
  const rushTriggeredRef = useRef(false)
  const milestoneTimerRef = useRef<number | null>(null)
  const multiTapCountRef = useRef(0)
  const multiTapTimerRef = useRef<number | null>(null)
  const rippleIdRef = useRef(0)
  const lastMilestoneRef = useRef(0)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverStartAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverEndAudioRef = useRef<HTMLAudioElement | null>(null)
  const goldenTapAudioRef = useRef<HTMLAudioElement | null>(null)
  const rushTimeAudioRef = useRef<HTMLAudioElement | null>(null)
  const multiTapAudioRef = useRef<HTMLAudioElement | null>(null)
  const newRecordAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const spawnParticles = useCallback((count: number, centerX: number, centerY: number, type: Particle['type'] = 'normal') => {
    const newParticles: Particle[] = []
    const now = performance.now()
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.8
      const speed = type === 'milestone' ? 150 + Math.random() * 250 : 80 + Math.random() * 180
      particleIdRef.current += 1
      newParticles.push({
        id: particleIdRef.current,
        x: centerX + (Math.random() - 0.5) * 40,
        y: centerY + (Math.random() - 0.5) * 40,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: type === 'golden' ? '#fbbf24' : type === 'fever' ? '#ef4444' : TAP_COLORS[Math.floor(Math.random() * TAP_COLORS.length)],
        size: type === 'milestone' ? 10 + Math.random() * 14 : 6 + Math.random() * 10,
        createdAt: now,
        emoji: type === 'golden' ? '\u2b50' : type === 'fever' ? '\u{1f525}' : TAP_EMOJIS[Math.floor(Math.random() * TAP_EMOJIS.length)],
        type,
      })
    }
    const merged = [...particlesRef.current, ...newParticles].slice(-MAX_PARTICLES)
    particlesRef.current = merged
    setParticles(merged)
  }, [])

  const spawnFloatingText = useCallback((text: string, x: number, y: number, color: string, size = 20) => {
    floatingTextIdRef.current += 1
    const ft: FloatingText = {
      id: floatingTextIdRef.current,
      text,
      x,
      y,
      color,
      size,
      createdAt: performance.now(),
    }
    const merged = [...floatingTextsRef.current, ft].slice(-8)
    floatingTextsRef.current = merged
    setFloatingTexts(merged)
  }, [])

  const addTapRipple = useCallback((x: number, y: number) => {
    rippleIdRef.current += 1
    setTapRipples(prev => [...prev, { id: rippleIdRef.current, x, y, createdAt: performance.now() }].slice(-6))
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

  const triggerMilestoneFlash = useCallback((text: string) => {
    setMilestoneFlash(text)
    clearTimeoutSafe(milestoneTimerRef)
    milestoneTimerRef.current = window.setTimeout(() => {
      milestoneTimerRef.current = null
      setMilestoneFlash(null)
    }, 1200)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    gamePhaseRef.current = 'finished'
    setGamePhase('finished')

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.7, 0.9)

    if (scoreRef.current > bestScore) {
      setTimeout(() => {
        setIsNewRecord(true)
        playAudio(newRecordAudioRef, 0.7)
      }, 1200)
    }

    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio, bestScore])

  const handleTap = useCallback((pointerX?: number, pointerY?: number) => {
    if (gamePhaseRef.current !== 'playing' || finishedRef.current) return

    const now = performance.now()
    const timeSinceLastTap = now - lastTapAtRef.current
    lastTapAtRef.current = now

    // Multi-tap detection
    multiTapCountRef.current += 1
    if (multiTapTimerRef.current !== null) window.clearTimeout(multiTapTimerRef.current)
    multiTapTimerRef.current = window.setTimeout(() => {
      if (multiTapCountRef.current >= 3) {
        playAudio(multiTapAudioRef, 0.5)
        spawnFloatingText(`MULTI x${multiTapCountRef.current}!`, 50 + Math.random() * 100, 30 + Math.random() * 40, '#14b8a6', 18)
      }
      multiTapCountRef.current = 0
      multiTapTimerRef.current = null
    }, MULTI_TAP_WINDOW_MS)

    const isCombo = timeSinceLastTap < COMBO_WINDOW_MS
    const nextCombo = isCombo ? comboRef.current + 1 : 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    if (nextCombo > maxComboRef.current) {
      maxComboRef.current = nextCombo
      setMaxCombo(nextCombo)
    }

    tapCountRef.current += 1
    setTapCount(tapCountRef.current)

    const isRushTime = remainingMsRef.current <= RUSH_TIME_THRESHOLD_MS
    const rushMultiplier = isRushTime ? RUSH_MULTIPLIER : 1
    const comboBonus = toComboBonus(nextCombo)
    const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
    const multiTapBonus = multiTapCountRef.current >= 3 ? MULTI_TAP_BONUS : 0
    const tapScore = (BASE_SCORE_PER_TAP + comboBonus + multiTapBonus) * rushMultiplier * feverMult
    scoreRef.current += tapScore
    setScore(scoreRef.current)

    // Screen pulse based on combo
    setScreenPulse(Math.min(1, nextCombo / 50))

    // Fever activation
    if (nextCombo >= FEVER_COMBO_THRESHOLD && !isFeverRef.current) {
      isFeverRef.current = true
      feverMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverMs(FEVER_DURATION_MS)
      playAudio(feverStartAudioRef, 0.6)
      spawnParticles(12, 150, 150, 'fever')
      spawnFloatingText('FEVER TIME!', 80, 80, '#ef4444', 28)
    }

    // Combo milestones
    for (const threshold of COMBO_MILESTONE_THRESHOLDS) {
      if (nextCombo === threshold && lastMilestoneRef.current < threshold) {
        lastMilestoneRef.current = threshold
        playAudio(comboHitAudioRef, 0.6, 0.8 + threshold * 0.004)
        triggerMilestoneFlash(`${threshold} COMBO!`)
        spawnParticles(10, 150, 200, 'milestone')
        triggerShake(Math.min(12, 4 + threshold * 0.1))
        break
      }
    }

    // Golden tap
    if (tapCountRef.current > 0 && tapCountRef.current % GOLDEN_TAP_INTERVAL === 0) {
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + GOLDEN_TAP_TIME_BONUS_MS)
      setIsGoldenTap(true)
      playAudio(goldenTapAudioRef, 0.6)
      spawnParticles(8, 150, 150, 'golden')
      spawnFloatingText(`+${(GOLDEN_TAP_TIME_BONUS_MS / 1000).toFixed(0)}s!`, 120, 60, '#fbbf24', 24)
      if (goldenTapTimerRef.current !== null) window.clearTimeout(goldenTapTimerRef.current)
      goldenTapTimerRef.current = window.setTimeout(() => {
        goldenTapTimerRef.current = null
        setIsGoldenTap(false)
      }, 800)
    }

    // Rush time trigger (once)
    if (isRushTime && !rushTriggeredRef.current) {
      rushTriggeredRef.current = true
      setRushTriggered(true)
      playAudio(rushTimeAudioRef, 0.5)
      triggerShake(10)
      spawnFloatingText('RUSH TIME!', 60, 100, '#ef4444', 28)
    }

    popupKeyRef.current += 1
    setLastTapScorePopup({ value: tapScore, key: popupKeyRef.current })

    const nextFace = pickRandomFace(faceIndexRef.current)
    faceIndexRef.current = nextFace
    setFaceIndex(nextFace)

    bgHueRef.current = (bgHueRef.current + 25 + Math.random() * 15) % 360
    setBgHue(bgHueRef.current)

    const shakeLevel = Math.min(10, 2 + nextCombo * 0.3)
    triggerShake(shakeLevel)
    triggerFlash()

    // Tap ripple at pointer position
    if (pointerX !== undefined && pointerY !== undefined) {
      addTapRipple(pointerX, pointerY)
    }

    const particleCount = isRushTime ? 7 : isFeverRef.current ? 6 : (nextCombo > 10 ? 5 : 3)
    spawnParticles(particleCount, 50 + Math.random() * 200, 50 + Math.random() * 100)

    if (nextCombo > 0 && nextCombo % 10 === 0) {
      playAudio(tapHitStrongAudioRef, 0.6, 0.9 + nextCombo * 0.005)
    } else {
      const rate = 0.9 + Math.min(0.5, nextCombo * 0.015) + Math.random() * 0.1
      playAudio(tapHitAudioRef, 0.5, rate)
    }
  }, [playAudio, spawnParticles, spawnFloatingText, addTapRipple, triggerFlash, triggerShake, triggerMilestoneFlash])

  useEffect(() => {
    for (const face of CHARACTER_FACES) {
      const img = new Image()
      img.decoding = 'sync'
      img.src = face.src
      void img.decode?.().catch(() => {})
    }
    // Preload speed-tap specific images
    for (const src of [goldenStarImg, feverFlameImg, rushBoltImg, tapButtonImg]) {
      const img = new Image()
      img.src = src
    }

    const audioSources = [
      { ref: tapHitAudioRef, src: tapHitSfx },
      { ref: tapHitStrongAudioRef, src: tapHitStrongSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
      { ref: comboHitAudioRef, src: comboHitSfx },
      { ref: feverStartAudioRef, src: feverStartSfx },
      { ref: feverEndAudioRef, src: feverEndSfx },
      { ref: goldenTapAudioRef, src: goldenTapSfx },
      { ref: rushTimeAudioRef, src: rushTimeSfx },
      { ref: multiTapAudioRef, src: multiTapSfx },
      { ref: newRecordAudioRef, src: newRecordSfx },
    ]
    for (const { ref, src } of audioSources) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    }

    return () => {
      clearTimeoutSafe(shakeTimerRef)
      clearTimeoutSafe(flashTimerRef)
      clearTimeoutSafe(milestoneTimerRef)
      if (goldenTapTimerRef.current !== null) window.clearTimeout(goldenTapTimerRef.current)
      if (multiTapTimerRef.current !== null) window.clearTimeout(multiTapTimerRef.current)
      for (const { ref } of audioSources) ref.current = null
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

  // Main game loop - starts immediately (no countdown)
  useEffect(() => {
    gameStartRef.current = performance.now()

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

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Fever timer
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
          playAudio(feverEndAudioRef, 0.5)
        }
      }

      // Combo decay
      if (comboRef.current > 0) {
        const timeSinceLastTap = now - lastTapAtRef.current
        if (timeSinceLastTap > COMBO_DECAY_MS) {
          comboRef.current = 0
          setCombo(0)
          lastMilestoneRef.current = 0
        }
      }

      // Particle cleanup
      const aliveParticles = particlesRef.current.filter(
        (p) => now - p.createdAt < PARTICLE_LIFETIME_MS,
      )
      if (aliveParticles.length !== particlesRef.current.length) {
        particlesRef.current = aliveParticles
        setParticles(aliveParticles)
      }

      // Floating text cleanup
      const aliveTexts = floatingTextsRef.current.filter(
        (ft) => now - ft.createdAt < 1200,
      )
      if (aliveTexts.length !== floatingTextsRef.current.length) {
        floatingTextsRef.current = aliveTexts
        setFloatingTexts(aliveTexts)
      }

      // Ripple cleanup
      setTapRipples(prev => prev.filter(r => now - r.createdAt < 500))

      // Pulse decay
      setScreenPulse(prev => Math.max(0, prev - deltaMs * 0.002))

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
  }, [finishGame, playAudio])

  const isRushTime = remainingMs <= RUSH_TIME_THRESHOLD_MS && gamePhase === 'playing'
  const comboLabel = toComboLabel(combo)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const timerSeconds = (remainingMs / 1000).toFixed(1)
  const progressPercent = ((ROUND_DURATION_MS - remainingMs) / ROUND_DURATION_MS) * 100
  const currentFace = CHARACTER_FACES[faceIndex]
  const tps = remainingMs < ROUND_DURATION_MS ? ((tapCount / ((ROUND_DURATION_MS - remainingMs) / 1000)) || 0).toFixed(1) : '0.0'

  const shakeStyle = isShaking
    ? {
        transform: `translate(${(Math.random() - 0.5) * shakeIntensity * 2}px, ${(Math.random() - 0.5) * shakeIntensity * 2}px)`,
      }
    : undefined

  const handlePointerDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    handleTap(x, y)
  }, [handleTap])

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
          background: #f5f4ef;
        }

        .speed-tap-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 14px;
          gap: 8px;
        }

        .speed-tap-score {
          font-size: clamp(28px, 8vw, 36px);
          font-weight: 900;
          margin: 0;
          color: #1f2937;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.1);
          transition: color 0.1s, transform 0.1s;
        }

        .speed-tap-score.rush {
          color: #ef4444;
          animation: speed-tap-pulse 0.3s ease-in-out infinite alternate;
        }

        .speed-tap-score.fever-score {
          color: #f97316;
          text-shadow: 0 0 12px rgba(249, 115, 22, 0.5);
        }

        .speed-tap-best {
          font-size: 11px;
          color: #9ca3af;
          margin: 0;
        }

        .speed-tap-timer {
          font-size: clamp(22px, 6vw, 28px);
          font-weight: 900;
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
          height: 8px;
          background: #e8e5dc;
          border-radius: 4px;
          margin: 0 14px 4px;
          overflow: hidden;
          position: relative;
        }

        .speed-tap-progress-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.1s linear, background 0.3s;
        }

        .speed-tap-status-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 8px;
          padding: 2px 14px;
          min-height: 32px;
          flex-wrap: wrap;
        }

        .speed-tap-rush-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 16px;
          font-weight: 900;
          color: #ef4444;
          animation: speed-tap-rush-flash 0.2s ease-in-out infinite alternate;
          text-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
          letter-spacing: 4px;
        }

        .speed-tap-rush-banner img {
          width: 24px;
          height: 24px;
        }

        .speed-tap-fever-banner {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 16px;
          font-weight: 900;
          color: #f97316;
          animation: speed-tap-fever-glow 0.3s ease-in-out infinite alternate;
          text-shadow: 0 0 12px rgba(249, 115, 22, 0.6);
        }

        .speed-tap-fever-banner img {
          width: 28px;
          height: 28px;
          animation: speed-tap-fever-flame 0.2s ease-in-out infinite alternate;
        }

        .speed-tap-golden-banner {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 14px;
          font-weight: 800;
          color: #d97706;
          animation: speed-tap-bounce 0.5s ease-out;
        }

        .speed-tap-golden-banner img {
          width: 22px;
          height: 22px;
          animation: speed-tap-spin 0.6s ease-out;
        }

        .speed-tap-combo-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 12px;
          padding: 2px 14px;
          min-height: 30px;
        }

        .speed-tap-combo {
          font-size: 12px;
          color: #6b7280;
          margin: 0;
        }

        .speed-tap-combo strong {
          font-size: clamp(18px, 5vw, 22px);
          color: #f59e0b;
        }

        .speed-tap-combo-label {
          font-size: 15px;
          font-weight: 900;
          margin: 0;
          animation: speed-tap-bounce 0.3s ease-out;
        }

        .speed-tap-tap-zone {
          position: relative;
          flex: 1;
          margin: 6px 14px 8px;
          border-radius: 20px;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: background 0.15s, box-shadow 0.1s;
          border: 3px solid rgba(0,0,0,0.06);
          overflow: hidden;
        }

        .speed-tap-tap-zone.flash {
          box-shadow: inset 0 0 80px rgba(255, 255, 255, 0.7);
        }

        .speed-tap-tap-zone.rush-zone {
          border-color: rgba(239, 68, 68, 0.4);
          animation: speed-tap-rush-border 0.4s ease-in-out infinite alternate;
        }

        .speed-tap-tap-zone.fever-zone {
          border-color: rgba(249, 115, 22, 0.5);
          box-shadow: inset 0 0 40px rgba(249, 115, 22, 0.15), 0 0 20px rgba(249, 115, 22, 0.2);
        }

        .speed-tap-face {
          width: clamp(160px, 50vw, 220px);
          height: clamp(160px, 50vw, 220px);
          transition: transform 0.06s;
          pointer-events: none;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.15));
        }

        .speed-tap-face.tapped {
          transform: scale(1.12);
        }

        .speed-tap-tap-button-hint {
          width: clamp(48px, 14vw, 64px);
          height: clamp(48px, 14vw, 64px);
          opacity: 0.4;
          pointer-events: none;
          animation: speed-tap-tap-hint-bounce 0.8s ease-in-out infinite;
        }

        .speed-tap-tap-count {
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 700;
          color: rgba(255, 255, 255, 0.8);
          margin: 0;
          pointer-events: none;
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        .speed-tap-particle {
          position: absolute;
          pointer-events: none;
          font-size: 16px;
        }

        .speed-tap-score-popup {
          position: absolute;
          top: 25%;
          left: 50%;
          transform: translateX(-50%);
          font-size: clamp(24px, 7vw, 32px);
          font-weight: 900;
          color: #fff;
          text-shadow: 0 2px 8px rgba(0,0,0,0.4);
          pointer-events: none;
          animation: speed-tap-popup-rise 0.5s ease-out forwards;
        }

        .speed-tap-score-popup.rush-popup {
          color: #fbbf24;
          font-size: clamp(28px, 8vw, 36px);
        }

        .speed-tap-score-popup.fever-popup {
          color: #f97316;
          font-size: clamp(28px, 8vw, 36px);
          text-shadow: 0 0 12px rgba(249, 115, 22, 0.6);
        }

        .speed-tap-floating-text {
          position: absolute;
          pointer-events: none;
          font-weight: 900;
          text-shadow: 0 2px 6px rgba(0,0,0,0.3);
          animation: speed-tap-float-up 1.2s ease-out forwards;
          z-index: 5;
        }

        .speed-tap-ripple {
          position: absolute;
          pointer-events: none;
          border-radius: 50%;
          border: 3px solid rgba(255, 255, 255, 0.6);
          animation: speed-tap-ripple-expand 0.5s ease-out forwards;
        }

        .speed-tap-milestone-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
          pointer-events: none;
          animation: speed-tap-milestone-flash 1.2s ease-out forwards;
        }

        .speed-tap-milestone-text {
          font-size: clamp(36px, 10vw, 52px);
          font-weight: 900;
          color: #fff;
          text-shadow: 0 0 30px rgba(251, 191, 36, 0.8), 0 4px 20px rgba(0,0,0,0.4);
          animation: speed-tap-milestone-pop 0.6s ease-out;
          letter-spacing: 4px;
        }

        .speed-tap-stats {
          display: flex;
          justify-content: space-around;
          padding: 4px 14px;
          font-size: 12px;
          color: #9ca3af;
        }

        .speed-tap-stats p {
          margin: 0;
        }

        .speed-tap-actions {
          display: flex;
          justify-content: center;
          padding: 4px 14px 8px;
        }

        .speed-tap-finished-overlay {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          z-index: 30;
          background: rgba(0, 0, 0, 0.6);
          border-radius: 20px;
          animation: speed-tap-fade-in 0.3s ease-out;
          gap: 12px;
        }

        .speed-tap-finished-score {
          font-size: clamp(40px, 12vw, 56px);
          font-weight: 900;
          color: #fff;
          text-shadow: 0 4px 20px rgba(0,0,0,0.4);
          margin: 0;
          animation: speed-tap-countdown-pop 0.6s ease-out;
        }

        .speed-tap-finished-label {
          font-size: 16px;
          color: rgba(255, 255, 255, 0.7);
          margin: 0;
        }

        .speed-tap-new-record {
          position: absolute;
          top: 12%;
          left: 50%;
          transform: translateX(-50%);
          font-size: clamp(24px, 7vw, 32px);
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 20px rgba(251, 191, 36, 0.8), 0 0 40px rgba(251, 191, 36, 0.4);
          animation: speed-tap-new-record-enter 0.6s ease-out, speed-tap-pulse 0.4s 0.6s ease-in-out infinite alternate;
          margin: 0;
          white-space: nowrap;
          letter-spacing: 3px;
        }

        @keyframes speed-tap-new-record-enter {
          0% { opacity: 0; transform: translateX(-50%) scale(2.5); }
          60% { opacity: 1; transform: translateX(-50%) scale(0.9); }
          100% { opacity: 1; transform: translateX(-50%) scale(1); }
        }

        @keyframes speed-tap-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.08); }
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

        @keyframes speed-tap-fever-glow {
          from { opacity: 0.8; text-shadow: 0 0 8px rgba(249,115,22,0.4); }
          to { opacity: 1; text-shadow: 0 0 20px rgba(249,115,22,0.8); }
        }

        @keyframes speed-tap-fever-flame {
          from { transform: scale(1) rotate(-3deg); }
          to { transform: scale(1.1) rotate(3deg); }
        }

        @keyframes speed-tap-popup-rise {
          0% { opacity: 1; transform: translateX(-50%) translateY(0) scale(1.4); }
          100% { opacity: 0; transform: translateX(-50%) translateY(-60px) scale(0.7); }
        }

        @keyframes speed-tap-float-up {
          0% { opacity: 1; transform: translateY(0) scale(1.2); }
          100% { opacity: 0; transform: translateY(-80px) scale(0.6); }
        }

        @keyframes speed-tap-ripple-expand {
          0% { width: 0; height: 0; opacity: 0.8; transform: translate(-50%, -50%); }
          100% { width: 120px; height: 120px; opacity: 0; transform: translate(-50%, -50%); }
        }

        @keyframes speed-tap-countdown-pop {
          0% { transform: scale(2); opacity: 0; }
          40% { transform: scale(0.9); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

        @keyframes speed-tap-milestone-flash {
          0% { background: rgba(251, 191, 36, 0.3); }
          30% { background: rgba(251, 191, 36, 0.1); }
          100% { background: transparent; }
        }

        @keyframes speed-tap-milestone-pop {
          0% { transform: scale(0) rotate(-10deg); }
          50% { transform: scale(1.3) rotate(3deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        @keyframes speed-tap-spin {
          from { transform: rotate(0deg) scale(0.5); }
          to { transform: rotate(360deg) scale(1); }
        }

        @keyframes speed-tap-tap-hint-bounce {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.15); opacity: 0.5; }
        }

        @keyframes speed-tap-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>

      <div className="speed-tap-header">
        <div>
          <p className={`speed-tap-score ${isRushTime ? 'rush' : ''} ${isFever ? 'fever-score' : ''}`}>
            {score.toLocaleString()}
          </p>
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
              : isFever
                ? 'linear-gradient(90deg, #f97316, #fbbf24, #f97316)'
                : `hsl(${bgHue}, 70%, 55%)`,
          }}
        />
      </div>

      <div className="speed-tap-status-row">
        {isRushTime && (
          <span className="speed-tap-rush-banner">
            <img src={rushBoltImg} alt="" />
            RUSH x{RUSH_MULTIPLIER}
          </span>
        )}
        {isFever && (
          <span className="speed-tap-fever-banner">
            <img src={feverFlameImg} alt="" />
            FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
          </span>
        )}
        {isGoldenTap && (
          <span className="speed-tap-golden-banner">
            <img src={goldenStarImg} alt="" />
            GOLDEN TAP! +{(GOLDEN_TAP_TIME_BONUS_MS / 1000).toFixed(0)}s
          </span>
        )}
      </div>

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
        className={`speed-tap-tap-zone ${isFlashing ? 'flash' : ''} ${isRushTime ? 'rush-zone' : ''} ${isFever ? 'fever-zone' : ''}`}
        style={{
          ...shakeStyle,
          background: isFever
            ? `linear-gradient(135deg, hsl(${bgHue}, 85%, 42%), hsl(${(bgHue + 30) % 360}, 90%, 35%))`
            : isRushTime
              ? `linear-gradient(135deg, hsl(${bgHue}, 80%, 38%), hsl(${(bgHue + 40) % 360}, 90%, 30%))`
              : `linear-gradient(135deg, hsl(${bgHue}, 55%, 52%), hsl(${(bgHue + 60) % 360}, 50%, 47%))`,
          boxShadow: screenPulse > 0 ? `inset 0 0 ${60 * screenPulse}px rgba(255,255,255,${0.3 * screenPulse})` : undefined,
        }}
        onPointerDown={handlePointerDown}
        role="button"
        tabIndex={0}
        aria-label="Tap zone"
      >
        {/* Tap ripples */}
        {tapRipples.map((r) => (
          <div
            key={r.id}
            className="speed-tap-ripple"
            style={{ left: `${r.x}px`, top: `${r.y}px` }}
          />
        ))}

        {/* Milestone flash overlay */}
        {milestoneFlash && (
          <div className="speed-tap-milestone-overlay">
            <p className="speed-tap-milestone-text">{milestoneFlash}</p>
          </div>
        )}

        {/* Finished overlay */}
        {gamePhase === 'finished' && (
          <div className="speed-tap-finished-overlay">
            <p className="speed-tap-finished-label">FINAL SCORE</p>
            <p className="speed-tap-finished-score">{score.toLocaleString()}</p>
            {isNewRecord && <p className="speed-tap-new-record">NEW RECORD!</p>}
            <p className="speed-tap-finished-label">{tapCount} taps / max combo {maxCombo}</p>
          </div>
        )}

        <img
          className={`speed-tap-face ${isShaking ? 'tapped' : ''}`}
          src={currentFace.src}
          alt={currentFace.name}
        />

        {gamePhase === 'playing' && tapCount === 0 && (
          <img className="speed-tap-tap-button-hint" src={tapButtonImg} alt="" />
        )}

        <p className="speed-tap-tap-count">{tapCount} taps</p>

        {/* Floating texts */}
        {floatingTexts.map((ft) => {
          const age = performance.now() - ft.createdAt
          const progress = Math.min(1, age / 1200)
          return (
            <span
              key={ft.id}
              className="speed-tap-floating-text"
              style={{
                left: `${ft.x}px`,
                top: `${ft.y}px`,
                color: ft.color,
                fontSize: `${ft.size}px`,
                opacity: 1 - progress,
                transform: `translateY(${-60 * progress}px) scale(${1.2 - progress * 0.4})`,
              }}
            >
              {ft.text}
            </span>
          )
        })}

        {/* Particles */}
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
                transform: `scale(${1 - progress * 0.6}) rotate(${progress * 180}deg)`,
              }}
            >
              {p.emoji}
            </span>
          )
        })}

        {lastTapScorePopup && (
          <span
            key={lastTapScorePopup.key}
            className={`speed-tap-score-popup ${isRushTime ? 'rush-popup' : ''} ${isFever ? 'fever-popup' : ''}`}
          >
            +{lastTapScorePopup.value}
          </span>
        )}
      </div>

      <div className="speed-tap-stats">
        <p>{tapCount}\ud0ed</p>
        <p>TPS {tps}</p>
        <p>\ucf64\ubcf4 {maxCombo}</p>
      </div>

    </section>
  )
}

export const speedTapModule: MiniGameModule = {
  manifest: {
    id: 'speed-tap',
    title: 'Speed Tap',
    description: 'Tap like crazy for 10 seconds to get the highest score! Double points during RUSH TIME!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#ef4444',
  },
  Component: SpeedTapGame,
}
