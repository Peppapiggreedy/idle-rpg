// Чистая функция симуляции одного шага. Не знает про Svelte, DOM и время кадров:
// получает состояние и длительность шага, возвращает новое состояние.
import { Decimal, formatNumber } from './numbers'
import type { Monster, MonsterTemplate } from '../types'
import { FIRST_MONSTER } from '../data/monsters'

// Пауза между смертью моба и появлением следующего.
export const RESPAWN_DELAY_MS = 300
// Сколько последних событий боя храним для лога на экране.
export const COMBAT_LOG_SIZE = 5

export interface GameState {
  totalTicks: Decimal
  playtimeMs: Decimal
  gold: Decimal
  xp: Decimal
  damagePerSecond: Decimal
  monster: Monster
  // Служебный обратный отсчёт до респауна в мс (как dtMs): 0 — моб жив.
  respawnMsLeft: number
  combatLog: string[] // последние события, новые в начале
}

export function spawnMonster(template: MonsterTemplate): Monster {
  return { ...template, currentHp: template.maxHp }
}

export function createInitialState(): GameState {
  return {
    totalTicks: new Decimal(0),
    playtimeMs: new Decimal(0),
    gold: new Decimal(0),
    xp: new Decimal(0),
    damagePerSecond: new Decimal(10),
    monster: spawnMonster(FIRST_MONSTER),
    respawnMsLeft: 0,
    combatLog: [],
  }
}

function pushLog(log: string[], entry: string): string[] {
  return [entry, ...log].slice(0, COMBAT_LOG_SIZE)
}

export function tick(state: GameState, dtMs: number): GameState {
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

  // Урон за шаг: dps * dt / 1000 — итог не зависит от частоты шагов симуляции.
  const damage = s.damagePerSecond.times(dtMs).div(1000)
  const hpLeft = s.monster.currentHp.minus(damage)

  if (hpLeft.lte(0)) {
    const { name, goldReward, xpReward } = s.monster
    return {
      ...s,
      monster: { ...s.monster, currentHp: new Decimal(0) },
      gold: s.gold.plus(goldReward),
      xp: s.xp.plus(xpReward),
      respawnMsLeft: RESPAWN_DELAY_MS,
      combatLog: pushLog(
        s.combatLog,
        `${name} повержен! +${formatNumber(goldReward)} золота, +${formatNumber(xpReward)} опыта`,
      ),
    }
  }

  return { ...s, monster: { ...s.monster, currentHp: hpLeft } }
}
