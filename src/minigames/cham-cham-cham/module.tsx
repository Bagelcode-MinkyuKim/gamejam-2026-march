import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS } from '../../primitives/constants'

import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikSprite from '../../../assets/images/same-character/song-changsik.png'
import taeJinaSprite from '../../../assets/images/same-character/tae-jina.png'

import playerHandSheet from '../../../assets/images/cham-cham-cham/player-hand-sheet.png'
import hitEffectImg from '../../../assets/images/cham-cham-cham/hit-effect.png'
import dodgeEffectImg from '../../../assets/images/cham-cham-cham/dodge-effect.png'

import hitSfx from '../../../assets/sounds/cham-cham-cham/hit.mp3'
import missSfx from '../../../assets/sounds/cham-cham-cham/miss.mp3'
import damageSfx from '../../../assets/sounds/cham-cham-cham/damage.mp3'
import dodgeSfx from '../../../assets/sounds/cham-cham-cham/dodge.mp3'
import chamVoiceSfx from '../../../assets/sounds/cham-cham-cham/cham-cham-cham-voice.mp3'
import roleSwitchSfx from '../../../assets/sounds/cham-cham-cham/role-switch.mp3'
import comboSfx from '../../../assets/sounds/cham-cham-cham/combo.mp3'
import gameoverSfx from '../../../assets/sounds/cham-cham-cham/gameover.mp3'
import timerWarnSfx from '../../../assets/sounds/cham-cham-cham/timer-warn.mp3'

type Direction = 'left' | 'center' | 'right'
type TurnRole = 'attack' | 'defense'
type GamePhase =
  | 'attack-choose'
  | 'attack-resolve'
  | 'defense-incoming'
  | 'defense-choose'
  | 'defense-resolve'
  | 'role-switch'
  | 'game-over'

const HAND_FRAME: Record<Direction, number> = { left: 0, center: 1, right: 2 }
const HAND_COLS = 3
const ALL_DIRECTIONS: Direction[] = ['left', 'center', 'right']
const DIR_ARROW: Record<Direction, string> = { left: '<<<', center: '^^^', right: '>>>' }

const MAX_HP = 3
const DEFENSE_TIME_LIMIT_MS = 1200
const RESOLVE_DISPLAY_MS = 800
const ROLE_SWITCH_MS = 600
const CHANT_STEP_MS = 150

const OPPONENT_CHARS = [
  { src: kimYeonjaSprite, name: 'Kim Yeonja' },
  { src: parkSangminSprite, name: 'Park Sangmin' },
  { src: parkWankyuSprite, name: 'Park Wankyu' },
  { src: seoTaijiSprite, name: 'Seo Taiji' },
  { src: songChangsikSprite, name: 'Song Changsik' },
  { src: taeJinaSprite, name: 'Tae Jina' },
] as const

type AudioKey = 'hit' | 'miss' | 'damage' | 'dodge' | 'voice' | 'roleSwitch' | 'combo' | 'gameover' | 'timerWarn'

function randomDirection(): Direction {
  return ALL_DIRECTIONS[Math.floor(Math.random() * ALL_DIRECTIONS.length)]
}
function randomChar() {
  return OPPONENT_CHARS[Math.floor(Math.random() * OPPONENT_CHARS.length)]
}

function ChamChamChamGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [phase, setPhase] = useState<GamePhase>('attack-choose')
  const [role, setRole] = useState<TurnRole>('attack')
  const [hp, setHp] = useState(MAX_HP)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [, setTotalTurns] = useState(0)
  const [playerChoice, setPlayerChoice] = useState<Direction | null>(null)
  const [opponentChoice, setOpponentChoice] = useState<Direction | null>(null)
  const [resolveResult, setResolveResult] = useState<'hit' | 'miss' | 'dodged' | 'damaged' | null>(null)
  const [roleText, setRoleText] = useState<string | null>(null)
  const [defenseTimerMs, setDefenseTimerMs] = useState(DEFENSE_TIME_LIMIT_MS)
  const [shakeActive, setShakeActive] = useState(false)
  const [flashResult, setFlashResult] = useState<'success' | 'fail' | null>(null)
  const [showEffect, setShowEffect] = useState<'hit' | 'dodge' | null>(null)
  const [opponent, setOpponent] = useState(() => randomChar())
  const [charAnim, setCharAnim] = useState<'idle' | 'chant' | 'hit' | 'dodge'>('idle')
  const [scorePop, setScorePop] = useState<number | null>(null)
  const [sparkBurst, setSparkBurst] = useState(false)
  const [hpLossFlash, setHpLossFlash] = useState(false)
  const [comboFlash, setComboFlash] = useState(false)
  const [roleSwoosh, setRoleSwoosh] = useState(false)
  const [gameoverParticles, setGameoverParticles] = useState(false)
  const timerWarnPlayedRef = useRef(false)

  const finishedRef = useRef(false)
  const startedAtRef = useRef(window.performance.now())
  const scoreRef = useRef(0)
  const comboRef = useRef(0)
  const bestComboRef = useRef(0)
  const hpRef = useRef(MAX_HP)
  const phaseTimerRef = useRef<number | null>(null)
  const defenseTimerIntervalRef = useRef<number | null>(null)
  const defenseDeadlineRef = useRef<number | null>(null)
  const chantTimerRef = useRef<number | null>(null)
  const sfxRefs = useRef<Record<AudioKey, HTMLAudioElement | null>>({
    hit: null, miss: null, damage: null, dodge: null, voice: null, roleSwitch: null, combo: null, gameover: null, timerWarn: null,
  })

  const playSfx = useCallback((key: AudioKey, vol = 0.9, rate = 1) => {
    const a = sfxRefs.current[key]
    if (!a) return
    const c = a.cloneNode(true) as HTMLAudioElement
    c.volume = Math.min(1, Math.max(0, vol))
    c.playbackRate = rate
    void c.play().catch(() => {})
  }, [])

  const clearPhaseTimer = useCallback(() => { if (phaseTimerRef.current !== null) { window.clearTimeout(phaseTimerRef.current); phaseTimerRef.current = null } }, [])
  const clearDefenseTimer = useCallback(() => { if (defenseTimerIntervalRef.current !== null) { window.clearInterval(defenseTimerIntervalRef.current); defenseTimerIntervalRef.current = null }; defenseDeadlineRef.current = null }, [])
  const clearChantTimer = useCallback(() => { if (chantTimerRef.current !== null) { window.clearTimeout(chantTimerRef.current); chantTimerRef.current = null } }, [])

  const triggerEffect = useCallback((t: 'hit' | 'dodge') => { setShowEffect(t); window.setTimeout(() => setShowEffect(null), 700) }, [])
  const triggerShake = useCallback(() => { setShakeActive(true); window.setTimeout(() => setShakeActive(false), 400) }, [])
  const triggerFlash = useCallback((r: 'success' | 'fail') => { setFlashResult(r); window.setTimeout(() => setFlashResult(null), 500) }, [])
  const triggerScorePop = useCallback((pts: number) => { setScorePop(pts); window.setTimeout(() => setScorePop(null), 600) }, [])
  const triggerSparkBurst = useCallback(() => { setSparkBurst(true); window.setTimeout(() => setSparkBurst(false), 500) }, [])
  const triggerHpLoss = useCallback(() => { setHpLossFlash(true); window.setTimeout(() => setHpLossFlash(false), 600) }, [])
  const triggerComboFlash = useCallback(() => { setComboFlash(true); window.setTimeout(() => setComboFlash(false), 400) }, [])
  const triggerRoleSwoosh = useCallback(() => { setRoleSwoosh(true); window.setTimeout(() => setRoleSwoosh(false), 500) }, [])
  const triggerGameoverParticles = useCallback(() => { setGameoverParticles(true); window.setTimeout(() => setGameoverParticles(false), 800) }, [])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearPhaseTimer(); clearDefenseTimer(); clearChantTimer()
    setCharAnim('hit')
    playSfx('gameover', 0.9)
    triggerGameoverParticles(); triggerShake()
    const elapsed = Math.max(Math.round(DEFAULT_FRAME_MS), Math.round(window.performance.now() - startedAtRef.current))
    window.setTimeout(() => {
      onFinish({ score: scoreRef.current + bestComboRef.current * 3, durationMs: elapsed })
    }, 600)
  }, [clearChantTimer, clearDefenseTimer, clearPhaseTimer, onFinish, playSfx, triggerGameoverParticles, triggerShake])

  useEffect(() => {
    const mk = (s: string) => { const a = new Audio(s); a.preload = 'auto'; return a }
    sfxRefs.current = { hit: mk(hitSfx), miss: mk(missSfx), damage: mk(damageSfx), dodge: mk(dodgeSfx), voice: mk(chamVoiceSfx), roleSwitch: mk(roleSwitchSfx), combo: mk(comboSfx), gameover: mk(gameoverSfx), timerWarn: mk(timerWarnSfx) }
    return () => { clearPhaseTimer(); clearDefenseTimer(); clearChantTimer(); Object.values(sfxRefs.current).forEach((a) => { if (a) { a.pause(); a.currentTime = 0 } }) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleExit = useCallback(() => { playSfx('miss', 0.7); onExit() }, [onExit, playSfx])
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') handleExit() }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [handleExit])

  const playChant = useCallback((done: () => void) => {
    clearChantTimer()
    playSfx('voice', 0.88)
    const anims: Array<'idle' | 'chant'> = ['idle', 'chant', 'idle', 'chant', 'idle']
    let i = 0
    setCharAnim(anims[0])
    const tick = () => {
      i += 1
      if (i >= anims.length) { done(); return }
      setCharAnim(anims[i])
      chantTimerRef.current = window.setTimeout(tick, CHANT_STEP_MS)
    }
    chantTimerRef.current = window.setTimeout(tick, CHANT_STEP_MS)
  }, [clearChantTimer, playSfx])

  const startAttackTurn = useCallback(() => {
    setRole('attack'); setPhase('attack-choose')
    setPlayerChoice(null); setOpponentChoice(null); setResolveResult(null)
    setOpponent(randomChar()); setCharAnim('idle')
  }, [])

  const startDefenseTurn = useCallback(() => {
    setRole('defense'); setPlayerChoice(null); setOpponentChoice(null); setResolveResult(null)
    setOpponent(randomChar()); setCharAnim('idle')
    timerWarnPlayedRef.current = false
    const aiDir = randomDirection()
    setOpponentChoice(aiDir)
    setPhase('defense-incoming')
    playChant(() => {
      setPhase('defense-choose')
      setDefenseTimerMs(DEFENSE_TIME_LIMIT_MS)
      defenseDeadlineRef.current = window.performance.now() + DEFENSE_TIME_LIMIT_MS
      defenseTimerIntervalRef.current = window.setInterval(() => {
        if (defenseDeadlineRef.current === null) return
        const rem = Math.max(0, defenseDeadlineRef.current - window.performance.now())
        setDefenseTimerMs(rem)
        if (rem < DEFENSE_TIME_LIMIT_MS * 0.3 && !timerWarnPlayedRef.current) {
          timerWarnPlayedRef.current = true; playSfx('timerWarn', 0.5, 1.2)
        }
        if (rem <= 0) { clearDefenseTimer(); resolveDefense(aiDir, aiDir) }
      }, 50)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearDefenseTimer, playChant])

  const resolveDefense = useCallback((pDir: Direction, aiDir: Direction) => {
    clearDefenseTimer(); clearPhaseTimer(); clearChantTimer()
    setPlayerChoice(pDir); setTotalTurns((t) => t + 1)
    if (pDir === aiDir) {
      hpRef.current -= 1; setHp(hpRef.current); comboRef.current = 0; setCombo(0)
      setResolveResult('damaged'); setCharAnim('chant')
      triggerShake(); triggerFlash('fail'); triggerEffect('hit'); triggerHpLoss(); playSfx('damage', 0.8, 0.95)
      if (hpRef.current <= 0) { setPhase('game-over'); phaseTimerRef.current = window.setTimeout(finishGame, RESOLVE_DISPLAY_MS); return }
      setPhase('defense-resolve')
      phaseTimerRef.current = window.setTimeout(() => { phaseTimerRef.current = null; startDefenseTurn() }, RESOLVE_DISPLAY_MS)
    } else {
      setResolveResult('dodged'); setCharAnim('hit')
      triggerFlash('success'); triggerEffect('dodge'); playSfx('dodge', 0.7, 1.06)
      setPhase('defense-resolve')
      phaseTimerRef.current = window.setTimeout(() => {
        phaseTimerRef.current = null; setRoleText('ATTACK!'); setPhase('role-switch'); playSfx('roleSwitch', 0.85); triggerRoleSwoosh()
        phaseTimerRef.current = window.setTimeout(() => { phaseTimerRef.current = null; setRoleText(null); startAttackTurn() }, ROLE_SWITCH_MS)
      }, RESOLVE_DISPLAY_MS)
    }
  }, [clearChantTimer, clearDefenseTimer, clearPhaseTimer, finishGame, playSfx, startAttackTurn, startDefenseTurn, triggerEffect, triggerFlash, triggerHpLoss, triggerRoleSwoosh, triggerShake])

  const handleAttack = useCallback((dir: Direction) => {
    if (phase !== 'attack-choose' || finishedRef.current) return
    setPhase('attack-resolve')
    playChant(() => {
      const aiDir = randomDirection()
      setPlayerChoice(dir); setOpponentChoice(aiDir); setTotalTurns((t) => t + 1)
      if (dir === aiDir) {
        comboRef.current += 1; bestComboRef.current = Math.max(bestComboRef.current, comboRef.current)
        setCombo(comboRef.current); scoreRef.current += comboRef.current; setScore(scoreRef.current)
        setResolveResult('hit'); setCharAnim('hit')
        triggerFlash('success'); triggerEffect('hit'); triggerSparkBurst(); triggerScorePop(comboRef.current); triggerComboFlash()
        playSfx('hit', 0.7, 1 + Math.min(0.2, comboRef.current * 0.025))
        if (comboRef.current >= 3) playSfx('combo', 0.6, 1 + Math.min(0.3, comboRef.current * 0.03))
      } else {
        comboRef.current = 0; setCombo(0); setResolveResult('miss'); setCharAnim('dodge')
        triggerFlash('fail'); playSfx('miss', 0.6, 0.92)
      }
      clearPhaseTimer()
      if (dir === aiDir) {
        phaseTimerRef.current = window.setTimeout(() => { phaseTimerRef.current = null; startAttackTurn() }, RESOLVE_DISPLAY_MS)
      } else {
        phaseTimerRef.current = window.setTimeout(() => {
          phaseTimerRef.current = null; setRoleText('DEFENSE!'); setPhase('role-switch'); playSfx('roleSwitch', 0.85); triggerRoleSwoosh()
          phaseTimerRef.current = window.setTimeout(() => { phaseTimerRef.current = null; setRoleText(null); startDefenseTurn() }, ROLE_SWITCH_MS)
        }, RESOLVE_DISPLAY_MS)
      }
    })
  }, [clearPhaseTimer, phase, playChant, playSfx, startAttackTurn, startDefenseTurn, triggerComboFlash, triggerEffect, triggerFlash, triggerRoleSwoosh, triggerScorePop, triggerSparkBurst])

  const handleDefense = useCallback((dir: Direction) => {
    if (phase !== 'defense-choose' || finishedRef.current || opponentChoice === null) return
    resolveDefense(dir, opponentChoice)
  }, [opponentChoice, phase, resolveDefense])

  const clickDir = useCallback((d: Direction) => {
    if (phase === 'attack-choose') handleAttack(d)
    else if (phase === 'defense-choose') handleDefense(d)
  }, [handleAttack, handleDefense, phase])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); clickDir('left') }
      else if (e.key === 'ArrowUp') { e.preventDefault(); clickDir('center') }
      else if (e.key === 'ArrowRight') { e.preventDefault(); clickDir('right') }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [clickDir])

  const choosing = phase === 'attack-choose' || phase === 'defense-choose'
  const bestDisp = Math.max(bestScore, score)
  const hpArr = Array.from({ length: MAX_HP }, (_, i) => i < hp)
  const defPct = (defenseTimerMs / DEFENSE_TIME_LIMIT_MS) * 100
  const resolved = resolveResult !== null
  const showHand = (phase === 'attack-resolve' || phase === 'defense-resolve') && playerChoice !== null && resolved
  const showOpDir = (phase === 'defense-choose' || phase === 'defense-resolve') && opponentChoice !== null

  const msg = resolved ? (resolveResult === 'hit' ? `+${combo}!` : resolveResult === 'miss' ? 'MISS!' : resolveResult === 'dodged' ? 'DODGE!' : 'HIT!') : null
  const guide = phase === 'attack-choose' ? 'Cham! Cham! Cham!' : (phase === 'attack-resolve' && !resolved) ? 'Cham-cham-cham...' : phase === 'defense-incoming' ? "Opponent's cham..." : phase === 'defense-choose' ? 'Dodge!' : phase === 'role-switch' ? (roleText ?? '') : phase === 'game-over' ? 'GAME OVER' : ''

  const handStyle: CSSProperties | null = playerChoice ? {
    backgroundImage: `url(${playerHandSheet})`,
    backgroundSize: `${HAND_COLS * 100}% 100%`,
    backgroundPosition: `${(-HAND_FRAME[playerChoice] * 100) / (HAND_COLS - 1)}% 0`,
  } : null

  return (
    <section className={`mini-game-panel cham-panel ${shakeActive ? 'shake' : ''}`} aria-label="cham-cham-cham-game">
      {flashResult !== null ? <div className={`cham-flash-overlay cham-flash-${flashResult}`} aria-hidden /> : null}
      {showEffect !== null ? (
        <div className="cham-effect-overlay" aria-hidden>
          <img className={`cham-effect-img cham-effect-${showEffect}`} src={showEffect === 'hit' ? hitEffectImg : dodgeEffectImg} alt="" />
        </div>
      ) : null}
      {sparkBurst ? (
        <div className="cham-spark-burst" aria-hidden>
          <span /><span /><span /><span /><span /><span /><span /><span />
        </div>
      ) : null}
      {scorePop !== null ? <p className="cham-score-pop" aria-hidden>+{scorePop}</p> : null}
      {hpLossFlash ? <div className="cham-hp-loss-vignette" aria-hidden /> : null}
      {comboFlash ? <div className="cham-combo-flash" aria-hidden /> : null}
      {roleSwoosh ? <div className="cham-role-swoosh" aria-hidden /> : null}
      {gameoverParticles ? (
        <div className="cham-gameover-particles" aria-hidden>
          <span /><span /><span /><span /><span /><span />
        </div>
      ) : null}

      <div className="cham-hud">
        <div className="cham-hp-bar">
          {hpArr.map((alive, i) => <span key={`hp-${i}`} className={`cham-hp-dot ${alive ? 'alive' : 'dead'}`} />)}
        </div>
        <div className="cham-score-group">
          <p className="cham-score">{score}</p>
          <p className="cham-best">BEST {bestDisp}</p>
        </div>
        <div className="cham-turn-badge">
          <span className={`cham-role-tag ${role}`}>{role === 'attack' ? 'ATTACK' : 'DEFENSE'}</span>
          {combo > 1 ? <span className="cham-combo-tag">x{combo} COMBO</span> : null}
        </div>
      </div>

      {phase === 'defense-choose' ? (
        <div className={`cham-defense-timer ${defPct < 30 ? 'urgent' : ''}`}>
          <div className="cham-defense-timer-fill" style={{ width: `${defPct}%` }} />
          <span className="cham-defense-timer-label">{(defenseTimerMs / 1000).toFixed(1)}s</span>
        </div>
      ) : null}

      <div className="cham-arena">
        <div className="cham-center-stage">
          <img className={`cham-char-img cham-anim-${charAnim}`} src={opponent.src} alt={opponent.name} />
          {showOpDir && opponentChoice ? (
            <p className="cham-opponent-dir-indicator">{DIR_ARROW[opponentChoice]}</p>
          ) : null}
        </div>

        <div className="cham-guide-area">
          <p className={`cham-guide-text ${phase === 'game-over' ? 'game-over' : ''} ${phase === 'role-switch' ? 'role-switch' : ''} ${phase === 'defense-choose' ? 'defense-alert' : ''}`}>
            {guide}
          </p>
          {msg !== null && (phase === 'attack-resolve' || phase === 'defense-resolve' || phase === 'game-over') ? (
            <p className={`cham-resolve-text ${resolveResult}`}>{msg}</p>
          ) : null}
        </div>

        {showHand && handStyle ? <div className="cham-player-hand" style={handStyle} /> : null}
      </div>

      <div className="cham-controls">
        {ALL_DIRECTIONS.map((d) => (
          <button key={d} className={`cham-dir-button ${!choosing ? 'disabled' : ''}`} type="button" disabled={!choosing} onClick={() => clickDir(d)}>
            <span className="cham-dir-arrow">{DIR_ARROW[d]}</span>
          </button>
        ))}
      </div>

    </section>
  )
}

export const chamChamChamModule: MiniGameModule = {
  manifest: {
    id: 'cham-cham-cham',
    title: 'Cham-Cham-Cham',
    description: 'Take turns: attack to match, defend to dodge. 0 HP = Game Over!',
    unlockCost: 80,
    baseReward: 16,
    scoreRewardMultiplier: 1.5,
    accentColor: '#e11d48',
  },
  Component: ChamChamChamGame,
}
