import type { IconName } from '../ui/icons/manifest'

// Слоты экипировки — данные, а не хардкод в логике.
//
// Рук ДВЕ. Правила связок (двуручное занимает обе, в левую руку идёт
// одноручное или щит) живут в game/equipment.ts, а не здесь: слоты — это
// перечень мест, а не свод правил.
export const SLOT_IDS = [
  'mainHand',
  'offHand',
  'head',
  'chest',
  'hands',
  'legs',
  'trinket',
] as const

export type SlotId = (typeof SLOT_IDS)[number]

export const SLOT_NAMES: Record<SlotId, string> = {
  mainHand: 'Правая рука',
  offHand: 'Левая рука',
  head: 'Голова',
  chest: 'Грудь',
  hands: 'Кисти',
  legs: 'Ноги',
  trinket: 'Талисман',
}

// Иконка слота. Отсутствие — ошибка проверки типов: Record требует все ключи.
export const SLOT_ICONS: Record<SlotId, IconName> = {
  mainHand: 'slot-weapon',
  offHand: 'slot-offhand',
  head: 'slot-head',
  chest: 'slot-chest',
  hands: 'slot-hands',
  legs: 'slot-legs',
  trinket: 'slot-trinket',
}

/**
 * МЕСТО СЛОТА НА КУКЛЕ — ДАННЫМИ, как и его иконка.
 *
 * Кукла перестала быть списком карточек и стала фигурой: голова сверху,
 * талисман сбоку от неё, вниз по центру грудь и ноги, кисти сбоку, обе руки
 * в нижнем ряду. Такую раскладку нельзя вывести из порядка `SLOT_IDS` — она
 * анатомическая, — а расставлять её условиями `if (slot === 'head')` в
 * компоненте значит завести восьмое такое условие на восьмом слоте.
 *
 * Колонок три, рядов четыре. Пустые клетки — это пустые клетки: у фигуры
 * нет плеч в первом столбце, и рисовать там ячейку не надо.
 *
 * РУКИ СТОЯТ РЯДОМ (ряд 4, колонки 1 и 2) НАМЕРЕННО: двуручное оружие
 * занимает обе, и показать это можно только соседством.
 */
export const SLOT_CELL: Record<SlotId, { col: number; row: number }> = {
  head: { col: 2, row: 1 },
  trinket: { col: 3, row: 1 },
  chest: { col: 2, row: 2 },
  hands: { col: 1, row: 3 },
  legs: { col: 2, row: 3 },
  mainHand: { col: 1, row: 4 },
  offHand: { col: 2, row: 4 },
}

/** Ширина и высота сетки куклы — производные, чтобы CSS не знал чисел. */
export const DOLL_COLS = Math.max(...Object.values(SLOT_CELL).map((c) => c.col))


/**
 * НЕСЁТ ЛИ ВЕЩЬ В ЭТОМ СЛОТЕ БРОНЮ — ДАННЫМИ, а не выводом «всё, что не рука».
 *
 * Правило игры звучит так: броня лежит на КАЖДОЙ ЧАСТИ БРОНИ и на КАЖДОМ
 * ЩИТЕ. Талисман не то и не другое — это украшение, и защищать он не должен.
 * Но в генераторе никакого условия не было ВООБЩЕ: броню получало всё, что не
 * рука (`Exclude<SlotId, 'mainHand' | 'offHand'>`), и талисман попадал под
 * это исключение вместе со шлемом.
 *
 * Признак приехал СЮДА, а не в логику, по железному правилу проекта: ветка
 * `if (slot === 'trinket')` в `game/loot.ts` — это ветвление по конкретному
 * id, его ловит `game/__tests__/rules.test.ts`. Появится восьмой слот —
 * решение о нём принимается здесь, одной строкой, и проверка контента
 * потребует его заполнить.
 *
 * РУКИ — `false` обе, и это не «руки не защищают»: у щита СВОЯ строка брони
 * (`SHIELD_BASE_DEFENSE`, генератор `shieldMods`), потому что щит занимает
 * руку и стоит игроку второго оружия. Здесь речь только о вещах, которые
 * делает `armorMods`.
 */
export const SLOT_DEFENSE: Record<SlotId, boolean> = {
  mainHand: false,
  offHand: false,
  head: true,
  chest: true,
  hands: true,
  legs: true,
  trinket: false,
}

// Вес слота в рулетке дропа: оружие падает реже брони.
export const SLOT_DROP_WEIGHTS: Record<SlotId, number> = {
  mainHand: 20,
  offHand: 14,
  head: 16,
  chest: 16,
  hands: 16,
  legs: 16,
  trinket: 16,
}
