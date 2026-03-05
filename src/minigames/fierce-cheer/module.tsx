import { useCallback, useEffect, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { MAX_FRAME_DELTA_MS } from '../../primitives/constants'

import kimYeonjaSprite from '../../../assets/images/same-character/kim-yeonja.png'
import parkSangminSprite from '../../../assets/images/same-character/park-sangmin.png'
import parkWankyuSprite from '../../../assets/images/same-character/park-wankyu.png'
import songChangsikSprite from '../../../assets/images/same-character/song-changsik.png'
import cheerStickImg from '../../../assets/images/generated/fierce-cheer/cheer-stick.png'

import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import tapHitStrongSfx from '../../../assets/sounds/tap-hit-strong.mp3'

const ROUND_DURATION_MS = 20_000
const VIEWBOX_WIDTH = 360
const VIEWBOX_HEIGHT = 640

const CYLINDER_Y = 510
const CYLINDER_WIDTH = 320
const CYLINDER_HEIGHT = 56
const CYLINDER_LEFT = (VIEWBOX_WIDTH - CYLINDER_WIDTH) / 2
const CYLINDER_RADIUS = CYLINDER_HEIGHT / 2
const STICK_W = 100
const STICK_H = 48
const EDGE_THRESHOLD = 8

const STAGE_FLOOR_Y = 370

const PERFORMERS = [
  { name: '김연자', src: kimYeonjaSprite, cx: 48, phase: 0 },
  { name: '박완규', src: parkWankyuSprite, cx: 138, phase: 1 },
  { name: '송창식', src: songChangsikSprite, cx: 228, phase: 2 },
  { name: '박상민', src: parkSangminSprite, cx: 318, phase: 3 },
] as const

type WallSide = 'left' | 'right' | null

interface Spark {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  life: number
  color: string
}

interface ScorePop {
  id: number
  x: number
  y: number
  value: string
  born: number
}

let sparkId = 0

function FierceCheerGame({ onFinish, onExit }: MiniGameSessionProps) {
  const boardRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef({
    ballX: CYLINDER_WIDTH / 2,
    score: 0,
    lastWallHit: null as WallSide,
    timeRemainingMs: ROUND_DURATION_MS,
    started: false,
    finished: false,
    pointerRatioX: 0.5,
    isPointerDown: false,
    startedAtMs: 0,
    lastFrameAtMs: 0,
    hitFlashSide: null as WallSide,
    hitFlashTimer: 0,
    comboCount: 0,
    comboLastHitAt: 0,
    greatLastAt: 0,
    shakeX: 0,
    shakeY: 0,
    shakeTimer: 0,
    sparks: [] as Spark[],
    scorePops: [] as ScorePop[],
  })
  const rafRef = useRef<number | null>(null)

  const [, forceRender] = useState(0)
  const tick = useCallback(() => forceRender((n) => n + 1), [])

  const playHit = useCallback((strong: boolean) => {
    const a = new Audio(strong ? tapHitStrongSfx : tapHitSfx)
    a.volume = strong ? 0.7 : 0.5
    void a.play().catch(() => {})
  }, [])

  const spawnSparks = useCallback((x: number, y: number, dir: number) => {
    const s = stateRef.current
    const colors = ['#fbbf24', '#f59e0b', '#ff6b6b', '#a855f7', '#fff', '#22d3ee']
    for (let i = 0; i < 12; i++) {
      const angle = (dir === -1 ? Math.PI * 0.3 : -Math.PI * 0.3) + (Math.random() - 0.5) * Math.PI * 0.8
      const speed = 80 + Math.random() * 180
      s.sparks.push({
        id: sparkId++,
        x, y,
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed - 60 - Math.random() * 80,
        life: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
      })
    }
  }, [])

  const onWallHit = useCallback((side: WallSide) => {
    const s = stateRef.current
    const now = performance.now()
    s.lastWallHit = side
    s.score += 1
    s.comboCount += 1
    s.comboLastHitAt = now
    s.hitFlashSide = side
    s.hitFlashTimer = 150

    // Gentle shake - just a nudge
    s.shakeTimer = 80
    s.shakeX = (side === 'left' ? 2 : -2)
    s.shakeY = (Math.random() - 0.5) * 1.5

    // Sparks
    const sparkX = side === 'left' ? CYLINDER_LEFT + 10 : CYLINDER_LEFT + CYLINDER_WIDTH - 10
    const sparkY = CYLINDER_Y + CYLINDER_HEIGHT / 2
    const dir = side === 'left' ? 1 : -1
    spawnSparks(sparkX, sparkY, dir)

    // Score pop
    s.scorePops.push({
      id: sparkId++,
      x: sparkX + dir * 20,
      y: sparkY - 30,
      value: s.comboCount >= 10 ? `+1 x${s.comboCount}` : '+1',
      born: now,
    })
    if (s.scorePops.length > 8) s.scorePops.shift()

    const strong = s.comboCount >= 5 && s.comboCount % 5 === 0
    playHit(strong)

    if (strong) {
      s.greatLastAt = now
    }
  }, [playHit, spawnSparks])

  const gameLoop = useCallback(() => {
    const s = stateRef.current
    if (s.finished) return

    const now = performance.now()
    if (!s.started) {
      s.started = true
      s.startedAtMs = now
      s.lastFrameAtMs = now
    }

    const deltaMs = Math.min(now - s.lastFrameAtMs, MAX_FRAME_DELTA_MS)
    s.lastFrameAtMs = now
    const dt = deltaMs / 1000
    s.timeRemainingMs = Math.max(0, ROUND_DURATION_MS - (now - s.startedAtMs))

    if (s.timeRemainingMs <= 0) {
      s.finished = true
      onFinish({ score: s.score, durationMs: ROUND_DURATION_MS })
      return
    }

    if (s.isPointerDown) {
      s.ballX = s.pointerRatioX * CYLINDER_WIDTH
    }

    const half = STICK_W / 2
    s.ballX = Math.max(half, Math.min(CYLINDER_WIDTH - half, s.ballX))

    if (s.ballX <= half + EDGE_THRESHOLD && s.lastWallHit !== 'left') {
      onWallHit('left')
    } else if (s.ballX >= CYLINDER_WIDTH - half - EDGE_THRESHOLD && s.lastWallHit !== 'right') {
      onWallHit('right')
    }

    if (s.hitFlashTimer > 0) {
      s.hitFlashTimer -= deltaMs
      if (s.hitFlashTimer <= 0) s.hitFlashSide = null
    }

    // Gentle shake decay
    if (s.shakeTimer > 0) {
      s.shakeTimer -= deltaMs
      if (s.shakeTimer <= 0) { s.shakeX = 0; s.shakeY = 0 }
      else {
        const t = s.shakeTimer / 80
        s.shakeX *= t
        s.shakeY *= t
      }
    }

    // Update sparks
    for (let i = s.sparks.length - 1; i >= 0; i--) {
      const sp = s.sparks[i]
      sp.x += sp.vx * dt
      sp.y += sp.vy * dt
      sp.vy += 300 * dt
      sp.life -= dt * 2.5
      if (sp.life <= 0) s.sparks.splice(i, 1)
    }

    // Clean old score pops
    s.scorePops = s.scorePops.filter((p) => now - p.born < 800)

    tick()
    rafRef.current = requestAnimationFrame(gameLoop)
  }, [onFinish, onWallHit, tick])

  useEffect(() => {
    rafRef.current = requestAnimationFrame(gameLoop)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [gameLoop])

  const getPointerRatio = useCallback((clientX: number): number => {
    const board = boardRef.current
    if (!board) return 0.5
    const rect = board.getBoundingClientRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    stateRef.current.isPointerDown = true
    stateRef.current.pointerRatioX = getPointerRatio(e.clientX)
  }, [getPointerRatio])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!stateRef.current.isPointerDown) return
    stateRef.current.pointerRatioX = getPointerRatio(e.clientX)
  }, [getPointerRatio])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    stateRef.current.isPointerDown = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  const s = stateRef.current
  const now = performance.now()

  // Smooth time display (0.1s increments)
  const timeLeftSmooth = Math.max(0, s.timeRemainingMs / 1000)
  const timeDisplay = timeLeftSmooth.toFixed(1)
  const timeProgress = timeLeftSmooth / (ROUND_DURATION_MS / 1000)
  const timeBarColor = timeProgress > 0.3 ? '#4ade80' : timeProgress > 0.15 ? '#fbbf24' : '#ef4444'

  // Combo fade: smooth fade out over 1.2s after last hit
  const comboAge = (now - s.comboLastHitAt) / 1200
  const comboOpacity = s.comboCount >= 3 ? Math.max(0, 1 - Math.max(0, comboAge - 0.3)) : 0

  // GREAT fade: smooth fade out over 0.8s
  const greatAge = (now - s.greatLastAt) / 800
  const greatOpacity = greatAge < 1 ? 1 - greatAge : 0

  const stickCx = CYLINDER_LEFT + s.ballX
  const flashSide = s.hitFlashSide

  return (
    <section className="mini-game-panel fierce-cheer-panel" aria-label="fierce-cheer-game">
      <div
        ref={boardRef}
        className="fierce-cheer-board"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        role="presentation"
        style={{ touchAction: 'none', userSelect: 'none' }}
      >
        <svg
          className="fierce-cheer-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ pointerEvents: 'none' }}
        >
          <defs>
            <linearGradient id="fc-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a0533" />
              <stop offset="40%" stopColor="#2d1b69" />
              <stop offset="100%" stopColor="#4c1d95" />
            </linearGradient>
            <radialGradient id="fc-spot1" cx="0.5" cy="0.1" r="0.6">
              <stop offset="0%" stopColor="rgba(255,200,50,0.22)" />
              <stop offset="100%" stopColor="rgba(255,200,50,0)" />
            </radialGradient>
            <filter id="fc-glow">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          <g transform={`translate(${s.shakeX.toFixed(2)}, ${s.shakeY.toFixed(2)})`}>

            {/* Background */}
            <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#fc-bg)" />
            <rect x="0" y="0" width={VIEWBOX_WIDTH} height="350" fill="url(#fc-spot1)" />

            {/* Screen flash on hit */}
            {flashSide && (
              <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT}
                fill={flashSide === 'left' ? 'rgba(251,191,36,0.06)' : 'rgba(168,85,247,0.06)'}
              />
            )}

            {/* Stage floor */}
            <rect x="5" y={STAGE_FLOOR_Y - 2} width={VIEWBOX_WIDTH - 10} height="5" rx="2.5"
              fill="#a855f7" opacity="0.7" />
            <rect x="5" y={STAGE_FLOOR_Y + 1} width={VIEWBOX_WIDTH - 10} height="2" rx="1"
              fill="#f59e0b" opacity="0.5" />
            <rect x="5" y={STAGE_FLOOR_Y + 3} width={VIEWBOX_WIDTH - 10} height="90" rx="4"
              fill="rgba(0,0,0,0.12)" />

            {/* Performers */}
            {PERFORMERS.map((p) => {
              const baseY = STAGE_FLOOR_Y - 10
              const bounce = flashSide ? (p.phase % 2 === 0 ? -12 : -6) : 0
              return (
                <g key={p.name} transform={`translate(${p.cx}, ${baseY + bounce})`}>
                  <image href={p.src} x="-44" y="-100" width="88" height="100"
                    preserveAspectRatio="xMidYMid meet"
                    style={{ filter: 'drop-shadow(0 0 14px rgba(168,85,247,0.6))' }}
                  />
                  <text x="0" y="16" textAnchor="middle"
                    fill="#fbbf24" fontSize="11" fontWeight="700" opacity="0.9"
                  >{p.name}</text>
                </g>
              )
            })}

            {/* SCORE */}
            <text
              x={VIEWBOX_WIDTH / 2} y="175" textAnchor="middle"
              fill="#fbbf24" fontSize="80" fontWeight="900"
              opacity={flashSide ? 1 : 0.85}
              filter="url(#fc-glow)"
            >{s.score}</text>
            <text x={VIEWBOX_WIDTH / 2} y="205" textAnchor="middle"
              fill="rgba(255,255,255,0.4)" fontSize="16" fontWeight="600"
            >SCORE</text>

            {/* Combo - smooth fade */}
            {comboOpacity > 0.01 && (
              <text x={VIEWBOX_WIDTH / 2} y="235" textAnchor="middle"
                fill="#f59e0b" fontSize="24" fontWeight="800"
                opacity={comboOpacity}
                filter="url(#fc-glow)"
              >{s.comboCount} COMBO!</text>
            )}

            {/* GREAT - smooth fade */}
            {greatOpacity > 0.01 && (
              <g opacity={greatOpacity}>
                <text x={VIEWBOX_WIDTH / 2} y="290" textAnchor="middle"
                  fill="#ff6b6b" fontSize={52 + (1 - greatAge) * 8} fontWeight="900"
                  filter="url(#fc-glow)"
                >GREAT!</text>
                {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
                  <line key={angle}
                    x1={VIEWBOX_WIDTH / 2 + Math.cos(angle * Math.PI / 180) * (30 + greatAge * 20)}
                    y1={280 + Math.sin(angle * Math.PI / 180) * (15 + greatAge * 10)}
                    x2={VIEWBOX_WIDTH / 2 + Math.cos(angle * Math.PI / 180) * (70 + greatAge * 30)}
                    y2={280 + Math.sin(angle * Math.PI / 180) * (35 + greatAge * 15)}
                    stroke="#ff6b6b" strokeWidth="2" opacity={0.6 * (1 - greatAge)}
                  />
                ))}
              </g>
            )}

            {/* Time - 0.1s smooth */}
            <text x={VIEWBOX_WIDTH - 16} y="38" textAnchor="end"
              fill={timeLeftSmooth <= 5 ? '#ef4444' : '#fff'} fontSize="28" fontWeight="800"
            >{timeDisplay}s</text>
            {/* Smooth time bar */}
            <rect x={VIEWBOX_WIDTH - 110} y="48" width="94" height="7" rx="3.5"
              fill="rgba(255,255,255,0.15)" />
            <rect x={VIEWBOX_WIDTH - 110} y="48"
              width={94 * timeProgress} height="7" rx="3.5" fill={timeBarColor} />

            {/* Cylinder track */}
            <rect x={CYLINDER_LEFT} y={CYLINDER_Y}
              width={CYLINDER_WIDTH} height={CYLINDER_HEIGHT}
              rx={CYLINDER_RADIUS} ry={CYLINDER_RADIUS}
              fill="rgba(255,255,255,0.08)"
              stroke="rgba(255,255,255,0.25)" strokeWidth="2"
            />

            {/* Left wall */}
            <rect x={CYLINDER_LEFT} y={CYLINDER_Y - (flashSide === 'left' ? 4 : 0)}
              width={flashSide === 'left' ? 12 : 8}
              height={CYLINDER_HEIGHT + (flashSide === 'left' ? 8 : 0)}
              rx="4"
              fill={flashSide === 'left' ? '#fbbf24' : 'rgba(168,85,247,0.4)'}
              opacity={flashSide === 'left' ? 1 : 0.6}
            />
            {/* Right wall */}
            <rect x={CYLINDER_LEFT + CYLINDER_WIDTH - (flashSide === 'right' ? 12 : 8)}
              y={CYLINDER_Y - (flashSide === 'right' ? 4 : 0)}
              width={flashSide === 'right' ? 12 : 8}
              height={CYLINDER_HEIGHT + (flashSide === 'right' ? 8 : 0)}
              rx="4"
              fill={flashSide === 'right' ? '#fbbf24' : 'rgba(168,85,247,0.4)'}
              opacity={flashSide === 'right' ? 1 : 0.6}
            />

            {/* Wall hit ring burst */}
            {flashSide === 'left' && (
              <circle cx={CYLINDER_LEFT} cy={CYLINDER_Y + CYLINDER_HEIGHT / 2}
                r="28" fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.4" />
            )}
            {flashSide === 'right' && (
              <circle cx={CYLINDER_LEFT + CYLINDER_WIDTH} cy={CYLINDER_Y + CYLINDER_HEIGHT / 2}
                r="28" fill="none" stroke="#fbbf24" strokeWidth="2" opacity="0.4" />
            )}

            {/* Center marker */}
            <line x1={VIEWBOX_WIDTH / 2} y1={CYLINDER_Y + 12}
              x2={VIEWBOX_WIDTH / 2} y2={CYLINDER_Y + CYLINDER_HEIGHT - 12}
              stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

            {/* Cheer stick - inside cylinder, wide */}
            <image
              href={cheerStickImg}
              x={stickCx - STICK_W / 2}
              y={CYLINDER_Y + (CYLINDER_HEIGHT - STICK_H) / 2}
              width={STICK_W}
              height={STICK_H}
              preserveAspectRatio="xMidYMid meet"
              filter="url(#fc-glow)"
            />

            {/* Sparks */}
            {s.sparks.map((sp) => (
              <circle key={sp.id} cx={sp.x} cy={sp.y}
                r={2 + sp.life * 3} fill={sp.color} opacity={sp.life}
              />
            ))}

            {/* Score pops (+1) */}
            {s.scorePops.map((pop) => {
              const age = (now - pop.born) / 800
              const y = pop.y - age * 50
              return (
                <text key={pop.id} x={pop.x} y={y} textAnchor="middle"
                  fill="#fbbf24" fontSize="20" fontWeight="900"
                  opacity={Math.max(0, 1 - age)}
                  filter="url(#fc-glow)"
                >{pop.value}</text>
              )
            })}

            {/* Direction arrows */}
            <text x={CYLINDER_LEFT - 14} y={CYLINDER_Y + CYLINDER_HEIGHT / 2 + 8}
              textAnchor="middle" fontSize="22" fontWeight="900"
              fill={flashSide === 'left' ? '#fbbf24' : 'rgba(255,255,255,0.3)'}
            >{'<'}</text>
            <text x={CYLINDER_LEFT + CYLINDER_WIDTH + 14} y={CYLINDER_Y + CYLINDER_HEIGHT / 2 + 8}
              textAnchor="middle" fontSize="22" fontWeight="900"
              fill={flashSide === 'right' ? '#fbbf24' : 'rgba(255,255,255,0.3)'}
            >{'>'}</text>

            {/* Instruction */}
            <text x={VIEWBOX_WIDTH / 2} y={VIEWBOX_HEIGHT - 16}
              textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="11"
            >화면 아무 곳이나 좌우로 드래그!</text>

          </g>
        </svg>

        <div className="fierce-cheer-overlay-actions">
          <button className="run-run-action-button ghost" type="button"
            onPointerDown={(e) => e.stopPropagation()} onClick={onExit}
          >나가기</button>
        </div>
      </div>
    </section>
  )
}

export const fierceCheerModule: MiniGameModule = {
  manifest: {
    id: 'fierce-cheer',
    title: '격렬한 응원',
    description: '무대 위 공연을 응원하세요! 응원봉을 좌우 벽에 번갈아 닿게 하여 20초 안에 최고 점수를!',
    unlockCost: 120,
    baseReward: 20,
    scoreRewardMultiplier: 0.7,
    accentColor: '#a855f7',
  },
  Component: FierceCheerGame,
}
