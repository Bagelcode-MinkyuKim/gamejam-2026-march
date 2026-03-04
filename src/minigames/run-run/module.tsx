import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MiniGameModule, MiniGameSessionProps } from '../contracts'
import taeRun00 from '../../../assets/images/Sequence/Tae Run/Tae Run 00.png'
import taeRun01 from '../../../assets/images/Sequence/Tae Run/Tae Run 01.png'
import taeRun02 from '../../../assets/images/Sequence/Tae Run/Tae Run 02.png'
import taeRun03 from '../../../assets/images/Sequence/Tae Run/Tae Run 03.png'
import taeRun04 from '../../../assets/images/Sequence/Tae Run/Tae Run 04.png'
import taeRun05 from '../../../assets/images/Sequence/Tae Run/Tae Run 05.png'
import taeRun06 from '../../../assets/images/Sequence/Tae Run/Tae Run 06.png'
import taeRun07 from '../../../assets/images/Sequence/Tae Run/Tae Run 07.png'
import taeRun08 from '../../../assets/images/Sequence/Tae Run/Tae Run 08.png'
import taeRun09 from '../../../assets/images/Sequence/Tae Run/Tae Run 09.png'
import taeRun10 from '../../../assets/images/Sequence/Tae Run/Tae Run 10.png'
import taeRun11 from '../../../assets/images/Sequence/Tae Run/Tae Run 11.png'
import taeRun12 from '../../../assets/images/Sequence/Tae Run/Tae Run 12.png'
import taeRun13 from '../../../assets/images/Sequence/Tae Run/Tae Run 13.png'
import taeRun14 from '../../../assets/images/Sequence/Tae Run/Tae Run 14.png'
import taeRun15 from '../../../assets/images/Sequence/Tae Run/Tae Run 15.png'
import taeRun16 from '../../../assets/images/Sequence/Tae Run/Tae Run 16.png'
import taeRun17 from '../../../assets/images/Sequence/Tae Run/Tae Run 17.png'
import taeRun18 from '../../../assets/images/Sequence/Tae Run/Tae Run 18.png'
import taeRun19 from '../../../assets/images/Sequence/Tae Run/Tae Run 19.png'
import wallHuman01 from '../../../assets/images/Human 01.png'
import wallHuman02 from '../../../assets/images/Human 02.png'
import wallHuman03 from '../../../assets/images/Human 03.png'
import wallHuman04 from '../../../assets/images/Human 04.png'

const TICK_MS = 16
const START_SPEED = 36.4
const MAX_SPEED = 100.8
const ACCEL_PER_SECOND = 14.7

const SEGMENT_MIN_LENGTH = 24
const SEGMENT_MAX_LENGTH = 52
const ROAD_HALF_WIDTH = 35.2
const INITIAL_SEGMENTS = 52
const INITIAL_STRAIGHT_SEGMENTS = 12
const EXTEND_SEGMENTS = 24
const LOOKAHEAD_DISTANCE = 200
const ROAD_SELF_AVOID_DISTANCE = ROAD_HALF_WIDTH * 2.15
const ROAD_SELF_AVOID_IGNORE_TAIL_SEGMENTS = 8
const BASE_FORWARD_ANGLE = Math.PI / 2
const MAX_HEADING_DEVIATION = (92 * Math.PI) / 180
const TURN_START_PROBABILITY = 0.26
const TURN_RETURN_PROBABILITY = 0.28
const TURN_MAX_STEP_PER_SEGMENT = (7.6 * Math.PI) / 180
const TURN_STABLE_TOLERANCE = (3.2 * Math.PI) / 180
const TURN_SIDE_MIN_SEGMENTS = 3
const TURN_SIDE_MAX_SEGMENTS = 7
const CURVE_MEANDER_BASE_MAX_OFFSET = (14 * Math.PI) / 180
const CURVE_MEANDER_SIDE_MAX_OFFSET = (10 * Math.PI) / 180
const CURVE_MEANDER_BASE_MIN_OFFSET = (3.4 * Math.PI) / 180
const CURVE_MEANDER_SIDE_MIN_OFFSET = (2.6 * Math.PI) / 180
const CURVE_MEANDER_STEP_PER_SEGMENT = (1.05 * Math.PI) / 180
const CURVE_MEANDER_RETARGET_MIN_SEGMENTS = 10
const CURVE_MEANDER_RETARGET_MAX_SEGMENTS = 20

const VIEWBOX_WIDTH = 162
const VIEWBOX_HEIGHT = 288
const WORLD_SCALE = 1.62
const ROAD_STROKE_HALF_PX = ROAD_HALF_WIDTH * WORLD_SCALE
const CAMERA_BOTTOM_MARGIN = ROAD_STROKE_HALF_PX + 4
const CAMERA_FOLLOW_Y = VIEWBOX_HEIGHT - CAMERA_BOTTOM_MARGIN
const CAMERA_FOLLOW_LERP = 0.14

const RUN_SEQUENCE_FPS = 24
const PLAYER_SOURCE_WIDTH = 1200
const PLAYER_SOURCE_HEIGHT = 1400
const PLAYER_SPRITE_HEIGHT = 50
const PLAYER_SPRITE_WIDTH = (PLAYER_SPRITE_HEIGHT * PLAYER_SOURCE_WIDTH) / PLAYER_SOURCE_HEIGHT
const WALL_CHARACTER_SPACING = 12
const WALL_CHARACTER_HEIGHT = 40
const WALL_CHARACTER_PADDING = 2
const WALL_VISIBLE_MARGIN = 80
const WALL_START_OFFSET = 0
const WALL_INNER_EDGE_OFFSET = 2.5

const WALL_CHARACTERS = [
  { src: wallHuman01, pixelWidth: 335, pixelHeight: 410 },
  { src: wallHuman02, pixelWidth: 186, pixelHeight: 429 },
  { src: wallHuman03, pixelWidth: 209, pixelHeight: 403 },
  { src: wallHuman04, pixelWidth: 229, pixelHeight: 439 },
] as const

const WALL_CHARACTER_PATTERN = [0, 1, 2, 3, 2, 1] as const
const RUN_SEQUENCE_FRAMES = [
  taeRun00,
  taeRun01,
  taeRun02,
  taeRun03,
  taeRun04,
  taeRun05,
  taeRun06,
  taeRun07,
  taeRun08,
  taeRun09,
  taeRun10,
  taeRun11,
  taeRun12,
  taeRun13,
  taeRun14,
  taeRun15,
  taeRun16,
  taeRun17,
  taeRun18,
  taeRun19,
] as const

interface Point {
  readonly x: number
  readonly y: number
}

interface RoadSegment {
  readonly start: Point
  readonly end: Point
  readonly headingAngle: number
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

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1))
}

function toDirectionVector(direction: MoveDirection, headingAngle: number): Point {
  const moveAngle = direction === 'right' ? headingAngle - Math.PI / 4 : headingAngle + Math.PI / 4
  return {
    x: Math.cos(moveAngle),
    y: Math.sin(moveAngle),
  }
}

function movePointAlongHeading(point: Point, distance: number, headingAngle: number): Point {
  return {
    x: point.x + Math.cos(headingAngle) * distance,
    y: point.y + Math.sin(headingAngle) * distance,
  }
}

function normalizeAngle(angle: number): number {
  let normalized = angle
  while (normalized <= -Math.PI) {
    normalized += Math.PI * 2
  }
  while (normalized > Math.PI) {
    normalized -= Math.PI * 2
  }
  return normalized
}

function inferLastHeadingAngle(segments: RoadSegment[]): number {
  if (segments.length === 0) {
    return BASE_FORWARD_ANGLE
  }

  return segments[segments.length - 1].headingAngle
}

function inferLastHeadingVelocity(segments: RoadSegment[]): number {
  if (segments.length < 2) {
    return 0
  }

  const previous = segments[segments.length - 2]
  const current = segments[segments.length - 1]
  return normalizeAngle(current.headingAngle - previous.headingAngle)
}

function distanceBetweenPoints(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function angleDistance(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b))
}

function isNearAngle(angle: number, target: number, tolerance: number): boolean {
  return angleDistance(angle, target) <= tolerance
}

function nearestSideTarget(headingAngle: number): number {
  return normalizeAngle(
    BASE_FORWARD_ANGLE + (normalizeAngle(headingAngle - BASE_FORWARD_ANGLE) >= 0 ? Math.PI / 2 : -Math.PI / 2),
  )
}

function stepTowardAngle(current: number, target: number, maxStep: number): number {
  const delta = normalizeAngle(target - current)
  if (Math.abs(delta) <= maxStep) {
    return normalizeAngle(target)
  }

  return normalizeAngle(current + Math.sign(delta) * maxStep)
}

function stepTowardValue(current: number, target: number, maxStep: number): number {
  const delta = target - current
  if (Math.abs(delta) <= maxStep) {
    return target
  }

  return current + Math.sign(delta) * maxStep
}

function pickMeanderTargetOffset(maxOffset: number, minOffset: number, preferredSign: number = 0): number {
  const baseSign = preferredSign === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(preferredSign)
  const finalSign = Math.random() < 0.74 ? baseSign : -baseSign
  const magnitude = randomBetween(minOffset, maxOffset)
  return finalSign * magnitude
}

function enforceMinAbsOffset(
  offset: number,
  minOffset: number,
  maxOffset: number,
  preferredSign: number = 0,
): number {
  const clamped = clampNumber(offset, -maxOffset, maxOffset)
  if (Math.abs(clamped) >= minOffset) {
    return clamped
  }

  if (maxOffset < minOffset) {
    return clamped
  }

  const sign = preferredSign === 0 ? (clamped === 0 ? 1 : Math.sign(clamped)) : Math.sign(preferredSign)
  return sign * minOffset
}

function clampHeadingAngle(headingAngle: number): number {
  const diff = normalizeAngle(headingAngle - BASE_FORWARD_ANGLE)
  return normalizeAngle(BASE_FORWARD_ANGLE + clampNumber(diff, -MAX_HEADING_DEVIATION, MAX_HEADING_DEVIATION))
}

function inferInitialTurnTarget(segments: RoadSegment[], currentHeadingAngle: number): number | null {
  if (segments.length < 2) {
    return null
  }

  const baseBand = CURVE_MEANDER_BASE_MAX_OFFSET + TURN_STABLE_TOLERANCE * 1.2
  if (isNearAngle(currentHeadingAngle, BASE_FORWARD_ANGLE, baseBand)) {
    return null
  }

  const sideTarget = nearestSideTarget(currentHeadingAngle)
  const sideBand = CURVE_MEANDER_SIDE_MAX_OFFSET + TURN_STABLE_TOLERANCE * 1.2
  if (isNearAngle(currentHeadingAngle, sideTarget, sideBand)) {
    return null
  }

  const velocity = inferLastHeadingVelocity(segments)
  if (Math.abs(velocity) > 0.0001) {
    return normalizeAngle(BASE_FORWARD_ANGLE + (velocity >= 0 ? Math.PI / 2 : -Math.PI / 2))
  }

  return sideTarget
}

function inferSideStableSegments(segments: RoadSegment[]): number {
  if (segments.length === 0) {
    return 0
  }

  const sideTarget = nearestSideTarget(segments[segments.length - 1].headingAngle)
  const tolerance = CURVE_MEANDER_SIDE_MAX_OFFSET + TURN_STABLE_TOLERANCE * 1.2
  if (!isNearAngle(segments[segments.length - 1].headingAngle, sideTarget, tolerance)) {
    return 0
  }

  let count = 0
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    if (!isNearAngle(segments[index].headingAngle, sideTarget, tolerance)) {
      break
    }
    count += 1
  }

  return count
}

function isPointNearOlderRoad(point: Point, roadSegments: RoadSegment[]): boolean {
  const inspectUntil = Math.max(0, roadSegments.length - ROAD_SELF_AVOID_IGNORE_TAIL_SEGMENTS)
  for (let index = 0; index < inspectUntil; index += 1) {
    const segment = roadSegments[index]
    if (distancePointToSegment(point, segment.start, segment.end) < ROAD_SELF_AVOID_DISTANCE) {
      return true
    }
  }

  return false
}

function extendRoad(
  segments: RoadSegment[],
  segmentCount: number,
  turnsEnabled: boolean,
  allowSharpTurns: boolean = true,
): RoadSegment[] {
  const next = [...segments]
  let currentHeadingAngle = inferLastHeadingAngle(next)
  let activeTurnTarget = allowSharpTurns ? inferInitialTurnTarget(next, currentHeadingAngle) : null
  let sideStableSegments = allowSharpTurns ? inferSideStableSegments(next) : 0
  let currentPoint = next.length > 0 ? next[next.length - 1].end : { x: 0, y: 0 }
  const initialSideTarget = nearestSideTarget(currentHeadingAngle)
  const initialUseBaseAnchor =
    angleDistance(currentHeadingAngle, BASE_FORWARD_ANGLE) <= angleDistance(currentHeadingAngle, initialSideTarget)
  const initialAnchor = initialUseBaseAnchor ? BASE_FORWARD_ANGLE : initialSideTarget
  const initialMeanderLimit = initialUseBaseAnchor ? CURVE_MEANDER_BASE_MAX_OFFSET : CURVE_MEANDER_SIDE_MAX_OFFSET
  const initialMeanderMin = initialUseBaseAnchor ? CURVE_MEANDER_BASE_MIN_OFFSET : CURVE_MEANDER_SIDE_MIN_OFFSET
  let meanderOffset = enforceMinAbsOffset(
    normalizeAngle(currentHeadingAngle - initialAnchor),
    initialMeanderMin,
    initialMeanderLimit,
    normalizeAngle(currentHeadingAngle - initialAnchor),
  )
  let meanderTargetOffset = pickMeanderTargetOffset(initialMeanderLimit, initialMeanderMin, meanderOffset)
  let meanderSegmentsUntilRetarget = randomIntInclusive(
    CURVE_MEANDER_RETARGET_MIN_SEGMENTS,
    CURVE_MEANDER_RETARGET_MAX_SEGMENTS,
  )

  for (let index = 0; index < segmentCount; index += 1) {
    const segmentLength = randomBetween(SEGMENT_MIN_LENGTH, SEGMENT_MAX_LENGTH)

    if (turnsEnabled) {
      if (!allowSharpTurns) {
        const meanderLimit = CURVE_MEANDER_BASE_MAX_OFFSET
        const meanderMin = CURVE_MEANDER_BASE_MIN_OFFSET
        meanderOffset = enforceMinAbsOffset(
          normalizeAngle(currentHeadingAngle - BASE_FORWARD_ANGLE),
          meanderMin,
          meanderLimit,
          meanderOffset,
        )
        if (meanderSegmentsUntilRetarget <= 0) {
          meanderTargetOffset = pickMeanderTargetOffset(meanderLimit, meanderMin, meanderOffset)
          meanderSegmentsUntilRetarget = randomIntInclusive(
            CURVE_MEANDER_RETARGET_MIN_SEGMENTS,
            CURVE_MEANDER_RETARGET_MAX_SEGMENTS,
          )
        } else {
          meanderSegmentsUntilRetarget -= 1
        }
        meanderTargetOffset = enforceMinAbsOffset(meanderTargetOffset, meanderMin, meanderLimit, meanderTargetOffset)
        meanderOffset = enforceMinAbsOffset(
          stepTowardValue(meanderOffset, meanderTargetOffset, CURVE_MEANDER_STEP_PER_SEGMENT),
          meanderMin,
          meanderLimit,
          meanderTargetOffset,
        )
        currentHeadingAngle = normalizeAngle(BASE_FORWARD_ANGLE + meanderOffset)
        activeTurnTarget = null
        sideStableSegments = 0
      } else {
      if (activeTurnTarget === null) {
        const sideTarget = nearestSideTarget(currentHeadingAngle)
        const nearBase = isNearAngle(
          currentHeadingAngle,
          BASE_FORWARD_ANGLE,
          CURVE_MEANDER_BASE_MAX_OFFSET + TURN_STABLE_TOLERANCE,
        )
        const nearSide = isNearAngle(
          currentHeadingAngle,
          sideTarget,
          CURVE_MEANDER_SIDE_MAX_OFFSET + TURN_STABLE_TOLERANCE,
        )

        if (nearBase) {
          const meanderLimit = CURVE_MEANDER_BASE_MAX_OFFSET
          const meanderMin = CURVE_MEANDER_BASE_MIN_OFFSET
          meanderOffset = enforceMinAbsOffset(
            normalizeAngle(currentHeadingAngle - BASE_FORWARD_ANGLE),
            meanderMin,
            meanderLimit,
            meanderOffset,
          )
          if (meanderSegmentsUntilRetarget <= 0) {
            meanderTargetOffset = pickMeanderTargetOffset(meanderLimit, meanderMin, meanderOffset)
            meanderSegmentsUntilRetarget = randomIntInclusive(
              CURVE_MEANDER_RETARGET_MIN_SEGMENTS,
              CURVE_MEANDER_RETARGET_MAX_SEGMENTS,
            )
          } else {
            meanderSegmentsUntilRetarget -= 1
          }
          meanderTargetOffset = enforceMinAbsOffset(meanderTargetOffset, meanderMin, meanderLimit, meanderTargetOffset)
          meanderOffset = enforceMinAbsOffset(
            stepTowardValue(meanderOffset, meanderTargetOffset, CURVE_MEANDER_STEP_PER_SEGMENT),
            meanderMin,
            meanderLimit,
            meanderTargetOffset,
          )
          currentHeadingAngle = normalizeAngle(BASE_FORWARD_ANGLE + meanderOffset)
          sideStableSegments = 0
          if (Math.random() < TURN_START_PROBABILITY) {
            activeTurnTarget = normalizeAngle(BASE_FORWARD_ANGLE + (Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2))
            meanderTargetOffset = pickMeanderTargetOffset(
              CURVE_MEANDER_SIDE_MAX_OFFSET,
              CURVE_MEANDER_SIDE_MIN_OFFSET,
              normalizeAngle(activeTurnTarget - BASE_FORWARD_ANGLE),
            )
          }
        } else if (nearSide) {
          const meanderLimit = CURVE_MEANDER_SIDE_MAX_OFFSET
          const meanderMin = CURVE_MEANDER_SIDE_MIN_OFFSET
          meanderOffset = enforceMinAbsOffset(
            normalizeAngle(currentHeadingAngle - sideTarget),
            meanderMin,
            meanderLimit,
            meanderOffset,
          )
          if (meanderSegmentsUntilRetarget <= 0) {
            meanderTargetOffset = pickMeanderTargetOffset(meanderLimit, meanderMin, meanderOffset)
            meanderSegmentsUntilRetarget = randomIntInclusive(
              CURVE_MEANDER_RETARGET_MIN_SEGMENTS,
              CURVE_MEANDER_RETARGET_MAX_SEGMENTS,
            )
          } else {
            meanderSegmentsUntilRetarget -= 1
          }
          meanderTargetOffset = enforceMinAbsOffset(meanderTargetOffset, meanderMin, meanderLimit, meanderTargetOffset)
          meanderOffset = enforceMinAbsOffset(
            stepTowardValue(meanderOffset, meanderTargetOffset, CURVE_MEANDER_STEP_PER_SEGMENT),
            meanderMin,
            meanderLimit,
            meanderTargetOffset,
          )
          currentHeadingAngle = normalizeAngle(sideTarget + meanderOffset)
          sideStableSegments += 1
          if (
            sideStableSegments >= TURN_SIDE_MIN_SEGMENTS &&
            (sideStableSegments >= TURN_SIDE_MAX_SEGMENTS || Math.random() < TURN_RETURN_PROBABILITY)
          ) {
            activeTurnTarget = BASE_FORWARD_ANGLE
            sideStableSegments = 0
            meanderTargetOffset = pickMeanderTargetOffset(
              CURVE_MEANDER_BASE_MAX_OFFSET,
              CURVE_MEANDER_BASE_MIN_OFFSET,
              meanderOffset,
            )
          }
        } else {
          activeTurnTarget = sideTarget
          sideStableSegments = 0
          meanderTargetOffset = pickMeanderTargetOffset(
            CURVE_MEANDER_SIDE_MAX_OFFSET,
            CURVE_MEANDER_SIDE_MIN_OFFSET,
            normalizeAngle(sideTarget - BASE_FORWARD_ANGLE),
          )
          meanderSegmentsUntilRetarget = randomIntInclusive(
            CURVE_MEANDER_RETARGET_MIN_SEGMENTS,
            CURVE_MEANDER_RETARGET_MAX_SEGMENTS,
          )
        }
      }

      if (activeTurnTarget !== null) {
        meanderOffset = stepTowardValue(meanderOffset, 0, CURVE_MEANDER_STEP_PER_SEGMENT * 1.4)
        currentHeadingAngle = stepTowardAngle(currentHeadingAngle, activeTurnTarget, TURN_MAX_STEP_PER_SEGMENT)
        if (isNearAngle(currentHeadingAngle, activeTurnTarget, TURN_STABLE_TOLERANCE)) {
          currentHeadingAngle = normalizeAngle(activeTurnTarget)
          activeTurnTarget = null
          meanderSegmentsUntilRetarget = randomIntInclusive(
            CURVE_MEANDER_RETARGET_MIN_SEGMENTS,
            CURVE_MEANDER_RETARGET_MAX_SEGMENTS,
          )
        }
      }
      }

      currentHeadingAngle = clampHeadingAngle(currentHeadingAngle)
    } else {
      activeTurnTarget = null
      sideStableSegments = 0
      meanderOffset = 0
      meanderTargetOffset = 0
      meanderSegmentsUntilRetarget = randomIntInclusive(
        CURVE_MEANDER_RETARGET_MIN_SEGMENTS,
        CURVE_MEANDER_RETARGET_MAX_SEGMENTS,
      )
      currentHeadingAngle = BASE_FORWARD_ANGLE
    }

    let endPoint = movePointAlongHeading(currentPoint, segmentLength, currentHeadingAngle)
    if (turnsEnabled && isPointNearOlderRoad(endPoint, next)) {
      let resolved = false

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const centerPull = normalizeAngle(BASE_FORWARD_ANGLE - currentHeadingAngle) * 0.22
        const spread = TURN_MAX_STEP_PER_SEGMENT * (1 + attempt * 0.32)
        const candidateHeadingAngle = clampHeadingAngle(
          currentHeadingAngle + centerPull + randomBetween(-spread, spread),
        )

        const candidateEnd = movePointAlongHeading(currentPoint, segmentLength, candidateHeadingAngle)
        if (!isPointNearOlderRoad(candidateEnd, next)) {
          currentHeadingAngle = candidateHeadingAngle
          endPoint = candidateEnd
          resolved = true
          break
        }
      }

      if (!resolved) {
        currentHeadingAngle = stepTowardAngle(currentHeadingAngle, BASE_FORWARD_ANGLE, TURN_MAX_STEP_PER_SEGMENT * 1.25)
        currentHeadingAngle = clampHeadingAngle(currentHeadingAngle)
        endPoint = movePointAlongHeading(currentPoint, segmentLength, currentHeadingAngle)
      }
    }

    next.push({
      start: currentPoint,
      end: endPoint,
      headingAngle: currentHeadingAngle,
    })

    currentPoint = endPoint
  }

  return next
}

function createInitialRoad(): RoadSegment[] {
  const straightSegments = Math.min(INITIAL_SEGMENTS, INITIAL_STRAIGHT_SEGMENTS)
  const initialStraightRoad = extendRoad([], straightSegments, true, false)
  const remained = INITIAL_SEGMENTS - straightSegments
  if (remained <= 0) {
    return initialStraightRoad
  }

  return extendRoad(initialStraightRoad, remained, true, true)
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

function toScore(distance: number): number {
  return Math.max(0, Math.floor(distance * 1.5))
}

function worldToScreen(point: Point, anchor: Point): Point {
  return {
    x: VIEWBOX_WIDTH / 2 + (point.x - anchor.x) * WORLD_SCALE,
    y: CAMERA_FOLLOW_Y - (point.y - anchor.y) * WORLD_SCALE,
  }
}

function pickWallCharacterIndex(slotIndex: number, side: WallSide): number {
  const sideOffset = side === 'left' ? 0 : Math.floor(WALL_CHARACTER_PATTERN.length / 2)
  const patternIndex = (slotIndex + sideOffset) % WALL_CHARACTER_PATTERN.length
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

function toNormalBySide(tangent: Point, side: WallSide): Point {
  return side === 'left' ? { x: -tangent.y, y: tangent.x } : { x: tangent.y, y: -tangent.x }
}

function intersectInfiniteLines(pointA: Point, directionA: Point, pointB: Point, directionB: Point): Point | null {
  const denominator = directionA.x * directionB.y - directionA.y * directionB.x
  if (Math.abs(denominator) < 0.00001) {
    return null
  }

  const deltaX = pointB.x - pointA.x
  const deltaY = pointB.y - pointA.y
  const t = (deltaX * directionB.y - deltaY * directionB.x) / denominator
  return {
    x: pointA.x + directionA.x * t,
    y: pointA.y + directionA.y * t,
  }
}

function toEdgePolylineNodes(roadSegments: RoadSegment[], side: WallSide, edgeOffset: number): Point[] {
  if (roadSegments.length === 0) {
    return []
  }

  const centerNodes = toRoadCenterNodes(roadSegments)
  const tangents: Point[] = []
  for (const segment of roadSegments) {
    const dx = segment.end.x - segment.start.x
    const dy = segment.end.y - segment.start.y
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      tangents.push({ x: 0, y: 1 })
      continue
    }
    tangents.push({ x: dx / length, y: dy / length })
  }

  const edgeNodes: Point[] = []
  const firstNormal = toNormalBySide(tangents[0], side)
  edgeNodes.push({
    x: centerNodes[0].x + firstNormal.x * edgeOffset,
    y: centerNodes[0].y + firstNormal.y * edgeOffset,
  })

  for (let index = 1; index < centerNodes.length - 1; index += 1) {
    const center = centerNodes[index]
    const previousTangent = tangents[index - 1]
    const nextTangent = tangents[index]
    const previousNormal = toNormalBySide(previousTangent, side)
    const nextNormal = toNormalBySide(nextTangent, side)

    const previousOffsetPoint = {
      x: center.x + previousNormal.x * edgeOffset,
      y: center.y + previousNormal.y * edgeOffset,
    }
    const nextOffsetPoint = {
      x: center.x + nextNormal.x * edgeOffset,
      y: center.y + nextNormal.y * edgeOffset,
    }

    const joinPoint = intersectInfiniteLines(previousOffsetPoint, previousTangent, nextOffsetPoint, nextTangent)
    if (joinPoint === null) {
      edgeNodes.push({
        x: (previousOffsetPoint.x + nextOffsetPoint.x) / 2,
        y: (previousOffsetPoint.y + nextOffsetPoint.y) / 2,
      })
      continue
    }

    edgeNodes.push(joinPoint)
  }

  const lastCenter = centerNodes[centerNodes.length - 1]
  const lastNormal = toNormalBySide(tangents[tangents.length - 1], side)
  edgeNodes.push({
    x: lastCenter.x + lastNormal.x * edgeOffset,
    y: lastCenter.y + lastNormal.y * edgeOffset,
  })

  return edgeNodes
}

function toAnchorsFromPolyline(polylineNodes: Point[], side: WallSide): WallAnchor[] {
  if (polylineNodes.length < 2) {
    return []
  }

  const anchors: WallAnchor[] = []
  let distanceToNext = WALL_START_OFFSET
  let slotIndex = 0
  const EPSILON = 0.0001

  for (let index = 1; index < polylineNodes.length; index += 1) {
    const start = polylineNodes[index - 1]
    const end = polylineNodes[index]
    const dx = end.x - start.x
    const dy = end.y - start.y
    const segmentLength = Math.hypot(dx, dy)
    if (segmentLength <= EPSILON) {
      continue
    }

    const directionX = dx / segmentLength
    const directionY = dy / segmentLength

    while (distanceToNext <= segmentLength + EPSILON) {
      anchors.push({
        point: {
          x: start.x + directionX * distanceToNext,
          y: start.y + directionY * distanceToNext,
        },
        side,
        slotIndex,
      })
      slotIndex += 1
      distanceToNext += WALL_CHARACTER_SPACING
    }

    distanceToNext -= segmentLength
  }

  return anchors
}

function toWallEdgePoints(roadSegments: RoadSegment[]): WallAnchor[] {
  const edgeOffset = ROAD_HALF_WIDTH + WALL_CHARACTER_PADDING
  const leftNodes = toEdgePolylineNodes(roadSegments, 'left', edgeOffset)
  const rightNodes = toEdgePolylineNodes(roadSegments, 'right', edgeOffset)
  return [...toAnchorsFromPolyline(leftNodes, 'left'), ...toAnchorsFromPolyline(rightNodes, 'right')]
}

function resolveHeadingAtPoint(
  point: Point,
  roadSegments: RoadSegment[],
  hintSegmentIndex: number,
): { headingAngle: number; segmentIndex: number } {
  if (roadSegments.length === 0) {
    return { headingAngle: BASE_FORWARD_ANGLE, segmentIndex: 0 }
  }

  const SEARCH_BACK = 8
  const SEARCH_FORWARD = 12
  const hasHint = Number.isFinite(hintSegmentIndex)
  const safeHintIndex = hasHint ? Math.max(0, Math.min(roadSegments.length - 1, Math.floor(hintSegmentIndex))) : 0

  const localStart = hasHint ? Math.max(0, safeHintIndex - SEARCH_BACK) : 0
  const localEnd = hasHint ? Math.min(roadSegments.length - 1, safeHintIndex + SEARCH_FORWARD) : roadSegments.length - 1

  let nearestIndex = localStart
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = localStart; index <= localEnd; index += 1) {
    const segment = roadSegments[index]
    const distance = distancePointToSegment(point, segment.start, segment.end)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestIndex = index
    }
  }

  if (hasHint && nearestDistance > ROAD_HALF_WIDTH * 2.4) {
    for (let index = 0; index < roadSegments.length; index += 1) {
      const segment = roadSegments[index]
      const distance = distancePointToSegment(point, segment.start, segment.end)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestIndex = index
      }
    }
  }

  return {
    headingAngle: roadSegments[nearestIndex].headingAngle,
    segmentIndex: nearestIndex,
  }
}

function RunRunGame({ onFinish, onExit, bestScore = 0 }: MiniGameSessionProps) {
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>(() => createInitialRoad())
  const [player, setPlayer] = useState<Point>(() => ({ x: 0, y: 1 }))
  const [cameraAnchor, setCameraAnchor] = useState<Point>(() => ({ x: 0, y: 1 }))
  const [elapsedMs, setElapsedMs] = useState(0)
  const [travelDistance, setTravelDistance] = useState(0)
  const [speed, setSpeed] = useState(START_SPEED)
  const [turnCount, setTurnCount] = useState(0)
  const [score, setScore] = useState(0)
  const [moveDirection, setMoveDirectionState] = useState<MoveDirection>('right')
  const [statusText, setStatusText] = useState('자동 출발! 좌/우 터치로 방향 전환하세요.')

  const roadRef = useRef<RoadSegment[]>(roadSegments)
  const playerRef = useRef<Point>(player)
  const cameraAnchorRef = useRef<Point>(cameraAnchor)
  const directionRef = useRef<MoveDirection>('right')
  const segmentIndexRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const travelDistanceRef = useRef(0)
  const finishedRef = useRef(false)

  const playerScreenPoint = useMemo(() => worldToScreen(player, cameraAnchor), [player, cameraAnchor])

  const playerSpriteX = useMemo(() => playerScreenPoint.x - PLAYER_SPRITE_WIDTH / 2, [playerScreenPoint.x])
  const playerSpriteY = useMemo(() => playerScreenPoint.y - PLAYER_SPRITE_HEIGHT + 8, [playerScreenPoint.y])
  const currentRunFrame = useMemo(() => {
    const frameIndex = Math.floor((elapsedMs / 1000) * RUN_SEQUENCE_FPS) % RUN_SEQUENCE_FRAMES.length
    return RUN_SEQUENCE_FRAMES[frameIndex]
  }, [elapsedMs])

  const wallSprites = useMemo<WallSprite[]>(() => {
    return toWallEdgePoints(roadSegments)
      .map((edgePoint) => {
        const screenPoint = worldToScreen(edgePoint.point, cameraAnchor)
        if (screenPoint.y < -WALL_VISIBLE_MARGIN || screenPoint.y > VIEWBOX_HEIGHT + WALL_VISIBLE_MARGIN) {
          return null
        }

        const characterIndex = pickWallCharacterIndex(edgePoint.slotIndex, edgePoint.side)
        const character = WALL_CHARACTERS[characterIndex]
        const spriteWidth = (WALL_CHARACTER_HEIGHT * character.pixelWidth) / character.pixelHeight
        const spriteX =
          edgePoint.side === 'left'
            ? screenPoint.x - spriteWidth + WALL_INNER_EDGE_OFFSET
            : screenPoint.x - WALL_INNER_EDGE_OFFSET

        return {
          key: `${edgePoint.side}-${edgePoint.slotIndex}`,
          href: character.src,
          x: spriteX,
          y: screenPoint.y - WALL_CHARACTER_HEIGHT + 2,
          width: spriteWidth,
          height: WALL_CHARACTER_HEIGHT,
          side: edgePoint.side,
        }
      })
      .filter((sprite): sprite is WallSprite => sprite !== null)
      .sort((a, b) => a.y - b.y)
  }, [cameraAnchor, roadSegments])

  const finishRound = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const finalDurationMs = elapsedMsRef.current > 0 ? elapsedMsRef.current : TICK_MS
    const finalScore = toScore(travelDistanceRef.current)
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

      const hasDirectionChanged = directionRef.current !== nextDirection

      directionRef.current = nextDirection
      setMoveDirectionState(nextDirection)

      if (hasDirectionChanged) {
        setTurnCount((previous) => previous + 1)
        setStatusText(nextDirection === 'left' ? '좌측으로 이동 중' : '우측으로 이동 중')
      }
    },
    [],
  )

  const toggleMoveDirection = useCallback(() => {
    setMoveDirection(toggleDirection(directionRef.current))
  }, [setMoveDirection])

  const setMoveDirectionFromClientX = useCallback(
    (clientX: number, boardElement: HTMLDivElement) => {
      const rect = boardElement.getBoundingClientRect()
      const nextDirection: MoveDirection = clientX - rect.left < rect.width / 2 ? 'left' : 'right'
      setMoveDirection(nextDirection)
    },
    [setMoveDirection],
  )

  const handleBoardPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setMoveDirectionFromClientX(event.clientX, event.currentTarget)
    },
    [setMoveDirectionFromClientX],
  )

  const handleBoardPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse' && event.buttons === 0) {
        return
      }

      setMoveDirectionFromClientX(event.clientX, event.currentTarget)
    },
    [setMoveDirectionFromClientX],
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

      elapsedMsRef.current += TICK_MS
      setElapsedMs(elapsedMsRef.current)

      const elapsedSeconds = elapsedMsRef.current / 1000
      const currentSpeed = Math.min(MAX_SPEED, START_SPEED + elapsedSeconds * ACCEL_PER_SECOND)
      setSpeed(currentSpeed)

      const movedDistance = currentSpeed * (TICK_MS / 1000)
      travelDistanceRef.current += movedDistance
      setTravelDistance(travelDistanceRef.current)

      const headingContext = resolveHeadingAtPoint(playerRef.current, roadRef.current, segmentIndexRef.current)
      segmentIndexRef.current = headingContext.segmentIndex
      const nextMoveVector = toDirectionVector(directionRef.current, headingContext.headingAngle)
      const movedPlayer = {
        x: playerRef.current.x + nextMoveVector.x * movedDistance,
        y: playerRef.current.y + nextMoveVector.y * movedDistance,
      }
      playerRef.current = movedPlayer
      setPlayer(movedPlayer)

      const previousCameraAnchor = cameraAnchorRef.current
      const nextCameraAnchor = {
        x: previousCameraAnchor.x + (movedPlayer.x - previousCameraAnchor.x) * CAMERA_FOLLOW_LERP,
        y: previousCameraAnchor.y + (movedPlayer.y - previousCameraAnchor.y) * CAMERA_FOLLOW_LERP,
      }
      cameraAnchorRef.current = nextCameraAnchor
      setCameraAnchor(nextCameraAnchor)

      let nextRoad = roadRef.current
      const tailPoint = nextRoad[nextRoad.length - 1]?.end
      if (tailPoint === undefined || distanceBetweenPoints(tailPoint, movedPlayer) < LOOKAHEAD_DISTANCE) {
        nextRoad = extendRoad(nextRoad, EXTEND_SEGMENTS, true)
      }

      roadRef.current = nextRoad
      setRoadSegments(nextRoad)

      const isSafe = isPointInsideRoad(movedPlayer, nextRoad)
      setScore(toScore(travelDistanceRef.current))

      if (!isSafe) {
        setStatusText('벽에 닿았습니다. 라운드 종료!')
        finishRound()
      }
    }, TICK_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [finishRound])

  const displayedBestScore = Math.max(bestScore, score)

  return (
    <section className="mini-game-panel run-run-panel" aria-label="run-run-game">
      <div
        className="zigzag-board run-run-board"
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handleBoardPointerMove}
        role="presentation"
      >
        <svg
          className="zigzag-svg run-run-svg"
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          preserveAspectRatio="xMidYMax meet"
          aria-label="zigzag-road"
        >
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
                sprite.side === 'left'
                  ? `translate(${(sprite.x * 2 + sprite.width).toFixed(2)} 0) scale(-1 1)`
                  : undefined
              }
              preserveAspectRatio="xMidYMid meet"
            />
          ))}

          <circle className="zigzag-player-shadow" cx={playerScreenPoint.x} cy={playerScreenPoint.y + 2.6} r="3.2" />
          <image
            className="zigzag-player-sprite"
            href={currentRunFrame}
            x={playerSpriteX}
            y={playerSpriteY}
            width={PLAYER_SPRITE_WIDTH}
            height={PLAYER_SPRITE_HEIGHT}
            transform={
              moveDirection === 'left'
                ? `translate(${(playerSpriteX * 2 + PLAYER_SPRITE_WIDTH).toFixed(2)} 0) scale(-1 1)`
                : undefined
            }
            preserveAspectRatio="xMidYMid meet"
          />
        </svg>

        <div className="run-run-hud">
          <p className="run-run-score">{score}</p>
          <p className="run-run-best">BEST {displayedBestScore}</p>
          <p className="run-run-meta">
            속도 {speed.toFixed(1)} · 전환 {turnCount} · {(elapsedMs / 1000).toFixed(1)}s · 이동 {travelDistance.toFixed(0)}
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
