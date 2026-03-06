import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import handRockImg from '../../../assets/images/generated/rock-scissors/hand-rock.png'
import handScissorsImg from '../../../assets/images/generated/rock-scissors/hand-scissors.png'
import handPaperImg from '../../../assets/images/generated/rock-scissors/hand-paper.png'
import aiCharImg from '../../../assets/images/generated/rock-scissors/ai-character.png'
import playerCharImg from '../../../assets/images/generated/rock-scissors/player-character.png'
import questionMarkImg from '../../../assets/images/generated/rock-scissors/question-mark.png'
import vsEmblemImg from '../../../assets/images/generated/rock-scissors/vs-emblem.png'

import shakeSfx from '../../../assets/sounds/rock-scissors-shake.mp3'
import winSfx from '../../../assets/sounds/rock-scissors-win.mp3'
import loseSfx from '../../../assets/sounds/rock-scissors-lose.mp3'
import drawSfx from '../../../assets/sounds/rock-scissors-draw.mp3'
import comboSfx from '../../../assets/sounds/rock-scissors-combo.mp3'
import feverSfx from '../../../assets/sounds/rock-scissors-fever.mp3'
import tickSfx from '../../../assets/sounds/rock-scissors-tick.mp3'
import perfectSfx from '../../../assets/sounds/rock-scissors-perfect.mp3'
import criticalSfx from '../../../assets/sounds/rock-scissors-critical.mp3'
import speedupSfx from '../../../assets/sounds/rock-scissors-speedup.mp3'
import timebonusSfx from '../../../assets/sounds/rock-scissors-timebonus.mp3'
import tauntSfx from '../../../assets/sounds/rock-scissors-taunt.mp3'
import roundStartSfx from '../../../assets/sounds/rock-scissors-round-start.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 90000
const LOW_TIME_THRESHOLD_MS = 10000
const REVEAL_DURATION_MS = 650
const SHAKE_DURATION_MS = 400
const FLASH_DURATION_MS = 300

const SCORE_WIN = 3
const SCORE_DRAW = 1
const SCORE_LOSE = -1
const CRITICAL_CHANCE = 0.15
const CRITICAL_MULTIPLIER = 2
const MIND_READER_THRESHOLD = 5
const MIND_READER_BONUS = 10
const FEVER_COMBO_THRESHOLD = 8
const FEVER_MULTIPLIER = 3
const SPEED_UP_PER_10_SCORE = 50
const PERFECT_TIMING_WINDOW_MS = 200
const PERFECT_TIMING_BONUS = 5
const STREAK_MILESTONE_BONUS = 15
const STREAK_MILESTONES = [10, 20, 30, 50]
const TIME_BONUS_MS = 5000
const TIME_BONUS_STREAKS = [5, 15, 25, 40]

type Hand = 'rock' | 'scissors' | 'paper'
type RoundResult = 'win' | 'lose' | 'draw'
type GamePhase = 'choosing' | 'shaking' | 'revealing'

const HAND_IMAGES: Record<Hand, string> = {
  rock: handRockImg,
  scissors: handScissorsImg,
  paper: handPaperImg,
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

const AI_TAUNTS = [
  '\uB0B4\uAC00 \uC774\uACA8\uBC84\uB838\uC9C0!',
  '\uB108\uBB34 \uC27D\uB124~',
  '\uB610 \uC9C0\uB294\uAC70\uC57C?',
  '\uB0B4 \uC2B9\uB9AC!',
  'GG EZ',
  '\uB2E4\uC74C\uC5D4 \uC798\uD574\uBD10~',
]

const AI_WIN_REACTIONS = ['\uD83D\uDE0F', '\uD83E\uDD16', '\uD83D\uDCAA']
const AI_LOSE_REACTIONS = ['\uD83D\uDE31', '\uD83E\uDD2F', '\uD83D\uDE25']

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
      if (counts[hand] === maxCount) weights[hand] += 0.4
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
    return `\uD83D\uDCA1 AI\uAC00 ${HAND_LABEL[last3[0]]}\uC744 \uC5F0\uC18D \uC0AC\uC6A9 \uC911!`
  }
  if (history.length >= 6) {
    const l6 = history.slice(-6)
    if (l6[0] === l6[3] && l6[1] === l6[4] && l6[2] === l6[5]) {
      return '\uD83D\uDCA1 AI \uD328\uD134 \uBC1C\uACAC!'
    }
  }
  return null
}

type AudioRefMap = Record<string, React.MutableRefObject<HTMLAudioElement | null>>

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
  const [isCritical, setIsCritical] = useState(false)
  const [streakAnnounce, setStreakAnnounce] = useState<string | null>(null)
  const [timeBonusMsg, setTimeBonusMsg] = useState<string | null>(null)
  const [aiTaunt, setAiTaunt] = useState<string | null>(null)
  const [aiReaction, setAiReaction] = useState<string | null>(null)
  const [maxCombo, setMaxCombo] = useState(0)
  const [feverActive, setFeverActive] = useState(false)
  const [recentHistory, setRecentHistory] = useState<{ player: Hand; ai: Hand; result: RoundResult }[]>([])
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
  const revealStartRef = useRef<number>(0)

  const audioRefs: AudioRefMap = {
    shake: useRef<HTMLAudioElement | null>(null),
    win: useRef<HTMLAudioElement | null>(null),
    lose: useRef<HTMLAudioElement | null>(null),
    draw: useRef<HTMLAudioElement | null>(null),
    combo: useRef<HTMLAudioElement | null>(null),
    fever: useRef<HTMLAudioElement | null>(null),
    tick: useRef<HTMLAudioElement | null>(null),
    perfect: useRef<HTMLAudioElement | null>(null),
    critical: useRef<HTMLAudioElement | null>(null),
    speedup: useRef<HTMLAudioElement | null>(null),
    timebonus: useRef<HTMLAudioElement | null>(null),
    taunt: useRef<HTMLAudioElement | null>(null),
    roundStart: useRef<HTMLAudioElement | null>(null),
    gameOver: useRef<HTMLAudioElement | null>(null),
  }

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback(
    (key: string, volume: number, playbackRate = 1) => {
      const audio = audioRefs[key]?.current
      if (!audio) return
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

    playAudio('gameOver', 0.6, 0.95)

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
      setIsCritical(false)
      setStreakAnnounce(null)
      setTimeBonusMsg(null)
      setAiTaunt(null)
      setAiReaction(null)

      playAudio('shake', 0.5, 1)

      const speedReduction = Math.min(250, Math.floor(scoreRef.current / 10) * SPEED_UP_PER_10_SCORE / 10)
      const currentShakeDuration = Math.max(150, SHAKE_DURATION_MS - speedReduction)

      phaseTimerRef.current = window.setTimeout(() => {
        phaseTimerRef.current = null
        if (finishedRef.current) return

        playAudio('roundStart', 0.3, 1.1)

        const aiChoice = pickAiHand(aiHistoryRef.current, getDifficulty())
        aiHistoryRef.current = [...aiHistoryRef.current, aiChoice]

        const result = determineResult(chosen, aiChoice)
        roundsRef.current += 1
        setRounds(roundsRef.current)

        setRecentHistory((prev) => {
          const next = [...prev, { player: chosen, ai: aiChoice, result }]
          return next.length > 6 ? next.slice(-6) : next
        })

        let scoreDelta = 0
        let nextCombo = comboRef.current
        const rolledCritical = Math.random() < CRITICAL_CHANCE

        if (result === 'win') {
          nextCombo += 1
          const comboMultiplier = Math.min(nextCombo, 5)
          scoreDelta = SCORE_WIN * comboMultiplier

          if (rolledCritical) {
            scoreDelta *= CRITICAL_MULTIPLIER
            setIsCritical(true)
            playAudio('critical', 0.6, 1)
            effects.spawnParticles(8, 200, 250)
          }

          if (isPerfectTiming) {
            scoreDelta += PERFECT_TIMING_BONUS
            setIsPerfect(true)
            playAudio('perfect', 0.5, 1.2)
          }

          if (nextCombo === MIND_READER_THRESHOLD) {
            scoreDelta += MIND_READER_BONUS
          }
          if (nextCombo >= FEVER_COMBO_THRESHOLD) {
            scoreDelta *= FEVER_MULTIPLIER
            if (!feverActiveRef.current) {
              feverActiveRef.current = true
              setFeverActive(true)
              playAudio('fever', 0.55, 1)
            }
          }

          if (STREAK_MILESTONES.includes(nextCombo)) {
            scoreDelta += STREAK_MILESTONE_BONUS
            setStreakAnnounce(`${nextCombo}\uC5F0\uC2B9! +${STREAK_MILESTONE_BONUS}`)
          }

          if (TIME_BONUS_STREAKS.includes(nextCombo)) {
            remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
            setTimeBonusMsg(`+${TIME_BONUS_MS / 1000}s TIME!`)
            playAudio('timebonus', 0.5, 1)
          }

          if (nextCombo >= 3 && !rolledCritical) {
            playAudio('combo', 0.45, 1 + nextCombo * 0.03)
          } else if (!rolledCritical) {
            playAudio('win', 0.5, 1 + nextCombo * 0.04)
          }

          winsRef.current += 1
          setWins(winsRef.current)
          setFlashClass('rps-flash-win')
          setAiReaction(AI_LOSE_REACTIONS[Math.floor(Math.random() * AI_LOSE_REACTIONS.length)])
          effects.triggerFlash()
          effects.spawnParticles(3 + Math.min(nextCombo, 6), 200, 250)
        } else if (result === 'draw') {
          scoreDelta = SCORE_DRAW
          drawsRef.current += 1
          setDraws(drawsRef.current)
          setFlashClass('rps-flash-draw')
          playAudio('draw', 0.4, 0.95)
        } else {
          nextCombo = 0
          scoreDelta = SCORE_LOSE
          lossesRef.current += 1
          setLosses(lossesRef.current)
          setFlashClass('rps-flash-lose')
          feverActiveRef.current = false
          setFeverActive(false)
          effects.triggerShake(6)
          effects.triggerFlash('rgba(239,68,68,0.5)')
          playAudio('lose', 0.5, 0.85)
          setAiReaction(AI_WIN_REACTIONS[Math.floor(Math.random() * AI_WIN_REACTIONS.length)])

          if (Math.random() < 0.4) {
            const taunt = AI_TAUNTS[Math.floor(Math.random() * AI_TAUNTS.length)]
            setAiTaunt(taunt)
            playAudio('taunt', 0.35, 1)
          }
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
          setIsCritical(false)
          setStreakAnnounce(null)
          setTimeBonusMsg(null)
          setAiTaunt(null)
          setAiReaction(null)
        }, REVEAL_DURATION_MS)
      }, currentShakeDuration)
    },
    [playAudio, getDifficulty],
  )

  useEffect(() => {
    const sfxMap: Record<string, string> = {
      shake: shakeSfx, win: winSfx, lose: loseSfx, draw: drawSfx,
      combo: comboSfx, fever: feverSfx, tick: tickSfx, perfect: perfectSfx,
      critical: criticalSfx, speedup: speedupSfx, timebonus: timebonusSfx,
      taunt: tauntSfx, roundStart: roundStartSfx, gameOver: gameOverHitSfx,
    }

    for (const [key, src] of Object.entries(sfxMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      if (audioRefs[key]) audioRefs[key].current = audio
    }

    revealStartRef.current = performance.now()

    return () => {
      clearTimeoutSafe(phaseTimerRef)
      clearTimeoutSafe(flashTimerRef)
      clearTimeoutSafe(popupTimerRef)
      effects.cleanup()
      for (const key of Object.keys(sfxMap)) {
        if (audioRefs[key]) audioRefs[key].current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return }
      if (phase === 'choosing') {
        if (event.code === 'Digit1' || event.code === 'KeyA') handleChoose('rock')
        else if (event.code === 'Digit2' || event.code === 'KeyS') handleChoose('scissors')
        else if (event.code === 'Digit3' || event.code === 'KeyD') handleChoose('paper')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit, handleChoose, phase])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio('tick', 0.25, 1.1 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 12000)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }

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
    lastResult === 'win' ? 'WIN!' : lastResult === 'lose' ? 'LOSE' : lastResult === 'draw' ? 'DRAW' : ''

  return (
    <section
      className={`mini-game-panel rps-panel ${feverActive ? 'rps-fever-bg' : ''}`}
      aria-label="rock-scissors-game"
      style={{ position: 'relative', maxWidth: '432px', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}
    >
      {/* Timer Bar */}
      <div className="rps-timer-bar">
        <div className={`rps-timer-fill ${isLowTime ? 'low-time' : ''}`} style={{ width: `${timerProgress * 100}%` }} />
      </div>

      {/* Score Header */}
      <div className="rps-header">
        <div className="rps-header-left">
          <p className="rps-score">{Math.max(0, score).toLocaleString()}</p>
          <p className="rps-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="rps-header-center">
          {combo >= 2 && (
            <p className={`rps-combo-badge ${combo >= FEVER_COMBO_THRESHOLD ? 'fever' : ''}`}>
              {comboLabel} COMBO
            </p>
          )}
        </div>
        <div className="rps-header-right">
          <p className={`rps-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <p className="rps-round-num">R{rounds}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="rps-stats">
        <span className="rps-stat-item win">{wins}W</span>
        <span className="rps-stat-item draw">{draws}D</span>
        <span className="rps-stat-item lose">{losses}L</span>
        <span className="rps-stat-item rate">{winRate}%</span>
      </div>

      {/* Pattern Hint */}
      {patternHint && phase === 'choosing' && (
        <div className="rps-hint">{patternHint}</div>
      )}

      {/* Arena */}
      <div className={`rps-arena ${flashClass}`}>
        {/* Player Side */}
        <div className="rps-fighter-col">
          <img src={playerCharImg} alt="Player" className="rps-char-icon" />
          <div className={`rps-hand-frame player-frame ${phase === 'shaking' ? 'rps-shaking' : ''} ${lastResult === 'win' ? 'rps-pulse-win' : ''}`}>
            {playerHand ? (
              <img src={HAND_IMAGES[playerHand]} alt={playerHand} className="rps-hand-img" />
            ) : (
              <img src={questionMarkImg} alt="?" className="rps-hand-img rps-qmark" />
            )}
          </div>
        </div>

        {/* VS Center */}
        <div className="rps-center-col">
          {scorePopup !== null && (
            <span className={`rps-score-pop ${lastResult === 'win' ? 'pop-win' : lastResult === 'lose' ? 'pop-lose' : 'pop-draw'}`}>
              {scorePopup}
            </span>
          )}
          {isCritical && <span className="rps-critical-badge">CRITICAL!</span>}
          {isPerfect && <span className="rps-perfect-badge">PERFECT!</span>}
          {lastResult !== null ? (
            <span className={`rps-result-label result-${lastResult}`}>{resultLabel}</span>
          ) : (
            <img src={vsEmblemImg} alt="VS" className="rps-vs-img" />
          )}
          {aiReaction && <span className="rps-ai-reaction">{aiReaction}</span>}
        </div>

        {/* AI Side */}
        <div className="rps-fighter-col">
          <img src={aiCharImg} alt="AI" className="rps-char-icon" />
          <div className={`rps-hand-frame ai-frame ${phase === 'shaking' ? 'rps-shaking' : ''} ${lastResult === 'lose' ? 'rps-pulse-win' : ''}`}>
            {phase === 'revealing' && aiHand ? (
              <img src={HAND_IMAGES[aiHand]} alt={aiHand} className="rps-hand-img" />
            ) : (
              <img src={questionMarkImg} alt="?" className="rps-hand-img rps-qmark" />
            )}
          </div>
        </div>
      </div>

      {/* Announcements */}
      <div className="rps-announcements">
        {feverActive && combo >= FEVER_COMBO_THRESHOLD && (
          <div className="rps-fever-text">FEVER x{FEVER_MULTIPLIER}</div>
        )}
        {streakAnnounce && <div className="rps-streak-text">{streakAnnounce}</div>}
        {timeBonusMsg && <div className="rps-timebonus-text">{timeBonusMsg}</div>}
        {combo === MIND_READER_THRESHOLD && lastResult === 'win' && (
          <div className="rps-mindreader-text">MIND READER! +{MIND_READER_BONUS}</div>
        )}
        {aiTaunt && <div className="rps-taunt-text">{aiTaunt}</div>}
      </div>

      {/* Recent History */}
      {recentHistory.length > 0 && (
        <div className="rps-history">
          {recentHistory.map((h, i) => (
            <div key={i} className={`rps-history-dot ${h.result}`} />
          ))}
        </div>
      )}

      {/* Max Combo */}
      {maxCombo >= 3 && <div className="rps-max-combo">MAX {maxCombo}</div>}

      {/* Choice Buttons */}
      <div className="rps-buttons">
        {ALL_HANDS.map((hand) => (
          <button
            className={`rps-btn ${phase === 'choosing' ? 'ready' : ''}`}
            key={hand}
            type="button"
            disabled={phase !== 'choosing'}
            onClick={() => handleChoose(hand)}
          >
            <img src={HAND_IMAGES[hand]} alt={hand} className="rps-btn-img" />
            <span className="rps-btn-label">{HAND_LABEL[hand]}</span>
          </button>
        ))}
      </div>

      <style>{GAME_EFFECTS_CSS}</style>
      <style>{RPS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

const RPS_CSS = `
@keyframes rps-shake-anim {
  0% { transform: translateX(-5px) rotate(-6deg); }
  25% { transform: translateX(5px) rotate(6deg); }
  50% { transform: translateX(-4px) rotate(-4deg); }
  75% { transform: translateX(4px) rotate(4deg); }
  100% { transform: translateX(-5px) rotate(-6deg); }
}
@keyframes rps-pulse-anim {
  0% { transform: scale(1); }
  35% { transform: scale(1.25); }
  100% { transform: scale(1); }
}
@keyframes rps-pop-float {
  0% { opacity: 1; transform: translateY(0) scale(1); }
  50% { opacity: 0.9; transform: translateY(-16px) scale(1.2); }
  100% { opacity: 0; transform: translateY(-32px) scale(0.7); }
}
@keyframes rps-critical-flash {
  0% { opacity: 0; transform: scale(0.3) rotate(-10deg); }
  30% { opacity: 1; transform: scale(1.3) rotate(5deg); }
  60% { opacity: 1; transform: scale(1) rotate(0deg); }
  100% { opacity: 0; transform: scale(1.5) rotate(10deg); }
}
@keyframes rps-perfect-flash {
  0% { opacity: 0; transform: scale(0.5); }
  30% { opacity: 1; transform: scale(1.15); }
  100% { opacity: 0; transform: scale(1.4); }
}
@keyframes rps-fever-pulse {
  from { opacity: 0.7; transform: scale(1); text-shadow: 0 0 8px #f59e0b; }
  to { opacity: 1; transform: scale(1.06); text-shadow: 0 0 16px #ef4444; }
}
@keyframes rps-streak-pop {
  0% { opacity: 0; transform: translateY(8px) scale(0.8); }
  40% { opacity: 1; transform: translateY(-3px) scale(1.1); }
  100% { opacity: 0; transform: translateY(-12px) scale(0.85); }
}
@keyframes rps-ready-glow {
  0%, 100% { box-shadow: 3px 3px 0 #6b7280; }
  50% { box-shadow: 3px 3px 0 #6b7280, 0 0 14px rgba(59,130,246,0.4); }
}
@keyframes rps-timer-danger {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
@keyframes rps-taunt-slide {
  0% { opacity: 0; transform: translateX(20px); }
  20% { opacity: 1; transform: translateX(0); }
  80% { opacity: 1; transform: translateX(0); }
  100% { opacity: 0; transform: translateX(-20px); }
}
@keyframes rps-timebonus-pop {
  0% { opacity: 0; transform: scale(0.5); }
  30% { opacity: 1; transform: scale(1.2); }
  70% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.8); }
}
@keyframes rps-reaction-pop {
  0% { opacity: 0; transform: scale(0) rotate(-20deg); }
  40% { opacity: 1; transform: scale(1.3) rotate(5deg); }
  100% { opacity: 0; transform: scale(0.5) translateY(-20px); }
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
