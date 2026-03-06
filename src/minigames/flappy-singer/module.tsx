import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import flapSfxUrl from '../../../assets/sounds/flappy-singer-flap.mp3'
import scoreSfxUrl from '../../../assets/sounds/flappy-singer-score.mp3'
import coinSfxUrl from '../../../assets/sounds/flappy-singer-coin.mp3'
import crashSfxUrl from '../../../assets/sounds/flappy-singer-crash.mp3'
import feverSfxUrl from '../../../assets/sounds/flappy-singer-fever.mp3'
import powerupSfxUrl from '../../../assets/sounds/flappy-singer-powerup.mp3'
import nearmissSfxUrl from '../../../assets/sounds/flappy-singer-nearmiss.mp3'
import milestoneSfxUrl from '../../../assets/sounds/flappy-singer-milestone.mp3'
import magnetSfxUrl from '../../../assets/sounds/flappy-singer-magnet.mp3'

// ─── Character Pool ─────────────────────────────────────────
const CHARACTER_SPRITES = [kimYeonjaSprite, parkSangminSprite, parkWankyuSprite, seoTaijiSprite]

// ─── Game Constants ──────────────────────────────────────────
const VIEWBOX_WIDTH = 288
const VIEWBOX_HEIGHT = 512

const GRAVITY = 0.0013
const FLAP_VELOCITY = -0.42
const MAX_FALL_VELOCITY = 0.55
const CHARACTER_X = 72
const CHARACTER_SIZE = 40
const CHARACTER_HITBOX_SHRINK = 7

const PIPE_WIDTH = 44
const PIPE_SPEED = 0.14
const PIPE_SPAWN_INTERVAL_MS = 1700
const INITIAL_GAP_HEIGHT = 145
const MIN_GAP_HEIGHT = 88
const GAP_SHRINK_PER_SCORE = 1.8
const PIPE_MIN_TOP = 55
const PIPE_CAP_HEIGHT = 12
const PIPE_CAP_OVERHANG = 4

const GROUND_HEIGHT = 40
const CEILING_Y = 0
const GAME_TIMEOUT_MS = 120000

const PIPE_SPEED_INCREASE_PER_SCORE = 0.003
const MAX_PIPE_SPEED = 0.30

const COIN_RADIUS = 9
const COIN_SCORE = 3
const COIN_SPAWN_CHANCE = 0.55

const MULTIPLIER_TRIGGER_INTERVAL = 10
const MULTIPLIER_DURATION = 5
const MULTIPLIER_VALUE = 2

// ─── Power-up constants ─────────────────────────────────────
const POWERUP_SPAWN_CHANCE = 0.18
const SHIELD_DURATION_MS = 6000
const MAGNET_DURATION_MS = 8000
const MAGNET_RANGE = 100
const POWERUP_SIZE = 18
const STAR_POWERUP_SCORE = 5

// ─── Near-miss ─────────────────────────────────────────────
const NEAR_MISS_THRESHOLD = 12
const NEAR_MISS_BONUS = 2

// ─── Moving pipe ────────────────────────────────────────────
const MOVING_PIPE_START_SCORE = 12
const MOVING_PIPE_CHANCE = 0.25
const MOVING_PIPE_SPEED = 0.03
const MOVING_PIPE_RANGE = 40

// ─── Milestone ──────────────────────────────────────────────
const MILESTONES = [10, 25, 50, 75, 100]

// ─── Time-of-day thresholds ─────────────────────────────────
const SUNSET_SCORE = 15
const NIGHT_SCORE = 30

// ─── Cloud/Star background ──────────────────────────────────
const CLOUDS = [
  { x: 30, y: 50, w: 55, h: 18, speed: 0.02 },
  { x: 150, y: 100, w: 45, h: 16, speed: 0.015 },
  { x: 240, y: 170, w: 60, h: 20, speed: 0.025 },
  { x: 80, y: 270, w: 50, h: 18, speed: 0.018 },
  { x: 200, y: 350, w: 52, h: 18, speed: 0.022 },
]

const STARS = Array.from({ length: 18 }, (_, i) => ({
  x: (i * 59 + 13) % VIEWBOX_WIDTH,
  y: (i * 41 + 19) % (VIEWBOX_HEIGHT - GROUND_HEIGHT - 80) + 16,
  r: 1 + (i % 3),
  twinkleSpeed: 1.5 + (i % 4) * 0.5,
}))

// ─── Types ──────────────────────────────────────────────────
type PowerUpType = 'shield' | 'magnet' | 'star'

interface Pipe {
  readonly id: number
  x: number
  readonly gapTop: number
  readonly gapBottom: number
  scored: boolean
  readonly moving: boolean
  readonly moveOffset: number
  movePhase: number
  nearMissAwarded: boolean
}

interface Coin {
  readonly id: number
  x: number
  y: number
  collected: boolean
}

interface PowerUp {
  readonly id: number
  x: number
  readonly y: number
  readonly type: PowerUpType
  collected: boolean
}

interface NoteTrail {
  readonly id: number
  x: number
  y: number
  opacity: number
  readonly note: string
}

interface SpeedLine {
  readonly id: number
  x: number
  readonly y: number
  readonly length: number
  opacity: number
}

// ─── Pure helpers ───────────────────────────────────────────
function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeGapHeight(score: number): number {
  return Math.max(MIN_GAP_HEIGHT, INITIAL_GAP_HEIGHT - score * GAP_SHRINK_PER_SCORE)
}

function createPipe(id: number, score: number): Pipe {
  const gapHeight = computeGapHeight(score)
  const maxGapTop = VIEWBOX_HEIGHT - GROUND_HEIGHT - gapHeight - PIPE_MIN_TOP
  const gapTop = PIPE_MIN_TOP + Math.random() * Math.max(0, maxGapTop - PIPE_MIN_TOP)
  const isMoving = score >= MOVING_PIPE_START_SCORE && Math.random() < MOVING_PIPE_CHANCE
  return {
    id, x: VIEWBOX_WIDTH + PIPE_WIDTH,
    gapTop, gapBottom: gapTop + gapHeight,
    scored: false,
    moving: isMoving,
    moveOffset: isMoving ? (Math.random() - 0.5) * 2 * MOVING_PIPE_RANGE : 0,
    movePhase: Math.random() * Math.PI * 2,
    nearMissAwarded: false,
  }
}

function checkCollision(characterY: number, pipes: Pipe[]): boolean {
  const charTop = characterY - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
  const charBottom = characterY + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK
  const charLeft = CHARACTER_X - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
  const charRight = CHARACTER_X + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK

  if (charTop <= CEILING_Y || charBottom >= VIEWBOX_HEIGHT - GROUND_HEIGHT) return true

  for (const pipe of pipes) {
    const pipeLeft = pipe.x
    const pipeRight = pipe.x + PIPE_WIDTH
    if (charRight > pipeLeft && charLeft < pipeRight) {
      const effectiveGapTop = pipe.gapTop + (pipe.moving ? pipe.moveOffset : 0)
      const effectiveGapBottom = pipe.gapBottom + (pipe.moving ? pipe.moveOffset : 0)
      if (charTop < effectiveGapTop || charBottom > effectiveGapBottom) return true
    }
  }
  return false
}

function checkNearMiss(characterY: number, pipe: Pipe): boolean {
  const effectiveGapTop = pipe.gapTop + (pipe.moving ? pipe.moveOffset : 0)
  const effectiveGapBottom = pipe.gapBottom + (pipe.moving ? pipe.moveOffset : 0)
  const charTop = characterY - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
  const charBottom = characterY + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK
  const distTop = charTop - effectiveGapTop
  const distBottom = effectiveGapBottom - charBottom
  return (distTop > 0 && distTop < NEAR_MISS_THRESHOLD) || (distBottom > 0 && distBottom < NEAR_MISS_THRESHOLD)
}

function getSkyColors(score: number): { top: string; bottom: string } {
  if (score >= NIGHT_SCORE) return { top: '#0f172a', bottom: '#1e293b' }
  if (score >= SUNSET_SCORE) return { top: '#f97316', bottom: '#fbbf24' }
  return { top: '#7dd3fc', bottom: '#bae6fd' }
}

function getPipeColor(score: number): string {
  if (score >= NIGHT_SCORE) return '#166534'
  if (score >= SUNSET_SCORE) return '#16a34a'
  return '#22c55e'
}

function getPipeCapColor(score: number): string {
  if (score >= NIGHT_SCORE) return '#14532d'
  if (score >= SUNSET_SCORE) return '#15803d'
  return '#16a34a'
}

function getPipeBorder(score: number): string {
  if (score >= NIGHT_SCORE) return '#052e16'
  if (score >= SUNSET_SCORE) return '#14532d'
  return '#15803d'
}

function getGroundColors(score: number): { top: string; bottom: string; line: string } {
  if (score >= NIGHT_SCORE) return { top: '#365314', bottom: '#1a2e05', line: '#1a2e05' }
  if (score >= SUNSET_SCORE) return { top: '#65a30d', bottom: '#4d7c0f', line: '#3f6212' }
  return { top: '#84cc16', bottom: '#65a30d', line: '#4d7c0f' }
}

const POWERUP_COLORS: Record<PowerUpType, string> = { shield: '#3b82f6', magnet: '#a855f7', star: '#fbbf24' }
const POWERUP_ICONS: Record<PowerUpType, string> = { shield: 'S', magnet: 'M', star: '*' }

function pickCharacterSprite(): string {
  return CHARACTER_SPRITES[Math.floor(Math.random() * CHARACTER_SPRITES.length)]
}

// ─── Game CSS ───────────────────────────────────────────────
const FLAPPY_CSS = `
.flappy-singer-panel {
  width: 100%;
  height: 100%;
  max-width: 432px;
  margin: 0 auto;
  overflow: hidden;
  position: relative;
  background: #000;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
.flappy-singer-board {
  position: relative;
  width: 100%;
  height: 100%;
}
.flappy-singer-svg {
  display: block;
  width: 100%;
  height: 100%;
}
.flappy-singer-hud {
  position: absolute;
  top: 10px;
  left: 0;
  right: 0;
  z-index: 10;
  pointer-events: none;
  text-align: center;
}
.flappy-singer-score {
  font-size: clamp(2.5rem, 10vw, 3.5rem);
  font-weight: 900;
  color: #fff;
  text-shadow: 3px 3px 0 #1f2937, -1px -1px 0 #1f2937, 1px -1px 0 #1f2937, -1px 1px 0 #1f2937;
  margin: 0;
  line-height: 1;
  font-family: monospace;
  image-rendering: pixelated;
}
.flappy-singer-best {
  font-size: clamp(0.6rem, 2.5vw, 0.8rem);
  color: #fbbf24;
  text-shadow: 1px 1px 0 #1f2937;
  margin: 2px 0 0;
  font-family: monospace;
}
.flappy-singer-powerup-bar {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-top: 4px;
}
.flappy-singer-powerup-indicator {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: clamp(0.55rem, 2vw, 0.7rem);
  font-weight: 800;
  font-family: monospace;
  color: #fff;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.5);
  animation: flappy-pulse 0.6s ease-in-out infinite alternate;
}
.flappy-singer-start-overlay, .flappy-singer-gameover-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 20;
  pointer-events: none;
}
.flappy-singer-start-text {
  font-size: clamp(1.6rem, 7vw, 2.2rem);
  font-weight: 900;
  color: #fff;
  text-shadow: 3px 3px 0 #1f2937;
  margin: 0;
  font-family: monospace;
  animation: flappy-bounce 1s ease-in-out infinite;
}
.flappy-singer-start-sub {
  font-size: clamp(0.6rem, 2.5vw, 0.8rem);
  color: #e2e8f0;
  text-shadow: 1px 1px 0 #1f2937;
  margin: 8px 0 0;
  font-family: monospace;
}
.flappy-singer-gameover-text {
  font-size: clamp(2rem, 9vw, 3rem);
  font-weight: 900;
  color: #ef4444;
  text-shadow: 3px 3px 0 #1f2937;
  margin: 0;
  font-family: monospace;
  animation: flappy-shake 0.4s ease-out;
}
.flappy-singer-gameover-score {
  font-size: clamp(1.2rem, 5vw, 1.6rem);
  font-weight: 700;
  color: #fbbf24;
  text-shadow: 2px 2px 0 #1f2937;
  margin: 8px 0 0;
  font-family: monospace;
}
.flappy-singer-overlay-actions {
  position: absolute;
  bottom: 14px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 10px;
  z-index: 20;
}
.flappy-singer-action-button {
  padding: 10px 20px;
  font-size: clamp(0.65rem, 2.5vw, 0.8rem);
  font-weight: 700;
  border: 2px solid #6b7280;
  border-radius: 6px;
  background: rgba(31,41,55,0.85);
  color: #f9fafb;
  cursor: pointer;
  box-shadow: 2px 2px 0 #374151;
  min-height: 44px;
  font-family: monospace;
}
.flappy-singer-action-button.ghost {
  background: rgba(31,41,55,0.5);
  border-color: #4b5563;
  color: #9ca3af;
}
.flappy-singer-multiplier {
  font-size: clamp(0.7rem, 3vw, 0.9rem);
  font-weight: 800;
  color: #fbbf24;
  text-shadow: 2px 2px 0 #1f2937;
  text-align: center;
  margin: 2px 0;
  font-family: monospace;
  animation: flappy-pulse 0.5s ease-in-out infinite alternate;
}
.flappy-singer-fever-border {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  border: 3px solid rgba(251,191,36,0.6);
  box-shadow: inset 0 0 30px rgba(251,191,36,0.15);
  animation: flappy-fever-glow 0.8s ease-in-out infinite alternate;
}
.flappy-singer-shield-border {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 5;
  border: 3px solid rgba(59,130,246,0.5);
  box-shadow: inset 0 0 20px rgba(59,130,246,0.12);
  animation: flappy-shield-glow 1s ease-in-out infinite alternate;
}
.flappy-singer-milestone-flash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: flappy-milestone-anim 1.2s ease-out forwards;
}
.flappy-singer-milestone-text {
  font-size: clamp(2rem, 8vw, 3rem);
  font-weight: 900;
  color: #fbbf24;
  text-shadow: 3px 3px 0 #92400e, 0 0 20px rgba(251,191,36,0.6);
  font-family: monospace;
}
.flappy-singer-nearmiss {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 15;
  font-size: clamp(0.8rem, 3vw, 1rem);
  font-weight: 900;
  color: #22d3ee;
  text-shadow: 2px 2px 0 #0e7490;
  font-family: monospace;
  animation: flappy-nearmiss 0.8s ease-out forwards;
}
@keyframes flappy-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
@keyframes flappy-shake {
  0% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(8px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
  100% { transform: translateX(0); }
}
@keyframes flappy-pulse {
  from { transform: scale(1); }
  to { transform: scale(1.08); }
}
@keyframes flappy-fever-glow {
  from { border-color: rgba(251,191,36,0.4); box-shadow: inset 0 0 20px rgba(251,191,36,0.1); }
  to { border-color: rgba(251,191,36,0.8); box-shadow: inset 0 0 40px rgba(251,191,36,0.25); }
}
@keyframes flappy-shield-glow {
  from { border-color: rgba(59,130,246,0.3); box-shadow: inset 0 0 15px rgba(59,130,246,0.08); }
  to { border-color: rgba(59,130,246,0.6); box-shadow: inset 0 0 25px rgba(59,130,246,0.18); }
}
@keyframes flappy-star-twinkle {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}
@keyframes flappy-milestone-anim {
  0% { opacity: 0; transform: scale(0.3); }
  30% { opacity: 1; transform: scale(1.15); }
  60% { transform: scale(0.95); }
  80% { transform: scale(1.02); }
  100% { opacity: 0; transform: scale(1) translateY(-20px); }
}
@keyframes flappy-nearmiss {
  0% { opacity: 1; transform: translate(-50%, -50%) scale(0.5); }
  40% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
  100% { opacity: 0; transform: translate(-50%, -80%) scale(0.8); }
}
@keyframes flappy-coin-spin {
  0%, 100% { transform: scaleX(1); }
  50% { transform: scaleX(0.3); }
}
`

// ─── Pixel art pipe rendering helpers ───────────────────────
function PixelPipe({ pipe, score, viewHeight, groundHeight }: {
  pipe: Pipe; score: number; viewHeight: number; groundHeight: number
}) {
  const pipeColor = getPipeColor(score)
  const capColor = getPipeCapColor(score)
  const border = getPipeBorder(score)
  const moveY = pipe.moving ? pipe.moveOffset : 0
  const gapTop = pipe.gapTop + moveY
  const gapBottom = pipe.gapBottom + moveY
  const isMoving = pipe.moving

  return (
    <g shapeRendering="crispEdges">
      {/* Top pipe body */}
      <rect x={pipe.x} y={0} width={PIPE_WIDTH} height={Math.max(0, gapTop)} fill={pipeColor} stroke={border} strokeWidth="1.5" />
      {/* Top pipe cap */}
      <rect x={pipe.x - PIPE_CAP_OVERHANG} y={gapTop - PIPE_CAP_HEIGHT} width={PIPE_WIDTH + PIPE_CAP_OVERHANG * 2} height={PIPE_CAP_HEIGHT} fill={capColor} stroke={border} strokeWidth="1.5" />
      {/* Pixel highlight on top pipe */}
      <rect x={pipe.x + 4} y={2} width={4} height={Math.max(0, gapTop - PIPE_CAP_HEIGHT - 4)} fill="rgba(255,255,255,0.18)" />
      <rect x={pipe.x + 10} y={2} width={2} height={Math.max(0, gapTop - PIPE_CAP_HEIGHT - 4)} fill="rgba(255,255,255,0.08)" />

      {/* Bottom pipe body */}
      <rect x={pipe.x} y={gapBottom} width={PIPE_WIDTH} height={Math.max(0, viewHeight - groundHeight - gapBottom)} fill={pipeColor} stroke={border} strokeWidth="1.5" />
      {/* Bottom pipe cap */}
      <rect x={pipe.x - PIPE_CAP_OVERHANG} y={gapBottom} width={PIPE_WIDTH + PIPE_CAP_OVERHANG * 2} height={PIPE_CAP_HEIGHT} fill={capColor} stroke={border} strokeWidth="1.5" />
      {/* Pixel highlight on bottom pipe */}
      <rect x={pipe.x + 4} y={gapBottom + PIPE_CAP_HEIGHT + 2} width={4} height={Math.max(0, viewHeight - groundHeight - gapBottom - PIPE_CAP_HEIGHT - 4)} fill="rgba(255,255,255,0.18)" />

      {/* Moving pipe indicator - pixel arrow markers */}
      {isMoving && (
        <>
          <rect x={pipe.x + PIPE_WIDTH / 2 - 3} y={gapTop - PIPE_CAP_HEIGHT - 6} width={6} height={3} fill="#fbbf24" opacity="0.7" />
          <rect x={pipe.x + PIPE_WIDTH / 2 - 3} y={gapBottom + PIPE_CAP_HEIGHT + 3} width={6} height={3} fill="#fbbf24" opacity="0.7" />
        </>
      )}
    </g>
  )
}

// ─── Component ──────────────────────────────────────────────
function FlappySingerGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [characterY, setCharacterY] = useState(VIEWBOX_HEIGHT / 2)
  const [velocity, setVelocity] = useState(0)
  const [pipes, setPipes] = useState<Pipe[]>([])
  const [coins, setCoins] = useState<Coin[]>([])
  const [powerUps, setPowerUps] = useState<PowerUp[]>([])
  const [gameStarted, setGameStarted] = useState(false)
  const [gameOver, setGameOver] = useState(false)
  const [, setElapsedMs] = useState(0)
  const [isMultiplierActive, setIsMultiplierActive] = useState(false)
  const [wingPhase, setWingPhase] = useState(0)
  const [cloudOffsets, setCloudOffsets] = useState(() => CLOUDS.map(() => 0))
  const [shieldActive, setShieldActive] = useState(false)
  const [magnetActive, setMagnetActive] = useState(false)
  const [noteTrails, setNoteTrails] = useState<NoteTrail[]>([])
  const [speedLines, setSpeedLines] = useState<SpeedLine[]>([])
  const [milestoneText, setMilestoneText] = useState<string | null>(null)
  const [nearMissShow, setNearMissShow] = useState(false)
  const [groundScrollX, setGroundScrollX] = useState(0)
  const [characterSprite] = useState(pickCharacterSprite)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const characterYRef = useRef(VIEWBOX_HEIGHT / 2)
  const velocityRef = useRef(0)
  const pipesRef = useRef<Pipe[]>([])
  const coinsRef = useRef<Coin[]>([])
  const powerUpsRef = useRef<PowerUp[]>([])
  const gameStartedRef = useRef(false)
  const finishedRef = useRef(false)
  const elapsedMsRef = useRef(0)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const timeSinceLastPipeRef = useRef(0)
  const nextPipeIdRef = useRef(0)
  const multiplierPipesLeftRef = useRef(0)
  const wingPhaseRef = useRef(0)
  const cloudOffsetsRef = useRef(CLOUDS.map(() => 0))
  const shieldEndRef = useRef(0)
  const magnetEndRef = useRef(0)
  const noteTrailsRef = useRef<NoteTrail[]>([])
  const speedLinesRef = useRef<SpeedLine[]>([])
  const nextTrailIdRef = useRef(0)
  const milestonesHitRef = useRef(new Set<number>())
  const nearMissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const groundScrollRef = useRef(0)

  const flapAudioRef = useRef<HTMLAudioElement | null>(null)
  const scoreAudioRef = useRef<HTMLAudioElement | null>(null)
  const coinAudioRef = useRef<HTMLAudioElement | null>(null)
  const crashAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const powerupAudioRef = useRef<HTMLAudioElement | null>(null)
  const nearmissAudioRef = useRef<HTMLAudioElement | null>(null)
  const milestoneAudioRef = useRef<HTMLAudioElement | null>(null)
  const magnetAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) return
    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const finishRound = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    effects.cleanup()
    const finalDurationMs = elapsedMsRef.current > 0 ? Math.round(elapsedMsRef.current) : Math.round(DEFAULT_FRAME_MS)
    onFinish({ score: scoreRef.current, durationMs: finalDurationMs })
  }, [onFinish, effects])

  const handleFlap = useCallback(() => {
    if (finishedRef.current) return
    if (!gameStartedRef.current) {
      gameStartedRef.current = true
      setGameStarted(true)
    }
    velocityRef.current = FLAP_VELOCITY
    setVelocity(FLAP_VELOCITY)
    playSfx(flapAudioRef.current, 0.45, 1.1)
    effects.spawnParticles(3, CHARACTER_X - 10, characterYRef.current + 20)

    // Spawn note trail
    const notes = ['♪', '♫', '♬', '♩']
    const trail: NoteTrail = {
      id: nextTrailIdRef.current++,
      x: CHARACTER_X + 15 + Math.random() * 10,
      y: characterYRef.current - 5 + Math.random() * 10,
      opacity: 1,
      note: notes[Math.floor(Math.random() * notes.length)],
    }
    noteTrailsRef.current = [...noteTrailsRef.current, trail].slice(-8)
    setNoteTrails([...noteTrailsRef.current])
  }, [playSfx, effects])

  const handleTap = useCallback((event: React.PointerEvent | React.MouseEvent) => {
    event.preventDefault()
    handleFlap()
  }, [handleFlap])

  const rotationDeg = useMemo(() => clampNumber(velocity * 120, -30, 70), [velocity])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return }
      if (event.code === 'Space' || event.code === 'ArrowUp') { event.preventDefault(); handleFlap() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleFlap, onExit])

  useEffect(() => {
    const audios: HTMLAudioElement[] = []
    const load = (url: string) => { const a = new Audio(url); a.preload = 'auto'; audios.push(a); return a }
    flapAudioRef.current = load(flapSfxUrl)
    scoreAudioRef.current = load(scoreSfxUrl)
    coinAudioRef.current = load(coinSfxUrl)
    crashAudioRef.current = load(crashSfxUrl)
    feverAudioRef.current = load(feverSfxUrl)
    powerupAudioRef.current = load(powerupSfxUrl)
    nearmissAudioRef.current = load(nearmissSfxUrl)
    milestoneAudioRef.current = load(milestoneSfxUrl)
    magnetAudioRef.current = load(magnetSfxUrl)
    return () => {
      effects.cleanup()
      for (const a of audios) { a.pause(); a.currentTime = 0 }
    }
  }, [])

  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now
      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now

      // Wing animation
      wingPhaseRef.current = (wingPhaseRef.current + deltaMs * 0.008) % (Math.PI * 2)
      setWingPhase(wingPhaseRef.current)

      // Cloud scroll
      const nextCloudOffsets = cloudOffsetsRef.current.map((offset, i) => {
        const newX = offset + CLOUDS[i].speed * deltaMs
        return newX > VIEWBOX_WIDTH + CLOUDS[i].w ? -CLOUDS[i].w : newX
      })
      cloudOffsetsRef.current = nextCloudOffsets
      setCloudOffsets([...nextCloudOffsets])

      if (!gameStartedRef.current) {
        animationFrameRef.current = window.requestAnimationFrame(step)
        return
      }

      elapsedMsRef.current += deltaMs
      setElapsedMs(elapsedMsRef.current)
      effects.updateParticles()

      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        setGameOver(true); finishRound(); animationFrameRef.current = null; return
      }

      // Physics
      const nextVelocity = Math.min(MAX_FALL_VELOCITY, velocityRef.current + GRAVITY * deltaMs)
      velocityRef.current = nextVelocity
      setVelocity(nextVelocity)

      const nextY = characterYRef.current + nextVelocity * deltaMs
      characterYRef.current = nextY
      setCharacterY(nextY)

      const currentPipeSpeed = Math.min(MAX_PIPE_SPEED, PIPE_SPEED + scoreRef.current * PIPE_SPEED_INCREASE_PER_SCORE)

      // Ground scroll
      groundScrollRef.current = (groundScrollRef.current + currentPipeSpeed * deltaMs) % 16
      setGroundScrollX(groundScrollRef.current)

      // Speed lines when fast
      if (currentPipeSpeed > 0.2 && Math.random() < 0.15) {
        const sl: SpeedLine = {
          id: nextTrailIdRef.current++,
          x: VIEWBOX_WIDTH,
          y: 20 + Math.random() * (VIEWBOX_HEIGHT - GROUND_HEIGHT - 40),
          length: 20 + Math.random() * 30,
          opacity: 0.4 + Math.random() * 0.3,
        }
        speedLinesRef.current = [...speedLinesRef.current, sl].slice(-6)
      }

      // Update speed lines
      const updatedSL = speedLinesRef.current
        .map(sl => ({ ...sl, x: sl.x - currentPipeSpeed * deltaMs * 2, opacity: sl.opacity - 0.008 }))
        .filter(sl => sl.opacity > 0 && sl.x + sl.length > 0)
      speedLinesRef.current = updatedSL
      setSpeedLines([...updatedSL])

      // Update note trails (fade and drift)
      const updatedTrails = noteTrailsRef.current
        .map(nt => ({ ...nt, x: nt.x + 0.3, y: nt.y - 0.5, opacity: nt.opacity - 0.015 }))
        .filter(nt => nt.opacity > 0)
      noteTrailsRef.current = updatedTrails
      setNoteTrails([...updatedTrails])

      // Check power-up timers
      if (shieldEndRef.current > 0 && now >= shieldEndRef.current) {
        shieldEndRef.current = 0
        setShieldActive(false)
      }
      if (magnetEndRef.current > 0 && now >= magnetEndRef.current) {
        magnetEndRef.current = 0
        setMagnetActive(false)
      }

      // Pipe spawning
      timeSinceLastPipeRef.current += deltaMs
      const nextPipes = [...pipesRef.current]
      const nextCoins = [...coinsRef.current]
      const nextPowerUps = [...powerUpsRef.current]

      if (timeSinceLastPipeRef.current >= PIPE_SPAWN_INTERVAL_MS) {
        timeSinceLastPipeRef.current -= PIPE_SPAWN_INTERVAL_MS
        const newPipe = createPipe(nextPipeIdRef.current, scoreRef.current)
        nextPipeIdRef.current += 1
        nextPipes.push(newPipe)

        if (Math.random() < COIN_SPAWN_CHANCE) {
          const coinY = newPipe.gapTop + (newPipe.gapBottom - newPipe.gapTop) / 2
          nextCoins.push({ id: nextPipeIdRef.current + 10000, x: newPipe.x + PIPE_WIDTH / 2, y: coinY, collected: false })
        }

        if (Math.random() < POWERUP_SPAWN_CHANCE) {
          const types: PowerUpType[] = ['shield', 'magnet', 'star']
          const puType = types[Math.floor(Math.random() * types.length)]
          const puY = newPipe.gapTop + (newPipe.gapBottom - newPipe.gapTop) * (0.3 + Math.random() * 0.4)
          nextPowerUps.push({ id: nextPipeIdRef.current + 20000, x: newPipe.x + PIPE_WIDTH + 30, y: puY, type: puType, collected: false })
        }
      }

      // Move pipes
      const movedDistance = currentPipeSpeed * deltaMs
      for (const pipe of nextPipes) {
        pipe.x -= movedDistance
        if (pipe.moving) {
          pipe.movePhase += MOVING_PIPE_SPEED * deltaMs
          pipe.moveOffset = Math.sin(pipe.movePhase) * MOVING_PIPE_RANGE
        }
      }
      for (const coin of nextCoins) coin.x -= movedDistance
      for (const pu of nextPowerUps) pu.x -= movedDistance

      // Magnet effect: attract coins
      if (magnetEndRef.current > 0) {
        for (const coin of nextCoins) {
          if (coin.collected) continue
          const dx = CHARACTER_X - coin.x
          const dy = characterYRef.current - coin.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < MAGNET_RANGE && dist > 5) {
            const pull = 0.12 * deltaMs / dist
            coin.x += dx * pull
            coin.y += dy * pull
          }
        }
      }

      // Score pipes
      let nextScore = scoreRef.current
      for (const pipe of nextPipes) {
        if (!pipe.scored && pipe.x + PIPE_WIDTH < CHARACTER_X) {
          pipe.scored = true

          // Near-miss check
          if (!pipe.nearMissAwarded && checkNearMiss(characterYRef.current, pipe)) {
            pipe.nearMissAwarded = true
            nextScore += NEAR_MISS_BONUS
            playSfx(nearmissAudioRef.current, 0.5, 1.2)
            effects.showScorePopup(NEAR_MISS_BONUS, CHARACTER_X, characterYRef.current - 30, '#22d3ee')
            setNearMissShow(true)
            if (nearMissTimerRef.current) clearTimeout(nearMissTimerRef.current)
            nearMissTimerRef.current = setTimeout(() => setNearMissShow(false), 800)
          }

          if (multiplierPipesLeftRef.current > 0) {
            multiplierPipesLeftRef.current -= 1
            nextScore += MULTIPLIER_VALUE
            if (multiplierPipesLeftRef.current <= 0) setIsMultiplierActive(false)
          } else {
            nextScore += 1
          }

          if (nextScore > 0 && nextScore % MULTIPLIER_TRIGGER_INTERVAL === 0 && multiplierPipesLeftRef.current <= 0) {
            multiplierPipesLeftRef.current = MULTIPLIER_DURATION
            setIsMultiplierActive(true)
            effects.triggerFlash('rgba(251,191,36,0.35)', 100)
            playSfx(feverAudioRef.current, 0.55, 1)
          }

          playSfx(scoreAudioRef.current, 0.45, 1 + nextScore * 0.012)
          const scoreDisplay = multiplierPipesLeftRef.current > 0 ? MULTIPLIER_VALUE : 1
          effects.comboHitBurst(CHARACTER_X + 25, characterYRef.current - 25, nextScore, scoreDisplay)
        }
      }

      // Coin collection
      const charTop = characterYRef.current - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
      const charBottom = characterYRef.current + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK
      const charLeft = CHARACTER_X - CHARACTER_SIZE / 2 + CHARACTER_HITBOX_SHRINK
      const charRight = CHARACTER_X + CHARACTER_SIZE / 2 - CHARACTER_HITBOX_SHRINK
      for (const coin of nextCoins) {
        if (coin.collected) continue
        if (coin.x + COIN_RADIUS > charLeft && coin.x - COIN_RADIUS < charRight &&
            coin.y + COIN_RADIUS > charTop && coin.y - COIN_RADIUS < charBottom) {
          coin.collected = true
          nextScore += COIN_SCORE
          playSfx(coinAudioRef.current, 0.5, 1.3)
          effects.showScorePopup(COIN_SCORE, CHARACTER_X + 15, characterYRef.current - 20, '#fbbf24')
          effects.spawnParticles(4, coin.x, coin.y)
        }
      }

      // Power-up collection
      for (const pu of nextPowerUps) {
        if (pu.collected) continue
        if (pu.x + POWERUP_SIZE > charLeft && pu.x - POWERUP_SIZE < charRight &&
            pu.y + POWERUP_SIZE > charTop && pu.y - POWERUP_SIZE < charBottom) {
          pu.collected = true
          playSfx(powerupAudioRef.current, 0.55, 1)
          effects.triggerFlash(POWERUP_COLORS[pu.type] + '40', 150)
          effects.spawnParticles(6, pu.x, pu.y)
          if (pu.type === 'shield') {
            shieldEndRef.current = now + SHIELD_DURATION_MS
            setShieldActive(true)
          } else if (pu.type === 'magnet') {
            magnetEndRef.current = now + MAGNET_DURATION_MS
            setMagnetActive(true)
            playSfx(magnetAudioRef.current, 0.4, 1)
          } else {
            nextScore += STAR_POWERUP_SCORE
            effects.showScorePopup(STAR_POWERUP_SCORE, pu.x, pu.y - 15, '#fbbf24')
          }
        }
      }

      // Milestone check
      for (const ms of MILESTONES) {
        if (nextScore >= ms && !milestonesHitRef.current.has(ms)) {
          milestonesHitRef.current.add(ms)
          playSfx(milestoneAudioRef.current, 0.6, 1)
          effects.triggerFlash('rgba(251,191,36,0.3)', 200)
          effects.triggerShake(8)
          setMilestoneText(`${ms} SCORE!`)
          setTimeout(() => setMilestoneText(null), 1200)
        }
      }

      // Filter offscreen
      const visiblePipes = nextPipes.filter(p => p.x + PIPE_WIDTH > -10)
      pipesRef.current = visiblePipes
      setPipes([...visiblePipes])

      const visibleCoins = nextCoins.filter(c => !c.collected && c.x + COIN_RADIUS > -10)
      coinsRef.current = visibleCoins
      setCoins([...visibleCoins])

      const visiblePU = nextPowerUps.filter(p => !p.collected && p.x + POWERUP_SIZE > -10)
      powerUpsRef.current = visiblePU
      setPowerUps([...visiblePU])

      if (nextScore !== scoreRef.current) {
        scoreRef.current = nextScore
        setScore(nextScore)
      }

      // Collision
      if (checkCollision(nextY, visiblePipes)) {
        if (shieldEndRef.current > 0) {
          // Shield absorbs hit
          shieldEndRef.current = 0
          setShieldActive(false)
          effects.triggerFlash('rgba(59,130,246,0.5)', 200)
          effects.triggerShake(6)
          playSfx(powerupAudioRef.current, 0.5, 0.8)
          // Bounce character away from danger
          velocityRef.current = FLAP_VELOCITY * 0.7
          setVelocity(FLAP_VELOCITY * 0.7)
        } else {
          setGameOver(true)
          playSfx(crashAudioRef.current, 0.65, 0.95)
          effects.triggerShake(14)
          effects.triggerFlash('rgba(239,68,68,0.5)')
          finishRound()
          animationFrameRef.current = null
          return
        }
      }

      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      lastFrameAtRef.current = null
      if (nearMissTimerRef.current) clearTimeout(nearMissTimerRef.current)
    }
  }, [finishRound, playSfx, effects])

  const displayedBestScore = Math.max(bestScore, score)
  const comboLabel = getComboLabel(score)
  const comboColor = getComboColor(score)
  const skyColors = getSkyColors(score)
  const groundColors = getGroundColors(score)
  const isNight = score >= NIGHT_SCORE
  const wingScale = 0.7 + Math.sin(wingPhase) * 0.3

  return (
    <section className="mini-game-panel flappy-singer-panel" aria-label="flappy-singer-game" style={effects.getShakeStyle()}>
      <style>{GAME_EFFECTS_CSS}{FLAPPY_CSS}</style>

      <div className="flappy-singer-board" onPointerDown={handleTap} role="presentation">
        <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
        <ParticleRenderer particles={effects.particles} />
        <ScorePopupRenderer popups={effects.scorePopups} />

        {isMultiplierActive && <div className="flappy-singer-fever-border" />}
        {shieldActive && <div className="flappy-singer-shield-border" />}
        {nearMissShow && <div className="flappy-singer-nearmiss">CLOSE!</div>}
        {milestoneText && (
          <div className="flappy-singer-milestone-flash">
            <span className="flappy-singer-milestone-text">{milestoneText}</span>
          </div>
        )}

        <svg
          className="flappy-singer-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          aria-label="flappy-singer-stage"
        >
          <defs>
            <linearGradient id="fs-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={skyColors.top} />
              <stop offset="100%" stopColor={skyColors.bottom} />
            </linearGradient>
            <linearGradient id="fs-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={groundColors.top} />
              <stop offset="100%" stopColor={groundColors.bottom} />
            </linearGradient>
            <radialGradient id="fs-coin-glow">
              <stop offset="0%" stopColor="#fde68a" />
              <stop offset="100%" stopColor="#fbbf24" />
            </radialGradient>
            <filter id="fs-glow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Sky */}
          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#fs-sky)" />

          {/* Stars (night) */}
          {isNight && STARS.map((star, i) => (
            <circle
              key={`star-${i}`}
              cx={star.x} cy={star.y} r={star.r}
              fill="#fde68a" opacity="0.7"
              style={{ animation: `flappy-star-twinkle ${star.twinkleSpeed}s ease-in-out infinite`, animationDelay: `${i * 0.15}s` }}
            />
          ))}

          {/* Clouds */}
          {CLOUDS.map((cloud, i) => {
            const cx = ((cloud.x + cloudOffsets[i]) % (VIEWBOX_WIDTH + cloud.w * 2)) - cloud.w
            return (
              <g key={`cloud-${i}`} opacity={isNight ? 0.15 : 0.65} shapeRendering="crispEdges">
                <rect x={cx - cloud.w / 2} y={cloud.y - cloud.h / 2} width={cloud.w} height={cloud.h} rx={4} fill="#fff" />
                <rect x={cx - cloud.w * 0.35} y={cloud.y - cloud.h * 0.3} width={cloud.w * 0.3} height={cloud.h * 0.5} rx={2} fill="#fff" />
                <rect x={cx + cloud.w * 0.1} y={cloud.y - cloud.h * 0.35} width={cloud.w * 0.35} height={cloud.h * 0.55} rx={2} fill="#fff" />
              </g>
            )
          })}

          {/* Speed lines */}
          {speedLines.map(sl => (
            <line key={sl.id} x1={sl.x} y1={sl.y} x2={sl.x + sl.length} y2={sl.y}
              stroke="#fff" strokeWidth="1.5" opacity={sl.opacity} />
          ))}

          {/* Note trails */}
          {noteTrails.map(nt => (
            <text key={nt.id} x={nt.x} y={nt.y} fontSize="12" fill="#fbbf24" opacity={nt.opacity}
              style={{ filter: 'url(#fs-glow)' }}>{nt.note}</text>
          ))}

          {/* Pipes */}
          {pipes.map(pipe => (
            <PixelPipe key={pipe.id} pipe={pipe} score={score} viewHeight={VIEWBOX_HEIGHT} groundHeight={GROUND_HEIGHT} />
          ))}

          {/* Coins */}
          {coins.map(coin => (
            <g key={`coin-${coin.id}`} style={{ animation: 'flappy-coin-spin 1.2s linear infinite' }}>
              <circle cx={coin.x} cy={coin.y} r={COIN_RADIUS + 4} fill="rgba(251,191,36,0.12)" />
              <circle cx={coin.x} cy={coin.y} r={COIN_RADIUS} fill="url(#fs-coin-glow)" stroke="#ca8a04" strokeWidth="1.5" />
              <rect x={coin.x - 2} y={coin.y - 3} width={3} height={3} fill="rgba(255,255,255,0.5)" />
              <text x={coin.x} y={coin.y + 1} textAnchor="middle" dominantBaseline="central" fontSize="7" fontWeight="900" fill="#92400e" fontFamily="monospace">$</text>
            </g>
          ))}

          {/* Power-ups */}
          {powerUps.map(pu => (
            <g key={`pu-${pu.id}`}>
              <rect x={pu.x - POWERUP_SIZE / 2 - 2} y={pu.y - POWERUP_SIZE / 2 - 2}
                width={POWERUP_SIZE + 4} height={POWERUP_SIZE + 4}
                fill={POWERUP_COLORS[pu.type]} opacity="0.2" rx={3} />
              <rect x={pu.x - POWERUP_SIZE / 2} y={pu.y - POWERUP_SIZE / 2}
                width={POWERUP_SIZE} height={POWERUP_SIZE}
                fill={POWERUP_COLORS[pu.type]} stroke="#fff" strokeWidth="1.5" rx={3}
                shapeRendering="crispEdges" />
              <text x={pu.x} y={pu.y + 1} textAnchor="middle" dominantBaseline="central"
                fontSize="10" fontWeight="900" fill="#fff" fontFamily="monospace">
                {POWERUP_ICONS[pu.type]}
              </text>
            </g>
          ))}

          {/* Ground - pixel art style with scrolling pattern */}
          <rect x="0" y={VIEWBOX_HEIGHT - GROUND_HEIGHT} width={VIEWBOX_WIDTH} height={GROUND_HEIGHT} fill="url(#fs-ground)" shapeRendering="crispEdges" />
          <line x1="0" y1={VIEWBOX_HEIGHT - GROUND_HEIGHT} x2={VIEWBOX_WIDTH} y2={VIEWBOX_HEIGHT - GROUND_HEIGHT} stroke={groundColors.line} strokeWidth="2" />
          {/* Scrolling ground pixels */}
          {Array.from({ length: 24 }, (_, i) => {
            const gx = ((i * 14 - groundScrollX) % (VIEWBOX_WIDTH + 14)) - 7
            return (
              <g key={`gp-${i}`} shapeRendering="crispEdges">
                <rect x={gx} y={VIEWBOX_HEIGHT - GROUND_HEIGHT - 2} width={6} height={4} fill={groundColors.top} opacity="0.6" />
                <rect x={gx + 2} y={VIEWBOX_HEIGHT - GROUND_HEIGHT + 8} width={4} height={4} fill={groundColors.line} opacity="0.3" />
              </g>
            )
          })}

          {/* Character */}
          <g transform={`translate(${CHARACTER_X}, ${characterY}) rotate(${rotationDeg})`}>
            {/* Shield glow */}
            {shieldActive && (
              <circle cx="0" cy="0" r={CHARACTER_SIZE / 2 + 6} fill="none" stroke="rgba(59,130,246,0.5)"
                strokeWidth="2" strokeDasharray="4 3" opacity="0.7">
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Magnet aura */}
            {magnetActive && (
              <circle cx="0" cy="0" r={CHARACTER_SIZE / 2 + 10} fill="none" stroke="rgba(168,85,247,0.35)"
                strokeWidth="1.5" strokeDasharray="3 5" opacity="0.6">
                <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="1.5s" repeatCount="indefinite" />
              </circle>
            )}

            {/* Shadow */}
            <ellipse cx="0" cy={CHARACTER_SIZE / 2 + 2} rx={CHARACTER_SIZE / 3} ry={3} fill="rgba(0,0,0,0.12)" />

            {/* Wings - pixel style */}
            <g transform={`translate(-${CHARACTER_SIZE / 2 - 3}, -3) scale(1, ${wingScale})`}>
              <rect x="-10" y="-6" width="4" height="6" fill="rgba(255,255,255,0.8)" shapeRendering="crispEdges" />
              <rect x="-6" y="-8" width="4" height="4" fill="rgba(255,255,255,0.6)" shapeRendering="crispEdges" />
            </g>
            <g transform={`translate(${CHARACTER_SIZE / 2 - 3}, -3) scale(1, ${wingScale})`}>
              <rect x="6" y="-6" width="4" height="6" fill="rgba(255,255,255,0.8)" shapeRendering="crispEdges" />
              <rect x="2" y="-8" width="4" height="4" fill="rgba(255,255,255,0.6)" shapeRendering="crispEdges" />
            </g>

            {/* Character image */}
            <image
              href={characterSprite}
              x={-CHARACTER_SIZE / 2}
              y={-CHARACTER_SIZE / 2}
              width={CHARACTER_SIZE}
              height={CHARACTER_SIZE}
              preserveAspectRatio="xMidYMid meet"
              style={{ imageRendering: 'pixelated' as any }}
            />

            {/* Musical notes when flapping */}
            {velocity < -0.2 && (
              <>
                <text x="16" y="-14" fontSize="10" fill="#fbbf24" opacity="0.8" style={{ filter: 'url(#fs-glow)' }}>&#9834;</text>
                <text x="-18" y="-10" fontSize="8" fill="#fb923c" opacity="0.6">&#9835;</text>
              </>
            )}
          </g>
        </svg>

        {/* HUD */}
        <div className="flappy-singer-hud">
          <p className="flappy-singer-score">{score}</p>
          <p className="flappy-singer-best">BEST {displayedBestScore}</p>
          {isMultiplierActive && (
            <p className="flappy-singer-multiplier">x{MULTIPLIER_VALUE} FEVER!</p>
          )}
          {comboLabel && (
            <p className="ge-combo-label" style={{ fontSize: 'clamp(0.7rem, 3vw, 1rem)', color: comboColor, textAlign: 'center', margin: '2px 0', textShadow: '1px 1px 0 #1f2937', fontFamily: 'monospace' }}>
              {comboLabel}
            </p>
          )}
          {/* Power-up indicators */}
          {(shieldActive || magnetActive) && (
            <div className="flappy-singer-powerup-bar">
              {shieldActive && (
                <span className="flappy-singer-powerup-indicator" style={{ background: 'rgba(59,130,246,0.7)' }}>SHIELD</span>
              )}
              {magnetActive && (
                <span className="flappy-singer-powerup-indicator" style={{ background: 'rgba(168,85,247,0.7)' }}>MAGNET</span>
              )}
            </div>
          )}
        </div>

        {/* Start overlay */}
        {!gameStarted && !gameOver && (
          <div className="flappy-singer-start-overlay">
            <p className="flappy-singer-start-text">TAP TO FLY!</p>
            <p className="flappy-singer-start-sub">Space / Tap to Flap</p>
          </div>
        )}

        {/* Game over overlay */}
        {gameOver && (
          <div className="flappy-singer-gameover-overlay">
            <p className="flappy-singer-gameover-text">GAME OVER</p>
            <p className="flappy-singer-gameover-score">Score: {score}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flappy-singer-overlay-actions">
          <button
            className="flappy-singer-action-button"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { playSfx(scoreAudioRef.current, 0.5, 1); finishRound() }}
          >
            FINISH
          </button>
          <button
            className="flappy-singer-action-button ghost"
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onExit}
          >
            EXIT
          </button>
        </div>
      </div>
    </section>
  )
}

export const flappySingerModule: MiniGameModule = {
  manifest: {
    id: 'flappy-singer',
    title: 'Flappy Singer',
    description: 'Tap to fly through pipes!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#0ea5e9',
  },
  Component: FlappySingerGame,
}
