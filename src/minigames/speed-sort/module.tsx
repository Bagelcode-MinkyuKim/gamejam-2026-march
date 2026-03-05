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
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 30000
const CORRECT_SCORE = 1
const WRONG_PENALTY = 2
const RULE_CHANGE_INTERVAL_MS = 8000
const SWIPE_ANIMATION_DURATION_MS = 300
const FEEDBACK_FLASH_DURATION_MS = 200
const LOW_TIME_THRESHOLD_MS = 5000
const COMBO_DECAY_WINDOW_MS = 2000
const SPAWN_DELAY_MS = 400

// Escalation: rule changes get faster as score increases
const MIN_RULE_CHANGE_INTERVAL_MS = 3000
const RULE_CHANGE_SPEEDUP_PER_10 = 500

// Combo multiplier: doubles score every 10 combo
const COMBO_MULTIPLIER_STEP = 10

// Time bonus for high combos
const COMBO_TIME_BONUS_THRESHOLD = 15
const COMBO_TIME_BONUS_MS = 1500

const CHARACTER_POOL = [
  { id: 'kim-yeonja', name: '김연자', imageSrc: kimYeonjaImage, color: '#ec4899' },
  { id: 'park-sangmin', name: '박상민', imageSrc: parkSangminImage, color: '#ef4444' },
  { id: 'park-wankyu', name: '박완규', imageSrc: parkWankyuImage, color: '#f59e0b' },
  { id: 'seo-taiji', name: '서태지', imageSrc: seoTaijiImage, color: '#8b5cf6' },
  { id: 'song-changsik', name: '송창식', imageSrc: songChangsikImage, color: '#22c55e' },
  { id: 'tae-jina', name: '태진아', imageSrc: taeJinaImage, color: '#22d3ee' },
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
    leftLabel: leftGroup.map((c) => c.name).join(', '),
    rightLabel: rightGroup.map((c) => c.name).join(', '),
  }
}

function pickRandomCharacter(previousId?: string): Character {
  const candidates = CHARACTER_POOL.filter((c) => c.id !== previousId)
  const source = candidates.length > 0 ? candidates : [...CHARACTER_POOL]
  return source[Math.floor(Math.random() * source.length)]
}

function getCorrectSide(characterId: string, rule: SortRule): SortSide {
  if (rule.leftCharacterIds.has(characterId)) {
    return 'left'
  }
  return 'right'
}

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

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
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

  const spawnNextCharacter = useCallback((previousId: string) => {
    setIsSpawning(true)
    clearTimeoutSafe(spawnTimerRef)
    spawnTimerRef.current = window.setTimeout(() => {
      spawnTimerRef.current = null
      const next = pickRandomCharacter(previousId)
      currentCharacterRef.current = next
      setCurrentCharacter(next)
      setIsSpawning(false)
    }, SPAWN_DELAY_MS)
  }, [])

  const changeRule = useCallback(() => {
    const nextRule = generateRule()
    ruleRef.current = nextRule
    setRule(nextRule)
    setRuleFlash(true)
    window.setTimeout(() => setRuleFlash(false), 600)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true
    clearTimeoutSafe(swipeTimerRef)
    clearTimeoutSafe(feedbackTimerRef)
    clearTimeoutSafe(spawnTimerRef)
    effects.cleanup()

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: Math.max(0, scoreRef.current),
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const handleSort = useCallback(
    (side: SortSide) => {
      if (finishedRef.current || swipeDirection !== null || isSpawning) {
        return
      }

      const character = currentCharacterRef.current
      const correctSide = getCorrectSide(character.id, ruleRef.current)
      const isCorrect = side === correctSide
      const now = performance.now()

      setSwipeDirection(side)

      if (isCorrect) {
        const timeSinceLastSort = now - lastSortAtRef.current
        const nextCombo = timeSinceLastSort <= COMBO_DECAY_WINDOW_MS ? comboRef.current + 1 : 1
        comboRef.current = nextCombo
        setCombo(nextCombo)

        // Combo multiplier: doubles every COMBO_MULTIPLIER_STEP
        const comboMultiplier = 1 + Math.floor(nextCombo / COMBO_MULTIPLIER_STEP)
        const comboBonus = Math.floor(nextCombo / 5)
        const earned = (CORRECT_SCORE + comboBonus) * comboMultiplier
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        // Time bonus at high combos
        if (nextCombo > 0 && nextCombo % COMBO_TIME_BONUS_THRESHOLD === 0) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + COMBO_TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
          effects.showScorePopup(0, 200, 120, '#22c55e')
        }

        setFeedbackKind('correct')
        playAudio(tapHitAudioRef, 0.5, 1 + nextCombo * 0.02)

        // Visual effects for correct sort
        effects.comboHitBurst(200, 280, nextCombo, earned)
      } else {
        comboRef.current = 0
        setCombo(0)

        const nextScore = scoreRef.current - WRONG_PENALTY
        scoreRef.current = nextScore
        setScore(nextScore)

        setFeedbackKind('wrong')
        playAudio(tapHitStrongAudioRef, 0.6, 0.8)

        // Visual effects for wrong sort
        effects.triggerShake(6)
        effects.triggerFlash('rgba(239,68,68,0.4)')
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
    [swipeDirection, isSpawning, playAudio, spawnNextCharacter],
  )

  const handleExit = useCallback(() => {
    playAudio(tapHitStrongAudioRef, 0.42, 1.02)
    onExit()
  }, [onExit, playAudio])

  useEffect(() => {
    for (const token of CHARACTER_POOL) {
      const image = new Image()
      image.decoding = 'sync'
      image.src = token.imageSrc
      void image.decode?.().catch(() => {})
    }

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
      clearTimeoutSafe(swipeTimerRef)
      clearTimeoutSafe(feedbackTimerRef)
      clearTimeoutSafe(spawnTimerRef)
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
        return
      }
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        handleSort('left')
        return
      }
      if (event.code === 'ArrowRight') {
        event.preventDefault()
        handleSort('right')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleSort, handleExit])

  useEffect(() => {
    lastFrameAtRef.current = null
    ruleSinceLastChangeRef.current = 0

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

      // Escalation: rule changes get faster as score increases
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
          playAudio(tapHitStrongAudioRef, 0.25, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 10000)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.64, 0.95)
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
  }, [changeRule, finishGame, playAudio])

  const displayedScore = Math.max(0, score)
  const displayedBestScore = useMemo(() => Math.max(bestScore, displayedScore), [bestScore, displayedScore])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const speedupStepsDisplay = Math.floor(Math.max(0, score) / 10)
  const currentRuleIntervalDisplay = Math.max(MIN_RULE_CHANGE_INTERVAL_MS, RULE_CHANGE_INTERVAL_MS - speedupStepsDisplay * RULE_CHANGE_SPEEDUP_PER_10)
  const ruleChangeProgress = Math.min(100, (ruleSinceLastChangeRef.current / currentRuleIntervalDisplay) * 100)
  const comboMultiplierDisplay = 1 + Math.floor(combo / COMBO_MULTIPLIER_STEP)

  const characterSwipeClass =
    swipeDirection === 'left'
      ? 'speed-sort-swipe-left'
      : swipeDirection === 'right'
        ? 'speed-sort-swipe-right'
        : ''

  const feedbackClass =
    feedbackKind === 'correct'
      ? 'speed-sort-feedback-correct'
      : feedbackKind === 'wrong'
        ? 'speed-sort-feedback-wrong'
        : ''

  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  return (
    <section className="mini-game-panel speed-sort-panel" aria-label="speed-sort-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="speed-sort-score-strip">
        <p className="speed-sort-score">{displayedScore.toLocaleString()}</p>
        <p className="speed-sort-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`speed-sort-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="speed-sort-meta-row">
        <p className="speed-sort-combo">
          COMBO <strong>{combo}</strong>
        </p>
        {comboMultiplierDisplay > 1 && (
          <p style={{ fontSize: '12px', color: '#f59e0b', margin: 0, fontWeight: 700 }}>
            x{comboMultiplierDisplay}
          </p>
        )}
        <p className="speed-sort-sorted">
          분류 <strong>{sortCount}</strong>
        </p>
      </div>

      {comboLabel && (
        <p className="ge-combo-label" style={{ textAlign: 'center', fontSize: '16px', color: comboColor, margin: '2px 0' }}>
          {comboLabel}
        </p>
      )}

      <div className={`speed-sort-rule-banner ${ruleFlash ? 'rule-flash' : ''}`}>
        <div className="speed-sort-rule-left">
          <span className="speed-sort-rule-arrow">&#x2190;</span>
          <span className="speed-sort-rule-names">{rule.leftLabel}</span>
        </div>
        <div className="speed-sort-rule-divider">|</div>
        <div className="speed-sort-rule-right">
          <span className="speed-sort-rule-names">{rule.rightLabel}</span>
          <span className="speed-sort-rule-arrow">&#x2192;</span>
        </div>
      </div>

      <div className="speed-sort-rule-timer">
        <div className="speed-sort-rule-timer-fill" style={{ width: `${100 - ruleChangeProgress}%` }} />
      </div>

      <div className={`speed-sort-arena ${feedbackClass}`}>
        <div className="speed-sort-zone speed-sort-zone-left" aria-label="left-zone">
          <span className="speed-sort-zone-label">&#x2190;</span>
        </div>

        <div className="speed-sort-character-area">
          {!isSpawning && (
            <div className={`speed-sort-character ${characterSwipeClass}`}>
              <img
                className="speed-sort-character-image"
                src={currentCharacter.imageSrc}
                alt={currentCharacter.name}
              />
              <p className="speed-sort-character-name" style={{ color: currentCharacter.color }}>
                {currentCharacter.name}
              </p>
            </div>
          )}
        </div>

        <div className="speed-sort-zone speed-sort-zone-right" aria-label="right-zone">
          <span className="speed-sort-zone-label">&#x2192;</span>
        </div>
      </div>

      <div className="speed-sort-button-row">
        <button
          className="speed-sort-button speed-sort-button-left"
          type="button"
          onClick={() => handleSort('left')}
          disabled={swipeDirection !== null || isSpawning}
        >
          &#x2190; LEFT
        </button>
        <button
          className="speed-sort-button speed-sort-button-right"
          type="button"
          onClick={() => handleSort('right')}
          disabled={swipeDirection !== null || isSpawning}
        >
          RIGHT &#x2192;
        </button>
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const speedSortModule: MiniGameModule = {
  manifest: {
    id: 'speed-sort',
    title: 'Speed Sort',
    description: '캐릭터를 규칙에 따라 좌우로 빠르게 분류하라!',
    unlockCost: 45,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: SpeedSortGame,
}
