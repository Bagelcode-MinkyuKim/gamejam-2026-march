import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import tapBurstSprite from '../../../assets/images/tap-dash-burst-pixel-transparent.png'
import tapPopStripSprite from '../../../assets/images/tap-dash-pop-strip-pixel-transparent.png'

const ROUND_DURATION_MS = 8000
const TICK_MS = 100
const COMBO_WINDOW_MS = 280
const IMPACT_LIFETIME_MS = 620
const FEVER_THRESHOLD = 5

interface TapImpact {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly combo: number
  readonly rotationDeg: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function TapDashGame({ onFinish, onExit }: MiniGameSessionProps) {
  const [taps, setTaps] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [impacts, setImpacts] = useState<TapImpact[]>([])
  const [isZoneHitActive, setZoneHitActive] = useState(false)

  const startedAtRef = useRef(0)
  const finishedRef = useRef(false)
  const tapsRef = useRef(0)
  const comboRef = useRef(0)
  const impactIdRef = useRef(0)
  const lastTapAtRef = useRef(0)
  const cleanupTimerIdsRef = useRef<number[]>([])
  const zoneHitTimerRef = useRef<number | null>(null)

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

      if (zoneHitTimerRef.current !== null) {
        window.clearTimeout(zoneHitTimerRef.current)
      }

      for (const timerId of cleanupTimerIdsRef.current) {
        window.clearTimeout(timerId)
      }
      cleanupTimerIdsRef.current = []
    }
  }, [onFinish])

  const createImpact = (x: number, y: number, currentCombo: number) => {
    const id = impactIdRef.current++
    const rotationDeg = ((id * 47) % 40) - 20

    setImpacts((prev) => [...prev, { id, x, y, combo: currentCombo, rotationDeg }])

    const cleanupTimerId = window.setTimeout(() => {
      setImpacts((prev) => prev.filter((impact) => impact.id !== id))
      cleanupTimerIdsRef.current = cleanupTimerIdsRef.current.filter((savedId) => savedId !== cleanupTimerId)
    }, IMPACT_LIFETIME_MS)

    cleanupTimerIdsRef.current.push(cleanupTimerId)
  }

  const activateZoneHit = () => {
    setZoneHitActive(true)

    if (zoneHitTimerRef.current !== null) {
      window.clearTimeout(zoneHitTimerRef.current)
    }

    zoneHitTimerRef.current = window.setTimeout(() => {
      setZoneHitActive(false)
      zoneHitTimerRef.current = null
    }, 110)
  }

  const handleZonePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (remainingMs === 0 || finishedRef.current) {
      return
    }

    const zoneRect = event.currentTarget.getBoundingClientRect()
    const x = clamp(((event.clientX - zoneRect.left) / zoneRect.width) * 100, 0, 100)
    const y = clamp(((event.clientY - zoneRect.top) / zoneRect.height) * 100, 0, 100)

    const now = window.performance.now()
    const elapsed = now - lastTapAtRef.current
    const nextCombo = elapsed <= COMBO_WINDOW_MS ? comboRef.current + 1 : 1

    comboRef.current = nextCombo
    lastTapAtRef.current = now

    setCombo(nextCombo)
    setTaps((prev) => {
      const next = prev + 1
      tapsRef.current = next
      return next
    })

    createImpact(x, y, nextCombo)
    activateZoneHit()
  }

  const comboLabel = combo >= FEVER_THRESHOLD ? `FEVER x${combo}` : `콤보 x${combo}`

  return (
    <section className="mini-game-panel tap-dash-panel" aria-label="tap-dash-game">
      <h3>Tap Dash</h3>
      <p className="mini-game-description">8초 동안 화면을 마구 터치해서 팡팡 터뜨리세요.</p>

      <div className="tap-dash-hud">
        <p className="mini-game-stat">남은 시간: {(remainingMs / 1000).toFixed(1)}초</p>
        <p className="mini-game-stat">현재 점수: {taps}</p>
        <p className={`tap-combo-label ${combo >= FEVER_THRESHOLD ? 'fever' : ''}`}>{comboLabel}</p>
      </div>

      <div
        className={`tap-touch-zone ${isZoneHitActive ? 'hit' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="tap-touch-zone"
        onPointerDown={handleZonePointerDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        <p className="tap-touch-instruction">화면 아무 곳이나 터치!</p>

        {combo >= FEVER_THRESHOLD ? <span className="tap-fever-badge">FEVER TIME</span> : null}

        {impacts.map((impact) => (
          <span
            className="tap-impact"
            key={impact.id}
            style={{
              left: `${impact.x}%`,
              top: `${impact.y}%`,
              '--impact-rotate': `${impact.rotationDeg}deg`,
            } as CSSProperties}
          >
            <span
              className="tap-pop-strip"
              style={{ backgroundImage: `url(${tapPopStripSprite})` }}
              aria-hidden
            />
            <img className="tap-burst-image" src={tapBurstSprite} alt="" aria-hidden />
            <span className="tap-impact-score">{impact.combo > 1 ? `+1 x${impact.combo}` : '+1'}</span>
          </span>
        ))}
      </div>

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
