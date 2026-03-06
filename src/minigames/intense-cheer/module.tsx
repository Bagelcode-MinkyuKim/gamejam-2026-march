import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ── View (pixel grid) ──
const VW = 128
const VH = 224
const PX = 4  // pixel size unit

// ── Physics ──
const GRAVITY = 240
const BOOST_UP = -105
const H_SPEED = 100
const MAX_FALL = 180
const H_DRAG = 0.93
const PLAYER_W = 12
const PLAYER_H = 14
const PH_X = PLAYER_W / 2
const PH_Y = PLAYER_H / 2

// ── Balance ──
const HEART_DECAY = 2.8
const HEART_MAX = 100
const HEART_PICKUP = 25
const COIN_BONUS = 50
const CAMERA_LERP = 0.14
const FLOOR_Y = 0

// ── World Gen ──
const LAYER_H = 40
const GEN_AHEAD = 600
const OBS_W = 10
const OBS_H = 10
const WALL_TH = PX
const MIN_GAP = 32
const SPRING_W = 14
const SPRING_H = PX
const SPRING_BOOST = -145

// ── Object Types ──
type ObjKind = 'spike' | 'wall' | 'moving-spike' | 'spring' | 'heart' | 'coin' | 'pillar' | 'zigzag-wall'

interface WorldObj {
  readonly id: number
  readonly kind: ObjKind
  x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly moveRange?: number
  readonly moveSpeed?: number
  movePhase?: number
  collected: boolean
}

interface PlayerState { x: number; y: number; vx: number; vy: number; facingRight: boolean }
interface HitFx { readonly id: number; readonly x: number; readonly y: number; readonly text: string; readonly color: string; readonly createdAt: number }

let _id = 0
function nid(): number { return _id++ }
function rng(a: number, b: number): number { return a + Math.random() * (b - a) }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)) }
// Snap to pixel grid
function snap(v: number): number { return Math.round(v / PX) * PX }

function doesOverlap(objs: WorldObj[], x: number, y: number, w: number, h: number): boolean {
  for (const o of objs) {
    if (o.collected) continue
    if (Math.abs(o.x - x) < (o.w + w) / 2 + PX && Math.abs(o.y - y) < (o.h + h) / 2 + PX) return true
  }
  return false
}

function generateLayer(layerY: number): WorldObj[] {
  const objs: WorldObj[] = []
  const zone = Math.floor(-layerY / 400)

  let wallGapX = VW / 2
  let wallGapW = VW
  let wallY = -9999
  const hasWall = zone >= 1 && Math.random() < 0.2 + Math.min(zone * 0.04, 0.2)

  if (hasWall) {
    wallGapW = Math.max(MIN_GAP, 48 - Math.min(zone, 5) * 2)
    wallGapX = snap(rng(wallGapW / 2 + 8, VW - wallGapW / 2 - 8))
    wallY = snap(layerY + rng(10, LAYER_H - 10))
    const le = wallGapX - wallGapW / 2
    const re = wallGapX + wallGapW / 2
    if (le > PX) objs.push({ id: nid(), kind: 'wall', x: le / 2, y: wallY, w: le, h: WALL_TH, collected: false })
    if (re < VW - PX) objs.push({ id: nid(), kind: 'wall', x: (re + VW) / 2, y: wallY, w: VW - re, h: WALL_TH, collected: false })
  }

  const isInGap = (x: number, y: number) => {
    if (!hasWall) return false
    return Math.abs(y - wallY) < WALL_TH + PH_Y + 6 && x > wallGapX - wallGapW / 2 - PX && x < wallGapX + wallGapW / 2 + PX
  }

  // Spike (0-1)
  if (Math.random() < 0.45) {
    for (let a = 0; a < 12; a++) {
      const sx = snap(rng(OBS_W, VW - OBS_W))
      const sy = snap(layerY + rng(4, LAYER_H - 4))
      if (!doesOverlap(objs, sx, sy, OBS_W, OBS_H) && !isInGap(sx, sy)) {
        objs.push({ id: nid(), kind: 'spike', x: sx, y: sy, w: OBS_W, h: OBS_H, collected: false })
        break
      }
    }
  }

  // Pillar from side (zone 1+)
  if (!hasWall && zone >= 1 && Math.random() < 0.2) {
    const left = Math.random() < 0.5
    const pw = snap(rng(20, 44))
    const py = snap(layerY + rng(8, LAYER_H - 8))
    objs.push({ id: nid(), kind: 'pillar', x: left ? pw / 2 : VW - pw / 2, y: py, w: pw, h: PX, collected: false })
  }

  // Zigzag wall (zone 2+)
  if (!hasWall && zone >= 2 && Math.random() < 0.15) {
    const left = Math.random() < 0.5
    const zw = snap(rng(28, 48))
    const zy = snap(layerY + rng(8, LAYER_H - 8))
    objs.push({ id: nid(), kind: 'zigzag-wall', x: left ? zw / 2 : VW - zw / 2, y: zy, w: zw, h: WALL_TH, collected: false })
  }

  // Moving spike (zone 3+)
  if (zone >= 3 && !hasWall && Math.random() < 0.1) {
    const my = snap(layerY + rng(8, LAYER_H - 8))
    objs.push({ id: nid(), kind: 'moving-spike', x: VW / 2, y: my, w: OBS_W + 2, h: OBS_H + 2, moveRange: rng(16, 32), moveSpeed: rng(20, 36), movePhase: Math.random() * Math.PI * 2, collected: false })
  }

  // Spring
  if (Math.random() < 0.18) {
    for (let a = 0; a < 6; a++) {
      const sx = snap(rng(SPRING_W, VW - SPRING_W))
      const sy = snap(layerY + rng(8, LAYER_H - 8))
      if (!doesOverlap(objs, sx, sy, SPRING_W, SPRING_H + 4)) {
        objs.push({ id: nid(), kind: 'spring', x: sx, y: sy, w: SPRING_W, h: SPRING_H, collected: false })
        break
      }
    }
  }

  // Coin
  if (Math.random() < 0.4) {
    for (let a = 0; a < 6; a++) {
      const cx = snap(rng(8, VW - 8))
      const cy = snap(layerY + rng(6, LAYER_H - 6))
      if (!doesOverlap(objs, cx, cy, 8, 8)) {
        objs.push({ id: nid(), kind: 'coin', x: cx, y: cy, w: 8, h: 8, collected: false })
        break
      }
    }
  }

  // Heart (20%)
  if (Math.random() < 0.20) {
    for (let a = 0; a < 6; a++) {
      const hx = snap(rng(8, VW - 8))
      const hy = snap(layerY + rng(6, LAYER_H - 6))
      if (!doesOverlap(objs, hx, hy, 8, 8)) {
        objs.push({ id: nid(), kind: 'heart', x: hx, y: hy, w: 8, h: 8, collected: false })
        break
      }
    }
  }

  return objs
}

function skyColors(h: number): [string, string] {
  if (h < 400) return ['#100820', '#1a1040']
  if (h < 1000) return ['#081828', '#102848']
  if (h < 2000) return ['#180828', '#301050']
  return ['#280808', '#481010']
}

// ── Pixel art drawing helpers (SVG rects) ──
function PixSpike({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 4} y={y - 4} width={8} height={8} fill="#e03040" shapeRendering="crispEdges" />
      <rect x={x - 2} y={y - 6} width={4} height={2} fill="#e03040" shapeRendering="crispEdges" />
      <rect x={x - 1} y={y - 1} width={2} height={2} fill="#fff" shapeRendering="crispEdges" />
    </g>
  )
}
function PixCoin({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 3} y={y - 3} width={6} height={6} fill="#f0c020" shapeRendering="crispEdges" />
      <rect x={x - 1} y={y - 1} width={2} height={2} fill="#fff8d0" shapeRendering="crispEdges" />
    </g>
  )
}
function PixHeart({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x - 3} y={y - 2} width={6} height={4} fill="#e04060" shapeRendering="crispEdges" />
      <rect x={x - 4} y={y - 1} width={2} height={2} fill="#e04060" shapeRendering="crispEdges" />
      <rect x={x + 2} y={y - 1} width={2} height={2} fill="#e04060" shapeRendering="crispEdges" />
      <rect x={x - 1} y={y + 2} width={2} height={2} fill="#e04060" shapeRendering="crispEdges" />
      <rect x={x - 1} y={y - 1} width={2} height={2} fill="#ff8090" shapeRendering="crispEdges" />
    </g>
  )
}
function PixSpring({ x, y, w }: { x: number; y: number; w: number }) {
  return (
    <g>
      <rect x={x - w / 2} y={y - 2} width={w} height={4} fill="#40c060" shapeRendering="crispEdges" />
      <rect x={x - w / 2 + 2} y={y - 4} width={2} height={2} fill="#40c060" shapeRendering="crispEdges" />
      <rect x={x + w / 2 - 4} y={y - 4} width={2} height={2} fill="#40c060" shapeRendering="crispEdges" />
    </g>
  )
}

function DungaDungaGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [player, setPlayer] = useState<PlayerState>({ x: VW / 2, y: FLOOR_Y, vx: 0, vy: 0, facingRight: true })
  const [objects, setObjects] = useState<WorldObj[]>([])
  const [camY, setCamY] = useState(0)
  const [heart, setHeart] = useState(HEART_MAX)
  const [score, setScore] = useState(0)
  const [coins, setCoins] = useState(0)
  const [hitFxList, setHitFxList] = useState<HitFx[]>([])

  const pRef = useRef(player)
  const objRef = useRef<WorldObj[]>([])
  const camRef = useRef(0)
  const heartR = useRef(HEART_MAX)
  const coinR = useRef(0)
  const elR = useRef(0)
  const doneR = useRef(false)
  const afR = useRef<number | null>(null)
  const lfR = useRef<number | null>(null)
  const genR = useRef(0)
  const maxHR = useRef(0)
  const fxR = useRef<HitFx[]>([])
  const objVersionR = useRef(0)
  const lastObjVersionR = useRef(-1)

  const sfxJump = useRef<HTMLAudioElement | null>(null)
  const sfxCoin = useRef<HTMLAudioElement | null>(null)
  const sfxCrash = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((s: HTMLAudioElement | null, v: number, r = 1) => {
    if (!s) return; s.currentTime = 0; s.volume = v; s.playbackRate = r; void s.play().catch(() => {})
  }, [])

  const addFx = useCallback((x: number, y: number, text: string, color: string) => {
    fxR.current = [...fxR.current, { id: nid(), x, y, text, color, createdAt: elR.current }]
  }, [])

  const finish = useCallback(() => {
    if (doneR.current) return
    doneR.current = true
    onFinish({ score: Math.floor(maxHR.current * 0.5 + coinR.current * COIN_BONUS), durationMs: elR.current > 0 ? elR.current : 16 })
  }, [onFinish])

  const doFloat = useCallback((dir: 'left' | 'right') => {
    if (doneR.current) return
    const p = pRef.current
    p.vy = BOOST_UP
    p.vx = dir === 'right' ? H_SPEED : -H_SPEED
    p.facingRight = dir === 'right'
    playSfx(sfxJump.current, 0.3, 0.8 + Math.random() * 0.3)
  }, [playSfx])

  const onPtrDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    doFloat(e.clientX - r.left < r.width / 2 ? 'left' : 'right')
  }, [doFloat])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'ArrowLeft') { e.preventDefault(); doFloat('left') }
      else if (e.code === 'ArrowRight') { e.preventDefault(); doFloat('right') }
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [doFloat])

  useEffect(() => {
    const a1 = new Audio(tapHitSfx); a1.preload = 'auto'; sfxJump.current = a1
    const a2 = new Audio(tapHitStrongSfx); a2.preload = 'auto'; sfxCoin.current = a2
    const a3 = new Audio(gameOverHitSfx); a3.preload = 'auto'; sfxCrash.current = a3
    return () => { for (const a of [a1, a2, a3]) { a.pause(); a.currentTime = 0 } }
  }, [])

  useEffect(() => {
    lfR.current = null
    const init: WorldObj[] = []
    for (let ly = -LAYER_H * 2; ly > -GEN_AHEAD; ly -= LAYER_H) init.push(...generateLayer(ly))
    objRef.current = init; genR.current = -GEN_AHEAD
    objVersionR.current++
    setObjects([...init])
    camRef.current = FLOOR_Y - VH * 0.4
    setCamY(camRef.current)

    const step = (now: number) => {
      if (doneR.current) { afR.current = null; return }
      if (lfR.current === null) lfR.current = now
      const dMs = Math.min(now - lfR.current, MAX_FRAME_DELTA_MS)
      lfR.current = now; elR.current += dMs
      const dt = dMs / 1000

      const p = { ...pRef.current }
      const w = objRef.current
      let hp = heartR.current; let cn = coinR.current
      let objChanged = false

      p.vy += GRAVITY * dt
      p.vy = Math.min(p.vy, MAX_FALL)
      p.vx *= Math.pow(H_DRAG, dt * 60)
      p.x += p.vx * dt; p.y += p.vy * dt

      if (p.x < PH_X) { p.x = PH_X; p.vx = Math.abs(p.vx) * 0.3 }
      if (p.x > VW - PH_X) { p.x = VW - PH_X; p.vx = -Math.abs(p.vx) * 0.3 }
      if (p.y > FLOOR_Y) { p.y = FLOOR_Y; p.vy = 0 }

      const h = -p.y
      if (h > maxHR.current) maxHR.current = h

      const tgt = p.y - VH * 0.4
      const cd = Math.abs(tgt - camRef.current)
      const dl = cd > 60 ? 0.35 : cd > 30 ? 0.22 : CAMERA_LERP
      camRef.current += (tgt - camRef.current) * dl

      // Generate world ahead (only when needed)
      const genThr = camRef.current - GEN_AHEAD
      if (genR.current > genThr) {
        while (genR.current > genThr) {
          genR.current -= LAYER_H
          w.push(...generateLayer(genR.current))
        }
        objChanged = true
      }

      // Moving spikes
      for (const o of w) {
        if (o.kind === 'moving-spike' && o.moveRange && o.moveSpeed && o.movePhase !== undefined) {
          o.movePhase += o.moveSpeed * dt * 0.1
          o.x = snap(VW / 2 + Math.sin(o.movePhase) * o.moveRange)
        }
      }

      // Collision
      for (const o of w) {
        if (o.collected) continue
        const dx = Math.abs(p.x - o.x)
        const dy = Math.abs(p.y - o.y)

        if (o.kind === 'wall' || o.kind === 'pillar' || o.kind === 'zigzag-wall') {
          const ox = (PH_X + o.w / 2) - dx
          const oy = (PH_Y + o.h / 2) - dy
          if (ox > 0 && oy > 0) {
            if (oy < ox) {
              if (p.y < o.y) { p.y = o.y - o.h / 2 - PH_Y; if (p.vy > 0) p.vy = 0 }
              else { p.y = o.y + o.h / 2 + PH_Y; if (p.vy < 0) p.vy = 0 }
            } else {
              if (p.x < o.x) { p.x = o.x - o.w / 2 - PH_X; p.vx = -Math.abs(p.vx) * 0.2 }
              else { p.x = o.x + o.w / 2 + PH_X; p.vx = Math.abs(p.vx) * 0.2 }
            }
          }
          continue
        }

        const hw = o.kind === 'spring' ? (PH_X + o.w / 2) : (o.kind === 'spike' || o.kind === 'moving-spike') ? (PH_X + o.w / 2) * 0.7 : PH_X + 4
        const hh = o.kind === 'spring' ? (PH_Y + o.h / 2) : (o.kind === 'spike' || o.kind === 'moving-spike') ? (PH_Y + o.h / 2) * 0.7 : PH_Y + 4

        if (dx < hw && dy < hh) {
          if (o.kind === 'spike' || o.kind === 'moving-spike') {
            o.collected = true; hp -= 30; objChanged = true
            playSfx(sfxCrash.current, 0.5, 1)
            addFx(o.x, o.y, '-30', '#e03040')
          } else if (o.kind === 'spring') {
            p.vy = SPRING_BOOST
            playSfx(sfxJump.current, 0.5, 1.5)
            addFx(o.x, o.y, 'BOING', '#40c060')
          } else if (o.kind === 'heart') {
            o.collected = true; hp = Math.min(HEART_MAX, hp + HEART_PICKUP); objChanged = true
            playSfx(sfxCoin.current, 0.4, 0.9)
            addFx(o.x, o.y, '+HP', '#e04060')
          } else if (o.kind === 'coin') {
            o.collected = true; cn++; objChanged = true
            playSfx(sfxCoin.current, 0.5, 1.2)
            addFx(o.x, o.y, '+$', '#f0c020')
          }
        }
      }

      // Cleanup far below
      const cleanY = camRef.current + VH + 150
      const before = w.length
      objRef.current = w.filter((o) => o.y < cleanY)
      if (objRef.current.length !== before) objChanged = true

      hp -= HEART_DECAY * dt
      fxR.current = fxR.current.filter((f) => elR.current - f.createdAt < 700)

      const sc = Math.floor(maxHR.current * 0.5 + cn * COIN_BONUS)

      if (hp <= 0) {
        playSfx(sfxCrash.current, 0.6, 0.9); finish(); return
      }

      pRef.current = p; heartR.current = hp; coinR.current = cn
      setPlayer({ ...p }); setCamY(camRef.current)
      setHeart(hp); setCoins(cn); setScore(sc); setHitFxList([...fxR.current])

      // Only update objects state when something actually changed
      if (objChanged) {
        objVersionR.current++
      }
      if (lastObjVersionR.current !== objVersionR.current) {
        lastObjVersionR.current = objVersionR.current
        setObjects([...objRef.current])
      }

      afR.current = window.requestAnimationFrame(step)
    }

    afR.current = window.requestAnimationFrame(step)
    return () => { if (afR.current !== null) window.cancelAnimationFrame(afR.current); lfR.current = null }
  }, [finish, playSfx, addFx])

  const hPct = clamp(heart / HEART_MAX, 0, 1)
  const bestS = Math.max(bestScore, score)
  const hDisp = Math.floor(maxHR.current)
  const sy = (wy: number) => wy - camY
  const visT = camY - 20; const visB = camY + VH + 20
  const [skyTop, skyBot] = skyColors(maxHR.current)

  return (
    <section className="mini-game-panel intense-cheer-panel" aria-label="intense-cheer-game">
      <div className="intense-cheer-board" onPointerDown={onPtrDown} role="presentation"
        style={{ imageRendering: 'pixelated' as const }}>
        <svg className="intense-cheer-svg" viewBox={`0 0 ${VW} ${VH}`}
          preserveAspectRatio="xMidYMid slice" shapeRendering="crispEdges"
          style={{ imageRendering: 'pixelated' }}>
          <defs>
            <linearGradient id="ic-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={skyTop} />
              <stop offset="100%" stopColor={skyBot} />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={VW} height={VH} fill="url(#ic-sky)" />

          {/* Pixel stars */}
          {[10, 30, 55, 80, 100, 120, 22, 68, 95, 110].map((sx, i) => (
            <rect key={`s${i}`} x={sx} y={((16 + i * 22 - camY * 0.015) % VH + VH) % VH}
              width={2} height={2} fill={i % 3 === 0 ? '#606080' : '#404060'} />
          ))}

          {/* Floor */}
          {sy(FLOOR_Y) < VH + 4 && (
            <rect x="0" y={sy(FLOOR_Y)} width={VW} height={2} fill="#604080" />
          )}

          {/* World objects — all pixel art rects */}
          {objects.filter((o) => !o.collected && o.y > visT && o.y < visB).map((o) => {
            const ox = o.x; const oy = sy(o.y)
            switch (o.kind) {
              case 'spike': return <PixSpike key={o.id} x={ox} y={oy} />
              case 'moving-spike': return <PixSpike key={o.id} x={ox} y={oy} />
              case 'coin': return <PixCoin key={o.id} x={ox} y={oy} />
              case 'heart': return <PixHeart key={o.id} x={ox} y={oy} />
              case 'spring': return <PixSpring key={o.id} x={ox} y={oy} w={o.w} />
              case 'wall':
              case 'pillar':
                return <rect key={o.id} x={ox - o.w / 2} y={oy - o.h / 2} width={o.w} height={o.h} fill="#6040a0" />
              case 'zigzag-wall':
                return <rect key={o.id} x={ox - o.w / 2} y={oy - o.h / 2} width={o.w} height={o.h} fill="#a04080" />
              default: return null
            }
          })}

          {/* Hit FX */}
          {hitFxList.map((fx) => {
            const age = elR.current - fx.createdAt
            const op = Math.max(0, 1 - age / 700)
            return (
              <text key={fx.id} x={fx.x} y={sy(fx.y) - 14 * (age / 700)}
                textAnchor="middle" fill={fx.color} fontSize="6" fontWeight="bold" opacity={op}
                fontFamily="monospace">{fx.text}</text>
            )
          })}

          {/* Player — pixel character */}
          <g transform={`translate(${snap(player.x)}, ${snap(sy(player.y))})`}>
            {/* Shadow */}
            <rect x={-PH_X + 1} y={PH_Y} width={PLAYER_W - 2} height={2} fill="rgba(0,0,0,0.3)" />
            {/* Body */}
            <rect x={-PH_X} y={-PH_Y} width={PLAYER_W} height={PLAYER_H} fill="#d080f0" />
            {/* Head highlight */}
            <rect x={-PH_X + 2} y={-PH_Y + 2} width={4} height={4} fill="#f0b0ff" />
            {/* Eyes */}
            <rect x={player.facingRight ? 2 : -4} y={-PH_Y + 4} width={2} height={2} fill="#200030" />
            {/* Character sprite overlay */}
            <image href={kimYeonjaSprite} x={-PH_X} y={-PH_Y} width={PLAYER_W} height={PLAYER_H}
              transform={player.facingRight ? undefined : 'scale(-1,1)'}
              preserveAspectRatio="xMidYMid meet" style={{ imageRendering: 'pixelated' }} />
          </g>

          {/* HUD: Heart bar */}
          <rect x="3" y="24" width="6" height="48" fill="#200020" />
          <rect x="3" y={24 + 48 * (1 - hPct)} width="6" height={48 * hPct} fill="#e04060" />
          <rect x="3" y="20" width="6" height="4" fill="#e04060" />

          {/* HUD: Score */}
          <text x={VW / 2} y="12" textAnchor="middle" fill="#fff" fontSize="10" fontWeight="bold" fontFamily="monospace">{score}</text>
          <text x={VW / 2} y="20" textAnchor="middle" fill="#808090" fontSize="5" fontFamily="monospace">BEST {bestS}</text>

          {/* HUD: Coins + Height */}
          <rect x={VW - 10} y="8" width="6" height="6" fill="#f0c020" />
          <text x={VW - 14} y="14" textAnchor="end" fill="#f0c020" fontSize="6" fontFamily="monospace" fontWeight="bold">{coins}</text>
          <text x={VW - 4} y="22" textAnchor="end" fill="#808090" fontSize="5" fontFamily="monospace">{hDisp}m</text>
        </svg>

        <div className="intense-cheer-overlay-actions">
          <button className="run-run-action-button" type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { playSfx(sfxCoin.current, 0.5, 1); finish() }}>FINISH</button>
          <button className="run-run-action-button ghost" type="button"
            onPointerDown={(e) => e.stopPropagation()} onClick={onExit}>EXIT</button>
        </div>
      </div>
    </section>
  )
}

export const intenseCheerModule: MiniGameModule = {
  manifest: {
    id: 'intense-cheer',
    title: 'Dunga-Dunga',
    description: 'Pixel bounce! Tap L/R to float up through walls & spikes.',
    unlockCost: 50,
    baseReward: 12,
    scoreRewardMultiplier: 0.6,
    accentColor: '#2d1b69',
  },
  Component: DungaDungaGame,
}
