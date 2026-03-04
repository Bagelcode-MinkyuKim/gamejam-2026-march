export type GameHubErrorCode =
  | 'INVALID_PROGRESS'
  | 'INVALID_CONFIG'
  | 'UNKNOWN_GAME'
  | 'INSUFFICIENT_COINS'
  | 'LOCKED_GAME'
  | 'INVALID_RESULT'

export class GameHubError extends Error {
  public readonly code: GameHubErrorCode

  constructor(code: GameHubErrorCode, message: string) {
    super(message)
    this.name = 'GameHubError'
    this.code = code
  }
}
