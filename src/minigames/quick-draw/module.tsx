import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import seoTaijiImg from '../../../assets/images/same-character/seo-taiji.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const TOTAL_ROUNDS = 10
const MIN_WAIT_MS = 1000
const MAX_WAIT_MS = 4000
const PERFECT_THRESHOLD_MS = 150
const GREAT_THRESHOLD_MS = 250
const GOOD_THRESHOLD_MS = 400
const EARLY_TAP_PENALTY = -100
const MAX_REACTION_SCORE = 1000
const COUNTDOWN_DISPLAY_MS = 1500
const RESULT_DISPLAY_MS = 1800
const GAME_OVER_DISPLAY_MS = 2400

type RoundPhase = 'countdown' | 'waiting' | 'draw' | 'result' | 'too-early' | 'game-over'

interface RoundResult {
  readonly reactionMs: number
  readonly score: number
  readonly tooEarly: boolean
}

function randomWaitMs(): number {
  return MIN_WAIT_MS + Math.random() * (MAX_WAIT_MS - MIN_WAIT_MS)
}

function reactionToScore(reactionMs: number): number {
  return Math.max(0, MAX_REACTION_SCORE - Math.round(reactionMs))
}

function reactionToGrade(reactionMs: number): string {
  if (reactionMs <= PERFECT_THRESHOLD_MS) return 'PERFECT!'
  if (reactionMs <= GREAT_THRESHOLD_MS) return 'GREAT!'
  if (reactionMs <= GOOD_THRESHOLD_MS) return 'GOOD'
  return 'SLOW...'
}

function reactionToGradeClass(reactionMs: number): string {
  if (reactionMs <= PERFECT_THRESHOLD_MS) return 'perfect'
  if (reactionMs <= GREAT_THRESHOLD_MS) return 'great'
  if (reactionMs <= GOOD_THRESHOLD_MS) return 'good'
  return 'slow'
}

function QuickDrawGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [phase, setPhase] = useState<RoundPhase>('countdown')
  const [round, setRound] = useState(1)
  const [totalScore, setTotalScore] = useState(0)
  const [lastReactionMs, setLastReactionMs] = useState<number | null>(null)
  const [lastRoundScore, setLastRoundScore] = useState<number | null>(null)
  const [lastTooEarly, setLastTooEarly] = useState(false)
  const [roundResults, setRoundResults] = useState<RoundResult[]>([])
  const [waitText, setWaitText] = useState('')
  const [screenFlash, setScreenFlash] = useState('')

  const phaseRef = useRef<RoundPhase>('countdown')
  const roundRef = useRef(1)
  const totalScoreRef = useRef(0)
  const drawTimestampRef = useRef(0)
  const waitTimerRef = useRef<number | null>(null)
  const resultTimerRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const startTimeRef = useRef(performance.now())
  const roundResultsRef = useRef<RoundResult[]>([])

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

  const transitionToWaiting = useCallback(() => {
    const waitDots = ['...', '..', '.']
    const dotIndex = Math.floor(Math.random() * waitDots.length)
    setWaitText(waitDots[dotIndex])
    phaseRef.current = 'waiting'
    setPhase('waiting')
    setScreenFlash('')
    setLastReactionMs(null)
    setLastRoundScore(null)
    setLastTooEarly(false)

    const delay = randomWaitMs()
    waitTimerRef.current = window.setTimeout(() => {
      waitTimerRef.current = null
      drawTimestampRef.current = performance.now()
      phaseRef.current = 'draw'
      setPhase('draw')
      setScreenFlash('draw-flash')
      playAudio(tapHitStrongAudioRef, 0.7, 1.1)
    }, delay)
  }, [playAudio])

  const advanceRound = useCallback(() => {
    const nextRound = roundRef.current + 1
    if (nextRound > TOTAL_ROUNDS) {
      phaseRef.current = 'game-over'
      setPhase('game-over')
      setScreenFlash('game-over-flash')
      playAudio(gameOverAudioRef, 0.7, 0.95)

      resultTimerRef.current = window.setTimeout(() => {
        resultTimerRef.current = null
        if (finishedRef.current) return
        finishedRef.current = true
        const elapsedMs = Math.max(Math.round(performance.now() - startTimeRef.current), 1000)
        onFinish({
          score: totalScoreRef.current,
          durationMs: elapsedMs,
        })
      }, GAME_OVER_DISPLAY_MS)
      return
    }

    roundRef.current = nextRound
    setRound(nextRound)
    transitionToWaiting()
  }, [onFinish, playAudio, transitionToWaiting])

  const showResult = useCallback(
    (reactionMs: number, score: number, tooEarly: boolean) => {
      const result: RoundResult = { reactionMs, score, tooEarly }
      roundResultsRef.current = [...roundResultsRef.current, result]
      setRoundResults(roundResultsRef.current)

      const nextTotal = totalScoreRef.current + score
      totalScoreRef.current = nextTotal
      setTotalScore(nextTotal)
      setLastReactionMs(tooEarly ? null : reactionMs)
      setLastRoundScore(score)
      setLastTooEarly(tooEarly)

      phaseRef.current = 'result'
      setPhase(tooEarly ? 'too-early' : 'result')
      setScreenFlash(tooEarly ? 'early-flash' : score >= 850 ? 'perfect-flash' : 'result-flash')

      if (tooEarly) {
        effects.triggerShake(8)
        effects.triggerFlash('rgba(244,114,182,0.3)')
      } else if (score >= 850) {
        effects.comboHitBurst(200, 300, 10, score, ['⚡', '🔥', '💥', '🌟'])
      } else if (score >= 600) {
        effects.spawnParticles(5, 200, 300, ['✨', '💫', '⭐'])
        effects.showScorePopup(score, 200, 280)
      } else {
        effects.spawnParticles(3, 200, 300)
        effects.showScorePopup(score, 200, 280)
      }

      resultTimerRef.current = window.setTimeout(() => {
        resultTimerRef.current = null
        advanceRound()
      }, RESULT_DISPLAY_MS)
    },
    [advanceRound],
  )

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    const currentPhase = phaseRef.current
    if (currentPhase === 'countdown' || currentPhase === 'result' || currentPhase === 'too-early' || currentPhase === 'game-over') {
      return
    }

    if (currentPhase === 'waiting') {
      clearTimerSafe(waitTimerRef)
      playAudio(tapHitAudioRef, 0.5, 0.7)
      showResult(0, EARLY_TAP_PENALTY, true)
      return
    }

    if (currentPhase === 'draw') {
      const now = performance.now()
      const reactionMs = Math.min(now - drawTimestampRef.current, MAX_REACTION_SCORE)
      const score = reactionToScore(reactionMs)
      const roundedReaction = Math.round(reactionMs)

      if (score >= 850) {
        playAudio(tapHitStrongAudioRef, 0.8, 1.2)
      } else {
        playAudio(tapHitAudioRef, 0.6, 1.0)
      }

      showResult(roundedReaction, score, false)
    }
  }, [playAudio, showResult])

  const handleExit = useCallback(() => {
    clearTimerSafe(waitTimerRef)
    clearTimerSafe(resultTimerRef)
    onExit()
  }, [onExit])

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
      clearTimerSafe(waitTimerRef)
      clearTimerSafe(resultTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    startTimeRef.current = performance.now()

    const countdownTimer = window.setTimeout(() => {
      transitionToWaiting()
    }, COUNTDOWN_DISPLAY_MS)

    return () => {
      window.clearTimeout(countdownTimer)
    }
  }, [transitionToWaiting])

  useEffect(() => {
    const interval = window.setInterval(() => {
      effects.updateParticles()
    }, 50)
    return () => {
      window.clearInterval(interval)
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return

      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }

      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault()
        handleTap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleTap, handleExit])

  const displayedBestScore = Math.max(bestScore, totalScore)
  const isDrawPhase = phase === 'draw'
  const isWaiting = phase === 'waiting'
  const isTooEarly = phase === 'too-early'
  const isGameOver = phase === 'game-over'
  const isCountdown = phase === 'countdown'
  const isResult = phase === 'result'

  const bgClass = isDrawPhase
    ? 'quick-draw-bg-draw'
    : isWaiting
      ? 'quick-draw-bg-waiting'
      : isTooEarly
        ? 'quick-draw-bg-early'
        : isGameOver
          ? 'quick-draw-bg-gameover'
          : isResult && lastRoundScore !== null && lastRoundScore >= 850
            ? 'quick-draw-bg-perfect'
            : 'quick-draw-bg-default'

  return (
    <section
      className={`mini-game-panel quick-draw-panel ${bgClass} ${screenFlash}`}
      aria-label="quick-draw-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}
      onClick={handleTap}
      onTouchStart={(e) => {
        e.preventDefault()
        handleTap()
      }}
    >
      <div className="quick-draw-hud">
        <div className="quick-draw-hud-left">
          <p className="quick-draw-round-label">
            ROUND <strong>{Math.min(round, TOTAL_ROUNDS)}</strong> / {TOTAL_ROUNDS}
          </p>
        </div>
        <div className="quick-draw-hud-center">
          <p className="quick-draw-total-score">{totalScore.toLocaleString()}</p>
        </div>
        <div className="quick-draw-hud-right">
          <p className="quick-draw-best-score">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
      </div>

      <div className="quick-draw-arena">
        <img
          src={seoTaijiImg}
          alt="cowboy"
          className="quick-draw-cowboy-mascot"
          draggable={false}
        />
        {isCountdown && (
          <div className="quick-draw-center-text quick-draw-countdown-anim">
            <p className="quick-draw-title-text">QUICK DRAW</p>
            <p className="quick-draw-subtitle-text">Get Ready...</p>
          </div>
        )}

        {isWaiting && (
          <div className="quick-draw-center-text quick-draw-waiting-anim">
            <p className="quick-draw-wait-text">{waitText}</p>
            <p className="quick-draw-wait-hint">Wait for it...</p>
          </div>
        )}

        {isDrawPhase && (
          <div className="quick-draw-center-text quick-draw-draw-anim">
            <p className="quick-draw-draw-text">DRAW!</p>
            <p className="quick-draw-draw-hint">TAP NOW!</p>
          </div>
        )}

        {isResult && lastReactionMs !== null && lastRoundScore !== null && (
          <div className="quick-draw-center-text quick-draw-result-anim">
            <p className={`quick-draw-grade-text quick-draw-grade-${reactionToGradeClass(lastReactionMs)}`}>
              {reactionToGrade(lastReactionMs)}
            </p>
            <p className="quick-draw-reaction-time">{lastReactionMs} ms</p>
            <p className="quick-draw-round-score">+{lastRoundScore}</p>
          </div>
        )}

        {isTooEarly && (
          <div className="quick-draw-center-text quick-draw-early-anim">
            <p className="quick-draw-early-text">TOO EARLY!</p>
            <p className="quick-draw-penalty-text">{EARLY_TAP_PENALTY}</p>
          </div>
        )}

        {isGameOver && (
          <div className="quick-draw-center-text quick-draw-gameover-anim">
            <p className="quick-draw-gameover-title">GAME OVER</p>
            <p className="quick-draw-gameover-score">TOTAL: {totalScore.toLocaleString()}</p>
            {totalScore > bestScore && <p className="quick-draw-new-record">NEW RECORD!</p>}
          </div>
        )}
      </div>

      <div className="quick-draw-round-history">
        {roundResults.map((result, index) => (
          <div
            className={`quick-draw-history-dot ${result.tooEarly ? 'early' : result.score >= 850 ? 'perfect' : result.score >= 600 ? 'great' : 'normal'}`}
            key={`round-${index}`}
            title={result.tooEarly ? 'Too early!' : `${result.reactionMs}ms (+${result.score})`}
          />
        ))}
        {Array.from({ length: TOTAL_ROUNDS - roundResults.length }, (_, index) => (
          <div className="quick-draw-history-dot pending" key={`pending-${index}`} />
        ))}
      </div>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="quick-draw-footer">
        <button
          className="text-button"
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            handleExit()
          }}
        >
          Exit
        </button>
      </div>

      <style>{GAME_EFFECTS_CSS}
      {`
        .quick-draw-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          height: 100%;
          user-select: none;
          cursor: pointer;
          transition: background-color 0.15s ease;
          overflow: hidden;
          position: relative;
        }

        .quick-draw-bg-default {
          background: linear-gradient(180deg, #1a1207 0%, #2d1f0e 50%, #1a1207 100%);
        }
        .quick-draw-bg-waiting {
          background: linear-gradient(180deg, #0a0a1a 0%, #141428 50%, #0a0a1a 100%);
        }
        .quick-draw-bg-draw {
          background: linear-gradient(180deg, #7f1d1d 0%, #dc2626 40%, #991b1b 100%);
        }
        .quick-draw-bg-early {
          background: linear-gradient(180deg, #4a1942 0%, #831843 50%, #4a1942 100%);
        }
        .quick-draw-bg-perfect {
          background: linear-gradient(180deg, #14532d 0%, #166534 50%, #14532d 100%);
        }
        .quick-draw-bg-gameover {
          background: linear-gradient(180deg, #1c1917 0%, #292524 50%, #1c1917 100%);
        }

        .draw-flash {
          animation: quick-draw-flash-red 0.3s ease-out;
        }
        .early-flash {
          animation: quick-draw-flash-purple 0.4s ease-out;
        }
        .perfect-flash {
          animation: quick-draw-flash-green 0.3s ease-out;
        }
        .result-flash {
          animation: quick-draw-flash-amber 0.2s ease-out;
        }
        .game-over-flash {
          animation: quick-draw-flash-white 0.5s ease-out;
        }

        @keyframes quick-draw-flash-red {
          0% { filter: brightness(2.5); }
          100% { filter: brightness(1); }
        }
        @keyframes quick-draw-flash-purple {
          0% { filter: brightness(1.8) hue-rotate(20deg); }
          100% { filter: brightness(1) hue-rotate(0deg); }
        }
        @keyframes quick-draw-flash-green {
          0% { filter: brightness(2); }
          100% { filter: brightness(1); }
        }
        @keyframes quick-draw-flash-amber {
          0% { filter: brightness(1.4); }
          100% { filter: brightness(1); }
        }
        @keyframes quick-draw-flash-white {
          0% { filter: brightness(3); }
          50% { filter: brightness(1.5); }
          100% { filter: brightness(1); }
        }

        .quick-draw-hud {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 12px 16px;
          z-index: 2;
        }
        .quick-draw-hud-left,
        .quick-draw-hud-right {
          flex: 1;
        }
        .quick-draw-hud-center {
          flex: 1;
          text-align: center;
        }
        .quick-draw-hud-right {
          text-align: right;
        }
        .quick-draw-round-label {
          font-size: 13px;
          color: #d4a574;
          letter-spacing: 0.05em;
          margin: 0;
        }
        .quick-draw-round-label strong {
          font-size: 18px;
          color: #fbbf24;
        }
        .quick-draw-total-score {
          font-size: 28px;
          font-weight: 900;
          color: #fef3c7;
          text-shadow: 0 2px 8px rgba(251, 191, 36, 0.5);
          margin: 0;
          letter-spacing: 0.02em;
        }
        .quick-draw-best-score {
          font-size: 12px;
          color: #a8a29e;
          margin: 0;
        }

        .quick-draw-arena {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          z-index: 1;
          position: relative;
        }

        .quick-draw-cowboy-mascot {
          position: absolute;
          bottom: 0;
          left: 50%;
          transform: translateX(-50%);
          height: 70%;
          max-height: 320px;
          object-fit: contain;
          opacity: 0.18;
          pointer-events: none;
          filter: sepia(0.6) brightness(0.8);
          z-index: 0;
        }

        .quick-draw-center-text {
          text-align: center;
        }

        .quick-draw-title-text {
          font-size: 42px;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 4px 16px rgba(251, 191, 36, 0.6), 0 0 40px rgba(251, 191, 36, 0.3);
          margin: 0 0 8px 0;
          letter-spacing: 0.08em;
        }
        .quick-draw-subtitle-text {
          font-size: 18px;
          color: #d4a574;
          margin: 0;
          letter-spacing: 0.1em;
        }

        .quick-draw-wait-text {
          font-size: 64px;
          font-weight: 900;
          color: #6366f1;
          text-shadow: 0 0 30px rgba(99, 102, 241, 0.6);
          margin: 0;
          letter-spacing: 0.2em;
        }
        .quick-draw-wait-hint {
          font-size: 16px;
          color: #818cf8;
          margin: 8px 0 0 0;
          letter-spacing: 0.12em;
          animation: quick-draw-pulse 1.2s ease-in-out infinite;
        }

        .quick-draw-draw-text {
          font-size: 80px;
          font-weight: 900;
          color: #fef2f2;
          text-shadow: 0 0 40px rgba(255, 255, 255, 0.9), 0 0 80px rgba(239, 68, 68, 0.7);
          margin: 0;
          letter-spacing: 0.15em;
        }
        .quick-draw-draw-hint {
          font-size: 22px;
          font-weight: 700;
          color: #fecaca;
          margin: 4px 0 0 0;
          letter-spacing: 0.2em;
          animation: quick-draw-urgent-pulse 0.3s ease-in-out infinite;
        }

        .quick-draw-grade-text {
          font-size: 48px;
          font-weight: 900;
          margin: 0;
          letter-spacing: 0.06em;
        }
        .quick-draw-grade-perfect {
          color: #4ade80;
          text-shadow: 0 0 30px rgba(74, 222, 128, 0.8);
        }
        .quick-draw-grade-great {
          color: #60a5fa;
          text-shadow: 0 0 20px rgba(96, 165, 250, 0.6);
        }
        .quick-draw-grade-good {
          color: #fbbf24;
          text-shadow: 0 0 16px rgba(251, 191, 36, 0.5);
        }
        .quick-draw-grade-slow {
          color: #f87171;
          text-shadow: 0 0 12px rgba(248, 113, 113, 0.4);
        }
        .quick-draw-reaction-time {
          font-size: 36px;
          font-weight: 700;
          color: #e5e7eb;
          margin: 4px 0;
          font-variant-numeric: tabular-nums;
        }
        .quick-draw-round-score {
          font-size: 28px;
          font-weight: 800;
          color: #fbbf24;
          text-shadow: 0 2px 8px rgba(251, 191, 36, 0.5);
          margin: 0;
        }

        .quick-draw-early-text {
          font-size: 52px;
          font-weight: 900;
          color: #f472b6;
          text-shadow: 0 0 30px rgba(244, 114, 182, 0.7);
          margin: 0;
          letter-spacing: 0.06em;
        }
        .quick-draw-penalty-text {
          font-size: 36px;
          font-weight: 800;
          color: #fb7185;
          margin: 8px 0 0 0;
        }

        .quick-draw-gameover-title {
          font-size: 48px;
          font-weight: 900;
          color: #fef3c7;
          text-shadow: 0 4px 20px rgba(251, 191, 36, 0.4);
          margin: 0 0 12px 0;
          letter-spacing: 0.1em;
        }
        .quick-draw-gameover-score {
          font-size: 30px;
          font-weight: 700;
          color: #d6d3d1;
          margin: 0 0 8px 0;
        }
        .quick-draw-new-record {
          font-size: 22px;
          font-weight: 800;
          color: #fbbf24;
          text-shadow: 0 0 16px rgba(251, 191, 36, 0.7);
          margin: 8px 0 0 0;
          animation: quick-draw-record-bounce 0.6s ease-in-out infinite alternate;
        }

        .quick-draw-countdown-anim {
          animation: quick-draw-fade-in-scale 0.5s ease-out;
        }
        .quick-draw-waiting-anim {
          animation: quick-draw-fade-in 0.3s ease-out;
        }
        .quick-draw-draw-anim {
          animation: quick-draw-slam-in 0.12s ease-out;
        }
        .quick-draw-result-anim {
          animation: quick-draw-pop-in 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        .quick-draw-early-anim {
          animation: quick-draw-shake-in 0.35s ease-out;
        }
        .quick-draw-gameover-anim {
          animation: quick-draw-fade-in-scale 0.6s ease-out;
        }

        @keyframes quick-draw-fade-in-scale {
          0% { opacity: 0; transform: scale(0.7); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes quick-draw-fade-in {
          0% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes quick-draw-slam-in {
          0% { opacity: 0; transform: scale(3); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes quick-draw-pop-in {
          0% { opacity: 0; transform: scale(0.5) translateY(20px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes quick-draw-shake-in {
          0% { transform: translateX(-12px); opacity: 0; }
          20% { transform: translateX(10px); opacity: 1; }
          40% { transform: translateX(-8px); }
          60% { transform: translateX(6px); }
          80% { transform: translateX(-3px); }
          100% { transform: translateX(0); }
        }
        @keyframes quick-draw-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
        @keyframes quick-draw-urgent-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.05); }
        }
        @keyframes quick-draw-record-bounce {
          0% { transform: scale(1); }
          100% { transform: scale(1.1); }
        }

        .quick-draw-round-history {
          display: flex;
          gap: 6px;
          padding: 8px 16px;
          z-index: 2;
        }
        .quick-draw-history-dot {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          border: 2px solid rgba(255, 255, 255, 0.2);
          transition: all 0.3s ease;
        }
        .quick-draw-history-dot.pending {
          background: rgba(255, 255, 255, 0.08);
        }
        .quick-draw-history-dot.normal {
          background: #fbbf24;
          border-color: #f59e0b;
          box-shadow: 0 0 6px rgba(251, 191, 36, 0.4);
        }
        .quick-draw-history-dot.great {
          background: #60a5fa;
          border-color: #3b82f6;
          box-shadow: 0 0 8px rgba(96, 165, 250, 0.5);
        }
        .quick-draw-history-dot.perfect {
          background: #4ade80;
          border-color: #22c55e;
          box-shadow: 0 0 10px rgba(74, 222, 128, 0.6);
        }
        .quick-draw-history-dot.early {
          background: #f472b6;
          border-color: #ec4899;
          box-shadow: 0 0 8px rgba(244, 114, 182, 0.5);
        }

        .quick-draw-footer {
          padding: 8px 16px 16px 16px;
          z-index: 2;
        }
        .quick-draw-footer .text-button {
          pointer-events: auto;
        }
      `}</style>
    </section>
  )
}

export const quickDrawModule: MiniGameModule = {
  manifest: {
    id: 'quick-draw',
    title: 'Quick Draw',
    description: '서부의 결투사가 되어라! DRAW! 신호에 누구보다 빨리 탭!',
    unlockCost: 35,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#b45309',
  },
  Component: QuickDrawGame,
}
