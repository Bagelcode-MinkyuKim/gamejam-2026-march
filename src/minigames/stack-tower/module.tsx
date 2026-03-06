import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import placeSfx from '../../../assets/sounds/stack-tower-place.mp3'
import perfectSfx from '../../../assets/sounds/stack-tower-perfect.mp3'
import crashSfx from '../../../assets/sounds/stack-tower-crash.mp3'
import comboSfx from '../../../assets/sounds/stack-tower-combo.mp3'
import feverSfx from '../../../assets/sounds/stack-tower-fever.mp3'
import goldenSfx from '../../../assets/sounds/stack-tower-golden.mp3'
import speedupSfx from '../../../assets/sounds/stack-tower-speedup.mp3'

// ─── Game Constants ────────────────────────────────────────────────

const BOARD_WIDTH = 400
const INITIAL_BLOCK_WIDTH = 160
const BLOCK_HEIGHT = 32
const MIN_BLOCK_WIDTH = 14
const PERFECT_THRESHOLD = 4
const PERFECT_BONUS = 5
const PERFECT_GROW = 6
const INITIAL_SPEED = 110
const SPEED_INCREMENT = 5
const MAX_SPEED = 520
const GOLDEN_BLOCK_INTERVAL = 10
const GOLDEN_BLOCK_BONUS = 20
const FEVER_PERFECT_THRESHOLD = 5
const FEVER_SCORE_MULTIPLIER = 3
const COMBO_BASE = 1
const VISIBLE_STACK_COUNT = 20
const CAMERA_LERP = 0.12
const SPEEDUP_WARNING_THRESHOLD = 300
const MILESTONE_INTERVALS = [25, 50, 100]

const COLOR_PALETTE = [
  '#f97316', '#fb923c', '#f59e0b', '#eab308',
  '#84cc16', '#22c55e', '#14b8a6', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#d946ef', '#ec4899', '#f43f5e', '#ef4444',
] as const

interface StackBlock {
  readonly x: number
  readonly width: number
  readonly colorIndex: number
  readonly isGolden: boolean
}

interface MovingBlock {
  x: number
  width: number
  direction: 1 | -1
  speed: number
  colorIndex: number
  isGolden: boolean
}

function blockColor(colorIndex: number, isGolden: boolean): string {
  if (isGolden) return '#fbbf24'
  return COLOR_PALETTE[colorIndex % COLOR_PALETTE.length]
}

function blockGradient(colorIndex: number, isGolden: boolean): string {
  if (isGolden) return 'linear-gradient(180deg, #fde68a 0%, #fbbf24 40%, #f59e0b 100%)'
  const base = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length]
  return `linear-gradient(180deg, ${base}dd 0%, ${base} 50%, ${base}bb 100%)`
}

// ─── Component ─────────────────────────────────────────────────────

function StackTowerGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const containerRef = useRef<HTMLDivElement>(null)
  const [boardHeight, setBoardHeight] = useState(640)

  // Measure container height
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        const h = containerRef.current.clientHeight
        setBoardHeight(Math.max(400, h - 80))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const BASE_Y_OFFSET = boardHeight - BLOCK_HEIGHT

  const [stack, setStack] = useState<StackBlock[]>(() => [
    { x: (BOARD_WIDTH - INITIAL_BLOCK_WIDTH) / 2, width: INITIAL_BLOCK_WIDTH, colorIndex: 0, isGolden: false },
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
  const [showSpeedWarning, setShowSpeedWarning] = useState(false)
  const [milestoneText, setMilestoneText] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(true)
  const [feverPulse, setFeverPulse] = useState(0)

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
  const speedWarningTimerRef = useRef<number | null>(null)
  const milestoneTimerRef = useRef<number | null>(null)
  const feverActiveRef = useRef(false)
  const lastSpeedRef = useRef(INITIAL_SPEED)

  // Audio refs
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({
    place: null, perfect: null, crash: null,
    combo: null, fever: null, golden: null, speedup: null,
  })

  const playSfx = useCallback((key: string, volume = 0.5, rate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = rate
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
    const isGolden = (stackHeight + 1) % GOLDEN_BLOCK_INTERVAL === 0

    // Speed warning
    if (speed >= SPEEDUP_WARNING_THRESHOLD && lastSpeedRef.current < SPEEDUP_WARNING_THRESHOLD) {
      setShowSpeedWarning(true)
      playSfx('speedup', 0.5)
      clearTimeoutSafe(speedWarningTimerRef)
      speedWarningTimerRef.current = window.setTimeout(() => {
        speedWarningTimerRef.current = null
        setShowSpeedWarning(false)
      }, 1500)
    }
    lastSpeedRef.current = speed

    const newMoving: MovingBlock = { x: startX, width: topBlock.width, direction, speed, colorIndex: nextColorIndex, isGolden }
    movingRef.current = newMoving
    setMoving(newMoving)
  }, [playSfx])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    gameOverRef.current = true
    setGameOver(true)
    movingRef.current = null
    setMoving(null)
    playSfx('crash', 0.7, 0.9)
    effects.triggerShake(10, 300)
    effects.triggerFlash('rgba(239,68,68,0.5)', 200)

    const finalScore = scoreRef.current
    const elapsedMs = Math.max(Math.round(DEFAULT_FRAME_MS), finalScore * 800)
    onFinish({ score: finalScore, durationMs: elapsedMs })
  }, [onFinish, playSfx, effects])

  const handleTap = useCallback(() => {
    if (finishedRef.current || gameOverRef.current) return
    const currentMoving = movingRef.current
    if (!currentMoving) return

    // Hide guide after first tap
    setShowGuide(false)

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
        x: currentMoving.x, width: currentMoving.width,
        colorIndex: currentMoving.colorIndex,
        side: currentMoving.x < stackLeft ? 'left' : 'right',
      })
      setCutPieceOpacity(1)
      clearTimeoutSafe(cutPieceTimerRef)
      cutPieceTimerRef.current = window.setTimeout(() => { cutPieceTimerRef.current = null; setCutPiece(null) }, 600)
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
      placedX = Math.max(0, Math.min(placedX, BOARD_WIDTH - placedWidth))

      const nextPerfects = consecutivePerfectsRef.current + 1
      consecutivePerfectsRef.current = nextPerfects
      setConsecutivePerfects(nextPerfects)

      const nextPerfectCount = perfectCountRef.current + 1
      perfectCountRef.current = nextPerfectCount
      setPerfectCount(nextPerfectCount)

      setPerfectFlash(true)
      clearTimeoutSafe(perfectFlashTimerRef)
      perfectFlashTimerRef.current = window.setTimeout(() => { perfectFlashTimerRef.current = null; setPerfectFlash(false) }, 400)

      playSfx('perfect', 0.65, 1.0 + Math.min(nextPerfects * 0.07, 0.6))

      // Check fever activation
      if (nextPerfects >= FEVER_PERFECT_THRESHOLD && !feverActiveRef.current) {
        feverActiveRef.current = true
        setIsFever(true)
        playSfx('fever', 0.7)
        effects.triggerFlash('rgba(251,191,36,0.4)', 300)
      }

      // Combo sound every 3 perfects
      if (nextPerfects > 1 && nextPerfects % 3 === 0) {
        playSfx('combo', 0.5, 1.0 + nextPerfects * 0.03)
      }

      effects.comboHitBurst(placedX + placedWidth / 2, 80, nextPerfects, PERFECT_BONUS, ['✨', '🌟', '💫', '⭐'])
    } else {
      placedWidth = overlapWidth
      placedX = overlapLeft
      consecutivePerfectsRef.current = 0
      setConsecutivePerfects(0)
      if (feverActiveRef.current) {
        feverActiveRef.current = false
        setIsFever(false)
      }

      const excessLeft = stackLeft - movingLeft
      const excessRight = movingRight - stackRight

      if (excessLeft > 1 || excessRight > 1) {
        const cutSide: 'left' | 'right' = excessLeft > excessRight ? 'left' : 'right'
        const cutX = cutSide === 'left' ? movingLeft : stackRight
        const cutW = cutSide === 'left' ? excessLeft : excessRight
        setCutPiece({ x: cutX, width: cutW, colorIndex: currentMoving.colorIndex, side: cutSide })
        setCutPieceOpacity(1)
        clearTimeoutSafe(cutPieceTimerRef)
        cutPieceTimerRef.current = window.setTimeout(() => { cutPieceTimerRef.current = null; setCutPiece(null) }, 600)
      }

      playSfx('place', 0.5, 0.9 + Math.random() * 0.2)
      effects.spawnParticles(3, placedX + placedWidth / 2, 80, undefined, 'circle')
      effects.triggerShake(2, 60)
    }

    if (placedWidth < MIN_BLOCK_WIDTH) {
      finishGame()
      return
    }

    const isGolden = currentMoving.isGolden
    const newBlock: StackBlock = { x: placedX, width: placedWidth, colorIndex: currentMoving.colorIndex, isGolden }
    const nextStack = [...currentStack, newBlock]
    stackRef.current = nextStack
    setStack(nextStack)

    // Golden block effect
    if (isGolden) {
      playSfx('golden', 0.6)
      effects.triggerFlash('rgba(251,191,36,0.3)', 150)
      effects.spawnParticles(6, placedX + placedWidth / 2, 80, ['💰', '🪙', '💎', '✨'], 'emoji')
    }

    // Combo
    const nextCombo = comboRef.current + 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    const feverActive = feverActiveRef.current

    let points = COMBO_BASE + Math.floor(nextCombo / 5)
    if (isPerfect) points += PERFECT_BONUS
    if (isGolden) points += GOLDEN_BLOCK_BONUS
    if (feverActive) points *= FEVER_SCORE_MULTIPLIER

    const nextScore = scoreRef.current + points
    scoreRef.current = nextScore
    setScore(nextScore)
    if (points > 1) {
      const popColor = isGolden ? '#fbbf24' : isPerfect ? '#f97316' : feverActive ? '#ec4899' : '#fff'
      effects.showScorePopup(points, newBlock.x + newBlock.width / 2, 60, popColor)
    }

    // Milestone check
    const height = nextStack.length
    for (const m of MILESTONE_INTERVALS) {
      if (height === m) {
        setMilestoneText(`${m} BLOCKS!`)
        clearTimeoutSafe(milestoneTimerRef)
        milestoneTimerRef.current = window.setTimeout(() => { milestoneTimerRef.current = null; setMilestoneText(null) }, 2000)
        effects.triggerFlash('rgba(34,197,94,0.3)', 200)
        playSfx('combo', 0.6, 1.2)
        break
      }
    }

    // Camera
    if (height > VISIBLE_STACK_COUNT / 2) {
      targetCameraYRef.current = (height - VISIBLE_STACK_COUNT / 2) * BLOCK_HEIGHT
    }

    movingRef.current = null
    setMoving(null)

    window.setTimeout(() => {
      if (!finishedRef.current && !gameOverRef.current) {
        spawnMovingBlock(newBlock, height)
      }
    }, 60)
  }, [finishGame, playSfx, spawnMovingBlock, effects])

  // Audio init
  useEffect(() => {
    const sources: Record<string, string> = {
      place: placeSfx, perfect: perfectSfx, crash: crashSfx,
      combo: comboSfx, fever: feverSfx, golden: goldenSfx, speedup: speedupSfx,
    }
    for (const [key, src] of Object.entries(sources)) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioRefs.current[key] = a
    }
    return () => {
      clearTimeoutSafe(perfectFlashTimerRef)
      clearTimeoutSafe(cutPieceTimerRef)
      clearTimeoutSafe(speedWarningTimerRef)
      clearTimeoutSafe(milestoneTimerRef)
      for (const key of Object.keys(audioRefs.current)) audioRefs.current[key] = null
      effects.cleanup()
    }
  }, [])

  // Spawn first moving block
  useEffect(() => {
    const initialBlock = stackRef.current[0]
    spawnMovingBlock(initialBlock, 1)
  }, [spawnMovingBlock])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); handleTap() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, onExit])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const deltaSec = deltaMs / 1000

      const currentMoving = movingRef.current
      if (currentMoving !== null) {
        const nextX = currentMoving.x + currentMoving.direction * currentMoving.speed * deltaSec
        let nextDirection = currentMoving.direction
        if (nextX + currentMoving.width > BOARD_WIDTH + currentMoving.width * 0.5) nextDirection = -1
        else if (nextX < -currentMoving.width * 0.5) nextDirection = 1

        const updated: MovingBlock = { ...currentMoving, x: nextX, direction: nextDirection }
        movingRef.current = updated
        setMoving({ ...updated })
      }

      // Camera lerp
      const currentCameraY = cameraYRef.current
      const targetCameraY = targetCameraYRef.current
      if (Math.abs(targetCameraY - currentCameraY) > 0.5) {
        const nextCameraY = currentCameraY + (targetCameraY - currentCameraY) * CAMERA_LERP
        cameraYRef.current = nextCameraY
        setCameraY(nextCameraY)
      }

      // Cut piece fade
      if (cutPiece !== null) {
        setCutPieceOpacity((prev) => Math.max(0, prev - deltaSec * 2.5))
      }

      // Fever pulse
      if (feverActiveRef.current) {
        setFeverPulse((prev) => (prev + deltaSec * 4) % (Math.PI * 2))
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
  }, [cutPiece, effects])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const blockY = (index: number): number => BASE_Y_OFFSET - index * BLOCK_HEIGHT + cameraY

  // Background gradient changes with height
  const bgGradient = useMemo(() => {
    const height = stack.length
    if (height > 80) return 'linear-gradient(180deg, #0c0a09 0%, #1c1917 40%, #292524 100%)'
    if (height > 50) return 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 40%, #312e81 100%)'
    if (height > 30) return 'linear-gradient(180deg, #0f172a 0%, #172554 40%, #1e3a5f 100%)'
    return 'linear-gradient(180deg, #0f172a 0%, #1e293b 40%, #334155 100%)'
  }, [stack.length])

  // Current speed for display
  const currentSpeed = Math.min(MAX_SPEED, INITIAL_SPEED + stack.length * SPEED_INCREMENT)
  const speedPercent = Math.round((currentSpeed / MAX_SPEED) * 100)

  return (
    <section
      ref={containerRef}
      className="mini-game-panel stack-tower-panel"
      aria-label="stack-tower-game"
      style={{
        maxWidth: '432px', width: '100%', height: '100%',
        margin: '0 auto', overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column',
        ...effects.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}</style>
      <style>{`
        .stack-tower-panel {
          font-family: 'Press Start 2P', 'Courier New', monospace;
        }

        .st-score-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 16px;
          background: rgba(15,23,42,0.9);
          border-bottom: 2px solid rgba(249,115,22,0.3);
          flex-shrink: 0;
          z-index: 10;
        }

        .st-score-main {
          font-size: clamp(24px, 6vw, 36px);
          font-weight: 900;
          color: #f97316;
          margin: 0;
          text-shadow: 0 0 12px rgba(249,115,22,0.5);
        }

        .st-score-sub {
          text-align: right;
        }

        .st-best { font-size: 10px; color: #94a3b8; margin: 0; }
        .st-perfects { font-size: 10px; color: #fbbf24; margin: 0; }

        .st-status-strip {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 4px 16px;
          min-height: 24px;
          flex-shrink: 0;
          z-index: 10;
        }

        .st-streak {
          font-size: 14px;
          font-weight: 800;
          color: #fbbf24;
          text-shadow: 0 0 10px #f59e0b;
          animation: st-pulse 0.5s ease-in-out infinite alternate;
        }

        .st-fever {
          font-size: 16px;
          font-weight: 900;
          color: #ec4899;
          text-shadow: 0 0 14px #ec4899, 0 0 28px #f43f5e;
          animation: st-fever-pulse 0.3s ease-in-out infinite alternate;
        }

        .st-combo {
          font-size: 11px;
          font-weight: 700;
          color: #22d3ee;
          text-shadow: 0 0 6px #22d3ee;
        }

        .st-speed-warning {
          position: absolute;
          top: 80px; left: 0; right: 0;
          text-align: center;
          font-size: 18px;
          font-weight: 900;
          color: #ef4444;
          text-shadow: 0 0 16px #ef4444;
          animation: st-warning-flash 0.3s ease-in-out infinite alternate;
          z-index: 20;
          pointer-events: none;
        }

        .st-milestone {
          position: absolute;
          top: 40%; left: 0; right: 0;
          text-align: center;
          font-size: 28px;
          font-weight: 900;
          color: #22c55e;
          text-shadow: 0 0 20px #22c55e, 0 0 40px #22c55e;
          animation: st-milestone-pop 2s ease-out forwards;
          z-index: 25;
          pointer-events: none;
        }

        .st-guide {
          position: absolute;
          bottom: 60px; left: 0; right: 0;
          text-align: center;
          pointer-events: none;
          z-index: 5;
        }

        .st-guide-text {
          font-size: 14px;
          color: rgba(255,255,255,0.6);
          animation: st-pulse 1.5s ease-in-out infinite;
        }

        .st-guide-line {
          position: absolute;
          width: 2px;
          background: rgba(255,255,255,0.15);
          pointer-events: none;
          z-index: 1;
        }

        .st-speed-bar {
          position: absolute;
          top: 8px; right: 8px;
          width: 4px;
          height: 60px;
          background: rgba(255,255,255,0.1);
          border-radius: 2px;
          z-index: 5;
          overflow: hidden;
        }

        .st-speed-fill {
          position: absolute;
          bottom: 0; left: 0; right: 0;
          border-radius: 2px;
          transition: height 0.3s, background 0.3s;
        }

        .st-block {
          position: absolute;
          border-radius: 3px;
          box-sizing: border-box;
        }

        .st-block-golden {
          box-shadow: 0 0 12px rgba(251,191,36,0.6), inset 0 1px 2px rgba(255,255,255,0.4);
          animation: st-golden-glow 0.8s ease-in-out infinite alternate;
        }

        .st-game-over {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.65);
          z-index: 30;
          pointer-events: none;
        }

        .st-game-over-text {
          font-size: clamp(24px, 7vw, 36px);
          font-weight: 900;
          color: #fff;
          text-shadow: 0 4px 12px rgba(0,0,0,0.8);
          animation: st-bounce-in 0.5s ease-out;
        }

        .st-game-over-score {
          font-size: 18px;
          color: #f97316;
          margin-top: 8px;
          animation: st-bounce-in 0.5s ease-out 0.2s both;
        }

        .st-perfect-ring {
          position: absolute;
          border: 3px solid #f97316;
          border-radius: 50%;
          pointer-events: none;
          animation: st-ring-expand 0.6s ease-out forwards;
        }

        .st-fever-border {
          position: absolute;
          inset: 0;
          border: 3px solid;
          border-image: linear-gradient(45deg, #ec4899, #f97316, #fbbf24, #22c55e, #3b82f6, #ec4899) 1;
          pointer-events: none;
          z-index: 15;
          animation: st-rainbow 2s linear infinite;
        }

        @keyframes st-pulse {
          0% { opacity: 0.7; transform: scale(1); }
          100% { opacity: 1; transform: scale(1.05); }
        }

        @keyframes st-fever-pulse {
          0% { opacity: 0.8; transform: scale(1); }
          100% { opacity: 1; transform: scale(1.08); }
        }

        @keyframes st-warning-flash {
          0% { opacity: 0.5; }
          100% { opacity: 1; }
        }

        @keyframes st-milestone-pop {
          0% { transform: scale(0.3); opacity: 0; }
          20% { transform: scale(1.3); opacity: 1; }
          80% { transform: scale(1); opacity: 1; }
          100% { transform: scale(0.8); opacity: 0; }
        }

        @keyframes st-bounce-in {
          0% { transform: scale(0.3) translateY(20px); opacity: 0; }
          60% { transform: scale(1.1) translateY(-5px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        @keyframes st-golden-glow {
          0% { box-shadow: 0 0 8px rgba(251,191,36,0.4), inset 0 1px 2px rgba(255,255,255,0.3); }
          100% { box-shadow: 0 0 20px rgba(251,191,36,0.8), inset 0 1px 2px rgba(255,255,255,0.5); }
        }

        @keyframes st-ring-expand {
          0% { width: 20px; height: 20px; opacity: 1; }
          100% { width: 120px; height: 120px; opacity: 0; }
        }

        @keyframes st-rainbow {
          0% { filter: hue-rotate(0deg); }
          100% { filter: hue-rotate(360deg); }
        }

        @keyframes st-perfect-pop {
          0% { transform: scale(0.5) translateY(10px); opacity: 0; }
          50% { transform: scale(1.4) translateY(-6px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Score Bar */}
      <div className="st-score-bar">
        <p className="st-score-main">{score}</p>
        <div className="st-score-sub">
          <p className="st-best">BEST {displayedBestScore}</p>
          <p className="st-perfects">PERFECT x{perfectCount}</p>
        </div>
      </div>

      {/* Status Strip */}
      <div className="st-status-strip" style={{ background: isFever ? `rgba(236,72,153,${0.15 + Math.sin(feverPulse) * 0.1})` : 'transparent' }}>
        {isFever && <span className="st-fever">FEVER x{FEVER_SCORE_MULTIPLIER}</span>}
        {consecutivePerfects >= 2 && !isFever && <span className="st-streak">PERFECT x{consecutivePerfects} STREAK!</span>}
        {combo >= 5 && !isFever && <span className="st-combo">COMBO x{combo}</span>}
      </div>

      {/* Game Board */}
      <div
        onClick={handleTap}
        role="presentation"
        style={{
          flex: 1, width: '100%', position: 'relative',
          overflow: 'hidden', background: bgGradient,
          cursor: 'pointer', touchAction: 'manipulation', userSelect: 'none',
        }}
      >
        {/* Fever border */}
        {isFever && <div className="st-fever-border" />}

        {/* Speed indicator */}
        <div className="st-speed-bar">
          <div
            className="st-speed-fill"
            style={{
              height: `${speedPercent}%`,
              background: speedPercent > 70 ? '#ef4444' : speedPercent > 40 ? '#f59e0b' : '#22c55e',
            }}
          />
        </div>

        {/* Guide lines on first few blocks */}
        {showGuide && stack.length <= 3 && moving && (
          <>
            <div className="st-guide-line" style={{
              left: stack[stack.length - 1].x, top: 0,
              height: '100%', borderLeft: '1px dashed rgba(255,255,255,0.15)',
            }} />
            <div className="st-guide-line" style={{
              left: stack[stack.length - 1].x + stack[stack.length - 1].width, top: 0,
              height: '100%', borderLeft: '1px dashed rgba(255,255,255,0.15)',
            }} />
          </>
        )}

        {/* Stack blocks */}
        {stack.map((block, index) => {
          const y = blockY(index)
          if (y < -BLOCK_HEIGHT * 2 || y > boardHeight + BLOCK_HEIGHT) return null

          return (
            <div
              key={`stack-${index}`}
              className={`st-block ${block.isGolden ? 'st-block-golden' : ''}`}
              style={{
                left: block.x, top: y, width: block.width, height: BLOCK_HEIGHT,
                background: blockGradient(block.colorIndex, block.isGolden),
                borderBottom: '2px solid rgba(0,0,0,0.25)',
                borderTop: '1px solid rgba(255,255,255,0.2)',
                transition: perfectFlash && index === stack.length - 1 ? 'background 0.15s' : undefined,
              }}
            />
          )
        })}

        {/* Moving block */}
        {moving && (
          <div
            className={`st-block ${moving.isGolden ? 'st-block-golden' : ''}`}
            style={{
              left: moving.x, top: blockY(stack.length),
              width: moving.width, height: BLOCK_HEIGHT,
              background: blockGradient(moving.colorIndex, moving.isGolden),
              borderBottom: '2px solid rgba(0,0,0,0.25)',
              borderTop: '1px solid rgba(255,255,255,0.2)',
              boxShadow: moving.isGolden
                ? '0 6px 24px rgba(251,191,36,0.5)'
                : '0 4px 16px rgba(0,0,0,0.4)',
            }}
          />
        )}

        {/* Cut piece falling */}
        {cutPiece && (
          <div
            style={{
              position: 'absolute', left: cutPiece.x,
              top: blockY(stack.length - 1),
              width: cutPiece.width, height: BLOCK_HEIGHT,
              background: blockColor(cutPiece.colorIndex, false),
              opacity: cutPieceOpacity, borderRadius: 3,
              transform: `translateY(${(1 - cutPieceOpacity) * 80}px) rotate(${cutPiece.side === 'left' ? '-' : ''}${(1 - cutPieceOpacity) * 20}deg)`,
              pointerEvents: 'none',
            }}
          />
        )}

        {/* Perfect label */}
        {perfectFlash && (
          <div style={{
            position: 'absolute',
            top: blockY(stack.length - 1) - 40,
            left: 0, right: 0, textAlign: 'center',
            color: '#fff', fontSize: 18, fontWeight: 900,
            textShadow: '0 0 16px #f97316, 0 0 32px #f97316',
            pointerEvents: 'none',
            animation: 'st-perfect-pop 0.4s ease-out',
          }}>
            PERFECT! +{PERFECT_BONUS}
          </div>
        )}

        {/* Speed warning */}
        {showSpeedWarning && <div className="st-speed-warning">SPEED UP!</div>}

        {/* Milestone */}
        {milestoneText && <div className="st-milestone">{milestoneText}</div>}

        {/* Guide text */}
        {showGuide && (
          <div className="st-guide">
            <p className="st-guide-text" style={{ margin: 0 }}>TAP to place block</p>
          </div>
        )}

        {/* Perfect ring effect */}
        {perfectFlash && (
          <div className="st-perfect-ring" style={{
            left: stack[stack.length - 1].x + stack[stack.length - 1].width / 2 - 10,
            top: blockY(stack.length - 1) + BLOCK_HEIGHT / 2 - 10,
          }} />
        )}

        {/* Game over */}
        {gameOver && (
          <div className="st-game-over">
            <div className="st-game-over-text">GAME OVER</div>
            <div className="st-game-over-score">SCORE: {score}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              {stack.length - 1} BLOCKS STACKED
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export const stackTowerModule: MiniGameModule = {
  manifest: {
    id: 'stack-tower',
    title: 'Stack Tower',
    description: 'Stack blocks precisely! Perfect match = bonus!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: StackTowerGame,
}
