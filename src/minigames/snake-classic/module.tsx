import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS, getComboLabel, getComboColor } from '../shared/game-effects'
import snakeEatSfx from '../../../assets/sounds/snake-eat.mp3'
import snakeGoldenSfx from '../../../assets/sounds/snake-golden.mp3'
import snakeComboSfx from '../../../assets/sounds/snake-combo.mp3'
import snakeCrashSfx from '../../../assets/sounds/snake-crash.mp3'
import snakeTurnSfx from '../../../assets/sounds/snake-turn.mp3'
import snakeSpeedUpSfx from '../../../assets/sounds/snake-speed-up.mp3'
import snakeWarpSfx from '../../../assets/sounds/snake-warp.mp3'
import snakePoisonSfx from '../../../assets/sounds/snake-poison.mp3'
import snakeFeverSfx from '../../../assets/sounds/snake-fever.mp3'
import snakeBombSfx from '../../../assets/sounds/snake-bomb.mp3'

// ── Grid & Snake constants ──
const GRID_SIZE = 18
const CELL_COUNT = GRID_SIZE * GRID_SIZE
const INITIAL_SNAKE_LENGTH = 3
const INITIAL_MOVE_INTERVAL_MS = 180
const MIN_MOVE_INTERVAL_MS = 55
const SPEED_INCREASE_THRESHOLD = 50
const SPEED_DECREASE_MS = 10
const SCORE_PER_APPLE = 10

// ── Apple variants ──
const GOLDEN_APPLE_INTERVAL = 8
const GOLDEN_APPLE_SCORE = 50
const POISON_APPLE_CHANCE = 0.15
const POISON_SHRINK = 2

// ── Wall wrap ──
const WALL_WRAP_SCORE_THRESHOLD = 100

// ── Power-ups ──
const SHIELD_SPAWN_CHANCE = 0.12
const SHIELD_DURATION_MS = 8000
const SPEED_RUSH_SPAWN_CHANCE = 0.08
const SPEED_RUSH_DURATION_MS = 5000
const BOMB_SPAWN_CHANCE = 0.06

// ── Combo / Fever ──
const COMBO_WINDOW_MS = 3500
const FEVER_COMBO_THRESHOLD = 5
const FEVER_DURATION_MS = 6000
const FEVER_SCORE_MULTIPLIER = 2

// ── Obstacles ──
const OBSTACLE_START_SCORE = 60
const MAX_OBSTACLES = 6

type Direction = 'up' | 'down' | 'left' | 'right'
type PowerUpType = 'shield' | 'speed-rush' | 'bomb'
type AppleType = 'normal' | 'golden' | 'poison'

interface Position { readonly x: number; readonly y: number }
interface PowerUp { readonly position: Position; readonly type: PowerUpType }

function posEq(a: Position, b: Position): boolean { return a.x === b.x && a.y === b.y }
function posIdx(p: Position): number { return p.y * GRID_SIZE + p.x }
function oob(p: Position): boolean { return p.x < 0 || p.x >= GRID_SIZE || p.y < 0 || p.y >= GRID_SIZE }

function move(p: Position, d: Direction): Position {
  switch (d) {
    case 'up': return { x: p.x, y: p.y - 1 }
    case 'down': return { x: p.x, y: p.y + 1 }
    case 'left': return { x: p.x - 1, y: p.y }
    case 'right': return { x: p.x + 1, y: p.y }
  }
}

function opposite(a: Direction, b: Direction): boolean {
  return (a === 'up' && b === 'down') || (a === 'down' && b === 'up') ||
    (a === 'left' && b === 'right') || (a === 'right' && b === 'left')
}

function makeSnake(): Position[] {
  const cx = Math.floor(GRID_SIZE / 2), cy = Math.floor(GRID_SIZE / 2)
  return Array.from({ length: INITIAL_SNAKE_LENGTH }, (_, i) => ({ x: cx, y: cy + i }))
}

function spawnFree(occupied: Set<number>): Position {
  const free: Position[] = []
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) {
    if (!occupied.has(posIdx({ x, y }))) free.push({ x, y })
  }
  return free.length > 0 ? free[Math.floor(Math.random() * free.length)] : { x: 0, y: 0 }
}

function allOccupied(snake: Position[], extras: Position[]): Set<number> {
  const s = new Set(snake.map(posIdx))
  for (const e of extras) s.add(posIdx(e))
  return s
}

function calcInterval(score: number, rush: boolean): number {
  const lvl = Math.floor(score / SPEED_INCREASE_THRESHOLD)
  const base = Math.max(MIN_MOVE_INTERVAL_MS, INITIAL_MOVE_INTERVAL_MS - lvl * SPEED_DECREASE_MS)
  return rush ? Math.max(MIN_MOVE_INTERVAL_MS, base * 0.55) : base
}

function calcSpeedLvl(score: number): number { return Math.floor(score / SPEED_INCREASE_THRESHOLD) + 1 }

function dirEmoji(d: Direction): string {
  return d === 'up' ? '▲' : d === 'down' ? '▼' : d === 'left' ? '◀' : '▶'
}

function generateObstacles(score: number, snake: Position[], apple: Position, extras: Position[]): Position[] {
  if (score < OBSTACLE_START_SCORE) return []
  const count = Math.min(MAX_OBSTACLES, Math.floor((score - OBSTACLE_START_SCORE) / 40) + 1)
  const occ = allOccupied(snake, [apple, ...extras])
  const obs: Position[] = []
  for (let i = 0; i < count; i++) {
    const p = spawnFree(occ)
    occ.add(posIdx(p))
    obs.push(p)
  }
  return obs
}

// ── Component ──
function SnakeClassicGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [snake, setSnake] = useState<Position[]>(makeSnake)
  const [apple, setApple] = useState<Position>(() => spawnFree(allOccupied(makeSnake(), [])))
  const [score, setScore] = useState(0)
  const [gameOver, setGameOver] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [appleType, setAppleType] = useState<AppleType>('normal')
  const [isWallWrap, setIsWallWrap] = useState(false)
  const [powerUp, setPowerUp] = useState<PowerUp | null>(null)
  const [hasShield, setHasShield] = useState(false)
  const [isSpeedRush, setIsSpeedRush] = useState(false)
  const [combo, setCombo] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [trail, setTrail] = useState<Position[]>([])
  const [bgHue, setBgHue] = useState(140)
  const [direction, setDirection] = useState<Direction>('up')
  const [obstacles, setObstacles] = useState<Position[]>([])
  const [maxCombo, setMaxCombo] = useState(0)

  const effects = useGameEffects()

  // Refs for game loop
  const snakeR = useRef(snake)
  const appleR = useRef(apple)
  const dirR = useRef<Direction>('up')
  const nextDirR = useRef<Direction>('up')
  const scoreR = useRef(0)
  const elapsedR = useRef(0)
  const overR = useRef(false)
  const doneR = useRef(false)
  const moveAccR = useRef(0)
  const rafR = useRef<number | null>(null)
  const lastFrameR = useRef<number | null>(null)
  const pupR = useRef<PowerUp | null>(null)
  const shieldR = useRef(false)
  const shieldExpR = useRef(0)
  const rushR = useRef(false)
  const rushExpR = useRef(0)
  const trailR = useRef<Position[]>([])
  const applesEatenR = useRef(0)
  const appleTypeR = useRef<AppleType>('normal')
  const comboR = useRef(0)
  const lastEatR = useRef(0)
  const feverR = useRef(false)
  const feverExpR = useRef(0)
  const obstaclesR = useRef<Position[]>([])
  const maxComboR = useRef(0)
  const wallWrapActiveR = useRef(false)

  const audioPool = useRef<Map<string, HTMLAudioElement>>(new Map())

  const loadAudio = useCallback((key: string, src: string) => {
    if (audioPool.current.has(key)) return
    const a = new Audio(src); a.preload = 'auto'; audioPool.current.set(key, a)
  }, [])

  const sfx = useCallback((key: string, vol: number, rate = 1) => {
    const a = audioPool.current.get(key)
    if (!a) return
    a.currentTime = 0; a.volume = Math.min(1, Math.max(0, vol)); a.playbackRate = rate
    void a.play().catch(() => {})
  }, [])

  const finish = useCallback(() => {
    if (doneR.current) return
    doneR.current = true
    effects.cleanup()
    onFinish({ score: scoreR.current, durationMs: Math.max(Math.round(elapsedR.current), Math.round(DEFAULT_FRAME_MS)) })
  }, [onFinish, effects])

  const changeDir = useCallback((nd: Direction) => {
    if (overR.current) return
    if (opposite(dirR.current, nd)) return
    if (nextDirR.current !== nd) {
      nextDirR.current = nd
      sfx('turn', 0.25, 1.1)
    }
  }, [sfx])

  // Keyboard
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.preventDefault(); onExit(); return }
      if (overR.current) return
      const map: Record<string, Direction> = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
      const d = map[e.code]
      if (d) { e.preventDefault(); changeDir(d) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [changeDir, onExit])

  // Audio init
  useEffect(() => {
    loadAudio('eat', snakeEatSfx); loadAudio('golden', snakeGoldenSfx)
    loadAudio('combo', snakeComboSfx); loadAudio('crash', snakeCrashSfx)
    loadAudio('turn', snakeTurnSfx); loadAudio('speedup', snakeSpeedUpSfx)
    loadAudio('warp', snakeWarpSfx); loadAudio('poison', snakePoisonSfx)
    loadAudio('fever', snakeFeverSfx); loadAudio('bomb', snakeBombSfx)
    return () => { effects.cleanup(); audioPool.current.forEach(a => { a.pause(); a.currentTime = 0 }) }
  }, [])

  // Game loop
  useEffect(() => {
    lastFrameR.current = null; moveAccR.current = 0

    const die = () => {
      overR.current = true; setGameOver(true)
      sfx('crash', 0.7, 0.9); effects.triggerShake(10); effects.triggerFlash('rgba(239,68,68,0.6)')
      finish(); rafR.current = null
    }

    const step = (now: number) => {
      if (overR.current) { rafR.current = null; return }
      if (lastFrameR.current === null) lastFrameR.current = now
      const dt = Math.min(now - lastFrameR.current, MAX_FRAME_DELTA_MS)
      lastFrameR.current = now; elapsedR.current += dt; setElapsedMs(elapsedR.current)
      effects.updateParticles()

      // Expiry checks
      if (shieldR.current && now > shieldExpR.current) { shieldR.current = false; setHasShield(false) }
      if (rushR.current && now > rushExpR.current) { rushR.current = false; setIsSpeedRush(false) }
      if (feverR.current && now > feverExpR.current) { feverR.current = false; setIsFever(false) }

      const interval = calcInterval(scoreR.current, rushR.current)
      moveAccR.current += dt
      if (moveAccR.current < interval) { rafR.current = requestAnimationFrame(step); return }
      moveAccR.current -= interval

      dirR.current = nextDirR.current; setDirection(dirR.current)
      const curSnake = snakeR.current
      const head = curSnake[0]
      let newHead = move(head, dirR.current)

      // Trail
      trailR.current = [head, ...trailR.current].slice(0, 8); setTrail(trailR.current)

      // Wall-wrap
      const wwActive = scoreR.current >= WALL_WRAP_SCORE_THRESHOLD
      if (wwActive !== wallWrapActiveR.current) { wallWrapActiveR.current = wwActive; setIsWallWrap(wwActive) }

      if (oob(newHead)) {
        if (wwActive) {
          newHead = { x: ((newHead.x % GRID_SIZE) + GRID_SIZE) % GRID_SIZE, y: ((newHead.y % GRID_SIZE) + GRID_SIZE) % GRID_SIZE }
          sfx('warp', 0.4, 1.0)
        } else if (shieldR.current) {
          shieldR.current = false; setHasShield(false)
          newHead = head
          effects.triggerFlash('rgba(59,130,246,0.4)'); effects.triggerShake(4)
        } else { die(); return }
      }

      // Obstacle collision
      const obstacleHit = obstaclesR.current.some(o => posEq(newHead, o))
      if (obstacleHit) {
        if (shieldR.current) {
          shieldR.current = false; setHasShield(false)
          newHead = head
          effects.triggerFlash('rgba(59,130,246,0.4)'); effects.triggerShake(4)
        } else { die(); return }
      }

      // Self collision
      const bodyHit = curSnake.some((seg, i) => i > 0 && posEq(newHead, seg))
      if (bodyHit) {
        if (shieldR.current) {
          shieldR.current = false; setHasShield(false)
          newHead = head
          effects.triggerFlash('rgba(59,130,246,0.4)'); effects.triggerShake(4)
        } else { die(); return }
      }

      // Apple eat
      const ateApple = posEq(newHead, appleR.current)
      let nextSnake: Position[]

      if (ateApple) {
        const ate = appleTypeR.current

        if (ate === 'poison') {
          // Poison: shrink snake
          nextSnake = curSnake.length > POISON_SHRINK + 1
            ? [newHead, ...curSnake.slice(0, -(POISON_SHRINK))]
            : [newHead]
          sfx('poison', 0.6, 1.0)
          effects.triggerFlash('rgba(168,85,247,0.4)')
          effects.triggerShake(4)
          // No score gain, but combo resets
          comboR.current = 0; setCombo(0)
        } else {
          nextSnake = [newHead, ...curSnake]
          applesEatenR.current += 1

          // Combo
          const timeSince = now - lastEatR.current
          if (timeSince < COMBO_WINDOW_MS && lastEatR.current > 0) { comboR.current += 1 } else { comboR.current = 1 }
          lastEatR.current = now; setCombo(comboR.current)
          if (comboR.current > maxComboR.current) { maxComboR.current = comboR.current; setMaxCombo(comboR.current) }

          // Fever mode trigger
          if (comboR.current >= FEVER_COMBO_THRESHOLD && !feverR.current) {
            feverR.current = true; feverExpR.current = now + FEVER_DURATION_MS; setIsFever(true)
            sfx('fever', 0.7, 1.0); effects.triggerFlash('rgba(251,191,36,0.3)')
          }

          // Score
          const comboMul = Math.min(comboR.current, 5)
          const basePts = ate === 'golden' ? GOLDEN_APPLE_SCORE : SCORE_PER_APPLE
          const feverMul = feverR.current ? FEVER_SCORE_MULTIPLIER : 1
          const appleScore = basePts * comboMul * feverMul
          const prevScore = scoreR.current
          scoreR.current += appleScore; setScore(scoreR.current)

          setBgHue(prev => (prev + 8) % 360)

          // Sound
          if (ate === 'golden') { sfx('golden', 0.7, 1.2) }
          else { sfx('eat', 0.5, 1 + Math.min(0.5, applesEatenR.current * 0.015)) }
          if (comboR.current >= 3) sfx('combo', 0.5, 0.9 + comboR.current * 0.08)
          if (calcSpeedLvl(scoreR.current) > calcSpeedLvl(prevScore)) sfx('speedup', 0.5, 1.0)

          // Effects
          const ex = newHead.x * (100 / GRID_SIZE) + (50 / GRID_SIZE)
          const ey = newHead.y * (100 / GRID_SIZE) + (50 / GRID_SIZE)
          effects.comboHitBurst(ex, ey, applesEatenR.current, appleScore)
        }

        // Spawn next apple
        const extras = pupR.current ? [pupR.current.position] : []
        const nextApple = spawnFree(allOccupied(nextSnake, [...extras, ...obstaclesR.current]))
        appleR.current = nextApple; setApple(nextApple)

        // Decide next apple type
        const nextIsGolden = applesEatenR.current % GOLDEN_APPLE_INTERVAL === (GOLDEN_APPLE_INTERVAL - 1)
        const nextIsPoisonRoll = !nextIsGolden && applesEatenR.current > 5 && Math.random() < POISON_APPLE_CHANCE
        const nextType: AppleType = nextIsGolden ? 'golden' : nextIsPoisonRoll ? 'poison' : 'normal'
        appleTypeR.current = nextType; setAppleType(nextType)

        // Spawn power-up
        if (!pupR.current && applesEatenR.current > 3) {
          const r = Math.random()
          let pType: PowerUpType | null = null
          if (r < SHIELD_SPAWN_CHANCE) pType = 'shield'
          else if (r < SHIELD_SPAWN_CHANCE + SPEED_RUSH_SPAWN_CHANCE) pType = 'speed-rush'
          else if (r < SHIELD_SPAWN_CHANCE + SPEED_RUSH_SPAWN_CHANCE + BOMB_SPAWN_CHANCE) pType = 'bomb'
          if (pType) {
            const pup: PowerUp = { position: spawnFree(allOccupied(nextSnake, [nextApple, ...obstaclesR.current])), type: pType }
            pupR.current = pup; setPowerUp(pup)
          }
        }

        // Regenerate obstacles
        if (scoreR.current >= OBSTACLE_START_SCORE) {
          const obs = generateObstacles(scoreR.current, nextSnake, nextApple, pupR.current ? [pupR.current.position] : [])
          obstaclesR.current = obs; setObstacles(obs)
        }

        if (nextSnake.length >= CELL_COUNT) { overR.current = true; setGameOver(true); finish(); rafR.current = null; return }
      } else {
        nextSnake = [newHead, ...curSnake.slice(0, -1)]
      }

      // Collect power-up
      if (pupR.current && posEq(newHead, pupR.current.position)) {
        const pt = pupR.current.type
        if (pt === 'shield') {
          shieldR.current = true; shieldExpR.current = now + SHIELD_DURATION_MS; setHasShield(true)
          effects.triggerFlash('rgba(59,130,246,0.3)'); sfx('golden', 0.5, 1.5)
        } else if (pt === 'speed-rush') {
          rushR.current = true; rushExpR.current = now + SPEED_RUSH_DURATION_MS; setIsSpeedRush(true)
          effects.triggerFlash('rgba(251,191,36,0.3)'); sfx('speedup', 0.6, 1.3)
        } else if (pt === 'bomb') {
          // Bomb: clear all obstacles
          obstaclesR.current = []; setObstacles([])
          effects.triggerFlash('rgba(249,115,22,0.4)'); effects.triggerShake(6); sfx('bomb', 0.7, 1.0)
          // Bonus score
          scoreR.current += 30; setScore(scoreR.current)
        }
        pupR.current = null; setPowerUp(null)
      }

      snakeR.current = nextSnake; setSnake(nextSnake)
      rafR.current = requestAnimationFrame(step)
    }

    rafR.current = requestAnimationFrame(step)
    return () => { if (rafR.current !== null) { cancelAnimationFrame(rafR.current); rafR.current = null }; lastFrameR.current = null }
  }, [finish, sfx, effects])

  // Computed render data
  const snakeSet = new Set(snake.map(posIdx))
  const headIdx = posIdx(snake[0])
  const appleIdx = posIdx(apple)
  const bestDisp = Math.max(bestScore, score)
  const spdLvl = calcSpeedLvl(score)
  const interval = calcInterval(score, isSpeedRush)
  const trailSet = new Set(trail.map(posIdx))
  const pupIdx = powerUp ? posIdx(powerUp.position) : -1
  const obsSet = new Set(obstacles.map(posIdx))
  const comboLabel = getComboLabel(combo)
  const comboColor = getComboColor(combo)
  const lengthPct = Math.min(100, (snake.length / (CELL_COUNT * 0.5)) * 100)

  const cells = []
  for (let y = 0; y < GRID_SIZE; y++) for (let x = 0; x < GRID_SIZE; x++) {
    const idx = posIdx({ x, y })
    let cls = 'sc-cell'
    if (idx === headIdx) cls += ' sc-head'
    else if (snakeSet.has(idx)) cls += ' sc-body'
    else if (idx === appleIdx) cls += appleType === 'golden' ? ' sc-golden' : appleType === 'poison' ? ' sc-poison' : ' sc-apple'
    else if (idx === pupIdx) cls += powerUp?.type === 'shield' ? ' sc-pup-shield' : powerUp?.type === 'bomb' ? ' sc-pup-bomb' : ' sc-pup-rush'
    else if (obsSet.has(idx)) cls += ' sc-obstacle'
    else if (trailSet.has(idx)) cls += ' sc-trail'
    cells.push(<div key={idx} className={cls} />)
  }

  // Swipe
  const touchIdR = useRef<number | null>(null)
  const touchStartR = useRef<{ x: number; y: number } | null>(null)
  const onTS = useCallback((e: React.TouchEvent) => {
    if (e.touches.length > 0) { const t = e.touches[0]; touchIdR.current = t.identifier; touchStartR.current = { x: t.clientX, y: t.clientY } }
  }, [])
  const onTE = useCallback((e: React.TouchEvent) => {
    if (!touchStartR.current || touchIdR.current === null) return
    let t: React.Touch | null = null
    for (let i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === touchIdR.current) { t = e.changedTouches[i]; break }
    if (!t) return
    const dx = t.clientX - touchStartR.current.x, dy = t.clientY - touchStartR.current.y
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) { touchIdR.current = null; touchStartR.current = null; return }
    changeDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
    touchIdR.current = null; touchStartR.current = null
  }, [changeDir])

  return (
    <section className="mini-game-panel sc-panel" aria-label="snake-classic-game"
      style={{ maxWidth: '432px', aspectRatio: '9/16', margin: '0 auto', overflow: 'hidden', position: 'relative', ...effects.getShakeStyle() }}>
      <style>{`
        ${GAME_EFFECTS_CSS}
        .sc-panel {
          display: flex; flex-direction: column; align-items: center; width: 100%; height: 100%;
          max-width: 432px; margin: 0 auto; user-select: none; -webkit-user-select: none;
          background: linear-gradient(180deg, hsl(${bgHue},15%,12%) 0%, hsl(${(bgHue + 20) % 360},12%,8%) 100%);
          transition: background 0.8s ease; padding: 4px 6px 6px; box-sizing: border-box;
        }
        ${isFever ? `.sc-panel { animation: sc-fever-bg 0.4s ease-in-out infinite alternate; }
        @keyframes sc-fever-bg { from { filter: brightness(1); } to { filter: brightness(1.15) saturate(1.3); } }` : ''}

        .sc-hud { display:flex; align-items:center; justify-content:space-between; width:100%; padding:2px 8px; flex-shrink:0; }
        .sc-hud-left { display:flex; flex-direction:column; align-items:flex-start; }
        .sc-score { font-size:2.4rem; font-weight:900; color:#22c55e; margin:0; line-height:1; text-shadow:0 0 12px rgba(34,197,94,0.5); }
        ${isFever ? `.sc-score { color:#fbbf24; text-shadow:0 0 16px rgba(251,191,36,0.7); animation:sc-fever-score 0.3s ease-in-out infinite alternate; }
        @keyframes sc-fever-score { from{transform:scale(1)} to{transform:scale(1.05)} }` : ''}
        .sc-best { font-size:0.65rem; color:#52525b; margin:0; }
        .sc-hud-right { display:flex; flex-direction:column; align-items:flex-end; gap:2px; }
        .sc-badge { font-size:0.6rem; font-weight:700; padding:1px 6px; border-radius:8px; color:#a1a1aa; background:rgba(255,255,255,0.06); }
        .sc-combo-badge { font-size:0.8rem; font-weight:900; padding:2px 8px; border-radius:10px; animation:sc-cpop 0.3s ease; }
        @keyframes sc-cpop { 0%{transform:scale(0.5);opacity:0} 60%{transform:scale(1.2)} 100%{transform:scale(1);opacity:1} }

        .sc-status { display:flex; gap:4px; justify-content:center; width:100%; flex-shrink:0; min-height:18px; flex-wrap:wrap; }
        .sc-pill { font-size:0.58rem; font-weight:800; padding:1px 7px; border-radius:10px; animation:sc-ppulse 1s ease-in-out infinite alternate; }
        @keyframes sc-ppulse { from{opacity:0.8} to{opacity:1;transform:scale(1.05)} }

        .sc-length-bar-wrap { width:100%; height:4px; background:rgba(255,255,255,0.06); border-radius:2px; flex-shrink:0; overflow:hidden; }
        .sc-length-bar { height:100%; border-radius:2px; transition:width 0.3s ease, background 0.3s; }

        .sc-grid-wrap { position:relative; width:100%; flex:1; min-height:0; touch-action:none; display:flex; align-items:center; justify-content:center; padding:3px 0; }
        .sc-grid-box { position:relative; width:100%; max-height:100%; aspect-ratio:1/1; }
        .sc-grid { display:grid; grid-template-columns:repeat(${GRID_SIZE},1fr); grid-template-rows:repeat(${GRID_SIZE},1fr);
          width:100%; height:100%; background:rgba(0,0,0,0.6); border:2px solid rgba(34,197,94,0.2); border-radius:8px; overflow:hidden; gap:0.5px; }
        .sc-cell { background:rgba(255,255,255,0.02); border-radius:1px; }
        .sc-body { background:#22c55e; border-radius:2px; box-shadow:inset 0 0 2px rgba(0,0,0,0.3); }
        .sc-head { background:#4ade80; border-radius:3px; box-shadow:0 0 8px rgba(74,222,128,0.7),inset 0 0 3px rgba(0,0,0,0.2); z-index:2; position:relative; }
        .sc-trail { background:rgba(34,197,94,0.1); border-radius:1px; }
        .sc-apple { background:#ef4444; border-radius:50%; box-shadow:0 0 6px rgba(239,68,68,0.7); animation:sc-apulse 0.7s ease-in-out infinite alternate; }
        .sc-golden { background:#fbbf24; border-radius:50%; box-shadow:0 0 12px rgba(251,191,36,0.9),0 0 24px rgba(251,191,36,0.4); animation:sc-gpulse 0.35s ease-in-out infinite alternate; }
        .sc-poison { background:#a855f7; border-radius:50%; box-shadow:0 0 8px rgba(168,85,247,0.8); animation:sc-ppulse2 0.5s ease-in-out infinite alternate; }
        @keyframes sc-ppulse2 { from{transform:scale(0.7);opacity:0.7} to{transform:scale(1.05);opacity:1} }
        .sc-pup-shield { background:#3b82f6; border-radius:50%; box-shadow:0 0 8px rgba(59,130,246,0.8); animation:sc-pfloat 1s ease-in-out infinite alternate; }
        .sc-pup-rush { background:#f97316; border-radius:50%; box-shadow:0 0 8px rgba(249,115,22,0.8); animation:sc-pfloat 0.6s ease-in-out infinite alternate; }
        .sc-pup-bomb { background:#ef4444; border-radius:3px; box-shadow:0 0 10px rgba(239,68,68,0.8); animation:sc-pfloat 0.8s ease-in-out infinite alternate; }
        .sc-obstacle { background:#52525b; border-radius:2px; box-shadow:inset 0 0 3px rgba(0,0,0,0.6); }
        @keyframes sc-apulse { from{transform:scale(0.8);opacity:0.8} to{transform:scale(1);opacity:1} }
        @keyframes sc-gpulse { from{transform:scale(0.85);box-shadow:0 0 10px rgba(251,191,36,0.8)} to{transform:scale(1.15);box-shadow:0 0 24px rgba(251,191,36,1)} }
        @keyframes sc-pfloat { from{transform:scale(0.75) rotate(0deg)} to{transform:scale(1.1) rotate(15deg)} }
        .sc-over .sc-grid { opacity:0.35; filter:grayscale(0.5); }
        .sc-overlay { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; pointer-events:none; z-index:10; }
        .sc-ov-text { font-size:2.5rem; font-weight:900; color:#ef4444; text-shadow:0 2px 12px rgba(0,0,0,0.7),0 0 30px rgba(239,68,68,0.5); animation:sc-goapp 0.5s cubic-bezier(0.34,1.56,0.64,1); }
        .sc-ov-score { font-size:1.1rem; font-weight:700; color:#fbbf24; text-shadow:0 1px 6px rgba(0,0,0,0.5); }
        .sc-ov-stats { font-size:0.7rem; color:#a1a1aa; }
        @keyframes sc-goapp { 0%{transform:scale(3) rotate(-10deg);opacity:0} 100%{transform:scale(1) rotate(0);opacity:1} }
        .sc-shield-on .sc-grid { border-color:rgba(59,130,246,0.6); box-shadow:0 0 20px rgba(59,130,246,0.3); }
        .sc-rush-on .sc-grid { border-color:rgba(249,115,22,0.6); box-shadow:0 0 20px rgba(249,115,22,0.3); }
        .sc-fever-on .sc-grid { border-color:rgba(251,191,36,0.6); box-shadow:0 0 24px rgba(251,191,36,0.4); }

        .sc-dpad { display:flex; flex-direction:column; align-items:center; gap:3px; flex-shrink:0; padding:2px 0; }
        .sc-drow { display:flex; align-items:center; gap:3px; }
        .sc-dbtn { width:clamp(48px,13vw,60px); height:clamp(48px,13vw,60px); border:none; border-radius:12px; background:rgba(255,255,255,0.08);
          color:#a1a1aa; font-size:1.3rem; display:flex; align-items:center; justify-content:center; cursor:pointer; transition:all 0.1s; -webkit-tap-highlight-color:transparent; backdrop-filter:blur(4px); }
        .sc-dbtn:active { background:#22c55e; color:#000; transform:scale(0.92); }
        .sc-dcenter { width:clamp(48px,13vw,60px); height:clamp(48px,13vw,60px); display:flex; align-items:center; justify-content:center; font-size:1.1rem; color:#22c55e; font-weight:900; opacity:0.6; }
        .sc-acts { display:flex; gap:8px; flex-shrink:0; padding:2px 0; }
        .sc-abtn { padding:8px 20px; border:none; border-radius:10px; background:#22c55e; color:#000; font-weight:800; font-size:0.85rem; cursor:pointer; transition:all 0.15s; min-height:38px; }
        .sc-abtn:active { transform:scale(0.95); opacity:0.8; }
        .sc-abtn.ghost { background:rgba(255,255,255,0.06); color:#71717a; border:1px solid rgba(255,255,255,0.1); }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* HUD */}
      <div className="sc-hud">
        <div className="sc-hud-left">
          <p className="sc-score">{score}</p>
          <p className="sc-best">BEST {bestDisp}</p>
        </div>
        <div className="sc-hud-right">
          <span className="sc-badge">Lv.{spdLvl} | {interval}ms</span>
          <span className="sc-badge">{snake.length} tiles | {(elapsedMs / 1000).toFixed(1)}s</span>
          {combo >= 2 && (
            <span className="sc-combo-badge" style={{ color: comboColor, background: `${comboColor}20` }}>
              {combo}x COMBO{comboLabel ? ` ${comboLabel}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Status pills */}
      <div className="sc-status">
        {isFever && <span className="sc-pill" style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.2)' }}>FEVER x{FEVER_SCORE_MULTIPLIER}</span>}
        {appleType === 'golden' && <span className="sc-pill" style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.15)' }}>GOLDEN +{GOLDEN_APPLE_SCORE}</span>}
        {appleType === 'poison' && <span className="sc-pill" style={{ color: '#a855f7', background: 'rgba(168,85,247,0.15)' }}>POISON!</span>}
        {hasShield && <span className="sc-pill" style={{ color: '#3b82f6', background: 'rgba(59,130,246,0.15)' }}>SHIELD</span>}
        {isSpeedRush && <span className="sc-pill" style={{ color: '#f97316', background: 'rgba(249,115,22,0.15)' }}>SPEED RUSH</span>}
        {isWallWrap && <span className="sc-pill" style={{ color: '#a855f7', background: 'rgba(168,85,247,0.15)' }}>WALL WRAP</span>}
        {obstacles.length > 0 && <span className="sc-pill" style={{ color: '#71717a', background: 'rgba(113,113,122,0.15)' }}>BLOCKS {obstacles.length}</span>}
      </div>

      {/* Length progress bar */}
      <div className="sc-length-bar-wrap">
        <div className="sc-length-bar" style={{
          width: `${lengthPct}%`,
          background: isFever ? '#fbbf24' : lengthPct > 70 ? '#ef4444' : lengthPct > 40 ? '#f97316' : '#22c55e',
        }} />
      </div>

      {/* Grid */}
      <div className={`sc-grid-wrap ${gameOver ? 'sc-over' : ''} ${hasShield ? 'sc-shield-on' : ''} ${isSpeedRush ? 'sc-rush-on' : ''} ${isFever ? 'sc-fever-on' : ''}`}
        onTouchStart={onTS} onTouchEnd={onTE} role="presentation">
        <div className="sc-grid-box">
          <div className="sc-grid">{cells}</div>
          {gameOver && (
            <div className="sc-overlay">
              <span className="sc-ov-text">GAME OVER</span>
              <span className="sc-ov-score">{score} pts</span>
              <span className="sc-ov-stats">{snake.length} tiles | {applesEatenR.current} apples | max {maxCombo}x combo</span>
            </div>
          )}
        </div>
      </div>

      {/* D-Pad */}
      <div className="sc-dpad">
        <div className="sc-drow"><button className="sc-dbtn" type="button" onClick={() => changeDir('up')} aria-label="up">▲</button></div>
        <div className="sc-drow">
          <button className="sc-dbtn" type="button" onClick={() => changeDir('left')} aria-label="left">◀</button>
          <div className="sc-dcenter">{dirEmoji(direction)}</div>
          <button className="sc-dbtn" type="button" onClick={() => changeDir('right')} aria-label="right">▶</button>
        </div>
        <div className="sc-drow"><button className="sc-dbtn" type="button" onClick={() => changeDir('down')} aria-label="down">▼</button></div>
      </div>

      {/* Actions */}
      <div className="sc-acts">
        <button className="sc-abtn" type="button" onClick={() => {
          if (!overR.current) { overR.current = true; setGameOver(true); sfx('crash', 0.5, 1); effects.triggerShake(6); finish() }
        }}>FINISH</button>
        <button className="sc-abtn ghost" type="button" onClick={onExit}>EXIT</button>
      </div>
    </section>
  )
}

export const snakeClassicModule: MiniGameModule = {
  manifest: {
    id: 'snake-classic',
    title: 'Snake Classic',
    description: 'Eat apples, dodge obstacles, chain combos & trigger FEVER!',
    unlockCost: 30,
    baseReward: 12,
    scoreRewardMultiplier: 1.1,
    accentColor: '#22c55e',
  },
  Component: SnakeClassicGame,
}
