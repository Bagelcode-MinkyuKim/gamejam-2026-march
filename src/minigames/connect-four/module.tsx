import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import dropSfxUrl from '../../../assets/sounds/connect-four-drop.mp3'
import winSfxUrl from '../../../assets/sounds/connect-four-win.mp3'
import loseSfxUrl from '../../../assets/sounds/connect-four-lose.mp3'
import drawSfxUrl from '../../../assets/sounds/connect-four-draw.mp3'
import comboSfxUrl from '../../../assets/sounds/connect-four-combo.mp3'
import feverSfxUrl from '../../../assets/sounds/connect-four-fever.mp3'
import hintSfxUrl from '../../../assets/sounds/connect-four-hint.mp3'
import hoverSfxUrl from '../../../assets/sounds/connect-four-hover.mp3'
import levelupSfxUrl from '../../../assets/sounds/connect-four-levelup.mp3'
import tickSfxUrl from '../../../assets/sounds/connect-four-tick.mp3'
import threatSfxUrl from '../../../assets/sounds/connect-four-threat.mp3'
import connectFourBgmLoop from '../../../assets/sounds/connect-four-bgm-loop.mp3'
import { getActiveBgmTrack, playBackgroundAudio as playSharedBgm, stopBackgroundAudio as stopSharedBgm } from '../../gui/sound-manager'

// ─── Constants ───────────────────────────────────────────
const COLS = 7
const ROWS = 6
const ROUND_DURATION_MS = 60000
const WIN_SCORE = 40
const DRAW_SCORE = 15
const AI_DELAY_MS = 400
const LOW_TIME_THRESHOLD_MS = 10000
const CRITICAL_TIME_MS = 5000
const DROP_ANIMATION_MS = 350
const STREAK_BONUS_PER_WIN = 10
const QUICK_WIN_MOVES = 10
const QUICK_WIN_BONUS = 20
const PERFECT_WIN_BONUS = 30
const FEVER_STREAK_THRESHOLD = 3
const FEVER_MULTIPLIER = 2
const MAX_HINTS = 3
const HINT_COOLDOWN_MS = 5000
const POWER_UP_INTERVAL_WINS = 3
const TIME_BONUS_PER_WIN_SEC = 5000
const COMBO_THRESHOLD = 2
const THREAT_CHECK_INTERVAL = 2
const CONNECT_FOUR_BGM_VOLUME = 0.2
const BOOST_COLUMN_SCORE = 12
const BOOST_COLUMN_TIME_BONUS_MS = 2500
const BOOST_MESSAGE_MS = 1400

// ─── Types ───────────────────────────────────────────────
type CellValue = 0 | 1 | 2
type Board = CellValue[][]
type GamePhase = 'player-turn' | 'ai-turn' | 'win' | 'lose' | 'draw' | 'idle'
type PowerUpType = 'double-turn' | 'column-clear' | 'undo' | 'time-bonus'

interface WinLine { readonly cells: ReadonlyArray<{ row: number; col: number }> }
interface PowerUp { readonly type: PowerUpType; readonly label: string; readonly icon: string }

const POWER_UPS: PowerUp[] = [
  { type: 'double-turn', label: 'DOUBLE', icon: 'x2' },
  { type: 'column-clear', label: 'CLEAR', icon: 'XX' },
  { type: 'undo', label: 'UNDO', icon: '<<' },
  { type: 'time-bonus', label: '+10s', icon: '+T' },
]

const WIN_EMOJIS = ['*', '+', 'o', '^'] as const

// ─── Board Logic ─────────────────────────────────────────
function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0))
}
function cloneBoard(b: Board): Board { return b.map(r => [...r]) }
function getAvailableRow(b: Board, c: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (b[r][c] === 0) return r
  return -1
}
function getAvailableCols(b: Board): number[] {
  return Array.from({ length: COLS }, (_, c) => c).filter(c => b[0][c] === 0)
}
function checkWinAt(b: Board, p: CellValue): WinLine | null {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (b[r][c] !== p) continue
    for (const [dr, dc] of dirs) {
      const cells = [{ row: r, col: c }]
      let ok = true
      for (let s = 1; s < 4; s++) {
        const nr = r + dr * s, nc = c + dc * s
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || b[nr][nc] !== p) { ok = false; break }
        cells.push({ row: nr, col: nc })
      }
      if (ok) return { cells }
    }
  }
  return null
}
function isBoardFull(b: Board): boolean { return b[0].every(v => v !== 0) }
function findWinningCol(b: Board, p: CellValue): number {
  for (let c = 0; c < COLS; c++) {
    const r = getAvailableRow(b, c)
    if (r === -1) continue
    const t = cloneBoard(b); t[r][c] = p
    if (checkWinAt(t, p)) return c
  }
  return -1
}

function countThreats(b: Board, p: CellValue): number[] {
  const threats = Array(COLS).fill(0)
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (let c = 0; c < COLS; c++) {
    const r = getAvailableRow(b, c)
    if (r === -1) continue
    const t = cloneBoard(b); t[r][c] = p
    for (const [dr, dc] of dirs) {
      let cnt = 1
      for (const d of [-1, 1]) for (let s = 1; s < 4; s++) {
        const nr = r + dr * s * d, nc = c + dc * s * d
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || t[nr][nc] !== p) break
        cnt++
      }
      if (cnt >= 3) threats[c] += cnt
    }
  }
  return threats
}

function hasThreeInRow(b: Board, p: CellValue): boolean {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (b[r][c] !== p) continue
    for (const [dr, dc] of dirs) {
      let cnt = 1
      for (let s = 1; s < 3; s++) {
        const nr = r + dr * s, nc = c + dc * s
        if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || b[nr][nc] !== p) break
        cnt++
      }
      if (cnt >= 3) return true
    }
  }
  return false
}

function aiChooseCol(b: Board, smart: number): number {
  const avail = getAvailableCols(b)
  if (avail.length === 0) return -1
  if (Math.random() > smart) return avail[Math.floor(Math.random() * avail.length)]
  const wc = findWinningCol(b, 2); if (wc !== -1) return wc
  const bc = findWinningCol(b, 1); if (bc !== -1) return bc
  const thr = countThreats(b, 2), pthr = countThreats(b, 1)
  let best = avail[0], bestS = -Infinity
  for (const c of avail) {
    const s = thr[c] * 2 - pthr[c] + (3 - Math.abs(c - 3)) * 0.5
    if (s > bestS) { bestS = s; best = c }
  }
  return best
}

function getAiSmartProb(w: number): number {
  if (w < 2) return 0.3; if (w < 4) return 0.5; if (w < 7) return 0.7; if (w < 10) return 0.85; return 1
}

function getHintCol(b: Board): number {
  const wc = findWinningCol(b, 1); if (wc !== -1) return wc
  const bc = findWinningCol(b, 2); if (bc !== -1) return bc
  const thr = countThreats(b, 1), avail = getAvailableCols(b)
  let best = avail[0], bestT = -1
  for (const c of avail) { const t = thr[c] + (3 - Math.abs(c - 3)) * 0.3; if (t > bestT) { bestT = t; best = c } }
  return best
}

function pickNextBoostColumn(previous: number | null): number {
  if (COLS <= 1) return 0
  const next = Math.floor(Math.random() * COLS)
  if (previous === null || next !== previous) return next
  return (next + 1 + Math.floor(Math.random() * (COLS - 1))) % COLS
}

// ─── Game Component ──────────────────────────────────────
function ConnectFourGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [board, setBoard] = useState<Board>(createEmptyBoard)
  const [phase, setPhase] = useState<GamePhase>('player-turn')
  const [score, setScore] = useState(0)
  const [wins, setWins] = useState(0)
  const [draws, setDraws] = useState(0)
  const [losses, setLosses] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [winLine, setWinLine] = useState<WinLine | null>(null)
  const [droppingCell, setDroppingCell] = useState<{ row: number; col: number } | null>(null)
  const [lastDropCol, setLastDropCol] = useState<number | null>(null)
  const [winStreak, setWinStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [hintCol, setHintCol] = useState<number | null>(null)
  const [hintsRemaining, setHintsRemaining] = useState(MAX_HINTS)
  const [hintCooldown, setHintCooldown] = useState(false)
  const [hoveredCol, setHoveredCol] = useState<number | null>(null)
  const [activePowerUp, setActivePowerUp] = useState<PowerUpType | null>(null)
  const [doubleTurnActive, setDoubleTurnActive] = useState(false)
  const [prevBoard, setPrevBoard] = useState<Board | null>(null)
  const [roundNumber, setRoundNumber] = useState(1)
  const [lastScoreGain, setLastScoreGain] = useState(0)
  const [comboCount, setComboCount] = useState(0)
  const [showThreatWarning, setShowThreatWarning] = useState(false)
  const [boostCol, setBoostCol] = useState(() => pickNextBoostColumn(null))
  const [boostReady, setBoostReady] = useState(true)
  const [boostMessage, setBoostMessage] = useState<string | null>(null)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const winStreakRef = useRef(0)
  const movesRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const aiTimerRef = useRef<number | null>(null)
  const dropTimerRef = useRef<number | null>(null)
  const hintTimerRef = useRef<number | null>(null)
  const winsRef = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const comboRef = useRef(0)
  const lastTickSfxRef = useRef(0)
  const perfectRef = useRef(true)
  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const boostMessageTimerRef = useRef<number | null>(null)

  const fx = useGameEffects({ maxParticles: 50 })
  const fxRef = useRef(fx)
  fxRef.current = fx

  const getAudio = useCallback((url: string) => {
    let a = audioPoolRef.current.get(url)
    if (!a) { a = new Audio(url); a.preload = 'auto'; audioPoolRef.current.set(url, a) }
    return a
  }, [])

  const sfx = useCallback((url: string, vol = 0.5, rate = 1) => {
    const a = getAudio(url); a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [getAudio])

  const ensureBgm = useCallback(() => {
    playSharedBgm(connectFourBgmLoop, CONNECT_FOUR_BGM_VOLUME)
  }, [])

  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const finish = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    for (const ref of [aiTimerRef, dropTimerRef, hintTimerRef]) { if (ref.current !== null) { window.clearTimeout(ref.current); ref.current = null } }
    onFinishRef.current({ score: scoreRef.current, durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)) })
  }, [])

  const showBoostNotice = useCallback((message: string) => {
    if (boostMessageTimerRef.current !== null) {
      window.clearTimeout(boostMessageTimerRef.current)
    }
    setBoostMessage(message)
    boostMessageTimerRef.current = window.setTimeout(() => {
      boostMessageTimerRef.current = null
      setBoostMessage(null)
    }, BOOST_MESSAGE_MS)
  }, [])

  const startNewRound = useCallback(() => {
    setBoard(createEmptyBoard())
    setPhase('player-turn')
    setWinLine(null); setDroppingCell(null); setLastDropCol(null); setHintCol(null)
    setPrevBoard(null); setDoubleTurnActive(false); setShowThreatWarning(false)
    setBoostCol((current) => pickNextBoostColumn(current))
    setBoostReady(true)
    setBoostMessage(null)
    movesRef.current = 0; perfectRef.current = true
    setRoundNumber(p => p + 1)

    sfx(levelupSfxUrl, 0.4)

    if (winsRef.current > 0 && winsRef.current % POWER_UP_INTERVAL_WINS === 0) {
      const rp = POWER_UPS[Math.floor(Math.random() * POWER_UPS.length)]
      setActivePowerUp(rp.type)
      sfx(comboSfxUrl, 0.5)
    }
  }, [sfx])

  const resolveRound = useCallback((result: 'win' | 'lose' | 'draw') => {
    let added = result === 'win' ? WIN_SCORE : result === 'draw' ? DRAW_SCORE : 0

    if (result === 'win') {
      const ns = winStreakRef.current + 1; winStreakRef.current = ns; setWinStreak(ns)
      const fever = ns >= FEVER_STREAK_THRESHOLD; setIsFever(fever)
      added += Math.min(ns, 5) * STREAK_BONUS_PER_WIN
      if (movesRef.current <= QUICK_WIN_MOVES) added += QUICK_WIN_BONUS
      if (perfectRef.current) added += PERFECT_WIN_BONUS
      if (fever) added *= FEVER_MULTIPLIER

      const nc = comboRef.current + 1; comboRef.current = nc; setComboCount(nc)
      if (nc >= COMBO_THRESHOLD) added += nc * 5

      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_WIN_SEC)

      winsRef.current++; setWins(p => p + 1); setPhase('win')
      sfx(winSfxUrl, 0.6)
      if (fever) setTimeout(() => sfx(feverSfxUrl, 0.5), 300)
      if (nc >= COMBO_THRESHOLD) setTimeout(() => sfx(comboSfxUrl, 0.4), 150)

      const rect = panelRef.current?.getBoundingClientRect()
      if (rect) {
        fxRef.current.comboHitBurst(rect.width / 2, rect.height / 2, ns, added, WIN_EMOJIS)
        fxRef.current.triggerShake(8, 250)
        for (let i = 0; i < 3; i++) setTimeout(() => fxRef.current.spawnParticles(4, rect.width * Math.random(), rect.height * 0.3, WIN_EMOJIS, 'circle'), i * 100)
      }
    } else if (result === 'lose') {
      winStreakRef.current = 0; setWinStreak(0); setIsFever(false)
      comboRef.current = 0; setComboCount(0); perfectRef.current = false
      setLosses(p => p + 1); setPhase('lose')
      sfx(loseSfxUrl, 0.5)
      fxRef.current.triggerFlash('rgba(255,0,77,0.35)', 200)
      fxRef.current.triggerShake(10, 200)
    } else {
      setDraws(p => p + 1); setPhase('draw')
      sfx(drawSfxUrl, 0.45)
    }

    setLastScoreGain(added)
    scoreRef.current += added; setScore(scoreRef.current)

    if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current)
    dropTimerRef.current = window.setTimeout(() => { dropTimerRef.current = null; if (!finishedRef.current) startNewRound() }, 1500)
  }, [sfx, startNewRound])

  const placePiece = useCallback((cur: Board, col: number, player: CellValue): Board | null => {
    const row = getAvailableRow(cur, col)
    if (row === -1) return null
    const next = cloneBoard(cur); next[row][col] = player
    setDroppingCell({ row, col }); setLastDropCol(col); setBoard(next); setHintCol(null)
    sfx(dropSfxUrl, 0.5, 0.8 + row * 0.06)

    const rect = panelRef.current?.getBoundingClientRect()
    if (rect) {
      const cw = (rect.width - 20) / COLS
      fxRef.current.spawnParticles(3, (rect.width - cw * COLS) / 2 + col * cw + cw / 2, rect.height * 0.22 + row * cw + cw / 2, undefined, 'circle')
    }

    if (player === 1 && boostReady && col === boostCol) {
      setBoostReady(false)
      setDoubleTurnActive(true)
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + BOOST_COLUMN_TIME_BONUS_MS)
      setRemainingMs(remainingMsRef.current)
      scoreRef.current += BOOST_COLUMN_SCORE
      setScore(scoreRef.current)
      showBoostNotice(`BOOST COL ${boostCol + 1}  +${BOOST_COLUMN_SCORE}  +2.5s`)
      sfx(feverSfxUrl, 0.44, 1.06)
      fxRef.current.triggerFlash('rgba(41,173,255,0.26)', 180)
      fxRef.current.triggerShake(6, 180)
      if (rect) {
        fxRef.current.comboHitBurst(rect.width / 2, rect.height * 0.3, 2, BOOST_COLUMN_SCORE, ['+', 'T', '!'])
      }
    }

    if (player === 2 && movesRef.current % THREAT_CHECK_INTERVAL === 0 && hasThreeInRow(next, 2)) {
      setShowThreatWarning(true); sfx(threatSfxUrl, 0.35)
      setTimeout(() => setShowThreatWarning(false), 1500)
    }

    const win = checkWinAt(next, player)
    if (win) { setWinLine(win); resolveRound(player === 1 ? 'win' : 'lose'); return next }
    if (isBoardFull(next)) { resolveRound('draw'); return next }
    return next
  }, [boostCol, boostReady, resolveRound, sfx, showBoostNotice])

  const runAi = useCallback((cur: Board) => {
    if (finishedRef.current) return
    if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current)
    aiTimerRef.current = window.setTimeout(() => {
      aiTimerRef.current = null; if (finishedRef.current) return
      const c = aiChooseCol(cur, getAiSmartProb(winStreakRef.current)); if (c === -1) return
      const next = placePiece(cur, c, 2); if (!next) return
      if (!checkWinAt(next, 2) && !isBoardFull(next)) setPhase('player-turn')
    }, AI_DELAY_MS)
  }, [placePiece])

  const handleClick = useCallback((col: number) => {
    if (finishedRef.current || phase !== 'player-turn') return
    setPrevBoard(cloneBoard(board))
    movesRef.current++
    const next = placePiece(board, col, 1); if (!next) return
    if (!checkWinAt(next, 1) && !isBoardFull(next)) {
      if (doubleTurnActive) { setDoubleTurnActive(false); sfx(comboSfxUrl, 0.4) }
      else { setPhase('ai-turn'); runAi(next) }
    }
  }, [board, phase, placePiece, runAi, doubleTurnActive, sfx])

  const triggerHint = useCallback(() => {
    if (hintsRemaining <= 0 || hintCooldown || phase !== 'player-turn') return
    setHintCol(getHintCol(board)); setHintsRemaining(p => p - 1); setHintCooldown(true); sfx(hintSfxUrl, 0.4)
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = window.setTimeout(() => { hintTimerRef.current = null; setHintCol(null); setHintCooldown(false) }, HINT_COOLDOWN_MS)
  }, [board, hintsRemaining, hintCooldown, phase, sfx])

  const activatePower = useCallback(() => {
    if (activePowerUp === null || phase !== 'player-turn') return
    if (activePowerUp === 'double-turn') { setDoubleTurnActive(true); sfx(feverSfxUrl, 0.4) }
    else if (activePowerUp === 'undo' && prevBoard) { setBoard(prevBoard); setPrevBoard(null); sfx(hintSfxUrl, 0.4) }
    else if (activePowerUp === 'time-bonus') { remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + 10000); sfx(levelupSfxUrl, 0.5); fxRef.current.triggerFlash('rgba(0,228,54,0.2)', 100) }
    else if (activePowerUp === 'column-clear') {
      const nb = cloneBoard(board)
      for (let r = 0; r < ROWS; r++) if (nb[r][3] === 2) nb[r][3] = 0
      for (let c = 0; c < COLS; c++) {
        const pcs: CellValue[] = []
        for (let r = ROWS - 1; r >= 0; r--) if (nb[r][c] !== 0) pcs.push(nb[r][c])
        for (let r = 0; r < ROWS; r++) nb[r][c] = 0
        for (let i = 0; i < pcs.length; i++) nb[ROWS - 1 - i][c] = pcs[i]
      }
      setBoard(nb); sfx(comboSfxUrl, 0.5); fxRef.current.triggerFlash('rgba(41,173,255,0.3)', 120)
    }
    setActivePowerUp(null)
  }, [activePowerUp, phase, board, prevBoard, sfx])

  useEffect(() => {
    const urls = [dropSfxUrl, winSfxUrl, loseSfxUrl, drawSfxUrl, comboSfxUrl, feverSfxUrl, hintSfxUrl, hoverSfxUrl, levelupSfxUrl, tickSfxUrl, threatSfxUrl]
    for (const u of urls) getAudio(u)
    return () => {
      for (const ref of [aiTimerRef, dropTimerRef, hintTimerRef, boostMessageTimerRef]) {
        if (ref.current !== null) window.clearTimeout(ref.current)
      }
      fxRef.current.cleanup()
    }
  }, [getAudio])

  useEffect(() => {
    ensureBgm()
    return () => {
      if (getActiveBgmTrack() === connectFourBgmLoop) {
        stopSharedBgm()
      }
    }
  }, [ensureBgm])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExitRef.current() } else if (e.code === 'KeyH') triggerHint() }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [triggerHint])

  useEffect(() => {
    lastFrameRef.current = null
    const step = (now: number) => {
      if (finishedRef.current) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS); lastFrameRef.current = now
      remainingMsRef.current = Math.max(0, remainingMsRef.current - dt); setRemainingMs(remainingMsRef.current)
      fxRef.current.updateParticles()
      if (remainingMsRef.current <= CRITICAL_TIME_MS && remainingMsRef.current > 0 && now - lastTickSfxRef.current > 1000) {
        sfx(tickSfxUrl, 0.2, 1.2); lastTickSfxRef.current = now
      }
      if (remainingMsRef.current <= 0) { sfx(loseSfxUrl, 0.6); finish(); rafRef.current = null; return }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); lastFrameRef.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isWinCell = useCallback((r: number, c: number) => winLine?.cells.some(cell => cell.row === r && cell.col === c) ?? false, [winLine])
  const isDrop = useCallback((r: number, c: number) => droppingCell?.row === r && droppingCell?.col === c, [droppingCell])

  const bestDisp = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLow = remainingMs <= LOW_TIME_THRESHOLD_MS
  const isCrit = remainingMs <= CRITICAL_TIME_MS
  const aiLv = Math.round(getAiSmartProb(winStreak) * 5)
  const pwInfo = activePowerUp ? POWER_UPS.find(p => p.type === activePowerUp) : null
  const timerPct = (remainingMs / ROUND_DURATION_MS) * 100
  const shakeStyle = fx.getShakeStyle()

  const phaseLabel = phase === 'player-turn' ? 'YOUR TURN'
    : phase === 'ai-turn' ? 'AI...'
    : phase === 'win' ? `WIN +${lastScoreGain}`
    : phase === 'lose' ? 'LOSE'
    : phase === 'draw' ? `DRAW +${lastScoreGain}` : ''

  return (
    <section ref={panelRef} className="mini-game-panel cf-panel" aria-label="connect-four-game"
      style={{ maxWidth: 520, aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...(shakeStyle ?? {}) }}>

      <div className="cf-scanlines" />

      {/* Timer */}
      <div className="cf-timer-wrap">
        <div className={`cf-timer-fill ${isLow ? 'cf-timer-low' : ''} ${isCrit ? 'cf-timer-crit' : ''}`} style={{ width: `${timerPct}%` }} />
        <span className="cf-timer-txt">{(remainingMs / 1000).toFixed(1)}s</span>
      </div>

      {/* Header */}
      <div className="cf-hdr">
        <div className="cf-hdr-side cf-hdr-side-left">
          <p className="cf-side-kicker">ROUND</p>
          <p className="cf-side-value">R{roundNumber}</p>
          <p className="cf-best-txt">BEST {bestDisp.toLocaleString()}</p>
        </div>
        <div className="cf-score-box">
          <p className="cf-score-label">SCORE</p>
          <p className="cf-score-num">{score.toLocaleString()}</p>
        </div>
        <div className="cf-hdr-side cf-hdr-side-right">
          <p className="cf-side-kicker">RECORD</p>
          <div className="cf-wdl">
            <span className="cf-stat-pill cf-w">W {wins}</span>
            <span className="cf-stat-pill cf-d">D {draws}</span>
            <span className="cf-stat-pill cf-l">L {losses}</span>
          </div>
        </div>
      </div>

      {/* Phase + effects */}
      <div className="cf-phase-box">
        <p className={`cf-phase cf-p-${phase}`}>{phaseLabel}</p>
        {isFever && <p className="cf-fever">FEVER x{FEVER_MULTIPLIER} STREAK {winStreak}</p>}
        {!isFever && winStreak >= 2 && <p className="cf-streak">STREAK {winStreak} // AI LV.{aiLv}</p>}
        {doubleTurnActive && <p className="cf-dbl">DOUBLE TURN!</p>}
        {comboCount >= COMBO_THRESHOLD && phase === 'win' && <p className="cf-combo">COMBO x{comboCount}!</p>}
        {showThreatWarning && <p className="cf-threat">!! DANGER !!</p>}
        {boostMessage ? (
          <p className="cf-boost-msg">{boostMessage}</p>
        ) : boostReady ? (
          <p className="cf-boost-tip">BOOST COL {boostCol + 1} = DOUBLE TURN + TIME</p>
        ) : (
          <p className="cf-boost-tip used">BOOST USED // NEXT ROUND REFRESH</p>
        )}
      </div>

      {/* Drop arrows */}
      <div className="cf-arrows">
        {Array.from({ length: COLS }, (_, c) => {
          const hinted = hintCol === c
          const avail = getAvailableRow(board, c) !== -1
          return (
            <button key={c} type="button"
              className={`cf-arr ${lastDropCol === c ? 'cf-arr-last' : ''} ${hinted ? 'cf-arr-hint' : ''} ${hoveredCol === c ? 'cf-arr-hov' : ''} ${boostReady && boostCol === c ? 'cf-arr-boost' : ''}`}
              onClick={() => handleClick(c)}
              onPointerEnter={() => { setHoveredCol(c); if (avail && phase === 'player-turn') sfx(hoverSfxUrl, 0.12, 0.9 + c * 0.08) }}
              onPointerLeave={() => setHoveredCol(null)}
              disabled={phase !== 'player-turn' || !avail}
              aria-label={`Col ${c + 1}`}
            >{hinted ? '!' : 'V'}</button>
          )
        })}
      </div>

      {/* Board */}
      <div className={`cf-board ${isFever ? 'cf-board-fever' : ''} ${isCrit ? 'cf-board-crit' : ''}`}>
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} className="cf-brow">
            {Array.from({ length: COLS }, (_, c) => {
              const v = board[r][c]
              const wc = isWinCell(r, c), dr = isDrop(r, c)
              const preview = hoveredCol === c && v === 0 && getAvailableRow(board, c) === r && phase === 'player-turn'
              return (
                <div key={`${r}-${c}`}
                  className={`cf-slot ${v === 1 ? 'cf-p1' : v === 2 ? 'cf-p2' : ''} ${wc ? 'cf-win' : ''} ${dr ? 'cf-dropping' : ''} ${preview ? 'cf-preview' : ''} ${boostReady && boostCol === c ? 'cf-slot-boost' : ''}`}
                  onClick={() => handleClick(c)}>
                  {(v !== 0 || preview) && (
                    <div className="cf-disc" style={dr ? { '--cf-dr': r } as React.CSSProperties : undefined}>
                      {v === 1 && <span className="cf-disc-face">P</span>}
                      {v === 2 && <span className="cf-disc-face">A</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Bottom bar */}
      <div className="cf-bottom">
        <button className={`cf-btn cf-btn-hint ${hintsRemaining <= 0 || hintCooldown ? 'cf-btn-off' : ''}`}
          type="button" onClick={triggerHint} disabled={hintsRemaining <= 0 || hintCooldown || phase !== 'player-turn'}>
          HINT({hintsRemaining})
        </button>
        {pwInfo && (
          <button className="cf-btn cf-btn-pw" type="button" onClick={activatePower} disabled={phase !== 'player-turn'}>
            [{pwInfo.icon}] {pwInfo.label}
          </button>
        )}
        <div className="cf-legend">
          <span><strong>{boostReady ? `B${boostCol + 1}` : 'BOOST'}</strong></span>
          <span><span className="cf-ldot cf-ldot-p" />YOU</span>
          <span><span className="cf-ldot cf-ldot-a" />AI</span>
        </div>
      </div>

      <ParticleRenderer particles={fx.particles} />
      <ScorePopupRenderer popups={fx.scorePopups} />
      <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />

      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .cf-panel {
          display: flex; flex-direction: column; align-items: center; gap: 7px;
          padding: 12px 10px 10px; width: 100%; max-width: 520px; margin: 0 auto;
          user-select: none; background: #1a1a2e;
          font-family: 'Press Start 2P', monospace; image-rendering: pixelated;
        }
        .cf-scanlines {
          position: absolute; inset: 0; pointer-events: none; z-index: 30;
          background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px);
        }

        .cf-timer-wrap { width: 100%; height: 22px; background: #0f0f23; border: 3px solid #29adff; position: relative; flex-shrink: 0; }
        .cf-timer-fill { height: 100%; background: #00e436; transition: width 0.3s linear; }
        .cf-timer-low { background: #ffa300; }
        .cf-timer-crit { background: #ff004d; animation: cf-blink 0.3s infinite alternate; }
        .cf-timer-txt { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 9px; color: #fff; text-shadow: 2px 2px 0 #000; }

        .cf-hdr { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; width: 100%; padding: 2px 0 4px; gap: 8px; flex-shrink: 0; }
        .cf-hdr-side { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .cf-hdr-side-right { align-items: flex-end; text-align: right; }
        .cf-side-kicker { margin: 0; color: #7e7e7e; font-size: 7px; letter-spacing: 1px; }
        .cf-side-value { margin: 0; color: #29adff; font-size: clamp(14px, 3vw, 18px); text-shadow: 2px 2px 0 #0f4a7a; }
        .cf-score-box {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          min-width: clamp(164px, 44vw, 230px); padding: 10px 12px 8px;
          border: 3px solid #ffa300; background: linear-gradient(180deg, rgba(53,30,16,0.9), rgba(22,16,38,0.95));
          box-shadow: 4px 4px 0 #0f0f23, inset 0 0 0 2px rgba(255,236,39,0.2);
        }
        .cf-score-label { margin: 0; color: #ffd36e; font-size: 8px; letter-spacing: 2px; }
        .cf-score-num { font-size: clamp(28px, 8vw, 44px); color: #ffec27; margin: 6px 0 0; text-align: center; text-shadow: 3px 3px 0 #a16207, 0 0 16px rgba(255,236,39,0.5); line-height: 1; }
        .cf-best-txt { font-size: 7px; color: #c7d2fe; margin: 0; }
        .cf-wdl { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 6px; }
        .cf-stat-pill { padding: 4px 7px; font-size: 8px; border: 2px solid; min-width: 42px; text-align: center; box-shadow: 2px 2px 0 rgba(0,0,0,0.3); }
        .cf-w { color: #00e436; border-color: #008f2b; background: rgba(0,228,54,0.08); }
        .cf-d { color: #ffec27; border-color: #a16207; background: rgba(255,236,39,0.08); }
        .cf-l { color: #ff6b8e; border-color: #ab0033; background: rgba(255,0,77,0.08); }

        .cf-phase-box { text-align: center; min-height: 54px; flex-shrink: 0; display: flex; flex-direction: column; justify-content: center; gap: 4px; }
        .cf-phase { font-size: clamp(12px, 3.3vw, 18px); margin: 0; letter-spacing: 2px; }
        .cf-p-player-turn { color: #ff004d; }
        .cf-p-ai-turn { color: #ffec27; animation: cf-blink 0.6s infinite alternate; }
        .cf-p-win { color: #00e436; animation: cf-bounce 0.4s ease-out; }
        .cf-p-lose { color: #ff004d; animation: cf-shake 0.4s ease-out; }
        .cf-p-draw { color: #83769c; }
        .cf-fever { margin: 0; color: #ffa300; font-size: 9px; animation: cf-glow 0.4s infinite alternate; text-shadow: 0 0 8px #ffa300; }
        .cf-streak { margin: 0; color: #00e436; font-size: 7px; }
        .cf-dbl { margin: 0; color: #29adff; font-size: 9px; animation: cf-bounce 0.3s ease-out; text-shadow: 0 0 6px #29adff; }
        .cf-combo { margin: 0; color: #ff77a8; font-size: 10px; animation: cf-bounce 0.3s ease-out; text-shadow: 0 0 6px #ff77a8; }
        .cf-threat { margin: 0; color: #ff004d; font-size: 10px; animation: cf-blink 0.2s infinite alternate; text-shadow: 0 0 10px #ff004d; }
        .cf-boost-tip, .cf-boost-msg { margin: 0; font-size: 8px; letter-spacing: 1px; }
        .cf-boost-tip { color: #7dd3fc; }
        .cf-boost-tip.used { color: #7e7e7e; }
        .cf-boost-msg { color: #ffec27; animation: cf-bounce 0.35s ease-out; text-shadow: 0 0 10px rgba(255,236,39,0.5); }

        .cf-arrows { display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 2px; width: 100%; padding: 0 2px; flex-shrink: 0; }
        .cf-arr {
          display: flex; align-items: center; justify-content: center;
          height: clamp(30px, 5vw, 38px); background: #1d2b53; border: 2px solid #29adff; color: #29adff;
          font-family: 'Press Start 2P', monospace; font-size: clamp(10px, 2.4vw, 13px); cursor: pointer; transition: all 0.1s;
        }
        .cf-arr:hover:not(:disabled) { background: #29adff; color: #fff; transform: translateY(-2px); box-shadow: 0 2px 0 #1d6ca5; }
        .cf-arr:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
        .cf-arr:disabled { opacity: 0.2; cursor: not-allowed; }
        .cf-arr-last { background: #29366f; }
        .cf-arr-hint { background: #00e436 !important; color: #fff !important; border-color: #00e436 !important; animation: cf-blink 0.4s infinite alternate; }
        .cf-arr-hov { background: #29366f; border-color: #ff004d; }
        .cf-arr-boost { border-color: #ffa300; color: #ffec27; background: linear-gradient(180deg, #362208, #1d2b53); box-shadow: inset 0 0 0 1px rgba(255,236,39,0.18); }

        .cf-board {
          display: flex; flex-direction: column; gap: 2px; background: #1d2b53;
          border: 3px solid #29adff; padding: clamp(8px, 1.6vw, 12px);
          flex: 1; min-height: 0; width: 100%;
          box-shadow: 4px 4px 0 #0f0f23, inset 0 0 20px rgba(41,173,255,0.1);
        }
        .cf-board-fever { border-color: #ffa300; box-shadow: 4px 4px 0 #0f0f23, 0 0 20px rgba(255,163,0,0.3); animation: cf-fever-border 0.8s infinite alternate; }
        .cf-board-crit { animation: cf-crit-pulse 0.5s infinite alternate; }

        .cf-brow { display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 2px; flex: 1; }
        .cf-slot {
          aspect-ratio: 1; background: #0f0f23; border: 2px solid #29366f;
          display: flex; align-items: center; justify-content: center;
          position: relative; cursor: pointer; transition: border-color 0.15s;
        }
        .cf-slot:hover { border-color: #5f6f9f; }
        .cf-slot-boost { background: radial-gradient(circle at 50% 35%, rgba(255,236,39,0.14), #0f0f23 72%); border-color: #7c5a11; }

        .cf-disc { width: 80%; height: 80%; display: flex; align-items: center; justify-content: center; }
        .cf-disc-face { font-size: clamp(8px, 1.8vw, 12px); color: rgba(255,255,255,0.6); }

        .cf-p1 .cf-disc { background: #ff004d; border: 2px solid #ab0033; box-shadow: inset -2px -2px 0 #ab0033, inset 2px 2px 0 #ff77a8, 2px 2px 0 rgba(0,0,0,0.4); }
        .cf-p2 .cf-disc { background: #ffec27; border: 2px solid #a16207; box-shadow: inset -2px -2px 0 #a16207, inset 2px 2px 0 #fff1a8, 2px 2px 0 rgba(0,0,0,0.4); }
        .cf-preview .cf-disc { background: rgba(255,0,77,0.2); border: 2px dashed #ff004d; box-shadow: none; animation: cf-blink 1s infinite alternate; }

        .cf-win .cf-disc { animation: cf-win-flash 0.3s infinite alternate; }
        .cf-win::after { content: ''; position: absolute; inset: -2px; border: 2px solid #fff; animation: cf-win-border 0.6s infinite alternate; }
        .cf-dropping .cf-disc { animation: cf-drop ${DROP_ANIMATION_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1); }

        .cf-bottom { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 2px 2px; flex-shrink: 0; }
        .cf-btn { padding: 7px 10px; font-family: 'Press Start 2P', monospace; font-size: 8px; cursor: pointer; transition: all 0.1s; border: 2px solid; }
        .cf-btn-hint { background: #00e436; border-color: #008f2b; color: #fff; box-shadow: 2px 2px 0 #005c1a; }
        .cf-btn-hint:hover:not(:disabled) { background: #00ff4d; transform: translateY(-1px); }
        .cf-btn-pw { background: #29adff; border-color: #1d6ca5; color: #fff; box-shadow: 2px 2px 0 #0f4a7a; animation: cf-bounce 0.5s ease-out; }
        .cf-btn-pw:hover:not(:disabled) { background: #5fc9ff; transform: translateY(-1px); }
        .cf-btn-off { opacity: 0.3; cursor: not-allowed; }

        .cf-legend { display: flex; gap: 8px; font-size: 7px; color: #7e7e7e; margin-left: auto; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
        .cf-legend span { display: flex; align-items: center; gap: 3px; }
        .cf-legend strong { color: #7dd3fc; }
        .cf-ldot { display: inline-block; width: 8px; height: 8px; }
        .cf-ldot-p { background: #ff004d; border: 1px solid #ab0033; }
        .cf-ldot-a { background: #ffec27; border: 1px solid #a16207; }

        @keyframes cf-blink { from { opacity: 1; } to { opacity: 0.3; } }
        @keyframes cf-bounce { 0% { transform: scale(1); } 40% { transform: scale(1.3); } 100% { transform: scale(1); } }
        @keyframes cf-shake { 0%,100% { transform: translateX(0); } 20% { transform: translateX(-4px); } 40% { transform: translateX(4px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(3px); } }
        @keyframes cf-glow { from { opacity: 0.7; } to { opacity: 1; } }
        @keyframes cf-win-flash {
          from { box-shadow: inset -2px -2px 0 rgba(0,0,0,0.3), 0 0 4px #fff; transform: scale(1); }
          to { box-shadow: inset -2px -2px 0 rgba(0,0,0,0.3), 0 0 12px #fff; transform: scale(1.08); }
        }
        @keyframes cf-win-border { from { border-color: rgba(255,255,255,0.4); } to { border-color: rgba(255,255,255,1); } }
        @keyframes cf-drop {
          from { transform: translateY(calc(var(--cf-dr, 0) * -100% - 100%)); opacity: 0.5; }
          60% { opacity: 1; } to { transform: translateY(0); opacity: 1; }
        }
        @keyframes cf-fever-border { from { border-color: rgba(255,163,0,0.4); } to { border-color: rgba(255,163,0,1); } }
        @keyframes cf-crit-pulse {
          from { box-shadow: 4px 4px 0 #0f0f23, 0 0 0 rgba(255,0,77,0); }
          to { box-shadow: 4px 4px 0 #0f0f23, 0 0 20px rgba(255,0,77,0.4); }
        }
      `}</style>
    </section>
  )
}

export const connectFourModule: MiniGameModule = {
  manifest: {
    id: 'connect-four',
    title: 'Connect Four',
    description: 'Beat AI at Connect Four! First to connect 4 wins!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.25,
    accentColor: '#ff004d',
  },
  Component: ConnectFourGame,
}
