import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/park-wankyu.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// Dedicated sounds
import sfxJump from '../../../assets/sounds/lava-floor-jump.mp3'
import sfxCoin from '../../../assets/sounds/lava-floor-coin.mp3'
import sfxCombo from '../../../assets/sounds/lava-floor-combo.mp3'
import sfxCrumble from '../../../assets/sounds/lava-floor-crumble.mp3'
import sfxFall from '../../../assets/sounds/lava-floor-fall.mp3'
import sfxFever from '../../../assets/sounds/lava-floor-fever.mp3'
import sfxShield from '../../../assets/sounds/lava-floor-shield.mp3'
import sfxBubble from '../../../assets/sounds/lava-floor-bubble.mp3'
import sfxEruption from '../../../assets/sounds/lava-floor-eruption.mp3'
import sfxPlatformMove from '../../../assets/sounds/lava-floor-platform-move.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// --- Layout ---
const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 720

// --- Character ---
const CHARACTER_SIZE = 56

// --- Lava ---
const LAVA_HEIGHT = 70
const LAVA_TOP_Y = VIEWBOX_HEIGHT - LAVA_HEIGHT

// --- Platform types ---
type PlatformType = 'normal' | 'moving' | 'spring' | 'crumble' | 'ice'

// --- Platform constants ---
const PLATFORM_INITIAL_WIDTH = 60
const PLATFORM_MIN_WIDTH = 26
const PLATFORM_WIDTH_SHRINK_PER_JUMP = 1.0
const PLATFORM_HEIGHT = 14
const PLATFORM_CORNER_RADIUS = 7

const PLATFORM_INITIAL_LIFETIME_MS = 3200
const PLATFORM_MIN_LIFETIME_MS = 1000
const PLATFORM_LIFETIME_SHRINK_PER_JUMP = 50
const PLATFORM_BLINK_THRESHOLD_MS = 900

const PLATFORM_SPAWN_INTERVAL_INITIAL_MS = 1400
const PLATFORM_SPAWN_INTERVAL_MIN_MS = 500
const PLATFORM_SPAWN_INTERVAL_SHRINK_PER_JUMP = 30

const PLATFORM_SPAWN_MARGIN_X = 36
const PLATFORM_SPAWN_MIN_Y = 60
const PLATFORM_SPAWN_MAX_Y = LAVA_TOP_Y - 50

const MAX_ACTIVE_PLATFORMS = 8

// --- Moving platform ---
const MOVING_PLATFORM_SPEED = 40
const MOVING_PLATFORM_RANGE = 60

// --- Spring platform ---
const SPRING_BOUNCE_BONUS = 3
const SPRING_ARC_HEIGHT = -140

// --- Crumble platform ---
const CRUMBLE_DELAY_MS = 400

// --- Player ---
const PLAYER_RADIUS = 14
const PLAYER_JUMP_DURATION_MS = 260

// --- Physics ---
const GRAVITY = 2000
const FALL_START_DELAY_MS = 500
const GAME_TIMEOUT_MS = 120000

// --- Gimmick constants ---
const COIN_SIZE = 18
const COIN_SCORE = 5
const COIN_SPAWN_CHANCE = 0.35
const SHIELD_SPAWN_CHANCE = 0.08
const SHIELD_SIZE = 16

const FEVER_THRESHOLD = 12
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 3
const COMBO_WINDOW_MS = 3500

// --- Eruption hazard ---
const ERUPTION_INTERVAL_MS = 8000
const ERUPTION_DURATION_MS = 2000
const ERUPTION_WIDTH = 50

interface Platform {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly spawnedAt: number
  readonly lifetimeMs: number
  readonly hasCoin: boolean
  readonly hasShield: boolean
  readonly type: PlatformType
  readonly moveDir: number
  readonly crumbleAt: number | null
}

interface PlayerState {
  readonly x: number
  readonly y: number
  readonly isJumping: boolean
  readonly jumpStartX: number
  readonly jumpStartY: number
  readonly jumpTargetX: number
  readonly jumpTargetY: number
  readonly jumpElapsedMs: number
  readonly isFalling: boolean
  readonly fallVelocity: number
  readonly standingPlatformId: number | null
  readonly hasShield: boolean
  readonly shieldUsedAt: number | null
  readonly arcHeight: number
}

interface Eruption {
  readonly x: number
  readonly startAt: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function getPlatformWidth(jumps: number): number {
  return Math.max(PLATFORM_MIN_WIDTH, PLATFORM_INITIAL_WIDTH - jumps * PLATFORM_WIDTH_SHRINK_PER_JUMP)
}

function getPlatformLifetime(jumps: number): number {
  return Math.max(PLATFORM_MIN_LIFETIME_MS, PLATFORM_INITIAL_LIFETIME_MS - jumps * PLATFORM_LIFETIME_SHRINK_PER_JUMP)
}

function getSpawnInterval(jumps: number): number {
  return Math.max(PLATFORM_SPAWN_INTERVAL_MIN_MS, PLATFORM_SPAWN_INTERVAL_INITIAL_MS - jumps * PLATFORM_SPAWN_INTERVAL_SHRINK_PER_JUMP)
}

function easeOutQuad(t: number): number {
  return t * (2 - t)
}

function pickPlatformType(jumps: number): PlatformType {
  if (jumps < 3) return 'normal'
  const r = Math.random()
  if (jumps >= 20 && r < 0.12) return 'ice'
  if (jumps >= 10 && r < 0.22) return 'crumble'
  if (jumps >= 5 && r < 0.35) return 'spring'
  if (r < 0.50) return 'moving'
  return 'normal'
}

function createPlatform(id: number, now: number, jumps: number): Platform {
  const width = getPlatformWidth(jumps)
  const x = randomBetween(PLATFORM_SPAWN_MARGIN_X, VIEWBOX_WIDTH - PLATFORM_SPAWN_MARGIN_X - width)
  const y = randomBetween(PLATFORM_SPAWN_MIN_Y, PLATFORM_SPAWN_MAX_Y)
  const lifetimeMs = getPlatformLifetime(jumps)
  const hasCoin = Math.random() < COIN_SPAWN_CHANCE
  const hasShield = !hasCoin && Math.random() < SHIELD_SPAWN_CHANCE
  const type = pickPlatformType(jumps)
  const moveDir = Math.random() > 0.5 ? 1 : -1
  return { id, x, y, width, spawnedAt: now, lifetimeMs, hasCoin, hasShield, type, moveDir, crumbleAt: null }
}

function createStartPlatform(id: number, now: number): Platform {
  const width = PLATFORM_INITIAL_WIDTH * 1.6
  const x = VIEWBOX_WIDTH / 2 - width / 2
  const y = VIEWBOX_HEIGHT / 2 + 60
  return { id, x, y, width, spawnedAt: now, lifetimeMs: 999999, hasCoin: false, hasShield: false, type: 'normal', moveDir: 0, crumbleAt: null }
}

function isPlatformExpired(platform: Platform, now: number): boolean {
  if (platform.crumbleAt !== null && now >= platform.crumbleAt) return true
  return now - platform.spawnedAt >= platform.lifetimeMs
}

function isPlatformBlinking(platform: Platform, now: number): boolean {
  const remaining = platform.lifetimeMs - (now - platform.spawnedAt)
  return remaining > 0 && remaining <= PLATFORM_BLINK_THRESHOLD_MS
}

function getPlatformOpacity(platform: Platform, now: number): number {
  const elapsed = now - platform.spawnedAt
  const remaining = platform.lifetimeMs - elapsed

  if (remaining <= 0) return 0

  if (platform.crumbleAt !== null) {
    const crumbleRemaining = platform.crumbleAt - now
    if (crumbleRemaining <= 0) return 0
    return clampNumber(crumbleRemaining / CRUMBLE_DELAY_MS, 0, 1)
  }

  if (remaining <= PLATFORM_BLINK_THRESHOLD_MS) {
    const blinkPhase = Math.sin((elapsed / 80) * Math.PI)
    return 0.3 + Math.abs(blinkPhase) * 0.5
  }

  const fadeInDuration = 200
  if (elapsed < fadeInDuration) return elapsed / fadeInDuration

  return 1
}

function getMovingPlatformX(platform: Platform, now: number): number {
  if (platform.type !== 'moving') return platform.x
  const elapsed = now - platform.spawnedAt
  const offset = Math.sin(elapsed / 1000 * MOVING_PLATFORM_SPEED / MOVING_PLATFORM_RANGE) * MOVING_PLATFORM_RANGE * platform.moveDir
  return clampNumber(platform.x + offset, 4, VIEWBOX_WIDTH - platform.width - 4)
}

function getPlatformColor(platform: Platform, lifeRatio: number, isFever: boolean): { hue: number; saturation: number; lightness: number } {
  if (isFever) return { hue: 40, saturation: 90, lightness: 60 }
  switch (platform.type) {
    case 'spring': return { hue: 120, saturation: 80, lightness: 55 }
    case 'moving': return { hue: 220, saturation: 75, lightness: 60 }
    case 'crumble': return { hue: 30, saturation: 70, lightness: 50 }
    case 'ice': return { hue: 195, saturation: 85, lightness: 70 }
    default: {
      const hue = lifeRatio > 0.5 ? 140 : lifeRatio > 0.25 ? 50 : 0
      return { hue, saturation: 70, lightness: 55 + (1 - lifeRatio) * 15 }
    }
  }
}

function isPlayerOnPlatform(playerX: number, playerY: number, platform: Platform, now: number): boolean {
  const px = getMovingPlatformX(platform, now)
  const playerBottom = playerY + PLAYER_RADIUS
  const platformTop = platform.y
  const platformBottom = platform.y + PLATFORM_HEIGHT
  const verticalMatch = playerBottom >= platformTop - 5 && playerBottom <= platformBottom + 5
  const horizontalMatch = playerX >= px - 5 && playerX <= px + platform.width + 5
  return verticalMatch && horizontalMatch
}

function LavaFloorGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [player, setPlayer] = useState<PlayerState>({
    x: VIEWBOX_WIDTH / 2, y: VIEWBOX_HEIGHT / 2 + 60 - PLAYER_RADIUS,
    isJumping: false, jumpStartX: 0, jumpStartY: 0, jumpTargetX: 0, jumpTargetY: 0, jumpElapsedMs: 0,
    isFalling: false, fallVelocity: 0, standingPlatformId: null, hasShield: false, shieldUsedAt: null,
    arcHeight: -90,
  })
  const [gamePhase, setGamePhase] = useState<'playing' | 'falling' | 'finished'>('playing')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [coinCount, setCoinCount] = useState(0)
  const [collectedIds, setCollectedIds] = useState<Set<number>>(new Set())
  const [eruptions, setEruptions] = useState<Eruption[]>([])
  const [jumpTrail, setJumpTrail] = useState<{ x: number; y: number; age: number }[]>([])

  const scoreRef = useRef(0)
  const platformsRef = useRef<Platform[]>([])
  const playerRef = useRef<PlayerState>(player)
  const gamePhaseRef = useRef<'playing' | 'falling' | 'finished'>('playing')
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const nextPlatformIdRef = useRef(1)
  const lastSpawnAtRef = useRef(0)
  const jumpCountRef = useRef(0)
  const fallStartAtRef = useRef<number | null>(null)
  const comboRef = useRef(0)
  const lastJumpAtRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const coinCountRef = useRef(0)
  const collectedIdsRef = useRef<Set<number>>(new Set())
  const eruptionsRef = useRef<Eruption[]>([])
  const lastEruptionAtRef = useRef(0)
  const jumpTrailRef = useRef<{ x: number; y: number; age: number }[]>([])

  // Audio pool
  const audioPool = useRef<Map<string, HTMLAudioElement>>(new Map())

  const loadAudio = useCallback((key: string, src: string) => {
    if (audioPool.current.has(key)) return
    const a = new Audio(src)
    a.preload = 'auto'
    audioPool.current.set(key, a)
  }, [])

  const sfx = useCallback((key: string, vol: number, rate = 1) => {
    const a = audioPool.current.get(key)
    if (!a) return
    a.currentTime = 0
    a.volume = Math.min(1, Math.max(0, vol))
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const finishRound = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    const finalDurationMs = elapsedMsRef.current > 0 ? Math.round(elapsedMsRef.current) : Math.round(DEFAULT_FRAME_MS)
    onFinish({ score: scoreRef.current, durationMs: finalDurationMs })
  }, [onFinish])

  const handlePlatformTap = useCallback(
    (platform: Platform) => {
      if (finishedRef.current) return
      if (gamePhaseRef.current !== 'playing') return

      const currentPlayer = playerRef.current
      if (currentPlayer.isJumping) return
      if (currentPlayer.standingPlatformId === platform.id) return

      const gameNow = elapsedMsRef.current
      const px = getMovingPlatformX(platform, gameNow)
      const jumpTargetX = px + platform.width / 2
      const jumpTargetY = platform.y - PLAYER_RADIUS

      const isSpring = platform.type === 'spring'
      const arcH = isSpring ? SPRING_ARC_HEIGHT : -90

      const nextPlayer: PlayerState = {
        ...currentPlayer,
        isJumping: true,
        jumpStartX: currentPlayer.x,
        jumpStartY: currentPlayer.y,
        jumpTargetX,
        jumpTargetY,
        jumpElapsedMs: 0,
        isFalling: false,
        fallVelocity: 0,
        standingPlatformId: platform.id,
        arcHeight: arcH,
      }

      playerRef.current = nextPlayer
      setPlayer(nextPlayer)

      // Mark crumble platforms
      if (platform.type === 'crumble' && platform.crumbleAt === null) {
        const updatedPlatforms = platformsRef.current.map(p =>
          p.id === platform.id ? { ...p, crumbleAt: gameNow + CRUMBLE_DELAY_MS } : p
        )
        platformsRef.current = updatedPlatforms
        sfx('crumble', 0.5, 1)
      }

      const nextJumpCount = jumpCountRef.current + 1
      jumpCountRef.current = nextJumpCount

      // Combo system
      const timeSinceLastJump = gameNow - lastJumpAtRef.current
      lastJumpAtRef.current = gameNow

      let nextCombo: number
      if (timeSinceLastJump < COMBO_WINDOW_MS && nextJumpCount > 1) {
        nextCombo = comboRef.current + 1
      } else {
        nextCombo = 1
      }
      comboRef.current = nextCombo
      setCombo(nextCombo)

      // Fever mode activation
      if (nextCombo >= FEVER_THRESHOLD && !isFeverRef.current) {
        isFeverRef.current = true
        feverRemainingMsRef.current = FEVER_DURATION_MS
        setIsFever(true)
        setFeverRemainingMs(FEVER_DURATION_MS)
        effects.triggerFlash('#fbbf24')
        sfx('fever', 0.7, 1.2)
      }

      // Score calculation
      const baseScore = 1
      const comboBonus = Math.floor(nextCombo / 4)
      const springBonus = isSpring ? SPRING_BOUNCE_BONUS : 0
      const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
      const jumpScore = (baseScore + comboBonus + springBonus) * feverMult

      scoreRef.current += jumpScore
      setScore(scoreRef.current)

      // Collect coin
      if (platform.hasCoin && !collectedIdsRef.current.has(platform.id)) {
        collectedIdsRef.current = new Set([...collectedIdsRef.current, platform.id])
        setCollectedIds(new Set(collectedIdsRef.current))
        const coinScore = COIN_SCORE * feverMult
        scoreRef.current += coinScore
        setScore(scoreRef.current)
        coinCountRef.current += 1
        setCoinCount(coinCountRef.current)
        effects.showScorePopup(coinScore, jumpTargetX, jumpTargetY - 24)
        sfx('coin', 0.6, 1.2)
      }

      // Collect shield
      if (platform.hasShield && !collectedIdsRef.current.has(platform.id + 100000)) {
        collectedIdsRef.current = new Set([...collectedIdsRef.current, platform.id + 100000])
        setCollectedIds(new Set(collectedIdsRef.current))
        playerRef.current = { ...playerRef.current, hasShield: true }
        setPlayer(prev => ({ ...prev, hasShield: true }))
        sfx('shield', 0.6, 1)
        effects.triggerFlash('#38bdf8')
      }

      // Sound + effects
      if (nextJumpCount % 5 === 0) {
        sfx('combo', 0.6, 1 + Math.min(0.3, nextJumpCount * 0.006))
        effects.comboHitBurst(jumpTargetX, jumpTargetY, nextCombo, jumpScore)
      } else {
        sfx('jump', 0.5, 1 + Math.min(0.25, nextJumpCount * 0.005))
        effects.triggerShake(3)
        effects.spawnParticles(isFeverRef.current ? 7 : 3, jumpTargetX, jumpTargetY)
        effects.showScorePopup(jumpScore, jumpTargetX, jumpTargetY)
      }

      // Jump trail
      jumpTrailRef.current = [
        { x: currentPlayer.x, y: currentPlayer.y, age: 0 },
        ...jumpTrailRef.current.slice(0, 5),
      ]
    },
    [sfx],
  )

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  // Initialize audio
  useEffect(() => {
    loadAudio('jump', sfxJump)
    loadAudio('coin', sfxCoin)
    loadAudio('combo', sfxCombo)
    loadAudio('crumble', sfxCrumble)
    loadAudio('fall', sfxFall)
    loadAudio('fever', sfxFever)
    loadAudio('shield', sfxShield)
    loadAudio('bubble', sfxBubble)
    loadAudio('eruption', sfxEruption)
    loadAudio('platformMove', sfxPlatformMove)
    loadAudio('gameOver', gameOverHitSfx)

    const charImage = new Image()
    charImage.src = characterSprite
    void charImage.decode?.().catch(() => {})

    return () => {
      audioPool.current.forEach(a => { a.pause(); a.currentTime = 0 })
    }
  }, [loadAudio])

  // Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  // Main game loop
  useEffect(() => {
    const startPlatform = createStartPlatform(0, 0)
    platformsRef.current = [startPlatform]
    setPlatforms([startPlatform])

    const initialPlayer: PlayerState = {
      x: startPlatform.x + startPlatform.width / 2,
      y: startPlatform.y - PLAYER_RADIUS,
      isJumping: false, jumpStartX: 0, jumpStartY: 0, jumpTargetX: 0, jumpTargetY: 0, jumpElapsedMs: 0,
      isFalling: false, fallVelocity: 0, standingPlatformId: startPlatform.id,
      hasShield: false, shieldUsedAt: null, arcHeight: -90,
    }
    playerRef.current = initialPlayer
    setPlayer(initialPlayer)
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs
      setElapsedMs(elapsedMsRef.current)

      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        gamePhaseRef.current = 'finished'
        setGamePhase('finished')
        finishRound()
        animationFrameRef.current = null
        return
      }

      // Update fever timer
      if (isFeverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) { isFeverRef.current = false; setIsFever(false) }
      }

      const gameNow = elapsedMsRef.current
      const currentJumps = jumpCountRef.current

      // Spawn platforms
      const spawnInterval = getSpawnInterval(currentJumps)
      if (gameNow - lastSpawnAtRef.current >= spawnInterval && platformsRef.current.length < MAX_ACTIVE_PLATFORMS) {
        const newId = nextPlatformIdRef.current
        nextPlatformIdRef.current += 1
        const newPlatform = createPlatform(newId, gameNow, currentJumps)
        platformsRef.current = [...platformsRef.current, newPlatform]
        lastSpawnAtRef.current = gameNow
      }

      // Remove expired platforms
      const alivePlatforms = platformsRef.current.filter(p => !isPlatformExpired(p, gameNow))
      platformsRef.current = alivePlatforms
      setPlatforms([...alivePlatforms])

      // Eruption hazard
      if (gameNow > 15000 && gameNow - lastEruptionAtRef.current >= ERUPTION_INTERVAL_MS) {
        lastEruptionAtRef.current = gameNow
        const eruptX = randomBetween(20, VIEWBOX_WIDTH - 20 - ERUPTION_WIDTH)
        eruptionsRef.current = [...eruptionsRef.current, { x: eruptX, startAt: gameNow }]
        sfx('eruption', 0.5, 1)
        effects.triggerShake(5, 400)
      }
      // Clean old eruptions
      eruptionsRef.current = eruptionsRef.current.filter(e => gameNow - e.startAt < ERUPTION_DURATION_MS)
      setEruptions([...eruptionsRef.current])

      // Update player
      let currentPlayer = playerRef.current

      if (currentPlayer.isJumping) {
        const nextJumpElapsed = currentPlayer.jumpElapsedMs + deltaMs
        const jumpProgress = clampNumber(nextJumpElapsed / PLAYER_JUMP_DURATION_MS, 0, 1)
        const easedProgress = easeOutQuad(jumpProgress)

        const jumpX = currentPlayer.jumpStartX + (currentPlayer.jumpTargetX - currentPlayer.jumpStartX) * easedProgress
        const linearY = currentPlayer.jumpStartY + (currentPlayer.jumpTargetY - currentPlayer.jumpStartY) * easedProgress
        const arcHeight = currentPlayer.arcHeight * Math.sin(jumpProgress * Math.PI)
        const jumpY = linearY + arcHeight

        if (jumpProgress >= 1) {
          currentPlayer = { ...currentPlayer, x: currentPlayer.jumpTargetX, y: currentPlayer.jumpTargetY, isJumping: false, jumpElapsedMs: 0 }
        } else {
          currentPlayer = { ...currentPlayer, x: jumpX, y: jumpY, jumpElapsedMs: nextJumpElapsed }
        }
      }

      // Track player on moving platform
      if (!currentPlayer.isJumping && !currentPlayer.isFalling && currentPlayer.standingPlatformId !== null) {
        const standingPlatform = alivePlatforms.find(p => p.id === currentPlayer.standingPlatformId)
        if (standingPlatform && standingPlatform.type === 'moving') {
          const px = getMovingPlatformX(standingPlatform, gameNow)
          currentPlayer = { ...currentPlayer, x: px + standingPlatform.width / 2 }
        }
      }

      // Check if standing platform disappeared
      if (!currentPlayer.isJumping && !currentPlayer.isFalling && gamePhaseRef.current === 'playing') {
        const standingPlatform = alivePlatforms.find(p => p.id === currentPlayer.standingPlatformId)
        if (!standingPlatform || !isPlayerOnPlatform(currentPlayer.x, currentPlayer.y, standingPlatform, gameNow)) {
          if (fallStartAtRef.current === null) fallStartAtRef.current = gameNow
          if (gameNow - fallStartAtRef.current >= FALL_START_DELAY_MS) {
            // Shield save
            if (currentPlayer.hasShield) {
              currentPlayer = { ...currentPlayer, hasShield: false, shieldUsedAt: gameNow }
              sfx('shield', 0.6, 0.8)
              effects.triggerFlash('#38bdf8')
              effects.spawnParticles(10, currentPlayer.x, currentPlayer.y)
              // Find nearest platform to teleport
              const nearest = alivePlatforms.reduce<Platform | null>((best, p) => {
                const dist = Math.abs(p.y - currentPlayer.y) + Math.abs(getMovingPlatformX(p, gameNow) + p.width / 2 - currentPlayer.x)
                if (!best) return p
                const bestDist = Math.abs(best.y - currentPlayer.y) + Math.abs(getMovingPlatformX(best, gameNow) + best.width / 2 - currentPlayer.x)
                return dist < bestDist ? p : best
              }, null)
              if (nearest) {
                const npx = getMovingPlatformX(nearest, gameNow)
                currentPlayer = { ...currentPlayer, x: npx + nearest.width / 2, y: nearest.y - PLAYER_RADIUS, standingPlatformId: nearest.id }
                fallStartAtRef.current = null
              }
            } else {
              currentPlayer = { ...currentPlayer, isFalling: true, fallVelocity: 0, standingPlatformId: null }
              gamePhaseRef.current = 'falling'
              setGamePhase('falling')
              comboRef.current = 0
              setCombo(0)
            }
          }
        } else {
          fallStartAtRef.current = null
        }
      }

      // Check eruption damage
      for (const eruption of eruptionsRef.current) {
        const progress = (gameNow - eruption.startAt) / ERUPTION_DURATION_MS
        if (progress > 0.2 && progress < 0.8) {
          if (currentPlayer.x >= eruption.x && currentPlayer.x <= eruption.x + ERUPTION_WIDTH) {
            if (currentPlayer.y + PLAYER_RADIUS >= LAVA_TOP_Y - 60) {
              if (!currentPlayer.isFalling && gamePhaseRef.current === 'playing') {
                if (currentPlayer.hasShield) {
                  currentPlayer = { ...currentPlayer, hasShield: false, shieldUsedAt: gameNow }
                  sfx('shield', 0.6, 0.8)
                  effects.triggerFlash('#38bdf8')
                } else {
                  currentPlayer = { ...currentPlayer, isFalling: true, fallVelocity: 200, standingPlatformId: null }
                  gamePhaseRef.current = 'falling'
                  setGamePhase('falling')
                  effects.triggerFlash('#ef4444')
                }
              }
            }
          }
        }
      }

      // Apply gravity when falling
      if (currentPlayer.isFalling) {
        const deltaSec = deltaMs / 1000
        const nextVelocity = currentPlayer.fallVelocity + GRAVITY * deltaSec
        const nextY = currentPlayer.y + nextVelocity * deltaSec

        currentPlayer = { ...currentPlayer, y: nextY, fallVelocity: nextVelocity }

        if (nextY + PLAYER_RADIUS >= LAVA_TOP_Y) {
          gamePhaseRef.current = 'finished'
          setGamePhase('finished')
          sfx('fall', 0.6, 0.9)
          sfx('gameOver', 0.5, 0.8)
          effects.triggerFlash('#ff4500')
          effects.triggerShake(8, 600)
          finishRound()
          animationFrameRef.current = null
          playerRef.current = currentPlayer
          setPlayer(currentPlayer)
          return
        }
      }

      // Update jump trail
      jumpTrailRef.current = jumpTrailRef.current
        .map(t => ({ ...t, age: t.age + deltaMs }))
        .filter(t => t.age < 300)
      setJumpTrail([...jumpTrailRef.current])

      playerRef.current = currentPlayer
      setPlayer(currentPlayer)
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
      effects.cleanup()
    }
  }, [finishRound, sfx])

  const gameNow = elapsedMs
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  return (
    <section className="mini-game-panel lf-panel" aria-label="lava-floor-game" style={{ maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .lf-panel {
          background: linear-gradient(180deg, #1a0a00 0%, #2d1200 20%, #1a0a2e 60%, #0f0f1a 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .lf-hud {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 12px;
          background: linear-gradient(180deg, rgba(249,115,22,0.28) 0%, rgba(249,115,22,0.06) 100%);
          border-bottom: 1px solid rgba(249,115,22,0.3);
          flex-shrink: 0;
        }

        .lf-hud-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 2px solid #f97316;
          object-fit: cover;
          box-shadow: 0 0 10px rgba(249,115,22,0.5);
          flex-shrink: 0;
        }

        .lf-score {
          font-size: 28px;
          font-weight: 900;
          color: #f97316;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 12px rgba(249,115,22,0.5);
        }

        .lf-best {
          font-size: 9px;
          color: #9ca3af;
          margin: 0;
        }

        .lf-time {
          font-size: 14px;
          font-weight: 700;
          color: #e5e7eb;
          margin: 0;
        }

        .lf-svg {
          width: 100%;
          flex: 1;
          min-height: 0;
          display: block;
        }

        .lf-stats {
          display: flex;
          justify-content: center;
          gap: 14px;
          font-size: 10px;
          color: #d4d4d8;
          padding: 2px 0;
          flex-shrink: 0;
        }

        .lf-warning {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 52px;
          font-weight: 900;
          color: #ef4444;
          text-shadow: 0 0 24px rgba(239,68,68,0.8);
          animation: lf-warn 0.3s ease-in-out infinite alternate;
          margin: 0;
          z-index: 15;
        }

        @keyframes lf-warn {
          from { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
        }

        .lf-actions {
          display: flex;
          gap: 8px;
          padding: 4px 0 6px;
          justify-content: center;
          flex-shrink: 0;
        }

        .lf-btn {
          padding: 6px 18px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(180deg, #f97316 0%, #c2410c 100%);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 3px 0 #7c2d12, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
        }

        .lf-btn:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #7c2d12, 0 2px 4px rgba(0,0,0,0.3);
        }

        .lf-btn.ghost {
          background: transparent;
          color: #9ca3af;
          border: 1px solid #4b5563;
          box-shadow: none;
        }

        .lf-platform {
          cursor: pointer;
        }

        .lf-fever-banner {
          position: absolute;
          top: 75px;
          left: 50%;
          transform: translateX(-50%);
          z-index: 25;
          font-size: 22px;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 16px rgba(251,191,36,0.8);
          animation: lf-fever 0.3s ease-in-out infinite alternate;
          letter-spacing: 4px;
        }

        @keyframes lf-fever {
          from { opacity: 0.7; transform: translateX(-50%) scale(1); }
          to { opacity: 1; transform: translateX(-50%) scale(1.08); }
        }

        .lf-shield-indicator {
          position: absolute;
          top: 50px;
          right: 12px;
          z-index: 20;
          font-size: 24px;
          animation: lf-shield-bob 1s ease-in-out infinite alternate;
        }

        @keyframes lf-shield-bob {
          from { transform: translateY(0); }
          to { transform: translateY(-4px); }
        }

        @keyframes lf-eruption-rise {
          from { transform: scaleY(0); opacity: 0.8; }
          to { transform: scaleY(1); opacity: 1; }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {comboLabel && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)', zIndex: 20, fontSize: 18, color: comboColor }}>
          {comboLabel}
        </div>
      )}

      {isFever && (
        <div className="lf-fever-banner">
          FEVER x{FEVER_MULTIPLIER} ({(feverRemainingMs / 1000).toFixed(1)}s)
        </div>
      )}

      {player.hasShield && <div className="lf-shield-indicator">🛡️</div>}

      <div className="lf-hud">
        <img src={characterSprite} alt="character" className="lf-hud-avatar" />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p className="lf-score">{score}</p>
          <p className="lf-best">BEST {displayedBestScore}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p className="lf-time">{(elapsedMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      <div className="lf-stats">
        <span>COMBO <strong style={{ color: '#fbbf24' }}>{combo}</strong></span>
        <span>COINS <strong style={{ color: '#fbbf24' }}>{coinCount}</strong></span>
        <span>JUMPS <strong style={{ color: '#f97316' }}>{jumpCountRef.current}</strong></span>
        {isFever && <span style={{ color: '#ef4444', fontWeight: 'bold' }}>FEVER!</span>}
      </div>

      <svg
        className="lf-svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="lava-floor-stage"
      >
        <defs>
          <linearGradient id="lf-lava-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff4500" />
            <stop offset="40%" stopColor="#ff6a00" />
            <stop offset="100%" stopColor="#cc2200" />
          </linearGradient>
          <linearGradient id="lf-bg-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isFever ? '#2e1a00' : '#1a0a2e'} />
            <stop offset="60%" stopColor={isFever ? '#4a2800' : '#2d1b47'} />
            <stop offset="100%" stopColor={isFever ? '#5a1500' : '#3d1520'} />
          </linearGradient>
          <radialGradient id="lf-glow" cx="50%" cy="100%" r="60%">
            <stop offset="0%" stopColor="#ff6a00" stopOpacity={isFever ? '0.5' : '0.3'} />
            <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
          </radialGradient>
          <filter id="lf-plat-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="lf-char-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#lf-bg-grad)" />
        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#lf-glow)" />

        {/* Background embers */}
        {Array.from({ length: 8 }, (_, i) => {
          const ex = ((i * 47 + gameNow * 0.015) % VIEWBOX_WIDTH)
          const ey = LAVA_TOP_Y - 30 - ((gameNow * 0.04 + i * 90) % (VIEWBOX_HEIGHT * 0.6))
          const eSize = 2 + Math.sin(gameNow / 300 + i * 1.5) * 1.5
          return (
            <circle
              key={`ember-${i}`}
              cx={ex}
              cy={ey}
              r={Math.max(0.5, eSize)}
              fill={i % 2 === 0 ? '#ff6a00' : '#ff9500'}
              opacity={0.3 + Math.sin(gameNow / 200 + i) * 0.2}
            />
          )
        })}

        {/* Eruption hazards */}
        {eruptions.map((eruption, i) => {
          const progress = clampNumber((gameNow - eruption.startAt) / ERUPTION_DURATION_MS, 0, 1)
          const intensity = progress < 0.3 ? progress / 0.3 : progress > 0.7 ? (1 - progress) / 0.3 : 1
          return (
            <g key={`eruption-${i}`}>
              {/* Warning zone on ground */}
              <rect
                x={eruption.x}
                y={LAVA_TOP_Y - 80 * intensity}
                width={ERUPTION_WIDTH}
                height={80 * intensity + LAVA_HEIGHT}
                fill="#ff4500"
                opacity={0.2 + intensity * 0.3}
                rx={4}
              />
              {/* Fire pillar */}
              {intensity > 0.2 && Array.from({ length: 5 }, (_, j) => {
                const fx = eruption.x + ERUPTION_WIDTH * (0.15 + j * 0.17)
                const fy = LAVA_TOP_Y - 60 * intensity + Math.sin(gameNow / 100 + j * 2) * 10
                return (
                  <circle
                    key={`fire-${j}`}
                    cx={fx}
                    cy={fy}
                    r={4 + Math.sin(gameNow / 150 + j) * 2}
                    fill={j % 2 === 0 ? '#ff6a00' : '#ffaa00'}
                    opacity={intensity * 0.8}
                  />
                )
              })}
            </g>
          )
        })}

        {/* Platforms */}
        {platforms.map((platform) => {
          const opacity = getPlatformOpacity(platform, gameNow)
          const isBlinking = isPlatformBlinking(platform, gameNow)
          const remaining = platform.lifetimeMs - (gameNow - platform.spawnedAt)
          const lifeRatio = clampNumber(remaining / platform.lifetimeMs, 0, 1)
          const px = getMovingPlatformX(platform, gameNow)
          const { hue, saturation, lightness } = getPlatformColor(platform, lifeRatio, isFever)
          const coinCollected = collectedIds.has(platform.id)
          const shieldCollected = collectedIds.has(platform.id + 100000)

          return (
            <g key={platform.id} opacity={opacity}>
              {/* Platform body */}
              <rect
                x={px}
                y={platform.y}
                width={platform.width}
                height={PLATFORM_HEIGHT}
                rx={PLATFORM_CORNER_RADIUS}
                ry={PLATFORM_CORNER_RADIUS}
                fill={`hsl(${hue}, ${saturation}%, ${lightness}%)`}
                stroke={isBlinking ? '#ffffff' : `hsl(${hue}, ${saturation}%, ${lightness + 20}%)`}
                strokeWidth={isBlinking ? 2 : 1}
                filter="url(#lf-plat-glow)"
                className="lf-platform"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handlePlatformTap(platform) }}
                style={{ cursor: 'pointer' }}
              />

              {/* Platform type indicator */}
              {platform.type === 'spring' && (
                <text x={px + platform.width / 2} y={platform.y + PLATFORM_HEIGHT - 2} textAnchor="middle" fontSize="9" fill="#fff" fontWeight="bold" pointerEvents="none">↑</text>
              )}
              {platform.type === 'moving' && (
                <text x={px + platform.width / 2} y={platform.y + PLATFORM_HEIGHT - 2} textAnchor="middle" fontSize="8" fill="#fff" pointerEvents="none">↔</text>
              )}
              {platform.type === 'crumble' && (
                <g pointerEvents="none">
                  {Array.from({ length: 3 }, (_, ci) => (
                    <line
                      key={ci}
                      x1={px + platform.width * (0.2 + ci * 0.25)}
                      y1={platform.y + 3}
                      x2={px + platform.width * (0.3 + ci * 0.25)}
                      y2={platform.y + PLATFORM_HEIGHT - 3}
                      stroke="rgba(0,0,0,0.3)"
                      strokeWidth={1}
                    />
                  ))}
                </g>
              )}
              {platform.type === 'ice' && (
                <rect
                  x={px + 2}
                  y={platform.y + 2}
                  width={platform.width - 4}
                  height={PLATFORM_HEIGHT - 4}
                  rx={5}
                  fill="rgba(255,255,255,0.25)"
                  pointerEvents="none"
                />
              )}

              {/* Coin on platform */}
              {platform.hasCoin && !coinCollected && (
                <g>
                  <circle
                    cx={px + platform.width / 2}
                    cy={platform.y - COIN_SIZE / 2 - 3}
                    r={COIN_SIZE / 2}
                    fill="#fbbf24"
                    stroke="#d97706"
                    strokeWidth={1.5}
                    opacity={0.7 + Math.sin(gameNow / 200 + platform.id) * 0.3}
                  />
                  <text
                    x={px + platform.width / 2}
                    y={platform.y - COIN_SIZE / 2 + 1}
                    textAnchor="middle"
                    fontSize="9"
                    fill="#92400e"
                    fontWeight="bold"
                    pointerEvents="none"
                  >
                    $
                  </text>
                </g>
              )}

              {/* Shield on platform */}
              {platform.hasShield && !shieldCollected && (
                <text
                  x={px + platform.width / 2}
                  y={platform.y - SHIELD_SIZE / 2}
                  textAnchor="middle"
                  fontSize="14"
                  pointerEvents="none"
                  opacity={0.8 + Math.sin(gameNow / 250 + platform.id) * 0.2}
                >
                  🛡️
                </text>
              )}

              {/* Tap target (larger invisible area) */}
              <rect
                x={px - 14}
                y={platform.y - 24}
                width={platform.width + 28}
                height={PLATFORM_HEIGHT + 48}
                fill="transparent"
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); handlePlatformTap(platform) }}
                style={{ cursor: 'pointer' }}
              />
            </g>
          )
        })}

        {/* Jump trail */}
        {jumpTrail.map((t, i) => (
          <circle
            key={`trail-${i}`}
            cx={t.x}
            cy={t.y}
            r={4 * (1 - t.age / 300)}
            fill={isFever ? '#fbbf24' : '#f97316'}
            opacity={0.5 * (1 - t.age / 300)}
          />
        ))}

        {/* Player */}
        {gamePhase !== 'finished' && (
          <g>
            {/* Shadow */}
            <ellipse
              cx={player.x}
              cy={player.y + PLAYER_RADIUS + 3}
              rx={PLAYER_RADIUS * 0.7}
              ry={3}
              fill="rgba(0,0,0,0.35)"
            />
            {/* Shield aura */}
            {player.hasShield && (
              <circle
                cx={player.x}
                cy={player.y}
                r={CHARACTER_SIZE / 2 + 6}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={2}
                opacity={0.5 + Math.sin(gameNow / 200) * 0.3}
              />
            )}
            {/* Character sprite */}
            <image
              href={characterSprite}
              x={player.x - CHARACTER_SIZE / 2}
              y={player.y - CHARACTER_SIZE / 2}
              width={CHARACTER_SIZE}
              height={CHARACTER_SIZE}
              preserveAspectRatio="xMidYMid meet"
              filter={isFever ? 'url(#lf-char-glow)' : undefined}
              style={{
                filter: isFever
                  ? 'drop-shadow(0 0 10px rgba(251,191,36,0.9))'
                  : player.hasShield
                    ? 'drop-shadow(0 0 8px rgba(56,189,248,0.7))'
                    : 'drop-shadow(0 2px 5px rgba(0,0,0,0.6))',
              }}
            />
          </g>
        )}

        {/* Fallen player in lava */}
        {gamePhase === 'finished' && (
          <g>
            <image
              href={characterSprite}
              x={player.x - CHARACTER_SIZE * 0.3}
              y={LAVA_TOP_Y - CHARACTER_SIZE * 0.3}
              width={CHARACTER_SIZE * 0.6}
              height={CHARACTER_SIZE * 0.6}
              preserveAspectRatio="xMidYMid meet"
              opacity={0.5}
            />
          </g>
        )}

        {/* Lava surface wave effect */}
        <path
          d={`M 0 ${LAVA_TOP_Y} ${Array.from({ length: 13 }, (_, i) => {
            const waveX = i * 30
            const waveOffset = Math.sin((gameNow / 350 + i * 0.7) * Math.PI) * 5
            return `Q ${waveX + 15} ${LAVA_TOP_Y + waveOffset} ${waveX + 30} ${LAVA_TOP_Y}`
          }).join(' ')} V ${VIEWBOX_HEIGHT} H 0 Z`}
          fill="url(#lf-lava-grad)"
        />

        {/* Lava glow bubbles */}
        {Array.from({ length: 7 }, (_, i) => {
          const bubbleX = ((i * 53 + gameNow * 0.02) % VIEWBOX_WIDTH)
          const bubbleY = LAVA_TOP_Y + 15 + Math.sin(gameNow / 500 + i * 1.3) * 12
          const bubbleR = 3 + Math.sin(gameNow / 350 + i * 2) * 2
          return (
            <circle
              key={`bubble-${i}`}
              cx={bubbleX}
              cy={bubbleY}
              r={Math.max(1, bubbleR)}
              fill={i % 3 === 0 ? '#ffaa00' : i % 3 === 1 ? '#ff6a00' : '#ffcc00'}
              opacity={0.4 + Math.sin(gameNow / 300 + i) * 0.2}
            />
          )
        })}

        {/* Lava surface shimmer */}
        {Array.from({ length: 4 }, (_, i) => {
          const sx = ((i * 90 + gameNow * 0.03) % VIEWBOX_WIDTH)
          return (
            <rect
              key={`shimmer-${i}`}
              x={sx}
              y={LAVA_TOP_Y - 2}
              width={20 + Math.sin(gameNow / 400 + i) * 8}
              height={3}
              rx={1.5}
              fill="#ffcc44"
              opacity={0.15 + Math.sin(gameNow / 250 + i * 1.5) * 0.1}
            />
          )
        })}
      </svg>

      {gamePhase === 'falling' && <p className="lf-warning">!!!</p>}

      <div className="lf-actions">
        <button
          className="lf-btn"
          type="button"
          onClick={() => { sfx('combo', 0.4, 1); finishRound() }}
        >
          End
        </button>
        <button
          className="lf-btn ghost"
          type="button"
          onClick={onExit}
        >
          Exit
        </button>
      </div>
    </section>
  )
}

export const lavaFloorModule: MiniGameModule = {
  manifest: {
    id: 'lava-floor',
    title: 'Lava Floor',
    description: '바닥은 용암! 나타나는 플랫폼으로 뛰어라!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: LavaFloorGame,
}
