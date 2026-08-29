// Ключевой тест модели урона: сила атаки нормализована по скорости оружия.
// Слева — арифметика эталонной модели (урон удара одним числом: 20 + 2 за
// каждые 14 силы атаки при замахе 2.0 c), справа — конвейер. Раньше силу
// атаки давала заточка; теперь её даёт сила с вещей, но нормализация — та же.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, emptyEquipment, type GameState } from './state'
import { ensureStats } from './stats'
import { createRng } from './rng'
import {
  attackPowerContribution,
  critFactor,
  estimateCombatRate,
  expectedSwingDamage,
  rollMonsterDamage,
  rollSwing,
  swingDamageRange,
} from './combat'
import { AP_NORMALIZATION, UNARMED } from '../data/balance'

// Голый герой: стартовый комплект снят. Эти тесты про КОНВЕЙЕР и формулы,
// а не про то, во что игра одевает новобранца, — база должна быть чистой,
// иначе они мерили бы ещё и стартовые вещи.
function bareHero(seed = 1): GameState {
  return ensureStats({
    ...createInitialState(seed),
    equipment: emptyEquipment(),
    statsDirty: true,
  })
}


// Герой с N порциями по +14 силы атаки на талисмане — прежде это была заточка.
function withUpgrades(count: number): GameState {
  const base = bareHero(1)
  return ensureStats({
    ...base,
    equipment: {
      ...base.equipment,
      trinket: {
        id: 'ap-trinket',
        name: 'ap',
        rarity: 'common',
        slot: 'trinket',
        level: 1,
        mods:
          count > 0
            ? [
                {
                  stat: 'attackPower',
                  kind: 'flat',
                  value: new Decimal(14 * count),
                  source: 'equipment:trinket',
                },
              ]
            : [],
      },
    },
    statsDirty: true,
  })
}

// Эталонная модель: урон удара = 20 + 2*порций, замах 2.0 c.
function legacyDpsWithoutCrit(upgrades: number): number {
  return (20 + 2 * upgrades) / 2.0
}

describe('миграция модели урона: эффективный dps сохранён', () => {
  it.each([0, 1, 5, 20, 100])(
    'при %i порциях средний урон в секунду совпадает с эталонной моделью (в пределах 1%)',
    (upgrades) => {
      const s = withUpgrades(upgrades)
      const newDps = expectedSwingDamage(s.stats).div(s.stats.swingTime).toNumber()
      const oldDps = legacyDpsWithoutCrit(upgrades)
      expect(Math.abs(newDps - oldDps) / oldDps).toBeLessThanOrEqual(0.01)
    },
  )

  it('совпадение точное, а не «в пределах допуска»', () => {
    // 8..12 (среднее 10) + 70 * 2.0 / 14 = 10 -> ровно 20 за удар, как раньше.
    expect(expectedSwingDamage(withUpgrades(0).stats).toNumber()).toBe(20)
    // Каждые +14 силы атаки * 2.0 / 14 = ровно +2 за удар.
    expect(expectedSwingDamage(withUpgrades(1).stats).toNumber()).toBe(22)
    expect(expectedSwingDamage(withUpgrades(20).stats).toNumber()).toBe(60)
  })

  it('estimateCombatRate использует ту же формулу (dps с матожиданием критов)', () => {
    const s = withUpgrades(3)
    const expected = expectedSwingDamage(s.stats)
      .times(critFactor(s.stats))
      .div(s.stats.swingTime)
    expect(estimateCombatRate(s).autoDamagePerSecond.eq(expected)).toBe(true)
  })
})

describe('формула удара', () => {
  it('вклад силы атаки считается по БАЗОВОЙ weaponSpeed, а не по ускоренному замахе', () => {
    // Ускорение вдвое: замах падает с 2.0 до 1.0, но вклад силы атаки за удар
    // остаётся прежним — иначе haste не повышал бы урон в секунду вовсе.
    const base = withUpgrades(0)
    const hasted = ensureStats({
      ...base,
      stats: { ...base.stats, haste: 1, swingTime: 1 },
      statsDirty: false,
    })
    expect(attackPowerContribution(hasted.stats).eq(attackPowerContribution(base.stats))).toBe(true)
    // Урон в секунду от ускорения ровно удваивается.
    const dpsBase = expectedSwingDamage(base.stats).div(base.stats.swingTime).toNumber()
    const dpsHasted = expectedSwingDamage(hasted.stats).div(hasted.stats.swingTime).toNumber()
    expect(dpsHasted).toBeCloseTo(dpsBase * 2, 9)
  })

  it('медленное оружие компенсируется большим вкладом силы атаки', () => {
    const fast = withUpgrades(0)
    const slow = ensureStats({
      ...fast,
      stats: { ...fast.stats, weaponSpeed: 4, swingTime: 4 },
      statsDirty: false,
    })
    // Вклад силы атаки за удар вдвое больше при вдвое более медленном оружии.
    expect(attackPowerContribution(slow.stats).toNumber()).toBe(
      attackPowerContribution(fast.stats).toNumber() * 2,
    )
    // Формула нормализации: 14 силы атаки = +1 урона в секунду при любой скорости.
    const apDpsFast = fast.stats.attackPower.div(AP_NORMALIZATION).toNumber()
    const apDpsSlow = slow.stats.attackPower.div(AP_NORMALIZATION).toNumber()
    expect(apDpsFast).toBe(apDpsSlow)
  })

  it('бросок урона лежит в диапазоне и использует rng из game/rng.ts', () => {
    const s = withUpgrades(0)
    const { min, max } = swingDamageRange(s.stats)
    const rng = createRng(42)
    for (let i = 0; i < 200; i++) {
      const { amount, isCrit } = rollSwing(s.stats, rng)
      const base = isCrit ? amount.div(s.stats.critMultiplier) : amount
      expect(base.gte(min)).toBe(true)
      expect(base.lte(max)).toBe(true)
    }
  })

  it('одинаковый сид даёт одинаковую последовательность ударов', () => {
    const s = withUpgrades(0)
    const a = createRng(7)
    const b = createRng(7)
    for (let i = 0; i < 20; i++) {
      expect(rollSwing(s.stats, a).amount.toString()).toBe(rollSwing(s.stats, b).amount.toString())
    }
  })

  it('безоружные значения берутся из data/balance', () => {
    const stats = withUpgrades(0).stats
    expect(stats.weaponDamageMin.eq(UNARMED.weaponDamageMin)).toBe(true)
    expect(stats.weaponDamageMax.eq(UNARMED.weaponDamageMax)).toBe(true)
    expect(stats.weaponSpeed).toBe(UNARMED.weaponSpeed.toNumber())
  })
})

describe('урон мобов диапазоном', () => {
  it('min = max не расходует rng (поток бросков не сдвигается)', () => {
    const rng = createRng(99)
    const first = rng()
    const rngB = createRng(99)
    const s = withUpgrades(0)
    const monster = { ...s.monster, damageMin: new Decimal(4), damageMax: new Decimal(4) }
    // Бросок урона моба с равными границами не должен трогать поток.
    expect(rollMonsterDamage(monster, s.stats, rngB).toNumber()).toBe(4)
    expect(rngB()).toBe(first)
  })
})
