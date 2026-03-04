import type { InputEvent, RenderCommand } from '../primitives/ui-events'

export interface IUiEventChannel {
  publishInput(event: InputEvent): void
  drainInput(): InputEvent[]
  publishRender(commands: RenderCommand[]): void
  drainRender(): RenderCommand[]
}

export class InMemoryUiEventChannel implements IUiEventChannel {
  private inputQueue: InputEvent[] = []
  private renderBuffer: RenderCommand[] = []

  publishInput(event: InputEvent): void {
    this.inputQueue.push(event)
  }

  drainInput(): InputEvent[] {
    const drained = this.inputQueue
    this.inputQueue = []
    return drained
  }

  publishRender(commands: RenderCommand[]): void {
    this.renderBuffer = [...commands]
  }

  drainRender(): RenderCommand[] {
    const drained = this.renderBuffer
    this.renderBuffer = []
    return drained
  }
}
