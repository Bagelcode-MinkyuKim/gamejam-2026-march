import type { PlayerProgress } from '../../primitives/types'

export interface IProgressStore {
  load(): Promise<PlayerProgress | null>
  save(progress: PlayerProgress): Promise<void>
}
