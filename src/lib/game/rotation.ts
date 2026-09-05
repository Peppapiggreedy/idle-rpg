// Оценка урона умений при игре по приоритетам — общая модель для автокаста,
// ручной игры и оффлайна. Своей формулы урона здесь НЕТ: удар умения считает
// combat.ts, а мы только раскладываем касты по времени и мане.
//
// Авто и ручная игра отличаются РОВНО двумя правилами, оба из данных:
//   1. autocastDelay — авто применяет умение не мгновенно, а через задержку
//      реакции после того, как оно стало доступно;
//   2. авто не придерживает кулдауны — бьёт, как только смог, поэтому чаще
//      добивает моба крупным умением и тратит урон в перебой (overkill).
// Больше никаких множителей и штрафов.
import { Decimal } from './numbers'
import { critFactor, expectedAbilityDamage } from './combat'
import { tuneAbility } from './abilityTune'
import { ABILITY_BY_ID, type AbilityDef } from '../data/abilities'
import { AUTOCAST_DELAY_MS, REGEN_TICK_S } from '../data/balance'
import type { StatBlock } from './stats'
import type { AbilitySettings, Rotation } from './state'

export type PlayMode = 'auto' | 'manual'

// Раскладка режима на две независимые оси: КОГДА герой жмёт (сразу или через
// задержку реакции) и ЧТО он жмёт (только отмеченное галкой или всё подряд).
// Третье сочетание — «ротация автокаста, сыгранная руками» — нужно как точка
// отсчёта: насколько авто отстаёт из-за своих двух правил, а не из-за галок.
export interface RotationPlan {
  delayed: boolean
  onlyAutocast: boolean
  /**
   * Считать ли выпитое зелье. Третья ось режима, и она НЕ про умения:
   * зелье нельзя автоматизировать, поэтому герой сам себя им не поит.
   * У autocastByHand — false намеренно: это точка отсчёта потолка
   * отставания автокаста, и подмешивать в неё зелья значило бы требовать
   * от автокаста того, чего он в принципе не умеет.
   */
  potions: boolean
}

export const PLAN: Record<'auto' | 'manual' | 'autocastByHand', RotationPlan> = {
  auto: { delayed: true, onlyAutocast: true, potions: false },
  manual: { delayed: false, onlyAutocast: false, potions: true },
  autocastByHand: { delayed: false, onlyAutocast: true, potions: false },
}

export interface AbilityCastRate {
  ability: AbilityDef
  castsPerSecond: number // доля от желаемого темпа, урезанная маной
  hitDamage: Decimal // урон САМОГО удара — им умение может добить моба
  totalDamage: Decimal // удар плюс весь урон эффекта, если он есть
}

export interface RotationRate {
  damagePerSecond: Decimal // урон умений в секунду, с матожиданием критов
  manaPerSecond: Decimal // сколько маны это съедает
  casts: AbilityCastRate[]
}

/**
 * Каст, темп которого задан СНАРУЖИ, а не кулдауном: лечение жмётся не «как
 * только откатилось», а когда здоровье просело, и сколько раз за цикл — знает
 * модель цикла в combat.ts. Ротация только оплачивает его маной: первым, до
 * боевых умений, — выжить стоит выше урона.
 */
export interface FixedCast {
  ability: AbilityDef
  castsPerSecond: number
}

const NO_MANA = new Decimal(0)

/**
 * ПРИВАЛ НАЛИВАЕТ ЗАПАС ДО ПОЛНОГО, и ротация обязана это знать. Модель
 * маны сама по себе считает только регенерацию с её паузами и обещала
 * герою три четверти его кастов; настоящий тик жал умения почти по
 * кулдаунам — потому что каждые несколько боёв герой садится, а встаёт с
 * полной маной. `fightSec` — сколько секунд боя приходится на один полный
 * запас, то есть между двумя привалами (из модели цикла в combat.ts);
 * бесконечность — привалов нет.
 */
export interface RestRefill {
  fightSec: number
}

/**
 * УМЕНИЯ В ПОРЯДКЕ РЯДА ДЕЙСТВИЙ. Порядок слотов И ЕСТЬ приоритет: первый
 * слот жмётся первым, и второго числа приоритета в игре нет.
 *
 * Отсюда же следует, что НЕПОЛОЖЕННОЕ В РЯД УМЕНИЕ НЕ УЧАСТВУЕТ НИ В ЧЁМ —
 * ни в автокасте, ни в ручной игре, ни в модели: кнопки у него на экране
 * нет, и обещать в расчёте то, чего игрок нажать не может, нельзя.
 *
 * `onlyAutocast` оставляет только отмеченные галкой — это набор, который
 * герой применяет сам; ручная игра распоряжается всем рядом.
 */
export function abilitiesByPriority(
  rotation: Rotation,
  onlyAutocast: boolean,
): AbilityDef[] {
  const out: AbilityDef[] = []
  for (const id of rotation.slots) {
    if (id === null) continue
    const ability = ABILITY_BY_ID[id]
    // Умения ЧУЖОГО класса и запертые уровнем в настройках не лежат, поэтому
    // фильтр по наличию настройки и есть фильтр по доступности.
    const setting = rotation.settings[id]
    if (!ability || setting === undefined) continue
    if (onlyAutocast && !setting.autocast) continue
    // ЭФФЕКТИВНОЕ, А НЕ БАЗОВОЕ. Отсюда таланты доходят до модели боя,
    // автокаста и оффлайна разом: все они читают ротацию.
    out.push(tuneAbility(ability, rotation.talents))
  }
  return out
}

/**
 * Раскладка ротации по приоритетам под ограничение маны. Порядок ОДИН и тот
 * же для авто и для руки — разница только в цикле каста: авто ждёт задержку
 * реакции, рука бьёт сразу.
 */
export function rotationRate(
  stats: StatBlock,
  rotation: Rotation,
  plan: RotationPlan,
  /**
   * Сколько ресурса приходит в секунду. По умолчанию — реген из статов
   * (класс на мане). Класс на ярости передаёт сюда доход ОТ БОЯ: формула
   * ниже одна на оба случая, различаются только числа.
   */
  income: Decimal = stats.manaRegen,
  /**
   * Пауза после траты, секунд. У маны это задержка плюс полломтя порции;
   * у ярости ноль — она приходит с каждым ударом, а не порциями по таймеру.
   */
  pauseSec: number = stats.regenDelay + REGEN_TICK_S / 2,
  /** Сколько боя приходится на один полный запас с привала; null — без привалов. */
  refill: RestRefill | null = null,
  /** Касты с заданным снаружи темпом (лечение) — оплачиваются первыми. */
  fixed: FixedCast[] = [],
  /** Сколько маны боевые умения оставляют нетронутой («беречь на лечение»). */
  reserveMana: Decimal = NO_MANA,
): RotationRate {
  const rate = castPlan(stats, rotation, plan, income, pauseSec, refill, fixed, reserveMana)
  if (plan.delayed) return rate
  // Игрок в ЛЮБОЙ момент может повторить то, что делает автокаст: подождать
  // и ударить позже. Значит игра руками не бывает хуже авто. Когда мана
  // впритык, реже бить иногда выгоднее — тогда рука повторяет план авто.
  // Это не поблажка руке, а определение: ручная игра — лучшая из доступных.
  const delayed = castPlan(
    stats,
    rotation,
    { ...plan, delayed: true },
    income,
    pauseSec,
    refill,
    fixed,
    reserveMana,
  )
  return rate.damagePerSecond.gte(delayed.damagePerSecond) ? rate : delayed
}

/** Сколько трат в секунду в этой ротации: таймер задержки взводят только они. */
function spendEvents(rate: RotationRate): Decimal {
  return rate.casts.reduce(
    (sum, cast) => (cast.ability.manaCost.gt(0) ? sum.plus(cast.castsPerSecond) : sum),
    new Decimal(0),
  )
}

/**
 * Какую долю желаемой ротации ресурс выдерживает вдолгую.
 *
 * Правило задержки делает выгодным ВСПЛЕСК: таймер сбрасывается каждой тратой,
 * поэтому десять трат подряд стоят одной паузы, а десять равномерных — десяти.
 * Герой так и играет: жжёт запас, потом молчит и восстанавливается. Считаем
 * оба уклада и берём лучший — игрока незачем штрафовать за то, что он не
 * обязан выбирать худший:
 *
 *   равномерно: доход R*(1 - DELAY*E) должен покрыть трату S;
 *   всплеском:  цикл = прожечь запас (d/S) + пауза DELAY + налить обратно (d/R),
 *               и доля боевого времени в нём и есть ответ.
 *
 * d — глубина запаса до РЕЗЕРВА: чем выше резерв, тем короче всплеск, тем
 * чаще платится фиксированная пауза и тем ниже урон. Это и есть цена
 * автономности, за которую игрок получает умение, готовое в нужный момент.
 */
function dutyCycle(
  stats: StatBlock,
  settings: AbilitySettings,
  desired: RotationRate,
  income: Decimal,
  pauseSec: number,
  refill: RestRefill | null,
  reserveMana: Decimal,
): Decimal {
  const spend = desired.manaPerSecond
  if (spend.lte(0)) return new Decimal(1)
  const events = spendEvents(desired)
  const regen = income
  if (regen.lte(0)) return new Decimal(0)
  // Пауза до первой порции — не только DELAY: мана приходит ЛОМТЯМИ раз в
  // REGEN_TICK_S, и окно почти никогда не заканчивается ровно по границе
  // ломтя. В среднем полломтя пропадает, и для расчёта это та же пауза.
  const pause = pauseSec

  // Равномерный уклад: сколько от желаемого покрывает доход с паузами.
  const uniform = regen.div(spend.plus(regen.times(pause).times(events)))

  // Всплеск: запас срабатывает до самого низкого резерва среди тех умений,
  // которые вообще жмутся, — дальше молчат все.
  const reserves = desired.casts
    .filter((c) => c.ability.manaCost.gt(0))
    .map((c) => settings[c.ability.id]?.reserve ?? 0)
  const floor = reserves.length > 0 ? Math.min(...reserves) : 0
  // Запас срабатывает не до нуля, а до самого дешёвого умения: ниже него
  // жать уже нечего. На первых уровнях, где весь запас — несколько применений,
  // эта поправка заметная.
  const cheapest = desired.casts
    .filter((c) => c.ability.manaCost.gt(0))
    .reduce((min, c) => Decimal.min(min, c.ability.manaCost), stats.maxMana)
  // Резерв под лечение тоже отрезает глубину всплеска: до него боевые умения
  // запас не выжигают.
  const depth = Decimal.max(
    stats.maxMana.times(Math.max(0, 1 - floor)).minus(cheapest).minus(reserveMana),
    new Decimal(0),
  )
  const burst = depth.lte(0)
    ? new Decimal(0)
    : new Decimal(1).div(
        new Decimal(1)
          .plus(spend.times(pause).div(depth))
          .plus(spend.div(regen)),
      )
  const byRegen = Decimal.min(new Decimal(1), Decimal.max(uniform, burst))

  // ПРИВАЛ. С него герой встаёт с полным запасом, и пока запаса хватает на
  // все бои до следующего привала, мана ротацию не ограничивает вовсе. Не
  // хватает — покрытую запасом долю цикла герой жмёт всё, остаток живёт
  // на регенерации. Без этого модель обещала три четверти кастов там, где
  // тик жмёт по кулдаунам (замер: 0.48 против 0.64 каста в секунду).
  if (!refill || !Number.isFinite(refill.fightSec) || refill.fightSec <= 0 || depth.lte(0)) {
    return byRegen
  }
  const covered = Decimal.min(new Decimal(1), depth.div(spend.times(refill.fightSec)))
  return Decimal.min(new Decimal(1), covered.plus(new Decimal(1).minus(covered).times(byRegen)))
}

function castPlan(
  stats: StatBlock,
  rotation: Rotation,
  plan: RotationPlan,
  income: Decimal,
  pauseSec: number,
  refill: RestRefill | null,
  fixed: FixedCast[],
  reserveMana: Decimal,
): RotationRate {
  // Сперва — чего ротация хочет, если о мане не думать: это упирается в
  // кулдауны, GCD и очередь замаха. Потом — сколько из этого выдерживает
  // ресурс с правилом задержки и запасом с привала.
  const desired = fundPlan(stats, rotation, plan, UNLIMITED_MANA, fixed)
  const duty = dutyCycle(stats, rotation.settings, desired, income, pauseSec, refill, reserveMana)
  if (duty.gte(1)) return desired
  // Долю применяем ко ВСЕЙ ротации разом, а не отдаём бюджет по приоритету.
  // Так герой и играет: жмёт всё, что доступно, а когда запас кончился —
  // молчат все умения сразу. Приоритет решает, кто уйдёт в дело первым в
  // конкретный момент, но не то, сколько ротация выдерживает вдолгую.
  return scaleRate(desired, duty)
}

/** Ротация, замедленная в общей доле: и темп, и урон, и расход маны. */
function scaleRate(rate: RotationRate, factor: Decimal): RotationRate {
  return {
    damagePerSecond: rate.damagePerSecond.times(factor),
    manaPerSecond: rate.manaPerSecond.times(factor),
    casts: rate.casts.map((cast) => ({
      ...cast,
      castsPerSecond: factor.times(cast.castsPerSecond).toNumber(),
    })),
  }
}

/** Заведомо недостижимый бюджет: «посчитай, чего хочется, без оглядки на ману». */
const UNLIMITED_MANA = new Decimal(Number.MAX_SAFE_INTEGER)

function fundPlan(
  stats: StatBlock,
  rotation: Rotation,
  plan: RotationPlan,
  budget: Decimal,
  fixed: FixedCast[],
): RotationRate {
  const delaySec = plan.delayed ? AUTOCAST_DELAY_MS / 1000 : 0
  let manaBudget = budget
  // Второй ограничитель, кроме маны: умения «на следующий удар» ЖДУТ замаха,
  // и очередь на него одна. Значит вместе они не могут срабатывать чаще, чем
  // герой замахивается, — сколько бы маны ни было. Без этого потолка модель
  // раскладывала бы по два-три таких умения на один замах.
  let swingBudget = new Decimal(1).div(stats.swingTime)
  const casts: AbilityCastRate[] = []
  let damage = new Decimal(0)
  let manaSpent = new Decimal(0)

  // Касты с заданным темпом оплачиваются ПЕРВЫМИ: лечение — это «выжить»,
  // и боевые умения получают то, что осталось. Урона у них нет, зато каждая
  // трата взводит паузу регенерации, как и у боевых.
  for (const { ability, castsPerSecond } of fixed) {
    if (castsPerSecond <= 0) continue
    const manaWanted = ability.manaCost.times(castsPerSecond)
    const share = manaWanted.lte(manaBudget)
      ? new Decimal(1)
      : Decimal.max(manaBudget, new Decimal(0)).div(manaWanted)
    if (share.lte(0)) continue
    manaBudget = manaBudget.minus(manaWanted.times(share))
    manaSpent = manaSpent.plus(manaWanted.times(share))
    casts.push({
      ability,
      castsPerSecond: share.times(castsPerSecond).toNumber(),
      hitDamage: new Decimal(0),
      totalDamage: new Decimal(0),
    })
  }

  for (const ability of abilitiesByPriority(rotation, plan.onlyAutocast)) {
    // Лечение жмётся не по кулдауну, а по здоровью — его темп приходит
    // снаружи (fixed), здесь оно пропускается.
    if (ability.heal) continue
    // Цикл каста: кулдаун плюс задержка реакции. У руки задержки нет.
    // Умение «на следующий удар» вдобавок ЖДЁТ замаха: нажатие ставит его в
    // очередь, а бьёт оно, когда дойдёт черёд. В среднем это ползамаха
    // ожидания — и на медленном оружии это заметная часть цикла.
    const queueSec = ability.type === 'onNextSwing' ? stats.swingTime / 2 : 0
    const cycleSec = new Decimal(ability.cooldownSec).plus(delaySec).plus(queueSec)
    const wanted = new Decimal(1).div(cycleSec)
    const wantPerSecond =
      ability.type === 'onNextSwing' ? Decimal.min(wanted, swingBudget) : wanted
    if (wantPerSecond.lte(0)) continue
    const manaWanted = ability.manaCost.times(wantPerSecond)
    // Маны на всё не хватает — умение получает столько тактов, сколько оплачено.
    const share = manaWanted.lte(manaBudget)
      ? new Decimal(1)
      : Decimal.max(manaBudget, new Decimal(0)).div(manaWanted)
    if (share.lte(0)) continue
    const castsPerSecond = wantPerSecond.times(share)
    if (ability.type === 'onNextSwing') swingBudget = swingBudget.minus(castsPerSecond)
    const hitDamage = expectedAbilityDamage(stats, ability.weaponDamagePercent)
    // Интервал между кастами — по фактическому темпу, а не по откату: маны
    // может не хватать, и тогда касты реже, а тиков эффекта между ними ложится
    // больше.
    const totalDamage = withEffect(stats, ability, hitDamage, new Decimal(1).div(castsPerSecond).toNumber())
    manaBudget = manaBudget.minus(manaWanted.times(share))
    manaSpent = manaSpent.plus(manaWanted.times(share))
    damage = damage.plus(totalDamage.times(castsPerSecond))
    casts.push({ ability, castsPerSecond: castsPerSecond.toNumber(), hitDamage, totalDamage })
  }

  return {
    damagePerSecond: damage.times(critFactor(stats)),
    manaPerSecond: manaSpent,
    casts,
  }
}

// Полный урон одного каста: сам удар плюс урон эффекта, если он есть.
// Эффект тикает уже после удара, поэтому в темпе он идёт вместе с кастом,
// но добить моба может только сам удар — для перебоя берётся именно он.
//
// ПОВТОРНОЕ НАЛОЖЕНИЕ СТИРАЕТ ЭФФЕКТ: тик заменяет висящий эффект того же
// умения новым (abilities.ts), и до следующего каста ложатся только те тики,
// что успели. У «Рваной раны» откат длиннее кровотечения — ложатся все три;
// у Скорого выпада, выученного кровить «Рваным выпадом», откат две секунды
// против четырёх с половиной кровотечения — ложится один. Тик мерил
// 0.9–1.3 тика на каст, а модель без этой строки считала три и завышала
// талант втрое. Целое здесь честнее дробного: тик либо лёг до перекаста,
// либо нет, а интервал задаётся откатом и задержкой из данных, не сеткой
// статов героя.
function withEffect(
  stats: StatBlock,
  ability: AbilityDef,
  hit: Decimal,
  intervalSec: number,
): Decimal {
  const effect = ability.effect
  if (!effect) return hit
  const landed = Math.min(effect.ticks, Math.floor(intervalSec / effect.tickIntervalSec))
  if (landed <= 0) return hit
  return hit.plus(expectedAbilityDamage(stats, effect.weaponDamagePercent).times(landed))
}
