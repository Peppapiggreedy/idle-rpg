// TypeScript-типы и интерфейсы игры. Структуры данных — по PLAN.md.
// Все игровые числа — Decimal; служебные version и lastTimestamp — обычные number.
import type Decimal from 'break_infinity.js'

export interface Character {
  level: Decimal
  currentXp: Decimal
  xpToNext: Decimal
  baseDamage: Decimal
  gold: Decimal
}

export interface Monster {
  id: string
  name: string
  maxHp: Decimal
  currentHp: Decimal
  goldReward: Decimal
  xpReward: Decimal
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface Item {
  id: string
  name: string
  rarity: Rarity
  statBonus: Decimal
}

export interface Zone {
  id: string
  name: string
  monsterPool: string[] // id мобов из src/lib/data
  unlockCost: Decimal
}

export interface SaveData {
  version: number
  character: Character
  currentZoneId: string
  lastTimestamp: number // Date.now() последнего сохранения, для оффлайн-прогресса
  upgrades: Record<string, Decimal> // id апгрейда -> сколько куплено
}
