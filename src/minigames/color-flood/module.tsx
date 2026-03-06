import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import floodFillSfx from '../../../assets/sounds/color-flood-fill.mp3'
import comboSfx from '../../../assets/sounds/color-flood-combo.mp3'
import boardClearSfx from '../../../assets/sounds/color-flood-clear.mp3'
import warningSfx from '../../../assets/sounds/color-flood-warning.mp3'
import megaFloodSfx from '../../../assets/sounds/color-flood-mega.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const BOARD_SIZE = 8
const COLOR_COUNT = 6
const MAX_MOVES = 25
const TIME_LIMIT_MS = 60000
const BONUS_PER_REMAINING_MOVE = 10
const CELL_TRANSITION_MS = 280
const BOARD_CLEAR_BONUS = 100

const BOARD_COLORS = [
  '#ef4444',
  '#3b82f6',
  '#22c55e',
  '#eab308',
  '#8b5cf6',
  '#f97316',
] as const

const COLOR_LABELS = [
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Purple',
  'Orange',
] as const

type CellColor = number

function createRandomBoard(): CellColor[][] {
  const board: CellColor[][] = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const rowCells: CellColor[] = []
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      rowCells.push(Math.floor(Math.random() * COLOR_COUNT))
    }
    board.push(rowCells)
  }
  return board
}

function cloneBoard(board: CellColor[][]): CellColor[][] {
  return board.map((row) => [...row])
}

function getFloodRegion(board: CellColor[][]): boolean[][] {
  const visited: boolean[][] = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    visited.push(new Array<boolean>(BOARD_SIZE).fill(false))
  }

  const targetColor = board[0][0]
  const queue: [number, number][] = [[0, 0]]
  visited[0][0] = true

  const directions: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]

  while (queue.length > 0) {
    const [currentRow, currentCol] = queue.shift()!
    for (const [deltaRow, deltaCol] of directions) {
      const nextRow = currentRow + deltaRow
      const nextCol = currentCol + deltaCol
      if (
        nextRow >= 0 &&
        nextRow < BOARD_SIZE &&
        nextCol >= 0 &&
        nextCol < BOARD_SIZE &&
        !visited[nextRow][nextCol] &&
        board[nextRow][nextCol] === targetColor
      ) {
        visited[nextRow][nextCol] = true
        queue.push([nextRow, nextCol])
      }
    }
  }

  return visited
}

function applyFloodFill(board: CellColor[][], newColor: CellColor): CellColor[][] {
  const currentColor = board[0][0]
  if (currentColor === newColor) {
    return board
  }

  const nextBoard = cloneBoard(board)
  const region = getFloodRegion(board)

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (region[row][col]) {
        nextBoard[row][col] = newColor
      }
    }
  }

  return nextBoard
}

function isBoardSolved(board: CellColor[][]): boolean {
  const targetColor = board[0][0]
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] !== targetColor) {
        return false
      }
    }
  }
  return true
}

function countFloodedCells(board: CellColor[][]): number {
  const region = getFloodRegion(board)
  let count = 0
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (region[row][col]) {
        count += 1
      }
    }
  }
  return count
}

function ColorFloodGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [board, setBoard] = useState<CellColor[][]>(() => createRandomBoard())
  const [movesRemaining, setMovesRemaining] = useState(MAX_MOVES)
  const [score, setScore] = useState(0)
  const [boardsCleared, setBoardsCleared] = useState(0)
  const [remainingMs, setRemainingMs] = useState(TIME_LIMIT_MS)
  const [combo, setCombo] = useState(0)
  const [showComboText, setShowComboText] = useState(false)
  const [changedCells, setChangedCells] = useState<boolean[][]>(() => {
    const empty: boolean[][] = []
    for (let row = 0; row < BOARD_SIZE; row += 1) {
      empty.push(new Array<boolean>(BOARD_SIZE).fill(false))
    }
    return empty
  })
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [waveRipple, setWaveRipple] = useState(false)
  const [warningPlayed, setWarningPlayed] = useState(false)

  const boardRef = useRef<CellColor[][]>(board)
  const movesRemainingRef = useRef(MAX_MOVES)
  const scoreRef = useRef(0)
  const boardsClearedRef = useRef(0)
  const remainingMsRef = useRef(TIME_LIMIT_MS)
  const comboRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const transitionTimerRef = useRef<number | null>(null)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)
  const floodFillAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const boardClearAudioRef = useRef<HTMLAudioElement | null>(null)
  const warningAudioRef = useRef<HTMLAudioElement | null>(null)
  const megaFloodAudioRef = useRef<HTMLAudioElement | null>(null)

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) {
        return
      }
      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current)
      transitionTimerRef.current = null
    }
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }
    finishedRef.current = true
    clearTransitionTimer()

    const elapsedMs = Math.max(16.66, TIME_LIMIT_MS - remainingMsRef.current)
    playAudio(gameOverAudioRef, 0.6, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(elapsedMs),
    })
  }, [clearTransitionTimer, onFinish, playAudio])

  const startNewBoard = useCallback(() => {
    const nextBoard = createRandomBoard()
    boardRef.current = nextBoard
    setBoard(nextBoard)
    movesRemainingRef.current = MAX_MOVES
    setMovesRemaining(MAX_MOVES)
  }, [])

  const handleColorSelect = useCallback(
    (colorIndex: CellColor) => {
      if (finishedRef.current || isTransitioning) {
        return
      }

      const currentBoard = boardRef.current
      const currentTopLeftColor = currentBoard[0][0]

      if (colorIndex === currentTopLeftColor) {
        return
      }

      if (movesRemainingRef.current <= 0) {
        return
      }

      const prevFloodCount = countFloodedCells(currentBoard)
      const nextBoard = applyFloodFill(currentBoard, colorIndex)
      boardRef.current = nextBoard

      const nextMovesRemaining = movesRemainingRef.current - 1
      movesRemainingRef.current = nextMovesRemaining
      setMovesRemaining(nextMovesRemaining)

      const changed: boolean[][] = []
      for (let row = 0; row < BOARD_SIZE; row += 1) {
        const rowChanged: boolean[] = []
        for (let col = 0; col < BOARD_SIZE; col += 1) {
          rowChanged.push(currentBoard[row][col] !== nextBoard[row][col])
        }
        changed.push(rowChanged)
      }
      setChangedCells(changed)
      setIsTransitioning(true)
      setBoard(nextBoard)

      const floodedCount = countFloodedCells(nextBoard)
      const floodedRatio = floodedCount / (BOARD_SIZE * BOARD_SIZE)
      const cellsGained = floodedCount - prevFloodCount
      const gainRatio = cellsGained / (BOARD_SIZE * BOARD_SIZE)
      // Combo system: big floods (>15% gain) increase combo
      let nextCombo = comboRef.current
      if (gainRatio >= 0.15) {
        nextCombo = Math.min(nextCombo + 1, 10)
        comboRef.current = nextCombo
        setCombo(nextCombo)
        setShowComboText(true)
        setTimeout(() => setShowComboText(false), 800)
      } else {
        nextCombo = Math.max(0, nextCombo - 1)
        comboRef.current = nextCombo
        setCombo(nextCombo)
      }

      // Combo score bonus
      const comboMultiplier = 1 + nextCombo * 0.2
      const basePoints = Math.floor(cellsGained * 2 * comboMultiplier)

      if (basePoints > 0) {
        const nextScore = scoreRef.current + basePoints
        scoreRef.current = nextScore
        setScore(nextScore)
        effects.showScorePopup(basePoints, 200, 300)
      }

      // Sound & effects based on flood magnitude
      if (floodedRatio > 0.8) {
        // Mega flood
        playAudio(megaFloodAudioRef, 0.6, 1)
        effects.triggerFlash('rgba(20,184,166,0.35)')
        effects.triggerShake(8, 300)
        effects.spawnParticles(8, 200, 250)
        setWaveRipple(true)
        setTimeout(() => setWaveRipple(false), 500)
      } else if (floodedRatio > 0.5) {
        playAudio(tapHitStrongAudioRef, 0.5, 0.95 + floodedRatio * 0.2)
        effects.triggerFlash('rgba(34,197,94,0.2)')
        effects.spawnParticles(5, 200, 250)
      } else if (gainRatio >= 0.15) {
        playAudio(comboAudioRef, 0.45, 1 + nextCombo * 0.05)
        effects.spawnParticles(3, 200, 250)
      } else {
        playAudio(floodFillAudioRef, 0.4, 1 + floodedRatio * 0.3)
        effects.spawnParticles(2, 200, 250)
      }

      clearTransitionTimer()
      transitionTimerRef.current = window.setTimeout(() => {
        transitionTimerRef.current = null
        setIsTransitioning(false)
        const emptyChanged: boolean[][] = []
        for (let r = 0; r < BOARD_SIZE; r += 1) {
          emptyChanged.push(new Array<boolean>(BOARD_SIZE).fill(false))
        }
        setChangedCells(emptyChanged)
      }, CELL_TRANSITION_MS)

      if (isBoardSolved(nextBoard)) {
        const moveBonus = nextMovesRemaining * BONUS_PER_REMAINING_MOVE
        const clearScore = BOARD_CLEAR_BONUS + moveBonus
        const totalClearScore = scoreRef.current + clearScore
        scoreRef.current = totalClearScore
        setScore(totalClearScore)

        const nextBoardsCleared = boardsClearedRef.current + 1
        boardsClearedRef.current = nextBoardsCleared
        setBoardsCleared(nextBoardsCleared)

        playAudio(boardClearAudioRef, 0.65, 1 + nextBoardsCleared * 0.05)
        effects.comboHitBurst(200, 200, nextBoardsCleared * 3 + 5, clearScore, ['🎉', '🌟', '✨', '🎊'])
        effects.showScorePopup(clearScore, 200, 180)
        effects.triggerShake(10, 400)
        effects.triggerFlash('rgba(234,179,8,0.3)')

        window.setTimeout(() => {
          if (!finishedRef.current) {
            startNewBoard()
            comboRef.current = 0
            setCombo(0)
          }
        }, CELL_TRANSITION_MS + 200)
        return
      }

      if (nextMovesRemaining <= 0) {
        const floodedScore = Math.floor(floodedCount * 1.5)
        const nextScore = scoreRef.current + floodedScore
        scoreRef.current = nextScore
        setScore(nextScore)

        window.setTimeout(() => {
          if (!finishedRef.current) {
            startNewBoard()
            comboRef.current = 0
            setCombo(0)
          }
        }, CELL_TRANSITION_MS + 200)
      }
    },
    [clearTransitionTimer, effects, isTransitioning, playAudio, startNewBoard],
  )

  const handleExit = useCallback(() => {
    playAudio(tapHitAudioRef, 0.4, 1)
    onExit()
  }, [onExit, playAudio])

  useEffect(() => {
    const audios = [
      { ref: tapHitAudioRef, src: tapHitSfx },
      { ref: tapHitStrongAudioRef, src: tapHitStrongSfx },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
      { ref: floodFillAudioRef, src: floodFillSfx },
      { ref: comboAudioRef, src: comboSfx },
      { ref: boardClearAudioRef, src: boardClearSfx },
      { ref: warningAudioRef, src: warningSfx },
      { ref: megaFloodAudioRef, src: megaFloodSfx },
    ]

    const audioElements: HTMLAudioElement[] = []
    for (const { ref, src } of audios) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
      audioElements.push(audio)
    }

    return () => {
      for (const audio of audioElements) {
        audio.pause()
        audio.currentTime = 0
      }
      for (const { ref } of audios) {
        ref.current = null
      }
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
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit])

  // Warning sound at 10s
  useEffect(() => {
    if (remainingMs <= 10000 && !warningPlayed && !finishedRef.current) {
      setWarningPlayed(true)
      playAudio(warningAudioRef, 0.5, 1)
    }
  }, [remainingMs, warningPlayed, playAudio])

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

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      effects.updateParticles()

      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)

    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      lastFrameAtRef.current = null
      effects.cleanup()
    }
  }, [finishGame])

  useEffect(() => {
    return () => {
      clearTransitionTimer()
    }
  }, [clearTransitionTimer])

  const floodedCount = useMemo(() => countFloodedCells(board), [board])
  const totalCells = BOARD_SIZE * BOARD_SIZE
  const floodedPercent = Math.round((floodedCount / totalCells) * 100)
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const currentTopLeftColor = board[0][0]
  const isLowTime = remainingMs <= 10000
  const timerProgress = remainingMs / TIME_LIMIT_MS

  return (
    <section className="mini-game-panel color-flood-panel" aria-label="color-flood-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      {/* Top: Score & Timer */}
      <div className="cf-top-bar">
        <div className="cf-score-block">
          <p className="cf-score">{score.toLocaleString()}</p>
          <p className="cf-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="cf-timer-block">
          <p className={`cf-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
          <div className="cf-timer-bar">
            <div className="cf-timer-fill" style={{ width: `${timerProgress * 100}%`, backgroundColor: isLowTime ? '#ef4444' : '#14b8a6' }} />
          </div>
        </div>
      </div>

      {/* Combo indicator */}
      {combo > 0 && (
        <div className={`cf-combo ${showComboText ? 'cf-combo-pop' : ''}`}>
          COMBO x{combo}
        </div>
      )}

      {/* Meta info row */}
      <div className="cf-meta-row">
        <div className="cf-meta-item">
          <span className="cf-meta-label">MOVES</span>
          <span className="cf-meta-value">{movesRemaining}</span>
        </div>
        <div className="cf-meta-item">
          <span className="cf-meta-label">CLEAR</span>
          <span className="cf-meta-value">{boardsCleared}</span>
        </div>
        <div className="cf-meta-item">
          <span className="cf-meta-label">FILL</span>
          <span className="cf-meta-value">{floodedPercent}%</span>
        </div>
      </div>

      {/* Fill progress bar */}
      <div className="cf-fill-bar-container">
        <div className="cf-fill-bar" style={{ width: `${floodedPercent}%` }} />
      </div>

      {/* Board - takes remaining space */}
      <div className={`cf-board ${waveRipple ? 'cf-wave' : ''}`} role="grid" aria-label="color-flood-board">
        {board.map((row, rowIndex) => (
          <div className="cf-row" key={`row-${rowIndex}`} role="row">
            {row.map((cellColor, colIndex) => {
              const isChanged = changedCells[rowIndex]?.[colIndex] ?? false
              return (
                <div
                  className={`cf-cell ${isChanged ? 'changed' : ''}`}
                  key={`cell-${rowIndex}-${colIndex}`}
                  role="gridcell"
                  style={{
                    backgroundColor: BOARD_COLORS[cellColor],
                    transition: isChanged
                      ? `background-color ${CELL_TRANSITION_MS}ms ease-out`
                      : 'none',
                  }}
                  aria-label={`${COLOR_LABELS[cellColor]} cell at row ${rowIndex + 1} column ${colIndex + 1}`}
                />
              )
            })}
          </div>
        ))}
      </div>

      {/* Color buttons - large at bottom */}
      <div className="cf-color-buttons" role="group" aria-label="color selection">
        {BOARD_COLORS.map((hex, colorIndex) => {
          const isCurrentColor = colorIndex === currentTopLeftColor
          return (
            <button
              className={`cf-color-btn ${isCurrentColor ? 'active' : ''}`}
              key={`color-btn-${colorIndex}`}
              type="button"
              disabled={isCurrentColor || movesRemaining <= 0}
              onClick={() => handleColorSelect(colorIndex)}
              style={{ backgroundColor: hex }}
              aria-label={`Select ${COLOR_LABELS[colorIndex]}`}
            >
              {isCurrentColor ? '\u25CF' : ''}
            </button>
          )
        })}
      </div>

      <style>{GAME_EFFECTS_CSS}
      {`
        .color-flood-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: space-between;
          padding: 12px 12px 16px;
          width: 100%;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          position: relative;
          gap: 0;
          background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 50%, #e8e5dc 100%);
        }

        /* ── Top Bar ── */
        .cf-top-bar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          width: 100%;
          padding: 0 2px;
          flex-shrink: 0;
        }

        .cf-score-block {
          display: flex;
          flex-direction: column;
          gap: 0;
        }

        .cf-score {
          font-size: clamp(38px, 10vw, 52px);
          font-weight: 900;
          color: #0d9488;
          margin: 0;
          line-height: 1;
          text-shadow: 0 2px 8px rgba(13,148,136,0.25);
        }

        .cf-best {
          font-size: clamp(13px, 3.5vw, 16px);
          font-weight: 700;
          color: #9ca3af;
          margin: 0;
        }

        .cf-timer-block {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }

        .cf-time {
          font-size: clamp(30px, 7.5vw, 42px);
          font-weight: 800;
          color: #374151;
          margin: 0;
          line-height: 1;
          transition: color 0.2s;
        }

        .cf-time.low-time {
          color: #ef4444;
          animation: cf-pulse 0.4s ease-in-out infinite alternate;
          text-shadow: 0 0 12px rgba(239,68,68,0.5);
        }

        @keyframes cf-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.08); }
        }

        .cf-timer-bar {
          width: clamp(90px, 28vw, 140px);
          height: 8px;
          background: #d1d5db;
          border-radius: 4px;
          overflow: hidden;
        }

        .cf-timer-fill {
          height: 100%;
          border-radius: 4px;
          transition: width 0.3s linear, background-color 0.3s;
        }

        /* ── Combo ── */
        .cf-combo {
          font-size: clamp(22px, 6vw, 32px);
          font-weight: 900;
          color: #d97706;
          text-shadow: 0 2px 8px rgba(217,119,6,0.35);
          margin: 4px 0;
          flex-shrink: 0;
          transition: transform 0.2s;
        }

        .cf-combo-pop {
          animation: cf-combo-burst 0.5s ease-out;
        }

        @keyframes cf-combo-burst {
          0% { transform: scale(0.5); opacity: 0; }
          40% { transform: scale(1.4); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }

        /* ── Meta Row ── */
        .cf-meta-row {
          display: flex;
          justify-content: center;
          gap: clamp(20px, 7vw, 36px);
          width: 100%;
          padding: 6px 0 4px;
          flex-shrink: 0;
        }

        .cf-meta-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }

        .cf-meta-label {
          font-size: clamp(11px, 3vw, 14px);
          font-weight: 800;
          color: #9ca3af;
          letter-spacing: 0.08em;
        }

        .cf-meta-value {
          font-size: clamp(26px, 7vw, 36px);
          font-weight: 900;
          color: #0d9488;
          line-height: 1;
        }

        /* ── Fill Progress Bar ── */
        .cf-fill-bar-container {
          width: 100%;
          height: 10px;
          background: #d1d5db;
          border-radius: 5px;
          overflow: hidden;
          margin: 4px 0 8px;
          flex-shrink: 0;
          border: 1px solid #c4c8ce;
        }

        .cf-fill-bar {
          height: 100%;
          background: linear-gradient(90deg, #14b8a6, #06b6d4);
          border-radius: 5px;
          transition: width 0.3s ease-out;
          box-shadow: 0 0 6px rgba(20,184,166,0.3);
        }

        /* ── Board (square) ── */
        .cf-board {
          width: 100%;
          aspect-ratio: 1;
          max-height: calc(100% - 260px);
          display: flex;
          flex-direction: column;
          gap: 3px;
          background: #e2e0d8;
          border-radius: 12px;
          overflow: hidden;
          border: 3px solid #c4c0b6;
          padding: 3px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.1);
        }

        .cf-board.cf-wave {
          animation: cf-wave-ripple 0.5s ease-out;
        }

        @keyframes cf-wave-ripple {
          0% { box-shadow: 0 0 0 0 rgba(20,184,166,0.4), 0 4px 16px rgba(0,0,0,0.1); }
          100% { box-shadow: 0 0 0 16px rgba(20,184,166,0), 0 4px 16px rgba(0,0,0,0.1); }
        }

        .cf-row {
          display: flex;
          flex: 1;
          gap: 3px;
        }

        .cf-cell {
          flex: 1;
          border-radius: 4px;
          box-shadow: inset 0 -2px 4px rgba(0,0,0,0.15), inset 0 2px 3px rgba(255,255,255,0.25);
        }

        .cf-cell.changed {
          animation: cf-cell-pop 0.3s ease-out;
        }

        @keyframes cf-cell-pop {
          0% { transform: scale(0.65); opacity: 0.5; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }

        /* ── Color Buttons ── */
        .cf-color-buttons {
          display: flex;
          gap: clamp(10px, 3vw, 16px);
          justify-content: center;
          padding: 12px 0 6px;
          flex-shrink: 0;
          width: 100%;
        }

        .cf-color-btn {
          width: clamp(52px, 14vw, 64px);
          height: clamp(52px, 14vw, 64px);
          border-radius: 50%;
          border: 4px solid rgba(255, 255, 255, 0.5);
          cursor: pointer;
          transition: transform 0.12s, border-color 0.12s, box-shadow 0.12s;
          font-size: clamp(18px, 5vw, 24px);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: inherit;
          padding: 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15), inset 0 2px 4px rgba(255,255,255,0.3);
        }

        .cf-color-btn:hover:not(:disabled) {
          transform: scale(1.15);
          border-color: rgba(255, 255, 255, 0.8);
        }

        .cf-color-btn:active:not(:disabled) {
          transform: scale(0.88);
        }

        .cf-color-btn:disabled {
          cursor: default;
          opacity: 0.35;
        }

        .cf-color-btn.active {
          border-color: #fff;
          box-shadow: 0 0 20px rgba(255, 255, 255, 0.5), 0 4px 12px rgba(0,0,0,0.15);
          opacity: 1;
          transform: scale(1.18);
        }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const colorFloodModule: MiniGameModule = {
  manifest: {
    id: 'color-flood',
    title: 'Color Flood',
    description: 'Pick colors to fill the board! Fewer moves = higher score!',
    unlockCost: 55,
    baseReward: 18,
    scoreRewardMultiplier: 1.25,
    accentColor: '#14b8a6',
  },
  Component: ColorFloodGame,
}
