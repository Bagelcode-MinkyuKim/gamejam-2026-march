import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import cardCatImage from '../../../assets/images/memory-flip/card-cat.png'
import cardDogImage from '../../../assets/images/memory-flip/card-dog.png'
import cardPandaImage from '../../../assets/images/memory-flip/card-panda.png'
import cardFoxImage from '../../../assets/images/memory-flip/card-fox.png'
import cardRabbitImage from '../../../assets/images/memory-flip/card-rabbit.png'
import cardPenguinImage from '../../../assets/images/memory-flip/card-penguin.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import comboMilestoneSfx from '../../../assets/sounds/combo-milestone.mp3'
import bgmLoop from '../../../assets/sounds/gameplay-bgm-loop.mp3'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// ─── Config ────────────────────────────────────────────
const ROUND_DURATION_MS = 60000
const MATCH_FLASH_DURATION_MS = 400
const MISMATCH_SHAKE_DURATION_MS = 500
const FLIP_BACK_DELAY_MS = 700
const BOARD_RESET_DELAY_MS = 600
const LOW_TIME_THRESHOLD_MS = 10000
const COMBO_WINDOW_MS = 3500
const BASE_MATCH_SCORE = 100
const COMBO_BONUS_PER_LEVEL = 50
const BOARD_CLEAR_BONUS = 500
const BOARD_CLEAR_BONUS_INCREMENT = 250
const PERFECT_CLEAR_BONUS = 300
const TIME_BONUS_PER_COMBO = 2000
const HINT_DURATION_MS = 2000
const HINT_COOLDOWN_MS = 15000

// ─── Card Pool ─────────────────────────────────────────
const CHARACTER_POOL = [
  { id: 'kim-yeonja', name: '김연자', imageSrc: kimYeonjaImage, color: '#ec4899', emoji: '🎤' },
  { id: 'park-sangmin', name: '박상민', imageSrc: parkSangminImage, color: '#ef4444', emoji: '🎸' },
  { id: 'park-wankyu', name: '박완규', imageSrc: parkWankyuImage, color: '#f59e0b', emoji: '🎵' },
  { id: 'seo-taiji', name: '서태지', imageSrc: seoTaijiImage, color: '#8b5cf6', emoji: '🎶' },
  { id: 'song-changsik', name: '송창식', imageSrc: songChangsikImage, color: '#22c55e', emoji: '🎹' },
  { id: 'tae-jina', name: '태진아', imageSrc: taeJinaImage, color: '#22d3ee', emoji: '🎷' },
  { id: 'cat', name: '고양이', imageSrc: cardCatImage, color: '#f97316', emoji: '🐱' },
  { id: 'dog', name: '강아지', imageSrc: cardDogImage, color: '#eab308', emoji: '🐶' },
  { id: 'panda', name: '판다', imageSrc: cardPandaImage, color: '#64748b', emoji: '🐼' },
  { id: 'fox', name: '여우', imageSrc: cardFoxImage, color: '#ea580c', emoji: '🦊' },
  { id: 'rabbit', name: '토끼', imageSrc: cardRabbitImage, color: '#f472b6', emoji: '🐰' },
  { id: 'penguin', name: '펭귄', imageSrc: cardPenguinImage, color: '#0ea5e9', emoji: '🐧' },
] as const

type CharacterToken = (typeof CHARACTER_POOL)[number]

interface Card {
  readonly uid: number
  readonly character: CharacterToken
  readonly pairIndex: number
}

interface BoardConfig {
  readonly cols: number
  readonly rows: number
}

const BOARD_PROGRESSION: BoardConfig[] = [
  { cols: 3, rows: 4 },
  { cols: 4, rows: 4 },
  { cols: 4, rows: 5 },
  { cols: 5, rows: 4 },
  { cols: 5, rows: 6 },
  { cols: 6, rows: 6 },
]

let globalCardId = 0

function getBoardConfig(clearCount: number): BoardConfig {
  return BOARD_PROGRESSION[Math.min(clearCount, BOARD_PROGRESSION.length - 1)]
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = temp
  }
  return shuffled
}

function createBoard(config: BoardConfig): Card[] {
  const totalCards = config.cols * config.rows
  const pairsNeeded = totalCards / 2
  const shuffledPool = shuffleArray([...CHARACTER_POOL])
  const cards: Card[] = []
  for (let p = 0; p < pairsNeeded; p++) {
    const character = shuffledPool[p % shuffledPool.length]
    cards.push({ uid: globalCardId++, character, pairIndex: p })
    cards.push({ uid: globalCardId++, character, pairIndex: p })
  }
  return shuffleArray(cards)
}

function MemoryFlipGame({ onFinish, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [boardClearCount, setBoardClearCount] = useState(0)
  const [boardConfig, setBoardConfig] = useState<BoardConfig>(() => getBoardConfig(0))
  const [cards, setCards] = useState<Card[]>(() => createBoard(getBoardConfig(0)))
  const [flippedIndices, setFlippedIndices] = useState<number[]>([])
  const [matchedPairs, setMatchedPairs] = useState<Set<number>>(new Set())
  const [matchFlashIndices, setMatchFlashIndices] = useState<Set<number>>(new Set())
  const [mismatchShakeIndices, setMismatchShakeIndices] = useState<Set<number>>(new Set())
  const [isBoardLocked, setBoardLocked] = useState(false)
  const [isBoardResetting, setBoardResetting] = useState(false)
  const [isHintActive, setIsHintActive] = useState(false)
  const [hintCooldownMs, setHintCooldownMs] = useState(0)
  const [missCount, setMissCount] = useState(0)

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const lastMatchTimeRef = useRef(0)
  const boardClearCountRef = useRef(0)
  const missCountRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const flipBackTimerRef = useRef<number | null>(null)
  const matchFlashTimerRef = useRef<number | null>(null)
  const mismatchShakeTimerRef = useRef<number | null>(null)
  const boardResetTimerRef = useRef<number | null>(null)
  const hintTimerRef = useRef<number | null>(null)
  const hintCooldownEndRef = useRef(0)
  const lowTimeSecondRef = useRef<number | null>(null)

  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const clearTimerSafe = (ref: { current: number | null }) => {
    if (ref.current !== null) { window.clearTimeout(ref.current); ref.current = null }
  }

  const playAudio = useCallback((key: string, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (!audio) return
    audio.currentTime = 0
    audio.volume = volume
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const pairsRemaining = useMemo(() => {
    return (boardConfig.cols * boardConfig.rows) / 2 - matchedPairs.size
  }, [boardConfig, matchedPairs])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimerSafe(flipBackTimerRef)
    clearTimerSafe(matchFlashTimerRef)
    clearTimerSafe(mismatchShakeTimerRef)
    clearTimerSafe(boardResetTimerRef)
    clearTimerSafe(hintTimerRef)
    if (bgmRef.current) bgmRef.current.pause()
    playAudio('gameOver', 0.6, 0.95)
    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({ score: scoreRef.current, durationMs: elapsedMs })
  }, [onFinish, playAudio])

  const resetBoard = useCallback((nextClearCount: number) => {
    setBoardLocked(true)
    setBoardResetting(true)
    clearTimerSafe(boardResetTimerRef)
    boardResetTimerRef.current = window.setTimeout(() => {
      boardResetTimerRef.current = null
      const nextConfig = getBoardConfig(nextClearCount)
      setBoardConfig(nextConfig)
      setCards(createBoard(nextConfig))
      setFlippedIndices([])
      setMatchedPairs(new Set())
      setMatchFlashIndices(new Set())
      setMismatchShakeIndices(new Set())
      missCountRef.current = 0
      setMissCount(0)
      setBoardLocked(false)
      setBoardResetting(false)
    }, BOARD_RESET_DELAY_MS)
  }, [])

  const activateHint = useCallback(() => {
    if (isHintActive || performance.now() < hintCooldownEndRef.current || finishedRef.current) return
    setIsHintActive(true)
    setBoardLocked(true)
    playAudio('combo', 0.4, 1.2)
    clearTimerSafe(hintTimerRef)
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null
      setIsHintActive(false)
      setBoardLocked(false)
      hintCooldownEndRef.current = performance.now() + HINT_COOLDOWN_MS
    }, HINT_DURATION_MS)
  }, [isHintActive, playAudio])

  const handleCardClick = useCallback((cardIndex: number) => {
    if (finishedRef.current || isBoardLocked || isBoardResetting || isHintActive) return
    if (matchedPairs.has(cards[cardIndex].pairIndex)) return
    if (flippedIndices.includes(cardIndex)) return
    if (flippedIndices.length >= 2) return

    playAudio('tap', 0.35, 1 + Math.random() * 0.1)
    const nextFlipped = [...flippedIndices, cardIndex]
    setFlippedIndices(nextFlipped)

    if (nextFlipped.length === 2) {
      const first = cards[nextFlipped[0]]
      const second = cards[nextFlipped[1]]

      if (first.character.id === second.character.id) {
        // MATCH
        setBoardLocked(true)
        const now = performance.now()
        const isComboKept = lastMatchTimeRef.current > 0 && (now - lastMatchTimeRef.current) <= COMBO_WINDOW_MS
        const nextCombo = isComboKept ? comboRef.current + 1 : 1
        comboRef.current = nextCombo
        lastMatchTimeRef.current = now
        setCombo(nextCombo)

        const matchScore = BASE_MATCH_SCORE + COMBO_BONUS_PER_LEVEL * (nextCombo - 1)
        scoreRef.current += matchScore
        setScore(scoreRef.current)

        // Time bonus for combos
        if (nextCombo >= 2) {
          remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + TIME_BONUS_PER_COMBO)
          setRemainingMs(remainingMsRef.current)
        }

        playAudio('match', 0.45, 1 + nextCombo * 0.04)
        if (nextCombo > 0 && nextCombo % 5 === 0) playAudio('combo', 0.5)

        const cx = 200, cy = 300
        if (nextCombo >= 3) {
          const intensity = Math.min(6, 2 + nextCombo * 0.3)
          effects.triggerShake(intensity, 80)
          effects.spawnParticles(Math.min(6, 3 + Math.floor(nextCombo / 3)), cx, cy, [first.character.emoji, '✨', '🌟'])
          effects.showScorePopup(matchScore, cx, cy, nextCombo > 5 ? '#fbbf24' : '#22c55e')
        } else {
          effects.triggerFlash('rgba(34,197,94,0.15)')
          effects.spawnParticles(3, cx, cy, [first.character.emoji, '✨'])
          effects.showScorePopup(matchScore, cx, cy)
        }

        setMatchFlashIndices(new Set(nextFlipped))
        clearTimerSafe(matchFlashTimerRef)
        matchFlashTimerRef.current = window.setTimeout(() => {
          matchFlashTimerRef.current = null
          setMatchFlashIndices(new Set())
        }, MATCH_FLASH_DURATION_MS)

        const nextMatched = new Set(matchedPairs)
        nextMatched.add(first.pairIndex)
        setMatchedPairs(nextMatched)
        setFlippedIndices([])
        setBoardLocked(false)

        // Board clear?
        const totalPairs = (boardConfig.cols * boardConfig.rows) / 2
        if (nextMatched.size === totalPairs) {
          const nextClearCount = boardClearCountRef.current + 1
          boardClearCountRef.current = nextClearCount
          setBoardClearCount(nextClearCount)

          let clearBonus = BOARD_CLEAR_BONUS + BOARD_CLEAR_BONUS_INCREMENT * (nextClearCount - 1)
          if (missCountRef.current === 0) clearBonus += PERFECT_CLEAR_BONUS

          scoreRef.current += clearBonus
          setScore(scoreRef.current)

          effects.triggerShake(6, 150)
          effects.spawnParticles(8, 200, 300, ['🎉', '🎊', '🌟', '✨', '💎'])
          effects.showScorePopup(clearBonus, 200, 280, '#fbbf24')

          resetBoard(nextClearCount)
        }
      } else {
        // MISMATCH
        setBoardLocked(true)
        comboRef.current = 0
        setCombo(0)
        missCountRef.current++
        setMissCount(missCountRef.current)
        effects.triggerShake(3, 100)

        setMismatchShakeIndices(new Set(nextFlipped))
        clearTimerSafe(mismatchShakeTimerRef)
        mismatchShakeTimerRef.current = window.setTimeout(() => {
          mismatchShakeTimerRef.current = null
          setMismatchShakeIndices(new Set())
        }, MISMATCH_SHAKE_DURATION_MS)

        clearTimerSafe(flipBackTimerRef)
        flipBackTimerRef.current = window.setTimeout(() => {
          flipBackTimerRef.current = null
          setFlippedIndices([])
          setBoardLocked(false)
        }, FLIP_BACK_DELAY_MS)
      }
    }
  }, [cards, flippedIndices, matchedPairs, isBoardLocked, isBoardResetting, isHintActive, boardConfig, playAudio, resetBoard, effects])

  // Audio setup
  useEffect(() => {
    const sources: [string, string][] = [
      ['tap', tapHitSfx], ['match', tapHitStrongSfx],
      ['gameOver', gameOverHitSfx], ['combo', comboMilestoneSfx],
    ]
    for (const [key, src] of sources) {
      const a = new Audio(src)
      a.preload = 'auto'
      audioRefs.current[key] = a
    }
    const bgm = new Audio(bgmLoop)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = 0.18
    bgmRef.current = bgm
    void bgm.play().catch(() => {})

    // Preload card images
    for (const token of CHARACTER_POOL) {
      const img = new Image()
      img.src = token.imageSrc
    }

    return () => {
      for (const key of Object.keys(audioRefs.current)) {
        const a = audioRefs.current[key]
        if (a) { a.pause(); a.currentTime = 0 }
        audioRefs.current[key] = null
      }
      bgm.pause()
      bgmRef.current = null
      clearTimerSafe(flipBackTimerRef)
      clearTimerSafe(matchFlashTimerRef)
      clearTimerSafe(mismatchShakeTimerRef)
      clearTimerSafe(boardResetTimerRef)
      clearTimerSafe(hintTimerRef)
    }
  }, [])

  // Game loop (timer only)
  useEffect(() => {
    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      // Hint cooldown
      const cooldownLeft = Math.max(0, hintCooldownEndRef.current - now)
      setHintCooldownMs(cooldownLeft)

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== sec) {
          lowTimeSecondRef.current = sec
          playAudio('tap', 0.15, 1.3)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      effects.updateParticles()
      animationFrameRef.current = requestAnimationFrame(step)
    }
    animationFrameRef.current = requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
      lastFrameAtRef.current = null
      effects.cleanup()
    }
  }, [finishGame, playAudio, effects])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const timeSeconds = (remainingMs / 1000).toFixed(1)
  const hintReady = hintCooldownMs <= 0 && !isHintActive

  return (
    <section
      className="mini-game-panel mf-panel"
      aria-label="memory-flip-game"
      style={{
        width: '100%', maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto',
        overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column',
        ...effects.getShakeStyle(),
      }}
    >
      {/* HUD Top */}
      <div className="mf-hud">
        <div className="mf-hud-left">
          <p className="mf-score">{score.toLocaleString()}</p>
          <p className="mf-best">BEST {displayedBestScore.toLocaleString()}</p>
        </div>
        <div className="mf-hud-center">
          <p className={`mf-time ${isLowTime ? 'low-time' : ''}`}>{timeSeconds}s</p>
        </div>
        <div className="mf-hud-right">
          {combo >= 2 && (
            <p className="mf-combo">{combo} COMBO<br /><span className="mf-combo-bonus">+{TIME_BONUS_PER_COMBO / 1000}s</span></p>
          )}
        </div>
      </div>

      {/* Status row */}
      <div className="mf-status-row">
        <span className="mf-info">Stage {boardClearCount + 1}</span>
        <span className="mf-info">{boardConfig.cols}x{boardConfig.rows}</span>
        <span className="mf-info">Pairs: {pairsRemaining}</span>
        {missCount === 0 && matchedPairs.size > 0 && <span className="mf-badge-perfect">PERFECT</span>}
      </div>

      {/* Hint Button */}
      <div className="mf-hint-bar">
        <button
          className={`mf-hint-btn ${hintReady ? 'ready' : 'cooldown'}`}
          type="button"
          onClick={activateHint}
          disabled={!hintReady}
        >
          {isHintActive ? 'PEEK!' : hintReady ? 'HINT' : `${Math.ceil(hintCooldownMs / 1000)}s`}
        </button>
      </div>

      {/* Board */}
      <div className={`mf-board ${isBoardResetting ? 'resetting' : ''}`}>
        <div
          className="mf-grid"
          style={{
            gridTemplateColumns: `repeat(${boardConfig.cols}, 1fr)`,
            gridTemplateRows: `repeat(${boardConfig.rows}, 1fr)`,
          }}
        >
          {cards.map((card, index) => {
            const isFlipped = flippedIndices.includes(index)
            const isMatched = matchedPairs.has(card.pairIndex)
            const isRevealed = isFlipped || isMatched || isHintActive
            const isMatchFlash = matchFlashIndices.has(index)
            const isMismatchShake = mismatchShakeIndices.has(index)

            return (
              <button
                key={card.uid}
                className={`mf-card ${isRevealed ? 'flipped' : ''} ${isMatched ? 'matched' : ''} ${isMatchFlash ? 'match-flash' : ''} ${isMismatchShake ? 'mismatch-shake' : ''}`}
                type="button"
                onClick={() => handleCardClick(index)}
                disabled={isMatched}
              >
                <div className="mf-card-inner">
                  <div className="mf-card-back">
                    <span className="mf-card-q">?</span>
                  </div>
                  <div className="mf-card-front" style={{ borderColor: card.character.color }}>
                    <img className="mf-card-img" src={card.character.imageSrc} alt={card.character.name} draggable={false} />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {combo >= 3 && (
        <div className="ge-combo-label" style={{
          position: 'absolute', top: '90px', left: '50%', transform: 'translateX(-50%)',
          fontSize: `${Math.min(44, 18 + combo * 2)}px`, color: getComboColor(combo), zIndex: 30,
        }}>
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <style>{GAME_EFFECTS_CSS}{`
        .mf-panel {
          user-select: none; -webkit-user-select: none;
          background: linear-gradient(180deg, #1e1b4b 0%, #312e81 50%, #4338ca 100%);
          padding: 8px 8px 4px;
        }
        .mf-hud {
          display: flex; justify-content: space-between; align-items: flex-start;
          padding: 4px 6px 2px; flex-shrink: 0; z-index: 20;
        }
        .mf-hud-left { display: flex; flex-direction: column; }
        .mf-score {
          font-size: clamp(30px, 8vw, 44px); font-weight: 900; color: #a78bfa;
          margin: 0; line-height: 1; text-shadow: 0 2px 8px rgba(167,139,250,0.4);
        }
        .mf-best { font-size: clamp(12px, 3vw, 15px); font-weight: 600; color: #94a3b8; margin: 2px 0 0; }
        .mf-hud-center { text-align: center; }
        .mf-time {
          font-size: clamp(26px, 7vw, 38px); font-weight: 800; color: #e2e8f0;
          margin: 0; line-height: 1; transition: color 0.2s;
        }
        .mf-time.low-time { color: #ef4444; animation: mf-pulse 0.5s ease-in-out infinite alternate; }
        .mf-hud-right { text-align: right; }
        .mf-combo {
          font-size: clamp(18px, 4.5vw, 24px); font-weight: 800; color: #fbbf24;
          margin: 0; line-height: 1.1; text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }
        .mf-combo-bonus { font-size: 0.7em; color: #34d399; font-weight: 700; }
        .mf-status-row {
          display: flex; justify-content: center; gap: 10px; padding: 2px 6px;
          flex-shrink: 0; z-index: 20; flex-wrap: wrap;
        }
        .mf-info {
          font-size: clamp(11px, 2.8vw, 14px); font-weight: 700; color: #94a3b8;
          background: rgba(255,255,255,0.08); padding: 1px 8px; border-radius: 10px;
        }
        .mf-badge-perfect {
          font-size: clamp(11px, 2.8vw, 14px); font-weight: 800; color: #fbbf24;
          background: rgba(251,191,36,0.15); padding: 1px 8px; border-radius: 10px;
          animation: mf-pulse 0.6s ease-in-out infinite alternate;
        }
        .mf-hint-bar {
          display: flex; justify-content: center; padding: 4px 0 2px; flex-shrink: 0; z-index: 20;
        }
        .mf-hint-btn {
          font-size: clamp(13px, 3.5vw, 16px); font-weight: 800;
          padding: 4px 20px; border-radius: 16px; border: 2px solid;
          cursor: pointer; transition: all 0.2s;
          background: none; color: #fff;
        }
        .mf-hint-btn.ready {
          border-color: #a78bfa; color: #a78bfa;
          box-shadow: 0 0 10px rgba(167,139,250,0.3);
        }
        .mf-hint-btn.ready:hover { background: rgba(167,139,250,0.15); }
        .mf-hint-btn.cooldown {
          border-color: #475569; color: #64748b; cursor: default;
        }
        .mf-board {
          flex: 1; display: flex; align-items: center; justify-content: center;
          padding: 4px; min-height: 0; transition: opacity 0.3s, transform 0.3s;
        }
        .mf-board.resetting { opacity: 0; transform: scale(0.9); }
        .mf-grid {
          display: grid; gap: clamp(3px, 1vw, 6px);
          width: 100%; height: 100%;
        }
        .mf-card {
          position: relative; perspective: 600px;
          background: none; border: none; padding: 0;
          cursor: pointer; outline: none; border-radius: 8px;
          transition: transform 0.1s;
        }
        .mf-card:active:not(:disabled) { transform: scale(0.93); }
        .mf-card:disabled { cursor: default; }
        .mf-card-inner {
          position: relative; width: 100%; height: 100%;
          transition: transform 0.35s ease-in-out;
          transform-style: preserve-3d;
        }
        .mf-card.flipped .mf-card-inner,
        .mf-card.matched .mf-card-inner { transform: rotateY(180deg); }
        .mf-card-back, .mf-card-front {
          position: absolute; inset: 0; backface-visibility: hidden;
          border-radius: 8px; display: flex; align-items: center;
          justify-content: center; overflow: hidden;
        }
        .mf-card-back {
          background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%);
          border: 2px solid #6d28d9;
          box-shadow: inset 0 2px 4px rgba(255,255,255,0.15), 0 2px 6px rgba(0,0,0,0.3);
        }
        .mf-card-q {
          font-size: clamp(20px, 5vw, 32px); color: rgba(255,255,255,0.5);
          font-weight: 900; user-select: none;
        }
        .mf-card-front {
          background: #fefce8; border: 3px solid #d4d4d8;
          transform: rotateY(180deg);
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.08);
        }
        .mf-card-img {
          width: 82%; height: 82%; object-fit: contain;
          image-rendering: pixelated; image-rendering: crisp-edges;
        }
        .mf-card.matched .mf-card-front {
          border-color: #22c55e; background: #f0fdf4; opacity: 0.65;
        }
        .mf-card.match-flash {
          animation: mf-match-flash ${MATCH_FLASH_DURATION_MS}ms ease-out;
        }
        .mf-card.mismatch-shake {
          animation: mf-mismatch-shake ${MISMATCH_SHAKE_DURATION_MS}ms ease-out;
        }
        @keyframes mf-match-flash {
          0% { box-shadow: 0 0 0 0 rgba(34,197,94,0.7); }
          50% { box-shadow: 0 0 18px 8px rgba(34,197,94,0.5); transform: scale(1.08); }
          100% { box-shadow: 0 0 0 0 transparent; transform: scale(1); }
        }
        @keyframes mf-mismatch-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-5px); }
          30% { transform: translateX(5px); }
          45% { transform: translateX(-3px); }
          60% { transform: translateX(3px); }
          75% { transform: translateX(-2px); }
        }
        @keyframes mf-pulse {
          from { opacity: 1; } to { opacity: 0.5; }
        }
      `}</style>
    </section>
  )
}

export const memoryFlipModule: MiniGameModule = {
  manifest: {
    id: 'memory-flip',
    title: 'Memory Flip',
    description: 'Flip cards to find pairs! Chain matches for combo bonus + extra time!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#8b5cf6',
  },
  Component: MemoryFlipGame,
}
