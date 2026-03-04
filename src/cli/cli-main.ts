import { GameHubUseCases } from '../application/game-hub-use-cases'
import { HUB_BOOTSTRAP_CONFIG } from '../primitives/constants'
import { miniGameManifests } from '../minigames/registry'
import { InMemoryProgressStore } from '../infrastructure/in-memory-progress-store'

async function runCliPreview() {
  const store = new InMemoryProgressStore()
  const useCases = new GameHubUseCases(store, miniGameManifests, HUB_BOOTSTRAP_CONFIG)
  const snapshot = await useCases.loadHub('tap-dash', null)

  console.log('[CLI Preview] Mini game count:', snapshot.cards.length)
  console.log('[CLI Preview] Coins:', snapshot.coins)
}

void runCliPreview()
