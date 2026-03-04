import type { IUiEventChannel } from '../ui-event-channel/ui-event-channel'
import type { ITickGenerator } from './tick-generator'

export class ManualTickGenerator implements ITickGenerator {
  private readonly channel: IUiEventChannel
  private running = false
  private paused = false

  constructor(channel: IUiEventChannel) {
    this.channel = channel
  }

  start(): void {
    this.running = true
  }

  stop(): void {
    this.running = false
  }

  pause(): void {
    this.paused = true
  }

  resume(): void {
    this.paused = false
  }

  isRunning(): boolean {
    return this.running
  }

  isPaused(): boolean {
    return this.paused
  }

  tick(deltaMs: number, timestampMs: number): void {
    if (!this.running || this.paused) {
      return
    }

    this.channel.publishInput({
      type: 'tick',
      deltaMs,
      timestampMs,
    })
  }
}
