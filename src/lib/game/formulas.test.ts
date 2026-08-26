import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { applyXp, upgradeCost, xpToNextLevel } from './formulas'
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
    expect(s.stats.attackPower.minus(damageBefore).toNumber()).toBe(20) // 10 покупок по +2 за удар
  })

  it('при нехватке золота покупка ничего не меняет', () => {
    const s: GameState = { ...createInitialState(), gold: new Decimal(5) }
    const after = buyUpgrade(s, WEAPON_SHARPENING)
    expect(after).toBe(s)
  })
})

describe('уровни', () => {
  it('кривая опыта: floor(10 * level^1.5)', () => {
    expect(xpToNextLevel(new Decimal(1)).toNumber()).toBe(10)
    expect(xpToNextLevel(new Decimal(2)).toNumber()).toBe(28)
    expect(xpToNextLevel(new Decimal(4)).toNumber()).toBe(80) // 4^1.5 = 8 ровно
  })

  it('остаток опыта переносится, несколько уровней за один раз', () => {
    // 100 опыта с 1 уровня: 100-10=90, 90-28=62, 62-51=11 -> уровень 4, остаток 11
    const r = applyXp(new Decimal(1), new Decimal(0), new Decimal(100))
    expect(r.level.toNumber()).toBe(4)
    expect(r.currentXp.toNumber()).toBe(11)
    expect(r.xpToNext.toNumber()).toBe(80)
  })

  it('ровно на границе уровня остаток нулевой', () => {
    const r = applyXp(new Decimal(1), new Decimal(0), new Decimal(10))
    expect(r.level.toNumber()).toBe(2)
    expect(r.currentXp.toNumber()).toBe(0)
  })

  it('очень большой опыт за один раз: корректный уровень, без зависания', () => {
    const r = applyXp(new Decimal(1), new Decimal(0), new Decimal(1e9))
    expect(r.level.toNumber()).toBe(2287)
    expect(r.currentXp.toNumber()).toBe(28748)
    // Инвариант: остатка не хватает на следующий уровень.
    expect(r.currentXp.lt(r.xpToNext)).toBe(true)
  })
})
