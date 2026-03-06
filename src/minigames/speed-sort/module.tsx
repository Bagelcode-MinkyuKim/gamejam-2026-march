import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import kimYeonjaImage from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminImage from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuImage from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiImage from '../../../assets/images/same-character/seo-taiji.png'
import songChangsikImage from '../../../assets/images/same-character/song-changsik.png'
import taeJinaImage from '../../../assets/images/same-character/tae-jina.png'

import swipeSfx from '../../../assets/sounds/speed-sort-swipe.mp3'
import correctSfx from '../../../assets/sounds/speed-sort-correct.mp3'
import wrongSfx from '../../../assets/sounds/speed-sort-wrong.mp3'
import comboSfx from '../../../assets/sounds/speed-sort-combo.mp3'
import ruleChangeSfx from '../../../assets/sounds/speed-sort-rule-change.mp3'
import timeBonusSfx from '../../../assets/sounds/speed-sort-time-bonus.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import levelupSfx from '../../../assets/sounds/speed-sort-levelup.mp3'
import perfectSfx from '../../../assets/sounds/speed-sort-perfect.mp3'
import dangerSfx from '../../../assets/sounds/speed-sort-danger.mp3'
import powerupSfx from '../../../assets/sounds/speed-sort-powerup.mp3'
import speedBonusSfx from '../../../assets/sounds/speed-sort-speed-bonus.mp3'

// ─── Constants ──────────────────────────────────────────────────────

const ROUND_DURATION_MS = 35000
const CORRECT_SCORE = 1
const WRONG_PENALTY = 2
const RULE_CHANGE_INTERVAL_MS = 8000
const SWIPE_ANIMATION_DURATION_MS = 250
const FEEDBACK_FLASH_DURATION_MS = 180
const LOW_TIME_THRESHOLD_MS = 5000
const COMBO_DECAY_WINDOW_MS = 2500
const SPAWN_DELAY_MS = 280

const MIN_RULE_CHANGE_INTERVAL_MS = 3000
const RULE_CHANGE_SPEEDUP_PER_10 = 500
const COMBO_MULTIPLIER_STEP = 10
const COMBO_TIME_BONUS_THRESHOLD = 15
const COMBO_TIME_BONUS_MS = 1500

// Fever
const FEVER_COMBO_THRESHOLD = 8
const FEVER_SCORE_MULTIPLIER = 2

// Speed bonus: fast reaction = extra points
const SPEED_BONUS_FAST_MS = 600
const SPEED_BONUS_INSTANT_MS = 300
const SPEED_BONUS_FAST_EXTRA = 1
const SPEED_BONUS_INSTANT_EXTRA = 3

// Power-ups
const POWERUP_CHANCE = 0.12
const POWERUP_DURATION_MS = 4000
type PowerUpKind = 'freeze' | 'double' | 'magnet'
const POWERUP_INFO: Record<PowerUpKind, { label: string; emoji: string; color: string }> = {
  freeze: { label: 'TIME FREEZE', emoji: '❄️', color: '#22d3ee' },
  double: { label: 'DOUBLE PTS', emoji: '💰', color: '#fbbf24' },
  magnet: { label: 'POINT MAGNET', emoji: '🧲', color: '#a855f7' },
}

// Level system
const LEVELS = [
  { name: 'Lv.1', threshold: 0, color: '#4ade80', bg: '#064e3b' },
  { name: 'Lv.2', threshold: 10, color: '#60a5fa', bg: '#1e3a5f' },
  { name: 'Lv.3', threshold: 25, color: '#facc15', bg: '#422006' },
  { name: 'Lv.4', threshold: 45, color: '#fb923c', bg: '#431407' },
  { name: 'Lv.5', threshold: 70, color: '#f87171', bg: '#450a0a' },
  { name: 'Lv.MAX', threshold: 100, color: '#e879f9', bg: '#3b0764' },
] as const

const CHARACTER_POOL = [
  { id: 'kim-yeonja', name: 'Yeonja', imageSrc: kimYeonjaImage, color: '#ec4899', emoji: '🎤' },
  { id: 'park-sangmin', name: 'Sangmin', imageSrc: parkSangminImage, color: '#ef4444', emoji: '🎸' },
  { id: 'park-wankyu', name: 'Wankyu', imageSrc: parkWankyuImage, color: '#f59e0b', emoji: '🎵' },
  { id: 'seo-taiji', name: 'Taiji', imageSrc: seoTaijiImage, color: '#8b5cf6', emoji: '🎹' },
  { id: 'song-changsik', name: 'Changsik', imageSrc: songChangsikImage, color: '#22c55e', emoji: '🎺' },
  { id: 'tae-jina', name: 'Jina', imageSrc: taeJinaImage, color: '#22d3ee', emoji: '🥁' },
] as const

type Character = (typeof CHARACTER_POOL)[number]
type SortSide = 'left' | 'right'

interface SortRule {
  readonly leftCharacterIds: ReadonlySet<string>
  readonly rightCharacterIds: ReadonlySet<string>
  readonly leftLabel: string
  readonly rightLabel: string
}

function shuffleArray<T>(array: readonly T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = temp
  }
  return shuffled
}

function generateRule(): SortRule {
  const shuffled = shuffleArray(CHARACTER_POOL)
  const splitIndex = 2 + Math.floor(Math.random() * (shuffled.length - 3))
  const leftGroup = shuffled.slice(0, splitIndex)
  const rightGroup = shuffled.slice(splitIndex)
  return {
    leftCharacterIds: new Set(leftGroup.map(c => c.id)),
    rightCharacterIds: new Set(rightGroup.map(c => c.id)),
    leftLabel: leftGroup.map(c => c.name).join(', '),
    rightLabel: rightGroup.map(c => c.name).join(', '),
  }
}

function pickRandomCharacter(previousId?: string): Character {
  const candidates = CHARACTER_POOL.filter(c => c.id !== previousId)
  return candidates[Math.floor(Math.random() * candidates.length)] ?? CHARACTER_POOL[0]
}

function getCorrectSide(characterId: string, rule: SortRule): SortSide {
  return rule.leftCharacterIds.has(characterId) ? 'left' : 'right'
}

function getLevel(score: number) {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (score >= LEVELS[i].threshold) return LEVELS[i]
  }
  return LEVELS[0]
}

function randomPowerUp(): PowerUpKind {
  const kinds: PowerUpKind[] = ['freeze', 'double', 'magnet']
  return kinds[Math.floor(Math.random() * kinds.length)]
}

// ─── Retro Pixel CSS ────────────────────────────────────────────────

const RETRO_CSS = `
  ${GAME_EFFECTS_CSS}

  @keyframes ss-crt-flicker {
    0% { opacity: 0.97; }
    50% { opacity: 1; }
    100% { opacity: 0.97; }
  }

  @keyframes ss-scanline {
    0% { background-position: 0 0; }
    100% { background-position: 0 4px; }
  }

  @keyframes ss-pixel-in {
    0% { transform: scale(0) rotate(-15deg); opacity: 0; filter: blur(4px); }
    50% { transform: scale(1.15) rotate(3deg); opacity: 1; filter: blur(0); }
    100% { transform: scale(1) rotate(0deg); opacity: 1; }
  }

  @keyframes ss-swipe-l {
    0% { transform: translateX(0) rotate(0); opacity: 1; }
    100% { transform: translateX(-250px) rotate(-35deg); opacity: 0; }
  }

  @keyframes ss-swipe-r {
    0% { transform: translateX(0) rotate(0); opacity: 1; }
    100% { transform: translateX(250px) rotate(35deg); opacity: 0; }
  }

  @keyframes ss-bounce-score {
    0% { transform: scale(1); }
    30% { transform: scale(1.25); }
    100% { transform: scale(1); }
  }

  @keyframes ss-speed-flash {
    0% { opacity: 1; transform: scale(1.3); }
    100% { opacity: 0; transform: scale(0.8) translateY(-30px); }
  }

  @keyframes ss-powerup-float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-6px); }
  }

  @keyframes ss-powerup-expire {
    0% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.3; transform: scale(0.95); }
    100% { opacity: 1; transform: scale(1); }
  }

  @keyframes ss-rule-danger {
    0%, 100% { border-color: #f97316; background: rgba(249,115,22,0.05); }
    50% { border-color: #ef4444; background: rgba(239,68,68,0.1); }
  }

  @keyframes ss-level-up {
    0% { transform: scale(2) translateY(-10px); opacity: 0; }
    40% { transform: scale(0.9) translateY(2px); opacity: 1; }
    100% { transform: scale(1) translateY(0); opacity: 1; }
  }

  @keyframes ss-ripple-out {
    0% { transform: scale(0); opacity: 0.7; }
    100% { transform: scale(4); opacity: 0; }
  }

  @keyframes ss-fever-bg {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }

  @keyframes ss-pixel-border-pulse {
    0%, 100% { box-shadow: inset 0 0 0 3px var(--lvl-color, #4ade80); }
    50% { box-shadow: inset 0 0 0 3px transparent; }
  }

  .ss-retro {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: 'Courier New', monospace;
    animation: ss-crt-flicker 0.1s infinite;
    image-rendering: pixelated;
  }

  .ss-retro::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.08) 2px,
      rgba(0,0,0,0.08) 4px
    );
    pointer-events: none;
    z-index: 50;
    animation: ss-scanline 0.5s linear infinite;
  }

  .ss-retro.ss-fever-mode {
    background: linear-gradient(270deg, #1a1a2e, #2d1b4e, #1a1a2e);
    background-size: 400% 100%;
    animation: ss-crt-flicker 0.1s infinite, ss-fever-bg 3s ease infinite;
  }

  /* ── Header ── */
  .ss-hud {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px 14px 4px;
    flex-shrink: 0;
    position: relative;
    z-index: 5;
  }

  .ss-score-col { text-align: left; }

  .ss-score-val {
    font-size: clamp(2rem, 8vw, 2.8rem);
    font-weight: 900;
    line-height: 1;
    margin: 0;
    color: #fbbf24;
    text-shadow: 0 0 8px rgba(251,191,36,0.5), 2px 2px 0 #000;
  }

  .ss-score-val.ss-score-bounce {
    animation: ss-bounce-score 0.2s ease-out;
  }

  .ss-hiscore {
    font-size: 0.65rem;
    color: #6b7280;
    margin: 2px 0 0;
    font-weight: 600;
    text-shadow: 1px 1px 0 #000;
  }

  .ss-timer-col { text-align: right; }

  .ss-time-val {
    font-size: clamp(1.5rem, 5vw, 2rem);
    font-weight: 800;
    line-height: 1;
    margin: 0;
    color: #4ade80;
    text-shadow: 0 0 6px rgba(74,222,128,0.4), 2px 2px 0 #000;
    transition: color 0.3s;
  }

  .ss-time-val.ss-low {
    color: #ef4444;
    text-shadow: 0 0 12px rgba(239,68,68,0.6), 2px 2px 0 #000;
    animation: ge-pulse 0.5s infinite;
  }

  .ss-sorted-lbl {
    font-size: 0.65rem;
    color: #6b7280;
    margin: 2px 0 0;
    text-shadow: 1px 1px 0 #000;
  }

  /* ── Progress bars ── */
  .ss-bar-wrap {
    margin: 2px 14px;
    height: 6px;
    background: #0f0f23;
    border: 2px solid #333;
    border-radius: 0;
    overflow: hidden;
    flex-shrink: 0;
    image-rendering: pixelated;
  }

  .ss-bar-fill {
    height: 100%;
    transition: width 0.1s linear;
    image-rendering: pixelated;
  }

  /* ── Combo / Level row ── */
  .ss-info-row {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    min-height: 22px;
    flex-shrink: 0;
  }

  .ss-combo-lbl {
    font-size: 0.8rem;
    font-weight: 700;
    color: #9ca3af;
    margin: 0;
    text-shadow: 1px 1px 0 #000;
  }

  .ss-combo-lbl strong {
    color: #f97316;
    font-size: 1rem;
  }

  .ss-mult-lbl {
    font-size: 0.75rem;
    font-weight: 800;
    color: #fbbf24;
    margin: 0;
    text-shadow: 0 0 6px rgba(251,191,36,0.5);
    animation: ge-pulse 0.7s infinite;
  }

  .ss-lvl-badge {
    font-size: 0.6rem;
    font-weight: 900;
    padding: 1px 5px;
    border: 2px solid;
    margin: 0;
    letter-spacing: 1px;
    text-shadow: 1px 1px 0 #000;
  }

  .ss-lvl-badge.ss-lvl-change {
    animation: ss-level-up 0.4s ease-out;
  }

  /* ── Combo label big text ── */
  .ss-combo-big {
    text-align: center;
    font-size: clamp(1.1rem, 4.5vw, 1.5rem);
    font-weight: 900;
    margin: 0;
    animation: ge-bounce-in 0.3s ease-out;
    text-shadow: 0 0 10px currentColor, 2px 2px 0 #000;
    min-height: 20px;
    flex-shrink: 0;
  }

  /* ── Speed bonus popup ── */
  .ss-speed-popup {
    position: absolute;
    z-index: 20;
    font-size: 0.85rem;
    font-weight: 900;
    pointer-events: none;
    animation: ss-speed-flash 0.6s ease-out forwards;
    text-shadow: 0 0 6px currentColor, 1px 1px 0 #000;
  }

  /* ── Fever banner ── */
  .ss-fever-lbl {
    text-align: center;
    font-size: clamp(0.7rem, 2.5vw, 0.85rem);
    font-weight: 900;
    color: #fbbf24;
    margin: 0;
    padding: 2px 0;
    letter-spacing: 3px;
    text-shadow: 0 0 10px rgba(251,191,36,0.6), 2px 2px 0 #000;
    animation: ge-pulse 0.5s infinite;
    flex-shrink: 0;
  }

  /* ── Power-up banner ── */
  .ss-powerup-banner {
    text-align: center;
    font-size: 0.75rem;
    font-weight: 900;
    margin: 0;
    padding: 3px 0;
    letter-spacing: 1px;
    text-shadow: 0 0 8px currentColor, 1px 1px 0 #000;
    flex-shrink: 0;
  }

  .ss-powerup-banner.ss-pu-active {
    animation: ss-powerup-float 1s ease-in-out infinite;
  }

  .ss-powerup-banner.ss-pu-expiring {
    animation: ss-powerup-expire 0.3s ease-in-out infinite;
  }

  /* ── Rule banner ── */
  .ss-rule-box {
    display: flex;
    align-items: stretch;
    margin: 4px 14px;
    border: 2px solid #444;
    background: #0f0f23;
    overflow: hidden;
    flex-shrink: 0;
    transition: border-color 0.3s, background 0.3s;
    min-height: 38px;
  }

  .ss-rule-box.ss-rule-flash {
    border-color: #f97316;
    background: rgba(249,115,22,0.08);
    animation: ge-shake 0.3s ease-out;
  }

  .ss-rule-box.ss-rule-danger {
    animation: ss-rule-danger 0.5s ease-in-out infinite;
  }

  .ss-rule-half {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 5px 6px;
    font-size: clamp(0.6rem, 2.2vw, 0.72rem);
    font-weight: 700;
    color: #d1d5db;
    text-shadow: 1px 1px 0 #000;
  }

  .ss-rule-half.ss-rule-left {
    border-right: 2px solid #444;
  }

  .ss-rule-arr {
    font-size: 1rem;
    color: #f97316;
    text-shadow: 0 0 4px rgba(249,115,22,0.5);
  }

  .ss-rule-bar {
    margin: 0 14px;
    height: 3px;
    background: #0f0f23;
    border: 1px solid #333;
    overflow: hidden;
    flex-shrink: 0;
  }

  .ss-rule-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #f97316, #ef4444);
    transition: width 0.1s linear;
  }

  /* ── Arena ── */
  .ss-arena {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    overflow: hidden;
    min-height: 0;
    touch-action: none;
  }

  .ss-zone {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 33%;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
  }

  .ss-zone-l { left: 0; }
  .ss-zone-r { right: 0; }

  .ss-zone:active {
    background: rgba(249,115,22,0.12);
  }

  .ss-zone-arrow {
    font-size: clamp(2.5rem, 10vw, 3.5rem);
    color: rgba(249,115,22,0.2);
    font-weight: 900;
    text-shadow: 2px 2px 0 rgba(0,0,0,0.3);
    transition: color 0.1s, transform 0.1s;
  }

  .ss-zone:active .ss-zone-arrow {
    color: rgba(249,115,22,0.8);
    transform: scale(1.5);
    text-shadow: 0 0 12px rgba(249,115,22,0.6);
  }

  .ss-char-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 3;
    position: relative;
  }

  .ss-char {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .ss-char-img {
    width: clamp(160px, 50vw, 250px);
    height: clamp(160px, 50vw, 250px);
    object-fit: contain;
    image-rendering: pixelated;
    filter: drop-shadow(0 0 12px rgba(251,191,36,0.25)) drop-shadow(3px 3px 0 #000);
  }

  .ss-char-name {
    font-size: clamp(1.3rem, 5vw, 1.8rem);
    font-weight: 900;
    margin: 6px 0 0;
    text-shadow: 0 0 8px currentColor, 2px 2px 0 #000;
    letter-spacing: 1px;
  }

  .ss-streak-lbl {
    font-size: 0.7rem;
    font-weight: 700;
    margin: 2px 0 0;
    color: #4ade80;
    text-shadow: 0 0 4px rgba(74,222,128,0.5), 1px 1px 0 #000;
    animation: ge-bounce-in 0.2s ease-out;
  }

  .ss-swipe-l { animation: ss-swipe-l 0.25s ease-in forwards; }
  .ss-swipe-r { animation: ss-swipe-r 0.25s ease-in forwards; }
  .ss-pixel-in { animation: ss-pixel-in 0.28s ease-out; }

  .ss-arena.ss-fb-ok {
    background: radial-gradient(circle at center, rgba(74,222,128,0.12) 0%, transparent 65%);
  }

  .ss-arena.ss-fb-ng {
    background: radial-gradient(circle at center, rgba(239,68,68,0.12) 0%, transparent 65%);
  }

  /* ── Ripples ── */
  .ss-ripple {
    position: absolute;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    pointer-events: none;
    animation: ss-ripple-out 0.45s ease-out forwards;
    z-index: 10;
    border: 3px solid;
  }

  .ss-ripple-ok { border-color: #4ade80; background: rgba(74,222,128,0.15); }
  .ss-ripple-ng { border-color: #ef4444; background: rgba(239,68,68,0.15); }

  /* ── Buttons ── */
  .ss-btn-row {
    display: flex;
    gap: 10px;
    padding: 6px 14px 12px;
    flex-shrink: 0;
  }

  .ss-btn {
    flex: 1;
    min-height: clamp(54px, 13vw, 72px);
    border: 3px solid #f97316;
    border-radius: 0;
    font-size: clamp(1rem, 3.5vw, 1.3rem);
    font-weight: 900;
    font-family: 'Courier New', monospace;
    cursor: pointer;
    transition: transform 0.06s, box-shadow 0.06s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    background: #1a1a2e;
    color: #f97316;
    text-shadow: 0 0 6px rgba(249,115,22,0.4), 1px 1px 0 #000;
    box-shadow: 4px 4px 0 #000;
    letter-spacing: 1px;
  }

  .ss-btn:active:not(:disabled) {
    transform: translate(2px, 2px);
    box-shadow: 2px 2px 0 #000;
  }

  .ss-btn:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .ss-retro.ss-fever-mode .ss-btn {
    border-color: #fbbf24;
    color: #fbbf24;
    box-shadow: 4px 4px 0 #000, 0 0 12px rgba(251,191,36,0.2);
  }

  /* ── Streak glow ── */
  .ss-retro.ss-glow {
    box-shadow: inset 0 0 40px rgba(249,115,22,0.08);
  }

  .ss-retro.ss-low-time {
    box-shadow: inset 0 0 40px rgba(239,68,68,0.1);
  }
`

// ─── Component ──────────────────────────────────────────────────────

function SpeedSortGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [combo, setCombo] = useState(0)
  const [currentCharacter, setCurrentCharacter] = useState<Character>(() => pickRandomCharacter())
  const [rule, setRule] = useState<SortRule>(() => generateRule())
  const [swipeDir, setSwipeDir] = useState<SortSide | null>(null)
  const [feedback, setFeedback] = useState<'ok' | 'ng' | null>(null)
  const [ruleFlash, setRuleFlash] = useState(false)
  const [isSpawning, setIsSpawning] = useState(false)
  const [sortCount, setSortCount] = useState(0)
  const [timeBonusActive, setTimeBonusActive] = useState(false)
  const [ripples, setRipples] = useState<Array<{ id: number; x: number; y: number; ok: boolean }>>([])
  const [justSpawned, setJustSpawned] = useState(true)
  const [isFever, setIsFever] = useState(false)
  const [streak, setStreak] = useState(0)
  const [scoreBounce, setScoreBounce] = useState(false)
  const [levelChanged, setLevelChanged] = useState(false)
  const [speedPopups, setSpeedPopups] = useState<Array<{ id: number; label: string; color: string; x: number; y: number }>>([])
  const [activePowerUp, setActivePowerUp] = useState<PowerUpKind | null>(null)
  const [powerUpExpiring, setPowerUpExpiring] = useState(false)
  const [ruleDanger, setRuleDanger] = useState(false)

  const effects = useGameEffects({ maxParticles: 60 })

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const comboRef = useRef(0)
  const streakRef = useRef(0)
  const ruleRef = useRef<SortRule>(rule)
  const charRef = useRef<Character>(currentCharacter)
  const finishedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const ruleSinceChangeRef = useRef(0)
  const lastSortAtRef = useRef(0)
  const swipeTimerRef = useRef<number | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)
  const spawnTimerRef = useRef<number | null>(null)
  const lowTimeSecRef = useRef<number | null>(null)
  const rippleIdRef = useRef(0)
  const speedPopIdRef = useRef(0)
  const prevLevelRef = useRef<string>(LEVELS[0].name)
  const audioRef = useRef<Record<string, HTMLAudioElement | null>>({})
  const powerUpTimerRef = useRef<number | null>(null)
  const charSpawnAtRef = useRef(performance.now())

  const clearTimer = (ref: { current: number | null }) => {
    if (ref.current !== null) { window.clearTimeout(ref.current); ref.current = null }
  }

  const play = useCallback((key: string, vol: number, rate = 1) => {
    const a = audioRef.current[key]
    if (!a) return
    a.currentTime = 0
    a.volume = Math.min(1, Math.max(0, vol))
    a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const addRipple = useCallback((x: number, y: number, ok: boolean) => {
    rippleIdRef.current += 1
    const id = rippleIdRef.current
    setRipples(prev => [...prev.slice(-5), { id, x, y, ok }])
    window.setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 450)
  }, [])

  const addSpeedPopup = useCallback((label: string, color: string, x: number, y: number) => {
    speedPopIdRef.current += 1
    const id = speedPopIdRef.current
    setSpeedPopups(prev => [...prev.slice(-3), { id, label, color, x, y }])
    window.setTimeout(() => setSpeedPopups(prev => prev.filter(p => p.id !== id)), 600)
  }, [])

  const spawnNext = useCallback((prevId: string) => {
    setIsSpawning(true)
    setJustSpawned(false)
    clearTimer(spawnTimerRef)
    spawnTimerRef.current = window.setTimeout(() => {
      spawnTimerRef.current = null
      const next = pickRandomCharacter(prevId)
      charRef.current = next
      setCurrentCharacter(next)
      setIsSpawning(false)
      setJustSpawned(true)
      charSpawnAtRef.current = performance.now()
    }, SPAWN_DELAY_MS)
  }, [])

  const changeRule = useCallback(() => {
    const nextRule = generateRule()
    ruleRef.current = nextRule
    setRule(nextRule)
    setRuleFlash(true)
    setRuleDanger(false)
    play('ruleChange', 0.5, 1.1)
    effects.triggerFlash('rgba(249,115,22,0.2)', 150)
    window.setTimeout(() => setRuleFlash(false), 600)
  }, [play, effects])

  const activatePowerUp = useCallback(() => {
    const kind = randomPowerUp()
    setActivePowerUp(kind)
    setPowerUpExpiring(false)
    play('powerup', 0.55, 1.1)
    effects.spawnParticles(5, 200, 200, [POWERUP_INFO[kind].emoji, '✨', '⚡'], 'emoji')
    addSpeedPopup(POWERUP_INFO[kind].label, POWERUP_INFO[kind].color, 200, 160)

    clearTimer(powerUpTimerRef)
    // Start expiring warning
    window.setTimeout(() => setPowerUpExpiring(true), POWERUP_DURATION_MS - 1000)
    powerUpTimerRef.current = window.setTimeout(() => {
      powerUpTimerRef.current = null
      setActivePowerUp(null)
      setPowerUpExpiring(false)
    }, POWERUP_DURATION_MS)
  }, [play, effects, addSpeedPopup])

  const endGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    clearTimer(swipeTimerRef); clearTimer(feedbackTimerRef); clearTimer(spawnTimerRef); clearTimer(powerUpTimerRef)
    effects.cleanup()
    play('gameOver', 0.64, 0.95)
    onFinish({ score: Math.max(0, scoreRef.current), durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current)) })
  }, [onFinish, play, effects])

  const handleSort = useCallback((side: SortSide) => {
    if (finishedRef.current || swipeDir !== null || isSpawning) return

    const ch = charRef.current
    const correct = getCorrectSide(ch.id, ruleRef.current)
    const ok = side === correct
    const now = performance.now()

    setSwipeDir(side)
    const rx = side === 'left' ? 80 : 320
    addRipple(rx, 200, ok)

    if (ok) {
      const dt = now - lastSortAtRef.current
      const nextCombo = dt <= COMBO_DECAY_WINDOW_MS ? comboRef.current + 1 : 1
      comboRef.current = nextCombo
      setCombo(nextCombo)

      const nextStreak = streakRef.current + 1
      streakRef.current = nextStreak
      setStreak(nextStreak)

      const enterFever = nextCombo >= FEVER_COMBO_THRESHOLD
      if (enterFever) setIsFever(true)

      // Speed bonus based on reaction time
      const reactionMs = now - charSpawnAtRef.current
      let speedExtra = 0
      let speedLabel = ''
      if (reactionMs <= SPEED_BONUS_INSTANT_MS) {
        speedExtra = SPEED_BONUS_INSTANT_EXTRA
        speedLabel = 'INSTANT!'
        play('speedBonus', 0.5, 1.4)
      } else if (reactionMs <= SPEED_BONUS_FAST_MS) {
        speedExtra = SPEED_BONUS_FAST_EXTRA
        speedLabel = 'FAST!'
        play('speedBonus', 0.4, 1.2)
      }
      if (speedLabel) {
        addSpeedPopup(speedLabel, '#22d3ee', side === 'left' ? 100 : 300, 180)
      }

      // Score calc
      const comboMul = 1 + Math.floor(nextCombo / COMBO_MULTIPLIER_STEP)
      const feverMul = enterFever ? FEVER_SCORE_MULTIPLIER : 1
      const doubleMul = activePowerUp === 'double' ? 2 : 1
      const magnetExtra = activePowerUp === 'magnet' ? 2 : 0
      const comboBonus = Math.floor(nextCombo / 5)
      const earned = ((CORRECT_SCORE + comboBonus + speedExtra + magnetExtra) * comboMul * feverMul * doubleMul)

      const prev = scoreRef.current
      const next = prev + earned
      scoreRef.current = next
      setScore(next)
      setScoreBounce(true)
      window.setTimeout(() => setScoreBounce(false), 200)

      // Level check
      const prevLvl = getLevel(prev)
      const nextLvl = getLevel(next)
      if (prevLvl.name !== nextLvl.name && prevLevelRef.current !== nextLvl.name) {
        prevLevelRef.current = nextLvl.name
        setLevelChanged(true)
        window.setTimeout(() => setLevelChanged(false), 400)
        play('levelup', 0.55, 1.0)
        effects.spawnParticles(8, 200, 50, ['🔥', '⚡', '💪', '🌟'], 'emoji')
        effects.triggerFlash('rgba(251,191,36,0.25)', 200)
        addSpeedPopup(`${nextLvl.name}!`, nextLvl.color, 200, 100)
      }

      // Time bonus
      if (nextCombo > 0 && nextCombo % COMBO_TIME_BONUS_THRESHOLD === 0) {
        const freeze = activePowerUp === 'freeze'
        const bonus = freeze ? COMBO_TIME_BONUS_MS * 2 : COMBO_TIME_BONUS_MS
        remainingMsRef.current = Math.min(ROUND_DURATION_MS, remainingMsRef.current + bonus)
        setRemainingMs(remainingMsRef.current)
        setTimeBonusActive(true)
        window.setTimeout(() => setTimeBonusActive(false), 600)
        play('timeBonus', 0.55)
        effects.showScorePopup(0, 200, 70, '#4ade80')
        effects.spawnParticles(6, 200, 70, ['⏱️', '💚', '✨'], 'emoji')
      }

      // Power-up chance
      if (activePowerUp === null && Math.random() < POWERUP_CHANCE && nextCombo >= 3) {
        activatePowerUp()
      }

      // Perfect streak
      if (nextStreak > 0 && nextStreak % 10 === 0) {
        play('perfect', 0.55, 1.1)
        effects.spawnParticles(10, 200, 200, ['🏆', '⭐', '💎', '🌟', '✨'], 'emoji')
        effects.triggerFlash('rgba(251,191,36,0.3)', 200)
        addSpeedPopup(`PERFECT x${nextStreak}!`, '#fbbf24', 200, 140)
      }

      setFeedback('ok')
      play('swipe', 0.35, 1 + nextCombo * 0.012)
      play('correct', 0.4, 1 + nextCombo * 0.015)
      if (nextCombo > 0 && nextCombo % 5 === 0) play('combo', 0.45, 0.9 + nextCombo * 0.01)

      effects.comboHitBurst(side === 'left' ? 100 : 300, 250, nextCombo, earned, [ch.emoji, '✨', '🔥', '⚡'])
      if (nextCombo >= 10) effects.spawnParticles(Math.min(6, Math.floor(nextCombo / 10)), 200, 250, ['🌟', '💫', '🔥'], 'emoji')
    } else {
      comboRef.current = 0
      streakRef.current = 0
      setCombo(0); setStreak(0); setIsFever(false)

      const next = scoreRef.current - WRONG_PENALTY
      scoreRef.current = next
      setScore(next)
      setFeedback('ng')

      play('wrong', 0.55, 0.8)
      play('danger', 0.3, 0.9)
      effects.triggerShake(10, 200)
      effects.triggerFlash('rgba(239,68,68,0.4)', 140)
      effects.spawnParticles(5, 200, 250, ['💢', '❌', '😵', '💥'], 'emoji')
      effects.showScorePopup(-WRONG_PENALTY, 200, 280, '#ef4444')
    }

    lastSortAtRef.current = now
    setSortCount(prev => prev + 1)

    clearTimer(feedbackTimerRef)
    feedbackTimerRef.current = window.setTimeout(() => { feedbackTimerRef.current = null; setFeedback(null) }, FEEDBACK_FLASH_DURATION_MS)

    clearTimer(swipeTimerRef)
    swipeTimerRef.current = window.setTimeout(() => {
      swipeTimerRef.current = null
      setSwipeDir(null)
      spawnNext(ch.id)
    }, SWIPE_ANIMATION_DURATION_MS)
  }, [swipeDir, isSpawning, play, spawnNext, addRipple, addSpeedPopup, effects, activePowerUp, activatePowerUp])

  // Touch swipe
  const touchRef = useRef<{ x: number; t: number } | null>(null)
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchRef.current = { x: e.touches[0].clientX, t: Date.now() }
  }, [])
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return
    const dx = e.changedTouches[0].clientX - touchRef.current.x
    const dt = Date.now() - touchRef.current.t
    touchRef.current = null
    if (Math.abs(dx) > 25 && dt < 500) handleSort(dx < 0 ? 'left' : 'right')
  }, [handleSort])

  // Init
  useEffect(() => {
    for (const c of CHARACTER_POOL) {
      const img = new Image(); img.src = c.imageSrc; void img.decode?.().catch(() => {})
    }
    const sfxMap: Record<string, string> = {
      swipe: swipeSfx, correct: correctSfx, wrong: wrongSfx, combo: comboSfx,
      ruleChange: ruleChangeSfx, timeBonus: timeBonusSfx, gameOver: gameOverHitSfx,
      levelup: levelupSfx, perfect: perfectSfx, danger: dangerSfx,
      powerup: powerupSfx, speedBonus: speedBonusSfx,
    }
    for (const [k, src] of Object.entries(sfxMap)) {
      const a = new Audio(src); a.preload = 'auto'; audioRef.current[k] = a
    }
    return () => {
      clearTimer(swipeTimerRef); clearTimer(feedbackTimerRef); clearTimer(spawnTimerRef); clearTimer(powerUpTimerRef)
      for (const k of Object.keys(audioRef.current)) audioRef.current[k] = null
    }
  }, [])

  // Keys
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); play('swipe', 0.4); onExit(); return }
      if (e.code === 'ArrowLeft') { e.preventDefault(); handleSort('left'); return }
      if (e.code === 'ArrowRight') { e.preventDefault(); handleSort('right') }
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [handleSort, onExit, play])

  // Game loop
  useEffect(() => {
    lastFrameRef.current = null
    ruleSinceChangeRef.current = 0

    const step = (now: number) => {
      if (finishedRef.current) { rafRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now

      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS)
      lastFrameRef.current = now

      // Freeze power-up slows time drain
      const timeDrain = activePowerUp === 'freeze' ? dt * 0.3 : dt
      remainingMsRef.current = Math.max(0, remainingMsRef.current - timeDrain)
      setRemainingMs(remainingMsRef.current)
      effects.updateParticles()

      const speedup = Math.floor(scoreRef.current / 10)
      const interval = Math.max(MIN_RULE_CHANGE_INTERVAL_MS, RULE_CHANGE_INTERVAL_MS - speedup * RULE_CHANGE_SPEEDUP_PER_10)
      ruleSinceChangeRef.current += dt

      // Rule danger warning at 80%
      const ruleProgress = ruleSinceChangeRef.current / interval
      if (ruleProgress >= 0.8 && ruleProgress < 1) {
        setRuleDanger(true)
      }

      if (ruleSinceChangeRef.current >= interval) {
        ruleSinceChangeRef.current = 0
        changeRule()
      }

      if (remainingMsRef.current > 0 && remainingMsRef.current <= LOW_TIME_THRESHOLD_MS) {
        const sec = Math.ceil(remainingMsRef.current / 1000)
        if (lowTimeSecRef.current !== sec) {
          lowTimeSecRef.current = sec
          play('danger', 0.2, 1.1 + (LOW_TIME_THRESHOLD_MS - remainingMsRef.current) / 8000)
        }
      } else {
        lowTimeSecRef.current = null
      }

      if (remainingMsRef.current <= 0) { endGame(); rafRef.current = null; return }
      rafRef.current = window.requestAnimationFrame(step)
    }

    rafRef.current = window.requestAnimationFrame(step)
    return () => {
      if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }
      lastFrameRef.current = null
    }
  }, [changeRule, endGame, play, effects, activePowerUp])

  // Derived
  const dScore = Math.max(0, score)
  const dBest = useMemo(() => Math.max(bestScore, dScore), [bestScore, dScore])
  const isLow = remainingMs <= LOW_TIME_THRESHOLD_MS
  const speedup = Math.floor(Math.max(0, score) / 10)
  const ruleInterval = Math.max(MIN_RULE_CHANGE_INTERVAL_MS, RULE_CHANGE_INTERVAL_MS - speedup * RULE_CHANGE_SPEEDUP_PER_10)
  const ruleProgress = Math.min(100, (ruleSinceChangeRef.current / ruleInterval) * 100)
  const comboMulD = 1 + Math.floor(combo / COMBO_MULTIPLIER_STEP)
  const timeP = (remainingMs / ROUND_DURATION_MS) * 100
  const lvl = getLevel(dScore)

  const charClass = swipeDir === 'left' ? 'ss-swipe-l' : swipeDir === 'right' ? 'ss-swipe-r' : justSpawned ? 'ss-pixel-in' : ''
  const fbClass = feedback === 'ok' ? 'ss-fb-ok' : feedback === 'ng' ? 'ss-fb-ng' : ''
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)

  const panelCls = [
    'mini-game-panel', 'ss-retro',
    isFever ? 'ss-fever-mode' : '',
    combo >= 10 ? 'ss-glow' : '',
    isLow ? 'ss-low-time' : '',
  ].filter(Boolean).join(' ')

  const puInfo = activePowerUp ? POWERUP_INFO[activePowerUp] : null

  return (
    <section
      className={panelCls}
      aria-label="speed-sort-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', '--lvl-color': lvl.color, ...effects.getShakeStyle() } as React.CSSProperties}
    >
      <style>{RETRO_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {ripples.map(r => (
        <div key={r.id} className={`ss-ripple ${r.ok ? 'ss-ripple-ok' : 'ss-ripple-ng'}`}
          style={{ left: `${r.x - 25}px`, top: `${r.y - 25}px` }} />
      ))}

      {speedPopups.map(p => (
        <span key={p.id} className="ss-speed-popup" style={{ left: `${p.x}px`, top: `${p.y}px`, color: p.color }}>
          {p.label}
        </span>
      ))}

      {/* HUD */}
      <div className="ss-hud">
        <div className="ss-score-col">
          <p className={`ss-score-val ${scoreBounce ? 'ss-score-bounce' : ''}`}>{dScore.toLocaleString()}</p>
          <p className="ss-hiscore">HI {dBest.toLocaleString()}</p>
        </div>
        <div className="ss-timer-col">
          <p className={`ss-time-val ${isLow ? 'ss-low' : ''}`}>{(remainingMs / 1000).toFixed(1)}s</p>
          <p className="ss-sorted-lbl">{sortCount} SORTED</p>
        </div>
      </div>

      {/* Time bar */}
      <div className="ss-bar-wrap">
        <div className="ss-bar-fill" style={{
          width: `${timeP}%`,
          background: timeBonusActive ? '#4ade80' : isLow ? '#ef4444' : isFever ? '#fbbf24' : lvl.color,
          boxShadow: `0 0 6px ${timeBonusActive ? '#4ade80' : isLow ? '#ef4444' : lvl.color}`,
        }} />
      </div>

      {/* Info row */}
      <div className="ss-info-row">
        <p className="ss-combo-lbl">COMBO <strong>{combo}</strong></p>
        {comboMulD > 1 && <p className="ss-mult-lbl">x{comboMulD}{isFever ? ' FEVER' : ''}</p>}
        <p className={`ss-lvl-badge ${levelChanged ? 'ss-lvl-change' : ''}`}
          style={{ borderColor: lvl.color, color: lvl.color, background: lvl.bg }}>
          {lvl.name}
        </p>
      </div>

      {comboLabel && <p className="ss-combo-big" style={{ color: comboColor }}>{comboLabel}</p>}
      {isFever && !comboLabel && <p className="ss-fever-lbl">FEVER MODE x{FEVER_SCORE_MULTIPLIER}</p>}

      {/* Power-up */}
      {puInfo && (
        <p className={`ss-powerup-banner ${powerUpExpiring ? 'ss-pu-expiring' : 'ss-pu-active'}`}
          style={{ color: puInfo.color }}>
          {puInfo.emoji} {puInfo.label} {puInfo.emoji}
        </p>
      )}

      {/* Rule */}
      <div className={`ss-rule-box ${ruleFlash ? 'ss-rule-flash' : ''} ${ruleDanger && !ruleFlash ? 'ss-rule-danger' : ''}`}>
        <div className="ss-rule-half ss-rule-left">
          <span className="ss-rule-arr">&larr;</span>
          <span>{rule.leftLabel}</span>
        </div>
        <div className="ss-rule-half">
          <span>{rule.rightLabel}</span>
          <span className="ss-rule-arr">&rarr;</span>
        </div>
      </div>

      <div className="ss-rule-bar">
        <div className="ss-rule-bar-fill" style={{ width: `${100 - ruleProgress}%` }} />
      </div>

      {/* Arena */}
      <div className={`ss-arena ${fbClass}`} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="ss-zone ss-zone-l" onClick={() => handleSort('left')}>
          <span className="ss-zone-arrow">&larr;</span>
        </div>

        <div className="ss-char-wrap">
          {!isSpawning && (
            <div className={`ss-char ${charClass}`}>
              <img className="ss-char-img" src={currentCharacter.imageSrc} alt={currentCharacter.name} />
              <p className="ss-char-name" style={{ color: currentCharacter.color }}>{currentCharacter.name}</p>
              {streak >= 3 && (
                <p className="ss-streak-lbl">
                  {streak >= 10 ? '🏆' : '🔥'} {streak} STREAK
                </p>
              )}
            </div>
          )}
        </div>

        <div className="ss-zone ss-zone-r" onClick={() => handleSort('right')}>
          <span className="ss-zone-arrow">&rarr;</span>
        </div>
      </div>

      {/* Buttons */}
      <div className="ss-btn-row">
        <button className="ss-btn" type="button" onClick={() => handleSort('left')}
          disabled={swipeDir !== null || isSpawning}>
          &larr; LEFT
        </button>
        <button className="ss-btn" type="button" onClick={() => handleSort('right')}
          disabled={swipeDir !== null || isSpawning}>
          RIGHT &rarr;
        </button>
      </div>
    </section>
  )
}

export const speedSortModule: MiniGameModule = {
  manifest: {
    id: 'speed-sort',
    title: 'Speed Sort',
    description: 'Sort characters left/right by rule, fast!',
    unlockCost: 45,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#f97316',
  },
  Component: SpeedSortGame,
}
