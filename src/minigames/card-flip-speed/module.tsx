import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import flipSfx from '../../../assets/sounds/card-flip-flip.mp3'
import correctSfx from '../../../assets/sounds/card-flip-correct.mp3'
import wrongSfx from '../../../assets/sounds/card-flip-wrong.mp3'
import comboSfx from '../../../assets/sounds/card-flip-combo.mp3'
import feverSfx from '../../../assets/sounds/card-flip-fever.mp3'
import sameSfx from '../../../assets/sounds/card-flip-same.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import levelUpSfx from '../../../assets/sounds/card-flip-levelup.mp3'
import perfectSfx from '../../../assets/sounds/card-flip-perfect.mp3'
import appearSfx from '../../../assets/sounds/card-flip-appear.mp3'

// --- Game constants ---
const ROUND_DURATION_MS = 35000
const CORRECT_SCORE = 5
const WRONG_PENALTY = 3
const SAME_BONUS = 10
const LOW_TIME_THRESHOLD_MS = 5000
const FLIP_ANIMATION_MS = 300
const FLASH_DURATION_MS = 350
const CARD_MAX = 13

// --- Gimmick constants ---
const STREAK_MULTIPLIER_PER_5 = 0.5
const FAST_MATCH_THRESHOLD_MS = 800
const FAST_MATCH_TIME_BONUS_MS = 500
const LEVEL_UP_THRESHOLD = 10
const FEVER_STREAK_THRESHOLD = 8
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 2
const DOUBLE_DOWN_MULTIPLIER = 2
const JOKER_CHANCE = 0.07
const COMBO_GAUGE_MAX = 8
const HISTORY_MAX = 6
const TIME_BONUS_STREAK = 3
const TIME_BONUS_MS = 400
const PERFECT_THRESHOLD_MS = 500

const CARD_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
const SUIT_SYMBOLS = ['\u2660', '\u2665', '\u2666', '\u2663'] as const
const SUIT_COLORS: Record<string, string> = {
  '\u2660': '#222',
  '\u2665': '#e74c3c',
  '\u2666': '#e74c3c',
  '\u2663': '#222',
}

// Pixel art suits using box characters
const SUIT_PIXEL: Record<string, string> = {
  '\u2660': '\u2660',
  '\u2665': '\u2665',
  '\u2666': '\u2666',
  '\u2663': '\u2663',
}

interface CardInfo {
  readonly value: number
  readonly suit: string
  readonly label: string
  readonly isJoker: boolean
}

function randomCard(): CardInfo {
  if (Math.random() < JOKER_CHANCE) {
    return { value: -1, suit: '\u2605', label: 'JKR', isJoker: true }
  }
  const value = Math.floor(Math.random() * CARD_MAX) + 1
  const suit = SUIT_SYMBOLS[Math.floor(Math.random() * SUIT_SYMBOLS.length)]
  return { value, suit, label: CARD_LABELS[value - 1], isJoker: false }
}

// Floating score text data
interface FloatingText {
  readonly id: number
  readonly text: string
  readonly x: number
  readonly y: number
  readonly color: string
  readonly createdAt: number
}

const FLOAT_LIFETIME_MS = 900

function CardFlipSpeedGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [currentCard, setCurrentCard] = useState<CardInfo>(() => {
    let c = randomCard()
    while (c.isJoker) c = randomCard()
    return c
  })
  const [nextCard, setNextCard] = useState<CardInfo | null>(null)
  const [isFlipping, setIsFlipping] = useState(false)
  const [flashResult, setFlashResult] = useState<'correct' | 'wrong' | 'same' | 'joker' | 'perfect' | null>(null)
  const [gameStarted, setGameStarted] = useState(false)
  const [level, setLevel] = useState(1)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [isDoubleDown, setIsDoubleDown] = useState(false)
  const [doubleDownCooldown, setDoubleDownCooldown] = useState(0)
  const [history, setHistory] = useState<CardInfo[]>([])
  const [comboGauge, setComboGauge] = useState(0)
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [showCardBack, setShowCardBack] = useState(false)
  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([])
  const [perfectCount, setPerfectCount] = useState(0)
  const [scanlineVisible, setScanlineVisible] = useState(true)

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const currentCardRef = useRef(currentCard)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const flipTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const isFlippingRef = useRef(false)
  const cardsPlayedRef = useRef(1)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const isDoubleDownRef = useRef(false)
  const doubleDownCooldownRef = useRef(0)
  const consecutiveCorrectRef = useRef(0)
  const levelUpTimerRef = useRef<number | null>(null)
  const prevLevelRef = useRef(1)
  const floatIdRef = useRef(0)

  const flipAudioRef = useRef<HTMLAudioElement | null>(null)
  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const sameAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)
  const levelUpAudioRef = useRef<HTMLAudioElement | null>(null)
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
  const appearAudioRef = useRef<HTMLAudioElement | null>(null)

  const clearTimerSafe = (timerRef: { current: number | null }) => {
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

  const spawnFloat = useCallback((text: string, color: string) => {
    floatIdRef.current += 1
    const ft: FloatingText = {
      id: floatIdRef.current,
      text,
      x: 160 + (Math.random() - 0.5) * 80,
      y: 240 + (Math.random() - 0.5) * 40,
      color,
      createdAt: performance.now(),
    }
    setFloatingTexts(prev => [...prev.slice(-6), ft])
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimerSafe(flipTimerRef)
    clearTimerSafe(flashTimerRef)
    clearTimerSafe(levelUpTimerRef)
    playAudio(gameOverAudioRef, 0.7, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  const toggleDoubleDown = useCallback(() => {
    if (isFlippingRef.current || finishedRef.current) return
    if (doubleDownCooldownRef.current > 0) return
    isDoubleDownRef.current = !isDoubleDownRef.current
    setIsDoubleDown(isDoubleDownRef.current)
    playAudio(appearAudioRef, 0.4)
  }, [playAudio])

  const handleGuess = useCallback(
    (guess: 'high' | 'low') => {
      if (finishedRef.current || isFlippingRef.current) return
      if (!gameStarted) setGameStarted(true)

      const guessStartAt = performance.now()
      isFlippingRef.current = true
      setIsFlipping(true)
      setShowCardBack(true)
      playAudio(flipAudioRef, 0.5)

      const next = randomCard()
      setNextCard(next)

      clearTimerSafe(flipTimerRef)
      flipTimerRef.current = window.setTimeout(() => {
        flipTimerRef.current = null
        const current = currentCardRef.current
        playAudio(appearAudioRef, 0.4, 1.1)

        let result: 'correct' | 'wrong' | 'same' | 'joker' | 'perfect'
        if (next.isJoker) {
          result = 'joker'
        } else if (next.value === current.value) {
          result = 'same'
        } else if (guess === 'high' && next.value > current.value) {
          result = 'correct'
        } else if (guess === 'low' && next.value < current.value) {
          result = 'correct'
        } else {
          result = 'wrong'
        }

        // Perfect detection
        const guessTime = performance.now() - guessStartAt
        const isPerfect = guessTime < PERFECT_THRESHOLD_MS && result === 'correct'
        if (isPerfect) result = 'perfect'

        let nextScore = scoreRef.current
        let nextCombo = comboRef.current
        const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
        const ddMult = isDoubleDownRef.current ? DOUBLE_DOWN_MULTIPLIER : 1
        const streakMult = 1 + Math.floor(nextCombo / 5) * STREAK_MULTIPLIER_PER_5
        const isFastMatch = guessTime < FAST_MATCH_THRESHOLD_MS && result !== 'wrong'

        if (result === 'joker') {
          const jokerPts = Math.round(SAME_BONUS * 2 * feverMult * ddMult)
          nextScore += jokerPts
          nextCombo += 2
          playAudio(sameAudioRef, 0.8, 1.3)
          spawnFloat(`JOKER! +${jokerPts}`, '#a855f7')
          effects.triggerFlash('rgba(168,85,247,0.5)')
          effects.spawnParticles(10, 200, 300)
          consecutiveCorrectRef.current += 1
        } else if (result === 'same') {
          const pts = Math.round(SAME_BONUS * streakMult * feverMult * ddMult)
          nextScore += pts
          nextCombo += 1
          playAudio(sameAudioRef, 0.7, 1.2)
          spawnFloat(`SAME! +${pts}`, '#f59e0b')
          effects.triggerFlash('rgba(245,158,11,0.4)')
          effects.spawnParticles(8, 200, 300)
          consecutiveCorrectRef.current += 1
        } else if (result === 'perfect') {
          const basePts = CORRECT_SCORE + Math.floor(nextCombo / 3) + 3
          const pts = Math.round(basePts * streakMult * feverMult * ddMult * 1.5)
          nextScore += pts
          nextCombo += 1
          playAudio(perfectAudioRef, 0.7, 1 + nextCombo * 0.02)
          spawnFloat(`PERFECT! +${pts}`, '#22d3ee')
          effects.triggerFlash('rgba(34,211,238,0.4)')
          effects.spawnParticles(8, 200, 300)
          consecutiveCorrectRef.current += 1
          setPerfectCount(p => p + 1)
        } else if (result === 'correct') {
          const basePts = CORRECT_SCORE + Math.floor(nextCombo / 3)
          const pts = Math.round(basePts * streakMult * feverMult * ddMult)
          nextScore += pts
          nextCombo += 1
          playAudio(correctAudioRef, 0.5, 1 + nextCombo * 0.02)
          spawnFloat(`+${pts}`, '#4ade80')
          effects.triggerFlash()
          effects.spawnParticles(4, 200, 300)
          consecutiveCorrectRef.current += 1
        } else {
          const penalty = Math.round(WRONG_PENALTY * ddMult)
          nextScore = Math.max(0, nextScore - penalty)
          nextCombo = 0
          playAudio(wrongAudioRef, 0.5, 0.8)
          spawnFloat(`-${penalty}`, '#ef4444')
          effects.triggerShake(8)
          effects.triggerFlash('rgba(239,68,68,0.5)')
          consecutiveCorrectRef.current = 0
          setPerfectCount(0)
        }

        // Time bonuses
        if (consecutiveCorrectRef.current > 0 && consecutiveCorrectRef.current % TIME_BONUS_STREAK === 0) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
          spawnFloat(`+${(TIME_BONUS_MS / 1000).toFixed(1)}s`, '#34d399')
        }
        if (isFastMatch) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FAST_MATCH_TIME_BONUS_MS)
          spawnFloat(`FAST! +${(FAST_MATCH_TIME_BONUS_MS / 1000).toFixed(1)}s`, '#fbbf24')
        }

        // Combo milestone sound
        if (nextCombo > 0 && nextCombo % 5 === 0) {
          playAudio(comboAudioRef, 0.7, 1 + nextCombo * 0.01)
          spawnFloat(`${nextCombo} COMBO!`, '#fbbf24')
        }

        // DD bonus text
        if (isDoubleDownRef.current && result !== 'wrong') {
          spawnFloat('DD x2!', '#fbbf24')
        }

        // Fever activation
        if (nextCombo >= FEVER_STREAK_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playAudio(feverAudioRef, 0.8)
          spawnFloat('FEVER MODE!', '#ef4444')
        }

        // DD cooldown
        if (isDoubleDownRef.current) {
          isDoubleDownRef.current = false
          setIsDoubleDown(false)
          doubleDownCooldownRef.current = 3
          setDoubleDownCooldown(3)
        }

        scoreRef.current = nextScore
        comboRef.current = nextCombo
        setScore(nextScore)
        setCombo(nextCombo)
        setComboGauge(Math.min(COMBO_GAUGE_MAX, nextCombo))
        setFlashResult(result)

        cardsPlayedRef.current += 1

        // Level escalation
        const nextLevel = 1 + Math.floor(cardsPlayedRef.current / LEVEL_UP_THRESHOLD)
        if (nextLevel > prevLevelRef.current) {
          prevLevelRef.current = nextLevel
          setShowLevelUp(true)
          clearTimerSafe(levelUpTimerRef)
          levelUpTimerRef.current = window.setTimeout(() => {
            levelUpTimerRef.current = null
            setShowLevelUp(false)
          }, 1200)
          effects.spawnParticles(12, 200, 200)
          playAudio(levelUpAudioRef, 0.8)
        }
        setLevel(nextLevel)

        // History
        if (!next.isJoker) {
          setHistory(prev => {
            const h = [next, ...prev]
            return h.length > HISTORY_MAX ? h.slice(0, HISTORY_MAX) : h
          })
        }

        // DD cooldown tick
        if (doubleDownCooldownRef.current > 0) {
          doubleDownCooldownRef.current -= 1
          setDoubleDownCooldown(doubleDownCooldownRef.current)
        }

        currentCardRef.current = next.isJoker ? currentCardRef.current : next
        if (!next.isJoker) setCurrentCard(next)
        setNextCard(null)
        setIsFlipping(false)
        setShowCardBack(false)
        isFlippingRef.current = false

        clearTimerSafe(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashResult(null)
        }, FLASH_DURATION_MS)
      }, FLIP_ANIMATION_MS)
    },
    [gameStarted, playAudio, spawnFloat, effects],
  )

  const handleExit = useCallback(() => { onExit() }, [onExit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); handleExit() }
      if (event.code === 'ArrowUp' || event.code === 'KeyW') { event.preventDefault(); handleGuess('high') }
      if (event.code === 'ArrowDown' || event.code === 'KeyS') { event.preventDefault(); handleGuess('low') }
      if (event.code === 'Space') { event.preventDefault(); toggleDoubleDown() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, handleGuess, toggleDoubleDown])

  useEffect(() => {
    const preload = (src: string) => { const a = new Audio(src); a.preload = 'auto'; return a }
    flipAudioRef.current = preload(flipSfx)
    correctAudioRef.current = preload(correctSfx)
    wrongAudioRef.current = preload(wrongSfx)
    comboAudioRef.current = preload(comboSfx)
    feverAudioRef.current = preload(feverSfx)
    sameAudioRef.current = preload(sameSfx)
    gameOverAudioRef.current = preload(gameOverHitSfx)
    levelUpAudioRef.current = preload(levelUpSfx)
    perfectAudioRef.current = preload(perfectSfx)
    appearAudioRef.current = preload(appearSfx)

    // Scanline toggle for CRT feel
    const scanId = window.setInterval(() => setScanlineVisible(v => !v), 80)

    return () => {
      clearTimerSafe(flipTimerRef)
      clearTimerSafe(flashTimerRef)
      clearTimerSafe(levelUpTimerRef)
      window.clearInterval(scanId)
      effects.cleanup()
      flipAudioRef.current = null
      correctAudioRef.current = null
      wrongAudioRef.current = null
      comboAudioRef.current = null
      feverAudioRef.current = null
      sameAudioRef.current = null
      gameOverAudioRef.current = null
      levelUpAudioRef.current = null
      perfectAudioRef.current = null
      appearAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { isFeverRef.current = false; setIsFever(false) }
      }

      // Clean old floating texts
      setFloatingTexts(prev => prev.filter(f => now - f.createdAt < FLOAT_LIFETIME_MS))

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      effects.updateParticles()
      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
      lastFrameAtRef.current = null
    }
  }, [finishGame, effects])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = Math.max(bestScore, score)
  const displayCard = nextCard !== null && isFlipping ? nextCard : currentCard
  const displaySuitColor = displayCard.isJoker ? '#a855f7' : (SUIT_COLORS[displayCard.suit] ?? '#222')
  const streakMult = 1 + Math.floor(combo / 5) * STREAK_MULTIPLIER_PER_5
  const timerPct = remainingMs / ROUND_DURATION_MS
  const feverBg = isFever
    ? 'linear-gradient(180deg, #1a0a0a 0%, #3b0a0a 10%, #1a0a2e 50%, #0a0a1a 100%)'
    : 'linear-gradient(180deg, #0a0e1a 0%, #0f172a 10%, #1e293b 50%, #0f172a 100%)'

  return (
    <section
      className="mini-game-panel cfs-panel"
      aria-label="card-flip-speed-game"
      style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', background: feverBg, ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* CRT scanline overlay */}
      <div className="cfs-scanlines" style={{ opacity: scanlineVisible ? 0.04 : 0.02 }} />

      {/* Pixel grid overlay */}
      <div className="cfs-pixel-grid" />

      {/* Timer bar - pixelated */}
      <div className="cfs-timer-bar-wrap">
        <div className={`cfs-timer-bar ${isLowTime ? 'low' : ''}`} style={{ width: `${timerPct * 100}%` }} />
      </div>

      {/* Header */}
      <div className="cfs-header">
        <div className="cfs-score-block">
          <p className="cfs-score">{score.toLocaleString()}</p>
          <p className="cfs-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="cfs-time-block">
          <p className={`cfs-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}</p>
          <p className="cfs-level">LV.{level}</p>
        </div>
      </div>

      {/* Combo gauge */}
      <div className="cfs-combo-row">
        <div className="cfs-combo-gauge-wrap">
          {Array.from({ length: COMBO_GAUGE_MAX }).map((_, i) => (
            <div key={i} className={`cfs-gauge-cell ${i < comboGauge ? (isFever ? 'fever' : 'filled') : ''}`} />
          ))}
        </div>
        <span className="cfs-combo-label">
          {combo > 0 ? `${combo}HIT` : ''}
          {streakMult > 1 ? ` x${streakMult.toFixed(1)}` : ''}
        </span>
      </div>

      {/* Fever banner */}
      {isFever && (
        <div className="cfs-fever-banner">
          {'\u2605'} FEVER x{FEVER_MULTIPLIER} {'\u2605'} {(feverMs / 1000).toFixed(1)}s
        </div>
      )}

      {/* Perfect counter */}
      {perfectCount > 0 && (
        <div className="cfs-perfect-counter">PERFECT x{perfectCount}</div>
      )}

      {/* Card history */}
      {history.length > 0 && (
        <div className="cfs-history">
          {history.map((h, i) => (
            <span key={`h-${i}`} className="cfs-history-chip" style={{ color: SUIT_COLORS[h.suit] ?? '#222', opacity: 1 - i * 0.12 }}>
              {h.label}{SUIT_PIXEL[h.suit] ?? h.suit}
            </span>
          ))}
        </div>
      )}

      {/* Level up overlay */}
      {showLevelUp && (
        <div className="cfs-levelup-overlay">
          <span className="cfs-levelup-text">LV.{level} UP!</span>
        </div>
      )}

      {/* Floating score texts */}
      {floatingTexts.map(ft => {
        const age = (performance.now() - ft.createdAt) / FLOAT_LIFETIME_MS
        return (
          <div key={ft.id} className="cfs-float" style={{
            left: `${ft.x}px`, top: `${ft.y - age * 60}px`,
            color: ft.color, opacity: 1 - age,
            transform: `scale(${1 + age * 0.3})`,
          }}>
            {ft.text}
          </div>
        )
      })}

      {/* Main card area */}
      <div className="cfs-card-zone">
        <div className={`cfs-card-area ${flashResult ? `flash-${flashResult}` : ''}`}>
          <div className={`cfs-card ${isFlipping ? 'cfs-flipping' : ''}`}>
            {showCardBack ? (
              <div className="cfs-card-back">
                <div className="cfs-card-back-inner">
                  <div className="cfs-back-pattern" />
                  <span className="cfs-back-icon">{'\u2666'}</span>
                </div>
              </div>
            ) : (
              <div className="cfs-card-face" style={{ color: displaySuitColor }}>
                <span className="cfs-suit-tl">{SUIT_PIXEL[displayCard.suit] ?? displayCard.suit}</span>
                <span className="cfs-value">{displayCard.label}</span>
                <span className="cfs-suit-big">{SUIT_PIXEL[displayCard.suit] ?? displayCard.suit}</span>
                <span className="cfs-suit-br">{SUIT_PIXEL[displayCard.suit] ?? displayCard.suit}</span>
              </div>
            )}
          </div>
          {flashResult !== null && (
            <div className="cfs-result-tag">
              <span className={`cfs-tag cfs-tag-${flashResult}`}>
                {flashResult === 'correct' && 'OK!'}
                {flashResult === 'wrong' && 'MISS!'}
                {flashResult === 'same' && 'SAME!'}
                {flashResult === 'joker' && 'JOKER!'}
                {flashResult === 'perfect' && 'PERFECT!'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Double Down button */}
      <button
        className={`cfs-dd-btn ${isDoubleDown ? 'active' : ''} ${doubleDownCooldown > 0 ? 'cooldown' : ''}`}
        type="button"
        onClick={toggleDoubleDown}
        disabled={doubleDownCooldown > 0 || isFlipping}
      >
        {doubleDownCooldown > 0 ? `WAIT(${doubleDownCooldown})` : isDoubleDown ? '>> DD ON x2 <<' : '[ DOUBLE DOWN ]'}
      </button>

      {/* HIGH / LOW buttons */}
      <div className="cfs-buttons">
        <button className="cfs-btn cfs-btn-high" type="button" onClick={() => handleGuess('high')} disabled={isFlipping}>
          {'\u25B2\u25B2'} HIGH
        </button>
        <button className="cfs-btn cfs-btn-low" type="button" onClick={() => handleGuess('low')} disabled={isFlipping}>
          {'\u25BC\u25BC'} LOW
        </button>
      </div>

      <button className="cfs-exit-btn" type="button" onClick={handleExit}>[EXIT]</button>

      <style>{`
        .cfs-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          overflow: hidden;
          padding: 0;
          gap: 0;
          font-family: 'Press Start 2P', monospace;
          image-rendering: pixelated;
          position: relative;
        }

        /* CRT scanlines */
        .cfs-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 50;
          background: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 2px,
            rgba(0,0,0,0.15) 2px,
            rgba(0,0,0,0.15) 4px
          );
        }

        /* Pixel grid */
        .cfs-pixel-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 49;
          background: repeating-linear-gradient(
            90deg,
            rgba(255,255,255,0.01) 0px 1px,
            transparent 1px 4px
          );
        }

        /* Timer bar */
        .cfs-timer-bar-wrap {
          width: 100%;
          height: 8px;
          background: #1a1a2e;
          border-bottom: 2px solid #334155;
          flex-shrink: 0;
        }
        .cfs-timer-bar {
          height: 100%;
          background: #4ade80;
          transition: width 0.15s steps(8);
        }
        .cfs-timer-bar.low {
          background: #ef4444;
          animation: cfs-bar-blink 0.4s steps(2) infinite;
        }

        /* Header */
        .cfs-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          width: 100%;
          padding: 8px 12px 4px;
          flex-shrink: 0;
        }
        .cfs-score-block { text-align: left; }
        .cfs-score {
          font-size: clamp(14px, 4.5vw, 20px);
          color: #fbbf24;
          margin: 0;
          text-shadow: 2px 2px 0 #92400e;
          line-height: 1.3;
        }
        .cfs-best {
          font-size: 7px;
          color: #64748b;
          margin: 0;
          margin-top: 2px;
        }
        .cfs-time-block { text-align: right; }
        .cfs-time {
          font-size: clamp(12px, 4vw, 18px);
          color: #4ade80;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 2px 2px 0 #064e3b;
          line-height: 1.3;
        }
        .cfs-time.low-time {
          color: #ef4444;
          text-shadow: 2px 2px 0 #7f1d1d;
          animation: cfs-blink 0.5s steps(2) infinite;
        }
        .cfs-level {
          font-size: 7px;
          color: #64748b;
          margin: 0;
          margin-top: 2px;
        }

        /* Combo gauge - pixel blocks */
        .cfs-combo-row {
          width: 100%;
          padding: 2px 12px;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          height: 20px;
        }
        .cfs-combo-gauge-wrap {
          flex: 1;
          display: flex;
          gap: 2px;
          height: 10px;
        }
        .cfs-gauge-cell {
          flex: 1;
          background: #1e293b;
          border: 1px solid #334155;
        }
        .cfs-gauge-cell.filled {
          background: #4ade80;
          border-color: #22c55e;
          box-shadow: 0 0 4px rgba(74,222,128,0.4);
        }
        .cfs-gauge-cell.fever {
          background: #ef4444;
          border-color: #dc2626;
          animation: cfs-cell-flash 0.2s steps(2) infinite alternate;
        }
        .cfs-combo-label {
          font-size: 7px;
          color: #fbbf24;
          white-space: nowrap;
          min-width: 50px;
          text-align: right;
          text-shadow: 1px 1px 0 #92400e;
        }

        /* Fever */
        .cfs-fever-banner {
          font-size: 9px;
          color: #fbbf24;
          letter-spacing: 2px;
          text-align: center;
          padding: 4px 0;
          width: 100%;
          background: #7f1d1d;
          border-top: 2px solid #ef4444;
          border-bottom: 2px solid #ef4444;
          text-shadow: 1px 1px 0 #450a0a;
          animation: cfs-fever-flash 0.3s steps(2) infinite alternate;
          flex-shrink: 0;
        }

        /* Perfect counter */
        .cfs-perfect-counter {
          font-size: 7px;
          color: #22d3ee;
          text-align: center;
          text-shadow: 1px 1px 0 #0e7490;
          padding: 1px 0;
          flex-shrink: 0;
          animation: cfs-blink 1s steps(2) infinite;
        }

        /* History chips */
        .cfs-history {
          display: flex;
          justify-content: center;
          gap: 4px;
          padding: 2px 12px;
          flex-shrink: 0;
        }
        .cfs-history-chip {
          font-size: 8px;
          font-family: 'Press Start 2P', monospace;
          padding: 2px 4px;
          background: #1e293b;
          border: 1px solid #334155;
        }

        /* Floating text */
        .cfs-float {
          position: absolute;
          font-size: 9px;
          font-family: 'Press Start 2P', monospace;
          font-weight: 900;
          pointer-events: none;
          z-index: 60;
          text-shadow: 1px 1px 0 rgba(0,0,0,0.8);
          white-space: nowrap;
          transition: none;
        }

        /* Card zone */
        .cfs-card-zone {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 0;
          padding: 6px 0;
        }
        .cfs-card-area {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(160px, 46vw, 200px);
          height: clamp(230px, 50vh, 290px);
          border: 3px solid #475569;
          background: #f1f5f9;
          perspective: 800px;
          box-shadow: 4px 4px 0 #0f172a;
          transition: border-color 0.1s steps(2), box-shadow 0.1s steps(2);
        }
        .cfs-card-area.flash-correct {
          border-color: #4ade80;
          box-shadow: 4px 4px 0 #166534, 0 0 20px rgba(74,222,128,0.3);
        }
        .cfs-card-area.flash-wrong {
          border-color: #ef4444;
          box-shadow: 4px 4px 0 #7f1d1d, 0 0 20px rgba(239,68,68,0.3);
          animation: cfs-shake 0.25s steps(4);
        }
        .cfs-card-area.flash-same {
          border-color: #fbbf24;
          box-shadow: 4px 4px 0 #92400e, 0 0 20px rgba(251,191,36,0.3);
        }
        .cfs-card-area.flash-joker {
          border-color: #a855f7;
          box-shadow: 4px 4px 0 #581c87, 0 0 20px rgba(168,85,247,0.3);
          animation: cfs-joker-glow 0.3s steps(3);
        }
        .cfs-card-area.flash-perfect {
          border-color: #22d3ee;
          box-shadow: 4px 4px 0 #0e7490, 0 0 24px rgba(34,211,238,0.4);
        }

        /* Card */
        .cfs-card {
          width: 100%;
          height: 100%;
          transform-style: preserve-3d;
        }
        .cfs-flipping {
          animation: cfs-flip ${FLIP_ANIMATION_MS}ms steps(6) forwards;
        }
        .cfs-card-face {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .cfs-suit-tl {
          position: absolute;
          top: 10px;
          left: 12px;
          font-size: clamp(14px, 4vw, 20px);
        }
        .cfs-value {
          font-size: clamp(40px, 14vw, 64px);
          line-height: 1;
          text-shadow: 3px 3px 0 rgba(0,0,0,0.1);
        }
        .cfs-suit-big {
          font-size: clamp(24px, 8vw, 36px);
          margin-top: 2px;
        }
        .cfs-suit-br {
          position: absolute;
          bottom: 10px;
          right: 12px;
          font-size: clamp(14px, 4vw, 20px);
          transform: rotate(180deg);
        }

        /* Card back - pixelated pattern */
        .cfs-card-back {
          width: 100%;
          height: 100%;
          background: #1e3a5f;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 3px solid #3b82f6;
          box-sizing: border-box;
        }
        .cfs-card-back-inner {
          width: 85%;
          height: 88%;
          border: 2px solid #60a5fa;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }
        .cfs-back-pattern {
          position: absolute;
          inset: 0;
          background: repeating-conic-gradient(#1e40af 0% 25%, #1e3a5f 0% 50%) 50% / 12px 12px;
        }
        .cfs-back-icon {
          font-size: 28px;
          color: #93c5fd;
          z-index: 1;
          text-shadow: 2px 2px 0 #1e3a5f;
        }

        /* Result tag */
        .cfs-result-tag {
          position: absolute;
          bottom: -14px;
          left: 50%;
          transform: translateX(-50%);
          animation: cfs-pop 0.2s steps(4);
        }
        .cfs-tag {
          padding: 4px 12px;
          font-size: 9px;
          font-family: 'Press Start 2P', monospace;
          white-space: nowrap;
          color: #fff;
          border: 2px solid;
        }
        .cfs-tag-correct {
          background: #166534;
          border-color: #4ade80;
          box-shadow: 2px 2px 0 #052e16;
        }
        .cfs-tag-wrong {
          background: #7f1d1d;
          border-color: #ef4444;
          box-shadow: 2px 2px 0 #450a0a;
        }
        .cfs-tag-same {
          background: #92400e;
          border-color: #fbbf24;
          box-shadow: 2px 2px 0 #451a03;
        }
        .cfs-tag-joker {
          background: #581c87;
          border-color: #a855f7;
          box-shadow: 2px 2px 0 #3b0764;
        }
        .cfs-tag-perfect {
          background: #0e7490;
          border-color: #22d3ee;
          box-shadow: 2px 2px 0 #083344;
          animation: cfs-perfect-shine 0.3s steps(3) infinite alternate;
        }

        /* Double down */
        .cfs-dd-btn {
          margin: 3px 0;
          padding: 6px 20px;
          border: 2px solid #475569;
          background: #1e293b;
          color: #94a3b8;
          font-size: 8px;
          font-family: 'Press Start 2P', monospace;
          cursor: pointer;
          transition: none;
          flex-shrink: 0;
          box-shadow: 2px 2px 0 #0f172a;
        }
        .cfs-dd-btn.active {
          background: #92400e;
          color: #fbbf24;
          border-color: #fbbf24;
          box-shadow: 2px 2px 0 #451a03, 0 0 12px rgba(251,191,36,0.3);
          animation: cfs-blink 0.4s steps(2) infinite;
        }
        .cfs-dd-btn.cooldown {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .cfs-dd-btn:active:not(:disabled) {
          box-shadow: none;
          transform: translate(2px, 2px);
        }

        /* Buttons */
        .cfs-buttons {
          display: flex;
          gap: 8px;
          width: 100%;
          padding: 4px 12px;
          box-sizing: border-box;
          flex-shrink: 0;
        }
        .cfs-btn {
          flex: 1;
          padding: clamp(12px, 3.5vw, 18px) 0;
          border: 3px solid;
          font-size: clamp(12px, 3.5vw, 16px);
          font-family: 'Press Start 2P', monospace;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          color: #fff;
          touch-action: manipulation;
          transition: none;
        }
        .cfs-btn:active:not(:disabled) {
          box-shadow: none !important;
          transform: translate(3px, 3px);
        }
        .cfs-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .cfs-btn-high {
          background: #166534;
          border-color: #4ade80;
          box-shadow: 3px 3px 0 #052e16;
          text-shadow: 1px 1px 0 #052e16;
        }
        .cfs-btn-low {
          background: #7f1d1d;
          border-color: #ef4444;
          box-shadow: 3px 3px 0 #450a0a;
          text-shadow: 1px 1px 0 #450a0a;
        }

        /* Exit */
        .cfs-exit-btn {
          font-size: 7px;
          font-family: 'Press Start 2P', monospace;
          padding: 4px 16px;
          border: 2px solid #334155;
          background: #0f172a;
          color: #64748b;
          cursor: pointer;
          margin-bottom: 6px;
          flex-shrink: 0;
          box-shadow: 2px 2px 0 #020617;
        }
        .cfs-exit-btn:active {
          box-shadow: none;
          transform: translate(2px, 2px);
        }

        /* Level up */
        .cfs-levelup-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          pointer-events: none;
          animation: cfs-levelup-anim 1.2s steps(8) forwards;
        }
        .cfs-levelup-text {
          font-size: clamp(16px, 6vw, 24px);
          color: #fbbf24;
          text-shadow: 3px 3px 0 #92400e, -1px -1px 0 #fde68a;
          letter-spacing: 2px;
          border: 3px solid #fbbf24;
          padding: 8px 20px;
          background: rgba(15,23,42,0.9);
        }

        /* Animations - all using steps() for pixel feel */
        @keyframes cfs-flip {
          0% { transform: rotateY(0deg) scale(1); }
          30% { transform: rotateY(90deg) scale(0.92); }
          60% { transform: rotateY(180deg) scale(0.92); }
          100% { transform: rotateY(360deg) scale(1); }
        }
        @keyframes cfs-shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          50% { transform: translateX(6px); }
          75% { transform: translateX(-4px); }
        }
        @keyframes cfs-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.3; }
        }
        @keyframes cfs-pop {
          0% { transform: translateX(-50%) scale(0); }
          50% { transform: translateX(-50%) scale(1.3); }
          100% { transform: translateX(-50%) scale(1); }
        }
        @keyframes cfs-fever-flash {
          0% { background: #7f1d1d; }
          100% { background: #991b1b; }
        }
        @keyframes cfs-bar-blink {
          0%, 49% { background: #ef4444; }
          50%, 100% { background: #b91c1c; }
        }
        @keyframes cfs-cell-flash {
          0% { background: #ef4444; }
          100% { background: #fbbf24; }
        }
        @keyframes cfs-joker-glow {
          0% { transform: scale(1); border-color: #a855f7; }
          50% { transform: scale(1.02); border-color: #c084fc; }
          100% { transform: scale(1); border-color: #a855f7; }
        }
        @keyframes cfs-perfect-shine {
          0% { text-shadow: 0 0 4px #22d3ee; }
          100% { text-shadow: 0 0 12px #22d3ee, 0 0 20px #06b6d4; }
        }
        @keyframes cfs-levelup-anim {
          0% { opacity: 0; }
          15% { opacity: 1; }
          70% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </section>
  )
}

export const cardFlipSpeedModule: MiniGameModule = {
  manifest: {
    id: 'card-flip-speed',
    title: 'Card Flip',
    description: 'Will the next card be higher or lower? Predict fast!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#1e40af',
  },
  Component: CardFlipSpeedGame,
}
