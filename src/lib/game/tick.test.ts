import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from './tick'
import { STEP_MS } from './loop'

describe('tick', () => {
  it('за 10 секунд симуляции состояние меняется ровно на ожидаемую величину', () => {
    // 10 секунд при фиксированном шаге 100 мс — ровно 100 тиков.
    const steps = 10_000 / STEP_MS
    let state = createInitialState()
    for (let i = 0; i < steps; i++) state = tick(state, STEP_MS)
    expect(state.totalTicks.toNumber()).toBe(100)
    expect(state.playtimeMs.toNumber()).toBe(10_000)
  })

  it('не мутирует входное состояние', () => {
    const initial = createInitialState()
    tick(initial, STEP_MS)
    expect(initial.totalTicks.toNumber()).toBe(0)
    expect(initial.playtimeMs.toNumber()).toBe(0)
  })
})
