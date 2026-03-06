import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'

import swipeSfx from '../../../assets/sounds/speed-sort-swipe.mp3'
import correctSfx from '../../../assets/sounds/speed-sort-correct.mp3'
import wrongSfx from '../../../assets/sounds/speed-sort-wrong.mp3'
import comboSfx from '../../../assets/sounds/speed-sort-combo.mp3'
import ruleChangeSfx from '../../../assets/sounds/speed-sort-rule-change.mp3'
import timeBonusSfx from '../../../assets/sounds/speed-sort-time-bonus.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Constants ──────────────────────────────────────────────────────

const ROUND_DURATION_MS = 30000
const CORRECT_SCORE = 1
const WRONG_PENALTY = 2
const RULE_CHANGE_INTERVAL_MS = 8000
const SWIPE_ANIMATION_DURATION_MS = 280
const FEEDBACK_FLASH_DURATION_MS = 200
const LOW_TIME_THRESHOLD_MS = 5000
const COMBO_DECAY_WINDOW_MS = 2000
const SPAWN_DELAY_MS = 300

const MIN_RULE_CHANGE_INTERVAL_MS = 3000
const RULE_CHANGE_SPEEDUP_PER_10 = 500
const COMBO_MULTIPLIER_STEP = 10
const COMBO_TIME_BONUS_THRESHOLD = 15
const COMBO_TIME_BONUS_MS = 1500

// Fever mode
const FEVER_COMBO_THRESHOLD = 8
const FEVER_SCORE_MULTIPLIER = 2
const PERFECT_STREAK_THRESHOLD = 10
const PERFECT_STREAK_BONUS = 5

// Difficulty escalation
const DIFFICULTY_LEVELS = [
  { label: 'EASY', color: '#22c55e', minScore: 0 },
  { label: 'NORMAL', color: '#3b82f6', minScore: 15 },
  { label: 'HARD', color: '#f59e0b', minScore: 35 },
  { label: 'EXTREME', color: '#ef4444', minScore: 60 },
  { label: 'INSANE', color: '#a855f7', minScore: 100 },
] as const

const CHARACTER_POOL = [
  { id: 'kim-yeonja', name: 'Kim Yeonja', imageSrc: kimYeonjaImage, color: '#ec4899', emoji: '🎤' },
  { id: 'park-sangmin', name: 'Park Sangmin', imageSrc: parkSangminImage, color: '#ef4444', emoji: '🎸' },
  { id: 'park-wankyu', name: 'Park Wankyu', imageSrc: parkWankyuImage, color: '#f59e0b', emoji: '🎵' },
  { id: 'seo-taiji', name: 'Seo Taiji', imageSrc: seoTaijiImage, color: '#8b5cf6', emoji: '🎹' },
  { id: 'song-changsik', name: 'Song Changsik', imageSrc: songChangsikImage, color: '#22c55e', emoji: '🎺' },
  { id: 'tae-jina', name: 'Tae Jina', imageSrc: taeJinaImage, color: '#22d3ee', emoji: '🥁' },
] as const

type Character = (typeof CHARACTER_POOL)[number]
type SortSide = 'left' | 'right'

interface SortRule {
  readonly leftCharacterIds: ReadonlySet<string>
  readonly rightCharacterIds: ReadonlySet<string>
  readonly leftLabel: string
  readonly rightLabel: string
}

function shuffleArray<T>(array: readonly T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

function generateRule(): SortRule {
  const shuffled = shuffleArray(CHARACTER_POOL)
  const splitIndex = 2 + Math.floor(Math.random() * (shuffled.length - 3))
  const leftGroup = shuffled.slice(0, splitIndex)
  const rightGroup = shuffled.slice(splitIndex)
  return {
    leftCharacterIds: new Set(leftGroup.map((c) => c.id)),
    rightCharacterIds: new Set(rightGroup.map((c) => c.id)),
    leftLabel: leftGroup.map((c) => c.name.split(' ').pop()).join(', '),
    rightLabel: rightGroup.map((c) => c.name.split(' ').pop()).join(', '),
  }
}

function pickRandomCharacter(previousId?: string): Character {
  const candidates = CHARACTER_POOL.filter((c) => c.id !== previousId)
  const source = candidates.length > 0 ? candidates : [...CHARACTER_POOL]
  return source[Math.floor(Math.random() * source.length)]
}

function getCorrectSide(characterId: string, rule: SortRule): SortSide {
  return rule.leftCharacterIds.has(characterId) ? 'left' : 'right'
}

function getDifficultyLevel(score: number) {
  for (let i = DIFFICULTY_LEVELS.length - 1; i >= 0; i--) {
    if (score >= DIFFICULTY_LEVELS[i].minScore) return DIFFICULTY_LEVELS[i]
  }
  return DIFFICULTY_LEVELS[0]
}

// ─── CSS ────────────────────────────────────────────────────────────

const SPEED_SORT_CSS = `
  ${GAME_EFFECTS_CSS}

  .ss-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100%;
    background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 50%, #e8e5dc 100%);
    overflow: hidden;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
  }

  .ss-panel.ss-fever {
    background: linear-gradient(180deg, #fff7ed 0%, #ffedd5 50%, #fed7aa 100%);
  }

  .ss-top-bar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px 16px 4px;
    flex-shrink: 0;
  }

  .ss-score-block { text-align: left; }

  .ss-score {
    font-size: clamp(2.2rem, 9vw, 3.2rem);
    font-weight: 900;
    color: #1f2937;
    line-height: 1;
    margin: 0;
    text-shadow: 0 2px 0 rgba(0,0,0,0.08);
    transition: transform 0.15s;
  }

  .ss-score.ss-score-pop {
    animation: ge-bounce-in 0.2s ease-out;
  }

  .ss-best {
    font-size: 0.7rem;
    color: #9ca3af;
    margin: 2px 0 0;
    font-weight: 600;
  }

  .ss-timer-block { text-align: right; }

  .ss-timer {
    font-size: clamp(1.6rem, 6vw, 2.4rem);
    font-weight: 800;
    color: #374151;
    line-height: 1;
    margin: 0;
    transition: color 0.3s, text-shadow 0.3s;
  }

  .ss-timer.low-time {
    color: #ef4444;
    text-shadow: 0 0 12px rgba(239,68,68,0.5);
    animation: ge-pulse 0.6s ease-in-out infinite;
  }

  .ss-meta-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
    padding: 2px 16px;
    min-height: 24px;
    flex-shrink: 0;
  }

  .ss-combo-count {
    font-size: 0.85rem;
    font-weight: 700;
    color: #6b7280;
    margin: 0;
  }

  .ss-combo-count strong {
    font-size: 1.1rem;
    color: #f97316;
  }

  .ss-multiplier {
    font-size: 0.8rem;
    color: #f59e0b;
    font-weight: 800;
    margin: 0;
    animation: ge-pulse 0.8s ease-in-out infinite;
  }

  .ss-difficulty {
    font-size: 0.65rem;
    font-weight: 800;
    padding: 1px 6px;
    border-radius: 4px;
    margin: 0;
    letter-spacing: 0.5px;
  }

  .ss-sorted-count {
    font-size: 0.7rem;
    color: #9ca3af;
    font-weight: 600;
    margin: 0;
  }

  .ss-combo-label {
    text-align: center;
    font-size: clamp(1.1rem, 4.5vw, 1.5rem);
    font-weight: 900;
    margin: 0;
    animation: ge-bounce-in 0.3s ease-out;
    text-shadow: 0 2px 6px rgba(0,0,0,0.25);
    min-height: 22px;
    flex-shrink: 0;
  }

  .ss-fever-banner {
    text-align: center;
    font-size: clamp(0.75rem, 3vw, 0.9rem);
    font-weight: 900;
    color: #f97316;
    margin: 0;
    padding: 2px 0;
    animation: ge-pulse 0.5s ease-in-out infinite;
    text-shadow: 0 0 8px rgba(249,115,22,0.5);
    letter-spacing: 2px;
    flex-shrink: 0;
  }

  .ss-rule-banner {
    display: flex;
    align-items: stretch;
    margin: 4px 12px;
    border-radius: 10px;
    background: rgba(31,41,55,0.06);
    border: 2px solid #d1d5db;
    overflow: hidden;
    flex-shrink: 0;
    transition: border-color 0.3s, background 0.3s;
    min-height: 40px;
  }

  .ss-rule-banner.rule-flash {
    border-color: #f97316;
    background: rgba(249,115,22,0.08);
    animation: ge-shake 0.3s ease-out;
  }

  .ss-rule-side {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 6px;
    font-size: clamp(0.6rem, 2.2vw, 0.75rem);
    font-weight: 700;
    color: #374151;
  }

  .ss-rule-side.left {
    border-right: 2px solid #d1d5db;
  }

  .ss-rule-arrow {
    font-size: 1rem;
    color: #f97316;
  }

  .ss-progress-bar {
    margin: 2px 12px;
    height: 4px;
    background: #e5e7eb;
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .ss-progress-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.1s linear, background 0.3s;
  }

  .ss-rule-timer {
    margin: 0 12px;
    height: 3px;
    background: #e5e7eb;
    border-radius: 2px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .ss-rule-timer-fill {
    height: 100%;
    background: linear-gradient(90deg, #f97316, #ef4444);
    border-radius: 2px;
    transition: width 0.1s linear;
  }

  .ss-arena {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    min-height: 0;
    touch-action: none;
  }

  .ss-zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 32%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
  }

  .ss-zone-left {
    left: 0;
    background: linear-gradient(90deg, rgba(249,115,22,0.06) 0%, transparent 100%);
  }

  .ss-zone-right {
    right: 0;
    background: linear-gradient(-90deg, rgba(249,115,22,0.06) 0%, transparent 100%);
  }

  .ss-zone:active {
    background: rgba(249,115,22,0.18);
  }

  .ss-zone-arrow {
    font-size: clamp(2.2rem, 9vw, 3.2rem);
    color: rgba(249,115,22,0.25);
    font-weight: 900;
    transition: color 0.12s, transform 0.12s;
  }

  .ss-zone:active .ss-zone-arrow {
    color: rgba(249,115,22,0.7);
    transform: scale(1.4);
  }

  .ss-character-area {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 3;
    position: relative;
  }

  .ss-character {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .ss-character-image {
    width: clamp(160px, 50vw, 240px);
    height: clamp(160px, 50vw, 240px);
    object-fit: contain;
    image-rendering: pixelated;
    filter: drop-shadow(0 6px 16px rgba(0,0,0,0.18));
  }

  .ss-character-name {
    font-size: clamp(1.3rem, 4.5vw, 1.7rem);
    font-weight: 900;
    margin: 8px 0 0;
    text-shadow: 0 2px 4px rgba(0,0,0,0.15);
  }

  .ss-streak-indicator {
    font-size: 0.75rem;
    font-weight: 700;
    margin: 2px 0 0;
    color: #22c55e;
    animation: ge-bounce-in 0.2s ease-out;
  }

  @keyframes ss-swipe-left {
    0% { transform: translateX(0) rotate(0deg); opacity: 1; }
    100% { transform: translateX(-220px) rotate(-30deg); opacity: 0; }
  }

  @keyframes ss-swipe-right {
    0% { transform: translateX(0) rotate(0deg); opacity: 1; }
    100% { transform: translateX(220px) rotate(30deg); opacity: 0; }
  }

  @keyframes ss-spawn-in {
    0% { transform: scale(0.2) translateY(40px); opacity: 0; }
    50% { transform: scale(1.12) translateY(-6px); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }

  .ss-swipe-left { animation: ss-swipe-left 0.26s ease-in forwards; }
  .ss-swipe-right { animation: ss-swipe-right 0.26s ease-in forwards; }
  .ss-spawn-in { animation: ss-spawn-in 0.28s ease-out; }

  .ss-feedback-correct {
    background: radial-gradient(circle at center, rgba(34,197,94,0.15) 0%, transparent 70%);
  }

  .ss-feedback-wrong {
    background: radial-gradient(circle at center, rgba(239,68,68,0.15) 0%, transparent 70%);
  }

  .ss-button-row {
    display: flex;
    gap: 12px;
    padding: 8px 16px 14px;
    flex-shrink: 0;
  }

  .ss-button {
    flex: 1;
    min-height: clamp(56px, 14vw, 76px);
    border: 3px solid #6b7280;
    border-radius: 14px;
    font-size: clamp(1.1rem, 4vw, 1.5rem);
    font-weight: 900;
    cursor: pointer;
    transition: transform 0.08s, box-shadow 0.08s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    background: linear-gradient(180deg, #fff7ed 0%, #ffedd5 100%);
    color: #c2410c;
  }

  .ss-button:active:not(:disabled) {
    transform: scale(0.93);
    box-shadow: inset 0 2px 8px rgba(0,0,0,0.15);
  }

  .ss-button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .ss-panel.ss-fever .ss-button {
    border-color: #f97316;
    background: linear-gradient(180deg, #fef3c7 0%, #fde68a 100%);
    box-shadow: 0 0 12px rgba(249,115,22,0.3);
  }

  @keyframes ss-ripple-expand {
    0% { transform: scale(0); opacity: 0.6; }
    100% { transform: scale(3.5); opacity: 0; }
  }

  .ss-ripple {
    position: absolute;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    pointer-events: none;
    animation: ss-ripple-expand 0.5s ease-out forwards;
    z-index: 10;
  }

  .ss-ripple-correct { background: rgba(34,197,94,0.25); }
  .ss-ripple-wrong { background: rgba(239,68,68,0.25); }

  @keyframes ss-streak-glow {
    0%, 100% { box-shadow: 0 0 0 rgba(249,115,22,0); }
    50% { box-shadow: 0 0 30px rgba(249,115,22,0.3), inset 0 0 20px rgba(249,115,22,0.08); }
  }

  .ss-streak-glow { animation: ss-streak-glow 1.2s ease-in-out infinite; }

  .ss-low-time-border {
    animation: ge-rush-border 0.5s ease-in-out infinite alternate;
    border: 3px solid rgba(239,68,68,0.5);
  }

  @keyframes ss-time-bonus-flash {
    0% { background: rgba(34,197,94,0.25); }
    100% { background: transparent; }
  }

  .ss-time-bonus { animation: ss-time-bonus-flash 0.6s ease-out; }

  @keyframes ss-perfect-burst {
    0% { transform: scale(1); }
    30% { transform: scale(1.04); }
    100% { transform: scale(1); }
  }

  .ss-perfect-burst { animation: ss-perfect-burst 0.5s ease-out; }

  @keyframes ss-difficulty-change {
    0% { transform: scale(1.4); opacity: 0; }
    40% { transform: scale(0.9); opacity: 1; }
    100% { transform: scale(1); opacity: 1; }
  }

  .ss-difficulty-change { animation: ss-difficulty-change 0.4s ease-out; }
`

// ─── Component ──────────────────────────────────────────────────────

function SpeedSortGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [currentCharacter, setCurrentCharacter] = useState<Character>(() => pickRandomCharacter())
  const [rule, setRule] = useState<SortRule>(() => generateRule())
  const [swipeDirection, setSwipeDirection] = useState<SortSide | null>(null)
  const [feedbackKind, setFeedbackKind] = useState<'correct' | 'wrong' | null>(null)
  const [ruleFlash, setRuleFlash] = useState(false)
  const [isSpawning, setIsSpawning] = useState(false)
  const [sortCount, setSortCount] = useState(0)
  const [timeBonusFlash, setTimeBonusFlash] = useState(false)
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; correct: boolean }>>([])
  const [characterJustSpawned, setCharacterJustSpawned] = useState(true)
  const [isFever, setIsFever] = useState(false)
  const [streak, setStreak] = useState(0)
  const [perfectBurst, setPerfectBurst] = useState(false)
  const [scorePop, setScorePop] = useState(false)
  const [difficultyChanged, setDifficultyChanged] = useState(false)

  const effects = useGameEffects({ maxParticles: 50 })

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const streakRef = useRef(0)
  const ruleRef = useRef<SortRule>(rule)
  const currentCharacterRef = useRef<Character>(currentCharacter)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const ruleSinceLastChangeRef = useRef(0)
  const lastSortAtRef = useRef(0)
  const swipeTimerRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const spawnTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)
  const rippleIdRef = useRef(0)
  const prevDifficultyRef = useRef<string>(DIFFICULTY_LEVELS[0].label)
  const audioPoolRef = useRef<Record<string, HTMLAudioElement | null>>({})

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioPoolRef.current[key]
    if (audio === null || audio === undefined) return
    audio.currentTime = 0
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const addRipple = useCallback((x: number, y: number, correct: boolean) => {
    rippleIdRef.current += 1
    const id = rippleIdRef.current
    setRipples(prev => [...prev.slice(-5), { id, x, y, correct }])
    window.setTimeout(() => {
      setRipples(prev => prev.filter(r => r.id !== id))
    }, 500)
  }, [])

  const spawnNextCharacter = useCallback((previousId: string) => {
    setIsSpawning(true)
    setCharacterJustSpawned(false)
    clearTimeoutSafe(spawnTimerRef)
    spawnTimerRef.current = window.setTimeout(() => {
      spawnTimerRef.current = null
      const next = pickRandomCharacter(previousId)
      currentCharacterRef.current = next
      setCurrentCharacter(next)
      setIsSpawning(false)
      setCharacterJustSpawned(true)
    }, SPAWN_DELAY_MS)
  }, [])

  const changeRule = useCallback(() => {
    const nextRule = generateRule()
    ruleRef.current = nextRule
    setRule(nextRule)
    setRuleFlash(true)
    playAudio('ruleChange', 0.45, 1.1)
    effects.triggerFlash('rgba(249,115,22,0.2)', 150)
    window.setTimeout(() => setRuleFlash(false), 600)
  }, [playAudio, effects])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(swipeTimerRef)
    clearTimeoutSafe(feedbackTimerRef)
    clearTimeoutSafe(spawnTimerRef)
    effects.cleanup()
    playAudio('gameOver', 0.64, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: Math.max(0, scoreRef.current), durationMs: elapsedMs })
  }, [onFinish, playAudio, effects])

  const handleSort = useCallback(
    (side: SortSide) => {
      if (finishedRef.current || swipeDirection !== null || isSpawning) return

      const character = currentCharacterRef.current
      const correctSide = getCorrectSide(character.id, ruleRef.current)
      const isCorrect = side === correctSide
      const now = performance.now()

      setSwipeDirection(side)

      // Ripple at side
      const rx = side === 'left' ? 80 : 320
      addRipple(rx, 200, isCorrect)

      if (isCorrect) {
        const timeSinceLastSort = now - lastSortAtRef.current
        const nextCombo = timeSinceLastSort <= COMBO_DECAY_WINDOW_MS ? comboRef.current + 1 : 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        // Streak tracking
        const nextStreak = streakRef.current + 1
        streakRef.current = nextStreak
        setStreak(nextStreak)

        // Fever mode
        const enteringFever = nextCombo >= FEVER_COMBO_THRESHOLD
        if (enteringFever) setIsFever(true)

        // Score calculation
        const comboMultiplier = 1 + Math.floor(nextCombo / COMBO_MULTIPLIER_STEP)
        const feverMultiplier = enteringFever ? FEVER_SCORE_MULTIPLIER : 1
        const comboBonus = Math.floor(nextCombo / 5)
        const earned = (CORRECT_SCORE + comboBonus) * comboMultiplier * feverMultiplier

        // Perfect streak bonus
        let totalEarned = earned
        if (nextStreak > 0 && nextStreak % PERFECT_STREAK_THRESHOLD === 0) {
          totalEarned += PERFECT_STREAK_BONUS
          setPerfectBurst(true)
          window.setTimeout(() => setPerfectBurst(false), 500)
          effects.spawnParticles(8, 200, 200, ['🏆', '⭐', '💎', '🌟'], 'emoji')
          effects.triggerFlash('rgba(251,191,36,0.3)', 200)
          playAudio('combo', 0.6, 1.3)
        }

        const prevScore = scoreRef.current
        const nextScore = prevScore + totalEarned
        scoreRef.current = nextScore
        setScore(nextScore)

        // Score pop animation
        setScorePop(true)
        window.setTimeout(() => setScorePop(false), 200)

        // Difficulty change detection
        const prevDiff = getDifficultyLevel(prevScore)
        const nextDiff = getDifficultyLevel(nextScore)
        if (prevDiff.label !== nextDiff.label && prevDifficultyRef.current !== nextDiff.label) {
          prevDifficultyRef.current = nextDiff.label
          setDifficultyChanged(true)
          window.setTimeout(() => setDifficultyChanged(false), 400)
          effects.spawnParticles(5, 200, 50, ['🔥', '⚡', '💪'], 'emoji')
          playAudio('combo', 0.5, 1.2)
        }

        // Time bonus at high combos
        if (nextCombo > 0 && nextCombo % COMBO_TIME_BONUS_THRESHOLD === 0) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + COMBO_TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
          setTimeBonusFlash(true)
          window.setTimeout(() => setTimeBonusFlash(false), 600)
          playAudio('timeBonus', 0.55, 1.0)
          effects.showScorePopup(0, 200, 80, '#22c55e')
          effects.spawnParticles(6, 200, 80, ['⏱️', '💚', '✨'], 'emoji')
        }

        setFeedbackKind('correct')
        playAudio('swipe', 0.4, 1 + nextCombo * 0.015)
        playAudio('correct', 0.42, 1 + nextCombo * 0.02)

        if (nextCombo > 0 && nextCombo % 5 === 0) {
          playAudio('combo', 0.5, 0.9 + nextCombo * 0.01)
        }

        const cx = side === 'left' ? 100 : 300
        effects.comboHitBurst(cx, 250, nextCombo, totalEarned, [character.emoji, '✨', '🔥', '⚡'])

        if (nextCombo >= 10) {
          effects.spawnParticles(Math.min(6, Math.floor(nextCombo / 10)), 200, 250, ['🌟', '💫', '🔥'], 'emoji')
        }
      } else {
        comboRef.current = 0
        streakRef.current = 0
        setCombo(0)
        setStreak(0)
        setIsFever(false)

        const nextScore = scoreRef.current - WRONG_PENALTY
        scoreRef.current = nextScore
        setScore(nextScore)
        setFeedbackKind('wrong')

        playAudio('wrong', 0.55, 0.8)
        effects.triggerShake(8, 180)
        effects.triggerFlash('rgba(239,68,68,0.35)', 120)
        effects.spawnParticles(4, 200, 250, ['💢', '❌', '😵'], 'emoji')
        effects.showScorePopup(-WRONG_PENALTY, 200, 280, '#ef4444')
      }

      lastSortAtRef.current = now
      setSortCount((prev) => prev + 1)

      clearTimeoutSafe(feedbackTimerRef)
      feedbackTimerRef.current = window.setTimeout(() => {
        feedbackTimerRef.current = null
        setFeedbackKind(null)
      }, FEEDBACK_FLASH_DURATION_MS)

      clearTimeoutSafe(swipeTimerRef)
      swipeTimerRef.current = window.setTimeout(() => {
        swipeTimerRef.current = null
        setSwipeDirection(null)
        spawnNextCharacter(character.id)
      }, SWIPE_ANIMATION_DURATION_MS)
    },
    [swipeDirection, isSpawning, playAudio, spawnNextCharacter, addRipple, effects],
  )

  const handleExit = useCallback(() => {
    playAudio('swipe', 0.42, 1.02)
    onExit()
  }, [onExit, playAudio])

  // Touch swipe on arena
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0]
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, t: Date.now() }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartRef.current === null) return
    const touch = e.changedTouches[0]
    const dx = touch.clientX - touchStartRef.current.x
    const dy = touch.clientY - touchStartRef.current.y
    const dt = Date.now() - touchStartRef.current.t
    touchStartRef.current = null
    // Quick swipe: at least 25px horizontal, mostly horizontal, within 500ms
    if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy) * 1.2 && dt < 500) {
      handleSort(dx < 0 ? 'left' : 'right')
    }
  }, [handleSort])

  // Init audio + preload images
  useEffect(() => {
    for (const token of CHARACTER_POOL) {
      const image = new Image()
      image.decoding = 'sync'
      image.src = token.imageSrc
      void image.decode?.().catch(() => {})
    }

    const audioMap: Record<string, string> = {
      swipe: swipeSfx, correct: correctSfx, wrong: wrongSfx,
      combo: comboSfx, ruleChange: ruleChangeSfx,
      timeBonus: timeBonusSfx, gameOver: gameOverHitSfx,
    }
    for (const [key, src] of Object.entries(audioMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioPoolRef.current[key] = audio
    }

    return () => {
      clearTimeoutSafe(swipeTimerRef)
      clearTimeoutSafe(feedbackTimerRef)
      clearTimeoutSafe(spawnTimerRef)
      for (const key of Object.keys(audioPoolRef.current)) {
        audioPoolRef.current[key] = null
      }
    }
  }, [])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); handleExit(); return }
      if (event.code === 'ArrowLeft') { event.preventDefault(); handleSort('left'); return }
      if (event.code === 'ArrowRight') { event.preventDefault(); handleSort('right') }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSort, handleExit])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null
    ruleSinceLastChangeRef.current = 0

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)
      effects.updateParticles()

      const speedupSteps = Math.floor(scoreRef.current / 10)
      const currentRuleInterval = Math.max(MIN_RULE_CHANGE_INTERVAL_MS, RULE_CHANGE_INTERVAL_MS - speedupSteps * RULE_CHANGE_SPEEDUP_PER_10)
      ruleSinceLastChangeRef.current += deltaMs
      if (ruleSinceLastChangeRef.current >= currentRuleInterval) {
        ruleSinceLastChangeRef.current = 0
        changeRule()
      }

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio('swipe', 0.2, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 10000)
        }
      } else {
        lowTimeSecondRef.current = null
      }

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
  }, [changeRule, finishGame, playAudio, effects])

  // Derived display values
  const displayedScore = Math.max(0, score)
  const displayedBestScore = useMemo(() => Math.max(bestScore, displayedScore), [bestScore, displayedScore])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const speedupStepsDisplay = Math.floor(Math.max(0, score) / 10)
  const currentRuleIntervalDisplay = Math.max(MIN_RULE_CHANGE_INTERVAL_MS, RULE_CHANGE_INTERVAL_MS - speedupStepsDisplay * RULE_CHANGE_SPEEDUP_PER_10)
  const ruleChangeProgress = Math.min(100, (ruleSinceLastChangeRef.current / currentRuleIntervalDisplay) * 100)
  const comboMultiplierDisplay = 1 + Math.floor(combo / COMBO_MULTIPLIER_STEP)
  const timePercent = (remainingMs / ROUND_DURATION_MS) * 100
  const difficulty = getDifficultyLevel(displayedScore)

  const characterSwipeClass =
    swipeDirection === 'left' ? 'ss-swipe-left'
    : swipeDirection === 'right' ? 'ss-swipe-right'
    : characterJustSpawned ? 'ss-spawn-in'
    : ''

  const feedbackClass =
    feedbackKind === 'correct' ? 'ss-feedback-correct'
    : feedbackKind === 'wrong' ? 'ss-feedback-wrong'
    : ''

  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  const panelClasses = [
    'mini-game-panel',
    'ss-panel',
    isFever ? 'ss-fever' : '',
    combo >= 10 ? 'ss-streak-glow' : '',
    isLowTime ? 'ss-low-time-border' : '',
    timeBonusFlash ? 'ss-time-bonus' : '',
    perfectBurst ? 'ss-perfect-burst' : '',
  ].filter(Boolean).join(' ')

  return (
    <section
      className={panelClasses}
      aria-label="speed-sort-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', ...effects.getShakeStyle() }}
    >
      <style>{SPEED_SORT_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {ripples.map(r => (
        <div
          key={r.id}
          className={`ss-ripple ${r.correct ? 'ss-ripple-correct' : 'ss-ripple-wrong'}`}
          style={{ left: `${r.x - 30}px`, top: `${r.y - 30}px` }}
        />
      ))}

      {/* Top bar */}
      <div className="ss-top-bar">
        <div className="ss-score-block">
          <p className={`ss-score ${scorePop ? 'ss-score-pop' : ''}`}>{displayedScore.toLocaleString()}</p>
          <p className="ss-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="ss-timer-block">
          <p className={`ss-timer ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
          <p className="ss-sorted-count">Sorted {sortCount}</p>
        </div>
      </div>

      {/* Time progress */}
      <div className="ss-progress-bar">
        <div
          className="ss-progress-fill"
          style={{
            width: `${timePercent}%`,
            background: isLowTime
              ? 'linear-gradient(90deg, #ef4444, #f97316)'
              : isFever
                ? 'linear-gradient(90deg, #f97316, #fbbf24)'
                : 'linear-gradient(90deg, #22c55e, #3b82f6)',
          }}
        />
      </div>

      {/* Meta row: combo + difficulty + sorted */}
      <div className="ss-meta-row">
        <p className="ss-combo-count">COMBO <strong>{combo}</strong></p>
        {comboMultiplierDisplay > 1 && (
          <p className="ss-multiplier">x{comboMultiplierDisplay}{isFever ? ' FEVER' : ''}</p>
        )}
        <p
          className={`ss-difficulty ${difficultyChanged ? 'ss-difficulty-change' : ''}`}
          style={{ background: `${difficulty.color}20`, color: difficulty.color, border: `1px solid ${difficulty.color}40` }}
        >
          {difficulty.label}
        </p>
      </div>

      {/* Combo label */}
      {comboLabel && (
        <p className="ss-combo-label" style={{ color: comboColor }}>{comboLabel}</p>
      )}

      {/* Fever banner */}
      {isFever && <p className="ss-fever-banner">FEVER MODE x{FEVER_SCORE_MULTIPLIER}</p>}

      {/* Rule banner */}
      <div className={`ss-rule-banner ${ruleFlash ? 'rule-flash' : ''}`}>
        <div className="ss-rule-side left">
          <span className="ss-rule-arrow">&larr;</span>
          <span>{rule.leftLabel}</span>
        </div>
        <div className="ss-rule-side">
          <span>{rule.rightLabel}</span>
          <span className="ss-rule-arrow">&rarr;</span>
        </div>
      </div>

      <div className="ss-rule-timer">
        <div className="ss-rule-timer-fill" style={{ width: `${100 - ruleChangeProgress}%` }} />
      </div>

      {/* Arena */}
      <div
        className={`ss-arena ${feedbackClass}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="ss-zone ss-zone-left"
          aria-label="left-zone"
          onClick={() => handleSort('left')}
        >
          <span className="ss-zone-arrow">&larr;</span>
        </div>

        <div className="ss-character-area">
          {!isSpawning && (
            <div className={`ss-character ${characterSwipeClass}`}>
              <img
                className="ss-character-image"
                src={currentCharacter.imageSrc}
                alt={currentCharacter.name}
              />
              <p className="ss-character-name" style={{ color: currentCharacter.color }}>
                {currentCharacter.name}
              </p>
              {streak >= 3 && (
                <p className="ss-streak-indicator">
                  {streak} streak {streak >= PERFECT_STREAK_THRESHOLD ? '🏆' : '🔥'}
                </p>
              )}
            </div>
          )}
        </div>

        <div
          className="ss-zone ss-zone-right"
          aria-label="right-zone"
          onClick={() => handleSort('right')}
        >
          <span className="ss-zone-arrow">&rarr;</span>
        </div>
      </div>

      {/* Buttons */}
      <div className="ss-button-row">
        <button
          className="ss-button"
          type="button"
          onClick={() => handleSort('left')}
          disabled={swipeDirection !== null || isSpawning}
        >
          &larr; LEFT
        </button>
        <button
          className="ss-button"
          type="button"
          onClick={() => handleSort('right')}
          disabled={swipeDirection !== null || isSpawning}
        >
          RIGHT &rarr;
        </button>
      </div>
    </section>
  )
}

export const speedSortModule: MiniGameModule = {
  manifest: {
    id: 'speed-sort',
    title: 'Speed Sort',
    description: 'Sort characters left/right by rule, fast!',
    unlockCost: 45,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: SpeedSortGame,
}
