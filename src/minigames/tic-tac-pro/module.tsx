import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 60000
const AI_MOVE_DELAY_MS = 300
const SCORE_WIN = 30
const SCORE_DRAW = 10
const SCORE_LOSE = 0
const WIN_LINE_FLASH_MS = 600
const LOW_TIME_THRESHOLD_MS = 10000
const FEVER_THRESHOLD = 3
const FEVER_MULTIPLIER = 2
const QUICK_WIN_MOVES = 5
const QUICK_WIN_BONUS = 15

const WINNING_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const

type CellValue = null | 'O' | 'X'
type BoardState = readonly [CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue]
type GameOutcome = 'win' | 'draw' | 'lose' | null

const EMPTY_BOARD: BoardState = [null, null, null, null, null, null, null, null, null]

function checkWinner(board: BoardState): CellValue {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) {
      return board[a]
    }
  }
  return null
}

function getWinningLine(board: BoardState): readonly [number, number, number] | null {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line
    if (board[a] !== null && board[a] === board[b] && board[b] === board[c]) {
      return line
    }
  }
  return null
}

function isBoardFull(board: BoardState): boolean {
  return board.every((cell) => cell !== null)
}

function getEmptyCells(board: BoardState): number[] {
  const empty: number[] = []
  for (let i = 0; i < 9; i += 1) {
    if (board[i] === null) {
      empty.push(i)
    }
  }
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
    for (const cell of emptyCells) {
      const nextBoard = placeOnBoard(board, cell, 'X')
      best = Math.max(best, minimax(nextBoard, false, depth + 1))
    }
    return best
  }

  let best = Infinity
  for (const cell of emptyCells) {
    const nextBoard = placeOnBoard(board, cell, 'O')
    best = Math.min(best, minimax(nextBoard, true, depth + 1))
  }
  return best
}

function aiMoveRandom(board: BoardState): number {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1
  return empty[Math.floor(Math.random() * empty.length)]
}

function aiMoveSmart(board: BoardState): number {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return -1

  let bestScore = -Infinity
  let bestMove = empty[0]
  for (const cell of empty) {
    const nextBoard = placeOnBoard(board, cell, 'X')
    const score = minimax(nextBoard, false, 0)
    if (score > bestScore) {
      bestScore = score
      bestMove = cell
    }
  }
  return bestMove
}

function aiMoveHybrid(board: BoardState, smartProbability: number): number {
  if (Math.random() < smartProbability) {
    return aiMoveSmart(board)
  }
  return aiMoveRandom(board)
}

function getDifficulty(totalScore: number): number {
  if (totalScore < 30) return 0.0
  if (totalScore < 80) return 0.2
  if (totalScore < 150) return 0.4
  if (totalScore < 250) return 0.6
  if (totalScore < 400) return 0.8
  return 1.0
}

function TicTacProGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [board, setBoard] = useState<BoardState>(EMPTY_BOARD)
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

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverHitAudioRef = useRef<HTMLAudioElement | null>(null)

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) return
      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(aiTimerRef)
    clearTimeoutSafe(roundTransitionTimerRef)
    playAudio(gameOverHitAudioRef, 0.6, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(Math.max(16.66, ROUND_DURATION_MS - remainingMsRef.current)),
    })
  }, [onFinish, playAudio])

  const startNewRound = useCallback(() => {
    boardRef.current = EMPTY_BOARD
    isPlayerTurnRef.current = true
    outcomeRef.current = null
    movesThisRoundRef.current = 0
    setBoard(EMPTY_BOARD)
    setIsPlayerTurn(true)
    setOutcome(null)
    setWinningLine(null)
    setRoundTransition(false)
    setMovesThisRound(0)
  }, [])

  const resolveRound = useCallback(
    (currentBoard: BoardState) => {
      const winner = checkWinner(currentBoard)
      const full = isBoardFull(currentBoard)
      if (winner === null && !full) return

      let roundOutcome: GameOutcome
      let roundScore: number

      if (winner === 'O') {
        roundOutcome = 'win'
        const nextStreak = winStreakRef.current + 1
        winStreakRef.current = nextStreak
        setWinStreak(nextStreak)

        const feverActive = nextStreak >= FEVER_THRESHOLD
        setIsFever(feverActive)

        roundScore = SCORE_WIN
        if (movesThisRoundRef.current <= QUICK_WIN_MOVES) {
          roundScore += QUICK_WIN_BONUS
        }
        if (feverActive) {
          roundScore *= FEVER_MULTIPLIER
        }

        setWins((prev) => prev + 1)
        playAudio(tapHitStrongAudioRef, 0.7, feverActive ? 1.3 : 1.1)
        effects.comboHitBurst(120, 120, nextStreak, roundScore)
        if (feverActive) {
          effects.triggerFlash('rgba(250,204,21,0.5)')
        }
      } else if (winner === 'X') {
        roundOutcome = 'lose'
        roundScore = SCORE_LOSE
        winStreakRef.current = 0
        setWinStreak(0)
        setIsFever(false)
        setLosses((prev) => prev + 1)
        playAudio(tapHitStrongAudioRef, 0.5, 0.8)
        effects.triggerFlash('rgba(239,68,68,0.4)')
        effects.triggerShake(6)
      } else {
        roundOutcome = 'draw'
        roundScore = SCORE_DRAW
        setDraws((prev) => prev + 1)
        playAudio(tapHitStrongAudioRef, 0.55, 0.95)
        effects.triggerFlash('rgba(250,204,21,0.3)')
        effects.showScorePopup(SCORE_DRAW, 120, 100)
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
        if (!finishedRef.current) {
          startNewRound()
        }
      }, 1200)
    },
    [playAudio, startNewRound],
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
      isPlayerTurnRef.current = true
      setIsPlayerTurn(true)
      playAudio(tapHitAudioRef, 0.35, 0.9)

      resolveRound(nextBoard)
    },
    [playAudio, resolveRound],
  )

  const handleCellClick = useCallback(
    (index: number) => {
      if (finishedRef.current) return
      if (outcomeRef.current !== null) return
      if (!isPlayerTurnRef.current) return
      if (boardRef.current[index] !== null) return

      const nextBoard = placeOnBoard(boardRef.current, index, 'O')
      boardRef.current = nextBoard
      movesThisRoundRef.current += 1
      setMovesThisRound(movesThisRoundRef.current)
      setBoard(nextBoard)
      playAudio(tapHitAudioRef, 0.45, 1.05)
      effects.spawnParticles(3, (index % 3) * 80 + 50, Math.floor(index / 3) * 80 + 50)
      effects.triggerShake(2)

      const winner = checkWinner(nextBoard)
      const full = isBoardFull(nextBoard)
      if (winner !== null || full) {
        resolveRound(nextBoard)
        return
      }

      isPlayerTurnRef.current = false
      setIsPlayerTurn(false)

      clearTimeoutSafe(aiTimerRef)
      aiTimerRef.current = window.setTimeout(() => {
        aiTimerRef.current = null
        performAiMove(nextBoard)
      }, AI_MOVE_DELAY_MS)
    },
    [performAiMove, playAudio, resolveRound],
  )

  const handleExit = useCallback(() => {
    playAudio(tapHitAudioRef, 0.4, 1.0)
    onExit()
  }, [onExit, playAudio])

  useEffect(() => {
    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    const gameOverHitAudio = new Audio(gameOverHitSfx)
    gameOverHitAudio.preload = 'auto'
    gameOverHitAudioRef.current = gameOverHitAudio

    return () => {
      clearTimeoutSafe(aiTimerRef)
      clearTimeoutSafe(roundTransitionTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverHitAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
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

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
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
  }, [finishGame])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const totalGames = wins + draws + losses

  const outcomeLabel = outcome === 'win'
    ? `WIN! +${SCORE_WIN}${movesThisRound <= QUICK_WIN_MOVES ? ` +${QUICK_WIN_BONUS} QUICK` : ''}${isFever ? ' x2 FEVER' : ''}`
    : outcome === 'draw' ? 'DRAW +10'
    : outcome === 'lose' ? 'LOSE +0'
    : null

  return (
    <section className="mini-game-panel tic-tac-pro-panel" aria-label="tic-tac-pro-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <div className="tic-tac-pro-score-strip">
        <p className="tic-tac-pro-score">{score.toLocaleString()}</p>
        <p className="tic-tac-pro-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`tic-tac-pro-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
      </div>

      <div className="tic-tac-pro-stats-row">
        <p className="tic-tac-pro-stat">
          <span className="tic-tac-pro-stat-label">Games</span> <strong>{totalGames}</strong>
        </p>
        <p className="tic-tac-pro-stat win">
          <span className="tic-tac-pro-stat-label">W</span> <strong>{wins}</strong>
        </p>
        <p className="tic-tac-pro-stat draw">
          <span className="tic-tac-pro-stat-label">D</span> <strong>{draws}</strong>
        </p>
        <p className="tic-tac-pro-stat lose">
          <span className="tic-tac-pro-stat-label">L</span> <strong>{losses}</strong>
        </p>
      </div>

      <div className={`tic-tac-pro-arena ${roundTransition ? 'round-end' : ''}`}>
        {outcomeLabel !== null ? (
          <div className={`tic-tac-pro-outcome ${outcome}`}>
            <p>{outcomeLabel}</p>
          </div>
        ) : null}

        <div className="tic-tac-pro-board">
          {board.map((cell, index) => {
            const isWinCell = winningLine !== null && winningLine.includes(index)
            const isClickable = cell === null && isPlayerTurn && outcome === null && !finishedRef.current
            return (
              <button
                className={`tic-tac-pro-cell ${cell !== null ? `filled ${cell}` : ''} ${isWinCell ? 'win-highlight' : ''} ${isClickable ? 'clickable' : ''}`}
                key={index}
                type="button"
                onClick={() => handleCellClick(index)}
                disabled={!isClickable}
                aria-label={`Cell ${index + 1}: ${cell ?? 'empty'}`}
              >
                {cell !== null ? (
                  <span className={`tic-tac-pro-mark ${cell}`}>{cell}</span>
                ) : null}
              </button>
            )
          })}
        </div>

        {!isPlayerTurn && outcome === null ? (
          <p className="tic-tac-pro-thinking">AI is thinking...</p>
        ) : null}
      </div>

      <div className="tic-tac-pro-info-row">
        <p className="tic-tac-pro-turn-label">
          {outcome !== null
            ? 'Next round soon...'
            : isPlayerTurn
              ? 'Your turn (O)'
              : "AI's turn (X)"}
        </p>
        <p className="tic-tac-pro-difficulty">
          AI Lv.{Math.round(getDifficulty(score) * 5)}
        </p>
      </div>

      {isFever && (
        <div style={{ textAlign: 'center', color: '#fbbf24', fontWeight: 800, fontSize: 16, animation: 'tic-tac-pro-fever-pulse 0.5s ease-in-out infinite alternate', textShadow: '0 0 8px #f59e0b' }}>
          FEVER MODE x{FEVER_MULTIPLIER} (Streak {winStreak})
        </div>
      )}
      {!isFever && winStreak >= 2 && (
        <div style={{ textAlign: 'center', color: '#22c55e', fontWeight: 700, fontSize: 13 }}>
          Win Streak {winStreak} - {FEVER_THRESHOLD - winStreak} more for FEVER!
        </div>
      )}

      <style>{`
        @keyframes tic-tac-pro-fever-pulse {
          from { opacity: 0.7; transform: scale(1); }
          to { opacity: 1; transform: scale(1.05); }
        }
      `}</style>

      {wins > 0 && getComboLabel(wins) !== '' && (
        <div className="ge-combo-label" style={{ fontSize: 18, color: getComboColor(wins), textAlign: 'center' }}>
          {getComboLabel(wins)}
        </div>
      )}

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const ticTacProModule: MiniGameModule = {
  manifest: {
    id: 'tic-tac-pro',
    title: 'Tic Tac Pro',
    description: 'AI와 틱택토 대결! 이기면 30점, 비기면 10점!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#0d9488',
  },
  Component: TicTacProGame,
}
