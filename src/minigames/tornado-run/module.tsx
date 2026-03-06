import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import seoTaijiSprite from '../../../assets/images/same-character/seo-taiji.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'
import {
  DIFFICULTY_STAGES,
  TORNADO_RUN_CHARACTER_BOTTOM,
  TORNADO_RUN_CHARACTER_SIZE,
  TORNADO_RUN_LANE_COUNT,
  pickHazardSpawnLanes,
  getDifficultyStage,
  getDifficultyStageIndex,
  getLaneCueStates,
  type TornadoRunDifficultyStage,
  type TornadoRunObstaclePreview,
  type TornadoRunObstacleType,
} from './gameplay'

import laneChangeSfx from '../../../assets/sounds/tornado-lane-change.mp3'
import coinCollectSfx from '../../../assets/sounds/tornado-coin-collect.mp3'
import crashSfx from '../../../assets/sounds/tornado-crash.mp3'
import shieldSfx from '../../../assets/sounds/tornado-shield.mp3'
import feverSfx from '../../../assets/sounds/tornado-fever.mp3'
import dodgeSfx from '../../../assets/sounds/tornado-dodge.mp3'
import shieldBreakSfx from '../../../assets/sounds/tornado-shield-break.mp3'
import magnetSfx from '../../../assets/sounds/tornado-magnet.mp3'
import speedUpSfx from '../../../assets/sounds/tornado-speed-up.mp3'
import windDashSfx from '../../../assets/sounds/tornado-wind-dash.mp3'
import slowmoSfx from '../../../assets/sounds/tornado-slowmo.mp3'
import windChainSfx from '../../../assets/sounds/tornado-wind-chain.mp3'
import coinRainSfx from '../../../assets/sounds/tornado-coin-rain.mp3'
import levelupSfx from '../../../assets/sounds/tornado-levelup.mp3'
import bgmSrc from '../../../assets/sounds/tornado-bgm.mp3'

// --- Layout ---
const LANE_COUNT = TORNADO_RUN_LANE_COUNT
const BOARD_WIDTH = 432
const LANE_WIDTH = BOARD_WIDTH / LANE_COUNT
const CHARACTER_SIZE = TORNADO_RUN_CHARACTER_SIZE
const CHARACTER_BOTTOM = TORNADO_RUN_CHARACTER_BOTTOM
// Visual sizes (for rendering)
const OBSTACLE_VIS = 48
const COIN_VIS = 40
const ITEM_VIS = 44
// Hitbox sizes (much smaller than visual for fair collision)
const OBSTACLE_HIT = 20
const COIN_HIT = 36       // coins generous
const ITEM_HIT = 40       // items generous

const START_SPEED = 140
const MAX_SPEED = 500
const ACCEL_PER_SECOND = 6
const COIN_SCORE = 10
const DISTANCE_SCORE_RATE = 2.5

const SPAWN_INTERVAL_BASE_MS = 1400
const SPAWN_INTERVAL_MIN_MS = 450
const SPAWN_INTERVAL_DECAY = 0.94

const PLAYER_HITBOX_SHRINK = 16
const ITEM_COLLECT_SIDE_PADDING = 16
const ITEM_COLLECT_TOP_PADDING = 12
const ITEM_COLLECT_BOTTOM_PADDING = 44
const ITEM_COLLECT_FOOT_GRACE_HEIGHT = 28
const ITEM_COLLECT_FOOT_GRACE_WIDTH = 12
const GAME_TIMEOUT_MS = 120000
const LIGHTNING_WARN_DURATION_MS = 850
const LIGHTNING_TOTAL_DURATION_MS = 1120

const SHIELD_SPAWN_CHANCE = 0.09
const SHIELD_DURATION_MS = 5000
const SCORE_ZONE_SPAWN_CHANCE = 0.06
const SCORE_ZONE_MULTIPLIER = 3
const SCORE_ZONE_DURATION_MS = 5000
const MAGNET_SPAWN_CHANCE = 0.06
const MAGNET_DURATION_MS = 5000
const MAGNET_PULL_RANGE = 200
const SLOWMO_SPAWN_CHANCE = 0.05
const SLOWMO_DURATION_MS = 3500
const SLOWMO_FACTOR = 0.4

const FEVER_COIN_THRESHOLD = 8
const FEVER_DURATION_MS = 7000
const FEVER_MULTIPLIER = 2
const DODGE_COMBO_DISTANCE = 60
const DODGE_COMBO_BONUS = 5
const WIND_CHAIN_THRESHOLD = 4
const WIND_STORM_SCORE = 80

const DASH_COOLDOWN_MS = 2000
const DASH_DURATION_MS = 350
const DASH_INVINCIBLE = true

const LEVEL_DISTANCE = 50
const COMBO_DECAY_MS = 3000
const COMBO_TIERS = [1, 1.2, 1.5, 2.0, 3.0]
function getComboMult(c: number) { return COMBO_TIERS[Math.min(c, COMBO_TIERS.length - 1)] }

type ObsType = TornadoRunObstacleType
interface Obs extends TornadoRunObstaclePreview { readonly id: number; readonly dodgeAwarded?: boolean }
const CHARACTER_SPRITES = [parkSangminSprite, kimYeonjaSprite, seoTaijiSprite]
const COLLECTIBLES: ObsType[] = ['coin', 'shield', 'score_zone', 'magnet', 'slowmo']
function isItem(t: ObsType) { return COLLECTIBLES.includes(t) }
function clampLane(l: number) { return Math.max(0, Math.min(LANE_COUNT - 1, l)) }
function laneX(l: number) { return l * LANE_WIDTH + LANE_WIDTH / 2 }
function overlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}
// Visual size (for rendering position)
function visSize(t: ObsType) {
  if (t === 'whirlwind' || t === 'lightning') return OBSTACLE_VIS
  if (t === 'dark_cloud') return OBSTACLE_VIS + 16
  if (t === 'gust') return OBSTACLE_VIS - 6
  if (t === 'coin') return COIN_VIS
  return ITEM_VIS
}
// Hitbox size (for collision)
function hitSize(t: ObsType) {
  if (t === 'gust') return 14
  if (t === 'dark_cloud') return 18
  if (t === 'lightning') return 18
  if (t === 'whirlwind') return OBSTACLE_HIT
  if (t === 'coin') return COIN_HIT
  return ITEM_HIT
}

// ── Pixel art via box-shadow (each "shadow" = 1 pixel block) ──
// Scale: 1 unit = 4px
const PX = 4
// Tornado (whirlwind) - purple swirl
const TORNADO_PIXELS: [number, number, string][] = [
  [4,1,'#818cf8'],[5,1,'#818cf8'],[6,1,'#818cf8'],
  [3,2,'#6366f1'],[7,2,'#a5b4fc'],
  [2,3,'#6366f1'],[8,3,'#818cf8'],
  [2,4,'#a5b4fc'],[8,4,'#6366f1'],
  [3,5,'#818cf8'],[7,5,'#6366f1'],
  [4,6,'#6366f1'],[5,6,'#a5b4fc'],[6,6,'#6366f1'],
  [3,7,'#818cf8'],[5,7,'#6366f1'],[7,7,'#818cf8'],
  [4,8,'#a5b4fc'],[5,8,'#818cf8'],[6,8,'#a5b4fc'],
  [5,9,'#6366f1'],
]
// Gust - gray wind lines
const GUST_PIXELS: [number, number, string][] = [
  [1,2,'#94a3b8'],[2,2,'#94a3b8'],[3,2,'#cbd5e1'],[4,2,'#94a3b8'],[5,2,'#94a3b8'],[6,2,'#94a3b8'],
  [2,4,'#64748b'],[3,4,'#94a3b8'],[4,4,'#94a3b8'],[5,4,'#64748b'],
  [0,6,'#94a3b8'],[1,6,'#cbd5e1'],[2,6,'#94a3b8'],[3,6,'#94a3b8'],[4,6,'#cbd5e1'],[5,6,'#94a3b8'],[6,6,'#94a3b8'],
]
// Dark cloud
const CLOUD_PIXELS: [number, number, string][] = [
  [3,1,'#374151'],[4,1,'#374151'],[5,1,'#374151'],[6,1,'#374151'],
  [2,2,'#4b5563'],[3,2,'#374151'],[4,2,'#1f2937'],[5,2,'#374151'],[6,2,'#4b5563'],[7,2,'#374151'],
  [1,3,'#374151'],[2,3,'#1f2937'],[3,3,'#374151'],[4,3,'#374151'],[5,3,'#1f2937'],[6,3,'#374151'],[7,3,'#1f2937'],[8,3,'#374151'],
  [1,4,'#4b5563'],[2,4,'#374151'],[3,4,'#4b5563'],[4,4,'#374151'],[5,4,'#4b5563'],[6,4,'#374151'],[7,4,'#4b5563'],[8,4,'#374151'],
  [2,5,'#6b7280'],[3,5,'#6b7280'],[6,5,'#6b7280'],[7,5,'#6b7280'],
]
// Coin
const COIN_PIXELS: [number, number, string][] = [
  [3,1,'#f59e0b'],[4,1,'#fbbf24'],[5,1,'#f59e0b'],
  [2,2,'#fbbf24'],[3,2,'#fde68a'],[4,2,'#fbbf24'],[5,2,'#f59e0b'],[6,2,'#d97706'],
  [2,3,'#fbbf24'],[3,3,'#fbbf24'],[4,3,'#92400e'],[5,3,'#fbbf24'],[6,3,'#d97706'],
  [2,4,'#f59e0b'],[3,4,'#fbbf24'],[4,4,'#92400e'],[5,4,'#f59e0b'],[6,4,'#d97706'],
  [2,5,'#d97706'],[3,5,'#f59e0b'],[4,5,'#fbbf24'],[5,5,'#d97706'],[6,5,'#92400e'],
  [3,6,'#d97706'],[4,6,'#f59e0b'],[5,6,'#d97706'],
]
// Shield
const SHIELD_PIXELS: [number, number, string][] = [
  [3,0,'#22d3ee'],[4,0,'#22d3ee'],[5,0,'#22d3ee'],
  [2,1,'#06b6d4'],[3,1,'#22d3ee'],[4,1,'#67e8f9'],[5,1,'#22d3ee'],[6,1,'#06b6d4'],
  [2,2,'#06b6d4'],[3,2,'#22d3ee'],[4,2,'#fff'],[5,2,'#22d3ee'],[6,2,'#06b6d4'],
  [2,3,'#0891b2'],[3,3,'#06b6d4'],[4,3,'#22d3ee'],[5,3,'#06b6d4'],[6,3,'#0891b2'],
  [3,4,'#0891b2'],[4,4,'#06b6d4'],[5,4,'#0891b2'],
  [4,5,'#0891b2'],
]
// Star (score zone)
const STAR_PIXELS: [number, number, string][] = [
  [4,0,'#fbbf24'],
  [3,1,'#fbbf24'],[4,1,'#fde68a'],[5,1,'#fbbf24'],
  [0,2,'#f59e0b'],[1,2,'#fbbf24'],[2,2,'#fbbf24'],[3,2,'#fde68a'],[4,2,'#fbbf24'],[5,2,'#fde68a'],[6,2,'#fbbf24'],[7,2,'#fbbf24'],[8,2,'#f59e0b'],
  [1,3,'#fbbf24'],[2,3,'#fde68a'],[3,3,'#fbbf24'],[4,3,'#fbbf24'],[5,3,'#fbbf24'],[6,3,'#fde68a'],[7,3,'#fbbf24'],
  [2,4,'#fbbf24'],[3,4,'#f59e0b'],[4,4,'#fbbf24'],[5,4,'#f59e0b'],[6,4,'#fbbf24'],
  [1,5,'#f59e0b'],[2,5,'#fbbf24'],[3,5,'#fbbf24'],[5,5,'#fbbf24'],[6,5,'#fbbf24'],[7,5,'#f59e0b'],
  [1,6,'#d97706'],[2,6,'#f59e0b'],[6,6,'#f59e0b'],[7,6,'#d97706'],
]
// Magnet
const MAGNET_PIXELS: [number, number, string][] = [
  [2,1,'#ef4444'],[3,1,'#ef4444'],[5,1,'#3b82f6'],[6,1,'#3b82f6'],
  [1,2,'#ef4444'],[2,2,'#fca5a5'],[5,2,'#93c5fd'],[6,2,'#3b82f6'],[7,2,'#3b82f6'],
  [1,3,'#ef4444'],[7,3,'#3b82f6'],
  [1,4,'#dc2626'],[7,4,'#2563eb'],
  [2,5,'#dc2626'],[3,5,'#dc2626'],[4,5,'#6b7280'],[5,5,'#2563eb'],[6,5,'#2563eb'],
]
// Hourglass (slowmo)
const SLOW_PIXELS: [number, number, string][] = [
  [1,0,'#a78bfa'],[2,0,'#a78bfa'],[3,0,'#a78bfa'],[4,0,'#a78bfa'],[5,0,'#a78bfa'],
  [2,1,'#c4b5fd'],[3,1,'#a78bfa'],[4,1,'#c4b5fd'],
  [3,2,'#7c3aed'],[4,2,'#7c3aed'],
  [2,3,'#a78bfa'],[3,3,'#c4b5fd'],[4,3,'#a78bfa'],
  [1,4,'#7c3aed'],[2,4,'#a78bfa'],[3,4,'#a78bfa'],[4,4,'#a78bfa'],[5,4,'#7c3aed'],
  [1,5,'#a78bfa'],[2,5,'#a78bfa'],[3,5,'#a78bfa'],[4,5,'#a78bfa'],[5,5,'#a78bfa'],
]
// Lightning bolt
const BOLT_PIXELS: [number, number, string][] = [
  [4,0,'#fbbf24'],[5,0,'#fde68a'],
  [3,1,'#fbbf24'],[4,1,'#fde68a'],
  [2,2,'#fbbf24'],[3,2,'#fde68a'],[4,2,'#fbbf24'],[5,2,'#fbbf24'],
  [4,3,'#fde68a'],[5,3,'#fbbf24'],
  [3,4,'#fbbf24'],[4,4,'#fde68a'],
  [2,5,'#fde68a'],[3,5,'#fbbf24'],
  [2,6,'#f59e0b'],
]

const PIXEL_MAP: Record<string, [number, number, string][]> = {
  whirlwind: TORNADO_PIXELS, gust: GUST_PIXELS, dark_cloud: CLOUD_PIXELS,
  lightning: BOLT_PIXELS, coin: COIN_PIXELS, shield: SHIELD_PIXELS,
  score_zone: STAR_PIXELS, magnet: MAGNET_PIXELS, slowmo: SLOW_PIXELS,
}

function PixelSprite({ type, size }: { type: ObsType; size: number }) {
  const pixels = PIXEL_MAP[type]
  if (!pixels || type === 'lightning_warn') {
    // Warning: flashing red X
    return <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ color: '#ef4444', fontSize: size * 0.6, fontWeight: 900, fontFamily: 'monospace' }}>!</span>
    </div>
  }
  const scale = size / (10 * PX) // normalize to ~10-unit grid
  return (
    <div style={{ width: size, height: size, position: 'relative', imageRendering: 'pixelated' }}>
      <div style={{
        position: 'absolute',
        width: PX * scale, height: PX * scale,
        boxShadow: pixels.map(([x, y, c]) => `${x * PX * scale}px ${y * PX * scale}px 0 0 ${c}`).join(','),
        imageRendering: 'pixelated',
      }} />
    </div>
  )
}

type ObstacleTone = 'danger' | 'reward' | 'item' | 'warning'

function createHazardObstacle(
  id: number,
  lane: number,
  boardHeight: number,
  spawnTime: number,
  difficulty: TornadoRunDifficultyStage,
): Obs {
  const roll = Math.random()

  if (roll < difficulty.lightningChance) {
    return {
      id,
      lane,
      y: boardHeight - CHARACTER_BOTTOM - 44,
      type: 'lightning_warn',
      spawnTime,
    }
  }

  if (roll < difficulty.lightningChance + difficulty.darkCloudChance) {
    return {
      id,
      lane,
      y: -visSize('dark_cloud'),
      type: 'dark_cloud',
      spawnTime,
    }
  }

  if (roll < difficulty.lightningChance + difficulty.darkCloudChance + difficulty.gustChance) {
    return {
      id,
      lane,
      y: -visSize('gust'),
      type: 'gust',
      spawnTime,
    }
  }

  return {
    id,
    lane,
    y: -OBSTACLE_VIS,
    type: 'whirlwind',
    spawnTime,
  }
}

function getObstacleTone(type: ObsType): ObstacleTone {
  if (type === 'lightning_warn') return 'warning'
  if (type === 'coin') return 'reward'
  if (isItem(type)) return 'item'
  return 'danger'
}

function getDeathReason(type: ObsType | null): string | null {
  if (type === null) return null
  if (type === 'lightning') return 'Missed the lightning'
  if (type === 'dark_cloud') return 'Hit the storm cloud'
  if (type === 'gust') return 'Caught by a gust'
  if (type === 'whirlwind') return 'Clipped the tornado'
  return 'Hit a hazard'
}

function TornadoRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects({ maxParticles: 60 })
  const { triggerShake, triggerFlash, comboHitBurst, updateParticles, cleanup } = effects
  const containerRef = useRef<HTMLDivElement>(null)

  const [currentLane, setCurrentLane] = useState(1)
  const [obstacles, setObstacles] = useState<Obs[]>([])
  const [score, setScore] = useState(0)
  const [coinCount, setCoinCount] = useState(0)
  const [distance, setDistance] = useState(0)
  const [speed, setSpeed] = useState(START_SPEED)
  const [gameOver, setGameOver] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [hasShield, setHasShield] = useState(false)
  const [shieldRemainingMs, setShieldRemainingMs] = useState(0)
  const [hasScoreZone, setHasScoreZone] = useState(false)
  const [scoreZoneRemainingMs, setScoreZoneRemainingMs] = useState(0)
  const [dodgeCombo, setDodgeCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [hasMagnet, setHasMagnet] = useState(false)
  const [magnetRemainingMs, setMagnetRemainingMs] = useState(0)
  const [hasSlowmo, setHasSlowmo] = useState(false)
  const [slowmoRemainingMs, setSlowmoRemainingMs] = useState(0)
  const [isDashing, setIsDashing] = useState(false)
  const [dashCooldown, setDashCooldown] = useState(0)
  const [level, setLevel] = useState(1)
  const [boardHeight, setBoardHeight] = useState(680)
  const [windStormActive, setWindStormActive] = useState(false)
  const [characterIdx, setCharacterIdx] = useState(0)
  const [screenShakeClass, setScreenShakeClass] = useState('')
  const [coinCombo, setCoinCombo] = useState(0)
  const [stageAnnouncement, setStageAnnouncement] = useState<string | null>(null)
  const [deathReason, setDeathReason] = useState<string | null>(null)

  const laneRef = useRef(1)
  const obstaclesRef = useRef<Obs[]>([])
  const scoreRef = useRef(0)
  const coinCountRef = useRef(0)
  const distanceRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animFrameRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number | null>(null)
  const nextIdRef = useRef(0)
  const spawnTimerRef = useRef(0)
  const spawnIntervalRef = useRef(SPAWN_INTERVAL_BASE_MS)
  const hasShieldRef = useRef(false)
  const shieldMsRef = useRef(0)
  const hasScoreZoneRef = useRef(false)
  const scoreZoneMsRef = useRef(0)
  const dodgeComboRef = useRef(0)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const hasMagnetRef = useRef(false)
  const magnetMsRef = useRef(0)
  const hasSlowmoRef = useRef(false)
  const slowmoMsRef = useRef(0)
  const isDashingRef = useRef(false)
  const dashTimerRef = useRef(0)
  const dashCooldownRef = useRef(0)
  const levelRef = useRef(1)
  const windChainRef = useRef(0)
  const coinComboRef = useRef(0)
  const lastCoinTimeRef = useRef(0)
  const difficultyStageIndexRef = useRef(0)
  const stageAnnouncementTimeoutRef = useRef<number | null>(null)
  const sfxRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const lastTapRef = useRef(0)

  const playSfx = useCallback((key: string, vol: number, rate = 1) => {
    const a = sfxRefs.current[key]; if (!a) return
    a.currentTime = 0; a.volume = Math.min(1, vol); a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])
  const finishRound = useCallback((endReason?: string) => {
    if (finishedRef.current) return; finishedRef.current = true; setGameOver(true)
    onFinish({
      score: scoreRef.current + Math.floor(distanceRef.current * DISTANCE_SCORE_RATE),
      durationMs: Math.max(1, Math.round(elapsedMsRef.current)),
      endReason,
    })
  }, [onFinish])
  const triggerDash = useCallback(() => {
    if (finishedRef.current || isDashingRef.current || dashCooldownRef.current > 0) return
    isDashingRef.current = true; dashTimerRef.current = DASH_DURATION_MS; dashCooldownRef.current = DASH_COOLDOWN_MS
    setIsDashing(true); playSfx('windDash', 0.5, 1.1); triggerFlash('rgba(34,211,238,0.3)')
  }, [playSfx, triggerFlash])
  const triggerWindStorm = useCallback(() => {
    setWindStormActive(true); playSfx('windChain', 0.6, 1); triggerShake(12); triggerFlash('rgba(59,130,246,0.5)')
    const destroyed = obstaclesRef.current.filter(o => !isItem(o.type) && o.type !== 'lightning_warn')
    scoreRef.current += WIND_STORM_SCORE * destroyed.length; setScore(scoreRef.current)
    obstaclesRef.current = obstaclesRef.current.filter(o => isItem(o.type))
    for (const o of destroyed) comboHitBurst(laneX(o.lane), o.y, destroyed.length, WIND_STORM_SCORE)
    setTimeout(() => setWindStormActive(false), 800)
  }, [playSfx, triggerShake, triggerFlash, comboHitBurst])
  const changeLane = useCallback((dir: -1 | 1) => {
    if (finishedRef.current) return
    const next = clampLane(laneRef.current + dir)
    if (next !== laneRef.current) { laneRef.current = next; setCurrentLane(next); playSfx('lane', 0.3, 1) }
  }, [playSfx])

  useEffect(() => {
    const measure = () => { if (containerRef.current) setBoardHeight(Math.max(360, containerRef.current.clientHeight - 240)) }
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => () => {
    if (stageAnnouncementTimeoutRef.current !== null) {
      window.clearTimeout(stageAnnouncementTimeoutRef.current)
      stageAnnouncementTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    const map: Record<string, string> = { lane: laneChangeSfx, coin: coinCollectSfx, crash: crashSfx, shield: shieldSfx, fever: feverSfx, dodge: dodgeSfx, shieldBreak: shieldBreakSfx, magnet: magnetSfx, speedUp: speedUpSfx, windDash: windDashSfx, slowmo: slowmoSfx, windChain: windChainSfx, coinRain: coinRainSfx, levelup: levelupSfx }
    const audios: HTMLAudioElement[] = []
    for (const [k, src] of Object.entries(map)) { const a = new Audio(src); a.preload = 'auto'; sfxRefs.current[k] = a; audios.push(a) }
    setCharacterIdx(Math.floor(Math.random() * CHARACTER_SPRITES.length))
    // BGM
    const bgm = new Audio(bgmSrc); bgm.loop = true; bgm.volume = 0.3
    void bgm.play().catch(() => {})
    return () => { bgm.pause(); bgm.currentTime = 0; for (const a of audios) { a.pause(); a.currentTime = 0 }; cleanup() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (e.code === 'ArrowLeft') { e.preventDefault(); changeLane(-1) }
      else if (e.code === 'ArrowRight') { e.preventDefault(); changeLane(1) }
      else if (e.code === 'ArrowUp' || e.code === 'Space') { e.preventDefault(); triggerDash() }
    }
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h)
  }, [changeLane, onExit, triggerDash])

  useEffect(() => {
    lastFrameRef.current = null
    const step = (now: number) => {
      if (finishedRef.current) { animFrameRef.current = null; return }
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_FRAME_DELTA_MS); lastFrameRef.current = now
      const ts = hasSlowmoRef.current ? SLOWMO_FACTOR : 1
      const gd = dt * ts
      elapsedMsRef.current += dt; setElapsedMs(elapsedMsRef.current)
      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) { finishRound(); return }

      const ut = (hr: {current:boolean}, mr: {current:number}, sh: (v:boolean)=>void, sm: (v:number)=>void) => {
        if (hr.current) { mr.current = Math.max(0, mr.current - dt); sm(mr.current); if (mr.current <= 0) { hr.current = false; sh(false) } }
      }
      ut(hasShieldRef, shieldMsRef, setHasShield, setShieldRemainingMs)
      ut(hasScoreZoneRef, scoreZoneMsRef, setHasScoreZone, setScoreZoneRemainingMs)
      ut(isFeverRef, feverMsRef, setIsFever, setFeverRemainingMs)
      ut(hasMagnetRef, magnetMsRef, setHasMagnet, setMagnetRemainingMs)
      ut(hasSlowmoRef, slowmoMsRef, setHasSlowmo, setSlowmoRemainingMs)
      if (isDashingRef.current) { dashTimerRef.current = Math.max(0, dashTimerRef.current - dt); if (dashTimerRef.current <= 0) { isDashingRef.current = false; setIsDashing(false) } }
      if (dashCooldownRef.current > 0) { dashCooldownRef.current = Math.max(0, dashCooldownRef.current - dt); setDashCooldown(dashCooldownRef.current) }
      if (coinComboRef.current > 0 && (elapsedMsRef.current - lastCoinTimeRef.current) > COMBO_DECAY_MS) { coinComboRef.current = 0; setCoinCombo(0) }

      const sec = elapsedMsRef.current / 1000
      let obs = [...obstaclesRef.current]
      const bh = boardHeight
      const ms = elapsedMsRef.current

      const totalBeforeMove = scoreRef.current + Math.floor(distanceRef.current * DISTANCE_SCORE_RATE)
      const difficultyBeforeMove = getDifficultyStage({
        score: totalBeforeMove,
        elapsedMs: ms,
        level: levelRef.current,
      })
      const spd = Math.min(MAX_SPEED, START_SPEED + sec * ACCEL_PER_SECOND) * difficultyBeforeMove.speedMult
      setSpeed(spd)
      const moved = spd * (gd / 1000)
      distanceRef.current += moved / 100; setDistance(distanceRef.current)

      const nl = Math.floor(distanceRef.current / LEVEL_DISTANCE) + 1
      if (nl > levelRef.current) {
        levelRef.current = nl; setLevel(nl); playSfx('levelup', 0.5, 1 + nl * 0.05)
        triggerFlash('rgba(250,204,21,0.3)'); setCharacterIdx(p => (p + 1) % CHARACTER_SPRITES.length)
      }

      const total = scoreRef.current + Math.floor(distanceRef.current * DISTANCE_SCORE_RATE)
      const difficulty = getDifficultyStage({
        score: total,
        elapsedMs: ms,
        level: levelRef.current,
      })
      const difficultyIndex = getDifficultyStageIndex(difficulty)
      if (difficultyIndex > difficultyStageIndexRef.current) {
        difficultyStageIndexRef.current = difficultyIndex
        playSfx('speedUp', 0.45, 1 + difficultyIndex * 0.04)
        triggerFlash('rgba(56,189,248,0.28)')
        setStageAnnouncement(difficulty.label)
        if (stageAnnouncementTimeoutRef.current !== null) {
          window.clearTimeout(stageAnnouncementTimeoutRef.current)
        }
        stageAnnouncementTimeoutRef.current = window.setTimeout(() => {
          setStageAnnouncement(null)
        }, 1100)
      }

      spawnTimerRef.current += gd
      const si = spawnIntervalRef.current * difficulty.spawnMult

      if (spawnTimerRef.current >= si) {
        spawnTimerRef.current = 0
        spawnIntervalRef.current = Math.max(SPAWN_INTERVAL_MIN_MS, spawnIntervalRef.current * SPAWN_INTERVAL_DECAY)
        if (Math.random() < difficulty.tornadoChance) {
          const desiredHazardCount = Math.random() < difficulty.multiChance ? 2 : 1
          const hazardLanes = pickHazardSpawnLanes(obs, bh, desiredHazardCount)
          for (const lane of hazardLanes) {
            obs.push(createHazardObstacle(nextIdRef.current++, lane, bh, ms, difficulty))
          }
        }
        if (isFeverRef.current && Math.random() < 0.8) { for (let l = 0; l < LANE_COUNT; l++) obs.push({ id: nextIdRef.current++, lane: l, y: -COIN_VIS - l * 20, type: 'coin', spawnTime: ms }) }
        else if (Math.random() < difficulty.coinChance) {
          const coinLane = Math.floor(Math.random() * LANE_COUNT)
          if (!obs.some(o => !isItem(o.type) && o.type !== 'coin' && o.lane === coinLane && o.y < OBSTACLE_VIS * 2)) {
            obs.push({ id: nextIdRef.current++, lane: coinLane, y: -COIN_VIS, type: 'coin', spawnTime: ms })
          }
        }
        if (Math.random() < SHIELD_SPAWN_CHANCE * difficulty.itemSpawnMult && !hasShieldRef.current) obs.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_VIS, type: 'shield', spawnTime: ms })
        if (Math.random() < SCORE_ZONE_SPAWN_CHANCE * difficulty.itemSpawnMult && !hasScoreZoneRef.current) obs.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_VIS, type: 'score_zone', spawnTime: ms })
        if (Math.random() < MAGNET_SPAWN_CHANCE * difficulty.itemSpawnMult && !hasMagnetRef.current) obs.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_VIS, type: 'magnet', spawnTime: ms })
        if (Math.random() < SLOWMO_SPAWN_CHANCE * difficulty.itemSpawnMult && !hasSlowmoRef.current) obs.push({ id: nextIdRef.current++, lane: Math.floor(Math.random() * LANE_COUNT), y: -ITEM_VIS, type: 'slowmo', spawnTime: ms })
      }

      obs = obs.map(o => { if (o.type === 'lightning_warn' && (ms - o.spawnTime) >= LIGHTNING_WARN_DURATION_MS) return { ...o, type: 'lightning' as ObsType }; return o })
      const pcx = laneX(laneRef.current)
      obs = obs.map(o => {
        if (o.type === 'lightning_warn' || o.type === 'lightning') return o
        const sm = o.type === 'gust' ? 1.6 : o.type === 'dark_cloud' ? 0.7 : 1
        if (o.type === 'coin' && hasMagnetRef.current) {
          const dx = pcx - laneX(o.lane), dy = (bh - CHARACTER_BOTTOM - CHARACTER_SIZE / 2) - o.y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < MAGNET_PULL_RANGE && d > 5) return { ...o, y: o.y + moved * sm + (dy / d) * 4 * (gd / 16.66) }
        }
        return { ...o, y: o.y + moved * sm }
      })

      // COLLISION — 2-pass: collect items FIRST, then check obstacles
      const px = laneX(laneRef.current) - CHARACTER_SIZE / 2 + PLAYER_HITBOX_SHRINK
      const py = bh - CHARACTER_BOTTOM - CHARACTER_SIZE + PLAYER_HITBOX_SHRINK
      const pw = CHARACTER_SIZE - PLAYER_HITBOX_SHRINK * 2
      const ph = CHARACTER_SIZE - PLAYER_HITBOX_SHRINK * 2

      const collectedIds = new Set<number>()

      // PASS 1: Collect all items/coins first (generous hitbox)
      for (const o of obs) {
        if (!isItem(o.type)) continue
        const vs = visSize(o.type)
        const hs = hitSize(o.type)
        const hoff = (vs - hs) / 2
        const ox = laneX(o.lane) - vs / 2 + hoff
        const oy = o.y + hoff
        const bodyCollect = overlap(
          px - ITEM_COLLECT_SIDE_PADDING,
          py - ITEM_COLLECT_TOP_PADDING,
          pw + ITEM_COLLECT_SIDE_PADDING * 2,
          ph + ITEM_COLLECT_TOP_PADDING + ITEM_COLLECT_BOTTOM_PADDING,
          ox,
          oy,
          hs,
          hs,
        )
        const footCollect = overlap(
          px - ITEM_COLLECT_SIDE_PADDING - ITEM_COLLECT_FOOT_GRACE_WIDTH,
          py + ph - 4,
          pw + (ITEM_COLLECT_SIDE_PADDING + ITEM_COLLECT_FOOT_GRACE_WIDTH) * 2,
          ITEM_COLLECT_FOOT_GRACE_HEIGHT,
          ox,
          oy,
          hs,
          hs,
        )
        if (!bodyCollect && !footCollect) continue
        collectedIds.add(o.id)
        if (o.type === 'coin') {
          coinComboRef.current = Math.min(coinComboRef.current + 1, COMBO_TIERS.length - 1)
          lastCoinTimeRef.current = elapsedMsRef.current; setCoinCombo(coinComboRef.current)
          const pts = Math.round(COIN_SCORE * getComboMult(coinComboRef.current) * (isFeverRef.current ? FEVER_MULTIPLIER : 1) * (hasScoreZoneRef.current ? SCORE_ZONE_MULTIPLIER : 1))
          scoreRef.current += pts; coinCountRef.current += 1; setScore(scoreRef.current); setCoinCount(coinCountRef.current)
          playSfx('coin', 0.45, 1 + coinCountRef.current * 0.012); comboHitBurst(laneX(o.lane), o.y, coinCountRef.current, pts)
          if (coinCountRef.current % FEVER_COIN_THRESHOLD === 0 && !isFeverRef.current) { isFeverRef.current = true; feverMsRef.current = FEVER_DURATION_MS; setIsFever(true); setFeverRemainingMs(FEVER_DURATION_MS); playSfx('fever', 0.6, 1); playSfx('coinRain', 0.4, 1); triggerFlash('rgba(249,115,22,0.4)') }
        } else if (o.type === 'shield') { hasShieldRef.current = true; shieldMsRef.current = SHIELD_DURATION_MS; setHasShield(true); setShieldRemainingMs(SHIELD_DURATION_MS); playSfx('shield', 0.5, 1); comboHitBurst(laneX(o.lane), o.y, 1, 0) }
        else if (o.type === 'score_zone') { hasScoreZoneRef.current = true; scoreZoneMsRef.current = SCORE_ZONE_DURATION_MS; setHasScoreZone(true); setScoreZoneRemainingMs(SCORE_ZONE_DURATION_MS); playSfx('coin', 0.5, 1.3); comboHitBurst(laneX(o.lane), o.y, 1, 0) }
        else if (o.type === 'magnet') { hasMagnetRef.current = true; magnetMsRef.current = MAGNET_DURATION_MS; setHasMagnet(true); setMagnetRemainingMs(MAGNET_DURATION_MS); playSfx('magnet', 0.5, 1); comboHitBurst(laneX(o.lane), o.y, 1, 0) }
        else if (o.type === 'slowmo') { hasSlowmoRef.current = true; slowmoMsRef.current = SLOWMO_DURATION_MS; setHasSlowmo(true); setSlowmoRemainingMs(SLOWMO_DURATION_MS); playSfx('slowmo', 0.5, 1); comboHitBurst(laneX(o.lane), o.y, 1, 0) }
      }

      // PASS 2: Check damaging obstacles (tight hitbox)
      let hit = false
      let hitType: ObsType | null = null
      const surv: Obs[] = []
      let dodgedCount = 0

      for (const o of obs) {
        if (collectedIds.has(o.id)) continue // already collected
        if ((o.type === 'lightning_warn' || o.type === 'lightning') && (ms - o.spawnTime) > LIGHTNING_TOTAL_DURATION_MS) continue

        let nextObstacle = o

        if (!isItem(o.type) && o.type !== 'lightning_warn') {
          const vs = visSize(o.type)
          const hs = hitSize(o.type)
          const hoff = (vs - hs) / 2
          const ox = laneX(o.lane) - vs / 2 + hoff
          const oy = o.y + hoff
          const col = overlap(px, py, pw, ph, ox, oy, hs, hs)

          if (col) {
            if (isDashingRef.current && DASH_INVINCIBLE) { scoreRef.current += 25; setScore(scoreRef.current); comboHitBurst(laneX(o.lane), o.y, 1, 25); playSfx('shieldBreak', 0.4, 1.2); continue }
            if (hasShieldRef.current) { hasShieldRef.current = false; shieldMsRef.current = 0; setHasShield(false); setShieldRemainingMs(0); playSfx('shieldBreak', 0.5, 0.9); triggerFlash('rgba(34,211,238,0.4)'); continue }
            hit = true; hitType = o.type; break
          }

          // Near-miss dodge detection
          if (!o.dodgeAwarded && o.y > py && o.y < py + DODGE_COMBO_DISTANCE) {
            const olx = laneX(o.lane)
            if (Math.abs(olx - pcx) < LANE_WIDTH * 1.2 && Math.abs(olx - pcx) > PLAYER_HITBOX_SHRINK) {
              dodgedCount += 1
              nextObstacle = { ...o, dodgeAwarded: true }
            }
          }
        }
        if (nextObstacle.y < bh + 60) surv.push(nextObstacle)
      }

      if (dodgedCount > 0) {
        dodgeComboRef.current += dodgedCount; windChainRef.current += dodgedCount; setDodgeCombo(dodgeComboRef.current)
        playSfx('dodge', 0.25, 1 + dodgeComboRef.current * 0.04)
        if (dodgeComboRef.current % 3 === 0) { const b = DODGE_COMBO_BONUS * dodgeComboRef.current; scoreRef.current += b; setScore(scoreRef.current); comboHitBurst(pcx, py - 20, dodgeComboRef.current, b) }
        if (windChainRef.current >= WIND_CHAIN_THRESHOLD) { windChainRef.current = 0; triggerWindStorm() }
      }
      if (hit) {
        const endReason = getDeathReason(hitType)
        setDeathReason(endReason)
        playSfx('crash', 0.7, 0.85); triggerShake(12); triggerFlash('rgba(239,68,68,0.6)'); setScreenShakeClass('tr-death-shake'); setTimeout(() => setScreenShakeClass(''), 500); obstaclesRef.current = obs; setObstacles(obs); finishRound(endReason ?? undefined); return
      }
      obstaclesRef.current = surv; setObstacles(surv); updateParticles()
      animFrameRef.current = window.requestAnimationFrame(step)
    }
    animFrameRef.current = window.requestAnimationFrame(step)
    return () => { if (animFrameRef.current !== null) { window.cancelAnimationFrame(animFrameRef.current); animFrameRef.current = null }; lastFrameRef.current = null }
  }, [finishRound, playSfx, boardHeight, triggerWindStorm, triggerFlash, triggerShake, comboHitBurst, updateParticles])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) { const n = Date.now(); touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: n }; if (n - lastTapRef.current < 300) { triggerDash(); lastTapRef.current = 0 } else lastTapRef.current = n }
  }, [triggerDash])
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current || e.changedTouches.length === 0) return; const dx = e.changedTouches[0].clientX - touchStartRef.current.x; touchStartRef.current = null; if (Math.abs(dx) > 20) changeLane(dx > 0 ? 1 : -1)
  }, [changeLane])
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return; const r = e.currentTarget.getBoundingClientRect(); changeLane(e.clientX - r.left < r.width / 2 ? -1 : 1)
  }, [changeLane])

  const total = score + Math.floor(distance * DISTANCE_SCORE_RATE)
  const best = Math.max(bestScore, total)
  const tl = Math.max(0, Math.ceil((GAME_TIMEOUT_MS - elapsedMs) / 1000))
  const difficulty = getDifficultyStage({ score: total, elapsedMs, level })
  const difficultyIndex = getDifficultyStageIndex(difficulty)
  const difficultyMeterWidth = `${((difficultyIndex + 1) / DIFFICULTY_STAGES.length) * 100}%`
  const laneCues = getLaneCueStates(obstacles, boardHeight)

  return (
    <section ref={containerRef} className={`mini-game-panel tornado-run-panel ${screenShakeClass} ${hasSlowmo ? 'tr-slowmo' : ''}`}
      aria-label="tornado-run-game" style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />
      {windStormActive && <div className="tr-storm-ov" />}

      <div className="tr-board" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onPointerDown={handlePointerDown} role="presentation">
        <div className="tr-hud">
          <div className="tr-score">{total}</div>
          <div className="tr-sub"><span className="tr-best">BEST {best}</span><span className="tr-lv">Lv.{level}</span><span className="tr-time">{tl}s</span></div>
          <div className="tr-stage-row">
            <span className="tr-stage-name">{difficulty.label}</span>
            <div className="tr-stage-meter" aria-hidden="true"><span style={{ width: difficultyMeterWidth }} /></div>
          </div>
          <div className="tr-combo-row">
            {coinCombo > 0 && <span className="tr-combo">COMBO x{getComboMult(coinCombo).toFixed(1)}</span>}
            {difficultyIndex > 0 && <span className="tr-danger">DANGER{'!'.repeat(Math.min(difficultyIndex, 3))}</span>}
          </div>
          <div className="tr-guide" aria-label="tornado-run-guide">
            <span className="tr-guide-chip danger">RED = AVOID</span>
            <span className="tr-guide-chip reward">YELLOW = COINS</span>
            <span className="tr-guide-chip item">CYAN = ITEMS</span>
          </div>
          <div className="tr-pws">
            {hasShield && <span className="pw s">SHIELD {(shieldRemainingMs/1000).toFixed(1)}</span>}
            {hasScoreZone && <span className="pw z">x{SCORE_ZONE_MULTIPLIER} {(scoreZoneRemainingMs/1000).toFixed(1)}</span>}
            {isFever && <span className="pw f">FEVER {(feverRemainingMs/1000).toFixed(1)}</span>}
            {hasMagnet && <span className="pw m">MAGNET {(magnetRemainingMs/1000).toFixed(1)}</span>}
            {hasSlowmo && <span className="pw w">SLOW {(slowmoRemainingMs/1000).toFixed(1)}</span>}
            {dodgeCombo >= 3 && <span className="pw d">WIND x{dodgeCombo}</span>}
          </div>
        </div>

        <button className={`tr-dash ${dashCooldown > 0 ? 'cd' : ''} ${isDashing ? 'act' : ''}`} type="button"
          onPointerDown={e => { e.stopPropagation(); triggerDash() }}>{isDashing ? 'GO!' : dashCooldown > 0 ? `${(dashCooldown/1000).toFixed(1)}` : 'DASH'}</button>

        <div className="tr-field" style={{ width: BOARD_WIDTH, height: boardHeight }}>
          <div className="tr-sky" />
          <div className="tr-ground" style={{ backgroundPositionY: `${(elapsedMs * speed) / 3000 % 48}px` }} />
          {stageAnnouncement && <div className="tr-stage-pop">{stageAnnouncement}</div>}
          {laneCues.map((cue) => (
            cue.kind === 'neutral'
              ? null
              : (
                <div
                  key={`cue-${cue.lane}`}
                  className={`tr-lane-cue ${cue.kind}`}
                  style={{ left: cue.lane * LANE_WIDTH, width: LANE_WIDTH, opacity: 0.14 + cue.intensity * 0.42 }}
                >
                  <span className="tr-lane-cue-label">{cue.label}</span>
                </div>
              )
          ))}
          {Array.from({ length: LANE_COUNT - 1 }, (_, i) => <div key={i} className="tr-lane" style={{ left: (i + 1) * LANE_WIDTH }} />)}
          {speed > 350 && <div className="tr-spd" style={{ opacity: Math.min(1, (speed - 350) / 200) }} />}
          {isFever && <div className="tr-fever-ov" />}

          {obstacles.map(o => {
            const vs = visSize(o.type)
            const cx = laneX(o.lane)
            const cls = o.type === 'whirlwind' ? 'spin' : o.type === 'gust' ? 'wobble' : o.type === 'coin' ? 'bounce' : isItem(o.type) ? 'float' : o.type === 'lightning_warn' ? 'warn' : o.type === 'lightning' ? 'zap' : ''
            const tone = getObstacleTone(o.type)
            return (
              <div key={o.id} className={`tr-o ${cls} ${tone}`} style={{ left: cx - vs / 2, top: o.y, width: vs, height: vs }}>
                <PixelSprite type={o.type} size={vs} />
              </div>
            )
          })}

          <div className={`tr-player ${hasShield ? 'sh' : ''} ${isDashing ? 'da' : ''}`}
            style={{ left: laneX(currentLane) - CHARACTER_SIZE / 2, bottom: CHARACTER_BOTTOM, width: CHARACTER_SIZE, height: CHARACTER_SIZE }}>
            <img src={CHARACTER_SPRITES[characterIdx]} alt="" className="tr-pimg" draggable={false} />
            {hasMagnet && <div className="tr-mag-aura" />}
          </div>

          {gameOver && (
            <div className="tr-go"><div className="tr-go-t">GAME OVER</div><div className="tr-go-s">{total}</div>
              {deathReason && <div className="tr-go-r">{deathReason}</div>}
              <div className="tr-go-d">{coinCount} coins | {distance.toFixed(0)}m | Lv.{level}</div></div>
          )}
        </div>

        <div className="tr-ctrls">
          <button className="tr-btn" type="button" onPointerDown={e => { e.stopPropagation(); changeLane(-1) }}>{'\u25C0'} LEFT</button>
          <button className="tr-btn" type="button" onPointerDown={e => { e.stopPropagation(); changeLane(1) }}>RIGHT {'\u25B6'}</button>
        </div>
      </div>
      <style>{CSS}</style>
    </section>
  )
}

const CSS = `
.tornado-run-panel{display:flex;flex-direction:column;width:100%;height:100%;background:#1a1a2e;color:#e2e8f0;font-family:'Press Start 2P','Courier New',monospace;overflow:hidden;user-select:none;touch-action:none;image-rendering:pixelated}
.tr-slowmo{filter:saturate(.7) brightness(1.1)}
.tr-board{display:flex;flex-direction:column;width:100%;height:100%;position:relative}
.tr-hud{padding:12px 14px 8px;z-index:10;flex-shrink:0;background:linear-gradient(180deg,rgba(2,6,23,.94),rgba(15,23,42,.78));text-align:center;border-bottom:1px solid rgba(148,163,184,.12)}
.tr-score{font-size:clamp(3rem,11vw,4.2rem);font-weight:900;color:#fbbf24;text-shadow:3px 3px 0 #92400e,0 0 20px rgba(251,191,36,.7);line-height:1}
.tr-sub{display:flex;justify-content:center;align-items:center;gap:12px;margin-top:6px}
.tr-best{font-size:11px;color:#94a3b8}
.tr-lv{background:#4ade80;color:#0f172a;font-size:11px;font-weight:900;padding:2px 8px;border-radius:4px}
.tr-time{font-size:14px;font-weight:700;color:#e2e8f0;background:rgba(71,85,105,.5);padding:2px 10px;border-radius:4px}
.tr-stage-row{display:flex;align-items:center;gap:8px;justify-content:center;margin-top:7px}
.tr-stage-name{font-size:10px;font-weight:900;color:#7dd3fc;letter-spacing:1px}
.tr-stage-meter{width:min(160px,48vw);height:10px;border-radius:999px;background:rgba(15,23,42,.95);border:2px solid rgba(56,189,248,.24);overflow:hidden;box-shadow:inset 0 1px 4px rgba(0,0,0,.35)}
.tr-stage-meter span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#38bdf8 0%,#60a5fa 45%,#fb7185 100%);box-shadow:0 0 12px rgba(96,165,250,.45)}
.tr-combo-row{display:flex;justify-content:center;gap:8px;margin-top:6px;min-height:16px}
.tr-combo{font-size:11px;font-weight:900;color:#fbbf24;background:rgba(251,191,36,.15);border:2px solid rgba(251,191,36,.4);padding:2px 8px;border-radius:4px}
.tr-danger{font-size:10px;font-weight:900;color:#f87171;background:rgba(239,68,68,.15);border:2px solid rgba(239,68,68,.4);padding:2px 8px;border-radius:4px}
.tr-guide{display:flex;justify-content:center;flex-wrap:wrap;gap:6px;margin-top:6px}
.tr-guide-chip{font-size:9px;font-weight:700;padding:3px 7px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(15,23,42,.72);box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
.tr-guide-chip.danger{color:#fca5a5;border-color:rgba(248,113,113,.45)}
.tr-guide-chip.reward{color:#fde68a;border-color:rgba(251,191,36,.45)}
.tr-guide-chip.item{color:#99f6e4;border-color:rgba(45,212,191,.4)}
.tr-dash{position:absolute;right:14px;top:52%;transform:translateY(-50%);width:60px;height:60px;border-radius:8px;background:linear-gradient(135deg,#22d3ee,#3b82f6);border:3px solid #1e3a5f;color:#fff;font-size:10px;font-weight:900;font-family:inherit;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:12;box-shadow:0 4px 0 #0f172a}
.tr-dash.cd{background:#475569;color:#94a3b8;font-size:12px}
.tr-dash.act{background:#fbbf24;color:#0f172a;transform:translateY(-50%) scale(1.1)}
.tr-pws{display:flex;flex-wrap:wrap;justify-content:center;gap:4px;margin-top:6px}
.pw{font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;border:2px solid}
.pw.s{color:#22d3ee;border-color:#22d3ee;background:rgba(34,211,238,.15)}
.pw.z{color:#fbbf24;border-color:#fbbf24;background:rgba(251,191,36,.15)}
.pw.f{color:#f97316;border-color:#f97316;background:rgba(249,115,22,.15)}
.pw.m{color:#f472b6;border-color:#f472b6;background:rgba(244,114,182,.15)}
.pw.w{color:#a78bfa;border-color:#a78bfa;background:rgba(167,139,250,.15)}
.pw.d{color:#4ade80;border-color:#4ade80;background:rgba(74,222,128,.15)}
.tr-field{position:relative;overflow:hidden;flex:1;margin:0 auto;border-left:3px solid #2d2d4e;border-right:3px solid #2d2d4e;background:#0b1224}
.tr-sky{position:absolute;inset:0;background:linear-gradient(180deg,#050816,#0f1b38 25%,#182848 58%,#24446d 100%);pointer-events:none}
.tr-ground{position:absolute;inset:0;background:repeating-linear-gradient(to bottom,transparent 0px,transparent 40px,rgba(148,163,184,.06) 40px,rgba(148,163,184,.06) 48px);pointer-events:none}
.tr-stage-pop{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:8;padding:6px 12px;border-radius:999px;background:rgba(8,15,30,.78);border:2px solid rgba(56,189,248,.45);color:#e0f2fe;font-size:11px;font-weight:900;letter-spacing:1px;box-shadow:0 0 18px rgba(56,189,248,.28);animation:trStagePop 1.1s ease-out forwards;pointer-events:none}
@keyframes trStagePop{0%{opacity:0;transform:translate(-50%,-10px) scale(.8)}20%{opacity:1;transform:translate(-50%,0) scale(1)}100%{opacity:0;transform:translate(-50%,6px) scale(1.04)}}
.tr-lane-cue{position:absolute;top:0;bottom:0;z-index:1;pointer-events:none;box-shadow:inset 0 0 0 1px transparent}
.tr-lane-cue-label{position:absolute;top:18px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:900;padding:3px 6px;border-radius:999px;background:rgba(15,23,42,.82);backdrop-filter:blur(2px);white-space:nowrap}
.tr-lane-cue.danger{background:linear-gradient(180deg,rgba(248,113,113,.2),transparent 45%,rgba(248,113,113,.12) 100%);box-shadow:inset 0 0 0 1px rgba(248,113,113,.18)}
.tr-lane-cue.danger .tr-lane-cue-label{color:#fecaca;border:1px solid rgba(248,113,113,.42)}
.tr-lane-cue.warning{background:linear-gradient(180deg,rgba(248,113,113,.24),rgba(253,224,71,.16) 40%,rgba(248,113,113,.18) 100%);box-shadow:inset 0 0 0 2px rgba(250,204,21,.2)}
.tr-lane-cue.warning .tr-lane-cue-label{color:#fef08a;border:1px solid rgba(250,204,21,.52)}
.tr-lane-cue.reward{background:linear-gradient(180deg,rgba(251,191,36,.18),transparent 45%,rgba(251,191,36,.1) 100%);box-shadow:inset 0 0 0 1px rgba(251,191,36,.15)}
.tr-lane-cue.reward .tr-lane-cue-label{color:#fde68a;border:1px solid rgba(251,191,36,.45)}
.tr-lane-cue.item{background:linear-gradient(180deg,rgba(45,212,191,.18),transparent 45%,rgba(34,211,238,.1) 100%);box-shadow:inset 0 0 0 1px rgba(45,212,191,.15)}
.tr-lane-cue.item .tr-lane-cue-label{color:#99f6e4;border:1px solid rgba(45,212,191,.42)}
.tr-lane{position:absolute;top:0;bottom:0;width:2px;background:repeating-linear-gradient(to bottom,transparent 0,transparent 16px,rgba(148,163,184,.12) 16px,rgba(148,163,184,.12) 32px);pointer-events:none;z-index:2}
.tr-spd{position:absolute;inset:0;background:repeating-linear-gradient(to bottom,transparent 0,transparent 40px,rgba(200,220,255,.04) 40px,rgba(200,220,255,.04) 42px);animation:trSpd .15s linear infinite;pointer-events:none;z-index:2}
@keyframes trSpd{to{transform:translateY(42px)}}
.tr-fever-ov{position:absolute;inset:0;background:radial-gradient(ellipse at center bottom,rgba(249,115,22,.12) 0%,transparent 70%);animation:trFev .5s ease-in-out infinite alternate;pointer-events:none;z-index:2}
@keyframes trFev{from{opacity:.3}to{opacity:1}}
.tr-storm-ov{position:absolute;inset:0;z-index:15;background:radial-gradient(circle at center,rgba(59,130,246,.3),rgba(34,211,238,.2) 40%,transparent 70%);animation:trStorm .8s ease-out forwards;pointer-events:none}
@keyframes trStorm{0%{transform:scale(0);opacity:0}30%{transform:scale(1.2);opacity:1}100%{transform:scale(2);opacity:0}}
.tr-o{position:absolute;z-index:4;display:flex;align-items:center;justify-content:center;image-rendering:pixelated}
.tr-o::before{content:'';position:absolute;inset:-6px;border-radius:18px;border:2px solid transparent;background:transparent}
.tr-o.danger::before{border-color:rgba(248,113,113,.48);background:radial-gradient(circle,rgba(127,29,29,.38) 0%,rgba(127,29,29,.12) 62%,transparent 100%);box-shadow:0 0 18px rgba(248,113,113,.18)}
.tr-o.warning::before{border-color:rgba(250,204,21,.56);background:radial-gradient(circle,rgba(239,68,68,.34) 0%,rgba(250,204,21,.12) 62%,transparent 100%);box-shadow:0 0 20px rgba(250,204,21,.22)}
.tr-o.reward::before{border-color:rgba(251,191,36,.52);background:radial-gradient(circle,rgba(245,158,11,.34) 0%,rgba(251,191,36,.12) 62%,transparent 100%);box-shadow:0 0 18px rgba(251,191,36,.2)}
.tr-o.item::before{border-color:rgba(45,212,191,.48);background:radial-gradient(circle,rgba(13,148,136,.34) 0%,rgba(45,212,191,.12) 62%,transparent 100%);box-shadow:0 0 18px rgba(45,212,191,.18)}
.spin{animation:trSpin .5s linear infinite}
.wobble{animation:trWob .3s ease-in-out infinite alternate}
.bounce{animation:trBounce .6s ease-in-out infinite alternate}
.float{animation:trFloat .5s ease-in-out infinite alternate}
.warn{animation:trWarn .12s linear infinite alternate}
.zap{animation:trZap .06s linear infinite alternate}
@keyframes trSpin{to{transform:rotate(360deg)}}
@keyframes trWob{from{transform:translateX(-3px)}to{transform:translateX(3px)}}
@keyframes trBounce{from{transform:translateY(0)}to{transform:translateY(-3px)}}
@keyframes trFloat{from{transform:translateY(0)}to{transform:translateY(-4px)}}
@keyframes trWarn{from{opacity:.3;transform:scale(.85)}to{opacity:1;transform:scale(1.15)}}
@keyframes trZap{from{opacity:.6}to{opacity:1}}
.tr-player{position:absolute;z-index:6;transition:left .1s ease-out;image-rendering:pixelated}
.tr-pimg{width:100%;height:100%;object-fit:contain;pointer-events:none;image-rendering:pixelated;filter:drop-shadow(0 4px 8px rgba(0,0,0,.7))}
.tr-player.sh{filter:drop-shadow(0 0 14px rgba(34,211,238,.8))}
.tr-player.sh::after{content:'';position:absolute;inset:-10px;border-radius:50%;border:3px solid rgba(34,211,238,.5);animation:trShP .5s ease-in-out infinite alternate}
.tr-player.da{animation:trDZ .3s ease-out;filter:drop-shadow(0 0 18px rgba(34,211,238,.9)) brightness(1.3)}
@keyframes trDZ{0%{transform:translateY(10px) scale(.9)}50%{transform:translateY(-15px) scale(1.15)}100%{transform:translateY(0) scale(1)}}
@keyframes trShP{from{opacity:.3;transform:scale(1)}to{opacity:.7;transform:scale(1.06)}}
.tr-mag-aura{position:absolute;inset:-20px;border-radius:50%;border:2px dashed rgba(244,114,182,.3);animation:trMag 2s linear infinite;pointer-events:none}
@keyframes trMag{to{transform:rotate(360deg)}}
.tr-go{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(10,10,30,.88);backdrop-filter:blur(4px);animation:trGoF .3s ease-out}
.tr-go-t{font-size:2.8rem;font-weight:900;color:#ef4444;text-shadow:3px 3px 0 #7f1d1d,0 0 20px rgba(239,68,68,.6);animation:trGoZ .4s ease-out}
.tr-go-s{font-size:3.5rem;font-weight:900;color:#fbbf24;text-shadow:3px 3px 0 #92400e;margin-top:12px}
.tr-go-r{margin-top:12px;font-size:12px;color:#fecaca;background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.35);padding:6px 10px;border-radius:999px}
.tr-go-d{font-size:13px;color:#94a3b8;margin-top:12px}
@keyframes trGoF{from{opacity:0}to{opacity:1}}
@keyframes trGoZ{from{transform:scale(2.5);opacity:0}to{transform:scale(1);opacity:1}}
.tr-death-shake{animation:trDS .4s ease-out}
@keyframes trDS{0%,100%{transform:translateX(0)}10%{transform:translateX(-8px) rotate(-1deg)}20%{transform:translateX(8px) rotate(1deg)}30%{transform:translateX(-6px)}40%{transform:translateX(6px)}}
.tr-ctrls{display:flex;gap:10px;padding:8px 12px 16px;z-index:10;flex-shrink:0;background:linear-gradient(180deg,rgba(9,14,28,.85),rgba(12,22,42,.96))}
.tr-btn{flex:1;height:80px;border:3px solid #3a3a5e;border-radius:10px;background:linear-gradient(180deg,#2d2d4e,#1a1a2e);color:#e2e8f0;font-size:16px;font-weight:800;letter-spacing:2px;cursor:pointer;box-shadow:0 5px 0 #0a0a1e,inset 0 1px 0 rgba(255,255,255,.1);transition:transform .06s;display:flex;align-items:center;justify-content:center;gap:6px;font-family:'Press Start 2P','Courier New',monospace}
.tr-btn:active{transform:translateY(4px);box-shadow:0 1px 0 #0a0a1e}
`

export const tornadoRunModule: MiniGameModule = {
  manifest: { id: 'tornado-run', title: 'Tornado Run', description: 'Dodge winds and collect coins!', unlockCost: 35, baseReward: 13, scoreRewardMultiplier: 1.15, accentColor: '#1a1a2e' },
  Component: TornadoRunGame,
}
