import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

const ROUND_DURATION_MS = 60000
const MATCH_FLASH_DURATION_MS = 400
const MISMATCH_SHAKE_DURATION_MS = 500
const FLIP_BACK_DELAY_MS = 800
const BOARD_RESET_DELAY_MS = 600
const LOW_TIME_THRESHOLD_MS = 10000
const COMBO_WINDOW_MS = 3000
const BASE_MATCH_SCORE = 100
const COMBO_BONUS_PER_LEVEL = 50
const BOARD_CLEAR_BONUS = 500
const BOARD_CLEAR_BONUS_INCREMENT = 250

const CHARACTER_POOL = [
  { id: 'kim-yeonja', name: '김연자', imageSrc: kimYeonjaImage, color: '#ec4899' },
  { id: 'park-sangmin', name: '박상민', imageSrc: parkSangminImage, color: '#ef4444' },
  { id: 'park-wankyu', name: '박완규', imageSrc: parkWankyuImage, color: '#f59e0b' },
  { id: 'seo-taiji', name: '서태지', imageSrc: seoTaijiImage, color: '#8b5cf6' },
  { id: 'song-changsik', name: '송창식', imageSrc: songChangsikImage, color: '#22c55e' },
  { id: 'tae-jina', name: '태진아', imageSrc: taeJinaImage, color: '#22d3ee' },
] as const

type CharacterToken = (typeof CHARACTER_POOL)[number]

interface Card {
  readonly id: number
  readonly character: CharacterToken
  readonly pairIndex: number
}

interface BoardConfig {
  readonly cols: number
  readonly rows: number
}

const BOARD_PROGRESSION: BoardConfig[] = [
  { cols: 4, rows: 4 },
  { cols: 5, rows: 4 },
  { cols: 5, rows: 5 },
  { cols: 6, rows: 5 },
  { cols: 6, rows: 6 },
]

function getBoardConfig(clearCount: number): BoardConfig {
  const index = Math.min(clearCount, BOARD_PROGRESSION.length - 1)
  return BOARD_PROGRESSION[index]
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
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
  const cards: Card[] = []

  for (let pairIndex = 0; pairIndex < pairsNeeded; pairIndex += 1) {
    const character = CHARACTER_POOL[pairIndex % CHARACTER_POOL.length]
    cards.push({ id: pairIndex * 2, character, pairIndex })
    cards.push({ id: pairIndex * 2 + 1, character, pairIndex })
  }

  return shuffleArray(cards)
}

function MemoryFlipGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
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

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const lastMatchTimeRef = useRef(0)
  const boardClearCountRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const flipBackTimerRef = useRef<number | null>(null)
  const matchFlashTimerRef = useRef<number | null>(null)
  const mismatchShakeTimerRef = useRef<number | null>(null)
  const boardResetTimerRef = useRef<number | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)

  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const matchAudioRef = useRef<HTMLAudioElement | null>(null)
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

  const pairsRemaining = useMemo(() => {
    const totalPairs = (boardConfig.cols * boardConfig.rows) / 2
    return totalPairs - matchedPairs.size
  }, [boardConfig, matchedPairs])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  const finishGame = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    clearTimeoutSafe(flipBackTimerRef)
    clearTimeoutSafe(matchFlashTimerRef)
    clearTimeoutSafe(mismatchShakeTimerRef)
    clearTimeoutSafe(boardResetTimerRef)

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const resetBoard = useCallback((nextClearCount: number) => {
    setBoardLocked(true)
    setBoardResetting(true)

    clearTimeoutSafe(boardResetTimerRef)
    boardResetTimerRef.current = window.setTimeout(() => {
      boardResetTimerRef.current = null
      const nextConfig = getBoardConfig(nextClearCount)
      const nextCards = createBoard(nextConfig)
      setBoardConfig(nextConfig)
      setCards(nextCards)
      setFlippedIndices([])
      setMatchedPairs(new Set())
      setMatchFlashIndices(new Set())
      setMismatchShakeIndices(new Set())
      setBoardLocked(false)
      setBoardResetting(false)
    }, BOARD_RESET_DELAY_MS)
  }, [])

  const handleCardClick = useCallback(
    (cardIndex: number) => {
      if (finishedRef.current || isBoardLocked || isBoardResetting) {
        return
      }

      if (matchedPairs.has(cards[cardIndex].pairIndex)) {
        return
      }

      if (flippedIndices.includes(cardIndex)) {
        return
      }

      if (flippedIndices.length >= 2) {
        return
      }

      playAudio(tapAudioRef, 0.4, 1 + Math.random() * 0.1)

      const nextFlipped = [...flippedIndices, cardIndex]
      setFlippedIndices(nextFlipped)

      if (nextFlipped.length === 2) {
        const firstCard = cards[nextFlipped[0]]
        const secondCard = cards[nextFlipped[1]]

        if (firstCard.character.id === secondCard.character.id) {
          setBoardLocked(true)

          const now = performance.now()
          const timeSinceLastMatch = now - lastMatchTimeRef.current
          const isComboKept = lastMatchTimeRef.current > 0 && timeSinceLastMatch <= COMBO_WINDOW_MS
          const nextCombo = isComboKept ? comboRef.current + 1 : 1
          comboRef.current = nextCombo
          lastMatchTimeRef.current = now
          setCombo(nextCombo)

          const matchScore = BASE_MATCH_SCORE + COMBO_BONUS_PER_LEVEL * (nextCombo - 1)
          const nextScore = scoreRef.current + matchScore
          scoreRef.current = nextScore
          setScore(nextScore)

          playAudio(matchAudioRef, 0.5, 1 + nextCombo * 0.04)

          if (nextCombo >= 3) {
            effects.comboHitBurst(200, 250, nextCombo, matchScore)
          } else {
            effects.triggerFlash('rgba(34,197,94,0.25)')
            effects.spawnParticles(4, 200, 250, ['✨', '🌟', '💫'])
            effects.showScorePopup(matchScore, 200, 220)
          }

          const flashSet = new Set([nextFlipped[0], nextFlipped[1]])
          setMatchFlashIndices(flashSet)
          clearTimeoutSafe(matchFlashTimerRef)
          matchFlashTimerRef.current = window.setTimeout(() => {
            matchFlashTimerRef.current = null
            setMatchFlashIndices(new Set())
          }, MATCH_FLASH_DURATION_MS)

          const nextMatched = new Set(matchedPairs)
          nextMatched.add(firstCard.pairIndex)
          setMatchedPairs(nextMatched)
          setFlippedIndices([])
          setBoardLocked(false)

          const totalPairs = (boardConfig.cols * boardConfig.rows) / 2
          if (nextMatched.size === totalPairs) {
            const nextClearCount = boardClearCountRef.current + 1
            boardClearCountRef.current = nextClearCount
            setBoardClearCount(nextClearCount)

            const clearBonus = BOARD_CLEAR_BONUS + BOARD_CLEAR_BONUS_INCREMENT * (nextClearCount - 1)
            const bonusScore = nextScore + clearBonus
            scoreRef.current = bonusScore
            setScore(bonusScore)

            effects.comboHitBurst(200, 200, 10 + nextClearCount, clearBonus, ['🎉', '🎊', '🌟', '✨'])

            resetBoard(nextClearCount)
          }
        } else {
          setBoardLocked(true)

          comboRef.current = 0
          setCombo(0)
          effects.triggerShake(4)
          effects.triggerFlash('rgba(239,68,68,0.2)')

          const shakeSet = new Set([nextFlipped[0], nextFlipped[1]])
          setMismatchShakeIndices(shakeSet)
          clearTimeoutSafe(mismatchShakeTimerRef)
          mismatchShakeTimerRef.current = window.setTimeout(() => {
            mismatchShakeTimerRef.current = null
            setMismatchShakeIndices(new Set())
          }, MISMATCH_SHAKE_DURATION_MS)

          clearTimeoutSafe(flipBackTimerRef)
          flipBackTimerRef.current = window.setTimeout(() => {
            flipBackTimerRef.current = null
            setFlippedIndices([])
            setBoardLocked(false)
          }, FLIP_BACK_DELAY_MS)
        }
      }
    },
    [cards, flippedIndices, matchedPairs, isBoardLocked, isBoardResetting, boardConfig, playAudio, resetBoard],
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
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
    for (const token of CHARACTER_POOL) {
      const image = new Image()
      image.decoding = 'sync'
      image.src = token.imageSrc
      void image.decode?.().catch(() => {})
    }

    const tapAudio = new Audio(tapHitSfx)
    tapAudio.preload = 'auto'
    tapAudioRef.current = tapAudio

    const matchAudio = new Audio(tapHitStrongSfx)
    matchAudio.preload = 'auto'
    matchAudioRef.current = matchAudio

    const gameOverAudio = new Audio(gameOverHitSfx)
    gameOverAudio.preload = 'auto'
    gameOverAudioRef.current = gameOverAudio

    return () => {
      clearTimeoutSafe(flipBackTimerRef)
      clearTimeoutSafe(matchFlashTimerRef)
      clearTimeoutSafe(mismatchShakeTimerRef)
      clearTimeoutSafe(boardResetTimerRef)
      tapAudioRef.current = null
      matchAudioRef.current = null
      gameOverAudioRef.current = null
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

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
          playAudio(tapAudioRef, 0.2, 1.2 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 15000)
        }
      } else {
        lowTimeSecondRef.current = null
      }

      if (remainingMsRef.current <= 0) {
        playAudio(gameOverAudioRef, 0.64, 0.95)
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
  }, [finishGame, playAudio])

  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const timeSeconds = (remainingMs / 1000).toFixed(1)
  const boardSizeLabel = `${boardConfig.cols}x${boardConfig.rows}`

  return (
    <section className="mini-game-panel memory-flip-panel" aria-label="memory-flip-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <div className="memory-flip-score-strip">
        <p className="memory-flip-score">{score.toLocaleString()}</p>
        <p className="memory-flip-best">BEST {displayedBestScore.toLocaleString()}</p>
        <p className={`memory-flip-time ${isLowTime ? 'low-time' : ''}`}>{timeSeconds}s</p>
      </div>

      <div className="memory-flip-meta-row">
        <p className="memory-flip-combo">
          COMBO <strong>{combo}</strong>
        </p>
        <p className="memory-flip-pairs">
          남은 짝 <strong>{pairsRemaining}</strong>
        </p>
        <p className="memory-flip-board-size">
          보드 <strong>{boardSizeLabel}</strong>
        </p>
        <p className="memory-flip-clears">
          클리어 <strong>{boardClearCount}</strong>
        </p>
      </div>

      <div className={`memory-flip-board ${isBoardResetting ? 'resetting' : ''}`}>
        <div
          className="memory-flip-grid"
          style={{
            gridTemplateColumns: `repeat(${boardConfig.cols}, 1fr)`,
            gridTemplateRows: `repeat(${boardConfig.rows}, 1fr)`,
          }}
        >
          {cards.map((card, index) => {
            const isFlipped = flippedIndices.includes(index)
            const isMatched = matchedPairs.has(card.pairIndex)
            const isRevealed = isFlipped || isMatched
            const isMatchFlash = matchFlashIndices.has(index)
            const isMismatchShake = mismatchShakeIndices.has(index)

            return (
              <button
                key={`card-${card.id}-${boardClearCount}`}
                className={`memory-flip-card ${isRevealed ? 'flipped' : ''} ${isMatched ? 'matched' : ''} ${isMatchFlash ? 'match-flash' : ''} ${isMismatchShake ? 'mismatch-shake' : ''}`}
                type="button"
                onClick={() => handleCardClick(index)}
                disabled={isMatched}
                aria-label={isRevealed ? card.character.name : '카드'}
              >
                <div className="memory-flip-card-inner">
                  <div className="memory-flip-card-back">
                    <span className="memory-flip-card-back-pattern">?</span>
                  </div>
                  <div className="memory-flip-card-front">
                    <img
                      className="memory-flip-card-image"
                      src={card.character.imageSrc}
                      alt={card.character.name}
                      draggable={false}
                    />
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {combo >= 3 && (
        <div className="ge-combo-label" style={{ position: 'absolute', top: '50px', left: '50%', transform: 'translateX(-50%)', fontSize: `${14 + combo * 2}px`, color: getComboColor(combo), zIndex: 20 }}>
          {getComboLabel(combo)}
        </div>
      )}

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <button className="text-button" type="button" onClick={handleExit}>
        허브로 돌아가기
      </button>

      <style>{GAME_EFFECTS_CSS}
      {`
        .memory-flip-panel {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          padding: 12px 8px;
          width: 100%;
          max-width: 420px;
          margin: 0 auto;
        }

        .memory-flip-score-strip {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          width: 100%;
          padding: 0 4px;
        }

        .memory-flip-score {
          font-size: 28px;
          font-weight: bold;
          color: #8b5cf6;
          margin: 0;
        }

        .memory-flip-best {
          font-size: 12px;
          color: #9ca3af;
          margin: 0;
        }

        .memory-flip-time {
          font-size: 18px;
          font-weight: bold;
          color: #1f2937;
          margin: 0;
          transition: color 0.3s;
        }

        .memory-flip-time.low-time {
          color: #ef4444;
          animation: memory-flip-pulse 0.5s ease-in-out infinite alternate;
        }

        .memory-flip-meta-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 100%;
          padding: 4px 0;
        }

        .memory-flip-meta-row p {
          font-size: 12px;
          color: #6b7280;
          margin: 0;
        }

        .memory-flip-meta-row strong {
          color: #1f2937;
          font-size: 13px;
        }

        .memory-flip-board {
          width: 100%;
          aspect-ratio: 1;
          max-height: 380px;
          padding: 4px;
          transition: opacity 0.3s, transform 0.3s;
        }

        .memory-flip-board.resetting {
          opacity: 0;
          transform: scale(0.92);
        }

        .memory-flip-grid {
          display: grid;
          gap: 4px;
          width: 100%;
          height: 100%;
        }

        .memory-flip-card {
          position: relative;
          perspective: 600px;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
          outline: none;
          border-radius: 6px;
          transition: transform 0.1s;
        }

        .memory-flip-card:active:not(:disabled) {
          transform: scale(0.95);
        }

        .memory-flip-card:disabled {
          cursor: default;
        }

        .memory-flip-card-inner {
          position: relative;
          width: 100%;
          height: 100%;
          transition: transform 0.4s ease-in-out;
          transform-style: preserve-3d;
        }

        .memory-flip-card.flipped .memory-flip-card-inner,
        .memory-flip-card.matched .memory-flip-card-inner {
          transform: rotateY(180deg);
        }

        .memory-flip-card-back,
        .memory-flip-card-front {
          position: absolute;
          inset: 0;
          backface-visibility: hidden;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .memory-flip-card-back {
          background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 50%, #a78bfa 100%);
          border: 2px solid #6d28d9;
          box-shadow: inset 0 2px 4px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.15);
        }

        .memory-flip-card-back-pattern {
          font-size: 20px;
          color: rgba(255, 255, 255, 0.5);
          font-weight: bold;
          user-select: none;
        }

        .memory-flip-card-front {
          background: #fefce8;
          border: 2px solid #d4d4d8;
          transform: rotateY(180deg);
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.08);
        }

        .memory-flip-card-image {
          width: 80%;
          height: 80%;
          object-fit: contain;
          image-rendering: pixelated;
          image-rendering: crisp-edges;
        }

        .memory-flip-card.matched .memory-flip-card-front {
          border-color: #22c55e;
          background: #f0fdf4;
          opacity: 0.7;
        }

        .memory-flip-card.match-flash {
          animation: memory-flip-match-flash ${MATCH_FLASH_DURATION_MS}ms ease-out;
        }

        .memory-flip-card.mismatch-shake {
          animation: memory-flip-mismatch-shake ${MISMATCH_SHAKE_DURATION_MS}ms ease-out;
        }

        @keyframes memory-flip-match-flash {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
          50% { box-shadow: 0 0 16px 6px rgba(34, 197, 94, 0.5); transform: scale(1.08); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); transform: scale(1); }
        }

        @keyframes memory-flip-mismatch-shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-4px); }
          30% { transform: translateX(4px); }
          45% { transform: translateX(-3px); }
          60% { transform: translateX(3px); }
          75% { transform: translateX(-2px); }
          90% { transform: translateX(1px); }
        }

        @keyframes memory-flip-pulse {
          0% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      `}</style>
    </section>
  )
}

export const memoryFlipModule: MiniGameModule = {
  manifest: {
    id: 'memory-flip',
    title: 'Memory Flip',
    description: '카드를 뒤집어 캐릭터 짝을 맞춰라! 연속 매칭으로 콤보 보너스!',
    unlockCost: 45,
    baseReward: 15,
    scoreRewardMultiplier: 1.2,
    accentColor: '#8b5cf6',
  },
  Component: MemoryFlipGame,
}
