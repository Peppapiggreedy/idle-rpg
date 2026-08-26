import { describe, expect, it } from 'vitest'
import { Decimal, formatNumber } from './numbers'

describe('formatNumber', () => {
  it('целые до 1000 — без суффикса', () => {
    expect(formatNumber(new Decimal(0))).toBe('0')
    expect(formatNumber(new Decimal(7))).toBe('7')
    expect(formatNumber(new Decimal(999))).toBe('999')
  })

  it('суффиксы K/M/B/T', () => {
    expect(formatNumber(new Decimal(1234))).toBe('1.23K')
    expect(formatNumber(new Decimal(4_560_000))).toBe('4.56M')
    expect(formatNumber(new Decimal(7_890_000_000))).toBe('7.89B')
    expect(formatNumber(new Decimal(1e12))).toBe('1.00T')
    expect(formatNumber(new Decimal(999_400_000_000_000))).toBe('999.40T')
  })

  it('от 1e15 — экспонента без плюса', () => {
    expect(formatNumber(new Decimal(1e15))).toBe('1.00e15')
    expect(formatNumber(new Decimal(2.5e17))).toBe('2.50e17')
  })

  it('очень большие числа за пределами number', () => {
    expect(formatNumber(new Decimal('1.23e456'))).toBe('1.23e456')
    expect(formatNumber(new Decimal('1e308').times(1000))).toBe('1.00e311')
    expect(formatNumber(Decimal.pow(10, 100000))).toBe('1.00e100000')
  })

  it('граница округления не даёт "1000.00K"', () => {
    expect(formatNumber(new Decimal(999_996))).toBe('1.00M')
  })

  it('отрицательные — зеркально', () => {
    expect(formatNumber(new Decimal(-1234))).toBe('-1.23K')
  })
})
