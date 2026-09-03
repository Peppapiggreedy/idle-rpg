// Слепок живого контента для проверки целостности.
//
// Здесь и только здесь проверка касается диска: читает спрайт иконок и списки
// файлов в public/sprites и public/audio. Сама проверка (schema.ts) остаётся чистой — иначе её
// нельзя было бы прогнать на заведомо битой фикстуре.
import { readFileSync, readdirSync } from 'node:fs'
import { ABILITIES } from '../abilities'
import { BACKGROUND_BANDS, HERO_SPRITE, MONSTER_SPRITES, MONSTER_SPRITE_BY_ARCHETYPE } from '../sprites'
import {
  AUTOCAST_MAX_LOSS,
  BASE_STATS,
  OFFLINE_EFFICIENCY,
  ENCHANT_UNLOCK_LEVEL,
  LEVEL_CAP,
  POTION_UNLOCK_LEVEL,
  CRAFT_UNLOCK_LEVEL,
  TALENT_FIRST_LEVEL,
  TTK_AHEAD_MIN,
  TTK_BEHIND_MAX,
  TTK_DRIFT_MAX,
  XP_GAP_PENALTY,
  TTK_HARD_CEILING,
  TTK_HARD_FLOOR,
  TTK_TARGET_MAX,
  TTK_TARGET_MIN,
} from '../balance'
import { ALL_DUNGEONS } from '../dungeons'
import { ARMOR_NOUNS, SHIELDS, WEAPONS } from '../items'
import { DROP_CHANCE, SHIELD_SHARE } from '../loot'
import { RARITIES } from '../rarity'
import { SOUNDS } from '../sounds'
import { CLASSES } from '../classes'
import { MATERIALS } from '../materials'
import { HERBS } from '../herbs'
import { DUST_BY_RARITY, ENCHANTS, ENCHANT_FLAT_STATS } from '../enchants'
import { PROCS } from '../procs'
import { BOSS_ABILITIES } from '../heroic'
import { TEMPLES } from '../temple'
import { QUESTS, QUEST_CHAIN } from '../quests'
import { PROGRESSION } from '../progression'
import { REAGENTS } from '../reagents'
import { PROFESSIONS, RECIPES } from '../recipes'
import { SLOT_DROP_WEIGHTS, SLOT_ICONS, SLOT_IDS, SLOT_NAMES } from '../slots'
import { BRANCHES, TALENTS } from '../talents'
import { ZONES } from '../zones'
import { STAT_IDS } from '../../game/stats'
import { ICON_NAMES } from '../../ui/icons/manifest'
import type { Content } from './schema'

const SPRITE = new URL('../../ui/icons/sprite.svg', import.meta.url)
const AUDIO_DIR = new URL('../../../../public/audio/', import.meta.url)
const SPRITES_DIR = new URL('../../../../public/sprites/', import.meta.url)

/** Имена иконок, у которых в спрайте реально есть symbol. */
function spriteIconNames(): string[] {
  const svg = readFileSync(SPRITE, 'utf8')
  return [...svg.matchAll(/id="icon-([\w-]+)"/g)].map((m) => m[1])
}

/**
 * Что лежит в public/audio — пути в реестре звуков сверяются с ним.
 * Раскладка ровно двухуровневая (`audio/<пак>/<файл>`), поэтому обход
 * тоже двухуровневый: рекурсия здесь была бы сложнее самой задачи.
 */
function audioFiles(): string[] {
  const files: string[] = []
  for (const entry of readdirSync(AUDIO_DIR)) {
    try {
      for (const file of readdirSync(new URL(`${entry}/`, AUDIO_DIR))) {
        files.push(`audio/${entry}/${file}`)
      }
    } catch {
      // Не каталог, а файл рядом (тексты лицензий) — в реестр они не входят.
      files.push(`audio/${entry}`)
    }
  }
  return files
}

/** Живой контент игры целиком. */
export function realContent(): Content {
  return {
    abilities: ABILITIES,
    branches: BRANCHES,
    talents: TALENTS,
    zones: ZONES,
    // Обе лестницы: героика — тот же шаблон, и её реагенты, лут и уровни
    // проверяются теми же схемами, а не отдельным списком.
    dungeons: ALL_DUNGEONS,
    weapons: WEAPONS,
    shields: SHIELDS,
    rarities: RARITIES,
    sprites: [HERO_SPRITE, ...MONSTER_SPRITES],
    backgrounds: BACKGROUND_BANDS,
    spriteByArchetype: MONSTER_SPRITE_BY_ARCHETYPE,
    spriteFiles: readdirSync(SPRITES_DIR),
    slots: SLOT_IDS,
    slotNames: SLOT_NAMES,
    slotIcons: SLOT_ICONS,
    slotDropWeights: SLOT_DROP_WEIGHTS,
    armorNouns: ARMOR_NOUNS,
    statIds: STAT_IDS,
    iconNames: ICON_NAMES,
    spriteIconNames: spriteIconNames(),
    sounds: SOUNDS,
    classes: CLASSES,
    materials: MATERIALS,
    herbs: HERBS,
    enchants: ENCHANTS,
    procs: PROCS,
    bossAbilities: BOSS_ABILITIES,
    temples: TEMPLES,
    quests: QUESTS,
    dustByRarity: DUST_BY_RARITY,
    enchantFlatStats: ENCHANT_FLAT_STATS,
    progression: PROGRESSION,
    reagents: REAGENTS,
    recipes: RECIPES,
    professions: PROFESSIONS,
    audioFiles: audioFiles(),
    questChainUnlockLevel: QUEST_CHAIN.unlockLevel,
    balance: {
      dropChance: DROP_CHANCE,
      shieldShare: SHIELD_SHARE,
      baseCritChance: BASE_STATS.critChance.toNumber(),
      baseDamageReduction: BASE_STATS.damageReduction.toNumber(),
      offlineEfficiency: OFFLINE_EFFICIENCY,
      autocastMaxLoss: AUTOCAST_MAX_LOSS,
      talentFirstLevel: TALENT_FIRST_LEVEL,
      enchantUnlockLevel: ENCHANT_UNLOCK_LEVEL,
      potionUnlockLevel: POTION_UNLOCK_LEVEL,
      craftUnlockLevel: CRAFT_UNLOCK_LEVEL,
      levelCap: LEVEL_CAP,
      ttkHardFloor: TTK_HARD_FLOOR,
      ttkTargetMin: TTK_TARGET_MIN,
      ttkTargetMax: TTK_TARGET_MAX,
      ttkHardCeiling: TTK_HARD_CEILING,
      ttkBehindMax: TTK_BEHIND_MAX,
      ttkAheadMin: TTK_AHEAD_MIN,
      ttkDriftMax: TTK_DRIFT_MAX,
      xpGapPenalty: XP_GAP_PENALTY,
    },
  }
}
