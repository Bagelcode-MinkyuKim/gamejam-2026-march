import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import characterImg from '../../../assets/images/same-character/park-sangmin.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 30000
const CORRECT_SCORE = 5
const WRONG_PENALTY = 3
const SAME_BONUS = 10
const LOW_TIME_THRESHOLD_MS = 5000
const FLIP_ANIMATION_MS = 400
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
}

function randomCardAllowSame(): CardInfo {
  const value = Math.floor(Math.random() * CARD_MAX) + 1
  const suit = SUIT_SYMBOLS[Math.floor(Math.random() * SUIT_SYMBOLS.length)]
  return { value, suit, label: CARD_LABELS[value - 1] }
}

function CardFlipSpeedGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [currentCard, setCurrentCard] = useState<CardInfo>(() => randomCardAllowSame())
  const [nextCard, setNextCard] = useState<CardInfo | null>(null)
  const [cardsPlayed, setCardsPlayed] = useState(1)
  const [isFlipping, setIsFlipping] = useState(false)
  const [flashResult, setFlashResult] = useState<'correct' | 'wrong' | 'same' | null>(null)
  const [gameStarted, setGameStarted] = useState(false)
  const [level, setLevel] = useState(1)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [bonusText, setBonusText] = useState('')

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

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
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
    }, 1000)
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

  const handleGuess = useCallback(
    (guess: 'high' | 'low') => {
      if (finishedRef.current || isFlippingRef.current) return
      if (!gameStarted) setGameStarted(true)

      const guessStartAt = performance.now()
      isFlippingRef.current = true
      setIsFlipping(true)

      const next = randomCardAllowSame()
      setNextCard(next)

      clearTimerSafe(flipTimerRef)
      flipTimerRef.current = window.setTimeout(() => {
        flipTimerRef.current = null
        const current = currentCardRef.current

        let result: 'correct' | 'wrong' | 'same'
        if (next.value === current.value) {
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

        // Streak multiplier
        const streakMult = 1 + Math.floor(nextCombo / 5) * STREAK_MULTIPLIER_PER_5

        // Fast match detection
        const guessTime = performance.now() - guessStartAt
        const isFastMatch = guessTime < FAST_MATCH_THRESHOLD_MS && result !== 'wrong'

        const bonusParts: string[] = []

        if (result === 'same') {
          const pts = Math.round(SAME_BONUS * streakMult * feverMult)
          nextScore += pts
          nextCombo += 1
          playAudio(tapHitStrongAudioRef, 0.7, 1.2)
          bonusParts.push(`SAME +${pts}`)
          effects.triggerFlash()
          effects.spawnParticles(4, 200, 200)
        } else if (result === 'correct') {
          const basePts = CORRECT_SCORE + Math.floor(nextCombo / 3)
          const pts = Math.round(basePts * streakMult * feverMult)
          nextScore += pts
          nextCombo += 1
          playAudio(tapHitAudioRef, 0.5, 1 + nextCombo * 0.02)
          effects.triggerFlash()
          effects.spawnParticles(4, 200, 200)
        } else {
          nextScore = Math.max(0, nextScore - WRONG_PENALTY)
          nextCombo = 0
          playAudio(tapHitAudioRef, 0.5, 0.7)
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.4)')
        }

        // Fast match time bonus
        if (isFastMatch) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FAST_MATCH_TIME_BONUS_MS)
          bonusParts.push(`+${(FAST_MATCH_TIME_BONUS_MS / 1000).toFixed(1)}s`)
        }

        if (streakMult > 1 && result !== 'wrong') {
          bonusParts.push(`x${streakMult.toFixed(1)}`)
        }

        // Fever activation
        if (nextCombo >= FEVER_STREAK_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          bonusParts.push('FEVER!')
          playAudio(tapHitStrongAudioRef, 0.7, 1.4)
        }

        if (bonusParts.length > 0) {
          showBonus(bonusParts.join(' '))
        }

        scoreRef.current = nextScore
        comboRef.current = nextCombo
        setScore(nextScore)
        setCombo(nextCombo)
        setFlashResult(result)

        cardsPlayedRef.current += 1
        setCardsPlayed(cardsPlayedRef.current)

        // Level escalation
        const nextLevel = 1 + Math.floor(cardsPlayedRef.current / LEVEL_UP_THRESHOLD)
        setLevel(nextLevel)

        lastGuessAtRef.current = performance.now()

        currentCardRef.current = next
        setCurrentCard(next)
        setNextCard(null)
        setIsFlipping(false)
        isFlippingRef.current = false

        clearTimerSafe(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashResult(null)
        }, FLASH_DURATION_MS)
      }, FLIP_ANIMATION_MS)
    },
    [gameStarted, playAudio, showBonus],
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

    return () => {
      clearTimerSafe(flipTimerRef)
      clearTimerSafe(flashTimerRef)
      clearTimerSafe(bonusTextTimerRef)
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
  }, [finishGame])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = Math.max(bestScore, score)
  const displayCard = nextCard !== null && isFlipping ? nextCard : currentCard
  const displaySuitColor = SUIT_COLORS[displayCard.suit] ?? '#1e293b'
  const streakMult = 1 + Math.floor(combo / 5) * STREAK_MULTIPLIER_PER_5

  const flashBorderClass =
    flashResult === 'correct'
      ? 'card-flip-speed-flash-correct'
      : flashResult === 'wrong'
        ? 'card-flip-speed-flash-wrong'
        : flashResult === 'same'
          ? 'card-flip-speed-flash-same'
          : ''

  return (
    <section className="mini-game-panel card-flip-speed-panel" aria-label="card-flip-speed-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="cfs-header">
        <img className="cfs-avatar" src={characterImg} alt="Dealer" />
        <div style={{ flex: 1 }}>
          <p className="cfs-score">{score.toLocaleString()}</p>
          <p className="cfs-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`cfs-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="cfs-meta-row">
        <p>COMBO <strong>{combo}</strong></p>
        <p>CARDS <strong>{cardsPlayed}</strong></p>
        <p>LV <strong>{level}</strong></p>
        {streakMult > 1 && (
          <p style={{ color: '#fbbf24', fontWeight: 'bold' }}>
            x{streakMult.toFixed(1)}
          </p>
        )}
      </div>

      {isFever && (
        <p className="cfs-fever">
          FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
        </p>
      )}

      {bonusText && (
        <p className="cfs-bonus">{bonusText}</p>
      )}

      <div className="cfs-card-zone">
        <div className={`cfs-card-area ${flashBorderClass}`}>
          <div className={`card-flip-speed-card ${isFlipping ? 'card-flip-speed-flipping' : ''}`}>
            <div className="card-flip-speed-card-inner">
              <div className="card-flip-speed-card-front" style={{ color: displaySuitColor }}>
                <span className="cfs-suit-top">{displayCard.suit}</span>
                <span className="cfs-card-value">{displayCard.label}</span>
                <span className="cfs-suit-center">{displayCard.suit}</span>
                <span className="cfs-suit-bottom">{displayCard.suit}</span>
              </div>
            </div>
          </div>
          {flashResult !== null && (
            <div className="cfs-result-badge">
              {flashResult === 'correct' && <span className="cfs-badge-correct">CORRECT!</span>}
              {flashResult === 'wrong' && <span className="cfs-badge-wrong">WRONG!</span>}
              {flashResult === 'same' && <span className="cfs-badge-same">SAME!</span>}
            </div>
          )}
        </div>
      </div>

      <div className="cfs-buttons">
        <button
          className="cfs-btn cfs-btn-high"
          type="button"
          onClick={() => handleGuess('high')}
          disabled={isFlipping}
        >
          HIGH <span className="cfs-arrow">{'\u2191'}</span>
        </button>
        <button
          className="cfs-btn cfs-btn-low"
          type="button"
          onClick={() => handleGuess('low')}
          disabled={isFlipping}
        >
          LOW <span className="cfs-arrow">{'\u2193'}</span>
        </button>
      </div>

      <button className="cfs-hub-btn" type="button" onClick={handleExit}>
        Hub
      </button>

      <style>{`
        .card-flip-speed-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          overflow: hidden;
          background: linear-gradient(180deg, #064e3b 0%, #065f46 15%, #d1fae5 50%, #ecfdf5 100%);
        }

        .cfs-header {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 14px 8px;
          background: linear-gradient(180deg, rgba(0,0,0,0.35), transparent);
        }

        .cfs-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 3px solid #34d399;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          object-fit: cover;
        }

        .cfs-score {
          font-size: 26px;
          font-weight: 800;
          color: #ecfdf5;
          margin: 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        .cfs-best {
          font-size: 10px;
          font-weight: 600;
          color: rgba(236,253,245,0.6);
          margin: 0;
        }

        .cfs-time {
          font-size: 20px;
          font-weight: 700;
          color: #ecfdf5;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .cfs-time.low-time {
          color: #fca5a5;
          animation: cfs-pulse 0.5s ease-in-out infinite alternate;
        }

        .cfs-meta-row {
          display: flex;
          justify-content: center;
          gap: 16px;
          width: 100%;
          font-size: 13px;
          color: #065f46;
        }

        .cfs-meta-row p {
          margin: 0;
        }

        .cfs-meta-row strong {
          color: #047857;
          font-size: 15px;
        }

        .cfs-fever {
          margin: 0;
          font-size: 14px;
          font-weight: 900;
          color: #fff;
          letter-spacing: 3px;
          text-align: center;
          padding: 4px 0;
          width: 100%;
          background: linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b);
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
          animation: cfs-fever-flash 0.3s infinite alternate;
        }

        .cfs-bonus {
          margin: 0;
          font-size: 13px;
          font-weight: 800;
          color: #fbbf24;
          text-align: center;
          text-shadow: 0 0 8px rgba(251,191,36,0.5);
          animation: cfs-badge-pop 0.3s ease-out;
        }

        .cfs-card-zone {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
        }

        .cfs-card-area {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 170px;
          height: 240px;
          border-radius: 16px;
          border: 3px solid rgba(6,95,70,0.2);
          background: #fff;
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          perspective: 600px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.1);
        }

        .card-flip-speed-flash-correct {
          border-color: #22c55e;
          box-shadow: 0 0 24px rgba(34,197,94,0.5);
        }

        .card-flip-speed-flash-wrong {
          border-color: #ef4444;
          box-shadow: 0 0 24px rgba(239,68,68,0.4);
          animation: cfs-shake 0.3s ease;
        }

        .card-flip-speed-flash-same {
          border-color: #f59e0b;
          box-shadow: 0 0 28px rgba(245,158,11,0.5);
        }

        .card-flip-speed-card {
          width: 100%;
          height: 100%;
          transition: transform ${FLIP_ANIMATION_MS}ms ease;
          transform-style: preserve-3d;
        }

        .card-flip-speed-flipping {
          animation: cfs-flip ${FLIP_ANIMATION_MS}ms ease forwards;
        }

        .card-flip-speed-card-inner {
          width: 100%;
          height: 100%;
          position: relative;
        }

        .card-flip-speed-card-front {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          position: relative;
          border-radius: 13px;
        }

        .cfs-suit-top {
          position: absolute;
          top: 12px;
          left: 14px;
          font-size: 18px;
        }

        .cfs-card-value {
          font-size: 64px;
          font-weight: 900;
          line-height: 1;
        }

        .cfs-suit-center {
          font-size: 36px;
          margin-top: 4px;
        }

        .cfs-suit-bottom {
          position: absolute;
          bottom: 12px;
          right: 14px;
          font-size: 18px;
          transform: rotate(180deg);
        }

        .cfs-result-badge {
          position: absolute;
          bottom: -18px;
          left: 50%;
          transform: translateX(-50%);
          animation: cfs-badge-pop 0.3s ease;
        }

        .cfs-badge-correct {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: #fff;
          padding: 6px 16px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 800;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(34,197,94,0.4);
        }

        .cfs-badge-wrong {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: #fff;
          padding: 6px 16px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 800;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(239,68,68,0.4);
        }

        .cfs-badge-same {
          background: linear-gradient(135deg, #f59e0b, #d97706);
          color: #fff;
          padding: 6px 16px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 800;
          white-space: nowrap;
          box-shadow: 0 2px 8px rgba(245,158,11,0.4);
        }

        .cfs-buttons {
          display: flex;
          gap: 14px;
          width: 100%;
          max-width: 320px;
          padding: 0 16px;
          box-sizing: border-box;
        }

        .cfs-btn {
          flex: 1;
          padding: 16px 0;
          border: none;
          border-radius: 14px;
          font-size: 20px;
          font-weight: 800;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: transform 0.1s ease, box-shadow 0.1s ease;
          color: #fff;
          letter-spacing: 1px;
          touch-action: manipulation;
        }

        .cfs-btn:active:not(:disabled) {
          transform: scale(0.95);
        }

        .cfs-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .cfs-btn-high {
          background: linear-gradient(135deg, #059669, #047857);
          box-shadow: 0 4px 14px rgba(5,150,105,0.4);
        }

        .cfs-btn-low {
          background: linear-gradient(135deg, #dc2626, #b91c1c);
          box-shadow: 0 4px 14px rgba(220,38,38,0.4);
        }

        .cfs-arrow {
          font-size: 24px;
          line-height: 1;
        }

        .cfs-hub-btn {
          font-size: 13px;
          font-weight: 700;
          padding: 8px 24px;
          border-radius: 10px;
          border: 2px solid rgba(6,95,70,0.2);
          background: rgba(255,255,255,0.7);
          color: #065f46;
          cursor: pointer;
          transition: transform 0.1s, background 0.1s;
          margin-bottom: 8px;
        }

        .cfs-hub-btn:active {
          transform: scale(0.95);
          background: rgba(255,255,255,0.9);
        }

        @keyframes cfs-flip {
          0% { transform: rotateY(0deg); }
          50% { transform: rotateY(90deg); }
          100% { transform: rotateY(0deg); }
        }

        @keyframes cfs-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        @keyframes cfs-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        @keyframes cfs-badge-pop {
          0% { transform: translateX(-50%) scale(0.5); opacity: 0; }
          70% { transform: translateX(-50%) scale(1.1); }
          100% { transform: translateX(-50%) scale(1); opacity: 1; }
        }

        @keyframes cfs-fever-flash {
          from { opacity: 0.8; }
          to { opacity: 1; }
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
