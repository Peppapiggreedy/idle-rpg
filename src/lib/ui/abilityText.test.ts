// ТЕКСТЫ ПРО УМЕНИЯ: полнота и связки.
//
// Книга умений — место, где игрок выбирает четыре из одиннадцати, и выбор
// идёт по РОЛИ СЛОВАМИ, а не по числам. Умение без роли — кнопка без
// объяснения, поэтому полнота проверяется, а не подразумевается.
import { describe, expect, it } from 'vitest'
import { ABILITIES, ABILITY_BY_ID, ABILITY_TUNABLE } from '../data/abilities'
import { TUNABLE_FIELDS } from '../game/abilityTune'
import { ABILITY_ROLE, abilityTuneText, comboState, comboText } from './abilityText'

describe('роли умений', () => {
  it('роль есть у КАЖДОГО умения обоих классов', () => {
    const missing = ABILITIES.filter((a) => !ABILITY_ROLE[a.id]).map((a) => a.id)
    expect(missing).toEqual([])
  })

  it('роль — предложение для человека, а не подпись из данных', () => {
    for (const ability of ABILITIES) {
      const role = ABILITY_ROLE[ability.id]
      expect(role.length).toBeGreaterThan(20)
      // Роль отвечает на «зачем», а не повторяет имя умения.
      expect(role).not.toBe(ability.name)
    }
  })
})

describe('связка умений', () => {
  // Механизм проверяется на синтетическом определении: сама связка приезжает
  // вместе с «Разрывом» в стадии 3, а сторож обязан работать уже сейчас —
  // иначе к моменту появления связки его никто не проверит.
  const alone: { combo?: { needsAbilityId: string } } = {}
  const paired = { combo: { needsAbilityId: 'rending-wound' } }

  it('самостоятельное умение связки не имеет', () => {
    expect(comboState(alone, ['rending-wound', null, null, null])).toBe('none')
  })

  it('связка ГОТОВА, когда нужное умение стоит в ряду', () => {
    expect(comboState(paired, ['quick-strike', 'rending-wound', null, null])).toBe('ready')
  })

  it('связка СЛОМАНА, когда нужного умения в ряду нет', () => {
    expect(comboState(paired, ['quick-strike', null, null, null])).toBe('missing')
  })

  it('текст называет умение по имени в обоих состояниях', () => {
    expect(comboText('ready', 'Рваная рана')).toContain('Рваная рана')
    expect(comboText('missing', 'Рваная рана')).toContain('Рваная рана')
    // «Не работает» обязано звучать как отказ, а не как справка.
    expect(comboText('missing', 'Рваная рана')).toContain('не работает')
  })
})

// ТАЛАНТ ГОВОРИТ ПРО УМЕНИЕ ТЕМИ ЖЕ СЛОВАМИ, ЧТО И КНИГА.
//
// Талант и книга описывают ОДНО И ТО ЖЕ поле — откат, цену, порог, — и если
// у них разные слова, игрок читает два ответа на один вопрос: в дереве
// «перезарядка», в книге «откат», и связать их можно только догадкой.
// Поэтому подпись поля — одна карта на игру, и она обязана покрывать ВЕСЬ
// список настраиваемых полей: поле без подписи вылезет игроку голым
// идентификатором из данных.
describe('талант, правящий умение', () => {
  it('подпись есть у КАЖДОГО настраиваемого поля', () => {
    // Не «у тех, что уже используются»: список полей закрыт и лежит в
    // данных, а новое поле обязано получить слово в тот же день.
    const naked = TUNABLE_FIELDS.filter((field) => {
      const kind = ABILITY_TUNABLE[field] === 'shift' ? 'points' : 'percent'
      const line = abilityTuneText({
        abilityId: 'mercy',
        tune: [{ field, kind, value: 0.1 }] as never,
      })
      return line.includes(field)
    })
    expect(naked).toEqual([])
    // Тип умения в списке величин не лежит, но подпись ему нужна так же.
    expect(
      abilityTuneText({
        abilityId: 'mercy',
        tune: [{ field: 'type', kind: 'set', value: 'instant' }] as never,
      }),
    ).not.toContain('type')
  })

  it('строка называет умение по имени, а не по идентификатору', () => {
    const line = abilityTuneText({
      abilityId: 'shattering-blow',
      tune: [{ field: 'cooldownSec', kind: 'percent', value: -0.25 }] as never,
    })
    expect(line).toContain(ABILITY_BY_ID['shattering-blow'].name)
    expect(line).not.toContain('shattering-blow')
    expect(line).toContain('−25 %')
    // «За ранг» — не украшение: талант многоранговый, и число в строке
    // относится к ОДНОМУ очку.
    expect(line).toContain('за ранг')
  })

  it('ПОРОГ — В ПУНКТАХ, величина — в процентах', () => {
    // Порог живёт в долях 0..1, и «+10 %» от 0.2 значило бы 0.22, а игрок
    // читает пороги как 20 % → 30 %. Два разных слова на две разные вещи.
    const gate = abilityTuneText({
      abilityId: 'mercy',
      tune: [{ field: 'executeBelowHpShare', kind: 'points', value: 0.1 }] as never,
    })
    expect(gate).toContain('+10 пунктов')
    expect(gate).not.toContain('%')

    const scale = abilityTuneText({
      abilityId: 'mercy',
      tune: [{ field: 'manaCost', kind: 'percent', value: -0.3 }] as never,
    })
    expect(scale).toContain('−30 %')
    expect(scale).not.toContain('пункт')
  })

  it('множитель показывается прибавкой, а не самим множителем', () => {
    // ×1.5 в строке читалось бы как «умножить цену на полтора» рядом с
    // процентами соседних талантов; игрок сравнивает прибавки.
    const line = abilityTuneText({
      abilityId: 'shattering-blow',
      tune: [{ field: 'cooldownSec', kind: 'multiplier', value: 0.5 }] as never,
    })
    expect(line).toContain('−50 %')
  })

  it('смена типа названа действием, а не словом из данных', () => {
    const line = abilityTuneText({
      abilityId: 'shattering-blow',
      tune: [{ field: 'type', kind: 'set', value: 'instant' }] as never,
    })
    expect(line).toContain('бьёт сразу')
    expect(line).not.toContain('instant')
  })

  it('несколько правок перечисляются одной строкой через запятую', () => {
    const line = abilityTuneText({
      abilityId: 'mercy',
      tune: [
        { field: 'manaCost', kind: 'percent', value: -0.2 },
        { field: 'executeBelowHpShare', kind: 'points', value: 0.05 },
      ] as never,
    })
    expect(line.split(',').length).toBe(2)
  })
})
