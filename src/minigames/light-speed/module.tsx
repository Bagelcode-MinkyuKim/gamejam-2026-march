import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// ─── Sounds ──────────────────────────────────────────────
import tapSfx from '../../../assets/sounds/light-speed-tap.mp3'
import perfectSfx from '../../../assets/sounds/light-speed-perfect.mp3'
import goldenSfx from '../../../assets/sounds/light-speed-golden.mp3'
import missSfx from '../../../assets/sounds/light-speed-miss.mp3'
import feverSfx from '../../../assets/sounds/light-speed-fever.mp3'
import levelUpSfx from '../../../assets/sounds/light-speed-level-up.mp3'
import comboBreakSfx from '../../../assets/sounds/light-speed-combo-break.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import shieldSfx from '../../../assets/sounds/light-speed-shield.mp3'
import bossHitSfx from '../../../assets/sounds/light-speed-boss-hit.mp3'
import magnetSfx from '../../../assets/sounds/light-speed-magnet.mp3'
import bonusZoneSfx from '../../../assets/sounds/light-speed-bonus-zone.mp3'
import chainZapSfx from '../../../assets/sounds/light-speed-chain-zap.mp3'

// ─── Constants ───────────────────────────────────────────
const ROUND_DURATION_MS = 90_000
const INITIAL_HP = 5
const MAX_HP = 5

const FAST_TAP_THRESHOLD_MS = 350
const FAST_TAP_SCORE = 3
const NORMAL_TAP_SCORE = 1

const INITIAL_SPAWN_INTERVAL_MS = 1500
const MIN_SPAWN_INTERVAL_MS = 300
const SPAWN_ACCELERATION = 0.93

const INITIAL_CIRCLE_LIFETIME_MS = 2200
const MIN_CIRCLE_LIFETIME_MS = 650
const LIFETIME_SHRINK_FACTOR = 0.965

const INITIAL_CIRCLE_SIZE = 56
const MIN_CIRCLE_SIZE = 28
const SIZE_SHRINK_FACTOR = 0.988

const MAX_ACTIVE_CIRCLES = 12
const COMBO_DECAY_MS = 2500
const ARENA_PADDING = 0.05

// Special circle intervals
const GOLDEN_SPAWN_INTERVAL = 7
const GOLDEN_SCORE_MULTIPLIER = 3
const GOLDEN_TIME_BONUS_MS = 2000
const BOMB_SPAWN_INTERVAL = 11
const HP_RECOVERY_SPAWN_INTERVAL = 17
const FREEZE_SPAWN_INTERVAL = 23
const FREEZE_DURATION_MS = 3000
const SHIELD_SPAWN_INTERVAL = 20
const MAGNET_SPAWN_INTERVAL = 28
const MAGNET_DURATION_MS = 4000
const BOSS_SPAWN_INTERVAL = 35
const BOSS_HP = 4
const BOSS_SCORE = 25

// Fever
const FEVER_COMBO_THRESHOLD = 15
const FEVER_DURATION_MS = 6000
const FEVER_SCORE_MULTIPLIER = 2

// Levels
const LEVEL_THRESHOLDS = [0, 50, 150, 300, 500, 800, 1200, 1800] as const
const LEVEL_NAMES = ['LV.1', 'LV.2', 'LV.3', 'LV.4', 'LV.5', 'LV.6', 'LV.7', 'LV.MAX'] as const

// Multi-tap / Chain
const MULTI_TAP_WINDOW_MS = 600
const MULTI_TAP_MIN = 3
const MULTI_TAP_BONUS_PER = 2
const CHAIN_TAP_COUNT = 5
const CHAIN_WINDOW_MS = 1200

// Rush time
const RUSH_TIME_THRESHOLD_MS = 15000
const RUSH_SPAWN_MULT = 0.5
const RUSH_SCORE_MULT = 1.5

// Bonus zone (center area)
const BONUS_ZONE_CENTER = 0.5
const BONUS_ZONE_RADIUS = 0.15
const BONUS_ZONE_MULT = 2

// ─── Types ───────────────────────────────────────────────
type CircleType = 'normal' | 'golden' | 'hp-recovery' | 'bomb' | 'freeze' | 'shield' | 'magnet' | 'boss'

interface LightCircle {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly size: number
  readonly lifetimeMs: number
  readonly spawnedAtMs: number
  readonly color: string
  readonly type: CircleType
  bossHp?: number
}

interface RippleEffect {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly color: string
}

// 8-bit pixel art palette
const PIXEL_COLORS = [
  '#f7e26b', '#eb6b6f', '#b550a1', '#7952a3',
  '#4d71b5', '#4dacbd', '#5ec97b', '#a3e048',
  '#f7a641', '#e45d3a', '#c23d69', '#5b69a5',
] as const

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
function pickColor(): string {
  return PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)]
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
function getLevel(score: number): number {
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= LEVEL_THRESHOLDS[i]) return i
  }
  return 0
}
function inBonusZone(x: number, y: number): boolean {
  const dx = x - BONUS_ZONE_CENTER
  const dy = y - BONUS_ZONE_CENTER
  return Math.sqrt(dx * dx + dy * dy) <= BONUS_ZONE_RADIUS
}

// ─── Component ───────────────────────────────────────────
function LightSpeedGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [hp, setHp] = useState(INITIAL_HP)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [circles, setCircles] = useState<LightCircle[]>([])
  const [pops, setPops] = useState<{ id: number; x: number; y: number; text: string; color: string }[]>([])
  const [ripples, setRipples] = useState<RippleEffect[]>([])
  const [isFever, setIsFever] = useState(false)
  const [feverRemMs, setFeverRemMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [bgHue, setBgHue] = useState(240)
  const [isFrozen, setIsFrozen] = useState(false)
  const [isRush, setIsRush] = useState(false)
  const [hasShield, setHasShield] = useState(false)
  const [isMagnet, setIsMagnet] = useState(false)
  const [chainFlash, setChainFlash] = useState(false)

  const fx = useGameEffects()
  const fxRef = useRef(fx)
  fxRef.current = fx

  const scoreRef = useRef(0)
  const hpRef = useRef(INITIAL_HP)
  const remMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const lastTapRef = useRef(0)
  const circlesRef = useRef<LightCircle[]>([])
  const nextIdRef = useRef(0)
  const nextPopRef = useRef(0)
  const nextRipRef = useRef(0)
  const spawnIntRef = useRef(INITIAL_SPAWN_INTERVAL_MS)
  const lifeRef = useRef(INITIAL_CIRCLE_LIFETIME_MS)
  const sizeRef = useRef(INITIAL_CIRCLE_SIZE)
  const spawnTimerRef = useRef(0)
  const totalSpRef = useRef(0)
  const levelRef = useRef(0)
  const feverRef = useRef(false)
  const feverEndRef = useRef(0)
  const multiRef = useRef<number[]>([])
  const chainRef = useRef<number[]>([])
  const frozenRef = useRef(0)
  const shieldRef = useRef(false)
  const magnetRef = useRef(0)
  const rushRef = useRef(false)

  const doneRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const prevRef = useRef<number | null>(null)
  const elRef = useRef(0)
  const arenaRef = useRef<HTMLDivElement | null>(null)
  const audioRef = useRef<Record<string, HTMLAudioElement | null>>({})

  const play = useCallback((k: string, vol: number, rate = 1) => {
    const a = audioRef.current[k]
    if (!a) return
    a.currentTime = 0
    a.volume = clamp(vol, 0, 1)
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const addPop = useCallback((x: number, y: number, text: string, color: string) => {
    const id = nextPopRef.current++
    setPops(p => [...p, { id, x, y, text, color }])
    window.setTimeout(() => setPops(p => p.filter(e => e.id !== id)), 700)
  }, [])

  const addRipple = useCallback((x: number, y: number, color: string) => {
    const id = nextRipRef.current++
    setRipples(r => [...r, { id, x, y, color }])
    window.setTimeout(() => setRipples(r => r.filter(e => e.id !== id)), 400)
  }, [])

  // ── Spawn ──────────────────────────────────────────────
  const spawn = useCallback((el: number) => {
    if (circlesRef.current.length >= MAX_ACTIVE_CIRCLES) return
    const size = sizeRef.current
    const hn = (size / 2) / 300
    const x = randomBetween(ARENA_PADDING + hn, 1 - ARENA_PADDING - hn)
    const y = randomBetween(ARENA_PADDING + hn, 1 - ARENA_PADDING - hn)
    const n = totalSpRef.current + 1

    let type: CircleType = 'normal'
    let color = pickColor()
    let sz = size

    if (n % BOSS_SPAWN_INTERVAL === 0) {
      type = 'boss'; color = '#c23d69'; sz = size * 2
    } else if (n % MAGNET_SPAWN_INTERVAL === 0) {
      type = 'magnet'; color = '#4dacbd'; sz = size * 1.15
    } else if (n % FREEZE_SPAWN_INTERVAL === 0) {
      type = 'freeze'; color = '#67e8f9'; sz = size * 1.15
    } else if (n % SHIELD_SPAWN_INTERVAL === 0) {
      type = 'shield'; color = '#5ec97b'; sz = size * 1.15
    } else if (n % GOLDEN_SPAWN_INTERVAL === 0) {
      type = 'golden'; color = '#f7e26b'; sz = size * 1.25
    } else if (n % BOMB_SPAWN_INTERVAL === 0) {
      type = 'bomb'; color = '#3a3a50'; sz = size * 1.1
    } else if (n % HP_RECOVERY_SPAWN_INTERVAL === 0) {
      type = 'hp-recovery'; color = '#5ec97b'; sz = size * 1.1
    }

    const c: LightCircle = {
      id: nextIdRef.current, x, y, size: sz,
      lifetimeMs: lifeRef.current, spawnedAtMs: el, color, type,
      bossHp: type === 'boss' ? BOSS_HP : undefined,
    }
    nextIdRef.current++
    totalSpRef.current++
    circlesRef.current = [...circlesRef.current, c]
    setCircles(circlesRef.current)
  }, [])

  // ── Fever ──────────────────────────────────────────────
  const startFever = useCallback(() => {
    feverRef.current = true
    feverEndRef.current = elRef.current + FEVER_DURATION_MS
    setIsFever(true)
    setFeverRemMs(FEVER_DURATION_MS)
    play('fever', 0.7)
    fxRef.current.triggerFlash('rgba(247,226,107,0.5)', 200)
    fxRef.current.triggerShake(8, 200)
    addPop(0.5, 0.3, '!! FEVER !!', '#f7e26b')
  }, [play, addPop])

  // ── Chain Lightning ────────────────────────────────────
  const chainLightning = useCallback(() => {
    setChainFlash(true)
    window.setTimeout(() => setChainFlash(false), 400)
    const aw = arenaRef.current?.clientWidth ?? 300
    const ah = arenaRef.current?.clientHeight ?? 500
    let bonus = 0
    const keep: LightCircle[] = []
    for (const c of circlesRef.current) {
      if (c.type === 'bomb' || c.type === 'boss') { keep.push(c); continue }
      bonus += 2 * (feverRef.current ? FEVER_SCORE_MULTIPLIER : 1)
      addRipple(c.x, c.y, '#4dacbd')
      fxRef.current.spawnParticles(2, c.x * aw, c.y * ah, undefined, 'circle')
    }
    if (bonus > 0) {
      scoreRef.current += bonus
      setScore(scoreRef.current)
      addPop(0.5, 0.4, `<< CHAIN ZAP >> +${bonus}`, '#4dacbd')
      fxRef.current.triggerFlash('rgba(77,172,189,0.5)', 200)
      fxRef.current.triggerShake(6, 150)
      play('chainzap', 0.7, 1.2)
    }
    circlesRef.current = keep
    setCircles(keep)
    chainRef.current = []
  }, [addPop, addRipple, play])

  // ── Finish ─────────────────────────────────────────────
  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    play('gameover', 0.7, 0.95)
    fxRef.current.cleanup()
    const dur = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remMsRef.current))
    onFinishRef.current({ score: scoreRef.current, durationMs: dur })
  }, [play])

  // ── Tap Handler ────────────────────────────────────────
  const handleTap = useCallback((cid: number) => {
    if (doneRef.current) return
    const idx = circlesRef.current.findIndex(c => c.id === cid)
    if (idx === -1) return
    const t = circlesRef.current[idx]
    const now = elRef.current
    const age = now - t.spawnedAtMs
    const fast = age <= FAST_TAP_THRESHOLD_MS
    const aw = arenaRef.current?.clientWidth ?? 300
    const ah = arenaRef.current?.clientHeight ?? 500
    const ex = t.x * aw, ey = t.y * ah

    addRipple(t.x, t.y, t.color)
    lastTapRef.current = now

    // Chain tracking
    if (t.type !== 'bomb') {
      chainRef.current.push(now)
      chainRef.current = chainRef.current.filter(ts => now - ts < CHAIN_WINDOW_MS)
      if (chainRef.current.length >= CHAIN_TAP_COUNT) { chainLightning(); return }
    }

    // ── Boss: multi-hit ──
    if (t.type === 'boss') {
      const bossHp = (t.bossHp ?? 1) - 1
      if (bossHp > 0) {
        circlesRef.current = circlesRef.current.map(c => c.id === cid ? { ...c, bossHp } : c)
        setCircles(circlesRef.current)
        addPop(t.x, t.y, `HIT! ${bossHp}`, '#c23d69')
        fxRef.current.triggerShake(4, 80)
        fxRef.current.spawnParticles(3, ex, ey, undefined, 'circle')
        play('bosshit', 0.6, 1 + (BOSS_HP - bossHp) * 0.1)
        return
      }
      // Boss defeated
      circlesRef.current = circlesRef.current.filter(c => c.id !== cid)
      setCircles(circlesRef.current)
      const bs = BOSS_SCORE * (feverRef.current ? FEVER_SCORE_MULTIPLIER : 1)
      scoreRef.current += bs
      setScore(scoreRef.current)
      comboRef.current += 3
      setCombo(comboRef.current)
      addPop(t.x, t.y, `BOSS DOWN! +${bs}`, '#c23d69')
      fxRef.current.comboHitBurst(ex, ey, comboRef.current, bs)
      fxRef.current.triggerShake(10, 200)
      play('bosshit', 0.8, 0.7)
      play('bonuszone', 0.6)
      return
    }

    // Remove circle (non-boss)
    circlesRef.current = circlesRef.current.filter(c => c.id !== cid)
    setCircles(circlesRef.current)

    // ── Bomb ──
    if (t.type === 'bomb') {
      if (shieldRef.current) {
        shieldRef.current = false
        setHasShield(false)
        addPop(t.x, t.y, 'SHIELD BLOCK!', '#5ec97b')
        fxRef.current.triggerFlash('rgba(94,201,123,0.4)', 100)
        play('shield', 0.6, 1.2)
        return
      }
      hpRef.current = Math.max(0, hpRef.current - 1)
      setHp(hpRef.current)
      comboRef.current = 0; setCombo(0)
      addPop(t.x, t.y, '!! BOMB !!', '#eb6b6f')
      fxRef.current.triggerShake(12, 200)
      fxRef.current.triggerFlash('rgba(235,107,111,0.5)', 150)
      play('miss', 0.6, 0.8)
      play('combobreak', 0.5)
      if (hpRef.current <= 0) { finish(); return }
      return
    }

    // ── Freeze ──
    if (t.type === 'freeze') {
      frozenRef.current = now + FREEZE_DURATION_MS
      setIsFrozen(true)
      addPop(t.x, t.y, '<< FREEZE >>', '#67e8f9')
      fxRef.current.triggerFlash('rgba(103,232,249,0.4)', 150)
      fxRef.current.spawnParticles(6, ex, ey, undefined, 'circle')
      play('shield', 0.6, 0.7)
      comboRef.current++; setCombo(comboRef.current)
      return
    }

    // ── Shield ──
    if (t.type === 'shield') {
      shieldRef.current = true
      setHasShield(true)
      addPop(t.x, t.y, '<< SHIELD >>', '#5ec97b')
      fxRef.current.triggerFlash('rgba(94,201,123,0.3)', 120)
      fxRef.current.spawnParticles(5, ex, ey, undefined, 'circle')
      play('shield', 0.7)
      comboRef.current++; setCombo(comboRef.current)
      return
    }

    // ── Magnet ──
    if (t.type === 'magnet') {
      magnetRef.current = now + MAGNET_DURATION_MS
      setIsMagnet(true)
      addPop(t.x, t.y, '<< MAGNET >>', '#4dacbd')
      fxRef.current.triggerFlash('rgba(77,172,189,0.3)', 120)
      fxRef.current.spawnParticles(5, ex, ey, undefined, 'circle')
      play('magnet', 0.7)
      comboRef.current++; setCombo(comboRef.current)
      return
    }

    // ── HP Recovery ──
    if (t.type === 'hp-recovery') {
      if (hpRef.current < MAX_HP) {
        hpRef.current = Math.min(MAX_HP, hpRef.current + 1)
        setHp(hpRef.current)
      }
      comboRef.current++; setCombo(comboRef.current)
      addPop(t.x, t.y, '+1 HP', '#5ec97b')
      fxRef.current.triggerFlash('rgba(94,201,123,0.3)', 80)
      fxRef.current.spawnParticles(4, ex, ey, undefined, 'circle')
      play('shield', 0.5, 1.2)
      return
    }

    // ── Normal / Golden ──
    const goldM = t.type === 'golden' ? GOLDEN_SCORE_MULTIPLIER : 1
    const feverM = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
    const rushM = remMsRef.current <= RUSH_TIME_THRESHOLD_MS ? RUSH_SCORE_MULT : 1
    const zoneM = inBonusZone(t.x, t.y) ? BONUS_ZONE_MULT : 1
    const base = fast ? FAST_TAP_SCORE : NORMAL_TAP_SCORE
    const cbonus = Math.floor(comboRef.current / 5)
    const total = Math.round((base + cbonus) * goldM * feverM * rushM * zoneM)

    scoreRef.current += total
    setScore(scoreRef.current)

    if (t.type === 'golden') {
      remMsRef.current = Math.min(ROUND_DURATION_MS, remMsRef.current + GOLDEN_TIME_BONUS_MS)
      setRemainingMs(remMsRef.current)
    }

    const nc = comboRef.current + 1
    comboRef.current = nc; setCombo(nc)

    // Multi-tap
    multiRef.current.push(now)
    multiRef.current = multiRef.current.filter(ts => now - ts < MULTI_TAP_WINDOW_MS)
    if (multiRef.current.length >= MULTI_TAP_MIN) {
      const mb = multiRef.current.length * MULTI_TAP_BONUS_PER
      scoreRef.current += mb; setScore(scoreRef.current)
      addPop(0.5, 0.15, `MULTI x${multiRef.current.length}! +${mb}`, '#4dacbd')
      fxRef.current.triggerFlash('rgba(77,172,189,0.3)', 60)
      multiRef.current = []
    }

    // Level
    const nl = getLevel(scoreRef.current)
    if (nl > levelRef.current) {
      levelRef.current = nl; setLevel(nl)
      play('levelup', 0.6)
      addPop(0.5, 0.2, `${LEVEL_NAMES[nl]}`, '#b550a1')
      fxRef.current.triggerFlash('rgba(181,80,161,0.4)', 150)
      fxRef.current.triggerShake(5, 120)
    }

    // Fever
    if (!feverRef.current && nc >= FEVER_COMBO_THRESHOLD && nc % FEVER_COMBO_THRESHOLD === 0) startFever()

    // Bonus zone indicator
    const inZone = inBonusZone(t.x, t.y)
    const txt = t.type === 'golden'
      ? `+${total} GOLD!${inZone ? ' ZONE!' : ''} +2s`
      : fast
        ? `+${total} FAST!${inZone ? ' ZONE!' : ''}`
        : inZone ? `+${total} ZONE!` : `+${total}`

    const pc = t.type === 'golden' ? '#f7e26b' : fast ? '#4dacbd' : inZone ? '#a3e048' : '#fff'
    addPop(t.x, t.y, txt, pc)

    if (t.type === 'golden') {
      fxRef.current.comboHitBurst(ex, ey, nc, total)
      play('golden', 0.7, 1.1)
    } else if (fast) {
      fxRef.current.comboHitBurst(ex, ey, nc, total)
      play('perfect', 0.6, 1 + Math.min(0.4, nc * 0.02))
    } else {
      fxRef.current.spawnParticles(3, ex, ey, undefined, 'circle')
      fxRef.current.showScorePopup(total, ex, ey)
      play('tap', 0.5, 1 + Math.min(0.3, nc * 0.015))
    }
    if (inZone && !t.type) play('bonuszone', 0.3, 1.5)
    if (nc > 0 && nc % 5 === 0) setBgHue(p => (p + 25) % 360)
  }, [addPop, addRipple, play, finish, startFever, chainLightning])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [onExit])

  // ── Audio preload ──────────────────────────────────────
  useEffect(() => {
    const src: Record<string, string> = {
      tap: tapSfx, perfect: perfectSfx, golden: goldenSfx, miss: missSfx,
      fever: feverSfx, levelup: levelUpSfx, combobreak: comboBreakSfx,
      gameover: gameOverHitSfx, shield: shieldSfx, bosshit: bossHitSfx,
      magnet: magnetSfx, bonuszone: bonusZoneSfx, chainzap: chainZapSfx,
    }
    for (const [k, s] of Object.entries(src)) {
      const a = new Audio(s); a.preload = 'auto'; audioRef.current[k] = a
    }
    return () => {
      fxRef.current.cleanup()
      for (const a of Object.values(audioRef.current)) { if (a) { a.pause(); a.src = '' } }
      audioRef.current = {}
    }
  }, [])

  // ── Game Loop ──────────────────────────────────────────
  useEffect(() => {
    const step = (now: number) => {
      if (doneRef.current) { rafRef.current = null; return }
      if (prevRef.current === null) prevRef.current = now
      const dt = Math.min(now - prevRef.current, MAX_FRAME_DELTA_MS)
      prevRef.current = now
      elRef.current += dt

      remMsRef.current = Math.max(0, remMsRef.current - dt)
      setRemainingMs(remMsRef.current)
      fxRef.current.updateParticles()

      // Fever
      if (feverRef.current) {
        const r = feverEndRef.current - elRef.current
        if (r <= 0) { feverRef.current = false; setIsFever(false); setFeverRemMs(0) }
        else setFeverRemMs(r)
      }

      // Freeze expiry
      if (frozenRef.current > 0 && elRef.current >= frozenRef.current) { frozenRef.current = 0; setIsFrozen(false) }

      // Magnet expiry
      if (magnetRef.current > 0 && elRef.current >= magnetRef.current) { magnetRef.current = 0; setIsMagnet(false) }

      // Magnet auto-collect (nearest non-bomb/boss circle)
      if (magnetRef.current > elRef.current && circlesRef.current.length > 0) {
        const collectible = circlesRef.current.find(c => c.type === 'normal' || c.type === 'golden')
        if (collectible) {
          // Auto-tap the nearest collectible
          handleTap(collectible.id)
        }
      }

      // Rush
      if (!rushRef.current && remMsRef.current <= RUSH_TIME_THRESHOLD_MS) {
        rushRef.current = true; setIsRush(true)
        addPop(0.5, 0.35, '!! RUSH TIME !! x1.5', '#eb6b6f')
        fxRef.current.triggerFlash('rgba(235,107,111,0.4)', 200)
        fxRef.current.triggerShake(6, 150)
        play('fever', 0.5, 1.3)
      }

      // Combo decay
      if (elRef.current - lastTapRef.current > COMBO_DECAY_MS && comboRef.current > 0) {
        if (comboRef.current >= 5) play('combobreak', 0.3)
        comboRef.current = 0; setCombo(0)
      }

      // Spawn
      const frozen = frozenRef.current > elRef.current
      spawnTimerRef.current += dt
      const rMult = remMsRef.current <= RUSH_TIME_THRESHOLD_MS ? RUSH_SPAWN_MULT : 1
      if (spawnTimerRef.current >= spawnIntRef.current * rMult) {
        spawnTimerRef.current = 0
        spawn(elRef.current)
        spawnIntRef.current = Math.max(MIN_SPAWN_INTERVAL_MS, spawnIntRef.current * SPAWN_ACCELERATION)
        lifeRef.current = Math.max(MIN_CIRCLE_LIFETIME_MS, lifeRef.current * LIFETIME_SHRINK_FACTOR)
        sizeRef.current = Math.max(MIN_CIRCLE_SIZE, sizeRef.current * SIZE_SHRINK_FACTOR)
      }

      // Expired
      let hpLost = false
      const el = elRef.current
      const alive = circlesRef.current.filter(c => {
        const age = el - c.spawnedAtMs
        const life = frozen ? c.lifetimeMs + FREEZE_DURATION_MS : c.lifetimeMs
        if (age >= life) {
          if (c.type !== 'bomb') {
            if (shieldRef.current) {
              shieldRef.current = false; setHasShield(false)
              addPop(c.x, c.y, 'SHIELD!', '#5ec97b')
            } else {
              hpRef.current = Math.max(0, hpRef.current - 1); hpLost = true
            }
          }
          return false
        }
        return true
      })
      if (alive.length !== circlesRef.current.length) {
        circlesRef.current = alive; setCircles(alive)
      }
      if (hpLost) {
        setHp(hpRef.current)
        play('miss', 0.5, 1.1)
        fxRef.current.triggerShake(7); fxRef.current.triggerFlash('rgba(235,107,111,0.4)')
        if (hpRef.current <= 0) { finish(); rafRef.current = null; return }
      }
      if (remMsRef.current <= 0) { finish(); rafRef.current = null; return }
      rafRef.current = window.requestAnimationFrame(step)
    }
    rafRef.current = window.requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }; prevRef.current = null }
  }, [finish, play, spawn, addPop, handleTap])

  // ── Render ─────────────────────────────────────────────
  const bestDisp = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const lowTime = remainingMs <= 10000
  const lowHp = hp <= 1
  const cLabel = getComboLabel(combo)
  const cColor = getComboColor(combo)
  const fProg = isFever ? clamp(feverRemMs / FEVER_DURATION_MS, 0, 1) : 0

  return (
    <section className="mini-game-panel ls-panel" aria-label="light-speed-game"
      style={{ maxWidth: 432, width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', ...fx.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}
        @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

        .ls-panel {
          user-select: none; -webkit-user-select: none;
          background: #0a0a18;
          font-family: 'Press Start 2P', monospace;
          image-rendering: pixelated;
        }

        /* ── Scanline overlay ── */
        .ls-panel::after {
          content: '';
          position: absolute; inset: 0;
          background: repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0px, rgba(0,0,0,0.08) 1px, transparent 1px, transparent 3px);
          pointer-events: none; z-index: 50;
        }

        .ls-hud { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px 4px; flex-shrink: 0; z-index: 5; border-bottom: 2px solid #1a1a30; }
        .ls-hud-row { display: flex; justify-content: space-between; align-items: center; }
        .ls-score { font-size: clamp(16px, 5vw, 22px); color: #f7e26b; margin: 0; text-shadow: 2px 2px 0 #4d3800; }
        .ls-score.fever { animation: ls-fever-pulse 0.3s steps(2) infinite alternate; color: #eb6b6f; }
        .ls-score.rush { color: #eb6b6f; animation: ls-blink 0.4s steps(2) infinite; }
        .ls-best { font-size: 7px; color: #5b69a5; margin: 0; }
        .ls-hp { margin: 0; font-size: clamp(10px, 3vw, 14px); letter-spacing: 2px; }
        .ls-hp.low { animation: ls-blink 0.4s steps(2) infinite; }
        .ls-hp-full { color: #eb6b6f; }
        .ls-hp-empty { color: #2a2a3a; }
        .ls-time { font-size: clamp(9px, 2.5vw, 12px); color: #7952a3; margin: 0; font-variant-numeric: tabular-nums; }
        .ls-time.low { color: #eb6b6f; animation: ls-blink 0.4s steps(2) infinite; }
        .ls-combo-row { display: flex; align-items: center; gap: 6px; }
        .ls-combo { font-size: 8px; color: #b550a1; margin: 0; }
        .ls-combo strong { font-size: 12px; color: #f7e26b; }
        .ls-badges { display: flex; gap: 3px; align-items: center; flex-wrap: wrap; }
        .ls-badge { font-size: 7px; padding: 1px 4px; border: 1px solid; }
        .ls-badge-lv { color: #7952a3; border-color: #7952a3; }
        .ls-badge-rush { color: #eb6b6f; border-color: #eb6b6f; animation: ls-blink 0.4s steps(2) infinite; }
        .ls-badge-freeze { color: #67e8f9; border-color: #67e8f9; }
        .ls-badge-shield { color: #5ec97b; border-color: #5ec97b; }
        .ls-badge-magnet { color: #4dacbd; border-color: #4dacbd; }
        .ls-fever-bar { height: 4px; background: #1a1a30; flex-shrink: 0; }
        .ls-fever-fill { height: 100%; background: #f7e26b; transition: width 0.1s steps(4); }

        .ls-arena { position: relative; flex: 1; width: 100%; overflow: hidden; touch-action: manipulation; }
        .ls-arena-bg { position: absolute; inset: 0; pointer-events: none; transition: background 0.5s steps(4); }
        .ls-arena.fever .ls-arena-bg { animation: ls-fever-bg 0.5s steps(2) infinite alternate; }
        .ls-arena.rush { border: 2px solid #eb6b6f; animation: ls-rush-border 0.6s steps(2) infinite alternate; }
        .ls-arena.chain-flash { animation: ls-chain-flash 0.3s steps(3); }

        /* Bonus zone indicator */
        .ls-bonus-zone {
          position: absolute;
          left: 50%; top: 50%;
          width: ${BONUS_ZONE_RADIUS * 200}%;
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border: 1px dashed rgba(163,224,72,0.25);
          pointer-events: none; z-index: 0;
        }
        .ls-bonus-zone-label {
          position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%);
          font-size: 6px; color: rgba(163,224,72,0.35); white-space: nowrap;
        }

        /* Pixel blocks instead of circles */
        .ls-block {
          position: absolute; border: none; cursor: pointer; padding: 0;
          display: flex; align-items: center; justify-content: center;
          z-index: 2; border-radius: 3px; background: transparent;
          transition: transform 0.03s steps(1);
          image-rendering: pixelated;
        }
        .ls-block:active { transform: translate(-50%, -50%) scale(0.85) !important; }

        .ls-block-inner {
          position: absolute; inset: 3px; border-radius: 2px;
          image-rendering: pixelated;
        }
        .ls-block-ring {
          position: absolute; inset: 0; border: 2px solid; border-radius: 3px;
          box-sizing: border-box; pointer-events: none;
          image-rendering: pixelated;
        }
        .ls-block-label {
          position: absolute; font-size: 8px; pointer-events: none; z-index: 3;
          color: #fff; text-shadow: 1px 1px 0 #000;
        }
        .ls-block.boss .ls-block-label { font-size: 10px; }

        .ls-pop {
          position: absolute; transform: translate(-50%, -50%);
          font-size: clamp(10px, 3vw, 14px);
          pointer-events: none; z-index: 10;
          animation: ls-pop-up 0.7s steps(8) forwards;
          text-shadow: 2px 2px 0 #000;
        }

        .ls-ripple {
          position: absolute; pointer-events: none; z-index: 1;
          border-radius: 2px;
          animation: ls-ripple-expand 0.4s steps(6) forwards;
        }

        .ls-bg-pixel {
          position: absolute; pointer-events: none; opacity: 0.12;
          width: 3px; height: 3px; border-radius: 0;
          animation: ls-float-pixel linear infinite;
        }

        .ls-grid-dot {
          position: absolute; width: 1px; height: 1px;
          background: rgba(90, 90, 130, 0.2); pointer-events: none;
        }

        @keyframes ls-pop-up {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1.5); }
          100% { opacity: 0; transform: translate(-50%, -130%) scale(0.8); }
        }
        @keyframes ls-ripple-expand {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.9; }
          100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0; }
        }
        @keyframes ls-float-pixel {
          0% { transform: translateY(0); opacity: 0.12; }
          50% { opacity: 0.2; }
          100% { transform: translateY(-100vh); opacity: 0; }
        }
        @keyframes ls-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.2; } }
        @keyframes ls-fever-pulse { 0% { transform: scale(1); } 100% { transform: scale(1.04); } }
        @keyframes ls-fever-bg { 0% { background: rgba(247,226,107,0.04); } 100% { background: rgba(235,107,111,0.06); } }
        @keyframes ls-rush-border { 0% { border-color: rgba(235,107,111,0.2); } 100% { border-color: rgba(235,107,111,0.7); } }
        @keyframes ls-chain-flash { 0% { background: rgba(77,172,189,0.3); } 100% { background: transparent; } }
        @keyframes ls-bomb-pulse { 0%,100% { box-shadow: 0 0 6px rgba(235,107,111,0.3); } 50% { box-shadow: 0 0 14px rgba(235,107,111,0.7); } }
        @keyframes ls-gold-sparkle { 0%,100% { box-shadow: 0 0 6px rgba(247,226,107,0.4); } 50% { box-shadow: 0 0 16px rgba(247,226,107,0.9); } }
        @keyframes ls-boss-throb { 0%,100% { transform: translate(-50%,-50%) scale(1); } 50% { transform: translate(-50%,-50%) scale(1.06); } }
        @keyframes ls-special-glow { 0%,100% { box-shadow: 0 0 4px currentColor; } 50% { box-shadow: 0 0 12px currentColor; } }
      `}</style>

      <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
      <ParticleRenderer particles={fx.particles} />
      <ScorePopupRenderer popups={fx.scorePopups} />

      {/* HUD */}
      <div className="ls-hud">
        <div className="ls-hud-row">
          <p className={`ls-score ${isFever ? 'fever' : isRush ? 'rush' : ''}`}>{score.toLocaleString()}</p>
          <p className="ls-best">HI {bestDisp.toLocaleString()}</p>
        </div>
        <div className="ls-hud-row">
          <p className={`ls-hp ${lowHp ? 'low' : ''}`}>
            {Array.from({ length: MAX_HP }).map((_, i) => (
              <span key={i} className={i < hp ? 'ls-hp-full' : 'ls-hp-empty'}>{i < hp ? '\u2588' : '\u2591'}</span>
            ))}
          </p>
          <p className={`ls-time ${lowTime ? 'low' : ''}`}>{(remainingMs / 1000).toFixed(1)}</p>
        </div>
        <div className="ls-hud-row">
          <div className="ls-combo-row">
            <p className="ls-combo">x<strong>{combo}</strong></p>
            {cLabel && <p className="ge-combo-label" style={{ fontSize: 9, color: cColor, margin: 0 }}>{cLabel}</p>}
          </div>
          <div className="ls-badges">
            <span className="ls-badge ls-badge-lv">{LEVEL_NAMES[level]}</span>
            {isRush && <span className="ls-badge ls-badge-rush">RUSH</span>}
            {isFrozen && <span className="ls-badge ls-badge-freeze">ICE</span>}
            {hasShield && <span className="ls-badge ls-badge-shield">SHD</span>}
            {isMagnet && <span className="ls-badge ls-badge-magnet">MAG</span>}
          </div>
        </div>
        {isFever && <div className="ls-fever-bar"><div className="ls-fever-fill" style={{ width: `${fProg * 100}%` }} /></div>}
      </div>

      {/* Arena */}
      <div ref={arenaRef} className={`ls-arena ${isFever ? 'fever' : ''} ${isRush ? 'rush' : ''} ${chainFlash ? 'chain-flash' : ''}`}>
        <div className="ls-arena-bg"
          style={{ background: isFever ? undefined : `radial-gradient(ellipse at 50% 40%, hsla(${bgHue},40%,8%,1) 0%, #06060e 100%)` }} />

        {/* Pixel grid dots */}
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={`gd-${i}`} className="ls-grid-dot"
            style={{ left: `${(i % 5) * 25 + 12.5}%`, top: `${Math.floor(i / 5) * 25 + 12.5}%` }} />
        ))}

        {/* Bonus zone */}
        <div className="ls-bonus-zone">
          <span className="ls-bonus-zone-label">x2 ZONE</span>
        </div>

        {/* Floating pixels */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={`bp-${i}`} className="ls-bg-pixel"
            style={{ left: `${8 + (i * 9) % 84}%`, bottom: `-${3 + (i * 5) % 8}%`,
              background: PIXEL_COLORS[i % PIXEL_COLORS.length],
              animationDuration: `${3 + (i % 5) * 1.2}s`, animationDelay: `${(i * 0.5) % 2.5}s` }} />
        ))}

        {/* Ripples */}
        {ripples.map(r => (
          <div key={r.id} className="ls-ripple"
            style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: 40, height: 40, border: `2px solid ${r.color}` }} />
        ))}

        {/* Blocks */}
        {circles.map(c => {
          const age = elRef.current - c.spawnedAtMs
          const frozen = frozenRef.current > elRef.current
          const life = frozen ? c.lifetimeMs + FREEZE_DURATION_MS : c.lifetimeMs
          const prog = clamp(age / life, 0, 1)
          const ringScale = 1 - prog
          const pulse = 1 + Math.sin((age / 200) % (Math.PI * 2)) * 0.06
          const op = 0.4 + (1 - prog) * 0.6

          const isBoss = c.type === 'boss'
          const isGold = c.type === 'golden'
          const isBomb = c.type === 'bomb'

          let anim: string | undefined
          if (isBomb) anim = 'ls-bomb-pulse 0.5s steps(3) infinite'
          else if (isGold) anim = 'ls-gold-sparkle 0.7s steps(3) infinite'
          else if (isBoss) anim = 'ls-boss-throb 0.8s steps(4) infinite'
          else if (c.type === 'shield' || c.type === 'freeze' || c.type === 'magnet') anim = 'ls-special-glow 1s steps(4) infinite'

          const label = isBoss ? `${c.bossHp ?? 0}`
            : isGold ? 'x3' : isBomb ? 'X'
            : c.type === 'hp-recovery' ? '+HP' : c.type === 'freeze' ? 'ICE'
            : c.type === 'shield' ? 'SHD' : c.type === 'magnet' ? 'MAG' : ''

          return (
            <button key={c.id} className={`ls-block ${c.type}`} type="button"
              onClick={() => handleTap(c.id)}
              style={{
                left: `${c.x * 100}%`, top: `${c.y * 100}%`,
                width: c.size, height: c.size,
                transform: isBoss ? `translate(-50%,-50%)` : `translate(-50%,-50%) scale(${pulse})`,
                opacity: frozen ? Math.max(op, 0.75) : op,
                animation: anim, color: c.color,
              }}>
              <span className="ls-block-ring" style={{ transform: `scale(${ringScale})`, borderColor: isBomb ? '#eb6b6f' : c.color, borderWidth: (isGold || isBomb || isBoss) ? 3 : 2 }} />
              <span className="ls-block-inner" style={{ background: isBomb ? '#eb6b6f20' : `${c.color}30` }} />
              {label && <span className="ls-block-label">{label}</span>}
            </button>
          )
        })}

        {/* Pops */}
        {pops.map(p => (
          <span key={p.id} className="ls-pop" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, color: p.color }}>{p.text}</span>
        ))}
      </div>
    </section>
  )
}

export const lightSpeedModule: MiniGameModule = {
  manifest: {
    id: 'light-speed',
    title: 'Light Speed',
    description: 'Tap pixel blocks at lightning speed! Dodge bombs, smash bosses!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.1,
    accentColor: '#f7e26b',
  },
  Component: LightSpeedGame,
}
