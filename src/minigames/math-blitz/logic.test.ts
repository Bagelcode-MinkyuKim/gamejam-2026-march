import { describe, expect, it } from 'vitest'
import {
  getMathBlitzDifficulty,
  getMathBlitzTier,
  makeMathBlitzProblem,
  MATH_BLITZ_SCORE_THRESHOLDS,
  solveMathBlitzExpression,
} from './logic'

function createSequenceRandom(values: readonly number[]): () => number {
  let index = 0
  return () => {
    const value = values[index]
    index += 1
    return value ?? 0.5
  }
}

describe('math blitz logic', () => {
  it('raises tiers as score crosses thresholds', () => {
    expect(getMathBlitzTier(0)).toBe(0)
    expect(getMathBlitzTier(MATH_BLITZ_SCORE_THRESHOLDS[1])).toBe(1)
    expect(getMathBlitzTier(MATH_BLITZ_SCORE_THRESHOLDS[2])).toBe(2)
    expect(getMathBlitzTier(MATH_BLITZ_SCORE_THRESHOLDS[3])).toBe(3)
    expect(getMathBlitzTier(MATH_BLITZ_SCORE_THRESHOLDS[4])).toBe(4)
  })

  it('ramps operator mix, choice count, and special chances with score', () => {
    const easy = getMathBlitzDifficulty(0)
    const hard = getMathBlitzDifficulty(900)

    expect(easy.choiceCount).toBe(4)
    expect(hard.choiceCount).toBe(6)
    expect(easy.operatorWeights.some((entry) => entry.operator === '÷')).toBe(false)
    expect(hard.operatorWeights.some((entry) => entry.operator === '÷')).toBe(true)
    expect(hard.allowNegativeSubtraction).toBe(true)
    expect(hard.bombChance).toBeGreaterThan(easy.bombChance)
    expect(hard.goldChance).toBeGreaterThan(easy.goldChance)
  })

  it('keeps early subtraction non-negative but allows negatives later', () => {
    const early = makeMathBlitzProblem({
      score: 0,
      solvedCount: 0,
      speedRoundLeft: 0,
      random: createSequenceRandom([0.8, 0, 0.99]),
    })
    const late = makeMathBlitzProblem({
      score: 900,
      solvedCount: 10,
      speedRoundLeft: 0,
      random: createSequenceRandom([0.15, 0, 0.99]),
    })

    expect(early.operator).toBe('-')
    expect(early.answer).toBeGreaterThanOrEqual(0)
    expect(late.operator).toBe('-')
    expect(late.answer).toBeLessThan(0)
  })

  it('builds integer division problems and gives speed rounds priority', () => {
    const division = makeMathBlitzProblem({
      score: 900,
      solvedCount: 20,
      speedRoundLeft: 0,
      random: createSequenceRandom([0.95, 0.2, 0.4]),
    })
    const speed = makeMathBlitzProblem({
      score: 900,
      solvedCount: 20,
      speedRoundLeft: 2,
      random: () => 0,
    })

    expect(division.operator).toBe('÷')
    expect(division.left % division.right).toBe(0)
    expect(division.answer).toBe(division.left / division.right)
    expect(division.choices).toContain(division.answer)
    expect(division.choices).toHaveLength(getMathBlitzDifficulty(900).choiceCount)
    expect(speed.type).toBe('speed')
  })

  it('fails fast on invalid input', () => {
    expect(() => getMathBlitzTier(-1)).toThrowError(/score/)
    expect(() => solveMathBlitzExpression(4, 0, '÷')).toThrowError(/division by zero/)
    expect(() => makeMathBlitzProblem({ score: 0, solvedCount: -1, speedRoundLeft: 0 })).toThrowError(/solvedCount/)
  })
})
