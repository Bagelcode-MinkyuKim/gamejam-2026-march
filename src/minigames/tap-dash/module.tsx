import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import tapDashCharacterSprite from '../../../assets/images/character-tap-dash-pixel-transparent.png'
import tapBurstSprite from '../../../assets/images/tap-dash-burst-pixel-transparent.png'
import tapPopStripSprite from '../../../assets/images/tap-dash-pop-strip-pixel-transparent.png'
import tapRingSheetSprite from '../../../assets/images/tap-dash-ring-sheet-pixel-transparent.png'
import tapSparkSheetSprite from '../../../assets/images/tap-dash-spark-sheet-pixel-transparent.png'

const ROUND_DURATION_MS = 30000
const TICK_MS = 100
const IMPACT_LIFETIME_MS = 620
const TARGET_SPAWN_X_MIN = 24
const TARGET_SPAWN_X_MAX = 76
const TARGET_SPAWN_Y_MIN = 22
const TARGET_SPAWN_Y_MAX = 82

const TARGET_BASE_IMAGES = [tapBurstSprite, tapRingSheetSprite, tapPopStripSprite, tapSparkSheetSprite] as const

interface TapImpact {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly rotationDeg: number
  readonly ringScale: number
  readonly sparkScale: number
  readonly sparkOffsetX: number
  readonly sparkOffsetY: number
  readonly sparkRotationDeg: number
}

interface TapTarget {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly baseImage: string
  readonly rotationDeg: number
  readonly scale: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function createTarget(targetId: number): TapTarget {
  const baseImage = TARGET_BASE_IMAGES[Math.floor(Math.random() * TARGET_BASE_IMAGES.length)]
  return {
    id: targetId,
    x: randomBetween(TARGET_SPAWN_X_MIN, TARGET_SPAWN_X_MAX),
    y: randomBetween(TARGET_SPAWN_Y_MIN, TARGET_SPAWN_Y_MAX),
    baseImage,
    rotationDeg: randomBetween(-14, 14),
    scale: randomBetween(0.92, 1.1),
  }
}

function TapDashGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [currentScore, setCurrentScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [impacts, setImpacts] = useState<TapImpact[]>([])
  const [isZoneHitActive, setZoneHitActive] = useState(false)
  const [target, setTarget] = useState<TapTarget>(() => createTarget(0))

  const startedAtRef = useRef(0)
  const finishedRef = useRef(false)
  const tapsRef = useRef(0)
  const impactIdRef = useRef(0)
  const targetIdRef = useRef(1)
  const cleanupTimerIdsRef = useRef<number[]>([])
  const zoneHitTimerRef = useRef<number | null>(null)
  const zoneRef = useRef<HTMLDivElement | null>(null)

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

  const createImpact = useCallback((x: number, y: number) => {
    const impactId = impactIdRef.current++
    const id = impactId
    const rotationDeg = ((id * 47) % 40) - 20
    const ringScale = 0.9 + ((id * 13) % 5) * 0.06
    const sparkScale = 0.72 + ((id * 17) % 5) * 0.08
    const sparkOffsetX = ((id * 29) % 21) - 10
    const sparkOffsetY = ((id * 31) % 21) - 10
    const sparkRotationDeg = ((id * 71) % 360) - 180

    setImpacts((prev) => [
      ...prev,
      { id, x, y, rotationDeg, ringScale, sparkScale, sparkOffsetX, sparkOffsetY, sparkRotationDeg },
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
    }, 110)
  }, [])

  const handleTargetPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (remainingMs === 0 || finishedRef.current) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const zoneRect = zoneRef.current?.getBoundingClientRect()
    if (!zoneRect) {
      return
    }

    const x = clamp(((event.clientX - zoneRect.left) / zoneRect.width) * 100, 0, 100)
    const y = clamp(((event.clientY - zoneRect.top) / zoneRect.height) * 100, 0, 100)

    tapsRef.current += 1
    setCurrentScore(tapsRef.current)

    createImpact(x, y)
    activateZoneHit()
    setTarget(createTarget(targetIdRef.current))
    targetIdRef.current += 1
  }

  const remainingSeconds = Math.ceil(remainingMs / 1000)
  const timeGaugePercent = useMemo(
    () => clamp((remainingMs / ROUND_DURATION_MS) * 100, 0, 100),
    [remainingMs],
  )
  const displayedBestScore = Math.max(bestScore, currentScore)

  return (
    <section className="mini-game-panel tap-dash-panel" aria-label="tap-dash-game">
      <div
        className={`tap-touch-zone ${isZoneHitActive ? 'hit' : ''}`}
        ref={zoneRef}
        aria-label="tap-touch-zone"
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="tap-dash-score-overlay" aria-live="polite">
          <p className="tap-dash-current-score">{currentScore}</p>
          <p className="tap-dash-best-score">BEST {displayedBestScore}</p>
        </div>
        <div className="tap-dash-time-overlay" aria-live="polite">
          <p className="tap-dash-time-label">{remainingSeconds}s</p>
          <div className="tap-dash-time-gauge" role="progressbar" aria-valuemin={0} aria-valuemax={30} aria-valuenow={remainingSeconds}>
            <span className="tap-dash-time-fill" style={{ width: `${timeGaugePercent}%` }} />
          </div>
        </div>

        <button
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
            <img className="tap-target-base" src={target.baseImage} alt="" aria-hidden />
            <img className="tap-target-character" src={tapDashCharacterSprite} alt="" aria-hidden />
          </span>
        </button>

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
              className="tap-ring-sheet"
              style={
                {
                  '--tap-ring-sheet': `url(${tapRingSheetSprite})`,
                  '--ring-scale': `${impact.ringScale}`,
                } as CSSProperties
              }
              aria-hidden
            />
            <span
              className="tap-pop-strip"
              style={{ '--tap-pop-sheet': `url(${tapPopStripSprite})` } as CSSProperties}
              aria-hidden
            />
            <span
              className="tap-spark-sheet"
              style={
                {
                  '--tap-spark-sheet': `url(${tapSparkSheetSprite})`,
                  '--spark-scale': `${impact.sparkScale}`,
                  '--spark-offset-x': `${impact.sparkOffsetX}px`,
                  '--spark-offset-y': `${impact.sparkOffsetY}px`,
                  '--spark-rotate': `${impact.sparkRotationDeg}deg`,
                } as CSSProperties
              }
              aria-hidden
            />
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
    description: '30초 동안 랜덤 타겟에 등장하는 캐릭터를 탭해 점수를 쌓는 미니게임',
    unlockCost: 0,
    baseReward: 8,
    scoreRewardMultiplier: 1.2,
    accentColor: '#ff8a00',
  },
  Component: TapDashGame,
}
