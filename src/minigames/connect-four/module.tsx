import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const COLS = 7
const ROWS = 6
const ROUND_DURATION_MS = 60000
const WIN_SCORE = 40
const DRAW_SCORE = 15
const AI_DELAY_MS = 400
const LOW_TIME_THRESHOLD_MS = 10000
const DROP_ANIMATION_MS = 300
const STREAK_BONUS_PER_WIN = 10
const QUICK_WIN_MOVES = 10
const QUICK_WIN_BONUS = 20
const FEVER_STREAK_THRESHOLD = 3
const FEVER_MULTIPLIER = 2

type CellValue = 0 | 1 | 2
type Board = CellValue[][]
type GamePhase = 'player-turn' | 'ai-turn' | 'win' | 'lose' | 'draw' | 'idle'

interface WinLine {
  readonly cells: ReadonlyArray<{ row: number; col: number }>
}

function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => 0 as CellValue))
}

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row])
}

function getAvailableRow(board: Board, col: number): number {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === 0) {
      return row
    }
  }
  return -1
}

function getAvailableCols(board: Board): number[] {
  const cols: number[] = []
  for (let col = 0; col < COLS; col += 1) {
    if (board[0][col] === 0) {
      cols.push(col)
    }
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
      if (board[row][col] !== player) {
        continue
      }

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

        if (valid) {
          return { cells }
        }
      }
    }
  }

  return null
}

function isBoardFull(board: Board): boolean {
  for (let col = 0; col < COLS; col += 1) {
    if (board[0][col] === 0) {
      return false
    }
  }
  return true
}

function findWinningCol(board: Board, player: CellValue): number {
  for (let col = 0; col < COLS; col += 1) {
    const row = getAvailableRow(board, col)
    if (row === -1) {
      continue
    }
    const testBoard = cloneBoard(board)
    testBoard[row][col] = player
    if (checkWinAt(testBoard, player) !== null) {
      return col
    }
  }
  return -1
}

function aiChooseCol(board: Board, smartProbability: number = 1): number {
  const available = getAvailableCols(board)
  if (available.length === 0) {
    return -1
  }

  // Random move chance based on difficulty
  if (Math.random() > smartProbability) {
    return available[Math.floor(Math.random() * available.length)]
  }

  const winCol = findWinningCol(board, 2)
  if (winCol !== -1) {
    return winCol
  }

  const blockCol = findWinningCol(board, 1)
  if (blockCol !== -1) {
    return blockCol
  }

  const centerCol = 3
  if (available.includes(centerCol)) {
    return centerCol
  }

  const nearCenter = available.sort((a, b) => Math.abs(a - centerCol) - Math.abs(b - centerCol))
  return nearCenter[0]
}

function getAiSmartProbability(totalWins: number): number {
  if (totalWins < 2) return 0.3
  if (totalWins < 4) return 0.5
  if (totalWins < 7) return 0.7
  if (totalWins < 10) return 0.85
  return 1.0
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

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const finishedRef = useRef(false)
  const winStreakRef = useRef(0)
  const movesThisRoundRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const aiTimerRef = useRef<number | null>(null)
  const dropTimerRef = useRef<number | null>(null)

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

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true

    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current)
      aiTimerRef.current = null
    }
    if (dropTimerRef.current !== null) {
      window.clearTimeout(dropTimerRef.current)
      dropTimerRef.current = null
    }

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const startNewRound = useCallback(() => {
    setBoard(createEmptyBoard())
    setPhase('player-turn')
    setWinLine(null)
    setDroppingCell(null)
    setLastDropCol(null)
    movesThisRoundRef.current = 0
    setMovesThisRound(0)
  }, [])

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
        if (movesThisRoundRef.current <= QUICK_WIN_MOVES) {
          addedScore += QUICK_WIN_BONUS
        }
        if (feverActive) {
          addedScore *= FEVER_MULTIPLIER
        }

        setWins((prev) => prev + 1)
        setPhase('win')
      } else if (result === 'lose') {
        winStreakRef.current = 0
        setWinStreak(0)
        setIsFever(false)
        setLosses((prev) => prev + 1)
        setPhase('lose')
      } else {
        setDraws((prev) => prev + 1)
        setPhase('draw')
      }

      const nextScore = scoreRef.current + addedScore
      scoreRef.current = nextScore
      setScore(nextScore)

      playSfx(result === 'win' ? tapStrongAudioRef : gameOverAudioRef, 0.6, result === 'win' ? 1.1 : 0.9)

      if (dropTimerRef.current !== null) {
        window.clearTimeout(dropTimerRef.current)
      }
      dropTimerRef.current = window.setTimeout(() => {
        dropTimerRef.current = null
        if (!finishedRef.current) {
          startNewRound()
        }
      }, 1500)
    },
    [playSfx, startNewRound],
  )

  const placePiece = useCallback(
    (currentBoard: Board, col: number, player: CellValue): Board | null => {
      const row = getAvailableRow(currentBoard, col)
      if (row === -1) {
        return null
      }

      const nextBoard = cloneBoard(currentBoard)
      nextBoard[row][col] = player

      setDroppingCell({ row, col })
      setLastDropCol(col)
      setBoard(nextBoard)

      playSfx(tapAudioRef, 0.45, 0.9 + row * 0.04)

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
    [playSfx, resolveRound],
  )

  const runAiTurn = useCallback(
    (currentBoard: Board) => {
      if (finishedRef.current) {
        return
      }

      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current)
      }

      aiTimerRef.current = window.setTimeout(() => {
        aiTimerRef.current = null
        if (finishedRef.current) {
          return
        }

        const col = aiChooseCol(currentBoard, getAiSmartProbability(winStreakRef.current))
        if (col === -1) {
          return
        }

        const nextBoard = placePiece(currentBoard, col, 2)
        if (nextBoard === null) {
          return
        }

        const aiWin = checkWinAt(nextBoard, 2)
        const full = isBoardFull(nextBoard)
        if (aiWin === null && !full) {
          setPhase('player-turn')
        }
      }, AI_DELAY_MS)
    },
    [placePiece],
  )

  const handleColumnClick = useCallback(
    (col: number) => {
      if (finishedRef.current || phase !== 'player-turn') {
        return
      }

      movesThisRoundRef.current += 1
      setMovesThisRound(movesThisRoundRef.current)
      const nextBoard = placePiece(board, col, 1)
      if (nextBoard === null) {
        return
      }

      const playerWin = checkWinAt(nextBoard, 1)
      const full = isBoardFull(nextBoard)
      if (playerWin === null && !full) {
        setPhase('ai-turn')
        runAiTurn(nextBoard)
      }
    },
    [board, phase, placePiece, runAiTurn],
  )

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
      tapAudioRef.current = null
      tapStrongAudioRef.current = null
      gameOverAudioRef.current = null
      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current)
        aiTimerRef.current = null
      }
      if (dropTimerRef.current !== null) {
        window.clearTimeout(dropTimerRef.current)
        dropTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        onExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onExit])

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

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      if (remainingMsRef.current <= 0) {
        playSfx(gameOverAudioRef, 0.64, 0.95)
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
  }, [finishGame, playSfx])

  const isWinCell = useCallback(
    (row: number, col: number): boolean => {
      if (winLine === null) {
        return false
      }
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

  const phaseLabel =
    phase === 'player-turn'
      ? '당신의 차례'
      : phase === 'ai-turn'
        ? 'AI 생각 중...'
        : phase === 'win'
          ? '승리! +' + WIN_SCORE
          : phase === 'lose'
            ? '패배...'
            : phase === 'draw'
              ? '무승부 +' + DRAW_SCORE
              : ''

  return (
    <section className="mini-game-panel connect-four-panel" aria-label="connect-four-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative' }}>
      <div className="connect-four-score-strip">
        <p className="connect-four-score">{score.toLocaleString()}</p>
        <p className="connect-four-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`connect-four-time ${isLowTime ? 'connect-four-low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="connect-four-meta-row">
        <span className="connect-four-stat connect-four-stat-win">W {wins}</span>
        <span className="connect-four-stat connect-four-stat-draw">D {draws}</span>
        <span className="connect-four-stat connect-four-stat-loss">L {losses}</span>
      </div>

      <p className={`connect-four-phase ${phase}`}>{phaseLabel}</p>
      {isFever && (
        <p style={{ margin: 0, color: '#fbbf24', fontWeight: 800, fontSize: 13, textAlign: 'center', animation: 'connect-four-fever 0.5s ease-in-out infinite alternate', textShadow: '0 0 8px #f59e0b' }}>
          FEVER x{FEVER_MULTIPLIER} (Streak {winStreak})
        </p>
      )}
      {!isFever && winStreak >= 2 && (
        <p style={{ margin: 0, color: '#22c55e', fontWeight: 600, fontSize: 11, textAlign: 'center' }}>
          Streak {winStreak} - AI Lv.{Math.round(getAiSmartProbability(winStreak) * 5)}
        </p>
      )}

      <div className="connect-four-drop-buttons">
        {Array.from({ length: COLS }, (_, col) => (
          <button
            key={`drop-${col}`}
            className={`connect-four-drop-button ${lastDropCol === col ? 'connect-four-drop-active' : ''}`}
            type="button"
            onClick={() => handleColumnClick(col)}
            disabled={phase !== 'player-turn' || getAvailableRow(board, col) === -1}
            aria-label={`Column ${col + 1}`}
          >
            <span className="connect-four-drop-arrow">&#9660;</span>
          </button>
        ))}
      </div>

      <div className="connect-four-grid">
        {Array.from({ length: ROWS }, (_, row) => (
          <div key={`row-${row}`} className="connect-four-row">
            {Array.from({ length: COLS }, (_, col) => {
              const cellValue = board[row][col]
              const isWin = isWinCell(row, col)
              const isDropping = isDroppingCell(row, col)

              let cellClass = 'connect-four-cell'
              if (cellValue === 1) {
                cellClass += ' connect-four-cell-player'
              } else if (cellValue === 2) {
                cellClass += ' connect-four-cell-ai'
              }
              if (isWin) {
                cellClass += ' connect-four-cell-win'
              }
              if (isDropping) {
                cellClass += ' connect-four-cell-dropping'
              }

              return (
                <div key={`cell-${row}-${col}`} className={cellClass}>
                  {cellValue !== 0 && (
                    <div
                      className="connect-four-piece"
                      style={
                        isDropping
                          ? ({ '--connect-four-drop-rows': row } as React.CSSProperties)
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

      <div className="connect-four-legend">
        <span className="connect-four-legend-item">
          <span className="connect-four-legend-dot connect-four-legend-player" /> 플레이어
        </span>
        <span className="connect-four-legend-item">
          <span className="connect-four-legend-dot connect-four-legend-ai" /> AI
        </span>
      </div>

      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>

      <style>{`
        .connect-four-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 12px 8px;
          width: 100%;
          max-width: 400px;
          margin: 0 auto;
          user-select: none;
          aspect-ratio: 9 / 16;
        }

        .connect-four-score-strip {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          width: 100%;
          padding: 0 4px;
        }

        .connect-four-score {
          font-size: 28px;
          font-weight: 800;
          color: #fbbf24;
          margin: 0;
        }

        .connect-four-best {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
        }

        .connect-four-time {
          font-size: 16px;
          font-weight: 700;
          color: #e5e7eb;
          margin: 0;
          transition: color 0.3s;
        }

        .connect-four-low-time {
          color: #ef4444;
          animation: connect-four-blink 0.5s infinite alternate;
        }

        @keyframes connect-four-blink {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }

        .connect-four-meta-row {
          display: flex;
          gap: 12px;
          font-size: 13px;
          font-weight: 600;
        }

        .connect-four-stat-win {
          color: #22c55e;
        }

        .connect-four-stat-draw {
          color: #facc15;
        }

        .connect-four-stat-loss {
          color: #ef4444;
        }

        .connect-four-phase {
          font-size: 15px;
          font-weight: 700;
          margin: 2px 0;
          min-height: 22px;
        }

        .connect-four-phase.player-turn {
          color: #f87171;
        }

        .connect-four-phase.ai-turn {
          color: #facc15;
          animation: connect-four-pulse 0.8s infinite alternate;
        }

        .connect-four-phase.win {
          color: #22c55e;
          animation: connect-four-pop 0.4s ease-out;
        }

        .connect-four-phase.lose {
          color: #ef4444;
        }

        .connect-four-phase.draw {
          color: #a78bfa;
        }

        @keyframes connect-four-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        @keyframes connect-four-pop {
          0% { transform: scale(1); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }

        .connect-four-drop-buttons {
          display: grid;
          grid-template-columns: repeat(${COLS}, 1fr);
          gap: 3px;
          width: 100%;
          max-width: 322px;
        }

        .connect-four-drop-button {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 28px;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 6px 6px 2px 2px;
          color: #d1d5db;
          font-size: 14px;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }

        .connect-four-drop-button:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.25);
          transform: scale(1.06);
        }

        .connect-four-drop-button:disabled {
          opacity: 0.25;
          cursor: not-allowed;
        }

        .connect-four-drop-active {
          background: rgba(239, 68, 68, 0.18);
        }

        .connect-four-drop-arrow {
          display: block;
          line-height: 1;
        }

        .connect-four-grid {
          display: flex;
          flex-direction: column;
          gap: 3px;
          background: #1e3a5f;
          padding: 8px;
          border-radius: 10px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        }

        .connect-four-row {
          display: grid;
          grid-template-columns: repeat(${COLS}, 1fr);
          gap: 3px;
        }

        .connect-four-cell {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #0f172a;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
          overflow: hidden;
        }

        .connect-four-piece {
          width: 34px;
          height: 34px;
          border-radius: 50%;
          transition: box-shadow 0.3s;
        }

        .connect-four-cell-player .connect-four-piece {
          background: radial-gradient(circle at 35% 35%, #ff6b6b, #dc2626);
          box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(220, 38, 38, 0.4);
        }

        .connect-four-cell-ai .connect-four-piece {
          background: radial-gradient(circle at 35% 35%, #ffe066, #eab308);
          box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(234, 179, 8, 0.4);
        }

        .connect-four-cell-win .connect-four-piece {
          animation: connect-four-win-glow 0.6s infinite alternate;
        }

        @keyframes connect-four-win-glow {
          from {
            box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.3), 0 0 6px rgba(255, 255, 255, 0.4);
            transform: scale(1);
          }
          to {
            box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.3), 0 0 16px rgba(255, 255, 255, 0.8);
            transform: scale(1.08);
          }
        }

        .connect-four-cell-dropping .connect-four-piece {
          animation: connect-four-drop ${DROP_ANIMATION_MS}ms cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        @keyframes connect-four-drop {
          from {
            transform: translateY(calc(var(--connect-four-drop-rows, 0) * -43px - 43px));
            opacity: 0.7;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .connect-four-legend {
          display: flex;
          gap: 16px;
          font-size: 12px;
          color: #9ca3af;
          margin-top: 2px;
        }

        .connect-four-legend-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .connect-four-legend-dot {
          display: inline-block;
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .connect-four-legend-player {
          background: #dc2626;
        }

        .connect-four-legend-ai {
          background: #eab308;
        }

        @keyframes connect-four-fever {
          from { opacity: 0.7; transform: scale(1); }
          to { opacity: 1; transform: scale(1.04); }
        }
      `}</style>
    </section>
  )
}

export const connectFourModule: MiniGameModule = {
  manifest: {
    id: 'connect-four',
    title: 'Connect Four',
    description: 'AI와 사목 대결! 가로세로대각선 4개를 먼저 연결하라!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.25,
    accentColor: '#dc2626',
  },
  Component: ConnectFourGame,
}
