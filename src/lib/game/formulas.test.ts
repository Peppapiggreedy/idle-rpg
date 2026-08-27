import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { applyXp, upgradeCost, xpToNextLevel } from './formulas'
import { XP_CURVE_BASE, XP_CURVE_EXPONENT } from '../data/balance'
import { buyUpgrade, ownedCount } from './upgrades'
import { createInitialState, type GameState } from './tick'
import { WEAPON_SHARPENING } from '../data/upgrades'

describe('upgradeCost и покупка', () => {
  it('цена растёт как 10 * 1.15^owned, целым золотом', () => {
    expect(upgradeCost(WEAPON_SHARPENING, new Decimal(0)).toNumber()).toBe(10)
    expect(upgradeCost(WEAPON_SHARPENING, new Decimal(1)).toNumber()).toBe(11)
    expect(upgradeCost(WEAPON_SHARPENING, new Decimal(5)).toNumber()).toBe(20)
  })

  it('покупка 10 апгрейдов подряд списывает ровно 200 золота', () => {
    // floor(10*1.15^k) для k=0..9: 10+11+13+15+17+20+23+26+30+35 = 200
    let s: GameState = { ...createInitialState(), gold: new Decimal(1000) }
    const damageBefore = s.stats.attackPower
    for (let i = 0; i < 10; i++) s = buyUpgrade(s, WEAPON_SHARPENING)
    expect(s.gold.toNumber()).toBe(800)
    expect(ownedCount(s, WEAPON_SHARPENING).toNumber()).toBe(10)
    expect(s.stats.attackPower.minus(damageBefore).toNumber()).toBe(140) // 10 покупок по +14 силы атаки
  })

  it('при нехватке золота покупка ничего не меняет', () => {
    const s: GameState = { ...createInitialState(), gold: new Decimal(5) }
    const after = buyUpgrade(s, WEAPON_SHARPENING)
    expect(after).toBe(s)
  })
})

describe('уровни', () => {
  // Порог уровня — floor(XP_CURVE_BASE * level^XP_CURVE_EXPONENT). Числа кривой
  // живут в data/balance.ts, поэтому тест берёт их оттуда, а не повторяет: при
  // осознанной перенастройке темпа прокачки алгоритм проверяется по-прежнему.
  const need = (level: number) => xpToNextLevel(new Decimal(level))

  it('кривая опыта: floor(база * уровень^степень)', () => {
    const expected = (level: number) =>
      Math.floor(XP_CURVE_BASE.toNumber() * Math.pow(level, XP_CURVE_EXPONENT))
    expect(need(1).toNumber()).toBe(expected(1))
    expect(need(2).toNumber()).toBe(expected(2))
    expect(need(4).toNumber()).toBe(expected(4))
    // Кривая строго растёт: следующий уровень всегда дороже предыдущего.
    for (let level = 1; level < 20; level++) {
      expect(need(level + 1).gt(need(level))).toBe(true)
    }
  })

  it('остаток опыта переносится, несколько уровней за один раз', () => {
    // Опыта ровно на три уровня плюс 7 сверху: остаток обязан быть этой семёркой.
    const gained = need(1).plus(need(2)).plus(need(3)).plus(7)
    const r = applyXp(new Decimal(1), new Decimal(0), gained)
    expect(r.level.toNumber()).toBe(4)
    expect(r.currentXp.toNumber()).toBe(7)
    expect(r.xpToNext.eq(need(4))).toBe(true)
  })

  it('ровно на границе уровня остаток нулевой', () => {
    const r = applyXp(new Decimal(1), new Decimal(0), need(1))
    expect(r.level.toNumber()).toBe(2)
    expect(r.currentXp.toNumber()).toBe(0)
  })

  it('очень большой опыт за один раз: корректный уровень, без зависания', () => {
    const r = applyXp(new Decimal(1), new Decimal(0), new Decimal(1e9))
    // Уровень взят верно: на достигнутый опыта хватило, на следующий — нет.
    let spent = new Decimal(0)
    for (let level = 1; level < r.level.toNumber(); level++) spent = spent.plus(need(level))
    expect(spent.plus(r.currentXp).eq(new Decimal(1e9))).toBe(true)
    expect(r.currentXp.lt(r.xpToNext)).toBe(true)
  })
})
