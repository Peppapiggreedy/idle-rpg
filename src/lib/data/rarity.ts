// Тиры редкости. ЕДИНСТВЕННОЕ место, где определены цвета и веса редкостей —
// UI и логика берут их только отсюда.
import { Decimal } from '../game/numbers'
import type { Rarity } from '../types'

export interface RarityDef {
  id: Rarity
  name: string
  // Вес рулетки дропа (служебное число генератора, не игровая величина).
  weight: number
  // Цвет тира для подсветки в UI.
  color: string
  // Множитель прибавки к урону относительно базовой.
  bonusMult: Decimal
  // Множитель цены продажи относительно базовой.
  sellMult: Decimal
}

export const RARITIES: RarityDef[] = [
  { id: 'common',    name: 'Обычный',      weight: 100, color: '#9e9e9e', bonusMult: new Decimal(1),  sellMult: new Decimal(1) },
  { id: 'uncommon',  name: 'Необычный',    weight: 40,  color: '#4caf50', bonusMult: new Decimal(2),  sellMult: new Decimal(2) },
  { id: 'rare',      name: 'Редкий',       weight: 15,  color: '#2196f3', bonusMult: new Decimal(4),  sellMult: new Decimal(5) },
  { id: 'epic',      name: 'Эпический',    weight: 4,   color: '#9c27b0', bonusMult: new Decimal(8),  sellMult: new Decimal(12) },
  { id: 'legendary', name: 'Легендарный',  weight: 1,   color: '#ff9800', bonusMult: new Decimal(16), sellMult: new Decimal(30) },
]

export const RARITY_BY_ID = Object.fromEntries(RARITIES.map((r) => [r.id, r])) as Record<
  Rarity,
  RarityDef
>
