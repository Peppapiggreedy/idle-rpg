
// ===========================================================================
// Распыление и зачарование. Чистые операции над состоянием; текста для игрока
// здесь нет — наружу идут коды отказа, текст рендерит UI.
import { Decimal } from './numbers'
import { SLOT_IDS, type SlotId } from '../data/slots'
import { DUST_BY_RARITY, ENCHANT_BY_ID, enchantOf, type EnchantDef } from '../data/enchants'
import { ENCHANT_UNLOCK_LEVEL } from '../data/balance'
import { ensureStats } from './stats'
import { pushEvent, type GameState } from './state'
import type { Item } from '../types'

export { ENCHANTS, ENCHANT_BY_ID, enchantsForSlot, enchantOf, enchantModifiers } from '../data/enchants'
export type { EnchantDef } from '../data/enchants'

/** Открыта ли вообще вся система: и распыление, и зачарование. */
export function isEnchantingUnlocked(state: GameState): boolean {
  return state.level.gte(ENCHANT_UNLOCK_LEVEL)
}

/** Сколько пыли даст распыление. Таблица — в данных, формулы здесь нет. */
export function dustValue(item: Item): Decimal {
  return new Decimal(DUST_BY_RARITY[item.rarity] ?? 0)
}

/** Где лежит предмет: в сумке или на герое. Зачаровать можно и то, и другое. */
interface Located {
  item: Item
  equippedSlot: SlotId | null
}

function locate(state: GameState, itemId: string): Located | null {
  const inBag = state.inventory.find((i) => i.id === itemId)
  if (inBag) return { item: inBag, equippedSlot: null }
  for (const slot of SLOT_IDS) {
    const worn = state.equipment[slot]
    if (worn && worn.id === itemId) return { item: worn, equippedSlot: slot }
  }
  return null
}

// ---------------------------------------------------------------------------
// Распыление
// ---------------------------------------------------------------------------

/** Почему предмет не распылить. Каждый случай — свой код. */
export type DisenchantBlockReason = 'locked' | 'missing' | 'equipped'

export interface DisenchantStatus {
  itemId: string
  dust: Decimal
  /** Что будет уничтожено вместе с вещью; null — зачарования на ней нет. */
  destroys: string | null
  canDisenchant: boolean
  reason: DisenchantBlockReason | null
}

export function disenchantStatus(state: GameState, itemId: string): DisenchantStatus {
  const found = locate(state, itemId)
  const dust = found ? dustValue(found.item) : new Decimal(0)
  const destroys = found ? (found.item.enchantId ?? null) : null
  const base = { itemId, dust, destroys }
  const blocked = (reason: DisenchantBlockReason) => ({ ...base, canDisenchant: false, reason })
  // Порядок проверок — от того, что не лечится действием игрока прямо сейчас.
  if (!isEnchantingUnlocked(state)) return blocked('locked')
  if (!found) return blocked('missing')
  // То же правило, что у продажи: надетую вещь сперва снять. Без него
  // распыление стало бы способом раздеться в обход инвентаря.
  if (found.equippedSlot !== null) return blocked('equipped')
  return { ...base, canDisenchant: true, reason: null }
}

/**
 * Распылить предмет: он исчезает, пыль прибавляется. Зачарование на нём
 * гибнет вместе с вещью — отдельного возврата пыли за него НЕТ и быть не
 * должно, иначе цикл «зачаровал — распылил» крутил бы пыль из воздуха.
 */
export function disenchantItem(state: GameState, itemId: string): GameState {
  const status = disenchantStatus(state, itemId)
  if (!status.canDisenchant) return state
  const item = state.inventory.find((i) => i.id === itemId)
  if (!item) return state
  return {
    ...state,
    enchantDust: state.enchantDust.plus(status.dust),
    inventory: state.inventory.filter((i) => i.id !== itemId),
    combatLog: pushEvent(state.combatLog, { type: 'disenchant', item, dust: status.dust }),
  }
}

// ---------------------------------------------------------------------------
// Зачарование
// ---------------------------------------------------------------------------

/** Почему зачарование не наложить. Текст причины рендерит UI. */
export type EnchantBlockReason = 'locked' | 'missing' | 'slot' | 'same' | 'dust'

export interface EnchantStatus {
  itemId: string
  enchantId: string
  dustCost: Decimal
  /** Какое зачарование будет УНИЧТОЖЕНО; null — на предмете чисто.
   *  Именно по этому полю UI решает, спрашивать ли подтверждение. */
  replaces: string | null
  canEnchant: boolean
  reason: EnchantBlockReason | null
}

export function enchantStatus(state: GameState, itemId: string, enchantId: string): EnchantStatus {
  const enchant = ENCHANT_BY_ID[enchantId]
  const found = locate(state, itemId)
  const dustCost = new Decimal(enchant?.dustCost ?? 0)
  const current = found?.item.enchantId ?? null
  const base = {
    itemId,
    enchantId,
    dustCost,
    replaces: current !== null && current !== enchantId ? current : null,
  }
  const blocked = (reason: EnchantBlockReason) => ({ ...base, canEnchant: false, reason })
  if (!isEnchantingUnlocked(state)) return blocked('locked')
  if (!enchant || !found) return blocked('missing')
  if (!enchant.slots.includes(found.item.slot)) return blocked('slot')
  // Повторно то же самое — только сжечь пыль впустую.
  if (current === enchantId) return blocked('same')
  if (state.enchantDust.lt(dustCost)) return blocked('dust')
  return { ...base, canEnchant: true, reason: null }
}

/**
 * Наложить зачарование. Работает и на вещи из сумки, и на надетой: зачарование
 * живёт на предмете, а не на слоте, и заставлять игрока раздеваться ради него
 * незачем. Старое зачарование при этом уничтожается — на предмете ровно одно.
 *
 * Подтверждение спрашивает UI (см. replaces в enchantStatus): логика молча
 * делает то, о чём её попросили.
 */
export function enchantItem(state: GameState, itemId: string, enchantId: string): GameState {
  if (!enchantStatus(state, itemId, enchantId).canEnchant) return state
  const found = locate(state, itemId)
  const enchant = ENCHANT_BY_ID[enchantId]
  if (!found || !enchant) return state
  const enchanted: Item = { ...found.item, enchantId }
  const next: GameState = {
    ...state,
    enchantDust: state.enchantDust.minus(enchant.dustCost),
    inventory: state.inventory.map((i) => (i.id === itemId ? enchanted : i)),
    combatLog: pushEvent(state.combatLog, {
      type: 'enchant',
      itemName: enchanted.name,
      enchantId,
    }),
  }
  if (found.equippedSlot === null) return next
  // Надетая вещь — источник статов: набор модификаторов изменился, значит
  // конвейер обязан пересчитаться. Прогресс замаха трогать не нужно — он
  // хранится долей и переживает смену swingTime сам.
  return ensureStats({
    ...next,
    equipment: { ...next.equipment, [found.equippedSlot]: enchanted },
    statsDirty: true,
  })
}

