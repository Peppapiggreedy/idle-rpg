// TypeScript-типы и интерфейсы игры. Decimal берётся только из game/numbers.
// Игровые величины — Decimal; служебные (version, lastTimestamp, счётчики) — number.
import type { Decimal } from '../game/numbers'
import type { StatModifier } from '../game/stats'
import type { SlotId } from '../data/slots'

export interface Monster {
  id: string
  name: string
  level: number // уровень моба; от него масштабируются hp, урон и награды
  maxHp: Decimal
  currentHp: Decimal
  goldReward: Decimal
  xpReward: Decimal
  damageMin: Decimal // нижняя граница урона по герою; 0/0 — моб не атакует
  damageMax: Decimal // верхняя граница урона по герою
  swingTime: number // секунд между ударами моба (у мобов нет оружия — время замаха задано прямо)
  swingProgress: number // доля замаха моба 0..1 (runtime, в шаблоне отсутствует)
}

// Шаблон моба для src/lib/data: без runtime-полей — они появляются при спавне.
export type MonsterTemplate = Omit<Monster, 'currentHp' | 'swingProgress'>

// Описание апгрейда для src/lib/data: цена растёт как baseCost * costGrowth^owned.
export interface UpgradeDef {
  id: string
  name: string
  baseCost: Decimal
  costGrowth: Decimal
  damageBonus: Decimal // прибавка к урону за удар за одну покупку
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface Item {
  id: string
  name: string
  rarity: Rarity
  slot: SlotId
  // Модификаторы предмета в формате конвейера статов. У оружия среди них
  // ОБЯЗАТЕЛЬНО три kind: 'base' — weaponSpeed, weaponDamageMin, weaponDamageMax.
  mods: StatModifier[]
}

// Структурированные события боя для лога. Логика их эмитит,
// весь текст для игрока рендерит UI.
export type CombatEvent =
  | { type: 'hit'; damage: Decimal; isCrit: boolean }
  | { type: 'kill'; monsterName: string; gold: Decimal; xp: Decimal }
  | { type: 'levelup'; level: Decimal }
  | { type: 'loot'; item: Item }
  | { type: 'spawn'; monsterName: string }
  | { type: 'hurt'; damage: Decimal; monsterName: string }
  | { type: 'death' }
  | { type: 'revive' }
  // Смена зоны: 'travel' — по воле игрока, 'retreat' — откат после смерти.
  | { type: 'zone'; zoneName: string; reason: 'travel' | 'retreat' }

// Событие одного удара для шины game/events.ts (всплывающие числа урона и т.п.).
export interface AttackEvent {
  sourceId: string
  targetId: string
  amount: Decimal
  isCrit: boolean
  abilityId: string | null // авто-атака = null; способности придут позже
  timestamp: number // игровое время (playtimeMs) на момент удара
}
