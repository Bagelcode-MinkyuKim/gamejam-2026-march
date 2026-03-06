import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { AUDIO_ENABLED, DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import revealSfx from '../../../assets/sounds/mine-sweep-reveal.mp3'
import flagSfx from '../../../assets/sounds/mine-sweep-flag.mp3'
import explodeSfx from '../../../assets/sounds/mine-sweep-explode.mp3'
import clearSfx from '../../../assets/sounds/mine-sweep-clear.mp3'
import chainSfx from '../../../assets/sounds/mine-sweep-chain.mp3'
import feverSfx from '../../../assets/sounds/mine-sweep-fever.mp3'
import warningSfx from '../../../assets/sounds/mine-sweep-warning.mp3'
import shieldSfx from '../../../assets/sounds/mine-sweep-shield.mp3'
import hintSfx from '../../../assets/sounds/mine-sweep-hint.mp3'
import timebonusSfx from '../../../assets/sounds/mine-sweep-timebonus.mp3'
import levelupSfx from '../../../assets/sounds/mine-sweep-levelup.mp3'
import mineSweepBgmLoop from '../../../assets/sounds/generated/mine-sweep/mine-sweep-bgm-loop.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

/* ─── CONSTANTS ─── */
const GRID_SIZE = 8
const BASE_MINE_COUNT = 10
const MINE_INCREASE_PER_LEVEL = 1
const MAX_MINES = 18
const ROUND_DURATION_MS = 60000
const CLEAR_BONUS = 50
const LOW_TIME_THRESHOLD_MS = 10000
const LONG_PRESS_MS = 400
const CHAIN_REVEAL_THRESHOLD = 8
const CHAIN_REVEAL_MULTIPLIER = 3
const FAST_CLEAR_THRESHOLD_MS = 15000
const FAST_CLEAR_BONUS = 30
const FEVER_CLEAR_THRESHOLD = 3
const FEVER_SCORE_MULTIPLIER = 2
const TOTAL_CELLS = GRID_SIZE * GRID_SIZE

const HINT_COST = 5
const SHIELD_COST = 15
const TIME_BONUS_COST = 10
const TIME_BONUS_MS = 10000
const XRAY_COST = 20

const COMBO_WINDOW_MS = 3000
const COMBO_MULTIPLIER_STEP = 0.5
const MINE_SWEEP_BGM_VOLUME = 0.18

function getMineCount(level: number): number {
  return Math.min(MAX_MINES, BASE_MINE_COUNT + level * MINE_INCREASE_PER_LEVEL)
}
function getSafeCells(level: number): number {
  return TOTAL_CELLS - getMineCount(level)
}

/* ─── TYPES ─── */
type CellState = {
  readonly isMine: boolean
  readonly adjacentMines: number
  opened: boolean
  flagged: boolean
  hinted: boolean
  xrayed: boolean
}

type BoardState = {
  cells: CellState[][]
  minesPlaced: boolean
}

/* ─── PIXEL ART NUMBER PALETTE ─── */
const NUM_COLORS: Record<number, string> = {
  1: '#55f', 2: '#080', 3: '#f22', 4: '#309',
  5: '#810', 6: '#088', 7: '#222', 8: '#888',
}

/* ─── BOARD HELPERS ─── */
function createEmptyBoard(): BoardState {
  const cells: CellState[][] = []
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const rowCells: CellState[] = []
    for (let col = 0; col < GRID_SIZE; col += 1) {
      rowCells.push({ isMine: false, adjacentMines: 0, opened: false, flagged: false, hinted: false, xrayed: false })
    }
    cells.push(rowCells)
  }
  return { cells, minesPlaced: false }
}

function getNeighbors(row: number, col: number): [number, number][] {
  const neighbors: [number, number][] = []
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const nr = row + dr
      const nc = col + dc
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) neighbors.push([nr, nc])
    }
  }
  return neighbors
}

function placeMines(board: BoardState, safeRow: number, safeCol: number, mineCount: number): void {
  const safeCells = new Set<string>()
  safeCells.add(`${safeRow},${safeCol}`)
  for (const [nr, nc] of getNeighbors(safeRow, safeCol)) safeCells.add(`${nr},${nc}`)
  const candidates: [number, number][] = []
  for (let r = 0; r < GRID_SIZE; r += 1)
    for (let c = 0; c < GRID_SIZE; c += 1)
      if (!safeCells.has(`${r},${c}`)) candidates.push([r, c])
  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  for (const [r, c] of candidates.slice(0, mineCount)) board.cells[r][c] = { ...board.cells[r][c], isMine: true }
  for (let r = 0; r < GRID_SIZE; r += 1)
    for (let c = 0; c < GRID_SIZE; c += 1) {
      if (board.cells[r][c].isMine) continue
      let count = 0
      for (const [nr, nc] of getNeighbors(r, c)) if (board.cells[nr][nc].isMine) count += 1
      board.cells[r][c] = { ...board.cells[r][c], adjacentMines: count }
    }
  board.minesPlaced = true
}

function cloneBoard(board: BoardState): BoardState {
  return { cells: board.cells.map((row) => row.map((cell) => ({ ...cell }))), minesPlaced: board.minesPlaced }
}

function countOpenedSafe(board: BoardState): number {
  let c = 0
  for (let r = 0; r < GRID_SIZE; r += 1) for (let cc = 0; cc < GRID_SIZE; cc += 1) if (board.cells[r][cc].opened && !board.cells[r][cc].isMine) c += 1
  return c
}

function countFlags(board: BoardState): number {
  let c = 0
  for (let r = 0; r < GRID_SIZE; r += 1) for (let cc = 0; cc < GRID_SIZE; cc += 1) if (board.cells[r][cc].flagged) c += 1
  return c
}

function floodOpen(board: BoardState, row: number, col: number): number {
  const cell = board.cells[row][col]
  if (cell.opened || cell.flagged || cell.isMine) return 0
  cell.opened = true
  let opened = 1
  if (cell.adjacentMines === 0) for (const [nr, nc] of getNeighbors(row, col)) opened += floodOpen(board, nr, nc)
  return opened
}

/* ─── PIXEL-ART CSS ─── */
const PX = `
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
.ms-root {
  max-width: 432px; width: 100%; height: 100%; margin: 0 auto;
  overflow: hidden; position: relative;
  display: flex; flex-direction: column;
  background: #c0c0c0;
  font-family: 'Press Start 2P', monospace;
  image-rendering: pixelated;
  padding: 6px; gap: 5px;
  border-top: 3px solid #fff; border-left: 3px solid #fff;
  border-bottom: 3px solid #808080; border-right: 3px solid #808080;
}

/* ── TOP PANEL ── */
.ms-top {
  background: #c0c0c0;
  border-bottom: 3px solid #808080; border-right: 3px solid #808080;
  border-top: 3px solid #fff; border-left: 3px solid #fff;
  padding: 10px 12px;
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.ms-lcd {
  background: #300; color: #f33; padding: 6px 10px;
  font-size: clamp(0.88rem, 3.4vw, 1.3rem);
  border-top: 2px solid #808080; border-left: 2px solid #808080;
  border-bottom: 2px solid #fff; border-right: 2px solid #fff;
  min-width: 72px; text-align: center;
  text-shadow: 0 0 6px rgba(255,50,50,0.5);
  letter-spacing: 2px;
}
.ms-lcd-green { color: #0f0; text-shadow: 0 0 6px rgba(0,255,0,0.5); }
.ms-lcd-yellow { color: #ff0; text-shadow: 0 0 6px rgba(255,255,0,0.5); }
.ms-face-btn {
  width: 50px; height: 50px;
  background: #c0c0c0;
  border-top: 3px solid #fff; border-left: 3px solid #fff;
  border-bottom: 3px solid #808080; border-right: 3px solid #808080;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px; cursor: pointer;
  line-height: 1;
}
.ms-face-btn:active {
  border-top: 3px solid #808080; border-left: 3px solid #808080;
  border-bottom: 3px solid #fff; border-right: 3px solid #fff;
}

/* ── INFO ROW ── */
.ms-info {
  display: flex; align-items: center; justify-content: center;
  flex-wrap: wrap;
  padding: 6px 8px; gap: 8px;
  font-size: clamp(0.35rem, 1.35vw, 0.48rem);
  color: #333;
  flex-shrink: 0;
}
.ms-info-tag {
  background: #a0a0a0;
  padding: 4px 8px;
  border-top: 1px solid #808080; border-left: 1px solid #808080;
  border-bottom: 1px solid #fff; border-right: 1px solid #fff;
  display: inline-flex; align-items: center; gap: 3px;
}
.ms-info-tag b { color: #000; }
.ms-fever-tag {
  background: #ff0; color: #800; font-weight: 800;
  animation: ms-px-blink 0.4s steps(2) infinite;
  padding: 4px 10px;
}
@keyframes ms-px-blink { 50% { opacity: 0.5; } }
.ms-shield-tag { background: #0a0; color: #fff; }
.ms-combo-tag { background: #f80; color: #fff; animation: ms-px-blink 0.6s steps(2) infinite; }

/* ── PROGRESS ── */
.ms-prog-wrap {
  height: 12px; background: #808080;
  border-top: 2px solid #404040; border-left: 2px solid #404040;
  border-bottom: 2px solid #fff; border-right: 2px solid #fff;
  overflow: hidden;
  flex-shrink: 0;
}
.ms-prog-fill {
  height: 100%; transition: width 0.2s steps(8);
  background: repeating-linear-gradient(90deg, #0a0 0px, #0a0 4px, #080 4px, #080 8px);
}
.ms-prog-fill.fever {
  background: repeating-linear-gradient(90deg, #ff0 0px, #ff0 4px, #f80 4px, #f80 8px);
  animation: ms-px-scroll 0.3s linear infinite;
}
@keyframes ms-px-scroll { to { background-position: 8px 0; } }

/* ── GRID ── */
.ms-grid-area {
  flex: 1; display: flex; align-items: center; justify-content: center;
  position: relative; min-height: 0; padding: 2px;
}
.ms-grid-area.dead { animation: ms-px-dead 0.6s ease-out; }
@keyframes ms-px-dead {
  0%,100% { filter: none; }
  25% { filter: invert(1); }
  50% { filter: none; }
  75% { filter: invert(1); }
}
.ms-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  grid-template-rows: repeat(8, 1fr);
  gap: 0; width: 100%; max-width: 400px; aspect-ratio: 1;
  border-top: 3px solid #808080; border-left: 3px solid #808080;
  border-bottom: 3px solid #fff; border-right: 3px solid #fff;
}

/* ── CELL ── */
.ms-c {
  position: relative; display: flex; align-items: center; justify-content: center;
  border: none; padding: 0; cursor: pointer;
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(0.5rem, 2vw, 0.78rem);
  font-weight: 800;
  -webkit-user-select: none; user-select: none;
  touch-action: manipulation;
}
.ms-c.shut {
  background: #c0c0c0;
  border-top: 3px solid #fff; border-left: 3px solid #fff;
  border-bottom: 3px solid #808080; border-right: 3px solid #808080;
}
.ms-c.shut:hover:not(:disabled) { background: #d0d0d0; }
.ms-c.shut:active:not(:disabled) {
  background: #b0b0b0;
  border-top: 2px solid #808080; border-left: 2px solid #808080;
  border-bottom: 2px solid #fff; border-right: 2px solid #fff;
}
.ms-c.open {
  background: #d0d0d0;
  border: 1px solid #a0a0a0;
}
.ms-c.boom {
  background: #f00 !important; border: 1px solid #800;
  animation: ms-px-boom 0.3s steps(3);
}
@keyframes ms-px-boom {
  0% { transform: scale(1); } 33% { transform: scale(1.4); }
  66% { transform: scale(0.9); } 100% { transform: scale(1); }
}
.ms-c.mine-show { background: #e0e0e0; border: 1px solid #a0a0a0; }
.ms-c.flagged {
  background: #c0c0c0;
  border-top: 3px solid #fff; border-left: 3px solid #fff;
  border-bottom: 3px solid #808080; border-right: 3px solid #808080;
}
.ms-c.hinted {
  animation: ms-px-hint 0.8s steps(2) infinite;
}
@keyframes ms-px-hint {
  0% { background: #c0c0c0; } 50% { background: #8f8; }
}
.ms-c.xrayed-mine {
  animation: ms-px-xray 0.5s steps(2) infinite;
}
@keyframes ms-px-xray {
  0% { background: #c0c0c0; } 50% { background: #faa; }
}
.ms-c.pop { animation: ms-px-pop 0.15s steps(2); }
@keyframes ms-px-pop {
  0% { transform: scale(0.6); } 100% { transform: scale(1); }
}

/* ── CELL CONTENT ── */
.ms-flag-txt { color: #f00; font-size: clamp(0.5rem, 2vw, 0.75rem); }
.ms-mine-txt { color: #000; font-size: clamp(0.5rem, 2vw, 0.75rem); }
.ms-mine-txt.hit-mine { color: #fff; }
.ms-num-txt { font-weight: 800; }

/* ── CLEAR OVERLAY ── */
.ms-clear-ov {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.6); z-index: 10;
  animation: ms-px-clear-in 0.5s steps(4);
}
@keyframes ms-px-clear-in {
  0% { opacity: 0; } 100% { opacity: 1; }
}
.ms-clear-big {
  color: #ff0; font-size: clamp(1.2rem, 5vw, 2rem);
  text-shadow: 3px 3px 0 #800, -1px -1px 0 #ff8;
  animation: ms-px-clear-bounce 0.4s steps(4);
}
@keyframes ms-px-clear-bounce {
  0% { transform: scale(0) rotate(-15deg); }
  50% { transform: scale(1.3) rotate(5deg); }
  100% { transform: scale(1) rotate(0); }
}
.ms-clear-sub {
  color: #0f0; font-size: clamp(0.4rem, 1.5vw, 0.55rem);
  margin-top: 6px;
}
.ms-lvlup-ov {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  z-index: 11; pointer-events: none;
}
.ms-lvlup-txt {
  color: #0ff; font-size: clamp(0.7rem, 3vw, 1.2rem);
  text-shadow: 2px 2px 0 #008, 0 0 8px #0ff;
  animation: ms-px-lvlup 0.8s steps(6) forwards;
}
@keyframes ms-px-lvlup {
  0% { transform: translateY(20px) scale(0.5); opacity: 0; }
  30% { transform: translateY(-5px) scale(1.2); opacity: 1; }
  100% { transform: translateY(-40px) scale(1); opacity: 0; }
}

/* ── COMBO TIMER ── */
.ms-combo-bar {
  height: 6px; background: #404040;
  border-top: 1px solid #202020; border-left: 1px solid #202020;
  overflow: hidden;
  flex-shrink: 0;
}
.ms-combo-fill {
  height: 100%; background: #f80; transition: width 0.1s linear;
}

/* ── POWER BAR ── */
.ms-pwr {
  display: flex; align-items: stretch; gap: 5px; padding: 4px 2px 2px;
  flex-shrink: 0;
}
.ms-pwr-btn {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center;
  gap: 4px; padding: 8px 3px;
  min-height: 72px;
  background: #c0c0c0;
  border-top: 2px solid #fff; border-left: 2px solid #fff;
  border-bottom: 2px solid #808080; border-right: 2px solid #808080;
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(0.28rem, 1vw, 0.38rem);
  color: #333; cursor: pointer;
  line-height: 1.3;
}
.ms-pwr-btn:active:not(:disabled) {
  border-top: 2px solid #808080; border-left: 2px solid #808080;
  border-bottom: 2px solid #fff; border-right: 2px solid #fff;
  background: #a0a0a0;
}
.ms-pwr-btn:disabled { opacity: 0.35; cursor: default; }
.ms-pwr-btn span { text-align: center; }
.ms-pwr-btn.active-flag {
  background: #fcc;
  border-top: 2px solid #808080; border-left: 2px solid #808080;
  border-bottom: 2px solid #fff; border-right: 2px solid #fff;
}
.ms-pwr-ico { font-size: clamp(0.72rem, 2.6vw, 1rem); }
.ms-pwr-cost { color: #800; font-size: clamp(0.24rem, 0.85vw, 0.31rem); }

/* ── HINT ── */
.ms-hint-row {
  display: flex; align-items: center; justify-content: center;
  padding: 5px 4px 2px; gap: 10px;
  font-size: clamp(0.33rem, 1.15vw, 0.42rem); color: #666;
  flex-shrink: 0;
}

/* ── SCANLINE OVERLAY ── */
.ms-scanline {
  position: absolute; inset: 0; pointer-events: none; z-index: 20;
  background: repeating-linear-gradient(
    0deg, transparent 0px, transparent 2px,
    rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px
  );
}
`

/* ─── GAME COMPONENT ─── */
function MineSweepMiniGame({ onFinish, onExit, bestScore = 0, isAudioMuted = false }: MiniGameSessionProps) {
  const fx = useGameEffects()
  const [board, setBoard] = useState<BoardState>(() => createEmptyBoard())
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [boardsCleared, setBoardsCleared] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [hitMinePos, setHitMinePos] = useState<[number, number] | null>(null)
  const [currentLevel, setCurrentLevel] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [_boardStartMs, setBoardStartMs] = useState(0)
  const [showClearOverlay, setShowClearOverlay] = useState(false)
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [poppedKeys, setPoppedKeys] = useState<Set<string>>(new Set())
  const [flagMode, setFlagMode] = useState(false)
  const [combo, setCombo] = useState(0)
  const [comboMs, setComboMs] = useState(0)
  const [deadFlash, setDeadFlash] = useState(false)
  const [faceState, setFaceState] = useState<'smile' | 'wow' | 'dead' | 'cool'>('smile')

  const boardRef = useRef<BoardState>(board)
  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const boardsClearedRef = useRef(0)
  const currentLevelRef = useRef(0)
  const boardStartMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const longTimerRef = useRef<number | null>(null)
  const longFiredRef = useRef(false)
  const ptrStartRef = useRef<{ row: number; col: number } | null>(null)
  const warnPlayedRef = useRef(false)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const comboRef = useRef(0)
  const comboMsRef = useRef(0)
  const isAudioMutedRef = useRef(isAudioMuted)
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const audioRefs = {
    reveal: useRef<HTMLAudioElement | null>(null),
    flag: useRef<HTMLAudioElement | null>(null),
    explode: useRef<HTMLAudioElement | null>(null),
    clear: useRef<HTMLAudioElement | null>(null),
    chain: useRef<HTMLAudioElement | null>(null),
    fever: useRef<HTMLAudioElement | null>(null),
    warning: useRef<HTMLAudioElement | null>(null),
    shield: useRef<HTMLAudioElement | null>(null),
    hint: useRef<HTMLAudioElement | null>(null),
    timebonus: useRef<HTMLAudioElement | null>(null),
    levelup: useRef<HTMLAudioElement | null>(null),
  }

  const stopBgm = useCallback((reset = false) => {
    const bgm = bgmRef.current
    if (bgm === null) return
    bgm.pause()
    if (reset) bgm.currentTime = 0
  }, [])

  const startBgm = useCallback(() => {
    if (!AUDIO_ENABLED || isAudioMutedRef.current || finishedRef.current) return
    const bgm = bgmRef.current
    if (bgm === null || !bgm.paused) return
    void bgm.play().catch(() => {})
  }, [])

  const play = useCallback((ref: { current: HTMLAudioElement | null }, vol: number, rate = 1) => {
    if (!AUDIO_ENABLED || isAudioMutedRef.current) return
    const a = ref.current
    if (!a) return
    a.currentTime = 0
    a.volume = Math.min(1, Math.max(0, vol))
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const cellXY = useCallback((row: number, col: number): [number, number] => {
    const g = gridRef.current
    if (!g) return [col * 48 + 24, row * 48 + 24]
    const r = g.getBoundingClientRect()
    const cw = r.width / GRID_SIZE, ch = r.height / GRID_SIZE
    return [col * cw + cw / 2, row * ch + ch / 2]
  }, [])

  const addCombo = useCallback(() => {
    comboRef.current += 1
    comboMsRef.current = COMBO_WINDOW_MS
    setCombo(comboRef.current)
    setComboMs(COMBO_WINDOW_MS)
  }, [])

  const getComboMultiplier = useCallback(() => {
    return 1 + comboRef.current * COMBO_MULTIPLIER_STEP
  }, [])

  const endGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    stopBgm(true)
    const elapsed = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsed })
  }, [onFinish, stopBgm])

  const handleMineHit = useCallback((row: number, col: number) => {
    if (hasShield) {
      setHasShield(false)
      const nb = cloneBoard(boardRef.current)
      nb.cells[row][col].flagged = true
      boardRef.current = nb
      setBoard(nb)
      play(audioRefs.shield, 0.7, 1.0)
      fx.triggerFlash('rgba(0,255,0,0.4)')
      fx.triggerShake(4)
      const [cx, cy] = cellXY(row, col)
      fx.spawnParticles(5, cx, cy, ['+'])
      fx.showScorePopup(0, cx, cy)
      setFaceState('cool')
      window.setTimeout(() => setFaceState('smile'), 800)
      return
    }

    setGameOver(true)
    setHitMinePos([row, col])
    setFaceState('dead')
    setDeadFlash(true)

    const nb = cloneBoard(boardRef.current)
    for (let r = 0; r < GRID_SIZE; r += 1)
      for (let c = 0; c < GRID_SIZE; c += 1)
        if (nb.cells[r][c].isMine) nb.cells[r][c].opened = true
    boardRef.current = nb
    setBoard(nb)

    play(audioRefs.explode, 0.9, 0.8)
    fx.triggerFlash('rgba(255,0,0,0.6)')
    fx.triggerShake(12)
    const [cx, cy] = cellXY(row, col)
    fx.spawnParticles(10, cx, cy, ['X', '*', '#', '!'])

    window.setTimeout(() => endGame(), 1200)
  }, [endGame, play, hasShield, cellXY])

  const startNewBoard = useCallback(() => {
    const nb = createEmptyBoard()
    boardRef.current = nb
    setBoard(nb)
    setHitMinePos(null)
    setGameOver(false)
    setDeadFlash(false)
    setPoppedKeys(new Set())
    boardStartMsRef.current = ROUND_DURATION_MS - remainingMsRef.current
    setBoardStartMs(boardStartMsRef.current)
    setFaceState('smile')
  }, [])

  const handleBoardClear = useCallback(() => {
    const nextClr = boardsClearedRef.current + 1
    boardsClearedRef.current = nextClr
    setBoardsCleared(nextClr)

    const nextLv = currentLevelRef.current + 1
    currentLevelRef.current = nextLv
    setCurrentLevel(nextLv)

    const feverOn = nextClr >= FEVER_CLEAR_THRESHOLD
    setIsFever(feverOn)
    setFaceState('cool')

    let bonus = CLEAR_BONUS
    const dur = (ROUND_DURATION_MS - remainingMsRef.current) - boardStartMsRef.current
    if (dur < FAST_CLEAR_THRESHOLD_MS) bonus += FAST_CLEAR_BONUS
    if (feverOn) bonus *= FEVER_SCORE_MULTIPLIER
    bonus = Math.round(bonus * getComboMultiplier())

    const ns = scoreRef.current + bonus
    scoreRef.current = ns
    setScore(ns)

    play(feverOn ? audioRefs.fever : audioRefs.clear, 0.7, 1.0 + nextClr * 0.04)
    fx.comboHitBurst(200, 200, nextClr, bonus)
    fx.triggerFlash(feverOn ? 'rgba(255,255,0,0.5)' : 'rgba(0,255,0,0.4)')

    setShowClearOverlay(true)
    window.setTimeout(() => setShowClearOverlay(false), 700)

    setShowLevelUp(true)
    play(audioRefs.levelup, 0.5, 1.0)
    window.setTimeout(() => setShowLevelUp(false), 900)

    window.setTimeout(() => {
      if (!finishedRef.current) startNewBoard()
    }, 800)
  }, [play, startNewBoard, getComboMultiplier])

  const openCell = useCallback((row: number, col: number) => {
    if (finishedRef.current || gameOver) return
    const cur = boardRef.current
    const cell = cur.cells[row][col]
    if (cell.opened || cell.flagged) return

    setFaceState('wow')
    window.setTimeout(() => { if (!finishedRef.current && !gameOver) setFaceState('smile') }, 300)

    const nb = cloneBoard(cur)
    if (!nb.minesPlaced) placeMines(nb, row, col, getMineCount(currentLevelRef.current))

    if (nb.cells[row][col].isMine) {
      boardRef.current = nb
      setBoard(nb)
      handleMineHit(row, col)
      return
    }

    const opened = floodOpen(nb, row, col)
    boardRef.current = nb
    setBoard(nb)

    if (opened > 0) {
      const nk = new Set(poppedKeys)
      for (let r = 0; r < GRID_SIZE; r += 1)
        for (let c = 0; c < GRID_SIZE; c += 1)
          if (nb.cells[r][c].opened) nk.add(`${r}-${c}`)
      setPoppedKeys(nk)

      addCombo()

      const isChain = opened >= CHAIN_REVEAL_THRESHOLD
      let pts = isChain ? opened * CHAIN_REVEAL_MULTIPLIER : opened
      pts = Math.round(pts * getComboMultiplier())
      const ns = scoreRef.current + pts
      scoreRef.current = ns
      setScore(ns)

      play(isChain ? audioRefs.chain : audioRefs.reveal, 0.6, 1 + opened * 0.03)

      const [cx, cy] = cellXY(row, col)
      fx.showScorePopup(pts, cx, cy)
      if (opened >= 5) {
        fx.comboHitBurst(cx, cy, opened, pts)
      } else {
        fx.spawnParticles(Math.min(opened, 5), cx, cy, ['.', 'o', '+'])
        fx.triggerShake(Math.min(opened, 3))
      }
    }

    if (countOpenedSafe(nb) === getSafeCells(currentLevelRef.current)) handleBoardClear()
  }, [gameOver, handleBoardClear, handleMineHit, play, poppedKeys, cellXY, addCombo, getComboMultiplier])

  const toggleFlag = useCallback((row: number, col: number) => {
    if (finishedRef.current || gameOver) return
    const cur = boardRef.current
    if (cur.cells[row][col].opened) return
    const nb = cloneBoard(cur)
    nb.cells[row][col].flagged = !nb.cells[row][col].flagged
    boardRef.current = nb
    setBoard(nb)
    play(audioRefs.flag, 0.5, nb.cells[row][col].flagged ? 1.1 : 0.85)
  }, [gameOver, play])

  const doCellAction = useCallback((row: number, col: number) => {
    flagMode ? toggleFlag(row, col) : openCell(row, col)
  }, [flagMode, openCell, toggleFlag])

  const onPtrDown = useCallback((row: number, col: number) => {
    if (finishedRef.current || gameOver) return
    startBgm()
    ptrStartRef.current = { row, col }
    longFiredRef.current = false
    if (longTimerRef.current !== null) window.clearTimeout(longTimerRef.current)
    longTimerRef.current = window.setTimeout(() => {
      longTimerRef.current = null
      longFiredRef.current = true
      flagMode ? openCell(row, col) : toggleFlag(row, col)
    }, LONG_PRESS_MS)
  }, [gameOver, toggleFlag, openCell, flagMode, startBgm])

  const onPtrUp = useCallback((row: number, col: number) => {
    if (longTimerRef.current !== null) { window.clearTimeout(longTimerRef.current); longTimerRef.current = null }
    if (longFiredRef.current) return
    const s = ptrStartRef.current
    if (!s || s.row !== row || s.col !== col) return
    doCellAction(row, col)
  }, [doCellAction])

  const onPtrLeave = useCallback(() => {
    if (longTimerRef.current !== null) { window.clearTimeout(longTimerRef.current); longTimerRef.current = null }
  }, [])

  const onCtxMenu = useCallback((e: React.MouseEvent, row: number, col: number) => {
    e.preventDefault()
    startBgm()
    toggleFlag(row, col)
  }, [toggleFlag, startBgm])

  /* ── POWER-UPS ── */
  const useHint = useCallback(() => {
    if (scoreRef.current < HINT_COST || !boardRef.current.minesPlaced || gameOver) return
    startBgm()
    const cur = boardRef.current
    const safe: [number, number][] = []
    for (let r = 0; r < GRID_SIZE; r += 1)
      for (let c = 0; c < GRID_SIZE; c += 1) {
        const cl = cur.cells[r][c]
        if (!cl.opened && !cl.flagged && !cl.isMine && !cl.hinted) safe.push([r, c])
      }
    if (safe.length === 0) return
    scoreRef.current -= HINT_COST; setScore(scoreRef.current)
    const [hr, hc] = safe[Math.floor(Math.random() * safe.length)]
    const nb = cloneBoard(cur); nb.cells[hr][hc].hinted = true
    boardRef.current = nb; setBoard(nb)
    play(audioRefs.hint, 0.6, 1.2)
    const [cx, cy] = cellXY(hr, hc)
    fx.spawnParticles(3, cx, cy, ['?', '!'])
  }, [gameOver, play, cellXY, startBgm])

  const useShield = useCallback(() => {
    if (scoreRef.current < SHIELD_COST || hasShield || gameOver) return
    startBgm()
    scoreRef.current -= SHIELD_COST; setScore(scoreRef.current)
    setHasShield(true)
    play(audioRefs.shield, 0.7, 1.0)
    fx.triggerFlash('rgba(0,200,0,0.3)')
  }, [hasShield, gameOver, play, startBgm])

  const useTimeBonus = useCallback(() => {
    if (scoreRef.current < TIME_BONUS_COST || gameOver) return
    startBgm()
    scoreRef.current -= TIME_BONUS_COST; setScore(scoreRef.current)
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_MS)
    setRemainingMs(remainingMsRef.current)
    play(audioRefs.timebonus, 0.6, 1.0)
    fx.triggerFlash('rgba(0,100,255,0.3)')
  }, [gameOver, play, startBgm])

  const useXray = useCallback(() => {
    if (scoreRef.current < XRAY_COST || !boardRef.current.minesPlaced || gameOver) return
    startBgm()
    const cur = boardRef.current
    const mines: [number, number][] = []
    for (let r = 0; r < GRID_SIZE; r += 1)
      for (let c = 0; c < GRID_SIZE; c += 1)
        if (cur.cells[r][c].isMine && !cur.cells[r][c].flagged && !cur.cells[r][c].opened && !cur.cells[r][c].xrayed)
          mines.push([r, c])
    if (mines.length === 0) return
    scoreRef.current -= XRAY_COST; setScore(scoreRef.current)
    const nb = cloneBoard(cur)
    const picked = mines[Math.floor(Math.random() * mines.length)]
    for (const [nr, nc] of [[picked[0], picked[1]], ...getNeighbors(picked[0], picked[1])]) {
      if (nb.cells[nr]?.[nc]?.isMine && !nb.cells[nr][nc].opened) nb.cells[nr][nc].xrayed = true
    }
    boardRef.current = nb; setBoard(nb)
    play(audioRefs.hint, 0.5, 0.7)
    fx.triggerFlash('rgba(255,100,100,0.2)')
    const [cx, cy] = cellXY(picked[0], picked[1])
    fx.spawnParticles(3, cx, cy, ['!', 'X'])
  }, [gameOver, play, cellXY, startBgm])

  useEffect(() => {
    isAudioMutedRef.current = isAudioMuted
    if (isAudioMuted) {
      stopBgm()
      return
    }
    startBgm()
  }, [isAudioMuted, startBgm, stopBgm])

  /* ── AUDIO INIT ── */
  useEffect(() => {
    const srcs: [{ current: HTMLAudioElement | null }, string][] = [
      [audioRefs.reveal, revealSfx], [audioRefs.flag, flagSfx], [audioRefs.explode, explodeSfx],
      [audioRefs.clear, clearSfx], [audioRefs.chain, chainSfx], [audioRefs.fever, feverSfx],
      [audioRefs.warning, warningSfx], [audioRefs.shield, shieldSfx], [audioRefs.hint, hintSfx],
      [audioRefs.timebonus, timebonusSfx], [audioRefs.levelup, levelupSfx],
    ]
    if (AUDIO_ENABLED) {
      for (const [ref, src] of srcs) { const a = new Audio(src); a.preload = 'auto'; ref.current = a }
      const bgm = new Audio(mineSweepBgmLoop)
      bgm.preload = 'auto'
      bgm.loop = true
      bgm.volume = MINE_SWEEP_BGM_VOLUME
      bgmRef.current = bgm
      startBgm()
    }
    return () => {
      stopBgm(true)
      bgmRef.current = null
      for (const [ref] of srcs) ref.current = null
      if (longTimerRef.current !== null) { window.clearTimeout(longTimerRef.current); longTimerRef.current = null }
      fx.cleanup()
    }
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        e.preventDefault()
        stopBgm(true)
        onExit()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit, stopBgm])

  /* ── GAME LOOP ── */
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animFrameRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - dt)
      setRemainingMs(remainingMsRef.current)
      fx.updateParticles()

      if (comboMsRef.current > 0) {
        comboMsRef.current = Math.max(0, comboMsRef.current - dt)
        setComboMs(comboMsRef.current)
        if (comboMsRef.current <= 0) { comboRef.current = 0; setCombo(0) }
      }

      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !warnPlayedRef.current) {
        warnPlayedRef.current = true
        play(audioRefs.warning, 0.5, 1.0)
      }

      if (remainingMsRef.current <= 0) {
        play(audioRefs.explode, 0.4, 0.6)
        endGame()
        animFrameRef.current = null
        return
      }

      animFrameRef.current = window.requestAnimationFrame(step)
    }
    animFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animFrameRef.current !== null) { window.cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }
      lastFrameRef.current = null
    }
  }, [endGame, play])

  /* ── DERIVED ── */
  const mineCount = getMineCount(currentLevelRef.current)
  const flagCount = useMemo(() => countFlags(board), [board])
  const minesLeft = mineCount - flagCount
  const bestDisp = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLow = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const totalSafe = getSafeCells(currentLevelRef.current)
  const openedSafe = useMemo(() => countOpenedSafe(board), [board])
  const progPct = totalSafe > 0 ? (openedSafe / totalSafe) * 100 : 0
  const timeLeft = Math.ceil(remainingMs / 1000)
  const comboPct = COMBO_WINDOW_MS > 0 ? (comboMs / COMBO_WINDOW_MS) * 100 : 0

  const faceChar = faceState === 'smile' ? ':)' : faceState === 'wow' ? ':O' : faceState === 'dead' ? 'X(' : 'B)'

  const renderCell = (cell: CellState, row: number, col: number): React.ReactNode => {
    if (cell.flagged && !cell.opened) return <span className="ms-flag-txt">P</span>
    if (!cell.opened) {
      if (cell.hinted) return <span style={{ color: '#0a0', fontSize: 'clamp(0.35rem,1.3vw,0.5rem)' }}>?</span>
      return null
    }
    if (cell.isMine) {
      const isHit = hitMinePos !== null && hitMinePos[0] === row && hitMinePos[1] === col
      return <span className={`ms-mine-txt ${isHit ? 'hit-mine' : ''}`}>*</span>
    }
    if (cell.adjacentMines > 0) {
      return <span className="ms-num-txt" style={{ color: NUM_COLORS[cell.adjacentMines] ?? '#222' }}>{cell.adjacentMines}</span>
    }
    return null
  }

  return (
    <section className="mini-game-panel ms-root" aria-label="mine-sweep-mini-game" style={fx.getShakeStyle()}>
      <style>{GAME_EFFECTS_CSS}</style>
      <style>{PX}</style>

      {/* SCANLINE */}
      <div className="ms-scanline" />

      {/* TOP PANEL */}
      <div className="ms-top">
        <div className="ms-lcd">{String(Math.max(0, minesLeft)).padStart(3, '0')}</div>
        <button type="button" className="ms-face-btn" onClick={startNewBoard} disabled={!gameOver}>
          {faceChar}
        </button>
        <div className={`ms-lcd ${isLow ? '' : timeLeft > 30 ? 'ms-lcd-green' : 'ms-lcd-yellow'}`}>
          {String(timeLeft).padStart(3, '0')}
        </div>
      </div>

      {/* INFO ROW */}
      <div className="ms-info">
        <span className="ms-info-tag">Lv.<b>{currentLevel + 1}</b></span>
        <span className="ms-info-tag">SCORE <b>{score.toLocaleString()}</b></span>
        <span className="ms-info-tag">BEST <b>{bestDisp.toLocaleString()}</b></span>
        <span className="ms-info-tag">CLR <b>{boardsCleared}</b></span>
        {hasShield && <span className="ms-info-tag ms-shield-tag">SHIELD</span>}
        {isFever && <span className="ms-info-tag ms-fever-tag">FEVER x{FEVER_SCORE_MULTIPLIER}</span>}
        {combo > 1 && <span className="ms-info-tag ms-combo-tag">x{combo} COMBO</span>}
      </div>

      {/* PROGRESS */}
      <div className="ms-prog-wrap">
        <div className={`ms-prog-fill ${isFever ? 'fever' : ''}`} style={{ width: `${progPct}%` }} />
      </div>

      {/* COMBO TIMER */}
      {combo > 0 && (
        <div className="ms-combo-bar">
          <div className="ms-combo-fill" style={{ width: `${comboPct}%` }} />
        </div>
      )}

      {/* GRID */}
      <div className={`ms-grid-area ${deadFlash ? 'dead' : ''}`}>
        <div className="ms-grid" ref={gridRef}>
          {board.cells.map((rowCells, row) =>
            rowCells.map((cell, col) => {
              const key = `${row}-${col}`
              const isOpen = cell.opened
              const isMine = cell.isMine && cell.opened
              const isHit = hitMinePos !== null && hitMinePos[0] === row && hitMinePos[1] === col
              const isPop = isOpen && poppedKeys.has(key)
              const isXray = cell.xrayed && !cell.opened && !cell.flagged

              return (
                <button
                  key={key} type="button"
                  className={[
                    'ms-c',
                    isOpen ? 'open' : 'shut',
                    isMine && !isHit ? 'mine-show' : '',
                    isHit ? 'boom' : '',
                    cell.flagged && !isOpen ? 'flagged' : '',
                    cell.hinted && !isOpen ? 'hinted' : '',
                    isXray ? 'xrayed-mine' : '',
                    isPop ? 'pop' : '',
                  ].filter(Boolean).join(' ')}
                  disabled={gameOver || cell.opened}
                  onPointerDown={() => onPtrDown(row, col)}
                  onPointerUp={() => onPtrUp(row, col)}
                  onPointerLeave={onPtrLeave}
                  onContextMenu={(e) => onCtxMenu(e, row, col)}
                  aria-label={`cell ${row} ${col}`}
                >
                  {renderCell(cell, row, col)}
                </button>
              )
            }),
          )}
        </div>

        {showClearOverlay && (
          <div className="ms-clear-ov">
            <span className="ms-clear-big">CLEAR!!</span>
            <span className="ms-clear-sub">+BONUS</span>
          </div>
        )}

        {showLevelUp && (
          <div className="ms-lvlup-ov">
            <span className="ms-lvlup-txt">LEVEL {currentLevel + 1}!</span>
          </div>
        )}
      </div>

      {/* POWER BAR */}
      <div className="ms-pwr">
        <button type="button" className={`ms-pwr-btn ${flagMode ? 'active-flag' : ''}`} onClick={() => setFlagMode(!flagMode)}>
          <span className="ms-pwr-ico">P</span>
          <span>{flagMode ? 'ON' : 'FLAG'}</span>
        </button>
        <button type="button" className="ms-pwr-btn" onClick={useHint} disabled={score < HINT_COST || !board.minesPlaced || gameOver}>
          <span className="ms-pwr-ico">?</span>
          <span>HINT</span>
          <span className="ms-pwr-cost">-{HINT_COST}</span>
        </button>
        <button type="button" className="ms-pwr-btn" onClick={useShield} disabled={score < SHIELD_COST || hasShield || gameOver}>
          <span className="ms-pwr-ico">+</span>
          <span>SHLD</span>
          <span className="ms-pwr-cost">-{SHIELD_COST}</span>
        </button>
        <button type="button" className="ms-pwr-btn" onClick={useTimeBonus} disabled={score < TIME_BONUS_COST || gameOver}>
          <span className="ms-pwr-ico">T</span>
          <span>+10s</span>
          <span className="ms-pwr-cost">-{TIME_BONUS_COST}</span>
        </button>
        <button type="button" className="ms-pwr-btn" onClick={useXray} disabled={score < XRAY_COST || !board.minesPlaced || gameOver}>
          <span className="ms-pwr-ico">X</span>
          <span>XRAY</span>
          <span className="ms-pwr-cost">-{XRAY_COST}</span>
        </button>
      </div>

      {boardsCleared > 0 && getComboLabel(boardsCleared) !== '' && (
        <div style={{ textAlign: 'center', fontSize: 'clamp(0.4rem,1.5vw,0.55rem)', fontWeight: 800, color: getComboColor(boardsCleared), padding: '1px' }}>
          {getComboLabel(boardsCleared)}
        </div>
      )}

      <div className="ms-hint-row">
        <span>TAP:{flagMode ? 'FLAG' : 'DIG'}</span>
        <span>|</span>
        <span>HOLD:{flagMode ? 'DIG' : 'FLAG'}</span>
      </div>

      <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
      <ParticleRenderer particles={fx.particles} />
      <ScorePopupRenderer popups={fx.scorePopups} />
    </section>
  )
}

export const mineSweepMiniModule: MiniGameModule = {
  manifest: {
    id: 'mine-sweep-mini',
    title: 'Mine Sweep',
    description: 'Open all safe tiles avoiding mines!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#64748b',
  },
  Component: MineSweepMiniGame,
}
