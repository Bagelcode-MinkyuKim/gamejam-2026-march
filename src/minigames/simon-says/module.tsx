import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import parkWankyuImg from '../../../assets/images/same-character/park-wankyu.png'

const ROUND_DURATION_MS = 45000
const LOW_TIME_THRESHOLD_MS = 10000
const POINTS_PER_LEVEL = 10
const SEQUENCE_SHOW_INTERVAL_MS = 600
const SEQUENCE_SHOW_DURATION_MS = 400
const PAUSE_BEFORE_PLAY_MS = 500
const SUCCESS_FLASH_DURATION_MS = 400
const FAIL_FLASH_DURATION_MS = 300

// Escalation: sequence display gets faster as levels increase
const MIN_SHOW_INTERVAL_MS = 250
const MIN_SHOW_DURATION_MS = 180
const SHOW_SPEED_FACTOR = 0.92

// Fever mode: triggers at streak threshold, uses only 2 colors for easier patterns
const FEVER_STREAK_THRESHOLD = 5
const FEVER_DURATION_LEVELS = 3
const FEVER_BONUS_MULTIPLIER = 2
const FEVER_TIME_BONUS_MS = 3000

// Streak bonus: complete level quickly for bonus points
const FAST_CLEAR_THRESHOLD_MS = 4000
const FAST_CLEAR_BONUS = 5

type SimonColor = 'red' | 'blue' | 'green' | 'yellow'

const SIMON_COLORS: readonly SimonColor[] = ['red', 'blue', 'green', 'yellow'] as const

const COLOR_MAP: Record<SimonColor, { hex: string; brightHex: string; label: string }> = {
  red: { hex: '#ef4444', brightHex: '#fca5a5', label: '빨강' },
  blue: { hex: '#3b82f6', brightHex: '#93c5fd', label: '파랑' },
  green: { hex: '#22c55e', brightHex: '#86efac', label: '초록' },
  yellow: { hex: '#eab308', brightHex: '#fde047', label: '노랑' },
} as const

type GamePhase = 'watch' | 'play' | 'result'

const FEVER_COLORS: readonly SimonColor[] = ['red', 'blue'] as const

function pickRandomColor(isFever = false): SimonColor {
  const pool = isFever ? FEVER_COLORS : SIMON_COLORS
  return pool[Math.floor(Math.random() * pool.length)]
}

function extendSequence(sequence: SimonColor[], isFever = false): SimonColor[] {
  return [...sequence, pickRandomColor(isFever)]
}

function getShowTiming(level: number): { interval: number; duration: number } {
  let interval = SEQUENCE_SHOW_INTERVAL_MS
  let duration = SEQUENCE_SHOW_DURATION_MS
  for (let i = 1; i < level; i += 1) {
    interval = Math.max(MIN_SHOW_INTERVAL_MS, interval * SHOW_SPEED_FACTOR)
    duration = Math.max(MIN_SHOW_DURATION_MS, duration * SHOW_SPEED_FACTOR)
  }
  return { interval: Math.round(interval), duration: Math.round(duration) }
}

function SimonSaysGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<GamePhase>('watch')
  const [sequence, setSequence] = useState<SimonColor[]>(() => [pickRandomColor()])
  const [activeColor, setActiveColor] = useState<SimonColor | null>(null)
  const [playerIndex, setPlayerIndex] = useState(0)
  const [successFlash, setSuccessFlash] = useState(false)
  const [failFlash, setFailFlash] = useState(false)
  const [isFever, setIsFever] = useState(false)
  const [consecutiveClears, setConsecutiveClears] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const levelRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const phaseRef = useRef<GamePhase>('watch')
  const sequenceRef = useRef<SimonColor[]>(sequence)
  const playerIndexRef = useRef(0)
  const finishedRef = useRef(false)
  const consecutiveClearsRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverLevelsRemainingRef = useRef(0)
  const levelStartAtRef = useRef(performance.now())
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const showSequenceTimerRef = useRef<number | null>(null)
  const successFlashTimerRef = useRef<number | null>(null)
  const failFlashTimerRef = useRef<number | null>(null)
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

  const startShowingSequence = useCallback(
    (seq: SimonColor[]) => {
      phaseRef.current = 'watch'
      setPhase('watch')
      playerIndexRef.current = 0
      setPlayerIndex(0)

      const { interval, duration } = getShowTiming(levelRef.current)

      let showIndex = 0

      const showNext = () => {
        if (finishedRef.current) {
          return
        }

        if (showIndex >= seq.length) {
          setActiveColor(null)
          showSequenceTimerRef.current = window.setTimeout(() => {
            showSequenceTimerRef.current = null
            if (!finishedRef.current) {
              phaseRef.current = 'play'
              setPhase('play')
              levelStartAtRef.current = performance.now()
            }
          }, PAUSE_BEFORE_PLAY_MS)
          return
        }

        const color = seq[showIndex]
        setActiveColor(color)
        playAudio(tapHitAudioRef, 0.3, 0.9 + showIndex * 0.05)

        showSequenceTimerRef.current = window.setTimeout(() => {
          setActiveColor(null)
          showIndex += 1
          showSequenceTimerRef.current = window.setTimeout(showNext, interval - duration)
        }, duration)
      }

      showSequenceTimerRef.current = window.setTimeout(showNext, PAUSE_BEFORE_PLAY_MS)
    },
    [playAudio],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(showSequenceTimerRef)
    clearTimeoutSafe(successFlashTimerRef)
    clearTimeoutSafe(failFlashTimerRef)
    effects.cleanup()

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const advanceToNextLevel = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    // Fast-clear bonus: extra points if completed quickly
    const clearTimeMs = performance.now() - levelStartAtRef.current
    const fastClearBonus = clearTimeMs < FAST_CLEAR_THRESHOLD_MS ? FAST_CLEAR_BONUS : 0

    // Fever multiplier
    const feverMultiplier = isFeverRef.current ? FEVER_BONUS_MULTIPLIER : 1
    const earned = (POINTS_PER_LEVEL + fastClearBonus) * feverMultiplier

    const nextScore = scoreRef.current + earned
    scoreRef.current = nextScore
    setScore(nextScore)

    const nextLevel = levelRef.current + 1
    levelRef.current = nextLevel
    setLevel(nextLevel)

    // Track consecutive clears for fever activation
    consecutiveClearsRef.current += 1
    setConsecutiveClears(consecutiveClearsRef.current)

    // Fever mode management
    if (isFeverRef.current) {
      feverLevelsRemainingRef.current -= 1
      if (feverLevelsRemainingRef.current <= 0) {
        isFeverRef.current = false
        setIsFever(false)
      }
    } else if (consecutiveClearsRef.current >= FEVER_STREAK_THRESHOLD) {
      // Activate fever mode
      isFeverRef.current = true
      setIsFever(true)
      feverLevelsRemainingRef.current = FEVER_DURATION_LEVELS
      consecutiveClearsRef.current = 0
      setConsecutiveClears(0)
      // Fever time bonus
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + FEVER_TIME_BONUS_MS)
      setRemainingMs(remainingMsRef.current)
    }

    const nextSequence = extendSequence(sequenceRef.current, isFeverRef.current)
    sequenceRef.current = nextSequence
    setSequence(nextSequence)

    setSuccessFlash(true)
    clearTimeoutSafe(successFlashTimerRef)
    successFlashTimerRef.current = window.setTimeout(() => {
      successFlashTimerRef.current = null
      setSuccessFlash(false)
      startShowingSequence(nextSequence)
    }, SUCCESS_FLASH_DURATION_MS)

    // Visual effects for level complete
    effects.comboHitBurst(200, 300, nextLevel, earned)

    if (fastClearBonus > 0) {
      effects.showScorePopup(fastClearBonus, 200, 250, '#fbbf24')
    }

    playAudio(tapHitStrongAudioRef, 0.6, 1 + Math.min(0.3, nextLevel * 0.02))
  }, [playAudio, startShowingSequence])

  const handleGameOver = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    consecutiveClearsRef.current = 0
    setConsecutiveClears(0)
    isFeverRef.current = false
    setIsFever(false)
    feverLevelsRemainingRef.current = 0

    phaseRef.current = 'result'
    setPhase('result')
    setFailFlash(true)
    playAudio(gameOverAudioRef, 0.6, 0.95)

    // Visual effects for game over
    effects.triggerShake(8)
    effects.triggerFlash('rgba(239,68,68,0.5)')

    clearTimeoutSafe(failFlashTimerRef)
    failFlashTimerRef.current = window.setTimeout(() => {
      failFlashTimerRef.current = null
      setFailFlash(false)
      finishGame()
    }, FAIL_FLASH_DURATION_MS)
  }, [finishGame, playAudio])

  const handleColorTap = useCallback(
    (color: SimonColor) => {
      if (finishedRef.current || phaseRef.current !== 'play') {
        return
      }

      const expectedColor = sequenceRef.current[playerIndexRef.current]
      if (color !== expectedColor) {
        handleGameOver()
        return
      }

      setActiveColor(color)
      playAudio(tapHitAudioRef, 0.4, 1 + playerIndexRef.current * 0.04)

      // Visual effects for correct tap
      effects.spawnParticles(3, 200, 350)
      effects.triggerFlash('rgba(255,255,255,0.3)', 60)

      window.setTimeout(() => {
        if (!finishedRef.current) {
          setActiveColor(null)
        }
      }, 150)

      const nextIndex = playerIndexRef.current + 1
      playerIndexRef.current = nextIndex
      setPlayerIndex(nextIndex)

      if (nextIndex >= sequenceRef.current.length) {
        advanceToNextLevel()
      }
    },
    [advanceToNextLevel, handleGameOver, playAudio],
  )

  const handleExit = useCallback(() => {
    playAudio(tapHitAudioRef, 0.3, 1)
    onExit()
  }, [onExit, playAudio])

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
      clearTimeoutSafe(showSequenceTimerRef)
      clearTimeoutSafe(successFlashTimerRef)
      clearTimeoutSafe(failFlashTimerRef)
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
    startShowingSequence(sequenceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    lastFrameAtRef.current = null

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
        playAudio(gameOverAudioRef, 0.6, 0.95)
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
  }, [finishGame, playAudio])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const showTiming = getShowTiming(level)
  const phaseLabel = isFever
    ? (phase === 'watch' ? 'FEVER! 기억하세요!' : phase === 'play' ? 'FEVER! x2 점수!' : '게임 오버!')
    : (phase === 'watch' ? '시퀀스를 기억하세요!' : phase === 'play' ? '순서대로 터치하세요!' : '게임 오버!')

  const comboLabel = getComboLabel(level)
  const comboColor = getComboColor(level)

  return (
    <section className="mini-game-panel simon-says-panel" aria-label="simon-says-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{`${GAME_EFFECTS_CSS}
        @keyframes simon-fever-pulse {
          from { transform: scale(1); opacity: 0.8; }
          to { transform: scale(1.08); opacity: 1; }
        }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="simon-says-score-strip">
        <p className="simon-says-score">{score.toLocaleString()}</p>
        <p className="simon-says-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`simon-says-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="simon-says-meta-row">
        <p className="simon-says-level">
          LEVEL <strong>{level}</strong>
        </p>
        <p className="simon-says-sequence-length">
          길이 <strong>{sequence.length}</strong> ({showTiming.interval}ms)
        </p>
        <p className="simon-says-progress">
          진행 <strong>{phase === 'play' ? `${playerIndex}/${sequence.length}` : '-'}</strong>
        </p>
      </div>

      {isFever ? (
        <p style={{ textAlign: 'center', fontSize: '16px', fontWeight: 800, color: '#f59e0b', margin: '2px 0', animation: 'simon-fever-pulse 0.5s ease-in-out infinite alternate' }}>
          FEVER MODE x{FEVER_BONUS_MULTIPLIER} ({feverLevelsRemainingRef.current} left)
        </p>
      ) : consecutiveClears > 0 ? (
        <p style={{ textAlign: 'center', fontSize: '12px', color: '#a78bfa', margin: '2px 0' }}>
          Streak {consecutiveClears}/{FEVER_STREAK_THRESHOLD} to FEVER
        </p>
      ) : null}

      {comboLabel && (
        <p className="ge-combo-label" style={{ textAlign: 'center', fontSize: '18px', color: comboColor, margin: '2px 0' }}>
          {comboLabel}
        </p>
      )}

      <p className={`simon-says-phase-label ${phase} ${successFlash ? 'success' : ''} ${failFlash ? 'fail' : ''}`}>
        {phaseLabel}
      </p>

      <img
        src={parkWankyuImg}
        alt="park-wankyu"
        style={{ width: '80px', height: '80px', objectFit: 'contain', margin: '4px auto', display: 'block' }}
      />

      <div className={`simon-says-grid ${successFlash ? 'success-flash' : ''} ${failFlash ? 'fail-flash' : ''}`}>
        {SIMON_COLORS.map((color) => {
          const info = COLOR_MAP[color]
          const isActive = activeColor === color
          const isDisabled = phase !== 'play' || finishedRef.current

          return (
            <button
              className={`simon-says-button simon-says-button-${color} ${isActive ? 'active' : ''}`}
              key={color}
              type="button"
              disabled={isDisabled}
              onClick={() => handleColorTap(color)}
              aria-label={info.label}
              style={{
                '--simon-color': info.hex,
                '--simon-bright': info.brightHex,
              } as React.CSSProperties}
            >
              <span className="simon-says-button-inner" />
            </button>
          )
        })}
      </div>

      <div className="simon-says-sequence-dots">
        {sequence.map((color, index) => {
          const isDone = phase === 'play' && index < playerIndex
          const isCurrent = phase === 'play' && index === playerIndex
          const isRevealed = phase === 'watch'

          return (
            <span
              className={`simon-says-dot ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${isRevealed ? 'revealed' : ''}`}
              key={`dot-${index}`}
              style={{
                backgroundColor: isRevealed || isDone ? COLOR_MAP[color].hex : isCurrent ? '#ffffff' : '#4b5563',
              }}
            />
          )
        })}
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const simonSaysModule: MiniGameModule = {
  manifest: {
    id: 'simon-says',
    title: 'Simon Says',
    description: '빨파초노! 색 순서를 기억하고 정확히 따라하라!',
    unlockCost: 40,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#22c55e',
  },
  Component: SimonSaysGame,
}
