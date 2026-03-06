import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

import correctSfx from '../../../assets/sounds/odd-one-out-correct.mp3'
import wrongSfx from '../../../assets/sounds/odd-one-out-wrong.mp3'
import feverSfx from '../../../assets/sounds/odd-one-out-fever.mp3'
import comboSfx from '../../../assets/sounds/odd-one-out-combo.mp3'
import timeWarningSfx from '../../../assets/sounds/odd-one-out-time-warning.mp3'
import levelUpSfx from '../../../assets/sounds/odd-one-out-level-up.mp3'
import timeBonusSfx from '../../../assets/sounds/odd-one-out-time-bonus.mp3'
import streakSfx from '../../../assets/sounds/odd-one-out-streak.mp3'
import perfectSfx from '../../../assets/sounds/odd-one-out-perfect.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const ROUND_DURATION_MS = 30_000
const TIME_PENALTY_MS = 2000
const TIME_BONUS_THRESHOLD_MS = 3000
const TIME_BONUS_MS = 1500
const LOW_TIME_THRESHOLD_MS = 5000
const FLASH_DURATION_MS = 220

const GRID_PROGRESSION = [3, 4, 5, 6, 7] as const
const ROUNDS_PER_GRID = 3

const BASE_HUE_SHIFT = 45
const MIN_HUE_SHIFT = 5
const HUE_SHIFT_DECAY = 2.0

const FEVER_STREAK_THRESHOLD = 5
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const STREAK_BONUS_STEP = 3

// Pixel art dot patterns for rendering inside cells
const DOT_PATTERNS = ['solid', 'cross', 'ring', 'checker', 'diamond-fill', 'stripe'] as const
type DotPattern = (typeof DOT_PATTERNS)[number]

type DifficultyMode = 'hue' | 'saturation' | 'lightness' | 'pattern-mix' | 'size-mix'

interface CellData {
  readonly hue: number
  readonly saturation: number
  readonly lightness: number
  readonly pattern: DotPattern
  readonly isOdd: boolean
  readonly scale: number
  readonly rotation: number
}

// ═══════════════════════════════════════════
// PIXEL STAR collectible - floats over cells
// ═══════════════════════════════════════════
interface PixelStar {
  cellIndex: number
  collected: boolean
  spawnTime: number
}

interface RoundSetup {
  readonly gridSize: number
  readonly cells: CellData[]
  readonly currentStar: PixelStar | null
  readonly floorHue: number
  readonly startedAt: number
}

// ═══════════════════════════════════════════
// GENERATION
// ═══════════════════════════════════════════
function pickDifficultyMode(round: number): DifficultyMode {
  if (round < 6) return 'hue'
  if (round < 12) {
    const modes: DifficultyMode[] = ['hue', 'saturation', 'lightness']
    return modes[round % modes.length]
  }
  const modes: DifficultyMode[] = ['hue', 'saturation', 'lightness', 'pattern-mix', 'size-mix']
  return modes[round % modes.length]
}

function generateRound(gridSize: number, round: number): { cells: CellData[]; oddIndex: number; starIndex: number | null } {
  const totalCells = gridSize * gridSize
  const oddIndex = Math.floor(Math.random() * totalCells)
  const mode = pickDifficultyMode(round)

  const baseHue = Math.floor(Math.random() * 360)
  const baseSat = 55 + Math.floor(Math.random() * 30)
  const baseLight = 45 + Math.floor(Math.random() * 20)
  const pattern = DOT_PATTERNS[Math.floor(Math.random() * DOT_PATTERNS.length)]

  const hueShift = Math.max(MIN_HUE_SHIFT, BASE_HUE_SHIFT - round * HUE_SHIFT_DECAY)
  const dir = Math.random() > 0.5 ? 1 : -1

  // Star appears every 4 rounds on a non-odd cell
  let starIndex: number | null = null
  if (round > 0 && round % 4 === 0) {
    do { starIndex = Math.floor(Math.random() * totalCells) } while (starIndex === oddIndex)
  }

  const cells: CellData[] = []
  for (let i = 0; i < totalCells; i++) {
    const isOdd = i === oddIndex
    let h = baseHue, s = baseSat, l = baseLight, p = pattern, sc = 1, rot = 0

    if (isOdd) {
      switch (mode) {
        case 'hue':
          h = (baseHue + hueShift * dir + 360) % 360
          break
        case 'saturation':
          s = Math.max(20, Math.min(100, baseSat + (Math.random() > 0.5 ? 22 : -22)))
          break
        case 'lightness':
          l = Math.max(25, Math.min(75, baseLight + (Math.random() > 0.5 ? 16 : -16)))
          break
        case 'pattern-mix': {
          h = (baseHue + hueShift * dir + 360) % 360
          const others = DOT_PATTERNS.filter(pp => pp !== pattern)
          p = others[Math.floor(Math.random() * others.length)]
          break
        }
        case 'size-mix':
          h = (baseHue + hueShift * 0.5 * dir + 360) % 360
          sc = Math.random() > 0.5 ? 0.72 : 1.28
          rot = Math.random() > 0.5 ? 15 : -15
          break
      }
    }

    cells.push({ hue: h, saturation: s, lightness: l, pattern: p, isOdd, scale: sc, rotation: rot })
  }

  return { cells, oddIndex, starIndex }
}

function toGridSize(round: number): number {
  const idx = Math.min(Math.floor(round / ROUNDS_PER_GRID), GRID_PROGRESSION.length - 1)
  return GRID_PROGRESSION[idx]
}

function createRoundSetup(round: number, previousFloorHue: number): RoundSetup {
  const gridSize = toGridSize(round)
  const { cells, starIndex } = generateRound(gridSize, round)
  const startedAt = performance.now()
  const floorHue = (previousFloorHue + 30 + Math.floor(Math.random() * 20)) % 360

  return {
    gridSize,
    cells,
    currentStar: starIndex === null ? null : { cellIndex: starIndex, collected: false, spawnTime: startedAt },
    floorHue,
    startedAt,
  }
}

// ═══════════════════════════════════════════
// PIXEL DOT CELL - Canvas-rendered pixel art
// ═══════════════════════════════════════════
function PixelDotCell({ cell, size, onClick, isFever, hasStar, starCollected }: {
  cell: CellData; size: number; onClick: () => void; isFever: boolean
  hasStar: boolean; starCollected: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const color = `hsl(${cell.hue}, ${cell.saturation}%, ${cell.lightness}%)`
  const darkColor = `hsl(${cell.hue}, ${cell.saturation}%, ${Math.max(10, cell.lightness - 18)}%)`
  const lightColor = `hsl(${cell.hue}, ${Math.max(20, cell.saturation - 15)}%, ${Math.min(85, cell.lightness + 15)}%)`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // We draw at a low pixel resolution then upscale with pixelated rendering
    const px = 12 // pixel grid resolution
    canvas.width = px
    canvas.height = px
    ctx.imageSmoothingEnabled = false

    const dotSize = Math.round(px * 0.7 * cell.scale)
    const offset = Math.round((px - dotSize) / 2)

    // Background
    ctx.fillStyle = isFever ? `hsl(${cell.hue}, 20%, 92%)` : '#f5f4ef'
    ctx.fillRect(0, 0, px, px)

    // Draw pattern
    ctx.fillStyle = color
    switch (cell.pattern) {
      case 'solid':
        ctx.fillRect(offset, offset, dotSize, dotSize)
        break
      case 'cross': {
        const third = Math.max(1, Math.round(dotSize / 3))
        ctx.fillRect(offset + third, offset, third, dotSize)
        ctx.fillRect(offset, offset + third, dotSize, third)
        break
      }
      case 'ring':
        ctx.fillRect(offset, offset, dotSize, dotSize)
        ctx.fillStyle = isFever ? `hsl(${cell.hue}, 20%, 92%)` : '#f5f4ef'
        ctx.fillRect(offset + 2, offset + 2, Math.max(1, dotSize - 4), Math.max(1, dotSize - 4))
        break
      case 'checker':
        for (let cy = 0; cy < dotSize; cy++) {
          for (let cx = 0; cx < dotSize; cx++) {
            if ((cx + cy) % 2 === 0) {
              ctx.fillStyle = color
              ctx.fillRect(offset + cx, offset + cy, 1, 1)
            }
          }
        }
        break
      case 'diamond-fill': {
        const mid = Math.round(dotSize / 2)
        for (let dy = 0; dy < dotSize; dy++) {
          const w = dy <= mid ? dy : dotSize - dy - 1
          const x0 = mid - w
          ctx.fillRect(offset + x0, offset + dy, w * 2 + 1, 1)
        }
        break
      }
      case 'stripe':
        for (let sy = 0; sy < dotSize; sy++) {
          if (sy % 2 === 0) ctx.fillRect(offset, offset + sy, dotSize, 1)
        }
        break
    }

    // Pixel shadow (bottom-right)
    ctx.fillStyle = darkColor
    ctx.globalAlpha = 0.3
    ctx.fillRect(offset + dotSize, offset + 1, 1, dotSize)
    ctx.fillRect(offset + 1, offset + dotSize, dotSize, 1)
    ctx.globalAlpha = 1

    // Pixel highlight (top-left)
    ctx.fillStyle = lightColor
    ctx.globalAlpha = 0.5
    ctx.fillRect(offset, offset, dotSize, 1)
    ctx.fillRect(offset, offset, 1, dotSize)
    ctx.globalAlpha = 1

    // Star overlay
    if (hasStar && !starCollected) {
      ctx.fillStyle = '#facc15'
      const sc = 3
      const sx = Math.round(px / 2 - sc / 2)
      const sy = Math.round(px / 2 - sc / 2)
      ctx.fillRect(sx, sy, sc, sc)
      ctx.fillRect(sx - 1, sy + 1, 1, 1)
      ctx.fillRect(sx + sc, sy + 1, 1, 1)
      ctx.fillRect(sx + 1, sy - 1, 1, 1)
      ctx.fillRect(sx + 1, sy + sc, 1, 1)
    }
  }, [cell, color, darkColor, lightColor, isFever, hasStar, starCollected, size])

  const borderColor = isFever ? `hsl(${cell.hue}, 40%, 70%)` : '#c8c4b8'

  return (
    <button
      className="dot-cell"
      type="button"
      onClick={onClick}
      style={{
        width: size, height: size,
        padding: 0, margin: 0,
        border: `2px solid ${borderColor}`,
        borderRadius: 0,
        background: 'transparent',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        imageRendering: 'pixelated' as React.CSSProperties['imageRendering'],
        transform: cell.rotation ? `rotate(${cell.rotation}deg)` : undefined,
        transition: 'transform 0.1s',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          imageRendering: 'pixelated',
        }}
      />
    </button>
  )
}

// ═══════════════════════════════════════════
// SCANLINE OVERLAY
// ═══════════════════════════════════════════
function ScanlineOverlay() {
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20,
      background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px)',
      mixBlendMode: 'multiply',
    }} />
  )
}

// ═══════════════════════════════════════════
// PIXEL SPARKLE BURST - retro celebration
// ═══════════════════════════════════════════
interface PixelSparkle {
  id: number
  x: number
  y: number
  color: string
  life: number
}

// ═══════════════════════════════════════════
// MAIN GAME COMPONENT
// ═══════════════════════════════════════════
function OddOneOutGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const initialRoundSetup = useMemo(() => createRoundSetup(0, 0), [])
  const [score, setScore] = useState(0)
  const [round, setRound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [cells, setCells] = useState<CellData[]>(initialRoundSetup.cells)
  const [gridSize, setGridSize] = useState<number>(initialRoundSetup.gridSize)
  const [flashState, setFlashState] = useState<'none' | 'correct' | 'wrong'>('none')
  const [streak, setStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [roundAnim, setRoundAnim] = useState(false)
  const [perfectRounds, setPerfectRounds] = useState(0)
  const [starsCollected, setStarsCollected] = useState(0)
  const [currentStar, setCurrentStar] = useState<PixelStar | null>(initialRoundSetup.currentStar)
  const [pixelSparkles, setPixelSparkles] = useState<PixelSparkle[]>([])
  const [showFeverBanner, setShowFeverBanner] = useState(false)
  const [floorHue, setFloorHue] = useState(initialRoundSetup.floorHue)

  const {
    particles,
    scorePopups,
    isFlashing,
    flashColor,
    comboHitBurst,
    triggerFlash,
    triggerShake,
    updateParticles,
    cleanup,
    getShakeStyle,
  } = useGameEffects()

  // Refs for animation loop
  const scoreRef = useRef(0)
  const roundRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const roundStartRef = useRef(initialRoundSetup.startedAt)
  const interactableRef = useRef(true)
  const streakRef = useRef(0)
  const feverRef = useRef(false)
  const feverMsRef = useRef(0)
  const warningRef = useRef(false)
  const perfectRef = useRef(0)
  const wrongRef = useRef(false)
  const lastGridRef = useRef<number>(initialRoundSetup.gridSize)
  const starsRef = useRef(0)
  const sparkleIdRef = useRef(0)
  const floorHueRef = useRef(initialRoundSetup.floorHue)

  const audioCache = useRef<Record<string, HTMLAudioElement>>({})

  const getAudio = useCallback((src: string) => {
    if (!audioCache.current[src]) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioCache.current[src] = a
    }
    return audioCache.current[src]
  }, [])

  const playAudio = useCallback((src: string, vol = 0.5, rate = 1) => {
    const a = getAudio(src)
    a.currentTime = 0
    a.volume = vol
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [getAudio])

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) { window.clearTimeout(ref.current); ref.current = null }
  }

  // Pixel sparkle burst
  const spawnSparkles = useCallback((cx: number, cy: number, count: number, hue: number) => {
    const newSparkles: PixelSparkle[] = []
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3
      const dist = 20 + Math.random() * 40
      newSparkles.push({
        id: sparkleIdRef.current++,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        color: `hsl(${(hue + i * 30) % 360}, 80%, 60%)`,
        life: 1,
      })
    }
    setPixelSparkles(prev => [...prev, ...newSparkles])
    // Auto-decay
    setTimeout(() => {
      setPixelSparkles(prev => prev.filter(s => !newSparkles.find(ns => ns.id === s.id)))
    }, 600)
  }, [])

  const startNewRound = useCallback(
    (nextRound: number) => {
      const roundSetup = createRoundSetup(nextRound, floorHueRef.current)

      roundRef.current = nextRound
      setRound(nextRound)
      setGridSize(roundSetup.gridSize)
      setCells(roundSetup.cells)
      interactableRef.current = true
      wrongRef.current = false

      setCurrentStar(roundSetup.currentStar)

      // Floor tile hue changes each round
      floorHueRef.current = roundSetup.floorHue
      setFloorHue(roundSetup.floorHue)

      // Grid size level up
      if (roundSetup.gridSize !== lastGridRef.current && nextRound > 0) {
        playAudio(levelUpSfx, 0.5)
        triggerFlash('rgba(132,204,22,0.4)')
      }
      lastGridRef.current = roundSetup.gridSize

      setRoundAnim(true)
      setTimeout(() => setRoundAnim(false), 300)
      roundStartRef.current = roundSetup.startedAt
    },
    [playAudio, triggerFlash],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimer(flashTimerRef)
    const elapsed = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverHitSfx, 0.64, 0.95)
    onFinish({ score: scoreRef.current, durationMs: elapsed })
  }, [onFinish, playAudio])

  // ── Cell tap ──
  const handleCellTap = useCallback(
    (index: number) => {
      if (finishedRef.current || !interactableRef.current) return
      const tappedCell = cells[index]
      if (!tappedCell) return
      interactableRef.current = false

      // Star collection (can be on any cell)
      if (currentStar && currentStar.cellIndex === index && !currentStar.collected) {
        setCurrentStar(prev => prev ? { ...prev, collected: true } : null)
        starsRef.current += 1
        setStarsCollected(starsRef.current)
        // Star gives +3 time
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + 3000)
        setRemainingMs(remainingMsRef.current)
        playAudio(streakSfx, 0.5, 1.3)
        spawnSparkles(200, 300, 8, 50)
      }

      if (tappedCell.isOdd) {
        const solveMs = performance.now() - roundStartRef.current

        const nextStreak = streakRef.current + 1
        streakRef.current = nextStreak
        setStreak(nextStreak)

        // Score
        const streakMult = 1 + Math.floor(nextStreak / STREAK_BONUS_STEP)
        const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
        const speedBonus = solveMs < 1000 ? 3 : solveMs < 2000 ? 1 : 0
        const earned = (1 + speedBonus) * streakMult * feverMult
        const nextScore = scoreRef.current + earned
        scoreRef.current = nextScore
        setScore(nextScore)

        // Time bonus
        if (solveMs < TIME_BONUS_THRESHOLD_MS) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
          setRemainingMs(remainingMsRef.current)
          playAudio(timeBonusSfx, 0.25, 1.1)
        }

        // Perfect tracking
        if (!wrongRef.current) {
          perfectRef.current += 1
          setPerfectRounds(perfectRef.current)
          if (perfectRef.current % 5 === 0) {
            playAudio(perfectSfx, 0.5)
            spawnSparkles(200, 300, 12, 120)
          }
        }

        // Fever
        if (nextStreak >= FEVER_STREAK_THRESHOLD && !feverRef.current) {
          feverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverRemainingMs(FEVER_DURATION_MS)
          triggerFlash('rgba(250,204,21,0.5)')
          playAudio(feverSfx, 0.5)
          setShowFeverBanner(true)
          setTimeout(() => setShowFeverBanner(false), 800)
        }

        // Sound
        if (nextStreak > 1 && nextStreak % STREAK_BONUS_STEP === 0) {
          playAudio(comboSfx, 0.5, 1 + Math.min(0.5, nextStreak * 0.05))
        } else if (nextStreak > 1) {
          playAudio(streakSfx, 0.4, 1 + Math.min(0.4, nextStreak * 0.04))
        } else {
          playAudio(correctSfx, 0.5, 1 + Math.min(0.3, nextScore * 0.01))
        }

        setFlashState('correct')
        comboHitBurst(200, 350, nextStreak, earned)
        triggerFlash('rgba(34,197,94,0.25)')
        spawnSparkles(200, 350, 6, tappedCell.hue)

        clearTimer(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashState('none')
          startNewRound(roundRef.current + 1)
        }, FLASH_DURATION_MS)
      } else {
        wrongRef.current = true
        remainingMsRef.current = Math.max(0, remainingMsRef.current - TIME_PENALTY_MS)
        setRemainingMs(remainingMsRef.current)

        streakRef.current = 0
        setStreak(0)

        if (feverRef.current) {
          feverRef.current = false
          feverMsRef.current = 0
          setIsFever(false)
          setFeverRemainingMs(0)
        }

        setFlashState('wrong')
        playAudio(wrongSfx, 0.5, 0.8)
        triggerShake(8)
        triggerFlash('rgba(239,68,68,0.35)')

        clearTimer(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashState('none')
          interactableRef.current = true
        }, FLASH_DURATION_MS)

        if (remainingMsRef.current <= 0) finishGame()
      }
    },
    [cells, comboHitBurst, currentStar, finishGame, playAudio, spawnSparkles, startNewRound, triggerFlash, triggerShake],
  )

  // ── Keyboard ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit])

  useEffect(() => {
    return () => { clearTimer(flashTimerRef); cleanup() }
  }, [cleanup])

  // ── Game loop ──
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animFrameRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - dt)
      setRemainingMs(remainingMsRef.current)

      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !warningRef.current) {
        warningRef.current = true
        playAudio(timeWarningSfx, 0.4)
      }

      if (feverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - dt)
        setFeverRemainingMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); animFrameRef.current = null; return }
      animFrameRef.current = window.requestAnimationFrame(step)
    }
    animFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animFrameRef.current !== null) { window.cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
      lastFrameRef.current = null
    }
  }, [finishGame, playAudio, updateParticles])

  // ── Derived ──
  const displayBest = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLow = remainingMs <= LOW_TIME_THRESHOLD_MS
  const diffMode = pickDifficultyMode(round)
  const comboLabel = getComboLabel(streak)
  const comboColor = getComboColor(streak)

  const gap = gridSize >= 6 ? 2 : 4
  const gridPad = 6
  const maxW = 420
  const cellSize = Math.floor((maxW - gridPad * 2 - gap * (gridSize - 1)) / gridSize)

  const timerPct = (remainingMs / ROUND_DURATION_MS) * 100
  const timerColor = isLow ? '#e74c3c' : '#6abf4b'

  // Floor tile pattern color
  const floorLight = `hsl(${floorHue}, 12%, 90%)`
  const floorDark = `hsl(${floorHue}, 12%, 86%)`

  return (
    <section
      className="mini-game-panel dot-panel"
      aria-label="odd-one-out-game"
      style={{
        maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto',
        overflow: 'hidden', position: 'relative',
        fontFamily: '"Press Start 2P", "Courier New", monospace',
        imageRendering: 'pixelated' as React.CSSProperties['imageRendering'],
        ...getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .dot-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: #e8e5dc;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          padding: 0;
          gap: 0;
          image-rendering: pixelated;
        }

        .dot-hud {
          background: #2c2137;
          padding: 14px 16px 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          box-shadow: 0 4px 0 #1a1425;
          position: relative;
          z-index: 2;
          text-align: center;
        }

        .dot-score-block {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .dot-score-label {
          font-size: 8px;
          color: #a89cc8;
          margin: 0;
          letter-spacing: 2px;
        }
        .dot-score {
          font-size: clamp(34px, 11vw, 52px);
          font-weight: 900;
          color: #ffd700;
          margin: 0;
          text-shadow: 4px 4px 0 #8b6914;
          letter-spacing: 3px;
          line-height: 1;
        }
        .dot-meta-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
          width: 100%;
        }
        .dot-meta-chip {
          background: #3d2f50;
          color: #e9e2f6;
          font-size: 8px;
          padding: 4px 8px;
          box-shadow: 2px 2px 0 #1a1425;
        }
        .dot-meta-chip strong {
          color: #ffd700;
        }

        .dot-timer-wrap {
          background: #2c2137;
          padding: 0 16px 10px;
          box-shadow: 0 4px 0 #1a1425;
          position: relative;
          z-index: 2;
        }
        .dot-timer-bar {
          height: 10px;
          background: #1a1425;
          border: 2px solid #4a3f5c;
          overflow: hidden;
          image-rendering: pixelated;
        }
        .dot-timer-fill {
          height: 100%;
          transition: width 0.1s linear;
          image-rendering: pixelated;
        }
        .dot-timer-text {
          text-align: center;
          font-size: 12px;
          color: #a89cc8;
          margin: 6px 0 0;
          font-variant-numeric: tabular-nums;
        }
        .dot-timer-text.low { color: #e74c3c; animation: dot-blink 0.4s step-end infinite; }

        @keyframes dot-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.3; }
        }

        .dot-status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 6px 10px;
          min-height: 28px;
          flex-wrap: wrap;
          background: #2c2137;
          box-shadow: 0 4px 0 #1a1425;
          position: relative;
          z-index: 2;
        }
        .dot-tag {
          font-size: 8px;
          padding: 4px 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .dot-arena {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: ${gridPad}px;
          position: relative;
          min-height: 0;
          /* Pixel floor tile pattern */
          background:
            repeating-conic-gradient(${floorLight} 0% 25%, ${floorDark} 0% 50%) 0 0 / 20px 20px;
        }

        .dot-grid {
          display: grid;
          position: relative;
          z-index: 1;
        }
        .dot-grid.anim-enter { animation: dot-grid-pop 0.25s step-end; }

        @keyframes dot-grid-pop {
          0% { transform: scale(0.85); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }

        .dot-cell:active { transform: scale(0.88) !important; }

        .dot-feedback {
          min-height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 8px 12px;
          background: #2c2137;
        }
        .dot-fb-text {
          font-size: 12px;
          margin: 0;
          text-align: center;
          letter-spacing: 1px;
        }
        .dot-fb-text.correct { color: #6abf4b; animation: dot-fb-pop 0.25s step-end; }
        .dot-fb-text.wrong { color: #e74c3c; animation: dot-fb-shake 0.25s step-end; }
        .dot-fb-text.neutral { color: #7a6e94; font-size: 9px; }

        @keyframes dot-fb-pop {
          0% { transform: scale(0.5); } 50% { transform: scale(1.4); } 100% { transform: scale(1); }
        }
        @keyframes dot-fb-shake {
          0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); }
        }

        .dot-info {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 6px 12px;
          font-size: 7px;
          color: #7a6e94;
          background: #2c2137;
        }
        .dot-info strong { color: #a89cc8; }

        .dot-fever-banner {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          font-size: clamp(24px, 8vw, 40px);
          color: #ffd700;
          text-shadow: 3px 3px 0 #8b6914, -1px -1px 0 #fff;
          animation: dot-fever-flash 0.8s step-end forwards;
          pointer-events: none;
          z-index: 30;
          white-space: nowrap;
          letter-spacing: 3px;
        }
        @keyframes dot-fever-flash {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          20% { transform: translate(-50%, -50%) scale(1.4); opacity: 1; }
          80% { transform: translate(-50%, -50%) scale(1.0); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1.0); opacity: 0; }
        }

        /* Pixel sparkles */
        .dot-sparkle {
          position: absolute;
          width: 4px; height: 4px;
          pointer-events: none;
          z-index: 25;
          animation: dot-sparkle-fade 0.6s step-end forwards;
          image-rendering: pixelated;
        }
        @keyframes dot-sparkle-fade {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.5); }
          100% { opacity: 0; transform: scale(0.5); }
        }
      `}</style>

      <ScanlineOverlay />
      <FlashOverlay isFlashing={isFlashing} flashColor={flashColor} />
      <ParticleRenderer particles={particles} />
      <ScorePopupRenderer popups={scorePopups} />

      {/* Pixel sparkles */}
      {pixelSparkles.map(s => (
        <div key={s.id} className="dot-sparkle" style={{ left: s.x, top: s.y, background: s.color }} />
      ))}

      {/* Fever banner */}
      {showFeverBanner && <div className="dot-fever-banner">FEVER!!</div>}

      {/* HUD */}
      <div className="dot-hud">
        <div className="dot-score-block">
          <p className="dot-score-label">SCORE</p>
          <p className="dot-score">{score.toLocaleString()}</p>
        </div>
        <div className="dot-meta-row">
          <span className="dot-meta-chip">BEST <strong>{displayBest.toLocaleString()}</strong></span>
          <span className="dot-meta-chip">ROUND <strong>{round + 1}</strong></span>
          <span className="dot-meta-chip">{gridSize}x{gridSize}</span>
          {starsCollected > 0 && <span className="dot-meta-chip">STAR <strong>{starsCollected}</strong></span>}
        </div>
      </div>

      {/* Timer */}
      <div className="dot-timer-wrap">
        <div className="dot-timer-bar">
          <div className="dot-timer-fill" style={{ width: `${timerPct}%`, backgroundColor: timerColor }} />
        </div>
        <p className={`dot-timer-text ${isLow ? 'low' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}
        </p>
      </div>

      {/* Status */}
      <div className="dot-status">
        {comboLabel && (
          <span className="dot-tag" style={{ color: comboColor, background: `${comboColor}22` }}>
            {comboLabel} x{streak}
          </span>
        )}
        {isFever && (
          <span className="dot-tag" style={{ color: '#ffd700', background: 'rgba(255,215,0,0.15)', animation: 'dot-blink 0.3s step-end infinite' }}>
            FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}
          </span>
        )}
        {streak >= 3 && !comboLabel && (
          <span className="dot-tag" style={{ color: '#6abf4b', background: 'rgba(106,191,75,0.15)' }}>
            STREAK {streak}
          </span>
        )}
        {!comboLabel && !isFever && streak < 3 && (
          <span className="dot-tag" style={{ color: '#7a6e94' }}>
            {diffMode.toUpperCase()}
          </span>
        )}
      </div>

      {/* Arena */}
      <div className="dot-arena">
        <div
          className={`dot-grid ${roundAnim ? 'anim-enter' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${gridSize}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${gridSize}, ${cellSize}px)`,
            gap,
          }}
        >
          {cells.map((cell, i) => (
            <PixelDotCell
              key={`c-${round}-${i}`}
              cell={cell}
              size={cellSize}
              onClick={() => handleCellTap(i)}
              isFever={isFever}
              hasStar={currentStar?.cellIndex === i}
              starCollected={currentStar?.collected ?? false}
            />
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="dot-info">
        <span>PERFECT <strong>{perfectRounds}</strong></span>
        <span>ROUND <strong>{round + 1}</strong></span>
        <span>MODE <strong>{diffMode.toUpperCase()}</strong></span>
      </div>

      {/* Feedback */}
      <div className="dot-feedback">
        {flashState === 'correct' && <p className="dot-fb-text correct">CORRECT!</p>}
        {flashState === 'wrong' && <p className="dot-fb-text wrong">MISS! -2s</p>}
        {flashState === 'none' && <p className="dot-fb-text neutral">FIND THE ODD DOT!</p>}
      </div>
    </section>
  )
}

export const oddOneOutModule: MiniGameModule = {
  manifest: {
    id: 'odd-one-out',
    title: 'Odd One Out',
    description: 'Find the odd pixel dot! Retro puzzle challenge!',
    unlockCost: 20,
    baseReward: 10,
    scoreRewardMultiplier: 1.0,
    accentColor: '#6abf4b',
  },
  Component: OddOneOutGame,
}
