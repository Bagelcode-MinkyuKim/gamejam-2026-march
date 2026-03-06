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

// ─── Game Constants ─────────────────────────────────────────────────
const ROUND_DURATION_MS = 40000
const PITCH_BAR_WIDTH = 72

// Accuracy
const ACCURACY_PERFECT_THRESHOLD = 0.04
const ACCURACY_GOOD_THRESHOLD = 0.12
const ACCURACY_OK_THRESHOLD = 0.25

// Scoring
const SCORE_PER_SECOND_PERFECT = 180
const SCORE_PER_SECOND_GOOD = 80
const SCORE_PER_SECOND_OK = 35

// Time
const LOW_TIME_THRESHOLD_MS = 7000

// Streak & Fever
const PERFECT_STREAK_THRESHOLD_MS = 1500
const FEVER_TRIGGER_STREAKS = 3
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 3
const STREAK_MILESTONE_BONUS = 100

// Combo
const COMBO_DECAY_MS = 500
const COMBO_BONUS_BASE = 12

// Level system
const LEVEL_THRESHOLDS = [0, 800, 2000, 4000, 7000, 11000, 16000, 22000, 30000]
const LEVEL_NAMES = ['Lv.1 DEBUT', 'Lv.2 ROOKIE', 'Lv.3 SINGER', 'Lv.4 STAR', 'Lv.5 IDOL', 'Lv.6 LEGEND', 'Lv.7 MASTER', 'Lv.8 GOD', 'Lv.9 MAX']

// Pitch movement
const SINE_BASE_PERIOD_MS = 3500
const SINE_MIN_PERIOD_MS = 1000
const SINE_PERIOD_DECAY_PER_MS = 0.07
const SINE_SECONDARY_AMPLITUDE = 0.22
const SINE_SECONDARY_PERIOD_RATIO = 2.73

// Bonus items
const BONUS_INTERVAL_MS = 3500
const BONUS_DURATION_MS = 2500
const BONUS_RADIUS = 0.09

// Power-ups
const POWERUP_INTERVAL_MS = 12000
const POWERUP_DURATION_MS = 3000
const POWERUP_EFFECT_DURATION_MS = 5000

type PowerUpType = 'double' | 'freeze' | 'magnet'
const POWERUP_ICONS: Record<PowerUpType, string> = { double: '2x', freeze: '||', magnet: '<>' }
const POWERUP_COLORS: Record<PowerUpType, string> = { double: '#facc15', freeze: '#38bdf8', magnet: '#a855f7' }

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeTargetPosition(elapsedMs: number, level: number): number {
  const difficultyFactor = 0.6 + level * 0.15
  const currentPeriod = Math.max(SINE_MIN_PERIOD_MS, SINE_BASE_PERIOD_MS - elapsedMs * SINE_PERIOD_DECAY_PER_MS)
  const p1 = (elapsedMs / currentPeriod) * Math.PI * 2
  const p2 = (elapsedMs / (currentPeriod * SINE_SECONDARY_PERIOD_RATIO)) * Math.PI * 2
  const p3 = (elapsedMs / (currentPeriod * 0.37)) * Math.PI * 2
  const val = Math.sin(p1) + Math.sin(p2) * SINE_SECONDARY_AMPLITUDE * difficultyFactor + Math.sin(p3) * 0.1 * difficultyFactor
  return clamp(val * 0.45 + 0.5, 0.03, 0.97)
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
  const [elapsedDisplay, setElapsedDisplay] = useState(0)
  const [vignette, setVignette] = useState(false)
  const [level, setLevel] = useState(0)
  const [levelUpText, setLevelUpText] = useState('')
  const [activePowerUp, setActivePowerUp] = useState<PowerUpType | null>(null)
  const [charReaction, setCharReaction] = useState<'idle' | 'happy' | 'sad' | 'fever'>('idle')
  const [, setScanlineOffset] = useState(0)

  const effects = useGameEffects()

  // Refs
  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const elapsedMsRef = useRef(0)
  const playerPosRef = useRef(0.5)
  const finishedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const isDraggingRef = useRef(false)
  const pitchBarRef = useRef<HTMLDivElement | null>(null)

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

  const lastSoundRef = useRef(0)
  const lastParticleRef = useRef(0)
  const lastTimeWarnRef = useRef(0)
  const lastReactionRef = useRef(0)

  // Audio refs
  const audios = useRef<Record<string, HTMLAudioElement | null>>({})

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
    playAudio('gameover', 0.5)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)),
    })
  }, [onFinish, playAudio])

  const updatePlayerY = useCallback((clientY: number) => {
    const bar = pitchBarRef.current
    if (!bar) return
    const rect = bar.getBoundingClientRect()
    const n = clamp(1 - (clientY - rect.top) / rect.height, 0, 1)
    playerPosRef.current = n
    setPlayerPosition(n)
  }, [])

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

  // Init audio
  useEffect(() => {
    const sfxMap: Record<string, string> = {
      perfect: perfectSfx, good: goodSfx, miss: missSfx,
      fever: feverSfx, combo: comboSfx, timewarn: timeWarningSfx,
      gameover: gameOverSfx, levelup: levelUpSfx, powerup: powerUpSfx, star: starSfx,
    }
    for (const [k, src] of Object.entries(sfxMap)) {
      const a = new Audio(src)
      a.preload = 'auto'
      audios.current[k] = a
    }
    return () => {
      for (const k of Object.keys(audios.current)) audios.current[k] = null
      effects.cleanup()
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

  // ─── Game Loop ──────────────────────────────────────────────────
  useEffect(() => {
    lastFrameRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now
      elapsedMsRef.current += dt

      remainingMsRef.current = Math.max(0, remainingMsRef.current - dt)
      setRemainingMs(remainingMsRef.current)
      setElapsedDisplay(elapsedMsRef.current)
      setScanlineOffset(prev => (prev + dt * 0.03) % 8)

      const curLevel = levelRef.current
      const target = computeTargetPosition(elapsedMsRef.current, curLevel)
      setTargetPosition(target)

      // Magnet power-up: auto-track toward target
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
            effects.showScorePopup(bonus, 60, 100)
            playAudio('combo', 0.4, 1.0 + perfectStreakCountRef.current * 0.06)
            effects.spawnParticles(5, 60, 100, ['★', '♪', '♫', '✦'])
          }

          if (perfectStreakCountRef.current >= FEVER_TRIGGER_STREAKS && !feverRef.current) {
            feverRef.current = true
            feverMsRef.current = FEVER_DURATION_MS
            setIsFever(true)
            setFeverRemainingMs(FEVER_DURATION_MS)
            effects.triggerFlash('rgba(250,204,21,0.7)')
            effects.triggerShake(10, 400)
            playAudio('fever', 0.7)
          }
        }
      } else {
        perfectStreakMsRef.current = 0
      }

      // ─── Scoring ───
      const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
      const doubleMult = activePowerUpRef.current === 'double' ? 2 : 1
      const comboMult = 1 + Math.min(comboRef.current * 0.025, 1.5)
      const rate = accuracyScoreRate(dist)
      const gain = rate * (dt / 1000) * feverMult * doubleMult * comboMult
      const cBonus = comboRef.current > 5 ? COMBO_BONUS_BASE * (dt / 1000) * (comboRef.current / 8) : 0
      scoreRef.current += gain + cBonus
      setScore(Math.floor(scoreRef.current))

      // Level up check
      const newLevel = getLevel(scoreRef.current)
      if (newLevel > levelRef.current) {
        levelRef.current = newLevel
        setLevel(newLevel)
        setLevelUpText(LEVEL_NAMES[newLevel])
        playAudio('levelup', 0.6)
        effects.triggerFlash('rgba(147,51,234,0.5)')
        effects.triggerShake(6, 200)
        effects.spawnParticles(8, 100, 200, ['★', '▲', '◆', '●'])
        setTimeout(() => setLevelUpText(''), 2000)
      }

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
        effects.spawnParticles(3, 50, 300 * (1 - playerPosRef.current) + 40, ['♪', '♫', '♬'])
        effects.triggerFlash('rgba(34,197,94,0.1)')
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
          collected: false,
          type,
          score: scores[type],
        }]
      }

      // Collect bonus items
      const updatedBonuses = bonusItemsRef.current.map(item => {
        if (item.collected) return item
        if (elapsedMsRef.current - item.spawnedAt > BONUS_DURATION_MS) return { ...item, collected: true }
        if (Math.abs(playerPosRef.current - item.position) < BONUS_RADIUS) {
          const s = item.score * feverMult * doubleMult
          scoreRef.current += s
          effects.comboHitBurst(50, 300 * (1 - item.position) + 40, 5, s, ['★', '♪', '♫'])
          playAudio('star', 0.4, item.type === 'star' ? 1.3 : 1.0)
          // Heart gives time bonus
          if (item.type === 'heart') {
            remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + 2000)
            effects.showScorePopup(2, 120, 60)
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
        const types: PowerUpType[] = ['double', 'freeze', 'magnet']
        powerUpsRef.current = [...powerUpsRef.current, {
          id: powerUpIdRef.current,
          position: 0.15 + Math.random() * 0.7,
          spawnedAt: elapsedMsRef.current,
          collected: false,
          type: types[Math.floor(Math.random() * types.length)],
        }]
      }

      // Collect power-ups
      const updatedPowerUps = powerUpsRef.current.map(pu => {
        if (pu.collected) return pu
        if (elapsedMsRef.current - pu.spawnedAt > POWERUP_DURATION_MS) return { ...pu, collected: true }
        if (Math.abs(playerPosRef.current - pu.position) < BONUS_RADIUS) {
          activePowerUpRef.current = pu.type
          powerUpEndRef.current = elapsedMsRef.current + POWERUP_EFFECT_DURATION_MS
          setActivePowerUp(pu.type)
          playAudio('powerup', 0.5, 1.2)
          effects.triggerFlash(POWERUP_COLORS[pu.type] + '40')
          effects.triggerShake(4, 150)
          // Freeze power-up pauses timer
          if (pu.type === 'freeze') {
            remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + 3000)
          }
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
          effects.triggerShake(3, 100)
        }
      }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) { finishGame(); rafRef.current = null; return }
      rafRef.current = window.requestAnimationFrame(step)
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }
      lastFrameRef.current = null
    }
  }, [finishGame, playAudio, effects])

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
    <section className="mini-game-panel kp-panel" aria-label="karaoke-pitch-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .kp-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: ${PIXEL_BG_DARK};
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          position: relative;
          overflow: hidden;
          font-family: 'Press Start 2P', monospace;
          image-rendering: pixelated;
        }

        .kp-scanlines {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 20;
          background: repeating-linear-gradient(
            0deg,
            transparent 0px,
            transparent 3px,
            rgba(0,0,0,0.08) 3px,
            rgba(0,0,0,0.08) 4px
          );
        }

        .kp-pixel-border {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 19;
          border: 3px solid ${PIXEL_PURPLE}44;
          box-shadow: inset 0 0 30px rgba(147,51,234,0.1);
        }

        .kp-vignette {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 18;
          box-shadow: inset 0 0 60px rgba(239,68,68,0.6);
          animation: kp-fade 0.3s ease-out forwards;
        }

        .kp-fever-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 1;
          background: repeating-linear-gradient(
            45deg,
            rgba(250,204,21,0.03) 0px,
            transparent 4px,
            transparent 8px,
            rgba(250,204,21,0.03) 12px
          );
          animation: kp-fever-scroll 0.5s linear infinite;
        }

        @keyframes kp-fever-scroll {
          from { background-position: 0 0; }
          to { background-position: 12px 12px; }
        }

        @keyframes kp-fade {
          from { opacity: 1; } to { opacity: 0; }
        }

        .kp-time-bar {
          height: 6px;
          background: #1a1a2e;
          flex-shrink: 0;
          z-index: 2;
          border-bottom: 2px solid ${PIXEL_PURPLE}33;
        }

        .kp-time-fill {
          height: 100%;
          transition: width 0.1s linear;
          image-rendering: pixelated;
        }

        .kp-hud {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 10px 2px;
          flex-shrink: 0;
          z-index: 2;
        }

        .kp-hud-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .kp-char-box {
          width: 48px;
          height: 48px;
          border: 3px solid ${PIXEL_PURPLE};
          background: ${PIXEL_BG_MID};
          image-rendering: pixelated;
          position: relative;
          overflow: hidden;
          flex-shrink: 0;
        }

        .kp-char-box img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          image-rendering: pixelated;
        }

        .kp-char-box.happy { border-color: ${PIXEL_GREEN}; }
        .kp-char-box.sad { border-color: ${PIXEL_RED}; animation: kp-shake-sm 0.15s ease infinite; }
        .kp-char-box.fever { border-color: ${PIXEL_YELLOW}; animation: kp-glow-box 0.4s ease infinite alternate; }

        @keyframes kp-shake-sm {
          0%,100% { transform: translateX(0); } 50% { transform: translateX(-2px); }
        }

        @keyframes kp-glow-box {
          from { box-shadow: 0 0 4px ${PIXEL_YELLOW}88; }
          to { box-shadow: 0 0 12px ${PIXEL_YELLOW}cc; }
        }

        .kp-score-area {
          display: flex;
          flex-direction: column;
          gap: 1px;
        }

        .kp-score {
          font-size: 16px;
          color: ${PIXEL_PINK};
          margin: 0;
          line-height: 1.2;
          text-shadow: 2px 2px 0 #000, 0 0 8px ${PIXEL_PINK}66;
        }

        .kp-best-score {
          font-size: 6px;
          color: ${PIXEL_WHITE}88;
          margin: 0;
        }

        .kp-level-bar {
          height: 4px;
          width: 80px;
          background: #1a1a2e;
          border: 1px solid ${PIXEL_PURPLE}44;
          margin-top: 2px;
        }

        .kp-level-fill {
          height: 100%;
          background: ${PIXEL_PURPLE};
          transition: width 0.3s;
        }

        .kp-hud-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .kp-time {
          font-size: 14px;
          color: ${PIXEL_WHITE};
          margin: 0;
          text-shadow: 2px 2px 0 #000;
        }

        .kp-time.low { color: ${PIXEL_RED}; animation: kp-blink 0.4s step-end infinite; }

        @keyframes kp-blink {
          0%,100% { opacity: 1; } 50% { opacity: 0.3; }
        }

        .kp-status {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 2px 8px;
          flex-shrink: 0;
          z-index: 2;
          min-height: 24px;
        }

        .kp-acc-label {
          font-size: 14px;
          margin: 0;
          text-shadow: 2px 2px 0 #000, 0 0 10px currentColor;
          transition: color 0.1s step-end;
        }

        .kp-combo-box {
          font-size: 8px;
          padding: 2px 6px;
          border: 2px solid ${PIXEL_CYAN};
          color: ${PIXEL_CYAN};
          background: ${PIXEL_CYAN}15;
          text-shadow: 1px 1px 0 #000;
        }

        .kp-fever-box {
          font-size: 8px;
          padding: 2px 6px;
          border: 2px solid ${PIXEL_YELLOW};
          color: ${PIXEL_YELLOW};
          background: ${PIXEL_YELLOW}15;
          animation: kp-blink 0.3s step-end infinite;
          text-shadow: 1px 1px 0 #000;
        }

        .kp-powerup-active {
          font-size: 7px;
          padding: 2px 5px;
          border: 2px solid;
          text-shadow: 1px 1px 0 #000;
        }

        .kp-level-badge {
          font-size: 6px;
          padding: 1px 4px;
          border: 1px solid ${PIXEL_PURPLE};
          color: ${PIXEL_PURPLE};
        }

        .kp-levelup-overlay {
          position: absolute;
          top: 35%;
          left: 50%;
          transform: translate(-50%, -50%);
          z-index: 25;
          font-size: 14px;
          color: ${PIXEL_YELLOW};
          text-shadow: 3px 3px 0 #000, 0 0 20px ${PIXEL_YELLOW};
          animation: kp-levelup-anim 2s ease-out forwards;
          white-space: nowrap;
          pointer-events: none;
        }

        @keyframes kp-levelup-anim {
          0% { transform: translate(-50%, -50%) scale(0.3); opacity: 0; }
          15% { transform: translate(-50%, -50%) scale(1.3); opacity: 1; }
          30% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          80% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
        }

        .kp-arena {
          display: flex;
          flex-direction: row;
          align-items: stretch;
          gap: 6px;
          flex: 1;
          padding: 4px 8px 6px;
          min-height: 0;
          overflow: hidden;
          z-index: 2;
        }

        .kp-bar {
          width: ${PITCH_BAR_WIDTH}px;
          flex-shrink: 0;
          position: relative;
          cursor: grab;
          background: #0e0e20;
          border: 3px solid ${PIXEL_PURPLE}44;
          overflow: hidden;
        }

        .kp-bar:active { cursor: grabbing; border-color: ${PIXEL_PURPLE}88; }
        .kp-bar.fever { border-color: ${PIXEL_YELLOW}66; }

        .kp-bar-track {
          position: absolute;
          inset: 4px;
          background: linear-gradient(to bottom, #1a1040, #0a0a20, #1a1040);
        }

        .kp-bar-grid {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .kp-bar-gridline {
          position: absolute;
          left: 0;
          right: 0;
          height: 2px;
          background: ${PIXEL_PURPLE}15;
        }

        .kp-trail {
          position: absolute;
          left: 2px;
          right: 2px;
          transition: background-color 0.1s step-end;
        }

        .kp-target {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 28px;
          height: 28px;
          border: 3px solid;
          transition: top 0.05s linear;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .kp-target.fever { box-shadow: 0 0 12px ${PIXEL_YELLOW}88; }

        .kp-target-inner {
          width: 10px;
          height: 10px;
        }

        .kp-player {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%) rotate(45deg);
          width: 22px;
          height: 22px;
          border: 2px solid ${PIXEL_WHITE}cc;
          transition: background-color 0.1s step-end;
        }

        .kp-bonus-item {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 8px;
          color: ${PIXEL_YELLOW};
          text-shadow: 1px 1px 0 #000;
          pointer-events: none;
          z-index: 3;
          animation: kp-item-float 0.6s step-end infinite alternate;
          border: 2px solid ${PIXEL_YELLOW}88;
          padding: 2px 4px;
          background: ${PIXEL_YELLOW}15;
        }

        .kp-bonus-item.star { border-color: ${PIXEL_CYAN}; color: ${PIXEL_CYAN}; background: ${PIXEL_CYAN}15; }
        .kp-bonus-item.heart { border-color: ${PIXEL_PINK}; color: ${PIXEL_PINK}; background: ${PIXEL_PINK}15; }

        @keyframes kp-item-float {
          from { transform: translate(-50%, -50%) scale(1); }
          to { transform: translate(-50%, -54%) scale(1.1); }
        }

        .kp-powerup-item {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          font-size: 7px;
          pointer-events: none;
          z-index: 4;
          padding: 3px 5px;
          border: 2px solid;
          text-shadow: 1px 1px 0 #000;
          animation: kp-pu-pulse 0.4s step-end infinite alternate;
        }

        @keyframes kp-pu-pulse {
          from { transform: translate(-50%, -50%) scale(1); filter: brightness(1); }
          to { transform: translate(-50%, -55%) scale(1.15); filter: brightness(1.3); }
        }

        .kp-glow-ring {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 44px;
          height: 44px;
          border: 2px solid ${PIXEL_GREEN}66;
          pointer-events: none;
          animation: kp-ring 0.8s step-start infinite;
        }

        @keyframes kp-ring {
          0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
        }

        .kp-wave {
          flex: 1;
          min-width: 0;
          position: relative;
          background: #0e0e20;
          border: 3px solid ${PIXEL_PURPLE}44;
          overflow: hidden;
        }

        .kp-wave.fever { border-color: ${PIXEL_YELLOW}44; }

        .kp-wave canvas {
          width: 100%;
          height: 100%;
          display: block;
          image-rendering: pixelated;
        }
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
          background: isLowTime ? PIXEL_RED
            : isFever ? PIXEL_YELLOW
            : `linear-gradient(90deg, ${PIXEL_PURPLE}, ${PIXEL_PINK})`,
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
            <p className="kp-best-score">HI {bestDisplay.toLocaleString()}</p>
            <div className="kp-level-bar">
              <div className="kp-level-fill" style={{ width: `${levelProgress}%` }} />
            </div>
          </div>
        </div>
        <div className="kp-hud-right">
          <p className={`kp-time ${isLowTime ? 'low' : ''}`}>
            {Math.ceil(remainingMs / 1000)}
          </p>
          <span className="kp-level-badge">{LEVEL_NAMES[level]}</span>
        </div>
      </div>

      {/* Status */}
      <div className="kp-status">
        <p className="kp-acc-label" style={{ color: accColor }}>{accLabel}</p>
        {combo >= 3 && <span className="kp-combo-box">{combo}x</span>}
        {perfectStreakCount > 0 && (
          <span style={{ fontSize: 7, color: PIXEL_GREEN, textShadow: `1px 1px 0 #000, 0 0 4px ${PIXEL_GREEN}` }}>
            STREAK{perfectStreakCount}
          </span>
        )}
        {isFever && <span className="kp-fever-box">FEVER x{FEVER_SCORE_MULTIPLIER} {Math.ceil(feverRemainingMs / 1000)}s</span>}
        {activePowerUp && (
          <span className="kp-powerup-active" style={{ borderColor: POWERUP_COLORS[activePowerUp], color: POWERUP_COLORS[activePowerUp] }}>
            {POWERUP_ICONS[activePowerUp]}
          </span>
        )}
      </div>

      {/* Arena */}
      <div className="kp-arena">
        <div
          className={`kp-bar ${isFever ? 'fever' : ''}`}
          ref={pitchBarRef}
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
          <div className="kp-bar-track">
            {/* Grid */}
            <div className="kp-bar-grid">
              {[0, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100].map(m => (
                <div key={m} className="kp-bar-gridline" style={{ top: `${m}%` }} />
              ))}
            </div>

            {/* Trail */}
            {(() => {
              const tP = (1 - targetPosition) * 100
              const pP = (1 - playerPosition) * 100
              const mn = Math.min(tP, pP)
              const h = Math.max(Math.abs(tP - pP), 1)
              return <div className="kp-trail" style={{ top: `${mn}%`, height: `${h}%`, backgroundColor: accColor, opacity: isFever ? 0.5 : 0.3 }} />
            })()}

            {/* Bonus items */}
            {bonusItems.filter(i => !i.collected).map(item => {
              const age = elapsedDisplay - item.spawnedAt
              const op = age > BONUS_DURATION_MS * 0.7 ? 0.4 : 1
              const cls = `kp-bonus-item ${item.type === 'star' ? 'star' : item.type === 'heart' ? 'heart' : ''}`
              return (
                <div key={item.id} className={cls} style={{ top: `${(1 - item.position) * 100}%`, opacity: op }}>
                  {item.type === 'note' ? '♪' : item.type === 'star' ? '★' : '♥'}
                </div>
              )
            })}

            {/* Power-ups */}
            {powerUps.filter(p => !p.collected).map(pu => {
              const age = elapsedDisplay - pu.spawnedAt
              const op = age > POWERUP_DURATION_MS * 0.7 ? 0.4 : 1
              return (
                <div key={pu.id} className="kp-powerup-item" style={{
                  top: `${(1 - pu.position) * 100}%`,
                  opacity: op,
                  borderColor: POWERUP_COLORS[pu.type],
                  color: POWERUP_COLORS[pu.type],
                  background: POWERUP_COLORS[pu.type] + '20',
                }}>
                  {POWERUP_ICONS[pu.type]}
                </div>
              )
            })}

            {/* Glow ring */}
            {accDist <= ACCURACY_PERFECT_THRESHOLD && (
              <div className="kp-glow-ring" style={{ top: `${targetTop}%` }} />
            )}

            {/* Target */}
            <div className={`kp-target ${isFever ? 'fever' : ''}`} style={{
              top: `${targetTop}%`,
              borderColor: isFever ? PIXEL_YELLOW : accColor,
            }}>
              <div className="kp-target-inner" style={{ backgroundColor: isFever ? PIXEL_YELLOW : accColor }} />
            </div>

            {/* Player */}
            <div className="kp-player" style={{
              top: `${playerTop}%`,
              backgroundColor: accColor,
              boxShadow: `0 0 8px ${accColor}88`,
            }} />
          </div>
        </div>

        {/* Waveform */}
        <div className={`kp-wave ${isFever ? 'fever' : ''}`}>
          <PixelWaveform
            targetPosition={targetPosition}
            playerPosition={playerPosition}
            accColor={accColor}
            elapsedMs={elapsedDisplay}
            isFever={isFever}
            combo={combo}
            level={level}
          />
        </div>
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

    const pad = 8 * dpr
    const dW = W - pad * 2
    const dH = H - pad * 2

    // Pixel grid
    const gridStep = Math.floor(dH / 8)
    ctx.fillStyle = PIXEL_PURPLE + '12'
    for (let i = 0; i <= 8; i++) {
      const y = Math.floor(pad + i * gridStep)
      ctx.fillRect(pad, y, dW, 1 * dpr)
    }

    // Vertical grid
    const vStep = Math.floor(dW / 10)
    for (let i = 0; i <= 10; i++) {
      const x = Math.floor(pad + i * vStep)
      ctx.fillRect(x, pad, 1 * dpr, dH)
    }

    // Draw pixel-stepped lines
    const PIXEL_SIZE = Math.max(2, Math.floor(3 * dpr))

    // Target line - pixel stepped
    const targetColor = isFever ? PIXEL_YELLOW : PIXEL_PURPLE
    ctx.fillStyle = targetColor + '55'
    for (let i = 0; i < len - 1; i++) {
      const x = Math.floor(pad + (i / (MAX_HIST - 1)) * dW)
      const y = Math.floor(pad + (1 - hist[i].target) * dH)
      ctx.fillRect(x, y - PIXEL_SIZE / 2, PIXEL_SIZE, PIXEL_SIZE)
    }

    // Target line bright
    ctx.fillStyle = targetColor + '88'
    for (let i = Math.max(0, len - 80); i < len; i++) {
      const x = Math.floor(pad + (i / (MAX_HIST - 1)) * dW)
      const y = Math.floor(pad + (1 - hist[i].target) * dH)
      ctx.fillRect(x, y - PIXEL_SIZE / 2, PIXEL_SIZE, PIXEL_SIZE)
    }

    // Player line - pixel stepped
    ctx.fillStyle = PIXEL_WHITE + '44'
    for (let i = 0; i < len - 1; i++) {
      const x = Math.floor(pad + (i / (MAX_HIST - 1)) * dW)
      const y = Math.floor(pad + (1 - hist[i].player) * dH)
      ctx.fillRect(x, y - PIXEL_SIZE / 2, PIXEL_SIZE, PIXEL_SIZE)
    }

    // Player line bright (recent)
    for (let i = Math.max(0, len - 80); i < len; i++) {
      const alpha = ((i - (len - 80)) / 80)
      ctx.fillStyle = hist[i].color + Math.floor(alpha * 200 + 55).toString(16).padStart(2, '0')
      const x = Math.floor(pad + (i / (MAX_HIST - 1)) * dW)
      const y = Math.floor(pad + (1 - hist[i].player) * dH)
      ctx.fillRect(x, y - PIXEL_SIZE / 2, PIXEL_SIZE, PIXEL_SIZE)
    }

    // Current dots
    const last = hist[len - 1]
    const lx = Math.floor(pad + ((len - 1) / (MAX_HIST - 1)) * dW)
    const tY = Math.floor(pad + (1 - last.target) * dH)
    const pY = Math.floor(pad + (1 - last.player) * dH)

    // Target diamond
    const DS = Math.floor(6 * dpr)
    ctx.fillStyle = targetColor
    ctx.beginPath()
    ctx.moveTo(lx, tY - DS)
    ctx.lineTo(lx + DS, tY)
    ctx.lineTo(lx, tY + DS)
    ctx.lineTo(lx - DS, tY)
    ctx.closePath()
    ctx.fill()

    // Player square
    const PS = Math.floor(5 * dpr)
    ctx.fillStyle = last.color
    ctx.fillRect(lx - PS, pY - PS, PS * 2, PS * 2)
    ctx.strokeStyle = PIXEL_WHITE
    ctx.lineWidth = 1 * dpr
    ctx.strokeRect(lx - PS, pY - PS, PS * 2, PS * 2)

    // Distance line (dashed pixel)
    ctx.fillStyle = last.color + '66'
    const minY = Math.min(tY, pY)
    const maxY = Math.max(tY, pY)
    for (let y = minY; y < maxY; y += 4 * dpr) {
      ctx.fillRect(lx - dpr, y, 2 * dpr, 2 * dpr)
    }

    // Combo text
    if (combo >= 5) {
      ctx.fillStyle = PIXEL_CYAN
      ctx.font = `${Math.floor(12 * dpr)}px 'Press Start 2P', monospace`
      ctx.textAlign = 'center'
      ctx.fillText(`${combo}x`, W / 2, pad + Math.floor(16 * dpr))
    }

    // Level indicator
    ctx.fillStyle = PIXEL_PURPLE + '88'
    ctx.font = `${Math.floor(8 * dpr)}px 'Press Start 2P', monospace`
    ctx.textAlign = 'right'
    ctx.fillText(`Lv.${level + 1}`, W - pad, H - pad)

    // Accuracy meter at bottom
    const meterW = Math.floor(dW * 0.6)
    const meterH = Math.floor(4 * dpr)
    const meterX = Math.floor(W / 2 - meterW / 2)
    const meterY = H - pad - meterH - Math.floor(2 * dpr)
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(meterX, meterY, meterW, meterH)
    const accPercent = Math.max(0, 1 - (Math.abs(targetPosition - playerPosition) / 0.5))
    ctx.fillStyle = last.color
    ctx.fillRect(meterX, meterY, Math.floor(meterW * accPercent), meterH)

  }, [targetPosition, playerPosition, accColor, elapsedMs, isFever, combo, level])

  return <canvas ref={canvasRef} />
}

// ─── Module Export ───────────────────────────────────────────────────

export const karaokePitchModule: MiniGameModule = {
  manifest: {
    id: 'karaoke-pitch',
    title: 'Karaoke Pitch',
    description: 'Retro pitch tracking! Collect items & power-ups!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#d946ef',
  },
  Component: KaraokePitchGame,
}
