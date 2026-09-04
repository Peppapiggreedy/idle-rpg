// Правило задержки регенерации — прямой перенос «правила пяти секунд».
//
// Смысл правила не в том, чтобы отнять ману, а в том, чтобы настройка
// автокаста стала решением: жмёшь каждый раз — не восстанавливаешься вовсе,
// оставляешь окна — бьёшь реже, но дольше. Проверяем обе половины.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, rotationOf, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { resetsRegenDelay, useAbility } from './abilities'
import { estimateCombatRate } from './combat'
import { rotationRate, PLAN } from './rotation'
import { REGEN_DELAY_S, REGEN_TICK_S } from '../data/balance'
import { ABILITY_BY_ID } from '../data/abilities'

const NO_LUCK = () => 1
const QUICK = ABILITY_BY_ID['quick-strike']
const BLOW = ABILITY_BY_ID['shattering-blow']

function hero(patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1),
    abilitySettings: manualOnlySettings(),
    statsDirty: true,
    ...patch,
  })
}

function run(state: GameState, ms: number): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, NO_LUCK, () => {})
  return state
}

describe('задержка регенерации маны', () => {
  it('после траты реген не идёт REGEN_DELAY_S секунд', () => {
    const spent = useAbility(hero({ currentMana: new Decimal(20) }), QUICK.id, NO_LUCK, () => {})
    expect(spent.regenDelayMsLeft).toBe(REGEN_DELAY_S * 1000)
    const manaAfterCast = spent.currentMana

    // Почти вся пауза прошла — мана не сдвинулась ни на единицу.
    const waiting = run(spent, REGEN_DELAY_S * 1000 - STEP_MS)
    expect(waiting.currentMana.eq(manaAfterCast)).toBe(true)

    // Пауза плюс полный интервал порции — мана выросла.
    const after = run(spent, (REGEN_DELAY_S + REGEN_TICK_S) * 1000)
    expect(after.currentMana.gt(manaAfterCast)).toBe(true)
  })

  it('мана приходит порциями раз в REGEN_TICK_S, а не каждым шагом', () => {
    // Ровный ручеёк было бы не отличить от отсутствия правила: важна именно
    // порционность — придержал умение на лишний тик, получил порцию.
    let s = hero({ currentMana: new Decimal(0), regenDelayMsLeft: 0 })
    const seen = new Set<string>()
    // Две порции, а не три: третья упёрлась бы в кап запаса, и тест мерил бы
    // потолок маны вместо порционности.
    for (let t = 0; t < REGEN_TICK_S * 2000; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, () => {})
      seen.add(s.currentMana.toFixed(3))
    }
    // За два интервала мана принимает считаное число разных значений
    // (по одному на порцию), а не новое на каждом из двадцати шагов.
    expect(seen.size).toBeLessThanOrEqual(3)
    const step = s.stats.manaRegen.times(REGEN_TICK_S)
    expect(s.currentMana.toNumber()).toBeCloseTo(step.times(2).toNumber(), 6)
  })

  it('умение без стоимости маны таймер НЕ сбрасывает', () => {
    // Правило живёт в одном предикате, его и проверяем: платное умение паузу
    // взводит, бесплатное — нет. Иначе бесплатная кнопка молча выключала бы
    // восстановление, и правило стало бы ловушкой вместо решения.
    expect(resetsRegenDelay(QUICK)).toBe(true)
    expect(resetsRegenDelay({ ...QUICK, manaCost: new Decimal(0) })).toBe(false)
    // И проводка на месте: платное умение действительно взводит паузу.
    const spent = useAbility(hero({ currentMana: new Decimal(20) }), QUICK.id, NO_LUCK, () => {})
    expect(spent.regenDelayMsLeft).toBe(REGEN_DELAY_S * 1000)
  })

  it('пауза не копится: вторая трата подряд взводит её заново, а не вдвое', () => {
    let s = useAbility(hero({ currentMana: new Decimal(60) }), QUICK.id, NO_LUCK, () => {})
    s = run(s, 1000)
    expect(s.regenDelayMsLeft).toBe(REGEN_DELAY_S * 1000 - 1000)
    // Снимаем кулдаун И глобальный кулдаун: проверяем поведение паузы, а не
    // доступность кнопки.
    s = useAbility({ ...s, abilityCooldownsMs: {}, abilityCharges: {}, gcdMsLeft: 0 }, QUICK.id, NO_LUCK, () => {})
    expect(s.regenDelayMsLeft).toBe(REGEN_DELAY_S * 1000)
  })
})

describe('резерв маны — рычаг «урон против автономности»', () => {
  const withReserve = (reserve: number): GameState =>
    hero({
      abilitySettings: {
        ...manualOnlySettings(),
        [QUICK.id]: { autocast: true, reserve },
        [BLOW.id]: { autocast: true, reserve },
      },
    })

  it('автокаст с резервом 30% не опускает ману ниже 30%', () => {
    let s = withReserve(0.3)
    const floor = s.stats.maxMana.times(0.3)
    let worst = s.currentMana
    for (let t = 0; t < 120_000; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, () => {})
      if (s.currentMana.lt(worst)) worst = s.currentMana
    }
    expect(worst.gte(floor)).toBe(true)
  })

  it('без резерва автокаст выжимает запас до дна', () => {
    // Это и есть вторая половина компромисса: нулевой резерв даёт больше
    // урона сейчас и ноль автономности потом.
    let s = withReserve(0)
    let worst = s.currentMana
    for (let t = 0; t < 120_000; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, () => {})
      if (s.currentMana.lt(worst)) worst = s.currentMana
    }
    expect(worst.lt(s.stats.maxMana.times(0.3))).toBe(true)
  })

  it('резерв стоит урона — и модель это признаёт', () => {
    // Резерв укорачивает всплеск, а фиксированная пауза платится за каждый:
    // чем выше резерв, тем чаще пауза и тем ниже урон. Если бы модель этого
    // не видела, настройка была бы бесплатной, а значит и не решением.
    const greedy = estimateCombatRate(withReserve(0)).damagePerSecond
    const careful = estimateCombatRate(withReserve(0.6)).damagePerSecond
    expect(careful.lt(greedy)).toBe(true)
  })
})

describe('модель знает про правило', () => {
  it('без правила ротация была бы быстрее — значит модель его учитывает', () => {
    // Косвенно, но надёжно: темп ротации обязан быть НИЖЕ того, что позволяют
    // одни кулдауны. Если сравнять — значит модель считает ману бесплатной.
    const s = hero({
      abilitySettings: {
        ...manualOnlySettings(),
        [QUICK.id]: { autocast: true, reserve: 0 },
      },
    })
    const rate = rotationRate(s.stats, rotationOf(s), PLAN.auto)
    const cast = rate.casts.find((c) => c.ability.id === QUICK.id)!
    const cooldownLimited = 1 / QUICK.cooldownSec
    expect(cast.castsPerSecond).toBeLessThan(cooldownLimited)
    expect(cast.castsPerSecond).toBeGreaterThan(0)
  })

  it('чем больше запас маны, тем выше доля боевого времени', () => {
    // Пауза платится один раз за всплеск: чем глубже запас, тем реже.
    const small = hero({
      abilitySettings: {
        ...manualOnlySettings(),
        [QUICK.id]: { autocast: true, reserve: 0 },
      },
    })
    const big = ensureStats({
      ...small,
      // Прибавку даём источником (уровень), а не правкой статов: конвейер сам пересчитает.
      level: new Decimal(40),
      statsDirty: true,
    })
    const rateSmall = rotationRate(small.stats, rotationOf(small), PLAN.auto)
    const rateBig = rotationRate(big.stats, rotationOf(big), PLAN.auto)
    const share = (r: ReturnType<typeof rotationRate>) =>
      r.casts.find((c) => c.ability.id === QUICK.id)!.castsPerSecond
    expect(share(rateBig)).toBeGreaterThan(share(rateSmall))
  })
})
