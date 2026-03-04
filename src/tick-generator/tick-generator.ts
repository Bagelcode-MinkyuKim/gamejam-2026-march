export interface ITickGenerator {
  start(): void
  stop(): void
  pause(): void
  resume(): void
  isRunning(): boolean
  isPaused(): boolean
}
