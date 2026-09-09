import { describe, expect, it } from 'vitest'
import { CLASSES } from '../data/classes'
import { classAccusative } from './classText'

describe('склонение имени класса', () => {
  it('твёрдая основа получает «а», мягкий знак меняется на «я»', () => {
    expect(classAccusative('Страж')).toBe('Стража')
    expect(classAccusative('Изувер')).toBe('Изувера')
    expect(classAccusative('Псарь')).toBe('Псаря')
  })

  it('ни одно имя из данных не склоняется в «ьа»', () => {
    // Ровно та поломка, ради которой функция появилась: кнопка клеила «а»
    // к любому имени, и третий класс читался бы как «Псарьа».
    for (const hero of CLASSES) {
      expect(classAccusative(hero.name)).not.toMatch(/ь[ая]$/)
      expect(classAccusative(hero.name).length).toBeGreaterThan(hero.name.length - 1)
    }
  })
})
