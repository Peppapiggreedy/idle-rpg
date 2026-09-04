// Генерация и продажа лута. Случайность приходит снаружи (rng),
// поэтому вся логика детерминированно тестируется.
import { Decimal } from './numbers'
import type { Rng } from './rng'
import { pushEvent, type GameState } from './state'
import type { Item } from '../types'
import { RARITIES, RARITY_BY_ID, type RarityDef } from '../data/rarity'
import { DROP_CHANCE, LOOT_ADJECTIVES, SHIELD_SHARE, itemSellPrice } from '../data/loot'
import { SLOT_DROP_WEIGHTS, SLOT_IDS, type SlotId } from '../data/slots'
import {
  ARMOR_ATTRIBUTES,
  ARMOR_BASE_DEFENSE,
  ARMOR_BASE_PRIMARY,
  ARMOR_BASE_VITALITY,
  ARMOR_BONUS_STAT,
  ARMOR_NOUNS,
  itemStatValue,
  ONE_HANDED,
  SHIELD_BASE_DEFENSE,
  SHIELDS,
  WEAPONS,
  type ArmorSlot,
  type AttributeId,
  type ShieldTemplate,
  type WeaponTemplate,
} from '../data/items'
import { itemLevelScale } from '../data/balance'
import type { StatModifier } from './stats'
import { betterOnAnyAxis, isEquipped, upgradeShare } from './equipment'
import { dustValue } from './enchanting'
import { inventorySize, lootPolicyOf } from './upgrades'
import type { BossLoot } from '../data/dungeons'

// Реэкспорт для обратной совместимости импортов.
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
 * Все числа КОНКРЕТНОЙ вещи — через одно зерно (`ITEM_STAT_GRAIN` в
 * `data/items.ts`): что считается штуками, то на генерации округляется к
 * ближайшему целому, доли и секунды проходят как есть. Здесь единственная
 * точка применения: и находка, и ковка, и стартовый комплект строят
 * модификаторы этими тремя функциями, поэтому второго места, где предмет
 * обзаводится числом, нет.
 *
 * МАТОЖИДАНИЕ ЧЕРЕЗ НЕЁ НЕ ХОДИТ — см. `averageArmorMods` ниже.
 */
function grained(mods: StatModifier[]): StatModifier[] {
  return mods.map((mod) => ({ ...mod, value: itemStatValue(mod.stat, mod.value) }))
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
  return grained([
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
    // Побочные статы у оружия ТОЛЬКО ПЛОСКИЕ (держит проверка контента),
    // поэтому множатся все без разбора: процент множить было бы нечем — он
    // считается от суммы конвейера и от уровня вещи не зависит вовсе.
    ...template.extra.map((mod) => ({ ...mod, value: mod.value.times(power), source })),
  ])
}

/** Щит: урона не даёт, зато даёт блок. Тоже через конвейер, без исключений. */
export function shieldMods(template: ShieldTemplate, rarity: RarityDef, level = 1): StatModifier[] {
  const source = 'equipment:offHand'
  // Шанс блока не растёт: вероятность — не сила. Растёт то, СКОЛЬКО блок
  // снимает, и атрибуты.
  const power = itemLevelScale(level).times(rarity.bonusMult)
  return grained([
    { stat: 'blockChance', kind: 'base', value: template.blockChance, source },
    { stat: 'blockValue', kind: 'base', value: template.blockValue.times(power), source },
    // БРОНЯ ЩИТА. Плоская прибавка, как и всё на выпадающих вещах, и растёт
    // той же `power`: блок снимает фиксированную величину и обесценивается с
    // ростом урона мобов, а броня режет ДОЛЮ и не обесценивается никогда.
    { stat: 'armor', kind: 'flat', value: SHIELD_BASE_DEFENSE.times(power), source },
    // Тот же разговор, что и у оружия: побочные статы щита только плоские.
    ...template.extra.map((mod) => ({ ...mod, value: mod.value.times(power), source })),
  ])
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
  // две записи об одном стате читались бы в карточке как «+12 выносливости,
  // +4 выносливости». Слияние идёт по совпадению стата, а какой стат довеском —
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
  return grained([
    // БРОНЯ ЕСТЬ У КАЖДОЙ ЧАСТИ БРОНИ, и она не разыгрывается: главный
    // атрибут — вопрос везения, а защита — то, ради чего броню и носят.
    { stat: 'armor' as const, kind: 'flat' as const, value: ARMOR_BASE_DEFENSE.times(power), source },
    ...[...budget].map(([stat, value]) => ({
      stat,
      kind: 'flat' as const,
      value: value.times(power),
      source,
    })),
  ])
}

/**
 * Средняя броня для эталонных сборок прогона баланса: матожидание случайного
 * главного атрибута — четверть бюджета в каждый из четырёх. Строится теми же
 * константами, что и настоящий дроп, иначе прогон мерил бы не ту игру.
 *
 * ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЧИСЛА НЕ ОКРУГЛЯЮТСЯ, и это не забытая строка.
 * Здесь считается не вещь, а МАТОЖИДАНИЕ по популяции вещей: четверть
 * бюджета в каждый атрибут — это средняя брони вообще, а не чей-то шлем.
 * Ступенька в эталоне запрещена тем же доводом, что и `floor`/`ceil` в
 * `farmCycle` (см. «ОЦЕНКА — ДОЛГОСРОЧНОЕ СРЕДНЕЕ» в CLAUDE.md и
 * `rate-continuity.test.ts`): округление сделало бы эталонного героя
 * ступенчатой функцией уровня вещей, и каждый контракт, который меряется
 * по лестнице уровней, начал бы прыгать на границах ступеней. Расхождение
 * с настоящей популяцией при этом меньше половины единицы на стат — тоньше
 * собственной точности эталона.
 *
 * ГРАНИЦА ПРОСТАЯ: конкретная вещь — целая, матожидание — непрерывное.
 * Оружие и щит эталона идут через `weaponMods`/`shieldMods`, потому что это
 * КОНКРЕТНЫЕ вещи и в модели тоже: эталонный герой носит один полуторник и
 * один заслон, а не «средний меч».
 */
export function averageArmorMods(slot: ArmorSlot, rarity: RarityDef, level = 1): StatModifier[] {
  const source = `equipment:${slot}`
  const power = itemLevelScale(level).times(rarity.bonusMult)
  const share = ARMOR_BASE_PRIMARY.div(ARMOR_ATTRIBUTES.length)
  // Довесок прибавляется тому стату, который назван довеском В ДАННЫХ, —
  // ровно как в armorMods выше, и по тому же признаку совпадения.
  return [
    // Броня — та же и в матожидании: она не разыгрывается вовсе, поэтому
    // «средняя» часть брони несёт ровно столько же защиты, сколько любая
    // конкретная. Округления здесь по-прежнему нет — см. комментарий выше.
    { stat: 'armor' as const, kind: 'flat' as const, value: ARMOR_BASE_DEFENSE.times(power), source },
    ...ARMOR_ATTRIBUTES.map((attr) => ({
      stat: attr,
      kind: 'flat' as const,
      value: (attr === ARMOR_BONUS_STAT ? share.plus(ARMOR_BASE_VITALITY) : share).times(power),
      source,
    })),
  ]
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

// Цена продажи — формула ИЗ ДАННЫХ, по уровню вещи и тиру. Своей арифметики
// здесь нет: разбор добычи, автопродажа и кнопка в сумке зовут одно и то же.
export function sellPrice(item: Item): Decimal {
  return itemSellPrice(item.level, item.rarity)
}

/**
 * Ценность предмета для разбора добычи: больше — ценнее. Апгрейды всегда
 * ценнее не-апгрейдов, внутри группы решает лучшая из осей приоритета,
 * а при равенстве — цена продажи.
 *
 * Своей меры «хорошести» здесь нет и быть не должно: сравнение идёт тем же
 * `estimateCombatRate`, что и подсказка в сумке. Две разные меры разошлись
 * бы, и игрок увидел бы, как игра выкинула то, что сама же пометила
 * апгрейдом. ПРИОРИТЕТ БЕРЁТСЯ ИЗ СОСТОЯНИЯ (`upgradeShare` без третьего
 * аргумента): поставил игрок «выживание» — разбор считает лишним то, что
 * не спасает, а не то, что слабо бьёт.
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
 *
 * ЖЕЛЕЗНОЕ ПРАВИЛО СИЛЬНЕЕ ПРИОРИТЕТА. «Лучше» для вытеснения считается по
 * ОБЕИМ осям (`betterOnAnyAxis`), а не по тем, что выбрал игрок: приоритет
 * говорит, что подсветить и что считать лишним при разборе, но молча
 * потерять находку он права не даёт. Игрок, поставивший «урон», просил не
 * звать панцирь апгрейдом — он не просил выбрасывать панцирь.
 */
export function stashLoot(state: GameState, item: Item, cache?: LootValueCache): GameState {
  const withSeq = { ...state, itemSeq: Math.max(state.itemSeq, Number(item.id.split('-')[1]) + 1) }
  // РАЗБОР НА ЛЕТУ — покупка, а не умолчание. Пока переключатель стоит на
  // «не трогать» (и пока положения не куплены), поведение ровно прежнее:
  // всё падает в сумку. Купленные положения убирают из неё МУСОР — вещь,
  // не лучшую ни по одной оси, — и никогда находку: железное правило сумки
  // проверяется первым и здесь.
  const policy = lootPolicyOf(state)
  if (policy !== 'keep' && !betterOnAnyAxis(state, item)) {
    if (policy === 'sell') {
      const gold = sellPrice(item)
      return {
        ...withSeq,
        gold: state.gold.plus(gold),
        combatLog: pushEvent(state.combatLog, { type: 'autosell', item, gold }),
      }
    }
    const dust = dustValue(item)
    return {
      ...withSeq,
      enchantDust: state.enchantDust.plus(dust),
      combatLog: pushEvent(state.combatLog, { type: 'autodust', item, dust }),
    }
  }
  if (state.inventory.length < inventorySize(state)) {
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
  // Находка не ценнее худшего в сумке — уходит в золото сама. Но сперва
  // железное правило: лучше хоть по одной оси — остаётся в любом случае.
  if (value <= worstValue && !betterOnAnyAxis(state, item)) {
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
