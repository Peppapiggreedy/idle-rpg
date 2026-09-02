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
  FIGHT_COST_SPREAD,
  levelGapDamageMult,
  REGEN_TICK_S,
  RESPAWN_DELAY_MS,
  REVIVE_DELAY_MS,
} from '../data/balance'
import { PLAN, rotationRate, type PlayMode, type RotationPlan, type RotationRate } from './rotation'
import type { Monster } from '../types'
import { SAFE_ZONE, ZONE_BY_ID, zoneMonsterVariants, type Zone } from '../data/zones'
import { monsterFromTemplate, type AbilitySettings } from './state'
import { ABILITY_BY_ID } from '../data/abilities'
import { classById } from '../data/classes'
import { blockReflectShare, blockResourceShare, doubleStrikeChance } from './talents'
import { statsWithPotionPlan, statsWithoutPotions } from './potions'
import { PROC_BY_ID, type ProcDef } from '../data/procs'
import { SLOT_IDS } from '../data/slots'

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

// Урон моба по герою: бросок из диапазона, штраф за разрыв уровней, затем
// срез на damageReduction.
// damageMultiplier — ярость босса: до неё единица, дальше растёт (см. dungeons.ts).
//
// УРОВЕНЬ ГЕРОЯ ПРИХОДИТ ПАРАМЕТРОМ, а не берётся из статов: конвейер статов
// про уровни мобов ничего не знает и знать не должен, а штраф за разрыв —
// свойство ПАРЫ «герой против этого моба», а не свойство героя.
export function rollMonsterDamage(
  monster: Monster,
  stats: StatBlock,
  heroLevel: number,
  rng: Rng,
  damageMultiplier = 1,
): Decimal {
  const raw = randRange(rng, monster.damageMin, monster.damageMax)
  return raw
    .times(damageMultiplier)
    .times(levelGapDamageMult(heroLevel, monster.level))
    .times(1 - stats.damageReduction)
}

/**
 * Средний входящий удар по герою: бросок, штраф за разрыв, срез на
 * damageReduction — и БЛОК.
 *
 * БЛОК ЗДЕСЬ ПОЯВИЛСЯ НЕ СРАЗУ, и его отсутствие было настоящей дырой. В тике
 * блок есть (`rollBlock`), в модели его не было, и модель завышала входящий
 * урон на четверть у любого героя со щитом. На этой оценке держатся прогноз
 * зоны, аптайм, оффлайн и порог привала — то есть игра и её собственная
 * модель расходились в самом главном числе на 25%.
 *
 * Считается матожиданием, как и криты: шанс блока умножить на то, сколько
 * блок реально снимает (а снять больше самого удара он не может).
 */
export function expectedMonsterDamage(
  monster: Monster,
  stats: StatBlock,
  heroLevel: number,
): Decimal {
  const incoming = monster.damageMin
    .plus(monster.damageMax)
    .div(2)
    .times(levelGapDamageMult(heroLevel, monster.level))
    .times(1 - stats.damageReduction)
  if (stats.blockChance <= 0 || stats.blockValue.lte(0)) return incoming
  return incoming.minus(Decimal.min(stats.blockValue, incoming).times(stats.blockChance))
}

export interface CombatRate {
  // ВЕСЬ урон героя в секунду. Сумме двух чисел ниже он НЕ равен: умение
  // «на следующий удар» занимает замах автоатаки, и эти замахи входят в оба
  // слагаемых. Складывать их напрямую нельзя.
  damagePerSecond: Decimal
  autoDamagePerSecond: Decimal // только автоатака
  /** Сколько из damagePerSecond приносят проки — UI показывает это строкой. */
  procDamagePerSecond: Decimal
  abilityDamagePerSecond: Decimal // только умения при выбранном режиме игры
  killsPerSecond: Decimal // убийств в секунду С УЧЁТОМ смертей героя (uptime)
  idealKillsPerSecond: Decimal // то же без учёта смертей — герой бессмертен
  // Чистая потеря HP в секунду: входящий урон минус реген. 0 — герой не тает.
  hpLossPerSecond: Decimal
  // Доля времени, которую герой жив и фармит: 1 — бессмертен в этой зоне.
  uptime: number
  // Секунд от полного HP до смерти при отрицательном балансе HP; null — не умирает.
  timeToDeathSec: number | null
  // Сколько мобов герой добивает между привалами В СРЕДНЕМ (дробное число:
  // см. farmCycle); бесконечность — не тает.
  killsPerCycle: number
  // Вероятность, что цикл кончится смертью, а не привалом: порог выставлен
  // слишком низко для этой зоны, и в последнюю схватку герой входит без запаса.
  deathChancePerCycle: number
  // Смерть вероятнее привала (deathChancePerCycle >= 0.5).
  diesInCycle: boolean
}

/** Что выходит из череды боёв между двумя привалами (или до смерти) — В СРЕДНЕМ. */
export interface FarmCycle {
  /** Матожидание убийств за цикл. Дробное: это среднее по сотням циклов. */
  kills: number
  /** Матожидание длины цикла: бои плюс привал либо воскрешение, секунд. */
  cycleSec: number
  /** Доля времени цикла, потраченная на бои, кончившиеся убийством. */
  uptime: number
  /** Вероятность, что цикл кончится смертью, а не привалом. */
  deathChance: number
  /** Смерть вероятнее привала: `deathChance >= 0.5`. */
  dies: boolean
}

/**
 * Череда боёв между привалами — ДОЛГОСРОЧНОЕ СРЕДНЕЕ, а не один цикл.
 *
 * Привал стоит между боями: герой доводит схватку до конца и уходит отдыхать
 * только после убийства, если здоровье упало ниже порога. Отсюда риск: в
 * последнюю схватку цикла он входит с запасом чуть выше порога, и если бой
 * стоит больше — он оттуда не выйдет.
 *
 * ПОЧЕМУ БЕЗ ЦЕЛЫХ ЧИСЕЛ. За час игры проходят сотни циклов, и цена каждого
 * боя гуляет: броски урона героя и криты меняют длину схватки, а с ней число
 * ответных ударов моба. Поэтому точка, где накопленная потеря пересекает
 * порог, ложится в разные места разных боёв — фаза пересечения размазана по
 * бою равномерно. Целое `floor(запас/цена) + 1`, усреднённое по такой фазе,
 * равно `запас/цена + 1/2`, и именно это среднее здесь считается. Прежняя
 * модель брала floor/ceil одного цикла, и оценка была ступенчатой: лишняя
 * единица силы атаки перекидывала цикл с двух боёв на один или с привала на
 * смерть, и темп убийств прыгал втрое (откат 4a000e4, AUDIT.md). Метрикой
 * сравнения предметов такое число служить не может.
 *
 * По той же логике смерть — не флаг, а ВЕРОЯТНОСТЬ: запас на входе в
 * последний бой равен порогу плюс половине цены боя (середина фазы), но не
 * больше полного; цена самого боя разбросана на ±FIGHT_COST_SPREAD вокруг
 * средней, и гибель — это доля разброса, лежащая выше запаса. Цикл, где
 * гибель вероятнее привала, помечается `dies`.
 */
export function farmCycle(params: {
  maxHp: Decimal
  /** Чистая потеря HP в секунду: входящий урон минус реген. */
  lossPerSecond: Decimal
  /** Секунд на один цикл убийства: бой плюс пауза респауна. */
  cycleSec: number
  /** Порог привала, доля запаса. 0 — привалов нет вовсе, цикл кончается смертью. */
  hpThreshold: number
  restSec: number
}): FarmCycle {
  const { maxHp, lossPerSecond, cycleSec, hpThreshold, restSec } = params
  const reviveSec = REVIVE_DELAY_MS / 1000
  const endless: FarmCycle = {
    kills: Number.POSITIVE_INFINITY,
    cycleSec,
    uptime: 1,
    deathChance: 0,
    dies: false,
  }
  if (lossPerSecond.lte(0) || cycleSec <= 0) return endless
  const hp = maxHp.toNumber()
  const loss = lossPerSecond.times(cycleSec).toNumber()
  if (loss <= 0 || hp <= 0) return endless
  const threshold = hpThreshold > 0 ? hp * hpThreshold : 0
  // Сколько средних боёв помещается в запас над порогом.
  const budget = (hp - threshold) / loss
  // Боёв в цикле: floor(budget) + 1, усреднённое по фазе пересечения порога.
  // Первый бой герой проводит всегда — меньше одного не бывает.
  const fights = Math.max(1, budget + 0.5)
  // Запас на входе в последний бой: порог плюс половина цены (середина фазы),
  // но не больше полного — из привала герой выходит с полным запасом.
  const enterHp = Math.min(hp, threshold + loss / 2)
  // Гибель — доля разброса цены боя, лежащая выше запаса на входе.
  const spread = loss * FIGHT_COST_SPREAD
  const deathChance =
    spread > 0
      ? Math.min(1, Math.max(0, (loss + spread - enterHp) / (2 * spread)))
      : loss > enterHp
        ? 1
        : 0
  // Погибший бой убийства не приносит, а время его потрачено.
  const kills = fights - deathChance
  const total = fights * cycleSec + (1 - deathChance) * restSec + deathChance * reviveSec
  return {
    kills,
    cycleSec: total,
    uptime: (kills * cycleSec) / total,
    deathChance,
    dies: deathChance >= 0.5,
  }
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
// ---------------------------------------------------------------------------
// ПРОКИ
// ---------------------------------------------------------------------------
//
// Прок — это «само сработало от удара». Механика живёт ЗДЕСЬ, а не в предмете:
// предмет только называет id прока, а числа лежат в data/procs.ts. Два правила
// и оба общие для всех проков:
//   1) бросок делается на КАЖДЫЙ удар героя (замахи обеих рук и мгновенные
//      умения; тики урона по времени ударами не считаются — прок висит на
//      оружии, а не на кровотечении);
//   2) сработав, прок уходит во внутренний кулдаун и до его конца не бросается
//      вовсе.

/**
 * Проки надетых вещей в фиксированном порядке слотов.
 *
 * Порядок важен дважды: от него зависит порядок бросков (а значит и
 * воспроизводимость прогонов) и порядок строк в оценке. Один и тот же прок с
 * двух предметов считается ОДИН раз: внутренний кулдаун у него общий, и
 * вторая строка дала бы удвоенный темп в оценке при том же темпе в бою.
 */
export function equippedProcs(state: GameState): ProcDef[] {
  const procs: ProcDef[] = []
  for (const slot of SLOT_IDS) {
    const id = state.equipment?.[slot]?.procId
    if (!id) continue
    const proc = PROC_BY_ID[id]
    if (proc && !procs.includes(proc)) procs.push(proc)
  }
  return procs
}

/** Внутренние кулдауны тикают игровым временем, как и кулдауны умений. */
export function advanceProcCooldowns(
  cooldowns: Record<string, number>,
  dtMs: number,
): Record<string, number> {
  const next: Record<string, number> = {}
  let changed = false
  for (const [id, left] of Object.entries(cooldowns)) {
    const value = left - dtMs
    if (value > 0) next[id] = value
    if (value !== left) changed = true
  }
  return changed ? next : cooldowns
}

export function procReady(state: GameState, proc: ProcDef): boolean {
  return (state.procCooldownsMs[proc.id] ?? 0) <= 0
}

/** Что сработало за тик. Урон или лечение — ровно одно из двух. */
export interface ProcFire {
  proc: ProcDef
  damage: Decimal | null
  heal: Decimal | null
  isCrit: boolean
}

/**
 * Броски проков по ударам, нанесённым в этом тике. ЧИСТАЯ функция: она ничего
 * не применяет — только считает, что сработало и какими стали кулдауны.
 * Применяет результат конвейер тика.
 *
 * Ни одного прока — ни одного обращения к rng: поток случайности героя без
 * ключевой вещи обязан остаться ровно прежним (это же держит golden).
 */
export function rollProcs(
  state: GameState,
  hits: number,
  rng: Rng,
): { fired: ProcFire[]; cooldowns: Record<string, number> } {
  const procs = equippedProcs(state)
  if (procs.length === 0 || hits <= 0) return { fired: [], cooldowns: state.procCooldownsMs }
  const cooldowns = { ...state.procCooldownsMs }
  const fired: ProcFire[] = []
  for (const proc of procs) {
    if ((cooldowns[proc.id] ?? 0) > 0) continue
    // По броску на удар; первый удачный взводит кулдаун, и остальные удары
    // этого тика для этого прока уже не бросаются — иначе жирный тик
    // (возврат из оффлайна, отладочное ускорение) дал бы пачку срабатываний,
    // которой в оценке нет и быть не может.
    let hit = false
    for (let i = 0; i < hits && !hit; i += 1) hit = rng() < proc.chance
    if (!hit) continue
    cooldowns[proc.id] = proc.internalCooldownMs
    if (proc.effect.kind === 'damage') {
      // Своей формулы урона у прока НЕТ: тот же rollSwing, что у автоатаки и
      // умений, только со своей долей удара оружия. Значит прок масштабируется
      // от оружия и критует по общим правилам.
      const swing = rollSwing(state.stats, rng, proc.effect.weaponDamagePercent)
      fired.push({ proc, damage: swing.amount, heal: null, isCrit: swing.isCrit })
      continue
    }
    fired.push({
      proc,
      damage: null,
      heal: state.stats.maxHp.times(proc.effect.healShare),
      isCrit: false,
    })
  }
  return { fired, cooldowns }
}

/**
 * СРАБАТЫВАНИЙ В СЕКУНДУ — то самое число, ради которого всё это считается:
 *
 *   min(шанс × ударов_в_секунду, 1000 / internalCooldownMs)
 *
 * Слева — сколько бросков вообще выпадает, справа — потолок внутреннего
 * кулдауна: чаще, чем раз в ICD, прок не срабатывает никогда. На медленном
 * оружии работает левая часть, на быстром — правая, и именно поэтому прок
 * НЕ даёт быстрому оружию второй выгоды поверх первой.
 *
 * Если это число не входит в estimateCombatRate, показатель урона в секунду
 * начинает врать ровно в тот момент, когда игрок наденет ключевую вещь, — и
 * вместе с ним врут метка апгрейда, прогноз зоны и весь оффлайн.
 */
export function procRatePerSecond(proc: ProcDef, hitsPerSecond: Decimal): Decimal {
  if (hitsPerSecond.lte(0)) return new Decimal(0)
  const rolled = hitsPerSecond.times(proc.chance)
  const cap = new Decimal(1000).div(Math.max(1, proc.internalCooldownMs))
  return Decimal.min(rolled, cap)
}

/** Матожидание урона одного срабатывания БЕЗ крита — как expectedSwingDamage:
 *  крит навешивается там, где считается урон в секунду. */
export function expectedProcDamage(stats: StatBlock, proc: ProcDef): Decimal {
  if (proc.effect.kind !== 'damage') return new Decimal(0)
  return expectedSwingDamage(stats).times(proc.effect.weaponDamagePercent)
}

/** Сколько здоровья возвращает одно срабатывание оберега. */
export function expectedProcHeal(stats: StatBlock, proc: ProcDef): Decimal {
  return proc.effect.kind === 'ward' ? stats.maxHp.times(proc.effect.healShare) : new Decimal(0)
}

function damagePerKill(state: GameState, plan: RotationPlan, stream: HitStream): Decimal {
  const hp = state.monster.maxHp
  const swing = expectedSwingDamage(state.stats)
  // Минимум перебоя — половина обычного замаха: меньше не теряет никто.
  const floor = hp.plus(swing.div(2))
  // Перебой — следствие второго правила: авто не придерживает кулдауны и
  // добивает чем придётся. Рука бурст придерживает, у неё перебоя сверх
  // обычного замаха нет.
  if (!plan.delayed) return floor
  if (stream.rate.lte(0)) return floor
  const averageHit = stream.killing.div(stream.rate)
  // Матожидание перебоя — половина СРЕДНЕГО удара потока: добивающий удар
  // ложится в случайное место, и мимо уходит в среднем половина его. Целое
  // число ударов одного цикла здесь не берётся — оценка считает среднее по
  // сотням боёв (см. farmCycle). Ниже минимума не опускаемся — авто не может
  // терять меньше руки.
  return Decimal.max(hp.plus(averageHit.div(2)), floor)
}

/**
 * Поток ударов героя: автоатака плюс касты умений. Урон приходит НЕ ровным
 * ручейком, а порциями — от этого зависит и длина боя, и перебой.
 * `killing` — только сам удар: добить моба может он, но не тики эффекта.
 * `paced` — удар вместе с его эффектом: по нему считается длина боя, ведь
 * эффект всё равно доедает моба следом.
 */
interface HitStream {
  rate: Decimal
  killing: Decimal
  paced: Decimal
  /** Урон проков в секунду БЕЗ крита — как killing и paced. */
  procDamage: Decimal
  /** Лечение проков в секунду. */
  procHeal: Decimal
}

function hitStream(
  stats: StatBlock,
  rotation: RotationRate,
  doubleChance = 0,
  procs: ProcDef[] = [],
): HitStream {
  const swingRate = new Decimal(1).div(stats.swingTime)
  const swing = expectedSwingDamage(stats)
  const replaced = replacedSwingsPerSecond(stats, rotation)
  // Ударов в секунду: замахи ОБЕИХ рук плюс мгновенные умения. «На следующий
  // удар» новых ударов не добавляет — оно занимает уже существующий замах
  // правой руки, только бьёт он сильнее. Двойной удар (талант-флаг) добавляет
  // ЛИШНИЕ замахи: их умение не заменяет — очередь одна, — поэтому они идут
  // отдельной ставкой, а не множителем на swingRate.
  const offRate = hasOffhand(stats)
    ? new Decimal(1).div(stats.offhandSwingTime)
    : new Decimal(0)
  const extraMain = swingRate.times(doubleChance)
  const extraOff = offRate.times(doubleChance)
  let rate = swingRate.plus(offRate).plus(extraMain).plus(extraOff)
  let killing = swing.times(swingRate.minus(replaced).plus(extraMain)).plus(
    hasOffhand(stats)
      ? expectedSwingDamage(stats, 'off').times(offRate.plus(extraOff))
      : new Decimal(0),
  )
  let paced = killing
  for (const cast of rotation.casts) {
    const castRate = new Decimal(cast.castsPerSecond)
    if (cast.ability.type === 'instant') rate = rate.plus(castRate)
    killing = killing.plus(cast.hitDamage.times(castRate))
    paced = paced.plus(cast.totalDamage.times(castRate))
  }
  // Проки считаются ПОСЛЕДНИМИ и от УЖЕ сложившегося потока: они срабатывают
  // от ударов, но сами новых бросков не порождают — прок от прока не идёт.
  const baseRate = rate
  let procDamage = new Decimal(0)
  let procHeal = new Decimal(0)
  for (const proc of procs) {
    const per = procRatePerSecond(proc, baseRate)
    if (per.lte(0)) continue
    const damage = expectedProcDamage(stats, proc)
    if (damage.gt(0)) {
      procDamage = procDamage.plus(damage.times(per))
      // Удар прока — такой же удар потока: он и добивает моба, и квантует бой,
      // поэтому входит и в rate, и в killing, и в paced.
      rate = rate.plus(per)
      killing = killing.plus(damage.times(per))
      paced = paced.plus(damage.times(per))
    }
    procHeal = procHeal.plus(expectedProcHeal(stats, proc).times(per))
  }
  return { rate, killing, paced, procDamage, procHeal }
}

/**
 * Урон АВТОАТАКИ в секунду — обеих рук вместе.
 *
 * Свойство ОРУЖИЯ: сколько бы умений герой ни жал, «столько бьёт этот меч»
 * не меняется. Этим числом сравниваются предметы, и на нём держится инвариант
 * нормализации скорости.
 */
export function autoDamagePerSecond(stats: StatBlock, doubleChance = 0): Decimal {
  const single = expectedSwingDamage(stats)
    .times(critFactor(stats))
    .div(stats.swingTime)
    .plus(offhandDamagePerSecond(stats))
  // Шанс двойного удара — талант-флаг, ноль по умолчанию: сравнение предметов
  // о талантах не знает и знать не должно.
  return single.times(1 + doubleChance)
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
  // числа считаются одинаково честно, но перебой добивающего удара у авто
  // больше (см. damagePerKill), и на коротком бою расхождение может выйти
  // в доли процента не в ту сторону — здесь оно и снимается. Зажим
  // непрерывный: min/max, никаких порогов.
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
  const incoming =
    state.monster.swingTime > 0 && state.monster.damageMax.gt(0)
      ? new Decimal(1).div(state.monster.swingTime)
      : new Decimal(0)
  // Блок возвращает долю запаса за каждый заблокированный удар. Работает это
  // у ОБОИХ классов: ветки по ресурсу здесь нет, только число из данных таланта.
  const fromBlock = incoming
    .times(stats.blockChance * blockResourceShare(state.talents))
    .times(stats.maxMana)
  if (resource.perSwingDealt.lte(0) && resource.perHitTaken.lte(0)) {
    return stats.manaRegen.plus(fromBlock)
  }
  // Ударов в секунду: свои — обе руки, чужие — замах моба. Умения сюда не
  // входят намеренно: их число само зависит от ресурса, и подставлять его
  // значило бы решать уравнение самим собой.
  const own = new Decimal(1).div(stats.swingTime).plus(
    hasOffhand(stats) ? new Decimal(1).div(stats.offhandSwingTime) : new Decimal(0),
  )
  return stats.manaRegen
    .plus(own.plus(extraHitsPerSecond).times(resource.perSwingDealt).times(stats.maxMana))
    .plus(incoming.times(resource.perHitTaken).times(stats.maxMana))
    .plus(fromBlock)
}

/**
 * Отражённый щитом урон в секунду. Считается ЗДЕСЬ, а не забывается: иначе
 * прогноз зоны и оффлайн занижали бы капстоун живучести, и «оффлайн <=
 * автокаст» держалось бы по недосмотру, а не по правилу.
 */
function reflectPerSecond(state: GameState, incoming: Decimal): Decimal {
  const share = blockReflectShare(state.talents)
  const stats = state.stats
  if (share <= 0 || stats.blockChance <= 0 || state.monster.swingTime <= 0) return new Decimal(0)
  // Щит снимает фиксированную величину, но не больше самого удара.
  const absorbed = Decimal.min(stats.blockValue, incoming)
  return absorbed.times(share).times(stats.blockChance).div(state.monster.swingTime)
}

/**
 * Настройки только ОТКРЫТЫХ умений: запертые уровнем не жмёт ни рука, ни
 * автокаст, и модель, считающая их урон, завышала бы прогноз и оффлайн
 * новичка — в нарушение правила «оффлайн <= автокаст <= ручная игра».
 */
function unlockedSettings(state: GameState): AbilitySettings {
  const settings: AbilitySettings = {}
  for (const [id, value] of Object.entries(state.abilitySettings)) {
    const ability = ABILITY_BY_ID[id]
    if (ability && state.level.gte(ability.unlockLevel)) settings[id] = value
  }
  return settings
}

function rawRate(state: GameState, plan: RotationPlan): CombatRate {
  // ЗЕЛЬЯ ВХОДЯТ ТОЛЬКО В РУЧНУЮ ИГРУ. В модель 'manual' — приоритетным
  // зельем, урезанным целевым аптаймом; из 'auto' и из точки отсчёта
  // 'autocastByHand' они ВЫЧИЩАЮТСЯ, даже если склянка выпита прямо сейчас, —
  // иначе прибавка уехала бы в оффлайн (он считается по 'auto') и правило
  // «оффлайн <= автокаст <= ручная игра» сломалось бы молча.
  const modelled = plan.potions ? statsWithPotionPlan(state) : statsWithoutPotions(state)
  // Подменяем статы В КОПИИ состояния: всё, что ниже (resourceIncome,
  // resourcePause, damagePerKill), читает их оттуда, и второго пути нет.
  const s: GameState = modelled === state.stats ? state : { ...state, stats: modelled }
  const stats = s.stats
  const avgSwing = expectedSwingDamage(stats)
  const respawnSec = RESPAWN_DELAY_MS / 1000
  const settings = unlockedSettings(s)
  // Ресурс из боя — уравнение с самим собой: удары умений тоже дают ярость,
  // а число умений зависит от ярости. Решаем ДВУМЯ проходами: сперва доход
  // от одних автоатак, потом — с учётом посчитанных мгновенных ударов.
  // Двух хватает: второй проход меняет ответ на проценты, третий — на доли.
  const pause = resourcePause(s)
  let rotation = rotationRate(stats, settings, plan, resourceIncome(s), pause)
  if (classById(s.classId).resource.perSwingDealt.gt(0)) {
    // Умения «на следующий удар» ЗАМЕНЯЮТ автоатаку и лишнего удара не дают.
    const extraHits = rotation.casts
      .filter((c) => c.ability.type === 'instant')
      .reduce((sum, c) => sum + c.castsPerSecond, 0)
    rotation = rotationRate(
      stats,
      settings,
      plan,
      resourceIncome(s, extraHits),
      pause,
    )
  }
  // Урон автоатаки — свойство ОРУЖИЯ и считается как считался: сколько бы
  // умений герой ни жал, «столько бьёт этот меч» не меняется. Этим числом
  // сравниваются предметы, и на нём держится инвариант нормализации скорости.
  // Автоатака — это ОБЕ руки: у каждой свой таймер и свой урон за удар.
  const doubleChance = doubleStrikeChance(s.talents)
  const procs = equippedProcs(s)
  const autoDps = autoDamagePerSecond(stats, doubleChance)
  // Поток ударов считается ОДИН раз и уходит и в перебой, и в длину боя, и в
  // урон проков: две копии этого расчёта разошлись бы на первой же правке.
  const stream = hitStream(stats, rotation, doubleChance, procs)
  // Сложить автоатаку и умения напрямую НЕЛЬЗЯ: умение «на следующий удар»
  // ЗАМЕНЯЕТ автоатаку, а не добавляется к ней, — эти замахи посчитаны дважды.
  // Пока бой длился полтора удара, ошибка была незаметной; на длинном бою она
  // делала оффлайн выгоднее живой игры, то есть ломала железное правило.
  const replaced = replacedSwingsPerSecond(stats, rotation).times(avgSwing).times(critFactor(stats))
  // Урон в секунду, реально дошедший до мобов: сырой темп минус перебой.
  // Урон проков — с критом: внутри потока он лежит без него, как killing и paced.
  const procDps = stream.procDamage.times(critFactor(stats))
  const raw = autoDps
    .plus(rotation.damagePerSecond)
    .minus(replaced)
    .plus(procDps)
    .plus(reflectPerSecond(s, expectedMonsterDamage(s.monster, stats, s.level.toNumber())))
  const perKill = damagePerKill(s, plan, stream)
  const damagePerSecond = raw.times(s.monster.maxHp.div(perKill))
  // Длина боя — СРЕДНЕЕ число ударов потока на убийство, дробное. Перебой
  // добивающего удара уже сидит в damagePerKill (половина среднего удара —
  // ровно то, что даёт целое число ударов, усреднённое по фазе), поэтому
  // округлять здесь второй раз нельзя: получился бы лишний полуудар на
  // каждый бой. Меньше одного удара бой не длится.
  const averagePaced = stream.rate.gt(0) ? stream.paced.div(stream.rate) : new Decimal(1)
  const hitsPerKill = averagePaced.gt(0)
    ? Decimal.max(perKill.div(averagePaced), new Decimal(1))
    : new Decimal(1)
  const fightSec = stream.rate.gt(0)
    ? hitsPerKill.div(stream.rate)
    : new Decimal(stats.swingTime)
  const killCycleSec = fightSec.plus(respawnSec)
  const idealKillsPerSecond = new Decimal(1).div(killCycleSec)

  // Баланс HP за цикл: ответные удары моба за фазу боя минус реген (в бою
  // медленный, в паузе респауна быстрый). Ударов моба — СРЕДНЕЕ по боям:
  // моб бьёт по своему таймеру, и сколько ударов влезет в бой, зависит от
  // того, где бой кончится; `floor(бой/замах)`, усреднённый по фазе, равен
  // `бой/замах - 1/2`, а меньше нуля ударов не бывает.
  const avgIncoming = expectedMonsterDamage(s.monster, stats, s.level.toNumber())
  const monsterHitsPerCycle = avgIncoming.gt(0)
    ? Decimal.max(fightSec.div(s.monster.swingTime).minus(0.5), new Decimal(0))
    : new Decimal(0)
  const incomingPerCycle = monsterHitsPerCycle.times(avgIncoming)
  // Оберег лечит ТОЛЬКО в бою: он срабатывает от ударов, а в паузе респауна
  // герой не бьёт. Перелив через максимум модель не считает — она и не может:
  // в оценке нет текущего HP, а на длинной череде боёв перелив редок.
  const regenPerCycle = stats.hpRegen
    .times(fightSec)
    .plus(stats.hpRegenOutOfCombat.times(respawnSec))
    .plus(stream.procHeal.times(fightSec))
  const netLossPerSec = incomingPerCycle.minus(regenPerCycle).div(killCycleSec)

  if (netLossPerSec.lte(0)) {
    return {
      damagePerSecond,
      autoDamagePerSecond: autoDps,
      abilityDamagePerSecond: rotation.damagePerSecond,
      procDamagePerSecond: procDps,
      killsPerSecond: idealKillsPerSecond,
      idealKillsPerSecond,
      hpLossPerSecond: new Decimal(0),
      uptime: 1,
      timeToDeathSec: null,
      killsPerCycle: Number.POSITIVE_INFINITY,
      deathChancePerCycle: 0,
      diesInCycle: false,
    }
  }
  // Цикл фарма считается ПО БОЯМ ЦЕЛИКОМ: герой доводит схватку до конца и
  // уходит на привал только после убийства (см. farmCycle). Порог берётся
  // из конвейера статов — настройка игрока плюс таланты.
  const cycle = farmCycle({
    maxHp: stats.maxHp,
    lossPerSecond: netLossPerSec,
    cycleSec: killCycleSec.toNumber(),
    hpThreshold: stats.restThreshold,
    restSec: stats.restDuration,
  })
  return {
    damagePerSecond,
    autoDamagePerSecond: autoDps,
    abilityDamagePerSecond: rotation.damagePerSecond,
    procDamagePerSecond: procDps,
    killsPerSecond: idealKillsPerSecond.times(cycle.uptime),
    idealKillsPerSecond,
    hpLossPerSecond: netLossPerSec,
    uptime: cycle.uptime,
    // Сколько герой продержится, если никуда не уходить: по этому числу
    // прогноз зоны понимает, переживает ли он бой вообще.
    timeToDeathSec: stats.maxHp.div(netLossPerSec).toNumber(),
    killsPerCycle: cycle.kills,
    deathChancePerCycle: cycle.deathChance,
    diesInCycle: cycle.dies,
  }
}
