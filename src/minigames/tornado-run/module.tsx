import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const LANE_COUNT = 3
const LANE_WIDTH = 80
const BOARD_WIDTH = LANE_COUNT * LANE_WIDTH
const BOARD_HEIGHT = 560
const CHARACTER_SIZE = 48
const CHARACTER_BOTTOM = 60
const OBSTACLE_SIZE = 36
const COIN_SIZE = 24

const START_SPEED = 180
const MAX_SPEED = 520
const ACCEL_PER_SECOND = 18
const COIN_SCORE = 10
const DISTANCE_SCORE_RATE = 2.5

const SPAWN_INTERVAL_BASE_MS = 900
const SPAWN_INTERVAL_MIN_MS = 380
const SPAWN_INTERVAL_ACCEL = 0.96

const COIN_SPAWN_CHANCE = 0.45
const TORNADO_SPAWN_CHANCE = 0.7

const HITBOX_SHRINK = 8
const GAME_TIMEOUT_MS = 120000

// --- Gimmick constants ---
const SHIELD_SPAWN_CHANCE = 0.08
const SHIELD_SIZE = 26
const SHIELD_DURATION_MS = 4000
const SCORE_ZONE_SPAWN_CHANCE = 0.06
const SCORE_ZONE_SIZE = 30
const SCORE_ZONE_MULTIPLIER = 3
const SCORE_ZONE_DURATION_MS = 5000
const DODGE_COMBO_DISTANCE = 50
const DODGE_COMBO_BONUS = 2
const FEVER_COIN_THRESHOLD = 10
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 2

interface Obstacle {
  readonly id: number
  readonly lane: number
  readonly y: number
  readonly type: 'tornado' | 'coin' | 'shield' | 'score_zone'
}

function clampLane(lane: number): number {
  return Math.max(0, Math.min(LANE_COUNT - 1, lane))
}

function laneToX(lane: number): number {
  return lane * LANE_WIDTH + LANE_WIDTH / 2
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

function TornadoRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()

  const [currentLane, setCurrentLane] = useState(1)
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [score, setScore] = useState(0)
  const [coinCount, setCoinCount] = useState(0)
  const [distance, setDistance] = useState(0)
  const [speed, setSpeed] = useState(START_SPEED)
  const [gameOver, setGameOver] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [hasShield, setHasShield] = useState(false)
  const [shieldRemainingMs, setShieldRemainingMs] = useState(0)
  const [hasScoreZone, setHasScoreZone] = useState(false)
  const [scoreZoneRemainingMs, setScoreZoneRemainingMs] = useState(0)
  const [dodgeCombo, setDodgeCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)

  const laneRef = useRef(1)
  const obstaclesRef = useRef<Obstacle[]>([])
  const scoreRef = useRef(0)
  const coinCountRef = useRef(0)
  const distanceRef = useRef(0)
  const speedRef = useRef(START_SPEED)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const nextObstacleIdRef = useRef(0)
  const spawnTimerRef = useRef(0)
  const spawnIntervalRef = useRef(SPAWN_INTERVAL_BASE_MS)
  const hasShieldRef = useRef(false)
  const shieldRemainingMsRef = useRef(0)
  const hasScoreZoneRef = useRef(false)
  const scoreZoneRemainingMsRef = useRef(0)
  const dodgeComboRef = useRef(0)
  const nearMissCountRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)

  const laneSfxRef = useRef<HTMLAudioElement | null>(null)
  const coinSfxRef = useRef<HTMLAudioElement | null>(null)
  const crashSfxRef = useRef<HTMLAudioElement | null>(null)

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const playSfx = useCallback((audio: HTMLAudioElement | null, volume: number, rate = 1) => {
    if (audio === null) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const finishRound = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    setGameOver(true)
    const finalScore = scoreRef.current + Math.floor(distanceRef.current * DISTANCE_SCORE_RATE)
    onFinish({
      score: finalScore,
      durationMs: Math.max(1, Math.round(elapsedMsRef.current)),
    })
  }, [onFinish])

  const changeLane = useCallback((direction: -1 | 1) => {
    if (finishedRef.current) return
    const next = clampLane(laneRef.current + direction)
    if (next !== laneRef.current) {
      laneRef.current = next
      setCurrentLane(next)
      playSfx(laneSfxRef.current, 0.35, 1)
    }
  }, [playSfx])

  // Audio setup
  useEffect(() => {
    const laneAudio = new Audio(tapHitSfx)
    laneAudio.preload = 'auto'
    laneSfxRef.current = laneAudio

    const coinAudio = new Audio(tapHitStrongSfx)
    coinAudio.preload = 'auto'
    coinSfxRef.current = coinAudio

    const crashAudio = new Audio(gameOverHitSfx)
    crashAudio.preload = 'auto'
    crashSfxRef.current = crashAudio

    return () => {
      for (const a of [laneAudio, coinAudio, crashAudio]) {
        a.pause()
        a.currentTime = 0
      }
      effects.cleanup()
    }
  }, [])

  // Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault()
        onExit()
        return
      }
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        changeLane(-1)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        changeLane(1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeLane, onExit])

  // Game loop
  useEffect(() => {
    lastFrameRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) {
        animFrameRef.current = null
        return
      }

      if (lastFrameRef.current === null) {
        lastFrameRef.current = now
      }

      const deltaMs = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now
      elapsedMsRef.current += deltaMs
      setElapsedMs(elapsedMsRef.current)

      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        finishRound()
        animFrameRef.current = null
        return
      }

      // Update power-up timers
      if (hasShieldRef.current) {
        shieldRemainingMsRef.current = Math.max(0, shieldRemainingMsRef.current - deltaMs)
        setShieldRemainingMs(shieldRemainingMsRef.current)
        if (shieldRemainingMsRef.current <= 0) {
          hasShieldRef.current = false
          setHasShield(false)
        }
      }

      if (hasScoreZoneRef.current) {
        scoreZoneRemainingMsRef.current = Math.max(0, scoreZoneRemainingMsRef.current - deltaMs)
        setScoreZoneRemainingMs(scoreZoneRemainingMsRef.current)
        if (scoreZoneRemainingMsRef.current <= 0) {
          hasScoreZoneRef.current = false
          setHasScoreZone(false)
        }
      }

      if (isFeverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      const elapsedSeconds = elapsedMsRef.current / 1000
      const currentSpeed = Math.min(MAX_SPEED, START_SPEED + elapsedSeconds * ACCEL_PER_SECOND)
      speedRef.current = currentSpeed
      setSpeed(currentSpeed)

      const movedPx = currentSpeed * (deltaMs / 1000)
      distanceRef.current += movedPx / 100
      setDistance(distanceRef.current)

      // Spawn obstacles
      spawnTimerRef.current += deltaMs
      spawnIntervalRef.current = Math.max(
        SPAWN_INTERVAL_MIN_MS,
        spawnIntervalRef.current * SPAWN_INTERVAL_ACCEL,
      )

      let nextObstacles = [...obstaclesRef.current]

      if (spawnTimerRef.current >= spawnIntervalRef.current) {
        spawnTimerRef.current = 0

        const roll = Math.random()
        if (roll < TORNADO_SPAWN_CHANCE) {
          const lane = Math.floor(Math.random() * LANE_COUNT)
          nextObstacles.push({
            id: nextObstacleIdRef.current++,
            lane,
            y: -OBSTACLE_SIZE,
            type: 'tornado',
          })
        }

        if (Math.random() < COIN_SPAWN_CHANCE) {
          const coinLane = Math.floor(Math.random() * LANE_COUNT)
          const hasTornadoSameLane = nextObstacles.some(
            (o) => o.type === 'tornado' && o.lane === coinLane && o.y < OBSTACLE_SIZE * 2,
          )
          if (!hasTornadoSameLane) {
            nextObstacles.push({
              id: nextObstacleIdRef.current++,
              lane: coinLane,
              y: -COIN_SIZE,
              type: 'coin',
            })
          }
        }

        // Shield spawn
        if (Math.random() < SHIELD_SPAWN_CHANCE && !hasShieldRef.current) {
          const shieldLane = Math.floor(Math.random() * LANE_COUNT)
          nextObstacles.push({
            id: nextObstacleIdRef.current++,
            lane: shieldLane,
            y: -SHIELD_SIZE,
            type: 'shield',
          })
        }

        // Score zone spawn
        if (Math.random() < SCORE_ZONE_SPAWN_CHANCE && !hasScoreZoneRef.current) {
          const zoneLane = Math.floor(Math.random() * LANE_COUNT)
          nextObstacles.push({
            id: nextObstacleIdRef.current++,
            lane: zoneLane,
            y: -SCORE_ZONE_SIZE,
            type: 'score_zone',
          })
        }
      }

      // Move obstacles down
      nextObstacles = nextObstacles.map((o) => ({
        ...o,
        y: o.y + movedPx,
      }))

      // Collision detection
      const playerX = laneToX(laneRef.current) - CHARACTER_SIZE / 2 + HITBOX_SHRINK
      const playerY = BOARD_HEIGHT - CHARACTER_BOTTOM - CHARACTER_SIZE + HITBOX_SHRINK
      const playerW = CHARACTER_SIZE - HITBOX_SHRINK * 2
      const playerH = CHARACTER_SIZE - HITBOX_SHRINK * 2

      let hitTornado = false
      const survivingObstacles: Obstacle[] = []
      let dodgedTornado = false

      for (const o of nextObstacles) {
        const oSize = o.type === 'tornado' ? OBSTACLE_SIZE : o.type === 'shield' ? SHIELD_SIZE : o.type === 'score_zone' ? SCORE_ZONE_SIZE : COIN_SIZE
        const ox = laneToX(o.lane) - oSize / 2

        if (rectsOverlap(playerX, playerY, playerW, playerH, ox, o.y, oSize, oSize)) {
          if (o.type === 'coin') {
            const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
            const zoneMult = hasScoreZoneRef.current ? SCORE_ZONE_MULTIPLIER : 1
            const coinPoints = COIN_SCORE * feverMult * zoneMult
            scoreRef.current += coinPoints
            coinCountRef.current += 1
            setScore(scoreRef.current)
            setCoinCount(coinCountRef.current)
            playSfx(coinSfxRef.current, 0.5, 1.2)
            effects.comboHitBurst(laneToX(o.lane), o.y, coinCountRef.current, coinPoints)

            // Check fever activation
            if (coinCountRef.current > 0 && coinCountRef.current % FEVER_COIN_THRESHOLD === 0 && !isFeverRef.current) {
              isFeverRef.current = true
              feverRemainingMsRef.current = FEVER_DURATION_MS
              setIsFever(true)
              setFeverRemainingMs(FEVER_DURATION_MS)
              playSfx(coinSfxRef.current, 0.7, 1.5)
            }
            continue
          } else if (o.type === 'shield') {
            hasShieldRef.current = true
            shieldRemainingMsRef.current = SHIELD_DURATION_MS
            setHasShield(true)
            setShieldRemainingMs(SHIELD_DURATION_MS)
            playSfx(coinSfxRef.current, 0.6, 1.3)
            continue
          } else if (o.type === 'score_zone') {
            hasScoreZoneRef.current = true
            scoreZoneRemainingMsRef.current = SCORE_ZONE_DURATION_MS
            setHasScoreZone(true)
            setScoreZoneRemainingMs(SCORE_ZONE_DURATION_MS)
            playSfx(coinSfxRef.current, 0.6, 1.1)
            continue
          } else {
            // Tornado hit
            if (hasShieldRef.current) {
              // Shield absorbs hit
              hasShieldRef.current = false
              shieldRemainingMsRef.current = 0
              setHasShield(false)
              setShieldRemainingMs(0)
              playSfx(laneSfxRef.current, 0.5, 0.8)
              continue
            }
            hitTornado = true
            break
          }
        }

        // Near-miss detection for dodge combo
        if (o.type === 'tornado' && o.y > playerY && o.y < playerY + DODGE_COMBO_DISTANCE) {
          const tornadoLaneX = laneToX(o.lane)
          const playerCenterX = laneToX(laneRef.current)
          if (Math.abs(tornadoLaneX - playerCenterX) < LANE_WIDTH * 1.2 && Math.abs(tornadoLaneX - playerCenterX) > HITBOX_SHRINK) {
            dodgedTornado = true
          }
        }

        // Remove off-screen obstacles
        if (o.y < BOARD_HEIGHT + 60) {
          survivingObstacles.push(o)
        }
      }

      if (dodgedTornado) {
        dodgeComboRef.current += 1
        nearMissCountRef.current += 1
        setDodgeCombo(dodgeComboRef.current)
        if (dodgeComboRef.current > 0 && dodgeComboRef.current % 3 === 0) {
          scoreRef.current += DODGE_COMBO_BONUS * dodgeComboRef.current
          setScore(scoreRef.current)
        }
      }

      if (hitTornado) {
        playSfx(crashSfxRef.current, 0.65, 0.9)
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.5)')
        obstaclesRef.current = nextObstacles
        setObstacles(nextObstacles)
        finishRound()
        animFrameRef.current = null
        return
      }

      obstaclesRef.current = survivingObstacles
      setObstacles(survivingObstacles)

      effects.updateParticles()

      animFrameRef.current = window.requestAnimationFrame(step)
    }

    animFrameRef.current = window.requestAnimationFrame(step)

    return () => {
      if (animFrameRef.current !== null) {
        window.cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = null
      }
      lastFrameRef.current = null
    }
  }, [finishRound, playSfx])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartRef.current === null || e.changedTouches.length === 0) return
    const endX = e.changedTouches[0].clientX
    const dx = endX - touchStartRef.current.x
    touchStartRef.current = null

    if (Math.abs(dx) > 20) {
      changeLane(dx > 0 ? 1 : -1)
    }
  }, [changeLane])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = e.clientX - rect.left
    if (relX < rect.width / 2) {
      changeLane(-1)
    } else {
      changeLane(1)
    }
  }, [changeLane])

  const totalScore = score + Math.floor(distance * DISTANCE_SCORE_RATE)
  const displayedBestScore = Math.max(bestScore, totalScore)

  return (
    <section className="mini-game-panel tornado-run-panel" aria-label="tornado-run-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <div
        className="tornado-run-board"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handlePointerDown}
        role="presentation"
      >
        {/* HUD */}
        <div className="tornado-run-hud">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 2 }}>
            <img src={parkSangminSprite} alt="character" className="tornado-run-hud-avatar" />
            <div style={{ flex: 1 }}>
              <div className="tornado-run-hud-row">
                <span className="tornado-run-score-label">SCORE</span>
                <span className="tornado-run-score-value">{totalScore}</span>
              </div>
              <div className="tornado-run-hud-row">
                <span className="tornado-run-best-label">BEST</span>
                <span className="tornado-run-best-value">{displayedBestScore}</span>
              </div>
            </div>
          </div>
          <div className="tornado-run-hud-row tornado-run-hud-sub">
            <span>Coins: {coinCount}</span>
            <span>Dist: {distance.toFixed(0)}m</span>
            <span>Spd: {speed.toFixed(0)}</span>
            {dodgeCombo > 0 && <span style={{ color: '#fbbf24' }}>Dodge: {dodgeCombo}</span>}
          </div>
          {/* Power-up indicators */}
          <div className="tornado-run-hud-row tornado-run-hud-sub" style={{ gap: 6 }}>
            {hasShield && (
              <span style={{ color: '#22d3ee', fontWeight: 'bold', fontSize: 12 }}>
                SHIELD ({(shieldRemainingMs / 1000).toFixed(1)}s)
              </span>
            )}
            {hasScoreZone && (
              <span style={{ color: '#a78bfa', fontWeight: 'bold', fontSize: 12 }}>
                x{SCORE_ZONE_MULTIPLIER} ({(scoreZoneRemainingMs / 1000).toFixed(1)}s)
              </span>
            )}
            {isFever && (
              <span style={{ color: '#f97316', fontWeight: 'bold', fontSize: 12, animation: 'tornado-run-fever-flash 0.3s infinite alternate' }}>
                FEVER x{FEVER_MULTIPLIER} ({(feverRemainingMs / 1000).toFixed(1)}s)
              </span>
            )}
          </div>
        </div>

        {/* Game area */}
        <div
          className="tornado-run-field"
          style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT }}
        >
          {/* Lane dividers */}
          {Array.from({ length: LANE_COUNT - 1 }, (_, i) => (
            <div
              key={`lane-div-${i}`}
              className="tornado-run-lane-divider"
              style={{ left: (i + 1) * LANE_WIDTH }}
            />
          ))}

          {/* Road markings scrolling effect */}
          <div
            className="tornado-run-road-marks"
            style={{
              backgroundPositionY: `${(elapsedMs * speed) / 4000 % 40}px`,
            }}
          />

          {/* Obstacles and coins */}
          {obstacles.map((o) => {
            const cx = laneToX(o.lane)
            if (o.type === 'tornado') {
              return (
                <div
                  key={o.id}
                  className="tornado-run-tornado"
                  style={{
                    left: cx - OBSTACLE_SIZE / 2,
                    top: o.y,
                    width: OBSTACLE_SIZE,
                    height: OBSTACLE_SIZE,
                  }}
                >
                  <div className="tornado-run-tornado-inner" />
                </div>
              )
            }
            if (o.type === 'shield') {
              return (
                <div
                  key={o.id}
                  className="tornado-run-shield"
                  style={{
                    left: cx - SHIELD_SIZE / 2,
                    top: o.y,
                    width: SHIELD_SIZE,
                    height: SHIELD_SIZE,
                  }}
                />
              )
            }
            if (o.type === 'score_zone') {
              return (
                <div
                  key={o.id}
                  className="tornado-run-score-zone"
                  style={{
                    left: cx - SCORE_ZONE_SIZE / 2,
                    top: o.y,
                    width: SCORE_ZONE_SIZE,
                    height: SCORE_ZONE_SIZE,
                  }}
                />
              )
            }
            return (
              <div
                key={o.id}
                className="tornado-run-coin"
                style={{
                  left: cx - COIN_SIZE / 2,
                  top: o.y,
                  width: COIN_SIZE,
                  height: COIN_SIZE,
                }}
              />
            )
          })}

          {/* Player character */}
          <div
            className={`tornado-run-player ${hasShield ? 'tornado-run-player-shielded' : ''}`}
            style={{
              left: laneToX(currentLane) - CHARACTER_SIZE / 2,
              bottom: CHARACTER_BOTTOM,
              width: CHARACTER_SIZE,
              height: CHARACTER_SIZE,
            }}
          >
            <img
              src={parkSangminSprite}
              alt="player"
              className="tornado-run-player-img"
              draggable={false}
            />
          </div>

          {/* Game over overlay */}
          {gameOver && (
            <div className="tornado-run-gameover-overlay">
              <p className="tornado-run-gameover-text">GAME OVER</p>
              <p className="tornado-run-gameover-score">Score: {totalScore}</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="tornado-run-controls">
          <button
            className="tornado-run-btn tornado-run-btn-left"
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation()
              changeLane(-1)
            }}
          >
            LEFT
          </button>
          <button
            className="tornado-run-btn tornado-run-btn-right"
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation()
              changeLane(1)
            }}
          >
            RIGHT
          </button>
        </div>

        <p className="tornado-run-hint">Swipe or tap LEFT/RIGHT to change lane</p>

        <div className="tornado-run-actions">
          <button
            className="tornado-run-action-button"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              playSfx(coinSfxRef.current, 0.5, 1)
              finishRound()
            }}
          >
            End
          </button>
          <button
            className="tornado-run-action-button ghost"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onExit}
          >
            Exit
          </button>
        </div>
      </div>

      <style>{`
        .tornado-run-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, #1e293b 0%, #334155 50%, #475569 100%);
          color: #f1f5f9;
          font-family: 'Segoe UI', system-ui, sans-serif;
          overflow: hidden;
          user-select: none;
          touch-action: none;
        }

        .tornado-run-board {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          max-width: 400px;
          height: 100%;
          position: relative;
        }

        .tornado-run-hud {
          width: 100%;
          padding: 8px 14px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          z-index: 10;
          background: linear-gradient(180deg, rgba(71,85,105,0.4) 0%, rgba(71,85,105,0.08) 100%);
          border-bottom: 1px solid rgba(148,163,184,0.2);
        }

        .tornado-run-hud-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #64748b;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(148,163,184,0.3);
        }

        .tornado-run-hud-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        .tornado-run-hud-sub {
          font-size: 11px;
          opacity: 0.7;
          gap: 8px;
        }

        .tornado-run-score-label,
        .tornado-run-best-label {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
          opacity: 0.8;
        }

        .tornado-run-score-value {
          font-size: 28px;
          font-weight: 800;
          color: #fbbf24;
          text-shadow: 0 0 8px rgba(251, 191, 36, 0.5);
        }

        .tornado-run-best-value {
          font-size: 16px;
          font-weight: 600;
          color: #94a3b8;
        }

        .tornado-run-field {
          position: relative;
          background: #1e293b;
          border: 2px solid #475569;
          border-radius: 8px;
          overflow: hidden;
          flex-shrink: 0;
          margin: 0 auto;
        }

        .tornado-run-lane-divider {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: repeating-linear-gradient(
            to bottom,
            transparent 0px,
            transparent 16px,
            rgba(148, 163, 184, 0.25) 16px,
            rgba(148, 163, 184, 0.25) 32px
          );
          pointer-events: none;
        }

        .tornado-run-road-marks {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            to bottom,
            transparent 0px,
            transparent 30px,
            rgba(100, 116, 139, 0.1) 30px,
            rgba(100, 116, 139, 0.1) 40px
          );
          pointer-events: none;
        }

        .tornado-run-player {
          position: absolute;
          z-index: 5;
          transition: left 0.12s ease-out;
          filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5));
        }

        .tornado-run-player-shielded {
          filter: drop-shadow(0 0 12px rgba(34, 211, 238, 0.8)) drop-shadow(0 4px 6px rgba(0, 0, 0, 0.5));
        }

        .tornado-run-player-shielded::after {
          content: '';
          position: absolute;
          inset: -6px;
          border-radius: 50%;
          border: 2px solid rgba(34, 211, 238, 0.6);
          animation: tornado-run-shield-pulse 0.6s ease-in-out infinite alternate;
        }

        .tornado-run-player-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
        }

        .tornado-run-tornado {
          position: absolute;
          z-index: 3;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tornado-run-tornado-inner {
          width: 80%;
          height: 80%;
          border-radius: 50%;
          background: radial-gradient(circle, #94a3b8 0%, #64748b 40%, #475569 70%, transparent 100%);
          border: 2px solid rgba(148, 163, 184, 0.6);
          animation: tornado-run-spin 0.6s linear infinite;
          box-shadow:
            0 0 12px rgba(148, 163, 184, 0.5),
            inset 0 0 8px rgba(30, 41, 59, 0.5);
        }

        @keyframes tornado-run-spin {
          from { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.1); }
          to { transform: rotate(360deg) scale(1); }
        }

        .tornado-run-coin {
          position: absolute;
          z-index: 3;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #fde68a, #f59e0b, #d97706);
          border: 2px solid #fbbf24;
          box-shadow: 0 0 8px rgba(251, 191, 36, 0.6);
          animation: tornado-run-coin-pulse 0.8s ease-in-out infinite alternate;
        }

        @keyframes tornado-run-coin-pulse {
          from { box-shadow: 0 0 6px rgba(251, 191, 36, 0.4); }
          to { box-shadow: 0 0 14px rgba(251, 191, 36, 0.8); }
        }

        .tornado-run-shield {
          position: absolute;
          z-index: 3;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #67e8f9, #22d3ee, #06b6d4);
          border: 2px solid #22d3ee;
          box-shadow: 0 0 12px rgba(34, 211, 238, 0.7);
          animation: tornado-run-shield-item-pulse 0.6s ease-in-out infinite alternate;
        }

        @keyframes tornado-run-shield-item-pulse {
          from { box-shadow: 0 0 8px rgba(34, 211, 238, 0.5); transform: scale(1); }
          to { box-shadow: 0 0 18px rgba(34, 211, 238, 0.9); transform: scale(1.1); }
        }

        @keyframes tornado-run-shield-pulse {
          from { opacity: 0.4; transform: scale(1); }
          to { opacity: 0.8; transform: scale(1.05); }
        }

        .tornado-run-score-zone {
          position: absolute;
          z-index: 3;
          border-radius: 6px;
          background: radial-gradient(circle at 35% 35%, #ddd6fe, #a78bfa, #7c3aed);
          border: 2px solid #a78bfa;
          box-shadow: 0 0 12px rgba(167, 139, 250, 0.7);
          animation: tornado-run-zone-pulse 0.7s ease-in-out infinite alternate;
        }

        @keyframes tornado-run-zone-pulse {
          from { box-shadow: 0 0 8px rgba(167, 139, 250, 0.4); }
          to { box-shadow: 0 0 16px rgba(167, 139, 250, 0.9); }
        }

        .tornado-run-gameover-overlay {
          position: absolute;
          inset: 0;
          z-index: 20;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.8);
          backdrop-filter: blur(4px);
        }

        .tornado-run-gameover-text {
          font-size: 36px;
          font-weight: 900;
          color: #ef4444;
          text-shadow: 0 0 16px rgba(239, 68, 68, 0.6);
          margin: 0 0 8px;
        }

        .tornado-run-gameover-score {
          font-size: 20px;
          font-weight: 600;
          color: #fbbf24;
          margin: 0;
        }

        .tornado-run-controls {
          display: flex;
          gap: 16px;
          margin-top: 12px;
          z-index: 10;
        }

        .tornado-run-btn {
          width: 100px;
          height: 48px;
          border: 2px solid #64748b;
          border-radius: 10px;
          background: linear-gradient(180deg, rgba(71,85,105,0.9) 0%, rgba(51,65,85,0.95) 100%);
          color: #e2e8f0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 1px;
          cursor: pointer;
          box-shadow: 0 3px 0 #1e293b, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
        }

        .tornado-run-btn:active {
          background: rgba(71, 85, 105, 1);
          transform: translateY(2px);
          box-shadow: 0 1px 0 #1e293b, 0 2px 4px rgba(0,0,0,0.3);
        }

        .tornado-run-hint {
          font-size: 11px;
          color: #94a3b8;
          margin: 6px 0 4px;
          text-align: center;
        }

        .tornado-run-actions {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }

        .tornado-run-action-button {
          padding: 8px 20px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(180deg, #64748b 0%, #475569 100%);
          color: #f1f5f9;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 3px 0 #1e293b, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
        }

        .tornado-run-action-button:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #1e293b;
        }

        .tornado-run-action-button.ghost {
          background: transparent;
          border: 1px solid #475569;
          color: #94a3b8;
          box-shadow: none;
        }

        .tornado-run-action-button.ghost:active {
          background: rgba(71,85,105,0.2);
          transform: translateY(1px);
        }

        @keyframes tornado-run-fever-flash {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }
      `}</style>
    </section>
  )
}

export const tornadoRunModule: MiniGameModule = {
  manifest: {
    id: 'tornado-run',
    title: 'Tornado Run',
    description: '\uD1A0\uB124\uC774\uB3C4\uB97C \uD53C\uD558\uACE0 \uCF54\uC778\uC744 \uBAA8\uC544\uB77C! 3\uB808\uC778 \uB7EC\uB108!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#475569',
  },
  Component: TornadoRunGame,
}
