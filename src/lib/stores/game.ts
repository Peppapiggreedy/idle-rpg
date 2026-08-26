// Единственный мост между игровой логикой и UI: компоненты читают эти store,
// цикл пишет в них. Прямых импортов src/lib/game из компонентов быть не должно.
import { readonly, writable } from 'svelte/store'
import { createGameLoop, type GameLoop, type LoopMetrics } from '../game/loop'
import { createInitialState, tick, type GameState } from '../game/tick'

const state = writable<GameState>(createInitialState())
export const gameState = readonly(state)

const metrics = writable<LoopMetrics>({ fps: 0, tps: 0 })
export const loopMetrics = readonly(metrics)

let loop: GameLoop | null = null

/** Запускает единственный игровой цикл. Повторный вызов ничего не делает. */
export function startGameLoop(): void {
  if (loop) return
  loop = createGameLoop({
    step: (dtMs) => state.update((s) => tick(s, dtMs)),
    onMetrics: (m) => metrics.set(m),
  })
  loop.start()
}

export function stopGameLoop(): void {
  loop?.stop()
  loop = null
}
