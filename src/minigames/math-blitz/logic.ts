export type MathBlitzOperator = '+' | '-' | 'x' | '÷'
export type MathBlitzProblemType = 'normal' | 'bomb' | 'gold' | 'speed'

export interface MathBlitzProblem {
  readonly left: number
  readonly right: number
  readonly operator: MathBlitzOperator
  readonly answer: number
  readonly choices: readonly number[]
  readonly type: MathBlitzProblemType
}

interface ValueRange {
  readonly min: number
  readonly max: number
}

interface WeightedOperator {
  readonly operator: MathBlitzOperator
  readonly weight: number
}

export interface MathBlitzDifficulty {
  readonly minScore: number
  readonly choiceCount: number
  readonly bombChance: number
  readonly goldChance: number
  readonly allowNegativeSubtraction: boolean
  readonly operatorWeights: readonly WeightedOperator[]
  readonly additionRange: ValueRange
  readonly subtractionRange: ValueRange
  readonly multiplicationLeftRange: ValueRange
  readonly multiplicationRightRange: ValueRange
  readonly divisionDivisorRange: ValueRange
  readonly divisionQuotientRange: ValueRange
  readonly wrongChoiceMinDelta: number
  readonly wrongChoiceSpreadRatio: number
  readonly wrongChoiceCloseBias: number
}

export interface MakeMathBlitzProblemInput {
  readonly score: number
  readonly solvedCount: number
  readonly speedRoundLeft: number
  readonly random?: () => number
}

export const MATH_BLITZ_SCORE_THRESHOLDS = [0, 60, 170, 320, 560] as const

export const MATH_BLITZ_DIFFICULTIES: readonly MathBlitzDifficulty[] = [
  {
    minScore: MATH_BLITZ_SCORE_THRESHOLDS[0],
    choiceCount: 4,
    bombChance: 0.04,
    goldChance: 0.06,
    allowNegativeSubtraction: false,
    operatorWeights: [
      { operator: '+', weight: 3 },
      { operator: '-', weight: 2 },
    ],
    additionRange: { min: 1, max: 12 },
    subtractionRange: { min: 1, max: 12 },
    multiplicationLeftRange: { min: 2, max: 5 },
    multiplicationRightRange: { min: 2, max: 6 },
    divisionDivisorRange: { min: 2, max: 4 },
    divisionQuotientRange: { min: 2, max: 6 },
    wrongChoiceMinDelta: 2,
    wrongChoiceSpreadRatio: 0.4,
    wrongChoiceCloseBias: 0.2,
  },
  {
    minScore: MATH_BLITZ_SCORE_THRESHOLDS[1],
    choiceCount: 4,
    bombChance: 0.06,
    goldChance: 0.08,
    allowNegativeSubtraction: false,
    operatorWeights: [
      { operator: '+', weight: 2 },
      { operator: '-', weight: 2 },
      { operator: 'x', weight: 1 },
    ],
    additionRange: { min: 5, max: 24 },
    subtractionRange: { min: 5, max: 24 },
    multiplicationLeftRange: { min: 2, max: 7 },
    multiplicationRightRange: { min: 2, max: 8 },
    divisionDivisorRange: { min: 2, max: 5 },
    divisionQuotientRange: { min: 2, max: 8 },
    wrongChoiceMinDelta: 2,
    wrongChoiceSpreadRatio: 0.28,
    wrongChoiceCloseBias: 0.3,
  },
  {
    minScore: MATH_BLITZ_SCORE_THRESHOLDS[2],
    choiceCount: 6,
    bombChance: 0.08,
    goldChance: 0.1,
    allowNegativeSubtraction: false,
    operatorWeights: [
      { operator: '+', weight: 1 },
      { operator: '-', weight: 2 },
      { operator: 'x', weight: 3 },
      { operator: '÷', weight: 1 },
    ],
    additionRange: { min: 10, max: 50 },
    subtractionRange: { min: 10, max: 50 },
    multiplicationLeftRange: { min: 3, max: 10 },
    multiplicationRightRange: { min: 3, max: 10 },
    divisionDivisorRange: { min: 2, max: 8 },
    divisionQuotientRange: { min: 2, max: 10 },
    wrongChoiceMinDelta: 1,
    wrongChoiceSpreadRatio: 0.2,
    wrongChoiceCloseBias: 0.45,
  },
  {
    minScore: MATH_BLITZ_SCORE_THRESHOLDS[3],
    choiceCount: 6,
    bombChance: 0.1,
    goldChance: 0.12,
    allowNegativeSubtraction: true,
    operatorWeights: [
      { operator: '+', weight: 1 },
      { operator: '-', weight: 2 },
      { operator: 'x', weight: 3 },
      { operator: '÷', weight: 2 },
    ],
    additionRange: { min: 15, max: 90 },
    subtractionRange: { min: 15, max: 90 },
    multiplicationLeftRange: { min: 4, max: 14 },
    multiplicationRightRange: { min: 3, max: 12 },
    divisionDivisorRange: { min: 3, max: 10 },
    divisionQuotientRange: { min: 3, max: 12 },
    wrongChoiceMinDelta: 1,
    wrongChoiceSpreadRatio: 0.15,
    wrongChoiceCloseBias: 0.6,
  },
  {
    minScore: MATH_BLITZ_SCORE_THRESHOLDS[4],
    choiceCount: 6,
    bombChance: 0.12,
    goldChance: 0.14,
    allowNegativeSubtraction: true,
    operatorWeights: [
      { operator: '+', weight: 1 },
      { operator: '-', weight: 1 },
      { operator: 'x', weight: 4 },
      { operator: '÷', weight: 3 },
    ],
    additionRange: { min: 25, max: 160 },
    subtractionRange: { min: 25, max: 160 },
    multiplicationLeftRange: { min: 6, max: 18 },
    multiplicationRightRange: { min: 4, max: 16 },
    divisionDivisorRange: { min: 4, max: 12 },
    divisionQuotientRange: { min: 4, max: 15 },
    wrongChoiceMinDelta: 1,
    wrongChoiceSpreadRatio: 0.12,
    wrongChoiceCloseBias: 0.75,
  },
] as const

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`)
  }
}

function assertWholeNonNegative(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
}

function randomIntInclusive(min: number, max: number, random: () => number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    throw new Error('random range must use integers with min <= max')
  }

  const value = random()
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error('random() must return a finite number in [0, 1)')
  }

  return Math.floor(value * (max - min + 1)) + min
}

function shuffleValues<T>(values: readonly T[], random: () => number): T[] {
  const next = [...values]
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIntInclusive(0, index, random)
    const current = next[index]
    next[index] = next[swapIndex]
    next[swapIndex] = current
  }
  return next
}

function pickWeightedOperator(weights: readonly WeightedOperator[], random: () => number): MathBlitzOperator {
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0)
  if (totalWeight <= 0) {
    throw new Error('operator weights must sum to a positive number')
  }

  const roll = random()
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error('random() must return a finite number in [0, 1)')
  }

  let cursor = roll * totalWeight
  for (const entry of weights) {
    if (cursor < entry.weight) return entry.operator
    cursor -= entry.weight
  }

  return weights[weights.length - 1]!.operator
}

function pickRangeValue(range: ValueRange, random: () => number): number {
  return randomIntInclusive(range.min, range.max, random)
}

function pickOperands(operator: MathBlitzOperator, difficulty: MathBlitzDifficulty, random: () => number): { left: number; right: number } {
  if (operator === '+') {
    return {
      left: pickRangeValue(difficulty.additionRange, random),
      right: pickRangeValue(difficulty.additionRange, random),
    }
  }

  if (operator === '-') {
    const left = pickRangeValue(difficulty.subtractionRange, random)
    const right = pickRangeValue(difficulty.subtractionRange, random)
    if (difficulty.allowNegativeSubtraction || left >= right) {
      return { left, right }
    }
    return { left: right, right: left }
  }

  if (operator === 'x') {
    return {
      left: pickRangeValue(difficulty.multiplicationLeftRange, random),
      right: pickRangeValue(difficulty.multiplicationRightRange, random),
    }
  }

  const right = pickRangeValue(difficulty.divisionDivisorRange, random)
  const quotient = pickRangeValue(difficulty.divisionQuotientRange, random)
  return { left: right * quotient, right }
}

function createWrongChoices(answer: number, count: number, difficulty: MathBlitzDifficulty, random: () => number): number[] {
  assertWholeNonNegative(count, 'count')
  if (!Number.isInteger(answer)) {
    throw new Error('answer must be an integer')
  }

  const choices = new Set<number>()
  const baseDelta = Math.max(
    difficulty.wrongChoiceMinDelta,
    Math.floor(Math.max(1, Math.abs(answer)) * difficulty.wrongChoiceSpreadRatio),
  )

  for (let attempts = 0; attempts < count * 120 && choices.size < count; attempts += 1) {
    const useCloseCall = random() < difficulty.wrongChoiceCloseBias
    const maxDelta = useCloseCall
      ? Math.max(difficulty.wrongChoiceMinDelta, Math.round(baseDelta * 0.8))
      : Math.max(difficulty.wrongChoiceMinDelta, Math.round(baseDelta * 2))
    const delta = randomIntInclusive(difficulty.wrongChoiceMinDelta, maxDelta, random)
    const sign = random() < 0.5 ? -1 : 1
    const candidate = answer + sign * delta
    if (candidate !== answer) choices.add(candidate)
  }

  let fallbackDelta = difficulty.wrongChoiceMinDelta
  while (choices.size < count) {
    const positive = answer + fallbackDelta
    if (positive !== answer) choices.add(positive)
    if (choices.size >= count) break
    const negative = answer - fallbackDelta
    if (negative !== answer) choices.add(negative)
    fallbackDelta += 1
  }

  return [...choices]
}

export function getMathBlitzTier(score: number): number {
  assertFiniteNonNegative(score, 'score')

  for (let index = MATH_BLITZ_DIFFICULTIES.length - 1; index >= 0; index -= 1) {
    if (score >= MATH_BLITZ_DIFFICULTIES[index]!.minScore) {
      return index
    }
  }

  throw new Error('failed to resolve Math Blitz tier')
}

export function getMathBlitzDifficulty(score: number): MathBlitzDifficulty {
  return MATH_BLITZ_DIFFICULTIES[getMathBlitzTier(score)]!
}

export function solveMathBlitzExpression(left: number, right: number, operator: MathBlitzOperator): number {
  if (!Number.isInteger(left) || !Number.isInteger(right)) {
    throw new Error('math operands must be integers')
  }

  if (operator === '+') return left + right
  if (operator === '-') return left - right
  if (operator === '÷') {
    if (right === 0) throw new Error('division by zero is not allowed')
    return left / right
  }
  return left * right
}

function pickProblemType(score: number, solvedCount: number, speedRoundLeft: number, random: () => number): MathBlitzProblemType {
  if (speedRoundLeft > 0) return 'speed'
  if (solvedCount <= 5) return 'normal'

  const difficulty = getMathBlitzDifficulty(score)
  const roll = random()
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error('random() must return a finite number in [0, 1)')
  }

  if (roll < difficulty.bombChance) return 'bomb'
  if (roll < difficulty.bombChance + difficulty.goldChance) return 'gold'
  return 'normal'
}

export function makeMathBlitzProblem(input: MakeMathBlitzProblemInput): MathBlitzProblem {
  assertFiniteNonNegative(input.score, 'score')
  assertWholeNonNegative(input.solvedCount, 'solvedCount')
  assertWholeNonNegative(input.speedRoundLeft, 'speedRoundLeft')

  const random = input.random ?? Math.random
  const difficulty = getMathBlitzDifficulty(input.score)
  const operator = pickWeightedOperator(difficulty.operatorWeights, random)
  const { left, right } = pickOperands(operator, difficulty, random)
  const answer = solveMathBlitzExpression(left, right, operator)
  if (!Number.isInteger(answer)) {
    throw new Error('Math Blitz problems must resolve to integer answers')
  }

  const choices = shuffleValues(
    [answer, ...createWrongChoices(answer, difficulty.choiceCount - 1, difficulty, random)],
    random,
  )

  return {
    left,
    right,
    operator,
    answer,
    choices,
    type: pickProblemType(input.score, input.solvedCount, input.speedRoundLeft, random),
  }
}
