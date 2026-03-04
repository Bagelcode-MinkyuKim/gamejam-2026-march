import type { MiniGameId, MiniGameManifest } from '../primitives/types'
import type { MiniGameModule } from './contracts'
import { tapDashModule } from './tap-dash/module'
import { timingShotModule } from './timing-shot/module'
import { laneDodgeModule } from './lane-dodge/module'
import { runRunModule } from './run-run/module'
import { sameCharacterModule } from './same-character/module'

export const miniGameModules: MiniGameModule[] = [
  tapDashModule,
  timingShotModule,
  laneDodgeModule,
  runRunModule,
  sameCharacterModule,
]

export const miniGameManifests: MiniGameManifest[] = miniGameModules.map((module) => module.manifest)

export const miniGameModuleById: Record<MiniGameId, MiniGameModule> = {
  'tap-dash': tapDashModule,
  'timing-shot': timingShotModule,
  'lane-dodge': laneDodgeModule,
  'run-run': runRunModule,
  'same-character': sameCharacterModule,
}
