import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'

import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'

import goSfx from '../../../assets/sounds/reaction-test-go.mp3'
import tooEarlySfx from '../../../assets/sounds/reaction-test-too-early.mp3'
import perfectSfx from '../../../assets/sounds/reaction-test-perfect.mp3'
import lightningSfx from '../../../assets/sounds/reaction-test-lightning.mp3'
import tickSfx from '../../../assets/sounds/reaction-test-tick.mp3'
import recordSfx from '../../../assets/sounds/reaction-test-record.mp3'
import comboSfx from '../../../assets/sounds/reaction-test-combo.mp3'
import missSfx from '../../../assets/sounds/reaction-test-miss.mp3'
import roundSfx from '../../../assets/sounds/reaction-test-round.mp3'
import fakeoutSfx from '../../../assets/sounds/reaction-test-fakeout.mp3'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import bgmSfx from '../../../assets/sounds/reaction-test-bgm.mp3'
import countdownSfx from '../../../assets/sounds/reaction-test-countdown.mp3'
import godlikeSfx from '../../../assets/sounds/reaction-test-godlike.mp3'
import feverSfx from '../../../assets/sounds/reaction-test-fever.mp3'
import healSfx from '../../../assets/sounds/reaction-test-heal.mp3'
import streakBreakSfx from '../../../assets/sounds/reaction-test-streak-break.mp3'

// ─── Game Config ─────────────────────────────────────────────
const TOTAL_ROUNDS = 10
const MAX_LIVES = 3
const MIN_DELAY_MS = 1500
const MAX_DELAY_MS = 4000
const TOO_EARLY_DISPLAY_MS = 800
const RESULT_DISPLAY_MS = 1000

// Speed ramps: delay shrinks as rounds progress
const SPEED_RAMP_PER_ROUND = 150
const MIN_POSSIBLE_DELAY = 400

// Lightning mode
const LIGHTNING_ROUND = 6
const LIGHTNING_MIN_DELAY = 400
const LIGHTNING_MAX_DELAY = 1500

// Fake-out
const FAKEOUT_START_ROUND = 3
const FAKEOUT_CHANCE = 0.35
const FAKEOUT_FLASH_MS = 180

// Streak
const FAST_THRESHOLD_MS = 250
const STREAK_MULT_PER = 0.5

// Fever mode
const FEVER_STREAK_THRESHOLD = 5
const FEVER_SCORE_MULT = 3

// Life recovery
const HEAL_STREAK_THRESHOLD = 8

// Pixel particles
const PARTICLE_LIFETIME = 600
const MAX_PARTICLES = 48

// Shockwave rings
const RING_LIFETIME = 500
const MAX_RINGS = 8

// Spark rain
const SPARK_LIFETIME = 800
const MAX_SPARKS = 24

const CHARACTER_FACES = [
  { src: parkSangminImage, name: 'park-sangmin' },
  { src: songChangsikImage, name: 'song-changsik' },
  { src: taeJinaImage, name: 'tae-jina' },
  { src: parkWankyuImage, name: 'park-wankyu' },
  { src: kimYeonjaImage, name: 'kim-yeonja' },
  { src: seoTaijiImage, name: 'seo-taiji' },
] as const

const PIXEL_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#fff'] as const
const FEVER_COLORS = ['#ff0080', '#ff00ff', '#8000ff', '#00ffff', '#ffff00', '#ff4444', '#fff'] as const

type Phase = 'countdown' | 'ready' | 'fakeout' | 'go' | 'too-early' | 'result' | 'bonus-round' | 'finished'

interface PixelParticle {
  id: number; x: number; y: number; vx: number; vy: number
  color: string; size: number; createdAt: number
}

interface FloatingText {
  id: number; text: string; x: number; y: number
  color: string; size: number; createdAt: number
}

interface ShockRing {
  id: number; x: number; y: number; color: string; createdAt: number
}

interface SparkDrop {
  id: number; x: number; y: number; vy: number; color: string; size: number; createdAt: number
}

function computeScore(avgMs: number): number {
  return Math.max(0, Math.round((500 - avgMs) * 5))
}

function randomDelay(round: number): number {
  if (round >= LIGHTNING_ROUND) {
    return LIGHTNING_MIN_DELAY + Math.random() * (LIGHTNING_MAX_DELAY - LIGHTNING_MIN_DELAY)
  }
  const base = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)
  return Math.max(MIN_POSSIBLE_DELAY, base - round * SPEED_RAMP_PER_ROUND)
}

function getGrade(ms: number): { label: string; color: string; stars: number } {
  if (ms < 120) return { label: 'GODLIKE!!', color: '#ff00ff', stars: 5 }
  if (ms < 170) return { label: 'PERFECT!', color: '#fbbf24', stars: 4 }
  if (ms < 220) return { label: 'GREAT!', color: '#22c55e', stars: 3 }
  if (ms < 320) return { label: 'GOOD', color: '#3b82f6', stars: 2 }
  if (ms < 450) return { label: 'OK', color: '#9ca3af', stars: 1 }
  return { label: 'SLOW..', color: '#6b7280', stars: 0 }
}

function pickFace(prev: number): number {
  let n = Math.floor(Math.random() * CHARACTER_FACES.length)
  while (n === prev && CHARACTER_FACES.length > 1) n = Math.floor(Math.random() * CHARACTER_FACES.length)
  return n
}

function shouldFakeout(round: number): boolean {
  return round >= FAKEOUT_START_ROUND && Math.random() < FAKEOUT_CHANCE
}

// ─── Component ───────────────────────────────────────────────
function ReactionTestGame({ onFinish, bestScore = 0 }: MiniGameSessionProps) {
  const [phase, setPhase] = useState<Phase>('countdown')
  const [countdownNum, setCountdownNum] = useState(3)
  const [round, setRound] = useState(0)
  const [lives, setLives] = useState(MAX_LIVES)
  const [times, setTimes] = useState<number[]>([])
  const [lastMs, setLastMs] = useState<number | null>(null)
  const [lastGrade, setLastGrade] = useState<ReturnType<typeof getGrade> | null>(null)
  const [finalScore, setFinalScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [isLightning, setIsLightning] = useState(false)
  const [faceIdx, setFaceIdx] = useState(0)
  const [isShaking, setIsShaking] = useState(false)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [flashColor, setFlashColor] = useState('')
  const [particles, setParticles] = useState<PixelParticle[]>([])
  const [floats, setFloats] = useState<FloatingText[]>([])
  const [isNewRecord, setIsNewRecord] = useState(false)
  const [pulseScale, setPulseScale] = useState(1)
  const [borderGlow, setBorderGlow] = useState('')
  const [totalScore, setTotalScore] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverTimer, setFeverTimer] = useState(0)
  const [rings, setRings] = useState<ShockRing[]>([])
  const [sparks, setSparks] = useState<SparkDrop[]>([])
  const [vignette, setVignette] = useState('')
  const [bgPulse, setBgPulse] = useState(false)
  const [perfectCount, setPerfectCount] = useState(0)

  // Refs for non-render state
  const goTimeRef = useRef(0)
  const delayRef = useRef<number | null>(null)
  const earlyRef = useRef<number | null>(null)
  const doneRef = useRef(false)
  const startRef = useRef(performance.now())
  const streakRef = useRef(0)
  const roundRef = useRef(0)
  const faceRef = useRef(0)
  const phaseRef = useRef<Phase>('countdown')
  const livesRef = useRef(MAX_LIVES)
  const timesRef = useRef<number[]>([])
  const totalScoreRef = useRef(0)
  const feverRef = useRef(false)
  const feverTimerRef = useRef<number | null>(null)
  const perfectCountRef = useRef(0)

  const pidRef = useRef(0)
  const pRef = useRef<PixelParticle[]>([])
  const fidRef = useRef(0)
  const fRef = useRef<FloatingText[]>([])
  const ridRef = useRef(0)
  const rRef = useRef<ShockRing[]>([])
  const sidRef = useRef(0)
  const sRef = useRef<SparkDrop[]>([])
  const animRef = useRef<number | null>(null)
  const shakeRef = useRef<number | null>(null)
  const flashRef = useRef<number | null>(null)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const clrTimer = (r: { current: number | null }) => {
    if (r.current !== null) { window.clearTimeout(r.current); r.current = null }
  }

  const play = useCallback((key: string, vol = 0.5, rate = 1) => {
    const a = audioRefs.current[key]
    if (!a) return
    a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  // Pixel particles (squares)
  const burst = useCallback((count: number, cx: number, cy: number, colors?: readonly string[]) => {
    const now = performance.now()
    const cs = colors ?? PIXEL_COLORS
    const np: PixelParticle[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5)
      const speed = 120 + Math.random() * 300
      pidRef.current += 1
      np.push({
        id: pidRef.current,
        x: cx + (Math.random() - 0.5) * 24,
        y: cy + (Math.random() - 0.5) * 24,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color: cs[Math.floor(Math.random() * cs.length)],
        size: 5 + Math.floor(Math.random() * 10),
        createdAt: now,
      })
    }
    const m = [...pRef.current, ...np].slice(-MAX_PARTICLES)
    pRef.current = m; setParticles(m)
  }, [])

  const float = useCallback((text: string, x: number, y: number, color: string, size = 20) => {
    fidRef.current += 1
    const ft: FloatingText = { id: fidRef.current, text, x, y, color, size, createdAt: performance.now() }
    const m = [...fRef.current, ft].slice(-12)
    fRef.current = m; setFloats(m)
  }, [])

  // Shockwave ring effect
  const shockRing = useCallback((cx: number, cy: number, color: string) => {
    ridRef.current += 1
    const ring: ShockRing = { id: ridRef.current, x: cx, y: cy, color, createdAt: performance.now() }
    const m = [...rRef.current, ring].slice(-MAX_RINGS)
    rRef.current = m; setRings(m)
  }, [])

  // Spark rain effect
  const sparkRain = useCallback((count: number, colors?: readonly string[]) => {
    const now = performance.now()
    const cs = colors ?? FEVER_COLORS
    const np: SparkDrop[] = []
    for (let i = 0; i < count; i++) {
      sidRef.current += 1
      np.push({
        id: sidRef.current,
        x: Math.random() * 100,
        y: -10 - Math.random() * 30,
        vy: 80 + Math.random() * 160,
        color: cs[Math.floor(Math.random() * cs.length)],
        size: 3 + Math.floor(Math.random() * 6),
        createdAt: now,
      })
    }
    const m = [...sRef.current, ...np].slice(-MAX_SPARKS)
    sRef.current = m; setSparks(m)
  }, [])

  const shake = useCallback((intensity = 5, ms = 120) => {
    setIsShaking(true); setShakeIntensity(intensity)
    clrTimer(shakeRef)
    shakeRef.current = window.setTimeout(() => { shakeRef.current = null; setIsShaking(false); setShakeIntensity(0) }, ms)
  }, [])

  const flash = useCallback((color: string, ms = 80) => {
    setFlashColor(color)
    clrTimer(flashRef)
    flashRef.current = window.setTimeout(() => { flashRef.current = null; setFlashColor('') }, ms)
  }, [])

  const glowBorder = useCallback((color: string, ms = 300) => {
    setBorderGlow(color)
    setTimeout(() => setBorderGlow(''), ms)
  }, [])

  const showVignette = useCallback((color: string, ms = 400) => {
    setVignette(color)
    setTimeout(() => setVignette(''), ms)
  }, [])

  // Activate fever mode
  const activateFever = useCallback(() => {
    if (feverRef.current) return
    feverRef.current = true
    setIsFever(true)
    play('fever', 0.6)
    float('FEVER MODE!', 40, 40, '#ff00ff', 32)
    shake(12, 300)
    flash('rgba(255,0,255,0.5)', 200)
    sparkRain(16, FEVER_COLORS)
    shockRing(50, 50, '#ff00ff')
    setBgPulse(true)

    // Fever lasts 3 rounds
    let remaining = 3
    setFeverTimer(remaining)
    if (feverTimerRef.current) clearInterval(feverTimerRef.current)
    // Timer decrements per round completion, not real-time
  }, [play, float, shake, flash, sparkRain, shockRing])

  const deactivateFever = useCallback(() => {
    feverRef.current = false
    setIsFever(false)
    setFeverTimer(0)
    setBgPulse(false)
    if (feverTimerRef.current) { clearInterval(feverTimerRef.current); feverTimerRef.current = null }
  }, [])

  // ─── Game Flow ─────────────────────────────────────────
  const finishGame = useCallback((reasonTimes: number[]) => {
    if (doneRef.current) return
    doneRef.current = true
    phaseRef.current = 'finished'
    setPhase('finished')
    deactivateFever()
    const avg = reasonTimes.length > 0
      ? reasonTimes.reduce((s, t) => s + t, 0) / reasonTimes.length
      : 999
    const base = computeScore(avg)
    const streakBonus = Math.round(streakRef.current * 50)
    const roundBonus = reasonTimes.length * 20
    const perfectBonus = perfectCountRef.current * 100
    const total = base + streakBonus + roundBonus + perfectBonus + totalScoreRef.current
    setFinalScore(total)
    // Stop BGM
    if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current.currentTime = 0 }
    setTimeout(() => {
      play('gameOver', 0.6)
      burst(20, 180, 250, ['#fbbf24', '#22c55e', '#3b82f6', '#ec4899', '#fff'])
      shockRing(50, 50, '#fbbf24')
      sparkRain(12, ['#fbbf24', '#fff', '#22c55e'])
      if (total > bestScore && bestScore > 0) {
        setTimeout(() => { setIsNewRecord(true); play('record', 0.7) }, 800)
      }
    }, 300)
  }, [play, burst, bestScore, deactivateFever, shockRing, sparkRain])

  const startRound = useCallback(() => {
    clrTimer(delayRef); clrTimer(earlyRef)
    phaseRef.current = 'ready'
    setPhase('ready')
    setLastMs(null); setLastGrade(null)

    const r = roundRef.current
    const lightning = r >= LIGHTNING_ROUND
    setIsLightning(lightning)

    if (lightning && r === LIGHTNING_ROUND) {
      play('lightning', 0.6)
      float('LIGHTNING MODE!', 30, 50, '#fbbf24', 28)
      shake(10, 250)
      flash('rgba(251,191,36,0.4)', 200)
      glowBorder('#fbbf24', 500)
      shockRing(50, 50, '#fbbf24')
    }

    play('round', 0.3, 1 + r * 0.05)

    const nf = pickFace(faceRef.current); faceRef.current = nf; setFaceIdx(nf)

    const delay = randomDelay(r)
    const doFakeout = shouldFakeout(r)

    if (doFakeout) {
      const fakeoutAt = delay * (0.3 + Math.random() * 0.3)
      delayRef.current = window.setTimeout(() => {
        phaseRef.current = 'fakeout'
        setPhase('fakeout')
        play('fakeout', 0.4)
        glowBorder('#22c55e', FAKEOUT_FLASH_MS)

        delayRef.current = window.setTimeout(() => {
          phaseRef.current = 'ready'
          setPhase('ready')

          delayRef.current = window.setTimeout(() => {
            delayRef.current = null
            goTimeRef.current = performance.now()
            phaseRef.current = 'go'
            setPhase('go')
            play('go', 0.6, 1 + r * 0.03)
            flash('rgba(34,197,94,0.5)', 100)
            glowBorder('#22c55e', 300)
            shockRing(50, 50, '#22c55e')
            setPulseScale(1.15)
            setTimeout(() => setPulseScale(1), 150)
          }, delay - fakeoutAt - FAKEOUT_FLASH_MS)
        }, FAKEOUT_FLASH_MS)
      }, fakeoutAt)
    } else {
      delayRef.current = window.setTimeout(() => {
        delayRef.current = null
        goTimeRef.current = performance.now()
        phaseRef.current = 'go'
        setPhase('go')
        play('go', 0.6, 1 + r * 0.03)
        flash('rgba(34,197,94,0.5)', 100)
        glowBorder('#22c55e', 300)
        shockRing(50, 50, '#22c55e')
        setPulseScale(1.15)
        setTimeout(() => setPulseScale(1), 150)
      }, delay)
    }
  }, [play, float, shake, flash, glowBorder, shockRing])

  const handleTap = useCallback((px?: number, py?: number) => {
    if (doneRef.current) return
    const p = phaseRef.current
    if (p === 'countdown' || p === 'finished') return

    const tapX = px ?? 180
    const tapY = py ?? 280

    // Too early (ready or fakeout)
    if (p === 'ready' || p === 'fakeout') {
      clrTimer(delayRef)
      phaseRef.current = 'too-early'
      setPhase('too-early')

      livesRef.current -= 1
      setLives(livesRef.current)
      play('miss', 0.6)
      play('tooEarly', 0.4)
      shake(10, 250)
      flash('rgba(239,68,68,0.6)', 180)
      glowBorder('#ef4444', 400)
      burst(12, tapX, tapY, ['#ef4444', '#f97316', '#991b1b'])
      float(p === 'fakeout' ? 'TRICKED!' : 'TOO EARLY!', 40 + Math.random() * 80, 80, '#ef4444', 28)
      showVignette('rgba(239,68,68,0.3)', 500)
      shockRing(tapX / 3.6, tapY / 6, '#ef4444')

      // Break streak
      if (streakRef.current >= 2) {
        play('streakBreak', 0.4)
        float(`STREAK LOST!`, 60, 130, '#f97316', 20)
      }
      streakRef.current = 0; setStreak(0)
      deactivateFever()

      if (livesRef.current <= 0) {
        float('GAME OVER', 60, 160, '#ef4444', 34)
        shake(15, 400)
        showVignette('rgba(239,68,68,0.5)', 800)
        setTimeout(() => finishGame(timesRef.current), 600)
        return
      }

      earlyRef.current = window.setTimeout(() => {
        earlyRef.current = null; startRound()
      }, TOO_EARLY_DISPLAY_MS)
      return
    }

    // TAP on GO!
    if (p === 'go') {
      const ms = Math.round(performance.now() - goTimeRef.current)
      const clamped = Math.min(ms, 9999)
      setLastMs(clamped)

      const grade = getGrade(clamped)
      setLastGrade(grade)

      timesRef.current = [...timesRef.current, clamped]
      setTimes([...timesRef.current])

      // Streak
      if (clamped <= FAST_THRESHOLD_MS) { streakRef.current += 1 } else { streakRef.current = 0 }
      setStreak(streakRef.current)

      // Fever mode trigger
      if (streakRef.current >= FEVER_STREAK_THRESHOLD && !feverRef.current) {
        activateFever()
      }

      // Life recovery at high streak
      if (streakRef.current === HEAL_STREAK_THRESHOLD && livesRef.current < MAX_LIVES) {
        livesRef.current += 1
        setLives(livesRef.current)
        play('heal', 0.5)
        float('+1 LIFE!', 80, 50, '#22c55e', 26)
        sparkRain(8, ['#22c55e', '#4ade80', '#fff'])
      }

      // Perfect count
      if (grade.stars >= 4) {
        perfectCountRef.current += 1
        setPerfectCount(perfectCountRef.current)
      }

      // Score with fever multiplier
      const baseMult = 1 + streakRef.current * STREAK_MULT_PER
      const feverMult = feverRef.current ? FEVER_SCORE_MULT : 1
      const roundScore = Math.round((500 - Math.min(clamped, 500)) * baseMult * feverMult)
      totalScoreRef.current += roundScore
      setTotalScore(totalScoreRef.current)

      // Decrement fever rounds
      if (feverRef.current) {
        const newFeverTimer = feverTimer - 1
        setFeverTimer(newFeverTimer)
        if (newFeverTimer <= 0) deactivateFever()
        sparkRain(6, FEVER_COLORS)
      }

      // Effects based on grade
      if (grade.stars >= 5) {
        // GODLIKE special effects
        play('godlike', 0.7)
        shake(12, 200)
        flash('rgba(255,0,255,0.5)', 150)
        burst(20, tapX, tapY, ['#ff00ff', '#fff', '#fbbf24', '#a855f7', '#ec4899', '#00ffff'])
        float(`${grade.label}`, 30 + Math.random() * 60, 60, grade.color, 34)
        float(`+${roundScore}`, 100 + Math.random() * 60, 110, '#ff00ff', 26)
        glowBorder('#ff00ff', 500)
        shockRing(tapX / 3.6, tapY / 6, '#ff00ff')
        shockRing(tapX / 3.6, tapY / 6, '#fbbf24')
        sparkRain(10, ['#ff00ff', '#fff', '#fbbf24'])
        showVignette('rgba(255,0,255,0.2)', 400)
        setPulseScale(1.35)
        setBgPulse(true)
        setTimeout(() => setBgPulse(false), 500)
      } else if (grade.stars >= 4) {
        play('perfect', 0.6)
        shake(8, 150)
        flash('rgba(251,191,36,0.4)', 120)
        burst(16, tapX, tapY, ['#fbbf24', '#fff', '#a855f7', '#ec4899'])
        float(`${grade.label}`, 40 + Math.random() * 60, 70, grade.color, 30)
        float(`+${roundScore}`, 110 + Math.random() * 60, 120, '#fbbf24', 24)
        glowBorder('#fbbf24', 400)
        shockRing(tapX / 3.6, tapY / 6, '#fbbf24')
        sparkRain(6, ['#fbbf24', '#fff'])
        setPulseScale(1.25)
      } else if (grade.stars >= 3) {
        play('tapHitStrong', 0.6, 1.1)
        shake(6, 120)
        flash('rgba(34,197,94,0.3)', 80)
        burst(10, tapX, tapY, ['#22c55e', '#14b8a6', '#fff'])
        float(`${grade.label}`, 50 + Math.random() * 60, 80, grade.color, 26)
        float(`+${roundScore}`, 120 + Math.random() * 50, 125, '#22c55e', 22)
        glowBorder('#22c55e', 300)
        shockRing(tapX / 3.6, tapY / 6, '#22c55e')
        setPulseScale(1.18)
      } else if (grade.stars >= 2) {
        play('tapHit', 0.5)
        flash('rgba(59,130,246,0.2)', 60)
        burst(7, tapX, tapY, ['#3b82f6', '#22c55e'])
        float(`${grade.label}`, 60 + Math.random() * 60, 90, grade.color, 22)
        float(`+${roundScore}`, 130, 135, grade.color, 20)
        setPulseScale(1.1)
      } else {
        play('tapHit', 0.3, 0.8)
        burst(4, tapX, tapY)
        float(`+${roundScore}`, 130, 140, '#9ca3af', 18)
      }

      setTimeout(() => setPulseScale(1), 200)

      // Combo sound on streak milestones
      if (streakRef.current === 3 || streakRef.current === 5 || streakRef.current === 8 || streakRef.current === 10) {
        play('combo', 0.5, 0.8 + streakRef.current * 0.05)
        float(`COMBO x${streakRef.current}!`, 30 + Math.random() * 80, 40, '#f59e0b', 24)
        shockRing(50, 50, '#f59e0b')
      }

      // Check finish
      if (timesRef.current.length >= TOTAL_ROUNDS) {
        setTimeout(() => finishGame(timesRef.current), 400)
      } else {
        phaseRef.current = 'result'; setPhase('result')
        const nr = timesRef.current.length + 1
        roundRef.current = nr; setRound(nr)

        delayRef.current = window.setTimeout(() => {
          delayRef.current = null; startRound()
        }, RESULT_DISPLAY_MS)
      }
      return
    }

    if (p === 'result') {
      clrTimer(delayRef); startRound()
    }
  }, [startRound, play, shake, flash, glowBorder, burst, float, finishGame, activateFever, deactivateFever, shockRing, sparkRain, showVignette, feverTimer])

  // ─── Countdown ─────────────────────────────────────────
  useEffect(() => {
    startRef.current = performance.now()
    let c = 3; setCountdownNum(3)
    play('countdown', 0.5)
    const iv = setInterval(() => {
      c -= 1
      if (c > 0) { setCountdownNum(c); play('countdown', 0.5, 1 + (3 - c) * 0.2) }
      else {
        clearInterval(iv)
        roundRef.current = 1; setRound(1)
        startRound()
        // Start BGM
        if (bgmRef.current) {
          bgmRef.current.loop = true
          bgmRef.current.volume = 0.25
          void bgmRef.current.play().catch(() => {})
        }
      }
    }, 700)
    return () => clearInterval(iv)
  }, [startRound, play])

  // ─── Audio preload ─────────────────────────────────────
  useEffect(() => {
    const srcs: Record<string, string> = {
      go: goSfx, tooEarly: tooEarlySfx, perfect: perfectSfx,
      lightning: lightningSfx, tick: tickSfx, record: recordSfx,
      combo: comboSfx, miss: missSfx, round: roundSfx, fakeout: fakeoutSfx,
      tapHit: tapHitSfx, tapHitStrong: tapHitStrongSfx, gameOver: gameOverHitSfx,
      countdown: countdownSfx, godlike: godlikeSfx, fever: feverSfx,
      heal: healSfx, streakBreak: streakBreakSfx,
    }
    for (const [k, s] of Object.entries(srcs)) {
      const a = new Audio(s); a.preload = 'auto'; audioRefs.current[k] = a
    }
    // BGM
    const bgm = new Audio(bgmSfx); bgm.preload = 'auto'; bgmRef.current = bgm
    for (const f of CHARACTER_FACES) { const i = new Image(); i.src = f.src }
    return () => {
      clrTimer(delayRef); clrTimer(earlyRef); clrTimer(shakeRef); clrTimer(flashRef)
      for (const k of Object.keys(audioRefs.current)) audioRefs.current[k] = null
      if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current = null }
      if (feverTimerRef.current) clearInterval(feverTimerRef.current)
    }
  }, [])

  // ─── Animation loop ────────────────────────────────────
  useEffect(() => {
    const step = () => {
      const now = performance.now()
      const ap = pRef.current.filter(p => now - p.createdAt < PARTICLE_LIFETIME)
      if (ap.length !== pRef.current.length) { pRef.current = ap; setParticles(ap) }
      const af = fRef.current.filter(f => now - f.createdAt < 1200)
      if (af.length !== fRef.current.length) { fRef.current = af; setFloats(af) }
      const ar = rRef.current.filter(r => now - r.createdAt < RING_LIFETIME)
      if (ar.length !== rRef.current.length) { rRef.current = ar; setRings(ar) }
      const as2 = sRef.current.filter(s => now - s.createdAt < SPARK_LIFETIME)
      if (as2.length !== sRef.current.length) { sRef.current = as2; setSparks(as2) }
      animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
    return () => { if (animRef.current !== null) cancelAnimationFrame(animRef.current) }
  }, [])

  // ─── Keyboard ──────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); handleTap() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [handleTap])

  const finishCalledRef = useRef(false)
  const handleFinish = useCallback(() => {
    if (finishCalledRef.current) return; finishCalledRef.current = true
    onFinish({ score: finalScore, durationMs: Math.round(Math.max(16.66, performance.now() - startRef.current)) })
  }, [finalScore, onFinish])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    handleTap(e.clientX - r.left, e.clientY - r.top)
  }, [handleTap])

  const avgMs = times.length > 0 ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : 0
  const face = CHARACTER_FACES[faceIdx]

  const shakeStyle = isShaking
    ? { transform: `translate(${(Math.random() - 0.5) * shakeIntensity * 2}px, ${(Math.random() - 0.5) * shakeIntensity * 2}px)` }
    : undefined

  // Phase-based background
  const zoneBg = phase === 'go' ? '#0a5c2a'
    : phase === 'ready' ? '#5c0a0a'
    : phase === 'fakeout' ? '#2a5c0a'
    : phase === 'too-early' ? '#5c2a0a'
    : phase === 'countdown' ? '#1a1a2e'
    : '#1a1a2e'

  return (
    <section className="mini-game-panel rt-panel" aria-label="reaction-test-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden' }}>
      <style>{RT_CSS}</style>

      {/* Score display - top center */}
      <div className="rt-score-top">
        <p className="rt-score-main">{totalScore.toLocaleString()}</p>
        {bestScore > 0 && <p className="rt-score-best">BEST {bestScore.toLocaleString()}</p>}
      </div>

      {/* Header */}
      <div className="rt-hdr">
        <div className="rt-hdr-left">
          <p className="rt-round-txt">
            {phase === 'countdown' ? 'READY' : `R${round}/${TOTAL_ROUNDS}`}
          </p>
          {isLightning && phase !== 'countdown' && phase !== 'finished' && (
            <span className="rt-badge rt-badge-lightning">LIGHTNING</span>
          )}
          {isFever && phase !== 'finished' && (
            <span className="rt-badge rt-badge-fever">FEVER x{FEVER_SCORE_MULT}</span>
          )}
        </div>
        <div className="rt-hdr-right">
          {/* Lives as pixel hearts */}
          <div className="rt-lives">
            {Array.from({ length: MAX_LIVES }).map((_, i) => (
              <span key={`life-${i}`} className={`rt-heart ${i < lives ? 'rt-heart-alive' : 'rt-heart-dead'}`}>
                {i < lives ? '♥' : '♡'}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {times.length > 0 && phase !== 'finished' && (
        <div className="rt-prog-bar">
          {times.map((t, i) => {
            const g = getGrade(t)
            return <div key={`b-${i}`} className="rt-prog-seg" style={{ background: g.color, flex: 1 }} />
          })}
          {Array.from({ length: TOTAL_ROUNDS - times.length }).map((_, i) => (
            <div key={`e-${i}`} className="rt-prog-seg rt-prog-empty" style={{ flex: 1 }} />
          ))}
        </div>
      )}

      {/* Streak banner */}
      {streak >= 2 && phase !== 'finished' && (
        <div className={`rt-streak-banner ${isFever ? 'rt-streak-fever' : ''}`}>
          <span className="rt-streak-txt">STREAK x{streak}</span>
          <span className="rt-streak-mult">{(1 + streak * STREAK_MULT_PER).toFixed(1)}x</span>
          {isFever && <span className="rt-fever-badge">FEVER!</span>}
        </div>
      )}

      {/* Main game zone */}
      <div
        className={`rt-zone ${phase === 'go' ? 'rt-zone-go' : ''} ${phase === 'fakeout' ? 'rt-zone-fakeout' : ''} ${bgPulse ? 'rt-zone-pulse' : ''} ${isFever ? 'rt-zone-fever' : ''}`}
        style={{ ...shakeStyle, background: zoneBg, borderColor: borderGlow || 'rgba(255,255,255,0.1)' }}
        onPointerDown={handlePointerDown} role="button" tabIndex={0} aria-label="Tap zone"
      >
        {/* Scanline overlay */}
        <div className="rt-scanlines" />

        {/* Vignette effect */}
        {vignette && <div className="rt-vignette" style={{ boxShadow: `inset 0 0 80px 30px ${vignette}` }} />}

        {/* Flash overlay */}
        {flashColor && (
          <div className="rt-flash" style={{ background: flashColor }} />
        )}

        {/* Shockwave rings */}
        {rings.map(ring => {
          const age = performance.now() - ring.createdAt
          const prog = Math.min(1, age / RING_LIFETIME)
          const scale = 0.3 + prog * 4
          return (
            <div key={ring.id} className="rt-shock-ring" style={{
              left: `${ring.x}%`, top: `${ring.y}%`,
              width: '60px', height: '60px',
              borderColor: ring.color,
              opacity: 1 - prog,
              transform: `translate(-50%, -50%) scale(${scale})`,
            }} />
          )
        })}

        {/* Spark rain */}
        {sparks.map(sp => {
          const age = performance.now() - sp.createdAt
          const prog = Math.min(1, age / SPARK_LIFETIME)
          const y = sp.y + sp.vy * prog
          return (
            <div key={sp.id} className="rt-spark" style={{
              left: `${sp.x}%`, top: `${y}%`,
              width: `${sp.size}px`, height: `${sp.size * 2}px`,
              background: sp.color,
              opacity: 1 - prog * 0.7,
              boxShadow: `0 0 ${sp.size * 2}px ${sp.color}`,
            }} />
          )
        })}

        {/* Pixel particles */}
        {particles.map(pp => {
          const age = performance.now() - pp.createdAt
          const prog = Math.min(1, age / PARTICLE_LIFETIME)
          const x = pp.x + pp.vx * prog * 0.4
          const y = pp.y + pp.vy * prog * 0.4 - 25 * prog
          return (
            <div key={pp.id} className="rt-pixel-particle" style={{
              left: `${x}px`, top: `${y}px`,
              width: `${pp.size * (1 - prog * 0.5)}px`,
              height: `${pp.size * (1 - prog * 0.5)}px`,
              background: pp.color,
              opacity: 1 - prog,
              boxShadow: `0 0 ${pp.size * 1.5}px ${pp.color}`,
              transform: `rotate(${prog * 180}deg)`,
            }} />
          )
        })}

        {/* Floating texts */}
        {floats.map(ft => {
          const age = performance.now() - ft.createdAt
          const prog = Math.min(1, age / 1200)
          return (
            <span key={ft.id} className="rt-float" style={{
              left: `${ft.x}px`, top: `${ft.y}px`, color: ft.color, fontSize: `${ft.size}px`,
              opacity: 1 - prog,
              transform: `translateY(${-60 * prog}px) scale(${1.3 - prog * 0.5})`,
            }}>{ft.text}</span>
          )
        })}

        {/* Countdown */}
        {phase === 'countdown' && (
          <div className="rt-cd">
            <p className="rt-cd-num" key={countdownNum}>{countdownNum}</p>
            <p className="rt-cd-label">GET READY</p>
          </div>
        )}

        {/* Gameplay area */}
        {phase !== 'countdown' && phase !== 'finished' && (
          <div className="rt-play" style={{ transform: `scale(${pulseScale})`, transition: 'transform 0.12s ease-out' }}>
            <img className="rt-char" src={face.src} alt={face.name} />

            <p className="rt-phase-txt" style={{
              color: phase === 'go' ? '#4ade80' : phase === 'too-early' ? '#fb923c' : phase === 'fakeout' ? '#86efac' : '#ef4444'
            }}>
              {phase === 'ready' ? 'WAIT...'
                : phase === 'fakeout' ? 'WAIT...'
                : phase === 'go' ? 'TAP NOW!'
                : phase === 'too-early' ? 'TOO EARLY!'
                : phase === 'result' && lastMs !== null ? `${lastMs}ms`
                : ''}
            </p>

            {phase === 'result' && lastGrade && (
              <div className="rt-grade-row">
                <span className="rt-grade-txt" style={{ color: lastGrade.color }}>{lastGrade.label}</span>
                <span className="rt-grade-stars">
                  {'★'.repeat(lastGrade.stars)}{'☆'.repeat(5 - lastGrade.stars)}
                </span>
              </div>
            )}

            {phase === 'go' && <div className="rt-go-ring" />}

            {/* Danger warning when 1 life left */}
            {lives === 1 && phase !== 'result' && (
              <div className="rt-danger-warn">DANGER</div>
            )}
          </div>
        )}

        {/* Finished overlay */}
        {phase === 'finished' && (
          <div className="rt-finish">
            {isNewRecord && <p className="rt-new-rec">NEW RECORD!</p>}
            <p className="rt-fin-title">RESULT</p>

            <div className="rt-fin-grid">
              {times.map((t, i) => {
                const g = getGrade(t)
                return (
                  <div className="rt-fin-row" key={`fr-${i}`}>
                    <span className="rt-fin-rnd">R{i + 1}</span>
                    <span className="rt-fin-ms" style={{ color: g.color }}>{t}ms</span>
                    <span className="rt-fin-stars">{'★'.repeat(g.stars)}</span>
                  </div>
                )
              })}
            </div>

            {times.length > 0 && (
              <div className="rt-fin-avg">
                <span className="rt-fin-avg-label">AVG</span>
                <span className="rt-fin-avg-val">{avgMs}ms</span>
              </div>
            )}

            <div className="rt-fin-stats">
              {perfectCount > 0 && <span className="rt-fin-stat">PERFECT x{perfectCount}</span>}
              {streak > 0 && <span className="rt-fin-stat">MAX STREAK x{streak}</span>}
            </div>

            <div className="rt-fin-score-block">
              <p className="rt-fin-score">{finalScore.toLocaleString()}</p>
              {bestScore > 0 && <p className="rt-fin-best">BEST {bestScore.toLocaleString()}</p>}
            </div>

            <div className="rt-fin-btns">
              <button className="rt-btn-go" type="button" onClick={handleFinish}>Complete</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

// ─── CSS: Pixel Art / Dot Game Style ─────────────────────────
const RT_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

  .rt-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #0f0f1a;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    font-family: 'Press Start 2P', monospace;
    image-rendering: pixelated;
  }

  /* Score display - top center */
  .rt-score-top {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 12px 6px;
    background: #16162a;
  }

  .rt-score-main {
    font-size: clamp(36px, 10vw, 52px);
    color: #fbbf24;
    margin: 0;
    text-shadow: 0 0 20px rgba(251,191,36,0.6), 0 0 40px rgba(251,191,36,0.3), 3px 3px 0 #000;
    letter-spacing: 2px;
    line-height: 1.1;
  }

  .rt-score-best {
    font-size: clamp(9px, 2.5vw, 12px);
    color: rgba(255,255,255,0.35);
    margin: 2px 0 0;
  }

  .rt-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 6px 12px 6px;
    background: #16162a;
    border-bottom: 3px solid #2a2a4a;
  }

  .rt-hdr-left { display: flex; flex-direction: row; gap: 6px; align-items: center; }
  .rt-hdr-right { display: flex; flex-direction: row; align-items: center; gap: 6px; }

  .rt-round-txt {
    font-size: clamp(12px, 3.5vw, 16px);
    color: #9ca3af;
    margin: 0;
  }

  .rt-badge {
    font-size: 9px;
    padding: 2px 6px;
    border: 2px solid;
    display: inline-block;
  }

  .rt-badge-lightning {
    color: #fbbf24;
    border-color: #fbbf24;
    animation: rt-blink 0.4s step-start infinite;
    text-shadow: 0 0 6px #fbbf24;
  }

  .rt-badge-fever {
    color: #ff00ff;
    border-color: #ff00ff;
    animation: rt-fever-pulse 0.3s step-start infinite;
    text-shadow: 0 0 8px #ff00ff;
    background: rgba(255,0,255,0.15);
  }

  .rt-lives {
    display: flex;
    gap: 4px;
  }

  .rt-heart {
    font-size: clamp(20px, 5.5vw, 28px);
    line-height: 1;
  }

  .rt-heart-alive {
    color: #ef4444;
    text-shadow: 0 0 10px rgba(239,68,68,0.7);
    animation: rt-heart-beat 0.8s ease-in-out infinite;
  }

  .rt-heart-dead {
    color: #374151;
  }

  .rt-prog-bar {
    display: flex;
    gap: 2px;
    padding: 4px 12px;
    height: 10px;
  }

  .rt-prog-seg {
    height: 100%;
    border: 1px solid rgba(255,255,255,0.15);
  }

  .rt-prog-empty {
    background: #1a1a2e !important;
    border-color: #2a2a4a;
  }

  .rt-streak-banner {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    padding: 4px;
    background: linear-gradient(90deg, transparent, rgba(245,158,11,0.2), transparent);
  }

  .rt-streak-fever {
    background: linear-gradient(90deg, transparent, rgba(255,0,255,0.25), transparent) !important;
    animation: rt-fever-bg 0.5s ease-in-out infinite alternate;
  }

  .rt-streak-txt {
    font-size: clamp(11px, 3vw, 14px);
    color: #f59e0b;
    animation: rt-blink 0.3s step-start infinite;
  }

  .rt-streak-mult {
    font-size: clamp(11px, 3vw, 14px);
    color: #fbbf24;
    text-shadow: 0 0 6px #fbbf24;
  }

  .rt-fever-badge {
    font-size: clamp(10px, 2.8vw, 13px);
    color: #ff00ff;
    text-shadow: 0 0 8px #ff00ff;
    animation: rt-fever-pulse 0.3s step-start infinite;
  }

  .rt-zone {
    position: relative;
    flex: 1;
    margin: 4px 8px 8px;
    border: 4px solid rgba(255,255,255,0.1);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    transition: background 0.2s step-end, border-color 0.15s;
    image-rendering: pixelated;
  }

  .rt-zone-go {
    border-color: #22c55e !important;
    box-shadow: inset 0 0 60px rgba(34,197,94,0.25), 0 0 30px rgba(34,197,94,0.35);
  }

  .rt-zone-fakeout {
    border-color: #86efac !important;
  }

  .rt-zone-fever {
    border-color: #ff00ff !important;
    box-shadow: inset 0 0 40px rgba(255,0,255,0.15), 0 0 20px rgba(255,0,255,0.2);
  }

  .rt-zone-pulse {
    animation: rt-bg-pulse 0.3s ease-in-out;
  }

  .rt-vignette {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 19;
  }

  /* CRT Scanlines */
  .rt-scanlines {
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.12) 2px,
      rgba(0,0,0,0.12) 4px
    );
    pointer-events: none;
    z-index: 20;
  }

  .rt-flash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 18;
  }

  .rt-shock-ring {
    position: absolute;
    border: 3px solid;
    border-radius: 50%;
    pointer-events: none;
    z-index: 16;
  }

  .rt-spark {
    position: absolute;
    pointer-events: none;
    z-index: 15;
    border-radius: 1px;
  }

  .rt-pixel-particle {
    position: absolute;
    pointer-events: none;
    z-index: 15;
    image-rendering: pixelated;
  }

  .rt-float {
    position: absolute;
    pointer-events: none;
    z-index: 22;
    white-space: nowrap;
    text-shadow: 2px 2px 0 #000, -1px -1px 0 #000, 0 0 8px currentColor;
    font-family: 'Press Start 2P', monospace;
  }

  .rt-play {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    z-index: 5;
  }

  .rt-char {
    width: clamp(220px, 60vw, 320px);
    height: clamp(220px, 60vw, 320px);
    pointer-events: none;
    image-rendering: pixelated;
    filter: drop-shadow(0 0 16px rgba(255,255,255,0.2));
  }

  .rt-phase-txt {
    font-size: clamp(26px, 8vw, 40px);
    margin: 0;
    text-shadow: 3px 3px 0 #000, 0 0 12px currentColor;
    letter-spacing: 3px;
    animation: rt-pop 0.15s step-end;
  }

  .rt-grade-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    animation: rt-pop 0.2s step-end;
  }

  .rt-grade-txt {
    font-size: clamp(20px, 5.5vw, 28px);
    text-shadow: 2px 2px 0 #000, 0 0 10px currentColor;
  }

  .rt-grade-stars {
    font-size: clamp(18px, 5vw, 24px);
    color: #fbbf24;
    text-shadow: 0 0 10px rgba(251,191,36,0.6);
    letter-spacing: 3px;
  }

  .rt-go-ring {
    position: absolute;
    width: 120px;
    height: 120px;
    border: 4px solid rgba(34,197,94,0.5);
    animation: rt-ring 0.5s step-start infinite;
    pointer-events: none;
  }

  .rt-danger-warn {
    font-size: clamp(18px, 5vw, 24px);
    color: #ef4444;
    text-shadow: 0 0 12px rgba(239,68,68,0.6), 2px 2px 0 #000;
    animation: rt-danger-flash 0.5s step-start infinite;
    letter-spacing: 4px;
    margin-top: 8px;
  }

  .rt-cd {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    z-index: 5;
  }

  .rt-cd-num {
    font-size: clamp(80px, 25vw, 120px);
    color: #fff;
    margin: 0;
    text-shadow: 4px 4px 0 #000, 0 0 30px rgba(255,255,255,0.4);
    animation: rt-cd-pop 0.5s step-end;
  }

  .rt-cd-label {
    font-size: clamp(14px, 4vw, 20px);
    color: rgba(255,255,255,0.5);
    margin: 0;
    letter-spacing: 4px;
  }

  /* Finished overlay */
  .rt-finish {
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 30;
    background: rgba(0,0,0,0.88);
    animation: rt-fade 0.3s step-end;
    gap: 10px;
    padding: 16px;
  }

  .rt-new-rec {
    font-size: clamp(16px, 5vw, 22px);
    color: #fbbf24;
    margin: 0;
    text-shadow: 0 0 16px #fbbf24, 2px 2px 0 #000;
    animation: rt-blink 0.3s step-start infinite;
    letter-spacing: 2px;
  }

  .rt-fin-title {
    font-size: 14px;
    color: rgba(255,255,255,0.5);
    margin: 0;
    letter-spacing: 4px;
  }

  .rt-fin-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    width: 100%;
    max-width: 300px;
  }

  .rt-fin-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .rt-fin-rnd {
    font-size: 9px;
    color: rgba(255,255,255,0.4);
    min-width: 24px;
  }

  .rt-fin-ms {
    font-size: 11px;
  }

  .rt-fin-stars {
    font-size: 9px;
    color: #fbbf24;
  }

  .rt-fin-avg {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .rt-fin-avg-label {
    font-size: 11px;
    color: rgba(255,255,255,0.4);
  }

  .rt-fin-avg-val {
    font-size: clamp(24px, 7vw, 34px);
    color: #fff;
    text-shadow: 2px 2px 0 #000;
  }

  .rt-fin-stats {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .rt-fin-stat {
    font-size: 9px;
    color: #a855f7;
    padding: 2px 8px;
    border: 1px solid rgba(168,85,247,0.3);
    text-shadow: 0 0 4px #a855f7;
  }

  .rt-fin-score-block { text-align: center; }

  .rt-fin-score {
    font-size: clamp(36px, 10vw, 52px);
    color: #fbbf24;
    margin: 0;
    text-shadow: 0 0 20px rgba(251,191,36,0.6), 0 0 40px rgba(251,191,36,0.3), 3px 3px 0 #000;
    animation: rt-cd-pop 0.5s step-end;
  }

  .rt-fin-best {
    font-size: 10px;
    color: rgba(255,255,255,0.4);
    margin: 2px 0 0;
  }

  .rt-fin-btns {
    display: flex;
    gap: 10px;
    margin-top: 10px;
  }

  .rt-btn-go {
    padding: 14px 36px;
    border: 3px solid #22c55e;
    background: #0a5c2a;
    color: #4ade80;
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(13px, 3.5vw, 16px);
    cursor: pointer;
  }

  .rt-btn-go:active { background: #22c55e; color: #000; }

  /* Keyframes */
  @keyframes rt-blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0.3; }
  }

  @keyframes rt-heart-beat {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.2); }
  }

  @keyframes rt-pop {
    0% { transform: scale(1.5); }
    100% { transform: scale(1); }
  }

  @keyframes rt-cd-pop {
    0% { transform: scale(2.2); opacity: 0; }
    30% { transform: scale(0.9); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  @keyframes rt-ring {
    0% { transform: scale(0.5); opacity: 0.7; }
    50% { transform: scale(2.5); opacity: 0.2; }
    100% { transform: scale(3.5); opacity: 0; }
  }

  @keyframes rt-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes rt-fever-pulse {
    0%, 49% { opacity: 1; text-shadow: 0 0 12px #ff00ff; }
    50%, 100% { opacity: 0.6; text-shadow: 0 0 4px #ff00ff; }
  }

  @keyframes rt-fever-bg {
    from { background: linear-gradient(90deg, transparent, rgba(255,0,255,0.2), transparent); }
    to { background: linear-gradient(90deg, transparent, rgba(255,0,128,0.25), transparent); }
  }

  @keyframes rt-bg-pulse {
    0% { filter: brightness(1); }
    50% { filter: brightness(1.5); }
    100% { filter: brightness(1); }
  }

  @keyframes rt-danger-flash {
    0%, 30% { opacity: 1; }
    31%, 60% { opacity: 0.2; }
    61%, 100% { opacity: 1; }
  }
`

export const reactionTestModule: MiniGameModule = {
  manifest: {
    id: 'reaction-test',
    title: 'Reaction Test',
    description: 'Tap when green! 10 rounds with fake-outs, fever mode & speed ramp!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#16a34a',
  },
  Component: ReactionTestGame,
}
