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

const CHARACTER_POOL = [
  { id: 'park-sangmin', name: '박상민', color: '#ef4444', imageSrc: parkSangminImage },
  { id: 'song-changsik', name: '송창식', color: '#22c55e', imageSrc: songChangsikImage },
  { id: 'tae-jina', name: '태진아', color: '#22d3ee', imageSrc: taeJinaImage },
  { id: 'park-wankyu', name: '박완규', color: '#f59e0b', imageSrc: parkWankyuImage },
  { id: 'kim-yeonja', name: '김연자', color: '#ec4899', imageSrc: kimYeonjaImage },
  { id: 'seo-taiji', name: '서태지', color: '#8b5cf6', imageSrc: seoTaijiImage },
] as const

type CharacterToken = (typeof CHARACTER_POOL)[number]
type JudgeState = 'ready' | 'match' | 'miss'

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

function SameCharacterGame({ onFinish, onExit }: MiniGameSessionProps) {
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

  const chooseLane = useCallback((nextLane: number) => {
    const clamped = clamp(0, nextLane, LANE_COUNT - 1)
    selectedLaneRef.current = clamped
    setSelectedLane(clamped)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const elapsedMs = Math.max(Math.round(DEFAULT_FRAME_MS), Math.round(window.performance.now() - startedAtRef.current))
    const comboBonus = bestComboRef.current * 5

    onFinish({
      score: scoreRef.current + comboBonus,
      durationMs: elapsedMs,
    })
  }, [onFinish])

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

      let nextStarGauge = starGaugeRef.current + STAR_GAIN_ON_MATCH
      if (nextStarGauge >= 100) {
        nextStarGauge -= 100
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setFeverRemainingMs(FEVER_DURATION_MS)
        burstMsRef.current = 900
        setBurstText('오옷!')
      } else if (nextCombo >= 3) {
        burstMsRef.current = 700
        setBurstText('오옷!')
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
      comboRef.current = 0
      setCombo(0)

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
  }, [])

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

      if (feverRemainingMsRef.current > 0) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
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
  }, [finishGame, resolveTurn])

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

  const turnFillPercent = (turnRemainingMs / TURN_DURATION_MS) * 100
  const leftPreview = laneStacks[0]?.slice(0, 2) ?? []
  const rightPreview = laneStacks[2]?.slice(0, 2) ?? []

  return (
    <section className="mini-game-panel same-character-panel" aria-label="same-character-game">
      <div className="same-character-score-strip">
        <p>⭐ {starGauge}</p>
        <p>{score.toLocaleString()}</p>
        <p>{Math.ceil(remainingMs / 1000)}</p>
      </div>

      <div className="same-character-top-row">
        <div className="same-character-star-meter" role="presentation">
          <div className="same-character-star-fill" style={{ width: `${starGauge}%` }} />
        </div>
        {timeBonusFlashMs > 0 ? <p className="same-character-time-bonus">+10s</p> : <p className="same-character-time-bonus"> </p>}
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
                    borderColor: character.color,
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

      <p className={`same-character-judge ${judge}`}>{judge === 'match' ? '오옷!' : judge === 'miss' ? '앗!' : ''}</p>

      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const sameCharacterModule: MiniGameModule = {
  manifest: {
    id: 'same-character',
    title: '니편내편',
    description: '중앙 대기열 캐릭터가 차례로 전진할 때 좌우 이동으로 같은 줄을 맞추는 콤보 게임',
    unlockCost: 140,
    baseReward: 24,
    scoreRewardMultiplier: 0.7,
    accentColor: '#f59e0b',
  },
  Component: SameCharacterGame,
}
