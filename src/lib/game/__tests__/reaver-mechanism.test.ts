// КЛАССЫ РАЗВЕДЕНЫ МЕХАНИЗМОМ, А НЕ СПИСКОМ УМЕНИЙ.
//
// «Разные умения» — не свойство, а перечисление: два набора одинаковых по
// устройству кнопок с разными именами тоже «разные». Свойство здесь одно и
// оно проверяемое: КАКОЙ ВОПРОС ЗАДАЁТ КЛАСС.
//
//   Страж ПИШЕТ НА ЦЕЛИ — метки, кровотечения, детонации. Его вопрос:
//     «что висит на мобе».
//   Изувер ПЕРЕКЛЮЧАЕТ СЕБЯ — ярость у него СОСТОЯНИЕ, и умения это
//     состояние читают. Его вопрос: «в каком я сейчас».
//
// Отсюда два правила, и проверяются они В ОБЕ СТОРОНЫ: мало потребовать
// чтения полоски у Изувера — надо ещё убедиться, что у Стража его НЕТ, иначе
// правило выполнялось бы само собой и ничего не различало.
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../../data/classes'
import { ABILITY_BY_ID, type AbilityDef } from '../../data/abilities'
import { ABILITY_SLOTS } from '../../data/balance'

const RAGE = CLASSES.find((c) => c.resource.kind === 'rage')!
const MANA = CLASSES.find((c) => c.resource.kind === 'mana')!

const abilitiesOf = (ids: string[]): AbilityDef[] => ids.map((id) => ABILITY_BY_ID[id])

/**
 * ЧИТАЕТ ЛИ УМЕНИЕ ТЕКУЩИЙ УРОВЕНЬ РЕСУРСА.
 *
 * Считается ровно то, где полоска МЕНЯЕТ ПОВЕДЕНИЕ: величина растёт от неё,
 * порог её требует, состояние её читает. Цена НЕ СЧИТАЕТСЯ ВОВСЕ — «стоит
 * 30 ярости» платят и манные умения, и если засчитать цену, правило станет
 * тавтологией: ресурс тратят все.
 *
 * Подсказки автокаста (`autocast.resourceAbove/Below`) тоже НЕ считаются:
 * это совет роботу, а не правило умения, и руками игрок их обходит.
 */
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

/** Кладёт ли умение эффект НА ЦЕЛЬ: то, что потом «висит на мобе». */
function marksTarget(a: AbilityDef): boolean {
  return Boolean(a.effect || a.weaken || a.brand)
}

describe('Изувер переключает СЕБЯ', () => {
  const rage = abilitiesOf(RAGE.abilityIds)

  it('НЕ МЕНЬШЕ ПОЛОВИНЫ умений читают текущий уровень ярости', () => {
    const readers = rage.filter(readsResource)
    const names = readers.map((a) => a.id).join(', ')
    expect(readers.length * 2, `читают полоску: ${names}`).toBeGreaterThanOrEqual(rage.length)
  })

  it('НЕ БОЛЬШЕ ОДНОГО кладёт эффект на цель', () => {
    const marks = rage.filter(marksTarget)
    expect(marks.map((a) => a.id)).toHaveLength(0)
  })

  it('и то, что кладёт, — не ядро ротации: четвёрка по умолчанию без меток', () => {
    // Четвёрка по умолчанию — первые слоты в порядке открытия. Даже если
    // однажды одна метка появится, в обязательном ядре ей не место: иначе
    // «спрашивай, что висит на мобе» вернётся к Изуверу первой же кнопкой.
    const core = abilitiesOf(RAGE.abilityIds.slice(0, ABILITY_SLOTS))
    expect(core.filter(marksTarget).map((a) => a.id)).toHaveLength(0)
  })

  it('ЧИТАЮТ ПО-РАЗНОМУ: одним способом это была бы одна механика на все', () => {
    const ways = new Set<string>()
    for (const a of rage) {
      if (a.requires) ways.add('порог')
      if (a.spendAll || a.weaponDamageFromResource) ways.add('урон от полоски')
      if (a.edge) ways.add('состояние от полоски')
      if (a.leech?.healShareFromResource) ways.add('лечение от полоски')
      if (a.execute?.belowHpShareFromResource) ways.add('порог добивания от полоски')
    }
    expect([...ways].sort()).toHaveLength(5)
  })
})

describe('Страж пишет НА ЦЕЛИ — и это обратная сторона того же правила', () => {
  const mana = abilitiesOf(MANA.abilityIds)

  it('ни одно его умение не читает уровень ресурса', () => {
    const readers = mana.filter(readsResource).map((a) => a.id)
    expect(readers, 'механизм Изувера утёк Стражу').toEqual([])
  })

  it('метки на цели есть, и их несколько: это его вопрос к бою', () => {
    expect(mana.filter(marksTarget).length).toBeGreaterThanOrEqual(2)
  })

  it('связка «метка → детонация» осталась ЕМУ, и целиком', () => {
    const combos = mana.filter((a) => a.combo)
    expect(combos.length).toBeGreaterThanOrEqual(1)
    for (const a of combos) {
      // Опора связки лежит в том же наборе: связка внутри класса, а не между.
      expect(MANA.abilityIds).toContain(a.combo!.needsAbilityId)
    }
    // И ни одной связки у Изувера: копия чужого механизма — это не свой.
    expect(abilitiesOf(RAGE.abilityIds).filter((a) => a.combo)).toHaveLength(0)
  })
})
