import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import brickHitSfx from '../../../assets/sounds/breakout-brick-hit.mp3'
import paddleHitSfx from '../../../assets/sounds/breakout-paddle-hit.mp3'
import wallHitSfx from '../../../assets/sounds/breakout-wall-hit.mp3'
import powerupSfx from '../../../assets/sounds/breakout-powerup.mp3'
import comboSfx from '../../../assets/sounds/breakout-combo.mp3'
import stageClearSfx from '../../../assets/sounds/breakout-stage-clear.mp3'
import ballLostSfx from '../../../assets/sounds/breakout-ball-lost.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import breakoutBgmLoop from '../../../assets/sounds/generated/breakout/breakout-bgm-loop.mp3'
import {
  type BreakoutBrickGimmick,
  createBreakoutBrickProfile,
  getShockwaveTargetIds,
  shouldDetachBallFromPad,
} from './gameplay'

// ─── Pixel Grid: all coords snap to PX grid ────────────────
const PX = 2 // pixel size — all units are multiples of this
const snap = (v: number) => Math.round(v / PX) * PX

// ─── Layout: 9:16 full vertical ────────────────────────────
const VW = 360
const VH = 640

// ─── Paddle ─────────────────────────────────────────────────
const PAD_W = 72
const PAD_H = 10
const PAD_Y = VH - 48
const PAD_WIDE_W = 108
const PAD_WIDE_MS = 8000

// ─── Ball ───────────────────────────────────────────────────
const BALL_SZ = 8 // square ball size
const BALL_HALF = BALL_SZ / 2
const BALL_INIT_SPD = 250
const BALL_SPD_INC = 16
const BALL_MAX_SPD = 500
const BALL_MIN_VY = 0.35

// ─── Bricks ─────────────────────────────────────────────────
const BR_ROWS = 6
const BR_COLS = 8
const BR_W = 38
const BR_H = 14
const BR_GAP = 4
const BR_TOP = 76
const BR_LEFT = (VW - (BR_COLS * BR_W + (BR_COLS - 1) * BR_GAP)) / 2

// ─── Config ─────────────────────────────────────────────────
const LIVES = 3
const LAUNCH_MS = 700
const SHAKE_MS = 120
const SHAKE_PX = 4

// ─── Multi-ball ─────────────────────────────────────────────
const MULTI_THRESHOLD = 14
const MAX_EXTRA = 3

// ─── Power-ups ──────────────────────────────────────────────
type PUType = 'wide' | 'fire' | 'slow' | 'life' | 'multi' | 'shield' | 'magnet' | 'bomb'
const PU_CHANCE = 0.22
const PU_SPD = 130
const PU_SZ = 12

const PU_COLORS: Record<PUType, string> = {
  wide: '#50fa7b', fire: '#ff5555', slow: '#8be9fd', life: '#ff79c6',
  multi: '#bd93f9', shield: '#f1fa8c', magnet: '#6272a4', bomb: '#ffb86c',
}
const PU_LABEL: Record<PUType, string> = {
  wide: 'W', fire: 'F', slow: 'S', life: '+', multi: 'M', shield: 'D', magnet: 'G', bomb: 'B',
}
const PU_WEIGHTS: { t: PUType; w: number }[] = [
  { t: 'wide', w: 22 }, { t: 'fire', w: 16 }, { t: 'slow', w: 14 },
  { t: 'life', w: 6 }, { t: 'multi', w: 12 }, { t: 'shield', w: 10 },
  { t: 'magnet', w: 8 }, { t: 'bomb', w: 12 },
]

// ─── Durations ──────────────────────────────────────────────
const FIRE_MS = 6000
const SLOW_MS = 5000
const SLOW_F = 0.55
const MAGNET_MS = 7000
const MAGNET_STR = 200
const SHIELD_Y = VH - 6

// ─── Moving bricks (stage 4+) ──────────────────────────────
const MOVE_STAGE = 4
const MOVE_SPEED = 30

// ─── Pixel Particle ────────────────────────────────────────
const PART_LIFE = 400
const PART_CT = 6
const RING_LIFE = 420
const BGM_VOLUME = 0.24

// ─── Retro Palette (Dracula) ───────────────────────────────
const PAL = {
  bg: '#282a36', bgLight: '#44475a', fg: '#f8f8f2', comment: '#6272a4',
  red: '#ff5555', orange: '#ffb86c', yellow: '#f1fa8c',
  green: '#50fa7b', cyan: '#8be9fd', purple: '#bd93f9', pink: '#ff79c6',
}

const BRICK_PAL: { c: string; pts: number }[] = [
  { c: PAL.red, pts: 50 }, { c: PAL.orange, pts: 40 }, { c: PAL.yellow, pts: 30 },
  { c: PAL.green, pts: 20 }, { c: PAL.cyan, pts: 15 }, { c: PAL.purple, pts: 10 },
]

// ─── Types ──────────────────────────────────────────────────
interface Brick {
  id: number; row: number; col: number; x: number; y: number
  w: number; h: number; baseColor: string; pts: number
  unbr: boolean; maxHp: number; hp: number; alive: boolean; gimmick: BreakoutBrickGimmick
  flash: number; moveDir: number
}
interface Ball { x: number; y: number; vx: number; vy: number; spd: number; on: boolean }
interface Pxl { id: number; x: number; y: number; vx: number; vy: number; c: string; t: number; sz: number }
interface PU { id: number; type: PUType; x: number; y: number; t: number }
interface Trail { x: number; y: number }
interface Ring { id: number; x: number; y: number; c: string; t: number; r: number; w: number }

interface GS {
  bricks: Brick[]; ball: Ball; extras: Ball[]; padX: number
  lives: number; score: number; stage: number; pxls: Pxl[]; ms: number
  launchMs: number; shakeMs: number; nPxl: number; nBrick: number
  consHits: number; totalDest: number
  pus: PU[]; nPU: number
  wideMs: number; fireMs: number; slowMs: number; shieldOn: boolean; magnetMs: number
  combo: number; comboMs: number
  trail: Trail[]; trailMs: number; stageFlashMs: number
  multiplier: number; multiplierMs: number
  rings: Ring[]; nRing: number
}

// ─── Helpers ────────────────────────────────────────────────
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function pickPU(): PUType {
  const tot = PU_WEIGHTS.reduce((s, w) => s + w.w, 0)
  let r = Math.random() * tot
  for (const e of PU_WEIGHTS) { r -= e.w; if (r <= 0) return e.t }
  return 'wide'
}

function makeBricks(stage: number, startId: number): Brick[] {
  const out: Brick[] = []
  let id = startId
  const rows = Math.min(BR_ROWS + Math.floor(stage / 2), 9)
  for (let r = 0; r < rows; r++) {
    const ci = r % BRICK_PAL.length
    const { c, pts } = BRICK_PAL[ci]
    for (let col = 0; col < BR_COLS; col++) {
      if (stage > 1 && (r + col + stage) % 7 === 0) continue
      const x = BR_LEFT + col * (BR_W + BR_GAP)
      const y = BR_TOP + r * (BR_H + BR_GAP)
      const profile = createBreakoutBrickProfile(stage, r, col)
      const moveDir = stage >= MOVE_STAGE && !profile.unbreakable && r % 2 === 0 ? (col % 2 === 0 ? 1 : -1) : 0
      out.push({
        id: id++,
        row: r,
        col,
        x,
        y,
        w: BR_W,
        h: BR_H,
        baseColor: profile.unbreakable ? PAL.comment : c,
        pts: profile.unbreakable ? 0 : (pts + stage * 2) * profile.maxHp,
        unbr: profile.unbreakable,
        maxHp: profile.maxHp,
        hp: profile.maxHp,
        alive: true,
        gimmick: profile.gimmick,
        flash: 0,
        moveDir,
      })
    }
  }
  return out
}

function brickColor(b: Brick): string {
  if (b.unbr) return PAL.comment
  if (b.maxHp > 1 && b.hp > 1) {
    const r = parseInt(b.baseColor.slice(1, 3), 16)
    const g = parseInt(b.baseColor.slice(3, 5), 16)
    const bl = parseInt(b.baseColor.slice(5, 7), 16)
    return `rgb(${r >> 1},${g >> 1},${bl >> 1})`
  }
  return b.baseColor
}

function mkBall(px: number): Ball { return { x: px, y: PAD_Y - BALL_SZ - 1, vx: 0, vy: 0, spd: BALL_INIT_SPD, on: false } }
function launchBall(b: Ball, aimBias = 0) {
  const clampedBias = clamp(aimBias, -0.82, 0.82)
  const a = -Math.PI / 2 + clampedBias * (Math.PI / 4) + (Math.random() - 0.5) * (Math.PI / 10)
  b.vx = Math.cos(a) * b.spd
  b.vy = Math.sin(a) * b.spd
  b.on = true
}

function mkState(): GS {
  const px = VW / 2, bricks = makeBricks(1, 0)
  return {
    bricks,
    ball: mkBall(px),
    extras: [],
    padX: px,
    lives: LIVES,
    score: 0,
    stage: 1,
    pxls: [],
    ms: 0,
    launchMs: LAUNCH_MS,
    shakeMs: 0,
    nPxl: 0,
    nBrick: bricks.length,
    consHits: 0,
    totalDest: 0,
    pus: [],
    nPU: 0,
    wideMs: 0,
    fireMs: 0,
    slowMs: 0,
    shieldOn: false,
    magnetMs: 0,
    combo: 0,
    comboMs: 0,
    trail: [],
    trailMs: 0,
    stageFlashMs: 0,
    multiplier: 1,
    multiplierMs: 0,
    rings: [],
    nRing: 0,
  }
}

function spawnPxl(s: GS, x: number, y: number, c: string, n = PART_CT) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160
    s.pxls.push({ id: s.nPxl++, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c, t: s.ms, sz: PX + Math.floor(Math.random() * 3) * PX })
  }
}

function spawnRing(s: GS, x: number, y: number, c: string, r = 54, w = 4) {
  s.rings.push({ id: s.nRing++, x, y, c, t: s.ms, r, w })
}

function boxHit(rx: number, ry: number, rw: number, rh: number, bx: number, by: number, bs: number): { hit: boolean; nx: number; ny: number } {
  const cx = clamp(bx + bs / 2, rx, rx + rw), cy = clamp(by + bs / 2, ry, ry + rh)
  const dx = (bx + bs / 2) - cx, dy = (by + bs / 2) - cy, d2 = dx * dx + dy * dy, r = bs / 2
  if (d2 > r * r) return { hit: false, nx: 0, ny: 0 }
  const d = Math.sqrt(d2) || 1
  return { hit: true, nx: dx / d, ny: dy / d }
}

function reflect(b: Ball, nx: number, ny: number) {
  const dot = b.vx * nx + b.vy * ny; b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny
  const sp = Math.hypot(b.vx, b.vy) || 1; b.vx = (b.vx / sp) * b.spd; b.vy = (b.vy / sp) * b.spd
}

function ensureVY(b: Ball) {
  const sp = Math.hypot(b.vx, b.vy) || 1
  if (Math.abs(b.vy) / sp < BALL_MIN_VY) {
    const s = b.vy >= 0 ? 1 : -1; b.vy = s * BALL_MIN_VY * b.spd
    b.vx = Math.sign(b.vx || 1) * Math.sqrt(b.spd * b.spd - b.vy * b.vy)
  }
}

// ─── CSS (pixel/retro theme) ────────────────────────────────
const CSS = `
.bo-panel{max-width:432px;width:100%;height:100%;margin:0 auto;overflow:hidden;position:relative;display:flex;flex-direction:column;background:linear-gradient(180deg,#1d1f29 0%,#202231 28%,#161821 100%);image-rendering:pixelated}
.bo-hud{display:flex;align-items:flex-start;justify-content:space-between;padding:8px 10px 4px;z-index:5;flex-shrink:0;gap:8px}
.bo-score-wrap{display:flex;flex-direction:column;gap:2px;padding:4px 6px 5px;border:${PX}px solid rgba(248,248,242,0.16);background:rgba(15,16,22,0.65);box-shadow:0 0 0 ${PX}px rgba(255,184,108,0.14)}
.bo-score-label{font-size:.48rem;letter-spacing:.18em;color:${PAL.orange};margin:0}
.bo-score{font-size:2.25rem;line-height:.95;color:${PAL.yellow};margin:0;text-shadow:0 3px 0 ${PAL.bgLight},0 0 16px rgba(241,250,140,.28)}
.bo-best{font-size:.62rem;color:${PAL.comment};margin:0}
.bo-stage-wrap{display:flex;flex-direction:column;align-items:center;gap:2px;padding-top:3px}
.bo-stage-label{font-size:.48rem;letter-spacing:.18em;color:${PAL.cyan};margin:0}
.bo-stage{font-size:.9rem;color:${PAL.fg};margin:0;padding:4px 10px 3px;border:${PX}px solid rgba(139,233,253,0.3);background:rgba(98,114,164,0.18);box-shadow:0 0 14px rgba(139,233,253,0.12)}
.bo-lives{display:flex;gap:3px}
.bo-board{flex:1;position:relative;overflow:hidden;touch-action:none}
.bo-svg{width:100%;height:100%;display:block;image-rendering:pixelated;image-rendering:crisp-edges}
.bo-pu-bar{display:flex;gap:4px;padding:0 10px 3px;min-height:20px;flex-shrink:0;flex-wrap:wrap}
.bo-pu-badge{font-size:.45rem;padding:1px 6px;border-radius:0;border:${PX}px solid ${PAL.fg};color:${PAL.bg};font-weight:bold}
.bo-combo{position:absolute;top:42%;left:50%;transform:translate(-50%,-50%);font-size:1.9rem;font-weight:bold;pointer-events:none;z-index:10;text-shadow:${PX}px ${PX}px 0 ${PAL.bg},0 0 18px rgba(255,255,255,.16);animation:bo-pop .35s ease-out}
.bo-stg{position:absolute;top:32%;left:50%;transform:translate(-50%,-50%);font-size:2rem;color:${PAL.yellow};font-weight:bold;pointer-events:none;z-index:12;text-shadow:${PX * 2}px ${PX * 2}px 0 ${PAL.bg};animation:bo-pop .5s ease-out}
.bo-mult{position:absolute;top:18%;right:12px;font-size:1.2rem;color:${PAL.orange};font-weight:bold;pointer-events:none;z-index:8;text-shadow:${PX}px ${PX}px 0 ${PAL.bg},0 0 16px rgba(255,184,108,.24);animation:bo-pop .3s ease-out}
@keyframes bo-pop{0%{transform:translate(-50%,-50%) scale(2.5);opacity:0}40%{transform:translate(-50%,-50%) scale(.9);opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}
.bo-scanline{position:absolute;inset:0;pointer-events:none;z-index:20;background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,.06) 3px,rgba(0,0,0,.06) 4px);mix-blend-mode:multiply}
`

function BreakoutMiniGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [rScore, setScore] = useState(0)
  const [rLives, setLives] = useState(LIVES)
  const [rStage, setStage] = useState(1)
  const [rBricks, setBricks] = useState<Brick[]>(() => makeBricks(1, 0))
  const [rBalls, setBalls] = useState<{ x: number; y: number; fire: boolean; mag: boolean }[]>([])
  const [rPadX, setPadX] = useState(VW / 2)
  const [rPadW, setPadW] = useState(PAD_W)
  const [rPxls, setPxls] = useState<Pxl[]>([])
  const [rShkX, setShkX] = useState(0)
  const [rShkY, setShkY] = useState(0)
  const [rPUs, setPUs] = useState<PU[]>([])
  const [rTrail, setTrail] = useState<Trail[]>([])
  const [rCombo, setCombo] = useState(0)
  const [rComboLbl, setComboLbl] = useState('')
  const [rComboClr, setComboClr] = useState('#fff')
  const [rActPU, setActPU] = useState<{ t: PUType; ms: number }[]>([])
  const [rStageBan, setStageBan] = useState(0)
  const [rShield, setShield] = useState(false)
  const [rMult, setMult] = useState(1)
  const [rRings, setRings] = useState<Ring[]>([])
  const [rMs, setMs] = useState(0)

  const effects = useGameEffects({ maxParticles: 64, particleLifetimeMs: 920 })
  const sRef = useRef<GS>(mkState())
  const doneRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef<number | null>(null)
  const ptrRef = useRef<number | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const audRef = useRef<Record<string, HTMLAudioElement | null>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const effectsCleanupRef = useRef(effects.cleanup)

  useEffect(() => {
    effectsCleanupRef.current = effects.cleanup
  }, [effects])

  const sfx = useCallback((k: string, v: number, r = 1) => {
    const a = audRef.current[k]; if (!a) return
    a.currentTime = 0; a.volume = v; a.playbackRate = r; void a.play().catch(() => {})
  }, [])

  const startBgm = useCallback(() => {
    const bgm = bgmRef.current
    if (bgm === null || doneRef.current || !bgm.paused) return
    void bgm.play().catch(() => {})
  }, [])

  const releaseBallFromPad = useCallback((s: GS, motion: number) => {
    if (s.ball.on) return
    s.launchMs = 0
    s.ball.x = s.padX
    s.ball.y = PAD_Y - BALL_SZ - 1
    launchBall(s.ball, motion / PAD_W)
    spawnPxl(s, s.ball.x + BALL_HALF, s.ball.y + BALL_HALF, PAL.cyan, 6)
    spawnRing(s, s.ball.x + BALL_HALF, s.ball.y + BALL_HALF, `${PAL.cyan}bb`, 36, 3)
    effects.spawnParticles(6, s.ball.x + BALL_HALF, s.ball.y + BALL_HALF, ['*', '+', '>'])
    effects.triggerFlash(`${PAL.cyan}3d`, 70)
    effects.advanceBgHue(22)
    sfx('pad', 0.24, 1.14)
  }, [effects, sfx])

  const sync = useCallback((s: GS) => {
    setScore(s.score); setLives(s.lives); setStage(s.stage); setBricks([...s.bricks])
    const pw = s.wideMs > 0 ? PAD_WIDE_W : PAD_W; setPadW(pw)
    const allB = [s.ball, ...s.extras].filter(b => b.on || !s.ball.on)
    setBalls(allB.map(b => ({ x: snap(b.x), y: snap(b.y), fire: s.fireMs > 0, mag: s.magnetMs > 0 })))
    setPadX(snap(s.padX)); setPxls([...s.pxls]); setPUs([...s.pus])
    setTrail([...s.trail]); setCombo(s.combo); setRings([...s.rings]); setMs(s.ms)
    setComboLbl(getComboLabel(s.combo)); setComboClr(getComboColor(s.combo))
    setStageBan(s.stageFlashMs); setShield(s.shieldOn); setMult(s.multiplier)
    const ap: { t: PUType; ms: number }[] = []
    if (s.wideMs > 0) ap.push({ t: 'wide', ms: s.wideMs })
    if (s.fireMs > 0) ap.push({ t: 'fire', ms: s.fireMs })
    if (s.slowMs > 0) ap.push({ t: 'slow', ms: s.slowMs })
    if (s.shieldOn) ap.push({ t: 'shield', ms: 99999 })
    if (s.magnetMs > 0) ap.push({ t: 'magnet', ms: s.magnetMs })
    if (s.multiplierMs > 0) ap.push({ t: 'bomb', ms: s.multiplierMs }) // reuse badge for multiplier
    setActPU(ap)
    if (s.shakeMs > 0) {
      const i = (s.shakeMs / SHAKE_MS) * SHAKE_PX
      setShkX(snap((Math.random() - 0.5) * 2 * i)); setShkY(snap((Math.random() - 0.5) * 2 * i))
    } else { setShkX(0); setShkY(0) }
  }, [])

  const finish = useCallback(() => {
    if (doneRef.current) return; doneRef.current = true
    const s = sRef.current
    if (bgmRef.current !== null) { bgmRef.current.pause(); bgmRef.current.currentTime = 0 }
    sfx('over', 0.6, 0.95); effects.cleanup()
    onFinish({ score: s.score, durationMs: Math.max(Math.round(s.ms), Math.round(DEFAULT_FRAME_MS)) })
  }, [onFinish, sfx, effects])

  const nextStage = useCallback((s: GS) => {
    s.stage += 1; const spd = Math.min(BALL_MAX_SPD, s.ball.spd + BALL_SPD_INC)
    const br = makeBricks(s.stage, s.nBrick); s.bricks = br; s.nBrick += br.length
    s.ball = mkBall(s.padX); s.ball.spd = spd; s.launchMs = LAUNCH_MS
    s.extras = []; s.pus = []; s.trail = []; s.stageFlashMs = 1400
    const bonus = 100 * s.stage; s.score += bonus
    // Multiplier boost on stage clear
    s.multiplier = Math.min(s.multiplier + 1, 5); s.multiplierMs = 10000
    spawnRing(s, VW / 2, VH * 0.45, `${PAL.yellow}cc`, 180, 8)
    spawnRing(s, VW / 2, VH * 0.45, `${PAL.orange}bb`, 120, 5)
    sfx('clear', 0.6, 1.1); effects.comboHitBurst(180, 320, s.stage * 6, bonus, ['*', '+', 'X', '!'])
    effects.spawnParticles(12, VW / 2, VH * 0.45, ['X', '*', '+', '!'])
    effects.triggerFlash(`${PAL.yellow}66`, 220)
    effects.advanceBgHue(48)
  }, [sfx, effects])

  const loseBall = useCallback((s: GS) => {
    s.lives -= 1; s.shakeMs = SHAKE_MS; s.combo = 0; s.comboMs = 0; s.trail = []
    s.multiplier = 1; s.multiplierMs = 0
    spawnRing(s, s.ball.x + BALL_HALF, Math.min(s.ball.y + BALL_HALF, VH - 24), `${PAL.red}cc`, 72, 5)
    sfx('lost', 0.5); effects.triggerShake(10); effects.triggerFlash(`${PAL.red}88`, 150)
    effects.spawnParticles(8, s.ball.x + BALL_HALF, Math.min(s.ball.y + BALL_HALF, VH - 24), ['X', '!', '*'])
    if (s.lives > 0) { s.ball = mkBall(s.padX); s.launchMs = LAUNCH_MS }
  }, [sfx, effects])

  const movePad = useCallback((s: GS) => {
    const bd = boardRef.current; if (!bd || ptrRef.current === null) return
    const rc = bd.getBoundingClientRect(); const rel = (ptrRef.current - rc.left) / rc.width
    const pw = s.wideMs > 0 ? PAD_WIDE_W : PAD_W
    const tgt = clamp(rel * VW, pw / 2, VW - pw / 2)
    const prevPadX = s.padX
    s.padX += (tgt - s.padX) * 0.4; s.padX = clamp(s.padX, pw / 2, VW - pw / 2)
    if (!s.ball.on && shouldDetachBallFromPad(prevPadX, tgt)) releaseBallFromPad(s, tgt - prevPadX)
  }, [releaseBallFromPad])

  const applyPU = useCallback((s: GS, t: PUType) => {
    sfx('pu', 0.55, 1.1); effects.triggerFlash(PU_COLORS[t] + '40', 100)
    switch (t) {
      case 'wide': s.wideMs = PAD_WIDE_MS; break
      case 'fire': s.fireMs = FIRE_MS; break
      case 'slow': s.slowMs = SLOW_MS; break
      case 'life': s.lives = Math.min(s.lives + 1, 5); effects.spawnParticles(5, VW / 2, VH / 2); break
      case 'multi': {
        const e = mkBall(s.padX)
        e.spd = s.ball.spd
        const baseAngle = Math.atan2(s.ball.vy || -e.spd, s.ball.vx || e.spd)
        const splitAngle = baseAngle - Math.PI / 5
        e.vx = Math.cos(splitAngle) * e.spd
        e.vy = Math.sin(splitAngle) * e.spd
        ensureVY(e)
        e.on = true
        s.extras.push(e)
        spawnRing(s, e.x + BALL_HALF, e.y + BALL_HALF, `${PAL.purple}bb`, 32, 3)
        effects.spawnParticles(5, e.x + BALL_HALF, e.y + BALL_HALF, ['+', '*', '>'])
        break
      }
      case 'shield': s.shieldOn = true; break
      case 'magnet': s.magnetMs = MAGNET_MS; break
      case 'bomb': {
        // Screen wipe: destroy all breakable bricks on screen
        let destroyed = 0
        for (const br of s.bricks) {
          if (!br.alive || br.unbr) continue
          br.alive = false; br.hp = 0; destroyed++
          spawnPxl(s, br.x + br.w / 2, br.y + br.h / 2, br.baseColor, 4)
          s.score += br.pts
        }
        s.totalDest += destroyed
        spawnRing(s, VW / 2, VH * 0.42, `${PAL.orange}cc`, 220, 8)
        effects.spawnParticles(18, VW / 2, VH * 0.42, ['X', '!', '*', '+'])
        effects.triggerShake(12); effects.triggerFlash(`${PAL.orange}88`, 200)
        effects.advanceBgHue(60)
        sfx('clear', 0.7, 0.8)
        break
      }
    }
  }, [sfx, effects])

  // Audio
  useEffect(() => {
    const map: Record<string, string> = { hit: brickHitSfx, pad: paddleHitSfx, wall: wallHitSfx, pu: powerupSfx, cmb: comboSfx, clear: stageClearSfx, lost: ballLostSfx, over: gameOverHitSfx }
    const arr: HTMLAudioElement[] = []
    for (const [k, src] of Object.entries(map)) { const a = new Audio(src); a.preload = 'auto'; audRef.current[k] = a; arr.push(a) }
    const bgm = new Audio(breakoutBgmLoop)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = BGM_VOLUME
    bgmRef.current = bgm
    void bgm.play().catch(() => {})
    return () => {
      effectsCleanupRef.current()
      for (const a of arr) { a.pause(); a.currentTime = 0 }
      if (bgmRef.current !== null) {
        bgmRef.current.pause()
        bgmRef.current.currentTime = 0
        bgmRef.current = null
      }
      audRef.current = {}
    }
  }, [])

  // Pointer
  useEffect(() => {
    const pm = (e: PointerEvent) => { ptrRef.current = e.clientX }
    const pd = (e: PointerEvent) => { ptrRef.current = e.clientX; startBgm() }
    const tm = (e: TouchEvent) => { if (e.touches.length) ptrRef.current = e.touches[0].clientX }
    const ts = (e: TouchEvent) => { if (e.touches.length) { ptrRef.current = e.touches[0].clientX; startBgm() } }
    window.addEventListener('pointermove', pm); window.addEventListener('pointerdown', pd)
    window.addEventListener('touchmove', tm, { passive: true })
    window.addEventListener('touchstart', ts, { passive: true })
    return () => {
      window.removeEventListener('pointermove', pm)
      window.removeEventListener('pointerdown', pd)
      window.removeEventListener('touchmove', tm)
      window.removeEventListener('touchstart', ts)
    }
  }, [startBgm])

  // Keyboard
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (doneRef.current) return
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') startBgm()
      const s = sRef.current, step = 20, pw = s.wideMs > 0 ? PAD_WIDE_W : PAD_W
      if (e.code === 'ArrowLeft') {
        e.preventDefault()
        const prevPadX = s.padX
        s.padX = clamp(s.padX - step, pw / 2, VW - pw / 2)
        if (!s.ball.on && shouldDetachBallFromPad(prevPadX, s.padX)) releaseBallFromPad(s, s.padX - prevPadX)
      } else if (e.code === 'ArrowRight') {
        e.preventDefault()
        const prevPadX = s.padX
        s.padX = clamp(s.padX + step, pw / 2, VW - pw / 2)
        if (!s.ball.on && shouldDetachBallFromPad(prevPadX, s.padX)) releaseBallFromPad(s, s.padX - prevPadX)
      }
    }
    window.addEventListener('keydown', kd); return () => window.removeEventListener('keydown', kd)
  }, [onExit, releaseBallFromPad, startBgm])

  // Game loop
  useEffect(() => {
    lastRef.current = null
    const step = (now: number) => {
      if (doneRef.current) { rafRef.current = null; return }
      if (lastRef.current === null) lastRef.current = now
      const rawDt = Math.min(now - lastRef.current, MAX_FRAME_DELTA_MS); lastRef.current = now
      const s = sRef.current; const sf = s.slowMs > 0 ? SLOW_F : 1
      const dt = rawDt * sf; const ds = dt / 1000; s.ms += rawDt
      effects.updateParticles(); movePad(s)

      // Timers
      if (s.wideMs > 0) s.wideMs = Math.max(0, s.wideMs - rawDt)
      if (s.fireMs > 0) s.fireMs = Math.max(0, s.fireMs - rawDt)
      if (s.slowMs > 0) s.slowMs = Math.max(0, s.slowMs - rawDt)
      if (s.magnetMs > 0) s.magnetMs = Math.max(0, s.magnetMs - rawDt)
      if (s.shakeMs > 0) s.shakeMs = Math.max(0, s.shakeMs - rawDt)
      if (s.stageFlashMs > 0) s.stageFlashMs = Math.max(0, s.stageFlashMs - rawDt)
      if (s.multiplierMs > 0) { s.multiplierMs -= rawDt; if (s.multiplierMs <= 0) { s.multiplier = 1; s.multiplierMs = 0 } }
      if (s.comboMs > 0) { s.comboMs -= rawDt; if (s.comboMs <= 0) { s.combo = 0; s.comboMs = 0 } }
      for (const b of s.bricks) { if (b.flash > 0) b.flash = Math.max(0, b.flash - rawDt) }

      // Moving bricks
      if (s.stage >= MOVE_STAGE) {
        for (const b of s.bricks) {
          if (!b.alive || b.moveDir === 0) continue
          b.x += b.moveDir * MOVE_SPEED * ds
          if (b.x <= BR_LEFT - BR_GAP || b.x + b.w >= BR_LEFT + BR_COLS * (BR_W + BR_GAP)) b.moveDir *= -1
        }
      }

      // Pixel particles
      s.pxls = s.pxls.filter(p => s.ms - p.t < PART_LIFE)
      for (const p of s.pxls) { p.x += p.vx * ds; p.y += p.vy * ds; p.vy += 300 * ds }
      s.rings = s.rings.filter(r => s.ms - r.t < RING_LIFE)

      // Power-ups fall
      const pw = s.wideMs > 0 ? PAD_WIDE_W : PAD_W
      for (let i = s.pus.length - 1; i >= 0; i--) {
        const pu = s.pus[i]; pu.y += PU_SPD * ds
        if (pu.y + PU_SZ >= PAD_Y && pu.y - PU_SZ <= PAD_Y + PAD_H && pu.x >= s.padX - pw / 2 - PU_SZ && pu.x <= s.padX + pw / 2 + PU_SZ) {
          applyPU(s, pu.type); s.pus.splice(i, 1); continue
        }
        if (pu.y > VH + 20) s.pus.splice(i, 1)
      }

      if (!s.ball.on) {
        s.ball.x = s.padX; s.ball.y = PAD_Y - BALL_SZ - 1
        s.launchMs -= rawDt; if (s.launchMs <= 0) launchBall(s.ball)
        sync(s); rafRef.current = requestAnimationFrame(step); return
      }

      // Trail
      if (s.ms - s.trailMs > 18) { s.trail.push({ x: snap(s.ball.x), y: snap(s.ball.y) }); if (s.trail.length > 6) s.trail.shift(); s.trailMs = s.ms }

      const subs = Math.max(1, Math.ceil(rawDt / (DEFAULT_FRAME_MS * 0.5)))
      const subDs = ds / subs; const isFire = s.fireMs > 0; const isMag = s.magnetMs > 0

      const maybeSpawnBonusBall = (sourceBall: Ball) => {
        if (s.totalDest % MULTI_THRESHOLD !== 0 || s.extras.length >= MAX_EXTRA) return
        const e = mkBall(s.padX)
        e.spd = sourceBall.spd
        const splitDir = s.extras.length % 2 === 0 ? 1 : -1
        const baseAngle = Math.atan2(sourceBall.vy || -e.spd, sourceBall.vx || e.spd)
        const splitAngle = baseAngle + splitDir * (Math.PI / 5)
        e.vx = Math.cos(splitAngle) * e.spd
        e.vy = Math.sin(splitAngle) * e.spd
        ensureVY(e)
        e.on = true
        s.extras.push(e)
        spawnRing(s, e.x + BALL_HALF, e.y + BALL_HALF, `${PAL.purple}bb`, 32, 3)
        effects.triggerFlash(`${PAL.purple}55`, 80)
        effects.spawnParticles(6, e.x + BALL_HALF, e.y + BALL_HALF, ['+', '*', '>'])
      }

      const breakBrick = (br: Brick, sourceBall: Ball, scoreScale = 1, chainDepth = 0) => {
        br.alive = false; br.hp = 0; s.consHits++; s.totalDest++; s.combo++; s.comboMs = 1200
        const hb = s.consHits > 1 ? 5 * (s.consHits - 1) : 0
        const cb = s.combo > 2 ? s.combo * 3 : 0
        const total = Math.max(1, Math.round((br.pts + hb + cb) * s.multiplier * scoreScale))
        const cx = br.x + br.w / 2
        const cy = br.y + br.h / 2
        s.score += total
        spawnPxl(s, cx, cy, br.baseColor, br.gimmick === 'shock' ? 12 : 8)
        spawnRing(s, cx, cy, `${br.baseColor}cc`, br.gimmick === 'shock' ? 84 : 46, br.gimmick === 'shock' ? 6 : 4)
        effects.spawnParticles(br.gimmick === 'shock' ? 8 : 4, cx, cy, br.gimmick === 'shock' ? ['X', '!', '+', '*'] : undefined)
        effects.showScorePopup(total, cx, cy, br.gimmick === 'shock' ? PAL.pink : br.baseColor)
        effects.advanceBgHue(18 + chainDepth * 6)
        if (Math.random() < PU_CHANCE * Math.min(1, scoreScale + 0.1)) {
          s.pus.push({ id: s.nPU++, type: pickPU(), x: cx, y: cy, t: s.ms })
        }
        maybeSpawnBonusBall(sourceBall)
      }

      const triggerShockwave = (origin: Brick, sourceBall: Ball, chainDepth = 0) => {
        if (chainDepth > 2) return
        const cx = origin.x + origin.w / 2
        const cy = origin.y + origin.h / 2
        spawnRing(s, cx, cy, `${PAL.pink}dd`, 92 - chainDepth * 10, 5)
        effects.triggerFlash(`${PAL.pink}28`, 90)
        effects.triggerShake(4 + chainDepth * 2, 90)
        effects.spawnParticles(Math.max(4, 8 - chainDepth), cx, cy, ['!', 'X', '+', '*'])
        const targetIds = getShockwaveTargetIds(
          s.bricks.map((brick) => ({
            id: brick.id,
            x: brick.x,
            y: brick.y,
            alive: brick.alive,
            unbreakable: brick.unbr,
          })),
          origin.id,
        )
        for (const targetId of targetIds) {
          const nearby = s.bricks.find((brick) => brick.id === targetId)
          if (nearby === undefined || !nearby.alive || nearby.unbr) continue
          nearby.flash = 220
          nearby.hp -= 1
          const tx = nearby.x + nearby.w / 2
          const ty = nearby.y + nearby.h / 2
          if (nearby.hp <= 0) {
            breakBrick(nearby, sourceBall, 0.78, chainDepth + 1)
            if (nearby.gimmick === 'shock') triggerShockwave(nearby, sourceBall, chainDepth + 1)
          } else {
            const chipScore = Math.max(1, Math.round((nearby.pts / nearby.maxHp) * s.multiplier * 0.65))
            s.score += chipScore
            spawnPxl(s, tx, ty, nearby.baseColor, 4)
            spawnRing(s, tx, ty, `${PAL.pink}99`, 26, 3)
            effects.showScorePopup(chipScore, tx, ty, PAL.pink)
          }
        }
      }

      const proc = (b: Ball): 'lost' | 'ok' => {
        if (isMag && b.vy > 0) {
          const dx = s.padX - b.x; b.vx += Math.sign(dx) * MAGNET_STR * subDs
          const sp = Math.hypot(b.vx, b.vy); if (sp > 0) { b.vx = (b.vx / sp) * b.spd; b.vy = (b.vy / sp) * b.spd }
          ensureVY(b)
        }
        b.x += b.vx * subDs; b.y += b.vy * subDs
        // Walls
        if (b.x <= 0) { b.x = 0; b.vx = Math.abs(b.vx); sfx('wall', 0.2, 1.2) }
        else if (b.x + BALL_SZ >= VW) { b.x = VW - BALL_SZ; b.vx = -Math.abs(b.vx); sfx('wall', 0.2, 1.2) }
        if (b.y <= 0) { b.y = 0; b.vy = Math.abs(b.vy); sfx('wall', 0.15, 1.4) }
        // Bottom
        if (b.y + BALL_SZ >= VH + 20) {
          if (s.shieldOn) { s.shieldOn = false; b.y = SHIELD_Y - BALL_SZ; b.vy = -Math.abs(b.vy); sfx('wall', 0.4, 0.6); effects.triggerFlash(`${PAL.yellow}66`, 100); spawnPxl(s, b.x, SHIELD_Y, PAL.yellow, 8); return 'ok' }
          return 'lost'
        }
        // Paddle
        const pl = s.padX - pw / 2
        const pc = boxHit(pl, PAD_Y, pw, PAD_H, b.x, b.y, BALL_SZ)
        if (pc.hit && b.vy > 0) {
          b.y = PAD_Y - BALL_SZ; s.consHits = 0
          const off = (b.x + BALL_HALF - s.padX) / (pw / 2)
          const co = clamp(off, -0.92, 0.92), ang = co * (Math.PI / 3)
          b.vx = Math.sin(ang) * b.spd; b.vy = -Math.cos(ang) * b.spd; ensureVY(b)
          sfx('pad', 0.4, 1 + Math.abs(co) * 0.2); spawnPxl(s, b.x + BALL_HALF, PAD_Y, PAL.fg, 4)
          spawnRing(s, b.x + BALL_HALF, PAD_Y, `${PAL.fg}aa`, 24 + Math.abs(co) * 14, 3)
          effects.spawnParticles(3, b.x + BALL_HALF, PAD_Y, ['+', '!'])
        }
        // Bricks
        let hc = 0
        for (const br of s.bricks) {
          if (!br.alive) continue
          const col = boxHit(br.x, br.y, br.w, br.h, b.x, b.y, BALL_SZ)
          if (!col.hit) continue
          if (br.unbr && !isFire) {
            if (hc === 0) { reflect(b, col.nx, col.ny); ensureVY(b) }
            hc++; br.flash = 120; sfx('wall', 0.2, 0.7); spawnPxl(s, br.x + br.w / 2, br.y + br.h / 2, PAL.comment, 3); spawnRing(s, br.x + br.w / 2, br.y + br.h / 2, `${PAL.comment}88`, 22, 2); continue
          }
          br.hp -= 1; br.flash = 150
          if (br.hp <= 0 || isFire) {
            hc++
            breakBrick(br, b)
            if (br.gimmick === 'shock') triggerShockwave(br, b)
          } else {
            hc++
            spawnPxl(s, br.x + br.w / 2, br.y + br.h / 2, br.baseColor, 4)
            spawnRing(s, br.x + br.w / 2, br.y + br.h / 2, `${br.baseColor}77`, 28, 3)
            effects.spawnParticles(2, br.x + br.w / 2, br.y + br.h / 2, ['+', 'X'])
            s.score += Math.floor(br.pts / br.maxHp) * s.multiplier
          }
          if (!isFire && hc === 1) { reflect(b, col.nx, col.ny); ensureVY(b) }
        }
        if (hc > 0) {
          sfx('hit', 0.35 + hc * 0.05, 1 + Math.min(0.4, hc * 0.1))
          spawnRing(s, b.x + BALL_HALF, b.y + BALL_HALF, `${isFire ? PAL.red : PAL.yellow}88`, 24 + hc * 8, 3)
          effects.triggerShake(2 + hc)
          effects.advanceBgHue(10 + hc * 4)
          if (s.combo >= 5 && s.combo % 5 === 0) { sfx('cmb', 0.45, 1 + s.combo * 0.01); effects.comboHitBurst(b.x, b.y, s.combo, s.combo * 10, ['X', '+', '!', '*']) }
        }
        return 'ok'
      }

      for (let sub = 0; sub < subs; sub++) {
        if (proc(s.ball) === 'lost') {
          if (s.extras.length > 0) { s.ball = s.extras.shift()!; sfx('wall', 0.3, 0.8) }
          else { loseBall(s); if (s.lives <= 0) { sync(s); finish(); return } sync(s); rafRef.current = requestAnimationFrame(step); return }
        }
        for (let i = s.extras.length - 1; i >= 0; i--) { const e = s.extras[i]; if (!e.on) continue; if (proc(e) === 'lost') s.extras.splice(i, 1) }
      }
      if (s.bricks.filter(b => b.alive && !b.unbr).length === 0) nextStage(s)
      sync(s); rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null }; lastRef.current = null }
  }, [nextStage, finish, loseBall, sfx, sync, movePad, applyPU, effects])

  const bestDisp = useMemo(() => Math.max(bestScore, rScore), [bestScore, rScore])
  const hearts = useMemo(() => {
    const h: string[] = []; for (let i = 0; i < Math.max(LIVES, rLives); i++) h.push(i < rLives ? PAL.red : PAL.bgLight); return h
  }, [rLives])

  return (
    <section className="mini-game-panel bo-panel" aria-label="breakout-mini-game" style={effects.getShakeStyle()}>
      <style>{CSS}{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      {/* CRT scanline overlay */}
      <div className="bo-scanline" />

      {rCombo >= 3 && rComboLbl && <div className="bo-combo" style={{ color: rComboClr }} key={rCombo}>{rCombo}x {rComboLbl}</div>}
      {rStageBan > 0 && <div className="bo-stg" key={`s-${rStage}`}>STAGE {rStage}</div>}
      {rMult > 1 && <div className="bo-mult" key={`m-${rMult}`}>x{rMult}</div>}

      <div className="bo-hud">
        <div className="bo-score-wrap">
          <p className="bo-score-label">SCORE</p>
          <p className="bo-score">{rScore.toLocaleString()}</p>
          <p className="bo-best">BEST {bestDisp.toLocaleString()}</p>
        </div>
        <div className="bo-stage-wrap">
          <p className="bo-stage-label">LEVEL</p>
          <p className="bo-stage">STAGE {rStage}</p>
        </div>
        <div className="bo-lives">
          {hearts.map((c, i) => (
            <svg key={i} width="16" height="16" viewBox="0 0 16 16" style={{ imageRendering: 'pixelated' }}>
              <rect x="4" y="0" width="4" height="2" fill={c} /><rect x="8" y="0" width="4" height="2" fill={c} />
              <rect x="2" y="2" width="12" height="2" fill={c} /><rect x="2" y="4" width="12" height="2" fill={c} />
              <rect x="2" y="6" width="12" height="2" fill={c} /><rect x="4" y="8" width="8" height="2" fill={c} />
              <rect x="6" y="10" width="4" height="2" fill={c} />
            </svg>
          ))}
        </div>
      </div>

      <div className="bo-pu-bar">
        {rActPU.map(p => (
          <span key={p.t} className="bo-pu-badge" style={{ background: PU_COLORS[p.t], opacity: p.ms < 2000 && p.t !== 'shield' ? 0.5 + 0.5 * Math.sin(p.ms * 0.012) : 1 }}>
            {p.t === 'shield' ? 'SHLD' : p.t === 'bomb' ? `x${rMult}` : `${p.t.toUpperCase()} ${Math.ceil(p.ms / 1000)}`}
          </span>
        ))}
      </div>

      <div className="bo-board" ref={boardRef} role="presentation">
        <svg className="bo-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid meet" aria-label="breakout-field">
          <g transform={`translate(${rShkX} ${rShkY})`}>
            {/* BG */}
            <rect x="0" y="0" width={VW} height={VH} fill={PAL.bg} />
            <rect x="0" y="0" width={VW} height={VH} fill={`hsla(${effects.bgPulseHue}, 92%, 60%, 0.09)`} />
            {/* Grid dots */}
            {Array.from({ length: 20 }, (_, i) => Array.from({ length: 12 }, (_, j) => (
              <rect key={`d${i}-${j}`} x={j * 32 + 14} y={i * 32 + 14} width={PX} height={PX} fill={PAL.bgLight} opacity="0.3" />
            )))}

            {/* Danger line */}
            {Array.from({ length: Math.floor(VW / 8) }, (_, i) => (
              <rect key={`dz${i}`} x={i * 8} y={VH - PX * 2} width={4} height={PX} fill={PAL.red} opacity="0.5" />
            ))}

            {/* Shield */}
            {rShield && Array.from({ length: Math.floor((VW - 40) / 6) }, (_, i) => (
              <rect key={`sh${i}`} x={20 + i * 6} y={SHIELD_Y - PX} width={4} height={PX * 2} fill={i % 2 === 0 ? PAL.yellow : PAL.orange} />
            ))}

            {/* Hit rings */}
            {rRings.map((ring) => {
              const age = rMs - ring.t
              const progress = clamp(age / RING_LIFE, 0, 1)
              return (
                <circle
                  key={ring.id}
                  cx={snap(ring.x)}
                  cy={snap(ring.y)}
                  r={snap(Math.max(PX * 2, ring.r * progress))}
                  fill="none"
                  stroke={ring.c}
                  strokeWidth={Math.max(1, ring.w * (1 - progress * 0.7))}
                  opacity={1 - progress}
                />
              )
            })}

            {/* Bricks */}
            {rBricks.filter(b => b.alive).map(br => {
              const bc = brickColor(br); const is2 = br.maxHp > 1 && br.hp > 1; const cracked = br.maxHp > 1 && br.hp === 1
              const bx = snap(br.x), by = snap(br.y)
              return (
                <g key={br.id} opacity={br.flash > 0 ? 0.4 + 0.6 * Math.abs(Math.sin(br.flash * 0.015)) : 1}>
                  {/* Main body */}
                  <rect x={bx} y={by} width={br.w} height={br.h} fill={bc} />
                  {/* Top highlight */}
                  <rect x={bx + PX} y={by} width={br.w - PX * 2} height={PX} fill={br.unbr ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.35)'} />
                  {/* Bottom shadow */}
                  <rect x={bx} y={by + br.h - PX} width={br.w} height={PX} fill="rgba(0,0,0,0.25)" />
                  {/* Left highlight */}
                  <rect x={bx} y={by + PX} width={PX} height={br.h - PX * 2} fill="rgba(255,255,255,0.15)" />
                  {/* 2-hit: inner dots */}
                  {is2 && <>
                    <rect x={bx + 6} y={by + 4} width={PX} height={PX} fill={PAL.fg} opacity="0.5" />
                    <rect x={bx + br.w - 8} y={by + 4} width={PX} height={PX} fill={PAL.fg} opacity="0.5" />
                    <rect x={bx + br.w / 2 - 1} y={by + br.h - 6} width={PX} height={PX} fill={PAL.fg} opacity="0.5" />
                  </>}
                  {/* Cracked: pixel crack lines */}
                  {cracked && <>
                    <rect x={bx + 8} y={by + 2} width={PX} height={PX} fill={PAL.fg} opacity="0.4" />
                    <rect x={bx + 10} y={by + 4} width={PX} height={PX} fill={PAL.fg} opacity="0.4" />
                    <rect x={bx + 12} y={by + 6} width={PX} height={PX} fill={PAL.fg} opacity="0.3" />
                    <rect x={bx + 10} y={by + 8} width={PX} height={PX} fill={PAL.fg} opacity="0.3" />
                    <rect x={bx + br.w - 10} y={by + 3} width={PX} height={PX} fill={PAL.fg} opacity="0.35" />
                    <rect x={bx + br.w - 12} y={by + 5} width={PX} height={PX} fill={PAL.fg} opacity="0.35" />
                  </>}
                  {/* Unbreakable: X pattern */}
                  {br.unbr && <>
                    <rect x={bx + 6} y={by + 3} width={PX} height={PX} fill={PAL.fg} opacity="0.1" />
                    <rect x={bx + br.w - 8} y={by + 3} width={PX} height={PX} fill={PAL.fg} opacity="0.1" />
                    <rect x={bx + br.w / 2 - 1} y={by + br.h / 2 - 1} width={PX} height={PX} fill={PAL.fg} opacity="0.12" />
                    <rect x={bx + 6} y={by + br.h - 5} width={PX} height={PX} fill={PAL.fg} opacity="0.1" />
                    <rect x={bx + br.w - 8} y={by + br.h - 5} width={PX} height={PX} fill={PAL.fg} opacity="0.1" />
                  </>}
                  {/* Shock brick: charged core */}
                  {br.gimmick === 'shock' && !br.unbr && <>
                    <rect x={bx + br.w / 2 - 6} y={by + br.h / 2 - 4} width={12} height={8} fill={PAL.pink} opacity="0.75" />
                    <rect x={bx + br.w / 2 - 2} y={by + br.h / 2 - 8} width={4} height={16} fill={PAL.yellow} opacity="0.9" />
                    <rect x={bx + 4} y={by + 3} width={PX} height={PX} fill={PAL.fg} opacity="0.6" />
                    <rect x={bx + br.w - 6} y={by + br.h - 5} width={PX} height={PX} fill={PAL.fg} opacity="0.6" />
                  </>}
                </g>
              )
            })}

            {/* Power-ups (pixel boxes) */}
            {rPUs.map(pu => {
              const c = PU_COLORS[pu.type]; const px = snap(pu.x - PU_SZ / 2); const py = snap(pu.y - PU_SZ / 2)
              return (
                <g key={pu.id}>
                  <rect x={px - PX} y={py - PX} width={PU_SZ + PX * 2} height={PU_SZ + PX * 2} fill={c} opacity="0.3" />
                  <rect x={px} y={py} width={PU_SZ} height={PU_SZ} fill={c} />
                  <rect x={px} y={py} width={PU_SZ} height={PX} fill="rgba(255,255,255,0.4)" />
                  <text x={snap(pu.x)} y={snap(pu.y) + 4} textAnchor="middle" fill={PAL.bg} fontSize="8" fontWeight="bold" fontFamily="'Press Start 2P',monospace">{PU_LABEL[pu.type]}</text>
                </g>
              )
            })}

            {/* Paddle (pixel) */}
            <rect x={snap(rPadX - rPadW / 2)} y={PAD_Y} width={rPadW} height={PAD_H} fill={PAL.fg} />
            <rect x={snap(rPadX - rPadW / 2)} y={PAD_Y} width={rPadW} height={PX} fill="rgba(255,255,255,0.5)" />
            <rect x={snap(rPadX - rPadW / 2)} y={PAD_Y + PAD_H - PX} width={rPadW} height={PX} fill="rgba(0,0,0,0.3)" />
            {/* Paddle edge pixels */}
            <rect x={snap(rPadX - rPadW / 2)} y={PAD_Y + PX * 2} width={PX} height={PAD_H - PX * 4} fill={PAL.yellow} opacity="0.6" />
            <rect x={snap(rPadX + rPadW / 2 - PX)} y={PAD_Y + PX * 2} width={PX} height={PAD_H - PX * 4} fill={PAL.yellow} opacity="0.6" />

            {/* Ball trail (pixel) */}
            {rTrail.map((t, i) => {
              const a = ((i + 1) / rTrail.length) * 0.3; const sz = PX + Math.floor((i / rTrail.length) * 2) * PX
              const tc = rBalls[0]?.fire ? PAL.red : rBalls[0]?.mag ? PAL.cyan : PAL.yellow
              return <rect key={i} x={t.x} y={t.y} width={sz} height={sz} fill={tc} opacity={a} />
            })}

            {/* Balls (pixel squares) */}
            {rBalls.map((b, i) => {
              const bc = b.fire ? PAL.red : b.mag ? PAL.cyan : PAL.yellow
              return (
                <g key={`b${i}`}>
                  {/* Glow pixels */}
                  <rect x={b.x - PX * 2} y={b.y} width={BALL_SZ + PX * 4} height={BALL_SZ} fill={bc} opacity="0.16" />
                  <rect x={b.x} y={b.y - PX * 2} width={BALL_SZ} height={BALL_SZ + PX * 4} fill={bc} opacity="0.16" />
                  <rect x={b.x - PX} y={b.y - PX} width={BALL_SZ + PX * 2} height={BALL_SZ + PX * 2} fill={bc} opacity="0.22" />
                  {/* Ball body */}
                  <rect x={b.x} y={b.y} width={BALL_SZ} height={BALL_SZ} fill={bc} />
                  {/* Highlight pixel */}
                  <rect x={b.x} y={b.y} width={PX} height={PX} fill={PAL.fg} opacity="0.8" />
                  {b.fire && <rect x={b.x + PX * 2} y={b.y + PX * 2} width={PX} height={PX} fill={PAL.orange} />}
                  {b.mag && !b.fire && <>
                    <rect x={b.x - PX * 2} y={b.y + PX} width={PX} height={PX} fill={PAL.cyan} opacity="0.4" />
                    <rect x={b.x + BALL_SZ + PX} y={b.y + PX} width={PX} height={PX} fill={PAL.cyan} opacity="0.4" />
                  </>}
                </g>
              )
            })}

            {/* Pixel particles */}
            {rPxls.map(p => {
              const age = rMs - p.t; const prog = clamp(age / PART_LIFE, 0, 1); const op = 1 - prog
              return <rect key={p.id} x={snap(p.x)} y={snap(p.y)} width={p.sz} height={p.sz} fill={p.c} opacity={op} />
            })}

            {/* Walls (pixel borders) */}
            <rect x="0" y="0" width={PX} height={VH} fill={PAL.bgLight} />
            <rect x={VW - PX} y="0" width={PX} height={VH} fill={PAL.bgLight} />
            <rect x="0" y="0" width={VW} height={PX} fill={PAL.bgLight} />
          </g>
        </svg>
      </div>
    </section>
  )
}

export const breakoutMiniModule: MiniGameModule = {
  manifest: {
    id: 'breakout-mini',
    title: 'Breakout',
    description: 'Bounce ball with paddle to break all bricks!',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#ff5555',
  },
  Component: BreakoutMiniGame,
}
