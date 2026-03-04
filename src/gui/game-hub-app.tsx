import { useEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { GameHubUseCases } from '../application/game-hub-use-cases'
import { HUB_BOOTSTRAP_CONFIG, HUB_STORAGE_KEY } from '../primitives/constants'
import type { HubSnapshot, MiniGameId, MiniGameResult } from '../primitives/types'
import { miniGameManifests, miniGameModuleById } from '../minigames/registry'
import { LocalStorageProgressStore } from '../infrastructure/local-storage-progress-store'
import { projectHubUi } from '../view-model/hub-ui-model'
import { MiniGameStage } from './pixi/mini-game-stage'
import type { StageTransitionState } from './pixi/mini-game-stage'
import tapDashCharacterIcon from '../../assets/images/character-tap-dash-pixel-transparent.png'
import timingShotCharacterIcon from '../../assets/images/character-timing-shot-pixel-transparent.png'
import laneDodgeCharacterIcon from '../../assets/images/character-lane-dodge-pixel-transparent.png'
import sameCharacterIcon from '../../assets/images/same-character/seo-taiji.png'

const DEFAULT_SELECTED_GAME_ID: MiniGameId = HUB_BOOTSTRAP_CONFIG.starterUnlockedGameIds[0]
const STAGE_TRANSITION_MS = 420
const GAME_START_COUNTDOWN_LABELS = ['3', '2', '1', 'START!'] as const
const GAME_START_COUNTDOWN_STEP_MS = 1000
const LOBBY_ICON_BY_GAME_ID: Record<MiniGameId, string> = {
  'tap-dash': tapDashCharacterIcon,
  'timing-shot': timingShotCharacterIcon,
  'lane-dodge': laneDodgeCharacterIcon,
  'same-character': sameCharacterIcon,
  'run-run': tapDashCharacterIcon,
}

export function GameHubApp() {
  const useCases = useMemo(() => {
    const store = new LocalStorageProgressStore(HUB_STORAGE_KEY)
    return new GameHubUseCases(store, miniGameManifests, HUB_BOOTSTRAP_CONFIG)
  }, [])

  const transitionTimerRef = useRef<number | null>(null)
  const countdownTimerRef = useRef<number | null>(null)

  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [selectedGameId, setSelectedGameId] = useState<MiniGameId>(DEFAULT_SELECTED_GAME_ID)
  const [isLobbyGamePicked, setIsLobbyGamePicked] = useState(false)
  const [activeGameId, setActiveGameId] = useState<MiniGameId | null>(null)
  const [stageTransitionState, setStageTransitionState] = useState<StageTransitionState>('idle')
  const [resultGameId, setResultGameId] = useState<MiniGameId | null>(null)
  const [lastReward, setLastReward] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [countdownStepIndex, setCountdownStepIndex] = useState<number | null>(null)

  useEffect(() => {
    void reload(useCases, DEFAULT_SELECTED_GAME_ID, null, setSnapshot, setError)
  }, [useCases])

  useEffect(() => {
    return () => {
      clearTransitionTimer(transitionTimerRef)
      clearCountdownTimer(countdownTimerRef)
    }
  }, [])

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

  const uiModel = snapshot ? projectHubUi(snapshot) : null
  const selectedCard = snapshot?.cards.find((card) => card.manifest.id === selectedGameId) ?? null
  const isTapDashActive = activeGameId === 'tap-dash'

  const selectGame = async (gameId: MiniGameId) => {
    setIsLobbyGamePicked(true)
    setSelectedGameId(gameId)
    await reload(useCases, gameId, activeGameId, setSnapshot, setError)
  }

  const unlockSelectedGame = async () => {
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
    setLastReward(null)
    setActiveGameId(gameId)
    setCountdownStepIndex(0)
    setStageTransitionState('enter')

    await reload(useCases, gameId, gameId, setSnapshot, setError)
    scheduleTransition(transitionTimerRef, () => {
      setStageTransitionState('idle')
    })
  }

  const startSelectedGame = async () => {
    await startGameById(selectedGameId)
  }

  const retryLastGame = async () => {
    if (resultGameId === null) {
      return
    }

    await startGameById(resultGameId)
  }

  const openMainMenu = async () => {
    setResultGameId(null)
    setLastReward(null)
    setCountdownStepIndex(null)
    await reload(useCases, selectedGameId, null, setSnapshot, setError)
  }

  const exitMiniGame = async () => {
    if (activeGameId === null) {
      return
    }

    setStageTransitionState('exit')
    setCountdownStepIndex(null)

    scheduleTransition(transitionTimerRef, () => {
      setActiveGameId(null)
      setStageTransitionState('idle')
      void reload(useCases, selectedGameId, null, setSnapshot, setError)
    })
  }

  const finishMiniGame = async (result: MiniGameResult) => {
    if (activeGameId === null) {
      return
    }

    try {
      const finishedGameId = activeGameId
      const response = await useCases.completeGame(activeGameId, result, selectedGameId)
      setSnapshot(response.snapshot)
      setLastReward(response.earnedCoins)
      setError(null)
      setCountdownStepIndex(null)

      setStageTransitionState('exit')
      scheduleTransition(transitionTimerRef, () => {
        setActiveGameId(null)
        setResultGameId(finishedGameId)
        setStageTransitionState('idle')
      })
    } catch (caught) {
      setError(toMessage(caught))
    }
  }

  const activeModule = activeGameId ? miniGameModuleById[activeGameId] : null
  const isResultActionView = activeGameId === null && resultGameId !== null
  const isCountdownActive = activeGameId !== null && countdownStepIndex !== null
  const countdownLabel = isCountdownActive ? GAME_START_COUNTDOWN_LABELS[countdownStepIndex] : null

  return (
    <main className={`game-shell ${isTapDashActive ? 'tapdash-immersive' : ''}`}>
      <section className={`hub-frame ${isTapDashActive ? 'tapdash-immersive' : ''}`} aria-label="mini-game-hub">
        {isTapDashActive ? null : (
          <header className="hub-header">
            <div>
              <p className="eyebrow">MINI HEAVEN</p>
              <h1>Bagel Mini Plaza</h1>
            </div>
            <p className="coin-badge">{uiModel ? uiModel.coinLabel : '로딩중...'}</p>
          </header>
        )}

        {lastReward !== null && !isResultActionView && !isTapDashActive ? (
          <p className="reward-toast">이번 라운드 보상 +{lastReward} 코인</p>
        ) : null}
        {error !== null && !isTapDashActive ? <p className="error-toast">{error}</p> : null}

        {activeGameId !== null && activeModule ? (
          <>
            {activeGameId === 'tap-dash' ? null : (
              <MiniGameStage
                gameId={activeGameId}
                title={activeModule.manifest.title}
                transitionState={stageTransitionState}
              />
            )}
            {isCountdownActive && countdownLabel !== null ? (
              <section
                className={`game-countdown-panel ${activeGameId === 'tap-dash' ? 'tapdash-immersive' : ''}`}
                aria-label="game-start-countdown"
              >
                <p className="game-countdown-text">{countdownLabel}</p>
              </section>
            ) : (
              <activeModule.Component onFinish={finishMiniGame} onExit={exitMiniGame} />
            )}
          </>
        ) : isResultActionView ? (
          <section className="post-game-action-panel" aria-label="post-game-action-panel">
            <button className="action-button" type="button" onClick={() => void retryLastGame()}>
              다시 도전
            </button>
            <button className="action-button menu" type="button" onClick={() => void openMainMenu()}>
              메인 메뉴
            </button>
          </section>
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
                      <img src={LOBBY_ICON_BY_GAME_ID[card.id]} alt={`${card.title} icon`} />
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

function clearTransitionTimer(timerRef: MutableRefObject<number | null>): void {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

function clearCountdownTimer(timerRef: MutableRefObject<number | null>): void {
  if (timerRef.current !== null) {
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
}

function scheduleTransition(
  timerRef: MutableRefObject<number | null>,
  callback: () => void,
  delayMs = STAGE_TRANSITION_MS,
): void {
  clearTransitionTimer(timerRef)

  timerRef.current = window.setTimeout(() => {
    timerRef.current = null
    callback()
  }, delayMs)
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
