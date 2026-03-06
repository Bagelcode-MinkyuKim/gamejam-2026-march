import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// ─── Sound imports (12 SFX) ──────────────────────
import hitSfx from '../../../assets/sounds/ball-bounce-hit.mp3'
import perfectSfx from '../../../assets/sounds/ball-bounce-perfect.mp3'
import feverSfx from '../../../assets/sounds/ball-bounce-fever.mp3'
import wallSfx from '../../../assets/sounds/ball-bounce-wall.mp3'
import powerupSfx from '../../../assets/sounds/ball-bounce-powerup.mp3'
import fallSfx from '../../../assets/sounds/ball-bounce-fall.mp3'
import comboSfx from '../../../assets/sounds/ball-bounce-combo.mp3'
import comboBreakSfx from '../../../assets/sounds/ball-bounce-combo-break.mp3'
import coinSfx from '../../../assets/sounds/ball-bounce-coin.mp3'
import windSfx from '../../../assets/sounds/ball-bounce-wind.mp3'
import levelupSfx from '../../../assets/sounds/ball-bounce-levelup.mp3'
import dashSfx from '../../../assets/sounds/ball-bounce-dash.mp3'

// ─── Pixel palette (NES-inspired) ────────────────
const PX = {
  bg: '#2c2137',
  bgLight: '#3b2d4a',
  floor: '#e04040',
  floorDark: '#b02828',
  ball: '#f05858',
  ballHi: '#ff9090',
  ballDk: '#c03030',
  platform: '#50b8e8',
  platformDk: '#3890c0',
  star: '#f8d830',
  starDk: '#c8a820',
  shield: '#5090f0',
  danger: '#ff3030',
  text: '#f0e8d8',
  textDim: '#a098a8',
  accent: '#f8d830',
  green: '#58c858',
  purple: '#a058f0',
  orange: '#f0a030',
  pink: '#f068a8',
  white: '#f8f8f8',
  black: '#181020',
} as const

// ─── Constants ───────────────────────────────────
const BASE_GRAVITY = 0.0011
const GRAVITY_INC = 0.000012
const MAX_GRAVITY = 0.0026
const BOUNCE_VY = -0.56
const STRONG_BOUNCE_VY = -0.72
const FEVER_COMBO = 10
const FEVER_MULT = 3
const WALL_DAMP = 0.8
const H_FORCE = 0.28
const BALL_R = 18
const TAP_RADIUS = 60
const PERFECT_RADIUS = 24
const COMBO_DECAY_MS = 2200
const HT_SCORE_DIV = 65
const PX_BORDER = 3

// PowerUps
const PU_TYPES = ['shield', 'magnet', 'double', 'slow', 'giant'] as const
type PUType = typeof PU_TYPES[number]
const PU_ICONS: Record<PUType, string> = {
  shield: 'SH', magnet: 'MG', double: 'x2', slow: 'SL', giant: 'BG',
}
const PU_COLORS: Record<PUType, string> = {
  shield: PX.shield, magnet: PX.purple, double: PX.orange, slow: PX.green, giant: PX.pink,
}
const PU_DUR_MS = 5000
const PU_SPAWN_MS = 7000
const PU_SIZE = 22

// Obstacles
const OB_SPAWN_MS = 10000
const OB_SPEED = 0.09

// Stars (coins)
const STAR_SPAWN_MS = 3500
const STAR_SIZE = 14
const STAR_PTS = 5

// Platforms
const PLAT_CHANCE = 0.2
const PLAT_W = 48
const PLAT_H = 6
const PLAT_DUR_MS = 5000

// Wind event
const WIND_INTERVAL_MS = 15000
const WIND_DURATION_MS = 3000
const WIND_FORCE = 0.06

// Score zones (horizontal bands that give bonus)
const SCORE_ZONE_COUNT = 3

// Trail & misc
const MAX_TRAIL = 10
const DASH_COOLDOWN_MS = 800
const DASH_VY = -0.5

// ─── Types ───────────────────────────────────────
interface Plat { x: number; y: number; ms: number }
interface PU { x: number; y: number; type: PUType; ms: number }
interface Ob { x: number; y: number; w: number; h: number; vx: number }
interface Star { x: number; y: number; ok: boolean; frame: number }
interface Trail { x: number; y: number; age: number }
interface ScoreZone { y: number; h: number; mult: number; color: string }

// ─── Helpers ─────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const COMBO_COLS = [PX.ball, PX.orange, PX.accent, PX.green, PX.platform, PX.purple, PX.pink]
const comboCol = (c: number) => c <= 0 ? COMBO_COLS[0] : COMBO_COLS[c % COMBO_COLS.length]

// Pixel box-shadow helper: creates stepped pixel border
const pxBorder = (color: string, size = PX_BORDER) =>
  `${size}px 0 0 0 ${color}, -${size}px 0 0 0 ${color}, 0 ${size}px 0 0 ${color}, 0 -${size}px 0 0 ${color}`

// ─── Component ───────────────────────────────────
function BallBounceMiniGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const fx = useGameEffects({ maxParticles: 50 })
  const arenaRef = useRef<HTMLDivElement | null>(null)

  // Arena measured size
  const [arenaH, setArenaH] = useState(568)
  const awRef = useRef(320)
  const ahRef = useRef(568)

  // Game state
  const [ballX, setBallX] = useState(160)
  const [ballY, setBallY] = useState(300)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [maxHt, setMaxHt] = useState(0)
  const [bounces, setBounces] = useState(0)
  const [over, setOver] = useState(false)
  const [fever, setFever] = useState(false)
  const [plats, setPlats] = useState<Plat[]>([])
  const [pus, setPus] = useState<PU[]>([])
  const [obs, setObs] = useState<Ob[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [trail, setTrail] = useState<Trail[]>([])
  const [activePU, setActivePU] = useState<PUType | null>(null)
  const [puTimer, setPuTimer] = useState(0)
  const [scale, setScale] = useState(1)
  const [shield, setShield] = useState(false)
  const [cLabel, setCLabel] = useState('')
  const [danger, setDanger] = useState(false)
  const [milestone, setMilestone] = useState('')
  const [wind, setWind] = useState(0) // -1 left, 0 none, 1 right
  const [zones, setZones] = useState<ScoreZone[]>([])
  const [level, setLevel] = useState(1)
  const [dashReady, setDashReady] = useState(true)

  // Refs
  const bxR = useRef(160)
  const byR = useRef(300)
  const vxR = useRef(0)
  const vyR = useRef(-0.3)
  const scoreR = useRef(0)
  const comboR = useRef(0)
  const maxHtR = useRef(0)
  const bounceR = useRef(0)
  const lastBounceR = useRef(0)
  const doneR = useRef(false)
  const gravR = useRef(BASE_GRAVITY)
  const platsR = useRef<Plat[]>([])
  const pusR = useRef<PU[]>([])
  const obsR = useRef<Ob[]>([])
  const starsR = useRef<Star[]>([])
  const trailR = useRef<Trail[]>([])
  const apuR = useRef<PUType | null>(null)
  const puTimerR = useRef(0)
  const scaleR = useRef(1)
  const shieldR = useRef(false)
  const windR = useRef(0)
  const windTimerR = useRef(0)
  const zonesR = useRef<ScoreZone[]>([])
  const levelR = useRef(1)
  const dashReadyR = useRef(true)
  const dashCdR = useRef(0)
  const lastPuSpawnR = useRef(0)
  const lastObSpawnR = useRef(0)
  const lastStarSpawnR = useRef(0)
  const lastWindR = useRef(0)
  const lastMsRef = useRef(0)
  const msTimerRef = useRef<number | null>(null)
  const rafR = useRef<number | null>(null)
  const lastFrameR = useRef<number | null>(null)
  const elapsedR = useRef(0)
  const feverR = useRef(false)
  const trailCntR = useRef(0)
  const measuredR = useRef(false)
  const starFrameR = useRef(0)

  // Audio
  const audR = useRef<Record<string, HTMLAudioElement | null>>({})
  const sfx = useCallback((k: string, vol: number, rate = 1) => {
    const a = audR.current[k]
    if (!a) return
    a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  // ─── Init audio ────────────────────────────────
  useEffect(() => {
    const srcs: Record<string, string> = {
      hit: hitSfx, perfect: perfectSfx, fever: feverSfx, wall: wallSfx,
      powerup: powerupSfx, fall: fallSfx, combo: comboSfx, comboBreak: comboBreakSfx,
      coin: coinSfx, wind: windSfx, levelup: levelupSfx, dash: dashSfx,
    }
    for (const [k, s] of Object.entries(srcs)) {
      const a = new Audio(s); a.preload = 'auto'; audR.current[k] = a
    }
    return () => {
      for (const a of Object.values(audR.current)) { if (a) { a.pause(); a.currentTime = 0 } }
      fx.cleanup()
    }
  }, [])

  // ─── Init score zones ──────────────────────────
  useEffect(() => {
    const genZones = () => {
      const ah = ahRef.current
      const z: ScoreZone[] = []
      const cols = [PX.accent, PX.green, PX.purple]
      for (let i = 0; i < SCORE_ZONE_COUNT; i++) {
        z.push({
          y: ah * 0.15 + (ah * 0.2) * i + Math.random() * ah * 0.1,
          h: 30 + Math.random() * 20,
          mult: 2 + Math.floor(Math.random() * 3),
          color: cols[i % cols.length],
        })
      }
      zonesR.current = z
      setZones(z)
    }
    genZones()
  }, [])

  // ─── Measure arena ────────────────────────────
  useEffect(() => {
    const measure = () => {
      const el = arenaRef.current
      if (!el) return
      const w = el.clientWidth, h = el.clientHeight
      if (w > 0 && h > 0) {
        awRef.current = w; ahRef.current = h; setArenaH(h)
        if (!measuredR.current) {
          measuredR.current = true
          bxR.current = w / 2; byR.current = h * 0.55
          setBallX(w / 2); setBallY(h * 0.55)
        }
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // ─── Finish ────────────────────────────────────
  const finish = useCallback(() => {
    if (doneR.current) return
    doneR.current = true; setOver(true)
    sfx('fall', 0.7, 0.85)
    fx.triggerShake(14, 400)
    fx.triggerFlash('rgba(255,48,48,0.5)', 250)
    const ms = Math.max(Math.round(DEFAULT_FRAME_MS), Math.round(elapsedR.current))
    onFinish({ score: scoreR.current, durationMs: ms })
  }, [onFinish, sfx, fx])

  // ─── PowerUp apply/clear ───────────────────────
  const applyPU = useCallback((t: PUType) => {
    apuR.current = t; puTimerR.current = PU_DUR_MS
    setActivePU(t); setPuTimer(PU_DUR_MS)
    sfx('powerup', 0.5); fx.triggerFlash(`${PU_COLORS[t]}66`, 120)
    if (t === 'shield') { shieldR.current = true; setShield(true) }
    if (t === 'giant') { scaleR.current = 1.7; setScale(1.7) }
    if (t === 'slow') gravR.current = BASE_GRAVITY * 0.4
  }, [sfx, fx])

  const clearPU = useCallback(() => {
    const p = apuR.current
    apuR.current = null; puTimerR.current = 0
    setActivePU(null); setPuTimer(0)
    if (p === 'giant') { scaleR.current = 1; setScale(1) }
    if (p === 'slow') gravR.current = Math.min(MAX_GRAVITY, BASE_GRAVITY + bounceR.current * GRAVITY_INC)
    if (p === 'shield') { shieldR.current = false; setShield(false) }
  }, [])

  // ─── Handle tap ────────────────────────────────
  const handleTap = useCallback((cx: number, cy: number) => {
    if (doneR.current) return
    const el = arenaRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const sx = awRef.current / r.width, sy = ahRef.current / r.height
    const tx = (cx - r.left) * sx, ty = (cy - r.top) * sy

    const dx = tx - bxR.current, dy = ty - byR.current
    const dist = Math.hypot(dx, dy)
    const effR = TAP_RADIUS * scaleR.current
    if (dist > effR) return

    const now = performance.now()
    const perfect = dist <= PERFECT_RADIUS * scaleR.current
    const kept = (now - lastBounceR.current) <= COMBO_DECAY_MS
    const prevCombo = comboR.current
    const nc = kept ? comboR.current + 1 : 1

    // Combo break penalty
    if (!kept && prevCombo >= 3) {
      sfx('comboBreak', 0.4)
      fx.spawnParticles(3, tx, ty, ['X', '!'], 'circle')
    }

    comboR.current = nc; setCombo(nc); lastBounceR.current = now
    const nb = bounceR.current + 1; bounceR.current = nb; setBounces(nb)

    if (apuR.current !== 'slow') gravR.current = Math.min(MAX_GRAVITY, BASE_GRAVITY + nb * GRAVITY_INC)

    // Fever
    const fNow = nc >= FEVER_COMBO
    if (fNow && !feverR.current) { sfx('fever', 0.55); fx.triggerFlash(`${PX.accent}66`, 150) }
    feverR.current = fNow; setFever(fNow)

    // Level up every 15 bounces
    const newLv = 1 + Math.floor(nb / 15)
    if (newLv > levelR.current) {
      levelR.current = newLv; setLevel(newLv)
      sfx('levelup', 0.5)
      fx.triggerFlash(`${PX.green}55`, 200)
      fx.spawnParticles(8, awRef.current / 2, ahRef.current * 0.3, ['LV', 'UP', '!'])
      setMilestone(`LEVEL ${newLv}`)
      if (msTimerRef.current) clearTimeout(msTimerRef.current)
      msTimerRef.current = window.setTimeout(() => setMilestone(''), 1500)
    }

    // Score calculation
    const htRatio = 1 - (byR.current / ahRef.current)
    const htBonus = Math.floor(htRatio * 12)
    const cBonus = Math.floor(nc / 3)
    const pBonus = perfect ? 6 : 0
    let pts = 1 + htBonus + cBonus + pBonus

    // Score zone multiplier
    for (const z of zonesR.current) {
      if (byR.current >= z.y && byR.current <= z.y + z.h) {
        pts *= z.mult
        fx.showScorePopup(z.mult, bxR.current, byR.current - 20, z.color)
        break
      }
    }

    if (fNow) pts *= FEVER_MULT
    if (apuR.current === 'double') pts *= 2
    const ns = scoreR.current + pts; scoreR.current = ns; setScore(ns)

    // Milestone
    const mils = [50, 100, 200, 500, 1000, 2000, 5000]
    for (const m of mils) {
      if (ns >= m && lastMsRef.current < m) {
        lastMsRef.current = m; setMilestone(`${m} PTS!`)
        fx.triggerFlash(`${PX.accent}88`, 200)
        fx.spawnParticles(10, awRef.current / 2, ahRef.current * 0.3, ['*', '!', '+'])
        fx.triggerShake(5, 200)
        sfx('levelup', 0.45, 1.2)
        if (msTimerRef.current) clearTimeout(msTimerRef.current)
        msTimerRef.current = window.setTimeout(() => setMilestone(''), 1500)
        break
      }
    }

    setCLabel(getComboLabel(nc))

    // Spawn plat
    if (Math.random() < PLAT_CHANCE) {
      const py = ahRef.current - BALL_R * scaleR.current - 40 - Math.random() * (ahRef.current * 0.45)
      platsR.current.push({ x: Math.random() * (awRef.current - PLAT_W), y: py, ms: PLAT_DUR_MS })
    }

    // Bounce
    vyR.current = perfect ? STRONG_BOUNCE_VY : BOUNCE_VY
    vxR.current = -(dx / effR) * H_FORCE

    // FX
    fx.comboHitBurst(tx, ty, nc, pts, perfect ? ['*', '+', '!'] : undefined)
    if (perfect) {
      fx.triggerFlash(`${PX.white}88`, 60)
      sfx('perfect', 0.5, 1 + nc * 0.015)
    } else {
      sfx('hit', 0.45, 1 + nc * 0.01)
    }
    if (nc > 0 && nc % 5 === 0) sfx('combo', 0.4, 0.9 + nc * 0.01)
  }, [sfx, fx, applyPU, finish])

  // ─── Double-tap dash ───────────────────────────
  const lastTapRef = useRef(0)
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const now = performance.now()
    const dt = now - lastTapRef.current
    lastTapRef.current = now

    // Double tap = dash (quick upward boost)
    if (dt < 300 && dashReadyR.current && !doneR.current) {
      dashReadyR.current = false; dashCdR.current = DASH_COOLDOWN_MS
      setDashReady(false)
      vyR.current = DASH_VY
      sfx('dash', 0.45)
      fx.triggerFlash(`${PX.platform}44`, 80)
      fx.spawnParticles(4, bxR.current, byR.current, ['>>'], 'circle')
      return
    }

    handleTap(e.clientX, e.clientY)
  }, [handleTap, sfx, fx])

  // ─── ESC ───────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); onExit() } }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onExit])

  // ─── Game loop ─────────────────────────────────
  useEffect(() => {
    lastFrameR.current = null

    const step = (now: number) => {
      if (doneR.current) { rafR.current = null; return }
      if (lastFrameR.current === null) lastFrameR.current = now
      const dt = Math.min(now - lastFrameR.current, MAX_FRAME_DELTA_MS)
      lastFrameR.current = now; elapsedR.current += dt

      const AW = awRef.current, AH = ahRef.current
      const sc = scaleR.current, br = BALL_R * sc
      const fy = AH - br, cy = br, wl = br, wr = AW - br

      // Dash cooldown
      if (!dashReadyR.current) {
        dashCdR.current -= dt
        if (dashCdR.current <= 0) { dashReadyR.current = true; setDashReady(true) }
      }

      // PU timer
      if (apuR.current) {
        puTimerR.current -= dt; setPuTimer(Math.max(0, puTimerR.current))
        if (puTimerR.current <= 0) clearPU()
      }

      // Wind event
      const el = elapsedR.current
      if (el - lastWindR.current > WIND_INTERVAL_MS && bounceR.current > 5) {
        lastWindR.current = el
        windTimerR.current = WIND_DURATION_MS
        windR.current = Math.random() > 0.5 ? 1 : -1
        setWind(windR.current)
        sfx('wind', 0.35)
      }
      if (windTimerR.current > 0) {
        windTimerR.current -= dt
        if (windTimerR.current <= 0) { windR.current = 0; setWind(0) }
      }

      // Gravity + wind
      const grav = apuR.current === 'slow' ? BASE_GRAVITY * 0.4 : gravR.current
      vyR.current += grav * dt
      if (windR.current !== 0) vxR.current += windR.current * WIND_FORCE * (dt / 16)

      let nx = bxR.current + vxR.current * dt
      let ny = byR.current + vyR.current * dt

      // Wall bounce
      if (nx <= wl) { nx = wl; vxR.current = Math.abs(vxR.current) * WALL_DAMP; sfx('wall', 0.2); fx.spawnParticles(2, nx, ny, undefined, 'circle') }
      else if (nx >= wr) { nx = wr; vxR.current = -Math.abs(vxR.current) * WALL_DAMP; sfx('wall', 0.2); fx.spawnParticles(2, nx, ny, undefined, 'circle') }
      if (ny <= cy) { ny = cy; vyR.current = Math.abs(vyR.current) * 0.3 }

      // Platform
      let onPlat = false
      for (const p of platsR.current) {
        if (ny + br >= p.y && ny + br <= p.y + PLAT_H + 5 && nx >= p.x - br && nx <= p.x + PLAT_W + br && vyR.current > 0) {
          ny = p.y - br; vyR.current = BOUNCE_VY * 0.7; onPlat = true
          fx.spawnParticles(2, nx, p.y, undefined, 'circle'); break
        }
      }

      // Obstacle
      for (let i = obsR.current.length - 1; i >= 0; i--) {
        const o = obsR.current[i]; o.x += o.vx * dt
        if (o.x < -o.w || o.x > AW + o.w) { obsR.current.splice(i, 1); continue }
        if (nx + br > o.x && nx - br < o.x + o.w && ny + br > o.y && ny - br < o.y + o.h) {
          if (shieldR.current) {
            shieldR.current = false; setShield(false); obsR.current.splice(i, 1)
            fx.triggerFlash(`${PX.shield}66`, 100); fx.spawnParticles(5, nx, ny, ['!', '*']); fx.triggerShake(6, 100)
          } else {
            vyR.current = 0.35; fx.triggerShake(10, 180); fx.triggerFlash(`${PX.danger}44`, 100)
            fx.spawnParticles(4, nx, ny, ['X', '!'])
          }
        }
      }

      // Star collection + magnet
      for (let i = starsR.current.length - 1; i >= 0; i--) {
        const s = starsR.current[i]
        if (s.ok) continue
        s.frame = (s.frame + dt * 0.008) % 4 // animate
        const mag = apuR.current === 'magnet' ? 130 : 0
        if (mag > 0) {
          const sd = Math.hypot(nx - s.x, ny - s.y)
          if (sd < mag && sd > 1) {
            const p = 0.18 * dt / 16
            s.x += ((nx - s.x) / sd) * p * Math.min(sd, 35)
            s.y += ((ny - s.y) / sd) * p * Math.min(sd, 35)
          }
        }
        if (Math.hypot(nx - s.x, ny - s.y) < br + STAR_SIZE + (mag > 0 ? 20 : 0)) {
          s.ok = true
          const sp = STAR_PTS * (feverR.current ? FEVER_MULT : 1)
          scoreR.current += sp; setScore(scoreR.current)
          fx.showScorePopup(sp, s.x, s.y, PX.accent)
          fx.spawnParticles(3, s.x, s.y, ['*', '+'], 'circle')
          sfx('coin', 0.4, 1.2)
        }
      }

      // PU collection
      for (let i = pusR.current.length - 1; i >= 0; i--) {
        const p = pusR.current[i]; p.ms -= dt
        if (p.ms <= 0) { pusR.current.splice(i, 1); continue }
        if (Math.hypot(nx - p.x, ny - p.y) < br + PU_SIZE) {
          applyPU(p.type); pusR.current.splice(i, 1)
          fx.spawnParticles(5, p.x, p.y, [PU_ICONS[p.type]], 'emoji')
        }
      }

      // Decay platforms
      platsR.current = platsR.current.map(p => ({ ...p, ms: p.ms - dt })).filter(p => p.ms > 0)
      starsR.current = starsR.current.filter(s => !s.ok)

      // Floor
      if (ny >= fy && !onPlat) {
        if (shieldR.current) {
          shieldR.current = false; setShield(false); vyR.current = STRONG_BOUNCE_VY; ny = fy - 1
          fx.triggerFlash(`${PX.shield}88`, 120); fx.spawnParticles(6, nx, fy, ['!', '*']); fx.triggerShake(6, 100)
        } else { finish(); rafR.current = null; return }
      }

      // Spawners (scale with level)
      const lvScale = 1 - Math.min(0.4, levelR.current * 0.05)
      if (el - lastPuSpawnR.current > PU_SPAWN_MS * lvScale && bounceR.current > 3) {
        lastPuSpawnR.current = el
        pusR.current.push({ x: 25 + Math.random() * (AW - 50), y: 50 + Math.random() * (AH * 0.5), type: PU_TYPES[Math.floor(Math.random() * PU_TYPES.length)], ms: 6000 })
      }
      if (el - lastObSpawnR.current > OB_SPAWN_MS * lvScale && bounceR.current > 6) {
        lastObSpawnR.current = el
        const left = Math.random() > 0.5
        obsR.current.push({ x: left ? -35 : AW + 5, y: 70 + Math.random() * (AH * 0.5), w: 25 + Math.random() * 20, h: 10, vx: (left ? 1 : -1) * OB_SPEED * (1 + levelR.current * 0.1) })
      }
      if (el - lastStarSpawnR.current > STAR_SPAWN_MS * lvScale) {
        lastStarSpawnR.current = el
        starsR.current.push({ x: 25 + Math.random() * (AW - 50), y: 35 + Math.random() * (AH * 0.45), ok: false, frame: 0 })
      }

      // Star frame animation
      starFrameR.current = (starFrameR.current + dt * 0.005) % 1

      // Trail
      trailCntR.current += dt
      if (trailCntR.current > 25) { trailCntR.current = 0; trailR.current = [{ x: nx, y: ny, age: 0 }, ...trailR.current.slice(0, MAX_TRAIL - 1)] }
      trailR.current = trailR.current.map(t => ({ ...t, age: t.age + dt })).filter(t => t.age < 350)

      bxR.current = nx; byR.current = ny; setBallX(nx); setBallY(ny)

      // Danger
      setDanger(ny > AH * 0.82 && bounceR.current > 0)

      // Max height
      const ch = Math.max(0, fy - ny)
      if (ch > maxHtR.current) { maxHtR.current = ch; setMaxHt(ch) }

      // Height score
      if (bounceR.current > 0) {
        const hs = Math.floor(ch / HT_SCORE_DIV)
        if (hs > 0) { scoreR.current += hs; setScore(scoreR.current) }
      }

      // Sync
      setPlats([...platsR.current]); setPus([...pusR.current]); setObs([...obsR.current])
      setStars(starsR.current.filter(s => !s.ok)); setTrail([...trailR.current])

      fx.updateParticles()
      rafR.current = requestAnimationFrame(step)
    }

    rafR.current = requestAnimationFrame(step)
    return () => { if (rafR.current !== null) { cancelAnimationFrame(rafR.current); rafR.current = null } }
  }, [finish, clearPU, applyPU, sfx, fx])

  // ─── Render ────────────────────────────────────
  const bc = comboCol(combo)
  const br = BALL_R * scale
  const htPct = clamp((maxHt / (arenaH - 40)) * 100, 0, 100)
  const chPct = clamp(((arenaH - BALL_R - ballY) / (arenaH - 40)) * 100, 0, 100)
  const best = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const puPct = activePU ? (puTimer / PU_DUR_MS) * 100 : 0

  return (
    <section
      className="mini-game-panel ball-bounce-panel"
      aria-label="ball-bounce-mini-game"
      style={{
        maxWidth: 432, width: '100%', aspectRatio: '9/16', margin: '0 auto',
        overflow: 'hidden', position: 'relative',
        background: PX.bg, imageRendering: 'pixelated',
        border: `${PX_BORDER}px solid ${PX.bgLight}`,
        ...fx.getShakeStyle(),
      }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        @keyframes bb-blink{0%,100%{opacity:1}50%{opacity:.3}}
        @keyframes bb-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes bb-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
        @keyframes bb-slide{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
        @keyframes bb-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
        @keyframes bb-pop{0%{transform:scale(0);opacity:0}40%{transform:scale(1.3);opacity:1}100%{transform:scale(1);opacity:1}}
        @keyframes bb-danger{0%,100%{border-color:${PX.danger}66}50%{border-color:${PX.danger}}}
        @keyframes bb-wind-arrow{0%{opacity:0;transform:translateX(-20px)}50%{opacity:.5}100%{opacity:0;transform:translateX(20px)}}
      `}</style>
      <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
      <ParticleRenderer particles={fx.particles} />
      <ScorePopupRenderer popups={fx.scorePopups} />

      {/* ─── HUD ──────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        padding: '8px 10px 4px', display: 'flex', flexDirection: 'column', gap: 2,
        background: `linear-gradient(180deg, ${PX.black}ee 0%, transparent 100%)`,
      }}>
        {/* Score row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: PX.text, textShadow: `2px 2px 0 ${PX.black}` }}>
            {score.toLocaleString()}
          </span>
          <span style={{ fontSize: 8, color: PX.textDim }}>
            BEST {best.toLocaleString()}
          </span>
        </div>

        {/* Stats row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: PX.textDim }}>
          <span>LV<strong style={{ color: PX.accent }}>{level}</strong></span>
          <span>B<strong style={{ color: PX.text }}>{bounces}</strong></span>
          <span style={{ color: bc, fontWeight: 700 }}>C<strong>{combo}</strong></span>
          <span>HT<strong style={{ color: PX.text }}>{Math.floor(maxHt)}</strong></span>
        </div>

        {/* Fever */}
        {fever && (
          <div style={{
            textAlign: 'center', color: PX.accent, fontWeight: 800, fontSize: 11,
            textShadow: `0 0 8px ${PX.accent}, 2px 2px 0 ${PX.black}`,
            animation: 'bb-pulse 0.3s ease-in-out infinite alternate',
          }}>
            FEVER x{FEVER_MULT}
          </div>
        )}

        {/* Combo label */}
        {cLabel && combo >= 3 && (
          <div style={{
            textAlign: 'center', fontSize: 13, fontWeight: 800,
            color: getComboColor(combo), textShadow: `2px 2px 0 ${PX.black}, 0 0 6px ${getComboColor(combo)}`,
            animation: 'bb-pop 0.3s ease-out',
          }}>
            {cLabel}
          </div>
        )}

        {/* PowerUp bar */}
        {activePU && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
            <span style={{ fontSize: 10, color: PU_COLORS[activePU], fontWeight: 800, textShadow: `1px 1px 0 ${PX.black}` }}>
              {PU_ICONS[activePU]}
            </span>
            <div style={{ flex: 1, maxWidth: 100, height: 5, background: `${PX.textDim}44`, overflow: 'hidden' }}>
              <div style={{ width: `${puPct}%`, height: '100%', background: PU_COLORS[activePU], transition: 'width 100ms linear' }} />
            </div>
          </div>
        )}

        {/* Dash indicator */}
        {!dashReady && (
          <div style={{ textAlign: 'center', fontSize: 8, color: PX.textDim, animation: 'bb-blink 0.5s infinite' }}>
            DASH COOLDOWN
          </div>
        )}
      </div>

      {/* Height meter */}
      <div style={{
        position: 'absolute', left: 4, top: 75, bottom: 15, width: 5,
        background: `${PX.textDim}22`, zIndex: 5, overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${htPct}%`, background: `${PX.accent}44` }} />
        <div style={{ position: 'absolute', bottom: 0, width: '100%', height: `${chPct}%`, background: bc }} />
      </div>

      {/* ─── Arena ─────────────────────────────── */}
      <div ref={arenaRef} onPointerDown={handlePointerDown} role="presentation"
        style={{ position: 'absolute', inset: 0, cursor: over ? 'default' : 'pointer', touchAction: 'none' }}>

        {/* Score zones (horizontal bands) */}
        {zones.map((z, i) => (
          <div key={`z-${i}`} style={{
            position: 'absolute', left: 0, right: 0, top: z.y, height: z.h,
            background: `${z.color}11`, borderTop: `1px dashed ${z.color}33`, borderBottom: `1px dashed ${z.color}33`,
            pointerEvents: 'none',
          }}>
            <span style={{
              position: 'absolute', right: 4, top: 1, fontSize: 7, color: `${z.color}88`,
              fontWeight: 800,
            }}>x{z.mult}</span>
          </div>
        ))}

        {/* Wind indicator */}
        {wind !== 0 && (
          <div style={{
            position: 'absolute', top: '45%', left: 0, right: 0, textAlign: 'center',
            fontSize: 24, color: `${PX.platform}66`, pointerEvents: 'none',
            transform: wind > 0 ? 'scaleX(1)' : 'scaleX(-1)',
            animation: 'bb-wind-arrow 1s ease-in-out infinite',
          }}>
            {'>>>'}
          </div>
        )}

        {/* Floor (pixel style) */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 4,
          background: PX.floor, boxShadow: `0 -2px 0 ${PX.floorDark}, 0 -6px 12px ${PX.danger}44`,
        }} />
        <div style={{
          position: 'absolute', bottom: 4, left: 0, right: 0, height: 2,
          background: PX.floorDark,
        }} />

        {/* Floor danger gradient */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 25,
          background: `linear-gradient(0deg, ${PX.danger}11, transparent)`, pointerEvents: 'none',
        }} />

        {/* Danger border */}
        {danger && (
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            border: `3px solid ${PX.danger}66`, animation: 'bb-danger 0.4s infinite', zIndex: 8,
          }} />
        )}

        {/* Milestone */}
        {milestone && (
          <div style={{
            position: 'absolute', top: '32%', left: 0, right: 0, textAlign: 'center',
            fontSize: 18, fontWeight: 800, color: PX.accent,
            textShadow: `3px 3px 0 ${PX.black}, 0 0 16px ${PX.accent}`,
            animation: 'bb-pop 0.4s ease-out', zIndex: 15, pointerEvents: 'none',
          }}>
            {milestone}
          </div>
        )}

        {/* Platforms (pixel) */}
        {plats.map((p, i) => (
          <div key={`pl-${i}`} style={{
            position: 'absolute', left: p.x, top: p.y, width: PLAT_W, height: PLAT_H,
            background: PX.platform, boxShadow: `0 ${PX_BORDER}px 0 ${PX.platformDk}`,
            opacity: Math.min(1, p.ms / 800),
          }} />
        ))}

        {/* Obstacles (pixel) */}
        {obs.map((o, i) => (
          <div key={`ob-${i}`} style={{
            position: 'absolute', left: o.x, top: o.y, width: o.w, height: o.h,
            background: PX.danger, boxShadow: `0 ${PX_BORDER}px 0 ${PX.floorDark}`,
            animation: 'bb-blink 0.8s infinite',
          }} />
        ))}

        {/* Stars (pixel coin) */}
        {stars.map((s, i) => {
          const f = Math.floor(((s.frame || 0) + starFrameR.current * 4) % 4)
          const w = f === 0 ? STAR_SIZE : f === 1 ? STAR_SIZE * 0.7 : f === 2 ? STAR_SIZE * 0.3 : STAR_SIZE * 0.7
          return (
            <div key={`st-${i}`} style={{
              position: 'absolute', left: s.x - w / 2, top: s.y - STAR_SIZE / 2,
              width: w, height: STAR_SIZE, background: PX.star,
              boxShadow: `0 2px 0 ${PX.starDk}`,
              animation: 'bb-float 1.2s ease-in-out infinite',
            }} />
          )
        })}

        {/* PowerUps (pixel box) */}
        {pus.map((p, i) => (
          <div key={`pu-${i}`} style={{
            position: 'absolute', left: p.x - PU_SIZE / 2, top: p.y - PU_SIZE / 2,
            width: PU_SIZE, height: PU_SIZE,
            background: PU_COLORS[p.type], boxShadow: pxBorder(PX.black, 2),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 800, color: PX.white,
            animation: 'bb-float 1s ease-in-out infinite',
            opacity: Math.min(1, p.ms / 800),
          }}>
            {PU_ICONS[p.type]}
          </div>
        ))}

        {/* Trail (pixel squares) */}
        {trail.map((t, i) => {
          const p = t.age / 350
          const sz = br * 2 * (1 - p * 0.8)
          return (
            <div key={`tr-${i}`} style={{
              position: 'absolute', left: t.x - sz / 2, top: t.y - sz / 2,
              width: sz, height: sz, background: bc,
              opacity: (1 - p) * 0.2, pointerEvents: 'none',
            }} />
          )
        })}

        {/* Ball shadow */}
        <div style={{
          position: 'absolute', left: ballX - br * 0.5, top: arenaH - 8,
          width: br, height: 3, background: `${PX.black}33`,
          transform: `scaleX(${clamp(1 - (arenaH - ballY) / arenaH * 0.6, 0.2, 1)})`,
          pointerEvents: 'none',
        }} />

        {/* Ball (pixel art style - square with highlights) */}
        <div style={{
          position: 'absolute', left: ballX - br, top: ballY - br,
          width: br * 2, height: br * 2,
          background: bc,
          boxShadow: [
            pxBorder(PX.black, 2),
            `inset -${br * 0.4}px -${br * 0.4}px 0 rgba(0,0,0,0.25)`,
            `inset ${br * 0.3}px ${br * 0.3}px 0 rgba(255,255,255,0.25)`,
            shield ? `0 0 0 4px ${PX.shield}88` : '',
          ].filter(Boolean).join(', '),
          borderRadius: br * 0.3,
          transition: 'width 200ms, height 200ms',
          animation: shield ? 'bb-pulse 1s infinite' : undefined,
        }}>
          {/* Pixel highlight */}
          <div style={{
            position: 'absolute', top: 3, left: 3,
            width: br * 0.5, height: br * 0.3,
            background: `${PX.white}55`,
          }} />

          {/* Fever ring */}
          {fever && (
            <div style={{
              position: 'absolute', inset: -6, border: `2px solid ${PX.accent}88`,
              animation: 'bb-spin 2s linear infinite', pointerEvents: 'none',
            }} />
          )}
        </div>

        {/* Game Over */}
        {over && (
          <div style={{
            position: 'absolute', inset: 0, background: `${PX.black}cc`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 10, zIndex: 20,
          }}>
            <p style={{
              fontSize: 26, fontWeight: 800, color: PX.danger,
              textShadow: `3px 3px 0 ${PX.black}`, margin: 0,
            }}>GAME OVER</p>
            <p style={{
              fontSize: 16, color: PX.accent, fontWeight: 700, margin: 0,
              textShadow: `2px 2px 0 ${PX.black}`,
            }}>Score: {score.toLocaleString()}</p>
            <div style={{ fontSize: 9, color: PX.textDim, textAlign: 'center' }}>
              <p style={{ margin: '2px 0' }}>Level {level} | Bounces {bounces}</p>
              <p style={{ margin: '2px 0' }}>Max Height {Math.floor(maxHt)}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

export const ballBounceMiniModule: MiniGameModule = {
  manifest: {
    id: 'ball-bounce-mini',
    title: 'Ball Bounce',
    description: 'Tap ball to bounce! Floor = Game Over!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#e11d48',
  },
  Component: BallBounceMiniGame,
}
