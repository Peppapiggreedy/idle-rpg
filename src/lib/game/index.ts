// Игровая логика: цикл, формулы, сейв. Не знает про Svelte и DOM.
export { Decimal, formatNumber } from './numbers'
export { createGameLoop, STEP_MS, MAX_STEPS_PER_FRAME } from './loop'
export type { GameLoop, GameLoopOptions, LoopMetrics } from './loop'
export { createInitialState, spawnMonster, tick, RESPAWN_DELAY_MS, COMBAT_LOG_SIZE } from './tick'
export type { GameState } from './tick'
export { upgradeCost, xpToNextLevel, applyXp, MAX_LEVELUPS_PER_CALL } from './formulas'
export type { XpResult } from './formulas'
export { buyUpgrade, ownedCount } from './upgrades'
export { rollRarity, rollLoot, sellItem, sellPrice, INVENTORY_SIZE } from './loot'
export { createRng, randomSeed } from './rng'
export { recomputeStats, ensureStats, collectModifiers, explainStat, STAT_IDS } from './stats'
export type { StatId, StatBlock, StatModifier, ModifierKind, StatBreakdown } from './stats'
export { estimateCombatRate } from './combat'
export type { CombatRate } from './combat'
export { subscribe as subscribeAttacks, emit as emitAttack } from './events'
export type { Rng } from './rng'
export {
  saveGame,
  loadGame,
  migrateSave,
  applyOfflineProgress,
  encodeSaveString,
  decodeSaveString,
  stateFromPayload,
  payloadFromState,
  SAVE_KEY,
  SAVE_VERSION,
  AUTOSAVE_INTERVAL_MS,
  OFFLINE_CAP_MS,
  OFFLINE_MODAL_MIN_MS,
} from './save'
export type {
  SavePayloadV5,
  SavedItem,
  SaveStorage,
  SaveDeps,
  OfflineReport,
  LoadResult,
  LoadErrorReason,
} from './save'
