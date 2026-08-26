// Игровое состояние и его создание. Отдельный модуль, чтобы tick, loot и save
// зависели от него, а не друг от друга.
import { Decimal } from './numbers'
import { xpToNextLevel } from './formulas'
import { randomSeed } from './rng'
import { FIRST_MONSTER } from '../data/monsters'
import {
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
  START_ATTACK_SPEED_S,
  START_DAMAGE_PER_SWING,
} from '../data/balance'
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
  damagePerSwing: Decimal // урон одного удара; апгрейды добавляют к нему
  attackSpeed: number // секунд между ударами
  swingTimerMs: number // накопленное время замаха; удар при достижении attackSpeed
  critChance: number // вероятность крита
  critMultiplier: Decimal // множитель урона крита
  upgrades: Record<string, Decimal> // id апгрейда -> сколько куплено
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
  return { ...template, currentHp: template.maxHp }
}

export function createInitialState(rngSeed: number = randomSeed()): GameState {
  const level = new Decimal(1)
  return {
    totalTicks: new Decimal(0),
    playtimeMs: new Decimal(0),
    gold: new Decimal(0),
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    damagePerSwing: START_DAMAGE_PER_SWING,
    attackSpeed: START_ATTACK_SPEED_S,
    swingTimerMs: 0,
    critChance: CRIT_CHANCE,
    critMultiplier: CRIT_MULTIPLIER,
    upgrades: {},
    inventory: [],
    itemSeq: 0,
    rngSeed,
    monster: spawnMonster(FIRST_MONSTER),
    respawnMsLeft: 0,
    combatLog: [],
    msSinceAutosave: 0,
  }
}

export function pushEvent(log: CombatEvent[], event: CombatEvent): CombatEvent[] {
  return [event, ...log].slice(0, COMBAT_LOG_SIZE)
}
