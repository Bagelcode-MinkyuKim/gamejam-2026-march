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

const COLS = 7
const ROWS = 6
const ROUND_DURATION_MS = 60000
const WIN_SCORE = 40
const DRAW_SCORE = 15
const AI_DELAY_MS = 400
const LOW_TIME_THRESHOLD_MS = 10000
const DROP_ANIMATION_MS = 350
const STREAK_BONUS_PER_WIN = 10
const QUICK_WIN_MOVES = 10
const QUICK_WIN_BONUS = 20
const FEVER_STREAK_THRESHOLD = 3
const FEVER_MULTIPLIER = 2
const MAX_HINTS = 3
const HINT_COOLDOWN_MS = 5000
const POWER_UP_INTERVAL_WINS = 3

type CellValue = 0 | 1 | 2
type Board = CellValue[][]
type GamePhase = 'player-turn' | 'ai-turn' | 'win' | 'lose' | 'draw' | 'idle'
type PowerUpType = 'double-turn' | 'column-clear' | 'undo'

interface WinLine {
  readonly cells: ReadonlyArray<{ row: number; col: number }>
}

interface PowerUp {
  readonly type: PowerUpType
  readonly label: string
  readonly icon: string
}

const POWER_UPS: PowerUp[] = [
  { type: 'double-turn', label: 'Double Turn', icon: '2x' },
  { type: 'column-clear', label: 'Clear Column', icon: 'X' },
  { type: 'undo', label: 'Undo', icon: '<' },
]

function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0 as CellValue))
}

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row])
}

function getAvailableRow(board: Board, col: number): number {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === 0) return row
  }
  return -1
}

function getAvailableCols(board: Board): number[] {
  const cols: number[] = []
  for (let col = 0; col < COLS; col += 1) {
    if (board[0][col] === 0) cols.push(col)
  }
  return cols
}

function checkWinAt(board: Board, player: CellValue): WinLine | null {
  const directions = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 1, dc: 1 },
    { dr: 1, dc: -1 },
  ]

  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      if (board[row][col] !== player) continue

      for (const { dr, dc } of directions) {
        const cells: { row: number; col: number }[] = [{ row, col }]
        let valid = true

        for (let step = 1; step < 4; step += 1) {
          const nextRow = row + dr * step
          const nextCol = col + dc * step
          if (nextRow < 0 || nextRow >= ROWS || nextCol < 0 || nextCol >= COLS || board[nextRow][nextCol] !== player) {
            valid = false
            break
          }
          cells.push({ row: nextRow, col: nextCol })
        }

        if (valid) return { cells }
      }
    }
  }

  return null
}

function isBoardFull(board: Board): boolean {
  for (let col = 0; col < COLS; col += 1) {
    if (board[0][col] === 0) return false
  }
  return true
}

function findWinningCol(board: Board, player: CellValue): number {
  for (let col = 0; col < COLS; col += 1) {
    const row = getAvailableRow(board, col)
    if (row === -1) continue
    const testBoard = cloneBoard(board)
    testBoard[row][col] = player
    if (checkWinAt(testBoard, player) !== null) return col
  }
  return -1
}

function countThreats(board: Board, player: CellValue): number[] {
  const threats = new Array(COLS).fill(0)
  for (let col = 0; col < COLS; col += 1) {
    const row = getAvailableRow(board, col)
    if (row === -1) continue
    const testBoard = cloneBoard(board)
    testBoard[row][col] = player

    const directions = [
      { dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 1, dc: 1 }, { dr: 1, dc: -1 },
    ]
    for (const { dr, dc } of directions) {
      let count = 1
      for (let d = -1; d <= 1; d += 2) {
        for (let step = 1; step < 4; step += 1) {
          const nr = row + dr * step * d
          const nc = col + dc * step * d
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || testBoard[nr][nc] !== player) break
          count += 1
        }
      }
      if (count >= 3) threats[col] += count
    }
  }
  return threats
}

function aiChooseCol(board: Board, smartProbability: number = 1): number {
  const available = getAvailableCols(board)
  if (available.length === 0) return -1

  if (Math.random() > smartProbability) {
    return available[Math.floor(Math.random() * available.length)]
  }

  const winCol = findWinningCol(board, 2)
  if (winCol !== -1) return winCol

  const blockCol = findWinningCol(board, 1)
  if (blockCol !== -1) return blockCol

  const threats = countThreats(board, 2)
  const playerThreats = countThreats(board, 1)

  let bestCol = available[0]
  let bestScore = -Infinity
  for (const col of available) {
    let s = threats[col] * 2 - playerThreats[col]
    s += (3 - Math.abs(col - 3)) * 0.5
    if (s > bestScore) {
      bestScore = s
      bestCol = col
    }
  }
  return bestCol
}

function getAiSmartProbability(totalWins: number): number {
  if (totalWins < 2) return 0.3
  if (totalWins < 4) return 0.5
  if (totalWins < 7) return 0.7
  if (totalWins < 10) return 0.85
  return 1.0
}

function getHintCol(board: Board): number {
  const winCol = findWinningCol(board, 1)
  if (winCol !== -1) return winCol
  const blockCol = findWinningCol(board, 2)
  if (blockCol !== -1) return blockCol
  const threats = countThreats(board, 1)
  const available = getAvailableCols(board)
  let bestCol = available[0]
  let bestThreat = -1
  for (const col of available) {
    const t = threats[col] + (3 - Math.abs(col - 3)) * 0.3
    if (t > bestThreat) {
      bestThreat = t
      bestCol = col
    }
  }
  return bestCol
}

function ConnectFourGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [board, setBoard] = useState<Board>(() => createEmptyBoard())
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
  const [movesThisRound, setMovesThisRound] = useState(0)
  const [hintCol, setHintCol] = useState<number | null>(null)
  const [hintsRemaining, setHintsRemaining] = useState(MAX_HINTS)
  const [hintCooldown, setHintCooldown] = useState(false)
  const [hoveredCol, setHoveredCol] = useState<number | null>(null)
  const [activePowerUp, setActivePowerUp] = useState<PowerUpType | null>(null)
  const [doubleTurnActive, setDoubleTurnActive] = useState(false)
  const [prevBoard, setPrevBoard] = useState<Board | null>(null)
  const [roundNumber, setRoundNumber] = useState(1)
  const [lastScoreGain, setLastScoreGain] = useState(0)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const winStreakRef = useRef(0)
  const movesThisRoundRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const aiTimerRef = useRef<number | null>(null)
  const dropTimerRef = useRef<number | null>(null)
  const hintTimerRef = useRef<number | null>(null)
  const winsRef = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)

  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map())

  const effects = useGameEffects({ maxParticles: 40 })

  const getAudio = useCallback((url: string): HTMLAudioElement => {
    let audio = audioPoolRef.current.get(url)
    if (!audio) {
      audio = new Audio(url)
      audio.preload = 'auto'
      audioPoolRef.current.set(url, audio)
    }
    return audio
  }, [])

  const playSfx = useCallback((url: string, volume = 0.5, playbackRate = 1) => {
    const audio = getAudio(url)
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [getAudio])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true

    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current)
      aiTimerRef.current = null
    }
    if (dropTimerRef.current !== null) {
      window.clearTimeout(dropTimerRef.current)
      dropTimerRef.current = null
    }
    if (hintTimerRef.current !== null) {
      window.clearTimeout(hintTimerRef.current)
      hintTimerRef.current = null
    }

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish])

  const startNewRound = useCallback(() => {
    setBoard(createEmptyBoard())
    setPhase('player-turn')
    setWinLine(null)
    setDroppingCell(null)
    setLastDropCol(null)
    setHintCol(null)
    setPrevBoard(null)
    setDoubleTurnActive(false)
    movesThisRoundRef.current = 0
    setMovesThisRound(0)
    setRoundNumber((prev) => prev + 1)

    if (winsRef.current > 0 && winsRef.current % POWER_UP_INTERVAL_WINS === 0) {
      const randomPower = POWER_UPS[Math.floor(Math.random() * POWER_UPS.length)]
      setActivePowerUp(randomPower.type)
      playSfx(comboSfxUrl, 0.5)
    }
  }, [playSfx])

  const resolveRound = useCallback(
    (result: 'win' | 'lose' | 'draw') => {
      let addedScore = result === 'win' ? WIN_SCORE : result === 'draw' ? DRAW_SCORE : 0

      if (result === 'win') {
        const nextStreak = winStreakRef.current + 1
        winStreakRef.current = nextStreak
        setWinStreak(nextStreak)

        const feverActive = nextStreak >= FEVER_STREAK_THRESHOLD
        setIsFever(feverActive)

        addedScore += Math.min(nextStreak, 5) * STREAK_BONUS_PER_WIN
        if (movesThisRoundRef.current <= QUICK_WIN_MOVES) addedScore += QUICK_WIN_BONUS
        if (feverActive) addedScore *= FEVER_MULTIPLIER

        winsRef.current += 1
        setWins((prev) => prev + 1)
        setPhase('win')

        playSfx(winSfxUrl, 0.6)
        if (feverActive) {
          setTimeout(() => playSfx(feverSfxUrl, 0.5), 300)
        }

        const rect = panelRef.current?.getBoundingClientRect()
        if (rect) {
          effects.comboHitBurst(rect.width / 2, rect.height / 2, nextStreak, addedScore, ['🎉', '🏆', '⭐', '💎'])
          effects.triggerShake(8, 200)
        }
      } else if (result === 'lose') {
        winStreakRef.current = 0
        setWinStreak(0)
        setIsFever(false)
        setLosses((prev) => prev + 1)
        setPhase('lose')
        playSfx(loseSfxUrl, 0.5)
        effects.triggerFlash('rgba(239,68,68,0.3)', 150)
        effects.triggerShake(6, 150)
      } else {
        setDraws((prev) => prev + 1)
        setPhase('draw')
        playSfx(drawSfxUrl, 0.45)
      }

      setLastScoreGain(addedScore)
      const nextScore = scoreRef.current + addedScore
      scoreRef.current = nextScore
      setScore(nextScore)

      if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current)
      dropTimerRef.current = window.setTimeout(() => {
        dropTimerRef.current = null
        if (!finishedRef.current) startNewRound()
      }, 1500)
    },
    [playSfx, startNewRound, effects],
  )

  const placePiece = useCallback(
    (currentBoard: Board, col: number, player: CellValue): Board | null => {
      const row = getAvailableRow(currentBoard, col)
      if (row === -1) return null

      const nextBoard = cloneBoard(currentBoard)
      nextBoard[row][col] = player

      setDroppingCell({ row, col })
      setLastDropCol(col)
      setBoard(nextBoard)
      setHintCol(null)

      playSfx(dropSfxUrl, 0.45, 0.85 + row * 0.05)

      const rect = panelRef.current?.getBoundingClientRect()
      if (rect) {
        const cellSize = Math.min((rect.width - 24) / COLS, (rect.height * 0.55) / ROWS)
        const gridLeft = (rect.width - cellSize * COLS) / 2
        const gridTop = rect.height * 0.22
        const cx = gridLeft + col * cellSize + cellSize / 2
        const cy = gridTop + row * cellSize + cellSize / 2
        effects.spawnParticles(3, cx, cy, undefined, 'circle')
      }

      const win = checkWinAt(nextBoard, player)
      if (win !== null) {
        setWinLine(win)
        resolveRound(player === 1 ? 'win' : 'lose')
        return nextBoard
      }

      if (isBoardFull(nextBoard)) {
        resolveRound('draw')
        return nextBoard
      }

      return nextBoard
    },
    [playSfx, resolveRound, effects],
  )

  const runAiTurn = useCallback(
    (currentBoard: Board) => {
      if (finishedRef.current) return

      if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current)

      aiTimerRef.current = window.setTimeout(() => {
        aiTimerRef.current = null
        if (finishedRef.current) return

        const col = aiChooseCol(currentBoard, getAiSmartProbability(winStreakRef.current))
        if (col === -1) return

        const nextBoard = placePiece(currentBoard, col, 2)
        if (nextBoard === null) return

        const aiWin = checkWinAt(nextBoard, 2)
        const full = isBoardFull(nextBoard)
        if (aiWin === null && !full) setPhase('player-turn')
      }, AI_DELAY_MS)
    },
    [placePiece],
  )

  const handleColumnClick = useCallback(
    (col: number) => {
      if (finishedRef.current || phase !== 'player-turn') return

      setPrevBoard(cloneBoard(board))
      movesThisRoundRef.current += 1
      setMovesThisRound(movesThisRoundRef.current)
      const nextBoard = placePiece(board, col, 1)
      if (nextBoard === null) return

      const playerWin = checkWinAt(nextBoard, 1)
      const full = isBoardFull(nextBoard)
      if (playerWin === null && !full) {
        if (doubleTurnActive) {
          setDoubleTurnActive(false)
          playSfx(comboSfxUrl, 0.4)
        } else {
          setPhase('ai-turn')
          runAiTurn(nextBoard)
        }
      }
    },
    [board, phase, placePiece, runAiTurn, doubleTurnActive, playSfx],
  )

  const useHint = useCallback(() => {
    if (hintsRemaining <= 0 || hintCooldown || phase !== 'player-turn') return
    const col = getHintCol(board)
    setHintCol(col)
    setHintsRemaining((prev) => prev - 1)
    setHintCooldown(true)
    playSfx(hintSfxUrl, 0.4)

    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null
      setHintCol(null)
      setHintCooldown(false)
    }, HINT_COOLDOWN_MS)
  }, [board, hintsRemaining, hintCooldown, phase, playSfx])

  const usePowerUp = useCallback(() => {
    if (activePowerUp === null || phase !== 'player-turn') return

    if (activePowerUp === 'double-turn') {
      setDoubleTurnActive(true)
      playSfx(feverSfxUrl, 0.4)
    } else if (activePowerUp === 'undo' && prevBoard !== null) {
      setBoard(prevBoard)
      setPrevBoard(null)
      playSfx(hintSfxUrl, 0.4)
    } else if (activePowerUp === 'column-clear') {
      const newBoard = cloneBoard(board)
      for (let row = 0; row < ROWS; row += 1) {
        if (newBoard[row][3] === 2) {
          newBoard[row][3] = 0
        }
      }
      // Re-apply gravity
      for (let col = 0; col < COLS; col += 1) {
        const pieces: CellValue[] = []
        for (let row = ROWS - 1; row >= 0; row -= 1) {
          if (newBoard[row][col] !== 0) pieces.push(newBoard[row][col])
        }
        for (let row = 0; row < ROWS; row += 1) {
          newBoard[row][col] = 0
        }
        for (let i = 0; i < pieces.length; i += 1) {
          newBoard[ROWS - 1 - i][col] = pieces[i]
        }
      }
      setBoard(newBoard)
      playSfx(comboSfxUrl, 0.5)
      effects.triggerFlash('rgba(59,130,246,0.3)', 120)
    }

    setActivePowerUp(null)
  }, [activePowerUp, phase, board, prevBoard, playSfx, effects])

  // Preload all audio
  useEffect(() => {
    const urls = [dropSfxUrl, winSfxUrl, loseSfxUrl, drawSfxUrl, comboSfxUrl, feverSfxUrl, hintSfxUrl, hoverSfxUrl]
    for (const url of urls) getAudio(url)

    return () => {
      if (aiTimerRef.current !== null) window.clearTimeout(aiTimerRef.current)
      if (dropTimerRef.current !== null) window.clearTimeout(dropTimerRef.current)
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
      effects.cleanup()
    }
  }, [getAudio, effects])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
      }
      if (event.code === 'KeyH') useHint()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onExit, useHint])

  // Game timer
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }

      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
        playSfx(loseSfxUrl, 0.6)
        finishGame()
        animationFrameRef.current = null
        return
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
  }, [finishGame, playSfx, effects])

  const isWinCell = useCallback(
    (row: number, col: number): boolean => {
      if (winLine === null) return false
      return winLine.cells.some((cell) => cell.row === row && cell.col === col)
    },
    [winLine],
  )

  const isDroppingCell = useCallback(
    (row: number, col: number): boolean => {
      return droppingCell !== null && droppingCell.row === row && droppingCell.col === col
    },
    [droppingCell],
  )

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const isGameActive = phase === 'player-turn' || phase === 'ai-turn'
  const aiLevel = Math.round(getAiSmartProbability(winStreak) * 5)
  const powerUpInfo = activePowerUp !== null ? POWER_UPS.find((p) => p.type === activePowerUp) : null

  const phaseLabel =
    phase === 'player-turn' ? 'YOUR TURN'
    : phase === 'ai-turn' ? 'AI THINKING...'
    : phase === 'win' ? `WIN! +${lastScoreGain}`
    : phase === 'lose' ? 'LOSE...'
    : phase === 'draw' ? `DRAW +${lastScoreGain}`
    : ''

  const timerPercent = (remainingMs / ROUND_DURATION_MS) * 100
  const shakeStyle = effects.getShakeStyle()

  return (
    <section
      ref={panelRef}
      className="mini-game-panel connect-four-panel"
      aria-label="connect-four-game"
      style={{
        maxWidth: '432px',
        aspectRatio: '9/16',
        margin: '0 auto',
        overflow: 'hidden',
        position: 'relative',
        ...(shakeStyle ?? {}),
      }}
    >
      {/* Timer bar */}
      <div className="cf-timer-bar-container">
        <div
          className={`cf-timer-bar ${isLowTime ? 'cf-timer-low' : ''}`}
          style={{ width: `${timerPercent}%` }}
        />
        <span className={`cf-timer-text ${isLowTime ? 'cf-timer-text-low' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Score strip */}
      <div className="cf-score-strip">
        <div className="cf-score-left">
          <p className="cf-score">{score.toLocaleString()}</p>
          <p className="cf-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="cf-round-badge">R{roundNumber}</div>
        <div className="cf-stats-right">
          <span className="cf-stat cf-stat-win">W{wins}</span>
          <span className="cf-stat cf-stat-draw">D{draws}</span>
          <span className="cf-stat cf-stat-loss">L{losses}</span>
        </div>
      </div>

      {/* Phase + Streak */}
      <div className="cf-phase-area">
        <p className={`cf-phase cf-phase-${phase}`}>{phaseLabel}</p>
        {isFever && (
          <p className="cf-fever-label">FEVER x{FEVER_MULTIPLIER} (Streak {winStreak})</p>
        )}
        {!isFever && winStreak >= 2 && (
          <p className="cf-streak-label">Streak {winStreak} - AI Lv.{aiLevel}</p>
        )}
        {doubleTurnActive && (
          <p className="cf-double-turn-label">DOUBLE TURN!</p>
        )}
      </div>

      {/* Drop buttons */}
      <div className="cf-drop-buttons">
        {Array.from({ length: COLS }, (_, col) => {
          const isHinted = hintCol === col
          const isHovered = hoveredCol === col
          const available = getAvailableRow(board, col) !== -1
          return (
            <button
              key={`drop-${col}`}
              className={`cf-drop-btn ${lastDropCol === col ? 'cf-drop-active' : ''} ${isHinted ? 'cf-drop-hint' : ''} ${isHovered ? 'cf-drop-hovered' : ''}`}
              type="button"
              onClick={() => handleColumnClick(col)}
              onPointerEnter={() => { setHoveredCol(col); if (available && phase === 'player-turn') playSfx(hoverSfxUrl, 0.15, 1 + col * 0.08) }}
              onPointerLeave={() => setHoveredCol(null)}
              disabled={phase !== 'player-turn' || !available}
              aria-label={`Column ${col + 1}`}
            >
              {isHinted ? '!' : '\u25BC'}
            </button>
          )
        })}
      </div>

      {/* Board */}
      <div className={`cf-grid ${isFever ? 'cf-grid-fever' : ''}`}>
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={`row-${row}`} className="cf-row">
            {Array.from({ length: COLS }, (_, col) => {
              const cellValue = board[row][col]
              const isWin = isWinCell(row, col)
              const isDropping = isDroppingCell(row, col)
              const isPreview = hoveredCol === col && cellValue === 0 && getAvailableRow(board, col) === row && phase === 'player-turn'

              let cellClass = 'cf-cell'
              if (cellValue === 1) cellClass += ' cf-cell-player'
              else if (cellValue === 2) cellClass += ' cf-cell-ai'
              if (isWin) cellClass += ' cf-cell-win'
              if (isDropping) cellClass += ' cf-cell-dropping'
              if (isPreview) cellClass += ' cf-cell-preview'

              return (
                <div
                  key={`cell-${row}-${col}`}
                  className={cellClass}
                  onClick={() => handleColumnClick(col)}
                >
                  {(cellValue !== 0 || isPreview) && (
                    <div
                      className="cf-piece"
                      style={
                        isDropping
                          ? ({ '--cf-drop-rows': row } as React.CSSProperties)
                          : undefined
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Bottom controls */}
      <div className="cf-bottom-controls">
        <button
          className={`cf-action-btn cf-hint-btn ${hintsRemaining <= 0 || hintCooldown ? 'cf-btn-disabled' : ''}`}
          type="button"
          onClick={useHint}
          disabled={hintsRemaining <= 0 || hintCooldown || phase !== 'player-turn'}
        >
          Hint ({hintsRemaining})
        </button>

        {powerUpInfo && (
          <button
            className="cf-action-btn cf-powerup-btn"
            type="button"
            onClick={usePowerUp}
            disabled={phase !== 'player-turn'}
          >
            {powerUpInfo.icon} {powerUpInfo.label}
          </button>
        )}

        <div className="cf-legend">
          <span className="cf-legend-item"><span className="cf-legend-dot cf-legend-player" /> You</span>
          <span className="cf-legend-item"><span className="cf-legend-dot cf-legend-ai" /> AI</span>
        </div>
      </div>

      {/* Effects */}
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />

      <style>{GAME_EFFECTS_CSS}{`
        .connect-four-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 6px 8px;
          width: 100%;
          max-width: 432px;
          margin: 0 auto;
          user-select: none;
          background: linear-gradient(180deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
          font-family: 'Pretendard', -apple-system, sans-serif;
        }

        /* Timer bar */
        .cf-timer-bar-container {
          width: 100%;
          height: 20px;
          background: rgba(0,0,0,0.4);
          border-radius: 10px;
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }
        .cf-timer-bar {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #4ade80);
          border-radius: 10px;
          transition: width 0.3s linear;
        }
        .cf-timer-low {
          background: linear-gradient(90deg, #ef4444, #f87171);
          animation: cf-pulse-bar 0.5s infinite alternate;
        }
        .cf-timer-text {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 11px;
          font-weight: 700;
          color: #fff;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }
        .cf-timer-text-low {
          animation: cf-blink 0.5s infinite alternate;
        }

        /* Score strip */
        .cf-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          padding: 2px 4px;
          flex-shrink: 0;
        }
        .cf-score-left { display: flex; flex-direction: column; }
        .cf-score {
          font-size: clamp(24px, 7vw, 32px);
          font-weight: 800;
          color: #fbbf24;
          margin: 0;
          line-height: 1.1;
          text-shadow: 0 2px 8px rgba(251,191,36,0.3);
        }
        .cf-best { font-size: 10px; color: #9ca3af; margin: 0; }
        .cf-round-badge {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          padding: 2px 10px;
          font-size: 13px;
          font-weight: 700;
          color: #e5e7eb;
        }
        .cf-stats-right {
          display: flex;
          gap: 8px;
          font-size: 13px;
          font-weight: 700;
        }
        .cf-stat-win { color: #22c55e; }
        .cf-stat-draw { color: #facc15; }
        .cf-stat-loss { color: #ef4444; }

        /* Phase area */
        .cf-phase-area {
          text-align: center;
          min-height: 36px;
          flex-shrink: 0;
        }
        .cf-phase {
          font-size: clamp(16px, 4.5vw, 20px);
          font-weight: 800;
          margin: 0;
          letter-spacing: 1px;
        }
        .cf-phase-player-turn { color: #f87171; }
        .cf-phase-ai-turn { color: #facc15; animation: cf-pulse 0.8s infinite alternate; }
        .cf-phase-win { color: #22c55e; animation: cf-pop 0.4s ease-out; }
        .cf-phase-lose { color: #ef4444; animation: cf-shake-text 0.4s ease-out; }
        .cf-phase-draw { color: #a78bfa; }
        .cf-fever-label {
          margin: 0; color: #fbbf24; font-weight: 800; font-size: 13px;
          animation: cf-fever-glow 0.5s ease-in-out infinite alternate;
          text-shadow: 0 0 12px #f59e0b;
        }
        .cf-streak-label { margin: 0; color: #22c55e; font-weight: 600; font-size: 11px; }
        .cf-double-turn-label {
          margin: 0; color: #60a5fa; font-weight: 800; font-size: 14px;
          animation: cf-pop 0.3s ease-out;
          text-shadow: 0 0 8px #3b82f6;
        }

        /* Drop buttons */
        .cf-drop-buttons {
          display: grid;
          grid-template-columns: repeat(${COLS}, 1fr);
          gap: 3px;
          width: 100%;
          padding: 0 4px;
          flex-shrink: 0;
        }
        .cf-drop-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          height: clamp(28px, 5vw, 36px);
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px 8px 3px 3px;
          color: rgba(255,255,255,0.5);
          font-size: clamp(12px, 3vw, 16px);
          cursor: pointer;
          transition: all 0.15s;
          font-weight: 700;
        }
        .cf-drop-btn:hover:not(:disabled) {
          background: rgba(239,68,68,0.25);
          color: #f87171;
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(239,68,68,0.2);
        }
        .cf-drop-btn:active:not(:disabled) { transform: translateY(1px); }
        .cf-drop-btn:disabled { opacity: 0.2; cursor: not-allowed; }
        .cf-drop-active { background: rgba(239,68,68,0.15); }
        .cf-drop-hint {
          background: rgba(34,197,94,0.3) !important;
          color: #22c55e !important;
          border-color: #22c55e !important;
          animation: cf-hint-pulse 0.6s infinite alternate;
          font-weight: 900;
          font-size: clamp(14px, 3.5vw, 18px);
        }
        .cf-drop-hovered {
          background: rgba(239,68,68,0.15);
          border-color: rgba(239,68,68,0.3);
        }

        /* Grid */
        .cf-grid {
          display: flex;
          flex-direction: column;
          gap: clamp(2px, 0.6vw, 4px);
          background: linear-gradient(135deg, #1e3a5f, #1a365d);
          padding: clamp(6px, 1.5vw, 10px);
          border-radius: 12px;
          box-shadow: 0 4px 24px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
          border: 2px solid rgba(255,255,255,0.08);
          flex: 1;
          min-height: 0;
          width: 100%;
        }
        .cf-grid-fever {
          border-color: rgba(251,191,36,0.4);
          box-shadow: 0 4px 24px rgba(0,0,0,0.5), 0 0 30px rgba(251,191,36,0.15), inset 0 1px 0 rgba(255,255,255,0.1);
          animation: cf-fever-border 1s infinite alternate;
        }

        .cf-row {
          display: grid;
          grid-template-columns: repeat(${COLS}, 1fr);
          gap: clamp(2px, 0.6vw, 4px);
          flex: 1;
        }

        .cf-cell {
          aspect-ratio: 1;
          border-radius: 50%;
          background: radial-gradient(circle at 40% 40%, #1e293b, #0f172a);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
          cursor: pointer;
          transition: background 0.15s;
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.4);
        }
        .cf-cell:hover {
          background: radial-gradient(circle at 40% 40%, #2a3a50, #1a2540);
        }

        .cf-piece {
          width: 82%;
          height: 82%;
          border-radius: 50%;
          transition: box-shadow 0.3s;
        }

        .cf-cell-player .cf-piece {
          background: radial-gradient(circle at 35% 35%, #ff8a8a, #dc2626, #991b1b);
          box-shadow: inset 0 -3px 6px rgba(0,0,0,0.35), 0 2px 6px rgba(220,38,38,0.5), inset 0 2px 4px rgba(255,255,255,0.2);
        }
        .cf-cell-ai .cf-piece {
          background: radial-gradient(circle at 35% 35%, #ffe066, #eab308, #a16207);
          box-shadow: inset 0 -3px 6px rgba(0,0,0,0.35), 0 2px 6px rgba(234,179,8,0.5), inset 0 2px 4px rgba(255,255,255,0.2);
        }
        .cf-cell-preview .cf-piece {
          background: radial-gradient(circle at 35% 35%, rgba(255,138,138,0.3), rgba(220,38,38,0.15));
          box-shadow: none;
          animation: cf-preview-pulse 1s infinite alternate;
        }

        .cf-cell-win .cf-piece {
          animation: cf-win-glow 0.5s infinite alternate;
        }
        .cf-cell-win::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 60%);
          animation: cf-win-ring 1s infinite;
        }

        .cf-cell-dropping .cf-piece {
          animation: cf-drop ${DROP_ANIMATION_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        /* Bottom controls */
        .cf-bottom-controls {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 2px 4px;
          flex-shrink: 0;
        }
        .cf-action-btn {
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
          border: 1px solid;
        }
        .cf-hint-btn {
          background: rgba(34,197,94,0.15);
          border-color: rgba(34,197,94,0.3);
          color: #22c55e;
        }
        .cf-hint-btn:hover:not(:disabled) {
          background: rgba(34,197,94,0.3);
          transform: translateY(-1px);
        }
        .cf-powerup-btn {
          background: rgba(59,130,246,0.15);
          border-color: rgba(59,130,246,0.3);
          color: #60a5fa;
          animation: cf-pop 0.5s ease-out;
        }
        .cf-powerup-btn:hover:not(:disabled) {
          background: rgba(59,130,246,0.3);
          transform: translateY(-1px);
        }
        .cf-btn-disabled { opacity: 0.35; cursor: not-allowed; }

        .cf-legend {
          display: flex;
          gap: 12px;
          font-size: 11px;
          color: #9ca3af;
          margin-left: auto;
        }
        .cf-legend-item { display: flex; align-items: center; gap: 4px; }
        .cf-legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; }
        .cf-legend-player { background: #dc2626; box-shadow: 0 0 6px rgba(220,38,38,0.5); }
        .cf-legend-ai { background: #eab308; box-shadow: 0 0 6px rgba(234,179,8,0.5); }

        /* Animations */
        @keyframes cf-blink { from { opacity: 1; } to { opacity: 0.3; } }
        @keyframes cf-pulse { from { opacity: 1; } to { opacity: 0.4; } }
        @keyframes cf-pulse-bar { from { opacity: 0.8; } to { opacity: 1; } }
        @keyframes cf-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        @keyframes cf-shake-text {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        @keyframes cf-win-glow {
          from {
            box-shadow: inset 0 -3px 6px rgba(0,0,0,0.3), 0 0 8px rgba(255,255,255,0.5);
            transform: scale(1);
          }
          to {
            box-shadow: inset 0 -3px 6px rgba(0,0,0,0.3), 0 0 20px rgba(255,255,255,0.9);
            transform: scale(1.1);
          }
        }
        @keyframes cf-win-ring {
          0% { transform: scale(0.8); opacity: 0.6; }
          50% { transform: scale(1.2); opacity: 0; }
          100% { transform: scale(0.8); opacity: 0; }
        }
        @keyframes cf-drop {
          from {
            transform: translateY(calc(var(--cf-drop-rows, 0) * -100% - 100%));
            opacity: 0.6;
          }
          60% { opacity: 1; }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes cf-preview-pulse {
          from { opacity: 0.2; }
          to { opacity: 0.5; }
        }
        @keyframes cf-hint-pulse {
          from { box-shadow: 0 0 4px rgba(34,197,94,0.3); }
          to { box-shadow: 0 0 16px rgba(34,197,94,0.7); }
        }
        @keyframes cf-fever-glow {
          from { opacity: 0.7; transform: scale(1); }
          to { opacity: 1; transform: scale(1.05); }
        }
        @keyframes cf-fever-border {
          from { border-color: rgba(251,191,36,0.2); }
          to { border-color: rgba(251,191,36,0.5); }
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
    accentColor: '#dc2626',
  },
  Component: ConnectFourGame,
}
