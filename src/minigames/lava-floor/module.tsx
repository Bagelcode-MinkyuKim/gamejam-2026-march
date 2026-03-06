import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import characterSprite from '../../../assets/images/same-character/park-wankyu.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'

// Dedicated sounds
import sfxJump from '../../../assets/sounds/lava-floor-jump.mp3'
import sfxCoin from '../../../assets/sounds/lava-floor-coin.mp3'
import sfxCombo from '../../../assets/sounds/lava-floor-combo.mp3'
import sfxCrumble from '../../../assets/sounds/lava-floor-crumble.mp3'
import sfxFall from '../../../assets/sounds/lava-floor-fall.mp3'
import sfxFever from '../../../assets/sounds/lava-floor-fever.mp3'
import sfxShield from '../../../assets/sounds/lava-floor-shield.mp3'
import sfxBubble from '../../../assets/sounds/lava-floor-bubble.mp3'
import sfxEruption from '../../../assets/sounds/lava-floor-eruption.mp3'
import sfxPlatformMove from '../../../assets/sounds/lava-floor-platform-move.mp3'
import sfxMagnet from '../../../assets/sounds/lava-floor-magnet.mp3'
import sfxDoubleJump from '../../../assets/sounds/lava-floor-doublejump.mp3'
import sfxLevelUp from '../../../assets/sounds/lava-floor-levelup.mp3'
import sfxDanger from '../../../assets/sounds/lava-floor-danger.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import bgmSrc from '../../../assets/sounds/lava-floor-bgm.mp3'

// ─── Layout ───
const VW = 360
const VH = 720
const PX = 4 // pixel grid unit for dot-game feel

// ─── Character ───
const CHAR_SIZE = 80

// ─── Lava ───
const LAVA_H = 64
const LAVA_Y = VH - LAVA_H

// ─── Platform types ───
type PlatformType = 'normal' | 'moving' | 'spring' | 'crumble' | 'ice' | 'gold' | 'sink'

// ─── Platform ───
const PLAT_W0 = 56
const PLAT_WMIN = 24
const PLAT_WSHRINK = 0.8
const PLAT_H = 12
const PLAT_LIFE0 = 3400
const PLAT_LIFEMIN = 900
const PLAT_LIFESHRINK = 40
const PLAT_BLINK_MS = 900
const SPAWN_INT0 = 1300
const SPAWN_INTMIN = 450
const SPAWN_INTSHRINK = 25
const SPAWN_MX = 32
const SPAWN_MINY = 50
const SPAWN_MAXY = LAVA_Y - 44
const MAX_PLATS = 9

// ─── Moving ───
const MOVE_SPEED = 45
const MOVE_RANGE = 55

// ─── Spring ───
const SPRING_BONUS = 3
const SPRING_ARC = -150

// ─── Crumble ───
const CRUMBLE_MS = 350

// ─── Player ───
const PLAYER_R = CHAR_SIZE / 2 // half character — feet align with platform top
const JUMP_MS = 240

// ─── Physics ───
const GRAVITY = 1200
const FALL_DELAY = 450
const TIMEOUT_MS = 120000

// ─── Items ───
const COIN_R = 8
const COIN_SCORE = 5
const COIN_CHANCE = 0.38
const SHIELD_CHANCE = 0.07
const MAGNET_CHANCE = 0.06
const MAGNET_DURATION = 5000
const MAGNET_RANGE = 100

// ─── Fever / Combo ───
const FEVER_THRESH = 10
const FEVER_MS = 5000
const FEVER_MULT = 3
const COMBO_WIN = 3500

// ─── Level system ───
const LEVEL_SCORE = 15 // score per level

// ─── Eruption ───
const ERUPT_INT_BASE = 7000
const ERUPT_INT_MIN = 2500
const ERUPT_DUR = 2200
const ERUPT_W = 44

// ─── Fire bat enemy ───
const BAT_SIZE = 20
const BAT_SPEED_BASE = 50
const BAT_SPAWN_AFTER = 12000

// ─── Sink platform ───
const SINK_SPEED = 18 // px/s sinking

// ─── Time-based difficulty phases ───
// Each phase unlocks at a certain elapsed time (ms)
const PHASE_ERUPTIONS = 10000   // 10s: eruptions start
const PHASE_FIREBALLS = 15000   // 15s: fireballs
const PHASE_BATS = 20000        // 20s: fire bats
const PHASE_LAVA_WAVE = 30000   // 30s: lava waves
const PHASE_EARTHQUAKE = 40000  // 40s: earthquakes
const PHASE_SINK_PLATS = 25000  // 25s: sinking platforms
const PHASE_MULTI_ERUPT = 50000 // 50s: multiple eruptions
const PHASE_HELL = 70000        // 70s: all hazards intensified

function getDifficulty(lv: number, elapsed: number) {
  const timeFactor = Math.min(elapsed / 60000, 1.5) // 0~1.5 over 60s
  return {
    eruptInterval: Math.max(ERUPT_INT_MIN, ERUPT_INT_BASE - lv * 200 - timeFactor * 2000),
    batSpeed: BAT_SPEED_BASE + lv * 6 + timeFactor * 30,
    batSpawnInterval: Math.max(1500, 6000 - lv * 300 - timeFactor * 2000),
    maxBats: Math.min(6, 2 + Math.floor(lv / 3) + (elapsed > PHASE_HELL ? 2 : 0)),
    moveSpeed: MOVE_SPEED + lv * 2 + timeFactor * 20,
    lavaRisePerTick: Math.min(24, 10 + lv + timeFactor * 5),
    platformLifeMult: Math.max(0.5, 1.0 - timeFactor * 0.3),
    maxPlatforms: Math.max(5, MAX_PLATS - Math.floor(timeFactor * 2)),
    multiErupt: elapsed > PHASE_MULTI_ERUPT,
  }
}

// ─── Lava wave ───
const LAVA_WAVE_DUR = 3000
const LAVA_WAVE_HEIGHT = 60

// ─── Earthquake ───
const EARTHQUAKE_DUR = 1500

// ─── Fireball hazard ───
interface Fireball { id: number; x: number; y: number; dx: number; spawnAt: number }
const FIREBALL_SIZE = 16
const FIREBALL_SPEED = 80

interface Platform {
  id: number; x: number; y: number; w: number;
  spawnAt: number; lifeMs: number;
  hasCoin: boolean; hasShield: boolean; hasMagnet: boolean; hasDoubleScore: boolean;
  type: PlatformType; moveDir: number; crumbleAt: number | null
}

interface PlayerState {
  x: number; y: number;
  jumping: boolean; jx0: number; jy0: number; jx1: number; jy1: number; jElapsed: number;
  falling: boolean; fallV: number; standId: number | null;
  hasShield: boolean; shieldUsedAt: number | null;
  hasMagnet: boolean; magnetEndAt: number;
  doubleJumpReady: boolean; arcH: number;
  facingRight: boolean
}

interface Eruption { x: number; startAt: number }

interface FireBat { id: number; x: number; y: number; dx: number; spawnAt: number }

// ─── Helpers ───
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const rng = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const easeOut = (t: number) => t * (2 - t)
const snap = (v: number) => Math.round(v / PX) * PX // snap to pixel grid

function platW(j: number) { return Math.max(PLAT_WMIN, PLAT_W0 - j * PLAT_WSHRINK) }
function platLife(j: number) { return Math.max(PLAT_LIFEMIN, PLAT_LIFE0 - j * PLAT_LIFESHRINK) }
function spawnInt(j: number) { return Math.max(SPAWN_INTMIN, SPAWN_INT0 - j * SPAWN_INTSHRINK) }

function pickType(j: number, elapsed = 0): PlatformType {
  if (j < 3) return 'normal'
  const r = Math.random()
  if (elapsed > PHASE_SINK_PLATS && r < 0.12) return 'sink'
  if (j >= 25 && r < 0.08) return 'gold'
  if (j >= 18 && r < 0.15) return 'ice'
  if (j >= 10 && r < 0.25) return 'crumble'
  if (j >= 5 && r < 0.38) return 'spring'
  if (r < 0.55) return 'moving'
  return 'normal'
}

function mkPlat(id: number, now: number, j: number, elapsed = 0): Platform {
  const w = snap(platW(j))
  const x = snap(rng(SPAWN_MX, VW - SPAWN_MX - w))
  const y = snap(rng(SPAWN_MINY, SPAWN_MAXY))
  const life = platLife(j)
  const hasCoin = Math.random() < COIN_CHANCE
  const hasShield = !hasCoin && Math.random() < SHIELD_CHANCE
  const hasMagnet = !hasCoin && !hasShield && Math.random() < MAGNET_CHANCE
  const hasDoubleScore = !hasCoin && !hasShield && !hasMagnet && Math.random() < 0.05
  const type = pickType(j, elapsed)
  return { id, x, y, w, spawnAt: now, lifeMs: life, hasCoin, hasShield, hasMagnet, hasDoubleScore, type, moveDir: Math.random() > 0.5 ? 1 : -1, crumbleAt: null }
}

function mkStart(id: number, now: number): Platform {
  const w = snap(PLAT_W0 * 1.8)
  const x = snap(VW / 2 - w / 2)
  const y = snap(VH / 2 + 60)
  return { id, x, y, w, spawnAt: now, lifeMs: 6000, hasCoin: false, hasShield: false, hasMagnet: false, hasDoubleScore: false, type: 'normal', moveDir: 0, crumbleAt: null }
}

function expired(p: Platform, now: number) {
  if (p.crumbleAt !== null && now >= p.crumbleAt) return true
  return now - p.spawnAt >= p.lifeMs
}

function blinking(p: Platform, now: number) {
  const rem = p.lifeMs - (now - p.spawnAt)
  return rem > 0 && rem <= PLAT_BLINK_MS
}

function platOpacity(p: Platform, now: number): number {
  const el = now - p.spawnAt
  const rem = p.lifeMs - el
  if (rem <= 0) return 0
  if (p.crumbleAt !== null) return clamp((p.crumbleAt - now) / CRUMBLE_MS, 0, 1)
  if (rem <= PLAT_BLINK_MS) return 0.3 + Math.abs(Math.sin((el / 70) * Math.PI)) * 0.5
  if (el < 200) return el / 200
  return 1
}

function movingX(p: Platform, now: number): number {
  if (p.type !== 'moving') return p.x
  const off = Math.sin((now - p.spawnAt) / 1000 * MOVE_SPEED / MOVE_RANGE) * MOVE_RANGE * p.moveDir
  return snap(clamp(p.x + off, 4, VW - p.w - 4))
}

function platColor(p: Platform, lifeR: number, fever: boolean): string {
  if (fever) return '#f59e0b'
  switch (p.type) {
    case 'spring': return '#22c55e'
    case 'moving': return '#3b82f6'
    case 'crumble': return '#a16207'
    case 'ice': return '#67e8f9'
    case 'gold': return '#fbbf24'
    case 'sink': return '#78716c'
    default: return lifeR > 0.5 ? '#4ade80' : lifeR > 0.25 ? '#eab308' : '#ef4444'
  }
}

function onPlat(px: number, py: number, pl: Platform, now: number) {
  const plx = movingX(pl, now)
  const bot = py + PLAYER_R
  return bot >= pl.y - 5 && bot <= pl.y + PLAT_H + 5 && px >= plx - 5 && px <= plx + pl.w + 5
}

// ─── Pixel rect helper for SVG dot-art ───
function PixelRect({ x, y, w, h, fill, opacity = 1 }: { x: number; y: number; w: number; h: number; fill: string; opacity?: number }) {
  return <rect x={snap(x)} y={snap(y)} width={snap(w)} height={snap(h)} fill={fill} opacity={opacity} shapeRendering="crispEdges" />
}

// ─── Brick pattern for platforms ───
function BrickPlatform({ x, y, w, h, color, opacity = 1, isBlinking = false }: { x: number; y: number; w: number; h: number; color: string; opacity?: number; isBlinking?: boolean }) {
  const cols = Math.max(1, Math.floor(w / 10))
  const rows = Math.max(1, Math.floor(h / 6))
  const bw = w / cols
  const bh = h / rows
  return (
    <g opacity={opacity}>
      <rect x={x} y={y} width={w} height={h} fill={color} shapeRendering="crispEdges" stroke={isBlinking ? '#fff' : 'rgba(0,0,0,0.3)'} strokeWidth={isBlinking ? 2 : 0.5} />
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) => {
          const offset = r % 2 === 0 ? 0 : bw / 2
          const bx = x + c * bw + offset
          if (bx + bw > x + w + 1) return null
          return (
            <rect
              key={`${r}-${c}`}
              x={snap(bx)}
              y={snap(y + r * bh)}
              width={snap(Math.min(bw, x + w - bx))}
              height={snap(bh)}
              fill="none"
              stroke="rgba(0,0,0,0.15)"
              strokeWidth={0.5}
              shapeRendering="crispEdges"
            />
          )
        })
      )}
    </g>
  )
}

// ─── Pixel coin ───
function PixelCoin({ cx, cy, t, id }: { cx: number; cy: number; t: number; id: number }) {
  const bounce = Math.sin(t / 180 + id) * 3
  const gy = snap(cy + bounce)
  return (
    <g>
      <rect x={snap(cx - 7)} y={snap(gy - 7)} width={14} height={14} rx={2} fill="#fbbf24" stroke="#d97706" strokeWidth={1} shapeRendering="crispEdges" />
      <text x={cx} y={gy + 3} textAnchor="middle" fontSize="9" fill="#92400e" fontWeight="bold" fontFamily="monospace" pointerEvents="none">$</text>
    </g>
  )
}

// ─── Pixel fire bat ───
function PixelBat({ bat, t }: { bat: FireBat; t: number }) {
  const wingFlap = Math.sin(t / 100 + bat.id * 2) * 4
  const bx = snap(bat.x)
  const by = snap(bat.y)
  return (
    <g>
      {/* body */}
      <rect x={bx - 5} y={by - 4} width={10} height={8} fill="#991b1b" shapeRendering="crispEdges" />
      {/* wings */}
      <rect x={bx - 10} y={snap(by - 2 + wingFlap)} width={6} height={4} fill="#dc2626" shapeRendering="crispEdges" />
      <rect x={bx + 4} y={snap(by - 2 - wingFlap)} width={6} height={4} fill="#dc2626" shapeRendering="crispEdges" />
      {/* eyes */}
      <rect x={bx - 3} y={by - 2} width={2} height={2} fill="#fbbf24" shapeRendering="crispEdges" />
      <rect x={bx + 1} y={by - 2} width={2} height={2} fill="#fbbf24" shapeRendering="crispEdges" />
    </g>
  )
}

// ═══════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════
function LavaFloorGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()
  const [score, setScore] = useState(0)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [player, setPlayer] = useState<PlayerState>({
    x: VW / 2, y: VH / 2 + 60 - PLAYER_R,
    jumping: false, jx0: 0, jy0: 0, jx1: 0, jy1: 0, jElapsed: 0,
    falling: false, fallV: 0, standId: null,
    hasShield: false, shieldUsedAt: null,
    hasMagnet: false, magnetEndAt: 0,
    doubleJumpReady: true, arcH: -90,
    facingRight: true,
  })
  const [phase, setPhase] = useState<'playing' | 'falling' | 'finished'>('playing')
  const [elapsed, setElapsed] = useState(0)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemMs, setFeverRemMs] = useState(0)
  const [coins, setCoins] = useState(0)
  const [collected, setCollected] = useState<Set<number>>(new Set())
  const [eruptions, setEruptions] = useState<Eruption[]>([])
  const [bats, setBats] = useState<FireBat[]>([])
  const [fireballs, setFireballs] = useState<Fireball[]>([])
  const [level, setLevel] = useState(1)
  const [trail, setTrail] = useState<{ x: number; y: number; age: number }[]>([])
  const [lavaRiseOffset, setLavaRiseOffset] = useState(0)
  const [hasDoubleScore, setHasDoubleScore] = useState(false)
  const [doubleScoreRemMs, setDoubleScoreRemMs] = useState(0)
  const [lavaWaveExtra, setLavaWaveExtra] = useState(0)
  const [isEarthquake, setIsEarthquake] = useState(false)

  // refs
  const R = useRef({
    score: 0, plats: [] as Platform[], player: player,
    phase: 'playing' as string, elapsed: 0, finished: false,
    nextId: 1, lastSpawn: 0, jumps: 0, fallStart: null as number | null,
    combo: 0, lastJump: 0, fever: false, feverRem: 0,
    coins: 0, collected: new Set<number>(),
    eruptions: [] as Eruption[], lastErupt: 0,
    bats: [] as FireBat[], nextBatId: 0, lastBatSpawn: 0,
    fireballs: [] as Fireball[], nextFireballId: 0, lastFireballSpawn: 0,
    level: 1, trail: [] as { x: number; y: number; age: number }[],
    lavaRise: 0, doubleScore: false, doubleScoreRem: 0,
    lavaWaveAt: 0, lastLavaWave: 0,
    earthquakeAt: 0, lastEarthquake: 0,
  })

  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)

  // Stable refs for game loop callbacks (prevent useEffect restarts)
  const finishRef = useRef<() => void>(() => {})
  const sfxRef = useRef<(k: string, vol: number, rate?: number) => void>(() => {})
  const effectsRef = useRef(effects)

  // audio pool
  const audio = useRef<Map<string, HTMLAudioElement>>(new Map())
  const loadA = useCallback((k: string, src: string) => {
    if (audio.current.has(k)) return
    const a = new Audio(src); a.preload = 'auto'; audio.current.set(k, a)
  }, [])
  const sfx = useCallback((k: string, vol: number, rate = 1) => {
    const a = audio.current.get(k); if (!a) return
    a.currentTime = 0; a.volume = clamp(vol, 0, 1); a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const finish = useCallback(() => {
    if (R.current.finished) return
    R.current.finished = true
    onFinish({ score: R.current.score, durationMs: Math.max(Math.round(R.current.elapsed), Math.round(DEFAULT_FRAME_MS)) })
  }, [onFinish])
  finishRef.current = finish
  sfxRef.current = sfx
  effectsRef.current = effects

  const handleTap = useCallback((plat: Platform) => {
    const r = R.current
    if (r.finished) return

    const isFalling = r.phase === 'falling'
    if (r.phase !== 'playing' && !isFalling) return

    const p = r.player
    if (p.jumping && !isFalling) return
    if (p.standId === plat.id && !isFalling) return

    const now = r.elapsed
    const px = movingX(plat, now)
    const tx = px + plat.w / 2
    const ty = plat.y - PLAYER_R
    const isSpring = plat.type === 'spring'
    const facing = tx > p.x

    // Rescue from falling!
    if (isFalling) {
      r.phase = 'playing'; setPhase('playing')
      r.combo = 0; setCombo(0)
      sfx('shield', 0.7, 1.5)
      effects.triggerFlash('#4ade80')
      effects.spawnParticles(12, p.x, p.y)
      effects.showScorePopup(0, tx, ty - 30)
    }

    const np: PlayerState = {
      ...p, jumping: true, jx0: p.x, jy0: p.y, jx1: tx, jy1: ty, jElapsed: 0,
      falling: false, fallV: 0, standId: plat.id,
      arcH: isSpring ? SPRING_ARC : -90,
      doubleJumpReady: true, facingRight: facing,
    }
    r.player = np; setPlayer(np)

    // crumble
    if (plat.type === 'crumble' && plat.crumbleAt === null) {
      r.plats = r.plats.map(pl => pl.id === plat.id ? { ...pl, crumbleAt: now + CRUMBLE_MS } : pl)
      sfx('crumble', 0.5)
    }

    r.jumps++
    const dt = now - r.lastJump; r.lastJump = now
    const nc = (dt < COMBO_WIN && r.jumps > 1) ? r.combo + 1 : 1
    r.combo = nc; setCombo(nc)

    // fever
    if (nc >= FEVER_THRESH && !r.fever) {
      r.fever = true; r.feverRem = FEVER_MS
      setIsFever(true); setFeverRemMs(FEVER_MS)
      effects.triggerFlash('#fbbf24')
      sfx('fever', 0.7, 1.2)
    }

    // score
    const base = 1
    const cbonus = Math.floor(nc / 3)
    const sbonus = isSpring ? SPRING_BONUS : 0
    const gbonus = plat.type === 'gold' ? 5 : 0
    const fm = r.fever ? FEVER_MULT : 1
    const dm = r.doubleScore ? 2 : 1
    const pts = (base + cbonus + sbonus + gbonus) * fm * dm
    r.score += pts; setScore(r.score)

    // level up
    const newLv = Math.floor(r.score / LEVEL_SCORE) + 1
    if (newLv > r.level) {
      r.level = newLv; setLevel(newLv)
      sfx('levelup', 0.6, 1 + newLv * 0.03)
      effects.triggerFlash('#a78bfa')
      // lava rises every 2 levels
      if (newLv % 2 === 0) {
        const d = getDifficulty(newLv, r.elapsed)
        r.lavaRise = Math.min(300, r.lavaRise + d.lavaRisePerTick)
        setLavaRiseOffset(r.lavaRise)
        sfx('danger', 0.5, 1)
      }
    }

    // collect items
    if (plat.hasCoin && !r.collected.has(plat.id)) {
      r.collected = new Set([...r.collected, plat.id]); setCollected(new Set(r.collected))
      const cs = COIN_SCORE * fm; r.score += cs; setScore(r.score)
      r.coins++; setCoins(r.coins)
      effects.showScorePopup(cs, tx, ty - 20)
      sfx('coin', 0.6, 1.2)
    }
    if (plat.hasShield && !r.collected.has(plat.id + 100000)) {
      r.collected = new Set([...r.collected, plat.id + 100000]); setCollected(new Set(r.collected))
      r.player = { ...r.player, hasShield: true }; setPlayer(prev => ({ ...prev, hasShield: true }))
      sfx('shield', 0.6); effects.triggerFlash('#38bdf8')
    }
    if (plat.hasMagnet && !r.collected.has(plat.id + 200000)) {
      r.collected = new Set([...r.collected, plat.id + 200000]); setCollected(new Set(r.collected))
      r.player = { ...r.player, hasMagnet: true, magnetEndAt: now + MAGNET_DURATION }
      setPlayer(prev => ({ ...prev, hasMagnet: true, magnetEndAt: now + MAGNET_DURATION }))
      sfx('magnet', 0.6); effects.triggerFlash('#c084fc')
    }
    if (plat.hasDoubleScore && !r.collected.has(plat.id + 300000)) {
      r.collected = new Set([...r.collected, plat.id + 300000]); setCollected(new Set(r.collected))
      r.doubleScore = true; r.doubleScoreRem = 6000
      setHasDoubleScore(true); setDoubleScoreRemMs(6000)
      sfx('combo', 0.7, 1.4); effects.triggerFlash('#f59e0b')
    }

    // sfx + fx
    if (r.jumps % 5 === 0) {
      sfx('combo', 0.6, 1 + Math.min(0.3, r.jumps * 0.005))
      effects.comboHitBurst(tx, ty, nc, pts)
    } else {
      sfx('jump', 0.5, 1 + Math.min(0.25, r.jumps * 0.004))
      effects.triggerShake(3)
      effects.spawnParticles(r.fever ? 8 : 4, tx, ty)
      effects.showScorePopup(pts, tx, ty)
    }

    // trail
    r.trail = [{ x: p.x, y: p.y, age: 0 }, ...r.trail.slice(0, 6)]
  }, [sfx, effects])

  // double jump in air
  const handleDoubleJump = useCallback(() => {
    const r = R.current
    if (r.finished || r.phase !== 'playing') return
    const p = r.player
    if (!p.jumping || !p.doubleJumpReady) return
    // find nearest platform above or nearby
    const candidates = r.plats.filter(pl => !expired(pl, r.elapsed) && pl.id !== p.standId)
    if (candidates.length === 0) return
    const nearest = candidates.reduce((best, pl) => {
      const dist = Math.hypot(movingX(pl, r.elapsed) + pl.w / 2 - p.x, pl.y - p.y)
      const bestDist = Math.hypot(movingX(best, r.elapsed) + best.w / 2 - p.x, best.y - p.y)
      return dist < bestDist ? pl : best
    })
    r.player = { ...r.player, doubleJumpReady: false }
    sfx('doublejump', 0.5, 1.3)
    effects.spawnParticles(5, p.x, p.y)
    handleTap(nearest)
  }, [sfx, effects, handleTap])

  const bestDisplay = useMemo(() => Math.max(bestScore, score), [bestScore, score])

  // BGM ref
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  // init audio + BGM
  useEffect(() => {
    const sfxMap: [string, string][] = [
      ['jump', sfxJump], ['coin', sfxCoin], ['combo', sfxCombo], ['crumble', sfxCrumble],
      ['fall', sfxFall], ['fever', sfxFever], ['shield', sfxShield], ['bubble', sfxBubble],
      ['eruption', sfxEruption], ['platformMove', sfxPlatformMove], ['magnet', sfxMagnet],
      ['doublejump', sfxDoubleJump], ['levelup', sfxLevelUp], ['danger', sfxDanger],
      ['gameOver', gameOverHitSfx],
    ]
    for (const [k, src] of sfxMap) loadA(k, src)
    const img = new Image(); img.src = characterSprite; void img.decode?.().catch(() => {})

    // BGM
    const bgm = new Audio(bgmSrc)
    bgm.loop = true
    bgm.volume = 0.3
    bgmRef.current = bgm
    const startBgm = () => { void bgm.play().catch(() => {}) }
    startBgm()
    window.addEventListener('pointerdown', startBgm, { once: true })

    return () => {
      audio.current.forEach(a => { a.pause(); a.currentTime = 0 })
      bgm.pause(); bgm.currentTime = 0; bgmRef.current = null
      window.removeEventListener('pointerdown', startBgm)
    }
  }, [loadA])


  // game loop
  useEffect(() => {
    const r = R.current
    const startP = mkStart(0, 0)
    r.plats = [startP]; setPlatforms([startP])
    const ip: PlayerState = {
      x: startP.x + startP.w / 2, y: startP.y - PLAYER_R,
      jumping: false, jx0: 0, jy0: 0, jx1: 0, jy1: 0, jElapsed: 0,
      falling: false, fallV: 0, standId: startP.id,
      hasShield: false, shieldUsedAt: null,
      hasMagnet: false, magnetEndAt: 0,
      doubleJumpReady: true, arcH: -90, facingRight: true,
    }
    r.player = ip; setPlayer(ip)
    lastFrameRef.current = null

    const step = (now: number) => {
      if (r.finished) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now
      r.elapsed += dt; setElapsed(r.elapsed)
      if (r.elapsed >= TIMEOUT_MS) { r.phase = 'finished'; setPhase('finished'); finishRef.current(); rafRef.current = null; return }

      const t = r.elapsed
      // Lava wave temporarily raises lava
      const waveExtra = r.lavaWaveAt > 0 ? Math.sin(((t - r.lavaWaveAt) / LAVA_WAVE_DUR) * Math.PI) * LAVA_WAVE_HEIGHT : 0
      const effectiveLavaY = LAVA_Y - r.lavaRise - waveExtra

      // fever timer
      if (r.fever) {
        r.feverRem = Math.max(0, r.feverRem - dt); setFeverRemMs(r.feverRem)
        if (r.feverRem <= 0) { r.fever = false; setIsFever(false) }
      }

      // double score timer
      if (r.doubleScore) {
        r.doubleScoreRem = Math.max(0, r.doubleScoreRem - dt); setDoubleScoreRemMs(r.doubleScoreRem)
        if (r.doubleScoreRem <= 0) { r.doubleScore = false; setHasDoubleScore(false) }
      }

      // magnet timer
      if (r.player.hasMagnet && t > r.player.magnetEndAt) {
        r.player = { ...r.player, hasMagnet: false }
      }

      // spawn platforms
      const si = spawnInt(r.jumps)
      if (t - r.lastSpawn >= si && r.plats.length < MAX_PLATS) {
        r.nextId++; r.plats = [...r.plats, mkPlat(r.nextId, t, r.jumps, t)]; r.lastSpawn = t
      }

      // expire platforms
      r.plats = r.plats.filter(p => !expired(p, t)); setPlatforms([...r.plats])

      // difficulty
      const diff = getDifficulty(r.level, t)

      // eruptions (phase-gated)
      if (t > PHASE_ERUPTIONS && t - r.lastErupt >= diff.eruptInterval) {
        r.lastErupt = t
        const eruptCount = diff.multiErupt ? (Math.random() < 0.4 ? 2 : 1) : 1
        for (let ei = 0; ei < eruptCount; ei++) {
          r.eruptions = [...r.eruptions, { x: snap(rng(16, VW - 16 - ERUPT_W)), startAt: t + ei * 400 }]
        }
        sfxRef.current('eruption', 0.5); effectsRef.current.triggerShake(5, 400)
      }
      r.eruptions = r.eruptions.filter(e => t - e.startAt < ERUPT_DUR); setEruptions([...r.eruptions])

      // fire bats (phase-gated)
      if (t > PHASE_BATS && t - r.lastBatSpawn > diff.batSpawnInterval && r.bats.length < diff.maxBats) {
        r.lastBatSpawn = t; r.nextBatId++
        const fromLeft = Math.random() > 0.5
        const bs = diff.batSpeed
        r.bats = [...r.bats, { id: r.nextBatId, x: fromLeft ? -BAT_SIZE : VW + BAT_SIZE, y: snap(rng(80, effectiveLavaY - 80)), dx: fromLeft ? bs : -bs, spawnAt: t }]
      }
      r.bats = r.bats.map(b => ({ ...b, x: b.x + b.dx * (dt / 1000) })).filter(b => b.x > -60 && b.x < VW + 60)
      setBats([...r.bats])

      // fireballs from lava
      const fbInterval = Math.max(1500, 4000 - r.level * 200)
      if (t > PHASE_FIREBALLS && t - r.lastFireballSpawn > fbInterval) {
        r.lastFireballSpawn = t; r.nextFireballId++
        const fromLeft = Math.random() > 0.5
        const spd = FIREBALL_SPEED + r.level * 5
        r.fireballs = [...r.fireballs, { id: r.nextFireballId, x: fromLeft ? -FIREBALL_SIZE : VW + FIREBALL_SIZE, y: snap(effectiveLavaY - rng(30, 80)), dx: fromLeft ? spd : -spd, spawnAt: t }]
      }
      r.fireballs = r.fireballs.map(f => ({ ...f, x: f.x + f.dx * (dt / 1000) })).filter(f => f.x > -40 && f.x < VW + 40)
      setFireballs([...r.fireballs])

      // bat sine-wave movement after PHASE_HELL
      if (t > PHASE_HELL) {
        r.bats = r.bats.map(b => ({ ...b, y: b.y + Math.sin(t / 300 + b.id) * 0.8 }))
      }

      // lava wave (phase-gated): temporary lava surge
      if (t > PHASE_LAVA_WAVE) {
        const waveInterval = t > PHASE_HELL ? 8000 : 14000
        if (t - r.lastLavaWave > waveInterval && r.lavaWaveAt === 0) {
          r.lavaWaveAt = t; r.lastLavaWave = t
          sfxRef.current('danger', 0.6, 1.2)
        }
        if (r.lavaWaveAt > 0) {
          const wp = (t - r.lavaWaveAt) / LAVA_WAVE_DUR
          if (wp >= 1) { r.lavaWaveAt = 0; setLavaWaveExtra(0) }
          else { const wave = Math.sin(wp * Math.PI) * LAVA_WAVE_HEIGHT; setLavaWaveExtra(wave) }
        }
      }

      // earthquake (phase-gated): shake + shift all platforms
      if (t > PHASE_EARTHQUAKE) {
        const quakeInterval = t > PHASE_HELL ? 10000 : 18000
        if (t - r.lastEarthquake > quakeInterval && r.earthquakeAt === 0) {
          r.earthquakeAt = t; r.lastEarthquake = t
          effectsRef.current.triggerShake(10, EARTHQUAKE_DUR)
          sfxRef.current('eruption', 0.4, 0.6)
          setIsEarthquake(true)
          // shift all platforms randomly
          r.plats = r.plats.map(p => ({
            ...p, x: snap(clamp(p.x + rng(-20, 20), 4, VW - p.w - 4)),
            y: snap(clamp(p.y + rng(-15, 15), SPAWN_MINY, SPAWN_MAXY)),
          }))
        }
        if (r.earthquakeAt > 0 && t - r.earthquakeAt > EARTHQUAKE_DUR) {
          r.earthquakeAt = 0; setIsEarthquake(false)
        }
      }

      // sink platforms: slowly fall toward lava
      if (t > PHASE_SINK_PLATS) {
        r.plats = r.plats.map(p => {
          if (p.type !== 'sink') return p
          return { ...p, y: p.y + SINK_SPEED * (dt / 1000) }
        })
      }

      // magnet: pull coins
      if (r.player.hasMagnet && !r.player.falling) {
        for (const pl of r.plats) {
          if (pl.hasCoin && !r.collected.has(pl.id)) {
            const cx = movingX(pl, t) + pl.w / 2
            const cy = pl.y - COIN_R - 3
            const dist = Math.hypot(cx - r.player.x, cy - r.player.y)
            if (dist < MAGNET_RANGE) {
              r.collected = new Set([...r.collected, pl.id]); setCollected(new Set(r.collected))
              const cs = COIN_SCORE * (r.fever ? FEVER_MULT : 1)
              r.score += cs; setScore(r.score); r.coins++; setCoins(r.coins)
              effectsRef.current.showScorePopup(cs, r.player.x, r.player.y - 20)
              sfxRef.current('coin', 0.4, 1.4)
            }
          }
        }
      }

      // update player
      let cp = r.player

      if (cp.jumping) {
        const je = cp.jElapsed + dt
        const prog = clamp(je / JUMP_MS, 0, 1)
        const ep = easeOut(prog)
        const jx = cp.jx0 + (cp.jx1 - cp.jx0) * ep
        const ly = cp.jy0 + (cp.jy1 - cp.jy0) * ep
        const arc = cp.arcH * Math.sin(prog * Math.PI)
        const jy = ly + arc
        cp = prog >= 1
          ? { ...cp, x: cp.jx1, y: cp.jy1, jumping: false, jElapsed: 0 }
          : { ...cp, x: jx, y: jy, jElapsed: je }
      }

      // track moving platform
      if (!cp.jumping && !cp.falling && cp.standId !== null) {
        const sp = r.plats.find(p => p.id === cp.standId)
        if (sp && sp.type === 'moving') cp = { ...cp, x: movingX(sp, t) + sp.w / 2 }
        // ice slide
        if (sp && sp.type === 'ice') {
          const slideDir = cp.facingRight ? 1 : -1
          const nx = clamp(cp.x + slideDir * 20 * (dt / 1000), movingX(sp, t), movingX(sp, t) + sp.w)
          cp = { ...cp, x: nx }
        }
      }

      // fall check
      if (!cp.jumping && !cp.falling && r.phase === 'playing') {
        const sp = r.plats.find(p => p.id === cp.standId)
        if (!sp || !onPlat(cp.x, cp.y, sp, t)) {
          if (r.fallStart === null) r.fallStart = t
          if (t - r.fallStart >= FALL_DELAY) {
            if (cp.hasShield) {
              cp = { ...cp, hasShield: false, shieldUsedAt: t }
              sfxRef.current('shield', 0.6, 0.8); effectsRef.current.triggerFlash('#38bdf8'); effectsRef.current.spawnParticles(10, cp.x, cp.y)
              const nearest = r.plats.reduce<Platform | null>((b, p) => {
                const d = Math.abs(p.y - cp.y) + Math.abs(movingX(p, t) + p.w / 2 - cp.x)
                if (!b) return p
                return d < Math.abs(b.y - cp.y) + Math.abs(movingX(b, t) + b.w / 2 - cp.x) ? p : b
              }, null)
              if (nearest) {
                cp = { ...cp, x: movingX(nearest, t) + nearest.w / 2, y: nearest.y - PLAYER_R, standId: nearest.id }
                r.fallStart = null
              }
            } else {
              cp = { ...cp, falling: true, fallV: 0, standId: null }
              r.phase = 'falling'; setPhase('falling'); r.combo = 0; setCombo(0)
            }
          }
        } else { r.fallStart = null }
      }

      // bat collision
      for (const bat of r.bats) {
        if (Math.hypot(bat.x - cp.x, bat.y - cp.y) < BAT_SIZE && !cp.falling && r.phase === 'playing') {
          if (cp.hasShield) {
            cp = { ...cp, hasShield: false, shieldUsedAt: t }
            sfxRef.current('shield', 0.6, 0.8); effectsRef.current.triggerFlash('#38bdf8')
          } else {
            cp = { ...cp, falling: true, fallV: 150, standId: null }
            r.phase = 'falling'; setPhase('falling'); effectsRef.current.triggerFlash('#ef4444')
          }
        }
      }

      // fireball collision
      for (const fb of r.fireballs) {
        if (Math.hypot(fb.x - cp.x, fb.y - cp.y) < FIREBALL_SIZE + 10 && !cp.falling && r.phase === 'playing') {
          if (cp.hasShield) {
            cp = { ...cp, hasShield: false, shieldUsedAt: t }
            sfxRef.current('shield', 0.6, 0.8); effectsRef.current.triggerFlash('#38bdf8')
          } else {
            cp = { ...cp, falling: true, fallV: 100, standId: null }
            r.phase = 'falling'; setPhase('falling'); effectsRef.current.triggerFlash('#ff4500')
          }
        }
      }

      // eruption damage
      for (const er of r.eruptions) {
        const prog = (t - er.startAt) / ERUPT_DUR
        if (prog > 0.2 && prog < 0.8 && cp.x >= er.x && cp.x <= er.x + ERUPT_W && cp.y + PLAYER_R >= effectiveLavaY - 50) {
          if (!cp.falling && r.phase === 'playing') {
            if (cp.hasShield) {
              cp = { ...cp, hasShield: false, shieldUsedAt: t }
              sfxRef.current('shield', 0.6, 0.8); effectsRef.current.triggerFlash('#38bdf8')
            } else {
              cp = { ...cp, falling: true, fallV: 200, standId: null }
              r.phase = 'falling'; setPhase('falling'); effectsRef.current.triggerFlash('#ef4444')
            }
          }
        }
      }

      // gravity
      if (cp.falling) {
        const ds = dt / 1000
        const nv = cp.fallV + GRAVITY * ds
        const ny = cp.y + nv * ds
        cp = { ...cp, y: ny, fallV: nv }
        if (ny + PLAYER_R >= effectiveLavaY) {
          r.phase = 'finished'; setPhase('finished')
          sfxRef.current('fall', 0.6, 0.9); sfxRef.current('gameOver', 0.5, 0.8)
          effectsRef.current.triggerFlash('#ff4500'); effectsRef.current.triggerShake(8, 600)
          finishRef.current(); rafRef.current = null; r.player = cp; setPlayer(cp); return
        }
      }

      // trail
      r.trail = r.trail.map(t => ({ ...t, age: t.age + dt })).filter(t => t.age < 350)
      setTrail([...r.trail])

      r.player = cp; setPlayer(cp)
      effectsRef.current.updateParticles()
      rafRef.current = window.requestAnimationFrame(step)
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }
      lastFrameRef.current = null; effectsRef.current.cleanup()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const t = elapsed
  const effectiveLavaY = LAVA_Y - lavaRiseOffset - lavaWaveExtra
  const comboLbl = getComboLabel(combo)
  const comboClr = getComboColor(combo)

  return (
    <section
      className="mini-game-panel lf-panel"
      aria-label="lava-floor-game"
      onClick={() => { if (player.jumping && player.doubleJumpReady) handleDoubleJump() }}
      style={{ maxWidth: '432px', width: '100%', height: '100%', margin: '0 auto', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{`
        .lf-panel {
          background: #0c0a14;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
          image-rendering: pixelated;
          font-family: 'Press Start 2P', 'Courier New', monospace;
        }
        .lf-hud {
          display: flex; justify-content: space-between; align-items: center;
          padding: 14px 16px;
          background: linear-gradient(180deg, rgba(249,115,22,0.25) 0%, rgba(249,115,22,0.05) 100%);
          border-bottom: 3px solid #f97316;
          flex-shrink: 0;
          image-rendering: auto;
        }
        .lf-avatar { width: 64px; height: 64px; border: 3px solid #f97316; image-rendering: pixelated; flex-shrink: 0; }
        .lf-score-num { font-size: clamp(48px, 14vw, 72px); font-weight: 900; color: #f97316; margin: 0; line-height: 1; text-shadow: 4px 4px 0 #7c2d12, 0 0 20px rgba(249,115,22,0.5); transform: translateY(4px); }
        .lf-best-txt { font-size: 16px; color: #9ca3af; margin: 0; letter-spacing: 1px; }
        .lf-time-txt { font-size: 28px; font-weight: 700; color: #e5e7eb; margin: 0; }
        .lf-stats { display: flex; justify-content: center; align-items: center; gap: 14px; font-size: 18px; color: #d4d4d8; padding: 8px 0; flex-shrink: 0; letter-spacing: 0.5px; background: rgba(0,0,0,0.2); }
        .lf-svg { width: 100%; flex: 1; min-height: 0; display: block; image-rendering: pixelated; }
        .lf-warn { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 64px; font-weight: 900; color: #ef4444; text-shadow: 4px 4px 0 #7f1d1d; animation: lf-pulse 0.25s ease-in-out infinite alternate; z-index: 15; }
        @keyframes lf-pulse { from { opacity: 0.6; transform: translate(-50%, -50%) scale(1); } to { opacity: 1; transform: translate(-50%, -50%) scale(1.2); } }
        .lf-fever { text-align: center; padding: 6px 0; font-size: 26px; font-weight: 900; color: #fbbf24; text-shadow: 3px 3px 0 #92400e; animation: lf-fblink 0.2s infinite alternate; letter-spacing: 3px; flex-shrink: 0; background: rgba(251,191,36,0.1); }
        @keyframes lf-fblink { from { opacity: 0.7; } to { opacity: 1; } }
        .lf-powerup-inline { font-size: 22px; display: flex; align-items: center; gap: 4px; }
        .lf-djump-hint { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); font-size: 16px; color: #9ca3af; z-index: 5; letter-spacing: 1px; text-shadow: 1px 1px 0 rgba(0,0,0,0.5); }
        .lf-wave-warn { position: absolute; bottom: 80px; left: 50%; transform: translateX(-50%); font-size: 28px; font-weight: 900; color: #ff4500; text-shadow: 3px 3px 0 #7f1d1d; animation: lf-pulse 0.2s ease-in-out infinite alternate; z-index: 15; margin: 0; }
        .lf-quake-warn { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); font-size: 32px; font-weight: 900; color: #a16207; text-shadow: 3px 3px 0 #451a03; animation: lf-pulse 0.15s ease-in-out infinite alternate; z-index: 15; margin: 0; letter-spacing: 3px; }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="lf-hud">
        <img src={characterSprite} alt="" className="lf-avatar" />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <p className="lf-score-num">{score}</p>
          <p className="lf-best-txt">BEST {bestDisplay}</p>
        </div>
        <p className="lf-time-txt">{(elapsed / 1000).toFixed(1)}s</p>
      </div>

      <div className="lf-stats">
        <span>LV.<strong style={{ color: '#a78bfa' }}>{level}</strong></span>
        <span>CMB <strong style={{ color: '#fbbf24' }}>{combo}</strong></span>
        <span>COIN <strong style={{ color: '#fbbf24' }}>{coins}</strong></span>
        {comboLbl && <span style={{ color: comboClr, fontWeight: 900 }}>{comboLbl}</span>}
        <span className="lf-powerup-inline">
          {player.hasShield && '🛡'}
          {player.hasMagnet && '🧲'}
          {hasDoubleScore && <strong style={{ color: '#f59e0b' }}>x2 {(doubleScoreRemMs / 1000).toFixed(0)}s</strong>}
        </span>
      </div>
      {isFever && <div className="lf-fever">FEVER x{FEVER_MULT} ({(feverRemMs / 1000).toFixed(1)}s)</div>}

      <svg className="lf-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" aria-label="stage" shapeRendering="crispEdges">
        {/* BG: dark pixel grid */}
        <rect x="0" y="0" width={VW} height={VH} fill="#0c0a14" />
        {/* subtle grid lines */}
        {Array.from({ length: Math.ceil(VW / 16) }, (_, i) => (
          <line key={`gv${i}`} x1={i * 16} y1={0} x2={i * 16} y2={VH} stroke="#1a1828" strokeWidth={1} />
        ))}
        {Array.from({ length: Math.ceil(VH / 16) }, (_, i) => (
          <line key={`gh${i}`} x1={0} y1={i * 16} x2={VW} y2={i * 16} stroke="#1a1828" strokeWidth={1} />
        ))}

        {/* bg glow near lava */}
        <rect x={0} y={effectiveLavaY - 80} width={VW} height={80} fill="url(#lf-glow2)" />
        <defs>
          <linearGradient id="lf-glow2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff4500" stopOpacity="0" />
            <stop offset="100%" stopColor="#ff4500" stopOpacity={isFever ? '0.35' : '0.2'} />
          </linearGradient>
        </defs>

        {/* embers rising from lava */}
        {Array.from({ length: 10 }, (_, i) => {
          const ex = ((i * 37 + t * 0.012) % VW)
          const ey = effectiveLavaY - 20 - ((t * 0.035 + i * 70) % (VH * 0.5))
          const s = snap(2 + Math.sin(t / 250 + i * 1.3) * 2)
          return <PixelRect key={`em${i}`} x={ex} y={ey} w={s} h={s} fill={i % 3 === 0 ? '#ff6a00' : i % 3 === 1 ? '#ff9500' : '#ffcc00'} opacity={0.25 + Math.sin(t / 200 + i) * 0.15} />
        })}

        {/* eruption hazards */}
        {eruptions.map((er, i) => {
          const prog = clamp((t - er.startAt) / ERUPT_DUR, 0, 1)
          const intensity = prog < 0.3 ? prog / 0.3 : prog > 0.7 ? (1 - prog) / 0.3 : 1
          return (
            <g key={`er${i}`}>
              <PixelRect x={er.x} y={effectiveLavaY - 70 * intensity} w={ERUPT_W} h={70 * intensity} fill="#ff4500" opacity={0.25 + intensity * 0.3} />
              {intensity > 0.3 && Array.from({ length: 6 }, (_, j) => (
                <PixelRect key={j} x={er.x + j * 7} y={effectiveLavaY - 60 * intensity + Math.sin(t / 80 + j * 3) * 8} w={PX * 2} h={PX * 2} fill={j % 2 === 0 ? '#ff6a00' : '#ffcc00'} opacity={intensity * 0.9} />
              ))}
            </g>
          )
        })}

        {/* platforms */}
        {platforms.map(pl => {
          const op = platOpacity(pl, t)
          const isBlink = blinking(pl, t)
          const rem = pl.lifeMs - (t - pl.spawnAt)
          const lr = clamp(rem / pl.lifeMs, 0, 1)
          const px = movingX(pl, t)
          const col = platColor(pl, lr, isFever)
          const coinOk = pl.hasCoin && !collected.has(pl.id)
          const shieldOk = pl.hasShield && !collected.has(pl.id + 100000)
          const magnetOk = pl.hasMagnet && !collected.has(pl.id + 200000)
          const dscoreOk = pl.hasDoubleScore && !collected.has(pl.id + 300000)

          return (
            <g key={pl.id} opacity={op}>
              <BrickPlatform x={px} y={pl.y} w={pl.w} h={PLAT_H} color={col} opacity={1} isBlinking={isBlink} />

              {/* type label */}
              {pl.type === 'spring' && <text x={px + pl.w / 2} y={pl.y + PLAT_H - 1} textAnchor="middle" fontSize="8" fill="#fff" fontFamily="monospace" pointerEvents="none">▲</text>}
              {pl.type === 'moving' && <text x={px + pl.w / 2} y={pl.y + PLAT_H - 1} textAnchor="middle" fontSize="8" fill="#fff" fontFamily="monospace" pointerEvents="none">◆</text>}
              {pl.type === 'crumble' && (
                <g pointerEvents="none">{Array.from({ length: 3 }, (_, ci) => (
                  <line key={ci} x1={px + pl.w * (0.2 + ci * 0.25)} y1={pl.y + 2} x2={px + pl.w * (0.3 + ci * 0.25)} y2={pl.y + PLAT_H - 2} stroke="rgba(0,0,0,0.3)" strokeWidth={1} />
                ))}</g>
              )}
              {pl.type === 'ice' && <PixelRect x={px + 2} y={pl.y + 2} w={pl.w - 4} h={PLAT_H - 4} fill="rgba(255,255,255,0.2)" />}
              {pl.type === 'gold' && <text x={px + pl.w / 2} y={pl.y + PLAT_H - 1} textAnchor="middle" fontSize="8" fill="#92400e" fontFamily="monospace" pointerEvents="none">★</text>}
              {pl.type === 'sink' && <text x={px + pl.w / 2} y={pl.y + PLAT_H - 1} textAnchor="middle" fontSize="8" fill="#fff" fontFamily="monospace" pointerEvents="none">▼</text>}

              {/* items */}
              {coinOk && <PixelCoin cx={px + pl.w / 2} cy={pl.y - COIN_R - 3} t={t} id={pl.id} />}
              {shieldOk && <text x={px + pl.w / 2} y={pl.y - 8} textAnchor="middle" fontSize="12" pointerEvents="none" opacity={0.8 + Math.sin(t / 250 + pl.id) * 0.2}>🛡</text>}
              {magnetOk && <text x={px + pl.w / 2} y={pl.y - 8} textAnchor="middle" fontSize="12" pointerEvents="none" opacity={0.8 + Math.sin(t / 250 + pl.id) * 0.2}>🧲</text>}
              {dscoreOk && <text x={px + pl.w / 2} y={pl.y - 8} textAnchor="middle" fontSize="12" pointerEvents="none" opacity={0.8 + Math.sin(t / 200 + pl.id) * 0.2}>✕2</text>}

              {/* tap target */}
              <rect x={px - 16} y={pl.y - 28} width={pl.w + 32} height={PLAT_H + 56} fill="transparent"
                onPointerDown={e => { e.preventDefault(); e.stopPropagation(); handleTap(pl) }} style={{ cursor: 'pointer' }} />
            </g>
          )
        })}

        {/* fire bats */}
        {bats.map(bat => <PixelBat key={bat.id} bat={bat} t={t} />)}

        {/* fireballs */}
        {fireballs.map(fb => {
          const fx = snap(fb.x)
          const fy = snap(fb.y)
          const flicker = Math.sin(t / 50 + fb.id) * 2
          return (
            <g key={`fb${fb.id}`}>
              <rect x={fx - 6} y={fy - 4 + flicker} width={12} height={8} fill="#ff4500" shapeRendering="crispEdges" />
              <rect x={fx - 4} y={fy - 6 + flicker} width={8} height={12} fill="#ff6a00" shapeRendering="crispEdges" />
              <rect x={fx - 2} y={fy - 2 + flicker} width={4} height={4} fill="#fbbf24" shapeRendering="crispEdges" />
            </g>
          )
        })}

        {/* jump trail */}
        {trail.map((tr, i) => {
          const s = snap(6 * (1 - tr.age / 350))
          return <PixelRect key={`tr${i}`} x={tr.x - s / 2} y={tr.y - s / 2} w={s} h={s} fill={isFever ? '#fbbf24' : '#f97316'} opacity={0.5 * (1 - tr.age / 350)} />
        })}

        {/* magnet range indicator */}
        {player.hasMagnet && !player.falling && phase === 'playing' && (
          <circle cx={player.x} cy={player.y} r={MAGNET_RANGE} fill="none" stroke="#c084fc" strokeWidth={1} strokeDasharray="4 4" opacity={0.3 + Math.sin(t / 200) * 0.15} />
        )}

        {/* player */}
        {phase !== 'finished' && (
          <g>
            {/* pixel shadow */}
            <PixelRect x={player.x - 10} y={player.y + PLAYER_R} w={20} h={PX} fill="rgba(0,0,0,0.3)" />
            {/* shield aura */}
            {player.hasShield && (
              <rect x={player.x - CHAR_SIZE / 2 - 4} y={player.y - CHAR_SIZE / 2 - 4} width={CHAR_SIZE + 8} height={CHAR_SIZE + 8} fill="none" stroke="#38bdf8" strokeWidth={2} strokeDasharray="4 4" opacity={0.5 + Math.sin(t / 150) * 0.3} shapeRendering="crispEdges" />
            )}
            {/* character */}
            <image
              href={characterSprite}
              x={player.x - CHAR_SIZE / 2}
              y={player.y - CHAR_SIZE / 2}
              width={CHAR_SIZE}
              height={CHAR_SIZE}
              preserveAspectRatio="xMidYMid meet"
              transform={player.facingRight ? '' : `scale(-1,1) translate(${-player.x * 2},0)`}
              style={{
                imageRendering: 'pixelated',
                filter: isFever ? 'drop-shadow(0 0 6px #fbbf24)' : player.hasShield ? 'drop-shadow(0 0 4px #38bdf8)' : player.hasMagnet ? 'drop-shadow(0 0 4px #c084fc)' : 'drop-shadow(0 2px 3px rgba(0,0,0,0.6))',
              }}
            />
            {/* double-jump sparkle when ready in air */}
            {player.jumping && player.doubleJumpReady && (
              <g>
                <PixelRect x={player.x - 3} y={player.y + CHAR_SIZE / 2 + 2} w={6} h={PX} fill="#fbbf24" opacity={0.5 + Math.sin(t / 100) * 0.3} />
                <PixelRect x={player.x - PX / 2} y={player.y + CHAR_SIZE / 2 + 6} w={PX} h={PX} fill="#f97316" opacity={0.4 + Math.sin(t / 120 + 1) * 0.3} />
              </g>
            )}
          </g>
        )}

        {/* fallen in lava */}
        {phase === 'finished' && (
          <image
            href={characterSprite}
            x={player.x - CHAR_SIZE * 0.3}
            y={effectiveLavaY - CHAR_SIZE * 0.3}
            width={CHAR_SIZE * 0.6}
            height={CHAR_SIZE * 0.6}
            preserveAspectRatio="xMidYMid meet"
            opacity={0.4}
            style={{ imageRendering: 'pixelated' }}
          />
        )}

        {/* lava — pixel blocks */}
        {Array.from({ length: Math.ceil(VW / 8) }, (_, i) => {
          const lx = i * 8
          const waveY = effectiveLavaY + Math.sin((t / 300 + i * 0.6) * Math.PI) * 4
          return (
            <g key={`lv${i}`}>
              <PixelRect x={lx} y={snap(waveY)} w={8} h={VH - snap(waveY)} fill={i % 3 === 0 ? '#cc2200' : i % 3 === 1 ? '#ff4500' : '#ff6a00'} />
              <PixelRect x={lx} y={snap(waveY)} w={8} h={4} fill={i % 2 === 0 ? '#ffaa00' : '#ff8800'} opacity={0.8} />
            </g>
          )
        })}

        {/* lava bubbles */}
        {Array.from({ length: 6 }, (_, i) => {
          const bx = snap((i * 61 + t * 0.018) % VW)
          const by = snap(effectiveLavaY + 12 + Math.sin(t / 400 + i * 1.2) * 8)
          return <PixelRect key={`bb${i}`} x={bx} y={by} w={PX * 2} h={PX * 2} fill="#ffcc00" opacity={0.5 + Math.sin(t / 250 + i) * 0.2} />
        })}
      </svg>

      {phase === 'falling' && <p className="lf-warn">DANGER!</p>}

      {lavaWaveExtra > 10 && <p className="lf-wave-warn">LAVA WAVE!</p>}
      {isEarthquake && <p className="lf-quake-warn">EARTHQUAKE!</p>}

      {player.jumping && player.doubleJumpReady && (
        <div className="lf-djump-hint">TAP FOR DOUBLE JUMP!</div>
      )}

    </section>
  )
}

export const lavaFloorModule: MiniGameModule = {
  manifest: {
    id: 'lava-floor',
    title: 'Lava Floor',
    description: 'The floor is lava! Jump to the platforms!',
    unlockCost: 35,
    baseReward: 13,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: LavaFloorGame,
}
