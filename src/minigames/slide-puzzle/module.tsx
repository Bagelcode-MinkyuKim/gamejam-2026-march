import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import slideSfxUrl from '../../../assets/sounds/slide-puzzle-slide.mp3'
import clearSfxUrl from '../../../assets/sounds/slide-puzzle-clear.mp3'
import comboSfxUrl from '../../../assets/sounds/slide-puzzle-combo.mp3'
import correctSfxUrl from '../../../assets/sounds/slide-puzzle-correct.mp3'
import warningSfxUrl from '../../../assets/sounds/slide-puzzle-warning.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const GRID_SIZE = 3
const TILE_COUNT = GRID_SIZE * GRID_SIZE
const EMPTY_VALUE = 0
const ROUND_DURATION_MS = 60000
const LOW_TIME_THRESHOLD_MS = 10000
const CLEAR_PULSE_DURATION_MS = 600
const TIME_BONUS_MAX_MS = 20000
const TIME_BONUS_POINTS = 500
const PUZZLE_CLEAR_BASE_POINTS = 1000
const PUZZLE_CLEAR_BONUS_PER_ROUND = 200
const MOVE_PENALTY_THRESHOLD = 40
const MOVE_BONUS_POINTS = 300
const TILE_TRANSITION_MS = 120
const COMBO_WINDOW_MS = 25000
const HINT_COOLDOWN_MS = 8000
const HINT_DURATION_MS = 2000

const TILE_COLORS = [
  '', // 0 = empty
  'linear-gradient(135deg, #3b82f6, #60a5fa)', // 1
  'linear-gradient(135deg, #10b981, #34d399)', // 2
  'linear-gradient(135deg, #f59e0b, #fbbf24)', // 3
  'linear-gradient(135deg, #ef4444, #f87171)', // 4
  'linear-gradient(135deg, #8b5cf6, #a78bfa)', // 5
  'linear-gradient(135deg, #ec4899, #f472b6)', // 6
  'linear-gradient(135deg, #06b6d4, #22d3ee)', // 7
  'linear-gradient(135deg, #f97316, #fb923c)', // 8
] as const

const TILE_BORDER_COLORS = [
  '', '#93c5fd', '#6ee7b7', '#fcd34d', '#fca5a5', '#c4b5fd', '#f9a8d4', '#67e8f9', '#fdba74',
] as const

type Board = number[]

function isSolvable(tiles: number[]): boolean {
  let inversions = 0
  for (let i = 0; i < tiles.length; i += 1) {
    if (tiles[i] === EMPTY_VALUE) continue
    for (let j = i + 1; j < tiles.length; j += 1) {
      if (tiles[j] === EMPTY_VALUE) continue
      if (tiles[i] > tiles[j]) inversions += 1
    }
  }
  return inversions % 2 === 0
}

function isSolved(board: Board): boolean {
  for (let i = 0; i < TILE_COUNT - 1; i += 1) {
    if (board[i] !== i + 1) return false
  }
  return board[TILE_COUNT - 1] === EMPTY_VALUE
}

function generateSolvableBoard(): Board {
  const tiles = Array.from({ length: TILE_COUNT - 1 }, (_, i) => i + 1)
  for (let i = tiles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = tiles[i]
    tiles[i] = tiles[j]
    tiles[j] = temp
  }
  tiles.push(EMPTY_VALUE)
  if (!isSolvable(tiles)) {
    if (tiles[0] !== EMPTY_VALUE && tiles[1] !== EMPTY_VALUE) {
      const temp = tiles[0]
      tiles[0] = tiles[1]
      tiles[1] = temp
    } else {
      const temp = tiles[TILE_COUNT - 3]
      tiles[TILE_COUNT - 3] = tiles[TILE_COUNT - 2]
      tiles[TILE_COUNT - 2] = temp
    }
  }
  if (isSolved(tiles)) return generateSolvableBoard()
  return tiles
}

function getEmptyIndex(board: Board): number {
  return board.indexOf(EMPTY_VALUE)
}

function getAdjacentIndices(index: number): number[] {
  const row = Math.floor(index / GRID_SIZE)
  const col = index % GRID_SIZE
  const adjacent: number[] = []
  if (row > 0) adjacent.push((row - 1) * GRID_SIZE + col)
  if (row < GRID_SIZE - 1) adjacent.push((row + 1) * GRID_SIZE + col)
  if (col > 0) adjacent.push(row * GRID_SIZE + (col - 1))
  if (col < GRID_SIZE - 1) adjacent.push(row * GRID_SIZE + (col + 1))
  return adjacent
}

function canMove(tileIndex: number, emptyIndex: number): boolean {
  return getAdjacentIndices(emptyIndex).includes(tileIndex)
}

function moveTile(board: Board, tileIndex: number): Board | null {
  const emptyIndex = getEmptyIndex(board)
  if (!canMove(tileIndex, emptyIndex)) return null
  const next = [...board]
  next[emptyIndex] = next[tileIndex]
  next[tileIndex] = EMPTY_VALUE
  return next
}

function findNextCorrectMove(board: Board): number | null {
  const emptyIdx = getEmptyIndex(board)
  const adjacents = getAdjacentIndices(emptyIdx)
  for (const adj of adjacents) {
    const testBoard = [...board]
    testBoard[emptyIdx] = testBoard[adj]
    testBoard[adj] = EMPTY_VALUE
    let correctCount = 0
    for (let i = 0; i < TILE_COUNT - 1; i++) {
      if (testBoard[i] === i + 1) correctCount++
    }
    let currentCorrect = 0
    for (let i = 0; i < TILE_COUNT - 1; i++) {
      if (board[i] === i + 1) currentCorrect++
    }
    if (correctCount > currentCorrect) return adj
  }
  return adjacents[Math.floor(Math.random() * adjacents.length)]
}

function SlidePuzzleGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [board, setBoard] = useState<Board>(() => generateSolvableBoard())
  const [score, setScore] = useState(0)
  const [moves, setMoves] = useState(0)
  const [puzzlesSolved, setPuzzlesSolved] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [isClearPulseActive, setClearPulseActive] = useState(false)
  const [slidingTileIndex, setSlidingTileIndex] = useState<number | null>(null)
  const [combo, setCombo] = useState(0)
  const [hintTile, setHintTile] = useState<number | null>(null)
  const [hintCooldownMs, setHintCooldownMs] = useState(0)
  const [lastCorrectTiles, setLastCorrectTiles] = useState<Set<number>>(new Set())
  const [showComboText, setShowComboText] = useState(false)
  const [warningPlayed, setWarningPlayed] = useState(false)

  const boardRef = useRef<Board>(board)
  const scoreRef = useRef(0)
  const movesRef = useRef(0)
  const puzzlesSolvedRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const puzzleStartMsRef = useRef(0)
  const totalMovesForPuzzleRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const clearPulseTimerRef = useRef<number | null>(null)
  const comboRef = useRef(0)
  const lastClearTimeRef = useRef(0)
  const hintCooldownRef = useRef(0)

  const slideAudioRef = useRef<HTMLAudioElement | null>(null)
  const clearAudioRef = useRef<HTMLAudioElement | null>(null)
  const comboAudioRef = useRef<HTMLAudioElement | null>(null)
  const correctAudioRef = useRef<HTMLAudioElement | null>(null)
  const warningAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

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

  const triggerClearPulse = useCallback(() => {
    setClearPulseActive(true)
    clearTimeoutSafe(clearPulseTimerRef)
    clearPulseTimerRef.current = window.setTimeout(() => {
      clearPulseTimerRef.current = null
      setClearPulseActive(false)
    }, CLEAR_PULSE_DURATION_MS)
  }, [])

  const startNewPuzzle = useCallback(() => {
    const newBoard = generateSolvableBoard()
    boardRef.current = newBoard
    setBoard(newBoard)
    setLastCorrectTiles(new Set())
    totalMovesForPuzzleRef.current = 0
    puzzleStartMsRef.current = window.performance.now()
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(clearPulseTimerRef)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio(gameOverAudioRef, 0.64, 0.95)
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  const handleHint = useCallback(() => {
    if (finishedRef.current) return
    if (hintCooldownRef.current > 0) return
    const hint = findNextCorrectMove(boardRef.current)
    if (hint !== null) {
      setHintTile(hint)
      setTimeout(() => setHintTile(null), HINT_DURATION_MS)
    }
    hintCooldownRef.current = HINT_COOLDOWN_MS
    setHintCooldownMs(HINT_COOLDOWN_MS)
  }, [])

  const handleTileClick = useCallback(
    (tileIndex: number) => {
      if (finishedRef.current) return
      if (boardRef.current[tileIndex] === EMPTY_VALUE) return

      const nextBoard = moveTile(boardRef.current, tileIndex)
      if (nextBoard === null) return

      setSlidingTileIndex(tileIndex)
      setTimeout(() => setSlidingTileIndex(null), TILE_TRANSITION_MS)

      boardRef.current = nextBoard
      setBoard(nextBoard)

      const nextMoves = movesRef.current + 1
      movesRef.current = nextMoves
      setMoves(nextMoves)
      totalMovesForPuzzleRef.current += 1

      setHintTile(null)

      // Check newly correct tiles
      const newCorrect = new Set<number>()
      for (let i = 0; i < TILE_COUNT - 1; i++) {
        if (nextBoard[i] === i + 1) newCorrect.add(i)
      }
      const prevCorrect = lastCorrectTiles
      for (const idx of newCorrect) {
        if (!prevCorrect.has(idx)) {
          playAudio(correctAudioRef, 0.3, 1 + idx * 0.05)
        }
      }
      setLastCorrectTiles(newCorrect)

      playAudio(slideAudioRef, 0.4, 1 + Math.random() * 0.1)

      if (isSolved(nextBoard)) {
        const now = window.performance.now()
        const solveDurationMs = now - puzzleStartMsRef.current

        const nextPuzzlesSolved = puzzlesSolvedRef.current + 1
        puzzlesSolvedRef.current = nextPuzzlesSolved
        setPuzzlesSolved(nextPuzzlesSolved)

        // Combo check
        const timeSinceLastClear = now - lastClearTimeRef.current
        let nextCombo = comboRef.current
        if (lastClearTimeRef.current > 0 && timeSinceLastClear < COMBO_WINDOW_MS) {
          nextCombo += 1
        } else {
          nextCombo = 1
        }
        comboRef.current = nextCombo
        lastClearTimeRef.current = now
        setCombo(nextCombo)

        const comboMultiplier = 1 + (nextCombo - 1) * 0.25
        let points = PUZZLE_CLEAR_BASE_POINTS + (nextPuzzlesSolved - 1) * PUZZLE_CLEAR_BONUS_PER_ROUND

        const timeRatio = Math.max(0, 1 - solveDurationMs / TIME_BONUS_MAX_MS)
        points += Math.round(timeRatio * TIME_BONUS_POINTS)

        const movesForPuzzle = totalMovesForPuzzleRef.current
        if (movesForPuzzle <= MOVE_PENALTY_THRESHOLD) {
          const moveEfficiency = 1 - movesForPuzzle / MOVE_PENALTY_THRESHOLD
          points += Math.round(moveEfficiency * MOVE_BONUS_POINTS)
        }

        points = Math.round(points * comboMultiplier)

        const nextScore = scoreRef.current + points
        scoreRef.current = nextScore
        setScore(nextScore)

        triggerClearPulse()
        playAudio(clearAudioRef, 0.6, 1.0 + nextPuzzlesSolved * 0.02)

        if (nextCombo >= 2) {
          playAudio(comboAudioRef, 0.5, 0.9 + nextCombo * 0.1)
          setShowComboText(true)
          setTimeout(() => setShowComboText(false), 1200)
        }

        effects.comboHitBurst(150, 200, nextPuzzlesSolved * 4 + nextCombo * 2, points, ['🧩', '✨', '🌟', '⭐'])
        effects.showScorePopup(points, 150, 170)
        effects.triggerFlash(nextCombo >= 3 ? '#fbbf24' : '#3b82f6', 200)
        effects.triggerShake(nextCombo >= 2 ? 6 : 3)

        setTimeout(() => {
          if (!finishedRef.current) startNewPuzzle()
        }, CLEAR_PULSE_DURATION_MS)
      }
    },
    [playAudio, startNewPuzzle, triggerClearPulse, lastCorrectTiles],
  )

  const handleExit = useCallback(() => { onExit() }, [onExit])

  useEffect(() => {
    const audios = [
      { ref: slideAudioRef, src: slideSfxUrl },
      { ref: clearAudioRef, src: clearSfxUrl },
      { ref: comboAudioRef, src: comboSfxUrl },
      { ref: correctAudioRef, src: correctSfxUrl },
      { ref: warningAudioRef, src: warningSfxUrl },
      { ref: gameOverAudioRef, src: gameOverHitSfx },
    ]
    for (const { ref, src } of audios) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      ref.current = audio
    }
    puzzleStartMsRef.current = window.performance.now()
    return () => {
      clearTimeoutSafe(clearPulseTimerRef)
      for (const { ref } of audios) ref.current = null
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); handleExit() }
      if (event.code === 'KeyH') { event.preventDefault(); handleHint() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, handleHint])

  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Hint cooldown
      if (hintCooldownRef.current > 0) {
        hintCooldownRef.current = Math.max(0, hintCooldownRef.current - deltaMs)
        setHintCooldownMs(hintCooldownRef.current)
      }

      // Warning sound
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > 0 && !warningPlayed) {
        playAudio(warningAudioRef, 0.4, 1.0)
        setWarningPlayed(true)
      }

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
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
  }, [finishGame, warningPlayed])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const correctCount = useMemo(() => {
    let c = 0
    for (let i = 0; i < TILE_COUNT - 1; i++) { if (board[i] === i + 1) c++ }
    return c
  }, [board])
  const progressPct = Math.round((correctCount / (TILE_COUNT - 1)) * 100)
  const hintReady = hintCooldownMs <= 0

  return (
    <section className="mini-game-panel sp-panel" aria-label="slide-puzzle-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      {/* Top bar: Score + Time */}
      <div className="sp-top-bar">
        <div className="sp-score-block">
          <p className="sp-score">{score.toLocaleString()}</p>
          <p className="sp-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="sp-time-block">
          <p className={`sp-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      {/* Combo + Stats */}
      <div className="sp-stats-row">
        <span className="sp-stat">Moves <strong>{moves}</strong></span>
        <span className="sp-stat">Clear <strong>{puzzlesSolved}</strong></span>
        {combo >= 2 && (
          <span className={`sp-combo-badge ${showComboText ? 'pop' : ''}`}>
            x{combo} COMBO
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="sp-progress-wrap">
        <div className="sp-progress-bar" style={{ width: `${progressPct}%` }} />
        <span className="sp-progress-label">{correctCount}/{TILE_COUNT - 1}</span>
      </div>

      {/* Board */}
      <div className={`sp-board ${isClearPulseActive ? 'clear-pulse' : ''}`}>
        {board.map((value, index) => {
          if (value === EMPTY_VALUE) {
            return (
              <div
                className="sp-cell empty"
                key="empty"
                style={{
                  gridRow: Math.floor(index / GRID_SIZE) + 1,
                  gridColumn: (index % GRID_SIZE) + 1,
                }}
              />
            )
          }

          const isSliding = slidingTileIndex === index
          const isCorrectPosition = value === index + 1
          const isBoardSolved = isClearPulseActive
          const isHinted = hintTile === index

          return (
            <button
              className={`sp-cell tile ${isSliding ? 'sliding' : ''} ${isCorrectPosition ? 'correct' : ''} ${isBoardSolved ? 'solved-pulse' : ''} ${isHinted ? 'hinted' : ''}`}
              key={`tile-${value}`}
              type="button"
              onClick={() => handleTileClick(index)}
              style={{
                gridRow: Math.floor(index / GRID_SIZE) + 1,
                gridColumn: (index % GRID_SIZE) + 1,
                background: TILE_COLORS[value],
                borderColor: TILE_BORDER_COLORS[value],
                transition: `all ${TILE_TRANSITION_MS}ms ease-out`,
              }}
            >
              {value}
            </button>
          )
        })}
      </div>

      {/* Hint button */}
      <button
        className={`sp-hint-btn ${hintReady ? '' : 'cooldown'}`}
        type="button"
        onClick={handleHint}
        disabled={!hintReady}
      >
        {hintReady ? 'HINT (H)' : `${(hintCooldownMs / 1000).toFixed(0)}s`}
      </button>

      <style>{GAME_EFFECTS_CSS}
      {`
        .sp-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 10px 10px 8px;
          width: 100%;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          position: relative;
          background: linear-gradient(180deg, #f5f4ef 0%, #ede9df 50%, #e8e5dc 100%);
          gap: 6px;
          box-sizing: border-box;
        }

        .sp-top-bar {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          width: 100%;
          padding: 0 2px;
          flex-shrink: 0;
        }

        .sp-score-block { display: flex; flex-direction: column; gap: 2px; }
        .sp-score {
          font-size: clamp(28px, 7vw, 36px);
          font-weight: 900;
          color: #1e40af;
          margin: 0;
          line-height: 1;
          text-shadow: 0 2px 4px rgba(30,64,175,0.2);
        }
        .sp-best {
          font-size: 11px;
          font-weight: 600;
          color: #94a3b8;
          margin: 0;
        }

        .sp-time-block { text-align: right; }
        .sp-time {
          font-size: clamp(20px, 5vw, 28px);
          font-weight: 800;
          color: #475569;
          margin: 0;
          transition: color 0.2s;
        }
        .sp-time.low-time {
          color: #ef4444;
          animation: sp-pulse 0.5s ease-in-out infinite alternate;
        }
        @keyframes sp-pulse { from { opacity: 1; transform: scale(1); } to { opacity: 0.6; transform: scale(1.05); } }

        .sp-stats-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          width: 100%;
          flex-shrink: 0;
        }
        .sp-stat {
          font-size: 13px;
          font-weight: 600;
          color: #64748b;
        }
        .sp-stat strong { color: #1e40af; font-size: 15px; }

        .sp-combo-badge {
          font-size: 14px;
          font-weight: 900;
          color: #d97706;
          background: linear-gradient(135deg, #fef3c7, #fde68a);
          padding: 2px 10px;
          border-radius: 12px;
          border: 2px solid #f59e0b;
          animation: sp-combo-idle 1s ease-in-out infinite alternate;
        }
        .sp-combo-badge.pop {
          animation: sp-combo-pop 0.5s ease-out;
        }
        @keyframes sp-combo-idle { from { transform: scale(1); } to { transform: scale(1.05); } }
        @keyframes sp-combo-pop {
          0% { transform: scale(0.5); opacity: 0; }
          50% { transform: scale(1.3); }
          100% { transform: scale(1); opacity: 1; }
        }

        .sp-progress-wrap {
          width: 100%;
          height: 14px;
          background: #d1d5db;
          border-radius: 7px;
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }
        .sp-progress-bar {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #10b981);
          border-radius: 7px;
          transition: width 0.3s ease-out;
        }
        .sp-progress-label {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 10px;
          font-weight: 700;
          color: #1e293b;
        }

        .sp-board {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          grid-template-rows: repeat(${GRID_SIZE}, 1fr);
          gap: 5px;
          width: 100%;
          flex: 1;
          min-height: 0;
          max-width: 100%;
          aspect-ratio: 1;
          background: #1e293b;
          border-radius: 16px;
          padding: 8px;
          border: 3px solid #334155;
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.15);
        }

        .sp-board.clear-pulse {
          animation: sp-clear 0.6s ease-out;
        }
        @keyframes sp-clear {
          0% { box-shadow: inset 0 2px 8px rgba(0,0,0,0.3), 0 0 0 rgba(59,130,246,0); }
          50% { box-shadow: inset 0 2px 8px rgba(0,0,0,0.3), 0 0 40px rgba(59,130,246,0.5); transform: scale(1.02); }
          100% { box-shadow: inset 0 2px 8px rgba(0,0,0,0.3), 0 0 0 rgba(59,130,246,0); transform: scale(1); }
        }

        .sp-cell {
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .sp-cell.empty {
          background: rgba(255,255,255,0.05);
          border: 2px dashed rgba(255,255,255,0.1);
        }

        .sp-cell.tile {
          border: 3px solid #93c5fd;
          color: #fff;
          font-size: clamp(28px, 8vw, 44px);
          font-weight: 900;
          cursor: pointer;
          font-family: inherit;
          padding: 0;
          box-shadow: 0 3px 6px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3);
          text-shadow: 0 2px 4px rgba(0,0,0,0.3);
        }

        .sp-cell.tile:active {
          transform: scale(0.93);
          box-shadow: 0 1px 2px rgba(0,0,0,0.3);
        }

        .sp-cell.tile.correct {
          box-shadow: 0 3px 6px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.3), 0 0 12px rgba(16,185,129,0.4);
        }

        .sp-cell.tile.sliding {
          transition: all ${TILE_TRANSITION_MS}ms ease-out;
        }

        .sp-cell.tile.solved-pulse {
          animation: sp-tile-glow 0.6s ease-out;
        }
        @keyframes sp-tile-glow {
          0% { box-shadow: 0 3px 6px rgba(0,0,0,0.3); }
          50% { box-shadow: 0 0 20px rgba(59,130,246,0.7), 0 0 40px rgba(59,130,246,0.3); }
          100% { box-shadow: 0 3px 6px rgba(0,0,0,0.3); }
        }

        .sp-cell.tile.hinted {
          animation: sp-hint-glow 0.6s ease-in-out infinite alternate;
        }
        @keyframes sp-hint-glow {
          from { box-shadow: 0 0 8px rgba(251,191,36,0.4), 0 3px 6px rgba(0,0,0,0.3); }
          to { box-shadow: 0 0 20px rgba(251,191,36,0.8), 0 0 30px rgba(251,191,36,0.3), 0 3px 6px rgba(0,0,0,0.3); }
        }

        .sp-hint-btn {
          flex-shrink: 0;
          width: 100%;
          padding: 10px 0;
          font-size: clamp(14px, 4vw, 18px);
          font-weight: 800;
          font-family: inherit;
          background: linear-gradient(135deg, #fbbf24, #f59e0b);
          color: #78350f;
          border: 2px solid #d97706;
          border-radius: 12px;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.15);
          transition: all 0.2s;
        }
        .sp-hint-btn:active { transform: scale(0.96); }
        .sp-hint-btn.cooldown {
          background: #d1d5db;
          color: #9ca3af;
          border-color: #9ca3af;
          cursor: not-allowed;
        }
      `}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
    </section>
  )
}

export const slidePuzzleModule: MiniGameModule = {
  manifest: {
    id: 'slide-puzzle',
    title: 'Slide Puzzle',
    description: 'Slide tiles to sort numbers! Faster = higher score!',
    unlockCost: 60,
    baseReward: 20,
    scoreRewardMultiplier: 1.3,
    accentColor: '#0ea5e9',
  },
  Component: SlidePuzzleGame,
}
