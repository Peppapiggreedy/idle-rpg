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
import { useAbility, autocastCandidates, autocastAllows, abilityStatus } from './abilities'
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
        'execute', 'detonate', 'effect', 'ramp', 'edge', 'requires', 'spendAll']
        .filter((f) => (a as unknown as Record<string, unknown>)[f] !== undefined)
        .join(',')
      return `${flags}|${a.type}`
    })
    // Одинаковых «пустых» умений допускается не больше одного: заполнитель.
    const plain = shapes.filter((s) => s.startsWith('|'))
    // Ни одного «пустого» умения не осталось вовсе: у каждого свой флаг.
    expect(plain.length).toBeLessThanOrEqual(1)
    // И сами наборы флагов не повторяются: два умения с одинаковой ролью —
    // это одно умение, выданное дважды.
    expect(new Set(shapes).size).toBe(shapes.length)
  })
})

describe('два генератора, и профили у них разные', () => {
  const gens = ABILITIES.filter((a) => a.generate && RAGE.abilityIds.includes(a.id))

  it('их ДВА: ярость начинается с нуля, и одной кнопки на разгон мало', () => {
    expect(gens.length).toBe(2)
  })

  it('после применения ярости БОЛЬШЕ, чем было', () => {
    for (const gen of gens) {
      const s = hero({ currentMana: new Decimal(0) })
      const after = useAbility(s, gen.id, createRng(1), noop)
      expect(after.currentMana.toNumber(), gen.id).toBeCloseTo(
        s.stats.maxMana.times(gen.generate!.resourceShare).toNumber(),
        6,
      )
    }
  })

  it('сами ничего не стоят — иначе платили бы за собственную прибавку', () => {
    for (const gen of gens) expect(gen.manaCost.toNumber(), gen.id).toBe(0)
  })

  it('ПРОФИЛИ РАЗНЫЕ: один струйкой и часто, другой куском и редко', () => {
    const [fast, slow] = [...gens].sort((a, b) => a.cooldownSec - b.cooldownSec)
    expect(fast.cooldownSec).toBeLessThan(slow.cooldownSec)
    expect(fast.generate!.resourceShare).toBeLessThan(slow.generate!.resourceShare)
    // Быстрый ещё и БЬЁТ заметно: это заполнитель ротации, а не только ресурс.
    expect(fast.weaponDamagePercent.gt(slow.weaponDamagePercent)).toBe(true)
  })
})

describe('вампиризм ЧИТАЕТ ПОЛОСКУ', () => {
  const leech = ABILITIES.find((a) => a.leech && RAGE.abilityIds.includes(a.id))!

  /** Сколько вернулось здоровья при заданной полноте полоски. */
  function healed(fill: number): number {
    const full = ready()
    const s = { ...full, currentHp: new Decimal(100), currentMana: full.stats.maxMana.times(fill) }
    const after = useAbility(s, leech.id, createRng(5), noop)
    return after.currentHp.minus(100).toNumber()
  }

  it('здоровье растёт ровно на долю удара, и доля берётся из полоски', () => {
    const full = ready()
    const s = { ...full, currentHp: new Decimal(100) }
    const after = useAbility(s, leech.id, createRng(5), noop)
    const dealt = s.monster.currentHp.minus(after.monster.currentHp)
    const share = leech.leech!.healShare + (leech.leech!.healShareFromResource ?? 0)
    expect(after.currentHp.minus(100).toNumber()).toBeCloseTo(dealt.times(share).toNumber(), 6)
  })

  it('НА ПОЛНОЙ ПОЛОСКЕ ЛЕЧИТ БОЛЬШЕ, ЧЕМ НА ПУСТОЙ', () => {
    // Главное свойство: бой, который идёт хорошо, лечит лучше. Без него это
    // было бы обычное лечение, только привязанное к удару.
    expect(healed(1)).toBeGreaterThan(healed(0.05) * 1.5)
  })

  it('на полном здоровье не переливает', () => {
    const s = ready()
    const after = useAbility(s, leech.id, createRng(5), noop)
    expect(after.currentHp.lte(after.stats.maxHp)).toBe(true)
  })
})

describe('Череполом тратит ВСЮ полоску и растёт от неё', () => {
  const split = ABILITIES.find((a) => a.spendAll && RAGE.abilityIds.includes(a.id))!

  /** Урон удара при заданной полноте полоски. */
  function hit(fill: number): { damage: Decimal; left: Decimal } {
    const full = ready({ currentHp: new Decimal(1e6) })
    let s = { ...full, currentMana: full.stats.maxMana.times(fill) }
    const before = s.monster.currentHp
    s = useAbility(s, split.id, createRng(7), noop)
    for (let i = 0; i < 100 && s.queuedAbilityId !== null; i += 1) s = tick(s, 100, createRng(7))
    return { damage: before.minus(s.monster.currentHp), left: s.currentMana }
  }

  it('на полной полоске бьёт заметно сильнее, чем на пустой', () => {
    expect(hit(1).damage.gt(hit(0.02).damage.times(2))).toBe(true)
  })

  it('полоска после удара ПУСТА: платит всем, что накоплено', () => {
    // «Пуста» — с точностью до того, что сам этот замах ярость и приносит:
    // ресурс копится боем, и удар, которым Череполом бьёт, тоже считается.
    const { left } = hit(1)
    const full = ready().stats.maxMana
    expect(left.div(full).toNumber()).toBeLessThan(0.1)
  })

  it('своей цены у него нет — она и была бы второй ценой', () => {
    expect(split.manaCost.toNumber()).toBe(0)
  })

  it('автокаст ждёт накопления, а не бьёт пустой полоской', () => {
    const full = ready()
    expect(autocastAllows(full, split)).toBe(true)
    expect(autocastAllows({ ...full, currentMana: new Decimal(0) }, split)).toBe(false)
  })
})

describe('грань читает полоску НЕПРЕРЫВНО', () => {
  const edge = ABILITIES.find((a) => a.edge && RAGE.abilityIds.includes(a.id))!

  /** Урон автоатаки под гранью при заданной полноте полоски. */
  function autoHit(fill: number): Decimal {
    const full = ready({ currentHp: new Decimal(1e6) })
    let s = useAbility(full, edge.id, createRng(11), noop)
    s = { ...s, currentMana: s.stats.maxMana.times(fill), swingProgress: 0.999 }
    const before = s.monster.currentHp
    s = tick(s, 60, createRng(11))
    return before.minus(s.monster.currentHp)
  }

  it('прибавка ЖИВЁТ В ПОЛОСКЕ, а не в моменте применения', () => {
    // Обе величины сняты ПОСЛЕ применения одной и той же грани: разница
    // только в том, сколько ярости у героя в момент удара.
    expect(autoHit(1).gt(autoHit(edge.edge!.resourceAbove))).toBe(true)
  })

  it('ниже порога прибавки нет вовсе', () => {
    const low = autoHit(edge.edge!.resourceAbove * 0.5)
    const at = autoHit(edge.edge!.resourceAbove)
    expect(low.toNumber()).toBeCloseTo(at.toNumber(), 6)
  })

  it('урона сама не наносит: вся её работа — включить состояние', () => {
    expect(edge.weaponDamagePercent.toNumber()).toBe(0)
  })
})

describe('ворота по полоске — правило умения, а не совет автокасту', () => {
  const gated = ABILITIES.filter((a) => a.requires && RAGE.abilityIds.includes(a.id))

  it('они есть, и обе стороны заняты: и «мало», и «много»', () => {
    expect(gated.length).toBeGreaterThanOrEqual(3)
    expect(gated.some((a) => a.requires!.resourceAbove !== undefined)).toBe(true)
    expect(gated.some((a) => a.requires!.resourceBelow !== undefined)).toBe(true)
  })

  it('ниже порога умение ОТКАЗЫВАЕТ кодом, а не молча не жмётся', () => {
    const need = gated.find((a) => a.requires!.resourceAbove !== undefined)!
    const s = ready({ currentHp: new Decimal(1e6) })
    expect(abilityStatus({ ...s, currentMana: new Decimal(0) }, need).reason).toBe('resource-low')
    expect(abilityStatus(s, need).usable).toBe(true)
  })

  it('выше порога — второй код, и он ДРУГОЙ: «мало» и «много» лечатся по-разному', () => {
    const cap = gated.find((a) => a.requires!.resourceBelow !== undefined)!
    const s = ready({ currentHp: new Decimal(1e6) })
    expect(abilityStatus(s, cap).reason).toBe('resource-high')
    expect(abilityStatus({ ...s, currentMana: new Decimal(0) }, cap).usable).toBe(true)
  })

  it('запертое воротами умение автокаст не берёт', () => {
    const need = gated.find((a) => a.requires!.resourceAbove !== undefined)!
    const empty = ready({ currentHp: new Decimal(1e6) })
    const dry = { ...empty, currentMana: new Decimal(0) }
    expect(autocastCandidates(dry).some((a) => a.id === need.id)).toBe(false)
  })
})

describe('разгон нарастает СВОИМИ ударами', () => {
  const ramp = ABILITIES.find((a) => a.ramp && RAGE.abilityIds.includes(a.id))!

  it('первый удар проходит без прибавки, следующие сильнее', () => {
    let s = ready({ currentHp: new Decimal(1e6) })
    s = useAbility(s, ramp.id, createRng(13), noop)
    expect(s.ramp?.share).toBe(0)
    // Один замах — и прибавка появилась.
    s = tick({ ...s, swingProgress: 0.999 }, 60, createRng(13))
    expect(s.ramp!.share).toBeCloseTo(ramp.ramp!.perSwing, 6)
  })

  it('упирается в потолок из данных', () => {
    let s = ready({ currentHp: new Decimal(1e6) })
    s = useAbility(s, ramp.id, createRng(13), noop)
    for (let i = 0; i < 40; i += 1) s = tick({ ...s, swingProgress: 0.999 }, 60, createRng(13))
    expect(s.ramp === null || s.ramp.share <= ramp.ramp!.maxShare + 1e-9).toBe(true)
  })

  it('на цели не остаётся НИЧЕГО: это состояние героя, а не метка на мобе', () => {
    let s = ready({ currentHp: new Decimal(1e6) })
    s = useAbility(s, ramp.id, createRng(13), noop)
    expect(s.activeEffects).toEqual([])
    expect(s.monsterWeaken).toBeNull()
    expect(s.monsterBrand).toBeNull()
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
      expect(a.requires, id).toBeUndefined()
      expect(a.ramp, id).toBeUndefined()
      expect(a.edge, id).toBeUndefined()
      expect(a.spendAll, id).toBeUndefined()
      expect(a.weaponDamageFromResource, id).toBeUndefined()
      expect(a.leech?.healShareFromResource, id).toBeUndefined()
      expect(a.execute?.belowHpShareFromResource, id).toBeUndefined()
    }
  })
})
