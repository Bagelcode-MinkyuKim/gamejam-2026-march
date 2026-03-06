import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { AUDIO_ENABLED, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikSprite from '../../../assets/images/same-character/song-changsik.png'
import taeJinaSprite from '../../../assets/images/same-character/tae-jina.png'
import heartBonusSprite from '../../../assets/images/tap-dash-heart-pixel.svg'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import feverTimeBoostSfx from '../../../assets/sounds/fever-time-boost.mp3'
import heartTimeBonusSfx from '../../../assets/sounds/heart-time-bonus.mp3'
import superFeverStartSfx from '../../../assets/sounds/super-fever-start.mp3'
import comboMilestoneSfx from '../../../assets/sounds/combo-milestone.mp3'
import superFeverEndSfx from '../../../assets/sounds/super-fever-end.mp3'
import lowTimeAlertSfx from '../../../assets/sounds/low-time-alert.mp3'
import gameplayBgmLoop from '../../../assets/sounds/gameplay-bgm-loop.mp3'
import superFeverBgmLoop from '../../../assets/sounds/super-fever-bgm-loop.mp3'

const ROUND_DURATION_MS = 30000
const IMPACT_LIFETIME_MS = 620

const COMBO_WINDOW_MS = 520
const FEVER_COMBO_THRESHOLD = 11
const FEVER_TIME_BONUS_MS = 100
const SUPER_FEVER_DURATION_MS = 10000
const SUPER_FEVER_INITIAL_TRIGGER_COMBO = 51
const SUPER_FEVER_REENTRY_COMBO_DELTA = 100

const HEART_BONUS_MS = 20000
const HEART_SCORE_STEP = 75
const HEART_SPAWN_DELAY_MIN_MS = 900
const HEART_SPAWN_DELAY_MAX_MS = 4200
const HEART_VISIBLE_MS = 3400
const TIME_BOOST_POP_MS = 560
const COMBO_BURST_POP_MS = 660
const COMBO_MILESTONE_INTERVAL = 10

const TAP_SFX_COMBO_PITCH_MAX_BOOST = 0.13
const TAP_SFX_FEVER_PITCH_MAX_BOOST = 0.08
const TAP_SFX_SUPER_CHARGE_PITCH_MAX_BOOST = 0.16
const TAP_SFX_SUPER_FEVER_PITCH_BONUS = 0.1

const TARGET_MOTION_BASE_SPEED = 9
const TARGET_MOTION_MAX_SPEED = 64
const TARGET_MOTION_BASE_CHAOS = 4.6
const TARGET_MOTION_MAX_CHAOS = 33
const TARGET_MOTION_SCORE_SOFT_CAP = 520

const TARGET_SPAWN_X_MIN = 24
const TARGET_SPAWN_X_MAX = 76
const TARGET_SPAWN_Y_MIN = 22
const TARGET_SPAWN_Y_MAX = 82

const HEART_SPAWN_X_MIN = 14
const HEART_SPAWN_X_MAX = 86
const HEART_SPAWN_Y_MIN = 24
const HEART_SPAWN_Y_MAX = 82
const IMPACT_SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const

const EFFECT_PRESET_IDS = ['low', 'medium', 'high'] as const
type EffectPresetId = (typeof EFFECT_PRESET_IDS)[number]

const EFFECT_PRESET_CONFIG: Record<
  EffectPresetId,
  {
    readonly label: string
    readonly impactScale: number
    readonly tapStrongVolumeScale: number
    readonly tapLayerVolumeScale: number
    readonly tapPitchOffset: number
    readonly comboBurstDurationMs: number
    readonly zoneHitDurationMs: number
  }
> = {
  low: {
    label: '약',
    impactScale: 0.82,
    tapStrongVolumeScale: 0.9,
    tapLayerVolumeScale: 0.74,
    tapPitchOffset: -0.03,
    comboBurstDurationMs: 540,
    zoneHitDurationMs: 88,
  },
  medium: {
    label: '중',
    impactScale: 1,
    tapStrongVolumeScale: 1,
    tapLayerVolumeScale: 0.84,
    tapPitchOffset: 0,
    comboBurstDurationMs: COMBO_BURST_POP_MS,
    zoneHitDurationMs: 110,
  },
  high: {
    label: '강',
    impactScale: 1.22,
    tapStrongVolumeScale: 1.14,
    tapLayerVolumeScale: 0.98,
    tapPitchOffset: 0.05,
    comboBurstDurationMs: 760,
    zoneHitDurationMs: 132,
  },
}

const TARGET_CHARACTER_IMAGES = [
  kimYeonjaSprite,
  parkSangminSprite,
  parkWankyuSprite,
  seoTaijiSprite,
  songChangsikSprite,
  taeJinaSprite,
] as const

interface TapImpact {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly hueRotateDeg: number
  readonly waveScale: number
  readonly sparkRotationDeg: number
  readonly sparkTravelPx: number
  readonly scoreDriftX: number
}

interface TapTarget {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly characterImage: string
  readonly rotationDeg: number
  readonly scale: number
  readonly velocityX: number
  readonly velocityY: number
}

interface HeartPickup {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly rotationDeg: number
  readonly scale: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function createTarget(targetId: number, lockToCenter: boolean): TapTarget {
  const characterImage = TARGET_CHARACTER_IMAGES[Math.floor(Math.random() * TARGET_CHARACTER_IMAGES.length)]

  if (lockToCenter) {
    return {
      id: targetId,
      x: 50,
      y: 54,
      characterImage,
      rotationDeg: 0,
      scale: 1.08,
      velocityX: 0,
      velocityY: 0,
    }
  }

  return {
    id: targetId,
    x: randomBetween(TARGET_SPAWN_X_MIN, TARGET_SPAWN_X_MAX),
    y: randomBetween(TARGET_SPAWN_Y_MIN, TARGET_SPAWN_Y_MAX),
    characterImage,
    rotationDeg: 0,
    scale: randomBetween(0.92, 1.1),
    velocityX: randomBetween(-12, 12),
    velocityY: randomBetween(-12, 12),
  }
}

function createHeartPickup(heartId: number): HeartPickup {
  return {
    id: heartId,
    x: randomBetween(HEART_SPAWN_X_MIN, HEART_SPAWN_X_MAX),
    y: randomBetween(HEART_SPAWN_Y_MIN, HEART_SPAWN_Y_MAX),
    rotationDeg: randomBetween(-18, 18),
    scale: randomBetween(0.9, 1.12),
  }
}

function TapDashGame({ onFinish, onExit, bestScore = 0, isAudioMuted = false }: MiniGameSessionProps) {
  const [effectPresetId] = useState<EffectPresetId>('medium')
  const [currentScore, setCurrentScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [currentCombo, setCurrentCombo] = useState(0)
  const [impacts, setImpacts] = useState<TapImpact[]>([])
  const [isZoneHitActive, setZoneHitActive] = useState(false)
  const [isSuperFeverActive, setSuperFeverActive] = useState(false)
  const [superFeverRemainingMs, setSuperFeverRemainingMs] = useState(0)
  const [nextSuperFeverCombo, setNextSuperFeverCombo] = useState(SUPER_FEVER_INITIAL_TRIGGER_COMBO)
  const [target, setTarget] = useState<TapTarget>(() => createTarget(0, false))
  const [heartPickup, setHeartPickup] = useState<HeartPickup | null>(null)
  const [timeBoostText, setTimeBoostText] = useState<string | null>(null)
  const [timeBoostPulseId, setTimeBoostPulseId] = useState(0)
  const [comboBurstText, setComboBurstText] = useState<string | null>(null)
  const [comboBurstId, setComboBurstId] = useState(0)
  const effectPresetConfig = EFFECT_PRESET_CONFIG[effectPresetId]

  const startedAtRef = useRef(0)
  const finishedRef = useRef(false)
  const tapsRef = useRef(0)
  const comboRef = useRef(0)
  const lastTapAtRef = useRef(0)
  const impactIdRef = useRef(0)
  const targetIdRef = useRef(1)
  const heartIdRef = useRef(1)
  const nextHeartScoreRef = useRef(HEART_SCORE_STEP)
  const pendingHeartSpawnCountRef = useRef(0)
  const heartRef = useRef<HeartPickup | null>(null)
  const heartSpawnFnRef = useRef<() => void>(() => {})
  const cleanupTimerIdsRef = useRef<number[]>([])
  const zoneHitTimerRef = useRef<number | null>(null)
  const heartSpawnTimerRef = useRef<number | null>(null)
  const heartExpireTimerRef = useRef<number | null>(null)
  const timeBoostTimerRef = useRef<number | null>(null)
  const comboBurstTimerRef = useRef<number | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const superFeverActiveRef = useRef(false)
  const superFeverEndsAtRef = useRef(0)
  const nextSuperFeverComboRef = useRef(SUPER_FEVER_INITIAL_TRIGGER_COMBO)
  const lastLowTimeAlertSecondRef = useRef<number | null>(null)
  const isAudioMutedRef = useRef(isAudioMuted)
  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverBoostAudioRef = useRef<HTMLAudioElement | null>(null)
  const heartBonusAudioRef = useRef<HTMLAudioElement | null>(null)
  const superFeverStartAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboMilestoneAudioRef = useRef<HTMLAudioElement | null>(null)
  const superFeverEndAudioRef = useRef<HTMLAudioElement | null>(null)
  const lowTimeAlertAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameplayBgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const superFeverBgmAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    for (const src of [...TARGET_CHARACTER_IMAGES, heartBonusSprite]) {
      const image = new Image()
      image.decoding = 'sync'
      image.src = src
      void image.decode?.().catch(() => {})
    }

    if (!AUDIO_ENABLED) {
      return
    }

    const tapAudio = new Audio(tapHitSfx)
    tapAudio.preload = 'auto'
    tapAudio.volume = 0.26
    tapHitAudioRef.current = tapAudio

    const tapStrongAudio = new Audio(tapHitStrongSfx)
    tapStrongAudio.preload = 'auto'
    tapStrongAudio.volume = 0.74
    tapHitStrongAudioRef.current = tapStrongAudio

    const feverAudio = new Audio(feverTimeBoostSfx)
    feverAudio.preload = 'auto'
    feverAudio.volume = 0.52
    feverBoostAudioRef.current = feverAudio

    const heartAudio = new Audio(heartTimeBonusSfx)
    heartAudio.preload = 'auto'
    heartAudio.volume = 0.58
    heartBonusAudioRef.current = heartAudio

    const superAudio = new Audio(superFeverStartSfx)
    superAudio.preload = 'auto'
    superAudio.volume = 0.72
    superFeverStartAudioRef.current = superAudio

    const comboMilestoneAudio = new Audio(comboMilestoneSfx)
    comboMilestoneAudio.preload = 'auto'
    comboMilestoneAudio.volume = 0.64
    comboMilestoneAudioRef.current = comboMilestoneAudio

    const superEndAudio = new Audio(superFeverEndSfx)
    superEndAudio.preload = 'auto'
    superEndAudio.volume = 0.62
    superFeverEndAudioRef.current = superEndAudio

    const lowTimeAudio = new Audio(lowTimeAlertSfx)
    lowTimeAudio.preload = 'auto'
    lowTimeAudio.volume = 0.56
    lowTimeAlertAudioRef.current = lowTimeAudio

    const gameplayBgmAudio = new Audio(gameplayBgmLoop)
    gameplayBgmAudio.preload = 'auto'
    gameplayBgmAudio.loop = true
    gameplayBgmAudio.volume = 0.34
    gameplayBgmAudioRef.current = gameplayBgmAudio

    const superFeverBgmAudio = new Audio(superFeverBgmLoop)
    superFeverBgmAudio.preload = 'auto'
    superFeverBgmAudio.loop = true
    superFeverBgmAudio.volume = 0.5
    superFeverBgmAudioRef.current = superFeverBgmAudio
  }, [])

  useEffect(() => {
    isAudioMutedRef.current = isAudioMuted
  }, [isAudioMuted])

  const clearHeartSpawnTimer = useCallback(() => {
    if (heartSpawnTimerRef.current !== null) {
      window.clearTimeout(heartSpawnTimerRef.current)
      heartSpawnTimerRef.current = null
    }
  }, [])

  const clearHeartExpireTimer = useCallback(() => {
    if (heartExpireTimerRef.current !== null) {
      window.clearTimeout(heartExpireTimerRef.current)
      heartExpireTimerRef.current = null
    }
  }, [])

  const clearTimeBoostTimer = useCallback(() => {
    if (timeBoostTimerRef.current !== null) {
      window.clearTimeout(timeBoostTimerRef.current)
      timeBoostTimerRef.current = null
    }
  }, [])

  const clearComboBurstTimer = useCallback(() => {
    if (comboBurstTimerRef.current !== null) {
      window.clearTimeout(comboBurstTimerRef.current)
      comboBurstTimerRef.current = null
    }
  }, [])

  const playSfx = useCallback(
    (
      source: HTMLAudioElement | null,
      options?: Readonly<{ volumeScale?: number; playbackRateMin?: number; playbackRateMax?: number }>,
    ) => {
      if (!AUDIO_ENABLED || isAudioMutedRef.current) {
        return
      }

      if (source === null) {
        return
      }

      const instance = source.cloneNode(true) as HTMLAudioElement
      instance.volume = clamp(source.volume * (options?.volumeScale ?? 1), 0, 1)

      if (
        options?.playbackRateMin !== undefined &&
        options?.playbackRateMax !== undefined &&
        options.playbackRateMin <= options.playbackRateMax
      ) {
        instance.playbackRate = randomBetween(options.playbackRateMin, options.playbackRateMax)
      }

      void instance.play().catch(() => {})
    },
    [],
  )

  const getTapPitchWindow = useCallback((nextCombo: number) => {
    const comboPitchProgress = clamp((nextCombo - 1) / 120, 0, 1)
    const feverPitchProgress = clamp((nextCombo - FEVER_COMBO_THRESHOLD + 1) / FEVER_COMBO_THRESHOLD, 0, 1)

    const superTriggerCombo = nextSuperFeverComboRef.current
    const superChargeFloor =
      superTriggerCombo <= SUPER_FEVER_INITIAL_TRIGGER_COMBO ? 0 : superTriggerCombo - SUPER_FEVER_REENTRY_COMBO_DELTA
    const superChargeWindow =
      superTriggerCombo <= SUPER_FEVER_INITIAL_TRIGGER_COMBO
        ? SUPER_FEVER_INITIAL_TRIGGER_COMBO
        : SUPER_FEVER_REENTRY_COMBO_DELTA
    const superChargePitchProgress = clamp((nextCombo - superChargeFloor) / superChargeWindow, 0, 1)

    const pitchCenter =
      0.94 +
      comboPitchProgress * TAP_SFX_COMBO_PITCH_MAX_BOOST +
      feverPitchProgress * TAP_SFX_FEVER_PITCH_MAX_BOOST +
      superChargePitchProgress * TAP_SFX_SUPER_CHARGE_PITCH_MAX_BOOST +
      (superFeverActiveRef.current ? TAP_SFX_SUPER_FEVER_PITCH_BONUS : 0) +
      effectPresetConfig.tapPitchOffset

    return {
      strongMin: clamp(pitchCenter - 0.08, 0.88, 1.42),
      strongMax: clamp(pitchCenter, 0.93, 1.48),
      layerMin: clamp(pitchCenter + 0.02, 0.96, 1.54),
      layerMax: clamp(pitchCenter + 0.1, 1.02, 1.62),
    }
  }, [effectPresetConfig.tapPitchOffset])

  const stopGameplayBgm = useCallback((reset = false) => {
    const source = gameplayBgmAudioRef.current
    if (source === null) {
      return
    }

    source.pause()
    if (reset) {
      source.currentTime = 0
    }
  }, [])

  const playGameplayBgm = useCallback(() => {
    if (!AUDIO_ENABLED || isAudioMutedRef.current) {
      return
    }

    const source = gameplayBgmAudioRef.current
    if (source === null) {
      return
    }

    if (!source.paused) {
      return
    }

    void source.play().catch(() => {})
  }, [])

  const stopSuperFeverBgm = useCallback(() => {
    const source = superFeverBgmAudioRef.current
    if (source === null) {
      return
    }

    source.pause()
    source.currentTime = 0
  }, [])

  const playSuperFeverBgm = useCallback(() => {
    if (!AUDIO_ENABLED || isAudioMutedRef.current) {
      return
    }

    const source = superFeverBgmAudioRef.current
    if (source === null) {
      return
    }

    source.currentTime = 0
    void source.play().catch(() => {})
  }, [])

  useEffect(() => {
    if (isAudioMuted) {
      stopGameplayBgm()
      stopSuperFeverBgm()
      return
    }

    if (!AUDIO_ENABLED || finishedRef.current) {
      return
    }

    if (superFeverActiveRef.current) {
      playSuperFeverBgm()
      return
    }

    playGameplayBgm()
  }, [isAudioMuted, playGameplayBgm, playSuperFeverBgm, stopGameplayBgm, stopSuperFeverBgm])

  const triggerTimeBoostFeedback = useCallback(
    (label: string) => {
      setTimeBoostText(label)
      setTimeBoostPulseId((previous) => previous + 1)

      clearTimeBoostTimer()
      timeBoostTimerRef.current = window.setTimeout(() => {
        setTimeBoostText(null)
        timeBoostTimerRef.current = null
      }, TIME_BOOST_POP_MS)
    },
    [clearTimeBoostTimer],
  )

  const triggerComboBurst = useCallback(
    (label: string) => {
      setComboBurstText(label)
      setComboBurstId((previous) => previous + 1)

      clearComboBurstTimer()
      comboBurstTimerRef.current = window.setTimeout(() => {
        setComboBurstText(null)
        comboBurstTimerRef.current = null
      }, effectPresetConfig.comboBurstDurationMs)
    },
    [clearComboBurstTimer, effectPresetConfig.comboBurstDurationMs],
  )

  const endSuperFever = useCallback(() => {
    if (!superFeverActiveRef.current) {
      return
    }

    superFeverActiveRef.current = false
    stopSuperFeverBgm()
    setSuperFeverActive(false)
    setSuperFeverRemainingMs(0)
    playGameplayBgm()
    lastTapAtRef.current = window.performance.now()
    playSfx(superFeverEndAudioRef.current)
    triggerComboBurst('SUPER FEVER END')

    const nextTriggerCombo = comboRef.current + SUPER_FEVER_REENTRY_COMBO_DELTA
    nextSuperFeverComboRef.current = nextTriggerCombo
    setNextSuperFeverCombo(nextTriggerCombo)

    setTarget(createTarget(targetIdRef.current, false))
    targetIdRef.current += 1
  }, [playGameplayBgm, playSfx, stopSuperFeverBgm, triggerComboBurst])

  const activateSuperFever = useCallback(() => {
    if (superFeverActiveRef.current) {
      return
    }

    superFeverActiveRef.current = true
    const endAt = window.performance.now() + SUPER_FEVER_DURATION_MS
    superFeverEndsAtRef.current = endAt

    setSuperFeverActive(true)
    setSuperFeverRemainingMs(SUPER_FEVER_DURATION_MS)
    triggerComboBurst('SUPER FEVER!')
    stopGameplayBgm()
    playSuperFeverBgm()
    playSfx(superFeverStartAudioRef.current)
  }, [playSfx, playSuperFeverBgm, stopGameplayBgm, triggerComboBurst])

  useEffect(() => {
    playGameplayBgm()

    return () => {
      stopGameplayBgm(true)
    }
  }, [playGameplayBgm, stopGameplayBgm])

  useEffect(() => {
    startedAtRef.current = window.performance.now()
    remainingMsRef.current = ROUND_DURATION_MS
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

      if (superFeverActiveRef.current) {
        const remainingSuperFeverMs = superFeverEndsAtRef.current - now
        if (remainingSuperFeverMs <= 0) {
          endSuperFever()
        } else {
          setSuperFeverRemainingMs(remainingSuperFeverMs)
        }
      } else {
        setTarget((current) => {
          const scoreFactor = clamp(tapsRef.current / TARGET_MOTION_SCORE_SOFT_CAP, 0, 1)
          const speedRamp = Math.pow(scoreFactor, 0.72)
          const chaosRamp = Math.pow(scoreFactor, 0.85)
          const chaosPerSecond = TARGET_MOTION_BASE_CHAOS + (TARGET_MOTION_MAX_CHAOS - TARGET_MOTION_BASE_CHAOS) * chaosRamp
          const deltaSeconds = deltaMs / 1000
          const jitter = chaosPerSecond * deltaSeconds * (1 + scoreFactor * 0.42)

          let nextVelocityX = current.velocityX + randomBetween(-jitter, jitter)
          let nextVelocityY = current.velocityY + randomBetween(-jitter, jitter)
          const speedCap = TARGET_MOTION_BASE_SPEED + (TARGET_MOTION_MAX_SPEED - TARGET_MOTION_BASE_SPEED) * speedRamp
          const velocityMagnitude = Math.hypot(nextVelocityX, nextVelocityY)
          if (velocityMagnitude > speedCap) {
            const clampRatio = speedCap / velocityMagnitude
            nextVelocityX *= clampRatio
            nextVelocityY *= clampRatio
          }

          let nextX = current.x + nextVelocityX * deltaSeconds
          let nextY = current.y + nextVelocityY * deltaSeconds

          if (nextX <= TARGET_SPAWN_X_MIN || nextX >= TARGET_SPAWN_X_MAX) {
            nextVelocityX *= -0.84
            nextX = clamp(nextX, TARGET_SPAWN_X_MIN, TARGET_SPAWN_X_MAX)
          }
          if (nextY <= TARGET_SPAWN_Y_MIN || nextY >= TARGET_SPAWN_Y_MAX) {
            nextVelocityY *= -0.84
            nextY = clamp(nextY, TARGET_SPAWN_Y_MIN, TARGET_SPAWN_Y_MAX)
          }

          const scaleJitter = randomBetween(-0.02, 0.02) * (0.16 + scoreFactor * 0.66)

          return {
            ...current,
            x: nextX,
            y: nextY,
            rotationDeg: 0,
            scale: clamp(current.scale + scaleJitter, 0.9, 1.16),
            velocityX: nextVelocityX,
            velocityY: nextVelocityY,
          }
        })

        if (comboRef.current > 0) {
          const elapsedSinceTap = now - lastTapAtRef.current
          if (elapsedSinceTap > COMBO_WINDOW_MS) {
            comboRef.current = 0
            setCurrentCombo(0)
          }
        }

        const nextRemainingMs = remainingMsRef.current - deltaMs
        if (nextRemainingMs <= 0) {
          remainingMsRef.current = 0
          setRemainingMs(0)
          stopGameplayBgm()
          if (!finishedRef.current) {
            finishedRef.current = true
            onFinish({
              score: tapsRef.current,
              durationMs: window.performance.now() - startedAtRef.current,
            })
          }
          animationFrameRef.current = null
          return
        }

        if (nextRemainingMs <= 5000) {
          const alertSecond = Math.ceil(nextRemainingMs / 1000)
          if (lastLowTimeAlertSecondRef.current !== alertSecond) {
            lastLowTimeAlertSecondRef.current = alertSecond
            playSfx(lowTimeAlertAudioRef.current)
          }
        } else {
          lastLowTimeAlertSecondRef.current = null
        }

        remainingMsRef.current = nextRemainingMs
        setRemainingMs(nextRemainingMs)
      }

      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      superFeverActiveRef.current = false
      lastFrameAtRef.current = null

      if (zoneHitTimerRef.current !== null) {
        window.clearTimeout(zoneHitTimerRef.current)
        zoneHitTimerRef.current = null
      }

      for (const timerId of cleanupTimerIdsRef.current) {
        window.clearTimeout(timerId)
      }
      cleanupTimerIdsRef.current = []

      clearHeartSpawnTimer()
      clearHeartExpireTimer()
      clearTimeBoostTimer()
      clearComboBurstTimer()
      lastLowTimeAlertSecondRef.current = null
      stopGameplayBgm(true)
      stopSuperFeverBgm()
    }
  }, [
    clearComboBurstTimer,
    clearHeartExpireTimer,
    clearHeartSpawnTimer,
    clearTimeBoostTimer,
    endSuperFever,
    onFinish,
    playSfx,
    stopGameplayBgm,
    stopSuperFeverBgm,
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onExit])

  const spawnQueuedHeart = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    if (heartRef.current !== null || heartSpawnTimerRef.current !== null) {
      return
    }

    if (pendingHeartSpawnCountRef.current <= 0) {
      return
    }

    pendingHeartSpawnCountRef.current -= 1
    const delayMs = randomBetween(HEART_SPAWN_DELAY_MIN_MS, HEART_SPAWN_DELAY_MAX_MS)

    heartSpawnTimerRef.current = window.setTimeout(() => {
      heartSpawnTimerRef.current = null
      if (finishedRef.current) {
        return
      }

      const nextHeart = createHeartPickup(heartIdRef.current)
      heartIdRef.current += 1

      heartRef.current = nextHeart
      setHeartPickup(nextHeart)

      clearHeartExpireTimer()
      heartExpireTimerRef.current = window.setTimeout(() => {
        heartExpireTimerRef.current = null
        heartRef.current = null
        setHeartPickup(null)
        heartSpawnFnRef.current()
      }, HEART_VISIBLE_MS)
    }, delayMs)
  }, [clearHeartExpireTimer])

  useEffect(() => {
    heartSpawnFnRef.current = spawnQueuedHeart
  }, [spawnQueuedHeart])

  const createImpact = useCallback((x: number, y: number, intensity = 0) => {
    const id = impactIdRef.current
    impactIdRef.current += 1
    const normalizedIntensity = clamp(intensity, 0, 1)

    const hueRotateDeg = ((id * 17) % 28) - 14
    const waveScale = 0.9 + ((id * 13) % 6) * 0.06 + normalizedIntensity * 0.55
    const sparkRotationDeg = ((id * 71) % 360) - 180
    const sparkTravelPx = 34 + ((id * 19) % 4) * 8 + normalizedIntensity * 24
    const scoreDriftBase = ((id * 29) % 19) - 9
    const scoreDriftX = scoreDriftBase * (1 + normalizedIntensity * 0.36)

    setImpacts((prev) => [
      ...prev,
      { id, x, y, hueRotateDeg, waveScale, sparkRotationDeg, sparkTravelPx, scoreDriftX },
    ])

    const cleanupTimerId = window.setTimeout(() => {
      setImpacts((prev) => prev.filter((impact) => impact.id !== id))
      cleanupTimerIdsRef.current = cleanupTimerIdsRef.current.filter((savedId) => savedId !== cleanupTimerId)
    }, IMPACT_LIFETIME_MS)

    cleanupTimerIdsRef.current.push(cleanupTimerId)
  }, [])

  const activateZoneHit = useCallback(() => {
    setZoneHitActive(true)

    if (zoneHitTimerRef.current !== null) {
      window.clearTimeout(zoneHitTimerRef.current)
    }

    zoneHitTimerRef.current = window.setTimeout(() => {
      setZoneHitActive(false)
      zoneHitTimerRef.current = null
    }, effectPresetConfig.zoneHitDurationMs)
  }, [effectPresetConfig.zoneHitDurationMs])

  const addHeartSpawnBudgetByScore = useCallback((score: number) => {
    while (score >= nextHeartScoreRef.current) {
      pendingHeartSpawnCountRef.current += 1
      nextHeartScoreRef.current += HEART_SCORE_STEP
    }
  }, [])

  const handleTargetPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (remainingMs === 0 || finishedRef.current) {
      return
    }

    playGameplayBgm()

    event.preventDefault()
    event.stopPropagation()

    const zoneRect = zoneRef.current?.getBoundingClientRect()
    if (!zoneRect) {
      return
    }

    const x = clamp(((event.clientX - zoneRect.left) / zoneRect.width) * 100, 0, 100)
    const y = clamp(((event.clientY - zoneRect.top) / zoneRect.height) * 100, 0, 100)

    const now = window.performance.now()
    const elapsedSinceTap = now - lastTapAtRef.current
    const nextCombo = elapsedSinceTap <= COMBO_WINDOW_MS ? comboRef.current + 1 : 1
    comboRef.current = nextCombo
    lastTapAtRef.current = now
    setCurrentCombo(nextCombo)

    if (!superFeverActiveRef.current && nextCombo >= nextSuperFeverComboRef.current) {
      activateSuperFever()
    }

    if (nextCombo > 1 && nextCombo % COMBO_MILESTONE_INTERVAL === 0) {
      triggerComboBurst(`COMBO ${nextCombo}!`)
      playSfx(comboMilestoneAudioRef.current)
    }

    tapsRef.current += 1
    setCurrentScore(tapsRef.current)
    addHeartSpawnBudgetByScore(tapsRef.current)

    const impactIntensity = clamp((nextCombo / 120) * effectPresetConfig.impactScale, 0, 1)
    createImpact(x, y, impactIntensity)
    activateZoneHit()
    const tapPitchWindow = getTapPitchWindow(nextCombo)
    playSfx(tapHitStrongAudioRef.current, {
      volumeScale: effectPresetConfig.tapStrongVolumeScale,
      playbackRateMin: tapPitchWindow.strongMin,
      playbackRateMax: tapPitchWindow.strongMax,
    })
    playSfx(tapHitAudioRef.current, {
      volumeScale: effectPresetConfig.tapLayerVolumeScale,
      playbackRateMin: tapPitchWindow.layerMin,
      playbackRateMax: tapPitchWindow.layerMax,
    })

    if (!superFeverActiveRef.current && nextCombo >= FEVER_COMBO_THRESHOLD) {
      const nextRemainingMs = remainingMsRef.current + FEVER_TIME_BONUS_MS
      remainingMsRef.current = nextRemainingMs
      setRemainingMs(nextRemainingMs)
      triggerTimeBoostFeedback(`TIME +${(FEVER_TIME_BONUS_MS / 1000).toFixed(1)}s`)
      playSfx(feverBoostAudioRef.current)
    }

    setTarget(createTarget(targetIdRef.current, superFeverActiveRef.current))
    targetIdRef.current += 1

    heartSpawnFnRef.current()
  }

  const handleHeartPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (heartPickup === null || remainingMs === 0 || finishedRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const zoneRect = zoneRef.current?.getBoundingClientRect()
    if (zoneRect) {
      const x = clamp(((event.clientX - zoneRect.left) / zoneRect.width) * 100, 0, 100)
      const y = clamp(((event.clientY - zoneRect.top) / zoneRect.height) * 100, 0, 100)
      createImpact(x, y, clamp(0.72 * effectPresetConfig.impactScale, 0, 1))
    }

    clearHeartExpireTimer()
    heartRef.current = null
    setHeartPickup(null)
    const nextRemainingMs = remainingMsRef.current + HEART_BONUS_MS
    remainingMsRef.current = nextRemainingMs
    setRemainingMs(nextRemainingMs)
    triggerTimeBoostFeedback(`TIME +${(HEART_BONUS_MS / 1000).toFixed(1)}s`)
    playSfx(heartBonusAudioRef.current)
    heartSpawnFnRef.current()
  }

  const remainingSeconds = Math.max(0, remainingMs / 1000)
  const remainingSecondsText = remainingSeconds.toFixed(1)
  const superFeverRemainingSecondsText = Math.max(0, superFeverRemainingMs / 1000).toFixed(1)

  const superComboGaugeFloor =
    nextSuperFeverCombo <= SUPER_FEVER_INITIAL_TRIGGER_COMBO
      ? 0
      : nextSuperFeverCombo - SUPER_FEVER_REENTRY_COMBO_DELTA
  const superComboGaugeWindow =
    nextSuperFeverCombo <= SUPER_FEVER_INITIAL_TRIGGER_COMBO
      ? SUPER_FEVER_INITIAL_TRIGGER_COMBO
      : SUPER_FEVER_REENTRY_COMBO_DELTA
  const superComboGaugeProgress = clamp((currentCombo - superComboGaugeFloor) / superComboGaugeWindow, 0, 1)
  const superComboGaugePercent = superComboGaugeProgress * 100
  const superFeverGaugePercent = useMemo(
    () => clamp((superFeverRemainingMs / SUPER_FEVER_DURATION_MS) * 100, 0, 100),
    [superFeverRemainingMs],
  )
  const timeGaugePercent = isSuperFeverActive ? superFeverGaugePercent : superComboGaugePercent
  const timeGaugeAriaMax = isSuperFeverActive ? SUPER_FEVER_DURATION_MS : superComboGaugeWindow
  const timeGaugeAriaNow = isSuperFeverActive
    ? Math.max(0, Math.round(superFeverRemainingMs))
    : Math.round(clamp(currentCombo - superComboGaugeFloor, 0, superComboGaugeWindow))
  const timeGaugeLabel = isSuperFeverActive
    ? `SUPER TIMER ${superFeverRemainingSecondsText}s`
    : `SUPER CHARGE ${Math.round(superComboGaugePercent)}%`

  const isFeverActive = currentCombo >= FEVER_COMBO_THRESHOLD
  const remainingComboForNextSuper = Math.max(0, nextSuperFeverCombo - currentCombo)
  const displayedBestScore = Math.max(bestScore, currentScore)

  return (
    <section className="mini-game-panel tap-dash-panel" aria-label="tap-dash-game">
      <div
        className={`tap-touch-zone effects-${effectPresetId} ${isZoneHitActive ? 'hit' : ''} ${isFeverActive ? 'fever' : ''} ${isSuperFeverActive ? 'super-fever' : ''}`}
        ref={zoneRef}
        aria-label="tap-touch-zone"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="tap-dash-score-overlay" aria-live="polite">
          <p key={`score-${currentScore}`} className="tap-dash-current-score tap-dash-current-score-pop">
            {currentScore}
          </p>
          <p className="tap-dash-best-score">BEST {displayedBestScore}</p>
        </div>
        <div className={`tap-dash-time-overlay ${timeBoostText ? 'boost' : ''}`} aria-live="polite">
          <p className="tap-dash-time-label">{remainingSecondsText}s</p>
          <p className="tap-dash-gauge-label">{timeGaugeLabel}</p>
          <div
            className="tap-dash-time-gauge"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={timeGaugeAriaMax}
            aria-valuenow={timeGaugeAriaNow}
          >
            <span
              className={`tap-dash-time-fill ${isSuperFeverActive ? 'super' : 'charge'} ${timeBoostText ? 'boost' : ''}`}
              style={{ width: `${timeGaugePercent}%` }}
            />
          </div>
        </div>

        {timeBoostText ? (
          <p key={timeBoostPulseId} className={`tap-dash-time-boost-pop ${isSuperFeverActive ? 'super' : ''}`} aria-live="polite">
            {timeBoostText}
          </p>
        ) : null}

        {comboBurstText ? (
          <div key={comboBurstId} className={`tap-dash-combo-burst ${isSuperFeverActive ? 'super' : ''}`} aria-live="polite">
            <p>{comboBurstText}</p>
          </div>
        ) : null}

        {currentCombo > 1 ? (
          <div className={`tap-dash-combo-overlay ${isFeverActive ? 'fever' : ''} ${isSuperFeverActive ? 'super' : ''}`} aria-live="polite">
            <p key={`combo-${currentCombo}`} className="tap-dash-combo-label">
              <span className="tap-dash-combo-tag">COMBO</span>
              <strong className="tap-dash-combo-value">x{currentCombo}</strong>
            </p>
            {isFeverActive && !isSuperFeverActive ? <p className="tap-dash-fever-label">FEVER TIME +0.1s</p> : null}
            {isSuperFeverActive ? (
              <p className="tap-dash-fever-label lock">TIME FREEZE {superFeverRemainingSecondsText}s</p>
            ) : (
              <p className="tap-dash-super-next-label">NEXT SUPER +{remainingComboForNextSuper}</p>
            )}
          </div>
        ) : null}

        {isSuperFeverActive ? (
          <div className="tap-dash-super-fever-overlay" aria-live="polite">
            <p className="tap-dash-super-fever-title">SUPER FEVER MODE</p>
            <p className="tap-dash-super-fever-subtitle">중앙 고정 + 시간 정지 {superFeverRemainingSecondsText}s</p>
          </div>
        ) : null}

        {isSuperFeverActive ? (
          <div className="tap-dash-fever-timer-overlay" aria-live="polite">
            <p className="tap-dash-fever-timer-label">SUPER FEVER TIMER</p>
            <p className="tap-dash-fever-timer-value">{superFeverRemainingSecondsText}s</p>
            <div className="tap-dash-fever-timer-gauge" role="presentation">
              <span className="tap-dash-fever-timer-fill" style={{ width: `${superFeverGaugePercent}%` }} />
            </div>
          </div>
        ) : null}

        <button
          key={target.id}
          className="tap-target-button"
          type="button"
          onPointerDown={handleTargetPointerDown}
          onContextMenu={(event) => event.preventDefault()}
          style={
            {
              left: `${target.x}%`,
              top: `${target.y}%`,
              '--tap-target-rotate': `${target.rotationDeg}deg`,
              '--tap-target-scale': `${target.scale}`,
            } as CSSProperties
          }
          aria-label="tap-target-character"
        >
          <span className="tap-target-stack">
            <img
              className="tap-target-character"
              src={target.characterImage}
              loading="eager"
              decoding="sync"
              alt=""
              aria-hidden
            />
          </span>
        </button>

        {heartPickup ? (
          <button
            className="tap-bonus-heart-button"
            type="button"
            onPointerDown={handleHeartPointerDown}
            onContextMenu={(event) => event.preventDefault()}
            style={
              {
                left: `${heartPickup.x}%`,
                top: `${heartPickup.y}%`,
                '--tap-heart-rotate': `${heartPickup.rotationDeg}deg`,
                '--tap-heart-scale': `${heartPickup.scale}`,
              } as CSSProperties
            }
            aria-label="time-bonus-heart"
          >
            <img className="tap-bonus-heart-image" src={heartBonusSprite} alt="" aria-hidden />
          </button>
        ) : null}

        {impacts.map((impact) => (
          <span
            className="tap-impact"
            key={impact.id}
            style={
              {
                left: `${impact.x}%`,
                top: `${impact.y}%`,
                '--impact-hue-rotate': `${impact.hueRotateDeg}deg`,
                '--impact-wave-scale': `${impact.waveScale}`,
                '--impact-spark-rotate': `${impact.sparkRotationDeg}deg`,
                '--impact-spark-travel': `${impact.sparkTravelPx}px`,
                '--impact-score-drift-x': `${impact.scoreDriftX}px`,
              } as CSSProperties
            }
          >
            <span className="tap-impact-core" aria-hidden />
            <span className="tap-impact-wave primary" aria-hidden />
            <span className="tap-impact-wave secondary" aria-hidden />
            {IMPACT_SPARK_ANGLES.map((angle) => (
              <span
                key={`${impact.id}-${angle}`}
                className="tap-impact-spark"
                style={{ '--impact-spark-angle': `${angle}deg` } as CSSProperties}
                aria-hidden
              />
            ))}
            <span className="tap-impact-score">+1</span>
          </span>
        ))}
      </div>
    </section>
  )
}

export const tapDashModule: MiniGameModule = {
  manifest: {
    id: 'tap-dash',
    title: 'Tap Dash',
    description: 'Tap characters appearing at random targets to score in 30 seconds!',
    unlockCost: 0,
    baseReward: 8,
    scoreRewardMultiplier: 1.2,
    accentColor: '#ff8a00',
  },
  Component: TapDashGame,
}
