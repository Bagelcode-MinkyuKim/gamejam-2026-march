import type { MiniGameId, MiniGameManifest } from '../primitives/types'
import type { MiniGameModule } from './contracts'
import { tapDashModule } from './tap-dash/module'
import { timingShotModule } from './timing-shot/module'
import { laneDodgeModule } from './lane-dodge/module'

export const miniGameModules: MiniGameModule[] = [tapDashModule, timingShotModule, laneDodgeModule]

export const miniGameManifests: MiniGameManifest[] = miniGameModules.map((module) => module.manifest)

export const miniGameModuleById: Record<MiniGameId, MiniGameModule> = {
  'tap-dash': tapDashModule,
  'timing-shot': timingShotModule,
  'lane-dodge': laneDodgeModule,
}
