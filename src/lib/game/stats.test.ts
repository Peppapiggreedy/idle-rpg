import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import {
  applyModifiers,
  collectModifiers,
  computeSwingTime,
  ensureStats,
  explainStat,
  recomputeStats,
  STAT_IDS,
  type StatModifier,
} from './stats'
import { createInitialState, type GameState } from './state'
import { buyUpgrade } from './upgrades'
import { WEAPON_SHARPENING } from '../data/upgrades'
import { UNARMED } from '../data/balance'
import { expectedSwingDamage } from './combat'

function withUpgrades(count: number): GameState {
  const s = {
    ...createInitialState(1),
    upgrades: { 'weapon-sharpening': new Decimal(count) },
    statsDirty: true,
  }
  return ensureStats(s)
}

describe('weaponSpeed / haste / swingTime', () => {
  it('swingTime = weaponSpeed / (1 + haste)', () => {
    expect(computeSwingTime(2, 0)).toBe(2)
    expect(computeSwingTime(2, 0.25)).toBe(1.6)
    expect(computeSwingTime(3, 0.5)).toBe(2)
  })

  it('haste ускоряет (swingTime падает), медленное оружие замедляет', () => {
    const fast = applyModifiers([
      { stat: 'haste', kind: 'flat', value: new Decimal(1), source: 'talent:frenzy' },
    ])
    expect(fast.haste).toBe(1)
    expect(fast.swingTime).toBe(1) // 2 / (1 + 1)

    const slow = applyModifiers([
      { stat: 'weaponSpeed', kind: 'base', value: new Decimal(3.6), source: 'equipment:weapon' },
    ])
    expect(slow.swingTime).toBe(3.6)
  })

  it('swingTime не модифицируется напрямую: его нет среди статов', () => {
    // Защита от «одно имя на две величины»: ни один источник не может выдать
    // модификатор на swingTime — только на weaponSpeed или haste.
    expect(STAT_IDS).not.toContain('swingTime' as unknown as (typeof STAT_IDS)[number])
  })
})

describe("модификатор kind 'base'", () => {
  it('ЗАМЕНЯЕТ базовое значение, а не прибавляется к нему', () => {
    // Топор 3.6с вместо безоружных 2.0с — не 2.0 + 3.6.
    const s = applyModifiers([
      { stat: 'weaponSpeed', kind: 'base', value: new Decimal(3.6), source: 'equipment:weapon' },
    ])
    expect(s.weaponSpeed).toBe(3.6)
  })

  it('без base-модификатора берётся UNARMED из data/balance', () => {
    expect(applyModifiers([]).weaponSpeed).toBe(UNARMED.weaponSpeed.toNumber())
  })

  it('при двух base-источниках выигрывает ПОСЛЕДНИЙ (зафиксировано намеренно)', () => {
    const mods: StatModifier[] = [
      { stat: 'weaponSpeed', kind: 'base', value: new Decimal(3.6), source: 'equipment:weapon' },
      { stat: 'weaponSpeed', kind: 'base', value: new Decimal(1.4), source: 'equipment:offhand' },
    ]
    expect(applyModifiers(mods).weaponSpeed).toBe(1.4)
  })

  it('порядок применения: base -> flat -> percent -> multiplier', () => {
    // (база заменена на 10, +5 flat) * (1 + 0.5) * 2 = 45
    const s = applyModifiers([
      { stat: 'attackPower', kind: 'base', value: new Decimal(10), source: 'equipment:weapon' },
      { stat: 'attackPower', kind: 'flat', value: new Decimal(5), source: 'talent:heavy_blows' },
      { stat: 'attackPower', kind: 'percent', value: new Decimal(0.5), source: 'zone:ashen_wastes' },
      { stat: 'attackPower', kind: 'multiplier', value: new Decimal(2), source: 'talent:frenzy' },
    ])
    expect(s.attackPower.toNumber()).toBe(45)
  })
})

describe('прогресс замаха при смене swingTime', () => {
  it('доля замаха сохраняется: смена оружия не сбрасывает удар', () => {
    // Прогресс хранится ДОЛЕЙ 0..1, поэтому при смене swingTime он остаётся
    // тем же: половина замаха 4с превращается в половину замаха 2с сама.
    const s = createInitialState(1)
    const stale: GameState = {
      ...s,
      stats: { ...s.stats, weaponSpeed: 4, swingTime: 4 },
      swingProgress: 0.5,
      statsDirty: true,
    }
    const next = ensureStats(stale)
    expect(next.stats.swingTime).toBe(2)
    expect(next.swingProgress).toBe(0.5)
  })

  it('смена скорости не даёт ни мгновенного удара, ни сброса замаха', () => {
    const s = createInitialState(1)
    const stale: GameState = {
      ...s,
      stats: { ...s.stats, weaponSpeed: 1, swingTime: 1 },
      swingProgress: 0.9, // 90% замаха
      statsDirty: true,
    }
    const next = ensureStats(stale)
    // 90% замаха остаются 90%: не 0 (сброс) и не >= 1 (мгновенный удар).
    expect(next.swingProgress).toBe(0.9)
    expect(next.swingProgress).toBeLessThan(1)
    expect(next.swingProgress).toBeGreaterThan(0)
  })

  it('без изменения swingTime прогресс не трогается', () => {
    const s: GameState = { ...createInitialState(1), swingProgress: 0.777, statsDirty: true }
    expect(ensureStats(s).swingProgress).toBe(0.777)
  })
})

describe('конвейер статов', () => {
  it('базовые статы без источников равны балансу', () => {
    const stats = createInitialState(1).stats
    expect(stats.attackPower.toNumber()).toBe(70) // даёт 70 * 2.0 / 14 = 10 к удару
    expect(stats.weaponDamageMin.toNumber()).toBe(8)
    expect(stats.weaponDamageMax.toNumber()).toBe(12)
    expect(stats.maxHp.toNumber()).toBe(100)
    expect(stats.maxMana.toNumber()).toBe(50)
    expect(stats.weaponSpeed).toBe(2)
    expect(stats.haste).toBe(0)
    expect(stats.swingTime).toBe(2) // 2 / (1 + 0)
    expect(stats.critChance).toBeCloseTo(0.05, 10)
    expect(stats.critMultiplier.toNumber()).toBe(2)
    expect(stats.damageReduction).toBe(0)
  })

  it('апгрейды дают flat-модификатор из СЧЁТЧИКА покупок', () => {
    const mods = collectModifiers(withUpgrades(7))
    expect(mods).toHaveLength(1)
    expect(mods[0]).toMatchObject({ stat: 'attackPower', kind: 'flat', source: 'upgrade:weapon-sharpening' })
    expect(mods[0].value.toNumber()).toBe(98) // 7 покупок по +14 силы атаки
  })

  it('20 купленных апгрейдов дают прежний средний удар 60', () => {
    // Эквивалентность прежней накопительной схеме теперь проверяется по
    // среднему урону удара (детально — в damage-model.test.ts).
    const s = withUpgrades(20)
    expect(s.stats.attackPower.toNumber()).toBe(70 + 20 * 14)
    expect(expectedSwingDamage(s.stats).toNumber()).toBe(60)
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
    // (70 база + 10) * (1 + 0.2 + 0.3) * 2 = 240
    let flat = new Decimal(0), percent = new Decimal(0), mult = new Decimal(1)
    for (const m of mods) {
      if (m.kind === 'flat') flat = flat.plus(m.value)
      else if (m.kind === 'percent') percent = percent.plus(m.value)
      else mult = mult.times(m.value)
    }
    const total = s.stats.attackPower.plus(flat).times(percent.plus(1)).times(mult)
    expect(total.toNumber()).toBe(240)
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
    expect(after.stats.attackPower.toNumber()).toBe(84) // 70 + 14
    expect(after.statsDirty).toBe(false)
    // Урон нигде не хранится суммой: пересчёт с нуля даёт то же.
    expect(recomputeStats(after).attackPower.toNumber()).toBe(84)
  })

  it('explainStat раскладывает цифру по источникам', () => {
    const b = explainStat(withUpgrades(20), 'attackPower')
    expect(b.base.toNumber()).toBe(70)
    expect(b.entries).toHaveLength(1)
    expect(b.entries[0].source).toBe('upgrade:weapon-sharpening')
    expect(b.entries[0].value.toNumber()).toBe(280) // 20 * 14
    expect(b.total.toNumber()).toBe(350)
  })
})
