import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'

import flipSfxUrl from '../../../assets/sounds/gravity-flip-flip.mp3'
import coinSfxUrl from '../../../assets/sounds/gravity-flip-coin.mp3'
import magnetSfxUrl from '../../../assets/sounds/gravity-flip-magnet.mp3'
import milestoneSfxUrl from '../../../assets/sounds/gravity-flip-milestone.mp3'
import crashSfxUrl from '../../../assets/sounds/gravity-flip-crash.mp3'
import comboSfxUrl from '../../../assets/sounds/gravity-flip-combo.mp3'
import shieldSfxUrl from '../../../assets/sounds/gravity-flip-shield.mp3'
import feverSfxUrl from '../../../assets/sounds/gravity-flip-fever.mp3'

// ─── Stage uses percentage-based layout for full 9:16 utilization ───
const GROUND_HEIGHT_PCT = 5.2
const CEILING_HEIGHT_PCT = 5.2
const PLAY_TOP_PCT = CEILING_HEIGHT_PCT
const PLAY_BOTTOM_PCT = 100 - GROUND_HEIGHT_PCT

const PLAYER_X_PCT = 18
const PLAYER_SIZE_PCT = 8.5

const GRAVITY_STRENGTH = 2200
const MAX_FALL_SPEED = 780
const FLIP_IMPULSE = 500

const BASE_SCROLL_SPEED = 200
const MAX_SCROLL_SPEED = 420
const SPEED_ACCEL_PER_SECOND = 9

const OBSTACLE_WIDTH_PCT = 7
const OBSTACLE_MIN_HEIGHT_PCT = 14

const OBSTACLE_SPAWN_INTERVAL_MIN_MS = 850
const OBSTACLE_SPAWN_INTERVAL_MAX_MS = 1700
const OBSTACLE_SPAWN_INTERVAL_FLOOR_MS = 550

const COIN_SIZE_PCT = 4.5
const COIN_SPAWN_CHANCE = 0.6
const COIN_SCORE_BONUS = 50

const MAGNET_SIZE_PCT = 3.8
const MAGNET_SPAWN_CHANCE = 0.1
const MAGNET_DURATION_MS = 5000
const MAGNET_ATTRACT_RADIUS_PCT = 20
const MAGNET_ATTRACT_SPEED_PCT = 50

const SHIELD_SPAWN_CHANCE = 0.08
const SHIELD_DURATION_MS = 4000

const DOUBLE_COIN_SPAWN_CHANCE = 0.07
const DOUBLE_COIN_DURATION_MS = 6000

const SPEED_ZONE_WIDTH_PCT = 12
const SPEED_ZONE_SPAWN_CHANCE = 0.04
const SPEED_ZONE_BOOST = 1.5
const SPEED_ZONE_DURATION_MS = 3000

const COIN_COMBO_DECAY_MS = 2000
const COIN_COMBO_MULTIPLIER_CAP = 8

const FEVER_THRESHOLD_COINS = 10
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3

const DISTANCE_MILESTONE = 2000
const MILESTONE_BONUS = 100

const SCORE_DISTANCE_MULTIPLIER = 0.14
const GAME_TIMEOUT_MS = 120000
const TIME_WARNING_MS = 30000
const TIME_CRITICAL_MS = 10000

// ─── Difficulty Phases ───
interface DifficultyPhase {
  readonly name: string
  readonly minElapsedMs: number
  readonly obstacleSpeedMult: number
  readonly spawnRateMult: number
  readonly maxObstacleHeightPct: number
}
const DIFFICULTY_PHASES: DifficultyPhase[] = [
  { name: 'EASY', minElapsedMs: 0, obstacleSpeedMult: 1, spawnRateMult: 1, maxObstacleHeightPct: 28 },
  { name: 'NORMAL', minElapsedMs: 15000, obstacleSpeedMult: 1.15, spawnRateMult: 0.9, maxObstacleHeightPct: 33 },
  { name: 'HARD', minElapsedMs: 35000, obstacleSpeedMult: 1.3, spawnRateMult: 0.78, maxObstacleHeightPct: 38 },
  { name: 'INSANE', minElapsedMs: 60000, obstacleSpeedMult: 1.5, spawnRateMult: 0.65, maxObstacleHeightPct: 42 },
]

interface Obstacle {
  readonly id: number
  x: number
  readonly heightPct: number
  readonly fromTop: boolean
  readonly gapPct?: number
}

interface Coin {
  readonly id: number
  x: number
  y: number
  collected: boolean
  readonly isDouble: boolean
}

interface Powerup {
  readonly id: number
  x: number
  readonly y: number
  collected: boolean
  readonly type: 'magnet' | 'shield' | 'double-coin'
}

interface SpeedZone {
  readonly id: number
  x: number
  readonly widthPct: number
}

interface GameModel {
  playerY: number
  playerVy: number
  gravityDirection: 1 | -1
  scrollSpeed: number
  elapsedMs: number
  distanceTraveled: number
  score: number
  coinsCollected: number
  obstacles: Obstacle[]
  coins: Coin[]
  powerups: Powerup[]
  speedZones: SpeedZone[]
  nextId: number
  timeSinceLastObstacle: number
  nextObstacleInterval: number
  magnetActiveMs: number
  shieldActiveMs: number
  doubleCoinActiveMs: number
  speedBoostActiveMs: number
  coinCombo: number
  lastCoinCollectMs: number
  lastMilestone: number
  feverActiveMs: number
  feverCoinsAccum: number
  currentPhase: number
  flipCount: number
  nearMissCount: number
  statusText: string
  statusTimer: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function createInitialModel(): GameModel {
  return {
    playerY: PLAY_BOTTOM_PCT - PLAYER_SIZE_PCT / 2 - 2,
    playerVy: 0,
    gravityDirection: 1,
    scrollSpeed: BASE_SCROLL_SPEED,
    elapsedMs: 0,
    distanceTraveled: 0,
    score: 0,
    coinsCollected: 0,
    obstacles: [],
    coins: [],
    powerups: [],
    speedZones: [],
    nextId: 0,
    timeSinceLastObstacle: 0,
    nextObstacleInterval: 1200,
    magnetActiveMs: 0,
    shieldActiveMs: 0,
    doubleCoinActiveMs: 0,
    speedBoostActiveMs: 0,
    coinCombo: 0,
    lastCoinCollectMs: 0,
    lastMilestone: 0,
    feverActiveMs: 0,
    feverCoinsAccum: 0,
    currentPhase: 0,
    flipCount: 0,
    nearMissCount: 0,
    statusText: '',
    statusTimer: 0,
  }
}

function getCurrentPhase(elapsedMs: number): number {
  for (let i = DIFFICULTY_PHASES.length - 1; i >= 0; i--) {
    if (elapsedMs >= DIFFICULTY_PHASES[i].minElapsedMs) return i
  }
  return 0
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

function computeObstacleInterval(elapsedMs: number, phaseMult: number): number {
  const progress = clamp(elapsedMs / 60000, 0, 1)
  const intervalRange = OBSTACLE_SPAWN_INTERVAL_MAX_MS - OBSTACLE_SPAWN_INTERVAL_FLOOR_MS
  return Math.max(
    OBSTACLE_SPAWN_INTERVAL_FLOOR_MS,
    (OBSTACLE_SPAWN_INTERVAL_MIN_MS - progress * intervalRange * 0.4 + rand(-100, 100)) * phaseMult,
  )
}

function computeScore(model: GameModel): number {
  const distanceScore = Math.max(0, Math.floor(model.distanceTraveled * SCORE_DISTANCE_MULTIPLIER))
  const comboMult = 1 + model.coinCombo * 0.25
  const feverMult = model.feverActiveMs > 0 ? FEVER_SCORE_MULTIPLIER : 1
  const coinScore = Math.floor(model.coinsCollected * COIN_SCORE_BONUS * comboMult * feverMult)
  const milestoneScore = model.lastMilestone * MILESTONE_BONUS
  const nearMissBonus = model.nearMissCount * 25
  const flipBonus = Math.floor(model.flipCount * 2)
  return distanceScore + coinScore + milestoneScore + nearMissBonus + flipBonus
}

// ─── Sound manager ───
function createSfxPool(url: string, poolSize = 3): { play: (vol: number, rate?: number) => void } {
  const pool: HTMLAudioElement[] = []
  let idx = 0
  for (let i = 0; i < poolSize; i++) {
    const a = new Audio(url)
    a.preload = 'auto'
    pool.push(a)
  }
  return {
    play(vol: number, rate = 1) {
      const audio = pool[idx % pool.length]
      idx++
      audio.currentTime = 0
      audio.volume = vol
      audio.playbackRate = rate
      void audio.play().catch(() => {})
    },
  }
}

function GravityFlipGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const {
    particles,
    scorePopups,
    isFlashing,
    flashColor,
    spawnParticles,
    triggerShake,
    triggerFlash,
    showScorePopup,
    updateParticles,
    cleanup,
    getShakeStyle,
  } = useGameEffects({ maxParticles: 50 })
  const [renderModel, setRenderModel] = useState<GameModel>(() => createInitialModel())

  const modelRef = useRef<GameModel>(renderModel)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const flipQueuedRef = useRef(false)

  const sfxRef = useRef<{
    flip: ReturnType<typeof createSfxPool>
    coin: ReturnType<typeof createSfxPool>
    magnet: ReturnType<typeof createSfxPool>
    milestone: ReturnType<typeof createSfxPool>
    crash: ReturnType<typeof createSfxPool>
    combo: ReturnType<typeof createSfxPool>
    shield: ReturnType<typeof createSfxPool>
    fever: ReturnType<typeof createSfxPool>
  } | null>(null)

  const finishRound = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    const model = modelRef.current
    model.statusText = 'CRASH!'
    model.statusTimer = 99999
    sfxRef.current?.crash.play(0.7, 0.95)

    triggerShake(6)
    triggerFlash('rgba(239,68,68,0.5)')

    const finalDurationMs = model.elapsedMs > 0 ? Math.round(model.elapsedMs) : Math.round(DEFAULT_FRAME_MS)
    onFinish({ score: model.score, durationMs: finalDurationMs })
  }, [onFinish, triggerFlash, triggerShake])

  const handleFlip = useCallback(() => {
    if (finishedRef.current) return
    flipQueuedRef.current = true
  }, [])

  // Init audio
  useEffect(() => {
    sfxRef.current = {
      flip: createSfxPool(flipSfxUrl),
      coin: createSfxPool(coinSfxUrl),
      magnet: createSfxPool(magnetSfxUrl),
      milestone: createSfxPool(milestoneSfxUrl),
      crash: createSfxPool(crashSfxUrl),
      combo: createSfxPool(comboSfxUrl),
      shield: createSfxPool(shieldSfxUrl),
      fever: createSfxPool(feverSfxUrl),
    }
    return () => { cleanup() }
  }, [cleanup])

  // Input handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (finishedRef.current) return
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault()
        handleFlip()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [handleFlip, onExit])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const dt = deltaMs / 1000
      const m = modelRef.current
      const sfx = sfxRef.current

      m.elapsedMs += deltaMs

      if (m.elapsedMs >= GAME_TIMEOUT_MS) {
        m.statusText = "Time's up!"
        m.statusTimer = 99999
        m.score = computeScore(m)
        setRenderModel({ ...m })
        finishRound()
        return
      }

      // Difficulty phase
      const newPhase = getCurrentPhase(m.elapsedMs)
      if (newPhase > m.currentPhase) {
        m.currentPhase = newPhase
        m.statusText = `${DIFFICULTY_PHASES[newPhase].name} MODE!`
        m.statusTimer = 2000
        sfx?.milestone.play(0.5, 1.1)
        triggerFlash('rgba(139,92,246,0.3)')
      }
      const phase = DIFFICULTY_PHASES[m.currentPhase]

      const elapsedSec = m.elapsedMs / 1000
      const speedBoostMult = m.speedBoostActiveMs > 0 ? SPEED_ZONE_BOOST : 1
      m.scrollSpeed = Math.min(MAX_SCROLL_SPEED, BASE_SCROLL_SPEED + elapsedSec * SPEED_ACCEL_PER_SECOND) * phase.obstacleSpeedMult * speedBoostMult

      const scrollDist = m.scrollSpeed * dt
      m.distanceTraveled += scrollDist

      // Flip
      if (flipQueuedRef.current) {
        flipQueuedRef.current = false
        m.gravityDirection = m.gravityDirection === 1 ? -1 : 1
        m.playerVy = -m.gravityDirection * FLIP_IMPULSE
        m.flipCount++
        sfx?.flip.play(0.4, 1 + Math.random() * 0.15)
        spawnParticles(3, 50, 50)
      }

      // Physics (percentage-based Y)
      const gravAccel = GRAVITY_STRENGTH * dt / 100 // convert to pct
      m.playerVy += m.gravityDirection * gravAccel * 100
      m.playerVy = clamp(m.playerVy, -MAX_FALL_SPEED, MAX_FALL_SPEED)
      m.playerY += m.playerVy * dt / 100 * 100

      const pTop = PLAY_TOP_PCT + PLAYER_SIZE_PCT / 2
      const pBot = PLAY_BOTTOM_PCT - PLAYER_SIZE_PCT / 2
      if (m.playerY < pTop) { m.playerY = pTop; m.playerVy = 0 }
      if (m.playerY > pBot) { m.playerY = pBot; m.playerVy = 0 }

      // Spawn obstacles
      m.timeSinceLastObstacle += deltaMs
      if (m.timeSinceLastObstacle >= m.nextObstacleInterval) {
        m.timeSinceLastObstacle = 0
        m.nextObstacleInterval = computeObstacleInterval(m.elapsedMs, phase.spawnRateMult)

        const fromTop = Math.random() < 0.5
        const minH = OBSTACLE_MIN_HEIGHT_PCT
        const maxH = phase.maxObstacleHeightPct
        const playAreaPct = PLAY_BOTTOM_PCT - PLAY_TOP_PCT
        const hPct = rand(minH, Math.min(maxH, playAreaPct - PLAYER_SIZE_PCT - 5))

        m.obstacles.push({
          id: m.nextId++,
          x: 105,
          heightPct: hPct,
          fromTop,
        })

        // Spawn coins in safe area
        if (Math.random() < COIN_SPAWN_CHANCE) {
          const coinY = fromTop
            ? PLAY_TOP_PCT + hPct + rand(5, 15)
            : PLAY_BOTTOM_PCT - hPct - rand(5, 15)
          const isDouble = m.doubleCoinActiveMs > 0
          m.coins.push({
            id: m.nextId++,
            x: 105 + OBSTACLE_WIDTH_PCT / 2,
            y: clamp(coinY, PLAY_TOP_PCT + COIN_SIZE_PCT, PLAY_BOTTOM_PCT - COIN_SIZE_PCT),
            collected: false,
            isDouble,
          })
        }

        // Spawn powerups
        const spawnY = rand(PLAY_TOP_PCT + 8, PLAY_BOTTOM_PCT - 8)
        if (Math.random() < MAGNET_SPAWN_CHANCE) {
          m.powerups.push({ id: m.nextId++, x: 112, y: spawnY, collected: false, type: 'magnet' })
        } else if (Math.random() < SHIELD_SPAWN_CHANCE) {
          m.powerups.push({ id: m.nextId++, x: 112, y: spawnY, collected: false, type: 'shield' })
        } else if (Math.random() < DOUBLE_COIN_SPAWN_CHANCE) {
          m.powerups.push({ id: m.nextId++, x: 112, y: spawnY, collected: false, type: 'double-coin' })
        }

        // Speed zones
        if (Math.random() < SPEED_ZONE_SPAWN_CHANCE && m.speedBoostActiveMs <= 0) {
          m.speedZones.push({ id: m.nextId++, x: 110, widthPct: SPEED_ZONE_WIDTH_PCT })
        }
      }

      // Move everything (scroll in percentage)
      const scrollPctPerSec = m.scrollSpeed / 4 // approximate px->pct conversion
      const scrollPct = scrollPctPerSec * dt

      for (const ob of m.obstacles) ob.x -= scrollPct
      m.obstacles = m.obstacles.filter(ob => ob.x + OBSTACLE_WIDTH_PCT > -5)

      for (const c of m.coins) c.x -= scrollPct
      m.coins = m.coins.filter(c => c.x + COIN_SIZE_PCT > -5)

      for (const p of m.powerups) p.x -= scrollPct
      m.powerups = m.powerups.filter(p => p.x + MAGNET_SIZE_PCT > -5)

      for (const sz of m.speedZones) sz.x -= scrollPct
      m.speedZones = m.speedZones.filter(sz => sz.x + sz.widthPct > -5)

      // Timers
      if (m.magnetActiveMs > 0) m.magnetActiveMs = Math.max(0, m.magnetActiveMs - deltaMs)
      if (m.shieldActiveMs > 0) m.shieldActiveMs = Math.max(0, m.shieldActiveMs - deltaMs)
      if (m.doubleCoinActiveMs > 0) m.doubleCoinActiveMs = Math.max(0, m.doubleCoinActiveMs - deltaMs)
      if (m.speedBoostActiveMs > 0) m.speedBoostActiveMs = Math.max(0, m.speedBoostActiveMs - deltaMs)
      if (m.feverActiveMs > 0) m.feverActiveMs = Math.max(0, m.feverActiveMs - deltaMs)
      if (m.statusTimer > 0) m.statusTimer = Math.max(0, m.statusTimer - deltaMs)

      // Magnet attraction
      if (m.magnetActiveMs > 0) {
        for (const coin of m.coins) {
          if (coin.collected) continue
          const dx = PLAYER_X_PCT - coin.x
          const dy = m.playerY - coin.y
          const dist = Math.hypot(dx, dy)
          if (dist < MAGNET_ATTRACT_RADIUS_PCT && dist > 0.5) {
            coin.x += (dx / dist) * MAGNET_ATTRACT_SPEED_PCT * dt
            coin.y += (dy / dist) * MAGNET_ATTRACT_SPEED_PCT * dt
          }
        }
      }

      // Coin combo decay
      if (m.elapsedMs - m.lastCoinCollectMs > COIN_COMBO_DECAY_MS) m.coinCombo = 0

      // Speed zone check
      for (const sz of m.speedZones) {
        if (PLAYER_X_PCT > sz.x && PLAYER_X_PCT < sz.x + sz.widthPct && m.speedBoostActiveMs <= 0) {
          m.speedBoostActiveMs = SPEED_ZONE_DURATION_MS
          m.statusText = 'SPEED BOOST!'
          m.statusTimer = 1500
          triggerFlash('rgba(34,197,94,0.3)')
        }
      }

      // Collision: Player collider (in pct)
      const pcX = PLAYER_X_PCT - PLAYER_SIZE_PCT * 0.35
      const pcY = m.playerY - PLAYER_SIZE_PCT * 0.45
      const pcW = PLAYER_SIZE_PCT * 0.7
      const pcH = PLAYER_SIZE_PCT * 0.9

      // Obstacle collision
      let hitObstacle = false
      let nearMiss = false
      for (const ob of m.obstacles) {
        const obY = ob.fromTop ? PLAY_TOP_PCT : PLAY_BOTTOM_PCT - ob.heightPct
        const obH = ob.heightPct

        if (rectsOverlap(pcX, pcY, pcW, pcH, ob.x, obY, OBSTACLE_WIDTH_PCT, obH)) {
          hitObstacle = true
          break
        }

        // Near miss detection
        const nearDist = 3
        if (ob.x > pcX - nearDist && ob.x < pcX + pcW + nearDist) {
          const gapStart = ob.fromTop ? PLAY_TOP_PCT + ob.heightPct : PLAY_TOP_PCT
          const gapEnd = ob.fromTop ? PLAY_BOTTOM_PCT : PLAY_BOTTOM_PCT - ob.heightPct
          if (m.playerY > gapStart && m.playerY < gapEnd) {
            const distToEdge = ob.fromTop
              ? m.playerY - (PLAY_TOP_PCT + ob.heightPct)
              : (PLAY_BOTTOM_PCT - ob.heightPct) - m.playerY
            if (distToEdge < 4 && distToEdge > 0) nearMiss = true
          }
        }
      }

      if (hitObstacle) {
        if (m.shieldActiveMs > 0) {
          m.shieldActiveMs = 0
          m.statusText = 'SHIELD BROKEN!'
          m.statusTimer = 1500
          sfx?.shield.play(0.5, 0.8)
          triggerShake(3)
          triggerFlash('rgba(59,130,246,0.3)')
          // Remove the obstacle that was hit
          m.obstacles = m.obstacles.filter(ob => {
            const obY = ob.fromTop ? PLAY_TOP_PCT : PLAY_BOTTOM_PCT - ob.heightPct
            return !rectsOverlap(pcX, pcY, pcW, pcH, ob.x, obY, OBSTACLE_WIDTH_PCT, ob.heightPct)
          })
        } else {
          m.score = computeScore(m)
          triggerShake(6)
          triggerFlash('rgba(239,68,68,0.5)')
          setRenderModel({ ...m })
          finishRound()
          return
        }
      }

      if (nearMiss) {
        m.nearMissCount++
        showScorePopup(25, 200, 300, '#a78bfa')
        spawnParticles(2, 100, 200)
      }

      // Coin collection
      let didCollectCoin = false
      for (const coin of m.coins) {
        if (coin.collected) continue
        const cx = coin.x + COIN_SIZE_PCT / 2
        const cy = coin.y
        if (Math.hypot(cx - PLAYER_X_PCT, cy - m.playerY) < PLAYER_SIZE_PCT * 0.7) {
          coin.collected = true
          const bonus = coin.isDouble ? 2 : 1
          m.coinsCollected += bonus
          m.coinCombo = Math.min(m.coinCombo + 1, COIN_COMBO_MULTIPLIER_CAP)
          m.lastCoinCollectMs = m.elapsedMs
          m.feverCoinsAccum += bonus
          didCollectCoin = true
        }
      }
      m.coins = m.coins.filter(c => !c.collected)

      if (didCollectCoin) {
        sfx?.coin.play(0.5, 1.1 + m.coinCombo * 0.06)
        triggerFlash('rgba(251,191,36,0.15)')
        spawnParticles(4, 80, 150)
        if (m.coinCombo >= 3) {
          sfx?.combo.play(0.4, 1 + m.coinCombo * 0.05)
          showScorePopup(m.coinCombo, 200, 250, getComboColor(m.coinCombo))
        }
      }

      // Fever mode
      if (m.feverCoinsAccum >= FEVER_THRESHOLD_COINS && m.feverActiveMs <= 0) {
        m.feverActiveMs = FEVER_DURATION_MS
        m.feverCoinsAccum = 0
        m.statusText = 'FEVER MODE!'
        m.statusTimer = 2000
        sfx?.fever.play(0.6)
        triggerFlash('rgba(234,179,8,0.4)')
        spawnParticles(12, 200, 300)
      }

      // Powerup collection
      for (const p of m.powerups) {
        if (p.collected) continue
        if (Math.hypot(p.x + MAGNET_SIZE_PCT / 2 - PLAYER_X_PCT, p.y - m.playerY) < PLAYER_SIZE_PCT * 0.8) {
          p.collected = true
          if (p.type === 'magnet') {
            m.magnetActiveMs = MAGNET_DURATION_MS
            m.statusText = 'MAGNET!'
            m.statusTimer = 1500
            sfx?.magnet.play(0.5)
          } else if (p.type === 'shield') {
            m.shieldActiveMs = SHIELD_DURATION_MS
            m.statusText = 'SHIELD ON!'
            m.statusTimer = 1500
            sfx?.shield.play(0.5)
            triggerFlash('rgba(59,130,246,0.3)')
          } else if (p.type === 'double-coin') {
            m.doubleCoinActiveMs = DOUBLE_COIN_DURATION_MS
            m.statusText = 'DOUBLE COINS!'
            m.statusTimer = 1500
            sfx?.coin.play(0.5, 1.4)
            triggerFlash('rgba(234,179,8,0.3)')
          }
        }
      }
      m.powerups = m.powerups.filter(p => !p.collected)

      // Distance milestone
      const currentMilestone = Math.floor(m.distanceTraveled / DISTANCE_MILESTONE)
      if (currentMilestone > m.lastMilestone) {
        m.lastMilestone = currentMilestone
        m.statusText = `MILESTONE ${currentMilestone}! +${MILESTONE_BONUS}`
        m.statusTimer = 2000
        sfx?.milestone.play(0.5)
        spawnParticles(6, 200, 100)
        triggerFlash('rgba(168,85,247,0.25)')
      }

      m.score = computeScore(m)
      setRenderModel({ ...m })
      updateParticles()
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
  }, [finishRound, showScorePopup, spawnParticles, triggerFlash, triggerShake, updateParticles])

  const displayedBestScore = useMemo(() => Math.max(bestScore, renderModel.score), [bestScore, renderModel.score])
  const isGravityUp = renderModel.gravityDirection === -1
  const isFever = renderModel.feverActiveMs > 0
  const comboLabel = renderModel.coinCombo >= 3 ? getComboLabel(renderModel.coinCombo) : null
  const remainingMs = Math.max(0, GAME_TIMEOUT_MS - renderModel.elapsedMs)
  const remainingSeconds = Math.ceil(remainingMs / 1000)
  const timeRatio = clamp(remainingMs / GAME_TIMEOUT_MS, 0, 1)
  const isTimeWarning = remainingMs <= TIME_WARNING_MS
  const isTimeCritical = remainingMs <= TIME_CRITICAL_MS

  return (
    <section
      className={`mini-game-panel gravity-flip-panel ${isFever ? 'gf-fever' : ''}`}
      aria-label="gravity-flip-game"
      style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...getShakeStyle() }}
    >
      <div
        className="gf-stage"
        onPointerDown={(e) => { e.preventDefault(); handleFlip() }}
        role="presentation"
      >
        {/* Background stars */}
        <div className="gf-bg-stars" />

        {/* Speed zone visual */}
        {renderModel.speedZones.map(sz => (
          <div
            key={sz.id}
            className="gf-speed-zone"
            style={{ left: `${sz.x}%`, width: `${sz.widthPct}%` }}
          />
        ))}

        {/* Ceiling & Ground */}
        <div className="gf-ceiling" />
        <div className="gf-ground" />

        {/* Gravity indicator arrows */}
        <div className={`gf-gravity-indicator ${isGravityUp ? 'up' : 'down'}`}>
          {isGravityUp ? '▲' : '▼'}
        </div>

        {/* Obstacles */}
        {renderModel.obstacles.map(ob => {
          const obY = ob.fromTop ? PLAY_TOP_PCT : PLAY_BOTTOM_PCT - ob.heightPct
          return (
            <div
              className={`gf-obstacle ${ob.fromTop ? 'from-top' : 'from-bottom'}`}
              key={ob.id}
              style={{
                left: `${ob.x}%`,
                top: `${obY}%`,
                width: `${OBSTACLE_WIDTH_PCT}%`,
                height: `${ob.heightPct}%`,
              }}
            >
              <div className="gf-obstacle-glow" />
            </div>
          )
        })}

        {/* Coins */}
        {renderModel.coins.map(coin => (
          <div
            className={`gf-coin ${coin.isDouble ? 'double' : ''}`}
            key={coin.id}
            style={{
              left: `${coin.x}%`,
              top: `${coin.y - COIN_SIZE_PCT / 2}%`,
              width: `${COIN_SIZE_PCT}%`,
              height: `${COIN_SIZE_PCT}%`,
            }}
          >
            {coin.isDouble ? '2x' : ''}
          </div>
        ))}

        {/* Powerups */}
        {renderModel.powerups.map(p => (
          <div
            key={p.id}
            className={`gf-powerup gf-powerup-${p.type}`}
            style={{
              left: `${p.x}%`,
              top: `${p.y - MAGNET_SIZE_PCT / 2}%`,
              width: `${MAGNET_SIZE_PCT}%`,
              height: `${MAGNET_SIZE_PCT}%`,
            }}
          >
            {p.type === 'magnet' ? 'M' : p.type === 'shield' ? 'S' : '2x'}
          </div>
        ))}

        {/* Player */}
        <div className={`gf-player-wrap ${renderModel.shieldActiveMs > 0 ? 'shielded' : ''}`} style={{
          left: `${PLAYER_X_PCT}%`,
          top: `${renderModel.playerY}%`,
          height: `${PLAYER_SIZE_PCT}%`,
          aspectRatio: '1 / 1',
          transform: 'translate(-50%, -50%)',
        }}>
          <img
            className="gf-player"
            src={parkWankyuSprite}
            alt="player"
            style={{ transform: isGravityUp ? 'scaleY(-1)' : 'scaleY(1)' }}
          />
          {renderModel.shieldActiveMs > 0 && <div className="gf-shield-bubble" />}
        </div>

        <div className="gf-timer-track" aria-hidden>
          <div
            className={`gf-timer-fill ${isTimeWarning ? 'warning' : ''} ${isTimeCritical ? 'critical' : ''}`}
            style={{ width: `${timeRatio * 100}%` }}
          />
        </div>

        {/* HUD */}
        <div className="gf-hud">
          <div className="gf-score-block">
            <p className="gf-score-label">SCORE</p>
            <p className="gf-score">{renderModel.score.toLocaleString()}</p>
            <p className="gf-best">BEST {displayedBestScore.toLocaleString()}</p>
            <div className="gf-meta-row">
              <span className="gf-coins-label">COINS {renderModel.coinsCollected}</span>
              {renderModel.coinCombo > 0 && <span className="gf-combo">MULTI x{(1 + renderModel.coinCombo * 0.25).toFixed(1)}</span>}
            </div>
          </div>

          <div className="gf-hud-side">
            <div className={`gf-timer-card ${isTimeWarning ? 'warning' : ''} ${isTimeCritical ? 'critical' : ''}`}>
              <span className="gf-timer-label">TIME LEFT</span>
              <strong className="gf-timer-value">{remainingSeconds}s</strong>
            </div>

            <div className="gf-phase-badge">
              {DIFFICULTY_PHASES[renderModel.currentPhase].name}
            </div>
          </div>
        </div>

        {/* Active powerup indicators */}
        <div className="gf-powerup-bar">
          {renderModel.magnetActiveMs > 0 && (
            <span className="gf-active-buff magnet">{(renderModel.magnetActiveMs / 1000).toFixed(1)}s</span>
          )}
          {renderModel.shieldActiveMs > 0 && (
            <span className="gf-active-buff shield">{(renderModel.shieldActiveMs / 1000).toFixed(1)}s</span>
          )}
          {renderModel.doubleCoinActiveMs > 0 && (
            <span className="gf-active-buff double">{(renderModel.doubleCoinActiveMs / 1000).toFixed(1)}s</span>
          )}
          {renderModel.speedBoostActiveMs > 0 && (
            <span className="gf-active-buff speed">{(renderModel.speedBoostActiveMs / 1000).toFixed(1)}s</span>
          )}
          {isFever && (
            <span className="gf-active-buff fever">{(renderModel.feverActiveMs / 1000).toFixed(1)}s</span>
          )}
        </div>

        {/* Combo label */}
        {comboLabel && (
          <div className="gf-combo-label" style={{ color: getComboColor(renderModel.coinCombo) }}>
            {comboLabel}
          </div>
        )}

        {/* Status text */}
        {renderModel.statusTimer > 0 && (
          <p className="gf-status">{renderModel.statusText}</p>
        )}

        {/* Fever overlay */}
        {isFever && <div className="gf-fever-overlay" />}
      </div>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={isFlashing} flashColor={flashColor} />
      <ParticleRenderer particles={particles} />
      <ScorePopupRenderer popups={scorePopups} />
    </section>
  )
}

export const gravityFlipModule: MiniGameModule = {
  manifest: {
    id: 'gravity-flip',
    title: 'Gravity Flip',
    description: 'Flip gravity, dodge the red walls, and survive for 120 seconds. Collect coins and power-ups to boost your score.',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#7c3aed',
  },
  Component: GravityFlipGame,
}
