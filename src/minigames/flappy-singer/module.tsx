import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import flapSfxUrl from '../../../assets/sounds/flappy-singer-flap.mp3'
import scoreSfxUrl from '../../../assets/sounds/flappy-singer-score.mp3'
import coinSfxUrl from '../../../assets/sounds/flappy-singer-coin.mp3'
import crashSfxUrl from '../../../assets/sounds/flappy-singer-crash.mp3'
import feverSfxUrl from '../../../assets/sounds/flappy-singer-fever.mp3'
import powerupSfxUrl from '../../../assets/sounds/flappy-singer-powerup.mp3'
import nearmissSfxUrl from '../../../assets/sounds/flappy-singer-nearmiss.mp3'
import milestoneSfxUrl from '../../../assets/sounds/flappy-singer-milestone.mp3'
import magnetSfxUrl from '../../../assets/sounds/flappy-singer-magnet.mp3'
import lifelostSfxUrl from '../../../assets/sounds/flappy-singer-lifelost.mp3'
import streakSfxUrl from '../../../assets/sounds/flappy-singer-streak.mp3'
import windSfxUrl from '../../../assets/sounds/flappy-singer-wind.mp3'
import goldenSfxUrl from '../../../assets/sounds/flappy-singer-golden.mp3'

// ─── Character Pool ─────────────────────────────────────────
const CHARACTER_SPRITES = [kimYeonjaSprite, parkSangminSprite, parkWankyuSprite, seoTaijiSprite]

// ─── Game Constants ──────────────────────────────────────────
const VW = 288
const VH = 512

const GRAVITY = 0.0013
const FLAP_VELOCITY = -0.40
const MAX_FALL_VELOCITY = 0.55
const CHAR_X = 72
const CHAR_SIZE = 40
const HITBOX_SHRINK = 7

const PIPE_W = 44
const PIPE_SPEED_BASE = 0.13
const PIPE_INTERVAL_MS = 1700
const INITIAL_GAP = 148
const MIN_GAP = 90
const GAP_SHRINK = 1.5
const PIPE_MIN_TOP = 55
const PIPE_CAP_H = 12
const PIPE_CAP_OH = 4

const GROUND_H = 40
const TIMEOUT_MS = 120000

const PIPE_SPEED_INC = 0.0025
const MAX_PIPE_SPEED = 0.28

const COIN_R = 9
const COIN_SCORE = 3
const COIN_CHANCE = 0.55

// ─── HP System ──────────────────────────────────────────────
const MAX_HP = 3
const INVINCIBLE_MS = 1500

// ─── Combo streak ───────────────────────────────────────────
const STREAK_THRESHOLDS = [5, 10, 15, 20, 30]
const STREAK_LABELS = ['NICE!', 'GREAT!', 'AWESOME!', 'AMAZING!', 'GODLIKE!']

// ─── Multiplier ─────────────────────────────────────────────
const MULTI_TRIGGER = 10
const MULTI_DURATION = 5
const MULTI_VALUE = 2

// ─── Power-ups ──────────────────────────────────────────────
const PU_CHANCE = 0.18
const SHIELD_DUR = 6000
const MAGNET_DUR = 8000
const MAGNET_RANGE = 100
const PU_SIZE = 18
const STAR_PU_SCORE = 5

// ─── Near-miss ──────────────────────────────────────────────
const NM_THRESHOLD = 12
const NM_BONUS = 2

// ─── Moving pipe ────────────────────────────────────────────
const MOVING_START = 12
const MOVING_CHANCE = 0.25
const MOVING_SPEED = 0.03
const MOVING_RANGE = 40

// ─── Golden pipe ────────────────────────────────────────────
const GOLDEN_START = 8
const GOLDEN_CHANCE = 0.12
const GOLDEN_BONUS = 3

// ─── Wind zones ─────────────────────────────────────────────
const WIND_START = 20
const WIND_CHANCE = 0.15
const WIND_FORCE = 0.0004
const WIND_ZONE_W = 60
const WIND_ZONE_H = 120

// ─── Milestones ─────────────────────────────────────────────
const MILESTONES = [10, 25, 50, 75, 100]

// ─── Time-of-day ────────────────────────────────────────────
const SUNSET_AT = 15
const NIGHT_AT = 30

// ─── Mountains (parallax) ───────────────────────────────────
const MOUNTAINS = [
  { x: 0, h: 80, w: 120, speed: 0.008 },
  { x: 100, h: 65, w: 90, speed: 0.008 },
  { x: 220, h: 55, w: 100, speed: 0.008 },
  { x: 50, h: 45, w: 80, speed: 0.012 },
  { x: 160, h: 50, w: 110, speed: 0.012 },
  { x: 270, h: 40, w: 85, speed: 0.012 },
]

// ─── Clouds ─────────────────────────────────────────────────
const CLOUDS = [
  { x: 30, y: 50, w: 55, h: 18, speed: 0.02 },
  { x: 150, y: 100, w: 45, h: 16, speed: 0.015 },
  { x: 240, y: 170, w: 60, h: 20, speed: 0.025 },
  { x: 80, y: 270, w: 50, h: 18, speed: 0.018 },
  { x: 200, y: 350, w: 52, h: 18, speed: 0.022 },
]

const STARS = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 59 + 13) % VW,
  y: (i * 41 + 19) % (VH - GROUND_H - 80) + 16,
  s: 2 + (i % 2),
}))

// ─── Types ──────────────────────────────────────────────────
type PUType = 'shield' | 'magnet' | 'star'

interface Pipe {
  readonly id: number
  x: number
  readonly gapTop: number
  readonly gapBottom: number
  scored: boolean
  readonly moving: boolean
  moveOffset: number
  movePhase: number
  nearMissAwarded: boolean
  readonly golden: boolean
}

interface Coin {
  readonly id: number
  x: number
  y: number
  collected: boolean
}

interface PowerUp {
  readonly id: number
  x: number
  readonly y: number
  readonly type: PUType
  collected: boolean
}

interface WindZone {
  readonly id: number
  x: number
  readonly y: number
  readonly direction: 1 | -1
}

interface NoteTrail {
  readonly id: number
  x: number
  y: number
  opacity: number
  readonly note: string
}

interface SpeedLine {
  readonly id: number
  x: number
  readonly y: number
  readonly length: number
  opacity: number
}

interface DeathPixel {
  readonly id: number
  x: number
  y: number
  vx: number
  vy: number
  readonly color: string
  readonly size: number
  life: number
}

// ─── Pure helpers ───────────────────────────────────────────
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }
function gapH(score: number) { return Math.max(MIN_GAP, INITIAL_GAP - score * GAP_SHRINK) }

function mkPipe(id: number, score: number): Pipe {
  const gap = gapH(score)
  const maxTop = VH - GROUND_H - gap - PIPE_MIN_TOP
  const gapTop = PIPE_MIN_TOP + Math.random() * Math.max(0, maxTop - PIPE_MIN_TOP)
  const mov = score >= MOVING_START && Math.random() < MOVING_CHANCE
  const gold = score >= GOLDEN_START && Math.random() < GOLDEN_CHANCE
  return {
    id, x: VW + PIPE_W,
    gapTop, gapBottom: gapTop + gap,
    scored: false,
    moving: mov,
    moveOffset: mov ? (Math.random() - 0.5) * 2 * MOVING_RANGE : 0,
    movePhase: Math.random() * Math.PI * 2,
    nearMissAwarded: false,
    golden: gold,
  }
}

function hitTest(cy: number, pipes: Pipe[]): boolean {
  const t = cy - CHAR_SIZE / 2 + HITBOX_SHRINK
  const b = cy + CHAR_SIZE / 2 - HITBOX_SHRINK
  const l = CHAR_X - CHAR_SIZE / 2 + HITBOX_SHRINK
  const r = CHAR_X + CHAR_SIZE / 2 - HITBOX_SHRINK
  if (t <= 0 || b >= VH - GROUND_H) return true
  for (const p of pipes) {
    if (r > p.x && l < p.x + PIPE_W) {
      const gt = p.gapTop + (p.moving ? p.moveOffset : 0)
      const gb = p.gapBottom + (p.moving ? p.moveOffset : 0)
      if (t < gt || b > gb) return true
    }
  }
  return false
}

function nearMiss(cy: number, p: Pipe): boolean {
  const gt = p.gapTop + (p.moving ? p.moveOffset : 0)
  const gb = p.gapBottom + (p.moving ? p.moveOffset : 0)
  const t = cy - CHAR_SIZE / 2 + HITBOX_SHRINK
  const b = cy + CHAR_SIZE / 2 - HITBOX_SHRINK
  const dt = t - gt, db = gb - b
  return (dt > 0 && dt < NM_THRESHOLD) || (db > 0 && db < NM_THRESHOLD)
}

function skyCol(s: number) {
  if (s >= NIGHT_AT) return { t: '#0f172a', b: '#1e293b' }
  if (s >= SUNSET_AT) return { t: '#f97316', b: '#fbbf24' }
  return { t: '#7dd3fc', b: '#bae6fd' }
}
function pipeCol(s: number) {
  if (s >= NIGHT_AT) return { body: '#166534', cap: '#14532d', border: '#052e16' }
  if (s >= SUNSET_AT) return { body: '#16a34a', cap: '#15803d', border: '#14532d' }
  return { body: '#22c55e', cap: '#16a34a', border: '#15803d' }
}
function groundCol(s: number) {
  if (s >= NIGHT_AT) return { t: '#365314', b: '#1a2e05', l: '#1a2e05' }
  if (s >= SUNSET_AT) return { t: '#65a30d', b: '#4d7c0f', l: '#3f6212' }
  return { t: '#84cc16', b: '#65a30d', l: '#4d7c0f' }
}
function mtCol(s: number) {
  if (s >= NIGHT_AT) return ['#1e293b', '#0f172a']
  if (s >= SUNSET_AT) return ['#c2410c', '#9a3412']
  return ['#a7f3d0', '#6ee7b7']
}

const PU_COL: Record<PUType, string> = { shield: '#3b82f6', magnet: '#a855f7', star: '#fbbf24' }
const PU_ICON: Record<PUType, string> = { shield: 'S', magnet: 'M', star: '*' }

function pickSprite() { return CHARACTER_SPRITES[Math.floor(Math.random() * CHARACTER_SPRITES.length)] }

function streakLabel(streak: number): string | null {
  for (let i = STREAK_THRESHOLDS.length - 1; i >= 0; i--) {
    if (streak >= STREAK_THRESHOLDS[i]) return STREAK_LABELS[i]
  }
  return null
}

// ─── Game CSS ───────────────────────────────────────────────
const CSS = `
.fs-panel{width:100%;height:100%;max-width:432px;margin:0 auto;overflow:hidden;position:relative;background:#000;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.fs-board{position:relative;width:100%;height:100%}
.fs-svg{display:block;width:100%;height:100%}
.fs-hud{position:absolute;top:8px;left:0;right:0;z-index:10;pointer-events:none;text-align:center}
.fs-score{font-size:clamp(2.5rem,10vw,3.5rem);font-weight:900;color:#fff;text-shadow:3px 3px 0 #1f2937,-1px -1px 0 #1f2937,1px -1px 0 #1f2937,-1px 1px 0 #1f2937;margin:0;line-height:1;font-family:monospace}
.fs-best{font-size:clamp(0.55rem,2.3vw,0.75rem);color:#fbbf24;text-shadow:1px 1px 0 #1f2937;margin:1px 0 0;font-family:monospace}
.fs-hp{display:flex;justify-content:center;gap:2px;margin:3px 0}
.fs-hp-heart{width:16px;height:16px;font-size:14px;line-height:16px;text-align:center;image-rendering:pixelated}
.fs-hp-heart.lost{opacity:0.25}
.fs-streak{font-size:clamp(0.8rem,3.5vw,1.1rem);font-weight:900;color:#f97316;text-shadow:2px 2px 0 #7c2d12;margin:2px 0;font-family:monospace;animation:fs-pulse .4s ease-in-out infinite alternate}
.fs-pu-bar{display:flex;justify-content:center;gap:5px;margin-top:3px}
.fs-pu-ind{display:inline-flex;align-items:center;gap:2px;padding:2px 7px;border-radius:3px;font-size:clamp(0.5rem,2vw,0.65rem);font-weight:800;font-family:monospace;color:#fff;text-shadow:1px 1px 0 rgba(0,0,0,.5);animation:fs-pulse .6s ease-in-out infinite alternate}
.fs-start,.fs-gameover{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:20;pointer-events:none}
.fs-start-txt{font-size:clamp(1.6rem,7vw,2.2rem);font-weight:900;color:#fff;text-shadow:3px 3px 0 #1f2937;font-family:monospace;animation:fs-bounce 1s ease-in-out infinite}
.fs-start-sub{font-size:clamp(0.55rem,2.3vw,0.75rem);color:#e2e8f0;text-shadow:1px 1px 0 #1f2937;margin:6px 0 0;font-family:monospace}
.fs-go-txt{font-size:clamp(2rem,9vw,3rem);font-weight:900;color:#ef4444;text-shadow:3px 3px 0 #1f2937;font-family:monospace;animation:fs-shake .4s ease-out}
.fs-go-score{font-size:clamp(1.2rem,5vw,1.6rem);font-weight:700;color:#fbbf24;text-shadow:2px 2px 0 #1f2937;margin:6px 0 0;font-family:monospace}
.fs-btns{position:absolute;bottom:12px;left:0;right:0;display:flex;justify-content:center;gap:8px;z-index:20}
.fs-btn{padding:8px 18px;font-size:clamp(0.6rem,2.5vw,0.75rem);font-weight:700;border:2px solid #6b7280;border-radius:5px;background:rgba(31,41,55,.85);color:#f9fafb;cursor:pointer;box-shadow:2px 2px 0 #374151;min-height:40px;font-family:monospace}
.fs-btn.ghost{background:rgba(31,41,55,.5);border-color:#4b5563;color:#9ca3af}
.fs-multi{font-size:clamp(0.7rem,3vw,0.9rem);font-weight:800;color:#fbbf24;text-shadow:2px 2px 0 #1f2937;text-align:center;margin:1px 0;font-family:monospace;animation:fs-pulse .5s ease-in-out infinite alternate}
.fs-fever{position:absolute;inset:0;pointer-events:none;z-index:5;border:3px solid rgba(251,191,36,.6);box-shadow:inset 0 0 30px rgba(251,191,36,.15);animation:fs-fglow .8s ease-in-out infinite alternate}
.fs-shield-border{position:absolute;inset:0;pointer-events:none;z-index:5;border:3px solid rgba(59,130,246,.5);box-shadow:inset 0 0 20px rgba(59,130,246,.12);animation:fs-sglow 1s ease-in-out infinite alternate}
.fs-milestone{position:absolute;inset:0;pointer-events:none;z-index:25;display:flex;align-items:center;justify-content:center;animation:fs-ms 1.2s ease-out forwards}
.fs-ms-txt{font-size:clamp(2rem,8vw,3rem);font-weight:900;color:#fbbf24;text-shadow:3px 3px 0 #92400e,0 0 20px rgba(251,191,36,.6);font-family:monospace}
.fs-nm{position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);pointer-events:none;z-index:15;font-size:clamp(0.8rem,3vw,1rem);font-weight:900;color:#22d3ee;text-shadow:2px 2px 0 #0e7490;font-family:monospace;animation:fs-nm .8s ease-out forwards}
.fs-scanline{position:absolute;inset:0;pointer-events:none;z-index:4;background:repeating-linear-gradient(0deg,rgba(0,0,0,0) 0px,rgba(0,0,0,0) 2px,rgba(0,0,0,.06) 2px,rgba(0,0,0,.06) 4px);mix-blend-mode:multiply}
.fs-vignette{position:absolute;inset:0;pointer-events:none;z-index:3;background:radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,.25) 100%)}
.fs-dmg-flash{position:absolute;inset:0;pointer-events:none;z-index:30;animation:fs-dmg .3s ease-out forwards}
@keyframes fs-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes fs-shake{0%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}100%{transform:translateX(0)}}
@keyframes fs-pulse{from{transform:scale(1)}to{transform:scale(1.08)}}
@keyframes fs-fglow{from{border-color:rgba(251,191,36,.4);box-shadow:inset 0 0 20px rgba(251,191,36,.1)}to{border-color:rgba(251,191,36,.8);box-shadow:inset 0 0 40px rgba(251,191,36,.25)}}
@keyframes fs-sglow{from{border-color:rgba(59,130,246,.3)}to{border-color:rgba(59,130,246,.6)}}
@keyframes fs-twinkle{0%,100%{opacity:.3}50%{opacity:1}}
@keyframes fs-ms{0%{opacity:0;transform:scale(.3)}30%{opacity:1;transform:scale(1.15)}60%{transform:scale(.95)}80%{transform:scale(1.02)}100%{opacity:0;transform:scale(1) translateY(-20px)}}
@keyframes fs-nm{0%{opacity:1;transform:translate(-50%,-50%) scale(.5)}40%{opacity:1;transform:translate(-50%,-50%) scale(1.2)}100%{opacity:0;transform:translate(-50%,-80%) scale(.8)}}
@keyframes fs-coin{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.3)}}
@keyframes fs-dmg{0%{background:rgba(239,68,68,.35)}100%{background:transparent}}
`

// ─── Pixel Pipe ─────────────────────────────────────────────
function PPipe({ p, score }: { p: Pipe; score: number }) {
  const c = pipeCol(score)
  const my = p.moving ? p.moveOffset : 0
  const gt = p.gapTop + my, gb = p.gapBottom + my
  const bodyFill = p.golden ? '#fbbf24' : c.body
  const capFill = p.golden ? '#f59e0b' : c.cap
  const borderFill = p.golden ? '#92400e' : c.border
  return (
    <g shapeRendering="crispEdges">
      <rect x={p.x} y={0} width={PIPE_W} height={Math.max(0, gt)} fill={bodyFill} stroke={borderFill} strokeWidth="1.5" />
      <rect x={p.x - PIPE_CAP_OH} y={gt - PIPE_CAP_H} width={PIPE_W + PIPE_CAP_OH * 2} height={PIPE_CAP_H} fill={capFill} stroke={borderFill} strokeWidth="1.5" />
      <rect x={p.x + 4} y={2} width={4} height={Math.max(0, gt - PIPE_CAP_H - 4)} fill="rgba(255,255,255,.18)" />
      <rect x={p.x + 10} y={2} width={2} height={Math.max(0, gt - PIPE_CAP_H - 4)} fill="rgba(255,255,255,.08)" />
      {/* Brick pattern every 16px */}
      {Array.from({ length: Math.floor(gt / 16) }, (_, i) => (
        <line key={`bt-${i}`} x1={p.x} y1={i * 16} x2={p.x + PIPE_W} y2={i * 16} stroke={borderFill} strokeWidth="0.5" opacity="0.3" />
      ))}
      <rect x={p.x} y={gb} width={PIPE_W} height={Math.max(0, VH - GROUND_H - gb)} fill={bodyFill} stroke={borderFill} strokeWidth="1.5" />
      <rect x={p.x - PIPE_CAP_OH} y={gb} width={PIPE_W + PIPE_CAP_OH * 2} height={PIPE_CAP_H} fill={capFill} stroke={borderFill} strokeWidth="1.5" />
      <rect x={p.x + 4} y={gb + PIPE_CAP_H + 2} width={4} height={Math.max(0, VH - GROUND_H - gb - PIPE_CAP_H - 4)} fill="rgba(255,255,255,.18)" />
      {Array.from({ length: Math.floor((VH - GROUND_H - gb) / 16) }, (_, i) => (
        <line key={`bb-${i}`} x1={p.x} y1={gb + i * 16} x2={p.x + PIPE_W} y2={gb + i * 16} stroke={borderFill} strokeWidth="0.5" opacity="0.3" />
      ))}
      {p.moving && (
        <>
          <rect x={p.x + PIPE_W / 2 - 3} y={gt - PIPE_CAP_H - 6} width={6} height={3} fill="#fbbf24" opacity=".7" />
          <rect x={p.x + PIPE_W / 2 - 3} y={gb + PIPE_CAP_H + 3} width={6} height={3} fill="#fbbf24" opacity=".7" />
        </>
      )}
      {p.golden && (
        <rect x={p.x - 1} y={gt} width={PIPE_W + 2} height={gb - gt} fill="rgba(251,191,36,.08)" />
      )}
    </g>
  )
}

// ─── Component ──────────────────────────────────────────────
function FlappySingerGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [charY, setCharY] = useState(VH / 2)
  const [vel, setVel] = useState(0)
  const [pipes, setPipes] = useState<Pipe[]>([])
  const [coins, setCoins] = useState<Coin[]>([])
  const [pups, setPups] = useState<PowerUp[]>([])
  const [winds, setWinds] = useState<WindZone[]>([])
  const [started, setStarted] = useState(false)
  const [over, setOver] = useState(false)
  const [, setTick] = useState(0)
  const [multiActive, setMultiActive] = useState(false)
  const [wingPh, setWingPh] = useState(0)
  const [cloudOff, setCloudOff] = useState(() => CLOUDS.map(() => 0))
  const [mtOff, setMtOff] = useState(() => MOUNTAINS.map(() => 0))
  const [shieldOn, setShieldOn] = useState(false)
  const [magnetOn, setMagnetOn] = useState(false)
  const [notes, setNotes] = useState<NoteTrail[]>([])
  const [slines, setSlines] = useState<SpeedLine[]>([])
  const [msTxt, setMsTxt] = useState<string | null>(null)
  const [nmShow, setNmShow] = useState(false)
  const [gndX, setGndX] = useState(0)
  const [sprite] = useState(pickSprite)
  const [hp, setHp] = useState(MAX_HP)
  const [streak, setStreak] = useState(0)
  const [dmgFlash, setDmgFlash] = useState(false)
  const [deathPx, setDeathPx] = useState<DeathPixel[]>([])
  const [invincible, setInvincible] = useState(false)

  const fx = useGameEffects()

  // ─── Refs ─────────────────────────────────────────────────
  const R = useRef({
    score: 0, charY: VH / 2, vel: 0, pipes: [] as Pipe[], coins: [] as Coin[],
    pups: [] as PowerUp[], winds: [] as WindZone[], started: false, finished: false,
    elapsed: 0, lastFrame: null as number | null, sinceLastPipe: 0, nextId: 0,
    multiLeft: 0, wingPh: 0, cloudOff: CLOUDS.map(() => 0), mtOff: MOUNTAINS.map(() => 0),
    shieldEnd: 0, magnetEnd: 0, notes: [] as NoteTrail[], slines: [] as SpeedLine[],
    trailId: 0, msHit: new Set<number>(), nmTimer: null as ReturnType<typeof setTimeout> | null,
    gndX: 0, hp: MAX_HP, streak: 0, invEnd: 0,
    deathPx: [] as DeathPixel[], raf: null as number | null,
  })

  // ─── Audio refs ───────────────────────────────────────────
  const A = useRef({
    flap: null as HTMLAudioElement | null, score: null as HTMLAudioElement | null,
    coin: null as HTMLAudioElement | null, crash: null as HTMLAudioElement | null,
    fever: null as HTMLAudioElement | null, pu: null as HTMLAudioElement | null,
    nm: null as HTMLAudioElement | null, ms: null as HTMLAudioElement | null,
    mag: null as HTMLAudioElement | null, life: null as HTMLAudioElement | null,
    streak: null as HTMLAudioElement | null, wind: null as HTMLAudioElement | null,
    golden: null as HTMLAudioElement | null,
  })

  const sfx = useCallback((s: HTMLAudioElement | null, vol: number, rate = 1) => {
    if (!s) return; s.currentTime = 0; s.volume = vol; s.playbackRate = rate; void s.play().catch(() => {})
  }, [])

  const finish = useCallback(() => {
    if (R.current.finished) return
    R.current.finished = true; fx.cleanup()
    onFinish({ score: R.current.score, durationMs: R.current.elapsed > 0 ? Math.round(R.current.elapsed) : Math.round(DEFAULT_FRAME_MS) })
  }, [onFinish, fx])

  const flap = useCallback(() => {
    if (R.current.finished) return
    if (!R.current.started) { R.current.started = true; setStarted(true) }
    R.current.vel = FLAP_VELOCITY; setVel(FLAP_VELOCITY)
    sfx(A.current.flap, 0.4, 1.1)
    fx.spawnParticles(3, CHAR_X - 10, R.current.charY + 20)
    const nn = ['♪', '♫', '♬', '♩']
    const t: NoteTrail = { id: R.current.trailId++, x: CHAR_X + 15 + Math.random() * 10, y: R.current.charY - 5 + Math.random() * 10, opacity: 1, note: nn[Math.floor(Math.random() * nn.length)] }
    R.current.notes = [...R.current.notes, t].slice(-8); setNotes([...R.current.notes])
  }, [sfx, fx])

  const tap = useCallback((e: React.PointerEvent | React.MouseEvent) => { e.preventDefault(); flap() }, [flap])
  const rot = useMemo(() => clamp(vel * 120, -30, 70), [vel])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap() }
    }
    window.addEventListener('keydown', kd); return () => window.removeEventListener('keydown', kd)
  }, [flap, onExit])

  useEffect(() => {
    const aa: HTMLAudioElement[] = []
    const ld = (u: string) => { const a = new Audio(u); a.preload = 'auto'; aa.push(a); return a }
    A.current.flap = ld(flapSfxUrl); A.current.score = ld(scoreSfxUrl)
    A.current.coin = ld(coinSfxUrl); A.current.crash = ld(crashSfxUrl)
    A.current.fever = ld(feverSfxUrl); A.current.pu = ld(powerupSfxUrl)
    A.current.nm = ld(nearmissSfxUrl); A.current.ms = ld(milestoneSfxUrl)
    A.current.mag = ld(magnetSfxUrl); A.current.life = ld(lifelostSfxUrl)
    A.current.streak = ld(streakSfxUrl); A.current.wind = ld(windSfxUrl)
    A.current.golden = ld(goldenSfxUrl)
    return () => { fx.cleanup(); for (const a of aa) { a.pause(); a.currentTime = 0 } }
  }, [])

  // ─── Game Loop ────────────────────────────────────────────
  useEffect(() => {
    R.current.lastFrame = null
    const step = (now: number) => {
      const r = R.current
      if (r.finished) { r.raf = null; return }
      if (r.lastFrame === null) r.lastFrame = now
      const dt = Math.min(now - r.lastFrame, MAX_FRAME_DELTA_MS)
      r.lastFrame = now

      r.wingPh = (r.wingPh + dt * 0.008) % (Math.PI * 2); setWingPh(r.wingPh)

      // Cloud & mountain scroll
      r.cloudOff = r.cloudOff.map((o, i) => { const n = o + CLOUDS[i].speed * dt; return n > VW + CLOUDS[i].w ? -CLOUDS[i].w : n })
      setCloudOff([...r.cloudOff])
      r.mtOff = r.mtOff.map((o, i) => { const n = o + MOUNTAINS[i].speed * dt; return n > VW + MOUNTAINS[i].w ? -MOUNTAINS[i].w : n })
      setMtOff([...r.mtOff])

      if (!r.started) { r.raf = requestAnimationFrame(step); return }

      r.elapsed += dt; setTick(r.elapsed); fx.updateParticles()
      if (r.elapsed >= TIMEOUT_MS) { setOver(true); finish(); r.raf = null; return }

      // Death pixel update
      if (r.deathPx.length > 0) {
        r.deathPx = r.deathPx.map(px => ({ ...px, x: px.x + px.vx * dt, y: px.y + px.vy * dt, vy: px.vy + 0.001 * dt, life: px.life - dt * 0.002 })).filter(px => px.life > 0)
        setDeathPx([...r.deathPx])
      }

      // Physics
      let nv = Math.min(MAX_FALL_VELOCITY, r.vel + GRAVITY * dt)

      // Wind effect
      for (const w of r.winds) {
        const wl = w.x, wr = w.x + WIND_ZONE_W
        if (CHAR_X > wl && CHAR_X < wr && r.charY > w.y && r.charY < w.y + WIND_ZONE_H) {
          nv += WIND_FORCE * w.direction * dt
        }
      }

      r.vel = nv; setVel(nv)
      const ny = r.charY + nv * dt; r.charY = ny; setCharY(ny)
      const pipeSpd = Math.min(MAX_PIPE_SPEED, PIPE_SPEED_BASE + r.score * PIPE_SPEED_INC)

      r.gndX = (r.gndX + pipeSpd * dt) % 16; setGndX(r.gndX)

      // Speed lines
      if (pipeSpd > 0.19 && Math.random() < 0.15) {
        r.slines = [...r.slines, { id: r.trailId++, x: VW, y: 20 + Math.random() * (VH - GROUND_H - 40), length: 20 + Math.random() * 30, opacity: 0.35 + Math.random() * 0.3 }].slice(-6)
      }
      r.slines = r.slines.map(s => ({ ...s, x: s.x - pipeSpd * dt * 2, opacity: s.opacity - 0.008 })).filter(s => s.opacity > 0 && s.x + s.length > 0)
      setSlines([...r.slines])

      // Note trails
      r.notes = r.notes.map(n => ({ ...n, x: n.x + 0.3, y: n.y - 0.5, opacity: n.opacity - 0.015 })).filter(n => n.opacity > 0)
      setNotes([...r.notes])

      // Power-up timers
      if (r.shieldEnd > 0 && now >= r.shieldEnd) { r.shieldEnd = 0; setShieldOn(false) }
      if (r.magnetEnd > 0 && now >= r.magnetEnd) { r.magnetEnd = 0; setMagnetOn(false) }

      // Invincibility timer
      if (r.invEnd > 0 && now >= r.invEnd) { r.invEnd = 0; setInvincible(false) }

      // Spawning
      r.sinceLastPipe += dt
      const np = [...r.pipes], nc = [...r.coins], npu = [...r.pups], nw = [...r.winds]

      if (r.sinceLastPipe >= PIPE_INTERVAL_MS) {
        r.sinceLastPipe -= PIPE_INTERVAL_MS
        const pipe = mkPipe(r.nextId, r.score); r.nextId++; np.push(pipe)
        if (Math.random() < COIN_CHANCE) {
          const cy = pipe.gapTop + (pipe.gapBottom - pipe.gapTop) / 2
          nc.push({ id: r.nextId + 10000, x: pipe.x + PIPE_W / 2, y: cy, collected: false })
          // Extra coins in arc pattern every 3rd pipe
          if (r.nextId % 3 === 0) {
            const arcN = 3
            for (let ai = 1; ai <= arcN; ai++) {
              nc.push({ id: r.nextId + 10000 + ai, x: pipe.x + PIPE_W / 2 + ai * 18, y: cy - Math.sin(ai / arcN * Math.PI) * 25, collected: false })
            }
          }
        }
        if (Math.random() < PU_CHANCE) {
          const types: PUType[] = ['shield', 'magnet', 'star']
          npu.push({ id: r.nextId + 20000, x: pipe.x + PIPE_W + 30, y: pipe.gapTop + (pipe.gapBottom - pipe.gapTop) * (0.3 + Math.random() * 0.4), type: types[Math.floor(Math.random() * types.length)], collected: false })
        }
        // Wind zone
        if (r.score >= WIND_START && Math.random() < WIND_CHANCE) {
          nw.push({ id: r.nextId + 30000, x: pipe.x + PIPE_W + 40, y: PIPE_MIN_TOP + Math.random() * (VH - GROUND_H - PIPE_MIN_TOP * 2 - WIND_ZONE_H), direction: Math.random() < 0.5 ? 1 : -1 })
          sfx(A.current.wind, 0.3, 1)
        }
      }

      // Move
      const md = pipeSpd * dt
      for (const p of np) { p.x -= md; if (p.moving) { p.movePhase += MOVING_SPEED * dt; p.moveOffset = Math.sin(p.movePhase) * MOVING_RANGE } }
      for (const c of nc) c.x -= md
      for (const pu of npu) pu.x -= md
      for (const w of nw) w.x -= md

      // Magnet
      if (r.magnetEnd > 0) {
        for (const c of nc) {
          if (c.collected) continue
          const dx = CHAR_X - c.x, dy = r.charY - c.y, d = Math.sqrt(dx * dx + dy * dy)
          if (d < MAGNET_RANGE && d > 5) { const pull = 0.12 * dt / d; c.x += dx * pull; c.y += dy * pull }
        }
      }

      // Score pipes
      let ns = r.score, nStreak = r.streak
      for (const p of np) {
        if (!p.scored && p.x + PIPE_W < CHAR_X) {
          p.scored = true
          nStreak++

          // Near-miss
          if (!p.nearMissAwarded && nearMiss(r.charY, p)) {
            p.nearMissAwarded = true; ns += NM_BONUS
            sfx(A.current.nm, 0.5, 1.2)
            fx.showScorePopup(NM_BONUS, CHAR_X, r.charY - 30, '#22d3ee')
            setNmShow(true)
            if (r.nmTimer) clearTimeout(r.nmTimer)
            r.nmTimer = setTimeout(() => setNmShow(false), 800)
          }

          // Golden bonus
          if (p.golden) {
            ns += GOLDEN_BONUS
            sfx(A.current.golden, 0.55, 1)
            fx.showScorePopup(GOLDEN_BONUS, CHAR_X + 20, r.charY - 15, '#fbbf24')
            fx.triggerFlash('rgba(251,191,36,.25)', 150)
          }

          // Multiplier
          if (r.multiLeft > 0) { r.multiLeft--; ns += MULTI_VALUE; if (r.multiLeft <= 0) setMultiActive(false) }
          else { ns += 1 }

          if (ns > 0 && ns % MULTI_TRIGGER === 0 && r.multiLeft <= 0) {
            r.multiLeft = MULTI_DURATION; setMultiActive(true)
            fx.triggerFlash('rgba(251,191,36,.35)', 100); sfx(A.current.fever, 0.55, 1)
          }

          sfx(A.current.score, 0.4, 1 + ns * 0.01)
          fx.comboHitBurst(CHAR_X + 25, r.charY - 25, ns, r.multiLeft > 0 ? MULTI_VALUE : 1)

          // Streak sound
          const sl = streakLabel(nStreak)
          if (sl && !streakLabel(nStreak - 1)) {
            sfx(A.current.streak, 0.5, 1 + nStreak * 0.01)
            fx.triggerFlash('rgba(249,115,22,.2)', 120)
          }
        }
      }

      // Coin collection
      const ct = r.charY - CHAR_SIZE / 2 + HITBOX_SHRINK, cb = r.charY + CHAR_SIZE / 2 - HITBOX_SHRINK
      const cl = CHAR_X - CHAR_SIZE / 2 + HITBOX_SHRINK, cr = CHAR_X + CHAR_SIZE / 2 - HITBOX_SHRINK
      for (const c of nc) {
        if (c.collected) continue
        if (c.x + COIN_R > cl && c.x - COIN_R < cr && c.y + COIN_R > ct && c.y - COIN_R < cb) {
          c.collected = true; ns += COIN_SCORE
          sfx(A.current.coin, 0.5, 1.3)
          fx.showScorePopup(COIN_SCORE, CHAR_X + 15, r.charY - 20, '#fbbf24')
          fx.spawnParticles(4, c.x, c.y)
        }
      }

      // Power-up collection
      for (const pu of npu) {
        if (pu.collected) continue
        if (pu.x + PU_SIZE > cl && pu.x - PU_SIZE < cr && pu.y + PU_SIZE > ct && pu.y - PU_SIZE < cb) {
          pu.collected = true; sfx(A.current.pu, 0.5, 1)
          fx.triggerFlash(PU_COL[pu.type] + '40', 150); fx.spawnParticles(6, pu.x, pu.y)
          if (pu.type === 'shield') { r.shieldEnd = now + SHIELD_DUR; setShieldOn(true) }
          else if (pu.type === 'magnet') { r.magnetEnd = now + MAGNET_DUR; setMagnetOn(true); sfx(A.current.mag, 0.4, 1) }
          else { ns += STAR_PU_SCORE; fx.showScorePopup(STAR_PU_SCORE, pu.x, pu.y - 15, '#fbbf24') }
        }
      }

      // Milestones
      for (const m of MILESTONES) {
        if (ns >= m && !r.msHit.has(m)) {
          r.msHit.add(m); sfx(A.current.ms, 0.6, 1)
          fx.triggerFlash('rgba(251,191,36,.3)', 200); fx.triggerShake(8)
          setMsTxt(`${m} SCORE!`); setTimeout(() => setMsTxt(null), 1200)
        }
      }

      // Filter
      r.pipes = np.filter(p => p.x + PIPE_W > -10); setPipes([...r.pipes])
      r.coins = nc.filter(c => !c.collected && c.x + COIN_R > -10); setCoins([...r.coins])
      r.pups = npu.filter(p => !p.collected && p.x + PU_SIZE > -10); setPups([...r.pups])
      r.winds = nw.filter(w => w.x + WIND_ZONE_W > -10); setWinds([...r.winds])

      if (ns !== r.score) { r.score = ns; setScore(ns) }
      if (nStreak !== r.streak) { r.streak = nStreak; setStreak(nStreak) }

      // Collision
      if (hitTest(ny, r.pipes) && r.invEnd <= 0) {
        if (r.shieldEnd > 0) {
          r.shieldEnd = 0; setShieldOn(false)
          fx.triggerFlash('rgba(59,130,246,.5)', 200); fx.triggerShake(6)
          sfx(A.current.pu, 0.5, 0.8)
          r.vel = FLAP_VELOCITY * 0.7; setVel(FLAP_VELOCITY * 0.7)
        } else {
          r.hp--; setHp(r.hp)
          nStreak = 0; r.streak = 0; setStreak(0)

          if (r.hp <= 0) {
            // Death - spawn pixel explosion
            const colors = ['#ef4444', '#f97316', '#fbbf24', '#22c55e', '#3b82f6', '#a855f7']
            const dpx: DeathPixel[] = Array.from({ length: 16 }, (_, i) => ({
              id: i, x: CHAR_X, y: ny, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
              color: colors[i % colors.length], size: 3 + Math.random() * 4, life: 1,
            }))
            r.deathPx = dpx; setDeathPx(dpx)
            setOver(true); sfx(A.current.crash, 0.65, 0.95)
            fx.triggerShake(16); fx.triggerFlash('rgba(239,68,68,.5)')
            finish(); r.raf = null; return
          } else {
            // Damage but alive
            sfx(A.current.life, 0.55, 1)
            fx.triggerShake(10); setDmgFlash(true)
            setTimeout(() => setDmgFlash(false), 300)
            r.invEnd = now + INVINCIBLE_MS; setInvincible(true)
            r.vel = FLAP_VELOCITY * 0.8; setVel(FLAP_VELOCITY * 0.8)
          }
        }
      }

      r.raf = requestAnimationFrame(step)
    }
    R.current.raf = requestAnimationFrame(step)
    return () => {
      if (R.current.raf !== null) { cancelAnimationFrame(R.current.raf); R.current.raf = null }
      R.current.lastFrame = null
      if (R.current.nmTimer) clearTimeout(R.current.nmTimer)
    }
  }, [finish, sfx, fx])

  const bestDisp = Math.max(bestScore, score)
  const combo = getComboLabel(score)
  const comboC = getComboColor(score)
  const sky = skyCol(score)
  const gnd = groundCol(score)
  const mt = mtCol(score)
  const isNight = score >= NIGHT_AT
  const ws = 0.7 + Math.sin(wingPh) * 0.3
  const sl = streakLabel(streak)

  return (
    <section className="mini-game-panel fs-panel" aria-label="flappy-singer-game" style={fx.getShakeStyle()}>
      <style>{GAME_EFFECTS_CSS}{CSS}</style>

      <div className="fs-board" onPointerDown={tap} role="presentation">
        <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
        <ParticleRenderer particles={fx.particles} />
        <ScorePopupRenderer popups={fx.scorePopups} />

        {/* CRT scanlines + vignette */}
        <div className="fs-scanline" />
        <div className="fs-vignette" />

        {multiActive && <div className="fs-fever" />}
        {shieldOn && <div className="fs-shield-border" />}
        {nmShow && <div className="fs-nm">CLOSE!</div>}
        {dmgFlash && <div className="fs-dmg-flash" />}
        {msTxt && <div className="fs-milestone"><span className="fs-ms-txt">{msTxt}</span></div>}

        <svg className="fs-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice" aria-label="flappy-singer-stage">
          <defs>
            <linearGradient id="fs-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sky.t} /><stop offset="100%" stopColor={sky.b} />
            </linearGradient>
            <linearGradient id="fs-gnd" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gnd.t} /><stop offset="100%" stopColor={gnd.b} />
            </linearGradient>
            <radialGradient id="fs-cg"><stop offset="0%" stopColor="#fde68a" /><stop offset="100%" stopColor="#fbbf24" /></radialGradient>
            <filter id="fs-gl"><feGaussianBlur stdDeviation="2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>

          <rect x="0" y="0" width={VW} height={VH} fill="url(#fs-sky)" />

          {/* Stars (night) - pixel squares */}
          {isNight && STARS.map((st, i) => (
            <rect key={`st-${i}`} x={st.x} y={st.y} width={st.s} height={st.s} fill="#fde68a" opacity="0.7"
              style={{ animation: `fs-twinkle ${1.5 + (i % 4) * 0.5}s ease-in-out infinite`, animationDelay: `${i * 0.15}s` }}
              shapeRendering="crispEdges" />
          ))}

          {/* Parallax mountains */}
          {MOUNTAINS.map((m, i) => {
            const mx = ((m.x + mtOff[i]) % (VW + m.w * 2)) - m.w
            const baseY = VH - GROUND_H
            return (
              <polygon key={`mt-${i}`}
                points={`${mx},${baseY} ${mx + m.w / 2},${baseY - m.h} ${mx + m.w},${baseY}`}
                fill={mt[i < 3 ? 0 : 1]} opacity={i < 3 ? 0.3 : 0.2} shapeRendering="crispEdges" />
            )
          })}

          {/* Clouds - pixel blocks */}
          {CLOUDS.map((cl, i) => {
            const cx = ((cl.x + cloudOff[i]) % (VW + cl.w * 2)) - cl.w
            return (
              <g key={`cl-${i}`} opacity={isNight ? 0.12 : 0.6} shapeRendering="crispEdges">
                <rect x={cx - cl.w / 2} y={cl.y - cl.h / 2} width={cl.w} height={cl.h} fill="#fff" />
                <rect x={cx - cl.w * 0.3} y={cl.y - cl.h * 0.6} width={cl.w * 0.4} height={cl.h * 0.5} fill="#fff" />
                <rect x={cx + cl.w * 0.1} y={cl.y - cl.h * 0.55} width={cl.w * 0.35} height={cl.h * 0.45} fill="#fff" />
              </g>
            )
          })}

          {/* Wind zones */}
          {winds.map(w => (
            <g key={`w-${w.id}`} opacity="0.2" shapeRendering="crispEdges">
              <rect x={w.x} y={w.y} width={WIND_ZONE_W} height={WIND_ZONE_H} fill={w.direction > 0 ? '#ef4444' : '#3b82f6'} rx={2} />
              {Array.from({ length: 4 }, (_, i) => (
                <rect key={i} x={w.x + 10 + i * 12} y={w.y + WIND_ZONE_H / 2 - 1 + w.direction * (i * 3)}
                  width={8} height={2} fill="#fff" opacity="0.5" />
              ))}
              <text x={w.x + WIND_ZONE_W / 2} y={w.y + 12} textAnchor="middle" fontSize="8" fill="#fff" opacity="0.6" fontFamily="monospace">
                {w.direction > 0 ? 'v' : '^'}
              </text>
            </g>
          ))}

          {/* Speed lines */}
          {slines.map(s => (
            <line key={s.id} x1={s.x} y1={s.y} x2={s.x + s.length} y2={s.y} stroke="#fff" strokeWidth="1.5" opacity={s.opacity} />
          ))}

          {/* Note trails */}
          {notes.map(n => (
            <text key={n.id} x={n.x} y={n.y} fontSize="12" fill="#fbbf24" opacity={n.opacity} style={{ filter: 'url(#fs-gl)' }}>{n.note}</text>
          ))}

          {/* Pipes */}
          {pipes.map(p => <PPipe key={p.id} p={p} score={score} />)}

          {/* Coins */}
          {coins.map(c => (
            <g key={`c-${c.id}`} style={{ animation: 'fs-coin 1.2s linear infinite' }}>
              <circle cx={c.x} cy={c.y} r={COIN_R + 3} fill="rgba(251,191,36,.1)" />
              <circle cx={c.x} cy={c.y} r={COIN_R} fill="url(#fs-cg)" stroke="#ca8a04" strokeWidth="1.5" />
              <rect x={c.x - 2} y={c.y - 3} width={3} height={3} fill="rgba(255,255,255,.5)" shapeRendering="crispEdges" />
              <text x={c.x} y={c.y + 1} textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="900" fill="#92400e" fontFamily="monospace">$</text>
            </g>
          ))}

          {/* Power-ups */}
          {pups.map(pu => (
            <g key={`pu-${pu.id}`}>
              <rect x={pu.x - PU_SIZE / 2 - 2} y={pu.y - PU_SIZE / 2 - 2} width={PU_SIZE + 4} height={PU_SIZE + 4}
                fill={PU_COL[pu.type]} opacity=".2" shapeRendering="crispEdges" />
              <rect x={pu.x - PU_SIZE / 2} y={pu.y - PU_SIZE / 2} width={PU_SIZE} height={PU_SIZE}
                fill={PU_COL[pu.type]} stroke="#fff" strokeWidth="1.5" shapeRendering="crispEdges" />
              <text x={pu.x} y={pu.y + 1} textAnchor="middle" dominantBaseline="central" fontSize="10" fontWeight="900" fill="#fff" fontFamily="monospace">
                {PU_ICON[pu.type]}
              </text>
            </g>
          ))}

          {/* Ground */}
          <rect x="0" y={VH - GROUND_H} width={VW} height={GROUND_H} fill="url(#fs-gnd)" shapeRendering="crispEdges" />
          <line x1="0" y1={VH - GROUND_H} x2={VW} y2={VH - GROUND_H} stroke={gnd.l} strokeWidth="2" />
          {Array.from({ length: 24 }, (_, i) => {
            const gx = ((i * 14 - gndX) % (VW + 14)) - 7
            return (
              <g key={`gp-${i}`} shapeRendering="crispEdges">
                <rect x={gx} y={VH - GROUND_H - 2} width={6} height={4} fill={gnd.t} opacity=".6" />
                <rect x={gx + 7} y={VH - GROUND_H + 6} width={4} height={4} fill={gnd.l} opacity=".25" />
                <rect x={gx + 3} y={VH - GROUND_H + 14} width={3} height={3} fill={gnd.l} opacity=".15" />
              </g>
            )
          })}

          {/* Death pixels */}
          {deathPx.map(px => (
            <rect key={`dp-${px.id}`} x={px.x} y={px.y} width={px.size} height={px.size}
              fill={px.color} opacity={px.life} shapeRendering="crispEdges" />
          ))}

          {/* Character */}
          <g transform={`translate(${CHAR_X}, ${charY}) rotate(${rot})`}
            opacity={invincible ? (Math.floor(R.current.elapsed / 80) % 2 === 0 ? 1 : 0.3) : 1}>

            {shieldOn && (
              <circle cx="0" cy="0" r={CHAR_SIZE / 2 + 6} fill="none" stroke="rgba(59,130,246,.5)" strokeWidth="2" strokeDasharray="4 3" opacity=".7">
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            {magnetOn && (
              <circle cx="0" cy="0" r={CHAR_SIZE / 2 + 10} fill="none" stroke="rgba(168,85,247,.35)" strokeWidth="1.5" strokeDasharray="3 5" opacity=".6">
                <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}

            <ellipse cx="0" cy={CHAR_SIZE / 2 + 2} rx={CHAR_SIZE / 3} ry={3} fill="rgba(0,0,0,.1)" />

            {/* Pixel wings */}
            <g transform={`translate(-${CHAR_SIZE / 2 - 3}, -3) scale(1, ${ws})`} shapeRendering="crispEdges">
              <rect x="-10" y="-6" width="4" height="6" fill="rgba(255,255,255,.8)" />
              <rect x="-6" y="-8" width="4" height="4" fill="rgba(255,255,255,.6)" />
              <rect x="-14" y="-4" width="4" height="4" fill="rgba(255,255,255,.5)" />
            </g>
            <g transform={`translate(${CHAR_SIZE / 2 - 3}, -3) scale(1, ${ws})`} shapeRendering="crispEdges">
              <rect x="6" y="-6" width="4" height="6" fill="rgba(255,255,255,.8)" />
              <rect x="2" y="-8" width="4" height="4" fill="rgba(255,255,255,.6)" />
              <rect x="10" y="-4" width="4" height="4" fill="rgba(255,255,255,.5)" />
            </g>

            <image href={sprite} x={-CHAR_SIZE / 2} y={-CHAR_SIZE / 2} width={CHAR_SIZE} height={CHAR_SIZE}
              preserveAspectRatio="xMidYMid meet" style={{ imageRendering: 'pixelated' as any }} />

            {vel < -0.2 && (
              <>
                <text x="16" y="-14" fontSize="10" fill="#fbbf24" opacity=".8" style={{ filter: 'url(#fs-gl)' }}>&#9834;</text>
                <text x="-18" y="-10" fontSize="8" fill="#fb923c" opacity=".6">&#9835;</text>
              </>
            )}

            {/* Streak fire trail */}
            {streak >= 10 && (
              <g opacity=".6">
                <rect x="-6" y={CHAR_SIZE / 2} width="4" height="6" fill="#f97316" shapeRendering="crispEdges">
                  <animate attributeName="opacity" values="1;0.4;1" dur="0.3s" repeatCount="indefinite" />
                </rect>
                <rect x="2" y={CHAR_SIZE / 2 + 2} width="4" height="4" fill="#ef4444" shapeRendering="crispEdges">
                  <animate attributeName="opacity" values="0.5;1;0.5" dur="0.25s" repeatCount="indefinite" />
                </rect>
                <rect x="-2" y={CHAR_SIZE / 2 + 4} width="3" height="5" fill="#fbbf24" shapeRendering="crispEdges">
                  <animate attributeName="opacity" values="0.8;0.3;0.8" dur="0.35s" repeatCount="indefinite" />
                </rect>
              </g>
            )}
          </g>
        </svg>

        {/* HUD */}
        <div className="fs-hud">
          <p className="fs-score">{score}</p>
          <p className="fs-best">BEST {bestDisp}</p>
          <div className="fs-hp">
            {Array.from({ length: MAX_HP }, (_, i) => (
              <span key={i} className={`fs-hp-heart ${i >= hp ? 'lost' : ''}`}>
                {i < hp ? '\u2665' : '\u2661'}
              </span>
            ))}
          </div>
          {multiActive && <p className="fs-multi">x{MULTI_VALUE} FEVER!</p>}
          {sl && <p className="fs-streak">{sl} x{streak}</p>}
          {combo && (
            <p className="ge-combo-label" style={{ fontSize: 'clamp(0.65rem,2.8vw,0.9rem)', color: comboC, textAlign: 'center', margin: '1px 0', textShadow: '1px 1px 0 #1f2937', fontFamily: 'monospace' }}>
              {combo}
            </p>
          )}
          {(shieldOn || magnetOn) && (
            <div className="fs-pu-bar">
              {shieldOn && <span className="fs-pu-ind" style={{ background: 'rgba(59,130,246,.7)' }}>SHIELD</span>}
              {magnetOn && <span className="fs-pu-ind" style={{ background: 'rgba(168,85,247,.7)' }}>MAGNET</span>}
            </div>
          )}
        </div>

        {!started && !over && (
          <div className="fs-start">
            <p className="fs-start-txt">TAP TO FLY!</p>
            <p className="fs-start-sub">Space / Tap to Flap</p>
          </div>
        )}

        {over && (
          <div className="fs-gameover">
            <p className="fs-go-txt">GAME OVER</p>
            <p className="fs-go-score">Score: {score}</p>
          </div>
        )}

        <div className="fs-btns">
          <button className="fs-btn" type="button" onPointerDown={e => e.stopPropagation()}
            onClick={() => { sfx(A.current.score, 0.5, 1); finish() }}>FINISH</button>
          <button className="fs-btn ghost" type="button" onPointerDown={e => e.stopPropagation()}
            onClick={onExit}>EXIT</button>
        </div>
      </div>
    </section>
  )
}

export const flappySingerModule: MiniGameModule = {
  manifest: {
    id: 'flappy-singer',
    title: 'Flappy Singer',
    description: 'Tap to fly through pipes!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#0ea5e9',
  },
  Component: FlappySingerGame,
}
