import { describe, expect, it } from 'vitest'
import { estimateCombatRate } from './combat'
import { createInitialState, manualOnlySettings, monsterFromTemplate } from './state'
import { COMMON, buildMonster } from '../data/monsters'
import { Decimal } from './numbers'
import { tick } from './tick'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { applyOfflineProgress } from './save'
import { OFFLINE_EFFICIENCY } from '../data/balance'

describe('estimateCombatRate', () => {
  it('считает урон в секунду с матожиданием критов', () => {
    // Явный моб: спавн в зоне случаен, а формулу проверяем на фиксированных числах.
    // Обычный моб 1 уровня — 30 hp, 4 урона каждые 1.6 c.
    const squelcher = buildMonster(
      { id: 'test-squelcher', name: 'Хлюпень', role: COMMON },
      1,
      new Decimal(1),
    )
    const rate = estimateCombatRate({
      // Автокаст выключен: тест про формулу автоатаки и uptime.
      ...createInitialState(1),
      abilitySettings: manualOnlySettings(),
      monster: monsterFromTemplate(squelcher),
    })
    // 20 за удар * (1 + 0.05 * (2 - 1)) / 2 c = 10.5
    expect(rate.autoDamagePerSecond.toNumber()).toBeCloseTo(10.5, 10)
    // Идеальный цикл: 2 удара * 2 c + 0.3 c респаун = 4.3 c на моба.
    // Хлюпень бьёт в ответ: 2 удара по 4 за бой против 7 регена за цикл ->
    // теряем 1 hp за 4.3 c, смерть через 430 c, uptime = 430/(430+30).
    const uptime = 430 / 460
    expect(rate.uptime).toBeCloseTo(uptime, 10)
    expect(rate.killsPerSecond.toNumber()).toBeCloseTo((1 / 4.3) * uptime, 10)
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
