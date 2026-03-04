export interface TickInputEvent {
  readonly type: 'tick'
  readonly deltaMs: number
  readonly timestampMs: number
}

export type InputEvent = TickInputEvent

export interface RenderCommand {
  readonly type: 'noop'
  readonly frameId: number
}
