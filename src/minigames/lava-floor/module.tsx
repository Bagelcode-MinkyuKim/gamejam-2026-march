import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/park-wankyu.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 640

const CHARACTER_SIZE = 48

const LAVA_HEIGHT = 80
const LAVA_TOP_Y = VIEWBOX_HEIGHT - LAVA_HEIGHT

const PLATFORM_INITIAL_WIDTH = 64
const PLATFORM_MIN_WIDTH = 28
const PLATFORM_WIDTH_SHRINK_PER_JUMP = 1.2
const PLATFORM_HEIGHT = 14
const PLATFORM_CORNER_RADIUS = 7

const PLATFORM_INITIAL_LIFETIME_MS = 2800
const PLATFORM_MIN_LIFETIME_MS = 900
const PLATFORM_LIFETIME_SHRINK_PER_JUMP = 60
const PLATFORM_BLINK_THRESHOLD_MS = 800

const PLATFORM_SPAWN_INTERVAL_INITIAL_MS = 1600
const PLATFORM_SPAWN_INTERVAL_MIN_MS = 600
const PLATFORM_SPAWN_INTERVAL_SHRINK_PER_JUMP = 35

const PLATFORM_SPAWN_MARGIN_X = 40
const PLATFORM_SPAWN_MIN_Y = 80
const PLATFORM_SPAWN_MAX_Y = LAVA_TOP_Y - 40

const MAX_ACTIVE_PLATFORMS = 6

const PLAYER_RADIUS = 12
const PLAYER_JUMP_DURATION_MS = 280

const GRAVITY = 1800
const FALL_START_DELAY_MS = 600
const GAME_TIMEOUT_MS = 120000

// --- Gimmick constants ---
const COIN_SIZE = 16
const COIN_SCORE = 5
const COIN_SPAWN_CHANCE = 0.4
const FEVER_THRESHOLD = 15
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 3
const COMBO_WINDOW_MS = 3000

interface Platform {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly spawnedAt: number
  readonly lifetimeMs: number
  readonly hasCoin: boolean
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

function createPlatform(id: number, now: number, jumps: number): Platform {
  const width = getPlatformWidth(jumps)
  const x = randomBetween(PLATFORM_SPAWN_MARGIN_X, VIEWBOX_WIDTH - PLATFORM_SPAWN_MARGIN_X - width)
  const y = randomBetween(PLATFORM_SPAWN_MIN_Y, PLATFORM_SPAWN_MAX_Y)
  const lifetimeMs = getPlatformLifetime(jumps)
  const hasCoin = Math.random() < COIN_SPAWN_CHANCE
  return { id, x, y, width, spawnedAt: now, lifetimeMs, hasCoin }
}

function createStartPlatform(id: number, now: number): Platform {
  const width = PLATFORM_INITIAL_WIDTH * 1.5
  const x = VIEWBOX_WIDTH / 2 - width / 2
  const y = VIEWBOX_HEIGHT / 2 + 40
  return { id, x, y, width, spawnedAt: now, lifetimeMs: 999999, hasCoin: false }
}

function isPlatformExpired(platform: Platform, now: number): boolean {
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

  if (remaining <= PLATFORM_BLINK_THRESHOLD_MS) {
    const blinkPhase = Math.sin((elapsed / 80) * Math.PI)
    return 0.3 + Math.abs(blinkPhase) * 0.5
  }

  const fadeInDuration = 200
  if (elapsed < fadeInDuration) {
    return elapsed / fadeInDuration
  }

  return 1
}

function isPlayerOnPlatform(playerX: number, playerY: number, platform: Platform): boolean {
  const playerBottom = playerY + PLAYER_RADIUS
  const platformTop = platform.y
  const platformBottom = platform.y + PLATFORM_HEIGHT

  const verticalMatch = playerBottom >= platformTop - 4 && playerBottom <= platformBottom + 4
  const horizontalMatch = playerX >= platform.x - 4 && playerX <= platform.x + platform.width + 4

  return verticalMatch && horizontalMatch
}

function LavaFloorGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [player, setPlayer] = useState<PlayerState>({
    x: VIEWBOX_WIDTH / 2,
    y: VIEWBOX_HEIGHT / 2 + 40 - PLAYER_RADIUS,
    isJumping: false,
    jumpStartX: 0,
    jumpStartY: 0,
    jumpTargetX: 0,
    jumpTargetY: 0,
    jumpElapsedMs: 0,
    isFalling: false,
    fallVelocity: 0,
    standingPlatformId: null,
  })
  const [gamePhase, setGamePhase] = useState<'playing' | 'falling' | 'finished'>('playing')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [coinCount, setCoinCount] = useState(0)
  const [collectedCoinIds, setCollectedCoinIds] = useState<Set<number>>(new Set())

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
  const collectedCoinIdsRef = useRef<Set<number>>(new Set())

  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) return
    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
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

      const jumpTargetX = platform.x + platform.width / 2
      const jumpTargetY = platform.y - PLAYER_RADIUS

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
      }

      playerRef.current = nextPlayer
      setPlayer(nextPlayer)

      const nextJumpCount = jumpCountRef.current + 1
      jumpCountRef.current = nextJumpCount

      // Combo system
      const now = elapsedMsRef.current
      const timeSinceLastJump = now - lastJumpAtRef.current
      lastJumpAtRef.current = now

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
        playSfx(tapStrongAudioRef.current, 0.7, 1.3)
      }

      // Score calculation with multiplier
      const baseScore = 1
      const comboBonus = Math.floor(nextCombo / 5)
      const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
      const jumpScore = (baseScore + comboBonus) * feverMult

      scoreRef.current += jumpScore
      setScore(scoreRef.current)

      // Collect coin if platform has one and not yet collected
      if (platform.hasCoin && !collectedCoinIdsRef.current.has(platform.id)) {
        collectedCoinIdsRef.current = new Set([...collectedCoinIdsRef.current, platform.id])
        setCollectedCoinIds(new Set(collectedCoinIdsRef.current))
        const coinScore = COIN_SCORE * feverMult
        scoreRef.current += coinScore
        setScore(scoreRef.current)
        coinCountRef.current += 1
        setCoinCount(coinCountRef.current)
        effects.showScorePopup(coinScore, jumpTargetX, jumpTargetY - 20)
        playSfx(tapStrongAudioRef.current, 0.5, 1.4)
      }

      if (nextJumpCount % 5 === 0) {
        playSfx(tapStrongAudioRef.current, 0.55, 1 + Math.min(0.3, nextJumpCount * 0.008))
        effects.comboHitBurst(jumpTargetX, jumpTargetY, nextCombo, jumpScore)
      } else {
        playSfx(tapAudioRef.current, 0.45, 1 + Math.min(0.25, nextJumpCount * 0.006))
        effects.triggerShake(3)
        effects.spawnParticles(isFeverRef.current ? 6 : 3, jumpTargetX, jumpTargetY)
        effects.showScorePopup(jumpScore, jumpTargetX, jumpTargetY)
      }
    },
    [playSfx],
  )

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  useEffect(() => {
    const tapAudio = new Audio(tapHitSfx)
    tapAudio.preload = 'auto'
    tapAudioRef.current = tapAudio

    const tapStrongAudio = new Audio(tapHitStrongSfx)
    tapStrongAudio.preload = 'auto'
    tapStrongAudioRef.current = tapStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    const charImage = new Image()
    charImage.src = characterSprite
    void charImage.decode?.().catch(() => {})

    return () => {
      for (const audio of [tapAudio, tapStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit])

  useEffect(() => {
    const startPlatform = createStartPlatform(0, 0)
    platformsRef.current = [startPlatform]
    setPlatforms([startPlatform])

    const initialPlayer: PlayerState = {
      x: startPlatform.x + startPlatform.width / 2,
      y: startPlatform.y - PLAYER_RADIUS,
      isJumping: false,
      jumpStartX: 0,
      jumpStartY: 0,
      jumpTargetX: 0,
      jumpTargetY: 0,
      jumpElapsedMs: 0,
      isFalling: false,
      fallVelocity: 0,
      standingPlatformId: startPlatform.id,
    }
    playerRef.current = initialPlayer
    setPlayer(initialPlayer)

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
        if (feverRemainingMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
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
      const alivePlatforms = platformsRef.current.filter((p) => !isPlatformExpired(p, gameNow))
      platformsRef.current = alivePlatforms
      setPlatforms([...alivePlatforms])

      // Update player
      let currentPlayer = playerRef.current

      if (currentPlayer.isJumping) {
        const nextJumpElapsed = currentPlayer.jumpElapsedMs + deltaMs
        const jumpProgress = clampNumber(nextJumpElapsed / PLAYER_JUMP_DURATION_MS, 0, 1)
        const easedProgress = easeOutQuad(jumpProgress)

        const jumpX = currentPlayer.jumpStartX + (currentPlayer.jumpTargetX - currentPlayer.jumpStartX) * easedProgress
        const linearY = currentPlayer.jumpStartY + (currentPlayer.jumpTargetY - currentPlayer.jumpStartY) * easedProgress
        const arcHeight = -80 * Math.sin(jumpProgress * Math.PI)
        const jumpY = linearY + arcHeight

        if (jumpProgress >= 1) {
          currentPlayer = {
            ...currentPlayer,
            x: currentPlayer.jumpTargetX,
            y: currentPlayer.jumpTargetY,
            isJumping: false,
            jumpElapsedMs: 0,
          }
        } else {
          currentPlayer = {
            ...currentPlayer,
            x: jumpX,
            y: jumpY,
            jumpElapsedMs: nextJumpElapsed,
          }
        }
      }

      // Check if standing platform disappeared
      if (
        !currentPlayer.isJumping &&
        !currentPlayer.isFalling &&
        gamePhaseRef.current === 'playing'
      ) {
        const standingPlatform = alivePlatforms.find((p) => p.id === currentPlayer.standingPlatformId)
        if (!standingPlatform) {
          // Platform gone, start falling
          if (fallStartAtRef.current === null) {
            fallStartAtRef.current = gameNow
          }

          if (gameNow - fallStartAtRef.current >= FALL_START_DELAY_MS) {
            currentPlayer = {
              ...currentPlayer,
              isFalling: true,
              fallVelocity: 0,
              standingPlatformId: null,
            }
            gamePhaseRef.current = 'falling'
            setGamePhase('falling')
            // Reset combo on fall
            comboRef.current = 0
            setCombo(0)
          }
        } else {
          fallStartAtRef.current = null
        }
      }

      // Apply gravity when falling
      if (currentPlayer.isFalling) {
        const deltaSec = deltaMs / 1000
        const nextVelocity = currentPlayer.fallVelocity + GRAVITY * deltaSec
        const nextY = currentPlayer.y + nextVelocity * deltaSec

        currentPlayer = {
          ...currentPlayer,
          y: nextY,
          fallVelocity: nextVelocity,
        }

        // Check lava
        if (nextY + PLAYER_RADIUS >= LAVA_TOP_Y) {
          gamePhaseRef.current = 'finished'
          setGamePhase('finished')
          playSfx(gameOverAudioRef.current, 0.6, 0.9)
          finishRound()
          animationFrameRef.current = null

          playerRef.current = currentPlayer
          setPlayer(currentPlayer)
          return
        }
      }

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
  }, [finishRound, playSfx])

  const gameNow = elapsedMs

  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  return (
    <section className="mini-game-panel lava-floor-panel" aria-label="lava-floor-game" style={{ maxWidth: '432px', aspectRatio: '9 / 16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .lava-floor-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100%;
          background: linear-gradient(180deg, #1a0a00 0%, #2d1200 20%, #1a0a2e 60%, #0f0f1a 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .lava-floor-hud {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          max-width: 400px;
          padding: 8px 14px;
          background: linear-gradient(180deg, rgba(249,115,22,0.28) 0%, rgba(249,115,22,0.06) 100%);
          border-bottom: 1px solid rgba(249,115,22,0.3);
        }

        .lava-floor-hud-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #f97316;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(249,115,22,0.5);
          flex-shrink: 0;
        }

        .lava-floor-score {
          font-size: 26px;
          font-weight: 800;
          color: #f97316;
          margin: 0;
          line-height: 1.1;
          text-shadow: 0 0 8px rgba(249,115,22,0.4);
        }

        .lava-floor-best {
          font-size: 10px;
          color: #9ca3af;
          margin: 0;
        }

        .lava-floor-time {
          font-size: 16px;
          font-weight: 700;
          color: #e5e7eb;
          margin: 0;
        }

        .lava-floor-svg {
          width: 100%;
          max-width: 400px;
          flex: 1;
          min-height: 0;
          display: block;
        }

        .lava-floor-warning {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 48px;
          font-weight: 900;
          color: #ef4444;
          text-shadow: 0 0 20px rgba(239,68,68,0.8);
          animation: lava-warning-pulse 0.3s ease-in-out infinite alternate;
          margin: 0;
          z-index: 15;
        }

        @keyframes lava-warning-pulse {
          from { opacity: 0.6; transform: translate(-50%, -50%) scale(1); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
        }

        .lava-floor-overlay-actions {
          display: flex;
          gap: 8px;
          padding: 6px 0 10px;
        }

        .lava-floor-action-button {
          padding: 8px 22px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(180deg, #f97316 0%, #c2410c 100%);
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 3px 0 #7c2d12, 0 4px 8px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
        }

        .lava-floor-action-button:active {
          transform: translateY(2px);
          box-shadow: 0 1px 0 #7c2d12, 0 2px 4px rgba(0,0,0,0.3);
        }

        .lava-floor-action-button.ghost {
          background: transparent;
          color: #9ca3af;
          border: 1px solid #4b5563;
          box-shadow: none;
        }

        .lava-floor-action-button.ghost:active {
          background: rgba(75,85,99,0.2);
          transform: translateY(1px);
        }

        .lava-floor-platform {
          cursor: pointer;
        }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      {comboLabel && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 20, fontSize: 18, color: comboColor }}>
          {comboLabel}
        </div>
      )}
      {/* Fever banner */}
      {isFever && (
        <div style={{
          position: 'absolute', top: 85, left: '50%', transform: 'translateX(-50%)', zIndex: 25,
          fontSize: 22, fontWeight: 900, color: '#fbbf24', textShadow: '0 0 16px rgba(251,191,36,0.8)',
          animation: 'lava-fever-pulse 0.3s ease-in-out infinite alternate', letterSpacing: 4,
        }}>
          FEVER x{FEVER_MULTIPLIER} ({(feverRemainingMs / 1000).toFixed(1)}s)
        </div>
      )}
      <div className="lava-floor-hud">
        <img src={characterSprite} alt="character" className="lava-floor-hud-avatar" />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p className="lava-floor-score">{score}</p>
          <p className="lava-floor-best">BEST {displayedBestScore}</p>
        </div>
        <p className="lava-floor-time">{(elapsedMs / 1000).toFixed(1)}s</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, fontSize: 10, color: '#d4d4d8', marginBottom: 2 }}>
        <span>COMBO <strong style={{ color: '#fbbf24' }}>{combo}</strong></span>
        <span>COINS <strong style={{ color: '#fbbf24' }}>{coinCount}</strong></span>
        {isFever && <span style={{ color: '#ef4444', fontWeight: 'bold' }}>FEVER!</span>}
      </div>

      <svg
        className="lava-floor-svg"
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="lava-floor-stage"
      >
        <defs>
          <linearGradient id="lava-floor-lava-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff4500" />
            <stop offset="40%" stopColor="#ff6a00" />
            <stop offset="100%" stopColor="#cc2200" />
          </linearGradient>
          <linearGradient id="lava-floor-bg-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={isFever ? '#2e1a00' : '#1a0a2e'} />
            <stop offset="60%" stopColor={isFever ? '#4a2800' : '#2d1b47'} />
            <stop offset="100%" stopColor={isFever ? '#5a1500' : '#3d1520'} />
          </linearGradient>
          <radialGradient id="lava-floor-glow" cx="50%" cy="100%" r="60%">
            <stop offset="0%" stopColor="#ff6a00" stopOpacity={isFever ? '0.5' : '0.3'} />
            <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
          </radialGradient>
          <filter id="lava-floor-platform-glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background */}
        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#lava-floor-bg-gradient)" />
        <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#lava-floor-glow)" />

        {/* Platforms */}
        {platforms.map((platform) => {
          const opacity = getPlatformOpacity(platform, gameNow)
          const isBlinking = isPlatformBlinking(platform, gameNow)
          const remaining = platform.lifetimeMs - (gameNow - platform.spawnedAt)
          const lifeRatio = clampNumber(remaining / platform.lifetimeMs, 0, 1)

          const hue = isFever ? 40 : (lifeRatio > 0.5 ? 140 : lifeRatio > 0.25 ? 50 : 0)
          const saturation = isFever ? 90 : 70
          const lightness = 55 + (1 - lifeRatio) * 15

          const coinCollected = collectedCoinIds.has(platform.id)

          return (
            <g key={platform.id} opacity={opacity}>
              <rect
                x={platform.x}
                y={platform.y}
                width={platform.width}
                height={PLATFORM_HEIGHT}
                rx={PLATFORM_CORNER_RADIUS}
                ry={PLATFORM_CORNER_RADIUS}
                fill={`hsl(${hue}, ${saturation}%, ${lightness}%)`}
                stroke={isBlinking ? '#ffffff' : `hsl(${hue}, ${saturation}%, ${lightness + 20}%)`}
                strokeWidth={isBlinking ? 2 : 1}
                filter="url(#lava-floor-platform-glow)"
                className="lava-floor-platform"
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handlePlatformTap(platform)
                }}
                style={{ cursor: 'pointer' }}
              />
              {/* Coin on platform */}
              {platform.hasCoin && !coinCollected && (
                <g>
                  <circle
                    cx={platform.x + platform.width / 2}
                    cy={platform.y - COIN_SIZE / 2 - 2}
                    r={COIN_SIZE / 2}
                    fill="#fbbf24"
                    stroke="#d97706"
                    strokeWidth={1.5}
                    opacity={0.6 + Math.sin(gameNow / 200 + platform.id) * 0.3}
                  />
                  <text
                    x={platform.x + platform.width / 2}
                    y={platform.y - COIN_SIZE / 2 + 2}
                    textAnchor="middle"
                    fontSize="8"
                    fill="#92400e"
                    fontWeight="bold"
                  >
                    $
                  </text>
                </g>
              )}
              {/* Tap target (larger invisible area) */}
              <rect
                x={platform.x - 12}
                y={platform.y - 20}
                width={platform.width + 24}
                height={PLATFORM_HEIGHT + 40}
                fill="transparent"
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  handlePlatformTap(platform)
                }}
                style={{ cursor: 'pointer' }}
              />
            </g>
          )
        })}

        {/* Player */}
        {gamePhase !== 'finished' && (
          <g>
            {/* Shadow */}
            <ellipse
              cx={player.x}
              cy={player.y + PLAYER_RADIUS + 2}
              rx={PLAYER_RADIUS * 0.8}
              ry={4}
              fill="rgba(0,0,0,0.3)"
            />
            {/* Character sprite */}
            <image
              href={characterSprite}
              x={player.x - CHARACTER_SIZE / 2}
              y={player.y - CHARACTER_SIZE / 2}
              width={CHARACTER_SIZE}
              height={CHARACTER_SIZE}
              preserveAspectRatio="xMidYMid meet"
              style={{ filter: isFever ? 'drop-shadow(0 0 8px rgba(251,191,36,0.8))' : 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))' }}
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
              opacity={0.6}
            />
          </g>
        )}

        {/* Lava surface wave effect */}
        <path
          d={`M 0 ${LAVA_TOP_Y} ${Array.from({ length: 13 }, (_, i) => {
            const waveX = i * 30
            const waveOffset = Math.sin((gameNow / 400 + i * 0.8) * Math.PI) * 4
            return `Q ${waveX + 15} ${LAVA_TOP_Y + waveOffset} ${waveX + 30} ${LAVA_TOP_Y}`
          }).join(' ')} V ${VIEWBOX_HEIGHT} H 0 Z`}
          fill="url(#lava-floor-lava-gradient)"
        />

        {/* Lava glow bubbles */}
        {Array.from({ length: 5 }, (_, i) => {
          const bubbleX = ((i * 73 + gameNow * 0.02) % VIEWBOX_WIDTH)
          const bubbleY = LAVA_TOP_Y + 20 + Math.sin(gameNow / 600 + i * 1.3) * 15
          const bubbleR = 3 + Math.sin(gameNow / 400 + i * 2) * 2
          return (
            <circle
              key={`bubble-${i}`}
              cx={bubbleX}
              cy={bubbleY}
              r={Math.max(1, bubbleR)}
              fill="#ffaa00"
              opacity={0.4 + Math.sin(gameNow / 300 + i) * 0.2}
            />
          )
        })}
      </svg>

      {gamePhase === 'falling' && (
        <p className="lava-floor-warning">!!!</p>
      )}

      <div className="lava-floor-overlay-actions">
        <button
          className="lava-floor-action-button"
          type="button"
          onClick={() => {
            playSfx(tapStrongAudioRef.current, 0.5, 1)
            finishRound()
          }}
        >
          End
        </button>
        <button
          className="lava-floor-action-button ghost"
          type="button"
          onClick={onExit}
        >
          Exit
        </button>
      </div>
      <style>{`
        @keyframes lava-fever-pulse {
          from { opacity: 0.7; transform: translateX(-50%) scale(1); }
          to { opacity: 1; transform: translateX(-50%) scale(1.08); }
        }
      `}</style>
    </section>
  )
}

export const lavaFloorModule: MiniGameModule = {
  manifest: {
    id: 'lava-floor',
    title: 'Lava Floor',
    description: '\uBC14\uB2E5\uC740 \uC6A9\uC554! \uB098\uD0C0\uB098\uB294 \uD50C\uB7AB\uD3FC\uC73C\uB85C \uB6F0\uC5B4\uB77C!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: LavaFloorGame,
}
