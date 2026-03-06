import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import snakeEatSfx from '../../../assets/sounds/snake-eat.mp3'
import snakeGoldenSfx from '../../../assets/sounds/snake-golden.mp3'
import snakeComboSfx from '../../../assets/sounds/snake-combo.mp3'
import snakeCrashSfx from '../../../assets/sounds/snake-crash.mp3'
import snakeTurnSfx from '../../../assets/sounds/snake-turn.mp3'
import snakeSpeedUpSfx from '../../../assets/sounds/snake-speed-up.mp3'
import snakeWarpSfx from '../../../assets/sounds/snake-warp.mp3'
import snakePoisonSfx from '../../../assets/sounds/snake-poison.mp3'
import snakeFeverSfx from '../../../assets/sounds/snake-fever.mp3'
import snakeBombSfx from '../../../assets/sounds/snake-bomb.mp3'
import snakeStarSfx from '../../../assets/sounds/snake-star.mp3'
import snakeMagnetSfx from '../../../assets/sounds/snake-magnet.mp3'
import snakeReverseSfx from '../../../assets/sounds/snake-reverse.mp3'
import snakeLevelUpSfx from '../../../assets/sounds/snake-levelup.mp3'
import snakePerfectSfx from '../../../assets/sounds/snake-perfect.mp3'

// ══════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════
const G = 16 // grid size — 16x16 retro
const CELLS = G * G
const INIT_LEN = 3
const INIT_INTERVAL = 190
const MIN_INTERVAL = 50
const SPD_THRESHOLD = 50
const SPD_STEP = 12
const PTS_APPLE = 10
const PTS_GOLDEN = 50
const PTS_STAR = 30
const GOLDEN_EVERY = 7
const POISON_CHANCE = 0.12
const POISON_SHRINK = 2
const WALL_WRAP_AT = 100

// Power-ups
const PUP_SHIELD_CHANCE = 0.11
const PUP_RUSH_CHANCE = 0.07
const PUP_BOMB_CHANCE = 0.06
const PUP_MAGNET_CHANCE = 0.06
const PUP_GHOST_CHANCE = 0.05
const SHIELD_MS = 8000
const RUSH_MS = 5000
const MAGNET_MS = 6000
const GHOST_MS = 4000

// Combo / Fever
const COMBO_WINDOW = 3500
const FEVER_AT = 5
const FEVER_MS = 6000
const FEVER_MUL = 2

// Obstacles & Stars
const OBS_START = 60
const MAX_OBS = 6
const STAR_SPAWN_CHANCE = 0.18
const STAR_LIFETIME_MS = 6000

// Reverse trap
const REVERSE_MS = 4000

type Dir = 'up' | 'down' | 'left' | 'right'
type PupType = 'shield' | 'rush' | 'bomb' | 'magnet' | 'ghost'
type AppleKind = 'normal' | 'golden' | 'poison'

interface Pos { readonly x: number; readonly y: number }
interface Pup { readonly pos: Pos; readonly type: PupType }
interface Star { readonly pos: Pos; readonly expiresAt: number }

const eq = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y
const idx = (p: Pos) => p.y * G + p.x
const oob = (p: Pos) => p.x < 0 || p.x >= G || p.y < 0 || p.y >= G
const opp = (a: Dir, b: Dir) => (a === 'up' && b === 'down') || (a === 'down' && b === 'up') || (a === 'left' && b === 'right') || (a === 'right' && b === 'left')

function mv(p: Pos, d: Dir): Pos {
  return d === 'up' ? { x: p.x, y: p.y - 1 } : d === 'down' ? { x: p.x, y: p.y + 1 }
    : d === 'left' ? { x: p.x - 1, y: p.y } : { x: p.x + 1, y: p.y }
}

function flipDir(d: Dir): Dir {
  return d === 'up' ? 'down' : d === 'down' ? 'up' : d === 'left' ? 'right' : 'left'
}

function mkSnake(): Pos[] {
  const c = Math.floor(G / 2)
  return Array.from({ length: INIT_LEN }, (_, i) => ({ x: c, y: c + i }))
}

function occ(snake: Pos[], extras: Pos[]): Set<number> {
  const s = new Set(snake.map(idx))
  for (const e of extras) s.add(idx(e))
  return s
}

function spawn(occupied: Set<number>): Pos {
  const f: Pos[] = []
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) if (!occupied.has(idx({ x, y }))) f.push({ x, y })
  return f.length > 0 ? f[Math.floor(Math.random() * f.length)] : { x: 0, y: 0 }
}

function mkObs(score: number, snake: Pos[], apple: Pos, extras: Pos[]): Pos[] {
  if (score < OBS_START) return []
  const n = Math.min(MAX_OBS, Math.floor((score - OBS_START) / 40) + 1)
  const o = occ(snake, [apple, ...extras])
  const r: Pos[] = []
  for (let i = 0; i < n; i++) { const p = spawn(o); o.add(idx(p)); r.push(p) }
  return r
}

function interval(score: number, rush: boolean): number {
  const base = Math.max(MIN_INTERVAL, INIT_INTERVAL - Math.floor(score / SPD_THRESHOLD) * SPD_STEP)
  return rush ? Math.max(MIN_INTERVAL, base * 0.55) : base
}

function spdLvl(score: number) { return Math.floor(score / SPD_THRESHOLD) + 1 }

// Retro dot palette
const C = {
  bg: '#0a1208', grid: '#0d1a0a', cell: '#111e0e',
  body: '#33ff33', bodyDark: '#22cc22', head: '#66ff66', headGlow: 'rgba(51,255,51,0.6)',
  apple: '#ff3333', appleGlow: 'rgba(255,51,51,0.6)',
  golden: '#ffcc00', goldenGlow: 'rgba(255,204,0,0.8)',
  poison: '#cc44ff', poisonGlow: 'rgba(204,68,255,0.6)',
  star: '#ffff44', starGlow: 'rgba(255,255,68,0.8)',
  obs: '#334433',
  shield: '#44aaff', rush: '#ff8833', bomb: '#ff4444', magnet: '#ff44ff', ghost: '#aaffaa',
  trail: 'rgba(51,255,51,0.08)',
  border: '#225522', borderActive: '#33ff33',
  text: '#33ff33', textDim: '#227722',
}

// ══════════════════════════════════════════════════
// COMPONENT
// ══════════════════════════════════════════════════
function SnakeClassicGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [snake, setSnake] = useState<Pos[]>(mkSnake)
  const [apple, setApple] = useState<Pos>(() => spawn(occ(mkSnake(), [])))
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [appleKind, setAppleKind] = useState<AppleKind>('normal')
  const [wallWrap, setWallWrap] = useState(false)
  const [pup, setPup] = useState<Pup | null>(null)
  const [hasShield, setHasShield] = useState(false)
  const [hasRush, setHasRush] = useState(false)
  const [hasMagnet, setHasMagnet] = useState(false)
  const [hasGhost, setHasGhost] = useState(false)
  const [combo, setCombo] = useState(0)
  const [fever, setFever] = useState(false)
  const [reversed, setReversed] = useState(false)
  const [trail, setTrail] = useState<Pos[]>([])
  const [dir, setDir] = useState<Dir>('up')
  const [obs, setObs] = useState<Pos[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [maxCombo, setMaxCombo] = useState(0)
  const [lvlUpFlash, setLvlUpFlash] = useState(0)

  const fx = useGameEffects()

  // ── Refs ──
  const R = useRef({
    snake: mkSnake() as Pos[], apple: spawn(occ(mkSnake(), [])),
    dir: 'up' as Dir, nextDir: 'up' as Dir,
    score: 0, elapsed: 0, over: false, done: false,
    moveAcc: 0, raf: null as number | null, lastFrame: null as number | null,
    pup: null as Pup | null,
    shield: false, shieldExp: 0,
    rush: false, rushExp: 0,
    magnet: false, magnetExp: 0,
    ghost: false, ghostExp: 0,
    trail: [] as Pos[],
    eaten: 0, appleKind: 'normal' as AppleKind,
    combo: 0, lastEat: 0, maxCombo: 0,
    fever: false, feverExp: 0,
    obs: [] as Pos[], stars: [] as Star[],
    reversed: false, reverseExp: 0,
    wallWrap: false,
  })

  const audio = useRef<Map<string, HTMLAudioElement>>(new Map())
  const load = useCallback((k: string, s: string) => { if (!audio.current.has(k)) { const a = new Audio(s); a.preload = 'auto'; audio.current.set(k, a) } }, [])
  const sfx = useCallback((k: string, v: number, r = 1) => { const a = audio.current.get(k); if (!a) return; a.currentTime = 0; a.volume = Math.min(1, Math.max(0, v)); a.playbackRate = r; void a.play().catch(() => {}) }, [])

  const finish = useCallback(() => {
    const r = R.current; if (r.done) return; r.done = true; fx.cleanup()
    onFinish({ score: r.score, durationMs: Math.max(Math.round(r.elapsed), Math.round(DEFAULT_FRAME_MS)) })
  }, [onFinish, fx])

  const chDir = useCallback((nd: Dir) => {
    const r = R.current; if (r.over) return
    const actual = r.reversed ? flipDir(nd) : nd
    if (opp(r.dir, actual)) return
    if (r.nextDir !== actual) { r.nextDir = actual; sfx('turn', 0.2, 1.1) }
  }, [sfx])

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (R.current.over) return
      const m: Record<string, Dir> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
      const d = m[e.code]; if (d) { e.preventDefault(); chDir(d) }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [chDir, onExit])

  // Audio
  useEffect(() => {
    load('eat', snakeEatSfx); load('golden', snakeGoldenSfx); load('combo', snakeComboSfx)
    load('crash', snakeCrashSfx); load('turn', snakeTurnSfx); load('speedup', snakeSpeedUpSfx)
    load('warp', snakeWarpSfx); load('poison', snakePoisonSfx); load('fever', snakeFeverSfx)
    load('bomb', snakeBombSfx); load('star', snakeStarSfx); load('magnet', snakeMagnetSfx)
    load('reverse', snakeReverseSfx); load('levelup', snakeLevelUpSfx); load('perfect', snakePerfectSfx)
    return () => { fx.cleanup(); audio.current.forEach(a => { a.pause(); a.currentTime = 0 }) }
  }, [])

  // ── Game Loop ──
  useEffect(() => {
    const r = R.current; r.lastFrame = null; r.moveAcc = 0

    const die = () => {
      r.over = true; setGameOver(true)
      sfx('crash', 0.7, 0.85); fx.triggerShake(12); fx.triggerFlash('rgba(255,50,50,0.6)')
      finish(); r.raf = null
    }

    const step = (now: number) => {
      if (r.over) { r.raf = null; return }
      if (r.lastFrame === null) r.lastFrame = now
      const dt = Math.min(now - r.lastFrame, MAX_FRAME_DELTA_MS)
      r.lastFrame = now; r.elapsed += dt; setElapsedMs(r.elapsed)
      fx.updateParticles()

      // Expiries
      if (r.shield && now > r.shieldExp) { r.shield = false; setHasShield(false) }
      if (r.rush && now > r.rushExp) { r.rush = false; setHasRush(false) }
      if (r.magnet && now > r.magnetExp) { r.magnet = false; setHasMagnet(false) }
      if (r.ghost && now > r.ghostExp) { r.ghost = false; setHasGhost(false) }
      if (r.fever && now > r.feverExp) { r.fever = false; setFever(false) }
      if (r.reversed && now > r.reverseExp) { r.reversed = false; setReversed(false) }

      // Remove expired stars
      r.stars = r.stars.filter(s => now < s.expiresAt); setStars(r.stars)

      const iv = interval(r.score, r.rush)
      r.moveAcc += dt
      if (r.moveAcc < iv) { r.raf = requestAnimationFrame(step); return }
      r.moveAcc -= iv

      r.dir = r.nextDir; setDir(r.dir)
      const cur = r.snake, head = cur[0]
      let nh = mv(head, r.dir)

      // Trail
      r.trail = [head, ...r.trail].slice(0, 10); setTrail(r.trail)

      // Wall wrap
      const ww = r.score >= WALL_WRAP_AT
      if (ww !== r.wallWrap) { r.wallWrap = ww; setWallWrap(ww) }

      if (oob(nh)) {
        if (ww) { nh = { x: ((nh.x % G) + G) % G, y: ((nh.y % G) + G) % G }; sfx('warp', 0.35, 1.0) }
        else if (r.shield) { r.shield = false; setHasShield(false); nh = head; fx.triggerFlash('rgba(68,170,255,0.4)'); fx.triggerShake(4) }
        else if (r.ghost) { nh = { x: ((nh.x % G) + G) % G, y: ((nh.y % G) + G) % G } }
        else { die(); return }
      }

      // Obstacle
      if (r.obs.some(o => eq(nh, o))) {
        if (r.ghost) { /* pass through */ }
        else if (r.shield) { r.shield = false; setHasShield(false); nh = head; fx.triggerFlash('rgba(68,170,255,0.4)'); fx.triggerShake(4) }
        else { die(); return }
      }

      // Self collision
      if (cur.some((s, i) => i > 0 && eq(nh, s))) {
        if (r.ghost) { /* pass through */ }
        else if (r.shield) { r.shield = false; setHasShield(false); nh = head; fx.triggerFlash('rgba(68,170,255,0.4)'); fx.triggerShake(4) }
        else { die(); return }
      }

      // ── Collect star ──
      const starHit = r.stars.findIndex(s => eq(nh, s.pos))
      if (starHit >= 0) {
        r.stars.splice(starHit, 1); setStars([...r.stars])
        r.score += PTS_STAR; setScore(r.score)
        sfx('star', 0.6, 1.2)
        const ex = nh.x * (100 / G) + (50 / G), ey = nh.y * (100 / G) + (50 / G)
        fx.comboHitBurst(ex, ey, r.eaten, PTS_STAR)
      }

      // ── Eat apple ──
      const ate = eq(nh, r.apple)
      let next: Pos[]

      if (ate) {
        const kind = r.appleKind

        if (kind === 'poison') {
          next = cur.length > POISON_SHRINK + 1 ? [nh, ...cur.slice(0, -POISON_SHRINK)] : [nh]
          sfx('poison', 0.6, 1.0); fx.triggerFlash('rgba(204,68,255,0.35)'); fx.triggerShake(4)
          // Reverse controls as penalty!
          r.reversed = true; r.reverseExp = now + REVERSE_MS; setReversed(true)
          sfx('reverse', 0.5, 1.0)
          r.combo = 0; setCombo(0)
        } else {
          next = [nh, ...cur]; r.eaten += 1

          // Combo
          const since = now - r.lastEat
          if (since < COMBO_WINDOW && r.lastEat > 0) r.combo += 1; else r.combo = 1
          r.lastEat = now; setCombo(r.combo)
          if (r.combo > r.maxCombo) { r.maxCombo = r.combo; setMaxCombo(r.combo) }

          // Fever
          if (r.combo >= FEVER_AT && !r.fever) {
            r.fever = true; r.feverExp = now + FEVER_MS; setFever(true)
            sfx('fever', 0.7, 1.0); fx.triggerFlash('rgba(255,204,0,0.3)')
          }

          // Score
          const cmul = Math.min(r.combo, 5)
          const base = kind === 'golden' ? PTS_GOLDEN : PTS_APPLE
          const fmul = r.fever ? FEVER_MUL : 1
          const pts = base * cmul * fmul
          const prev = r.score; r.score += pts; setScore(r.score)

          // Level up flash
          const prevLvl = spdLvl(prev), newLvl = spdLvl(r.score)
          if (newLvl > prevLvl) {
            sfx('levelup', 0.6, 1.0); setLvlUpFlash(newLvl)
            setTimeout(() => setLvlUpFlash(0), 1200)
          }

          // Sound
          if (kind === 'golden') { sfx('golden', 0.7, 1.2) }
          else { sfx('eat', 0.5, 1 + Math.min(0.5, r.eaten * 0.015)) }
          if (r.combo >= 3) sfx('combo', 0.5, 0.9 + r.combo * 0.08)

          // Perfect combo milestone
          if (r.combo === 10) { sfx('perfect', 0.7, 1.0); fx.triggerFlash('rgba(255,255,68,0.3)') }

          // Burst
          const ex = nh.x * (100 / G) + (50 / G), ey = nh.y * (100 / G) + (50 / G)
          fx.comboHitBurst(ex, ey, r.eaten, pts)
        }

        // Next apple
        const extras = r.pup ? [r.pup.pos] : []
        const na = spawn(occ(next, [...extras, ...r.obs, ...r.stars.map(s => s.pos)]))
        r.apple = na; setApple(na)

        // Next kind
        const isGolden = r.eaten % GOLDEN_EVERY === (GOLDEN_EVERY - 1)
        const isPoisonRoll = !isGolden && r.eaten > 4 && Math.random() < POISON_CHANCE
        const nk: AppleKind = isGolden ? 'golden' : isPoisonRoll ? 'poison' : 'normal'
        r.appleKind = nk; setAppleKind(nk)

        // Power-up spawn
        if (!r.pup && r.eaten > 2) {
          let rand = Math.random(), pt: PupType | null = null
          if ((rand -= PUP_SHIELD_CHANCE) < 0) pt = 'shield'
          else if ((rand -= PUP_RUSH_CHANCE) < 0) pt = 'rush'
          else if ((rand -= PUP_BOMB_CHANCE) < 0) pt = 'bomb'
          else if ((rand -= PUP_MAGNET_CHANCE) < 0) pt = 'magnet'
          else if ((rand -= PUP_GHOST_CHANCE) < 0) pt = 'ghost'
          if (pt) { const p: Pup = { pos: spawn(occ(next, [na, ...r.obs])), type: pt }; r.pup = p; setPup(p) }
        }

        // Star spawn
        if (Math.random() < STAR_SPAWN_CHANCE && r.stars.length < 3) {
          const sp = spawn(occ(next, [na, ...r.obs, ...(r.pup ? [r.pup.pos] : [])]))
          r.stars.push({ pos: sp, expiresAt: now + STAR_LIFETIME_MS }); setStars([...r.stars])
        }

        // Obstacles
        if (r.score >= OBS_START) {
          const o = mkObs(r.score, next, na, r.pup ? [r.pup.pos] : [])
          r.obs = o; setObs(o)
        }

        if (next.length >= CELLS) { r.over = true; setGameOver(true); finish(); r.raf = null; return }
      } else {
        next = [nh, ...cur.slice(0, -1)]
      }

      // Magnet: move apple toward head
      if (r.magnet && !ate) {
        const a = r.apple, h = nh
        const dx = h.x - a.x, dy = h.y - a.y
        const dist = Math.abs(dx) + Math.abs(dy)
        if (dist > 1 && dist < 6) {
          const nx = a.x + Math.sign(dx), ny = a.y + Math.sign(dy)
          const np = { x: Math.max(0, Math.min(G - 1, nx)), y: Math.max(0, Math.min(G - 1, ny)) }
          if (!next.some(s => eq(s, np)) && !r.obs.some(o => eq(o, np))) {
            r.apple = np; setApple(np)
          }
        }
      }

      // Collect power-up
      if (r.pup && eq(nh, r.pup.pos)) {
        const t = r.pup.type
        if (t === 'shield') { r.shield = true; r.shieldExp = now + SHIELD_MS; setHasShield(true); fx.triggerFlash('rgba(68,170,255,0.25)'); sfx('golden', 0.5, 1.5) }
        else if (t === 'rush') { r.rush = true; r.rushExp = now + RUSH_MS; setHasRush(true); fx.triggerFlash('rgba(255,136,51,0.25)'); sfx('speedup', 0.6, 1.3) }
        else if (t === 'bomb') { r.obs = []; setObs([]); fx.triggerFlash('rgba(255,68,68,0.35)'); fx.triggerShake(6); sfx('bomb', 0.7, 1.0); r.score += 30; setScore(r.score) }
        else if (t === 'magnet') { r.magnet = true; r.magnetExp = now + MAGNET_MS; setHasMagnet(true); fx.triggerFlash('rgba(255,68,255,0.25)'); sfx('magnet', 0.6, 1.0) }
        else if (t === 'ghost') { r.ghost = true; r.ghostExp = now + GHOST_MS; setHasGhost(true); fx.triggerFlash('rgba(170,255,170,0.25)'); sfx('warp', 0.5, 1.3) }
        r.pup = null; setPup(null)
      }

      r.snake = next; setSnake(next)
      r.raf = requestAnimationFrame(step)
    }

    r.raf = requestAnimationFrame(step)
    return () => { if (r.raf !== null) cancelAnimationFrame(r.raf); r.lastFrame = null }
  }, [finish, sfx, fx])

  // ── Render data ──
  const snakeSet = new Set(snake.map(idx))
  const headIdx = idx(snake[0])
  const appleIdx = idx(apple)
  const trailSet = new Set(trail.map(idx))
  const pupIdx = pup ? idx(pup.pos) : -1
  const obsSet = new Set(obs.map(idx))
  const starSet = new Set(stars.map(s => idx(s.pos)))
  const bestDisp = Math.max(bestScore, score)
  const lv = spdLvl(score)
  const iv = interval(score, hasRush)
  const lenPct = Math.min(100, (snake.length / (CELLS * 0.5)) * 100)
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  const cells = []
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
    const i = idx({ x, y })
    let c = 'sc-c'
    if (i === headIdx) c += ' sc-hd'
    else if (snakeSet.has(i)) c += ' sc-bd'
    else if (i === appleIdx) c += appleKind === 'golden' ? ' sc-gd' : appleKind === 'poison' ? ' sc-ps' : ' sc-ap'
    else if (starSet.has(i)) c += ' sc-st'
    else if (i === pupIdx) c += ` sc-pu-${pup?.type ?? 'shield'}`
    else if (obsSet.has(i)) c += ' sc-ob'
    else if (trailSet.has(i)) c += ' sc-tr'
    cells.push(<div key={i} className={c} />)
  }

  // Swipe
  const tiR = useRef<number | null>(null), tsR = useRef<{ x: number; y: number } | null>(null)
  const onTS = useCallback((e: React.TouchEvent) => { if (e.touches.length > 0) { const t = e.touches[0]; tiR.current = t.identifier; tsR.current = { x: t.clientX, y: t.clientY } } }, [])
  const onTE = useCallback((e: React.TouchEvent) => {
    if (!tsR.current || tiR.current === null) return
    let t: React.Touch | null = null
    for (let i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === tiR.current) { t = e.changedTouches[i]; break }
    if (!t) return
    const dx = t.clientX - tsR.current.x, dy = t.clientY - tsR.current.y
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { tiR.current = null; tsR.current = null; return }
    chDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
    tiR.current = null; tsR.current = null
  }, [chDir])

  return (
    <section className="mini-game-panel sc-p" aria-label="snake-classic-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...fx.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}
        .sc-p {
          display:flex; flex-direction:column; align-items:center; width:100%; height:100%;
          max-width:432px; margin:0 auto; user-select:none; -webkit-user-select:none;
          background:${C.bg}; padding:4px 4px 6px; box-sizing:border-box;
          font-family:'Press Start 2P','Courier New',monospace; image-rendering:pixelated;
        }
        ${fever ? `.sc-p::before { content:''; position:absolute; inset:0; background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,204,0,0.03) 2px,rgba(255,204,0,0.03) 4px); pointer-events:none; z-index:1; animation:sc-fev 0.3s ease-in-out infinite alternate; }
        @keyframes sc-fev { from{opacity:0.5} to{opacity:1} }` : ''}

        /* CRT scanline overlay */
        .sc-scan { position:absolute; inset:0; pointer-events:none; z-index:3;
          background:repeating-linear-gradient(0deg,transparent,transparent 1px,rgba(0,0,0,0.15) 1px,rgba(0,0,0,0.15) 2px); }

        /* HUD */
        .sc-h { display:flex; align-items:center; justify-content:space-between; width:100%; padding:2px 6px; flex-shrink:0; z-index:2; }
        .sc-hl { display:flex; flex-direction:column; }
        .sc-sc { font-size:1.8rem; font-weight:900; color:${C.text}; margin:0; line-height:1; text-shadow:0 0 8px ${C.headGlow}; letter-spacing:2px; }
        ${fever ? `.sc-sc { color:${C.golden}; text-shadow:0 0 12px ${C.goldenGlow}; animation:sc-fsc 0.25s infinite alternate; }
        @keyframes sc-fsc { from{transform:scale(1)} to{transform:scale(1.04)} }` : ''}
        .sc-bs { font-size:0.5rem; color:${C.textDim}; margin:0; letter-spacing:1px; }
        .sc-hr { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
        .sc-bg { font-size:0.45rem; font-weight:700; padding:1px 5px; border:1px solid ${C.border}; color:${C.textDim}; letter-spacing:0.5px; }
        .sc-cb { font-size:0.6rem; font-weight:900; padding:2px 6px; border:1px solid; animation:sc-cp 0.3s ease; letter-spacing:1px; }
        @keyframes sc-cp { 0%{transform:scale(0.5);opacity:0} 60%{transform:scale(1.3)} 100%{transform:scale(1);opacity:1} }

        /* Status */
        .sc-st-bar { display:flex; gap:3px; justify-content:center; width:100%; flex-shrink:0; min-height:14px; flex-wrap:wrap; z-index:2; }
        .sc-pill { font-size:0.4rem; font-weight:800; padding:1px 5px; border:1px solid; letter-spacing:0.5px; animation:sc-pp 0.8s ease-in-out infinite alternate; }
        @keyframes sc-pp { from{opacity:0.7} to{opacity:1} }

        /* Length bar */
        .sc-lb-w { width:100%; height:3px; background:${C.cell}; flex-shrink:0; overflow:hidden; border:1px solid ${C.border}; z-index:2; }
        .sc-lb { height:100%; transition:width 0.3s ease; }

        /* Level up flash */
        .sc-lvl { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:1.2rem; font-weight:900; color:${C.golden};
          text-shadow:0 0 20px ${C.goldenGlow}; z-index:20; animation:sc-lvla 1.2s ease-out forwards; pointer-events:none; letter-spacing:2px; }
        @keyframes sc-lvla { 0%{opacity:0;transform:translate(-50%,-50%) scale(2)} 20%{opacity:1;transform:translate(-50%,-50%) scale(1)} 80%{opacity:1} 100%{opacity:0;transform:translate(-50%,-80%) scale(0.8)} }

        /* Reverse warning */
        ${reversed ? `.sc-p::after { content:'REVERSED!'; position:absolute; top:30%; left:50%; transform:translate(-50%,-50%);
          font-size:0.7rem; color:${C.poison}; text-shadow:0 0 10px ${C.poisonGlow}; z-index:20; animation:sc-rev 0.5s ease-in-out infinite alternate;
          pointer-events:none; letter-spacing:2px; font-weight:900; }
        @keyframes sc-rev { from{opacity:0.4;transform:translate(-50%,-50%) scale(0.95)} to{opacity:1;transform:translate(-50%,-50%) scale(1.05)} }` : ''}

        /* Grid */
        .sc-gw { position:relative; width:100%; flex:1; min-height:0; touch-action:none; display:flex; align-items:center; justify-content:center; padding:2px 0; z-index:2; }
        .sc-gb { position:relative; width:100%; max-height:100%; aspect-ratio:1/1; }
        .sc-g { display:grid; grid-template-columns:repeat(${G},1fr); grid-template-rows:repeat(${G},1fr);
          width:100%; height:100%; background:${C.grid}; border:2px solid ${C.border}; overflow:hidden; gap:1px; }
        ${hasShield ? `.sc-g { border-color:${C.shield}; box-shadow:0 0 12px rgba(68,170,255,0.3); }` : ''}
        ${hasRush ? `.sc-g { border-color:${C.rush}; box-shadow:0 0 12px rgba(255,136,51,0.3); }` : ''}
        ${fever ? `.sc-g { border-color:${C.golden}; box-shadow:0 0 16px ${C.goldenGlow}; }` : ''}
        ${hasGhost ? `.sc-g { border-color:${C.ghost}; box-shadow:0 0 12px rgba(170,255,170,0.3); }` : ''}

        .sc-c { background:${C.cell}; }
        .sc-bd { background:${C.body}; box-shadow:inset 1px 1px 0 ${C.bodyDark}; }
        .sc-hd { background:${C.head}; box-shadow:0 0 6px ${C.headGlow},inset 1px 1px 0 rgba(255,255,255,0.3); }
        ${hasGhost ? `.sc-bd,.sc-hd { opacity:0.6; }` : ''}
        .sc-tr { background:${C.trail}; }
        .sc-ap { background:${C.apple}; box-shadow:0 0 4px ${C.appleGlow}; animation:sc-apu 0.6s ease-in-out infinite alternate; }
        .sc-gd { background:${C.golden}; box-shadow:0 0 8px ${C.goldenGlow}; animation:sc-gpu 0.3s ease-in-out infinite alternate; }
        .sc-ps { background:${C.poison}; box-shadow:0 0 6px ${C.poisonGlow}; animation:sc-ppu 0.4s ease-in-out infinite alternate; }
        .sc-st { background:${C.star}; box-shadow:0 0 8px ${C.starGlow}; animation:sc-spu 0.5s ease-in-out infinite alternate; }
        .sc-ob { background:${C.obs}; box-shadow:inset 1px 1px 0 rgba(0,0,0,0.4); }
        .sc-pu-shield { background:${C.shield}; box-shadow:0 0 6px rgba(68,170,255,0.6); animation:sc-pfl 0.8s ease-in-out infinite alternate; }
        .sc-pu-rush { background:${C.rush}; box-shadow:0 0 6px rgba(255,136,51,0.6); animation:sc-pfl 0.5s ease-in-out infinite alternate; }
        .sc-pu-bomb { background:${C.bomb}; box-shadow:0 0 6px rgba(255,68,68,0.6); animation:sc-pfl 0.6s ease-in-out infinite alternate; }
        .sc-pu-magnet { background:${C.magnet}; box-shadow:0 0 6px rgba(255,68,255,0.6); animation:sc-pfl 0.7s ease-in-out infinite alternate; }
        .sc-pu-ghost { background:${C.ghost}; box-shadow:0 0 6px rgba(170,255,170,0.6); animation:sc-pfl 0.9s ease-in-out infinite alternate; }

        @keyframes sc-apu { from{transform:scale(0.75)} to{transform:scale(1)} }
        @keyframes sc-gpu { from{transform:scale(0.8);box-shadow:0 0 4px ${C.goldenGlow}} to{transform:scale(1.1);box-shadow:0 0 12px ${C.goldenGlow}} }
        @keyframes sc-ppu { from{transform:scale(0.7);opacity:0.6} to{transform:scale(1);opacity:1} }
        @keyframes sc-spu { from{transform:scale(0.8) rotate(0deg)} to{transform:scale(1.1) rotate(20deg)} }
        @keyframes sc-pfl { from{transform:scale(0.7)} to{transform:scale(1.1)} }

        .sc-ov .sc-g { opacity:0.3; filter:grayscale(0.6); }
        .sc-ol { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; pointer-events:none; z-index:10; }
        .sc-olt { font-size:1.6rem; font-weight:900; color:${C.apple}; text-shadow:0 0 20px ${C.appleGlow}; animation:sc-goa 0.5s cubic-bezier(0.34,1.56,0.64,1); letter-spacing:3px; }
        .sc-ols { font-size:0.7rem; font-weight:700; color:${C.golden}; text-shadow:0 0 8px rgba(0,0,0,0.5); letter-spacing:1px; }
        .sc-olst { font-size:0.4rem; color:${C.textDim}; letter-spacing:0.5px; }
        @keyframes sc-goa { 0%{transform:scale(3) rotate(-10deg);opacity:0} 100%{transform:scale(1) rotate(0);opacity:1} }

        /* D-Pad */
        .sc-dp { display:flex; flex-direction:column; align-items:center; gap:2px; flex-shrink:0; padding:2px 0; z-index:2; }
        .sc-dr { display:flex; align-items:center; gap:2px; }
        .sc-db { width:clamp(46px,12vw,56px); height:clamp(46px,12vw,56px); border:2px solid ${C.border}; border-radius:0; background:${C.cell};
          color:${C.textDim}; font-size:1.2rem; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.08s;
          -webkit-tap-highlight-color:transparent; font-family:inherit; }
        .sc-db:active { background:${C.body}; color:${C.bg}; border-color:${C.body}; }
        .sc-dc { width:clamp(46px,12vw,56px); height:clamp(46px,12vw,56px); display:flex; align-items:center; justify-content:center;
          font-size:0.9rem; color:${C.text}; font-weight:900; opacity:0.5; }

        /* Actions */
        .sc-ac { display:flex; gap:6px; flex-shrink:0; padding:2px 0; z-index:2; }
        .sc-ab { padding:6px 16px; border:2px solid ${C.body}; border-radius:0; background:transparent; color:${C.body};
          font-weight:800; font-size:0.6rem; cursor:pointer; transition:all 0.1s; font-family:inherit; letter-spacing:1px; }
        .sc-ab:active { background:${C.body}; color:${C.bg}; }
        .sc-ab.gh { border-color:${C.border}; color:${C.textDim}; }
        .sc-ab.gh:active { background:${C.border}; color:${C.bg}; }
      `}</style>

      <div className="sc-scan" />
      <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
      <ParticleRenderer particles={fx.particles} />
      <ScorePopupRenderer popups={fx.scorePopups} />
      {lvlUpFlash > 0 && <div className="sc-lvl">LEVEL {lvlUpFlash}!</div>}

      {/* HUD */}
      <div className="sc-h">
        <div className="sc-hl">
          <p className="sc-sc">{score}</p>
          <p className="sc-bs">BEST {bestDisp}</p>
        </div>
        <div className="sc-hr">
          <span className="sc-bg">LV.{lv} {iv}MS</span>
          <span className="sc-bg">{snake.length}T {(elapsedMs / 1000).toFixed(1)}S</span>
          {combo >= 2 && (
            <span className="sc-cb" style={{ color: comboColor, borderColor: comboColor }}>
              {combo}X{comboLabel ? ` ${comboLabel}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Status */}
      <div className="sc-st-bar">
        {fever && <span className="sc-pill" style={{ color: C.golden, borderColor: C.golden }}>FEVER X{FEVER_MUL}</span>}
        {appleKind === 'golden' && <span className="sc-pill" style={{ color: C.golden, borderColor: C.golden }}>GOLDEN</span>}
        {appleKind === 'poison' && <span className="sc-pill" style={{ color: C.poison, borderColor: C.poison }}>POISON</span>}
        {hasShield && <span className="sc-pill" style={{ color: C.shield, borderColor: C.shield }}>SHIELD</span>}
        {hasRush && <span className="sc-pill" style={{ color: C.rush, borderColor: C.rush }}>RUSH</span>}
        {hasMagnet && <span className="sc-pill" style={{ color: C.magnet, borderColor: C.magnet }}>MAGNET</span>}
        {hasGhost && <span className="sc-pill" style={{ color: C.ghost, borderColor: C.ghost }}>GHOST</span>}
        {reversed && <span className="sc-pill" style={{ color: C.poison, borderColor: C.poison }}>REVERSE</span>}
        {wallWrap && <span className="sc-pill" style={{ color: C.ghost, borderColor: C.ghost }}>WARP</span>}
        {obs.length > 0 && <span className="sc-pill" style={{ color: C.obs, borderColor: C.obs }}>BLOCKS</span>}
      </div>

      {/* Length bar */}
      <div className="sc-lb-w">
        <div className="sc-lb" style={{
          width: `${lenPct}%`,
          background: fever ? C.golden : lenPct > 70 ? C.apple : lenPct > 40 ? C.rush : C.body,
        }} />
      </div>

      {/* Grid */}
      <div className={`sc-gw ${gameOver ? 'sc-ov' : ''}`} onTouchStart={onTS} onTouchEnd={onTE} role="presentation">
        <div className="sc-gb">
          <div className="sc-g">{cells}</div>
          {gameOver && (
            <div className="sc-ol">
              <span className="sc-olt">GAME OVER</span>
              <span className="sc-ols">{score} PTS</span>
              <span className="sc-olst">{snake.length}T | {R.current.eaten} APPLES | MAX {maxCombo}X</span>
            </div>
          )}
        </div>
      </div>

      {/* D-Pad */}
      <div className="sc-dp">
        <div className="sc-dr"><button className="sc-db" type="button" onClick={() => chDir('up')} aria-label="up">&#9650;</button></div>
        <div className="sc-dr">
          <button className="sc-db" type="button" onClick={() => chDir('left')} aria-label="left">&#9664;</button>
          <div className="sc-dc">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : dir === 'left' ? '◀' : '▶'}</div>
          <button className="sc-db" type="button" onClick={() => chDir('right')} aria-label="right">&#9654;</button>
        </div>
        <div className="sc-dr"><button className="sc-db" type="button" onClick={() => chDir('down')} aria-label="down">&#9660;</button></div>
      </div>

      {/* Actions */}
      <div className="sc-ac">
        <button className="sc-ab" type="button" onClick={() => {
          if (!R.current.over) { R.current.over = true; setGameOver(true); sfx('crash', 0.5, 1); fx.triggerShake(6); finish() }
        }}>FINISH</button>
        <button className="sc-ab gh" type="button" onClick={onExit}>EXIT</button>
      </div>
    </section>
  )
}

export const snakeClassicModule: MiniGameModule = {
  manifest: {
    id: 'snake-classic',
    title: 'Snake Classic',
    description: 'Retro dot snake! Eat apples, dodge blocks, chain combos & trigger FEVER!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#33ff33',
  },
  Component: SnakeClassicGame,
}
