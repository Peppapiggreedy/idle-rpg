// Генерация и продажа лута. Случайность приходит снаружи (rng),
// поэтому вся логика детерминированно тестируется.
import { Decimal } from './numbers'
import type { Rng } from './rng'
import { pushEvent, type GameState } from './state'
import type { Item } from '../types'
import { RARITIES, RARITY_BY_ID, type RarityDef } from '../data/rarity'
import { DROP_CHANCE, ITEM_BASE_SELL_PRICE, LOOT_ADJECTIVES, SHIELD_SHARE } from '../data/loot'
import { SLOT_DROP_WEIGHTS, SLOT_IDS, type SlotId } from '../data/slots'
import {
  ARMOR_ATTRIBUTES,
  ARMOR_BASE_PRIMARY,
  ARMOR_BASE_VITALITY,
  ARMOR_BONUS_STAT,
  ARMOR_NOUNS,
  ONE_HANDED,
  SHIELDS,
  WEAPONS,
  type ArmorSlot,
  type AttributeId,
  type ShieldTemplate,
  type WeaponTemplate,
} from '../data/items'
import { INVENTORY_SIZE, itemLevelScale } from '../data/balance'
import type { StatModifier } from './stats'
import { isEquipped, upgradeShare } from './equipment'
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
  level = 1,
): StatModifier[] {
  const source = `equipment:${slot}`
  const off = slot === 'offHand'
  // Уровень и тир множат СИЛУ предмета (урон и плоские атрибуты), но не
  // скорость: темп боя — свойство образца оружия, а не его свежести.
  const power = itemLevelScale(level).times(rarity.bonusMult)
  return [
    { stat: off ? 'offhandSpeed' : 'weaponSpeed', kind: 'base', value: template.weaponSpeed, source },
    {
      stat: off ? 'offhandDamageMin' : 'weaponDamageMin',
      kind: 'base',
      value: template.damageMin.times(power),
      source,
    },
    {
      stat: off ? 'offhandDamageMax' : 'weaponDamageMax',
      kind: 'base',
      value: template.damageMax.times(power),
      source,
    },
    ...template.extra.map((mod) => ({
      ...mod,
      value: mod.kind === 'flat' ? mod.value.times(power) : mod.value,
      source,
    })),
  ]
}

/** Щит: урона не даёт, зато даёт блок. Тоже через конвейер, без исключений. */
export function shieldMods(template: ShieldTemplate, rarity: RarityDef, level = 1): StatModifier[] {
  const source = 'equipment:offHand'
  // Шанс блока не растёт: вероятность — не сила. Растёт то, СКОЛЬКО блок
  // снимает, и атрибуты.
  const power = itemLevelScale(level).times(rarity.bonusMult)
  return [
    { stat: 'blockChance', kind: 'base', value: template.blockChance, source },
    { stat: 'blockValue', kind: 'base', value: template.blockValue.times(power), source },
    ...template.extra.map((mod) => ({
      ...mod,
      value: mod.kind === 'flat' ? mod.value.times(power) : mod.value,
      source,
    })),
  ]
}

// Главный атрибут приходит ПАРАМЕТРОМ: дроп его разыгрывает, крафт берёт из
// данных рецепта. Внутри armorMods случайности нет — функция детерминирована
// и одинакова для всех путей появления предмета.
export function armorMods(
  slot: ArmorSlot,
  rarity: RarityDef,
  level: number,
  primary: AttributeId,
): StatModifier[] {
  const source = `equipment:${slot}`
  const power = itemLevelScale(level).times(rarity.bonusMult)
  // Главный атрибут и общий довесок СЛИВАЮТСЯ, когда это один и тот же стат:
  // две записи об одном стате читались бы в карточке как «+12 живучести,
  // +4 живучести». Слияние идёт по совпадению стата, а какой стат довеском —
  // сказано в данных (ARMOR_BONUS_STAT). Раньше здесь стояло имя «vitality»
  // прямо в условии, и пятый атрибут молча вернул бы двойную строку.
  // БЮДЖЕТЫ СКЛАДЫВАЮТСЯ ДО умножения на power, а не после: иначе у
  // совпавшего стата получилось бы `4*p + 2*p` вместо `(4+2)*p`, и значение
  // разошлось бы с прежним в последних знаках — то есть поехали бы сейвы и
  // эталоны, хотя игра не изменилась.
  const budget = new Map<AttributeId, Decimal>()
  const add = (stat: AttributeId, value: Decimal) =>
    budget.set(stat, (budget.get(stat) ?? new Decimal(0)).plus(value))
  add(primary, ARMOR_BASE_PRIMARY)
  add(ARMOR_BONUS_STAT, ARMOR_BASE_VITALITY)
  return [...budget].map(([stat, value]) => ({
    stat,
    kind: 'flat' as const,
    value: value.times(power),
    source,
  }))
}

/**
 * Средняя броня для эталонных сборок прогона баланса: матожидание случайного
 * главного атрибута — четверть бюджета в каждый из четырёх. Строится теми же
 * константами, что и настоящий дроп, иначе прогон мерил бы не ту игру.
 */
export function averageArmorMods(slot: ArmorSlot, rarity: RarityDef, level = 1): StatModifier[] {
  const source = `equipment:${slot}`
  const power = itemLevelScale(level).times(rarity.bonusMult)
  const share = ARMOR_BASE_PRIMARY.div(ARMOR_ATTRIBUTES.length)
  // Довесок прибавляется тому стату, который назван довеском В ДАННЫХ, —
  // ровно как в armorMods выше, и по тому же признаку совпадения.
  return ARMOR_ATTRIBUTES.map((attr) => ({
    stat: attr,
    kind: 'flat' as const,
    value: (attr === ARMOR_BONUS_STAT ? share.plus(ARMOR_BASE_VITALITY) : share).times(power),
    source,
  }))
}

// Бросок дропа с убитого моба: null — не повезло. itemSeq нумерует id предметов.
// Порядок бросков фиксирован: шанс -> редкость -> слот -> прилагательное ->
// существительное (у оружия — модель) -> главный атрибут брони.
//
// level — УРОВЕНЬ УБИТОГО МОБА: предмет наследует его и растёт от него линейно
// (itemLevelScale). Это двигатель прогрессии: вещи из глубокой зоны сильнее,
// и идти глубже стоит ради самих находок, а не только ради наград.
export function rollLoot(rng: Rng, itemSeq: number, level = 1): Item | null {
  if (rng() >= DROP_CHANCE) return null
  const rarity = rollRarity(rng)
  const slot = rollSlot(rng)
  const adjective = pick(LOOT_ADJECTIVES, rng)
  if (slot === 'mainHand' || slot === 'offHand') {
    return handItem(slot, rarity, adjective, rng, itemSeq, level)
  }
  return armorItem(slot, rarity, adjective, rng, itemSeq, level)
}

/** Броня: имя из существительных слота, главный атрибут — отдельный бросок. */
function armorItem(
  slot: ArmorSlot,
  rarity: RarityDef,
  adjective: string,
  rng: Rng,
  itemSeq: number,
  level: number,
): Item {
  const noun = pick(ARMOR_NOUNS[slot], rng)
  const primary = pick(ARMOR_ATTRIBUTES, rng)
  return {
    id: `item-${itemSeq}`,
    name: `${adjective} ${noun}`,
    rarity: rarity.id,
    slot,
    level,
    mods: armorMods(slot, rarity, level, primary),
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
  level = 1,
): Item {
  const shield = slot === 'offHand' && rng() < SHIELD_SHARE
  if (shield) {
    const template = pick(SHIELDS, rng)
    return {
      id: `item-${itemSeq}`,
      name: `${adjective} ${template.noun}`,
      rarity: rarity.id,
      slot,
      level,
      // Хват берётся ИЗ ШАБЛОНА, а не подставляется здесь: бросок решает,
      // из какого пула образец, а чем этот образец является — сказано
      // в данных. Поэтому щит и падает только щитом.
      grip: template.grip,
      mods: shieldMods(template, rarity, level),
    }
  }
  const template = pick(slot === 'offHand' ? ONE_HANDED : WEAPONS, rng)
  return {
    id: `item-${itemSeq}`,
    name: `${adjective} ${template.noun}`,
    rarity: rarity.id,
    slot,
    level,
    grip: template.grip,
    mods: weaponMods(template, rarity, slot, level),
  }
}

// Лут босса: слоты заданы данными, а редкость — обычная рулетка, но не ниже
// порога босса. Отсюда и растущее качество по цепочке: порог поднимается.
export function rollBossLoot(loot: BossLoot, rng: Rng, itemSeq: number, level = 1): Item[] {
  const floor = RARITIES.findIndex((r) => r.id === loot.minRarity)
  return loot.slots.map((slot, index) => {
    const rolled = rollRarity(rng)
    const rolledIndex = RARITIES.findIndex((r) => r.id === rolled.id)
    const rarity = RARITIES[Math.max(rolledIndex, floor)]
    const adjective = pick(LOOT_ADJECTIVES, rng)
    if (slot === 'mainHand' || slot === 'offHand') {
      return handItem(slot, rarity, adjective, rng, itemSeq + index, level)
    }
    return armorItem(slot, rarity, adjective, rng, itemSeq + index, level)
  })
}

export function sellPrice(item: Item): Decimal {
  return ITEM_BASE_SELL_PRICE.times(RARITY_BY_ID[item.rarity].sellMult)
}

/**
 * Ценность предмета для разбора добычи: больше — ценнее. Апгрейды всегда
 * ценнее не-апгрейдов, внутри группы решает прирост урона в секунду,
 * а при равенстве — цена продажи.
 *
 * Своей меры «хорошести» здесь нет и быть не должно: сравнение идёт тем же
 * `estimateCombatRate`, что и подсказка в сумке, и автонадевание до его
 * сноса. Две разные меры разошлись бы, и игрок увидел бы, как игра выкинула
 * то, что сама же пометила апгрейдом.
 */
export function lootValue(state: GameState, item: Item, cache?: LootValueCache): number {
  const hit = cache?.get(item.id)
  if (hit !== undefined) return hit
  const share = upgradeShare(state, item)
  const sell = sellPrice(item).toNumber()
  const value =
    share === null
      ? sell * 1e-6
      : Number.isFinite(share)
        ? 1 + share
        : Number.POSITIVE_INFINITY
  cache?.set(item.id, value)
  return value
}

/**
 * Кеш ценности на ОДИН шаг оффлайн-агрегата. Восемь часов — это тысячи
 * бросков, а каждая оценка ценности гоняет конвейер статов и estimateCombatRate
 * дважды; без кеша полная сумка означала бы двадцать четыре таких оценки на
 * КАЖДУЮ находку, и загрузка вставала бы на минуты.
 *
 * Кешировать законно ровно потому, что внутри шага статы героя и его
 * экипировка неизменны: автонадевания в оффлайне нет, а уровень меняется
 * только между шагами. Новый шаг — новый кеш; правила сумки при этом те же
 * самые, кеш на них не влияет вовсе.
 */
export type LootValueCache = Map<string, number>

/** Апгрейд ли предмет по той же мере, что решает судьбу находки. */
export function isUpgradeValue(value: number): boolean {
  return value >= 1
}

/**
 * Куда девать выпавший предмет. Три исхода, и третий — главный:
 *
 *   место есть            — предмет ложится в сумку;
 *   места нет, не лучше   — автопродажа за золото (своё событие лога);
 *   места нет, но ЛУЧШЕ   — вытесняется худший предмет сумки, находка
 *                           остаётся. Потерять апгрейд из-за полной сумки
 *                           нельзя ни при каких настройках.
 *
 * Раньше при полной сумке дроп не бросался ВООБЩЕ: герой переставал
 * находить вещи, пока игрок не продаст, и это было видно в golden —
 * статы упирались в потолок. Теперь бросок идёт всегда.
 */
export function stashLoot(state: GameState, item: Item, cache?: LootValueCache): GameState {
  const withSeq = { ...state, itemSeq: Math.max(state.itemSeq, Number(item.id.split('-')[1]) + 1) }
  if (state.inventory.length < INVENTORY_SIZE) {
    return {
      ...withSeq,
      inventory: [...state.inventory, item],
      combatLog: pushEvent(state.combatLog, { type: 'loot', item }),
    }
  }
  const value = lootValue(state, item, cache)
  // Кого вытеснять: самый дешёвый предмет сумки по той же мере.
  let worstIndex = 0
  let worstValue = Number.POSITIVE_INFINITY
  state.inventory.forEach((candidate, index) => {
    const v = lootValue(state, candidate, cache)
    if (v < worstValue) {
      worstValue = v
      worstIndex = index
    }
  })
  // Находка не ценнее худшего в сумке — уходит в золото сама.
  if (value <= worstValue) {
    const gold = sellPrice(item)
    return {
      ...withSeq,
      gold: state.gold.plus(gold),
      combatLog: pushEvent(state.combatLog, { type: 'autosell', item, gold }),
    }
  }
  const dropped = state.inventory[worstIndex]
  const gold = sellPrice(dropped)
  const inventory = state.inventory.slice()
  inventory.splice(worstIndex, 1, item)
  return {
    ...withSeq,
    inventory,
    gold: state.gold.plus(gold),
    combatLog: pushEvent(state.combatLog, { type: 'loot-swap', item, dropped, gold }),
  }
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
