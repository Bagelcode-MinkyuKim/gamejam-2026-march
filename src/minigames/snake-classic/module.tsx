import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import songChangsikSprite from '../../../assets/images/same-character/song-changsik.png'

const GRID_SIZE = 16
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const INITIAL_SNAKE_LENGTH = 3
const INITIAL_MOVE_INTERVAL_MS = 200
const MIN_MOVE_INTERVAL_MS = 80
const SPEED_INCREASE_THRESHOLD = 50
const SPEED_DECREASE_MS = 12
const SCORE_PER_APPLE = 10

// Golden apple: appears every N apples, worth 5x
const GOLDEN_APPLE_INTERVAL = 10
const GOLDEN_APPLE_SCORE = 50

// Wall-wrap mode: at high score, walls become passable
const WALL_WRAP_SCORE_THRESHOLD = 100

type Direction = 'up' | 'down' | 'left' | 'right'

interface Position {
  readonly x: number
  readonly y: number
}

function positionsEqual(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

function positionToIndex(position: Position): number {
  return position.y * GRID_SIZE + position.x
}

function isOutOfBounds(position: Position): boolean {
  return position.x < 0 || position.x >= GRID_SIZE || position.y < 0 || position.y >= GRID_SIZE
}

function movePosition(position: Position, direction: Direction): Position {
  switch (direction) {
    case 'up':
      return { x: position.x, y: position.y - 1 }
    case 'down':
      return { x: position.x, y: position.y + 1 }
    case 'left':
      return { x: position.x - 1, y: position.y }
    case 'right':
      return { x: position.x + 1, y: position.y }
  }
}

function isOppositeDirection(a: Direction, b: Direction): boolean {
  return (
    (a === 'up' && b === 'down') ||
    (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') ||
    (a === 'right' && b === 'left')
  )
}

function createInitialSnake(): Position[] {
  const centerX = Math.floor(GRID_SIZE / 2)
  const centerY = Math.floor(GRID_SIZE / 2)
  const snake: Position[] = []
  for (let i = 0; i < INITIAL_SNAKE_LENGTH; i += 1) {
    snake.push({ x: centerX, y: centerY + i })
  }
  return snake
}

function spawnApple(snake: Position[]): Position {
  const occupied = new Set(snake.map(positionToIndex))
  const freeCells: Position[] = []
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!occupied.has(positionToIndex({ x, y }))) {
        freeCells.push({ x, y })
      }
    }
  }

  if (freeCells.length === 0) {
    return { x: 0, y: 0 }
  }

  return freeCells[Math.floor(Math.random() * freeCells.length)]
}

function computeMoveInterval(score: number): number {
  const speedLevel = Math.floor(score / SPEED_INCREASE_THRESHOLD)
  return Math.max(MIN_MOVE_INTERVAL_MS, INITIAL_MOVE_INTERVAL_MS - speedLevel * SPEED_DECREASE_MS)
}

function computeSpeedLevel(score: number): number {
  return Math.floor(score / SPEED_INCREASE_THRESHOLD) + 1
}

function SnakeClassicGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [snake, setSnake] = useState<Position[]>(() => createInitialSnake())
  const [apple, setApple] = useState<Position>(() => spawnApple(createInitialSnake()))
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [isGoldenApple, setIsGoldenApple] = useState(false)
  const [isWallWrap, setIsWallWrap] = useState(false)

  const effects = useGameEffects()
  const applesEatenRef = useRef(0)
  const isGoldenAppleRef = useRef(false)

  const snakeRef = useRef<Position[]>(snake)
  const appleRef = useRef<Position>(apple)
  const directionRef = useRef<Direction>('up')
  const nextDirectionRef = useRef<Direction>('up')
  const scoreRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const gameOverRef = useRef(false)
  const finishedRef = useRef(false)
  const moveAccumulatorRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)

  const eatAudioRef = useRef<HTMLAudioElement | null>(null)
  const turnAudioRef = useRef<HTMLAudioElement | null>(null)
  const crashAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) {
      return
    }

    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    effects.cleanup()
    const finalDurationMs = elapsedMsRef.current > 0 ? Math.round(elapsedMsRef.current) : Math.round(DEFAULT_FRAME_MS)
    onFinish({
      score: scoreRef.current,
      durationMs: finalDurationMs,
    })
  }, [onFinish])

  const changeDirection = useCallback(
    (newDirection: Direction) => {
      if (gameOverRef.current) {
        return
      }

      if (isOppositeDirection(directionRef.current, newDirection)) {
        return
      }

      if (nextDirectionRef.current !== newDirection) {
        nextDirectionRef.current = newDirection
        playSfx(turnAudioRef.current, 0.3, 1.1)
      }
    },
    [playSfx],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }

      if (gameOverRef.current) {
        return
      }

      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          event.preventDefault()
          changeDirection('up')
          break
        case 'ArrowDown':
        case 'KeyS':
          event.preventDefault()
          changeDirection('down')
          break
        case 'ArrowLeft':
        case 'KeyA':
          event.preventDefault()
          changeDirection('left')
          break
        case 'ArrowRight':
        case 'KeyD':
          event.preventDefault()
          changeDirection('right')
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [changeDirection, onExit])

  useEffect(() => {
    const eatAudio = new Audio(tapHitStrongSfx)
    eatAudio.preload = 'auto'
    eatAudioRef.current = eatAudio

    const turnAudio = new Audio(tapHitSfx)
    turnAudio.preload = 'auto'
    turnAudioRef.current = turnAudio

    const crashAudio = new Audio(gameOverHitSfx)
    crashAudio.preload = 'auto'
    crashAudioRef.current = crashAudio

    return () => {
      effects.cleanup()
      for (const audio of [eatAudio, turnAudio, crashAudio]) {
        audio.pause()
        audio.currentTime = 0
      }
    }
  }, [])

  useEffect(() => {
    lastFrameAtRef.current = null
    moveAccumulatorRef.current = 0

    const step = (now: number) => {
      if (gameOverRef.current) {
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

      effects.updateParticles()

      const moveInterval = computeMoveInterval(scoreRef.current)
      moveAccumulatorRef.current += deltaMs

      if (moveAccumulatorRef.current >= moveInterval) {
        moveAccumulatorRef.current -= moveInterval

        directionRef.current = nextDirectionRef.current
        const currentSnake = snakeRef.current
        const head = currentSnake[0]
        let newHead = movePosition(head, directionRef.current)

        // Wall-wrap mode at high score
        const wallWrapActive = scoreRef.current >= WALL_WRAP_SCORE_THRESHOLD
        if (wallWrapActive !== (isWallWrap)) {
          setIsWallWrap(wallWrapActive)
        }

        if (isOutOfBounds(newHead)) {
          if (wallWrapActive) {
            // Wrap around walls
            newHead = {
              x: ((newHead.x % GRID_SIZE) + GRID_SIZE) % GRID_SIZE,
              y: ((newHead.y % GRID_SIZE) + GRID_SIZE) % GRID_SIZE,
            }
          } else {
            gameOverRef.current = true
            setGameOver(true)
            playSfx(crashAudioRef.current, 0.6, 0.95)
            effects.triggerShake(8)
            effects.triggerFlash('rgba(239,68,68,0.5)')
            finishGame()
            animationFrameRef.current = null
            return
          }
        }

        const collidesWithBody = currentSnake.some((segment, index) => index > 0 && positionsEqual(newHead, segment))
        if (collidesWithBody) {
          gameOverRef.current = true
          setGameOver(true)
          playSfx(crashAudioRef.current, 0.6, 0.95)
          effects.triggerShake(8)
          effects.triggerFlash('rgba(239,68,68,0.5)')
          finishGame()
          animationFrameRef.current = null
          return
        }

        const ateApple = positionsEqual(newHead, appleRef.current)
        let nextSnake: Position[]

        if (ateApple) {
          nextSnake = [newHead, ...currentSnake]
          applesEatenRef.current += 1

          // Golden apple: every N apples eaten, the NEXT apple is golden
          const wasGolden = isGoldenAppleRef.current
          const appleScore = wasGolden ? GOLDEN_APPLE_SCORE : SCORE_PER_APPLE
          const nextScore = scoreRef.current + appleScore
          scoreRef.current = nextScore
          setScore(nextScore)

          const nextApple = spawnApple(nextSnake)
          appleRef.current = nextApple
          setApple(nextApple)

          // Determine if the next apple is golden
          const nextIsGolden = applesEatenRef.current % GOLDEN_APPLE_INTERVAL === (GOLDEN_APPLE_INTERVAL - 1)
          isGoldenAppleRef.current = nextIsGolden
          setIsGoldenApple(nextIsGolden)

          const pitchBoost = Math.min(0.4, nextScore * 0.002)
          playSfx(eatAudioRef.current, wasGolden ? 0.7 : 0.5, wasGolden ? 1.3 : 1 + pitchBoost)

          // Visual effects for eating apple
          const effectX = newHead.x * 20 + 10
          const effectY = newHead.y * 20 + 10
          effects.comboHitBurst(effectX, effectY, applesEatenRef.current, appleScore)

          if (nextSnake.length >= CELL_COUNT) {
            gameOverRef.current = true
            setGameOver(true)
            finishGame()
            animationFrameRef.current = null
            return
          }
        } else {
          nextSnake = [newHead, ...currentSnake.slice(0, -1)]
        }

        snakeRef.current = nextSnake
        setSnake(nextSnake)
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
  }, [finishGame, playSfx])

  const snakeSet = new Set(snake.map(positionToIndex))
  const headIndex = positionToIndex(snake[0])
  const appleIndex = positionToIndex(apple)
  const displayedBestScore = Math.max(bestScore, score)
  const speedLevel = computeSpeedLevel(score)
  const moveInterval = computeMoveInterval(score)

  const comboLabel = getComboLabel(applesEatenRef.current)
  const comboColor = getComboColor(applesEatenRef.current)

  const cells = []
  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      const index = positionToIndex({ x, y })
      let cellClass = 'snake-classic-cell'

      if (index === headIndex) {
        cellClass += ' snake-classic-head'
      } else if (snakeSet.has(index)) {
        cellClass += ' snake-classic-body'
      } else if (index === appleIndex) {
        cellClass += isGoldenApple ? ' snake-classic-golden-apple' : ' snake-classic-apple'
      }

      cells.push(<div key={index} className={cellClass} />)
    }
  }

  const swipeTouchIdRef = useRef<number | null>(null)
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleTouchStart = useCallback((event: React.TouchEvent) => {
    if (event.touches.length > 0) {
      const touch = event.touches[0]
      swipeTouchIdRef.current = touch.identifier
      swipeStartRef.current = { x: touch.clientX, y: touch.clientY }
    }
  }, [])

  const handleTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      if (swipeStartRef.current === null || swipeTouchIdRef.current === null) {
        return
      }

      let touch: React.Touch | null = null
      for (let i = 0; i < event.changedTouches.length; i += 1) {
        if (event.changedTouches[i].identifier === swipeTouchIdRef.current) {
          touch = event.changedTouches[i]
          break
        }
      }

      if (touch === null) {
        return
      }

      const dx = touch.clientX - swipeStartRef.current.x
      const dy = touch.clientY - swipeStartRef.current.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      const SWIPE_THRESHOLD = 20

      if (absDx < SWIPE_THRESHOLD && absDy < SWIPE_THRESHOLD) {
        swipeTouchIdRef.current = null
        swipeStartRef.current = null
        return
      }

      if (absDx > absDy) {
        changeDirection(dx > 0 ? 'right' : 'left')
      } else {
        changeDirection(dy > 0 ? 'down' : 'up')
      }

      swipeTouchIdRef.current = null
      swipeStartRef.current = null
    },
    [changeDirection],
  )

  return (
    <section className="mini-game-panel snake-classic-panel" aria-label="snake-classic-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}

        .snake-classic-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 12px 8px;
          width: 100%;
          max-width: 420px;
          margin: 0 auto;
          user-select: none;
          -webkit-user-select: none;
        }

        .snake-classic-hud {
          text-align: center;
          width: 100%;
        }

        .snake-classic-character {
          width: 80px;
          height: 80px;
          object-fit: contain;
          border-radius: 50%;
          border: 2px solid #22c55e;
          margin-bottom: 4px;
        }

        .snake-classic-score {
          font-size: 2.4rem;
          font-weight: 800;
          color: #22c55e;
          margin: 0;
          line-height: 1.1;
        }

        .snake-classic-best {
          font-size: 0.85rem;
          color: #a1a1aa;
          margin: 2px 0 0;
        }

        .snake-classic-meta {
          font-size: 0.75rem;
          color: #71717a;
          margin: 2px 0 0;
        }

        .snake-classic-grid-wrapper {
          position: relative;
          width: 100%;
          max-width: 320px;
          aspect-ratio: 1 / 1;
          touch-action: none;
        }

        .snake-classic-grid {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          grid-template-rows: repeat(${GRID_SIZE}, 1fr);
          width: 100%;
          height: 100%;
          background: #0a0a0a;
          border: 2px solid #27272a;
          border-radius: 6px;
          overflow: hidden;
          gap: 1px;
        }

        .snake-classic-cell {
          background: #18181b;
          border-radius: 1px;
        }

        .snake-classic-body {
          background: #22c55e;
          border-radius: 2px;
          box-shadow: inset 0 0 2px rgba(0, 0, 0, 0.3);
        }

        .snake-classic-head {
          background: #15803d;
          border-radius: 3px;
          box-shadow: inset 0 0 4px rgba(0, 0, 0, 0.4), 0 0 6px rgba(34, 197, 94, 0.5);
        }

        .snake-classic-apple {
          background: #ef4444;
          border-radius: 50%;
          box-shadow: 0 0 6px rgba(239, 68, 68, 0.6);
          animation: snake-classic-apple-pulse 0.8s ease-in-out infinite alternate;
        }

        .snake-classic-golden-apple {
          background: #fbbf24;
          border-radius: 50%;
          box-shadow: 0 0 10px rgba(251, 191, 36, 0.8), 0 0 20px rgba(251, 191, 36, 0.4);
          animation: snake-classic-golden-pulse 0.4s ease-in-out infinite alternate;
        }

        @keyframes snake-classic-apple-pulse {
          from {
            transform: scale(0.85);
            opacity: 0.85;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }

        @keyframes snake-classic-golden-pulse {
          from {
            transform: scale(0.9);
            box-shadow: 0 0 10px rgba(251, 191, 36, 0.8);
          }
          to {
            transform: scale(1.1);
            box-shadow: 0 0 20px rgba(251, 191, 36, 1);
          }
        }

        .snake-classic-game-over .snake-classic-grid {
          opacity: 0.5;
        }

        .snake-classic-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 2rem;
          font-weight: 900;
          color: #ef4444;
          text-shadow: 0 2px 8px rgba(0, 0, 0, 0.6);
          pointer-events: none;
        }

        .snake-classic-dpad {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          margin-top: 4px;
        }

        .snake-classic-dpad-row {
          display: flex;
          align-items: center;
          gap: 2px;
        }

        .snake-classic-dpad-btn {
          width: 52px;
          height: 52px;
          border: none;
          border-radius: 8px;
          background: #27272a;
          color: #e4e4e7;
          font-size: 1.2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.1s;
          -webkit-tap-highlight-color: transparent;
        }

        .snake-classic-dpad-btn:active {
          background: #22c55e;
          color: #000;
        }

        .snake-classic-dpad-center {
          width: 52px;
          height: 52px;
          background: transparent;
        }

        .snake-classic-dpad-arrow {
          pointer-events: none;
        }

        .snake-classic-actions {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }

        .snake-classic-action-button {
          padding: 6px 18px;
          border: none;
          border-radius: 6px;
          background: #22c55e;
          color: #000;
          font-weight: 700;
          font-size: 0.85rem;
          cursor: pointer;
          transition: opacity 0.15s;
        }

        .snake-classic-action-button:active {
          opacity: 0.7;
        }

        .snake-classic-action-button.ghost {
          background: transparent;
          color: #a1a1aa;
          border: 1px solid #3f3f46;
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="snake-classic-hud">
        <img src={songChangsikSprite} alt="송창식" className="snake-classic-character" />
        <p className="snake-classic-score">{score}</p>
        <p className="snake-classic-best">BEST {displayedBestScore}</p>
        {comboLabel && (
          <p className="ge-combo-label" style={{ fontSize: '14px', color: comboColor, margin: '2px 0' }}>
            {comboLabel}
          </p>
        )}
        <p className="snake-classic-meta">
          Lv.{speedLevel} ({moveInterval}ms) | {snake.length}칸 | {(elapsedMs / 1000).toFixed(1)}s
          {isWallWrap && <span style={{ color: '#a855f7', marginLeft: '6px' }}>WALL WRAP</span>}
        </p>
        {isGoldenApple && (
          <p style={{ textAlign: 'center', fontSize: '13px', fontWeight: 800, color: '#fbbf24', margin: '2px 0', animation: 'snake-classic-golden-pulse 0.4s ease-in-out infinite alternate' }}>
            GOLDEN APPLE! +{GOLDEN_APPLE_SCORE}pts
          </p>
        )}
      </div>

      <div
        className={`snake-classic-grid-wrapper ${gameOver ? 'snake-classic-game-over' : ''}`}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        role="presentation"
      >
        <div className="snake-classic-grid">
          {cells}
        </div>
        {gameOver && <div className="snake-classic-overlay">GAME OVER</div>}
      </div>

      <div className="snake-classic-dpad">
        <div className="snake-classic-dpad-row">
          <button className="snake-classic-dpad-btn" type="button" onClick={() => changeDirection('up')} aria-label="up">
            <span className="snake-classic-dpad-arrow">&#9650;</span>
          </button>
        </div>
        <div className="snake-classic-dpad-row">
          <button className="snake-classic-dpad-btn" type="button" onClick={() => changeDirection('left')} aria-label="left">
            <span className="snake-classic-dpad-arrow">&#9664;</span>
          </button>
          <div className="snake-classic-dpad-center" />
          <button className="snake-classic-dpad-btn" type="button" onClick={() => changeDirection('right')} aria-label="right">
            <span className="snake-classic-dpad-arrow">&#9654;</span>
          </button>
        </div>
        <div className="snake-classic-dpad-row">
          <button className="snake-classic-dpad-btn" type="button" onClick={() => changeDirection('down')} aria-label="down">
            <span className="snake-classic-dpad-arrow">&#9660;</span>
          </button>
        </div>
      </div>

      <div className="snake-classic-actions">
        <button
          className="snake-classic-action-button"
          type="button"
          onClick={() => {
            if (!gameOverRef.current) {
              gameOverRef.current = true
              setGameOver(true)
              playSfx(crashAudioRef.current, 0.5, 1)
              effects.triggerShake(6)
              finishGame()
            }
          }}
        >
          종료
        </button>
        <button className="snake-classic-action-button ghost" type="button" onClick={onExit}>
          나가기
        </button>
      </div>
    </section>
  )
}

export const snakeClassicModule: MiniGameModule = {
  manifest: {
    id: 'snake-classic',
    title: 'Snake Classic',
    description: '클래식 스네이크! 사과를 먹고 길어져라, 벽과 꼬리를 조심!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#22c55e',
  },
  Component: SnakeClassicGame,
}
