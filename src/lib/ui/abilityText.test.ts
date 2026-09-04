// ТЕКСТЫ ПРО УМЕНИЯ: полнота и связки.
//
// Книга умений — место, где игрок выбирает четыре из одиннадцати, и выбор
// идёт по РОЛИ СЛОВАМИ, а не по числам. Умение без роли — кнопка без
// объяснения, поэтому полнота проверяется, а не подразумевается.
import { describe, expect, it } from 'vitest'
import { ABILITIES } from '../data/abilities'
import { ABILITY_ROLE, comboState, comboText } from './abilityText'

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
