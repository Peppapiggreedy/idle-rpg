// TypeScript-типы и интерфейсы игры. Decimal берётся только из game/numbers.
// Игровые величины — Decimal; служебные (version, lastTimestamp, счётчики) — number.
import type { Decimal } from '../game/numbers'

export interface Monster {
  id: string
  name: string
  maxHp: Decimal
  currentHp: Decimal
  goldReward: Decimal
  xpReward: Decimal
}

// Шаблон моба для src/lib/data: без currentHp — оно появляется при спавне.
export type MonsterTemplate = Omit<Monster, 'currentHp'>

// Описание апгрейда для src/lib/data: цена растёт как baseCost * costGrowth^owned.
export interface UpgradeDef {
  id: string
  name: string
  baseCost: Decimal
  costGrowth: Decimal
  damageBonus: Decimal // прибавка к baseDamage за одну покупку
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface Item {
  id: string
  name: string
  rarity: Rarity
  statBonus: Decimal
}

// Структурированные события боя. Логика их эмитит, весь текст для игрока
// рендерит UI. Тип 'hit' зарезервирован (в лог сейчас не пишется, чтобы
// не вымывать важные события десятью ударами в секунду).
export type CombatEvent =
  | { type: 'hit'; damage: Decimal }
  | { type: 'kill'; monsterName: string; gold: Decimal; xp: Decimal }
  | { type: 'levelup'; level: Decimal }
  | { type: 'loot'; item: Item }
  | { type: 'spawn'; monsterName: string }
