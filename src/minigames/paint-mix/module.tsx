import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import characterImg from '../../../assets/images/same-character/seo-taiji.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
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
] as const

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

function toRgbString(r: number, g: number, b: number): string {
  return `rgb(${r}, ${g}, ${b})`
}

function pickNextTargetIndex(currentIndex: number, colorsMatched: number): number {
  // After matching several, allow harder colors (teal, coral, indigo)
  const poolSize = Math.min(TARGET_COLORS.length, 6 + Math.floor(colorsMatched / 3))
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

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

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

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

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
    }

    const comboMult = 1 + comboRef.current * COMBO_MULTIPLIER_STEP
    const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1

    // Speed bonus
    const speedBonus = timeTaken < SPEED_BONUS_THRESHOLD_MS ? SPEED_BONUS_POINTS : 0

    // Perfect bonus
    let perfBonus = 0
    if (basePoints >= PERFECT_THRESHOLD) {
      perfBonus = PERFECT_BONUS
      setPerfectCount((p) => p + 1)
    }

    const totalPoints = Math.round((basePoints + speedBonus + perfBonus) * comboMult * feverMult)

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
    if (comboMult > 1) parts.push(`x${comboMult.toFixed(2)}`)
    if (isFeverRef.current) parts.push('FEVER!')
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

    if (totalPoints >= 80) {
      playAudio(tapHitStrongAudioRef, 0.6, 1 + basePoints * 0.002)
      effects.triggerFlash()
      effects.spawnParticles(4, 200, 200)
    } else if (totalPoints >= 50) {
      playAudio(tapHitAudioRef, 0.5, 0.9 + basePoints * 0.003)
      effects.triggerFlash()
      effects.spawnParticles(4, 200, 200)
    } else {
      playAudio(tapHitAudioRef, 0.5, 0.9 + basePoints * 0.003)
      effects.triggerShake(4)
      effects.triggerFlash('rgba(239,68,68,0.4)')
    }

    const nextIndex = pickNextTargetIndex(targetIndex, nextMatched)
    setTargetIndex(nextIndex)
    setSliderR(128)
    setSliderG(128)
    setSliderB(128)
    colorStartAtRef.current = performance.now()
  }, [targetIndex, sliderR, sliderG, sliderB, playAudio])

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  useEffect(() => {
    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    colorStartAtRef.current = performance.now()
    lastSubmitAtRef.current = performance.now()

    return () => {
      if (lastSubmitTimerRef.current !== null) {
        window.clearTimeout(lastSubmitTimerRef.current)
        lastSubmitTimerRef.current = null
      }
      if (bonusTextTimerRef.current !== null) {
        window.clearTimeout(bonusTextTimerRef.current)
        bonusTextTimerRef.current = null
      }
      effects.cleanup()
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
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
  const averageAccuracy = colorsMatched > 0 ? Math.round(score / colorsMatched) : 0
  const comboMult = 1 + combo * COMBO_MULTIPLIER_STEP

  return (
    <section className="mini-game-panel paint-mix-panel" aria-label="paint-mix-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="paint-mix-header">
        <img className="paint-mix-avatar" src={characterImg} alt="Artist" />
        <div style={{ flex: 1 }}>
          <p className="paint-mix-score">{score.toLocaleString()}</p>
          <p className="paint-mix-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`paint-mix-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="paint-mix-stats-row">
        <p>Colors: <strong>{colorsMatched}</strong></p>
        <p>Avg: <strong>{averageAccuracy}%</strong></p>
        <p>Combo: <strong style={{ color: combo > 1 ? '#e11d48' : undefined }}>{combo}</strong></p>
        {comboMult > 1 && <p style={{ color: '#e11d48', fontWeight: 'bold' }}>x{comboMult.toFixed(2)}</p>}
        {perfectCount > 0 && <p style={{ color: '#16a34a', fontWeight: 'bold' }}>Perfect: {perfectCount}</p>}
      </div>

      {isFever && (
        <p className="paint-mix-fever-banner">
          FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
        </p>
      )}

      {bonusText && <p className="paint-mix-bonus-text">{bonusText}</p>}

      <p className="paint-mix-target-name">TARGET: {target?.name ?? '?'}</p>

      <div className="paint-mix-color-area">
        <div className="paint-mix-swatch" style={{ backgroundColor: targetRgb, boxShadow: isFever ? '0 4px 12px rgba(225,29,72,0.5)' : '0 4px 12px rgba(0,0,0,0.15)' }}>
          <span className="paint-mix-swatch-label">Target</span>
        </div>
        <span className="paint-mix-vs">VS</span>
        <div className="paint-mix-swatch" style={{ backgroundColor: mixRgb }}>
          <span className="paint-mix-swatch-label">Your Mix</span>
        </div>
      </div>

      <div
        className={`paint-mix-accuracy-badge ${
          currentAccuracy >= 80
            ? 'paint-mix-accuracy-high'
            : currentAccuracy >= 50
              ? 'paint-mix-accuracy-mid'
              : 'paint-mix-accuracy-low'
        }`}
      >
        {currentAccuracy}%
      </div>

      <div className="paint-mix-slider-group">
        <div className="paint-mix-slider-row">
          <span className="paint-mix-slider-label" style={{ color: '#ef4444' }}>R</span>
          <input
            className="paint-mix-slider paint-mix-slider-r"
            type="range"
            min={0}
            max={255}
            value={sliderR}
            onChange={(e) => setSliderR(Number(e.target.value))}
          />
          <span className="paint-mix-slider-value">{sliderR}</span>
        </div>
        <div className="paint-mix-slider-row">
          <span className="paint-mix-slider-label" style={{ color: '#22c55e' }}>G</span>
          <input
            className="paint-mix-slider paint-mix-slider-g"
            type="range"
            min={0}
            max={255}
            value={sliderG}
            onChange={(e) => setSliderG(Number(e.target.value))}
          />
          <span className="paint-mix-slider-value">{sliderG}</span>
        </div>
        <div className="paint-mix-slider-row">
          <span className="paint-mix-slider-label" style={{ color: '#3b82f6' }}>B</span>
          <input
            className="paint-mix-slider paint-mix-slider-b"
            type="range"
            min={0}
            max={255}
            value={sliderB}
            onChange={(e) => setSliderB(Number(e.target.value))}
          />
          <span className="paint-mix-slider-value">{sliderB}</span>
        </div>
      </div>

      <div className="paint-mix-submit-area">
        <button className="paint-mix-submit-btn" type="button" onClick={handleSubmit}>
          Submit Mix
        </button>
        {lastSubmitScore !== null && (
          <span
            className={`paint-mix-feedback ${lastSubmitFade ? 'fade' : ''} ${
              lastSubmitScore >= 80 ? 'excellent' : lastSubmitScore >= 50 ? 'good' : 'poor'
            }`}
          >
            {lastSubmitScore >= 80
              ? `+${lastSubmitScore} Excellent!`
              : lastSubmitScore >= 50
                ? `+${lastSubmitScore} Good`
                : `+${lastSubmitScore} Miss...`}
          </span>
        )}
      </div>

      <button className="paint-mix-hub-btn" type="button" onClick={handleExit}>
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
          background: linear-gradient(180deg, #7c3aed 0%, #a78bfa 15%, #faf5ff 40%, #fdf2f8 100%);
        }

        .paint-mix-header {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 14px 8px;
          background: linear-gradient(180deg, rgba(0,0,0,0.3), transparent);
        }

        .paint-mix-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 3px solid #c084fc;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          object-fit: cover;
        }

        .paint-mix-score {
          font-size: 26px;
          font-weight: 800;
          color: #faf5ff;
          margin: 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        .paint-mix-best {
          font-size: 10px;
          font-weight: 600;
          color: rgba(250,245,255,0.6);
          margin: 0;
        }

        .paint-mix-time {
          font-size: 20px;
          font-weight: 700;
          color: #faf5ff;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .paint-mix-time.low-time {
          color: #fca5a5;
          animation: paint-mix-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes paint-mix-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .paint-mix-stats-row {
          display: flex;
          justify-content: center;
          gap: 12px;
          font-size: 12px;
          color: #6b21a8;
        }

        .paint-mix-stats-row p {
          margin: 0;
        }

        .paint-mix-stats-row strong {
          font-size: 13px;
        }

        .paint-mix-color-area {
          display: flex;
          gap: 14px;
          justify-content: center;
          align-items: center;
          margin: 4px 0;
        }

        .paint-mix-swatch {
          width: 80px;
          height: 80px;
          border-radius: 14px;
          border: 3px solid rgba(124,58,237,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          transition: box-shadow 0.2s;
        }

        .paint-mix-swatch-label {
          position: absolute;
          bottom: -18px;
          font-size: 10px;
          font-weight: 600;
          color: #7c3aed;
          white-space: nowrap;
        }

        .paint-mix-vs {
          font-size: 16px;
          font-weight: 800;
          color: #a78bfa;
        }

        .paint-mix-accuracy-badge {
          font-size: 14px;
          font-weight: 800;
          padding: 6px 16px;
          border-radius: 10px;
          text-align: center;
          margin: 4px auto;
          min-width: 80px;
        }

        .paint-mix-accuracy-high {
          background: linear-gradient(135deg, #dcfce7, #bbf7d0);
          color: #16a34a;
          border: 2px solid #16a34a;
          box-shadow: 0 2px 8px rgba(22,163,74,0.2);
        }

        .paint-mix-accuracy-mid {
          background: linear-gradient(135deg, #fef9c3, #fef08a);
          color: #ca8a04;
          border: 2px solid #ca8a04;
          box-shadow: 0 2px 8px rgba(202,138,4,0.2);
        }

        .paint-mix-accuracy-low {
          background: linear-gradient(135deg, #fee2e2, #fecaca);
          color: #dc2626;
          border: 2px solid #dc2626;
          box-shadow: 0 2px 8px rgba(220,38,38,0.2);
        }

        .paint-mix-slider-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
          width: 100%;
          max-width: 320px;
          padding: 0 12px;
          box-sizing: border-box;
        }

        .paint-mix-slider-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .paint-mix-slider-label {
          font-size: 14px;
          font-weight: 800;
          width: 18px;
          text-align: center;
        }

        .paint-mix-slider-value {
          font-size: 12px;
          font-weight: 600;
          width: 32px;
          text-align: right;
          color: #581c87;
        }

        .paint-mix-slider {
          flex: 1;
          height: 24px;
          -webkit-appearance: none;
          appearance: none;
          border-radius: 12px;
          outline: none;
          border: 2px solid rgba(124,58,237,0.2);
        }

        .paint-mix-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 22px;
          height: 28px;
          border-radius: 6px;
          background: #fff;
          border: 2px solid #7c3aed;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          cursor: pointer;
        }

        .paint-mix-slider.paint-mix-slider-r {
          background: linear-gradient(to right, #1a1a1a, #ef4444);
        }

        .paint-mix-slider.paint-mix-slider-g {
          background: linear-gradient(to right, #1a1a1a, #22c55e);
        }

        .paint-mix-slider.paint-mix-slider-b {
          background: linear-gradient(to right, #1a1a1a, #3b82f6);
        }

        .paint-mix-submit-area {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          margin-top: 2px;
        }

        .paint-mix-submit-btn {
          font-size: 16px;
          font-weight: 800;
          padding: 12px 40px;
          border-radius: 14px;
          border: none;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          color: #fff;
          cursor: pointer;
          box-shadow: 0 4px 14px rgba(124,58,237,0.4);
          transition: transform 0.1s, box-shadow 0.1s;
          letter-spacing: 1px;
        }

        .paint-mix-submit-btn:active {
          transform: scale(0.95);
          box-shadow: 0 2px 8px rgba(124,58,237,0.3);
        }

        .paint-mix-feedback {
          font-size: 15px;
          font-weight: 800;
          min-height: 22px;
          transition: opacity 0.4s;
        }

        .paint-mix-feedback.fade {
          opacity: 0;
        }

        .paint-mix-feedback.excellent {
          color: #16a34a;
          text-shadow: 0 0 8px rgba(22,163,74,0.3);
        }

        .paint-mix-feedback.good {
          color: #ca8a04;
        }

        .paint-mix-feedback.poor {
          color: #dc2626;
        }

        .paint-mix-target-name {
          font-size: 13px;
          color: #581c87;
          font-weight: 800;
          text-align: center;
          margin: 0;
          letter-spacing: 1px;
        }

        .paint-mix-fever-banner {
          font-size: 14px;
          font-weight: 900;
          color: #e11d48;
          letter-spacing: 3px;
          text-shadow: 0 0 8px rgba(225,29,72,0.5);
          animation: paint-mix-fever-flash 0.3s infinite alternate;
          text-align: center;
          margin: 0;
        }

        @keyframes paint-mix-fever-flash {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }

        .paint-mix-bonus-text {
          font-size: 13px;
          font-weight: 800;
          color: #f59e0b;
          text-align: center;
          margin: 0;
          text-shadow: 0 0 6px rgba(245,158,11,0.4);
          animation: paint-mix-bonus-pop 0.3s ease-out;
        }

        @keyframes paint-mix-bonus-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.15); }
          100% { transform: scale(1); opacity: 1; }
        }

        .paint-mix-hub-btn {
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
          margin-bottom: 8px;
        }

        .paint-mix-hub-btn:active {
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
    accentColor: '#e11d48',
  },
  Component: PaintMixGame,
}
