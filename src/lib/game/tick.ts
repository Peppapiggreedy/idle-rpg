// Чистая функция симуляции одного шага. Не знает про Svelte, DOM и время кадров:
// получает состояние и длительность шага, возвращает новое состояние.
// Пока каркас: считаем тики и игровое время; бой придёт в пункте 2 дорожной карты.
import { Decimal } from './numbers'

export interface GameState {
  totalTicks: Decimal
  playtimeMs: Decimal
}

export function createInitialState(): GameState {
  return {
    totalTicks: new Decimal(0),
    playtimeMs: new Decimal(0),
  }
}

export function tick(state: GameState, dtMs: number): GameState {
  return {
    totalTicks: state.totalTicks.plus(1),
    playtimeMs: state.playtimeMs.plus(dtMs),
  }
}
