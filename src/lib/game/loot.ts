// Генерация и продажа лута. Случайность приходит снаружи (rng),
// поэтому вся логика детерминированно тестируется.
import { Decimal } from './numbers'
import type { Rng } from './rng'
import type { GameState } from './state'
import type { Item } from '../types'
import { RARITIES, RARITY_BY_ID, type RarityDef } from '../data/rarity'
import {
  DROP_CHANCE,
  ITEM_BASE_BONUS,
  ITEM_BASE_SELL_PRICE,
  LOOT_ADJECTIVES,
  LOOT_NOUNS,
} from '../data/loot'

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

// Бросок дропа с убитого моба: null — не повезло. itemSeq нумерует id предметов.
export function rollLoot(rng: Rng, itemSeq: number): Item | null {
  if (rng() >= DROP_CHANCE) return null
  const rarity = rollRarity(rng)
  const name = `${pick(LOOT_ADJECTIVES, rng)} ${pick(LOOT_NOUNS, rng)}`
  return {
    id: `item-${itemSeq}`,
    name,
    rarity: rarity.id,
    statBonus: ITEM_BASE_BONUS.times(rarity.bonusMult),
  }
}

export function sellPrice(item: Item): Decimal {
  return ITEM_BASE_SELL_PRICE.times(RARITY_BY_ID[item.rarity].sellMult)
}

// Продажа предмета: золото по цене тира, предмет исчезает из инвентаря.
export function sellItem(state: GameState, itemId: string): GameState {
  const item = state.inventory.find((i) => i.id === itemId)
  if (!item) return state
  return {
    ...state,
    gold: state.gold.plus(sellPrice(item)),
    inventory: state.inventory.filter((i) => i.id !== itemId),
  }
}
