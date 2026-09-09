// ПСАРЬ УПРАВЛЯЕТ ДВУМЯ ТЕЛАМИ — И ЭТО ПРОВЕРЯЕМОЕ СВОЙСТВО, А НЕ СПИСОК.
//
// Три класса разведены ВОПРОСОМ, который класс задаёт бою:
//   Страж  — «что висит на мобе»      (метки на цели);
//   Изувер — «в каком я состоянии»    (ярость как состояние);
//   Псарь  — «что сейчас делает пёс»  (команды второму телу).
//
// Правила Псаря проверяются В ОБЕ СТОРОНЫ, как и у Изувера: мало потребовать
// команд псу у Псаря — надо убедиться, что у двух других их НЕТ, и что Псарь
// не взял себе чужого языка: ни накопительного ресурса, ни метки на цели
// как опоры ротации, ни пары «роль + механизм» из чужого набора.
import { describe, expect, it } from 'vitest'
import { CLASSES, CLASS_BY_ID } from '../../data/classes'
import { ABILITY_BY_ID, type AbilityDef } from '../../data/abilities'
import { ABILITY_SLOTS, ABILITY_UNLOCK_GRID } from '../../data/balance'

const HOUND = CLASS_BY_ID.houndmaster
const abilitiesOf = (ids: readonly string[]): AbilityDef[] => ids.map((id) => ABILITY_BY_ID[id])

/** Команда адресована ПСУ: без него ей некого слушать, или она его зовёт и поднимает. */
function addressesHound(a: AbilityDef): boolean {
  return Boolean(a.houndHaste || a.recall || a.grip || a.houndHeal || a.unleash || a.skulk || a.rally || a.pack)
}

/** Умение ЧИТАЕТ пса, не командуя им: удар от пса, серия с укусами. */
function readsHound(a: AbilityDef): boolean {
  return Boolean(a.packStrike || a.flurry)
}

/** Кладёт ли умение что-то НА ЦЕЛЬ — язык Стража. */
function marksTarget(a: AbilityDef): boolean {
  return Boolean(a.effect || a.weaken || a.brand || a.detonate || a.combo)
}

/** Читает ли умение полоску ресурса как состояние — язык Изувера. */
function readsResource(a: AbilityDef): boolean {
  return Boolean(
    a.requires ||
      a.spendAll ||
      a.weaponDamageFromResource ||
      a.edge ||
      a.leech?.healShareFromResource ||
      a.execute?.belowHpShareFromResource ||
      a.detonate?.resourceMultiplier,
  )
}

describe('Псарь командует ПСОМ', () => {
  const hound = abilitiesOf(HOUND.abilityIds)

  it('НЕ МЕНЬШЕ ТРЕТИ умений адресованы псу, а не цели и не герою', () => {
    const commands = hound.filter(addressesHound)
    expect(commands.length * 3, commands.map((a) => a.id).join(', ')).toBeGreaterThanOrEqual(hound.length)
    // И ещё часть ЧИТАЕТ пса: класс спрашивает у боя «что делает пёс» не только приказом.
    expect(hound.filter(readsHound).length).toBeGreaterThanOrEqual(1)
  })

  it('команды РАЗНЫЕ: восемь флагов, а не один флаг с восемью именами', () => {
    const kinds = new Set<string>()
    for (const a of hound) {
      if (a.houndHaste) kinds.add('чаще кусает')
      if (a.recall) kinds.add('отходит')
      if (a.grip) kinds.add('держит')
      if (a.houndHeal) kinds.add('лечится')
      if (a.unleash) kinds.add('кусает по команде')
      if (a.skulk) kinds.add('принимает больше')
      if (a.rally) kinds.add('встаёт')
      if (a.pack) kinds.add('приходит второй')
    }
    expect(kinds.size).toBeGreaterThanOrEqual(8)
  })

  it('ни одного накопительного ресурса — язык Изувера Псарю не достался', () => {
    expect(HOUND.resource.perSwingDealt.toNumber()).toBe(0)
    expect(HOUND.resource.perHitTaken.toNumber()).toBe(0)
    expect(HOUND.resource.decayShare.toNumber()).toBe(0)
    for (const a of hound) {
      expect(readsResource(a), `${a.id} читает полоску как состояние`).toBe(false)
      expect(a.generate, a.id).toBeUndefined()
      expect(a.refund, a.id).toBeUndefined()
      expect(a.bloodPrice, a.id).toBeUndefined()
      expect(a.window, a.id).toBeUndefined()
    }
  })

  it('ни одной метки на цели — язык Стража Псарю не достался', () => {
    expect(hound.filter(marksTarget).map((a) => a.id)).toEqual([])
  })

  it('ни одной чужой пары «роль + механизм»: без spendAll, execute, window, stance, ramp, resolve', () => {
    for (const a of hound) {
      expect(a.spendAll, a.id).toBeUndefined()
      expect(a.execute, a.id).toBeUndefined()
      expect(a.stance, a.id).toBeUndefined()
      expect(a.ramp, a.id).toBeUndefined()
      expect(a.resolve, a.id).toBeUndefined()
      expect(a.absorb, a.id).toBeUndefined()
      expect(a.freeCasts, a.id).toBeUndefined()
    }
  })

  it('сетка открытий как у готового класса, хотя класс превью', () => {
    const levels = hound.map((a) => a.unlockLevel).sort((a, b) => a - b)
    expect(levels).toEqual([...ABILITY_UNLOCK_GRID])
  })

  it('четвёрка по умолчанию — не четыре удара героя: в ней есть команды псу', () => {
    const core = abilitiesOf(HOUND.abilityIds.slice(0, ABILITY_SLOTS))
    expect(core.filter((a) => addressesHound(a) || readsHound(a)).length).toBeGreaterThanOrEqual(2)
  })
})

describe('Страж и Изувер псом не командуют — обратная сторона того же правила', () => {
  for (const cls of CLASSES.filter((c) => c.id !== HOUND.id)) {
    it(`${cls.name}: ни одной команды псу и ни одного чтения пса`, () => {
      const own = abilitiesOf(cls.abilityIds)
      expect(own.filter((a) => addressesHound(a) || readsHound(a)).map((a) => a.id)).toEqual([])
      expect(cls.companion).toBeUndefined()
    })
  }

  it('каждое умение принадлежит ровно одному классу', () => {
    const owners = new Map<string, string[]>()
    for (const cls of CLASSES) for (const id of cls.abilityIds) owners.set(id, [...(owners.get(id) ?? []), cls.id])
    for (const [id, list] of owners) expect(list, id).toHaveLength(1)
  })
})
