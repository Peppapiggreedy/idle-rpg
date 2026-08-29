// Активные умения: доступность, применение и постановка в очередь.
// Своей формулы урона здесь НЕТ — умение это доля удара оружия, а удар
// считает combat.ts. Текста для игрока тоже нет: наружу идут коды причин.
import { Decimal } from './numbers'
import { rollSwing } from './combat'
import { AUTOCAST_DELAY_MS, GCD_MS } from '../data/balance'
import { ABILITIES, ABILITY_BY_ID, type AbilityDef } from '../data/abilities'
import { abilitiesByPriority } from './rotation'
import { talentAbilityEffect } from './talents'
import { abilitiesOf, pushEvent, type ActiveEffect, type GameState } from './state'
import type { Rng } from './rng'
import type { AttackEvent } from '../types'

export { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
export type { AbilityDef, AbilityEffect, AbilityType } from '../data/abilities'

// Почему кнопка не нажимается. Каждый случай отдельный код — текст рендерит UI.
export type AbilityBlockReason = 'locked' | 'dead' | 'cooldown' | 'gcd' | 'no-mana'

export interface AbilityStatus {
  abilityId: string
  usable: boolean
  reason: AbilityBlockReason | null
  cooldownMsLeft: number
  cooldownFraction: number // 0 — готово, 1 — только что ушло в кулдаун
  gcdMsLeft: number
  queued: boolean // умение стоит в очереди на следующий замах
}

export function cooldownLeft(state: GameState, ability: AbilityDef): number {
  return Math.max(0, state.abilityCooldownsMs[ability.id] ?? 0)
}

/**
 * Можно ли нажать умение прямо сейчас. Порядок проверок фиксирован — от него
 * зависит, какую причину увидит игрок: сперва то, что не лечится ожиданием.
 * У onNextSwing мана НЕ проверяется: она списывается в момент удара, и
 * поставить умение заранее, пока мана капает, — законный ход.
 */
export function abilityStatus(state: GameState, ability: AbilityDef): AbilityStatus {
  const cooldownMsLeft = cooldownLeft(state, ability)
  const queued = state.queuedAbilityId === ability.id
  const base = {
    abilityId: ability.id,
    cooldownMsLeft,
    cooldownFraction: ability.cooldownSec > 0 ? cooldownMsLeft / (ability.cooldownSec * 1000) : 0,
    gcdMsLeft: Math.max(0, state.gcdMsLeft),
    queued,
  }
  // Снять своё же умение с очереди можно всегда, чем бы игрок ни был занят.
  if (queued) return { ...base, usable: true, reason: null }
  const blocked = (reason: AbilityBlockReason) => ({ ...base, usable: false, reason })
  // Запертое уровнем — первым: эта причина не лечится ни ожиданием, ни маной.
  if (state.level.lt(ability.unlockLevel)) return blocked('locked')
  if (state.heroState === 'dead') return blocked('dead')
  if (cooldownMsLeft > 0) return blocked('cooldown')
  if (ability.triggersGcd && state.gcdMsLeft > 0) return blocked('gcd')
  if (ability.type === 'instant' && state.currentMana.lt(ability.manaCost)) return blocked('no-mana')
  return { ...base, usable: true, reason: null }
}

export function allAbilityStatuses(state: GameState): AbilityStatus[] {
  return abilitiesOf(state.classId).map((a) => abilityStatus(state, a))
}

// Списание маны, кулдаун и (если умение его тратит) GCD — одним местом,
// чтобы instant и onNextSwing расходовали ресурсы одинаково.
/**
 * Взводит ли умение паузу до старта регенерации. Только ТРАТА: умение с
 * нулевой стоимостью таймер не сбрасывает — иначе бесплатная кнопка молча
 * выключала бы восстановление, и правило стало бы ловушкой вместо решения.
 */
export function resetsRegenDelay(ability: AbilityDef): boolean {
  return ability.manaCost.gt(0)
}

function payFor(state: GameState, ability: AbilityDef): GameState {
  const spends = resetsRegenDelay(ability)
  return {
    ...state,
    currentMana: state.currentMana.minus(ability.manaCost),
    // Пауза берётся из СТАТА: талант автономности её сокращает, и делает
    // это через конвейер, как всё остальное.
    regenDelayMsLeft: spends ? state.stats.regenDelay * 1000 : state.regenDelayMsLeft,
    abilityCooldownsMs: {
      ...state.abilityCooldownsMs,
      [ability.id]: ability.cooldownSec * 1000,
    },
    gcdMsLeft: ability.triggersGcd ? GCD_MS : state.gcdMsLeft,
  }
}

/**
 * Хватает ли маны с учётом РЕЗЕРВА этого умения: после траты должно остаться
 * не меньше настроенной доли запаса. Резерв — настройка автокаста, поэтому
 * ручное нажатие им не ограничено: игрок вправе потратить всё.
 */
export function passesReserve(state: GameState, ability: AbilityDef): boolean {
  const reserve = state.abilitySettings[ability.id]?.reserve ?? 0
  if (reserve <= 0) return true
  const floor = state.stats.maxMana.times(reserve)
  return state.currentMana.minus(ability.manaCost).gte(floor)
}

// Эффект удара умения: свой из данных умения либо тот, которому научил талант
// (у Скорого выпада своего эффекта нет — его даёт «Рваный выпад»).
function effectFrom(
  state: GameState,
  ability: AbilityDef,
  swingDamage: Decimal,
): ActiveEffect | null {
  const effect = ability.effect ?? talentAbilityEffect(state.talents, ability.id)
  if (!effect) return null
  return {
    abilityId: ability.id,
    // Урон тика снят от УЖЕ посчитанного удара умения, поделённого на его
    // долю: получается «столько-то процентов удара оружия», как в данных.
    damagePerTick: swingDamage
      .div(ability.weaponDamagePercent)
      .times(effect.weaponDamagePercent),
    ticksLeft: effect.ticks,
    msToNextTick: effect.tickIntervalSec * 1000,
  }
}

/**
 * Урон умения по текущему мобу. Общая часть instant и onNextSwing: бросок
 * через rollSwing, событие в лог и на шину, эффект — если он у умения есть.
 * Смерть моба здесь НЕ оформляется: её подхватит конвейер тика, чтобы награды,
 * лут и респаун шли одним путём.
 */
export function strikeWithAbility(
  state: GameState,
  ability: AbilityDef,
  rng: Rng,
  emitAttack: (event: AttackEvent) => void,
): GameState {
  const { amount, isCrit } = rollSwing(state.stats, rng, ability.weaponDamagePercent)
  const monster = {
    ...state.monster,
    currentHp: Decimal.max(state.monster.currentHp.minus(amount), new Decimal(0)),
  }
  emitAttack({
    sourceId: 'hero',
    targetId: monster.id,
    amount,
    isCrit,
    abilityId: ability.id,
    timestamp: state.playtimeMs.toNumber(),
  })
  const effect = effectFrom(state, ability, amount)
  return {
    ...state,
    monster,
    activeEffects: effect
      ? // Повторное наложение обновляет эффект, а не копит второй такой же.
        [...state.activeEffects.filter((e) => e.abilityId !== ability.id), effect]
      : state.activeEffects,
    combatLog: pushEvent(state.combatLog, {
      type: 'ability',
      abilityId: ability.id,
      damage: amount,
      isCrit,
    }),
  }
}

/**
 * Нажатие на умение. Мгновенное бьёт сразу; onNextSwing встаёт в очередь
 * (или снимается с неё повторным нажатием). Недоступное умение не меняет
 * состояние вовсе — причину показывает abilityStatus.
 */
export function useAbility(
  state: GameState,
  abilityId: string,
  rng: Rng,
  emitAttack: (event: AttackEvent) => void,
): GameState {
  const ability = ABILITY_BY_ID[abilityId]
  if (!ability) return state
  if (!abilityStatus(state, ability).usable) return state

  if (ability.type === 'onNextSwing') {
    // Повторное нажатие снимает умение с очереди. Мана не списывалась при
    // постановке, поэтому и возвращать нечего — отмена бесплатна.
    if (state.queuedAbilityId === ability.id) return { ...state, queuedAbilityId: null }
    // Очередь одна: новое умение вытесняет прежнее, тоже без списаний.
    return { ...state, queuedAbilityId: ability.id }
  }

  // Мгновенное: платим и бьём здесь же. Прогресс замаха не трогаем —
  // автоатака идёт своим чередом, умение её не сбивает и не ускоряет.
  return strikeWithAbility(payFor(state, ability), ability, rng, emitAttack)
}

/**
 * Замах наступил, а в очереди стоит умение. Если маны хватает — умение
 * заменяет автоатаку; если нет, очередь снимается и бьёт обычная автоатака.
 * Возвращает null, если очередь пуста или сорвалась.
 */
export function consumeQueuedAbility(
  state: GameState,
  rng: Rng,
  emitAttack: (event: AttackEvent) => void,
): GameState | null {
  const ability = state.queuedAbilityId ? ABILITY_BY_ID[state.queuedAbilityId] : null
  if (!ability) return null
  const cleared = { ...state, queuedAbilityId: null }
  // Мана списывается ЗДЕСЬ, в момент удара, а не при постановке в очередь.
  if (cleared.currentMana.lt(ability.manaCost)) return null
  if (cooldownLeft(cleared, ability) > 0) return null
  return strikeWithAbility(payFor(cleared, ability), ability, rng, emitAttack)
}

/**
 * Кандидаты автокаста: включённые галкой умения по приоритету, у которых
 * вышел кулдаун и ХВАТАЕТ МАНЫ прямо сейчас. Мана проверяется и для
 * onNextSwing: ставить в очередь то, что всё равно сорвётся, автокаст не станет.
 */
export function autocastCandidates(state: GameState): AbilityDef[] {
  return abilitiesByPriority(state.abilitySettings, true).filter((ability) => {
    if (state.currentMana.lt(ability.manaCost)) return false
    if (!passesReserve(state, ability)) return false
    // Очередь одна: пока в ней кто-то стоит, второе умение туда не ставим,
    // а повторное нажатие на стоящее в очереди её бы просто сняло.
    if (ability.type === 'onNextSwing' && state.queuedAbilityId !== null) return false
    return abilityStatus(state, ability).usable
  })
}

/**
 * Шаг автокаста. Разница с ручной игрой возникает ЕСТЕСТВЕННО, из двух правил:
 *  1. задержка реакции — автокаст бьёт не мгновенно, а через AUTOCAST_DELAY_MS
 *     после того, как умение стало доступно (таймер взводится заново, пока
 *     доступного нет, и тикает, пока есть);
 *  2. автокаст не придерживает кулдауны — жмёт первое доступное по приоритету,
 *     даже если моб умрёт через секунду.
 * Никаких множителей и скрытых штрафов сверх этого.
 */
export function autocastStep(
  state: GameState,
  dtMs: number,
  rng: Rng,
  emitAttack: (event: AttackEvent) => void,
): GameState {
  if (state.heroState === 'dead') return { ...state, autocastReadyMs: {} }
  const ready = new Set(autocastCandidates(state).map((a) => a.id))
  const autocastReadyMs: Record<string, number> = {}
  let cast: AbilityDef | null = null
  // Таймер ведётся ПО КАЖДОМУ умению: недоступное держит его взведённым,
  // доступное — тикает. Применяем первое по приоритету, у кого таймер вышел.
  for (const ability of abilitiesByPriority(state.abilitySettings, true)) {
    if (!ready.has(ability.id)) {
      autocastReadyMs[ability.id] = AUTOCAST_DELAY_MS
      continue
    }
    const left = (state.autocastReadyMs[ability.id] ?? AUTOCAST_DELAY_MS) - dtMs
    if (left > 0 || cast !== null) {
      autocastReadyMs[ability.id] = Math.max(left, 0)
      continue
    }
    cast = ability
    autocastReadyMs[ability.id] = AUTOCAST_DELAY_MS
  }
  const next = { ...state, autocastReadyMs }
  return cast ? { ...useAbility(next, cast.id, rng, emitAttack), autocastReadyMs } : next
}

/** Кулдауны и GCD идут игровым временем — тем же dtMs, что и весь бой. */
export function advanceCooldowns(state: GameState, dtMs: number): GameState {
  const abilityCooldownsMs: Record<string, number> = {}
  let changed = false
  for (const [id, left] of Object.entries(state.abilityCooldownsMs)) {
    const next = left - dtMs
    if (next > 0) abilityCooldownsMs[id] = next
    else changed = true
    if (next !== left) changed = true
  }
  const gcdMsLeft = Math.max(0, state.gcdMsLeft - dtMs)
  if (!changed && gcdMsLeft === state.gcdMsLeft) return state
  return { ...state, abilityCooldownsMs, gcdMsLeft }
}
