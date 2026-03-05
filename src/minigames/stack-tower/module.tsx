import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const BOARD_WIDTH = 320
const BOARD_HEIGHT = 520
const INITIAL_BLOCK_WIDTH = 120
const BLOCK_HEIGHT = 28
const MIN_BLOCK_WIDTH = 12
const PERFECT_THRESHOLD = 3
const PERFECT_BONUS = 5
const PERFECT_GROW = 4
const INITIAL_SPEED = 120
const SPEED_INCREMENT = 6
const MAX_SPEED = 480
const GOLDEN_BLOCK_INTERVAL = 10
const GOLDEN_BLOCK_BONUS = 20
const FEVER_PERFECT_THRESHOLD = 5
const FEVER_SCORE_MULTIPLIER = 3
const COMBO_BASE = 1
const BASE_Y_OFFSET = BOARD_HEIGHT - BLOCK_HEIGHT
const VISIBLE_STACK_COUNT = 16
const CAMERA_LERP = 0.12

const COLOR_PALETTE = [
  '#f97316',
  '#fb923c',
  '#f59e0b',
  '#eab308',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#ef4444',
] as const

interface StackBlock {
  readonly x: number
  readonly width: number
  readonly colorIndex: number
}

interface MovingBlock {
  x: number
  width: number
  direction: 1 | -1
  speed: number
  colorIndex: number
}

function blockColor(colorIndex: number): string {
  return COLOR_PALETTE[colorIndex % COLOR_PALETTE.length]
}

function StackTowerGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()

  const [stack, setStack] = useState<StackBlock[]>(() => [
    { x: (BOARD_WIDTH - INITIAL_BLOCK_WIDTH) / 2, width: INITIAL_BLOCK_WIDTH, colorIndex: 0 },
  ])
  const [moving, setMoving] = useState<MovingBlock | null>(null)
  const [score, setScore] = useState(0)
  const [perfectCount, setPerfectCount] = useState(0)
  const [consecutivePerfects, setConsecutivePerfects] = useState(0)
  const [cameraY, setCameraY] = useState(0)
  const [perfectFlash, setPerfectFlash] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [cutPiece, setCutPiece] = useState<{ x: number; width: number; colorIndex: number; side: 'left' | 'right' } | null>(null)
  const [cutPieceOpacity, setCutPieceOpacity] = useState(1)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [isGoldenBlock, setIsGoldenBlock] = useState(false)

  const stackRef = useRef<StackBlock[]>(stack)
  const movingRef = useRef<MovingBlock | null>(null)
  const scoreRef = useRef(0)
  const perfectCountRef = useRef(0)
  const consecutivePerfectsRef = useRef(0)
  const comboRef = useRef(0)
  const cameraYRef = useRef(0)
  const targetCameraYRef = useRef(0)
  const finishedRef = useRef(false)
  const gameOverRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const perfectFlashTimerRef = useRef<number | null>(null)
  const cutPieceTimerRef = useRef<number | null>(null)

  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
    const audio = audioRef.current
    if (audio === null) {
      return
    }

    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const spawnMovingBlock = useCallback((topBlock: StackBlock, stackHeight: number) => {
    const nextColorIndex = (topBlock.colorIndex + 1) % COLOR_PALETTE.length
    const speed = Math.min(MAX_SPEED, INITIAL_SPEED + stackHeight * SPEED_INCREMENT)
    const direction: 1 | -1 = stackHeight % 2 === 0 ? 1 : -1
    const startX = direction === 1 ? -topBlock.width : BOARD_WIDTH
    const newMoving: MovingBlock = {
      x: startX,
      width: topBlock.width,
      direction,
      speed,
      colorIndex: nextColorIndex,
    }
    movingRef.current = newMoving
    setMoving(newMoving)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    gameOverRef.current = true
    setGameOver(true)
    movingRef.current = null
    setMoving(null)
    playSfx(gameOverAudioRef, 0.64, 0.95)
    effects.triggerShake(6)
    effects.triggerFlash('rgba(239,68,68,0.4)')

    const finalScore = scoreRef.current
    const elapsedMs = Math.max(Math.round(DEFAULT_FRAME_MS), finalScore * 800)
    onFinish({
      score: finalScore,
      durationMs: elapsedMs,
    })
  }, [onFinish, playSfx])

  const handleTap = useCallback(() => {
    if (finishedRef.current || gameOverRef.current) {
      return
    }

    const currentMoving = movingRef.current
    if (currentMoving === null) {
      return
    }

    const currentStack = stackRef.current
    const topBlock = currentStack[currentStack.length - 1]

    const movingLeft = currentMoving.x
    const movingRight = currentMoving.x + currentMoving.width
    const stackLeft = topBlock.x
    const stackRight = topBlock.x + topBlock.width

    const overlapLeft = Math.max(movingLeft, stackLeft)
    const overlapRight = Math.min(movingRight, stackRight)
    const overlapWidth = overlapRight - overlapLeft

    if (overlapWidth <= 0) {
      setCutPiece({
        x: currentMoving.x,
        width: currentMoving.width,
        colorIndex: currentMoving.colorIndex,
        side: currentMoving.x < stackLeft ? 'left' : 'right',
      })
      setCutPieceOpacity(1)
      clearTimeoutSafe(cutPieceTimerRef)
      cutPieceTimerRef.current = window.setTimeout(() => {
        cutPieceTimerRef.current = null
        setCutPiece(null)
      }, 600)
      finishGame()
      return
    }

    const offset = Math.abs((movingLeft + currentMoving.width / 2) - (stackLeft + topBlock.width / 2))
    const isPerfect = offset <= PERFECT_THRESHOLD

    let placedWidth: number
    let placedX: number

    if (isPerfect) {
      placedWidth = Math.min(topBlock.width + PERFECT_GROW, BOARD_WIDTH)
      placedX = topBlock.x - (placedWidth - topBlock.width) / 2
      if (placedX < 0) {
        placedX = 0
      }
      if (placedX + placedWidth > BOARD_WIDTH) {
        placedX = BOARD_WIDTH - placedWidth
      }

      const nextPerfects = consecutivePerfectsRef.current + 1
      consecutivePerfectsRef.current = nextPerfects
      setConsecutivePerfects(nextPerfects)

      const nextPerfectCount = perfectCountRef.current + 1
      perfectCountRef.current = nextPerfectCount
      setPerfectCount(nextPerfectCount)

      setPerfectFlash(true)
      clearTimeoutSafe(perfectFlashTimerRef)
      perfectFlashTimerRef.current = window.setTimeout(() => {
        perfectFlashTimerRef.current = null
        setPerfectFlash(false)
      }, 350)

      playSfx(tapStrongAudioRef, 0.6, 1.0 + Math.min(nextPerfects * 0.06, 0.5))

      // Visual effects for perfect
      effects.comboHitBurst(placedX + placedWidth / 2, 80, nextPerfects, PERFECT_BONUS)
    } else {
      placedWidth = overlapWidth
      placedX = overlapLeft
      consecutivePerfectsRef.current = 0
      setConsecutivePerfects(0)

      const excessLeft = stackLeft - movingLeft
      const excessRight = movingRight - stackRight

      if (excessLeft > 1 || excessRight > 1) {
        const cutSide: 'left' | 'right' = excessLeft > excessRight ? 'left' : 'right'
        const cutX = cutSide === 'left' ? movingLeft : stackRight
        const cutW = cutSide === 'left' ? excessLeft : excessRight
        setCutPiece({ x: cutX, width: cutW, colorIndex: currentMoving.colorIndex, side: cutSide })
        setCutPieceOpacity(1)
        clearTimeoutSafe(cutPieceTimerRef)
        cutPieceTimerRef.current = window.setTimeout(() => {
          cutPieceTimerRef.current = null
          setCutPiece(null)
        }, 600)
      }

      playSfx(tapAudioRef, 0.5, 0.95 + Math.random() * 0.1)
      effects.spawnParticles(3, placedX + placedWidth / 2, 80)
    }

    if (placedWidth < MIN_BLOCK_WIDTH) {
      finishGame()
      return
    }

    const newBlock: StackBlock = {
      x: placedX,
      width: placedWidth,
      colorIndex: currentMoving.colorIndex,
    }

    const nextStack = [...currentStack, newBlock]
    stackRef.current = nextStack
    setStack(nextStack)

    // Combo: consecutive successful placements
    const nextCombo = comboRef.current + 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    // Fever mode from consecutive perfects
    const feverActive = consecutivePerfectsRef.current >= FEVER_PERFECT_THRESHOLD
    setIsFever(feverActive)

    // Golden block every N blocks
    const isGolden = nextStack.length % GOLDEN_BLOCK_INTERVAL === 0
    setIsGoldenBlock(isGolden)

    let points = COMBO_BASE + Math.floor(nextCombo / 5)
    if (isPerfect) points += PERFECT_BONUS
    if (isGolden) points += GOLDEN_BLOCK_BONUS
    if (feverActive) points *= FEVER_SCORE_MULTIPLIER

    const nextScore = scoreRef.current + points
    scoreRef.current = nextScore
    setScore(nextScore)
    if (points > 1) {
      effects.showScorePopup(points, newBlock.x + newBlock.width / 2, 60)
    }

    const stackHeight = nextStack.length
    if (stackHeight > VISIBLE_STACK_COUNT / 2) {
      targetCameraYRef.current = (stackHeight - VISIBLE_STACK_COUNT / 2) * BLOCK_HEIGHT
    }

    movingRef.current = null
    setMoving(null)

    window.setTimeout(() => {
      if (!finishedRef.current && !gameOverRef.current) {
        spawnMovingBlock(newBlock, stackHeight)
      }
    }, 80)
  }, [finishGame, playSfx, spawnMovingBlock])

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
      clearTimeoutSafe(perfectFlashTimerRef)
      clearTimeoutSafe(cutPieceTimerRef)
      tapAudioRef.current = null
      tapStrongAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const initialBlock = stackRef.current[0]
    spawnMovingBlock(initialBlock, 1)
  }, [spawnMovingBlock])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
        return
      }
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault()
        handleTap()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleTap, onExit])

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

      const currentMoving = movingRef.current
      if (currentMoving !== null) {
        const nextX = currentMoving.x + currentMoving.direction * currentMoving.speed * deltaSec
        let nextDirection = currentMoving.direction

        if (nextX + currentMoving.width > BOARD_WIDTH + currentMoving.width * 0.5) {
          nextDirection = -1
        } else if (nextX < -currentMoving.width * 0.5) {
          nextDirection = 1
        }

        const updated: MovingBlock = {
          ...currentMoving,
          x: nextX,
          direction: nextDirection,
        }
        movingRef.current = updated
        setMoving({ ...updated })
      }

      const currentCameraY = cameraYRef.current
      const targetCameraY = targetCameraYRef.current
      if (Math.abs(targetCameraY - currentCameraY) > 0.5) {
        const nextCameraY = currentCameraY + (targetCameraY - currentCameraY) * CAMERA_LERP
        cameraYRef.current = nextCameraY
        setCameraY(nextCameraY)
      }

      if (cutPiece !== null) {
        setCutPieceOpacity((previous) => Math.max(0, previous - deltaSec * 2.5))
      }

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
  }, [cutPiece])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const blockY = (index: number): number => {
    return BASE_Y_OFFSET - index * BLOCK_HEIGHT + cameraY
  }

  return (
    <section className="mini-game-panel stack-tower-panel" aria-label="stack-tower-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <div className="stack-tower-score-strip">
        <p className="stack-tower-score">{score}</p>
        <p className="stack-tower-best">BEST {displayedBestScore}</p>
        <p className="stack-tower-perfects">PERFECT x{perfectCount}</p>
      </div>

      {consecutivePerfects >= 2 && (
        <div className="stack-tower-streak">
          PERFECT x{consecutivePerfects} STREAK!
        </div>
      )}
      {isFever && (
        <div style={{ color: '#fbbf24', fontWeight: 800, fontSize: 12, textAlign: 'center', textShadow: '0 0 8px #f59e0b', animation: 'stack-tower-streak-pulse 0.4s ease-in-out infinite alternate' }}>
          FEVER x{FEVER_SCORE_MULTIPLIER}
        </div>
      )}
      {combo >= 5 && !isFever && (
        <div style={{ color: '#22d3ee', fontWeight: 700, fontSize: 10, textAlign: 'center' }}>
          COMBO x{combo}
        </div>
      )}
      {isGoldenBlock && (
        <div style={{ color: '#fbbf24', fontWeight: 800, fontSize: 11, textAlign: 'center', animation: 'stack-tower-perfect-pop 0.35s ease-out' }}>
          GOLDEN BLOCK! +{GOLDEN_BLOCK_BONUS}
        </div>
      )}

      <div
        className={`stack-tower-board ${perfectFlash ? 'stack-tower-perfect-flash' : ''}`}
        onClick={handleTap}
        role="presentation"
        style={{
          width: BOARD_WIDTH,
          height: BOARD_HEIGHT,
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 40%, #334155 100%)',
          borderRadius: 12,
          cursor: 'pointer',
          touchAction: 'manipulation',
          userSelect: 'none',
        }}
      >
        {stack.map((block, index) => {
          const y = blockY(index)
          if (y < -BLOCK_HEIGHT || y > BOARD_HEIGHT + BLOCK_HEIGHT) {
            return null
          }

          return (
            <div
              key={`stack-${index}`}
              className="stack-tower-block"
              style={{
                position: 'absolute',
                left: block.x,
                top: y,
                width: block.width,
                height: BLOCK_HEIGHT,
                background: blockColor(block.colorIndex),
                borderBottom: '2px solid rgba(0,0,0,0.2)',
                borderTop: '1px solid rgba(255,255,255,0.25)',
                transition: perfectFlash && index === stack.length - 1 ? 'background 0.15s' : undefined,
              }}
            />
          )
        })}

        {moving !== null && (
          <div
            className="stack-tower-moving-block"
            style={{
              position: 'absolute',
              left: moving.x,
              top: blockY(stack.length),
              width: moving.width,
              height: BLOCK_HEIGHT,
              background: blockColor(moving.colorIndex),
              borderBottom: '2px solid rgba(0,0,0,0.2)',
              borderTop: '1px solid rgba(255,255,255,0.25)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            }}
          />
        )}

        {cutPiece !== null && (
          <div
            className="stack-tower-cut-piece"
            style={{
              position: 'absolute',
              left: cutPiece.x,
              top: blockY(stack.length - 1),
              width: cutPiece.width,
              height: BLOCK_HEIGHT,
              background: blockColor(cutPiece.colorIndex),
              opacity: cutPieceOpacity,
              transform: `translateY(${(1 - cutPieceOpacity) * 60}px) rotate(${cutPiece.side === 'left' ? '-' : ''}${(1 - cutPieceOpacity) * 15}deg)`,
              pointerEvents: 'none',
            }}
          />
        )}

        {perfectFlash && (
          <div
            className="stack-tower-perfect-label"
            style={{
              position: 'absolute',
              top: blockY(stack.length - 1) - 32,
              left: 0,
              right: 0,
              textAlign: 'center',
              color: '#ffffff',
              fontSize: 14,
              fontWeight: 'bold',
              textShadow: '0 0 12px #f97316, 0 0 24px #f97316',
              pointerEvents: 'none',
              animation: 'stack-tower-perfect-pop 0.35s ease-out',
            }}
          >
            PERFECT! +{PERFECT_BONUS}
          </div>
        )}

        {gameOver && (
          <div
            className="stack-tower-game-over"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,0.55)',
              color: '#ffffff',
              fontSize: 18,
              fontWeight: 'bold',
              pointerEvents: 'none',
            }}
          >
            GAME OVER
          </div>
        )}

        <p
          className="stack-tower-tap-hint"
          style={{
            position: 'absolute',
            bottom: 8,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 8,
            margin: 0,
            pointerEvents: 'none',
          }}
        >
          TAP / SPACE to place block
        </p>
      </div>

      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>

      <style>{`
        .stack-tower-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          aspect-ratio: 9 / 16;
          max-height: 100%;
          margin: 0 auto;
          justify-content: center;
          overflow: hidden;
          position: relative;
        }

        .stack-tower-score-strip {
          display: flex;
          align-items: baseline;
          gap: 12px;
          width: ${BOARD_WIDTH}px;
          justify-content: space-between;
        }

        .stack-tower-score {
          font-size: 22px;
          font-weight: bold;
          color: #f97316;
          margin: 0;
        }

        .stack-tower-best {
          font-size: 9px;
          color: #94a3b8;
          margin: 0;
        }

        .stack-tower-perfects {
          font-size: 9px;
          color: #fbbf24;
          margin: 0;
        }

        .stack-tower-streak {
          font-size: 10px;
          color: #fbbf24;
          text-align: center;
          animation: stack-tower-streak-pulse 0.6s ease-in-out infinite alternate;
        }

        .stack-tower-perfect-flash {
          box-shadow: 0 0 30px rgba(249, 115, 22, 0.5) !important;
        }

        @keyframes stack-tower-perfect-pop {
          0% { transform: scale(0.5) translateY(10px); opacity: 0; }
          50% { transform: scale(1.3) translateY(-4px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        @keyframes stack-tower-streak-pulse {
          0% { opacity: 0.7; transform: scale(1); }
          100% { opacity: 1; transform: scale(1.05); }
        }
      `}</style>
    </section>
  )
}

export const stackTowerModule: MiniGameModule = {
  manifest: {
    id: 'stack-tower',
    title: 'Stack Tower',
    description: '블록을 정확히 쌓아 올려라! PERFECT 매칭으로 보너스!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: StackTowerGame,
}
