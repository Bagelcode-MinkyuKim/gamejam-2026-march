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
import levelUpSfx from '../../../assets/sounds/word-chain-levelup.mp3'
import powerupSfx from '../../../assets/sounds/word-chain-powerup.mp3'
import tickSfx from '../../../assets/sounds/word-chain-tick.mp3'
import wordChainBgmLoop from '../../../assets/sounds/generated/word-chain/word-chain-bgm-loop.mp3'

// ── Game Config ──
const ROUND_DURATION_MS = 50000
const CORRECT_SCORE = 5
const WRONG_SCORE = -3
const COMBO_BONUS_THRESHOLD = 5
const COMBO_BONUS_EXTRA = 3
const CORRECT_FLASH_DURATION_MS = 250
const WRONG_SHAKE_DURATION_MS = 350
const LOW_TIME_THRESHOLD_MS = 7000
const CHOICE_COUNT = 4
const PER_WORD_TIME_MS = 8000
const MIN_PER_WORD_TIME_MS = 2200
const TIME_DECREASE_PER_COMBO = 200
const COMBO_MULTIPLIER_STEP = 3
const FEVER_COMBO_THRESHOLD = 8
const FEVER_MULTIPLIER = 2
const BONUS_ROUND_CHANCE = 0.12
const BONUS_ROUND_MULTIPLIER = 2
const TIME_BONUS_ON_CORRECT_MS = 900
const STREAK_MILESTONE = 10
const STREAK_TIME_BONUS_MS = 2500
const DIFFICULTY_WORD_COUNT_THRESHOLD = 12
const FIFTY_FIFTY_THRESHOLD = 3
const WORD_GOAL_INTERVAL = 10
const WORD_GOAL_BONUS_SCORE = 20
const WORD_GOAL_BONUS_TIME_MS = 3000
const TICK_SOUND_INTERVAL_MS = 1000
const WORD_CHAIN_BGM_VOLUME = 0.22

// ── Powerup Types ──
type PowerupType = 'freeze' | 'double' | 'reveal'
const POWERUP_SPAWN_INTERVAL = 8

// ── Pixel Companion Moods ──
type CompanionMood = 'idle' | 'happy' | 'sad' | 'fever' | 'scared'

// ── Pixel Stars (decorative) ──
interface PixelStar { x: number; y: number; size: number; speed: number; phase: number }

function createStars(count: number): PixelStar[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() > 0.7 ? 3 : 2,
    speed: 0.3 + Math.random() * 0.7,
    phase: Math.random() * Math.PI * 2,
  }))
}

// ── Word Pool ──
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
  'sand','silk','skin','skip','slow','snap','soft','song','sort','spin',
  'step','stop','swim','tall','tank','team','thin','tide','tone','turn',
  'unit','upon','vast','vent','vote','walk','wall','warm','wash','wild',
  'wind','wing','wise','wolf','wood','yard','year','yell','zero','zone',
] as const

function getLastChar(word: string): string { return word[word.length - 1] }
function findWordsStartingWith(char: string, exclude: string): string[] {
  return WORD_POOL.filter((w) => w[0] === char && w !== exclude)
}
function pickRandom<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function shuffleArray<T>(arr: T[]): T[] {
  const s = [...arr]
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const t = s[i]; s[i] = s[j]; s[j] = t
  }
  return s
}

interface RoundData {
  readonly currentWord: string
  readonly choices: readonly string[]
  readonly correctIndex: number
}

function generateRound(currentWord: string): RoundData {
  const lastChar = getLastChar(currentWord)
  const valid = findWordsStartingWith(lastChar, currentWord)
  if (valid.length === 0) return generateRound(pickRandom(WORD_POOL))
  const correct = pickRandom(valid)
  const pool = WORD_POOL.filter((w) => w !== correct && w !== currentWord && w[0] !== lastChar)
  const dist: string[] = []
  const used = new Set<number>()
  while (dist.length < CHOICE_COUNT - 1 && used.size < pool.length) {
    const i = Math.floor(Math.random() * pool.length)
    if (!used.has(i)) { used.add(i); dist.push(pool[i]) }
  }
  while (dist.length < CHOICE_COUNT - 1) dist.push(WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)])
  const all = shuffleArray([correct, ...dist])
  return { currentWord, choices: all, correctIndex: all.indexOf(correct) }
}

// ── Pixel Companion Component ──
function PixelCompanion({ mood, combo }: { mood: CompanionMood; combo: number }) {
  const moodColors: Record<CompanionMood, { body: string; eye: string; mouth: string }> = {
    idle: { body: '#4ade80', eye: '#000', mouth: '#000' },
    happy: { body: '#fbbf24', eye: '#000', mouth: '#ef4444' },
    sad: { body: '#60a5fa', eye: '#000', mouth: '#334155' },
    fever: { body: '#f97316', eye: '#fff', mouth: '#ef4444' },
    scared: { body: '#c084fc', eye: '#000', mouth: '#000' },
  }
  const c = moodColors[mood]
  const bounceClass = mood === 'happy' ? 'px-bounce' : mood === 'fever' ? 'px-fever-bounce' : mood === 'sad' ? 'px-sad' : ''

  return (
    <div className={`px-companion ${bounceClass}`}>
      <div className="px-comp-body" style={{ background: c.body }}>
        <div className="px-comp-eye-l" style={{ background: c.eye }} />
        <div className="px-comp-eye-r" style={{ background: c.eye }} />
        <div className={`px-comp-mouth ${mood}`} style={{ background: c.mouth }} />
        {mood === 'fever' && <div className="px-comp-flame" />}
        {combo >= 5 && <div className="px-comp-sparkle" />}
      </div>
      {mood === 'happy' && <div className="px-comp-note">+</div>}
    </div>
  )
}

// ── Mini Boss Bar (appears at word goals) ──
function MiniBossBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const pct = Math.max(0, (hp / maxHp) * 100)
  return (
    <div className="px-boss-bar">
      <span className="px-boss-label">BOSS</span>
      <div className="px-boss-track">
        <div className="px-boss-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="px-boss-hp">{hp}/{maxHp}</span>
    </div>
  )
}

function WordChainGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()

  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [round, setRound] = useState<RoundData>(() => generateRound(pickRandom(WORD_POOL)))
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
  const [consecutiveWrong, setConsecutiveWrong] = useState(0)
  const [hintActive, setHintActive] = useState(false)
  const [activePowerup, setActivePowerup] = useState<PowerupType | null>(null)
  const [powerupReady, setPowerupReady] = useState(false)
  const [isTimeFrozen, setIsTimeFrozen] = useState(false)
  const [showWordGoal, setShowWordGoal] = useState(false)
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [companionMood, setCompanionMood] = useState<CompanionMood>('idle')
  const [bossHp, setBossHp] = useState(0)
  const [bossMaxHp, setBossMaxHp] = useState(0)
  const [bossActive, setBossActive] = useState(false)
  const [screenFlash, setScreenFlash] = useState('')
  const [pixelStars] = useState(() => createStars(20))
  const [starTime, setStarTime] = useState(0)

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
  const consecutiveWrongRef = useRef(0)
  const isTimeFrozenRef = useRef(false)
  const freezeTimerRef = useRef<number | null>(null)
  const prevDifficultyRef = useRef(1)
  const lastTickSoundRef = useRef(0)
  const bossHpRef = useRef(0)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const clearTimeoutSafe = (r: { current: number | null }) => {
    if (r.current !== null) { window.clearTimeout(r.current); r.current = null }
  }

  const playAudio = useCallback((name: string, volume: number, rate = 1) => {
    const a = audioRefs.current[name]
    if (!a) return
    a.currentTime = 0
    a.volume = Math.min(1, Math.max(0, volume))
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const startBgm = useCallback(() => {
    const bgm = bgmRef.current
    if (bgm === null || finishedRef.current || !bgm.paused) return
    void bgm.play().catch(() => {})
  }, [])

  const triggerScreenFlash = useCallback((color: string) => {
    setScreenFlash(color)
    setTimeout(() => setScreenFlash(''), 150)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(correctFlashTimerRef)
    clearTimeoutSafe(wrongShakeTimerRef)
    clearTimeoutSafe(freezeTimerRef)
    setCompanionMood('sad')
    if (bgmRef.current !== null) {
      bgmRef.current.pause()
      bgmRef.current.currentTime = 0
    }
    playAudio('gameover', 0.7, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)),
    })
  }, [onFinish, playAudio])

  const advanceRound = useCallback((correctAnswer: string) => {
    setWordTransition(true)
    setTimeout(() => setWordTransition(false), 200)

    const nextRound = generateRound(correctAnswer)
    setRound(nextRound)
    setLastAnsweredIndex(null)
    setLastAnswerCorrect(null)
    setHintActive(false)
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
    if (newDiff > prevDifficultyRef.current) {
      prevDifficultyRef.current = newDiff
      setShowLevelUp(true)
      playAudio('levelup', 0.6)
      triggerScreenFlash('rgba(167,139,250,0.4)')
      setTimeout(() => setShowLevelUp(false), 1500)
    }
    setDifficulty(newDiff)

    // Powerup spawn
    if (totalCorrectRef.current > 0 && totalCorrectRef.current % POWERUP_SPAWN_INTERVAL === 0) {
      const types: PowerupType[] = ['freeze', 'double', 'reveal']
      setActivePowerup(types[Math.floor(Math.random() * types.length)])
      setPowerupReady(true)
      playAudio('powerup', 0.4)
    }

    // Word goal / Boss system
    if (totalCorrectRef.current > 0 && totalCorrectRef.current % WORD_GOAL_INTERVAL === 0) {
      // Start boss battle!
      const hp = 3 + Math.floor(totalCorrectRef.current / 10)
      bossHpRef.current = hp
      setBossHp(hp)
      setBossMaxHp(hp)
      setBossActive(true)
      scoreRef.current += WORD_GOAL_BONUS_SCORE
      setScore(scoreRef.current)
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + WORD_GOAL_BONUS_TIME_MS)
      setShowWordGoal(true)
      effects.comboHitBurst(200, 200, 5, WORD_GOAL_BONUS_SCORE)
      playAudio('combo', 0.7, 1.3)
      setTimeout(() => setShowWordGoal(false), 1500)
    }
  }, [playAudio, effects, triggerScreenFlash])

  const usePowerup = useCallback(() => {
    if (!powerupReady || activePowerup === null) return
    startBgm()
    setPowerupReady(false)
    playAudio('powerup', 0.5, 1.5)
    triggerScreenFlash('rgba(251,191,36,0.3)')

    if (activePowerup === 'freeze') {
      isTimeFrozenRef.current = true
      setIsTimeFrozen(true)
      clearTimeoutSafe(freezeTimerRef)
      freezeTimerRef.current = window.setTimeout(() => {
        isTimeFrozenRef.current = false
        setIsTimeFrozen(false)
        freezeTimerRef.current = null
      }, 5000)
      effects.triggerFlash('rgba(96,165,250,0.3)')
    } else if (activePowerup === 'reveal') {
      setHintActive(true)
    }
    setActivePowerup(activePowerup === 'double' ? 'double' : null)
  }, [powerupReady, activePowerup, playAudio, effects, triggerScreenFlash, startBgm])

  const handleChoice = useCallback(
    (choiceIndex: number) => {
      if (finishedRef.current || inputLockedRef.current) return
      startBgm()
      const currentRound = round
      const isCorrect = choiceIndex === currentRound.correctIndex
      const chosenWord = currentRound.choices[choiceIndex]

      setLastAnsweredIndex(choiceIndex)
      setLastAnswerCorrect(isCorrect)
      inputLockedRef.current = true

      if (isCorrect) {
        consecutiveWrongRef.current = 0
        setConsecutiveWrong(0)

        const nextCombo = comboRef.current + 1
        comboRef.current = nextCombo
        setCombo(nextCombo)
        totalCorrectRef.current += 1
        setTotalCorrect(totalCorrectRef.current)
        if (nextCombo > maxComboRef.current) { maxComboRef.current = nextCombo; setMaxCombo(nextCombo) }
        setWordHistory(prev => [...prev.slice(-8), chosenWord])

        const feverActive = nextCombo >= FEVER_COMBO_THRESHOLD
        const feverJust = feverActive && !isFever
        setIsFever(feverActive)

        if (feverJust) {
          playAudio('fever', 0.6)
          setFeverPulse(true)
          setCompanionMood('fever')
          triggerScreenFlash('rgba(249,115,22,0.3)')
          setTimeout(() => setFeverPulse(false), 600)
        } else {
          setCompanionMood('happy')
          setTimeout(() => { if (comboRef.current >= FEVER_COMBO_THRESHOLD) setCompanionMood('fever'); else setCompanionMood('idle') }, 400)
        }

        let comboMult = 1 + Math.floor(nextCombo / COMBO_MULTIPLIER_STEP)
        let points = CORRECT_SCORE * comboMult
        if (nextCombo > 0 && nextCombo % COMBO_BONUS_THRESHOLD === 0) points += COMBO_BONUS_EXTRA
        if (isBonusRoundRef.current) points *= BONUS_ROUND_MULTIPLIER
        if (feverActive) points *= FEVER_MULTIPLIER

        const timeRatio = perWordTimeLeftRef.current / wordTimeMsRef.current
        if (timeRatio > 0.7) points += 3
        else if (timeRatio > 0.5) points += 1

        if (activePowerup === 'double' && !powerupReady) {
          points *= 2
          setActivePowerup(null)
        }

        scoreRef.current += points
        setScore(scoreRef.current)
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_ON_CORRECT_MS)

        // Boss damage
        if (bossActive && bossHpRef.current > 0) {
          bossHpRef.current -= 1
          setBossHp(bossHpRef.current)
          if (bossHpRef.current <= 0) {
            setBossActive(false)
            scoreRef.current += 50
            setScore(scoreRef.current)
            triggerScreenFlash('rgba(250,204,21,0.5)')
            playAudio('levelup', 0.7, 1.3)
          }
        }

        // Streak milestone
        if (nextCombo > 0 && nextCombo % STREAK_MILESTONE === 0) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + STREAK_TIME_BONUS_MS)
          setShowStreakMilestone(true)
          setTimeout(() => setShowStreakMilestone(false), 1200)
          playAudio('combo', 0.7, 1.2)
          triggerScreenFlash('rgba(52,211,153,0.3)')
        } else if (nextCombo % COMBO_BONUS_THRESHOLD === 0) {
          playAudio('combo', 0.6, 1 + Math.min(0.3, nextCombo * 0.01))
        } else {
          playAudio('correct', 0.5, 1 + Math.min(0.3, nextCombo * 0.01))
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
        consecutiveWrongRef.current += 1
        setConsecutiveWrong(consecutiveWrongRef.current)
        if (consecutiveWrongRef.current >= FIFTY_FIFTY_THRESHOLD) setHintActive(true)

        setCompanionMood('sad')
        setTimeout(() => setCompanionMood('idle'), 600)

        comboRef.current = 0
        setCombo(0)
        setIsFever(false)
        scoreRef.current = Math.max(0, scoreRef.current + WRONG_SCORE)
        setScore(scoreRef.current)

        setWrongShake(true)
        clearTimeoutSafe(wrongShakeTimerRef)
        playAudio('wrong', 0.5, 0.8)
        effects.triggerShake(6)
        effects.triggerFlash('rgba(239,68,68,0.3)')
        triggerScreenFlash('rgba(239,68,68,0.25)')

        wrongShakeTimerRef.current = window.setTimeout(() => {
          wrongShakeTimerRef.current = null
          setWrongShake(false)
          advanceRound(currentRound.choices[currentRound.correctIndex])
        }, WRONG_SHAKE_DURATION_MS)
      }
    },
    [round, advanceRound, playAudio, isFever, effects, activePowerup, powerupReady, triggerScreenFlash, bossActive, startBgm],
  )

  // Audio setup
  useEffect(() => {
    const map: Record<string, string> = {
      correct: correctSfx, wrong: wrongSfx, combo: comboSfx, fever: feverSfx,
      timewarning: timeWarningSfx, gameover: gameOverSfx, levelup: levelUpSfx,
      powerup: powerupSfx, tick: tickSfx,
    }
    for (const [k, s] of Object.entries(map)) {
      const a = new Audio(s); a.preload = 'auto'; audioRefs.current[k] = a
    }
    const bgm = new Audio(wordChainBgmLoop)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = WORD_CHAIN_BGM_VOLUME
    bgmRef.current = bgm
    void bgm.play().catch(() => {})
    return () => {
      clearTimeoutSafe(correctFlashTimerRef)
      clearTimeoutSafe(wrongShakeTimerRef)
      clearTimeoutSafe(freezeTimerRef)
      if (bgmRef.current !== null) {
        bgmRef.current.pause()
        bgmRef.current.currentTime = 0
        bgmRef.current = null
      }
      audioRefs.current = {}
      effects.cleanup()
    }
  }, [])

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit() }
      const km: Record<string, number> = { 'Digit1': 0, 'Digit2': 1, 'Digit3': 2, 'Digit4': 3 }
      if (e.code in km) { e.preventDefault(); handleChoice(km[e.code]) }
      if (e.code === 'Space' && powerupReady) { e.preventDefault(); usePowerup() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit, handleChoice, usePowerup, powerupReady])

  // Game loop
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const delta = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // Star animation
      setStarTime(now * 0.001)

      if (!isTimeFrozenRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - delta)
        setRemainingMs(remainingMsRef.current)
      }

      if (!inputLockedRef.current && !isTimeFrozenRef.current) {
        perWordTimeLeftRef.current = Math.max(0, perWordTimeLeftRef.current - delta)
        setPerWordTimeLeft(perWordTimeLeftRef.current)

        if (perWordTimeLeftRef.current <= 0) {
          inputLockedRef.current = true
          consecutiveWrongRef.current += 1
          setConsecutiveWrong(consecutiveWrongRef.current)
          setWrongShake(true)
          setCompanionMood('scared')
          setTimeout(() => setCompanionMood('idle'), 500)
          playAudio('wrong', 0.4, 0.7)
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.25)')

          comboRef.current = 0; setCombo(0); setIsFever(false)
          scoreRef.current = Math.max(0, scoreRef.current + WRONG_SCORE)
          setScore(scoreRef.current)

          clearTimeoutSafe(wrongShakeTimerRef)
          wrongShakeTimerRef.current = window.setTimeout(() => {
            wrongShakeTimerRef.current = null
            setWrongShake(false)
            advanceRound(pickRandom(WORD_POOL))
          }, WRONG_SHAKE_DURATION_MS)
        }
      }

      // Time warning
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        setCompanionMood('scared')
        playAudio('timewarning', 0.4)
      }

      // Tick sound every second in low time
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > 0) {
        const sec = Math.floor(remainingMsRef.current / TICK_SOUND_INTERVAL_MS)
        if (sec !== lastTickSoundRef.current) {
          lastTickSoundRef.current = sec
          playAudio('tick', 0.2, 1 + (1 - remainingMsRef.current / LOW_TIME_THRESHOLD_MS) * 0.5)
        }
      }

      effects.updateParticles()
      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
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

  // Derived
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const lastChar = getLastChar(round.currentWord)
  const wordTimePct = wordTimeMs > 0 ? Math.max(0, Math.min(100, (perWordTimeLeft / wordTimeMs) * 100)) : 0
  const globalTimePct = (remainingMs / ROUND_DURATION_MS) * 100
  const goalProgress = totalCorrect % WORD_GOAL_INTERVAL
  const nextGoal = Math.ceil((totalCorrect + 1) / WORD_GOAL_INTERVAL) * WORD_GOAL_INTERVAL

  const bgColor = useMemo(() => {
    const bgs = ['#1a1c2c', '#1b1b3a', '#262050', '#2d1b4e', '#3b1a1a']
    return bgs[Math.min(difficulty - 1, bgs.length - 1)]
  }, [difficulty])

  return (
    <section className="px-panel" aria-label="word-chain-game" style={{ ...effects.getShakeStyle(), background: bgColor }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <style>{PX_STYLES}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Screen flash overlay */}
      {screenFlash && <div className="px-screen-flash" style={{ background: screenFlash }} />}

      {/* Scanlines */}
      <div className="px-scanlines" />

      {/* Pixel stars background */}
      <div className="px-stars">
        {pixelStars.map((s, i) => (
          <div key={i} className="px-star" style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            opacity: 0.3 + 0.7 * Math.abs(Math.sin(starTime * s.speed + s.phase)),
          }} />
        ))}
      </div>

      {/* Freeze overlay */}
      {isTimeFrozen && <div className="px-freeze-overlay">FREEZE!</div>}

      {/* HP Bar (global time) */}
      <div className="px-hp-bar-wrap">
        <span className="px-hp-label">HP</span>
        <div className="px-hp-bar">
          <div className={`px-hp-fill ${isLowTime ? 'low' : ''}`} style={{ width: `${globalTimePct}%` }} />
        </div>
        <span className={`px-time-num ${isLowTime ? 'low' : ''}`}>{(remainingMs / 1000).toFixed(1)}</span>
      </div>

      {/* Header */}
      <div className="px-header">
        <div className="px-score-box">
          <div className="px-score-label">SCORE</div>
          <div className="px-score-val">{score.toLocaleString()}</div>
        </div>
        <div className="px-header-meta">
          <div className="px-level-badge" data-level={difficulty}>
            <span>LV</span><strong>{difficulty}</strong>
          </div>
          <div className="px-stat-box">
            <div className="px-stat-label">BEST</div>
            <div className="px-stat-val">{displayedBestScore.toLocaleString()}</div>
          </div>
        </div>
      </div>

      {/* Combo bar */}
      <div className="px-combo-row">
        <span className="px-combo-text">
          COMBO <strong className="px-combo-num">{combo}</strong>
          {combo >= COMBO_MULTIPLIER_STEP && <span className="px-combo-x">x{1 + Math.floor(combo / COMBO_MULTIPLIER_STEP)}</span>}
        </span>
        {maxCombo > 0 && <span className="px-max-combo">MAX:{maxCombo}</span>}
        <div className="px-goal-mini">
          <div className="px-goal-track">
            <div className="px-goal-fill" style={{ width: `${(goalProgress / WORD_GOAL_INTERVAL) * 100}%` }} />
          </div>
          <span className="px-goal-num">{goalProgress}/{WORD_GOAL_INTERVAL}</span>
        </div>
      </div>

      {/* Boss bar */}
      {bossActive && <MiniBossBar hp={bossHp} maxHp={bossMaxHp} />}

      {/* Powerup */}
      {powerupReady && activePowerup !== null && (
        <button className="px-powerup-btn" type="button" onClick={usePowerup}>
          {activePowerup === 'freeze' ? 'ICE' : activePowerup === 'double' ? 'x2' : 'EYE'}
          <span className="px-pw-sub">[SPACE]</span>
        </button>
      )}

      {/* Banners */}
      {isFever && <div className={`px-fever-bar ${feverPulse ? 'enter' : ''}`}>*** FEVER x{FEVER_MULTIPLIER} ***</div>}
      {isBonusRound && <div className="px-bonus-bar">!! BONUS x{BONUS_ROUND_MULTIPLIER} !!</div>}
      {showStreakMilestone && <div className="px-streak-bar">{combo} STREAK! +{(STREAK_TIME_BONUS_MS / 1000).toFixed(0)}s</div>}
      {showWordGoal && <div className="px-goal-bar-banner">GOAL! +{WORD_GOAL_BONUS_SCORE}pts</div>}
      {showLevelUp && <div className="px-levelup-bar">*** LEVEL UP! LV.{difficulty} ***</div>}

      {/* Companion + Arena */}
      <div className={`px-arena ${correctFlash ? 'correct' : ''} ${wrongShake ? 'wrong' : ''} ${wordTransition ? 'slide' : ''} ${isFever ? 'fever' : ''}`}>
        <PixelCompanion mood={companionMood} combo={combo} />

        <div className="px-word-display">
          <span className="px-word-body">{round.currentWord.slice(0, -1)}</span>
          <span className="px-word-last">{lastChar}</span>
        </div>

        <div className="px-arrow">
          <span className="px-arrow-char">&darr;</span>
        </div>

        <div className="px-hint-row">
          Find &ldquo;<strong className="px-hint-letter">{lastChar.toUpperCase()}</strong>&rdquo;
        </div>

        {/* Per-word timer */}
        <div className="px-word-timer">
          <div className={`px-word-timer-fill ${wordTimePct < 30 ? 'crit' : wordTimePct < 60 ? 'warn' : ''}`} style={{ width: `${wordTimePct}%` }} />
        </div>
      </div>

      {/* Word History */}
      {wordHistory.length > 0 && (
        <div className="px-history">
          {wordHistory.map((w, i) => (
            <span key={`h-${i}-${w}`} className="px-hist-word" style={{ opacity: 0.3 + (i / wordHistory.length) * 0.7 }}>
              {w}
            </span>
          ))}
        </div>
      )}

      {/* Choices */}
      <div className="px-choices">
        {round.choices.map((word, idx) => {
          let cls = 'px-choice'
          if (lastAnsweredIndex === idx) cls += lastAnswerCorrect ? ' ok' : ' ng'
          else if (lastAnsweredIndex !== null && idx === round.correctIndex) cls += ' reveal'
          const dimmed = hintActive && idx !== round.correctIndex && lastAnsweredIndex === null

          return (
            <button
              className={cls}
              key={`c-${idx}-${word}`}
              type="button"
              onClick={() => handleChoice(idx)}
              disabled={inputLockedRef.current}
              style={dimmed ? { opacity: 0.25, pointerEvents: 'none' as const } : undefined}
            >
              <span className="px-choice-key">{idx + 1}</span>
              <span className="px-choice-first">{word[0].toUpperCase()}</span>{word.slice(1)}
            </button>
          )
        })}
      </div>

      {/* Hint warn */}
      {consecutiveWrong >= FIFTY_FIFTY_THRESHOLD - 1 && consecutiveWrong > 0 && !hintActive && (
        <div className="px-hint-warn">{FIFTY_FIFTY_THRESHOLD - consecutiveWrong > 0 ? `${FIFTY_FIFTY_THRESHOLD - consecutiveWrong} miss = HINT` : 'HINT!'}</div>
      )}

      {/* Footer */}
      <div className="px-footer">
        <span>{totalCorrect} WORDS / GOAL:{nextGoal}</span>
        <button className="px-exit-btn" type="button" onClick={onExit}>EXIT</button>
      </div>
    </section>
  )
}

// ═══ PIXEL ART CSS ═══
const PX_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

  .px-panel {
    display: flex;
    flex-direction: column;
    max-width: 560px;
    width: 100%;
    height: 100%;
    margin: 0 auto;
    overflow: hidden;
    position: relative;
    user-select: none;
    touch-action: manipulation;
    color: #e0e0e0;
    font-family: 'Press Start 2P', 'Courier New', monospace;
    font-size: 10px;
    image-rendering: pixelated;
  }

  /* Scanlines */
  .px-scanlines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 30;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.06) 2px,
      rgba(0,0,0,0.06) 4px
    );
  }

  /* Screen flash */
  .px-screen-flash {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 25;
    animation: px-flash 0.15s ease-out forwards;
  }

  /* Stars */
  .px-stars {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 0;
  }
  .px-star {
    position: absolute;
    background: #fff;
    image-rendering: pixelated;
  }

  /* Freeze overlay */
  .px-freeze-overlay {
    position: absolute;
    inset: 0;
    background: rgba(59,130,246,0.15);
    pointer-events: none;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.2rem;
    color: #93c5fd;
    text-shadow: 0 0 8px #3b82f6;
    animation: px-freeze-pulse 1s infinite alternate;
    border: 3px solid rgba(59,130,246,0.4);
  }

  /* HP Bar */
  .px-hp-bar-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px 6px;
    flex-shrink: 0;
    z-index: 1;
  }
  .px-hp-label {
    font-size: 0.8rem;
    color: #ef4444;
    font-weight: 700;
  }
  .px-hp-bar {
    flex: 1;
    height: 14px;
    background: #333;
    border: 3px solid #555;
    overflow: hidden;
  }
  .px-hp-fill {
    height: 100%;
    background: #22c55e;
    transition: width 0.15s linear;
    image-rendering: pixelated;
  }
  .px-hp-fill.low {
    background: #ef4444;
    animation: px-blink 0.4s infinite;
  }
  .px-time-num {
    font-size: 0.9rem;
    color: #a3e635;
    font-variant-numeric: tabular-nums;
    min-width: 66px;
    text-align: right;
  }
  .px-time-num.low {
    color: #ef4444;
    animation: px-blink 0.5s infinite;
  }

  /* Header */
  .px-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 10px 14px 8px;
    flex-shrink: 0;
    z-index: 1;
  }
  .px-score-box, .px-stat-box {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .px-score-box {
    align-items: center;
    text-align: center;
    width: 100%;
  }
  .px-header-meta {
    display: flex;
    align-items: stretch;
    justify-content: center;
    gap: 12px;
    width: 100%;
    flex-wrap: wrap;
  }
  .px-score-label, .px-stat-label {
    font-size: 0.72rem;
    color: #737373;
    letter-spacing: 2px;
  }
  .px-score-val {
    font-size: clamp(2.8rem, 14vw, 4.8rem);
    color: #fbbf24;
    line-height: 0.95;
    text-shadow: 4px 4px 0 #92400e;
  }
  .px-stat-val {
    font-size: 1.1rem;
    color: #a3a3a3;
  }
  .px-stat-box {
    align-items: center;
    justify-content: center;
    min-width: 168px;
    padding: 10px 14px;
    background: rgba(15,23,42,0.65);
    border: 3px solid #334155;
    text-align: center;
  }
  .px-level-badge {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 168px;
    padding: 10px 14px;
    background: #334155;
    border: 3px solid #475569;
    color: #a3e635;
    font-size: 0.8rem;
  }
  .px-level-badge strong {
    font-size: 1.35rem;
    color: #fbbf24;
  }
  .px-level-badge[data-level="4"], .px-level-badge[data-level="5"] {
    border-color: #ef4444;
    background: #450a0a;
    color: #fca5a5;
  }

  /* Combo row */
  .px-combo-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: rgba(0,0,0,0.3);
    flex-shrink: 0;
    z-index: 1;
  }
  .px-combo-text {
    font-size: 0.72rem;
    color: #a3a3a3;
  }
  .px-combo-num {
    font-size: 1.1rem;
    color: #fbbf24;
    text-shadow: 2px 2px 0 #92400e;
  }
  .px-combo-x {
    font-size: 0.72rem;
    color: #22d3ee;
    margin-left: 6px;
  }
  .px-max-combo {
    font-size: 0.58rem;
    color: #737373;
  }
  .px-goal-mini {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .px-goal-track {
    width: 72px;
    height: 10px;
    background: #333;
    border: 2px solid #555;
    overflow: hidden;
  }
  .px-goal-fill {
    height: 100%;
    background: #34d399;
    transition: width 0.2s;
  }
  .px-goal-num {
    font-size: 0.58rem;
    color: #737373;
  }

  /* Boss bar */
  .px-boss-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    flex-shrink: 0;
    z-index: 1;
    animation: px-boss-enter 0.5s ease-out;
  }
  .px-boss-label {
    font-size: 0.68rem;
    color: #ef4444;
    animation: px-blink 0.6s infinite;
  }
  .px-boss-track {
    flex: 1;
    height: 10px;
    background: #333;
    border: 3px solid #dc2626;
    overflow: hidden;
  }
  .px-boss-fill {
    height: 100%;
    background: linear-gradient(90deg, #dc2626, #f97316);
    transition: width 0.2s;
  }
  .px-boss-hp {
    font-size: 0.68rem;
    color: #fca5a5;
    min-width: 52px;
    text-align: right;
  }

  /* Powerup */
  .px-powerup-btn {
    margin: 6px 14px;
    padding: 10px 18px;
    font-family: 'Press Start 2P', monospace;
    font-size: 0.82rem;
    color: #1a1c2c;
    background: #fbbf24;
    border: 4px solid #f59e0b;
    cursor: pointer;
    animation: px-powerup-pulse 0.6s infinite alternate;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    flex-shrink: 0;
    z-index: 1;
    text-transform: uppercase;
  }
  .px-pw-sub { font-size: 0.52rem; opacity: 0.5; }
  .px-powerup-btn:active { transform: scale(0.95); }

  /* Banners */
  .px-fever-bar {
    text-align: center;
    color: #fbbf24;
    font-size: 0.75rem;
    padding: 8px 0;
    background: rgba(251,191,36,0.1);
    border-top: 3px solid #f59e0b;
    border-bottom: 3px solid #f59e0b;
    animation: px-glow 0.5s infinite alternate;
    flex-shrink: 0;
    z-index: 1;
    text-shadow: 0 0 8px #f59e0b;
    letter-spacing: 3px;
  }
  .px-fever-bar.enter { animation: px-banner-enter 0.5s ease-out; }
  .px-bonus-bar {
    text-align: center; color: #c084fc; font-size: 0.68rem;
    padding: 6px 0; animation: px-banner-enter 0.4s ease-out;
    flex-shrink: 0; z-index: 1; letter-spacing: 1px;
  }
  .px-streak-bar {
    text-align: center; color: #34d399; font-size: 0.82rem;
    padding: 8px 0; animation: px-streak-anim 1.2s ease-out forwards;
    text-shadow: 0 0 6px #34d399; flex-shrink: 0; z-index: 1;
  }
  .px-goal-bar-banner {
    text-align: center; color: #fbbf24; font-size: 0.75rem;
    padding: 8px 0; animation: px-streak-anim 1.5s ease-out forwards;
    flex-shrink: 0; z-index: 1;
  }
  .px-levelup-bar {
    text-align: center; color: #c084fc; font-size: 0.95rem;
    padding: 10px 0; animation: px-levelup 1.5s ease-out forwards;
    text-shadow: 0 0 12px #a855f7; flex-shrink: 0; z-index: 1;
    letter-spacing: 3px;
  }

  /* Companion */
  .px-companion {
    position: relative;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
  }
  .px-comp-body {
    width: 100%;
    height: 100%;
    position: relative;
    border: 2px solid rgba(0,0,0,0.3);
    image-rendering: pixelated;
  }
  .px-comp-eye-l, .px-comp-eye-r {
    position: absolute;
    width: 6px;
    height: 6px;
    top: 10px;
  }
  .px-comp-eye-l { left: 8px; }
  .px-comp-eye-r { right: 8px; }
  .px-comp-mouth {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 10px;
    height: 4px;
  }
  .px-comp-mouth.happy { border-radius: 0 0 5px 5px; height: 6px; }
  .px-comp-mouth.sad { border-radius: 5px 5px 0 0; height: 4px; bottom: 10px; }
  .px-comp-mouth.fever { border-radius: 0 0 5px 5px; height: 8px; width: 14px; }
  .px-comp-mouth.scared { width: 8px; height: 8px; border-radius: 50%; }
  .px-comp-flame {
    position: absolute;
    top: -8px;
    left: 50%;
    transform: translateX(-50%);
    width: 8px;
    height: 8px;
    background: #f97316;
    animation: px-flame 0.2s infinite alternate;
  }
  .px-comp-sparkle {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 6px;
    height: 6px;
    background: #fbbf24;
    animation: px-blink 0.3s infinite;
  }
  .px-comp-note {
    position: absolute;
    top: -12px;
    right: -8px;
    font-size: 0.5rem;
    color: #4ade80;
    animation: px-float-up 0.6s ease-out forwards;
  }

  .px-bounce { animation: px-bounce-anim 0.4s ease-out; }
  .px-fever-bounce { animation: px-fever-dance 0.3s infinite alternate; }
  .px-sad { animation: px-sad-shake 0.4s ease-out; }

  /* Arena */
  .px-arena {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 14px 18px;
    margin: 6px 10px;
    border: 4px solid #475569;
    background: rgba(30,41,59,0.8);
    transition: background 0.15s, border-color 0.15s;
    min-height: 0;
    z-index: 1;
  }
  .px-arena.correct { background: rgba(34,197,94,0.15); border-color: #22c55e; }
  .px-arena.wrong { background: rgba(239,68,68,0.12); border-color: #ef4444; animation: px-shake 0.35s; }
  .px-arena.slide { animation: px-word-slide 0.2s ease-out; }
  .px-arena.fever {
    border-color: #f59e0b;
    box-shadow: inset 0 0 20px rgba(251,191,36,0.1);
    animation: px-fever-border 0.8s infinite alternate;
  }

  .px-word-display {
    font-size: clamp(2.4rem, 13vw, 4.2rem);
    letter-spacing: 5px;
    text-align: center;
    word-break: break-all;
    line-height: 1.15;
    text-shadow: 4px 4px 0 rgba(0,0,0,0.5);
  }
  .px-word-body { color: #e5e7eb; }
  .px-word-last {
    color: #22d3ee;
    background: rgba(34,211,238,0.15);
    padding: 0 4px;
    border-bottom: 3px solid #0891b2;
  }

  .px-arrow {
    animation: px-arrow-bounce 0.6s infinite;
  }
  .px-arrow-char {
    font-size: 1.8rem;
    color: #22d3ee;
    text-shadow: 0 0 6px #22d3ee;
  }

  .px-hint-row {
    font-size: 0.78rem;
    color: #a3a3a3;
    text-align: center;
  }
  .px-hint-letter {
    font-size: 1.3rem;
    color: #22d3ee;
    text-shadow: 0 0 4px #22d3ee;
  }

  .px-word-timer {
    width: 80%;
    height: 10px;
    background: #333;
    border: 2px solid #555;
    overflow: hidden;
  }
  .px-word-timer-fill {
    height: 100%;
    background: #22d3ee;
    transition: width 0.1s linear;
  }
  .px-word-timer-fill.warn { background: #fbbf24; }
  .px-word-timer-fill.crit { background: #ef4444; animation: px-blink 0.3s infinite; }

  /* History */
  .px-history {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 14px;
    overflow: hidden;
    flex-shrink: 0;
    z-index: 1;
  }
  .px-hist-word {
    font-size: 0.52rem;
    color: #737373;
    background: rgba(255,255,255,0.05);
    padding: 4px 6px;
    border: 2px solid #333;
  }

  /* Choices */
  .px-choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 0 10px 8px;
    flex-shrink: 0;
    z-index: 1;
  }
  .px-choice {
    padding: 18px 10px;
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(0.92rem, 3.6vw, 1.25rem);
    color: #e5e7eb;
    background: #334155;
    border: 4px solid #475569;
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s, transform 0.08s, opacity 0.15s;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    position: relative;
    min-height: 82px;
    text-align: center;
    line-height: 1.45;
  }
  .px-choice-key {
    position: absolute;
    top: 6px;
    left: 8px;
    font-size: 0.52rem;
    color: #555;
  }
  .px-choice-first {
    color: #22d3ee;
  }
  .px-choice:active:not(:disabled) {
    transform: scale(0.95);
    background: #475569;
  }
  .px-choice:disabled { cursor: default; }
  .px-choice.ok {
    background: #166534;
    border-color: #22c55e;
    color: #4ade80;
    animation: px-pop 0.3s ease-out;
    box-shadow: 0 0 10px rgba(34,197,94,0.3);
  }
  .px-choice.ng {
    background: #7f1d1d;
    border-color: #ef4444;
    color: #f87171;
    animation: px-shake 0.35s;
  }
  .px-choice.reveal {
    background: #14532d;
    border-color: #4ade80;
    color: #86efac;
  }

  .px-hint-warn {
    text-align: center;
    font-size: 0.58rem;
    color: #fbbf24;
    padding: 4px 0;
    flex-shrink: 0;
    z-index: 1;
    animation: px-blink 0.8s infinite;
  }

  .px-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 14px 10px;
    font-size: 0.58rem;
    color: #555;
    flex-shrink: 0;
    z-index: 1;
    gap: 12px;
  }
  .px-exit-btn {
    font-family: 'Press Start 2P', monospace;
    font-size: 0.58rem;
    padding: 8px 14px;
    color: #737373;
    background: #1e293b;
    border: 3px solid #475569;
    cursor: pointer;
  }
  .px-exit-btn:active { background: #334155; }

  @media (max-width: 480px) {
    .px-header-meta {
      gap: 8px;
    }
    .px-level-badge,
    .px-stat-box {
      min-width: 140px;
      padding: 8px 10px;
    }
    .px-score-val {
      font-size: clamp(2.4rem, 14vw, 3.8rem);
    }
    .px-word-display {
      font-size: clamp(2rem, 12vw, 3.4rem);
      letter-spacing: 3px;
    }
    .px-choice {
      min-height: 72px;
      padding: 14px 8px;
      font-size: clamp(0.82rem, 3.8vw, 1.05rem);
    }
  }

  /* === ANIMATIONS === */
  @keyframes px-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @keyframes px-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }
  @keyframes px-pop {
    0% { transform: scale(1); }
    40% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }
  @keyframes px-flash {
    0% { opacity: 0.7; }
    100% { opacity: 0; }
  }
  @keyframes px-glow {
    0% { text-shadow: 0 0 4px #f59e0b; }
    100% { text-shadow: 0 0 16px #f59e0b, 0 0 30px rgba(245,158,11,0.3); }
  }
  @keyframes px-banner-enter {
    0% { transform: scale(0.3); opacity: 0; }
    60% { transform: scale(1.2); }
    100% { transform: scale(1); opacity: 1; }
  }
  @keyframes px-streak-anim {
    0% { transform: scale(0.3); opacity: 0; }
    25% { transform: scale(1.3); opacity: 1; }
    65% { transform: scale(1); opacity: 1; }
    100% { transform: scale(1); opacity: 0; }
  }
  @keyframes px-levelup {
    0% { transform: scale(0.3) rotate(-5deg); opacity: 0; }
    25% { transform: scale(1.4) rotate(2deg); opacity: 1; }
    55% { transform: scale(1) rotate(0); opacity: 1; }
    100% { transform: scale(1); opacity: 0; }
  }
  @keyframes px-word-slide {
    0% { transform: translateY(-8px); opacity: 0.5; }
    100% { transform: translateY(0); opacity: 1; }
  }
  @keyframes px-freeze-pulse {
    0% { border-color: rgba(59,130,246,0.2); }
    100% { border-color: rgba(59,130,246,0.6); }
  }
  @keyframes px-bounce-anim {
    0% { transform: translateY(0); }
    30% { transform: translateY(-8px); }
    60% { transform: translateY(0); }
    80% { transform: translateY(-3px); }
    100% { transform: translateY(0); }
  }
  @keyframes px-fever-dance {
    0% { transform: translateY(0) rotate(-3deg); }
    100% { transform: translateY(-4px) rotate(3deg); }
  }
  @keyframes px-sad-shake {
    0%, 100% { transform: translateX(0) rotate(0); }
    25% { transform: translateX(-3px) rotate(-2deg); }
    75% { transform: translateX(3px) rotate(2deg); }
  }
  @keyframes px-flame {
    0% { transform: translateX(-50%) scaleY(1); }
    100% { transform: translateX(-50%) scaleY(1.5); background: #fbbf24; }
  }
  @keyframes px-float-up {
    0% { transform: translateY(0); opacity: 1; }
    100% { transform: translateY(-12px); opacity: 0; }
  }
  @keyframes px-arrow-bounce {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(4px); }
  }
  @keyframes px-powerup-pulse {
    0% { box-shadow: 0 0 0 rgba(251,191,36,0); }
    100% { box-shadow: 0 0 12px rgba(251,191,36,0.4); }
  }
  @keyframes px-fever-border {
    0% { border-color: #f59e0b; }
    100% { border-color: #ef4444; }
  }
  @keyframes px-boss-enter {
    0% { transform: translateY(-10px); opacity: 0; }
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
