import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import correctSfx from '../../../assets/sounds/word-chain-correct.mp3'
import wrongSfx from '../../../assets/sounds/word-chain-wrong.mp3'
import comboSfx from '../../../assets/sounds/word-chain-combo.mp3'
import feverSfx from '../../../assets/sounds/word-chain-fever.mp3'
import timeWarningSfx from '../../../assets/sounds/word-chain-time-warning.mp3'
import gameOverSfx from '../../../assets/sounds/word-chain-game-over.mp3'

const ROUND_DURATION_MS = 45000
const CORRECT_SCORE = 5
const WRONG_SCORE = -3
const COMBO_BONUS_THRESHOLD = 5
const COMBO_BONUS_EXTRA = 3
const CORRECT_FLASH_DURATION_MS = 280
const WRONG_SHAKE_DURATION_MS = 380
const LOW_TIME_THRESHOLD_MS = 7000
const CHOICE_COUNT = 4
const PER_WORD_TIME_MS = 8000
const MIN_PER_WORD_TIME_MS = 2500
const TIME_DECREASE_PER_COMBO = 250
const COMBO_MULTIPLIER_STEP = 3
const FEVER_COMBO_THRESHOLD = 8
const FEVER_MULTIPLIER = 2
const BONUS_ROUND_CHANCE = 0.12
const BONUS_ROUND_MULTIPLIER = 2
const TIME_BONUS_ON_CORRECT_MS = 800
const STREAK_MILESTONE = 10
const STREAK_TIME_BONUS_MS = 2000
const DIFFICULTY_WORD_COUNT_THRESHOLD = 15

const WORD_POOL: readonly string[] = [
  'apple','elephant','tiger','river','rain','night','tower','rocket','table','engine',
  'eagle','earth','hero','orange','enter','radio','ocean','nest','star','rose',
  'ring','gold','door','robot','train','note','echo','owl','leaf','fire',
  'hammer','rock','king','grape','energy','yarn','net','tea','ant',
  'tree','egg','giant','tulip','pan','nail','lamp','piano','open','north',
  'heart','trail','lion','lake','exit','road','drum','moon',
  'tent','top','pearl','light','trick','kite','ear','red','dark',
  'key','yes','snow','wave','vine','gray','tape',
  'sun','ice','map','cap','cup','dog','cat','bat','hat','fan',
  'gem','gum','hip','hop','hug','jam','jar','jet','jog','kit',
  'leg','lip','log','mix','mud','nap','nut','pad','pal','pen',
  'pet','pig','pin','pit','pot','pup','rag','ram','rat','rib',
  'rim','rip','rod','rug','run','sap','set','sit','sob','sum',
] as const

function getLastChar(word: string): string {
  return word[word.length - 1]
}

function findWordsStartingWith(char: string, exclude: string): string[] {
  return WORD_POOL.filter((w) => w[0] === char && w !== exclude)
}

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

interface RoundData {
  readonly currentWord: string
  readonly choices: readonly string[]
  readonly correctIndex: number
}

function generateRound(currentWord: string): RoundData {
  const lastChar = getLastChar(currentWord)
  const validAnswers = findWordsStartingWith(lastChar, currentWord)

  if (validAnswers.length === 0) {
    const fallbackWord = pickRandom(WORD_POOL)
    return generateRound(fallbackWord)
  }

  const correctAnswer = pickRandom(validAnswers)
  const distractorPool = WORD_POOL.filter(
    (w) => w !== correctAnswer && w !== currentWord && w[0] !== lastChar,
  )

  const distractors: string[] = []
  const usedIndices = new Set<number>()
  while (distractors.length < CHOICE_COUNT - 1 && usedIndices.size < distractorPool.length) {
    const idx = Math.floor(Math.random() * distractorPool.length)
    if (!usedIndices.has(idx)) {
      usedIndices.add(idx)
      distractors.push(distractorPool[idx])
    }
  }
  while (distractors.length < CHOICE_COUNT - 1) {
    distractors.push(WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)])
  }

  const allChoices = shuffleArray([correctAnswer, ...distractors])
  const correctIndex = allChoices.indexOf(correctAnswer)

  return { currentWord, choices: allChoices, correctIndex }
}

function generateInitialRound(): RoundData {
  const startWord = pickRandom(WORD_POOL)
  return generateRound(startWord)
}

function WordChainGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()

  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [round, setRound] = useState<RoundData>(() => generateInitialRound())
  const [correctFlash, setCorrectFlash] = useState(false)
  const [wrongShake, setWrongShake] = useState(false)
  const [lastAnsweredIndex, setLastAnsweredIndex] = useState<number | null>(null)
  const [lastAnswerCorrect, setLastAnswerCorrect] = useState<boolean | null>(null)
  const [wordTimeMs, setWordTimeMs] = useState(PER_WORD_TIME_MS)
  const [isFever, setIsFever] = useState(false)
  const [isBonusRound, setIsBonusRound] = useState(false)
  const [wordHistory, setWordHistory] = useState<string[]>([])
  const [totalCorrect, setTotalCorrect] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [perWordTimeLeft, setPerWordTimeLeft] = useState(PER_WORD_TIME_MS)
  const [showStreakMilestone, setShowStreakMilestone] = useState(false)
  const [difficulty, setDifficulty] = useState(1)
  const [wordTransition, setWordTransition] = useState(false)
  const [feverPulse, setFeverPulse] = useState(false)

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const wordTimeMsRef = useRef(PER_WORD_TIME_MS)
  const perWordTimeLeftRef = useRef(PER_WORD_TIME_MS)
  const isBonusRoundRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const correctFlashTimerRef = useRef<number | null>(null)
  const wrongShakeTimerRef = useRef<number | null>(null)
  const inputLockedRef = useRef(false)
  const totalCorrectRef = useRef(0)
  const maxComboRef = useRef(0)
  const timeWarningPlayedRef = useRef(false)

  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const wrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const timeWarningAudioRef = useRef<HTMLAudioElement | null>(null)
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
    clearTimeoutSafe(correctFlashTimerRef)
    clearTimeoutSafe(wrongShakeTimerRef)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.7, 0.95)
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  const advanceRound = useCallback((correctAnswer: string) => {
    setWordTransition(true)
    setTimeout(() => setWordTransition(false), 200)

    const nextRound = generateRound(correctAnswer)
    setRound(nextRound)
    setLastAnsweredIndex(null)
    setLastAnswerCorrect(null)
    inputLockedRef.current = false

    const nextWordTime = Math.max(MIN_PER_WORD_TIME_MS, PER_WORD_TIME_MS - comboRef.current * TIME_DECREASE_PER_COMBO)
    wordTimeMsRef.current = nextWordTime
    perWordTimeLeftRef.current = nextWordTime
    setWordTimeMs(nextWordTime)
    setPerWordTimeLeft(nextWordTime)

    const isBonus = Math.random() < BONUS_ROUND_CHANCE
    isBonusRoundRef.current = isBonus
    setIsBonusRound(isBonus)

    // Difficulty scaling
    const newDiff = Math.min(5, 1 + Math.floor(totalCorrectRef.current / DIFFICULTY_WORD_COUNT_THRESHOLD))
    setDifficulty(newDiff)
  }, [])

  const handleChoice = useCallback(
    (choiceIndex: number) => {
      if (finishedRef.current || inputLockedRef.current) return

      const currentRound = round
      const isCorrect = choiceIndex === currentRound.correctIndex
      const chosenWord = currentRound.choices[choiceIndex]

      setLastAnsweredIndex(choiceIndex)
      setLastAnswerCorrect(isCorrect)
      inputLockedRef.current = true

      if (isCorrect) {
        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        totalCorrectRef.current += 1
        setTotalCorrect(totalCorrectRef.current)

        if (nextCombo > maxComboRef.current) {
          maxComboRef.current = nextCombo
          setMaxCombo(nextCombo)
        }

        setWordHistory(prev => [...prev.slice(-6), chosenWord])

        const feverActive = nextCombo >= FEVER_COMBO_THRESHOLD
        const feverJustActivated = feverActive && !isFever
        setIsFever(feverActive)

        if (feverJustActivated) {
          playAudio(feverAudioRef, 0.6)
          setFeverPulse(true)
          setTimeout(() => setFeverPulse(false), 600)
        }

        const comboMultiplier = 1 + Math.floor(nextCombo / COMBO_MULTIPLIER_STEP)
        let points = CORRECT_SCORE * comboMultiplier
        if (nextCombo > 0 && nextCombo % COMBO_BONUS_THRESHOLD === 0) {
          points += COMBO_BONUS_EXTRA
        }
        if (isBonusRoundRef.current) points *= BONUS_ROUND_MULTIPLIER
        if (feverActive) points *= FEVER_MULTIPLIER

        // Speed bonus: faster answer = more points
        const timeRatio = perWordTimeLeftRef.current / wordTimeMsRef.current
        if (timeRatio > 0.7) points += 3
        else if (timeRatio > 0.5) points += 1

        const nextScore = scoreRef.current + points
        scoreRef.current = nextScore
        setScore(nextScore)

        // Time bonus on correct
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_ON_CORRECT_MS)

        // Streak milestone
        if (nextCombo > 0 && nextCombo % STREAK_MILESTONE === 0) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + STREAK_TIME_BONUS_MS)
          setShowStreakMilestone(true)
          setTimeout(() => setShowStreakMilestone(false), 1200)
          playAudio(comboAudioRef, 0.7, 1.2)
        } else if (nextCombo % COMBO_BONUS_THRESHOLD === 0) {
          playAudio(comboAudioRef, 0.6, 1 + Math.min(0.3, nextCombo * 0.01))
        } else {
          playAudio(correctAudioRef, 0.5, 1 + Math.min(0.3, nextCombo * 0.01))
        }

        setCorrectFlash(true)
        clearTimeoutSafe(correctFlashTimerRef)

        effects.comboHitBurst(200, 300, nextCombo, points)
        if (feverActive) effects.triggerFlash('rgba(250,204,21,0.35)')

        correctFlashTimerRef.current = window.setTimeout(() => {
          correctFlashTimerRef.current = null
          setCorrectFlash(false)
          advanceRound(chosenWord)
        }, CORRECT_FLASH_DURATION_MS)
      } else {
        comboRef.current = 0
        setCombo(0)
        setIsFever(false)

        const nextScore = Math.max(0, scoreRef.current + WRONG_SCORE)
        scoreRef.current = nextScore
        setScore(nextScore)

        setWrongShake(true)
        clearTimeoutSafe(wrongShakeTimerRef)
        playAudio(wrongAudioRef, 0.5, 0.8)

        effects.triggerShake(6)
        effects.triggerFlash('rgba(239,68,68,0.3)')

        wrongShakeTimerRef.current = window.setTimeout(() => {
          wrongShakeTimerRef.current = null
          setWrongShake(false)
          const correctWord = currentRound.choices[currentRound.correctIndex]
          advanceRound(correctWord)
        }, WRONG_SHAKE_DURATION_MS)
      }
    },
    [round, advanceRound, playAudio, isFever, effects],
  )

  useEffect(() => {
    const audios = [
      { ref: correctAudioRef, src: correctSfx },
      { ref: wrongAudioRef, src: wrongSfx },
      { ref: comboAudioRef, src: comboSfx },
      { ref: feverAudioRef, src: feverSfx },
      { ref: timeWarningAudioRef, src: timeWarningSfx },
      { ref: gameOverAudioRef, src: gameOverSfx },
    ]
    audios.forEach(({ ref, src }) => {
      const a = new Audio(src)
      a.preload = 'auto'
      ref.current = a
    })

    return () => {
      clearTimeoutSafe(correctFlashTimerRef)
      clearTimeoutSafe(wrongShakeTimerRef)
      audios.forEach(({ ref }) => { ref.current = null })
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
      }
      // Number key shortcuts
      const keyMap: Record<string, number> = { 'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3 }
      if (event.code in keyMap) {
        event.preventDefault()
        handleChoice(keyMap[event.code])
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit, handleChoice])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Per-word timer
      if (!inputLockedRef.current) {
        perWordTimeLeftRef.current = Math.max(0, perWordTimeLeftRef.current - deltaMs)
        setPerWordTimeLeft(perWordTimeLeftRef.current)

        // Auto-wrong if per-word time runs out
        if (perWordTimeLeftRef.current <= 0) {
          inputLockedRef.current = true
          setWrongShake(true)
          playAudio(wrongAudioRef, 0.4, 0.7)
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.25)')

          comboRef.current = 0
          setCombo(0)
          setIsFever(false)
          const penalty = Math.max(0, scoreRef.current + WRONG_SCORE)
          scoreRef.current = penalty
          setScore(penalty)

          clearTimeoutSafe(wrongShakeTimerRef)
          wrongShakeTimerRef.current = window.setTimeout(() => {
            wrongShakeTimerRef.current = null
            setWrongShake(false)
            const startWord = pickRandom(WORD_POOL)
            advanceRound(startWord)
          }, WRONG_SHAKE_DURATION_MS)
        }
      }

      // Time warning sound
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        playAudio(timeWarningAudioRef, 0.4)
      }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
      }

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
  }, [finishGame, advanceRound, playAudio, effects])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const lastChar = getLastChar(round.currentWord)
  const wordTimePercent = wordTimeMs > 0 ? Math.max(0, Math.min(100, (perWordTimeLeft / wordTimeMs) * 100)) : 0
  const globalTimePercent = (remainingMs / ROUND_DURATION_MS) * 100

  return (
    <section className="wc-panel" aria-label="word-chain-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <style>{WC_STYLES}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Global time bar */}
      <div className="wc-global-time-bar">
        <div
          className={`wc-global-time-fill ${isLowTime ? 'low' : ''}`}
          style={{ width: `${globalTimePercent}%` }}
        />
      </div>

      {/* Header */}
      <div className="wc-header">
        <div className="wc-header-left">
          <div className="wc-score-big">{score.toLocaleString()}</div>
          <div className="wc-best-label">BEST {displayedBestScore.toLocaleString()}</div>
        </div>
        <div className="wc-header-right">
          <div className={`wc-timer ${isLowTime ? 'low' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </div>
          <div className="wc-difficulty">Lv.{difficulty}</div>
        </div>
      </div>

      {/* Combo bar */}
      <div className="wc-combo-bar">
        <span className="wc-combo-label">
          COMBO <strong>{combo}</strong>
          {combo >= COMBO_MULTIPLIER_STEP && (
            <span className="wc-combo-mult">x{1 + Math.floor(combo / COMBO_MULTIPLIER_STEP)}</span>
          )}
        </span>
        {combo >= COMBO_BONUS_THRESHOLD && (
          <span className="wc-combo-bonus">+{COMBO_BONUS_EXTRA} bonus</span>
        )}
        {maxCombo > 0 && (
          <span className="wc-max-combo">MAX {maxCombo}</span>
        )}
      </div>

      {/* Status banners */}
      {isFever && (
        <div className={`wc-fever-banner ${feverPulse ? 'pulse' : ''}`}>
          FEVER x{FEVER_MULTIPLIER}
        </div>
      )}
      {isBonusRound && (
        <div className="wc-bonus-banner">
          BONUS ROUND x{BONUS_ROUND_MULTIPLIER}!
        </div>
      )}
      {showStreakMilestone && (
        <div className="wc-streak-banner">
          {combo} STREAK! +{(STREAK_TIME_BONUS_MS / 1000).toFixed(0)}s
        </div>
      )}

      {/* Word history trail */}
      {wordHistory.length > 0 && (
        <div className="wc-history">
          {wordHistory.map((w, i) => (
            <span key={`hist-${i}-${w}`} className="wc-history-word" style={{ opacity: 0.4 + (i / wordHistory.length) * 0.6 }}>
              {w}
            </span>
          ))}
        </div>
      )}

      {/* Arena - main word display */}
      <div className={`wc-arena ${correctFlash ? 'correct' : ''} ${wrongShake ? 'wrong' : ''} ${wordTransition ? 'transition' : ''}`}>
        <div className="wc-current-word">
          <span className="wc-word-body">{round.currentWord.slice(0, -1)}</span>
          <span className="wc-word-highlight">{lastChar}</span>
        </div>
        <div className="wc-hint">
          Pick a word starting with &lsquo;<strong>{lastChar.toUpperCase()}</strong>&rsquo;
        </div>

        {/* Per-word timer bar */}
        <div className="wc-word-timer-bar">
          <div
            className={`wc-word-timer-fill ${wordTimePercent < 30 ? 'urgent' : wordTimePercent < 60 ? 'warning' : ''}`}
            style={{ width: `${wordTimePercent}%` }}
          />
        </div>
      </div>

      {/* Choices */}
      <div className="wc-choices">
        {round.choices.map((word, index) => {
          let btnClass = 'wc-choice-btn'
          if (lastAnsweredIndex === index) {
            btnClass += lastAnswerCorrect ? ' correct' : ' wrong'
          } else if (lastAnsweredIndex !== null && index === round.correctIndex) {
            btnClass += ' reveal'
          }

          return (
            <button
              className={btnClass}
              key={`choice-${index}-${word}`}
              type="button"
              onClick={() => handleChoice(index)}
              disabled={inputLockedRef.current}
            >
              <span className="wc-choice-num">{index + 1}</span>
              {word}
            </button>
          )
        })}
      </div>

      {/* Stats footer */}
      <div className="wc-footer">
        <span>Words: {totalCorrect}</span>
        <span>Max Combo: {maxCombo}</span>
      </div>
    </section>
  )
}

const WC_STYLES = `
  .wc-panel {
    display: flex;
    flex-direction: column;
    max-width: 432px;
    aspect-ratio: 9/16;
    margin: 0 auto;
    overflow: hidden;
    position: relative;
    background: linear-gradient(180deg, #0c4a6e 0%, #164e63 30%, #1e293b 100%);
    user-select: none;
    touch-action: manipulation;
    font-family: 'Pretendard', sans-serif;
    height: 100%;
  }

  /* Global time bar */
  .wc-global-time-bar {
    height: 4px;
    background: rgba(255,255,255,0.1);
    flex-shrink: 0;
  }
  .wc-global-time-fill {
    height: 100%;
    background: linear-gradient(90deg, #22d3ee, #06b6d4);
    transition: width 0.1s linear;
  }
  .wc-global-time-fill.low {
    background: linear-gradient(90deg, #ef4444, #f97316);
    animation: wc-pulse 0.5s ease-in-out infinite alternate;
  }

  /* Header */
  .wc-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 16px;
    background: linear-gradient(135deg, rgba(8,145,178,0.4), rgba(14,116,144,0.3));
    flex-shrink: 0;
  }
  .wc-header-left {
    display: flex;
    flex-direction: column;
  }
  .wc-score-big {
    font-size: 32px;
    font-weight: 900;
    color: #fff;
    text-shadow: 0 2px 8px rgba(0,0,0,0.3);
    line-height: 1;
  }
  .wc-best-label {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.5);
    margin-top: 2px;
  }
  .wc-header-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .wc-timer {
    font-size: 24px;
    font-weight: 800;
    color: rgba(255,255,255,0.9);
    font-variant-numeric: tabular-nums;
    transition: color 0.3s;
    line-height: 1;
  }
  .wc-timer.low {
    color: #fca5a5;
    animation: wc-pulse 0.5s ease-in-out infinite alternate;
  }
  .wc-difficulty {
    font-size: 11px;
    font-weight: 700;
    color: #fbbf24;
    margin-top: 2px;
  }

  /* Combo bar */
  .wc-combo-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    background: rgba(0,0,0,0.15);
    flex-shrink: 0;
  }
  .wc-combo-label {
    font-size: 13px;
    font-weight: 600;
    color: rgba(255,255,255,0.7);
  }
  .wc-combo-label strong {
    color: #fbbf24;
    font-size: 18px;
  }
  .wc-combo-mult {
    color: #22d3ee;
    font-size: 12px;
    margin-left: 4px;
    font-weight: 700;
  }
  .wc-combo-bonus {
    font-size: 11px;
    color: #34d399;
    font-weight: 600;
  }
  .wc-max-combo {
    font-size: 10px;
    color: rgba(255,255,255,0.35);
    margin-left: auto;
  }

  /* Banners */
  .wc-fever-banner {
    text-align: center;
    color: #fbbf24;
    font-weight: 900;
    font-size: 16px;
    padding: 6px 0;
    text-shadow: 0 0 12px #f59e0b;
    background: linear-gradient(90deg, rgba(251,191,36,0.05), rgba(251,191,36,0.15), rgba(251,191,36,0.05));
    flex-shrink: 0;
    animation: wc-glow 0.6s ease-in-out infinite alternate;
  }
  .wc-fever-banner.pulse {
    animation: wc-fever-enter 0.6s ease-out;
  }
  .wc-bonus-banner {
    text-align: center;
    color: #a78bfa;
    font-weight: 800;
    font-size: 14px;
    padding: 4px 0;
    animation: wc-pop 0.5s ease-out;
    flex-shrink: 0;
  }
  .wc-streak-banner {
    text-align: center;
    color: #34d399;
    font-weight: 900;
    font-size: 18px;
    padding: 8px 0;
    animation: wc-streak-pop 1.2s ease-out forwards;
    text-shadow: 0 0 10px rgba(52,211,153,0.5);
    flex-shrink: 0;
  }

  /* Word history */
  .wc-history {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 16px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .wc-history-word {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.05);
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }
  .wc-history-word::after {
    content: ' >';
    color: rgba(255,255,255,0.2);
    margin-left: 2px;
  }
  .wc-history-word:last-child::after {
    content: '';
  }

  /* Arena */
  .wc-arena {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 16px 20px;
    margin: 8px 12px;
    border-radius: 20px;
    background: rgba(8,145,178,0.12);
    border: 2px solid rgba(8,145,178,0.25);
    transition: background 0.2s, border-color 0.2s, transform 0.15s;
    min-height: 0;
  }
  .wc-arena.correct {
    background: rgba(34,197,94,0.2);
    border-color: rgba(34,197,94,0.5);
  }
  .wc-arena.wrong {
    background: rgba(239,68,68,0.15);
    border-color: rgba(239,68,68,0.4);
    animation: wc-shake 0.4s ease-in-out;
  }
  .wc-arena.transition {
    animation: wc-word-slide 0.2s ease-out;
  }

  .wc-current-word {
    font-size: clamp(40px, 12vw, 64px);
    font-weight: 900;
    letter-spacing: 3px;
    color: #f3f4f6;
    text-align: center;
    word-break: break-all;
  }
  .wc-word-body {
    color: #e5e7eb;
  }
  .wc-word-highlight {
    color: #22d3ee;
    text-decoration: underline;
    text-decoration-color: #0891b2;
    text-underline-offset: 8px;
    text-decoration-thickness: 4px;
    font-size: 1.15em;
  }
  .wc-hint {
    font-size: 15px;
    color: rgba(255,255,255,0.55);
  }
  .wc-hint strong {
    color: #22d3ee;
    font-size: 20px;
  }

  /* Per-word timer */
  .wc-word-timer-bar {
    width: 80%;
    height: 6px;
    background: rgba(255,255,255,0.08);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 4px;
  }
  .wc-word-timer-fill {
    height: 100%;
    background: #22d3ee;
    border-radius: 3px;
    transition: width 0.1s linear;
  }
  .wc-word-timer-fill.warning {
    background: #fbbf24;
  }
  .wc-word-timer-fill.urgent {
    background: #ef4444;
    animation: wc-pulse 0.3s ease-in-out infinite alternate;
  }

  /* Choices */
  .wc-choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 0 12px 6px;
    flex-shrink: 0;
  }
  .wc-choice-btn {
    padding: 18px 10px;
    font-size: clamp(18px, 5vw, 24px);
    font-weight: 700;
    color: #e5e7eb;
    background: linear-gradient(180deg, rgba(8,145,178,0.28) 0%, rgba(8,145,178,0.15) 100%);
    border: 2px solid rgba(8,145,178,0.35);
    border-radius: 14px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, transform 0.08s;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 3px 10px rgba(0,0,0,0.25);
    touch-action: manipulation;
    position: relative;
    min-height: 60px;
  }
  .wc-choice-num {
    position: absolute;
    top: 4px;
    left: 8px;
    font-size: 10px;
    color: rgba(255,255,255,0.25);
    font-weight: 600;
  }
  .wc-choice-btn:active:not(:disabled) {
    transform: scale(0.95);
    background: rgba(8,145,178,0.4);
  }
  .wc-choice-btn:disabled {
    cursor: default;
    opacity: 0.7;
  }
  .wc-choice-btn.correct {
    background: linear-gradient(180deg, rgba(34,197,94,0.45) 0%, rgba(34,197,94,0.25) 100%);
    border-color: #22c55e;
    color: #4ade80;
    animation: wc-pop 0.3s ease-out;
    box-shadow: 0 0 16px rgba(34,197,94,0.35);
  }
  .wc-choice-btn.wrong {
    background: rgba(239,68,68,0.3);
    border-color: #ef4444;
    color: #f87171;
    animation: wc-shake 0.4s ease-in-out;
  }
  .wc-choice-btn.reveal {
    background: rgba(34,197,94,0.15);
    border-color: rgba(34,197,94,0.4);
    color: #86efac;
  }

  /* Footer */
  .wc-footer {
    display: flex;
    justify-content: space-around;
    padding: 6px 16px 10px;
    font-size: 11px;
    color: rgba(255,255,255,0.3);
    flex-shrink: 0;
  }

  /* Animations */
  @keyframes wc-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-7px); }
    40% { transform: translateX(7px); }
    60% { transform: translateX(-5px); }
    80% { transform: translateX(5px); }
  }
  @keyframes wc-pop {
    0% { transform: scale(1); }
    40% { transform: scale(1.08); }
    100% { transform: scale(1); }
  }
  @keyframes wc-pulse {
    0% { opacity: 1; }
    100% { opacity: 0.5; }
  }
  @keyframes wc-glow {
    0% { text-shadow: 0 0 8px #f59e0b; }
    100% { text-shadow: 0 0 20px #f59e0b, 0 0 40px rgba(245,158,11,0.3); }
  }
  @keyframes wc-fever-enter {
    0% { transform: scale(0.5); opacity: 0; }
    60% { transform: scale(1.15); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes wc-streak-pop {
    0% { transform: scale(0.3); opacity: 0; }
    30% { transform: scale(1.2); opacity: 1; }
    70% { transform: scale(1); opacity: 1; }
    100% { transform: scale(1); opacity: 0; }
  }
  @keyframes wc-word-slide {
    0% { transform: translateY(-10px); opacity: 0.5; }
    100% { transform: translateY(0); opacity: 1; }
  }
`

export const wordChainModule: MiniGameModule = {
  manifest: {
    id: 'word-chain',
    title: 'Word Chain',
    description: 'Word chain! Pick a word starting with the last letter!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#0891b2',
  },
  Component: WordChainGame,
}
