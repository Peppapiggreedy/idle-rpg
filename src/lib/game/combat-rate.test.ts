import { describe, expect, it } from 'vitest'
import { estimateCombatRate } from './combat'
import { createInitialState } from './state'
import { tick } from './tick'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { applyOfflineProgress } from './save'

describe('estimateCombatRate', () => {
  it('считает урон в секунду с матожиданием критов', () => {
    const rate = estimateCombatRate(createInitialState(1))
    // 20 за удар * (1 + 0.05 * (2 - 1)) / 2 c = 10.5
    expect(rate.damagePerSecond.toNumber()).toBeCloseTo(10.5, 10)
    // Идеальный цикл: 2 удара * 2 c + 0.3 c респаун = 4.3 c на моба.
    // Хлюпень бьёт в ответ: 2 удара по 4 за бой против 7 регена за цикл ->
    // теряем 1 hp за 4.3 c, смерть через 430 c, uptime = 430/(430+30).
    const uptime = 430 / 460
    expect(rate.uptime).toBeCloseTo(uptime, 10)
    expect(rate.killsPerSecond.toNumber()).toBeCloseTo((1 / 4.3) * uptime, 10)
  })

  it('награда за час оффлайна отличается от часа симуляции не более чем на 5%', () => {
    const HOUR_MS = 3_600_000
    // Реальная симуляция часа с фиксированным сидом.
    const rng = createRng(777)
    let sim = createInitialState(777)
    for (let t = 0; t < HOUR_MS; t += STEP_MS) sim = tick(sim, STEP_MS, rng, () => {})
    const simKills = sim.gold.div(sim.monster.goldReward).toNumber()

    // Оффлайн-агрегат за тот же час (та же estimateCombatRate, что в онлайне).
    const { report } = applyOfflineProgress(createInitialState(777), HOUR_MS)
    const offlineKills = report!.kills.toNumber()

    const relDiff = Math.abs(offlineKills - simKills) / simKills
    expect(relDiff).toBeLessThanOrEqual(0.05)
  })
})
