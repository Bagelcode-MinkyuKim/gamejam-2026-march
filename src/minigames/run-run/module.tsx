import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const VIEWBOX_WIDTH = 160
const VIEWBOX_HEIGHT = 260
const WORLD_SCALE = 2.4
const CAMERA_FOLLOW_Y = 196
const CAMERA_ROTATE_MAX_DEG = 17
const CAMERA_ROTATE_SMOOTHING = 0.14
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

function RunRunGame({ onFinish, onExit }: MiniGameSessionProps) {
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>(() => createInitialRoad())
  const [player, setPlayer] = useState<Point>(() => ({ x: 0, y: 1 }))
  const [direction, setDirection] = useState<MoveDirection>('right')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [speed, setSpeed] = useState(START_SPEED)
  const [turnCount, setTurnCount] = useState(0)
  const [score, setScore] = useState(0)
  const [statusText, setStatusText] = useState('탭하면 좌/우 전환됩니다. 코스 밖으로 나가면 종료됩니다.')
  const [cameraRotationDeg, setCameraRotationDeg] = useState(0)

  const roadRef = useRef<RoadSegment[]>(roadSegments)
  const playerRef = useRef<Point>(player)
  const directionRef = useRef<MoveDirection>(direction)
  const cameraRotationRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const finishedRef = useRef(false)

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
        if (
          screenPoint.y < -WALL_VISIBLE_MARGIN ||
          screenPoint.y > VIEWBOX_HEIGHT + WALL_VISIBLE_MARGIN
        ) {
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
  }, [finishRound])

  return (
    <section className="mini-game-panel" aria-label="run-run-game">
      <h3>달려달려</h3>
      <p className="mini-game-description">지그재그 길을 따라 탭으로 좌우 전환하며 최대 거리까지 달리세요.</p>
      <p className="mini-game-description">{statusText}</p>

      <div className="zigzag-board" onPointerDown={switchDirection} role="presentation">
        <svg className="zigzag-svg" viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} aria-label="zigzag-road">
          <g transform={worldLayerTransform}>
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
