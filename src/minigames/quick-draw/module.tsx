import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import seoTaijiImg from '../../../assets/images/same-character/seo-taiji.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import readySfx from '../../../assets/sounds/quick-draw-ready.mp3'
import bangSfx from '../../../assets/sounds/quick-draw-bang.mp3'
import perfectSfx from '../../../assets/sounds/quick-draw-perfect.mp3'
import missSfx from '../../../assets/sounds/quick-draw-miss.mp3'
import comboSfx from '../../../assets/sounds/quick-draw-combo.mp3'
import recordSfx from '../../../assets/sounds/quick-draw-record.mp3'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const TOTAL_ROUNDS = 10
const BASE_MIN_WAIT_MS = 1200
const BASE_MAX_WAIT_MS = 4500
const PERFECT_THRESHOLD_MS = 150
const GREAT_THRESHOLD_MS = 250
const GOOD_THRESHOLD_MS = 400
const EARLY_TAP_PENALTY = -100
const MAX_REACTION_SCORE = 1000
const COUNTDOWN_DISPLAY_MS = 1500
const RESULT_DISPLAY_MS = 1500
const GAME_OVER_DISPLAY_MS = 2800
const COMBO_THRESHOLD_MS = GOOD_THRESHOLD_MS
const STREAK_BONUS_THRESHOLD = 3
const STREAK_BONUS_MULTIPLIER = 0.15
const GOLDEN_ROUND_CHANCE = 0.2
const GOLDEN_MULTIPLIER = 2
const DIFFICULTY_SCALE_PER_ROUND = 0.06

type RoundPhase = 'countdown' | 'waiting' | 'draw' | 'result' | 'too-early' | 'game-over'

interface RoundResult {
  readonly reactionMs: number
  readonly score: number
  readonly tooEarly: boolean
  readonly golden: boolean
}

function randomWaitMs(round: number): number {
  const scale = 1 - Math.min(0.4, (round - 1) * DIFFICULTY_SCALE_PER_ROUND)
  const min = BASE_MIN_WAIT_MS * scale
  const max = BASE_MAX_WAIT_MS * scale
  return min + Math.random() * (max - min)
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

const WAIT_MESSAGES = ['Hold...', 'Steady...', 'Wait...', 'Not yet...', 'Easy...'] as const

function QuickDrawGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [phase, setPhase] = useState<RoundPhase>('countdown')
  const [round, setRound] = useState(1)
  const [totalScore, setTotalScore] = useState(0)
  const [lastReactionMs, setLastReactionMs] = useState<number | null>(null)
  const [lastRoundScore, setLastRoundScore] = useState<number | null>(null)
  const [roundResults, setRoundResults] = useState<RoundResult[]>([])
  const [waitText, setWaitText] = useState('')
  const [screenFlash, setScreenFlash] = useState('')
  const [combo, setCombo] = useState(0)
  const [streakBonus, setStreakBonus] = useState(0)
  const [showCrosshair, setShowCrosshair] = useState(false)
  const [muzzleFlash, setMuzzleFlash] = useState(false)
  const [vignetteColor, setVignetteColor] = useState('')
  const [bestReaction, setBestReaction] = useState(9999)
  const [waitProgress, setWaitProgress] = useState(0)
  const [isGoldenRound, setIsGoldenRound] = useState(false)
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [showDoubleTap, setShowDoubleTap] = useState(false)

  const phaseRef = useRef<RoundPhase>('countdown')
  const roundRef = useRef(1)
  const totalScoreRef = useRef(0)
  const drawTimestampRef = useRef(0)
  const waitTimerRef = useRef<number | null>(null)
  const resultTimerRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const startTimeRef = useRef(performance.now())
  const roundResultsRef = useRef<RoundResult[]>([])
  const comboRef = useRef(0)
  const waitStartRef = useRef(0)
  const waitDurationRef = useRef(0)
  const waitAnimRef = useRef<number | null>(null)
  const isGoldenRef = useRef(false)
  const perfectStreakRef = useRef(0)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const clearTimerSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (audio === null || audio === undefined) return
    audio.currentTime = 0
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const animateWaitProgress = useCallback(() => {
    const now = performance.now()
    const elapsed = now - waitStartRef.current
    const progress = Math.min(1, elapsed / waitDurationRef.current)
    setWaitProgress(progress)
    if (progress < 1 && phaseRef.current === 'waiting') {
      waitAnimRef.current = requestAnimationFrame(animateWaitProgress)
    }
  }, [])

  const transitionToWaiting = useCallback(() => {
    const msg = WAIT_MESSAGES[Math.floor(Math.random() * WAIT_MESSAGES.length)]
    setWaitText(msg)
    phaseRef.current = 'waiting'
    setPhase('waiting')
    setScreenFlash('')
    setLastReactionMs(null)
    setLastRoundScore(null)
    setStreakBonus(0)
    setShowCrosshair(false)
    setMuzzleFlash(false)
    setVignetteColor('')
    setWaitProgress(0)
    setShowDoubleTap(false)

    const golden = Math.random() < GOLDEN_ROUND_CHANCE
    isGoldenRef.current = golden
    setIsGoldenRound(golden)

    playAudio('ready', 0.4, 0.9 + Math.random() * 0.2)

    const delay = randomWaitMs(roundRef.current)
    waitStartRef.current = performance.now()
    waitDurationRef.current = delay
    waitAnimRef.current = requestAnimationFrame(animateWaitProgress)

    waitTimerRef.current = window.setTimeout(() => {
      waitTimerRef.current = null
      if (waitAnimRef.current !== null) {
        cancelAnimationFrame(waitAnimRef.current)
        waitAnimRef.current = null
      }
      drawTimestampRef.current = performance.now()
      phaseRef.current = 'draw'
      setPhase('draw')
      setScreenFlash('draw-flash')
      setShowCrosshair(true)
      setWaitProgress(1)
      playAudio('bang', 0.8, golden ? 1.2 : 1.0 + Math.random() * 0.15)
    }, delay)
  }, [playAudio, animateWaitProgress])

  const advanceRound = useCallback(() => {
    const nextRound = roundRef.current + 1
    if (nextRound > TOTAL_ROUNDS) {
      phaseRef.current = 'game-over'
      setPhase('game-over')
      setScreenFlash('game-over-flash')
      setShowCrosshair(false)
      playAudio('gameover', 0.7, 0.95)

      if (totalScoreRef.current > bestScore) {
        setTimeout(() => playAudio('record', 0.6), 600)
      }

      resultTimerRef.current = window.setTimeout(() => {
        resultTimerRef.current = null
        if (finishedRef.current) return
        finishedRef.current = true
        const elapsedMs = Math.max(Math.round(performance.now() - startTimeRef.current), 1000)
        onFinish({ score: totalScoreRef.current, durationMs: elapsedMs })
      }, GAME_OVER_DISPLAY_MS)
      return
    }

    roundRef.current = nextRound
    setRound(nextRound)
    transitionToWaiting()
  }, [onFinish, playAudio, transitionToWaiting, bestScore])

  const showResult = useCallback(
    (reactionMs: number, score: number, tooEarly: boolean) => {
      let finalScore = score
      let bonusPct = 0
      const golden = isGoldenRef.current

      if (golden && !tooEarly && score > 0) {
        finalScore = score * GOLDEN_MULTIPLIER
      }

      if (!tooEarly && reactionMs <= COMBO_THRESHOLD_MS) {
        const newCombo = comboRef.current + 1
        comboRef.current = newCombo
        setCombo(newCombo)

        if (newCombo >= STREAK_BONUS_THRESHOLD) {
          bonusPct = Math.min(1.0, (newCombo - STREAK_BONUS_THRESHOLD + 1) * STREAK_BONUS_MULTIPLIER)
          const bonus = Math.round(finalScore * bonusPct)
          finalScore = finalScore + bonus
          setStreakBonus(bonus)
          playAudio('combo', 0.5, 0.9 + newCombo * 0.05)
        }
      } else {
        comboRef.current = 0
        setCombo(0)
      }

      if (!tooEarly && reactionMs <= PERFECT_THRESHOLD_MS) {
        perfectStreakRef.current += 1
        setPerfectStreak(perfectStreakRef.current)
        if (perfectStreakRef.current >= 2) {
          setShowDoubleTap(true)
        }
      } else {
        perfectStreakRef.current = 0
        setPerfectStreak(0)
      }

      const result: RoundResult = { reactionMs, score: finalScore, tooEarly, golden }
      roundResultsRef.current = [...roundResultsRef.current, result]
      setRoundResults(roundResultsRef.current)

      const nextTotal = totalScoreRef.current + finalScore
      totalScoreRef.current = nextTotal
      setTotalScore(nextTotal)
      setLastReactionMs(tooEarly ? null : reactionMs)
      setLastRoundScore(finalScore)

      if (!tooEarly && reactionMs < bestReaction) {
        setBestReaction(reactionMs)
      }

      phaseRef.current = 'result'
      setPhase(tooEarly ? 'too-early' : 'result')

      if (tooEarly) {
        setScreenFlash('early-flash')
        setVignetteColor('rgba(244,114,182,0.4)')
        effects.triggerShake(10)
        effects.triggerFlash('rgba(244,114,182,0.35)')
        playAudio('miss', 0.6)
      } else if (finalScore >= 850) {
        setScreenFlash('perfect-flash')
        setMuzzleFlash(true)
        setVignetteColor(golden ? 'rgba(251,191,36,0.3)' : 'rgba(74,222,128,0.25)')
        effects.comboHitBurst(200, 300, comboRef.current, finalScore, golden ? ['🌟', '💰', '🔥', '💎', '👑'] : ['🎯', '🔥', '⚡', '💥', '🌟', '💎'])
        effects.triggerShake(golden ? 10 : 6)
        playAudio('perfect', 0.7, golden ? 1.15 : 1.0)
        setTimeout(() => setMuzzleFlash(false), 200)
      } else if (finalScore >= 600) {
        setScreenFlash('result-flash')
        setMuzzleFlash(true)
        effects.spawnParticles(6, 200, 280, ['✨', '💫', '⭐', '🎯'])
        effects.showScorePopup(finalScore, 200, 260)
        effects.triggerShake(3)
        playAudio('tap', 0.6, 1.1)
        setTimeout(() => setMuzzleFlash(false), 150)
      } else {
        setScreenFlash('result-flash')
        effects.spawnParticles(3, 200, 300)
        effects.showScorePopup(finalScore, 200, 280)
        playAudio('tap', 0.5, 0.9)
      }

      resultTimerRef.current = window.setTimeout(() => {
        resultTimerRef.current = null
        setVignetteColor('')
        advanceRound()
      }, RESULT_DISPLAY_MS)
    },
    [advanceRound, effects, playAudio, bestReaction],
  )

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    const currentPhase = phaseRef.current
    if (currentPhase === 'countdown' || currentPhase === 'result' || currentPhase === 'too-early' || currentPhase === 'game-over') {
      return
    }

    if (currentPhase === 'waiting') {
      clearTimerSafe(waitTimerRef)
      if (waitAnimRef.current !== null) {
        cancelAnimationFrame(waitAnimRef.current)
        waitAnimRef.current = null
      }
      showResult(0, EARLY_TAP_PENALTY, true)
      return
    }

    if (currentPhase === 'draw') {
      const now = performance.now()
      const reactionMs = Math.min(now - drawTimestampRef.current, MAX_REACTION_SCORE)
      const score = reactionToScore(reactionMs)
      showResult(Math.round(reactionMs), score, false)
    }
  }, [showResult])

  const handleExit = useCallback(() => {
    clearTimerSafe(waitTimerRef)
    clearTimerSafe(resultTimerRef)
    if (waitAnimRef.current !== null) {
      cancelAnimationFrame(waitAnimRef.current)
      waitAnimRef.current = null
    }
    onExit()
  }, [onExit])

  useEffect(() => {
    const sfxMap: Record<string, string> = {
      ready: readySfx, bang: bangSfx, perfect: perfectSfx, miss: missSfx,
      combo: comboSfx, record: recordSfx, tap: tapHitSfx, gameover: gameOverHitSfx,
    }
    for (const [key, src] of Object.entries(sfxMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }
    return () => {
      clearTimerSafe(waitTimerRef)
      clearTimerSafe(resultTimerRef)
      if (waitAnimRef.current !== null) cancelAnimationFrame(waitAnimRef.current)
      audioRefs.current = {}
    }
  }, [])

  useEffect(() => {
    startTimeRef.current = performance.now()
    const countdownTimer = window.setTimeout(() => transitionToWaiting(), COUNTDOWN_DISPLAY_MS)
    return () => { window.clearTimeout(countdownTimer) }
  }, [transitionToWaiting])

  useEffect(() => {
    const interval = window.setInterval(() => { effects.updateParticles() }, 50)
    return () => { window.clearInterval(interval); effects.cleanup() }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.code === 'Escape') { event.preventDefault(); handleExit(); return }
      if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); handleTap() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [handleTap, handleExit])

  const displayedBestScore = Math.max(bestScore, totalScore)
  const isDrawPhase = phase === 'draw'
  const isWaiting = phase === 'waiting'
  const isTooEarly = phase === 'too-early'
  const isGameOver = phase === 'game-over'
  const isCountdown = phase === 'countdown'
  const isResult = phase === 'result'

  const bgClass = isDrawPhase
    ? (isGoldenRound ? 'qd-bg-golden-draw' : 'qd-bg-draw')
    : isWaiting ? (isGoldenRound ? 'qd-bg-golden-wait' : 'qd-bg-waiting')
    : isTooEarly ? 'qd-bg-early'
    : isGameOver ? 'qd-bg-gameover'
    : isResult && lastRoundScore !== null && lastRoundScore >= 850 ? 'qd-bg-perfect'
    : 'qd-bg-default'

  const successResults = roundResults.filter(r => !r.tooEarly)
  const avgReaction = successResults.length > 0
    ? Math.round(successResults.reduce((s, r) => s + r.reactionMs, 0) / successResults.length)
    : 0

  return (
    <section
      className={`qd-panel ${bgClass} ${screenFlash}`}
      aria-label="quick-draw-game"
      style={{ ...effects.getShakeStyle() }}
      onClick={handleTap}
      onTouchStart={(e) => { e.preventDefault(); handleTap() }}
    >
      {vignetteColor && (
        <div className="qd-vignette" style={{ boxShadow: `inset 0 0 80px 40px ${vignetteColor}` }} />
      )}
      {muzzleFlash && <div className="qd-muzzle-flash" />}

      {/* HUD */}
      <div className="qd-hud">
        <div className="qd-hud-left">
          <p className="qd-round-label">
            ROUND <strong>{Math.min(round, TOTAL_ROUNDS)}</strong>/{TOTAL_ROUNDS}
          </p>
          {combo >= STREAK_BONUS_THRESHOLD && (
            <p className="qd-combo-badge">{combo}x COMBO</p>
          )}
        </div>
        <div className="qd-hud-center">
          <p className="qd-total-score">{totalScore.toLocaleString()}</p>
        </div>
        <div className="qd-hud-right">
          <p className="qd-best-score">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
      </div>

      {/* Tension bar */}
      {isWaiting && (
        <div className="qd-tension-bar-wrap">
          <div className={`qd-tension-bar ${isGoldenRound ? 'qd-tension-golden' : ''}`} style={{ width: `${waitProgress * 100}%` }} />
        </div>
      )}

      {/* Golden round indicator */}
      {isGoldenRound && (isWaiting || isDrawPhase) && (
        <div className="qd-golden-badge">x{GOLDEN_MULTIPLIER} GOLDEN</div>
      )}

      {/* Main arena */}
      <div className="qd-arena">
        <img
          src={seoTaijiImg}
          alt="gunslinger"
          className={`qd-mascot ${isDrawPhase ? 'qd-mascot-draw' : isWaiting ? 'qd-mascot-waiting' : ''}`}
          draggable={false}
        />

        {showCrosshair && (
          <div className={`qd-crosshair ${isDrawPhase ? 'qd-crosshair-active' : ''}`}>
            <div className="qd-crosshair-h" />
            <div className="qd-crosshair-v" />
            <div className="qd-crosshair-dot" />
            <div className="qd-crosshair-ring" />
          </div>
        )}

        {/* Center content — uses inset:0 + flex to avoid transform conflicts */}
        <div className="qd-center-wrap">
          {isCountdown && (
            <div className="qd-anim-fade-scale">
              <p className="qd-title-text">QUICK DRAW</p>
              <p className="qd-subtitle-text">Get Ready...</p>
            </div>
          )}

          {isWaiting && (
            <div className="qd-anim-fade">
              <p className="qd-wait-text">{waitText}</p>
              <p className="qd-wait-hint">Don't tap yet...</p>
            </div>
          )}

          {isDrawPhase && (
            <div className="qd-anim-slam">
              <p className="qd-draw-text">DRAW!</p>
              <p className="qd-draw-hint">TAP NOW!</p>
            </div>
          )}

          {isResult && lastReactionMs !== null && lastRoundScore !== null && (
            <div className="qd-anim-pop">
              <p className={`qd-grade-text qd-grade-${reactionToGradeClass(lastReactionMs)}`}>
                {reactionToGrade(lastReactionMs)}
              </p>
              <p className="qd-reaction-time">{lastReactionMs} ms</p>
              <p className="qd-round-score">+{lastRoundScore}</p>
              {isGoldenRound && <p className="qd-golden-score-tag">GOLDEN x{GOLDEN_MULTIPLIER}</p>}
              {streakBonus > 0 && <p className="qd-streak-bonus">COMBO +{streakBonus}</p>}
              {showDoubleTap && perfectStreak >= 2 && <p className="qd-perfect-streak">{perfectStreak}x PERFECT STREAK</p>}
            </div>
          )}

          {isTooEarly && (
            <div className="qd-anim-shake">
              <p className="qd-early-text">TOO EARLY!</p>
              <p className="qd-penalty-text">{EARLY_TAP_PENALTY}</p>
            </div>
          )}

          {isGameOver && (
            <div className="qd-anim-fade-scale">
              <p className="qd-gameover-title">GAME OVER</p>
              <p className="qd-gameover-score">TOTAL: {totalScore.toLocaleString()}</p>
              {avgReaction > 0 && <p className="qd-gameover-stat">AVG: {avgReaction}ms</p>}
              {bestReaction < 9999 && <p className="qd-gameover-stat">FASTEST: {bestReaction}ms</p>}
              <p className="qd-gameover-stat">COMBOS: {roundResults.filter(r => !r.tooEarly && r.score >= 600).length}/{TOTAL_ROUNDS}</p>
              {totalScore > bestScore && <p className="qd-new-record">NEW RECORD!</p>}
            </div>
          )}
        </div>
      </div>

      {/* Round history */}
      <div className="qd-round-history">
        {roundResults.map((result, index) => (
          <div
            className={`qd-dot ${result.tooEarly ? 'early' : result.score >= 850 ? 'perfect' : result.score >= 600 ? 'great' : 'normal'} ${result.golden ? 'golden' : ''}`}
            key={`round-${index}`}
            title={result.tooEarly ? 'Too early!' : `${result.reactionMs}ms (+${result.score})${result.golden ? ' GOLDEN' : ''}`}
          />
        ))}
        {Array.from({ length: TOTAL_ROUNDS - roundResults.length }, (_, index) => (
          <div className="qd-dot pending" key={`pending-${index}`} />
        ))}
      </div>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="qd-footer">
        <button className="text-button" type="button" onClick={(e) => { e.stopPropagation(); handleExit() }}>
          Exit
        </button>
      </div>

      <style>{GAME_EFFECTS_CSS}{`
        .qd-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          width: 100%;
          height: 100%;
          max-width: 432px;
          margin: 0 auto;
          user-select: none;
          cursor: pointer;
          transition: background-color 0.15s ease;
          overflow: hidden;
          position: relative;
          aspect-ratio: 9/16;
        }

        .qd-bg-default { background: linear-gradient(180deg, #1a1207 0%, #2d1f0e 40%, #3d2a14 70%, #1a1207 100%); }
        .qd-bg-waiting { background: linear-gradient(180deg, #0a0a1a 0%, #0f0f2e 40%, #141438 70%, #0a0a1a 100%); }
        .qd-bg-draw { background: linear-gradient(180deg, #7f1d1d 0%, #dc2626 35%, #b91c1c 60%, #991b1b 100%); }
        .qd-bg-early { background: linear-gradient(180deg, #4a1942 0%, #6b2158 40%, #831843 70%, #4a1942 100%); }
        .qd-bg-perfect { background: linear-gradient(180deg, #052e16 0%, #14532d 35%, #166534 60%, #052e16 100%); }
        .qd-bg-gameover { background: linear-gradient(180deg, #0c0a09 0%, #1c1917 40%, #292524 70%, #0c0a09 100%); }
        .qd-bg-golden-wait { background: linear-gradient(180deg, #1a1500 0%, #2d2400 40%, #3d3200 70%, #1a1500 100%); }
        .qd-bg-golden-draw { background: linear-gradient(180deg, #7f5d00 0%, #d4a017 35%, #b8860b 60%, #8b6914 100%); }

        .draw-flash { animation: qd-flash-red 0.25s ease-out; }
        .early-flash { animation: qd-flash-purple 0.4s ease-out; }
        .perfect-flash { animation: qd-flash-green 0.35s ease-out; }
        .result-flash { animation: qd-flash-amber 0.2s ease-out; }
        .game-over-flash { animation: qd-flash-white 0.5s ease-out; }

        @keyframes qd-flash-red { 0% { filter: brightness(3) saturate(1.5); } 100% { filter: brightness(1) saturate(1); } }
        @keyframes qd-flash-purple { 0% { filter: brightness(2) hue-rotate(20deg); } 100% { filter: brightness(1) hue-rotate(0deg); } }
        @keyframes qd-flash-green { 0% { filter: brightness(2.5) saturate(1.3); } 100% { filter: brightness(1) saturate(1); } }
        @keyframes qd-flash-amber { 0% { filter: brightness(1.5); } 100% { filter: brightness(1); } }
        @keyframes qd-flash-white { 0% { filter: brightness(3.5); } 40% { filter: brightness(1.5); } 100% { filter: brightness(1); } }

        .qd-vignette {
          position: absolute; inset: 0; pointer-events: none; z-index: 5;
          animation: qd-vignette-pulse 0.6s ease-out;
        }
        @keyframes qd-vignette-pulse { 0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0.7; } }

        .qd-muzzle-flash {
          position: absolute; top: 40%; left: 50%; width: 180px; height: 180px;
          transform: translate(-50%, -50%); border-radius: 50%;
          background: radial-gradient(circle, rgba(255,240,200,0.95) 0%, rgba(255,180,60,0.6) 35%, transparent 70%);
          pointer-events: none; z-index: 4;
          animation: qd-muzzle-burst 0.2s ease-out forwards;
        }
        @keyframes qd-muzzle-burst {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(0.3); }
          50% { opacity: 0.8; transform: translate(-50%, -50%) scale(1.3); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.6); }
        }

        .qd-hud {
          display: flex; align-items: flex-start; justify-content: space-between;
          width: 100%; padding: 16px 16px 8px 16px; z-index: 3; flex-shrink: 0;
        }
        .qd-hud-left, .qd-hud-right { flex: 1; }
        .qd-hud-center { flex: 1; text-align: center; }
        .qd-hud-right { text-align: right; }
        .qd-round-label { font-size: 15px; color: #d4a574; letter-spacing: 0.05em; margin: 0; }
        .qd-round-label strong { font-size: 22px; color: #fbbf24; }
        .qd-combo-badge {
          display: inline-block; margin: 6px 0 0 0; padding: 3px 12px; border-radius: 12px;
          background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff;
          font-size: 13px; font-weight: 800; letter-spacing: 0.06em;
          animation: qd-combo-pulse 0.5s ease-in-out infinite alternate;
        }
        @keyframes qd-combo-pulse { 0% { transform: scale(1); } 100% { transform: scale(1.1); filter: brightness(1.2); } }
        .qd-total-score {
          font-size: clamp(34px, 9vw, 44px); font-weight: 900; color: #fef3c7;
          text-shadow: 0 2px 12px rgba(251,191,36,0.6); margin: 0; letter-spacing: 0.02em;
        }
        .qd-best-score { font-size: 13px; color: #a8a29e; margin: 0; }

        .qd-tension-bar-wrap {
          width: calc(100% - 32px); height: 5px; background: rgba(255,255,255,0.08);
          border-radius: 3px; overflow: hidden; flex-shrink: 0; z-index: 3;
        }
        .qd-tension-bar {
          height: 100%; background: linear-gradient(90deg, #6366f1 0%, #a855f7 50%, #ef4444 100%);
          border-radius: 3px; transition: width 0.05s linear;
        }
        .qd-tension-golden {
          background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 50%, #ef4444 100%);
          box-shadow: 0 0 8px rgba(251,191,36,0.6);
        }

        .qd-golden-badge {
          padding: 4px 16px; border-radius: 16px; margin-top: 6px;
          background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #451a03;
          font-size: 14px; font-weight: 900; letter-spacing: 0.1em; z-index: 3;
          animation: qd-golden-pulse 0.6s ease-in-out infinite alternate;
          box-shadow: 0 0 16px rgba(251,191,36,0.5);
        }
        @keyframes qd-golden-pulse {
          0% { transform: scale(1); box-shadow: 0 0 12px rgba(251,191,36,0.4); }
          100% { transform: scale(1.06); box-shadow: 0 0 24px rgba(251,191,36,0.8); }
        }

        .qd-arena {
          flex: 1; display: flex; align-items: center; justify-content: center;
          width: 100%; z-index: 2; position: relative; min-height: 0;
        }

        /* FIX: center-wrap uses inset+flex instead of transform to avoid animation conflicts */
        .qd-center-wrap {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          text-align: center; z-index: 2; pointer-events: none;
          padding: 0 16px; box-sizing: border-box;
        }

        .qd-mascot {
          position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
          height: 88%; max-height: 450px; object-fit: contain; opacity: 0.15;
          pointer-events: none; filter: sepia(0.6) brightness(0.7); z-index: 0;
          transition: opacity 0.3s ease, filter 0.3s ease;
        }
        .qd-mascot-draw {
          opacity: 0.35; filter: sepia(0.3) brightness(1) saturate(1.2);
          animation: qd-mascot-flash 0.15s ease-out;
        }
        .qd-mascot-waiting { animation: qd-mascot-breathe 3s ease-in-out infinite; }
        @keyframes qd-mascot-flash { 0% { transform: translateX(-50%) scale(1.06); } 100% { transform: translateX(-50%) scale(1); } }
        @keyframes qd-mascot-breathe { 0%, 100% { transform: translateX(-50%) scale(1); } 50% { transform: translateX(-50%) scale(1.02); } }

        .qd-crosshair {
          position: absolute; top: 38%; left: 50%; width: 120px; height: 120px;
          transform: translate(-50%, -50%); pointer-events: none; z-index: 3;
          animation: qd-crosshair-appear 0.12s ease-out;
        }
        .qd-crosshair-active { animation: qd-crosshair-appear 0.12s ease-out, qd-crosshair-spin 2s linear infinite; }
        .qd-crosshair-h, .qd-crosshair-v { position: absolute; background: rgba(255,60,60,0.85); }
        .qd-crosshair-h { top: 50%; left: 8%; right: 8%; height: 2px; transform: translateY(-50%); }
        .qd-crosshair-v { left: 50%; top: 8%; bottom: 8%; width: 2px; transform: translateX(-50%); }
        .qd-crosshair-dot {
          position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; border-radius: 50%;
          background: #ff3c3c; transform: translate(-50%, -50%);
          box-shadow: 0 0 14px rgba(255,60,60,0.9);
        }
        .qd-crosshair-ring {
          position: absolute; top: 50%; left: 50%; width: 60px; height: 60px;
          border: 2px solid rgba(255,60,60,0.6); border-radius: 50%;
          transform: translate(-50%, -50%);
        }
        @keyframes qd-crosshair-appear { 0% { opacity: 0; transform: translate(-50%, -50%) scale(3); } 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
        @keyframes qd-crosshair-spin { 0% { transform: translate(-50%, -50%) rotate(0deg); } 100% { transform: translate(-50%, -50%) rotate(360deg); } }

        .qd-title-text {
          font-size: clamp(52px, 14vw, 68px); font-weight: 900; color: #fbbf24;
          text-shadow: 0 4px 20px rgba(251,191,36,0.7), 0 0 60px rgba(251,191,36,0.3);
          margin: 0 0 10px 0; letter-spacing: 0.1em;
        }
        .qd-subtitle-text { font-size: clamp(22px, 6vw, 28px); color: #d4a574; margin: 0; letter-spacing: 0.12em; }

        .qd-wait-text {
          font-size: clamp(44px, 12vw, 56px); font-weight: 900; color: #818cf8;
          text-shadow: 0 0 30px rgba(129,140,248,0.6); margin: 0; letter-spacing: 0.1em;
        }
        .qd-wait-hint { font-size: 18px; color: #6366f1; margin: 10px 0 0 0; letter-spacing: 0.12em; animation: qd-pulse 1.5s ease-in-out infinite; }

        .qd-draw-text {
          font-size: clamp(88px, 24vw, 120px); font-weight: 900; color: #fef2f2;
          text-shadow: 0 0 50px rgba(255,255,255,0.95), 0 0 100px rgba(239,68,68,0.8), 0 0 150px rgba(239,68,68,0.4);
          margin: 0; letter-spacing: 0.2em;
        }
        .qd-draw-hint {
          font-size: clamp(24px, 7vw, 32px); font-weight: 700; color: #fecaca;
          margin: 6px 0 0 0; letter-spacing: 0.25em; animation: qd-urgent-pulse 0.25s ease-in-out infinite;
        }

        .qd-grade-text { font-size: clamp(52px, 14vw, 70px); font-weight: 900; margin: 0; letter-spacing: 0.06em; }
        .qd-grade-perfect { color: #4ade80; text-shadow: 0 0 40px rgba(74,222,128,0.9), 0 0 80px rgba(74,222,128,0.4); }
        .qd-grade-great { color: #60a5fa; text-shadow: 0 0 30px rgba(96,165,250,0.7); }
        .qd-grade-good { color: #fbbf24; text-shadow: 0 0 20px rgba(251,191,36,0.6); }
        .qd-grade-slow { color: #f87171; text-shadow: 0 0 16px rgba(248,113,113,0.4); }

        .qd-reaction-time {
          font-size: clamp(40px, 11vw, 52px); font-weight: 700; color: #e5e7eb;
          margin: 4px 0; font-variant-numeric: tabular-nums; text-shadow: 0 2px 8px rgba(0,0,0,0.4);
        }
        .qd-round-score {
          font-size: clamp(32px, 9vw, 42px); font-weight: 800; color: #fbbf24;
          text-shadow: 0 2px 12px rgba(251,191,36,0.6); margin: 0;
        }
        .qd-golden-score-tag {
          font-size: 16px; font-weight: 800; color: #fbbf24; margin: 4px 0 0 0;
          text-shadow: 0 0 12px rgba(251,191,36,0.8); letter-spacing: 0.1em;
        }
        .qd-streak-bonus {
          font-size: 20px; font-weight: 800; color: #f97316;
          text-shadow: 0 0 12px rgba(249,115,22,0.7); margin: 6px 0 0 0;
          animation: qd-bonus-pop 0.3s cubic-bezier(0.34,1.56,0.64,1);
        }
        .qd-perfect-streak {
          font-size: 16px; font-weight: 800; color: #a855f7;
          text-shadow: 0 0 10px rgba(168,85,247,0.7); margin: 4px 0 0 0;
          animation: qd-bonus-pop 0.4s cubic-bezier(0.34,1.56,0.64,1);
        }
        @keyframes qd-bonus-pop { 0% { opacity: 0; transform: scale(0.5) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }

        .qd-early-text {
          font-size: clamp(52px, 15vw, 70px); font-weight: 900; color: #f472b6;
          text-shadow: 0 0 40px rgba(244,114,182,0.8); margin: 0; letter-spacing: 0.06em;
        }
        .qd-penalty-text {
          font-size: clamp(40px, 11vw, 52px); font-weight: 800; color: #fb7185; margin: 10px 0 0 0;
        }

        .qd-gameover-title {
          font-size: clamp(52px, 14vw, 68px); font-weight: 900; color: #fef3c7;
          text-shadow: 0 4px 24px rgba(251,191,36,0.5); margin: 0 0 14px 0; letter-spacing: 0.1em;
        }
        .qd-gameover-score {
          font-size: clamp(32px, 9vw, 44px); font-weight: 700; color: #d6d3d1; margin: 0 0 6px 0;
        }
        .qd-gameover-stat { font-size: 17px; color: #a8a29e; margin: 3px 0; }
        .qd-new-record {
          font-size: 26px; font-weight: 800; color: #fbbf24;
          text-shadow: 0 0 20px rgba(251,191,36,0.8); margin: 12px 0 0 0;
          animation: qd-record-bounce 0.5s ease-in-out infinite alternate;
        }
        @keyframes qd-record-bounce { 0% { transform: scale(1) rotate(-2deg); } 100% { transform: scale(1.15) rotate(2deg); } }

        .qd-anim-fade-scale { animation: qd-fade-scale 0.5s ease-out; }
        .qd-anim-fade { animation: qd-fade 0.3s ease-out; }
        .qd-anim-slam { animation: qd-slam 0.1s ease-out; }
        .qd-anim-pop { animation: qd-pop 0.25s cubic-bezier(0.34,1.56,0.64,1); }
        .qd-anim-shake { animation: qd-shake-in 0.35s ease-out; }

        @keyframes qd-fade-scale { 0% { opacity: 0; transform: scale(0.6); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes qd-fade { 0% { opacity: 0; } 100% { opacity: 1; } }
        @keyframes qd-slam { 0% { opacity: 0; transform: scale(4); } 100% { opacity: 1; transform: scale(1); } }
        @keyframes qd-pop { 0% { opacity: 0; transform: scale(0.4) translateY(20px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes qd-shake-in {
          0% { transform: translateX(-14px); opacity: 0; }
          20% { transform: translateX(12px); opacity: 1; }
          40% { transform: translateX(-9px); }
          60% { transform: translateX(7px); }
          80% { transform: translateX(-3px); }
          100% { transform: translateX(0); }
        }
        @keyframes qd-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
        @keyframes qd-urgent-pulse { 0%, 100% { opacity: 0.6; transform: scale(1); } 50% { opacity: 1; transform: scale(1.1); } }

        .qd-round-history {
          display: flex; gap: 7px; padding: 10px 16px; z-index: 3; flex-shrink: 0;
        }
        .qd-dot {
          width: 24px; height: 24px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,0.15); transition: all 0.3s ease;
        }
        .qd-dot.pending { background: rgba(255,255,255,0.06); }
        .qd-dot.normal { background: #fbbf24; border-color: #f59e0b; box-shadow: 0 0 8px rgba(251,191,36,0.5); }
        .qd-dot.great { background: #60a5fa; border-color: #3b82f6; box-shadow: 0 0 10px rgba(96,165,250,0.6); }
        .qd-dot.perfect { background: #4ade80; border-color: #22c55e; box-shadow: 0 0 12px rgba(74,222,128,0.7); animation: qd-dot-glow 1s ease-in-out infinite alternate; }
        .qd-dot.early { background: #f472b6; border-color: #ec4899; box-shadow: 0 0 8px rgba(244,114,182,0.5); }
        .qd-dot.golden { border-color: #fbbf24; box-shadow: 0 0 10px rgba(251,191,36,0.6), inset 0 0 4px rgba(251,191,36,0.3); }
        @keyframes qd-dot-glow { 0% { box-shadow: 0 0 8px rgba(74,222,128,0.5); } 100% { box-shadow: 0 0 18px rgba(74,222,128,0.9); } }

        .qd-footer { padding: 8px 16px 16px 16px; z-index: 3; flex-shrink: 0; }
        .qd-footer .text-button { pointer-events: auto; }
      `}</style>
    </section>
  )
}

export const quickDrawModule: MiniGameModule = {
  manifest: {
    id: 'quick-draw',
    title: 'Quick Draw',
    description: 'Be a gunslinger! Tap fastest on DRAW!',
    unlockCost: 35,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#b45309',
  },
  Component: QuickDrawGame,
}
