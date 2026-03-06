import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

// Character sprites
import taeJinaSprite from '../../../assets/images/same-character/tae-jina.png'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikSprite from '../../../assets/images/same-character/song-changsik.png'

// Sound effects
import releaseWhooshSfx from '../../../assets/sounds/rope-swing-release.mp3'
import grabSfx from '../../../assets/sounds/rope-swing-grab.mp3'
import coinSfx from '../../../assets/sounds/rope-swing-coin.mp3'
import comboSfx from '../../../assets/sounds/rope-swing-combo.mp3'
import feverSfx from '../../../assets/sounds/rope-swing-fever.mp3'
import windSfx from '../../../assets/sounds/rope-swing-wind.mp3'
import fallSfx from '../../../assets/sounds/rope-swing-fall.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import speedupSfx from '../../../assets/sounds/rope-swing-speedup.mp3'
import slowmoSfx from '../../../assets/sounds/rope-swing-slowmo.mp3'
import starSfx from '../../../assets/sounds/rope-swing-star.mp3'
import levelupSfx from '../../../assets/sounds/rope-swing-levelup.mp3'
import bounceSfx from '../../../assets/sounds/rope-swing-bounce.mp3'
import dashSfx from '../../../assets/sounds/rope-swing-dash.mp3'

const ALL_CHARS = [taeJinaSprite, kimYeonjaSprite, parkSangminSprite, parkWankyuSprite, seoTaijiSprite, songChangsikSprite]

// --- Constants ---
const VW = 360
const VH = 720
const ROPE_AY = 28
const ROPE_LMIN = 140
const ROPE_LMAX = 230
const GRAB_R = 55
const G = 980
const PDAMP = 0.998
const WIND_MAX = 120
const WIND_MS = 3000
const GAP_MIN0 = 95
const GAP_MAX0 = 135
const GAP_GROW = 1.6
const GAP_CAP = 220
const PW = 56
const PH = 64
const COMBO_DECAY = 2800
const COMBO_STEP = 4
const FALL_Y = VH + 60
const SPD_GROW = 0.025
const SPD_CAP = 2.5
const COIN_CH = 0.7
const COIN_R = 13
const COIN_CR = 34
const COIN_PTS = 5
const DIST_DIV = 70
const FVR_TH = 8
const FVR_M = 2
const PU_CH = 0.28
const PU_R = 15
const PU_CR = 36
const MAG_MS = 5500
const SHLD_MS = 6500
const DJ_CT = 2
const SX2_MS = 8000
const SPB_MS = 4000
const SLO_MS = 3500
const OBS_CH = 0.32
const OBS_R = 18
const TRAIL_N = 14
const LVL_SW = 5
const MAX_LVL = 20
const STAR_CH = 0.15
const STAR_R = 12
const STAR_PTS = 25

// --- Types ---
interface Rope { readonly id: number; readonly anchorX: number; readonly length: number }
type Phase = 'swinging' | 'flying' | 'falling' | 'ended'
type PUType = 'magnet' | 'shield' | 'double-jump' | 'score-x2' | 'speed-boost' | 'slow-motion'
interface PU { id: number; x: number; y: number; type: PUType; collected: boolean }
interface Obs { id: number; x: number; y: number; type: 'bat' | 'spike' | 'ghost'; vx: number; vy: number }
interface Coin { id: number; x: number; y: number; collected: boolean }
interface Star { id: number; x: number; y: number; collected: boolean }
interface PState { x: number; y: number; vx: number; vy: number; ang: number; av: number }
interface TPt { x: number; y: number; op: number }

// --- Helpers ---
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const clp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const cMul = (c: number) => 1 + Math.floor(c / COMBO_STEP)

function gap(s: number) {
  const g = s * GAP_GROW
  return { mn: Math.min(GAP_MIN0 + g, GAP_CAP - 20), mx: Math.min(GAP_MAX0 + g, GAP_CAP) }
}

function nxRope(px: number, sc: number, id: number): Rope {
  const { mn, mx } = gap(sc)
  const dir = Math.random() < 0.5 ? -1 : 1
  const d = rnd(mn, mx)
  let nx = px + dir * d
  const m = 60
  if (nx < m) nx = px + d; else if (nx > VW - m) nx = px - d
  return { id, anchorX: clp(nx, m, VW - m), length: rnd(ROPE_LMIN, ROPE_LMAX) }
}

function initRopes(): Rope[] {
  const a: Rope = { id: 0, anchorX: VW / 2, length: rnd(ROPE_LMIN, ROPE_LMAX) }
  const b = nxRope(a.anchorX, 0, 1)
  return [a, b, nxRope(b.anchorX, 0, 2)]
}

function posOnR(r: Rope, a: number) {
  return { x: r.anchorX + Math.sin(a) * r.length, y: ROPE_AY + Math.cos(a) * r.length }
}

const PUD: Record<PUType, { ic: string; cl: string; gl: string }> = {
  'magnet':      { ic: 'M', cl: '#ef4444', gl: '#fca5a5' },
  'shield':      { ic: 'S', cl: '#3b82f6', gl: '#93c5fd' },
  'double-jump': { ic: 'J', cl: '#22c55e', gl: '#86efac' },
  'score-x2':    { ic: '2', cl: '#f59e0b', gl: '#fde68a' },
  'speed-boost': { ic: '>', cl: '#ec4899', gl: '#f9a8d4' },
  'slow-motion': { ic: '~', cl: '#8b5cf6', gl: '#c4b5fd' },
}

const OBS_E: Record<string, string> = { bat: '\u{1F987}', spike: '\u{1F480}', ghost: '\u{1F47B}' }

function PxB({ x, y, s, c, o = 1 }: { x: number; y: number; s: number; c: string; o?: number }) {
  return <rect x={x} y={y} width={s} height={s} fill={c} opacity={o} shapeRendering="crispEdges" />
}

// --- Component ---
function RopeSwingGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const fx = useGameEffects()
  const fxRef = useRef(fx)
  fxRef.current = fx
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [phase, setPhase] = useState<Phase>('swinging')
  const [pPos, setPPos] = useState({ x: VW / 2, y: ROPE_AY + 170 })
  const [ropes, setRopes] = useState<Rope[]>(() => initRopes())
  const [cIdx, setCIdx] = useState(0)
  const [pAng, setPAng] = useState(0)
  const [wind, setWind] = useState(0)
  const [camX, setCamX] = useState(0)
  const [coins, setCoins] = useState<Coin[]>([])
  const [coinCt, setCoinCt] = useState(0)
  const [fever, setFever] = useState(false)
  const [trail, setTrail] = useState<TPt[]>([])
  const [pups, setPups] = useState<PU[]>([])
  const [obs, setObs] = useState<Obs[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [dj, setDj] = useState(0)
  const [shld, setShld] = useState(false)
  const [swCt, setSwCt] = useState(0)
  const [lvl, setLvl] = useState(1)
  const [perf, setPerf] = useState(false)
  const [lvUp, setLvUp] = useState(false)
  const [chI, setChI] = useState(() => Math.floor(Math.random() * ALL_CHARS.length))
  const [aPUs, setAPUs] = useState<Map<PUType, number>>(new Map())
  const [sloMo, setSloMo] = useState(false)
  const [dash, setDash] = useState(false)

  const sR = useRef(0)
  const coR = useRef(0)
  const lcAt = useRef(0)
  const phR = useRef<Phase>('swinging')
  const pR = useRef<PState>({ x: VW / 2, y: ROPE_AY + 170, vx: 0, vy: 0, ang: 0, av: 1.8 })
  const rsR = useRef<Rope[]>(ropes)
  const ciR = useRef(0)
  const ridR = useRef(3)
  const wR = useRef(0)
  const wtR = useRef(0)
  const elR = useRef(0)
  const dnR = useRef(false)
  const cnsR = useRef<Coin[]>([])
  const cnidR = useRef(0)
  const cctR = useRef(0)
  const rafR = useRef<number | null>(null)
  const lfR = useRef<number | null>(null)
  const cxR = useRef(0)
  const trR = useRef<TPt[]>([])
  const puR = useRef<PU[]>([])
  const obR = useRef<Obs[]>([])
  const stR = useRef<Star[]>([])
  const puidR = useRef(0)
  const obidR = useRef(0)
  const stidR = useRef(0)
  const apuR = useRef<Map<PUType, number>>(new Map())
  const djR = useRef(0)
  const shR = useRef(false)
  const swR = useRef(0)
  const lvR = useRef(1)
  const chiR = useRef(chI)

  const auR = useRef<Record<string, HTMLAudioElement | null>>({})

  const sfx = useCallback((k: string, v: number, r = 1) => {
    const a = auR.current[k]
    if (!a) return
    const cl = a.cloneNode() as HTMLAudioElement
    cl.volume = v; cl.playbackRate = r
    void cl.play().catch(() => {})
  }, [])

  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const fin = useCallback(() => {
    if (dnR.current) return
    dnR.current = true; phR.current = 'ended'; setPhase('ended')
    onFinishRef.current({ score: sR.current, durationMs: Math.round(Math.max(16.66, elR.current)) })
  }, [])

  const tap = useCallback(() => {
    if (dnR.current) return
    const ph = phR.current
    if (ph === 'ended' || ph === 'falling') return

    if (ph === 'swinging') {
      const p = pR.current, r = rsR.current[ciR.current]
      if (!r) return
      const pos = posOnR(r, p.ang)
      const ts = p.av * r.length
      p.x = pos.x; p.y = pos.y
      p.vx = ts * Math.cos(p.ang); p.vy = -ts * Math.sin(p.ang)
      p.vy = Math.min(p.vy, -50)
      if (apuR.current.has('speed-boost')) {
        p.vx *= 1.4; p.vy *= 0.8
        setDash(true); setTimeout(() => setDash(false), 400)
        sfx('dash', 0.5, 1.2)
      }
      phR.current = 'flying'; setPhase('flying')
      sfx('release', 0.5, 1.1); trR.current = []
    } else if (ph === 'flying' && djR.current > 0) {
      const p = pR.current
      p.vy = -380; p.vx *= 1.15
      djR.current -= 1; setDj(djR.current)
      sfx('bounce', 0.55, 1.3)
      fxRef.current.spawnParticles(8, p.x, p.y)
      fxRef.current.triggerFlash('rgba(34,197,94,0.35)')
    }
  }, [sfx])

  const sync = useCallback(() => {
    const p = pR.current
    setPPos({ x: p.x, y: p.y }); setPAng(p.ang); setWind(wR.current)
    setCamX(cxR.current); setTrail([...trR.current]); setCoins([...cnsR.current])
    setPups([...puR.current]); setObs([...obR.current]); setStars([...stR.current])
    setAPUs(new Map(apuR.current))
  }, [])

  const bestD = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const cm = useMemo(() => cMul(combo), [combo])
  const hasMag = aPUs.has('magnet')
  const hasSx2 = aPUs.has('score-x2')
  const hasSpd = aPUs.has('speed-boost')

  useEffect(() => {
    const m: Record<string, string> = {
      release: releaseWhooshSfx, grab: grabSfx, coin: coinSfx, combo: comboSfx,
      fever: feverSfx, wind: windSfx, fall: fallSfx, gameOver: gameOverHitSfx,
      speedup: speedupSfx, slowmo: slowmoSfx, star: starSfx, levelup: levelupSfx,
      bounce: bounceSfx, dash: dashSfx,
    }
    for (const [k, src] of Object.entries(m)) { const a = new Audio(src); a.preload = 'auto'; auR.current[k] = a }
    return () => { for (const a of Object.values(auR.current)) { if (a) { a.pause(); a.currentTime = 0 } }; fxRef.current.cleanup() }
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExitRef.current(); return }
      if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); tap() }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [tap])

  // --- Main game loop ---
  useEffect(() => {
    lfR.current = null
    const step = (now: number) => {
      if (dnR.current) { rafR.current = null; return }
      if (lfR.current === null) lfR.current = now
      const raw = Math.min(now - lfR.current, MAX_FRAME_DELTA_MS)
      lfR.current = now; elR.current += raw
      const slow = apuR.current.has('slow-motion')
      const dtMs = slow ? raw * 0.5 : raw
      const dt = dtMs / 1000
      setSloMo(slow)

      wtR.current += raw
      if (wtR.current >= WIND_MS) {
        wtR.current = 0
        const mw = Math.min(WIND_MAX, 30 + sR.current * 2.5 + lvR.current * 5)
        wR.current = rnd(-mw, mw)
        if (Math.abs(wR.current) > 55) sfx('wind', 0.25, 1)
      }

      for (const [t, exp] of apuR.current.entries()) {
        if (now > exp) { apuR.current.delete(t); if (t === 'shield') { shR.current = false; setShld(false) } }
      }

      const p = pR.current, ph = phR.current

      if (ph === 'swinging') {
        const r = rsR.current[ciR.current]
        if (r) {
          const ga = -(G / r.length) * Math.sin(p.ang)
          const wa = (wR.current / r.length) * Math.cos(p.ang)
          p.av += (ga + wa) * dt; p.av *= PDAMP; p.ang += p.av * dt
          const pos = posOnR(r, p.ang); p.x = pos.x; p.y = pos.y
        }
      } else if (ph === 'flying') {
        const sm = Math.min(SPD_CAP, 1 + sR.current * SPD_GROW)
        p.vy += G * dt; p.vx += wR.current * 0.3 * dt
        p.x += p.vx * dt * sm; p.y += p.vy * dt

        trR.current.push({ x: p.x, y: p.y, op: 1 })
        if (trR.current.length > TRAIL_N) trR.current.shift()
        trR.current.forEach((t, i) => { t.op = (i + 1) / trR.current.length })

        const magOn = apuR.current.has('magnet'), magRad = 110

        for (const c of cnsR.current) {
          if (c.collected) continue
          if (magOn) { const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy); if (d < magRad && d > 1) { c.x += (dx / d) * 4; c.y += (dy / d) * 4 } }
          if (Math.hypot(p.x - c.x, p.y - c.y) < COIN_CR) {
            c.collected = true; cctR.current += 1; setCoinCt(cctR.current)
            let pts = COIN_PTS * cMul(coR.current); if (apuR.current.has('score-x2')) pts *= 2
            sR.current += pts; setScore(sR.current); sfx('coin', 0.4, 1.1 + Math.random() * 0.3); fxRef.current.spawnParticles(3, c.x, c.y)
          }
        }
        cnsR.current = cnsR.current.filter(c => !c.collected)

        for (const s of stR.current) {
          if (s.collected) continue
          if (magOn) { const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy); if (d < magRad && d > 1) { s.x += (dx / d) * 4; s.y += (dy / d) * 4 } }
          if (Math.hypot(p.x - s.x, p.y - s.y) < COIN_CR) {
            s.collected = true; let pts = STAR_PTS * cMul(coR.current); if (apuR.current.has('score-x2')) pts *= 2
            sR.current += pts; setScore(sR.current); sfx('star', 0.5, 1.2)
            fxRef.current.spawnParticles(6, s.x, s.y); fxRef.current.showScorePopup(pts, s.x, s.y - 20, '#fbbf24'); fxRef.current.triggerFlash('rgba(250,204,21,0.25)')
          }
        }
        stR.current = stR.current.filter(s => !s.collected)

        for (const pu of puR.current) {
          if (pu.collected) continue
          if (Math.hypot(p.x - pu.x, p.y - pu.y) < PU_CR) {
            pu.collected = true
            switch (pu.type) {
              case 'double-jump': djR.current = DJ_CT; setDj(DJ_CT); break
              case 'shield': shR.current = true; setShld(true); apuR.current.set('shield', now + SHLD_MS); break
              case 'magnet': apuR.current.set('magnet', now + MAG_MS); break
              case 'score-x2': apuR.current.set('score-x2', now + SX2_MS); break
              case 'speed-boost': apuR.current.set('speed-boost', now + SPB_MS); sfx('speedup', 0.45, 1.2); break
              case 'slow-motion': apuR.current.set('slow-motion', now + SLO_MS); sfx('slowmo', 0.45, 1); break
            }
            sfx('combo', 0.45, 1.3); fxRef.current.triggerFlash(PUD[pu.type].gl + '40'); fxRef.current.spawnParticles(5, pu.x, pu.y)
          }
        }
        puR.current = puR.current.filter(pu => !pu.collected)

        for (const o of obR.current) {
          o.x += o.vx * dt; o.y += (o.vy || 0) * dt
          if (Math.hypot(p.x - o.x, p.y - o.y) < OBS_R + PW / 3) {
            if (shR.current) {
              shR.current = false; setShld(false); apuR.current.delete('shield')
              fxRef.current.triggerFlash('rgba(59,130,246,0.5)'); fxRef.current.triggerShake(3); sfx('grab', 0.5, 0.7); o.x = -999
            } else {
              phR.current = 'falling'; setPhase('falling')
              fxRef.current.triggerShake(6); fxRef.current.triggerFlash('rgba(239,68,68,0.5)')
              sfx('fall', 0.6, 1); sfx('gameOver', 0.6, 0.9)
              fin(); rafR.current = null; sync(); return
            }
          }
        }
        obR.current = obR.current.filter(o => o.x > -500 && o.x < VW + 500)

        const allR = rsR.current
        for (let i = 0; i < allR.length; i++) {
          if (i <= ciR.current) continue
          const r = allR[i], ey = ROPE_AY + r.length * 0.6
          const dist = Math.hypot(p.x - r.anchorX, p.y - ey)
          if (dist < GRAB_R && p.y < ROPE_AY + r.length + 20) {
            ciR.current = i; setCIdx(i); swR.current += 1; setSwCt(swR.current)

            const nLvl = Math.min(MAX_LVL, 1 + Math.floor(swR.current / LVL_SW))
            if (nLvl > lvR.current) {
              lvR.current = nLvl; setLvl(nLvl); setLvUp(true); setTimeout(() => setLvUp(false), 1200)
              sfx('levelup', 0.55, 1); fxRef.current.triggerFlash('rgba(250,204,21,0.35)'); fxRef.current.spawnParticles(12, p.x, p.y)
              chiR.current = (chiR.current + 1) % ALL_CHARS.length; setChI(chiR.current)
              const lb = nLvl * 5; sR.current += lb; setScore(sR.current); fxRef.current.showScorePopup(lb, p.x, p.y - 40, '#fbbf24')
            }

            const gx = p.x - r.anchorX, gy = p.y - ROPE_AY
            p.ang = Math.atan2(gx, gy)
            p.av = ((p.vx * Math.cos(p.ang) - p.vy * Math.sin(p.ang)) / r.length) * 0.7

            const ts = now - lcAt.current
            coR.current = ts < COMBO_DECAY ? coR.current + 1 : 1
            lcAt.current = now; setCombo(coR.current)
            const cmv = cMul(coR.current), fvOn = coR.current >= FVR_TH
            if (fvOn && !fever) sfx('fever', 0.5, 1)
            setFever(fvOn)

            const isPf = dist < GRAB_R * 0.35
            if (isPf) { setPerf(true); setTimeout(() => setPerf(false), 700) }

            const db = Math.floor(Math.abs(p.x - r.anchorX) / DIST_DIV)
            let pts = (1 + db) * cmv
            if (fvOn) pts *= FVR_M; if (isPf) pts *= 2; if (apuR.current.has('score-x2')) pts *= 2
            sR.current += pts; setScore(sR.current)
            phR.current = 'swinging'; setPhase('swinging'); trR.current = []
            if (cmv > 1) sfx('combo', 0.5, 1 + coR.current * 0.02); else sfx('grab', 0.4, 1.05)
            fxRef.current.triggerFlash(isPf ? 'rgba(250,204,21,0.4)' : undefined)
            fxRef.current.spawnParticles(isPf ? 10 : 4, p.x, p.y)
            if (pts > 5) fxRef.current.showScorePopup(pts, p.x, p.y - 30)

            if (i + 1 < allR.length) {
              const nxA = allR[i + 1] ? allR[i + 1].anchorX : r.anchorX + 100
              if (Math.random() < COIN_CH) {
                const ct = 1 + Math.floor(Math.random() * 3) + Math.floor(lvR.current / 4)
                for (let c = 0; c < ct; c++) {
                  const t = (c + 1) / (ct + 1)
                  cnsR.current.push({ id: cnidR.current++, x: r.anchorX + (nxA - r.anchorX) * t + rnd(-25, 25), y: rnd(ROPE_AY + 70, VH - 160), collected: false })
                }
              }
              if (Math.random() < STAR_CH + lvR.current * 0.01)
                stR.current.push({ id: stidR.current++, x: (r.anchorX + nxA) / 2 + rnd(-30, 30), y: rnd(ROPE_AY + 50, VH * 0.4), collected: false })
              if (Math.random() < PU_CH) {
                const ts: PUType[] = ['magnet', 'shield', 'double-jump', 'score-x2', 'speed-boost', 'slow-motion']
                puR.current.push({ id: puidR.current++, x: (r.anchorX + nxA) / 2, y: rnd(ROPE_AY + 50, VH * 0.45), type: ts[Math.floor(Math.random() * ts.length)], collected: false })
              }
              const oc = OBS_CH + lvR.current * 0.015
              if (sR.current > 3 && Math.random() < oc) {
                const d = Math.random() < 0.5 ? 1 : -1
                const ots: Array<'bat' | 'spike' | 'ghost'> = ['bat', 'spike', 'ghost']
                obR.current.push({ id: obidR.current++, x: d > 0 ? -50 : VW + 50, y: rnd(ROPE_AY + 80, VH * 0.6), type: ots[Math.floor(Math.random() * ots.length)], vx: d * rnd(50 + lvR.current * 5, 110 + lvR.current * 8), vy: rnd(-15, 15) })
              }
            }

            let cr = [...rsR.current]
            while (cr.length - i < 3) { const l = cr[cr.length - 1]; cr.push(nxRope(l.anchorX, sR.current, ridR.current++)) }
            const rm = Math.max(0, i - 2)
            if (rm > 0) { cr = cr.slice(rm); ciR.current -= rm; setCIdx(ciR.current) }
            rsR.current = cr; setRopes(cr); break
          }
        }

        if (p.y > FALL_Y || p.x < -180 || p.x > VW + 180) {
          phR.current = 'falling'; setPhase('falling')
          fxRef.current.triggerShake(5); fxRef.current.triggerFlash('rgba(239,68,68,0.5)')
          sfx('fall', 0.6, 1); sfx('gameOver', 0.6, 0.9)
          fin(); rafR.current = null; sync(); return
        }
      }

      const tcx = p.x - VW / 2
      cxR.current += (tcx - cxR.current) * 0.08
      sync(); fxRef.current.updateParticles()
      rafR.current = window.requestAnimationFrame(step)
    }
    rafR.current = window.requestAnimationFrame(step)
    return () => { if (rafR.current !== null) { window.cancelAnimationFrame(rafR.current); rafR.current = null }; lfR.current = null }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isSw = phase === 'swinging'
  const wArr = useMemo(() => {
    const aw = Math.abs(wind); if (aw < 15) return ''
    const d = wind > 0 ? '>' : '<'
    return aw > 80 ? d.repeat(3) : aw > 40 ? d.repeat(2) : d
  }, [wind])
  const pRot = useMemo(() => {
    if (phase === 'flying') return Math.atan2(pR.current.vx, -pR.current.vy) * (180 / Math.PI)
    if (phase === 'swinging') return pAng * (180 / Math.PI) * 0.5
    return 0
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pAng, pPos])
  const curCh = ALL_CHARS[chI]

  return (
    <section className="mini-game-panel rope-swing-panel" aria-label="rope-swing-game"
      style={{ position: 'relative', width: '100%', maxWidth: '432px', height: '100%', margin: '0 auto', overflow: 'hidden', background: '#0a0a1a', imageRendering: 'pixelated', ...fx.getShakeStyle() }}>
      <div onClick={tap} onTouchStart={(e) => { e.preventDefault(); tap() }} role="presentation"
        style={{ width: '100%', height: '100%', position: 'relative', cursor: 'pointer' }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMid slice"
          style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, imageRendering: 'pixelated' }} shapeRendering="crispEdges">
          <defs>
            <linearGradient id="rbg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0a0a2e" /><stop offset="40%" stopColor="#1a1a4e" />
              <stop offset="70%" stopColor="#0d2818" /><stop offset="100%" stopColor="#0a1a0a" />
            </linearGradient>
            <filter id="rgl"><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <filter id="rg2"><feGaussianBlur stdDeviation="5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <rect width={VW} height={VH} fill="url(#rbg)" />

          {/* Pixel stars */}
          {Array.from({ length: 40 }, (_, i) => (
            <PxB key={`s${i}`} x={(i * 89 + 13) % VW} y={(i * 47 + 11) % (VH * 0.35)} s={i % 5 === 0 ? 4 : 2} c={i % 7 === 0 ? '#fbbf24' : '#fff'} o={0.15 + (i % 6) * 0.08} />
          ))}

          {/* Ground */}
          {Array.from({ length: 24 }, (_, i) => (
            <g key={`g${i}`}>
              <PxB x={i * 16} y={VH - 48} s={16} c={i % 3 === 0 ? '#1a4a1a' : '#0d3d0d'} />
              <PxB x={i * 16} y={VH - 32} s={16} c={i % 2 === 0 ? '#143a14' : '#0a2e0a'} />
              <PxB x={i * 16} y={VH - 16} s={16} c="#0a1e0a" />
              {i % 3 === 0 && <PxB x={i * 16 + 4} y={VH - 56} s={6} c="#22c55e" o={0.6} />}
              {i % 4 === 1 && <PxB x={i * 16 + 8} y={VH - 52} s={4} c="#34d399" o={0.5} />}
            </g>
          ))}

          {/* Trees */}
          {[50, 130, 220, 310].map((tx, i) => (
            <g key={`t${i}`} opacity={0.3}>
              <PxB x={tx} y={VH - 120} s={8} c="#064e3b" />
              <PxB x={tx - 4} y={VH - 104} s={16} c="#065f46" />
              <PxB x={tx - 8} y={VH - 88} s={24} c="#064e3b" />
              <PxB x={tx + 2} y={VH - 72} s={4} c="#3a2a1a" />
              <PxB x={tx + 2} y={VH - 56} s={4} c="#3a2a1a" />
            </g>
          ))}

          {sloMo && <rect width={VW} height={VH} fill="rgba(139,92,246,0.08)" />}

          <g transform={`translate(${(-camX).toFixed(1)}, 0)`}>
            {/* Trail */}
            {phase === 'flying' && trail.map((pt, i) => (
              <PxB key={`tr${i}`} x={pt.x - 3} y={pt.y - 3} s={6 + Math.round(pt.op * 4)}
                c={fever ? '#fbbf24' : hasSpd ? '#ec4899' : '#34d399'} o={pt.op * 0.5} />
            ))}

            {/* Ropes */}
            {ropes.map((r, ri) => {
              const act = ri === cIdx && isSw
              const bx = act ? r.anchorX + Math.sin(pAng) * r.length : r.anchorX
              const by = act ? ROPE_AY + Math.cos(pAng) * r.length : ROPE_AY + r.length
              const past = ri < cIdx, isNx = ri === cIdx + 1
              const segs = 12, pts: Array<{ x: number; y: number }> = []
              for (let s = 0; s <= segs; s++) { const t = s / segs; pts.push({ x: r.anchorX + (bx - r.anchorX) * t, y: ROPE_AY + (by - ROPE_AY) * t }) }
              return (
                <g key={r.id} opacity={past ? 0.2 : 1}>
                  <PxB x={r.anchorX - 6} y={ROPE_AY - 6} s={12} c={past ? '#6b7280' : '#fbbf24'} />
                  {!past && <PxB x={r.anchorX - 4} y={ROPE_AY - 4} s={4} c="#fef3c7" o={0.6} />}
                  {pts.map((pt, pi) => <PxB key={pi} x={pt.x - 2} y={pt.y - 2} s={act && pi > segs * 0.7 ? 5 : 4} c={pi % 2 === 0 ? '#d97706' : '#fbbf24'} />)}
                  {isNx && (
                    <rect x={r.anchorX - GRAB_R} y={ROPE_AY + r.length * 0.6 - GRAB_R} width={GRAB_R * 2} height={GRAB_R * 2}
                      fill="none" stroke="#34d399" strokeWidth={2} strokeDasharray="8 4" opacity={0.35} rx={4}>
                      <animate attributeName="opacity" values="0.2;0.45;0.2" dur="1.2s" repeatCount="indefinite" />
                    </rect>
                  )}
                </g>
              )
            })}

            {/* Coins */}
            {coins.map(c => (
              <g key={`c${c.id}`}>
                <PxB x={c.x - COIN_R} y={c.y - COIN_R} s={COIN_R * 2} c="#f59e0b" o={0.9} />
                <PxB x={c.x - COIN_R + 3} y={c.y - COIN_R + 3} s={6} c="#fef3c7" o={0.5} />
                <text x={c.x} y={c.y + 5} textAnchor="middle" fill="#92400e" fontSize={14} fontWeight="bold" fontFamily="monospace">$</text>
              </g>
            ))}

            {/* Stars */}
            {stars.map(s => (
              <g key={`st${s.id}`}>
                <PxB x={s.x - STAR_R} y={s.y - STAR_R} s={STAR_R * 2} c="#fbbf24" />
                <PxB x={s.x - STAR_R + 2} y={s.y - STAR_R + 2} s={4} c="#fef3c7" o={0.7} />
                <text x={s.x} y={s.y + 6} textAnchor="middle" fill="#fff" fontSize={18} fontFamily="monospace" fontWeight="bold">*</text>
              </g>
            ))}

            {/* Power-ups */}
            {pups.map(pu => {
              const d = PUD[pu.type]
              return (
                <g key={`pu${pu.id}`}>
                  <PxB x={pu.x - PU_R - 2} y={pu.y - PU_R - 2} s={PU_R * 2 + 4} c={d.gl} o={0.3} />
                  <PxB x={pu.x - PU_R} y={pu.y - PU_R} s={PU_R * 2} c={d.cl} o={0.85} />
                  <PxB x={pu.x - PU_R + 2} y={pu.y - PU_R + 2} s={6} c="white" o={0.4} />
                  <text x={pu.x} y={pu.y + 6} textAnchor="middle" fill="white" fontSize={16} fontWeight="bold" fontFamily="monospace">{d.ic}</text>
                </g>
              )
            })}

            {/* Obstacles */}
            {obs.map(o => (
              <g key={`ob${o.id}`}>
                <text x={o.x} y={o.y + 8} textAnchor="middle" fontSize={30}>{OBS_E[o.type]}</text>
                <rect x={o.x - OBS_R} y={o.y - OBS_R} width={OBS_R * 2} height={OBS_R * 2} fill="none" stroke="#ef4444" strokeWidth={1} opacity={0.3} />
              </g>
            ))}

            {/* Player */}
            <g transform={`translate(${pPos.x}, ${pPos.y})`}>
              {shld && (
                <rect x={-PW * 0.7} y={-PH * 0.7} width={PW * 1.4} height={PH * 1.4} fill="none" stroke="#3b82f6" strokeWidth={3} opacity={0.6} rx={2}>
                  <animate attributeName="opacity" values="0.4;0.7;0.4" dur="0.8s" repeatCount="indefinite" />
                </rect>
              )}
              <PxB x={-10} y={PH / 2 + 2} s={20} c="#000" o={0.2} />
              <g transform={`rotate(${pRot.toFixed(1)})`}>
                <image href={curCh} x={-PW / 2} y={-PH / 2} width={PW} height={PH} preserveAspectRatio="xMidYMid meet" style={{ imageRendering: 'pixelated' }} />
              </g>
              {fever && (
                <rect x={-PW * 0.55} y={-PH * 0.55} width={PW * 1.1} height={PH * 1.1} fill="none" stroke="#fbbf24" strokeWidth={2} opacity={0.5} rx={2}>
                  <animate attributeName="opacity" values="0.3;0.8;0.3" dur="0.4s" repeatCount="indefinite" />
                </rect>
              )}
              {hasSpd && (
                <g opacity={0.3}><image href={curCh} x={-PW / 2 - 8} y={-PH / 2} width={PW} height={PH} preserveAspectRatio="xMidYMid meet" style={{ imageRendering: 'pixelated' }} /></g>
              )}
            </g>
          </g>

          {/* Danger */}
          {Array.from({ length: Math.ceil(VW / 16) }, (_, i) => (
            <PxB key={`dz${i}`} x={i * 16} y={VH - 48} s={16} c={i % 2 === 0 ? '#ef4444' : 'transparent'} o={0.08} />
          ))}
        </svg>

        {/* HUD */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '8px 14px', pointerEvents: 'none', zIndex: 10 }}>
          <div style={{ display: 'inline-block', background: 'rgba(0,0,0,0.5)', border: '2px solid #fbbf24', borderRadius: 2, padding: '2px 10px', marginBottom: 4, fontFamily: 'monospace', fontSize: '0.8rem', color: '#fbbf24', fontWeight: 700 }}>
            LV.{lvl}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{ fontSize: 'clamp(2.5rem, 8vw, 3.5rem)', fontWeight: 900, color: 'white', margin: 0, fontFamily: 'monospace', lineHeight: 1, textShadow: '2px 2px 0 #000, 0 0 10px rgba(251,191,36,0.3)' }}>{score}</p>
              <p style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', margin: 0, fontFamily: 'monospace' }}>BEST {bestD}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              {combo > 1 && <p style={{ fontSize: 'clamp(1.3rem, 4.5vw, 2rem)', fontWeight: 900, margin: 0, fontFamily: 'monospace', color: cm >= 3 ? '#fbbf24' : '#34d399', textShadow: '2px 2px 0 #000, 0 0 8px currentColor' }}>x{cm}</p>}
              {fever && <p style={{ fontSize: '1.1rem', fontWeight: 900, color: '#fbbf24', margin: 0, fontFamily: 'monospace', textShadow: '2px 2px 0 #000, 0 0 12px #f59e0b', animation: 'rs-bk 0.3s step-end infinite alternate' }}>FEVER!!</p>}
            </div>
          </div>
          {(hasMag || shld || hasSx2 || hasSpd || sloMo || dj > 0) && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
              {hasMag && <PBdg i="M" l="MAG" c="#ef4444" />}
              {shld && <PBdg i="S" l="SHD" c="#3b82f6" />}
              {hasSx2 && <PBdg i="2x" l="SCR" c="#f59e0b" />}
              {hasSpd && <PBdg i=">" l="SPD" c="#ec4899" />}
              {sloMo && <PBdg i="~" l="SLO" c="#8b5cf6" />}
              {dj > 0 && <PBdg i={`J${dj}`} l="JMP" c="#22c55e" />}
            </div>
          )}
        </div>

        {wArr && <div style={{ position: 'absolute', top: '50%', right: wind > 0 ? 6 : 'auto', left: wind < 0 ? 6 : 'auto', color: 'rgba(255,255,255,0.35)', fontSize: '1.8rem', fontWeight: 900, pointerEvents: 'none', transform: 'translateY(-50%)', fontFamily: 'monospace' }}>{wArr}</div>}

        {perf && <div style={{ position: 'absolute', top: '32%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 'clamp(2.2rem, 8vw, 3.2rem)', fontWeight: 900, color: '#fbbf24', fontFamily: 'monospace', textShadow: '3px 3px 0 #000, 0 0 20px #f59e0b', animation: 'rs-pp 0.7s steps(4) forwards', pointerEvents: 'none', zIndex: 20 }}>PERFECT!!</div>}
        {lvUp && <div style={{ position: 'absolute', top: '45%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: 'clamp(1.8rem, 6vw, 2.5rem)', fontWeight: 900, color: '#22c55e', fontFamily: 'monospace', textShadow: '3px 3px 0 #000, 0 0 15px #22c55e', animation: 'rs-pp 1.2s steps(6) forwards', pointerEvents: 'none', zIndex: 20 }}>LEVEL UP! LV.{lvl}</div>}
        {dash && <div style={{ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%, -50%)', fontSize: '2rem', fontWeight: 900, color: '#ec4899', fontFamily: 'monospace', textShadow: '2px 2px 0 #000', animation: 'rs-pp 0.4s steps(3) forwards', pointerEvents: 'none', zIndex: 20 }}>DASH!!</div>}

        <div style={{ position: 'absolute', bottom: 54, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '0 14px', pointerEvents: 'none', fontFamily: 'monospace' }}>
          {coinCt > 0 && <span style={{ color: '#fbbf24', fontSize: '0.9rem', fontWeight: 700, textShadow: '1px 1px 0 #000' }}>${coinCt}</span>}
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>{swCt} swings</span>
        </div>

        {phase === 'flying' && dj > 0 && <div style={{ position: 'absolute', bottom: '22%', left: '50%', transform: 'translateX(-50%)', color: '#22c55e', fontSize: '1.1rem', fontWeight: 900, pointerEvents: 'none', fontFamily: 'monospace', textShadow: '2px 2px 0 #000', animation: 'rs-bk 0.6s step-end infinite' }}>TAP JUMP!</div>}
        {phase === 'swinging' && score === 0 && <div style={{ position: 'absolute', bottom: '18%', left: '50%', transform: 'translateX(-50%)', color: 'rgba(255,255,255,0.5)', fontSize: '1.1rem', fontWeight: 700, pointerEvents: 'none', fontFamily: 'monospace', animation: 'rs-bk 1.2s step-end infinite' }}>TAP TO SWING!</div>}

        <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 10, pointerEvents: 'auto', zIndex: 15 }}>
          <PxBtn l="FINISH" onClick={(e) => { e.stopPropagation(); fin() }} />
          <PxBtn l="EXIT" g onClick={(e) => { e.stopPropagation(); onExitRef.current() }} />
        </div>
      </div>

      <style>{GAME_EFFECTS_CSS}{`
        @keyframes rs-bk{0%,49%{opacity:1}50%,100%{opacity:0.3}}
        @keyframes rs-pp{0%{transform:translate(-50%,-50%) scale(0.3);opacity:0}25%{transform:translate(-50%,-50%) scale(1.3);opacity:1}75%{transform:translate(-50%,-70%) scale(1.1);opacity:1}100%{transform:translate(-50%,-90%) scale(1);opacity:0}}
      `}</style>
      <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
      <ParticleRenderer particles={fx.particles} />
      <ScorePopupRenderer popups={fx.scorePopups} />
    </section>
  )
}

function PBdg({ i, l, c }: { i: string; l: string; c: string }) {
  return <span style={{ background: c + '30', border: `1px solid ${c}`, borderRadius: 2, padding: '1px 6px', fontSize: '0.65rem', color: 'white', fontFamily: 'monospace', fontWeight: 700 }}>[{i}] {l}</span>
}

function PxBtn({ l, g, onClick }: { l: string; g?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '6px 18px', borderRadius: 2, border: `2px solid ${g ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.4)'}`,
      background: g ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.5)', color: g ? 'rgba(255,255,255,0.6)' : 'white',
      fontSize: '0.8rem', fontWeight: 700, fontFamily: 'monospace', cursor: 'pointer',
    }}>{l}</button>
  )
}

export const ropeSwingModule: MiniGameModule = {
  manifest: {
    id: 'rope-swing',
    title: 'Rope Swing',
    description: 'Pixel adventure! Swing, collect, dodge and level up!',
    unlockCost: 55,
    baseReward: 17,
    scoreRewardMultiplier: 1.25,
    accentColor: '#059669',
  },
  Component: RopeSwingGame,
}
