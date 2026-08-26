// Чистая функция симуляции одного шага. Не знает про Svelte, DOM и время кадров:
// получает состояние и длительность шага, возвращает новое состояние.
import { Decimal, formatNumber } from './numbers'
import { applyXp, xpToNextLevel } from './formulas'
import type { Item, Monster, MonsterTemplate } from '../types'
import { FIRST_MONSTER } from '../data/monsters'
import { RARITY_BY_ID } from '../data/rarity'
import { INVENTORY_SIZE, rollLoot, type Rng } from './loot'

// Пауза между смертью моба и появлением следующего.
export const RESPAWN_DELAY_MS = 300
// Сколько последних событий боя храним для лога на экране.
export const COMBAT_LOG_SIZE = 5

export interface GameState {
  totalTicks: Decimal
  playtimeMs: Decimal
  gold: Decimal
  level: Decimal
  currentXp: Decimal
  xpToNext: Decimal
  baseDamage: Decimal // пока равен урону в секунду; апгрейды добавляют к нему
  upgrades: Record<string, Decimal> // id апгрейда -> сколько куплено
  inventory: Item[]
  itemSeq: number // служебный счётчик для уникальных id предметов
  monster: Monster
  // Служебный обратный отсчёт до респауна в мс (как dtMs): 0 — моб жив.
  respawnMsLeft: number
  combatLog: string[] // последние события, новые в начале
}

export function spawnMonster(template: MonsterTemplate): Monster {
  return { ...template, currentHp: template.maxHp }
}

export function createInitialState(): GameState {
  const level = new Decimal(1)
  return {
    totalTicks: new Decimal(0),
    playtimeMs: new Decimal(0),
    gold: new Decimal(0),
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    baseDamage: new Decimal(10),
    upgrades: {},
    inventory: [],
    itemSeq: 0,
    monster: spawnMonster(FIRST_MONSTER),
    respawnMsLeft: 0,
    combatLog: [],
  }
}

function pushLog(log: string[], entry: string): string[] {
  return [entry, ...log].slice(0, COMBAT_LOG_SIZE)
}

export function tick(state: GameState, dtMs: number, rng: Rng = Math.random): GameState {
  const s: GameState = {
    ...state,
    totalTicks: state.totalTicks.plus(1),
    playtimeMs: state.playtimeMs.plus(dtMs),
  }

  // Моб мёртв — ждём респауна вместо боя.
  if (s.respawnMsLeft > 0) {
    const left = s.respawnMsLeft - dtMs
    if (left > 0) return { ...s, respawnMsLeft: left }
    const monster = spawnMonster(FIRST_MONSTER)
    return {
      ...s,
      respawnMsLeft: 0,
      monster,
      combatLog: pushLog(s.combatLog, `Появился ${monster.name}`),
    }
  }

  // Урон за шаг: baseDamage — это урон в секунду, поэтому dps * dt / 1000;
  // итог не зависит от частоты шагов симуляции.
  const damage = s.baseDamage.times(dtMs).div(1000)
  const hpLeft = s.monster.currentHp.minus(damage)

  if (hpLeft.lte(0)) {
    const { name, goldReward, xpReward } = s.monster
    const leveled = applyXp(s.level, s.currentXp, xpReward)
    let combatLog = pushLog(
      s.combatLog,
      `${name} повержен! +${formatNumber(goldReward)} золота, +${formatNumber(xpReward)} опыта`,
    )
    if (leveled.level.gt(s.level)) {
      combatLog = pushLog(combatLog, `Новый уровень: ${formatNumber(leveled.level)}!`)
    }
    // Дроп лута: только если есть свободный слот в инвентаре.
    let inventory = s.inventory
    let itemSeq = s.itemSeq
    if (inventory.length < INVENTORY_SIZE) {
      const item = rollLoot(rng, itemSeq)
      if (item) {
        inventory = [...inventory, item]
        itemSeq += 1
        combatLog = pushLog(combatLog, `Выпало: ${item.name} [${RARITY_BY_ID[item.rarity].name}]`)
      }
    }
    return {
      ...s,
      monster: { ...s.monster, currentHp: new Decimal(0) },
      gold: s.gold.plus(goldReward),
      inventory,
      itemSeq,
      level: leveled.level,
      currentXp: leveled.currentXp,
      xpToNext: leveled.xpToNext,
      respawnMsLeft: RESPAWN_DELAY_MS,
      combatLog,
    }
  }

  return { ...s, monster: { ...s.monster, currentHp: hpLeft } }
}
