export interface ResponsiveViewportMetricsInput {
  readonly containerWidth: number
  readonly containerHeight: number
  readonly baseWidth: number
  readonly baseHeight: number
}

export interface ResponsiveViewportMetrics {
  readonly scale: number
  readonly scaledWidth: number
  readonly scaledHeight: number
}

export function calculateResponsiveViewportMetrics({
  containerWidth,
  containerHeight,
  baseWidth,
  baseHeight,
}: ResponsiveViewportMetricsInput): ResponsiveViewportMetrics {
  assertPositiveFinite('containerWidth', containerWidth)
  assertPositiveFinite('containerHeight', containerHeight)
  assertPositiveFinite('baseWidth', baseWidth)
  assertPositiveFinite('baseHeight', baseHeight)

  const scale = Math.min(containerWidth / baseWidth, containerHeight / baseHeight)

  return {
    scale,
    scaledWidth: baseWidth * scale,
    scaledHeight: baseHeight * scale,
  }
}

function assertPositiveFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`)
  }
}
