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
export { xpToNextLevel, applyXp, MAX_LEVELUPS_PER_CALL } from './formulas'
export type { XpResult } from './formulas'
export { rollRarity, rollLoot, rollSlot, sellItem, sellPrice, INVENTORY_SIZE } from './loot'
export {
  equipItem,
  unequipItem,
  isEquipped,
  isUpgrade,
  upgradeShare,
  compareItem,
  farmRateWith,
  equipStatus,
  unequipStatus,
} from './equipment'
export type {
  EquipPreview,
  EquipComparison,
  EquipStatus,
  EquipBlockReason,
  UnequipStatus,
  UnequipBlockReason,
} from './equipment'
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
  estimateTtk,
  estimateZoneTtk,
  rollSwing,
  rollMonsterDamage,
  swingDamageRange,
  expectedSwingDamage,
  expectedAbilityDamage,
  attackPowerContribution,
  critFactor,
} from './combat'
export type { CombatRate, SwingResult, TtkEstimate } from './combat'
export {
  zoneById,
  currentZone,
  isZoneUnlocked,
  forecastZone,
  forecastAllZones,
  travelStatus,
  travelToZone,
  retreatZone,
  reviveInZone,
  stateInZone,
  intendedZone,
  zoneStanding,
} from './zones'
export type { ZoneForecast, ZoneVerdict, ZoneStanding, TravelBlockReason, TravelStatus } from './zones'
export {
  ABILITIES,
  ABILITY_BY_ID,
  abilityStatus,
  allAbilityStatuses,
  cooldownLeft,
  useAbility,
  consumeQueuedAbility,
  queuedAbilityDropReason,
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
  heroBranches,
  heroTalents,
  rankOf,
  talentStatus,
  allTalentStatuses,
  investTalent,
  resetTalents,
  resetCost,
  resetStatus,
  canResetTalents,
  talentModifiers,
  talentFlags,
  hasTalentFlag,
  reviveMultiplier,
} from './talents'
export type { TalentStatus, TalentBlockReason, TalentRanks, ResetStatus, ResetBlockReason } from './talents'
export {
  TEMPLES,
  TEMPLE_BY_ID,
  activeTemple,
  enterTemple,
  leaveTemple,
  templeById,
  templeStatus,
  TEMPLE,
  recipeUnlocked,
  recipeUnlockWave,
} from './temple'
export type { TempleDef, TempleMilestone, TempleStatus, TempleBlockReason } from './temple'
export {
  QUEST_CHAIN,
  activeQuest,
  advanceQuests,
  chainComplete,
  chainUnlocked,
  goalTarget,
  isQuestDone,
  progressionGateOpen,
  questReward,
  questStatuses,
} from './quests'
export type { QuestDef, QuestGoal, QuestReward, QuestStatus } from './quests'
export {
  potionSlots,
  potionStatus,
  potionCount,
  activePotion,
  potionFraction,
  plannedPotion,
  potionSupply,
  drinkPotion,
  advancePotions,
  gatherHerbs,
  statsWithoutPotions,
  statsWithPotionPlan,
} from './potions'
export type { PotionSlot, PotionBlockReason, PotionSupply } from './potions'
export {
  isEnchantingUnlocked,
  dustValue,
  disenchantStatus,
  disenchantItem,
  enchantStatus,
  enchantItem,
  ENCHANTS,
  ENCHANT_BY_ID,
  enchantsForSlot,
  enchantOf,
  enchantModifiers,
} from './enchanting'
export type {
  EnchantDef,
  EnchantStatus,
  EnchantBlockReason,
  DisenchantStatus,
  DisenchantBlockReason,
} from './enchanting'
export {
  DUNGEONS,
  DUNGEON_BY_ID,
  dungeonById,
  activeDungeon,
  currentBoss,
  dungeonStatus,
  allDungeonStatuses,
  bossDispel,
  bossFrenzyActive,
  bossSwingTime,
  currentBossAbility,
  clearKey,
  dungeonView,
  ALL_DUNGEONS,
  HEROIC_DUNGEONS,
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
  clearSave,
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
  SavePayloadV21,
  SavedDungeonRun,
  SavedItem,
  SavedModifier,
  SaveStorage,
  SaveDeps,
  OfflineReport,
  LoadResult,
  LoadErrorReason,
} from './save'
