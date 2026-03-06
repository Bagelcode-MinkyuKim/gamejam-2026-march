import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants.ts'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

// ─── Pixel Art Assets ─────────────────────────────────────────────
import stageBackgroundSprite from '../../../assets/images/generated/space-dodge/background.png'
import shipSprite from '../../../assets/images/generated/space-dodge/ship.png'
import meteorSprite from '../../../assets/images/generated/space-dodge/meteor.png'
import fireMeteorSprite from '../../../assets/images/generated/space-dodge/meteor-fire.png'
import starSprite from '../../../assets/images/generated/space-dodge/star.png'
import coinSprite from '../../../assets/images/generated/space-dodge/coin.png'
import shieldPuSprite from '../../../assets/images/generated/space-dodge/shield-pu.png'
import magnetPuSprite from '../../../assets/images/generated/space-dodge/magnet-pu.png'
import slowPuSprite from '../../../assets/images/generated/space-dodge/slow-pu.png'
import relayCoreSprite from '../../../assets/images/generated/space-dodge/relay-core.png'
import bossMeteorSprite from '../../../assets/images/generated/space-dodge/boss.png'

// ─── Sounds ───────────────────────────────────────────────────────
import meteorHitSfx from '../../../assets/sounds/space-dodge-meteor-hit.mp3'
import starCollectSfx from '../../../assets/sounds/space-dodge-star-collect.mp3'
import shieldSfx from '../../../assets/sounds/space-dodge-shield.mp3'
import burstWarningSfx from '../../../assets/sounds/space-dodge-burst-warning.mp3'
import comboSfx from '../../../assets/sounds/space-dodge-combo.mp3'
import magnetSfx from '../../../assets/sounds/space-dodge-magnet.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import dodgeSfx from '../../../assets/sounds/space-dodge-dodge.mp3'
import hpRestoreSfx from '../../../assets/sounds/space-dodge-hp-restore.mp3'
import slowSfx from '../../../assets/sounds/space-dodge-slow.mp3'
import levelUpSfx from '../../../assets/sounds/space-dodge-level-up.mp3'
import coinSfx from '../../../assets/sounds/space-dodge-coin.mp3'
import dangerSfx from '../../../assets/sounds/space-dodge-danger.mp3'
import laserSfx from '../../../assets/sounds/space-dodge-laser.mp3'
import dashSfx from '../../../assets/sounds/space-dodge-dash.mp3'
import explodeSfx from '../../../assets/sounds/space-dodge-explode.mp3'
import feverSfx from '../../../assets/sounds/space-dodge-fever.mp3'
import warpSfx from '../../../assets/sounds/space-dodge-warp.mp3'
import bossWarnSfx from '../../../assets/sounds/space-dodge-boss-warn.mp3'
import startSfx from '../../../assets/sounds/space-dodge-start.mp3'
import relayCoreSfx from '../../../assets/sounds/space-dodge-relay-core.mp3'
import overdrivePulseSfx from '../../../assets/sounds/space-dodge-overdrive-pulse.mp3'
import spaceDodgeBgmLoop from '../../../assets/sounds/space-dodge-bgm-loop.mp3'

// ─── Stage ────────────────────────────────────────────────────────
const W = 390
const H = 693

// ─── Player ───────────────────────────────────────────────────────
const SHIP_W = 56
const SHIP_H = 64
const PCOL = 22
const PY_OFF = 96
const LERP = 0.18

// ─── HP ───────────────────────────────────────────────────────────
const INIT_HP = 3
const MAX_HP = 5

// ─── Meteors ──────────────────────────────────────────────────────
const M_BASE_SPD = 155
const M_MAX_SPD = 440
const M_SPD_RAMP = 7
const M_BASE_INT = 1050
const M_MIN_INT = 220
const M_INT_RAMP = 22
const M_MIN_R = 14
const M_MAX_R = 30

// ─── Boss ─────────────────────────────────────────────────────────
const BOSS_INT_SEC = 30
const BOSS_R = 52
const BOSS_SPD = 55
const BOSS_HP_MAX = 5
const BOSS_PTS = 250

// ─── Collectibles ─────────────────────────────────────────────────
const STAR_SPD = 115
const STAR_INT = 4500
const STAR_R = 16
const STAR_PTS = 50
const COIN_SPD = 105
const COIN_INT = 7000
const COIN_R = 13
const COIN_PTS = 30

// ─── Scoring ──────────────────────────────────────────────────────
const PTS_SEC = 12
const HIT_INV_MS = 1200

// ─── Power-ups ────────────────────────────────────────────────────
const SHIELD_INT = 13000
const SHIELD_R = 16
const SHIELD_SPD = 95
const SHIELD_DUR = 3500
const MAGNET_INT = 17000
const MAGNET_R = 16
const MAGNET_SPD = 85
const MAGNET_DUR = 5000
const MAG_RANGE = 160
const MAG_STR = 320
const SLOW_INT = 21000
const SLOW_R = 14
const SLOW_SPD = 80
const SLOW_DUR = 3000
const SLOW_FACT = 0.4

// ─── Dash ─────────────────────────────────────────────────────────
const DASH_CD = 2500
const DASH_DIST = 120
const DASH_INV = 400

// ─── Danger ───────────────────────────────────────────────────────
const HP_REST_SEC = 25
const BURST_SEC = 12
const BURST_N = 7
const LASER_SEC = 20
const LASER_WARN = 1200
const LASER_ACT = 400
const LASER_W = 50

// ─── Combo / Fever ────────────────────────────────────────────────
const COMBO_WIN = 3000
const COMBO_MULT = [1, 1.2, 1.5, 2, 3] as const
const FEVER_COMBO = 4
const FEVER_DUR = 6000
const FEVER_SCORE_MULT = 2
const OVERDRIVE_SCORE_MULT = 1.5

// ─── Relay Core ───────────────────────────────────────────────────
const RELAY_INT = 18000
const RELAY_SPD = 92
const RELAY_R = 18
const RELAY_DUR = 6500
const RELAY_PTS = 90
const OVERDRIVE_PULSE_MS = 550
const OVERDRIVE_PULSE_R = 150
const OVERDRIVE_PULSE_PTS = 14
const SPACE_DODGE_BGM_VOLUME = 0.22

// ─── Warp Gate ────────────────────────────────────────────────────
const WARP_INT_SEC = 50
const WARP_R = 30
const WARP_SPD = 70
const WARP_PTS = 150

// ─── Level ────────────────────────────────────────────────────────
const LVL_T = [0, 15, 35, 60, 90, 130, 180] as const
const LVL_N = ['SECTOR 1', 'SECTOR 2', 'ASTEROID BELT', 'NEBULA ZONE', 'DARK SPACE', 'BLACK HOLE', 'BEYOND'] as const
const LVL_HUE = [220, 250, 180, 280, 310, 0, 45] as const

// ─── Trail ────────────────────────────────────────────────────────
const TRAIL_LEN = 10
const TRAIL_INT = 35
const STARFIELD_IDS = Array.from({ length: 80 }, (_, i) => i)
const SCANLINE_IDS = Array.from({ length: 10 }, (_, i) => i)
const LASER_SEGMENT_IDS = Array.from({ length: 18 }, (_, i) => i)

// ─── Types ────────────────────────────────────────────────────────
interface Meteor { id: number; x: number; y: number; radius: number; speed: number; isFire: boolean; isBoss: boolean; hp: number; rot: number; rotSpd: number }
interface Star { id: number; x: number; y: number; speed: number }
interface Coin { id: number; x: number; y: number; speed: number }
interface PowerUp { id: number; x: number; y: number; speed: number; type: 'shield' | 'magnet' | 'slow' }
interface Laser { x: number; warnAt: number; activeAt: number; endAt: number }
interface Trail { x: number; y: number }
interface Ghost { x: number; y: number; t: number }
interface Boom { id: number; x: number; y: number; r: number; t: number; c: string }
interface Warp { id: number; x: number; y: number; speed: number }
interface RelayCore { id: number; x: number; y: number; anchorX: number; speed: number; sway: number; phase: number }

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }
function rng(a: number, b: number) { return a + Math.random() * (b - a) }
function hit(ax: number, ay: number, ar: number, bx: number, by: number, br: number) {
  const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy <= (ar + br) * (ar + br)
}
function getLevel(s: number) { for (let i = LVL_T.length - 1; i >= 0; i--) { if (s >= LVL_T[i]) return i } return 0 }

// ─── Component ────────────────────────────────────────────────────
function SpaceDodgeGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [px, setPx] = useState(W / 2)
  const [hp, setHp] = useState(INIT_HP)
  const [score, setScore] = useState(0)
  const [ms, setMs] = useState(0)
  const [meteors, setMeteors] = useState<Meteor[]>([])
  const [stars, setStars] = useState<Star[]>([])
  const [coins, setCoins] = useState<Coin[]>([])
  const [pups, setPups] = useState<PowerUp[]>([])
  const [inv, setInv] = useState(false)
  const [shieldOn, setShieldOn] = useState(false)
  const [magnetOn, setMagnetOn] = useState(false)
  const [slowOn, setSlowOn] = useState(false)
  const [msg, setMsg] = useState('Drag to dodge!')
  const [combo, setCombo] = useState(0)
  const [trail, setTrail] = useState<Trail[]>([])
  const [lasers, setLasers] = useState<Laser[]>([])
  const [nebHue, setNebHue] = useState(220)
  const [lvl, setLvl] = useState(0)
  const [dashPct, setDashPct] = useState(0)
  const [booms, setBooms] = useState<Boom[]>([])
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [dashing, setDashing] = useState(false)
  const [lvlFlash, setLvlFlash] = useState(false)
  const [feverOn, setFeverOn] = useState(false)
  const [warps, setWarps] = useState<Warp[]>([])
  const [relays, setRelays] = useState<RelayCore[]>([])
  const [overdriveOn, setOverdriveOn] = useState(false)

  const fx = useGameEffects()
  const fxRef = useRef(fx)

  const pxR = useRef(W / 2), txR = useRef(W / 2)
  const hpR = useRef(INIT_HP), scR = useRef(0), bonR = useRef(0), msR = useRef(0)
  const metR = useRef<Meteor[]>([]), staR = useRef<Star[]>([]), coinR = useRef<Coin[]>([])
  const pupR = useRef<PowerUp[]>([]), lasR = useRef<Laser[]>([])
  const boomR = useRef<Boom[]>([]), ghostR = useRef<Ghost[]>([]), warpR = useRef<Warp[]>([]), relayR = useRef<RelayCore[]>([])
  const nid = useRef(0)
  const lmS = useRef(0), lsS = useRef(0), lcS = useRef(0)
  const lShS = useRef(0), lMgS = useRef(0), lSlS = useRef(0)
  const shUntil = useRef(0), mgUntil = useRef(0), slUntil = useRef(0)
  const lHpSec = useRef(0), lBstSec = useRef(0), lLasSec = useRef(0), lBossSec = useRef(0), lWarpSec = useRef(0), lRelaySec = useRef(0)
  const invUntil = useRef(0), finRef = useRef(false)
  const rafRef = useRef<number | null>(null), lastTRef = useRef<number | null>(null)
  const stgRef = useRef<HTMLDivElement | null>(null), ptrDown = useRef(false)
  const comboR = useRef(0), comboTmr = useRef(0)
  const trailR = useRef<Trail[]>([]), lTrail = useRef(0)
  const dodgeStreak = useRef(0), lvlR = useRef(0)
  const lDash = useRef(0), dashUntil = useRef(0)
  const lDblTap = useRef(0), lTapX = useRef(0)
  const feverUntil = useRef(0), relayUntil = useRef(0), lOverPulse = useRef(0), dashFxUntil = useRef(0), lvlFlashUntil = useRef(0)

  const sfxRefs = useRef<Record<string, HTMLAudioElement>>({})
  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const audioPrimedRef = useRef(false)
  const shieldOnRef = useRef(false), magnetOnRef = useRef(false), slowOnRef = useRef(false), feverOnRef = useRef(false), overdriveOnRef = useRef(false), dashingRef = useRef(false), lvlFlashRef = useRef(false)
  const play = useCallback((k: string, vol: number, rate = 1) => {
    const a = sfxRefs.current[k]; if (!a) return
    a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])
  const startBgm = useCallback(() => {
    if (!audioPrimedRef.current) { audioPrimedRef.current = true; play('start', 0.45, 1) }
    const bgm = bgmRef.current
    if (bgm === null || finRef.current || !bgm.paused) return
    void bgm.play().catch(() => {})
  }, [play])

  const onFinishRef = useRef(onFinish)
  const onExitRef = useRef(onExit)

  useEffect(() => { fxRef.current = fx }, [fx])
  useEffect(() => { onFinishRef.current = onFinish }, [onFinish])
  useEffect(() => { onExitRef.current = onExit }, [onExit])
  useEffect(() => { shieldOnRef.current = shieldOn }, [shieldOn])
  useEffect(() => { magnetOnRef.current = magnetOn }, [magnetOn])
  useEffect(() => { slowOnRef.current = slowOn }, [slowOn])
  useEffect(() => { feverOnRef.current = feverOn }, [feverOn])
  useEffect(() => { overdriveOnRef.current = overdriveOn }, [overdriveOn])
  useEffect(() => { dashingRef.current = dashing }, [dashing])
  useEffect(() => { lvlFlashRef.current = lvlFlash }, [lvlFlash])

  const finish = useCallback(() => {
    if (finRef.current) return; finRef.current = true
    const dur = msR.current > 0 ? Math.round(msR.current) : Math.round(DEFAULT_FRAME_MS)
    const sc = Math.floor((msR.current / 1000) * PTS_SEC) + bonR.current
    if (bgmRef.current !== null) { bgmRef.current.pause(); bgmRef.current.currentTime = 0 }
    play('gameover', 0.65, 0.9); setMsg('GAME OVER')
    fxRef.current.triggerShake(14); fxRef.current.triggerFlash('rgba(239,68,68,0.6)')
    onFinishRef.current({ score: sc, durationMs: dur })
  }, [play])

  const dash = useCallback((dir: number) => {
    const now = msR.current
    if (now - lDash.current < DASH_CD) return
    startBgm()
    lDash.current = now; dashUntil.current = now + DASH_INV
    dashFxUntil.current = now + 200
    const nx = clamp(pxR.current + dir * DASH_DIST, SHIP_W / 2, W - SHIP_W / 2)
    ghostR.current = [...ghostR.current, { x: pxR.current, y: H - PY_OFF, t: now }]
    pxR.current = nx; txR.current = nx; setPx(nx)
    if (!dashingRef.current) { dashingRef.current = true; setDashing(true) }
    play('dash', 0.5, 1.2)
    fxRef.current.spawnParticles(4, nx, H - PY_OFF)
  }, [play, startBgm])

  const updTx = useCallback((cx: number) => {
    const el = stgRef.current; if (!el) return
    const r = el.getBoundingClientRect()
    txR.current = clamp((cx - r.left) / r.width * W, SHIP_W / 2, W - SHIP_W / 2)
  }, [])

  const onPtrDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault(); ptrDown.current = true
    startBgm()
    const now = msR.current, el = stgRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      const tx = (e.clientX - r.left) / r.width * W
      if (now - lDblTap.current < 300 && Math.abs(tx - lTapX.current) < 80) {
        dash(tx > W / 2 ? 1 : -1); lDblTap.current = 0
      } else { lDblTap.current = now; lTapX.current = tx }
    }
    updTx(e.clientX)
  }, [updTx, dash, startBgm])

  const onPtrMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!ptrDown.current && e.pointerType === 'mouse') return; updTx(e.clientX)
  }, [updTx])
  const onPtrUp = useCallback(() => { ptrDown.current = false }, [])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExitRef.current(); return }
      if (finRef.current) return
      startBgm()
      if (e.code === 'ArrowLeft') { e.preventDefault(); txR.current = clamp(txR.current - 40, SHIP_W / 2, W - SHIP_W / 2) }
      if (e.code === 'ArrowRight') { e.preventDefault(); txR.current = clamp(txR.current + 40, SHIP_W / 2, W - SHIP_W / 2) }
      if (e.code === 'Space') { e.preventDefault(); dash(txR.current > pxR.current ? 1 : -1) }
    }
    window.addEventListener('keydown', kd); return () => window.removeEventListener('keydown', kd)
  }, [dash, startBgm])

  useEffect(() => {
    const map: Record<string, string> = {
      hit: meteorHitSfx, star: starCollectSfx, shield: shieldSfx, burst: burstWarningSfx,
      combo: comboSfx, magnet: magnetSfx, gameover: gameOverHitSfx, dodge: dodgeSfx,
      hprestore: hpRestoreSfx, slow: slowSfx, lvlup: levelUpSfx, coin: coinSfx,
      danger: dangerSfx, laser: laserSfx, dash: dashSfx, explode: explodeSfx,
      fever: feverSfx, warp: warpSfx, bosswarn: bossWarnSfx, start: startSfx,
      relay: relayCoreSfx, overdrive: overdrivePulseSfx,
    }
    const all: HTMLAudioElement[] = []
    for (const [k, src] of Object.entries(map)) { const a = new Audio(src); a.preload = 'auto'; sfxRefs.current[k] = a; all.push(a) }
    const bgm = new Audio(spaceDodgeBgmLoop)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = SPACE_DODGE_BGM_VOLUME
    bgmRef.current = bgm
    return () => {
      fxRef.current.cleanup()
      if (bgmRef.current !== null) { bgmRef.current.pause(); bgmRef.current.currentTime = 0; bgmRef.current = null }
      for (const a of all) { a.pause(); a.currentTime = 0 }
    }
  }, [])

  useEffect(() => {
    lastTRef.current = null
    const step = (now: number) => {
      if (finRef.current) { rafRef.current = null; return }
      if (lastTRef.current === null) lastTRef.current = now
      const raw = Math.min(now - lastTRef.current, MAX_FRAME_DELTA_MS); lastTRef.current = now
      const isSlow = msR.current < slUntil.current
      const ts = isSlow ? SLOW_FACT : 1, dt = raw * ts, ds = dt / 1000
      msR.current += raw; setMs(msR.current); fxRef.current.updateParticles()
      const el = msR.current, sec = el / 1000, isFever = el < feverUntil.current, isOverdrive = el < relayUntil.current

      const nl = getLevel(sec)
      if (nl > lvlR.current) {
        lvlR.current = nl; setLvl(nl); setMsg(LVL_N[nl] ?? `SECTOR ${nl + 1}`)
        play('lvlup', 0.6, 1); fxRef.current.triggerFlash('rgba(250,204,21,0.3)', 120); fxRef.current.triggerShake(4)
        lvlFlashUntil.current = el + 600
        if (!lvlFlashRef.current) { lvlFlashRef.current = true; setLvlFlash(true) }
      }
      setNebHue(LVL_HUE[Math.min(nl, LVL_HUE.length - 1)] + Math.sin(sec * 0.05) * 20)
      if (isFever !== feverOnRef.current) { feverOnRef.current = isFever; setFeverOn(isFever) }
      if (isOverdrive !== overdriveOnRef.current) { overdriveOnRef.current = isOverdrive; setOverdriveOn(isOverdrive) }
      const dashFxOn = el < dashFxUntil.current
      if (dashFxOn !== dashingRef.current) { dashingRef.current = dashFxOn; setDashing(dashFxOn) }
      const lvlFlashOn = el < lvlFlashUntil.current
      if (lvlFlashOn !== lvlFlashRef.current) { lvlFlashRef.current = lvlFlashOn; setLvlFlash(lvlFlashOn) }

      const cx = pxR.current, nx = cx + (txR.current - cx) * LERP
      pxR.current = nx; setPx(nx); setDashPct(clamp(1 - (el - lDash.current) / DASH_CD, 0, 1))

      if (el - lTrail.current > TRAIL_INT) {
        lTrail.current = el; trailR.current = [{ x: nx, y: H - PY_OFF }, ...trailR.current].slice(0, TRAIL_LEN); setTrail([...trailR.current])
      }

      const mSpd = Math.min(M_MAX_SPD, M_BASE_SPD + sec * M_SPD_RAMP)
      const mInt = Math.max(M_MIN_INT, M_BASE_INT - sec * M_INT_RAMP)

      if (el - lmS.current >= mInt) { lmS.current = el; const r = rng(M_MIN_R, M_MAX_R); const fire = Math.random() < 0.12 + sec * 0.003
        metR.current = [...metR.current, { id: nid.current++, x: rng(r, W - r), y: -r, radius: r, speed: mSpd * rng(0.8, 1.2), isFire: fire, isBoss: false, hp: 1, rot: Math.random() * 6.28, rotSpd: rng(-4, 4) }] }

      const bSec = Math.floor(sec / BOSS_INT_SEC)
      if (bSec > lBossSec.current && sec > 20) { lBossSec.current = bSec; play('bosswarn', 0.7, 0.95); play('danger', 0.5, 0.82); setMsg('BOSS INCOMING!'); fxRef.current.triggerFlash('rgba(239,68,68,0.25)', 150); fxRef.current.triggerShake(8)
        metR.current = [...metR.current, { id: nid.current++, x: W / 2, y: -BOSS_R * 2, radius: BOSS_R, speed: BOSS_SPD, isFire: true, isBoss: true, hp: BOSS_HP_MAX, rot: 0, rotSpd: 1.5 }] }

      if (el - lsS.current >= STAR_INT) { lsS.current = el; staR.current = [...staR.current, { id: nid.current++, x: rng(20, W - 20), y: -STAR_R, speed: STAR_SPD }] }
      if (el - lcS.current >= COIN_INT) { lcS.current = el; coinR.current = [...coinR.current, { id: nid.current++, x: rng(20, W - 20), y: -COIN_R, speed: COIN_SPD }] }

      if (el - lShS.current >= SHIELD_INT) { lShS.current = el; pupR.current = [...pupR.current, { id: nid.current++, x: rng(20, W - 20), y: -SHIELD_R, speed: SHIELD_SPD, type: 'shield' }] }
      if (el - lMgS.current >= MAGNET_INT) { lMgS.current = el; pupR.current = [...pupR.current, { id: nid.current++, x: rng(20, W - 20), y: -MAGNET_R, speed: MAGNET_SPD, type: 'magnet' }] }
      if (el - lSlS.current >= SLOW_INT) { lSlS.current = el; pupR.current = [...pupR.current, { id: nid.current++, x: rng(20, W - 20), y: -SLOW_R, speed: SLOW_SPD, type: 'slow' }] }

      const wSec = Math.floor(sec / WARP_INT_SEC)
      if (wSec > lWarpSec.current && sec > 30) { lWarpSec.current = wSec; warpR.current = [...warpR.current, { id: nid.current++, x: rng(40, W - 40), y: -WARP_R, speed: WARP_SPD }] }
      const rSec = Math.floor(sec * 1000 / RELAY_INT)
      if (rSec > lRelaySec.current && sec > 12) {
        lRelaySec.current = rSec
        const anchorX = rng(72, W - 72)
        relayR.current = [...relayR.current, {
          id: nid.current++,
          x: anchorX,
          y: -RELAY_R * 2,
          anchorX,
          speed: RELAY_SPD,
          sway: rng(34, 72),
          phase: Math.random() * Math.PI * 2,
        }]
      }

      const buS = Math.floor(sec / BURST_SEC)
      if (buS > lBstSec.current) { lBstSec.current = buS; play('burst', 0.55, 1)
        for (let b = 0; b < BURST_N; b++) { const r = rng(M_MIN_R, M_MAX_R)
          metR.current = [...metR.current, { id: nid.current++, x: rng(r, W - r), y: -r - b * 35, radius: r, speed: mSpd * rng(0.9, 1.4), isFire: Math.random() < 0.3, isBoss: false, hp: 1, rot: Math.random() * 6.28, rotSpd: rng(-4, 4) }] }
        setMsg('METEOR BURST!'); fxRef.current.triggerFlash('rgba(249,115,22,0.35)', 100); fxRef.current.triggerShake(6) }

      const laS = Math.floor(sec / LASER_SEC)
      if (laS > lLasSec.current && sec > 10) { lLasSec.current = laS; play('laser', 0.45, 1)
        lasR.current = [...lasR.current, { x: rng(LASER_W, W - LASER_W), warnAt: el, activeAt: el + LASER_WARN, endAt: el + LASER_WARN + LASER_ACT }] }

      const hrS = Math.floor(sec / HP_REST_SEC)
      if (hrS > lHpSec.current && hpR.current < MAX_HP) { lHpSec.current = hrS; hpR.current = Math.min(MAX_HP, hpR.current + 1); setHp(hpR.current); setMsg('+1 HP!'); play('hprestore', 0.5, 1); fxRef.current.triggerFlash('rgba(34,197,94,0.3)', 80) }

      if (comboR.current > 0 && el > comboTmr.current) { comboR.current = 0; setCombo(0) }
      boomR.current = boomR.current.filter(b => el - b.t < 500)
      ghostR.current = ghostR.current.filter(g => el - g.t < 400)

      const py = H - PY_OFF
      const shAct = el < shUntil.current, mgAct = el < mgUntil.current || isFever, slAct = el < slUntil.current, daAct = el < dashUntil.current
      const isInv = el < invUntil.current || shAct || daAct
      if (shAct !== shieldOnRef.current) { shieldOnRef.current = shAct; setShieldOn(shAct) }
      if (mgAct !== magnetOnRef.current) { magnetOnRef.current = mgAct; setMagnetOn(mgAct) }
      if (slAct !== slowOnRef.current) { slowOnRef.current = slAct; setSlowOn(slAct) }
      let hitFrame = false; const sMult = (isFever ? FEVER_SCORE_MULT : 1) * (isOverdrive ? OVERDRIVE_SCORE_MULT : 1)

      if (isOverdrive && el - lOverPulse.current >= OVERDRIVE_PULSE_MS) {
        lOverPulse.current = el
        const targets = metR.current
          .filter(m => !m.isBoss && hit(pxR.current, py, OVERDRIVE_PULSE_R, m.x, m.y, m.radius))
          .sort((a, b) => {
            const adx = a.x - pxR.current, ady = a.y - py
            const bdx = b.x - pxR.current, bdy = b.y - py
            return adx * adx + ady * ady - (bdx * bdx + bdy * bdy)
          })
          .slice(0, 2)
        if (targets.length > 0) {
          const pulsePts = Math.floor(targets.length * OVERDRIVE_PULSE_PTS * sMult)
          bonR.current += pulsePts
          play('overdrive', 0.48, 1 + targets.length * 0.08)
          setMsg('OVERDRIVE PULSE!')
          fxRef.current.triggerFlash('rgba(249,115,22,0.24)', 90)
          fxRef.current.spawnParticles(4 + targets.length * 2, pxR.current, py)
          const targetIds = new Set(targets.map(t => t.id))
          for (const t of targets) {
            boomR.current = [...boomR.current, { id: nid.current++, x: t.x, y: t.y, r: t.radius * 1.7, t: el, c: '#fb923c' }]
          }
          metR.current = metR.current.filter(m => !targetIds.has(m.id))
        }
      }

      const nm: Meteor[] = []
      for (const m of metR.current) {
        const u = { ...m, y: m.y + m.speed * ds }
        if (m.isBoss && shAct && hit(pxR.current, py, PCOL + 10, u.x, u.y, u.radius)) {
          u.hp -= 1
          if (u.hp <= 0) { bonR.current += BOSS_PTS * sMult; fxRef.current.comboHitBurst(u.x, u.y, 12, BOSS_PTS * sMult); fxRef.current.triggerShake(10); play('explode', 0.6, 0.8)
            boomR.current = [...boomR.current, { id: nid.current++, x: u.x, y: u.y, r: BOSS_R * 2, t: el, c: '#ef4444' }]; setMsg(`BOSS DESTROYED! +${BOSS_PTS * sMult}`); continue }
          fxRef.current.spawnParticles(3, u.x, u.y); play('hit', 0.4, 0.9); nm.push(u); continue }
        if (u.y > H + u.radius + 20) { if (!m.isBoss) { dodgeStreak.current++; if (dodgeStreak.current % 10 === 0) { bonR.current += 20; fxRef.current.comboHitBurst(W / 2, 80, 4, 20); setMsg(`${dodgeStreak.current} Dodge!`); if (dodgeStreak.current % 30 === 0) play('dodge', 0.4, 1.2) } } continue }
        let lasDest = false
        for (const l of lasR.current) { if (el >= l.activeAt && el < l.endAt && Math.abs(u.x - l.x) < LASER_W / 2 + u.radius) { lasDest = true; fxRef.current.spawnParticles(4, u.x, u.y); bonR.current += 10; boomR.current = [...boomR.current, { id: nid.current++, x: u.x, y: u.y, r: u.radius * 1.5, t: el, c: '#9ca3af' }]; break } }
        if (lasDest) continue
        if (!isInv && !hitFrame && hit(pxR.current, py, PCOL, u.x, u.y, u.radius)) {
          hitFrame = true; dodgeStreak.current = 0; const dmg = m.isFire ? 2 : 1; const nh = Math.max(0, hpR.current - dmg)
          hpR.current = nh; setHp(nh); invUntil.current = el + HIT_INV_MS; setInv(true); play('hit', 0.6, m.isFire ? 0.8 : 1)
          setMsg(m.isFire ? `FIRE! -${dmg}` : `HP ${nh}`); fxRef.current.triggerShake(m.isFire ? 12 : 7); fxRef.current.triggerFlash(m.isFire ? 'rgba(220,38,38,0.5)' : 'rgba(239,68,68,0.4)')
          fxRef.current.spawnParticles(m.isFire ? 8 : 5, pxR.current, py); comboR.current = 0; setCombo(0)
          if (nh === 1) play('danger', 0.5, 1.2)
          if (nh <= 0) { metR.current = nm; setMeteors(nm); finish(); rafRef.current = null; return }
          continue }
        nm.push(u) }
      metR.current = nm

      const ns: Star[] = []; let gotStar = false
      for (const s of staR.current) {
        let sx = s.x, sy = s.y + s.speed * ds
        if (mgAct) { const dx = pxR.current - sx, dy = py - sy, d = Math.sqrt(dx * dx + dy * dy); if (d < MAG_RANGE && d > 1) { sx += (dx / d) * MAG_STR * ds; sy += (dy / d) * MAG_STR * ds } }
        const u = { ...s, x: sx, y: sy }; if (u.y > H + 30) continue
        if (hit(pxR.current, py, PCOL, u.x, u.y, STAR_R)) {
          const cm = COMBO_MULT[Math.min(comboR.current, COMBO_MULT.length - 1)]; const pts = Math.floor(STAR_PTS * cm * sMult); bonR.current += pts; gotStar = true
          comboR.current = Math.min(comboR.current + 1, COMBO_MULT.length - 1); comboTmr.current = el + COMBO_WIN; setCombo(comboR.current)
          setMsg(comboR.current > 1 ? `x${cm}! +${pts}` : `+${pts}`); fxRef.current.comboHitBurst(pxR.current, py - 30, 5, pts)
          if (comboR.current >= 2) play('combo', 0.45, 1 + comboR.current * 0.15)
          if (comboR.current >= FEVER_COMBO && el >= feverUntil.current) { feverUntil.current = el + FEVER_DUR; setFeverOn(true); setMsg('FEVER!'); play('fever', 0.6, 1); fxRef.current.triggerFlash('rgba(250,204,21,0.4)', 150); fxRef.current.triggerShake(5) }
          continue }
        ns.push(u) }
      staR.current = ns; if (gotStar) play('star', 0.5, 1.2)

      const nc: Coin[] = []; let gotCoin = false
      for (const c of coinR.current) {
        let ccx = c.x, ccy = c.y + c.speed * ds
        if (mgAct) { const dx = pxR.current - ccx, dy = py - ccy, d = Math.sqrt(dx * dx + dy * dy); if (d < MAG_RANGE && d > 1) { ccx += (dx / d) * MAG_STR * ds; ccy += (dy / d) * MAG_STR * ds } }
        const u = { ...c, x: ccx, y: ccy }; if (u.y > H + 30) continue
        if (hit(pxR.current, py, PCOL, u.x, u.y, COIN_R)) {
          const cm = COMBO_MULT[Math.min(comboR.current, COMBO_MULT.length - 1)]; const pts = Math.floor(COIN_PTS * cm * sMult); bonR.current += pts; gotCoin = true
          comboR.current = Math.min(comboR.current + 1, COMBO_MULT.length - 1); comboTmr.current = el + COMBO_WIN; setCombo(comboR.current); fxRef.current.comboHitBurst(pxR.current, py - 30, 4, pts)
          if (comboR.current >= FEVER_COMBO && el >= feverUntil.current) { feverUntil.current = el + FEVER_DUR; setFeverOn(true); setMsg('FEVER!'); play('fever', 0.6, 1); fxRef.current.triggerFlash('rgba(250,204,21,0.4)', 150) }
          continue }
        nc.push(u) }
      coinR.current = nc; if (gotCoin) play('coin', 0.45, 1.4)

      const np: PowerUp[] = []
      for (const p of pupR.current) {
        const u = { ...p, y: p.y + p.speed * ds }; if (u.y > H + 20) continue
        const pr = p.type === 'shield' ? SHIELD_R : p.type === 'magnet' ? MAGNET_R : SLOW_R
        if (hit(pxR.current, py, PCOL, u.x, u.y, pr)) {
          if (p.type === 'shield') { shUntil.current = el + SHIELD_DUR; setShieldOn(true); setMsg('SHIELD!'); play('shield', 0.5, 1); fxRef.current.triggerFlash('rgba(56,189,248,0.3)', 80) }
          else if (p.type === 'magnet') { mgUntil.current = el + MAGNET_DUR; setMagnetOn(true); setMsg('MAGNET!'); play('magnet', 0.5, 1); fxRef.current.triggerFlash('rgba(168,85,247,0.3)', 80) }
          else { slUntil.current = el + SLOW_DUR; setSlowOn(true); setMsg('SLOW!'); play('slow', 0.5, 1); fxRef.current.triggerFlash('rgba(52,211,153,0.3)', 80) }
          fxRef.current.spawnParticles(6, pxR.current, py); continue }
        np.push(u) }
      pupR.current = np

      const nr: RelayCore[] = []
      for (const r of relayR.current) {
        const rx = clamp(r.anchorX + Math.sin(el * 0.004 + r.phase) * r.sway, RELAY_R + 16, W - RELAY_R - 16)
        const u = { ...r, x: rx, y: r.y + r.speed * ds }
        if (u.y > H + RELAY_R * 2) continue
        if (hit(pxR.current, py, PCOL, u.x, u.y, RELAY_R)) {
          const relayPts = Math.floor(RELAY_PTS * sMult)
          bonR.current += relayPts
          relayUntil.current = el + RELAY_DUR
          lOverPulse.current = el - OVERDRIVE_PULSE_MS
          overdriveOnRef.current = true; setOverdriveOn(true)
          setMsg(`OVERDRIVE! +${relayPts}`)
          play('relay', 0.56, 1.15)
          fxRef.current.triggerFlash('rgba(251,146,60,0.3)', 140)
          fxRef.current.triggerShake(7)
          fxRef.current.comboHitBurst(pxR.current, py - 24, 6, relayPts)
          continue
        }
        nr.push(u)
      }
      relayR.current = nr

      const nw: Warp[] = []
      for (const w of warpR.current) {
        const u = { ...w, y: w.y + w.speed * ds }; if (u.y > H + 40) continue
        if (hit(pxR.current, py, PCOL, u.x, u.y, WARP_R)) {
          bonR.current += WARP_PTS * sMult; play('warp', 0.6, 1); setMsg(`WARP! +${WARP_PTS * sMult}`)
          fxRef.current.triggerFlash('rgba(139,92,246,0.4)', 200); fxRef.current.triggerShake(8); fxRef.current.comboHitBurst(pxR.current, py, 10, WARP_PTS * sMult)
          for (const m of metR.current) { if (!m.isBoss) boomR.current = [...boomR.current, { id: nid.current++, x: m.x, y: m.y, r: m.radius * 1.5, t: el, c: '#8b5cf6' }] }
          metR.current = metR.current.filter(m => m.isBoss); play('explode', 0.5, 1.1); continue }
        nw.push(u) }
      warpR.current = nw

      const laserHit = !isInv && lasR.current.some(l => el >= l.activeAt && el < l.endAt && Math.abs(pxR.current - l.x) < LASER_W / 2 + PCOL)
      if (laserHit && !hitFrame) {
        hitFrame = true; dodgeStreak.current = 0; hpR.current = Math.max(0, hpR.current - 1); setHp(hpR.current)
        invUntil.current = el + HIT_INV_MS; setInv(true); play('hit', 0.7, 1.2); setMsg('LASER!')
        fxRef.current.triggerShake(10); fxRef.current.triggerFlash('rgba(239,68,68,0.5)'); fxRef.current.spawnParticles(6, pxR.current, py)
        if (hpR.current <= 0) { finish(); rafRef.current = null; return } }
      lasR.current = lasR.current.filter(l => el < l.endAt)
      if (isInv && el >= invUntil.current && !shAct && !daAct) setInv(false)

      const curSc = Math.floor(sec * PTS_SEC) + bonR.current; scR.current = curSc; setScore(curSc)
      setMeteors([...metR.current]); setStars([...staR.current]); setCoins([...coinR.current])
      setPups([...pupR.current]); setLasers([...lasR.current]); setBooms([...boomR.current])
      setGhosts([...ghostR.current]); setWarps([...warpR.current]); setRelays([...relayR.current])
      rafRef.current = window.requestAnimationFrame(step)
    }
    rafRef.current = window.requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }; lastTRef.current = null }
  }, [finish, play])

  const bestDisp = Math.max(bestScore, score), py = H - PY_OFF
  const hearts = useMemo(() => { const r: string[] = []; for (let i = 0; i < MAX_HP; i++) r.push(i < hp ? '\u2764\uFE0F' : '\uD83E\uDE76'); return r }, [hp])
  const cm = COMBO_MULT[Math.min(combo, COMBO_MULT.length - 1)]
  const ln = LVL_N[Math.min(lvl, LVL_N.length - 1)]

  return (
    <section className="mini-game-panel sd-panel" aria-label="space-dodge-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...fx.getShakeStyle() }}>
      <div className="sd-stage" ref={stgRef} onPointerDown={onPtrDown} onPointerMove={onPtrMove} onPointerUp={onPtrUp} onPointerCancel={onPtrUp} onPointerLeave={onPtrUp} role="presentation">
        <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
        <ParticleRenderer particles={fx.particles} />
        <ScorePopupRenderer popups={fx.scorePopups} />
        {lvlFlash && <div className="sd-lvl-flash" />}
        {feverOn && <div className="sd-fever-border" />}
        {overdriveOn && <div className="sd-overdrive-border" />}

        <svg className="sd-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="sd-las" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(239,68,68,0)" /><stop offset="20%" stopColor="rgba(239,68,68,0.8)" /><stop offset="80%" stopColor="rgba(239,68,68,0.8)" /><stop offset="100%" stopColor="rgba(239,68,68,0)" /></linearGradient>
            <radialGradient id="sd-wg"><stop offset="0%" stopColor="rgba(139,92,246,0.6)" /><stop offset="100%" stopColor="rgba(139,92,246,0)" /></radialGradient>
            <filter id="sd-glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>

          <image href={stageBackgroundSprite} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />
          <rect x={0} y={0} width={W} height={H} fill="rgba(2,6,23,0.28)" />

          {STARFIELD_IDS.map((i) => {
            const layer = i % 3, spd = 0.12 + layer * 0.16
            const sx = ((i * 97 + 13) % W), sy = ((i * 53 + 7 + (ms * 0.022 * spd)) % H)
            const sz = 2 + layer * 2, tw = 0.45 + Math.sin(ms * 0.003 + i * 1.7) * 0.18
            const clr = layer === 2 ? '#f8fafc' : layer === 1 ? `hsl(${nebHue + 18}, 90%, 82%)` : '#7dd3fc'
            return <rect key={`bg${i}`} x={sx} y={sy} width={sz} height={sz} fill={clr} opacity={tw + layer * 0.1} />
          })}
          {SCANLINE_IDS.map((i) => <rect key={`scan${i}`} x={0} y={i * 72 + ((ms * 0.03) % 72)} width={W} height={2} fill="rgba(148,163,184,0.08)" />)}

          {lasers.map((l, li) => {
            const warn = ms >= l.warnAt && ms < l.activeAt, act = ms >= l.activeAt && ms < l.endAt
            if (!warn && !act) return null
            return <g key={`l${li}`}>
              {warn && Math.sin(ms * 0.02) > 0 && <rect x={l.x-LASER_W/2} y={0} width={LASER_W} height={H} fill="rgba(239,68,68,0.12)" stroke="rgba(248,113,113,0.45)" strokeWidth="2" strokeDasharray="10 6" />}
              {act && <>
                <rect x={l.x-LASER_W/2} y={0} width={LASER_W} height={H} fill="url(#sd-las)" opacity="0.78" />
                {LASER_SEGMENT_IDS.map((bi) => <rect key={bi} x={l.x-LASER_W/2} y={bi * 40} width={LASER_W} height={20} fill={bi % 2 === 0 ? 'rgba(255,255,255,0.12)' : 'rgba(239,68,68,0.14)'} />)}
                <rect x={l.x-LASER_W/4} y={0} width={LASER_W/2} height={H} fill="rgba(255,255,255,0.26)" />
              </>}
            </g>
          })}

          {booms.map(b => { const age = (ms - b.t) / 500; if (age > 1) return null; const r = b.r * (0.3 + age * 0.7), op = 1 - age
            return <g key={`b${b.id}`}><circle cx={b.x} cy={b.y} r={r} fill={b.c} opacity={op*0.4} /><circle cx={b.x} cy={b.y} r={r*0.6} fill="white" opacity={op*0.5} />
              {[0,1,2,3,4,5].map(pi => { const a = (pi/6)*6.28+age*2; return <rect key={pi} x={b.x+Math.cos(a)*r*0.8-1} y={b.y+Math.sin(a)*r*0.8-1} width={3} height={3} fill={b.c} opacity={op} /> })}</g> })}

          {ghosts.map((g, gi) => { const age = (ms - g.t) / 400; if (age > 1) return null
            return <image key={`dg${gi}`} href={shipSprite} x={g.x-SHIP_W/2} y={g.y-SHIP_H/2} width={SHIP_W} height={SHIP_H} opacity={(1-age)*0.4} preserveAspectRatio="xMidYMid meet" style={{ filter: 'hue-rotate(180deg) brightness(1.5)' }} /> })}

          {trail.map((d, ti) => <rect key={`tr${ti}`} x={d.x-2*(1-ti/TRAIL_LEN)} y={d.y-2*(1-ti/TRAIL_LEN)} width={4*(1-ti/TRAIL_LEN)} height={4*(1-ti/TRAIL_LEN)}
            fill={dashing ? 'rgba(250,204,21,0.3)' : feverOn ? 'rgba(250,204,21,0.2)' : 'rgba(56,189,248,0.15)'} opacity={1-ti/TRAIL_LEN} />)}

          {warps.map(w => { const p = 0.8+Math.sin(ms*0.01+w.id)*0.2, sp = (ms*0.003)%(Math.PI*2)
            return <g key={`w${w.id}`}><circle cx={w.x} cy={w.y} r={WARP_R*2*p} fill="url(#sd-wg)" />
              <circle cx={w.x} cy={w.y} r={WARP_R*p} fill="none" stroke="#8b5cf6" strokeWidth="3" opacity="0.7" />
              <circle cx={w.x} cy={w.y} r={WARP_R*0.6*p} fill="none" stroke="#c4b5fd" strokeWidth="2" opacity="0.5" strokeDasharray="4 6" strokeDashoffset={sp*20} />
              <text x={w.x} y={w.y+4} textAnchor="middle" fill="white" fontSize="10" fontWeight="bold" style={{fontFamily:'monospace'}}>WARP</text></g> })}

          {relays.map(r => {
            const aura = 0.82 + Math.sin(ms * 0.012 + r.phase) * 0.18
            return <g key={`r${r.id}`}>
              <rect x={r.x - RELAY_R * 1.35} y={r.y - RELAY_R * 1.35} width={RELAY_R * 2.7} height={RELAY_R * 2.7} fill="rgba(251,146,60,0.14)" opacity={aura} />
              <rect x={r.x - RELAY_R * 1.7} y={r.y - 2} width={RELAY_R * 3.4} height={4} fill="rgba(125,211,252,0.45)" opacity={aura} />
              <rect x={r.x - 2} y={r.y - RELAY_R * 1.7} width={4} height={RELAY_R * 3.4} fill="rgba(125,211,252,0.45)" opacity={aura} />
              <image href={relayCoreSprite} x={r.x-RELAY_R} y={r.y-RELAY_R} width={RELAY_R*2} height={RELAY_R*2} preserveAspectRatio="xMidYMid meet" />
            </g>
          })}

          {meteors.map(m => { const sz = m.radius * 2
            if (m.isBoss) { const p = 0.9+Math.sin(ms*0.008)*0.1
              return <g key={`m${m.id}`}><circle cx={m.x} cy={m.y} r={m.radius*2} fill="rgba(239,68,68,0.08)" /><circle cx={m.x} cy={m.y} r={m.radius*1.4*p} fill="rgba(239,68,68,0.12)" />
                <image href={bossMeteorSprite} x={m.x-m.radius*p} y={m.y-m.radius*p} width={m.radius*2*p} height={m.radius*2*p} preserveAspectRatio="xMidYMid meet" />
                <rect x={m.x-25} y={m.y-m.radius-12} width={50} height={6} rx={1} fill="rgba(0,0,0,0.5)" /><rect x={m.x-25} y={m.y-m.radius-12} width={50*(m.hp/BOSS_HP_MAX)} height={6} rx={1} fill="#ef4444" /></g> }
            return <g key={`m${m.id}`}>{m.isFire && <circle cx={m.x} cy={m.y} r={sz*0.8} fill="rgba(239,68,68,0.12)" />}
              <image href={m.isFire?fireMeteorSprite:meteorSprite} x={m.x-sz/2} y={m.y-sz/2} width={sz} height={sz} preserveAspectRatio="xMidYMid meet" /></g> })}

          {stars.map(s => <g key={`s${s.id}`}><circle cx={s.x} cy={s.y} r={STAR_R*2} fill="rgba(250,204,21,0.1)" />
            <image href={starSprite} x={s.x-STAR_R} y={s.y-STAR_R} width={STAR_R*2} height={STAR_R*2} preserveAspectRatio="xMidYMid meet" /></g>)}

          {coins.map(c => <g key={`c${c.id}`}><circle cx={c.x} cy={c.y} r={COIN_R*1.8} fill="rgba(245,158,11,0.1)" />
            <image href={coinSprite} x={c.x-COIN_R} y={c.y-COIN_R} width={COIN_R*2} height={COIN_R*2} preserveAspectRatio="xMidYMid meet" /></g>)}

          {pups.map(p => { const sp = p.type==='shield'?shieldPuSprite:p.type==='magnet'?magnetPuSprite:slowPuSprite
            const r=16, pulse=0.8+Math.sin(ms*0.008+p.id)*0.2
            const clr = p.type==='shield'?'rgba(56,189,248,0.15)':p.type==='magnet'?'rgba(168,85,247,0.15)':'rgba(52,211,153,0.15)'
            return <g key={`p${p.id}`}><circle cx={p.x} cy={p.y} r={r*1.5*pulse} fill={clr} />
              <image href={sp} x={p.x-r} y={p.y-r} width={r*2} height={r*2} preserveAspectRatio="xMidYMid meet" /></g> })}

          {magnetOn && <rect x={px-MAG_RANGE/2} y={py-MAG_RANGE/2} width={MAG_RANGE} height={MAG_RANGE} fill="none" stroke="#a855f7" strokeWidth="2" strokeDasharray="8 8" opacity={0.2+Math.sin(ms*0.006)*0.15} />}
          {shieldOn && <><rect x={px-SHIP_W*0.58} y={py-SHIP_W*0.58} width={SHIP_W*1.16} height={SHIP_W*1.16} fill="none" stroke="#38bdf8" strokeWidth="4" opacity={0.5+Math.sin(ms*0.01)*0.3} /><rect x={px-SHIP_W*0.52} y={py-SHIP_W*0.52} width={SHIP_W*1.04} height={SHIP_W*1.04} fill="rgba(56,189,248,0.08)" /></>}
          {overdriveOn && <>
            <rect x={px-OVERDRIVE_PULSE_R/2} y={py-OVERDRIVE_PULSE_R/2} width={OVERDRIVE_PULSE_R} height={OVERDRIVE_PULSE_R} fill="none" stroke="rgba(251,146,60,0.45)" strokeWidth="3" strokeDasharray="12 8" />
            <rect x={px-OVERDRIVE_PULSE_R/2-10} y={py-OVERDRIVE_PULSE_R/2-10} width={OVERDRIVE_PULSE_R+20} height={OVERDRIVE_PULSE_R+20} fill="none" stroke="rgba(125,211,252,0.2)" strokeWidth="2" />
          </>}

          <rect x={px-SHIP_W*0.25} y={py+SHIP_H*0.4} width={SHIP_W*0.5} height={3} fill="rgba(0,200,255,0.2)" rx={1} />
          <image className={`sd-player ${inv?'sd-blink':''} ${dashing?'sd-dash-glow':''}`} href={shipSprite} x={px-SHIP_W/2} y={py-SHIP_H/2} width={SHIP_W} height={SHIP_H} preserveAspectRatio="xMidYMid meet" />
          {[0,1,2].map(i => { const ew=3+Math.sin(ms*0.015+i)*1.5, eh=6+Math.sin(ms*0.012+i*2)*3
            return <rect key={`eng${i}`} x={px-ew/2+(i-1)*4} y={py+SHIP_H*0.4} width={ew} height={eh} fill={i===1?'rgba(255,255,255,0.7)':'rgba(56,189,248,0.5)'} rx={1} /> })}
          {dashing && <><rect x={px-SHIP_W*0.35-3} y={py+SHIP_H*0.15} width={4} height={8} fill="rgba(250,204,21,0.6)" /><rect x={px+SHIP_W*0.35-1} y={py+SHIP_H*0.15} width={4} height={8} fill="rgba(250,204,21,0.6)" /></>}
          {slowOn && <rect x={0} y={0} width={W} height={H} fill="rgba(52,211,153,0.05)" />}
          {hp===1 && <rect x={0} y={0} width={W} height={H} fill="none" stroke="rgba(239,68,68,0.4)" strokeWidth="16" opacity={0.4+Math.sin(ms*0.008)*0.3} />}
        </svg>

        <div className="sd-hud">
          <div className="sd-hud-top">
            <div className="sd-hearts">{hearts.map((h, i) => <span key={i} className="sd-heart">{h}</span>)}</div>
            <div className="sd-score-area"><p className="sd-score">{score}</p>
              {combo > 0 && <p className={`sd-combo ${feverOn?'sd-combo-fever':''}`}>x{cm} {feverOn?'FEVER!':'COMBO'}</p>}</div>
            <p className="sd-best">BEST {bestDisp}</p>
          </div>
          <div className="sd-hud-sub"><p className="sd-level">{ln}</p><p className="sd-time">{(ms/1000).toFixed(1)}s</p></div>
          <div className="sd-pu-bar">
            {shieldOn && <span className="sd-badge" style={{background:'#38bdf8'}}>SHIELD</span>}
            {magnetOn && <span className="sd-badge" style={{background:'#a855f7'}}>MAGNET</span>}
            {slowOn && <span className="sd-badge" style={{background:'#34d399'}}>SLOW</span>}
            {feverOn && <span className="sd-badge sd-badge-fever" style={{background:'#f59e0b'}}>FEVER x{FEVER_SCORE_MULT}</span>}
            {overdriveOn && <span className="sd-badge sd-badge-overdrive" style={{background:'#f97316'}}>OVERDRIVE x{OVERDRIVE_SCORE_MULT.toFixed(1)}</span>}
          </div>
        </div>
        <div className="sd-dash-ind"><div className="sd-dash-fill" style={{height:`${(1-dashPct)*100}%`}} /><span className="sd-dash-lbl">{dashPct<=0?'DASH':''}</span></div>
        <p className="sd-status">{msg}</p>
        <div className="sd-actions">
          <button className="sd-btn ghost" type="button" onPointerDown={e=>e.stopPropagation()} onClick={() => { startBgm(); onExitRef.current() }}>EXIT</button>
        </div>
      </div>

      <style>{`
        ${GAME_EFFECTS_CSS}
        .sd-panel{background:#020617;color:#e2e8f0;display:flex;flex-direction:column;align-items:center;width:100%;height:100%;overflow:hidden;user-select:none;image-rendering:pixelated}
        .sd-stage{position:relative;width:100%;height:100%;background:#050816;overflow:hidden;touch-action:none}
        .sd-svg{display:block;width:100%;height:100%;image-rendering:pixelated}
        .sd-player{filter:drop-shadow(0 0 10px rgba(56,189,248,0.7));image-rendering:pixelated}
        .sd-dash-glow{filter:drop-shadow(0 0 16px rgba(250,204,21,0.9)) drop-shadow(0 0 6px rgba(255,255,255,0.5))}
        .sd-blink{animation:sd-blink 0.15s infinite alternate}
        @keyframes sd-blink{0%{opacity:1}100%{opacity:0.2}}
        .sd-lvl-flash{position:absolute;inset:0;background:rgba(250,204,21,0.15);animation:sd-flash 0.6s ease-out forwards;pointer-events:none;z-index:15}
        @keyframes sd-flash{0%{opacity:1}100%{opacity:0}}
        .sd-fever-border{position:absolute;inset:0;border:3px solid rgba(250,204,21,0.4);box-shadow:inset 0 0 30px rgba(250,204,21,0.15);pointer-events:none;z-index:14;animation:sd-fpulse 0.5s ease-in-out infinite alternate}
        .sd-overdrive-border{position:absolute;inset:6px;border:4px solid rgba(249,115,22,0.7);box-shadow:0 0 0 4px rgba(125,211,252,0.2), inset 0 0 24px rgba(249,115,22,0.18);pointer-events:none;z-index:13;animation:sd-opulse 0.45s steps(2,end) infinite}
        @keyframes sd-fpulse{0%{border-color:rgba(250,204,21,0.3)}100%{border-color:rgba(250,204,21,0.6)}}
        @keyframes sd-opulse{0%{transform:translateY(0)}100%{transform:translateY(-1px)}}
        .sd-hud{position:absolute;top:0;left:0;right:0;padding:14px 14px 8px;pointer-events:none;z-index:10}
        .sd-hud-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
        .sd-hud-sub{display:flex;align-items:center;justify-content:space-between;margin-top:6px}
        .sd-hearts,.sd-best,.sd-level,.sd-time{background:rgba(15,23,42,0.82);border:2px solid rgba(148,163,184,0.28);box-shadow:3px 3px 0 rgba(2,6,23,0.9)}
        .sd-hearts{display:flex;gap:4px;font-size:20px;padding:6px 8px}.sd-heart{display:inline-block}
        .sd-score-area{flex:1;text-align:center;min-width:164px;background:rgba(15,23,42,0.82);border:3px solid rgba(56,189,248,0.45);box-shadow:4px 4px 0 rgba(2,6,23,0.9);padding:8px 12px 6px}
        .sd-score{margin:0;font-size:56px;line-height:0.88;font-weight:900;letter-spacing:2px;color:#f8fafc;text-shadow:3px 3px 0 #0f172a,0 0 12px rgba(56,189,248,0.45);font-family:monospace}
        .sd-combo{margin:4px 0 0;font-size:20px;font-weight:700;color:#facc15;text-shadow:2px 2px 0 #451a03;animation:sd-cpulse 0.6s ease-in-out infinite alternate;font-family:monospace}
        .sd-combo-fever{color:#f59e0b;text-shadow:2px 2px 0 #7c2d12, 0 0 12px rgba(245,158,11,0.8);font-size:22px}
        @keyframes sd-cpulse{0%{transform:scale(1)}100%{transform:scale(1.12)}}
        .sd-best{margin:0;font-size:13px;font-weight:700;color:#cbd5e1;text-align:right;min-width:72px;padding:8px 10px;font-family:monospace}
        .sd-level{margin:0;font-size:12px;font-weight:700;color:#facc15;text-shadow:0 0 6px rgba(250,204,21,0.4);letter-spacing:1px;font-family:monospace;padding:5px 8px}
        .sd-time{margin:0;font-size:13px;color:#cbd5e1;font-family:monospace;padding:5px 8px}
        .sd-pu-bar{display:flex;justify-content:center;gap:6px;margin-top:4px}
        .sd-badge{padding:4px 10px;border-radius:0;font-size:11px;font-weight:700;color:white;font-family:monospace;animation:sd-glow 1s ease-in-out infinite alternate;box-shadow:2px 2px 0 rgba(2,6,23,0.8)}
        .sd-badge-fever{animation:sd-fb 0.3s ease-in-out infinite alternate}
        .sd-badge-overdrive{animation:sd-fb 0.25s steps(2,end) infinite}
        @keyframes sd-glow{0%{opacity:0.7}100%{opacity:1}}
        @keyframes sd-fb{0%{transform:scale(1);opacity:0.8}100%{transform:scale(1.1);opacity:1}}
        .sd-dash-ind{position:absolute;right:10px;bottom:72px;width:34px;height:104px;background:rgba(0,0,0,0.56);border-radius:0;border:3px solid rgba(56,189,248,0.4);box-shadow:3px 3px 0 rgba(2,6,23,0.9);overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;z-index:10}
        .sd-dash-fill{width:100%;background:linear-gradient(180deg,#67e8f9,#0ea5e9);transition:height 0.1s}
        .sd-dash-lbl{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:9px;font-weight:700;color:white;text-shadow:0 1px 3px rgba(0,0,0,0.8);font-family:monospace;writing-mode:vertical-rl;letter-spacing:1px}
        .sd-status{position:absolute;bottom:66px;left:50%;transform:translateX(-50%);min-width:180px;padding:6px 10px;background:rgba(15,23,42,0.82);border:2px solid rgba(251,191,36,0.28);box-shadow:3px 3px 0 rgba(2,6,23,0.9);text-align:center;font-size:17px;font-weight:700;color:#e2e8f0;margin:0;pointer-events:none;z-index:10;text-shadow:0 1px 8px rgba(0,0,0,0.9);font-family:monospace}
        .sd-actions{position:absolute;bottom:14px;left:0;right:0;display:flex;justify-content:center;gap:10px;z-index:20}
        .sd-btn{padding:10px 22px;border:2px solid rgba(125,211,252,0.48);border-radius:0;font-size:15px;font-weight:700;cursor:pointer;background:rgba(30,58,95,0.96);color:#e2e8f0;box-shadow:3px 3px 0 rgba(2,6,23,0.9);transition:background 0.15s;font-family:monospace}
        .sd-btn:hover{background:rgba(30,58,95,1)}
        .sd-btn.ghost{background:rgba(255,255,255,0.08);color:#94a3b8;border-color:rgba(148,163,184,0.28)}
        .sd-btn.ghost:hover{background:rgba(255,255,255,0.14)}
      `}</style>
    </section>
  )
}

export const spaceDodgeModule: MiniGameModule = {
  manifest: {
    id: 'space-dodge',
    title: 'Space Dodge',
    description: 'Pixel art space survival with Relay Core overdrive, bosses, lasers, and warp gates.',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#1e3a5f',
  },
  Component: SpaceDodgeGame,
}
