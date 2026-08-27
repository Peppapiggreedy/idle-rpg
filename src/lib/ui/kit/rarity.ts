// Мост между данными редкостей и CSS. Цвета живут в data/rarity.ts вместе
// с весами рулетки — второго набора в токенах нет намеренно. Компонент
// получает цвет через кастомное свойство, а дальше работает var().
import { RARITY_BY_ID } from '../../data/rarity'
import type { Rarity } from '../../types'

/** Инлайновый style для элемента, который красится по редкости. */
export function rarityStyle(rarity: Rarity): string {
  return `--rarity-color: ${RARITY_BY_ID[rarity].color}`
}

/** Человеческое название тира — тоже из данных, не из компонента. */
export function rarityName(rarity: Rarity): string {
  return RARITY_BY_ID[rarity].name
}
