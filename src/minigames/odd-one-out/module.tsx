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
import revealSfx from '../../../assets/sounds/odd-one-out-reveal.mp3'
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

const HINT_COOLDOWN_MS = 12_000
const HINT_DURATION_MS = 2000
const TIME_FREEZE_COOLDOWN_MS = 20_000
const TIME_FREEZE_DURATION_MS = 3000
const DOUBLE_POINTS_COOLDOWN_MS = 15_000
const DOUBLE_POINTS_DURATION_MS = 6000

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
        case 'pattern-mix':
          h = (baseHue + hueShift * dir + 360) % 360
          const others = DOT_PATTERNS.filter(pp => pp !== pattern)
          p = others[Math.floor(Math.random() * others.length)]
          break
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

// ═══════════════════════════════════════════
// PIXEL DOT CELL - Canvas-rendered pixel art
// ═══════════════════════════════════════════
function PixelDotCell({ cell, size, onClick, isHinted, isFever, hasStar, starCollected }: {
  cell: CellData; size: number; onClick: () => void; isHinted: boolean; isFever: boolean
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

    // Hint glow
    if (isHinted && cell.isOdd) {
      ctx.fillStyle = 'rgba(250,204,21,0.6)'
      ctx.fillRect(0, 0, px, 1)
      ctx.fillRect(0, px - 1, px, 1)
      ctx.fillRect(0, 0, 1, px)
      ctx.fillRect(px - 1, 0, 1, px)
    }

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
  }, [cell, isFever, isHinted, hasStar, starCollected, size])

  const borderColor = isHinted && cell.isOdd
    ? '#facc15'
    : isFever ? `hsl(${cell.hue}, 40%, 70%)` : '#c8c4b8'

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
  const [score, setScore] = useState(0)
  const [round, setRound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [cells, setCells] = useState<CellData[]>([])
  const [gridSize, setGridSize] = useState<number>(GRID_PROGRESSION[0])
  const [flashState, setFlashState] = useState<'none' | 'correct' | 'wrong'>('none')
  const [streak, setStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [isHinting, setIsHinting] = useState(false)
  const [hintCooldownMs, setHintCooldownMs] = useState(0)
  const [isTimeFrozen, setIsTimeFrozen] = useState(false)
  const [freezeCooldownMs, setFreezeCooldownMs] = useState(0)
  const [isDoublePoints, setIsDoublePoints] = useState(false)
  const [doubleCooldownMs, setDoubleCooldownMs] = useState(0)
  const [roundAnim, setRoundAnim] = useState(false)
  const [perfectRounds, setPerfectRounds] = useState(0)
  const [starsCollected, setStarsCollected] = useState(0)
  const [currentStar, setCurrentStar] = useState<PixelStar | null>(null)
  const [pixelSparkles, setPixelSparkles] = useState<PixelSparkle[]>([])
  const [showFeverBanner, setShowFeverBanner] = useState(false)
  const [floorHue, setFloorHue] = useState(0)

  const effects = useGameEffects()

  // Refs for animation loop
  const scoreRef = useRef(0)
  const roundRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const roundStartRef = useRef(0)
  const interactableRef = useRef(true)
  const streakRef = useRef(0)
  const feverRef = useRef(false)
  const feverMsRef = useRef(0)
  const frozenRef = useRef(false)
  const freezeCdRef = useRef(0)
  const freezeMsRef = useRef(0)
  const hintCdRef = useRef(0)
  const doubleRef = useRef(false)
  const doubleCdRef = useRef(0)
  const doubleMsRef = useRef(0)
  const warningRef = useRef(false)
  const perfectRef = useRef(0)
  const wrongRef = useRef(false)
  const lastGridRef = useRef<number>(GRID_PROGRESSION[0])
  const starsRef = useRef(0)
  const sparkleIdRef = useRef(0)
  const floorHueRef = useRef(0)

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
      const nextGrid = toGridSize(nextRound)
      const { cells: nextCells, starIndex } = generateRound(nextGrid, nextRound)

      roundRef.current = nextRound
      setRound(nextRound)
      setGridSize(nextGrid)
      setCells(nextCells)
      interactableRef.current = true
      wrongRef.current = false

      // Star
      if (starIndex !== null) {
        setCurrentStar({ cellIndex: starIndex, collected: false, spawnTime: performance.now() })
      } else {
        setCurrentStar(null)
      }

      // Floor tile hue changes each round
      const newFloorHue = (floorHueRef.current + 30 + Math.floor(Math.random() * 20)) % 360
      floorHueRef.current = newFloorHue
      setFloorHue(newFloorHue)

      // Grid size level up
      if (nextGrid !== lastGridRef.current && nextRound > 0) {
        playAudio(levelUpSfx, 0.5)
        effects.triggerFlash('rgba(132,204,22,0.4)')
      }
      lastGridRef.current = nextGrid

      setRoundAnim(true)
      setTimeout(() => setRoundAnim(false), 300)
      roundStartRef.current = performance.now()
    },
    [playAudio, effects],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimer(flashTimerRef)
    const elapsed = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverHitSfx, 0.64, 0.95)
    onFinish({ score: scoreRef.current, durationMs: elapsed })
  }, [onFinish, playAudio])

  // ── Powerups ──
  const activateHint = useCallback(() => {
    if (hintCdRef.current > 0 || finishedRef.current) return
    setIsHinting(true)
    hintCdRef.current = HINT_COOLDOWN_MS
    setHintCooldownMs(HINT_COOLDOWN_MS)
    playAudio(revealSfx, 0.4, 1.2)
    setTimeout(() => setIsHinting(false), HINT_DURATION_MS)
  }, [playAudio])

  const activateFreeze = useCallback(() => {
    if (freezeCdRef.current > 0 || finishedRef.current) return
    frozenRef.current = true
    setIsTimeFrozen(true)
    freezeMsRef.current = TIME_FREEZE_DURATION_MS
    freezeCdRef.current = TIME_FREEZE_COOLDOWN_MS
    setFreezeCooldownMs(TIME_FREEZE_COOLDOWN_MS)
    playAudio(timeBonusSfx, 0.4, 0.8)
    effects.triggerFlash('rgba(59,130,246,0.3)')
  }, [playAudio, effects])

  const activateDouble = useCallback(() => {
    if (doubleCdRef.current > 0 || finishedRef.current) return
    doubleRef.current = true
    setIsDoublePoints(true)
    doubleMsRef.current = DOUBLE_POINTS_DURATION_MS
    doubleCdRef.current = DOUBLE_POINTS_COOLDOWN_MS
    setDoubleCooldownMs(DOUBLE_POINTS_COOLDOWN_MS)
    playAudio(comboSfx, 0.4, 1.5)
    effects.triggerFlash('rgba(168,85,247,0.3)')
  }, [playAudio, effects])

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
        const doubleMult = doubleRef.current ? 2 : 1
        const speedBonus = solveMs < 1000 ? 3 : solveMs < 2000 ? 1 : 0
        const earned = (1 + speedBonus) * streakMult * feverMult * doubleMult
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
          effects.triggerFlash('rgba(250,204,21,0.5)')
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
        effects.comboHitBurst(200, 350, nextStreak, earned)
        effects.triggerFlash('rgba(34,197,94,0.25)')
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
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.35)')

        clearTimer(flashTimerRef)
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = null
          setFlashState('none')
          interactableRef.current = true
        }, FLASH_DURATION_MS)

        if (remainingMsRef.current <= 0) finishGame()
      }
    },
    [cells, currentStar, finishGame, playAudio, startNewRound, effects, spawnSparkles],
  )

  // ── Keyboard ──
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit])

  // ── Init ──
  useEffect(() => {
    startNewRound(0)
    return () => { clearTimer(flashTimerRef); effects.cleanup() }
  }, [startNewRound])

  // ── Game loop ──
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animFrameRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now

      if (!frozenRef.current) {
        remainingMsRef.current = Math.max(0, remainingMsRef.current - dt)
        setRemainingMs(remainingMsRef.current)
      }

      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !warningRef.current) {
        warningRef.current = true
        playAudio(timeWarningSfx, 0.4)
      }

      if (feverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - dt)
        setFeverRemainingMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      if (frozenRef.current) {
        freezeMsRef.current = Math.max(0, freezeMsRef.current - dt)
        if (freezeMsRef.current <= 0) { frozenRef.current = false; setIsTimeFrozen(false) }
      }

      if (doubleRef.current) {
        doubleMsRef.current = Math.max(0, doubleMsRef.current - dt)
        if (doubleMsRef.current <= 0) { doubleRef.current = false; setIsDoublePoints(false) }
      }

      if (hintCdRef.current > 0) { hintCdRef.current = Math.max(0, hintCdRef.current - dt); setHintCooldownMs(hintCdRef.current) }
      if (freezeCdRef.current > 0) { freezeCdRef.current = Math.max(0, freezeCdRef.current - dt); setFreezeCooldownMs(freezeCdRef.current) }
      if (doubleCdRef.current > 0) { doubleCdRef.current = Math.max(0, doubleCdRef.current - dt); setDoubleCooldownMs(doubleCdRef.current) }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); animFrameRef.current = null; return }
      animFrameRef.current = window.requestAnimationFrame(step)
    }
    animFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animFrameRef.current !== null) { window.cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
      lastFrameRef.current = null
    }
  }, [finishGame, playAudio, effects])

  // ── Derived ──
  const displayBest = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLow = remainingMs <= LOW_TIME_THRESHOLD_MS
  const diffMode = pickDifficultyMode(round)
  const comboLabel = getComboLabel(streak)
  const comboColor = getComboColor(streak)

  const gap = 2
  const gridPad = 8
  const maxW = 400
  const cellSize = Math.floor((maxW - gridPad * 2 - gap * (gridSize - 1)) / gridSize)

  const timerPct = (remainingMs / ROUND_DURATION_MS) * 100
  const timerColor = isLow ? '#e74c3c' : isTimeFrozen ? '#4a90d9' : '#6abf4b'

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
        ...effects.getShakeStyle(),
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
          padding: 10px 12px 8px;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 8px;
          box-shadow: 0 4px 0 #1a1425;
          position: relative;
          z-index: 2;
        }

        .dot-score-block { display: flex; flex-direction: column; gap: 1px; }
        .dot-score {
          font-size: clamp(16px, 5vw, 22px);
          font-weight: 900;
          color: #ffd700;
          margin: 0;
          text-shadow: 2px 2px 0 #8b6914;
          letter-spacing: 2px;
        }
        .dot-best {
          font-size: 7px;
          color: #a89cc8;
          margin: 0;
        }

        .dot-hud-right {
          display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
        }
        .dot-round-tag {
          background: #6abf4b;
          color: #fff;
          font-size: 7px;
          padding: 3px 6px;
          box-shadow: 2px 2px 0 #3d7a2e;
        }
        .dot-stars-tag {
          font-size: 7px;
          color: #facc15;
          text-shadow: 1px 1px 0 #8b6914;
        }

        .dot-timer-wrap {
          background: #2c2137;
          padding: 0 12px 6px;
          box-shadow: 0 4px 0 #1a1425;
          position: relative;
          z-index: 2;
        }
        .dot-timer-bar {
          height: 8px;
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
          font-size: 9px;
          color: #a89cc8;
          margin: 3px 0 0;
          font-variant-numeric: tabular-nums;
        }
        .dot-timer-text.low { color: #e74c3c; animation: dot-blink 0.4s step-end infinite; }
        .dot-timer-text.frozen { color: #4a90d9; }

        @keyframes dot-blink {
          0%, 49% { opacity: 1; }
          50%, 100% { opacity: 0.3; }
        }

        .dot-status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 4px 8px;
          min-height: 22px;
          flex-wrap: wrap;
          background: #2c2137;
          box-shadow: 0 4px 0 #1a1425;
          position: relative;
          z-index: 2;
        }
        .dot-tag {
          font-size: 7px;
          padding: 2px 6px;
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
            repeating-conic-gradient(${floorLight} 0% 25%, ${floorDark} 0% 50%) 0 0 / 16px 16px;
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

        .dot-powerups {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 12px;
          background: #2c2137;
          box-shadow: 0 -4px 0 #1a1425;
          position: relative;
          z-index: 2;
        }
        .dot-pw-btn {
          flex: 1;
          max-width: 110px;
          padding: 6px 4px;
          border: 2px solid #4a3f5c;
          background: #3d2f50;
          font-family: inherit;
          font-size: 7px;
          color: #d4c8e8;
          cursor: pointer;
          transition: all 0.1s step-end;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          -webkit-tap-highlight-color: transparent;
          image-rendering: pixelated;
        }
        .dot-pw-btn:disabled { opacity: 0.3; cursor: default; }
        .dot-pw-btn:not(:disabled):active { background: #5a4a70; border-color: #8a7aa0; }
        .dot-pw-btn.active { border-color: #ffd700; background: #4a3f5c; }
        .dot-pw-icon { font-size: 16px; line-height: 1; }
        .dot-pw-cd { font-size: 6px; color: #7a6e94; }

        .dot-feedback {
          min-height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 4px 12px;
          background: #2c2137;
        }
        .dot-fb-text {
          font-size: 10px;
          margin: 0;
          text-align: center;
          letter-spacing: 1px;
        }
        .dot-fb-text.correct { color: #6abf4b; animation: dot-fb-pop 0.25s step-end; }
        .dot-fb-text.wrong { color: #e74c3c; animation: dot-fb-shake 0.25s step-end; }
        .dot-fb-text.neutral { color: #7a6e94; font-size: 8px; }

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
          padding: 2px 12px;
          font-size: 6px;
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

        .dot-freeze-border {
          position: absolute; inset: 0;
          border: 4px solid rgba(74,144,217,0.4);
          pointer-events: none; z-index: 5;
          animation: dot-freeze-blink 0.5s step-end infinite;
        }
        @keyframes dot-freeze-blink {
          0%, 49% { border-color: rgba(74,144,217,0.4); }
          50%, 100% { border-color: rgba(74,144,217,0.15); }
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
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Pixel sparkles */}
      {pixelSparkles.map(s => (
        <div key={s.id} className="dot-sparkle" style={{ left: s.x, top: s.y, background: s.color }} />
      ))}

      {/* Fever banner */}
      {showFeverBanner && <div className="dot-fever-banner">FEVER!!</div>}

      {/* HUD */}
      <div className="dot-hud">
        <div className="dot-score-block">
          <p className="dot-score">{score.toLocaleString()}</p>
          <p className="dot-best">BEST {displayBest.toLocaleString()}</p>
        </div>
        <div className="dot-hud-right">
          <span className="dot-round-tag">R{round + 1} {gridSize}x{gridSize}</span>
          {starsCollected > 0 && <span className="dot-stars-tag">* x{starsCollected}</span>}
        </div>
      </div>

      {/* Timer */}
      <div className="dot-timer-wrap">
        <div className="dot-timer-bar">
          <div className="dot-timer-fill" style={{ width: `${timerPct}%`, backgroundColor: timerColor }} />
        </div>
        <p className={`dot-timer-text ${isLow ? 'low' : ''} ${isTimeFrozen ? 'frozen' : ''}`}>
          {isTimeFrozen ? 'FROZEN ' : ''}{(remainingMs / 1000).toFixed(1)}
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
        {isDoublePoints && (
          <span className="dot-tag" style={{ color: '#c084fc', background: 'rgba(192,132,252,0.15)' }}>x2 PTS</span>
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
        {isTimeFrozen && <div className="dot-freeze-border" />}
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
              isHinted={isHinting}
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

      {/* Powerups */}
      <div className="dot-powerups">
        <button className={`dot-pw-btn ${isHinting ? 'active' : ''}`} type="button" onClick={activateHint} disabled={hintCooldownMs > 0}>
          <span className="dot-pw-icon">?</span>
          <span>HINT</span>
          {hintCooldownMs > 0 && <span className="dot-pw-cd">{(hintCooldownMs / 1000).toFixed(0)}s</span>}
        </button>
        <button className={`dot-pw-btn ${isTimeFrozen ? 'active' : ''}`} type="button" onClick={activateFreeze} disabled={freezeCooldownMs > 0}>
          <span className="dot-pw-icon">#</span>
          <span>FREEZE</span>
          {freezeCooldownMs > 0 && <span className="dot-pw-cd">{(freezeCooldownMs / 1000).toFixed(0)}s</span>}
        </button>
        <button className={`dot-pw-btn ${isDoublePoints ? 'active' : ''}`} type="button" onClick={activateDouble} disabled={doubleCooldownMs > 0}>
          <span className="dot-pw-icon">x2</span>
          <span>DOUBLE</span>
          {doubleCooldownMs > 0 && <span className="dot-pw-cd">{(doubleCooldownMs / 1000).toFixed(0)}s</span>}
        </button>
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
