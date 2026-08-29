import { describe, expect, it } from 'vitest'
import { Decimal } from '../game'
import { flatText } from './statText'

// Эти строки не ловит ни один снимок: цифра в подписи таланта занимает
// сотые доли процента пикселей страницы. Ловятся они только чтением.
describe('flatText', () => {
  it('дробную прибавку показывает дробью, а не нулём', () => {
    // Именно так «Свирепые удары» читались как «+0 множителя крита за ранг».
    expect(flatText(new Decimal(0.05))).toBe('+0.05')
    expect(flatText(new Decimal(0.5))).toBe('+0.5')
  })

  it('у отрицательной прибавки один знак, а не два', () => {
    // «+-0 паузы восстановления» — так выглядел «Ясный ум».
    expect(flatText(new Decimal(-0.5))).toBe('−0.5')
    expect(flatText(new Decimal(-3))).toBe('−3')
  })

  it('целое остаётся целым, без хвоста из нулей', () => {
    expect(flatText(new Decimal(3))).toBe('+3')
    expect(flatText(new Decimal(0))).toBe('+0')
  })

  it('крупные числа идут разрядами — там доли не нужны', () => {
    expect(flatText(new Decimal(1200))).toBe('+1.20K')
    expect(flatText(new Decimal(-1200))).toBe('−1.20K')
  })
})
