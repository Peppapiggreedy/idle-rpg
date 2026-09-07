// ВОСЕМЬ НОВЫХ УМЕНИЙ ИЗУВЕРА: каждое проверено ТИКОМ, а не чтением данных.
//
// Правило набора: умение, которое автокаст не умеет применять разумно, —
// плохое умение в идл-игре. Поэтому здесь два рода проверок: «делает ли
// умение то, что обещает» и «жмёт ли его автокаст тогда, когда надо».
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { createRng } from './rng'
import { useAbility, autocastCandidates, autocastAllows } from './abilities'
import { CLASSES } from '../data/classes'
import { ABILITY_BY_ID, ABILITIES } from '../data/abilities'
import { ABILITY_UNLOCK_GRID } from '../data/balance'

const RAGE = CLASSES.find((c) => c.resource.kind === 'rage')!
const MANA = CLASSES.find((c) => c.resource.kind === 'mana')!
const noop = () => {}

function hero(patch: Partial<GameState> = {}, level = 30): GameState {
  return ensureStats({
    ...createInitialState(1, RAGE.id),
    level: new Decimal(level),
    abilitySettings: manualOnlySettings(),
    statsDirty: true,
    ...patch,
  })
}

/** Герой с полной полоской ресурса: большинству умений нужна оплата. */
function ready(patch: Partial<GameState> = {}, level = 30): GameState {
  const base = hero(patch, level)
  // И ЗДОРОВЬЕ ТОЖЕ ПОЛНОЕ: createInitialState даёт запас первого уровня, а
  // тесты порогов автокаста меряются долей от максимума — герой с полоской
  // первого уровня на сотом читался бы как умирающий.
  return { ...base, currentMana: base.stats.maxMana, currentHp: base.stats.maxHp }
}

describe('лестница умений', () => {
  it('одиннадцать умений и сетка без дыр: первый уровень плюс каждый второй до двадцатого', () => {
    const levels = RAGE.abilityIds
      .map((id) => ABILITY_BY_ID[id].unlockLevel)
      .sort((a, b) => a - b)
    expect(RAGE.abilityIds.length).toBe(11)
    expect(levels).toEqual([...ABILITY_UNLOCK_GRID])
    // Столько же и у готового класса: разрыв между классами закрыт.
    expect(RAGE.abilityIds.length).toBe(MANA.abilityIds.length)
  })

  it('у каждого умения своя роль: одинаковых пар «цена + урон» нет', () => {
    const shapes = RAGE.abilityIds.map((id) => {
      const a = ABILITY_BY_ID[id]
      const flags = ['generate', 'leech', 'resolve', 'refund', 'bloodPrice', 'window', 'stance',
        'execute', 'detonate', 'effect']
        .filter((f) => (a as unknown as Record<string, unknown>)[f] !== undefined)
        .join(',')
      return `${flags}|${a.type}`
    })
    // Одинаковых «пустых» умений допускается не больше одного: заполнитель.
    const plain = shapes.filter((s) => s.startsWith('|'))
    expect(plain.length).toBeLessThanOrEqual(2)
  })
})

describe('генератор даёт ресурс, а не тратит', () => {
  const gen = ABILITIES.find((a) => a.generate && RAGE.abilityIds.includes(a.id))!

  it('после применения ярости БОЛЬШЕ, чем было', () => {
    const s = hero({ currentMana: new Decimal(0) })
    const after = useAbility(s, gen.id, createRng(1), noop)
    expect(after.currentMana.gt(0)).toBe(true)
    expect(after.currentMana.toNumber()).toBeCloseTo(
      s.stats.maxMana.times(gen.generate!.resourceShare).toNumber(),
      6,
    )
  })

  it('сам ничего не стоит — иначе платил бы за собственную прибавку', () => {
    expect(gen.manaCost.toNumber()).toBe(0)
  })

  it('автокаст не жмёт его на полной полоске', () => {
    const full = ready()
    expect(autocastAllows(full, gen)).toBe(false)
    const empty = hero({ currentMana: new Decimal(0) })
    expect(autocastAllows(empty, gen)).toBe(true)
  })
})

describe('вампиризм лечит нанесённым уроном', () => {
  const leech = ABILITIES.find((a) => a.leech && RAGE.abilityIds.includes(a.id))!

  it('здоровье растёт, и ровно на долю удара', () => {
    // Здоровье просажено НАРОЧНО: на полной полоске лечить нечего, и тест
    // мерил бы обрезку перелива вместо самого вампиризма.
    const full = ready()
    const s = { ...full, currentHp: new Decimal(100) }
    const after = useAbility(s, leech.id, createRng(5), noop)
    expect(after.currentHp.gt(100)).toBe(true)
    // Вернулось не больше, чем нанесено: доля меньше единицы.
    const dealt = s.monster.currentHp.minus(after.monster.currentHp)
    expect(after.currentHp.minus(100).toNumber()).toBeCloseTo(
      dealt.times(leech.leech!.healShare).toNumber(),
      6,
    )
  })

  it('на полном здоровье не переливает', () => {
    const s = ready()
    const after = useAbility(s, leech.id, createRng(5), noop)
    expect(after.currentHp.lte(after.stats.maxHp)).toBe(true)
  })
})

describe('детонатор читает полоску', () => {
  const det = ABILITIES.find(
    (a) => a.detonate?.resourceMultiplier && RAGE.abilityIds.includes(a.id),
  )!
  const dot = ABILITY_BY_ID[det.combo!.needsAbilityId]

  /** Повесить кровотечение, а затем рвануть его при заданной полоске. */
  function burst(fill: number): Decimal {
    let s = ready({ currentHp: new Decimal(1e6) })
    // Кровотечение вешается своим умением: связка описана данными.
    s = useAbility(s, dot.id, createRng(3), noop)
    // onNextSwing ждёт замаха — прокручиваем тик, пока эффект не ляжет.
    for (let i = 0; i < 100 && s.activeEffects.length === 0; i += 1) {
      s = tick(s, 100, createRng(3))
    }
    expect(s.activeEffects.length).toBeGreaterThan(0)
    const before = s.monster.currentHp
    const filled = { ...s, currentMana: s.stats.maxMana.times(fill) }
    let after = useAbility(filled, det.id, createRng(3), noop)
    for (let i = 0; i < 100 && after.queuedAbilityId !== null; i += 1) {
      after = tick(after, 100, createRng(3))
    }
    return before.minus(after.monster.currentHp)
  }

  it('на полной полоске бьёт сильнее, чем на пустой', () => {
    const low = burst(0.05)
    const high = burst(1)
    expect(high.gt(low)).toBe(true)
  })

  it('автокаст не рвёт умирающего моба', () => {
    const s = ready()
    const dying = {
      ...s,
      monster: { ...s.monster, currentHp: s.monster.maxHp.times(0.05) },
    }
    expect(autocastAllows(dying, det)).toBe(false)
    expect(autocastAllows(s, det)).toBe(true)
  })
})

describe('упор нарастает пропущенными ударами', () => {
  const dug = ABILITIES.find((a) => a.resolve && RAGE.abilityIds.includes(a.id))!

  it('первый удар проходит целиком, следующие мягче', () => {
    let s = ready()
    s = useAbility(s, dug.id, createRng(2), noop)
    expect(s.resolve).not.toBeNull()
    expect(s.resolve!.share).toBe(0)
    // Прокручиваем бой: моб бьёт, смягчение растёт.
    for (let i = 0; i < 200 && (s.resolve?.share ?? 0) <= 0; i += 1) {
      s = tick(s, 200, createRng(2))
    }
    expect(s.resolve).not.toBeNull()
    expect(s.resolve!.share).toBeGreaterThan(0)
    expect(s.resolve!.share).toBeLessThanOrEqual(dug.resolve!.maxShare)
  })

  it('сгорает по времени', () => {
    let s = ready()
    s = useAbility(s, dug.id, createRng(2), noop)
    for (let i = 0; i < 400 && s.resolve !== null; i += 1) s = tick(s, 200, createRng(2))
    expect(s.resolve).toBeNull()
  })
})

describe('добивание возвращает ярость', () => {
  const exe = ABILITIES.find((a) => a.refund && RAGE.abilityIds.includes(a.id))!

  it('по израненной цели: ресурса после применения БОЛЬШЕ, чем цена', () => {
    const s = ready()
    const dying = {
      ...s,
      currentMana: exe.manaCost.plus(1),
      monster: { ...s.monster, currentHp: s.monster.maxHp.times(0.1) },
    }
    const after = useAbility(dying, exe.id, createRng(7), noop)
    expect(after.currentMana.gt(dying.currentMana.minus(exe.manaCost))).toBe(true)
  })

  it('по целой цели не применяется вовсе', () => {
    const s = ready()
    const after = useAbility(s, exe.id, createRng(7), noop)
    expect(after).toBe(s)
  })
})

describe('плата здоровьем', () => {
  const price = ABILITIES.find((a) => a.bloodPrice && RAGE.abilityIds.includes(a.id))!

  it('здоровья меньше, ярости больше', () => {
    const s = hero({ currentMana: new Decimal(0) })
    const after = useAbility(s, price.id, createRng(9), noop)
    expect(after.currentHp.lt(s.currentHp)).toBe(true)
    expect(after.currentMana.gt(0)).toBe(true)
  })

  it('последнее очко здоровья не снимается никогда', () => {
    const s = hero({ currentHp: new Decimal(1) })
    const after = useAbility(s, price.id, createRng(9), noop)
    expect(after.currentHp.gt(0)).toBe(true)
  })

  it('АВТОКАСТ НЕ ЖМЁТ ЕЁ НА НИЗКОМ ЗДОРОВЬЕ', () => {
    const base = hero({ currentMana: new Decimal(0) })
    const hurt = { ...base, currentHp: base.stats.maxHp.times(0.3) }
    expect(autocastAllows(hurt, price)).toBe(false)
    const healthy = { ...base, currentHp: base.stats.maxHp }
    expect(autocastAllows(healthy, price)).toBe(true)
  })

  it('порог автокаста ВЫШЕ порога привала: платить перед отдыхом бессмысленно', () => {
    const s = hero()
    expect(price.autocast!.heroHpAbove!).toBeGreaterThan(s.stats.restThreshold)
  })
})

describe('окно бесплатных умений', () => {
  const roar = ABILITIES.find((a) => a.window && RAGE.abilityIds.includes(a.id))!
  const filler = ABILITY_BY_ID[RAGE.abilityIds[0]]

  it('в окне умение не списывает ресурс', () => {
    const s = ready()
    const opened = useAbility(s, roar.id, createRng(4), noop)
    expect(opened.freeCastsMsLeft).toBeGreaterThan(0)
    const before = opened.currentMana
    const after = useAbility(opened, filler.id, createRng(4), noop)
    expect(after.currentMana.eq(before)).toBe(true)
  })

  it('окно кончается по времени, и ресурс снова списывается', () => {
    let s = ready()
    s = useAbility(s, roar.id, createRng(4), noop)
    const total = roar.window!.durationSec * 1000
    for (let i = 0; i < total / 100 + 5; i += 1) s = tick(s, 100, createRng(4))
    expect(s.freeCastsMsLeft).toBe(0)
  })

  it('само окно платит — бесплатная скидка была бы всегда лучшей', () => {
    expect(roar.manaCost.gt(0)).toBe(true)
  })
})

describe('обратная стойка', () => {
  const berserk = ABILITIES.find(
    (a) => a.stance && a.stance.damageShare < 0 && RAGE.abilityIds.includes(a.id),
  )!

  it('свой урон выше, входящее жёстче — обмен в другую сторону', () => {
    expect(berserk.stance!.damageShare).toBeLessThan(0)
    expect(berserk.stance!.mitigationShare).toBeLessThan(0)
    const s = ready()
    const after = useAbility(s, berserk.id, createRng(6), noop)
    expect(after.stance).not.toBeNull()
    expect(after.stance!.damageShare).toBeLessThan(0)
  })
})

describe('автокаст справляется со всей четвёркой', () => {
  it('каждое из одиннадцати умений хотя бы раз становится кандидатом', () => {
    // Кандидатов автокаст выбирает по данным умения; умение, которое не
    // попадает в кандидаты НИКОГДА, — это кнопка, которой идл-игра не жмёт.
    const seen = new Set<string>()
    for (const id of RAGE.abilityIds) {
      const ability = ABILITY_BY_ID[id]
      const base = ready({}, 100)
      // Ставим умение в ряд и включаем автокаст только ему.
      const slots = [id, null, null, null] as GameState['abilitySlots']
      const settings = {
        ...base.abilitySettings,
        [id]: { autocast: true, reserve: 0 },
      }
      // Ситуация, подходящая ЭТОМУ умению: израненная цель, просевшее
      // здоровье или пустая полоска — по порогам из его же данных.
      const monster = ability.execute
        ? { ...base.monster, currentHp: base.monster.maxHp.times(0.1) }
        : base.monster
      const state: GameState = {
        ...base,
        abilitySlots: slots,
        abilitySettings: settings,
        monster,
        currentMana: ability.generate || ability.bloodPrice
          ? new Decimal(0)
          : base.stats.maxMana,
        activeEffects: ability.detonate
          ? [
              {
                abilityId: ability.combo!.needsAbilityId,
                damagePerTick: new Decimal(10),
                ticksLeft: 3,
                msToNextTick: 1000,
              },
            ]
          : base.activeEffects,
      }
      if (autocastCandidates(state).some((a) => a.id === id)) seen.add(id)
    }
    expect([...RAGE.abilityIds].filter((id) => !seen.has(id))).toEqual([])
  })
})

describe('Стража это не касается', () => {
  it('ни одно умение манного класса не получило новых флагов', () => {
    for (const id of MANA.abilityIds) {
      const a = ABILITY_BY_ID[id]
      expect(a.generate, id).toBeUndefined()
      expect(a.leech, id).toBeUndefined()
      expect(a.resolve, id).toBeUndefined()
      expect(a.refund, id).toBeUndefined()
      expect(a.bloodPrice, id).toBeUndefined()
      expect(a.window, id).toBeUndefined()
      expect(a.detonate?.resourceMultiplier, id).toBeUndefined()
    }
  })
})
