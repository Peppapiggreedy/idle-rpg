// Активные умения: доступность, применение и постановка в очередь.
// Своей формулы урона здесь НЕТ — умение это доля удара оружия, а удар
// считает combat.ts. Текста для игрока тоже нет: наружу идут коды причин.
import { Decimal } from './numbers'
import { absorbPool, rollSwing } from './combat'
import { AUTOCAST_DELAY_MS, GCD_MS } from '../data/balance'
import { ABILITIES, ABILITY_BY_ID, type AbilityDef } from '../data/abilities'
import { tuneAbility, tunedById } from './abilityTune'
import { abilitiesByPriority } from './rotation'
import { talentExtraCharges } from './talents'
import { punishResourceSpend } from './bossAbilities'
import {
  abilitiesOf,
  equippedBoons,
  pushEvent,
  rotationOf,
  type ActiveEffect,
  type GameState,
} from './state'
import type { Rng } from './rng'
import type { AttackEvent, CombatEvent } from '../types'

export { ABILITIES, ABILITY_BY_ID } from '../data/abilities'

/**
 * УМЕНИЕ ГЕРОЯ — ЭФФЕКТИВНОЕ, А НЕ БАЗОВОЕ. Единственная точка, через
 * которую логика берёт умение по id: талант, сдвинувший порог добивания,
 * обязан сдвинуть и гейт автокаста, иначе кнопка и автоматика разойдутся.
 */
export function abilityOf(state: GameState, abilityId: string): AbilityDef | undefined {
  return tunedById(abilityId, state.talents, equippedBoons(state.equipment))
}

/** Умения класса, подкрученные талантами героя. Их и показывает книга. */
export function heroAbilities(state: GameState): AbilityDef[] {
  const boons = equippedBoons(state.equipment)
  return abilitiesOf(state.classId).map((a) => tuneAbility(a, state.talents, boons))
}
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
  // ВОРОТА ПО ПОЛОСКЕ — два разных отказа, и разными они обязаны быть:
  // «мало ярости» лечится боем, «много» — тратой. Один код на оба заставил
  // бы игрока гадать, в какую сторону идти.
  | 'resource-low'
  | 'resource-high'

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
 * ДОЛЯ ПОЛНОТЫ ПОЛОСКИ, 0..1. Читается именно ДОЛЯ, а не абсолютный запас:
 * у героя, поднявшего ёмкость талантами, «полная полоска» обязана значить то
 * же самое, что и до талантов. Одно место на всю игру: полоску читают
 * детонатор, ворота, вампиризм, добивание, грань и урон Череполома.
 */
export function resourceFill(state: GameState): number {
  if (state.stats.maxMana.lte(0)) return 0
  return Decimal.min(new Decimal(1), state.currentMana.div(state.stats.maxMana)).toNumber()
}

/**
 * ВО СКОЛЬКО ОБОЙДЁТСЯ ПРИМЕНЕНИЕ. Обычно — `manaCost` из данных; у умения с
 * `spendAll` — ВЕСЬ текущий запас. Считается одной функцией, потому что цену
 * спрашивают в четырёх местах: отказ по нехватке, списание, автокаст и
 * модель боя; четыре копии условия разъехались бы на первой правке.
 */
export function abilityCost(state: GameState, ability: AbilityDef): Decimal {
  return ability.spendAll ? state.currentMana : ability.manaCost
}

/**
 * УРОН УМЕНИЯ В ДОЛЯХ УДАРА ОРУЖИЯ — с надбавкой за полноту полоски, если
 * умение её читает. Считается ДО оплаты: Череполом тратит весь запас, и
 * платить сначала значило бы бить пустой полоской всегда.
 */
export function abilityDamagePercent(ability: AbilityDef, fill: number): Decimal {
  const extra = ability.weaponDamageFromResource
  if (!extra) return ability.weaponDamagePercent
  return ability.weaponDamagePercent.plus(extra.times(fill))
}

/** Пропускают ли ворота по полоске прямо сейчас; null — пропускают. */
export function resourceGate(state: GameState, ability: AbilityDef): AbilityBlockReason | null {
  const gate = ability.requires
  if (!gate) return null
  const fill = resourceFill(state)
  if (gate.resourceAbove !== undefined && fill < gate.resourceAbove) return 'resource-low'
  if (gate.resourceBelow !== undefined && fill > gate.resourceBelow) return 'resource-high'
  return null
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
  // ВОРОТА ПО ПОЛОСКЕ — ПРАВИЛО УМЕНИЯ, а не подсказка автокасту: отказ видит
  // и игрок, и модель, и обходится он только полоской.
  //
  // СТОЯТ ОНИ ПЕРЕД ПРОВЕРКОЙ ЦЕНЫ, и это не мелочь: у умения с порогом
  // «нужно больше» цена всё равно не наберётся, и «не хватает ярости»
  // сказало бы правду, умолчав о главном — что порог здесь ВЫШЕ цены.
  const gate = resourceGate(state, ability)
  if (gate) return blocked(gate)
  if (ability.type === 'instant' && state.currentMana.lt(abilityCost(state, ability))) {
    return blocked('no-mana')
  }
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
  return heroAbilities(state).map((a) => abilityStatus(state, a))
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

/** Умение вообще что-то стоит: своя цена или «весь запас». */
export function costsResource(ability: AbilityDef): boolean {
  return ability.manaCost.gt(0) || Boolean(ability.spendAll)
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
  // ОКНО делает то же самое, но по ВРЕМЕНИ, и потому счётчик не трогает:
  // «восемь секунд бесплатно» и «три применения бесплатно» — разные обещания,
  // и одно не должно тратить другое.
  if ((state.freeCastsLeft > 0 || state.freeCastsMsLeft > 0) && abilityCost(state, ability).gt(0)) {
    const running = cooldownLeft(state, ability) > 0
    return punishResourceSpend(
      {
        ...state,
        freeCastsLeft:
          state.freeCastsMsLeft > 0 ? state.freeCastsLeft : state.freeCastsLeft - 1,
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
  const spends = resetsRegenDelay(ability) || Boolean(ability.spendAll)
  const running = cooldownLeft(state, ability) > 0
  const left = Math.max(0, chargesLeft(state, ability) - 1)
  // ЦЕНА — ИЗ ОДНОЙ ФУНКЦИИ: у «Череполома» она равна всему, что накоплено,
  // и списывать её надо ПОСЛЕ того, как урон уже посчитан по этой же полоске.
  const cost = abilityCost(state, ability)
  const paid: GameState = {
    ...state,
    currentMana: state.currentMana.minus(cost),
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
  return punishResourceSpend(paid, cost)
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
  return state.monster.currentHp.div(state.monster.maxHp).lt(executeThreshold(state, ability))
}

/**
 * ПОРОГ ДОБИВАНИЯ — с надбавкой за полноту полоски, если умение её читает.
 * Так накопленный ресурс укорачивает хвост боя ЕЩЁ ДО ТОГО, как потрачен.
 */
export function executeThreshold(state: GameState, ability: AbilityDef): number {
  const base = ability.execute?.belowHpShare ?? 0
  const extra = ability.execute?.belowHpShareFromResource ?? 0
  return extra > 0 ? base + extra * resourceFill(state) : base
}

/**
 * РАЗГОН ПОСЛЕ СВОЕГО УДАРА. Растёт ПОСЛЕ применения множителя, а не до:
 * первый удар проходит без прибавки — ровно как «Упор» не смягчает первый
 * пропущенный. Разгона нет — состояние возвращается тем же объектом, и
 * лишнего копирования состояния в горячем цикле не случается.
 */
export function grownRamp(state: GameState): GameState['ramp'] {
  const ramp = state.ramp
  if (!ramp || ramp.share >= ramp.maxShare) return ramp
  return { ...ramp, share: Math.min(ramp.maxShare, ramp.share + ramp.perSwing) }
}

/**
 * ДОЛЯ ВАМПИРИЗМА — с надбавкой за полноту полоски, если умение её читает.
 * У Стража надбавки нет вовсе, и доля равна записанной в данных.
 */
export function leechShare(ability: AbilityDef, fill: number): number {
  const base = ability.leech?.healShare ?? 0
  const extra = ability.leech?.healShareFromResource ?? 0
  return extra > 0 ? base + extra * fill : base
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
  const left = state.currentMana.minus(abilityCost(state, ability))
  // ПОЛ КЛАССА И РЕЗЕРВ УМЕНИЯ СКЛАДЫВАЮТСЯ ПО МАКСИМУМУ: пол — «ниже чего
  // автокаст не тратит вообще», резерв — «сколько держать под эту кнопку»,
  // и действует тот, что выше. Оба — доли ЗАПАСА, а не числа: у героя,
  // поднявшего ёмкость талантами, «30 %» обязано значить то же самое.
  const reserve = Math.max(state.abilitySettings[ability.id]?.reserve ?? 0, state.resourceFloor)
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

// Эффект удара умения. Выученный талантом («Рваный выпад» учит Скорый выпад
// кровить) сюда приходит УЖЕ ПОДШИТЫМ: его кладёт `tuneAbility`, и умение
// здесь эффективное. Второго чтения флага тут нет намеренно — иначе тик и
// модель читали бы талант из двух мест и разошлись бы на первой правке.
function effectFrom(ability: AbilityDef, swingDamage: Decimal): ActiveEffect | null {
  const effect = ability.effect
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
  /**
   * ПОЛНОТА ПОЛОСКИ ДО ОПЛАТЫ. Считать её здесь нельзя: `state` сюда приходит
   * УЖЕ ОПЛАЧЕННЫМ, а «Череполом» платит всем, что накоплено, — по своей же
   * полоске он бил бы всегда пустой. Поэтому долю читает вызывающий, ДО
   * `payFor`, и передаёт числом.
   */
  fill: number,
): GameState {
  const roll = rollSwing(state.stats, rng, abilityDamagePercent(ability, fill))
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
  const effect = effectFrom(ability, amount)
  // ВАМПИРИЗМ: доля НАНЕСЁННОГО урона возвращается здоровьем. Считается от
  // `amount`, то есть уже с критом и метками: лечение тем больше, чем лучше
  // прошёл удар, и это ровно то, чем оно отличается от лечения по запасу.
  // ВАМПИРИЗМ ЧИТАЕТ ПОЛОСКУ, если так сказано в данных: бой, который идёт
  // хорошо, лечит лучше. Доля берётся ДО оплаты — по той же полоске, по
  // которой посчитан урон.
  const leeched = ability.leech
    ? Decimal.min(
        state.currentHp.plus(amount.times(leechShare(ability, fill))),
        state.stats.maxHp,
      )
    : state.currentHp
  let after: GameState = {
    ...state,
    currentHp: leeched,
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
  // Событие несёт РЕАЛЬНУЮ прибавку, а не номинал: у героя на полном
  // здоровье вампиризм не лечит ничего, и сцена не должна рисовать кольцо.
  if (ability.leech && leeched.gt(state.currentHp)) {
    after = {
      ...after,
      combatLog: pushEvent(after.combatLog, {
        type: 'ability-heal',
        abilityId: ability.id,
        amount: leeched.minus(state.currentHp),
      }),
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
  // ОКНО — то же самое во времени. Повторное применение продлевает окно с
  // нуля, а не складывается: иначе два каста подряд давали бы шестнадцать
  // секунд, и «восемь» перестало бы значить восемь.
  if (ability.window) next = { ...next, freeCastsMsLeft: ability.window.durationSec * 1000 }
  // УПОР начинается С НУЛЯ: смягчение не выдаётся авансом, оно нарастает
  // пропущенными ударами. Иначе это была бы просто стойка с задержкой.
  if (ability.resolve) {
    next = {
      ...next,
      resolve: {
        share: 0,
        perHitTaken: ability.resolve.perHitTaken,
        maxShare: ability.resolve.maxShare,
        msLeft: ability.resolve.durationSec * 1000,
      },
    }
  }
  // РАЗГОН начинается С НУЛЯ, как и «Упор»: прибавка не выдаётся авансом,
  // её надо набить своими ударами.
  if (ability.ramp) {
    next = {
      ...next,
      ramp: {
        share: 0,
        perSwing: ability.ramp.perSwing,
        maxShare: ability.ramp.maxShare,
        msLeft: ability.ramp.durationSec * 1000,
      },
    }
  }
  // ГРАНЬ своей величины не копит вовсе: она хранит только правило, по
  // которому урон читается из полоски каждый удар.
  if (ability.edge) {
    next = {
      ...next,
      edge: {
        resourceAbove: ability.edge.resourceAbove,
        damagePerShare: ability.edge.damagePerShare,
        msLeft: ability.edge.durationSec * 1000,
      },
    }
  }
  // ГЕНЕРАТОР И ВОЗВРАТ — одно и то же действие с разных сторон: доля запаса
  // приходит ПОСЛЕ оплаты. Перелив режется, как и у лечения.
  const gained =
    (ability.generate?.resourceShare ?? 0) +
    (ability.refund?.resourceShare ?? 0) +
    (ability.bloodPrice?.resourceShare ?? 0)
  if (gained > 0) {
    next = {
      ...next,
      currentMana: Decimal.min(
        next.currentMana.plus(next.stats.maxMana.times(gained)),
        next.stats.maxMana,
      ),
    }
  }
  // ПЛАТА ЗДОРОВЬЕМ. Последнее очко не снимается НИКОГДА: игрок имеет право
  // ошибиться, но кнопка, которой можно себя убить, — это не ошибка игрока,
  // а ловушка игры.
  if (ability.bloodPrice) {
    const price = next.stats.maxHp.times(ability.bloodPrice.hpShare)
    next = { ...next, currentHp: Decimal.max(next.currentHp.minus(price), new Decimal(1)) }
  }
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
  let mult = targetMultiplier(state)
  if (state.stance) mult = mult.times(1 - state.stance.damageShare)
  // РАЗГОН — набежавшая прибавка, зеркало «Упора»: там росло смягчение от
  // чужих ударов, здесь урон от своих.
  if (state.ramp) mult = mult.times(1 + state.ramp.share)
  // ГРАНЬ читает полоску ПРЯМО СЕЙЧАС, а не в момент применения: потратил
  // ярость — прибавка просела, накопил — вернулась. Ниже порога её нет вовсе.
  if (state.edge) {
    const fill = resourceFill(state)
    const room = 1 - state.edge.resourceAbove
    const over = room > 0 ? Math.max(0, fill - state.edge.resourceAbove) / room : 0
    mult = mult.times(1 + state.edge.damagePerShare * over)
  }
  return mult
}

/**
 * МНОЖИТЕЛЬ ОТ МЕТОК НА ЦЕЛИ — та часть исходящего, что принадлежит МОБУ, а
 * не руке героя. Клеймо поднимает урон, который цель получает от кого угодно:
 * и от удара героя, и от укуса пса. Собственные состояния героя (стойка,
 * разгон, грань) сюда не входят — они про его руку, и пёс их не наследует.
 */
export function targetMultiplier(state: GameState): Decimal {
  let mult = new Decimal(1)
  if (state.monsterBrand) mult = mult.times(1 + state.monsterBrand.damageShare)
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
  // МНОЖИТЕЛЬ РАСТЁТ ОТ ПОЛНОТЫ ПОЛОСКИ, если так сказано в данных умения.
  // Читается ДОЛЯ, а не абсолютный запас: у класса, поднявшего ёмкость
  // талантами, полная полоска обязана значить то же самое, что и раньше.
  const fill = state.stats.maxMana.gt(0)
    ? Decimal.min(new Decimal(1), state.currentMana.div(state.stats.maxMana)).toNumber()
    : 0
  const multiplier =
    ability.detonate!.multiplier + (ability.detonate!.resourceMultiplier ?? 0) * fill
  const burst = pending.times(multiplier).times(outgoingMultiplier(state))
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
  const ability = abilityOf(state, abilityId)
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
  // Доля полоски снимается ДО оплаты: по ней считаются и урон, и вампиризм.
  const fill = resourceFill(state)
  return strikeWithAbility(payFor(state, ability), ability, rng, emitAttack, fill)
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
  const ability = state.queuedAbilityId ? (abilityOf(state, state.queuedAbilityId) ?? null) : null
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
  const ability = state.queuedAbilityId ? (abilityOf(state, state.queuedAbilityId) ?? null) : null
  if (!ability || queuedAbilityDropReason(state) !== null) return null
  const cleared = { ...state, queuedAbilityId: null }
  const fill = resourceFill(cleared)
  return strikeWithAbility(payFor(cleared, ability), ability, rng, emitAttack, fill)
}

/**
 * Кандидаты автокаста: включённые галкой умения по приоритету, у которых
 * вышел кулдаун и ХВАТАЕТ МАНЫ прямо сейчас. Мана проверяется и для
 * onNextSwing: ставить в очередь то, что всё равно сорвётся, автокаст не станет.
 */
/**
 * ПОРОГИ АВТОКАСТА ИЗ ДАННЫХ УМЕНИЯ. Одна функция на все три порога, потому
 * что правило одно: автокаст не жмёт умение там, где оно не окупается, а
 * руками игрок волен жать что угодно.
 *
 * Ветвлений по id здесь нет и быть не может: читается payload `autocast`,
 * и новое умение с теми же порогами заработает без единой правки логики.
 */
export function autocastAllows(state: GameState, ability: AbilityDef): boolean {
  const guard = ability.autocast
  if (!guard) return true
  if (guard.heroHpAbove !== undefined) {
    if (state.currentHp.lt(state.stats.maxHp.times(guard.heroHpAbove))) return false
  }
  if (guard.targetHpAbove !== undefined) {
    if (state.monster.maxHp.lte(0)) return false
    if (state.monster.currentHp.div(state.monster.maxHp).lt(guard.targetHpAbove)) return false
  }
  if (guard.resourceBelow !== undefined) {
    if (state.currentMana.gte(state.stats.maxMana.times(guard.resourceBelow))) return false
  }
  // НЕ БИТЬ ПУСТОЙ ПОЛОСКОЙ. У умения, растущего от ресурса, слабый удар
  // стоит целого отката: руками так добить законно, а автокаст делал бы это
  // систематически.
  if (guard.resourceAbove !== undefined) {
    if (state.currentMana.lt(state.stats.maxMana.times(guard.resourceAbove))) return false
  }
  return true
}

export function autocastCandidates(state: GameState): AbilityDef[] {
  return abilitiesByPriority(rotationOf(state), true).filter((ability) => {
    if (state.currentMana.lt(abilityCost(state, ability))) return false
    if (!passesReserve(state, ability)) return false
    // Лечение автокаст жмёт только когда оно нужно: порог — из данных умения.
    if (ability.heal && !healWanted(state, ability)) return false
    // КЛЕЙМО НЕ ВЕШАЕТСЯ НА УМИРАЮЩЕГО. Двадцать секунд повышенного урона на
    // мобе, которому осталось две, не окупаются — а ресурс тратят, и делали
    // бы это систематически. Порог из данных умения; РУКАМИ игрок волен
    // ставить клеймо когда угодно, это правило только для автокаста.
    if (ability.brand && !brandWorthIt(state, ability)) return false
    // ОСТАЛЬНЫЕ ПОРОГИ — общей функцией: плата здоровьем не жмётся на низком
    // здоровье, детонатор — на умирающем мобе, генератор и окно — на полной
    // полоске. Все три лежат в данных умения.
    if (!autocastAllows(state, ability)) return false
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
    const ability = abilityOf(state, id)
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
  const resolve = countdown(state.resolve, dtMs)
  const ramp = countdown(state.ramp, dtMs)
  const edge = countdown(state.edge, dtMs)
  // ОКНО тикает здесь же и тем же игровым временем, что откаты: своего
  // таймера у него нет и заводить второй незачем.
  const freeCastsMsLeft = Math.max(0, state.freeCastsMsLeft - dtMs)
  if (
    !changed &&
    gcdMsLeft === state.gcdMsLeft &&
    absorb === state.absorb &&
    monsterBrand === state.monsterBrand &&
    stance === state.stance &&
    resolve === state.resolve &&
    ramp === state.ramp &&
    edge === state.edge &&
    freeCastsMsLeft === state.freeCastsMsLeft
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
    resolve,
    ramp,
    edge,
    freeCastsMsLeft,
  }
}

/** Обратный отсчёт метки с длительностью; вышло время — метки нет. */
function countdown<T extends { msLeft: number }>(mark: T | null, dtMs: number): T | null {
  if (mark === null) return null
  return mark.msLeft <= dtMs ? null : { ...mark, msLeft: mark.msLeft - dtMs }
}
