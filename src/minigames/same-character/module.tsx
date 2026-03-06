import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { AUDIO_ENABLED } from '../../primitives/constants'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import songChangsikImage from '../../../Pixel Image/송창식.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import kimYeonjaImage from '../../../Pixel Image/Sq/김연자 Sq/김연자_00000.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import iconParkSangminImage from '../../../Pixel Image/Icon 박상민.png'
import iconSongChangsikImage from '../../../Pixel Image/Icon 송창식.png'
import iconTaeJinaImage from '../../../Pixel Image/Icon 태진아.png'
import iconParkWankyuImage from '../../../Pixel Image/Icon 박완규.png'
import iconKimYeonjaImage from '../../../Pixel Image/Icon 김연자.png'
import iconSeoTaijiImage from '../../../Pixel Image/Icon 서태지.png'
import sameCharacterBack04Image from '../../../assets/images/same-character/back-04.png'
import correctHitEffectImage from '../../../assets/images/same-character/effect.png'
import correctHitSfx from '../../../assets/sounds/same-character-correct-pop.wav'
import stackMissSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import comboMilestoneSfx from '../../../assets/sounds/combo-milestone.mp3'
import sameCharacterBgmLoop from '../../../assets/sounds/lobby-bgm-loop.mp3'
import leftKeyImage from '../../../Pixel Image/Left Key.png'
import rightKeyImage from '../../../Pixel Image/Right Key.png'
import homeButtonImage from '../../../Pixel Image/Home Btn.png'
import pauseButtonImage from '../../../Pixel Image/Pause Btn.png'
import playButtonImage from '../../../Pixel Image/Play Btn.png'
import scoreBoardImage from '../../../Pixel Image/Score Board.png'

const CENTER_STACK_SIZE = 12
const GAME_DURATION_MS = 40000
const STAR_GAIN_ON_MATCH = 24
const STAR_LOSS_ON_MISS = 32
const FEVER_DURATION_MS = 6000
const MISS_TIME_PENALTY_MS = 500
const UPDATE_TICK_MS = 80
const MAX_TICK_DELTA_MS = 200
const REMAINING_TIME_BONUS_PER_SECOND = 10
const MISS_FEEDBACK_DURATION_MS = 650
const COMBO_SCORE_FEEDBACK_DURATION_MS = 650
const SHORT_STACK_RUN_MIN_LENGTH = 1
const SHORT_STACK_RUN_MAX_LENGTH = 4
const LONG_STACK_RUN_MIN_LENGTH = 5
const LONG_STACK_RUN_MAX_LENGTH = 7
const LONG_STACK_RUN_CHANCE = 0.35
const CORRECT_POP_DURATION_MS = 100
const CORRECT_SHAKE_DURATION_MS = 100
const CENTER_SEQUENCE_FPS = 30
const CENTER_SEQUENCE_FRAME_MS = 1000 / CENTER_SEQUENCE_FPS

const SQ_SEQUENCE_SOURCES = import.meta.glob<string>(
  '../../../Pixel Image/Sq/김연자 Sq/*.png',
  { eager: true, import: 'default' },
)

const KIM_YEONJA_SEQUENCE_FRAMES = getSequenceFrames('김연자', kimYeonjaImage)
const SONG_CHANGSIK_SEQUENCE_FRAMES = getSequenceFrames('송창식', songChangsikImage)
const PARK_WANKYU_SEQUENCE_FRAMES = getSequenceFrames('박완규', parkWankyuImage)
const TAE_JINA_SEQUENCE_FRAMES = getSequenceFrames('태진아', taeJinaImage)
const PARK_SANGMIN_SEQUENCE_FRAMES = getSequenceFrames('박상민', parkSangminImage)
const SEO_TAIJI_SEQUENCE_FRAMES = getSequenceFrames('서태지', seoTaijiImage)

const CHARACTER_POOL = [
  { id: 'park-sangmin', name: 'Park Sangmin', imageSrc: parkSangminImage, sideImageSrc: iconParkSangminImage, speechText: 'Gaseum soge chaoreuneun geudaeyeo' },
  { id: 'song-changsik', name: 'Song Changsik', imageSrc: songChangsikImage, sideImageSrc: iconSongChangsikImage, speechText: 'Ga Na Da Ra Ma Ba Sa' },
  { id: 'tae-jina', name: 'Tae Jina', imageSrc: taeJinaImage, sideImageSrc: iconTaeJinaImage, speechText: 'Sarang-eun amuna hana' },
  { id: 'park-wankyu', name: 'Park Wankyu', imageSrc: parkWankyuImage, sideImageSrc: iconParkWankyuImage, speechText: 'Cheonnyeoni gado' },
  { id: 'kim-yeonja', name: 'Kim Yeonja', imageSrc: kimYeonjaImage, sideImageSrc: iconKimYeonjaImage, speechText: 'Amor Party' },
  { id: 'seo-taiji', name: 'Seo Taiji', imageSrc: seoTaijiImage, sideImageSrc: iconSeoTaijiImage, speechText: 'Nan arayo' },
] as const

type SelectedSide = 'left' | 'right'
type CharacterDefinition = (typeof CHARACTER_POOL)[number]
type CenterCharacterToken = CharacterDefinition & { tokenKey: string }
type StackRunState = {
  currentCharacterId: CharacterDefinition['id'] | null
  remainingCount: number
}

const CHARACTER_BY_ID = new Map<CharacterDefinition['id'], CharacterDefinition>(
  CHARACTER_POOL.map((character) => [character.id, character]),
)

function getSequenceFrames(prefix: string, fallbackFrame: string): string[] {
  const frames = Object.entries(SQ_SEQUENCE_SOURCES)
    .filter(([path]) => getSequencePrefix(path) === prefix)
    .sort(([pathA], [pathB]) => getSequenceOrder(pathA) - getSequenceOrder(pathB))
    .map(([, source]) => source)

  return frames.length > 0 ? frames : [fallbackFrame]
}

function getSequencePrefix(path: string): string {
  const matched = path.match(/\/([^/]+)_\d+\.png$/)
  if (matched === null) {
    return ''
  }

  return matched[1]
}

function getSequenceOrder(path: string): number {
  const matched = path.match(/_(\d+)\.png$/)
  if (matched === null) {
    return Number.MAX_SAFE_INTEGER
  }

  return Number(matched[1])
}

function randomCharacter(fromPool: readonly CharacterDefinition[] = CHARACTER_POOL): CharacterDefinition {
  const index = Math.floor(Math.random() * fromPool.length)
  return fromPool[index]
}

function getCharacterById(id: CharacterDefinition['id']): CharacterDefinition {
  const character = CHARACTER_BY_ID.get(id)
  if (character === undefined) {
    throw new Error(`Unknown character id: ${id}`)
  }

  return character
}

function randomBetweenInclusive(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function randomStackRunLength(): number {
  const useLongRun = Math.random() < LONG_STACK_RUN_CHANCE
  if (useLongRun) {
    return randomBetweenInclusive(LONG_STACK_RUN_MIN_LENGTH, LONG_STACK_RUN_MAX_LENGTH)
  }

  return randomBetweenInclusive(SHORT_STACK_RUN_MIN_LENGTH, SHORT_STACK_RUN_MAX_LENGTH)
}

function createStackRunState(): StackRunState {
  return {
    currentCharacterId: null,
    remainingCount: 0,
  }
}

function pickNextRunCharacter(previousCharacterId: CharacterDefinition['id'] | null): CharacterDefinition {
  if (previousCharacterId === null) {
    return randomCharacter()
  }

  const candidatePool = CHARACTER_POOL.filter((character) => character.id !== previousCharacterId)
  return randomCharacter(candidatePool.length > 0 ? candidatePool : CHARACTER_POOL)
}

let centerTokenSeed = 0

function createCenterTokenFromCharacter(character: CharacterDefinition): CenterCharacterToken {
  centerTokenSeed += 1
  return {
    ...character,
    tokenKey: `center-${centerTokenSeed}`,
  }
}

function takeStackRunCharacter(runState: StackRunState): CharacterDefinition {
  if (runState.currentCharacterId === null || runState.remainingCount <= 0) {
    const nextCharacter = pickNextRunCharacter(runState.currentCharacterId)
    runState.currentCharacterId = nextCharacter.id
    runState.remainingCount = randomStackRunLength()
  }

  if (runState.currentCharacterId === null) {
    throw new Error('Stack run state is not initialized')
  }

  const character = getCharacterById(runState.currentCharacterId)
  runState.remainingCount -= 1
  return character
}

function createQueue(size: number, runState: StackRunState): CenterCharacterToken[] {
  if (size <= 0) {
    return []
  }

  const queue: CenterCharacterToken[] = []
  for (let index = 0; index < size; index += 1) {
    queue.push(createCenterTokenFromCharacter(takeStackRunCharacter(runState)))
  }

  return queue
}

function pushRandom(queue: CenterCharacterToken[], runState: StackRunState): CenterCharacterToken[] {
  return [...queue.slice(1), createCenterTokenFromCharacter(takeStackRunCharacter(runState))]
}

function createFixedSideBoard(): {
  readonly leftQueue: CharacterDefinition[]
  readonly rightQueue: CharacterDefinition[]
  readonly sideByCharacterId: Record<CharacterDefinition['id'], SelectedSide>
} {
  const midpoint = Math.floor(CHARACTER_POOL.length / 2)
  const leftQueue = [...CHARACTER_POOL.slice(0, midpoint)]
  const rightQueue = [...CHARACTER_POOL.slice(midpoint)]

  const sideByCharacterId = {} as Record<CharacterDefinition['id'], SelectedSide>
  for (const character of leftQueue) {
    sideByCharacterId[character.id] = 'left'
  }
  for (const character of rightQueue) {
    sideByCharacterId[character.id] = 'right'
  }

  return {
    leftQueue,
    rightQueue,
    sideByCharacterId,
  }
}

function SameCharacterGame({ onFinish, onExit, isAudioMuted = false }: MiniGameSessionProps) {
  const initialBoard = useMemo<{
    readonly centerQueue: CenterCharacterToken[]
    readonly leftQueue: CharacterDefinition[]
    readonly rightQueue: CharacterDefinition[]
    readonly sideByCharacterId: Record<CharacterDefinition['id'], SelectedSide>
    readonly runState: StackRunState
  }>(() => {
    const runState = createStackRunState()
    const seededCenterQueue = createQueue(CENTER_STACK_SIZE, runState)
    const seededSideBoard = createFixedSideBoard()
    return {
      centerQueue: seededCenterQueue,
      leftQueue: seededSideBoard.leftQueue,
      rightQueue: seededSideBoard.rightQueue,
      sideByCharacterId: seededSideBoard.sideByCharacterId,
      runState,
    }
  }, [])

  const [centerQueue, setCenterQueue] = useState<CenterCharacterToken[]>(initialBoard.centerQueue)
  const [remainingMs, setRemainingMs] = useState(GAME_DURATION_MS)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [bestCombo, setBestCombo] = useState(0)
  const [starGauge, setStarGauge] = useState(0)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [burstText, setBurstText] = useState<string | null>(null)
  const [missFeedbackMs, setMissFeedbackMs] = useState(0)
  const [comboScoreFeedbackMs, setComboScoreFeedbackMs] = useState(0)
  const [comboScoreText, setComboScoreText] = useState<string | null>(null)
  const [comboScorePulseKey, setComboScorePulseKey] = useState(0)
  const [correctPopMs, setCorrectPopMs] = useState(0)
  const [correctShakeMs, setCorrectShakeMs] = useState(0)
  const [correctEffectSide, setCorrectEffectSide] = useState<SelectedSide | null>(null)
  const [correctEffectCharacterId, setCorrectEffectCharacterId] = useState<CharacterDefinition['id'] | null>(null)
  const [correctEffectPulseKey, setCorrectEffectPulseKey] = useState(0)
  const [sequenceFrameIndex, setSequenceFrameIndex] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  const centerQueueRef = useRef<CenterCharacterToken[]>(centerQueue)
  const remainingMsRef = useRef(remainingMs)
  const scoreRef = useRef(score)
  const comboRef = useRef(combo)
  const bestComboRef = useRef(bestCombo)
  const starGaugeRef = useRef(starGauge)
  const feverRemainingMsRef = useRef(feverRemainingMs)
  const missFeedbackMsRef = useRef(missFeedbackMs)
  const comboScoreFeedbackMsRef = useRef(comboScoreFeedbackMs)
  const correctPopMsRef = useRef(correctPopMs)
  const correctShakeMsRef = useRef(correctShakeMs)
  const burstMsRef = useRef(0)
  const finishedRef = useRef(false)
  const isPausedRef = useRef(isPaused)
  const pausedAtRef = useRef<number | null>(null)
  const pausedAccumulatedMsRef = useRef(0)
  const startedAtRef = useRef(0)
  const lastTickAtRef = useRef<number | null>(null)
  const correctHitSfxAudioRef = useRef<HTMLAudioElement | null>(null)
  const stackMissSfxAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongSfxAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboMilestoneSfxAudioRef = useRef<HTMLAudioElement | null>(null)
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const stackRunStateRef = useRef<StackRunState>(initialBoard.runState)
  const sideByCharacterId = initialBoard.sideByCharacterId
  const leftQueue = initialBoard.leftQueue
  const rightQueue = initialBoard.rightQueue
  const isFrontKimYeonja = centerQueue[0]?.id === 'kim-yeonja'
  const isFrontSongChangsik = centerQueue[0]?.id === 'song-changsik'
  const isFrontParkWankyu = centerQueue[0]?.id === 'park-wankyu'
  const isFrontTaeJina = centerQueue[0]?.id === 'tae-jina'
  const isFrontParkSangmin = centerQueue[0]?.id === 'park-sangmin'
  const isFrontSeoTaiji = centerQueue[0]?.id === 'seo-taiji'
  const activeFrontSequenceFrames = useMemo(() => {
    if (isFrontKimYeonja) {
      return KIM_YEONJA_SEQUENCE_FRAMES
    }

    if (isFrontSongChangsik) {
      return SONG_CHANGSIK_SEQUENCE_FRAMES
    }

    if (isFrontParkWankyu) {
      return PARK_WANKYU_SEQUENCE_FRAMES
    }

    if (isFrontTaeJina) {
      return TAE_JINA_SEQUENCE_FRAMES
    }

    if (isFrontParkSangmin) {
      return PARK_SANGMIN_SEQUENCE_FRAMES
    }

    if (isFrontSeoTaiji) {
      return SEO_TAIJI_SEQUENCE_FRAMES
    }

    return null
  }, [isFrontKimYeonja, isFrontSongChangsik, isFrontParkWankyu, isFrontTaeJina, isFrontParkSangmin, isFrontSeoTaiji])

  useEffect(() => {
    isPausedRef.current = isPaused
  }, [isPaused])

  useEffect(() => {
    if (!AUDIO_ENABLED) {
      return
    }

    const correctAudio = new Audio(correctHitSfx)
    correctAudio.preload = 'auto'
    correctAudio.volume = 0.86
    correctHitSfxAudioRef.current = correctAudio

    const missAudio = new Audio(stackMissSfx)
    missAudio.preload = 'auto'
    missAudio.volume = 0.62
    stackMissSfxAudioRef.current = missAudio

    const strongHitAudio = new Audio(tapHitStrongSfx)
    strongHitAudio.preload = 'auto'
    strongHitAudio.volume = 0.82
    tapHitStrongSfxAudioRef.current = strongHitAudio

    const comboAudio = new Audio(comboMilestoneSfx)
    comboAudio.preload = 'auto'
    comboAudio.volume = 0.76
    comboMilestoneSfxAudioRef.current = comboAudio

    const bgmAudio = new Audio(sameCharacterBgmLoop)
    bgmAudio.loop = true
    bgmAudio.preload = 'auto'
    bgmAudio.volume = 0.2
    bgmAudioRef.current = bgmAudio

    return () => {
      const bgm = bgmAudioRef.current
      if (bgm !== null) {
        bgm.pause()
        bgm.currentTime = 0
      }
      bgmAudioRef.current = null
      correctHitSfxAudioRef.current = null
      stackMissSfxAudioRef.current = null
      tapHitStrongSfxAudioRef.current = null
      comboMilestoneSfxAudioRef.current = null
    }
  }, [])

  const playSfx = useCallback(
    (source: HTMLAudioElement | null, playbackRate = 1, volumeBoost = 1) => {
      if (!AUDIO_ENABLED || isAudioMuted || source === null) {
        return
      }

      const instance = source.cloneNode(true) as HTMLAudioElement
      instance.volume = Math.min(1, source.volume * volumeBoost)
      instance.playbackRate = playbackRate
      void instance.play().catch(() => {})
    },
    [isAudioMuted],
  )

  const playCorrectHitSfx = useCallback((comboValue: number) => {
    if (!AUDIO_ENABLED || isAudioMuted) {
      return
    }

    const source = correctHitSfxAudioRef.current
    const pitchBoost = Math.min(1.34, 1 + comboValue * 0.02)
    playSfx(source, pitchBoost, 1.2)
    playSfx(tapHitStrongSfxAudioRef.current, Math.min(1.2, 0.98 + comboValue * 0.01), 1.1)

    if (comboValue >= 4) {
      window.setTimeout(() => {
        playSfx(tapHitStrongSfxAudioRef.current, 1.08, 0.92)
      }, 34)
    }
  }, [isAudioMuted, playSfx])

  const playMissSfx = useCallback(() => {
    playSfx(stackMissSfxAudioRef.current, 0.9, 1.06)
  }, [playSfx])

  const playComboMilestoneSfx = useCallback(() => {
    playSfx(comboMilestoneSfxAudioRef.current, 1.04, 1.18)
    playSfx(tapHitStrongSfxAudioRef.current, 0.92, 0.94)
  }, [playSfx])

  const stopBgm = useCallback(() => {
    const bgm = bgmAudioRef.current
    if (bgm === null) {
      return
    }

    bgm.pause()
    bgm.currentTime = 0
  }, [])

  useEffect(() => {
    if (!AUDIO_ENABLED) {
      return
    }

    const bgm = bgmAudioRef.current
    if (bgm === null) {
      return
    }

    if (isAudioMuted || isPaused) {
      bgm.pause()
      return
    }

    void bgm.play().catch(() => {})
  }, [isAudioMuted, isPaused])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    stopBgm()
    finishedRef.current = true
    const now = window.performance.now()
    const activePauseDuration =
      pausedAtRef.current === null ? 0 : Math.max(0, now - pausedAtRef.current)
    const elapsedMs = Math.max(
      UPDATE_TICK_MS,
      Math.round(now - startedAtRef.current - pausedAccumulatedMsRef.current - activePauseDuration),
    )
    const comboBonus = bestComboRef.current * 5
    const remainingSeconds = Math.floor(remainingMsRef.current / 1000)
    const remainingTimeBonus = Math.max(0, remainingSeconds) * REMAINING_TIME_BONUS_PER_SECOND

    onFinish({
      score: scoreRef.current + comboBonus + remainingTimeBonus,
      durationMs: elapsedMs,
    })
  }, [onFinish, stopBgm])

  const pauseGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    if (isPausedRef.current) {
      return
    }

    pausedAtRef.current = window.performance.now()
    setIsPaused(true)
  }, [])

  const resumeGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    if (!isPausedRef.current) {
      return
    }

    const now = window.performance.now()
    if (pausedAtRef.current !== null) {
      pausedAccumulatedMsRef.current += Math.max(0, now - pausedAtRef.current)
      pausedAtRef.current = null
    }
    lastTickAtRef.current = now
    setIsPaused(false)
  }, [])

  const resolveTurn = useCallback((selected: SelectedSide) => {
    if (finishedRef.current || isPausedRef.current) {
      return
    }

    const target = centerQueueRef.current[0]
    const expectedSide = sideByCharacterId[target.id]
    const isMatch = selected === expectedSide

    if (isMatch) {
      const nextCombo = comboRef.current + 1
      const nextBestCombo = Math.max(bestComboRef.current, nextCombo)
      const scoreBase = feverRemainingMsRef.current > 0 ? 30 : 18
      const gainedScore = scoreBase + nextCombo * 6
      const nextScore = scoreRef.current + gainedScore

      comboRef.current = nextCombo
      bestComboRef.current = nextBestCombo
      scoreRef.current = nextScore
      setCombo(nextCombo)
      setBestCombo(nextBestCombo)
      setScore(nextScore)

      correctPopMsRef.current = CORRECT_POP_DURATION_MS
      setCorrectPopMs(CORRECT_POP_DURATION_MS)
      correctShakeMsRef.current = CORRECT_SHAKE_DURATION_MS
      setCorrectShakeMs(CORRECT_SHAKE_DURATION_MS)
      setCorrectEffectSide(selected)
      setCorrectEffectCharacterId(target.id)
      setCorrectEffectPulseKey((previous) => previous + 1)
      playCorrectHitSfx(nextCombo)

      if (nextCombo >= 2) {
        comboScoreFeedbackMsRef.current = COMBO_SCORE_FEEDBACK_DURATION_MS
        setComboScoreFeedbackMs(COMBO_SCORE_FEEDBACK_DURATION_MS)
        setComboScoreText(`COMBO +${gainedScore}`)
        setComboScorePulseKey((previous) => previous + 1)
        playComboMilestoneSfx()
      }

      let nextStarGauge = starGaugeRef.current + STAR_GAIN_ON_MATCH
      if (nextStarGauge >= 100) {
        nextStarGauge -= 100
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setFeverRemainingMs(FEVER_DURATION_MS)
        burstMsRef.current = 900
        setBurstText('Nice!')
      } else if (nextCombo >= 3) {
        burstMsRef.current = 700
        setBurstText('Nice!')
      }

      starGaugeRef.current = nextStarGauge
      setStarGauge(nextStarGauge)

      const nextCenter = pushRandom(centerQueueRef.current, stackRunStateRef.current)
      centerQueueRef.current = nextCenter
      setCenterQueue(nextCenter)
    } else {
      comboRef.current = 0
      setCombo(0)

      const nextStarGauge = Math.max(0, starGaugeRef.current - STAR_LOSS_ON_MISS)
      starGaugeRef.current = nextStarGauge
      setStarGauge(nextStarGauge)

      const nextRemainingMs = Math.max(0, remainingMsRef.current - MISS_TIME_PENALTY_MS)
      remainingMsRef.current = nextRemainingMs
      setRemainingMs(nextRemainingMs)

      missFeedbackMsRef.current = MISS_FEEDBACK_DURATION_MS
      setMissFeedbackMs(MISS_FEEDBACK_DURATION_MS)
      comboScoreFeedbackMsRef.current = 0
      setComboScoreFeedbackMs(0)
      setComboScoreText(null)
      playMissSfx()
    }
  }, [playComboMilestoneSfx, playCorrectHitSfx, playMissSfx, sideByCharacterId])

  useEffect(() => {
    startedAtRef.current = window.performance.now()
    lastTickAtRef.current = startedAtRef.current

    const timer = window.setInterval(() => {
      if (finishedRef.current) {
        window.clearInterval(timer)
        return
      }

      const now = window.performance.now()
      if (isPausedRef.current) {
        lastTickAtRef.current = now
        return
      }

      const previousTickAt = lastTickAtRef.current ?? now
      const deltaMs = Math.min(MAX_TICK_DELTA_MS, Math.max(1, now - previousTickAt))
      lastTickAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      if (feverRemainingMsRef.current > 0) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
      }

      if (missFeedbackMsRef.current > 0) {
        missFeedbackMsRef.current = Math.max(0, missFeedbackMsRef.current - deltaMs)
        setMissFeedbackMs(missFeedbackMsRef.current)
      }

      if (comboScoreFeedbackMsRef.current > 0) {
        comboScoreFeedbackMsRef.current = Math.max(0, comboScoreFeedbackMsRef.current - deltaMs)
        setComboScoreFeedbackMs(comboScoreFeedbackMsRef.current)
        if (comboScoreFeedbackMsRef.current === 0) {
          setComboScoreText(null)
        }
      }

      if (correctPopMsRef.current > 0) {
        correctPopMsRef.current = Math.max(0, correctPopMsRef.current - deltaMs)
        setCorrectPopMs(correctPopMsRef.current)
        if (correctPopMsRef.current === 0) {
          setCorrectEffectSide(null)
          setCorrectEffectCharacterId(null)
        }
      }

      if (correctShakeMsRef.current > 0) {
        correctShakeMsRef.current = Math.max(0, correctShakeMsRef.current - deltaMs)
        setCorrectShakeMs(correctShakeMsRef.current)
      }

      if (burstMsRef.current > 0) {
        burstMsRef.current = Math.max(0, burstMsRef.current - deltaMs)
        if (burstMsRef.current === 0) {
          setBurstText(null)
        }
      }

      if (remainingMsRef.current === 0) {
        finishGame()
        window.clearInterval(timer)
      }
    }, UPDATE_TICK_MS)

    return () => {
      window.clearInterval(timer)
      lastTickAtRef.current = null
    }
  }, [finishGame])

  useEffect(() => {
    if (isPaused || activeFrontSequenceFrames === null || activeFrontSequenceFrames.length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      setSequenceFrameIndex((previous) => (previous + 1) % activeFrontSequenceFrames.length)
    }, CENTER_SEQUENCE_FRAME_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeFrontSequenceFrames, isPaused])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (finishedRef.current || isPausedRef.current) {
        return
      }
      if (event.repeat) {
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        resolveTurn('left')
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        resolveTurn('right')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [resolveTurn])

  const moveLeft = () => {
    if (finishedRef.current || isPausedRef.current) {
      return
    }
    resolveTurn('left')
  }

  const moveRight = () => {
    if (finishedRef.current || isPausedRef.current) {
      return
    }
    resolveTurn('right')
  }

  const resolveCenterImageSrc = useCallback(
    (character: CenterCharacterToken, index: number) => {
      if (index !== 0) {
        return character.imageSrc
      }

      if (character.id === 'kim-yeonja' && isFrontKimYeonja) {
        return KIM_YEONJA_SEQUENCE_FRAMES[sequenceFrameIndex % KIM_YEONJA_SEQUENCE_FRAMES.length] ?? kimYeonjaImage
      }

      if (character.id === 'song-changsik' && isFrontSongChangsik) {
        return SONG_CHANGSIK_SEQUENCE_FRAMES[sequenceFrameIndex % SONG_CHANGSIK_SEQUENCE_FRAMES.length] ?? songChangsikImage
      }

      if (character.id === 'park-wankyu' && isFrontParkWankyu) {
        return PARK_WANKYU_SEQUENCE_FRAMES[sequenceFrameIndex % PARK_WANKYU_SEQUENCE_FRAMES.length] ?? parkWankyuImage
      }

      if (character.id === 'tae-jina' && isFrontTaeJina) {
        return TAE_JINA_SEQUENCE_FRAMES[sequenceFrameIndex % TAE_JINA_SEQUENCE_FRAMES.length] ?? taeJinaImage
      }

      if (character.id === 'park-sangmin' && isFrontParkSangmin) {
        return PARK_SANGMIN_SEQUENCE_FRAMES[sequenceFrameIndex % PARK_SANGMIN_SEQUENCE_FRAMES.length] ?? parkSangminImage
      }

      if (character.id === 'seo-taiji' && isFrontSeoTaiji) {
        return SEO_TAIJI_SEQUENCE_FRAMES[sequenceFrameIndex % SEO_TAIJI_SEQUENCE_FRAMES.length] ?? seoTaijiImage
      }

      return character.imageSrc
    },
    [isFrontKimYeonja, isFrontSongChangsik, isFrontParkWankyu, isFrontTaeJina, isFrontParkSangmin, isFrontSeoTaiji, sequenceFrameIndex],
  )

  const remainingSeconds = Math.ceil(remainingMs / 1000)
  const timeSlidePercent = Math.max(0, Math.min(100, (remainingMs / GAME_DURATION_MS) * 100))

  return (
    <section className="mini-game-panel same-character-panel" aria-label="same-character-game">
      <div
        className={`same-character-track ${correctShakeMs > 0 ? 'shake' : ''} ${isPaused ? 'paused' : ''}`}
        role="presentation"
        style={{ '--same-character-bg-image': `url(${sameCharacterBack04Image})` } as CSSProperties}
      >
        <div className="same-character-top-actions" aria-label="game-actions">
          <button className="same-character-top-action-button home" type="button" onClick={onExit} aria-label="home">
            <img className="same-character-top-action-icon" src={homeButtonImage} alt="" aria-hidden />
          </button>
          <div className="same-character-top-actions-right">
            {isPaused ? (
              <button
                className="same-character-top-action-button play"
                type="button"
                onClick={resumeGame}
                aria-label="resume-game"
              >
                <img className="same-character-top-action-icon" src={playButtonImage} alt="" aria-hidden />
              </button>
            ) : (
              <button
                className="same-character-top-action-button pause"
                type="button"
                onClick={pauseGame}
                aria-label="pause-game"
              >
                <img className="same-character-top-action-icon" src={pauseButtonImage} alt="" aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div
          className="same-character-scoreboard"
          aria-label="score-board"
          style={{ '--same-character-scoreboard-image': `url(${scoreBoardImage})` } as CSSProperties}
        >
          <div className="same-character-scoreboard-item">
            <strong>{score.toLocaleString()}</strong>
          </div>
        </div>

        <div className="same-character-side-group left" aria-label="left-characters">
          {leftQueue.map((character, index) => {
            const isCorrectHitSlot =
              correctPopMs > 0 &&
              correctEffectSide === 'left' &&
              correctEffectCharacterId === character.id

            return (
              <div
                className={`same-character-side-slot ${index === 0 ? 'primary' : 'secondary'} ${isCorrectHitSlot ? 'hit-pop' : ''}`}
                key={`left-${character.id}-${index}${isCorrectHitSlot ? `-${correctEffectPulseKey}` : ''}`}
                style={{ '--side-index': index } as CSSProperties}
              >
                <img className="same-character-avatar side" src={character.sideImageSrc} alt={character.name} />
              </div>
            )
          })}
        </div>

        <div className="same-character-side-group right" aria-label="right-characters">
          {rightQueue.map((character, index) => {
            const isCorrectHitSlot =
              correctPopMs > 0 &&
              correctEffectSide === 'right' &&
              correctEffectCharacterId === character.id

            return (
              <div
                className={`same-character-side-slot ${index === 0 ? 'primary' : 'secondary'} ${isCorrectHitSlot ? 'hit-pop' : ''}`}
                key={`right-${character.id}-${index}${isCorrectHitSlot ? `-${correctEffectPulseKey}` : ''}`}
                style={{ '--side-index': index } as CSSProperties}
              >
                <img className="same-character-avatar side" src={character.sideImageSrc} alt={character.name} />
              </div>
            )
          })}
        </div>

        <div className={`same-character-center-stack ${feverRemainingMs > 0 ? 'fever' : ''}`} aria-label="center-stack">
          {centerQueue.map((character, index) => {
            const isTarget = index === 0
            const isTargetPop = isTarget && correctPopMs > 0
            const showCenterHitEffect = isTarget && correctPopMs > 0

            return (
              <div
                className={`same-character-center-item ${isTarget ? 'target' : ''}`}
                key={character.tokenKey}
                style={
                  {
                    '--stack-index': index,
                    transform: character.id === 'song-changsik' ? 'translateX(5px)' : 'none',
                  } as CSSProperties
                }
              >
                <span className="same-character-speech-bubble center">{character.speechText}</span>
                <img
                  className={`same-character-avatar center ${isTarget ? 'target' : ''} ${isTargetPop ? 'hit-pop' : ''}`}
                  src={resolveCenterImageSrc(character, index)}
                  alt={character.name}
                />
                {showCenterHitEffect ? (
                  <img
                    className="same-character-center-hit-effect"
                    key={`center-hit-${correctEffectPulseKey}`}
                    src={correctHitEffectImage}
                    alt=""
                    aria-hidden
                  />
                ) : null}
              </div>
            )
          })}
        </div>

        {comboScoreFeedbackMs > 0 && comboScoreText !== null ? (
          <p className="same-character-combo-score-float" key={comboScorePulseKey}>
            {comboScoreText}
          </p>
        ) : null}

        <p className={`same-character-judge ${missFeedbackMs > 0 ? 'miss' : 'ready'}`}>{missFeedbackMs > 0 ? 'Wrong!' : ' '}</p>

        {burstText !== null ? <p className="same-character-burst">{burstText}</p> : null}

        {isPaused ? (
          <div className="same-character-paused-overlay" role="status" aria-live="polite">
            <strong>Paused</strong>
            <span>Tap Play to continue</span>
          </div>
        ) : null}

        <div className="same-character-controls">
          <div className="same-character-arrow-row">
            <button
              className="same-character-arrow left"
              type="button"
              onClick={moveLeft}
              aria-label="move-left"
              disabled={isPaused}
            >
              <img className="same-character-arrow-image" src={leftKeyImage} alt="" aria-hidden />
            </button>
            <button
              className="same-character-arrow right"
              type="button"
              onClick={moveRight}
              aria-label="move-right"
              disabled={isPaused}
            >
              <img className="same-character-arrow-image" src={rightKeyImage} alt="" aria-hidden />
            </button>
          </div>
          <div className="same-character-slider-row">
            <div
              className="same-character-bottom-time-slider"
              role="progressbar"
              aria-label="Remaining time"
              aria-valuemin={0}
              aria-valuemax={Math.ceil(GAME_DURATION_MS / 1000)}
              aria-valuenow={remainingSeconds}
            >
              <div className="same-character-bottom-time-track" aria-hidden>
                <div className="same-character-bottom-time-fill" style={{ width: `${timeSlidePercent}%` }} />
              </div>
              <span className="same-character-bottom-time-value">{remainingSeconds}s</span>
            </div>
          </div>
        </div>
      </div>

      <button className="text-button" type="button" onClick={onExit}>
        Back to Hub
      </button>
    </section>
  )
}

export const sameCharacterModule: MiniGameModule = {
  manifest: {
    id: 'same-character',
    title: 'Same Side',
    description: 'Pick the matching character from left or right to keep the combo going.',
    unlockCost: 140,
    baseReward: 24,
    scoreRewardMultiplier: 0.7,
    accentColor: '#f59e0b',
  },
  Component: SameCharacterGame,
}
