import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 120000
const LOW_TIME_THRESHOLD_MS = 5000
const REVEAL_DURATION_MS = 800
const SHAKE_DURATION_MS = 500
const FLASH_DURATION_MS = 400

const SCORE_WIN = 3
const SCORE_DRAW = 1
const SCORE_LOSE = -1
const MIND_READER_THRESHOLD = 5
const MIND_READER_BONUS = 10
const FEVER_COMBO_THRESHOLD = 8
const FEVER_MULTIPLIER = 3
const SPEED_UP_PER_10_SCORE = 50

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

function pickAiHand(history: Hand[]): Hand {
  const historyLength = history.length

  if (historyLength < 2) {
    return ALL_HANDS[Math.floor(Math.random() * ALL_HANDS.length)]
  }

  const lastTwo = [history[historyLength - 2], history[historyLength - 1]]

  if (lastTwo[0] === lastTwo[1]) {
    const forbidden = lastTwo[0]
    const candidates = ALL_HANDS.filter((h) => h !== forbidden)
    return candidates[Math.floor(Math.random() * candidates.length)]
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

function RockScissorsGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [wins, setWins] = useState(0)
  const [draws, setDraws] = useState(0)
  const [losses, setLosses] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<GamePhase>('choosing')
  const [playerHand, setPlayerHand] = useState<Hand | null>(null)
  const [aiHand, setAiHand] = useState<Hand | null>(null)
  const [lastResult, setLastResult] = useState<RoundResult | null>(null)
  const [flashClass, setFlashClass] = useState<string>('')
  const [scorePopup, setScorePopup] = useState<string | null>(null)

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const winsRef = useRef(0)
  const drawsRef = useRef(0)
  const lossesRef = useRef(0)
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

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
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
      audio.volume = volume
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

  const handleChoose = useCallback(
    (chosen: Hand) => {
      if (finishedRef.current) return
      if (phaseRef.current !== 'choosing') return

      phaseRef.current = 'shaking'
      setPhase('shaking')
      setPlayerHand(chosen)
      setLastResult(null)
      setFlashClass('')
      setScorePopup(null)

      playAudio(tapHitAudioRef, 0.4, 1)

      const speedReduction = Math.min(300, Math.floor(scoreRef.current / 10) * SPEED_UP_PER_10_SCORE / 10)
      const currentShakeDuration = Math.max(200, SHAKE_DURATION_MS - speedReduction)

      phaseTimerRef.current = window.setTimeout(() => {
        phaseTimerRef.current = null
        if (finishedRef.current) return

        const aiChoice = pickAiHand(aiHistoryRef.current)
        aiHistoryRef.current = [...aiHistoryRef.current, aiChoice]

        const result = determineResult(chosen, aiChoice)

        let scoreDelta = 0
        let nextCombo = comboRef.current

        if (result === 'win') {
          nextCombo += 1
          const comboMultiplier = Math.min(nextCombo, 5)
          scoreDelta = SCORE_WIN * comboMultiplier

          if (nextCombo === MIND_READER_THRESHOLD) {
            scoreDelta += MIND_READER_BONUS
          }
          if (nextCombo >= FEVER_COMBO_THRESHOLD) {
            scoreDelta *= FEVER_MULTIPLIER
          }

          winsRef.current += 1
          setWins(winsRef.current)
          setFlashClass('rock-scissors-flash-win')
          effects.triggerFlash()
          effects.spawnParticles(4, 200, 200)
          playAudio(tapHitStrongAudioRef, 0.55, 1 + nextCombo * 0.04)
        } else if (result === 'draw') {
          scoreDelta = SCORE_DRAW
          setFlashClass('rock-scissors-flash-draw')
          playAudio(tapHitAudioRef, 0.35, 0.9)
        } else {
          nextCombo = 0
          scoreDelta = SCORE_LOSE
          lossesRef.current += 1
          setLosses(lossesRef.current)
          setFlashClass('rock-scissors-flash-lose')
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.4)')
          playAudio(tapHitAudioRef, 0.45, 0.7)
        }

        if (result === 'draw') {
          drawsRef.current += 1
          setDraws(drawsRef.current)
        }

        comboRef.current = nextCombo
        setCombo(nextCombo)

        const nextScore = scoreRef.current + scoreDelta
        scoreRef.current = nextScore
        setScore(nextScore)

        setAiHand(aiChoice)
        setLastResult(result)
        setScorePopup(scoreDelta >= 0 ? `+${scoreDelta}` : `${scoreDelta}`)

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
          phaseRef.current = 'choosing'
          setPhase('choosing')
          setPlayerHand(null)
          setAiHand(null)
          setLastResult(null)
        }, REVEAL_DURATION_MS)
      }, currentShakeDuration)
    },
    [playAudio],
  )

  const handleExit = useCallback(() => {
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
      clearTimeoutSafe(phaseTimerRef)
      clearTimeoutSafe(flashTimerRef)
      clearTimeoutSafe(popupTimerRef)
      effects.cleanup()
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

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
          playAudio(tapHitAudioRef, 0.2, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 12000)
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
    <section className="mini-game-panel rock-scissors-panel" aria-label="rock-scissors-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <div className="rock-scissors-score-strip">
        <p className="rock-scissors-score">{Math.max(0, score).toLocaleString()}</p>
        <p className="rock-scissors-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`rock-scissors-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="rock-scissors-meta-row">
        <p className="rock-scissors-stat">
          <span className="rock-scissors-stat-icon win-icon" /> {wins}
        </p>
        <p className="rock-scissors-stat">
          <span className="rock-scissors-stat-icon draw-icon" /> {draws}
        </p>
        <p className="rock-scissors-stat">
          <span className="rock-scissors-stat-icon lose-icon" /> {losses}
        </p>
        {combo >= 2 && (
          <p className="rock-scissors-combo">
            COMBO <strong>{comboLabel}</strong>
          </p>
        )}
      </div>

      <div className={`rock-scissors-arena ${flashClass}`}>
        <div className="rock-scissors-hands-row">
          <div className="rock-scissors-hand-container">
            <p className="rock-scissors-hand-label">You</p>
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

      {combo >= FEVER_COMBO_THRESHOLD && (
        <div style={{ textAlign: 'center', color: '#fbbf24', fontWeight: 800, fontSize: 16, textShadow: '0 0 10px #f59e0b', animation: 'rock-scissors-fever 0.4s ease-in-out infinite alternate' }}>
          FEVER MODE x{FEVER_MULTIPLIER}
        </div>
      )}
      {combo === MIND_READER_THRESHOLD && lastResult === 'win' && (
        <div style={{ textAlign: 'center', color: '#a78bfa', fontWeight: 800, fontSize: 18, animation: 'rock-scissors-fever 0.5s ease-in-out' }}>
          MIND READER! +{MIND_READER_BONUS}
        </div>
      )}
      <style>{`
        @keyframes rock-scissors-fever {
          from { opacity: 0.6; transform: scale(1); }
          to { opacity: 1; transform: scale(1.06); }
        }
      `}</style>

      <div className="rock-scissors-button-row">
        {ALL_HANDS.map((hand) => (
          <button
            className="rock-scissors-choice-button"
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

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

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
