// УСЛОВНЫЙ ТРИГГЕР И ПЕРЕНОС МЕТКИ — два механизма одной стадии, и общее у
// них одно: ОБА ВИДНЫ МОДЕЛИ. Это и проверяется прежде всего.
//
//   • условие режет аптайм прока на долю боя, в которой оно верно;
//   • перенос отодвигает потолок «метка не живёт дольше схватки».
//
// Механизм, невидимый модели, ломал бы правило «оффлайн ≤ автокаст» молча —
// ровно поэтому от первой редакции обоих талантов пришлось отказаться.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { TALENTS, type ProcCondition } from '../data/talents'
import { fireProcs, isProcOpen, procUptime, takenProcs, type TakenProc } from './talentProcs'
import { carryShares } from './talents'
import { axesOf } from './equipment'
import { averageGear } from './simulate'
import { monsterFromTemplate } from './state'
import { referenceMonsterTemplate } from '../data/monsters'

/** Прок с условием — тот, ради которого условие и заведено. */
const CONDITIONAL = TALENTS.find(
  (t) => t.effect.kind === 'flag' && t.effect.flag === 'proc' && t.effect.when,
)!
/** Талант переноса метки. */
const CARRY = TALENTS.find((t) => t.effect.kind === 'flag' && t.effect.flag === 'carry-over')!

function procOf(talentId: string, rank = 1): TakenProc {
  return takenProcs({ [talentId]: rank })[0]
}

function conditionOf(talentId: string): ProcCondition {
  const effect = TALENTS.find((t) => t.id === talentId)!.effect as { when: ProcCondition }
  return effect.when
}

describe('условный триггер: событие случилось, а окно — только если', () => {
  it('в дереве есть прок с условием, и условие читается общей машинерией', () => {
    expect(CONDITIONAL, 'ни одного условного прока — механизм без применения').toBeTruthy()
    expect(procOf(CONDITIONAL.id).when).toEqual(conditionOf(CONDITIONAL.id))
  })

  it('по целой цели событие окна НЕ открывает, по добиваемой — открывает', () => {
    const proc = procOf(CONDITIONAL.id)
    const share = conditionOf(CONDITIONAL.id).share
    // На самой отметке условие уже НЕ выполнено: строго ниже.
    const healthy = fireProcs([], [proc], proc.trigger, { targetHpShare: share })
    expect(healthy).toHaveLength(0)
    const dying = fireProcs([], [proc], proc.trigger, { targetHpShare: share - 0.01 })
    expect(dying).toHaveLength(1)
    expect(isProcOpen(dying[0])).toBe(true)
  })

  it('условие отсекает ДО зарядов: несработавшее событие их не копит', () => {
    // Иначе прок копил бы заряды всю схватку и срабатывал первым же критом
    // по добиваемой цели — то есть условие не ограничивало бы ничего.
    const proc = procOf(CONDITIONAL.id)
    let procs = fireProcs([], [proc], proc.trigger, { targetHpShare: 1 })
    procs = fireProcs(procs, [proc], proc.trigger, { targetHpShare: 1 })
    expect(procs).toHaveLength(0)
  })

  it('МОДЕЛЬ режет аптайм ровно на долю боя, в которой условие верно', () => {
    const proc = procOf(CONDITIONAL.id)
    const stats = ensureStats(createInitialState(1, 'warden')).stats
    const withWhen = procUptime(proc, { ...stats, critChance: 0.2, swingTime: 2 })
    const без = procUptime({ ...proc, when: undefined }, { ...stats, critChance: 0.2, swingTime: 2 })
    expect(withWhen).toBeCloseTo(без * conditionOf(CONDITIONAL.id).share, 9)
  })
})

describe('перенос метки: клеймо переживает цель', () => {
  it('доля множится на ранг и зажимается единицей', () => {
    const effect = CARRY.effect as { share: number; mark: 'monsterBrand' }
    expect(carryShares({})).toEqual({})
    expect(carryShares({ [CARRY.id]: 1 })[effect.mark]).toBeCloseTo(effect.share, 9)
    expect(carryShares({ [CARRY.id]: CARRY.maxRank })[effect.mark]).toBeCloseTo(
      Math.min(1, effect.share * CARRY.maxRank),
      9,
    )
  })

  it('БЕЗ таланта клеймо умирает вместе с мобом — умолчание не тронуто', () => {
    const after = respawnWithBrand({})
    expect(after.monsterBrand).toBeNull()
  })

  it('С талантом клеймо переходит на нового моба с урезанным временем', () => {
    const after = respawnWithBrand({ [CARRY.id]: CARRY.maxRank })
    expect(after.monsterBrand).not.toBeNull()
    expect(after.monsterBrand!.msLeft).toBeGreaterThan(0)
    expect(after.monsterBrand!.msLeft).toBeLessThanOrEqual(BRAND_MS)
  })

  it('смерть ГЕРОЯ метку снимает даже с талантом: перенос — про смену ЦЕЛИ', () => {
    // Моб-громила: одного удара хватает. Лечение и привал герою не помогут —
    // тест мерит именно ветку смерти, а не выживание.
    const state = withBrand({ [CARRY.id]: CARRY.maxRank })
    let s: GameState = {
      ...state,
      currentHp: new Decimal(1),
      monster: {
        ...state.monster,
        damageMin: state.stats.maxHp.times(10),
        damageMax: state.stats.maxHp.times(10),
        swingTime: 0.1,
        swingProgress: 0.99,
      },
    }
    for (let i = 0; i < 200 && s.heroState !== 'dead'; i += 1) {
      s = tick(s, 100, () => 0.5, () => {})
    }
    expect(s.heroState, 'герой так и не умер — тест мерит не то').toBe('dead')
    expect(s.monsterBrand).toBeNull()
  })

  it('МОДЕЛЬ видит перенос: ось урона героя растёт', () => {
    // МЕРИТСЯ ОСЬ УРОНА, А НЕ УБИЙСТВА В СЕКУНДУ, и это не уклонение от
    // вопроса. Убийства в секунду смешивают пропускную способность с
    // аптаймом, привалами и смертями — и на герое, упирающемся в привал,
    // прибавка к урону в них не видна вовсе. Ось `damage` — это и есть
    // «сколько герой выдаёт», то самое число, которым игра меряет находку.
    const a = axesOf(build({})).damage
    const b = axesOf(build({ [CARRY.id]: CARRY.maxRank })).damage
    expect(b.gt(a), `без переноса ${a.toNumber()}, с переносом ${b.toNumber()}`).toBe(true)
  })

  it('перенос НИЧЕГО не меняет, пока клейма нет в ряду', () => {
    // Умение вне четвёрки не участвует ни в чём — значит и переносить нечего.
    const without = (talents: Record<string, number>) =>
      ensureStats({
        ...createInitialState(1, 'warden'),
        level: new Decimal(70),
        abilitySlots: ['quick-strike', 'rending-wound', 'mend-wounds', 'shattering-blow'],
        equipment: averageGear(70),
        monster: monsterFromTemplate(referenceMonsterTemplate(70)),
        talents,
        statsDirty: true,
      })
    const a = axesOf(without({})).damage
    const b = axesOf(without({ [CARRY.id]: CARRY.maxRank })).damage
    expect(b.eq(a)).toBe(true)
  })
})

const BRAND_MS = 8000

/**
 * Герой С КЛЕЙМОМ В РЯДУ. Без него модель клеймо не считает вовсе — умение
 * вне четвёрки не участвует ни в чём, — и перенос нечему было бы двигать.
 */
function build(talents: Record<string, number>): GameState {
  return ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(70),
    abilitySlots: ['brand', 'quick-strike', 'rending-wound', 'mend-wounds'],
    // ОДЕТ ПО СВОЕМУ УРОВНЮ: голому герою не хватает маны на клеймо, и в
    // ротацию оно не попадает вовсе — переносить было бы нечего.
    equipment: averageGear(70),
    // МОБ СТАВИТСЯ ЯВНО: модель считает против `state.monster`, а заготовка
    // первого уровня оставляет там мишень, которую герой сносит одним ударом
    // — в таком бою прибавка к урону не видна по построению.
    monster: monsterFromTemplate(referenceMonsterTemplate(70)),
    talents,
    statsDirty: true,
  })
}

/** Герой с клеймом на текущем мобе. */
function withBrand(talents: Record<string, number>): GameState {
  const s = build(talents)
  return {
    ...s,
    currentHp: s.stats.maxHp,
    monsterBrand: { source: { kind: 'ability', id: 'brand' }, damageShare: 0.2, msLeft: BRAND_MS },
  }
}

/** Тот же герой после смерти моба и респауна следующего. */
function respawnWithBrand(talents: Record<string, number>): GameState {
  let s = withBrand(talents)
  s = { ...s, monster: { ...s.monster, currentHp: new Decimal(0) } }
  for (let i = 0; i < 200; i += 1) {
    const prev = s
    s = tick(s, 100, () => 0.5, () => {})
    // Респаун состоялся: у нового моба здоровье снова полное.
    if (prev.respawnMsLeft > 0 && s.respawnMsLeft === 0) return s
  }
  throw new Error('респаун не наступил за двадцать секунд')
}
