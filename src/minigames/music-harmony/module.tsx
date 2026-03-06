import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import correctSfxSrc from '../../../assets/sounds/music-harmony-correct.mp3'
import wrongSfxSrc from '../../../assets/sounds/music-harmony-wrong.mp3'
import feverSfxSrc from '../../../assets/sounds/music-harmony-fever.mp3'
import tapSfxSrc from '../../../assets/sounds/music-harmony-tap.mp3'
import levelUpSfxSrc from '../../../assets/sounds/music-harmony-level-up.mp3'
import warningSfxSrc from '../../../assets/sounds/music-harmony-warning.mp3'
import comboSfxSrc from '../../../assets/sounds/music-harmony-combo.mp3'
import gameoverSfxSrc from '../../../assets/sounds/music-harmony-gameover.mp3'
import hintSfxSrc from '../../../assets/sounds/music-harmony-hint.mp3'
import lifeLostSfxSrc from '../../../assets/sounds/music-harmony-life-lost.mp3'
import streakSfxSrc from '../../../assets/sounds/music-harmony-streak.mp3'

const ROUND_DURATION_MS = 60000
const LOW_TIME_THRESHOLD_MS = 10000
const CHORD_DISPLAY_MS = 1800
const CHORD_DISPLAY_MIN_MS = 600
const CHORD_SPEEDUP_PER_LEVEL = 150
const ANSWER_TIMEOUT_MS = 4500
const ANSWER_TIMEOUT_MIN_MS = 1500
const ANSWER_SPEEDUP_PER_LEVEL = 250
const RESULT_DISPLAY_MS = 450
const TONE_DURATION_S = 0.35
const TONE_VOLUME = 0.3
const FEVER_COMBO_THRESHOLD = 7
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const PERFECT_TIME_BONUS_MS = 1200
const HARMONY_BONUS_MULTIPLIER = 1.5
const MAX_NOTES = 7
const CHORD_START_SIZE = 3
const CHORD_GROWTH_INTERVAL = 2
const MAX_HP = 2
const HINTS_PER_GAME = 1
const BOSS_INTERVAL = 4
const BOSS_BONUS_MULTIPLIER = 3

type Phase = 'listen' | 'select' | 'result-correct' | 'result-wrong' | 'boss-intro' | 'game-over'

interface NoteDefinition { readonly id: string; readonly label: string; readonly frequency: number; readonly color: string; readonly activeColor: string; readonly pixel: string }

const NOTES: readonly NoteDefinition[] = [
  { id: 'C', label: 'Do', frequency: 261.63, color: '#e74c3c', activeColor: '#ff7675', pixel: 'C' },
  { id: 'D', label: 'Re', frequency: 293.66, color: '#e67e22', activeColor: '#ffa502', pixel: 'D' },
  { id: 'E', label: 'Mi', frequency: 329.63, color: '#f1c40f', activeColor: '#ffeaa7', pixel: 'E' },
  { id: 'F', label: 'Fa', frequency: 349.23, color: '#2ecc71', activeColor: '#55efc4', pixel: 'F' },
  { id: 'G', label: 'Sol', frequency: 392.00, color: '#3498db', activeColor: '#74b9ff', pixel: 'G' },
  { id: 'A', label: 'La', frequency: 440.00, color: '#9b59b6', activeColor: '#a29bfe', pixel: 'A' },
  { id: 'B', label: 'Si', frequency: 493.88, color: '#e84393', activeColor: '#fd79a8', pixel: 'B' },
] as const

interface ChordType { readonly name: string; readonly intervals: readonly number[] }
const CHORD_TYPES: readonly ChordType[] = [
  { name: 'Major', intervals: [0, 4, 7] }, { name: 'Minor', intervals: [0, 3, 7] },
  { name: 'Dim', intervals: [0, 3, 6] }, { name: 'Aug', intervals: [0, 4, 8] },
  { name: 'Sus4', intervals: [0, 5, 7] }, { name: 'Power', intervals: [0, 7] },
  { name: '7th', intervals: [0, 4, 7, 10] },
] as const

function generateChord(level: number): { noteIndices: number[]; chordName: string; isBoss: boolean } {
  const isBoss = level > 1 && level % BOSS_INTERVAL === 0
  const chordSize = Math.min(MAX_NOTES, CHORD_START_SIZE + Math.floor(level / CHORD_GROWTH_INTERVAL) + (isBoss ? 1 : 0))
  const rootIndex = Math.floor(Math.random() * NOTES.length)
  if (level >= 4 && Math.random() < 0.5) {
    const ct = CHORD_TYPES[Math.floor(Math.random() * CHORD_TYPES.length)]
    const indices = ct.intervals.slice(0, chordSize).map(iv => (rootIndex + iv) % NOTES.length)
    return { noteIndices: [...new Set(indices)], chordName: `${NOTES[rootIndex].id} ${ct.name}`, isBoss }
  }
  const indices = new Set<number>([rootIndex])
  while (indices.size < chordSize) indices.add(Math.floor(Math.random() * NOTES.length))
  return { noteIndices: [...indices], chordName: `${chordSize}-Note`, isBoss }
}

function playChord(ac: AudioContext, noteIndices: number[], dur: number, vol: number): void {
  const now = ac.currentTime
  for (const idx of noteIndices) {
    const n = NOTES[idx % NOTES.length], o = ac.createOscillator(), g = ac.createGain()
    o.type = 'square'; o.frequency.setValueAtTime(n.frequency, now)
    const v = vol / Math.sqrt(noteIndices.length)
    g.gain.setValueAtTime(v, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur)
    o.connect(g); g.connect(ac.destination); o.start(now); o.stop(now + dur)
  }
}

const SFX_CACHE = new Map<string, HTMLAudioElement>()
function playSfx(src: string, volume = 0.5): void {
  try {
    let a = SFX_CACHE.get(src)
    if (!a) { a = new Audio(src); SFX_CACHE.set(src, a) }
    a.volume = volume; a.currentTime = 0; void a.play().catch(() => {})
  } catch { /* ignore */ }
}

function playNote8bit(ac: AudioContext, freq: number, dur: number, vol: number): void {
  const now = ac.currentTime, o = ac.createOscillator(), g = ac.createGain()
  o.type = 'square'; o.frequency.setValueAtTime(freq, now)
  g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur)
  o.connect(g); g.connect(ac.destination); o.start(now); o.stop(now + dur)
}

function play8bitJingle(ac: AudioContext, asc: boolean): void {
  const now = ac.currentTime, freqs = asc ? [523, 659, 784, 1047] : [784, 523, 330, 262]
  freqs.forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain()
    o.type = 'square'; o.frequency.setValueAtTime(f, now + i * 0.08)
    g.gain.setValueAtTime(0.15, now + i * 0.08); g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2)
    o.connect(g); g.connect(ac.destination); o.start(now + i * 0.08); o.stop(now + i * 0.08 + 0.2)
  })
}

function playBossIntro(ac: AudioContext): void {
  const now = ac.currentTime
  ;[262, 330, 392, 523, 392, 523, 659, 784].forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain()
    o.type = 'square'; o.frequency.setValueAtTime(f, now + i * 0.1)
    g.gain.setValueAtTime(0.12, now + i * 0.1); g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.15)
    o.connect(g); g.connect(ac.destination); o.start(now + i * 0.1); o.stop(now + i * 0.1 + 0.15)
  })
}

const PIXEL_CSS = `${GAME_EFFECTS_CSS}
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
.mh-root{position:relative;width:100%;height:100%;max-width:432px;margin:0 auto;background:#1a1a2e;display:flex;flex-direction:column;overflow:hidden;font-family:'Press Start 2P',monospace,system-ui;user-select:none;touch-action:manipulation;image-rendering:pixelated}
.mh-root::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:16px 16px;pointer-events:none;z-index:0}
.mh-header{display:flex;justify-content:space-between;align-items:center;padding:14px 14px 8px;z-index:10;gap:8px}
.mh-score{font-size:1.6rem;color:#ffd700;text-shadow:2px 2px 0 #b8860b,0 0 8px rgba(255,215,0,.4);min-width:80px}
.mh-hp{display:flex;gap:6px;align-items:center}
.mh-heart{font-size:1.8rem;transition:transform .2s;filter:drop-shadow(0 0 4px rgba(255,0,0,.5))}
.mh-heart.lost{filter:grayscale(1) opacity(.3);transform:scale(.8)}
.mh-heart.hit{animation:mh-hb .4s ease}
@keyframes mh-hb{0%{transform:scale(1)}30%{transform:scale(1.4) rotate(-10deg)}60%{transform:scale(.6) rotate(10deg)}100%{transform:scale(.8);filter:grayscale(1) opacity(.3)}}
.mh-level-badge{background:#2d2d44;border:2px solid #4a4a6a;padding:5px 12px;font-size:.8rem;color:#a0a0cc}
.mh-level-badge.boss{background:#4a1a1a;border-color:#ff4444;color:#ff6666;animation:mh-bp .5s ease infinite alternate}
@keyframes mh-bp{0%{box-shadow:0 0 4px rgba(255,68,68,.3)}100%{box-shadow:0 0 12px rgba(255,68,68,.6)}}
.mh-timer-bar{height:12px;background:#2d2d44;border:2px solid #4a4a6a;margin:6px 14px;overflow:hidden}
.mh-timer-fill{height:100%;transition:width .1s linear}
.mh-combo-row{text-align:center;font-size:1rem;min-height:32px;line-height:32px;padding:4px 0;z-index:10}
.mh-combo-text{display:inline-block;animation:mh-cb .3s ease}
@keyframes mh-cb{0%{transform:scale(.5)}50%{transform:scale(1.3)}100%{transform:scale(1)}}
.mh-chord-area{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:4px 12px;min-height:0;z-index:10}
.mh-chord-name{font-size:1.1rem;color:#a0a0cc;margin-bottom:10px;letter-spacing:3px}
.mh-chord-display{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;align-items:center;min-height:90px;padding:16px;background:#12122a;border:3px solid #3a3a5a;width:100%;max-width:400px;position:relative}
.mh-chord-display::before{content:'LISTEN';position:absolute;top:-12px;left:12px;background:#1a1a2e;padding:0 6px;font-size:.6rem;color:#6a6a8a}
.mh-chord-note{width:clamp(52px,14vw,68px);height:clamp(52px,14vw,68px);display:flex;align-items:center;justify-content:center;font-size:1.1rem;color:#fff;border:3px solid rgba(255,255,255,.3);animation:mh-np .25s steps(4) both}
.mh-chord-note.hidden{background:#2d2d44!important;border-color:#4a4a6a;color:transparent}
.mh-chord-note.hidden::after{content:'?';color:#6a6a8a;font-size:.9rem}
.mh-chord-note.hint-revealed{animation:mh-hg .8s ease infinite alternate}
@keyframes mh-hg{0%{box-shadow:0 0 4px rgba(255,215,0,.3)}100%{box-shadow:0 0 16px rgba(255,215,0,.8);border-color:#ffd700}}
@keyframes mh-np{0%{transform:scale(0);opacity:0}50%{transform:scale(1.1);opacity:.8}100%{transform:scale(1);opacity:1}}
.mh-instruction{font-size:.75rem;color:#6a6a8a;text-align:center;margin:10px 0;letter-spacing:2px}
.mh-waveform{display:flex;gap:3px;align-items:flex-end;height:44px;margin:10px 0;justify-content:center}
.mh-wave-bar{width:5px;background:#ffd700;animation:mh-wd var(--dur) steps(3) infinite alternate;animation-delay:var(--delay)}
@keyframes mh-wd{0%{height:4px;opacity:.4}100%{height:var(--max-h);opacity:1}}
.mh-note-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:8px 12px;width:100%;z-index:10}
.mh-note-btn{aspect-ratio:1;border:4px solid rgba(0,0,0,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;transition:transform .05s steps(2);position:relative;overflow:hidden;touch-action:manipulation;min-height:80px;box-shadow:inset -3px -3px 0 rgba(0,0,0,.3),inset 3px 3px 0 rgba(255,255,255,.15)}
.mh-note-btn:active{transform:scale(.9);box-shadow:inset 3px 3px 0 rgba(0,0,0,.3)}
.mh-note-btn.selected{border-color:#ffd700;box-shadow:0 0 0 3px #ffd700,inset -3px -3px 0 rgba(0,0,0,.3);transform:scale(1.05)}
.mh-note-btn.correct-flash{animation:mh-cf .4s steps(4)}
.mh-note-btn.wrong-flash{animation:mh-wf .3s steps(4)}
@keyframes mh-cf{0%,100%{filter:brightness(1)}25%{filter:brightness(2)}50%{filter:brightness(1.5)}75%{filter:brightness(2)}}
@keyframes mh-wf{0%,100%{transform:translateX(0)}25%{transform:translateX(-4px)}75%{transform:translateX(4px)}}
.mh-note-letter{font-size:1.5rem;color:#fff;text-shadow:2px 2px 0 rgba(0,0,0,.5)}
.mh-note-name{font-size:.6rem;color:rgba(255,255,255,.7);margin-top:4px}
.mh-bottom-row{display:flex;gap:8px;padding:8px 12px 16px;z-index:10}
.mh-btn{flex:1;height:64px;border:4px solid rgba(0,0,0,.4);font-family:'Press Start 2P',monospace;font-size:.75rem;color:#fff;cursor:pointer;touch-action:manipulation;box-shadow:inset -3px -3px 0 rgba(0,0,0,.3),inset 3px 3px 0 rgba(255,255,255,.15);transition:transform .05s steps(2)}
.mh-btn:active{transform:scale(.92);box-shadow:inset 3px 3px 0 rgba(0,0,0,.3)}
.mh-btn.confirm{background:#2ecc71}.mh-btn.confirm:disabled{background:#2d2d44;color:#4a4a6a;cursor:default}
.mh-btn.hint{background:#f39c12;flex:.5}.mh-btn.hint:disabled{background:#2d2d44;color:#4a4a6a}
.mh-answer-timer{height:10px;background:#2d2d44;border:2px solid #3a3a5a;margin:4px 14px;overflow:hidden}
.mh-answer-timer-fill{height:100%;transition:width .1s linear}
.mh-result-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:50;pointer-events:none}
.mh-result-text{font-size:2rem;text-shadow:3px 3px 0 rgba(0,0,0,.5);animation:mh-rp .4s steps(5);letter-spacing:4px}
.mh-result-sub{font-size:.85rem;color:#ffd700;margin-top:10px;animation:mh-rp .4s steps(5) .2s both}
@keyframes mh-rp{0%{transform:scale(0);opacity:0}40%{transform:scale(1.3);opacity:1}100%{transform:scale(1);opacity:1}}
.mh-fever-overlay{position:absolute;inset:0;pointer-events:none;z-index:5;border:4px solid rgba(255,215,0,.4);animation:mh-fb .5s steps(2) infinite alternate}
@keyframes mh-fb{0%{border-color:rgba(255,215,0,.4)}100%{border-color:rgba(255,68,68,.4)}}
.mh-fever-badge{position:absolute;top:44px;left:50%;transform:translateX(-50%);background:#ff4444;border:3px solid #ffd700;color:#ffd700;font-size:.65rem;padding:4px 12px;z-index:15;animation:mh-fbk .3s steps(2) infinite alternate;letter-spacing:2px}
@keyframes mh-fbk{0%{opacity:1}100%{opacity:.6}}
.mh-boss-intro{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.9);z-index:60;animation:mh-fi .3s steps(4)}
.mh-boss-text{font-size:1.2rem;color:#ff4444;text-shadow:3px 3px 0 #8b0000;letter-spacing:4px;animation:mh-bz .8s steps(6) infinite alternate}
.mh-boss-sub{font-size:.5rem;color:#ffd700;margin-top:12px;animation:mh-bbl .4s steps(2) infinite alternate}
@keyframes mh-bz{0%{transform:scale(1)}100%{transform:scale(1.1)}}
@keyframes mh-bbl{0%{opacity:1}100%{opacity:.3}}
.mh-pixel-stars{position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden}
.mh-pixel-star{position:absolute;width:4px;height:4px;animation:mh-sb var(--dur) steps(2) infinite alternate;animation-delay:var(--delay)}
@keyframes mh-sb{0%{opacity:.1}100%{opacity:.8}}
.mh-level-up-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;z-index:55;pointer-events:none;animation:mh-luf .6s steps(3)}
.mh-level-up-text{font-size:1.2rem;color:#ffd700;text-shadow:3px 3px 0 #b8860b;letter-spacing:3px;animation:mh-lug .6s steps(5)}
@keyframes mh-luf{0%{background:rgba(255,215,0,.3)}50%{background:rgba(255,215,0,.1)}100%{background:transparent}}
@keyframes mh-lug{0%{transform:scale(.3)}40%{transform:scale(1.5)}100%{transform:scale(1)}}
@keyframes mh-fi{0%{opacity:0}100%{opacity:1}}
.mh-game-over{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(0,0,0,.92);z-index:100;animation:mh-fi .5s steps(5)}
.mh-go-title{font-size:1.8rem;color:#ff4444;text-shadow:3px 3px 0 #8b0000;margin-bottom:20px;letter-spacing:4px}
.mh-go-score{font-size:2.5rem;color:#ffd700;text-shadow:3px 3px 0 #b8860b;margin-bottom:10px}
.mh-go-level{font-size:.85rem;color:#a0a0cc;margin-bottom:24px}
.mh-go-stats{display:flex;gap:28px;margin-bottom:28px}
.mh-go-stat{text-align:center}.mh-go-stat-val{font-size:1.4rem;color:#ffd700}.mh-go-stat-lbl{font-size:.55rem;color:#6a6a8a;margin-top:6px}
.mh-scanlines{position:absolute;inset:0;pointer-events:none;z-index:200;background:repeating-linear-gradient(transparent 0px,transparent 2px,rgba(0,0,0,.08) 2px,rgba(0,0,0,.08) 4px)}
.mh-note-btn::after{content:'';position:absolute;inset:0;background:rgba(255,255,255,.3);opacity:0;transition:opacity .1s}
.mh-note-btn:active::after{opacity:1}`

const PIXEL_STARS = Array.from({ length: 40 }, () => ({
  left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
  delay: `${Math.random() * 5}s`, dur: `${1.5 + Math.random() * 3}s`,
  color: ['#ffd700', '#ff4444', '#3498db', '#2ecc71', '#e84393', '#fff'][Math.floor(Math.random() * 6)],
}))

const WAVEFORM_BARS = Array.from({ length: 16 }, (_, i) => ({
  delay: `${i * 0.06}s`, dur: `${0.3 + Math.random() * 0.25}s`, maxH: `${8 + Math.random() * 28}px`,
}))

function MusicHarmonyGame({ onFinish, onExit: _onExit, bestScore: _bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [hp, setHp] = useState(MAX_HP)
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
  const [noteFlash, setNoteFlash] = useState<Record<number, 'correct' | 'wrong'>>({})
  const [perfectStreak, setPerfectStreak] = useState(0)
  const [hintsLeft, setHintsLeft] = useState(HINTS_PER_GAME)
  const [hintRevealed, setHintRevealed] = useState<number | null>(null)
  const [isBossRound, setIsBossRound] = useState(false)
  const [showLevelUp, setShowLevelUp] = useState(false)
  const [heartHitIdx, setHeartHitIdx] = useState<number | null>(null)
  const [lastScoreGain, setLastScoreGain] = useState(0)

  const effects = useGameEffects()
  const scoreRef = useRef(0)
  const levelRef = useRef(1)
  const hpRef = useRef(MAX_HP)
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
  const hintsLeftRef = useRef(HINTS_PER_GAME)
  const isBossRef = useRef(false)

  const getAc = useCallback((): AudioContext => {
    if (audioCtxRef.current === null || audioCtxRef.current.state === 'closed') audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === 'suspended') void audioCtxRef.current.resume().catch(() => {})
    return audioCtxRef.current
  }, [])

  const getAnsTimeout = useCallback(() => {
    const base = isBossRef.current ? ANSWER_TIMEOUT_MS + 2000 : ANSWER_TIMEOUT_MS
    return Math.max(ANSWER_TIMEOUT_MIN_MS, base - (levelRef.current - 1) * ANSWER_SPEEDUP_PER_LEVEL)
  }, [])

  const getDispTime = useCallback(() => {
    const base = isBossRef.current ? CHORD_DISPLAY_MS + 500 : CHORD_DISPLAY_MS
    return Math.max(CHORD_DISPLAY_MIN_MS, base - (levelRef.current - 1) * CHORD_SPEEDUP_PER_LEVEL)
  }, [])

  const beginChordPhase = useCallback((noteIndices: number[], name: string) => {
    currentChordRef.current = noteIndices
    setCurrentChord(noteIndices); setChordName(name)
    selectedNotesRef.current = new Set(); setSelectedNotes(new Set()); setNoteFlash({})
    phaseRef.current = 'listen'; setPhase('listen')
    const t = getAnsTimeout(); answerTimerMsRef.current = t; setAnswerTimerMs(t)
    try { playChord(getAc(), noteIndices, TONE_DURATION_S, TONE_VOLUME) } catch { /* */ }
    const dt = getDispTime()
    setTimeout(() => { if (phaseRef.current === 'listen' && !finishedRef.current) { phaseRef.current = 'select'; setPhase('select') } }, dt)
  }, [getAc, getAnsTimeout, getDispTime])

  const startNewChord = useCallback(() => {
    const { noteIndices, chordName: name, isBoss } = generateChord(levelRef.current)
    isBossRef.current = isBoss; setIsBossRound(isBoss); setHintRevealed(null)
    if (isBoss) {
      phaseRef.current = 'boss-intro'; setPhase('boss-intro')
      try { playBossIntro(getAc()) } catch { /* */ }
      setTimeout(() => { if (!finishedRef.current) beginChordPhase(noteIndices, name) }, 1200)
      return
    }
    beginChordPhase(noteIndices, name)
  }, [getAc, beginChordPhase])

  const endGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true; phaseRef.current = 'game-over'; setPhase('game-over')
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current)
    try { play8bitJingle(getAc(), false) } catch { /* */ }
    playSfx(gameoverSfxSrc, 0.5)
    setTimeout(() => onFinish({ score: scoreRef.current, durationMs: ROUND_DURATION_MS }), 2500)
  }, [onFinish, getAc])

  const handleCorrect = useCallback(() => {
    const nc = comboRef.current + 1; comboRef.current = nc; setCombo(nc)
    if (nc > maxCombo) setMaxCombo(nc)
    correctCountRef.current += 1; setCorrectCount(correctCountRef.current)
    const bp = 100 * currentChordRef.current.length
    const cb = Math.floor(bp * (nc * 0.2))
    const hb = currentChordRef.current.length >= 3
    const hp2 = hb ? Math.floor(bp * HARMONY_BONUS_MULTIPLIER) : bp
    const fm = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
    const bm = isBossRef.current ? BOSS_BONUS_MULTIPLIER : 1
    const tp = Math.floor((hp2 + cb) * fm * bm)
    const perf = answerTimerMsRef.current > getAnsTimeout() * 0.65
    if (perf) {
      perfectStreakRef.current += 1; setPerfectStreak(perfectStreakRef.current)
      remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + PERFECT_TIME_BONUS_MS)
      if (perfectStreakRef.current >= 3) playSfx(streakSfxSrc, 0.4)
    } else { perfectStreakRef.current = 0; setPerfectStreak(0) }
    scoreRef.current += tp; setScore(scoreRef.current); setLastScoreGain(tp)
    effects.spawnParticles(50, 50, NOTES[currentChordRef.current[0]].color)
    effects.showScorePopup(tp, 50, 35)
    if (hb) effects.triggerFlash('#ffd700')
    try { play8bitJingle(getAc(), true) } catch { /* */ }
    playSfx(correctSfxSrc, 0.4)
    if (nc >= 3 && nc % 3 === 0) playSfx(comboSfxSrc, 0.4)
    if (!feverRef.current && nc >= FEVER_COMBO_THRESHOLD) {
      feverRef.current = true; feverRemainingMsRef.current = FEVER_DURATION_MS
      setIsFever(true); setFeverRemainingMs(FEVER_DURATION_MS); playSfx(feverSfxSrc, 0.5)
    }
    const nl = Math.floor(correctCountRef.current / 3) + 1
    if (nl > levelRef.current) {
      levelRef.current = nl; setLevel(nl); playSfx(levelUpSfxSrc, 0.45)
      setShowLevelUp(true); setTimeout(() => setShowLevelUp(false), 800)
    }
    phaseRef.current = 'result-correct'; setPhase('result-correct')
    const fl: Record<number, 'correct'> = {}
    for (const idx of currentChordRef.current) fl[idx] = 'correct'
    setNoteFlash(fl)
    setTimeout(() => { if (!finishedRef.current) startNewChord() }, RESULT_DISPLAY_MS)
  }, [effects, getAc, getAnsTimeout, maxCombo, startNewChord])

  const handleWrong = useCallback(() => {
    comboRef.current = 0; setCombo(0); perfectStreakRef.current = 0; setPerfectStreak(0)
    setWrongCount(prev => prev + 1)
    hpRef.current -= 1; const nh = hpRef.current; setHp(nh)
    setHeartHitIdx(nh); setTimeout(() => setHeartHitIdx(null), 500)
    effects.triggerShake(); effects.triggerFlash('#ff4444')
    try { play8bitJingle(getAc(), false) } catch { /* */ }
    playSfx(wrongSfxSrc, 0.4); playSfx(lifeLostSfxSrc, 0.35)
    phaseRef.current = 'result-wrong'; setPhase('result-wrong')
    const fl: Record<number, 'correct' | 'wrong'> = {}
    for (const idx of currentChordRef.current) fl[idx] = 'correct'
    for (const idx of selectedNotesRef.current) { if (!currentChordRef.current.includes(idx)) fl[idx] = 'wrong' }
    setNoteFlash(fl)
    if (nh <= 0) { setTimeout(() => endGame(), RESULT_DISPLAY_MS); return }
    setTimeout(() => { if (!finishedRef.current) startNewChord() }, RESULT_DISPLAY_MS)
  }, [effects, getAc, startNewChord, endGame])

  const handleNoteToggle = useCallback((ni: number) => {
    if (phaseRef.current !== 'select' || finishedRef.current) return
    try { playNote8bit(getAc(), NOTES[ni].frequency, 0.2, 0.2) } catch { /* */ }
    playSfx(tapSfxSrc, 0.3)
    const ns = new Set(selectedNotesRef.current)
    if (ns.has(ni)) ns.delete(ni); else ns.add(ni)
    selectedNotesRef.current = ns; setSelectedNotes(new Set(ns))
  }, [getAc])

  const handleSubmit = useCallback(() => {
    if (phaseRef.current !== 'select' || finishedRef.current || selectedNotesRef.current.size === 0) return
    const tgt = new Set(currentChordRef.current), sel = selectedNotesRef.current
    if (tgt.size === sel.size && [...tgt].every(n => sel.has(n))) handleCorrect(); else handleWrong()
  }, [handleCorrect, handleWrong])

  const handleReplay = useCallback(() => {
    if (phaseRef.current !== 'select' || finishedRef.current) return
    try { playChord(getAc(), currentChordRef.current, TONE_DURATION_S, TONE_VOLUME) } catch { /* */ }
  }, [getAc])

  const handleHint = useCallback(() => {
    if (phaseRef.current !== 'select' || finishedRef.current || hintsLeftRef.current <= 0) return
    hintsLeftRef.current -= 1; setHintsLeft(hintsLeftRef.current)
    const us = currentChordRef.current.filter(idx => !selectedNotesRef.current.has(idx))
    if (us.length > 0) {
      const ri = us[Math.floor(Math.random() * us.length)]
      setHintRevealed(ri)
      try { playNote8bit(getAc(), NOTES[ri].frequency, 0.4, 0.25) } catch { /* */ }
      playSfx(hintSfxSrc, 0.4)
    }
  }, [getAc])

  useEffect(() => {
    startNewChord()
    const loop = (now: number) => {
      if (finishedRef.current) return
      const last = lastFrameRef.current ?? now; lastFrameRef.current = now
      let delta = now - last
      if (delta > MAX_FRAME_DELTA_MS) delta = DEFAULT_FRAME_MS
      if (delta <= 0) { animFrameRef.current = requestAnimationFrame(loop); return }
      remainingMsRef.current -= delta; setRemainingMs(Math.max(0, remainingMsRef.current))
      if (remainingMsRef.current <= 0) { endGame(); return }
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecondRef.current !== sec) {
          lowTimeSecondRef.current = sec
          try { const ctx = getAc(), o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'square'; o.frequency.setValueAtTime(880, ctx.currentTime); g.gain.setValueAtTime(0.08, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08); o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.08) } catch { /* */ }
          playSfx(warningSfxSrc, 0.25)
        }
      }
      if (feverRef.current) { feverRemainingMsRef.current -= delta; setFeverRemainingMs(Math.max(0, feverRemainingMsRef.current)); if (feverRemainingMsRef.current <= 0) { feverRef.current = false; setIsFever(false) } }
      if (phaseRef.current === 'select') { answerTimerMsRef.current -= delta; setAnswerTimerMs(Math.max(0, answerTimerMsRef.current)); if (answerTimerMsRef.current <= 0) handleWrong() }
      animFrameRef.current = requestAnimationFrame(loop)
    }
    animFrameRef.current = requestAnimationFrame(loop)
    return () => { if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current); if (audioCtxRef.current) { try { void audioCtxRef.current.close() } catch { /* */ } } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const timerPct = (remainingMs / ROUND_DURATION_MS) * 100
  const timerColor = remainingMs <= LOW_TIME_THRESHOLD_MS ? '#ff4444' : remainingMs <= 25000 ? '#f39c12' : '#2ecc71'
  const answerPct = (answerTimerMs / getAnsTimeout()) * 100
  const answerColor = answerPct > 60 ? '#2ecc71' : answerPct > 30 ? '#f39c12' : '#ff4444'
  const comboLbl = combo >= 2 ? getComboLabel(combo) : ''
  const comboCl = combo >= 2 ? getComboColor(combo) : '#fff'
  const canPlay = phase === 'select'

  return (
    <>
      <style>{PIXEL_CSS}</style>
      <div className="mh-root" style={effects.isShaking ? { animation: 'game-fx-shake 0.3s steps(3)' } : undefined}>
        <div className="mh-scanlines" />
        <div className="mh-pixel-stars">
          {PIXEL_STARS.map((s, i) => (<div key={i} className="mh-pixel-star" style={{ left: s.left, top: s.top, background: s.color, '--delay': s.delay, '--dur': s.dur } as React.CSSProperties} />))}
        </div>
        {isFever && <div className="mh-fever-overlay" />}
        {isFever && <div className="mh-fever-badge">FEVER x{FEVER_SCORE_MULTIPLIER} {Math.ceil(feverRemainingMs / 1000)}s</div>}
        <div className="mh-header">
          <div className="mh-score">{score.toLocaleString()}</div>
          <div className="mh-hp">
            {Array.from({ length: MAX_HP }, (_, i) => (<span key={i} className={`mh-heart ${i >= hp ? 'lost' : ''} ${heartHitIdx === i ? 'hit' : ''}`}>{i < hp ? '\u2665' : '\u2661'}</span>))}
          </div>
          <div className={`mh-level-badge ${isBossRound ? 'boss' : ''}`}>{isBossRound ? 'BOSS' : `Lv${level}`}</div>
        </div>
        <div className="mh-timer-bar"><div className="mh-timer-fill" style={{ width: `${timerPct}%`, background: timerColor }} /></div>
        <div className="mh-combo-row">
          {comboLbl && <span className="mh-combo-text" key={combo} style={{ color: comboCl }}>{combo}x {comboLbl}</span>}
          {perfectStreak >= 2 && <span style={{ color: '#ffd700', marginLeft: 6, fontSize: '0.5rem' }}>PERFECT x{perfectStreak}</span>}
        </div>
        <div className="mh-chord-area">
          <div className="mh-chord-name">{chordName}</div>
          {phase === 'listen' && (<div className="mh-waveform">{WAVEFORM_BARS.map((b, i) => (<div key={i} className="mh-wave-bar" style={{ '--delay': b.delay, '--dur': b.dur, '--max-h': b.maxH } as React.CSSProperties} />))}</div>)}
          <div className="mh-chord-display">
            {currentChord.map((noteIdx, i) => {
              const note = NOTES[noteIdx], show = phase === 'listen' || phase === 'result-correct' || phase === 'result-wrong'
              const isHinted = hintRevealed === noteIdx && phase === 'select'
              const fc = noteFlash[noteIdx] === 'correct' ? 'correct-flash' : noteFlash[noteIdx] === 'wrong' ? 'wrong-flash' : ''
              return (<div key={`${noteIdx}-${i}`} className={`mh-chord-note ${show ? '' : 'hidden'} ${fc} ${isHinted ? 'hint-revealed' : ''}`} style={{ background: show || isHinted ? note.color : undefined, animationDelay: `${i * 0.06}s` }}>{(show || isHinted) ? note.pixel : ''}</div>)
            })}
          </div>
          {phase === 'listen' && <div className="mh-instruction">LISTENING...</div>}
          {phase === 'select' && <div className="mh-instruction">SELECT THE NOTES!</div>}
        </div>
        {canPlay && <div className="mh-answer-timer"><div className="mh-answer-timer-fill" style={{ width: `${answerPct}%`, background: answerColor }} /></div>}
        <div className="mh-note-grid">
          {NOTES.map((note, idx) => {
            const sel = selectedNotes.has(idx), fc = noteFlash[idx] === 'correct' ? 'correct-flash' : noteFlash[idx] === 'wrong' ? 'wrong-flash' : ''
            return (<button key={note.id} className={`mh-note-btn ${sel ? 'selected' : ''} ${fc}`} style={{ background: sel ? note.activeColor : note.color, opacity: canPlay ? 1 : 0.4 }} disabled={!canPlay} onPointerDown={() => handleNoteToggle(idx)}><span className="mh-note-letter">{note.pixel}</span><span className="mh-note-name">{note.label}</span></button>)
          })}
        </div>
        <div className="mh-bottom-row">
          <button className="mh-btn replay" disabled={!canPlay} onPointerDown={handleReplay}>REPLAY</button>
          <button className="mh-btn hint" disabled={!canPlay || hintsLeft <= 0} onPointerDown={handleHint}>HINT({hintsLeft})</button>
          <button className="mh-btn confirm" disabled={!canPlay || selectedNotes.size === 0} onPointerDown={handleSubmit}>OK {selectedNotes.size}/{currentChord.length}</button>
        </div>
        {phase === 'result-correct' && (<div className="mh-result-overlay"><div className="mh-result-text" style={{ color: '#2ecc71' }}>CORRECT!</div>{lastScoreGain > 0 && <div className="mh-result-sub">+{lastScoreGain.toLocaleString()}</div>}{isBossRound && <div className="mh-result-sub" style={{ color: '#ff4444' }}>BOSS CLEAR!</div>}</div>)}
        {phase === 'result-wrong' && (<div className="mh-result-overlay"><div className="mh-result-text" style={{ color: '#ff4444' }}>MISS!</div><div className="mh-result-sub" style={{ color: '#ff4444' }}>HP -1</div></div>)}
        {phase === 'boss-intro' && (<div className="mh-boss-intro"><div className="mh-boss-text">BOSS!</div><div className="mh-boss-sub">x{BOSS_BONUS_MULTIPLIER} BONUS</div></div>)}
        {showLevelUp && (<div className="mh-level-up-overlay"><div className="mh-level-up-text">LEVEL {level}!</div></div>)}
        {phase === 'game-over' && (<div className="mh-game-over"><div className="mh-go-title">GAME OVER</div><div className="mh-go-score">{score.toLocaleString()}</div><div className="mh-go-level">LEVEL {level}</div><div className="mh-go-stats"><div className="mh-go-stat"><div className="mh-go-stat-val">{correctCount}</div><div className="mh-go-stat-lbl">CORRECT</div></div><div className="mh-go-stat"><div className="mh-go-stat-val">{maxCombo}</div><div className="mh-go-stat-lbl">MAX COMBO</div></div><div className="mh-go-stat"><div className="mh-go-stat-val">{wrongCount}</div><div className="mh-go-stat-lbl">MISS</div></div></div></div>)}
        <ParticleRenderer particles={effects.particles} />
        <ScorePopupRenderer popups={effects.scorePopups} />
        <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      </div>
    </>
  )
}

export const musicHarmonyModule: MiniGameModule = {
  manifest: {
    id: 'music-harmony',
    title: 'Music Harmony',
    description: '8-bit chord matching! Listen and pick the notes. Boss rounds every 5 levels!',
    unlockCost: 80,
    baseReward: 25,
    scoreRewardMultiplier: 0.04,
    accentColor: '#7c3aed',
  },
  Component: MusicHarmonyGame,
}
