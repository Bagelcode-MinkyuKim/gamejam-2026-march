import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const GRID_SIZE = 5
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const BASE_TREASURE_COUNT = 3
const BASE_BOMB_COUNT = 2
const BASE_TREASURE_SCORE = 30
const BOMB_PENALTY = 15
const LOW_TIME_THRESHOLD_MS = 5000
const DIG_FEEDBACK_DURATION_MS = 300

// --- Gimmick constants ---
const GOLDEN_TREASURE_CHANCE = 0.15
const GOLDEN_TREASURE_SCORE = 100
const COMBO_DIG_WINDOW_MS = 2000
const COMBO_DIG_MULTIPLIER = 0.5
const DEPTH_BONUS_PER_LEVEL = 10
const TIME_BONUS_PER_CLEAR_MS = 3000
const FEVER_THRESHOLD = 3
const FEVER_DURATION_MS = 4000
const FEVER_MULTIPLIER = 2

type CellContent = 'empty' | 'treasure' | 'bomb' | 'golden'
type CellState = 'hidden' | 'revealed'

interface Cell {
  content: CellContent
  state: CellState
  adjacentTreasures: number
}

function createBoard(depth: number): Cell[] {
  const treasureCount = BASE_TREASURE_COUNT + Math.floor(depth / 3)
  const bombCount = BASE_BOMB_COUNT + Math.floor(depth / 4)
  const totalSpecial = Math.min(treasureCount + bombCount, CELL_COUNT - 1)
  const actualTreasures = Math.min(treasureCount, totalSpecial - Math.min(bombCount, Math.floor(totalSpecial / 2)))
  const actualBombs = Math.min(bombCount, totalSpecial - actualTreasures)

  const cells: Cell[] = Array.from({ length: CELL_COUNT }, () => ({
    content: 'empty' as CellContent,
    state: 'hidden' as CellState,
    adjacentTreasures: 0,
  }))

  const indices = Array.from({ length: CELL_COUNT }, (_, i) => i)
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = indices[i]
    indices[i] = indices[j]
    indices[j] = temp
  }

  let placed = 0
  for (let i = 0; i < actualTreasures; i += 1) {
    const isGolden = Math.random() < GOLDEN_TREASURE_CHANCE + depth * 0.02
    cells[indices[placed]].content = isGolden ? 'golden' : 'treasure'
    placed += 1
  }
  for (let i = 0; i < actualBombs; i += 1) {
    cells[indices[placed]].content = 'bomb'
    placed += 1
  }

  for (let idx = 0; idx < CELL_COUNT; idx += 1) {
    const row = Math.floor(idx / GRID_SIZE)
    const col = idx % GRID_SIZE
    let count = 0
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        if (dr === 0 && dc === 0) continue
        const nr = row + dr
        const nc = col + dc
        if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
          const c = cells[nr * GRID_SIZE + nc].content
          if (c === 'treasure' || c === 'golden') {
            count += 1
          }
        }
      }
    }
    cells[idx].adjacentTreasures = count
  }

  return cells
}

function TreasureDigGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()

  const [score, setScore] = useState(0)
  const [treasuresFound, setTreasuresFound] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [board, setBoard] = useState<Cell[]>(() => createBoard(0))
  const [lastDigIndex, setLastDigIndex] = useState<number | null>(null)
  const [lastDigKind, setLastDigKind] = useState<'treasure' | 'bomb' | 'empty' | 'golden' | null>(null)
  const [depth, setDepth] = useState(1)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [lastBonusText, setLastBonusText] = useState('')

  const scoreRef = useRef(0)
  const treasuresFoundRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const boardRef = useRef<Cell[]>(board)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const digFeedbackTimerRef = useRef<number | null>(null)
  const depthRef = useRef(1)
  const comboRef = useRef(0)
  const lastDigAtRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const consecutiveTreasuresRef = useRef(0)
  const bonusTextTimerRef = useRef<number | null>(null)

  const tapHitAudioRef = useRef<HTMLAudioElement | null>(null)
  const tapHitStrongAudioRef = useRef<HTMLAudioElement | null>(null)
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

  const showBonusText = useCallback((text: string) => {
    setLastBonusText(text)
    clearTimeoutSafe(bonusTextTimerRef)
    bonusTextTimerRef.current = window.setTimeout(() => {
      bonusTextTimerRef.current = null
      setLastBonusText('')
    }, 1200)
  }, [])

  const resetBoard = useCallback(() => {
    const nextDepth = depthRef.current + 1
    depthRef.current = nextDepth
    setDepth(nextDepth)

    // Time bonus for clearing a board
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CLEAR_MS)

    // Depth bonus score
    const depthBonus = DEPTH_BONUS_PER_LEVEL * nextDepth
    scoreRef.current += depthBonus
    setScore(scoreRef.current)

    showBonusText(`Depth ${nextDepth}! +${depthBonus} +${(TIME_BONUS_PER_CLEAR_MS / 1000).toFixed(0)}s`)

    const nextBoard = createBoard(nextDepth)
    boardRef.current = nextBoard
    setBoard(nextBoard)
  }, [showBonusText])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(digFeedbackTimerRef)
    clearTimeoutSafe(bonusTextTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (finishedRef.current) return

      const currentBoard = boardRef.current
      const cell = currentBoard[cellIndex]
      if (cell.state === 'revealed') return

      const nextBoard = currentBoard.map((c, i) =>
        i === cellIndex ? { ...c, state: 'revealed' as CellState } : c,
      )
      boardRef.current = nextBoard
      setBoard(nextBoard)

      setLastDigIndex(cellIndex)
      clearTimeoutSafe(digFeedbackTimerRef)
      digFeedbackTimerRef.current = window.setTimeout(() => {
        digFeedbackTimerRef.current = null
        setLastDigIndex(null)
        setLastDigKind(null)
      }, DIG_FEEDBACK_DURATION_MS)

      const now = performance.now()
      const timeSinceLastDig = now - lastDigAtRef.current
      lastDigAtRef.current = now

      // Combo tracking
      if (timeSinceLastDig < COMBO_DIG_WINDOW_MS) {
        comboRef.current += 1
      } else {
        comboRef.current = 1
      }
      setCombo(comboRef.current)

      const comboMult = 1 + comboRef.current * COMBO_DIG_MULTIPLIER
      const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1

      if (cell.content === 'golden') {
        const goldenScore = Math.round(GOLDEN_TREASURE_SCORE * comboMult * feverMult)
        scoreRef.current += goldenScore
        setScore(scoreRef.current)

        const nextFound = treasuresFoundRef.current + 1
        treasuresFoundRef.current = nextFound
        setTreasuresFound(nextFound)
        consecutiveTreasuresRef.current += 1

        setLastDigKind('golden')
        showBonusText(`GOLDEN! +${goldenScore}`)
        playAudio(tapHitStrongAudioRef, 0.8, 1.3)
        const col = cellIndex % GRID_SIZE
        const row = Math.floor(cellIndex / GRID_SIZE)
        effects.comboHitBurst(col * 60 + 30, row * 60 + 200, consecutiveTreasuresRef.current, goldenScore, ['👑', '💎', '✨'])

        // Check fever
        if (consecutiveTreasuresRef.current >= FEVER_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
        }

        const remainingTreasures = nextBoard.filter(
          (c) => (c.content === 'treasure' || c.content === 'golden') && c.state === 'hidden',
        ).length
        if (remainingTreasures === 0) {
          resetBoard()
        }
      } else if (cell.content === 'treasure') {
        const treasureScore = Math.round(BASE_TREASURE_SCORE * comboMult * feverMult)
        scoreRef.current += treasureScore
        setScore(scoreRef.current)

        const nextFound = treasuresFoundRef.current + 1
        treasuresFoundRef.current = nextFound
        setTreasuresFound(nextFound)
        consecutiveTreasuresRef.current += 1

        setLastDigKind('treasure')
        if (comboRef.current > 1) {
          showBonusText(`+${treasureScore} (x${comboMult.toFixed(1)})`)
        }
        playAudio(tapHitStrongAudioRef, 0.7, 1.1)
        {
          const col = cellIndex % GRID_SIZE
          const row = Math.floor(cellIndex / GRID_SIZE)
          effects.spawnParticles(4, col * 60 + 30, row * 60 + 200, ['💎', '✨'])
          effects.showScorePopup(treasureScore, col * 60 + 30, row * 60 + 180)
        }

        // Check fever
        if (consecutiveTreasuresRef.current >= FEVER_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
        }

        const remainingTreasures = nextBoard.filter(
          (c) => (c.content === 'treasure' || c.content === 'golden') && c.state === 'hidden',
        ).length
        if (remainingTreasures === 0) {
          resetBoard()
        }
      } else if (cell.content === 'bomb') {
        const nextScore = Math.max(0, scoreRef.current - BOMB_PENALTY)
        scoreRef.current = nextScore
        setScore(nextScore)
        consecutiveTreasuresRef.current = 0

        setLastDigKind('bomb')
        playAudio(gameOverAudioRef, 0.5, 1.2)
        effects.triggerShake(5)
        effects.triggerFlash('rgba(239,68,68,0.4)')
      } else {
        setLastDigKind('empty')
        consecutiveTreasuresRef.current = 0
        playAudio(tapHitAudioRef, 0.4, 0.9 + Math.random() * 0.2)
      }
    },
    [playAudio, resetBoard, showBonusText],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

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

  useEffect(() => {
    const tapHitAudio = new Audio(tapHitSfx)
    tapHitAudio.preload = 'auto'
    tapHitAudioRef.current = tapHitAudio

    const tapHitStrongAudio = new Audio(tapHitStrongSfx)
    tapHitStrongAudio.preload = 'auto'
    tapHitStrongAudioRef.current = tapHitStrongAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      clearTimeoutSafe(digFeedbackTimerRef)
      clearTimeoutSafe(bonusTextTimerRef)
      tapHitAudioRef.current = null
      tapHitStrongAudioRef.current = null
      gameOverAudioRef.current = null
      effects.cleanup()
    }
  }, [])

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

      // Update fever timer
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.64, 0.95)
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
  }, [finishGame, playAudio])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const getCellDisplayClass = (cell: Cell, index: number): string => {
    const classes = ['treasure-dig-cell']
    if (cell.state === 'hidden') {
      classes.push('treasure-dig-cell-hidden')
    } else {
      classes.push('treasure-dig-cell-revealed')
      if (cell.content === 'golden') classes.push('treasure-dig-cell-golden')
      else if (cell.content === 'treasure') classes.push('treasure-dig-cell-treasure')
      else if (cell.content === 'bomb') classes.push('treasure-dig-cell-bomb')
      else classes.push('treasure-dig-cell-empty')
    }
    if (lastDigIndex === index) {
      classes.push('treasure-dig-cell-just-dug')
      if (lastDigKind === 'treasure' || lastDigKind === 'golden') classes.push('treasure-dig-cell-flash-gold')
      if (lastDigKind === 'bomb') classes.push('treasure-dig-cell-flash-red')
    }
    return classes.join(' ')
  }

  const getCellLabel = (cell: Cell): string => {
    if (cell.state === 'hidden') return ''
    if (cell.content === 'golden') return '\u{1F451}'
    if (cell.content === 'treasure') return '\u{1F48E}'
    if (cell.content === 'bomb') return '\u{1F4A3}'
    if (cell.adjacentTreasures > 0) return String(cell.adjacentTreasures)
    return ''
  }

  return (
    <section className="mini-game-panel treasure-dig-panel" aria-label="treasure-dig-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      <div className="treasure-dig-header">
        <img className="treasure-dig-avatar" src={parkWankyuSprite} alt="Digger" />
        <div style={{ flex: 1 }}>
          <p className="treasure-dig-score">{score.toLocaleString()}</p>
          <p className="treasure-dig-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <p className={`treasure-dig-time ${isLowTime ? 'low-time' : ''}`}>
          {(remainingMs / 1000).toFixed(1)}s
        </p>
      </div>

      <div className="treasure-dig-meta-row">
        <p>{'\u{1F48E}'} <strong>{treasuresFound}</strong></p>
        <p>Depth <strong style={{ color: '#7c3aed' }}>{depth}</strong></p>
        {combo > 1 && <p style={{ color: '#f59e0b', fontWeight: 'bold' }}>x{(1 + combo * COMBO_DIG_MULTIPLIER).toFixed(1)}</p>}
      </div>

      {isFever && (
        <p style={{
          margin: 0, fontSize: 14, fontWeight: 900, color: '#ef4444',
          textShadow: '0 0 8px rgba(239,68,68,0.6)', letterSpacing: 3,
          animation: 'treasure-dig-fever-flash 0.3s infinite alternate', textAlign: 'center',
        }}>
          FEVER x{FEVER_MULTIPLIER} ({(feverMs / 1000).toFixed(1)}s)
        </p>
      )}

      {lastBonusText && (
        <p style={{
          margin: 0, fontSize: 14, fontWeight: 800, color: '#fbbf24',
          textShadow: '0 0 8px rgba(251,191,36,0.6)', textAlign: 'center',
          animation: 'treasure-dig-bonus-pop 0.4s ease-out',
        }}>
          {lastBonusText}
        </p>
      )}

      <div className={`treasure-dig-grid ${isFever ? 'treasure-dig-grid-fever' : ''}`}>
        {board.map((cell, index) => (
          <button
            className={getCellDisplayClass(cell, index)}
            key={index}
            type="button"
            onClick={() => handleCellTap(index)}
            disabled={cell.state === 'revealed'}
            aria-label={`cell-${Math.floor(index / GRID_SIZE)}-${index % GRID_SIZE}`}
          >
            <span className="treasure-dig-cell-label">{getCellLabel(cell)}</span>
          </button>
        ))}
      </div>

      <div className="treasure-dig-legend">
        <span className="treasure-dig-legend-item">
          <span className="treasure-dig-legend-icon">{'\u{1F48E}'}</span> +{BASE_TREASURE_SCORE}
        </span>
        <span className="treasure-dig-legend-item">
          <span className="treasure-dig-legend-icon">{'\u{1F451}'}</span> +{GOLDEN_TREASURE_SCORE}
        </span>
        <span className="treasure-dig-legend-item">
          <span className="treasure-dig-legend-icon">{'\u{1F4A3}'}</span> -{BOMB_PENALTY}
        </span>
      </div>

      <button className="text-button" type="button" onClick={handleExit}>
        Hub
      </button>

      <style>{`
        .treasure-dig-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          height: 100%;
          user-select: none;
          -webkit-user-select: none;
          overflow: hidden;
          background: linear-gradient(180deg, #78350f 0%, #92400e 20%, #fef3c7 100%);
        }

        .treasure-dig-header {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 10px 14px 8px;
          background: linear-gradient(180deg, rgba(0,0,0,0.3), transparent);
        }

        .treasure-dig-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 3px solid #fbbf24;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }

        .treasure-dig-score {
          font-size: 26px;
          font-weight: 800;
          color: #fef3c7;
          margin: 0;
          text-shadow: 0 2px 4px rgba(0,0,0,0.4);
        }

        .treasure-dig-best {
          font-size: 10px;
          font-weight: 600;
          color: rgba(254,243,199,0.6);
          margin: 0;
        }

        .treasure-dig-time {
          font-size: 20px;
          font-weight: 700;
          color: #fef3c7;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }

        .treasure-dig-time.low-time {
          color: #fca5a5;
          animation: treasure-dig-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes treasure-dig-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .treasure-dig-meta-row {
          display: flex;
          justify-content: center;
          align-items: center;
          width: 100%;
          gap: 16px;
          padding: 4px 12px;
          background: rgba(255,255,255,0.15);
          backdrop-filter: blur(4px);
        }

        .treasure-dig-meta-row p {
          margin: 0;
          font-size: 12px;
          color: #fef3c7;
        }

        .treasure-dig-meta-row strong {
          color: #fbbf24;
          font-size: 14px;
        }

        .treasure-dig-grid {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          gap: 5px;
          width: 100%;
          max-width: 340px;
          flex: 1;
          padding: 8px 12px;
          align-content: center;
        }

        .treasure-dig-grid-fever {
          box-shadow: 0 0 16px 4px rgba(239, 68, 68, 0.3);
          border-radius: 8px;
        }

        .treasure-dig-cell {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 20px;
          font-weight: 700;
          transition: transform 0.1s ease, background-color 0.2s ease;
          aspect-ratio: 1;
          padding: 0;
        }

        .treasure-dig-cell:active:not(:disabled) {
          transform: scale(0.92);
        }

        .treasure-dig-cell-hidden {
          background: linear-gradient(145deg, #a16207, #854d0e);
          box-shadow: inset 0 -3px 0 #713f12, 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .treasure-dig-cell-hidden:hover:not(:disabled) {
          background: linear-gradient(145deg, #b4720a, #92550f);
        }

        .treasure-dig-cell-revealed {
          cursor: default;
        }

        .treasure-dig-cell-empty {
          background: #d6d3d1;
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.12);
          color: #44403c;
        }

        .treasure-dig-cell-treasure {
          background: linear-gradient(145deg, #fbbf24, #f59e0b);
          box-shadow: 0 0 12px rgba(251, 191, 36, 0.6);
        }

        .treasure-dig-cell-golden {
          background: linear-gradient(145deg, #fde68a, #fbbf24, #f59e0b);
          box-shadow: 0 0 20px rgba(251, 191, 36, 0.8);
          animation: treasure-dig-golden-glow 0.5s ease-in-out infinite alternate;
        }

        @keyframes treasure-dig-golden-glow {
          from { box-shadow: 0 0 12px rgba(251, 191, 36, 0.6); }
          to { box-shadow: 0 0 24px rgba(251, 191, 36, 1); }
        }

        .treasure-dig-cell-bomb {
          background: linear-gradient(145deg, #ef4444, #dc2626);
          box-shadow: 0 0 12px rgba(239, 68, 68, 0.5);
        }

        .treasure-dig-cell-just-dug {
          animation: treasure-dig-pop 0.3s ease-out;
        }

        .treasure-dig-cell-flash-gold {
          animation: treasure-dig-flash-gold 0.4s ease-out;
        }

        .treasure-dig-cell-flash-red {
          animation: treasure-dig-flash-red 0.4s ease-out;
        }

        @keyframes treasure-dig-pop {
          0% { transform: scale(0.7); }
          50% { transform: scale(1.12); }
          100% { transform: scale(1); }
        }

        @keyframes treasure-dig-flash-gold {
          0% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.8); transform: scale(0.7); }
          50% { box-shadow: 0 0 20px 6px rgba(251, 191, 36, 0.6); transform: scale(1.15); }
          100% { box-shadow: 0 0 12px rgba(251, 191, 36, 0.6); transform: scale(1); }
        }

        @keyframes treasure-dig-flash-red {
          0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.8); transform: scale(0.7); }
          50% { box-shadow: 0 0 20px 6px rgba(239, 68, 68, 0.6); transform: scale(1.15); }
          100% { box-shadow: 0 0 12px rgba(239, 68, 68, 0.5); transform: scale(1); }
        }

        .treasure-dig-cell-label {
          pointer-events: none;
          line-height: 1;
        }

        .treasure-dig-legend {
          display: flex;
          gap: 16px;
          justify-content: center;
          width: 100%;
          max-width: 340px;
        }

        .treasure-dig-legend-item {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          font-weight: 600;
          color: #57534e;
        }

        .treasure-dig-legend-icon {
          font-size: 16px;
        }

        @keyframes treasure-dig-fever-flash {
          from { opacity: 0.7; }
          to { opacity: 1; }
        }

        @keyframes treasure-dig-bonus-pop {
          0% { transform: scale(0.5); opacity: 0; }
          60% { transform: scale(1.2); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </section>
  )
}

export const treasureDigModule: MiniGameModule = {
  manifest: {
    id: 'treasure-dig',
    title: 'Treasure Dig',
    description: '\uB545\uC744 \uD30C\uC11C \uBCF4\uBB3C\uC744 \uCC3E\uC544\uB77C! \uD3ED\uD0C4\uC740 \uC870\uC2EC!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#a16207',
  },
  Component: TreasureDigGame,
}
