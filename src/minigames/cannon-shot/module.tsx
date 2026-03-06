import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import {
  FlashOverlay,
  GAME_EFFECTS_CSS,
  ParticleRenderer,
  ScorePopupRenderer,
  useGameEffects,
} from '../shared/game-effects'
import cannonFireSfx from '../../../assets/sounds/cannon-fire.mp3'
import cannonHitSfx from '../../../assets/sounds/cannon-hit.mp3'
import cannonWhooshSfx from '../../../assets/sounds/cannon-whoosh.mp3'
import cannonMissSfx from '../../../assets/sounds/cannon-miss.mp3'
import cannonPerfectSfx from '../../../assets/sounds/cannon-perfect.mp3'
import cannonComboSfx from '../../../assets/sounds/cannon-combo.mp3'
import cannonChargeSfx from '../../../assets/sounds/cannon-charge.mp3'
import cannonPowerupSfx from '../../../assets/sounds/cannon-powerup.mp3'
import gameOverHitSfx from '../../../assets/sounds/game-over-hit.mp3'
import cannonShotBgmLoop from '../../../assets/sounds/default-bgm-loop.mp3'
import cannonShotBackground from '../../../assets/images/generated/cannon-shot/cannon-shot-bg-iter-01.png'
import {
  getActiveBgmTrack,
  playBackgroundAudio as playSharedBgm,
  stopBackgroundAudio as stopSharedBgm,
} from '../../gui/sound-manager'
import {
  applyWindTunnelForce,
  CANNON_X,
  CANNON_Y,
  clampNumber,
  createLaunchVelocity,
  createShotLayout,
  DEFAULT_ANGLE_DEG,
  degToRad,
  distanceBetween,
  EXPLOSION_DURATION_MS,
  GAME_TIMEOUT_MS,
  GRAVITY,
  GROUND_Y,
  MAX_ANGLE_DEG,
  MAX_POWER,
  MAX_SHOTS,
  MIN_ANGLE_DEG,
  MIN_POWER,
  pointInsideRect,
  POWER_FILL_SPEED,
  POWERUP_COLORS,
  POWERUP_LABELS,
  POWERUP_RADIUS,
  PROJECTILE_RADIUS,
  resolvePortalTeleport,
  RESULT_DISPLAY_MS,
  scoreForDistance,
  stepBombHazard,
  stepMovingTargets,
  TRAIL_MAX_LENGTH,
  type BombHazard,
  type Obstacle,
  type Point,
  type PortalLock,
  type PortalPair,
  type PowerupItem,
  type PowerupType,
  type ProjectilePreview,
  type TargetInfo,
  type WindTunnel,
  VIEWBOX_HEIGHT,
  VIEWBOX_WIDTH,
} from './gameplay'

const CANNON_SHOT_BGM_VOLUME = 0.22
const BONUS_TARGET_MULTIPLIER = 3
const HIT_STREAK_BONUS = 15
const TRAIL_STRIDE = 2
const PROJECTILE_PADDING = 28
const FIRE_WHOOSH_DELAY_MS = 80
const POWER_BAR_WARNING = 68
const POWER_BAR_DANGER = 92
const CHARGE_AUDIO_VOLUME = 0.22
const ANGLE_STEP = 2

type GamePhase = 'aiming' | 'flying' | 'result' | 'finished'

type ProjectileState = ProjectilePreview

interface ExplosionState {
  readonly x: number
  readonly y: number
  readonly remainingMs: number
  readonly color: string
  readonly size: number
}

interface ShotResult {
  readonly score: number
  readonly label: string
  readonly x: number
  readonly y: number
  readonly color: string
  readonly remainingMs: number
}

type AudioKey = 'fire' | 'hit' | 'whoosh' | 'miss' | 'perfect' | 'combo' | 'charge' | 'powerup' | 'gameover'

function CannonShotGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [initialLayout] = useState(() => createShotLayout(1))

  const {
    flashColor,
    getShakeStyle,
    isFlashing,
    particles,
    scorePopups,
    showScorePopup,
    spawnParticles,
    triggerFlash,
    triggerShake,
    updateParticles,
    cleanup,
  } = useGameEffects()
  const panelRef = useRef<HTMLElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const finishedRef = useRef(false)
  const elapsedMsRef = useRef(0)
  const audioRefs = useRef<Record<AudioKey, HTMLAudioElement | null>>({
    fire: null,
    hit: null,
    whoosh: null,
    miss: null,
    perfect: null,
    combo: null,
    charge: null,
    powerup: null,
    gameover: null,
  })
  const isChargingRef = useRef(false)
  const powerRef = useRef(0)
  const angleRef = useRef(DEFAULT_ANGLE_DEG)
  const phaseRef = useRef<GamePhase>('aiming')
  const projectileRef = useRef<ProjectileState | null>(null)
  const trailRef = useRef<Point[]>([])
  const explosionsRef = useRef<ExplosionState[]>([])
  const shotResultRef = useRef<ShotResult | null>(null)
  const currentShotRef = useRef(1)
  const shotsRemainingRef = useRef(MAX_SHOTS)
  const scoreRef = useRef(0)
  const hitStreakRef = useRef(0)
  const targetsRef = useRef<TargetInfo[]>(initialLayout.targets)
  const windRef = useRef(initialLayout.wind)
  const obstacleRef = useRef<Obstacle | null>(initialLayout.obstacle)
  const powerupRef = useRef<PowerupItem | null>(initialLayout.powerup)
  const portalPairRef = useRef<PortalPair | null>(initialLayout.portalPair)
  const portalLockRef = useRef<PortalLock>(null)
  const windTunnelRef = useRef<WindTunnel | null>(initialLayout.windTunnel)
  const bombRef = useRef<BombHazard | null>(initialLayout.bomb)
  const activePowerupsRef = useRef<PowerupType[]>([])
  const spaceHeldRef = useRef(false)

  const [angleDeg, setAngleDeg] = useState(DEFAULT_ANGLE_DEG)
  const [power, setPower] = useState(0)
  const [isCharging, setIsCharging] = useState(false)
  const [phase, setPhase] = useState<GamePhase>('aiming')
  const [projectile, setProjectile] = useState<ProjectileState | null>(null)
  const [trail, setTrail] = useState<Point[]>([])
  const [explosions, setExplosions] = useState<ExplosionState[]>([])
  const [shotResult, setShotResult] = useState<ShotResult | null>(null)
  const [currentShot, setCurrentShot] = useState(1)
  const [shotsRemaining, setShotsRemaining] = useState(MAX_SHOTS)
  const [score, setScore] = useState(0)
  const [hitStreak, setHitStreak] = useState(0)
  const [targets, setTargets] = useState<TargetInfo[]>(initialLayout.targets)
  const [wind, setWind] = useState(initialLayout.wind)
  const [obstacle, setObstacle] = useState<Obstacle | null>(initialLayout.obstacle)
  const [powerup, setPowerup] = useState<PowerupItem | null>(initialLayout.powerup)
  const [portalPair, setPortalPair] = useState<PortalPair | null>(initialLayout.portalPair)
  const [windTunnel, setWindTunnel] = useState<WindTunnel | null>(initialLayout.windTunnel)
  const [bomb, setBomb] = useState<BombHazard | null>(initialLayout.bomb)
  const [gimmickTags, setGimmickTags] = useState<string[]>(initialLayout.gimmicks)
  const [activePowerups, setActivePowerups] = useState<PowerupType[]>([])
  const [timeRemainingMs, setTimeRemainingMs] = useState(GAME_TIMEOUT_MS)

  const playAudio = useCallback((key: AudioKey, volume: number, playbackRate = 1) => {
    const audio = audioRefs.current[key]
    if (audio === null) return
    audio.pause()
    audio.currentTime = 0
    audio.volume = Math.min(1, volume)
    audio.playbackRate = playbackRate
    void audio.play().catch(() => {})
  }, [])

  const stopAudio = useCallback((key: AudioKey) => {
    const audio = audioRefs.current[key]
    if (audio === null) return
    audio.pause()
    audio.currentTime = 0
  }, [])

  const toPanelPoint = useCallback((x: number, y: number) => {
    const panel = panelRef.current
    const board = boardRef.current
    if (panel === null || board === null) {
      return { x, y }
    }
    const panelRect = panel.getBoundingClientRect()
    const boardRect = board.getBoundingClientRect()
    return {
      x: boardRect.left - panelRect.left + (x / VIEWBOX_WIDTH) * boardRect.width,
      y: boardRect.top - panelRect.top + (y / VIEWBOX_HEIGHT) * boardRect.height,
    }
  }, [])

  const spawnEffectBurst = useCallback((x: number, y: number, color: string, popupScore = 0) => {
    const point = toPanelPoint(x, y)
    spawnParticles(popupScore > 0 ? 6 : 4, point.x, point.y, undefined, 'circle')
    if (popupScore > 0) {
      showScorePopup(popupScore, point.x - 8, point.y - 20, color)
    }
  }, [showScorePopup, spawnParticles, toPanelPoint])

  const applyLayout = useCallback((shotNumber: number) => {
    const nextLayout = createShotLayout(shotNumber)
    targetsRef.current = nextLayout.targets
    windRef.current = nextLayout.wind
    obstacleRef.current = nextLayout.obstacle
    powerupRef.current = nextLayout.powerup
    portalPairRef.current = nextLayout.portalPair
    portalLockRef.current = null
    windTunnelRef.current = nextLayout.windTunnel
    bombRef.current = nextLayout.bomb
    activePowerupsRef.current = []
    projectileRef.current = null
    trailRef.current = []
    explosionsRef.current = []
    shotResultRef.current = null
    powerRef.current = 0
    isChargingRef.current = false
    phaseRef.current = 'aiming'

    setTargets(nextLayout.targets)
    setWind(nextLayout.wind)
    setObstacle(nextLayout.obstacle)
    setPowerup(nextLayout.powerup)
    setPortalPair(nextLayout.portalPair)
    setWindTunnel(nextLayout.windTunnel)
    setBomb(nextLayout.bomb)
    setActivePowerups([])
    setProjectile(null)
    setTrail([])
    setExplosions([])
    setShotResult(null)
    setPower(0)
    setIsCharging(false)
    setPhase('aiming')
    setGimmickTags(nextLayout.gimmicks)
    stopAudio('charge')
  }, [stopAudio])

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true
    isChargingRef.current = false
    phaseRef.current = 'finished'
    setIsCharging(false)
    setPhase('finished')
    stopAudio('charge')
    playAudio('gameover', 0.6, 0.95)
    onFinish({
      score: scoreRef.current,
      durationMs: Math.round(Math.max(DEFAULT_FRAME_MS, elapsedMsRef.current)),
    })
  }, [onFinish, playAudio, stopAudio])

  const advanceToNextShot = useCallback(() => {
    if (finishedRef.current) return
    if (shotsRemainingRef.current <= 0) {
      finishGame()
      return
    }
    const nextShot = currentShotRef.current + 1
    currentShotRef.current = nextShot
    setCurrentShot(nextShot)
    applyLayout(nextShot)
  }, [applyLayout, finishGame])

  const finalizeShot = useCallback((params: {
    readonly baseScore: number
    readonly label: string
    readonly x: number
    readonly y: number
    readonly color: string
    readonly explosions: ExplosionState[]
    readonly perfect: boolean
    readonly hazard: boolean
  }) => {
    if (phaseRef.current !== 'flying') return

    let totalScore = params.baseScore
    if (totalScore > 0) {
      hitStreakRef.current += 1
      const streakBonus = hitStreakRef.current >= 3
        ? HIT_STREAK_BONUS * Math.min(hitStreakRef.current - 2, 5)
        : 0
      totalScore += streakBonus
      setHitStreak(hitStreakRef.current)
      if (streakBonus > 0) {
        playAudio('combo', 0.48, 0.96 + hitStreakRef.current * 0.04)
      }
    } else {
      hitStreakRef.current = 0
      setHitStreak(0)
    }

    scoreRef.current += totalScore
    setScore(scoreRef.current)
    projectileRef.current = null
    setProjectile(null)
    explosionsRef.current = params.explosions
    setExplosions(params.explosions)

    const nextResult: ShotResult = {
      score: totalScore,
      label: params.label,
      x: params.x,
      y: params.y,
      color: params.color,
      remainingMs: RESULT_DISPLAY_MS,
    }
    shotResultRef.current = nextResult
    setShotResult(nextResult)
    phaseRef.current = 'result'
    setPhase('result')

    spawnEffectBurst(params.x, params.y, params.color, totalScore)
    if (totalScore > 0) {
      triggerShake(params.perfect ? 7 : 4, params.perfect ? 170 : 120)
      triggerFlash(params.perfect ? 'rgba(255,214,102,0.34)' : 'rgba(255,255,255,0.16)', params.perfect ? 140 : 90)
      playAudio(params.perfect ? 'perfect' : 'hit', params.perfect ? 0.62 : 0.46, params.perfect ? 1 : 0.98 + totalScore * 0.002)
    } else {
      triggerShake(params.hazard ? 8 : 3, params.hazard ? 220 : 110)
      triggerFlash(params.hazard ? 'rgba(255,107,107,0.34)' : 'rgba(255,122,122,0.2)', params.hazard ? 170 : 90)
      playAudio('miss', params.hazard ? 0.5 : 0.38, params.hazard ? 0.86 : 1)
    }
  }, [playAudio, spawnEffectBurst, triggerFlash, triggerShake])

  const collectPowerup = useCallback((item: PowerupItem) => {
    const collected = { ...item, collected: true }
    powerupRef.current = collected
    setPowerup(collected)
    activePowerupsRef.current = [...activePowerupsRef.current, item.type]
    setActivePowerups(activePowerupsRef.current)
    playAudio('powerup', 0.58, 1.02)
    triggerFlash('rgba(100,255,180,0.18)', 100)
    spawnEffectBurst(item.x, item.y, POWERUP_COLORS[item.type])

    if (item.type === 'extra-shot') {
      shotsRemainingRef.current += 1
      setShotsRemaining(shotsRemainingRef.current)
    }
    if (item.type === 'big-target') {
      const nextTargets = targetsRef.current.map((target) => ({ ...target, radius: target.radius + 8 }))
      targetsRef.current = nextTargets
      setTargets(nextTargets)
    }
    if (item.type === 'slow-wind') {
      windRef.current = Math.round(windRef.current * 0.35)
      setWind(windRef.current)
    }
  }, [playAudio, spawnEffectBurst, triggerFlash])

  const adjustAngle = useCallback((delta: number) => {
    if (phaseRef.current !== 'aiming') return
    const nextAngle = clampNumber(angleRef.current + delta, MIN_ANGLE_DEG, MAX_ANGLE_DEG)
    angleRef.current = nextAngle
    setAngleDeg(nextAngle)
  }, [])

  const fireProjectile = useCallback(() => {
    if (phaseRef.current !== 'aiming') return
    stopAudio('charge')

    const currentPower = Math.max(MIN_POWER, powerRef.current)
    const angleRad = degToRad(angleRef.current)
    const launchVelocity = createLaunchVelocity(angleRef.current, currentPower)
    const muzzle = {
      x: CANNON_X + Math.cos(angleRad) * 42,
      y: CANNON_Y - Math.sin(angleRad) * 42,
    }
    const nextProjectile: ProjectileState = {
      x: muzzle.x,
      y: muzzle.y,
      vx: launchVelocity.x,
      vy: launchVelocity.y,
    }

    projectileRef.current = nextProjectile
    setProjectile(nextProjectile)
    trailRef.current = [{ x: muzzle.x, y: muzzle.y }]
    setTrail(trailRef.current)
    phaseRef.current = 'flying'
    setPhase('flying')
    shotsRemainingRef.current -= 1
    setShotsRemaining(shotsRemainingRef.current)
    playAudio('fire', 0.72, 0.85 + currentPower / MAX_POWER * 0.25)
    window.setTimeout(() => playAudio('whoosh', 0.28, 0.95 + Math.random() * 0.2), FIRE_WHOOSH_DELAY_MS)
    triggerShake(4, 120)
    triggerFlash('rgba(255,177,64,0.24)', 80)
  }, [playAudio, stopAudio, triggerFlash, triggerShake])

  const beginCharge = useCallback(() => {
    if (phaseRef.current !== 'aiming' || isChargingRef.current) return
    isChargingRef.current = true
    setIsCharging(true)
    powerRef.current = MIN_POWER
    setPower(MIN_POWER)
    playAudio('charge', CHARGE_AUDIO_VOLUME, 0.82)
  }, [playAudio])

  const releaseCharge = useCallback(() => {
    if (!isChargingRef.current) return
    isChargingRef.current = false
    setIsCharging(false)
    fireProjectile()
  }, [fireProjectile])

  const handleAngleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextAngle = clampNumber(Number(event.target.value), MIN_ANGLE_DEG, MAX_ANGLE_DEG)
    angleRef.current = nextAngle
    setAngleDeg(nextAngle)
  }, [])

  const handleExit = useCallback(() => {
    finishedRef.current = true
    isChargingRef.current = false
    stopAudio('charge')
    onExit()
  }, [onExit, stopAudio])

  useEffect(() => {
    const audioMap: Record<AudioKey, string> = {
      fire: cannonFireSfx,
      hit: cannonHitSfx,
      whoosh: cannonWhooshSfx,
      miss: cannonMissSfx,
      perfect: cannonPerfectSfx,
      combo: cannonComboSfx,
      charge: cannonChargeSfx,
      powerup: cannonPowerupSfx,
      gameover: gameOverHitSfx,
    }

    for (const [key, src] of Object.entries(audioMap) as [AudioKey, string][]) {
      const audio = new Audio(src)
      audio.preload = 'auto'
      audioRefs.current[key] = audio
    }

    return () => {
      for (const audio of Object.values(audioRefs.current)) {
        if (audio === null) continue
        audio.pause()
        audio.currentTime = 0
      }
      audioRefs.current = {
        fire: null,
        hit: null,
        whoosh: null,
        miss: null,
        perfect: null,
        combo: null,
        charge: null,
        powerup: null,
        gameover: null,
      }
    }
  }, [])

  useEffect(() => {
    playSharedBgm(cannonShotBgmLoop, CANNON_SHOT_BGM_VOLUME)
    return () => {
      if (getActiveBgmTrack() === cannonShotBgmLoop) {
        stopSharedBgm()
      }
    }
  }, [])

  useEffect(() => {
    const handlePointerEnd = () => releaseCharge()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
        return
      }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowDown') {
        event.preventDefault()
        adjustAngle(-ANGLE_STEP)
        return
      }
      if (event.code === 'ArrowRight' || event.code === 'ArrowUp') {
        event.preventDefault()
        adjustAngle(ANGLE_STEP)
        return
      }
      if (event.code === 'Space' && !spaceHeldRef.current) {
        event.preventDefault()
        spaceHeldRef.current = true
        beginCharge()
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      event.preventDefault()
      spaceHeldRef.current = false
      releaseCharge()
    }
    const handleBlur = () => {
      spaceHeldRef.current = false
      releaseCharge()
    }

    window.addEventListener('pointerup', handlePointerEnd)
    window.addEventListener('pointercancel', handlePointerEnd)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('pointerup', handlePointerEnd)
      window.removeEventListener('pointercancel', handlePointerEnd)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [adjustAngle, beginCharge, handleExit, releaseCharge])

  useEffect(() => {
    lastFrameAtRef.current = null

    const step = (now: number) => {
      if (finishedRef.current) {
        animationFrameRef.current = null
        return
      }

      if (lastFrameAtRef.current === null) {
        lastFrameAtRef.current = now
      }

      const deltaMs = Math.min(now - lastFrameAtRef.current, MAX_FRAME_DELTA_MS)
      const deltaSec = deltaMs / 1000
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs
      setTimeRemainingMs(Math.max(0, GAME_TIMEOUT_MS - elapsedMsRef.current))
      updateParticles()

      if (elapsedMsRef.current >= GAME_TIMEOUT_MS) {
        finishGame()
        animationFrameRef.current = null
        return
      }

      if (phaseRef.current === 'aiming' || phaseRef.current === 'flying') {
        const movedTargets = stepMovingTargets(targetsRef.current, deltaSec)
        targetsRef.current = movedTargets
        setTargets(movedTargets)
      }

      if (bombRef.current !== null) {
        const nextBomb = stepBombHazard(bombRef.current, deltaSec)
        bombRef.current = nextBomb
        setBomb(nextBomb)
      }

      if (isChargingRef.current && phaseRef.current === 'aiming') {
        const nextPower = clampNumber(powerRef.current + POWER_FILL_SPEED * deltaSec, MIN_POWER, MAX_POWER)
        powerRef.current = nextPower
        setPower(nextPower)
      }

      if (phaseRef.current === 'flying' && projectileRef.current !== null) {
        let nextProjectile: ProjectileState = { ...projectileRef.current }
        nextProjectile = {
          ...nextProjectile,
          vx: nextProjectile.vx + windRef.current * deltaSec,
          vy: nextProjectile.vy + GRAVITY * deltaSec,
        }
        nextProjectile = applyWindTunnelForce(nextProjectile, windTunnelRef.current, deltaSec)
        nextProjectile = {
          ...nextProjectile,
          x: nextProjectile.x + nextProjectile.vx * deltaSec,
          y: nextProjectile.y + nextProjectile.vy * deltaSec,
        }

        const portalResolution = resolvePortalTeleport(nextProjectile, portalPairRef.current, portalLockRef.current)
        nextProjectile = portalResolution.projectile
        portalLockRef.current = portalResolution.lockedSide
        if (portalResolution.didTeleport) {
          playAudio('whoosh', 0.24, 1.14)
          spawnEffectBurst(nextProjectile.x, nextProjectile.y, '#93c5fd')
        }

        const nextTrail = [...trailRef.current, { x: nextProjectile.x, y: nextProjectile.y }]
        if (nextTrail.length > TRAIL_MAX_LENGTH) {
          nextTrail.splice(0, nextTrail.length - TRAIL_MAX_LENGTH)
        }
        trailRef.current = nextTrail
        setTrail(nextTrail)

        const activeItem = powerupRef.current
        if (activeItem !== null && !activeItem.collected) {
          const distanceToPowerup = distanceBetween(nextProjectile, activeItem)
          if (distanceToPowerup <= POWERUP_RADIUS + PROJECTILE_RADIUS) {
            collectPowerup(activeItem)
          }
        }

        const activeObstacle = obstacleRef.current
        if (activeObstacle !== null && pointInsideRect(nextProjectile, activeObstacle)) {
          const bounceScale = activeObstacle.kind === 'reflector' ? 0.9 : 0.62
          const fromLeft = projectileRef.current.x < activeObstacle.x
          const fromRight = projectileRef.current.x > activeObstacle.x + activeObstacle.width
          const fromTop = projectileRef.current.y < activeObstacle.y
          nextProjectile = {
            ...nextProjectile,
            x: projectileRef.current.x,
            y: projectileRef.current.y,
            vx: (fromLeft || fromRight) ? -nextProjectile.vx * bounceScale : nextProjectile.vx * 0.8,
            vy: fromTop ? -Math.abs(nextProjectile.vy) * bounceScale : nextProjectile.vy * 0.86,
          }
          projectileRef.current = nextProjectile
          setProjectile(nextProjectile)
          spawnEffectBurst(nextProjectile.x, nextProjectile.y, activeObstacle.kind === 'reflector' ? '#7dd3fc' : '#eab308')
          playAudio('miss', 0.24, activeObstacle.kind === 'reflector' ? 1.25 : 1.45)
          animationFrameRef.current = window.requestAnimationFrame(step)
          return
        }

        const activeBomb = bombRef.current
        if (activeBomb !== null && activeBomb.active) {
          const distanceToBomb = distanceBetween(nextProjectile, activeBomb)
          if (distanceToBomb <= activeBomb.radius + PROJECTILE_RADIUS) {
            const blast: ExplosionState = {
              x: activeBomb.x,
              y: activeBomb.y,
              remainingMs: EXPLOSION_DURATION_MS,
              color: '#ff7b6b',
              size: 18,
            }
            bombRef.current = { ...activeBomb, active: false }
            setBomb(bombRef.current)
            finalizeShot({
              baseScore: 0,
              label: 'BOOM!',
              x: activeBomb.x,
              y: activeBomb.y,
              color: '#ff7b6b',
              explosions: [blast],
              perfect: false,
              hazard: true,
            })
            animationFrameRef.current = window.requestAnimationFrame(step)
            return
          }
        }

        let earnedScore = 0
        let hitLabel = 'MISS'
        let hitColor = '#ff8b82'
        let hitX = clampNumber(nextProjectile.x, 20, VIEWBOX_WIDTH - 20)
        let hitY = clampNumber(nextProjectile.y, 20, VIEWBOX_HEIGHT - 20)
        let perfect = false
        const nextExplosions: ExplosionState[] = []

        for (const target of targetsRef.current) {
          const distanceToTarget = distanceBetween(nextProjectile, target)
          if (distanceToTarget > target.radius + PROJECTILE_RADIUS) continue

          const targetScore = scoreForDistance(distanceToTarget, target.radius)
          let targetEarned = targetScore.score
          if (targetEarned > 0 && target.isBonus) {
            targetEarned *= BONUS_TARGET_MULTIPLIER
          }
          if (targetEarned > 0 && activePowerupsRef.current.includes('double')) {
            targetEarned *= 2
          }

          earnedScore += targetEarned
          if (targetScore.score >= 100) {
            perfect = true
          }
          if (targetScore.score > 0) {
            hitLabel = targetScore.label
            hitColor = targetScore.score >= 100 ? '#ffe066' : target.isBonus ? '#c4b5fd' : '#f8d176'
            hitX = target.x
            hitY = target.y
          }
          nextExplosions.push({
            x: target.x,
            y: target.y,
            remainingMs: EXPLOSION_DURATION_MS,
            color: target.isBonus ? '#c4b5fd' : '#f4a261',
            size: target.radius + 6,
          })
        }

        const isOutOfBounds =
          nextProjectile.x < -PROJECTILE_PADDING ||
          nextProjectile.x > VIEWBOX_WIDTH + PROJECTILE_PADDING ||
          nextProjectile.y < -120 ||
          nextProjectile.y > VIEWBOX_HEIGHT + PROJECTILE_PADDING

        if (earnedScore > 0) {
          finalizeShot({
            baseScore: earnedScore,
            label: hitLabel,
            x: hitX,
            y: hitY,
            color: hitColor,
            explosions: nextExplosions,
            perfect,
            hazard: false,
          })
          animationFrameRef.current = window.requestAnimationFrame(step)
          return
        }

        if (isOutOfBounds) {
          finalizeShot({
            baseScore: 0,
            label: 'MISS',
            x: hitX,
            y: hitY,
            color: '#ff8b82',
            explosions: [{
              x: hitX,
              y: hitY,
              remainingMs: EXPLOSION_DURATION_MS * 0.72,
              color: '#7f8c8d',
              size: 14,
            }],
            perfect: false,
            hazard: false,
          })
          animationFrameRef.current = window.requestAnimationFrame(step)
          return
        }

        projectileRef.current = nextProjectile
        setProjectile(nextProjectile)
      }

      if (phaseRef.current === 'result') {
        const nextExplosions = explosionsRef.current
          .map((explosion) => ({ ...explosion, remainingMs: explosion.remainingMs - deltaMs }))
          .filter((explosion) => explosion.remainingMs > 0)
        explosionsRef.current = nextExplosions
        setExplosions(nextExplosions)

        if (shotResultRef.current !== null) {
          const nextRemaining = shotResultRef.current.remainingMs - deltaMs
          if (nextRemaining <= 0) {
            shotResultRef.current = null
            setShotResult(null)
            advanceToNextShot()
          } else {
            const nextResult = { ...shotResultRef.current, remainingMs: nextRemaining }
            shotResultRef.current = nextResult
            setShotResult(nextResult)
          }
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
      cleanup()
    }
  }, [advanceToNextShot, cleanup, collectPowerup, finalizeShot, finishGame, playAudio, spawnEffectBurst, updateParticles])

  const displayedBestScore = Math.max(bestScore, score)
  const powerPercent = power <= 0 ? 0 : ((power - MIN_POWER) / (MAX_POWER - MIN_POWER)) * 100
  const powerBarColor = powerPercent >= POWER_BAR_DANGER
    ? '#f94144'
    : powerPercent >= POWER_BAR_WARNING
      ? '#f9c74f'
      : '#8ce99a'
  const windLabel = wind === 0 ? '0' : `${wind > 0 ? '>' : '<'} ${Math.abs(wind)}`
  const timeLabel = `${Math.ceil(timeRemainingMs / 1000)}s`
  const hintLabel =
    phase === 'aiming'
      ? isCharging ? 'Release to launch the shot.' : 'Hold FIRE to charge the cannon.'
      : phase === 'flying'
        ? 'Watch wind, portals, and hazards.'
        : phase === 'result'
          ? 'Next layout incoming.'
          : 'Round complete.'

  return (
    <section
      ref={panelRef}
      className="mini-game-panel cannon-shot-panel"
      aria-label="cannon-shot-game"
      style={{ ...getShakeStyle() }}
    >
      <header className="cannon-shot-hud">
        <div className="cannon-shot-side-card">
          <span className="cannon-shot-side-label">SHOT</span>
          <strong className="cannon-shot-side-value">{currentShot}</strong>
          <span className="cannon-shot-side-sub">{shotsRemaining} LEFT</span>
        </div>
        <div className="cannon-shot-score-card">
          <span className="cannon-shot-score-label">SCORE</span>
          <strong className="cannon-shot-score">{score.toLocaleString()}</strong>
          <span className="cannon-shot-score-best">BEST {displayedBestScore.toLocaleString()}</span>
        </div>
        <div className="cannon-shot-side-card right">
          <span className="cannon-shot-side-label">WIND</span>
          <strong className="cannon-shot-side-value">{windLabel}</strong>
          <span className="cannon-shot-side-sub">{timeLabel}</span>
        </div>
      </header>

      <div className="cannon-shot-tag-row" aria-label="cannon-shot-gimmicks">
        {gimmickTags.map((tag) => (
          <span key={tag} className="cannon-shot-tag">{tag}</span>
        ))}
        {hitStreak >= 3 && <span className="cannon-shot-tag streak">STREAK x{hitStreak}</span>}
      </div>

      {activePowerups.length > 0 && (
        <div className="cannon-shot-powerup-row">
          {activePowerups.map((powerupType) => (
            <span
              key={powerupType}
              className="cannon-shot-powerup-chip"
              style={{ background: POWERUP_COLORS[powerupType] }}
            >
              {POWERUP_LABELS[powerupType]}
            </span>
          ))}
        </div>
      )}

      <div ref={boardRef} className="cannon-shot-board">
        <svg
          className="cannon-shot-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-label="cannon-shot-field"
          shapeRendering="crispEdges"
        >
          <defs>
            <pattern id="cannon-shot-grid" width="8" height="8" patternUnits="userSpaceOnUse">
              <rect width="8" height="8" fill="rgba(0,0,0,0)" />
              <path d="M8 0H0V8" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            </pattern>
          </defs>

          <image
            href={cannonShotBackground}
            x="0"
            y="0"
            width={VIEWBOX_WIDTH}
            height={VIEWBOX_HEIGHT}
            preserveAspectRatio="xMidYMid slice"
            style={{ imageRendering: 'pixelated' }}
          />
          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="rgba(8,14,26,0.24)" />
          <rect x="0" y="0" width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#cannon-shot-grid)" />

          {windTunnel !== null && <PixelWindTunnel tunnel={windTunnel} />}
          {portalPair !== null && <PixelPortal portalPair={portalPair} />}
          {obstacle !== null && <PixelObstacle obstacle={obstacle} />}
          {powerup !== null && !powerup.collected && <PixelPowerup item={powerup} />}
          {bomb !== null && bomb.active && <PixelBomb bomb={bomb} />}

          {targets.map((target, index) => (
            <PixelTarget key={`target-${index}`} target={target} />
          ))}

          {phase === 'aiming' && <PixelAimGuide angleDeg={angleDeg} />}
          <PixelCannon angleDeg={angleDeg} power={power} isCharging={isCharging} />

          {trail.filter((_, index) => index % TRAIL_STRIDE === 0).map((point, index) => (
            <rect
              key={`trail-${index}`}
              x={point.x - 2}
              y={point.y - 2}
              width="4"
              height="4"
              fill={index % 2 === 0 ? '#f8d176' : '#f59f00'}
              opacity={0.18 + index / Math.max(1, trail.length)}
            />
          ))}

          {projectile !== null && (
            <g>
              <rect x={projectile.x - 5} y={projectile.y - 5} width="10" height="10" fill="#1f2933" />
              <rect x={projectile.x - 3} y={projectile.y - 3} width="6" height="6" fill="#9aa5b1" />
            </g>
          )}

          {explosions.map((explosion, index) => (
            <PixelExplosion key={`explosion-${index}`} explosion={explosion} />
          ))}

          {shotResult !== null && (
            <g>
              <text
                x={shotResult.x}
                y={shotResult.y - 30}
                textAnchor="middle"
                fill={shotResult.color}
                fontSize="22"
                fontWeight="700"
                fontFamily="'Press Start 2P', monospace"
                opacity={clampNumber(shotResult.remainingMs / (RESULT_DISPLAY_MS * 0.45), 0, 1)}
              >
                {shotResult.label}
              </text>
              {shotResult.score > 0 && (
                <text
                  x={shotResult.x}
                  y={shotResult.y - 8}
                  textAnchor="middle"
                  fill="#fff7d6"
                  fontSize="16"
                  fontWeight="700"
                  fontFamily="'Press Start 2P', monospace"
                  opacity={clampNumber(shotResult.remainingMs / (RESULT_DISPLAY_MS * 0.45), 0, 1)}
                >
                  +{shotResult.score}
                </text>
              )}
            </g>
          )}

          <rect x="0" y={GROUND_Y} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT - GROUND_Y} fill="rgba(10,12,18,0.34)" />
        </svg>
      </div>

      <div className="cannon-shot-controls">
        <div className="cannon-shot-angle-row">
          <button className="cannon-shot-angle-btn" type="button" onClick={() => adjustAngle(-ANGLE_STEP)} disabled={phase !== 'aiming'}>
            -
          </button>
          <div className="cannon-shot-angle-panel">
            <span className="cannon-shot-angle-text">ANGLE {Math.round(angleDeg)}°</span>
            <input
              className="cannon-shot-angle-slider"
              type="range"
              min={MIN_ANGLE_DEG}
              max={MAX_ANGLE_DEG}
              value={angleDeg}
              onChange={handleAngleChange}
              disabled={phase !== 'aiming'}
            />
          </div>
          <button className="cannon-shot-angle-btn" type="button" onClick={() => adjustAngle(ANGLE_STEP)} disabled={phase !== 'aiming'}>
            +
          </button>
        </div>

        <div className="cannon-shot-power-row">
          <span className="cannon-shot-power-label">PWR</span>
          <div className="cannon-shot-power-bar">
            <div
              className="cannon-shot-power-fill"
              style={{
                width: `${clampNumber(powerPercent, 0, 100)}%`,
                background: `linear-gradient(90deg, #59d98e, ${powerBarColor})`,
              }}
            />
          </div>
          <span className="cannon-shot-power-value">{Math.round(clampNumber(powerPercent, 0, 100))}%</span>
        </div>

        <button
          className={`cannon-shot-fire-btn ${isCharging ? 'charging' : ''}`}
          type="button"
          onPointerDown={(event) => {
            event.preventDefault()
            beginCharge()
          }}
          onContextMenu={(event) => event.preventDefault()}
          disabled={phase !== 'aiming'}
          aria-pressed={isCharging}
        >
          {phase === 'aiming' ? (isCharging ? 'RELEASE!' : 'HOLD FIRE') : phase === 'flying' ? 'FLYING...' : phase === 'result' ? 'RELOADING' : 'ROUND OVER'}
        </button>

        <p className="cannon-shot-hint">{hintLabel}</p>
      </div>

      <style>{GAME_EFFECTS_CSS}</style>
      <style>{CANNON_SHOT_CSS}</style>
      <FlashOverlay isFlashing={isFlashing} flashColor={flashColor} />
      <ParticleRenderer particles={particles} />
      <ScorePopupRenderer popups={scorePopups} />
    </section>
  )
}

function PixelTarget({ target }: { target: TargetInfo }) {
  const size = target.radius * 2
  const innerSize = Math.max(8, size - 10)
  const coreSize = Math.max(4, size - 18)
  return (
    <g transform={`translate(${target.x}, ${target.y})`}>
      <rect x={-target.radius - 4} y={target.radius + 6} width={target.radius * 2 + 8} height="4" fill="rgba(0,0,0,0.24)" />
      <rect
        x={-target.radius - 4}
        y={-target.radius - 4}
        width={size + 8}
        height={size + 8}
        fill={target.isBonus ? '#b794f4' : '#f97316'}
        opacity="0.35"
      />
      <rect
        x={-target.radius}
        y={-target.radius}
        width={size}
        height={size}
        fill={target.isBonus ? '#8b5cf6' : '#ef4444'}
      />
      <rect x={-innerSize / 2} y={-innerSize / 2} width={innerSize} height={innerSize} fill="#fff7d6" />
      <rect x={-coreSize / 2} y={-coreSize / 2} width={coreSize} height={coreSize} fill={target.isBonus ? '#7c3aed' : '#b91c1c'} />
      <rect x="-2" y={-target.radius} width="4" height={size} fill="#2d1b1b" opacity="0.45" />
      <rect x={-target.radius} y="-2" width={size} height="4" fill="#2d1b1b" opacity="0.45" />
      {target.isBonus && (
        <text
          x="0"
          y={-target.radius - 12}
          textAnchor="middle"
          fill="#ede9fe"
          fontSize="10"
          fontWeight="700"
          fontFamily="'Press Start 2P', monospace"
        >
          x3
        </text>
      )}
      {target.moving && (
        target.axis === 'y' ? (
          <>
            <rect x="-3" y={-target.radius - 18} width="6" height="8" fill="#fcd34d" />
            <rect x="-3" y={target.radius + 10} width="6" height="8" fill="#fcd34d" />
          </>
        ) : (
          <>
            <rect x={-target.radius - 18} y="-3" width="8" height="6" fill="#fcd34d" />
            <rect x={target.radius + 10} y="-3" width="8" height="6" fill="#fcd34d" />
          </>
        )
      )}
    </g>
  )
}

function PixelObstacle({ obstacle }: { obstacle: Obstacle }) {
  const face = obstacle.kind === 'reflector' ? '#38bdf8' : '#8b5a2b'
  const detail = obstacle.kind === 'reflector' ? '#dbeafe' : '#c08457'
  return (
    <g>
      <rect x={obstacle.x + 4} y={obstacle.y + obstacle.height + 4} width={obstacle.width} height="5" fill="rgba(0,0,0,0.24)" />
      <rect x={obstacle.x} y={obstacle.y} width={obstacle.width} height={obstacle.height} fill={face} />
      {Array.from({ length: Math.floor(obstacle.height / 12) }, (_, index) => (
        <rect
          key={`obstacle-row-${index}`}
          x={obstacle.x + (index % 2 === 0 ? 0 : 6)}
          y={obstacle.y + index * 12 + 4}
          width={Math.max(10, obstacle.width - 6)}
          height="4"
          fill={detail}
          opacity="0.6"
        />
      ))}
    </g>
  )
}

function PixelPowerup({ item }: { item: PowerupItem }) {
  return (
    <g transform={`translate(${item.x}, ${item.y})`}>
      <rect x="-18" y="-18" width="36" height="36" fill={POWERUP_COLORS[item.type]} opacity="0.16" />
      <rect x="-12" y="-12" width="24" height="24" fill={POWERUP_COLORS[item.type]} />
      <rect x="-6" y="-18" width="12" height="6" fill="#fff4c2" />
      <rect x="-6" y="12" width="12" height="6" fill="#fff4c2" />
      <rect x="-18" y="-6" width="6" height="12" fill="#fff4c2" />
      <rect x="12" y="-6" width="6" height="12" fill="#fff4c2" />
      <text
        x="0"
        y="4"
        textAnchor="middle"
        fill="#132238"
        fontSize="8"
        fontWeight="700"
        fontFamily="'Press Start 2P', monospace"
      >
        {POWERUP_LABELS[item.type]}
      </text>
    </g>
  )
}

function PixelPortal({ portalPair }: { portalPair: PortalPair }) {
  return (
    <>
      <PixelPortalNode center={portalPair.entry} color="#60a5fa" />
      <PixelPortalNode center={portalPair.exit} color="#a78bfa" />
    </>
  )
}

function PixelPortalNode({ center, color }: { center: Point; color: string }) {
  return (
    <g transform={`translate(${center.x}, ${center.y})`}>
      <rect x="-24" y="-24" width="48" height="48" fill={color} opacity="0.14" />
      <rect x="-18" y="-18" width="36" height="36" fill="none" stroke={color} strokeWidth="4" />
      <rect x="-12" y="-12" width="24" height="24" fill="rgba(11,18,32,0.86)" />
      <rect x="-4" y="-24" width="8" height="6" fill="#fff7d6" />
      <rect x="-4" y="18" width="8" height="6" fill="#fff7d6" />
      <rect x="-24" y="-4" width="6" height="8" fill="#fff7d6" />
      <rect x="18" y="-4" width="6" height="8" fill="#fff7d6" />
    </g>
  )
}

function PixelWindTunnel({ tunnel }: { tunnel: WindTunnel }) {
  const arrowColor = tunnel.force > 0 ? '#7dd3fc' : '#c4b5fd'
  return (
    <g>
      <rect x={tunnel.x} y={tunnel.y} width={tunnel.width} height={tunnel.height} fill={arrowColor} opacity="0.18" />
      {Array.from({ length: 4 }, (_, row) => (
        <g key={`jet-${row}`}>
          {Array.from({ length: 4 }, (_, col) => {
            const offsetX = tunnel.force > 0 ? col * 20 : tunnel.width - 18 - col * 20
            return (
              <rect
                key={`jet-${row}-${col}`}
                x={tunnel.x + offsetX}
                y={tunnel.y + 10 + row * 13}
                width="12"
                height="4"
                fill={arrowColor}
                opacity={0.34 + col * 0.1}
              />
            )
          })}
        </g>
      ))}
    </g>
  )
}

function PixelBomb({ bomb }: { bomb: BombHazard }) {
  return (
    <g transform={`translate(${bomb.x}, ${bomb.y})`}>
      <rect x="-14" y="-14" width="28" height="28" fill="#1f2937" />
      <rect x="-10" y="-10" width="20" height="20" fill="#374151" />
      <rect x="-4" y="-22" width="8" height="10" fill="#f97316" />
      <rect x="2" y="-26" width="6" height="6" fill="#fde68a" />
    </g>
  )
}

function PixelCannon({
  angleDeg,
  power,
  isCharging,
}: {
  angleDeg: number
  power: number
  isCharging: boolean
}) {
  const angleRad = degToRad(angleDeg)
  const muzzleX = CANNON_X + Math.cos(angleRad) * 40
  const muzzleY = CANNON_Y - Math.sin(angleRad) * 40
  const barrelBlocks = buildPixelLine(CANNON_X + 6, CANNON_Y - 10, muzzleX, muzzleY, 6)
  return (
    <g>
      <rect x={CANNON_X - 28} y={CANNON_Y + 10} width="44" height="10" fill="#47331f" />
      <rect x={CANNON_X - 22} y={CANNON_Y + 4} width="34" height="8" fill="#8b5a2b" />
      <rect x={CANNON_X - 30} y={CANNON_Y + 18} width="12" height="12" fill="#283044" />
      <rect x={CANNON_X + 8} y={CANNON_Y + 18} width="12" height="12" fill="#283044" />
      <rect x={CANNON_X - 26} y={CANNON_Y + 22} width="4" height="4" fill="#94a3b8" />
      <rect x={CANNON_X + 12} y={CANNON_Y + 22} width="4" height="4" fill="#94a3b8" />

      {barrelBlocks.map((block, index) => (
        <rect
          key={`barrel-${index}`}
          x={block.x - 6}
          y={block.y - 6}
          width="12"
          height="12"
          fill={index === barrelBlocks.length - 1 ? '#cbd5e1' : '#475569'}
        />
      ))}

      <rect x={CANNON_X - 6} y={CANNON_Y - 14} width="16" height="16" fill="#1f2937" />

      {isCharging && (
        <>
          <rect x={muzzleX - 8} y={muzzleY - 8} width="16" height="16" fill="#ffe066" opacity="0.8" />
          <rect
            x={muzzleX - 3 - (power / MAX_POWER) * 4}
            y={muzzleY - 3 - (power / MAX_POWER) * 4}
            width={6 + (power / MAX_POWER) * 8}
            height={6 + (power / MAX_POWER) * 8}
            fill="#fff7d6"
            opacity="0.6"
          />
        </>
      )}
    </g>
  )
}

function PixelAimGuide({ angleDeg }: { angleDeg: number }) {
  const angleRad = degToRad(angleDeg)
  const points = buildPixelLine(
    CANNON_X + Math.cos(angleRad) * 42,
    CANNON_Y - Math.sin(angleRad) * 42,
    CANNON_X + Math.cos(angleRad) * 120,
    CANNON_Y - Math.sin(angleRad) * 120,
    12,
  )
  return (
    <g>
      {points.map((point, index) => (
        <rect
          key={`guide-${index}`}
          x={point.x - 2}
          y={point.y - 2}
          width="4"
          height="4"
          fill="#fff7d6"
          opacity={0.22 + index * 0.08}
        />
      ))}
    </g>
  )
}

function PixelExplosion({ explosion }: { explosion: ExplosionState }) {
  const progress = 1 - explosion.remainingMs / EXPLOSION_DURATION_MS
  const scale = 1 + progress * 1.6
  return (
    <g transform={`translate(${explosion.x}, ${explosion.y}) scale(${scale})`}>
      <rect x="-8" y="-8" width="16" height="16" fill={explosion.color} opacity={0.75 - progress * 0.45} />
      <rect x="-14" y="-4" width="8" height="8" fill="#fff7d6" opacity={0.6 - progress * 0.4} />
      <rect x="6" y="-4" width="8" height="8" fill="#fff7d6" opacity={0.6 - progress * 0.4} />
      <rect x="-4" y="-14" width="8" height="8" fill="#fff7d6" opacity={0.6 - progress * 0.4} />
      <rect x="-4" y="6" width="8" height="8" fill="#fff7d6" opacity={0.6 - progress * 0.4} />
    </g>
  )
}

function buildPixelLine(startX: number, startY: number, endX: number, endY: number, step: number): Point[] {
  const dx = endX - startX
  const dy = endY - startY
  const distance = Math.max(1, Math.hypot(dx, dy))
  const count = Math.max(1, Math.floor(distance / step))
  return Array.from({ length: count + 1 }, (_, index) => ({
    x: startX + (dx * index) / count,
    y: startY + (dy * index) / count,
  }))
}

const CANNON_SHOT_CSS = `
  .cannon-shot-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    margin: 0 auto;
    overflow: hidden;
    color: #fff7d6;
    background: linear-gradient(180deg, #0b1220 0%, #111827 100%);
    font-family: 'DungGeunMo', 'Press Start 2P', monospace;
    image-rendering: pixelated;
  }

  .cannon-shot-hud {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.45fr) minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    padding: 10px 12px 6px;
    background: linear-gradient(180deg, rgba(7, 11, 21, 0.96), rgba(7, 11, 21, 0.78));
    border-bottom: 3px solid rgba(255, 214, 102, 0.18);
    z-index: 3;
  }

  .cannon-shot-side-card,
  .cannon-shot-score-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .cannon-shot-side-card.right {
    align-items: flex-end;
    text-align: right;
  }

  .cannon-shot-side-label,
  .cannon-shot-score-label,
  .cannon-shot-side-sub,
  .cannon-shot-score-best,
  .cannon-shot-hint {
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .cannon-shot-side-label,
  .cannon-shot-side-sub,
  .cannon-shot-score-label,
  .cannon-shot-score-best {
    font-size: 10px;
    opacity: 0.84;
  }

  .cannon-shot-side-value {
    font-size: clamp(18px, 4vw, 24px);
    color: #fff0a8;
    line-height: 1.05;
  }

  .cannon-shot-score-card {
    align-items: center;
    text-align: center;
  }

  .cannon-shot-score {
    font-size: clamp(34px, 8vw, 56px);
    line-height: 0.9;
    color: #ffe066;
    text-shadow: 0 0 16px rgba(255, 214, 102, 0.26);
  }

  .cannon-shot-tag-row,
  .cannon-shot-powerup-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px 0;
    z-index: 2;
  }

  .cannon-shot-tag,
  .cannon-shot-powerup-chip {
    padding: 4px 8px;
    border: 2px solid rgba(255, 255, 255, 0.18);
    background: rgba(12, 18, 32, 0.72);
    font-size: 10px;
    line-height: 1;
    letter-spacing: 0.6px;
  }

  .cannon-shot-tag.streak {
    color: #ffe066;
    border-color: rgba(255, 224, 102, 0.5);
  }

  .cannon-shot-powerup-chip {
    color: #132238;
    border-color: rgba(0, 0, 0, 0.12);
  }

  .cannon-shot-board {
    position: relative;
    flex: 1;
    min-height: 0;
    margin: 8px 10px 0;
    overflow: hidden;
    border: 4px solid rgba(255, 214, 102, 0.2);
    box-shadow: inset 0 0 0 3px rgba(8, 12, 24, 0.7);
    background: #09111d;
  }

  .cannon-shot-svg {
    display: block;
    width: 100%;
    height: 100%;
    image-rendering: pixelated;
  }

  .cannon-shot-controls {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 12px 14px;
    background: linear-gradient(180deg, rgba(9, 14, 26, 0.94), rgba(7, 10, 18, 0.98));
    border-top: 3px solid rgba(255, 214, 102, 0.12);
  }

  .cannon-shot-angle-row,
  .cannon-shot-power-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .cannon-shot-angle-btn {
    width: 44px;
    height: 44px;
    border: 0;
    background: linear-gradient(180deg, #2a3750, #162033);
    color: #fff7d6;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
  }

  .cannon-shot-angle-btn:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .cannon-shot-angle-panel {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
  }

  .cannon-shot-angle-text,
  .cannon-shot-power-label,
  .cannon-shot-power-value {
    font-size: 12px;
  }

  .cannon-shot-angle-slider {
    width: 100%;
    accent-color: #ffd166;
    height: 24px;
  }

  .cannon-shot-power-label {
    width: 34px;
    color: #ffe066;
  }

  .cannon-shot-power-bar {
    flex: 1;
    height: 18px;
    border: 2px solid rgba(255, 214, 102, 0.18);
    background: rgba(15, 23, 42, 0.9);
    overflow: hidden;
  }

  .cannon-shot-power-fill {
    height: 100%;
    transition: width 0.05s linear;
  }

  .cannon-shot-power-value {
    width: 48px;
    text-align: right;
  }

  .cannon-shot-fire-btn {
    width: 100%;
    min-height: 76px;
    border: 0;
    background: linear-gradient(180deg, #f97316, #dc2626);
    color: #fff7d6;
    font-size: clamp(18px, 4vw, 26px);
    letter-spacing: 1px;
    cursor: pointer;
    box-shadow: inset 0 -6px 0 rgba(0, 0, 0, 0.2);
    touch-action: none;
  }

  .cannon-shot-fire-btn.charging {
    background: linear-gradient(180deg, #ffe066, #f97316);
    color: #1f2937;
  }

  .cannon-shot-fire-btn:disabled {
    opacity: 0.48;
    cursor: default;
  }

  .cannon-shot-hint {
    margin: 0;
    text-align: center;
    font-size: 11px;
    opacity: 0.78;
  }

  @media (max-width: 480px) {
    .cannon-shot-hud {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr);
      gap: 6px;
      padding: 10px 8px 6px;
    }

    .cannon-shot-score {
      font-size: 34px;
    }

    .cannon-shot-side-value {
      font-size: 16px;
    }
  }
`

export const cannonShotModule: MiniGameModule = {
  manifest: {
    id: 'cannon-shot',
    title: 'Cannon Shot',
    description: 'Pixel cannon artillery with portals, wind jets, bonus targets, and bomb hazards.',
    unlockCost: 50,
    baseReward: 16,
    scoreRewardMultiplier: 1.2,
    accentColor: '#dc2626',
  },
  Component: CannonShotGame,
}
