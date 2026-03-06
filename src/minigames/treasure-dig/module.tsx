import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

// --- Sound imports ---
import digSfx from '../../../assets/sounds/treasure-dig-dig.mp3'
import treasureFoundSfx from '../../../assets/sounds/treasure-dig-found.mp3'
import goldenFoundSfx from '../../../assets/sounds/treasure-dig-golden.mp3'
import bombSfx from '../../../assets/sounds/treasure-dig-bomb.mp3'
import comboSfx from '../../../assets/sounds/treasure-dig-combo.mp3'
import feverSfx from '../../../assets/sounds/treasure-dig-fever.mp3'
import depthClearSfx from '../../../assets/sounds/treasure-dig-depth-clear.mp3'
import hintSfx from '../../../assets/sounds/treasure-dig-hint.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Game Config ────────────────────────────────────────────
const ROUND_DURATION_MS = 45000
const GRID_SIZE = 5
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const BASE_TREASURE_COUNT = 3
const BASE_BOMB_COUNT = 2
const BASE_TREASURE_SCORE = 30
const BOMB_PENALTY = 20
const LOW_TIME_THRESHOLD_MS = 8000
const DIG_FEEDBACK_DURATION_MS = 400

// ─── Gimmick constants ─────────────────────────────────────
const GOLDEN_TREASURE_CHANCE = 0.12
const GOLDEN_TREASURE_SCORE = 120
const COMBO_DIG_WINDOW_MS = 2500
const COMBO_DIG_MULTIPLIER = 0.5
const DEPTH_BONUS_PER_LEVEL = 15
const TIME_BONUS_PER_CLEAR_MS = 4000
const FEVER_THRESHOLD = 3
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 2.5

// ─── New Feature: Hint System ──────────────────────────────
const HINT_COOLDOWN_MS = 12000
const HINT_FLASH_DURATION_MS = 1500

// ─── New Feature: Shovel Power-up ──────────────────────────
const SHOVEL_CHANCE_PER_DEPTH = 0.3
const SHOVEL_CLEAR_COUNT = 3

// ─── New Feature: X-Ray Power-up ───────────────────────────
const XRAY_CHANCE_PER_DEPTH = 0.2
const XRAY_DURATION_MS = 2000

// ─── New Feature: Time Gem ─────────────────────────────────
const TIME_GEM_CHANCE = 0.08
const TIME_GEM_BONUS_MS = 5000

type CellContent = 'empty' | 'treasure' | 'bomb' | 'golden' | 'time-gem'
type CellState = 'hidden' | 'revealed'
type PowerUpType = 'shovel' | 'xray' | null

interface Cell {
  content: CellContent
  state: CellState
  adjacentTreasures: number
  hintFlashing: boolean
}

function createBoard(depth: number): Cell[] {
  const treasureCount = BASE_TREASURE_COUNT + Math.floor(depth / 2)
  const bombCount = BASE_BOMB_COUNT + Math.floor(depth / 3)
  const totalSpecial = Math.min(treasureCount + bombCount + 1, CELL_COUNT - 2)
  const actualTreasures = Math.min(treasureCount, totalSpecial - Math.min(bombCount, Math.floor(totalSpecial / 2)))
  const actualBombs = Math.min(bombCount, totalSpecial - actualTreasures)

  const cells: Cell[] = Array.from({ length: CELL_COUNT }, () => ({
    content: 'empty' as CellContent,
    state: 'hidden' as CellState,
    adjacentTreasures: 0,
    hintFlashing: false,
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
    const isGolden = Math.random() < GOLDEN_TREASURE_CHANCE + depth * 0.015
    cells[indices[placed]].content = isGolden ? 'golden' : 'treasure'
    placed += 1
  }
  for (let i = 0; i < actualBombs; i += 1) {
    cells[indices[placed]].content = 'bomb'
    placed += 1
  }
  // Time gem
  if (placed < CELL_COUNT && Math.random() < TIME_GEM_CHANCE + depth * 0.01) {
    cells[indices[placed]].content = 'time-gem'
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
          if (c === 'treasure' || c === 'golden') count += 1
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
  const [lastDigKind, setLastDigKind] = useState<CellContent | null>(null)
  const [depth, setDepth] = useState(1)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [lastBonusText, setLastBonusText] = useState('')
  const [hintCooldownMs, setHintCooldownMs] = useState(0)
  const [isXrayActive, setIsXrayActive] = useState(false)
  const [pendingPowerUp, setPendingPowerUp] = useState<PowerUpType>(null)
  const [depthTransition, setDepthTransition] = useState(false)
  const totalDigsRef = useRef(0)
  const bombsHitRef = useRef(0)

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
  const maxComboRef = useRef(0)
  const lastDigAtRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const consecutiveTreasuresRef = useRef(0)
  const bonusTextTimerRef = useRef<number | null>(null)
  const hintCooldownRef = useRef(0)
  const isXrayRef = useRef(false)
  const xrayTimerRef = useRef(0)

  // Audio refs
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({
    dig: null, treasureFound: null, goldenFound: null, bomb: null,
    combo: null, fever: null, depthClear: null, hint: null, gameOver: null,
  })

  const clearTimeoutSafe = (timerRef: { current: number | null }) => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const playAudio = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (audio === null || audio === undefined) return
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const showBonusText = useCallback((text: string) => {
    setLastBonusText(text)
    clearTimeoutSafe(bonusTextTimerRef)
    bonusTextTimerRef.current = window.setTimeout(() => {
      bonusTextTimerRef.current = null
      setLastBonusText('')
    }, 1400)
  }, [])

  const getCellXY = useCallback((cellIndex: number) => {
    const col = cellIndex % GRID_SIZE
    const row = Math.floor(cellIndex / GRID_SIZE)
    return { x: col * 70 + 35, y: row * 70 + 220 }
  }, [])

  const resetBoard = useCallback(() => {
    const nextDepth = depthRef.current + 1
    depthRef.current = nextDepth
    setDepth(nextDepth)
    setDepthTransition(true)
    setTimeout(() => setDepthTransition(false), 600)

    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CLEAR_MS)

    const depthBonus = DEPTH_BONUS_PER_LEVEL * nextDepth
    scoreRef.current += depthBonus
    setScore(scoreRef.current)

    // Power-up roll
    if (Math.random() < SHOVEL_CHANCE_PER_DEPTH) {
      setPendingPowerUp('shovel')
    } else if (Math.random() < XRAY_CHANCE_PER_DEPTH) {
      setPendingPowerUp('xray')
    }

    showBonusText(`DEPTH ${nextDepth}! +${depthBonus} +${(TIME_BONUS_PER_CLEAR_MS / 1000).toFixed(0)}s`)
    playAudio('depthClear', 0.7)

    effects.triggerFlash('rgba(251,191,36,0.3)')

    const nextBoard = createBoard(nextDepth)
    boardRef.current = nextBoard
    setBoard(nextBoard)
  }, [showBonusText, playAudio, effects])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimeoutSafe(digFeedbackTimerRef)
    clearTimeoutSafe(bonusTextTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    playAudio('gameOver', 0.6)
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish, playAudio])

  const activateHint = useCallback(() => {
    if (hintCooldownRef.current > 0 || finishedRef.current) return

    hintCooldownRef.current = HINT_COOLDOWN_MS
    setHintCooldownMs(HINT_COOLDOWN_MS)
    playAudio('hint', 0.5)

    // Flash cells adjacent to hidden treasures
    const currentBoard = boardRef.current
    const hintedBoard = currentBoard.map((cell, idx) => {
      if (cell.state === 'hidden' && cell.adjacentTreasures > 0) {
        return { ...cell, hintFlashing: true }
      }
      return cell
    })
    boardRef.current = hintedBoard
    setBoard(hintedBoard)

    setTimeout(() => {
      const restored = boardRef.current.map((c) => ({ ...c, hintFlashing: false }))
      boardRef.current = restored
      setBoard(restored)
    }, HINT_FLASH_DURATION_MS)
  }, [playAudio])

  const activateShovel = useCallback(() => {
    if (finishedRef.current) return
    setPendingPowerUp(null)

    const currentBoard = boardRef.current
    const hiddenEmpties: number[] = []
    currentBoard.forEach((cell, idx) => {
      if (cell.state === 'hidden' && cell.content === 'empty') hiddenEmpties.push(idx)
    })

    // Shuffle and take SHOVEL_CLEAR_COUNT
    for (let i = hiddenEmpties.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      const temp = hiddenEmpties[i]
      hiddenEmpties[i] = hiddenEmpties[j]
      hiddenEmpties[j] = temp
    }
    const toClear = hiddenEmpties.slice(0, SHOVEL_CLEAR_COUNT)

    const nextBoard = currentBoard.map((c, idx) =>
      toClear.includes(idx) ? { ...c, state: 'revealed' as CellState } : c,
    )
    boardRef.current = nextBoard
    setBoard(nextBoard)
    playAudio('dig', 0.6, 0.8)
    showBonusText(`SHOVEL! ${toClear.length} cleared`)
  }, [playAudio, showBonusText])

  const activateXray = useCallback(() => {
    if (finishedRef.current) return
    setPendingPowerUp(null)
    isXrayRef.current = true
    xrayTimerRef.current = XRAY_DURATION_MS
    setIsXrayActive(true)
    playAudio('hint', 0.6, 1.3)
    showBonusText('X-RAY VISION!')
  }, [playAudio, showBonusText])

  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (finishedRef.current) return

      const currentBoard = boardRef.current
      const cell = currentBoard[cellIndex]
      if (cell.state === 'revealed') return

      totalDigsRef.current += 1

      const nextBoard = currentBoard.map((c, i) =>
        i === cellIndex ? { ...c, state: 'revealed' as CellState, hintFlashing: false } : c,
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
      if (comboRef.current > maxComboRef.current) {
        maxComboRef.current = comboRef.current
      }

      const comboMult = 1 + (comboRef.current - 1) * COMBO_DIG_MULTIPLIER
      const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
      const { x, y } = getCellXY(cellIndex)

      const maybeCheckClear = (b: Cell[]) => {
        const remaining = b.filter(
          (c) => (c.content === 'treasure' || c.content === 'golden') && c.state === 'hidden',
        ).length
        if (remaining === 0) resetBoard()
      }

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
        playAudio('goldenFound', 0.8)
        if (comboRef.current > 2) playAudio('combo', 0.5, 1 + comboRef.current * 0.1)
        effects.comboHitBurst(x, y, consecutiveTreasuresRef.current, goldenScore, ['\u{1F451}', '\u{1F48E}', '\u{2728}', '\u{1F31F}'])
        effects.triggerFlash('rgba(251,191,36,0.25)')

        if (consecutiveTreasuresRef.current >= FEVER_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playAudio('fever', 0.7)
        }

        maybeCheckClear(nextBoard)
      } else if (cell.content === 'treasure') {
        const treasureScore = Math.round(BASE_TREASURE_SCORE * comboMult * feverMult)
        scoreRef.current += treasureScore
        setScore(scoreRef.current)
        const nextFound = treasuresFoundRef.current + 1
        treasuresFoundRef.current = nextFound
        setTreasuresFound(nextFound)
        consecutiveTreasuresRef.current += 1
        setLastDigKind('treasure')
        playAudio('treasureFound', 0.7)
        if (comboRef.current > 2) {
          playAudio('combo', 0.4, 1 + comboRef.current * 0.1)
          showBonusText(`+${treasureScore} COMBO x${comboMult.toFixed(1)}!`)
        }
        effects.spawnParticles(5, x, y, ['\u{1F48E}', '\u{2728}', '\u{1F4B0}'])
        effects.showScorePopup(treasureScore, x, y - 20)

        if (consecutiveTreasuresRef.current >= FEVER_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playAudio('fever', 0.7)
        }

        maybeCheckClear(nextBoard)
      } else if (cell.content === 'time-gem') {
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_GEM_BONUS_MS)
        setLastDigKind('time-gem')
        playAudio('goldenFound', 0.6, 1.5)
        showBonusText(`TIME GEM! +${(TIME_GEM_BONUS_MS / 1000).toFixed(0)}s`)
        effects.spawnParticles(6, x, y, ['\u{23F0}', '\u{1F552}', '\u{2728}'])
        effects.triggerFlash('rgba(59,130,246,0.25)')
      } else if (cell.content === 'bomb') {
        const penalty = Math.round(BOMB_PENALTY * (1 + depthRef.current * 0.1))
        const nextScore = Math.max(0, scoreRef.current - penalty)
        scoreRef.current = nextScore
        setScore(nextScore)
        consecutiveTreasuresRef.current = 0
        bombsHitRef.current += 1
        setLastDigKind('bomb')
        playAudio('bomb', 0.7)
        effects.triggerShake(8)
        effects.triggerFlash('rgba(239,68,68,0.5)')
        effects.spawnParticles(6, x, y, ['\u{1F4A5}', '\u{1F525}', '\u{1F4A3}'])
        effects.showScorePopup(-penalty, x, y - 20)
      } else {
        setLastDigKind('empty')
        consecutiveTreasuresRef.current = 0
        playAudio('dig', 0.4, 0.85 + Math.random() * 0.3)
        effects.spawnParticles(2, x, y, ['\u{1F4A8}', '\u{2601}\uFE0F'])
      }
    },
    [playAudio, showBonusText, effects, getCellXY, resetBoard],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  // Key handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
      if (event.code === 'KeyH') {
        event.preventDefault()
        activateHint()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, activateHint])

  // Init audio
  useEffect(() => {
    const sfxMap: Record<string, string> = {
      dig: digSfx, treasureFound: treasureFoundSfx, goldenFound: goldenFoundSfx,
      bomb: bombSfx, combo: comboSfx, fever: feverSfx,
      depthClear: depthClearSfx, hint: hintSfx, gameOver: gameOverHitSfx,
    }
    for (const [key, src] of Object.entries(sfxMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }

    return () => {
      clearTimeoutSafe(digFeedbackTimerRef)
      clearTimeoutSafe(bonusTextTimerRef)
      for (const key of Object.keys(audioRefs.current)) {
        audioRefs.current[key] = null
      }
      effects.cleanup()
    }
  }, [])

  // Game loop
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

      // Fever timer
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) {
          isFeverRef.current = false
          setIsFever(false)
        }
      }

      // Hint cooldown
      if (hintCooldownRef.current > 0) {
        hintCooldownRef.current = Math.max(0, hintCooldownRef.current - deltaMs)
        setHintCooldownMs(hintCooldownRef.current)
      }

      // X-ray timer
      if (isXrayRef.current) {
        xrayTimerRef.current = Math.max(0, xrayTimerRef.current - deltaMs)
        if (xrayTimerRef.current <= 0) {
          isXrayRef.current = false
          setIsXrayActive(false)
        }
      }

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
  }, [finishGame, effects])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const timerPercent = remainingMs / ROUND_DURATION_MS
  const hintReady = hintCooldownMs <= 0

  const getCellDisplayClass = (cell: Cell, index: number): string => {
    const classes = ['td-cell']
    if (cell.state === 'hidden') {
      classes.push('td-cell-hidden')
      if (cell.hintFlashing) classes.push('td-cell-hint-flash')
      if (isXrayActive && (cell.content === 'treasure' || cell.content === 'golden')) {
        classes.push('td-cell-xray-glow')
      }
    } else {
      classes.push('td-cell-revealed')
      if (cell.content === 'golden') classes.push('td-cell-golden')
      else if (cell.content === 'treasure') classes.push('td-cell-treasure')
      else if (cell.content === 'bomb') classes.push('td-cell-bomb')
      else if (cell.content === 'time-gem') classes.push('td-cell-time-gem')
      else classes.push('td-cell-empty')
    }
    if (lastDigIndex === index) {
      classes.push('td-cell-just-dug')
      if (lastDigKind === 'treasure' || lastDigKind === 'golden') classes.push('td-cell-flash-gold')
      if (lastDigKind === 'bomb') classes.push('td-cell-flash-red')
      if (lastDigKind === 'time-gem') classes.push('td-cell-flash-blue')
    }
    return classes.join(' ')
  }

  const getCellLabel = (cell: Cell): string => {
    if (cell.state === 'hidden') return ''
    if (cell.content === 'golden') return '\u{1F451}'
    if (cell.content === 'treasure') return '\u{1F48E}'
    if (cell.content === 'bomb') return '\u{1F4A3}'
    if (cell.content === 'time-gem') return '\u{23F0}'
    if (cell.adjacentTreasures > 0) return String(cell.adjacentTreasures)
    return ''
  }

  const getAdjacentColor = (count: number): string => {
    if (count === 1) return '#3b82f6'
    if (count === 2) return '#22c55e'
    if (count === 3) return '#ef4444'
    return '#7c3aed'
  }

  return (
    <section
      className={`td-panel ${isFever ? 'td-panel-fever' : ''} ${depthTransition ? 'td-depth-transition' : ''}`}
      aria-label="treasure-dig-game"
      style={{ ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Timer bar */}
      <div className="td-timer-bar-wrap">
        <div
          className={`td-timer-bar ${isLowTime ? 'td-timer-bar-low' : ''}`}
          style={{ width: `${timerPercent * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="td-header">
        <div className="td-score-block">
          <p className="td-score">{score.toLocaleString()}</p>
          <p className="td-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="td-timer-block">
          <p className={`td-time ${isLowTime ? 'td-time-low' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      {/* Stats row */}
      <div className="td-stats-row">
        <span className="td-stat">{'\u{1F48E}'} {treasuresFound}</span>
        <span className="td-stat td-stat-depth">D{depth}</span>
        {combo > 1 && (
          <span className="td-stat td-stat-combo">
            x{(1 + (combo - 1) * COMBO_DIG_MULTIPLIER).toFixed(1)}
          </span>
        )}
        {isFever && (
          <span className="td-stat td-stat-fever">
            FEVER {(feverMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Bonus text */}
      {lastBonusText && (
        <p className="td-bonus-text">{lastBonusText}</p>
      )}

      {/* Power-up notification */}
      {pendingPowerUp && (
        <div className="td-powerup-bar">
          <button
            className="td-powerup-btn"
            type="button"
            onClick={() => {
              if (pendingPowerUp === 'shovel') activateShovel()
              else if (pendingPowerUp === 'xray') activateXray()
            }}
          >
            {pendingPowerUp === 'shovel' ? '\u{1F6E0}\uFE0F SHOVEL' : '\u{1F50D} X-RAY'}
            <span className="td-powerup-sub">TAP!</span>
          </button>
        </div>
      )}

      {/* Grid - fills remaining space */}
      <div className={`td-grid ${isFever ? 'td-grid-fever' : ''}`}>
        {board.map((cell, index) => (
          <button
            className={getCellDisplayClass(cell, index)}
            key={index}
            type="button"
            onClick={() => handleCellTap(index)}
            disabled={cell.state === 'revealed'}
            aria-label={`cell-${Math.floor(index / GRID_SIZE)}-${index % GRID_SIZE}`}
          >
            <span
              className="td-cell-label"
              style={
                cell.state === 'revealed' && cell.content === 'empty' && cell.adjacentTreasures > 0
                  ? { color: getAdjacentColor(cell.adjacentTreasures) }
                  : undefined
              }
            >
              {getCellLabel(cell)}
            </span>
          </button>
        ))}
      </div>

      {/* Bottom bar */}
      <div className="td-bottom-bar">
        <button
          className={`td-hint-btn ${hintReady ? 'td-hint-ready' : 'td-hint-cooldown'}`}
          type="button"
          onClick={activateHint}
          disabled={!hintReady}
        >
          {hintReady ? '\u{1F4A1} HINT' : `\u{1F4A1} ${(hintCooldownMs / 1000).toFixed(0)}s`}
        </button>

        <div className="td-legend">
          <span>{'\u{1F48E}'}+{BASE_TREASURE_SCORE}</span>
          <span>{'\u{1F451}'}+{GOLDEN_TREASURE_SCORE}</span>
          <span>{'\u{1F4A3}'}-{BOMB_PENALTY}</span>
          <span>{'\u{23F0}'}+{(TIME_GEM_BONUS_MS / 1000).toFixed(0)}s</span>
        </div>

        <button className="td-exit-btn" type="button" onClick={handleExit}>
          Hub
        </button>
      </div>

      <style>{`
        .td-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          max-width: 432px;
          aspect-ratio: 9/16;
          margin: 0 auto;
          overflow: hidden;
          position: relative;
          user-select: none;
          -webkit-user-select: none;
          background: linear-gradient(180deg, #78350f 0%, #92400e 15%, #b45309 40%, #d4a574 70%, #fef3c7 100%);
        }

        .td-panel-fever {
          animation: td-fever-bg 0.3s ease-in-out infinite alternate;
        }

        @keyframes td-fever-bg {
          from { filter: brightness(1); }
          to { filter: brightness(1.1) saturate(1.2); }
        }

        .td-depth-transition {
          animation: td-depth-flash 0.6s ease-out;
        }

        @keyframes td-depth-flash {
          0% { filter: brightness(1.5); }
          100% { filter: brightness(1); }
        }

        /* Timer bar */
        .td-timer-bar-wrap {
          width: 100%;
          height: 5px;
          background: rgba(0,0,0,0.3);
          flex-shrink: 0;
        }

        .td-timer-bar {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #84cc16, #eab308);
          transition: width 0.1s linear;
          border-radius: 0 3px 3px 0;
        }

        .td-timer-bar-low {
          background: linear-gradient(90deg, #ef4444, #f97316);
          animation: td-bar-pulse 0.4s ease-in-out infinite alternate;
        }

        @keyframes td-bar-pulse {
          from { opacity: 1; }
          to { opacity: 0.6; }
        }

        /* Header */
        .td-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 8px 16px 4px;
          flex-shrink: 0;
        }

        .td-score-block {
          flex: 1;
        }

        .td-score {
          font-size: clamp(28px, 7vw, 36px);
          font-weight: 900;
          color: #fef3c7;
          margin: 0;
          text-shadow: 0 2px 6px rgba(0,0,0,0.5), 0 0 20px rgba(251,191,36,0.3);
          line-height: 1.1;
        }

        .td-best {
          font-size: 11px;
          font-weight: 600;
          color: rgba(254,243,199,0.5);
          margin: 0;
        }

        .td-timer-block {
          text-align: right;
        }

        .td-time {
          font-size: clamp(22px, 6vw, 30px);
          font-weight: 800;
          color: #fef3c7;
          margin: 0;
          font-variant-numeric: tabular-nums;
          text-shadow: 0 1px 4px rgba(0,0,0,0.4);
        }

        .td-time-low {
          color: #fca5a5;
          animation: td-time-pulse 0.4s ease-in-out infinite alternate;
        }

        @keyframes td-time-pulse {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0.6; transform: scale(1.05); }
        }

        /* Stats row */
        .td-stats-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 4px 12px;
          background: rgba(0,0,0,0.15);
          backdrop-filter: blur(4px);
          flex-shrink: 0;
        }

        .td-stat {
          font-size: 13px;
          font-weight: 700;
          color: #fef3c7;
        }

        .td-stat-depth {
          color: #c084fc;
          font-size: 14px;
        }

        .td-stat-combo {
          color: #fbbf24;
          animation: td-combo-bounce 0.3s ease-out;
        }

        @keyframes td-combo-bounce {
          0% { transform: scale(1.4); }
          100% { transform: scale(1); }
        }

        .td-stat-fever {
          color: #ef4444;
          font-weight: 900;
          letter-spacing: 1px;
          text-shadow: 0 0 8px rgba(239,68,68,0.6);
          animation: td-fever-text 0.25s ease-in-out infinite alternate;
        }

        @keyframes td-fever-text {
          from { opacity: 0.8; transform: scale(1); }
          to { opacity: 1; transform: scale(1.05); }
        }

        /* Bonus text */
        .td-bonus-text {
          margin: 2px 0;
          font-size: 16px;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 0 0 12px rgba(251,191,36,0.8), 0 2px 4px rgba(0,0,0,0.5);
          text-align: center;
          animation: td-bonus-pop 0.5s ease-out;
          flex-shrink: 0;
          letter-spacing: 1px;
        }

        @keyframes td-bonus-pop {
          0% { transform: scale(0.3) translateY(10px); opacity: 0; }
          50% { transform: scale(1.2) translateY(-5px); opacity: 1; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }

        /* Power-up bar */
        .td-powerup-bar {
          width: 100%;
          padding: 4px 16px;
          display: flex;
          justify-content: center;
          flex-shrink: 0;
        }

        .td-powerup-btn {
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          border: 2px solid #c084fc;
          border-radius: 12px;
          color: white;
          font-size: 15px;
          font-weight: 800;
          padding: 8px 24px;
          cursor: pointer;
          animation: td-powerup-pulse 0.6s ease-in-out infinite alternate;
          display: flex;
          align-items: center;
          gap: 8px;
          box-shadow: 0 0 16px rgba(124,58,237,0.5);
        }

        .td-powerup-sub {
          font-size: 11px;
          opacity: 0.8;
          font-weight: 600;
        }

        @keyframes td-powerup-pulse {
          from { transform: scale(1); box-shadow: 0 0 16px rgba(124,58,237,0.5); }
          to { transform: scale(1.03); box-shadow: 0 0 24px rgba(124,58,237,0.8); }
        }

        .td-powerup-btn:active {
          transform: scale(0.95) !important;
        }

        /* Grid - fills remaining space */
        .td-grid {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          gap: clamp(4px, 1.2vw, 7px);
          width: 100%;
          padding: 8px 12px;
          flex: 1;
          align-content: center;
          min-height: 0;
        }

        .td-grid-fever {
          box-shadow: inset 0 0 30px rgba(239, 68, 68, 0.2);
          border-radius: 8px;
        }

        /* Cells */
        .td-cell {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: clamp(6px, 1.5vw, 10px);
          cursor: pointer;
          font-size: clamp(20px, 5vw, 28px);
          font-weight: 800;
          transition: transform 0.1s ease, background-color 0.2s ease;
          aspect-ratio: 1;
          padding: 0;
          -webkit-tap-highlight-color: transparent;
        }

        .td-cell:active:not(:disabled) {
          transform: scale(0.88);
        }

        .td-cell-hidden {
          background: linear-gradient(145deg, #a16207 0%, #854d0e 50%, #713f12 100%);
          box-shadow: inset 0 -4px 0 #5c3a10, inset 0 2px 0 rgba(255,255,255,0.1), 0 3px 6px rgba(0,0,0,0.3);
        }

        .td-cell-hidden::after {
          content: '';
          position: absolute;
          inset: 3px;
          border-radius: 4px;
          background: radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.12), transparent 60%);
          pointer-events: none;
        }

        .td-cell-hidden:hover:not(:disabled) {
          background: linear-gradient(145deg, #b87a10, #9a5f11);
          box-shadow: inset 0 -4px 0 #6b4510, inset 0 2px 0 rgba(255,255,255,0.15), 0 4px 8px rgba(0,0,0,0.35);
        }

        .td-cell-hint-flash {
          animation: td-hint-glow 0.5s ease-in-out infinite alternate;
        }

        @keyframes td-hint-glow {
          from { box-shadow: inset 0 -4px 0 #5c3a10, 0 0 4px rgba(251,191,36,0.3); }
          to { box-shadow: inset 0 -4px 0 #5c3a10, 0 0 16px rgba(251,191,36,0.8), 0 0 32px rgba(251,191,36,0.4); }
        }

        .td-cell-xray-glow {
          animation: td-xray-pulse 0.4s ease-in-out infinite alternate;
        }

        @keyframes td-xray-pulse {
          from { box-shadow: inset 0 -4px 0 #5c3a10, 0 0 8px rgba(59,130,246,0.4); }
          to { box-shadow: inset 0 -4px 0 #5c3a10, 0 0 20px rgba(59,130,246,0.9), 0 0 40px rgba(59,130,246,0.4); }
        }

        .td-cell-revealed {
          cursor: default;
        }

        .td-cell-empty {
          background: linear-gradient(145deg, #d6d3d1, #c4bfba);
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.12);
          color: #44403c;
        }

        .td-cell-treasure {
          background: linear-gradient(145deg, #fbbf24, #f59e0b, #d97706);
          box-shadow: 0 0 16px rgba(251,191,36,0.6), inset 0 2px 0 rgba(255,255,255,0.3);
          animation: td-treasure-in 0.4s ease-out;
        }

        @keyframes td-treasure-in {
          0% { transform: scale(0.5) rotate(-15deg); opacity: 0; }
          60% { transform: scale(1.15) rotate(3deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }

        .td-cell-golden {
          background: linear-gradient(145deg, #fde68a, #fbbf24, #f59e0b, #d97706);
          box-shadow: 0 0 24px rgba(251,191,36,0.9), inset 0 2px 0 rgba(255,255,255,0.4);
          animation: td-golden-in 0.5s ease-out, td-golden-glow 0.6s ease-in-out 0.5s infinite alternate;
        }

        @keyframes td-golden-in {
          0% { transform: scale(0.3) rotate(-30deg); opacity: 0; }
          50% { transform: scale(1.3) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }

        @keyframes td-golden-glow {
          from { box-shadow: 0 0 16px rgba(251,191,36,0.6); }
          to { box-shadow: 0 0 32px rgba(251,191,36,1), 0 0 48px rgba(251,191,36,0.4); }
        }

        .td-cell-bomb {
          background: linear-gradient(145deg, #ef4444, #dc2626, #b91c1c);
          box-shadow: 0 0 16px rgba(239,68,68,0.6);
          animation: td-bomb-in 0.4s ease-out;
        }

        @keyframes td-bomb-in {
          0% { transform: scale(0.5); opacity: 0; }
          40% { transform: scale(1.2); }
          70% { transform: scale(0.95); }
          100% { transform: scale(1); opacity: 1; }
        }

        .td-cell-time-gem {
          background: linear-gradient(145deg, #60a5fa, #3b82f6, #2563eb);
          box-shadow: 0 0 16px rgba(59,130,246,0.6), inset 0 2px 0 rgba(255,255,255,0.3);
          animation: td-timegem-in 0.4s ease-out, td-timegem-glow 0.5s ease-in-out 0.4s infinite alternate;
        }

        @keyframes td-timegem-in {
          0% { transform: scale(0.3) rotate(30deg); opacity: 0; }
          60% { transform: scale(1.2) rotate(-5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }

        @keyframes td-timegem-glow {
          from { box-shadow: 0 0 12px rgba(59,130,246,0.5); }
          to { box-shadow: 0 0 24px rgba(59,130,246,0.9); }
        }

        .td-cell-just-dug {
          animation: td-pop 0.35s ease-out;
        }

        .td-cell-flash-gold {
          animation: td-flash-gold 0.5s ease-out;
        }

        .td-cell-flash-red {
          animation: td-flash-red 0.5s ease-out;
        }

        .td-cell-flash-blue {
          animation: td-flash-blue 0.5s ease-out;
        }

        @keyframes td-pop {
          0% { transform: scale(0.6); }
          50% { transform: scale(1.15); }
          100% { transform: scale(1); }
        }

        @keyframes td-flash-gold {
          0% { box-shadow: 0 0 0 0 rgba(251,191,36,0.9); transform: scale(0.6); }
          40% { box-shadow: 0 0 24px 8px rgba(251,191,36,0.7); transform: scale(1.2); }
          100% { box-shadow: 0 0 16px rgba(251,191,36,0.5); transform: scale(1); }
        }

        @keyframes td-flash-red {
          0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.9); transform: scale(0.6); }
          40% { box-shadow: 0 0 24px 8px rgba(239,68,68,0.7); transform: scale(1.2); }
          100% { box-shadow: 0 0 16px rgba(239,68,68,0.5); transform: scale(1); }
        }

        @keyframes td-flash-blue {
          0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.9); transform: scale(0.6); }
          40% { box-shadow: 0 0 24px 8px rgba(59,130,246,0.7); transform: scale(1.2); }
          100% { box-shadow: 0 0 16px rgba(59,130,246,0.5); transform: scale(1); }
        }

        .td-cell-label {
          pointer-events: none;
          line-height: 1;
          filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));
        }

        /* Bottom bar */
        .td-bottom-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 6px 12px 10px;
          gap: 8px;
          flex-shrink: 0;
          background: rgba(0,0,0,0.1);
        }

        .td-hint-btn {
          font-size: 12px;
          font-weight: 800;
          padding: 6px 12px;
          border-radius: 8px;
          border: 2px solid;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;
        }

        .td-hint-ready {
          background: linear-gradient(135deg, #fbbf24, #f59e0b);
          border-color: #d97706;
          color: #78350f;
          box-shadow: 0 2px 8px rgba(251,191,36,0.4);
        }

        .td-hint-ready:active {
          transform: scale(0.93);
        }

        .td-hint-cooldown {
          background: rgba(255,255,255,0.1);
          border-color: rgba(255,255,255,0.2);
          color: rgba(254,243,199,0.4);
          cursor: default;
        }

        .td-legend {
          display: flex;
          gap: 8px;
          font-size: 11px;
          font-weight: 700;
          color: rgba(254,243,199,0.7);
          flex-wrap: wrap;
          justify-content: center;
        }

        .td-exit-btn {
          background: rgba(255,255,255,0.15);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 8px;
          color: #fef3c7;
          font-size: 12px;
          font-weight: 700;
          padding: 6px 14px;
          cursor: pointer;
        }

        .td-exit-btn:active {
          transform: scale(0.93);
          background: rgba(255,255,255,0.25);
        }

        /* Ambient dirt particles in background */
        .td-panel::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0; bottom: 0;
          background-image:
            radial-gradient(circle at 15% 25%, rgba(251,191,36,0.08) 1px, transparent 1px),
            radial-gradient(circle at 85% 15%, rgba(251,191,36,0.06) 1px, transparent 1px),
            radial-gradient(circle at 45% 65%, rgba(251,191,36,0.05) 1px, transparent 1px),
            radial-gradient(circle at 75% 80%, rgba(251,191,36,0.07) 1px, transparent 1px);
          background-size: 100% 100%;
          pointer-events: none;
          z-index: 0;
        }

        .td-panel > * {
          position: relative;
          z-index: 1;
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
