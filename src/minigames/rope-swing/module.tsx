import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import taeJinaSprite from '../../../assets/images/same-character/tae-jina.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// --- Physics & Layout Constants ---

const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 640

const ROPE_ANCHOR_Y = 40
const ROPE_LENGTH_MIN = 140
const ROPE_LENGTH_MAX = 200
const ROPE_GRAB_RADIUS = 50

const GRAVITY = 980
const PENDULUM_DAMPING = 0.998
const WIND_MAX_FORCE = 120
const WIND_CHANGE_INTERVAL_MS = 3000

const INITIAL_ROPE_GAP_MIN = 100
const INITIAL_ROPE_GAP_MAX = 140
const GAP_INCREASE_PER_SCORE = 1.8
const MAX_ROPE_GAP = 220

const PLAYER_WIDTH = 48
const PLAYER_HEIGHT = 56

const COMBO_DECAY_MS = 2500
const COMBO_MULTIPLIER_STEP = 5

const FALL_ZONE_Y = VIEWBOX_HEIGHT + 60

const SPEED_INCREASE_PER_SCORE = 0.03
const MAX_SPEED_MULTIPLIER = 2.5
const COIN_SPAWN_CHANCE = 0.6
const COIN_RADIUS = 12
const COIN_COLLECT_RADIUS = 30
const COIN_SCORE = 5
const DISTANCE_BONUS_DIVISOR = 80
const FEVER_COMBO_THRESHOLD = 10
const FEVER_MULTIPLIER = 2

// --- Types ---

interface Rope {
  readonly id: number
  readonly anchorX: number
  readonly length: number
}

type GamePhase = 'swinging' | 'flying' | 'falling' | 'ended'

interface PlayerState {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  angularVelocity: number
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
  const [statusText, setStatusText] = useState('탭하여 로프를 놓으세요!')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [coins, setCoins] = useState<Array<{ id: number; x: number; y: number; collected: boolean }>>([])
  const [coinsCollected, setCoinsCollected] = useState(0)
  const [isFever, setIsFever] = useState(false)

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

  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapStrongAudioRef = useRef<HTMLAudioElement | null>(null)
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
    phaseRef.current = 'ended'
    setPhase('ended')
    const finalElapsedMs = Math.max(16.66, elapsedMsRef.current)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(finalElapsedMs),
    })
  }, [onFinish])

  const handleTap = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    const currentPhase = phaseRef.current
    if (currentPhase === 'ended' || currentPhase === 'falling') {
      return
    }

    if (currentPhase === 'swinging') {
      const player = playerRef.current
      const rope = ropesRef.current[currentRopeIndexRef.current]
      if (!rope) {
        return
      }

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
      playSfx(tapAudioRef.current, 0.5, 1.1)
      setStatusText('날아가는 중...')
    }
  }, [playSfx])

  const syncVisualState = useCallback(() => {
    const player = playerRef.current
    setPlayerPos({ x: player.x, y: player.y })
    setPendulumAngle(player.angle)
    setWindForce(windForceRef.current)
    setCameraOffsetX(cameraOffsetXRef.current)
    setElapsedMs(elapsedMsRef.current)
  }, [])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const comboMultiplier = useMemo(() => toComboMultiplier(combo), [combo])

  // --- Audio setup ---
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
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
      }

      const player = playerRef.current
      const currentPhase = phaseRef.current

      if (currentPhase === 'swinging') {
        const rope = ropesRef.current[currentRopeIndexRef.current]
        if (rope) {
          // Pendulum physics: angular acceleration = -(g/L) * sin(angle) + wind/(m*L) * cos(angle)
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
        // Speed increases with score
        const speedMult = Math.min(MAX_SPEED_MULTIPLIER, 1 + scoreRef.current * SPEED_INCREASE_PER_SCORE)

        // Parabolic flight
        player.vy += GRAVITY * deltaSec
        player.vx += windForceRef.current * 0.3 * deltaSec
        player.x += player.vx * deltaSec * speedMult
        player.y += player.vy * deltaSec

        // Coin collection during flight
        for (const coin of coinsRef.current) {
          if (coin.collected) continue
          const dist = Math.hypot(player.x - coin.x, player.y - coin.y)
          if (dist < COIN_COLLECT_RADIUS) {
            coin.collected = true
            coinsCollectedRef.current += 1
            setCoinsCollected(coinsCollectedRef.current)
            const coinPoints = COIN_SCORE * toComboMultiplier(comboRef.current)
            scoreRef.current += coinPoints
            setScore(scoreRef.current)
            playSfx(tapStrongAudioRef.current, 0.4, 1.3)
          }
        }
        coinsRef.current = coinsRef.current.filter((c) => !c.collected)
        setCoins([...coinsRef.current])

        // Check if grabbed next rope
        const allRopes = ropesRef.current
        for (let i = 0; i < allRopes.length; i++) {
          if (i <= currentRopeIndexRef.current) {
            continue
          }
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
            setIsFever(feverActive)

            // Distance-based scoring
            const grabDist = Math.abs(player.x - rope.anchorX)
            const distanceBonus = Math.floor(grabDist / DISTANCE_BONUS_DIVISOR)
            let earnedPoints = (1 + distanceBonus) * comboMult
            if (feverActive) {
              earnedPoints *= FEVER_MULTIPLIER
            }

            const nextScore = scoreRef.current + earnedPoints
            scoreRef.current = nextScore
            setScore(nextScore)

            phaseRef.current = 'swinging'
            setPhase('swinging')

            if (comboMult > 1) {
              playSfx(tapStrongAudioRef.current, 0.55, 1 + comboRef.current * 0.03)
            } else {
              playSfx(tapAudioRef.current, 0.45, 1.05)
            }

            setStatusText(`스윙 ${scoreRef.current}! 콤보 x${comboMult}${feverActive ? ' FEVER!' : ''}`)
            effects.triggerFlash()
            effects.spawnParticles(4, 200, 200)

            // Spawn coins between current and next rope
            if (Math.random() < COIN_SPAWN_CHANCE && i + 1 < allRopes.length) {
              const nextRopeAnchor = allRopes[i + 1] ? allRopes[i + 1].anchorX : rope.anchorX + 100
              const coinX = (rope.anchorX + nextRopeAnchor) / 2
              const coinY = randomBetween(ROPE_ANCHOR_Y + 100, VIEWBOX_HEIGHT - 100)
              const newCoin = { id: coinIdCounterRef.current, x: coinX, y: coinY, collected: false }
              coinIdCounterRef.current += 1
              coinsRef.current = [...coinsRef.current, newCoin]
              setCoins([...coinsRef.current])
            }

            // Generate new ropes ahead
            let currentRopes = [...ropesRef.current]
            while (currentRopes.length - i < 3) {
              const lastRope = currentRopes[currentRopes.length - 1]
              const newRope = generateNextRope(lastRope.anchorX, scoreRef.current, ropeIdCounterRef.current)
              ropeIdCounterRef.current += 1
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
          setStatusText('추락! 게임 오버')
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.4)')
          playSfx(gameOverAudioRef.current, 0.62, 0.9)
          finishRound()
          animationFrameRef.current = null
          syncVisualState()
          return
        }

        // Check out of bounds horizontally
        if (player.x < -100 || player.x > VIEWBOX_WIDTH + 100) {
          phaseRef.current = 'falling'
          setPhase('falling')
          setStatusText('화면 밖으로! 게임 오버')
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.4)')
          playSfx(gameOverAudioRef.current, 0.62, 0.9)
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
  }, [finishRound, playSfx, syncVisualState])

  // --- Derived visuals ---
  const currentRope = ropes[currentRopeIndex] ?? null
  const isSwinging = phase === 'swinging'

  const windIndicator = useMemo(() => {
    const absWind = Math.abs(windForce)
    if (absWind < 15) return ''
    const dir = windForce > 0 ? '>>>' : '<<<'
    const strength = absWind > 80 ? '강풍' : absWind > 40 ? '바람' : '미풍'
    return `${dir} ${strength}`
  }, [windForce])

  return (
    <section className="mini-game-panel rope-swing-panel" aria-label="rope-swing-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <div
        className="rope-swing-board"
        onClick={handleTap}
        onTouchStart={(e) => {
          e.preventDefault()
          handleTap()
        }}
        role="presentation"
      >
        <svg
          className="rope-swing-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="rope-swing-stage"
        >
          {/* Sky gradient background */}
          <defs>
            <linearGradient id="rope-swing-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f172a" />
              <stop offset="40%" stopColor="#1e3a5f" />
              <stop offset="100%" stopColor="#059669" stopOpacity="0.3" />
            </linearGradient>
            <linearGradient id="rope-swing-rope-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#d97706" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#rope-swing-sky)" />

          {/* Stars */}
          {Array.from({ length: 20 }, (_, i) => (
            <circle
              key={`star-${i}`}
              cx={((i * 97 + 31) % VIEWBOX_WIDTH)}
              cy={((i * 53 + 17) % (VIEWBOX_HEIGHT * 0.4))}
              r={i % 3 === 0 ? 1.5 : 1}
              fill="white"
              opacity={0.3 + (i % 5) * 0.12}
            />
          ))}

          {/* Ropes & anchors, offset by camera */}
          <g transform={`translate(${(-cameraOffsetX).toFixed(2)}, 0)`}>
            {ropes.map((rope, ropeIdx) => {
              const isActive = ropeIdx === currentRopeIndex && isSwinging
              const ropeBottomX = isActive
                ? rope.anchorX + Math.sin(pendulumAngle) * rope.length
                : rope.anchorX
              const ropeBottomY = isActive
                ? ROPE_ANCHOR_Y + Math.cos(pendulumAngle) * rope.length
                : ROPE_ANCHOR_Y + rope.length

              return (
                <g key={rope.id}>
                  {/* Anchor point */}
                  <circle
                    cx={rope.anchorX}
                    cy={ROPE_ANCHOR_Y}
                    r={6}
                    fill="#fbbf24"
                    stroke="#92400e"
                    strokeWidth={2}
                  />
                  {/* Rope line */}
                  <line
                    x1={rope.anchorX}
                    y1={ROPE_ANCHOR_Y}
                    x2={ropeBottomX}
                    y2={ropeBottomY}
                    stroke="url(#rope-swing-rope-grad)"
                    strokeWidth={isActive ? 3 : 2}
                    strokeLinecap="round"
                    opacity={ropeIdx < currentRopeIndex ? 0.3 : 1}
                  />
                  {/* Grab zone hint for next rope */}
                  {ropeIdx === currentRopeIndex + 1 && phase === 'swinging' && (
                    <circle
                      cx={rope.anchorX}
                      cy={ROPE_ANCHOR_Y + rope.length * 0.6}
                      r={ROPE_GRAB_RADIUS}
                      fill="none"
                      stroke="#34d399"
                      strokeWidth={1.5}
                      strokeDasharray="4 4"
                      opacity={0.4}
                    />
                  )}
                </g>
              )
            })}

            {/* Coins */}
            {coins.map((coin) => (
              <g key={`coin-${coin.id}`}>
                <circle cx={coin.x} cy={coin.y} r={COIN_RADIUS} fill="#fbbf24" stroke="#d97706" strokeWidth={2} />
                <circle cx={coin.x - 3} cy={coin.y - 3} r={3} fill="#fef3c7" opacity={0.6} />
              </g>
            ))}

            {/* Player */}
            <g>
              {/* Shadow */}
              <ellipse
                cx={playerPos.x}
                cy={Math.min(playerPos.y + PLAYER_HEIGHT / 2 + 4, VIEWBOX_HEIGHT - 20)}
                rx={14}
                ry={4}
                fill="rgba(0,0,0,0.25)"
              />
              {/* Character sprite */}
              <image
                href={taeJinaSprite}
                x={playerPos.x - PLAYER_WIDTH / 2}
                y={playerPos.y - PLAYER_HEIGHT / 2}
                width={PLAYER_WIDTH}
                height={PLAYER_HEIGHT}
                preserveAspectRatio="xMidYMid meet"
              />
            </g>
          </g>

          {/* Bottom danger zone */}
          <rect
            x="0"
            y={VIEWBOX_HEIGHT - 30}
            width={VIEWBOX_WIDTH}
            height={30}
            fill="rgba(239,68,68,0.15)"
          />
          <line
            x1="0"
            y1={VIEWBOX_HEIGHT - 30}
            x2={VIEWBOX_WIDTH}
            y2={VIEWBOX_HEIGHT - 30}
            stroke="#ef4444"
            strokeWidth={1}
            strokeDasharray="8 4"
            opacity={0.5}
          />
        </svg>

        {/* HUD overlay */}
        <div className="rope-swing-hud">
          <p className="rope-swing-score">{score}</p>
          <p className="rope-swing-best">BEST {displayedBestScore}</p>
          <div className="rope-swing-meta">
            {combo > 1 && (
              <span className="rope-swing-combo">
                COMBO x{comboMultiplier}
              </span>
            )}
            {isFever && (
              <span style={{ color: '#fbbf24', fontWeight: 800, fontSize: 12, textShadow: '0 0 6px #f59e0b' }}>
                FEVER x{FEVER_MULTIPLIER}
              </span>
            )}
            {coinsCollected > 0 && (
              <span style={{ color: '#fbbf24', fontSize: 11 }}>
                Coins {coinsCollected}
              </span>
            )}
            {windIndicator && (
              <span className="rope-swing-wind">{windIndicator}</span>
            )}
          </div>
        </div>

        <p className="rope-swing-status">{statusText}</p>
        <p className="rope-swing-tap-hint">화면을 탭하여 로프를 놓으세요</p>

        <div className="rope-swing-overlay-actions">
          <button
            className="rope-swing-action-button"
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              playSfx(tapStrongAudioRef.current, 0.5, 1)
              finishRound()
            }}
          >
            종료
          </button>
          <button
            className="rope-swing-action-button ghost"
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onExit()
            }}
          >
            나가기
          </button>
        </div>
      </div>
      <style>{GAME_EFFECTS_CSS}</style>
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
    description: '로프를 잡고 날아라! 타이밍 맞춰 놓고 다음 로프로!',
    unlockCost: 55,
    baseReward: 17,
    scoreRewardMultiplier: 1.25,
    accentColor: '#059669',
  },
  Component: RopeSwingGame,
}
