// Активные умения: доступность, применение и постановка в очередь.
// Своей формулы урона здесь НЕТ — умение это доля удара оружия, а удар
// считает combat.ts. Текста для игрока тоже нет: наружу идут коды причин.
import { Decimal } from './numbers'
import { absorbPool, rollSwing } from './combat'
import { AUTOCAST_DELAY_MS, GCD_MS } from '../data/balance'
import { ABILITIES, ABILITY_BY_ID, type AbilityDef } from '../data/abilities'
import { abilitiesByPriority } from './rotation'
import { talentAbilityEffect, talentExtraCharges } from './talents'
import { punishResourceSpend } from './bossAbilities'
import { abilitiesOf, pushEvent, rotationOf, type ActiveEffect, type GameState } from './state'
import type { Rng } from './rng'
import type { AttackEvent, CombatEvent } from '../types'

export { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
// Запас щита считает combat.ts — он нижний слой и знает про статы; здесь
// имя переэкспортировано, чтобы вызывающим не приходилось знать, где оно.
export { absorbPool } from './combat'
export type { AbilityDef, AbilityEffect, AbilityType } from '../data/abilities'

// Почему кнопка не нажимается. Каждый случай отдельный код — текст рендерит UI.
export type AbilityBlockReason =
  | 'locked'
  | 'dead'
  | 'cooldown'
  | 'gcd'
  | 'no-mana'
  | 'no-combo'
  | 'target-healthy'

export interface AbilityStatus {
  abilityId: string
  usable: boolean
  reason: AbilityBlockReason | null
  cooldownMsLeft: number
  cooldownFraction: number // 0 — готово, 1 — только что ушло в кулдаун
  gcdMsLeft: number
  queued: boolean // умение стоит в очереди на следующий замах
  chargesLeft: number // сколько нажатий осталось до отката
  maxCharges: number // полный комплект зарядов; один по умолчанию
}

/**
 * Сколько зарядов у умения сейчас. Один по умолчанию; талант-капстоун
 * добавляет второй. Число берётся из payload флага — своего числа у логики нет.
 */
export function maxCharges(state: GameState, ability: AbilityDef): number {
  return 1 + talentExtraCharges(state.talents, ability.id)
}

/**
 * Сколько зарядов не потрачено. ОТСУТСТВИЕ записи означает полный комплект —
 * но только если и откат не идёт: откат заводится ровно тогда, когда заряд
 * потрачен, и состояние «откат идёт, записи нет» приходит либо из сейва
 * прошлой версии, либо собрано руками. Читаем его как «один заряд потрачен»,
 * иначе у такого героя умение оказалось бы готово посреди отката.
 */
export function chargesLeft(state: GameState, ability: AbilityDef): number {
  const max = maxCharges(state, ability)
  const left = state.abilityCharges[ability.id]
  if (typeof left !== 'number' || !Number.isFinite(left)) {
    return cooldownLeft(state, ability) > 0 ? Math.max(0, max - 1) : max
  }
  return Math.min(max, Math.max(0, Math.floor(left)))
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
  const left = chargesLeft(state, ability)
  const queued = state.queuedAbilityId === ability.id
  const base = {
    abilityId: ability.id,
    cooldownMsLeft,
    cooldownFraction: ability.cooldownSec > 0 ? cooldownMsLeft / (ability.cooldownSec * 1000) : 0,
    gcdMsLeft: Math.max(0, state.gcdMsLeft),
    queued,
    chargesLeft: left,
    maxCharges: maxCharges(state, ability),
  }
  // Снять своё же умение с очереди можно всегда, чем бы игрок ни был занят.
  if (queued) return { ...base, usable: true, reason: null }
  const blocked = (reason: AbilityBlockReason) => ({ ...base, usable: false, reason })
  // Запертое уровнем — первым: эта причина не лечится ни ожиданием, ни маной.
  if (state.level.lt(ability.unlockLevel)) return blocked('locked')
  if (state.heroState === 'dead') return blocked('dead')
  // Запирает НЕ «идёт откат», а «зарядов не осталось»: у умения с одним
  // зарядом это ровно прежнее поведение, у двухзарядного — второе нажатие
  // проходит, пока откат идёт.
  if (left <= 0) return blocked('cooldown')
  if (ability.triggersGcd && state.gcdMsLeft > 0) return blocked('gcd')
  if (ability.type === 'instant' && state.currentMana.lt(ability.manaCost)) return blocked('no-mana')
  // ДЕТОНАТОРУ НЕЧЕГО СЪЕДАТЬ. Отказ, а не «нажмётся и пропадёт»: иначе
  // умение встало бы в очередь на замах и списало ресурс впустую — ровно то,
  // что автокаст делал бы систематически.
  if (ability.detonate && pendingEffectDamage(state).lte(0)) return blocked('no-combo')
  // ДОБИВАНИЕ ЖДЁТ СВОЕГО МОМЕНТА. Порог — из данных умения; автокаст его
  // просто пропускает, пока цель выше порога, и это не особое правило
  // автокаста, а тот же отказ, что видит игрок.
  if (ability.execute && !targetLowEnough(state, ability)) return blocked('target-healthy')
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

/**
 * Заряд тратится всегда; ОТКАТ ЗАВОДИТСЯ ТОЛЬКО ЕСЛИ ОН НЕ ИДЁТ — заряды
 * копятся по одному, а не все разом. При одном заряде поведение прежнее:
 * потратил — откат пошёл.
 */
function payFor(state: GameState, ability: AbilityDef): GameState {
  // БЕСПЛАТНОЕ ПРИМЕНЕНИЕ. Тратится только на то, что вообще стоит ресурса:
  // на нулевой цене заряд сгорал бы впустую. Пауза регенерации при этом не
  // взводится — трата не состоялась.
  if (state.freeCastsLeft > 0 && ability.manaCost.gt(0)) {
    const running = cooldownLeft(state, ability) > 0
    return punishResourceSpend(
      {
        ...state,
        freeCastsLeft: state.freeCastsLeft - 1,
        abilityCharges: {
          ...state.abilityCharges,
          [ability.id]: Math.max(0, chargesLeft(state, ability) - 1),
        },
        abilityCooldownsMs: running
          ? state.abilityCooldownsMs
          : { ...state.abilityCooldownsMs, [ability.id]: ability.cooldownSec * 1000 },
        gcdMsLeft: ability.triggersGcd ? GCD_MS : state.gcdMsLeft,
      },
      new Decimal(0),
    )
  }
  const spends = resetsRegenDelay(ability)
  const running = cooldownLeft(state, ability) > 0
  const left = Math.max(0, chargesLeft(state, ability) - 1)
  const paid: GameState = {
    ...state,
    currentMana: state.currentMana.minus(ability.manaCost),
    // Пауза берётся из СТАТА: талант автономности её сокращает, и делает
    // это через конвейер, как всё остальное.
    regenDelayMsLeft: spends ? state.stats.regenDelay * 1000 : state.regenDelayMsLeft,
    abilityCharges: { ...state.abilityCharges, [ability.id]: left },
    abilityCooldownsMs: running
      ? state.abilityCooldownsMs
      : { ...state.abilityCooldownsMs, [ability.id]: ability.cooldownSec * 1000 },
    gcdMsLeft: ability.triggersGcd ? GCD_MS : state.gcdMsLeft,
  }
  // Героическая «отдача»: босс наказывает за саму ТРАТУ ресурса. Хук стоит
  // здесь, потому что здесь ресурс и списывается — значит покрыты и автокаст,
  // и очередь, и ручное нажатие между тиками. Вне героики функция возвращает
  // состояние как есть.
  return punishResourceSpend(paid, ability.manaCost)
}

/**
 * Лечащее умение, которое автокаст вообще жмёт: открыто уровнем и отмечено
 * галкой. Нет такого — нечего и беречь.
 */
export function autocastHeal(state: GameState): AbilityDef | null {
  // ТОЛЬКО ИЗ РЯДА: лечение, не положенное в четвёрку, автокаст нажать не
  // может — и беречь под него ману было бы обещанием, которого игра не держит.
  for (const ability of abilitiesByPriority(rotationOf(state), true)) {
    if (!ability.heal) continue
    if (state.level.lt(ability.unlockLevel)) continue
    return ability
  }
  return null
}

/** Стоит ли автокасту клеймить эту цель: она ещё достаточно цела. */
export function brandWorthIt(state: GameState, ability: AbilityDef): boolean {
  if (!ability.brand) return true
  if (state.monster.maxHp.lte(0)) return false
  return state.monster.currentHp
    .div(state.monster.maxHp)
    .gte(ability.brand.autocastAboveHpShare)
}

/** Цель достаточно слаба для добивания: доля здоровья ниже порога из данных. */
export function targetLowEnough(state: GameState, ability: AbilityDef): boolean {
  if (!ability.execute) return true
  if (state.monster.maxHp.lte(0)) return false
  return state.monster.currentHp.div(state.monster.maxHp).lt(ability.execute.belowHpShare)
}

/** Пора ли лечиться: здоровье ниже порога автокаста из данных умения. */
export function healWanted(state: GameState, ability: AbilityDef): boolean {
  if (!ability.heal) return false
  return state.currentHp.lt(state.stats.maxHp.times(ability.heal.autocastBelowHpShare))
}

/**
 * Хватает ли маны с учётом РЕЗЕРВА этого умения: после траты должно остаться
 * не меньше настроенной доли запаса — и не меньше цены одного лечения, если
 * включено «беречь ману под лечение» (само лечение этим не ограничено).
 * Резерв — настройка автокаста, поэтому ручное нажатие им не ограничено:
 * игрок вправе потратить всё.
 */
export function passesReserve(state: GameState, ability: AbilityDef): boolean {
  const left = state.currentMana.minus(ability.manaCost)
  const reserve = state.abilitySettings[ability.id]?.reserve ?? 0
  if (reserve > 0 && left.lt(state.stats.maxMana.times(reserve))) return false
  if (state.holdManaForHeal && !ability.heal) {
    const heal = autocastHeal(state)
    if (heal && left.lt(heal.manaCost)) return false
  }
  return true
}

/**
 * Лечение умением: возвращает долю максимального запаса, перелив режется.
 * Моба не трогает; событие несёт РЕАЛЬНУЮ прибавку, а не номинал.
 */
export function healWithAbility(state: GameState, ability: AbilityDef): GameState {
  const share = ability.heal?.maxHpShare ?? new Decimal(0)
  const healed = Decimal.min(state.currentHp.plus(state.stats.maxHp.times(share)), state.stats.maxHp)
  return {
    ...state,
    currentHp: healed,
    abilityCasts: state.abilityCasts.plus(1),
    combatLog: pushEvent(state.combatLog, {
      type: 'ability-heal',
      abilityId: ability.id,
      amount: healed.minus(state.currentHp),
    }),
  }
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
  // Умение поддержки бьёт нулём, и делить на ноль здесь нечего: эффекта у
  // него нет, а талант, который его выдаст, обязан выдать и урон.
  if (ability.weaponDamagePercent.lte(0)) return null
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
  const roll = rollSwing(state.stats, rng, ability.weaponDamagePercent)
  const isCrit = roll.isCrit
  const amount = roll.amount.times(outgoingMultiplier(state))
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
  let after: GameState = {
    ...state,
    monster,
    abilityCasts: state.abilityCasts.plus(1),
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
  // ДЕТОНАТОР СЪЕДАЕТ ЭФФЕКТ И БЬЁТ ЕГО ОСТАТКОМ. Берётся ЛЮБОЙ эффект по
  // времени, висящий на мобе, а не «эффект такого-то умения»: связка описана
  // данными, а логика про имена не знает.
  if (ability.detonate) after = detonate(after, ability, emitAttack)
  // ОСЛАБЛЕНИЕ ЦЕЛИ. Доля снимается с данных В МОМЕНТ применения: висящая
  // метка не должна меняться задним числом от правки умения.
  if (ability.weaken) {
    after = {
      ...after,
      monsterWeaken: { damageShare: ability.weaken.damageShare, hitsLeft: ability.weaken.hits },
    }
  }
  // КЛЕЙМО. Повторное наложение обновляет метку, а не копит вторую.
  if (ability.brand) {
    after = {
      ...after,
      monsterBrand: {
        damageShare: ability.brand.damageShare,
        msLeft: ability.brand.durationSec * 1000,
      },
    }
  }
  return applySelfFlags(after, ability)
}

/**
 * Собственные метки героя: стойка и бесплатные применения. Общая точка для
 * бьющих умений и для поддержки — иначе флаг работал бы у одних и молчал у
 * других в зависимости от того, бьёт умение или нет.
 */
function applySelfFlags(state: GameState, ability: AbilityDef): GameState {
  let next = state
  if (ability.stance) {
    next = {
      ...next,
      stance: {
        damageShare: ability.stance.damageShare,
        mitigationShare: ability.stance.mitigationShare,
        msLeft: ability.stance.durationSec * 1000,
      },
    }
  }
  // БЕСПЛАТНЫЕ ПРИМЕНЕНИЯ ставятся ПОСЛЕ оплаты самого умения: иначе
  // «Сосредоточение» съело бы одно из трёх на себя.
  if (ability.freeCasts) next = { ...next, freeCastsLeft: ability.freeCasts.casts }
  return next
}

/**
 * МНОЖИТЕЛЬ ИСХОДЯЩЕГО УРОНА ГЕРОЯ. Две метки и обе временные: клеймо на
 * ЦЕЛИ поднимает получаемый ею урон, стойка ГЕРОЯ его срезает. Считается в
 * одном месте, потому что применяется в четырёх — автоатака, обе руки,
 * умение и тик эффекта; четыре копии этой строки разъехались бы на первой
 * же новой метке.
 */
export function outgoingMultiplier(state: GameState): Decimal {
  let mult = new Decimal(1)
  if (state.monsterBrand) mult = mult.times(1 + state.monsterBrand.damageShare)
  if (state.stance) mult = mult.times(1 - state.stance.damageShare)
  return mult
}

/** Сколько урона осталось во всех эффектах на мобе. */
export function pendingEffectDamage(state: GameState): Decimal {
  return state.activeEffects.reduce(
    (sum, e) => sum.plus(e.damagePerTick.times(e.ticksLeft)),
    new Decimal(0),
  )
}

/** Съесть эффекты с моба и нанести их остаток сразу, с множителем из данных. */
function detonate(
  state: GameState,
  ability: AbilityDef,
  emitAttack: (event: AttackEvent) => void,
): GameState {
  const pending = pendingEffectDamage(state)
  if (pending.lte(0)) return state
  const burst = pending.times(ability.detonate!.multiplier).times(outgoingMultiplier(state))
  const monster = {
    ...state.monster,
    currentHp: Decimal.max(state.monster.currentHp.minus(burst), new Decimal(0)),
  }
  emitAttack({
    sourceId: 'hero',
    targetId: monster.id,
    amount: burst,
    isCrit: false,
    abilityId: ability.id,
    timestamp: state.playtimeMs.toNumber(),
  })
  return {
    ...state,
    monster,
    // Эффект СЪЕДЕН целиком: остаток ушёл в удар, тикать больше нечему.
    activeEffects: [],
    combatLog: pushEvent(state.combatLog, {
      type: 'effect',
      abilityId: ability.id,
      damage: burst,
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
  // Лечение — тем же путём оплаты, только вместо удара возвращает здоровье.
  if (ability.heal) return healWithAbility(payFor(state, ability), ability)
  // Поглощение — тоже поддержка: платит как все, но вместо удара вешает щит.
  if (ability.absorb) return absorbWithAbility(payFor(state, ability), ability)
  return strikeWithAbility(payFor(state, ability), ability, rng, emitAttack)
}

function absorbWithAbility(state: GameState, ability: AbilityDef): GameState {
  const pool = absorbPool(state, ability)
  return applySelfFlags({
    ...state,
    // Повторное применение ЗАМЕНЯЕТ щит, а не копит второй: иначе умение с
    // коротким откатом складывалось бы само с собой.
    absorb: { left: pool, msLeft: ability.absorb!.durationSec * 1000 },
    combatLog: pushEvent(state.combatLog, {
      type: 'ability',
      abilityId: ability.id,
      damage: new Decimal(0),
      isCrit: false,
    }),
  }, ability)
}

// Почему умение из очереди сорвётся на замахе. Код уходит в лог событием
// `ability-dropped`, текст рендерит UI.
export type QueueDropReason = Extract<CombatEvent, { type: 'ability-dropped' }>['reason']

/** null — очередь пуста или умение ударит; иначе причина срыва. */
export function queuedAbilityDropReason(state: GameState): QueueDropReason | null {
  const ability = state.queuedAbilityId ? ABILITY_BY_ID[state.queuedAbilityId] : null
  if (!ability) return null
  // Мана списывается В МОМЕНТ УДАРА, а не при постановке в очередь.
  if (state.currentMana.lt(ability.manaCost)) return 'no-mana'
  if (chargesLeft(state, ability) <= 0) return 'no-charges'
  return null
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
  if (!ability || queuedAbilityDropReason(state) !== null) return null
  const cleared = { ...state, queuedAbilityId: null }
  return strikeWithAbility(payFor(cleared, ability), ability, rng, emitAttack)
}

/**
 * Кандидаты автокаста: включённые галкой умения по приоритету, у которых
 * вышел кулдаун и ХВАТАЕТ МАНЫ прямо сейчас. Мана проверяется и для
 * onNextSwing: ставить в очередь то, что всё равно сорвётся, автокаст не станет.
 */
export function autocastCandidates(state: GameState): AbilityDef[] {
  return abilitiesByPriority(rotationOf(state), true).filter((ability) => {
    if (state.currentMana.lt(ability.manaCost)) return false
    if (!passesReserve(state, ability)) return false
    // Лечение автокаст жмёт только когда оно нужно: порог — из данных умения.
    if (ability.heal && !healWanted(state, ability)) return false
    // КЛЕЙМО НЕ ВЕШАЕТСЯ НА УМИРАЮЩЕГО. Двадцать секунд повышенного урона на
    // мобе, которому осталось две, не окупаются — а ресурс тратят, и делали
    // бы это систематически. Порог из данных умения; РУКАМИ игрок волен
    // ставить клеймо когда угодно, это правило только для автокаста.
    if (ability.brand && !brandWorthIt(state, ability)) return false
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
  // ЛЕЧЕНИЕ ВПЕРЕДИ ЛЮБОГО УРОНА, когда оно нужно (см. healWanted): порядок
  // приоритетов игрока решает, что бить, а «выжить» стоит выше. Флаг из
  // данных, а не id: любое лечащее умение любого класса встанет так же.
  const byPriority = abilitiesByPriority(rotationOf(state), true)
  const order = [
    ...byPriority.filter((a) => a.heal && ready.has(a.id)),
    ...byPriority.filter((a) => !(a.heal && ready.has(a.id))),
  ]
  for (const ability of order) {
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

/**
 * Кулдауны и GCD идут игровым временем — тем же dtMs, что и весь бой.
 * Вышедший откат ВОЗВРАЩАЕТ ОДИН ЗАРЯД и, если полный комплект ещё не набран,
 * заводится заново с остатка: так второй заряд копится сам, а не ждёт, пока
 * игрок потратит первый. Полный комплект — это ОТСУТСТВИЕ записи, поэтому у
 * героя без талантов-зарядов оба словаря пусты, как и раньше.
 */
export function advanceCooldowns(state: GameState, dtMs: number): GameState {
  const abilityCooldownsMs: Record<string, number> = {}
  const abilityCharges: Record<string, number> = { ...state.abilityCharges }
  let changed = false
  for (const [id, leftMs] of Object.entries(state.abilityCooldownsMs)) {
    const ability = ABILITY_BY_ID[id]
    if (!ability) {
      changed = true
      continue
    }
    const max = maxCharges(state, ability)
    const period = ability.cooldownSec * 1000
    let next = leftMs - dtMs
    let charges = abilityCharges[id] ?? max
    // Один жирный тик может вернуть несколько зарядов — остаток переносится,
    // как остаток замаха. Нулевой период вернул бы их бесконечно, поэтому он
    // означает «комплект полон сразу».
    while (next <= 0 && charges < max) {
      charges += 1
      if (period <= 0) break
      next += period
    }
    if (charges >= max) {
      // Комплект полон: ни отката, ни записи о зарядах.
      delete abilityCharges[id]
      changed = true
      continue
    }
    abilityCharges[id] = charges
    abilityCooldownsMs[id] = next
    if (next !== leftMs || charges !== (state.abilityCharges[id] ?? max)) changed = true
  }
  const gcdMsLeft = Math.max(0, state.gcdMsLeft - dtMs)
  // ЩИТ ТИКАЕТ ТЕМ ЖЕ ИГРОВЫМ ВРЕМЕНЕМ, что откаты: множитель скорости из
  // отладочной панели ускоряет и его. Своего таймера у щита нет — он живёт
  // здесь, рядом с остальными обратными отсчётами умений.
  const absorb = countdown(state.absorb, dtMs)
  const monsterBrand = countdown(state.monsterBrand, dtMs)
  const stance = countdown(state.stance, dtMs)
  if (
    !changed &&
    gcdMsLeft === state.gcdMsLeft &&
    absorb === state.absorb &&
    monsterBrand === state.monsterBrand &&
    stance === state.stance
  ) {
    return state
  }
  return {
    ...state,
    abilityCooldownsMs,
    abilityCharges,
    gcdMsLeft,
    absorb,
    monsterBrand,
    stance,
  }
}

/** Обратный отсчёт метки с длительностью; вышло время — метки нет. */
function countdown<T extends { msLeft: number }>(mark: T | null, dtMs: number): T | null {
  if (mark === null) return null
  return mark.msLeft <= dtMs ? null : { ...mark, msLeft: mark.msLeft - dtMs }
}
