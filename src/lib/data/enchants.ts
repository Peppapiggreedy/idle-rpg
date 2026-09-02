
// ===========================================================================
// Зачарования — данные. Зачарование ЖИВЁТ НА ПРЕДМЕТЕ (item.enchantId) и
// действует ТОЛЬКО через конвейер статов, как и сам предмет: никаких
// «прибавок к урону» отдельным полем.
//
// Пыль берётся НЕ с мобов, а из распыления находок, и это главное решение
// фичи. Сумка на 24 слота и так заставляет что-то делать с добычей; до сих
// пор ответ был один — продать. Распыление даёт второй, и вопрос «продать
// или распылить» становится настоящим: золото нужно на сброс талантов,
// пыль — на зачарования.
//
// ПОЧЕМУ ЗАЧАРОВАНИЕ НЕ РАСТЁТ ОТ УРОВНЯ ВЕЩИ. У предмета сила растёт
// линейно от его уровня (itemLevelScale), у зачарования — нет: оно написано
// так, чтобы масштабироваться САМО. Всё, что растёт неограниченно (атрибуты,
// сила атаки, сила блока), зачарование даёт ПРОЦЕНТОМ; плоская прибавка
// разрешена только там, где величина живёт в долях или секундах и потому не
// обесценивается (ENCHANT_FLAT_STATS). Этот список стережёт content:check —
// без него первое же «+8 силы» стало бы пылью к девяностому уровню.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import type { StatId, StatModifier } from '../game/stats'
import type { Rarity } from '../types'
import type { SlotId } from './slots'

/** Модификатор зачарования БЕЗ source: его проставляет enchantModifiers. */
export type EnchantModifier = Omit<StatModifier, 'source'>

export interface EnchantDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Одна строка о том, зачем оно: текст для игрока живёт в данных, как у профессий. */
  tagline: string
  /** Слоты, куда его можно наложить. Пустой список — недостижимый контент. */
  slots: SlotId[]
  /** Цена в пыли. Целое число: пыль не растёт неограниченно за одно действие. */
  dustCost: number
  /** Модификаторы конвейера статов. base здесь запрещён — см. content:check. */
  mods: EnchantModifier[]
}

/**
 * Сколько пыли даёт распыление предмета. Таблица, а не формула: числа тиров
 * и так живут таблицей (веса, множители в data/rarity.ts), и пыль обязана
 * читаться рядом с ними — «легендарка стоит пятидесяти обычных».
 *
 * Уровень предмета на выход НЕ влияет: пыль — это материал разбора, а не
 * сила вещи. Иначе распыление одной вещи из последней зоны закрывало бы
 * всю систему разом.
 */
export const DUST_BY_RARITY: Record<Rarity, number> = {
  common: 1,
  uncommon: 3,
  rare: 8,
  epic: 20,
  legendary: 50,
}

/**
 * Статы, на которых зачарованию разрешена ПЛОСКАЯ прибавка: доли (haste,
 * шансы) и секунды. Всё остальное растёт неограниченно, и плоская прибавка
 * там обесценится вместе с уровнем — такие статы зачарование даёт процентом.
 */
export const ENCHANT_FLAT_STATS: readonly StatId[] = [
  'haste',
  'critChance',
  'critMultiplier',
  'blockChance',
  'damageReduction',
  'offhandPenalty',
  'regenDelay',
  'restDuration',
  'restThreshold',
]

// СИЛА ЗАЧАРОВАНИЙ ПОДНЯТА В ПОЛТОРА РАЗА (третья ночь, стадия 4: бюджет
// силы). Все восемь чисел умножены на 1.5 разом — это одна ручка одной
// системы, а не восемь отдельных решений. Замер эталонным Стражем сотого
// уровня: зачарования на всех слотах давали ×1.107 темпа убийств при
// коридоре бюджета 1.15-1.35, то есть система стоила дешевле, чем ей
// отведено. После правки — ×1.16 (таблица в power-budget.test.ts).
//
// Пыль на зачарования при этом не подорожала: цена — про то, сколько их
// успеваешь наложить, а коридор — про то, сколько они дают.
export const ENCHANTS: EnchantDef[] = [
  // --- Руки ---
  {
    id: 'rune-edge',
    name: 'Руна кромки',
    icon: 'enchant-rune-edge',
    tagline: 'Оружие бьёт тяжелее: сила атаки растёт вместе с героем.',
    slots: ['mainHand'],
    dustCost: 120,
    mods: [{ stat: 'attackPower', kind: 'percent', value: new Decimal(0.12) }],
  },
  {
    id: 'wind-notch',
    name: 'Насечка ветра',
    icon: 'enchant-wind-notch',
    // Ускорение ВСЕГДА flat по haste и никогда прибавкой к weaponSpeed:
    // процент от нуля даёт ноль, а правка скорости оружия увела бы замах
    // в минус. То же правило, что и у талантов (см. CLAUDE.md).
    tagline: 'Замах короче: +5% скорости обеим рукам.',
    slots: ['mainHand', 'offHand'],
    dustCost: 120,
    mods: [{ stat: 'haste', kind: 'flat', value: new Decimal(0.075) }],
  },
  {
    id: 'wall-oath',
    name: 'Клятва заслона',
    icon: 'enchant-wall-oath',
    tagline: 'Щит снимает больше и срабатывает чаще.',
    slots: ['offHand'],
    dustCost: 90,
    mods: [
      { stat: 'blockValue', kind: 'percent', value: new Decimal(0.45) },
      { stat: 'blockChance', kind: 'flat', value: new Decimal(0.045) },
    ],
  },

  // --- Броня: по зачарованию на каждый атрибут. Слоты одни и те же, поэтому
  // выбор атрибута — это выбор билда, а не обход ограничения. ---
  {
    id: 'heavy-hand',
    name: 'Тяжёлая длань',
    icon: 'enchant-heavy-hand',
    tagline: '+6% силы: прямая прибавка к удару.',
    slots: ['head', 'chest', 'hands', 'legs', 'trinket'],
    dustCost: 70,
    mods: [{ stat: 'strength', kind: 'percent', value: new Decimal(0.09) }],
  },
  {
    id: 'light-tread',
    name: 'Лёгкий шаг',
    icon: 'enchant-light-tread',
    tagline: '+6% ловкости: скорость и криты.',
    slots: ['head', 'chest', 'hands', 'legs', 'trinket'],
    dustCost: 70,
    mods: [{ stat: 'agility', kind: 'percent', value: new Decimal(0.09) }],
  },
  {
    id: 'clear-sight',
    name: 'Ясный взор',
    icon: 'enchant-clear-sight',
    tagline: '+6% интеллекта: запас ресурса и его восстановление.',
    slots: ['head', 'chest', 'hands', 'legs', 'trinket'],
    dustCost: 70,
    mods: [{ stat: 'intellect', kind: 'percent', value: new Decimal(0.09) }],
  },
  {
    id: 'stone-core',
    name: 'Каменная сердцевина',
    icon: 'enchant-stone-core',
    tagline: '+6% живучести: запас здоровья и его восстановление.',
    slots: ['head', 'chest', 'hands', 'legs', 'trinket'],
    dustCost: 70,
    mods: [{ stat: 'vitality', kind: 'percent', value: new Decimal(0.09) }],
  },
]

export const ENCHANT_BY_ID: Record<string, EnchantDef> = Object.fromEntries(
  ENCHANTS.map((e) => [e.id, e]),
)

/** Зачарования, которые можно наложить в этот слот. */
export function enchantsForSlot(slot: SlotId): EnchantDef[] {
  return ENCHANTS.filter((e) => e.slots.includes(slot))
}

/** Что стоит на предмете; null — чисто или id из будущей версии. */
export function enchantOf(item: { enchantId?: string }): EnchantDef | null {
  return item.enchantId ? (ENCHANT_BY_ID[item.enchantId] ?? null) : null
}

/**
 * Модификаторы зачарования предмета — чистая производная от данных, как
 * talentModifiers. source = 'enchant:<слот>', поэтому раскладка на панели
 * статов показывает зачарование ОТДЕЛЬНОЙ строкой от самой вещи: игрок
 * видит, что он потеряет, если вещь снять.
 *
 * Зачарование, не подходящее слоту (правленый руками сейв), молча ничего
 * не даёт: подмена базы боя из слота брони так невозможна.
 */
export function enchantModifiers(item: { slot: SlotId; enchantId?: string }): StatModifier[] {
  const enchant = enchantOf(item)
  if (!enchant || !enchant.slots.includes(item.slot)) return []
  return enchant.mods.map((mod) => ({ ...mod, source: `enchant:${item.slot}` }))
}

