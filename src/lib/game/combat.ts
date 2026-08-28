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
  REGEN_TICK_S,
  RESPAWN_DELAY_MS,
  REVIVE_DELAY_MS,
} from '../data/balance'
import { PLAN, rotationRate, type PlayMode, type RotationPlan, type RotationRate } from './rotation'
import type { Monster } from '../types'
import { SAFE_ZONE, ZONE_BY_ID, zoneMonsterVariants, type Zone } from '../data/zones'
import { monsterFromTemplate } from './state'
import { classById } from '../data/classes'

// Какой рукой бьём. Правило нормализации скорости одно на обе, отличаются
// только база боя и штраф левой руки.
export type Hand = 'main' | 'off'

/** Скорость оружия этой руки — БАЗОВАЯ, без haste. */
export function handSpeed(stats: StatBlock, hand: Hand): number {
  return hand === 'off' ? stats.offhandSpeed : stats.weaponSpeed
}

/** Время между ударами этой руки с учётом haste. Ускорение одно на обе. */
export function handSwingTime(stats: StatBlock, hand: Hand): number {
  return hand === 'off' ? stats.offhandSwingTime : stats.swingTime
}

/** Бьёт ли левая рука вообще: пустая рука урона не наносит. */
export function hasOffhand(stats: StatBlock): boolean {
  return stats.offhandDamageMax.gt(0)
}

/**
 * Какая доля силы атаки достаётся ОДНОМУ замаху руки.
 *
 * Сила атаки — свойство ГЕРОЯ, а не оружия: за секунду она обязана давать
 * attackPower / AP_NORMALIZATION урона, чем бы герой ни махал. Поэтому при двух
 * руках она между ними ДЕЛИТСЯ, а не удваивается. Делитель именно
 * `1 + offhandPenalty`, потому что удар левой руки потом целиком множится на
 * штраф: доли выходят 2/3 и 1/3, в сумме — единица.
 *
 * Без деления дуалвилд получал бы полторы силы атаки, и с её ростом один стиль
 * вытеснил бы остальные — сколько ни правь урон самого оружия в данных.
 */
function attackPowerShare(stats: StatBlock): number {
  return hasOffhand(stats) ? 1 / (1 + stats.offhandPenalty) : 1
}

// Вклад силы атаки в один удар: чем медленнее оружие, тем больше за удар.
export function attackPowerContribution(stats: StatBlock, hand: Hand = 'main'): Decimal {
  return stats.attackPower
    .times(handSpeed(stats, hand))
    .times(attackPowerShare(stats))
    .div(AP_NORMALIZATION)
}

// Границы урона одного удара без учёта крита.
export function swingDamageRange(
  stats: StatBlock,
  hand: Hand = 'main',
): { min: Decimal; max: Decimal } {
  const ap = attackPowerContribution(stats, hand)
  if (hand === 'off') {
    // Левая рука бьёт слабее на offhandPenalty — это плата за второй замах.
    return {
      min: stats.offhandDamageMin.plus(ap).times(stats.offhandPenalty),
      max: stats.offhandDamageMax.plus(ap).times(stats.offhandPenalty),
    }
  }
  return { min: stats.weaponDamageMin.plus(ap), max: stats.weaponDamageMax.plus(ap) }
}

// Матожидание урона удара без крита — им считаются оценки (dps, удары до смерти моба).
export function expectedSwingDamage(stats: StatBlock, hand: Hand = 'main'): Decimal {
  const { min, max } = swingDamageRange(stats, hand)
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
  hand: Hand = 'main',
): SwingResult {
  const { min, max } = swingDamageRange(stats, hand)
  const base = randRange(rng, min, max).times(weaponDamagePercent)
  const isCrit = rng() < stats.critChance
  return { amount: isCrit ? base.times(stats.critMultiplier) : base, isCrit }
}

/**
 * Бросок блока по входящему удару. Щит снимает фиксированную величину, а не
 * долю: против слабых ударов он тем и хорош, а против сильных не спасает —
 * ровно то, чего ждёшь от щита.
 */
export function rollBlock(
  stats: StatBlock,
  incoming: Decimal,
  rng: Rng,
): { amount: Decimal; blocked: boolean } {
  if (stats.blockChance <= 0 || stats.blockValue.lte(0)) return { amount: incoming, blocked: false }
  if (rng() >= stats.blockChance) return { amount: incoming, blocked: false }
  return { amount: Decimal.max(incoming.minus(stats.blockValue), new Decimal(0)), blocked: true }
}

// Матожидание урона удара умения без крита. Умения считаются ТОЙ ЖЕ формулой,
// что и автоатака: своей формулы урона у них нет, только доля.
export function expectedAbilityDamage(stats: StatBlock, weaponDamagePercent: Decimal): Decimal {
  return expectedSwingDamage(stats).times(weaponDamagePercent)
}

// Урон моба по герою: бросок из диапазона, затем срез на damageReduction.
// damageMultiplier — ярость босса: до неё единица, дальше растёт (см. dungeons.ts).
export function rollMonsterDamage(
  monster: Monster,
  stats: StatBlock,
  rng: Rng,
  damageMultiplier = 1,
): Decimal {
  const raw = randRange(rng, monster.damageMin, monster.damageMax)
  return raw.times(damageMultiplier).times(1 - stats.damageReduction)
}

export function expectedMonsterDamage(monster: Monster, stats: StatBlock): Decimal {
  return monster.damageMin.plus(monster.damageMax).div(2).times(1 - stats.damageReduction)
}

export interface CombatRate {
  // ВЕСЬ урон героя в секунду. Сумме двух чисел ниже он НЕ равен: умение
  // «на следующий удар» занимает замах автоатаки, и эти замахи входят в оба
  // слагаемых. Складывать их напрямую нельзя.
  damagePerSecond: Decimal
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

/**
 * Доля времени, которую герой что-то приносит.
 *
 * Цикл теперь один из двух, и выбирает между ними ПОРОГ ПРИВАЛА:
 *   порог выставлен — герой фармит до порога, потом сидит restDuration
 *                     и возвращается целым; простой короткий и управляемый;
 *   порога нет      — герой фармит до нуля и платит полным воскрешением.
 *
 * Оффлайн обязан считать по тому же правилу: время привалов вычитается из
 * полезного времени, иначе оффлайн обещал бы больше, чем даёт живая игра.
 */
export function uptimeFromHpLoss(
  maxHp: Decimal,
  hpLossPerSecond: Decimal,
  rest?: { hpThreshold: number; durationMs: number },
): number {
  if (hpLossPerSecond.lte(0)) return 1
  if (rest && rest.hpThreshold > 0) {
    // Падать герою есть куда только до порога: ниже он уходит отдыхать.
    const usableHp = maxHp.times(1 - rest.hpThreshold)
    if (usableHp.lte(0)) return 0
    const farmSec = usableHp.div(hpLossPerSecond)
    return farmSec.div(farmSec.plus(rest.durationMs / 1000)).toNumber()
  }
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
  const replaced = replacedSwingsPerSecond(stats, rotation)
  // Ударов в секунду: замахи ОБЕИХ рук плюс мгновенные умения. «На следующий
  // удар» новых ударов не добавляет — оно занимает уже существующий замах
  // правой руки, только бьёт он сильнее.
  const offRate = hasOffhand(stats)
    ? new Decimal(1).div(stats.offhandSwingTime)
    : new Decimal(0)
  let rate = swingRate.plus(offRate)
  let killing = swing.times(swingRate.minus(replaced)).plus(
    hasOffhand(stats) ? expectedSwingDamage(stats, 'off').times(offRate) : new Decimal(0),
  )
  let paced = killing
  for (const cast of rotation.casts) {
    const castRate = new Decimal(cast.castsPerSecond)
    if (cast.ability.type === 'instant') rate = rate.plus(castRate)
    killing = killing.plus(cast.hitDamage.times(castRate))
    paced = paced.plus(cast.totalDamage.times(castRate))
  }
  return { rate, killing, paced }
}

/**
 * Урон АВТОАТАКИ в секунду — обеих рук вместе.
 *
 * Свойство ОРУЖИЯ: сколько бы умений герой ни жал, «столько бьёт этот меч»
 * не меняется. Этим числом сравниваются предметы, и на нём держится инвариант
 * нормализации скорости.
 */
export function autoDamagePerSecond(stats: StatBlock): Decimal {
  return expectedSwingDamage(stats)
    .times(critFactor(stats))
    .div(stats.swingTime)
    .plus(offhandDamagePerSecond(stats))
}

/** Урон левой руки в секунду. Пустая рука не бьёт вовсе. */
export function offhandDamagePerSecond(stats: StatBlock): Decimal {
  if (!hasOffhand(stats)) return new Decimal(0)
  return expectedSwingDamage(stats, 'off').times(critFactor(stats)).div(stats.offhandSwingTime)
}

/** Сколько замахов в секунду занято умениями «на следующий удар». */
function replacedSwingsPerSecond(stats: StatBlock, rotation: RotationRate): Decimal {
  const used = rotation.casts.reduce(
    (sum, cast) =>
      cast.ability.type === 'onNextSwing' ? sum.plus(cast.castsPerSecond) : sum,
    new Decimal(0),
  )
  // Больше, чем герой успевает замахнуться, занять нельзя — очередь одна.
  return Decimal.min(used, new Decimal(1).div(stats.swingTime))
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

/** Время убийства по зоне: среднее и края по всем мобам, которых даёт спавн. */
export interface TtkEstimate {
  /** Самый быстрый моб зоны — по нему проверяется пол темпа. */
  min: number
  /** Среднее по пулу — основной показатель темпа зоны. */
  avg: number
  /** Самый долгий моб зоны — по нему проверяется потолок темпа. */
  max: number
}

/**
 * Ожидаемое время убийства (TTK) моба зоны при текущем билде, секунд.
 *
 * СВОЕЙ ФОРМУЛЫ ЗДЕСЬ НЕТ и быть не должно: длина боя вынимается из той же
 * estimateCombatRate, которая считает и урон, и темп зоны, и оффлайн. Иначе
 * контракт темпа мерил бы одну игру, а игрок играл бы в другую.
 *
 * idealKillsPerSecond — это 1 / (бой + респаун), поэтому сам бой получается
 * обратным ходом: вычитаем паузу респауна. Берётся именно ideal, без поправки
 * на смерти героя: TTK — про длину ОДНОГО боя, а смертность зоны — отдельная
 * характеристика (см. forecastZone).
 *
 * Перебор — по ВСЕМ мобам, которых может выдать спавн (пул × уровни), тем же
 * множеством, что и zoneRate.
 */
export function estimateZoneTtk(
  state: GameState,
  zone: string | Zone,
  mode: PlayMode = 'auto',
): TtkEstimate {
  const respawnSec = RESPAWN_DELAY_MS / 1000
  // Зона берётся из данных напрямую, а не через game/zones.ts: тот сам зовёт
  // combat.ts, и импорт обратно замкнул бы модули в кольцо.
  const target = typeof zone === 'string' ? (ZONE_BY_ID[zone] ?? SAFE_ZONE) : zone
  const variants = zoneMonsterVariants(target)
  if (variants.length === 0) return { min: 0, avg: 0, max: 0 }
  let total = 0
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const template of variants) {
    const facing: GameState = { ...state, monster: monsterFromTemplate(template) }
    const rate = estimateCombatRate(facing, mode)
    // Бесконечность здесь законна: герой может не пробивать моба вовсе.
    const cycle = rate.idealKillsPerSecond.gt(0)
      ? new Decimal(1).div(rate.idealKillsPerSecond).toNumber()
      : Number.POSITIVE_INFINITY
    const ttk = Math.max(0, cycle - respawnSec)
    total += ttk
    if (ttk < min) min = ttk
    if (ttk > max) max = ttk
  }
  return { min, avg: total / variants.length, max }
}

/** Среднее время убийства моба зоны, секунд. */
export function estimateTtk(
  state: GameState,
  zone: string | Zone,
  mode: PlayMode = 'auto',
): number {
  return estimateZoneTtk(state, zone, mode).avg
}

/**
 * Сколько ресурса приходит герою в секунду.
 *
 * У маны это чистый реген из статов. У ярости — доход ОТ БОЯ: своя автоатака
 * и чужие удары, помноженные на числа класса. Берётся именно автоатака, а не
 * весь урон: урон умений сам зависит от того, сколько их удалось применить,
 * и подставлять его сюда значило бы решать уравнение самим собой.
 */
/**
 * Пауза после траты, секунд.
 *
 * У маны это задержка правила плюс полломтя порции: приходит она РАЗ В
 * REGEN_TICK_S, и окно почти никогда не кончается ровно по границе ломтя.
 * У ярости — ноль: она приходит с каждым ударом, а не по таймеру, и штрафа
 * за «не успел к порции» у неё нет.
 */
export function resourcePause(state: GameState): number {
  const resource = classById(state.classId).resource
  const timed = resource.perSwingDealt.lte(0) && resource.perHitTaken.lte(0)
  return state.stats.regenDelay + (timed ? REGEN_TICK_S / 2 : 0)
}

export function resourceIncome(state: GameState, extraHitsPerSecond = 0): Decimal {
  const stats = state.stats
  const resource = classById(state.classId).resource
  if (resource.perSwingDealt.lte(0) && resource.perHitTaken.lte(0)) return stats.manaRegen
  // Ударов в секунду: свои — обе руки, чужие — замах моба. Умения сюда не
  // входят намеренно: их число само зависит от ресурса, и подставлять его
  // значило бы решать уравнение самим собой.
  const own = new Decimal(1).div(stats.swingTime).plus(
    hasOffhand(stats) ? new Decimal(1).div(stats.offhandSwingTime) : new Decimal(0),
  )
  const incoming =
    state.monster.swingTime > 0 && state.monster.damageMax.gt(0)
      ? new Decimal(1).div(state.monster.swingTime)
      : new Decimal(0)
  return stats.manaRegen
    .plus(own.plus(extraHitsPerSecond).times(resource.perSwingDealt).times(stats.maxMana))
    .plus(incoming.times(resource.perHitTaken).times(stats.maxMana))
}

function rawRate(state: GameState, plan: RotationPlan): CombatRate {
  const stats = state.stats
  const avgSwing = expectedSwingDamage(stats)
  const respawnSec = RESPAWN_DELAY_MS / 1000
  // Ресурс из боя — уравнение с самим собой: удары умений тоже дают ярость,
  // а число умений зависит от ярости. Решаем ДВУМЯ проходами: сперва доход
  // от одних автоатак, потом — с учётом посчитанных мгновенных ударов.
  // Двух хватает: второй проход меняет ответ на проценты, третий — на доли.
  const pause = resourcePause(state)
  let rotation = rotationRate(stats, state.abilitySettings, plan, resourceIncome(state), pause)
  if (classById(state.classId).resource.perSwingDealt.gt(0)) {
    // Умения «на следующий удар» ЗАМЕНЯЮТ автоатаку и лишнего удара не дают.
    const extraHits = rotation.casts
      .filter((c) => c.ability.type === 'instant')
      .reduce((sum, c) => sum + c.castsPerSecond, 0)
    rotation = rotationRate(
      stats,
      state.abilitySettings,
      plan,
      resourceIncome(state, extraHits),
      pause,
    )
  }
  // Урон автоатаки — свойство ОРУЖИЯ и считается как считался: сколько бы
  // умений герой ни жал, «столько бьёт этот меч» не меняется. Этим числом
  // сравниваются предметы, и на нём держится инвариант нормализации скорости.
  // Автоатака — это ОБЕ руки: у каждой свой таймер и свой урон за удар.
  const autoDps = autoDamagePerSecond(stats)
  // Сложить автоатаку и умения напрямую НЕЛЬЗЯ: умение «на следующий удар»
  // ЗАМЕНЯЕТ автоатаку, а не добавляется к ней, — эти замахи посчитаны дважды.
  // Пока бой длился полтора удара, ошибка была незаметной; на длинном бою она
  // делала оффлайн выгоднее живой игры, то есть ломала железное правило.
  const replaced = replacedSwingsPerSecond(stats, rotation).times(avgSwing).times(critFactor(stats))
  // Урон в секунду, реально дошедший до мобов: сырой темп минус перебой.
  const raw = autoDps.plus(rotation.damagePerSecond).minus(replaced)
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
      autoDamagePerSecond: autoDps,
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
    autoDamagePerSecond: autoDps,
    abilityDamagePerSecond: rotation.damagePerSecond,
    killsPerSecond: idealKillsPerSecond.times(uptime),
    idealKillsPerSecond,
    hpLossPerSecond: netLossPerSec,
    uptime,
    timeToDeathSec: stats.maxHp.div(netLossPerSec).toNumber(),
  }
}
