import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'

const LANE_LABELS = ['LEFT', 'CENTER', 'RIGHT'] as const
const LANE_COUNT = LANE_LABELS.length
const GAME_DURATION_MS = 32000
const ROUND_DURATION_MS = 1400
const TICK_MS = 50
const MAX_MISSES = 5

const CHARACTER_POOL = [
  { id: 'red-cat', name: 'Red Cat', badge: 'CAT', color: '#ef4444' },
  { id: 'mint-bear', name: 'Mint Bear', badge: 'BEAR', color: '#22c55e' },
  { id: 'blue-fox', name: 'Blue Fox', badge: 'FOX', color: '#22d3ee' },
  { id: 'gold-pup', name: 'Gold Pup', badge: 'PUP', color: '#f59e0b' },
] as const

type CharacterToken = (typeof CHARACTER_POOL)[number]

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomCharacter(): CharacterToken {
  const index = Math.floor(Math.random() * CHARACTER_POOL.length)
  return CHARACTER_POOL[index]
}

function createInitialLanes(): CharacterToken[] {
  return Array.from({ length: LANE_COUNT }, randomCharacter)
}

function SameCharacterGame({ onFinish, onExit }: MiniGameSessionProps) {
  const [laneIndex, setLaneIndex] = useState(1)
  const [laneCharacters, setLaneCharacters] = useState<CharacterToken[]>(() => createInitialLanes())
  const [incomingCharacter, setIncomingCharacter] = useState<CharacterToken>(() => randomCharacter())
  const [remainingRoundMs, setRemainingRoundMs] = useState(ROUND_DURATION_MS)
  const [remainingGameMs, setRemainingGameMs] = useState(GAME_DURATION_MS)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [bestCombo, setBestCombo] = useState(0)
  const [misses, setMisses] = useState(0)
  const [lastJudge, setLastJudge] = useState<'READY' | 'MATCH' | 'MISS'>('READY')

  const laneIndexRef = useRef(laneIndex)
  const laneCharactersRef = useRef<CharacterToken[]>(laneCharacters)
  const incomingCharacterRef = useRef<CharacterToken>(incomingCharacter)
  const remainingRoundMsRef = useRef(remainingRoundMs)
  const remainingGameMsRef = useRef(remainingGameMs)
  const scoreRef = useRef(score)
  const comboRef = useRef(combo)
  const bestComboRef = useRef(bestCombo)
  const missesRef = useRef(misses)
  const finishedRef = useRef(false)
  const startedAtRef = useRef(0)

  const setLanePosition = useCallback((nextIndex: number) => {
    const clamped = clamp(0, nextIndex, LANE_COUNT - 1)
    laneIndexRef.current = clamped
    setLaneIndex(clamped)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const elapsedMs = Math.max(TICK_MS, Math.round(window.performance.now() - startedAtRef.current))
    const chainBonus = bestComboRef.current * 4
    onFinish({
      score: scoreRef.current + chainBonus,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const resolveRound = useCallback((): boolean => {
    const selectedCharacter = laneCharactersRef.current[laneIndexRef.current]
    const isMatch = selectedCharacter.id === incomingCharacterRef.current.id

    if (isMatch) {
      const nextCombo = comboRef.current + 1
      const gainedScore = 12 + nextCombo * 6
      const nextScore = scoreRef.current + gainedScore

      comboRef.current = nextCombo
      scoreRef.current = nextScore
      setCombo(nextCombo)
      setScore(nextScore)

      if (nextCombo > bestComboRef.current) {
        bestComboRef.current = nextCombo
        setBestCombo(nextCombo)
      }

      const nextLaneCharacters = laneCharactersRef.current.map((character, index) =>
        index === laneIndexRef.current ? randomCharacter() : character,
      )
      laneCharactersRef.current = nextLaneCharacters
      setLaneCharacters(nextLaneCharacters)
      setLastJudge('MATCH')
    } else {
      comboRef.current = 0
      setCombo(0)

      const nextMisses = missesRef.current + 1
      missesRef.current = nextMisses
      setMisses(nextMisses)
      setLastJudge('MISS')

      if (nextMisses >= MAX_MISSES) {
        finishGame()
        return true
      }
    }

    const nextIncoming = randomCharacter()
    incomingCharacterRef.current = nextIncoming
    setIncomingCharacter(nextIncoming)
    return false
  }, [finishGame])

  useEffect(() => {
    startedAtRef.current = window.performance.now()

    const timer = window.setInterval(() => {
      if (finishedRef.current) {
        window.clearInterval(timer)
        return
      }

      remainingGameMsRef.current = Math.max(0, remainingGameMsRef.current - TICK_MS)
      remainingRoundMsRef.current = Math.max(0, remainingRoundMsRef.current - TICK_MS)
      setRemainingGameMs(remainingGameMsRef.current)
      setRemainingRoundMs(remainingRoundMsRef.current)

      if (remainingRoundMsRef.current === 0) {
        const ended = resolveRound()
        if (ended) {
          window.clearInterval(timer)
          return
        }

        remainingRoundMsRef.current = ROUND_DURATION_MS
        setRemainingRoundMs(ROUND_DURATION_MS)
      }

      if (remainingGameMsRef.current === 0) {
        finishGame()
        window.clearInterval(timer)
      }
    }, TICK_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [finishGame, resolveRound])

  const moveLeft = () => {
    if (finishedRef.current) {
      return
    }
    setLanePosition(laneIndexRef.current - 1)
  }

  const moveRight = () => {
    if (finishedRef.current) {
      return
    }
    setLanePosition(laneIndexRef.current + 1)
  }

  const roundProgress = Math.round(((ROUND_DURATION_MS - remainingRoundMs) / ROUND_DURATION_MS) * 100)
  const lifeLeft = MAX_MISSES - misses

  return (
    <section className="mini-game-panel same-character-panel" aria-label="same-character-game">
      <h3>니편내편</h3>
      <p className="mini-game-description">좌우 버튼으로 라인을 옮기며 내려오는 캐릭터와 같은 캐릭터를 맞추세요.</p>

      <div className="same-character-hud">
        <p className="mini-game-stat">남은 시간: {(remainingGameMs / 1000).toFixed(1)}초</p>
        <p className="mini-game-stat">점수: {score}</p>
        <p className="mini-game-stat">콤보: x{combo} (최고 x{bestCombo})</p>
        <p className="mini-game-stat">남은 기회: {lifeLeft}</p>
      </div>

      <div className="same-character-drop-track" role="presentation">
        <div className="same-character-drop-fill" style={{ width: `${roundProgress}%` }} />
      </div>

      <p className="same-character-incoming">
        내려오는 캐릭터:
        <span className="same-character-chip" style={{ '--character-color': incomingCharacter.color } as CSSProperties}>
          {incomingCharacter.badge}
        </span>
        {incomingCharacter.name}
      </p>

      <div className="same-character-lanes">
        {laneCharacters.map((character, index) => (
          <div
            className={`same-character-lane ${laneIndex === index ? 'selected' : ''}`}
            key={`${index}-${character.id}`}
          >
            <p className="same-character-lane-label">{LANE_LABELS[index]}</p>
            <span
              className="same-character-chip"
              style={{ '--character-color': character.color } as CSSProperties}
            >
              {character.badge}
            </span>
            <p className="same-character-name">{character.name}</p>
          </div>
        ))}
      </div>

      <div className="same-character-controls">
        <button className="lane-button" type="button" onClick={moveLeft}>
          ← 왼쪽
        </button>
        <button className="lane-button" type="button" onClick={moveRight}>
          오른쪽 →
        </button>
      </div>

      <p className={`same-character-judge ${lastJudge.toLowerCase()}`}>
        {lastJudge === 'MATCH' ? 'MATCH! 콤보 상승' : lastJudge === 'MISS' ? 'MISS! 라인을 다시 맞춰보세요' : 'READY'}
      </p>

      <button className="text-button" type="button" onClick={finishGame}>
        라운드 종료
      </button>
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
    description: '좌우 이동으로 같은 캐릭터를 맞춰 콤보를 쌓는 게임',
    unlockCost: 140,
    baseReward: 24,
    scoreRewardMultiplier: 0.7,
    accentColor: '#f59e0b',
  },
  Component: SameCharacterGame,
}
