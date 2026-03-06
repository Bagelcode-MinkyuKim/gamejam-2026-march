import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
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
import windDashSfx from '../../../assets/sounds/tornado-wind-dash.mp3'
import slowmoSfx from '../../../assets/sounds/tornado-slowmo.mp3'
import windChainSfx from '../../../assets/sounds/tornado-wind-chain.mp3'
import coinRainSfx from '../../../assets/sounds/tornado-coin-rain.mp3'
import levelupSfx from '../../../assets/sounds/tornado-levelup.mp3'

// --- Layout ---
const LANE_COUNT = 3
const BOARD_WIDTH = 432
const LANE_WIDTH = BOARD_WIDTH / LANE_COUNT
const CHARACTER_SIZE = 60
const CHARACTER_BOTTOM = 80
const OBSTACLE_SIZE = 44
const COIN_SIZE = 28
const ITEM_SIZE = 30

// --- Balance ---
const START_SPEED = 180
const MAX_SPEED = 650
const ACCEL_PER_SECOND = 16
const COIN_SCORE = 10
const DISTANCE_SCORE_RATE = 2.5

const SPAWN_INTERVAL_BASE_MS = 900
const SPAWN_INTERVAL_MIN_MS = 300
const SPAWN_INTERVAL_ACCEL = 0.965

const COIN_SPAWN_CHANCE = 0.52
const TORNADO_SPAWN_CHANCE = 0.7

const HITBOX_SHRINK = 8
const GAME_TIMEOUT_MS = 120000

// --- Power-ups ---
const SHIELD_SPAWN_CHANCE = 0.07
const SHIELD_DURATION_MS = 4500
const SCORE_ZONE_SPAWN_CHANCE = 0.05
const SCORE_ZONE_MULTIPLIER = 3
const SCORE_ZONE_DURATION_MS = 5000
const MAGNET_SPAWN_CHANCE = 0.05
const MAGNET_DURATION_MS = 5000
const MAGNET_PULL_RANGE = 180
const SLOWMO_SPAWN_CHANCE = 0.04
const SLOWMO_DURATION_MS = 3000
const SLOWMO_FACTOR = 0.4

// --- Fever & Combos ---
const FEVER_COIN_THRESHOLD = 10
const FEVER_DURATION_MS = 6000
const FEVER_MULTIPLIER = 2
const DODGE_COMBO_DISTANCE = 55
const DODGE_COMBO_BONUS = 3
const WIND_CHAIN_THRESHOLD = 5 // consecutive dodges to trigger wind storm
const WIND_STORM_SCORE = 50

// --- Dash ---
const DASH_COOLDOWN_MS = 2500
const DASH_DURATION_MS = 300
const DASH_INVINCIBLE = true

// --- Level system ---
const LEVEL_DISTANCE = 50 // every 50m = level up
const MULTI_TORNADO_LEVEL = 3 // level 3+ spawns multi
const DARK_CLOUD_LEVEL = 4
const LIGHTNING_LEVEL = 5

// --- Obstacle types ---
type ObstacleType = 'whirlwind' | 'gust' | 'dark_cloud' | 'lightning_warn' | 'lightning' | 'coin' | 'shield' | 'score_zone' | 'magnet' | 'slowmo'

interface Obstacle {
  readonly id: number
  readonly lane: number
  y: number
  readonly type: ObstacleType
  readonly spawnTime: number
}

const CHARACTER_SPRITES = [parkSangminSprite, kimYeonjaSprite, seoTaijiSprite]

// --- Pixel art emoji rendering ---
const OBSTACLE_EMOJI: Record<string, string> = {
  whirlwind: '\uD83C\uDF00', // cyclone
  gust: '\uD83D\uDCA8', // wind
  dark_cloud: '\u2601\uFE0F', // cloud
  lightning_warn: '\u26A0\uFE0F', // warning
  lightning: '\u26A1', // lightning
  coin: '\uD83E\uDE99', // coin
  shield: '\uD83D\uDEE1\uFE0F', // shield
  score_zone: '\u2B50', // star
  magnet: '\uD83E\uDDF2', // magnet
  slowmo: '\u23F3', // hourglass
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
  if (type === 'whirlwind' || type === 'lightning') return OBSTACLE_SIZE
  if (type === 'dark_cloud') return OBSTACLE_SIZE + 16
  if (type === 'gust') return OBSTACLE_SIZE - 6
  if (type === 'coin') return COIN_SIZE
  return ITEM_SIZE
}

function TornadoRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects({ maxParticles: 60 })
  const containerRef = useRef<HTMLDivElement>(null)

  // State
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
  const [hasSlowmo, setHasSlowmo] = useState(false)
  const [slowmoRemainingMs, setSlowmoRemainingMs] = useState(0)
  const [isDashing, setIsDashing] = useState(false)
  const [dashCooldown, setDashCooldown] = useState(0)
  const [level, setLevel] = useState(1)
  const [boardHeight, setBoardHeight] = useState(680)
  const [windStormActive, setWindStormActive] = useState(false)
  const [characterIdx, setCharacterIdx] = useState(0)
  const [screenShakeClass, setScreenShakeClass] = useState('')

  // Refs
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
  const nextIdRef = useRef(0)
  const spawnTimerRef = useRef(0)
  const spawnIntervalRef = useRef(SPAWN_INTERVAL_BASE_MS)
  const hasShieldRef = useRef(false)
  const shieldMsRef = useRef(0)
  const hasScoreZoneRef = useRef(false)
  const scoreZoneMsRef = useRef(0)
  const dodgeComboRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const hasMagnetRef = useRef(false)
  const magnetMsRef = useRef(0)
  const hasSlowmoRef = useRef(false)
  const slowmoMsRef = useRef(0)
  const isDashingRef = useRef(false)
  const dashTimerRef = useRef(0)
  const dashCooldownRef = useRef(0)
  const levelRef = useRef(1)
  const windChainRef = useRef(0)

  const sfxRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastTapRef = useRef(0)

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
    onFinish({ score: finalScore, durationMs: Math.max(1, Math.round(elapsedMsRef.current)) })
  }, [onFinish])

  const triggerDash = useCallback(() => {
    if (finishedRef.current || isDashingRef.current || dashCooldownRef.current > 0) return
    isDashingRef.current = true
    dashTimerRef.current = DASH_DURATION_MS
    dashCooldownRef.current = DASH_COOLDOWN_MS
    setIsDashing(true)
    playSfx('windDash', 0.5, 1.1)
    effects.triggerFlash('rgba(34,211,238,0.3)')
  }, [playSfx, effects])

  const triggerWindStorm = useCallback(() => {
    setWindStormActive(true)
    playSfx('windChain', 0.6, 1)
    effects.triggerShake(12)
    effects.triggerFlash('rgba(59,130,246,0.5)')

    // Destroy all obstacles, give score
    const destroyed = obstaclesRef.current.filter(o => o.type === 'whirlwind' || o.type === 'gust' || o.type === 'dark_cloud' || o.type === 'lightning')
    scoreRef.current += WIND_STORM_SCORE * destroyed.length
    setScore(scoreRef.current)
    obstaclesRef.current = obstaclesRef.current.filter(o => o.type === 'coin' || o.type === 'shield' || o.type === 'score_zone' || o.type === 'magnet' || o.type === 'slowmo')

    for (const o of destroyed) {
      effects.comboHitBurst(laneToX(o.lane), o.y, destroyed.length, WIND_STORM_SCORE)
    }

    setTimeout(() => setWindStormActive(false), 800)
  }, [playSfx, effects])

  const changeLane = useCallback((direction: -1 | 1) => {
    if (finishedRef.current) return
    const next = clampLane(laneRef.current + direction)
    if (next !== laneRef.current) {
      laneRef.current = next
      setCurrentLane(next)
      playSfx('lane', 0.3, 1)
    }
  }, [playSfx])

  // Measure height
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setBoardHeight(Math.max(400, containerRef.current.clientHeight - 160))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // Audio setup
  useEffect(() => {
    const sfxMap: Record<string, string> = {
      lane: laneChangeSfx, coin: coinCollectSfx, crash: crashSfx,
      shield: shieldSfx, fever: feverSfx, dodge: dodgeSfx,
      shieldBreak: shieldBreakSfx, magnet: magnetSfx, speedUp: speedUpSfx,
      windDash: windDashSfx, slowmo: slowmoSfx, windChain: windChainSfx,
      coinRain: coinRainSfx, levelup: levelupSfx,
    }
    const audios: HTMLAudioElement[] = []
    for (const [key, src] of Object.entries(sfxMap)) {
      const a = new Audio(src)
      a.preload = 'auto'
      sfxRefs.current[key] = a
      audios.push(a)
    }
    setCharacterIdx(Math.floor(Math.random() * CHARACTER_SPRITES.length))
    return () => { for (const a of audios) { a.pause(); a.currentTime = 0 }; effects.cleanup() }
  }, [])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.code === 'ArrowLeft') { e.preventDefault(); changeLane(-1) }
      else if (e.code === 'ArrowRight') { e.preventDefault(); changeLane(1) }
      else if (e.code === 'ArrowUp' || e.code === 'Space') { e.preventDefault(); triggerDash() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [changeLane, onExit, triggerDash])

  // Game loop
  useEffect(() => {
    lastFrameRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animFrameRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now

      let deltaMs = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now

      // Slowmo effect
      const timeScale = hasSlowmoRef.current ? SLOWMO_FACTOR : 1
      const gameDelta = deltaMs * timeScale
      elapsedMsRef.current += deltaMs // real time for timeout
      setElapsedMs(elapsedMsRef.current)

      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) { finishRound(); return }

      // Timer updates (all use gameDelta except timeout)
      const updateTimer = (hasRef: { current: boolean }, msRef: { current: number }, setHas: (v: boolean) => void, setMs: (v: number) => void) => {
        if (hasRef.current) {
          msRef.current = Math.max(0, msRef.current - deltaMs) // real time for UI
          setMs(msRef.current)
          if (msRef.current <= 0) { hasRef.current = false; setHas(false) }
        }
      }

      updateTimer(hasShieldRef, shieldMsRef, setHasShield, setShieldRemainingMs)
      updateTimer(hasScoreZoneRef, scoreZoneMsRef, setHasScoreZone, setScoreZoneRemainingMs)
      updateTimer(isFeverRef, feverMsRef, setIsFever, setFeverRemainingMs)
      updateTimer(hasMagnetRef, magnetMsRef, setHasMagnet, setMagnetRemainingMs)
      updateTimer(hasSlowmoRef, slowmoMsRef, setHasSlowmo, setSlowmoRemainingMs)

      if (isDashingRef.current) {
        dashTimerRef.current = Math.max(0, dashTimerRef.current - deltaMs)
        if (dashTimerRef.current <= 0) { isDashingRef.current = false; setIsDashing(false) }
      }
      if (dashCooldownRef.current > 0) {
        dashCooldownRef.current = Math.max(0, dashCooldownRef.current - deltaMs)
        setDashCooldown(dashCooldownRef.current)
      }

      const elapsedSeconds = elapsedMsRef.current / 1000
      const currentSpeed = Math.min(MAX_SPEED, START_SPEED + elapsedSeconds * ACCEL_PER_SECOND)
      speedRef.current = currentSpeed
      setSpeed(currentSpeed)

      const movedPx = currentSpeed * (gameDelta / 1000)
      distanceRef.current += movedPx / 100
      setDistance(distanceRef.current)

      // Level up
      const newLevel = Math.floor(distanceRef.current / LEVEL_DISTANCE) + 1
      if (newLevel > levelRef.current) {
        levelRef.current = newLevel
        setLevel(newLevel)
        playSfx('levelup', 0.5, 1 + newLevel * 0.05)
        effects.triggerFlash('rgba(250,204,21,0.3)')

        // Level up bonus: change character
        setCharacterIdx(prev => (prev + 1) % CHARACTER_SPRITES.length)
      }

      // Spawn
      spawnTimerRef.current += gameDelta
      spawnIntervalRef.current = Math.max(SPAWN_INTERVAL_MIN_MS, spawnIntervalRef.current * SPAWN_INTERVAL_ACCEL)

      let nextObstacles = [...obstaclesRef.current]
      const bh = boardHeight
      const nowMs = elapsedMsRef.current
      const curLevel = levelRef.current

      if (spawnTimerRef.current >= spawnIntervalRef.current) {
        spawnTimerRef.current = 0

        // Main obstacle
        if (Math.random() < TORNADO_SPAWN_CHANCE) {
          const lane = Math.floor(Math.random() * LANE_COUNT)
          const roll = Math.random()

          // Variety based on level
          let type: ObstacleType = 'whirlwind'
          if (curLevel >= LIGHTNING_LEVEL && roll < 0.12) {
            // Lightning: spawn warning first
            nextObstacles.push({ id: nextIdRef.current++, lane, y: bh - CHARACTER_BOTTOM - 40, type: 'lightning_warn', spawnTime: nowMs })
          } else if (curLevel >= DARK_CLOUD_LEVEL && roll < 0.25) {
            type = 'dark_cloud'
            nextObstacles.push({ id: nextIdRef.current++, lane, y: -getObstacleSize('dark_cloud'), type, spawnTime: nowMs })
          } else if (roll < 0.4) {
            type = 'gust'
            nextObstacles.push({ id: nextIdRef.current++, lane, y: -getObstacleSize('gust'), type, spawnTime: nowMs })
          } else {
            nextObstacles.push({ id: nextIdRef.current++, lane, y: -OBSTACLE_SIZE, type: 'whirlwind', spawnTime: nowMs })
          }

          // Multi at higher levels
          if (curLevel >= MULTI_TORNADO_LEVEL && Math.random() < 0.3) {
            let lane2 = Math.floor(Math.random() * LANE_COUNT)
            if (lane2 === lane) lane2 = (lane + 1) % LANE_COUNT
            nextObstacles.push({ id: nextIdRef.current++, lane: lane2, y: -OBSTACLE_SIZE - 30, type: 'whirlwind', spawnTime: nowMs })
          }
        }

        // Coins — fever mode: coin rain on all lanes
        if (isFeverRef.current && Math.random() < 0.8) {
          for (let l = 0; l < LANE_COUNT; l++) {
            nextObstacles.push({ id: nextIdRef.current++, lane: l, y: -COIN_SIZE - l * 20, type: 'coin', spawnTime: nowMs })
          }
        } else if (Math.random() < COIN_SPAWN_CHANCE) {
          const coinLane = Math.floor(Math.random() * LANE_COUNT)
          const blocked = nextObstacles.some(o => (o.type === 'whirlwind' || o.type === 'gust' || o.type === 'dark_cloud') && o.lane === coinLane && o.y < OBSTACLE_SIZE * 2)
          if (!blocked) nextObstacles.push({ id: nextIdRef.current++, lane: coinLane, y: -COIN_SIZE, type: 'coin', spawnTime: nowMs })
        }

        // Items
        if (Math.random() < SHIELD_SPAWN_CHANCE && !hasShieldRef.current)
          nextObstacles.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'shield', spawnTime: nowMs })
        if (Math.random() < SCORE_ZONE_SPAWN_CHANCE && !hasScoreZoneRef.current)
          nextObstacles.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'score_zone', spawnTime: nowMs })
        if (Math.random() < MAGNET_SPAWN_CHANCE && !hasMagnetRef.current)
          nextObstacles.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'magnet', spawnTime: nowMs })
        if (Math.random() < SLOWMO_SPAWN_CHANCE && !hasSlowmoRef.current)
          nextObstacles.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_SIZE, type: 'slowmo', spawnTime: nowMs })
      }

      // Convert lightning warnings
      nextObstacles = nextObstacles.map(o => {
        if (o.type === 'lightning_warn' && (nowMs - o.spawnTime) >= 600) return { ...o, type: 'lightning' as ObstacleType }
        return o
      })

      // Move obstacles
      const playerCX = laneToX(laneRef.current)
      nextObstacles = nextObstacles.map(o => {
        if (o.type === 'lightning_warn' || o.type === 'lightning') return o

        // Gust moves faster
        const speedMult = o.type === 'gust' ? 1.6 : o.type === 'dark_cloud' ? 0.7 : 1

        // Magnet pull
        if (o.type === 'coin' && hasMagnetRef.current) {
          const coinCX = laneToX(o.lane)
          const playerY = bh - CHARACTER_BOTTOM - CHARACTER_SIZE / 2
          const dx = playerCX - coinCX
          const dy = playerY - o.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAGNET_PULL_RANGE && dist > 5) {
            const pull = 4 * (gameDelta / 16.66)
            return { ...o, y: o.y + movedPx * speedMult + (dy / dist) * pull }
          }
        }
        return { ...o, y: o.y + movedPx * speedMult }
      })

      // Collision
      const playerX = laneToX(laneRef.current) - CHARACTER_SIZE / 2 + HITBOX_SHRINK
      const playerY = bh - CHARACTER_BOTTOM - CHARACTER_SIZE + HITBOX_SHRINK
      const playerW = CHARACTER_SIZE - HITBOX_SHRINK * 2
      const playerH = CHARACTER_SIZE - HITBOX_SHRINK * 2

      let hitObstacle = false
      const surviving: Obstacle[] = []
      let dodgedThisFrame = false

      for (const o of nextObstacles) {
        const oSize = getObstacleSize(o.type)
        const ox = laneToX(o.lane) - oSize / 2

        // Remove expired lightning
        if ((o.type === 'lightning_warn' || o.type === 'lightning') && (nowMs - o.spawnTime) > 1100) continue

        const collides = rectsOverlap(playerX, playerY, playerW, playerH, ox, o.y, oSize, oSize)

        if (collides) {
          if (o.type === 'coin') {
            const mult = (isFeverRef.current ? FEVER_MULTIPLIER : 1) * (hasScoreZoneRef.current ? SCORE_ZONE_MULTIPLIER : 1)
            const pts = COIN_SCORE * mult
            scoreRef.current += pts
            coinCountRef.current += 1
            setScore(scoreRef.current); setCoinCount(coinCountRef.current)
            playSfx('coin', 0.45, 1 + coinCountRef.current * 0.015)
            effects.comboHitBurst(laneToX(o.lane), o.y, coinCountRef.current, pts)
            // Fever activation
            if (coinCountRef.current % FEVER_COIN_THRESHOLD === 0 && !isFeverRef.current) {
              isFeverRef.current = true; feverMsRef.current = FEVER_DURATION_MS
              setIsFever(true); setFeverRemainingMs(FEVER_DURATION_MS)
              playSfx('fever', 0.6, 1)
              playSfx('coinRain', 0.4, 1)
              effects.triggerFlash('rgba(249,115,22,0.4)')
            }
            continue
          }
          if (o.type === 'shield') {
            hasShieldRef.current = true; shieldMsRef.current = SHIELD_DURATION_MS
            setHasShield(true); setShieldRemainingMs(SHIELD_DURATION_MS)
            playSfx('shield', 0.5, 1)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0); continue
          }
          if (o.type === 'score_zone') {
            hasScoreZoneRef.current = true; scoreZoneMsRef.current = SCORE_ZONE_DURATION_MS
            setHasScoreZone(true); setScoreZoneRemainingMs(SCORE_ZONE_DURATION_MS)
            playSfx('coin', 0.5, 1.3)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0); continue
          }
          if (o.type === 'magnet') {
            hasMagnetRef.current = true; magnetMsRef.current = MAGNET_DURATION_MS
            setHasMagnet(true); setMagnetRemainingMs(MAGNET_DURATION_MS)
            playSfx('magnet', 0.5, 1)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0); continue
          }
          if (o.type === 'slowmo') {
            hasSlowmoRef.current = true; slowmoMsRef.current = SLOWMO_DURATION_MS
            setHasSlowmo(true); setSlowmoRemainingMs(SLOWMO_DURATION_MS)
            playSfx('slowmo', 0.5, 1)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 0); continue
          }
          if (o.type === 'lightning_warn') { surviving.push(o); continue }

          // Obstacle hit (whirlwind, gust, dark_cloud, lightning)
          if (isDashingRef.current && DASH_INVINCIBLE) {
            // Dash destroys obstacle!
            scoreRef.current += 25
            setScore(scoreRef.current)
            effects.comboHitBurst(laneToX(o.lane), o.y, 1, 25)
            playSfx('shieldBreak', 0.4, 1.2)
            continue
          }
          if (hasShieldRef.current) {
            hasShieldRef.current = false; shieldMsRef.current = 0
            setHasShield(false); setShieldRemainingMs(0)
            playSfx('shieldBreak', 0.5, 0.9)
            effects.triggerFlash('rgba(34,211,238,0.4)')
            continue
          }
          hitObstacle = true; break
        }

        // Near-miss dodge
        if ((o.type === 'whirlwind' || o.type === 'gust' || o.type === 'dark_cloud' || o.type === 'lightning') && o.y > playerY && o.y < playerY + DODGE_COMBO_DISTANCE) {
          const oLaneX = laneToX(o.lane)
          if (Math.abs(oLaneX - playerCX) < LANE_WIDTH * 1.2 && Math.abs(oLaneX - playerCX) > HITBOX_SHRINK) {
            dodgedThisFrame = true
          }
        }

        if (o.y < bh + 60) surviving.push(o)
      }

      if (dodgedThisFrame) {
        dodgeComboRef.current += 1
        windChainRef.current += 1
        setDodgeCombo(dodgeComboRef.current)
        playSfx('dodge', 0.25, 1 + dodgeComboRef.current * 0.04)

        if (dodgeComboRef.current % 3 === 0) {
          const bonus = DODGE_COMBO_BONUS * dodgeComboRef.current
          scoreRef.current += bonus; setScore(scoreRef.current)
          effects.comboHitBurst(playerCX, playerY - 20, dodgeComboRef.current, bonus)
        }

        // Wind chain → wind storm
        if (windChainRef.current >= WIND_CHAIN_THRESHOLD) {
          windChainRef.current = 0
          triggerWindStorm()
        }
      }

      if (hitObstacle) {
        playSfx('crash', 0.7, 0.85)
        effects.triggerShake(12)
        effects.triggerFlash('rgba(239,68,68,0.6)')
        setScreenShakeClass('tornado-run-death-shake')
        setTimeout(() => setScreenShakeClass(''), 500)
        obstaclesRef.current = nextObstacles; setObstacles(nextObstacles)
        finishRound(); return
      }

      obstaclesRef.current = surviving; setObstacles(surviving)
      effects.updateParticles()
      animFrameRef.current = window.requestAnimationFrame(step)
    }

    animFrameRef.current = window.requestAnimationFrame(step)
    return () => { if (animFrameRef.current !== null) { window.cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }; lastFrameRef.current = null }
  }, [finishRound, playSfx, boardHeight, triggerWindStorm])

  // Touch handling with double-tap for dash
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      const now = Date.now()
      const t = e.touches[0]
      touchStartRef.current = { x: t.clientX, y: t.clientY, t: now }

      // Double-tap detection
      if (now - lastTapRef.current < 300) {
        triggerDash()
        lastTapRef.current = 0
      } else {
        lastTapRef.current = now
      }
    }
  }, [triggerDash])

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
      className={`mini-game-panel tornado-run-panel ${screenShakeClass} ${hasSlowmo ? 'tornado-run-slowmo-active' : ''}`}
      aria-label="tornado-run-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Wind storm full-screen effect */}
      {windStormActive && <div className="tornado-run-wind-storm-overlay" />}

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
            <div className="tornado-run-avatar-wrap">
              <img src={CHARACTER_SPRITES[characterIdx]} alt="" className="tornado-run-hud-avatar" />
              <span className="tornado-run-level-badge">Lv.{level}</span>
            </div>
            <div className="tornado-run-hud-scores">
              <div className="tornado-run-score-value">{totalScore}</div>
              <div className="tornado-run-best-row">
                <span className="tornado-run-best-label">BEST {displayedBestScore}</span>
                <span className="tornado-run-timer">{timeLeft}s</span>
              </div>
            </div>
            {/* Dash button */}
            <button
              className={`tornado-run-dash-btn ${dashCooldown > 0 ? 'on-cooldown' : ''} ${isDashing ? 'dashing' : ''}`}
              type="button"
              onPointerDown={(e) => { e.stopPropagation(); triggerDash() }}
            >
              {isDashing ? '\uD83C\uDF00' : dashCooldown > 0 ? `${(dashCooldown/1000).toFixed(1)}` : '\uD83D\uDCA8'}
            </button>
          </div>

          {/* Power-up bar */}
          <div className="tornado-run-powerups">
            {hasShield && <span className="pw pw-shield">\uD83D\uDEE1\uFE0F {(shieldRemainingMs/1000).toFixed(1)}</span>}
            {hasScoreZone && <span className="pw pw-zone">\u2B50x{SCORE_ZONE_MULTIPLIER} {(scoreZoneRemainingMs/1000).toFixed(1)}</span>}
            {isFever && <span className="pw pw-fever">\uD83D\uDD25FEVER {(feverRemainingMs/1000).toFixed(1)}</span>}
            {hasMagnet && <span className="pw pw-magnet">\uD83E\uDDF2 {(magnetRemainingMs/1000).toFixed(1)}</span>}
            {hasSlowmo && <span className="pw pw-slow">\u23F3SLOW {(slowmoRemainingMs/1000).toFixed(1)}</span>}
            {dodgeCombo >= 3 && <span className="pw pw-dodge">\uD83C\uDF2C\uFE0Fx{dodgeCombo}</span>}
          </div>
        </div>

        {/* Game field */}
        <div className="tornado-run-field" style={{ width: BOARD_WIDTH, height: boardHeight }}>
          {/* Pixel-art sky background layers */}
          <div className="tornado-run-sky" />
          <div className="tornado-run-clouds" style={{ transform: `translateX(${-(elapsedMs / 80) % 200}px)` }} />
          <div className="tornado-run-ground-scroll" style={{ backgroundPositionY: `${(elapsedMs * speed) / 3000 % 48}px` }} />

          {/* Lane dividers */}
          {Array.from({ length: LANE_COUNT - 1 }, (_, i) => (
            <div key={`ld-${i}`} className="tornado-run-lane-div" style={{ left: (i + 1) * LANE_WIDTH }} />
          ))}

          {/* Speed lines */}
          {speed > 350 && <div className="tornado-run-speed-lines" style={{ opacity: Math.min(1, (speed - 350) / 200) }} />}

          {/* Fever rain overlay */}
          {isFever && <div className="tornado-run-fever-overlay" />}

          {/* Obstacles */}
          {obstacles.map(o => {
            const cx = laneToX(o.lane)
            const oSize = getObstacleSize(o.type)
            const emoji = OBSTACLE_EMOJI[o.type] ?? '\u2753'

            if (o.type === 'lightning_warn') {
              return <div key={o.id} className="tr-obs tr-lightning-warn" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }}><span className="tr-emoji">{emoji}</span></div>
            }
            if (o.type === 'lightning') {
              return <div key={o.id} className="tr-obs tr-lightning" style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }}><span className="tr-emoji">{emoji}</span></div>
            }

            const typeClass = `tr-${o.type.replace('_', '-')}`
            return (
              <div key={o.id} className={`tr-obs ${typeClass} ${o.type === 'coin' && hasMagnet ? 'tr-magnetic' : ''}`} style={{ left: cx - oSize / 2, top: o.y, width: oSize, height: oSize }}>
                <span className="tr-emoji">{emoji}</span>
              </div>
            )
          })}

          {/* Player */}
          <div
            className={`tornado-run-player ${hasShield ? 'shielded' : ''} ${isDashing ? 'dashing' : ''}`}
            style={{ left: laneToX(currentLane) - CHARACTER_SIZE / 2, bottom: CHARACTER_BOTTOM, width: CHARACTER_SIZE, height: CHARACTER_SIZE }}
          >
            <img src={CHARACTER_SPRITES[characterIdx]} alt="player" className="tornado-run-player-img" draggable={false} />
            {hasMagnet && <div className="tornado-run-magnet-aura" />}
            {isDashing && <div className="tornado-run-dash-trail" />}
          </div>

          {/* Game over */}
          {gameOver && (
            <div className="tornado-run-gameover">
              <div className="tornado-run-go-text">GAME OVER</div>
              <div className="tornado-run-go-score">{totalScore}</div>
              <div className="tornado-run-go-stats">
                \uD83E\uDE99{coinCount} | {distance.toFixed(0)}m | Lv.{level} | \uD83C\uDF2C\uFE0Fx{dodgeCombo}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="tornado-run-controls">
          <button className="tornado-run-btn" type="button" onPointerDown={e => { e.stopPropagation(); changeLane(-1) }}>
            \u25C0 LEFT
          </button>
          <button className="tornado-run-btn" type="button" onPointerDown={e => { e.stopPropagation(); changeLane(1) }}>
            RIGHT \u25B6
          </button>
        </div>
      </div>

      <style>{`
        .tornado-run-panel {
          display: flex; flex-direction: column; width: 100%; height: 100%;
          background: #1a1a2e;
          color: #e2e8f0;
          font-family: 'Press Start 2P', 'Courier New', monospace;
          overflow: hidden; user-select: none; touch-action: none;
          image-rendering: pixelated;
        }

        .tornado-run-slowmo-active { filter: saturate(0.7) brightness(1.1); }

        .tornado-run-board { display: flex; flex-direction: column; width: 100%; height: 100%; position: relative; }

        /* HUD */
        .tornado-run-hud { padding: 6px 10px 3px; z-index: 10; flex-shrink: 0; background: rgba(0,0,0,0.3); }
        .tornado-run-hud-main { display: flex; align-items: center; gap: 8px; }

        .tornado-run-avatar-wrap { position: relative; flex-shrink: 0; }
        .tornado-run-hud-avatar {
          width: 42px; height: 42px; border-radius: 4px;
          border: 3px solid #4ade80; object-fit: cover;
          image-rendering: pixelated;
          box-shadow: 0 0 8px rgba(74,222,128,0.4);
        }
        .tornado-run-level-badge {
          position: absolute; bottom: -4px; right: -4px;
          background: #4ade80; color: #0f172a; font-size: 7px; font-weight: 900;
          padding: 1px 3px; border-radius: 2px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }

        .tornado-run-hud-scores { flex: 1; }
        .tornado-run-score-value {
          font-size: 1.8rem; font-weight: 900; color: #fbbf24;
          text-shadow: 2px 2px 0 #92400e, 0 0 10px rgba(251,191,36,0.5);
          line-height: 1; letter-spacing: -1px;
        }
        .tornado-run-best-row { display: flex; justify-content: space-between; margin-top: 2px; }
        .tornado-run-best-label { font-size: 8px; color: #94a3b8; }
        .tornado-run-timer { font-size: 10px; font-weight: 700; color: #e2e8f0; background: rgba(71,85,105,0.5); padding: 1px 6px; border-radius: 2px; }

        .tornado-run-dash-btn {
          width: 44px; height: 44px; border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #3b82f6 100%);
          border: 3px solid #1e3a5f; color: white;
          font-size: 20px; display: flex; align-items: center; justify-content: center;
          cursor: pointer; flex-shrink: 0;
          box-shadow: 0 3px 0 #0f172a, 0 0 12px rgba(34,211,238,0.4);
          transition: transform 0.08s;
        }
        .tornado-run-dash-btn.on-cooldown {
          background: #475569; color: #94a3b8; font-size: 10px;
          box-shadow: 0 2px 0 #0f172a;
        }
        .tornado-run-dash-btn.dashing {
          background: #fbbf24; transform: scale(1.1);
          animation: tr-dash-pulse 0.15s infinite alternate;
        }
        .tornado-run-dash-btn:active { transform: translateY(2px); }

        @keyframes tr-dash-pulse { from { box-shadow: 0 0 8px rgba(251,191,36,0.6); } to { box-shadow: 0 0 20px rgba(251,191,36,1); } }

        .tornado-run-powerups { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; min-height: 14px; }
        .pw {
          font-size: 8px; font-weight: 700; padding: 1px 5px; border-radius: 2px;
          border: 1px solid; letter-spacing: 0;
        }
        .pw-shield { color: #22d3ee; border-color: rgba(34,211,238,0.4); background: rgba(34,211,238,0.1); }
        .pw-zone { color: #fbbf24; border-color: rgba(251,191,36,0.4); background: rgba(251,191,36,0.1); }
        .pw-fever { color: #f97316; border-color: rgba(249,115,22,0.4); background: rgba(249,115,22,0.1); animation: tr-fever-flash 0.3s infinite alternate; }
        .pw-magnet { color: #f472b6; border-color: rgba(244,114,182,0.4); background: rgba(244,114,182,0.1); }
        .pw-slow { color: #a78bfa; border-color: rgba(167,139,250,0.4); background: rgba(167,139,250,0.1); }
        .pw-dodge { color: #4ade80; border-color: rgba(74,222,128,0.4); background: rgba(74,222,128,0.1); }

        @keyframes tr-fever-flash { from { opacity: 0.6; } to { opacity: 1; } }

        /* Field */
        .tornado-run-field {
          position: relative; overflow: hidden; flex: 1; margin: 0 auto;
          border-left: 3px solid #2d2d4e; border-right: 3px solid #2d2d4e;
        }

        .tornado-run-sky {
          position: absolute; inset: 0;
          background: linear-gradient(180deg,
            #0a0a23 0%, #16213e 25%, #1a1a3e 50%, #2a2a4e 75%, #3a3a5e 100%);
          pointer-events: none;
        }

        .tornado-run-clouds {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(90deg,
            transparent 0px, transparent 60px,
            rgba(148,163,184,0.04) 60px, rgba(148,163,184,0.04) 80px,
            transparent 80px, transparent 120px,
            rgba(100,116,139,0.03) 120px, rgba(100,116,139,0.03) 150px,
            transparent 150px, transparent 200px
          );
          pointer-events: none;
        }

        .tornado-run-ground-scroll {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(to bottom,
            transparent 0px, transparent 40px,
            rgba(100,116,139,0.06) 40px, rgba(100,116,139,0.06) 48px);
          pointer-events: none;
        }

        .tornado-run-lane-div {
          position: absolute; top: 0; bottom: 0; width: 2px;
          background: repeating-linear-gradient(to bottom,
            transparent 0px, transparent 16px,
            rgba(148,163,184,0.1) 16px, rgba(148,163,184,0.1) 32px);
          pointer-events: none;
        }

        .tornado-run-speed-lines {
          position: absolute; inset: 0;
          background: repeating-linear-gradient(to bottom,
            transparent 0, transparent 40px,
            rgba(200,220,255,0.04) 40px, rgba(200,220,255,0.04) 42px);
          animation: tr-speed-scroll 0.15s linear infinite;
          pointer-events: none;
        }

        @keyframes tr-speed-scroll { from { transform: translateY(0); } to { transform: translateY(42px); } }

        .tornado-run-fever-overlay {
          position: absolute; inset: 0;
          background: radial-gradient(ellipse at center bottom, rgba(249,115,22,0.1) 0%, transparent 70%);
          animation: tr-fever-glow 0.5s ease-in-out infinite alternate;
          pointer-events: none;
        }

        @keyframes tr-fever-glow { from { opacity: 0.3; } to { opacity: 1; } }

        /* Wind storm */
        .tornado-run-wind-storm-overlay {
          position: absolute; inset: 0; z-index: 15;
          background: radial-gradient(circle at center, rgba(59,130,246,0.3) 0%, rgba(34,211,238,0.2) 40%, transparent 70%);
          animation: tr-wind-storm 0.8s ease-out forwards;
          pointer-events: none;
        }

        @keyframes tr-wind-storm {
          0% { transform: scale(0); opacity: 0; }
          30% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(2); opacity: 0; }
        }

        /* Obstacles - pixel dot style */
        .tr-obs {
          position: absolute; z-index: 3;
          display: flex; align-items: center; justify-content: center;
          image-rendering: pixelated;
        }

        .tr-emoji { font-size: 28px; line-height: 1; filter: contrast(1.2); }

        .tr-whirlwind { animation: tr-spin 0.5s linear infinite; }
        .tr-gust { animation: tr-gust-wobble 0.3s ease-in-out infinite alternate; }
        .tr-gust .tr-emoji { font-size: 24px; }
        .tr-dark-cloud { animation: tr-cloud-pulse 0.8s ease-in-out infinite alternate; }
        .tr-dark-cloud .tr-emoji { font-size: 36px; }
        .tr-coin { animation: tr-coin-bounce 0.6s ease-in-out infinite alternate; }
        .tr-coin .tr-emoji { font-size: 22px; }
        .tr-magnetic { filter: drop-shadow(0 0 6px rgba(244,114,182,0.6)); }
        .tr-shield { animation: tr-item-float 0.5s ease-in-out infinite alternate; }
        .tr-score-zone { animation: tr-item-float 0.6s ease-in-out infinite alternate; }
        .tr-magnet { animation: tr-item-float 0.4s ease-in-out infinite alternate; }
        .tr-slowmo { animation: tr-slowmo-spin 1.5s linear infinite; }

        .tr-lightning-warn { animation: tr-warn-flash 0.12s linear infinite alternate; }
        .tr-lightning {
          background: radial-gradient(circle, rgba(250,204,21,0.3) 0%, transparent 70%);
          animation: tr-lightning-zap 0.06s linear infinite alternate;
        }
        .tr-lightning .tr-emoji { font-size: 36px; }

        @keyframes tr-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes tr-gust-wobble { from { transform: translateX(-3px) scale(0.95); } to { transform: translateX(3px) scale(1.05); } }
        @keyframes tr-cloud-pulse { from { transform: scale(1); opacity: 0.8; } to { transform: scale(1.1); opacity: 1; } }
        @keyframes tr-coin-bounce { from { transform: scale(1) translateY(0); } to { transform: scale(1.08) translateY(-2px); } }
        @keyframes tr-item-float { from { transform: translateY(0) scale(1); } to { transform: translateY(-4px) scale(1.1); } }
        @keyframes tr-slowmo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes tr-warn-flash { from { opacity: 0.3; transform: scale(0.85); } to { opacity: 1; transform: scale(1.15); } }
        @keyframes tr-lightning-zap { from { opacity: 0.6; } to { opacity: 1; } }

        /* Player */
        .tornado-run-player {
          position: absolute; z-index: 5;
          transition: left 0.1s ease-out;
          image-rendering: pixelated;
        }

        .tornado-run-player-img {
          width: 100%; height: 100%; object-fit: contain;
          pointer-events: none; image-rendering: pixelated;
          filter: drop-shadow(0 3px 6px rgba(0,0,0,0.6));
        }

        .tornado-run-player.shielded {
          filter: drop-shadow(0 0 12px rgba(34,211,238,0.8));
        }
        .tornado-run-player.shielded::after {
          content: ''; position: absolute; inset: -8px; border-radius: 50%;
          border: 3px solid rgba(34,211,238,0.5);
          animation: tr-shield-pulse 0.5s ease-in-out infinite alternate;
        }

        .tornado-run-player.dashing {
          animation: tr-dash-zoom 0.3s ease-out;
          filter: drop-shadow(0 0 16px rgba(34,211,238,0.9)) brightness(1.3);
        }

        .tornado-run-dash-trail {
          position: absolute; left: 10%; bottom: -8px; right: 10%; height: 20px;
          background: linear-gradient(transparent, rgba(34,211,238,0.4));
          border-radius: 50%; filter: blur(4px);
          animation: tr-trail-fade 0.3s ease-out;
          pointer-events: none;
        }

        @keyframes tr-dash-zoom { 0% { transform: translateY(10px) scale(0.9); } 50% { transform: translateY(-15px) scale(1.15); } 100% { transform: translateY(0) scale(1); } }
        @keyframes tr-trail-fade { from { opacity: 1; height: 30px; } to { opacity: 0.3; height: 10px; } }
        @keyframes tr-shield-pulse { from { opacity: 0.3; transform: scale(1); } to { opacity: 0.7; transform: scale(1.06); } }

        .tornado-run-magnet-aura {
          position: absolute; inset: -18px; border-radius: 50%;
          border: 2px dashed rgba(244,114,182,0.3);
          animation: tr-magnet-spin 2s linear infinite;
          pointer-events: none;
        }
        @keyframes tr-magnet-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        /* Game over */
        .tornado-run-gameover {
          position: absolute; inset: 0; z-index: 20;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          background: rgba(10,10,30,0.88); backdrop-filter: blur(4px);
          animation: tr-go-fade 0.3s ease-out;
        }
        .tornado-run-go-text {
          font-size: 2rem; font-weight: 900; color: #ef4444;
          text-shadow: 3px 3px 0 #7f1d1d, 0 0 20px rgba(239,68,68,0.6);
          animation: tr-go-zoom 0.4s ease-out;
        }
        .tornado-run-go-score {
          font-size: 2.5rem; font-weight: 900; color: #fbbf24;
          text-shadow: 3px 3px 0 #92400e;
          margin-top: 8px;
        }
        .tornado-run-go-stats { font-size: 10px; color: #94a3b8; margin-top: 8px; letter-spacing: 0.5px; }

        @keyframes tr-go-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tr-go-zoom { from { transform: scale(2.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }

        /* Death shake */
        .tornado-run-death-shake { animation: tr-death-shake 0.4s ease-out; }
        @keyframes tr-death-shake {
          0%, 100% { transform: translateX(0); }
          10% { transform: translateX(-8px) rotate(-1deg); }
          20% { transform: translateX(8px) rotate(1deg); }
          30% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          50% { transform: translateX(-4px); }
          60% { transform: translateX(4px); }
          70% { transform: translateX(-2px); }
          80% { transform: translateX(2px); }
        }

        /* Controls */
        .tornado-run-controls { display: flex; gap: 10px; padding: 6px 12px 10px; z-index: 10; flex-shrink: 0; }
        .tornado-run-btn {
          flex: 1; height: 50px;
          border: 3px solid #3a3a5e; border-radius: 6px;
          background: linear-gradient(180deg, #2d2d4e 0%, #1a1a2e 100%);
          color: #e2e8f0; font-size: 12px; font-weight: 800; letter-spacing: 2px;
          cursor: pointer;
          box-shadow: 0 4px 0 #0a0a1e, inset 0 1px 0 rgba(255,255,255,0.1);
          transition: transform 0.06s;
          display: flex; align-items: center; justify-content: center; gap: 4px;
          font-family: 'Press Start 2P', 'Courier New', monospace;
        }
        .tornado-run-btn:active {
          transform: translateY(3px);
          box-shadow: 0 1px 0 #0a0a1e;
          background: linear-gradient(180deg, #3a3a5e 0%, #2d2d4e 100%);
        }
      `}</style>
    </section>
  )
}

export const tornadoRunModule: MiniGameModule = {
  manifest: {
    id: 'tornado-run',
    title: 'Tornado Run',
    description: 'Dodge winds and collect coins! Pixel wind runner!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#1a1a2e',
  },
  Component: TornadoRunGame,
}
