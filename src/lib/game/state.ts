// Игровое состояние и его создание. Отдельный модуль, чтобы tick, loot и save
// зависели от него, а не друг от друга.
import { Decimal } from './numbers'
import { xpToNextLevel } from './formulas'
import { randomSeed } from './rng'
import { FIRST_MONSTER } from '../data/monsters'
import { recomputeStats, type StatBlock } from './stats'
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
  swingTimerMs: number // накопленное время замаха; удар при достижении stats.attackSpeed
  currentHp: Decimal // текущее здоровье героя, кап — stats.maxHp
  currentMana: Decimal // текущая мана героя, кап — stats.maxMana
  heroState: 'alive' | 'dead'
  reviveMsLeft: number // обратный отсчёт воскрешения; > 0 только при heroState 'dead'
  upgrades: Record<string, Decimal> // id апгрейда -> сколько куплено (источник статов)
  // Производные статы из конвейера stats.ts. Прямых полей урона/скорости/критов
  // в состоянии НЕТ — только пересчёт из источников (упгрейды, позже экипировка).
  stats: StatBlock
  statsDirty: boolean // источники изменились -> ensureStats пересчитает
  inventory: Item[]
  itemSeq: number // служебный счётчик для уникальных id предметов
  rngSeed: number // служебный сид потока случайности (в сейв пока не пишется)
  monster: Monster
  // Служебный обратный отсчёт до респауна в мс (как dtMs): 0 — моб жив.
  respawnMsLeft: number
  combatLog: CombatEvent[] // последние события, новые в начале
  msSinceAutosave: number // служебный счётчик игрового времени с последнего сейва
}

export function spawnMonster(template: MonsterTemplate): Monster {
  return { ...template, currentHp: template.maxHp, swingTimerMs: 0 }
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
    swingTimerMs: 0,
    currentHp: new Decimal(0), // заполняется ниже из пересчитанных статов
    currentMana: new Decimal(0),
    heroState: 'alive',
    reviveMsLeft: 0,
    upgrades: {},
    statsDirty: false,
    inventory: [],
    itemSeq: 0,
    rngSeed,
    monster: spawnMonster(FIRST_MONSTER),
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
