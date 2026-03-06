import { describe, expect, it } from 'vitest'
import { calculateResponsiveViewportMetrics } from './responsive-game-viewport-metrics'

describe('calculateResponsiveViewportMetrics', () => {
  it('returns 1:1 metrics when the container matches the base viewport', () => {
    const metrics = calculateResponsiveViewportMetrics({
      containerWidth: 432,
      containerHeight: 768,
      baseWidth: 432,
      baseHeight: 768,
    })

    expect(metrics.scale).toBe(1)
    expect(metrics.scaledWidth).toBe(432)
    expect(metrics.scaledHeight).toBe(768)
  })

  it('fits to width when the container is relatively narrower than the base viewport', () => {
    const metrics = calculateResponsiveViewportMetrics({
      containerWidth: 500,
      containerHeight: 1000,
      baseWidth: 432,
      baseHeight: 768,
    })

    expect(metrics.scale).toBeCloseTo(500 / 432)
    expect(metrics.scaledWidth).toBeCloseTo(500)
    expect(metrics.scaledHeight).toBeCloseTo(768 * (500 / 432))
  })

  it('fits to height when the container is relatively shorter than the base viewport', () => {
    const metrics = calculateResponsiveViewportMetrics({
      containerWidth: 500,
      containerHeight: 700,
      baseWidth: 432,
      baseHeight: 768,
    })

    expect(metrics.scale).toBeCloseTo(700 / 768)
    expect(metrics.scaledWidth).toBeCloseTo(432 * (700 / 768))
    expect(metrics.scaledHeight).toBeCloseTo(700)
  })

  it('throws when any size is zero or negative', () => {
    expect(() =>
      calculateResponsiveViewportMetrics({
        containerWidth: 0,
        containerHeight: 700,
        baseWidth: 432,
        baseHeight: 768,
      }),
    ).toThrow('containerWidth must be a positive finite number.')
  })
})
