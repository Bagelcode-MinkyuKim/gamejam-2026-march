import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import characterImg from '../../../assets/images/same-character/seo-taiji.png'
import splashSfx from '../../../assets/sounds/paint-mix-splash.mp3'
import perfectSfx from '../../../assets/sounds/paint-mix-perfect.mp3'
import slideSfx from '../../../assets/sounds/paint-mix-slide.mp3'
import missSfx from '../../../assets/sounds/paint-mix-miss.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 5000

// --- Gimmick constants ---
const SPEED_BONUS_THRESHOLD_MS = 8000
const SPEED_BONUS_POINTS = 20
const COMBO_KEEP_WINDOW_MS = 12000
const COMBO_MULTIPLIER_STEP = 0.25
const FEVER_THRESHOLD = 4
const FEVER_DURATION_MS = 10000
const FEVER_MULTIPLIER = 2
const PERFECT_THRESHOLD = 90
const PERFECT_BONUS = 15

// --- New feature constants ---
const GOLDEN_COLOR_CHANCE = 0.12
const GOLDEN_MULTIPLIER = 3
const HINT_COOLDOWN_MS = 15000
const TIME_BONUS_PER_PERFECT_MS = 2000
const DIFFICULTY_SCALE_INTERVAL = 5
const RAINBOW_ROUND_INTERVAL = 8
const RAINBOW_BONUS = 30

interface TargetColor {
  readonly name: string
  readonly r: number
  readonly g: number
  readonly b: number
}

const TARGET_COLORS: readonly TargetColor[] = [
  { name: 'Orange', r: 255, g: 165, b: 0 },
  { name: 'Purple', r: 128, g: 0, b: 128 },
  { name: 'Green', r: 0, g: 128, b: 0 },
  { name: 'Pink', r: 255, g: 192, b: 203 },
  { name: 'Sky', r: 135, g: 206, b: 235 },
  { name: 'Brown', r: 139, g: 69, b: 19 },
  { name: 'Teal', r: 0, g: 128, b: 128 },
  { name: 'Coral', r: 255, g: 127, b: 80 },
  { name: 'Indigo', r: 75, g: 0, b: 130 },
  { name: 'Gold', r: 255, g: 215, b: 0 },
  { name: 'Crimson', r: 220, g: 20, b: 60 },
  { name: 'Olive', r: 128, g: 128, b: 0 },
] as const

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function toRgbString(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`
}

function pickNextTargetIndex(currentIndex: number, colorsMatched: number): number {
  const poolSize = Math.min(TARGET_COLORS.length, 6 + Math.floor(colorsMatched / DIFFICULTY_SCALE_INTERVAL))
  let next = Math.floor(Math.random() * poolSize)
  while (next === currentIndex && poolSize > 1) {
    next = Math.floor(Math.random() * poolSize)
  }
  return next
}

const MAX_COLOR_DISTANCE = colorDistance(0, 0, 0, 255, 255, 255)

function scoreFromDistance(dist: number): number {
  return Math.max(0, Math.round(100 - (dist / MAX_COLOR_DISTANCE) * 100))
}

function getAccuracyLabel(accuracy: number): { text: string; color: string } {
  if (accuracy >= 95) return { text: 'PERFECT!', color: '#16a34a' }
  if (accuracy >= 80) return { text: 'Excellent!', color: '#22c55e' }
  if (accuracy >= 60) return { text: 'Good', color: '#ca8a04' }
  if (accuracy >= 40) return { text: 'Close...', color: '#f97316' }
  return { text: 'Keep trying', color: '#dc2626' }
}

function getChannelHint(current: number, target: number): string {
  const diff = target - current
  if (Math.abs(diff) < 15) return '\u{2705}'
  return diff > 0 ? '\u{2B06}\u{FE0F}' : '\u{2B07}\u{FE0F}'
}

function PaintMixGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [colorsMatched, setColorsMatched] = useState(0)
  const [targetIndex, setTargetIndex] = useState(() => Math.floor(Math.random() * 6))
  const [sliderR, setSliderR] = useState(128)
  const [sliderG, setSliderG] = useState(128)
  const [sliderB, setSliderB] = useState(128)
  const [lastSubmitScore, setLastSubmitScore] = useState<number | null>(null)
  const [lastSubmitFade, setLastSubmitFade] = useState(false)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [perfectCount, setPerfectCount] = useState(0)
  const [bonusText, setBonusText] = useState('')
  const [isGoldenRound, setIsGoldenRound] = useState(false)
  const [isRainbowRound, setIsRainbowRound] = useState(false)
  const [hintAvailable, setHintAvailable] = useState(true)
  const [showHints, setShowHints] = useState(false)
  const [screenFlashColor, setScreenFlashColor] = useState('')
  const [lastAccuracyLabel, setLastAccuracyLabel] = useState('')

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const colorsMatchedRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const lastSubmitTimerRef = useRef<number | null>(null)
  const comboRef = useRef(0)
  const lastSubmitAtRef = useRef(0)
  const consecutiveGoodRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const colorStartAtRef = useRef(0)
  const bonusTextTimerRef = useRef<number | null>(null)
  const hintCooldownTimerRef = useRef<number | null>(null)
  const screenFlashTimerRef = useRef<number | null>(null)

  const splashAudioRef = useRef<HTMLAudioElement | null>(null)
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const slideAudioRef = useRef<HTMLAudioElement | null>(null)
  const missAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) return
      audio.currentTime = 0
      audio.volume = Math.min(1, Math.max(0, volume))
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const triggerScreenFlash = useCallback((color: string, durationMs = 300) => {
    setScreenFlashColor(color)
    if (screenFlashTimerRef.current !== null) window.clearTimeout(screenFlashTimerRef.current)
    screenFlashTimerRef.current = window.setTimeout(() => {
      screenFlashTimerRef.current = null
      setScreenFlashColor('')
    }, durationMs)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true

    if (lastSubmitTimerRef.current !== null) {
      window.clearTimeout(lastSubmitTimerRef.current)
      lastSubmitTimerRef.current = null
    }
    if (bonusTextTimerRef.current !== null) {
      window.clearTimeout(bonusTextTimerRef.current)
      bonusTextTimerRef.current = null
    }
    if (hintCooldownTimerRef.current !== null) {
      window.clearTimeout(hintCooldownTimerRef.current)
      hintCooldownTimerRef.current = null
    }
    if (screenFlashTimerRef.current !== null) {
      window.clearTimeout(screenFlashTimerRef.current)
      screenFlashTimerRef.current = null
    }

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const useHint = useCallback(() => {
    if (!hintAvailable) return
    setShowHints(true)
    setHintAvailable(false)
    if (hintCooldownTimerRef.current !== null) window.clearTimeout(hintCooldownTimerRef.current)
    hintCooldownTimerRef.current = window.setTimeout(() => {
      hintCooldownTimerRef.current = null
      setHintAvailable(true)
      setShowHints(false)
    }, HINT_COOLDOWN_MS)
  }, [hintAvailable])

  const handleSubmit = useCallback(() => {
    if (finishedRef.current) return

    const target = TARGET_COLORS[targetIndex]
    if (!target) return

    const now = performance.now()
    const timeTaken = now - colorStartAtRef.current
    const timeSinceLastSubmit = now - lastSubmitAtRef.current
    lastSubmitAtRef.current = now

    const dist = colorDistance(sliderR, sliderG, sliderB, target.r, target.g, target.b)
    const basePoints = scoreFromDistance(dist)
    const accLabel = getAccuracyLabel(basePoints)
    setLastAccuracyLabel(accLabel.text)

    // Combo system
    const isComboKept = timeSinceLastSubmit < COMBO_KEEP_WINDOW_MS && basePoints >= 50
    if (isComboKept) {
      comboRef.current += 1
    } else if (basePoints < 50) {
      comboRef.current = 0
    } else {
      comboRef.current = 1
    }
    setCombo(comboRef.current)

    // Fever activation
    if (basePoints >= 70) {
      consecutiveGoodRef.current += 1
    } else {
      consecutiveGoodRef.current = 0
    }
    if (consecutiveGoodRef.current >= FEVER_THRESHOLD && !isFeverRef.current) {
      isFeverRef.current = true
      feverMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverMs(FEVER_DURATION_MS)
      triggerScreenFlash('rgba(225,29,72,0.5)')
    }

    const comboMult = 1 + comboRef.current * COMBO_MULTIPLIER_STEP
    const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
    const goldenMult = isGoldenRound ? GOLDEN_MULTIPLIER : 1

    // Speed bonus
    const speedBonus = timeTaken < SPEED_BONUS_THRESHOLD_MS ? SPEED_BONUS_POINTS : 0

    // Perfect bonus
    let perfBonus = 0
    if (basePoints >= PERFECT_THRESHOLD) {
      perfBonus = PERFECT_BONUS
      setPerfectCount((p) => p + 1)
      // Time bonus for perfects
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_PERFECT_MS)
      setRemainingMs(remainingMsRef.current)
    }

    // Rainbow round bonus
    const rainbowBonus = isRainbowRound && basePoints >= 80 ? RAINBOW_BONUS : 0

    const totalPoints = Math.round((basePoints + speedBonus + perfBonus + rainbowBonus) * comboMult * feverMult * goldenMult)

    const nextScore = scoreRef.current + totalPoints
    scoreRef.current = nextScore
    setScore(nextScore)

    const nextMatched = colorsMatchedRef.current + 1
    colorsMatchedRef.current = nextMatched
    setColorsMatched(nextMatched)

    setLastSubmitScore(totalPoints)
    setLastSubmitFade(false)

    // Build bonus text
    const parts: string[] = []
    if (speedBonus > 0) parts.push('SPEED!')
    if (perfBonus > 0) parts.push('PERFECT!')
    if (rainbowBonus > 0) parts.push('RAINBOW!')
    if (isGoldenRound) parts.push('GOLDEN x3!')
    if (comboMult > 1) parts.push(`x${comboMult.toFixed(2)}`)
    if (isFeverRef.current) parts.push('FEVER!')
    if (perfBonus > 0) parts.push(`+${TIME_BONUS_PER_PERFECT_MS / 1000}s`)
    if (parts.length > 0) {
      setBonusText(parts.join(' '))
      if (bonusTextTimerRef.current !== null) window.clearTimeout(bonusTextTimerRef.current)
      bonusTextTimerRef.current = window.setTimeout(() => {
        bonusTextTimerRef.current = null
        setBonusText('')
      }, 1200)
    }

    if (lastSubmitTimerRef.current !== null) {
      window.clearTimeout(lastSubmitTimerRef.current)
    }
    lastSubmitTimerRef.current = window.setTimeout(() => {
      lastSubmitTimerRef.current = null
      setLastSubmitFade(true)
    }, 1200)

    // Sound & effects based on score
    if (basePoints >= 90) {
      playAudio(perfectAudioRef, 0.7, 1 + basePoints * 0.001)
      effects.triggerFlash('rgba(34,197,94,0.5)')
      effects.spawnParticles(8, 200, 300)
      triggerScreenFlash('rgba(34,197,94,0.3)')
    } else if (basePoints >= 70) {
      playAudio(splashAudioRef, 0.6, 1)
      effects.triggerFlash()
      effects.spawnParticles(5, 200, 250)
    } else if (basePoints >= 50) {
      playAudio(splashAudioRef, 0.5, 0.9)
      effects.spawnParticles(3, 200, 200)
    } else {
      playAudio(missAudioRef, 0.5, 1)
      effects.triggerShake(4)
      effects.triggerFlash('rgba(239,68,68,0.4)')
      triggerScreenFlash('rgba(239,68,68,0.2)')
    }

    // Next color
    const nextIndex = pickNextTargetIndex(targetIndex, nextMatched)
    setTargetIndex(nextIndex)
    setSliderR(128)
    setSliderG(128)
    setSliderB(128)
    colorStartAtRef.current = performance.now()
    setShowHints(false)

    // Golden round check
    setIsGoldenRound(Math.random() < GOLDEN_COLOR_CHANCE)

    // Rainbow round check
    setIsRainbowRound(nextMatched > 0 && nextMatched % RAINBOW_ROUND_INTERVAL === 0)
  }, [targetIndex, sliderR, sliderG, sliderB, playAudio, isGoldenRound, isRainbowRound, triggerScreenFlash])

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
      if (event.code === 'Space') {
        event.preventDefault()
        handleSubmit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, handleSubmit])

  useEffect(() => {
    const audios = [
      { ref: splashAudioRef, src: splashSfx },
      { ref: perfectAudioRef, src: perfectSfx },
      { ref: slideAudioRef, src: slideSfx },
      { ref: missAudioRef, src: missSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
    ]
    audios.forEach(({ ref, src }) => {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    })

    colorStartAtRef.current = performance.now()
    lastSubmitAtRef.current = performance.now()

    return () => {
      if (lastSubmitTimerRef.current !== null) window.clearTimeout(lastSubmitTimerRef.current)
      if (bonusTextTimerRef.current !== null) window.clearTimeout(bonusTextTimerRef.current)
      if (hintCooldownTimerRef.current !== null) window.clearTimeout(hintCooldownTimerRef.current)
      if (screenFlashTimerRef.current !== null) window.clearTimeout(screenFlashTimerRef.current)
      effects.cleanup()
      audios.forEach(({ ref }) => { ref.current = null })
    }
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
        }
      }

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.64, 0.95)
        finishGame()
        animationFrameRef.current = null
        return
      }

      effects.updateParticles()
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

  const target = TARGET_COLORS[targetIndex]
  const targetRgb = target ? toRgbString(target.r, target.g, target.b) : 'rgb(128,128,128)'
  const mixRgb = toRgbString(sliderR, sliderG, sliderB)
  const currentDist = target ? colorDistance(sliderR, sliderG, sliderB, target.r, target.g, target.b) : 0
  const currentAccuracy = target ? scoreFromDistance(currentDist) : 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const comboMult = 1 + combo * COMBO_MULTIPLIER_STEP
  const accuracyInfo = getAccuracyLabel(currentAccuracy)

  return (
    <section className="mini-game-panel paint-mix-panel" aria-label="paint-mix-game" style={{ position: 'relative', maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Screen flash overlay */}
      {screenFlashColor && (
        <div className="pm-screen-flash" style={{ background: screenFlashColor }} />
      )}

      {/* Header */}
      <div className="pm-header">
        <img className="pm-avatar" src={characterImg} alt="Artist" />
        <div style={{ flex: 1 }}>
          <p className="pm-score">{score.toLocaleString()}</p>
          <p className="pm-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`pm-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      {/* Stats row */}
      <div className="pm-stats-row">
        <span className="pm-stat">{'\u{1F3A8}'} <strong>{colorsMatched}</strong></span>
        <span className="pm-stat">Combo <strong style={{ color: combo > 1 ? '#e11d48' : undefined }}>{combo}</strong></span>
        {comboMult > 1 && <span className="pm-stat" style={{ color: '#e11d48' }}>x{comboMult.toFixed(2)}</span>}
        {perfectCount > 0 && <span className="pm-stat" style={{ color: '#16a34a' }}>{'\u{2B50}'} {perfectCount}</span>}
      </div>

      {/* Fever banner */}
      {isFever && (
        <p className="pm-fever-banner">
          {'\u{1F525}'} FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s) {'\u{1F525}'}
        </p>
      )}

      {/* Golden round indicator */}
      {isGoldenRound && (
        <p className="pm-golden-banner">{'\u{1F451}'} GOLDEN ROUND x3! {'\u{1F451}'}</p>
      )}

      {/* Rainbow round indicator */}
      {isRainbowRound && (
        <p className="pm-rainbow-banner">{'\u{1F308}'} RAINBOW BONUS! {'\u{1F308}'}</p>
      )}

      {bonusText && <p className="pm-bonus-text">{bonusText}</p>}

      {/* Target name */}
      <p className="pm-target-name">
        TARGET: {target?.name ?? '?'}
        {isGoldenRound && ' \u{1F451}'}
      </p>

      {/* Color comparison */}
      <div className="pm-color-area">
        <div className="pm-swatch-container">
          <div className="pm-swatch" style={{
            backgroundColor: targetRgb,
            boxShadow: isGoldenRound ? '0 0 20px rgba(255,215,0,0.6)' : isFever ? '0 4px 12px rgba(225,29,72,0.5)' : '0 4px 12px rgba(0,0,0,0.15)',
            border: isGoldenRound ? '3px solid #fbbf24' : '3px solid rgba(124,58,237,0.3)',
          }}>
            <span className="pm-swatch-label">Target</span>
          </div>
          <div className="pm-accuracy-ring" style={{ borderColor: accuracyInfo.color }}>
            <span className="pm-accuracy-text" style={{ color: accuracyInfo.color }}>{currentAccuracy}%</span>
            <span className="pm-accuracy-label" style={{ color: accuracyInfo.color }}>{accuracyInfo.text}</span>
          </div>
          <div className="pm-swatch" style={{ backgroundColor: mixRgb }}>
            <span className="pm-swatch-label">Your Mix</span>
          </div>
        </div>
      </div>

      {/* Sliders */}
      <div className="pm-slider-group">
        <div className="pm-slider-row">
          <span className="pm-slider-label" style={{ color: '#ef4444' }}>R</span>
          <input
            className="pm-slider pm-slider-r"
            type="range"
            min={0}
            max={255}
            value={sliderR}
            onChange={(e) => { setSliderR(Number(e.target.value)); playAudio(slideAudioRef, 0.15, 0.8 + Number(e.target.value) / 500) }}
          />
          <span className="pm-slider-value">{sliderR}</span>
          {showHints && target && <span className="pm-hint">{getChannelHint(sliderR, target.r)}</span>}
        </div>
        <div className="pm-slider-row">
          <span className="pm-slider-label" style={{ color: '#22c55e' }}>G</span>
          <input
            className="pm-slider pm-slider-g"
            type="range"
            min={0}
            max={255}
            value={sliderG}
            onChange={(e) => { setSliderG(Number(e.target.value)); playAudio(slideAudioRef, 0.15, 0.8 + Number(e.target.value) / 500) }}
          />
          <span className="pm-slider-value">{sliderG}</span>
          {showHints && target && <span className="pm-hint">{getChannelHint(sliderG, target.g)}</span>}
        </div>
        <div className="pm-slider-row">
          <span className="pm-slider-label" style={{ color: '#3b82f6' }}>B</span>
          <input
            className="pm-slider pm-slider-b"
            type="range"
            min={0}
            max={255}
            value={sliderB}
            onChange={(e) => { setSliderB(Number(e.target.value)); playAudio(slideAudioRef, 0.15, 0.8 + Number(e.target.value) / 500) }}
          />
          <span className="pm-slider-value">{sliderB}</span>
          {showHints && target && <span className="pm-hint">{getChannelHint(sliderB, target.b)}</span>}
        </div>
      </div>

      {/* Actions */}
      <div className="pm-action-area">
        <button
          className="pm-hint-btn"
          type="button"
          onClick={useHint}
          disabled={!hintAvailable}
        >
          {hintAvailable ? '\u{1F4A1} Hint' : '\u{23F3} Cooldown'}
        </button>
        <button className="pm-submit-btn" type="button" onClick={handleSubmit}>
          {'\u{1F3A8}'} Submit Mix
        </button>
      </div>

      {/* Feedback */}
      {lastSubmitScore !== null && (
        <div className={`pm-feedback ${lastSubmitFade ? 'fade' : ''}`}>
          <span className={`pm-feedback-text ${lastSubmitScore >= 80 ? 'excellent' : lastSubmitScore >= 50 ? 'good' : 'poor'}`}>
            +{lastSubmitScore} {lastAccuracyLabel}
          </span>
        </div>
      )}

      {/* Footer */}
      <button className="pm-hub-btn" type="button" onClick={handleExit}>
        Hub
      </button>

      <style>{`
        .paint-mix-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          overflow: hidden;
          background: linear-gradient(180deg, #7c3aed 0%, #a78bfa 12%, #f5f4ef 35%, #ede9df 100%);
        }

        .pm-screen-flash {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 100;
          animation: pm-flash-fade 0.3s ease-out forwards;
        }

        @keyframes pm-flash-fade {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        .pm-header {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 12px 16px 8px;
          background: linear-gradient(180deg, rgba(0,0,0,0.35), transparent);
          box-sizing: border-box;
        }

        .pm-avatar {
          width: clamp(44px, 12vw, 56px);
          height: clamp(44px, 12vw, 56px);
          border-radius: 50%;
          border: 3px solid #c084fc;
          box-shadow: 0 2px 10px rgba(0,0,0,0.3);
          object-fit: cover;
        }

        .pm-score {
          font-size: clamp(28px, 7vw, 36px);
          font-weight: 900;
          color: #faf5ff;
          margin: 0;
          text-shadow: 0 2px 6px rgba(0,0,0,0.5);
          letter-spacing: 1px;
        }

        .pm-best {
          font-size: 10px;
          font-weight: 600;
          color: rgba(250,245,255,0.6);
          margin: 0;
        }

        .pm-time {
          font-size: clamp(20px, 5vw, 26px);
          font-weight: 800;
          color: #faf5ff;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        .pm-time.low-time {
          color: #fca5a5;
          animation: pm-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes pm-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.05); }
        }

        .pm-stats-row {
          display: flex;
          justify-content: center;
          gap: 14px;
          padding: 4px 12px;
        }

        .pm-stat {
          font-size: 13px;
          font-weight: 700;
          color: #6b21a8;
        }

        .pm-stat strong {
          font-size: 15px;
        }

        .pm-fever-banner {
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 900;
          color: #fff;
          letter-spacing: 3px;
          text-align: center;
          margin: 0;
          padding: 6px 0;
          background: linear-gradient(90deg, #e11d48, #f97316, #e11d48);
          background-size: 200% 100%;
          animation: pm-fever-slide 0.6s linear infinite;
          text-shadow: 0 0 10px rgba(0,0,0,0.4);
          width: 100%;
        }

        @keyframes pm-fever-slide {
          0% { background-position: 0% 0%; }
          100% { background-position: 200% 0%; }
        }

        .pm-golden-banner {
          font-size: 15px;
          font-weight: 900;
          color: #92400e;
          text-align: center;
          margin: 0;
          padding: 5px 0;
          background: linear-gradient(90deg, #fef3c7, #fde68a, #fef3c7);
          width: 100%;
          letter-spacing: 2px;
          animation: pm-golden-glow 0.5s ease-in-out infinite alternate;
        }

        @keyframes pm-golden-glow {
          from { box-shadow: inset 0 0 20px rgba(251,191,36,0.3); }
          to { box-shadow: inset 0 0 30px rgba(251,191,36,0.6); }
        }

        .pm-rainbow-banner {
          font-size: 14px;
          font-weight: 900;
          text-align: center;
          margin: 0;
          padding: 4px 0;
          background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          width: 100%;
        }

        .pm-bonus-text {
          font-size: clamp(14px, 3.5vw, 18px);
          font-weight: 900;
          color: #f59e0b;
          text-align: center;
          margin: 0;
          text-shadow: 0 0 8px rgba(245,158,11,0.5);
          animation: pm-bonus-pop 0.3s ease-out;
        }

        @keyframes pm-bonus-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }

        .pm-target-name {
          font-size: clamp(14px, 3.5vw, 18px);
          color: #581c87;
          font-weight: 900;
          text-align: center;
          margin: 0;
          letter-spacing: 2px;
        }

        .pm-color-area {
          padding: 4px 16px;
          width: 100%;
          box-sizing: border-box;
        }

        .pm-swatch-container {
          display: flex;
          gap: 10px;
          justify-content: center;
          align-items: center;
        }

        .pm-swatch {
          width: clamp(72px, 20vw, 96px);
          height: clamp(72px, 20vw, 96px);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          transition: all 0.2s;
        }

        .pm-swatch-label {
          position: absolute;
          bottom: -18px;
          font-size: 10px;
          font-weight: 700;
          color: #7c3aed;
          white-space: nowrap;
        }

        .pm-accuracy-ring {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 72px;
          height: 72px;
          border-radius: 50%;
          border: 4px solid;
          transition: all 0.2s;
        }

        .pm-accuracy-text {
          font-size: clamp(18px, 5vw, 24px);
          font-weight: 900;
        }

        .pm-accuracy-label {
          font-size: 9px;
          font-weight: 800;
        }

        .pm-slider-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 100%;
          max-width: 360px;
          padding: 0 16px;
          box-sizing: border-box;
        }

        .pm-slider-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .pm-slider-label {
          font-size: 16px;
          font-weight: 900;
          width: 20px;
          text-align: center;
        }

        .pm-slider-value {
          font-size: 13px;
          font-weight: 700;
          width: 32px;
          text-align: right;
          color: #581c87;
        }

        .pm-hint {
          font-size: 16px;
          width: 24px;
          text-align: center;
        }

        .pm-slider {
          flex: 1;
          height: 28px;
          -webkit-appearance: none;
          appearance: none;
          border-radius: 14px;
          outline: none;
          border: 2px solid rgba(124,58,237,0.2);
        }

        .pm-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 26px;
          height: 32px;
          border-radius: 8px;
          background: #fff;
          border: 3px solid #7c3aed;
          box-shadow: 0 2px 8px rgba(0,0,0,0.25);
          cursor: pointer;
        }

        .pm-slider.pm-slider-r {
          background: linear-gradient(to right, #1a1a1a, #ef4444);
        }

        .pm-slider.pm-slider-g {
          background: linear-gradient(to right, #1a1a1a, #22c55e);
        }

        .pm-slider.pm-slider-b {
          background: linear-gradient(to right, #1a1a1a, #3b82f6);
        }

        .pm-action-area {
          display: flex;
          gap: 10px;
          justify-content: center;
          align-items: center;
          padding: 4px 16px;
        }

        .pm-hint-btn {
          font-size: 14px;
          font-weight: 700;
          padding: 10px 16px;
          border-radius: 12px;
          border: 2px solid rgba(124,58,237,0.3);
          background: rgba(255,255,255,0.8);
          color: #7c3aed;
          cursor: pointer;
          transition: all 0.1s;
        }

        .pm-hint-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }

        .pm-hint-btn:active:not(:disabled) {
          transform: scale(0.95);
        }

        .pm-submit-btn {
          font-size: clamp(16px, 4vw, 20px);
          font-weight: 900;
          padding: 12px 32px;
          border-radius: 16px;
          border: none;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          color: #fff;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(124,58,237,0.5);
          transition: transform 0.1s, box-shadow 0.1s;
          letter-spacing: 1px;
        }

        .pm-submit-btn:active {
          transform: scale(0.93);
          box-shadow: 0 2px 8px rgba(124,58,237,0.3);
        }

        .pm-feedback {
          text-align: center;
          min-height: 24px;
          transition: opacity 0.4s;
        }

        .pm-feedback.fade {
          opacity: 0;
        }

        .pm-feedback-text {
          font-size: clamp(16px, 4vw, 20px);
          font-weight: 900;
        }

        .pm-feedback-text.excellent {
          color: #16a34a;
          text-shadow: 0 0 10px rgba(22,163,74,0.4);
        }

        .pm-feedback-text.good {
          color: #ca8a04;
        }

        .pm-feedback-text.poor {
          color: #dc2626;
        }

        .pm-hub-btn {
          font-size: 13px;
          font-weight: 700;
          padding: 8px 24px;
          border-radius: 10px;
          border: 2px solid rgba(124,58,237,0.3);
          background: rgba(255,255,255,0.7);
          color: #7c3aed;
          cursor: pointer;
          transition: transform 0.1s, background 0.1s;
          margin-top: auto;
          margin-bottom: 10px;
        }

        .pm-hub-btn:active {
          transform: scale(0.95);
          background: rgba(255,255,255,0.9);
        }
      `}</style>
    </section>
  )
}

export const paintMixModule: MiniGameModule = {
  manifest: {
    id: 'paint-mix',
    title: 'Paint Mix',
    description: '\uBE68\uD30C\uB178 \uD398\uC778\uD2B8\uB97C \uC11E\uC5B4 \uD0C0\uAC9F \uC0C9\uC0C1\uC744 \uB9CC\uB4E4\uC5B4\uB77C!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#7c3aed',
  },
  Component: PaintMixGame,
}
