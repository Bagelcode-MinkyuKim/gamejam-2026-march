// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cannonShotModule } from './module'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeAudio {
  static instances: FakeAudio[] = []

  preload = ''
  loop = false
  volume = 1
  currentTime = 0
  playbackRate = 1
  paused = true

  constructor(readonly src = '') {
    FakeAudio.instances.push(this)
  }

  play = vi.fn(async () => {
    this.paused = false
  })

  pause = vi.fn(() => {
    this.paused = true
  })
}

describe('cannon-shot module', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    FakeAudio.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio)
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      return window.setTimeout(() => cb(performance.now()), 16) as unknown as number
    }) as typeof requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', ((id: number) => {
      window.clearTimeout(id)
    }) as typeof cancelAnimationFrame)
    if (typeof window.PointerEvent === 'undefined') {
      vi.stubGlobal('PointerEvent', MouseEvent as unknown as typeof PointerEvent)
    }

    container = document.createElement('div')
    container.style.width = '360px'
    container.style.height = '640px'
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders without a hub button and fires a shot from the hold-release button', async () => {
    await act(async () => {
      root.render(createElement(cannonShotModule.Component, {
        onFinish: vi.fn(),
        onExit: vi.fn(),
        bestScore: 321,
      }))
    })

    expect(container.querySelector('.cannon-shot-score')).not.toBeNull()
    expect(container.textContent).toContain('BEST 321')
    expect(container.textContent).not.toContain('Hub')

    const fireButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('FIRE'),
    )
    expect(fireButton).toBeTruthy()

    act(() => {
      fireButton?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    await act(async () => {
      vi.advanceTimersByTime(80)
    })

    expect(container.textContent).toContain('FLYING...')
    expect(container.textContent).toContain('14 LEFT')
    expect(FakeAudio.instances.some((audio) => audio.loop)).toBe(true)
    expect(FakeAudio.instances.some((audio) => audio.play.mock.calls.length > 0)).toBe(true)
  })
})
