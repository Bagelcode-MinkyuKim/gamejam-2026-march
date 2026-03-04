import { useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'

const ROUND_DURATION_MS = 8000
const TICK_MS = 100

function TapDashGame({ onFinish, onExit }: MiniGameSessionProps) {
  const [taps, setTaps] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const startedAtRef = useRef<number>(0)
  const finishedRef = useRef(false)
  const tapsRef = useRef(0)

  useEffect(() => {
    startedAtRef.current = window.performance.now()
    const timer = window.setInterval(() => {
      setRemainingMs((current) => {
        const next = current - TICK_MS
        if (next <= 0) {
          window.clearInterval(timer)
          if (!finishedRef.current) {
            finishedRef.current = true
            onFinish({
              score: tapsRef.current,
              durationMs: window.performance.now() - startedAtRef.current,
            })
          }
          return 0
        }

        return next
      })
    }, TICK_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [onFinish])

  const handleTap = () => {
    if (remainingMs === 0 || finishedRef.current) {
      return
    }

    setTaps((prev) => {
      const next = prev + 1
      tapsRef.current = next
      return next
    })
  }

  return (
    <section className="mini-game-panel" aria-label="tap-dash-game">
      <h3>Tap Dash</h3>
      <p className="mini-game-description">8초 동안 버튼을 최대한 많이 눌러 점수를 얻으세요.</p>
      <p className="mini-game-stat">남은 시간: {(remainingMs / 1000).toFixed(1)}초</p>
      <p className="mini-game-stat">현재 점수: {taps}</p>
      <button className="tap-button" type="button" onClick={handleTap}>
        TAP!
      </button>
      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const tapDashModule: MiniGameModule = {
  manifest: {
    id: 'tap-dash',
    title: 'Tap Dash',
    description: '짧은 시간 동안 연타해서 점수를 올리는 반응형 게임',
    unlockCost: 0,
    baseReward: 8,
    scoreRewardMultiplier: 1.2,
    accentColor: '#ff8a00',
  },
  Component: TapDashGame,
}
