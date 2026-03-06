import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import bgStudioImg from '../../../assets/images/paint-mix/bg-studio.png'
import iconPaletteImg from '../../../assets/images/paint-mix/icon-palette.png'
import splashSfx from '../../../assets/sounds/paint-mix-splash.mp3'
import perfectSfx from '../../../assets/sounds/paint-mix-perfect.mp3'
import slideSfx from '../../../assets/sounds/paint-mix-slide.mp3'
import missSfx from '../../../assets/sounds/paint-mix-miss.mp3'
import comboSfx from '../../../assets/sounds/paint-mix-combo.mp3'
import levelupSfx from '../../../assets/sounds/paint-mix-levelup.mp3'
import feverSfx from '../../../assets/sounds/paint-mix-fever.mp3'
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
const MIN_ACCURACY_FOR_SCORE = 40

// --- Feature constants ---
const GOLDEN_COLOR_CHANCE = 0.12
const GOLDEN_MULTIPLIER = 3
const HINT_COOLDOWN_MS = 15000
const TIME_BONUS_PER_PERFECT_MS = 2000
const DIFFICULTY_SCALE_INTERVAL = 5
const RAINBOW_ROUND_INTERVAL = 8
const RAINBOW_BONUS = 30

// --- Pixel canvas constants ---
const CANVAS_COLS = 8
const CANVAS_ROWS = 8

// --- Rank thresholds ---
const RANKS = [
  { min: 0, label: 'Apprentice', emoji: '\u{1F3A8}' },
  { min: 5, label: 'Mixer', emoji: '\u{1F58C}\u{FE0F}' },
  { min: 15, label: 'Artist', emoji: '\u{1F5BC}\u{FE0F}' },
  { min: 30, label: 'Master', emoji: '\u{1F451}' },
  { min: 50, label: 'Legend', emoji: '\u{2B50}' },
] as const

function getRank(perfectCount: number): (typeof RANKS)[number] {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (perfectCount >= RANKS[i].min) return RANKS[i]
  }
  return RANKS[0]
}

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

function getAccuracyLabel(accuracy: number): { text: string; color: string; pixelColor: string } {
  if (accuracy >= 95) return { text: 'PERFECT!', color: '#22c55e', pixelColor: '#4ade80' }
  if (accuracy >= 80) return { text: 'Excellent!', color: '#22c55e', pixelColor: '#86efac' }
  if (accuracy >= 60) return { text: 'Good', color: '#eab308', pixelColor: '#fde047' }
  if (accuracy >= 40) return { text: 'Close...', color: '#f97316', pixelColor: '#fb923c' }
  return { text: 'Miss', color: '#ef4444', pixelColor: '#f87171' }
}

function getChannelHint(current: number, target: number): string {
  const diff = target - current
  if (Math.abs(diff) < 15) return '\u{2705}'
  return diff > 0 ? '\u{25B2}' : '\u{25BC}'
}

/** Generate a pixel canvas pattern where some cells are filled with color */
function generatePixelCanvas(_r: number, _g: number, _b: number, fillRatio: number): boolean[][] {
  const grid: boolean[][] = []
  for (let row = 0; row < CANVAS_ROWS; row++) {
    const rowData: boolean[] = []
    for (let col = 0; col < CANVAS_COLS; col++) {
      rowData.push(Math.random() < fillRatio)
    }
    grid.push(rowData)
  }
  return grid
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
  const [sliderTouched, setSliderTouched] = useState(false)
  const [showHints, setShowHints] = useState(false)
  const [screenFlashColor, setScreenFlashColor] = useState('')
  const [lastAccuracyLabel, setLastAccuracyLabel] = useState('')
  const [pixelCanvas, setPixelCanvas] = useState<boolean[][]>(() => generatePixelCanvas(128, 128, 128, 0))
  const [pixelFillAnimation, setPixelFillAnimation] = useState(false)
  const [showRankUp, setShowRankUp] = useState(false)
  const [currentRankLabel, setCurrentRankLabel] = useState('')

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
  const pixelAnimTimerRef = useRef<number | null>(null)
  const rankUpTimerRef = useRef<number | null>(null)
  const perfectCountRef = useRef(0)
  const prevRankRef = useRef<(typeof RANKS)[number]>(RANKS[0])

  const splashAudioRef = useRef<HTMLAudioElement | null>(null)
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const slideAudioRef = useRef<HTMLAudioElement | null>(null)
  const missAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const levelupAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
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
      audio.volume = Math.min(1, Math.max(0, volume))
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const triggerScreenFlash = useCallback((color: string, durationMs = 300) => {
    setScreenFlashColor(color)
    clearTimeoutSafe(screenFlashTimerRef)
    screenFlashTimerRef.current = window.setTimeout(() => {
      screenFlashTimerRef.current = null
      setScreenFlashColor('')
    }, durationMs)
  }, [])

  const triggerPixelFill = useCallback((accuracy: number) => {
    const fillRatio = accuracy / 100
    setPixelCanvas(generatePixelCanvas(0, 0, 0, fillRatio))
    setPixelFillAnimation(true)
    clearTimeoutSafe(pixelAnimTimerRef)
    pixelAnimTimerRef.current = window.setTimeout(() => {
      pixelAnimTimerRef.current = null
      setPixelFillAnimation(false)
    }, 600)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true

    clearTimeoutSafe(lastSubmitTimerRef)
    clearTimeoutSafe(bonusTextTimerRef)
    clearTimeoutSafe(hintCooldownTimerRef)
    clearTimeoutSafe(screenFlashTimerRef)
    clearTimeoutSafe(pixelAnimTimerRef)
    clearTimeoutSafe(rankUpTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const useHint = useCallback(() => {
    if (!hintAvailable) return
    setShowHints(true)
    setHintAvailable(false)
    playAudio(slideAudioRef, 0.3, 1.5)
    clearTimeoutSafe(hintCooldownTimerRef)
    hintCooldownTimerRef.current = window.setTimeout(() => {
      hintCooldownTimerRef.current = null
      setHintAvailable(true)
      setShowHints(false)
    }, HINT_COOLDOWN_MS)
  }, [hintAvailable, playAudio])

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

    // Pixel fill animation based on accuracy
    triggerPixelFill(basePoints)

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

    // Combo sound
    if (comboRef.current >= 2) {
      playAudio(comboAudioRef, 0.5, 1 + comboRef.current * 0.08)
    }

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
      playAudio(feverAudioRef, 0.7, 1)
      triggerScreenFlash('rgba(239,68,68,0.5)', 500)
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
      perfectCountRef.current += 1
      setPerfectCount(perfectCountRef.current)
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_PERFECT_MS)
      setRemainingMs(remainingMsRef.current)

      // Check rank up
      const newRank = getRank(perfectCountRef.current)
      if (newRank !== prevRankRef.current) {
        prevRankRef.current = newRank
        setCurrentRankLabel(`${newRank.emoji} ${newRank.label}`)
        setShowRankUp(true)
        playAudio(levelupAudioRef, 0.7, 1)
        clearTimeoutSafe(rankUpTimerRef)
        rankUpTimerRef.current = window.setTimeout(() => {
          rankUpTimerRef.current = null
          setShowRankUp(false)
        }, 2000)
      }
    }

    // Rainbow round bonus
    const rainbowBonus = isRainbowRound && basePoints >= 80 ? RAINBOW_BONUS : 0

    const totalPoints = !sliderTouched || basePoints < MIN_ACCURACY_FOR_SCORE
      ? 0
      : Math.round((basePoints + speedBonus + perfBonus + rainbowBonus) * comboMult * feverMult * goldenMult)

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
      clearTimeoutSafe(bonusTextTimerRef)
      bonusTextTimerRef.current = window.setTimeout(() => {
        bonusTextTimerRef.current = null
        setBonusText('')
      }, 1200)
    }

    clearTimeoutSafe(lastSubmitTimerRef)
    lastSubmitTimerRef.current = window.setTimeout(() => {
      lastSubmitTimerRef.current = null
      setLastSubmitFade(true)
    }, 1200)

    // Sound & effects based on score
    if (basePoints >= 90) {
      playAudio(perfectAudioRef, 0.7, 1 + basePoints * 0.001)
      effects.triggerFlash('rgba(34,197,94,0.5)')
      effects.spawnParticles(10, 200, 300)
      triggerScreenFlash('rgba(34,197,94,0.3)')
    } else if (basePoints >= 70) {
      playAudio(splashAudioRef, 0.6, 1)
      effects.triggerFlash()
      effects.spawnParticles(6, 200, 250)
    } else if (basePoints >= 50) {
      playAudio(splashAudioRef, 0.5, 0.9)
      effects.spawnParticles(3, 200, 200)
    } else {
      playAudio(missAudioRef, 0.5, 1)
      effects.triggerShake(6)
      effects.triggerFlash('rgba(239,68,68,0.4)')
      triggerScreenFlash('rgba(239,68,68,0.25)')
    }

    // Next color
    const nextIndex = pickNextTargetIndex(targetIndex, nextMatched)
    setTargetIndex(nextIndex)
    setSliderR(128)
    setSliderG(128)
    setSliderB(128)
    colorStartAtRef.current = performance.now()
    setShowHints(false)
    setSliderTouched(false)

    setIsGoldenRound(Math.random() < GOLDEN_COLOR_CHANCE)
    setIsRainbowRound(nextMatched > 0 && nextMatched % RAINBOW_ROUND_INTERVAL === 0)
  }, [targetIndex, sliderR, sliderG, sliderB, sliderTouched, playAudio, isGoldenRound, isRainbowRound, triggerScreenFlash, triggerPixelFill])

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
      { ref: comboAudioRef, src: comboSfx },
      { ref: levelupAudioRef, src: levelupSfx },
      { ref: feverAudioRef, src: feverSfx },
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
      clearTimeoutSafe(lastSubmitTimerRef)
      clearTimeoutSafe(bonusTextTimerRef)
      clearTimeoutSafe(hintCooldownTimerRef)
      clearTimeoutSafe(screenFlashTimerRef)
      clearTimeoutSafe(pixelAnimTimerRef)
      clearTimeoutSafe(rankUpTimerRef)
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
  const accuracyInfo = getAccuracyLabel(currentAccuracy)
  const currentRank = getRank(perfectCount)
  const colorPoolSize = Math.min(TARGET_COLORS.length, 6 + Math.floor(colorsMatched / DIFFICULTY_SCALE_INTERVAL))

  return (
    <section className="mini-game-panel pm-panel" aria-label="paint-mix-game" style={{ position: 'relative', maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <div className="pm-bg-blur" style={{ backgroundImage: `url(${bgStudioImg})` }} />
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {screenFlashColor && (
        <div className="pm-screen-flash" style={{ background: screenFlashColor }} />
      )}

      {/* === PIXEL HEADER === */}
      <div className="pm-header">
        <img className="pm-avatar" src={iconPaletteImg} alt="Palette" />
        <div className="pm-header-info">
          <p className="pm-score">{score.toLocaleString()}</p>
          <p className="pm-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="pm-header-time">
          <p className={`pm-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      {/* === STATS BAR === */}
      <div className="pm-stats-bar">
        <span className="pm-pixel-badge">{currentRank.emoji} {currentRank.label}</span>
        <span className="pm-pixel-stat">x{combo}</span>
        <span className="pm-pixel-stat">{'\u{1F3A8}'}{colorsMatched}</span>
        <span className="pm-pixel-stat">{'\u{2B50}'}{perfectCount}</span>
        <span className="pm-pixel-stat">LV{colorPoolSize}</span>
      </div>

      {/* === GAME BODY (centered in remaining space) === */}
      <div className="pm-game-body">

      {/* === BANNERS === */}
      {isFever && (
        <div className="pm-fever-banner">
          {'\u{1F525}'} FEVER x{FEVER_MULTIPLIER} {(feverMs / 1000).toFixed(1)}s {'\u{1F525}'}
        </div>
      )}
      {isGoldenRound && (
        <div className="pm-golden-banner">{'\u{1F451}'} GOLDEN x3 {'\u{1F451}'}</div>
      )}
      {isRainbowRound && (
        <div className="pm-rainbow-banner">{'\u{1F308}'} RAINBOW BONUS {'\u{1F308}'}</div>
      )}
      {showRankUp && (
        <div className="pm-rankup-banner">RANK UP! {currentRankLabel}</div>
      )}
      {bonusText && <div className="pm-bonus-text">{bonusText}</div>}

      {/* === TARGET LABEL === */}
      <div className="pm-target-label">
        TARGET: <span style={{ color: targetRgb }}>{'\u{25A0}\u{25A0}\u{25A0}'}</span> {target?.name ?? '?'}
        {isGoldenRound && ' \u{1F451}'}
      </div>

      {/* === COLOR COMPARE === */}
      <div className="pm-color-compare">
        <div className="pm-pixel-swatch-wrap">
          <div className="pm-pixel-swatch" style={{
            backgroundColor: targetRgb,
            boxShadow: isGoldenRound
              ? '4px 4px 0 #92400e, 0 0 16px rgba(251,191,36,0.6)'
              : '4px 4px 0 rgba(0,0,0,0.3)',
          }} />
          <span className="pm-swatch-tag">Target</span>
        </div>

        <div className="pm-accuracy-display">
          <div className="pm-accuracy-bar-bg">
            <div
              className="pm-accuracy-bar-fill"
              style={{
                width: `${currentAccuracy}%`,
                background: accuracyInfo.color,
              }}
            />
          </div>
          <span className="pm-accuracy-num" style={{ color: accuracyInfo.color }}>{currentAccuracy}%</span>
          <span className="pm-accuracy-txt" style={{ color: accuracyInfo.color }}>{accuracyInfo.text}</span>
        </div>

        <div className="pm-pixel-swatch-wrap">
          <div className="pm-pixel-swatch" style={{
            backgroundColor: mixRgb,
            boxShadow: '4px 4px 0 rgba(0,0,0,0.3)',
          }} />
          <span className="pm-swatch-tag">Mix</span>
        </div>
      </div>

      {/* === PIXEL CANVAS (mini artwork preview) === */}
      <div className={`pm-pixel-canvas ${pixelFillAnimation ? 'pop' : ''}`}>
        {pixelCanvas.map((row, ri) => (
          <div className="pm-pixel-row" key={ri}>
            {row.map((filled, ci) => (
              <div
                className="pm-pixel-cell"
                key={ci}
                style={{
                  background: filled ? mixRgb : 'rgba(0,0,0,0.05)',
                  animationDelay: filled ? `${(ri * CANVAS_COLS + ci) * 15}ms` : undefined,
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* === SLIDERS === */}
      <div className="pm-slider-group">
        {[
          { label: 'R', color: '#ef4444', value: sliderR, setter: setSliderR, targetVal: target?.r },
          { label: 'G', color: '#22c55e', value: sliderG, setter: setSliderG, targetVal: target?.g },
          { label: 'B', color: '#3b82f6', value: sliderB, setter: setSliderB, targetVal: target?.b },
        ].map(({ label, color, value, setter, targetVal }) => (
          <div className="pm-slider-row" key={label}>
            <span className="pm-slider-label" style={{ color }}>{label}</span>
            <div className="pm-slider-track-wrap">
              <input
                className={`pm-slider pm-slider-${label.toLowerCase()}`}
                type="range"
                min={0}
                max={255}
                value={value}
                onChange={(e) => {
                  setter(Number(e.target.value))
                  if (!sliderTouched) setSliderTouched(true)
                  playAudio(slideAudioRef, 0.1, 0.8 + Number(e.target.value) / 500)
                }}
              />
            </div>
            <span className="pm-slider-value">{value}</span>
            {showHints && targetVal !== undefined && (
              <span className="pm-hint" style={{ color }}>{getChannelHint(value, targetVal)}</span>
            )}
          </div>
        ))}
      </div>

      {/* === ACTIONS === */}
      <div className="pm-action-area">
        <button
          className="pm-pixel-btn pm-hint-btn"
          type="button"
          onClick={useHint}
          disabled={!hintAvailable}
        >
          {hintAvailable ? '\u{1F4A1}Hint' : '\u{23F3}Wait'}
        </button>
        <button className="pm-pixel-btn pm-submit-btn" type="button" onClick={handleSubmit}>
          {'\u{1F3A8}'} MIX!
        </button>
      </div>

      {/* === FEEDBACK === */}
      {lastSubmitScore !== null && (
        <div className={`pm-feedback ${lastSubmitFade ? 'fade' : ''}`}>
          <span className={`pm-feedback-text ${lastSubmitScore >= 80 ? 'excellent' : lastSubmitScore >= 50 ? 'good' : 'poor'}`}>
            +{lastSubmitScore} {lastAccuracyLabel}
          </span>
        </div>
      )}

      </div>{/* end pm-game-body */}

      <style>{`
        /* ==================== PIXEL ART THEME ==================== */
        .pm-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          overflow: hidden;
          image-rendering: pixelated;
          font-family: 'Courier New', 'Monaco', monospace;
        }

        .pm-bg-blur {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          filter: blur(6px) brightness(0.7);
          z-index: 0;
          pointer-events: none;
          image-rendering: pixelated;
        }

        .pm-panel > *:not(.pm-bg-blur) {
          position: relative;
          z-index: 1;
        }

        .pm-screen-flash {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 100;
          animation: pm-flash-fade 0.3s steps(4) forwards;
        }

        @keyframes pm-flash-fade {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        /* ---- HEADER ---- */
        .pm-header {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 14px 8px;
          background: linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(45,27,105,0.8) 100%);
          box-sizing: border-box;
          border-bottom: 4px solid #7c3aed;
          image-rendering: pixelated;
        }

        .pm-avatar {
          width: clamp(48px, 13vw, 60px);
          height: clamp(48px, 13vw, 60px);
          border: 4px solid #a855f7;
          box-shadow: 4px 4px 0 rgba(0,0,0,0.4);
          image-rendering: pixelated;
          object-fit: cover;
        }

        .pm-header-info {
          flex: 1;
        }

        .pm-score {
          font-size: clamp(36px, 9vw, 52px);
          font-weight: 900;
          color: #faf5ff;
          margin: 0;
          text-shadow: 3px 3px 0 rgba(0,0,0,0.5);
          letter-spacing: 2px;
        }

        .pm-best {
          font-size: 10px;
          font-weight: 700;
          color: rgba(250,245,255,0.5);
          margin: 0;
          letter-spacing: 1px;
        }

        .pm-header-time {
          text-align: right;
        }

        .pm-time {
          font-size: clamp(20px, 5vw, 28px);
          font-weight: 900;
          color: #faf5ff;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.4);
        }

        .pm-time.low-time {
          color: #f87171;
          animation: pm-blink 0.4s steps(2) infinite;
        }

        @keyframes pm-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* ---- GAME BODY (centered in remaining space) ---- */
        .pm-game-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          width: 100%;
          overflow: hidden;
        }

        /* ---- STATS BAR ---- */
        .pm-stats-bar {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 6px 12px;
          width: 100%;
          box-sizing: border-box;
          background: rgba(124,58,237,0.1);
          border-bottom: 2px solid rgba(124,58,237,0.2);
        }

        .pm-pixel-badge {
          font-size: 12px;
          font-weight: 900;
          color: #7c3aed;
          padding: 2px 8px;
          background: rgba(124,58,237,0.15);
          border: 2px solid #7c3aed;
          letter-spacing: 1px;
        }

        .pm-pixel-stat {
          font-size: 13px;
          font-weight: 900;
          color: #581c87;
          letter-spacing: 1px;
        }

        /* ---- BANNERS ---- */
        .pm-fever-banner {
          width: 100%;
          text-align: center;
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 900;
          color: #fff;
          padding: 6px 0;
          background: repeating-linear-gradient(90deg, #ef4444 0px, #ef4444 8px, #f97316 8px, #f97316 16px);
          background-size: 16px 100%;
          animation: pm-fever-scroll 0.3s linear infinite;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.4);
          letter-spacing: 3px;
          border-top: 2px solid #fbbf24;
          border-bottom: 2px solid #fbbf24;
        }

        @keyframes pm-fever-scroll {
          0% { background-position: 0 0; }
          100% { background-position: 16px 0; }
        }

        .pm-golden-banner {
          width: 100%;
          text-align: center;
          font-size: 14px;
          font-weight: 900;
          color: #78350f;
          padding: 4px 0;
          background: repeating-linear-gradient(90deg, #fde68a 0px, #fde68a 6px, #fef3c7 6px, #fef3c7 12px);
          border-top: 2px solid #f59e0b;
          border-bottom: 2px solid #f59e0b;
          letter-spacing: 2px;
        }

        .pm-rainbow-banner {
          width: 100%;
          text-align: center;
          font-size: 14px;
          font-weight: 900;
          padding: 4px 0;
          background: linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #3b82f6, #8b5cf6);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .pm-rankup-banner {
          width: 100%;
          text-align: center;
          font-size: clamp(16px, 4vw, 22px);
          font-weight: 900;
          color: #fff;
          padding: 8px 0;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          border-top: 3px solid #fbbf24;
          border-bottom: 3px solid #fbbf24;
          animation: pm-rankup-flash 0.3s steps(3) infinite alternate;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.4);
          letter-spacing: 3px;
        }

        @keyframes pm-rankup-flash {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }

        .pm-bonus-text {
          font-size: clamp(14px, 3.5vw, 18px);
          font-weight: 900;
          color: #f59e0b;
          text-align: center;
          margin: 0;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.2);
          animation: pm-bonus-pop 0.3s steps(4);
        }

        @keyframes pm-bonus-pop {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); opacity: 1; }
        }

        /* ---- TARGET LABEL ---- */
        .pm-target-label {
          font-size: clamp(14px, 3.5vw, 18px);
          font-weight: 900;
          color: #581c87;
          text-align: center;
          margin: 0;
          letter-spacing: 2px;
          text-shadow: 1px 1px 0 rgba(0,0,0,0.1);
        }

        /* ---- COLOR COMPARE ---- */
        .pm-color-compare {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 4px 14px;
          width: 100%;
          box-sizing: border-box;
        }

        .pm-pixel-swatch-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .pm-pixel-swatch {
          width: clamp(64px, 18vw, 88px);
          height: clamp(64px, 18vw, 88px);
          border: 4px solid #1a1a2e;
          transition: background-color 0.1s steps(4);
          image-rendering: pixelated;
        }

        .pm-swatch-tag {
          font-size: 10px;
          font-weight: 900;
          color: #7c3aed;
          letter-spacing: 1px;
        }

        .pm-accuracy-display {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          min-width: 64px;
        }

        .pm-accuracy-bar-bg {
          width: 56px;
          height: 48px;
          background: #1a1a2e;
          border: 3px solid #4c1d95;
          display: flex;
          flex-direction: column;
          justify-content: flex-end;
          overflow: hidden;
        }

        .pm-accuracy-bar-fill {
          width: 100%;
          transition: height 0.15s steps(6);
          height: ${currentAccuracy}%;
        }

        .pm-accuracy-num {
          font-size: clamp(18px, 5vw, 26px);
          font-weight: 900;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.15);
        }

        .pm-accuracy-txt {
          font-size: 10px;
          font-weight: 900;
          letter-spacing: 1px;
        }

        /* ---- PIXEL CANVAS ---- */
        .pm-pixel-canvas {
          display: flex;
          flex-direction: column;
          gap: 1px;
          padding: 4px;
          background: #1a1a2e;
          border: 3px solid #4c1d95;
          box-shadow: 4px 4px 0 rgba(0,0,0,0.3);
          transition: transform 0.2s steps(3);
        }

        .pm-pixel-canvas.pop {
          animation: pm-canvas-pop 0.5s steps(4);
        }

        @keyframes pm-canvas-pop {
          0% { transform: scale(0.95); }
          30% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }

        .pm-pixel-row {
          display: flex;
          gap: 1px;
        }

        .pm-pixel-cell {
          width: clamp(8px, 2.5vw, 12px);
          height: clamp(8px, 2.5vw, 12px);
          transition: background-color 0.05s steps(2);
        }

        .pm-pixel-canvas.pop .pm-pixel-cell {
          animation: pm-cell-fill 0.4s steps(2) backwards;
        }

        @keyframes pm-cell-fill {
          from { opacity: 0; transform: scale(0); }
          to { opacity: 1; transform: scale(1); }
        }

        /* ---- SLIDERS ---- */
        .pm-slider-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 380px;
          padding: 0 14px;
          box-sizing: border-box;
        }

        .pm-slider-row {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .pm-slider-label {
          font-size: 18px;
          font-weight: 900;
          width: 22px;
          text-align: center;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.15);
        }

        .pm-slider-track-wrap {
          flex: 1;
          position: relative;
        }

        .pm-slider-value {
          font-size: 13px;
          font-weight: 900;
          width: 34px;
          text-align: right;
          color: #4c1d95;
        }

        .pm-hint {
          font-size: 18px;
          width: 24px;
          text-align: center;
          animation: pm-hint-bounce 0.5s steps(3) infinite alternate;
        }

        @keyframes pm-hint-bounce {
          from { transform: translateY(-2px); }
          to { transform: translateY(2px); }
        }

        .pm-slider {
          flex: 1;
          width: 100%;
          height: 32px;
          -webkit-appearance: none;
          appearance: none;
          border: 3px solid #1a1a2e;
          outline: none;
        }

        .pm-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 36px;
          background: #faf5ff;
          border: 3px solid #1a1a2e;
          box-shadow: 3px 3px 0 rgba(0,0,0,0.3);
          cursor: pointer;
        }

        .pm-slider.pm-slider-r { background: linear-gradient(to right, #1a1a2e, #ef4444); }
        .pm-slider.pm-slider-g { background: linear-gradient(to right, #1a1a2e, #22c55e); }
        .pm-slider.pm-slider-b { background: linear-gradient(to right, #1a1a2e, #3b82f6); }

        /* ---- BUTTONS ---- */
        .pm-pixel-btn {
          font-family: 'Courier New', 'Monaco', monospace;
          font-weight: 900;
          cursor: pointer;
          border: 3px solid #1a1a2e;
          box-shadow: 4px 4px 0 rgba(0,0,0,0.3);
          transition: transform 0.05s steps(2), box-shadow 0.05s steps(2);
          letter-spacing: 1px;
          image-rendering: pixelated;
        }

        .pm-pixel-btn:active {
          transform: translate(3px, 3px);
          box-shadow: 1px 1px 0 rgba(0,0,0,0.3);
        }

        .pm-action-area {
          display: flex;
          gap: 10px;
          justify-content: center;
          align-items: center;
          padding: 4px 14px;
        }

        .pm-hint-btn {
          font-size: 14px;
          padding: 10px 14px;
          background: #ede9fe;
          color: #7c3aed;
        }

        .pm-hint-btn:disabled {
          opacity: 0.35;
          cursor: default;
        }

        .pm-submit-btn {
          font-size: clamp(16px, 4vw, 22px);
          padding: 12px 28px;
          background: linear-gradient(180deg, #a855f7, #7c3aed);
          color: #fff;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.3);
        }

        /* ---- FEEDBACK ---- */
        .pm-feedback {
          text-align: center;
          min-height: 24px;
          transition: opacity 0.3s steps(4);
        }

        .pm-feedback.fade { opacity: 0; }

        .pm-feedback-text {
          font-size: clamp(16px, 4vw, 22px);
          font-weight: 900;
          letter-spacing: 2px;
        }

        .pm-feedback-text.excellent {
          color: #22c55e;
          text-shadow: 2px 2px 0 rgba(0,0,0,0.15);
        }
        .pm-feedback-text.good { color: #eab308; }
        .pm-feedback-text.poor { color: #ef4444; }

      `}</style>
    </section>
  )
}

export const paintMixModule: MiniGameModule = {
  manifest: {
    id: 'paint-mix',
    title: 'Paint Mix',
    description: 'Mix RGB paint to create the target color!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#7c3aed',
  },
  Component: PaintMixGame,
}
