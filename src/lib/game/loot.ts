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
  WEAPONS,
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

// Оружие: три модификатора kind 'base' задают БАЗУ боя (скорость и диапазон
// урона), побочные статы идут обычными модификаторами. Снятое оружие перестаёт
// давать base — значения возвращаются к UNARMED из data/balance.ts.
export function weaponMods(template: WeaponTemplate, rarity: RarityDef): StatModifier[] {
  const source = 'equipment:weapon'
  return [
    { stat: 'weaponSpeed', kind: 'base', value: template.weaponSpeed, source },
    { stat: 'weaponDamageMin', kind: 'base', value: template.damageMin.times(rarity.bonusMult), source },
    { stat: 'weaponDamageMax', kind: 'base', value: template.damageMax.times(rarity.bonusMult), source },
    ...template.extra.map((mod) => ({ ...mod, source })),
  ]
}

// Экспортируется ради эталонных сборок прогона баланса: «средняя броня»
// обязана строиться теми же правилами, что и выпавшая, иначе прогон мерил бы
// не ту игру.
export function armorMods(slot: Exclude<SlotId, 'weapon'>, rarity: RarityDef): StatModifier[] {
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
  if (slot === 'weapon') {
    const template = pick(WEAPONS, rng)
    return {
      id: `item-${itemSeq}`,
      name: `${adjective} ${template.noun}`,
      rarity: rarity.id,
      slot,
      mods: weaponMods(template, rarity),
    }
  }
  return {
    id: `item-${itemSeq}`,
    name: `${adjective} ${pick(ARMOR_NOUNS[slot], rng)}`,
    rarity: rarity.id,
    slot,
    mods: armorMods(slot, rarity),
  }
}

// Лут босса: слоты заданы данными, а редкость — обычная рулетка, но не ниже
// порога босса. Отсюда и растущее качество по цепочке: порог поднимается.
export function rollBossLoot(loot: BossLoot, rng: Rng, itemSeq: number): Item[] {
  const floor = RARITIES.findIndex((r) => r.id === loot.minRarity)
  return loot.slots.map((slot, index) => {
    const rolled = rollRarity(rng)
    const rolledIndex = RARITIES.findIndex((r) => r.id === rolled.id)
    const rarity = RARITIES[Math.max(rolledIndex, floor)]
    const adjective = pick(LOOT_ADJECTIVES, rng)
    if (slot === 'weapon') {
      const template = pick(WEAPONS, rng)
      return {
        id: `item-${itemSeq + index}`,
        name: `${adjective} ${template.noun}`,
        rarity: rarity.id,
        slot,
        mods: weaponMods(template, rarity),
      }
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
