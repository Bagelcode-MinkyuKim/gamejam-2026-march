import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import tapGoodSfx from '../../../assets/sounds/generated/combo-formula/cf-tap-good.mp3'
import tapAccentSfx from '../../../assets/sounds/generated/combo-formula/cf-tap-accent.mp3'
import tapBadSfx from '../../../assets/sounds/generated/combo-formula/cf-tap-bad.mp3'
import resetSfx from '../../../assets/sounds/generated/combo-formula/cf-reset.mp3'
import okLockedSfx from '../../../assets/sounds/generated/combo-formula/cf-ok-locked.mp3'
import okUnlockSfx from '../../../assets/sounds/generated/combo-formula/cf-ok-unlock.mp3'
import feverStartSfx from '../../../assets/sounds/generated/combo-formula/cf-fever-start.mp3'
import feverEndSfx from '../../../assets/sounds/generated/combo-formula/cf-fever-end.mp3'
import feverGainSfx from '../../../assets/sounds/generated/combo-formula/cf-fever-gain.mp3'
import comboMilestoneSfx from '../../../assets/sounds/generated/combo-formula/cf-combo-milestone.mp3'
import lowTimeSfx from '../../../assets/sounds/generated/combo-formula/cf-low-time.mp3'
import gameOverSfx from '../../../assets/sounds/generated/combo-formula/cf-game-over.mp3'
import exitSfx from '../../../assets/sounds/generated/combo-formula/cf-exit.mp3'
import gameplayBgmLoop from '../../../assets/sounds/generated/same-character/sc-gameplay-loop.mp3'
import feverBgmLoop from '../../../assets/sounds/generated/same-character/sc-fever-loop.mp3'

const LANE_COUNT = 3
const STACK_ROWS = 4
const GAME_DURATION_MS = 40000
const MAX_TIME_MS = 99000
const TIME_BONUS_ON_MATCH_MS = 10000
const TURN_DURATION_MS = 1000
const STAR_GAIN_ON_MATCH = 24
const STAR_LOSS_ON_MISS = 30
const FEVER_DURATION_MS = 6000
const INCOMING_QUEUE_SIZE = 5
const LOW_TIME_ALERT_THRESHOLD_MS = 10000

const CHARACTER_POOL = [
  { id: 'park-sangmin', name: 'Park Sangmin', color: '#ef4444', imageSrc: parkSangminImage },
  { id: 'song-changsik', name: 'Song Changsik', color: '#22c55e', imageSrc: songChangsikImage },
  { id: 'tae-jina', name: 'Tae Jina', color: '#22d3ee', imageSrc: taeJinaImage },
  { id: 'park-wankyu', name: 'Park Wankyu', color: '#f59e0b', imageSrc: parkWankyuImage },
  { id: 'kim-yeonja', name: 'Kim Yeonja', color: '#ec4899', imageSrc: kimYeonjaImage },
  { id: 'seo-taiji', name: 'Seo Taiji', color: '#8b5cf6', imageSrc: seoTaijiImage },
] as const

type CharacterToken = (typeof CHARACTER_POOL)[number]
type JudgeState = 'ready' | 'match' | 'miss'
type FxPresetId = 'soft' | 'normal' | 'strong'
type AudioKey =
  | 'tapGood'
  | 'tapAccent'
  | 'tapBad'
  | 'reset'
  | 'okLocked'
  | 'okUnlock'
  | 'feverStart'
  | 'feverEnd'
  | 'feverGain'
  | 'comboMilestone'
  | 'lowTime'
  | 'gameOver'
  | 'exit'

const FX_PRESET_ORDER: FxPresetId[] = ['soft', 'normal', 'strong']
const FX_PRESET_CONFIG: Record<
  FxPresetId,
  {
    label: string
    sfxGain: number
    burstDurationScale: number
    pitchBias: number
  }
> = {
  soft: {
    label: 'Low',
    sfxGain: 0.76,
    burstDurationScale: 0.84,
    pitchBias: -0.02,
  },
  normal: {
    label: 'Med',
    sfxGain: 1,
    burstDurationScale: 1,
    pitchBias: 0,
  },
  strong: {
    label: 'High',
    sfxGain: 1.14,
    burstDurationScale: 1.2,
    pitchBias: 0.04,
  },
}

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomCharacter(): CharacterToken {
  const index = Math.floor(Math.random() * CHARACTER_POOL.length)
  return CHARACTER_POOL[index]
}

function createInitialStacks(): CharacterToken[][] {
  return Array.from({ length: LANE_COUNT }, () => Array.from({ length: STACK_ROWS }, randomCharacter))
}

function createIncomingQueue(): CharacterToken[] {
  return Array.from({ length: INCOMING_QUEUE_SIZE }, randomCharacter)
}

function nextIncomingQueue(currentQueue: CharacterToken[]): CharacterToken[] {
  return [...currentQueue.slice(1), randomCharacter()]
}

function SameCharacterGame({ onFinish, onExit: _onExit }: MiniGameSessionProps) {
  const [selectedLane, setSelectedLane] = useState(1)
  const [laneStacks, setLaneStacks] = useState<CharacterToken[][]>(() => createInitialStacks())
  const [incomingQueue, setIncomingQueue] = useState<CharacterToken[]>(() => createIncomingQueue())
  const [turnRemainingMs, setTurnRemainingMs] = useState(TURN_DURATION_MS)
  const [remainingMs, setRemainingMs] = useState(GAME_DURATION_MS)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [bestCombo, setBestCombo] = useState(0)
  const [starGauge, setStarGauge] = useState(0)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [judge, setJudge] = useState<JudgeState>('ready')
  const [burstText, setBurstText] = useState<string | null>(null)
  const [timeBonusFlashMs, setTimeBonusFlashMs] = useState(0)
  const [fxPreset, setFxPreset] = useState<FxPresetId>('strong')

  const selectedLaneRef = useRef(selectedLane)
  const laneStacksRef = useRef<CharacterToken[][]>(laneStacks)
  const incomingQueueRef = useRef<CharacterToken[]>(incomingQueue)
  const turnRemainingMsRef = useRef(turnRemainingMs)
  const remainingMsRef = useRef(remainingMs)
  const scoreRef = useRef(score)
  const comboRef = useRef(combo)
  const bestComboRef = useRef(bestCombo)
  const starGaugeRef = useRef(starGauge)
  const feverRemainingMsRef = useRef(feverRemainingMs)
  const timeBonusFlashMsRef = useRef(timeBonusFlashMs)
  const burstMsRef = useRef(0)
  const finishedRef = useRef(false)
  const startedAtRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const fxPresetRef = useRef<FxPresetId>(fxPreset)
  const lowTimeAlertedRef = useRef(false)
  const feverBgmActiveRef = useRef(false)
  const sfxRefs = useRef<Record<AudioKey, HTMLAudioElement | null>>({
    tapGood: null,
    tapAccent: null,
    tapBad: null,
    reset: null,
    okLocked: null,
    okUnlock: null,
    feverStart: null,
    feverEnd: null,
    feverGain: null,
    comboMilestone: null,
    lowTime: null,
    gameOver: null,
    exit: null,
  })
  const gameplayBgmRef = useRef<HTMLAudioElement | null>(null)
  const feverBgmRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    fxPresetRef.current = fxPreset
  }, [fxPreset])

  const playSfx = useCallback((key: AudioKey, volume = 1, playbackRate = 1) => {
    const audio = sfxRefs.current[key]
    if (!audio) {
      return
    }
    const preset = FX_PRESET_CONFIG[fxPresetRef.current]
    audio.pause()
    audio.currentTime = 0
    audio.volume = clamp(0, volume * preset.sfxGain, 1)
    audio.playbackRate = clamp(0.72, playbackRate + preset.pitchBias, 1.45)
    void audio.play().catch(() => {})
  }, [])

  const resolveBurstDuration = useCallback((baseMs: number): number => {
    return Math.round(baseMs * FX_PRESET_CONFIG[fxPresetRef.current].burstDurationScale)
  }, [])

  const switchBgm = useCallback((isFeverMode: boolean) => {
    if (feverBgmActiveRef.current === isFeverMode) {
      return
    }
    const gameplayAudio = gameplayBgmRef.current
    const feverAudio = feverBgmRef.current
    if (!gameplayAudio || !feverAudio) {
      return
    }
    feverBgmActiveRef.current = isFeverMode
    if (isFeverMode) {
      gameplayAudio.pause()
      feverAudio.currentTime = 0
      void feverAudio.play().catch(() => {})
      return
    }
    feverAudio.pause()
    feverAudio.currentTime = 0
    void gameplayAudio.play().catch(() => {})
  }, [])

  useEffect(() => {
    const createAudio = (src: string, volume: number, loop = false): HTMLAudioElement => {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audio.volume = volume
      audio.loop = loop
      return audio
    }

    sfxRefs.current = {
      tapGood: createAudio(tapGoodSfx, 0.78),
      tapAccent: createAudio(tapAccentSfx, 0.82),
      tapBad: createAudio(tapBadSfx, 0.82),
      reset: createAudio(resetSfx, 0.74),
      okLocked: createAudio(okLockedSfx, 0.75),
      okUnlock: createAudio(okUnlockSfx, 0.86),
      feverStart: createAudio(feverStartSfx, 0.96),
      feverEnd: createAudio(feverEndSfx, 0.94),
      feverGain: createAudio(feverGainSfx, 0.8),
      comboMilestone: createAudio(comboMilestoneSfx, 0.88),
      lowTime: createAudio(lowTimeSfx, 0.88),
      gameOver: createAudio(gameOverSfx, 0.94),
      exit: createAudio(exitSfx, 0.9),
    }
    gameplayBgmRef.current = createAudio(gameplayBgmLoop, 0.42, true)
    feverBgmRef.current = createAudio(feverBgmLoop, 0.5, true)
    feverBgmActiveRef.current = false
    lowTimeAlertedRef.current = false
    void gameplayBgmRef.current.play().catch(() => {})

    return () => {
      Object.values(sfxRefs.current).forEach((audio) => {
        if (!audio) {
          return
        }
        audio.pause()
        audio.currentTime = 0
      })
      if (gameplayBgmRef.current) {
        gameplayBgmRef.current.pause()
        gameplayBgmRef.current.currentTime = 0
      }
      if (feverBgmRef.current) {
        feverBgmRef.current.pause()
        feverBgmRef.current.currentTime = 0
      }
    }
  }, [])

  const chooseLane = useCallback((nextLane: number) => {
    const currentLane = selectedLaneRef.current
    const clamped = clamp(0, nextLane, LANE_COUNT - 1)
    if (clamped === currentLane) {
      playSfx('okLocked', 0.75, 0.92)
      return
    }
    selectedLaneRef.current = clamped
    setSelectedLane(clamped)
    playSfx('tapAccent', 0.7, 1 + Math.abs(clamped - currentLane) * 0.06)
  }, [playSfx])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    playSfx('gameOver', 0.94, 1)
    if (gameplayBgmRef.current) {
      gameplayBgmRef.current.pause()
    }
    if (feverBgmRef.current) {
      feverBgmRef.current.pause()
    }
    const elapsedMs = Math.max(Math.round(DEFAULT_FRAME_MS), Math.round(window.performance.now() - startedAtRef.current))
    const comboBonus = bestComboRef.current * 5

    onFinish({
      score: scoreRef.current + comboBonus,
      durationMs: elapsedMs,
    })
  }, [onFinish, playSfx])

  const resolveTurn = useCallback((): void => {
    const laneIndex = selectedLaneRef.current
    const topCharacter = laneStacksRef.current[laneIndex][0]
    const currentIncoming = incomingQueueRef.current[0]
    const isMatch = topCharacter.id === currentIncoming.id

    if (isMatch) {
      const nextCombo = comboRef.current + 1
      const nextBestCombo = Math.max(bestComboRef.current, nextCombo)
      const scoreBase = feverRemainingMsRef.current > 0 ? 30 : 18
      const gainedScore = scoreBase + nextCombo * 6
      const nextScore = scoreRef.current + gainedScore
      const comboPitch = 1 + Math.min(nextCombo * 0.014, 0.34)
      playSfx(nextCombo % 5 === 0 ? 'tapAccent' : 'tapGood', 0.84, comboPitch)

      comboRef.current = nextCombo
      bestComboRef.current = nextBestCombo
      scoreRef.current = nextScore
      setCombo(nextCombo)
      setBestCombo(nextBestCombo)
      setScore(nextScore)

      const nextRemainingMs = Math.min(MAX_TIME_MS, remainingMsRef.current + TIME_BONUS_ON_MATCH_MS)
      remainingMsRef.current = nextRemainingMs
      setRemainingMs(nextRemainingMs)
      timeBonusFlashMsRef.current = 700
      setTimeBonusFlashMs(700)

      const previousStarGauge = starGaugeRef.current
      let nextStarGauge = previousStarGauge + STAR_GAIN_ON_MATCH
      if (nextStarGauge >= 100) {
        nextStarGauge -= 100
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setFeverRemainingMs(FEVER_DURATION_MS)
        burstMsRef.current = resolveBurstDuration(900)
        setBurstText('SUPER FEVER!')
        playSfx('okUnlock', 0.86, 1.08)
        playSfx('feverStart', 0.96, 1.04)
        switchBgm(true)
      } else if (nextCombo >= 3) {
        burstMsRef.current = resolveBurstDuration(700)
        if (nextCombo % 10 === 0) {
          setBurstText(`${nextCombo} COMBO!`)
          playSfx('comboMilestone', 0.9, 1 + Math.min(nextCombo / 120, 0.24))
        } else {
          setBurstText('WOW!')
        }
      }

      const previousTier = Math.floor(previousStarGauge / 25)
      const nextTier = Math.floor(nextStarGauge / 25)
      if (nextTier > previousTier) {
        playSfx('feverGain', 0.78, 1 + nextTier * 0.06)
      }

      starGaugeRef.current = nextStarGauge
      setStarGauge(nextStarGauge)

      const currentLane = laneStacksRef.current[laneIndex]
      const nextLaneStack = [randomCharacter(), ...currentLane.slice(0, STACK_ROWS - 1)]
      const nextStacks = laneStacksRef.current.map((stack, index) => (index === laneIndex ? nextLaneStack : stack))
      laneStacksRef.current = nextStacks
      setLaneStacks(nextStacks)

      setJudge('match')
    } else {
      const hadCombo = comboRef.current >= 2
      comboRef.current = 0
      setCombo(0)
      playSfx('tapBad', 0.86, 1)
      if (hadCombo) {
        playSfx('reset', 0.74, 0.94)
      }

      const nextStarGauge = Math.max(0, starGaugeRef.current - STAR_LOSS_ON_MISS)
      starGaugeRef.current = nextStarGauge
      setStarGauge(nextStarGauge)
      setJudge('miss')
    }

    const nextQueue = nextIncomingQueue(incomingQueueRef.current)
    incomingQueueRef.current = nextQueue
    setIncomingQueue(nextQueue)
    turnRemainingMsRef.current = TURN_DURATION_MS
    setTurnRemainingMs(TURN_DURATION_MS)
  }, [playSfx, resolveBurstDuration, switchBgm])

  useEffect(() => {
    startedAtRef.current = window.performance.now()
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
      if (
        !lowTimeAlertedRef.current &&
        remainingMsRef.current > 0 &&
        remainingMsRef.current <= LOW_TIME_ALERT_THRESHOLD_MS
      ) {
        lowTimeAlertedRef.current = true
        playSfx('lowTime', 0.9, 1.02)
      } else if (lowTimeAlertedRef.current && remainingMsRef.current > LOW_TIME_ALERT_THRESHOLD_MS + 6000) {
        lowTimeAlertedRef.current = false
      }

      if (feverRemainingMsRef.current > 0) {
        const previousFeverMs = feverRemainingMsRef.current
        feverRemainingMsRef.current = Math.max(0, previousFeverMs - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (previousFeverMs > 0 && feverRemainingMsRef.current === 0) {
          playSfx('feverEnd', 0.9, 0.96)
          switchBgm(false)
        }
      }

      if (timeBonusFlashMsRef.current > 0) {
        timeBonusFlashMsRef.current = Math.max(0, timeBonusFlashMsRef.current - deltaMs)
        setTimeBonusFlashMs(timeBonusFlashMsRef.current)
      }

      if (burstMsRef.current > 0) {
        burstMsRef.current = Math.max(0, burstMsRef.current - deltaMs)
        if (burstMsRef.current === 0) {
          setBurstText(null)
        }
      }

      turnRemainingMsRef.current = Math.max(0, turnRemainingMsRef.current - deltaMs)
      setTurnRemainingMs(turnRemainingMsRef.current)
      if (turnRemainingMsRef.current === 0) {
        resolveTurn()
      }

      if (remainingMsRef.current === 0) {
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
  }, [finishGame, playSfx, resolveTurn, switchBgm])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current) {
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        chooseLane(selectedLaneRef.current - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        chooseLane(selectedLaneRef.current + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [chooseLane])

  const moveLeft = () => {
    if (finishedRef.current) {
      return
    }
    chooseLane(selectedLaneRef.current - 1)
  }

  const moveRight = () => {
    if (finishedRef.current) {
      return
    }
    chooseLane(selectedLaneRef.current + 1)
  }

  const handlePresetChange = (nextPreset: FxPresetId) => {
    if (fxPresetRef.current === nextPreset) {
      return
    }
    fxPresetRef.current = nextPreset
    setFxPreset(nextPreset)
    const presetIndex = FX_PRESET_ORDER.indexOf(nextPreset)
    playSfx('okUnlock', 0.62 + presetIndex * 0.08, 1 + presetIndex * 0.04)
  }


  const turnFillPercent = (turnRemainingMs / TURN_DURATION_MS) * 100
  const feverFillPercent = feverRemainingMs > 0 ? (feverRemainingMs / FEVER_DURATION_MS) * 100 : 0
  const leftPreview = laneStacks[0]?.slice(0, 2) ?? []
  const rightPreview = laneStacks[2]?.slice(0, 2) ?? []

  return (
    <section className={`mini-game-panel same-character-panel fx-${fxPreset}`} aria-label="same-character-game">
      <div className="same-character-score-strip">
        <p>⭐ {starGauge}</p>
        <p>{score.toLocaleString()}</p>
        <p>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="same-character-fx-toggle" role="group" aria-label="effect-intensity">
        {FX_PRESET_ORDER.map((presetId) => (
          <button
            key={`fx-preset-${presetId}`}
            className={`same-character-fx-chip ${fxPreset === presetId ? 'active' : ''}`}
            type="button"
            onClick={() => handlePresetChange(presetId)}
            aria-label={`fx-${presetId}`}
          >
            {FX_PRESET_CONFIG[presetId].label}
          </button>
        ))}
      </div>

      <div className="same-character-top-row">
        <div className="same-character-star-meter" role="presentation">
          <div className="same-character-star-fill" style={{ width: `${starGauge}%` }} />
        </div>
        {timeBonusFlashMs > 0 ? <p className="same-character-time-bonus">+10s</p> : <p className="same-character-time-bonus"> </p>}
      </div>

      <div className={`same-character-fever-meter ${feverRemainingMs > 0 ? 'active' : ''}`} role="presentation">
        <div className="same-character-fever-fill" style={{ width: `${feverFillPercent}%` }} />
        <span>{feverRemainingMs > 0 ? `SUPER FEVER ${(feverRemainingMs / 1000).toFixed(1)}s` : 'SUPER FEVER CHARGE'}</span>
      </div>

      <div className="same-character-turn-track" role="presentation">
        <div className="same-character-turn-fill" style={{ width: `${turnFillPercent}%` }} />
      </div>

      <div className="same-character-track" role="presentation">
        <div className="same-character-road-guide" />
        <div className="same-character-combo-pop">
          <strong>{combo}</strong>
          <span>COMBO</span>
        </div>
        <div className="same-character-side-group left" aria-hidden>
          {leftPreview.map((character, index) => (
            <img
              className={`same-character-side-avatar ${index === 0 ? 'primary' : 'secondary'}`}
              key={`left-preview-${character.id}-${index}`}
              src={character.imageSrc}
              alt=""
            />
          ))}
        </div>
        <div className="same-character-side-group right" aria-hidden>
          {rightPreview.map((character, index) => (
            <img
              className={`same-character-side-avatar ${index === 0 ? 'primary' : 'secondary'}`}
              key={`right-preview-${character.id}-${index}`}
              src={character.imageSrc}
              alt=""
            />
          ))}
        </div>

        <div className="same-character-incoming-line">
          {[...incomingQueue].reverse().map((character, reverseIndex) => {
            const queueIndex = incomingQueue.length - 1 - reverseIndex
            const isCurrent = queueIndex === 0
            return (
              <div
                className={`same-character-incoming-item ${isCurrent ? 'active' : ''} ${feverRemainingMs > 0 && isCurrent ? 'fever' : ''}`}
                key={`incoming-${queueIndex}-${character.id}`}
                style={
                  {
                    '--queue-layer': reverseIndex,
                    zIndex: reverseIndex + 1,
                  } as CSSProperties
                }
              >
                <img
                  className={`same-character-avatar ${isCurrent ? 'large' : ''}`}
                  src={character.imageSrc}
                  alt={character.name}
                />
              </div>
            )
          })}
        </div>

        <div className="same-character-stacks">
          {laneStacks.map((stack, laneIndex) => (
            <div className={`same-character-lane ${selectedLane === laneIndex ? 'selected' : ''}`} key={`lane-${laneIndex}`}>
              {stack.map((character, rowIndex) => (
                <div
                  className={`same-character-stack-item ${rowIndex === 0 ? 'target' : ''}`}
                  key={`${laneIndex}-${rowIndex}-${character.id}`}
                  style={{ '--stack-level': STACK_ROWS - rowIndex - 1 } as CSSProperties}
                >
                  <img className="same-character-avatar" src={character.imageSrc} alt={character.name} />
                </div>
              ))}
            </div>
          ))}
        </div>

        {burstText !== null ? <p className="same-character-burst">{burstText}</p> : null}
      </div>

      <div className="same-character-controls">
        <button className="same-character-arrow" type="button" onClick={moveLeft} aria-label="move-left">
          ←
        </button>
        <button className="same-character-arrow" type="button" onClick={moveRight} aria-label="move-right">
          →
        </button>
      </div>

      <p className={`same-character-judge ${judge}`}>{judge === 'match' ? 'WOW!' : judge === 'miss' ? 'Oops!' : ''}</p>
    </section>
  )
}

export const sameCharacterModule: MiniGameModule = {
  manifest: {
    id: 'same-character',
    title: 'Connect Four',
    description: 'Match queue characters to lanes with L/R moves for combos',
    unlockCost: 140,
    baseReward: 24,
    scoreRewardMultiplier: 0.7,
    accentColor: '#f59e0b',
  },
  Component: SameCharacterGame,
}
