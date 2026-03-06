import { describe, expect, it } from 'vitest'
import { STACK_TOWER_GAMEPLAY_BGM_VOLUME } from './config'

describe('stack tower config', () => {
  it('keeps the stack tower gameplay bgm louder than the global default', () => {
    expect(STACK_TOWER_GAMEPLAY_BGM_VOLUME).toBeGreaterThan(0.18)
  })
})
