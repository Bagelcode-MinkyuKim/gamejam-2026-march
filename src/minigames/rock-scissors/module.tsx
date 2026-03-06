import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import shakeSfx from '../../../assets/sounds/rock-scissors-shake.mp3'
import winSfx from '../../../assets/sounds/rock-scissors-win.mp3'
import loseSfx from '../../../assets/sounds/rock-scissors-lose.mp3'
import drawSfx from '../../../assets/sounds/rock-scissors-draw.mp3'
import comboSfx from '../../../assets/sounds/rock-scissors-combo.mp3'
import feverSfx from '../../../assets/sounds/rock-scissors-fever.mp3'
import tickSfx from '../../../assets/sounds/rock-scissors-tick.mp3'
import perfectSfx from '../../../assets/sounds/rock-scissors-perfect.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 5000
const REVEAL_DURATION_MS = 700
const SHAKE_DURATION_MS = 450
const FLASH_DURATION_MS = 350

const SCORE_WIN = 3
const SCORE_DRAW = 1
const SCORE_LOSE = -1
const MIND_READER_THRESHOLD = 5
const MIND_READER_BONUS = 10
const FEVER_COMBO_THRESHOLD = 8
const FEVER_MULTIPLIER = 3
const SPEED_UP_PER_10_SCORE = 50
const PERFECT_TIMING_WINDOW_MS = 150
const PERFECT_TIMING_BONUS = 5
const STREAK_MILESTONE_BONUS = 15
const STREAK_MILESTONES = [10, 20, 30, 50]

type Hand = 'rock' | 'scissors' | 'paper'
type RoundResult = 'win' | 'lose' | 'draw'
type GamePhase = 'choosing' | 'shaking' | 'revealing'

const HAND_EMOJI: Record<Hand, string> = {
  rock: '\u270A',
  scissors: '\u270C\uFE0F',
  paper: '\u270B',
}

const HAND_LABEL: Record<Hand, string> = {
  rock: '\uBC14\uC704',
  scissors: '\uAC00\uC704',
  paper: '\uBCF4',
}

const ALL_HANDS: Hand[] = ['rock', 'scissors', 'paper']

const WINS_AGAINST: Record<Hand, Hand> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
}

function determineResult(player: Hand, ai: Hand): RoundResult {
  if (player === ai) return 'draw'
  if (WINS_AGAINST[player] === ai) return 'win'
  return 'lose'
}

function pickAiHand(history: Hand[], difficulty: number): Hand {
  const historyLength = history.length

  if (historyLength < 2) {
    return ALL_HANDS[Math.floor(Math.random() * ALL_HANDS.length)]
  }

  const lastTwo = [history[historyLength - 2], history[historyLength - 1]]

  if (lastTwo[0] === lastTwo[1] && Math.random() < 0.3 + difficulty * 0.1) {
    const predictedHand = lastTwo[0]
    const counterHand = ALL_HANDS.find((h) => WINS_AGAINST[h] === predictedHand)
    if (counterHand && Math.random() < 0.4 + difficulty * 0.05) return counterHand
  }

  const weights: Record<Hand, number> = { rock: 1, scissors: 1, paper: 1 }

  const lastHand = history[historyLength - 1]
  weights[lastHand] += 0.6

  if (historyLength >= 3) {
    const counts: Record<Hand, number> = { rock: 0, scissors: 0, paper: 0 }
    const lookback = Math.min(historyLength, 8)
    for (let i = historyLength - lookback; i < historyLength; i += 1) {
      counts[history[i]] += 1
    }
    const maxCount = Math.max(counts.rock, counts.scissors, counts.paper)
    for (const hand of ALL_HANDS) {
      if (counts[hand] === maxCount) {
        weights[hand] += 0.4
      }
    }
  }

  const total = weights.rock + weights.scissors + weights.paper
  const roll = Math.random() * total
  let cumulative = 0
  for (const hand of ALL_HANDS) {
    cumulative += weights[hand]
    if (roll <= cumulative) return hand
  }

  return ALL_HANDS[Math.floor(Math.random() * ALL_HANDS.length)]
}

function getPatternHint(history: Hand[]): string | null {
  if (history.length < 4) return null
  const last3 = history.slice(-3)
  if (last3[0] === last3[1] && last3[1] === last3[2]) {
    return `AI\uAC00 ${HAND_LABEL[last3[0]]}\uC744 \uC5F0\uC18D \uC0AC\uC6A9 \uC911!`
  }
  if (history.length >= 6) {
    const l6 = history.slice(-6)
    if (l6[0] === l6[3] && l6[1] === l6[4] && l6[2] === l6[5]) {
      return 'AI \uD328\uD134 \uBC1C\uACAC!'
    }
  }
  return null
}

function RockScissorsGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [wins, setWins] = useState(0)
  const [draws, setDraws] = useState(0)
  const [losses, setLosses] = useState(0)
  const [rounds, setRounds] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<GamePhase>('choosing')
  const [playerHand, setPlayerHand] = useState<Hand | null>(null)
  const [aiHand, setAiHand] = useState<Hand | null>(null)
  const [lastResult, setLastResult] = useState<RoundResult | null>(null)
  const [flashClass, setFlashClass] = useState<string>('')
  const [scorePopup, setScorePopup] = useState<string | null>(null)
  const [patternHint, setPatternHint] = useState<string | null>(null)
  const [isPerfect, setIsPerfect] = useState(false)
  const [streakAnnounce, setStreakAnnounce] = useState<string | null>(null)
  const [maxCombo, setMaxCombo] = useState(0)
  const [feverActive, setFeverActive] = useState(false)
  const feverActiveRef = useRef(false)

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const winsRef = useRef(0)
  const drawsRef = useRef(0)
  const lossesRef = useRef(0)
  const roundsRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const aiHistoryRef = useRef<Hand[]>([])
  const phaseRef = useRef<GamePhase>('choosing')
  const phaseTimerRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const popupTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)
  const lastChooseTimeRef = useRef<number>(0)
  const revealStartRef = useRef<number>(0)

  const shakeAudioRef = useRef<HTMLAudioElement | null>(null)
  const winAudioRef = useRef<HTMLAudioElement | null>(null)
  const loseAudioRef = useRef<HTMLAudioElement | null>(null)
  const drawAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const tickAudioRef = useRef<HTMLAudioElement | null>(null)
  const perfectAudioRef = useRef<HTMLAudioElement | null>(null)
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

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(phaseTimerRef)
    clearTimeoutSafe(flashTimerRef)
    clearTimeoutSafe(popupTimerRef)

    playAudio(gameOverAudioRef, 0.6, 0.95)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: Math.max(0, scoreRef.current),
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const getDifficulty = useCallback(() => {
    return Math.min(5, Math.floor(roundsRef.current / 10))
  }, [])

  const handleChoose = useCallback(
    (chosen: Hand) => {
      if (finishedRef.current) return
      if (phaseRef.current !== 'choosing') return

      const now = performance.now()
      const timeSinceReveal = now - revealStartRef.current
      const isPerfectTiming = revealStartRef.current > 0 && timeSinceReveal <= PERFECT_TIMING_WINDOW_MS

      phaseRef.current = 'shaking'
      setPhase('shaking')
      setPlayerHand(chosen)
      setLastResult(null)
      setFlashClass('')
      setScorePopup(null)
      setIsPerfect(false)
      setStreakAnnounce(null)
      lastChooseTimeRef.current = now

      playAudio(shakeAudioRef, 0.5, 1)

      const speedReduction = Math.min(300, Math.floor(scoreRef.current / 10) * SPEED_UP_PER_10_SCORE / 10)
      const currentShakeDuration = Math.max(180, SHAKE_DURATION_MS - speedReduction)

      phaseTimerRef.current = window.setTimeout(() => {
        phaseTimerRef.current = null
        if (finishedRef.current) return

        const aiChoice = pickAiHand(aiHistoryRef.current, getDifficulty())
        aiHistoryRef.current = [...aiHistoryRef.current, aiChoice]

        const result = determineResult(chosen, aiChoice)
        roundsRef.current += 1
        setRounds(roundsRef.current)

        let scoreDelta = 0
        let nextCombo = comboRef.current

        if (result === 'win') {
          nextCombo += 1
          const comboMultiplier = Math.min(nextCombo, 5)
          scoreDelta = SCORE_WIN * comboMultiplier

          if (isPerfectTiming) {
            scoreDelta += PERFECT_TIMING_BONUS
            setIsPerfect(true)
            playAudio(perfectAudioRef, 0.5, 1.2)
          }

          if (nextCombo === MIND_READER_THRESHOLD) {
            scoreDelta += MIND_READER_BONUS
          }
          if (nextCombo >= FEVER_COMBO_THRESHOLD) {
            scoreDelta *= FEVER_MULTIPLIER
            if (!feverActiveRef.current) {
              feverActiveRef.current = true
              setFeverActive(true)
              playAudio(feverAudioRef, 0.55, 1)
            }
          }

          if (STREAK_MILESTONES.includes(nextCombo)) {
            scoreDelta += STREAK_MILESTONE_BONUS
            setStreakAnnounce(`${nextCombo}\uC5F0\uC2B9! +${STREAK_MILESTONE_BONUS}`)
          }

          if (nextCombo >= 3) {
            playAudio(comboAudioRef, 0.45, 1 + nextCombo * 0.03)
          } else {
            playAudio(winAudioRef, 0.5, 1 + nextCombo * 0.04)
          }

          winsRef.current += 1
          setWins(winsRef.current)
          setFlashClass('rock-scissors-flash-win')
          effects.triggerFlash()
          effects.spawnParticles(3 + Math.min(nextCombo, 8), 200, 250)
        } else if (result === 'draw') {
          scoreDelta = SCORE_DRAW
          drawsRef.current += 1
          setDraws(drawsRef.current)
          setFlashClass('rock-scissors-flash-draw')
          playAudio(drawAudioRef, 0.4, 0.95)
        } else {
          nextCombo = 0
          scoreDelta = SCORE_LOSE
          lossesRef.current += 1
          setLosses(lossesRef.current)
          setFlashClass('rock-scissors-flash-lose')
          feverActiveRef.current = false
          setFeverActive(false)
          effects.triggerShake(5)
          effects.triggerFlash('rgba(239,68,68,0.45)')
          playAudio(loseAudioRef, 0.5, 0.85)
        }

        if (nextCombo > maxComboRef.current) {
          maxComboRef.current = nextCombo
          setMaxCombo(nextCombo)
        }

        comboRef.current = nextCombo
        setCombo(nextCombo)

        const nextScore = scoreRef.current + scoreDelta
        scoreRef.current = nextScore
        setScore(nextScore)

        setAiHand(aiChoice)
        setLastResult(result)
        setScorePopup(scoreDelta >= 0 ? `+${scoreDelta}` : `${scoreDelta}`)

        const hint = getPatternHint(aiHistoryRef.current)
        setPatternHint(hint)

        phaseRef.current = 'revealing'
        setPhase('revealing')

        clearTimeoutSafe(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashClass('')
        }, FLASH_DURATION_MS)

        clearTimeoutSafe(popupTimerRef)
        popupTimerRef.current = window.setTimeout(() => {
          popupTimerRef.current = null
          setScorePopup(null)
        }, REVEAL_DURATION_MS)

        phaseTimerRef.current = window.setTimeout(() => {
          phaseTimerRef.current = null
          if (finishedRef.current) return
          revealStartRef.current = performance.now()
          phaseRef.current = 'choosing'
          setPhase('choosing')
          setPlayerHand(null)
          setAiHand(null)
          setLastResult(null)
          setIsPerfect(false)
          setStreakAnnounce(null)
        }, REVEAL_DURATION_MS)
      }, currentShakeDuration)
    },
    [playAudio, getDifficulty],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  useEffect(() => {
    const audioConfigs = [
      { ref: shakeAudioRef, src: shakeSfx },
      { ref: winAudioRef, src: winSfx },
      { ref: loseAudioRef, src: loseSfx },
      { ref: drawAudioRef, src: drawSfx },
      { ref: comboAudioRef, src: comboSfx },
      { ref: feverAudioRef, src: feverSfx },
      { ref: tickAudioRef, src: tickSfx },
      { ref: perfectAudioRef, src: perfectSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
    ] as const

    for (const { ref, src } of audioConfigs) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ;(ref as React.MutableRefObject<HTMLAudioElement | null>).current = audio
    }

    revealStartRef.current = performance.now()

    return () => {
      clearTimeoutSafe(phaseTimerRef)
      clearTimeoutSafe(flashTimerRef)
      clearTimeoutSafe(popupTimerRef)
      effects.cleanup()
      for (const { ref } of audioConfigs) {
        ;(ref as React.MutableRefObject<HTMLAudioElement | null>).current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }
      if (phase === 'choosing') {
        if (event.code === 'Digit1' || event.code === 'KeyA') handleChoose('rock')
        else if (event.code === 'Digit2' || event.code === 'KeyS') handleChoose('scissors')
        else if (event.code === 'Digit3' || event.code === 'KeyD') handleChoose('paper')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit, handleChoose, phase])

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

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(tickAudioRef, 0.3, 1.1 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 10000)
        }
      } else {
        lowTimeSecondRef.current = null
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
  }, [finishGame, playAudio])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const comboLabel = combo >= 2 ? `x${Math.min(combo, 5)}` : ''
  const timerProgress = remainingMs / ROUND_DURATION_MS
  const winRate = rounds > 0 ? Math.round((wins / rounds) * 100) : 0

  const resultLabel =
    lastResult === 'win'
      ? '\uC2B9\uB9AC!'
      : lastResult === 'lose'
        ? '\uD328\uBC30...'
        : lastResult === 'draw'
          ? '\uBB34\uC2B9\uBD80'
          : ''

  const aiDisplayHand: string =
    phase === 'shaking'
      ? '\u2753'
      : aiHand !== null
        ? HAND_EMOJI[aiHand]
        : '\u2753'

  const playerDisplayHand: string =
    phase === 'shaking'
      ? HAND_EMOJI[playerHand!]
      : playerHand !== null
        ? HAND_EMOJI[playerHand]
        : ''

  return (
    <section className="mini-game-panel rock-scissors-panel" aria-label="rock-scissors-game" style={{ position: 'relative', maxWidth: '432px', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      {/* Timer Bar */}
      <div className="rock-scissors-timer-bar">
        <div
          className={`rock-scissors-timer-fill ${isLowTime ? 'low-time' : ''}`}
          style={{ width: `${timerProgress * 100}%` }}
        />
      </div>

      {/* Score Header */}
      <div className="rock-scissors-score-strip">
        <div className="rock-scissors-score-col">
          <p className="rock-scissors-score">{Math.max(0, score).toLocaleString()}</p>
          <p className="rock-scissors-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="rock-scissors-time-col">
          <p className={`rock-scissors-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
          <p className="rock-scissors-round-count">R{rounds}</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="rock-scissors-meta-row">
        <p className="rock-scissors-stat">
          <span className="rock-scissors-stat-icon win-icon" /> {wins}W
        </p>
        <p className="rock-scissors-stat">
          <span className="rock-scissors-stat-icon draw-icon" /> {draws}D
        </p>
        <p className="rock-scissors-stat">
          <span className="rock-scissors-stat-icon lose-icon" /> {losses}L
        </p>
        <p className="rock-scissors-stat win-rate">{winRate}%</p>
        {combo >= 2 && (
          <p className={`rock-scissors-combo ${combo >= FEVER_COMBO_THRESHOLD ? 'fever' : ''}`}>
            COMBO <strong>{comboLabel}</strong>
          </p>
        )}
      </div>

      {/* Pattern Hint */}
      {patternHint && phase === 'choosing' && (
        <div className="rock-scissors-hint">{patternHint}</div>
      )}

      {/* Arena */}
      <div className={`rock-scissors-arena ${flashClass}`}>
        <div className="rock-scissors-hands-row">
          <div className="rock-scissors-hand-container">
            <p className="rock-scissors-hand-label">YOU</p>
            <div className={`rock-scissors-hand player ${phase === 'shaking' ? 'shaking' : ''} ${lastResult === 'win' ? 'pulse-win' : ''}`}>
              {playerDisplayHand || '\u270A'}
            </div>
          </div>

          <div className="rock-scissors-vs">
            {scorePopup !== null && (
              <span
                className={`rock-scissors-score-popup ${
                  lastResult === 'win' ? 'popup-win' : lastResult === 'lose' ? 'popup-lose' : 'popup-draw'
                }`}
              >
                {scorePopup}
              </span>
            )}
            {isPerfect && (
              <span className="rock-scissors-perfect-badge">PERFECT!</span>
            )}
            {lastResult !== null ? (
              <span
                className={`rock-scissors-result-text ${
                  lastResult === 'win' ? 'result-win' : lastResult === 'lose' ? 'result-lose' : 'result-draw'
                }`}
              >
                {resultLabel}
              </span>
            ) : (
              <span className="rock-scissors-result-text result-idle">VS</span>
            )}
          </div>

          <div className="rock-scissors-hand-container">
            <p className="rock-scissors-hand-label">AI</p>
            <div className={`rock-scissors-hand ai ${phase === 'shaking' ? 'shaking' : ''} ${lastResult === 'lose' ? 'pulse-win' : ''}`}>
              {aiDisplayHand}
            </div>
          </div>
        </div>
      </div>

      {/* Fever / Streak Announcements */}
      {feverActive && combo >= FEVER_COMBO_THRESHOLD && (
        <div className="rock-scissors-fever-banner">
          FEVER MODE x{FEVER_MULTIPLIER}
        </div>
      )}
      {streakAnnounce && (
        <div className="rock-scissors-streak-announce">{streakAnnounce}</div>
      )}
      {combo === MIND_READER_THRESHOLD && lastResult === 'win' && (
        <div className="rock-scissors-mind-reader">MIND READER! +{MIND_READER_BONUS}</div>
      )}

      {/* Max Combo Display */}
      {maxCombo >= 3 && (
        <div className="rock-scissors-max-combo">MAX COMBO: {maxCombo}</div>
      )}

      {/* Choice Buttons */}
      <div className="rock-scissors-button-row">
        {ALL_HANDS.map((hand) => (
          <button
            className={`rock-scissors-choice-button ${phase === 'choosing' ? 'ready' : ''}`}
            key={hand}
            type="button"
            disabled={phase !== 'choosing'}
            onClick={() => handleChoose(hand)}
          >
            <span className="rock-scissors-choice-emoji">{HAND_EMOJI[hand]}</span>
            <span className="rock-scissors-choice-label">{HAND_LABEL[hand]}</span>
          </button>
        ))}
      </div>

      <style>{GAME_EFFECTS_CSS}</style>
      <style>{ROCK_SCISSORS_ANIMATIONS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

const ROCK_SCISSORS_ANIMATIONS_CSS = `
@keyframes rock-scissors-fever {
  from { opacity: 0.7; transform: scale(1); }
  to { opacity: 1; transform: scale(1.08); }
}
@keyframes rock-scissors-shake {
  0% { transform: translateX(-4px) rotate(-5deg); }
  25% { transform: translateX(4px) rotate(5deg); }
  50% { transform: translateX(-3px) rotate(-3deg); }
  75% { transform: translateX(3px) rotate(3deg); }
  100% { transform: translateX(-4px) rotate(-5deg); }
}
@keyframes rock-scissors-pulse {
  0% { transform: scale(1); }
  40% { transform: scale(1.35); }
  100% { transform: scale(1); }
}
@keyframes rock-scissors-popup-float {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  50% { opacity: 0.8; transform: translateY(-14px) scale(1.15); }
  100% { opacity: 0; transform: translateY(-28px) scale(0.8); }
}
@keyframes rock-scissors-perfect-flash {
  0% { opacity: 0; transform: scale(0.5); }
  30% { opacity: 1; transform: scale(1.2); }
  100% { opacity: 0; transform: scale(1.5); }
}
@keyframes rock-scissors-streak-pop {
  0% { opacity: 0; transform: translateY(10px) scale(0.8); }
  40% { opacity: 1; transform: translateY(-5px) scale(1.1); }
  100% { opacity: 0; transform: translateY(-15px) scale(0.9); }
}
@keyframes rock-scissors-ready-pulse {
  0%, 100% { box-shadow: 3px 3px 0 #9ca3af; }
  50% { box-shadow: 3px 3px 0 #9ca3af, 0 0 12px rgba(59,130,246,0.3); }
}
@keyframes rock-scissors-timer-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
`

export const rockScissorsModule: MiniGameModule = {
  manifest: {
    id: 'rock-scissors',
    title: 'Rock Scissors',
    description: '\uC5F0\uC18D \uAC00\uC704\uBC14\uC704\uBCF4! AI\uC758 \uD328\uD134\uC744 \uC77D\uACE0 \uC5F0\uC2B9\uC744 \uB178\uB824\uB77C!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#f43f5e',
  },
  Component: RockScissorsGame,
}
