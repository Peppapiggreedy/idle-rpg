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
import {
  AP_NORMALIZATION,
  AUTOCAST_DELAY_MS,
  AUTOCAST_MAX_LOSS,
  RESPAWN_DELAY_MS,
  REVIVE_DELAY_MS,
} from '../data/balance'
import { PLAN, rotationRate, type PlayMode, type RotationPlan, type RotationRate } from './rotation'
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
// weaponDamagePercent — доля удара оружия: 1 у автоатаки, у умений своя.
// Умножаем ДО крита, чтобы крит множил уже итоговый урон умения.
export function rollSwing(
  stats: StatBlock,
  rng: Rng,
  weaponDamagePercent: Decimal = new Decimal(1),
): SwingResult {
  const weaponRoll = randRange(rng, stats.weaponDamageMin, stats.weaponDamageMax)
  const base = weaponRoll.plus(attackPowerContribution(stats)).times(weaponDamagePercent)
  const isCrit = rng() < stats.critChance
  return { amount: isCrit ? base.times(stats.critMultiplier) : base, isCrit }
}

// Матожидание урона удара умения без крита. Умения считаются ТОЙ ЖЕ формулой,
// что и автоатака: своей формулы урона у них нет, только доля.
export function expectedAbilityDamage(stats: StatBlock, weaponDamagePercent: Decimal): Decimal {
  return expectedSwingDamage(stats).times(weaponDamagePercent)
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
  damagePerSecond: Decimal // ВЕСЬ урон героя в секунду: автоатака + умения
  autoDamagePerSecond: Decimal // только автоатака
  abilityDamagePerSecond: Decimal // только умения при выбранном режиме игры
  killsPerSecond: Decimal // убийств в секунду С УЧЁТОМ смертей героя (uptime)
  idealKillsPerSecond: Decimal // то же без учёта смертей — герой бессмертен
  // Чистая потеря HP в секунду: входящий урон минус реген. 0 — герой не тает.
  hpLossPerSecond: Decimal
  // Доля времени, которую герой жив и фармит: 1 — бессмертен в этой зоне.
  uptime: number
  // Секунд от полного HP до смерти при отрицательном балансе HP; null — не умирает.
  timeToDeathSec: number | null
}

// Цикл жизни героя: timeToDeath секунд фарма + фиксированный простой на
// воскрешение. Отсюда доля времени, которую он вообще что-то приносит.
export function uptimeFromHpLoss(maxHp: Decimal, hpLossPerSecond: Decimal): number {
  if (hpLossPerSecond.lte(0)) return 1
  const timeToDeathSec = maxHp.div(hpLossPerSecond)
  return timeToDeathSec.div(timeToDeathSec.plus(REVIVE_DELAY_MS / 1000)).toNumber()
}

/**
 * Темп боя при выбранном режиме игры. 'auto' — герой предоставлен сам себе
 * (автокаст с задержкой реакции), 'manual' — игрок жмёт умения сам. Разницу
 * между режимами целиком описывает rotation.ts; здесь она только складывается
 * с автоатакой. По умолчанию считаем АВТО: это то, что герой выдаёт без игрока.
 */
/**
 * Сколько урона уходит на ОДНО убийство, включая перебой добивающего удара.
 *
 * Рука придерживает бурст и добивает обычным замахом — перебой минимальный,
 * половина замаха. Авто не придерживает кулдауны и добивает чем придётся,
 * поэтому у него убийство квантуется по СРЕДНЕМУ удару потока: чем крупнее
 * умения относительно моба, тем больше уходит мимо. Это второе (и последнее)
 * правило, из которого берётся отставание авто.
 */
function damagePerKill(state: GameState, rotation: RotationRate, plan: RotationPlan): Decimal {
  const hp = state.monster.maxHp
  const swing = expectedSwingDamage(state.stats)
  // Минимум перебоя — половина обычного замаха: меньше не теряет никто.
  const floor = hp.plus(swing.div(2))
  // Перебой — следствие второго правила: авто не придерживает кулдауны и
  // добивает чем придётся. Рука бурст придерживает, у неё перебоя сверх
  // обычного замаха нет.
  if (!plan.delayed) return floor
  const stream = hitStream(state.stats, rotation)
  if (stream.rate.lte(0)) return floor
  const averageHit = stream.killing.div(stream.rate)
  // Целое число ударов среднего размера: последний почти всегда с перебоем.
  // Ниже минимума не опускаемся — авто не может терять меньше руки.
  return Decimal.max(hp.div(averageHit).ceil().times(averageHit), floor)
}

/**
 * Поток ударов героя: автоатака плюс касты умений. Урон приходит НЕ ровным
 * ручейком, а порциями — от этого зависит и длина боя, и перебой.
 * `killing` — только сам удар: добить моба может он, но не тики эффекта.
 * `paced` — удар вместе с его эффектом: по нему считается длина боя, ведь
 * эффект всё равно доедает моба следом.
 */
function hitStream(
  stats: StatBlock,
  rotation: RotationRate,
): { rate: Decimal; killing: Decimal; paced: Decimal } {
  const swingRate = new Decimal(1).div(stats.swingTime)
  const swing = expectedSwingDamage(stats)
  let rate = swingRate
  let killing = swing.times(swingRate)
  let paced = killing
  for (const cast of rotation.casts) {
    const castRate = new Decimal(cast.castsPerSecond)
    rate = rate.plus(castRate)
    killing = killing.plus(cast.hitDamage.times(castRate))
    paced = paced.plus(cast.totalDamage.times(castRate))
  }
  return { rate, killing, paced }
}

export function estimateCombatRate(state: GameState, mode: PlayMode = 'auto'): CombatRate {
  const rate = rawRate(state, PLAN[mode])
  if (mode === 'manual') return rate
  // ЖЕЛЕЗНОЕ ПРАВИЛО в одном месте: автокаст не бывает выгоднее ручной игры
  // и не отстаёт от неё больше, чем на AUTOCAST_MAX_LOSS. Внутри модели оба
  // числа считаются одинаково честно, но округления (целое число ударов на
  // убийство, целое число ударов моба за бой) могут дать расхождение в доли
  // процента не в ту сторону — здесь оно и снимается.
  // Точка отсчёта — ТА ЖЕ ротация, сыгранная руками. Снятые игроком галки
  // потолок не покрывает: отказ от умения стоит ровно столько, сколько стоит.
  const byHand = rawRate(state, PLAN.autocastByHand)
  const bounded = (auto: Decimal, hand: Decimal) =>
    Decimal.min(Decimal.max(auto, hand.times(1 - AUTOCAST_MAX_LOSS)), hand)
  return {
    ...rate,
    damagePerSecond: bounded(rate.damagePerSecond, byHand.damagePerSecond),
    killsPerSecond: bounded(rate.killsPerSecond, byHand.killsPerSecond),
    idealKillsPerSecond: bounded(rate.idealKillsPerSecond, byHand.idealKillsPerSecond),
  }
}

function rawRate(state: GameState, plan: RotationPlan): CombatRate {
  const stats = state.stats
  const avgSwing = expectedSwingDamage(stats)
  const autoDamagePerSecond = avgSwing.times(critFactor(stats)).div(stats.swingTime)
  const respawnSec = RESPAWN_DELAY_MS / 1000
  const rotation = rotationRate(stats, state.abilitySettings, plan)
  // Урон в секунду, реально дошедший до мобов: сырой темп минус перебой.
  const raw = autoDamagePerSecond.plus(rotation.damagePerSecond)
  const perKill = damagePerKill(state, rotation, plan)
  const damagePerSecond = raw.times(state.monster.maxHp.div(perKill))
  // Длина боя — из уже посчитанного урона в секунду (он уже с поправкой на
  // перебой). Дискретность ударов сидит внутри damagePerKill, поэтому здесь
  // деление честное и без округлений.
  // Длина боя — ЦЕЛОЕ число ударов потока, а не «столько-то секунд ровного
  // урона». Это принципиально: каждый бой начинается с нуля — замах копится
  // заново, автокаст выжидает задержку реакции. Непрерывная модель этого не
  // видит и торопит бой процентов на пятнадцать, а от длины боя зависит
  // весь оффлайн.
  const stream = hitStream(stats, rotation)
  const averagePaced = stream.rate.gt(0) ? stream.paced.div(stream.rate) : new Decimal(1)
  const hitsPerKill = averagePaced.gt(0)
    ? Decimal.max(perKill.div(averagePaced).ceil(), new Decimal(1))
    : new Decimal(1)
  const fightSec = stream.rate.gt(0)
    ? hitsPerKill.div(stream.rate)
    : new Decimal(stats.swingTime)
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
    return {
      damagePerSecond,
      autoDamagePerSecond,
      abilityDamagePerSecond: rotation.damagePerSecond,
      killsPerSecond: idealKillsPerSecond,
      idealKillsPerSecond,
      hpLossPerSecond: new Decimal(0),
      uptime: 1,
      timeToDeathSec: null,
    }
  }
  const uptime = uptimeFromHpLoss(stats.maxHp, netLossPerSec)
  return {
    damagePerSecond,
    autoDamagePerSecond,
    abilityDamagePerSecond: rotation.damagePerSecond,
    killsPerSecond: idealKillsPerSecond.times(uptime),
    idealKillsPerSecond,
    hpLossPerSecond: netLossPerSec,
    uptime,
    timeToDeathSec: stats.maxHp.div(netLossPerSec).toNumber(),
  }
}
