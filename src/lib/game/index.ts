// Игровая логика: цикл, формулы, сейв. Не знает про Svelte и DOM.
export { Decimal, formatNumber } from './numbers'
export { createGameLoop, STEP_MS, MAX_STEPS_PER_FRAME } from './loop'
export type { GameLoop, GameLoopOptions, LoopMetrics } from './loop'
export {
  createInitialState,
  spawnMonster,
  monsterFromTemplate,
  emptyEquipment,
  tick,
  RESPAWN_DELAY_MS,
  COMBAT_LOG_SIZE,
} from './tick'
export type { GameState, Equipment } from './tick'
export { upgradeCost, xpToNextLevel, applyXp, MAX_LEVELUPS_PER_CALL } from './formulas'
export type { XpResult } from './formulas'
export { buyUpgrade, ownedCount } from './upgrades'
export { rollRarity, rollLoot, rollSlot, sellItem, sellPrice, INVENTORY_SIZE } from './loot'
export {
  equipItem,
  unequipItem,
  isEquipped,
  isUpgrade,
  setAutoEquip,
  autoEquipIfBetter,
  compareItem,
  damagePerSecondWith,
} from './equipment'
export type { EquipPreview, EquipComparison } from './equipment'
export { createRng, randomSeed, randRange } from './rng'
export {
  recomputeStats,
  applyModifiers,
  ensureStats,
  collectModifiers,
  explainStat,
  explainSwingTime,
  computeSwingTime,
  STAT_IDS,
} from './stats'
export type {
  StatId,
  StatBlock,
  StatModifier,
  ModifierKind,
  StatBreakdown,
  SwingTimeBreakdown,
} from './stats'
export {
  estimateCombatRate,
  rollSwing,
  rollMonsterDamage,
  swingDamageRange,
  expectedSwingDamage,
  attackPowerContribution,
  critFactor,
} from './combat'
export type { CombatRate, SwingResult } from './combat'
export {
  zoneById,
  currentZone,
  isZoneUnlocked,
  forecastZone,
  forecastAllZones,
  travelToZone,
  retreatZone,
  reviveInZone,
  stateInZone,
} from './zones'
export type { ZoneForecast, ZoneVerdict } from './zones'
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
  SavePayloadV8,
  SavedItem,
  SavedModifier,
  SaveStorage,
  SaveDeps,
  OfflineReport,
  LoadResult,
  LoadErrorReason,
} from './save'
