import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ── View ──
const VW = 162
const VH = 288

// ── Physics ──
const GRAVITY = 240
const BOOST_UP = -105
const H_SPEED = 100
const MAX_FALL = 180
const H_DRAG = 0.93
const PLAYER_SIZE = 22
const PH = PLAYER_SIZE / 2

// ── Balance ──
const HEART_DECAY = 2.8
const HEART_MAX = 100
const HEART_PICKUP = 25
const COIN_BONUS = 50
const CAMERA_LERP = 0.14
const FLOOR_Y = 0

// ── World Gen ──
const LAYER_H = 50
const GEN_AHEAD = 800
const OBS_SIZE = 12
const WALL_THICKNESS = 6
const MIN_GAP = 40
const SPRING_SIZE = 16
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

interface PlayerState {
  x: number
  y: number
  vx: number
  vy: number
  facingRight: boolean
}

interface HitFx {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly text: string
  readonly color: string
  readonly createdAt: number
}

let _id = 0
function nid(): number { return _id++ }
function rng(a: number, b: number): number { return a + Math.random() * (b - a) }
function rint(a: number, b: number): number { return Math.floor(rng(a, b + 1)) }
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)) }

function doesOverlap(objs: WorldObj[], x: number, y: number, w: number, h: number): boolean {
  for (const o of objs) {
    if (o.collected) continue
    if (Math.abs(o.x - x) < (o.w + w) / 2 + 4 && Math.abs(o.y - y) < (o.h + h) / 2 + 4) return true
  }
  return false
}

function generateLayer(layerY: number): WorldObj[] {
  const objs: WorldObj[] = []
  const zone = Math.floor(-layerY / 400)

  // Track wall gap so we don't block it with spikes
  let wallGapX = VW / 2
  let wallGapW = VW
  let wallY = -9999
  const hasWall = zone >= 1 && Math.random() < 0.2 + Math.min(zone * 0.04, 0.2)

  // Wall segments (gaps to fly through) — gap never smaller than MIN_GAP
  if (hasWall) {
    wallGapW = Math.max(MIN_GAP, 55 - Math.min(zone, 5) * 2)
    wallGapX = rng(wallGapW / 2 + 8, VW - wallGapW / 2 - 8)
    wallY = layerY + rng(12, LAYER_H - 12)
    const leftEdge = wallGapX - wallGapW / 2
    const rightEdge = wallGapX + wallGapW / 2
    // Left wall
    if (leftEdge > 5) {
      objs.push({
        id: nid(), kind: 'wall', x: leftEdge / 2, y: wallY,
        w: leftEdge, h: WALL_THICKNESS, collected: false,
      })
    }
    // Right wall
    if (rightEdge < VW - 5) {
      objs.push({
        id: nid(), kind: 'wall', x: (rightEdge + VW) / 2, y: wallY,
        w: VW - rightEdge, h: WALL_THICKNESS, collected: false,
      })
    }
  }

  // Helper: check if position is inside wall gap (protected zone)
  const isInGapZone = (x: number, y: number) => {
    if (!hasWall) return false
    return Math.abs(y - wallY) < WALL_THICKNESS + PH + 8 &&
      x > wallGapX - wallGapW / 2 - 4 && x < wallGapX + wallGapW / 2 + 4
  }

  // Spikes — fewer, only 0-1 per layer
  if (Math.random() < 0.45) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const sx = rng(OBS_SIZE, VW - OBS_SIZE)
      const sy = layerY + rng(5, LAYER_H - 5)
      if (!doesOverlap(objs, sx, sy, OBS_SIZE, OBS_SIZE) && !isInGapZone(sx, sy)) {
        objs.push({ id: nid(), kind: 'spike', x: sx, y: sy, w: OBS_SIZE, h: OBS_SIZE, collected: false })
        break
      }
    }
  }

  // Pillars — vertical wall sticking out from left or right side (zone 1+)
  if (!hasWall && zone >= 1 && Math.random() < 0.2) {
    const fromLeft = Math.random() < 0.5
    const pillarW = rng(25, 50)
    const pillarH = 5
    const px = fromLeft ? pillarW / 2 : VW - pillarW / 2
    const py = layerY + rng(10, LAYER_H - 10)
    objs.push({ id: nid(), kind: 'pillar', x: px, y: py, w: pillarW, h: pillarH, collected: false })
  }

  // Zigzag walls — alternating left/right narrow walls (zone 2+)
  if (!hasWall && zone >= 2 && Math.random() < 0.15) {
    const side = Math.random() < 0.5 ? 'left' : 'right'
    const zzW = rng(35, 55)
    const zzY = layerY + rng(10, LAYER_H - 10)
    const zzX = side === 'left' ? zzW / 2 : VW - zzW / 2
    objs.push({ id: nid(), kind: 'zigzag-wall', x: zzX, y: zzY, w: zzW, h: WALL_THICKNESS, collected: false })
  }

  // Moving spikes (zone 3+, never with wall, rare)
  if (zone >= 3 && !hasWall && Math.random() < 0.1) {
    const my = layerY + rng(10, LAYER_H - 10)
    const range = rng(20, 35)
    objs.push({
      id: nid(), kind: 'moving-spike', x: VW / 2, y: my,
      w: OBS_SIZE + 2, h: OBS_SIZE + 2,
      moveRange: range, moveSpeed: rng(25, 40), movePhase: Math.random() * Math.PI * 2,
      collected: false,
    })
  }

  // Springs (bounce pads) — slightly more common
  if (Math.random() < 0.18) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const sx = rng(SPRING_SIZE, VW - SPRING_SIZE)
      const sy = layerY + rng(10, LAYER_H - 10)
      if (!doesOverlap(objs, sx, sy, SPRING_SIZE, 8)) {
        objs.push({ id: nid(), kind: 'spring', x: sx, y: sy, w: SPRING_SIZE, h: 8, collected: false })
        break
      }
    }
  }

  // Coins
  if (Math.random() < 0.4) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cx = rng(12, VW - 12)
      const cy = layerY + rng(8, LAYER_H - 8)
      if (!doesOverlap(objs, cx, cy, 12, 12)) {
        objs.push({ id: nid(), kind: 'coin', x: cx, y: cy, w: 11, h: 11, collected: false })
        break
      }
    }
  }

  // Hearts — much more common now (was 7%, now 20%)
  if (Math.random() < 0.20) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const hx = rng(12, VW - 12)
      const hy = layerY + rng(8, LAYER_H - 8)
      if (!doesOverlap(objs, hx, hy, 12, 12)) {
        objs.push({ id: nid(), kind: 'heart', x: hx, y: hy, w: 12, h: 12, collected: false })
        break
      }
    }
  }

  return objs
}

// Height zone → sky color
function skyColor(height: number): { top: string; mid: string; bot: string } {
  if (height < 400) return { top: '#0b0b2e', mid: '#1a1a4e', bot: '#2d1b69' }
  if (height < 1000) return { top: '#0b1e3e', mid: '#1a3a5e', bot: '#2d4b79' }
  if (height < 2000) return { top: '#1a0a2e', mid: '#3a1a4e', bot: '#5d2b79' }
  return { top: '#2e0b0b', mid: '#4e1a1a', bot: '#792d2d' }
}

function DungaDungaGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [player, setPlayer] = useState<PlayerState>({ x: VW / 2, y: FLOOR_Y, vx: 0, vy: 0, facingRight: true })
  const [objects, setObjects] = useState<WorldObj[]>([])
  const [camY, setCamY] = useState(0)
  const [heart, setHeart] = useState(HEART_MAX)
  const [score, setScore] = useState(0)
  const [coins, setCoins] = useState(0)
  const [hitFxList, setHitFxList] = useState<HitFx[]>([])
  const [statusText, setStatusText] = useState('좌/우 터치로 붕~')

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

  const sfxJump = useRef<HTMLAudioElement | null>(null)
  const sfxCoin = useRef<HTMLAudioElement | null>(null)
  const sfxCrash = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((s: HTMLAudioElement | null, v: number, r = 1) => {
    if (!s) return; s.currentTime = 0; s.volume = v; s.playbackRate = r; void s.play().catch(() => {})
  }, [])

  const addFx = useCallback((x: number, y: number, text: string, color: string) => {
    const fx: HitFx = { id: nid(), x, y, text, color, createdAt: elR.current }
    fxR.current = [...fxR.current, fx]
  }, [])

  const finish = useCallback(() => {
    if (doneR.current) return
    doneR.current = true
    const s = Math.floor(maxHR.current * 0.5 + coinR.current * COIN_BONUS)
    onFinish({ score: s, durationMs: elR.current > 0 ? elR.current : 16 })
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
    objRef.current = init; genR.current = -GEN_AHEAD; setObjects([...init])
    // Initialize camera to player start position so no jump
    camRef.current = FLOOR_Y - VH * 0.4
    setCamY(camRef.current)

    const step = (now: number) => {
      if (doneR.current) { afR.current = null; return }
      if (lfR.current === null) lfR.current = now
      const dMs = Math.min(now - lfR.current, MAX_FRAME_DELTA_MS)
      lfR.current = now; elR.current += dMs
      const dt = dMs / 1000; const el = elR.current

      const p = { ...pRef.current }
      const w = objRef.current
      let hp = heartR.current; let cn = coinR.current

      // Physics
      p.vy += GRAVITY * dt
      p.vy = Math.min(p.vy, MAX_FALL)
      p.vx *= Math.pow(H_DRAG, dt * 60)
      p.x += p.vx * dt; p.y += p.vy * dt

      // Clamp X — no teleport wrap, just stop at edges
      if (p.x < PH) { p.x = PH; p.vx = Math.abs(p.vx) * 0.3 }
      if (p.x > VW - PH) { p.x = VW - PH; p.vx = -Math.abs(p.vx) * 0.3 }
      // Floor
      if (p.y > FLOOR_Y) { p.y = FLOOR_Y; p.vy = 0 }

      const h = -p.y
      if (h > maxHR.current) maxHR.current = h

      // Camera — faster lerp when distance is large (prevents teleport feel)
      const tgt = p.y - VH * 0.4
      const camDist = Math.abs(tgt - camRef.current)
      const dynamicLerp = camDist > 80 ? 0.35 : camDist > 40 ? 0.22 : CAMERA_LERP
      camRef.current += (tgt - camRef.current) * dynamicLerp

      // Generate ahead
      const genThr = camRef.current - GEN_AHEAD
      while (genR.current > genThr) {
        genR.current -= LAYER_H
        w.push(...generateLayer(genR.current))
      }

      // Update moving objects
      for (const o of w) {
        if (o.kind === 'moving-spike' && o.moveRange && o.moveSpeed && o.movePhase !== undefined) {
          o.movePhase += o.moveSpeed * dt * 0.1
          o.x = VW / 2 + Math.sin(o.movePhase) * o.moveRange
        }
      }

      // Collision
      for (const o of w) {
        if (o.collected) continue
        const dx = Math.abs(p.x - o.x)
        const dy = Math.abs(p.y - o.y)

        if (o.kind === 'wall' || o.kind === 'pillar' || o.kind === 'zigzag-wall') {
          const overlapX = (PH + o.w / 2) - dx
          const overlapY = (PH + o.h / 2) - dy
          if (overlapX > 0 && overlapY > 0) {
            // Push out along the smallest overlap axis
            if (overlapY < overlapX) {
              // Push vertically
              if (p.y < o.y) { p.y = o.y - o.h / 2 - PH; if (p.vy > 0) p.vy = 0 }
              else { p.y = o.y + o.h / 2 + PH; if (p.vy < 0) p.vy = 0 }
            } else {
              // Push horizontally
              if (p.x < o.x) { p.x = o.x - o.w / 2 - PH; p.vx = -Math.abs(p.vx) * 0.2 }
              else { p.x = o.x + o.w / 2 + PH; p.vx = Math.abs(p.vx) * 0.2 }
            }
          }
          continue
        }

        const hitW = o.kind === 'spring' ? (PH + o.w / 2) : o.kind === 'spike' || o.kind === 'moving-spike' ? (PH + o.w / 2) * 0.7 : PH + 6
        const hitH = o.kind === 'spring' ? (PH + o.h / 2) : o.kind === 'spike' || o.kind === 'moving-spike' ? (PH + o.h / 2) * 0.7 : PH + 6

        if (dx < hitW && dy < hitH) {
          if (o.kind === 'spike' || o.kind === 'moving-spike') {
            o.collected = true; hp -= 30
            playSfx(sfxCrash.current, 0.5, 1)
            addFx(o.x, o.y, '-30', '#ff4757')
          } else if (o.kind === 'spring') {
            p.vy = SPRING_BOOST
            playSfx(sfxJump.current, 0.5, 1.5)
            addFx(o.x, o.y, 'BOING!', '#4ade80')
          } else if (o.kind === 'heart') {
            o.collected = true; hp = Math.min(HEART_MAX, hp + HEART_PICKUP)
            playSfx(sfxCoin.current, 0.4, 0.9)
            addFx(o.x, o.y, '+HP', '#ff6b81')
          } else if (o.kind === 'coin') {
            o.collected = true; cn++
            playSfx(sfxCoin.current, 0.5, 1.2)
            addFx(o.x, o.y, '+$', '#ffd700')
          }
        }
      }

      // Cleanup far objects
      const cleanY = camRef.current + VH + 200
      objRef.current = w.filter((o) => o.y < cleanY)

      // Heart decay
      hp -= HEART_DECAY * dt

      // Cleanup old fx
      fxR.current = fxR.current.filter((f) => el - f.createdAt < 700)

      const sc = Math.floor(maxHR.current * 0.5 + cn * COIN_BONUS)

      if (hp <= 0) {
        setStatusText('하트가 다 떨어졌습니다!')
        playSfx(sfxCrash.current, 0.6, 0.9); finish(); return
      }

      pRef.current = p; heartR.current = hp; coinR.current = cn
      setPlayer({ ...p }); setObjects([...objRef.current]); setCamY(camRef.current)
      setHeart(hp); setCoins(cn); setScore(sc); setHitFxList([...fxR.current])

      afR.current = window.requestAnimationFrame(step)
    }

    afR.current = window.requestAnimationFrame(step)
    return () => { if (afR.current !== null) window.cancelAnimationFrame(afR.current); lfR.current = null }
  }, [finish, playSfx, addFx])

  const hPct = clamp(heart / HEART_MAX, 0, 1)
  const bestS = Math.max(bestScore, score)
  const hDisp = Math.floor(maxHR.current)
  const sy = (wy: number) => wy - camY
  const visT = camY - 30; const visB = camY + VH + 30
  const sky = skyColor(maxHR.current)

  return (
    <section className="mini-game-panel intense-cheer-panel" aria-label="intense-cheer-game">
      <div className="intense-cheer-board" onPointerDown={onPtrDown} role="presentation">
        <svg className="intense-cheer-svg" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMax meet">
          <defs>
            <linearGradient id="ic-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sky.top} />
              <stop offset="40%" stopColor={sky.mid} />
              <stop offset="100%" stopColor={sky.bot} />
            </linearGradient>
            <linearGradient id="ic-heart" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#ff4757" />
              <stop offset="100%" stopColor="#ff6b81" />
            </linearGradient>
          </defs>

          <rect x="0" y="0" width={VW} height={VH} fill="url(#ic-sky)" />

          {/* Stars parallax */}
          {[15, 45, 78, 110, 140, 30, 95, 125].map((sx, i) => (
            <circle key={`s${i}`} cx={sx} cy={((20 + i * 35 - camY * 0.02) % VH + VH) % VH}
              r={0.8 + (i % 3) * 0.4} fill="rgba(255,255,200,0.6)" opacity={0.3 + (i % 3) * 0.15} />
          ))}

          {/* Floor */}
          {sy(FLOOR_Y) < VH + 10 && (
            <line x1="0" y1={sy(FLOOR_Y)} x2={VW} y2={sy(FLOOR_Y)}
              stroke="rgba(168,85,247,0.5)" strokeWidth="2" strokeDasharray="4 4" />
          )}

          {/* World objects */}
          {objects.filter((o) => !o.collected && o.y > visT && o.y < visB).map((o) => {
            const ox = o.x; const oy = sy(o.y)
            switch (o.kind) {
              case 'spike':
                return (
                  <g key={o.id}>
                    <polygon points={`${ox},${oy - OBS_SIZE / 2} ${ox + OBS_SIZE / 2},${oy + OBS_SIZE / 2} ${ox - OBS_SIZE / 2},${oy + OBS_SIZE / 2}`}
                      fill="#ff4757" stroke="#c0392b" strokeWidth="1" />
                    <text x={ox} y={oy + 3} textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">!</text>
                  </g>
                )
              case 'moving-spike':
                return (
                  <g key={o.id}>
                    <polygon points={`${ox},${oy - (OBS_SIZE + 2) / 2} ${ox + (OBS_SIZE + 2) / 2},${oy + (OBS_SIZE + 2) / 2} ${ox - (OBS_SIZE + 2) / 2},${oy + (OBS_SIZE + 2) / 2}`}
                      fill="#e74c3c" stroke="#c0392b" strokeWidth="1.2" />
                    <text x={ox} y={oy + 3} textAnchor="middle" fill="#fff" fontSize="7" fontWeight="bold">~</text>
                    {/* Motion trail */}
                    <line x1={ox - 8} y1={oy} x2={ox - 14} y2={oy} stroke="rgba(231,76,60,0.4)" strokeWidth="1" />
                    <line x1={ox + 8} y1={oy} x2={ox + 14} y2={oy} stroke="rgba(231,76,60,0.4)" strokeWidth="1" />
                  </g>
                )
              case 'wall':
                return <rect key={o.id} x={ox - o.w / 2} y={oy - o.h / 2} width={o.w} height={o.h}
                  rx="2" fill="rgba(168,85,247,0.6)" stroke="rgba(168,85,247,0.8)" strokeWidth="1" />
              case 'pillar':
                return <rect key={o.id} x={ox - o.w / 2} y={oy - o.h / 2} width={o.w} height={o.h}
                  rx="2" fill="rgba(139,92,246,0.5)" stroke="rgba(139,92,246,0.7)" strokeWidth="1" />
              case 'zigzag-wall':
                return (
                  <g key={o.id}>
                    <rect x={ox - o.w / 2} y={oy - o.h / 2} width={o.w} height={o.h}
                      rx="1" fill="rgba(236,72,153,0.5)" stroke="rgba(236,72,153,0.7)" strokeWidth="1" />
                    <line x1={ox - o.w / 2 + 3} y1={oy} x2={ox + o.w / 2 - 3} y2={oy}
                      stroke="rgba(236,72,153,0.3)" strokeWidth="0.5" strokeDasharray="2 2" />
                  </g>
                )
              case 'spring':
                return (
                  <g key={o.id}>
                    <rect x={ox - SPRING_SIZE / 2} y={oy - 3} width={SPRING_SIZE} height={6} rx="2"
                      fill="#4ade80" stroke="#22c55e" strokeWidth="1" />
                    <text x={ox} y={oy + 2.5} textAnchor="middle" fill="#166534" fontSize="5" fontWeight="bold">^</text>
                  </g>
                )
              case 'coin':
                return (
                  <g key={o.id}>
                    <circle cx={ox} cy={oy} r="5" fill="#ffd700" stroke="#daa520" strokeWidth="1" />
                    <text x={ox} y={oy + 2} textAnchor="middle" fill="#b8860b" fontSize="5" fontWeight="bold">$</text>
                  </g>
                )
              case 'heart':
                return (
                  <g key={o.id}>
                    <circle cx={ox} cy={oy} r="5.5" fill="url(#ic-heart)" opacity="0.9" />
                    <text x={ox} y={oy + 2.5} textAnchor="middle" fill="white" fontSize="6">+</text>
                  </g>
                )
              default: return null
            }
          })}

          {/* Hit effects */}
          {hitFxList.map((fx) => {
            const age = elR.current - fx.createdAt
            const op = Math.max(0, 1 - age / 700)
            const ofy = -18 * (age / 700)
            return (
              <text key={fx.id} x={fx.x} y={sy(fx.y) + ofy}
                textAnchor="middle" fill={fx.color} fontSize="8" fontWeight="bold" opacity={op}>
                {fx.text}
              </text>
            )
          })}

          {/* Player */}
          <g transform={`translate(${player.x}, ${sy(player.y)})`}>
            <ellipse cx="0" cy={PH + 2} rx={PH * 0.7} ry="3" fill="rgba(168,85,247,0.3)" />
            <image href={kimYeonjaSprite} x={-PH} y={-PH} width={PLAYER_SIZE} height={PLAYER_SIZE}
              transform={player.facingRight ? undefined : 'scale(-1,1)'} preserveAspectRatio="xMidYMid meet" />
          </g>

          {/* HUD: Heart gauge */}
          <rect x="5" y="40" width="8" height="60" rx="4" fill="rgba(0,0,0,0.4)" />
          <rect x="5" y={40 + 60 * (1 - hPct)} width="8" height={60 * hPct} rx="4" fill="url(#ic-heart)" />
          <text x="9" y="36" textAnchor="middle" fill="#ff6b81" fontSize="9" fontWeight="bold">H</text>

          {/* HUD: Score */}
          <text x={VW / 2} y="16" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" opacity="0.9">{score}</text>
          <text x={VW / 2} y="26" textAnchor="middle" fill="white" fontSize="6" opacity="0.5">BEST {bestS}</text>

          {/* HUD: Coins + Height */}
          <circle cx={VW - 10} cy="14" r="3.5" fill="#ffd700" stroke="#daa520" strokeWidth="0.5" />
          <text x={VW - 18} y="17" textAnchor="end" fill="#ffd700" fontSize="8" fontWeight="bold">{coins}</text>
          <text x={VW - 6} y="28" textAnchor="end" fill="white" fontSize="6" opacity="0.4">{hDisp}m</text>
        </svg>

        <p className="intense-cheer-status">{statusText}</p>
        <p className="intense-cheer-tap-hint">좌/우 터치로 붕~</p>

        <div className="intense-cheer-overlay-actions">
          <button className="run-run-action-button" type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { playSfx(sfxCoin.current, 0.5, 1); finish() }}>종료</button>
          <button className="run-run-action-button ghost" type="button"
            onPointerDown={(e) => e.stopPropagation()} onClick={onExit}>나가기</button>
        </div>
      </div>
    </section>
  )
}

export const intenseCheerModule: MiniGameModule = {
  manifest: {
    id: 'intense-cheer',
    title: '둥가둥가',
    description: '터치로 붕~ 떠올라 장애물과 벽을 피하며 올라가세요! 스프링 패드와 코인을 노리세요.',
    unlockCost: 50,
    baseReward: 12,
    scoreRewardMultiplier: 0.6,
    accentColor: '#2d1b69',
  },
  Component: DungaDungaGame,
}
