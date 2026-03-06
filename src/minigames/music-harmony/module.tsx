import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import correctSfxSrc from '../../../assets/sounds/music-harmony-correct.mp3'
import wrongSfxSrc from '../../../assets/sounds/music-harmony-wrong.mp3'
import feverSfxSrc from '../../../assets/sounds/music-harmony-fever.mp3'
import tapSfxSrc from '../../../assets/sounds/music-harmony-tap.mp3'
import levelUpSfxSrc from '../../../assets/sounds/music-harmony-level-up.mp3'
import warningSfxSrc from '../../../assets/sounds/music-harmony-warning.mp3'

// ─── Constants ───────────────────────────────────────────────────
const ROUND_DURATION_MS = 60000
const LOW_TIME_THRESHOLD_MS = 8000
const CHORD_DISPLAY_MS = 2500
const CHORD_DISPLAY_MIN_MS = 1200
const CHORD_SPEEDUP_PER_LEVEL = 80
const ANSWER_TIMEOUT_MS = 6000
const ANSWER_TIMEOUT_MIN_MS = 3000
const ANSWER_SPEEDUP_PER_LEVEL = 120
const RESULT_DISPLAY_MS = 700
const TONE_DURATION_S = 0.45
const TONE_VOLUME = 0.32
const FEVER_COMBO_THRESHOLD = 6
const FEVER_DURATION_MS = 10000
const FEVER_SCORE_MULTIPLIER = 3
const PERFECT_TIME_BONUS_MS = 1500
const HARMONY_BONUS_MULTIPLIER = 1.5
const MAX_NOTES = 7
const CHORD_START_SIZE = 2
const CHORD_GROWTH_INTERVAL = 3

type Phase = 'listen' | 'select' | 'result-correct' | 'result-wrong' | 'game-over'

interface NoteDefinition {
  readonly id: string
  readonly label: string
  readonly frequency: number
  readonly color: string
  readonly activeColor: string
  readonly emoji: string
}

const NOTES: readonly NoteDefinition[] = [
  { id: 'C', label: 'Do', frequency: 261.63, color: '#dc2626', activeColor: '#fca5a5', emoji: '🎵' },
  { id: 'D', label: 'Re', frequency: 293.66, color: '#ea580c', activeColor: '#fdba74', emoji: '🎶' },
  { id: 'E', label: 'Mi', frequency: 329.63, color: '#ca8a04', activeColor: '#fde047', emoji: '🎼' },
  { id: 'F', label: 'Fa', frequency: 349.23, color: '#16a34a', activeColor: '#86efac', emoji: '🎹' },
  { id: 'G', label: 'Sol', frequency: 392.00, color: '#2563eb', activeColor: '#93c5fd', emoji: '🎸' },
  { id: 'A', label: 'La', frequency: 440.00, color: '#7c3aed', activeColor: '#c4b5fd', emoji: '🎺' },
  { id: 'B', label: 'Si', frequency: 493.88, color: '#db2777', activeColor: '#f9a8d4', emoji: '🎻' },
] as const

// ─── Chord Progressions (predefined musical chords) ──────────
interface ChordType {
  readonly name: string
  readonly intervals: readonly number[]
  readonly color: string
}

const CHORD_TYPES: readonly ChordType[] = [
  { name: 'Major', intervals: [0, 4, 7], color: '#f59e0b' },
  { name: 'Minor', intervals: [0, 3, 7], color: '#6366f1' },
  { name: 'Dim', intervals: [0, 3, 6], color: '#ef4444' },
  { name: 'Aug', intervals: [0, 4, 8], color: '#10b981' },
  { name: 'Sus4', intervals: [0, 5, 7], color: '#8b5cf6' },
  { name: 'Power', intervals: [0, 7], color: '#f97316' },
  { name: '7th', intervals: [0, 4, 7, 10], color: '#ec4899' },
] as const

function generateChord(level: number): { noteIndices: number[]; chordName: string } {
  const chordSize = Math.min(MAX_NOTES, CHORD_START_SIZE + Math.floor(level / CHORD_GROWTH_INTERVAL))
  const rootIndex = Math.floor(Math.random() * NOTES.length)

  if (level >= 5 && Math.random() < 0.5) {
    const chordType = CHORD_TYPES[Math.floor(Math.random() * CHORD_TYPES.length)]
    const indices = chordType.intervals
      .slice(0, chordSize)
      .map(interval => (rootIndex + interval) % NOTES.length)
    const unique = [...new Set(indices)]
    return { noteIndices: unique, chordName: `${NOTES[rootIndex].id} ${chordType.name}` }
  }

  const indices = new Set<number>([rootIndex])
  while (indices.size < chordSize) {
    indices.add(Math.floor(Math.random() * NOTES.length))
  }
  return { noteIndices: [...indices], chordName: `${chordSize}-Note Chord` }
}

function playChord(audioContext: AudioContext, noteIndices: number[], duration: number, volume: number): void {
  const now = audioContext.currentTime
  for (const idx of noteIndices) {
    const note = NOTES[idx % NOTES.length]
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(note.frequency, now)

    const noteVolume = volume / Math.sqrt(noteIndices.length)
    gainNode.gain.setValueAtTime(noteVolume, now)
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start(now)
    oscillator.stop(now + duration)
  }
}

const SFX_CACHE = new Map<string, HTMLAudioElement>()
function playSfx(src: string, volume = 0.5): void {
  try {
    let audio = SFX_CACHE.get(src)
    if (!audio) {
      audio = new Audio(src)
      SFX_CACHE.set(src, audio)
    }
    audio.volume = volume
    audio.currentTime = 0
    void audio.play().catch(() => {})
  } catch {}
}

function playNote(audioContext: AudioContext, frequency: number, duration: number, volume: number): void {
  const now = audioContext.currentTime
  const oscillator = audioContext.createOscillator()
  const gainNode = audioContext.createGain()

  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, now)
  gainNode.gain.setValueAtTime(volume, now)
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration)

  oscillator.connect(gainNode)
  gainNode.connect(audioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + duration)
}

function playSuccessJingle(audioContext: AudioContext): void {
  const now = audioContext.currentTime
  const freqs = [523.25, 659.25, 783.99]
  freqs.forEach((freq, i) => {
    const osc = audioContext.createOscillator()
    const gain = audioContext.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + i * 0.1)
    gain.gain.setValueAtTime(0.2, now + i * 0.1)
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3)
    osc.connect(gain)
    gain.connect(audioContext.destination)
    osc.start(now + i * 0.1)
    osc.stop(now + i * 0.1 + 0.3)
  })
}

function playFailBuzz(audioContext: AudioContext): void {
  const now = audioContext.currentTime
  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(120, now)
  gain.gain.setValueAtTime(0.15, now)
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4)
  osc.connect(gain)
  gain.connect(audioContext.destination)
  osc.start(now)
  osc.stop(now + 0.4)
}

function playFeverStart(audioContext: AudioContext): void {
  const now = audioContext.currentTime
  const freqs = [392, 523.25, 659.25, 783.99, 1046.5]
  freqs.forEach((freq, i) => {
    const osc = audioContext.createOscillator()
    const gain = audioContext.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, now + i * 0.08)
    gain.gain.setValueAtTime(0.18, now + i * 0.08)
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.35)
    osc.connect(gain)
    gain.connect(audioContext.destination)
    osc.start(now + i * 0.08)
    osc.stop(now + i * 0.08 + 0.35)
  })
}

// ─── CSS ─────────────────────────────────────────────────────────
const MUSIC_HARMONY_CSS = `
  ${GAME_EFFECTS_CSS}

  .mh-root {
    position: relative;
    width: 100%;
    height: 100%;
    max-width: 432px;
    margin: 0 auto;
    background: linear-gradient(180deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: 'Segoe UI', system-ui, sans-serif;
    user-select: none;
    touch-action: manipulation;
  }

  .mh-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    z-index: 10;
  }

  .mh-score {
    font-size: 2rem;
    font-weight: 900;
    color: #fbbf24;
    text-shadow: 0 2px 8px rgba(251, 191, 36, 0.5);
    min-width: 80px;
  }

  .mh-level-badge {
    background: rgba(255,255,255,0.15);
    border-radius: 20px;
    padding: 4px 14px;
    font-size: 1rem;
    font-weight: 700;
    color: #e2e8f0;
    backdrop-filter: blur(4px);
  }

  .mh-timer-bar {
    height: 6px;
    background: rgba(255,255,255,0.1);
    border-radius: 3px;
    margin: 0 16px;
    overflow: hidden;
  }

  .mh-timer-fill {
    height: 100%;
    border-radius: 3px;
    transition: width 0.1s linear;
  }

  .mh-combo {
    text-align: center;
    font-size: 1.4rem;
    font-weight: 800;
    min-height: 32px;
    line-height: 32px;
    text-shadow: 0 2px 6px rgba(0,0,0,0.4);
  }

  .mh-chord-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 8px 16px;
    min-height: 0;
  }

  .mh-chord-name {
    font-size: 1.6rem;
    font-weight: 800;
    color: #e2e8f0;
    margin-bottom: 12px;
    text-shadow: 0 2px 8px rgba(0,0,0,0.5);
  }

  .mh-chord-display {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
    align-items: center;
    min-height: 80px;
    padding: 16px;
    background: rgba(255,255,255,0.06);
    border-radius: 20px;
    border: 2px solid rgba(255,255,255,0.1);
    width: 100%;
    max-width: 380px;
  }

  .mh-chord-note {
    width: clamp(44px, 12vw, 56px);
    height: clamp(44px, 12vw, 56px);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    font-weight: 800;
    color: #fff;
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
    animation: mh-note-pop 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }

  .mh-chord-note.hidden {
    background: rgba(255,255,255,0.2) !important;
    color: transparent;
    text-shadow: none;
  }

  .mh-chord-note.hidden::after {
    content: '?';
    color: rgba(255,255,255,0.6);
    font-size: 1.4rem;
  }

  @keyframes mh-note-pop {
    0% { transform: scale(0); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  .mh-instruction {
    font-size: 1.2rem;
    color: rgba(255,255,255,0.7);
    text-align: center;
    margin: 12px 0;
    font-weight: 600;
  }

  .mh-note-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    padding: 12px 16px 20px;
    width: 100%;
  }

  .mh-note-grid.seven-notes {
    grid-template-columns: repeat(4, 1fr);
  }

  .mh-note-btn {
    aspect-ratio: 1;
    border: none;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-size: 1.3rem;
    font-weight: 800;
    color: #fff;
    cursor: pointer;
    transition: transform 0.1s, box-shadow 0.1s;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3), inset 0 -3px 0 rgba(0,0,0,0.2);
    position: relative;
    overflow: hidden;
    touch-action: manipulation;
    min-height: 70px;
  }

  .mh-note-btn:active {
    transform: scale(0.92);
    box-shadow: 0 2px 6px rgba(0,0,0,0.3), inset 0 -1px 0 rgba(0,0,0,0.2);
  }

  .mh-note-btn.selected {
    transform: scale(1.08);
    box-shadow: 0 0 20px currentColor, 0 4px 12px rgba(0,0,0,0.3);
    border: 3px solid rgba(255,255,255,0.8);
  }

  .mh-note-btn.correct-flash {
    animation: mh-correct-pulse 0.5s ease;
  }

  .mh-note-btn.wrong-flash {
    animation: mh-wrong-shake 0.4s ease;
  }

  .mh-note-label {
    font-size: 0.75rem;
    opacity: 0.8;
    margin-top: 2px;
  }

  .mh-note-emoji {
    font-size: 1.6rem;
    line-height: 1;
  }

  @keyframes mh-correct-pulse {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.15); filter: brightness(1.5); }
  }

  @keyframes mh-wrong-shake {
    0%, 100% { transform: translateX(0); }
    20% { transform: translateX(-6px); }
    40% { transform: translateX(6px); }
    60% { transform: translateX(-4px); }
    80% { transform: translateX(4px); }
  }

  .mh-submit-row {
    display: flex;
    gap: 10px;
    padding: 0 16px 16px;
  }

  .mh-submit-btn {
    flex: 1;
    height: 56px;
    border: none;
    border-radius: 14px;
    font-size: 1.3rem;
    font-weight: 800;
    color: #fff;
    cursor: pointer;
    transition: transform 0.1s, opacity 0.2s;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    touch-action: manipulation;
  }

  .mh-submit-btn:active {
    transform: scale(0.95);
  }

  .mh-submit-btn.confirm {
    background: linear-gradient(135deg, #22c55e, #16a34a);
  }

  .mh-submit-btn.confirm:disabled {
    background: rgba(255,255,255,0.15);
    cursor: default;
  }

  .mh-submit-btn.replay {
    background: linear-gradient(135deg, #3b82f6, #2563eb);
    flex: 0.5;
  }

  .mh-result-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    pointer-events: none;
  }

  .mh-result-text {
    font-size: 3rem;
    font-weight: 900;
    text-shadow: 0 4px 16px rgba(0,0,0,0.5);
    animation: mh-result-zoom 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes mh-result-zoom {
    0% { transform: scale(0.3); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
  }

  .mh-fever-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
    background: linear-gradient(180deg,
      rgba(251, 191, 36, 0.08) 0%,
      transparent 30%,
      transparent 70%,
      rgba(251, 191, 36, 0.08) 100%
    );
    animation: mh-fever-pulse 1s ease-in-out infinite alternate;
  }

  @keyframes mh-fever-pulse {
    0% { opacity: 0.5; }
    100% { opacity: 1; }
  }

  .mh-fever-badge {
    position: absolute;
    top: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #f59e0b, #ef4444);
    color: #fff;
    font-size: 1.4rem;
    font-weight: 900;
    padding: 6px 24px;
    border-radius: 24px;
    z-index: 15;
    animation: mh-fever-bounce 0.6s ease infinite alternate;
    box-shadow: 0 0 24px rgba(245, 158, 11, 0.6);
    text-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }

  @keyframes mh-fever-bounce {
    0% { transform: translateX(-50%) scale(1); }
    100% { transform: translateX(-50%) scale(1.08); }
  }

  .mh-answer-timer {
    height: 4px;
    background: rgba(255,255,255,0.1);
    border-radius: 2px;
    margin: 4px 16px;
    overflow: hidden;
  }

  .mh-answer-timer-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.1s linear;
    background: linear-gradient(90deg, #22c55e, #eab308, #ef4444);
  }

  .mh-stars {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
    overflow: hidden;
  }

  .mh-star {
    position: absolute;
    width: 3px;
    height: 3px;
    background: rgba(255,255,255,0.6);
    border-radius: 50%;
    animation: mh-twinkle var(--dur) ease-in-out infinite alternate;
    animation-delay: var(--delay);
  }

  @keyframes mh-twinkle {
    0% { opacity: 0.2; transform: scale(0.5); }
    100% { opacity: 1; transform: scale(1.2); }
  }

  .mh-wave-viz {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 60px;
    pointer-events: none;
    z-index: 2;
    overflow: hidden;
  }

  .mh-wave-line {
    position: absolute;
    bottom: 0;
    left: -10%;
    width: 120%;
    height: 40px;
    border-radius: 50% 50% 0 0;
    animation: mh-wave-float var(--dur) ease-in-out infinite alternate;
    animation-delay: var(--delay);
  }

  @keyframes mh-wave-float {
    0% { transform: translateY(0) scaleY(1); }
    100% { transform: translateY(-8px) scaleY(0.7); }
  }

  .mh-game-over-screen {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0,0,0,0.85);
    z-index: 100;
    animation: mh-fade-in 0.5s ease;
  }

  @keyframes mh-fade-in {
    0% { opacity: 0; }
    100% { opacity: 1; }
  }

  .mh-game-over-title {
    font-size: 2.8rem;
    font-weight: 900;
    color: #fbbf24;
    text-shadow: 0 4px 16px rgba(251, 191, 36, 0.5);
    margin-bottom: 16px;
  }

  .mh-game-over-score {
    font-size: 3.5rem;
    font-weight: 900;
    color: #fff;
    text-shadow: 0 4px 12px rgba(0,0,0,0.5);
    margin-bottom: 8px;
  }

  .mh-game-over-level {
    font-size: 1.4rem;
    color: rgba(255,255,255,0.7);
    margin-bottom: 24px;
  }

  .mh-game-over-stats {
    display: flex;
    gap: 24px;
    margin-bottom: 32px;
  }

  .mh-stat {
    text-align: center;
  }

  .mh-stat-value {
    font-size: 2rem;
    font-weight: 900;
    color: #fbbf24;
  }

  .mh-stat-label {
    font-size: 0.85rem;
    color: rgba(255,255,255,0.6);
  }

  .mh-listening-anim {
    display: flex;
    gap: 6px;
    align-items: flex-end;
    height: 50px;
    margin: 16px 0;
  }

  .mh-listening-bar {
    width: 8px;
    background: linear-gradient(180deg, #fbbf24, #f59e0b);
    border-radius: 4px;
    animation: mh-listening-bounce var(--dur) ease-in-out infinite alternate;
    animation-delay: var(--delay);
  }

  @keyframes mh-listening-bounce {
    0% { height: 12px; }
    100% { height: var(--max-h); }
  }
`

// ─── Background Stars ────────────────────────────────────────────
const BG_STARS = Array.from({ length: 30 }, (_, i) => ({
  left: `${Math.random() * 100}%`,
  top: `${Math.random() * 100}%`,
  delay: `${Math.random() * 4}s`,
  dur: `${2 + Math.random() * 3}s`,
}))

const WAVE_LINES = [
  { color: 'rgba(99, 102, 241, 0.15)', dur: '3s', delay: '0s' },
  { color: 'rgba(168, 85, 247, 0.1)', dur: '4s', delay: '0.5s' },
  { color: 'rgba(236, 72, 153, 0.08)', dur: '3.5s', delay: '1s' },
]

const LISTENING_BARS = Array.from({ length: 7 }, (_, i) => ({
  delay: `${i * 0.12}s`,
  dur: `${0.4 + Math.random() * 0.3}s`,
  maxH: `${20 + Math.random() * 30}px`,
}))

// ─── Component ───────────────────────────────────────────────────
function MusicHarmonyGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<Phase>('listen')
  const [currentChord, setCurrentChord] = useState<number[]>([])
  const [chordName, setChordName] = useState('')
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set())
  const [combo, setCombo] = useState(0)
  const [maxCombo, setMaxCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [answerTimerMs, setAnswerTimerMs] = useState(ANSWER_TIMEOUT_MS)
  const [correctCount, setCorrectCount] = useState(0)
  const [wrongCount, setWrongCount] = useState(0)
  const [showListening, setShowListening] = useState(true)
  const [noteFlash, setNoteFlash] = useState<Record<number, 'correct' | 'wrong'>>({})
  const [perfectStreak, setPerfectStreak] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const levelRef = useRef(1)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const phaseRef = useRef<Phase>('listen')
  const currentChordRef = useRef<number[]>([])
  const selectedNotesRef = useRef<Set<number>>(new Set())
  const comboRef = useRef(0)
  const finishedRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const answerTimerMsRef = useRef(ANSWER_TIMEOUT_MS)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const correctCountRef = useRef(0)
  const lowTimeSecondRef = useRef<number | null>(null)
  const perfectStreakRef = useRef(0)

  const getAudioContext = useCallback((): AudioContext => {
    if (audioCtxRef.current === null || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      void audioCtxRef.current.resume().catch(() => {})
    }
    return audioCtxRef.current
  }, [])

  const getAnswerTimeout = useCallback(() => {
    return Math.max(ANSWER_TIMEOUT_MIN_MS, ANSWER_TIMEOUT_MS - (levelRef.current - 1) * ANSWER_SPEEDUP_PER_LEVEL)
  }, [])

  const getChordDisplayTime = useCallback(() => {
    return Math.max(CHORD_DISPLAY_MIN_MS, CHORD_DISPLAY_MS - (levelRef.current - 1) * CHORD_SPEEDUP_PER_LEVEL)
  }, [])

  const startNewChord = useCallback(() => {
    const { noteIndices, chordName: name } = generateChord(levelRef.current)
    currentChordRef.current = noteIndices
    setCurrentChord(noteIndices)
    setChordName(name)
    selectedNotesRef.current = new Set()
    setSelectedNotes(new Set())
    setNoteFlash({})
    phaseRef.current = 'listen'
    setPhase('listen')
    setShowListening(true)

    const answerTimeout = getAnswerTimeout()
    answerTimerMsRef.current = answerTimeout
    setAnswerTimerMs(answerTimeout)

    try {
      const ctx = getAudioContext()
      playChord(ctx, noteIndices, TONE_DURATION_S, TONE_VOLUME)
    } catch {}

    const displayTime = getChordDisplayTime()
    setTimeout(() => {
      if (phaseRef.current === 'listen' && !finishedRef.current) {
        phaseRef.current = 'select'
        setPhase('select')
        setShowListening(false)
      }
    }, displayTime)
  }, [getAudioContext, getAnswerTimeout, getChordDisplayTime])

  const handleCorrect = useCallback(() => {
    const newCombo = comboRef.current + 1
    comboRef.current = newCombo
    setCombo(newCombo)
    if (newCombo > (maxCombo)) setMaxCombo(newCombo)

    correctCountRef.current += 1
    setCorrectCount(correctCountRef.current)

    const basePoints = 100 * currentChordRef.current.length
    const comboBonus = Math.floor(basePoints * (newCombo * 0.15))
    const isHarmonyBonus = currentChordRef.current.length >= 3
    const harmonyPoints = isHarmonyBonus ? Math.floor(basePoints * HARMONY_BONUS_MULTIPLIER) : basePoints
    const feverMul = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
    const totalPoints = (harmonyPoints + comboBonus) * feverMul

    const perfect = answerTimerMsRef.current > getAnswerTimeout() * 0.7
    if (perfect) {
      perfectStreakRef.current += 1
      setPerfectStreak(perfectStreakRef.current)
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + PERFECT_TIME_BONUS_MS)
    } else {
      perfectStreakRef.current = 0
      setPerfectStreak(0)
    }

    scoreRef.current += totalPoints
    setScore(scoreRef.current)

    effects.spawnParticles(50, 50, NOTES[currentChordRef.current[0]].color)
    effects.addScorePopup(totalPoints, 50, 40)
    if (isHarmonyBonus) effects.triggerFlash('#fbbf24')

    try {
      playSuccessJingle(getAudioContext())
    } catch {}
    playSfx(correctSfxSrc, 0.4)

    if (!feverRef.current && newCombo >= FEVER_COMBO_THRESHOLD) {
      feverRef.current = true
      feverRemainingMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverRemainingMs(FEVER_DURATION_MS)
      try { playFeverStart(getAudioContext()) } catch {}
      playSfx(feverSfxSrc, 0.5)
    }

    const newLevel = Math.floor(correctCountRef.current / 3) + 1
    if (newLevel > levelRef.current) {
      levelRef.current = newLevel
      setLevel(newLevel)
      playSfx(levelUpSfxSrc, 0.45)
    }

    phaseRef.current = 'result-correct'
    setPhase('result-correct')

    // flash correct notes
    const flash: Record<number, 'correct'> = {}
    for (const idx of currentChordRef.current) flash[idx] = 'correct'
    setNoteFlash(flash)

    setTimeout(() => {
      if (!finishedRef.current) startNewChord()
    }, RESULT_DISPLAY_MS)
  }, [effects, getAudioContext, getAnswerTimeout, maxCombo, startNewChord])

  const handleWrong = useCallback(() => {
    comboRef.current = 0
    setCombo(0)
    perfectStreakRef.current = 0
    setPerfectStreak(0)
    setWrongCount(prev => prev + 1)

    effects.triggerShake()
    effects.triggerFlash('#ef4444')

    try { playFailBuzz(getAudioContext()) } catch {}
    playSfx(wrongSfxSrc, 0.4)

    phaseRef.current = 'result-wrong'
    setPhase('result-wrong')

    // flash wrong notes (selected but wrong)
    const flash: Record<number, 'correct' | 'wrong'> = {}
    for (const idx of currentChordRef.current) flash[idx] = 'correct'
    for (const idx of selectedNotesRef.current) {
      if (!currentChordRef.current.includes(idx)) flash[idx] = 'wrong'
    }
    setNoteFlash(flash)

    setTimeout(() => {
      if (!finishedRef.current) startNewChord()
    }, RESULT_DISPLAY_MS)
  }, [effects, getAudioContext, startNewChord])

  const handleNoteToggle = useCallback((noteIndex: number) => {
    if (phaseRef.current !== 'select' || finishedRef.current) return

    try {
      playNote(getAudioContext(), NOTES[noteIndex].frequency, 0.25, 0.25)
    } catch {}
    playSfx(tapSfxSrc, 0.3)

    const newSet = new Set(selectedNotesRef.current)
    if (newSet.has(noteIndex)) {
      newSet.delete(noteIndex)
    } else {
      newSet.add(noteIndex)
    }
    selectedNotesRef.current = newSet
    setSelectedNotes(new Set(newSet))
  }, [getAudioContext])

  const handleSubmit = useCallback(() => {
    if (phaseRef.current !== 'select' || finishedRef.current) return
    if (selectedNotesRef.current.size === 0) return

    const target = new Set(currentChordRef.current)
    const selected = selectedNotesRef.current

    if (target.size === selected.size && [...target].every(n => selected.has(n))) {
      handleCorrect()
    } else {
      handleWrong()
    }
  }, [handleCorrect, handleWrong])

  const handleReplay = useCallback(() => {
    if (phaseRef.current !== 'select' || finishedRef.current) return
    try {
      const ctx = getAudioContext()
      playChord(ctx, currentChordRef.current, TONE_DURATION_S, TONE_VOLUME)
    } catch {}
  }, [getAudioContext])

  const endGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    phaseRef.current = 'game-over'
    setPhase('game-over')

    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)

    setTimeout(() => {
      onFinish({ score: scoreRef.current, durationMs: ROUND_DURATION_MS })
    }, 2000)
  }, [onFinish])

  // Game loop
  useEffect(() => {
    startNewChord()

    const loop = (now: number) => {
      if (finishedRef.current) return

      const last = lastFrameRef.current ?? now
      lastFrameRef.current = now
      let delta = now - last
      if (delta > MAX_FRAME_DELTA_MS) delta = DEFAULT_FRAME_MS
      if (delta <= 0) { animFrameRef.current = requestAnimationFrame(loop); return }

      // Timer
      remainingMsRef.current -= delta
      setRemainingMs(Math.max(0, remainingMsRef.current))

      if (remainingMsRef.current <= 0) {
        endGame()
        return
      }

      // Low time warning
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const currentSecond = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== currentSecond) {
          lowTimeSecondRef.current = currentSecond
          try {
            const ctx = getAudioContext()
            const osc = ctx.createOscillator()
            const gain = ctx.createGain()
            osc.type = 'sine'
            osc.frequency.setValueAtTime(880, ctx.currentTime)
            gain.gain.setValueAtTime(0.1, ctx.currentTime)
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
            osc.connect(gain)
            gain.connect(ctx.destination)
            osc.start(ctx.currentTime)
            osc.stop(ctx.currentTime + 0.1)
          } catch {}
          playSfx(warningSfxSrc, 0.3)
        }
      }

      // Fever timer
      if (feverRef.current) {
        feverRemainingMsRef.current -= delta
        setFeverRemainingMs(Math.max(0, feverRemainingMsRef.current))
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Answer timer
      if (phaseRef.current === 'select') {
        answerTimerMsRef.current -= delta
        setAnswerTimerMs(Math.max(0, answerTimerMsRef.current))
        if (answerTimerMsRef.current <= 0) {
          handleWrong()
        }
      }

      animFrameRef.current = requestAnimationFrame(loop)
    }

    animFrameRef.current = requestAnimationFrame(loop)

    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
      if (audioCtxRef.current) {
        try { void audioCtxRef.current.close() } catch {}
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const timerPct = (remainingMs / ROUND_DURATION_MS) * 100
  const timerColor = remainingMs <= LOW_TIME_THRESHOLD_MS ? '#ef4444' : remainingMs <= 20000 ? '#eab308' : '#22c55e'
  const answerPct = (answerTimerMs / getAnswerTimeout()) * 100
  const comboLabel = combo >= 2 ? getComboLabel(combo) : ''
  const comboColor = combo >= 2 ? getComboColor(combo) : '#fff'

  return (
    <>
      <style>{MUSIC_HARMONY_CSS}</style>
      <div className="mh-root" style={effects.isShaking ? { animation: 'game-fx-shake 0.3s ease' } : undefined}>
        {/* Background stars */}
        <div className="mh-stars">
          {BG_STARS.map((s, i) => (
            <div key={i} className="mh-star" style={{
              left: s.left, top: s.top,
              '--delay': s.delay, '--dur': s.dur,
            } as React.CSSProperties} />
          ))}
        </div>

        {/* Wave visualization */}
        <div className="mh-wave-viz">
          {WAVE_LINES.map((w, i) => (
            <div key={i} className="mh-wave-line" style={{
              background: w.color,
              '--dur': w.dur, '--delay': w.delay,
            } as React.CSSProperties} />
          ))}
        </div>

        {/* Fever overlay */}
        {isFever && <div className="mh-fever-overlay" />}
        {isFever && (
          <div className="mh-fever-badge">
            FEVER x{FEVER_SCORE_MULTIPLIER} ({Math.ceil(feverRemainingMs / 1000)}s)
          </div>
        )}

        {/* Header */}
        <div className="mh-header" style={{ zIndex: 10 }}>
          <div className="mh-score">{score.toLocaleString()}</div>
          <div className="mh-level-badge">Lv.{level}</div>
          <div className="mh-level-badge" style={{ background: 'rgba(251,191,36,0.2)', color: '#fbbf24' }}>
            {combo}x
          </div>
        </div>

        {/* Timer bar */}
        <div className="mh-timer-bar">
          <div className="mh-timer-fill" style={{
            width: `${timerPct}%`,
            background: timerColor,
          }} />
        </div>

        {/* Combo label */}
        <div className="mh-combo" style={{ color: comboColor }}>
          {comboLabel}
          {perfectStreak >= 2 && <span style={{ color: '#fbbf24', marginLeft: 8 }}>Perfect x{perfectStreak}</span>}
        </div>

        {/* Chord display area */}
        <div className="mh-chord-area">
          <div className="mh-chord-name">{chordName}</div>

          {/* Listening animation */}
          {phase === 'listen' && showListening && (
            <div className="mh-listening-anim">
              {LISTENING_BARS.map((b, i) => (
                <div key={i} className="mh-listening-bar" style={{
                  '--delay': b.delay, '--dur': b.dur, '--max-h': b.maxH,
                } as React.CSSProperties} />
              ))}
            </div>
          )}

          {/* Chord notes display */}
          <div className="mh-chord-display">
            {currentChord.map((noteIdx, i) => {
              const note = NOTES[noteIdx]
              const isListening = phase === 'listen'
              const isResult = phase === 'result-correct' || phase === 'result-wrong'
              const showNote = isListening || isResult
              const flashClass = noteFlash[noteIdx] === 'correct' ? 'correct-flash' : noteFlash[noteIdx] === 'wrong' ? 'wrong-flash' : ''
              return (
                <div
                  key={`${noteIdx}-${i}`}
                  className={`mh-chord-note ${showNote ? '' : 'hidden'} ${flashClass}`}
                  style={{
                    background: showNote ? note.color : undefined,
                    animationDelay: `${i * 0.08}s`,
                  }}
                >
                  {showNote ? note.label : ''}
                </div>
              )
            })}
          </div>

          {phase === 'listen' && (
            <div className="mh-instruction">Listen to the chord...</div>
          )}
          {phase === 'select' && (
            <div className="mh-instruction">Select the notes you heard!</div>
          )}
        </div>

        {/* Answer timer bar */}
        {phase === 'select' && (
          <div className="mh-answer-timer">
            <div className="mh-answer-timer-fill" style={{ width: `${answerPct}%` }} />
          </div>
        )}

        {/* Note selection grid */}
        <div className={`mh-note-grid ${NOTES.length > 6 ? 'seven-notes' : ''}`}>
          {NOTES.map((note, idx) => {
            const isSelected = selectedNotes.has(idx)
            const flash = noteFlash[idx]
            const flashClass = flash === 'correct' ? 'correct-flash' : flash === 'wrong' ? 'wrong-flash' : ''
            return (
              <button
                key={note.id}
                className={`mh-note-btn ${isSelected ? 'selected' : ''} ${flashClass}`}
                style={{
                  background: isSelected ? note.activeColor : note.color,
                  color: '#fff',
                  opacity: phase === 'select' ? 1 : 0.5,
                }}
                disabled={phase !== 'select'}
                onPointerDown={() => handleNoteToggle(idx)}
              >
                <span className="mh-note-emoji">{note.emoji}</span>
                <span className="mh-note-label">{note.label}</span>
              </button>
            )
          })}
        </div>

        {/* Submit row */}
        <div className="mh-submit-row">
          <button
            className="mh-submit-btn replay"
            disabled={phase !== 'select'}
            onPointerDown={handleReplay}
          >
            Replay
          </button>
          <button
            className="mh-submit-btn confirm"
            disabled={phase !== 'select' || selectedNotes.size === 0}
            onPointerDown={handleSubmit}
          >
            Confirm ({selectedNotes.size}/{currentChord.length})
          </button>
        </div>

        {/* Result overlays */}
        {phase === 'result-correct' && (
          <div className="mh-result-overlay">
            <div className="mh-result-text" style={{ color: '#22c55e' }}>CORRECT!</div>
          </div>
        )}
        {phase === 'result-wrong' && (
          <div className="mh-result-overlay">
            <div className="mh-result-text" style={{ color: '#ef4444' }}>WRONG!</div>
          </div>
        )}

        {/* Game over screen */}
        {phase === 'game-over' && (
          <div className="mh-game-over-screen">
            <div className="mh-game-over-title">GAME OVER</div>
            <div className="mh-game-over-score">{score.toLocaleString()}</div>
            <div className="mh-game-over-level">Level {level}</div>
            <div className="mh-game-over-stats">
              <div className="mh-stat">
                <div className="mh-stat-value">{correctCount}</div>
                <div className="mh-stat-label">Correct</div>
              </div>
              <div className="mh-stat">
                <div className="mh-stat-value">{maxCombo}</div>
                <div className="mh-stat-label">Max Combo</div>
              </div>
              <div className="mh-stat">
                <div className="mh-stat-value">{wrongCount}</div>
                <div className="mh-stat-label">Wrong</div>
              </div>
            </div>
          </div>
        )}

        {/* Effects */}
        <ParticleRenderer particles={effects.particles} />
        <ScorePopupRenderer popups={effects.scorePopups} />
        <FlashOverlay color={effects.flashColor} />
      </div>
    </>
  )
}

export const musicHarmonyModule: MiniGameModule = {
  manifest: {
    id: 'music-harmony',
    title: 'Music Harmony',
    description: 'Listen to chords and pick the right notes! Build combos for fever mode!',
    unlockCost: 80,
    baseReward: 25,
    scoreRewardMultiplier: 0.04,
    accentColor: '#7c3aed',
  },
  Component: MusicHarmonyGame,
}
