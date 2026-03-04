import type { ComponentType } from 'react'
import type { MiniGameManifest, MiniGameResult } from '../primitives/types'

export interface MiniGameSessionProps {
  readonly onFinish: (result: MiniGameResult) => void
  readonly onExit: () => void
}

export interface MiniGameModule {
  readonly manifest: MiniGameManifest
  readonly Component: ComponentType<MiniGameSessionProps>
}
