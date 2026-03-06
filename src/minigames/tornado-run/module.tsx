import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

// Dedicated sounds
import laneChangeSfx from '../../../assets/sounds/tornado-lane-change.mp3'
import coinCollectSfx from '../../../assets/sounds/tornado-coin-collect.mp3'
import crashSfx from '../../../assets/sounds/tornado-crash.mp3'
import shieldSfx from '../../../assets/sounds/tornado-shield.mp3'
import feverSfx from '../../../assets/sounds/tornado-fever.mp3'
import dodgeSfx from '../../../assets/sounds/tornado-dodge.mp3'
import shieldBreakSfx from '../../../assets/sounds/tornado-shield-break.mp3'
import magnetSfx from '../../../assets/sounds/tornado-magnet.mp3'
import speedUpSfx from '../../../assets/sounds/tornado-speed-up.mp3'

// --- Layout: fill the 9:16 frame ---
const LANE_COUNT = 3
const BOARD_WIDTH = 432
const LANE_WIDTH = BOARD_WIDTH / LANE_COUNT
const CHARACTER_SIZE = 56
const CHARACTER_BOTTOM = 70
const OBSTACLE_SIZE = 42
const COIN_SIZE = 30
const ITEM_SIZE = 32

// --- Game balance ---
const START_SPEED = 200
const MAX_SPEED = 600
const ACCEL_PER_SECOND = 20
const COIN_SCORE = 10
const DISTANCE_SCORE_RATE = 2.5

const SPAWN_INTERVAL_BASE_MS = 850
const SPAWN_INTERVAL_MIN_MS = 320
const SPAWN_INTERVAL_ACCEL = 0.96

const COIN_SPAWN_CHANCE = 0.5
const TORNADO_SPAWN_CHANCE = 0.72

const HITBOX_SHRINK = 8
const GAME_TIMEOUT_MS = 120000

// --- Gimmick constants ---
const SHIELD_SPAWN_CHANCE = 0.07
const SHIELD_DURATION_MS = 4000
const SCORE_ZONE_SPAWN_CHANCE = 0.05
const SCORE_ZONE_MULTIPLIER = 3
const SCORE_ZONE_DURATION_MS = 5000
const DODGE_COMBO_DISTANCE = 55
const DODGE_COMBO_BONUS = 3
const FEVER_COIN_THRESHOLD = 10
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 2

// --- New features ---
const MAGNET_SPAWN_CHANCE = 0.05
const MAGNET_DURATION_MS = 5000
const MAGNET_PULL_RANGE = 160
const JUMP_SPAWN_CHANCE = 0.04
const JUMP_DURATION_MS = 400
const MULTI_TORNADO_THRESHOLD_SPEED = 350
const SPEED_MILESTONE_INTERVAL = 100
const LIGHTNING_TORNADO_CHANCE = 0.12
const LIGHTNING_WARN_MS = 600

type ObstacleType = 'tornado' | 'coin' | 'shield' | 'score_zone' | 'magnet' | 'jump' | 'lightning_warn' | 'lightning'

interface Obstacle {
  readonly id: number
  readonly lane: number
  y: number
  readonly type: ObstacleType
  readonly spawnTime: number
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

function getObstacleSize(type: ObstacleType): number {
  if (type === 'tornado' || type === 'lightning') return OBSTACLE_SIZE
  if (type === 'coin') return COIN_SIZE
  return ITEM_SIZE
}

function TornadoRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects({ maxParticles: 50 })
  const containerRef = useRef<HTMLDivElement>(null)

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
  const [hasMagnet, setHasMagnet] = useState(false)
  const [magnetRemainingMs, setMagnetRemainingMs] = useState(0)
  const [isJumping, setIsJumping] = useState(false)
  const [boardHeight, setBoardHeight] = useState(680)
  const [lastSpeedMilestone, setLastSpeedMilestone] = useState(START_SPEED)

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
  const isFeverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const hasMagnetRef = useRef(false)
  const magnetRemainingMsRef = useRef(0)
  const isJumpingRef = useRef(false)
  const jumpTimerRef = useRef(0)
  const lastSpeedMilestoneRef = useRef(START_SPEED)

  const sfxRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const playSfx = useCallback((key: string, volume: number, rate = 1) => {
    const audio = sfxRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
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
      playSfx('lane', 0.35, 1)
    }
  }, [playSfx])

  // Measure available height
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const h = containerRef.current.clientHeight
        // Leave room for HUD (80px) and controls (90px)
        setBoardHeight(Math.max(400, h - 170))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Audio setup
  useEffect(() => {
    const sfxMap: Record<string, string> = {
      lane: laneChangeSfx,
      coin: coinCollectSfx,
      crash: crashSfx,
      shield: shieldSfx,
      fever: feverSfx,
      dodge: dodgeSfx,
      shieldBreak: shieldBreakSfx,
      magnet: magnetSfx,
      speedUp: speedUpSfx,
    }

    const audios: HTMLAudioElement[] = []
    for (const [key, src] of Object.entries(sfxMap)) {
      const a = new Audio(src)
      a.preload = 'auto'
      sfxRefs.current[key] = a
      audios.push(a)
    }

    return () => {
      for (const a of audios) {
        a.pause()
        a.currentTime = 0
      }
      effects.cleanup()
    }
  }, [])

  // Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.code === 'ArrowLeft') { e.preventDefault(); changeLane(-1) }
      else if (e.code === 'ArrowRight') { e.preventDefault(); changeLane(1) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeLane, onExit])

  // Game loop
  useEffect(() => {
    lastFrameRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animFrameRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now

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
        if (shieldRemainingMsRef.current <= 0) { hasShieldRef.current = false; setHasShield(false) }
      }
      if (hasScoreZoneRef.current) {
        scoreZoneRemainingMsRef.current = Math.max(0, scoreZoneRemainingMsRef.current - deltaMs)
        setScoreZoneRemainingMs(scoreZoneRemainingMsRef.current)
        if (scoreZoneRemainingMsRef.current <= 0) { hasScoreZoneRef.current = false; setHasScoreZone(false) }
      }
      if (isFeverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) { isFeverRef.current = false; setIsFever(false) }
      }
      if (hasMagnetRef.current) {
        magnetRemainingMsRef.current = Math.max(0, magnetRemainingMsRef.current - deltaMs)
        setMagnetRemainingMs(magnetRemainingMsRef.current)
        if (magnetRemainingMsRef.current <= 0) { hasMagnetRef.current = false; setHasMagnet(false) }
      }
      if (isJumpingRef.current) {
        jumpTimerRef.current = Math.max(0, jumpTimerRef.current - deltaMs)
        if (jumpTimerRef.current <= 0) { isJumpingRef.current = false; setIsJumping(false) }
      }

      const elapsedSeconds = elapsedMsRef.current / 1000
      const currentSpeed = Math.min(MAX_SPEED, START_SPEED + elapsedSeconds * ACCEL_PER_SECOND)
      speedRef.current = currentSpeed
      setSpeed(currentSpeed)

      // Speed milestone notification
      const milestone = Math.floor(currentSpeed / SPEED_MILESTONE_INTERVAL) * SPEED_MILESTONE_INTERVAL
      if (milestone > lastSpeedMilestoneRef.current) {
        lastSpeedMilestoneRef.current = milestone
        setLastSpeedMilestone(milestone)
        playSfx('speedUp', 0.4, 1 + (milestone - START_SPEED) / 1000)
        effects.triggerFlash('rgba(59,130,246,0.3)')
      }

      const movedPx = currentSpeed * (deltaMs / 1000)
      distanceRef.current += movedPx / 100
      setDistance(distanceRef.current)

      // Spawn
      spawnTimerRef.current += deltaMs
      spawnIntervalRef.current = Math.max(SPAWN_INTERVAL_MIN_MS, spawnIntervalRef.current * SPAWN_INTERVAL_ACCEL)

      let nextObstacles = [...obstaclesRef.current]
      const bh = boardHeight

      if (spawnTimerRef.current >= spawnIntervalRef.current) {
        spawnTimerRef.current = 0
        const nowMs = elapsedMsRef.current

        // Tornado(s)
        if (Math.random() < TORNADO_SPAWN_CHANCE) {
          const lane = Math.floor(Math.random() * LANE_COUNT)
          nextObstacles.push({ id: nextObstacleIdRef.current++, lane, y: -OBSTACLE_SIZE, type: 'tornado', spawnTime: nowMs })

          // Multi-tornado at high speed
          if (currentSpeed >= MULTI_TORNADO_THRESHOLD_SPEED && Math.random() < 0.35) {
            let lane2 = Math.floor(Math.random() * LANE_COUNT)
            if (lane2 === lane) lane2 = (lane + 1) % LANE_COUNT
            nextObstacles.push({ id: nextObstacleIdRef.current++, lane: lane2, y: -OBSTACLE_SIZE - 30, type: 'tornado', spawnTime: nowMs })
          }
        }

        // Lightning tornado (warning → strike)
        if (currentSpeed >= 300 && Math.random() < LIGHTNING_TORNADO_CHANCE) {
          const lLane = Math.floor(Math.random() * LANE_COUNT)
          nextObstacles.push({ id: nextObstacleIdRef.current++, lane: lLane, y: bh - CHARACTER_BOTTOM - 40, type: 'lightning_warn', spawnTime: nowMs })
        }

        // Coins
        if (Math.random() < COIN_SPAWN_CHANCE) {
          const coinLane = Math.floor(Math.random() * LANE_COUNT)
          const hasTornadoSameLane = nextObstacles.some(o => o.type === 'tornado' && o.lane === coinLane && o.y < OBSTACLE_SIZE * 2)
          if (!hasTornadoSameLane) {
            nextObstacles.push({ id: nextObstacleIdRef.current++, lane: coinLane, y: -COIN_SIZE, type: 'coin', spawnTime: nowMs })
          }
        }

        // Items
        if (Math.random() < SHIELD_SPAWN_CHANCE && !hasShieldRef.current)
          nextObstacles.push({ id: nextObstacleIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'shield', spawnTime: nowMs })
        if (Math.random() < SCORE_ZONE_SPAWN_CHANCE && !hasScoreZoneRef.current)
          nextObstacles.push({ id: nextObstacleIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'score_zone', spawnTime: nowMs })
        if (Math.random() < MAGNET_SPAWN_CHANCE && !hasMagnetRef.current)
          nextObstacles.push({ id: nextObstacleIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'magnet', spawnTime: nowMs })
        if (Math.random() < JUMP_SPAWN_CHANCE && !isJumpingRef.current)
          nextObstacles.push({ id: nextObstacleIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'jump', spawnTime: nowMs })
      }

      // Convert lightning warnings to actual lightning
      nextObstacles = nextObstacles.map(o => {
        if (o.type === 'lightning_warn' && (elapsedMsRef.current - o.spawnTime) >= LIGHTNING_WARN_MS) {
          return { ...o, type: 'lightning' as ObstacleType }
        }
        return o
      })

      // Move obstacles down
      const playerCX = laneToX(laneRef.current)
      nextObstacles = nextObstacles.map(o => {
        if (o.type === 'lightning_warn' || o.type === 'lightning') return o // stationary

        // Magnet: pull coins toward player
        if (o.type === 'coin' && hasMagnetRef.current) {
          const coinCX = laneToX(o.lane)
          const dx = playerCX - coinCX
          const playerY = bh - CHARACTER_BOTTOM - CHARACTER_SIZE / 2
          const dy = playerY - o.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAGNET_PULL_RANGE && dist > 5) {
            const pullStrength = 3 * (deltaMs / 16.66)
            return {
              ...o,
              y: o.y + movedPx + (dy / dist) * pullStrength,
            }
          }
        }
        return { ...o, y: o.y + movedPx }
      })

      // Collision detection
      const isJmp = isJumpingRef.current
      const playerX = laneToX(laneRef.current) - CHARACTER_SIZE / 2 + HITBOX_SHRINK
      const playerY = bh - CHARACTER_BOTTOM - CHARACTER_SIZE + HITBOX_SHRINK
      const playerW = CHARACTER_SIZE - HITBOX_SHRINK * 2
      const playerH = CHARACTER_SIZE - HITBOX_SHRINK * 2

      let hitTornado = false
      const survivingObstacles: Obstacle[] = []
      let dodgedTornado = false

      for (const o of nextObstacles) {
        const oSize = getObstacleSize(o.type)
        const ox = laneToX(o.lane) - oSize / 2

        // Lightning: remove after 400ms
        if ((o.type === 'lightning_warn' || o.type === 'lightning') && (elapsedMsRef.current - o.spawnTime) > LIGHTNING_WARN_MS + 400) {
          continue
        }

        if (rectsOverlap(playerX, playerY, playerW, playerH, ox, o.y, oSize, oSize)) {
          if (o.type === 'coin') {
            const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
            const zoneMult = hasScoreZoneRef.current ? SCORE_ZONE_MULTIPLIER : 1
            const coinPoints = COIN_SCORE * feverMult * zoneMult
            scoreRef.current += coinPoints
            coinCountRef.current += 1
            setScore(scoreRef.current)
            setCoinCount(coinCountRef.current)
            playSfx('coin', 0.5, 1 + coinCountRef.current * 0.02)
            effects.comboHitBurst(laneToX(o.lane), o.y, coinCountRef.current, coinPoints)
            if (coinCountRef.current > 0 && coinCountRef.current % FEVER_COIN_THRESHOLD === 0 && !isFeverRef.current) {
              isFeverRef.current = true; feverRemainingMsRef.current = FEVER_DURATION_MS
              setIsFever(true); setFeverRemainingMs(FEVER_DURATION_MS)
              playSfx('fever', 0.6, 1)
              effects.triggerFlash('rgba(249,115,22,0.4)')
            }
            continue
          } else if (o.type === 'shield') {
            hasShieldRef.current = true; shieldRemainingMsRef.current = SHIELD_DURATION_MS
            setHasShield(true); setShieldRemainingMs(SHIELD_DURATION_MS)
            playSfx('shield', 0.5, 1)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0)
            continue
          } else if (o.type === 'score_zone') {
            hasScoreZoneRef.current = true; scoreZoneRemainingMsRef.current = SCORE_ZONE_DURATION_MS
            setHasScoreZone(true); setScoreZoneRemainingMs(SCORE_ZONE_DURATION_MS)
            playSfx('coin', 0.5, 1.3)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0)
            continue
          } else if (o.type === 'magnet') {
            hasMagnetRef.current = true; magnetRemainingMsRef.current = MAGNET_DURATION_MS
            setHasMagnet(true); setMagnetRemainingMs(MAGNET_DURATION_MS)
            playSfx('magnet', 0.5, 1)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0)
            continue
          } else if (o.type === 'jump') {
            isJumpingRef.current = true; jumpTimerRef.current = JUMP_DURATION_MS
            setIsJumping(true)
            playSfx('dodge', 0.5, 1.2)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0)
            continue
          } else if (o.type === 'lightning_warn') {
            // Warning only — no collision
            survivingObstacles.push(o)
            continue
          } else {
            // Tornado or lightning hit
            if (isJmp) {
              // Jump dodges it!
              dodgedTornado = true
              continue
            }
            if (hasShieldRef.current) {
              hasShieldRef.current = false; shieldRemainingMsRef.current = 0
              setHasShield(false); setShieldRemainingMs(0)
              playSfx('shieldBreak', 0.5, 0.9)
              effects.triggerFlash('rgba(34,211,238,0.4)')
              continue
            }
            hitTornado = true
            break
          }
        }

        // Near-miss dodge combo
        if ((o.type === 'tornado' || o.type === 'lightning') && o.y > playerY && o.y < playerY + DODGE_COMBO_DISTANCE) {
          const tornadoLaneX = laneToX(o.lane)
          if (Math.abs(tornadoLaneX - playerCX) < LANE_WIDTH * 1.2 && Math.abs(tornadoLaneX - playerCX) > HITBOX_SHRINK) {
            dodgedTornado = true
          }
        }

        if (o.y < bh + 60) survivingObstacles.push(o)
      }

      if (dodgedTornado) {
        dodgeComboRef.current += 1
        setDodgeCombo(dodgeComboRef.current)
        if (dodgeComboRef.current % 3 === 0) {
          const bonus = DODGE_COMBO_BONUS * dodgeComboRef.current
          scoreRef.current += bonus
          setScore(scoreRef.current)
          effects.comboHitBurst(playerCX, playerY - 20, dodgeComboRef.current, bonus)
        }
        playSfx('dodge', 0.3, 1 + dodgeComboRef.current * 0.05)
      }

      if (hitTornado) {
        playSfx('crash', 0.7, 0.9)
        effects.triggerShake(10)
        effects.triggerFlash('rgba(239,68,68,0.6)')
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
  }, [finishRound, playSfx, boardHeight])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return
    const endX = e.changedTouches[0].clientX
    const dx = endX - touchStartRef.current.x
    touchStartRef.current = null
    if (Math.abs(dx) > 20) changeLane(dx > 0 ? 1 : -1)
  }, [changeLane])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = e.clientX - rect.left
    changeLane(relX < rect.width / 2 ? -1 : 1)
  }, [changeLane])

  const totalScore = score + Math.floor(distance * DISTANCE_SCORE_RATE)
  const displayedBestScore = Math.max(bestScore, totalScore)
  const timeLeft = Math.max(0, Math.ceil((GAME_TIMEOUT_MS - elapsedMs) / 1000))

  return (
    <section
      ref={containerRef}
      className="mini-game-panel tornado-run-panel"
      aria-label="tornado-run-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}
    >
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
          <div className="tornado-run-hud-main">
            <img src={parkSangminSprite} alt="" className="tornado-run-hud-avatar" />
            <div className="tornado-run-hud-scores">
              <div className="tornado-run-score-row">
                <span className="tornado-run-score-value">{totalScore}</span>
              </div>
              <div className="tornado-run-best-row">
                <span className="tornado-run-best-label">BEST {displayedBestScore}</span>
                <span className="tornado-run-timer">{timeLeft}s</span>
              </div>
            </div>
          </div>

          {/* Power-up indicators */}
          <div className="tornado-run-powerups">
            {hasShield && <span className="tornado-run-pw pw-shield">SHIELD {(shieldRemainingMs / 1000).toFixed(1)}s</span>}
            {hasScoreZone && <span className="tornado-run-pw pw-zone">x{SCORE_ZONE_MULTIPLIER} {(scoreZoneRemainingMs / 1000).toFixed(1)}s</span>}
            {isFever && <span className="tornado-run-pw pw-fever">FEVER x{FEVER_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s</span>}
            {hasMagnet && <span className="tornado-run-pw pw-magnet">MAGNET {(magnetRemainingMs / 1000).toFixed(1)}s</span>}
            {isJumping && <span className="tornado-run-pw pw-jump">JUMP!</span>}
            {dodgeCombo >= 3 && <span className="tornado-run-pw pw-dodge">DODGE x{dodgeCombo}</span>}
          </div>
        </div>

        {/* Game field - fills remaining space */}
        <div
          className="tornado-run-field"
          style={{ width: BOARD_WIDTH, height: boardHeight }}
        >
          {/* Lane dividers */}
          {Array.from({ length: LANE_COUNT - 1 }, (_, i) => (
            <div key={`lane-div-${i}`} className="tornado-run-lane-divider" style={{ left: (i + 1) * LANE_WIDTH }} />
          ))}

          {/* Road markings */}
          <div className="tornado-run-road-marks" style={{ backgroundPositionY: `${(elapsedMs * speed) / 4000 % 40}px` }} />

          {/* Speed lines effect at high speed */}
          {speed > 350 && (
            <div className="tornado-run-speed-lines" style={{ opacity: Math.min(1, (speed - 350) / 200) }} />
          )}

          {/* Fever overlay */}
          {isFever && <div className="tornado-run-fever-overlay" />}

          {/* Obstacles */}
          {obstacles.map(o => {
            const cx = laneToX(o.lane)
            const oSize = getObstacleSize(o.type)

            if (o.type === 'tornado') {
              return (
                <div key={o.id} className="tornado-run-tornado" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }}>
                  <div className="tornado-run-tornado-inner" />
                </div>
              )
            }
            if (o.type === 'lightning_warn') {
              return <div key={o.id} className="tornado-run-lightning-warn" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }} />
            }
            if (o.type === 'lightning') {
              return <div key={o.id} className="tornado-run-lightning" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }} />
            }
            if (o.type === 'shield') {
              return <div key={o.id} className="tornado-run-shield-item" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }} />
            }
            if (o.type === 'score_zone') {
              return <div key={o.id} className="tornado-run-score-zone" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }} />
            }
            if (o.type === 'magnet') {
              return <div key={o.id} className="tornado-run-magnet-item" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }} />
            }
            if (o.type === 'jump') {
              return <div key={o.id} className="tornado-run-jump-item" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }} />
            }
            // Coin
            return <div key={o.id} className={`tornado-run-coin ${hasMagnet ? 'tornado-run-coin-magnetic' : ''}`} style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }} />
          })}

          {/* Player character */}
          <div
            className={`tornado-run-player ${hasShield ? 'shielded' : ''} ${isJumping ? 'jumping' : ''}`}
            style={{
              left: laneToX(currentLane) - CHARACTER_SIZE / 2,
              bottom: CHARACTER_BOTTOM,
              width: CHARACTER_SIZE,
              height: CHARACTER_SIZE,
            }}
          >
            <img src={parkSangminSprite} alt="player" className="tornado-run-player-img" draggable={false} />
            {hasMagnet && <div className="tornado-run-magnet-aura" />}
          </div>

          {/* Game over overlay */}
          {gameOver && (
            <div className="tornado-run-gameover-overlay">
              <p className="tornado-run-gameover-text">GAME OVER</p>
              <p className="tornado-run-gameover-score">Score: {totalScore}</p>
              <p className="tornado-run-gameover-stats">
                {coinCount} coins | {distance.toFixed(0)}m | {dodgeCombo} dodges
              </p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="tornado-run-controls">
          <button className="tornado-run-btn" type="button" onPointerDown={(e) => { e.stopPropagation(); changeLane(-1) }}>
            <span className="tornado-run-btn-arrow">&#9664;</span> LEFT
          </button>
          <button className="tornado-run-btn" type="button" onPointerDown={(e) => { e.stopPropagation(); changeLane(1) }}>
            RIGHT <span className="tornado-run-btn-arrow">&#9654;</span>
          </button>
        </div>
      </div>

      <style>{`
        .tornado-run-panel {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, #0f172a 0%, #1e293b 40%, #334155 100%);
          color: #f1f5f9;
          font-family: 'Segoe UI', system-ui, sans-serif;
          overflow: hidden;
          user-select: none;
          touch-action: none;
        }

        .tornado-run-board {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          position: relative;
        }

        /* --- HUD --- */
        .tornado-run-hud {
          width: 100%;
          padding: 8px 12px 4px;
          z-index: 10;
          flex-shrink: 0;
        }

        .tornado-run-hud-main {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .tornado-run-hud-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          border: 2px solid #fbbf24;
          object-fit: cover;
          box-shadow: 0 0 10px rgba(251,191,36,0.4);
        }

        .tornado-run-hud-scores {
          flex: 1;
        }

        .tornado-run-score-row {
          display: flex;
          align-items: baseline;
          gap: 6px;
        }

        .tornado-run-score-value {
          font-size: 2.2rem;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 12px rgba(251,191,36,0.6), 0 2px 4px rgba(0,0,0,0.5);
          line-height: 1;
        }

        .tornado-run-best-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 2px;
        }

        .tornado-run-best-label {
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
          letter-spacing: 0.5px;
        }

        .tornado-run-timer {
          font-size: 13px;
          font-weight: 700;
          color: #e2e8f0;
          background: rgba(71,85,105,0.5);
          padding: 1px 8px;
          border-radius: 4px;
        }

        .tornado-run-powerups {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 4px;
          min-height: 18px;
        }

        .tornado-run-pw {
          font-size: 10px;
          font-weight: 800;
          padding: 1px 6px;
          border-radius: 4px;
          letter-spacing: 0.5px;
        }

        .pw-shield { color: #22d3ee; background: rgba(34,211,238,0.15); border: 1px solid rgba(34,211,238,0.3); }
        .pw-zone { color: #a78bfa; background: rgba(167,139,250,0.15); border: 1px solid rgba(167,139,250,0.3); }
        .pw-fever { color: #f97316; background: rgba(249,115,22,0.15); border: 1px solid rgba(249,115,22,0.3); animation: tornado-run-fever-flash 0.3s infinite alternate; }
        .pw-magnet { color: #f472b6; background: rgba(244,114,182,0.15); border: 1px solid rgba(244,114,182,0.3); }
        .pw-jump { color: #34d399; background: rgba(52,211,153,0.15); border: 1px solid rgba(52,211,153,0.3); animation: tornado-run-jump-flash 0.2s ease-out; }
        .pw-dodge { color: #fbbf24; background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.3); }

        /* --- Field --- */
        .tornado-run-field {
          position: relative;
          background: #0f172a;
          overflow: hidden;
          flex: 1;
          margin: 0 auto;
          border-left: 2px solid rgba(71,85,105,0.5);
          border-right: 2px solid rgba(71,85,105,0.5);
        }

        .tornado-run-lane-divider {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: repeating-linear-gradient(to bottom, transparent 0px, transparent 20px, rgba(148,163,184,0.15) 20px, rgba(148,163,184,0.15) 40px);
          pointer-events: none;
        }

        .tornado-run-road-marks {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(to bottom, transparent 0px, transparent 30px, rgba(100,116,139,0.08) 30px, rgba(100,116,139,0.08) 40px);
          pointer-events: none;
        }

        .tornado-run-speed-lines {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(to bottom,
            transparent 0px, transparent 60px,
            rgba(148,163,184,0.06) 60px, rgba(148,163,184,0.06) 62px);
          animation: tornado-run-speed-scroll 0.2s linear infinite;
          pointer-events: none;
        }

        @keyframes tornado-run-speed-scroll {
          from { transform: translateY(0); }
          to { transform: translateY(62px); }
        }

        .tornado-run-fever-overlay {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at center bottom, rgba(249,115,22,0.08) 0%, transparent 70%);
          pointer-events: none;
          animation: tornado-run-fever-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes tornado-run-fever-pulse {
          from { opacity: 0.3; }
          to { opacity: 1; }
        }

        /* --- Player --- */
        .tornado-run-player {
          position: absolute;
          z-index: 5;
          transition: left 0.1s ease-out;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));
        }

        .tornado-run-player.shielded {
          filter: drop-shadow(0 0 14px rgba(34,211,238,0.8)) drop-shadow(0 4px 8px rgba(0,0,0,0.6));
        }

        .tornado-run-player.shielded::after {
          content: '';
          position: absolute;
          inset: -8px;
          border-radius: 50%;
          border: 2px solid rgba(34,211,238,0.6);
          animation: tornado-run-shield-pulse 0.6s ease-in-out infinite alternate;
        }

        .tornado-run-player.jumping {
          animation: tornado-run-jump-bounce 0.4s ease-out;
          filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4)) brightness(1.2);
        }

        @keyframes tornado-run-jump-bounce {
          0% { transform: translateY(0) scale(1); }
          30% { transform: translateY(-30px) scale(1.15); }
          60% { transform: translateY(-20px) scale(1.1); }
          100% { transform: translateY(0) scale(1); }
        }

        .tornado-run-player-img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          pointer-events: none;
        }

        .tornado-run-magnet-aura {
          position: absolute;
          inset: -20px;
          border-radius: 50%;
          border: 2px dashed rgba(244,114,182,0.4);
          animation: tornado-run-magnet-spin 2s linear infinite;
          pointer-events: none;
        }

        @keyframes tornado-run-magnet-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        /* --- Tornado --- */
        .tornado-run-tornado {
          position: absolute;
          z-index: 3;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .tornado-run-tornado-inner {
          width: 85%;
          height: 85%;
          border-radius: 50%;
          background: radial-gradient(circle, #94a3b8 0%, #64748b 40%, #475569 70%, transparent 100%);
          border: 2px solid rgba(148,163,184,0.6);
          animation: tornado-run-spin 0.5s linear infinite;
          box-shadow: 0 0 14px rgba(148,163,184,0.6), inset 0 0 8px rgba(15,23,42,0.5);
        }

        @keyframes tornado-run-spin {
          from { transform: rotate(0deg) scale(1); }
          50% { transform: rotate(180deg) scale(1.12); }
          to { transform: rotate(360deg) scale(1); }
        }

        /* --- Lightning --- */
        .tornado-run-lightning-warn {
          position: absolute;
          z-index: 4;
          border-radius: 50%;
          background: rgba(250,204,21,0.15);
          border: 2px dashed rgba(250,204,21,0.5);
          animation: tornado-run-warn-pulse 0.15s linear infinite alternate;
        }

        @keyframes tornado-run-warn-pulse {
          from { opacity: 0.3; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1.1); }
        }

        .tornado-run-lightning {
          position: absolute;
          z-index: 4;
          border-radius: 4px;
          background: radial-gradient(circle, #fde68a, #facc15, #eab308);
          border: 2px solid #fbbf24;
          box-shadow: 0 0 20px rgba(250,204,21,0.8), 0 0 40px rgba(250,204,21,0.4);
          animation: tornado-run-lightning-flash 0.08s linear infinite alternate;
        }

        @keyframes tornado-run-lightning-flash {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }

        /* --- Coin --- */
        .tornado-run-coin {
          position: absolute;
          z-index: 3;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #fde68a, #f59e0b, #d97706);
          border: 2px solid #fbbf24;
          box-shadow: 0 0 10px rgba(251,191,36,0.6);
          animation: tornado-run-coin-pulse 0.8s ease-in-out infinite alternate;
        }

        .tornado-run-coin-magnetic {
          box-shadow: 0 0 16px rgba(244,114,182,0.6), 0 0 8px rgba(251,191,36,0.4);
        }

        @keyframes tornado-run-coin-pulse {
          from { box-shadow: 0 0 6px rgba(251,191,36,0.4); transform: scale(1); }
          to { box-shadow: 0 0 16px rgba(251,191,36,0.8); transform: scale(1.08); }
        }

        /* --- Items --- */
        .tornado-run-shield-item {
          position: absolute;
          z-index: 3;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #67e8f9, #22d3ee, #06b6d4);
          border: 2px solid #22d3ee;
          box-shadow: 0 0 14px rgba(34,211,238,0.7);
          animation: tornado-run-item-float 0.6s ease-in-out infinite alternate;
        }

        .tornado-run-score-zone {
          position: absolute;
          z-index: 3;
          border-radius: 6px;
          background: radial-gradient(circle at 35% 35%, #ddd6fe, #a78bfa, #7c3aed);
          border: 2px solid #a78bfa;
          box-shadow: 0 0 14px rgba(167,139,250,0.7);
          animation: tornado-run-item-float 0.7s ease-in-out infinite alternate;
        }

        .tornado-run-magnet-item {
          position: absolute;
          z-index: 3;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #fbcfe8, #f472b6, #ec4899);
          border: 2px solid #f472b6;
          box-shadow: 0 0 14px rgba(244,114,182,0.7);
          animation: tornado-run-item-float 0.5s ease-in-out infinite alternate;
        }

        .tornado-run-jump-item {
          position: absolute;
          z-index: 3;
          border-radius: 50%;
          background: radial-gradient(circle at 35% 35%, #a7f3d0, #34d399, #059669);
          border: 2px solid #34d399;
          box-shadow: 0 0 14px rgba(52,211,153,0.7);
          animation: tornado-run-item-float 0.5s ease-in-out infinite alternate;
        }

        @keyframes tornado-run-item-float {
          from { transform: scale(1) translateY(0); }
          to { transform: scale(1.1) translateY(-3px); }
        }

        @keyframes tornado-run-shield-pulse {
          from { opacity: 0.4; transform: scale(1); }
          to { opacity: 0.8; transform: scale(1.05); }
        }

        /* --- Game Over --- */
        .tornado-run-gameover-overlay {
          position: absolute;
          inset: 0;
          z-index: 20;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(15,23,42,0.85);
          backdrop-filter: blur(6px);
          animation: tornado-run-gameover-fade 0.3s ease-out;
        }

        @keyframes tornado-run-gameover-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .tornado-run-gameover-text {
          font-size: 2.5rem;
          font-weight: 900;
          color: #ef4444;
          text-shadow: 0 0 20px rgba(239,68,68,0.7), 0 4px 8px rgba(0,0,0,0.5);
          margin: 0 0 8px;
          animation: tornado-run-gameover-zoom 0.4s ease-out;
        }

        @keyframes tornado-run-gameover-zoom {
          from { transform: scale(2); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .tornado-run-gameover-score {
          font-size: 1.5rem;
          font-weight: 700;
          color: #fbbf24;
          margin: 0 0 6px;
        }

        .tornado-run-gameover-stats {
          font-size: 0.85rem;
          color: #94a3b8;
          margin: 0;
        }

        /* --- Controls --- */
        .tornado-run-controls {
          display: flex;
          gap: 12px;
          padding: 8px 16px 12px;
          z-index: 10;
          flex-shrink: 0;
        }

        .tornado-run-btn {
          flex: 1;
          height: 54px;
          border: 2px solid #475569;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(71,85,105,0.9) 0%, rgba(30,41,59,0.95) 100%);
          color: #e2e8f0;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 1.5px;
          cursor: pointer;
          box-shadow: 0 4px 0 #0f172a, 0 6px 12px rgba(0,0,0,0.4);
          transition: transform 0.06s, box-shadow 0.06s;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }

        .tornado-run-btn:active {
          transform: translateY(3px);
          box-shadow: 0 1px 0 #0f172a, 0 2px 4px rgba(0,0,0,0.3);
          background: linear-gradient(180deg, rgba(100,116,139,1) 0%, rgba(51,65,85,1) 100%);
        }

        .tornado-run-btn-arrow {
          font-size: 12px;
          opacity: 0.7;
        }

        @keyframes tornado-run-fever-flash {
          from { opacity: 0.6; }
          to { opacity: 1; }
        }

        @keyframes tornado-run-jump-flash {
          from { transform: scale(1.3); opacity: 0.5; }
          to { transform: scale(1); opacity: 1; }
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
