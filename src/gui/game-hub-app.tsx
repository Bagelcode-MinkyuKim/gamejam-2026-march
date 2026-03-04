import { useEffect, useMemo, useState } from 'react'
import { GameHubUseCases } from '../application/game-hub-use-cases'
import { HUB_BOOTSTRAP_CONFIG, HUB_STORAGE_KEY } from '../primitives/constants'
import type { HubSnapshot, MiniGameId, MiniGameResult } from '../primitives/types'
import { miniGameManifests, miniGameModuleById } from '../minigames/registry'
import { LocalStorageProgressStore } from '../infrastructure/local-storage-progress-store'
import { projectHubUi } from '../view-model/hub-ui-model'
import { MiniGameStage } from './pixi/mini-game-stage'

const DEFAULT_SELECTED_GAME_ID: MiniGameId = HUB_BOOTSTRAP_CONFIG.starterUnlockedGameIds[0]

export function GameHubApp() {
  const useCases = useMemo(() => {
    const store = new LocalStorageProgressStore(HUB_STORAGE_KEY)
    return new GameHubUseCases(store, miniGameManifests, HUB_BOOTSTRAP_CONFIG)
  }, [])

  const [snapshot, setSnapshot] = useState<HubSnapshot | null>(null)
  const [selectedGameId, setSelectedGameId] = useState<MiniGameId>(DEFAULT_SELECTED_GAME_ID)
  const [activeGameId, setActiveGameId] = useState<MiniGameId | null>(null)
  const [lastReward, setLastReward] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void reload(useCases, DEFAULT_SELECTED_GAME_ID, null, setSnapshot, setError)
  }, [useCases])

  const uiModel = snapshot ? projectHubUi(snapshot) : null

  const selectGame = async (gameId: MiniGameId) => {
    setSelectedGameId(gameId)
    await reload(useCases, gameId, activeGameId, setSnapshot, setError)
  }

  const unlockSelectedGame = async () => {
    if (snapshot === null) {
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

  const startSelectedGame = async () => {
    if (snapshot === null) {
      return
    }

    const selectedCard = snapshot.cards.find((card) => card.manifest.id === selectedGameId)
    if (!selectedCard || !selectedCard.unlocked) {
      setError('잠긴 미니게임은 먼저 해금해야 합니다.')
      return
    }

    setActiveGameId(selectedGameId)
    await reload(useCases, selectedGameId, selectedGameId, setSnapshot, setError)
  }

  const exitMiniGame = async () => {
    setActiveGameId(null)
    await reload(useCases, selectedGameId, null, setSnapshot, setError)
  }

  const finishMiniGame = async (result: MiniGameResult) => {
    if (activeGameId === null) {
      return
    }

    try {
      const response = await useCases.completeGame(activeGameId, result, selectedGameId)
      setSnapshot(response.snapshot)
      setActiveGameId(null)
      setLastReward(response.earnedCoins)
      setError(null)
    } catch (caught) {
      setError(toMessage(caught))
    }
  }

  const selectedModule = miniGameModuleById[selectedGameId]
  const activeModule = activeGameId ? miniGameModuleById[activeGameId] : null

  return (
    <main className="game-shell">
      <section className="hub-frame" aria-label="mini-game-hub">
        <header className="hub-header">
          <div>
            <p className="eyebrow">MINI HEAVEN</p>
            <h1>Bagel Mini Plaza</h1>
          </div>
          <p className="coin-badge">{uiModel ? uiModel.coinLabel : '로딩중...'}</p>
        </header>

        {lastReward !== null ? <p className="reward-toast">이번 라운드 보상 +{lastReward} 코인</p> : null}
        {error !== null ? <p className="error-toast">{error}</p> : null}

        {activeGameId !== null && activeModule ? (
          <>
            <MiniGameStage gameId={activeGameId} title={activeModule.manifest.title} />
            <activeModule.Component onFinish={finishMiniGame} onExit={exitMiniGame} />
          </>
        ) : (
          <>
            <section className="hub-selected-panel">
              <h2>{selectedModule.manifest.title}</h2>
              <p>{selectedModule.manifest.description}</p>
              <p className="panel-meta">해금 비용: {selectedModule.manifest.unlockCost} 코인</p>
              <p className="panel-meta">기본 보상: +{selectedModule.manifest.baseReward} 코인</p>
              <div className="panel-actions">
                {snapshot?.cards.find((card) => card.manifest.id === selectedGameId)?.unlocked ? (
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

            <section className="hub-card-list" aria-label="mini-game-list">
              {uiModel?.cards.map((card) => (
                <button
                  className={`game-card ${card.selected ? 'selected' : ''}`}
                  key={card.id}
                  type="button"
                  onClick={() => void selectGame(card.id)}
                >
                  <span className="card-color" style={{ backgroundColor: card.accentColor }} />
                  <div className="card-content">
                    <h3>{card.title}</h3>
                    <p>{card.description}</p>
                    <p>{card.rewardLabel}</p>
                    <p>{card.bestScoreLabel} · {card.playCountLabel}</p>
                  </div>
                  <span className={`card-state ${card.unlocked ? 'open' : 'locked'}`}>
                    {card.unlocked ? 'Unlocked' : card.unlockCostLabel}
                  </span>
                </button>
              ))}
            </section>
          </>
        )}
      </section>
    </main>
  )
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
