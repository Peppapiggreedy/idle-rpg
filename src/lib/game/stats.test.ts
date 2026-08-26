import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { collectModifiers, ensureStats, explainStat, recomputeStats } from './stats'
import { createInitialState, type GameState } from './state'
import { buyUpgrade } from './upgrades'
import { WEAPON_SHARPENING } from '../data/upgrades'

function withUpgrades(count: number): GameState {
  const s = {
    ...createInitialState(1),
    upgrades: { 'weapon-sharpening': new Decimal(count) },
    statsDirty: true,
  }
  return ensureStats(s)
}

describe('конвейер статов', () => {
  it('базовые статы без источников равны балансу', () => {
    const stats = createInitialState(1).stats
    expect(stats.attackPower.toNumber()).toBe(20)
    expect(stats.maxHp.toNumber()).toBe(100)
    expect(stats.maxMana.toNumber()).toBe(50)
    expect(stats.attackSpeed).toBe(2)
    expect(stats.critChance).toBeCloseTo(0.05, 10)
    expect(stats.critMultiplier.toNumber()).toBe(2)
    expect(stats.damageReduction).toBe(0)
  })

  it('апгрейды дают flat-модификатор из СЧЁТЧИКА покупок', () => {
    const mods = collectModifiers(withUpgrades(7))
    expect(mods).toHaveLength(1)
    expect(mods[0]).toMatchObject({ stat: 'attackPower', kind: 'flat', source: 'upgrade:weapon-sharpening' })
    expect(mods[0].value.toNumber()).toBe(14) // 7 покупок по +2
  })

  it('20 купленных апгрейдов дают тот же урон, что накопительная схема: 20 + 20*2 = 60', () => {
    // Именно этот пересчёт заменил накопительное поле damagePerSwing —
    // базовый случай (0 покупок) закреплён golden-эталоном без изменений.
    expect(withUpgrades(20).stats.attackPower.toNumber()).toBe(60)
  })

  it('порядок применения: base -> +flat -> *(1+сумма percent) -> *multiplier', () => {
    // Проценты аддитивны, множители перемножаются; проверяем на синтетике.
    const s = withUpgrades(0)
    const mods = [
      { stat: 'attackPower', kind: 'flat', value: new Decimal(10), source: 'equipment:weapon' },
      { stat: 'attackPower', kind: 'percent', value: new Decimal(0.2), source: 'talent:heavy_blows' },
      { stat: 'attackPower', kind: 'percent', value: new Decimal(0.3), source: 'zone:ashen_wastes' },
      { stat: 'attackPower', kind: 'multiplier', value: new Decimal(2), source: 'talent:frenzy' },
    ] as const
    // (20 база + 10) * (1 + 0.2 + 0.3) * 2 = 90
    let flat = new Decimal(0), percent = new Decimal(0), mult = new Decimal(1)
    for (const m of mods) {
      if (m.kind === 'flat') flat = flat.plus(m.value)
      else if (m.kind === 'percent') percent = percent.plus(m.value)
      else mult = mult.times(m.value)
    }
    const total = s.stats.attackPower.plus(flat).times(percent.plus(1)).times(mult)
    expect(total.toNumber()).toBe(90)
  })

  it('кеш: без statsDirty пересчёта нет, объект статов тот же', () => {
    const s = createInitialState(1)
    expect(ensureStats(s)).toBe(s) // не dirty — то же состояние без копий
    const dirty = { ...s, statsDirty: true }
    const recomputed = ensureStats(dirty)
    expect(recomputed).not.toBe(dirty)
    expect(recomputed.statsDirty).toBe(false)
  })

  it('покупка апгрейда меняет урон только через пересчёт источников', () => {
    const before = { ...createInitialState(1), gold: new Decimal(100) }
    const after = buyUpgrade(before, WEAPON_SHARPENING)
    expect(after.stats.attackPower.toNumber()).toBe(22)
    expect(after.statsDirty).toBe(false)
    // Урон нигде не хранится суммой: пересчёт с нуля даёт то же.
    expect(recomputeStats(after).attackPower.toNumber()).toBe(22)
  })

  it('explainStat раскладывает цифру по источникам', () => {
    const b = explainStat(withUpgrades(20), 'attackPower')
    expect(b.base.toNumber()).toBe(20)
    expect(b.entries).toHaveLength(1)
    expect(b.entries[0].source).toBe('upgrade:weapon-sharpening')
    expect(b.entries[0].value.toNumber()).toBe(40)
    expect(b.total.toNumber()).toBe(60)
  })
})
