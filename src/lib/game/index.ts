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
  expectedAbilityDamage,
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
export {
  ABILITIES,
  ABILITY_BY_ID,
  abilityStatus,
  allAbilityStatuses,
  cooldownLeft,
  useAbility,
  consumeQueuedAbility,
  advanceCooldowns,
  autocastStep,
  autocastCandidates,
} from './abilities'
export { rotationRate, abilitiesByPriority, PLAN } from './rotation'
export type { PlayMode, RotationPlan, RotationRate } from './rotation'
export type { AbilityDef, AbilityType, AbilityStatus, AbilityBlockReason } from './abilities'
export {
  earnedPoints,
  availablePoints,
  spentPoints,
  spentInBranch,
  rankOf,
  talentStatus,
  allTalentStatuses,
  investTalent,
  resetTalents,
  resetCost,
  canResetTalents,
  talentModifiers,
  talentFlags,
  hasTalentFlag,
  reviveMultiplier,
} from './talents'
export type { TalentStatus, TalentBlockReason, TalentRanks } from './talents'
export {
  DUNGEONS,
  DUNGEON_BY_ID,
  dungeonById,
  activeDungeon,
  currentBoss,
  dungeonStatus,
  allDungeonStatuses,
  enterDungeon,
  leaveDungeon,
  advanceDungeon,
  enrageMultiplier,
  secondsToEnrage,
  clearedXpBonus,
} from './dungeons'
export type { DungeonDef, BossDef, DungeonStatus, DungeonBlockReason } from './dungeons'
export { simulate, buildSimState, simWeaponItem, totalXpEarned, spreadOf, BALANCE_PRESET } from './simulate'
export type { SimResult, SimBuild, SimOptions, SimWeapon } from './simulate'
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
  SavePayloadV12,
  SavedDungeonRun,
  SavedItem,
  SavedModifier,
  SaveStorage,
  SaveDeps,
  OfflineReport,
  LoadResult,
  LoadErrorReason,
} from './save'
