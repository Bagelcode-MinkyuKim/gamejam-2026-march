import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MutableRefObject } from 'react'
import { GameHubUseCases } from '../application/game-hub-use-cases'
import { HUB_BOOTSTRAP_CONFIG, HUB_STORAGE_KEY } from '../primitives/constants'
import type { HubSnapshot, MiniGameId, MiniGameResult } from '../primitives/types'
import { miniGameManifests, miniGameModuleById } from '../minigames/registry'
import { LocalStorageProgressStore } from '../infrastructure/local-storage-progress-store'
import { projectHubUi } from '../view-model/hub-ui-model'
import lobbyTapDashIcon from '../../assets/images/generated/lobby-icons/lobby-tap-dash.png'
import lobbyRunRunIcon from '../../assets/images/generated/lobby-icons/lobby-run-run.png'
import lobbySameCharacterIcon from '../../assets/images/generated/lobby-icons/lobby-same-character.png'
import lobbyGogunbuntuIcon from '../../assets/images/generated/lobby-icons/lobby-gogunbuntu.png'
import lobbyComboFormulaIcon from '../../assets/images/generated/lobby-icons/lobby-combo-formula.png'
import lobbyChamChamChamIcon from '../../assets/images/generated/lobby-icons/lobby-cham-cham-cham.png'
import lobbyDungaDungaIcon from '../../assets/images/generated/lobby-icons/lobby-dunga-dunga.png'
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
import kimYeonjaCastSprite from '../../assets/images/same-character/kim-yeonja.png'
import parkSangminCastSprite from '../../assets/images/same-character/park-sangmin.png'
import parkWankyuCastSprite from '../../assets/images/same-character/park-wankyu.png'
import seoTaijiCastSprite from '../../assets/images/same-character/seo-taiji.png'
import lobbyBgmLoop from '../../assets/sounds/lobby-bgm-loop.mp3'
import gameplayBgmLoop from '../../assets/sounds/gameplay-bgm-loop.mp3'
import resultBgmLoop from '../../assets/sounds/result-bgm-loop.mp3'
import countdownTickSfx from '../../assets/sounds/countdown-tick.mp3'
import countdownStartSfx from '../../assets/sounds/countdown-start.mp3'
import gameOverHitSfx from '../../assets/sounds/game-over-hit.mp3'
import newRecordFanfareSfx from '../../assets/sounds/new-record-fanfare.mp3'
import uiButtonPopSfx from '../../assets/sounds/ui-button-pop.mp3'
import resultCoinRollSfx from '../../assets/sounds/result-coin-roll.mp3'

const DEFAULT_SELECTED_GAME_ID: MiniGameId = HUB_BOOTSTRAP_CONFIG.starterUnlockedGameIds[0]
const GAME_START_COUNTDOWN_LABELS = ['3', '2', '1', 'START!'] as const
const GAME_START_COUNTDOWN_STEP_MS = 1000
const GAME_OVER_OVERLAY_MS = 1100
const RESULT_ROLL_DURATION_MS = 1200
const IN_GAME_MODULE_BGM_IDS = new Set<MiniGameId>(['tap-dash', 'same-character', 'gogunbuntu'])
const LIVE_CAST = [
  { name: '김연자', imageSrc: kimYeonjaCastSprite },
  { name: '박상민', imageSrc: parkSangminCastSprite },
  { name: '박완규', imageSrc: parkWankyuCastSprite },
  { name: '서태지', imageSrc: seoTaijiCastSprite },
] as const
const LIVE_FX_SPARKS = [
  { left: '8%', top: '18%', delay: '0s', duration: '2.6s' },
  { left: '16%', top: '46%', delay: '0.35s', duration: '3.1s' },
  { left: '24%', top: '74%', delay: '0.8s', duration: '2.8s' },
  { left: '78%', top: '22%', delay: '0.42s', duration: '3.2s' },
  { left: '88%', top: '40%', delay: '1s', duration: '2.7s' },
  { left: '84%', top: '70%', delay: '0.2s', duration: '3s' },
] as const
const CUSTOM_LOBBY_ICONS: Partial<Record<MiniGameId, string>> = {
  'tap-dash': lobbyTapDashIcon,
  'same-character': lobbySameCharacterIcon,
  'run-run': lobbyRunRunIcon,
  'gogunbuntu': lobbyGogunbuntuIcon,
  'combo-formula': lobbyComboFormulaIcon,
  'cham-cham-cham': lobbyChamChamChamIcon,
  'intense-cheer': lobbyIntenseCheerIcon,
  'dunga-dunga': lobbyDungaDungaIcon,
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
  'tap-dash': '등장하는 타겟을 연속 터치하고, 하트 아이템으로 시간을 크게 벌어보세요.',
  'gogunbuntu': '점프로 높이를 맞추고 훅을 던져 스윙하며 지형을 돌파하세요.',
  'same-character': '중앙 대기열 캐릭터를 같은 줄에 맞춰 연속 콤보를 만들어보세요.',
  'combo-formula': '조합 순서를 입력하고 OK를 눌러 배수 콤보와 피버를 쌓으세요.',
  'run-run': '좌우 전환 타이밍을 맞춰 코스 밖으로 벗어나지 않게 달리세요.',
  'cham-cham-cham': '참참참! 공격은 방향을 맞추고, 수비는 빠르게 피하세요. 체력 3칸!',
  'intense-cheer': '좌/우 터치로 점프하며 위로 올라가세요! 장애물을 피하고 하트와 코인을 모으세요.',
  'dunga-dunga': '구멍에서 출몰하는 가수를 터치! 피버 게이지를 채워 황금 가수를 노려보세요.',
  'fierce-cheer': '공을 좌우 벽에 번갈아 닿게 해서 점수를 올리세요! 20초 제한!',
}

interface RoundSettlement {
  readonly gameId: MiniGameId
  readonly score: number
  readonly durationMs: number
  readonly earnedCoins: number
  readonly bestScore: number
  readonly newBestScore: boolean
}

interface GameOverOverlayState {
  readonly gameId: MiniGameId
  readonly score: number
}

export function GameHubApp() {
  const useCases = useMemo(() => {
    const store = new LocalStorageProgressStore(HUB_STORAGE_KEY)
    return new GameHubUseCases(store, miniGameManifests, HUB_BOOTSTRAP_CONFIG)
  }, [])

  const countdownTimerRef = useRef<number | null>(null)
  const resultRollAnimationFrameRef = useRef<number | null>(null)
  const newBestEffectTimerRef = useRef<number | null>(null)
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null)
  const bgmTrackRef = useRef<string | null>(null)
  const lastCountdownSoundStepRef = useRef<number | null>(null)

  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [selectedGameId, setSelectedGameId] = useState<MiniGameId>(DEFAULT_SELECTED_GAME_ID)
  const [isLobbyGamePicked, setIsLobbyGamePicked] = useState(false)
  const [activeGameId, setActiveGameId] = useState<MiniGameId | null>(null)
  const [resultGameId, setResultGameId] = useState<MiniGameId | null>(null)
  const [settlement, setSettlement] = useState<RoundSettlement | null>(null)
  const [rollingScore, setRollingScore] = useState(0)
  const [rollingCoins, setRollingCoins] = useState(0)
  const [isRollingDone, setIsRollingDone] = useState(false)
  const [isNewBestEffectActive, setIsNewBestEffectActive] = useState(false)
  const [gameOverOverlay, setGameOverOverlay] = useState<GameOverOverlayState | null>(null)
  const [lastReward, setLastReward] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [countdownStepIndex, setCountdownStepIndex] = useState<number | null>(null)
  const [isAudioReady, setAudioReady] = useState(false)

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
    return () => {
      clearCountdownTimer(countdownTimerRef)
      clearAnimationFrame(resultRollAnimationFrameRef)
      clearTimeoutSafe(newBestEffectTimerRef)
      stopBackgroundAudio(bgmAudioRef, bgmTrackRef)
    }
  }, [])

  useEffect(() => {
    if (resultGameId === null || settlement === null) {
      clearAnimationFrame(resultRollAnimationFrameRef)
      clearTimeoutSafe(newBestEffectTimerRef)
      setRollingScore(0)
      setRollingCoins(0)
      setIsRollingDone(false)
      setIsNewBestEffectActive(false)
      return
    }

    clearAnimationFrame(resultRollAnimationFrameRef)
    clearTimeoutSafe(newBestEffectTimerRef)
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

    if (settlement.newBestScore) {
      setIsNewBestEffectActive(true)
      if (isAudioReady) {
        playOneShotAudio(newRecordFanfareSfx, 0.8)
      }
      newBestEffectTimerRef.current = window.setTimeout(() => {
        setIsNewBestEffectActive(false)
        newBestEffectTimerRef.current = null
      }, 2600)
    } else {
      setIsNewBestEffectActive(false)
    }

    return () => {
      clearAnimationFrame(resultRollAnimationFrameRef)
      clearTimeoutSafe(newBestEffectTimerRef)
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
      stopBackgroundAudio(bgmAudioRef, bgmTrackRef)
      return
    }

    const nextTrack = activeGameId !== null ? gameplayBgmLoop : resultGameId !== null ? resultBgmLoop : lobbyBgmLoop
    const nextVolume = activeGameId !== null ? 0.3 : resultGameId !== null ? 0.32 : 0.34
    playBackgroundAudio(nextTrack, nextVolume, bgmAudioRef, bgmTrackRef)
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

  const playUiClickSfx = () => {
    if (!isAudioReady) {
      return
    }
    playOneShotAudio(uiButtonPopSfx, 0.64)
  }

  const selectGame = async (gameId: MiniGameId) => {
    activateAudio()
    playUiClickSfx()
    setIsLobbyGamePicked(true)
    setSelectedGameId(gameId)
    await reload(useCases, gameId, activeGameId, setSnapshot, setError)
  }

  const unlockSelectedGame = async () => {
    activateAudio()
    playUiClickSfx()
    if (snapshot === null || selectedCard === null) {
      return
    }

    try {
      const next = await useCases.unlockGame(selectedGameId, selectedGameId, activeGameId)
      setSnapshot(next)
      setError(null)
    } catch (caught) {
      setError(toMessage(caught))
    }
  }

  const startGameById = async (gameId: MiniGameId) => {
    activateAudio()
    playUiClickSfx()
    if (snapshot === null) {
      return
    }

    const gameCard = snapshot.cards.find((card) => card.manifest.id === gameId)
    if (gameCard === undefined) {
      setError('선택한 미니게임 정보를 찾을 수 없습니다.')
      return
    }

    if (!gameCard.unlocked) {
      setError('잠긴 미니게임은 먼저 해금해야 합니다.')
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
    setGameOverOverlay({ gameId: finishedGameId, score: result.score })

    try {
      await wait(GAME_OVER_OVERLAY_MS)
      const completion = await completionPromise
      if ('error' in completion) {
        throw completion.error
      }
      const { response } = completion
      const finishedCard = response.snapshot.cards.find((card) => card.manifest.id === finishedGameId)
      if (finishedCard === undefined) {
        throw new Error('정산 결과에서 게임 카드 정보를 찾을 수 없습니다.')
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

  const activeModule = activeGameId ? miniGameModuleById[activeGameId] : null
  const activeCard = activeGameId ? snapshot?.cards.find((card) => card.manifest.id === activeGameId) ?? null : null
  const isResultActionView = activeGameId === null && resultGameId !== null
  const isCountdownActive = activeGameId !== null && countdownStepIndex !== null
  const countdownLabel = isCountdownActive ? GAME_START_COUNTDOWN_LABELS[countdownStepIndex] : null
  const countdownGuide = activeGameId ? (COUNTDOWN_GUIDE_BY_GAME_ID[activeGameId] ?? miniGameModuleById[activeGameId].manifest.description) : null
  const resultTitle = settlement ? miniGameModuleById[settlement.gameId].manifest.title : 'Mini Game'
  const displayedSettlementScore = isRollingDone && settlement ? settlement.score : rollingScore
  const displayedSettlementCoins = isRollingDone && settlement ? settlement.earnedCoins : rollingCoins
  const bestScoreGap = settlement ? Math.max(0, settlement.bestScore - settlement.score) : 0

  return (
    <main className={`game-shell ${isInGameView ? 'game-immersive' : ''}`}>
      <section className={`hub-frame ${isInGameView ? 'game-immersive' : ''}`} aria-label="mini-game-hub">
        {isInGameView ? null : (
          <header className="hub-header">
            <div>
              <p className="eyebrow">MINI HEAVEN</p>
              <h1>Bagel Mini Plaza</h1>
            </div>
            <p className="coin-badge">{uiModel ? uiModel.coinLabel : '로딩중...'}</p>
          </header>
        )}

        {lastReward !== null && !isResultActionView && !isInGameView ? (
          <p className="reward-toast">이번 라운드 보상 +{lastReward} 코인</p>
        ) : null}
        {error !== null && !isInGameView ? <p className="error-toast">{error}</p> : null}

        {activeGameId !== null && activeModule ? (
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
            <div className={`game-live-cast-overlay ${isCountdownActive ? 'countdown' : ''}`} aria-hidden>
              {LIVE_CAST.map((cast, index) => (
                <span className="game-live-cast-item" key={cast.name} style={{ '--cast-index': `${index}` } as CSSProperties}>
                  <img src={cast.imageSrc} alt="" />
                </span>
              ))}
            </div>
            {isCountdownActive && countdownLabel !== null ? (
              <section
                className={`game-countdown-panel ${isInGameView ? 'game-immersive' : ''}`}
                aria-label="game-start-countdown"
              >
                <div className="game-countdown-content">
                  <p className="game-countdown-text">{countdownLabel}</p>
                  <p className="game-countdown-title">{activeCard?.manifest.title ?? '미니게임'}</p>
                  <p className="game-countdown-guide">{countdownGuide ?? activeCard?.manifest.description}</p>
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
                <p className="game-over-title">게임 종료!!</p>
                <p className="game-over-score">FINAL SCORE {gameOverOverlay.score.toLocaleString()}</p>
              </section>
            ) : null}
          </section>
        ) : isResultActionView ? (
          <>
            {settlement ? (
              <section
                className={`post-game-summary-panel ${settlement.newBestScore ? 'new-best' : ''}`}
                aria-label="post-game-summary-panel"
              >
                <p className="post-game-summary-eyebrow">ROUND RESULT</p>
                <p className="post-game-summary-title">{resultTitle}</p>
                <p className="post-game-summary-label">FINAL SCORE</p>
                <p className="post-game-summary-score">{displayedSettlementScore.toLocaleString()}</p>
                <div className="post-game-summary-grid">
                  <div className="post-game-summary-card">
                    <span>획득 코인</span>
                    <strong>+{displayedSettlementCoins.toLocaleString()}</strong>
                  </div>
                  <div className="post-game-summary-card">
                    <span>최고 기록</span>
                    <strong>{settlement.bestScore.toLocaleString()}점</strong>
                  </div>
                  <div className="post-game-summary-card">
                    <span>플레이 시간</span>
                    <strong>{(settlement.durationMs / 1000).toFixed(1)}초</strong>
                  </div>
                </div>
                {settlement.newBestScore ? (
                  <p className={`post-game-record-banner ${isNewBestEffectActive ? 'active' : ''}`}>NEW RECORD 갱신!</p>
                ) : (
                  <p className="post-game-record-banner keep">신기록까지 {bestScoreGap.toLocaleString()}점</p>
                )}
                {settlement.newBestScore ? (
                  <div className={`post-game-record-burst ${isNewBestEffectActive ? 'active' : ''}`} aria-hidden>
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                ) : null}
              </section>
            ) : null}
            <section className="post-game-action-panel" aria-label="post-game-action-panel">
              <button className="action-button retry" type="button" onClick={() => void retryLastGame()}>
                다시 도전
              </button>
              <button className="action-button menu" type="button" onClick={() => void openMainMenu()}>
                메인 메뉴
              </button>
            </section>
          </>
        ) : (
          <>
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
                    </span>
                    <span className="lobby-icon-title">{card.title}</span>
                    <span className={`lobby-icon-state ${card.unlocked ? 'open' : 'locked'}`}>
                      {card.unlocked ? 'OPEN' : card.unlockCostLabel}
                    </span>
                  </button>
                )
              })}
            </section>

            {isLobbyGamePicked && selectedCard ? (
              <section className="hub-selected-panel">
                <h2>{selectedCard.manifest.title}</h2>
                <p>{selectedCard.manifest.description}</p>
                <p className="panel-meta">해금 비용: {selectedCard.manifest.unlockCost} 코인</p>
                <p className="panel-meta">기본 보상: +{selectedCard.manifest.baseReward} 코인</p>
                <p className="panel-meta">베스트: {selectedCard.bestScore} · 플레이: {selectedCard.playCount}회</p>
                <div className="panel-actions">
                  {selectedCard.unlocked ? (
                    <button className="action-button" type="button" onClick={startSelectedGame}>
                      플레이 시작
                    </button>
                  ) : (
                    <button className="action-button" type="button" onClick={unlockSelectedGame}>
                      해금하기
                    </button>
                  )}
                </div>
              </section>
            ) : (
              <section className="hub-selected-placeholder" aria-label="lobby-select-guide">
                <h2>미니게임 선택</h2>
                <p>아이콘을 터치하면 게임 설명이 표시됩니다.</p>
              </section>
            )}
          </>
        )}
      </section>
    </main>
  )
}

function playOneShotAudio(src: string, volume: number): void {
  const sound = new Audio(src)
  sound.preload = 'auto'
  sound.volume = volume
  void sound.play().catch(() => {})
}

function playBackgroundAudio(
  src: string,
  volume: number,
  audioRef: MutableRefObject<HTMLAudioElement | null>,
  trackRef: MutableRefObject<string | null>,
): void {
  if (trackRef.current === src && audioRef.current !== null) {
    audioRef.current.volume = volume
    return
  }

  stopBackgroundAudio(audioRef, trackRef)

  const background = new Audio(src)
  background.loop = true
  background.preload = 'auto'
  background.volume = volume
  void background.play().catch(() => {})
  audioRef.current = background
  trackRef.current = src
}

function stopBackgroundAudio(
  audioRef: MutableRefObject<HTMLAudioElement | null>,
  trackRef: MutableRefObject<string | null>,
): void {
  if (audioRef.current !== null) {
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    audioRef.current = null
  }
  trackRef.current = null
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

function clearTimeoutSafe(timerRef: MutableRefObject<number | null>): void {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
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

  return '알 수 없는 오류가 발생했습니다.'
}
