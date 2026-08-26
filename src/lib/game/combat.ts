// ЕДИНСТВЕННЫЙ дом боевых формул. Урон удара, криты, урон мобов и оценка темпа
// боя живут только здесь: tick вызывает их для реального удара, estimateCombatRate —
// для оценки, оффлайн-агрегат использует estimateCombatRate и своей формулы не имеет.
//
// Формулы:
//   swingTime   = weaponSpeed / (1 + haste)
//   swingDamage = rand(weaponDamageMin, weaponDamageMax)
//                 + attackPower * weaponSpeed / AP_NORMALIZATION
// Во второй формуле стоит БАЗОВАЯ weaponSpeed, а не ускоренная swingTime: иначе
// haste сократился бы сам с собой и перестал повышать урон в секунду вообще.
// Медленное оружие получает больший вклад силы атаки за удар — ровно настолько,
// чтобы сравняться по урону в секунду с быстрым.
import { Decimal } from './numbers'
import { randRange, type Rng } from './rng'
import type { GameState } from './state'
import type { StatBlock } from './stats'
import { AP_NORMALIZATION, RESPAWN_DELAY_MS, REVIVE_DELAY_MS } from '../data/balance'
import type { Monster } from '../types'

// Вклад силы атаки в один удар: чем медленнее оружие, тем больше за удар.
export function attackPowerContribution(stats: StatBlock): Decimal {
  return stats.attackPower.times(stats.weaponSpeed).div(AP_NORMALIZATION)
}

// Границы урона одного удара без учёта крита.
export function swingDamageRange(stats: StatBlock): { min: Decimal; max: Decimal } {
  const ap = attackPowerContribution(stats)
  return { min: stats.weaponDamageMin.plus(ap), max: stats.weaponDamageMax.plus(ap) }
}

// Матожидание урона удара без крита — им считаются оценки (dps, удары до смерти моба).
export function expectedSwingDamage(stats: StatBlock): Decimal {
  const { min, max } = swingDamageRange(stats)
  return min.plus(max).div(2)
}

// Матожидание множителя урона: 1 + шанс_крита * (множитель - 1).
export function critFactor(stats: StatBlock): Decimal {
  return new Decimal(1).plus(stats.critMultiplier.minus(1).times(stats.critChance))
}

export interface SwingResult {
  amount: Decimal
  isCrit: boolean
}

// Один удар героя: сперва бросок урона оружия, затем бросок крита.
// Порядок бросков фиксирован — от него зависит воспроизводимость прогонов.
export function rollSwing(stats: StatBlock, rng: Rng): SwingResult {
  const weaponRoll = randRange(rng, stats.weaponDamageMin, stats.weaponDamageMax)
  const base = weaponRoll.plus(attackPowerContribution(stats))
  const isCrit = rng() < stats.critChance
  return { amount: isCrit ? base.times(stats.critMultiplier) : base, isCrit }
}

// Урон моба по герою: бросок из диапазона, затем срез на damageReduction.
export function rollMonsterDamage(monster: Monster, stats: StatBlock, rng: Rng): Decimal {
  const raw = randRange(rng, monster.damageMin, monster.damageMax)
  return raw.times(1 - stats.damageReduction)
}

export function expectedMonsterDamage(monster: Monster, stats: StatBlock): Decimal {
  return monster.damageMin.plus(monster.damageMax).div(2).times(1 - stats.damageReduction)
}

export interface CombatRate {
  damagePerSecond: Decimal // средний урон героя в секунду с матожиданием критов
  killsPerSecond: Decimal // убийств в секунду С УЧЁТОМ смертей героя (uptime)
  // Доля времени, которую герой жив и фармит: 1 — бессмертен в этой зоне.
  uptime: number
  // Секунд от полного HP до смерти при отрицательном балансе HP; null — не умирает.
  timeToDeathSec: number | null
}

export function estimateCombatRate(state: GameState): CombatRate {
  const stats = state.stats
  const avgSwing = expectedSwingDamage(stats)
  const damagePerSecond = avgSwing.times(critFactor(stats)).div(stats.swingTime)
  // Ударов на моба считаем по среднему урону без критов: дискретность важнее
  // редких критов, при крит-шансе ~5% погрешность оценки в пределах пары процентов.
  const hitsPerKill = state.monster.maxHp.div(avgSwing).ceil()
  const fightSec = hitsPerKill.times(stats.swingTime)
  const respawnSec = RESPAWN_DELAY_MS / 1000
  const killCycleSec = fightSec.plus(respawnSec)
  const idealKillsPerSecond = new Decimal(1).div(killCycleSec)

  // Баланс HP за цикл: входящие удары моба (целым числом за фазу боя) минус
  // реген (в бою медленный, в паузе респауна быстрый).
  const avgIncoming = expectedMonsterDamage(state.monster, stats)
  const monsterHitsPerCycle = avgIncoming.gt(0)
    ? fightSec.div(state.monster.swingTime).floor()
    : new Decimal(0)
  const incomingPerCycle = monsterHitsPerCycle.times(avgIncoming)
  const regenPerCycle = stats.hpRegen
    .times(fightSec)
    .plus(stats.hpRegenOutOfCombat.times(respawnSec))
  const netLossPerSec = incomingPerCycle.minus(regenPerCycle).div(killCycleSec)

  if (netLossPerSec.lte(0)) {
    return { damagePerSecond, killsPerSecond: idealKillsPerSecond, uptime: 1, timeToDeathSec: null }
  }
  // Жизненный цикл героя: timeToDeath секунд фарма + 30 секунд простоя.
  const timeToDeathSec = stats.maxHp.div(netLossPerSec)
  const uptime = timeToDeathSec.div(timeToDeathSec.plus(REVIVE_DELAY_MS / 1000)).toNumber()
  return {
    damagePerSecond,
    killsPerSecond: idealKillsPerSecond.times(uptime),
    uptime,
    timeToDeathSec: timeToDeathSec.toNumber(),
  }
}
