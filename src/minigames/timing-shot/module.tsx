import { useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'

const TARGET_VALUE = 73
const MAX_TIME_MS = 9000
const GAUGE_SPEED_PER_MS = 0.1

function clamp(min: number, value: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function TimingShotGame({ onFinish, onExit }: MiniGameSessionProps) {
  const [gauge, setGauge] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const directionRef = useRef<1 | -1>(1)
  const gaugeRef = useRef(0)
  const elapsedRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)

  useEffect(() => {
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

      elapsedRef.current += deltaMs
      setElapsedMs(elapsedRef.current)

      const candidate = gaugeRef.current + directionRef.current * GAUGE_SPEED_PER_MS * deltaMs
      if (candidate >= 100) {
        directionRef.current = -1
        gaugeRef.current = 100
      } else if (candidate <= 0) {
        directionRef.current = 1
        gaugeRef.current = 0
      } else {
        gaugeRef.current = candidate
      }
      setGauge(gaugeRef.current)

      if (elapsedRef.current >= MAX_TIME_MS) {
        finishedRef.current = true
        const distance = Math.abs(gaugeRef.current - TARGET_VALUE)
        const score = clamp(0, 100 - distance * 2, 100)
        onFinish({ score, durationMs: Math.round(elapsedRef.current) })
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
  }, [onFinish])

  const stop = () => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const distance = Math.abs(gaugeRef.current - TARGET_VALUE)
    const score = clamp(0, 100 - distance * 2, 100)
    onFinish({ score, durationMs: elapsedRef.current > 0 ? Math.round(elapsedRef.current) : Math.round(DEFAULT_FRAME_MS) })
  }

  return (
    <section className="mini-game-panel" aria-label="timing-shot-game">
      <h3>Timing Shot</h3>
      <p className="mini-game-description">게이지를 멈춰 목표값 73에 가깝게 맞추세요.</p>
      <div className="gauge-track" role="presentation">
        <div className="gauge-fill" style={{ width: `${gauge}%` }} />
      </div>
      <p className="mini-game-stat">현재 게이지: {Math.round(gauge)}</p>
      <p className="mini-game-stat">목표 게이지: {TARGET_VALUE}</p>
      <p className="mini-game-stat">경과 시간: {(elapsedMs / 1000).toFixed(1)}초</p>
      <button className="tap-button" type="button" onClick={stop}>
        지금 멈추기
      </button>
      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const timingShotModule: MiniGameModule = {
  manifest: {
    id: 'timing-shot',
    title: 'Timing Shot',
    description: '움직이는 게이지를 멈춰 정확도를 겨루는 타이밍 게임',
    unlockCost: 45,
    baseReward: 12,
    scoreRewardMultiplier: 0.8,
    accentColor: '#0ea5e9',
  },
  Component: TimingShotGame,
}
