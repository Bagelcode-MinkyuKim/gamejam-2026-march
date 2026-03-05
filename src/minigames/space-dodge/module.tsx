import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const STAGE_WIDTH = 360
const STAGE_HEIGHT = 560

const PLAYER_SIZE = 56
const PLAYER_COLLIDER_RADIUS = 22
const PLAYER_Y_OFFSET = 72
const PLAYER_LERP_SPEED = 0.18

const INITIAL_HP = 3
const MAX_HP = 3

const METEOR_BASE_SPEED = 140
const METEOR_MAX_SPEED = 380
const METEOR_SPEED_RAMP_PER_SECOND = 6.2
const METEOR_BASE_INTERVAL_MS = 1200
const METEOR_MIN_INTERVAL_MS = 280
const METEOR_INTERVAL_RAMP_PER_SECOND = 18
const METEOR_MIN_RADIUS = 12
const METEOR_MAX_RADIUS = 26

const STAR_SPEED = 100
const STAR_INTERVAL_MS = 6000
const STAR_RADIUS = 14
const STAR_BONUS_SCORE = 50

const SCORE_PER_SECOND = 10
const HIT_INVINCIBILITY_MS = 1200

// Shield power-up: grants temporary invincibility
const SHIELD_INTERVAL_MS = 12000
const SHIELD_RADIUS = 16
const SHIELD_SPEED = 90
const SHIELD_DURATION_MS = 3000
const SHIELD_COLOR = '#38bdf8'

// Survival milestones: bonus HP at time thresholds
const HP_RESTORE_INTERVAL_SEC = 20

// Danger escalation: every 15s, a burst of meteors
const METEOR_BURST_INTERVAL_SEC = 15
const METEOR_BURST_COUNT = 5

const METEOR_COLORS = ['#6b7280', '#78716c', '#a8a29e', '#57534e', '#9ca3af'] as const
const STAR_COLOR = '#facc15'
const STAR_GLOW_COLOR = '#fde047'

interface Meteor {
  readonly id: number
  readonly x: number
  y: number
  readonly radius: number
  readonly speed: number
  readonly color: string
  readonly rotation: number
  readonly rotationSpeed: number
}

interface Star {
  readonly id: number
  readonly x: number
  y: number
  readonly speed: number
}

interface Shield {
  readonly id: number
  readonly x: number
  y: number
  readonly speed: number
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function circlesCollide(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx
  const dy = ay - by
  return dx * dx + dy * dy <= (ar + br) * (ar + br)
}

function SpaceDodgeGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [playerX, setPlayerX] = useState(STAGE_WIDTH / 2)
  const [hp, setHp] = useState(INITIAL_HP)
  const [score, setScore] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [meteors, setMeteors] = useState<Meteor[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [isInvincible, setIsInvincible] = useState(false)
  const [shields, setShields] = useState<Shield[]>([])
  const [hasShield, setHasShield] = useState(false)
  const [statusText, setStatusText] = useState('좌우로 드래그하여 운석을 피하세요!')

  const effects = useGameEffects()

  const playerXRef = useRef(STAGE_WIDTH / 2)
  const targetXRef = useRef(STAGE_WIDTH / 2)
  const hpRef = useRef(INITIAL_HP)
  const scoreRef = useRef(0)
  const bonusScoreRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const meteorsRef = useRef<Meteor[]>([])
  const starsRef = useRef<Star[]>([])
  const nextIdRef = useRef(0)
  const lastMeteorSpawnRef = useRef(0)
  const lastStarSpawnRef = useRef(0)
  const lastShieldSpawnRef = useRef(0)
  const shieldsRef = useRef<Shield[]>([])
  const shieldActiveUntilRef = useRef(0)
  const lastHpRestoreSecRef = useRef(0)
  const lastBurstSecRef = useRef(0)
  const invincibleUntilRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const isPointerDownRef = useRef(false)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) {
      return
    }

    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const finishRound = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const finalDurationMs = elapsedMsRef.current > 0 ? Math.round(elapsedMsRef.current) : Math.round(DEFAULT_FRAME_MS)
    const finalScore = Math.floor((elapsedMsRef.current / 1000) * SCORE_PER_SECOND) + bonusScoreRef.current
    playSfx(gameOverAudioRef.current, 0.62, 0.95)
    setStatusText('게임 오버!')
    effects.triggerShake(10)
    effects.triggerFlash('rgba(239,68,68,0.5)')
    onFinish({
      score: finalScore,
      durationMs: finalDurationMs,
    })
  }, [onFinish, playSfx])

  const updateTargetX = useCallback((clientX: number) => {
    const stageElement = stageRef.current
    if (stageElement === null) {
      return
    }

    const rect = stageElement.getBoundingClientRect()
    const relativeX = (clientX - rect.left) / rect.width
    targetXRef.current = clampNumber(relativeX * STAGE_WIDTH, PLAYER_SIZE / 2, STAGE_WIDTH - PLAYER_SIZE / 2)
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      isPointerDownRef.current = true
      updateTargetX(event.clientX)
    },
    [updateTargetX],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isPointerDownRef.current && event.pointerType === 'mouse') {
        return
      }

      updateTargetX(event.clientX)
    },
    [updateTargetX],
  )

  const handlePointerUp = useCallback(() => {
    isPointerDownRef.current = false
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }

      if (finishedRef.current) {
        return
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        targetXRef.current = clampNumber(targetXRef.current - 40, PLAYER_SIZE / 2, STAGE_WIDTH - PLAYER_SIZE / 2)
        return
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault()
        targetXRef.current = clampNumber(targetXRef.current + 40, PLAYER_SIZE / 2, STAGE_WIDTH - PLAYER_SIZE / 2)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onExit])

  useEffect(() => {
    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      effects.cleanup()
      for (const audio of [tapHitAudio, tapHitStrongAudio, gameOverAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
    }
  }, [])

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
      const deltaSec = deltaMs / 1000

      elapsedMsRef.current += deltaMs
      setElapsedMs(elapsedMsRef.current)

      effects.updateParticles()

      const elapsedSec = elapsedMsRef.current / 1000

      // Update player position with lerp
      const currentX = playerXRef.current
      const target = targetXRef.current
      const nextX = currentX + (target - currentX) * PLAYER_LERP_SPEED
      playerXRef.current = nextX
      setPlayerX(nextX)

      // Calculate current difficulty
      const currentMeteorSpeed = Math.min(METEOR_MAX_SPEED, METEOR_BASE_SPEED + elapsedSec * METEOR_SPEED_RAMP_PER_SECOND)
      const currentMeteorInterval = Math.max(METEOR_MIN_INTERVAL_MS, METEOR_BASE_INTERVAL_MS - elapsedSec * METEOR_INTERVAL_RAMP_PER_SECOND)

      // Spawn meteors
      if (elapsedMsRef.current - lastMeteorSpawnRef.current >= currentMeteorInterval) {
        lastMeteorSpawnRef.current = elapsedMsRef.current
        const radius = randomBetween(METEOR_MIN_RADIUS, METEOR_MAX_RADIUS)
        const meteorX = randomBetween(radius, STAGE_WIDTH - radius)
        const colorIndex = Math.floor(Math.random() * METEOR_COLORS.length)
        const newMeteor: Meteor = {
          id: nextIdRef.current,
          x: meteorX,
          y: -radius,
          radius,
          speed: currentMeteorSpeed * randomBetween(0.8, 1.2),
          color: METEOR_COLORS[colorIndex],
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: randomBetween(-3, 3),
        }

        nextIdRef.current += 1
        meteorsRef.current = [...meteorsRef.current, newMeteor]
      }

      // Spawn stars
      if (elapsedMsRef.current - lastStarSpawnRef.current >= STAR_INTERVAL_MS) {
        lastStarSpawnRef.current = elapsedMsRef.current
        const starX = randomBetween(STAR_RADIUS + 10, STAGE_WIDTH - STAR_RADIUS - 10)
        const newStar: Star = {
          id: nextIdRef.current,
          x: starX,
          y: -STAR_RADIUS,
          speed: STAR_SPEED,
        }

        nextIdRef.current += 1
        starsRef.current = [...starsRef.current, newStar]
      }

      // Spawn shields
      if (elapsedMsRef.current - lastShieldSpawnRef.current >= SHIELD_INTERVAL_MS) {
        lastShieldSpawnRef.current = elapsedMsRef.current
        const shieldX = randomBetween(SHIELD_RADIUS + 10, STAGE_WIDTH - SHIELD_RADIUS - 10)
        const newShield: Shield = {
          id: nextIdRef.current,
          x: shieldX,
          y: -SHIELD_RADIUS,
          speed: SHIELD_SPEED,
        }
        nextIdRef.current += 1
        shieldsRef.current = [...shieldsRef.current, newShield]
      }

      // Meteor burst: every N seconds, spawn a burst of meteors
      const burstSec = Math.floor(elapsedSec / METEOR_BURST_INTERVAL_SEC)
      if (burstSec > lastBurstSecRef.current) {
        lastBurstSecRef.current = burstSec
        for (let b = 0; b < METEOR_BURST_COUNT; b += 1) {
          const radius = randomBetween(METEOR_MIN_RADIUS, METEOR_MAX_RADIUS)
          const meteorX = randomBetween(radius, STAGE_WIDTH - radius)
          const colorIndex = Math.floor(Math.random() * METEOR_COLORS.length)
          const burstMeteor: Meteor = {
            id: nextIdRef.current,
            x: meteorX,
            y: -radius - b * 30,
            radius,
            speed: currentMeteorSpeed * randomBetween(0.9, 1.3),
            color: METEOR_COLORS[colorIndex],
            rotation: Math.random() * Math.PI * 2,
            rotationSpeed: randomBetween(-3, 3),
          }
          nextIdRef.current += 1
          meteorsRef.current = [...meteorsRef.current, burstMeteor]
        }
        setStatusText('METEOR BURST!')
        effects.triggerFlash('rgba(249,115,22,0.3)', 80)
      }

      // HP restore at survival milestones
      const hpRestoreSec = Math.floor(elapsedSec / HP_RESTORE_INTERVAL_SEC)
      if (hpRestoreSec > lastHpRestoreSecRef.current && hpRef.current < MAX_HP) {
        lastHpRestoreSecRef.current = hpRestoreSec
        hpRef.current = Math.min(MAX_HP, hpRef.current + 1)
        setHp(hpRef.current)
        setStatusText('+1 HP! 생존 보너스!')
        effects.triggerFlash('rgba(34,197,94,0.3)', 80)
      }

      // Move meteors
      const playerY = STAGE_HEIGHT - PLAYER_Y_OFFSET
      const isShieldActive = elapsedMsRef.current < shieldActiveUntilRef.current
      const isCurrentlyInvincible = elapsedMsRef.current < invincibleUntilRef.current || isShieldActive
      if (isShieldActive !== hasShield) setHasShield(isShieldActive)
      let hitThisFrame = false

      const nextMeteors: Meteor[] = []
      for (const meteor of meteorsRef.current) {
        const updatedMeteor = { ...meteor, y: meteor.y + meteor.speed * deltaSec }

        // Remove if off screen
        if (updatedMeteor.y > STAGE_HEIGHT + updatedMeteor.radius + 20) {
          continue
        }

        // Collision check
        if (
          !isCurrentlyInvincible &&
          !hitThisFrame &&
          circlesCollide(
            playerXRef.current,
            playerY,
            PLAYER_COLLIDER_RADIUS,
            updatedMeteor.x,
            updatedMeteor.y,
            updatedMeteor.radius,
          )
        ) {
          hitThisFrame = true
          const nextHp = hpRef.current - 1
          hpRef.current = nextHp
          setHp(nextHp)
          invincibleUntilRef.current = elapsedMsRef.current + HIT_INVINCIBILITY_MS
          setIsInvincible(true)
          playSfx(tapHitStrongAudioRef.current, 0.55, 0.9)
          setStatusText(`피격! HP ${nextHp}`)

          // Hit visual effects
          effects.triggerShake(7)
          effects.triggerFlash('rgba(239,68,68,0.4)')
          effects.spawnParticles(5, playerXRef.current, playerY)

          if (nextHp <= 0) {
            meteorsRef.current = nextMeteors
            setMeteors(nextMeteors)
            finishRound()
            animationFrameRef.current = null
            return
          }

          continue
        }

        nextMeteors.push(updatedMeteor)
      }

      meteorsRef.current = nextMeteors

      // Move stars and check collection
      let collectedStar = false
      const nextStars: Star[] = []
      for (const star of starsRef.current) {
        const updatedStar = { ...star, y: star.y + star.speed * deltaSec }

        if (updatedStar.y > STAGE_HEIGHT + STAR_RADIUS + 20) {
          continue
        }

        if (
          circlesCollide(
            playerXRef.current,
            playerY,
            PLAYER_COLLIDER_RADIUS,
            updatedStar.x,
            updatedStar.y,
            STAR_RADIUS,
          )
        ) {
          bonusScoreRef.current += STAR_BONUS_SCORE
          collectedStar = true
          setStatusText(`+${STAR_BONUS_SCORE} 보너스!`)

          // Star collection effects
          effects.comboHitBurst(playerXRef.current, playerY - 30, 5, STAR_BONUS_SCORE)
          continue
        }

        nextStars.push(updatedStar)
      }

      starsRef.current = nextStars

      if (collectedStar) {
        playSfx(tapHitAudioRef.current, 0.5, 1.2)
      }

      // Move shields and check collection
      const nextShields: Shield[] = []
      for (const shield of shieldsRef.current) {
        const updatedShield = { ...shield, y: shield.y + shield.speed * deltaSec }
        if (updatedShield.y > STAGE_HEIGHT + SHIELD_RADIUS + 20) continue
        if (
          circlesCollide(
            playerXRef.current, playerY, PLAYER_COLLIDER_RADIUS,
            updatedShield.x, updatedShield.y, SHIELD_RADIUS,
          )
        ) {
          shieldActiveUntilRef.current = elapsedMsRef.current + SHIELD_DURATION_MS
          setHasShield(true)
          setStatusText('SHIELD ACTIVE!')
          playSfx(tapHitAudioRef.current, 0.5, 1.3)
          effects.triggerFlash('rgba(56,189,248,0.3)', 80)
          effects.spawnParticles(6, playerXRef.current, playerY)
          continue
        }
        nextShields.push(updatedShield)
      }
      shieldsRef.current = nextShields
      setShields([...nextShields])

      // Update invincibility visual
      if (isCurrentlyInvincible && elapsedMsRef.current >= invincibleUntilRef.current && !isShieldActive) {
        setIsInvincible(false)
      }

      // Update score
      const currentScore = Math.floor(elapsedSec * SCORE_PER_SECOND) + bonusScoreRef.current
      scoreRef.current = currentScore
      setScore(currentScore)
      setMeteors([...meteorsRef.current])
      setStars([...starsRef.current])

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
  const playerY = STAGE_HEIGHT - PLAYER_Y_OFFSET
  const hearts = useMemo(() => {
    const result: string[] = []
    for (let i = 0; i < MAX_HP; i += 1) {
      result.push(i < hp ? '\u2764\uFE0F' : '\uD83E\uDE76')
    }
    return result
  }, [hp])

  return (
    <section className="mini-game-panel space-dodge-panel" aria-label="space-dodge-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div
        className="space-dodge-stage"
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        role="presentation"
      >
        <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
        <ParticleRenderer particles={effects.particles} />
        <ScorePopupRenderer popups={effects.scorePopups} />

        <svg
          className="space-dodge-svg"
          viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="space-dodge-field"
        >
          <defs>
            <radialGradient id="space-dodge-star-glow">
              <stop offset="0%" stopColor={STAR_GLOW_COLOR} stopOpacity="0.8" />
              <stop offset="100%" stopColor={STAR_COLOR} stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Starfield background particles */}
          {Array.from({ length: 40 }, (_, i) => {
            const sx = ((i * 97 + 13) % STAGE_WIDTH)
            const sy = ((i * 53 + 7 + (elapsedMs * 0.02 * (0.3 + (i % 5) * 0.15))) % STAGE_HEIGHT)
            const size = 0.5 + (i % 3) * 0.5
            return (
              <circle
                key={`bg-star-${i}`}
                cx={sx}
                cy={sy}
                r={size}
                fill="white"
                opacity={0.3 + (i % 4) * 0.15}
              />
            )
          })}

          {/* Meteors */}
          {meteors.map((meteor) => {
            const rotation = meteor.rotation + (elapsedMs / 1000) * meteor.rotationSpeed
            return (
              <g key={`meteor-${meteor.id}`}>
                <circle
                  cx={meteor.x}
                  cy={meteor.y + 3}
                  r={meteor.radius}
                  fill="rgba(0,0,0,0.3)"
                />
                <g transform={`translate(${meteor.x}, ${meteor.y}) rotate(${(rotation * 180) / Math.PI})`}>
                  <ellipse
                    cx={0}
                    cy={0}
                    rx={meteor.radius}
                    ry={meteor.radius * 0.78}
                    fill={meteor.color}
                  />
                  <ellipse
                    cx={-meteor.radius * 0.25}
                    cy={-meteor.radius * 0.2}
                    rx={meteor.radius * 0.35}
                    ry={meteor.radius * 0.25}
                    fill="rgba(255,255,255,0.15)"
                  />
                  <circle
                    cx={meteor.radius * 0.2}
                    cy={meteor.radius * 0.15}
                    r={meteor.radius * 0.15}
                    fill="rgba(0,0,0,0.2)"
                  />
                </g>
              </g>
            )
          })}

          {/* Stars */}
          {stars.map((star) => (
            <g key={`star-${star.id}`}>
              <circle
                cx={star.x}
                cy={star.y}
                r={STAR_RADIUS * 2}
                fill="url(#space-dodge-star-glow)"
              />
              <polygon
                points={createStarPoints(star.x, star.y, STAR_RADIUS, STAR_RADIUS * 0.45, 5)}
                fill={STAR_COLOR}
                stroke="#ca8a04"
                strokeWidth="1"
              />
            </g>
          ))}

          {/* Shield pickups */}
          {shields.map((shield) => (
            <g key={`shield-${shield.id}`}>
              <circle cx={shield.x} cy={shield.y} r={SHIELD_RADIUS * 1.8} fill="rgba(56,189,248,0.15)" />
              <circle cx={shield.x} cy={shield.y} r={SHIELD_RADIUS} fill={SHIELD_COLOR} stroke="#0284c7" strokeWidth="2" opacity="0.9" />
              <text x={shield.x} y={shield.y + 4} textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">S</text>
            </g>
          ))}

          {/* Shield active indicator around player */}
          {hasShield && (
            <circle
              cx={playerX}
              cy={playerY}
              r={PLAYER_SIZE * 0.55}
              fill="none"
              stroke={SHIELD_COLOR}
              strokeWidth="2.5"
              opacity={0.6 + Math.sin(elapsedMs * 0.01) * 0.3}
            />
          )}

          {/* Player shadow */}
          <ellipse
            cx={playerX}
            cy={playerY + PLAYER_SIZE * 0.42}
            rx={PLAYER_SIZE * 0.32}
            ry={4}
            fill="rgba(0,200,255,0.2)"
          />

          {/* Player ship */}
          <image
            className={`space-dodge-player ${isInvincible ? 'space-dodge-blink' : ''}`}
            href={seoTaijiSprite}
            x={playerX - PLAYER_SIZE / 2}
            y={playerY - PLAYER_SIZE / 2}
            width={PLAYER_SIZE}
            height={PLAYER_SIZE}
            preserveAspectRatio="xMidYMid meet"
          />

          {/* Engine glow */}
          <ellipse
            cx={playerX}
            cy={playerY + PLAYER_SIZE * 0.46}
            rx={6 + Math.sin(elapsedMs * 0.012) * 2}
            ry={10 + Math.sin(elapsedMs * 0.015) * 3}
            fill="rgba(56,189,248,0.5)"
          />
          <ellipse
            cx={playerX}
            cy={playerY + PLAYER_SIZE * 0.46}
            rx={3}
            ry={6 + Math.sin(elapsedMs * 0.018) * 2}
            fill="rgba(255,255,255,0.6)"
          />
        </svg>

        <div className="space-dodge-hud">
          <div className="space-dodge-hud-top">
            <div className="space-dodge-hearts">
              {hearts.map((heart, index) => (
                <span key={`hp-${index}`} className="space-dodge-heart">{heart}</span>
              ))}
            </div>
            <p className="space-dodge-score">{score}</p>
            <p className="space-dodge-best">BEST {displayedBestScore}</p>
          </div>
          <p className="space-dodge-time">{(elapsedMs / 1000).toFixed(1)}s</p>
        </div>

        <p className="space-dodge-status">{statusText}</p>

        <div className="space-dodge-overlay-actions">
          <button
            className="space-dodge-action-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              playSfx(tapHitStrongAudioRef.current, 0.5, 1)
              finishRound()
            }}
          >
            종료
          </button>
          <button
            className="space-dodge-action-button ghost"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            나가기
          </button>
        </div>
      </div>

      <style>{`
        ${GAME_EFFECTS_CSS}

        .space-dodge-panel {
          background: #030712;
          color: #e2e8f0;
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100%;
          overflow: hidden;
          user-select: none;
          touch-action: none;
        }

        .space-dodge-stage {
          position: relative;
          width: 100%;
          height: 100%;
          max-width: 420px;
          background: linear-gradient(180deg, #030712 0%, #0f172a 40%, #1e293b 100%);
          overflow: hidden;
        }

        .space-dodge-svg {
          display: block;
          width: 100%;
          height: 100%;
        }

        .space-dodge-player {
          filter: drop-shadow(0 0 8px rgba(56, 189, 248, 0.6));
          transition: opacity 0.05s;
        }

        .space-dodge-blink {
          animation: space-dodge-blink-anim 0.15s infinite alternate;
        }

        @keyframes space-dodge-blink-anim {
          0% { opacity: 1; }
          100% { opacity: 0.25; }
        }

        .space-dodge-hud {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          padding: 10px 14px 6px;
          pointer-events: none;
          z-index: 10;
        }

        .space-dodge-hud-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .space-dodge-hearts {
          display: flex;
          gap: 4px;
          font-size: 18px;
        }

        .space-dodge-heart {
          display: inline-block;
        }

        .space-dodge-score {
          margin: 0;
          font-size: 28px;
          font-weight: 800;
          color: #f8fafc;
          text-shadow: 0 2px 8px rgba(56, 189, 248, 0.4);
          text-align: center;
          flex: 1;
        }

        .space-dodge-best {
          margin: 0;
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
          text-align: right;
          min-width: 60px;
        }

        .space-dodge-time {
          margin: 2px 0 0;
          font-size: 12px;
          color: #64748b;
          text-align: center;
        }

        .space-dodge-status {
          position: absolute;
          bottom: 58px;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 13px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
          pointer-events: none;
          z-index: 10;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
        }

        .space-dodge-overlay-actions {
          position: absolute;
          bottom: 12px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          gap: 10px;
          z-index: 20;
        }

        .space-dodge-action-button {
          padding: 6px 18px;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          background: rgba(30, 58, 95, 0.85);
          color: #e2e8f0;
          backdrop-filter: blur(4px);
          transition: background 0.15s;
        }

        .space-dodge-action-button:hover {
          background: rgba(30, 58, 95, 1);
        }

        .space-dodge-action-button.ghost {
          background: rgba(255, 255, 255, 0.08);
          color: #94a3b8;
        }

        .space-dodge-action-button.ghost:hover {
          background: rgba(255, 255, 255, 0.14);
        }
      `}</style>
    </section>
  )
}

function createStarPoints(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
): string {
  const result: string[] = []
  const angleStep = Math.PI / points

  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius
    const angle = i * angleStep - Math.PI / 2
    const x = cx + Math.cos(angle) * radius
    const y = cy + Math.sin(angle) * radius
    result.push(`${x.toFixed(2)},${y.toFixed(2)}`)
  }

  return result.join(' ')
}

export const spaceDodgeModule: MiniGameModule = {
  manifest: {
    id: 'space-dodge',
    title: 'Space Dodge',
    description: '운석을 피하고 별을 모아라! 우주 생존 도전!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#1e3a5f',
  },
  Component: SpaceDodgeGame,
}
