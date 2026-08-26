// Игровая логика: цикл, формулы, сейв. Не знает про Svelte и DOM.
export { Decimal, formatNumber } from './numbers'
export { createGameLoop, STEP_MS, MAX_STEPS_PER_FRAME } from './loop'
export type { GameLoop, GameLoopOptions, LoopMetrics } from './loop'
export { createInitialState, spawnMonster, tick, RESPAWN_DELAY_MS, COMBAT_LOG_SIZE } from './tick'
export type { GameState } from './tick'
export { upgradeCost, xpToNextLevel, applyXp, MAX_LEVELUPS_PER_CALL } from './formulas'
export type { XpResult } from './formulas'
export { buyUpgrade, ownedCount } from './upgrades'
