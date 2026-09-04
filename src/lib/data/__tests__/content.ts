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
  GOLD_SOURCE_SHARE,
  XP_GAP_PENALTY,
  TTK_HARD_CEILING,
  TTK_HARD_FLOOR,
  TTK_TARGET_MAX,
  TTK_TARGET_MIN,
  ARMOR_CURVE,
} from '../balance'
import { ALL_DUNGEONS } from '../dungeons'
import {
  ARMOR_ATTRIBUTES,
  ARMOR_BASE_DEFENSE,
  ARMOR_NOUNS,
  SHIELDS,
  SHIELD_BASE_DEFENSE,
  WEAPONS,
  type ArmorSlot,
} from '../items'
import { armorMods, shieldMods, weaponMods } from '../../game/loot'
import { DROP_CHANCE, SHIELD_SHARE } from '../loot'
import { RARITIES } from '../rarity'
import { SOUNDS } from '../sounds'
import { CLASSES } from '../classes'
import { MATERIALS } from '../materials'
import { HERBS } from '../herbs'
import { DUST_BY_RARITY, ENCHANTS, ENCHANT_FLAT_STATS } from '../enchants'
import { PROCS } from '../procs'
import { BOSS_ABILITIES, HEROIC } from '../heroic'
import { TEMPLES } from '../temple'
import { QUESTS, QUEST_CHAIN } from '../quests'
import { PROGRESSION } from '../progression'
import { REAGENTS } from '../reagents'
import { PROFESSIONS, PROFESSION_UNLOCK_LEVEL, RECIPES } from '../recipes'
import { SLOT_DEFENSE, SLOT_DROP_WEIGHTS, SLOT_ICONS, SLOT_IDS, SLOT_NAMES } from '../slots'
import { BRANCHES, TALENTS } from '../talents'
import { ZONES } from '../zones'
import { STAT_IDS } from '../../game/stats'
import { ICON_NAMES } from '../../ui/icons/manifest'
import type { Decimal } from '../../game/numbers'
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
    // Пороги механик — оттуда же, откуда их берёт сама игра. Механики без
    // кода здесь нет: сверять её ступень не с чем.
    mechanicLevels: {
      talents: TALENT_FIRST_LEVEL,
      crafting: CRAFT_UNLOCK_LEVEL,
      herbalism: PROFESSION_UNLOCK_LEVEL.herbalism,
      enchanting: ENCHANT_UNLOCK_LEVEL,
      'unique-recipes': PROFESSION_UNLOCK_LEVEL.relics,
      temple: TEMPLES[0].unlockRequirement,
      prequests: QUEST_CHAIN.unlockLevel,
      heroic: HEROIC.unlockRequirement,
    },
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
      goldFromMonsters: GOLD_SOURCE_SHARE.monsters,
      goldFromLoot: GOLD_SOURCE_SHARE.loot,
      xpGapPenalty: XP_GAP_PENALTY,
      armorBaseDefense: ARMOR_BASE_DEFENSE.toNumber(),
      shieldBaseDefense: SHIELD_BASE_DEFENSE.toNumber(),
      armorCurveK: ARMOR_CURVE.k,
      armorMaxReduction: ARMOR_CURVE.maxReduction,
    },
    generatedMods: generatedMods(),
  }
}

/**
 * ЧТО ГЕНЕРАТОР КЛАДЁТ НА ВЕЩЬ. Броня не лежит в шаблоне отдельным полем —
 * её кладут `armorMods` и `shieldMods` общей константой, — поэтому проверить
 * «у каждой части брони есть броня» можно только по РЕЗУЛЬТАТУ. Образец
 * берётся белым и первого уровня: там числа мельче всего, и если броня
 * куда-то пропадает, пропадёт она первой именно здесь.
 */
function generatedMods(): Content['generatedMods'] {
  const rarity = RARITIES[0]
  const out: Array<{
    what: string
    wear: 'armor' | 'shield' | 'weapon' | 'trinket'
    mods: ReadonlyArray<{ stat: string; kind: string; value: number }>
  }> = []
  const plain = (mods: ReadonlyArray<{ stat: string; kind: string; value: Decimal }>) =>
    mods.map((m) => ({ stat: m.stat as string, kind: m.kind as string, value: m.value.toNumber() }))
  for (const slot of SLOT_IDS) {
    if (slot === 'mainHand' || slot === 'offHand') continue
    // ВИД НОШЕНИЯ БЕРЁТСЯ ИЗ ДАННЫХ, а не из имени слота: `SLOT_DEFENSE`
    // говорит, часть это брони или украшение, и проверка спрашивает ровно
    // то же, что спрашивает генератор.
    const wear = SLOT_DEFENSE[slot] ? ('armor' as const) : ('trinket' as const)
    for (const primary of ARMOR_ATTRIBUTES) {
      out.push({
        what: `${wear === 'armor' ? 'броня' : 'украшение'} ${slot} (${primary})`,
        wear,
        mods: plain(armorMods(slot as ArmorSlot, rarity, 1, primary)),
      })
    }
  }
  for (const shield of SHIELDS) {
    out.push({ what: `щит ${shield.id}`, wear: 'shield', mods: plain(shieldMods(shield, rarity, 1)) })
  }
  for (const weapon of WEAPONS) {
    out.push({
      what: `оружие ${weapon.id}`,
      wear: 'weapon',
      mods: plain(weaponMods(weapon, rarity, 'mainHand', 1)),
    })
  }
  return out
}
