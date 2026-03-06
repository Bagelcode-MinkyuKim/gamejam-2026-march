import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

import placeSfx from '../../../assets/sounds/tic-tac-place.mp3'
import winSfx from '../../../assets/sounds/tic-tac-win.mp3'
import loseSfx from '../../../assets/sounds/tic-tac-lose.mp3'
import drawSfx from '../../../assets/sounds/tic-tac-draw.mp3'
import feverSfx from '../../../assets/sounds/tic-tac-fever.mp3'
import comboSfx from '../../../assets/sounds/tic-tac-combo.mp3'
import powerupSfx from '../../../assets/sounds/tic-tac-powerup.mp3'
import warningSfx from '../../../assets/sounds/tic-tac-warning.mp3'
import perfectSfx from '../../../assets/sounds/tic-tac-perfect.mp3'
import tickSfx from '../../../assets/sounds/tic-tac-tick.mp3'
import newroundSfx from '../../../assets/sounds/tic-tac-newround.mp3'
import explosionSfx from '../../../assets/sounds/tic-tac-explosion.mp3'

/* ── Constants ────────────────────────────────── */
const ROUND_DURATION_MS = 60000
const AI_MOVE_DELAY_MS = 260
const SCORE_WIN = 30
const SCORE_DRAW = 10
const SCORE_LOSE = 0
const LOW_TIME_THRESHOLD_MS = 10000
const FEVER_THRESHOLD = 3
const FEVER_MULTIPLIER = 2
const QUICK_WIN_MOVES = 5
const QUICK_WIN_BONUS = 15
const PERFECT_BONUS = 25
const TIME_BONUS_PER_SEC = 2
const POWERUP_INTERVAL_WINS = 4
const POWERUP_TIME_BONUS_MS = 5000
const POWERUP_DOUBLE_ROUNDS = 1
const GOLDEN_CELL_BONUS = 20
const BOMB_CELL_PENALTY = -10
const SPECIAL_CELL_CHANCE = 0.18
const TICK_INTERVAL_MS = 1000

const WINNING_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const

/* ── Types ────────────────────────────────────── */
type CellValue = null | 'O' | 'X'
type BoardState = readonly [CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue]
type GameOutcome = 'win' | 'draw' | 'lose' | null
type PowerupType = 'hint' | 'time' | 'double' | 'freeze'
type SpecialCell = null | 'golden' | 'bomb'
type AIEmotion = 'idle' | 'thinking' | 'happy' | 'angry' | 'shocked'

const EMPTY_BOARD: BoardState = [null, null, null, null, null, null, null, null, null]
const EMPTY_SPECIALS: readonly SpecialCell[] = [null, null, null, null, null, null, null, null, null]

/* AI Emotion faces (pixel art text) */
const AI_FACES: Record<AIEmotion, string> = {
  idle: '(^_^)',
  thinking: '(o.o)',
  happy: '(>w<)',
  angry: '(>_<)',
  shocked: '(O_O)',
}

/* ── Pure Functions ───────────────────────────── */
function checkWinner(board: BoardState): CellValue {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) return board[a]
  }
  return null
}

function getWinningLine(board: BoardState): readonly [number, number, number] | null {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line
    if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) return line
  }
  return null
}

function isBoardFull(board: BoardState): boolean {
  return board.every((cell) => cell !== null)
}

function getEmptyCells(board: BoardState): number[] {
  const empty: number[] = []
  for (let i = 0; i < 9; i += 1) if (board[i] === null) empty.push(i)
  return empty
}

function placeOnBoard(board: BoardState, index: number, value: CellValue): BoardState {
  const next = [...board] as [CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue]
  next[index] = value
  return next
}

function minimax(board: BoardState, isMaximizing: boolean, depth: number): number {
  const winner = checkWinner(board)
  if (winner === 'X') return 10 - depth
  if (winner === 'O') return depth - 10
  if (isBoardFull(board)) return 0
  const emptyCells = getEmptyCells(board)
  if (isMaximizing) {
    let best = -Infinity
    for (const cell of emptyCells) best = Math.max(best, minimax(placeOnBoard(board, cell, 'X'), false, depth + 1))
    return best
  }
  let best = Infinity
  for (const cell of emptyCells) best = Math.min(best, minimax(placeOnBoard(board, cell, 'O'), true, depth + 1))
  return best
}

function aiMoveRandom(board: BoardState): number {
  const empty = getEmptyCells(board)
  return empty.length === 0 ? -1 : empty[Math.floor(Math.random() * empty.length)]
}

function aiMoveSmart(board: BoardState): number {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1
  let bestScore = -Infinity
  let bestMove = empty[0]
  for (const cell of empty) {
    const s = minimax(placeOnBoard(board, cell, 'X'), false, 0)
    if (s > bestScore) { bestScore = s; bestMove = cell }
  }
  return bestMove
}

function aiMoveHybrid(board: BoardState, smartProb: number): number {
  return Math.random() < smartProb ? aiMoveSmart(board) : aiMoveRandom(board)
}

function getDifficulty(totalScore: number): number {
  if (totalScore < 30) return 0.0
  if (totalScore < 80) return 0.2
  if (totalScore < 150) return 0.4
  if (totalScore < 250) return 0.6
  if (totalScore < 400) return 0.8
  return 1.0
}

function getDifficultyLabel(d: number): string {
  if (d <= 0) return 'Lv1'
  if (d <= 0.2) return 'Lv2'
  if (d <= 0.4) return 'Lv3'
  if (d <= 0.6) return 'Lv4'
  if (d <= 0.8) return 'Lv5'
  return 'MAX'
}

function generateSpecialCells(): SpecialCell[] {
  const specials: SpecialCell[] = [null, null, null, null, null, null, null, null, null]
  for (let i = 0; i < 9; i++) {
    if (Math.random() < SPECIAL_CELL_CHANCE) specials[i] = Math.random() < 0.65 ? 'golden' : 'bomb'
  }
  return specials
}

function getHintCell(board: BoardState): number | null {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return null
  for (const cell of empty) { if (checkWinner(placeOnBoard(board, cell, 'O')) === 'O') return cell }
  for (const cell of empty) { if (checkWinner(placeOnBoard(board, cell, 'X')) === 'X') return cell }
  if (board[4] === null) return 4
  return empty[Math.floor(Math.random() * empty.length)]
}

function countPlayerMoves(board: BoardState): number {
  return board.filter((c) => c === 'O').length
}

/* ── Pixel Art O & X Components ──────────────── */
function PixelO({ size, glow }: { size: number; glow?: boolean }) {
  const px = Math.max(2, Math.floor(size / 7))
  return (
    <div className={`px-o ${glow ? 'px-glow-o' : ''}`} style={{
      width: size, height: size, position: 'relative', imageRendering: 'pixelated',
    }}>
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        boxShadow: `
          ${px}px 0 0 #0d9488, ${px * 2}px 0 0 #0d9488, ${px * 3}px 0 0 #0d9488,
          0 ${px}px 0 #0d9488, ${px * 4}px ${px}px 0 #0d9488,
          0 ${px * 2}px 0 #0d9488, ${px * 4}px ${px * 2}px 0 #0d9488,
          0 ${px * 3}px 0 #0d9488, ${px * 4}px ${px * 3}px 0 #0d9488,
          ${px}px ${px * 4}px 0 #0d9488, ${px * 2}px ${px * 4}px 0 #0d9488, ${px * 3}px ${px * 4}px 0 #0d9488
        `,
        width: `${px}px`, height: `${px}px`, background: 'transparent',
      }} />
    </div>
  )
}

function PixelX({ size, glow }: { size: number; glow?: boolean }) {
  const px = Math.max(2, Math.floor(size / 7))
  return (
    <div className={`px-x ${glow ? 'px-glow-x' : ''}`} style={{
      width: size, height: size, position: 'relative', imageRendering: 'pixelated',
    }}>
      <div style={{
        position: 'absolute',
        left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
        boxShadow: `
          0 0 0 #ef4444, ${px * 4}px 0 0 #ef4444,
          ${px}px ${px}px 0 #ef4444, ${px * 3}px ${px}px 0 #ef4444,
          ${px * 2}px ${px * 2}px 0 #ef4444,
          ${px}px ${px * 3}px 0 #ef4444, ${px * 3}px ${px * 3}px 0 #ef4444,
          0 ${px * 4}px 0 #ef4444, ${px * 4}px ${px * 4}px 0 #ef4444
        `,
        width: `${px}px`, height: `${px}px`, background: 'transparent',
      }} />
    </div>
  )
}

/* ── Pixel Explosion Component ───────────────── */
function PixelExplosion({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <div className="px-explosion" style={{ left: x, top: y }}>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-explosion-particle" style={{
          '--angle': `${i * 45}deg`,
          '--dist': `${20 + Math.random() * 30}px`,
          '--delay': `${Math.random() * 0.1}s`,
          background: color,
        } as React.CSSProperties} />
      ))}
    </div>
  )
}

/* ── Timer Bar Component ─────────────────────── */
function TimerBar({ remainingMs, totalMs, isLow }: { remainingMs: number; totalMs: number; isLow: boolean }) {
  const pct = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100))
  return (
    <div className="ttp-timer-bar-wrap">
      <div
        className={`ttp-timer-bar-fill ${isLow ? 'timer-danger' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/* ── Main Game Component ─────────────────────── */
function TicTacProGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD)
  const [specialCells, setSpecialCells] = useState<readonly SpecialCell[]>(EMPTY_SPECIALS)
  const [isPlayerTurn, setIsPlayerTurn] = useState(true)
  const [outcome, setOutcome] = useState<GameOutcome>(null)
  const [winningLine, setWinningLine] = useState<readonly [number, number, number] | null>(null)
  const [score, setScore] = useState(0)
  const [wins, setWins] = useState(0)
  const [draws, setDraws] = useState(0)
  const [losses, setLosses] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [roundTransition, setRoundTransition] = useState(false)
  const [winStreak, setWinStreak] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [movesThisRound, setMovesThisRound] = useState(0)
  const [doubleScoreRounds, setDoubleScoreRounds] = useState(0)
  const [hintCell, setHintCell] = useState<number | null>(null)
  const [cellAnimations, setCellAnimations] = useState<Record<number, string>>({})
  const [showPowerupPicker, setShowPowerupPicker] = useState(false)
  const [roundNumber, setRoundNumber] = useState(1)
  const [aiEmotion, setAiEmotion] = useState<AIEmotion>('idle')
  const [explosions, setExplosions] = useState<{ id: number; x: number; y: number; color: string }[]>([])
  const [isPerfect, setIsPerfect] = useState(false)
  const [boardAppear, setBoardAppear] = useState(true)
  const [, setLastTickSec] = useState(-1)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const aiTimerRef = useRef<number | null>(null)
  const roundTransitionTimerRef = useRef<number | null>(null)
  const boardRef = useRef<BoardState>(EMPTY_BOARD)
  const isPlayerTurnRef = useRef(true)
  const outcomeRef = useRef<GameOutcome>(null)
  const winStreakRef = useRef(0)
  const movesThisRoundRef = useRef(0)
  const totalWinsRef = useRef(0)
  const doubleScoreRoundsRef = useRef(0)
  const explosionIdRef = useRef(0)
  const lastTickSecRef = useRef(-1)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null }
  }

  const playAudio = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const spawnExplosion = useCallback((x: number, y: number, color: string) => {
    const id = explosionIdRef.current++
    setExplosions((prev) => [...prev, { id, x, y, color }])
    setTimeout(() => setExplosions((prev) => prev.filter((e) => e.id !== id)), 600)
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(aiTimerRef)
    clearTimeoutSafe(roundTransitionTimerRef)
    playAudio('lose', 0.6, 0.95)
    onFinish({ score: scoreRef.current, durationMs: Math.round(Math.max(16.66, ROUND_DURATION_MS - remainingMsRef.current)) })
  }, [onFinish, playAudio])

  const startNewRound = useCallback(() => {
    const newSpecials = generateSpecialCells()
    boardRef.current = EMPTY_BOARD
    isPlayerTurnRef.current = true
    outcomeRef.current = null
    movesThisRoundRef.current = 0
    setBoard(EMPTY_BOARD)
    setSpecialCells(newSpecials)
    setIsPlayerTurn(true)
    setOutcome(null)
    setWinningLine(null)
    setRoundTransition(false)
    setMovesThisRound(0)
    setHintCell(null)
    setCellAnimations({})
    setRoundNumber((prev) => prev + 1)
    setAiEmotion('idle')
    setIsPerfect(false)
    setBoardAppear(true)
    setTimeout(() => setBoardAppear(false), 400)
    playAudio('newround', 0.4, 1.0 + Math.random() * 0.1)

    if (doubleScoreRoundsRef.current > 0) {
      doubleScoreRoundsRef.current -= 1
      setDoubleScoreRounds(doubleScoreRoundsRef.current)
    }
  }, [playAudio])

  const handlePowerupSelect = useCallback((type: PowerupType) => {
    setShowPowerupPicker(false)
    playAudio('powerup', 0.65)

    if (type === 'hint') {
      const hint = getHintCell(boardRef.current)
      setHintCell(hint)
      if (hint !== null) effects.showScorePopup(5, 200, 200)
    } else if (type === 'time') {
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + POWERUP_TIME_BONUS_MS)
      setRemainingMs(remainingMsRef.current)
      effects.triggerFlash('rgba(59,130,246,0.4)')
      effects.showScorePopup(5, 200, 200)
    } else if (type === 'double') {
      doubleScoreRoundsRef.current = POWERUP_DOUBLE_ROUNDS
      setDoubleScoreRounds(POWERUP_DOUBLE_ROUNDS)
      effects.triggerFlash('rgba(250,204,21,0.4)')
    } else if (type === 'freeze') {
      // AI can't move for next round - skip AI difficulty boost
      effects.triggerFlash('rgba(147,197,253,0.5)')
    }
  }, [playAudio, effects])

  const resolveRound = useCallback(
    (currentBoard: BoardState) => {
      const winner = checkWinner(currentBoard)
      const full = isBoardFull(currentBoard)
      if (winner === null && !full) return

      let roundOutcome: GameOutcome
      let roundScore: number
      const playerMoves = countPlayerMoves(currentBoard)

      if (winner === 'O') {
        roundOutcome = 'win'
        const nextStreak = winStreakRef.current + 1
        winStreakRef.current = nextStreak
        setWinStreak(nextStreak)
        const nextTotalWins = totalWinsRef.current + 1
        totalWinsRef.current = nextTotalWins

        const feverActive = nextStreak >= FEVER_THRESHOLD
        setIsFever(feverActive)

        roundScore = SCORE_WIN
        if (movesThisRoundRef.current <= QUICK_WIN_MOVES) roundScore += QUICK_WIN_BONUS

        // Perfect bonus: won using minimum possible moves (3)
        const isPerfectWin = playerMoves === 3
        if (isPerfectWin) {
          roundScore += PERFECT_BONUS
          setIsPerfect(true)
          playAudio('perfect', 0.7)
        }

        // Time bonus: faster = more points
        const secsLeft = Math.floor(remainingMsRef.current / 1000)
        const timeBonus = Math.floor(secsLeft * TIME_BONUS_PER_SEC * 0.1)
        roundScore += timeBonus

        if (feverActive) roundScore *= FEVER_MULTIPLIER
        if (doubleScoreRoundsRef.current > 0) roundScore *= 2

        setWins((prev) => prev + 1)
        setAiEmotion(isPerfectWin ? 'shocked' : 'angry')
        playAudio('win', 0.7, feverActive ? 1.3 : 1.1)
        if (nextStreak >= 2) playAudio('combo', 0.5, 1 + nextStreak * 0.1)
        if (feverActive && nextStreak === FEVER_THRESHOLD) playAudio('fever', 0.7)

        // Pixel explosions on winning cells
        const wLine = getWinningLine(currentBoard)
        if (wLine) {
          wLine.forEach((idx, i) => {
            const cx = (idx % 3) * 33.3 + 16
            const cy = Math.floor(idx / 3) * 33.3 + 16
            setTimeout(() => {
              setCellAnimations((prev) => ({ ...prev, [idx]: 'win-cell-pop' }))
              spawnExplosion(cx, cy, '#0d9488')
              playAudio('explosion', 0.3, 1.2 + i * 0.15)
            }, i * 120)
          })
        }

        effects.comboHitBurst(200, 300, nextStreak, roundScore)
        if (feverActive) effects.triggerFlash('rgba(250,204,21,0.5)')
        if (isPerfectWin) {
          for (let i = 0; i < 5; i++) {
            setTimeout(() => spawnExplosion(
              Math.random() * 80 + 10,
              Math.random() * 80 + 10,
              ['#fbbf24', '#0d9488', '#3b82f6', '#a855f7', '#ef4444'][i],
            ), i * 80)
          }
        }

        if (nextTotalWins > 0 && nextTotalWins % POWERUP_INTERVAL_WINS === 0) {
          setTimeout(() => setShowPowerupPicker(true), 700)
        }
      } else if (winner === 'X') {
        roundOutcome = 'lose'
        roundScore = SCORE_LOSE
        winStreakRef.current = 0
        setWinStreak(0)
        setIsFever(false)
        setLosses((prev) => prev + 1)
        setAiEmotion('happy')
        playAudio('lose', 0.5, 0.8)
        effects.triggerFlash('rgba(239,68,68,0.4)')
        effects.triggerShake(10)

        // Crack effect on losing
        const wLine = getWinningLine(currentBoard)
        if (wLine) {
          wLine.forEach((idx, i) => {
            setTimeout(() => spawnExplosion(
              (idx % 3) * 33.3 + 16,
              Math.floor(idx / 3) * 33.3 + 16,
              '#ef4444',
            ), i * 80)
          })
        }
      } else {
        roundOutcome = 'draw'
        roundScore = SCORE_DRAW
        if (doubleScoreRoundsRef.current > 0) roundScore *= 2
        setDraws((prev) => prev + 1)
        setAiEmotion('idle')
        playAudio('draw', 0.55, 0.95)
        effects.triggerFlash('rgba(250,204,21,0.3)')
        effects.showScorePopup(roundScore, 200, 280)
      }

      outcomeRef.current = roundOutcome
      setOutcome(roundOutcome)
      setWinningLine(getWinningLine(currentBoard))

      const nextScore = scoreRef.current + roundScore
      scoreRef.current = nextScore
      setScore(nextScore)

      setRoundTransition(true)
      clearTimeoutSafe(roundTransitionTimerRef)
      roundTransitionTimerRef.current = window.setTimeout(() => {
        roundTransitionTimerRef.current = null
        if (!finishedRef.current) startNewRound()
      }, 1400)
    },
    [playAudio, startNewRound, effects, spawnExplosion],
  )

  const performAiMove = useCallback(
    (currentBoard: BoardState) => {
      if (finishedRef.current) return
      if (checkWinner(currentBoard) !== null || isBoardFull(currentBoard)) return
      const difficulty = getDifficulty(scoreRef.current)
      const aiCell = aiMoveHybrid(currentBoard, difficulty)
      if (aiCell < 0) return

      const nextBoard = placeOnBoard(currentBoard, aiCell, 'X')
      boardRef.current = nextBoard
      setBoard(nextBoard)
      setCellAnimations((prev) => ({ ...prev, [aiCell]: 'cell-place-bounce' }))
      isPlayerTurnRef.current = true
      setIsPlayerTurn(true)
      setAiEmotion('idle')
      playAudio('place', 0.35, 0.85)

      const col = aiCell % 3
      const row = Math.floor(aiCell / 3)
      effects.spawnParticles(3, col * 120 + 60, row * 120 + 60)

      resolveRound(nextBoard)
    },
    [playAudio, resolveRound, effects],
  )

  const handleCellClick = useCallback(
    (index: number) => {
      if (finishedRef.current || outcomeRef.current !== null || !isPlayerTurnRef.current || boardRef.current[index] !== null || showPowerupPicker) return

      const nextBoard = placeOnBoard(boardRef.current, index, 'O')
      boardRef.current = nextBoard
      movesThisRoundRef.current += 1
      setMovesThisRound(movesThisRoundRef.current)
      setBoard(nextBoard)
      setHintCell(null)
      setCellAnimations((prev) => ({ ...prev, [index]: 'cell-place-bounce' }))
      playAudio('place', 0.5, 1.0 + Math.random() * 0.15)

      const col = index % 3
      const row = Math.floor(index / 3)
      effects.spawnParticles(6, col * 120 + 60, row * 120 + 60)
      effects.triggerShake(3)

      // Special cell effects
      const special = specialCells[index]
      if (special === 'golden') {
        const nextScore = scoreRef.current + GOLDEN_CELL_BONUS
        scoreRef.current = nextScore
        setScore(nextScore)
        effects.showScorePopup(GOLDEN_CELL_BONUS, col * 120 + 60, row * 120 + 60)
        playAudio('combo', 0.6, 1.3)
        spawnExplosion(col * 33.3 + 16, row * 33.3 + 16, '#fbbf24')
        effects.triggerFlash('rgba(250,204,21,0.3)')
      } else if (special === 'bomb') {
        const nextScore = Math.max(0, scoreRef.current + BOMB_CELL_PENALTY)
        scoreRef.current = nextScore
        setScore(nextScore)
        effects.showScorePopup(BOMB_CELL_PENALTY, col * 120 + 60, row * 120 + 60)
        playAudio('explosion', 0.6, 0.8)
        spawnExplosion(col * 33.3 + 16, row * 33.3 + 16, '#ef4444')
        effects.triggerShake(12)
        effects.triggerFlash('rgba(239,68,68,0.5)')
      }

      const winner = checkWinner(nextBoard)
      const full = isBoardFull(nextBoard)
      if (winner !== null || full) { resolveRound(nextBoard); return }

      isPlayerTurnRef.current = false
      setIsPlayerTurn(false)
      setAiEmotion('thinking')
      clearTimeoutSafe(aiTimerRef)
      aiTimerRef.current = window.setTimeout(() => { aiTimerRef.current = null; performAiMove(nextBoard) }, AI_MOVE_DELAY_MS)
    },
    [performAiMove, playAudio, resolveRound, effects, specialCells, showPowerupPicker, spawnExplosion],
  )

  const handleExit = useCallback(() => { playAudio('place', 0.4); onExit() }, [onExit, playAudio])

  useEffect(() => {
    const sounds: Record<string, string> = {
      place: placeSfx, win: winSfx, lose: loseSfx, draw: drawSfx,
      fever: feverSfx, combo: comboSfx, powerup: powerupSfx, warning: warningSfx,
      perfect: perfectSfx, tick: tickSfx, newround: newroundSfx, explosion: explosionSfx,
    }
    for (const [key, src] of Object.entries(sounds)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }
    setSpecialCells(generateSpecialCells())
    setBoardAppear(true)
    setTimeout(() => setBoardAppear(false), 400)
    return () => {
      clearTimeoutSafe(aiTimerRef)
      clearTimeoutSafe(roundTransitionTimerRef)
      audioRefs.current = {}
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); handleExit() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)
      effects.updateParticles()

      // Tick sound every second in low time
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > 0) {
        const currentSec = Math.ceil(remainingMsRef.current / TICK_INTERVAL_MS)
        if (currentSec !== lastTickSecRef.current) {
          lastTickSecRef.current = currentSec
          setLastTickSec(currentSec)
          if (currentSec <= 10) {
            playAudio('tick', 0.3 + (10 - currentSec) * 0.04, 1.0 + (10 - currentSec) * 0.05)
          }
          if (currentSec === 10) playAudio('warning', 0.5)
        }
      }

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
      lastFrameAtRef.current = null
    }
  }, [finishGame, playAudio])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const difficulty = getDifficulty(score)
  const diffLabel = getDifficultyLabel(difficulty)
  const cellSize = 70 // px for pixel art marks

  const outcomeLabel = outcome === 'win'
    ? isPerfect ? 'PERFECT!' : `WIN +${SCORE_WIN}${movesThisRound <= QUICK_WIN_MOVES ? ' QUICK!' : ''}`
    : outcome === 'draw' ? `DRAW +${SCORE_DRAW}`
    : outcome === 'lose' ? 'LOSE...'
    : null

  return (
    <section className="mini-game-panel tic-tac-pro-panel" aria-label="tic-tac-pro-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{TIC_TAC_PRO_CSS}</style>

      {/* CRT Scanline Overlay */}
      <div className="ttp-scanlines" />

      {/* Top HUD */}
      <div className="ttp-hud">
        <div className="ttp-hud-left">
          <p className="ttp-score-label">SCORE</p>
          <p className="ttp-score">{score.toLocaleString()}</p>
        </div>
        <div className="ttp-hud-center">
          <p className="ttp-round-badge">R{roundNumber}</p>
          <p className="ttp-ai-face">{AI_FACES[aiEmotion]}</p>
        </div>
        <div className="ttp-hud-right">
          <p className="ttp-time">{(remainingMs / 1000).toFixed(1)}</p>
          <p className="ttp-best-label">HI {displayedBestScore.toLocaleString()}</p>
        </div>
      </div>

      {/* Timer Bar */}
      <TimerBar remainingMs={remainingMs} totalMs={ROUND_DURATION_MS} isLow={isLowTime} />

      {/* Stats Strip */}
      <div className="ttp-stats">
        <span className="ttp-s-item"><span className="ttp-s-w">W</span>{wins}</span>
        <span className="ttp-s-item"><span className="ttp-s-d">D</span>{draws}</span>
        <span className="ttp-s-item"><span className="ttp-s-l">L</span>{losses}</span>
        <span className="ttp-s-sep">|</span>
        <span className="ttp-s-item ttp-s-diff">{diffLabel}</span>
        {winStreak >= 2 && <span className="ttp-s-item ttp-s-streak">{winStreak}x</span>}
      </div>

      {/* Fever / Double bars */}
      {isFever && (
        <div className="ttp-fever">FEVER MODE x{FEVER_MULTIPLIER}</div>
      )}
      {doubleScoreRounds > 0 && (
        <div className="ttp-double">x2 ACTIVE</div>
      )}

      {/* Game Board */}
      <div className={`ttp-arena ${roundTransition ? 'round-end' : ''} ${boardAppear ? 'board-appear' : ''}`}>
        {outcomeLabel !== null && (
          <div className={`ttp-outcome ${outcome} ${isPerfect ? 'perfect' : ''}`}>
            <p>{outcomeLabel}</p>
            {outcome === 'win' && <p className="ttp-outcome-score">+{Math.max(SCORE_WIN, score - (scoreRef.current - SCORE_WIN))}</p>}
          </div>
        )}

        <div className="ttp-board">
          {/* Grid lines - pixel style */}
          <div className="ttp-grid-h ttp-grid-h1" />
          <div className="ttp-grid-h ttp-grid-h2" />
          <div className="ttp-grid-v ttp-grid-v1" />
          <div className="ttp-grid-v ttp-grid-v2" />

          {board.map((cell, index) => {
            const isWinCell = winningLine !== null && winningLine.includes(index)
            const isClickable = cell === null && isPlayerTurn && outcome === null && !finishedRef.current && !showPowerupPicker
            const isHint = hintCell === index && cell === null
            const special = specialCells[index]
            const animClass = cellAnimations[index] ?? ''
            const col = index % 3
            const row = Math.floor(index / 3)

            return (
              <button
                className={`ttp-cell ${cell !== null ? `filled ${cell}` : ''} ${isWinCell ? 'win-highlight' : ''} ${isClickable ? 'clickable' : ''} ${isHint ? 'hint' : ''} ${special !== null && cell === null ? `special-${special}` : ''} ${animClass}`}
                key={index}
                type="button"
                onClick={() => handleCellClick(index)}
                disabled={!isClickable}
                aria-label={`Cell ${index + 1}: ${cell ?? 'empty'}`}
                style={{ gridColumn: col + 1, gridRow: row + 1 }}
              >
                {cell === 'O' ? (
                  <PixelO size={cellSize} glow={isWinCell} />
                ) : cell === 'X' ? (
                  <PixelX size={cellSize} glow={isWinCell} />
                ) : special === 'golden' ? (
                  <span className="ttp-special golden">$</span>
                ) : special === 'bomb' ? (
                  <span className="ttp-special bomb">*</span>
                ) : null}
              </button>
            )
          })}

          {/* Pixel Explosions */}
          {explosions.map((e) => (
            <PixelExplosion key={e.id} x={e.x} y={e.y} color={e.color} />
          ))}
        </div>

        {!isPlayerTurn && outcome === null && !showPowerupPicker && (
          <div className="ttp-ai-thinking">
            <span className="ttp-ai-dots">...</span>
          </div>
        )}
      </div>

      {/* Turn Indicator */}
      <div className="ttp-turn-strip">
        <div className={`ttp-turn-indicator ${isPlayerTurn && outcome === null ? 'your-turn' : ''}`}>
          {outcome !== null ? 'NEXT ROUND' : isPlayerTurn ? '> YOUR TURN <' : '> AI TURN <'}
        </div>
      </div>

      {/* Streak info */}
      {!isFever && winStreak >= 2 && (
        <div className="ttp-streak-info">{FEVER_THRESHOLD - winStreak} more win{FEVER_THRESHOLD - winStreak > 1 ? 's' : ''} for FEVER!</div>
      )}

      {/* Combo Label */}
      {wins > 0 && getComboLabel(wins) !== '' && (
        <div className="ge-combo-label" style={{ fontSize: 14, color: getComboColor(wins), textAlign: 'center', textShadow: `0 0 8px ${getComboColor(wins)}` }}>
          {getComboLabel(wins)}
        </div>
      )}

      {/* Powerup Picker */}
      {showPowerupPicker && (
        <div className="ttp-powerup-overlay">
          <div className="ttp-pw-frame">
            <p className="ttp-pw-title">SELECT POWER UP</p>
            <div className="ttp-pw-options">
              <button className="ttp-pw-btn" type="button" onClick={() => handlePowerupSelect('hint')}>
                <span className="ttp-pw-icon hint-icon">?</span>
                <span className="ttp-pw-label">HINT</span>
                <span className="ttp-pw-desc">Show best move</span>
              </button>
              <button className="ttp-pw-btn" type="button" onClick={() => handlePowerupSelect('time')}>
                <span className="ttp-pw-icon time-icon">+</span>
                <span className="ttp-pw-label">TIME</span>
                <span className="ttp-pw-desc">+5 seconds</span>
              </button>
              <button className="ttp-pw-btn" type="button" onClick={() => handlePowerupSelect('double')}>
                <span className="ttp-pw-icon double-icon">x2</span>
                <span className="ttp-pw-label">DOUBLE</span>
                <span className="ttp-pw-desc">2x score next</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

/* ── CSS ──────────────────────────────────────── */
const TIC_TAC_PRO_CSS = `
/* Panel */
.tic-tac-pro-panel {
  aspect-ratio: 9 / 16;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  overflow: hidden;
  padding: 8px 10px !important;
  background: #1a1a2e;
  position: relative;
  image-rendering: pixelated;
}

/* CRT Scanlines */
.ttp-scanlines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 100;
  background: repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 2px,
    rgba(0,0,0,0.08) 2px,
    rgba(0,0,0,0.08) 4px
  );
  mix-blend-mode: multiply;
}

/* HUD */
.ttp-hud {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 2px 0;
}
.ttp-hud-left, .ttp-hud-right { display: flex; flex-direction: column; gap: 1px; }
.ttp-hud-center { display: flex; flex-direction: column; align-items: center; gap: 1px; }
.ttp-hud-right { align-items: flex-end; }
.ttp-score-label { margin: 0; font-size: 0.35rem; color: #4ade80; letter-spacing: 2px; }
.ttp-score { margin: 0; font-size: clamp(1.6rem, 5.5vw, 2.2rem); color: #4ade80; font-weight: 800; line-height: 1; text-shadow: 0 0 8px rgba(74,222,128,0.5), 2px 2px 0 #065f46; }
.ttp-round-badge { margin: 0; font-size: 0.45rem; color: #fbbf24; padding: 1px 6px; border: 2px solid #fbbf24; }
.ttp-ai-face { margin: 0; font-size: clamp(0.6rem, 2.5vw, 0.85rem); color: #f87171; font-weight: 700; transition: color 0.2s; min-height: 1.2em; }
.ttp-time { margin: 0; font-size: clamp(1.2rem, 4vw, 1.6rem); color: #e2e8f0; font-weight: 700; font-variant-numeric: tabular-nums; }
.ttp-time.low-time { color: #f87171; animation: ttp-blink 0.5s steps(2) infinite; }
.ttp-best-label { margin: 0; font-size: 0.35rem; color: #64748b; }

/* Timer Bar */
.ttp-timer-bar-wrap {
  width: 100%;
  height: 6px;
  background: #0f172a;
  border: 2px solid #334155;
  overflow: hidden;
}
.ttp-timer-bar-fill {
  height: 100%;
  background: #4ade80;
  transition: width 0.1s linear;
  image-rendering: pixelated;
}
.ttp-timer-bar-fill.timer-danger {
  background: #ef4444;
  animation: ttp-bar-flash 0.5s steps(2) infinite;
}

/* Stats */
.ttp-stats {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  font-size: 0.42rem;
  color: #94a3b8;
}
.ttp-s-item { font-weight: 700; }
.ttp-s-w { color: #4ade80; margin-right: 2px; }
.ttp-s-d { color: #fbbf24; margin-right: 2px; }
.ttp-s-l { color: #f87171; margin-right: 2px; }
.ttp-s-sep { color: #334155; }
.ttp-s-diff { color: #a78bfa; border: 1px solid #a78bfa; padding: 0 4px; }
.ttp-s-streak { color: #fbbf24; animation: ttp-blink 0.8s steps(2) infinite; }

/* Fever / Double */
.ttp-fever {
  width: 100%;
  text-align: center;
  font-size: clamp(0.55rem, 2vw, 0.75rem);
  color: #fbbf24;
  font-weight: 800;
  padding: 2px;
  background: rgba(251,191,36,0.1);
  border-top: 2px solid #fbbf24;
  border-bottom: 2px solid #fbbf24;
  animation: ttp-fever-flash 0.3s steps(2) infinite;
  text-shadow: 0 0 8px #f59e0b;
}
.ttp-double {
  width: 100%;
  text-align: center;
  font-size: 0.42rem;
  color: #c084fc;
  font-weight: 700;
  animation: ttp-blink 0.6s steps(2) infinite;
}

/* Arena */
.ttp-arena {
  position: relative;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 0;
}
.ttp-arena.round-end { pointer-events: none; }
.ttp-arena.board-appear .ttp-board { animation: ttp-board-in 0.3s steps(4); }

/* Outcome */
.ttp-outcome {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 20;
  padding: 8px 20px;
  border: 3px solid;
  font-size: clamp(0.8rem, 3vw, 1.1rem);
  font-weight: 800;
  text-align: center;
  animation: ttp-outcome-pop 0.25s steps(3);
  white-space: nowrap;
  background: rgba(26,26,46,0.95);
}
.ttp-outcome.win { color: #4ade80; border-color: #4ade80; text-shadow: 0 0 12px rgba(74,222,128,0.6); }
.ttp-outcome.draw { color: #fbbf24; border-color: #fbbf24; text-shadow: 0 0 12px rgba(251,191,36,0.6); }
.ttp-outcome.lose { color: #f87171; border-color: #f87171; text-shadow: 0 0 12px rgba(248,113,113,0.6); }
.ttp-outcome.perfect { animation: ttp-perfect-flash 0.15s steps(2) 4; border-color: #fbbf24; color: #fbbf24; }
.ttp-outcome p { margin: 0; }
.ttp-outcome-score { font-size: 0.5rem; margin-top: 2px !important; opacity: 0.8; }

/* Board */
.ttp-board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 0;
  width: min(98%, 400px);
  aspect-ratio: 1;
  position: relative;
  background: #16213e;
  border: 4px solid #4ade80;
  box-shadow: 0 0 20px rgba(74,222,128,0.2), inset 0 0 20px rgba(0,0,0,0.3);
}

/* Pixel grid lines */
.ttp-grid-h, .ttp-grid-v {
  position: absolute;
  background: #4ade80;
  z-index: 1;
  pointer-events: none;
  box-shadow: 0 0 6px rgba(74,222,128,0.4);
}
.ttp-grid-h { left: 0; right: 0; height: 4px; }
.ttp-grid-v { top: 0; bottom: 0; width: 4px; }
.ttp-grid-h1 { top: calc(33.33% - 2px); }
.ttp-grid-h2 { top: calc(66.66% - 2px); }
.ttp-grid-v1 { left: calc(33.33% - 2px); }
.ttp-grid-v2 { left: calc(66.66% - 2px); }

/* Cells */
.ttp-cell {
  position: relative;
  z-index: 2;
  border: none;
  background: transparent;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.1s;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.ttp-cell.clickable { cursor: pointer; }
.ttp-cell.clickable:hover { background: rgba(74,222,128,0.08); }
.ttp-cell.clickable:active { background: rgba(74,222,128,0.15); transform: scale(0.92); }
.ttp-cell.hint { background: rgba(59,130,246,0.12); animation: ttp-hint-pulse 0.6s steps(3) infinite alternate; }
.ttp-cell.special-golden { background: rgba(251,191,36,0.06); }
.ttp-cell.special-bomb { background: rgba(248,113,113,0.06); }
.ttp-cell.win-highlight { background: rgba(74,222,128,0.15); }
.ttp-cell.cell-place-bounce { animation: ttp-cell-bounce 0.2s steps(3); }
.ttp-cell.win-cell-pop { animation: ttp-win-cell-pop 0.3s steps(3); }

/* Pixel O glow */
.px-glow-o { filter: drop-shadow(0 0 6px rgba(13,148,136,0.6)); }
.px-glow-x { filter: drop-shadow(0 0 6px rgba(239,68,68,0.6)); }

/* Special cell icons */
.ttp-special {
  font-size: clamp(1rem, 4vw, 1.6rem);
  font-weight: 800;
  animation: ttp-special-float 1.2s steps(4) infinite alternate;
}
.ttp-special.golden { color: #fbbf24; text-shadow: 0 0 8px #fbbf24; }
.ttp-special.bomb { color: #f87171; text-shadow: 0 0 8px #f87171; }

/* AI Thinking */
.ttp-ai-thinking {
  font-size: 0.5rem;
  color: #f87171;
  text-align: center;
}
.ttp-ai-dots { animation: ttp-dots 0.8s steps(3) infinite; }

/* Turn Strip */
.ttp-turn-strip {
  width: 100%;
  text-align: center;
  padding: 3px 0;
}
.ttp-turn-indicator {
  font-size: clamp(0.5rem, 1.8vw, 0.65rem);
  color: #64748b;
  font-weight: 700;
  letter-spacing: 2px;
}
.ttp-turn-indicator.your-turn {
  color: #4ade80;
  animation: ttp-blink 0.8s steps(2) infinite;
}

/* Streak info */
.ttp-streak-info {
  font-size: 0.38rem;
  color: #94a3b8;
  text-align: center;
}

/* Pixel Explosions */
.px-explosion {
  position: absolute;
  z-index: 30;
  pointer-events: none;
}
.px-explosion-particle {
  position: absolute;
  width: 4px;
  height: 4px;
  image-rendering: pixelated;
  animation: ttp-explode 0.5s steps(5) forwards;
  animation-delay: var(--delay);
}

/* Powerup Overlay */
.ttp-powerup-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  animation: ttp-fade-in 0.2s steps(3);
}
.ttp-pw-frame {
  border: 4px solid #fbbf24;
  background: #1a1a2e;
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  box-shadow: 0 0 20px rgba(251,191,36,0.3);
}
.ttp-pw-title {
  margin: 0;
  font-size: clamp(0.7rem, 2.5vw, 0.9rem);
  color: #fbbf24;
  font-weight: 800;
  letter-spacing: 2px;
  text-shadow: 0 0 8px #f59e0b;
  animation: ttp-blink 0.5s steps(2) infinite;
}
.ttp-pw-options { display: flex; gap: 10px; }
.ttp-pw-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 14px;
  border: 3px solid #334155;
  background: #0f172a;
  cursor: pointer;
  transition: border-color 0.1s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  min-width: 75px;
}
.ttp-pw-btn:hover { border-color: #fbbf24; }
.ttp-pw-btn:active { transform: scale(0.92); }
.ttp-pw-icon {
  font-size: clamp(1rem, 3.5vw, 1.4rem);
  font-weight: 800;
}
.hint-icon { color: #60a5fa; text-shadow: 0 0 6px #3b82f6; }
.time-icon { color: #4ade80; text-shadow: 0 0 6px #22c55e; }
.double-icon { color: #c084fc; text-shadow: 0 0 6px #a855f7; }
.ttp-pw-label { font-size: 0.4rem; color: #e2e8f0; font-weight: 700; }
.ttp-pw-desc { font-size: 0.3rem; color: #64748b; }

/* ── Animations (step-based for pixel feel) ── */
@keyframes ttp-blink { 50% { opacity: 0; } }
@keyframes ttp-bar-flash { 50% { background: #991b1b; } }
@keyframes ttp-fever-flash {
  0% { background: rgba(251,191,36,0.1); }
  50% { background: rgba(251,191,36,0.25); }
}
@keyframes ttp-outcome-pop {
  0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
  50% { transform: translate(-50%, -50%) scale(1.15); }
  100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
}
@keyframes ttp-perfect-flash {
  0% { background: rgba(251,191,36,0.3); }
  50% { background: rgba(26,26,46,0.95); }
}
@keyframes ttp-cell-bounce {
  0% { transform: scale(0.2); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
@keyframes ttp-win-cell-pop {
  0% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.3); filter: brightness(1.5); }
  100% { transform: scale(1); filter: brightness(1); }
}
@keyframes ttp-hint-pulse {
  from { background: rgba(59,130,246,0.05); }
  to { background: rgba(59,130,246,0.18); }
}
@keyframes ttp-special-float {
  from { transform: translateY(0); }
  to { transform: translateY(-3px); }
}
@keyframes ttp-board-in {
  from { transform: scale(0.8); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes ttp-dots {
  0% { content: '.'; }
  33% { content: '..'; }
  66% { content: '...'; }
}
@keyframes ttp-explode {
  0% { transform: translate(0, 0) scale(1); opacity: 1; }
  100% { transform: translate(calc(cos(var(--angle)) * var(--dist)), calc(sin(var(--angle)) * var(--dist))) scale(0); opacity: 0; }
}
@keyframes ttp-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pulse-glow {
  from { text-shadow: 0 0 4px currentColor; }
  to { text-shadow: 0 0 12px currentColor, 0 0 20px currentColor; }
}
`

export const ticTacProModule: MiniGameModule = {
  manifest: {
    id: 'tic-tac-pro',
    title: 'Tic Tac Pro',
    description: 'Pixel Tic-Tac-Toe vs AI! Win 30pts, Draw 10pts!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#0d9488',
  },
  Component: TicTacProGame,
}
