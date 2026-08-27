// Игровое состояние и его создание. Отдельный модуль, чтобы tick, loot и save
// зависели от него, а не друг от друга.
import { Decimal } from './numbers'
import { xpToNextLevel } from './formulas'
import { randomSeed } from './rng'
import { buildMonster } from '../data/monsters'
import { SAFE_ZONE, type Zone } from '../data/zones'
import { recomputeStats, type StatBlock } from './stats'
import { SLOT_IDS, type SlotId } from '../data/slots'
import { createRng, type Rng } from './rng'
import type { CombatEvent, Item, Monster, MonsterTemplate } from '../types'

// Сколько последних событий боя храним для лога на экране.
export const COMBAT_LOG_SIZE = 8

export interface GameState {
  totalTicks: Decimal
  playtimeMs: Decimal
  gold: Decimal
  level: Decimal
  currentXp: Decimal
  xpToNext: Decimal
  // Прогресс замаха ДОЛЕЙ 0..1, а не в миллисекундах: при смене оружия или
  // haste доля сохраняется сама — ни сброса удара, ни мгновенного удара.
  swingProgress: number
  currentHp: Decimal // текущее здоровье героя, кап — stats.maxHp
  currentMana: Decimal // текущая мана героя, кап — stats.maxMana
  // Умения. Кулдауны и GCD идут ИГРОВЫМ временем (тем же dtMs, что и бой),
  // поэтому множитель скорости из отладочной панели ускоряет и их.
  gcdMsLeft: number // глобальный кулдаун; 0 — свободен
  abilityCooldownsMs: Record<string, number> // id умения -> сколько мс осталось
  // Умение типа onNextSwing, поставленное в очередь: заменит следующую
  // автоатаку. Одновременно только одно; null — очередь пуста.
  queuedAbilityId: string | null
  activeEffects: ActiveEffect[] // эффекты на текущем мобе (урон по времени)
  heroState: 'alive' | 'dead'
  reviveMsLeft: number // обратный отсчёт воскрешения; > 0 только при heroState 'dead'
  upgrades: Record<string, Decimal> // id апгрейда -> сколько куплено (источник статов)
  equipment: Equipment // надетые предметы по слотам (источник статов)
  autoEquip: boolean // автонадевание, если предмет лучше по урону в секунду
  // Производные статы из конвейера stats.ts. Прямых полей урона/скорости/критов
  // в состоянии НЕТ — только пересчёт из источников (упгрейды, позже экипировка).
  stats: StatBlock
  statsDirty: boolean // источники изменились -> ensureStats пересчитает
  inventory: Item[]
  itemSeq: number // служебный счётчик для уникальных id предметов
  rngSeed: number // служебный сид потока случайности (в сейв пока не пишется)
  currentZoneId: string // где герой фармит сейчас
  // Последняя зона, в которой герой ВЫЖИЛ (убил там хотя бы одного моба).
  // Смерть отбрасывает сюда; null — выживать ещё негде, значит в безопасную.
  lastSurvivedZoneId: string | null
  monster: Monster
  // Служебный обратный отсчёт до респауна в мс (как dtMs): 0 — моб жив.
  respawnMsLeft: number
  combatLog: CombatEvent[] // последние события, новые в начале
  msSinceAutosave: number // служебный счётчик игрового времени с последнего сейва
}

// Наложенный эффект. Урон тика ЗАСНЯТ в момент применения: смена оружия
// посреди эффекта не меняет уже наложенный урон.
export interface ActiveEffect {
  abilityId: string
  damagePerTick: Decimal
  ticksLeft: number
  msToNextTick: number
}

export type Equipment = Record<SlotId, Item | null>

export function emptyEquipment(): Equipment {
  return Object.fromEntries(SLOT_IDS.map((slot) => [slot, null])) as Equipment
}

export function monsterFromTemplate(template: MonsterTemplate): Monster {
  return { ...template, currentHp: template.maxHp, swingProgress: 0 }
}

// Спавн из зоны: сперва бросок уровня из диапазона, затем бросок архетипа
// из пула. Порядок бросков фиксирован — от него зависит воспроизводимость.
export function spawnMonster(zone: Zone, rng: Rng): Monster {
  const { min, max } = zone.monsterLevelRange
  const level = min + Math.min(max - min, Math.floor(rng() * (max - min + 1)))
  const pool = zone.monsterPool
  const archetype = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
  return monsterFromTemplate(buildMonster(archetype, level, zone.rewardMultiplier))
}

export function createInitialState(rngSeed: number = randomSeed()): GameState {
  const level = new Decimal(1)
  const base: Omit<GameState, 'stats'> = {
    totalTicks: new Decimal(0),
    playtimeMs: new Decimal(0),
    gold: new Decimal(0),
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    swingProgress: 0,
    currentHp: new Decimal(0), // заполняется ниже из пересчитанных статов
    currentMana: new Decimal(0),
    gcdMsLeft: 0,
    abilityCooldownsMs: {},
    queuedAbilityId: null,
    activeEffects: [],
    heroState: 'alive',
    reviveMsLeft: 0,
    upgrades: {},
    equipment: emptyEquipment(),
    autoEquip: true,
    statsDirty: false,
    currentZoneId: SAFE_ZONE.id,
    lastSurvivedZoneId: null,
    inventory: [],
    itemSeq: 0,
    rngSeed,
    // Первый моб — из безопасной зоны; поток случайности берём от того же сида,
    // что и весь прогон, поэтому старт детерминирован.
    monster: spawnMonster(SAFE_ZONE, createRng(rngSeed)),
    respawnMsLeft: 0,
    combatLog: [],
    msSinceAutosave: 0,
  }
  const stats = recomputeStats(base as GameState)
  return { ...base, stats, currentHp: stats.maxHp, currentMana: stats.maxMana }
}

export function pushEvent(log: CombatEvent[], event: CombatEvent): CombatEvent[] {
  return [event, ...log].slice(0, COMBAT_LOG_SIZE)
}
