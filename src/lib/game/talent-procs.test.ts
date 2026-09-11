// ПРОК КАК ВИД ЭФФЕКТА: событие боя открывает окно, окно даёт прибавку.
//
// Проверяется ЧЕТЫРЕ вещи, и четвёртая — та, ради которой прок вообще сделан
// прибавкой к характеристике, а не отдельной механикой:
//   1. окно открывается событием и закрывается само — по времени и по замахам;
//   2. заряды (`everyNth`) режут частоту ровно во столько раз, сколько их;
//   3. окно НЕ пишется в сейв — как стойка, щит и метки на мобе;
//   4. МОДЕЛЬ видит прок средней долей времени, то есть оффлайн и обе оси
//      героя считаются с ним, а не без него. Прок, видимый только тику, ломал
//      бы правило «оффлайн ≤ автокаст» молча.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { TALENTS, type ProcBonus, type ProcTrigger } from '../data/talents'
import {
  advanceProcs,
  fireProcs,
  isProcOpen,
  procModifiers,
  procUptime,
  spendProcSwing,
  statsForModel,
  takenProcs,
  type TakenProc,
} from './talentProcs'
import { payloadFromState, stateFromPayload } from './save'

/** Таланты-проки, какие есть в дереве: обход явный, ветки по id нет. */
const PROC_TALENTS = TALENTS.filter((t) => t.effect.kind === 'flag' && t.effect.flag === 'proc')

function procOf(talentId: string): TakenProc {
  const taken = takenProcs({ [talentId]: 1 })
  expect(taken, talentId).toHaveLength(1)
  return taken[0]
}

function bonusOf(talentId: string): ProcBonus {
  const talent = TALENTS.find((t) => t.id === talentId)!
  return (talent.effect as { effect: ProcBonus }).effect
}

describe('прок — данные, а не механика таланта', () => {
  it('в дереве есть проки, и каждый читается общей машинерией', () => {
    // ЖИВОЕ ПРИМЕНЕНИЕ — ЧАСТЬ ПРАВИЛА. Механизм без единого таланта это
    // мёртвый код, и проверять его тогда пришлось бы на выдуманных данных.
    expect(PROC_TALENTS.length).toBeGreaterThan(0)
    for (const talent of PROC_TALENTS) {
      const proc = procOf(talent.id)
      expect(proc.trigger, talent.id).toBeTruthy()
      expect(proc.effect.value, talent.id).toBeGreaterThan(0)
    }
  })

  it('ранг множит величину — единственный флаг, который ранг читает', () => {
    const talent = PROC_TALENTS[0]
    const one = takenProcs({ [talent.id]: 1 })[0]
    const three = takenProcs({ [talent.id]: 3 })[0]
    expect(three.rank).toBe(3)
    // Сама величина в данных одна; рангом её множит потребитель, поэтому
    // сверяется она через модификаторы, а не через поле.
    const state = { talents: { [talent.id]: 3 }, talentProcs: [openWindow(three)] }
    const [mod] = procModifiers(state)
    expect(mod.value.toNumber()).toBeCloseTo(one.effect.value * 3, 9)
  })
})

/** Окно, открытое насильно: для проверок, где событие не нужно. */
function openWindow(proc: TakenProc) {
  return {
    talentId: proc.talentId,
    charges: 0,
    msLeft: proc.effect.kind === 'stat' ? proc.effect.durationSec * 1000 : 0,
    swingsLeft: proc.effect.kind === 'stat-swings' ? proc.effect.swings : 0,
  }
}

describe('окно открывается событием и закрывается само', () => {
  it('окно по СЕКУНДАМ дотикивает до нуля и гаснет', () => {
    const proc = PROC_TALENTS.map((t) => procOf(t.id)).find((p) => p.effect.kind === 'stat')
    expect(proc, 'в дереве нет прока с окном по секундам').toBeTruthy()
    const p = proc!
    const bonus = p.effect as Extract<ProcBonus, { kind: 'stat' }>
    // Заряды: до последнего события окно не открывается вовсе.
    let procs = [] as ReturnType<typeof fireProcs>
    for (let i = 1; i < p.everyNth; i += 1) {
      procs = fireProcs(procs, [p], p.trigger)
      expect(isProcOpen(procs[0]), `заряд ${i}`).toBe(false)
    }
    procs = fireProcs(procs, [p], p.trigger)
    expect(isProcOpen(procs[0])).toBe(true)
    procs = advanceProcs(procs, bonus.durationSec * 1000 - 1)
    expect(isProcOpen(procs[0])).toBe(true)
    procs = advanceProcs(procs, 1)
    expect(isProcOpen(procs[0])).toBe(false)
  })

  it('окно по ЗАМАХАМ тратится замахами, а время его не трогает', () => {
    const proc = PROC_TALENTS.map((t) => procOf(t.id)).find((p) => p.effect.kind === 'stat-swings')
    expect(proc, 'в дереве нет прока с окном по замахам').toBeTruthy()
    const p = proc!
    const bonus = p.effect as Extract<ProcBonus, { kind: 'stat-swings' }>
    let procs = fireProcs([], [p], p.trigger)
    expect(isProcOpen(procs[0])).toBe(true)
    // ЧАС ПРОСТОЯ ОКНО ПО ЗАМАХАМ НЕ ЗАКРЫВАЕТ, и это не мелочь: тем оно и
    // отличается от окна по секундам, что подгоняется под ТЕМП, а не под часы.
    procs = advanceProcs(procs, 3_600_000)
    expect(isProcOpen(procs[0])).toBe(true)
    for (let i = 0; i < bonus.swings; i += 1) procs = spendProcSwing(procs)
    expect(isProcOpen(procs[0])).toBe(false)
  })

  it('событие не своего рода окно не открывает', () => {
    const p = procOf(PROC_TALENTS[0].id)
    const other: ProcTrigger = p.trigger === 'crit' ? 'hit' : 'crit'
    const procs = fireProcs([], [p], other)
    expect(procs).toHaveLength(0)
  })

  it('повторное событие переоткрывает окно с полной длиной', () => {
    const proc = PROC_TALENTS.map((t) => procOf(t.id)).find(
      (p) => p.effect.kind === 'stat' && p.everyNth === 1,
    )
    // Прок с зарядами переоткрывается только на каждом N-м, и правило то же;
    // отдельный случай здесь нужен лишь если такой прок в дереве есть.
    if (!proc) return
    let procs = fireProcs([], [proc], proc.trigger)
    procs = advanceProcs(procs, 500)
    const half = procs[0].msLeft
    procs = fireProcs(procs, [proc], proc.trigger)
    expect(procs[0].msLeft).toBeGreaterThan(half)
  })
})

describe('прибавка идёт ОБЫЧНЫМ модификатором конвейера', () => {
  it('закрытое окно не даёт ничего, открытое — даёт', () => {
    const talent = PROC_TALENTS[0]
    const proc = procOf(talent.id)
    expect(procModifiers({ talents: { [talent.id]: 1 }, talentProcs: [] })).toHaveLength(0)
    const [mod] = procModifiers({
      talents: { [talent.id]: 1 },
      talentProcs: [openWindow(proc)],
    })
    expect(mod.stat).toBe(bonusOf(talent.id).stat)
    expect(mod.kind).toBe('flat')
    // Источник называет талант: раскладка статов обязана уметь показать,
    // откуда взялось число.
    expect(mod.source).toContain(talent.id)
  })

  it('герой без прока получает тот же объект статов, бит в бит', () => {
    const base = ensureStats(createInitialState(1, 'warden')).stats
    expect(
      statsForModel({ talents: {}, talentProcs: [], stats: base }, base, () => []),
    ).toBe(base)
  })
})

describe('модель видит прок средней долей времени', () => {
  it('доля растёт с шансом крита и не выходит за единицу', () => {
    const proc = procOf(PROC_TALENTS[0].id)
    const stats = ensureStats(createInitialState(1, 'warden')).stats
    const low = procUptime(proc, { ...stats, critChance: 0.05, swingTime: 2 })
    const high = procUptime(proc, { ...stats, critChance: 0.4, swingTime: 2 })
    expect(high).toBeGreaterThan(low)
    expect(procUptime(proc, { ...stats, critChance: 1, swingTime: 2 })).toBeLessThanOrEqual(1)
    expect(procUptime(proc, { ...stats, critChance: 0, swingTime: 2 })).toBe(0)
  })

  it('окно по замахам считается как «хотя бы одно событие из N»', () => {
    const proc = PROC_TALENTS.map((t) => procOf(t.id)).find((p) => p.effect.kind === 'stat-swings')!
    const bonus = proc.effect as Extract<ProcBonus, { kind: 'stat-swings' }>
    const stats = ensureStats(createInitialState(1, 'warden')).stats
    const chance = 0.2 / proc.everyNth
    expect(procUptime(proc, { ...stats, critChance: 0.2, swingTime: 2 })).toBeCloseTo(
      1 - Math.pow(1 - chance, bonus.swings),
      9,
    )
  })

  it('модель БЕРЁТ прок: статы для модели отличаются от голых', () => {
    const talent = PROC_TALENTS[0]
    const state = ensureStats({
      ...createInitialState(1, 'warden'),
      talents: { [talent.id]: 1 },
      statsDirty: true,
    })
    const modelled = statsForModel(state, state.stats, () => [])
    const stat = bonusOf(talent.id).stat as keyof typeof state.stats
    expect(Number(modelled[stat])).toBeGreaterThan(Number(state.stats[stat]))
  })
})

describe('окно прока — не прогресс', () => {
  it('в сейв не пишется: после загрузки нет ни того боя, ни той секунды', () => {
    const talent = PROC_TALENTS[0]
    const proc = procOf(talent.id)
    const state: GameState = ensureStats({
      ...createInitialState(1, 'warden'),
      talents: { [talent.id]: 1 },
      talentProcs: [openWindow(proc)],
      statsDirty: true,
    })
    const loaded = stateFromPayload(payloadFromState(state, 0))
    expect(loaded.talentProcs).toEqual([])
    // И ранги при этом на месте: чистится окно, а не выбор игрока.
    expect(loaded.talents[talent.id]).toBe(1)
  })
})

describe('тик поднимает события сам', () => {
  it('герой с проком на крит открывает окно в настоящем бою', () => {
    const talent = PROC_TALENTS.find((t) => (t.effect as { trigger: ProcTrigger }).trigger === 'crit')!
    // Крит гарантирован статом, а не удачей: rng в тесте фиксирован, и ждать
    // от него крита значило бы мерить рулетку, а не прок.
    const s0 = ensureStats({
      ...createInitialState(1, 'warden'),
      talents: { [talent.id]: 1 },
      statsDirty: true,
    })
    let s: GameState = { ...s0, stats: { ...s0.stats, critChance: 1 } }
    let opened = false
    for (let i = 0; i < 400 && !opened; i += 1) {
      s = tick({ ...s, stats: { ...s.stats, critChance: 1 }, statsDirty: false }, 100, () => 0.9, () => {})
      opened = s.talentProcs.some(isProcOpen)
    }
    expect(opened, 'окно прока не открылось за сорок секунд боя').toBe(true)
  })
})
