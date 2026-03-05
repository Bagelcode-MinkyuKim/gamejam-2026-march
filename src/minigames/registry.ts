import type { MiniGameId, MiniGameManifest } from '../primitives/types'
import type { MiniGameModule } from './contracts'
import { tapDashModule } from './tap-dash/module'
import { timingShotModule } from './timing-shot/module'
import { laneDodgeModule } from './lane-dodge/module'
import { runRunModule } from './run-run/module'
import { sameCharacterModule } from './same-character/module'
import { gogunbuntuModule } from './gogunbuntu/module'
import { comboFormulaModule } from './combo-formula/module'

export const miniGameModules: MiniGameModule[] = [
  tapDashModule,
  gogunbuntuModule,
  sameCharacterModule,
  comboFormulaModule,
  runRunModule,
  timingShotModule,
  laneDodgeModule,
]

export const miniGameManifests: MiniGameManifest[] = miniGameModules.map((module) => module.manifest)

export const miniGameModuleById: Record<MiniGameId, MiniGameModule> = {
  'tap-dash': tapDashModule,
  'timing-shot': timingShotModule,
  'lane-dodge': laneDodgeModule,
  'run-run': runRunModule,
  'same-character': sameCharacterModule,
  'gogunbuntu': gogunbuntuModule,
  'combo-formula': comboFormulaModule,
}
