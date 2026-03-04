import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import runRunCharacter from '../../../assets/images/MrTae.png'
import wallHuman01 from '../../../assets/images/Human 01.png'
import wallHuman02 from '../../../assets/images/Human 02.png'
import wallHuman03 from '../../../assets/images/Human 03.png'
import wallHuman04 from '../../../assets/images/Human 04.png'

const TICK_MS = 16
const START_SPEED = 52
const MAX_SPEED = 144
const ACCEL_PER_SECOND = 21

const SEGMENT_MIN_LENGTH = 24
const SEGMENT_MAX_LENGTH = 52
const ROAD_HALF_WIDTH = 23
const HORIZONTAL_LIMIT = 50
const INITIAL_SEGMENTS = 52
const EXTEND_SEGMENTS = 24
const LOOKAHEAD_DISTANCE = 200
const KEEP_BACK_DISTANCE = 170

const VIEWBOX_WIDTH = 162
const VIEWBOX_HEIGHT = 288
const WORLD_SCALE = 1.62
const ROAD_STROKE_HALF_PX = ROAD_HALF_WIDTH * WORLD_SCALE
const CAMERA_BOTTOM_MARGIN = ROAD_STROKE_HALF_PX + 4
const CAMERA_FOLLOW_Y = VIEWBOX_HEIGHT - CAMERA_BOTTOM_MARGIN
const CAMERA_ROTATE_MAX_DEG = 17
const CAMERA_ROTATE_SMOOTHING = 0.14
const ROAD_TAIL_DISTANCE = 92

const PLAYER_SPRITE_WIDTH = 36
const PLAYER_SPRITE_HEIGHT = 57
const WALL_CHARACTER_SPACING = 9
const WALL_CHARACTER_WIDTH = 24
const WALL_CHARACTER_HEIGHT = 40
const WALL_CHARACTER_PADDING = 2
const WALL_VISIBLE_MARGIN = 80
const WALL_START_OFFSET = 0
const WALL_INNER_EDGE_OFFSET = 2.5

const WALL_CHARACTERS = [
  { src: wallHuman01 },
  { src: wallHuman02 },
  { src: wallHuman03 },
  { src: wallHuman04 },
] as const

const WALL_CHARACTER_PATTERN = [0, 1, 2, 3, 2, 1] as const

interface Point {
  readonly x: number
  readonly y: number
}

interface RoadSegment {
  readonly start: Point
  readonly end: Point
}

type MoveDirection = 'left' | 'right'
type WallSide = 'left' | 'right'

interface WallSprite {
  readonly key: string
  readonly href: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly side: WallSide
}

interface WallAnchor {
  readonly point: Point
  readonly side: WallSide
  readonly slotIndex: number
}

function toggleDirection(direction: MoveDirection): MoveDirection {
  return direction === 'left' ? 'right' : 'left'
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
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

function toCameraRotationTarget(playerX: number, direction: MoveDirection): number {
  const sidePressure = clamp(playerX / HORIZONTAL_LIMIT, -1, 1)
  const directionBias = direction === 'right' ? 1 : -1
  const blendedPressure = sidePressure * 0.85 + directionBias * 0.15
  return clamp(blendedPressure * CAMERA_ROTATE_MAX_DEG, -CAMERA_ROTATE_MAX_DEG, CAMERA_ROTATE_MAX_DEG)
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
    const segmentLength = randomBetween(SEGMENT_MIN_LENGTH, SEGMENT_MAX_LENGTH)
    currentDirection = clampDirectionByHorizontalLimit(currentPoint, currentDirection)
    let endPoint = movePoint(currentPoint, currentDirection, segmentLength)

    if (Math.abs(endPoint.x) > HORIZONTAL_LIMIT) {
      currentDirection = toggleDirection(currentDirection)
      endPoint = movePoint(currentPoint, currentDirection, segmentLength)
    }

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

function pickWallCharacterIndex(slotIndex: number): number {
  const patternIndex = slotIndex % WALL_CHARACTER_PATTERN.length
  return WALL_CHARACTER_PATTERN[patternIndex]
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
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.y > -160)
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ')
}

function toWallEdgePoints(roadSegments: RoadSegment[]): WallAnchor[] {
  const edgePoints: WallAnchor[] = []
  let distanceToNext = WALL_START_OFFSET
  let slotIndex = 0
  const edgeOffset = ROAD_HALF_WIDTH + WALL_CHARACTER_PADDING

  const pushEdgePair = (
    centerX: number,
    centerY: number,
    leftNormalX: number,
    leftNormalY: number,
    rightNormalX: number,
    rightNormalY: number,
  ): void => {
    edgePoints.push({
      side: 'left',
      point: {
        x: centerX + leftNormalX * edgeOffset,
        y: centerY + leftNormalY * edgeOffset,
      },
      slotIndex,
    })

    edgePoints.push({
      side: 'right',
      point: {
        x: centerX + rightNormalX * edgeOffset,
        y: centerY + rightNormalY * edgeOffset,
      },
      slotIndex,
    })

    slotIndex += 1
  }

  for (const segment of roadSegments) {
    const segmentX = segment.end.x - segment.start.x
    const segmentY = segment.end.y - segment.start.y
    const segmentLength = Math.hypot(segmentX, segmentY)
    if (segmentLength === 0) {
      continue
    }

    const tangentX = segmentX / segmentLength
    const tangentY = segmentY / segmentLength
    const leftNormalX = -tangentY
    const leftNormalY = tangentX
    const rightNormalX = tangentY
    const rightNormalY = -tangentX

    while (distanceToNext < segmentLength - 0.0001) {
      const centerX = segment.start.x + tangentX * distanceToNext
      const centerY = segment.start.y + tangentY * distanceToNext

      pushEdgePair(centerX, centerY, leftNormalX, leftNormalY, rightNormalX, rightNormalY)
      distanceToNext += WALL_CHARACTER_SPACING
    }

    pushEdgePair(segment.end.x, segment.end.y, leftNormalX, leftNormalY, rightNormalX, rightNormalY)
    distanceToNext = WALL_CHARACTER_SPACING
  }

  return edgePoints
}

function RunRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>(() => createInitialRoad())
  const [player, setPlayer] = useState<Point>(() => ({ x: 0, y: 1 }))
  const [direction, setDirection] = useState<MoveDirection>('right')
  const [isRunning, setIsRunning] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [speed, setSpeed] = useState(START_SPEED)
  const [turnCount, setTurnCount] = useState(0)
  const [score, setScore] = useState(0)
  const [statusText, setStatusText] = useState('좌/우를 터치해서 출발하세요. 코스 밖으로 나가면 종료됩니다.')
  const [cameraRotationDeg, setCameraRotationDeg] = useState(0)

  const roadRef = useRef<RoadSegment[]>(roadSegments)
  const playerRef = useRef<Point>(player)
  const directionRef = useRef<MoveDirection>(direction)
  const cameraRotationRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)

  const centerPolyline = useMemo(() => {
    const roadNodes = toRoadCenterNodes(roadSegments)
    const tailNode = movePoint(player, direction, -ROAD_TAIL_DISTANCE)
    return toPolyline([tailNode, ...roadNodes], player)
  }, [direction, player, roadSegments])

  const playerScreenPoint = useMemo(() => worldToScreen(player, player), [player])

  const worldLayerTransform = useMemo(
    () => `rotate(${cameraRotationDeg.toFixed(2)} ${VIEWBOX_WIDTH / 2} ${CAMERA_FOLLOW_Y})`,
    [cameraRotationDeg],
  )

  const playerSpriteX = useMemo(() => playerScreenPoint.x - PLAYER_SPRITE_WIDTH / 2, [playerScreenPoint.x])
  const playerSpriteY = useMemo(() => playerScreenPoint.y - PLAYER_SPRITE_HEIGHT + 8, [playerScreenPoint.y])

  const wallSprites = useMemo<WallSprite[]>(() => {
    return toWallEdgePoints(roadSegments)
      .map((edgePoint) => {
        const screenPoint = worldToScreen(edgePoint.point, player)
        if (screenPoint.y < -WALL_VISIBLE_MARGIN || screenPoint.y > VIEWBOX_HEIGHT + WALL_VISIBLE_MARGIN) {
          return null
        }

        const characterIndex = pickWallCharacterIndex(edgePoint.slotIndex)
        const character = WALL_CHARACTERS[characterIndex]
        const spriteX =
          edgePoint.side === 'left'
            ? screenPoint.x - WALL_CHARACTER_WIDTH + WALL_INNER_EDGE_OFFSET
            : screenPoint.x - WALL_INNER_EDGE_OFFSET

        return {
          key: `${edgePoint.side}-${edgePoint.point.x.toFixed(2)}-${edgePoint.point.y.toFixed(2)}`,
          href: character.src,
          x: spriteX,
          y: screenPoint.y - WALL_CHARACTER_HEIGHT + 2,
          width: WALL_CHARACTER_WIDTH,
          height: WALL_CHARACTER_HEIGHT,
          side: edgePoint.side,
        }
      })
      .filter((sprite): sprite is WallSprite => sprite !== null)
      .sort((a, b) => a.y - b.y)
  }, [player, roadSegments])

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

  const setMoveDirection = useCallback(
    (nextDirection: MoveDirection) => {
      if (finishedRef.current) {
        return
      }

      const shouldStartRound = !isRunning
      const hasDirectionChanged = directionRef.current !== nextDirection

      if (shouldStartRound) {
        setIsRunning(true)
        setStatusText('출발!')
      }

      directionRef.current = nextDirection
      setDirection(nextDirection)

      if (hasDirectionChanged) {
        setTurnCount((previous) => previous + 1)
        setStatusText(nextDirection === 'left' ? '좌측으로 이동 중' : '우측으로 이동 중')
      }
    },
    [isRunning],
  )

  const toggleMoveDirection = useCallback(() => {
    setMoveDirection(toggleDirection(directionRef.current))
  }, [setMoveDirection])

  const handleBoardPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const nextDirection: MoveDirection = event.clientX - rect.left < rect.width / 2 ? 'left' : 'right'
      setMoveDirection(nextDirection)
    },
    [setMoveDirection],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        setMoveDirection('left')
        return
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault()
        setMoveDirection('right')
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        toggleMoveDirection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [setMoveDirection, toggleMoveDirection])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (finishedRef.current) {
        window.clearInterval(timer)
        return
      }

      if (!isRunning) {
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

      const targetCameraRotation = toCameraRotationTarget(movedPlayer.x, directionRef.current)
      const nextCameraRotation =
        cameraRotationRef.current + (targetCameraRotation - cameraRotationRef.current) * CAMERA_ROTATE_SMOOTHING
      cameraRotationRef.current = nextCameraRotation
      setCameraRotationDeg(nextCameraRotation)

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
  }, [finishRound, isRunning])

  const displayedBestScore = Math.max(bestScore, score)

  return (
    <section className="mini-game-panel run-run-panel" aria-label="run-run-game">
      <div className="zigzag-board run-run-board" onPointerDown={handleBoardPointerDown} role="presentation">
        <svg
          className="zigzag-svg run-run-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMax meet"
          aria-label="zigzag-road"
          style={svgStyle}
        >
          <g transform={worldLayerTransform}>
            <polyline className="zigzag-road-outline" points={centerPolyline} />
            <polyline className="zigzag-road-main" points={centerPolyline} />
            <polyline className="zigzag-road-inner" points={centerPolyline} />
            {wallSprites.map((sprite) => (
              <image
                key={sprite.key}
                className="zigzag-wall-sprite"
                href={sprite.href}
                x={sprite.x}
                y={sprite.y}
                width={sprite.width}
                height={sprite.height}
                transform={
                  sprite.side === 'right'
                    ? `translate(${(sprite.x * 2 + sprite.width).toFixed(2)} 0) scale(-1 1)`
                    : undefined
                }
                preserveAspectRatio="none"
              />
            ))}
          </g>

          <circle className="zigzag-player-shadow" cx={playerScreenPoint.x} cy={playerScreenPoint.y + 2.6} r="3.2" />
          <image
            className="zigzag-player-sprite"
            href={runRunCharacter}
            x={playerSpriteX}
            y={playerSpriteY}
            width={PLAYER_SPRITE_WIDTH}
            height={PLAYER_SPRITE_HEIGHT}
            preserveAspectRatio="xMidYMid meet"
          />
        </svg>

        <div className="run-run-hud">
          <p className="run-run-score">{score}</p>
          <p className="run-run-best">BEST {displayedBestScore}</p>
          <p className="run-run-meta">
            속도 {speed.toFixed(1)} · 전환 {turnCount} · {(elapsedMs / 1000).toFixed(1)}s
          </p>
        </div>

        <p className="run-run-status">{statusText}</p>
        <p className="zigzag-tap-hint">왼쪽/오른쪽 터치로 방향 전환</p>

        <div className="run-run-overlay-actions">
          <button
            className="run-run-action-button"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={finishRound}
          >
            종료
          </button>
          <button
            className="run-run-action-button ghost"
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            나가기
          </button>
        </div>
      </div>
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
