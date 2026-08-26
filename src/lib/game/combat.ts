// Единственный источник оценки боевого темпа. Использовать и в UI (урон в
// секунду), и в оффлайн-агрегате — чтобы формула боя не жила в двух местах.
// Оффлайн моделирует цикл «фарм -> смерть -> воскрешение -> фарм» через uptime.
import { Decimal } from './numbers'
import type { GameState } from './state'
import { RESPAWN_DELAY_MS, REVIVE_DELAY_MS } from '../data/balance'

export interface CombatRate {
  damagePerSecond: Decimal // средний урон героя в секунду с матожиданием критов
  killsPerSecond: Decimal // убийств в секунду С УЧЁТОМ смертей героя (uptime)
  // Доля времени, которую герой жив и фармит: 1 — бессмертен в этой зоне.
  uptime: number
  // Секунд от полного HP до смерти при отрицательном балансе HP; null — не умирает.
  timeToDeathSec: number | null
}

export function estimateCombatRate(state: GameState): CombatRate {
  const { attackPower, attackSpeed, critChance, critMultiplier } = state.stats
  // Матожидание множителя урона: 1 + шанс_крита * (множитель - 1).
  const critFactor = new Decimal(1).plus(critMultiplier.minus(1).times(critChance))
  const damagePerSecond = attackPower.times(critFactor).div(attackSpeed)
  // Ударов на моба считаем по базовому урону (без критов): дискретность важнее
  // редких критов, при крит-шансе ~5% погрешность оценки в пределах пары процентов.
  const hitsPerKill = state.monster.maxHp.div(attackPower).ceil()
  const fightSec = hitsPerKill.times(attackSpeed)
  const respawnSec = RESPAWN_DELAY_MS / 1000
  const killCycleSec = fightSec.plus(respawnSec)
  const idealKillsPerSecond = new Decimal(1).div(killCycleSec)

  // Баланс HP за цикл: входящие удары моба (целым числом за фазу боя) минус
  // реген (в бою медленный, в паузе респауна быстрый).
  const monsterHitsPerCycle = state.monster.damage.gt(0)
    ? fightSec.div(state.monster.attackSpeed).floor()
    : new Decimal(0)
  const incomingPerCycle = monsterHitsPerCycle
    .times(state.monster.damage)
    .times(1 - state.stats.damageReduction)
  const regenPerCycle = state.stats.hpRegen
    .times(fightSec)
    .plus(state.stats.hpRegenOutOfCombat.times(respawnSec))
  const netLossPerSec = incomingPerCycle.minus(regenPerCycle).div(killCycleSec)

  if (netLossPerSec.lte(0)) {
    return { damagePerSecond, killsPerSecond: idealKillsPerSecond, uptime: 1, timeToDeathSec: null }
  }
  // Жизненный цикл героя: timeToDeath секунд фарма + 30 секунд простоя.
  const timeToDeathSec = state.stats.maxHp.div(netLossPerSec)
  const uptime = timeToDeathSec.div(timeToDeathSec.plus(REVIVE_DELAY_MS / 1000)).toNumber()
  return {
    damagePerSecond,
    killsPerSecond: idealKillsPerSecond.times(uptime),
    uptime,
    timeToDeathSec: timeToDeathSec.toNumber(),
  }
}
