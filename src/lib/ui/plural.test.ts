import { describe, expect, it } from 'vitest'
import { levelWord, plural } from './plural'

describe('склонение после числа', () => {
  it('три формы, а не две', () => {
    // РОВНО ТА ПОЛОМКА, из-за которой модуль и появился: лестница открытий
    // писала «Осталось 2 уровней», потому что правило стояло на сравнении
    // с единицей.
    expect(levelWord(1)).toBe('уровень')
    expect(levelWord(2)).toBe('уровня')
    expect(levelWord(3)).toBe('уровня')
    expect(levelWord(4)).toBe('уровня')
    expect(levelWord(5)).toBe('уровней')
    expect(levelWord(10)).toBe('уровней')
  })

  it('одиннадцать-четырнадцать — исключение', () => {
    for (const n of [11, 12, 13, 14, 111, 112]) {
      expect(levelWord(n), `${n}`).toBe('уровней')
    }
    // А двадцать один — снова единственное: правило считает последнюю цифру.
    expect(levelWord(21)).toBe('уровень')
    expect(levelWord(22)).toBe('уровня')
  })

  it('ноль — как «много»', () => {
    expect(levelWord(0)).toBe('уровней')
  })

  it('работает не только с уровнями', () => {
    expect(plural(1, 'место', 'места', 'мест')).toBe('место')
    expect(plural(4, 'место', 'места', 'мест')).toBe('места')
    expect(plural(8, 'место', 'места', 'мест')).toBe('мест')
  })
})
