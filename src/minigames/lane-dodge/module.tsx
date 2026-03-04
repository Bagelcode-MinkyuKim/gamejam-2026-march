import { useMemo, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'

const TOTAL_ROUNDS = 5
const LANE_COUNT = 3

function randomLane(): number {
  return Math.floor(Math.random() * LANE_COUNT)
}

function LaneDodgeGame({ onFinish, onExit }: MiniGameSessionProps) {
  const safeLanes = useMemo(() => Array.from({ length: TOTAL_ROUNDS }, randomLane), [])
  const [round, setRound] = useState(0)
  const [score, setScore] = useState(0)

  const chooseLane = (lane: number) => {
    const safeLane = safeLanes[round]
    const gainedScore = safeLane === lane ? 20 : 5
    const nextScore = score + gainedScore
    const nextRound = round + 1

    if (nextRound >= TOTAL_ROUNDS) {
      onFinish({
        score: nextScore,
        durationMs: TOTAL_ROUNDS * 1200,
      })
      return
    }

    setScore(nextScore)
    setRound(nextRound)
  }

  return (
    <section className="mini-game-panel" aria-label="lane-dodge-game">
      <h3>Lane Dodge</h3>
      <p className="mini-game-description">라운드마다 안전한 라인을 추측해 통과하세요.</p>
      <p className="mini-game-stat">라운드: {round + 1} / {TOTAL_ROUNDS}</p>
      <p className="mini-game-stat">현재 점수: {score}</p>
      <div className="lane-grid">
        {Array.from({ length: LANE_COUNT }, (_, lane) => (
          <button className="lane-button" key={lane} type="button" onClick={() => chooseLane(lane)}>
            Lane {lane + 1}
          </button>
        ))}
      </div>
      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const laneDodgeModule: MiniGameModule = {
  manifest: {
    id: 'lane-dodge',
    title: 'Lane Dodge',
    description: '3개의 라인 중 안전한 길을 선택하는 라운드형 게임',
    unlockCost: 90,
    baseReward: 18,
    scoreRewardMultiplier: 0.6,
    accentColor: '#22c55e',
  },
  Component: LaneDodgeGame,
}
