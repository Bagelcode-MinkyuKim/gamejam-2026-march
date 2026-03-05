import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const CORRECT_SCORE = 5
const WRONG_SCORE = -3
const COMBO_BONUS_THRESHOLD = 5
const COMBO_BONUS_EXTRA = 2
const CORRECT_FLASH_DURATION_MS = 300
const WRONG_SHAKE_DURATION_MS = 400
const LOW_TIME_THRESHOLD_MS = 5000
const CHOICE_COUNT = 4
const PER_WORD_TIME_MS = 8000
const MIN_PER_WORD_TIME_MS = 3000
const TIME_DECREASE_PER_COMBO = 300
const COMBO_MULTIPLIER_STEP = 3
const FEVER_COMBO_THRESHOLD = 10
const FEVER_MULTIPLIER = 2
const BONUS_ROUND_CHANCE = 0.15
const BONUS_ROUND_MULTIPLIER = 2

const WORD_POOL: readonly string[] = [
  '사과','과일','일출','출구','구름','름직','직업','업무','무대','대문',
  '문어','어부','부자','자리','리본','본부','부모','모자','자동','동물',
  '물고기','기차','차량','량심','심장','장미','미술','술잔','잔디','디자인',
  '인형','형제','제비','비행','행사','사진','진실','실내','내용','용기',
  '기본','본선','선물','물결','결과','과학','학교','교실','실험','험난',
  '난방','방향','향수','수박','박수','수영','영화','화분','분필','필통',
  '통화','화살','살구','구두','두부','부채','채소','소문','문화','화장',
  '장난','난로','로봇','봇짐','짐작','작품','품질','질서','서랍','랍스터',
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

  return {
    currentWord,
    choices: allChoices,
    correctIndex,
  }
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

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const wordTimeMsRef = useRef(PER_WORD_TIME_MS)
  const isBonusRoundRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const correctFlashTimerRef = useRef<number | null>(null)
  const wrongShakeTimerRef = useRef<number | null>(null)
  const inputLockedRef = useRef(false)

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
      if (audio === null) {
        return
      }
      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true
    clearTimeoutSafe(correctFlashTimerRef)
    clearTimeoutSafe(wrongShakeTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.64, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const advanceRound = useCallback((correctAnswer: string) => {
    const nextRound = generateRound(correctAnswer)
    setRound(nextRound)
    setLastAnsweredIndex(null)
    setLastAnswerCorrect(null)
    inputLockedRef.current = false

    // Decrease per-word time with combo
    const nextWordTime = Math.max(MIN_PER_WORD_TIME_MS, PER_WORD_TIME_MS - comboRef.current * TIME_DECREASE_PER_COMBO)
    wordTimeMsRef.current = nextWordTime
    setWordTimeMs(nextWordTime)

    // Bonus round chance
    const isBonus = Math.random() < BONUS_ROUND_CHANCE
    isBonusRoundRef.current = isBonus
    setIsBonusRound(isBonus)
  }, [])

  const handleChoice = useCallback(
    (choiceIndex: number) => {
      if (finishedRef.current || inputLockedRef.current) {
        return
      }

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

        const feverActive = nextCombo >= FEVER_COMBO_THRESHOLD
        setIsFever(feverActive)

        const comboMultiplier = 1 + Math.floor(nextCombo / COMBO_MULTIPLIER_STEP)
        let points = CORRECT_SCORE * comboMultiplier
        if (nextCombo > 0 && nextCombo % COMBO_BONUS_THRESHOLD === 0) {
          points += COMBO_BONUS_EXTRA
        }
        if (isBonusRoundRef.current) {
          points *= BONUS_ROUND_MULTIPLIER
        }
        if (feverActive) {
          points *= FEVER_MULTIPLIER
        }

        const nextScore = scoreRef.current + points
        scoreRef.current = nextScore
        setScore(nextScore)

        setCorrectFlash(true)
        clearTimeoutSafe(correctFlashTimerRef)

        if (nextCombo % COMBO_BONUS_THRESHOLD === 0) {
          playAudio(tapHitStrongAudioRef, 0.6, 1 + Math.min(0.3, nextCombo * 0.01))
        } else {
          playAudio(tapHitAudioRef, 0.5, 1 + Math.min(0.2, nextCombo * 0.008))
        }

        // Visual effects for correct answer
        effects.comboHitBurst(200, 200, nextCombo, points)
        if (feverActive) {
          effects.triggerFlash('rgba(250,204,21,0.4)')
        }

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
        playAudio(tapHitAudioRef, 0.4, 0.7)

        // Visual effects for wrong answer
        effects.triggerShake(5)
        effects.triggerFlash('rgba(239,68,68,0.3)')

        wrongShakeTimerRef.current = window.setTimeout(() => {
          wrongShakeTimerRef.current = null
          setWrongShake(false)

          const correctWord = currentRound.choices[currentRound.correctIndex]
          advanceRound(correctWord)
        }, WRONG_SHAKE_DURATION_MS)
      }
    },
    [round, advanceRound, playAudio],
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
      clearTimeoutSafe(correctFlashTimerRef)
      clearTimeoutSafe(wrongShakeTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
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
  }, [finishGame])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const lastChar = getLastChar(round.currentWord)

  return (
    <section className="mini-game-panel word-chain-panel" aria-label="word-chain-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="word-chain-header">
        <img className="word-chain-header-avatar" src={parkSangminSprite} alt="박상민" />
        <div className="word-chain-header-info">
          <div className="word-chain-header-score-row">
            <p className="word-chain-score">{score.toLocaleString()}</p>
            <p className="word-chain-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
          <div className="word-chain-combo-row" style={{ padding: 0 }}>
            <p className="word-chain-combo">
              COMBO <strong>{combo}</strong>
              {combo >= COMBO_MULTIPLIER_STEP && (
                <span style={{ color: '#22d3ee', fontSize: 12, marginLeft: 6 }}>
                  x{1 + Math.floor(combo / COMBO_MULTIPLIER_STEP)}
                </span>
              )}
            </p>
            {combo >= COMBO_BONUS_THRESHOLD && (
              <p className="word-chain-combo-bonus">
                +{COMBO_BONUS_EXTRA} bonus
              </p>
            )}
          </div>
        </div>
        <p className={`word-chain-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      {isFever && (
        <div style={{ textAlign: 'center', color: '#fbbf24', fontWeight: 800, fontSize: 15, padding: '6px 0', textShadow: '0 0 8px #f59e0b', animation: 'word-chain-pulse 0.4s ease-in-out infinite alternate', background: 'rgba(251,191,36,0.1)' }}>
          FEVER x{FEVER_MULTIPLIER}
        </div>
      )}
      {isBonusRound && (
        <div style={{ textAlign: 'center', color: '#a78bfa', fontWeight: 800, fontSize: 14, padding: '4px 0', animation: 'word-chain-pop 0.5s ease-out' }}>
          BONUS ROUND x{BONUS_ROUND_MULTIPLIER}!
        </div>
      )}

      <div
        className={`word-chain-arena ${correctFlash ? 'correct-flash' : ''} ${wrongShake ? 'wrong-shake' : ''}`}
      >
        <div className="word-chain-current-word">
          <span className="word-chain-word-body">
            {round.currentWord.slice(0, -1)}
          </span>
          <span className="word-chain-word-highlight">
            {lastChar}
          </span>
        </div>

        <p className="word-chain-hint">
          &lsquo;<strong>{lastChar}</strong>&rsquo;(으)로 시작하는 단어는?
        </p>
      </div>

      <div className="word-chain-choices">
        {round.choices.map((word, index) => {
          let btnClass = 'word-chain-choice-button'
          if (lastAnsweredIndex === index) {
            btnClass += lastAnswerCorrect ? ' choice-correct' : ' choice-wrong'
          } else if (lastAnsweredIndex !== null && index === round.correctIndex) {
            btnClass += ' choice-reveal'
          }

          return (
            <button
              className={btnClass}
              key={`choice-${index}-${word}`}
              type="button"
              onClick={() => handleChoice(index)}
              disabled={inputLockedRef.current}
            >
              {word}
            </button>
          )
        })}
      </div>

      <button className="word-chain-exit-btn" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>

      <style>{`
        .word-chain-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 16px;
          width: 100%;
          box-sizing: border-box;
          font-family: 'Pretendard', sans-serif;
        }

        .word-chain-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 0 4px;
        }

        .word-chain-score {
          font-size: 28px;
          font-weight: 800;
          color: #0891b2;
          margin: 0;
        }

        .word-chain-best {
          font-size: 13px;
          font-weight: 600;
          color: #9ca3af;
          margin: 0;
        }

        .word-chain-time {
          font-size: 20px;
          font-weight: 700;
          color: #e5e7eb;
          margin: 0;
          transition: color 0.3s;
        }

        .word-chain-time.low-time {
          color: #ef4444;
          animation: word-chain-pulse 0.5s ease-in-out infinite alternate;
        }

        .word-chain-combo-row {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 0 4px;
        }

        .word-chain-combo {
          font-size: 15px;
          font-weight: 600;
          color: #d1d5db;
          margin: 0;
        }

        .word-chain-combo strong {
          color: #fbbf24;
          font-size: 18px;
        }

        .word-chain-combo-bonus {
          font-size: 11px;
          color: #34d399;
          margin: 0;
        }

        .word-chain-arena {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          padding: 24px 16px;
          width: 100%;
          border-radius: 16px;
          background: rgba(8, 145, 178, 0.08);
          border: 2px solid rgba(8, 145, 178, 0.2);
          transition: background 0.2s, border-color 0.2s;
          box-sizing: border-box;
        }

        .word-chain-arena.correct-flash {
          background: rgba(34, 197, 94, 0.15);
          border-color: rgba(34, 197, 94, 0.5);
        }

        .word-chain-arena.wrong-shake {
          background: rgba(239, 68, 68, 0.12);
          border-color: rgba(239, 68, 68, 0.4);
          animation: word-chain-shake 0.4s ease-in-out;
        }

        .word-chain-character {
          width: 80px;
          height: 80px;
          object-fit: contain;
          border-radius: 50%;
          border: 2px solid rgba(8, 145, 178, 0.4);
          background: rgba(8, 145, 178, 0.1);
        }

        .word-chain-current-word {
          font-size: 52px;
          font-weight: 900;
          letter-spacing: 4px;
          color: #f3f4f6;
          user-select: none;
        }

        .word-chain-word-body {
          color: #e5e7eb;
        }

        .word-chain-word-highlight {
          color: #22d3ee;
          text-decoration: underline;
          text-decoration-color: #0891b2;
          text-underline-offset: 6px;
          text-decoration-thickness: 3px;
        }

        .word-chain-hint {
          font-size: 16px;
          color: #9ca3af;
          margin: 0;
        }

        .word-chain-hint strong {
          color: #22d3ee;
          font-size: 18px;
        }

        .word-chain-choices {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          width: 100%;
        }

        .word-chain-choice-button {
          padding: 16px 8px;
          font-size: 22px;
          font-weight: 700;
          color: #e5e7eb;
          background: rgba(255, 255, 255, 0.06);
          border: 2px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
        }

        .word-chain-choice-button:active:not(:disabled) {
          transform: scale(0.96);
        }

        .word-chain-choice-button:disabled {
          cursor: default;
          opacity: 0.7;
        }

        .word-chain-choice-button.choice-correct {
          background: rgba(34, 197, 94, 0.25);
          border-color: #22c55e;
          color: #4ade80;
          animation: word-chain-pop 0.3s ease-out;
        }

        .word-chain-choice-button.choice-wrong {
          background: rgba(239, 68, 68, 0.2);
          border-color: #ef4444;
          color: #f87171;
          animation: word-chain-shake 0.4s ease-in-out;
        }

        .word-chain-choice-button.choice-reveal {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.4);
          color: #86efac;
        }

        @keyframes word-chain-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        @keyframes word-chain-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }

        @keyframes word-chain-pulse {
          0% { opacity: 1; }
          100% { opacity: 0.5; }
        }

        .word-chain-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #0c4a6e 0%, #164e63 40%, #1e293b 100%);
          user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
          align-items: stretch;
          font-family: 'Pretendard', sans-serif;
        }

        .word-chain-header {
          background: linear-gradient(135deg, #0891b2, #0e7490);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .word-chain-header-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 3px solid rgba(255,255,255,0.4);
          object-fit: contain;
          background: rgba(255,255,255,0.1);
          flex-shrink: 0;
        }

        .word-chain-header-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .word-chain-header-score-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .word-chain-score-strip {
          display: none;
        }

        .word-chain-combo-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 16px;
        }

        .word-chain-score {
          font-size: 28px;
          font-weight: 800;
          color: #fff;
          margin: 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .word-chain-best {
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,0.6);
          margin: 0;
        }

        .word-chain-time {
          font-size: 18px;
          font-weight: 700;
          color: rgba(255,255,255,0.9);
          margin: 0;
          margin-left: auto;
          font-variant-numeric: tabular-nums;
          transition: color 0.3s;
        }

        .word-chain-time.low-time {
          color: #fca5a5;
          animation: word-chain-pulse 0.5s ease-in-out infinite alternate;
        }

        .word-chain-combo {
          font-size: 14px;
          font-weight: 600;
          color: rgba(255,255,255,0.7);
          margin: 0;
        }

        .word-chain-combo strong {
          color: #fbbf24;
          font-size: 18px;
        }

        .word-chain-combo-bonus {
          font-size: 11px;
          color: #34d399;
          margin: 0;
        }

        .word-chain-arena {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 16px;
          margin: 8px 12px;
          border-radius: 16px;
          background: rgba(8, 145, 178, 0.12);
          border: 2px solid rgba(8, 145, 178, 0.25);
          transition: background 0.2s, border-color 0.2s;
          box-sizing: border-box;
        }

        .word-chain-arena.correct-flash {
          background: rgba(34, 197, 94, 0.2);
          border-color: rgba(34, 197, 94, 0.5);
        }

        .word-chain-arena.wrong-shake {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.4);
          animation: word-chain-shake 0.4s ease-in-out;
        }

        .word-chain-character {
          width: 64px;
          height: 64px;
          object-fit: contain;
          border-radius: 50%;
          border: 3px solid rgba(8, 145, 178, 0.5);
          background: rgba(8, 145, 178, 0.15);
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }

        .word-chain-current-word {
          font-size: 48px;
          font-weight: 900;
          letter-spacing: 4px;
          color: #f3f4f6;
          user-select: none;
        }

        .word-chain-word-body {
          color: #e5e7eb;
        }

        .word-chain-word-highlight {
          color: #22d3ee;
          text-decoration: underline;
          text-decoration-color: #0891b2;
          text-underline-offset: 6px;
          text-decoration-thickness: 3px;
        }

        .word-chain-hint {
          font-size: 15px;
          color: rgba(255,255,255,0.6);
          margin: 0;
        }

        .word-chain-hint strong {
          color: #22d3ee;
          font-size: 17px;
        }

        .word-chain-choices {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          padding: 0 12px 8px;
        }

        .word-chain-choice-button {
          padding: 16px 8px;
          font-size: 22px;
          font-weight: 700;
          color: #e5e7eb;
          background: linear-gradient(180deg, rgba(8,145,178,0.25) 0%, rgba(8,145,178,0.15) 100%);
          border: 2px solid rgba(8,145,178,0.35);
          border-radius: 14px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
          user-select: none;
          -webkit-tap-highlight-color: transparent;
          box-shadow: 0 3px 8px rgba(0,0,0,0.2);
          touch-action: manipulation;
        }

        .word-chain-choice-button:active:not(:disabled) {
          transform: scale(0.95);
          background: rgba(8,145,178,0.35);
        }

        .word-chain-choice-button:disabled {
          cursor: default;
          opacity: 0.7;
        }

        .word-chain-choice-button.choice-correct {
          background: linear-gradient(180deg, rgba(34,197,94,0.4) 0%, rgba(34,197,94,0.2) 100%);
          border-color: #22c55e;
          color: #4ade80;
          animation: word-chain-pop 0.3s ease-out;
          box-shadow: 0 0 12px rgba(34,197,94,0.3);
        }

        .word-chain-choice-button.choice-wrong {
          background: rgba(239, 68, 68, 0.25);
          border-color: #ef4444;
          color: #f87171;
          animation: word-chain-shake 0.4s ease-in-out;
        }

        .word-chain-choice-button.choice-reveal {
          background: rgba(34, 197, 94, 0.15);
          border-color: rgba(34, 197, 94, 0.4);
          color: #86efac;
        }

        .word-chain-exit-btn {
          padding: 10px 16px;
          margin: 4px 12px 12px;
          font-size: 13px;
          font-weight: 600;
          color: rgba(255,255,255,0.5);
          background: transparent;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 10px;
          cursor: pointer;
          transition: background 0.15s;
          -webkit-tap-highlight-color: transparent;
        }

        .word-chain-exit-btn:active {
          background: rgba(255,255,255,0.08);
        }

        @keyframes word-chain-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }

        @keyframes word-chain-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.06); }
          100% { transform: scale(1); }
        }

        @keyframes word-chain-pulse {
          0% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      `}</style>
    </section>
  )
}

export const wordChainModule: MiniGameModule = {
  manifest: {
    id: 'word-chain',
    title: 'Word Chain',
    description: '끝말잇기! 마지막 글자로 시작하는 단어를 빠르게 골라라!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#0891b2',
  },
  Component: WordChainGame,
}
