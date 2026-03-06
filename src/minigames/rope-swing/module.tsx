import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import taeJinaSprite from '../../../assets/images/same-character/tae-jina.png'
import releaseWhooshSfx from '../../../assets/sounds/rope-swing-release.mp3'
import grabSfx from '../../../assets/sounds/rope-swing-grab.mp3'
import coinSfx from '../../../assets/sounds/rope-swing-coin.mp3'
import comboSfx from '../../../assets/sounds/rope-swing-combo.mp3'
import feverSfx from '../../../assets/sounds/rope-swing-fever.mp3'
import windSfx from '../../../assets/sounds/rope-swing-wind.mp3'
import fallSfx from '../../../assets/sounds/rope-swing-fall.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// --- Physics & Layout Constants ---

const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 720

const ROPE_ANCHOR_Y = 30
const ROPE_LENGTH_MIN = 150
const ROPE_LENGTH_MAX = 240
const ROPE_GRAB_RADIUS = 55

const GRAVITY = 980
const PENDULUM_DAMPING = 0.998
const WIND_MAX_FORCE = 120
const WIND_CHANGE_INTERVAL_MS = 3000

const INITIAL_ROPE_GAP_MIN = 100
const INITIAL_ROPE_GAP_MAX = 140
const GAP_INCREASE_PER_SCORE = 1.8
const MAX_ROPE_GAP = 220

const PLAYER_WIDTH = 52
const PLAYER_HEIGHT = 60

const COMBO_DECAY_MS = 2500
const COMBO_MULTIPLIER_STEP = 5

const FALL_ZONE_Y = VIEWBOX_HEIGHT + 60

const SPEED_INCREASE_PER_SCORE = 0.03
const MAX_SPEED_MULTIPLIER = 2.5
const COIN_SPAWN_CHANCE = 0.65
const COIN_RADIUS = 14
const COIN_COLLECT_RADIUS = 34
const COIN_SCORE = 5
const DISTANCE_BONUS_DIVISOR = 80
const FEVER_COMBO_THRESHOLD = 10
const FEVER_MULTIPLIER = 2

// Power-ups
const POWERUP_SPAWN_CHANCE = 0.25
const POWERUP_RADIUS = 16
const POWERUP_COLLECT_RADIUS = 36
const MAGNET_DURATION_MS = 5000
const SHIELD_DURATION_MS = 6000
const DOUBLE_JUMP_COUNT = 2

// Obstacles
const OBSTACLE_SPAWN_CHANCE = 0.3
const OBSTACLE_RADIUS = 18

// Trail
const TRAIL_MAX_LENGTH = 12
const TRAIL_FADE_STEP = 1 / TRAIL_MAX_LENGTH

// --- Types ---

interface Rope {
  readonly id: number
  readonly anchorX: number
  readonly length: number
}

type GamePhase = 'swinging' | 'flying' | 'falling' | 'ended'
type PowerUpType = 'magnet' | 'shield' | 'double-jump' | 'score-x2'

interface PowerUp {
  id: number
  x: number
  y: number
  type: PowerUpType
  collected: boolean
}

interface Obstacle {
  id: number
  x: number
  y: number
  type: 'bird' | 'cloud'
  vx: number
}

interface PlayerState {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  angularVelocity: number
}

interface TrailPoint {
  x: number
  y: number
  opacity: number
}

// --- Helpers ---

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toComboMultiplier(combo: number): number {
  return 1 + Math.floor(combo / COMBO_MULTIPLIER_STEP)
}

function computeRopeGap(score: number): { min: number; max: number } {
  const increase = score * GAP_INCREASE_PER_SCORE
  const min = Math.min(INITIAL_ROPE_GAP_MIN + increase, MAX_ROPE_GAP - 20)
  const max = Math.min(INITIAL_ROPE_GAP_MAX + increase, MAX_ROPE_GAP)
  return { min, max }
}

function generateNextRope(previousAnchorX: number, score: number, nextId: number): Rope {
  const gap = computeRopeGap(score)
  const direction = Math.random() < 0.5 ? -1 : 1
  const distance = randomBetween(gap.min, gap.max)
  let nextX = previousAnchorX + direction * distance

  const margin = 60
  if (nextX < margin) {
    nextX = previousAnchorX + distance
  } else if (nextX > VIEWBOX_WIDTH - margin) {
    nextX = previousAnchorX - distance
  }

  nextX = clampNumber(nextX, margin, VIEWBOX_WIDTH - margin)

  return {
    id: nextId,
    anchorX: nextX,
    length: randomBetween(ROPE_LENGTH_MIN, ROPE_LENGTH_MAX),
  }
}

function createInitialRopes(): Rope[] {
  const first: Rope = {
    id: 0,
    anchorX: VIEWBOX_WIDTH / 2,
    length: randomBetween(ROPE_LENGTH_MIN, ROPE_LENGTH_MAX),
  }
  const second = generateNextRope(first.anchorX, 0, 1)
  const third = generateNextRope(second.anchorX, 0, 2)
  return [first, second, third]
}

function playerPositionOnRope(rope: Rope, angle: number): { x: number; y: number } {
  return {
    x: rope.anchorX + Math.sin(angle) * rope.length,
    y: ROPE_ANCHOR_Y + Math.cos(angle) * rope.length,
  }
}

const POWERUP_ICONS: Record<PowerUpType, { emoji: string; color: string }> = {
  'magnet': { emoji: '🧲', color: '#ef4444' },
  'shield': { emoji: '🛡️', color: '#3b82f6' },
  'double-jump': { emoji: '⬆️', color: '#22c55e' },
  'score-x2': { emoji: '✖️', color: '#f59e0b' },
}

// --- Component ---

function RopeSwingGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [phase, setPhase] = useState<GamePhase>('swinging')
  const [playerPos, setPlayerPos] = useState<{ x: number; y: number }>({ x: VIEWBOX_WIDTH / 2, y: ROPE_ANCHOR_Y + 170 })
  const [ropes, setRopes] = useState<Rope[]>(() => createInitialRopes())
  const [currentRopeIndex, setCurrentRopeIndex] = useState(0)
  const [pendulumAngle, setPendulumAngle] = useState(0)
  const [windForce, setWindForce] = useState(0)
  const [cameraOffsetX, setCameraOffsetX] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [coins, setCoins] = useState<Array<{ id: number; x: number; y: number; collected: boolean }>>([])
  const [coinsCollected, setCoinsCollected] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [trail, setTrail] = useState<TrailPoint[]>([])
  const [powerups, setPowerups] = useState<PowerUp[]>([])
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [activePowerups, setActivePowerups] = useState<Map<PowerUpType, number>>(new Map())
  const [doubleJumpsLeft, setDoubleJumpsLeft] = useState(0)
  const [hasShield, setHasShield] = useState(false)
  const [swingCount, setSwingCount] = useState(0)
  const [perfectGrabs, setPerfectGrabs] = useState(0)
  const [showPerfect, setShowPerfect] = useState(false)

  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const lastComboAtRef = useRef(0)
  const phaseRef = useRef<GamePhase>('swinging')
  const playerRef = useRef<PlayerState>({
    x: VIEWBOX_WIDTH / 2,
    y: ROPE_ANCHOR_Y + 170,
    vx: 0,
    vy: 0,
    angle: 0,
    angularVelocity: 1.8,
  })
  const ropesRef = useRef<Rope[]>(ropes)
  const currentRopeIndexRef = useRef(0)
  const ropeIdCounterRef = useRef(3)
  const windForceRef = useRef(0)
  const windTimerRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)
  const coinsRef = useRef<Array<{ id: number; x: number; y: number; collected: boolean }>>([])
  const coinIdCounterRef = useRef(0)
  const coinsCollectedRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const cameraOffsetXRef = useRef(0)
  const trailRef = useRef<TrailPoint[]>([])
  const powerupsRef = useRef<PowerUp[]>([])
  const obstaclesRef = useRef<Obstacle[]>([])
  const powerupIdRef = useRef(0)
  const obstacleIdRef = useRef(0)
  const activePowerupsRef = useRef<Map<PowerUpType, number>>(new Map())
  const doubleJumpsRef = useRef(0)
  const hasShieldRef = useRef(false)
  const swingCountRef = useRef(0)
  const perfectGrabsRef = useRef(0)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const playSfx = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    const clone = audio.cloneNode() as HTMLAudioElement
    clone.volume = volume
    clone.playbackRate = playbackRate
    void clone.play().catch(() => {})
  }, [])

  const finishRound = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    phaseRef.current = 'ended'
    setPhase('ended')
    const finalElapsedMs = Math.max(16.66, elapsedMsRef.current)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(finalElapsedMs),
    })
  }, [onFinish])

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    const currentPhase = phaseRef.current
    if (currentPhase === 'ended' || currentPhase === 'falling') return

    if (currentPhase === 'swinging') {
      const player = playerRef.current
      const rope = ropesRef.current[currentRopeIndexRef.current]
      if (!rope) return

      const pos = playerPositionOnRope(rope, player.angle)
      const tangentSpeed = player.angularVelocity * rope.length
      const cosAngle = Math.cos(player.angle)
      const sinAngle = Math.sin(player.angle)

      player.x = pos.x
      player.y = pos.y
      player.vx = tangentSpeed * cosAngle
      player.vy = -tangentSpeed * sinAngle
      player.vy = Math.min(player.vy, -50)

      phaseRef.current = 'flying'
      setPhase('flying')
      playSfx('release', 0.5, 1.1)

      // Reset trail
      trailRef.current = []
    } else if (currentPhase === 'flying' && doubleJumpsRef.current > 0) {
      // Double jump!
      const player = playerRef.current
      player.vy = -350
      player.vx *= 1.2
      doubleJumpsRef.current -= 1
      setDoubleJumpsLeft(doubleJumpsRef.current)
      playSfx('release', 0.6, 1.4)
      effects.spawnParticles(6, player.x, player.y)
      effects.triggerFlash('rgba(34,197,94,0.3)')
    }
  }, [playSfx, effects])

  const syncVisualState = useCallback(() => {
    const player = playerRef.current
    setPlayerPos({ x: player.x, y: player.y })
    setPendulumAngle(player.angle)
    setWindForce(windForceRef.current)
    setCameraOffsetX(cameraOffsetXRef.current)
    setElapsedMs(elapsedMsRef.current)
    setTrail([...trailRef.current])
    setCoins([...coinsRef.current])
    setPowerups([...powerupsRef.current])
    setObstacles([...obstaclesRef.current])
    setActivePowerups(new Map(activePowerupsRef.current))
  }, [])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const comboMultiplier = useMemo(() => toComboMultiplier(combo), [combo])
  const hasMagnet = activePowerups.has('magnet')
  const hasScoreX2 = activePowerups.has('score-x2')

  // --- Audio setup ---
  useEffect(() => {
    const sfxMap: Record<string, string> = {
      release: releaseWhooshSfx,
      grab: grabSfx,
      coin: coinSfx,
      combo: comboSfx,
      fever: feverSfx,
      wind: windSfx,
      fall: fallSfx,
      gameOver: gameOverHitSfx,
    }
    for (const [key, src] of Object.entries(sfxMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }

    return () => {
      for (const audio of Object.values(audioRefs.current)) {
        if (audio) {
          audio.pause()
          audio.currentTime = 0
        }
      }
      effects.cleanup()
    }
  }, [])

  // --- Keyboard support ---
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (event.code === 'Space' || event.code === 'ArrowUp') {
        event.preventDefault()
        handleTap()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, onExit])

  // --- Main game loop ---
  useEffect(() => {
    lastFrameAtRef.current = null

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
      elapsedMsRef.current += deltaMs
      const deltaSec = deltaMs / 1000

      // Wind update
      windTimerRef.current += deltaMs
      if (windTimerRef.current >= WIND_CHANGE_INTERVAL_MS) {
        windTimerRef.current = 0
        const maxWind = Math.min(WIND_MAX_FORCE, 30 + scoreRef.current * 3)
        windForceRef.current = randomBetween(-maxWind, maxWind)
        if (Math.abs(windForceRef.current) > 60) {
          playSfx('wind', 0.3, 1)
        }
      }

      // Expire powerups
      for (const [type, expiresAt] of activePowerupsRef.current.entries()) {
        if (now > expiresAt) {
          activePowerupsRef.current.delete(type)
          if (type === 'shield') {
            hasShieldRef.current = false
            setHasShield(false)
          }
        }
      }

      const player = playerRef.current
      const currentPhase = phaseRef.current

      if (currentPhase === 'swinging') {
        const rope = ropesRef.current[currentRopeIndexRef.current]
        if (rope) {
          const gravityAccel = -(GRAVITY / rope.length) * Math.sin(player.angle)
          const windAccel = (windForceRef.current / rope.length) * Math.cos(player.angle)
          player.angularVelocity += (gravityAccel + windAccel) * deltaSec
          player.angularVelocity *= PENDULUM_DAMPING
          player.angle += player.angularVelocity * deltaSec

          const pos = playerPositionOnRope(rope, player.angle)
          player.x = pos.x
          player.y = pos.y
        }
      } else if (currentPhase === 'flying') {
        const speedMult = Math.min(MAX_SPEED_MULTIPLIER, 1 + scoreRef.current * SPEED_INCREASE_PER_SCORE)

        // Parabolic flight
        player.vy += GRAVITY * deltaSec
        player.vx += windForceRef.current * 0.3 * deltaSec
        player.x += player.vx * deltaSec * speedMult
        player.y += player.vy * deltaSec

        // Trail update
        trailRef.current.push({ x: player.x, y: player.y, opacity: 1 })
        if (trailRef.current.length > TRAIL_MAX_LENGTH) {
          trailRef.current.shift()
        }
        for (let i = 0; i < trailRef.current.length; i++) {
          trailRef.current[i].opacity = (i + 1) * TRAIL_FADE_STEP
        }

        // Magnet effect — attract coins
        const magnetActive = activePowerupsRef.current.has('magnet')
        const magnetRadius = 100

        // Coin collection during flight
        for (const coin of coinsRef.current) {
          if (coin.collected) continue

          if (magnetActive) {
            const dx = player.x - coin.x
            const dy = player.y - coin.y
            const dist = Math.hypot(dx, dy)
            if (dist < magnetRadius && dist > 1) {
              coin.x += (dx / dist) * 3
              coin.y += (dy / dist) * 3
            }
          }

          const dist = Math.hypot(player.x - coin.x, player.y - coin.y)
          if (dist < COIN_COLLECT_RADIUS) {
            coin.collected = true
            coinsCollectedRef.current += 1
            setCoinsCollected(coinsCollectedRef.current)
            let coinPoints = COIN_SCORE * toComboMultiplier(comboRef.current)
            if (activePowerupsRef.current.has('score-x2')) coinPoints *= 2
            scoreRef.current += coinPoints
            setScore(scoreRef.current)
            playSfx('coin', 0.45, 1.2 + Math.random() * 0.3)
            effects.spawnParticles(3, coin.x, coin.y)
          }
        }
        coinsRef.current = coinsRef.current.filter((c) => !c.collected)

        // Powerup collection
        for (const pu of powerupsRef.current) {
          if (pu.collected) continue
          const dist = Math.hypot(player.x - pu.x, player.y - pu.y)
          if (dist < POWERUP_COLLECT_RADIUS) {
            pu.collected = true
            if (pu.type === 'double-jump') {
              doubleJumpsRef.current = DOUBLE_JUMP_COUNT
              setDoubleJumpsLeft(DOUBLE_JUMP_COUNT)
            } else if (pu.type === 'shield') {
              hasShieldRef.current = true
              setHasShield(true)
              activePowerupsRef.current.set('shield', now + SHIELD_DURATION_MS)
            } else if (pu.type === 'magnet') {
              activePowerupsRef.current.set('magnet', now + MAGNET_DURATION_MS)
            } else if (pu.type === 'score-x2') {
              activePowerupsRef.current.set('score-x2', now + 8000)
            }
            playSfx('combo', 0.5, 1.3)
            effects.triggerFlash(POWERUP_ICONS[pu.type].color + '40')
            effects.spawnParticles(5, pu.x, pu.y)
          }
        }
        powerupsRef.current = powerupsRef.current.filter((p) => !p.collected)

        // Obstacle collision
        for (const obs of obstaclesRef.current) {
          // Move obstacles
          obs.x += obs.vx * deltaSec

          const dist = Math.hypot(player.x - obs.x, player.y - obs.y)
          if (dist < OBSTACLE_RADIUS + PLAYER_WIDTH / 3) {
            if (hasShieldRef.current) {
              hasShieldRef.current = false
              setHasShield(false)
              activePowerupsRef.current.delete('shield')
              effects.triggerFlash('rgba(59,130,246,0.5)')
              effects.triggerShake(3)
              playSfx('grab', 0.5, 0.8)
              // Remove the obstacle
              obs.x = -999
            } else {
              phaseRef.current = 'falling'
              setPhase('falling')
              effects.triggerShake(6)
              effects.triggerFlash('rgba(239,68,68,0.5)')
              playSfx('fall', 0.6, 1)
              playSfx('gameOver', 0.6, 0.9)
              finishRound()
              animationFrameRef.current = null
              syncVisualState()
              return
            }
          }
        }
        obstaclesRef.current = obstaclesRef.current.filter((o) => o.x > -500 && o.x < VIEWBOX_WIDTH + 500)

        // Check if grabbed next rope
        const allRopes = ropesRef.current
        for (let i = 0; i < allRopes.length; i++) {
          if (i <= currentRopeIndexRef.current) continue
          const rope = allRopes[i]
          const ropeEndX = rope.anchorX
          const ropeEndY = ROPE_ANCHOR_Y + rope.length * 0.6

          const dx = player.x - ropeEndX
          const dy = player.y - ropeEndY
          const dist = Math.hypot(dx, dy)

          if (dist < ROPE_GRAB_RADIUS && player.y < ROPE_ANCHOR_Y + rope.length + 20) {
            // Grabbed the rope
            currentRopeIndexRef.current = i
            setCurrentRopeIndex(i)
            swingCountRef.current += 1
            setSwingCount(swingCountRef.current)

            // Calculate angle from grab position
            const grabDx = player.x - rope.anchorX
            const grabDy = player.y - ROPE_ANCHOR_Y
            player.angle = Math.atan2(grabDx, grabDy)

            // Convert velocity to angular velocity
            const tangentialComponent =
              (player.vx * Math.cos(player.angle) - player.vy * Math.sin(player.angle)) / rope.length
            player.angularVelocity = tangentialComponent * 0.7

            // Combo logic
            const timeSinceLastCombo = now - lastComboAtRef.current
            if (timeSinceLastCombo < COMBO_DECAY_MS) {
              comboRef.current += 1
            } else {
              comboRef.current = 1
            }
            lastComboAtRef.current = now
            setCombo(comboRef.current)

            const comboMult = toComboMultiplier(comboRef.current)
            const feverActive = comboRef.current >= FEVER_COMBO_THRESHOLD
            if (feverActive && !activePowerupsRef.current.has('score-x2')) {
              playSfx('fever', 0.5, 1)
            }
            setIsFever(feverActive)

            // Perfect grab detection (close to anchor center)
            const isPerfect = dist < ROPE_GRAB_RADIUS * 0.4
            if (isPerfect) {
              perfectGrabsRef.current += 1
              setPerfectGrabs(perfectGrabsRef.current)
              setShowPerfect(true)
              setTimeout(() => setShowPerfect(false), 600)
            }

            // Distance-based scoring
            const grabDist = Math.abs(player.x - rope.anchorX)
            const distanceBonus = Math.floor(grabDist / DISTANCE_BONUS_DIVISOR)
            let earnedPoints = (1 + distanceBonus) * comboMult
            if (feverActive) earnedPoints *= FEVER_MULTIPLIER
            if (isPerfect) earnedPoints *= 2
            if (activePowerupsRef.current.has('score-x2')) earnedPoints *= 2

            const nextScore = scoreRef.current + earnedPoints
            scoreRef.current = nextScore
            setScore(nextScore)

            phaseRef.current = 'swinging'
            setPhase('swinging')

            // Clear trail
            trailRef.current = []

            if (comboMult > 1) {
              playSfx('combo', 0.55, 1 + comboRef.current * 0.03)
            } else {
              playSfx('grab', 0.45, 1.05)
            }

            effects.triggerFlash(isPerfect ? 'rgba(250,204,21,0.4)' : undefined)
            effects.spawnParticles(isPerfect ? 8 : 4, player.x, player.y)
            if (earnedPoints > 5) {
              effects.spawnScorePopup(earnedPoints, player.x, player.y - 30)
            }

            // Spawn coins between current and next rope
            if (Math.random() < COIN_SPAWN_CHANCE && i + 1 < allRopes.length) {
              const nextRopeAnchor = allRopes[i + 1] ? allRopes[i + 1].anchorX : rope.anchorX + 100
              const coinCount = 1 + Math.floor(Math.random() * 3)
              for (let c = 0; c < coinCount; c++) {
                const t = (c + 1) / (coinCount + 1)
                const coinX = rope.anchorX + (nextRopeAnchor - rope.anchorX) * t + randomBetween(-20, 20)
                const coinY = randomBetween(ROPE_ANCHOR_Y + 80, VIEWBOX_HEIGHT - 150)
                coinsRef.current.push({ id: coinIdCounterRef.current++, x: coinX, y: coinY, collected: false })
              }
            }

            // Spawn powerup occasionally
            if (Math.random() < POWERUP_SPAWN_CHANCE && i + 1 < allRopes.length) {
              const nextRope = allRopes[i + 1]
              const types: PowerUpType[] = ['magnet', 'shield', 'double-jump', 'score-x2']
              const puType = types[Math.floor(Math.random() * types.length)]
              const puX = (rope.anchorX + (nextRope ? nextRope.anchorX : rope.anchorX + 100)) / 2
              const puY = randomBetween(ROPE_ANCHOR_Y + 60, VIEWBOX_HEIGHT * 0.5)
              powerupsRef.current.push({ id: powerupIdRef.current++, x: puX, y: puY, type: puType, collected: false })
            }

            // Spawn obstacle occasionally (after score 5)
            if (scoreRef.current > 5 && Math.random() < OBSTACLE_SPAWN_CHANCE && i + 1 < allRopes.length) {
              const obsY = randomBetween(ROPE_ANCHOR_Y + 100, VIEWBOX_HEIGHT * 0.6)
              const dir = Math.random() < 0.5 ? 1 : -1
              const obsX = dir > 0 ? -50 : VIEWBOX_WIDTH + 50
              obstaclesRef.current.push({
                id: obstacleIdRef.current++,
                x: obsX,
                y: obsY,
                type: Math.random() < 0.5 ? 'bird' : 'cloud',
                vx: dir * randomBetween(40, 100),
              })
            }

            // Generate new ropes ahead
            let currentRopes = [...ropesRef.current]
            while (currentRopes.length - i < 3) {
              const lastRope = currentRopes[currentRopes.length - 1]
              const newRope = generateNextRope(lastRope.anchorX, scoreRef.current, ropeIdCounterRef.current++)
              currentRopes.push(newRope)
            }

            // Remove old ropes far behind
            const removeCount = Math.max(0, i - 2)
            if (removeCount > 0) {
              currentRopes = currentRopes.slice(removeCount)
              currentRopeIndexRef.current -= removeCount
              setCurrentRopeIndex(currentRopeIndexRef.current)
            }

            ropesRef.current = currentRopes
            setRopes(currentRopes)
            break
          }
        }

        // Check fall
        if (player.y > FALL_ZONE_Y) {
          phaseRef.current = 'falling'
          setPhase('falling')
          effects.triggerShake(5)
          effects.triggerFlash('rgba(239,68,68,0.5)')
          playSfx('fall', 0.6, 1)
          playSfx('gameOver', 0.6, 0.9)
          finishRound()
          animationFrameRef.current = null
          syncVisualState()
          return
        }

        // Check out of bounds horizontally
        if (player.x < -150 || player.x > VIEWBOX_WIDTH + 150) {
          phaseRef.current = 'falling'
          setPhase('falling')
          effects.triggerShake(5)
          effects.triggerFlash('rgba(239,68,68,0.5)')
          playSfx('fall', 0.6, 1)
          playSfx('gameOver', 0.6, 0.9)
          finishRound()
          animationFrameRef.current = null
          syncVisualState()
          return
        }
      }

      // Camera follows player horizontally
      const targetCameraX = player.x - VIEWBOX_WIDTH / 2
      cameraOffsetXRef.current += (targetCameraX - cameraOffsetXRef.current) * 0.08

      syncVisualState()
      effects.updateParticles()
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
  }, [finishRound, playSfx, syncVisualState, effects])

  // --- Derived visuals ---
  const currentRope = ropes[currentRopeIndex] ?? null
  const isSwinging = phase === 'swinging'

  const windIndicator = useMemo(() => {
    const absWind = Math.abs(windForce)
    if (absWind < 15) return ''
    const dir = windForce > 0 ? '>' : '<'
    const arrows = absWind > 80 ? dir.repeat(3) : absWind > 40 ? dir.repeat(2) : dir
    return arrows
  }, [windForce])

  // Player rotation based on velocity
  const playerRotation = useMemo(() => {
    if (phase === 'flying') {
      const player = playerRef.current
      return Math.atan2(player.vx, -player.vy) * (180 / Math.PI)
    }
    if (phase === 'swinging') {
      return pendulumAngle * (180 / Math.PI) * 0.5
    }
    return 0
  }, [phase, pendulumAngle, playerPos])

  return (
    <section
      className="mini-game-panel rope-swing-panel"
      aria-label="rope-swing-game"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '432px',
        height: '100%',
        margin: '0 auto',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #0f172a 0%, #1e3a5f 35%, #134e4a 70%, #065f46 100%)',
        ...effects.getShakeStyle(),
      }}
    >
      <div
        className="rope-swing-board"
        onClick={handleTap}
        onTouchStart={(e) => {
          e.preventDefault()
          handleTap()
        }}
        role="presentation"
        style={{ width: '100%', height: '100%', position: 'relative', cursor: 'pointer' }}
      >
        <svg
          className="rope-swing-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
          aria-label="rope-swing-stage"
        >
          {/* Definitions */}
          <defs>
            <linearGradient id="rs-rope-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
            <radialGradient id="rs-coin-grad" cx="35%" cy="35%">
              <stop offset="0%" stopColor="#fef3c7" />
              <stop offset="100%" stopColor="#f59e0b" />
            </radialGradient>
            <filter id="rs-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="rs-glow-strong">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Stars background */}
          {Array.from({ length: 30 }, (_, i) => (
            <circle
              key={`star-${i}`}
              cx={(i * 97 + 31) % VIEWBOX_WIDTH}
              cy={(i * 53 + 17) % (VIEWBOX_HEIGHT * 0.35)}
              r={i % 4 === 0 ? 2 : 1}
              fill="white"
              opacity={0.2 + (i % 5) * 0.1}
            >
              {i % 3 === 0 && (
                <animate attributeName="opacity" values="0.1;0.5;0.1" dur={`${2 + (i % 3)}s`} repeatCount="indefinite" />
              )}
            </circle>
          ))}

          {/* Bottom ground/jungle */}
          <rect x="0" y={VIEWBOX_HEIGHT - 60} width={VIEWBOX_WIDTH} height={60} fill="#052e16" opacity={0.6} />
          {Array.from({ length: 12 }, (_, i) => (
            <polygon
              key={`tree-${i}`}
              points={`${i * 32},${VIEWBOX_HEIGHT} ${i * 32 + 16},${VIEWBOX_HEIGHT - 30 - (i % 3) * 10} ${i * 32 + 32},${VIEWBOX_HEIGHT}`}
              fill={i % 2 === 0 ? '#064e3b' : '#065f46'}
              opacity={0.7}
            />
          ))}

          {/* Camera group */}
          <g transform={`translate(${(-cameraOffsetX).toFixed(2)}, 0)`}>
            {/* Trail */}
            {phase === 'flying' && trail.map((point, i) => (
              <circle
                key={`trail-${i}`}
                cx={point.x}
                cy={point.y}
                r={3 + point.opacity * 4}
                fill={isFever ? '#fbbf24' : '#34d399'}
                opacity={point.opacity * 0.6}
              />
            ))}

            {/* Ropes & anchors */}
            {ropes.map((rope, ropeIdx) => {
              const isActive = ropeIdx === currentRopeIndex && isSwinging
              const ropeBottomX = isActive
                ? rope.anchorX + Math.sin(pendulumAngle) * rope.length
                : rope.anchorX
              const ropeBottomY = isActive
                ? ROPE_ANCHOR_Y + Math.cos(pendulumAngle) * rope.length
                : ROPE_ANCHOR_Y + rope.length
              const isPast = ropeIdx < currentRopeIndex

              return (
                <g key={rope.id}>
                  {/* Anchor glow */}
                  {!isPast && (
                    <circle
                      cx={rope.anchorX}
                      cy={ROPE_ANCHOR_Y}
                      r={12}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth={1}
                      opacity={0.3}
                      filter="url(#rs-glow)"
                    />
                  )}
                  {/* Anchor point */}
                  <circle
                    cx={rope.anchorX}
                    cy={ROPE_ANCHOR_Y}
                    r={7}
                    fill="#fbbf24"
                    stroke="#92400e"
                    strokeWidth={2}
                    opacity={isPast ? 0.3 : 1}
                  />
                  {/* Rope line */}
                  <line
                    x1={rope.anchorX}
                    y1={ROPE_ANCHOR_Y}
                    x2={ropeBottomX}
                    y2={ropeBottomY}
                    stroke="url(#rs-rope-grad)"
                    strokeWidth={isActive ? 3.5 : 2.5}
                    strokeLinecap="round"
                    opacity={isPast ? 0.2 : 1}
                  />
                  {/* Grab zone hint for next rope */}
                  {ropeIdx === currentRopeIndex + 1 && (
                    <g>
                      <circle
                        cx={rope.anchorX}
                        cy={ROPE_ANCHOR_Y + rope.length * 0.6}
                        r={ROPE_GRAB_RADIUS}
                        fill="none"
                        stroke="#34d399"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        opacity={0.4}
                      >
                        <animate attributeName="opacity" values="0.2;0.5;0.2" dur="1.5s" repeatCount="indefinite" />
                      </circle>
                      {/* Arrow pointing to next rope */}
                      <text
                        x={rope.anchorX}
                        y={ROPE_ANCHOR_Y + rope.length * 0.6 - ROPE_GRAB_RADIUS - 8}
                        textAnchor="middle"
                        fill="#34d399"
                        fontSize={16}
                        opacity={0.6}
                      >
                        v
                      </text>
                    </g>
                  )}
                </g>
              )
            })}

            {/* Coins */}
            {coins.map((coin) => (
              <g key={`coin-${coin.id}`}>
                <circle cx={coin.x} cy={coin.y} r={COIN_RADIUS} fill="url(#rs-coin-grad)" stroke="#d97706" strokeWidth={2} filter="url(#rs-glow)">
                  <animate attributeName="r" values={`${COIN_RADIUS};${COIN_RADIUS + 2};${COIN_RADIUS}`} dur="1s" repeatCount="indefinite" />
                </circle>
                <text x={coin.x} y={coin.y + 5} textAnchor="middle" fill="#92400e" fontSize={14} fontWeight="bold">$</text>
              </g>
            ))}

            {/* Power-ups */}
            {powerups.map((pu) => {
              const icon = POWERUP_ICONS[pu.type]
              return (
                <g key={`pu-${pu.id}`}>
                  <circle cx={pu.x} cy={pu.y} r={POWERUP_RADIUS} fill={icon.color} opacity={0.3} filter="url(#rs-glow-strong)">
                    <animate attributeName="r" values={`${POWERUP_RADIUS};${POWERUP_RADIUS + 4};${POWERUP_RADIUS}`} dur="1.2s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={pu.x} cy={pu.y} r={POWERUP_RADIUS} fill={icon.color} opacity={0.8} stroke="white" strokeWidth={2} />
                  <text x={pu.x} y={pu.y + 6} textAnchor="middle" fontSize={16}>{icon.emoji}</text>
                </g>
              )
            })}

            {/* Obstacles */}
            {obstacles.map((obs) => (
              <g key={`obs-${obs.id}`}>
                <text x={obs.x} y={obs.y + 8} textAnchor="middle" fontSize={obs.type === 'bird' ? 28 : 32}>
                  {obs.type === 'bird' ? '🦅' : '⛈️'}
                </text>
              </g>
            ))}

            {/* Player */}
            <g transform={`translate(${playerPos.x}, ${playerPos.y})`}>
              {/* Shield effect */}
              {hasShield && (
                <circle cx={0} cy={0} r={PLAYER_WIDTH * 0.7} fill="none" stroke="#3b82f6" strokeWidth={3} opacity={0.6} filter="url(#rs-glow)">
                  <animate attributeName="r" values={`${PLAYER_WIDTH * 0.65};${PLAYER_WIDTH * 0.75};${PLAYER_WIDTH * 0.65}`} dur="1s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.4;0.7;0.4" dur="1s" repeatCount="indefinite" />
                </circle>
              )}
              {/* Shadow */}
              <ellipse
                cx={0}
                cy={PLAYER_HEIGHT / 2 + 4}
                rx={14}
                ry={4}
                fill="rgba(0,0,0,0.3)"
              />
              {/* Character sprite */}
              <g transform={`rotate(${playerRotation.toFixed(1)})`}>
                <image
                  href={taeJinaSprite}
                  x={-PLAYER_WIDTH / 2}
                  y={-PLAYER_HEIGHT / 2}
                  width={PLAYER_WIDTH}
                  height={PLAYER_HEIGHT}
                  preserveAspectRatio="xMidYMid meet"
                />
              </g>
              {/* Fever glow around player */}
              {isFever && (
                <circle cx={0} cy={0} r={PLAYER_WIDTH * 0.5} fill="none" stroke="#fbbf24" strokeWidth={2} opacity={0.5} filter="url(#rs-glow-strong)">
                  <animate attributeName="opacity" values="0.3;0.7;0.3" dur="0.5s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          </g>

          {/* Danger zone at bottom */}
          <rect x="0" y={VIEWBOX_HEIGHT - 30} width={VIEWBOX_WIDTH} height={30} fill="rgba(239,68,68,0.12)" />
          <line x1="0" y1={VIEWBOX_HEIGHT - 30} x2={VIEWBOX_WIDTH} y2={VIEWBOX_HEIGHT - 30} stroke="#ef4444" strokeWidth={1} strokeDasharray="8 4" opacity={0.4} />
        </svg>

        {/* HUD overlay */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 16px',
          display: 'flex', flexDirection: 'column', gap: '4px', pointerEvents: 'none',
          zIndex: 10,
        }}>
          {/* Score row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{
                fontSize: 'clamp(2.5rem, 8vw, 3.5rem)', fontWeight: 900, color: 'white', margin: 0,
                textShadow: '0 2px 8px rgba(0,0,0,0.5), 0 0 20px rgba(251,191,36,0.3)',
                lineHeight: 1,
              }}>
                {score}
              </p>
              <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
                BEST {displayedBestScore}
              </p>
            </div>
            <div style={{ textAlign: 'right' }}>
              {combo > 1 && (
                <p style={{
                  fontSize: 'clamp(1.2rem, 4vw, 1.8rem)', fontWeight: 800, margin: 0,
                  color: comboMultiplier >= 3 ? '#fbbf24' : '#34d399',
                  textShadow: '0 0 8px currentColor',
                  animation: 'rs-pulse 0.3s ease-out',
                }}>
                  x{comboMultiplier}
                </p>
              )}
              {isFever && (
                <p style={{
                  fontSize: '1rem', fontWeight: 800, color: '#fbbf24', margin: 0,
                  textShadow: '0 0 10px #f59e0b',
                  animation: 'rs-fever-glow 0.5s ease-in-out infinite alternate',
                }}>
                  FEVER!
                </p>
              )}
            </div>
          </div>

          {/* Active powerups */}
          {(hasMagnet || hasShield || hasScoreX2 || doubleJumpsLeft > 0) && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {hasMagnet && <span style={{ background: 'rgba(239,68,68,0.3)', borderRadius: 8, padding: '2px 8px', fontSize: 12, color: 'white' }}>🧲 Magnet</span>}
              {hasShield && <span style={{ background: 'rgba(59,130,246,0.3)', borderRadius: 8, padding: '2px 8px', fontSize: 12, color: 'white' }}>🛡️ Shield</span>}
              {hasScoreX2 && <span style={{ background: 'rgba(245,158,11,0.3)', borderRadius: 8, padding: '2px 8px', fontSize: 12, color: 'white' }}>x2 Score</span>}
              {doubleJumpsLeft > 0 && <span style={{ background: 'rgba(34,197,94,0.3)', borderRadius: 8, padding: '2px 8px', fontSize: 12, color: 'white' }}>⬆️ Jump x{doubleJumpsLeft}</span>}
            </div>
          )}
        </div>

        {/* Wind indicator */}
        {windIndicator && (
          <div style={{
            position: 'absolute', top: '50%', right: windForce > 0 ? 8 : 'auto', left: windForce < 0 ? 8 : 'auto',
            color: 'rgba(255,255,255,0.4)', fontSize: '1.5rem', fontWeight: 800, pointerEvents: 'none',
            transform: 'translateY(-50%)',
          }}>
            {windIndicator}
          </div>
        )}

        {/* Perfect grab popup */}
        {showPerfect && (
          <div style={{
            position: 'absolute', top: '35%', left: '50%', transform: 'translate(-50%, -50%)',
            fontSize: 'clamp(2rem, 7vw, 3rem)', fontWeight: 900, color: '#fbbf24',
            textShadow: '0 0 20px #f59e0b, 0 2px 4px rgba(0,0,0,0.5)',
            animation: 'rs-perfect-pop 0.6s ease-out forwards', pointerEvents: 'none', zIndex: 20,
          }}>
            PERFECT!
          </div>
        )}

        {/* Coins collected */}
        {coinsCollected > 0 && (
          <div style={{
            position: 'absolute', bottom: 60, left: 16, color: '#fbbf24', fontSize: '1rem',
            fontWeight: 700, pointerEvents: 'none', textShadow: '0 1px 4px rgba(0,0,0,0.5)',
          }}>
            $ {coinsCollected}
          </div>
        )}

        {/* Swing count */}
        <div style={{
          position: 'absolute', bottom: 60, right: 16, color: 'rgba(255,255,255,0.5)', fontSize: '0.8rem',
          pointerEvents: 'none',
        }}>
          Swings: {swingCount}
        </div>

        {/* Double jump hint */}
        {phase === 'flying' && doubleJumpsLeft > 0 && (
          <div style={{
            position: 'absolute', bottom: '20%', left: '50%', transform: 'translateX(-50%)',
            color: '#22c55e', fontSize: '1rem', fontWeight: 700, pointerEvents: 'none',
            textShadow: '0 0 8px rgba(34,197,94,0.5)',
            animation: 'rs-pulse 0.8s ease-in-out infinite',
          }}>
            TAP for Double Jump!
          </div>
        )}

        {/* Tap hint */}
        {phase === 'swinging' && score === 0 && (
          <div style={{
            position: 'absolute', bottom: '15%', left: '50%', transform: 'translateX(-50%)',
            color: 'rgba(255,255,255,0.6)', fontSize: '1.2rem', fontWeight: 600, pointerEvents: 'none',
            animation: 'rs-pulse 1.5s ease-in-out infinite',
          }}>
            Tap to release!
          </div>
        )}

        {/* Action buttons */}
        <div style={{
          position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 12, pointerEvents: 'auto', zIndex: 15,
        }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              finishRound()
            }}
            style={{
              padding: '8px 20px', borderRadius: 20, border: '2px solid rgba(255,255,255,0.3)',
              background: 'rgba(0,0,0,0.4)', color: 'white', fontSize: '0.85rem', fontWeight: 700,
              cursor: 'pointer', backdropFilter: 'blur(4px)',
            }}
          >
            FINISH
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onExit()
            }}
            style={{
              padding: '8px 20px', borderRadius: 20, border: '2px solid rgba(255,255,255,0.2)',
              background: 'rgba(0,0,0,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', fontWeight: 700,
              cursor: 'pointer', backdropFilter: 'blur(4px)',
            }}
          >
            EXIT
          </button>
        </div>
      </div>

      <style>{GAME_EFFECTS_CSS}{`
        @keyframes rs-pulse {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.1); opacity: 1; }
        }
        @keyframes rs-fever-glow {
          from { text-shadow: 0 0 10px #f59e0b; }
          to { text-shadow: 0 0 20px #f59e0b, 0 0 40px #fbbf24; }
        }
        @keyframes rs-perfect-pop {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
          30% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          100% { transform: translate(-50%, -80%) scale(1); opacity: 0; }
        }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const ropeSwingModule: MiniGameModule = {
  manifest: {
    id: 'rope-swing',
    title: 'Rope Swing',
    description: 'Swing on ropes! Grab power-ups and dodge obstacles!',
    unlockCost: 55,
    baseReward: 17,
    scoreRewardMultiplier: 1.25,
    accentColor: '#059669',
  },
  Component: RopeSwingGame,
}
