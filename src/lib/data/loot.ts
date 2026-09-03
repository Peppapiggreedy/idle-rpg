// Шаблоны генерации предметов. Все названия оригинальные; существительные
// нарочно мужского рода, чтобы прилагательные согласовывались без склонений.
import { Decimal } from '../game/numbers'
import { GOLD_SOURCE_SHARE } from './balance'
import { AVERAGE_ROLE_GOLD_MULT, MONSTER_BASE, rewardScale } from './monsters'
import { EXPECTED_SELL_MULT, RARITY_BY_ID } from './rarity'
import { zoneForMonsterLevel } from './zones'
import type { Rarity } from '../types'

export const LOOT_ADJECTIVES = [
  'Щербатый',
  'Ржавый',
  'Пастуший',
  'Закалённый',
  'Гремящий',
  'Сумрачный',
  'Звёздный',
  'Верный',
] as const

// Имя для предмета из сейва с испорченным полем name.
export const FALLBACK_ITEM_NAME = 'Безымянный трофей'

// Шанс, что с убитого моба выпадет предмет.
export const DROP_CHANCE = 0.25
/**
 * Какая доля находок в ЛЕВУЮ руку — щиты, а не вторые клинки.
 *
 * Число балансное, поэтому живёт здесь, а не в game/loot.ts, где оно стояло
 * раньше: «щитов должно падать меньше» — правка контента, и требовать ради
 * неё изменения логики значит ломать правило «контент добавляется данными».
 * Диапазон стережёт content:check.
 */
export const SHIELD_SHARE = 0.4
/**
 * ЦЕНА НАХОДКИ РАСТЁТ ОТ ЕЁ УРОВНЯ, А НЕ ТОЛЬКО ОТ ТИРА.
 *
 * Раньше здесь стояло одно число (5) и вся цена была `5 × sellMult`: сумка,
 * набитая на сотом уровне, продавалась по цене сумки с первого. Отсюда и
 * замер «находки дают 0-1 % золота» — при том, что добыча занимает половину
 * игры.
 *
 * КРИВАЯ БЕРЁТСЯ ТА ЖЕ, ЧТО У НАГРАД МОБА, а не своя: `rewardScale` по
 * уровню плюс множитель зоны. Своя кривая означала бы вторую модель дохода,
 * и они разъехались бы на первой же правке — ровно так, как это уже было
 * с ценой продажи, не знавшей об уровне вовсе.
 *
 * БАЗА НЕ ВЫБРАНА, А ПОСЧИТАНА, и это главное в формуле. Доля крана,
 * отданная находкам (`GOLD_SOURCE_SHARE.loot`), делится на то, как часто
 * находка вообще падает (`DROP_CHANCE`), и на средний множитель тира
 * (`EXPECTED_SELL_MULT`): столько должна стоить СРЕДНЯЯ находка, чтобы за час
 * она принесла свою долю. Общий кран при этом не двигается — вторую долю
 * (`GOLD_SOURCE_SHARE.monsters`) забирает себе моб, и обе делят одно и то же
 * `MONSTER_BASE.goldReward`.
 */
export const ITEM_SELL_BASE: Decimal = MONSTER_BASE.goldReward
  .times(AVERAGE_ROLE_GOLD_MULT)
  .times(GOLD_SOURCE_SHARE.loot)
  .div(DROP_CHANCE)
  .div(EXPECTED_SELL_MULT)

/** Цена находки такого уровня и тира. Уровень — уровень ВЕЩИ, не героя. */
export function itemSellPrice(level: number, rarity: Rarity): Decimal {
  const zone = zoneForMonsterLevel(level)
  const scale = rewardScale(level).times(zone ? zone.rewardMultiplier : 1)
  return ITEM_SELL_BASE.times(scale).times(RARITY_BY_ID[rarity].sellMult).ceil()
}

/**
 * Средняя цена находки этого уровня — по рулетке тиров. Нужна модели дохода:
 * «сколько платит час добычи» считается по средней находке, а не по обычной.
 */
export function averageItemSellPrice(level: number): Decimal {
  const zone = zoneForMonsterLevel(level)
  const scale = rewardScale(level).times(zone ? zone.rewardMultiplier : 1)
  return ITEM_SELL_BASE.times(scale).times(EXPECTED_SELL_MULT)
}
