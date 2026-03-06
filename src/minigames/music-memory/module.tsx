import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import characterImage from '../../../assets/images/same-character/seo-taiji.png'

import correctSfxUrl from '../../../assets/sounds/music-memory-correct.mp3'
import wrongSfxUrl from '../../../assets/sounds/music-memory-wrong.mp3'
import levelUpSfxUrl from '../../../assets/sounds/music-memory-levelup.mp3'
import feverSfxUrl from '../../../assets/sounds/music-memory-fever.mp3'
import tickSfxUrl from '../../../assets/sounds/music-memory-tick.mp3'
import perfectSfxUrl from '../../../assets/sounds/music-memory-perfect.mp3'
import dotTapSfxUrl from '../../../assets/sounds/music-memory-dot-tap.mp3'
import dotAppearSfxUrl from '../../../assets/sounds/music-memory-dot-appear.mp3'
import streakBreakSfxUrl from '../../../assets/sounds/music-memory-streak-break.mp3'

// ─── Game Config ───
const ROUND_DURATION_MS = 60000
const LOW_TIME_THRESHOLD_MS = 8000
const SHOW_SEQUENCE_NOTE_MS = 600
const SHOW_SEQUENCE_GAP_MS = 250
const RESULT_DISPLAY_MS = 700
const TONE_DURATION_S = 0.28
const TONE_VOLUME = 0.35
const TEMPO_SPEEDUP_PER_LEVEL = 0.04
const MIN_TEMPO_SCALE = 0.35
const TIME_BONUS_PER_ROUND_MS = 2500
const STREAK_TIME_BONUS_MS = 800

const FEVER_LEVEL_THRESHOLD = 4
const FEVER_DURATION_MS = 12000
const FEVER_SCORE_MULT = 2.5

const FAKE_DOT_START_LEVEL = 5
const DOT_SHRINK_START_LEVEL = 7
const MOVING_DOT_START_LEVEL = 9

// Dot area bounds (percentage)
const DOT_AREA_TOP = 18
const DOT_AREA_BOTTOM = 78
const DOT_AREA_LEFT = 8
const DOT_AREA_RIGHT = 92
const DOT_MIN_DIST = 14

type Phase = 'show' | 'play' | 'correct' | 'wrong' | 'game-over'

interface DotDef {
  readonly id: number
  readonly noteIdx: number
  x: number
  y: number
  readonly size: number
  readonly isFake: boolean
  vx: number
  vy: number
}

interface NoteDef {
  readonly id: string
  readonly label: string
  readonly frequency: number
  readonly color: string
  readonly glowColor: string
  readonly emoji: string
}

const NOTES: readonly NoteDef[] = [
  { id: 'do', label: 'Do', frequency: 262, color: '#dc2626', glowColor: 'rgba(220,38,38,0.6)', emoji: '🎵' },
  { id: 're', label: 'Re', frequency: 294, color: '#2563eb', glowColor: 'rgba(37,99,235,0.6)', emoji: '🎶' },
  { id: 'mi', label: 'Mi', frequency: 330, color: '#16a34a', glowColor: 'rgba(22,163,74,0.6)', emoji: '🎹' },
  { id: 'fa', label: 'Fa', frequency: 349, color: '#ca8a04', glowColor: 'rgba(202,138,4,0.6)', emoji: '🎸' },
  { id: 'sol', label: 'Sol', frequency: 392, color: '#c026d3', glowColor: 'rgba(192,38,211,0.6)', emoji: '🎺' },
  { id: 'la', label: 'La', frequency: 440, color: '#ea580c', glowColor: 'rgba(234,88,12,0.6)', emoji: '🥁' },
]

function playTone(ctx: AudioContext, freq: number, dur: number, vol: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, ctx.currentTime)
  gain.gain.setValueAtTime(vol, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur)
  osc.connect(gain); gain.connect(ctx.destination)
  osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur)
}

function createSfx(url: string, pool = 3) {
  const a: HTMLAudioElement[] = []
  let i = 0
  for (let n = 0; n < pool; n++) { const e = new Audio(url); e.preload = 'auto'; a.push(e) }
  return {
    play(vol: number, rate = 1) {
      const e = a[i % a.length]; i++
      e.currentTime = 0; e.volume = vol; e.playbackRate = rate
      void e.play().catch(() => {})
    },
  }
}

function randRange(min: number, max: number) { return min + Math.random() * (max - min) }

function generateDots(level: number, seqLen: number): { dots: DotDef[]; sequence: number[] } {
  const noteCount = Math.min(NOTES.length, 4 + Math.floor((level - 1) / 3))
  const dots: DotDef[] = []
  const sequence: number[] = []
  let nextId = 0

  // Place real dots
  for (let i = 0; i < seqLen; i++) {
    const noteIdx = Math.floor(Math.random() * noteCount)
    let x: number, y: number, attempts = 0
    do {
      x = randRange(DOT_AREA_LEFT, DOT_AREA_RIGHT)
      y = randRange(DOT_AREA_TOP, DOT_AREA_BOTTOM)
      attempts++
    } while (attempts < 50 && dots.some(d => Math.hypot(d.x - x, d.y - y) < DOT_MIN_DIST))

    const baseSize = level >= DOT_SHRINK_START_LEVEL ? randRange(9, 12) : randRange(11, 15)
    const isMoving = level >= MOVING_DOT_START_LEVEL && Math.random() < 0.3
    dots.push({
      id: nextId++, noteIdx, x, y, size: baseSize, isFake: false,
      vx: isMoving ? randRange(-2, 2) : 0,
      vy: isMoving ? randRange(-1.5, 1.5) : 0,
    })
    sequence.push(dots.length - 1)
  }

  // Fake dots (distractors)
  if (level >= FAKE_DOT_START_LEVEL) {
    const fakeCount = Math.min(3, Math.floor((level - FAKE_DOT_START_LEVEL) / 2) + 1)
    for (let i = 0; i < fakeCount; i++) {
      const noteIdx = Math.floor(Math.random() * noteCount)
      let x: number, y: number, attempts = 0
      do {
        x = randRange(DOT_AREA_LEFT, DOT_AREA_RIGHT)
        y = randRange(DOT_AREA_TOP, DOT_AREA_BOTTOM)
        attempts++
      } while (attempts < 50 && dots.some(d => Math.hypot(d.x - x, d.y - y) < DOT_MIN_DIST))
      dots.push({
        id: nextId++, noteIdx, x, y, size: randRange(9, 13), isFake: true,
        vx: 0, vy: 0,
      })
    }
  }

  return { dots, sequence }
}

function MusicMemoryGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects({ maxParticles: 50 })
  const [score, setScore] = useState(0)
  const [level, setLevel] = useState(1)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [phase, setPhase] = useState<Phase>('show')
  const [dots, setDots] = useState<DotDef[]>([])
  const [sequence, setSequence] = useState<number[]>([])
  const [playerIdx, setPlayerIdx] = useState(0)
  const [showIdx, setShowIdx] = useState(-1)
  const [resultMsg, setResultMsg] = useState('')
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [streak, setStreak] = useState(0)
  const [tappedDots, setTappedDots] = useState<Set<number>>(new Set())
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number; color: string }[]>([])

  const refs = useRef({
    score: 0, level: 1, remainingMs: ROUND_DURATION_MS, phase: 'show' as Phase,
    sequence: [] as number[], playerIdx: 0, finished: false, dots: [] as DotDef[],
    fever: false, feverMs: 0, streak: 0,
    animFrame: null as number | null, lastFrame: null as number | null,
    showTimer: null as ReturnType<typeof setTimeout> | null,
    resultTimer: null as ReturnType<typeof setTimeout> | null,
    audioCtx: null as AudioContext | null,
    lowTimeSec: null as number | null,
    rippleId: 0,
  })

  const sfx = useRef<Record<string, ReturnType<typeof createSfx>> | null>(null)

  const getCtx = useCallback((): AudioContext => {
    const r = refs.current
    if (!r.audioCtx || r.audioCtx.state === 'closed') r.audioCtx = new AudioContext()
    if (r.audioCtx.state === 'suspended') void r.audioCtx.resume().catch(() => {})
    return r.audioCtx
  }, [])

  const playNoteSound = useCallback((noteIdx: number) => {
    const note = NOTES[noteIdx]
    if (!note) return
    try { playTone(getCtx(), note.frequency, TONE_DURATION_S, TONE_VOLUME) } catch { /* silent */ }
  }, [getCtx])

  const clearShowTimer = useCallback(() => {
    const r = refs.current
    if (r.showTimer) { clearTimeout(r.showTimer); r.showTimer = null }
  }, [])

  const clearResultTimer = useCallback(() => {
    const r = refs.current
    if (r.resultTimer) { clearTimeout(r.resultTimer); r.resultTimer = null }
  }, [])

  // Start showing sequence
  const startShowSequence = useCallback((dotsList: DotDef[], seq: number[], lvl: number) => {
    clearShowTimer()
    const r = refs.current
    r.phase = 'show'
    setPhase('show')
    setShowIdx(-1)
    setPlayerIdx(0)
    r.playerIdx = 0
    setTappedDots(new Set())

    const tempoScale = Math.max(MIN_TEMPO_SCALE, 1 - (lvl - 1) * TEMPO_SPEEDUP_PER_LEVEL)
    const noteDur = Math.round(SHOW_SEQUENCE_NOTE_MS * tempoScale)
    const gapDur = Math.round(SHOW_SEQUENCE_GAP_MS * tempoScale)

    let step = 0
    const doStep = () => {
      if (r.finished) return
      if (step >= seq.length) {
        setShowIdx(-1)
        r.phase = 'play'
        setPhase('play')
        return
      }

      const dotIndex = seq[step]
      const dot = dotsList[dotIndex]
      if (dot) {
        setShowIdx(dotIndex)
        playNoteSound(dot.noteIdx)
        sfx.current?.dotAppear.play(0.25, 1 + step * 0.05)
      }

      r.showTimer = setTimeout(() => {
        setShowIdx(-1)
        step++
        r.showTimer = setTimeout(doStep, gapDur)
      }, noteDur)
    }

    r.showTimer = setTimeout(doStep, 400)
  }, [clearShowTimer, playNoteSound])

  // Start new round
  const startRound = useCallback((lvl: number) => {
    const seqLen = Math.min(2 + lvl, 12)
    const { dots: newDots, sequence: newSeq } = generateDots(lvl, seqLen)
    const r = refs.current
    r.dots = newDots
    r.sequence = newSeq
    setDots(newDots)
    setSequence(newSeq)
    startShowSequence(newDots, newSeq, lvl)
  }, [startShowSequence])

  const finishGame = useCallback(() => {
    const r = refs.current
    if (r.finished) return
    r.finished = true
    clearShowTimer()
    clearResultTimer()
    r.phase = 'game-over'
    setPhase('game-over')
    const elapsed = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - r.remainingMs))
    onFinish({ score: r.score, durationMs: elapsed })
  }, [clearShowTimer, clearResultTimer, onFinish])

  const handleWrong = useCallback(() => {
    const r = refs.current
    r.phase = 'wrong'
    setPhase('wrong')
    setResultMsg('MISS!')
    r.streak = 0
    setStreak(0)

    sfx.current?.wrong.play(0.55)
    sfx.current?.streakBreak.play(0.3)
    effects.triggerShake(7)
    effects.triggerFlash('rgba(239,68,68,0.45)')

    r.resultTimer = setTimeout(() => {
      r.resultTimer = null
      finishGame()
    }, RESULT_DISPLAY_MS)
  }, [finishGame, effects])

  const handleRoundComplete = useCallback(() => {
    const r = refs.current
    const feverMult = r.fever ? FEVER_SCORE_MULT : 1
    const streakBonus = Math.min(r.streak * 8, 80)
    const roundScore = Math.floor((r.level * 15 + streakBonus) * feverMult)
    r.score += roundScore
    setScore(r.score)

    r.streak += 1
    setStreak(r.streak)

    // Time bonus
    const timeBonus = TIME_BONUS_PER_ROUND_MS + (r.streak >= 3 ? STREAK_TIME_BONUS_MS : 0)
    r.remainingMs = Math.min(ROUND_DURATION_MS, r.remainingMs + timeBonus)
    setRemainingMs(r.remainingMs)

    // Fever
    if (r.level >= FEVER_LEVEL_THRESHOLD && !r.fever) {
      r.fever = true; r.feverMs = FEVER_DURATION_MS
      setIsFever(true); setFeverMs(FEVER_DURATION_MS)
      sfx.current?.fever.play(0.6)
      effects.triggerFlash('rgba(250,204,21,0.5)')
      effects.spawnParticles(12, 200, 300)
    }

    r.phase = 'correct'
    setPhase('correct')
    const fLabel = r.fever ? ' FEVER!' : ''
    const sLabel = r.streak >= 3 ? ` x${r.streak}` : ''
    setResultMsg(`+${roundScore}${fLabel}${sLabel}`)

    if (r.streak >= 3) sfx.current?.perfect.play(0.5)
    else sfx.current?.correct.play(0.5)

    effects.comboHitBurst(200, 300, r.level, roundScore)

    r.resultTimer = setTimeout(() => {
      r.resultTimer = null
      const nextLvl = r.level + 1
      r.level = nextLvl
      setLevel(nextLvl)
      sfx.current?.levelUp.play(0.45)
      startRound(nextLvl)
    }, RESULT_DISPLAY_MS)
  }, [startRound, effects])

  // Dot tap handler
  const handleDotTap = useCallback((dotIndex: number) => {
    const r = refs.current
    if (r.finished || r.phase !== 'play') return

    const dot = r.dots[dotIndex]
    if (!dot) return

    // Ripple effect
    r.rippleId++
    const note = NOTES[dot.noteIdx]
    setRipples(prev => [...prev.slice(-8), { id: r.rippleId, x: dot.x, y: dot.y, color: note?.color ?? '#fff' }])
    setTimeout(() => setRipples(prev => prev.filter(rp => rp.id !== r.rippleId)), 600)

    playNoteSound(dot.noteIdx)
    sfx.current?.dotTap.play(0.4, 1 + r.playerIdx * 0.04)

    // Fake dot = wrong
    if (dot.isFake) {
      handleWrong()
      return
    }

    const expectedDotIndex = r.sequence[r.playerIdx]
    if (dotIndex !== expectedDotIndex) {
      handleWrong()
      return
    }

    // Correct tap
    r.playerIdx++
    setPlayerIdx(r.playerIdx)
    setTappedDots(prev => new Set(prev).add(dotIndex))

    effects.spawnParticles(4, 50 + dotIndex * 20, 200 + dotIndex * 30)

    if (r.playerIdx >= r.sequence.length) {
      handleRoundComplete()
    }
  }, [handleWrong, handleRoundComplete, playNoteSound, effects])

  // Init
  useEffect(() => {
    sfx.current = {
      correct: createSfx(correctSfxUrl),
      wrong: createSfx(wrongSfxUrl),
      levelUp: createSfx(levelUpSfxUrl),
      fever: createSfx(feverSfxUrl),
      tick: createSfx(tickSfxUrl),
      perfect: createSfx(perfectSfxUrl),
      dotTap: createSfx(dotTapSfxUrl, 4),
      dotAppear: createSfx(dotAppearSfxUrl),
      streakBreak: createSfx(streakBreakSfxUrl),
    }
    startRound(1)
    return () => {
      clearShowTimer(); clearResultTimer(); effects.cleanup()
      if (refs.current.audioCtx) { void refs.current.audioCtx.close().catch(() => {}); refs.current.audioCtx = null }
    }
  }, [])

  // Game loop (timer + moving dots)
  useEffect(() => {
    refs.current.lastFrame = null
    const step = (now: number) => {
      const r = refs.current
      if (r.finished) { r.animFrame = null; return }
      if (r.lastFrame === null) r.lastFrame = now

      const dt = Math.min(now - r.lastFrame, MAX_FRAME_DELTA_MS)
      r.lastFrame = now
      const dtSec = dt / 1000

      r.remainingMs = Math.max(0, r.remainingMs - dt)
      setRemainingMs(r.remainingMs)

      if (r.fever) {
        r.feverMs = Math.max(0, r.feverMs - dt)
        setFeverMs(r.feverMs)
        if (r.feverMs <= 0) { r.fever = false; setIsFever(false) }
      }

      // Move dots
      let dotsChanged = false
      for (const d of r.dots) {
        if (d.vx !== 0 || d.vy !== 0) {
          d.x += d.vx * dtSec
          d.y += d.vy * dtSec
          if (d.x < DOT_AREA_LEFT || d.x > DOT_AREA_RIGHT) d.vx = -d.vx
          if (d.y < DOT_AREA_TOP || d.y > DOT_AREA_BOTTOM) d.vy = -d.vy
          d.x = Math.max(DOT_AREA_LEFT, Math.min(DOT_AREA_RIGHT, d.x))
          d.y = Math.max(DOT_AREA_TOP, Math.min(DOT_AREA_BOTTOM, d.y))
          dotsChanged = true
        }
      }
      if (dotsChanged) setDots([...r.dots])

      effects.updateParticles()

      // Low time warning
      if (r.remainingMs > 0 && r.remainingMs <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(r.remainingMs / 1000)
        if (r.lowTimeSec !== sec) {
          r.lowTimeSec = sec
          if (sec <= 5) sfx.current?.tick.play(0.3)
        }
      } else { r.lowTimeSec = null }

      if (r.remainingMs <= 0) { finishGame(); r.animFrame = null; return }
      r.animFrame = window.requestAnimationFrame(step)
    }
    refs.current.animFrame = window.requestAnimationFrame(step)
    return () => {
      if (refs.current.animFrame !== null) { window.cancelAnimationFrame(refs.current.animFrame); refs.current.animFrame = null }
      refs.current.lastFrame = null
    }
  }, [finishGame, effects])

  // Keyboard
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit() }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onExit])

  const displayBest = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS && remainingMs > 0
  const timePct = (remainingMs / ROUND_DURATION_MS) * 100
  const comboLabel = getComboLabel(level)
  const comboColor = getComboColor(level)

  const phaseText = (() => {
    if (phase === 'show') return 'Watch the sequence...'
    if (phase === 'play') return `Tap ${playerIdx}/${sequence.length}`
    if (phase === 'correct') return resultMsg
    if (phase === 'wrong') return resultMsg
    return 'Game Over!'
  })()

  return (
    <section className="mini-game-panel mm-panel" aria-label="music-memory-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{MM_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Header */}
      <div className="mm-header">
        <div className="mm-left">
          <img className="mm-avatar" src={characterImage} alt="" />
          <div>
            <p className="mm-score">{score.toLocaleString()}</p>
            <p className="mm-best">BEST {displayBest.toLocaleString()}</p>
          </div>
        </div>
        <div className="mm-right">
          <p className={`mm-time ${isLowTime ? 'low' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <div className="mm-bar"><div className="mm-bar-fill" style={{ width: `${timePct}%`, background: isLowTime ? '#ef4444' : '#c026d3' }} /></div>
        </div>
      </div>

      {/* Meta */}
      <div className="mm-meta">
        <span>LV <strong>{level}</strong></span>
        <span>{sequence.length} dots</span>
        {streak >= 3 && <span className="mm-streak-badge">STREAK x{streak}</span>}
        {comboLabel && <span style={{ color: comboColor, fontWeight: 800, fontSize: 11 }}>{comboLabel}</span>}
        {isFever && <span className="mm-fever-badge">FEVER x{FEVER_SCORE_MULT} {(feverMs / 1000).toFixed(1)}s</span>}
      </div>

      {/* Phase banner */}
      <div className={`mm-phase ${phase}`}>
        <p>{phaseText}</p>
      </div>

      {/* Dot field */}
      <div className="mm-field">
        {/* Background grid lines */}
        <div className="mm-grid-bg" />

        {/* Ripple effects */}
        {ripples.map(rp => (
          <div key={rp.id} className="mm-ripple" style={{ left: `${rp.x}%`, top: `${rp.y}%`, borderColor: rp.color }} />
        ))}

        {/* Sequence number indicators (during play) */}
        {phase === 'play' && sequence.map((dotIdx, seqIdx) => {
          if (seqIdx >= playerIdx) return null
          const dot = dots[dotIdx]
          if (!dot) return null
          return (
            <div key={`num-${seqIdx}`} className="mm-seq-num done" style={{ left: `${dot.x}%`, top: `${dot.y}%` }}>
              {seqIdx + 1}
            </div>
          )
        })}

        {/* Dots */}
        {dots.map((dot, idx) => {
          const note = NOTES[dot.noteIdx]
          if (!note) return null
          const isShowing = showIdx === idx
          const isTapped = tappedDots.has(idx)
          const isNextTarget = phase === 'play' && sequence[playerIdx] === idx
          return (
            <button
              key={dot.id}
              className={`mm-dot ${isShowing ? 'showing' : ''} ${isTapped ? 'tapped' : ''} ${isNextTarget ? 'target-hint' : ''} ${dot.isFake ? 'fake' : ''}`}
              type="button"
              style={{
                left: `${dot.x}%`,
                top: `${dot.y}%`,
                width: `${dot.size}%`,
                height: `${dot.size * 0.9}%`,
                backgroundColor: isShowing || isTapped ? note.color : `${note.color}88`,
                borderColor: note.color,
                boxShadow: isShowing ? `0 0 20px ${note.glowColor}, 0 0 40px ${note.glowColor}` : isTapped ? 'none' : `0 0 8px ${note.glowColor}`,
              }}
              disabled={phase !== 'play' || isTapped}
              onClick={() => handleDotTap(idx)}
            >
              <span className="mm-dot-emoji">{isShowing || !isTapped ? note.emoji : '✓'}</span>
              {isShowing && <span className="mm-dot-order">{sequence.indexOf(idx) + 1}</span>}
            </button>
          )
        })}
      </div>

      {/* Footer */}
      <div className="mm-footer">
        <span className="mm-stat">Rounds {level - 1}</span>
        <span className="mm-stat">Streak {streak}</span>
      </div>
    </section>
  )
}

const MM_CSS = `
.mm-panel {
  display: flex; flex-direction: column; height: 100%;
  aspect-ratio: 9 / 16; max-width: 432px; margin: 0 auto;
  background: linear-gradient(180deg, #0a0515 0%, #12082a 40%, #0d0d1a 100%);
  user-select: none; -webkit-user-select: none; touch-action: manipulation;
  position: relative; overflow: hidden; color: #f5f3ff; padding: 0 !important;
}
.mm-panel::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(1.5px 1.5px at 12% 22%, rgba(192,38,211,0.5), transparent),
    radial-gradient(1px 1px at 38% 55%, rgba(255,255,255,0.3), transparent),
    radial-gradient(1.5px 1.5px at 62% 18%, rgba(37,99,235,0.4), transparent),
    radial-gradient(1px 1px at 82% 48%, rgba(220,38,38,0.3), transparent),
    radial-gradient(1px 1px at 28% 82%, rgba(22,163,74,0.3), transparent),
    radial-gradient(1.5px 1.5px at 72% 78%, rgba(202,138,4,0.4), transparent);
  animation: mm-twinkle 15s ease-in-out infinite alternate;
}
@keyframes mm-twinkle { from { opacity: 0.6; } to { opacity: 1; } }

.mm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px 6px; flex-shrink: 0; z-index: 2;
  background: linear-gradient(135deg, rgba(192,38,211,0.2) 0%, transparent 100%);
  border-bottom: 1px solid rgba(192,38,211,0.15);
}
.mm-left { display: flex; align-items: center; gap: 8px; }
.mm-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.mm-avatar {
  width: clamp(36px, 9vw, 48px); height: clamp(36px, 9vw, 48px);
  border-radius: 50%; border: 2px solid #c026d3;
  object-fit: cover; box-shadow: 0 0 10px rgba(192,38,211,0.4);
  image-rendering: pixelated;
}
.mm-score {
  font-size: clamp(1.3rem, 4.5vw, 1.8rem); font-weight: 900;
  color: #e879f9; margin: 0; line-height: 1;
  text-shadow: 0 0 14px rgba(192,38,211,0.5);
}
.mm-best { font-size: clamp(0.4rem, 1.5vw, 0.55rem); color: #a78bfa; margin: 0; }
.mm-time {
  font-size: clamp(0.9rem, 3vw, 1.2rem); font-weight: 700;
  color: #e4e4e7; margin: 0; font-variant-numeric: tabular-nums;
}
.mm-time.low { color: #ef4444; animation: mm-pulse 0.5s ease-in-out infinite alternate; }
@keyframes mm-pulse { from { opacity: 1; } to { opacity: 0.4; } }
.mm-bar { width: 70px; height: 3px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
.mm-bar-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }

.mm-meta {
  display: flex; justify-content: center; align-items: center; gap: 8px;
  padding: 4px 12px; flex-shrink: 0; flex-wrap: wrap; z-index: 2;
}
.mm-meta span { font-size: clamp(0.38rem, 1.3vw, 0.5rem); color: #a78bfa; font-weight: 600; }
.mm-meta strong { color: #e4e4e7; }
.mm-streak-badge {
  padding: 1px 6px; border-radius: 6px;
  background: rgba(34,197,94,0.25); border: 1px solid #22c55e;
  color: #86efac; font-weight: 800 !important;
}
.mm-fever-badge {
  padding: 1px 6px; border-radius: 6px;
  background: rgba(234,179,8,0.25); border: 1px solid #facc15;
  color: #fef3c7; font-weight: 800 !important;
  animation: mm-pulse 0.3s ease-in-out infinite alternate;
}

.mm-phase {
  text-align: center; padding: 6px 12px; flex-shrink: 0; z-index: 2;
}
.mm-phase p {
  font-size: clamp(0.65rem, 2.2vw, 0.85rem); font-weight: 700;
  color: #c4b5fd; margin: 0;
}
.mm-phase.correct p { color: #86efac; text-shadow: 0 0 10px rgba(34,197,94,0.4); }
.mm-phase.wrong p { color: #fca5a5; text-shadow: 0 0 10px rgba(239,68,68,0.4); animation: mm-shake 0.3s ease; }
@keyframes mm-shake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-5px); }
  40% { transform: translateX(5px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}

.mm-field {
  flex: 1; position: relative; min-height: 0; z-index: 1;
  margin: 0 4px;
}
.mm-grid-bg {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(rgba(192,38,211,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(192,38,211,0.04) 1px, transparent 1px);
  background-size: 10% 10%;
}

/* Ripple */
.mm-ripple {
  position: absolute; width: 0; height: 0;
  border: 3px solid; border-radius: 50%; pointer-events: none;
  transform: translate(-50%, -50%);
  animation: mm-ripple-expand 0.6s ease-out forwards;
}
@keyframes mm-ripple-expand {
  0% { width: 0; height: 0; opacity: 1; }
  100% { width: 80px; height: 80px; opacity: 0; }
}

/* Sequence number */
.mm-seq-num {
  position: absolute; transform: translate(-50%, -50%); pointer-events: none;
  font-size: 10px; font-weight: 900; color: rgba(255,255,255,0.3); z-index: 5;
}
.mm-seq-num.done { color: rgba(134,239,172,0.5); }

/* Dots */
.mm-dot {
  position: absolute; transform: translate(-50%, -50%);
  border-radius: 50%; border: 3px solid;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  cursor: pointer; z-index: 3;
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.2s;
}
.mm-dot.showing {
  transform: translate(-50%, -50%) scale(1.25);
  z-index: 10;
  animation: mm-dot-glow 0.5s ease-in-out;
}
@keyframes mm-dot-glow {
  0% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) scale(1.35); }
  100% { transform: translate(-50%, -50%) scale(1.25); }
}
.mm-dot.tapped {
  opacity: 0.25; transform: translate(-50%, -50%) scale(0.7);
  pointer-events: none;
}
.mm-dot.target-hint {
  animation: mm-target-pulse 0.8s ease-in-out infinite;
}
@keyframes mm-target-pulse {
  0%, 100% { transform: translate(-50%, -50%) scale(1); }
  50% { transform: translate(-50%, -50%) scale(1.06); }
}
.mm-dot.fake { opacity: 0.7; }
.mm-dot:disabled { cursor: default; }
.mm-dot:active:not(:disabled):not(.tapped) { transform: translate(-50%, -50%) scale(0.9); }
.mm-dot-emoji { font-size: clamp(1rem, 3.5vw, 1.6rem); line-height: 1; }
.mm-dot-order {
  position: absolute; top: -6px; right: -6px;
  width: 18px; height: 18px; border-radius: 50%;
  background: rgba(0,0,0,0.7); color: #fff;
  font-size: 10px; font-weight: 900;
  display: flex; align-items: center; justify-content: center;
}

.mm-footer {
  display: flex; justify-content: center; gap: 14px;
  padding: 6px 12px 10px; flex-shrink: 0; z-index: 2;
}
.mm-stat { font-size: clamp(0.38rem, 1.2vw, 0.48rem); color: #6b21a8; font-weight: 600; }
`

export const musicMemoryModule: MiniGameModule = {
  manifest: {
    id: 'music-memory',
    title: 'Music Memory',
    description: 'Watch the dots light up, then tap them in order! Dodge fake dots!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.25,
    accentColor: '#c026d3',
  },
  Component: MusicMemoryGame,
}
