import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const GAME_DURATION_MS = 120000
const PLAYER_START_POSITION = 100
const ZOMBIE_START_POSITION = 0
const INITIAL_ZOMBIE_SPEED = 28
const ZOMBIE_ACCELERATION = 4.2
const MAX_ZOMBIE_SPEED = 90
const TAP_MOVE_DISTANCE = 8
const TAP_DECAY_RATE = 0.92
const TAP_SPEED_INFLUENCE = 0.6
const MIN_GAP_FOR_GAME_OVER = 0
const DISTANCE_SCORE_MULTIPLIER = 1.2
const TIME_BONUS_MULTIPLIER = 5
const OBSTACLE_SPAWN_INTERVAL_MS = 3200
const OBSTACLE_MIN_INTERVAL_MS = 1800
const OBSTACLE_INTERVAL_DECAY = 0.94
const OBSTACLE_SPEED = 60
const OBSTACLE_WIDTH = 40
const OBSTACLE_HEIGHT = 30
const JUMP_DURATION_MS = 600
const JUMP_HEIGHT = 60

const STAGE_WIDTH = 360
const STAGE_HEIGHT = 200
const GROUND_Y = 150
const PLAYER_SIZE = 48
const ZOMBIE_SIZE = 52
const BAR_HEIGHT = 12
const BAR_MAX_GAP = 200

// --- Gimmick constants ---
const POWERUP_SPAWN_INTERVAL_MS = 8000
const POWERUP_SPEED_BOOST = 40
const POWERUP_SPEED_DURATION_MS = 3000
const POWERUP_INVINCIBLE_DURATION_MS = 4000
const COIN_SPAWN_INTERVAL_MS = 4000
const COIN_SCORE = 15
const TAP_COMBO_WINDOW_MS = 300
const TAP_COMBO_BONUS_THRESHOLD = 10
const TAP_COMBO_SCORE_BONUS = 5
const FEVER_TAP_THRESHOLD = 50
const FEVER_DURATION_MS = 5000
const FEVER_SPEED_MULT = 1.5

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toScore(distance: number, timeMs: number, bonusScore: number): number {
  return Math.max(0, Math.floor(distance * DISTANCE_SCORE_MULTIPLIER + (timeMs / 1000) * TIME_BONUS_MULTIPLIER + bonusScore))
}

interface Obstacle {
  readonly id: number
  x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly type: 'obstacle' | 'coin' | 'speed_boost' | 'invincible'
}

function ZombieRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()

  const [score, setScore] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [gap, setGap] = useState(PLAYER_START_POSITION - ZOMBIE_START_POSITION)
  const [statusText, setStatusText] = useState('Tap like crazy to escape!')
  const [isJumping, setIsJumping] = useState(false)
  const [jumpProgress, setJumpProgress] = useState(0)
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [tapFlash, setTapFlash] = useState(false)
  const [shakeIntensity, setShakeIntensity] = useState(0)
  const [tapCombo, setTapCombo] = useState(0)
  const [isSpeedBoosted, setIsSpeedBoosted] = useState(false)
  const [speedBoostMs, setSpeedBoostMs] = useState(0)
  const [isInvincible, setIsInvincible] = useState(false)
  const [invincibleMs, setInvincibleMs] = useState(0)
  const [coinCount, setCoinCount] = useState(0)
  const [, setBonusScore] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)

  const playerPosRef = useRef(PLAYER_START_POSITION)
  const zombiePosRef = useRef(ZOMBIE_START_POSITION)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const tapSpeedRef = useRef(0)
  const lastTapAtRef = useRef(0)
  const tapCountRef = useRef(0)
  const jumpStartRef = useRef<number | null>(null)
  const obstaclesRef = useRef<Obstacle[]>([])
  const nextObstacleAtRef = useRef(OBSTACLE_SPAWN_INTERVAL_MS)
  const obstacleIdRef = useRef(0)
  const currentObstacleIntervalRef = useRef(OBSTACLE_SPAWN_INTERVAL_MS)
  const tapComboRef = useRef(0)
  const isSpeedBoostedRef = useRef(false)
  const speedBoostMsRef = useRef(0)
  const isInvincibleRef = useRef(false)
  const invincibleMsRef = useRef(0)
  const coinCountRef = useRef(0)
  const bonusScoreRef = useRef(0)
  const nextCoinAtRef = useRef(COIN_SPAWN_INTERVAL_MS)
  const nextPowerupAtRef = useRef(POWERUP_SPAWN_INTERVAL_MS)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const totalTapsSinceFeverRef = useRef(0)

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

  const finishRound = useCallback(
    (reason: string) => {
      if (finishedRef.current) return
      finishedRef.current = true
      setStatusText(reason)
      const finalDurationMs = elapsedMsRef.current > 0 ? elapsedMsRef.current : Math.round(DEFAULT_FRAME_MS)
      const finalScore = toScore(playerPosRef.current - PLAYER_START_POSITION, elapsedMsRef.current, bonusScoreRef.current)
      setScore(finalScore)
      playSfx(gameOverAudioRef.current, 0.6, 0.95)
      onFinish({ score: finalScore, durationMs: finalDurationMs })
    },
    [onFinish, playSfx],
  )

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    const now = performance.now()
    const timeSinceLastTap = now - lastTapAtRef.current
    lastTapAtRef.current = now
    tapCountRef.current += 1
    totalTapsSinceFeverRef.current += 1

    // Tap combo
    if (timeSinceLastTap < TAP_COMBO_WINDOW_MS) {
      tapComboRef.current += 1
    } else {
      tapComboRef.current = 1
    }
    setTapCombo(tapComboRef.current)

    // Combo bonus score
    if (tapComboRef.current > 0 && tapComboRef.current % TAP_COMBO_BONUS_THRESHOLD === 0) {
      bonusScoreRef.current += TAP_COMBO_SCORE_BONUS * Math.floor(tapComboRef.current / TAP_COMBO_BONUS_THRESHOLD)
      setBonusScore(bonusScoreRef.current)
      playSfx(tapStrongAudioRef.current, 0.55, 1.2)
    }

    // Fever mode activation
    if (totalTapsSinceFeverRef.current >= FEVER_TAP_THRESHOLD && !isFeverRef.current) {
      isFeverRef.current = true
      feverMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverMs(FEVER_DURATION_MS)
      totalTapsSinceFeverRef.current = 0
      playSfx(tapStrongAudioRef.current, 0.7, 1.4)
    }

    const feverMult = isFeverRef.current ? FEVER_SPEED_MULT : 1
    const boostMult = isSpeedBoostedRef.current ? 1.5 : 1
    const tapBoost = TAP_MOVE_DISTANCE * feverMult * boostMult
    playerPosRef.current += tapBoost
    tapSpeedRef.current = Math.min(tapSpeedRef.current + tapBoost * TAP_SPEED_INFLUENCE, MAX_ZOMBIE_SPEED * 1.5)

    setTapFlash(true)
    setTimeout(() => setTapFlash(false), 80)

    if (tapCountRef.current % 5 === 0) {
      playSfx(tapStrongAudioRef.current, 0.5, 1.0 + Math.random() * 0.2)
    } else {
      const rate = 0.9 + Math.random() * 0.3
      playSfx(tapAudioRef.current, 0.35, rate)
    }

    if (timeSinceLastTap < 150) {
      setShakeIntensity((previous) => Math.min(previous + 0.5, 4))
    }
  }, [playSfx])

  const handleSwipeUp = useCallback(() => {
    if (finishedRef.current || jumpStartRef.current !== null) return
    jumpStartRef.current = elapsedMsRef.current
    setIsJumping(true)
    playSfx(tapStrongAudioRef.current, 0.45, 1.2)
  }, [playSfx])

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

    return () => {
      for (const audio of [tapAudio, tapStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (event.code === 'Space' || event.code === 'ArrowRight') {
        event.preventDefault()
        handleTap()
        return
      }
      if (event.code === 'ArrowUp') {
        event.preventDefault()
        handleSwipeUp()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, handleSwipeUp, onExit])

  useEffect(() => {
    let swipeStartY = 0
    const SWIPE_THRESHOLD = 30

    const handleTouchStart = (event: TouchEvent) => {
      swipeStartY = event.touches[0].clientY
    }

    const handleTouchEnd = (event: TouchEvent) => {
      const swipeEndY = event.changedTouches[0].clientY
      const deltaY = swipeStartY - swipeEndY
      if (deltaY > SWIPE_THRESHOLD) {
        handleSwipeUp()
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleSwipeUp])

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
      setElapsedMs(elapsedMsRef.current)

      const elapsedSeconds = elapsedMsRef.current / 1000

      if (elapsedMsRef.current >= GAME_DURATION_MS) {
        finishRound('120s survived! Clear!')
        animationFrameRef.current = null
        return
      }

      // Update power-up timers
      if (isSpeedBoostedRef.current) {
        speedBoostMsRef.current = Math.max(0, speedBoostMsRef.current - deltaMs)
        setSpeedBoostMs(speedBoostMsRef.current)
        if (speedBoostMsRef.current <= 0) {
          isSpeedBoostedRef.current = false
          setIsSpeedBoosted(false)
        }
      }

      if (isInvincibleRef.current) {
        invincibleMsRef.current = Math.max(0, invincibleMsRef.current - deltaMs)
        setInvincibleMs(invincibleMsRef.current)
        if (invincibleMsRef.current <= 0) {
          isInvincibleRef.current = false
          setIsInvincible(false)
        }
      }

      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      const zombieSpeed = Math.min(MAX_ZOMBIE_SPEED, INITIAL_ZOMBIE_SPEED + elapsedSeconds * ZOMBIE_ACCELERATION)
      zombiePosRef.current += zombieSpeed * (deltaMs / 1000)

      tapSpeedRef.current *= TAP_DECAY_RATE
      playerPosRef.current += tapSpeedRef.current * (deltaMs / 1000)

      if (jumpStartRef.current !== null) {
        const jumpElapsed = elapsedMsRef.current - jumpStartRef.current
        if (jumpElapsed >= JUMP_DURATION_MS) {
          jumpStartRef.current = null
          setIsJumping(false)
          setJumpProgress(0)
        } else {
          setJumpProgress(jumpElapsed / JUMP_DURATION_MS)
        }
      }

      const currentGap = playerPosRef.current - zombiePosRef.current
      setGap(currentGap)
      setScore(toScore(playerPosRef.current - PLAYER_START_POSITION, elapsedMsRef.current, bonusScoreRef.current))

      setShakeIntensity((previous) => previous * 0.92)

      // Spawn obstacles
      if (elapsedMsRef.current >= nextObstacleAtRef.current) {
        const newObstacle: Obstacle = {
          id: obstacleIdRef.current++,
          x: STAGE_WIDTH + OBSTACLE_WIDTH,
          y: GROUND_Y - OBSTACLE_HEIGHT,
          width: OBSTACLE_WIDTH,
          height: OBSTACLE_HEIGHT,
          type: 'obstacle',
        }
        obstaclesRef.current = [...obstaclesRef.current, newObstacle]
        currentObstacleIntervalRef.current = Math.max(
          OBSTACLE_MIN_INTERVAL_MS,
          currentObstacleIntervalRef.current * OBSTACLE_INTERVAL_DECAY,
        )
        nextObstacleAtRef.current = elapsedMsRef.current + currentObstacleIntervalRef.current
      }

      // Spawn coins
      if (elapsedMsRef.current >= nextCoinAtRef.current) {
        const coinObstacle: Obstacle = {
          id: obstacleIdRef.current++,
          x: STAGE_WIDTH + 20,
          y: GROUND_Y - 40 - Math.random() * 30,
          width: 20,
          height: 20,
          type: 'coin',
        }
        obstaclesRef.current = [...obstaclesRef.current, coinObstacle]
        nextCoinAtRef.current = elapsedMsRef.current + COIN_SPAWN_INTERVAL_MS * (0.8 + Math.random() * 0.4)
      }

      // Spawn power-ups
      if (elapsedMsRef.current >= nextPowerupAtRef.current) {
        const powerupType = Math.random() < 0.5 ? 'speed_boost' : 'invincible'
        const powerupObstacle: Obstacle = {
          id: obstacleIdRef.current++,
          x: STAGE_WIDTH + 20,
          y: GROUND_Y - 50,
          width: 24,
          height: 24,
          type: powerupType as 'speed_boost' | 'invincible',
        }
        obstaclesRef.current = [...obstaclesRef.current, powerupObstacle]
        nextPowerupAtRef.current = elapsedMsRef.current + POWERUP_SPAWN_INTERVAL_MS * (0.8 + Math.random() * 0.4)
      }

      const updatedObstacles = obstaclesRef.current
        .map((obstacle) => ({
          ...obstacle,
          x: obstacle.x - OBSTACLE_SPEED * (deltaMs / 1000),
        }))
        .filter((obstacle) => obstacle.x + obstacle.width > -20)

      const playerScreenX = STAGE_WIDTH * 0.65
      const isInAir = jumpStartRef.current !== null

      const survivingObstacles: Obstacle[] = []
      for (const obstacle of updatedObstacles) {
        const obstacleLeft = obstacle.x
        const obstacleRight = obstacle.x + obstacle.width
        const playerLeft = playerScreenX - PLAYER_SIZE / 2 + 8
        const playerRight = playerScreenX + PLAYER_SIZE / 2 - 8

        if (playerRight > obstacleLeft && playerLeft < obstacleRight) {
          if (obstacle.type === 'coin') {
            const feverMult = isFeverRef.current ? 2 : 1
            bonusScoreRef.current += COIN_SCORE * feverMult
            setBonusScore(bonusScoreRef.current)
            coinCountRef.current += 1
            setCoinCount(coinCountRef.current)
            playSfx(tapStrongAudioRef.current, 0.5, 1.3)
            effects.spawnParticles(3, obstacle.x + 10, obstacle.y + 10, ['🪙', '✨'])
            effects.showScorePopup(COIN_SCORE * feverMult, obstacle.x + 10, obstacle.y - 10)
            continue
          } else if (obstacle.type === 'speed_boost') {
            isSpeedBoostedRef.current = true
            speedBoostMsRef.current = POWERUP_SPEED_DURATION_MS
            setIsSpeedBoosted(true)
            setSpeedBoostMs(POWERUP_SPEED_DURATION_MS)
            playerPosRef.current += POWERUP_SPEED_BOOST
            playSfx(tapStrongAudioRef.current, 0.6, 1.4)
            continue
          } else if (obstacle.type === 'invincible') {
            isInvincibleRef.current = true
            invincibleMsRef.current = POWERUP_INVINCIBLE_DURATION_MS
            setIsInvincible(true)
            setInvincibleMs(POWERUP_INVINCIBLE_DURATION_MS)
            playSfx(tapStrongAudioRef.current, 0.6, 1.5)
            continue
          } else if (!isInAir) {
            if (isInvincibleRef.current) {
              // Smash through obstacle
              playSfx(tapAudioRef.current, 0.4, 1.1)
              continue
            }
            playerPosRef.current -= 20
            playSfx(gameOverAudioRef.current, 0.3, 1.2)
            setShakeIntensity(6)
            effects.triggerShake(6)
            effects.triggerFlash('rgba(239,68,68,0.3)')
            continue
          }
        }
        survivingObstacles.push(obstacle)
      }

      obstaclesRef.current = survivingObstacles
      setObstacles([...survivingObstacles])

      effects.updateParticles()

      if (currentGap <= MIN_GAP_FOR_GAME_OVER) {
        effects.triggerShake(10)
        effects.triggerFlash('rgba(239,68,68,0.6)')
        finishRound('Caught by zombie!')
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
  }, [finishRound, playSfx])

  const displayedBestScore = Math.max(bestScore, score)
  const timeRemaining = Math.max(0, (GAME_DURATION_MS - elapsedMs) / 1000)
  const gapRatio = clampNumber(gap / BAR_MAX_GAP, 0, 1)
  const zombieSpeed = Math.min(MAX_ZOMBIE_SPEED, INITIAL_ZOMBIE_SPEED + (elapsedMs / 1000) * ZOMBIE_ACCELERATION)

  const jumpOffset = isJumping ? Math.sin(jumpProgress * Math.PI) * JUMP_HEIGHT : 0

  const dangerLevel = gapRatio < 0.2 ? 'critical' : gapRatio < 0.4 ? 'danger' : gapRatio < 0.6 ? 'warning' : 'safe'

  const shakeStyle =
    shakeIntensity > 0.5
      ? {
          transform: `translate(${(Math.random() - 0.5) * shakeIntensity}px, ${(Math.random() - 0.5) * shakeIntensity}px)`,
        }
      : undefined

  return (
    <section className="mini-game-panel zombie-run-panel" aria-label="zombie-run-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <div className="zombie-run-board" style={shakeStyle}>
        <div className="zombie-run-hud">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginBottom: 2 }}>
            <img src={kimYeonjaSprite} alt="character" className="zombie-run-hud-avatar" />
            <div style={{ flex: 1 }}>
              <div className="zombie-run-hud-row">
                <span className="zombie-run-score-label">SCORE</span>
                <span className="zombie-run-score-value">{score}</span>
              </div>
              <div className="zombie-run-hud-row">
                <span className="zombie-run-best-label">BEST</span>
                <span className="zombie-run-best-value">{displayedBestScore}</span>
              </div>
            </div>
          </div>
          <div className="zombie-run-hud-row">
            <span className="zombie-run-time-label" data-danger={timeRemaining < 5}>
              {timeRemaining.toFixed(1)}s
            </span>
            <span className="zombie-run-speed-label">
              Zombie Spd: {zombieSpeed.toFixed(0)}
            </span>
          </div>
          {/* Power-up & combo indicators */}
          <div className="zombie-run-hud-row" style={{ gap: 6, fontSize: 9 }}>
            {tapCombo >= 5 && <span style={{ color: '#fbbf24', fontWeight: 'bold' }}>COMBO x{tapCombo}</span>}
            {coinCount > 0 && <span style={{ color: '#f59e0b' }}>Coins: {coinCount}</span>}
            {isSpeedBoosted && <span style={{ color: '#22d3ee', fontWeight: 'bold' }}>SPEED! ({(speedBoostMs / 1000).toFixed(1)}s)</span>}
            {isInvincible && <span style={{ color: '#a78bfa', fontWeight: 'bold' }}>INVINCIBLE! ({(invincibleMs / 1000).toFixed(1)}s)</span>}
            {isFever && <span style={{ color: '#ef4444', fontWeight: 'bold', animation: 'zombie-run-blink 0.3s infinite' }}>FEVER! ({(feverMs / 1000).toFixed(1)}s)</span>}
          </div>
        </div>

        <div className="zombie-run-gap-bar-container">
          <div className="zombie-run-gap-bar-label">DISTANCE GAP</div>
          <div className="zombie-run-gap-bar-track">
            <div
              className={`zombie-run-gap-bar-fill zombie-run-gap-${dangerLevel}`}
              style={{ width: `${(gapRatio * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="zombie-run-gap-value">{Math.max(0, Math.floor(gap))}m</div>
        </div>

        <svg
          className="zombie-run-stage"
          viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="zombie-run-stage"
        >
          <defs>
            <linearGradient id="zombie-run-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={isFever ? '#2e1a00' : '#1a1a2e'} />
              <stop offset="100%" stopColor={isFever ? '#3e2000' : '#16213e'} />
            </linearGradient>
            <linearGradient id="zombie-run-ground-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2d3436" />
              <stop offset="100%" stopColor="#1e272e" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={STAGE_WIDTH} height={GROUND_Y} fill="url(#zombie-run-sky)" />
          <rect x="0" y={GROUND_Y} width={STAGE_WIDTH} height={STAGE_HEIGHT - GROUND_Y} fill="url(#zombie-run-ground-grad)" />

          <line x1="0" y1={GROUND_Y} x2={STAGE_WIDTH} y2={GROUND_Y} stroke="#4a5568" strokeWidth="2" />

          {(() => {
            const moonX = 300
            const moonY = 30
            return (
              <g>
                <circle cx={moonX} cy={moonY} r="18" fill="#ffeaa7" opacity="0.8" />
                <circle cx={moonX + 5} cy={moonY - 3} r="16" fill={isFever ? '#2e1a00' : '#1a1a2e'} />
              </g>
            )
          })()}

          {[60, 140, 220, 310].map((treeX, index) => {
            const treeHeight = 30 + (index % 3) * 15
            const treeOpacity = 0.15 + (index % 2) * 0.05
            return (
              <g key={`tree-${index}`} opacity={treeOpacity}>
                <rect x={treeX - 2} y={GROUND_Y - treeHeight * 0.3} width="4" height={treeHeight * 0.3} fill="#2d3436" />
                <polygon
                  points={`${treeX},${GROUND_Y - treeHeight} ${treeX - 12},${GROUND_Y - treeHeight * 0.3} ${treeX + 12},${GROUND_Y - treeHeight * 0.3}`}
                  fill="#2d3436"
                />
              </g>
            )
          })}

          {obstacles.map((obstacle) => {
            if (obstacle.type === 'coin') {
              return (
                <circle
                  key={`obs-${obstacle.id}`}
                  cx={obstacle.x + obstacle.width / 2}
                  cy={obstacle.y + obstacle.height / 2}
                  r={10}
                  fill="#fbbf24"
                  stroke="#d97706"
                  strokeWidth={1.5}
                  opacity={0.7 + Math.sin(elapsedMs / 200 + obstacle.id) * 0.3}
                />
              )
            }
            if (obstacle.type === 'speed_boost') {
              return (
                <g key={`obs-${obstacle.id}`}>
                  <circle cx={obstacle.x + 12} cy={obstacle.y + 12} r={11} fill="#22d3ee" stroke="#06b6d4" strokeWidth={2} />
                  <text x={obstacle.x + 12} y={obstacle.y + 16} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="bold">&gt;&gt;</text>
                </g>
              )
            }
            if (obstacle.type === 'invincible') {
              return (
                <g key={`obs-${obstacle.id}`}>
                  <circle cx={obstacle.x + 12} cy={obstacle.y + 12} r={11} fill="#a78bfa" stroke="#7c3aed" strokeWidth={2} />
                  <text x={obstacle.x + 12} y={obstacle.y + 16} textAnchor="middle" fontSize="12" fill="#fff" fontWeight="bold">*</text>
                </g>
              )
            }
            return (
              <g key={`obs-${obstacle.id}`}>
                <rect
                  x={obstacle.x}
                  y={obstacle.y}
                  width={obstacle.width}
                  height={obstacle.height}
                  rx="4"
                  fill="#e74c3c"
                  opacity="0.85"
                />
                <text
                  x={obstacle.x + obstacle.width / 2}
                  y={obstacle.y + obstacle.height / 2 + 3}
                  textAnchor="middle"
                  fontSize="10"
                  fill="#fff"
                >
                  !
                </text>
              </g>
            )
          })}

          <g transform={`translate(${STAGE_WIDTH * 0.2}, ${GROUND_Y - ZOMBIE_SIZE})`}>
            <rect x="-2" y={ZOMBIE_SIZE - 6} width={ZOMBIE_SIZE + 4} height="6" rx="3" fill="rgba(0,0,0,0.3)" />
            <rect x="0" y="0" width={ZOMBIE_SIZE} height={ZOMBIE_SIZE} rx="6" fill="#2ecc71" opacity="0.9" />
            <rect x="4" y="4" width={ZOMBIE_SIZE - 8} height={ZOMBIE_SIZE - 8} rx="4" fill="#27ae60" />
            <rect x="10" y="12" width="8" height="8" rx="2" fill="#c0392b" />
            <rect x={ZOMBIE_SIZE - 18} y="12" width="8" height="8" rx="2" fill="#c0392b" />
            <rect x="12" y="28" width={ZOMBIE_SIZE - 24} height="6" rx="2" fill="#1e8449" />
            <text x={ZOMBIE_SIZE / 2} y={-6} textAnchor="middle" fontSize="7" fill="#e74c3c">ZOMBIE</text>
            {dangerLevel === 'critical' && (
              <rect
                x="-4" y="-4"
                width={ZOMBIE_SIZE + 8} height={ZOMBIE_SIZE + 8}
                rx="8" fill="none" stroke="#e74c3c" strokeWidth="2"
                opacity={0.4 + Math.sin(elapsedMs / 100) * 0.4}
              />
            )}
          </g>

          <g transform={`translate(${STAGE_WIDTH * 0.65}, ${GROUND_Y - PLAYER_SIZE - jumpOffset})`}>
            <rect
              x="-2" y={PLAYER_SIZE - 4 + jumpOffset}
              width={PLAYER_SIZE + 4} height={4} rx="2"
              fill="rgba(0,0,0,0.25)"
              transform={jumpOffset > 0 ? `scale(1, ${1 - jumpOffset / JUMP_HEIGHT * 0.5})` : undefined}
            />
            <image
              href={kimYeonjaSprite}
              x="0" y="0"
              width={PLAYER_SIZE} height={PLAYER_SIZE}
              preserveAspectRatio="xMidYMid meet"
              className={tapFlash ? 'zombie-run-player-flash' : ''}
              style={isInvincible ? { filter: 'drop-shadow(0 0 8px rgba(167,139,250,0.8))' } : undefined}
            />
            {isJumping && (
              <text x={PLAYER_SIZE / 2} y={-8} textAnchor="middle" fontSize="8" fill="#ffeaa7">JUMP!</text>
            )}
            {isInvincible && (
              <circle cx={PLAYER_SIZE / 2} cy={PLAYER_SIZE / 2} r={PLAYER_SIZE / 2 + 4} fill="none" stroke="#a78bfa" strokeWidth="2" opacity={0.5 + Math.sin(elapsedMs / 150) * 0.3} />
            )}
          </g>

          {tapFlash && (
            <g>
              {[0, 1, 2, 3].map((index) => {
                const angle = (index * Math.PI) / 2 + (elapsedMs / 100)
                const sparkX = STAGE_WIDTH * 0.65 + PLAYER_SIZE / 2 + Math.cos(angle) * 20
                const sparkY = GROUND_Y - PLAYER_SIZE / 2 - jumpOffset + Math.sin(angle) * 15
                return (
                  <circle key={`spark-${index}`} cx={sparkX} cy={sparkY} r="2" fill={isFever ? '#ef4444' : '#ffeaa7'} opacity="0.8" />
                )
              })}
            </g>
          )}
        </svg>

        <div className="zombie-run-controls">
          <button
            className={`zombie-run-tap-button ${tapFlash ? 'zombie-run-tap-active' : ''}`}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              handleTap()
            }}
          >
            <span className="zombie-run-tap-icon">TAP!</span>
            <span className="zombie-run-tap-hint">Tap to run!</span>
          </button>
          <button
            className="zombie-run-jump-button"
            type="button"
            disabled={isJumping}
            onPointerDown={(event) => {
              event.preventDefault()
              handleSwipeUp()
            }}
          >
            <span className="zombie-run-jump-icon">JUMP</span>
          </button>
        </div>

        <p className="zombie-run-status">{statusText}</p>
        <p className="zombie-run-tap-count">TAPS: {tapCountRef.current}</p>

        <div className="zombie-run-overlay-actions">
          <button
            className="zombie-run-action-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              playSfx(tapStrongAudioRef.current, 0.5, 1)
              finishRound('Game ended!')
            }}
          >
            End
          </button>
          <button
            className="zombie-run-action-button ghost"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            Exit
          </button>
        </div>
      </div>

      <style>{`
        .zombie-run-panel {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          aspect-ratio: 9 / 16;
          background: linear-gradient(180deg, #0a1a0a 0%, #0f1f0f 25%, #0f0f23 60%, #0a0a18 100%);
          color: #e2e8f0;
          overflow: hidden;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .zombie-run-board {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100%;
          position: relative;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .zombie-run-hud {
          width: 100%;
          padding: 8px 12px 6px;
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 4px;
          background: linear-gradient(180deg, rgba(21,128,61,0.25) 0%, rgba(21,128,61,0.06) 100%);
          border-bottom: 1px solid rgba(21,128,61,0.3);
        }

        .zombie-run-hud-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #15803d;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(21,128,61,0.4);
          flex-shrink: 0;
        }

        .zombie-run-hud-row {
          display: flex;
          gap: 6px;
          align-items: baseline;
          width: 100%;
        }

        .zombie-run-score-label,
        .zombie-run-best-label {
          font-size: 7px;
          color: #a0aec0;
          letter-spacing: 1px;
        }

        .zombie-run-score-value {
          font-size: 14px;
          color: #ffeaa7;
          font-weight: bold;
        }

        .zombie-run-best-value {
          font-size: 10px;
          color: #81ecec;
        }

        .zombie-run-time-label {
          font-size: 10px;
          color: #74b9ff;
        }

        .zombie-run-time-label[data-danger="true"] {
          color: #e74c3c;
          animation: zombie-run-blink 0.5s infinite;
        }

        .zombie-run-speed-label {
          font-size: 7px;
          color: #a0aec0;
        }

        .zombie-run-gap-bar-container {
          width: 90%;
          margin: 4px auto;
          text-align: center;
        }

        .zombie-run-gap-bar-label {
          font-size: 6px;
          color: #a0aec0;
          letter-spacing: 1px;
          margin-bottom: 2px;
        }

        .zombie-run-gap-bar-track {
          width: 100%;
          height: ${BAR_HEIGHT}px;
          background: #2d3436;
          border-radius: 6px;
          overflow: hidden;
          border: 1px solid #4a5568;
        }

        .zombie-run-gap-bar-fill {
          height: 100%;
          border-radius: 6px;
          transition: width 0.1s ease-out, background 0.3s;
        }

        .zombie-run-gap-safe { background: linear-gradient(90deg, #00b894, #55efc4); }
        .zombie-run-gap-warning { background: linear-gradient(90deg, #fdcb6e, #ffeaa7); }
        .zombie-run-gap-danger { background: linear-gradient(90deg, #e17055, #fab1a0); }
        .zombie-run-gap-critical {
          background: linear-gradient(90deg, #d63031, #e74c3c);
          animation: zombie-run-pulse 0.3s infinite;
        }

        .zombie-run-gap-value {
          font-size: 8px;
          color: #dfe6e9;
          margin-top: 2px;
        }

        .zombie-run-stage {
          width: 100%;
          max-height: 220px;
          display: block;
        }

        .zombie-run-player-flash {
          filter: brightness(1.8);
        }

        .zombie-run-controls {
          display: flex;
          gap: 12px;
          width: 90%;
          margin: 8px auto;
        }

        .zombie-run-tap-button {
          flex: 3;
          height: 72px;
          border: 3px solid #15803d;
          border-radius: 12px;
          background: linear-gradient(180deg, #15803d, #0f5e2a);
          color: #fff;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          transition: transform 0.05s, background 0.05s;
          box-shadow: 0 4px 0 #0a3d1a, 0 6px 12px rgba(0, 0, 0, 0.4);
        }

        .zombie-run-tap-button:active,
        .zombie-run-tap-active {
          transform: translateY(2px);
          box-shadow: 0 2px 0 #0a3d1a, 0 3px 6px rgba(0, 0, 0, 0.4);
          background: linear-gradient(180deg, #1a9d4a, #15803d);
        }

        .zombie-run-tap-icon {
          font-size: 18px;
          font-weight: bold;
          letter-spacing: 2px;
        }

        .zombie-run-tap-hint {
          font-size: 7px;
          opacity: 0.7;
        }

        .zombie-run-jump-button {
          flex: 1;
          height: 72px;
          border: 3px solid #2980b9;
          border-radius: 12px;
          background: linear-gradient(180deg, #3498db, #2471a3);
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 0 #1a5276, 0 6px 12px rgba(0, 0, 0, 0.4);
          transition: transform 0.05s;
        }

        .zombie-run-jump-button:active {
          transform: translateY(2px);
          box-shadow: 0 2px 0 #1a5276, 0 3px 6px rgba(0, 0, 0, 0.4);
        }

        .zombie-run-jump-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .zombie-run-jump-icon {
          font-size: 11px;
          font-weight: bold;
          letter-spacing: 1px;
        }

        .zombie-run-status {
          font-size: 8px;
          color: #a0aec0;
          text-align: center;
          margin: 4px 0 0;
        }

        .zombie-run-tap-count {
          font-size: 7px;
          color: #636e72;
          text-align: center;
          margin: 2px 0 0;
        }

        .zombie-run-overlay-actions {
          position: absolute;
          top: 8px;
          right: 8px;
          display: flex;
          gap: 6px;
        }

        .zombie-run-action-button {
          padding: 5px 14px;
          border: none;
          border-radius: 6px;
          background: linear-gradient(180deg, #374151 0%, #1f2937 100%);
          color: #e5e7eb;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 2px 0 #111827, 0 3px 6px rgba(0,0,0,0.3);
          transition: transform 0.08s, box-shadow 0.08s;
        }

        .zombie-run-action-button:active {
          transform: translateY(2px);
          box-shadow: 0 0 0 #111827;
        }

        .zombie-run-action-button.ghost {
          background: transparent;
          border: 1px solid #4b5563;
          color: #9ca3af;
          box-shadow: none;
        }

        .zombie-run-action-button.ghost:active {
          background: rgba(75,85,99,0.2);
        }

        @keyframes zombie-run-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        @keyframes zombie-run-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </section>
  )
}

export const zombieRunModule: MiniGameModule = {
  manifest: {
    id: 'zombie-run',
    title: 'Zombie Run',
    description: '\uC880\uBE44\uAC00 \uCAD3\uC544\uC628\uB2E4! \uBBF8\uCE5C\uB4EF\uC774 \uD0ED\uD574\uC11C \uB3C4\uB9DD\uCCD0\uB77C!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#15803d',
  },
  Component: ZombieRunGame,
}
