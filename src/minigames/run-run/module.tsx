import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'

const TICK_MS = 16
const START_SPEED = 14
const MAX_SPEED = 34
const ACCEL_PER_SECOND = 4.6

const SEGMENT_MIN_LENGTH = 14
const SEGMENT_MAX_LENGTH = 30
const ROAD_HALF_WIDTH = 23
const HORIZONTAL_LIMIT = 26
const INITIAL_SEGMENTS = 52
const EXTEND_SEGMENTS = 24
const LOOKAHEAD_DISTANCE = 200
const KEEP_BACK_DISTANCE = 170

const VIEWBOX_WIDTH = 160
const VIEWBOX_HEIGHT = 260
const WORLD_SCALE = 2.4
const CAMERA_FOLLOW_Y = 196

interface Point {
  readonly x: number
  readonly y: number
}

interface RoadSegment {
  readonly start: Point
  readonly end: Point
}

type MoveDirection = 'left' | 'right'

function toggleDirection(direction: MoveDirection): MoveDirection {
  return direction === 'left' ? 'right' : 'left'
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function toDirectionVector(direction: MoveDirection): Point {
  return direction === 'right'
    ? { x: 1 / Math.sqrt(2), y: 1 / Math.sqrt(2) }
    : { x: -1 / Math.sqrt(2), y: 1 / Math.sqrt(2) }
}

function movePoint(point: Point, direction: MoveDirection, distance: number): Point {
  const vector = toDirectionVector(direction)
  return {
    x: point.x + vector.x * distance,
    y: point.y + vector.y * distance,
  }
}

function inferLastDirection(segments: RoadSegment[]): MoveDirection {
  if (segments.length === 0) {
    return 'right'
  }

  const last = segments[segments.length - 1]
  return last.end.x >= last.start.x ? 'right' : 'left'
}

function clampDirectionByHorizontalLimit(point: Point, direction: MoveDirection): MoveDirection {
  if (point.x > HORIZONTAL_LIMIT) {
    return 'left'
  }
  if (point.x < -HORIZONTAL_LIMIT) {
    return 'right'
  }
  return direction
}

function extendRoad(segments: RoadSegment[], segmentCount: number): RoadSegment[] {
  const next = [...segments]
  let currentDirection = toggleDirection(inferLastDirection(next))
  let currentPoint = next.length > 0 ? next[next.length - 1].end : { x: 0, y: 0 }

  for (let index = 0; index < segmentCount; index += 1) {
    currentDirection = clampDirectionByHorizontalLimit(currentPoint, currentDirection)
    const segmentLength = randomBetween(SEGMENT_MIN_LENGTH, SEGMENT_MAX_LENGTH)
    const endPoint = movePoint(currentPoint, currentDirection, segmentLength)

    next.push({
      start: currentPoint,
      end: endPoint,
    })

    currentPoint = endPoint
    currentDirection = toggleDirection(currentDirection)
  }

  return next
}

function createInitialRoad(): RoadSegment[] {
  return extendRoad([], INITIAL_SEGMENTS)
}

function compactRoad(segments: RoadSegment[], playerY: number): RoadSegment[] {
  let dropCount = 0
  while (dropCount < segments.length - 2 && segments[dropCount].end.y < playerY - KEEP_BACK_DISTANCE) {
    dropCount += 1
  }

  return dropCount === 0 ? segments : segments.slice(dropCount)
}

function distancePointToSegment(point: Point, start: Point, end: Point): number {
  const segmentX = end.x - start.x
  const segmentY = end.y - start.y
  const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY

  if (segmentLengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y)
  }

  const projected =
    ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / segmentLengthSquared
  const clampedProjection = Math.min(1, Math.max(0, projected))
  const closestX = start.x + segmentX * clampedProjection
  const closestY = start.y + segmentY * clampedProjection
  return Math.hypot(point.x - closestX, point.y - closestY)
}

function isPointInsideRoad(point: Point, roadSegments: RoadSegment[]): boolean {
  for (const segment of roadSegments) {
    if (distancePointToSegment(point, segment.start, segment.end) <= ROAD_HALF_WIDTH) {
      return true
    }
  }

  return false
}

function toScore(player: Point): number {
  return Math.max(0, Math.floor(player.y * 1.5))
}

function worldToScreen(point: Point, anchor: Point): Point {
  return {
    x: VIEWBOX_WIDTH / 2 + (point.x - anchor.x) * WORLD_SCALE,
    y: CAMERA_FOLLOW_Y - (point.y - anchor.y) * WORLD_SCALE,
  }
}

function toRoadCenterNodes(roadSegments: RoadSegment[]): Point[] {
  if (roadSegments.length === 0) {
    return [{ x: 0, y: 0 }]
  }

  const nodes: Point[] = [roadSegments[0].start]
  for (const segment of roadSegments) {
    nodes.push(segment.end)
  }
  return nodes
}

function toPolyline(points: Point[], player: Point): string {
  return points
    .map((point) => worldToScreen(point, player))
    .filter((point) => point.y > -44 && point.y < VIEWBOX_HEIGHT + 44)
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ')
}

function RunRunGame({ onFinish, onExit }: MiniGameSessionProps) {
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>(() => createInitialRoad())
  const [player, setPlayer] = useState<Point>(() => ({ x: 0, y: 1 }))
  const [direction, setDirection] = useState<MoveDirection>('right')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [speed, setSpeed] = useState(START_SPEED)
  const [turnCount, setTurnCount] = useState(0)
  const [score, setScore] = useState(0)
  const [statusText, setStatusText] = useState('탭하면 좌/우 전환됩니다. 코스 밖으로 나가면 종료됩니다.')

  const roadRef = useRef<RoadSegment[]>(roadSegments)
  const playerRef = useRef<Point>(player)
  const directionRef = useRef<MoveDirection>(direction)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)

  const centerPolyline = useMemo(
    () => toPolyline(toRoadCenterNodes(roadSegments), player),
    [roadSegments, player],
  )
  const playerScreenPoint = useMemo(() => worldToScreen(player, player), [player])
  const svgStyle = useMemo(
    () =>
      ({
        '--road-stroke': `${ROAD_HALF_WIDTH * 2 * WORLD_SCALE}px`,
      }) as CSSProperties,
    [],
  )

  const finishRound = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const finalDurationMs = elapsedMsRef.current > 0 ? elapsedMsRef.current : TICK_MS
    const finalScore = toScore(playerRef.current)
    onFinish({
      score: finalScore,
      durationMs: finalDurationMs,
    })
  }, [onFinish])

  const switchDirection = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    const nextDirection = toggleDirection(directionRef.current)
    directionRef.current = nextDirection
    setDirection(nextDirection)
    setTurnCount((previous) => previous + 1)
    setStatusText(nextDirection === 'left' ? '좌측으로 전환!' : '우측으로 전환!')
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space' || event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        event.preventDefault()
        switchDirection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [switchDirection])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (finishedRef.current) {
        window.clearInterval(timer)
        return
      }

      elapsedMsRef.current += TICK_MS
      setElapsedMs(elapsedMsRef.current)

      const elapsedSeconds = elapsedMsRef.current / 1000
      const currentSpeed = Math.min(MAX_SPEED, START_SPEED + elapsedSeconds * ACCEL_PER_SECOND)
      setSpeed(currentSpeed)

      const movedPlayer = movePoint(playerRef.current, directionRef.current, currentSpeed * (TICK_MS / 1000))
      playerRef.current = movedPlayer
      setPlayer(movedPlayer)

      let nextRoad = roadRef.current
      const tailY = nextRoad[nextRoad.length - 1]?.end.y ?? 0
      if (tailY - movedPlayer.y < LOOKAHEAD_DISTANCE) {
        nextRoad = extendRoad(nextRoad, EXTEND_SEGMENTS)
      }

      nextRoad = compactRoad(nextRoad, movedPlayer.y)
      roadRef.current = nextRoad
      setRoadSegments(nextRoad)

      const isSafe = isPointInsideRoad(movedPlayer, nextRoad)
      setScore(toScore(movedPlayer))

      if (!isSafe) {
        setStatusText('벽에 닿았습니다. 라운드 종료!')
        finishRound()
      }
    }, TICK_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [finishRound])

  return (
    <section className="mini-game-panel" aria-label="run-run-game">
      <h3>달려달려</h3>
      <p className="mini-game-description">지그재그 길을 따라 탭으로 좌우 전환하며 최대 거리까지 달리세요.</p>
      <p className="mini-game-description">{statusText}</p>

      <div className="zigzag-board" onPointerDown={switchDirection} role="presentation">
        <svg className="zigzag-svg" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} aria-label="zigzag-road" style={svgStyle}>
          <polyline className="zigzag-road-outline" points={centerPolyline} />
          <polyline className="zigzag-road-main" points={centerPolyline} />
          <polyline className="zigzag-road-inner" points={centerPolyline} />
          <circle className="zigzag-player-shadow" cx={playerScreenPoint.x} cy={playerScreenPoint.y + 2.6} r="3.2" />
          <circle className="zigzag-player" cx={playerScreenPoint.x} cy={playerScreenPoint.y} r="4.1" />
        </svg>
        <p className="zigzag-tap-hint">터치/클릭으로 방향 전환</p>
      </div>

      <p className="mini-game-stat">진행 거리: {score}</p>
      <p className="mini-game-stat">현재 속도: {speed.toFixed(1)} / {MAX_SPEED.toFixed(0)}</p>
      <p className="mini-game-stat">방향: {direction === 'left' ? '좌상향' : '우상향'}</p>
      <p className="mini-game-stat">방향 전환 횟수: {turnCount}</p>
      <p className="mini-game-stat">플레이 시간: {(elapsedMs / 1000).toFixed(1)}초</p>

      <button className="tap-button" type="button" onClick={switchDirection}>
        방향 전환
      </button>
      <button className="tap-button" type="button" onClick={finishRound}>
        라운드 종료
      </button>
      <button className="text-button" type="button" onClick={onExit}>
        허브로 돌아가기
      </button>
    </section>
  )
}

export const runRunModule: MiniGameModule = {
  manifest: {
    id: 'run-run',
    title: '달려달려',
    description: '탭할 때마다 좌우 전환하며 지그재그 길 위를 최대한 멀리 가는 탑뷰 게임',
    unlockCost: 60,
    baseReward: 14,
    scoreRewardMultiplier: 0.7,
    accentColor: '#ef4444',
  },
  Component: RunRunGame,
}
