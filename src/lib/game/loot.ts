// Генерация и продажа лута. Случайность приходит снаружи (rng),
// поэтому вся логика детерминированно тестируется.
import { Decimal } from './numbers'
import type { Rng } from './rng'
import type { GameState } from './state'
import type { Item } from '../types'
import { RARITIES, RARITY_BY_ID, type RarityDef } from '../data/rarity'
import { DROP_CHANCE, ITEM_BASE_SELL_PRICE, LOOT_ADJECTIVES } from '../data/loot'
import { SLOT_DROP_WEIGHTS, SLOT_IDS, type SlotId } from '../data/slots'
import {
  ARMOR_BASE_ATTACK_POWER,
  ARMOR_BASE_MAX_HP,
  ARMOR_NOUNS,
  ONE_HANDED,
  SHIELDS,
  WEAPONS,
  type ShieldTemplate,
  type WeaponTemplate,
} from '../data/items'
import type { StatModifier } from './stats'
import { isEquipped } from './equipment'
import type { BossLoot } from '../data/dungeons'

// Реэкспорт для обратной совместимости импортов.
export { INVENTORY_SIZE } from '../data/balance'
export type { Rng } from './rng'

// Взвешенная рулетка: чем больше weight тира, тем шире его отрезок на [0, 1).
export function rollRarity(rng: Rng): RarityDef {
  const total = RARITIES.reduce((sum, r) => sum + r.weight, 0)
  let roll = rng() * total
  for (const rarity of RARITIES) {
    roll -= rarity.weight
    if (roll < 0) return rarity
  }
  return RARITIES[RARITIES.length - 1]
}

function pick<T>(list: readonly T[], rng: Rng): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
}

// Взвешенный выбор слота: оружие падает реже брони.
export function rollSlot(rng: Rng): SlotId {
  const total = SLOT_IDS.reduce((sum, slot) => sum + SLOT_DROP_WEIGHTS[slot], 0)
  let roll = rng() * total
  for (const slot of SLOT_IDS) {
    roll -= SLOT_DROP_WEIGHTS[slot]
    if (roll < 0) return slot
  }
  return SLOT_IDS[SLOT_IDS.length - 1]
}

/**
 * Оружие: три модификатора kind 'base' задают БАЗУ боя (скорость и диапазон
 * урона), побочные статы идут обычными модификаторами. Снятое оружие перестаёт
 * давать base — значения возвращаются к UNARMED из data/balance.ts.
 *
 * У левой руки СВОЯ тройка статов: базы у рук разные, иначе второе оружие
 * подменяло бы базу первого, и дуалвилд считался бы одним замахом.
 */
export function weaponMods(
  template: WeaponTemplate,
  rarity: RarityDef,
  slot: 'mainHand' | 'offHand' = 'mainHand',
): StatModifier[] {
  const source = `equipment:${slot}`
  const off = slot === 'offHand'
  return [
    { stat: off ? 'offhandSpeed' : 'weaponSpeed', kind: 'base', value: template.weaponSpeed, source },
    {
      stat: off ? 'offhandDamageMin' : 'weaponDamageMin',
      kind: 'base',
      value: template.damageMin.times(rarity.bonusMult),
      source,
    },
    {
      stat: off ? 'offhandDamageMax' : 'weaponDamageMax',
      kind: 'base',
      value: template.damageMax.times(rarity.bonusMult),
      source,
    },
    ...template.extra.map((mod) => ({ ...mod, source })),
  ]
}

/** Щит: урона не даёт, зато даёт блок. Тоже через конвейер, без исключений. */
export function shieldMods(template: ShieldTemplate, rarity: RarityDef): StatModifier[] {
  const source = 'equipment:offHand'
  return [
    { stat: 'blockChance', kind: 'base', value: template.blockChance, source },
    { stat: 'blockValue', kind: 'base', value: template.blockValue.times(rarity.bonusMult), source },
    ...template.extra.map((mod) => ({ ...mod, source })),
  ]
}

// Экспортируется ради эталонных сборок прогона баланса: «средняя броня»
// обязана строиться теми же правилами, что и выпавшая, иначе прогон мерил бы
// не ту игру.
export function armorMods(
  slot: Exclude<SlotId, 'mainHand' | 'offHand'>,
  rarity: RarityDef,
): StatModifier[] {
  const source = `equipment:${slot}`
  return [
    { stat: 'attackPower', kind: 'flat', value: ARMOR_BASE_ATTACK_POWER.times(rarity.bonusMult), source },
    { stat: 'maxHp', kind: 'flat', value: ARMOR_BASE_MAX_HP.times(rarity.bonusMult), source },
  ]
}

// Бросок дропа с убитого моба: null — не повезло. itemSeq нумерует id предметов.
// Порядок бросков фиксирован: шанс -> редкость -> слот -> прилагательное ->
// существительное (у оружия — модель).
export function rollLoot(rng: Rng, itemSeq: number): Item | null {
  if (rng() >= DROP_CHANCE) return null
  const rarity = rollRarity(rng)
  const slot = rollSlot(rng)
  const adjective = pick(LOOT_ADJECTIVES, rng)
  if (slot === 'mainHand' || slot === 'offHand') return handItem(slot, rarity, adjective, rng, itemSeq)
  return {
    id: `item-${itemSeq}`,
    name: `${adjective} ${pick(ARMOR_NOUNS[slot], rng)}`,
    rarity: rarity.id,
    slot,
    mods: armorMods(slot, rarity),
  }
}

/**
 * Предмет в руку. В правую падает любое оружие, в левую — одноручное или щит:
 * порядок бросков фиксирован (сперва «щит или оружие», потом сам образец),
 * иначе прогоны перестанут воспроизводиться.
 */
function handItem(
  slot: 'mainHand' | 'offHand',
  rarity: RarityDef,
  adjective: string,
  rng: Rng,
  itemSeq: number,
): Item {
  const shield = slot === 'offHand' && rng() < SHIELD_SHARE
  if (shield) {
    const template = pick(SHIELDS, rng)
    return {
      id: `item-${itemSeq}`,
      name: `${adjective} ${template.noun}`,
      rarity: rarity.id,
      slot,
      mods: shieldMods(template, rarity),
    }
  }
  const template = pick(slot === 'offHand' ? ONE_HANDED : WEAPONS, rng)
  return {
    id: `item-${itemSeq}`,
    name: `${adjective} ${template.noun}`,
    rarity: rarity.id,
    slot,
    hands: template.hands,
    mods: weaponMods(template, rarity, slot),
  }
}

/** Какая доля находок в левую руку — щиты, а не вторые клинки. */
const SHIELD_SHARE = 0.4

// Лут босса: слоты заданы данными, а редкость — обычная рулетка, но не ниже
// порога босса. Отсюда и растущее качество по цепочке: порог поднимается.
export function rollBossLoot(loot: BossLoot, rng: Rng, itemSeq: number): Item[] {
  const floor = RARITIES.findIndex((r) => r.id === loot.minRarity)
  return loot.slots.map((slot, index) => {
    const rolled = rollRarity(rng)
    const rolledIndex = RARITIES.findIndex((r) => r.id === rolled.id)
    const rarity = RARITIES[Math.max(rolledIndex, floor)]
    const adjective = pick(LOOT_ADJECTIVES, rng)
    if (slot === 'mainHand' || slot === 'offHand') {
      return handItem(slot, rarity, adjective, rng, itemSeq + index)
    }
    return {
      id: `item-${itemSeq + index}`,
      name: `${adjective} ${pick(ARMOR_NOUNS[slot], rng)}`,
      rarity: rarity.id,
      slot,
      mods: armorMods(slot, rarity),
    }
  })
}

export function sellPrice(item: Item): Decimal {
  return ITEM_BASE_SELL_PRICE.times(RARITY_BY_ID[item.rarity].sellMult)
}

// Продажа предмета: золото по цене тира, предмет исчезает из инвентаря.
// Надетый предмет продать нельзя — сперва снять (его нет в инвентаре, плюс
// явная проверка на случай рассинхронизации).
export function sellItem(state: GameState, itemId: string): GameState {
  if (isEquipped(state, itemId)) return state
  const item = state.inventory.find((i) => i.id === itemId)
  if (!item) return state
  return {
    ...state,
    gold: state.gold.plus(sellPrice(item)),
    inventory: state.inventory.filter((i) => i.id !== itemId),
  }
}
