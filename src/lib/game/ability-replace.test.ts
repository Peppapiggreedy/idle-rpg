// ЗАМЕНА УМЕНИЯ: кнопка на месте, за ней другое умение.
//
// Проверяется ЧЕТЫРЕ вещи, и первые две несут остальные:
//   1. подмена живёт в ОДНОЙ точке (`tuneAbility`), поэтому её видят все
//      разом: ряд действий, книга, автокаст, модель боя и оффлайн;
//   2. идентификатор остаётся ПРЕЖНИМ — откат, галка автокаста и слот ряда
//      это ключи по id, и вложенное очко не должно их ронять;
//   3. без таланта не меняется НИЧЕГО, бит в бит;
//   4. снятие таланта возвращает базовое умение — сброс дерева обязан
//      отменять замену так же, как отменяет проценты.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './tick'
import { ensureStats } from './stats'
import { ABILITY_BY_ID } from '../data/abilities'
import { CLASSES } from '../data/classes'
import { TALENTS } from '../data/talents'
import { abilityOf, heroAbilities } from './abilities'
import { abilitiesByPriority } from './rotation'
import { rotationOf } from './state'
import { axesOf } from './equipment'
import { averageGear } from './simulate'
import { monsterFromTemplate } from './state'
import { referenceMonsterTemplate } from '../data/monsters'

/** Талант замены — тот, ради которого механизм и заведён. */
const SWAP = TALENTS.find((t) => t.effect.kind === 'flag' && t.effect.flag === 'replace-ability')!
const PAIR = SWAP.effect as { from: string; to: string }

function hero(talents: Record<string, number>): GameState {
  return ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(80),
    abilitySlots: [PAIR.from, 'quick-strike', 'rending-wound', 'mend-wounds'],
    equipment: averageGear(80),
    monster: monsterFromTemplate(referenceMonsterTemplate(80)),
    talents,
    statsDirty: true,
  })
}

describe('замена умения живёт в одной точке', () => {
  it('в дереве есть талант замены, и подставляемого умения нет ни в одной книге', () => {
    // ЖИВОЕ ПРИМЕНЕНИЕ — часть правила: механизм без таланта мёртв.
    expect(SWAP).toBeTruthy()
    expect(ABILITY_BY_ID[PAIR.to], PAIR.to).toBeTruthy()
    for (const cls of CLASSES) {
      expect(cls.abilityIds, `${cls.id} не должен знать «${PAIR.to}»`).not.toContain(PAIR.to)
    }
  })

  it('без таланта умение остаётся собой, БИТ В БИТ', () => {
    expect(abilityOf(hero({}), PAIR.from)).toEqual(ABILITY_BY_ID[PAIR.from])
  })

  it('с талантом за прежним идентификатором стоит ДРУГОЕ умение', () => {
    const swapped = abilityOf(hero({ [SWAP.id]: 1 }), PAIR.from)!
    const to = ABILITY_BY_ID[PAIR.to]!
    expect(swapped.name).toBe(to.name)
    expect(swapped.icon).toBe(to.icon)
    expect(swapped.type).toBe(to.type)
    expect(swapped.cooldownSec).toBe(to.cooldownSec)
    // ИДЕНТИФИКАТОР ПРЕЖНИЙ — на нём висят откат, галка и слот ряда.
    expect(swapped.id).toBe(PAIR.from)
  })

  it('замену видят ВСЕ, кто читает эффективное умение', () => {
    const swapped = hero({ [SWAP.id]: 1 })
    const to = ABILITY_BY_ID[PAIR.to]!
    // Книга умений.
    const book = heroAbilities(swapped).find((a) => a.id === PAIR.from)!
    expect(book.name).toBe(to.name)
    // Ротация: по ней считают модель боя, автокаст и оффлайн.
    const row = abilitiesByPriority(rotationOf(swapped), false).find((a) => a.id === PAIR.from)!
    expect(row.name).toBe(to.name)
  })

  it('снятие таланта возвращает базовое умение', () => {
    // Сброс дерева обнуляет ранги — и замена обязана отмениться вместе с
    // процентами, без единой строки в самом сбросе: ряд ВЫВОДИТСЯ из рангов.
    const back = abilityOf(hero({ [SWAP.id]: 0 }), PAIR.from)
    expect(back).toEqual(ABILITY_BY_ID[PAIR.from])
  })

  it('замена ЗАМЕТНА на оси урона, а без неё ось не двигается', () => {
    const base = axesOf(hero({})).damage
    const swapped = axesOf(hero({ [SWAP.id]: 1 })).damage
    expect(swapped.gt(base), `${base.toNumber()} → ${swapped.toNumber()}`).toBe(true)
  })
})
