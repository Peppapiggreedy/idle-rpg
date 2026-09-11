// УМЕНИЕ ОТ ТАЛАНТА: очко покупает не число, а КНОПКУ.
//
// Проверяется ПЯТЬ вещей:
//   1. умения нет в книге класса — его открывает не уровень, а очко;
//   2. с талантом оно появляется в книге героя и ложится в ряд;
//   3. БЕЗ таланта в ряд не кладётся и в ротацию не попадает — даже если id
//      уцелел в сейве со времён, когда талант был взят;
//   4. отзыв бесплатен: сброс дерева убирает умение сам, потому что книга
//      ВЫВОДИТСЯ из рангов;
//   5. слот оно занимает как любое другое — в этом и есть его цена.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './tick'
import { ensureStats } from './stats'
import { ABILITY_BY_ID } from '../data/abilities'
import { CLASSES } from '../data/classes'
import { TALENTS, grantedAbilityIds } from '../data/talents'
import { heroAbilities } from './abilities'
import { abilitiesByPriority } from './rotation'
import { heroSettings, rotationOf } from './state'
import { averageGear } from './simulate'
import { monsterFromTemplate } from './state'
import { referenceMonsterTemplate } from '../data/monsters'
import { axesOf } from './equipment'

const GRANTS = TALENTS.filter((t) => t.effect.kind === 'flag' && t.effect.flag === 'grant-ability')
const GRANTED = GRANTS.map((t) => (t.effect as { abilityId: string }).abilityId)

function hero(talents: Record<string, number>, slots: (string | null)[]): GameState {
  return ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(80),
    abilitySlots: [...slots, null, null, null, null].slice(0, 4) as GameState['abilitySlots'],
    equipment: averageGear(80),
    monster: monsterFromTemplate(referenceMonsterTemplate(80)),
    talents,
    statsDirty: true,
  })
}

describe('умение от таланта', () => {
  it('таких умений в игре есть, и ни одного нет в книге класса', () => {
    expect(GRANTS.length).toBeGreaterThan(0)
    for (const id of GRANTED) {
      expect(ABILITY_BY_ID[id], id).toBeTruthy()
      for (const cls of CLASSES) {
        expect(cls.abilityIds, `${cls.id} не должен знать «${id}»`).not.toContain(id)
      }
    }
  })

  it('без таланта его нет ни в книге героя, ни в доступных настройках', () => {
    const plain = hero({}, [])
    expect(grantedAbilityIds(plain.talents)).toEqual([])
    for (const id of GRANTED) {
      expect(heroAbilities(plain).map((a) => a.id), id).not.toContain(id)
      expect(heroSettings(plain)[id], id).toBeUndefined()
    }
    // Настройки при этом ТОТ ЖЕ объект: у героя без таких талантов ничего не
    // пересобирается.
    expect(heroSettings(plain)).toBe(plain.abilitySettings)
  })

  it('с талантом оно появляется в книге и получает настройки по умолчанию', () => {
    for (const talent of GRANTS) {
      const id = (talent.effect as { abilityId: string }).abilityId
      const s = hero({ [talent.id]: 1 }, [])
      expect(heroAbilities(s).map((a) => a.id), talent.id).toContain(id)
      expect(heroSettings(s)[id], talent.id).toEqual({ autocast: true, reserve: 0 })
    }
  })

  it('положенное в ряд БЕЗ таланта не участвует ни в чём', () => {
    // Слот пережил сброс дерева: id в сейве остался, а таланта больше нет.
    // Умение обязано вести себя как пустой слот, а не как рабочая кнопка.
    const id = GRANTED[0]
    const s = hero({}, [id, 'quick-strike'])
    const row = abilitiesByPriority(rotationOf(s), false).map((a) => a.id)
    expect(row).not.toContain(id)
    expect(row).toContain('quick-strike')
  })

  it('с талантом положенное в ряд участвует', () => {
    const talent = GRANTS[0]
    const id = (talent.effect as { abilityId: string }).abilityId
    const s = hero({ [talent.id]: 1 }, [id, 'quick-strike'])
    expect(abilitiesByPriority(rotationOf(s), false).map((a) => a.id)).toContain(id)
  })

  it('СБРОС ОТЗЫВАЕТ УМЕНИЕ, и отдельной строки в сбросе для этого не нужно', () => {
    const talent = GRANTS[0]
    const id = (talent.effect as { abilityId: string }).abilityId
    const taken = hero({ [talent.id]: 1 }, [id])
    const reset = hero({}, [id])
    expect(heroAbilities(taken).map((a) => a.id)).toContain(id)
    expect(heroAbilities(reset).map((a) => a.id)).not.toContain(id)
    expect(abilitiesByPriority(rotationOf(reset), false).map((a) => a.id)).not.toContain(id)
  })

  it('умение занимает слот: ряд с ним теряет то, что стояло раньше', () => {
    // ЦЕНА ВЕНЦА — МЕСТО В ЧЕТВЁРКЕ, и это проверяется наблюдаемо: четвёрка
    // с выданным умением не содержит того, кого оно вытеснило.
    const talent = GRANTS[0]
    const id = (talent.effect as { abilityId: string }).abilityId
    const без = hero({}, ['quick-strike', 'rending-wound', 'mend-wounds', 'shattering-blow'])
    const с = hero({ [talent.id]: 1 }, [id, 'rending-wound', 'mend-wounds', 'shattering-blow'])
    expect(без.abilitySlots).toContain('quick-strike')
    expect(с.abilitySlots).not.toContain('quick-strike')
    expect(с.abilitySlots).toContain(id)
  })

  it('АКТИВНОЕ выданное умение двигает ось урона, а без таланта — нет', () => {
    const active = GRANTS.find(
      (t) => ABILITY_BY_ID[(t.effect as { abilityId: string }).abilityId]?.type !== 'passive',
    )!
    const id = (active.effect as { abilityId: string }).abilityId
    const four: (string | null)[] = [id, 'rending-wound', 'mend-wounds', 'quick-strike']
    const withTalent = axesOf(hero({ [active.id]: 1 }, four)).damage
    const withoutTalent = axesOf(hero({}, four)).damage
    expect(withTalent.gt(withoutTalent)).toBe(true)
  })

  it('ПАССИВНОЕ выданное умение тоже двигает ось — и только в ряду', () => {
    const passive = GRANTS.find(
      (t) => ABILITY_BY_ID[(t.effect as { abilityId: string }).abilityId]?.type === 'passive',
    )!
    const id = (passive.effect as { abilityId: string }).abilityId
    const inRow: (string | null)[] = [id, 'rending-wound', 'mend-wounds', 'quick-strike']
    const outOfRow: (string | null)[] = ['shattering-blow', 'rending-wound', 'mend-wounds', 'quick-strike']
    const placed = axesOf(hero({ [passive.id]: 1 }, inRow)).damage
    const idle = axesOf(hero({ [passive.id]: 1 }, outOfRow)).damage
    const nothing = axesOf(hero({}, inRow)).damage
    // В ряду — работает; вне ряда талант взят, а умения нет на кнопке, и оно
    // не делает ничего: «неположенное в ряд умение не участвует ни в чём».
    expect(placed.gt(nothing)).toBe(true)
    expect(idle.eq(axesOf(hero({}, outOfRow)).damage)).toBe(true)
  })
})
