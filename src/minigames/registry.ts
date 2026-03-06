import type { MiniGameId, MiniGameManifest } from '../primitives/types'
import type { MiniGameModule } from './contracts'
import { tapDashModule } from './tap-dash/module'
import { runRunModule } from './run-run/module'
import { sameCharacterModule } from './same-character/module'
import { gogunbuntuModule } from './gogunbuntu/module'
import { comboFormulaModule } from './combo-formula/module'
import { chamChamChamModule } from './cham-cham-cham/module'
import { intenseCheerModule } from './intense-cheer/module'
import { fierceCheerModule } from './fierce-cheer/module'
import { speedTapModule } from './speed-tap/module'
import { colorMatchModule } from './color-match/module'
import { rhythmTapModule } from './rhythm-tap/module'
import { bubblePopModule } from './bubble-pop/module'
import { starCatchModule } from './star-catch/module'
import { memoryFlipModule } from './memory-flip/module'
import { numberSortModule } from './number-sort/module'
import { patternLockModule } from './pattern-lock/module'
import { colorFloodModule } from './color-flood/module'
import { slidePuzzleModule } from './slide-puzzle/module'
import { quickDrawModule } from './quick-draw/module'
import { simonSaysModule } from './simon-says/module'
import { reactionTestModule } from './reaction-test/module'
import { speedSortModule } from './speed-sort/module'
import { lightSpeedModule } from './light-speed/module'
import { snakeClassicModule } from './snake-classic/module'
import { breakoutMiniModule } from './breakout-mini/module'
import { pongSoloModule } from './pong-solo/module'
import { flappySingerModule } from './flappy-singer/module'
import { spaceDodgeModule } from './space-dodge/module'
import { mathBlitzModule } from './math-blitz/module'
import { ticTacProModule } from './tic-tac-pro/module'
import { mineSweepMiniModule } from './mine-sweep-mini/module'
import { connectFourModule } from './connect-four/module'
import { rockScissorsModule } from './rock-scissors/module'
import { stackTowerModule } from './stack-tower/module'
import { gravityFlipModule } from './gravity-flip/module'
import { cannonShotModule } from './cannon-shot/module'
import { ballBounceMiniModule } from './ball-bounce-mini/module'
import { ropeSwingModule } from './rope-swing/module'
import { wordChainModule } from './word-chain/module'
import { spotDiffModule } from './spot-diff/module'
import { mazeRunModule } from './maze-run/module'
import { sequenceMasterModule } from './sequence-master/module'
import { oddOneOutModule } from './odd-one-out/module'
import { musicMemoryModule } from './music-memory/module'
import { drumCircleModule } from './drum-circle/module'
import { danceStepModule } from './dance-step/module'
import { beatCatchModule } from './beat-catch/module'
import { karaokePitchModule } from './karaoke-pitch/module'
import { dodgeBallModule } from './dodge-ball/module'
import { lavaFloorModule } from './lava-floor/module'
import { iceSlideModule } from './ice-slide/module'
import { tornadoRunModule } from './tornado-run/module'
import { zombieRunModule } from './zombie-run/module'
import { treasureDigModule } from './treasure-dig/module'
import { cookingRushModule } from './cooking-rush/module'
import { paintMixModule } from './paint-mix/module'
import { cardFlipSpeedModule } from './card-flip-speed/module'
import { emojiMatchModule } from './emoji-match/module'
import { musicHarmonyModule } from './music-harmony/module'

export const miniGameModules: MiniGameModule[] = [
  tapDashModule,
  gogunbuntuModule,
  sameCharacterModule,
  comboFormulaModule,
  chamChamChamModule,
  runRunModule,
  intenseCheerModule,
  fierceCheerModule,
  speedTapModule,
  colorMatchModule,
  rhythmTapModule,
  bubblePopModule,
  starCatchModule,
  memoryFlipModule,
  numberSortModule,
  patternLockModule,
  colorFloodModule,
  slidePuzzleModule,
  quickDrawModule,
  simonSaysModule,
  reactionTestModule,
  speedSortModule,
  lightSpeedModule,
  snakeClassicModule,
  breakoutMiniModule,
  pongSoloModule,
  flappySingerModule,
  spaceDodgeModule,
  mathBlitzModule,
  ticTacProModule,
  mineSweepMiniModule,
  connectFourModule,
  rockScissorsModule,
  stackTowerModule,
  gravityFlipModule,
  cannonShotModule,
  ballBounceMiniModule,
  ropeSwingModule,
  wordChainModule,
  spotDiffModule,
  mazeRunModule,
  sequenceMasterModule,
  oddOneOutModule,
  musicMemoryModule,
  drumCircleModule,
  danceStepModule,
  beatCatchModule,
  karaokePitchModule,
  dodgeBallModule,
  lavaFloorModule,
  iceSlideModule,
  tornadoRunModule,
  zombieRunModule,
  treasureDigModule,
  cookingRushModule,
  paintMixModule,
  cardFlipSpeedModule,
  emojiMatchModule,
  musicHarmonyModule,
]

export const miniGameManifests: MiniGameManifest[] = miniGameModules.map((module) => module.manifest)

export const miniGameModuleById: Record<MiniGameId, MiniGameModule> = {
  'tap-dash': tapDashModule,
  'run-run': runRunModule,
  'same-character': sameCharacterModule,
  'gogunbuntu': gogunbuntuModule,
  'combo-formula': comboFormulaModule,
  'cham-cham-cham': chamChamChamModule,
  'intense-cheer': intenseCheerModule,
  'fierce-cheer': fierceCheerModule,
  'speed-tap': speedTapModule,
  'color-match': colorMatchModule,
  'rhythm-tap': rhythmTapModule,
  'bubble-pop': bubblePopModule,
  'star-catch': starCatchModule,
  'memory-flip': memoryFlipModule,
  'number-sort': numberSortModule,
  'pattern-lock': patternLockModule,
  'color-flood': colorFloodModule,
  'slide-puzzle': slidePuzzleModule,
  'quick-draw': quickDrawModule,
  'simon-says': simonSaysModule,
  'reaction-test': reactionTestModule,
  'speed-sort': speedSortModule,
  'light-speed': lightSpeedModule,
  'snake-classic': snakeClassicModule,
  'breakout-mini': breakoutMiniModule,
  'pong-solo': pongSoloModule,
  'flappy-singer': flappySingerModule,
  'space-dodge': spaceDodgeModule,
  'math-blitz': mathBlitzModule,
  'tic-tac-pro': ticTacProModule,
  'mine-sweep-mini': mineSweepMiniModule,
  'connect-four': connectFourModule,
  'rock-scissors': rockScissorsModule,
  'stack-tower': stackTowerModule,
  'gravity-flip': gravityFlipModule,
  'cannon-shot': cannonShotModule,
  'ball-bounce-mini': ballBounceMiniModule,
  'rope-swing': ropeSwingModule,
  'word-chain': wordChainModule,
  'spot-diff': spotDiffModule,
  'maze-run': mazeRunModule,
  'sequence-master': sequenceMasterModule,
  'odd-one-out': oddOneOutModule,
  'music-memory': musicMemoryModule,
  'drum-circle': drumCircleModule,
  'dance-step': danceStepModule,
  'beat-catch': beatCatchModule,
  'karaoke-pitch': karaokePitchModule,
  'dodge-ball': dodgeBallModule,
  'lava-floor': lavaFloorModule,
  'ice-slide': iceSlideModule,
  'tornado-run': tornadoRunModule,
  'zombie-run': zombieRunModule,
  'treasure-dig': treasureDigModule,
  'cooking-rush': cookingRushModule,
  'paint-mix': paintMixModule,
  'card-flip-speed': cardFlipSpeedModule,
  'emoji-match': emojiMatchModule,
  'music-harmony': musicHarmonyModule,
}
