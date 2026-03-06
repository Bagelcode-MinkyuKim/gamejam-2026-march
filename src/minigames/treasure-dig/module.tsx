import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import shieldSfx from '../../../assets/sounds/treasure-dig-shield.mp3'
import mapRevealSfx from '../../../assets/sounds/treasure-dig-map.mp3'
import chainSfx from '../../../assets/sounds/treasure-dig-chain.mp3'
import luckySfx from '../../../assets/sounds/treasure-dig-lucky.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Pixel Art Image Imports ────────────────────────────────
import gemImg from '../../../assets/images/treasure-dig/gem.png'
import crownImg from '../../../assets/images/treasure-dig/crown.png'
import bombImg from '../../../assets/images/treasure-dig/bomb.png'
import timeGemImg from '../../../assets/images/treasure-dig/time-gem.png'
import dirtBlockImg from '../../../assets/images/treasure-dig/dirt-block.png'
import shovelImg from '../../../assets/images/treasure-dig/shovel.png'
import shieldItemImg from '../../../assets/images/treasure-dig/shield.png'
import mapItemImg from '../../../assets/images/treasure-dig/map.png'
import chainImg from '../../../assets/images/treasure-dig/chain.png'
import luckyImg from '../../../assets/images/treasure-dig/lucky.png'
// ─── Pixel Art Emoji fallbacks (for particles/bonus text) ───
const PIXEL_PICKAXE = '\u{26CF}\uFE0F'
const PIXEL_GEM = '\u{1F48E}'
const PIXEL_CROWN = '\u{1F451}'
const PIXEL_BOMB = '\u{1F4A3}'
const PIXEL_CLOCK = '\u{23F0}'
const PIXEL_SHIELD = '\u{1F6E1}\uFE0F'
const PIXEL_MAP = '\u{1F5FA}\uFE0F'
const PIXEL_CHAIN = '\u{26A1}'
const PIXEL_CLOVER = '\u{1F340}'

// ─── Game Config ────────────────────────────────────────────
const ROUND_DURATION_MS = 50000
const GRID_SIZE = 5
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const BASE_TREASURE_COUNT = 3
const BASE_BOMB_COUNT = 2
const BASE_TREASURE_SCORE = 35
const BOMB_PENALTY = 20
const LOW_TIME_THRESHOLD_MS = 8000
const DIG_FEEDBACK_DURATION_MS = 500
const MAX_BOMB_HITS = 3

// ─── Gimmick constants ─────────────────────────────────────
const GOLDEN_TREASURE_CHANCE = 0.12
const GOLDEN_TREASURE_SCORE = 150
const COMBO_DIG_WINDOW_MS = 2500
const COMBO_DIG_MULTIPLIER = 0.5
const DEPTH_BONUS_PER_LEVEL = 20
const TIME_BONUS_PER_CLEAR_MS = 4500
const FEVER_THRESHOLD = 3
const FEVER_DURATION_MS = 5000
const FEVER_MULTIPLIER = 2.5

// ─── Hint System ───────────────────────────────────────────
const HINT_COOLDOWN_MS = 10000
const HINT_FLASH_DURATION_MS = 1800

// ─── Power-ups ─────────────────────────────────────────────
const SHOVEL_CLEAR_COUNT = 3
const XRAY_DURATION_MS = 2500
const TIME_GEM_CHANCE = 0.1
const TIME_GEM_BONUS_MS = 5000

// ─── New: Items ────────────────────────────────────────────
const CHAIN_DIG_ADJACENT = 2
const LUCKY_CHARM_DURATION_MS = 8000
const LUCKY_CHARM_GOLDEN_BOOST = 0.3

type CellContent = 'empty' | 'treasure' | 'bomb' | 'golden' | 'time-gem'
type CellState = 'hidden' | 'revealed'
type ItemType = 'shovel' | 'xray' | 'shield' | 'map' | 'chain' | 'lucky' | null

const ITEM_POOL: { type: ItemType; weight: number; minDepth: number }[] = [
  { type: 'shovel', weight: 25, minDepth: 1 },
  { type: 'xray', weight: 20, minDepth: 2 },
  { type: 'shield', weight: 20, minDepth: 1 },
  { type: 'map', weight: 15, minDepth: 2 },
  { type: 'chain', weight: 12, minDepth: 3 },
  { type: 'lucky', weight: 8, minDepth: 4 },
]

function rollItem(depth: number): ItemType {
  const eligible = ITEM_POOL.filter((i) => depth >= i.minDepth)
  if (eligible.length === 0 || Math.random() > 0.45) return null
  const totalWeight = eligible.reduce((s, i) => s + i.weight, 0)
  let roll = Math.random() * totalWeight
  for (const item of eligible) {
    roll -= item.weight
    if (roll <= 0) return item.type
  }
  return null
}

const ITEM_INFO: Record<string, { icon: string; img: string; label: string; color: string }> = {
  shovel: { icon: PIXEL_PICKAXE, img: shovelImg, label: 'SHOVEL', color: '#a16207' },
  xray: { icon: '\u{1F50D}', img: gemImg, label: 'X-RAY', color: '#2563eb' },
  shield: { icon: PIXEL_SHIELD, img: shieldItemImg, label: 'SHIELD', color: '#059669' },
  map: { icon: PIXEL_MAP, img: mapItemImg, label: 'MAP', color: '#7c3aed' },
  chain: { icon: PIXEL_CHAIN, img: chainImg, label: 'CHAIN', color: '#dc2626' },
  lucky: { icon: PIXEL_CLOVER, img: luckyImg, label: 'LUCKY', color: '#16a34a' },
}

interface Cell {
  content: CellContent
  state: CellState
  adjacentTreasures: number
  hintFlashing: boolean
  chainRevealing: boolean
}

function createBoard(depth: number, goldenBoost = 0): Cell[] {
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
    chainRevealing: false,
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
    const goldenChance = GOLDEN_TREASURE_CHANCE + depth * 0.015 + goldenBoost
    const isGolden = Math.random() < goldenChance
    cells[indices[placed]].content = isGolden ? 'golden' : 'treasure'
    placed += 1
  }
  for (let i = 0; i < actualBombs; i += 1) {
    cells[indices[placed]].content = 'bomb'
    placed += 1
  }
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

function getAdjacents(idx: number): number[] {
  const row = Math.floor(idx / GRID_SIZE)
  const col = idx % GRID_SIZE
  const result: number[] = []
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if (dr === 0 && dc === 0) continue
      const nr = row + dr
      const nc = col + dc
      if (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE) {
        result.push(nr * GRID_SIZE + nc)
      }
    }
  }
  return result
}

// ─── Component ──────────────────────────────────────────────
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
  const [pendingItem, setPendingItem] = useState<ItemType>(null)
  const [depthTransition, setDepthTransition] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [isLuckyActive, setIsLuckyActive] = useState(false)
  const [luckyMs, setLuckyMs] = useState(0)
  const [hasChain, setHasChain] = useState(false)
  const [shieldFlash, setShieldFlash] = useState(false)
  const [bombsHit, setBombsHit] = useState(0)

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
  const hasShieldRef = useRef(false)
  const isLuckyRef = useRef(false)
  const luckyMsRef = useRef(0)
  const hasChainRef = useRef(false)
  const totalDigsRef = useRef(0)
  const bombsHitRef = useRef(0)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})

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
    }, 1600)
  }, [])

  const resetBoard = useCallback(() => {
    const nextDepth = depthRef.current + 1
    depthRef.current = nextDepth
    setDepth(nextDepth)
    setDepthTransition(true)
    setTimeout(() => setDepthTransition(false), 700)

    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_CLEAR_MS)

    const depthBonus = DEPTH_BONUS_PER_LEVEL * nextDepth
    scoreRef.current += depthBonus
    setScore(scoreRef.current)

    const item = rollItem(nextDepth)
    if (item) setPendingItem(item)

    showBonusText(`DEPTH ${nextDepth}! +${depthBonus}pts +${(TIME_BONUS_PER_CLEAR_MS / 1000).toFixed(0)}s`)
    playAudio('depthClear', 0.7)
    effects.triggerFlash('rgba(251,191,36,0.35)')

    const goldenBoost = isLuckyRef.current ? LUCKY_CHARM_GOLDEN_BOOST : 0
    const nextBoard = createBoard(nextDepth, goldenBoost)
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
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  // ─── Item Activation ─────────────────────────────────────
  const activateItem = useCallback((item: ItemType) => {
    if (!item || finishedRef.current) return
    setPendingItem(null)

    if (item === 'shovel') {
      playAudio('dig', 0.6, 0.8)
      const cur = boardRef.current
      const empties: number[] = []
      cur.forEach((c, i) => { if (c.state === 'hidden' && c.content === 'empty') empties.push(i) })
      for (let i = empties.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        const t = empties[i]; empties[i] = empties[j]; empties[j] = t
      }
      const toClear = empties.slice(0, SHOVEL_CLEAR_COUNT)
      const next = cur.map((c, idx) => toClear.includes(idx) ? { ...c, state: 'revealed' as CellState } : c)
      boardRef.current = next
      setBoard(next)
      showBonusText(`${PIXEL_PICKAXE} SHOVEL! ${toClear.length} dug!`)
    } else if (item === 'xray') {
      playAudio('hint', 0.6, 1.3)
      isXrayRef.current = true
      xrayTimerRef.current = XRAY_DURATION_MS
      setIsXrayActive(true)
      showBonusText(`\u{1F50D} X-RAY VISION!`)
    } else if (item === 'shield') {
      playAudio('shield', 0.7)
      hasShieldRef.current = true
      setHasShield(true)
      showBonusText(`${PIXEL_SHIELD} SHIELD ON!`)
    } else if (item === 'map') {
      playAudio('mapReveal', 0.6)
      const cur = boardRef.current
      const hiddenTreasures: number[] = []
      cur.forEach((c, i) => {
        if (c.state === 'hidden' && (c.content === 'treasure' || c.content === 'golden')) hiddenTreasures.push(i)
      })
      if (hiddenTreasures.length > 0) {
        const revealIdx = hiddenTreasures[Math.floor(Math.random() * hiddenTreasures.length)]
        const next = cur.map((c, i) => i === revealIdx ? { ...c, hintFlashing: true } : c)
        boardRef.current = next
        setBoard(next)
        setTimeout(() => {
          const restored = boardRef.current.map((c) => ({ ...c, hintFlashing: false }))
          boardRef.current = restored
          setBoard(restored)
        }, 3000)
      }
      showBonusText(`${PIXEL_MAP} TREASURE SPOTTED!`)
    } else if (item === 'chain') {
      playAudio('chain', 0.7)
      hasChainRef.current = true
      setHasChain(true)
      showBonusText(`${PIXEL_CHAIN} CHAIN DIG!`)
    } else if (item === 'lucky') {
      playAudio('lucky', 0.7)
      isLuckyRef.current = true
      luckyMsRef.current = LUCKY_CHARM_DURATION_MS
      setIsLuckyActive(true)
      setLuckyMs(LUCKY_CHARM_DURATION_MS)
      showBonusText(`${PIXEL_CLOVER} LUCKY CHARM!`)
    }
  }, [playAudio, showBonusText])

  // ─── Hint ────────────────────────────────────────────────
  const activateHint = useCallback(() => {
    if (hintCooldownRef.current > 0 || finishedRef.current) return
    hintCooldownRef.current = HINT_COOLDOWN_MS
    setHintCooldownMs(HINT_COOLDOWN_MS)
    playAudio('hint', 0.5)

    const cur = boardRef.current
    const hinted = cur.map((cell) => {
      if (cell.state === 'hidden' && cell.adjacentTreasures > 0) return { ...cell, hintFlashing: true }
      return cell
    })
    boardRef.current = hinted
    setBoard(hinted)

    setTimeout(() => {
      const restored = boardRef.current.map((c) => ({ ...c, hintFlashing: false }))
      boardRef.current = restored
      setBoard(restored)
    }, HINT_FLASH_DURATION_MS)
  }, [playAudio])

  // ─── Cell Tap ────────────────────────────────────────────
  const handleCellTap = useCallback(
    (cellIndex: number) => {
      if (finishedRef.current) return
      const currentBoard = boardRef.current
      const cell = currentBoard[cellIndex]
      if (cell.state === 'revealed') return

      totalDigsRef.current += 1

      let nextBoard = currentBoard.map((c, i) =>
        i === cellIndex ? { ...c, state: 'revealed' as CellState, hintFlashing: false, chainRevealing: false } : c,
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

      if (timeSinceLastDig < COMBO_DIG_WINDOW_MS) {
        comboRef.current += 1
      } else {
        comboRef.current = 1
      }
      setCombo(comboRef.current)
      if (comboRef.current > maxComboRef.current) maxComboRef.current = comboRef.current

      const comboMult = 1 + (comboRef.current - 1) * COMBO_DIG_MULTIPLIER
      const feverMult = isFeverRef.current ? FEVER_MULTIPLIER : 1
      const col = cellIndex % GRID_SIZE
      const row = Math.floor(cellIndex / GRID_SIZE)
      const px = col * 80 + 40
      const py = row * 80 + 240

      const maybeCheckClear = (b: Cell[]) => {
        const rem = b.filter((c) => (c.content === 'treasure' || c.content === 'golden') && c.state === 'hidden').length
        if (rem === 0) resetBoard()
      }

      // Chain dig helper
      const doChainDig = (b: Cell[]): Cell[] => {
        if (!hasChainRef.current) return b
        hasChainRef.current = false
        setHasChain(false)
        playAudio('chain', 0.5, 1.2)

        const adjacents = getAdjacents(cellIndex)
        const emptyAdj = adjacents.filter((i) => b[i].state === 'hidden' && b[i].content === 'empty')
        for (let i = emptyAdj.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1))
          const t = emptyAdj[i]; emptyAdj[i] = emptyAdj[j]; emptyAdj[j] = t
        }
        const toReveal = emptyAdj.slice(0, CHAIN_DIG_ADJACENT)
        if (toReveal.length > 0) {
          const chained = b.map((c, i) =>
            toReveal.includes(i) ? { ...c, state: 'revealed' as CellState, chainRevealing: true } : c,
          )
          // Clear chain animation after delay
          setTimeout(() => {
            const cleared = boardRef.current.map((c) => ({ ...c, chainRevealing: false }))
            boardRef.current = cleared
            setBoard(cleared)
          }, 600)
          return chained
        }
        return b
      }

      if (cell.content === 'golden') {
        const goldenScore = Math.round(GOLDEN_TREASURE_SCORE * comboMult * feverMult)
        scoreRef.current += goldenScore
        setScore(scoreRef.current)
        treasuresFoundRef.current += 1
        setTreasuresFound(treasuresFoundRef.current)
        consecutiveTreasuresRef.current += 1
        setLastDigKind('golden')
        showBonusText(`${PIXEL_CROWN} GOLDEN! +${goldenScore}`)
        playAudio('goldenFound', 0.8)
        if (comboRef.current > 2) playAudio('combo', 0.5, 1 + comboRef.current * 0.1)
        effects.comboHitBurst(px, py, consecutiveTreasuresRef.current, goldenScore, [PIXEL_CROWN, PIXEL_GEM, '\u{2728}', '\u{1F31F}'])
        effects.triggerFlash('rgba(251,191,36,0.3)')

        if (consecutiveTreasuresRef.current >= FEVER_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playAudio('fever', 0.7)
        }

        nextBoard = doChainDig(nextBoard)
        boardRef.current = nextBoard
        setBoard(nextBoard)
        maybeCheckClear(nextBoard)
      } else if (cell.content === 'treasure') {
        const treasureScore = Math.round(BASE_TREASURE_SCORE * comboMult * feverMult)
        scoreRef.current += treasureScore
        setScore(scoreRef.current)
        treasuresFoundRef.current += 1
        setTreasuresFound(treasuresFoundRef.current)
        consecutiveTreasuresRef.current += 1
        setLastDigKind('treasure')
        playAudio('treasureFound', 0.7)
        if (comboRef.current > 2) {
          playAudio('combo', 0.4, 1 + comboRef.current * 0.1)
          showBonusText(`+${treasureScore} COMBO x${comboMult.toFixed(1)}!`)
        }
        effects.spawnParticles(6, px, py, [PIXEL_GEM, '\u{2728}', '\u{1F4B0}'])
        effects.showScorePopup(treasureScore, px, py - 25)

        if (consecutiveTreasuresRef.current >= FEVER_THRESHOLD && !isFeverRef.current) {
          isFeverRef.current = true
          feverMsRef.current = FEVER_DURATION_MS
          setIsFever(true)
          setFeverMs(FEVER_DURATION_MS)
          playAudio('fever', 0.7)
        }

        nextBoard = doChainDig(nextBoard)
        boardRef.current = nextBoard
        setBoard(nextBoard)
        maybeCheckClear(nextBoard)
      } else if (cell.content === 'time-gem') {
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_GEM_BONUS_MS)
        setLastDigKind('time-gem')
        playAudio('goldenFound', 0.6, 1.5)
        showBonusText(`${PIXEL_CLOCK} TIME GEM! +${(TIME_GEM_BONUS_MS / 1000).toFixed(0)}s`)
        effects.spawnParticles(7, px, py, [PIXEL_CLOCK, '\u{1F552}', '\u{2728}', '\u{1F4AB}'])
        effects.triggerFlash('rgba(59,130,246,0.3)')
      } else if (cell.content === 'bomb') {
        if (hasShieldRef.current) {
          // Shield absorbs the bomb!
          hasShieldRef.current = false
          setHasShield(false)
          setShieldFlash(true)
          setTimeout(() => setShieldFlash(false), 600)
          playAudio('shield', 0.8, 0.7)
          showBonusText(`${PIXEL_SHIELD} BLOCKED!`)
          effects.spawnParticles(4, px, py, [PIXEL_SHIELD, '\u{2728}'])
          effects.triggerFlash('rgba(5,150,105,0.3)')
          consecutiveTreasuresRef.current = 0
          setLastDigKind('bomb')
        } else {
          const penalty = Math.round(BOMB_PENALTY * (1 + depthRef.current * 0.1))
          scoreRef.current = Math.max(0, scoreRef.current - penalty)
          setScore(scoreRef.current)
          consecutiveTreasuresRef.current = 0
          bombsHitRef.current += 1
          setBombsHit(bombsHitRef.current)
          setLastDigKind('bomb')
          playAudio('bomb', 0.7)
          effects.triggerShake(10)
          effects.triggerFlash('rgba(239,68,68,0.55)')
          effects.spawnParticles(8, px, py, [PIXEL_BOMB, '\u{1F4A5}', '\u{1F525}', '\u{1F4AB}'])
          effects.showScorePopup(-penalty, px, py - 25)
          if (bombsHitRef.current >= MAX_BOMB_HITS) {
            showBonusText(`${PIXEL_BOMB} BOOM! GAME OVER!`)
            setTimeout(() => finishGame(), 600)
            return
          }
        }
      } else {
        setLastDigKind('empty')
        consecutiveTreasuresRef.current = 0
        playAudio('dig', 0.4, 0.85 + Math.random() * 0.3)
        effects.spawnParticles(2, px, py, ['\u{1F4A8}'])
      }
    },
    [playAudio, showBonusText, effects, resetBoard],
  )

  const handleExit = useCallback(() => { onExit() }, [onExit])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); handleExit() }
      if (e.code === 'KeyH') { e.preventDefault(); activateHint() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleExit, activateHint])

  useEffect(() => {
    const sfxMap: Record<string, string> = {
      dig: digSfx, treasureFound: treasureFoundSfx, goldenFound: goldenFoundSfx,
      bomb: bombSfx, combo: comboSfx, fever: feverSfx,
      depthClear: depthClearSfx, hint: hintSfx, gameOver: gameOverHitSfx,
      shield: shieldSfx, mapReveal: mapRevealSfx, chain: chainSfx, lucky: luckySfx,
    }
    for (const [key, src] of Object.entries(sfxMap)) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }
    return () => {
      clearTimeoutSafe(digFeedbackTimerRef)
      clearTimeoutSafe(bonusTextTimerRef)
      for (const key of Object.keys(audioRefs.current)) audioRefs.current[key] = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    // Track displayed values to avoid unnecessary setState calls
    let prevDisplayedRemaining = Math.floor(remainingMsRef.current / 100)
    let prevDisplayedFever = Math.floor(feverMsRef.current / 100)
    let prevDisplayedLucky = Math.floor(luckyMsRef.current / 1000)

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // Update timer ref every frame, but only setState when display changes
      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      const curDisplayedRemaining = Math.floor(remainingMsRef.current / 100)
      if (curDisplayedRemaining !== prevDisplayedRemaining) {
        prevDisplayedRemaining = curDisplayedRemaining
        setRemainingMs(remainingMsRef.current)
      }

      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        const curDisplayedFever = Math.floor(feverMsRef.current / 100)
        if (curDisplayedFever !== prevDisplayedFever) {
          prevDisplayedFever = curDisplayedFever
          setFeverMs(feverMsRef.current)
        }
        if (feverMsRef.current <= 0) { isFeverRef.current = false; setIsFever(false) }
      }

      if (hintCooldownRef.current > 0) {
        hintCooldownRef.current = Math.max(0, hintCooldownRef.current - deltaMs)
      }

      if (isXrayRef.current) {
        xrayTimerRef.current = Math.max(0, xrayTimerRef.current - deltaMs)
        if (xrayTimerRef.current <= 0) { isXrayRef.current = false; setIsXrayActive(false) }
      }

      if (isLuckyRef.current) {
        luckyMsRef.current = Math.max(0, luckyMsRef.current - deltaMs)
        const curDisplayedLucky = Math.floor(luckyMsRef.current / 1000)
        if (curDisplayedLucky !== prevDisplayedLucky) {
          prevDisplayedLucky = curDisplayedLucky
          setLuckyMs(luckyMsRef.current)
        }
        if (luckyMsRef.current <= 0) { isLuckyRef.current = false; setIsLuckyActive(false) }
      }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); animationFrameRef.current = null; return }
      animationFrameRef.current = window.requestAnimationFrame(step)
    }
    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
      lastFrameAtRef.current = null
    }
  }, [finishGame, effects])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const timerPercent = remainingMs / ROUND_DURATION_MS
  void hintCooldownMs

  const getCellClass = (cell: Cell, index: number): string => {
    const cls = ['td-cell']
    if (cell.state === 'hidden') {
      cls.push('td-hidden')
      if (cell.hintFlashing) cls.push('td-hint')
      if (isXrayActive && (cell.content === 'treasure' || cell.content === 'golden')) cls.push('td-xray')
    } else {
      cls.push('td-open')
      if (cell.content === 'golden') cls.push('td-golden')
      else if (cell.content === 'treasure') cls.push('td-treasure')
      else if (cell.content === 'bomb') cls.push('td-bomb')
      else if (cell.content === 'time-gem') cls.push('td-time')
      else cls.push('td-empty')
      if (cell.chainRevealing) cls.push('td-chain-reveal')
    }
    if (lastDigIndex === index) {
      cls.push('td-dug')
      if (lastDigKind === 'treasure' || lastDigKind === 'golden') cls.push('td-dug-gold')
      if (lastDigKind === 'bomb') cls.push('td-dug-red')
      if (lastDigKind === 'time-gem') cls.push('td-dug-blue')
    }
    return cls.join(' ')
  }

  const getCellIcon = (cell: Cell): ReactNode => {
    if (cell.state === 'hidden') return null
    if (cell.content === 'golden') return <img src={crownImg} alt="" className="td-cell-img" />
    if (cell.content === 'treasure') return <img src={gemImg} alt="" className="td-cell-img" />
    if (cell.content === 'bomb') return <img src={bombImg} alt="" className="td-cell-img" />
    if (cell.content === 'time-gem') return <img src={timeGemImg} alt="" className="td-cell-img" />
    if (cell.adjacentTreasures > 0) return String(cell.adjacentTreasures)
    return null
  }

  const adjColor = (n: number) => n === 1 ? '#60a5fa' : n === 2 ? '#4ade80' : n === 3 ? '#f87171' : '#c084fc'

  // Active buffs indicator
  const activeBuffs: { img: string; label: string; color: string }[] = []
  if (hasShield) activeBuffs.push({ img: shieldItemImg, label: 'SHIELD', color: '#059669' })
  if (hasChain) activeBuffs.push({ img: chainImg, label: 'CHAIN', color: '#dc2626' })
  if (isLuckyActive) activeBuffs.push({ img: luckyImg, label: `LUCKY ${(luckyMs / 1000).toFixed(0)}s`, color: '#16a34a' })
  if (isXrayActive) activeBuffs.push({ img: gemImg, label: 'X-RAY', color: '#2563eb' })

  return (
    <section
      className={`td ${isFever ? 'td-fever' : ''} ${depthTransition ? 'td-depth-in' : ''} ${shieldFlash ? 'td-shield-flash' : ''}`}
      aria-label="treasure-dig-game"
      style={{ ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* CRT scanlines overlay */}
      <div className="td-scanlines" />

      {/* Timer bar */}
      <div className="td-tbar-wrap">
        <div className={`td-tbar ${isLowTime ? 'td-tbar-low' : ''}`} style={{ width: `${timerPercent * 100}%` }} />
        <span className="td-tbar-label">{(remainingMs / 1000).toFixed(1)}s</span>
      </div>

      {/* Header */}
      <div className="td-hdr">
        <div className="td-hdr-top">
          <span className="td-depth-badge">D{depth}</span>
          <p className="td-pts">{score.toLocaleString()}</p>
          <span className="td-gem-count"><img src={gemImg} alt="" className="td-hdr-gem-img" />{treasuresFound}</span>
        </div>
        <div className="td-hdr-sub">
          <p className="td-best">BEST {displayedBestScore.toLocaleString()}</p>
          <span className="td-lives">
            <img src={bombImg} alt="" className="td-life-bomb-icon" />
            <span className={`td-life-count ${MAX_BOMB_HITS - bombsHit <= 1 ? 'td-life-danger' : ''}`}>
              x{MAX_BOMB_HITS - bombsHit}
            </span>
          </span>
        </div>
      </div>

      {/* Active buffs */}
      {activeBuffs.length > 0 && (
        <div className="td-buffs">
          {activeBuffs.map((b, i) => (
            <span key={i} className="td-buff" style={{ borderColor: b.color, color: b.color }}>
              <img src={b.img} alt="" className="td-buff-img" /> {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Combo / Fever bar */}
      <div className="td-info-row">
        {combo > 1 && (
          <span className="td-combo">COMBO x{(1 + (combo - 1) * COMBO_DIG_MULTIPLIER).toFixed(1)}</span>
        )}
        {isFever && (
          <span className="td-fever-label">
            FEVER x{FEVER_MULTIPLIER} [{(feverMs / 1000).toFixed(1)}s]
          </span>
        )}
      </div>

      {/* Bonus text */}
      {lastBonusText && <p className="td-bonus">{lastBonusText}</p>}

      {/* Item notification */}
      {pendingItem && (
        <div className="td-item-bar">
          <button className="td-item-btn" type="button" onClick={() => activateItem(pendingItem)}
            style={{ borderColor: ITEM_INFO[pendingItem]?.color, background: `${ITEM_INFO[pendingItem]?.color}22` }}>
            <img src={ITEM_INFO[pendingItem]?.img} alt="" className="td-item-icon-img" />
            <span className="td-item-name">{ITEM_INFO[pendingItem]?.label}</span>
            <span className="td-item-tap">TAP!</span>
          </button>
        </div>
      )}

      {/* Grid */}
      <div className={`td-grid ${isFever ? 'td-grid-fever' : ''}`}>
        {board.map((cell, index) => (
          <button
            className={getCellClass(cell, index)}
            key={index}
            type="button"
            onClick={() => handleCellTap(index)}
            disabled={cell.state === 'revealed'}
          >
            <span className="td-icon"
              style={cell.state === 'revealed' && cell.content === 'empty' && cell.adjacentTreasures > 0
                ? { color: adjColor(cell.adjacentTreasures) } : undefined}
            >
              {getCellIcon(cell)}
            </span>
          </button>
        ))}
      </div>

      {/* Bottom */}
      <div className="td-bot">
        <div className="td-legend">
          <span><img src={gemImg} alt="" className="td-legend-img" />+{BASE_TREASURE_SCORE}</span>
          <span><img src={crownImg} alt="" className="td-legend-img" />+{GOLDEN_TREASURE_SCORE}</span>
          <span><img src={bombImg} alt="" className="td-legend-img" />-{BOMB_PENALTY}</span>
          <span><img src={timeGemImg} alt="" className="td-legend-img" />+{(TIME_GEM_BONUS_MS / 1000).toFixed(0)}s</span>
        </div>
      </div>

      <style>{`
        /* ═══════════════════════════════════════════
           PIXEL ART THEME
           ═══════════════════════════════════════════ */

        .td {
          display: flex;
          flex-direction: column;
          align-items: center;
          max-width: 432px;
          height: 100%;
          margin: 0 auto;
          overflow: hidden;
          position: relative;
          user-select: none;
          -webkit-user-select: none;
          background: #2d1b0e;
          background-image:
            linear-gradient(180deg, #1a0f06 0%, #3d2211 20%, #5c3a1e 50%, #4a2e14 80%, #2d1b0e 100%);
          font-family: 'DungGeunMo', 'Press Start 2P', monospace;
          image-rendering: pixelated;
        }

        /* CRT scanlines */
        .td-scanlines {
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            rgba(0,0,0,0.08) 2px,
            rgba(0,0,0,0.08) 4px
          );
          pointer-events: none;
          z-index: 10;
        }

        .td > * { position: relative; z-index: 1; }

        /* Fever mode */
        .td-fever {
          animation: td-fv-bg 0.25s ease-in-out infinite alternate;
        }
        @keyframes td-fv-bg {
          from { filter: brightness(1) hue-rotate(0deg); }
          to { filter: brightness(1.15) hue-rotate(5deg); }
        }

        .td-depth-in {
          animation: td-dp-flash 0.7s ease-out;
        }
        @keyframes td-dp-flash {
          0% { filter: brightness(2) saturate(0.5); }
          100% { filter: brightness(1) saturate(1); }
        }

        .td-shield-flash {
          animation: td-sh-flash 0.6s ease-out;
        }
        @keyframes td-sh-flash {
          0% { box-shadow: inset 0 0 60px rgba(5,150,105,0.8); }
          100% { box-shadow: inset 0 0 0 transparent; }
        }

        /* ── Timer bar ── */
        .td-tbar-wrap {
          width: 100%;
          height: 32px;
          background: #1a0f06;
          border-bottom: 2px solid #5c3a1e;
          position: relative;
          flex-shrink: 0;
        }
        .td-tbar {
          height: 100%;
          background: linear-gradient(90deg, #22c55e, #84cc16, #eab308);
          transition: width 0.15s linear;
          image-rendering: pixelated;
        }
        .td-tbar-low {
          background: linear-gradient(90deg, #ef4444, #f97316);
          animation: td-tbar-pulse 0.35s steps(2) infinite;
        }
        @keyframes td-tbar-pulse {
          0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; }
        }
        .td-tbar-label {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 18px;
          font-weight: 900;
          color: #fef3c7;
          text-shadow: 1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000;
          letter-spacing: 0px;
        }

        /* ── Header ── */
        .td-hdr {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          padding: 8px 12px 6px;
          flex-shrink: 0;
          border-bottom: 2px solid #5c3a1e;
          background: rgba(0,0,0,0.2);
        }
        .td-hdr-top {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
        }
        .td-pts {
          font-size: clamp(48px, 14vw, 72px);
          font-weight: 900;
          color: #fbbf24;
          margin: 0;
          text-shadow: 3px 3px 0 #78350f, 0 0 16px rgba(251,191,36,0.5);
          line-height: 1;
          letter-spacing: 1px;
          text-align: center;
        }
        .td-hdr-sub {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
        }
        .td-best {
          font-size: 16px;
          font-weight: 700;
          color: #92400e;
          margin: 2px 0 0;
          letter-spacing: 0px;
          text-align: center;
        }
        .td-depth-badge {
          background: #7c3aed;
          color: white;
          font-size: 22px;
          font-weight: 900;
          padding: 6px 14px;
          border: 2px solid #a855f7;
          letter-spacing: 0px;
        }
        .td-gem-count {
          font-size: 24px;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 1px 1px 0 #000;
          display: flex;
          align-items: center;
          gap: 2px;
        }

        /* ── Active buffs ── */
        .td-buffs {
          display: flex;
          gap: 6px;
          padding: 3px 12px;
          width: 100%;
          justify-content: center;
          flex-shrink: 0;
        }
        .td-buff {
          font-size: 16px;
          font-weight: 900;
          padding: 4px 10px;
          border: 2px solid;
          background: rgba(0,0,0,0.3);
          animation: td-buff-pulse 0.5s steps(2) infinite;
          letter-spacing: 0px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        @keyframes td-buff-pulse {
          0% { opacity: 1; } 50% { opacity: 0.7; } 100% { opacity: 1; }
        }

        /* ── Info row ── */
        .td-info-row {
          display: flex;
          gap: 12px;
          justify-content: center;
          width: 100%;
          min-height: 18px;
          flex-shrink: 0;
        }
        .td-combo {
          font-size: 24px;
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 1px 1px 0 #000;
          animation: td-combo-pop 0.3s steps(3);
          letter-spacing: 0px;
        }
        @keyframes td-combo-pop {
          0% { transform: scale(1.6); } 100% { transform: scale(1); }
        }
        .td-fever-label {
          font-size: 24px;
          font-weight: 900;
          color: #ef4444;
          text-shadow: 0 0 8px rgba(239,68,68,0.8), 1px 1px 0 #000;
          animation: td-fv-txt 0.2s steps(2) infinite;
          letter-spacing: 0px;
        }
        @keyframes td-fv-txt {
          0% { color: #ef4444; } 50% { color: #fbbf24; } 100% { color: #ef4444; }
        }

        /* ── Bonus text ── */
        .td-bonus {
          margin: 4px 0;
          font-size: clamp(20px, 6vw, 28px);
          font-weight: 900;
          color: #fbbf24;
          text-shadow: 2px 2px 0 #78350f, 0 0 16px rgba(251,191,36,0.8);
          text-align: center;
          animation: td-bonus-in 0.5s steps(4);
          flex-shrink: 0;
          letter-spacing: 0px;
        }
        @keyframes td-bonus-in {
          0% { transform: scale(0.2) translateY(15px); opacity: 0; }
          50% { transform: scale(1.3) translateY(-5px); opacity: 1; }
          100% { transform: scale(1) translateY(0); }
        }

        /* ── Item bar ── */
        .td-item-bar {
          width: 100%;
          padding: 3px 12px;
          display: flex;
          justify-content: center;
          flex-shrink: 0;
        }
        .td-item-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 18px;
          border: 3px solid;
          color: #fef3c7;
          cursor: pointer;
          font-family: inherit;
          animation: td-item-pulse 0.4s steps(2) infinite alternate;
        }
        @keyframes td-item-pulse {
          from { transform: scale(1); filter: brightness(1); }
          to { transform: scale(1.04); filter: brightness(1.2); }
        }
        .td-item-btn:active { transform: scale(0.92) !important; }
        .td-item-icon { font-size: 22px; }
        .td-item-name { font-size: 20px; font-weight: 900; letter-spacing: 0px; }
        .td-item-tap { font-size: 16px; font-weight: 700; opacity: 0.7; }

        /* ── Grid ── */
        .td-grid {
          display: grid;
          grid-template-columns: repeat(${GRID_SIZE}, 1fr);
          gap: clamp(4px, 1.2vw, 6px);
          width: 100%;
          padding: 8px 10px;
          flex: 1;
          align-content: center;
          min-height: 0;
        }
        .td-grid-fever {
          animation: td-grid-fv 0.3s steps(2) infinite alternate;
        }
        @keyframes td-grid-fv {
          from { box-shadow: inset 0 0 20px rgba(239,68,68,0.2); }
          to { box-shadow: inset 0 0 40px rgba(239,68,68,0.4); }
        }

        /* ── Cells ── */
        .td-cell {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          cursor: pointer;
          font-size: clamp(30px, 8vw, 42px);
          font-weight: 900;
          font-family: inherit;
          aspect-ratio: 1;
          padding: 0;
          -webkit-tap-highlight-color: transparent;
          transition: transform 0.08s;
          image-rendering: pixelated;
        }
        .td-cell:active:not(:disabled) { transform: scale(0.85); }

        /* Hidden cell - dirt block */
        .td-hidden {
          background: url('${dirtBlockImg}') center/cover no-repeat;
          border: 3px solid;
          border-color: #b8864e #5c3a1e #5c3a1e #b8864e;
          box-shadow: inset 0 0 0 1px #6b4423, 2px 2px 0 rgba(0,0,0,0.3);
          image-rendering: pixelated;
        }
        .td-hidden:hover:not(:disabled) {
          background: #9a6b3d;
          border-color: #c99a5e #6b4423 #6b4423 #c99a5e;
        }

        /* Hint flash */
        .td-hint {
          animation: td-hint-glow 0.4s steps(2) infinite alternate;
        }
        @keyframes td-hint-glow {
          from { box-shadow: 0 0 4px #fbbf24; }
          to { box-shadow: 0 0 16px #fbbf24, 0 0 32px rgba(251,191,36,0.5); }
        }

        /* X-ray */
        .td-xray {
          animation: td-xray-p 0.3s steps(2) infinite alternate;
        }
        @keyframes td-xray-p {
          from { box-shadow: 0 0 6px rgba(59,130,246,0.5); border-color: #3b82f6 #1d4ed8 #1d4ed8 #3b82f6; }
          to { box-shadow: 0 0 18px rgba(59,130,246,0.9); border-color: #60a5fa #2563eb #2563eb #60a5fa; }
        }

        /* Revealed cells */
        .td-open { cursor: default; }

        .td-empty {
          background: #4a3f35;
          border: 2px solid #3a302a;
          color: #a8a29e;
        }

        .td-treasure {
          background: #d97706;
          border: 3px solid;
          border-color: #fbbf24 #92400e #92400e #fbbf24;
          box-shadow: 0 0 12px rgba(251,191,36,0.6);
          animation: td-treas-in 0.4s steps(4);
        }
        @keyframes td-treas-in {
          0% { transform: scale(0.3) rotate(-20deg); opacity: 0; }
          50% { transform: scale(1.2) rotate(5deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); }
        }

        .td-golden {
          background: linear-gradient(135deg, #fde68a, #fbbf24);
          border: 3px solid;
          border-color: #fef3c7 #d97706 #d97706 #fef3c7;
          box-shadow: 0 0 20px rgba(251,191,36,0.9);
          animation: td-gold-in 0.5s steps(5), td-gold-glow 0.4s steps(2) 0.5s infinite alternate;
        }
        @keyframes td-gold-in {
          0% { transform: scale(0.2) rotate(-30deg); opacity: 0; }
          40% { transform: scale(1.4) rotate(10deg); }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes td-gold-glow {
          from { box-shadow: 0 0 12px rgba(251,191,36,0.6); }
          to { box-shadow: 0 0 28px rgba(251,191,36,1), 0 0 48px rgba(251,191,36,0.4); }
        }

        .td-bomb {
          background: #b91c1c;
          border: 3px solid;
          border-color: #f87171 #7f1d1d #7f1d1d #f87171;
          box-shadow: 0 0 12px rgba(239,68,68,0.5);
          animation: td-bomb-in 0.35s steps(4);
        }
        @keyframes td-bomb-in {
          0% { transform: scale(0.4); opacity: 0; }
          30% { transform: scale(1.3); }
          60% { transform: scale(0.9); }
          100% { transform: scale(1); opacity: 1; }
        }

        .td-time {
          background: #1d4ed8;
          border: 3px solid;
          border-color: #60a5fa #1e3a8a #1e3a8a #60a5fa;
          box-shadow: 0 0 12px rgba(59,130,246,0.6);
          animation: td-time-in 0.4s steps(4), td-time-glow 0.5s steps(2) 0.4s infinite alternate;
        }
        @keyframes td-time-in {
          0% { transform: scale(0.3) rotate(20deg); opacity: 0; }
          50% { transform: scale(1.2) rotate(-5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        @keyframes td-time-glow {
          from { box-shadow: 0 0 8px rgba(59,130,246,0.5); }
          to { box-shadow: 0 0 20px rgba(59,130,246,0.9); }
        }

        .td-chain-reveal {
          animation: td-chain-fx 0.6s steps(4);
        }
        @keyframes td-chain-fx {
          0% { box-shadow: 0 0 0 0 rgba(220,38,38,0.8); transform: scale(0.5); }
          30% { box-shadow: 0 0 20px 6px rgba(220,38,38,0.6); transform: scale(1.15); }
          100% { box-shadow: none; transform: scale(1); }
        }

        /* Dig feedback */
        .td-dug { animation: td-dug-pop 0.4s steps(4); }
        @keyframes td-dug-pop {
          0% { transform: scale(0.5); } 50% { transform: scale(1.2); } 100% { transform: scale(1); }
        }
        .td-dug-gold { animation: td-dug-g 0.5s steps(4); }
        @keyframes td-dug-g {
          0% { box-shadow: 0 0 0 0 rgba(251,191,36,0.9); transform: scale(0.5); }
          40% { box-shadow: 0 0 30px 10px rgba(251,191,36,0.7); transform: scale(1.25); }
          100% { box-shadow: 0 0 12px rgba(251,191,36,0.5); transform: scale(1); }
        }
        .td-dug-red { animation: td-dug-r 0.5s steps(4); }
        @keyframes td-dug-r {
          0% { box-shadow: 0 0 0 0 rgba(239,68,68,0.9); transform: scale(0.5); }
          40% { box-shadow: 0 0 30px 10px rgba(239,68,68,0.7); transform: scale(1.25); }
          100% { box-shadow: 0 0 12px rgba(239,68,68,0.5); transform: scale(1); }
        }
        .td-dug-blue { animation: td-dug-b 0.5s steps(4); }
        @keyframes td-dug-b {
          0% { box-shadow: 0 0 0 0 rgba(59,130,246,0.9); transform: scale(0.5); }
          40% { box-shadow: 0 0 30px 10px rgba(59,130,246,0.7); transform: scale(1.25); }
          100% { box-shadow: 0 0 12px rgba(59,130,246,0.5); transform: scale(1); }
        }

        .td-icon {
          pointer-events: none;
          line-height: 1;
          text-shadow: 1px 1px 0 rgba(0,0,0,0.4);
        }
        .td-cell-img {
          width: 70%;
          height: 70%;
          object-fit: contain;
          image-rendering: pixelated;
          pointer-events: none;
          filter: drop-shadow(1px 1px 1px rgba(0,0,0,0.4));
        }
        .td-item-icon-img {
          width: 28px;
          height: 28px;
          object-fit: contain;
          image-rendering: pixelated;
        }
        .td-buff-img {
          width: 16px;
          height: 16px;
          object-fit: contain;
          image-rendering: pixelated;
          vertical-align: middle;
        }
        .td-legend-img {
          width: 16px;
          height: 16px;
          object-fit: contain;
          image-rendering: pixelated;
          vertical-align: middle;
          margin-right: 2px;
        }
        .td-lives {
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .td-life-bomb-icon {
          width: 28px;
          height: 28px;
          object-fit: contain;
          image-rendering: pixelated;
        }
        .td-life-count {
          font-size: 22px;
          font-weight: 900;
          color: #f87171;
          text-shadow: 1px 1px 0 #000;
        }
        .td-life-danger {
          color: #ef4444;
          animation: td-life-blink 0.4s steps(2) infinite;
        }
        @keyframes td-life-blink {
          0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; }
        }
        .td-hdr-gem-img {
          width: 20px;
          height: 20px;
          object-fit: contain;
          image-rendering: pixelated;
          vertical-align: middle;
          margin-right: 2px;
        }

        /* ── Bottom bar ── */
        .td-bot {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          padding: 10px 12px 12px;
          gap: 8px;
          flex-shrink: 0;
          background: rgba(0,0,0,0.3);
          border-top: 2px solid #5c3a1e;
        }
        .td-legend {
          display: flex;
          gap: 12px;
          font-size: 17px;
          font-weight: 700;
          color: #a8a29e;
          flex-wrap: wrap;
          justify-content: center;
          letter-spacing: 0px;
        }
        .td-legend span {
          display: flex;
          align-items: center;
        }
        .td-exit:active { transform: scale(0.9); background: #57534e; }

        /* ── Ambient pixel dirt ── */
        .td::before {
          content: '';
          position: absolute;
          inset: 0;
          background-image:
            radial-gradient(1px 1px at 12% 20%, rgba(251,191,36,0.15), transparent),
            radial-gradient(1px 1px at 88% 12%, rgba(251,191,36,0.1), transparent),
            radial-gradient(1px 1px at 35% 55%, rgba(139,94,52,0.2), transparent),
            radial-gradient(1px 1px at 72% 78%, rgba(251,191,36,0.12), transparent),
            radial-gradient(1px 1px at 55% 35%, rgba(139,94,52,0.15), transparent),
            radial-gradient(1px 1px at 20% 85%, rgba(251,191,36,0.08), transparent),
            radial-gradient(1px 1px at 80% 45%, rgba(139,94,52,0.12), transparent);
          pointer-events: none;
          z-index: 0;
          image-rendering: pixelated;
        }
      `}</style>
    </section>
  )
}

export const treasureDigModule: MiniGameModule = {
  manifest: {
    id: 'treasure-dig',
    title: 'Treasure Dig',
    description: 'Dig the ground to find treasure! Watch out for bombs!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#a16207',
  },
  Component: TreasureDigGame,
}
