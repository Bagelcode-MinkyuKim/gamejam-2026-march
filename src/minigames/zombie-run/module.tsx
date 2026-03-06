import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

// ─── Pixel art assets ───
import zombieSpriteSheet from '../../../assets/images/generated/zombie-run/zombie-sprite.png'
import playerSpriteSheet from '../../../assets/images/generated/zombie-run/player-sprite.png'
import bgCityImg from '../../../assets/images/generated/zombie-run/bg-city.png'

// ─── Sound imports (8-bit style) ───
import zombieGrowlSfx from '../../../assets/sounds/zombie-run-zombie-growl.mp3'
import coinCollectSfx from '../../../assets/sounds/zombie-run-coin-collect.mp3'
import jumpSfx from '../../../assets/sounds/zombie-run-jump-8bit.mp3'
import hitSfx from '../../../assets/sounds/zombie-run-hit-8bit.mp3'
import powerupSfx from '../../../assets/sounds/zombie-run-powerup-8bit.mp3'
import feverSfx from '../../../assets/sounds/zombie-run-fever.mp3'
import comboSfx from '../../../assets/sounds/zombie-run-combo.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ═══ Game constants ═══
const GAME_DURATION_MS = 120_000
const PLAYER_START_POS = 120
const ZOMBIE_START_POS = 0
const INITIAL_ZOMBIE_SPEED = 26
const ZOMBIE_ACCEL = 4.0
const MAX_ZOMBIE_SPEED = 85
const TAP_MOVE = 9
const TAP_DECAY = 0.91
const TAP_SPEED_INF = 0.55
const MIN_GAP_GAME_OVER = 0
const DIST_SCORE_MULT = 1.2
const TIME_SCORE_MULT = 5
const BAR_MAX_GAP = 220

// ═══ Obstacle ═══
const OBS_SPAWN_MS = 3000
const OBS_MIN_MS = 1600
const OBS_DECAY = 0.93
const OBS_SPEED = 65
const JUMP_MS = 600
const JUMP_H = 70

// ═══ Viewport ═══
const VW = 432
const VH = 768
const GROUND_Y = 580
const PLAYER_W = 72
const PLAYER_H = 72
const ZOMBIE_W = 80
const ZOMBIE_H = 80

// ═══ Gimmicks ═══
const POWERUP_INTERVAL_MS = 7500
const SPEED_BOOST_VAL = 45
const SPEED_DURATION_MS = 3000
const INVINCIBLE_MS = 4000
const COIN_INTERVAL_MS = 3500
const COIN_SCORE = 20
const COMBO_WINDOW_MS = 280
const COMBO_BONUS_EVERY = 8
const COMBO_BONUS_PTS = 8
const FEVER_TAPS = 45
const FEVER_MS = 5000
const FEVER_MULT = 1.6

// ═══ Double-tap dash ═══
const DASH_WINDOW_MS = 200
const DASH_BOOST = 35
const DASH_COOLDOWN_MS = 1500

// ═══ HP system (3 hits) ═══
const MAX_HP = 3

// ═══ Magnet powerup ═══
const MAGNET_MS = 5000
const MAGNET_RANGE = 120

// ═══ Stage system ═══
const STAGE_AT = [0, 12000, 28000, 50000, 80000]
const STAGE_NAMES = ['City Escape', 'Dark Alley', 'Graveyard', 'Factory', 'Final Run']

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function calcScore(dist: number, ms: number, bonus: number) {
  return Math.max(0, Math.floor(dist * DIST_SCORE_MULT + (ms / 1000) * TIME_SCORE_MULT + bonus))
}

function getStage(ms: number) {
  for (let i = STAGE_AT.length - 1; i >= 0; i--) if (ms >= STAGE_AT[i]) return i
  return 0
}

type ObsType = 'crate' | 'barrel' | 'spike' | 'coin' | 'speed' | 'invincible' | 'magnet' | 'heart'
interface Obs { id: number; x: number; y: number; w: number; h: number; type: ObsType }

function ZombieRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const fx = useGameEffects()
  const fxRef = useRef(fx)
  fxRef.current = fx

  // ── State ──
  const [score, setScore] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [gap, setGap] = useState(PLAYER_START_POS - ZOMBIE_START_POS)
  const [status, setStatus] = useState('TAP to escape!')
  const [jumping, setJumping] = useState(false)
  const [jumpProg, setJumpProg] = useState(0)
  const [obs, setObs] = useState<Obs[]>([])
  const [tapFlash, setTapFlash] = useState(false)
  const [combo, setCombo] = useState(0)
  const [speedBoosted, setSpeedBoosted] = useState(false)
  const [speedMs, setSpeedMs] = useState(0)
  const [invincible, setInvincible] = useState(false)
  const [invMs, setInvMs] = useState(0)
  const [coins, setCoins] = useState(0)
  const [, setBonusScore] = useState(0)
  const [fever, setFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [stage, setStage] = useState(0)
  const [stageMsg, setStageMsg] = useState<string | null>(null)
  const [hp, setHp] = useState(MAX_HP)
  const [magnetActive, setMagnetActive] = useState(false)
  const [magnetMs, setMagnetMs] = useState(0)
  const [bgScroll, setBgScroll] = useState(0)
  const [groundScroll, setGroundScroll] = useState(0)
  const [playerFrame, setPlayerFrame] = useState(0)
  const [zombieFrame, setZombieFrame] = useState(0)
  const [dashReady, setDashReady] = useState(true)

  // ── Refs ──
  const pPos = useRef(PLAYER_START_POS)
  const zPos = useRef(ZOMBIE_START_POS)
  const msRef = useRef(0)
  const doneRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastT = useRef<number | null>(null)
  const tapSpeed = useRef(0)
  const lastTap = useRef(0)
  const tapCount = useRef(0)
  const jumpAt = useRef<number | null>(null)
  const obsArr = useRef<Obs[]>([])
  const nextObs = useRef(OBS_SPAWN_MS)
  const obsId = useRef(0)
  const obsInterval = useRef(OBS_SPAWN_MS)
  const comboRef = useRef(0)
  const speedRef = useRef(false)
  const speedMsRef = useRef(0)
  const invRef = useRef(false)
  const invMsRef = useRef(0)
  const coinRef = useRef(0)
  const bonusRef = useRef(0)
  const nextCoin = useRef(COIN_INTERVAL_MS)
  const nextPow = useRef(POWERUP_INTERVAL_MS)
  const feverRef = useRef(false)
  const feverMsRef = useRef(0)
  const tapsSinceFever = useRef(0)
  const stageRef = useRef(0)
  const hpRef = useRef(MAX_HP)
  const magnetRef = useRef(false)
  const magnetMsRef = useRef(0)
  const lastGrowl = useRef(0)
  const frameTimer = useRef(0)
  const dashCooldown = useRef(0)

  // ── Audio refs ──
  const sndGrowl = useRef<HTMLAudioElement | null>(null)
  const sndCoin = useRef<HTMLAudioElement | null>(null)
  const sndJump = useRef<HTMLAudioElement | null>(null)
  const sndHit = useRef<HTMLAudioElement | null>(null)
  const sndPow = useRef<HTMLAudioElement | null>(null)
  const sndFever = useRef<HTMLAudioElement | null>(null)
  const sndCombo = useRef<HTMLAudioElement | null>(null)
  const sndOver = useRef<HTMLAudioElement | null>(null)

  const play = useCallback((el: HTMLAudioElement | null, vol: number, rate = 1) => {
    if (!el) return; el.currentTime = 0; el.volume = vol; el.playbackRate = rate
    void el.play().catch(() => {})
  }, [])

  const onFinishRef = useRef(onFinish)
  onFinishRef.current = onFinish
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const finish = useCallback((reason: string) => {
    if (doneRef.current) return; doneRef.current = true
    setStatus(reason)
    const dur = msRef.current > 0 ? msRef.current : Math.round(DEFAULT_FRAME_MS)
    const s = calcScore(pPos.current - PLAYER_START_POS, msRef.current, bonusRef.current)
    setScore(s); play(sndOver.current, 0.6, 0.95)
    fxRef.current.triggerShake(12); fxRef.current.triggerFlash('rgba(239,68,68,0.6)')
    onFinishRef.current({ score: s, durationMs: dur })
  }, [play])

  // ── Tap handler ──
  const handleTap = useCallback(() => {
    if (doneRef.current) return
    const now = performance.now()
    const dt = now - lastTap.current
    lastTap.current = now; tapCount.current++; tapsSinceFever.current++

    // Double-tap dash
    if (dt < DASH_WINDOW_MS && dashCooldown.current <= 0) {
      pPos.current += DASH_BOOST
      dashCooldown.current = DASH_COOLDOWN_MS
      setDashReady(false)
      fxRef.current.spawnParticles(6, VW * 0.6, GROUND_Y - 50, ['>>>', 'DASH!'])
      fxRef.current.triggerFlash('rgba(34,211,238,0.15)')
      play(sndPow.current, 0.4, 1.5)
    }

    // Combo
    if (dt < COMBO_WINDOW_MS) { comboRef.current++ } else { comboRef.current = 1 }
    setCombo(comboRef.current)

    if (comboRef.current > 0 && comboRef.current % COMBO_BONUS_EVERY === 0) {
      const pts = COMBO_BONUS_PTS * Math.floor(comboRef.current / COMBO_BONUS_EVERY)
      bonusRef.current += pts; setBonusScore(bonusRef.current)
      fxRef.current.showScorePopup(pts, VW * 0.6, GROUND_Y - 120)
      fxRef.current.spawnParticles(5, VW * 0.6, GROUND_Y - 80, ['COMBO!'])
      play(sndCombo.current, 0.5, 1.0 + comboRef.current * 0.02)
    }

    // Fever
    if (tapsSinceFever.current >= FEVER_TAPS && !feverRef.current) {
      feverRef.current = true; feverMsRef.current = FEVER_MS
      setFever(true); setFeverMs(FEVER_MS); tapsSinceFever.current = 0
      play(sndFever.current, 0.7)
      fxRef.current.triggerFlash('rgba(239,68,68,0.25)')
      fxRef.current.spawnParticles(10, VW / 2, GROUND_Y / 2, ['FEVER!', 'MAX!', 'POWER!'])
    }

    const fMul = feverRef.current ? FEVER_MULT : 1
    const sMul = speedRef.current ? 1.5 : 1
    const boost = TAP_MOVE * fMul * sMul
    pPos.current += boost
    tapSpeed.current = Math.min(tapSpeed.current + boost * TAP_SPEED_INF, MAX_ZOMBIE_SPEED * 1.5)

    setTapFlash(true); setTimeout(() => setTapFlash(false), 70)
    play(sndHit.current, 0.2, 0.85 + Math.random() * 0.3)
  }, [play])

  const handleJump = useCallback(() => {
    if (doneRef.current || jumpAt.current !== null) return
    jumpAt.current = msRef.current; setJumping(true)
    play(sndJump.current, 0.5, 1.1)
    fxRef.current.spawnParticles(3, VW * 0.6, GROUND_Y, ['dust', 'dust'])
  }, [play])

  // ── Init audio ──
  useEffect(() => {
    const all: HTMLAudioElement[] = []
    const mk = (src: string) => { const a = new Audio(src); a.preload = 'auto'; all.push(a); return a }
    sndGrowl.current = mk(zombieGrowlSfx)
    sndCoin.current = mk(coinCollectSfx)
    sndJump.current = mk(jumpSfx)
    sndHit.current = mk(hitSfx)
    sndPow.current = mk(powerupSfx)
    sndFever.current = mk(feverSfx)
    sndCombo.current = mk(comboSfx)
    sndOver.current = mk(gameOverHitSfx)
    return () => { for (const a of all) { a.pause(); a.currentTime = 0 }; fxRef.current.cleanup() }
  }, [])

  // ── Input ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.code === 'Space' || e.code === 'ArrowRight') { e.preventDefault(); handleTap() }
      if (e.code === 'ArrowUp') { e.preventDefault(); handleJump() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleTap, handleJump, onExit])

  useEffect(() => {
    let sy = 0
    const ts = (e: TouchEvent) => { sy = e.touches[0].clientY }
    const te = (e: TouchEvent) => { if (sy - e.changedTouches[0].clientY > 30) handleJump() }
    window.addEventListener('touchstart', ts, { passive: true })
    window.addEventListener('touchend', te, { passive: true })
    return () => { window.removeEventListener('touchstart', ts); window.removeEventListener('touchend', te) }
  }, [handleJump])

  // ═══ Game Loop ═══
  useEffect(() => {
    lastT.current = null

    const step = (now: number) => {
      if (doneRef.current) { rafRef.current = null; return }
      if (lastT.current === null) lastT.current = now
      const dt = Math.min(now - lastT.current, MAX_FRAME_DELTA_MS)
      lastT.current = now; msRef.current += dt; setElapsed(msRef.current)
      const ms = msRef.current; const sec = ms / 1000

      if (ms >= GAME_DURATION_MS) { finish('120s Survived! CLEAR!'); return }

      // Sprite animation (toggle every 150ms)
      frameTimer.current += dt
      if (frameTimer.current > 150) {
        frameTimer.current = 0
        setPlayerFrame(f => (f + 1) % 4)
        setZombieFrame(f => (f + 1) % 4)
      }

      // Stage
      const ns = getStage(ms)
      if (ns !== stageRef.current) {
        stageRef.current = ns; setStage(ns)
        setStageMsg(STAGE_NAMES[ns])
        fxRef.current.triggerFlash('rgba(255,255,255,0.2)')
        fxRef.current.spawnParticles(8, VW / 2, GROUND_Y / 2, ['STAGE ' + (ns + 1)])
        play(sndPow.current, 0.5, 0.8)
        setTimeout(() => setStageMsg(null), 2200)
      }

      // Bg scroll
      setBgScroll(p => (p + dt * 0.015) % VW)
      setGroundScroll(p => (p + dt * 0.06) % 40)

      // Dash cooldown
      if (dashCooldown.current > 0) {
        dashCooldown.current -= dt
        if (dashCooldown.current <= 0) setDashReady(true)
      }

      // Growl
      if (ms - lastGrowl.current > 4500 + Math.random() * 3000) {
        lastGrowl.current = ms
        const gr = clamp((pPos.current - zPos.current) / BAR_MAX_GAP, 0, 1)
        if (gr < 0.6) play(sndGrowl.current, 0.2 + (1 - gr) * 0.4, 0.7 + Math.random() * 0.5)
      }

      // Timers
      if (speedRef.current) {
        speedMsRef.current = Math.max(0, speedMsRef.current - dt); setSpeedMs(speedMsRef.current)
        if (speedMsRef.current <= 0) { speedRef.current = false; setSpeedBoosted(false) }
      }
      if (invRef.current) {
        invMsRef.current = Math.max(0, invMsRef.current - dt); setInvMs(invMsRef.current)
        if (invMsRef.current <= 0) { invRef.current = false; setInvincible(false) }
      }
      if (feverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - dt); setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { feverRef.current = false; setFever(false) }
      }
      if (magnetRef.current) {
        magnetMsRef.current = Math.max(0, magnetMsRef.current - dt); setMagnetMs(magnetMsRef.current)
        if (magnetMsRef.current <= 0) { magnetRef.current = false; setMagnetActive(false) }
      }

      // Zombie
      const zSpd = Math.min(MAX_ZOMBIE_SPEED, INITIAL_ZOMBIE_SPEED + sec * ZOMBIE_ACCEL) * (stageRef.current >= 3 ? 1.2 : 1)
      zPos.current += zSpd * (dt / 1000)

      // Player drift
      tapSpeed.current *= TAP_DECAY
      pPos.current += tapSpeed.current * (dt / 1000)

      // Jump
      if (jumpAt.current !== null) {
        const je = ms - jumpAt.current
        if (je >= JUMP_MS) { jumpAt.current = null; setJumping(false); setJumpProg(0) }
        else setJumpProg(je / JUMP_MS)
      }

      const curGap = pPos.current - zPos.current
      setGap(curGap)
      setScore(calcScore(pPos.current - PLAYER_START_POS, ms, bonusRef.current))

      // ─── Spawn obstacles ───
      const stg = stageRef.current
      if (ms >= nextObs.current) {
        const types: ObsType[] = stg >= 2 ? ['crate', 'barrel', 'spike'] : ['crate', 'barrel']
        const t = types[Math.floor(Math.random() * types.length)]
        const w = t === 'spike' ? 32 : t === 'barrel' ? 36 : 38
        const h = t === 'spike' ? 28 : t === 'barrel' ? 36 : 34
        obsArr.current.push({ id: obsId.current++, x: VW + w, y: GROUND_Y - h, w, h, type: t })
        obsInterval.current = Math.max(OBS_MIN_MS, obsInterval.current * OBS_DECAY)
        nextObs.current = ms + obsInterval.current
      }

      // Coins
      if (ms >= nextCoin.current) {
        obsArr.current.push({ id: obsId.current++, x: VW + 20, y: GROUND_Y - 50 - Math.random() * 50, w: 24, h: 24, type: 'coin' })
        nextCoin.current = ms + COIN_INTERVAL_MS * (0.7 + Math.random() * 0.5)
      }

      // Power-ups
      if (ms >= nextPow.current) {
        const pt: ObsType = (() => {
          const r = Math.random()
          if (r < 0.3) return 'speed'
          if (r < 0.55) return 'invincible'
          if (r < 0.75) return 'magnet'
          return 'heart'
        })()
        obsArr.current.push({ id: obsId.current++, x: VW + 20, y: GROUND_Y - 65, w: 28, h: 28, type: pt })
        nextPow.current = ms + POWERUP_INTERVAL_MS * (0.7 + Math.random() * 0.5)
      }

      // Move & collide
      const spMul = 1 + stg * 0.08
      const pScreenX = VW * 0.6
      const inAir = jumpAt.current !== null

      const alive: Obs[] = []
      for (const o of obsArr.current) {
        o.x -= OBS_SPEED * spMul * (dt / 1000)

        // Magnet: attract coins
        if (magnetRef.current && o.type === 'coin') {
          const dx = pScreenX - o.x; const dy = (GROUND_Y - PLAYER_H / 2) - o.y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < MAGNET_RANGE && d > 1) {
            o.x += (dx / d) * 3; o.y += (dy / d) * 3
          }
        }

        if (o.x + o.w < -30) continue

        const oL = o.x; const oR = o.x + o.w
        const pL = pScreenX - PLAYER_W / 2 + 12; const pR = pScreenX + PLAYER_W / 2 - 12

        if (pR > oL && pL < oR) {
          if (o.type === 'coin') {
            const mul = feverRef.current ? 2 : 1
            bonusRef.current += COIN_SCORE * mul; setBonusScore(bonusRef.current)
            coinRef.current++; setCoins(coinRef.current)
            play(sndCoin.current, 0.5, 1.0 + Math.random() * 0.3)
            fxRef.current.spawnParticles(4, o.x + 12, o.y, ['+' + (COIN_SCORE * mul)])
            fxRef.current.showScorePopup(COIN_SCORE * mul, o.x, o.y - 20)
            continue
          }
          if (o.type === 'speed') {
            speedRef.current = true; speedMsRef.current = SPEED_DURATION_MS
            setSpeedBoosted(true); setSpeedMs(SPEED_DURATION_MS); pPos.current += SPEED_BOOST_VAL
            play(sndPow.current, 0.5); fxRef.current.triggerFlash('rgba(34,211,238,0.2)')
            fxRef.current.spawnParticles(5, o.x, o.y, ['SPEED!']); continue
          }
          if (o.type === 'invincible') {
            invRef.current = true; invMsRef.current = INVINCIBLE_MS
            setInvincible(true); setInvMs(INVINCIBLE_MS)
            play(sndPow.current, 0.5, 1.3); fxRef.current.triggerFlash('rgba(167,139,250,0.2)')
            fxRef.current.spawnParticles(5, o.x, o.y, ['SHIELD!']); continue
          }
          if (o.type === 'magnet') {
            magnetRef.current = true; magnetMsRef.current = MAGNET_MS
            setMagnetActive(true); setMagnetMs(MAGNET_MS)
            play(sndPow.current, 0.5, 0.9); fxRef.current.triggerFlash('rgba(251,191,36,0.2)')
            fxRef.current.spawnParticles(5, o.x, o.y, ['MAGNET!']); continue
          }
          if (o.type === 'heart') {
            if (hpRef.current < MAX_HP) {
              hpRef.current++; setHp(hpRef.current)
              play(sndPow.current, 0.5, 1.1); fxRef.current.spawnParticles(4, o.x, o.y, ['+HP'])
              fxRef.current.showScorePopup(0, o.x, o.y - 20)
            }
            continue
          }
          // Obstacle collision
          if (!inAir) {
            if (invRef.current) {
              play(sndHit.current, 0.3, 1.2); fxRef.current.spawnParticles(3, o.x, o.y, ['SMASH!'])
              bonusRef.current += 5; setBonusScore(bonusRef.current); continue
            }
            hpRef.current--; setHp(hpRef.current)
            pPos.current -= 25
            play(sndHit.current, 0.6); fxRef.current.triggerShake(10); fxRef.current.triggerFlash('rgba(239,68,68,0.4)')
            fxRef.current.spawnParticles(5, pScreenX, GROUND_Y - 40, ['OUCH!', '-HP'])
            if (hpRef.current <= 0) { finish('HP depleted!'); return }
            continue
          }
        }
        alive.push(o)
      }
      obsArr.current = alive; setObs([...alive])
      fxRef.current.updateParticles()

      if (curGap <= MIN_GAP_GAME_OVER) {
        fxRef.current.triggerShake(15); fxRef.current.triggerFlash('rgba(239,68,68,0.7)')
        finish('Caught by zombie!'); return
      }

      rafRef.current = requestAnimationFrame(step)
    }

    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }; lastT.current = null }
  }, [finish, play])

  // ── Derived ──
  const best = Math.max(bestScore, score)
  const timeLeft = Math.max(0, (GAME_DURATION_MS - elapsed) / 1000)
  const gapR = clamp(gap / BAR_MAX_GAP, 0, 1)
  const jumpOff = jumping ? Math.sin(jumpProg * Math.PI) * JUMP_H : 0
  const danger = gapR < 0.15 ? 'critical' : gapR < 0.35 ? 'danger' : gapR < 0.55 ? 'warn' : 'safe'
  const pScreenX = VW * 0.6

  return (
    <section className="mini-game-panel zr" aria-label="zombie-run-game" style={{ ...fx.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={fx.isFlashing} flashColor={fx.flashColor} />
      <ParticleRenderer particles={fx.particles} />
      <ScorePopupRenderer popups={fx.scorePopups} />

      {stageMsg && (
        <div className="zr-stage-pop">
          <span className="zr-stage-num">STAGE {stage + 1}</span>
          <span className="zr-stage-name">{stageMsg}</span>
        </div>
      )}

      <div className="zr-board">
        {/* ─── HUD ─── */}
        <div className="zr-hud">
          <div className="zr-hud-l">
            <span className="zr-score">{score}</span>
            <span className="zr-best">BEST {best}</span>
          </div>
          <div className="zr-hud-hp">
            {[...Array(MAX_HP)].map((_, i) => (
              <span key={i} className={`zr-heart ${i < hp ? 'on' : 'off'}`} />
            ))}
          </div>
          <div className="zr-hud-r">
            <span className={`zr-time ${timeLeft < 10 ? 'zr-blink' : ''}`}>{timeLeft.toFixed(1)}s</span>
            <span className="zr-stg">Stage {stage + 1}</span>
          </div>
        </div>

        {/* Badges */}
        <div className="zr-badges">
          {combo >= 5 && <span className="zr-b combo">COMBO x{combo}</span>}
          {coins > 0 && <span className="zr-b coin">x{coins}</span>}
          {speedBoosted && <span className="zr-b speed">SPEED {(speedMs / 1000).toFixed(1)}s</span>}
          {invincible && <span className="zr-b inv">SHIELD {(invMs / 1000).toFixed(1)}s</span>}
          {magnetActive && <span className="zr-b mag">MAGNET {(magnetMs / 1000).toFixed(1)}s</span>}
          {fever && <span className="zr-b fever">FEVER!! {(feverMs / 1000).toFixed(1)}s</span>}
          {!dashReady && <span className="zr-b dash">DASH...</span>}
        </div>

        {/* Gap bar */}
        <div className="zr-gap">
          <div className="zr-gap-track">
            <div className={`zr-gap-fill zr-gap-${danger}`} style={{ width: `${(gapR * 100).toFixed(1)}%` }} />
            <span className="zr-gap-txt">{Math.max(0, Math.floor(gap))}m</span>
          </div>
        </div>

        {/* ─── Game canvas (div-based pixel art) ─── */}
        <div className="zr-canvas" style={{ backgroundImage: `url(${bgCityImg})`, backgroundPositionX: `${-bgScroll}px` }}>
          {/* Ground tile */}
          <div className="zr-ground" style={{ backgroundPositionX: `${-groundScroll}px` }} />

          {/* Obstacles */}
          {obs.map(o => (
            <div key={o.id} className={`zr-obs zr-obs-${o.type}`} style={{ left: o.x, top: o.y, width: o.w, height: o.h }}>
              {o.type === 'coin' && <span className="zr-coin-inner" style={{ animationDelay: `${o.id * 100}ms` }} />}
              {o.type === 'speed' && <span className="zr-pow-inner zr-pow-speed">&gt;&gt;</span>}
              {o.type === 'invincible' && <span className="zr-pow-inner zr-pow-inv">*</span>}
              {o.type === 'magnet' && <span className="zr-pow-inner zr-pow-mag">M</span>}
              {o.type === 'heart' && <span className="zr-pow-inner zr-pow-heart">+</span>}
              {o.type === 'crate' && <span className="zr-crate-x" />}
              {o.type === 'barrel' && <span className="zr-barrel-ring" />}
              {o.type === 'spike' && <span className="zr-spike-inner" />}
            </div>
          ))}

          {/* Zombie (sprite sheet animation) */}
          <div className={`zr-zombie ${danger === 'critical' ? 'zr-zombie-rage' : ''}`}
            style={{ left: VW * 0.15, top: GROUND_Y - ZOMBIE_H }}>
            <div className="zr-sprite-zombie" style={{
              backgroundImage: `url(${zombieSpriteSheet})`,
              backgroundPosition: `${-(zombieFrame % 2) * 100}% ${-(Math.floor(zombieFrame / 2)) * 100}%`,
              backgroundSize: '200% 200%',
              width: ZOMBIE_W, height: ZOMBIE_H,
            }} />
          </div>

          {/* Player (sprite sheet animation) */}
          <div className={`zr-player ${tapFlash ? 'zr-player-flash' : ''} ${invincible ? 'zr-player-inv' : ''} ${fever ? 'zr-player-fever' : ''}`}
            style={{ left: pScreenX - PLAYER_W / 2, top: GROUND_Y - PLAYER_H - jumpOff }}>
            <div className="zr-sprite-player" style={{
              backgroundImage: `url(${playerSpriteSheet})`,
              backgroundPosition: `${-playerFrame * (100 / 3)}% 0%`,
              backgroundSize: '400% 100%',
              width: PLAYER_W, height: PLAYER_H,
            }} />
            {jumping && <span className="zr-jump-txt">JUMP!</span>}
            {invincible && <span className="zr-shield-ring" />}
            {speedBoosted && <>
              <span className="zr-trail" style={{ left: -8, top: 20, opacity: 0.6 }} />
              <span className="zr-trail" style={{ left: -18, top: 30, opacity: 0.35 }} />
              <span className="zr-trail" style={{ left: -28, top: 40, opacity: 0.15 }} />
            </>}
            {magnetActive && <span className="zr-magnet-ring" />}
          </div>

          {/* Jump shadow */}
          {jumping && (
            <div className="zr-shadow" style={{
              left: pScreenX - 20, top: GROUND_Y - 3,
              width: 40, height: 6,
              opacity: 0.3 - (jumpOff / JUMP_H) * 0.2,
              transform: `scaleX(${1 - (jumpOff / JUMP_H) * 0.3})`,
            }} />
          )}

          {/* Tap sparks */}
          {tapFlash && [...Array(4)].map((_, i) => {
            const a = (i * Math.PI / 2) + (elapsed / 60)
            return <div key={`sp${i}`} className="zr-spark" style={{
              left: pScreenX + Math.cos(a) * 20, top: GROUND_Y - PLAYER_H / 2 - jumpOff + Math.sin(a) * 15,
            }} />
          })}

          {/* Danger overlay */}
          {danger === 'critical' && <div className="zr-danger-overlay" />}
        </div>

        {/* ─── Controls ─── */}
        <div className="zr-controls">
          <button className={`zr-btn-tap ${tapFlash ? 'zr-tap-on' : ''} ${fever ? 'zr-tap-fever' : ''}`}
            type="button" onPointerDown={e => { e.preventDefault(); handleTap() }}>
            <span className="zr-btn-label">TAP!</span>
            <span className="zr-btn-sub">Tap to Run</span>
          </button>
          <button className="zr-btn-jump" type="button" disabled={jumping}
            onPointerDown={e => { e.preventDefault(); handleJump() }}>
            <span className="zr-btn-label">JUMP</span>
          </button>
        </div>

        <p className="zr-status">{status}</p>

        <div className="zr-actions">
          <button className="zr-act" type="button" onClick={() => finish('Game ended!')}>End</button>
          <button className="zr-act ghost" type="button" onClick={onExit}>Exit</button>
        </div>
      </div>

      <style>{ZR_CSS}</style>
    </section>
  )
}

// ═══════════════════════════════════════════════════
// CSS — Full pixel art retro style
// ═══════════════════════════════════════════════════
const ZR_CSS = `
.zr {
  display: flex; flex-direction: column;
  width: 100%; height: 100%; max-width: 432px; margin: 0 auto;
  background: #0c0c1d; color: #e2e8f0; overflow: hidden;
  position: relative; user-select: none; -webkit-user-select: none;
  touch-action: manipulation; image-rendering: pixelated;
}
.zr-board {
  display: flex; flex-direction: column;
  width: 100%; height: 100%; position: relative;
}

/* ─── HUD ─── */
.zr-hud {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 16px 8px; flex-shrink: 0;
  background: linear-gradient(180deg, rgba(15,80,40,0.45) 0%, transparent 100%);
  border-bottom: 2px solid rgba(15,80,40,0.4);
}
.zr-hud-l, .zr-hud-r { display: flex; flex-direction: column; }
.zr-hud-r { align-items: flex-end; }
.zr-hud-hp { display: flex; gap: 6px; }
.zr-heart {
  display: inline-block; width: 24px; height: 24px;
  background: #ef4444; clip-path: path('M12 4C9 0 0 0 0 7.3C0 14.7 12 21.3 12 21.3S24 14.7 24 7.3C24 0 15 0 12 4Z');
  transition: opacity 0.3s;
  filter: drop-shadow(0 1px 3px rgba(239,68,68,0.5));
}
.zr-heart.off { background: #374151; opacity: 0.4; filter: none; }
.zr-score {
  font-size: clamp(32px, 8vw, 48px); font-weight: 900;
  color: #fde68a; text-shadow: 0 2px 12px rgba(253,230,138,0.5), 0 0 20px rgba(253,230,138,0.3);
  font-family: monospace; line-height: 1;
}
.zr-best { font-size: 12px; color: #6ee7b7; opacity: 0.8; font-family: monospace; }
.zr-time {
  font-size: clamp(28px, 7vw, 40px); font-weight: 800;
  color: #93c5fd; font-family: monospace; line-height: 1;
  text-shadow: 0 2px 8px rgba(147,197,253,0.4);
}
.zr-stg { font-size: 11px; color: #9ca3af; letter-spacing: 1px; font-family: monospace; }

/* ─── Badges ─── */
.zr-badges { display: flex; gap: 6px; flex-wrap: wrap; padding: 4px 16px; flex-shrink: 0; }
.zr-b {
  font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 4px;
  font-family: monospace; letter-spacing: 0.5px;
}
.zr-b.combo { background: rgba(251,191,36,0.25); color: #fbbf24; }
.zr-b.coin { background: rgba(245,158,11,0.25); color: #f59e0b; }
.zr-b.speed { background: rgba(34,211,238,0.25); color: #22d3ee; animation: zr-blink 0.7s infinite; }
.zr-b.inv { background: rgba(167,139,250,0.25); color: #a78bfa; animation: zr-blink 0.7s infinite; }
.zr-b.mag { background: rgba(251,191,36,0.25); color: #fbbf24; animation: zr-blink 0.7s infinite; }
.zr-b.fever { background: rgba(239,68,68,0.35); color: #fca5a5; animation: zr-blink 0.25s infinite; }
.zr-b.dash { background: rgba(107,114,128,0.3); color: #9ca3af; }

/* ─── Gap Bar ─── */
.zr-gap { padding: 4px 16px; flex-shrink: 0; }
.zr-gap-track {
  width: 100%; height: 16px; background: #1f2937; border-radius: 8px;
  border: 2px solid #374151; position: relative; overflow: hidden;
}
.zr-gap-fill { height: 100%; border-radius: 6px; transition: width 0.1s ease-out; }
.zr-gap-txt {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  font-size: 10px; color: #fff; font-weight: 800; font-family: monospace;
  text-shadow: 0 1px 2px rgba(0,0,0,0.8);
}
.zr-gap-safe { background: linear-gradient(90deg, #059669, #34d399); }
.zr-gap-warn { background: linear-gradient(90deg, #d97706, #fbbf24); }
.zr-gap-danger { background: linear-gradient(90deg, #dc2626, #f87171); }
.zr-gap-critical { background: linear-gradient(90deg, #991b1b, #ef4444); animation: zr-pulse 0.25s infinite; }

/* ─── Game Canvas ─── */
.zr-canvas {
  flex: 1; min-height: 0; position: relative; overflow: hidden;
  background-size: auto 100%; background-repeat: repeat-x;
  image-rendering: pixelated;
}
.zr-ground {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: ${VH - GROUND_Y}px;
  background: repeating-linear-gradient(90deg, #2d3436 0px, #2d3436 18px, #374151 18px, #374151 20px);
  border-top: 3px solid #4b5563;
}

/* ─── Obstacles ─── */
.zr-obs { position: absolute; image-rendering: pixelated; }
.zr-obs-crate {
  background: #92400e; border: 2px solid #78350f; border-radius: 3px;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,0.1);
}
.zr-crate-x::before, .zr-crate-x::after {
  content: ''; position: absolute; background: #78350f;
  width: 70%; height: 2px; top: 50%; left: 15%;
}
.zr-crate-x::before { transform: rotate(45deg); }
.zr-crate-x::after { transform: rotate(-45deg); }

.zr-obs-barrel {
  background: radial-gradient(circle, #b45309 60%, #92400e 100%);
  border: 2px solid #78350f; border-radius: 50%;
}
.zr-barrel-ring {
  position: absolute; top: 40%; left: 10%; right: 10%; height: 3px;
  background: #78350f; border-radius: 2px;
}

.zr-obs-spike {
  background: transparent;
}
.zr-spike-inner {
  display: block; width: 100%; height: 100%;
  clip-path: polygon(0 100%, 50% 0, 100% 100%);
  background: linear-gradient(180deg, #dc2626, #991b1b);
}

.zr-obs-coin {
  background: transparent;
}
.zr-coin-inner {
  display: block; width: 100%; height: 100%; border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #fde68a, #f59e0b);
  border: 2px solid #d97706;
  box-shadow: 0 0 8px rgba(251,191,36,0.5);
  animation: zr-coin-spin 0.6s infinite linear;
}

.zr-obs-speed, .zr-obs-invincible, .zr-obs-magnet, .zr-obs-heart {
  background: transparent;
}
.zr-pow-inner {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; border-radius: 50%;
  font-weight: 900; font-size: 14px; font-family: monospace;
  animation: zr-pow-bob 0.8s infinite ease-in-out;
}
.zr-pow-speed { background: #0e7490; color: #cffafe; border: 2px solid #22d3ee; box-shadow: 0 0 10px rgba(34,211,238,0.4); }
.zr-pow-inv { background: #6d28d9; color: #ede9fe; border: 2px solid #a78bfa; box-shadow: 0 0 10px rgba(167,139,250,0.4); }
.zr-pow-mag { background: #92400e; color: #fde68a; border: 2px solid #fbbf24; box-shadow: 0 0 10px rgba(251,191,36,0.4); }
.zr-pow-heart { background: #9f1239; color: #fda4af; border: 2px solid #f43f5e; box-shadow: 0 0 10px rgba(244,63,94,0.4); font-size: 18px; }

/* ─── Zombie ─── */
.zr-zombie {
  position: absolute; image-rendering: pixelated;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5));
  transition: filter 0.3s;
}
.zr-zombie-rage { filter: drop-shadow(0 0 12px rgba(239,68,68,0.6)); animation: zr-zombie-shake 0.1s infinite; }
.zr-sprite-zombie { image-rendering: pixelated; }

/* ─── Player ─── */
.zr-player {
  position: absolute; image-rendering: pixelated;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));
  transition: filter 0.15s;
}
.zr-player-flash { filter: brightness(2) drop-shadow(0 0 8px rgba(255,255,255,0.6)) !important; }
.zr-player-inv { filter: drop-shadow(0 0 12px rgba(167,139,250,0.8)) !important; }
.zr-player-fever { filter: drop-shadow(0 0 10px rgba(239,68,68,0.6)) !important; }
.zr-sprite-player { image-rendering: pixelated; }

.zr-jump-txt {
  position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  font-size: 11px; font-weight: 900; color: #fde68a; font-family: monospace;
  text-shadow: 0 1px 4px rgba(0,0,0,0.6);
}

.zr-shield-ring {
  position: absolute; inset: -8px; border-radius: 50%;
  border: 2.5px dashed #a78bfa;
  animation: zr-shield-spin 1s linear infinite;
  opacity: 0.6;
}

.zr-magnet-ring {
  position: absolute; inset: -12px; border-radius: 50%;
  border: 2px dotted #fbbf24;
  animation: zr-shield-spin 2s linear infinite reverse;
  opacity: 0.4;
}

.zr-trail {
  position: absolute; width: 10px; height: 4px; border-radius: 2px;
  background: #22d3ee;
}

.zr-shadow {
  position: absolute; border-radius: 50%;
  background: rgba(0,0,0,0.3);
}

.zr-spark {
  position: absolute; width: 4px; height: 4px; border-radius: 50%;
  background: #fde68a; box-shadow: 0 0 4px #fde68a;
  pointer-events: none;
}

.zr-danger-overlay {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(220,38,38,0.15) 100%);
  animation: zr-blink 0.4s infinite;
}

/* ─── Controls ─── */
.zr-controls { display: flex; gap: 10px; padding: 6px 12px; flex-shrink: 0; }
.zr-btn-tap {
  flex: 3; height: clamp(60px, 9vh, 84px);
  border: 3px solid #15803d; border-radius: 10px;
  background: linear-gradient(180deg, #166534, #14532d);
  color: #fff; cursor: pointer; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px;
  box-shadow: 0 4px 0 #052e16, 0 6px 12px rgba(0,0,0,0.5);
  transition: transform 0.04s;
  font-family: monospace;
}
.zr-btn-tap:active, .zr-tap-on {
  transform: translateY(3px);
  box-shadow: 0 1px 0 #052e16;
  background: linear-gradient(180deg, #22c55e, #166534);
}
.zr-tap-fever {
  border-color: #dc2626 !important;
  background: linear-gradient(180deg, #991b1b, #7f1d1d) !important;
  box-shadow: 0 4px 0 #450a0a, 0 0 20px rgba(239,68,68,0.3) !important;
  animation: zr-pulse 0.3s infinite;
}
.zr-btn-label { font-size: clamp(16px, 3.5vw, 22px); font-weight: 900; letter-spacing: 3px; }
.zr-btn-sub { font-size: 7px; opacity: 0.5; }
.zr-btn-jump {
  flex: 1; height: clamp(60px, 9vh, 84px);
  border: 3px solid #1d4ed8; border-radius: 10px;
  background: linear-gradient(180deg, #2563eb, #1e40af);
  color: #fff; cursor: pointer; display: flex;
  align-items: center; justify-content: center;
  box-shadow: 0 4px 0 #1e3a5f, 0 6px 12px rgba(0,0,0,0.5);
  transition: transform 0.04s; font-family: monospace;
}
.zr-btn-jump:active { transform: translateY(3px); box-shadow: 0 1px 0 #1e3a5f; }
.zr-btn-jump:disabled { opacity: 0.35; cursor: not-allowed; }

.zr-status {
  font-size: 8px; color: #6b7280; text-align: center;
  padding: 2px 0 4px; flex-shrink: 0; font-family: monospace;
}

/* ─── Actions ─── */
.zr-actions {
  position: absolute; top: 8px; right: 8px;
  display: flex; gap: 5px; z-index: 10;
}
.zr-act {
  padding: 5px 14px; border: none; border-radius: 6px;
  background: linear-gradient(180deg, #374151, #1f2937);
  color: #d1d5db; font-size: 10px; font-weight: 700; cursor: pointer;
  box-shadow: 0 2px 0 #111827; font-family: monospace;
}
.zr-act:active { transform: translateY(2px); box-shadow: none; }
.zr-act.ghost { background: transparent; border: 1px solid #4b5563; color: #9ca3af; box-shadow: none; }

/* ─── Stage popup ─── */
.zr-stage-pop {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  z-index: 20; pointer-events: none;
  animation: zr-stage-in 2.2s ease-out forwards;
}
.zr-stage-num {
  font-size: clamp(26px, 7vw, 40px); font-weight: 900; color: #fde68a;
  text-shadow: 0 2px 12px rgba(253,230,138,0.5), 0 0 40px rgba(253,230,138,0.3);
  font-family: monospace; letter-spacing: 4px;
}
.zr-stage-name {
  font-size: clamp(11px, 3vw, 15px); color: #6ee7b7; font-weight: 700;
  font-family: monospace; letter-spacing: 2px;
}

/* ─── Animations ─── */
@keyframes zr-blink { 0%,100%{opacity:1} 50%{opacity:0.25} }
@keyframes zr-pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
@keyframes zr-coin-spin { 0%{transform:scaleX(1)} 50%{transform:scaleX(0.3)} 100%{transform:scaleX(1)} }
@keyframes zr-pow-bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
@keyframes zr-shield-spin { to{transform:rotate(360deg)} }
@keyframes zr-zombie-shake {
  0%,100%{transform:translateX(0)} 25%{transform:translateX(-2px)} 75%{transform:translateX(2px)}
}
@keyframes zr-stage-in {
  0%{opacity:0;transform:translate(-50%,-50%) scale(0.4)}
  15%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}
  85%{opacity:1;transform:translate(-50%,-50%) scale(1)}
  100%{opacity:0;transform:translate(-50%,-50%) scale(1.3)}
}
`

export const zombieRunModule: MiniGameModule = {
  manifest: {
    id: 'zombie-run',
    title: 'Zombie Run',
    description: 'Zombies are coming! Tap like crazy to escape!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#15803d',
  },
  Component: ZombieRunGame,
}
