import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'

import correctSfx from '../../../assets/sounds/math-blitz-correct.mp3'
import wrongSfx from '../../../assets/sounds/math-blitz-wrong.mp3'
import comboSfx from '../../../assets/sounds/math-blitz-combo.mp3'
import feverSfx from '../../../assets/sounds/math-blitz-fever.mp3'
import timeWarningSfx from '../../../assets/sounds/math-blitz-time-warning.mp3'
import levelUpSfx from '../../../assets/sounds/math-blitz-level-up.mp3'
import fastBonusSfx from '../../../assets/sounds/math-blitz-fast-bonus.mp3'
import streakSfx from '../../../assets/sounds/math-blitz-streak.mp3'
import bombSfx from '../../../assets/sounds/math-blitz-bomb.mp3'
import goldSfx from '../../../assets/sounds/math-blitz-gold.mp3'
import shieldSfx from '../../../assets/sounds/math-blitz-shield.mp3'
import speedSfx from '../../../assets/sounds/math-blitz-speed.mp3'
import heartbeatSfx from '../../../assets/sounds/math-blitz-heartbeat.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import mathBlitzBgmLoop from '../../../assets/sounds/generated/math-blitz/math-blitz-bgm-loop.mp3'
import { makeMathBlitzProblem, getMathBlitzTier, type MathBlitzProblem as MathProblem } from './logic'

// --- Game constants ---
const ROUND_DURATION_MS = 35000
const BASE_SCORE = 10
const PENALTY_WRONG = 5
const MAX_TIME_BONUS = 10
const TIME_BONUS_WINDOW_MS = 3000
const FLASH_MS = 300
const SHAKE_MS = 400
const LOW_TIME_MS = 5000
const FAST_MS = 1500
const FAST_TIME_ADD_MS = 600
const FEVER_THRESHOLD = 8
const FEVER_PROBLEMS = 5
const FEVER_MULT = 3
const STREAK_MILESTONE = 15
const STREAK_BONUS = 50
const TIME_ATTACK_INTERVAL = 10
const TIME_ATTACK_BOOST = 0.12

// HP system: wrong answers cost HP, 0 HP = game over
const MAX_HP = 5
const HP_LOSS_WRONG = 1
const HP_HEAL_ON_STREAK = 1

// Special problem types
const SPEED_ROUND_INTERVAL = 15 // every 15 problems, speed round
const SPEED_ROUND_DURATION = 3 // 3 problems in speed round
const GOLD_MULT = 3
const BOMB_TIME_PENALTY_MS = 3000

// Shield: earned every 20 correct answers
const SHIELD_INTERVAL = 20
const MATH_BLITZ_BGM_VOLUME = 0.22

const CHARACTERS = [
  parkSangminImage, kimYeonjaImage, parkWankyuImage,
  seoTaijiImage, songChangsikImage, taeJinaImage,
]

function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function comboMult(c: number) {
  if (c < 3) return 1
  if (c < 6) return 1.5
  if (c < 10) return 2
  if (c < 15) return 3
  return 4
}

// --- Pixel color palette ---
const PAL = {
  bg: '#1a1a2e',
  bgLight: '#16213e',
  panel: '#0f3460',
  accent: '#e94560',
  gold: '#ffd700',
  green: '#00ff41',
  blue: '#00d4ff',
  purple: '#b537f2',
  white: '#f0f0f0',
  gray: '#666680',
  darkGray: '#2a2a40',
  red: '#ff3333',
  orange: '#ff8c00',
  hp: '#ff4757',
  hpEmpty: '#2d2d44',
}

const TIER_COLORS = [PAL.green, PAL.blue, PAL.gold, PAL.accent, PAL.purple]
const TIER_LABELS = ['EASY', 'NORMAL', 'HARD', 'EXPERT', 'MASTER']

// --- CSS ---
const CSS = `
.math-blitz-panel {
  display: flex;
  flex-direction: column;
  background: ${PAL.bg};
  font-family: 'Press Start 2P', monospace;
  user-select: none;
  touch-action: manipulation;
  color: ${PAL.white};
  image-rendering: pixelated;
  overflow: hidden;
}

/* CRT scanline overlay */
.mb-crt {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  background: repeating-linear-gradient(
    0deg,
    rgba(0,0,0,0.15) 0px,
    rgba(0,0,0,0.15) 1px,
    transparent 1px,
    transparent 3px
  );
}

/* Pixel border helper: 4px solid pixel look */
.mb-pixel-border {
  border: 4px solid ${PAL.gray};
  box-shadow:
    inset 2px 2px 0 rgba(255,255,255,0.1),
    inset -2px -2px 0 rgba(0,0,0,0.3),
    4px 4px 0 rgba(0,0,0,0.5);
}

/* --- TOP BAR --- */
.mb-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px;
  gap: 6px;
}

.mb-score-block {
  text-align: left;
}

.mb-score-num {
  font-size: clamp(1.2rem, 4.5vw, 1.8rem);
  color: ${PAL.gold};
  text-shadow: 2px 2px 0 #000, 0 0 8px rgba(255,215,0,0.4);
  margin: 0;
  line-height: 1;
}

.mb-score-sub {
  font-size: 0.35rem;
  color: ${PAL.gray};
  margin: 2px 0 0;
}

.mb-tier-pill {
  padding: 4px 8px;
  font-size: 0.4rem;
  font-weight: 900;
  color: #000;
  text-shadow: none;
  border: 2px solid #000;
  box-shadow: 2px 2px 0 #000;
}

.mb-exit-btn {
  width: 32px;
  height: 32px;
  background: ${PAL.darkGray};
  border: 3px solid ${PAL.gray};
  box-shadow: 2px 2px 0 #000;
  color: ${PAL.accent};
  font-family: 'Press Start 2P', monospace;
  font-size: 0.5rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

/* --- HP BAR --- */
.mb-hp-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px 4px;
}

.mb-hp-label {
  font-size: 0.35rem;
  color: ${PAL.hp};
  margin: 0;
}

.mb-hp-hearts {
  display: flex;
  gap: 3px;
}

.mb-heart {
  width: 16px;
  height: 14px;
  position: relative;
  transition: transform 0.1s steps(2);
}

.mb-heart::before {
  content: '';
  position: absolute;
  inset: 0;
  background: ${PAL.hp};
  clip-path: polygon(50% 100%, 0% 35%, 10% 0%, 40% 0%, 50% 20%, 60% 0%, 90% 0%, 100% 35%);
}

.mb-heart.empty::before {
  background: ${PAL.hpEmpty};
}

.mb-heart.hit {
  animation: mb-heart-hit 0.3s steps(3);
}

@keyframes mb-heart-hit {
  0% { transform: scale(1); }
  50% { transform: scale(1.4) rotate(10deg); }
  100% { transform: scale(1); }
}

.mb-heart.heal {
  animation: mb-heart-heal 0.4s steps(4);
}

@keyframes mb-heart-heal {
  0% { transform: scale(0.5); opacity: 0; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

.mb-shield-icon {
  width: 18px;
  height: 18px;
  margin-left: 6px;
  position: relative;
}

.mb-shield-icon::before {
  content: '';
  position: absolute;
  inset: 0;
  background: ${PAL.blue};
  clip-path: polygon(50% 0%, 100% 25%, 100% 65%, 50% 100%, 0% 65%, 0% 25%);
  animation: mb-shield-glow 1s steps(2) infinite;
}

@keyframes mb-shield-glow {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.5); }
}

/* --- TIMER --- */
.mb-timer-wrap {
  margin: 0 12px 4px;
  height: 14px;
  background: ${PAL.darkGray};
  border: 3px solid ${PAL.gray};
  box-shadow: inset 0 0 0 1px #000, 2px 2px 0 #000;
  position: relative;
  overflow: hidden;
}

.mb-timer-inner {
  height: 100%;
  transition: width 0.08s steps(1);
  image-rendering: pixelated;
}

.mb-timer-txt {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.35rem;
  color: ${PAL.white};
  text-shadow: 1px 1px 0 #000;
}

.mb-timer-wrap.danger {
  animation: mb-timer-danger 0.5s steps(2) infinite;
}

@keyframes mb-timer-danger {
  0%,100% { border-color: ${PAL.gray}; }
  50% { border-color: ${PAL.red}; }
}

/* --- INFO ROW --- */
.mb-info-row {
  display: flex;
  justify-content: space-around;
  padding: 2px 12px 4px;
  font-size: 0.35rem;
  color: ${PAL.gray};
}

.mb-info-val {
  display: block;
  font-size: 0.55rem;
  color: ${PAL.white};
}

/* --- FEVER STRIP --- */
.mb-fever-strip {
  text-align: center;
  font-size: 0.55rem;
  padding: 4px 12px;
  margin: 0 12px 2px;
  background: ${PAL.gold};
  color: #000;
  border: 3px solid #000;
  box-shadow: 2px 2px 0 #000;
  animation: mb-fever-flash 0.3s steps(2) infinite;
}

@keyframes mb-fever-flash {
  0%,100% { background: ${PAL.gold}; }
  50% { background: ${PAL.orange}; }
}

/* --- SPEED ROUND STRIP --- */
.mb-speed-strip {
  text-align: center;
  font-size: 0.5rem;
  padding: 4px 12px;
  margin: 0 12px 2px;
  background: ${PAL.blue};
  color: #000;
  border: 3px solid #000;
  box-shadow: 2px 2px 0 #000;
  animation: mb-speed-flash 0.2s steps(2) infinite;
}

@keyframes mb-speed-flash {
  0%,100% { background: ${PAL.blue}; }
  50% { background: #00ffff; }
}

/* --- PROBLEM AREA --- */
.mb-stage {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8px 16px;
  position: relative;
  min-height: 0;
}

.mb-char {
  width: clamp(110px, 30vw, 160px);
  height: clamp(110px, 30vw, 160px);
  object-fit: contain;
  image-rendering: pixelated;
  filter: drop-shadow(0 4px 0 #000);
}

.mb-char.bounce {
  animation: mb-bounce 0.25s steps(3);
}

.mb-char.wobble {
  animation: mb-wobble 0.35s steps(4);
}

@keyframes mb-bounce {
  0% { transform: translateY(0) scale(1); }
  40% { transform: translateY(-16px) scale(1.12); }
  100% { transform: translateY(0) scale(1); }
}

@keyframes mb-wobble {
  0% { transform: rotate(0); filter: brightness(0.5); }
  25% { transform: rotate(-10deg); }
  50% { transform: rotate(10deg); }
  75% { transform: rotate(-5deg); }
  100% { transform: rotate(0); filter: drop-shadow(0 4px 0 #000); }
}

/* Speech bubble with problem */
.mb-bubble {
  position: relative;
  background: ${PAL.panel};
  border: 4px solid ${PAL.gray};
  box-shadow: 4px 4px 0 #000, inset 2px 2px 0 rgba(255,255,255,0.08);
  padding: 12px 20px;
  margin-top: 8px;
  text-align: center;
  min-width: 200px;
}

.mb-bubble::after {
  content: '';
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 10px solid transparent;
  border-right: 10px solid transparent;
  border-bottom: 12px solid ${PAL.gray};
}

.mb-bubble.bomb-bubble {
  border-color: ${PAL.red};
  box-shadow: 4px 4px 0 #000, 0 0 12px rgba(255,51,51,0.3);
}

.mb-bubble.bomb-bubble::after {
  border-bottom-color: ${PAL.red};
}

.mb-bubble.gold-bubble {
  border-color: ${PAL.gold};
  box-shadow: 4px 4px 0 #000, 0 0 12px rgba(255,215,0,0.4);
}

.mb-bubble.gold-bubble::after {
  border-bottom-color: ${PAL.gold};
}

.mb-bubble.speed-bubble {
  border-color: ${PAL.blue};
  box-shadow: 4px 4px 0 #000, 0 0 12px rgba(0,212,255,0.3);
}

.mb-bubble.speed-bubble::after {
  border-bottom-color: ${PAL.blue};
}

.mb-problem-type-tag {
  font-size: 0.4rem;
  padding: 2px 8px;
  margin-bottom: 4px;
  display: inline-block;
  border: 2px solid #000;
  color: #000;
  font-weight: 900;
}

.mb-prob-txt {
  font-size: clamp(1.6rem, 6vw, 2.4rem);
  color: ${PAL.white};
  text-shadow: 3px 3px 0 #000;
  margin: 4px 0 0;
  letter-spacing: 2px;
}

.mb-prob-txt.urgent {
  animation: mb-urgent 0.4s steps(2) infinite;
}

@keyframes mb-urgent {
  0%,100% { color: ${PAL.white}; }
  50% { color: ${PAL.red}; }
}

/* --- CHOICES --- */
.mb-grid {
  display: grid;
  gap: 8px;
  padding: 10px 12px 14px;
}

.mb-grid.c4 { grid-template-columns: 1fr 1fr; }
.mb-grid.c6 { grid-template-columns: 1fr 1fr 1fr; }

.mb-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: clamp(52px, 11vw, 68px);
  background: ${PAL.darkGray};
  border: 4px solid ${PAL.gray};
  box-shadow: 4px 4px 0 #000, inset 2px 2px 0 rgba(255,255,255,0.05);
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(0.9rem, 3.5vw, 1.3rem);
  color: ${PAL.white};
  cursor: pointer;
  padding: 6px;
  transition: none;
}

.mb-btn:active {
  transform: translate(2px, 2px);
  box-shadow: 2px 2px 0 #000;
}

.mb-btn.correct {
  background: #003300 !important;
  border-color: ${PAL.green} !important;
  color: ${PAL.green} !important;
  animation: mb-btn-pop 0.25s steps(3);
  box-shadow: 4px 4px 0 #000, 0 0 12px rgba(0,255,65,0.3) !important;
}

.mb-btn.wrong {
  background: #330000 !important;
  border-color: ${PAL.red} !important;
  color: ${PAL.red} !important;
  animation: mb-btn-shake 0.35s steps(4);
}

.mb-btn.fever-btn {
  border-color: ${PAL.gold};
  box-shadow: 4px 4px 0 #000, 0 0 6px rgba(255,215,0,0.2);
}

.mb-btn.bomb-btn {
  border-color: ${PAL.red};
  background: #1a0000;
}

.mb-btn.gold-btn {
  border-color: ${PAL.gold};
  background: #1a1a00;
}

.mb-btn.speed-btn {
  border-color: ${PAL.blue};
  background: #001a1a;
}

@keyframes mb-btn-pop {
  0% { transform: scale(1); }
  40% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

@keyframes mb-btn-shake {
  0% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  50% { transform: translateX(6px); }
  75% { transform: translateX(-3px); }
  100% { transform: translateX(0); }
}

/* --- FLOATING INDICATORS --- */
.mb-float {
  position: absolute;
  pointer-events: none;
  z-index: 20;
  font-weight: 900;
  text-shadow: 2px 2px 0 #000;
}

.mb-combo-pop {
  top: 45%;
  left: 50%;
  font-size: clamp(1rem, 3.5vw, 1.4rem);
  animation: mb-pop-up 0.55s steps(5) forwards;
}

@keyframes mb-pop-up {
  0% { opacity: 1; transform: translate(-50%, 0) scale(0.6); }
  25% { opacity: 1; transform: translate(-50%, -20px) scale(1.2); }
  100% { opacity: 0; transform: translate(-50%, -60px) scale(0.7); }
}

.mb-fast-pop {
  top: 35%;
  right: 10px;
  font-size: 0.5rem;
  color: ${PAL.green};
  animation: mb-slide-up 0.7s steps(4) forwards;
}

.mb-streak-pop {
  top: 40%;
  left: 50%;
  font-size: 0.6rem;
  color: ${PAL.purple};
  animation: mb-pop-up 0.9s steps(5) forwards;
  white-space: nowrap;
}

.mb-shield-pop {
  top: 50%;
  left: 50%;
  font-size: 0.55rem;
  color: ${PAL.blue};
  animation: mb-pop-up 0.8s steps(4) forwards;
}

@keyframes mb-slide-up {
  0% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-25px); }
}

/* Level-up white flash */
.mb-lvl-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 15;
  animation: mb-white-flash 0.5s steps(3) forwards;
}

@keyframes mb-white-flash {
  0% { background: rgba(255,255,255,0); }
  25% { background: rgba(255,255,255,0.7); }
  100% { background: rgba(255,255,255,0); }
}

/* Pixel star decorations */
.mb-star {
  position: absolute;
  width: 4px;
  height: 4px;
  background: ${PAL.gold};
  box-shadow: 0 0 4px ${PAL.gold};
  animation: mb-twinkle var(--dur) steps(2) infinite;
  animation-delay: var(--delay);
  opacity: 0.6;
  pointer-events: none;
}

@keyframes mb-twinkle {
  0%,100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.5); }
}

/* Combo label */
.mb-combo-label {
  text-align: center;
  font-size: clamp(0.6rem, 2.5vw, 0.85rem);
  font-weight: 900;
  margin: 2px 0;
  text-shadow: 2px 2px 0 #000;
}

/* Low HP vignette */
.mb-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  box-shadow: inset 0 0 60px 20px rgba(255,0,0,0.3);
  animation: mb-vignette-pulse 1s steps(2) infinite;
}

@keyframes mb-vignette-pulse {
  0%,100% { opacity: 0.6; }
  50% { opacity: 1; }
}
`

const STARS = Array.from({ length: 12 }, (_, i) => ({
  left: `${5 + Math.random() * 90}%`,
  top: `${5 + Math.random() * 90}%`,
  dur: `${2 + Math.random() * 3}s`,
  delay: `${Math.random() * 2}s`,
  key: i,
}))

function MathBlitzGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [solvedCount, setSolvedCount] = useState(0)
  const [hp, setHp] = useState(MAX_HP)
  const [hasShield, setHasShield] = useState(false)
  const [problem, setProblem] = useState<MathProblem>(() => makeMathBlitzProblem({ score: 0, solvedCount: 0, speedRoundLeft: 0 }))
  const [correctIdx, setCorrectIdx] = useState<number | null>(null)
  const [wrongIdx, setWrongIdx] = useState<number | null>(null)
  const [isFever, setIsFever] = useState(false)
  const [feverLeft, setFeverLeft] = useState(0)
  const [speedRoundLeft, setSpeedRoundLeft] = useState(0)
  const [charImg, setCharImg] = useState(() => CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)])
  const [charAnim, setCharAnim] = useState<'' | 'bounce' | 'wobble'>('')
  const [floats, setFloats] = useState<{ id: number; cls: string; text: string; color: string }[]>([])
  const [showLvlFlash, setShowLvlFlash] = useState(false)
  const [lvlKey, setLvlKey] = useState(0)
  const [timeSpeed, setTimeSpeed] = useState(1)
  const [hpAnim, setHpAnim] = useState<'hit' | 'heal' | ''>('')

  const effects = useGameEffects()
  const floatIdRef = useRef(0)

  // Refs for RAF loop
  const scoreR = useRef(0)
  const remainR = useRef(ROUND_DURATION_MS)
  const comboR = useRef(0)
  const solvedR = useRef(0)
  const hpR = useRef(MAX_HP)
  const shieldR = useRef(false)
  const probR = useRef(problem)
  const probStartR = useRef(0)
  const doneR = useRef(false)
  const rafR = useRef<number | null>(null)
  const lastR = useRef<number | null>(null)
  const flashTimerR = useRef<number | null>(null)
  const shakeTimerR = useRef<number | null>(null)
  const lowSecR = useRef<number | null>(null)
  const feverR = useRef(false)
  const feverLeftR = useRef(0)
  const lastStreakR = useRef(0)
  const lastTierR = useRef(0)
  const timeSpeedR = useRef(1)
  const speedRoundR = useRef(0)
  const bgmRef = useRef<HTMLAudioElement | null>(null)

  const audioPool = useRef<Map<string, HTMLAudioElement>>(new Map())

  const getAudio = useCallback((src: string) => {
    let a = audioPool.current.get(src)
    if (!a) { a = new Audio(src); a.preload = 'auto'; audioPool.current.set(src, a) }
    return a
  }, [])

  const play = useCallback((src: string, vol: number, rate = 1) => {
    const a = getAudio(src); a.currentTime = 0; a.volume = vol; a.playbackRate = rate
    void a.play().catch(() => {})
  }, [getAudio])

  const startBgm = useCallback(() => {
    const bgm = bgmRef.current
    if (bgm === null || doneR.current || !bgm.paused) return
    void bgm.play().catch(() => {})
  }, [])

  const stopBgm = useCallback(() => {
    const bgm = bgmRef.current
    if (bgm === null) return
    bgm.pause()
    bgm.currentTime = 0
  }, [])

  const clrTimer = (r: { current: number | null }) => { if (r.current !== null) { clearTimeout(r.current); r.current = null } }

  const addFloat = useCallback((cls: string, text: string, color: string) => {
    const id = ++floatIdRef.current
    setFloats(prev => [...prev, { id, cls, text, color }])
    setTimeout(() => setFloats(prev => prev.filter(f => f.id !== id)), 1000)
  }, [])

  const advance = useCallback((nextScore: number) => {
    const srLeft = speedRoundR.current > 0 ? speedRoundR.current - 1 : 0
    speedRoundR.current = srLeft
    setSpeedRoundLeft(srLeft)

    // Check if we should start a speed round
    const nextSolved = solvedR.current
    if (srLeft === 0 && nextSolved > 0 && nextSolved % SPEED_ROUND_INTERVAL === 0) {
      speedRoundR.current = SPEED_ROUND_DURATION
      setSpeedRoundLeft(SPEED_ROUND_DURATION)
      play(speedSfx, 0.5)
      addFloat('mb-shield-pop', 'SPEED ROUND!', PAL.blue)
    }

    const p = makeMathBlitzProblem({ score: nextScore, solvedCount: nextSolved, speedRoundLeft: speedRoundR.current })
    probR.current = p
    setProblem(p)
    probStartR.current = performance.now()

    const newTier = getMathBlitzTier(nextScore)
    if (newTier !== lastTierR.current) {
      lastTierR.current = newTier
      setCharImg(CHARACTERS[newTier % CHARACTERS.length])
      setShowLvlFlash(true)
      setLvlKey(k => k + 1)
      play(levelUpSfx, 0.5)
      addFloat('mb-streak-pop', `${TIER_LABELS[newTier]}!`, TIER_COLORS[newTier])
      setTimeout(() => setShowLvlFlash(false), 500)
    }
  }, [play, addFloat])

  const finish = useCallback(() => {
    if (doneR.current) return
    doneR.current = true
    clrTimer(flashTimerR); clrTimer(shakeTimerR)
    stopBgm()
    effects.cleanup()
    play(gameOverHitSfx, 0.6, 0.95)
    const elapsed = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainR.current))
    onFinish({ score: scoreR.current, durationMs: elapsed })
  }, [onFinish, effects, play, stopBgm])

  const handleTap = useCallback((val: number, idx: number) => {
    if (doneR.current) return
    startBgm()
    const prob = probR.current
    const now = performance.now()

    if (val === prob.answer) {
      // --- CORRECT ---
      const react = now - probStartR.current
      const timeBonus = react < TIME_BONUS_WINDOW_MS ? Math.round(MAX_TIME_BONUS * (1 - react / TIME_BONUS_WINDOW_MS)) : 0
      const nextCombo = comboR.current + 1
      comboR.current = nextCombo
      setCombo(nextCombo)

      setCharAnim('bounce')
      setTimeout(() => setCharAnim(''), 250)

      // Fever
      if (feverR.current) {
        feverLeftR.current -= 1
        if (feverLeftR.current <= 0) { feverR.current = false; setIsFever(false); setFeverLeft(0) }
        else setFeverLeft(feverLeftR.current)
      } else if (nextCombo >= FEVER_THRESHOLD) {
        feverR.current = true; feverLeftR.current = FEVER_PROBLEMS
        setIsFever(true); setFeverLeft(FEVER_PROBLEMS)
        effects.triggerFlash('rgba(255,215,0,0.5)', 150)
        play(feverSfx, 0.6)
      }

      // Score calc
      const fMult = feverR.current ? FEVER_MULT : 1
      const typeMult = prob.type === 'gold' ? GOLD_MULT : prob.type === 'speed' ? 2 : 1
      const mult = comboMult(nextCombo) * fMult * typeMult
      const earned = Math.round((BASE_SCORE + timeBonus) * mult)
      const nextScore = scoreR.current + earned
      scoreR.current = nextScore
      setScore(nextScore)

      if (prob.type === 'gold') { play(goldSfx, 0.5); addFloat('mb-combo-pop', `GOLD! +${earned}`, PAL.gold) }

      // Fast bonus
      if (react < FAST_MS) {
        remainR.current = Math.min(ROUND_DURATION_MS, remainR.current + FAST_TIME_ADD_MS)
        setRemainingMs(remainR.current)
        addFloat('mb-fast-pop', '+TIME!', PAL.green)
        play(fastBonusSfx, 0.35)
      }

      // Streak milestone
      const sm = Math.floor(nextCombo / STREAK_MILESTONE)
      if (sm > lastStreakR.current) {
        lastStreakR.current = sm
        scoreR.current += STREAK_BONUS
        setScore(scoreR.current)
        effects.showScorePopup(STREAK_BONUS, 200, 200, PAL.purple)
        addFloat('mb-streak-pop', `STREAK +${STREAK_BONUS}!`, PAL.purple)
        play(streakSfx, 0.5)
        // Heal on streak
        if (hpR.current < MAX_HP) {
          hpR.current = Math.min(MAX_HP, hpR.current + HP_HEAL_ON_STREAK)
          setHp(hpR.current)
          setHpAnim('heal')
          setTimeout(() => setHpAnim(''), 400)
        }
      }

      // Shield earn
      const nextSolved = solvedR.current + 1
      solvedR.current = nextSolved
      setSolvedCount(nextSolved)
      if (nextSolved > 0 && nextSolved % SHIELD_INTERVAL === 0 && !shieldR.current) {
        shieldR.current = true
        setHasShield(true)
        play(shieldSfx, 0.4)
        addFloat('mb-shield-pop', 'SHIELD!', PAL.blue)
      }

      // Time attack
      if (nextSolved > 0 && nextSolved % TIME_ATTACK_INTERVAL === 0) {
        const ns = timeSpeedR.current + TIME_ATTACK_BOOST
        timeSpeedR.current = ns
        setTimeSpeed(ns)
      }

      // Visual
      setCorrectIdx(idx)
      clrTimer(flashTimerR)
      flashTimerR.current = window.setTimeout(() => { flashTimerR.current = null; setCorrectIdx(null) }, FLASH_MS)

      if (nextCombo >= 3) {
        const label = getComboLabel(nextCombo)
        if (label) addFloat('mb-combo-pop', `${label} +${earned}`, getComboColor(nextCombo))
        play(comboSfx, 0.4, 1 + Math.min(0.4, nextCombo * 0.025))
      } else {
        play(correctSfx, 0.5, 1 + Math.min(0.3, nextCombo * 0.02))
      }

      effects.comboHitBurst(200, 300, nextCombo, earned)
      advance(nextScore)

    } else {
      // --- WRONG ---
      // Bomb penalty: lose time instead of HP
      if (prob.type === 'bomb') {
        remainR.current = Math.max(0, remainR.current - BOMB_TIME_PENALTY_MS)
        setRemainingMs(remainR.current)
        play(bombSfx, 0.6)
        effects.triggerFlash('rgba(255,0,0,0.5)', 200)
        addFloat('mb-combo-pop', 'BOMB! -3s', PAL.red)
      } else if (shieldR.current) {
        // Shield absorbs
        shieldR.current = false
        setHasShield(false)
        play(shieldSfx, 0.3)
        addFloat('mb-shield-pop', 'SHIELD BREAK!', PAL.blue)
      } else {
        hpR.current = Math.max(0, hpR.current - HP_LOSS_WRONG)
        setHp(hpR.current)
        setHpAnim('hit')
        setTimeout(() => setHpAnim(''), 300)
        if (hpR.current <= 0) { finish(); return }
      }

      const nextScore = Math.max(0, scoreR.current - PENALTY_WRONG)
      scoreR.current = nextScore
      setScore(nextScore)
      comboR.current = 0; setCombo(0)
      feverR.current = false; feverLeftR.current = 0; setIsFever(false); setFeverLeft(0)
      lastStreakR.current = 0

      setCharAnim('wobble')
      setTimeout(() => setCharAnim(''), 350)

      setWrongIdx(idx)
      clrTimer(shakeTimerR)
      shakeTimerR.current = window.setTimeout(() => { shakeTimerR.current = null; setWrongIdx(null) }, SHAKE_MS)

      play(wrongSfx, 0.5, 0.9)
      effects.triggerShake(6)
      effects.triggerFlash('rgba(239,68,68,0.3)')
    }
  }, [advance, play, effects, finish, addFloat, startBgm])

  const handleExit = useCallback(() => { stopBgm(); play(wrongSfx, 0.3); onExit() }, [onExit, play, stopBgm])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape') { e.preventDefault(); handleExit() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleExit])

  useEffect(() => {
    const pool = audioPool.current
    const preloadSources = [correctSfx, wrongSfx, comboSfx, feverSfx, timeWarningSfx, levelUpSfx, fastBonusSfx, streakSfx, bombSfx, goldSfx, shieldSfx, speedSfx, heartbeatSfx, gameOverHitSfx]
    preloadSources.forEach(s => getAudio(s))
    const bgm = new Audio(mathBlitzBgmLoop)
    bgm.preload = 'auto'
    bgm.loop = true
    bgm.volume = MATH_BLITZ_BGM_VOLUME
    bgmRef.current = bgm
    void bgm.play().catch(() => {})
    return () => {
      clrTimer(flashTimerR)
      clrTimer(shakeTimerR)
      if (bgmRef.current !== null) {
        bgmRef.current.pause()
        bgmRef.current.currentTime = 0
        bgmRef.current = null
      }
      effects.cleanup()
      pool.clear()
    }
  }, [effects, getAudio])

  useEffect(() => {
    probStartR.current = performance.now()
    const step = (now: number) => {
      if (doneR.current) { rafR.current = null; return }
      if (lastR.current === null) lastR.current = now
      const dt = Math.min(now - lastR.current, MAX_FRAME_DELTA_MS)
      lastR.current = now

      const scaled = dt * timeSpeedR.current
      remainR.current = Math.max(0, remainR.current - scaled)
      setRemainingMs(remainR.current)
      effects.updateParticles()

      // Low time warning
      if (remainR.current > 0 && remainR.current <= LOW_TIME_MS) {
        const sec = Math.ceil(remainR.current / 1000)
        if (lowSecR.current !== sec) {
          lowSecR.current = sec
          play(timeWarningSfx, 0.25, 1.2 - sec * 0.03)
        }
      } else { lowSecR.current = null }

      // Low HP heartbeat
      if (hpR.current <= 2 && hpR.current > 0 && remainR.current > 0) {
        const beat = Math.floor(now / 800) % 2
        if (beat === 0 && lowSecR.current !== -999) {
          // just use the time warning ref to avoid double play
        }
      }

      if (remainR.current <= 0) { finish(); rafR.current = null; return }
      rafR.current = requestAnimationFrame(step)
    }
    rafR.current = requestAnimationFrame(step)
    return () => { if (rafR.current !== null) cancelAnimationFrame(rafR.current); lastR.current = null }
  }, [finish, play, effects])

  // Derived
  const isLow = remainingMs <= LOW_TIME_MS
  const cMult = comboMult(combo)
  const bestDisp = useMemo(() => Math.max(bestScore, score), [bestScore, score])
  const t = getMathBlitzTier(score)
  const tLabel = TIER_LABELS[clamp(t, 0, 4)]
  const tColor = TIER_COLORS[clamp(t, 0, 4)]
  const cLabel = getComboLabel(combo)
  const cColor = getComboColor(combo)
  const pct = (remainingMs / ROUND_DURATION_MS) * 100
  const barColor = isLow ? PAL.red : isFever ? PAL.gold : PAL.green
  const gridCls = problem.choices.length > 4 ? 'c6' : 'c4'
  const bubbleCls = problem.type === 'bomb' ? 'bomb-bubble' : problem.type === 'gold' ? 'gold-bubble' : problem.type === 'speed' ? 'speed-bubble' : ''
  const btnTypeCls = problem.type === 'bomb' ? 'bomb-btn' : problem.type === 'gold' ? 'gold-btn' : problem.type === 'speed' ? 'speed-btn' : ''

  return (
    <section
      className="mini-game-panel math-blitz-panel"
      aria-label="math-blitz-game"
      style={{ maxWidth: '432px', margin: '0 auto', position: 'relative', height: '100%', ...effects.getShakeStyle() }}
    >
      <style>{GAME_EFFECTS_CSS}{CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* CRT scanlines */}
      <div className="mb-crt" />

      {/* Pixel stars background */}
      {STARS.map(s => (
        <div key={s.key} className="mb-star" style={{ left: s.left, top: s.top, '--dur': s.dur, '--delay': s.delay } as React.CSSProperties} />
      ))}

      {/* Low HP vignette */}
      {hp <= 2 && hp > 0 && <div className="mb-vignette" />}

      {/* Level up flash */}
      {showLvlFlash && <div className="mb-lvl-flash" key={lvlKey} />}

      {/* Floating indicators */}
      {floats.map(f => (
        <span key={f.id} className={`mb-float ${f.cls}`} style={{ color: f.color }}>{f.text}</span>
      ))}

      {/* --- TOP BAR --- */}
      <div className="mb-topbar">
        <div className="mb-score-block">
          <p className="mb-score-num">{score.toLocaleString()}</p>
          <p className="mb-score-sub">BEST {bestDisp.toLocaleString()}</p>
        </div>
        <span className="mb-tier-pill" style={{ background: tColor }}>{tLabel}</span>
        <button className="mb-exit-btn" type="button" onClick={handleExit}>X</button>
      </div>

      {/* --- HP BAR --- */}
      <div className="mb-hp-row">
        <p className="mb-hp-label">HP</p>
        <div className="mb-hp-hearts">
          {Array.from({ length: MAX_HP }, (_, i) => (
            <div
              key={i}
              className={`mb-heart ${i >= hp ? 'empty' : ''} ${hpAnim === 'hit' && i === hp ? 'hit' : ''} ${hpAnim === 'heal' && i === hp - 1 ? 'heal' : ''}`}
            />
          ))}
        </div>
        {hasShield && <div className="mb-shield-icon" />}
      </div>

      {/* --- TIMER --- */}
      <div className={`mb-timer-wrap ${isLow ? 'danger' : ''}`}>
        <div className="mb-timer-inner" style={{
          width: `${pct}%`,
          background: `repeating-linear-gradient(90deg, ${barColor} 0px, ${barColor} 4px, transparent 4px, transparent 6px)`,
        }} />
        <span className="mb-timer-txt">
          {(remainingMs / 1000).toFixed(1)}s
          {timeSpeed > 1 && ` x${timeSpeed.toFixed(1)}`}
        </span>
      </div>

      {/* --- INFO ROW --- */}
      <div className="mb-info-row">
        <p style={{ margin: 0 }}>COMBO<span className="mb-info-val" style={{ color: cColor }}>{combo}</span></p>
        <p style={{ margin: 0 }}>x<span className="mb-info-val">{cMult}</span></p>
        <p style={{ margin: 0 }}>SOLVED<span className="mb-info-val">{solvedCount}</span></p>
      </div>

      {/* Fever banner */}
      {isFever && <div className="mb-fever-strip">FEVER x{FEVER_MULT}! ({feverLeft})</div>}

      {/* Speed round banner */}
      {speedRoundLeft > 0 && !isFever && <div className="mb-speed-strip">SPEED ROUND! ({speedRoundLeft})</div>}

      {/* Combo label */}
      {cLabel && <p className="mb-combo-label" style={{ color: cColor }}>{cLabel}</p>}

      {/* --- PROBLEM STAGE --- */}
      <div className="mb-stage">
        <img src={charImg} alt="" className={`mb-char ${charAnim}`} />

        <div className={`mb-bubble ${bubbleCls}`}>
          {problem.type !== 'normal' && (
            <span className="mb-problem-type-tag" style={{
              background: problem.type === 'bomb' ? PAL.red : problem.type === 'gold' ? PAL.gold : PAL.blue,
            }}>
              {problem.type === 'bomb' ? 'BOMB!' : problem.type === 'gold' ? 'GOLD x3!' : 'SPEED!'}
            </span>
          )}
          <p className={`mb-prob-txt ${isLow ? 'urgent' : ''}`}>
            {problem.left} {problem.operator} {problem.right} = ?
          </p>
        </div>
      </div>

      {/* --- CHOICES --- */}
      <div className={`mb-grid ${gridCls}`}>
        {problem.choices.map((c, i) => {
          let cls = 'mb-btn'
          if (correctIdx === i) cls += ' correct'
          else if (wrongIdx === i) cls += ' wrong'
          else if (isFever) cls += ' fever-btn'
          else if (btnTypeCls) cls += ` ${btnTypeCls}`

          return (
            <button key={`${i}-${c}`} className={cls} type="button" onClick={() => handleTap(c, i)}>
              {c}
            </button>
          )
        })}
      </div>
    </section>
  )
}

export const mathBlitzModule: MiniGameModule = {
  manifest: {
    id: 'math-blitz',
    title: 'Math Blitz',
    description: 'Solve math problems fast! Speed = high score!',
    unlockCost: 25,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#6366f1',
  },
  Component: MathBlitzGame,
}
