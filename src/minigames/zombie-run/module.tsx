import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

// --- Sound imports ---
import footstepSfx from '../../../assets/sounds/zombie-run-footstep.mp3'
import zombieGrowlSfx from '../../../assets/sounds/zombie-run-zombie-growl.mp3'
import coinSfx from '../../../assets/sounds/zombie-run-coin.mp3'
import powerupSfx from '../../../assets/sounds/zombie-run-powerup.mp3'
import jumpSfx from '../../../assets/sounds/zombie-run-jump.mp3'
import crashSfx from '../../../assets/sounds/zombie-run-crash.mp3'
import feverSfx from '../../../assets/sounds/zombie-run-fever.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'

// ─── Game constants ───
const GAME_DURATION_MS = 120000
const PLAYER_START_POSITION = 100
const ZOMBIE_START_POSITION = 0
const INITIAL_ZOMBIE_SPEED = 28
const ZOMBIE_ACCELERATION = 4.2
const MAX_ZOMBIE_SPEED = 90
const TAP_MOVE_DISTANCE = 8
const TAP_DECAY_RATE = 0.92
const TAP_SPEED_INFLUENCE = 0.6
const MIN_GAP_FOR_GAME_OVER = 0
const DISTANCE_SCORE_MULTIPLIER = 1.2
const TIME_BONUS_MULTIPLIER = 5

// ─── Obstacle constants ───
const OBSTACLE_SPAWN_INTERVAL_MS = 3200
const OBSTACLE_MIN_INTERVAL_MS = 1800
const OBSTACLE_INTERVAL_DECAY = 0.94
const OBSTACLE_SPEED = 60
const OBSTACLE_WIDTH = 40
const OBSTACLE_HEIGHT = 30
const JUMP_DURATION_MS = 600
const JUMP_HEIGHT = 60

// ─── Stage/viewport ───
const STAGE_WIDTH = 432
const STAGE_HEIGHT = 768
const GROUND_Y = 600
const PLAYER_SIZE = 64
const ZOMBIE_SIZE = 72
const BAR_MAX_GAP = 200

// ─── Gimmick constants ───
const POWERUP_SPAWN_INTERVAL_MS = 8000
const POWERUP_SPEED_BOOST = 40
const POWERUP_SPEED_DURATION_MS = 3000
const POWERUP_INVINCIBLE_DURATION_MS = 4000
const COIN_SPAWN_INTERVAL_MS = 4000
const COIN_SCORE = 15
const TAP_COMBO_WINDOW_MS = 300
const TAP_COMBO_BONUS_THRESHOLD = 10
const TAP_COMBO_SCORE_BONUS = 5
const FEVER_TAP_THRESHOLD = 50
const FEVER_DURATION_MS = 5000
const FEVER_SPEED_MULT = 1.5

// ─── Stage system ───
const STAGE_THRESHOLDS = [0, 15000, 35000, 60000, 90000]
const STAGE_NAMES = ['City Outskirts', 'Dark Alley', 'Graveyard', 'Abandoned Factory', 'Final Escape']
const STAGE_SKY_COLORS: [string, string][] = [
  ['#1a1a2e', '#16213e'],
  ['#0d0d1a', '#1a0a2e'],
  ['#0a1628', '#162233'],
  ['#1a0f0a', '#2e1a0d'],
  ['#2e0a0a', '#1a0d0d'],
]
const STAGE_GROUND_COLORS: [string, string][] = [
  ['#2d3436', '#1e272e'],
  ['#1e1e2e', '#15152a'],
  ['#2a3020', '#1e2818'],
  ['#3a2820', '#2e1c14'],
  ['#3a1a1a', '#2e1010'],
]

// ─── Boss zombie ───
const BOSS_SPAWN_STAGE = 3
const BOSS_HP = 5
const BOSS_SPEED_MULT = 1.3

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toScore(distance: number, timeMs: number, bonusScore: number): number {
  return Math.max(0, Math.floor(distance * DISTANCE_SCORE_MULTIPLIER + (timeMs / 1000) * TIME_BONUS_MULTIPLIER + bonusScore))
}

function getCurrentStage(elapsedMs: number): number {
  let stage = 0
  for (let i = STAGE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (elapsedMs >= STAGE_THRESHOLDS[i]) { stage = i; break }
  }
  return stage
}

interface Obstacle {
  readonly id: number
  x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly type: 'obstacle' | 'coin' | 'speed_boost' | 'invincible' | 'tombstone' | 'barrel'
}

function ZombieRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const effects = useGameEffects()

  const [score, setScore] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [gap, setGap] = useState(PLAYER_START_POSITION - ZOMBIE_START_POSITION)
  const [statusText, setStatusText] = useState('TAP to escape the zombie!')
  const [isJumping, setIsJumping] = useState(false)
  const [jumpProgress, setJumpProgress] = useState(0)
  const [obstacles, setObstacles] = useState<Obstacle[]>([])
  const [tapFlash, setTapFlash] = useState(false)
  const [, setShakeIntensity] = useState(0)
  const [tapCombo, setTapCombo] = useState(0)
  const [isSpeedBoosted, setIsSpeedBoosted] = useState(false)
  const [speedBoostMs, setSpeedBoostMs] = useState(0)
  const [isInvincible, setIsInvincible] = useState(false)
  const [invincibleMs, setInvincibleMs] = useState(0)
  const [coinCount, setCoinCount] = useState(0)
  const [, setBonusScore] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverMs, setFeverMs] = useState(0)
  const [currentStage, setCurrentStage] = useState(0)
  const [stageAnnounce, setStageAnnounce] = useState<string | null>(null)
  const [bossHp, setBossHp] = useState(0)
  const [bossActive, setBossActive] = useState(false)
  const [parallaxOffset, setParallaxOffset] = useState(0)

  const playerPosRef = useRef(PLAYER_START_POSITION)
  const zombiePosRef = useRef(ZOMBIE_START_POSITION)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const tapSpeedRef = useRef(0)
  const lastTapAtRef = useRef(0)
  const tapCountRef = useRef(0)
  const jumpStartRef = useRef<number | null>(null)
  const obstaclesRef = useRef<Obstacle[]>([])
  const nextObstacleAtRef = useRef(OBSTACLE_SPAWN_INTERVAL_MS)
  const obstacleIdRef = useRef(0)
  const currentObstacleIntervalRef = useRef(OBSTACLE_SPAWN_INTERVAL_MS)
  const tapComboRef = useRef(0)
  const isSpeedBoostedRef = useRef(false)
  const speedBoostMsRef = useRef(0)
  const isInvincibleRef = useRef(false)
  const invincibleMsRef = useRef(0)
  const coinCountRef = useRef(0)
  const bonusScoreRef = useRef(0)
  const nextCoinAtRef = useRef(COIN_SPAWN_INTERVAL_MS)
  const nextPowerupAtRef = useRef(POWERUP_SPAWN_INTERVAL_MS)
  const isFeverRef = useRef(false)
  const feverMsRef = useRef(0)
  const totalTapsSinceFeverRef = useRef(0)
  const currentStageRef = useRef(0)
  const bossActiveRef = useRef(false)
  const bossHpRef = useRef(0)
  const lastGrowlAtRef = useRef(0)

  // Sound refs
  const footstepAudioRef = useRef<HTMLAudioElement | null>(null)
  const growlAudioRef = useRef<HTMLAudioElement | null>(null)
  const coinAudioRef = useRef<HTMLAudioElement | null>(null)
  const powerupAudioRef = useRef<HTMLAudioElement | null>(null)
  const jumpAudioRef = useRef<HTMLAudioElement | null>(null)
  const crashAudioRef = useRef<HTMLAudioElement | null>(null)
  const feverAudioRef = useRef<HTMLAudioElement | null>(null)
  const gameOverAudioRef = useRef<HTMLAudioElement | null>(null)

  const playSfx = useCallback((source: HTMLAudioElement | null, volume: number, playbackRate = 1) => {
    if (source === null) return
    source.currentTime = 0
    source.volume = volume
    source.playbackRate = playbackRate
    void source.play().catch(() => {})
  }, [])

  const finishRound = useCallback(
    (reason: string) => {
      if (finishedRef.current) return
      finishedRef.current = true
      setStatusText(reason)
      const finalDurationMs = elapsedMsRef.current > 0 ? elapsedMsRef.current : Math.round(DEFAULT_FRAME_MS)
      const finalScore = toScore(playerPosRef.current - PLAYER_START_POSITION, elapsedMsRef.current, bonusScoreRef.current)
      setScore(finalScore)
      playSfx(gameOverAudioRef.current, 0.6, 0.95)
      effects.triggerShake(10)
      effects.triggerFlash('rgba(239,68,68,0.6)')
      onFinish({ score: finalScore, durationMs: finalDurationMs })
    },
    [onFinish, playSfx, effects],
  )

  const handleTap = useCallback(() => {
    if (finishedRef.current) return

    const now = performance.now()
    const timeSinceLastTap = now - lastTapAtRef.current
    lastTapAtRef.current = now
    tapCountRef.current += 1
    totalTapsSinceFeverRef.current += 1

    // Tap combo
    if (timeSinceLastTap < TAP_COMBO_WINDOW_MS) {
      tapComboRef.current += 1
    } else {
      tapComboRef.current = 1
    }
    setTapCombo(tapComboRef.current)

    // Combo bonus score
    if (tapComboRef.current > 0 && tapComboRef.current % TAP_COMBO_BONUS_THRESHOLD === 0) {
      bonusScoreRef.current += TAP_COMBO_SCORE_BONUS * Math.floor(tapComboRef.current / TAP_COMBO_BONUS_THRESHOLD)
      setBonusScore(bonusScoreRef.current)
      effects.showScorePopup(TAP_COMBO_SCORE_BONUS, STAGE_WIDTH * 0.65, GROUND_Y - 100)
      effects.spawnParticles(4, STAGE_WIDTH * 0.65, GROUND_Y - 80, ['COMBO!', '+++'])
    }

    // Fever mode activation
    if (totalTapsSinceFeverRef.current >= FEVER_TAP_THRESHOLD && !isFeverRef.current) {
      isFeverRef.current = true
      feverMsRef.current = FEVER_DURATION_MS
      setIsFever(true)
      setFeverMs(FEVER_DURATION_MS)
      totalTapsSinceFeverRef.current = 0
      playSfx(feverAudioRef.current, 0.7, 1.0)
      effects.triggerFlash('rgba(239,68,68,0.25)')
      effects.spawnParticles(8, STAGE_WIDTH / 2, GROUND_Y / 2, ['FEVER!', 'MAX!'])
    }

    const feverMult = isFeverRef.current ? FEVER_SPEED_MULT : 1
    const boostMult = isSpeedBoostedRef.current ? 1.5 : 1
    const tapBoost = TAP_MOVE_DISTANCE * feverMult * boostMult
    playerPosRef.current += tapBoost
    tapSpeedRef.current = Math.min(tapSpeedRef.current + tapBoost * TAP_SPEED_INFLUENCE, MAX_ZOMBIE_SPEED * 1.5)

    setTapFlash(true)
    setTimeout(() => setTapFlash(false), 80)

    // Sound variety
    if (tapCountRef.current % 5 === 0) {
      playSfx(footstepAudioRef.current, 0.5, 1.0 + Math.random() * 0.2)
    } else {
      playSfx(footstepAudioRef.current, 0.25, 0.9 + Math.random() * 0.3)
    }

    // Tap particles
    effects.spawnParticles(1, STAGE_WIDTH * 0.65 + PLAYER_SIZE / 2, GROUND_Y - 10, ['dust'])

    if (timeSinceLastTap < 150) {
      setShakeIntensity((prev) => Math.min(prev + 0.5, 4))
    }
  }, [playSfx, effects])

  const handleSwipeUp = useCallback(() => {
    if (finishedRef.current || jumpStartRef.current !== null) return
    jumpStartRef.current = elapsedMsRef.current
    setIsJumping(true)
    playSfx(jumpAudioRef.current, 0.5, 1.2)
    effects.spawnParticles(3, STAGE_WIDTH * 0.65, GROUND_Y - 10, ['whoosh'])
  }, [playSfx, effects])

  // Init audio
  useEffect(() => {
    const audios: HTMLAudioElement[] = []
    const load = (src: string) => { const a = new Audio(src); a.preload = 'auto'; audios.push(a); return a }
    footstepAudioRef.current = load(footstepSfx)
    growlAudioRef.current = load(zombieGrowlSfx)
    coinAudioRef.current = load(coinSfx)
    powerupAudioRef.current = load(powerupSfx)
    jumpAudioRef.current = load(jumpSfx)
    crashAudioRef.current = load(crashSfx)
    feverAudioRef.current = load(feverSfx)
    gameOverAudioRef.current = load(gameOverHitSfx)
    return () => { for (const a of audios) { a.pause(); a.currentTime = 0 }; effects.cleanup() }
  }, [])

  // Keyboard
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') { event.preventDefault(); onExit(); return }
      if (event.code === 'Space' || event.code === 'ArrowRight') { event.preventDefault(); handleTap(); return }
      if (event.code === 'ArrowUp') { event.preventDefault(); handleSwipeUp() }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleTap, handleSwipeUp, onExit])

  // Touch swipe
  useEffect(() => {
    let swipeStartY = 0
    const handleTouchStart = (e: TouchEvent) => { swipeStartY = e.touches[0].clientY }
    const handleTouchEnd = (e: TouchEvent) => {
      if (swipeStartY - e.changedTouches[0].clientY > 30) handleSwipeUp()
    }
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    return () => { window.removeEventListener('touchstart', handleTouchStart); window.removeEventListener('touchend', handleTouchEnd) }
  }, [handleSwipeUp])

  // Game loop
  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) { animationFrameRef.current = null; return }
      if (lastFrameAtRef.current === null) lastFrameAtRef.current = now

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs
      setElapsedMs(elapsedMsRef.current)

      const elapsed = elapsedMsRef.current
      const elapsedSeconds = elapsed / 1000

      if (elapsed >= GAME_DURATION_MS) {
        finishRound('120s survived! CLEAR!')
        animationFrameRef.current = null
        return
      }

      // Stage progression
      const newStage = getCurrentStage(elapsed)
      if (newStage !== currentStageRef.current) {
        currentStageRef.current = newStage
        setCurrentStage(newStage)
        setStageAnnounce(STAGE_NAMES[newStage])
        effects.triggerFlash('rgba(255,255,255,0.15)')
        effects.spawnParticles(6, STAGE_WIDTH / 2, GROUND_Y / 2, ['STAGE ' + (newStage + 1)])
        setTimeout(() => setStageAnnounce(null), 2000)

        // Boss zombie at stage 3+
        if (newStage >= BOSS_SPAWN_STAGE && !bossActiveRef.current) {
          bossActiveRef.current = true
          bossHpRef.current = BOSS_HP
          setBossActive(true)
          setBossHp(BOSS_HP)
          playSfx(growlAudioRef.current, 0.8, 0.7)
        }
      }

      // Parallax background
      setParallaxOffset(prev => (prev + deltaMs * 0.02) % STAGE_WIDTH)

      // Zombie growl periodically
      if (elapsed - lastGrowlAtRef.current > 5000 + Math.random() * 3000) {
        lastGrowlAtRef.current = elapsed
        const gapRatio = clampNumber((playerPosRef.current - zombiePosRef.current) / BAR_MAX_GAP, 0, 1)
        if (gapRatio < 0.5) {
          playSfx(growlAudioRef.current, 0.3 + (1 - gapRatio) * 0.3, 0.8 + Math.random() * 0.4)
        }
      }

      // Power-up timers
      if (isSpeedBoostedRef.current) {
        speedBoostMsRef.current = Math.max(0, speedBoostMsRef.current - deltaMs)
        setSpeedBoostMs(speedBoostMsRef.current)
        if (speedBoostMsRef.current <= 0) { isSpeedBoostedRef.current = false; setIsSpeedBoosted(false) }
      }
      if (isInvincibleRef.current) {
        invincibleMsRef.current = Math.max(0, invincibleMsRef.current - deltaMs)
        setInvincibleMs(invincibleMsRef.current)
        if (invincibleMsRef.current <= 0) { isInvincibleRef.current = false; setIsInvincible(false) }
      }
      if (isFeverRef.current) {
        feverMsRef.current = Math.max(0, feverMsRef.current - deltaMs)
        setFeverMs(feverMsRef.current)
        if (feverMsRef.current <= 0) { isFeverRef.current = false; setIsFever(false) }
      }

      // Zombie movement (boss is faster)
      const bossSpeedMult = bossActiveRef.current ? BOSS_SPEED_MULT : 1
      const zombieSpeed = Math.min(MAX_ZOMBIE_SPEED, INITIAL_ZOMBIE_SPEED + elapsedSeconds * ZOMBIE_ACCELERATION) * bossSpeedMult
      zombiePosRef.current += zombieSpeed * (deltaMs / 1000)

      // Player drift
      tapSpeedRef.current *= TAP_DECAY_RATE
      playerPosRef.current += tapSpeedRef.current * (deltaMs / 1000)

      // Jump
      if (jumpStartRef.current !== null) {
        const jumpElapsed = elapsed - jumpStartRef.current
        if (jumpElapsed >= JUMP_DURATION_MS) {
          jumpStartRef.current = null; setIsJumping(false); setJumpProgress(0)
        } else {
          setJumpProgress(jumpElapsed / JUMP_DURATION_MS)
        }
      }

      const currentGap = playerPosRef.current - zombiePosRef.current
      setGap(currentGap)
      setScore(toScore(playerPosRef.current - PLAYER_START_POSITION, elapsed, bonusScoreRef.current))
      setShakeIntensity(prev => prev * 0.92)

      // ─── Spawn obstacles ───
      const stage = currentStageRef.current
      if (elapsed >= nextObstacleAtRef.current) {
        const obstacleTypes: Obstacle['type'][] = stage >= 2 ? ['obstacle', 'tombstone', 'barrel'] : ['obstacle']
        const chosenType = obstacleTypes[Math.floor(Math.random() * obstacleTypes.length)]
        const h = chosenType === 'tombstone' ? 40 : chosenType === 'barrel' ? 35 : OBSTACLE_HEIGHT
        const w = chosenType === 'tombstone' ? 30 : chosenType === 'barrel' ? 35 : OBSTACLE_WIDTH
        const newObs: Obstacle = {
          id: obstacleIdRef.current++,
          x: STAGE_WIDTH + w,
          y: GROUND_Y - h,
          width: w, height: h,
          type: chosenType,
        }
        obstaclesRef.current = [...obstaclesRef.current, newObs]
        currentObstacleIntervalRef.current = Math.max(OBSTACLE_MIN_INTERVAL_MS, currentObstacleIntervalRef.current * OBSTACLE_INTERVAL_DECAY)
        nextObstacleAtRef.current = elapsed + currentObstacleIntervalRef.current
      }

      // Spawn coins
      if (elapsed >= nextCoinAtRef.current) {
        const coinObs: Obstacle = {
          id: obstacleIdRef.current++,
          x: STAGE_WIDTH + 20,
          y: GROUND_Y - 50 - Math.random() * 40,
          width: 24, height: 24,
          type: 'coin',
        }
        obstaclesRef.current = [...obstaclesRef.current, coinObs]
        nextCoinAtRef.current = elapsed + COIN_SPAWN_INTERVAL_MS * (0.8 + Math.random() * 0.4)
      }

      // Spawn power-ups
      if (elapsed >= nextPowerupAtRef.current) {
        const pType = Math.random() < 0.5 ? 'speed_boost' : 'invincible'
        const pObs: Obstacle = {
          id: obstacleIdRef.current++,
          x: STAGE_WIDTH + 20,
          y: GROUND_Y - 60,
          width: 28, height: 28,
          type: pType as 'speed_boost' | 'invincible',
        }
        obstaclesRef.current = [...obstaclesRef.current, pObs]
        nextPowerupAtRef.current = elapsed + POWERUP_SPAWN_INTERVAL_MS * (0.8 + Math.random() * 0.4)
      }

      // Move & collide
      const speedMult = 1 + stage * 0.1
      const updated = obstaclesRef.current
        .map(o => ({ ...o, x: o.x - OBSTACLE_SPEED * speedMult * (deltaMs / 1000) }))
        .filter(o => o.x + o.width > -20)

      const playerScreenX = STAGE_WIDTH * 0.65
      const isInAir = jumpStartRef.current !== null
      const surviving: Obstacle[] = []

      for (const obs of updated) {
        const oL = obs.x, oR = obs.x + obs.width
        const pL = playerScreenX - PLAYER_SIZE / 2 + 10
        const pR = playerScreenX + PLAYER_SIZE / 2 - 10

        if (pR > oL && pL < oR) {
          if (obs.type === 'coin') {
            const fmult = isFeverRef.current ? 2 : 1
            bonusScoreRef.current += COIN_SCORE * fmult
            setBonusScore(bonusScoreRef.current)
            coinCountRef.current += 1
            setCoinCount(coinCountRef.current)
            playSfx(coinAudioRef.current, 0.5, 1.0 + Math.random() * 0.3)
            effects.spawnParticles(4, obs.x + 12, obs.y + 12, ['coin'])
            effects.showScorePopup(COIN_SCORE * fmult, obs.x + 12, obs.y - 15)
            continue
          } else if (obs.type === 'speed_boost') {
            isSpeedBoostedRef.current = true
            speedBoostMsRef.current = POWERUP_SPEED_DURATION_MS
            setIsSpeedBoosted(true)
            setSpeedBoostMs(POWERUP_SPEED_DURATION_MS)
            playerPosRef.current += POWERUP_SPEED_BOOST
            playSfx(powerupAudioRef.current, 0.6, 1.0)
            effects.triggerFlash('rgba(34,211,238,0.2)')
            effects.spawnParticles(5, obs.x + 14, obs.y + 14, ['SPEED!'])
            continue
          } else if (obs.type === 'invincible') {
            isInvincibleRef.current = true
            invincibleMsRef.current = POWERUP_INVINCIBLE_DURATION_MS
            setIsInvincible(true)
            setInvincibleMs(POWERUP_INVINCIBLE_DURATION_MS)
            playSfx(powerupAudioRef.current, 0.6, 1.3)
            effects.triggerFlash('rgba(167,139,250,0.2)')
            effects.spawnParticles(5, obs.x + 14, obs.y + 14, ['SHIELD!'])
            continue
          } else if (!isInAir) {
            if (isInvincibleRef.current) {
              playSfx(crashAudioRef.current, 0.3, 1.1)
              effects.spawnParticles(3, obs.x + obs.width / 2, obs.y, ['SMASH!'])
              bonusScoreRef.current += 5
              setBonusScore(bonusScoreRef.current)
              effects.showScorePopup(5, obs.x, obs.y - 10)
              continue
            }
            playerPosRef.current -= 20
            playSfx(crashAudioRef.current, 0.5, 1.0)
            setShakeIntensity(8)
            effects.triggerShake(8)
            effects.triggerFlash('rgba(239,68,68,0.35)')
            effects.spawnParticles(4, playerScreenX, GROUND_Y - 40, ['OUCH!', 'crash'])
            continue
          }
        }
        surviving.push(obs)
      }

      obstaclesRef.current = surviving
      setObstacles([...surviving])
      effects.updateParticles()

      if (currentGap <= MIN_GAP_FOR_GAME_OVER) {
        effects.triggerShake(12)
        effects.triggerFlash('rgba(239,68,68,0.7)')
        finishRound('Caught by zombie!')
        animationFrameRef.current = null
        return
      }

      animationFrameRef.current = window.requestAnimationFrame(step)
    }

    animationFrameRef.current = window.requestAnimationFrame(step)
    return () => {
      if (animationFrameRef.current !== null) { window.cancelAnimationFrame(animationFrameRef.current); animationFrameRef.current = null }
      lastFrameAtRef.current = null
    }
  }, [finishRound, playSfx, effects])

  // Derived values
  const displayedBestScore = Math.max(bestScore, score)
  const timeRemaining = Math.max(0, (GAME_DURATION_MS - elapsedMs) / 1000)
  const gapRatio = clampNumber(gap / BAR_MAX_GAP, 0, 1)
  const jumpOffset = isJumping ? Math.sin(jumpProgress * Math.PI) * JUMP_HEIGHT : 0
  const dangerLevel = gapRatio < 0.2 ? 'critical' : gapRatio < 0.4 ? 'danger' : gapRatio < 0.6 ? 'warning' : 'safe'
  const skyColors = STAGE_SKY_COLORS[currentStage] ?? STAGE_SKY_COLORS[0]
  const groundColors = STAGE_GROUND_COLORS[currentStage] ?? STAGE_GROUND_COLORS[0]
  const feverActive = isFever

  return (
    <section className="mini-game-panel zombie-run-panel" aria-label="zombie-run-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}</style>
      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      {/* Stage announce overlay */}
      {stageAnnounce && (
        <div className="zombie-run-stage-announce">
          <span>STAGE {currentStage + 1}</span>
          <span className="zombie-run-stage-name">{stageAnnounce}</span>
        </div>
      )}

      <div className="zombie-run-board">
        {/* HUD */}
        <div className="zombie-run-hud">
          <div className="zombie-run-hud-top">
            <div className="zombie-run-hud-left">
              <span className="zombie-run-score-value">{score}</span>
              <span className="zombie-run-score-sub">BEST {displayedBestScore}</span>
            </div>
            <div className="zombie-run-hud-right">
              <span className="zombie-run-time-value" data-danger={timeRemaining < 10 ? 'true' : undefined}>
                {timeRemaining.toFixed(1)}s
              </span>
              <span className="zombie-run-stage-label">Stage {currentStage + 1}</span>
            </div>
          </div>
          {/* Status indicators */}
          <div className="zombie-run-status-row">
            {tapCombo >= 5 && <span className="zombie-run-badge combo">COMBO x{tapCombo}</span>}
            {coinCount > 0 && <span className="zombie-run-badge coin">Coins {coinCount}</span>}
            {isSpeedBoosted && <span className="zombie-run-badge speed">SPEED {(speedBoostMs / 1000).toFixed(1)}s</span>}
            {isInvincible && <span className="zombie-run-badge shield">SHIELD {(invincibleMs / 1000).toFixed(1)}s</span>}
            {feverActive && <span className="zombie-run-badge fever">FEVER {(feverMs / 1000).toFixed(1)}s</span>}
            {bossActive && <span className="zombie-run-badge boss">BOSS HP:{bossHp}</span>}
          </div>
        </div>

        {/* Gap bar */}
        <div className="zombie-run-gap-bar-container">
          <div className="zombie-run-gap-bar-track">
            <div className={`zombie-run-gap-bar-fill zombie-run-gap-${dangerLevel}`} style={{ width: `${(gapRatio * 100).toFixed(1)}%` }} />
            <span className="zombie-run-gap-text">{Math.max(0, Math.floor(gap))}m</span>
          </div>
        </div>

        {/* Game Stage SVG - fills remaining space */}
        <svg
          className="zombie-run-stage-svg"
          viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          aria-label="zombie-run-stage"
        >
          <defs>
            <linearGradient id="zr-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={feverActive ? '#2e0a00' : skyColors[0]} />
              <stop offset="100%" stopColor={feverActive ? '#3e1500' : skyColors[1]} />
            </linearGradient>
            <linearGradient id="zr-ground" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={groundColors[0]} />
              <stop offset="100%" stopColor={groundColors[1]} />
            </linearGradient>
            <radialGradient id="zr-moon-glow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffeaa7" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#ffeaa7" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Sky */}
          <rect x="0" y="0" width={STAGE_WIDTH} height={GROUND_Y} fill="url(#zr-sky)" />
          {/* Ground */}
          <rect x="0" y={GROUND_Y} width={STAGE_WIDTH} height={STAGE_HEIGHT - GROUND_Y} fill="url(#zr-ground)" />
          <line x1="0" y1={GROUND_Y} x2={STAGE_WIDTH} y2={GROUND_Y} stroke="#4a5568" strokeWidth="2" />

          {/* Stars */}
          {[50, 120, 200, 280, 370, 90, 160, 340, 410, 30].map((sx, i) => (
            <circle key={`star-${i}`} cx={sx} cy={20 + (i * 37) % 100} r={1 + (i % 3) * 0.5}
              fill="#ffeaa7" opacity={0.3 + Math.sin(elapsedMs / 500 + i * 1.5) * 0.3} />
          ))}

          {/* Moon with glow */}
          <circle cx="360" cy="60" r="40" fill="url(#zr-moon-glow)" />
          <circle cx="360" cy="60" r="22" fill="#ffeaa7" opacity="0.85" />
          <circle cx="366" cy="56" r="19" fill={feverActive ? '#2e0a00' : skyColors[0]} />

          {/* Parallax buildings */}
          {[0, 80, 160, 240, 320, 400].map((bx, i) => {
            const h = 80 + (i * 37 % 60)
            const w = 40 + (i * 23 % 30)
            const x = ((bx - parallaxOffset * 0.3) % (STAGE_WIDTH + 100) + STAGE_WIDTH + 100) % (STAGE_WIDTH + 100) - 50
            return (
              <g key={`bld-${i}`} opacity={0.15 + (i % 3) * 0.05}>
                <rect x={x} y={GROUND_Y - h} width={w} height={h} fill="#1a1a2e" />
                {[...Array(Math.floor(h / 20))].map((_, wi) => (
                  <rect key={`win-${i}-${wi}`} x={x + 6 + (wi % 2) * (w / 2 - 4)} y={GROUND_Y - h + 8 + wi * 20} width={6} height={8}
                    fill={Math.random() > 0.4 ? '#fbbf24' : '#1a1a2e'} opacity={0.6} />
                ))}
              </g>
            )
          })}

          {/* Parallax trees */}
          {[30, 110, 190, 280, 370].map((tx, i) => {
            const th = 40 + (i % 3) * 20
            const x = ((tx - parallaxOffset * 0.5) % (STAGE_WIDTH + 80) + STAGE_WIDTH + 80) % (STAGE_WIDTH + 80) - 40
            return (
              <g key={`tree-${i}`} opacity={0.2 + (i % 2) * 0.08}>
                <rect x={x - 3} y={GROUND_Y - th * 0.3} width="6" height={th * 0.3} fill="#2d3436" />
                <polygon points={`${x},${GROUND_Y - th} ${x - 14},${GROUND_Y - th * 0.3} ${x + 14},${GROUND_Y - th * 0.3}`} fill="#2d3436" />
              </g>
            )
          })}

          {/* Ground road lines */}
          {[0, 80, 160, 240, 320, 400].map((lx, i) => {
            const x = ((lx - parallaxOffset * 1.5) % (STAGE_WIDTH + 80) + STAGE_WIDTH + 80) % (STAGE_WIDTH + 80) - 40
            return <rect key={`road-${i}`} x={x} y={GROUND_Y + 20} width={40} height={4} rx={2} fill="#4a5568" opacity={0.4} />
          })}

          {/* Obstacles */}
          {obstacles.map(obs => {
            if (obs.type === 'coin') {
              return (
                <g key={`o-${obs.id}`}>
                  <circle cx={obs.x + 12} cy={obs.y + 12} r={14} fill="#fbbf24" opacity={0.15} />
                  <circle cx={obs.x + 12} cy={obs.y + 12} r={11} fill="#fbbf24" stroke="#d97706" strokeWidth={2}
                    opacity={0.7 + Math.sin(elapsedMs / 200 + obs.id) * 0.3} />
                  <text x={obs.x + 12} y={obs.y + 16} textAnchor="middle" fontSize="10" fill="#92400e" fontWeight="bold">$</text>
                </g>
              )
            }
            if (obs.type === 'speed_boost') {
              return (
                <g key={`o-${obs.id}`}>
                  <circle cx={obs.x + 14} cy={obs.y + 14} r={15} fill="#22d3ee" opacity={0.15 + Math.sin(elapsedMs / 300) * 0.1} />
                  <circle cx={obs.x + 14} cy={obs.y + 14} r={13} fill="#22d3ee" stroke="#06b6d4" strokeWidth={2} />
                  <text x={obs.x + 14} y={obs.y + 19} textAnchor="middle" fontSize="14" fill="#fff" fontWeight="bold">&gt;&gt;</text>
                </g>
              )
            }
            if (obs.type === 'invincible') {
              return (
                <g key={`o-${obs.id}`}>
                  <circle cx={obs.x + 14} cy={obs.y + 14} r={15} fill="#a78bfa" opacity={0.15 + Math.sin(elapsedMs / 300) * 0.1} />
                  <circle cx={obs.x + 14} cy={obs.y + 14} r={13} fill="#a78bfa" stroke="#7c3aed" strokeWidth={2} />
                  <text x={obs.x + 14} y={obs.y + 19} textAnchor="middle" fontSize="16" fill="#fff" fontWeight="bold">*</text>
                </g>
              )
            }
            if (obs.type === 'tombstone') {
              return (
                <g key={`o-${obs.id}`}>
                  <rect x={obs.x} y={obs.y + 8} width={obs.width} height={obs.height - 8} rx={3} fill="#6b7280" />
                  <rect x={obs.x + 2} y={obs.y} width={obs.width - 4} height={12} rx={6} fill="#9ca3af" />
                  <text x={obs.x + obs.width / 2} y={obs.y + obs.height / 2 + 5} textAnchor="middle" fontSize="10" fill="#374151">RIP</text>
                </g>
              )
            }
            if (obs.type === 'barrel') {
              return (
                <g key={`o-${obs.id}`}>
                  <ellipse cx={obs.x + obs.width / 2} cy={obs.y + obs.height / 2} rx={obs.width / 2} ry={obs.height / 2} fill="#92400e" />
                  <ellipse cx={obs.x + obs.width / 2} cy={obs.y + obs.height / 2} rx={obs.width / 2 - 4} ry={obs.height / 2 - 4} fill="#b45309" />
                  <line x1={obs.x + 4} y1={obs.y + obs.height / 2} x2={obs.x + obs.width - 4} y2={obs.y + obs.height / 2} stroke="#78350f" strokeWidth={2} />
                </g>
              )
            }
            return (
              <g key={`o-${obs.id}`}>
                <rect x={obs.x} y={obs.y} width={obs.width} height={obs.height} rx="5" fill="#e74c3c" opacity="0.9" />
                <rect x={obs.x + 3} y={obs.y + 3} width={obs.width - 6} height={obs.height - 6} rx="3" fill="#c0392b" />
                <text x={obs.x + obs.width / 2} y={obs.y + obs.height / 2 + 5} textAnchor="middle" fontSize="14" fill="#fff" fontWeight="bold">!</text>
              </g>
            )
          })}

          {/* Zombie */}
          <g transform={`translate(${STAGE_WIDTH * 0.2}, ${GROUND_Y - ZOMBIE_SIZE})`}>
            <ellipse cx={ZOMBIE_SIZE / 2} cy={ZOMBIE_SIZE + 2} rx={ZOMBIE_SIZE / 2 + 4} ry={4} fill="rgba(0,0,0,0.35)" />
            <rect x="0" y="0" width={ZOMBIE_SIZE} height={ZOMBIE_SIZE} rx="8" fill="#2ecc71" opacity="0.9" />
            <rect x="5" y="5" width={ZOMBIE_SIZE - 10} height={ZOMBIE_SIZE - 10} rx="5" fill="#27ae60" />
            {/* Eyes */}
            <circle cx={ZOMBIE_SIZE * 0.3} cy={ZOMBIE_SIZE * 0.3} r="8" fill="#1e272e" />
            <circle cx={ZOMBIE_SIZE * 0.3} cy={ZOMBIE_SIZE * 0.3} r="5" fill="#c0392b" />
            <circle cx={ZOMBIE_SIZE * 0.7} cy={ZOMBIE_SIZE * 0.3} r="8" fill="#1e272e" />
            <circle cx={ZOMBIE_SIZE * 0.7} cy={ZOMBIE_SIZE * 0.3} r="5" fill="#c0392b" />
            {/* Mouth */}
            <rect x={ZOMBIE_SIZE * 0.25} y={ZOMBIE_SIZE * 0.55} width={ZOMBIE_SIZE * 0.5} height={8} rx="3" fill="#1e8449" />
            {/* Arms reaching forward */}
            <rect x={ZOMBIE_SIZE - 5} y={ZOMBIE_SIZE * 0.3} width={20} height={8} rx={4} fill="#2ecc71"
              transform={`rotate(${-10 + Math.sin(elapsedMs / 200) * 15}, ${ZOMBIE_SIZE - 5}, ${ZOMBIE_SIZE * 0.3 + 4})`} />
            <rect x={ZOMBIE_SIZE - 5} y={ZOMBIE_SIZE * 0.5} width={18} height={7} rx={3} fill="#27ae60"
              transform={`rotate(${5 + Math.sin(elapsedMs / 250 + 1) * 12}, ${ZOMBIE_SIZE - 5}, ${ZOMBIE_SIZE * 0.5 + 3})`} />
            {dangerLevel === 'critical' && (
              <rect x="-5" y="-5" width={ZOMBIE_SIZE + 10} height={ZOMBIE_SIZE + 10} rx="10"
                fill="none" stroke="#e74c3c" strokeWidth="3"
                opacity={0.4 + Math.sin(elapsedMs / 80) * 0.4} />
            )}
            {bossActive && (
              <text x={ZOMBIE_SIZE / 2} y={-10} textAnchor="middle" fontSize="12" fill="#ef4444" fontWeight="bold"
                opacity={0.6 + Math.sin(elapsedMs / 200) * 0.4}>BOSS</text>
            )}
          </g>

          {/* Player */}
          <g transform={`translate(${STAGE_WIDTH * 0.65}, ${GROUND_Y - PLAYER_SIZE - jumpOffset})`}>
            <ellipse
              cx={PLAYER_SIZE / 2} cy={PLAYER_SIZE + 2 + jumpOffset}
              rx={PLAYER_SIZE / 2 + 2} ry={3 - (jumpOffset > 0 ? jumpOffset / JUMP_HEIGHT * 2 : 0)}
              fill="rgba(0,0,0,0.25)"
            />
            <image
              href={kimYeonjaSprite}
              x="0" y="0"
              width={PLAYER_SIZE} height={PLAYER_SIZE}
              preserveAspectRatio="xMidYMid meet"
              className={tapFlash ? 'zombie-run-player-flash' : ''}
              style={isInvincible ? { filter: 'drop-shadow(0 0 10px rgba(167,139,250,0.9))' } : undefined}
            />
            {isJumping && (
              <text x={PLAYER_SIZE / 2} y={-10} textAnchor="middle" fontSize="12" fill="#ffeaa7" fontWeight="bold">JUMP!</text>
            )}
            {isInvincible && (
              <circle cx={PLAYER_SIZE / 2} cy={PLAYER_SIZE / 2} r={PLAYER_SIZE / 2 + 6}
                fill="none" stroke="#a78bfa" strokeWidth="2.5"
                opacity={0.4 + Math.sin(elapsedMs / 120) * 0.35}
                strokeDasharray="8 4" />
            )}
            {isSpeedBoosted && (
              <>
                {[0, 1, 2].map(i => (
                  <rect key={`trail-${i}`}
                    x={-10 - i * 12} y={PLAYER_SIZE * 0.3 + i * 6}
                    width={8 + i * 2} height={3} rx={1.5}
                    fill="#22d3ee" opacity={0.5 - i * 0.15} />
                ))}
              </>
            )}
          </g>

          {/* Tap sparks */}
          {tapFlash && (
            <g>
              {[0, 1, 2, 3, 4, 5].map(i => {
                const angle = (i * Math.PI) / 3 + (elapsedMs / 80)
                const dist = 15 + Math.random() * 10
                const sx = STAGE_WIDTH * 0.65 + PLAYER_SIZE / 2 + Math.cos(angle) * dist
                const sy = GROUND_Y - PLAYER_SIZE / 2 - jumpOffset + Math.sin(angle) * dist
                return <circle key={`sp-${i}`} cx={sx} cy={sy} r={2 + Math.random()} fill={feverActive ? '#ef4444' : '#ffeaa7'} opacity={0.9} />
              })}
            </g>
          )}

          {/* Danger vignette when close */}
          {dangerLevel === 'critical' && (
            <rect x="0" y="0" width={STAGE_WIDTH} height={STAGE_HEIGHT}
              fill="url(#zr-sky)" opacity={0.15 + Math.sin(elapsedMs / 150) * 0.1}
              style={{ mixBlendMode: 'multiply' }} />
          )}
        </svg>

        {/* Controls */}
        <div className="zombie-run-controls">
          <button
            className={`zombie-run-tap-button ${tapFlash ? 'zombie-run-tap-active' : ''} ${feverActive ? 'zombie-run-tap-fever' : ''}`}
            type="button"
            onPointerDown={e => { e.preventDefault(); handleTap() }}
          >
            <span className="zombie-run-tap-icon">TAP!</span>
            <span className="zombie-run-tap-hint">Tap to run!</span>
          </button>
          <button
            className="zombie-run-jump-button"
            type="button"
            disabled={isJumping}
            onPointerDown={e => { e.preventDefault(); handleSwipeUp() }}
          >
            <span className="zombie-run-jump-icon">JUMP</span>
          </button>
        </div>

        <p className="zombie-run-status">{statusText}</p>

        {/* Top action buttons */}
        <div className="zombie-run-overlay-actions">
          <button className="zombie-run-action-button" type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={() => { playSfx(crashAudioRef.current, 0.3, 1); finishRound('Game ended!') }}>
            End
          </button>
          <button className="zombie-run-action-button ghost" type="button"
            onPointerDown={e => e.stopPropagation()} onClick={onExit}>
            Exit
          </button>
        </div>
      </div>

      <style>{`
        .zombie-run-panel {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          max-width: 432px;
          margin: 0 auto;
          background: #0a0a18;
          color: #e2e8f0;
          overflow: hidden;
          position: relative;
          user-select: none;
          -webkit-user-select: none;
          touch-action: manipulation;
        }

        .zombie-run-board {
          display: flex;
          flex-direction: column;
          width: 100%;
          height: 100%;
          position: relative;
        }

        /* ─── HUD ─── */
        .zombie-run-hud {
          width: 100%;
          padding: 10px 14px 6px;
          background: linear-gradient(180deg, rgba(21,128,61,0.3) 0%, rgba(21,128,61,0.05) 100%);
          border-bottom: 1px solid rgba(21,128,61,0.3);
          flex-shrink: 0;
        }

        .zombie-run-hud-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .zombie-run-hud-left { display: flex; flex-direction: column; }
        .zombie-run-hud-right { display: flex; flex-direction: column; align-items: flex-end; }

        .zombie-run-score-value {
          font-size: clamp(20px, 5vw, 28px);
          color: #ffeaa7;
          font-weight: 900;
          letter-spacing: 1px;
          text-shadow: 0 2px 8px rgba(255,234,167,0.3);
        }

        .zombie-run-score-sub {
          font-size: 10px;
          color: #81ecec;
          opacity: 0.7;
        }

        .zombie-run-time-value {
          font-size: clamp(18px, 4.5vw, 24px);
          color: #74b9ff;
          font-weight: 800;
        }

        .zombie-run-time-value[data-danger] {
          color: #e74c3c;
          animation: zombie-run-blink 0.5s infinite;
        }

        .zombie-run-stage-label {
          font-size: 9px;
          color: #a0aec0;
          letter-spacing: 1px;
        }

        .zombie-run-status-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 4px;
        }

        .zombie-run-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          letter-spacing: 0.5px;
        }

        .zombie-run-badge.combo { background: rgba(251,191,36,0.2); color: #fbbf24; }
        .zombie-run-badge.coin { background: rgba(245,158,11,0.2); color: #f59e0b; }
        .zombie-run-badge.speed { background: rgba(34,211,238,0.2); color: #22d3ee; animation: zombie-run-blink 0.8s infinite; }
        .zombie-run-badge.shield { background: rgba(167,139,250,0.2); color: #a78bfa; animation: zombie-run-blink 0.8s infinite; }
        .zombie-run-badge.fever { background: rgba(239,68,68,0.3); color: #ef4444; animation: zombie-run-blink 0.3s infinite; }
        .zombie-run-badge.boss { background: rgba(239,68,68,0.2); color: #ef4444; }

        /* ─── Gap Bar ─── */
        .zombie-run-gap-bar-container {
          width: 100%;
          padding: 4px 14px;
          flex-shrink: 0;
        }

        .zombie-run-gap-bar-track {
          width: 100%;
          height: 14px;
          background: #2d3436;
          border-radius: 7px;
          overflow: hidden;
          border: 1px solid #4a5568;
          position: relative;
        }

        .zombie-run-gap-bar-fill {
          height: 100%;
          border-radius: 7px;
          transition: width 0.1s ease-out, background 0.3s;
        }

        .zombie-run-gap-text {
          position: absolute;
          right: 8px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 8px;
          color: #fff;
          font-weight: 700;
          text-shadow: 0 1px 2px rgba(0,0,0,0.5);
        }

        .zombie-run-gap-safe { background: linear-gradient(90deg, #00b894, #55efc4); }
        .zombie-run-gap-warning { background: linear-gradient(90deg, #fdcb6e, #ffeaa7); }
        .zombie-run-gap-danger { background: linear-gradient(90deg, #e17055, #fab1a0); }
        .zombie-run-gap-critical {
          background: linear-gradient(90deg, #d63031, #e74c3c);
          animation: zombie-run-pulse 0.3s infinite;
        }

        /* ─── Stage SVG ─── */
        .zombie-run-stage-svg {
          flex: 1;
          width: 100%;
          min-height: 0;
          display: block;
        }

        .zombie-run-player-flash {
          filter: brightness(2);
        }

        /* ─── Controls ─── */
        .zombie-run-controls {
          display: flex;
          gap: 12px;
          padding: 8px 14px 6px;
          flex-shrink: 0;
        }

        .zombie-run-tap-button {
          flex: 3;
          height: clamp(64px, 10vh, 88px);
          border: 3px solid #15803d;
          border-radius: 14px;
          background: linear-gradient(180deg, #15803d, #0f5e2a);
          color: #fff;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          transition: transform 0.05s, background 0.05s;
          box-shadow: 0 4px 0 #0a3d1a, 0 6px 14px rgba(0, 0, 0, 0.5);
        }

        .zombie-run-tap-button:active,
        .zombie-run-tap-active {
          transform: translateY(3px);
          box-shadow: 0 1px 0 #0a3d1a, 0 2px 4px rgba(0, 0, 0, 0.4);
          background: linear-gradient(180deg, #1a9d4a, #15803d);
        }

        .zombie-run-tap-fever {
          border-color: #ef4444;
          background: linear-gradient(180deg, #b91c1c, #991b1b);
          box-shadow: 0 4px 0 #7f1d1d, 0 6px 14px rgba(239, 68, 68, 0.4);
          animation: zombie-run-pulse 0.3s infinite;
        }

        .zombie-run-tap-icon {
          font-size: clamp(18px, 4vw, 24px);
          font-weight: 900;
          letter-spacing: 3px;
        }

        .zombie-run-tap-hint {
          font-size: 8px;
          opacity: 0.6;
        }

        .zombie-run-jump-button {
          flex: 1;
          height: clamp(64px, 10vh, 88px);
          border: 3px solid #2980b9;
          border-radius: 14px;
          background: linear-gradient(180deg, #3498db, #2471a3);
          color: #fff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 0 #1a5276, 0 6px 14px rgba(0, 0, 0, 0.5);
          transition: transform 0.05s;
        }

        .zombie-run-jump-button:active {
          transform: translateY(3px);
          box-shadow: 0 1px 0 #1a5276, 0 2px 4px rgba(0, 0, 0, 0.4);
        }

        .zombie-run-jump-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .zombie-run-jump-icon {
          font-size: clamp(12px, 3vw, 16px);
          font-weight: 900;
          letter-spacing: 2px;
        }

        .zombie-run-status {
          font-size: 9px;
          color: #a0aec0;
          text-align: center;
          padding: 2px 0 6px;
          flex-shrink: 0;
        }

        /* ─── Overlay ─── */
        .zombie-run-overlay-actions {
          position: absolute;
          top: 10px;
          right: 10px;
          display: flex;
          gap: 6px;
          z-index: 10;
        }

        .zombie-run-action-button {
          padding: 6px 16px;
          border: none;
          border-radius: 8px;
          background: linear-gradient(180deg, #374151 0%, #1f2937 100%);
          color: #e5e7eb;
          font-size: 11px;
          font-weight: 700;
          cursor: pointer;
          box-shadow: 0 2px 0 #111827, 0 3px 6px rgba(0,0,0,0.4);
          transition: transform 0.08s;
        }

        .zombie-run-action-button:active { transform: translateY(2px); box-shadow: 0 0 0 #111827; }

        .zombie-run-action-button.ghost {
          background: transparent;
          border: 1px solid #4b5563;
          color: #9ca3af;
          box-shadow: none;
        }

        /* ─── Stage announce ─── */
        .zombie-run-stage-announce {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          z-index: 20;
          pointer-events: none;
          animation: zombie-run-stage-fade 2s ease-out forwards;
        }

        .zombie-run-stage-announce > span:first-child {
          font-size: clamp(24px, 6vw, 36px);
          font-weight: 900;
          color: #ffeaa7;
          text-shadow: 0 2px 12px rgba(255,234,167,0.5), 0 0 30px rgba(255,234,167,0.3);
          letter-spacing: 3px;
        }

        .zombie-run-stage-name {
          font-size: clamp(12px, 3vw, 16px);
          color: #81ecec;
          font-weight: 700;
          letter-spacing: 2px;
        }

        @keyframes zombie-run-stage-fade {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
          20% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
          80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.2); }
        }

        @keyframes zombie-run-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        @keyframes zombie-run-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `}</style>
    </section>
  )
}

export const zombieRunModule: MiniGameModule = {
  manifest: {
    id: 'zombie-run',
    title: 'Zombie Run',
    description: '\uC880\uBE44\uAC00 \uCAD3\uC544\uC628\uB2E4! \uBBF8\uCE5C\uB4EF\uC774 \uD0ED\uD574\uC11C \uB3C4\uB9DD\uCCD0\uB77C!',
    unlockCost: 25,
    baseReward: 11,
    scoreRewardMultiplier: 1.05,
    accentColor: '#15803d',
  },
  Component: ZombieRunGame,
}
