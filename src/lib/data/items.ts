// Шаблоны оружия и брони. Все названия оригинальные, существительные мужского
// рода — чтобы прилагательные из loot.ts согласовывались без склонений.
import { Decimal } from '../game/numbers'
import type { SlotId } from './slots'
import type { StatModifier } from '../game/stats'

export interface WeaponTemplate {
  id: string
  noun: string // существительное для имени: «Щербатый Змеезуб»
  weaponSpeed: Decimal // секунд между ударами (меньше = быстрее)
  damageMin: Decimal
  damageMax: Decimal
  // Побочные статы оружия — ОБЫЧНЫЕ модификаторы (не base).
  extra: Array<Omit<StatModifier, 'source'>>
}

// Три оружия с заметно разной скоростью и одинаковым отношением
// (средний урон / weaponSpeed) = 7.5 — значит одинаковым вкладом в урон
// в секунду. Разница между ними только в побочных статах и «ритме» боя.
// Диапазон задан как min = 5 * speed, max = 10 * speed.
export const WEAPONS: WeaponTemplate[] = [
  {
    id: 'fang',
    noun: 'Змеезуб',
    weaponSpeed: new Decimal(1.4),
    damageMin: new Decimal(7),
    damageMax: new Decimal(14),
    extra: [{ stat: 'critChance', kind: 'flat', value: new Decimal(0.03) }],
  },
  {
    id: 'bastard',
    noun: 'Полуторник',
    weaponSpeed: new Decimal(2.2),
    damageMin: new Decimal(11),
    damageMax: new Decimal(22),
    extra: [{ stat: 'attackPower', kind: 'flat', value: new Decimal(14) }],
  },
  {
    id: 'crusher',
    noun: 'Крушитель',
    weaponSpeed: new Decimal(3.4),
    damageMin: new Decimal(17),
    damageMax: new Decimal(34),
    extra: [{ stat: 'attackPower', kind: 'percent', value: new Decimal(0.1) }],
  },
]

// Существительные брони по слотам (оружие берёт своё из WEAPONS).
export const ARMOR_NOUNS: Record<Exclude<SlotId, 'weapon'>, readonly string[]> = {
  head: ['Шлем', 'Капюшон', 'Венец'],
  chest: ['Панцирь', 'Нагрудник', 'Кафтан'],
  hands: ['Наруч', 'Налокотник', 'Хват'],
  legs: ['Наголенник', 'Набедренник', 'Сапог'],
  trinket: ['Амулет', 'Оберег', 'Талисман'],
}

// Броня common-тира: прибавка к силе атаки и к запасу здоровья.
// Тиры домножают обе величины на bonusMult своей редкости.
export const ARMOR_BASE_ATTACK_POWER = new Decimal(7)
export const ARMOR_BASE_MAX_HP = new Decimal(10)
