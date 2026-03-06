import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import characterImage from '../../../assets/images/same-character/seo-taiji.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

const ROUND_DURATION_MS = 45000
const LOW_TIME_THRESHOLD_MS = 5000
const PLAYBACK_NOTE_DURATION_BASE_MS = 500
const PLAYBACK_GAP_BASE_MS = 200
const RESULT_DISPLAY_MS = 800
const TONE_DURATION_S = 0.32
const TONE_VOLUME = 0.38
const TEMPO_SPEEDUP_PER_LEVEL = 0.04
const MIN_TEMPO_SCALE = 0.5
const PERFECT_ROUND_TIME_BONUS_MS = 2000
const FEVER_LEVEL_THRESHOLD = 4
const FEVER_DURATION_MS = 12000
const FEVER_SCORE_MULTIPLIER = 2

type Phase = 'listen' | 'play' | 'result-correct' | 'result-wrong' | 'game-over'

interface NoteDefinition {
  readonly id: string
  readonly label: string
  readonly frequency: number
  readonly color: string
  readonly activeColor: string
}

const NOTES: readonly NoteDefinition[] = [
  { id: 'do', label: 'Do', frequency: 262, color: '#dc2626', activeColor: '#fca5a5' },
  { id: 're', label: 'Re', frequency: 294, color: '#2563eb', activeColor: '#93c5fd' },
  { id: 'mi', label: 'Mi', frequency: 330, color: '#16a34a', activeColor: '#86efac' },
  { id: 'fa', label: 'Fa', frequency: 349, color: '#ca8a04', activeColor: '#fde047' },
] as const

function playTone(audioContext: AudioContext, frequency: number, duration: number, volume: number): void {
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()

  oscillator.type = 'sine'
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime)

  gainNode.gain.setValueAtTime(volume, audioContext.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration)

  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)

  oscillator.start(audioContext.currentTime)
  oscillator.stop(audioContext.currentTime + duration)
}

function pickRandomNoteIndex(): number {
  return Math.floor(Math.random() * NOTES.length)
}

function extendSequence(sequence: number[]): number[] {
  return [...sequence, pickRandomNoteIndex()]
}

function MusicMemoryGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<Phase>('listen')
  const [sequence, setSequence] = useState<number[]>(() => [pickRandomNoteIndex()])
  const [playerInputIndex, setPlayerInputIndex] = useState(0)
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null)
  const [resultMessage, setResultMessage] = useState('')
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const levelRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const phaseRef = useRef<Phase>('listen')
  const sequenceRef = useRef<number[]>(sequence)
  const playerInputIndexRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const playbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const audioContextRef = useRef<AudioContext | null>(null)
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null)
  const lowTimeSecondRef = useRef<number | null>(null)

  const getAudioContext = useCallback((): AudioContext => {
    if (audioContextRef.current === null || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new AudioContext()
    }
    if (audioContextRef.current.state === 'suspended') {
      void audioContextRef.current.resume().catch(() => {})
    }
    return audioContextRef.current
  }, [])

  const playNote = useCallback(
    (noteIndex: number) => {
      const note = NOTES[noteIndex]
      try {
        const ctx = getAudioContext()
        playTone(ctx, note.frequency, TONE_DURATION_S, TONE_VOLUME)
      } catch {
        const audio = fallbackAudioRef.current
        if (audio !== null) {
          audio.currentTime = 0
          audio.volume = 0.4
          void audio.play().catch(() => {})
        }
      }
    },
    [getAudioContext],
  )

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      clearTimeout(playbackTimerRef.current)
      playbackTimerRef.current = null
    }
  }, [])

  const clearResultTimer = useCallback(() => {
    if (resultTimerRef.current !== null) {
      clearTimeout(resultTimerRef.current)
      resultTimerRef.current = null
    }
  }, [])

  const startPlayback = useCallback(
    (seq: number[]) => {
      clearPlaybackTimer()
      phaseRef.current = 'listen'
      setPhase('listen')
      setActiveNoteId(null)

      // Tempo increases with level
      const tempoScale = Math.max(MIN_TEMPO_SCALE, 1 - (levelRef.current - 1) * TEMPO_SPEEDUP_PER_LEVEL)
      const noteDuration = Math.round(PLAYBACK_NOTE_DURATION_BASE_MS * tempoScale)
      const gapDuration = Math.round(PLAYBACK_GAP_BASE_MS * tempoScale)

      let stepIndex = 0
      const totalSteps = seq.length

      const playStep = () => {
        if (finishedRef.current) return

        if (stepIndex >= totalSteps) {
          setActiveNoteId(null)
          phaseRef.current = 'play'
          setPhase('play')
          playerInputIndexRef.current = 0
          setPlayerInputIndex(0)
          return
        }

        const noteIndex = seq[stepIndex]
        const note = NOTES[noteIndex]
        setActiveNoteId(note.id)
        playNote(noteIndex)

        playbackTimerRef.current = setTimeout(() => {
          setActiveNoteId(null)
          stepIndex += 1

          playbackTimerRef.current = setTimeout(playStep, gapDuration)
        }, noteDuration)
      }

      playbackTimerRef.current = setTimeout(playStep, gapDuration)
    },
    [clearPlaybackTimer, playNote],
  )

  const advanceLevel = useCallback(() => {
    clearResultTimer()
    const nextLevel = levelRef.current + 1
    levelRef.current = nextLevel
    setLevel(nextLevel)

    const nextSequence = extendSequence(sequenceRef.current)
    sequenceRef.current = nextSequence
    setSequence(nextSequence)

    startPlayback(nextSequence)
  }, [clearResultTimer, startPlayback])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearPlaybackTimer()
    clearResultTimer()

    phaseRef.current = 'game-over'
    setPhase('game-over')

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [clearPlaybackTimer, clearResultTimer, onFinish])

  const handleWrongAnswer = useCallback(() => {
    phaseRef.current = 'result-wrong'
    setPhase('result-wrong')
    setResultMessage('Wrong!')
    setActiveNoteId(null)

    // Visual effects for wrong
    effects.triggerShake(6)
    effects.triggerFlash('rgba(239,68,68,0.4)')

    resultTimerRef.current = setTimeout(() => {
      resultTimerRef.current = null
      finishGame()
    }, RESULT_DISPLAY_MS)
  }, [finishGame])

  const handleCorrectRound = useCallback(() => {
    const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
    const roundScore = levelRef.current * 10 * feverMult
    const nextScore = scoreRef.current + roundScore
    scoreRef.current = nextScore
    setScore(nextScore)

    // Time bonus for completing a round
    remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + PERFECT_ROUND_TIME_BONUS_MS)
    setRemainingMs(remainingMsRef.current)

    // Activate fever at level threshold
    if (levelRef.current >= FEVER_LEVEL_THRESHOLD && !feverRef.current) {
      feverRef.current = true
      feverRemainingMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverRemainingMs(FEVER_DURATION_MS)
      effects.triggerFlash('rgba(250,204,21,0.5)')
    }

    phaseRef.current = 'result-correct'
    setPhase('result-correct')
    setResultMessage(`+${roundScore}${feverRef.current ? ' FEVER!' : ''}`)

    // Visual effects for correct round
    effects.comboHitBurst(200, 250, levelRef.current, roundScore)

    resultTimerRef.current = setTimeout(() => {
      resultTimerRef.current = null
      advanceLevel()
    }, RESULT_DISPLAY_MS)
  }, [advanceLevel])

  const handleNoteTap = useCallback(
    (noteIndex: number) => {
      if (finishedRef.current) return
      if (phaseRef.current !== 'play') return

      const note = NOTES[noteIndex]
      setActiveNoteId(note.id)
      playNote(noteIndex)

      setTimeout(() => {
        setActiveNoteId((current) => (current === note.id ? null : current))
      }, 180)

      const expectedIndex = sequenceRef.current[playerInputIndexRef.current]

      if (noteIndex !== expectedIndex) {
        handleWrongAnswer()
        return
      }

      const nextInputIndex = playerInputIndexRef.current + 1
      playerInputIndexRef.current = nextInputIndex
      setPlayerInputIndex(nextInputIndex)

      // Small particle effect for each correct note
      effects.spawnParticles(3, 100 + noteIndex * 60, 350)

      if (nextInputIndex === sequenceRef.current.length) {
        handleCorrectRound()
      }
    },
    [handleCorrectRound, handleWrongAnswer, playNote],
  )

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  useEffect(() => {
    const fallbackAudio = new Audio(tapHitSfx)
    fallbackAudio.preload = 'auto'
    fallbackAudioRef.current = fallbackAudio

    return () => {
      clearPlaybackTimer()
      clearResultTimer()
      fallbackAudioRef.current = null
      effects.cleanup()

      if (audioContextRef.current !== null) {
        void audioContextRef.current.close().catch(() => {})
        audioContextRef.current = null
      }
    }
  }, [clearPlaybackTimer, clearResultTimer])

  useEffect(() => {
    startPlayback(sequenceRef.current)
  }, [startPlayback])

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

      // Fever timer countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      effects.updateParticles()

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const nextLowTimeSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== nextLowTimeSecond) {
          lowTimeSecondRef.current = nextLowTimeSecond
        }
      } else {
        lowTimeSecondRef.current = null
      }

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }

      if (phaseRef.current !== 'play') return

      const keyMap: Record<string, number> = {
        Digit1: 0,
        Digit2: 1,
        Digit3: 2,
        Digit4: 3,
        KeyA: 0,
        KeyS: 1,
        KeyD: 2,
        KeyF: 3,
      }

      const noteIndex = keyMap[event.code]
      if (noteIndex !== undefined) {
        event.preventDefault()
        handleNoteTap(noteIndex)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleNoteTap, handleExit])

  const displayedBestScore = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const isListening = phase === 'listen'
  const isPlaying = phase === 'play'
  const comboLabel = getComboLabel(level)
  const comboColor = getComboColor(level)

  const phaseLabel = (() => {
    switch (phase) {
      case 'listen':
        return 'Listen to the melody...'
      case 'play':
        return `${playerInputIndex} / ${sequence.length}`
      case 'result-correct':
        return resultMessage
      case 'result-wrong':
        return resultMessage
      case 'game-over':
        return 'Game Over!'
    }
  })()

  return (
    <section className="mini-game-panel music-memory-panel" aria-label="music-memory-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .music-memory-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1a0a2e 0%, #0d0d1a 40%, #120826 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          position: relative;
          overflow: hidden;
        }

        .music-memory-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px 10px;
          background: linear-gradient(135deg, rgba(192,38,211,0.35) 0%, rgba(88,28,135,0.25) 100%);
          border-bottom: 1px solid rgba(192,38,211,0.2);
          flex-shrink: 0;
        }

        .music-memory-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .music-memory-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          border: 2px solid #c026d3;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(192,38,211,0.5);
        }

        .music-memory-header-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .music-memory-score {
          font-size: 26px;
          font-weight: 800;
          color: #e879f9;
          margin: 0;
          line-height: 1;
          text-shadow: 0 0 16px rgba(192,38,211,0.6);
        }

        .music-memory-best {
          font-size: 11px;
          color: #a78bfa;
          margin: 0;
          opacity: 0.8;
        }

        .music-memory-header-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .music-memory-time {
          font-size: 20px;
          font-weight: 700;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .music-memory-time.low-time {
          color: #ef4444;
          animation: music-memory-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes music-memory-pulse {
          from { opacity: 1; }
          to { opacity: 0.4; }
        }

        .music-memory-meta-row {
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 16px;
          padding: 8px 16px;
          flex-shrink: 0;
        }

        .music-memory-meta-row p {
          font-size: 13px;
          color: #a78bfa;
          margin: 0;
        }

        .music-memory-meta-row strong {
          color: #e4e4e7;
        }

        .music-memory-game-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 12px 16px;
          min-height: 0;
        }

        .music-memory-phase-banner {
          width: 100%;
          text-align: center;
          padding: 10px 16px;
          border-radius: 12px;
          background: rgba(192, 38, 211, 0.12);
          border: 1px solid rgba(192, 38, 211, 0.25);
          backdrop-filter: blur(4px);
        }

        .music-memory-phase-banner.result-correct {
          background: rgba(34, 197, 94, 0.15);
          border-color: rgba(34, 197, 94, 0.3);
          box-shadow: 0 0 20px rgba(34,197,94,0.2);
        }

        .music-memory-phase-banner.result-wrong {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.3);
          box-shadow: 0 0 20px rgba(239,68,68,0.2);
        }

        .music-memory-phase-text {
          font-size: 16px;
          font-weight: 700;
          color: #e4e4e7;
          margin: 0;
        }

        .music-memory-sequence-dots {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: center;
        }

        .music-memory-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          border: 2px solid;
          background: transparent;
          transition: background-color 0.2s;
        }

        .music-memory-dot.done {
          opacity: 0.6;
        }

        .music-memory-dot.current {
          animation: music-memory-dot-pulse 0.6s ease-in-out infinite alternate;
        }

        .music-memory-dot.playback {
          transform: scale(1.3);
        }

        @keyframes music-memory-dot-pulse {
          from { transform: scale(1); }
          to { transform: scale(1.3); }
        }

        .music-memory-button-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          width: 100%;
        }

        .music-memory-note-button {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 24px 8px;
          border-radius: 16px;
          border: 3px solid;
          cursor: pointer;
          transition: transform 0.1s, background-color 0.15s, box-shadow 0.15s;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }

        .music-memory-note-button:active:not(:disabled) {
          transform: scale(0.93);
        }

        .music-memory-note-button.active {
          transform: scale(1.08);
          box-shadow: 0 0 24px rgba(255, 255, 255, 0.3), 0 0 48px currentColor;
        }

        .music-memory-note-button:disabled {
          opacity: 0.35;
          cursor: default;
        }

        .music-memory-note-label {
          font-size: 20px;
          font-weight: 800;
          color: #fff;
          text-shadow: 0 1px 4px rgba(0,0,0,0.3);
        }

        .music-memory-note-key {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.55);
        }

        .music-memory-footer {
          display: flex;
          justify-content: center;
          padding: 10px 16px 14px;
          flex-shrink: 0;
        }

        .music-memory-exit-btn {
          padding: 8px 24px;
          border-radius: 20px;
          border: 1px solid rgba(192,38,211,0.3);
          background: rgba(192,38,211,0.1);
          color: #c4b5fd;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }

        .music-memory-exit-btn:active {
          transform: scale(0.95);
          background: rgba(192,38,211,0.2);
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="music-memory-header">
        <div className="music-memory-header-left">
          <img className="music-memory-avatar" src={characterImage} alt="character" />
          <div className="music-memory-header-info">
            <p className="music-memory-score">{score.toLocaleString()}</p>
            <p className="music-memory-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="music-memory-header-right">
          <p className={`music-memory-time ${isLowTime ? 'low-time' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
        </div>
      </div>

      <div className="music-memory-meta-row">
        <p className="music-memory-level">
          LEVEL <strong>{level}</strong>
        </p>
        <p className="music-memory-notes-count">
          NOTES <strong>{sequence.length}</strong>
        </p>
        {comboLabel && (
          <p className="ge-combo-label" style={{ color: comboColor, fontSize: 12 }}>{comboLabel}</p>
        )}
        {isFever && (
          <p style={{ color: '#facc15', fontSize: 12, fontWeight: 800, margin: 0, animation: 'music-memory-pulse 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div className="music-memory-game-area">
        <div className={`music-memory-phase-banner ${phase}`}>
          <p className="music-memory-phase-text">{phaseLabel}</p>
        </div>

        <div className="music-memory-sequence-dots">
          {sequence.map((noteIndex, index) => {
            const note = NOTES[noteIndex]
            const isDone = isPlaying && index < playerInputIndex
            const isCurrent = isPlaying && index === playerInputIndex
            const isPlaybackActive = isListening && activeNoteId === note.id
            return (
              <span
                key={`dot-${index}`}
                className={`music-memory-dot ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''} ${isPlaybackActive ? 'playback' : ''}`}
                style={{
                  backgroundColor: isDone || isPlaybackActive ? note.color : undefined,
                  borderColor: note.color,
                }}
              />
            )
          })}
        </div>

        <div className="music-memory-button-grid">
          {NOTES.map((note, index) => {
            const isActive = activeNoteId === note.id
            return (
              <button
                key={note.id}
                className={`music-memory-note-button ${isActive ? 'active' : ''}`}
                type="button"
                style={{
                  backgroundColor: isActive ? note.activeColor : note.color,
                  borderColor: note.color,
                }}
                disabled={phase !== 'play'}
                onClick={() => handleNoteTap(index)}
                aria-label={note.label}
              >
                <span className="music-memory-note-label">{note.label}</span>
                <span className="music-memory-note-key">{index + 1}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="music-memory-footer">
      </div>
    </section>
  )
}

export const musicMemoryModule: MiniGameModule = {
  manifest: {
    id: 'music-memory',
    title: 'Music Memory',
    description: 'Remember the melody and play it back! Simon says!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.25,
    accentColor: '#c026d3',
  },
  Component: MusicMemoryGame,
}
