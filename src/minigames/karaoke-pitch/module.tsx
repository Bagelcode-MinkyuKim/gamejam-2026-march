import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import { DEFAULT_FRAME_MS, MAX_FRAME_DELTA_MS } from '../../primitives/constants'
import tapHitSfx from '../../../assets/sounds/tap-hit.mp3'
import characterImage from '../../../assets/images/same-character/song-changsik.png'
import { useGameEffects, ParticleRenderer, ScorePopupRenderer, FlashOverlay, GAME_EFFECTS_CSS } from '../shared/game-effects'

const ROUND_DURATION_MS = 30000
const PITCH_BAR_HEIGHT = 320
const TARGET_RADIUS = 18
const PLAYER_INDICATOR_RADIUS = 14
const ACCURACY_PERFECT_THRESHOLD = 0.04
const ACCURACY_GOOD_THRESHOLD = 0.12
const ACCURACY_OK_THRESHOLD = 0.25
const SCORE_PER_SECOND_PERFECT = 120
const SCORE_PER_SECOND_GOOD = 60
const SCORE_PER_SECOND_OK = 25
const LOW_TIME_THRESHOLD_MS = 5000

const PERFECT_STREAK_THRESHOLD_MS = 2000
const FEVER_TRIGGER_STREAKS = 3
const FEVER_DURATION_MS = 8000
const FEVER_SCORE_MULTIPLIER = 2
const STREAK_MILESTONE_BONUS = 50

const SINE_BASE_PERIOD_MS = 3200
const SINE_MIN_PERIOD_MS = 1600
const SINE_PERIOD_DECAY_PER_MS = 0.04
const SINE_SECONDARY_AMPLITUDE = 0.18
const SINE_SECONDARY_PERIOD_RATIO = 2.73

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function computeTargetPosition(elapsedMs: number): number {
  const currentPeriod = Math.max(SINE_MIN_PERIOD_MS, SINE_BASE_PERIOD_MS - elapsedMs * SINE_PERIOD_DECAY_PER_MS)
  const primaryPhase = (elapsedMs / currentPeriod) * Math.PI * 2
  const secondaryPhase = (elapsedMs / (currentPeriod * SINE_SECONDARY_PERIOD_RATIO)) * Math.PI * 2
  const primary = Math.sin(primaryPhase)
  const secondary = Math.sin(secondaryPhase) * SINE_SECONDARY_AMPLITUDE
  return clampNumber((primary + secondary) * 0.5 + 0.5, 0, 1)
}

function computeAccuracy(targetNormalized: number, playerNormalized: number): number {
  return Math.abs(targetNormalized - playerNormalized)
}

function accuracyToLabel(distance: number): string {
  if (distance <= ACCURACY_PERFECT_THRESHOLD) return 'PERFECT'
  if (distance <= ACCURACY_GOOD_THRESHOLD) return 'GOOD'
  if (distance <= ACCURACY_OK_THRESHOLD) return 'OK'
  return 'MISS'
}

function accuracyToColor(distance: number): string {
  if (distance <= ACCURACY_PERFECT_THRESHOLD) return '#22c55e'
  if (distance <= ACCURACY_GOOD_THRESHOLD) return '#84cc16'
  if (distance <= ACCURACY_OK_THRESHOLD) return '#facc15'
  return '#ef4444'
}

function accuracyToScoreRate(distance: number): number {
  if (distance <= ACCURACY_PERFECT_THRESHOLD) return SCORE_PER_SECOND_PERFECT
  if (distance <= ACCURACY_GOOD_THRESHOLD) return SCORE_PER_SECOND_GOOD
  if (distance <= ACCURACY_OK_THRESHOLD) return SCORE_PER_SECOND_OK
  return 0
}

function KaraokePitchGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [score, setScore] = useState(0)
  const [remainingMs, setRemainingMs] = useState(ROUND_DURATION_MS)
  const [targetPosition, setTargetPosition] = useState(0.5)
  const [playerPosition, setPlayerPosition] = useState(0.5)
  const [accuracyDistance, setAccuracyDistance] = useState(0.5)
  const [totalAccuracySum, setTotalAccuracySum] = useState(0)
  const [totalAccuracySamples, setTotalAccuracySamples] = useState(0)
  const [isFever, setIsFever] = useState(false)
  const [feverRemainingMs, setFeverRemainingMs] = useState(0)
  const [perfectStreakCount, setPerfectStreakCount] = useState(0)

  const effects = useGameEffects()

  const scoreRef = useRef(0)
  const remainingMsRef = useRef(ROUND_DURATION_MS)
  const elapsedMsRef = useRef(0)
  const playerPositionRef = useRef(0.5)
  const finishedRef = useRef(false)
  const animationFrameRef = useRef<number | null>(null)
  const lastFrameAtRef = useRef<number | null>(null)
  const totalAccuracySumRef = useRef(0)
  const totalAccuracySamplesRef = useRef(0)
  const isDraggingRef = useRef(false)
  const pitchBarRef = useRef<HTMLDivElement | null>(null)
  const tapAudioRef = useRef<HTMLAudioElement | null>(null)
  const lastFeedbackSoundMsRef = useRef(0)
  const lastPerfectParticleMsRef = useRef(0)
  const feverRef = useRef(false)
  const feverRemainingMsRef = useRef(0)
  const perfectStreakMsRef = useRef(0)
  const perfectStreakCountRef = useRef(0)
  const lastMilestoneMsRef = useRef(0)

  const playAudio = useCallback(
    (audioRef: { current: HTMLAudioElement | null }, volume: number, playbackRate = 1) => {
      const audio = audioRef.current
      if (audio === null) return
      audio.currentTime = 0
      audio.volume = volume
      audio.playbackRate = playbackRate
      void audio.play().catch(() => {})
    },
    [],
  )

  const finishGame = useCallback(() => {
    if (finishedRef.current) return
    finishedRef.current = true

    const elapsedMs = Math.round(Math.max(DEFAULT_FRAME_MS, ROUND_DURATION_MS - remainingMsRef.current))
    onFinish({
      score: scoreRef.current,
      durationMs: elapsedMs,
    })
  }, [onFinish])

  const updatePlayerFromClientY = useCallback((clientY: number) => {
    const barElement = pitchBarRef.current
    if (barElement === null) return

    const rect = barElement.getBoundingClientRect()
    const relativeY = clientY - rect.top
    const normalized = clampNumber(1 - relativeY / rect.height, 0, 1)
    playerPositionRef.current = normalized
    setPlayerPosition(normalized)
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      isDraggingRef.current = true
      ;(event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId)
      updatePlayerFromClientY(event.clientY)
    },
    [updatePlayerFromClientY],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      event.preventDefault()
      updatePlayerFromClientY(event.clientY)
    },
    [updatePlayerFromClientY],
  )

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = false
    ;(event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId)
  }, [])

  const handleExit = useCallback(() => {
    onExit()
  }, [onExit])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Escape') {
        event.preventDefault()
        handleExit()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleExit])

  useEffect(() => {
    const tapAudio = new Audio(tapHitSfx)
    tapAudio.preload = 'auto'
    tapAudioRef.current = tapAudio

    return () => {
      tapAudioRef.current = null
      effects.cleanup()
    }
  }, [])

  useEffect(() => {
    const handleTouchMove = (event: TouchEvent) => {
      if (isDraggingRef.current) {
        event.preventDefault()
      }
    }

    window.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => {
      window.removeEventListener('touchmove', handleTouchMove)
    }
  }, [])

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
      lastFrameAtRef.current = now
      elapsedMsRef.current += deltaMs

      remainingMsRef.current = Math.max(0, remainingMsRef.current - deltaMs)
      setRemainingMs(remainingMsRef.current)

      const currentTarget = computeTargetPosition(elapsedMsRef.current)
      setTargetPosition(currentTarget)

      const distance = computeAccuracy(currentTarget, playerPositionRef.current)
      setAccuracyDistance(distance)

      // Fever timer countdown
      if (feverRef.current) {
        feverRemainingMsRef.current = Math.max(0, feverRemainingMsRef.current - deltaMs)
        setFeverRemainingMs(feverRemainingMsRef.current)
        if (feverRemainingMsRef.current <= 0) {
          feverRef.current = false
          setIsFever(false)
        }
      }

      // Track perfect streaks
      if (distance <= ACCURACY_PERFECT_THRESHOLD) {
        perfectStreakMsRef.current += deltaMs
        if (perfectStreakMsRef.current >= PERFECT_STREAK_THRESHOLD_MS) {
          perfectStreakMsRef.current -= PERFECT_STREAK_THRESHOLD_MS
          perfectStreakCountRef.current += 1
          setPerfectStreakCount(perfectStreakCountRef.current)

          // Milestone bonus every streak
          if (elapsedMsRef.current - lastMilestoneMsRef.current > 500) {
            lastMilestoneMsRef.current = elapsedMsRef.current
            scoreRef.current += STREAK_MILESTONE_BONUS
            effects.showScorePopup(STREAK_MILESTONE_BONUS, 36, 160 * (1 - playerPositionRef.current) + 20)
          }

          // Activate fever after N perfect streaks
          if (perfectStreakCountRef.current >= FEVER_TRIGGER_STREAKS && !feverRef.current) {
            feverRef.current = true
            feverRemainingMsRef.current = FEVER_DURATION_MS
            setIsFever(true)
            setFeverRemainingMs(FEVER_DURATION_MS)
            effects.triggerFlash('rgba(250,204,21,0.5)')
          }
        }
      } else {
        perfectStreakMsRef.current = 0
      }

      const feverMult = feverRef.current ? FEVER_SCORE_MULTIPLIER : 1
      const scoreRate = accuracyToScoreRate(distance)
      const scoreGain = scoreRate * (deltaMs / 1000) * feverMult
      scoreRef.current += scoreGain
      setScore(Math.floor(scoreRef.current))

      totalAccuracySumRef.current += 1 - distance
      totalAccuracySamplesRef.current += 1
      setTotalAccuracySum(totalAccuracySumRef.current)
      setTotalAccuracySamples(totalAccuracySamplesRef.current)

      if (distance <= ACCURACY_GOOD_THRESHOLD && elapsedMsRef.current - lastFeedbackSoundMsRef.current > 400) {
        lastFeedbackSoundMsRef.current = elapsedMsRef.current
        const pitchRate = 0.8 + currentTarget * 0.6
        playAudio(tapAudioRef, 0.2, pitchRate)
      }

      // Periodic particle effects when tracking perfectly
      if (distance <= ACCURACY_PERFECT_THRESHOLD && elapsedMsRef.current - lastPerfectParticleMsRef.current > 800) {
        lastPerfectParticleMsRef.current = elapsedMsRef.current
        effects.spawnParticles(3, 36, 160 * (1 - playerPositionRef.current) + 20)
        effects.triggerFlash('rgba(34,197,94,0.15)')
      }

      effects.updateParticles()

      if (remainingMsRef.current <= 0) {
        finishGame()
        animationFrameRef.current = null
        return
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
    }
  }, [finishGame, playAudio])

  const accuracyLabel = accuracyToLabel(accuracyDistance)
  const accuracyColor = accuracyToColor(accuracyDistance)
  const overallAccuracyPercent = totalAccuracySamples > 0 ? (totalAccuracySum / totalAccuracySamples) * 100 : 0
  const displayedBestScore = useMemo(() => Math.max(bestScore, Math.floor(scoreRef.current)), [bestScore, score])
  const isLowTime = remainingMs <= LOW_TIME_THRESHOLD_MS

  const targetTopPercent = (1 - targetPosition) * 100
  const playerTopPercent = (1 - playerPosition) * 100

  const trailSegments = useMemo(() => {
    const segments: { top: number; height: number; color: string }[] = []
    const tPos = (1 - targetPosition) * 100
    const pPos = (1 - playerPosition) * 100
    const minPos = Math.min(tPos, pPos)
    const maxPos = Math.max(tPos, pPos)
    const height = maxPos - minPos
    segments.push({ top: minPos, height: Math.max(height, 0.5), color: accuracyColor })
    return segments
  }, [targetPosition, playerPosition, accuracyColor])

  return (
    <section className="mini-game-panel karaoke-pitch-panel" aria-label="karaoke-pitch-game" style={{ ...effects.getShakeStyle() }}>
      <style>{GAME_EFFECTS_CSS}{`
        .karaoke-pitch-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: linear-gradient(180deg, #1a0a2e 0%, #0d0d1a 40%, #0f0826 100%);
          user-select: none;
          -webkit-user-select: none;
          touch-action: none;
          position: relative;
          overflow: hidden;
        }

        .karaoke-pitch-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px 8px;
          background: linear-gradient(135deg, rgba(217,70,239,0.3) 0%, rgba(147,51,234,0.2) 100%);
          border-bottom: 1px solid rgba(217,70,239,0.2);
          flex-shrink: 0;
        }

        .karaoke-pitch-header-left {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .karaoke-pitch-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 2px solid #d946ef;
          object-fit: cover;
          box-shadow: 0 0 12px rgba(217,70,239,0.5);
        }

        .karaoke-pitch-header-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .karaoke-pitch-score {
          font-size: 26px;
          font-weight: 800;
          color: #e879f9;
          margin: 0;
          line-height: 1;
          letter-spacing: -0.5px;
          text-shadow: 0 0 14px rgba(217,70,239,0.6);
        }

        .karaoke-pitch-best {
          font-size: 10px;
          color: #d8b4fe;
          margin: 0;
          opacity: 0.7;
        }

        .karaoke-pitch-header-right {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 2px;
        }

        .karaoke-pitch-time {
          font-size: 18px;
          font-weight: 700;
          color: #e4e4e7;
          margin: 0;
          font-variant-numeric: tabular-nums;
        }

        .karaoke-pitch-time.low-time {
          color: #ef4444;
          animation: karaoke-pitch-pulse 0.5s ease-in-out infinite alternate;
        }

        @keyframes karaoke-pitch-pulse {
          from { opacity: 1; }
          to { opacity: 0.5; }
        }

        .karaoke-pitch-meta-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 6px 16px;
          flex-shrink: 0;
        }

        .karaoke-pitch-accuracy-label {
          font-size: 18px;
          font-weight: 800;
          margin: 0;
          letter-spacing: 1px;
          transition: color 0.15s ease;
          text-shadow: 0 0 10px currentColor;
        }

        .karaoke-pitch-accuracy-percent {
          font-size: 12px;
          color: #d8b4fe;
          margin: 0;
        }

        .karaoke-pitch-accuracy-percent strong {
          color: #e4e4e7;
        }

        .karaoke-pitch-arena {
          display: flex;
          flex-direction: row;
          align-items: stretch;
          gap: 10px;
          flex: 1;
          padding: 0 12px;
          min-height: 0;
          overflow: hidden;
        }

        .karaoke-pitch-bar-container {
          width: 72px;
          flex-shrink: 0;
          position: relative;
          cursor: grab;
          border-radius: 14px;
          background: #18181b;
          border: 2px solid rgba(217,70,239,0.15);
          overflow: hidden;
          box-shadow: inset 0 0 20px rgba(0,0,0,0.4);
        }

        .karaoke-pitch-bar-container:active {
          cursor: grabbing;
          border-color: rgba(217,70,239,0.4);
          box-shadow: inset 0 0 20px rgba(0,0,0,0.4), 0 0 12px rgba(217,70,239,0.2);
        }

        .karaoke-pitch-bar-track {
          position: absolute;
          inset: 12px 8px;
          border-radius: 8px;
          background: linear-gradient(to bottom, #312e81, #1e1b4b, #0f172a, #1e1b4b, #312e81);
        }

        .karaoke-pitch-trail {
          position: absolute;
          left: 0;
          right: 0;
          border-radius: 4px;
          transition: background-color 0.15s ease;
        }

        .karaoke-pitch-target-zone {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          width: ${TARGET_RADIUS * 2}px;
          height: ${TARGET_RADIUS * 2}px;
          border-radius: 50%;
          border: 3px solid;
          transition: top 0.05s linear, border-color 0.15s ease;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .karaoke-pitch-target-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          transition: background-color 0.15s ease;
        }

        .karaoke-pitch-player-indicator {
          position: absolute;
          left: 50%;
          transform: translate(-50%, -50%);
          width: ${PLAYER_INDICATOR_RADIUS * 2}px;
          height: ${PLAYER_INDICATOR_RADIUS * 2}px;
          border-radius: 50%;
          border: 2px solid #ffffffcc;
          transition: background-color 0.15s ease, box-shadow 0.15s ease;
        }

        .karaoke-pitch-scale-marks {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .karaoke-pitch-scale-mark {
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          background: #ffffff18;
          transform: translateY(-0.5px);
        }

        .karaoke-pitch-waveform {
          flex: 1;
          min-width: 0;
          position: relative;
          border-radius: 14px;
          background: #18181b;
          border: 2px solid rgba(217,70,239,0.15);
          overflow: hidden;
          box-shadow: inset 0 0 20px rgba(0,0,0,0.4);
        }

        .karaoke-pitch-waveform canvas {
          width: 100%;
          height: 100%;
          display: block;
        }

        .karaoke-pitch-footer {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          padding: 8px 16px 14px;
        }

        .karaoke-pitch-hint {
          font-size: 12px;
          color: #71717a;
          margin: 0;
          text-align: center;
        }

        .karaoke-pitch-exit-btn {
          padding: 7px 22px;
          border-radius: 20px;
          border: 1px solid rgba(217,70,239,0.3);
          background: rgba(217,70,239,0.1);
          color: #d8b4fe;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }

        .karaoke-pitch-exit-btn:active {
          transform: scale(0.95);
          background: rgba(217,70,239,0.2);
        }
      `}</style>

      <FlashOverlay isFlashing={effects.isFlashing} flashColor={effects.flashColor} />
      <ParticleRenderer particles={effects.particles} />
      <ScorePopupRenderer popups={effects.scorePopups} />

      <div className="karaoke-pitch-header">
        <div className="karaoke-pitch-header-left">
          <img className="karaoke-pitch-avatar" src={characterImage} alt="character" />
          <div className="karaoke-pitch-header-info">
            <p className="karaoke-pitch-score">{Math.floor(score).toLocaleString()}</p>
            <p className="karaoke-pitch-best">BEST {displayedBestScore.toLocaleString()}</p>
          </div>
        </div>
        <div className="karaoke-pitch-header-right">
          <p className={`karaoke-pitch-time ${isLowTime ? 'low-time' : ''}`}>
            {(remainingMs / 1000).toFixed(1)}s
          </p>
        </div>
      </div>

      <div className="karaoke-pitch-meta-row">
        <p className="karaoke-pitch-accuracy-label" style={{ color: accuracyColor }}>
          {accuracyLabel}
        </p>
        <p className="karaoke-pitch-accuracy-percent">
          Accuracy <strong>{overallAccuracyPercent.toFixed(1)}%</strong>
        </p>
        {perfectStreakCount > 0 && (
          <p style={{ color: '#22c55e', fontSize: 12, fontWeight: 700, margin: 0, textShadow: '0 0 6px rgba(34,197,94,0.4)' }}>
            STREAK {perfectStreakCount}
          </p>
        )}
        {isFever && (
          <p style={{ color: '#facc15', fontSize: 12, fontWeight: 800, margin: 0, animation: 'karaoke-pitch-pulse 0.3s ease-in-out infinite alternate' }}>
            FEVER x{FEVER_SCORE_MULTIPLIER} {(feverRemainingMs / 1000).toFixed(1)}s
          </p>
        )}
      </div>

      <div className="karaoke-pitch-arena">
        <div
          className="karaoke-pitch-bar-container"
          ref={pitchBarRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          role="slider"
          aria-label="pitch-slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(playerPosition * 100)}
        >
          <div className="karaoke-pitch-bar-track">
            {trailSegments.map((seg, i) => (
              <div
                key={i}
                className="karaoke-pitch-trail"
                style={{
                  top: `${seg.top}%`,
                  height: `${seg.height}%`,
                  backgroundColor: seg.color,
                  opacity: 0.35,
                }}
              />
            ))}

            <div
              className="karaoke-pitch-target-zone"
              style={{
                top: `${targetTopPercent}%`,
                borderColor: accuracyColor,
              }}
            >
              <div
                className="karaoke-pitch-target-dot"
                style={{ backgroundColor: accuracyColor }}
              />
            </div>

            <div
              className="karaoke-pitch-player-indicator"
              style={{
                top: `${playerTopPercent}%`,
                backgroundColor: accuracyColor,
                boxShadow: `0 0 12px ${accuracyColor}88`,
              }}
            />

            <div className="karaoke-pitch-scale-marks">
              {[0, 25, 50, 75, 100].map((mark) => (
                <div
                  key={mark}
                  className="karaoke-pitch-scale-mark"
                  style={{ top: `${mark}%` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="karaoke-pitch-waveform">
          <KaraokePitchWaveform
            targetPosition={targetPosition}
            playerPosition={playerPosition}
            accuracyColor={accuracyColor}
            elapsedMs={elapsedMsRef.current}
          />
        </div>
      </div>

      <div className="karaoke-pitch-footer">
        <p className="karaoke-pitch-hint">슬라이더를 드래그하여 음정을 맞추세요!</p>
        <button className="karaoke-pitch-exit-btn" type="button" onClick={handleExit}>
          허브로 돌아가기
        </button>
      </div>
    </section>
  )
}

function KaraokePitchWaveform({
  targetPosition,
  playerPosition,
  accuracyColor,
  elapsedMs,
}: {
  targetPosition: number
  playerPosition: number
  accuracyColor: string
  elapsedMs: number
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const historyRef = useRef<{ target: number; player: number; color: string }[]>([])
  const MAX_HISTORY = 200

  useEffect(() => {
    historyRef.current.push({
      target: targetPosition,
      player: playerPosition,
      color: accuracyColor,
    })
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current.shift()
    }

    const canvas = canvasRef.current
    if (canvas === null) return

    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const width = Math.floor(rect.width * dpr)
    const height = Math.floor(rect.height * dpr)

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
    }

    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    ctx.clearRect(0, 0, width, height)

    const history = historyRef.current
    const len = history.length
    if (len < 2) return

    const padding = 12 * dpr
    const drawWidth = width - padding * 2
    const drawHeight = height - padding * 2

    ctx.lineWidth = 2 * dpr
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    ctx.strokeStyle = '#d946ef55'
    ctx.beginPath()
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (MAX_HISTORY - 1)) * drawWidth
      const y = padding + (1 - history[i].target) * drawHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    ctx.strokeStyle = '#ffffff88'
    ctx.lineWidth = 2.5 * dpr
    ctx.beginPath()
    for (let i = 0; i < len; i++) {
      const x = padding + (i / (MAX_HISTORY - 1)) * drawWidth
      const y = padding + (1 - history[i].player) * drawHeight
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()

    const lastEntry = history[len - 1]
    const lastX = padding + ((len - 1) / (MAX_HISTORY - 1)) * drawWidth
    const lastTargetY = padding + (1 - lastEntry.target) * drawHeight
    const lastPlayerY = padding + (1 - lastEntry.player) * drawHeight

    ctx.fillStyle = '#d946ef'
    ctx.beginPath()
    ctx.arc(lastX, lastTargetY, 4 * dpr, 0, Math.PI * 2)
    ctx.fill()

    ctx.fillStyle = lastEntry.color
    ctx.beginPath()
    ctx.arc(lastX, lastPlayerY, 5 * dpr, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = lastEntry.color + '44'
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([4 * dpr, 4 * dpr])
    ctx.beginPath()
    ctx.moveTo(lastX, lastTargetY)
    ctx.lineTo(lastX, lastPlayerY)
    ctx.stroke()
    ctx.setLineDash([])
  }, [targetPosition, playerPosition, accuracyColor, elapsedMs])

  return <canvas ref={canvasRef} />
}

export const karaokePitchModule: MiniGameModule = {
  manifest: {
    id: 'karaoke-pitch',
    title: 'Karaoke Pitch',
    description: '움직이는 음정 바를 따라가라! 정확한 음정 트래킹!',
    unlockCost: 40,
    baseReward: 14,
    scoreRewardMultiplier: 1.15,
    accentColor: '#d946ef',
  },
  Component: KaraokePitchGame,
}
