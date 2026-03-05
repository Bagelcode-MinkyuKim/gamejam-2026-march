import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const STAGE_WIDTH = 360
const STAGE_HEIGHT = 480
const GROUND_HEIGHT = 40
const CEILING_HEIGHT = 40
const PLAY_AREA_TOP = CEILING_HEIGHT
const PLAY_AREA_BOTTOM = STAGE_HEIGHT - GROUND_HEIGHT

const PLAYER_X = 70
const PLAYER_WIDTH = 48
const PLAYER_HEIGHT = 48
const PLAYER_COLLIDER_WIDTH = 28
const PLAYER_COLLIDER_HEIGHT = 38

const GRAVITY_STRENGTH = 1800
const MAX_FALL_SPEED = 680
const FLIP_IMPULSE = 420

const BASE_SCROLL_SPEED = 180
const MAX_SCROLL_SPEED = 380
const SPEED_ACCEL_PER_SECOND = 8

const OBSTACLE_WIDTH = 40
const OBSTACLE_MIN_HEIGHT = 80
const OBSTACLE_MAX_HEIGHT = 200
const OBSTACLE_SPAWN_INTERVAL_MIN_MS = 900
const OBSTACLE_SPAWN_INTERVAL_MAX_MS = 1800
const OBSTACLE_SPAWN_INTERVAL_FLOOR_MS = 600

const COIN_SIZE = 24
const COIN_COLLIDER_RADIUS = 14
const COIN_SPAWN_CHANCE = 0.55
const COIN_SCORE_BONUS = 50

const MAGNET_SIZE = 20
const MAGNET_SPAWN_CHANCE = 0.12
const MAGNET_DURATION_MS = 5000
const MAGNET_ATTRACT_RADIUS = 120
const MAGNET_ATTRACT_SPEED = 300

const COIN_COMBO_DECAY_MS = 2000
const COIN_COMBO_MULTIPLIER_CAP = 5

const DISTANCE_MILESTONE = 2000
const MILESTONE_BONUS = 100

const SCORE_DISTANCE_MULTIPLIER = 0.12
const GAME_TIMEOUT_MS = 120000

interface Obstacle {
  readonly id: number
  readonly x: number
  readonly height: number
  readonly fromTop: boolean
}

interface Coin {
  readonly id: number
  x: number
  y: number
  collected: boolean
}

interface MagnetPowerup {
  readonly id: number
  x: number
  readonly y: number
  collected: boolean
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
  magnets: MagnetPowerup[]
  nextObstacleId: number
  nextCoinId: number
  nextMagnetId: number
  timeSinceLastObstacle: number
  nextObstacleInterval: number
  magnetActiveMs: number
  coinCombo: number
  lastCoinCollectMs: number
  lastMilestone: number
  statusText: string
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function createInitialModel(): GameModel {
  const startY = PLAY_AREA_BOTTOM - PLAYER_HEIGHT / 2 - 10
  return {
    playerY: startY,
    playerVy: 0,
    gravityDirection: 1,
    scrollSpeed: BASE_SCROLL_SPEED,
    elapsedMs: 0,
    distanceTraveled: 0,
    score: 0,
    coinsCollected: 0,
    obstacles: [],
    coins: [],
    magnets: [],
    nextObstacleId: 0,
    nextCoinId: 0,
    nextMagnetId: 0,
    timeSinceLastObstacle: 0,
    nextObstacleInterval: 1200,
    magnetActiveMs: 0,
    coinCombo: 0,
    lastCoinCollectMs: 0,
    lastMilestone: 0,
    statusText: '탭하여 중력을 반전시키세요!',
  }
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

function circleRectOverlap(
  cx: number, cy: number, cr: number,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  const nearestX = clampNumber(cx, rx, rx + rw)
  const nearestY = clampNumber(cy, ry, ry + rh)
  const dx = cx - nearestX
  const dy = cy - nearestY
  return dx * dx + dy * dy <= cr * cr
}

function computeObstacleInterval(elapsedMs: number): number {
  const progress = clampNumber(elapsedMs / 60000, 0, 1)
  const intervalRange = OBSTACLE_SPAWN_INTERVAL_MAX_MS - OBSTACLE_SPAWN_INTERVAL_FLOOR_MS
  return Math.max(
    OBSTACLE_SPAWN_INTERVAL_FLOOR_MS,
    OBSTACLE_SPAWN_INTERVAL_MIN_MS - progress * intervalRange * 0.4 + randomBetween(-100, 100),
  )
}

function GravityFlipGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [renderModel, setRenderModel] = useState<GameModel>(() => createInitialModel())

  const modelRef = useRef<GameModel>(renderModel)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const flipQueuedRef = useRef(false)

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
    const model = modelRef.current
    model.statusText = '장애물에 부딪혔습니다!'
    playSfx(gameOverAudioRef.current, 0.62, 0.95)

    const finalDurationMs = model.elapsedMs > 0 ? Math.round(model.elapsedMs) : Math.round(DEFAULT_FRAME_MS)
    onFinish({
      score: model.score,
      durationMs: finalDurationMs,
    })
  }, [onFinish, playSfx])

  const handleFlip = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    flipQueuedRef.current = true
  }, [])

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

      if (finishedRef.current) {
        return
      }

      if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'ArrowDown') {
        event.preventDefault()
        handleFlip()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleFlip, onExit])

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
      const model = modelRef.current

      model.elapsedMs += deltaMs

      if (model.elapsedMs >= GAME_TIMEOUT_MS) {
        model.statusText = '시간 초과!'
        model.score = computeScore(model)
        setRenderModel({ ...model })
        finishRound()
        animationFrameRef.current = null
        return
      }

      const elapsedSeconds = model.elapsedMs / 1000
      model.scrollSpeed = Math.min(MAX_SCROLL_SPEED, BASE_SCROLL_SPEED + elapsedSeconds * SPEED_ACCEL_PER_SECOND)

      const scrollDistance = model.scrollSpeed * deltaSec
      model.distanceTraveled += scrollDistance

      if (flipQueuedRef.current) {
        flipQueuedRef.current = false
        model.gravityDirection = model.gravityDirection === 1 ? -1 : 1
        model.playerVy = -model.gravityDirection * FLIP_IMPULSE
        model.statusText = model.gravityDirection === 1 ? '중력: 아래' : '중력: 위'
        playSfx(tapAudioRef.current, 0.45, 1 + Math.random() * 0.1)
      }

      model.playerVy += model.gravityDirection * GRAVITY_STRENGTH * deltaSec
      model.playerVy = clampNumber(model.playerVy, -MAX_FALL_SPEED, MAX_FALL_SPEED)
      model.playerY += model.playerVy * deltaSec

      const playerTop = PLAY_AREA_TOP + PLAYER_HEIGHT / 2
      const playerBottom = PLAY_AREA_BOTTOM - PLAYER_HEIGHT / 2
      if (model.playerY < playerTop) {
        model.playerY = playerTop
        model.playerVy = 0
      }
      if (model.playerY > playerBottom) {
        model.playerY = playerBottom
        model.playerVy = 0
      }

      model.timeSinceLastObstacle += deltaMs
      if (model.timeSinceLastObstacle >= model.nextObstacleInterval) {
        model.timeSinceLastObstacle = 0
        model.nextObstacleInterval = computeObstacleInterval(model.elapsedMs)

        const fromTop = Math.random() < 0.5
        const progress = clampNumber(model.elapsedMs / 45000, 0, 1)
        const minH = OBSTACLE_MIN_HEIGHT + progress * 30
        const maxH = OBSTACLE_MAX_HEIGHT + progress * 40
        const obstacleHeight = randomBetween(minH, Math.min(maxH, PLAY_AREA_BOTTOM - PLAY_AREA_TOP - PLAYER_HEIGHT - 20))

        model.obstacles = [
          ...model.obstacles,
          {
            id: model.nextObstacleId,
            x: STAGE_WIDTH + 10,
            height: obstacleHeight,
            fromTop,
          },
        ]
        model.nextObstacleId += 1

        if (Math.random() < COIN_SPAWN_CHANCE) {
          const coinY = fromTop
            ? PLAY_AREA_TOP + obstacleHeight + randomBetween(30, 80)
            : PLAY_AREA_BOTTOM - obstacleHeight - randomBetween(30, 80)
          const clampedCoinY = clampNumber(coinY, PLAY_AREA_TOP + COIN_SIZE, PLAY_AREA_BOTTOM - COIN_SIZE)
          model.coins = [
            ...model.coins,
            {
              id: model.nextCoinId,
              x: STAGE_WIDTH + 10 + OBSTACLE_WIDTH / 2,
              y: clampedCoinY,
              collected: false,
            },
          ]
          model.nextCoinId += 1
        }

        // Spawn magnet powerup
        if (Math.random() < MAGNET_SPAWN_CHANCE) {
          const magnetY = randomBetween(PLAY_AREA_TOP + 40, PLAY_AREA_BOTTOM - 40)
          model.magnets = [
            ...model.magnets,
            {
              id: model.nextMagnetId,
              x: STAGE_WIDTH + 10 + OBSTACLE_WIDTH + 30,
              y: magnetY,
              collected: false,
            },
          ]
          model.nextMagnetId += 1
        }
      }

      model.obstacles = model.obstacles
        .map((obstacle) => ({ ...obstacle, x: obstacle.x - scrollDistance }))
        .filter((obstacle) => obstacle.x + OBSTACLE_WIDTH > -20)

      model.coins = model.coins
        .map((coin) => ({ ...coin, x: coin.x - scrollDistance }))
        .filter((coin) => coin.x + COIN_SIZE > -20)

      model.magnets = model.magnets
        .map((m) => ({ ...m, x: m.x - scrollDistance }))
        .filter((m) => m.x + MAGNET_SIZE > -20)

      // Magnet attraction: pull coins toward player
      if (model.magnetActiveMs > 0) {
        model.magnetActiveMs = Math.max(0, model.magnetActiveMs - deltaMs)
        for (const coin of model.coins) {
          if (coin.collected) continue
          const dx = PLAYER_X - coin.x
          const dy = model.playerY - coin.y
          const dist = Math.hypot(dx, dy)
          if (dist < MAGNET_ATTRACT_RADIUS && dist > 1) {
            coin.x += (dx / dist) * MAGNET_ATTRACT_SPEED * deltaSec
            coin.y += (dy / dist) * MAGNET_ATTRACT_SPEED * deltaSec
          }
        }
      }

      // Coin combo decay
      if (model.elapsedMs - model.lastCoinCollectMs > COIN_COMBO_DECAY_MS) {
        model.coinCombo = 0
      }

      const playerColliderX = PLAYER_X - PLAYER_COLLIDER_WIDTH / 2
      const playerColliderY = model.playerY - PLAYER_COLLIDER_HEIGHT / 2

      for (const obstacle of model.obstacles) {
        const obstacleY = obstacle.fromTop ? PLAY_AREA_TOP : PLAY_AREA_BOTTOM - obstacle.height
        if (
          rectsOverlap(
            playerColliderX, playerColliderY, PLAYER_COLLIDER_WIDTH, PLAYER_COLLIDER_HEIGHT,
            obstacle.x, obstacleY, OBSTACLE_WIDTH, obstacle.height,
          )
        ) {
          model.score = computeScore(model)
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.4)')
          setRenderModel({ ...model })
          finishRound()
          animationFrameRef.current = null
          return
        }
      }

      let didCollectCoin = false
      for (const coin of model.coins) {
        if (coin.collected) {
          continue
        }

        const coinCenterX = coin.x + COIN_SIZE / 2
        const coinCenterY = coin.y
        if (
          circleRectOverlap(
            coinCenterX, coinCenterY, COIN_COLLIDER_RADIUS,
            playerColliderX, playerColliderY, PLAYER_COLLIDER_WIDTH, PLAYER_COLLIDER_HEIGHT,
          )
        ) {
          coin.collected = true
          model.coinCombo = Math.min(model.coinCombo + 1, COIN_COMBO_MULTIPLIER_CAP)
          model.lastCoinCollectMs = model.elapsedMs
          model.coinsCollected += 1
          didCollectCoin = true
        }
      }

      // Magnet powerup collection
      for (const magnet of model.magnets) {
        if (magnet.collected) continue
        const mx = magnet.x + MAGNET_SIZE / 2
        const my = magnet.y
        if (circleRectOverlap(mx, my, MAGNET_SIZE, playerColliderX, playerColliderY, PLAYER_COLLIDER_WIDTH, PLAYER_COLLIDER_HEIGHT)) {
          magnet.collected = true
          model.magnetActiveMs = MAGNET_DURATION_MS
          model.statusText = 'MAGNET ACTIVE!'
        }
      }
      model.magnets = model.magnets.filter((m) => !m.collected)

      if (didCollectCoin) {
        playSfx(tapStrongAudioRef.current, 0.5, 1.15 + model.coinCombo * 0.05)
        effects.triggerFlash()
        effects.spawnParticles(4, 200, 200)
      }

      // Distance milestone bonus
      const currentMilestone = Math.floor(model.distanceTraveled / DISTANCE_MILESTONE)
      if (currentMilestone > model.lastMilestone) {
        model.lastMilestone = currentMilestone
        model.statusText = `MILESTONE ${currentMilestone}! +${MILESTONE_BONUS}`
      }

      model.coins = model.coins.filter((coin) => !coin.collected)
      model.score = computeScore(model)

      setRenderModel({ ...model })
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
  }, [finishRound, playSfx])

  const displayedBestScore = useMemo(() => Math.max(bestScore, renderModel.score), [bestScore, renderModel.score])
  const isGravityUp = renderModel.gravityDirection === -1
  const playerScreenY = renderModel.playerY - PLAYER_HEIGHT / 2

  return (
    <section className="mini-game-panel gravity-flip-panel" aria-label="gravity-flip-game" style={{ position: 'relative', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', ...effects.getShakeStyle() }}>
      <div
        className="gravity-flip-stage"
        onPointerDown={(event) => {
          event.preventDefault()
          handleFlip()
        }}
        role="presentation"
      >
        <div className="gravity-flip-ceiling" />
        <div className="gravity-flip-ground" />

        {renderModel.obstacles.map((obstacle) => {
          const obstacleY = obstacle.fromTop ? PLAY_AREA_TOP : PLAY_AREA_BOTTOM - obstacle.height
          return (
            <div
              className={`gravity-flip-obstacle ${obstacle.fromTop ? 'from-top' : 'from-bottom'}`}
              key={obstacle.id}
              style={{
                left: obstacle.x,
                top: obstacleY,
                width: OBSTACLE_WIDTH,
                height: obstacle.height,
              }}
            />
          )
        })}

        {renderModel.coins.map((coin) => (
          <div
            className="gravity-flip-coin"
            key={coin.id}
            style={{
              left: coin.x,
              top: coin.y - COIN_SIZE / 2,
              width: COIN_SIZE,
              height: COIN_SIZE,
            }}
          />
        ))}

        {renderModel.magnets.map((magnet) => (
          <div
            key={magnet.id}
            style={{
              position: 'absolute',
              left: magnet.x,
              top: magnet.y - MAGNET_SIZE / 2,
              width: MAGNET_SIZE,
              height: MAGNET_SIZE,
              borderRadius: '50%',
              background: 'radial-gradient(circle, #a78bfa, #7c3aed)',
              border: '2px solid #c4b5fd',
              boxShadow: '0 0 8px #a78bfa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              color: '#fff',
              fontWeight: 'bold',
            }}
          >
            M
          </div>
        ))}

        <img
          className="gravity-flip-player"
          src={parkWankyuSprite}
          alt="player"
          style={{
            left: PLAYER_X - PLAYER_WIDTH / 2,
            top: playerScreenY,
            width: PLAYER_WIDTH,
            height: PLAYER_HEIGHT,
            transform: isGravityUp ? 'scaleY(-1)' : 'none',
          }}
        />

        <div className="gravity-flip-hud">
          <p className="gravity-flip-score">{renderModel.score}</p>
          <p className="gravity-flip-best">BEST {displayedBestScore}</p>
          <p className="gravity-flip-meta">
            코인 {renderModel.coinsCollected}{renderModel.coinCombo > 0 ? ` (x${(1 + renderModel.coinCombo * 0.2).toFixed(1)})` : ''} · {(renderModel.elapsedMs / 1000).toFixed(1)}s
          </p>
          {renderModel.magnetActiveMs > 0 && (
            <p style={{ margin: 0, color: '#a78bfa', fontSize: 11, fontWeight: 700 }}>
              MAGNET {(renderModel.magnetActiveMs / 1000).toFixed(1)}s
            </p>
          )}
        </div>

        <p className="gravity-flip-status">{renderModel.statusText}</p>
        <p className="gravity-flip-tap-hint">탭하여 중력 반전</p>

        <div className="gravity-flip-overlay-actions">
          <button
            className="gravity-flip-action-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (!finishedRef.current) {
                finishedRef.current = true
                const model = modelRef.current
                model.score = computeScore(model)
                onFinish({
                  score: model.score,
                  durationMs: Math.max(Math.round(model.elapsedMs), Math.round(DEFAULT_FRAME_MS)),
                })
              }
            }}
          >
            종료
          </button>
          <button
            className="gravity-flip-action-button ghost"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
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

function computeScore(model: GameModel): number {
  const distanceScore = Math.max(0, Math.floor(model.distanceTraveled * SCORE_DISTANCE_MULTIPLIER))
  const comboMultiplier = 1 + model.coinCombo * 0.2
  const coinScore = Math.floor(model.coinsCollected * COIN_SCORE_BONUS * comboMultiplier)
  const milestoneScore = model.lastMilestone * MILESTONE_BONUS
  return distanceScore + coinScore + milestoneScore
}

export const gravityFlipModule: MiniGameModule = {
  manifest: {
    id: 'gravity-flip',
    title: 'Gravity Flip',
    description: '중력을 반전시켜 장애물을 피하라! 천장과 바닥을 오가는 러너!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#7c3aed',
  },
  Component: GravityFlipGame,
}
