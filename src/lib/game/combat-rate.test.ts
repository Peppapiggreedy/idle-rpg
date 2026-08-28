import { describe, expect, it } from 'vitest'
import { estimateCombatRate } from './combat'
import { createInitialState, manualOnlySettings, monsterFromTemplate } from './state'
import { COMMON, buildMonster } from '../data/monsters'
import { Decimal } from './numbers'
import { tick } from './tick'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { applyOfflineProgress } from './save'
import {
  AP_NORMALIZATION,
  OFFLINE_EFFICIENCY,
  RESPAWN_DELAY_MS,
  REVIVE_DELAY_MS,
} from '../data/balance'

describe('estimateCombatRate', () => {
  it('считает урон в секунду с матожиданием критов', () => {
    // Явный моб: спавн в зоне случаен, а формулу проверяем на фиксированных
    // числах. Модель ПЕРЕСОБИРАЕМ здесь по её описанию, а не вызываем те же
    // функции: тест, который зовёт проверяемый код, проверяет только сам себя.
    // Числа моба берём из данных — они часть контракта темпа и меняются вместе
    // с балансом, а вот правила остаются те же.
    const squelcher = buildMonster(
      { id: 'test-squelcher', name: 'Хлюпень', role: COMMON },
      1,
      new Decimal(1),
    )
    const state = {
      // Автокаст выключен: тест про формулу автоатаки и uptime.
      ...createInitialState(1),
      abilitySettings: manualOnlySettings(),
      monster: monsterFromTemplate(squelcher),
    }
    const rate = estimateCombatRate(state)
    const { stats } = state

    // Средний удар: диапазон оружия плюс вклад силы атаки за замах.
    const avgSwing = stats.weaponDamageMin
      .plus(stats.weaponDamageMax)
      .div(2)
      .plus(stats.attackPower.times(stats.weaponSpeed).div(AP_NORMALIZATION))
    // Криты — матожидание, а не бросок. Вероятность в конвейере статов —
    // обычный number, поэтому множитель считается в number.
    const crit = 1 + stats.critChance * (stats.critMultiplier.toNumber() - 1)
    expect(rate.autoDamagePerSecond.toNumber()).toBeCloseTo(
      avgSwing.times(crit).div(stats.swingTime).toNumber(),
      8,
    )

    // Убийство квантуется по ударам: последний почти всегда с перебоем, но
    // не меньше половины замаха.
    const perKill = Decimal.max(
      squelcher.maxHp.div(avgSwing).ceil().times(avgSwing),
      squelcher.maxHp.plus(avgSwing.div(2)),
    )
    const hits = Decimal.max(perKill.div(avgSwing).ceil(), new Decimal(1)).toNumber()
    const fightSec = hits * stats.swingTime
    const cycleSec = fightSec + RESPAWN_DELAY_MS / 1000
    expect(rate.idealKillsPerSecond.toNumber()).toBeCloseTo(1 / cycleSec, 8)

    // Баланс HP за цикл: целое число ответных ударов за ФАЗУ БОЯ против
    // регена (в бою медленный, в паузе респауна быстрый).
    const incoming = squelcher.damageMin
      .plus(squelcher.damageMax)
      .div(2)
      .times(Math.floor(fightSec / squelcher.swingTime))
    const regen = stats.hpRegen
      .times(fightSec)
      .plus(stats.hpRegenOutOfCombat.times(RESPAWN_DELAY_MS / 1000))
    const lossPerSec = incoming.minus(regen).div(cycleSec)
    const timeToDeath = stats.maxHp.div(lossPerSec).toNumber()
    const uptime = timeToDeath / (timeToDeath + REVIVE_DELAY_MS / 1000)
    expect(rate.uptime).toBeCloseTo(uptime, 8)
    expect(rate.killsPerSecond.toNumber()).toBeCloseTo((1 / cycleSec) * uptime, 8)
  })

  // Бюджет расхождения — 8%, и это осознанно. Оффлайн-агрегат усредняет темп
  // по пулу зоны и считает смертность по СРЕДНЕЙ потере HP, тогда как в бою
  // запас HP переносится из схватки в схватку: после мелочи герой входит в
  // здоровяка с другим запасом. Точнее одним агрегатом не выйдет — только
  // проигрыванием тиков. Порог держит модель честной: уедет формула боя или
  // темп зоны — тест упадёт.
  it('награда за час оффлайна отличается от часа симуляции не более чем на 8%', () => {
    const HOUR_MS = 3_600_000
    // Реальная симуляция часа с фиксированным сидом. Автонадевание выключено:
    // оффлайн-агрегат считает по текущим статам и лут в них не подмешивает,
    // поэтому сравниваем именно формулы боя, а не эффект найденной экипировки.
    const rng = createRng(777)
    let sim = { ...createInitialState(777), autoEquip: false }
    for (let t = 0; t < HOUR_MS; t += STEP_MS) sim = tick(sim, STEP_MS, rng, () => {})
    // Сравниваем ЗОЛОТО, а не убийства: в зоне пул из трёх мобов с разной
    // наградой, поэтому «убийства» нельзя восстановить делением на награду.
    const simGold = sim.gold.toNumber()

    // Оффлайн-агрегат за тот же час (та же estimateCombatRate, что в онлайне).
    const { report } = applyOfflineProgress({ ...createInitialState(777), autoEquip: false }, HOUR_MS)
    const offlineGold = report!.gold.toNumber()

    // Оффлайн намеренно режется на OFFLINE_EFFICIENCY (железное правило
    // оффлайн <= автокаст), поэтому сравниваем с уже применённой поправкой.
    const expectedGold = simGold * OFFLINE_EFFICIENCY
    const relDiff = Math.abs(offlineGold - expectedGold) / expectedGold
    expect(relDiff).toBeLessThanOrEqual(0.08)
    expect(offlineGold).toBeLessThan(simGold) // оффлайн НИКОГДА не выгоднее игры
  })
})
