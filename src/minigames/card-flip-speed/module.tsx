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

// --- Game constants ---
const ROUND_DURATION_MS = 30000
const CORRECT_SCORE = 5
const WRONG_PENALTY = 3
const SAME_BONUS = 10
const LOW_TIME_THRESHOLD_MS = 5000
const FLIP_ANIMATION_MS = 350
const FLASH_DURATION_MS = 300
const CARD_MAX = 13

// --- Gimmick constants ---
const STREAK_MULTIPLIER_PER_5 = 0.5
const FAST_MATCH_THRESHOLD_MS = 1500
const FAST_MATCH_TIME_BONUS_MS = 500
const LEVEL_UP_THRESHOLD = 10
const FEVER_STREAK_THRESHOLD = 8
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 2
const DOUBLE_DOWN_MULTIPLIER = 2
const JOKER_CHANCE = 0.08
const COMBO_GAUGE_MAX = 8
const HISTORY_MAX = 5
const TIME_BONUS_STREAK = 3
const TIME_BONUS_MS = 300

const CARD_LABELS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
const SUIT_SYMBOLS = ['\u2660', '\u2665', '\u2666', '\u2663'] as const
const SUIT_COLORS: Record<string, string> = {
  '\u2660': '#1e293b',
  '\u2665': '#dc2626',
  '\u2666': '#dc2626',
  '\u2663': '#1e293b',
}

interface CardInfo {
  readonly value: number
  readonly suit: string
  readonly label: string
  readonly isJoker: boolean
}

function randomCard(): CardInfo {
  if (Math.random() < JOKER_CHANCE) {
    return { value: -1, suit: '\u2605', label: 'JOKER', isJoker: true }
  }
  const value = Math.floor(Math.random() * CARD_MAX) + 1
  const suit = SUIT_SYMBOLS[Math.floor(Math.random() * SUIT_SYMBOLS.length)]
  return { value, suit, label: CARD_LABELS[value - 1], isJoker: false }
}

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
  const [cardsPlayed, setCardsPlayed] = useState(1)
  const [isFlipping, setIsFlipping] = useState(false)
  const [flashResult, setFlashResult] = useState<'correct' | 'wrong' | 'same' | 'joker' | null>(null)
  const [gameStarted, setGameStarted] = useState(false)
  const [level, setLevel] = useState(1)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [bonusText, setBonusText] = useState('')
  const [isDoubleDown, setIsDoubleDown] = useState(false)
  const [doubleDownCooldown, setDoubleDownCooldown] = useState(0)
  const [history, setHistory] = useState<CardInfo[]>([])
  const [comboGauge, setComboGauge] = useState(0)
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [showCardBack, setShowCardBack] = useState(false)

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
  const lastGuessAtRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const bonusTextTimerRef = useRef<number | null>(null)
  const isDoubleDownRef = useRef(false)
  const doubleDownCooldownRef = useRef(0)
  const consecutiveCorrectRef = useRef(0)
  const levelUpTimerRef = useRef<number | null>(null)
  const prevLevelRef = useRef(1)

  const flipAudioRef = useRef<HTMLAudioElement | null>(null)
  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const sameAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const showBonus = useCallback((text: string) => {
    setBonusText(text)
    clearTimerSafe(bonusTextTimerRef)
    bonusTextTimerRef.current = window.setTimeout(() => {
      bonusTextTimerRef.current = null
      setBonusText('')
    }, 1200)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimerSafe(flipTimerRef)
    clearTimerSafe(flashTimerRef)
    clearTimerSafe(bonusTextTimerRef)
    playAudio(gameOverAudioRef, 0.7, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  const toggleDoubleDown = useCallback(() => {
    if (isFlippingRef.current || finishedRef.current) return
    if (doubleDownCooldownRef.current > 0) return
    isDoubleDownRef.current = !isDoubleDownRef.current
    setIsDoubleDown(isDoubleDownRef.current)
  }, [])

  const handleGuess = useCallback(
    (guess: 'high' | 'low') => {
      if (finishedRef.current || isFlippingRef.current) return
      if (!gameStarted) setGameStarted(true)

      const guessStartAt = performance.now()
      isFlippingRef.current = true
      setIsFlipping(true)
      setShowCardBack(true)
      playAudio(flipAudioRef, 0.6)

      const next = randomCard()
      setNextCard(next)

      clearTimerSafe(flipTimerRef)
      flipTimerRef.current = window.setTimeout(() => {
        flipTimerRef.current = null
        const current = currentCardRef.current

        let result: 'correct' | 'wrong' | 'same' | 'joker'
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

        let nextScore = scoreRef.current
        let nextCombo = comboRef.current
        const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
        const ddMult = isDoubleDownRef.current ? DOUBLE_DOWN_MULTIPLIER : 1
        const streakMult = 1 + Math.floor(nextCombo / 5) * STREAK_MULTIPLIER_PER_5
        const guessTime = performance.now() - guessStartAt
        const isFastMatch = guessTime < FAST_MATCH_THRESHOLD_MS && result !== 'wrong'

        const bonusParts: string[] = []

        if (result === 'joker') {
          const jokerPts = Math.round(SAME_BONUS * 2 * feverMult * ddMult)
          nextScore += jokerPts
          nextCombo += 2
          playAudio(sameAudioRef, 0.8, 1.3)
          bonusParts.push(`JOKER +${jokerPts}`)
          effects.triggerFlash('rgba(168,85,247,0.5)')
          effects.spawnParticles(8, 200, 300)
          consecutiveCorrectRef.current += 1
        } else if (result === 'same') {
          const pts = Math.round(SAME_BONUS * streakMult * feverMult * ddMult)
          nextScore += pts
          nextCombo += 1
          playAudio(sameAudioRef, 0.7, 1.2)
          bonusParts.push(`SAME +${pts}`)
          effects.triggerFlash('rgba(245,158,11,0.4)')
          effects.spawnParticles(6, 200, 300)
          consecutiveCorrectRef.current += 1
        } else if (result === 'correct') {
          const basePts = CORRECT_SCORE + Math.floor(nextCombo / 3)
          const pts = Math.round(basePts * streakMult * feverMult * ddMult)
          nextScore += pts
          nextCombo += 1
          playAudio(correctAudioRef, 0.6, 1 + nextCombo * 0.02)
          effects.triggerFlash()
          effects.spawnParticles(4, 200, 300)
          consecutiveCorrectRef.current += 1
        } else {
          const penalty = Math.round(WRONG_PENALTY * ddMult)
          nextScore = Math.max(0, nextScore - penalty)
          nextCombo = 0
          playAudio(wrongAudioRef, 0.6, 0.8)
          effects.triggerShake(6)
          effects.triggerFlash('rgba(239,68,68,0.4)')
          consecutiveCorrectRef.current = 0
        }

        // Time bonus for consecutive correct
        if (consecutiveCorrectRef.current > 0 && consecutiveCorrectRef.current % TIME_BONUS_STREAK === 0) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
          bonusParts.push(`+${(TIME_BONUS_MS / 1000).toFixed(1)}s`)
        }

        // Fast match time bonus
        if (isFastMatch) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FAST_MATCH_TIME_BONUS_MS)
          bonusParts.push(`FAST +${(FAST_MATCH_TIME_BONUS_MS / 1000).toFixed(1)}s`)
        }

        if (streakMult > 1 && result !== 'wrong') {
          bonusParts.push(`x${streakMult.toFixed(1)}`)
        }

        if (isDoubleDownRef.current && result !== 'wrong') {
          bonusParts.push('DD x2!')
        }

        // Combo sound at milestones
        if (nextCombo > 0 && nextCombo % 5 === 0) {
          playAudio(comboAudioRef, 0.7, 1 + nextCombo * 0.01)
        }

        // Fever activation
        if (nextCombo >= FEVER_STREAK_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          bonusParts.push('FEVER!')
          playAudio(feverAudioRef, 0.8)
        }

        if (bonusParts.length > 0) {
          showBonus(bonusParts.join(' '))
        }

        // Double down cooldown reset
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
        setCardsPlayed(cardsPlayedRef.current)

        // Level escalation
        const nextLevel = 1 + Math.floor(cardsPlayedRef.current / LEVEL_UP_THRESHOLD)
        if (nextLevel > prevLevelRef.current) {
          prevLevelRef.current = nextLevel
          setShowLevelUp(true)
          clearTimerSafe(levelUpTimerRef)
          levelUpTimerRef.current = window.setTimeout(() => {
            levelUpTimerRef.current = null
            setShowLevelUp(false)
          }, 1000)
          effects.spawnParticles(10, 200, 200)
          playAudio(comboAudioRef, 0.8, 1.3)
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

        lastGuessAtRef.current = performance.now()

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
    [gameStarted, playAudio, showBonus, effects],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
      if (event.code === 'ArrowUp' || event.code === 'KeyW') {
        event.preventDefault()
        handleGuess('high')
      }
      if (event.code === 'ArrowDown' || event.code === 'KeyS') {
        event.preventDefault()
        handleGuess('low')
      }
      if (event.code === 'Space') {
        event.preventDefault()
        toggleDoubleDown()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, handleGuess, toggleDoubleDown])

  useEffect(() => {
    const preload = (src: string) => {
      const a = new Audio(src)
      a.preload = 'auto'
      return a
    }
    flipAudioRef.current = preload(flipSfx)
    correctAudioRef.current = preload(correctSfx)
    wrongAudioRef.current = preload(wrongSfx)
    comboAudioRef.current = preload(comboSfx)
    feverAudioRef.current = preload(feverSfx)
    sameAudioRef.current = preload(sameSfx)
    gameOverAudioRef.current = preload(gameOverHitSfx)

    return () => {
      clearTimerSafe(flipTimerRef)
      clearTimerSafe(flashTimerRef)
      clearTimerSafe(bonusTextTimerRef)
      clearTimerSafe(levelUpTimerRef)
      effects.cleanup()
      flipAudioRef.current = null
      correctAudioRef.current = null
      wrongAudioRef.current = null
      comboAudioRef.current = null
      feverAudioRef.current = null
      sameAudioRef.current = null
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

      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      if (remainingMsRef.current <= 0) {
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
  }, [finishGame, effects])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = Math.max(bestScore, score)
  const displayCard = nextCard !== null && isFlipping ? nextCard : currentCard
  const displaySuitColor = displayCard.isJoker ? '#a855f7' : (SUIT_COLORS[displayCard.suit] ?? '#1e293b')
  const streakMult = 1 + Math.floor(combo / 5) * STREAK_MULTIPLIER_PER_5
  const timerPct = remainingMs / ROUND_DURATION_MS
  const comboGaugePct = comboGauge / COMBO_GAUGE_MAX

  return (
    <section
      className="mini-game-panel cfs-panel"
      aria-label="card-flip-speed-game"
      style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...(isFever ? { background: 'linear-gradient(180deg, #7c2d12 0%, #dc2626 12%, #fbbf24 45%, #fef3c7 100%)' } : {}), ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Timer bar */}
      <div className="cfs-timer-bar-wrap">
        <div
          className={`cfs-timer-bar ${isLowTime ? 'low' : ''}`}
          style={{ width: `${timerPct * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="cfs-header">
        <div className="cfs-score-block">
          <p className="cfs-score">{score.toLocaleString()}</p>
          <p className="cfs-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="cfs-time-block">
          <p className={`cfs-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
          <p className="cfs-level">LV {level}</p>
        </div>
      </div>

      {/* Combo gauge */}
      <div className="cfs-combo-row">
        <div className="cfs-combo-gauge-wrap">
          <div
            className={`cfs-combo-gauge ${isFever ? 'fever' : ''}`}
            style={{ width: `${comboGaugePct * 100}%` }}
          />
        </div>
        <span className="cfs-combo-label">
          {combo > 0 ? `${combo} COMBO` : ''}
          {streakMult > 1 ? ` x${streakMult.toFixed(1)}` : ''}
        </span>
      </div>

      {/* Fever banner */}
      {isFever && (
        <div className="cfs-fever-banner">
          FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
        </div>
      )}

      {/* Bonus text */}
      {bonusText && (
        <p className="cfs-bonus-text">{bonusText}</p>
      )}

      {/* Card history */}
      {history.length > 0 && (
        <div className="cfs-history">
          {history.map((h, i) => (
            <span
              key={`h-${i}`}
              className="cfs-history-chip"
              style={{ color: SUIT_COLORS[h.suit] ?? '#1e293b', opacity: 1 - i * 0.15 }}
            >
              {h.label}{h.suit}
            </span>
          ))}
        </div>
      )}

      {/* Level up overlay */}
      {showLevelUp && (
        <div className="cfs-levelup-overlay">
          <span className="cfs-levelup-text">LEVEL {level}!</span>
        </div>
      )}

      {/* Main card area */}
      <div className="cfs-card-zone">
        <div className={`cfs-card-area ${flashResult === 'correct' ? 'flash-correct' : ''} ${flashResult === 'wrong' ? 'flash-wrong' : ''} ${flashResult === 'same' ? 'flash-same' : ''} ${flashResult === 'joker' ? 'flash-joker' : ''}`}>
          <div className={`cfs-card ${isFlipping ? 'cfs-flipping' : ''}`}>
            {showCardBack ? (
              <div className="cfs-card-back">
                <div className="cfs-card-back-pattern">
                  <span className="cfs-back-diamond">{'\u2666'}</span>
                </div>
              </div>
            ) : (
              <div className="cfs-card-face" style={{ color: displaySuitColor }}>
                <span className="cfs-suit-tl">{displayCard.suit}</span>
                <span className="cfs-value">{displayCard.label}</span>
                <span className="cfs-suit-big">{displayCard.suit}</span>
                <span className="cfs-suit-br">{displayCard.suit}</span>
              </div>
            )}
          </div>
          {flashResult !== null && (
            <div className="cfs-result-tag">
              <span className={`cfs-tag cfs-tag-${flashResult}`}>
                {flashResult === 'correct' && 'CORRECT!'}
                {flashResult === 'wrong' && 'WRONG!'}
                {flashResult === 'same' && 'SAME!'}
                {flashResult === 'joker' && 'JOKER!'}
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
        {doubleDownCooldown > 0
          ? `DD (${doubleDownCooldown})`
          : isDoubleDown
            ? 'DD ON x2'
            : 'DOUBLE DOWN'}
      </button>

      {/* HIGH / LOW buttons */}
      <div className="cfs-buttons">
        <button
          className="cfs-btn cfs-btn-high"
          type="button"
          onClick={() => handleGuess('high')}
          disabled={isFlipping}
        >
          <span className="cfs-arrow">{'\u25B2'}</span>
          HIGH
        </button>
        <button
          className="cfs-btn cfs-btn-low"
          type="button"
          onClick={() => handleGuess('low')}
          disabled={isFlipping}
        >
          <span className="cfs-arrow">{'\u25BC'}</span>
          LOW
        </button>
      </div>

      <button className="cfs-exit-btn" type="button" onClick={handleExit}>
        Hub
      </button>

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
          background: linear-gradient(180deg, #064e3b 0%, #065f46 12%, #d1fae5 45%, #ecfdf5 100%);
          padding: 0;
          gap: 0;
        }

        /* --- Timer bar --- */
        .cfs-timer-bar-wrap {
          width: 100%;
          height: 6px;
          background: rgba(0,0,0,0.15);
          flex-shrink: 0;
        }
        .cfs-timer-bar {
          height: 100%;
          background: linear-gradient(90deg, #34d399, #10b981);
          transition: width 0.1s linear;
          border-radius: 0 3px 3px 0;
        }
        .cfs-timer-bar.low {
          background: linear-gradient(90deg, #ef4444, #f97316);
          animation: cfs-bar-pulse 0.5s ease-in-out infinite alternate;
        }

        /* --- Header --- */
        .cfs-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          width: 100%;
          padding: 10px 16px 6px;
          background: linear-gradient(180deg, rgba(0,0,0,0.3), transparent);
          flex-shrink: 0;
        }
        .cfs-score-block { text-align: left; }
        .cfs-score {
          font-size: clamp(24px, 7vw, 32px);
          font-weight: 900;
          color: #ecfdf5;
          margin: 0;
          text-shadow: 0 2px 6px rgba(0,0,0,0.4);
          line-height: 1.1;
        }
        .cfs-best {
          font-size: 10px;
          font-weight: 600;
          color: rgba(236,253,245,0.5);
          margin: 0;
        }
        .cfs-time-block { text-align: right; }
        .cfs-time {
          font-size: clamp(20px, 5.5vw, 26px);
          font-weight: 800;
          color: #ecfdf5;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
          line-height: 1.1;
        }
        .cfs-time.low-time {
          color: #fca5a5;
          animation: cfs-pulse 0.5s ease-in-out infinite alternate;
        }
        .cfs-level {
          font-size: 11px;
          font-weight: 700;
          color: rgba(236,253,245,0.6);
          margin: 0;
        }

        /* --- Combo gauge --- */
        .cfs-combo-row {
          width: 100%;
          padding: 0 16px;
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          height: 22px;
        }
        .cfs-combo-gauge-wrap {
          flex: 1;
          height: 8px;
          background: rgba(0,0,0,0.1);
          border-radius: 4px;
          overflow: hidden;
        }
        .cfs-combo-gauge {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #fbbf24);
          border-radius: 4px;
          transition: width 0.2s ease;
        }
        .cfs-combo-gauge.fever {
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          animation: cfs-gauge-glow 0.4s infinite alternate;
        }
        .cfs-combo-label {
          font-size: 11px;
          font-weight: 800;
          color: #065f46;
          white-space: nowrap;
          min-width: 70px;
          text-align: right;
        }

        /* --- Fever --- */
        .cfs-fever-banner {
          font-size: clamp(13px, 3.5vw, 16px);
          font-weight: 900;
          color: #fff;
          letter-spacing: 3px;
          text-align: center;
          padding: 4px 0;
          width: 100%;
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
          animation: cfs-fever-flash 0.3s infinite alternate;
          flex-shrink: 0;
        }

        /* --- Bonus --- */
        .cfs-bonus-text {
          margin: 0;
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 900;
          color: #fbbf24;
          text-align: center;
          text-shadow: 0 0 12px rgba(251,191,36,0.6);
          animation: cfs-pop 0.35s ease-out;
          flex-shrink: 0;
        }

        /* --- History chips --- */
        .cfs-history {
          display: flex;
          justify-content: center;
          gap: 6px;
          padding: 2px 16px;
          flex-shrink: 0;
        }
        .cfs-history-chip {
          font-size: 12px;
          font-weight: 700;
          padding: 2px 6px;
          background: rgba(255,255,255,0.7);
          border-radius: 6px;
          border: 1px solid rgba(0,0,0,0.08);
        }

        /* --- Card zone --- */
        .cfs-card-zone {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 0;
          padding: 8px 0;
        }
        .cfs-card-area {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: clamp(180px, 50vw, 220px);
          height: clamp(260px, 55vh, 320px);
          border-radius: 18px;
          border: 3px solid rgba(6,95,70,0.15);
          background: #fff;
          perspective: 800px;
          box-shadow: 0 12px 36px rgba(0,0,0,0.12);
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
        }
        .cfs-card-area.flash-correct {
          border-color: #22c55e;
          box-shadow: 0 0 30px rgba(34,197,94,0.5), 0 0 60px rgba(34,197,94,0.2);
        }
        .cfs-card-area.flash-wrong {
          border-color: #ef4444;
          box-shadow: 0 0 30px rgba(239,68,68,0.4);
          animation: cfs-shake 0.3s ease;
        }
        .cfs-card-area.flash-same {
          border-color: #f59e0b;
          box-shadow: 0 0 30px rgba(245,158,11,0.5), 0 0 60px rgba(245,158,11,0.2);
        }
        .cfs-card-area.flash-joker {
          border-color: #a855f7;
          box-shadow: 0 0 30px rgba(168,85,247,0.5), 0 0 60px rgba(168,85,247,0.2);
          animation: cfs-joker-glow 0.4s ease;
        }

        /* --- Card --- */
        .cfs-card {
          width: 100%;
          height: 100%;
          transition: transform ${FLIP_ANIMATION_MS}ms ease;
          transform-style: preserve-3d;
        }
        .cfs-flipping {
          animation: cfs-flip ${FLIP_ANIMATION_MS}ms ease forwards;
        }
        .cfs-card-face {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          border-radius: 15px;
        }
        .cfs-suit-tl {
          position: absolute;
          top: 14px;
          left: 16px;
          font-size: clamp(18px, 5vw, 24px);
        }
        .cfs-value {
          font-size: clamp(56px, 18vw, 80px);
          font-weight: 900;
          line-height: 1;
        }
        .cfs-suit-big {
          font-size: clamp(32px, 10vw, 44px);
          margin-top: 4px;
        }
        .cfs-suit-br {
          position: absolute;
          bottom: 14px;
          right: 16px;
          font-size: clamp(18px, 5vw, 24px);
          transform: rotate(180deg);
        }

        /* --- Result tag --- */
        .cfs-result-tag {
          position: absolute;
          bottom: -16px;
          left: 50%;
          transform: translateX(-50%);
          animation: cfs-pop 0.3s ease;
        }
        .cfs-tag {
          padding: 6px 18px;
          border-radius: 12px;
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 900;
          white-space: nowrap;
          color: #fff;
        }
        .cfs-tag-correct {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          box-shadow: 0 2px 10px rgba(34,197,94,0.5);
        }
        .cfs-tag-wrong {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          box-shadow: 0 2px 10px rgba(239,68,68,0.5);
        }
        .cfs-tag-same {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          box-shadow: 0 2px 10px rgba(245,158,11,0.5);
        }
        .cfs-tag-joker {
          background: linear-gradient(135deg, #a855f7, #7c3aed);
          box-shadow: 0 2px 10px rgba(168,85,247,0.5);
        }

        /* --- Double down --- */
        .cfs-dd-btn {
          margin: 4px 0;
          padding: 8px 32px;
          border-radius: 10px;
          border: 2px solid rgba(6,95,70,0.2);
          background: rgba(255,255,255,0.8);
          color: #065f46;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
          transition: transform 0.1s, background 0.1s, border-color 0.1s;
          flex-shrink: 0;
          letter-spacing: 1px;
        }
        .cfs-dd-btn.active {
          background: linear-gradient(135deg, #fbbf24, #f59e0b);
          color: #fff;
          border-color: #d97706;
          box-shadow: 0 0 12px rgba(251,191,36,0.4);
          animation: cfs-dd-pulse 0.6s ease-in-out infinite alternate;
        }
        .cfs-dd-btn.cooldown {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .cfs-dd-btn:active:not(:disabled) {
          transform: scale(0.95);
        }

        /* --- Buttons --- */
        .cfs-buttons {
          display: flex;
          gap: 14px;
          width: 100%;
          padding: 4px 16px;
          box-sizing: border-box;
          flex-shrink: 0;
        }
        .cfs-btn {
          flex: 1;
          padding: clamp(14px, 4vw, 20px) 0;
          border: none;
          border-radius: 16px;
          font-size: clamp(18px, 5vw, 24px);
          font-weight: 900;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          transition: transform 0.1s ease, box-shadow 0.1s ease;
          color: #fff;
          letter-spacing: 2px;
          touch-action: manipulation;
        }
        .cfs-btn:active:not(:disabled) {
          transform: scale(0.93);
        }
        .cfs-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .cfs-btn-high {
          background: linear-gradient(135deg, #059669, #047857);
          box-shadow: 0 6px 18px rgba(5,150,105,0.4);
        }
        .cfs-btn-low {
          background: linear-gradient(135deg, #dc2626, #b91c1c);
          box-shadow: 0 6px 18px rgba(220,38,38,0.4);
        }
        .cfs-arrow {
          font-size: clamp(20px, 6vw, 28px);
          line-height: 1;
        }

        /* --- Exit --- */
        .cfs-exit-btn {
          font-size: 12px;
          font-weight: 700;
          padding: 6px 20px;
          border-radius: 8px;
          border: 2px solid rgba(6,95,70,0.15);
          background: rgba(255,255,255,0.6);
          color: #065f46;
          cursor: pointer;
          transition: transform 0.1s;
          margin-bottom: 6px;
          flex-shrink: 0;
        }
        .cfs-exit-btn:active {
          transform: scale(0.95);
        }

        /* --- Card back --- */
        .cfs-card-back {
          width: 100%;
          height: 100%;
          border-radius: 15px;
          background: linear-gradient(135deg, #1e3a5f, #1e40af);
          display: flex;
          align-items: center;
          justify-content: center;
          border: 4px solid #3b82f6;
          box-sizing: border-box;
        }
        .cfs-card-back-pattern {
          width: 80%;
          height: 80%;
          border: 2px solid rgba(59,130,246,0.4);
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: repeating-linear-gradient(
            45deg,
            rgba(59,130,246,0.1) 0 4px,
            transparent 4px 8px
          );
        }
        .cfs-back-diamond {
          font-size: 40px;
          color: rgba(147,197,253,0.6);
        }

        /* --- Level up --- */
        .cfs-levelup-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          pointer-events: none;
          animation: cfs-levelup-anim 1s ease-out forwards;
        }
        .cfs-levelup-text {
          font-size: clamp(32px, 10vw, 48px);
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 20px rgba(251,191,36,0.8), 0 4px 8px rgba(0,0,0,0.3);
          letter-spacing: 4px;
        }

        /* --- Animations --- */
        @keyframes cfs-flip {
          0% { transform: rotateY(0deg) scale(1); }
          30% { transform: rotateY(90deg) scale(0.95); }
          60% { transform: rotateY(180deg) scale(0.95); }
          100% { transform: rotateY(360deg) scale(1); }
        }
        @keyframes cfs-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-8px) rotate(-1deg); }
          30% { transform: translateX(8px) rotate(1deg); }
          45% { transform: translateX(-6px); }
          60% { transform: translateX(6px); }
          75% { transform: translateX(-3px); }
        }
        @keyframes cfs-pulse {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }
        @keyframes cfs-pop {
          0% { transform: translateX(-50%) scale(0.3); opacity: 0; }
          60% { transform: translateX(-50%) scale(1.15); opacity: 1; }
          100% { transform: translateX(-50%) scale(1); opacity: 1; }
        }
        @keyframes cfs-fever-flash {
          from { opacity: 0.85; }
          to { opacity: 1; }
        }
        @keyframes cfs-bar-pulse {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }
        @keyframes cfs-gauge-glow {
          from { box-shadow: 0 0 4px rgba(245,158,11,0.3); }
          to { box-shadow: 0 0 12px rgba(239,68,68,0.6); }
        }
        @keyframes cfs-joker-glow {
          0% { transform: scale(1); }
          50% { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
        @keyframes cfs-dd-pulse {
          from { box-shadow: 0 0 8px rgba(251,191,36,0.3); }
          to { box-shadow: 0 0 20px rgba(251,191,36,0.6); }
        }
        @keyframes cfs-levelup-anim {
          0% { opacity: 0; transform: scale(0.5); }
          20% { opacity: 1; transform: scale(1.2); }
          60% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(1.3) translateY(-30px); }
        }
      `}</style>
    </section>
  )
}

export const cardFlipSpeedModule: MiniGameModule = {
  manifest: {
    id: 'card-flip-speed',
    title: 'Card Flip',
    description: '\uB2E4\uC74C \uCE74\uB4DC\uAC00 \uB192\uC744\uAE4C \uB0AE\uC744\uAE4C? \uBE60\uB974\uAC8C \uC608\uCE21\uD558\uB77C!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#1e40af',
  },
  Component: CardFlipSpeedGame,
}
