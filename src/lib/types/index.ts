import type { IconName } from '../ui/icons/manifest'
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
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  baseCost: Decimal
  costGrowth: Decimal
  damageBonus: Decimal // прибавка к урону за удар за одну покупку
}

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export interface Item {
  /** Сколько рук занимает оружие. Нет поля — предмет не оружие. */
  hands?: 1 | 2
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
  // Удар умения: id, а не имя — текст рендерит UI по данным умения.
  | { type: 'ability'; abilityId: string; damage: Decimal; isCrit: boolean }
  // Тик эффекта (урон по времени) от умения abilityId.
  | { type: 'effect'; abilityId: string; damage: Decimal }
  | { type: 'kill'; monsterName: string; gold: Decimal; xp: Decimal }
  | { type: 'levelup'; level: Decimal }
  | { type: 'loot'; item: Item }
  | { type: 'spawn'; monsterName: string }
  | { type: 'hurt'; damage: Decimal; monsterName: string }
  | { type: 'death' }
  | { type: 'revive' }
  // Смена зоны: 'travel' — по воле игрока, 'retreat' — откат после смерти.
  | { type: 'zone'; zoneName: string; reason: 'travel' | 'retreat' }
  // Данж: очередной босс цепочки, выход наружу, полное прохождение.
  | { type: 'boss'; bossName: string; index: number; total: number }
  | { type: 'dungeon-exit'; defeated: boolean }
  | { type: 'dungeon-clear'; dungeonName: string; firstClear: boolean }
  | { type: 'enrage'; bossName: string; multiplier: number }
  // Привал: управляемая пауза по порогу. 'interrupted' — игрок прервал сам,
  // и восстановление вышло частичным.
  // Блок щитом: `damage` — что прошло, `blocked` — что снял щит.
  | { type: 'block'; damage: Decimal; blocked: Decimal; monsterName: string }
  // Материал с моба и собранный рецепт: id, текст рендерит UI.
  | { type: 'material'; materialId: string }
  | { type: 'craft'; recipeId: string }
  | { type: 'rest-start' }
  | { type: 'rest-end'; interrupted: boolean }

// Активный забег по данжу. Хранится в состоянии и в сейве: цепочку можно
// продолжить после перезагрузки, но не после смерти внутри.
export interface DungeonRun {
  dungeonId: string
  bossIndex: number
  fightMs: number // сколько идёт бой с текущим боссом; от него ярость
}

// Событие одного удара для шины game/events.ts (всплывающие числа урона и т.п.).
export interface AttackEvent {
  sourceId: string
  targetId: string
  amount: Decimal
  isCrit: boolean
  abilityId: string | null // авто-атака = null; умение — его id
  timestamp: number // игровое время (playtimeMs) на момент удара
}
