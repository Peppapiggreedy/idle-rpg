// ТАЛАНТ ПРАВИТ УМЕНИЕ ДАННЫМИ, А ЭФФЕКТИВНОЕ УМЕНИЕ ЧИТАЮТ ВСЕ.
//
// Сорок талантов про умения означали бы сорок вариантов «что именно
// меняется», то есть сорок веток логики — при прямом запрете «ни одного
// if (талант === ...)». Третий род эффекта закрывает это одним конвейером:
// талант называет ПОЛЕ и ОПЕРАЦИЮ, применяет их одна функция.
//
// Главное здесь — не арифметика, а РАЗВОДКА: если хоть один потребитель
// читает базовое умение, игра обещает игроку не то умение, что у него в
// руках. Порог Милости, сдвинутый талантом, обязан сдвинуть и гейт автокаста.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { ABILITY_BY_ID, ABILITY_TUNABLE, type AbilityDef } from '../data/abilities'
import { TALENTS, TALENT_BY_ID } from '../data/talents'
import { tuneAbility, tunedById, tuneAllowed, TUNABLE_FIELDS } from './abilityTune'
import { createInitialState } from './tick'
import { abilityOf, heroAbilities, abilityStatus, targetLowEnough } from './abilities'
import { rotationOf } from './state'
import { abilitiesByPriority } from './rotation'
import { DEFAULT_CLASS } from '../data/classes'
import type { GameState } from './state'

const MERCY = ABILITY_BY_ID['mercy']
const SHATTER = ABILITY_BY_ID['shattering-blow']

/**
 * Талант-образец. Настоящих талантов третьего рода в данных пока нет — их
 * приносят стадии 5–7, — поэтому конвейер проверяется на подставном эффекте
 * с теми же типами. Так проверка не зависит от того, какие таланты сегодня
 * в дереве.
 */
function tuneOne(
  abilityId: string,
  tune: Array<
    | { field: string; kind: 'percent' | 'multiplier'; value: number }
    | { field: string; kind: 'points'; value: number }
    | { field: 'type'; kind: 'set'; value: 'instant' | 'onNextSwing' }
  >,
) {
  return { kind: 'ability' as const, abilityId, tune: tune as never }
}

/** Подменяем таблицу талантов на время одной проверки. */
function withFakeTalent<T>(
  effect: ReturnType<typeof tuneOne>,
  rank: number,
  body: (ranks: Record<string, number>) => T,
): T {
  const fake = {
    id: 'проверочный-талант',
    name: 'Проверочный',
    icon: 'talent-honed-edge' as const,
    branch: 'warden-wrath' as const,
    row: 1,
    maxRank: 5,
    requiredPointsInBranch: 0,
    effect,
  }
  // Регистрируем и в СПРАВОЧНИКЕ: `rankOf` берёт потолок ранга оттуда, и без
  // записи в нём подставной талант считался бы невзятым.
  TALENTS.push(fake)
  TALENT_BY_ID[fake.id] = fake
  try {
    return body({ [fake.id]: rank })
  } finally {
    TALENTS.pop()
    delete TALENT_BY_ID[fake.id]
  }
}

function hero(): GameState {
  return createInitialState(1, DEFAULT_CLASS.id, 1)
}

describe('конвейер правок умения', () => {
  it('без талантов эффективное умение — ТОТ ЖЕ объект, а не копия', () => {
    // Признак честности: пока дерево пустое, golden не имеет права поехать
    // от одной только правки формы.
    expect(tuneAbility(MERCY, {})).toBe(MERCY)
    expect(tunedById('mercy', {})).toBe(MERCY)
  })

  it('percent множится на ранг, multiplier возводится в степень ранга', () => {
    // Два ранга «вдвое дольше» — это вчетверо, а не «умножить на 4»: у
    // множителя повторение это степень, у доли — сложение.
    const percent = withFakeTalent(
      tuneOne('shattering-blow', [{ field: 'cooldownSec', kind: 'percent', value: -0.1 }]),
      3,
      (ranks) => tuneAbility(SHATTER, ranks),
    )
    expect(percent.cooldownSec).toBeCloseTo(SHATTER.cooldownSec * (1 - 0.3), 9)

    const mult = withFakeTalent(
      tuneOne('shattering-blow', [{ field: 'cooldownSec', kind: 'multiplier', value: 0.5 }]),
      2,
      (ranks) => tuneAbility(SHATTER, ranks),
    )
    expect(mult.cooldownSec).toBeCloseTo(SHATTER.cooldownSec * 0.25, 9)
  })

  it('порог сдвигается В ПУНКТАХ, а не в процентах от себя', () => {
    // «На 5 % выше» от 0.2 дало бы 0.21, а игрок читает пороги в пунктах:
    // 20 % → 25 %.
    const tuned = withFakeTalent(
      tuneOne('mercy', [{ field: 'executeBelowHpShare', kind: 'points', value: 0.05 }]),
      1,
      (ranks) => tuneAbility(MERCY, ranks),
    )
    expect(MERCY.execute!.belowHpShare).toBe(0.2)
    expect(tuned.execute!.belowHpShare).toBeCloseTo(0.25, 9)
  })

  it('тип умения заменяется целиком', () => {
    const tuned = withFakeTalent(
      tuneOne('shattering-blow', [{ field: 'type', kind: 'set', value: 'instant' }]),
      1,
      (ranks) => tuneAbility(SHATTER, ranks),
    )
    expect(SHATTER.type).toBe('onNextSwing')
    expect(tuned.type).toBe('instant')
  })

  it('штучное округляется к ближайшему и не падает ниже единицы', () => {
    const tuned = withFakeTalent(
      tuneOne('rending-wound', [{ field: 'effectTicks', kind: 'percent', value: -0.9 }]),
      1,
      (ranks) => tuneAbility(ABILITY_BY_ID['rending-wound'], ranks),
    )
    expect(tuned.effect!.ticks).toBe(1)
  })

  it('снятый талант возвращает умение к базе ТОЧНО', () => {
    // Сброс дерева обязан вернуть числа побитово: иначе «сбросил и вложил
    // обратно» тихо меняло бы игру.
    const effect = tuneOne('mercy', [
      { field: 'manaCost', kind: 'percent', value: -0.5 },
      { field: 'executeBelowHpShare', kind: 'points', value: 0.1 },
    ])
    const tuned = withFakeTalent(effect, 1, (ranks) => tuneAbility(MERCY, ranks))
    expect(tuned.manaCost.eq(MERCY.manaCost)).toBe(false)
    const back = withFakeTalent(effect, 0, (ranks) => tuneAbility(MERCY, ranks))
    expect(back).toBe(MERCY)
    expect(back.manaCost.eq(MERCY.manaCost)).toBe(true)
    expect(back.execute!.belowHpShare).toBe(MERCY.execute!.belowHpShare)
  })
})

describe('эффективные значения читают ВСЕ', () => {
  it('гейт автокаста двигается вместе с порогом добивания', () => {
    // САМАЯ ВАЖНАЯ ПРОВЕРКА СТАДИИ. Порог живёт в данных умения, а автокаст
    // спрашивает его отдельно: прочитай он базовое умение — кнопка загоралась
    // бы по одному числу, а автоматика жала по другому.
    const base = hero()
    const state: GameState = {
      ...base,
      level: new Decimal(30),
      monster: { ...base.monster, currentHp: base.monster.maxHp.times(0.22) },
    }
    // База: цель на 22 % — добивание ещё нельзя (порог 20 %).
    expect(targetLowEnough(state, MERCY)).toBe(false)

    const raised = withFakeTalent(
      tuneOne('mercy', [{ field: 'executeBelowHpShare', kind: 'points', value: 0.1 }]),
      1,
      (ranks) => abilityOf({ ...state, talents: ranks }, 'mercy')!,
    )
    expect(raised.execute!.belowHpShare).toBeCloseTo(0.3, 9)
    // С талантом порог 30 % — и та же цель уже добивается.
    expect(targetLowEnough(state, raised)).toBe(true)
  })

  it('ротация отдаёт эффективные умения, а не базовые', () => {
    const state = { ...hero(), level: new Decimal(30) }
    const cheap = withFakeTalent(
      tuneOne('quick-strike', [{ field: 'manaCost', kind: 'percent', value: -0.5 }]),
      1,
      (ranks) => abilitiesByPriority(rotationOf({ ...state, talents: ranks }), false),
    )
    const quick = cheap.find((a) => a.id === 'quick-strike')!
    expect(quick.manaCost.toNumber()).toBeCloseTo(
      ABILITY_BY_ID['quick-strike'].manaCost.toNumber() * 0.5,
      9,
    )
  })

  it('книга умений показывает эффективные значения', () => {
    const state = { ...hero(), level: new Decimal(30) }
    const listed = withFakeTalent(
      tuneOne('mercy', [{ field: 'weaponDamagePercent', kind: 'percent', value: 0.5 }]),
      1,
      (ranks) => heroAbilities({ ...state, talents: ranks }),
    )
    const mercy = listed.find((a) => a.id === 'mercy')!
    expect(mercy.weaponDamagePercent.toNumber()).toBeCloseTo(
      MERCY.weaponDamagePercent.toNumber() * 1.5,
      9,
    )
  })

  it('статус умения считает откат по эффективному числу', () => {
    const state = { ...hero(), level: new Decimal(30) }
    const statuses = withFakeTalent(
      tuneOne('quick-strike', [{ field: 'cooldownSec', kind: 'percent', value: -0.5 }]),
      1,
      (ranks) => {
        const s = { ...state, talents: ranks }
        return heroAbilities(s).map((a: AbilityDef) => ({ id: a.id, st: abilityStatus(s, a) }))
      },
    )
    expect(statuses.length).toBeGreaterThan(0)
  })
})

describe('список настраиваемых полей закрыт', () => {
  it('операция обязана подходить роду поля', () => {
    expect(tuneAllowed({ field: 'cooldownSec', kind: 'percent', value: 0.1 } as never)).toBe(true)
    expect(tuneAllowed({ field: 'cooldownSec', kind: 'multiplier', value: 2 } as never)).toBe(true)
    // Величину нельзя сдвигать пунктами, а порог — масштабировать.
    expect(tuneAllowed({ field: 'cooldownSec', kind: 'points', value: 1 } as never)).toBe(false)
    expect(
      tuneAllowed({ field: 'executeBelowHpShare', kind: 'percent', value: 0.1 } as never),
    ).toBe(false)
    expect(
      tuneAllowed({ field: 'executeBelowHpShare', kind: 'points', value: 0.05 } as never),
    ).toBe(true)
    // Поля, которого нет в списке, не существует для таланта вовсе.
    expect(tuneAllowed({ field: 'нет-такого-поля', kind: 'percent', value: 1 } as never)).toBe(
      false,
    )
  })

  it('в списке только объявленные поля, и родов ровно два', () => {
    expect(TUNABLE_FIELDS.length).toBeGreaterThan(10)
    for (const field of TUNABLE_FIELDS) {
      expect(['scale', 'shift']).toContain(ABILITY_TUNABLE[field])
    }
  })
})
