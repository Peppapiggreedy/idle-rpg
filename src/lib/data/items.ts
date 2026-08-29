// Шаблоны оружия и брони. Все названия оригинальные, существительные мужского
// рода — чтобы прилагательные из loot.ts согласовывались без склонений.
import { Decimal } from '../game/numbers'
import type { SlotId } from './slots'
import type { StatModifier } from '../game/stats'

export interface WeaponTemplate {
  id: string
  noun: string // существительное для имени: «Щербатый Змеезуб»
  /** Сколько рук занимает. Двуручное занимает обе и оставляет левую пустой. */
  hands: 1 | 2
  weaponSpeed: Decimal // секунд между ударами (меньше = быстрее)
  damageMin: Decimal
  damageMax: Decimal
  // Побочные статы оружия — ОБЫЧНЫЕ модификаторы (не base).
  extra: Array<Omit<StatModifier, 'source'>>
}

/**
 * Щит. Не оружие: урона не даёт вовсе, зато даёт блок и запас HP.
 * Живёт в той же левой руке, что и второе одноручное, — выбирать между ними
 * и есть решение о стиле боя.
 */
export interface ShieldTemplate {
  id: string
  noun: string
  blockChance: Decimal // вероятность блока, доля
  blockValue: Decimal // сколько урона снимает удачный блок
  extra: Array<Omit<StatModifier, 'source'>>
}

// Побочные статы оружия и щитов — АТРИБУТЫ, а не готовые статы: «Змеезуб —
// оружие ловкости» читается из данных, а во что ловкость разворачивается,
// решает конвейер (data/balance.ts). Плоские атрибуты растут с уровнем
// предмета, как и всё остальное на нём.
//
// Оружие трёх стилей. Числа подобраны так, чтобы равны были не ОРУЖИЯ, а
// СВЯЗКИ — то, что герой реально носит:
//
//   два одноручных: 7.5 + 7.5 * OFFHAND_PENALTY = 11.25 урона оружия в секунду;
//   двуручное:      11.25 — столько же, потому что занимает обе руки;
//   одноручное+щит: 7.5 — на треть меньше, и это ПЛАТА за блок и запас HP.
//
// Одноручные держат прежнее отношение (средний урон / weaponSpeed) = 7.5,
// двуручное — 11.25. Диапазон задан как min = ratio/1.5 * speed,
// max = ratio*4/3 * speed, то есть прежняя форма «min:max = 1:2».
export const WEAPONS: WeaponTemplate[] = [
  {
    id: 'fang',
    noun: 'Змеезуб',
    hands: 1,
    weaponSpeed: new Decimal(1.4),
    damageMin: new Decimal(7),
    damageMax: new Decimal(14),
    extra: [{ stat: 'agility', kind: 'flat', value: new Decimal(15) }],
  },
  {
    id: 'bastard',
    noun: 'Полуторник',
    hands: 1,
    weaponSpeed: new Decimal(2.2),
    damageMin: new Decimal(11),
    damageMax: new Decimal(22),
    extra: [{ stat: 'strength', kind: 'flat', value: new Decimal(7) }],
  },
  {
    id: 'crusher',
    noun: 'Крушитель',
    hands: 2,
    weaponSpeed: new Decimal(3.4),
    damageMin: new Decimal(25.5),
    damageMax: new Decimal(51),
    extra: [{ stat: 'strength', kind: 'percent', value: new Decimal(0.1) }],
  },
]

/** Щиты. Урона не дают: их вклад — блок и живучесть. */
export const SHIELDS: ShieldTemplate[] = [
  {
    id: 'bulwark',
    noun: 'Заслон',
    blockChance: new Decimal(0.25),
    blockValue: new Decimal(12),
    extra: [{ stat: 'vitality', kind: 'flat', value: new Decimal(4) }],
  },
]

export const SHIELD_BY_ID: Record<string, ShieldTemplate> = Object.fromEntries(
  SHIELDS.map((s) => [s.id, s]),
)

/** Одноручные — то, что можно взять во вторую руку вместо щита. */
export const ONE_HANDED = WEAPONS.filter((w) => w.hands === 1)

export const WEAPON_BY_ID: Record<string, WeaponTemplate> = Object.fromEntries(
  WEAPONS.map((w) => [w.id, w]),
)

// Существительные брони по слотам (руки берут своё из WEAPONS и SHIELDS).
export const ARMOR_NOUNS: Record<Exclude<SlotId, 'mainHand' | 'offHand'>, readonly string[]> = {
  head: ['Шлем', 'Капюшон', 'Венец'],
  chest: ['Панцирь', 'Нагрудник', 'Кафтан'],
  hands: ['Наруч', 'Налокотник', 'Хват'],
  legs: ['Наголенник', 'Набедренник', 'Сапог'],
  trinket: ['Амулет', 'Оберег', 'Талисман'],
}

// Броня даёт АТРИБУТЫ: главный к слоту НЕ привязан — его разыгрывает лут,
// и один и тот же шлем бывает и умным, и живучим. Живучесть — у всех:
// любая броня в первую очередь броня. Числа common-тира 1 уровня; тир
// множит на bonusMult, уровень предмета — на itemLevelScale.
export type ArmorSlot = Exclude<SlotId, 'mainHand' | 'offHand'>
export type AttributeId = 'strength' | 'agility' | 'intellect' | 'vitality'

/** Что может выпасть главным атрибутом брони — любой из четырёх, поровну. */
export const ARMOR_ATTRIBUTES: readonly AttributeId[] = [
  'strength',
  'agility',
  'intellect',
  'vitality',
]

export const ARMOR_BASE_PRIMARY = new Decimal(4)
export const ARMOR_BASE_VITALITY = new Decimal(2)
