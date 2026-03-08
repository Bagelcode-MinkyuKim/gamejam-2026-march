import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import { getAttendanceState, performCheckIn, resolveRewardsForDay, DEFAULT_ATTENDANCE_CONFIG } from './attendance-manager'
import type { CheckInReward } from './attendance-manager'
import attendanceCalendarImg from '../../assets/images/generated/attendance-calendar.png'
import attendanceCoinImg from '../../assets/images/generated/attendance-coin-reward.png'
import attendanceCheckImg from '../../assets/images/generated/attendance-check.png'
import attendanceBonusImg from '../../assets/images/generated/attendance-bonus.png'
import { GameHubUseCases } from '../application/game-hub-use-cases'
import { HUB_BOOTSTRAP_CONFIG, HUB_STORAGE_KEY } from '../primitives/constants'
import type { HubSnapshot, MiniGameId, MiniGameResult } from '../primitives/types'
import type { MiniGameModule } from '../minigames/contracts'
import { loadMiniGameModule, miniGameManifestById, miniGameManifests } from '../minigames/registry'
import { LocalStorageProgressStore } from '../infrastructure/local-storage-progress-store'
import { projectHubUi } from '../view-model/hub-ui-model'
import lobbyTapDashIcon from '../../assets/images/generated/lobby-icons/lobby-tap-dash.png'
import lobbyRunRunIcon from '../../assets/images/generated/lobby-icons/lobby-run-run.png'
import lobbySameCharacterIcon from '../../assets/images/generated/lobby-icons/lobby-same-character.png'
import lobbyGogunbuntuIcon from '../../assets/images/generated/lobby-icons/lobby-gogunbuntu.png'
import lobbyComboFormulaIcon from '../../assets/images/generated/lobby-icons/lobby-combo-formula.png'
import lobbyChamChamChamIcon from '../../assets/images/generated/lobby-icons/lobby-cham-cham-cham.png'
import lobbyIntenseCheerIcon from '../../assets/images/generated/lobby-icons/lobby-intense-cheer.png'
import lobbyFierceCheerIcon from '../../assets/images/generated/lobby-icons/lobby-fierce-cheer.png'
import lobbyStarCatchIcon from '../../assets/images/generated/lobby-icons/lobby-star-catch.png'
import lobbyNumberSortIcon from '../../assets/images/generated/lobby-icons/lobby-number-sort.png'
import lobbyRhythmTapIcon from '../../assets/images/generated/lobby-icons/lobby-rhythm-tap.png'
import lobbyPatternLockIcon from '../../assets/images/generated/lobby-icons/lobby-pattern-lock.png'
import lobbyConnectFourIcon from '../../assets/images/generated/lobby-icons/lobby-connect-four.png'
import lobbyMineSweepMiniIcon from '../../assets/images/generated/lobby-icons/lobby-mine-sweep-mini.png'
import lobbyRockScissorsIcon from '../../assets/images/generated/lobby-icons/lobby-rock-scissors.png'
import lobbyStackTowerIcon from '../../assets/images/generated/lobby-icons/lobby-stack-tower.png'
import lobbyBallBounceMiniIcon from '../../assets/images/generated/lobby-icons/lobby-ball-bounce-mini.png'
import lobbyCannonShotIcon from '../../assets/images/generated/lobby-icons/lobby-cannon-shot.png'
import lobbyBeatCatchIcon from '../../assets/images/generated/lobby-icons/lobby-beat-catch.png'
import lobbySpotDiffIcon from '../../assets/images/generated/lobby-icons/lobby-spot-diff.png'
import lobbyMazeRunIcon from '../../assets/images/generated/lobby-icons/lobby-maze-run.png'
import lobbyDrumCircleIcon from '../../assets/images/generated/lobby-icons/lobby-drum-circle.png'
import lobbyTreasureDigIcon from '../../assets/images/generated/lobby-icons/lobby-treasure-dig.png'
import lobbyIceSlideIcon from '../../assets/images/generated/lobby-icons/lobby-ice-slide.png'
import lobbySequenceMasterIcon from '../../assets/images/generated/lobby-icons/lobby-sequence-master.png'
import lobbyDanceStepIcon from '../../assets/images/generated/lobby-icons/lobby-dance-step.png'
import lobbyKaraokePitchIcon from '../../assets/images/generated/lobby-icons/lobby-karaoke-pitch.png'
import lobbyCardFlipSpeedIcon from '../../assets/images/generated/lobby-icons/lobby-card-flip-speed.png'
import lobbyPaintMixIcon from '../../assets/images/generated/lobby-icons/lobby-paint-mix.png'
import lobbyEmojiMatchIcon from '../../assets/images/generated/lobby-icons/lobby-emoji-match.png'
import lobbyTornadoRunIcon from '../../assets/images/generated/lobby-icons/lobby-tornado-run.png'
import lobbyDodgeBallIcon from '../../assets/images/generated/lobby-icons/lobby-dodge-ball.png'
import lobbyCookingRushIcon from '../../assets/images/generated/lobby-icons/lobby-cooking-rush.png'
import lobbySpeedTapIcon from '../../assets/images/generated/lobby-icons/lobby-speed-tap.png'
import lobbyColorMatchIcon from '../../assets/images/generated/lobby-icons/lobby-color-match.png'
import lobbyBubblePopIcon from '../../assets/images/generated/lobby-icons/lobby-bubble-pop.png'
import lobbyMemoryFlipIcon from '../../assets/images/generated/lobby-icons/lobby-memory-flip.png'
import lobbySpeedSortIcon from '../../assets/images/generated/lobby-icons/lobby-speed-sort.png'
import lobbyReactionTestIcon from '../../assets/images/generated/lobby-icons/lobby-reaction-test.png'
import lobbySnakeClassicIcon from '../../assets/images/generated/lobby-icons/lobby-snake-classic.png'
import lobbyBreakoutMiniIcon from '../../assets/images/generated/lobby-icons/lobby-breakout-mini.png'
import lobbySlidePuzzleIcon from '../../assets/images/generated/lobby-icons/lobby-slide-puzzle.png'
import lobbySimonSaysIcon from '../../assets/images/generated/lobby-icons/lobby-simon-says.png'
import lobbyQuickDrawIcon from '../../assets/images/generated/lobby-icons/lobby-quick-draw.png'
import lobbyPongSoloIcon from '../../assets/images/generated/lobby-icons/lobby-pong-solo.png'
import lobbyLightSpeedIcon from '../../assets/images/generated/lobby-icons/lobby-light-speed.png'
import lobbySpaceDodgeIcon from '../../assets/images/generated/lobby-icons/lobby-space-dodge.png'
import lobbyFlappySingerIcon from '../../assets/images/generated/lobby-icons/lobby-flappy-singer.png'
import lobbyColorFloodIcon from '../../assets/images/generated/lobby-icons/lobby-color-flood.png'
import lobbyLavaFloorIcon from '../../assets/images/generated/lobby-icons/lobby-lava-floor.png'
import lobbyWordChainIcon from '../../assets/images/generated/lobby-icons/lobby-word-chain.png'
import lobbyRopeSwingIcon from '../../assets/images/generated/lobby-icons/lobby-rope-swing.png'
import lobbyOddOneOutIcon from '../../assets/images/generated/lobby-icons/lobby-odd-one-out.png'
import lobbyZombieRunIcon from '../../assets/images/generated/lobby-icons/lobby-zombie-run.png'
import lobbyGravityFlipIcon from '../../assets/images/generated/lobby-icons/lobby-gravity-flip.png'
import lobbyMusicMemoryIcon from '../../assets/images/generated/lobby-icons/lobby-music-memory.png'
import lobbyTicTacProIcon from '../../assets/images/generated/lobby-icons/lobby-tic-tac-pro.png'
import lobbyMusicHarmonyIcon from '../../assets/images/generated/lobby-icons/lobby-music-harmony.png'
import lobbyMathBlitzIcon from '../../assets/images/generated/lobby-icons/lobby-math-blitz.png'
import kimYeonjaCastSprite from '../../assets/images/same-character/kim-yeonja.png'
import parkSangminCastSprite from '../../assets/images/same-character/park-sangmin.png'
import parkWankyuCastSprite from '../../assets/images/same-character/park-wankyu.png'
import seoTaijiCastSprite from '../../assets/images/same-character/seo-taiji.png'
import coinIconImg from '../../assets/images/generated/coin-icon.png'
import lockIconImg from '../../assets/images/generated/lock-icon.png'
import gameLogoImg from '../../assets/Title.png'
import {
  playOneShotAudio,
  playBackgroundAudio as smPlayBgm,
  stopBackgroundAudio as smStopBgm,
  getSoundSettings,
  updateSoundSettings,
  subscribeSoundSettings,
} from './sound-manager'
import lobbyBgm1 from '../../assets/sounds/lobby-bgm-1.mp3'
import lobbyBgm2 from '../../assets/sounds/lobby-bgm-2.mp3'
import lobbyBgm3 from '../../assets/sounds/lobby-bgm-3.mp3'
import lobbyBgm4 from '../../assets/sounds/lobby-bgm-4.mp3'
import lobbyBgm5 from '../../assets/sounds/lobby-bgm-5.mp3'

const LOBBY_BGM_TRACKS = [lobbyBgm1, lobbyBgm2, lobbyBgm3, lobbyBgm4, lobbyBgm5]
function pickRandomLobbyBgm(): string {
  return LOBBY_BGM_TRACKS[Math.floor(Math.random() * LOBBY_BGM_TRACKS.length)]
}
import gameplayBgmLoop from '../../assets/sounds/gameplay-bgm-loop.mp3'
import resultBgmLoop from '../../assets/sounds/result-bgm-loop.mp3'
import countdownTickSfx from '../../assets/sounds/countdown-tick.mp3'
import countdownStartSfx from '../../assets/sounds/countdown-start.mp3'
import gameOverHitSfx from '../../assets/sounds/game-over-hit.mp3'
import newRecordFanfareSfx from '../../assets/sounds/new-record-fanfare.mp3'
import resultCoinRollSfx from '../../assets/sounds/result-coin-roll.mp3'
import uiBtnClickSfx from '../../assets/sounds/ui/btn-click.mp3'
import uiCardSwipeSfx from '../../assets/sounds/ui/card-swipe.mp3'
import uiCoinCollectSfx from '../../assets/sounds/ui/coin-collect.mp3'
import uiTabSwitchSfx from '../../assets/sounds/ui/tab-switch.mp3'
import uiUnlockPopSfx from '../../assets/sounds/ui/unlock-pop.mp3'
import uiErrorBuzzSfx from '../../assets/sounds/ui/error-buzz.mp3'
import { STACK_TOWER_GAMEPLAY_BGM_VOLUME } from '../minigames/stack-tower/config'
import { ResponsiveGameViewport } from './responsive-game-viewport'

const DEFAULT_SELECTED_GAME_ID: MiniGameId = HUB_BOOTSTRAP_CONFIG.starterUnlockedGameIds[0]
const GAME_START_COUNTDOWN_LABELS = ['3', '2', '1', 'START!'] as const
const GAME_START_COUNTDOWN_STEP_MS = 1000
const GAME_OVER_OVERLAY_MS = 1100
const RESULT_ROLL_DURATION_MS = 1200
const IN_GAME_MODULE_BGM_IDS = new Set<MiniGameId>(['tap-dash', 'same-character', 'gogunbuntu', 'rope-swing', 'word-chain', 'ball-bounce-mini', 'drum-circle', 'connect-four', 'cannon-shot', 'flappy-singer'])
const IN_GAME_BGM_VOLUME_BY_GAME_ID: Partial<Record<MiniGameId, number>> = {
  'stack-tower': STACK_TOWER_GAMEPLAY_BGM_VOLUME,
}
const HIDDEN_GAME_DESCRIPTION_IDS = new Set<MiniGameId>(['stack-tower'])
const LIVE_FX_SPARKS = [
  { left: '8%', top: '18%', delay: '0s', duration: '2.6s' },
  { left: '16%', top: '46%', delay: '0.35s', duration: '3.1s' },
  { left: '24%', top: '74%', delay: '0.8s', duration: '2.8s' },
  { left: '78%', top: '22%', delay: '0.42s', duration: '3.2s' },
  { left: '88%', top: '40%', delay: '1s', duration: '2.7s' },
  { left: '84%', top: '70%', delay: '0.2s', duration: '3s' },
] as const
const LOBBY_PARTICLES = [
  { type: 'star', left: '6%', top: '15%', delay: '0s', dur: '5s' },
  { type: 'note', left: '88%', top: '12%', delay: '1.2s', dur: '6s' },
  { type: 'star', left: '14%', top: '38%', delay: '2.4s', dur: '5.5s' },
  { type: 'sparkle', left: '92%', top: '35%', delay: '0.6s', dur: '4.8s' },
  { type: 'note', left: '8%', top: '58%', delay: '3.1s', dur: '5.8s' },
  { type: 'star', left: '85%', top: '55%', delay: '1.8s', dur: '6.2s' },
  { type: 'sparkle', left: '18%', top: '75%', delay: '0.9s', dur: '5.2s' },
  { type: 'note', left: '78%', top: '78%', delay: '2.6s', dur: '5.6s' },
  { type: 'star', left: '50%', top: '8%', delay: '4s', dur: '6.5s' },
  { type: 'sparkle', left: '45%', top: '90%', delay: '1.5s', dur: '4.5s' },
] as const
const MARQUEE_ITEMS = [
  'Play mini-games to earn coins!',
  'Unlock new games with coins',
  'Beat your high score!',
  'Collect all games!',
  'Tap to start!',
] as const
const CUSTOM_LOBBY_ICONS: Partial<Record<MiniGameId, string>> = {
  'tap-dash': lobbyTapDashIcon,
  'same-character': lobbySameCharacterIcon,
  'run-run': lobbyRunRunIcon,
  'gogunbuntu': lobbyGogunbuntuIcon,
  'combo-formula': lobbyComboFormulaIcon,
  'cham-cham-cham': lobbyChamChamChamIcon,
  'intense-cheer': lobbyIntenseCheerIcon,
  'fierce-cheer': lobbyFierceCheerIcon,
  'star-catch': lobbyStarCatchIcon,
  'number-sort': lobbyNumberSortIcon,
  'rhythm-tap': lobbyRhythmTapIcon,
  'pattern-lock': lobbyPatternLockIcon,
  'connect-four': lobbyConnectFourIcon,
  'mine-sweep-mini': lobbyMineSweepMiniIcon,
  'rock-scissors': lobbyRockScissorsIcon,
  'stack-tower': lobbyStackTowerIcon,
  'ball-bounce-mini': lobbyBallBounceMiniIcon,
  'cannon-shot': lobbyCannonShotIcon,
  'drum-circle': lobbyDrumCircleIcon,
  'sequence-master': lobbySequenceMasterIcon,
  'maze-run': lobbyMazeRunIcon,
  'spot-diff': lobbySpotDiffIcon,
  'treasure-dig': lobbyTreasureDigIcon,
  'dance-step': lobbyDanceStepIcon,
  'beat-catch': lobbyBeatCatchIcon,
  'karaoke-pitch': lobbyKaraokePitchIcon,
  'card-flip-speed': lobbyCardFlipSpeedIcon,
  'ice-slide': lobbyIceSlideIcon,
  'paint-mix': lobbyPaintMixIcon,
  'emoji-match': lobbyEmojiMatchIcon,
  'cooking-rush': lobbyCookingRushIcon,
  'tornado-run': lobbyTornadoRunIcon,
  'dodge-ball': lobbyDodgeBallIcon,
  'speed-tap': lobbySpeedTapIcon,
  'color-match': lobbyColorMatchIcon,
  'bubble-pop': lobbyBubblePopIcon,
  'memory-flip': lobbyMemoryFlipIcon,
  'snake-classic': lobbySnakeClassicIcon,
  'breakout-mini': lobbyBreakoutMiniIcon,
  'slide-puzzle': lobbySlidePuzzleIcon,
  'simon-says': lobbySimonSaysIcon,
  'speed-sort': lobbySpeedSortIcon,
  'quick-draw': lobbyQuickDrawIcon,
  'pong-solo': lobbyPongSoloIcon,
  'light-speed': lobbyLightSpeedIcon,
  'space-dodge': lobbySpaceDodgeIcon,
  'flappy-singer': lobbyFlappySingerIcon,
  'color-flood': lobbyColorFloodIcon,
  'lava-floor': lobbyLavaFloorIcon,
  'word-chain': lobbyWordChainIcon,
  'rope-swing': lobbyRopeSwingIcon,
  'odd-one-out': lobbyOddOneOutIcon,
  'zombie-run': lobbyZombieRunIcon,
  'gravity-flip': lobbyGravityFlipIcon,
  'tic-tac-pro': lobbyTicTacProIcon,
  'music-harmony': lobbyMusicHarmonyIcon,
  'math-blitz': lobbyMathBlitzIcon,
  'music-memory': lobbyMusicMemoryIcon,
  'reaction-test': lobbyReactionTestIcon,
}
const FALLBACK_LOBBY_ICONS = [
  kimYeonjaCastSprite,
  parkSangminCastSprite,
  parkWankyuCastSprite,
  seoTaijiCastSprite,
] as const
function getLobbyIcon(gameId: MiniGameId): string {
  const custom = CUSTOM_LOBBY_ICONS[gameId]
  if (custom) return custom
  let hash = 0
  for (let i = 0; i < gameId.length; i++) hash = ((hash << 5) - hash + gameId.charCodeAt(i)) | 0
  return FALLBACK_LOBBY_ICONS[Math.abs(hash) % FALLBACK_LOBBY_ICONS.length]
}
const COUNTDOWN_GUIDE_BY_GAME_ID: Partial<Record<MiniGameId, string>> = {
  'tap-dash': 'Tap targets in a row and grab hearts for big time boosts!',
  'gogunbuntu': 'Jump to match height and swing through terrain!',
  'same-character': 'Match queue characters to the right lane for combos!',
  'combo-formula': 'Enter combos in order and press OK for multiplier fever!',
  'run-run': 'Time your left-right turns to stay on the course!',
  'cham-cham-cham': 'Attack: match direction. Defend: dodge fast. 3 HP!',
  'intense-cheer': 'Tap left/right to jump up! Dodge obstacles, collect hearts & coins!',
  'fierce-cheer': 'Bounce ball off walls to score! 20 second limit!',
  'light-speed': 'Tap lights fast! Avoid bombs, catch gold for fever mode!',
  'karaoke-pitch': 'Drag up/down to match the TARGET! Catch scrolling notes for bonus!',
}

interface RoundSettlement {
  readonly gameId: MiniGameId
  readonly score: number
  readonly durationMs: number
  readonly earnedCoins: number
  readonly bestScore: number
  readonly newBestScore: boolean
  readonly endReason?: string
}

interface GameOverOverlayState {
  readonly gameId: MiniGameId
  readonly score: number
  readonly endReason?: string
}

export function GameHubApp() {
  const useCases = useMemo(() => {
    const store = new LocalStorageProgressStore(HUB_STORAGE_KEY)
    return new GameHubUseCases(store, miniGameManifests, HUB_BOOTSTRAP_CONFIG)
  }, [])

  const countdownTimerRef = useRef<number | null>(null)
  const resultRollAnimationFrameRef = useRef<number | null>(null)
  const lastCountdownSoundStepRef = useRef<number | null>(null)

  const [soundSettings, setSoundSettings] = useState(getSoundSettings)
  useEffect(() => subscribeSoundSettings(() => setSoundSettings(getSoundSettings())), [])
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isAttendanceOpen, setIsAttendanceOpen] = useState(false)
  const [attendanceReward, setAttendanceReward] = useState<CheckInReward | null>(null)

  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [selectedGameId, setSelectedGameId] = useState<MiniGameId>(DEFAULT_SELECTED_GAME_ID)
  const [isLobbyGamePicked, setIsLobbyGamePicked] = useState(false)
  const [activeGameId, setActiveGameId] = useState<MiniGameId | null>(null)
  const [resultGameId, setResultGameId] = useState<MiniGameId | null>(null)
  const [settlement, setSettlement] = useState<RoundSettlement | null>(null)
  const [rollingScore, setRollingScore] = useState(0)
  const [rollingCoins, setRollingCoins] = useState(0)
  const [isRollingDone, setIsRollingDone] = useState(false)

  const [gameOverOverlay, setGameOverOverlay] = useState<GameOverOverlayState | null>(null)
  const [lastReward, setLastReward] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [countdownStepIndex, setCountdownStepIndex] = useState<number | null>(null)
  const [isAudioReady, setAudioReady] = useState(false)
  const [unlockPopupGameId, setUnlockPopupGameId] = useState<MiniGameId | null>(null)
  const [unlockBurstActive, setUnlockBurstActive] = useState(false)
  const [activeModule, setActiveModule] = useState<MiniGameModule | null>(null)
  const [activeModuleError, setActiveModuleError] = useState<string | null>(null)

  useEffect(() => {
    void reload(useCases, DEFAULT_SELECTED_GAME_ID, null, setSnapshot, setError)
  }, [useCases])

  useEffect(() => {
    if (snapshot === null || activeGameId !== null || resultGameId !== null) {
      return
    }

    const selectedExists = snapshot.cards.some((card) => card.manifest.id === selectedGameId)
    if (isLobbyGamePicked && selectedExists) {
      return
    }

    const fallbackCard =
      snapshot.cards.find((card) => card.manifest.id === selectedGameId) ??
      snapshot.cards.find((card) => card.unlocked) ??
      snapshot.cards[0] ??
      null

    if (fallbackCard === null) {
      return
    }

    setSelectedGameId(fallbackCard.manifest.id)
    setIsLobbyGamePicked(true)
  }, [activeGameId, isLobbyGamePicked, resultGameId, selectedGameId, snapshot])

  useEffect(() => {
    if (activeGameId === null) {
      setActiveModule(null)
      setActiveModuleError(null)
      return
    }

    let cancelled = false
    setActiveModule(null)
    setActiveModuleError(null)

    void loadMiniGameModule(activeGameId).then(
      (module) => {
        if (!cancelled) {
          setActiveModule(module)
        }
      },
      (caught: unknown) => {
        if (!cancelled) {
          setActiveModuleError(toMessage(caught))
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [activeGameId])

  useEffect(() => {
    return () => {
      clearCountdownTimer(countdownTimerRef)
      clearAnimationFrame(resultRollAnimationFrameRef)

      smStopBgm()
    }
  }, [])

  useEffect(() => {
    if (resultGameId === null || settlement === null) {
      clearAnimationFrame(resultRollAnimationFrameRef)

      setRollingScore(0)
      setRollingCoins(0)
      setIsRollingDone(false)

      return
    }

    clearAnimationFrame(resultRollAnimationFrameRef)
    setIsRollingDone(false)
    setRollingScore(0)
    setRollingCoins(0)

    const startedAt = window.performance.now()

    const animate = (now: number) => {
      const elapsed = now - startedAt
      const progress = Math.min(1, elapsed / RESULT_ROLL_DURATION_MS)
      const eased = easeOutCubic(progress)

      setRollingScore(Math.round(settlement.score * eased))
      setRollingCoins(Math.round(settlement.earnedCoins * eased))

      if (progress < 1) {
        resultRollAnimationFrameRef.current = window.requestAnimationFrame(animate)
        return
      }

      resultRollAnimationFrameRef.current = null
      setIsRollingDone(true)
    }

    resultRollAnimationFrameRef.current = window.requestAnimationFrame(animate)

    if (isAudioReady) {
      playOneShotAudio(resultCoinRollSfx, 0.58)
    }

    if (settlement.newBestScore && isAudioReady) {
      playOneShotAudio(newRecordFanfareSfx, 0.8)
    }

    return () => {
      clearAnimationFrame(resultRollAnimationFrameRef)

    }
  }, [isAudioReady, resultGameId, settlement])

  useEffect(() => {
    if (activeGameId === null || countdownStepIndex === null) {
      clearCountdownTimer(countdownTimerRef)
      return
    }

    clearCountdownTimer(countdownTimerRef)
    countdownTimerRef.current = window.setTimeout(() => {
      countdownTimerRef.current = null
      setCountdownStepIndex((current) => {
        if (current === null) {
          return null
        }

        const next = current + 1
        if (next >= GAME_START_COUNTDOWN_LABELS.length) {
          return null
        }

        return next
      })
    }, GAME_START_COUNTDOWN_STEP_MS)

    return () => {
      clearCountdownTimer(countdownTimerRef)
    }
  }, [activeGameId, countdownStepIndex])

  useEffect(() => {
    if (!isAudioReady) {
      return
    }

    const isModuleBgmLivePlay =
      activeGameId !== null && countdownStepIndex === null && IN_GAME_MODULE_BGM_IDS.has(activeGameId)
    if (isModuleBgmLivePlay) {
      smStopBgm()
      return
    }

    const lobbyBgm = activeGameId === null && resultGameId === null ? pickRandomLobbyBgm() : ''
    const nextTrack = activeGameId !== null ? gameplayBgmLoop : resultGameId !== null ? resultBgmLoop : lobbyBgm
    const nextVolume = activeGameId !== null
      ? (IN_GAME_BGM_VOLUME_BY_GAME_ID[activeGameId] ?? 0.18)
      : resultGameId !== null ? 0.2 : 0.22
    smPlayBgm(nextTrack, nextVolume)
  }, [activeGameId, countdownStepIndex, isAudioReady, resultGameId])

  useEffect(() => {
    if (!isAudioReady || activeGameId === null || countdownStepIndex === null) {
      lastCountdownSoundStepRef.current = null
      return
    }

    if (lastCountdownSoundStepRef.current === countdownStepIndex) {
      return
    }
    lastCountdownSoundStepRef.current = countdownStepIndex

    const isStartStep = countdownStepIndex === GAME_START_COUNTDOWN_LABELS.length - 1
    playOneShotAudio(isStartStep ? countdownStartSfx : countdownTickSfx, isStartStep ? 0.72 : 0.54)
  }, [activeGameId, countdownStepIndex, isAudioReady])

  useEffect(() => {
    if (!isAudioReady || gameOverOverlay === null) {
      return
    }
    playOneShotAudio(gameOverHitSfx, 0.76)
  }, [gameOverOverlay, isAudioReady])

  const uiModel = snapshot ? projectHubUi(snapshot) : null
  const selectedCard = snapshot?.cards.find((card) => card.manifest.id === selectedGameId) ?? null
  const isInGameView = activeGameId !== null

  const activateAudio = () => {
    if (!isAudioReady) {
      setAudioReady(true)
    }
  }

  const playUiClickSfx = () => { playOneShotAudio(uiBtnClickSfx, 1) }
  const playUiCardSwipeSfx = () => { playOneShotAudio(uiCardSwipeSfx, 0.95) }
  const playUiTabSwitchSfx = () => { playOneShotAudio(uiTabSwitchSfx, 0.95) }
  const playUiCoinSfx = () => { playOneShotAudio(uiCoinCollectSfx, 1) }
  const playUiUnlockSfx = () => { playOneShotAudio(uiUnlockPopSfx, 1) }
  const playUiErrorSfx = () => { playOneShotAudio(uiErrorBuzzSfx, 0.95) }

  const selectGame = async (gameId: MiniGameId) => {
    activateAudio()
    playUiCardSwipeSfx()
    setIsLobbyGamePicked(true)
    setSelectedGameId(gameId)
    await reload(useCases, gameId, activeGameId, setSnapshot, setError)
  }

  const openUnlockPopup = (gameId: MiniGameId) => {
    activateAudio()
    playUiTabSwitchSfx()
    setUnlockPopupGameId(gameId)
    setUnlockBurstActive(false)
  }

  const confirmUnlock = async () => {
    if (snapshot === null || unlockPopupGameId === null) {
      return
    }

    try {
      const next = await useCases.unlockGame(unlockPopupGameId, selectedGameId, activeGameId)
      setSnapshot(next)
      setError(null)
      setUnlockBurstActive(true)
      playUiUnlockSfx()
      playUiCoinSfx()
      setTimeout(() => {
        setUnlockPopupGameId(null)
        setUnlockBurstActive(false)
      }, 1200)
    } catch (caught) {
      setError(toMessage(caught))
      playUiErrorSfx()
      setUnlockPopupGameId(null)
    }
  }

  const closeUnlockPopup = () => {
    playUiClickSfx()
    setUnlockPopupGameId(null)
    setUnlockBurstActive(false)
  }

  const startGameById = async (gameId: MiniGameId) => {
    activateAudio()
    playUiClickSfx()
    if (snapshot === null) {
      return
    }

    const gameCard = snapshot.cards.find((card) => card.manifest.id === gameId)
    if (gameCard === undefined) {
      setError('Could not find the selected mini game.')
      return
    }

    if (!gameCard.unlocked) {
      setError('This game is locked. Unlock it first!')
      return
    }

    setSelectedGameId(gameId)
    setIsLobbyGamePicked(true)
    setResultGameId(null)
    setSettlement(null)
    setLastReward(null)
    setGameOverOverlay(null)
    setActiveGameId(gameId)
    setCountdownStepIndex(0)

    void loadMiniGameModule(gameId)
    await reload(useCases, gameId, gameId, setSnapshot, setError)
  }

  const startSelectedGame = async () => {
    await startGameById(selectedGameId)
  }

  const retryLastGame = async () => {
    activateAudio()
    playUiClickSfx()
    if (resultGameId === null) {
      return
    }

    await startGameById(resultGameId)
  }

  const openMainMenu = async () => {
    activateAudio()
    playUiClickSfx()
    setResultGameId(null)
    setSettlement(null)
    setLastReward(null)
    setCountdownStepIndex(null)
    setGameOverOverlay(null)
    await reload(useCases, selectedGameId, null, setSnapshot, setError)
  }

  const exitMiniGame = async () => {
    activateAudio()
    playUiClickSfx()
    if (activeGameId === null) {
      return
    }

    setCountdownStepIndex(null)
    setGameOverOverlay(null)
    setActiveGameId(null)
    await reload(useCases, selectedGameId, null, setSnapshot, setError)
  }

  const finishMiniGame = async (result: MiniGameResult) => {
    if (activeGameId === null) {
      return
    }

    const finishedGameId = activeGameId
    const completionPromise = useCases.completeGame(finishedGameId, result, selectedGameId).then(
      (response) => ({ response }),
      (error: unknown) => ({ error }),
    )
    setCountdownStepIndex(null)
    setGameOverOverlay({ gameId: finishedGameId, score: result.score, endReason: result.endReason })

    try {
      await wait(GAME_OVER_OVERLAY_MS)
      const completion = await completionPromise
      if ('error' in completion) {
        throw completion.error
      }
      const { response } = completion
      const finishedCard = response.snapshot.cards.find((card) => card.manifest.id === finishedGameId)
      if (finishedCard === undefined) {
        throw new Error('Could not find game card in settlement results.')
      }

      setSnapshot(response.snapshot)
      setLastReward(response.earnedCoins)
      setError(null)
      setActiveGameId(null)
      setResultGameId(finishedGameId)
      setSettlement({
        gameId: finishedGameId,
        score: result.score,
        durationMs: result.durationMs,
        earnedCoins: response.earnedCoins,
        bestScore: finishedCard.bestScore,
        newBestScore: response.newBestScore,
        endReason: result.endReason,
      })
    } catch (caught) {
      setActiveGameId(null)
      setResultGameId(null)
      setSettlement(null)
      setError(toMessage(caught))
    } finally {
      setGameOverOverlay(null)
    }
  }

  const activeCard = activeGameId ? snapshot?.cards.find((card) => card.manifest.id === activeGameId) ?? null : null
  const isResultActionView = activeGameId === null && resultGameId !== null
  const isCountdownActive = activeGameId !== null && countdownStepIndex !== null
  const countdownLabel = isCountdownActive ? GAME_START_COUNTDOWN_LABELS[countdownStepIndex] : null
  const countdownGuide = activeGameId === null
    ? null
    : HIDDEN_GAME_DESCRIPTION_IDS.has(activeGameId)
      ? null
      : (COUNTDOWN_GUIDE_BY_GAME_ID[activeGameId] ?? miniGameManifestById[activeGameId].description)
  const displayedSettlementScore = isRollingDone && settlement ? settlement.score : rollingScore
  const displayedSettlementCoins = isRollingDone && settlement ? settlement.earnedCoins : rollingCoins

  return (
    <main className={`game-shell ${isInGameView ? 'game-immersive' : ''}`}>
      <section className={`hub-frame ${isInGameView ? 'game-immersive' : ''}`} aria-label="mini-game-hub">
        {isInGameView ? null : (
          <>
            <div className="lobby-deco-layer" aria-hidden>
              {LOBBY_PARTICLES.map((p, i) => (
                <span
                  className={`lobby-deco-particle ${p.type}`}
                  key={`deco-${i}`}
                  style={{ left: p.left, top: p.top, '--float-delay': p.delay, '--float-dur': p.dur } as CSSProperties}
                />
              ))}
            </div>
            <header className="hub-header">
              <div>
                <img className="hub-logo" src={gameLogoImg} alt="PUNGAK" />
              </div>
              <div className="hub-header-right">
                <div className="coin-badge">
                  <img className="coin-badge-icon" src={coinIconImg} alt="coin" />
                  <span className="coin-badge-value">{uiModel ? uiModel.coinLabel : '...'}</span>
                </div>
                <button
                  className="attendance-toggle-btn"
                  type="button"
                  onClick={() => { activateAudio(); playUiClickSfx(); setIsAttendanceOpen(true); setAttendanceReward(null) }}
                  aria-label="attendance"
                >
                  <CalendarIcon />
                  {getAttendanceState().canCheckIn && <span className="attendance-badge-dot" />}
                </button>
                <button
                  className="settings-toggle-btn"
                  type="button"
                  onClick={() => { activateAudio(); playUiClickSfx(); setIsSettingsOpen((v) => !v) }}
                  aria-label="settings"
                >
                  <SettingsGearIcon />
                </button>
              </div>
            </header>
          </>
        )}

        {lastReward !== null && !isResultActionView && !isInGameView ? (
          <p className="reward-toast">Round reward +{lastReward} coins</p>
        ) : null}
        {error !== null && !isInGameView ? <p className="error-toast">{error}</p> : null}

        {activeGameId !== null ? (
          <section className="game-live-shell" aria-label="mini-game-live-shell">
            <div className={`game-live-fx-layer ${isCountdownActive ? 'countdown' : ''}`} aria-hidden>
              {LIVE_FX_SPARKS.map((spark, index) => (
                <span
                  className="game-live-fx-spark"
                  key={`spark-${index}`}
                  style={
                    {
                      left: spark.left,
                      top: spark.top,
                      '--spark-delay': spark.delay,
                      '--spark-duration': spark.duration,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <ResponsiveGameViewport>
              {isCountdownActive && countdownLabel !== null ? (
                <section
                  className={`game-countdown-panel ${isInGameView ? 'game-immersive' : ''}`}
                  aria-label="game-start-countdown"
                >
                  <div className="game-countdown-content">
                    <p className="game-countdown-text">{countdownLabel}</p>
                    <p className="game-countdown-title">{activeCard?.manifest.title ?? 'Mini Game'}</p>
                    {countdownGuide !== null ? <p className="game-countdown-guide">{countdownGuide}</p> : null}
                  </div>
                </section>
              ) : activeModuleError !== null ? (
                <section className="game-module-status-panel" aria-label="game-module-load-error">
                  <div className="game-module-status-content">
                    <p className="game-module-status-title">LOAD FAILED</p>
                    <p className="game-module-status-message">{activeModuleError}</p>
                    <button className="action-button menu" type="button" onClick={() => void openMainMenu()}>
                      MAIN MENU
                    </button>
                  </div>
                </section>
              ) : activeModule === null ? (
                <section className="game-module-status-panel" aria-label="game-module-loading">
                  <div className="game-module-status-content">
                    <p className="game-module-status-title">LOADING</p>
                    <p className="game-module-status-message">Preparing mini game module...</p>
                  </div>
                </section>
              ) : (
                <activeModule.Component
                  onFinish={finishMiniGame}
                  onExit={exitMiniGame}
                  bestScore={activeCard?.bestScore ?? 0}
                />
              )}
              {gameOverOverlay !== null ? (
                <section className="game-over-overlay" aria-live="polite" aria-label="game-over-overlay">
                  <p className="game-over-title">GAME OVER</p>
                  <p className="game-over-score">{gameOverOverlay.score.toLocaleString()}</p>
                  {gameOverOverlay.endReason ? <p className="game-over-reason">{gameOverOverlay.endReason}</p> : null}
                </section>
              ) : null}
            </ResponsiveGameViewport>
          </section>
        ) : isResultActionView ? (
          <div className="post-game-result-wrapper">
            {settlement ? (
              <section
                className={`post-game-summary-panel ${settlement.newBestScore ? 'new-best' : ''}`}
                aria-label="post-game-summary-panel"
              >
                <p className={`post-game-summary-score ${isRollingDone && settlement.newBestScore ? 'new-best-glow' : ''}`}>
                  {displayedSettlementScore.toLocaleString()}
                </p>
                <p className="post-game-summary-coins">+{displayedSettlementCoins.toLocaleString()} COINS</p>
                {settlement.endReason ? <p className="post-game-summary-reason">{settlement.endReason}</p> : null}
                {settlement.newBestScore ? (
                  <p className={`post-game-record-banner ${isRollingDone ? 'active' : ''}`}>NEW RECORD!</p>
                ) : null}
                {settlement.newBestScore && isRollingDone ? (
                  <div className="post-game-record-burst active" aria-hidden>
                    <span /><span /><span /><span /><span /><span />
                    <span /><span /><span /><span /><span /><span />
                  </div>
                ) : null}
              </section>
            ) : null}
            <section className="post-game-action-panel" aria-label="post-game-action-panel">
              <button className="action-button retry" type="button" onClick={() => void retryLastGame()}>
                RETRY
              </button>
              <button className="action-button menu" type="button" onClick={() => void openMainMenu()}>
                MAIN MENU
              </button>
            </section>
          </div>
        ) : (
          <>
            <div className="lobby-marquee" aria-hidden>
              <div className="lobby-marquee-track">
                {[...MARQUEE_ITEMS, ...MARQUEE_ITEMS].map((text, i) => (
                  <span className="lobby-marquee-item" key={`mq-${i}`}>
                    <span className="lobby-marquee-dot" />
                    {text}
                  </span>
                ))}
              </div>
            </div>
            <p className="lobby-section-label">MINI GAMES</p>
            <section className="lobby-icon-grid" aria-label="mini-game-icon-grid">
              {uiModel?.cards.map((card) => {
                const isSelected = isLobbyGamePicked && card.id === selectedGameId

                return (
                  <button
                    className={`lobby-icon-button ${isSelected ? 'selected' : ''} ${card.unlocked ? 'open' : 'locked'}`}
                    key={card.id}
                    type="button"
                    onClick={() => void selectGame(card.id)}
                  >
                    <span className="lobby-icon-thumb">
                      <img src={getLobbyIcon(card.id)} alt={`${card.title} icon`} />
                      {!card.unlocked && (
                        <span className="lobby-lock-overlay">
                          <img className="lobby-lock-icon" src={lockIconImg} alt="locked" />
                        </span>
                      )}
                    </span>
                    <span className="lobby-icon-title">{card.title}</span>
                    {card.unlocked ? (
                      <span className="lobby-icon-state open">OPEN</span>
                    ) : (
                      <span className="lobby-icon-state locked">
                        <img className="lobby-icon-state-coin" src={coinIconImg} alt="" />
                        {card.unlockCostLabel}
                      </span>
                    )}
                  </button>
                )
              })}
            </section>

            {isLobbyGamePicked && selectedCard ? (
              <section className="hub-selected-panel">
                <h2>{selectedCard.manifest.title}</h2>
                {!HIDDEN_GAME_DESCRIPTION_IDS.has(selectedCard.manifest.id) ? <p>{selectedCard.manifest.description}</p> : null}
                <p className="panel-meta">Unlock: {selectedCard.manifest.unlockCost} coins</p>
                <p className="panel-meta">Reward: +{selectedCard.manifest.baseReward} coins</p>
                <p className="panel-meta">Best: {selectedCard.bestScore} · Plays: {selectedCard.playCount}</p>
                <div className="panel-actions">
                  {selectedCard.unlocked ? (
                    <button className="action-button" type="button" onClick={startSelectedGame}>
                      PLAY
                    </button>
                  ) : (
                    <button className="action-button" type="button" onClick={() => openUnlockPopup(selectedGameId)}>
                      UNLOCK
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <section className="hub-selected-placeholder" aria-label="lobby-select-guide">
                <h2>Select a Game</h2>
                <p>Tap an icon to see game details.</p>
              </section>
            )}

            {unlockPopupGameId !== null && (() => {
              const popupCard = snapshot?.cards.find((c) => c.manifest.id === unlockPopupGameId) ?? null
              return popupCard ? (
                <div className="unlock-popup-backdrop" onClick={closeUnlockPopup}>
                  <section className={`unlock-popup ${unlockBurstActive ? 'burst' : ''}`} onClick={(e) => e.stopPropagation()}>
                    {unlockBurstActive && (
                      <div className="unlock-burst-fx" aria-hidden>
                        <span /><span /><span /><span /><span /><span /><span /><span />
                      </div>
                    )}
                    <img className="unlock-popup-icon" src={getLobbyIcon(unlockPopupGameId)} alt="" />
                    <h3 className="unlock-popup-title">{popupCard.manifest.title}</h3>
                    <p className="unlock-popup-cost">
                      <img className="unlock-popup-coin" src={coinIconImg} alt="" />
                      {popupCard.manifest.unlockCost} coins
                    </p>
                    {unlockBurstActive ? (
                      <p className="unlock-popup-success">UNLOCKED!</p>
                    ) : (
                      <div className="unlock-popup-actions">
                        <button className="action-button" type="button" onClick={() => void confirmUnlock()}>
                          UNLOCK
                        </button>
                        <button className="unlock-popup-cancel" type="button" onClick={closeUnlockPopup}>
                          CANCEL
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              ) : null
            })()}
          </>
        )}
      </section>

      {isAttendanceOpen && (
        <AttendancePopup
          reward={attendanceReward}
          onCheckIn={async () => {
            const [lockedIds, nameMap] = await Promise.all([
              useCases.getLockedGameIds(),
              useCases.getLockedGameNameMap(),
            ])
            const reward = performCheckIn(lockedIds, nameMap)
            if (reward === null) return
            setAttendanceReward(reward)
            playUiCoinSfx()
            if (reward.unlockedGameIds.length > 0) playUiUnlockSfx()
            const next = await useCases.addCoinsAndUnlockGames(
              reward.totalCoins,
              reward.unlockedGameIds as MiniGameId[],
              selectedGameId,
            )
            setSnapshot(next)
          }}
          onClose={() => { setIsAttendanceOpen(false); setAttendanceReward(null) }}
        />
      )}

      {isSettingsOpen && (
        <div className="settings-backdrop" onClick={() => setIsSettingsOpen(false)}>
          <section className="settings-panel" onClick={(e) => e.stopPropagation()}>
            <h3 className="settings-title">SETTINGS</h3>

            <div className="settings-row">
              <span className="settings-label">BGM</span>
              <button
                className={`settings-mute-btn ${soundSettings.bgmMuted ? 'muted' : ''}`}
                type="button"
                onClick={() => updateSoundSettings({ bgmMuted: !soundSettings.bgmMuted })}
              >
                {soundSettings.bgmMuted ? 'OFF' : 'ON'}
              </button>
              <input
                className="settings-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(soundSettings.bgmVolume * 100)}
                onChange={(e) => updateSoundSettings({ bgmVolume: Number(e.target.value) / 100 })}
              />
              <span className="settings-vol-label">{Math.round(soundSettings.bgmVolume * 100)}%</span>
            </div>

            <div className="settings-row">
              <span className="settings-label">SFX</span>
              <button
                className={`settings-mute-btn ${soundSettings.sfxMuted ? 'muted' : ''}`}
                type="button"
                onClick={() => updateSoundSettings({ sfxMuted: !soundSettings.sfxMuted })}
              >
                {soundSettings.sfxMuted ? 'OFF' : 'ON'}
              </button>
              <input
                className="settings-slider"
                type="range"
                min={0}
                max={100}
                value={Math.round(soundSettings.sfxVolume * 100)}
                onChange={(e) => updateSoundSettings({ sfxVolume: Number(e.target.value) / 100 })}
              />
              <span className="settings-vol-label">{Math.round(soundSettings.sfxVolume * 100)}%</span>
            </div>

            <button className="settings-close-btn" type="button" onClick={() => setIsSettingsOpen(false)}>
              CLOSE
            </button>
          </section>
        </div>
      )}
    </main>
  )
}

function SettingsGearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function AttendancePopup({
  reward,
  onCheckIn,
  onClose,
}: {
  reward: CheckInReward | null
  onCheckIn: () => void
  onClose: () => void
}) {
  const config = DEFAULT_ATTENDANCE_CONFIG
  const { data, canCheckIn, currentDayIndex } = getAttendanceState(config)

  const dayLabels = config.dayRewards.map((dr, i) => {
    const resolved = resolveRewardsForDay(i, config)
    return {
      ...dr,
      totalCoins: resolved.totalCoins,
      totalUnlocks: resolved.totalUnlockCount,
      isBonus: i === config.cycleDays - 1,
      checked: data.checkedDays[i] === true,
      isCurrent: i === currentDayIndex && canCheckIn,
    }
  })

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <section className="attendance-panel" onClick={(e) => e.stopPropagation()}>
        <div className="attendance-header">
          <img className="attendance-header-icon" src={attendanceCalendarImg} alt="" />
          <div>
            <h3 className="attendance-title">DAILY CHECK-IN</h3>
            <p className="attendance-streak">Streak: {data.streakCount} days</p>
          </div>
        </div>

        <div className="attendance-grid">
          {dayLabels.map((d, i) => (
            <div
              className={`attendance-day ${d.checked ? 'checked' : ''} ${d.isCurrent ? 'current' : ''} ${d.isBonus ? 'bonus' : ''}`}
              key={i}
            >
              <img
                className="attendance-day-icon"
                src={d.isBonus ? attendanceBonusImg : attendanceCoinImg}
                alt=""
              />
              <span className="attendance-day-num">{d.label}</span>
              <span className="attendance-day-reward">{d.totalCoins}C</span>
              {d.totalUnlocks > 0 && (
                <span className="attendance-day-unlock">+{d.totalUnlocks} game</span>
              )}
              {d.checked && (
                <img className="attendance-check-stamp" src={attendanceCheckImg} alt="checked" />
              )}
            </div>
          ))}
        </div>

        {reward !== null ? (
          <div className="attendance-reward-result">
            <p className="attendance-reward-coins">+{reward.totalCoins} COINS!</p>
            {reward.unlockedGameNames.length > 0 && (
              <div className="attendance-reward-unlocks">
                <p className="attendance-reward-unlock-title">
                  {reward.unlockedGameNames.length} game(s) unlocked!
                </p>
                <ul className="attendance-unlock-list">
                  {reward.unlockedGameNames.map((name, i) => (
                    <li key={i} className="attendance-unlock-item">
                      <img className="attendance-unlock-item-icon" src={getLobbyIcon(reward.unlockedGameIds[i] as MiniGameId)} alt="" />
                      <span>{name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reward.isBonus && <p className="attendance-bonus-tag">BONUS DAY!</p>}
          </div>
        ) : canCheckIn ? (
          <button className="attendance-checkin-btn" type="button" onClick={onCheckIn}>
            CHECK IN TODAY
          </button>
        ) : (
          <p className="attendance-done-msg">Already checked in today!</p>
        )}

        <button className="settings-close-btn" type="button" onClick={onClose}>
          CLOSE
        </button>
      </section>
    </div>
  )
}

function clearCountdownTimer(timerRef: MutableRefObject<number | null>): void {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

function clearAnimationFrame(frameRef: MutableRefObject<number | null>): void {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }
}

function easeOutCubic(value: number): number {
  return 1 - (1 - value) ** 3
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs)
  })
}

async function reload(
  useCases: GameHubUseCases,
  selectedGameId: MiniGameId,
  activeGameId: MiniGameId | null,
  setSnapshot: (snapshot: HubSnapshot) => void,
  setError: (message: string | null) => void,
): Promise<void> {
  try {
    const next = await useCases.loadHub(selectedGameId, activeGameId)
    setSnapshot(next)
    setError(null)
  } catch (caught) {
    setError(toMessage(caught))
  }
}

function toMessage(caught: unknown): string {
  if (caught instanceof Error) {
    return caught.message
  }

  return 'An unknown error occurred.'
}
