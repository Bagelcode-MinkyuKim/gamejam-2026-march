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
import itemSfx from '../../../assets/sounds/stack-tower-item.mp3'
import stageSfx from '../../../assets/sounds/stack-tower-stage.mp3'
import dangerSfx from '../../../assets/sounds/stack-tower-danger.mp3'

// ─── Pixel Art Color Palette (NES-inspired) ────────────────────────

const PIXEL_COLORS = [
  { base: '#e74c3c', light: '#ff6b6b', dark: '#c0392b', shadow: '#962d22' },
  { base: '#e67e22', light: '#f5a623', dark: '#d35400', shadow: '#a04000' },
  { base: '#f1c40f', light: '#ffe066', dark: '#d4ac0d', shadow: '#b8960b' },
  { base: '#2ecc71', light: '#69db7c', dark: '#27ae60', shadow: '#1e8449' },
  { base: '#1abc9c', light: '#4fd1c5', dark: '#16a085', shadow: '#117a65' },
  { base: '#3498db', light: '#63b3ed', dark: '#2980b9', shadow: '#1f6fa5' },
  { base: '#9b59b6', light: '#b983ce', dark: '#8e44ad', shadow: '#6c3483' },
  { base: '#e84393', light: '#fd79a8', dark: '#c0307a', shadow: '#9b2761' },
] as const

// ─── Game Constants ────────────────────────────────────────────────

const BOARD_WIDTH = 400
const INITIAL_BLOCK_WIDTH = 160
const BLOCK_HEIGHT = 28
const MIN_BLOCK_WIDTH = 14
const PERFECT_THRESHOLD = 5
const PERFECT_BONUS = 5
const PERFECT_GROW = 8
const INITIAL_SPEED = 100
const SPEED_INCREMENT = 4
const MAX_SPEED = 480
const GOLDEN_BLOCK_INTERVAL = 10
const GOLDEN_BLOCK_BONUS = 20
const FEVER_PERFECT_THRESHOLD = 5
const FEVER_SCORE_MULTIPLIER = 3
const COMBO_BASE = 1
const VISIBLE_STACK_COUNT = 22
const CAMERA_LERP = 0.13
const STAGE_BLOCK_INTERVAL = 15
const ITEM_BLOCK_INTERVAL = 7
const DANGER_WIDTH_THRESHOLD = 40

type ItemType = 'widen' | 'slow' | 'double' | null

interface StackBlock {
  readonly x: number
  readonly width: number
  readonly colorIndex: number
  readonly isGolden: boolean
  readonly item: ItemType
}

interface MovingBlock {
  x: number
  width: number
  direction: 1 | -1
  speed: number
  colorIndex: number
  isGolden: boolean
  item: ItemType
}

interface PixelStar {
  x: number
  y: number
  size: number
  twinkleSpeed: number
  phase: number
}

// Stage themes
const STAGE_THEMES = [
  { bg1: '#0a0a2e', bg2: '#16163d', bg3: '#1e1e4d', name: 'NIGHT SKY', stars: 12 },
  { bg1: '#1a0a2e', bg2: '#2d1654', bg3: '#3d1e6d', name: 'GALAXY', stars: 18 },
  { bg1: '#0a1e2e', bg2: '#0d2b42', bg3: '#103859', name: 'DEEP OCEAN', stars: 8 },
  { bg1: '#2e0a0a', bg2: '#421515', bg3: '#5a1e1e', name: 'VOLCANO', stars: 5 },
  { bg1: '#0a2e1a', bg2: '#103d22', bg3: '#164d2b', name: 'ENCHANTED', stars: 15 },
  { bg1: '#2e2a0a', bg2: '#3d3715', bg3: '#4d451e', name: 'GOLDEN AGE', stars: 10 },
] as const

const ITEM_ICONS: Record<string, string> = {
  widen: 'W',
  slow: 'S',
  double: '2x',
}
const ITEM_COLORS: Record<string, string> = {
  widen: '#69db7c',
  slow: '#63b3ed',
  double: '#ffe066',
}

function getStageTheme(stage: number) {
  return STAGE_THEMES[stage % STAGE_THEMES.length]
}

function randomItem(): ItemType {
  const roll = Math.random()
  if (roll < 0.35) return 'widen'
  if (roll < 0.65) return 'slow'
  return 'double'
}

// ─── Pixel Block Renderer ──────────────────────────────────────────

function PixelBlock({ x, y, width, height, colorIndex, isGolden, item, isMoving, isFever }: {
  x: number; y: number; width: number; height: number; colorIndex: number
  isGolden: boolean; item: ItemType; isMoving?: boolean; isFever?: boolean
}) {
  const c = PIXEL_COLORS[colorIndex % PIXEL_COLORS.length]
  const pixelSize = 2

  if (isGolden) {
    return (
      <div style={{
        position: 'absolute', left: x, top: y, width, height,
        background: '#f1c40f',
        boxShadow: `inset 0 ${pixelSize}px 0 #ffe066, inset 0 -${pixelSize}px 0 #d4ac0d, inset ${pixelSize}px 0 0 #ffe066, inset -${pixelSize}px 0 0 #d4ac0d, 0 ${pixelSize * 2}px 0 #b8960b`,
        imageRendering: 'pixelated',
        animation: isMoving ? 'st-golden-blink 0.5s steps(2) infinite' : undefined,
        zIndex: isMoving ? 5 : 2,
      }}>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 900, color: '#b8960b', fontFamily: 'monospace',
          textShadow: '1px 1px 0 #ffe066',
        }}>$</div>
      </div>
    )
  }

  return (
    <div style={{
      position: 'absolute', left: x, top: y, width, height,
      background: c.base,
      boxShadow: `inset 0 ${pixelSize}px 0 ${c.light}, inset 0 -${pixelSize}px 0 ${c.dark}, inset ${pixelSize}px 0 0 ${c.light}, inset -${pixelSize}px 0 0 ${c.dark}, 0 ${pixelSize * 2}px 0 ${c.shadow}`,
      imageRendering: 'pixelated',
      zIndex: isMoving ? 5 : 2,
      animation: isFever ? 'st-fever-block 0.3s steps(2) infinite alternate' : undefined,
    }}>
      {/* Pixel highlight dots */}
      <div style={{
        position: 'absolute', top: pixelSize + 1, left: pixelSize + 1,
        width: pixelSize * 2, height: pixelSize,
        background: `${c.light}88`,
      }} />
      {/* Item icon */}
      {item && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 900, color: ITEM_COLORS[item] ?? '#fff',
          fontFamily: 'monospace', textShadow: `0 0 4px ${ITEM_COLORS[item] ?? '#fff'}`,
          animation: 'st-item-pulse 0.6s steps(3) infinite alternate',
        }}>
          {ITEM_ICONS[item]}
        </div>
      )}
    </div>
  )
}

// ─── Pixel Star Background ─────────────────────────────────────────

function PixelStarfield({ stars, time }: { stars: PixelStar[]; time: number }) {
  return (
    <>
      {stars.map((s, i) => {
        const twinkle = Math.sin(time * s.twinkleSpeed + s.phase) * 0.5 + 0.5
        return (
          <div key={i} style={{
            position: 'absolute', left: s.x, top: s.y,
            width: s.size, height: s.size,
            background: twinkle > 0.7 ? '#fff' : twinkle > 0.3 ? '#aaa' : '#666',
            imageRendering: 'pixelated',
            pointerEvents: 'none', zIndex: 0,
          }} />
        )
      })}
    </>
  )
}

// ─── Main Component ────────────────────────────────────────────────

function StackTowerGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const containerRef = useRef<HTMLDivElement>(null)
  const [boardHeight, setBoardHeight] = useState(640)

  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setBoardHeight(Math.max(400, containerRef.current.clientHeight - 90))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const BASE_Y_OFFSET = boardHeight - BLOCK_HEIGHT

  // Game state
  const [stack, setStack] = useState<StackBlock[]>(() => [
    { x: (BOARD_WIDTH - INITIAL_BLOCK_WIDTH) / 2, width: INITIAL_BLOCK_WIDTH, colorIndex: 0, isGolden: false, item: null },
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
  const [stage, setStage] = useState(1)
  const [stageFlash, setStageFlash] = useState(false)
  const [dangerFlash, setDangerFlash] = useState(false)
  const [doublePoints, setDoublePoints] = useState(0)
  const [slowActive, setSlowActive] = useState(0)
  const [animTime, setAnimTime] = useState(0)
  const [lastItemText, setLastItemText] = useState<string | null>(null)

  // Pixel stars (generated once per stage)
  const [pixelStars, setPixelStars] = useState<PixelStar[]>(() => {
    const theme = getStageTheme(0)
    return Array.from({ length: theme.stars }, () => ({
      x: Math.random() * BOARD_WIDTH,
      y: Math.random() * 800,
      size: Math.random() > 0.7 ? 4 : 2,
      twinkleSpeed: 1 + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
    }))
  })

  // Refs
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
  const feverActiveRef = useRef(false)
  const stageRef = useRef(1)
  const doublePointsRef = useRef(0)
  const slowActiveRef = useRef(0)

  // Timer refs
  const perfectFlashTimerRef = useRef<number | null>(null)
  const cutPieceTimerRef = useRef<number | null>(null)
  const speedWarningTimerRef = useRef<number | null>(null)
  const milestoneTimerRef = useRef<number | null>(null)
  const stageFlashTimerRef = useRef<number | null>(null)
  const dangerTimerRef = useRef<number | null>(null)
  const itemTextTimerRef = useRef<number | null>(null)

  // Audio
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const playSfx = useCallback((key: string, volume = 0.5, rate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = rate
    void audio.play().catch(() => {})
  }, [])

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
  }

  // ─── Spawn Moving Block ──────────────────────────────────────────

  const spawnMovingBlock = useCallback((topBlock: StackBlock, stackHeight: number) => {
    const nextColorIndex = (topBlock.colorIndex + 1) % PIXEL_COLORS.length
    let speed = Math.min(MAX_SPEED, INITIAL_SPEED + stackHeight * SPEED_INCREMENT)

    // Slow power-up
    if (slowActiveRef.current > 0) {
      speed = speed * 0.55
      slowActiveRef.current -= 1
      setSlowActive(slowActiveRef.current)
    }

    const direction: 1 | -1 = stackHeight % 2 === 0 ? 1 : -1
    const startX = direction === 1 ? -topBlock.width : BOARD_WIDTH
    const isGolden = (stackHeight + 1) % GOLDEN_BLOCK_INTERVAL === 0
    const item: ItemType = !isGolden && stackHeight > 3 && stackHeight % ITEM_BLOCK_INTERVAL === 0 ? randomItem() : null

    // Stage check
    const newStage = Math.floor(stackHeight / STAGE_BLOCK_INTERVAL) + 1
    if (newStage > stageRef.current) {
      stageRef.current = newStage
      setStage(newStage)
      setStageFlash(true)
      playSfx('stage', 0.65)
      effects.triggerFlash('rgba(255,255,255,0.5)', 400)
      clearTimeoutSafe(stageFlashTimerRef)
      stageFlashTimerRef.current = window.setTimeout(() => { stageFlashTimerRef.current = null; setStageFlash(false) }, 2500)
      // Regen stars for new stage
      const theme = getStageTheme(newStage - 1)
      setPixelStars(Array.from({ length: theme.stars }, () => ({
        x: Math.random() * BOARD_WIDTH,
        y: Math.random() * 800,
        size: Math.random() > 0.7 ? 4 : 2,
        twinkleSpeed: 1 + Math.random() * 3,
        phase: Math.random() * Math.PI * 2,
      })))
    }

    // Speed warning at high stages
    if (speed > 300 && stackHeight % 20 === 0) {
      playSfx('speedup', 0.4)
      setShowSpeedWarning(true)
      clearTimeoutSafe(speedWarningTimerRef)
      speedWarningTimerRef.current = window.setTimeout(() => { speedWarningTimerRef.current = null; setShowSpeedWarning(false) }, 1200)
    }

    // Danger warning when block is narrow
    if (topBlock.width <= DANGER_WIDTH_THRESHOLD && topBlock.width > MIN_BLOCK_WIDTH) {
      setDangerFlash(true)
      playSfx('danger', 0.35)
      clearTimeoutSafe(dangerTimerRef)
      dangerTimerRef.current = window.setTimeout(() => { dangerTimerRef.current = null; setDangerFlash(false) }, 800)
    }

    const newMoving: MovingBlock = { x: startX, width: topBlock.width, direction, speed, colorIndex: nextColorIndex, isGolden, item }
    movingRef.current = newMoving
    setMoving(newMoving)
  }, [playSfx, effects])

  // ─── Finish Game ─────────────────────────────────────────────────

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    gameOverRef.current = true
    setGameOver(true)
    movingRef.current = null
    setMoving(null)
    playSfx('crash', 0.7, 0.85)
    effects.triggerShake(12, 400)
    effects.triggerFlash('rgba(239,68,68,0.6)', 300)

    // Pixel explosion particles
    const topBlock = stackRef.current[stackRef.current.length - 1]
    effects.spawnParticles(10, topBlock.x + topBlock.width / 2, 100, undefined, 'circle')

    const finalScore = scoreRef.current
    const elapsedMs = Math.max(Math.round(DEFAULT_FRAME_MS), finalScore * 800)
    onFinish({ score: finalScore, durationMs: elapsedMs })
  }, [onFinish, playSfx, effects])

  // ─── Handle Tap ──────────────────────────────────────────────────

  const handleTap = useCallback(() => {
    if (finishedRef.current || gameOverRef.current) return
    const currentMoving = movingRef.current
    if (!currentMoving) return

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

    // Miss completely
    if (overlapWidth <= 0) {
      setCutPiece({ x: currentMoving.x, width: currentMoving.width, colorIndex: currentMoving.colorIndex, side: currentMoving.x < stackLeft ? 'left' : 'right' })
      setCutPieceOpacity(1)
      clearTimeoutSafe(cutPieceTimerRef)
      cutPieceTimerRef.current = window.setTimeout(() => { cutPieceTimerRef.current = null; setCutPiece(null) }, 700)
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
      perfectCountRef.current += 1
      setPerfectCount(perfectCountRef.current)

      setPerfectFlash(true)
      clearTimeoutSafe(perfectFlashTimerRef)
      perfectFlashTimerRef.current = window.setTimeout(() => { perfectFlashTimerRef.current = null; setPerfectFlash(false) }, 400)

      playSfx('perfect', 0.6, 1.0 + Math.min(nextPerfects * 0.08, 0.7))

      if (nextPerfects >= FEVER_PERFECT_THRESHOLD && !feverActiveRef.current) {
        feverActiveRef.current = true
        setIsFever(true)
        playSfx('fever', 0.7)
        effects.triggerFlash('rgba(251,191,36,0.5)', 350)
      }
      if (nextPerfects > 1 && nextPerfects % 3 === 0) {
        playSfx('combo', 0.45, 1.0 + nextPerfects * 0.04)
      }
      effects.comboHitBurst(placedX + placedWidth / 2, 80, nextPerfects, PERFECT_BONUS)
    } else {
      placedWidth = overlapWidth
      placedX = overlapLeft
      consecutivePerfectsRef.current = 0
      setConsecutivePerfects(0)
      if (feverActiveRef.current) { feverActiveRef.current = false; setIsFever(false) }

      const excessLeft = stackLeft - movingLeft
      const excessRight = movingRight - stackRight
      if (excessLeft > 1 || excessRight > 1) {
        const cutSide: 'left' | 'right' = excessLeft > excessRight ? 'left' : 'right'
        const cutX = cutSide === 'left' ? movingLeft : stackRight
        const cutW = cutSide === 'left' ? excessLeft : excessRight
        setCutPiece({ x: cutX, width: cutW, colorIndex: currentMoving.colorIndex, side: cutSide })
        setCutPieceOpacity(1)
        clearTimeoutSafe(cutPieceTimerRef)
        cutPieceTimerRef.current = window.setTimeout(() => { cutPieceTimerRef.current = null; setCutPiece(null) }, 700)
      }

      playSfx('place', 0.45, 0.85 + Math.random() * 0.3)
      effects.spawnParticles(2, placedX + placedWidth / 2, 80, undefined, 'circle')
      effects.triggerShake(2, 50)
    }

    if (placedWidth < MIN_BLOCK_WIDTH) { finishGame(); return }

    // Apply item effects
    if (currentMoving.item) {
      playSfx('item', 0.6)
      effects.triggerFlash(ITEM_COLORS[currentMoving.item] + '44', 200)

      switch (currentMoving.item) {
        case 'widen':
          placedWidth = Math.min(placedWidth + 30, BOARD_WIDTH)
          placedX = Math.max(0, placedX - 15)
          if (placedX + placedWidth > BOARD_WIDTH) placedX = BOARD_WIDTH - placedWidth
          setLastItemText('WIDTH UP!')
          break
        case 'slow':
          slowActiveRef.current = 3
          setSlowActive(3)
          setLastItemText('SLOW DOWN!')
          break
        case 'double':
          doublePointsRef.current = 3
          setDoublePoints(3)
          setLastItemText('DOUBLE PTS!')
          break
      }
      clearTimeoutSafe(itemTextTimerRef)
      itemTextTimerRef.current = window.setTimeout(() => { itemTextTimerRef.current = null; setLastItemText(null) }, 1500)
    }

    const newBlock: StackBlock = { x: placedX, width: placedWidth, colorIndex: currentMoving.colorIndex, isGolden: currentMoving.isGolden, item: null }
    const nextStack = [...currentStack, newBlock]
    stackRef.current = nextStack
    setStack(nextStack)

    // Golden block
    if (currentMoving.isGolden) {
      playSfx('golden', 0.6)
      effects.triggerFlash('rgba(251,191,36,0.35)', 150)
      effects.spawnParticles(6, placedX + placedWidth / 2, 80, undefined, 'circle')
    }

    // Scoring
    const nextCombo = comboRef.current + 1
    comboRef.current = nextCombo
    setCombo(nextCombo)

    let points = COMBO_BASE + Math.floor(nextCombo / 5)
    if (isPerfect) points += PERFECT_BONUS
    if (currentMoving.isGolden) points += GOLDEN_BLOCK_BONUS
    if (feverActiveRef.current) points *= FEVER_SCORE_MULTIPLIER
    if (doublePointsRef.current > 0) { points *= 2; doublePointsRef.current -= 1; setDoublePoints(doublePointsRef.current) }

    const nextScore = scoreRef.current + points
    scoreRef.current = nextScore
    setScore(nextScore)
    if (points > 1) {
      const popColor = currentMoving.isGolden ? '#ffe066' : isPerfect ? '#ff6b6b' : feverActiveRef.current ? '#fd79a8' : '#fff'
      effects.showScorePopup(points, newBlock.x + newBlock.width / 2, 60, popColor)
    }

    // Milestone
    const height = nextStack.length
    for (const m of [25, 50, 75, 100, 150, 200]) {
      if (height === m) {
        setMilestoneText(`${m} BLOCKS!`)
        clearTimeoutSafe(milestoneTimerRef)
        milestoneTimerRef.current = window.setTimeout(() => { milestoneTimerRef.current = null; setMilestoneText(null) }, 2000)
        effects.triggerFlash('rgba(34,197,94,0.35)', 200)
        playSfx('combo', 0.55, 1.2)
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
      if (!finishedRef.current && !gameOverRef.current) spawnMovingBlock(newBlock, height)
    }, 50)
  }, [finishGame, playSfx, spawnMovingBlock, effects])

  // ─── Audio Init ──────────────────────────────────────────────────

  useEffect(() => {
    const sources: Record<string, string> = {
      place: placeSfx, perfect: perfectSfx, crash: crashSfx,
      combo: comboSfx, fever: feverSfx, golden: goldenSfx,
      speedup: speedupSfx, item: itemSfx, stage: stageSfx, danger: dangerSfx,
    }
    for (const [key, src] of Object.entries(sources)) {
      const a = new Audio(src); a.preload = 'auto'; audioRefs.current[key] = a
    }
    return () => {
      ;[perfectFlashTimerRef, cutPieceTimerRef, speedWarningTimerRef, milestoneTimerRef, stageFlashTimerRef, dangerTimerRef, itemTextTimerRef].forEach(clearTimeoutSafe)
      for (const key of Object.keys(audioRefs.current)) audioRefs.current[key] = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => { spawnMovingBlock(stackRef.current[0], 1) }, [spawnMovingBlock])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); handleTap() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, onExit])

  // ─── Game Loop ───────────────────────────────────────────────────

  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      const deltaSec = deltaMs / 1000

      setAnimTime(now * 0.001)

      const currentMoving = movingRef.current
      if (currentMoving !== null) {
        const nextX = currentMoving.x + currentMoving.direction * currentMoving.speed * deltaSec
        let nextDirection = currentMoving.direction
        if (nextX + currentMoving.width > BOARD_WIDTH + currentMoving.width * 0.4) nextDirection = -1
        else if (nextX < -currentMoving.width * 0.4) nextDirection = 1
        const updated: MovingBlock = { ...currentMoving, x: nextX, direction: nextDirection }
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

      if (cutPiece !== null) setCutPieceOpacity((prev) => Math.max(0, prev - deltaSec * 2.5))
      effects.updateParticles()
      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
      lastFrameAtRef.current = null
    }
  }, [cutPiece, effects])

  // ─── Derived State ───────────────────────────────────────────────

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const blockY = (index: number): number => BASE_Y_OFFSET - index * BLOCK_HEIGHT + cameraY
  const theme = getStageTheme(stage - 1)
  const currentSpeed = Math.min(MAX_SPEED, INITIAL_SPEED + stack.length * SPEED_INCREMENT)
  const speedPercent = Math.round((currentSpeed / MAX_SPEED) * 100)

  return (
    <section
      ref={containerRef}
      className="mini-game-panel"
      aria-label="stack-tower-game"
      style={{
        maxWidth: '432px', width: '100%', height: '100%',
        margin: '0 auto', overflow: 'hidden', position: 'relative',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'Press Start 2P', 'Courier New', monospace",
        imageRendering: 'pixelated' as any,
        ...effects.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}</style>
      <style>{`
        @keyframes st-golden-blink { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.4); } }
        @keyframes st-fever-block { 0% { filter: hue-rotate(0deg); } 100% { filter: hue-rotate(30deg); } }
        @keyframes st-item-pulse { 0% { transform: scale(1); } 100% { transform: scale(1.3); } }
        @keyframes st-scanline { 0% { background-position: 0 0; } 100% { background-position: 0 4px; } }
        @keyframes st-pixel-pop { 0% { transform: scale(0) translateY(8px); } 50% { transform: scale(1.5) translateY(-4px); } 100% { transform: scale(1) translateY(0); } }
        @keyframes st-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes st-bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes st-stage-in { 0% { transform: scale(3) rotate(-10deg); opacity: 0; } 30% { transform: scale(1.1) rotate(2deg); opacity: 1; } 100% { transform: scale(1) rotate(0); opacity: 1; } }
        @keyframes st-stage-out { 0% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(-40px); } }
        @keyframes st-danger-pulse { 0%,100% { border-color: rgba(239,68,68,0.2); } 50% { border-color: rgba(239,68,68,0.8); } }
        @keyframes st-rainbow { 0% { filter: hue-rotate(0deg); } 100% { filter: hue-rotate(360deg); } }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* ─── Score HUD (Pixel style) ─── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', background: '#0a0a2e', borderBottom: '3px solid #333',
        flexShrink: 0, zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: 'clamp(22px, 5.5vw, 32px)', fontWeight: 900, color: '#ffe066', margin: 0, textShadow: '2px 2px 0 #b8960b, -1px -1px 0 #000' }}>
            {score}
          </div>
          <div style={{ fontSize: 8, color: '#666', marginTop: 2 }}>STG {stage}</div>
        </div>

        {/* Power-up indicators */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {slowActive > 0 && <div style={{ fontSize: 8, color: '#63b3ed', background: '#1a365d', padding: '2px 6px', border: '2px solid #63b3ed' }}>SLOW x{slowActive}</div>}
          {doublePoints > 0 && <div style={{ fontSize: 8, color: '#ffe066', background: '#5a4a0a', padding: '2px 6px', border: '2px solid #ffe066' }}>2x x{doublePoints}</div>}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 8, color: '#888' }}>BEST {displayedBestScore}</div>
          <div style={{ fontSize: 8, color: '#fbbf24' }}>PERFECT x{perfectCount}</div>
        </div>
      </div>

      {/* ─── Status Strip ─── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '3px 12px', minHeight: 22, flexShrink: 0, zIndex: 10,
        background: isFever ? '#2a0a1e' : 'transparent',
        borderBottom: isFever ? '2px solid #ec4899' : undefined,
      }}>
        {isFever && <span style={{ fontSize: 13, fontWeight: 900, color: '#ec4899', textShadow: '0 0 8px #ec4899', animation: 'st-blink 0.4s steps(2) infinite' }}>FEVER x{FEVER_SCORE_MULTIPLIER}</span>}
        {consecutivePerfects >= 2 && !isFever && <span style={{ fontSize: 11, fontWeight: 800, color: '#ffe066', textShadow: '2px 2px 0 #b8960b', animation: 'st-bounce 0.6s steps(4) infinite' }}>PERFECT x{consecutivePerfects}</span>}
        {combo >= 5 && !isFever && <span style={{ fontSize: 9, fontWeight: 700, color: '#63b3ed' }}>COMBO x{combo}</span>}
      </div>

      {/* ─── Game Board ─── */}
      <div
        onClick={handleTap}
        role="presentation"
        style={{
          flex: 1, width: '100%', position: 'relative', overflow: 'hidden',
          background: `linear-gradient(180deg, ${theme.bg1} 0%, ${theme.bg2} 50%, ${theme.bg3} 100%)`,
          cursor: 'pointer', touchAction: 'manipulation', userSelect: 'none',
          border: dangerFlash ? '3px solid rgba(239,68,68,0.6)' : '3px solid #222',
          boxSizing: 'border-box',
          animation: dangerFlash ? 'st-danger-pulse 0.3s steps(2) infinite' : undefined,
        }}
      >
        {/* Scanline overlay */}
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20, opacity: 0.04,
          background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.3) 2px, rgba(0,0,0,0.3) 4px)',
          animation: 'st-scanline 0.5s steps(2) infinite',
        }} />

        {/* Fever border */}
        {isFever && <div style={{
          position: 'absolute', inset: 0, border: '4px solid #ec4899', pointerEvents: 'none', zIndex: 15,
          animation: 'st-rainbow 1.5s linear infinite',
        }} />}

        {/* Pixel stars */}
        <PixelStarfield stars={pixelStars} time={animTime} />

        {/* Speed bar */}
        <div style={{ position: 'absolute', top: 6, right: 6, width: 6, height: 50, background: '#222', border: '2px solid #444', zIndex: 5 }}>
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            height: `${speedPercent}%`,
            background: speedPercent > 70 ? '#e74c3c' : speedPercent > 40 ? '#e67e22' : '#2ecc71',
            transition: 'height 0.3s steps(5)',
          }} />
        </div>

        {/* Block height indicator */}
        <div style={{ position: 'absolute', top: 6, left: 6, fontSize: 7, color: '#555', zIndex: 5 }}>
          {stack.length - 1}F
        </div>

        {/* Guide lines */}
        {showGuide && stack.length <= 3 && moving && (
          <>
            <div style={{ position: 'absolute', left: stack[stack.length - 1].x, top: 0, width: 1, height: '100%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 1 }} />
            <div style={{ position: 'absolute', left: stack[stack.length - 1].x + stack[stack.length - 1].width, top: 0, width: 1, height: '100%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none', zIndex: 1 }} />
          </>
        )}

        {/* ─── Stack Blocks ─── */}
        {stack.map((block, index) => {
          const y = blockY(index)
          if (y < -BLOCK_HEIGHT * 2 || y > boardHeight + BLOCK_HEIGHT) return null
          return (
            <PixelBlock key={`s-${index}`}
              x={block.x} y={y} width={block.width} height={BLOCK_HEIGHT}
              colorIndex={block.colorIndex} isGolden={block.isGolden} item={block.item}
              isFever={isFever && index === stack.length - 1}
            />
          )
        })}

        {/* Ground / base platform */}
        <div style={{
          position: 'absolute', left: 0, bottom: 0, width: '100%', height: 6,
          background: '#444', borderTop: '2px solid #666', zIndex: 3,
        }} />

        {/* ─── Moving Block ─── */}
        {moving && (
          <PixelBlock
            x={moving.x} y={blockY(stack.length)} width={moving.width} height={BLOCK_HEIGHT}
            colorIndex={moving.colorIndex} isGolden={moving.isGolden} item={moving.item}
            isMoving
          />
        )}

        {/* ─── Cut Piece ─── */}
        {cutPiece && (
          <div style={{
            position: 'absolute', left: cutPiece.x, top: blockY(stack.length - 1),
            width: cutPiece.width, height: BLOCK_HEIGHT,
            background: PIXEL_COLORS[cutPiece.colorIndex % PIXEL_COLORS.length].base,
            opacity: cutPieceOpacity,
            transform: `translateY(${(1 - cutPieceOpacity) * 100}px) rotate(${cutPiece.side === 'left' ? '-' : ''}${(1 - cutPieceOpacity) * 25}deg)`,
            pointerEvents: 'none', imageRendering: 'pixelated',
          }} />
        )}

        {/* ─── Perfect Label ─── */}
        {perfectFlash && (
          <div style={{
            position: 'absolute', top: blockY(stack.length - 1) - 36, left: 0, right: 0,
            textAlign: 'center', color: '#ffe066', fontSize: 16, fontWeight: 900,
            textShadow: '2px 2px 0 #b8960b, -1px -1px 0 #000',
            pointerEvents: 'none', animation: 'st-pixel-pop 0.4s steps(6) forwards', zIndex: 10,
          }}>
            PERFECT! +{PERFECT_BONUS}
          </div>
        )}

        {/* ─── Item acquired text ─── */}
        {lastItemText && (
          <div style={{
            position: 'absolute', top: '30%', left: 0, right: 0,
            textAlign: 'center', fontSize: 18, fontWeight: 900,
            color: '#69db7c', textShadow: '2px 2px 0 #1e8449, 0 0 8px #69db7c',
            pointerEvents: 'none', animation: 'st-pixel-pop 0.5s steps(6) forwards', zIndex: 25,
          }}>
            {lastItemText}
          </div>
        )}

        {/* ─── Speed Warning ─── */}
        {showSpeedWarning && (
          <div style={{
            position: 'absolute', top: 60, left: 0, right: 0, textAlign: 'center',
            fontSize: 16, fontWeight: 900, color: '#e74c3c',
            textShadow: '2px 2px 0 #6b0000', pointerEvents: 'none',
            animation: 'st-blink 0.3s steps(2) infinite', zIndex: 20,
          }}>
            SPEED UP!
          </div>
        )}

        {/* ─── Stage Transition ─── */}
        {stageFlash && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.4)', pointerEvents: 'none', zIndex: 30,
          }}>
            <div style={{
              fontSize: 12, color: '#888', marginBottom: 4,
              animation: 'st-stage-in 0.6s steps(8) forwards',
            }}>
              STAGE
            </div>
            <div style={{
              fontSize: 40, fontWeight: 900, color: '#ffe066',
              textShadow: '3px 3px 0 #b8960b, -2px -2px 0 #000, 0 0 20px #ffe066',
              animation: 'st-stage-in 0.6s steps(8) forwards',
            }}>
              {stage}
            </div>
            <div style={{
              fontSize: 10, color: '#aaa', marginTop: 6,
              animation: 'st-stage-in 0.8s steps(8) forwards',
            }}>
              {theme.name}
            </div>
          </div>
        )}

        {/* ─── Milestone ─── */}
        {milestoneText && (
          <div style={{
            position: 'absolute', top: '40%', left: 0, right: 0, textAlign: 'center',
            fontSize: 22, fontWeight: 900, color: '#2ecc71',
            textShadow: '2px 2px 0 #1e8449, 0 0 16px #2ecc71',
            pointerEvents: 'none', animation: 'st-pixel-pop 0.5s steps(6) forwards', zIndex: 25,
          }}>
            {milestoneText}
          </div>
        )}

        {/* ─── Guide ─── */}
        {showGuide && (
          <div style={{
            position: 'absolute', bottom: 50, left: 0, right: 0, textAlign: 'center',
            pointerEvents: 'none', zIndex: 5,
          }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', animation: 'st-blink 1.5s steps(3) infinite' }}>
              TAP TO STACK
            </div>
          </div>
        )}

        {/* ─── Game Over ─── */}
        {gameOver && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.75)', zIndex: 30, pointerEvents: 'none',
          }}>
            <div style={{
              fontSize: 'clamp(20px, 6vw, 32px)', fontWeight: 900, color: '#e74c3c',
              textShadow: '3px 3px 0 #6b0000, -1px -1px 0 #000',
              animation: 'st-pixel-pop 0.5s steps(6) forwards',
            }}>
              GAME OVER
            </div>
            <div style={{
              fontSize: 16, color: '#ffe066', marginTop: 10,
              textShadow: '2px 2px 0 #b8960b',
              animation: 'st-pixel-pop 0.5s steps(6) 0.2s both',
            }}>
              {score} PTS
            </div>
            <div style={{ fontSize: 9, color: '#888', marginTop: 6, animation: 'st-pixel-pop 0.5s steps(6) 0.4s both' }}>
              {stack.length - 1} BLOCKS / STG {stage}
            </div>
            {perfectCount > 0 && (
              <div style={{ fontSize: 8, color: '#fbbf24', marginTop: 4, animation: 'st-pixel-pop 0.5s steps(6) 0.6s both' }}>
                {perfectCount} PERFECTS
              </div>
            )}
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
