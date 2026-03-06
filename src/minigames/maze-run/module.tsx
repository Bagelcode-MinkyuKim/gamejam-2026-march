import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

import stepSfx from '../../../assets/sounds/maze-run-step.mp3'
import coinSfx from '../../../assets/sounds/maze-run-coin.mp3'
import clearSfx from '../../../assets/sounds/maze-run-clear.mp3'
import boostSfx from '../../../assets/sounds/maze-run-boost.mp3'
import gameoverSfx from '../../../assets/sounds/maze-run-gameover.mp3'
import wallHitSfx from '../../../assets/sounds/maze-run-wall-hit.mp3'
import timeWarnSfx from '../../../assets/sounds/maze-run-time-warning.mp3'
import comboSfx from '../../../assets/sounds/maze-run-combo.mp3'
import teleportSfx from '../../../assets/sounds/maze-run-teleport.mp3'
import timeBonusSfx from '../../../assets/sounds/maze-run-time-bonus.mp3'
import keySfx from '../../../assets/sounds/maze-run-key.mp3'
import chestSfx from '../../../assets/sounds/maze-run-chest.mp3'
import enemySfx from '../../../assets/sounds/maze-run-enemy.mp3'
import chainSfx from '../../../assets/sounds/maze-run-chain.mp3'
import levelupSfx from '../../../assets/sounds/maze-run-levelup.mp3'
import minimapSfx from '../../../assets/sounds/maze-run-minimap.mp3'

// ─── 8-bit Color Palette ─────────────────────────────────
const PAL = {
  bg: '#0f0b1a',
  wall: '#5b21b6',
  wallLight: '#7c3aed',
  floor: '#1a1033',
  player: '#facc15',
  playerLight: '#fde68a',
  exit: '#22c55e',
  exitLight: '#4ade80',
  coin: '#f59e0b',
  coinLight: '#fbbf24',
  key: '#e879f9',
  keyLight: '#f0abfc',
  chest: '#d97706',
  chestLight: '#fbbf24',
  boost: '#3b82f6',
  boostLight: '#60a5fa',
  trap: '#dc2626',
  trapLight: '#f87171',
  teleport: '#a855f7',
  teleportLight: '#c084fc',
  timeBonus: '#34d399',
  ghost: '#ef4444',
  ghostLight: '#fca5a5',
  text: '#e2e8f0',
  textDim: '#64748b',
  hud: '#1e1b4b',
  accent: '#6366f1',
} as const

// ─── Constants ────────────────────────────────────────────
const INITIAL_GRID_SIZE = 5
const MAX_GRID_SIZE = 9
const GRID_GROW_EVERY = 3
const ROUND_DURATION_MS = 60000
const CLEAR_BONUS_BASE = 25
const TIME_BONUS_MULTIPLIER = 0.5
const CELL_PX = 32
const WALL_PX = 4
const MOVE_COOLDOWN_MS = 95
const PIXEL = 2 // base pixel unit for dot-art rendering

const COIN_SCORE = 10
const COIN_SPAWN_CHANCE = 0.3
const SPEED_BOOST_DURATION_MS = 5000
const SPEED_BOOST_COOLDOWN_MS = 35
const SPEED_BOOST_SPAWN_CHANCE = 0.15
const STREAK_MULTIPLIER_STEP = 3
const MAX_STREAK_MULTIPLIER = 5

const TIME_BONUS_MS = 5000
const TIME_BONUS_SCORE = 5
const TIME_BONUS_SPAWN_CHANCE = 0.15
const TRAP_PENALTY_MS = 3000
const TRAP_SPAWN_CHANCE = 0.08
const TELEPORTER_SPAWN_CHANCE = 0.2

const KEY_SPAWN_FROM_LEVEL = 2
const CHEST_SPAWN_CHANCE = 0.12
const CHEST_SCORE_MIN = 15
const CHEST_SCORE_MAX = 50
const GHOST_SPAWN_FROM_LEVEL = 4
const GHOST_SPEED = 0.0015 // cells per ms
const GHOST_PENALTY_MS = 4000
const COMBO_TIMEOUT_MS = 2000

const SWIPE_THRESHOLD = 30

// ─── Types & Helpers ─────────────────────────────────────
const DIR_UP = 0
const DIR_RIGHT = 1
const DIR_DOWN = 2
const DIR_LEFT = 3
type Direction = typeof DIR_UP | typeof DIR_RIGHT | typeof DIR_DOWN | typeof DIR_LEFT
const DX: readonly number[] = [0, 1, 0, -1]
const DY: readonly number[] = [-1, 0, 1, 0]

interface Cell { readonly walls: [boolean, boolean, boolean, boolean] }
interface MazeGrid {
  readonly cells: Cell[][]
  readonly startRow: number; readonly startCol: number
  readonly exitRow: number; readonly exitCol: number
}
interface CoinItem { readonly row: number; readonly col: number; collected: boolean }
interface SpeedBoost { readonly row: number; readonly col: number; collected: boolean }
interface TimeBonusItem { readonly row: number; readonly col: number; collected: boolean }
interface TrapItem { readonly row: number; readonly col: number; triggered: boolean }
interface Teleporter { readonly row1: number; readonly col1: number; readonly row2: number; readonly col2: number }
interface KeyItem { readonly row: number; readonly col: number; collected: boolean }
interface ChestItem { readonly row: number; readonly col: number; opened: boolean; readonly reward: number }
interface GhostEntity { row: number; col: number; targetRow: number; targetCol: number; moveTimer: number }
interface TrailPoint { readonly x: number; readonly y: number; readonly age: number }

function getGridSize(mazesCleared: number): number {
  return Math.min(MAX_GRID_SIZE, INITIAL_GRID_SIZE + Math.floor(mazesCleared / GRID_GROW_EVERY))
}
function getGridMetrics(gridSize: number) {
  const cellTotalPx = CELL_PX + WALL_PX
  return { cellTotalPx, gridTotalPx: gridSize * cellTotalPx + WALL_PX }
}
function oppositeDirection(dir: Direction): Direction { return ((dir + 2) % 4) as Direction }

function shuffleArray<T>(arr: T[]): T[] {
  const s = [...arr]
  for (let i = s.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [s[i], s[j]] = [s[j], s[i]]
  }
  return s
}

function generateMaze(gridSize: number): MazeGrid {
  const cells: { walls: [boolean, boolean, boolean, boolean] }[][] = []
  for (let r = 0; r < gridSize; r++) {
    const row: { walls: [boolean, boolean, boolean, boolean] }[] = []
    for (let c = 0; c < gridSize; c++) row.push({ walls: [true, true, true, true] })
    cells.push(row)
  }
  const visited: boolean[][] = Array.from({ length: gridSize }, () => new Array(gridSize).fill(false))
  const stack: [number, number][] = [[0, 0]]
  visited[0][0] = true
  while (stack.length > 0) {
    const [cr, cc] = stack[stack.length - 1]
    const dirs = shuffleArray<Direction>([DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT])
    let found = false
    for (const d of dirs) {
      const nr = cr + DY[d], nc = cc + DX[d]
      if (nr < 0 || nr >= gridSize || nc < 0 || nc >= gridSize || visited[nr][nc]) continue
      cells[cr][cc].walls[d] = false
      cells[nr][nc].walls[oppositeDirection(d)] = false
      visited[nr][nc] = true
      stack.push([nr, nc])
      found = true
      break
    }
    if (!found) stack.pop()
  }
  return { cells, startRow: 0, startCol: 0, exitRow: gridSize - 1, exitCol: gridSize - 1 }
}

function isSpecial(r: number, c: number, sR: number, sC: number, eR: number, eC: number) {
  return (r === sR && c === sC) || (r === eR && c === eC)
}

function randomCell(gs: number, sR: number, sC: number, eR: number, eC: number, avoid: Set<string>): [number, number] | null {
  for (let i = 0; i < 40; i++) {
    const r = Math.floor(Math.random() * gs), c = Math.floor(Math.random() * gs)
    if (isSpecial(r, c, sR, sC, eR, eC) || avoid.has(`${r},${c}`)) continue
    return [r, c]
  }
  return null
}

function generateCoins(gs: number, sR: number, sC: number, eR: number, eC: number): CoinItem[] {
  const coins: CoinItem[] = []
  for (let r = 0; r < gs; r++)
    for (let c = 0; c < gs; c++) {
      if (isSpecial(r, c, sR, sC, eR, eC)) continue
      if (Math.random() < COIN_SPAWN_CHANCE) coins.push({ row: r, col: c, collected: false })
    }
  return coins
}

function generateSpeedBoost(gs: number, sR: number, sC: number, eR: number, eC: number): SpeedBoost | null {
  if (Math.random() > SPEED_BOOST_SPAWN_CHANCE) return null
  const cell = randomCell(gs, sR, sC, eR, eC, new Set())
  return cell ? { row: cell[0], col: cell[1], collected: false } : null
}

function generateTimeBonus(gs: number, sR: number, sC: number, eR: number, eC: number): TimeBonusItem | null {
  if (Math.random() > TIME_BONUS_SPAWN_CHANCE) return null
  const cell = randomCell(gs, sR, sC, eR, eC, new Set())
  return cell ? { row: cell[0], col: cell[1], collected: false } : null
}

function generateTraps(gs: number, sR: number, sC: number, eR: number, eC: number): TrapItem[] {
  const traps: TrapItem[] = []
  for (let r = 0; r < gs; r++)
    for (let c = 0; c < gs; c++) {
      if (isSpecial(r, c, sR, sC, eR, eC)) continue
      if (Math.random() < TRAP_SPAWN_CHANCE) traps.push({ row: r, col: c, triggered: false })
    }
  return traps
}

function generateTeleporter(gs: number, sR: number, sC: number, eR: number, eC: number): Teleporter | null {
  if (gs < 6 || Math.random() > TELEPORTER_SPAWN_CHANCE) return null
  const avoid = new Set<string>()
  const c1 = randomCell(gs, sR, sC, eR, eC, avoid)
  if (!c1) return null
  avoid.add(`${c1[0]},${c1[1]}`)
  const c2 = randomCell(gs, sR, sC, eR, eC, avoid)
  if (!c2 || Math.abs(c1[0] - c2[0]) + Math.abs(c1[1] - c2[1]) < 3) return null
  return { row1: c1[0], col1: c1[1], row2: c2[0], col2: c2[1] }
}

function generateKey(gs: number, sR: number, sC: number, eR: number, eC: number, level: number): KeyItem | null {
  if (level < KEY_SPAWN_FROM_LEVEL) return null
  const cell = randomCell(gs, sR, sC, eR, eC, new Set())
  return cell ? { row: cell[0], col: cell[1], collected: false } : null
}

function generateChests(gs: number, sR: number, sC: number, eR: number, eC: number): ChestItem[] {
  const chests: ChestItem[] = []
  for (let r = 0; r < gs; r++)
    for (let c = 0; c < gs; c++) {
      if (isSpecial(r, c, sR, sC, eR, eC)) continue
      if (Math.random() < CHEST_SPAWN_CHANCE)
        chests.push({ row: r, col: c, opened: false, reward: CHEST_SCORE_MIN + Math.floor(Math.random() * (CHEST_SCORE_MAX - CHEST_SCORE_MIN)) })
    }
  return chests
}

function generateGhost(gs: number, sR: number, sC: number, eR: number, eC: number, level: number): GhostEntity | null {
  if (level < GHOST_SPAWN_FROM_LEVEL) return null
  const cell = randomCell(gs, sR, sC, eR, eC, new Set())
  if (!cell) return null
  return { row: cell[0], col: cell[1], targetRow: sR, targetCol: sC, moveTimer: 0 }
}

function canMove(maze: MazeGrid, row: number, col: number, dir: Direction): boolean {
  const gs = maze.cells.length
  if (row < 0 || row >= gs || col < 0 || col >= gs) return false
  return !maze.cells[row][col].walls[dir]
}

function cellCenterX(col: number, ctp: number): number { return WALL_PX + col * ctp + CELL_PX / 2 }
function cellCenterY(row: number, ctp: number): number { return WALL_PX + row * ctp + CELL_PX / 2 }

// ─── Pixel Art Renderers (SVG) ───────────────────────────

// Draws a pixel-art square character
function PixelPlayer({ cx, cy, boosted, bumpX, bumpY }: { cx: number; cy: number; boosted: boolean; bumpX: number; bumpY: number }) {
  const p = PIXEL
  const x = cx + bumpX - 6 * p
  const y = cy + bumpY - 6 * p
  const body = boosted ? PAL.boost : PAL.player
  const light = boosted ? PAL.boostLight : PAL.playerLight
  return (
    <g>
      {/* body */}
      <rect x={x + 2 * p} y={y + 1 * p} width={8 * p} height={10 * p} fill={body} />
      {/* highlight */}
      <rect x={x + 3 * p} y={y + 2 * p} width={3 * p} height={2 * p} fill={light} opacity="0.7" />
      {/* eyes */}
      <rect x={x + 3 * p} y={y + 4 * p} width={2 * p} height={2 * p} fill={PAL.bg} />
      <rect x={x + 7 * p} y={y + 4 * p} width={2 * p} height={2 * p} fill={PAL.bg} />
      {/* eye shine */}
      <rect x={x + 3 * p} y={y + 4 * p} width={p} height={p} fill="#fff" />
      <rect x={x + 7 * p} y={y + 4 * p} width={p} height={p} fill="#fff" />
      {/* mouth */}
      <rect x={x + 4 * p} y={y + 7 * p} width={4 * p} height={p} fill={PAL.bg} />
      {/* feet */}
      <rect x={x + 2 * p} y={y + 11 * p} width={3 * p} height={p} fill={body} />
      <rect x={x + 7 * p} y={y + 11 * p} width={3 * p} height={p} fill={body} />
      {boosted && (
        <rect x={x} y={y} width={12 * p} height={12 * p} fill="none" stroke={PAL.boostLight} strokeWidth={p} opacity="0.5">
          <animate attributeName="opacity" values="0.5;0.2;0.5" dur="0.4s" repeatCount="indefinite" />
        </rect>
      )}
    </g>
  )
}

function PixelCoin({ cx, cy, frame }: { cx: number; cy: number; frame: number }) {
  const p = PIXEL
  const stretch = Math.abs(Math.sin(frame * 0.05)) * 2
  return (
    <g>
      <rect x={cx - 3 * p + stretch * 0.5} y={cy - 3 * p} width={6 * p - stretch} height={6 * p} rx={p} fill={PAL.coin} />
      <rect x={cx - p + stretch * 0.3} y={cy - 2 * p} width={2 * p} height={2 * p} fill={PAL.coinLight} opacity="0.6" />
    </g>
  )
}

function PixelKey({ cx, cy, frame }: { cx: number; cy: number; frame: number }) {
  const p = PIXEL
  const bob = Math.sin(frame * 0.06) * 2
  return (
    <g transform={`translate(0,${bob})`}>
      {/* head */}
      <rect x={cx - 3 * p} y={cy - 4 * p} width={6 * p} height={4 * p} rx={p} fill={PAL.key} />
      <rect x={cx - p} y={cy - 3 * p} width={2 * p} height={2 * p} fill={PAL.bg} />
      {/* shaft */}
      <rect x={cx - p} y={cy} width={2 * p} height={5 * p} fill={PAL.keyLight} />
      {/* teeth */}
      <rect x={cx + p} y={cy + 3 * p} width={2 * p} height={p} fill={PAL.keyLight} />
      <rect x={cx + p} y={cy + p} width={2 * p} height={p} fill={PAL.keyLight} />
    </g>
  )
}

function PixelChest({ cx, cy, opened }: { cx: number; cy: number; opened: boolean }) {
  const p = PIXEL
  return (
    <g>
      <rect x={cx - 5 * p} y={cy - 3 * p} width={10 * p} height={6 * p} fill={opened ? PAL.textDim : PAL.chest} />
      <rect x={cx - 5 * p} y={cy - 3 * p} width={10 * p} height={2 * p} fill={opened ? PAL.textDim : PAL.chestLight} />
      <rect x={cx - p} y={cy - 2 * p} width={2 * p} height={2 * p} fill={opened ? PAL.textDim : '#fff'} />
      {!opened && <rect x={cx - 4 * p} y={cy - p} width={8 * p} height={p} fill={PAL.bg} opacity="0.3" />}
    </g>
  )
}

function PixelGhost({ cx, cy, frame }: { cx: number; cy: number; frame: number }) {
  const p = PIXEL
  const wobble = Math.sin(frame * 0.08) * p
  return (
    <g>
      {/* body */}
      <rect x={cx - 5 * p} y={cy - 5 * p + wobble} width={10 * p} height={8 * p} rx={2 * p} fill={PAL.ghost} opacity="0.85" />
      {/* tail */}
      <rect x={cx - 5 * p} y={cy + 3 * p + wobble} width={3 * p} height={2 * p} fill={PAL.ghost} opacity="0.85" />
      <rect x={cx - p} y={cy + 3 * p + wobble} width={3 * p} height={3 * p} fill={PAL.ghost} opacity="0.85" />
      <rect x={cx + 3 * p} y={cy + 3 * p + wobble} width={3 * p} height={2 * p} fill={PAL.ghost} opacity="0.85" />
      {/* eyes */}
      <rect x={cx - 3 * p} y={cy - 3 * p + wobble} width={3 * p} height={3 * p} fill="#fff" />
      <rect x={cx + p} y={cy - 3 * p + wobble} width={3 * p} height={3 * p} fill="#fff" />
      <rect x={cx - 2 * p} y={cy - 2 * p + wobble} width={2 * p} height={2 * p} fill={PAL.bg} />
      <rect x={cx + 2 * p} y={cy - 2 * p + wobble} width={2 * p} height={2 * p} fill={PAL.bg} />
    </g>
  )
}

function PixelExit({ cx, cy, locked, frame }: { cx: number; cy: number; locked: boolean; frame: number }) {
  const p = PIXEL
  const pulse = 0.5 + Math.sin(frame * 0.04) * 0.3
  const color = locked ? PAL.trapLight : PAL.exit
  const light = locked ? PAL.trap : PAL.exitLight
  return (
    <g>
      <rect x={cx - 6 * p} y={cy - 6 * p} width={12 * p} height={12 * p} rx={2 * p} fill={color} opacity={pulse} />
      <rect x={cx - 4 * p} y={cy - 4 * p} width={8 * p} height={8 * p} rx={p} fill={light} opacity="0.8" />
      {locked ? (
        <>
          <rect x={cx - 2 * p} y={cy - p} width={4 * p} height={4 * p} fill={PAL.bg} />
          <rect x={cx - p} y={cy - 3 * p} width={2 * p} height={3 * p} rx={p} fill="none" stroke={PAL.bg} strokeWidth={p} />
        </>
      ) : (
        <>
          <rect x={cx - 2 * p} y={cy - 3 * p} width={p} height={6 * p} fill="#fff" opacity="0.6" />
          <rect x={cx + p} y={cy - 3 * p} width={p} height={6 * p} fill="#fff" opacity="0.6" />
          <rect x={cx - p} y={cy + p} width={2 * p} height={2 * p} fill="#fff" opacity="0.4" />
        </>
      )}
    </g>
  )
}

// ─── Game Component ──────────────────────────────────────
function MazeRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const initialGridSize = getGridSize(0)
  const [maze, setMaze] = useState<MazeGrid>(() => generateMaze(initialGridSize))
  const [playerRow, setPlayerRow] = useState(0)
  const [playerCol, setPlayerCol] = useState(0)
  const [score, setScore] = useState(0)
  const [mazesCleared, setMazesCleared] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [flashClear, setFlashClear] = useState(false)
  const [currentGridSize, setCurrentGridSize] = useState(initialGridSize)
  const [coins, setCoins] = useState<CoinItem[]>(() => generateCoins(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [speedBoost, setSpeedBoost] = useState<SpeedBoost | null>(() => generateSpeedBoost(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [isSpeedBoosted, setIsSpeedBoosted] = useState(false)
  const [coinsCollected, setCoinsCollected] = useState(0)
  const [timeBonus, setTimeBonus] = useState<TimeBonusItem | null>(() => generateTimeBonus(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [traps, setTraps] = useState<TrapItem[]>(() => generateTraps(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [teleporter, setTeleporter] = useState<Teleporter | null>(() => generateTeleporter(initialGridSize, 0, 0, initialGridSize - 1, initialGridSize - 1))
  const [trail, setTrail] = useState<TrailPoint[]>([])
  const [wallBumpDir, setWallBumpDir] = useState<Direction | null>(null)
  const [trapFlash, setTrapFlash] = useState(false)
  const [, setTimeWarningPlayed] = useState(false)
  const [keyItem, setKeyItem] = useState<KeyItem | null>(null)
  const [hasKey, setHasKey] = useState(true) // no key needed at start
  const [chests, setChests] = useState<ChestItem[]>([])
  const [ghost, setGhost] = useState<GhostEntity | null>(null)
  const [combo, setCombo] = useState(0)
  const [animFrame, setAnimFrame] = useState(0)
  const [showMinimap, setShowMinimap] = useState(false)

  const effects = useGameEffects()

  // Refs for game loop
  const mazeRef = useRef<MazeGrid>(maze)
  const playerRowRef = useRef(0)
  const playerColRef = useRef(0)
  const scoreRef = useRef(0)
  const mazesClearedRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animFrameIdRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const lastMoveAtRef = useRef(0)
  const clearFlashTimerRef = useRef<number | null>(null)
  const currentGridSizeRef = useRef(initialGridSize)
  const coinsRef = useRef<CoinItem[]>(coins)
  const speedBoostRef = useRef<SpeedBoost | null>(speedBoost)
  const speedBoostTimerRef = useRef(0)
  const coinsCollectedRef = useRef(0)
  const timeBonusRef = useRef<TimeBonusItem | null>(timeBonus)
  const trapsRef = useRef<TrapItem[]>(traps)
  const teleporterRef = useRef<Teleporter | null>(teleporter)
  const trailRef = useRef<TrailPoint[]>([])
  const timeWarningPlayedRef = useRef(false)
  const keyRef = useRef<KeyItem | null>(null)
  const hasKeyRef = useRef(true)
  const chestsRef = useRef<ChestItem[]>([])
  const ghostRef = useRef<GhostEntity | null>(null)
  const comboRef = useRef(0)
  const lastCoinAtRef = useRef(0)
  const animFrameRef = useRef(0)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const audioPoolRef = useRef<Record<string, HTMLAudioElement>>({})

  const loadAudio = useCallback((key: string, src: string) => {
    if (!audioPoolRef.current[key]) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioPoolRef.current[key] = a
    }
  }, [])

  const playSfx = useCallback((key: string, volume = 0.5, rate = 1) => {
    const a = audioPoolRef.current[key]
    if (!a) return
    a.currentTime = 0
    a.volume = Math.min(1, volume)
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  // Load all audio on mount
  useEffect(() => {
    const sfxList: [string, string][] = [
      ['step', stepSfx], ['coin', coinSfx], ['clear', clearSfx], ['boost', boostSfx],
      ['gameover', gameoverSfx], ['wallHit', wallHitSfx], ['timeWarn', timeWarnSfx],
      ['combo', comboSfx], ['teleport', teleportSfx], ['timeBonus', timeBonusSfx],
      ['key', keySfx], ['chest', chestSfx], ['enemy', enemySfx],
      ['chain', chainSfx], ['levelup', levelupSfx], ['minimap', minimapSfx],
    ]
    for (const [k, s] of sfxList) loadAudio(k, s)
    return () => {
      for (const a of Object.values(audioPoolRef.current)) { a.pause(); a.currentTime = 0 }
      if (clearFlashTimerRef.current !== null) window.clearTimeout(clearFlashTimerRef.current)
      effects.cleanup()
    }
  }, [])

  const spawnLevel = useCallback((level: number) => {
    const gs = getGridSize(level)
    currentGridSizeRef.current = gs
    setCurrentGridSize(gs)
    const m = generateMaze(gs)
    mazeRef.current = m
    setMaze(m)
    const { startRow: sR, startCol: sC, exitRow: eR, exitCol: eC } = m

    coinsRef.current = generateCoins(gs, sR, sC, eR, eC); setCoins([...coinsRef.current])
    speedBoostRef.current = generateSpeedBoost(gs, sR, sC, eR, eC); setSpeedBoost(speedBoostRef.current)
    timeBonusRef.current = generateTimeBonus(gs, sR, sC, eR, eC); setTimeBonus(timeBonusRef.current)
    trapsRef.current = generateTraps(gs, sR, sC, eR, eC); setTraps([...trapsRef.current])
    teleporterRef.current = generateTeleporter(gs, sR, sC, eR, eC); setTeleporter(teleporterRef.current)

    const k = generateKey(gs, sR, sC, eR, eC, level)
    keyRef.current = k; setKeyItem(k)
    hasKeyRef.current = k === null; setHasKey(k === null) // no key = exit open from start

    chestsRef.current = generateChests(gs, sR, sC, eR, eC); setChests([...chestsRef.current])
    ghostRef.current = generateGhost(gs, sR, sC, eR, eC, level); setGhost(ghostRef.current ? { ...ghostRef.current } : null)

    playerRowRef.current = sR; playerColRef.current = sC
    setPlayerRow(sR); setPlayerCol(sC)
    trailRef.current = []; setTrail([])
    comboRef.current = 0; setCombo(0)
  }, [])

  const advanceMaze = useCallback(() => {
    const nextCleared = mazesClearedRef.current + 1
    mazesClearedRef.current = nextCleared
    setMazesCleared(nextCleared)

    const timeLeft = remainingMsRef.current
    const timeBonusVal = Math.floor((timeLeft / 1000) * TIME_BONUS_MULTIPLIER)
    const streakMul = Math.min(MAX_STREAK_MULTIPLIER, 1 + Math.floor(nextCleared / STREAK_MULTIPLIER_STEP))
    const clearScore = (CLEAR_BONUS_BASE + timeBonusVal) * streakMul
    scoreRef.current += clearScore; setScore(scoreRef.current)

    spawnLevel(nextCleared)

    setFlashClear(true)
    if (clearFlashTimerRef.current !== null) window.clearTimeout(clearFlashTimerRef.current)
    clearFlashTimerRef.current = window.setTimeout(() => { clearFlashTimerRef.current = null; setFlashClear(false) }, 400)

    if (nextCleared % 5 === 0) {
      playSfx('levelup', 0.6, 1)
    } else {
      playSfx('clear', 0.6, 1 + nextCleared * 0.03)
    }
    if (streakMul > 1) playSfx('combo', 0.4, 1 + nextCleared * 0.04)

    const { cellTotalPx } = getGridMetrics(getGridSize(nextCleared))
    effects.comboHitBurst(cellCenterX(0, cellTotalPx), cellCenterY(0, cellTotalPx), nextCleared, clearScore)
    effects.triggerFlash(streakMul > 1 ? 'rgba(250,204,21,0.35)' : 'rgba(34,197,94,0.25)')
  }, [playSfx, effects, spawnLevel])

  const movePlayer = useCallback((dir: Direction) => {
    if (finishedRef.current) return
    const now = performance.now()
    const cooldown = speedBoostTimerRef.current > 0 ? SPEED_BOOST_COOLDOWN_MS : MOVE_COOLDOWN_MS
    if (now - lastMoveAtRef.current < cooldown) return

    const cr = playerRowRef.current, cc = playerColRef.current
    if (!canMove(mazeRef.current, cr, cc, dir)) {
      playSfx('wallHit', 0.25, 0.7 + Math.random() * 0.4)
      setWallBumpDir(dir); setTimeout(() => setWallBumpDir(null), 120)
      effects.triggerShake(3)
      // combo break on wall hit
      if (comboRef.current > 0) { comboRef.current = 0; setCombo(0) }
      return
    }

    lastMoveAtRef.current = now
    const nr = cr + DY[dir], nc = cc + DX[dir]
    playerRowRef.current = nr; playerColRef.current = nc
    setPlayerRow(nr); setPlayerCol(nc)
    playSfx('step', 0.2, 0.9 + Math.random() * 0.2)

    const { cellTotalPx: ctp } = getGridMetrics(currentGridSizeRef.current)

    // Trail
    const newTrail = [...trailRef.current, { x: cellCenterX(cc, ctp), y: cellCenterY(cr, ctp), age: 0 }]
    if (newTrail.length > 25) newTrail.shift()
    trailRef.current = newTrail; setTrail([...newTrail])

    // Coins
    for (const coin of coinsRef.current) {
      if (!coin.collected && coin.row === nr && coin.col === nc) {
        coin.collected = true
        const timeSinceLast = now - lastCoinAtRef.current
        lastCoinAtRef.current = now
        if (timeSinceLast < COMBO_TIMEOUT_MS) {
          comboRef.current += 1; setCombo(comboRef.current)
          if (comboRef.current >= 3) playSfx('chain', 0.4, 1 + comboRef.current * 0.1)
        } else {
          comboRef.current = 1; setCombo(1)
        }
        const comboBonus = Math.floor(COIN_SCORE * (1 + comboRef.current * 0.2))
        scoreRef.current += comboBonus; setScore(scoreRef.current)
        coinsCollectedRef.current += 1; setCoinsCollected(coinsCollectedRef.current)
        setCoins([...coinsRef.current])
        playSfx('coin', 0.4, 1.1 + comboRef.current * 0.08)
        effects.showScorePopup(comboBonus, cellCenterX(nc, ctp), cellCenterY(nr, ctp) - 10)
      }
    }

    // Speed boost
    const boost = speedBoostRef.current
    if (boost && !boost.collected && boost.row === nr && boost.col === nc) {
      boost.collected = true
      speedBoostTimerRef.current = SPEED_BOOST_DURATION_MS
      setIsSpeedBoosted(true); setSpeedBoost({ ...boost, collected: true })
      playSfx('boost', 0.5, 1.2)
      effects.triggerFlash('rgba(59,130,246,0.25)')
    }

    // Time bonus
    const tb = timeBonusRef.current
    if (tb && !tb.collected && tb.row === nr && tb.col === nc) {
      tb.collected = true
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
      setRemainingMs(remainingMsRef.current)
      scoreRef.current += TIME_BONUS_SCORE; setScore(scoreRef.current)
      setTimeBonus({ ...tb, collected: true })
      playSfx('timeBonus', 0.5, 1.1)
      effects.triggerFlash('rgba(52,211,153,0.2)')
      effects.showScorePopup(TIME_BONUS_SCORE, cellCenterX(nc, ctp), cellCenterY(nr, ctp) - 10)
    }

    // Traps
    for (const trap of trapsRef.current) {
      if (!trap.triggered && trap.row === nr && trap.col === nc) {
        trap.triggered = true
        remainingMsRef.current = Math.max(0, remainingMsRef.current - TRAP_PENALTY_MS)
        setRemainingMs(remainingMsRef.current); setTraps([...trapsRef.current])
        playSfx('enemy', 0.5, 0.6)
        effects.triggerShake(10); effects.triggerFlash('rgba(239,68,68,0.4)')
        setTrapFlash(true); setTimeout(() => setTrapFlash(false), 300)
        comboRef.current = 0; setCombo(0)
      }
    }

    // Key pickup
    const k = keyRef.current
    if (k && !k.collected && k.row === nr && k.col === nc) {
      k.collected = true; hasKeyRef.current = true
      setKeyItem({ ...k, collected: true }); setHasKey(true)
      playSfx('key', 0.5, 1.2)
      effects.triggerFlash('rgba(232,121,249,0.3)')
      effects.showScorePopup(0, cellCenterX(nc, ctp), cellCenterY(nr, ctp) - 10)
    }

    // Chests
    for (const chest of chestsRef.current) {
      if (!chest.opened && chest.row === nr && chest.col === nc) {
        chest.opened = true
        scoreRef.current += chest.reward; setScore(scoreRef.current)
        setChests([...chestsRef.current])
        playSfx('chest', 0.5, 1)
        effects.showScorePopup(chest.reward, cellCenterX(nc, ctp), cellCenterY(nr, ctp) - 10)
        effects.comboHitBurst(cellCenterX(nc, ctp), cellCenterY(nr, ctp), 3, chest.reward)
      }
    }

    // Teleporter
    const tp = teleporterRef.current
    if (tp) {
      let teleported = false
      if (nr === tp.row1 && nc === tp.col1) {
        playerRowRef.current = tp.row2; playerColRef.current = tp.col2
        setPlayerRow(tp.row2); setPlayerCol(tp.col2); teleported = true
      } else if (nr === tp.row2 && nc === tp.col2) {
        playerRowRef.current = tp.row1; playerColRef.current = tp.col1
        setPlayerRow(tp.row1); setPlayerCol(tp.col1); teleported = true
      }
      if (teleported) {
        playSfx('teleport', 0.5, 1)
        effects.triggerFlash('rgba(168,85,247,0.3)')
      }
    }

    // Exit check
    const fr = playerRowRef.current, fc = playerColRef.current
    if (fr === mazeRef.current.exitRow && fc === mazeRef.current.exitCol && hasKeyRef.current) {
      advanceMaze()
    }
  }, [advanceMaze, playSfx, effects])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    playSfx('gameover', 0.6, 0.9)
    onFinish({ score: scoreRef.current, durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)) })
  }, [onFinish, playSfx])

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (finishedRef.current) return
      switch (e.code) {
        case 'Escape': e.preventDefault(); onExit(); break
        case 'ArrowUp': case 'KeyW': e.preventDefault(); movePlayer(DIR_UP); break
        case 'ArrowRight': case 'KeyD': e.preventDefault(); movePlayer(DIR_RIGHT); break
        case 'ArrowDown': case 'KeyS': e.preventDefault(); movePlayer(DIR_DOWN); break
        case 'ArrowLeft': case 'KeyA': e.preventDefault(); movePlayer(DIR_LEFT); break
        case 'KeyM': e.preventDefault(); setShowMinimap(v => { if (!v) playSfx('minimap', 0.4); return !v }); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [movePlayer, onExit, playSfx])

  // Touch swipe
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y
    touchStartRef.current = null
    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) return
    if (Math.abs(dx) > Math.abs(dy)) movePlayer(dx > 0 ? DIR_RIGHT : DIR_LEFT)
    else movePlayer(dy > 0 ? DIR_DOWN : DIR_UP)
  }, [movePlayer])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null
    const step = (now: number) => {
      if (finishedRef.current) { animFrameIdRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const dt = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - dt)
      setRemainingMs(remainingMsRef.current)

      // Speed boost timer
      if (speedBoostTimerRef.current > 0) {
        speedBoostTimerRef.current = Math.max(0, speedBoostTimerRef.current - dt)
        if (speedBoostTimerRef.current <= 0) setIsSpeedBoosted(false)
      }

      // Trail aging
      if (trailRef.current.length > 0) {
        trailRef.current = trailRef.current.map(t => ({ ...t, age: t.age + dt })).filter(t => t.age < 600)
        setTrail([...trailRef.current])
      }

      // Ghost AI
      const g = ghostRef.current
      if (g) {
        g.targetRow = playerRowRef.current
        g.targetCol = playerColRef.current
        g.moveTimer += dt
        const moveInterval = 1 / GHOST_SPEED
        if (g.moveTimer >= moveInterval) {
          g.moveTimer -= moveInterval
          // Simple pathfinding: try to move toward player
          const dirs: Direction[] = []
          if (g.targetRow < g.row) dirs.push(DIR_UP)
          if (g.targetRow > g.row) dirs.push(DIR_DOWN)
          if (g.targetCol < g.col) dirs.push(DIR_LEFT)
          if (g.targetCol > g.col) dirs.push(DIR_RIGHT)
          const shuffled = shuffleArray([...dirs, ...shuffleArray<Direction>([DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT])])
          for (const d of shuffled) {
            if (canMove(mazeRef.current, g.row, g.col, d)) {
              g.row += DY[d]; g.col += DX[d]
              break
            }
          }
          // Check collision with player
          if (g.row === playerRowRef.current && g.col === playerColRef.current) {
            remainingMsRef.current = Math.max(0, remainingMsRef.current - GHOST_PENALTY_MS)
            setRemainingMs(remainingMsRef.current)
            playSfx('enemy', 0.6, 0.8)
            effects.triggerShake(12)
            effects.triggerFlash('rgba(239,68,68,0.5)')
            // Respawn ghost far from player
            const gs = currentGridSizeRef.current
            g.row = Math.floor(Math.random() * gs)
            g.col = Math.floor(Math.random() * gs)
          }
          setGhost({ ...g })
        }
      }

      // Time warning
      if (remainingMsRef.current <= 10000 && !timeWarningPlayedRef.current) {
        timeWarningPlayedRef.current = true
        setTimeWarningPlayed(true)
        playSfx('timeWarn', 0.5, 1)
      }

      // Anim frame counter
      animFrameRef.current += 1
      setAnimFrame(animFrameRef.current)

      effects.updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); animFrameIdRef.current = null; return }
      animFrameIdRef.current = window.requestAnimationFrame(step)
    }
    animFrameIdRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animFrameIdRef.current !== null) window.cancelAnimationFrame(animFrameIdRef.current)
      lastFrameAtRef.current = null
    }
  }, [finishGame, playSfx, effects])

  // ─── Derived ───────────────────────────────────────────
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= 10000
  const comboLabel = getComboLabel(mazesCleared)
  const comboColor = getComboColor(mazesCleared)
  const gridSize = currentGridSize
  const { cellTotalPx, gridTotalPx } = getGridMetrics(gridSize)
  const streakMul = Math.min(MAX_STREAK_MULTIPLIER, 1 + Math.floor(mazesCleared / STREAK_MULTIPLIER_STEP))
  const timePercent = (remainingMs / ROUND_DURATION_MS) * 100

  const mazeWalls = useMemo(() => {
    const gs = maze.cells.length
    const { cellTotalPx: ctp, gridTotalPx: gtp } = getGridMetrics(gs)
    const walls: { key: string; x: number; y: number; w: number; h: number }[] = []
    walls.push({ key: 'bt', x: 0, y: 0, w: gtp, h: WALL_PX })
    walls.push({ key: 'bb', x: 0, y: gtp - WALL_PX, w: gtp, h: WALL_PX })
    walls.push({ key: 'bl', x: 0, y: 0, w: WALL_PX, h: gtp })
    walls.push({ key: 'br', x: gtp - WALL_PX, y: 0, w: WALL_PX, h: gtp })
    for (let r = 0; r < gs; r++)
      for (let c = 0; c < gs; c++) {
        const cell = maze.cells[r][c]
        const cx = WALL_PX + c * ctp, cy = WALL_PX + r * ctp
        if (cell.walls[DIR_RIGHT] && c < gs - 1) walls.push({ key: `r${r}${c}`, x: cx + CELL_PX, y: cy, w: WALL_PX, h: CELL_PX })
        if (cell.walls[DIR_DOWN] && r < gs - 1) walls.push({ key: `d${r}${c}`, x: cx, y: cy + CELL_PX, w: CELL_PX, h: WALL_PX })
      }
    return walls
  }, [maze])

  const px = cellCenterX(playerCol, cellTotalPx)
  const py = cellCenterY(playerRow, cellTotalPx)
  const ex = cellCenterX(maze.exitCol, cellTotalPx)
  const ey = cellCenterY(maze.exitRow, cellTotalPx)
  let bumpX = 0, bumpY = 0
  if (wallBumpDir !== null) { bumpX = DX[wallBumpDir] * 3; bumpY = DY[wallBumpDir] * 3 }

  // Minimap
  const minimapSize = 60
  void minimapSize

  return (
    <section
      className="mini-game-panel mr-panel"
      aria-label="maze-run-game"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .mr-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: ${PAL.bg};
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          padding: 0;
          gap: 0;
          image-rendering: pixelated;
          font-family: 'Courier New', monospace;
        }

        .mr-topbar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: ${PAL.hud};
          border-bottom: 3px solid ${PAL.wall};
        }

        .mr-avatar {
          width: 40px;
          height: 40px;
          border-radius: 4px;
          border: 2px solid ${PAL.wall};
          object-fit: contain;
          background: ${PAL.floor};
          flex-shrink: 0;
          image-rendering: pixelated;
        }

        .mr-score-block { flex: 1; }

        .mr-score {
          margin: 0;
          font-size: 1.8rem;
          font-weight: 900;
          color: ${PAL.player};
          text-shadow: 2px 2px 0 ${PAL.bg}, -1px -1px 0 ${PAL.bg};
          line-height: 1.1;
          letter-spacing: 2px;
        }

        .mr-best {
          margin: 0;
          font-size: 0.55rem;
          color: ${PAL.textDim};
          font-weight: 700;
          letter-spacing: 1px;
        }

        .mr-timer {
          font-size: 1.2rem;
          font-weight: 900;
          font-variant-numeric: tabular-nums;
          color: ${PAL.text};
          text-shadow: 1px 1px 0 ${PAL.bg};
          letter-spacing: 1px;
        }

        .mr-timer-low {
          color: ${PAL.trap};
          animation: mr-blink 0.4s step-end infinite;
        }

        @keyframes mr-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.2; }
        }

        .mr-timebar {
          height: 4px;
          background: ${PAL.floor};
          margin: 0;
        }

        .mr-timebar-fill {
          height: 100%;
          transition: width 0.1s linear;
        }

        .mr-stats {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px;
          font-size: 0.65rem;
          font-weight: 800;
          letter-spacing: 1px;
          flex-wrap: wrap;
          border-bottom: 2px solid ${PAL.wall}44;
        }

        .mr-board {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 4px;
          border: 3px solid ${PAL.wall};
          background: ${PAL.floor};
          position: relative;
          min-height: 0;
          border-radius: 2px;
        }

        .mr-board-clear { border-color: ${PAL.exit}; box-shadow: 0 0 20px ${PAL.exit}80; }
        .mr-board-trap { border-color: ${PAL.trap}; box-shadow: 0 0 20px ${PAL.trap}80; }

        .mr-svg { display: block; width: 100%; height: 100%; image-rendering: pixelated; }

        .mr-minimap {
          position: absolute;
          top: 4px;
          right: 4px;
          border: 2px solid ${PAL.wall};
          background: ${PAL.bg}cc;
          border-radius: 2px;
          overflow: hidden;
        }

        .mr-crt {
          pointer-events: none;
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.08) 2px,
            rgba(0,0,0,0.08) 4px
          );
          z-index: 2;
        }

        .mr-vignette {
          pointer-events: none;
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.4) 100%);
          z-index: 3;
        }

        .mr-dpad {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 3px;
          padding: 8px 0 4px;
        }

        .mr-dpad-row { display: flex; align-items: center; gap: 3px; }

        .mr-dpad-center { width: 52px; height: 52px; }

        .mr-dpad-btn {
          width: 52px;
          height: 52px;
          border: 3px solid ${PAL.wall};
          border-radius: 4px;
          background: ${PAL.hud};
          color: ${PAL.text};
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 0.06s;
          -webkit-tap-highlight-color: transparent;
          touch-action: manipulation;
          box-shadow: inset -2px -2px 0 ${PAL.bg}, inset 2px 2px 0 ${PAL.wallLight}40;
          image-rendering: pixelated;
        }

        .mr-dpad-btn:active {
          transform: scale(0.88);
          box-shadow: inset 2px 2px 0 ${PAL.bg}, inset -2px -2px 0 ${PAL.wallLight}40;
        }

        .mr-actions {
          display: flex;
          gap: 6px;
          padding: 2px 12px 8px;
          justify-content: center;
        }

        .mr-btn {
          padding: 8px 20px;
          border: 2px solid ${PAL.wall};
          border-radius: 3px;
          background: ${PAL.hud};
          color: ${PAL.text};
          font-size: 0.75rem;
          font-weight: 800;
          font-family: 'Courier New', monospace;
          cursor: pointer;
          letter-spacing: 1px;
          box-shadow: inset -2px -2px 0 ${PAL.bg};
          -webkit-tap-highlight-color: transparent;
        }

        .mr-btn:active { transform: scale(0.94); box-shadow: inset 2px 2px 0 ${PAL.bg}; }

        .mr-btn-ghost {
          background: transparent;
          color: ${PAL.textDim};
          border-color: ${PAL.textDim}44;
          box-shadow: none;
        }

        .mr-combo-display {
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 1.1rem;
          font-weight: 900;
          color: ${PAL.coinLight};
          text-shadow: 2px 2px 0 ${PAL.bg};
          z-index: 4;
          letter-spacing: 2px;
          pointer-events: none;
          animation: mr-combo-pop 0.3s ease-out;
        }

        @keyframes mr-combo-pop {
          0% { transform: translateX(-50%) scale(1.5); }
          100% { transform: translateX(-50%) scale(1); }
        }

        .mr-key-indicator {
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 0.6rem;
          font-weight: 800;
        }
      `}</style>

      {/* CRT scanline overlay */}
      <div className="mr-crt" />
      <div className="mr-vignette" />

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Combo display */}
      {combo >= 3 && (
        <div className="mr-combo-display" key={combo}>
          {combo}x COMBO!
        </div>
      )}

      {/* Top bar */}
      <div className="mr-topbar">
        <img className="mr-avatar" src={seoTaijiImage} alt="" />
        <div className="mr-score-block">
          <p className="mr-score">{score}</p>
          <p className="mr-best">BEST {displayedBestScore}</p>
        </div>
        {!hasKey && (
          <div className="mr-key-indicator" style={{ background: PAL.key + '30', border: `2px solid ${PAL.key}` }}>
            <span style={{ color: PAL.key }}>KEY</span>
          </div>
        )}
        {hasKey && keyItem && (
          <div className="mr-key-indicator" style={{ background: PAL.exit + '30', border: `2px solid ${PAL.exit}` }}>
            <span style={{ color: PAL.exit }}>GO!</span>
          </div>
        )}
        <span className={`mr-timer ${isLowTime ? 'mr-timer-low' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}
        </span>
      </div>

      {/* Time bar */}
      <div className="mr-timebar">
        <div className="mr-timebar-fill" style={{
          width: `${timePercent}%`,
          background: isLowTime ? PAL.trap : PAL.exit,
        }} />
      </div>

      {/* Stats */}
      <div className="mr-stats">
        <span style={{ color: PAL.exit }}>LV.{mazesCleared + 1}</span>
        {streakMul > 1 && <span style={{ color: PAL.coin }}>x{streakMul}</span>}
        {comboLabel && <span style={{ color: comboColor }}>{comboLabel}</span>}
        <span style={{ color: PAL.coinLight }}>COIN:{coinsCollected}</span>
        {isSpeedBoosted && <span style={{ color: PAL.boostLight, animation: 'mr-blink 0.3s step-end infinite' }}>SPD!</span>}
        {ghost && <span style={{ color: PAL.ghostLight, animation: 'mr-blink 0.6s step-end infinite' }}>GHOST!</span>}
        <span style={{ color: PAL.textDim }}>{gridSize}x{gridSize}</span>
      </div>

      {/* Maze board */}
      <div className={`mr-board ${flashClear ? 'mr-board-clear' : ''} ${trapFlash ? 'mr-board-trap' : ''}`}>
        <svg className="mr-svg" viewBox={`0 0 ${gridTotalPx} ${gridTotalPx}`} preserveAspectRatio="xMidYMid meet">
          {/* Floor */}
          <rect x="0" y="0" width={gridTotalPx} height={gridTotalPx} fill={PAL.floor} />

          {/* Floor grid pattern */}
          {Array.from({ length: gridSize }).map((_, r) =>
            Array.from({ length: gridSize }).map((_, c) => (
              <rect
                key={`floor-${r}-${c}`}
                x={WALL_PX + c * cellTotalPx + 1}
                y={WALL_PX + r * cellTotalPx + 1}
                width={CELL_PX - 2}
                height={CELL_PX - 2}
                fill={(r + c) % 2 === 0 ? PAL.floor : `${PAL.wall}10`}
              />
            ))
          )}

          {/* Trail */}
          {trail.map((t, i) => (
            <rect
              key={`trail-${i}`}
              x={t.x - PIXEL}
              y={t.y - PIXEL}
              width={PIXEL * 2}
              height={PIXEL * 2}
              fill={isSpeedBoosted ? PAL.boostLight : PAL.playerLight}
              opacity={Math.max(0, (1 - t.age / 600) * 0.5)}
            />
          ))}

          {/* Coins */}
          {coins.filter(c => !c.collected).map((c, i) => (
            <PixelCoin key={`c${i}`} cx={cellCenterX(c.col, cellTotalPx)} cy={cellCenterY(c.row, cellTotalPx)} frame={animFrame} />
          ))}

          {/* Speed boost */}
          {speedBoost && !speedBoost.collected && (
            <g>
              <rect x={cellCenterX(speedBoost.col, cellTotalPx) - 5 * PIXEL} y={cellCenterY(speedBoost.row, cellTotalPx) - 5 * PIXEL}
                width={10 * PIXEL} height={10 * PIXEL} fill={PAL.boost} opacity={0.6 + Math.sin(animFrame * 0.1) * 0.3} />
              <rect x={cellCenterX(speedBoost.col, cellTotalPx) - 3 * PIXEL} y={cellCenterY(speedBoost.row, cellTotalPx) - PIXEL}
                width={6 * PIXEL} height={2 * PIXEL} fill={PAL.boostLight} />
              <rect x={cellCenterX(speedBoost.col, cellTotalPx) - PIXEL} y={cellCenterY(speedBoost.row, cellTotalPx) - 3 * PIXEL}
                width={2 * PIXEL} height={6 * PIXEL} fill={PAL.boostLight} />
            </g>
          )}

          {/* Time bonus */}
          {timeBonus && !timeBonus.collected && (
            <g>
              <rect x={cellCenterX(timeBonus.col, cellTotalPx) - 5 * PIXEL} y={cellCenterY(timeBonus.row, cellTotalPx) - 5 * PIXEL}
                width={10 * PIXEL} height={10 * PIXEL} rx={PIXEL} fill={PAL.timeBonus}
                opacity={0.5 + Math.sin(animFrame * 0.08) * 0.3} />
              <rect x={cellCenterX(timeBonus.col, cellTotalPx) - PIXEL} y={cellCenterY(timeBonus.row, cellTotalPx) - 3 * PIXEL}
                width={2 * PIXEL} height={4 * PIXEL} fill="#fff" opacity="0.7" />
              <rect x={cellCenterX(timeBonus.col, cellTotalPx) - PIXEL} y={cellCenterY(timeBonus.row, cellTotalPx) + PIXEL}
                width={2 * PIXEL} height={PIXEL} fill="#fff" opacity="0.7" />
            </g>
          )}

          {/* Traps (subtle - almost hidden) */}
          {traps.filter(t => !t.triggered).map((t, i) => (
            <rect key={`trap${i}`}
              x={cellCenterX(t.col, cellTotalPx) - 4 * PIXEL}
              y={cellCenterY(t.row, cellTotalPx) - 4 * PIXEL}
              width={8 * PIXEL} height={8 * PIXEL}
              fill={PAL.trap} opacity="0.12"
            />
          ))}

          {/* Key */}
          {keyItem && !keyItem.collected && (
            <PixelKey cx={cellCenterX(keyItem.col, cellTotalPx)} cy={cellCenterY(keyItem.row, cellTotalPx)} frame={animFrame} />
          )}

          {/* Chests */}
          {chests.map((ch, i) => (
            <PixelChest key={`ch${i}`} cx={cellCenterX(ch.col, cellTotalPx)} cy={cellCenterY(ch.row, cellTotalPx)} opened={ch.opened} />
          ))}

          {/* Teleporter portals */}
          {teleporter && (
            <>
              {[{ r: teleporter.row1, c: teleporter.col1 }, { r: teleporter.row2, c: teleporter.col2 }].map((pt, i) => {
                const tcx = cellCenterX(pt.c, cellTotalPx), tcy = cellCenterY(pt.r, cellTotalPx)
                return (
                  <g key={`tp${i}`}>
                    <rect x={tcx - 6 * PIXEL} y={tcy - 6 * PIXEL} width={12 * PIXEL} height={12 * PIXEL}
                      fill="none" stroke={PAL.teleport} strokeWidth={PIXEL}
                      opacity={0.5 + Math.sin(animFrame * 0.06 + i * 3) * 0.3} />
                    <rect x={tcx - 3 * PIXEL} y={tcy - 3 * PIXEL} width={6 * PIXEL} height={6 * PIXEL}
                      fill={PAL.teleportLight} opacity={0.3 + Math.sin(animFrame * 0.08 + i * 3) * 0.2} />
                  </g>
                )
              })}
            </>
          )}

          {/* Ghost */}
          {ghost && (
            <PixelGhost cx={cellCenterX(ghost.col, cellTotalPx)} cy={cellCenterY(ghost.row, cellTotalPx)} frame={animFrame} />
          )}

          {/* Walls - pixelated */}
          {mazeWalls.map(w => (
            <rect key={w.key} x={w.x} y={w.y} width={w.w} height={w.h} fill={PAL.wall} />
          ))}
          {/* Wall highlight (top/left edge lighter) */}
          {mazeWalls.map(w => (
            w.h > w.w ? ( // vertical wall
              <rect key={`hl${w.key}`} x={w.x} y={w.y} width={1} height={w.h} fill={PAL.wallLight} opacity="0.3" />
            ) : ( // horizontal wall
              <rect key={`hl${w.key}`} x={w.x} y={w.y} width={w.w} height={1} fill={PAL.wallLight} opacity="0.3" />
            )
          ))}

          {/* Exit */}
          <PixelExit cx={ex} cy={ey} locked={!hasKey} frame={animFrame} />

          {/* Player */}
          <PixelPlayer cx={px} cy={py} boosted={isSpeedBoosted} bumpX={bumpX} bumpY={bumpY} />
        </svg>

        {/* Minimap */}
        {showMinimap && (
          <div className="mr-minimap" style={{ width: minimapSize, height: minimapSize }}>
            <svg width={minimapSize} height={minimapSize} viewBox={`0 0 ${gridTotalPx} ${gridTotalPx}`}>
              <rect width={gridTotalPx} height={gridTotalPx} fill={PAL.bg} />
              {mazeWalls.map(w => (
                <rect key={`mm${w.key}`} x={w.x} y={w.y} width={w.w} height={w.h} fill={PAL.wall} />
              ))}
              <rect x={cellCenterX(playerCol, cellTotalPx) - 4} y={cellCenterY(playerRow, cellTotalPx) - 4}
                width={8} height={8} fill={PAL.player} />
              <rect x={ex - 4} y={ey - 4} width={8} height={8} fill={hasKey ? PAL.exit : PAL.trap} />
            </svg>
          </div>
        )}
      </div>

      {/* D-pad */}
      <div className="mr-dpad" role="group" aria-label="controls">
        <div className="mr-dpad-row">
          <button className="mr-dpad-btn" type="button" onClick={() => movePlayer(DIR_UP)} aria-label="up">
            <svg viewBox="0 0 16 16" width="24" height="24"><rect x="6" y="2" width="4" height="4" fill="currentColor" /><rect x="4" y="6" width="8" height="4" fill="currentColor" /><rect x="2" y="10" width="12" height="4" fill="currentColor" /></svg>
          </button>
        </div>
        <div className="mr-dpad-row">
          <button className="mr-dpad-btn" type="button" onClick={() => movePlayer(DIR_LEFT)} aria-label="left">
            <svg viewBox="0 0 16 16" width="24" height="24"><rect x="2" y="6" width="4" height="4" fill="currentColor" /><rect x="6" y="4" width="4" height="8" fill="currentColor" /><rect x="10" y="2" width="4" height="12" fill="currentColor" /></svg>
          </button>
          <div className="mr-dpad-center" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <button
              className="mr-dpad-btn"
              type="button"
              onClick={() => { setShowMinimap(v => { if (!v) playSfx('minimap', 0.4); return !v }) }}
              style={{ width: 36, height: 36, fontSize: '0.5rem', color: showMinimap ? PAL.exit : PAL.textDim }}
              aria-label="minimap"
            >MAP</button>
          </div>
          <button className="mr-dpad-btn" type="button" onClick={() => movePlayer(DIR_RIGHT)} aria-label="right">
            <svg viewBox="0 0 16 16" width="24" height="24"><rect x="10" y="6" width="4" height="4" fill="currentColor" /><rect x="6" y="4" width="4" height="8" fill="currentColor" /><rect x="2" y="2" width="4" height="12" fill="currentColor" /></svg>
          </button>
        </div>
        <div className="mr-dpad-row">
          <button className="mr-dpad-btn" type="button" onClick={() => movePlayer(DIR_DOWN)} aria-label="down">
            <svg viewBox="0 0 16 16" width="24" height="24"><rect x="2" y="2" width="12" height="4" fill="currentColor" /><rect x="4" y="6" width="8" height="4" fill="currentColor" /><rect x="6" y="10" width="4" height="4" fill="currentColor" /></svg>
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="mr-actions">
        <button className="mr-btn" type="button" onClick={finishGame}>FINISH</button>
        <button className="mr-btn mr-btn-ghost" type="button" onClick={onExit}>EXIT</button>
      </div>
    </section>
  )
}

export const mazeRunModule: MiniGameModule = {
  manifest: {
    id: 'maze-run',
    title: 'Maze Run',
    description: 'Escape the maze fast! Collect keys and avoid ghosts!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#5b21b6',
  },
  Component: MazeRunGame,
}
