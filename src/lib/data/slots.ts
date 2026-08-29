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
