import { useEffect, useRef, useState } from 'react'
import type { PropsWithChildren } from 'react'
import { MOBILE_VIEWPORT } from '../primitives/constants'
import { calculateResponsiveViewportMetrics } from './responsive-game-viewport-metrics'

export function ResponsiveGameViewport({ children }: PropsWithChildren) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [metrics, setMetrics] = useState(() =>
    calculateResponsiveViewportMetrics({
      containerWidth: window.innerWidth,
      containerHeight: window.innerHeight,
      baseWidth: MOBILE_VIEWPORT.width,
      baseHeight: MOBILE_VIEWPORT.height,
    }),
  )

  useEffect(() => {
    const shell = shellRef.current
    if (shell === null) {
      throw new Error('ResponsiveGameViewport shell element is missing.')
    }

    const measure = () => {
      const nextMetrics = calculateResponsiveViewportMetrics({
        containerWidth: shell.clientWidth,
        containerHeight: shell.clientHeight,
        baseWidth: MOBILE_VIEWPORT.width,
        baseHeight: MOBILE_VIEWPORT.height,
      })

      setMetrics((currentMetrics) => {
        if (
          currentMetrics.scale === nextMetrics.scale &&
          currentMetrics.scaledWidth === nextMetrics.scaledWidth &&
          currentMetrics.scaledHeight === nextMetrics.scaledHeight
        ) {
          return currentMetrics
        }

        return nextMetrics
      })
    }

    measure()

    const resizeObserver = new ResizeObserver(() => {
      measure()
    })

    resizeObserver.observe(shell)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <div ref={shellRef} className="responsive-game-viewport-shell">
      <div
        className="responsive-game-viewport-frame"
        style={{
          width: `${metrics.scaledWidth}px`,
          height: `${metrics.scaledHeight}px`,
        }}
      >
        <div
          className="responsive-game-viewport"
          style={{
            width: `${MOBILE_VIEWPORT.width}px`,
            height: `${MOBILE_VIEWPORT.height}px`,
            transform: `scale(${metrics.scale})`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
