// Слепок живого контента для проверки целостности.
//
// Здесь и только здесь проверка касается диска: читает спрайт иконок и список
// файлов в public/models. Сама проверка (schema.ts) остаётся чистой — иначе её
// нельзя было бы прогнать на заведомо битой фикстуре.
import { readFileSync, readdirSync } from 'node:fs'
import { ABILITIES } from '../abilities'
import { MODEL_ASSETS } from '../assets'
import {
  AUTOCAST_MAX_LOSS,
  BASE_STATS,
  OFFLINE_EFFICIENCY,
  TALENT_FIRST_LEVEL,
  TTK_AHEAD_MIN,
  TTK_BEHIND_MAX,
  TTK_DRIFT_MAX,
  TTK_HARD_CEILING,
  TTK_HARD_FLOOR,
  TTK_TARGET_MAX,
  TTK_TARGET_MIN,
  ZONE_AHEAD_GAP,
  ZONE_BEHIND_GAP,
} from '../balance'
import { DUNGEONS } from '../dungeons'
import { ARMOR_NOUNS, SHIELDS, WEAPONS } from '../items'
import { DROP_CHANCE } from '../loot'
import { RARITIES } from '../rarity'
import { SLOT_DROP_WEIGHTS, SLOT_ICONS, SLOT_IDS, SLOT_NAMES } from '../slots'
import { BRANCHES, TALENTS } from '../talents'
import { UPGRADES } from '../upgrades'
import { ZONES } from '../zones'
import { STAT_IDS } from '../../game/stats'
import { ICON_NAMES } from '../../ui/icons/manifest'
import type { Content } from './schema'

const SPRITE = new URL('../../ui/icons/sprite.svg', import.meta.url)
const MODELS_DIR = new URL('../../../../public/models/', import.meta.url)

/** Имена иконок, у которых в спрайте реально есть symbol. */
function spriteIconNames(): string[] {
  const svg = readFileSync(SPRITE, 'utf8')
  return [...svg.matchAll(/id="icon-([\w-]+)"/g)].map((m) => m[1])
}

/** Что лежит в public/models — по этому списку проверяются пути ассетов. */
function modelFiles(): string[] {
  return readdirSync(MODELS_DIR)
}

/** Живой контент игры целиком. */
export function realContent(): Content {
  return {
    abilities: ABILITIES,
    branches: BRANCHES,
    talents: TALENTS,
    zones: ZONES,
    dungeons: DUNGEONS,
    weapons: WEAPONS,
    shields: SHIELDS,
    rarities: RARITIES,
    upgrades: UPGRADES,
    models: MODEL_ASSETS,
    slots: SLOT_IDS,
    slotNames: SLOT_NAMES,
    slotIcons: SLOT_ICONS,
    slotDropWeights: SLOT_DROP_WEIGHTS,
    armorNouns: ARMOR_NOUNS,
    statIds: STAT_IDS,
    iconNames: ICON_NAMES,
    spriteIconNames: spriteIconNames(),
    modelFiles: modelFiles(),
    balance: {
      dropChance: DROP_CHANCE,
      baseCritChance: BASE_STATS.critChance.toNumber(),
      baseDamageReduction: BASE_STATS.damageReduction.toNumber(),
      offlineEfficiency: OFFLINE_EFFICIENCY,
      autocastMaxLoss: AUTOCAST_MAX_LOSS,
      talentFirstLevel: TALENT_FIRST_LEVEL,
      ttkHardFloor: TTK_HARD_FLOOR,
      ttkTargetMin: TTK_TARGET_MIN,
      ttkTargetMax: TTK_TARGET_MAX,
      ttkHardCeiling: TTK_HARD_CEILING,
      ttkBehindMax: TTK_BEHIND_MAX,
      ttkAheadMin: TTK_AHEAD_MIN,
      ttkDriftMax: TTK_DRIFT_MAX,
      zoneBehindGap: ZONE_BEHIND_GAP,
      zoneAheadGap: ZONE_AHEAD_GAP,
    },
  }
}
