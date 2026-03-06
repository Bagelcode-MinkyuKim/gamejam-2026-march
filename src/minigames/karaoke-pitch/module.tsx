import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterImage from '../../../assets/images/same-character/song-changsik.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

import perfectSfx from '../../../assets/sounds/karaoke-perfect.mp3'
import goodSfx from '../../../assets/sounds/karaoke-good.mp3'
import missSfx from '../../../assets/sounds/karaoke-miss.mp3'
import feverSfx from '../../../assets/sounds/karaoke-fever.mp3'
import comboSfx from '../../../assets/sounds/karaoke-combo.mp3'
import timeWarningSfx from '../../../assets/sounds/karaoke-time-warning.mp3'
import gameOverSfx from '../../../assets/sounds/karaoke-game-over.mp3'
import levelUpSfx from '../../../assets/sounds/karaoke-levelup.mp3'
import powerUpSfx from '../../../assets/sounds/karaoke-powerup.mp3'
import starSfx from '../../../assets/sounds/karaoke-star.mp3'
import bgmLoop from '../../../assets/sounds/karaoke-bgm-loop.mp3'
import bonusSfx from '../../../assets/sounds/karaoke-bonus.mp3'
import slideSfx from '../../../assets/sounds/karaoke-slide.mp3'

// ─── Game Constants ─────────────────────────────────────────────────
const ROUND_DURATION_MS = 45000
const LOW_TIME_THRESHOLD_MS = 7000

// Accuracy thresholds (distance between player & target, 0~1 range)
const ACCURACY_PERFECT_THRESHOLD = 0.06
const ACCURACY_GOOD_THRESHOLD = 0.15
const ACCURACY_OK_THRESHOLD = 0.28

// Scoring (points per second while holding accuracy)
const SCORE_PER_SECOND_PERFECT = 200
const SCORE_PER_SECOND_GOOD = 90
const SCORE_PER_SECOND_OK = 40

// Streak & Fever
const PERFECT_STREAK_THRESHOLD_MS = 1500
const FEVER_TRIGGER_STREAKS = 3
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const STREAK_MILESTONE_BONUS = 100

// Combo
const COMBO_DECAY_MS = 600
const COMBO_BONUS_BASE = 12

// Level system
const LEVEL_THRESHOLDS = [0, 800, 2000, 4000, 7000, 11000, 16000, 22000, 30000]
const LEVEL_NAMES = ['Lv.1 DEBUT', 'Lv.2 ROOKIE', 'Lv.3 SINGER', 'Lv.4 STAR', 'Lv.5 IDOL', 'Lv.6 LEGEND', 'Lv.7 MASTER', 'Lv.8 GOD', 'Lv.9 MAX']

// Pitch movement (sine wave target)
const SINE_BASE_PERIOD_MS = 3200
const SINE_MIN_PERIOD_MS = 1200
const SINE_PERIOD_DECAY_PER_MS = 0.04
const SINE_SECONDARY_AMPLITUDE = 0.18
const SINE_SECONDARY_PERIOD_RATIO = 2.73

// Note lanes (notes scroll from right to left) — difficulty scales these
const BASE_NOTE_SPAWN_INTERVAL_MS = 2400
const BASE_NOTE_SPEED = 0.00032
const NOTE_HIT_ZONE = 0.14 // x position range for hitting (wider for bigger notes)

// Bonus items
const BONUS_INTERVAL_MS = 4000
const BONUS_DURATION_MS = 2500
const BONUS_RADIUS = 0.14

// Power-ups
const POWERUP_INTERVAL_MS = 12000
const POWERUP_DURATION_MS = 3000
const POWERUP_EFFECT_DURATION_MS = 5000

type PowerUpType = 'double' | 'shield' | 'magnet'
const POWERUP_ICONS: Record<PowerUpType, string> = { double: '2x', shield: '[]', magnet: '<>' }
const POWERUP_COLORS: Record<PowerUpType, string> = { double: '#facc15', shield: '#38bdf8', magnet: '#a855f7' }

// Retro pixel palette
const PIXEL_BG_DARK = '#0a0a18'
const PIXEL_BG_MID = '#12122a'
const PIXEL_PURPLE = '#9333ea'
const PIXEL_PINK = '#ec4899'
const PIXEL_CYAN = '#22d3ee'
const PIXEL_GREEN = '#22c55e'
const PIXEL_YELLOW = '#facc15'
const PIXEL_RED = '#ef4444'
const PIXEL_WHITE = '#e4e4e7'

// ─── Helpers ────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

// Seeded pseudo-random for deterministic "jumps"
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

function computeTargetPosition(elapsedMs: number, level: number): number {
  const diff = 0.5 + level * 0.12
  const period = Math.max(SINE_MIN_PERIOD_MS, SINE_BASE_PERIOD_MS - elapsedMs * SINE_PERIOD_DECAY_PER_MS)

  // Base sine wave — large amplitude
  const p1 = (elapsedMs / period) * Math.PI * 2
  const base = Math.sin(p1) * 0.35

  // Secondary wave — different frequency for irregularity
  const p2 = (elapsedMs / (period * SINE_SECONDARY_PERIOD_RATIO)) * Math.PI * 2
  const secondary = Math.sin(p2) * SINE_SECONDARY_AMPLITUDE * diff

  // Sharp "jump" every ~2 seconds — sudden direction changes
  const jumpInterval = Math.max(1200, 2200 - level * 100)
  const jumpIndex = Math.floor(elapsedMs / jumpInterval)
  const jumpPhase = (elapsedMs % jumpInterval) / jumpInterval
  const jumpTarget = seededRandom(jumpIndex + 1) * 0.7 + 0.15 // random Y between 0.15~0.85
  const prevJumpTarget = seededRandom(jumpIndex) * 0.7 + 0.15
  // Smooth step between jump targets (ease-in-out)
  const t = jumpPhase < 0.3 ? 0 : jumpPhase > 0.7 ? 1 : (jumpPhase - 0.3) / 0.4
  const eased = t * t * (3 - 2 * t) // smoothstep
  const jumpVal = prevJumpTarget + (jumpTarget - prevJumpTarget) * eased

  // Mix: mostly jump-based movement + sine for organic feel
  const mixRatio = Math.min(0.6 + level * 0.05, 0.85) // higher level = more jump-based
  const val = jumpVal * mixRatio + (base + secondary + 0.5) * (1 - mixRatio)

  return clamp(val, 0.08, 0.92)
}

function accuracyLabel(d: number): string {
  if (d <= ACCURACY_PERFECT_THRESHOLD) return 'PERFECT!'
  if (d <= ACCURACY_GOOD_THRESHOLD) return 'GOOD'
  if (d <= ACCURACY_OK_THRESHOLD) return 'OK'
  return 'MISS'
}

function accuracyColor(d: number): string {
  if (d <= ACCURACY_PERFECT_THRESHOLD) return PIXEL_GREEN
  if (d <= ACCURACY_GOOD_THRESHOLD) return PIXEL_CYAN
  if (d <= ACCURACY_OK_THRESHOLD) return PIXEL_YELLOW
  return PIXEL_RED
}

function accuracyScoreRate(d: number): number {
  if (d <= ACCURACY_PERFECT_THRESHOLD) return SCORE_PER_SECOND_PERFECT
  if (d <= ACCURACY_GOOD_THRESHOLD) return SCORE_PER_SECOND_GOOD
  if (d <= ACCURACY_OK_THRESHOLD) return SCORE_PER_SECOND_OK
  return 0
}

function getLevel(score: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= LEVEL_THRESHOLDS[i]) return i
  }
  return 0
}

// ─── Types ──────────────────────────────────────────────────────────

interface ScrollNote {
  id: number
  yPos: number // 0~1 vertical position
  xPos: number // 0~1, starts at 1 and scrolls left
  spawnedAt: number
  hit: boolean
  missed: boolean
  points: number
  type: 'normal' | 'gold' | 'long'
}

interface BonusItem {
  id: number
  position: number
  spawnedAt: number
  collected: boolean
  type: 'note' | 'star' | 'heart'
  score: number
}

interface PowerUp {
  id: number
  position: number
  spawnedAt: number
  collected: boolean
  type: PowerUpType
}

// ─── Main Component ─────────────────────────────────────────────────

function KaraokePitchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [targetPosition, setTargetPosition] = useState(0.5)
  const [playerPosition, setPlayerPosition] = useState(0.5)
  const [accDist, setAccDist] = useState(0.5)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [perfectStreakCount, setPerfectStreakCount] = useState(0)
  const [combo, setCombo] = useState(0)
  const [bonusItems, setBonusItems] = useState<BonusItem[]>([])
  const [powerUps, setPowerUps] = useState<PowerUp[]>([])
  const [scrollNotes, setScrollNotes] = useState<ScrollNote[]>([])
  const [elapsedDisplay, setElapsedDisplay] = useState(0)
  const [vignette, setVignette] = useState(false)
  const [level, setLevel] = useState(0)
  const [levelUpText, setLevelUpText] = useState('')
  const [activePowerUp, setActivePowerUp] = useState<PowerUpType | null>(null)
  const [charReaction, setCharReaction] = useState<'idle' | 'happy' | 'sad' | 'fever'>('idle')
  const [hitFlash, setHitFlash] = useState<string | null>(null)
  const [scorePerSec, setScorePerSec] = useState(0)

  const effects = useGameEffects()
  const effectsRef = useRef(effects)
  effectsRef.current = effects

  // Refs
  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const elapsedMsRef = useRef(0)
  const playerPosRef = useRef(0.5)
  const finishedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const isDraggingRef = useRef(false)
  const gameAreaRef = useRef<HTMLDivElement | null>(null)

  const feverRef = useRef(false)
  const feverMsRef = useRef(0)
  const perfectStreakMsRef = useRef(0)
  const perfectStreakCountRef = useRef(0)
  const lastMilestoneRef = useRef(0)
  const comboRef = useRef(0)
  const maxComboRef = useRef(0)
  const lastComboTickRef = useRef(0)
  const levelRef = useRef(0)

  const bonusIdRef = useRef(0)
  const lastBonusRef = useRef(0)
  const bonusItemsRef = useRef<BonusItem[]>([])
  const powerUpIdRef = useRef(0)
  const lastPowerUpRef = useRef(0)
  const powerUpsRef = useRef<PowerUp[]>([])
  const activePowerUpRef = useRef<PowerUpType | null>(null)
  const powerUpEndRef = useRef(0)

  // Scroll notes
  const noteIdRef = useRef(0)
  const lastNoteSpawnRef = useRef(0)
  const scrollNotesRef = useRef<ScrollNote[]>([])

  const lastSoundRef = useRef(0)
  const lastParticleRef = useRef(0)
  const lastTimeWarnRef = useRef(0)
  const lastReactionRef = useRef(0)
  const lastSlideRef = useRef(0)

  const audios = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const playAudio = useCallback((key: string, volume: number, rate = 1) => {
    const a = audios.current[key]
    if (!a) return
    a.currentTime = 0
    a.volume = clamp(volume, 0, 1)
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current.currentTime = 0 }
    playAudio('gameover', 0.5)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)),
    })
  }, [onFinish, playAudio])

  const updatePlayerY = useCallback((clientY: number) => {
    const area = gameAreaRef.current
    if (!area) return
    const rect = area.getBoundingClientRect()
    const n = clamp(1 - (clientY - rect.top) / rect.height, 0, 1)
    const prevPos = playerPosRef.current
    playerPosRef.current = n
    setPlayerPosition(n)
    if (Math.abs(n - prevPos) > 0.12 && elapsedMsRef.current - lastSlideRef.current > 300) {
      lastSlideRef.current = elapsedMsRef.current
      playAudio('slide', 0.12, 0.8 + n * 0.4)
    }
  }, [playAudio])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    isDraggingRef.current = true
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    updatePlayerY(e.clientY)
  }, [updatePlayerY])

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return
    e.preventDefault()
    updatePlayerY(e.clientY)
  }, [updatePlayerY])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false
    ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
  }, [])

  // Init audio + BGM
  useEffect(() => {
    const sfxMap: Record<string, string> = {
      perfect: perfectSfx, good: goodSfx, miss: missSfx,
      fever: feverSfx, combo: comboSfx, timewarn: timeWarningSfx,
      gameover: gameOverSfx, levelup: levelUpSfx, powerup: powerUpSfx,
      star: starSfx, bonus: bonusSfx, slide: slideSfx,
    }
    for (const [k, src] of Object.entries(sfxMap)) {
      const a = new Audio(src)
      a.preload = 'auto'
      audios.current[k] = a
    }

    const bgm = new Audio(bgmLoop)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = 0.22
    bgmRef.current = bgm
    void bgm.play().catch(() => {})

    return () => {
      for (const k of Object.keys(audios.current)) audios.current[k] = null
      if (bgmRef.current) { bgmRef.current.pause(); bgmRef.current = null }
      effectsRef.current.cleanup()
    }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onExit])

  useEffect(() => {
    const handler = (e: TouchEvent) => { if (isDraggingRef.current) e.preventDefault() }
    window.addEventListener('touchmove', handler, { passive: false })
    return () => window.removeEventListener('touchmove', handler)
  }, [])

  // ─── Game Loop (deps: only stable refs, NOT effects object) ─────
  useEffect(() => {
    lastFrameRef.current = null
    const fx = () => effectsRef.current

    const step = (now: number) => {
      if (finishedRef.current) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now
      elapsedMsRef.current += dt

      remainingMsRef.current = Math.max(0, remainingMsRef.current - dt)
      setRemainingMs(remainingMsRef.current)
      setElapsedDisplay(elapsedMsRef.current)

      const curLevel = levelRef.current
      const target = computeTargetPosition(elapsedMsRef.current, curLevel)
      setTargetPosition(target)

      // Magnet power-up
      if (activePowerUpRef.current === 'magnet') {
        const diff = target - playerPosRef.current
        playerPosRef.current += diff * 0.12
        setPlayerPosition(playerPosRef.current)
      }

      const dist = Math.abs(target - playerPosRef.current)
      setAccDist(dist)

      // Power-up expiry
      if (activePowerUpRef.current && elapsedMsRef.current > powerUpEndRef.current) {
        activePowerUpRef.current = null
        setActivePowerUp(null)
      }

      // ─── Combo ───
      if (dist <= ACCURACY_GOOD_THRESHOLD) {
        lastComboTickRef.current = elapsedMsRef.current
        comboRef.current += 1
        if (comboRef.current > maxComboRef.current) maxComboRef.current = comboRef.current
      } else if (elapsedMsRef.current - lastComboTickRef.current > COMBO_DECAY_MS) {
        if (comboRef.current > 0) {
          comboRef.current = 0
          setVignette(true)
          setTimeout(() => setVignette(false), 200)
        }
      }
      setCombo(comboRef.current)

      // Character reaction
      if (elapsedMsRef.current - lastReactionRef.current > 300) {
        lastReactionRef.current = elapsedMsRef.current
        if (feverRef.current) setCharReaction('fever')
        else if (dist <= ACCURACY_PERFECT_THRESHOLD) setCharReaction('happy')
        else if (dist > ACCURACY_OK_THRESHOLD) setCharReaction('sad')
        else setCharReaction('idle')
      }

      // ─── Fever ───
      if (feverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - dt)
        setFeverRemainingMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { feverRef.current = false; setIsFever(false) }
      }

      // ─── Perfect streaks ───
      if (dist <= ACCURACY_PERFECT_THRESHOLD) {
        perfectStreakMsRef.current += dt
        if (perfectStreakMsRef.current >= PERFECT_STREAK_THRESHOLD_MS) {
          perfectStreakMsRef.current -= PERFECT_STREAK_THRESHOLD_MS
          perfectStreakCountRef.current += 1
          setPerfectStreakCount(perfectStreakCountRef.current)

          if (elapsedMsRef.current - lastMilestoneRef.current > 500) {
            lastMilestoneRef.current = elapsedMsRef.current
            const bonus = STREAK_MILESTONE_BONUS + comboRef.current * 3
            scoreRef.current += bonus
            fx().showScorePopup(bonus, 60, 100)
            playAudio('combo', 0.4, 1.0 + perfectStreakCountRef.current * 0.06)
            fx().spawnParticles(5, 60, 100, ['*', '#', '%', '+'])
          }

          if (perfectStreakCountRef.current >= FEVER_TRIGGER_STREAKS && !feverRef.current) {
            feverRef.current = true
            feverMsRef.current = FEVER_DURATION_MS
            setIsFever(true)
            setFeverRemainingMs(FEVER_DURATION_MS)
            fx().triggerFlash('rgba(250,204,21,0.7)')
            fx().triggerShake(10, 400)
            playAudio('fever', 0.7)
          }
        }
      } else {
        perfectStreakMsRef.current = 0
      }

      // ─── Scoring (continuous - while matching) ───
      const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
      const doubleMult = activePowerUpRef.current === 'double' ? 2 : 1
      const comboMult = 1 + Math.min(comboRef.current * 0.025, 1.5)
      const rate = accuracyScoreRate(dist)
      const gain = rate * (dt / 1000) * feverMult * doubleMult * comboMult
      const cBonus = comboRef.current > 5 ? COMBO_BONUS_BASE * (dt / 1000) * (comboRef.current / 8) : 0
      scoreRef.current += gain + cBonus
      setScore(Math.floor(scoreRef.current))
      setScorePerSec(Math.round(rate * feverMult * doubleMult * comboMult))

      // Level up
      const newLevel = getLevel(scoreRef.current)
      if (newLevel > levelRef.current) {
        levelRef.current = newLevel
        setLevel(newLevel)
        setLevelUpText(LEVEL_NAMES[newLevel])
        playAudio('levelup', 0.6)
        fx().triggerFlash('rgba(147,51,234,0.5)')
        fx().triggerShake(6, 200)
        fx().spawnParticles(8, 100, 200, ['*', '^', '<>', 'o'])
        setTimeout(() => setLevelUpText(''), 2000)
      }

      // ─── Scroll Notes ───
      if (elapsedMsRef.current - lastNoteSpawnRef.current > BASE_NOTE_SPAWN_INTERVAL_MS - curLevel * 150) {
        lastNoteSpawnRef.current = elapsedMsRef.current
        noteIdRef.current += 1
        const typeRoll = Math.random()
        const noteType: ScrollNote['type'] = typeRoll < 0.15 ? 'gold' : typeRoll < 0.3 ? 'long' : 'normal'
        scrollNotesRef.current = [...scrollNotesRef.current, {
          id: noteIdRef.current,
          yPos: computeTargetPosition(elapsedMsRef.current + 3500, curLevel),
          xPos: 1.1,
          spawnedAt: elapsedMsRef.current,
          hit: false,
          missed: false,
          points: noteType === 'gold' ? 500 : noteType === 'long' ? 300 : 150,
          type: noteType,
        }]
      }

      // Update scroll note positions & check hits
      const updatedNotes = scrollNotesRef.current.map(note => {
        if (note.hit || note.missed) return note
        const newX = note.xPos - BASE_NOTE_SPEED * dt
        if (newX <= NOTE_HIT_ZONE && newX > -0.05) {
          const yDist = Math.abs(playerPosRef.current - note.yPos)
          if (yDist < 0.12) {
            const pts = note.points * feverMult * doubleMult
            scoreRef.current += pts
            fx().comboHitBurst(40, 300 * (1 - note.yPos) + 40, 4, pts, ['*', '#', '%'])
            playAudio('bonus', 0.35, note.type === 'gold' ? 1.4 : 1.0)
            setHitFlash(note.type === 'gold' ? PIXEL_YELLOW : note.type === 'long' ? PIXEL_CYAN : PIXEL_GREEN)
            setTimeout(() => setHitFlash(null), 150)
            return { ...note, xPos: newX, hit: true }
          }
        }
        if (newX < -0.1) return { ...note, xPos: newX, missed: true }
        return { ...note, xPos: newX }
      }).filter(n => !n.missed || elapsedMsRef.current - n.spawnedAt < 5000)
      scrollNotesRef.current = updatedNotes
      setScrollNotes([...updatedNotes.filter(n => !n.hit && !n.missed)])

      // ─── Sound ───
      if (elapsedMsRef.current - lastSoundRef.current > 450) {
        if (dist <= ACCURACY_PERFECT_THRESHOLD) {
          lastSoundRef.current = elapsedMsRef.current
          playAudio('perfect', 0.25, 0.8 + target * 0.4)
        } else if (dist <= ACCURACY_GOOD_THRESHOLD) {
          lastSoundRef.current = elapsedMsRef.current
          playAudio('good', 0.2, 0.9 + target * 0.3)
        } else if (dist > ACCURACY_OK_THRESHOLD && elapsedMsRef.current - lastSoundRef.current > 1000) {
          lastSoundRef.current = elapsedMsRef.current
          playAudio('miss', 0.15)
        }
      }

      // ─── Particles ───
      if (dist <= ACCURACY_PERFECT_THRESHOLD && elapsedMsRef.current - lastParticleRef.current > 500) {
        lastParticleRef.current = elapsedMsRef.current
        fx().spawnParticles(3, 50, 300 * (1 - playerPosRef.current) + 40, ['#', '%', '~'])
        fx().triggerFlash('rgba(34,197,94,0.1)')
      }

      // ─── Bonus items ───
      if (elapsedMsRef.current - lastBonusRef.current > BONUS_INTERVAL_MS && elapsedMsRef.current > 2000) {
        lastBonusRef.current = elapsedMsRef.current
        bonusIdRef.current += 1
        const types: Array<BonusItem['type']> = ['note', 'note', 'star', 'heart']
        const type = types[Math.floor(Math.random() * types.length)]
        const scores = { note: 150, star: 300, heart: 100 }
        bonusItemsRef.current = [...bonusItemsRef.current, {
          id: bonusIdRef.current,
          position: 0.1 + Math.random() * 0.8,
          spawnedAt: elapsedMsRef.current,
          collected: false, type, score: scores[type],
        }]
      }

      const updatedBonuses = bonusItemsRef.current.map(item => {
        if (item.collected) return item
        if (elapsedMsRef.current - item.spawnedAt > BONUS_DURATION_MS) return { ...item, collected: true }
        if (Math.abs(playerPosRef.current - item.position) < BONUS_RADIUS) {
          const s = item.score * feverMult * doubleMult
          scoreRef.current += s
          fx().comboHitBurst(50, 300 * (1 - item.position) + 40, 5, s, ['*', '#', '%'])
          playAudio('star', 0.4, item.type === 'star' ? 1.3 : 1.0)
          if (item.type === 'heart') {
            remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + 2000)
            fx().showScorePopup(2, 120, 60)
          }
          return { ...item, collected: true }
        }
        return item
      }).filter(item => !item.collected || (elapsedMsRef.current - item.spawnedAt) < BONUS_DURATION_MS + 300)
      bonusItemsRef.current = updatedBonuses
      setBonusItems([...updatedBonuses])

      // ─── Power-ups ───
      if (elapsedMsRef.current - lastPowerUpRef.current > POWERUP_INTERVAL_MS && elapsedMsRef.current > 5000) {
        lastPowerUpRef.current = elapsedMsRef.current
        powerUpIdRef.current += 1
        const types: PowerUpType[] = ['double', 'shield', 'magnet']
        powerUpsRef.current = [...powerUpsRef.current, {
          id: powerUpIdRef.current,
          position: 0.15 + Math.random() * 0.7,
          spawnedAt: elapsedMsRef.current, collected: false,
          type: types[Math.floor(Math.random() * types.length)],
        }]
      }

      const updatedPowerUps = powerUpsRef.current.map(pu => {
        if (pu.collected) return pu
        if (elapsedMsRef.current - pu.spawnedAt > POWERUP_DURATION_MS) return { ...pu, collected: true }
        if (Math.abs(playerPosRef.current - pu.position) < BONUS_RADIUS) {
          activePowerUpRef.current = pu.type
          powerUpEndRef.current = elapsedMsRef.current + POWERUP_EFFECT_DURATION_MS
          setActivePowerUp(pu.type)
          playAudio('powerup', 0.5, 1.2)
          fx().triggerFlash(POWERUP_COLORS[pu.type] + '40')
          fx().triggerShake(4, 150)
          if (pu.type === 'shield') remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + 3000)
          return { ...pu, collected: true }
        }
        return pu
      }).filter(pu => !pu.collected || (elapsedMsRef.current - pu.spawnedAt) < POWERUP_DURATION_MS + 300)
      powerUpsRef.current = updatedPowerUps
      setPowerUps([...updatedPowerUps])

      // ─── Time warning ───
      if (remainingMsRef.current <= LOW_TIME_THRESHOLD_MS && remainingMsRef.current > 0) {
        if (elapsedMsRef.current - lastTimeWarnRef.current > 1000) {
          lastTimeWarnRef.current = elapsedMsRef.current
          playAudio('timewarn', 0.3)
          fx().triggerShake(3, 100)
        }
      }

      fx().updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); rafRef.current = null; return }
      rafRef.current = window.requestAnimationFrame(step)
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }
      lastFrameRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishGame, playAudio])

  // Derived
  const accLabel = accuracyLabel(accDist)
  const accColor = accuracyColor(accDist)
  const bestDisplay = useMemo(() => Math.max(bestScore, Math.floor(scoreRef.current)), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS
  const timePercent = (remainingMs / ROUND_DURATION_MS) * 100
  const targetTop = (1 - targetPosition) * 100
  const playerTop = (1 - playerPosition) * 100
  const levelProgress = level < LEVEL_THRESHOLDS.length - 1
    ? ((score - LEVEL_THRESHOLDS[level]) / (LEVEL_THRESHOLDS[level + 1] - LEVEL_THRESHOLDS[level])) * 100
    : 100

  return (
    <section className="mini-game-panel kp-panel" aria-label="karaoke-pitch-game" style={{ maxWidth: '432px', margin: '0 auto', aspectRatio: '9/16', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
        .kp-panel {
          display: flex; flex-direction: column; height: 100%;
          background: ${PIXEL_BG_DARK}; user-select: none; -webkit-user-select: none;
          touch-action: none; position: relative; overflow: hidden;
          font-family: 'Press Start 2P', monospace; image-rendering: pixelated;
        }
        .kp-scanlines { position: absolute; inset: 0; pointer-events: none; z-index: 20;
          background: repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px); }
        .kp-pixel-border { position: absolute; inset: 0; pointer-events: none; z-index: 19;
          border: 3px solid ${PIXEL_PURPLE}44; box-shadow: inset 0 0 30px rgba(147,51,234,0.1); }
        .kp-vignette { position: absolute; inset: 0; pointer-events: none; z-index: 18;
          box-shadow: inset 0 0 60px rgba(239,68,68,0.6); animation: kp-fade 0.3s ease-out forwards; }
        .kp-fever-bg { position: absolute; inset: 0; pointer-events: none; z-index: 1;
          background: repeating-linear-gradient(45deg, rgba(250,204,21,0.05) 0px, transparent 4px, transparent 8px, rgba(250,204,21,0.05) 12px);
          animation: kp-fever-scroll 0.5s linear infinite; }
        @keyframes kp-fever-scroll { from { background-position: 0 0; } to { background-position: 12px 12px; } }
        @keyframes kp-fade { from { opacity: 1; } to { opacity: 0; } }

        .kp-time-bar { height: 12px; background: #1a1a2e; flex-shrink: 0; z-index: 2; border-bottom: 2px solid ${PIXEL_PURPLE}33; }
        .kp-time-fill { height: 100%; transition: width 0.1s linear; }

        .kp-hud { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 6px; flex-shrink: 0; z-index: 2; }
        .kp-hud-left { display: flex; align-items: center; gap: 10px; }
        .kp-char-box { width: 60px; height: 60px; border: 4px solid ${PIXEL_PURPLE}; background: ${PIXEL_BG_MID};
          image-rendering: pixelated; overflow: hidden; flex-shrink: 0; }
        .kp-char-box img { width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; }
        .kp-char-box.happy { border-color: ${PIXEL_GREEN}; }
        .kp-char-box.sad { border-color: ${PIXEL_RED}; animation: kp-shake-sm 0.15s ease infinite; }
        .kp-char-box.fever { border-color: ${PIXEL_YELLOW}; animation: kp-glow-box 0.4s ease infinite alternate; }
        @keyframes kp-shake-sm { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-2px); } }
        @keyframes kp-glow-box { from { box-shadow: 0 0 4px ${PIXEL_YELLOW}88; } to { box-shadow: 0 0 16px ${PIXEL_YELLOW}cc; } }

        .kp-score-area { display: flex; flex-direction: column; gap: 2px; }
        .kp-score { font-size: clamp(24px, 7vw, 34px); color: ${PIXEL_PINK}; margin: 0; line-height: 1.2;
          text-shadow: 3px 3px 0 #000, 0 0 12px ${PIXEL_PINK}66; }
        .kp-best-score { font-size: 10px; color: ${PIXEL_WHITE}88; margin: 0; }
        .kp-score-rate { font-size: 12px; color: ${PIXEL_GREEN}; margin: 0; text-shadow: 1px 1px 0 #000;
          transition: color 0.1s; }
        .kp-score-rate.zero { color: ${PIXEL_RED}55; }
        .kp-level-bar { height: 7px; width: 100%; max-width: 140px; background: #1a1a2e;
          border: 2px solid ${PIXEL_PURPLE}44; margin-top: 2px; }
        .kp-level-fill { height: 100%; background: ${PIXEL_PURPLE}; transition: width 0.3s; }

        .kp-hud-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
        .kp-time { font-size: clamp(26px, 8vw, 38px); color: ${PIXEL_WHITE}; margin: 0; text-shadow: 3px 3px 0 #000; }
        .kp-time.low { color: ${PIXEL_RED}; animation: kp-blink 0.4s step-end infinite; }
        @keyframes kp-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
        .kp-level-badge { font-size: 11px; padding: 3px 8px; border: 2px solid ${PIXEL_PURPLE}; color: ${PIXEL_PURPLE}; }

        .kp-status { display: flex; align-items: center; justify-content: center; gap: 10px;
          padding: 6px 12px; flex-shrink: 0; z-index: 2; min-height: 44px; flex-wrap: wrap; }
        .kp-acc-label { font-size: clamp(22px, 6vw, 30px); margin: 0;
          text-shadow: 3px 3px 0 #000, 0 0 16px currentColor; transition: color 0.1s step-end; }
        .kp-combo-box { font-size: 18px; padding: 4px 10px; border: 3px solid ${PIXEL_CYAN};
          color: ${PIXEL_CYAN}; background: ${PIXEL_CYAN}15; text-shadow: 2px 2px 0 #000; }
        .kp-fever-box { font-size: 16px; padding: 4px 10px; border: 3px solid ${PIXEL_YELLOW};
          color: ${PIXEL_YELLOW}; background: ${PIXEL_YELLOW}15; animation: kp-blink 0.3s step-end infinite;
          text-shadow: 2px 2px 0 #000; }
        .kp-powerup-active { font-size: 16px; padding: 4px 8px; border: 3px solid; text-shadow: 2px 2px 0 #000; }
        .kp-streak-text { font-size: 13px; text-shadow: 2px 2px 0 #000, 0 0 8px currentColor; }

        .kp-levelup-overlay { position: absolute; top: 30%; left: 50%; transform: translate(-50%, -50%);
          z-index: 25; font-size: 24px; color: ${PIXEL_YELLOW};
          text-shadow: 4px 4px 0 #000, 0 0 28px ${PIXEL_YELLOW};
          animation: kp-levelup-anim 2s ease-out forwards; white-space: nowrap; pointer-events: none; }
        @keyframes kp-levelup-anim {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          15% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          30%,80% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; } }

        /* ─── Game Area ─── */
        .kp-game-area { flex: 1; min-height: 0; position: relative; cursor: grab; z-index: 2; overflow: hidden;
          background: linear-gradient(to bottom, #0e0e20, #080816, #0e0e20); }
        .kp-game-area:active { cursor: grabbing; }

        .kp-game-grid { position: absolute; inset: 0; pointer-events: none; }
        .kp-game-gridline { position: absolute; left: 0; right: 0; height: 1px; background: ${PIXEL_PURPLE}12; }
        .kp-game-vgridline { position: absolute; top: 0; bottom: 0; width: 1px; background: ${PIXEL_PURPLE}0a; }

        /* Hit zone indicator on left side */
        .kp-hit-zone { position: absolute; left: 0; top: 0; bottom: 0; width: ${NOTE_HIT_ZONE * 100}%;
          background: linear-gradient(to right, ${PIXEL_PURPLE}18, transparent);
          border-right: 2px dashed ${PIXEL_PURPLE}33; pointer-events: none; z-index: 1; }

        .kp-trail { position: absolute; left: 6%; right: 6%; transition: background-color 0.1s step-end;
          pointer-events: none; }

        .kp-target-zone { position: absolute; left: 2%; right: 2%; height: 64px;
          transform: translateY(-50%); border: 5px solid; transition: top 0.08s ease-out;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 10px;
          background: rgba(0,0,0,0.35); pointer-events: none;
          animation: kp-target-breathe 0.8s ease-in-out infinite alternate; }
        .kp-target-zone.fever {
          animation: kp-target-fever-pulse 0.3s step-end infinite alternate; }
        @keyframes kp-target-breathe {
          from { box-shadow: 0 0 8px currentColor; }
          to { box-shadow: 0 0 24px currentColor; } }
        @keyframes kp-target-fever-pulse {
          from { box-shadow: 0 0 15px ${PIXEL_YELLOW}88; }
          to { box-shadow: 0 0 40px ${PIXEL_YELLOW}cc; } }
        .kp-target-arrow { font-size: 20px; text-shadow: 2px 2px 0 #000;
          animation: kp-arrow-bounce 0.5s ease infinite alternate; pointer-events: none; }
        @keyframes kp-arrow-bounce {
          from { opacity: 0.6; } to { opacity: 1; } }
        .kp-target-label { font-size: 18px; text-shadow: 3px 3px 0 #000; pointer-events: none;
          letter-spacing: 3px; }

        .kp-player-bar { position: absolute; left: 2%; right: 2%; height: 8px;
          transform: translateY(-50%); pointer-events: none;
          transition: background-color 0.1s step-end; }
        .kp-player-diamond { position: absolute; left: 8%; top: 50%;
          transform: translate(-50%, -50%) rotate(45deg);
          width: 30px; height: 30px; border: 3px solid ${PIXEL_WHITE};
          pointer-events: none; }

        /* Scroll notes */
        .kp-scroll-note { position: absolute; transform: translate(-50%, -50%);
          pointer-events: none; z-index: 5;
          border: 3px solid; padding: 6px 10px;
          font-size: 18px; text-shadow: 2px 2px 0 #000;
          animation: kp-note-pulse 0.5s step-end infinite alternate; }
        .kp-scroll-note.gold { border-color: ${PIXEL_YELLOW}; color: ${PIXEL_YELLOW}; background: ${PIXEL_YELLOW}18; }
        .kp-scroll-note.normal { border-color: ${PIXEL_CYAN}; color: ${PIXEL_CYAN}; background: ${PIXEL_CYAN}18; }
        .kp-scroll-note.long { border-color: ${PIXEL_PINK}; color: ${PIXEL_PINK}; background: ${PIXEL_PINK}18; }
        @keyframes kp-note-pulse { from { filter: brightness(1); } to { filter: brightness(1.3); } }

        .kp-hit-flash { position: absolute; inset: 0; pointer-events: none; z-index: 10;
          animation: kp-fade 0.15s ease-out forwards; }

        .kp-bonus-item { position: absolute; left: 50%; transform: translate(-50%, -50%);
          font-size: 22px; text-shadow: 2px 2px 0 #000; pointer-events: none; z-index: 3;
          animation: kp-item-float 0.6s step-end infinite alternate;
          border: 3px solid ${PIXEL_YELLOW}88; padding: 5px 9px; background: ${PIXEL_YELLOW}15; color: ${PIXEL_YELLOW}; }
        .kp-bonus-item.star { border-color: ${PIXEL_CYAN}; color: ${PIXEL_CYAN}; background: ${PIXEL_CYAN}15; }
        .kp-bonus-item.heart { border-color: ${PIXEL_PINK}; color: ${PIXEL_PINK}; background: ${PIXEL_PINK}15; }
        @keyframes kp-item-float { from { transform: translate(-50%, -50%) scale(1); } to { transform: translate(-50%, -54%) scale(1.1); } }

        .kp-powerup-item { position: absolute; left: 50%; transform: translate(-50%, -50%);
          font-size: 17px; pointer-events: none; z-index: 4; padding: 7px 11px; border: 3px solid;
          text-shadow: 2px 2px 0 #000; animation: kp-pu-pulse 0.4s step-end infinite alternate; }
        @keyframes kp-pu-pulse {
          from { transform: translate(-50%, -50%) scale(1); } to { transform: translate(-50%, -55%) scale(1.15); } }

        .kp-glow-ring { position: absolute; left: 50%; transform: translate(-50%, -50%);
          width: 90px; height: 90px; border: 3px solid ${PIXEL_GREEN}66;
          pointer-events: none; animation: kp-ring 0.8s step-start infinite; }
        @keyframes kp-ring { 0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; } }

        .kp-wave-overlay { position: absolute; bottom: 0; left: 0; right: 0; height: 25%;
          pointer-events: none; z-index: 1; opacity: 0.3; }
        .kp-wave-overlay canvas { width: 100%; height: 100%; display: block; image-rendering: pixelated; }

        .kp-guide { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
          font-size: 11px; color: ${PIXEL_WHITE}44; text-shadow: 1px 1px 0 #000;
          pointer-events: none; z-index: 5; white-space: nowrap; animation: kp-blink 2.5s ease infinite; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="kp-scanlines" />
      <div className="kp-pixel-border" />
      {vignette && <div className="kp-vignette" />}
      {isFever && <div className="kp-fever-bg" />}
      {levelUpText && <div className="kp-levelup-overlay">{levelUpText}</div>}

      {/* Time bar */}
      <div className="kp-time-bar">
        <div className="kp-time-fill" style={{
          width: `${timePercent}%`,
          background: isLowTime ? PIXEL_RED : isFever ? PIXEL_YELLOW : `linear-gradient(90deg, ${PIXEL_PURPLE}, ${PIXEL_PINK})`,
        }} />
      </div>

      {/* HUD */}
      <div className="kp-hud">
        <div className="kp-hud-left">
          <div className={`kp-char-box ${charReaction}`}>
            <img src={characterImage} alt="" style={{
              transform: charReaction === 'happy' ? 'scale(1.1)' : charReaction === 'sad' ? 'scale(0.9) rotate(-5deg)' : charReaction === 'fever' ? 'scale(1.15)' : 'none',
              transition: 'transform 0.15s step-end',
            }} />
          </div>
          <div className="kp-score-area">
            <p className="kp-score">{Math.floor(score).toLocaleString()}</p>
            <p className={`kp-score-rate ${scorePerSec === 0 ? 'zero' : ''}`}>+{scorePerSec}/s</p>
            <p className="kp-best-score">HI {bestDisplay.toLocaleString()}</p>
            <div className="kp-level-bar">
              <div className="kp-level-fill" style={{ width: `${levelProgress}%` }} />
            </div>
          </div>
        </div>
        <div className="kp-hud-right">
          <p className={`kp-time ${isLowTime ? 'low' : ''}`}>{Math.ceil(remainingMs / 1000)}</p>
          <span className="kp-level-badge">{LEVEL_NAMES[level]}</span>
        </div>
      </div>

      {/* Status */}
      <div className="kp-status">
        <p className="kp-acc-label" style={{ color: accColor }}>{accLabel}</p>
        {combo >= 3 && <span className="kp-combo-box">{combo}x</span>}
        {perfectStreakCount > 0 && (
          <span className="kp-streak-text" style={{ color: PIXEL_GREEN }}>STREAK {perfectStreakCount}</span>
        )}
        {isFever && <span className="kp-fever-box">FEVER x{FEVER_SCORE_MULTIPLIER} {Math.ceil(feverRemainingMs / 1000)}s</span>}
        {activePowerUp && (
          <span className="kp-powerup-active" style={{ borderColor: POWERUP_COLORS[activePowerUp], color: POWERUP_COLORS[activePowerUp] }}>
            {POWERUP_ICONS[activePowerUp]}
          </span>
        )}
      </div>

      {/* Game Area */}
      <div
        className="kp-game-area"
        ref={gameAreaRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="slider"
        aria-label="pitch-slider"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(playerPosition * 100)}
      >
        {/* Grid */}
        <div className="kp-game-grid">
          {[0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map(m => (
            <div key={m} className="kp-game-gridline" style={{ top: `${m}%` }} />
          ))}
          {[20, 40, 60, 80].map(m => (
            <div key={m} className="kp-game-vgridline" style={{ left: `${m}%` }} />
          ))}
        </div>

        {/* Hit zone indicator */}
        <div className="kp-hit-zone" />

        {/* Hit flash */}
        {hitFlash && <div className="kp-hit-flash" style={{ boxShadow: `inset 0 0 60px ${hitFlash}55` }} />}

        {/* Trail between target and player */}
        {(() => {
          const tP = (1 - targetPosition) * 100
          const pP = (1 - playerPosition) * 100
          const mn = Math.min(tP, pP)
          const h = Math.max(Math.abs(tP - pP), 1)
          return <div className="kp-trail" style={{ top: `${mn}%`, height: `${h}%`, backgroundColor: accColor, opacity: isFever ? 0.45 : 0.2 }} />
        })()}

        {/* Scroll notes */}
        {scrollNotes.map(note => (
          <div key={note.id}
            className={`kp-scroll-note ${note.type}`}
            style={{ left: `${note.xPos * 100}%`, top: `${(1 - note.yPos) * 100}%` }}
          >
            {note.type === 'gold' ? '$' : note.type === 'long' ? '~' : '#'}
          </div>
        ))}

        {/* Bonus items */}
        {bonusItems.filter(i => !i.collected).map(item => {
          const age = elapsedDisplay - item.spawnedAt
          const op = age > BONUS_DURATION_MS * 0.7 ? 0.4 : 1
          return (
            <div key={item.id}
              className={`kp-bonus-item ${item.type === 'star' ? 'star' : item.type === 'heart' ? 'heart' : ''}`}
              style={{ top: `${(1 - item.position) * 100}%`, opacity: op }}>
              {item.type === 'note' ? '#' : item.type === 'star' ? '*' : '<3'}
            </div>
          )
        })}

        {/* Power-ups */}
        {powerUps.filter(p => !p.collected).map(pu => {
          const age = elapsedDisplay - pu.spawnedAt
          const op = age > POWERUP_DURATION_MS * 0.7 ? 0.4 : 1
          return (
            <div key={pu.id} className="kp-powerup-item" style={{
              top: `${(1 - pu.position) * 100}%`, opacity: op,
              borderColor: POWERUP_COLORS[pu.type], color: POWERUP_COLORS[pu.type],
              background: POWERUP_COLORS[pu.type] + '20',
            }}>{POWERUP_ICONS[pu.type]}</div>
          )
        })}

        {/* Glow ring on perfect */}
        {accDist <= ACCURACY_PERFECT_THRESHOLD && (
          <div className="kp-glow-ring" style={{ top: `${targetTop}%` }} />
        )}

        {/* Target zone (moves up/down — FOLLOW THIS!) */}
        <div className={`kp-target-zone ${isFever ? 'fever' : ''}`} style={{
          top: `${targetTop}%`, borderColor: isFever ? PIXEL_YELLOW : accColor,
        }}>
          <span className="kp-target-arrow" style={{ color: isFever ? PIXEL_YELLOW : accColor }}>{'>>>'}</span>
          <span className="kp-target-label" style={{ color: isFever ? PIXEL_YELLOW : accColor }}>MATCH HERE</span>
          <span className="kp-target-arrow" style={{ color: isFever ? PIXEL_YELLOW : accColor }}>{'<<<'}</span>
        </div>

        {/* Player marker (follows your finger) */}
        <div className="kp-player-bar" style={{
          top: `${playerTop}%`, backgroundColor: accColor,
          boxShadow: `0 0 14px ${accColor}88`,
        }}>
          <div className="kp-player-diamond" style={{ backgroundColor: accColor, boxShadow: `0 0 12px ${accColor}` }} />
        </div>

        {/* Waveform overlay */}
        <div className="kp-wave-overlay">
          <PixelWaveform
            targetPosition={targetPosition} playerPosition={playerPosition}
            accColor={accColor} elapsedMs={elapsedDisplay}
            isFever={isFever} combo={combo} level={level}
          />
        </div>

        <div className="kp-guide">DRAG UP / DOWN</div>
      </div>
    </section>
  )
}

// ─── Pixel Waveform Canvas ──────────────────────────────────────────

function PixelWaveform({
  targetPosition, playerPosition, accColor, elapsedMs, isFever, combo, level,
}: {
  targetPosition: number; playerPosition: number; accColor: string
  elapsedMs: number; isFever: boolean; combo: number; level: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const historyRef = useRef<{ target: number; player: number; color: string }[]>([])
  const MAX_HIST = 200

  useEffect(() => {
    historyRef.current.push({ target: targetPosition, player: playerPosition, color: accColor })
    if (historyRef.current.length > MAX_HIST) historyRef.current.shift()

    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const W = Math.floor(rect.width * dpr)
    const H = Math.floor(rect.height * dpr)
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, W, H)

    const hist = historyRef.current
    const len = hist.length
    if (len < 2) return

    const pad = 6 * dpr
    const dW = W - pad * 2
    const dH = H - pad * 2
    const PX = Math.max(2, Math.floor(3 * dpr))

    // Target line
    const tc = isFever ? PIXEL_YELLOW : PIXEL_PURPLE
    ctx.fillStyle = tc + '55'
    for (let i = 0; i < len; i++) {
      const x = Math.floor(pad + (i / (MAX_HIST - 1)) * dW)
      const y = Math.floor(pad + (1 - hist[i].target) * dH)
      ctx.fillRect(x, y - PX / 2, PX, PX)
    }

    // Player line (recent bright)
    for (let i = Math.max(0, len - 80); i < len; i++) {
      const alpha = ((i - (len - 80)) / 80)
      ctx.fillStyle = hist[i].color + Math.floor(alpha * 200 + 55).toString(16).padStart(2, '0')
      const x = Math.floor(pad + (i / (MAX_HIST - 1)) * dW)
      const y = Math.floor(pad + (1 - hist[i].player) * dH)
      ctx.fillRect(x, y - PX / 2, PX, PX)
    }

    // Current markers
    const last = hist[len - 1]
    const lx = Math.floor(pad + ((len - 1) / (MAX_HIST - 1)) * dW)
    const tY = Math.floor(pad + (1 - last.target) * dH)
    const pY = Math.floor(pad + (1 - last.player) * dH)

    const DS = Math.floor(5 * dpr)
    ctx.fillStyle = tc
    ctx.beginPath()
    ctx.moveTo(lx, tY - DS); ctx.lineTo(lx + DS, tY); ctx.lineTo(lx, tY + DS); ctx.lineTo(lx - DS, tY)
    ctx.closePath(); ctx.fill()

    const PS = Math.floor(4 * dpr)
    ctx.fillStyle = last.color
    ctx.fillRect(lx - PS, pY - PS, PS * 2, PS * 2)

    // Accuracy bar
    const mW = Math.floor(dW * 0.5)
    const mH = Math.floor(3 * dpr)
    const mX = Math.floor(W / 2 - mW / 2)
    const mY = H - pad - mH
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(mX, mY, mW, mH)
    const ap = Math.max(0, 1 - (Math.abs(targetPosition - playerPosition) / 0.5))
    ctx.fillStyle = last.color
    ctx.fillRect(mX, mY, Math.floor(mW * ap), mH)

  }, [targetPosition, playerPosition, accColor, elapsedMs, isFever, combo, level])

  return <canvas ref={canvasRef} />
}

// ─── Module Export ───────────────────────────────────────────────────

export const karaokePitchModule: MiniGameModule = {
  manifest: {
    id: 'karaoke-pitch',
    title: 'Karaoke Pitch',
    description: 'Drag to match the moving TARGET! Catch notes for bonus!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#d946ef',
  },
  Component: KaraokePitchGame,
}
