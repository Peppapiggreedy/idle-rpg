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
import { ABILITIES, type AbilityDef } from '../data/abilities'
import { AUTOCAST_DELAY_MS } from '../data/balance'
import type { StatBlock } from './stats'
import type { AbilitySettings } from './state'

export type PlayMode = 'auto' | 'manual'

// Раскладка режима на две независимые оси: КОГДА герой жмёт (сразу или через
// задержку реакции) и ЧТО он жмёт (только отмеченное галкой или всё подряд).
// Третье сочетание — «ротация автокаста, сыгранная руками» — нужно как точка
// отсчёта: насколько авто отстаёт из-за своих двух правил, а не из-за галок.
export interface RotationPlan {
  delayed: boolean
  onlyAutocast: boolean
}

export const PLAN: Record<'auto' | 'manual' | 'autocastByHand', RotationPlan> = {
  auto: { delayed: true, onlyAutocast: true },
  manual: { delayed: false, onlyAutocast: false },
  autocastByHand: { delayed: false, onlyAutocast: true },
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
 * Умения, отсортированные по приоритету игрока (меньше число — раньше).
 * `onlyAutocast` оставляет только отмеченные галкой — это набор, который герой
 * применяет сам. Ручная игра распоряжается всеми умениями.
 */
export function abilitiesByPriority(
  settings: AbilitySettings,
  onlyAutocast: boolean,
): AbilityDef[] {
  return ABILITIES.filter((a) => !onlyAutocast || settings[a.id]?.autocast).sort(
    (a, b) => (settings[a.id]?.priority ?? 0) - (settings[b.id]?.priority ?? 0),
  )
}

/**
 * Раскладка ротации по приоритетам под ограничение маны. Порядок ОДИН и тот
 * же для авто и для руки — разница только в цикле каста: авто ждёт задержку
 * реакции, рука бьёт сразу.
 */
export function rotationRate(
  stats: StatBlock,
  settings: AbilitySettings,
  plan: RotationPlan,
): RotationRate {
  const rate = castPlan(stats, settings, plan)
  if (plan.delayed) return rate
  // Игрок в ЛЮБОЙ момент может повторить то, что делает автокаст: подождать
  // и ударить позже. Значит игра руками не бывает хуже авто. Когда мана
  // впритык, реже бить иногда выгоднее — тогда рука повторяет план авто.
  // Это не поблажка руке, а определение: ручная игра — лучшая из доступных.
  const delayed = castPlan(stats, settings, { ...plan, delayed: true })
  return rate.damagePerSecond.gte(delayed.damagePerSecond) ? rate : delayed
}

function castPlan(stats: StatBlock, settings: AbilitySettings, plan: RotationPlan): RotationRate {
  const delaySec = plan.delayed ? AUTOCAST_DELAY_MS / 1000 : 0
  let manaBudget = stats.manaRegen
  const casts: AbilityCastRate[] = []
  let damage = new Decimal(0)
  let manaSpent = new Decimal(0)

  for (const ability of abilitiesByPriority(settings, plan.onlyAutocast)) {
    // Цикл каста: кулдаун плюс задержка реакции. У руки задержки нет.
    const cycleSec = new Decimal(ability.cooldownSec).plus(delaySec)
    const wantPerSecond = new Decimal(1).div(cycleSec)
    const manaWanted = ability.manaCost.times(wantPerSecond)
    // Маны на всё не хватает — умение получает столько тактов, сколько оплачено.
    const share = manaWanted.lte(manaBudget)
      ? new Decimal(1)
      : Decimal.max(manaBudget, new Decimal(0)).div(manaWanted)
    if (share.lte(0)) continue
    const castsPerSecond = wantPerSecond.times(share)
    const hitDamage = expectedAbilityDamage(stats, ability.weaponDamagePercent)
    const totalDamage = withEffect(stats, ability, hitDamage)
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

// Полный урон одного каста: сам удар плюс весь урон эффекта, если он есть.
// Эффект тикает уже после удара, поэтому в темпе он идёт вместе с кастом,
// но добить моба может только сам удар — для перебоя берётся именно он.
function withEffect(stats: StatBlock, ability: AbilityDef, hit: Decimal): Decimal {
  if (!ability.effect) return hit
  return hit.plus(
    expectedAbilityDamage(stats, ability.effect.weaponDamagePercent).times(ability.effect.ticks),
  )
}
