import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties as ReactCSSProperties,
  PointerEvent as ReactPointerEvent,
} from 'react'
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
import runRunCar from '../../../assets/images/Run Run/Car.png'
import runRunItem01 from '../../../assets/images/Run Run/Item 01.png'
import runRunItem02 from '../../../assets/images/Run Run/Item 02.png'
import runRunItem03 from '../../../assets/images/Run Run/Item 03.png'
import runRunTile01 from '../../../assets/images/Run Run/Tile 01.png'

const TICK_MS = 16
const SPEED_STAGE_LEVELS = [100, 120, 140, 160] as const
const SPEED_RAMP_DURATION_SECONDS = 3
const SPEED_STAGE_INTERVAL_SECONDS = 15

const SEGMENT_MIN_LENGTH = 24
const SEGMENT_MAX_LENGTH = 52
const ROAD_HALF_WIDTH = 35.2 * 1.1
const INITIAL_SEGMENTS = 52
const INITIAL_STRAIGHT_SEGMENTS = 12
const EXTEND_SEGMENTS = 24
const LOOKAHEAD_DISTANCE = 200
const ROAD_SELF_AVOID_DISTANCE = ROAD_HALF_WIDTH * 2.65
const ROAD_SELF_AVOID_IGNORE_TAIL_SEGMENTS = 8
const ROAD_TRIM_TRIGGER_SEGMENTS = 220
const ROAD_KEEP_BEHIND_SEGMENTS = 44
const ROAD_KEEP_AHEAD_SEGMENTS = 156
const BASE_FORWARD_ANGLE = Math.PI / 2
const HEADING_UP = BASE_FORWARD_ANGLE
const HEADING_RIGHT = 0
const HEADING_DOWN = -Math.PI / 2
const HEADING_LEFT = Math.PI
const HORIZONTAL_TURN_TARGETS = [HEADING_LEFT, HEADING_RIGHT] as const
const VERTICAL_TURN_TARGETS = [HEADING_UP, HEADING_DOWN] as const
const MAX_HEADING_DEVIATION = Math.PI
const TURN_START_PROBABILITY = 0.32
const TURN_RETURN_PROBABILITY = 0.28
const TURN_MAX_STEP_PER_SEGMENT = (9.4 * Math.PI) / 180
const TURN_STABLE_TOLERANCE = (3.2 * Math.PI) / 180
const TURN_SIDE_MIN_SEGMENTS = 2
const TURN_SIDE_MAX_SEGMENTS = 5
const CURVE_MEANDER_BASE_MAX_OFFSET = (22 * Math.PI) / 180
const CURVE_MEANDER_SIDE_MAX_OFFSET = (17 * Math.PI) / 180
const CURVE_MEANDER_BASE_MIN_OFFSET = (8 * Math.PI) / 180
const CURVE_MEANDER_SIDE_MIN_OFFSET = (6.5 * Math.PI) / 180
const CURVE_MEANDER_STEP_PER_SEGMENT = (3 * Math.PI) / 180
const CURVE_MEANDER_RETARGET_MIN_SEGMENTS = 2
const CURVE_MEANDER_RETARGET_MAX_SEGMENTS = 5

const VIEWBOX_WIDTH = 162
const VIEWBOX_HEIGHT = 288
const WORLD_SCALE = 1.62
const GROUND_TILE_SIZE_VIEWBOX = 42
const GROUND_PATTERN_ID = 'run-run-ground-pattern'
const ROAD_STROKE_HALF_PX = ROAD_HALF_WIDTH * WORLD_SCALE
const CAMERA_BOTTOM_MARGIN = ROAD_STROKE_HALF_PX + 4
const CAMERA_FOLLOW_Y = VIEWBOX_HEIGHT - CAMERA_BOTTOM_MARGIN
const CAMERA_FOLLOW_LERP = 0.14

const RUN_SEQUENCE_FPS = 24
const PLAYER_SOURCE_WIDTH = 1200
const PLAYER_SOURCE_HEIGHT = 1400
const PLAYER_SPRITE_HEIGHT = 50
const PLAYER_SPRITE_WIDTH = (PLAYER_SPRITE_HEIGHT * PLAYER_SOURCE_WIDTH) / PLAYER_SOURCE_HEIGHT
const START_CAR_SOURCE_WIDTH = 1603
const START_CAR_SOURCE_HEIGHT = 780
const START_CAR_SPRITE_HEIGHT = 24 * 2.5
const START_CAR_SPRITE_WIDTH = (START_CAR_SPRITE_HEIGHT * START_CAR_SOURCE_WIDTH) / START_CAR_SOURCE_HEIGHT
const START_CAR_VERTICAL_OFFSET = 34
const ITEM_01_VALUE = 100
const ITEM_02_VALUE = 300
const ITEM_03_VALUE = 500
const ITEM_01_SOURCE_WIDTH = 409
const ITEM_01_SOURCE_HEIGHT = 387
const ITEM_02_SOURCE_WIDTH = 347
const ITEM_02_SOURCE_HEIGHT = 476
const ITEM_03_SOURCE_WIDTH = 447
const ITEM_03_SOURCE_HEIGHT = 377
const ITEM_SPRITE_HEIGHT = 16 * 1
const ITEM_01_SPRITE_WIDTH = (ITEM_SPRITE_HEIGHT * ITEM_01_SOURCE_WIDTH) / ITEM_01_SOURCE_HEIGHT
const ITEM_02_SPRITE_WIDTH = (ITEM_SPRITE_HEIGHT * ITEM_02_SOURCE_WIDTH) / ITEM_02_SOURCE_HEIGHT
const ITEM_03_SPRITE_WIDTH = (ITEM_SPRITE_HEIGHT * ITEM_03_SOURCE_WIDTH) / ITEM_03_SOURCE_HEIGHT
const ITEM_SPAWN_CHANCE_PER_SEGMENT = 0.56
const ITEM_SPAWN_MIN_GAP = 24
const ITEM_SPAWN_SIDE_OFFSET_RATIO = 0.54
const ITEM_COLLISION_RADIUS = 10
const ITEM_MIN_SPAWN_DISTANCE = 16
const ITEM_DESPAWN_MARGIN = 120
const ITEM_START_SPAWN_SKIP_SEGMENTS = INITIAL_STRAIGHT_SEGMENTS + 2
const ITEM_POPUP_DURATION_MS = 820
const ITEM_SWAY_DURATION_MIN_SECONDS = 0.9
const ITEM_SWAY_DURATION_STEP_SECONDS = 0.12
const ITEM_SWAY_DELAY_STEP_SECONDS = 0.08
const WALL_CHARACTER_SPACING = 12
const WALL_CHARACTER_HEIGHT = 40
const WALL_CHARACTER_PADDING = 2
const WALL_JOIN_MITER_LIMIT = 1.68
const WALL_VISIBLE_MARGIN = 80
const WALL_START_OFFSET = 0
const WALL_INNER_EDGE_OFFSET = 2.5

const WALL_CHARACTERS = [
  // 카메라 캐릭터는 가로 돌출부가 커서 벽 안쪽으로 더 튀어나와 보이므로 추가 보정을 준다.
  { src: wallHuman01, pixelWidth: 335, pixelHeight: 410, inwardBiasPx: 92 },
  { src: wallHuman02, pixelWidth: 186, pixelHeight: 429, inwardBiasPx: 0 },
  { src: wallHuman03, pixelWidth: 209, pixelHeight: 403, inwardBiasPx: 0 },
  { src: wallHuman04, pixelWidth: 229, pixelHeight: 439, inwardBiasPx: 0 },
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
type ItemKind = 'item01' | 'item02' | 'item03'

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

interface RunRunItem {
  readonly id: string
  readonly kind: ItemKind
  readonly point: Point
  readonly value: number
}

interface ItemPopup {
  readonly id: string
  readonly value: number
  readonly point: Point
  readonly bornAtMs: number
}

interface ItemSprite {
  readonly id: string
  readonly href: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly swayDelaySeconds: number
  readonly swayDurationSeconds: number
}

const ITEM_DEFINITIONS = {
  item01: {
    src: runRunItem01,
    value: ITEM_01_VALUE,
    weight: 0.78,
    spriteWidth: ITEM_01_SPRITE_WIDTH,
    spriteHeight: ITEM_SPRITE_HEIGHT,
  },
  item02: {
    src: runRunItem02,
    value: ITEM_02_VALUE,
    weight: 0.18,
    spriteWidth: ITEM_02_SPRITE_WIDTH,
    spriteHeight: ITEM_SPRITE_HEIGHT,
  },
  item03: {
    src: runRunItem03,
    value: ITEM_03_VALUE,
    weight: 0.04,
    spriteWidth: ITEM_03_SPRITE_WIDTH,
    spriteHeight: ITEM_SPRITE_HEIGHT,
  },
} as const

function toggleDirection(direction: MoveDirection): MoveDirection {
  return direction === 'left' ? 'right' : 'left'
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

function randomIntInclusive(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1))
}

function sampleItemKind(): ItemKind {
  const roll = Math.random()
  const threshold01 = ITEM_DEFINITIONS.item01.weight
  const threshold02 = threshold01 + ITEM_DEFINITIONS.item02.weight
  if (roll < threshold01) {
    return 'item01'
  }
  if (roll < threshold02) {
    return 'item02'
  }
  return 'item03'
}

function popupBonusClassName(value: number): string {
  if (value === ITEM_03_VALUE) {
    return 'bonus-500'
  }
  if (value === ITEM_02_VALUE) {
    return 'bonus-300'
  }
  return 'bonus-100'
}

function toDirectionVector(direction: MoveDirection, headingAngle: number): Point {
  const moveAngle = direction === 'right' ? headingAngle - Math.PI / 4 : headingAngle + Math.PI / 4
  return {
    x: Math.cos(moveAngle),
    y: Math.sin(moveAngle),
  }
}

function toUnitTangentFromSegment(segment: RoadSegment): Point {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const length = Math.hypot(dx, dy)
  if (length === 0) {
    return { x: 0, y: 1 }
  }

  return { x: dx / length, y: dy / length }
}

function toPointAlongSegment(segment: RoadSegment, t: number): Point {
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t,
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

function resolveSpeedAtElapsedSeconds(elapsedSeconds: number): number {
  const baseSpeed = SPEED_STAGE_LEVELS[0]
  if (elapsedSeconds < SPEED_RAMP_DURATION_SECONDS) {
    const progress = clampNumber(elapsedSeconds / SPEED_RAMP_DURATION_SECONDS, 0, 1)
    return baseSpeed * progress
  }

  const stageIndex = Math.min(
    SPEED_STAGE_LEVELS.length - 1,
    Math.floor(elapsedSeconds / SPEED_STAGE_INTERVAL_SECONDS),
  )
  return SPEED_STAGE_LEVELS[stageIndex]
}

function angleDistance(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b))
}

function isNearAngle(angle: number, target: number, tolerance: number): boolean {
  return angleDistance(angle, target) <= tolerance
}

function nearestTarget(headingAngle: number, targets: readonly number[]): number {
  let nearest = targets[0]
  let smallestDistance = angleDistance(headingAngle, nearest)
  for (let index = 1; index < targets.length; index += 1) {
    const candidate = targets[index]
    const distance = angleDistance(headingAngle, candidate)
    if (distance < smallestDistance) {
      nearest = candidate
      smallestDistance = distance
    }
  }

  return nearest
}

function nearestSideTarget(headingAngle: number): number {
  return nearestTarget(headingAngle, HORIZONTAL_TURN_TARGETS)
}

function nearestVerticalTarget(headingAngle: number): number {
  return nearestTarget(headingAngle, VERTICAL_TURN_TARGETS)
}

function pickRandomHorizontalTarget(): number {
  return HORIZONTAL_TURN_TARGETS[randomIntInclusive(0, HORIZONTAL_TURN_TARGETS.length - 1)]
}

function pickRandomVerticalTarget(): number {
  return VERTICAL_TURN_TARGETS[randomIntInclusive(0, VERTICAL_TURN_TARGETS.length - 1)]
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

  const verticalTarget = nearestVerticalTarget(currentHeadingAngle)
  const verticalBand = CURVE_MEANDER_BASE_MAX_OFFSET + TURN_STABLE_TOLERANCE * 1.2
  if (isNearAngle(currentHeadingAngle, verticalTarget, verticalBand)) {
    return null
  }

  const sideTarget = nearestSideTarget(currentHeadingAngle)
  const sideBand = CURVE_MEANDER_SIDE_MAX_OFFSET + TURN_STABLE_TOLERANCE * 1.2
  if (isNearAngle(currentHeadingAngle, sideTarget, sideBand)) {
    return null
  }

  const velocity = inferLastHeadingVelocity(segments)
  if (Math.abs(velocity) > 0.0001) {
    return Math.abs(Math.sin(currentHeadingAngle)) >= Math.abs(Math.cos(currentHeadingAngle))
      ? verticalTarget
      : sideTarget
  }

  return angleDistance(currentHeadingAngle, verticalTarget) <= angleDistance(currentHeadingAngle, sideTarget)
    ? verticalTarget
    : sideTarget
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

function crossProduct2D(origin: Point, pointA: Point, pointB: Point): number {
  return (pointA.x - origin.x) * (pointB.y - origin.y) - (pointA.y - origin.y) * (pointB.x - origin.x)
}

function isPointOnSegment(point: Point, start: Point, end: Point): boolean {
  const epsilon = 0.0001
  return (
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  )
}

function segmentsIntersect(startA: Point, endA: Point, startB: Point, endB: Point): boolean {
  const orientationA1 = crossProduct2D(startA, endA, startB)
  const orientationA2 = crossProduct2D(startA, endA, endB)
  const orientationB1 = crossProduct2D(startB, endB, startA)
  const orientationB2 = crossProduct2D(startB, endB, endA)
  const epsilon = 0.0001

  if (
    ((orientationA1 > epsilon && orientationA2 < -epsilon) || (orientationA1 < -epsilon && orientationA2 > epsilon)) &&
    ((orientationB1 > epsilon && orientationB2 < -epsilon) || (orientationB1 < -epsilon && orientationB2 > epsilon))
  ) {
    return true
  }

  if (Math.abs(orientationA1) <= epsilon && isPointOnSegment(startB, startA, endA)) {
    return true
  }
  if (Math.abs(orientationA2) <= epsilon && isPointOnSegment(endB, startA, endA)) {
    return true
  }
  if (Math.abs(orientationB1) <= epsilon && isPointOnSegment(startA, startB, endB)) {
    return true
  }
  if (Math.abs(orientationB2) <= epsilon && isPointOnSegment(endA, startB, endB)) {
    return true
  }

  return false
}

function distanceBetweenSegments(startA: Point, endA: Point, startB: Point, endB: Point): number {
  if (segmentsIntersect(startA, endA, startB, endB)) {
    return 0
  }

  return Math.min(
    distancePointToSegment(startA, startB, endB),
    distancePointToSegment(endA, startB, endB),
    distancePointToSegment(startB, startA, endA),
    distancePointToSegment(endB, startA, endA),
  )
}

function isSegmentNearOlderRoad(
  segmentStart: Point,
  segmentEnd: Point,
  roadSegments: RoadSegment[],
  minDistance: number = ROAD_SELF_AVOID_DISTANCE,
): boolean {
  const inspectUntil = Math.max(0, roadSegments.length - ROAD_SELF_AVOID_IGNORE_TAIL_SEGMENTS)
  for (let index = 0; index < inspectUntil; index += 1) {
    const segment = roadSegments[index]
    if (distanceBetweenSegments(segmentStart, segmentEnd, segment.start, segment.end) < minDistance) {
      return true
    }
  }

  return false
}

function measureSegmentClearanceToOlderRoad(segmentStart: Point, segmentEnd: Point, roadSegments: RoadSegment[]): number {
  const inspectUntil = Math.max(0, roadSegments.length - ROAD_SELF_AVOID_IGNORE_TAIL_SEGMENTS)
  let nearestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < inspectUntil; index += 1) {
    const segment = roadSegments[index]
    nearestDistance = Math.min(
      nearestDistance,
      distanceBetweenSegments(segmentStart, segmentEnd, segment.start, segment.end),
    )
  }

  return nearestDistance
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
  const initialVerticalTarget = nearestVerticalTarget(currentHeadingAngle)
  const initialSideTarget = nearestSideTarget(currentHeadingAngle)
  const initialUseVerticalAnchor =
    angleDistance(currentHeadingAngle, initialVerticalTarget) <= angleDistance(currentHeadingAngle, initialSideTarget)
  const initialAnchor = initialUseVerticalAnchor ? initialVerticalTarget : initialSideTarget
  const initialMeanderLimit = initialUseVerticalAnchor ? CURVE_MEANDER_BASE_MAX_OFFSET : CURVE_MEANDER_SIDE_MAX_OFFSET
  const initialMeanderMin = initialUseVerticalAnchor ? CURVE_MEANDER_BASE_MIN_OFFSET : CURVE_MEANDER_SIDE_MIN_OFFSET
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

  for (let generatedSegments = 0; generatedSegments < segmentCount; generatedSegments += 1) {
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
        const verticalTarget = nearestVerticalTarget(currentHeadingAngle)
        const sideTarget = nearestSideTarget(currentHeadingAngle)
        const nearVertical = isNearAngle(
          currentHeadingAngle,
          verticalTarget,
          CURVE_MEANDER_BASE_MAX_OFFSET + TURN_STABLE_TOLERANCE,
        )
        const nearSide = isNearAngle(
          currentHeadingAngle,
          sideTarget,
          CURVE_MEANDER_SIDE_MAX_OFFSET + TURN_STABLE_TOLERANCE,
        )

        if (nearVertical) {
          const meanderLimit = CURVE_MEANDER_BASE_MAX_OFFSET
          const meanderMin = CURVE_MEANDER_BASE_MIN_OFFSET
          meanderOffset = enforceMinAbsOffset(
            normalizeAngle(currentHeadingAngle - verticalTarget),
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
          currentHeadingAngle = normalizeAngle(verticalTarget + meanderOffset)
          sideStableSegments = 0
          if (Math.random() < TURN_START_PROBABILITY) {
            activeTurnTarget = pickRandomHorizontalTarget()
            meanderTargetOffset = pickMeanderTargetOffset(
              CURVE_MEANDER_SIDE_MAX_OFFSET,
              CURVE_MEANDER_SIDE_MIN_OFFSET,
              normalizeAngle(activeTurnTarget - verticalTarget),
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
            activeTurnTarget = pickRandomVerticalTarget()
            sideStableSegments = 0
            meanderTargetOffset = pickMeanderTargetOffset(
              CURVE_MEANDER_BASE_MAX_OFFSET,
              CURVE_MEANDER_BASE_MIN_OFFSET,
              meanderOffset,
            )
          }
        } else {
          activeTurnTarget =
            angleDistance(currentHeadingAngle, sideTarget) <= angleDistance(currentHeadingAngle, verticalTarget)
              ? sideTarget
              : verticalTarget
          sideStableSegments = 0
          meanderTargetOffset = 0
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
    if (turnsEnabled && isSegmentNearOlderRoad(currentPoint, endPoint, next)) {
      let resolved = false
      const recoveryTarget = activeTurnTarget ?? nearestVerticalTarget(currentHeadingAngle)

      for (let attempt = 0; attempt < 6; attempt += 1) {
        const centerPull = normalizeAngle(recoveryTarget - currentHeadingAngle) * 0.22
        const spread = TURN_MAX_STEP_PER_SEGMENT * (1 + attempt * 0.32)
        const candidateHeadingAngle = clampHeadingAngle(
          currentHeadingAngle + centerPull + randomBetween(-spread, spread),
        )

        const candidateEnd = movePointAlongHeading(currentPoint, segmentLength, candidateHeadingAngle)
        if (!isSegmentNearOlderRoad(currentPoint, candidateEnd, next)) {
          currentHeadingAngle = candidateHeadingAngle
          endPoint = candidateEnd
          resolved = true
          break
        }
      }

      if (!resolved) {
        const fallbackBaseHeading = clampHeadingAngle(
          stepTowardAngle(currentHeadingAngle, recoveryTarget, TURN_MAX_STEP_PER_SEGMENT * 1.2),
        )
        const fallbackLengthScales = [0.94, 0.82, 0.7, 0.58]
        const emergencyMinDistance = ROAD_SELF_AVOID_DISTANCE * 0.96
        let bestCandidate:
          | {
              headingAngle: number
              endPoint: Point
              clearance: number
            }
          | null = null

        for (const scale of fallbackLengthScales) {
          const fallbackLength = Math.max(SEGMENT_MIN_LENGTH * 0.58, segmentLength * scale)
          for (let attempt = 0; attempt < 14; attempt += 1) {
            const spread = TURN_MAX_STEP_PER_SEGMENT * (1 + attempt * 0.22)
            const candidateHeadingAngle = clampHeadingAngle(
              fallbackBaseHeading + randomBetween(-spread, spread),
            )
            const candidateEnd = movePointAlongHeading(currentPoint, fallbackLength, candidateHeadingAngle)
            const candidateClearance = measureSegmentClearanceToOlderRoad(currentPoint, candidateEnd, next)

            if (bestCandidate === null || candidateClearance > bestCandidate.clearance) {
              bestCandidate = {
                headingAngle: candidateHeadingAngle,
                endPoint: candidateEnd,
                clearance: candidateClearance,
              }
            }

            if (candidateClearance >= emergencyMinDistance) {
              currentHeadingAngle = candidateHeadingAngle
              endPoint = candidateEnd
              resolved = true
              break
            }
          }

          if (resolved) {
            break
          }
        }

        if (!resolved && bestCandidate !== null && bestCandidate.clearance >= ROAD_SELF_AVOID_DISTANCE * 0.82) {
          currentHeadingAngle = bestCandidate.headingAngle
          endPoint = bestCandidate.endPoint
          resolved = true
        }
      }

      if (!resolved) {
        // 최후 단계에서는 짧은 세그먼트 후보 중 여유거리가 가장 큰 경로를 택한다.
        const forcedLength = SEGMENT_MIN_LENGTH * 0.42
        let bestForcedCandidate:
          | {
              headingAngle: number
              endPoint: Point
              clearance: number
            }
          | null = null

        for (let attempt = 0; attempt < 18; attempt += 1) {
          const spread = TURN_MAX_STEP_PER_SEGMENT * (1.05 + attempt * 0.25)
          const candidateHeadingAngle = clampHeadingAngle(
            recoveryTarget + randomBetween(-spread, spread),
          )
          const candidateEnd = movePointAlongHeading(currentPoint, forcedLength, candidateHeadingAngle)
          const candidateClearance = measureSegmentClearanceToOlderRoad(currentPoint, candidateEnd, next)
          if (bestForcedCandidate === null || candidateClearance > bestForcedCandidate.clearance) {
            bestForcedCandidate = {
              headingAngle: candidateHeadingAngle,
              endPoint: candidateEnd,
              clearance: candidateClearance,
            }
          }
        }

        if (bestForcedCandidate !== null) {
          currentHeadingAngle = bestForcedCandidate.headingAngle
          endPoint = bestForcedCandidate.endPoint
        }
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

    const joinDistanceFromCenter = distanceBetweenPoints(center, joinPoint)
    const maxJoinDistance = edgeOffset * WALL_JOIN_MITER_LIMIT
    if (!Number.isFinite(joinDistanceFromCenter) || joinDistanceFromCenter > maxJoinDistance) {
      // 급커브 스파이크 방지: 과도하게 튀는 join은 평균점으로 대체
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
  const leftAnchors = toAnchorsFromPolyline(leftNodes, 'left')
  const rightAnchors = toAnchorsFromPolyline(rightNodes, 'right')
  return [...leftAnchors, ...rightAnchors]
}

function trimRoadAroundFocus(
  roadSegments: RoadSegment[],
  focusSegmentIndex: number,
): { roadSegments: RoadSegment[]; focusSegmentIndex: number } {
  if (roadSegments.length <= ROAD_TRIM_TRIGGER_SEGMENTS) {
    return { roadSegments, focusSegmentIndex }
  }

  const safeFocusIndex = Math.max(0, Math.min(roadSegments.length - 1, focusSegmentIndex))
  const trimStart = Math.max(0, safeFocusIndex - ROAD_KEEP_BEHIND_SEGMENTS)
  const trimEnd = Math.min(roadSegments.length, safeFocusIndex + ROAD_KEEP_AHEAD_SEGMENTS + 1)

  if (trimStart === 0 && trimEnd === roadSegments.length) {
    return { roadSegments, focusSegmentIndex: safeFocusIndex }
  }

  return {
    roadSegments: roadSegments.slice(trimStart, trimEnd),
    focusSegmentIndex: safeFocusIndex - trimStart,
  }
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

function RunRunGame({ onFinish, onExit }: MiniGameSessionProps) {
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>(() => createInitialRoad())
  const [startRoadPoint] = useState<Point>(() => roadSegments[0]?.start ?? { x: 0, y: 0 })
  const [player, setPlayer] = useState<Point>(() => ({ x: 0, y: 1 }))
  const [cameraAnchor, setCameraAnchor] = useState<Point>(() => ({ x: 0, y: 1 }))
  const [elapsedMs, setElapsedMs] = useState(0)
  const [score, setScore] = useState(0)
  const [isPaused, setIsPaused] = useState(false)
  const [items, setItems] = useState<RunRunItem[]>([])
  const [itemPopups, setItemPopups] = useState<ItemPopup[]>([])
  const [moveDirection, setMoveDirectionState] = useState<MoveDirection>('right')

  const roadHistoryRef = useRef<RoadSegment[]>(roadSegments)
  const playerRef = useRef<Point>(player)
  const cameraAnchorRef = useRef<Point>(cameraAnchor)
  const directionRef = useRef<MoveDirection>('right')
  const segmentIndexRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const travelDistanceRef = useRef(0)
  const bonusScoreRef = useRef(0)
  const itemsRef = useRef<RunRunItem[]>([])
  const itemPopupsRef = useRef<ItemPopup[]>([])
  const itemSpawnDistanceRef = useRef(ITEM_SPAWN_MIN_GAP)
  const itemIdRef = useRef(0)
  const popupIdRef = useRef(0)
  const pausedRef = useRef(false)
  const finishedRef = useRef(false)

  const playerScreenPoint = useMemo(() => worldToScreen(player, cameraAnchor), [player, cameraAnchor])
  const startCarScreenPoint = useMemo(() => worldToScreen(startRoadPoint, cameraAnchor), [cameraAnchor, startRoadPoint])
  const startCarX = useMemo(() => startCarScreenPoint.x - START_CAR_SPRITE_WIDTH / 2, [startCarScreenPoint.x])
  const startCarY = useMemo(
    () => startCarScreenPoint.y - START_CAR_SPRITE_HEIGHT / 2 + START_CAR_VERTICAL_OFFSET,
    [startCarScreenPoint.y],
  )

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
        const inwardBias = (WALL_CHARACTER_HEIGHT * character.inwardBiasPx) / character.pixelHeight
        const spriteX =
          edgePoint.side === 'left'
            ? screenPoint.x - spriteWidth + WALL_INNER_EDGE_OFFSET + inwardBias
            : screenPoint.x - WALL_INNER_EDGE_OFFSET - inwardBias

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

  const itemSprites = useMemo<ItemSprite[]>(() => {
    return items
      .map((item) => {
        const definition = ITEM_DEFINITIONS[item.kind]
        const screenPoint = worldToScreen(item.point, cameraAnchor)
        if (screenPoint.y < -ITEM_DESPAWN_MARGIN || screenPoint.y > VIEWBOX_HEIGHT + ITEM_DESPAWN_MARGIN) {
          return null
        }

        const itemIdNumber = Number.parseInt(item.id.split('-').at(-1) ?? '0', 10)
        const itemSeed = Number.isNaN(itemIdNumber) ? 0 : itemIdNumber

        return {
          id: item.id,
          href: definition.src,
          x: screenPoint.x - definition.spriteWidth / 2,
          y: screenPoint.y - definition.spriteHeight / 2,
          width: definition.spriteWidth,
          height: definition.spriteHeight,
          swayDelaySeconds: -((itemSeed % 11) * ITEM_SWAY_DELAY_STEP_SECONDS),
          swayDurationSeconds: ITEM_SWAY_DURATION_MIN_SECONDS + (itemSeed % 5) * ITEM_SWAY_DURATION_STEP_SECONDS,
        }
      })
      .filter((sprite): sprite is ItemSprite => sprite !== null)
  }, [cameraAnchor, items])

  const popupSprites = useMemo(() => {
    return itemPopups
      .map((popup) => {
        const ageMs = elapsedMs - popup.bornAtMs
        if (ageMs < 0 || ageMs > ITEM_POPUP_DURATION_MS) {
          return null
        }

        const progress = ageMs / ITEM_POPUP_DURATION_MS
        const screenPoint = worldToScreen(popup.point, cameraAnchor)
        return {
          id: popup.id,
          value: popup.value,
          x: screenPoint.x,
          y: screenPoint.y - 19 - progress * 16,
          opacity: clampNumber(1 - progress, 0, 1),
          scale: 1 + progress * 0.16,
        }
      })
      .filter((popup): popup is { id: string; value: number; x: number; y: number; opacity: number; scale: number } => popup !== null)
  }, [cameraAnchor, elapsedMs, itemPopups])

  const appendItemsFromRoad = useCallback((sourceRoad: RoadSegment[], startIndex: number) => {
    const spawnStartIndex = Math.max(startIndex, ITEM_START_SPAWN_SKIP_SEGMENTS)
    if (spawnStartIndex >= sourceRoad.length) {
      return
    }

    const spawnedItems: RunRunItem[] = []
    let distanceSinceLastSpawn = itemSpawnDistanceRef.current

    for (let index = spawnStartIndex; index < sourceRoad.length; index += 1) {
      const segment = sourceRoad[index]
      const segmentLength = distanceBetweenPoints(segment.start, segment.end)
      if (segmentLength <= 0.0001) {
        continue
      }

      distanceSinceLastSpawn += segmentLength
      if (distanceSinceLastSpawn < ITEM_SPAWN_MIN_GAP) {
        continue
      }

      if (Math.random() > ITEM_SPAWN_CHANCE_PER_SEGMENT) {
        continue
      }

      const anchorT = randomBetween(0.2, 0.82)
      const segmentPoint = toPointAlongSegment(segment, anchorT)
      const tangent = toUnitTangentFromSegment(segment)
      const normal = { x: -tangent.y, y: tangent.x }
      const sideOffsetLimit = ROAD_HALF_WIDTH * ITEM_SPAWN_SIDE_OFFSET_RATIO
      const sideOffset = randomBetween(-sideOffsetLimit, sideOffsetLimit)
      const itemPoint = {
        x: segmentPoint.x + normal.x * sideOffset,
        y: segmentPoint.y + normal.y * sideOffset,
      }

      if (distanceBetweenPoints(itemPoint, playerRef.current) < ROAD_HALF_WIDTH * 1.28) {
        continue
      }

      const isOverlappingExistingItem =
        itemsRef.current.some((existingItem) => distanceBetweenPoints(existingItem.point, itemPoint) < ITEM_MIN_SPAWN_DISTANCE) ||
        spawnedItems.some((spawnedItem) => distanceBetweenPoints(spawnedItem.point, itemPoint) < ITEM_MIN_SPAWN_DISTANCE)
      if (isOverlappingExistingItem) {
        continue
      }

      const kind = sampleItemKind()
      const definition = ITEM_DEFINITIONS[kind]
      itemIdRef.current += 1
      spawnedItems.push({
        id: `run-run-item-${itemIdRef.current}`,
        kind,
        point: itemPoint,
        value: definition.value,
      })
      distanceSinceLastSpawn = 0
    }

    itemSpawnDistanceRef.current = Math.min(distanceSinceLastSpawn, ITEM_SPAWN_MIN_GAP * 3)
    if (spawnedItems.length === 0) {
      return
    }

    const nextItems = [...itemsRef.current, ...spawnedItems]
    itemsRef.current = nextItems
    setItems(nextItems)
  }, [])

  useEffect(() => {
    appendItemsFromRoad(roadHistoryRef.current, ITEM_START_SPAWN_SKIP_SEGMENTS)
  }, [appendItemsFromRoad])

  const finishRound = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    finishedRef.current = true
    const finalDurationMs = elapsedMsRef.current > 0 ? elapsedMsRef.current : TICK_MS
    const finalScore = toScore(travelDistanceRef.current) + bonusScoreRef.current
    onFinish({
      score: finalScore,
      durationMs: finalDurationMs,
    })
  }, [onFinish])

  const togglePause = useCallback(() => {
    if (finishedRef.current) {
      return
    }

    if (pausedRef.current) {
      pausedRef.current = false
      setIsPaused(false)
      return
    }

    pausedRef.current = true
    setIsPaused(true)
  }, [])

  const setMoveDirection = useCallback(
    (nextDirection: MoveDirection) => {
      if (finishedRef.current || pausedRef.current) {
        return
      }

      directionRef.current = nextDirection
      setMoveDirectionState(nextDirection)
    },
    [],
  )

  useEffect(() => {
    pausedRef.current = isPaused
  }, [isPaused])

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
      if (event.pointerType === 'mouse') {
        if (event.button !== 0) {
          return
        }
        toggleMoveDirection()
        return
      }
      setMoveDirectionFromClientX(event.clientX, event.currentTarget)
    },
    [setMoveDirectionFromClientX, toggleMoveDirection],
  )

  const handleBoardPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') {
        return
      }

      if (event.buttons === 0) {
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
        return
      }

      if (event.code === 'KeyP') {
        event.preventDefault()
        togglePause()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [setMoveDirection, toggleMoveDirection, togglePause])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (finishedRef.current) {
        window.clearInterval(timer)
        return
      }

      if (pausedRef.current) {
        return
      }

      elapsedMsRef.current += TICK_MS
      setElapsedMs(elapsedMsRef.current)

      const elapsedSeconds = elapsedMsRef.current / 1000
      const currentSpeed = resolveSpeedAtElapsedSeconds(elapsedSeconds)

      const movedDistance = currentSpeed * (TICK_MS / 1000)
      travelDistanceRef.current += movedDistance

      const headingContext = resolveHeadingAtPoint(playerRef.current, roadHistoryRef.current, segmentIndexRef.current)
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

      let nextRoadHistory = roadHistoryRef.current
      const previousRoadLength = nextRoadHistory.length
      const tailPoint = nextRoadHistory[nextRoadHistory.length - 1]?.end
      if (tailPoint === undefined || distanceBetweenPoints(tailPoint, movedPlayer) < LOOKAHEAD_DISTANCE) {
        nextRoadHistory = extendRoad(nextRoadHistory, EXTEND_SEGMENTS, true)
      }

      if (nextRoadHistory.length > previousRoadLength) {
        appendItemsFromRoad(nextRoadHistory, previousRoadLength)
      }

      const postMoveHeadingContext = resolveHeadingAtPoint(movedPlayer, nextRoadHistory, segmentIndexRef.current)
      segmentIndexRef.current = postMoveHeadingContext.segmentIndex
      roadHistoryRef.current = nextRoadHistory

      const trimmedRoadContext = trimRoadAroundFocus(nextRoadHistory, postMoveHeadingContext.segmentIndex)
      const nextRoad = trimmedRoadContext.roadSegments
      setRoadSegments(nextRoad)

      const nextItems: RunRunItem[] = []
      let itemListChanged = false
      let collectedBonus = 0
      const createdPopups: ItemPopup[] = []

      for (const item of itemsRef.current) {
        const isCollected = distanceBetweenPoints(item.point, movedPlayer) <= ITEM_COLLISION_RADIUS
        if (isCollected) {
          collectedBonus += item.value
          itemListChanged = true
          popupIdRef.current += 1
          createdPopups.push({
            id: `run-run-popup-${popupIdRef.current}`,
            value: item.value,
            point: { x: movedPlayer.x, y: movedPlayer.y },
            bornAtMs: elapsedMsRef.current,
          })
          continue
        }

        const itemScreenPoint = worldToScreen(item.point, nextCameraAnchor)
        if (itemScreenPoint.y > VIEWBOX_HEIGHT + ITEM_DESPAWN_MARGIN) {
          itemListChanged = true
          continue
        }

        nextItems.push(item)
      }

      if (itemListChanged) {
        itemsRef.current = nextItems
        setItems(nextItems)
      }

      let popupListChanged = false
      let nextPopups = itemPopupsRef.current
      if (createdPopups.length > 0) {
        nextPopups = [...nextPopups, ...createdPopups]
        popupListChanged = true
      }

      const filteredPopups = nextPopups.filter((popup) => elapsedMsRef.current - popup.bornAtMs <= ITEM_POPUP_DURATION_MS)
      if (filteredPopups.length !== nextPopups.length) {
        popupListChanged = true
      }
      if (popupListChanged) {
        itemPopupsRef.current = filteredPopups
        setItemPopups(filteredPopups)
      }

      const isSafe = isPointInsideRoad(movedPlayer, nextRoadHistory)
      if (collectedBonus > 0) {
        bonusScoreRef.current += collectedBonus
      }
      setScore(toScore(travelDistanceRef.current) + bonusScoreRef.current)

      if (!isSafe) {
        finishRound()
      }
    }, TICK_MS)

    return () => {
      window.clearInterval(timer)
    }
  }, [appendItemsFromRoad, finishRound])

  const groundPatternOffset = useMemo(() => {
    const wrapOffset = (value: number): number =>
      ((value % GROUND_TILE_SIZE_VIEWBOX) + GROUND_TILE_SIZE_VIEWBOX) % GROUND_TILE_SIZE_VIEWBOX
    return {
      x: wrapOffset(VIEWBOX_WIDTH / 2 - cameraAnchor.x * WORLD_SCALE),
      y: wrapOffset(CAMERA_FOLLOW_Y + cameraAnchor.y * WORLD_SCALE),
    }
  }, [cameraAnchor.x, cameraAnchor.y])

  return (
    <section className="mini-game-panel run-run-panel" aria-label="run-run-game">
      <div
        className={`zigzag-board run-run-board${isPaused ? ' paused' : ''}`}
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
          <defs>
            <pattern
              id={GROUND_PATTERN_ID}
              patternUnits="userSpaceOnUse"
              x={groundPatternOffset.x}
              y={groundPatternOffset.y}
              width={GROUND_TILE_SIZE_VIEWBOX}
              height={GROUND_TILE_SIZE_VIEWBOX}
            >
              <image
                href={runRunTile01}
                x={0}
                y={0}
                width={GROUND_TILE_SIZE_VIEWBOX}
                height={GROUND_TILE_SIZE_VIEWBOX}
                preserveAspectRatio="none"
              />
            </pattern>
          </defs>

          <rect className="zigzag-ground-base" x={0} y={0} width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} />
          <rect
            className="zigzag-ground-pattern"
            x={0}
            y={0}
            width={VIEWBOX_WIDTH}
            height={VIEWBOX_HEIGHT}
            fill={`url(#${GROUND_PATTERN_ID})`}
          />

          <image
            className="zigzag-start-car-sprite"
            href={runRunCar}
            x={startCarX}
            y={startCarY}
            width={START_CAR_SPRITE_WIDTH}
            height={START_CAR_SPRITE_HEIGHT}
            preserveAspectRatio="xMidYMid meet"
          />

          {itemSprites.map((item) => (
            <image
              key={item.id}
              className="zigzag-item-sprite"
              href={item.href}
              x={item.x}
              y={item.y}
              width={item.width}
              height={item.height}
              style={
                {
                  '--item-sway-delay': `${item.swayDelaySeconds.toFixed(2)}s`,
                  '--item-sway-duration': `${item.swayDurationSeconds.toFixed(2)}s`,
                } as ReactCSSProperties
              }
              preserveAspectRatio="xMidYMid meet"
            />
          ))}

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

          {popupSprites.map((popup) => (
            <text
              key={popup.id}
              className={`zigzag-item-popup ${popupBonusClassName(popup.value)}`}
              x={0}
              y={0}
              transform={`translate(${popup.x.toFixed(2)} ${popup.y.toFixed(2)}) scale(${popup.scale.toFixed(3)})`}
              textAnchor="middle"
              style={{ opacity: popup.opacity }}
            >
              +{popup.value}
            </text>
          ))}
        </svg>

        <div className="run-run-hud" aria-label="현재 점수">
          <div className="run-run-score-frame">
            <span className="run-run-score-chip" aria-hidden="true">
              ★
            </span>
            <span className="run-run-score-title">SCORE</span>
            <p className="run-run-score-value">{score}</p>
          </div>
        </div>

        <div className="run-run-overlay-actions">
          <button
            className="run-run-action-button"
            type="button"
            aria-label={isPaused ? '재개' : '일시정지'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={togglePause}
          >
            <span className="run-run-action-icon" aria-hidden="true">
              {isPaused ? '▶' : 'Ⅱ'}
            </span>
          </button>
          <button
            className="run-run-action-button ghost"
            type="button"
            aria-label="홈"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExit}
          >
            <span className="run-run-action-icon" aria-hidden="true">
              ⌂
            </span>
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
