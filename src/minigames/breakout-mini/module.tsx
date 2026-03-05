import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 480

const PADDLE_WIDTH = 64
const PADDLE_HEIGHT = 10
const PADDLE_Y = VIEWBOX_HEIGHT - 32
const PADDLE_CORNER_RADIUS = 5

const BALL_RADIUS = 6
const BALL_INITIAL_SPEED = 220
const BALL_SPEED_INCREMENT = 18
const BALL_MAX_SPEED = 440
const BALL_MIN_VY_RATIO = 0.35

const BRICK_ROWS = 5
const BRICK_COLS = 8
const BRICK_WIDTH = 38
const BRICK_HEIGHT = 14
const BRICK_GAP = 3
const BRICK_TOP_OFFSET = 52
const BRICK_LEFT_OFFSET = (VIEWBOX_WIDTH - (BRICK_COLS * BRICK_WIDTH + (BRICK_COLS - 1) * BRICK_GAP)) / 2

const INITIAL_LIVES = 3
const LAUNCH_DELAY_MS = 800
const PARTICLE_COUNT = 6
const PARTICLE_LIFETIME_MS = 380
const SHAKE_DURATION_MS = 150
const SHAKE_INTENSITY = 4

// Multi-ball power-up: spawns an extra ball every N bricks destroyed
const MULTI_BALL_BRICK_THRESHOLD = 12
const MAX_EXTRA_BALLS = 2

// Unbreakable bricks: appear from stage 3+
const UNBREAKABLE_STAGE_START = 3
const UNBREAKABLE_COLOR = '#475569'
const UNBREAKABLE_SHINE = 'rgba(255,255,255,0.1)'

// Score multiplier: consecutive hits without paddle bounce
const CONSECUTIVE_HIT_BONUS = 5

interface Brick {
  readonly id: number
  readonly row: number
  readonly col: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly color: string
  readonly points: number
  readonly unbreakable: boolean
  alive: boolean
}

interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  speed: number
  launched: boolean
}

interface Particle {
  readonly id: number
  x: number
  y: number
  vx: number
  vy: number
  color: string
  createdAtMs: number
}

interface GameState {
  bricks: Brick[]
  ball: Ball
  extraBalls: Ball[]
  paddleX: number
  lives: number
  score: number
  stage: number
  particles: Particle[]
  elapsedMs: number
  launchTimerMs: number
  shakeMs: number
  nextParticleId: number
  nextBrickId: number
  consecutiveHits: number
  totalBricksDestroyed: number
  multiBallsSpawned: number
}

const BRICK_COLORS: { color: string; points: number }[] = [
  { color: '#ef4444', points: 30 },
  { color: '#f97316', points: 20 },
  { color: '#eab308', points: 10 },
  { color: '#22c55e', points: 5 },
  { color: '#06b6d4', points: 5 },
]

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function createBricks(stage: number, startId: number): Brick[] {
  const bricks: Brick[] = []
  let id = startId
  const rows = Math.min(BRICK_ROWS + Math.floor(stage / 3), 7)

  for (let row = 0; row < rows; row += 1) {
    const colorIndex = row % BRICK_COLORS.length
    const { color, points } = BRICK_COLORS[colorIndex]

    for (let col = 0; col < BRICK_COLS; col += 1) {
      const skipPattern = stage > 1 && (row + col + stage) % 7 === 0
      if (skipPattern) {
        continue
      }

      const x = BRICK_LEFT_OFFSET + col * (BRICK_WIDTH + BRICK_GAP)
      const y = BRICK_TOP_OFFSET + row * (BRICK_HEIGHT + BRICK_GAP)

      // Unbreakable bricks from stage 3+, scattered pattern
      const isUnbreakable = stage >= UNBREAKABLE_STAGE_START && (row + col + stage) % 11 === 0

      bricks.push({
        id,
        row,
        col,
        x,
        y,
        width: BRICK_WIDTH,
        height: BRICK_HEIGHT,
        color: isUnbreakable ? UNBREAKABLE_COLOR : color,
        points: isUnbreakable ? 0 : points,
        unbreakable: isUnbreakable,
        alive: true,
      })
      id += 1
    }
  }

  return bricks
}

function createBall(paddleX: number): Ball {
  return {
    x: paddleX,
    y: PADDLE_Y - BALL_RADIUS - 1,
    vx: 0,
    vy: 0,
    speed: BALL_INITIAL_SPEED,
    launched: false,
  }
}

function launchBall(ball: Ball): void {
  const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI / 3)
  ball.vx = Math.cos(angle) * ball.speed
  ball.vy = Math.sin(angle) * ball.speed
  ball.launched = true
}

function createInitialState(): GameState {
  const paddleX = VIEWBOX_WIDTH / 2
  const bricks = createBricks(1, 0)
  return {
    bricks,
    ball: createBall(paddleX),
    extraBalls: [],
    paddleX,
    lives: INITIAL_LIVES,
    score: 0,
    stage: 1,
    particles: [],
    elapsedMs: 0,
    launchTimerMs: LAUNCH_DELAY_MS,
    shakeMs: 0,
    nextParticleId: 0,
    nextBrickId: bricks.length,
    consecutiveHits: 0,
    totalBricksDestroyed: 0,
    multiBallsSpawned: 0,
  }
}

function spawnParticles(state: GameState, x: number, y: number, color: string): void {
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const angle = Math.random() * Math.PI * 2
    const speed = 60 + Math.random() * 140
    state.particles.push({
      id: state.nextParticleId,
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      createdAtMs: state.elapsedMs,
    })
    state.nextParticleId += 1
  }
}

function rectIntersectsBall(
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  bx: number,
  by: number,
  br: number,
): { hit: boolean; normalX: number; normalY: number } {
  const closestX = clampNumber(bx, rx, rx + rw)
  const closestY = clampNumber(by, ry, ry + rh)
  const dx = bx - closestX
  const dy = by - closestY
  const distSq = dx * dx + dy * dy

  if (distSq > br * br) {
    return { hit: false, normalX: 0, normalY: 0 }
  }

  const dist = Math.sqrt(distSq) || 1
  return { hit: true, normalX: dx / dist, normalY: dy / dist }
}

function reflectBall(ball: Ball, normalX: number, normalY: number): void {
  const dot = ball.vx * normalX + ball.vy * normalY
  ball.vx -= 2 * dot * normalX
  ball.vy -= 2 * dot * normalY

  const currentSpeed = Math.hypot(ball.vx, ball.vy) || 1
  ball.vx = (ball.vx / currentSpeed) * ball.speed
  ball.vy = (ball.vy / currentSpeed) * ball.speed
}

function ensureMinVerticalComponent(ball: Ball): void {
  const currentSpeed = Math.hypot(ball.vx, ball.vy) || 1
  const vyRatio = Math.abs(ball.vy) / currentSpeed
  if (vyRatio < BALL_MIN_VY_RATIO) {
    const sign = ball.vy >= 0 ? 1 : -1
    ball.vy = sign * BALL_MIN_VY_RATIO * ball.speed
    const remainingVx = Math.sqrt(ball.speed * ball.speed - ball.vy * ball.vy)
    ball.vx = Math.sign(ball.vx || 1) * remainingVx
  }
}

function BreakoutMiniGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [renderScore, setRenderScore] = useState(0)
  const [renderLives, setRenderLives] = useState(INITIAL_LIVES)
  const [renderStage, setRenderStage] = useState(1)
  const [renderBricks, setRenderBricks] = useState<Brick[]>(() => createBricks(1, 0))
  const [renderBallX, setRenderBallX] = useState(VIEWBOX_WIDTH / 2)
  const [renderBallY, setRenderBallY] = useState(PADDLE_Y - BALL_RADIUS - 1)
  const [renderPaddleX, setRenderPaddleX] = useState(VIEWBOX_WIDTH / 2)
  const [renderParticles, setRenderParticles] = useState<Particle[]>([])
  const [renderShakeX, setRenderShakeX] = useState(0)
  const [renderShakeY, setRenderShakeY] = useState(0)

  const effects = useGameEffects()
  const bricksDestroyedRef = useRef(0)

  const stateRef = useRef<GameState>(createInitialState())
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const pointerXRef = useRef<number | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)

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

  const syncRenderState = useCallback((state: GameState) => {
    setRenderScore(state.score)
    setRenderLives(state.lives)
    setRenderStage(state.stage)
    setRenderBricks([...state.bricks])
    setRenderBallX(state.ball.x)
    setRenderBallY(state.ball.y)
    setRenderPaddleX(state.paddleX)
    setRenderParticles([...state.particles])

    if (state.shakeMs > 0) {
      const intensity = (state.shakeMs / SHAKE_DURATION_MS) * SHAKE_INTENSITY
      setRenderShakeX((Math.random() - 0.5) * 2 * intensity)
      setRenderShakeY((Math.random() - 0.5) * 2 * intensity)
    } else {
      setRenderShakeX(0)
      setRenderShakeY(0)
    }
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const state = stateRef.current
    const elapsedMs = Math.max(Math.round(state.elapsedMs), Math.round(DEFAULT_FRAME_MS))
    playSfx(gameOverAudioRef.current, 0.6, 0.95)
    effects.cleanup()
    onFinish({
      score: state.score,
      durationMs: elapsedMs,
    })
  }, [onFinish, playSfx])

  const advanceStage = useCallback((state: GameState) => {
    state.stage += 1
    const newSpeed = Math.min(BALL_MAX_SPEED, state.ball.speed + BALL_SPEED_INCREMENT)
    const bricks = createBricks(state.stage, state.nextBrickId)
    state.bricks = bricks
    state.nextBrickId += bricks.length
    state.ball = createBall(state.paddleX)
    state.ball.speed = newSpeed
    state.launchTimerMs = LAUNCH_DELAY_MS
    playSfx(tapHitStrongAudioRef.current, 0.55, 1.15)

    // Stage clear effects
    effects.comboHitBurst(180, 240, state.stage * 5, 0)
  }, [playSfx])

  const loseBall = useCallback((state: GameState) => {
    state.lives -= 1
    state.shakeMs = SHAKE_DURATION_MS

    // Life lost effects
    effects.triggerShake(8)
    effects.triggerFlash('rgba(239,68,68,0.4)')

    if (state.lives <= 0) {
      return
    }

    state.ball = createBall(state.paddleX)
    state.launchTimerMs = LAUNCH_DELAY_MS
  }, [])

  const updatePaddleFromPointer = useCallback((state: GameState) => {
    const board = boardRef.current
    if (board === null || pointerXRef.current === null) {
      return
    }

    const rect = board.getBoundingClientRect()
    const relativeX = (pointerXRef.current - rect.left) / rect.width
    const targetX = clampNumber(
      relativeX * VIEWBOX_WIDTH,
      PADDLE_WIDTH / 2,
      VIEWBOX_WIDTH - PADDLE_WIDTH / 2,
    )

    state.paddleX += (targetX - state.paddleX) * 0.35
    state.paddleX = clampNumber(state.paddleX, PADDLE_WIDTH / 2, VIEWBOX_WIDTH - PADDLE_WIDTH / 2)
  }, [])

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
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
    }
  }, [])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      pointerXRef.current = event.clientX
    }

    const handlePointerDown = (event: PointerEvent) => {
      pointerXRef.current = event.clientX
    }

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        pointerXRef.current = event.touches[0].clientX
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('touchmove', handleTouchMove, { passive: true })

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('touchmove', handleTouchMove)
    }
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

      const state = stateRef.current
      const moveStep = 18

      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        state.paddleX = clampNumber(state.paddleX - moveStep, PADDLE_WIDTH / 2, VIEWBOX_WIDTH - PADDLE_WIDTH / 2)
      } else if (event.code === 'ArrowRight') {
        event.preventDefault()
        state.paddleX = clampNumber(state.paddleX + moveStep, PADDLE_WIDTH / 2, VIEWBOX_WIDTH - PADDLE_WIDTH / 2)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onExit])

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
      const state = stateRef.current
      const deltaSec = deltaMs / 1000
      state.elapsedMs += deltaMs

      effects.updateParticles()

      updatePaddleFromPointer(state)

      if (state.shakeMs > 0) {
        state.shakeMs = Math.max(0, state.shakeMs - deltaMs)
      }

      state.particles = state.particles.filter(
        (p) => state.elapsedMs - p.createdAtMs < PARTICLE_LIFETIME_MS,
      )
      for (const p of state.particles) {
        p.x += p.vx * deltaSec
        p.y += p.vy * deltaSec
        p.vy += 200 * deltaSec
      }

      const ball = state.ball

      if (!ball.launched) {
        ball.x = state.paddleX
        ball.y = PADDLE_Y - BALL_RADIUS - 1
        state.launchTimerMs -= deltaMs
        if (state.launchTimerMs <= 0) {
          launchBall(ball)
        }
        syncRenderState(state)
        animationFrameRef.current = window.requestAnimationFrame(step)
        return
      }

      const subSteps = Math.max(1, Math.ceil(deltaMs / (DEFAULT_FRAME_MS * 0.5)))
      const subDeltaSec = deltaSec / subSteps

      for (let sub = 0; sub < subSteps; sub += 1) {
        ball.x += ball.vx * subDeltaSec
        ball.y += ball.vy * subDeltaSec

        if (ball.x - BALL_RADIUS <= 0) {
          ball.x = BALL_RADIUS
          ball.vx = Math.abs(ball.vx)
        } else if (ball.x + BALL_RADIUS >= VIEWBOX_WIDTH) {
          ball.x = VIEWBOX_WIDTH - BALL_RADIUS
          ball.vx = -Math.abs(ball.vx)
        }

        if (ball.y - BALL_RADIUS <= 0) {
          ball.y = BALL_RADIUS
          ball.vy = Math.abs(ball.vy)
        }

        if (ball.y + BALL_RADIUS >= VIEWBOX_HEIGHT + 20) {
          loseBall(state)
          if (state.lives <= 0) {
            syncRenderState(state)
            finishGame()
            return
          }
          syncRenderState(state)
          animationFrameRef.current = window.requestAnimationFrame(step)
          return
        }

        const paddleLeft = state.paddleX - PADDLE_WIDTH / 2
        const paddleCollision = rectIntersectsBall(
          paddleLeft,
          PADDLE_Y,
          PADDLE_WIDTH,
          PADDLE_HEIGHT,
          ball.x,
          ball.y,
          BALL_RADIUS,
        )

        if (paddleCollision.hit && ball.vy > 0) {
          ball.y = PADDLE_Y - BALL_RADIUS
          state.consecutiveHits = 0 // Reset consecutive hits on paddle bounce
          const hitOffset = (ball.x - state.paddleX) / (PADDLE_WIDTH / 2)
          const clampedOffset = clampNumber(hitOffset, -0.92, 0.92)
          const bounceAngle = clampedOffset * (Math.PI / 3)
          ball.vx = Math.sin(bounceAngle) * ball.speed
          ball.vy = -Math.cos(bounceAngle) * ball.speed
          ensureMinVerticalComponent(ball)
          playSfx(tapHitAudioRef.current, 0.38, 1 + Math.abs(clampedOffset) * 0.15)
        }

        let hitCount = 0
        for (const brick of state.bricks) {
          if (!brick.alive) {
            continue
          }

          const collision = rectIntersectsBall(
            brick.x,
            brick.y,
            brick.width,
            brick.height,
            ball.x,
            ball.y,
            BALL_RADIUS,
          )

          if (!collision.hit) {
            continue
          }

          // Unbreakable bricks just reflect the ball
          if (brick.unbreakable) {
            if (hitCount === 0) {
              reflectBall(ball, collision.normalX, collision.normalY)
              ensureMinVerticalComponent(ball)
            }
            hitCount += 1
            playSfx(tapHitAudioRef.current, 0.2, 0.7)
            continue
          }

          brick.alive = false
          state.consecutiveHits += 1
          state.totalBricksDestroyed += 1
          bricksDestroyedRef.current += 1

          // Consecutive hit bonus
          const hitBonus = state.consecutiveHits > 1 ? CONSECUTIVE_HIT_BONUS * (state.consecutiveHits - 1) : 0
          state.score += brick.points + hitBonus
          hitCount += 1
          spawnParticles(state, brick.x + brick.width / 2, brick.y + brick.height / 2, brick.color)

          // Visual effects for brick hit
          effects.spawnParticles(3, brick.x + brick.width / 2, brick.y + brick.height / 2)
          const totalBrickScore = brick.points + hitBonus
          effects.showScorePopup(totalBrickScore, brick.x + brick.width / 2, brick.y + brick.height / 2, brick.color)

          // Multi-ball: spawn extra ball every N bricks destroyed
          if (
            state.totalBricksDestroyed % MULTI_BALL_BRICK_THRESHOLD === 0 &&
            state.extraBalls.length < MAX_EXTRA_BALLS
          ) {
            const extraBall = createBall(state.paddleX)
            launchBall(extraBall)
            extraBall.speed = ball.speed
            state.extraBalls.push(extraBall)
            state.multiBallsSpawned += 1
            effects.triggerFlash('rgba(251,191,36,0.3)', 80)
          }

          if (hitCount === 1) {
            reflectBall(ball, collision.normalX, collision.normalY)
            ensureMinVerticalComponent(ball)
          }
        }

        if (hitCount > 0) {
          const pitchBoost = Math.min(0.3, hitCount * 0.08)
          playSfx(tapHitStrongAudioRef.current, 0.32 + hitCount * 0.06, 1.02 + pitchBoost)
          effects.triggerShake(2 + hitCount)
          effects.triggerFlash('rgba(255,255,255,0.15)', 50)
        }
      }

      // Stage clear: only count breakable bricks
      const aliveBreakableBricks = state.bricks.filter((b) => b.alive && !b.unbreakable)
      if (aliveBreakableBricks.length === 0) {
        state.extraBalls = [] // Clear extra balls on stage advance
        advanceStage(state)
      }

      // Update extra balls (simplified - move them and remove if off screen)
      for (let i = state.extraBalls.length - 1; i >= 0; i -= 1) {
        const eb = state.extraBalls[i]
        if (!eb.launched) continue
        eb.x += eb.vx * subDeltaSec
        eb.y += eb.vy * subDeltaSec
        if (eb.x - BALL_RADIUS <= 0) { eb.x = BALL_RADIUS; eb.vx = Math.abs(eb.vx) }
        if (eb.x + BALL_RADIUS >= VIEWBOX_WIDTH) { eb.x = VIEWBOX_WIDTH - BALL_RADIUS; eb.vx = -Math.abs(eb.vx) }
        if (eb.y - BALL_RADIUS <= 0) { eb.y = BALL_RADIUS; eb.vy = Math.abs(eb.vy) }
        if (eb.y + BALL_RADIUS >= VIEWBOX_HEIGHT + 20) {
          state.extraBalls.splice(i, 1)
          continue
        }
        // Extra ball brick collisions
        for (const brick of state.bricks) {
          if (!brick.alive || brick.unbreakable) continue
          const col = rectIntersectsBall(brick.x, brick.y, brick.width, brick.height, eb.x, eb.y, BALL_RADIUS)
          if (col.hit) {
            brick.alive = false
            state.score += brick.points
            state.totalBricksDestroyed += 1
            bricksDestroyedRef.current += 1
            reflectBall(eb, col.normalX, col.normalY)
            ensureMinVerticalComponent(eb)
            spawnParticles(state, brick.x + brick.width / 2, brick.y + brick.height / 2, brick.color)
            break
          }
        }
      }

      syncRenderState(state)
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
  }, [advanceStage, finishGame, loseBall, playSfx, syncRenderState, updatePaddleFromPointer])

  const displayedBestScore = useMemo(() => Math.max(bestScore, renderScore), [bestScore, renderScore])

  const livesDisplay = useMemo(() => {
    const hearts: string[] = []
    for (let i = 0; i < INITIAL_LIVES; i += 1) {
      hearts.push(i < renderLives ? '#ef4444' : '#374151')
    }
    return hearts
  }, [renderLives])

  return (
    <section className="mini-game-panel breakout-mini-panel" aria-label="breakout-mini-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <img src={parkSangminSprite} alt="박상민" className="breakout-mini-character" style={{ width: '80px', height: '80px', objectFit: 'contain', display: 'block', margin: '0 auto' }} />
      <div className="breakout-mini-hud">
        <div className="breakout-mini-hud-left">
          <p className="breakout-mini-score">{renderScore.toLocaleString()}</p>
          <p className="breakout-mini-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="breakout-mini-hud-center">
          <p className="breakout-mini-stage">STAGE {renderStage}</p>
        </div>
        <div className="breakout-mini-hud-right">
          <div className="breakout-mini-lives">
            {livesDisplay.map((color, index) => (
              <svg key={index} width="16" height="16" viewBox="0 0 24 24">
                <path
                  d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                  fill={color}
                />
              </svg>
            ))}
          </div>
        </div>
      </div>

      <div
        className="breakout-mini-board"
        ref={boardRef}
        role="presentation"
      >
        <svg
          className="breakout-mini-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="breakout-field"
        >
          <g transform={`translate(${renderShakeX.toFixed(2)} ${renderShakeY.toFixed(2)})`}>
            <rect
              className="breakout-mini-bg"
              x="0"
              y="0"
              width={VIEWBOX_WIDTH}
              height={VIEWBOX_HEIGHT}
              fill="#0f172a"
              rx="8"
            />

            <line
              x1="0"
              y1={BRICK_TOP_OFFSET - 6}
              x2={VIEWBOX_WIDTH}
              y2={BRICK_TOP_OFFSET - 6}
              stroke="#1e293b"
              strokeWidth="1"
              strokeDasharray="4 4"
            />

            {renderBricks
              .filter((brick) => brick.alive)
              .map((brick) => (
                <rect
                  key={brick.id}
                  x={brick.x}
                  y={brick.y}
                  width={brick.width}
                  height={brick.height}
                  rx="2"
                  fill={brick.color}
                  className="breakout-mini-brick"
                />
              ))}

            {renderBricks
              .filter((brick) => brick.alive)
              .map((brick) => (
                <g key={`shine-${brick.id}`}>
                  <rect
                    x={brick.x + 2}
                    y={brick.y + 1}
                    width={brick.width - 4}
                    height={3}
                    rx="1"
                    fill={brick.unbreakable ? UNBREAKABLE_SHINE : 'rgba(255,255,255,0.25)'}
                  />
                  {brick.unbreakable && (
                    <line x1={brick.x + 4} y1={brick.y + 4} x2={brick.x + brick.width - 4} y2={brick.y + brick.height - 4} stroke="rgba(255,255,255,0.15)" strokeWidth="1" />
                  )}
                </g>
              ))}

            <rect
              className="breakout-mini-paddle"
              x={renderPaddleX - PADDLE_WIDTH / 2}
              y={PADDLE_Y}
              width={PADDLE_WIDTH}
              height={PADDLE_HEIGHT}
              rx={PADDLE_CORNER_RADIUS}
              fill="#e2e8f0"
            />
            <rect
              x={renderPaddleX - PADDLE_WIDTH / 2 + 4}
              y={PADDLE_Y + 2}
              width={PADDLE_WIDTH - 8}
              height={3}
              rx="1.5"
              fill="rgba(255,255,255,0.35)"
            />

            <circle
              className="breakout-mini-ball-glow"
              cx={renderBallX}
              cy={renderBallY}
              r={BALL_RADIUS + 4}
              fill="rgba(251,191,36,0.18)"
            />
            <circle
              className="breakout-mini-ball"
              cx={renderBallX}
              cy={renderBallY}
              r={BALL_RADIUS}
              fill="#fbbf24"
            />
            <circle
              cx={renderBallX - 1.5}
              cy={renderBallY - 1.5}
              r={2}
              fill="rgba(255,255,255,0.6)"
            />

            {/* Extra balls */}
            {stateRef.current.extraBalls.map((eb, i) => (
              <g key={`extra-ball-${i}`}>
                <circle cx={eb.x} cy={eb.y} r={BALL_RADIUS + 3} fill="rgba(168,85,247,0.2)" />
                <circle cx={eb.x} cy={eb.y} r={BALL_RADIUS} fill="#a855f7" />
                <circle cx={eb.x - 1.5} cy={eb.y - 1.5} r={2} fill="rgba(255,255,255,0.6)" />
              </g>
            ))}

            {renderParticles.map((particle) => {
              const age = stateRef.current.elapsedMs - particle.createdAtMs
              const progress = clampNumber(age / PARTICLE_LIFETIME_MS, 0, 1)
              const opacity = 1 - progress
              const size = 3 * (1 - progress * 0.6)
              return (
                <circle
                  key={particle.id}
                  cx={particle.x}
                  cy={particle.y}
                  r={size}
                  fill={particle.color}
                  opacity={opacity}
                />
              )
            })}

            <line
              x1="0"
              y1={VIEWBOX_HEIGHT - 2}
              x2={VIEWBOX_WIDTH}
              y2={VIEWBOX_HEIGHT - 2}
              stroke="#ef4444"
              strokeWidth="2"
              opacity="0.3"
            />

            {[0, VIEWBOX_WIDTH].map((wallX) => (
              <line
                key={`wall-${wallX}`}
                x1={wallX}
                y1="0"
                x2={wallX}
                y2={VIEWBOX_HEIGHT}
                stroke="#334155"
                strokeWidth="2"
              />
            ))}
            <line x1="0" y1="0" x2={VIEWBOX_WIDTH} y2="0" stroke="#334155" strokeWidth="2" />
          </g>
        </svg>
      </div>

      <div className="breakout-mini-footer">
        <button className="text-button" type="button" onClick={onExit}>
          허브로 돌아가기
        </button>
      </div>
    </section>
  )
}

export const breakoutMiniModule: MiniGameModule = {
  manifest: {
    id: 'breakout-mini',
    title: 'Breakout',
    description: '패들로 공을 튕겨 벽돌을 모두 깨뜨려라!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#ef4444',
  },
  Component: BreakoutMiniGame,
}
