// Спутник героя — пёс. Второй источник автоатаки со своим здоровьем.
//
// Здесь живёт всё, что про пса знает логика: его числа из данных класса,
// вывод его здоровья и удара из статов героя, таймеры возврата и
// восстановления, перенаправление входящего урона — и МОДЕЛЬ пса для оценки
// боя (`estimateCombatRate`), чтобы прогноз зоны, оффлайн и обе оси видели
// второе тело так же, как тик.
//
// Ветки по классу здесь нет: класс без поля `companion` получает пустой
// список и ни одного лишнего действия — конвейер тика и модель боя для него
// не меняются ни на одно число.
import { Decimal } from './numbers'
import { classById, type CompanionDef } from '../data/classes'
import { TALENTS, rankOf } from '../data/talents'
import { critFactor, expectedMonsterDamage, expectedSwingDamage, rollSwing } from './combat'
import type { Rng } from './rng'
import type { GameState, HoundMarks } from './state'
import type { AbilityDef } from '../data/abilities'
import type { HoundTuneField } from '../data/talents'
import type { StatBlock } from './stats'
import type { Monster } from '../types'

/** Идентификатор пса в шине ударов: цель и источник. */
export const HOUND_ID = 'hound'

/** Состояние одного пса. Живёт в `GameState.hounds` и в сейве. */
export interface HoundState {
  /** Текущее здоровье; у павшего — ноль. */
  hp: Decimal
  /** Доля замаха 0..1, как у героя. */
  swing: number
  /** Сколько миллисекунд лежать до возврата; 0 — на ногах. */
  downMsLeft: number
}

/**
 * СПУТНИК КЛАССА С ПРАВКАМИ ТАЛАНТОВ. Талант правит число спутника флагом
 * `hound-tune` — полем и операцией, как правку умения: величина × ранг, сперва
 * сдвиги, потом доли, — и читают это ВСЕ: тик, модель, сцена, сейв. Без
 * талантов возвращается ТОТ ЖЕ объект из данных, бит в бит.
 */
export function companionOf(
  state: Pick<GameState, 'classId' | 'talents' | 'stats'>,
): CompanionDef | null {
  const base = classById(state.classId).companion ?? null
  if (!base) return null
  const points: Partial<Record<HoundTuneField, number>> = {}
  const percent: Partial<Record<HoundTuneField, number>> = {}
  let touched = false
  for (const talent of TALENTS) {
    const effect = talent.effect
    if (effect.kind !== 'flag' || effect.flag !== 'hound-tune') continue
    const rank = rankOf(state.talents, talent.id)
    if (rank <= 0) continue
    touched = true
    const bucket = effect.op === 'points' ? points : percent
    bucket[effect.field] = (bucket[effect.field] ?? 0) + effect.value * rank
  }
  // ХАРАКТЕРИСТИКИ СПУТНИКА — ВТОРОЕ СЛАГАЕМОЕ, И СКЛАДЫВАЮТСЯ ОНИ ЗДЕСЬ.
  //
  // Флаг `hound-tune` — способ ТАЛАНТА править спутника; характеристики
  // конвейера (`houndAttackPower` и соседи) — способ сделать то же вещью,
  // зачарованием или зельем. Источника два, а место сложения ОДНО: ни тик, ни
  // модель, ни сцена к ним по отдельности не обращаются, все берут готовый
  // `CompanionDef` отсюда. Заменить флаг характеристиками было бы чище, но это
  // значило бы переписать дерево Псаря и сдвинуть его ключи — а ночь обещала
  // их не трогать.
  //
  // Ложатся они в ТУ ЖЕ корзину процентов, что и флаг: «на десять процентов
  // сильнее укус» от таланта и от вещи — одно и то же действие, и складывать
  // их дважды разными способами было бы ровно тем двойным счётом, ради
  // которого эта оговорка и написана.
  const fromStats: Partial<Record<HoundTuneField, number>> = {
    hitShare: state.stats.houndAttackPower,
    maxHpShare: state.stats.houndMaxHp,
    // Возврат — время: «быстрее на треть» это множитель (1 − доля), поэтому
    // доля входит со знаком минус.
    returnSec: -state.stats.houndReviveSpeed,
  }
  for (const [field, value] of Object.entries(fromStats)) {
    if (!value) continue
    touched = true
    const key = field as HoundTuneField
    percent[key] = (percent[key] ?? 0) + value
  }
  // ВОССТАНОВЛЕНИЕ И ДОЛЯ ПЕРЕНАПРАВЛЕНИЯ ЛОЖАТСЯ ПЛОСКО, А НЕ ПРОЦЕНТОМ, И
  // ЭТО НЕ МЕЛОЧЬ. У пса восстановление В БОЮ равно нулю (`regenShare`:
  // inCombat 0, outOfCombat 0.04) — процент от нуля дал бы ноль, и
  // характеристика была бы мёртвой ровно там, где она нужнее всего. Доля
  // перенаправления по той же причине: «ещё пять процентов входящего» не
  // зависит от того, сколько их было.
  const flat: Partial<Record<HoundTuneField, number>> = {
    regenInCombat: state.stats.houndHpRegen,
    regenOutOfCombat: state.stats.houndHpRegen,
    redirectShare: state.stats.redirectShare,
  }
  for (const [field, value] of Object.entries(flat)) {
    if (!value) continue
    touched = true
    const key = field as HoundTuneField
    points[key] = (points[key] ?? 0) + value
  }
  if (!touched) return base
  const tune = (field: HoundTuneField, value: number): number =>
    Math.max(0, (value + (points[field] ?? 0)) * (1 + (percent[field] ?? 0)))
  return {
    ...base,
    hitShare: tune('hitShare', base.hitShare),
    // Замах не уходит в ноль: талант делит секунды долей, а не вычитает их.
    swingTime: Math.max(0.1, tune('swingTime', base.swingTime)),
    redirectShare: Math.min(1, tune('redirectShare', base.redirectShare)),
    maxHpShare: tune('maxHpShare', base.maxHpShare),
    returnSec: Math.max(1, tune('returnSec', base.returnSec)),
    regenShare: {
      inCombat: tune('regenInCombat', base.regenShare.inCombat),
      outOfCombat: tune('regenOutOfCombat', base.regenShare.outOfCombat),
    },
  }
}

/**
 * КОМАНДЫ, ДЕРЖАЩИЕСЯ ВРЕМЯ, МЕНЯЮТ ЧИСЛА СПУТНИКА НА ЛЕТУ: травля укорачивает
 * замах, скрадывание поднимает долю перенаправления, отзыв её обнуляет — пёс
 * отошёл и не принимает ничего. Одна функция на тик и на модель: две копии
 * этой арифметики разъехались бы на первой правке.
 */
export function activeCompanion(def: CompanionDef, marks: HoundMarks): CompanionDef {
  const recalled = marks.recall !== null
  const haste = marks.haste?.share ?? 0
  const bonus = marks.skulk?.share ?? 0
  return {
    ...def,
    swingTime: haste > 0 ? def.swingTime / (1 + haste) : def.swingTime,
    redirectShare: recalled ? 0 : Math.min(1, def.redirectShare + bonus),
  }
}

/** Запас пса — доля запаса героя: растёт с ним, своей лестницы у пса нет. */
export function houndMaxHp(state: Pick<GameState, 'classId' | 'stats' | 'talents'>): Decimal {
  const def = companionOf(state)
  return def ? state.stats.maxHp.times(def.maxHpShare) : new Decimal(0)
}

/** Пёс на ногах: не лежит и здоровье выше нуля. */
/**
 * Команда псу, при которой герой сам не бьёт: отзыв, перевязка, спуск,
 * скрадывание, оклик, свора. Читают её тик (каст без удара героя) и модель:
 * в потоке ударов (`hitStream`) такой каст не квантует бой — его укусы идут
 * псом. ТОЛЬКО команды псу: нулевые касты Стража (заслон, стойка) считались
 * ударами потока до появления пса, и общее правило «нулевой каст — не удар»
 * сдвинуло бы 14 ключей Стража в отпечатке на доли процента (найдено на
 * матрице ночи «два тела» и записано в docs/HOUND.md как открытый вопрос).
 */
export function isHoundCommand(ability: AbilityDef): boolean {
  return (
    ability.weaponDamagePercent.lte(0) &&
    Boolean(ability.recall || ability.houndHeal || ability.unleash || ability.skulk || ability.rally || ability.pack)
  )
}

export function isHoundUp(hound: HoundState): boolean {
  return hound.downMsLeft <= 0 && hound.hp.gt(0)
}

export function upHounds(state: Pick<GameState, 'hounds'>): HoundState[] {
  return state.hounds.filter(isHoundUp)
}

/** Полный комплект свежих псов класса. У класса без спутника — прежний список. */
export function freshHounds(state: Pick<GameState, 'classId' | 'stats' | 'hounds' | 'talents'>): HoundState[] {
  const def = companionOf(state)
  if (!def) return state.hounds
  const hp = houndMaxHp(state)
  return Array.from({ length: def.count }, () => ({ hp, swing: 0, downMsLeft: 0 }))
}

/**
 * Псы после привала: те, кто на ногах, вылечены на долю привала, лежащие
 * продолжают лежать — привал героя не поднимает павшего пса.
 */
export function restedHounds(state: GameState, share: number): HoundState[] {
  if (state.hounds.length === 0) return state.hounds
  const max = houndMaxHp(state)
  return state.hounds.map((h) =>
    h.downMsLeft > 0 ? h : { ...h, hp: Decimal.min(h.hp.plus(max.minus(h.hp).times(share)), max) },
  )
}

/**
 * Таймеры псов за тик: лежащий досиживает возврат и встаёт с полным запасом;
 * стоящий восстанавливается по ставке из данных — в бою одной, вне боя другой.
 * Возвращает список и флаг «кто-то вернулся»: тик пишет об этом в журнал.
 */
export function advanceHounds(
  state: GameState,
  dtMs: number,
  inCombat: boolean,
): { hounds: HoundState[]; returned: number } {
  const def = companionOf(state)
  if (!def || state.hounds.length === 0) return { hounds: state.hounds, returned: 0 }
  const max = houndMaxHp(state)
  // ОТЗЫВ ЛЕЧИТ ПОВЕРХ обычного восстановления: пёс отошёл и зализывает раны.
  const recallShare = state.houndMarks.recall?.share ?? 0
  const share = (inCombat ? def.regenShare.inCombat : def.regenShare.outOfCombat) + recallShare
  let returned = 0
  const hounds = state.hounds.map((h) => {
    if (h.downMsLeft > 0) {
      const left = h.downMsLeft - dtMs
      if (left > 0) return { ...h, downMsLeft: left }
      returned += 1
      return { hp: max, swing: 0, downMsLeft: 0 }
    }
    // Запас мог упасть со снятой вещью: пёс не носит больше, чем герой держит.
    const healed = share > 0 ? h.hp.plus(max.times(share).times(dtMs / 1000)) : h.hp
    const hp = Decimal.min(healed, max)
    return hp.eq(h.hp) ? h : { ...h, hp }
  })
  return { hounds, returned }
}

/**
 * Укус: та же формула удара, что у героя, в доле `hitShare`.
 *
 * КРИТ У ПСА СВОЙ ПОВЕРХ ГЕРОЙСКОГО. Базовый шанс он берёт у героя — своей
 * ловкости у пса нет, — а `houndCritChance` прибавляется сверху. Подмена идёт
 * ОДНИМ полем статблока, а не второй формулой удара: формула удара в игре
 * одна, и заводить вторую ради пса значило бы держать две.
 */
export function rollHoundBite(stats: StatBlock, def: CompanionDef, rng: Rng) {
  const own =
    stats.houndCritChance > 0
      ? { ...stats, critChance: Math.min(1, stats.critChance + stats.houndCritChance) }
      : stats
  return rollSwing(own, rng, new Decimal(def.hitShare))
}

/**
 * ЧТО ПЁС СНИМАЕТ СО СВОЕЙ ЧАСТИ УДАРА. Доля 0..1: броня режет её, уворот
 * отменяет целиком. ДЕЛЁЖ УДАРА ЭТО НЕ ТРОГАЕТ — герою достаётся ровно та же
 * часть, что и раньше; меняется только то, сколько из своей части пёс
 * действительно принимает. Правило «перенаправление, а не смягчение» про
 * ЧАСТЬ ГЕРОЯ, и она здесь не участвует.
 */
export function houndTakenShare(stats: StatBlock, rng: Rng): number {
  // Бросок уворота делается ТОЛЬКО когда уворот есть: лишний вызов rng
  // сдвинул бы поток у всех, у кого этой характеристики нет.
  if (stats.houndDodge > 0 && rng() < stats.houndDodge) return 0
  return 1 - Math.min(1, Math.max(0, stats.houndArmor))
}

/**
 * ПЕРЕНАПРАВЛЕНИЕ: доля уже смягчённого удара уходит первому стоящему псу.
 * Урон не исчезает — сумма частей равна удару. Пёс, у которого здоровье
 * кончилось, ложится на `returnSec`.
 */
export function redirectToHounds(
  hounds: HoundState[],
  amount: Decimal,
  def: CompanionDef,
  stats: StatBlock,
  rng: Rng,
): { heroPart: Decimal; houndPart: Decimal; hounds: HoundState[]; index: number; fell: boolean } {
  const index = hounds.findIndex(isHoundUp)
  if (index === -1 || def.redirectShare <= 0) {
    return { heroPart: amount, houndPart: new Decimal(0), hounds, index: -1, fell: false }
  }
  const houndPart = amount.times(def.redirectShare)
  const heroPart = amount.minus(houndPart)
  const hound = hounds[index]
  // Пёс принимает не всё, что на него перенаправлено: своя броня режет долю,
  // свой уворот отменяет удар целиком. Часть героя при этом не меняется.
  const taken = houndPart.times(houndTakenShare(stats, rng))
  const hpLeft = hound.hp.minus(taken)
  const fell = hpLeft.lte(0)
  const next = fell
    ? { hp: new Decimal(0), swing: 0, downMsLeft: def.returnSec * 1000 }
    : { ...hound, hp: hpLeft }
  const list = hounds.slice()
  list[index] = next
  return { heroPart, houndPart, hounds: list, index, fell }
}

// ---------------------------------------------------------------------------
// МОДЕЛЬ ПСА ДЛЯ ОЦЕНКИ БОЯ
// ---------------------------------------------------------------------------

export interface HoundModel {
  /** Укусов в секунду от всех стоящих псов, уже с долей «на ногах». */
  rate: Decimal
  /** Средний укус БЕЗ крита — крит навешивает поток ударов, как у героя. */
  hit: Decimal
  /** Укусы в секунду с критом: то, что пёс добавляет к урону. */
  dps: Decimal
  /** Доля входящего по герою, которую забирает пёс, с учётом «на ногах». */
  redirect: number
  /** Псов на ногах в среднем: стоящие сейчас (плюс зов своры) × доля «на ногах». */
  standing: number
  /** Сколько раз в секунду пёс падает (на всех псов): от этого живёт «Мститель». */
  fallsPerSec: number
}

/**
 * ЧТО КОМАНДЫ ПСУ ДЕЛАЮТ С МОДЕЛЬЮ. Все доли уже УМНОЖЕНЫ НА АПТАЙМ команды
 * (сколько времени она держится на длинном ряду боёв) — первого порядка, как
 * метки героя в `abilityMods`. Нули — команд нет, и модель та же, что была.
 */
export interface HoundTune {
  /** Травля: доля ускорения укусов. */
  hasteShare: number
  /** Отзыв: доля времени, когда пёс не кусает и не принимает урона. */
  silentShare: number
  /** Отзыв и перевязка: лечение пса, доля его запаса в секунду. */
  healPerSecShare: number
  /** Скрадывание: прибавка к доле перенаправления. */
  redirectBonus: number
  /** Хватка: доля замедления замаха моба. */
  slowShare: number
  /** Оклик: ожидаемое время лежания с окликом, секунд; бесконечность — оклика нет. */
  rallyWaitSec: number
  /** Свора: сколько псов зовёт умение в ряду сверх стоящих сейчас. */
  extraHounds: number
}

export const NO_HOUND_TUNE: HoundTune = {
  hasteShare: 0,
  silentShare: 0,
  healPerSecShare: 0,
  redirectBonus: 0,
  slowShare: 0,
  rallyWaitSec: Number.POSITIVE_INFINITY,
  extraHounds: 0,
}

/**
 * Первый порядок, как и все метки в модели: пёс бьёт по своему таймеру, пока
 * стоит; падает он от доли входящего, и доля времени «на ногах» — это
 * отношение времени до падения к циклу «пал → вернулся». Псы, лежащие
 * ПРЯМО СЕЙЧАС, не считаются вовсе: обе оси героя обязаны просесть, пока пса
 * нет, — иначе игрок читал бы силу, которой у него в эту минуту нет.
 *
 * Класс без спутника получает null, и ни одна формула модели для него не
 * меняется — пёс входит в неё только там, где он есть.
 */
export function houndModel(
  state: Pick<GameState, 'classId' | 'stats' | 'hounds' | 'level' | 'talents'>,
  monster: Monster,
  tune: HoundTune = NO_HOUND_TUNE,
): HoundModel | null {
  const def = companionOf(state)
  if (!def) return null
  const empty = {
    rate: new Decimal(0),
    hit: new Decimal(0),
    dps: new Decimal(0),
    redirect: 0,
    standing: 0,
    fallsPerSec: 0,
  }
  // Свора зовёт псов, которых сейчас на поле нет: модель считает их стоящими,
  // иначе умение, вся работа которого — второй пёс, мерилось бы нулём.
  const up = upHounds(state).length + Math.max(0, tune.extraHounds)
  if (up === 0) return empty
  const stats = state.stats
  const max = houndMaxHp(state)
  // Входящее по герою в секунду — после его смягчения и блока, как в тике.
  // Хватка удлиняет замах моба на долю своего аптайма.
  const slowed = monster.swingTime * (1 + Math.max(0, tune.slowShare))
  const incomingPerSec =
    slowed > 0 && monster.damageMax.gt(0)
      ? expectedMonsterDamage(monster, stats, state.level.toNumber()).div(slowed)
      : new Decimal(0)
  // Отзыв снимает с пса урон на свою долю времени; скрадывание добавляет.
  const redirectShare =
    Math.min(1, def.redirectShare + Math.max(0, tune.redirectBonus)) *
    (1 - Math.min(1, Math.max(0, tune.silentShare)))
  // Пёс принимает не всё перенаправленное: броня режет долю, уворот отменяет
  // удар целиком. В матожидании это один множитель — та же величина, что
  // бросает `houndTakenShare` в тике, только без броска.
  const takenShare =
    (1 - Math.min(1, Math.max(0, stats.houndDodge))) *
    (1 - Math.min(1, Math.max(0, stats.houndArmor)))
  const lossPerSec = incomingPerSec
    .times(redirectShare)
    .times(takenShare)
    .minus(max.times(def.regenShare.inCombat + Math.max(0, tune.healPerSecShare)))
  // Стоит, пока запас держит перенаправленное; лежит `returnSec` — или
  // меньше, если в ряду оклик.
  const downSec = Math.min(def.returnSec, tune.rallyWaitSec)
  const untilFall = lossPerSec.lte(0) || max.lte(0) ? Number.POSITIVE_INFINITY : max.div(lossPerSec).toNumber()
  const aliveShare = Number.isFinite(untilFall) ? untilFall / (untilFall + downSec) : 1
  const fallsPerSec = Number.isFinite(untilFall) ? up / (untilFall + downSec) : 0
  const hit = expectedSwingDamage(stats).times(def.hitShare)
  const swingTime = def.swingTime / (1 + Math.max(0, tune.hasteShare))
  const standing = up * aliveShare
  const rate = new Decimal(standing)
    .div(swingTime)
    .times(1 - Math.min(1, Math.max(0, tune.silentShare)))
  // Крит укуса — геройский ПЛЮС свой: та же прибавка, что бросает
  // `rollHoundBite`, только взятая матожиданием.
  const biteCrit = critFactor(
    stats.houndCritChance > 0
      ? { ...stats, critChance: Math.min(1, stats.critChance + stats.houndCritChance) }
      : stats,
  )
  return {
    rate,
    hit,
    dps: hit.times(rate).times(biteCrit),
    redirect: redirectShare * aliveShare,
    standing,
    fallsPerSec,
  }
}

/** Доля входящего, которую пёс снимает с героя против этого моба; 0 — пса нет. */
export function houndRedirect(
  state: Pick<GameState, 'classId' | 'stats' | 'hounds' | 'level' | 'talents'>,
  monster: Monster,
): number {
  return houndModel(state, monster)?.redirect ?? 0
}
