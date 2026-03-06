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

const ROUND_DURATION_MS = 60000
const AI_MOVE_DELAY_MS = 280
const SCORE_WIN = 30
const SCORE_DRAW = 10
const SCORE_LOSE = 0
const LOW_TIME_THRESHOLD_MS = 10000
const FEVER_THRESHOLD = 3
const FEVER_MULTIPLIER = 2
const QUICK_WIN_MOVES = 5
const QUICK_WIN_BONUS = 15
const POWERUP_INTERVAL_WINS = 4
const POWERUP_HINT_BONUS_SCORE = 5
const POWERUP_TIME_BONUS_MS = 5000
const POWERUP_DOUBLE_ROUNDS = 1
const GOLDEN_CELL_BONUS = 20
const BOMB_CELL_PENALTY = -10
const SPECIAL_CELL_CHANCE = 0.15

const WINNING_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
] as const

type CellValue = null | 'O' | 'X'
type BoardState = readonly [CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue, CellValue]
type GameOutcome = 'win' | 'draw' | 'lose' | null
type PowerupType = 'hint' | 'time' | 'double'
type SpecialCell = null | 'golden' | 'bomb'

const EMPTY_BOARD: BoardState = [null, null, null, null, null, null, null, null, null]
const EMPTY_SPECIALS: readonly SpecialCell[] = [null, null, null, null, null, null, null, null, null]

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
  for (let i = 0; i < 9; i += 1) {
    if (board[i] === null) empty.push(i)
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
    const score = minimax(placeOnBoard(board, cell, 'X'), false, 0)
    if (score > bestScore) { bestScore = score; bestMove = cell }
  }
  return bestMove
}

function aiMoveHybrid(board: BoardState, smartProbability: number): number {
  return Math.random() < smartProbability ? aiMoveSmart(board) : aiMoveRandom(board)
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
  if (d <= 0) return 'EASY'
  if (d <= 0.2) return 'NORMAL'
  if (d <= 0.4) return 'HARD'
  if (d <= 0.6) return 'EXPERT'
  if (d <= 0.8) return 'MASTER'
  return 'LEGEND'
}

function generateSpecialCells(): SpecialCell[] {
  const specials: SpecialCell[] = [null, null, null, null, null, null, null, null, null]
  for (let i = 0; i < 9; i++) {
    if (Math.random() < SPECIAL_CELL_CHANCE) {
      specials[i] = Math.random() < 0.7 ? 'golden' : 'bomb'
    }
  }
  return specials
}

function getHintCell(board: BoardState): number | null {
  const empty = getEmptyCells(board)
  if (empty.length === 0) return null
  for (const cell of empty) {
    const next = placeOnBoard(board, cell, 'O')
    if (checkWinner(next) === 'O') return cell
  }
  for (const cell of empty) {
    const next = placeOnBoard(board, cell, 'X')
    if (checkWinner(next) === 'X') return cell
  }
  if (board[4] === null) return 4
  return empty[Math.floor(Math.random() * empty.length)]
}

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
  const [, setTotalWins] = useState(0)
  const [, setPowerup] = useState<PowerupType | null>(null)
  const [doubleScoreRounds, setDoubleScoreRounds] = useState(0)
  const [hintCell, setHintCell] = useState<number | null>(null)
  const [, setLastPlacedCell] = useState<number | null>(null)
  const [cellAnimations, setCellAnimations] = useState<Record<number, string>>({})
  const [showPowerupPicker, setShowPowerupPicker] = useState(false)
  const [, setWarningPlayed] = useState(false)
  const [roundNumber, setRoundNumber] = useState(1)

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
  const warningPlayedRef = useRef(false)

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
    setLastPlacedCell(null)
    setCellAnimations({})
    setRoundNumber((prev) => prev + 1)

    if (doubleScoreRoundsRef.current > 0) {
      doubleScoreRoundsRef.current -= 1
      setDoubleScoreRounds(doubleScoreRoundsRef.current)
    }
  }, [])

  const handlePowerupSelect = useCallback((type: PowerupType) => {
    setShowPowerupPicker(false)
    setPowerup(null)

    if (type === 'hint') {
      const hint = getHintCell(boardRef.current)
      setHintCell(hint)
      playAudio('powerup', 0.6)
      if (hint !== null) {
        const nextScore = scoreRef.current + POWERUP_HINT_BONUS_SCORE
        scoreRef.current = nextScore
        setScore(nextScore)
        effects.showScorePopup(POWERUP_HINT_BONUS_SCORE, 200, 200)
      }
    } else if (type === 'time') {
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + POWERUP_TIME_BONUS_MS)
      setRemainingMs(remainingMsRef.current)
      playAudio('powerup', 0.7)
      effects.triggerFlash('rgba(59,130,246,0.4)')
      effects.showScorePopup(5, 200, 200)
    } else if (type === 'double') {
      doubleScoreRoundsRef.current = POWERUP_DOUBLE_ROUNDS
      setDoubleScoreRounds(POWERUP_DOUBLE_ROUNDS)
      playAudio('powerup', 0.7, 1.2)
      effects.triggerFlash('rgba(250,204,21,0.4)')
    }
  }, [playAudio, effects])

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
        const nextTotalWins = totalWinsRef.current + 1
        totalWinsRef.current = nextTotalWins
        setTotalWins(nextTotalWins)

        const feverActive = nextStreak >= FEVER_THRESHOLD
        setIsFever(feverActive)

        roundScore = SCORE_WIN
        if (movesThisRoundRef.current <= QUICK_WIN_MOVES) roundScore += QUICK_WIN_BONUS
        if (feverActive) roundScore *= FEVER_MULTIPLIER
        if (doubleScoreRoundsRef.current > 0) roundScore *= 2

        setWins((prev) => prev + 1)
        playAudio('win', 0.7, feverActive ? 1.3 : 1.1)
        if (nextStreak >= 2) playAudio('combo', 0.5, 1 + nextStreak * 0.1)
        if (feverActive && nextStreak === FEVER_THRESHOLD) playAudio('fever', 0.7)

        const wLine = getWinningLine(currentBoard)
        if (wLine) {
          wLine.forEach((idx, i) => {
            setTimeout(() => {
              setCellAnimations((prev) => ({ ...prev, [idx]: 'win-cell-pop' }))
            }, i * 100)
          })
        }

        effects.comboHitBurst(200, 300, nextStreak, roundScore)
        if (feverActive) effects.triggerFlash('rgba(250,204,21,0.5)')

        if (nextTotalWins > 0 && nextTotalWins % POWERUP_INTERVAL_WINS === 0) {
          setTimeout(() => {
            setShowPowerupPicker(true)
          }, 600)
        }
      } else if (winner === 'X') {
        roundOutcome = 'lose'
        roundScore = SCORE_LOSE
        winStreakRef.current = 0
        setWinStreak(0)
        setIsFever(false)
        setLosses((prev) => prev + 1)
        playAudio('lose', 0.5, 0.8)
        effects.triggerFlash('rgba(239,68,68,0.4)')
        effects.triggerShake(8)
      } else {
        roundOutcome = 'draw'
        roundScore = SCORE_DRAW
        if (doubleScoreRoundsRef.current > 0) roundScore *= 2
        setDraws((prev) => prev + 1)
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
      }, 1200)
    },
    [playAudio, startNewRound, effects],
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
      setLastPlacedCell(aiCell)
      setCellAnimations((prev) => ({ ...prev, [aiCell]: 'cell-place-bounce' }))
      isPlayerTurnRef.current = true
      setIsPlayerTurn(true)
      playAudio('place', 0.35, 0.85)
      resolveRound(nextBoard)
    },
    [playAudio, resolveRound],
  )

  const handleCellClick = useCallback(
    (index: number) => {
      if (finishedRef.current || outcomeRef.current !== null || !isPlayerTurnRef.current || boardRef.current[index] !== null || showPowerupPicker) return

      const nextBoard = placeOnBoard(boardRef.current, index, 'O')
      boardRef.current = nextBoard
      movesThisRoundRef.current += 1
      setMovesThisRound(movesThisRoundRef.current)
      setBoard(nextBoard)
      setLastPlacedCell(index)
      setHintCell(null)
      setCellAnimations((prev) => ({ ...prev, [index]: 'cell-place-bounce' }))
      playAudio('place', 0.5, 1.05)

      const col = index % 3
      const row = Math.floor(index / 3)
      effects.spawnParticles(5, col * 120 + 60, row * 120 + 60)
      effects.triggerShake(3)

      const special = specialCells[index]
      if (special === 'golden') {
        const bonus = GOLDEN_CELL_BONUS
        const nextScore = scoreRef.current + bonus
        scoreRef.current = nextScore
        setScore(nextScore)
        effects.showScorePopup(bonus, col * 120 + 60, row * 120 + 60)
        playAudio('combo', 0.6, 1.3)
        effects.triggerFlash('rgba(250,204,21,0.3)')
      } else if (special === 'bomb') {
        const penalty = BOMB_CELL_PENALTY
        const nextScore = Math.max(0, scoreRef.current + penalty)
        scoreRef.current = nextScore
        setScore(nextScore)
        effects.showScorePopup(penalty, col * 120 + 60, row * 120 + 60)
        effects.triggerShake(10)
        effects.triggerFlash('rgba(239,68,68,0.5)')
      }

      const winner = checkWinner(nextBoard)
      const full = isBoardFull(nextBoard)
      if (winner !== null || full) { resolveRound(nextBoard); return }

      isPlayerTurnRef.current = false
      setIsPlayerTurn(false)
      clearTimeoutSafe(aiTimerRef)
      aiTimerRef.current = window.setTimeout(() => { aiTimerRef.current = null; performAiMove(nextBoard) }, AI_MOVE_DELAY_MS)
    },
    [performAiMove, playAudio, resolveRound, effects, specialCells, showPowerupPicker],
  )

  const handleExit = useCallback(() => { playAudio('place', 0.4, 1.0); onExit() }, [onExit, playAudio])

  useEffect(() => {
    const sounds: Record<string, string> = { place: placeSfx, win: winSfx, lose: loseSfx, draw: drawSfx, fever: feverSfx, combo: comboSfx, powerup: powerupSfx, warning: warningSfx }
    for (const [key, src] of Object.entries(sounds)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }
    setSpecialCells(generateSpecialCells())
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
    return () => { window.removeEventListener('keydown', handleKeyDown) }
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

      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && !warningPlayedRef.current) {
        warningPlayedRef.current = true
        setWarningPlayed(true)
        playAudio('warning', 0.5)
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
  const outcomeLabel = outcome === 'win'
    ? `WIN! +${SCORE_WIN}${movesThisRound <= QUICK_WIN_MOVES ? ` +${QUICK_WIN_BONUS}Q` : ''}${isFever ? ' x2F' : ''}${doubleScoreRounds > 0 ? ' x2D' : ''}`
    : outcome === 'draw' ? `DRAW +${SCORE_DRAW}${doubleScoreRounds > 0 ? ' x2' : ''}`
    : outcome === 'lose' ? 'LOSE +0'
    : null

  return (
    <section className="mini-game-panel tic-tac-pro-panel" aria-label="tic-tac-pro-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{TIC_TAC_PRO_CSS}</style>

      {/* Top HUD */}
      <div className="ttp-hud-top">
        <div className="ttp-score-area">
          <p className="ttp-score">{score.toLocaleString()}</p>
          <p className="ttp-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="ttp-time-area">
          <p className={`ttp-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <p className="ttp-round">R{roundNumber}</p>
        </div>
      </div>

      {/* Stats Row */}
      <div className="ttp-stats-row">
        <span className="ttp-stat"><span className="ttp-stat-lbl">W</span><strong className="ttp-stat-win">{wins}</strong></span>
        <span className="ttp-stat"><span className="ttp-stat-lbl">D</span><strong className="ttp-stat-draw">{draws}</strong></span>
        <span className="ttp-stat"><span className="ttp-stat-lbl">L</span><strong className="ttp-stat-lose">{losses}</strong></span>
        <span className="ttp-difficulty-badge">{diffLabel}</span>
      </div>

      {/* Fever / Streak */}
      {isFever && (
        <div className="ttp-fever-bar">FEVER x{FEVER_MULTIPLIER} ({winStreak})</div>
      )}
      {!isFever && winStreak >= 2 && (
        <div className="ttp-streak-bar">{winStreak} STREAK - {FEVER_THRESHOLD - winStreak} to FEVER</div>
      )}
      {doubleScoreRounds > 0 && (
        <div className="ttp-double-bar">DOUBLE SCORE ACTIVE</div>
      )}

      {/* Game Board Area */}
      <div className={`ttp-arena ${roundTransition ? 'round-end' : ''}`}>
        {outcomeLabel !== null && (
          <div className={`ttp-outcome ${outcome}`}>
            <p>{outcomeLabel}</p>
          </div>
        )}

        <div className="ttp-board">
          {board.map((cell, index) => {
            const isWinCell = winningLine !== null && winningLine.includes(index)
            const isClickable = cell === null && isPlayerTurn && outcome === null && !finishedRef.current && !showPowerupPicker
            const isHint = hintCell === index && cell === null
            const special = specialCells[index]
            const animClass = cellAnimations[index] ?? ''
            return (
              <button
                className={`ttp-cell ${cell !== null ? `filled ${cell}` : ''} ${isWinCell ? 'win-highlight' : ''} ${isClickable ? 'clickable' : ''} ${isHint ? 'hint' : ''} ${special !== null && cell === null ? `special-${special}` : ''} ${animClass}`}
                key={index}
                type="button"
                onClick={() => handleCellClick(index)}
                disabled={!isClickable}
                aria-label={`Cell ${index + 1}: ${cell ?? 'empty'}`}
              >
                {cell !== null ? (
                  <span className={`ttp-mark ${cell}`}>{cell}</span>
                ) : special === 'golden' ? (
                  <span className="ttp-special-icon golden-icon">*</span>
                ) : special === 'bomb' ? (
                  <span className="ttp-special-icon bomb-icon">!</span>
                ) : null}
              </button>
            )
          })}
        </div>

        {!isPlayerTurn && outcome === null && !showPowerupPicker && (
          <p className="ttp-thinking">AI...</p>
        )}
      </div>

      {/* Turn / Info */}
      <div className="ttp-info-row">
        <p className="ttp-turn-label">
          {outcome !== null ? 'NEXT...' : isPlayerTurn ? 'YOUR TURN' : 'AI TURN'}
        </p>
      </div>

      {/* Combo Label */}
      {wins > 0 && getComboLabel(wins) !== '' && (
        <div className="ge-combo-label" style={{ fontSize: 16, color: getComboColor(wins), textAlign: 'center' }}>
          {getComboLabel(wins)}
        </div>
      )}

      {/* Powerup Picker Overlay */}
      {showPowerupPicker && (
        <div className="ttp-powerup-overlay">
          <p className="ttp-powerup-title">POWER UP!</p>
          <div className="ttp-powerup-options">
            <button className="ttp-powerup-btn hint" type="button" onClick={() => handlePowerupSelect('hint')}>
              <span className="ttp-pw-icon">?</span>
              <span className="ttp-pw-name">HINT</span>
            </button>
            <button className="ttp-powerup-btn time" type="button" onClick={() => handlePowerupSelect('time')}>
              <span className="ttp-pw-icon">+</span>
              <span className="ttp-pw-name">+5s</span>
            </button>
            <button className="ttp-powerup-btn double" type="button" onClick={() => handlePowerupSelect('double')}>
              <span className="ttp-pw-icon">x2</span>
              <span className="ttp-pw-name">DOUBLE</span>
            </button>
          </div>
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

const TIC_TAC_PRO_CSS = `
.tic-tac-pro-panel {
  aspect-ratio: 9 / 16;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  overflow: hidden;
  padding: 8px 12px !important;
  background: #f5f4ef;
}

.ttp-hud-top {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.ttp-score-area { display: flex; flex-direction: column; gap: 2px; }
.ttp-score { margin: 0; font-size: clamp(1.8rem, 6vw, 2.4rem); color: #0d9488; font-weight: 800; text-shadow: 2px 2px 0 #065f56; line-height: 1; }
.ttp-best { margin: 0; font-size: 0.45rem; color: #6b7280; }
.ttp-time-area { text-align: right; display: flex; flex-direction: column; gap: 2px; }
.ttp-time { margin: 0; font-size: clamp(1rem, 3.5vw, 1.4rem); color: #1f2937; font-weight: 700; font-variant-numeric: tabular-nums; }
.ttp-time.low-time { color: #dc2626; animation: pulse-glow 0.5s ease-in-out infinite alternate; }
.ttp-round { margin: 0; font-size: 0.4rem; color: #9ca3af; }

.ttp-stats-row {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}
.ttp-stat { font-size: 0.5rem; color: #374151; }
.ttp-stat-lbl { color: #9ca3af; margin-right: 2px; }
.ttp-stat-win { color: #0d9488; }
.ttp-stat-draw { color: #d97706; }
.ttp-stat-lose { color: #dc2626; }
.ttp-difficulty-badge {
  font-size: 0.4rem;
  padding: 2px 6px;
  border: 2px solid #6b7280;
  border-radius: 2px;
  color: #374151;
  font-weight: 700;
  letter-spacing: 1px;
}

.ttp-fever-bar {
  width: 100%;
  text-align: center;
  color: #fbbf24;
  font-weight: 800;
  font-size: clamp(0.6rem, 2vw, 0.8rem);
  animation: ttp-fever-pulse 0.5s ease-in-out infinite alternate;
  text-shadow: 0 0 8px #f59e0b, 0 0 16px #f59e0b;
  padding: 2px 0;
}
.ttp-streak-bar {
  width: 100%;
  text-align: center;
  color: #22c55e;
  font-weight: 700;
  font-size: 0.45rem;
}
.ttp-double-bar {
  width: 100%;
  text-align: center;
  color: #a855f7;
  font-weight: 700;
  font-size: 0.45rem;
  animation: ttp-fever-pulse 0.8s ease-in-out infinite alternate;
}

.ttp-arena {
  position: relative;
  width: 100%;
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 0;
}
.ttp-arena.round-end { opacity: 0.6; pointer-events: none; }

.ttp-outcome {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 6px 16px;
  border: 3px solid;
  font-size: clamp(0.7rem, 2.5vw, 0.9rem);
  font-weight: 800;
  text-align: center;
  animation: ttp-outcome-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  white-space: nowrap;
}
.ttp-outcome.win { background: #ccfbf1; color: #0d9488; border-color: #0d9488; }
.ttp-outcome.draw { background: #fef3c7; color: #d97706; border-color: #d97706; }
.ttp-outcome.lose { background: #fee2e2; color: #dc2626; border-color: #dc2626; }

.ttp-board {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  gap: 4px;
  width: min(95%, 380px);
  aspect-ratio: 1;
  padding: 4px;
  background: #4b5563;
  border: 4px solid #374151;
}

.ttp-cell {
  position: relative;
  border: 3px solid #6b7280;
  background: #f5f4ef;
  cursor: default;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.1s, border-color 0.1s, transform 0.1s;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.ttp-cell.clickable {
  cursor: pointer;
  background: #f0fdfa;
  border-color: #0d9488;
}
.ttp-cell.clickable:hover { background: #ccfbf1; }
.ttp-cell.clickable:active { transform: scale(0.9); }
.ttp-cell.hint {
  background: rgba(59,130,246,0.15);
  border-color: #3b82f6;
  animation: ttp-hint-pulse 0.8s ease-in-out infinite alternate;
}
.ttp-cell.special-golden { background: rgba(250,204,21,0.1); border-color: #eab308; }
.ttp-cell.special-bomb { background: rgba(239,68,68,0.08); border-color: #f87171; }
.ttp-cell.win-highlight {
  background: #5eead4;
  border-color: #0d9488;
  animation: ttp-win-flash 0.4s ease-in-out infinite alternate;
}
.ttp-cell.cell-place-bounce { animation: ttp-cell-bounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1); }
.ttp-cell.win-cell-pop { animation: ttp-win-cell-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1); }

.ttp-mark {
  font-weight: 800;
  line-height: 1;
  font-size: clamp(2rem, 8vw, 3.5rem);
  text-shadow: 2px 2px 0 rgba(0,0,0,0.15);
}
.ttp-mark.O { color: #0d9488; }
.ttp-mark.X { color: #ef4444; }

.ttp-special-icon {
  font-size: clamp(0.8rem, 3vw, 1.2rem);
  font-weight: 800;
  animation: ttp-special-glow 1s ease-in-out infinite alternate;
}
.golden-icon { color: #eab308; text-shadow: 0 0 6px #fbbf24; }
.bomb-icon { color: #ef4444; text-shadow: 0 0 6px #f87171; }

.ttp-thinking {
  margin: 0;
  font-size: 0.5rem;
  color: #9ca3af;
  animation: blink 0.8s step-end infinite;
}

.ttp-info-row {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}
.ttp-turn-label {
  margin: 0;
  font-size: clamp(0.55rem, 2vw, 0.7rem);
  color: #374151;
  font-weight: 700;
}

/* Powerup Overlay */
.ttp-powerup-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.7);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  z-index: 50;
  animation: ttp-fade-in 0.3s ease-out;
}
.ttp-powerup-title {
  margin: 0;
  font-size: clamp(1.2rem, 4vw, 1.6rem);
  color: #fbbf24;
  font-weight: 800;
  text-shadow: 0 0 12px #f59e0b;
  animation: ttp-fever-pulse 0.6s ease-in-out infinite alternate;
}
.ttp-powerup-options {
  display: flex;
  gap: 12px;
}
.ttp-powerup-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 16px;
  border: 3px solid;
  background: rgba(255,255,255,0.1);
  cursor: pointer;
  transition: transform 0.15s, background 0.15s;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  min-width: 80px;
}
.ttp-powerup-btn:active { transform: scale(0.92); }
.ttp-powerup-btn.hint { border-color: #3b82f6; color: #60a5fa; }
.ttp-powerup-btn.time { border-color: #22c55e; color: #4ade80; }
.ttp-powerup-btn.double { border-color: #a855f7; color: #c084fc; }
.ttp-pw-icon { font-size: clamp(1.2rem, 4vw, 1.6rem); font-weight: 800; }
.ttp-pw-name { font-size: 0.45rem; font-weight: 700; }

@keyframes ttp-fever-pulse {
  from { opacity: 0.7; transform: scale(1); }
  to { opacity: 1; transform: scale(1.04); }
}
@keyframes ttp-outcome-pop {
  from { transform: translateX(-50%) scale(0.5); opacity: 0; }
  to { transform: translateX(-50%) scale(1); opacity: 1; }
}
@keyframes ttp-cell-bounce {
  0% { transform: scale(0.3); }
  60% { transform: scale(1.15); }
  100% { transform: scale(1); }
}
@keyframes ttp-win-cell-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.25); }
  100% { transform: scale(1); }
}
@keyframes ttp-win-flash {
  from { background: #5eead4; box-shadow: 0 0 8px #0d9488; }
  to { background: #99f6e4; box-shadow: 0 0 16px #14b8a6; }
}
@keyframes ttp-hint-pulse {
  from { border-color: #3b82f6; box-shadow: 0 0 4px rgba(59,130,246,0.3); }
  to { border-color: #60a5fa; box-shadow: 0 0 12px rgba(59,130,246,0.5); }
}
@keyframes ttp-special-glow {
  from { opacity: 0.6; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1.1); }
}
@keyframes ttp-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes blink { 50% { opacity: 0; } }
@keyframes pulse-glow {
  from { text-shadow: 0 0 4px currentColor; }
  to { text-shadow: 0 0 12px currentColor, 0 0 20px currentColor; }
}
`

export const ticTacProModule: MiniGameModule = {
  manifest: {
    id: 'tic-tac-pro',
    title: 'Tic Tac Pro',
    description: 'Tic-Tac-Toe vs AI! Win 30pts, Draw 10pts!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#0d9488',
  },
  Component: TicTacProGame,
}
