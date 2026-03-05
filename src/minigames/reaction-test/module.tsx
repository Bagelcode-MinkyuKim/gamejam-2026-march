import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'

const TOTAL_ROUNDS = 8
const MIN_DELAY_MS = 1500
const MAX_DELAY_MS = 4500
const TOO_EARLY_DISPLAY_MS = 1200

// Lightning round: after round 5, delay window shrinks
const LIGHTNING_ROUND_START = 5
const LIGHTNING_MIN_DELAY_MS = 600
const LIGHTNING_MAX_DELAY_MS = 2000

// Streak: consecutive fast reactions get multiplier
const FAST_REACTION_THRESHOLD_MS = 250
const STREAK_MULTIPLIER_PER = 0.5

type Phase = 'waiting' | 'ready' | 'go' | 'too-early' | 'result' | 'finished'

function computeScore(avgMs: number): number {
  return Math.max(0, Math.round((500 - avgMs) * 5))
}

function randomDelay(round: number): number {
  if (round >= LIGHTNING_ROUND_START) {
    return LIGHTNING_MIN_DELAY_MS + Math.random() * (LIGHTNING_MAX_DELAY_MS - LIGHTNING_MIN_DELAY_MS)
  }
  return MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)
}

function ReactionTestGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [phase, setPhase] = useState<Phase>('waiting')
  const [currentRound, setCurrentRound] = useState(0)
  const [reactionTimes, setReactionTimes] = useState<number[]>([])
  const [lastReactionMs, setLastReactionMs] = useState<number | null>(null)
  const [finalScore, setFinalScore] = useState(0)
  const [fastStreak, setFastStreak] = useState(0)
  const [isLightning, setIsLightning] = useState(false)

  const effects = useGameEffects()

  const goTimestampRef = useRef(0)
  const delayTimerRef = useRef<number | null>(null)
  const tooEarlyTimerRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const startTimeRef = useRef(performance.now())
  const fastStreakRef = useRef(0)
  const currentRoundRef = useRef(0)

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

  const startRound = useCallback(() => {
    clearTimerSafe(delayTimerRef)
    clearTimerSafe(tooEarlyTimerRef)
    setPhase('ready')
    setLastReactionMs(null)

    const round = currentRoundRef.current
    const lightning = round >= LIGHTNING_ROUND_START
    setIsLightning(lightning)

    const delay = randomDelay(round)
    delayTimerRef.current = window.setTimeout(() => {
      delayTimerRef.current = null
      goTimestampRef.current = performance.now()
      setPhase('go')
    }, delay)
  }, [])

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    if (phase === 'waiting') {
      currentRoundRef.current = 1
      setCurrentRound(1)
      startRound()
      return
    }

    if (phase === 'ready') {
      clearTimerSafe(delayTimerRef)
      setPhase('too-early')
      playAudio(gameOverAudioRef, 0.5, 0.8)

      // Too early effect
      effects.triggerShake(5)
      effects.triggerFlash('rgba(249,115,22,0.4)')

      tooEarlyTimerRef.current = window.setTimeout(() => {
        tooEarlyTimerRef.current = null
        startRound()
      }, TOO_EARLY_DISPLAY_MS)
      return
    }

    if (phase === 'go') {
      const now = performance.now()
      const reactionMs = Math.round(now - goTimestampRef.current)
      const clampedMs = Math.min(reactionMs, 9999)
      setLastReactionMs(clampedMs)

      const nextTimes = [...reactionTimes, clampedMs]
      setReactionTimes(nextTimes)

      // Track fast reaction streak
      if (clampedMs <= FAST_REACTION_THRESHOLD_MS) {
        fastStreakRef.current += 1
      } else {
        fastStreakRef.current = 0
      }
      setFastStreak(fastStreakRef.current)

      // Streak multiplier for score popup
      const streakMult = 1 + fastStreakRef.current * STREAK_MULTIPLIER_PER
      const roundScore = Math.round((500 - Math.min(clampedMs, 500)) * streakMult)

      // Visual effects based on reaction speed
      if (clampedMs < 200) {
        playAudio(tapHitStrongAudioRef, 0.6, 1.1)
        effects.comboHitBurst(200, 300, fastStreakRef.current + 1, roundScore)
      } else if (clampedMs < 350) {
        playAudio(tapHitAudioRef, 0.5, 1.0)
        effects.triggerFlash('rgba(34,197,94,0.3)')
        effects.spawnParticles(4, 200, 300)
        effects.showScorePopup(roundScore, 200, 280, '#22c55e')
      } else {
        playAudio(tapHitAudioRef, 0.5, 1.0)
        effects.triggerFlash('rgba(255,255,255,0.2)', 60)
        effects.showScorePopup(roundScore, 200, 280, '#9ca3af')
      }

      if (nextTimes.length >= TOTAL_ROUNDS) {
        const avg = nextTimes.reduce((sum, t) => sum + t, 0) / nextTimes.length
        const score = computeScore(avg)
        // Bonus for overall streak performance
        const streakBonus = Math.round(fastStreakRef.current * 50)
        const totalScore = score + streakBonus
        setFinalScore(totalScore)
        setPhase('finished')
        finishedRef.current = true
        playAudio(gameOverAudioRef, 0.6, 1.0)
        effects.showScorePopup(totalScore, 200, 200, '#fbbf24')
      } else {
        setPhase('result')
        const nextRound = nextTimes.length + 1
        currentRoundRef.current = nextRound
        setCurrentRound(nextRound)

        delayTimerRef.current = window.setTimeout(() => {
          delayTimerRef.current = null
          startRound()
        }, 1500)
      }
      return
    }

    if (phase === 'result') {
      clearTimerSafe(delayTimerRef)
      startRound()
      return
    }
  }, [phase, reactionTimes, startRound, playAudio])

  const onFinishCalledRef = useRef(false)
  const handleFinish = useCallback(() => {
    if (onFinishCalledRef.current) return
    onFinishCalledRef.current = true
    const elapsed = Math.round(Math.max(16.66, performance.now() - startTimeRef.current))
    onFinish({ score: finalScore, durationMs: elapsed })
  }, [finalScore, onFinish])

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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
    const tapHit = new Audio(tapHitSfx)
    tapHit.preload = 'auto'
    tapHitAudioRef.current = tapHit

    const tapHitStrong = new Audio(tapHitStrongSfx)
    tapHitStrong.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrong

    const gameOver = new Audio(gameOverHitSfx)
    gameOver.preload = 'auto'
    gameOverAudioRef.current = gameOver

    startTimeRef.current = performance.now()

    return () => {
      clearTimerSafe(delayTimerRef)
      clearTimerSafe(tooEarlyTimerRef)
      effects.cleanup()
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  const avgReactionMs =
    reactionTimes.length > 0
      ? Math.round(reactionTimes.reduce((sum, t) => sum + t, 0) / reactionTimes.length)
      : 0

  const phaseColor =
    phase === 'go'
      ? '#16a34a'
      : phase === 'ready'
        ? '#dc2626'
        : phase === 'too-early'
          ? '#f97316'
          : '#4b5563'

  const phaseLabel =
    phase === 'waiting'
      ? 'TAP TO START'
      : phase === 'ready'
        ? 'WAIT...'
        : phase === 'go'
          ? 'TAP NOW!'
          : phase === 'too-early'
            ? 'TOO EARLY!'
            : phase === 'result'
              ? `${lastReactionMs}ms`
              : ''

  if (phase === 'finished') {
    return (
      <section className="mini-game-panel reaction-test-panel" aria-label="reaction-test-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative' }}>
        <style>{GAME_EFFECTS_CSS}</style>
        <ParticleRenderer particles={effects.particles} />
        <ScorePopupRenderer popups={effects.scorePopups} />

        <div className="reaction-test-header">
          <p className="reaction-test-title">RESULT</p>
        </div>

        <div className="reaction-test-final-area">
          <div className="reaction-test-times-list">
            {reactionTimes.map((time, index) => (
              <div className="reaction-test-time-row" key={`round-${index}`}>
                <span className="reaction-test-round-label">Round {index + 1}</span>
                <span
                  className={`reaction-test-round-time ${time < 200 ? 'fast' : time < 350 ? 'good' : 'slow'}`}
                >
                  {time}ms
                </span>
              </div>
            ))}
          </div>

          <div className="reaction-test-avg-block">
            <p className="reaction-test-avg-label">Average</p>
            <p className="reaction-test-avg-value">{avgReactionMs}ms</p>
          </div>

          <div className="reaction-test-score-block">
            <p className="reaction-test-score-label">SCORE</p>
            <p className="reaction-test-score-value">{finalScore.toLocaleString()}</p>
            {finalScore > bestScore && bestScore > 0 && (
              <p className="reaction-test-new-best">NEW BEST!</p>
            )}
            {bestScore > 0 && (
              <p className="reaction-test-best">BEST {bestScore.toLocaleString()}</p>
            )}
          </div>

          <div className="reaction-test-final-actions">
            <button className="reaction-test-finish-button" type="button" onClick={handleFinish}>
              Complete
            </button>
            <button className="text-button" type="button" onClick={handleExit}>
              Exit
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="mini-game-panel reaction-test-panel" aria-label="reaction-test-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="reaction-test-header">
        <p className="reaction-test-round-indicator">
          {phase === 'waiting' ? 'Ready?' : `Round ${currentRound} / ${TOTAL_ROUNDS}`}
          {isLightning && <span style={{ color: '#fbbf24', marginLeft: '6px', fontWeight: 800 }}>LIGHTNING</span>}
        </p>
        {bestScore > 0 && (
          <p className="reaction-test-best-inline">BEST {bestScore.toLocaleString()}</p>
        )}
        {fastStreak > 0 && (
          <p style={{ textAlign: 'center', fontSize: '13px', color: '#f59e0b', margin: '2px 0', fontWeight: 700 }}>
            Fast Streak x{fastStreak} (x{(1 + fastStreak * STREAK_MULTIPLIER_PER).toFixed(1)})
          </p>
        )}
      </div>

      {reactionTimes.length > 0 && (
        <div className="reaction-test-progress-bar">
          {reactionTimes.map((time, index) => (
            <span
              className={`reaction-test-pip ${time < 200 ? 'fast' : time < 350 ? 'good' : 'slow'}`}
              key={`pip-${index}`}
            >
              {time}ms
            </span>
          ))}
          {Array.from({ length: TOTAL_ROUNDS - reactionTimes.length }).map((_, index) => (
            <span className="reaction-test-pip empty" key={`empty-${index}`}>
              ---
            </span>
          ))}
        </div>
      )}

      <button
        className="reaction-test-tap-area"
        type="button"
        onClick={handleTap}
        style={{ backgroundColor: phaseColor }}
        disabled={phase === 'too-early'}
      >
        <img
          src={kimYeonjaImage}
          alt="김연자"
          style={{
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            border: '4px solid rgba(255,255,255,0.7)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
            pointerEvents: 'none',
            marginBottom: '8px',
          }}
        />
        <span className="reaction-test-phase-label">{phaseLabel}</span>
        {phase === 'result' && lastReactionMs !== null && (
          <span className="reaction-test-sub-label">
            {lastReactionMs < 200
              ? 'Lightning fast!'
              : lastReactionMs < 300
                ? 'Great!'
                : lastReactionMs < 400
                  ? 'Good'
                  : 'Keep trying!'}
          </span>
        )}
        {phase === 'ready' && (
          <span className="reaction-test-sub-label">Wait for green...</span>
        )}
        {phase === 'too-early' && (
          <span className="reaction-test-sub-label">Wait for the green screen!</span>
        )}
        {phase === 'waiting' && (
          <span className="reaction-test-sub-label">Tap anywhere to begin</span>
        )}
      </button>

      <button className="text-button" type="button" onClick={handleExit}>
        Exit
      </button>
    </section>
  )
}

export const reactionTestModule: MiniGameModule = {
  manifest: {
    id: 'reaction-test',
    title: 'Reaction Test',
    description: 'Tap when green! 5 rounds, average reaction time determines your score!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#16a34a',
  },
  Component: ReactionTestGame,
}
