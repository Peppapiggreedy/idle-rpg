import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import {
  createInitialState,
  defaultAbilitySettings,
  manualOnlySettings,
  tick,
  type GameState,
} from './tick'
import { ensureStats } from './stats'
import { autocastCandidates, autocastStep, passesReserve } from './abilities'
import { estimateCombatRate } from './combat'
import { abilitiesByPriority, rotationRate, PLAN } from './rotation'
import { applyOfflineProgress } from './save'
import { stateInZone, zoneRate } from './zones'
import {
  AUTOCAST_DELAY_MS,
  AUTOCAST_MAX_LOSS,
  OFFLINE_CHUNK_MIN,
  OFFLINE_EFFICIENCY,
} from '../data/balance'
import { ABILITY_BY_ID } from '../data/abilities'
import { ZONES } from '../data/zones'
import { averageGear } from './simulate'

const NO_LUCK = () => 1
const QUICK = ABILITY_BY_ID['quick-strike']
const WOUND = ABILITY_BY_ID['rending-wound']
const BLOW = ABILITY_BY_ID['shattering-blow']

function hero(level: number, gearLevel = 1, patch: Partial<GameState> = {}): GameState {
  const base = ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    equipment: averageGear(gearLevel),
    statsDirty: true,
    ...patch,
  })
  // Герой ПОЛНЫЙ, если тест не сказал иначе: с шестого уровня у Стража есть
  // лечение, и на просевшем здоровье автокаст сперва лечится, а на тонкой
  // мане бережёт цену лечения — эти правила проверяет heal.test.ts, а здесь
  // они бы подменяли собой выбор умения.
  return {
    ...base,
    currentHp: patch.currentHp ?? base.stats.maxHp,
    currentMana: patch.currentMana ?? base.stats.maxMana,
  }
}

function run(state: GameState, ms: number, rng = NO_LUCK): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, rng, () => {})
  return state
}

describe('выбор умения автокастом', () => {
  it('берёт первое доступное по приоритету', () => {
    const s = hero(10)
    expect(autocastCandidates(s)[0].id).toBe(abilitiesByPriority(s.abilitySettings, true)[0].id)
    // Переставили приоритеты — сменился и выбор.
    const flipped: GameState = {
      ...s,
      abilitySettings: {
        ...s.abilitySettings,
        [QUICK.id]: { ...s.abilitySettings[QUICK.id], autocast: true, priority: 9 },
        [BLOW.id]: { ...s.abilitySettings[BLOW.id], autocast: true, priority: 0 },
      },
    }
    expect(autocastCandidates(flipped)[0].id).toBe(BLOW.id)
  })

  it('умение без галки автокаст не берёт', () => {
    const s = hero(10, 0, {
      abilitySettings: {
        ...defaultAbilitySettings(),
        [QUICK.id]: { autocast: false, priority: 0, reserve: 0 },
      },
    })
    expect(autocastCandidates(s).map((a) => a.id)).not.toContain(QUICK.id)
  })

  it('не берёт умение без маны и на кулдауне', () => {
    const poor = hero(10, 0, { currentMana: new Decimal(0) })
    expect(autocastCandidates(poor)).toEqual([])
    const onCooldown = hero(10, 0, {
      abilityCooldownsMs: Object.fromEntries(
        [QUICK, WOUND, BLOW].map((a) => [a.id, a.cooldownSec * 1000]),
      ),
    })
    expect(autocastCandidates(onCooldown)).toEqual([])
  })

  it('со снятыми галками автокаст молчит', () => {
    const s = hero(10, 0, { abilitySettings: manualOnlySettings() })
    const after = run(s, 30_000)
    expect(after.combatLog.some((e) => e.type === 'ability')).toBe(false)
  })
})

describe('задержка реакции', () => {
  it('умение применяется не раньше autocastDelay после того, как стало доступно', () => {
    const s = hero(10)
    // Чуть-чуть не дотерпели — ещё не бьёт.
    const early = autocastStep(s, AUTOCAST_DELAY_MS - 1, createRng(1), () => {})
    expect(early.combatLog.some((e) => e.type === 'ability')).toBe(false)
    // Полная задержка — бьёт.
    const fired = autocastStep(s, AUTOCAST_DELAY_MS, createRng(1), () => {})
    expect(fired.combatLog.some((e) => e.type === 'ability')).toBe(true)
  })

  it('таймер взводится заново, пока умение недоступно', () => {
    const poor = hero(10, 0, { currentMana: new Decimal(0) })
    const waited = autocastStep(poor, 5000, createRng(1), () => {})
    expect(waited.autocastReadyMs[QUICK.id]).toBe(AUTOCAST_DELAY_MS)
    // Мана появилась — отсчёт начинается с нуля, а не «задним числом».
    const rich = { ...waited, currentMana: new Decimal(500) }
    const tooEarly = autocastStep(rich, AUTOCAST_DELAY_MS - 1, createRng(1), () => {})
    expect(tooEarly.combatLog.some((e) => e.type === 'ability')).toBe(false)
  })

  it('мёртвый герой не кастует, таймеры сброшены', () => {
    const dead = hero(10, 0, { heroState: 'dead', reviveMsLeft: 5000 })
    const after = autocastStep(dead, 10_000, createRng(1), () => {})
    expect(after.combatLog.some((e) => e.type === 'ability')).toBe(false)
    expect(after.autocastReadyMs).toEqual({})
  })
})

describe('автокаст в бою', () => {
  it('герой сам применяет умения и тратит на них ману', () => {
    // Считаем по шине, а не по хвосту лога: лог хранит последние COMBAT_LOG_SIZE
    // событий, и при пустой мане в конце окна там одни автоатаки.
    let casts = 0
    let s = hero(10)
    for (let t = 0; t < 20_000; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, (e) => {
        if (e.abilityId !== null) casts += 1
      })
    }
    expect(casts).toBeGreaterThan(0)
    expect(s.currentMana.lt(s.stats.maxMana)).toBe(true)
  })

  it('автокаст не придерживает кулдауны: жмёт, как только маны хватило', () => {
    // Проверяем МЕХАНИЗМ, а не число применений: с правилом задержки регена
    // темп упирается в ману, а не в кулдаун, и «сколько раз за минуту» стало
    // мерить экономику, а не выдержку автокаста.
    //
    // Утверждение то же самое: автокаст не выжидает удобного момента. Значит
    // между «маны стало достаточно» и «умение ушло в дело» проходит ровно
    // задержка реакции плюс шаг симуляции, и не больше.
    let s = hero(10, 0, { currentMana: new Decimal(0) })
    let readySince: number | null = null
    let worstWaitMs = 0
    let fired = 0
    for (let t = 0; t < 60_000; t += STEP_MS) {
      // «Доступно» — это ВСЕ условия применения сразу: мана, свой кулдаун,
      // глобальный кулдаун и живой герой не на привале. Без глобального
      // кулдауна тест мерил бы очередь умений, а не выдержку автокаста.
      // Мана — с учётом резерва под лечение: «беречь ману на лечение»
      // включено по умолчанию, и автокаст по правилу не жмёт удар, после
      // которого не останется на одно лечение. Это не выдержка, а правило.
      const affordable =
        passesReserve(s, QUICK) &&
        s.currentMana.gte(QUICK.manaCost) &&
        (s.abilityCooldownsMs[QUICK.id] ?? 0) <= 0 &&
        s.gcdMsLeft <= 0 &&
        s.heroState === 'alive' &&
        s.respawnMsLeft <= 0
      if (affordable && readySince === null) readySince = t
      s = tick(s, STEP_MS, NO_LUCK, (e) => {
        if (e.abilityId === QUICK.id) {
          if (readySince !== null) worstWaitMs = Math.max(worstWaitMs, t - readySince)
          readySince = null
          fired += 1
        }
      })
      if (!affordable) readySince = null
    }
    expect(fired, 'умение не применялось ни разу').toBeGreaterThan(0)
    expect(worstWaitMs).toBeLessThanOrEqual(AUTOCAST_DELAY_MS + STEP_MS)
  })
})

describe('честная разница авто и ручной игры', () => {
  const cases: GameState[] = []
  for (const level of [1, 4, 9, 16, 30]) {
    for (const gearLevel of [1, 8, 33, 93]) {
      for (const zone of ZONES) cases.push(stateInZone(hero(level, gearLevel), zone))
    }
  }

  it('авто НИКОГДА не выгоднее ручной игры', () => {
    for (const s of cases) {
      const auto = estimateCombatRate(s, 'auto')
      const manual = estimateCombatRate(s, 'manual')
      const where = `${s.currentZoneId} hp=${s.monster.maxHp.toFixed(0)} ур=${s.level}`
      expect(
        auto.damagePerSecond.lte(manual.damagePerSecond),
        `dps ${where}: авто ${auto.damagePerSecond.toFixed(2)} > рука ${manual.damagePerSecond.toFixed(2)}`,
      ).toBe(true)
      expect(
        auto.killsPerSecond.lte(manual.killsPerSecond),
        `убийств ${where}: авто ${auto.killsPerSecond.toFixed(4)} > рука ${manual.killsPerSecond.toFixed(4)}`,
      ).toBe(true)
    }
  })

  it('отставание авто не превышает объявленного потолка', () => {
    for (const s of cases) {
      const auto = estimateCombatRate(s, 'auto').damagePerSecond
      const manual = estimateCombatRate(s, 'manual').damagePerSecond
      const gap = 1 - auto.div(manual).toNumber()
      expect(gap).toBeGreaterThanOrEqual(0)
      expect(gap).toBeLessThanOrEqual(AUTOCAST_MAX_LOSS + 1e-9)
    }
  })

  it('разница берётся из задержки реакции, а не из множителя', () => {
    // Обнулим задержку в модели, подставив ручной режим той же ротации:
    // без задержки и перебоя авто и рука совпадают до знака.
    //
    // Умение здесь ОДНО и с длинным кулдауном намеренно. С правилом задержки
    // регена частая ротация упирается в ману, обе руки садятся на один и тот
    // же равновесный темп, и разницы в цикле не остаётся вовсе — задержка
    // реакции видна только там, где ограничивает кулдаун, а не ресурс.
    // Это следствие правила, а не поблажка: см. REGEN_DELAY_S в balance.ts.
    const onlyBlow = {
      ...manualOnlySettings(),
      [BLOW.id]: { autocast: true, priority: 0, reserve: 0 },
    }
    const s = stateInZone(hero(16, 120, { abilitySettings: onlyBlow }), ZONES[2])
    const auto = rotationRate(s.stats, s.abilitySettings, PLAN.auto)
    const manual = rotationRate(s.stats, s.abilitySettings, PLAN.autocastByHand)
    for (const cast of auto.casts) {
      const same = manual.casts.find((c) => c.ability.id === cast.ability.id)!
      // Урон одного каста одинаков: множителя на авто нет, отличается ТЕМП.
      expect(cast.hitDamage.eq(same.hitDamage)).toBe(true)
      const cycleAuto = 1 / cast.castsPerSecond
      const cycleManual = 1 / same.castsPerSecond
      expect(cycleAuto - cycleManual).toBeCloseTo(AUTOCAST_DELAY_MS / 1000, 6)
    }
  })

  it('со снятыми галками авто — это голая автоатака, а рука всё равно сильнее', () => {
    const s = stateInZone(hero(16, 120, { abilitySettings: manualOnlySettings() }), ZONES[1])
    const auto = estimateCombatRate(s, 'auto')
    const manual = estimateCombatRate(s, 'manual')
    // Автокаст выключен — герой сам умений не жмёт совсем.
    expect(auto.abilityDamagePerSecond.eq(0)).toBe(true)
    // А игрок руками умения применить может, и это честно видно в цифрах.
    expect(manual.damagePerSecond.gt(auto.damagePerSecond)).toBe(true)
  })
})

describe('железное правило: оффлайн <= автокаст <= ручная игра', () => {
  it('оффлайн считается по автокасту с поправкой, а не по идеальной игре', () => {
    // Меряем ОДИН шаг агрегата. Внутри шага темп не меняется, поэтому
    // совпадение обязано быть ТОЧНЫМ, а не «в пределах допуска»: за час герой
    // набирает уровни, темп следующих шагов растёт, и сравнивать час с одним
    // снимком статов бессмысленно — раньше это скрывалось широкой вилкой.
    const chunkMs = OFFLINE_CHUNK_MIN * 60_000
    for (const level of [1, 9, 20]) {
      const s = hero(level, level * 8)
      const { report } = applyOfflineProgress(s, chunkMs)
      const auto = zoneRate(s, ZONES[0], 'auto')
      const manual = zoneRate(s, ZONES[0], 'manual')
      expect(auto.goldPerSecond.lte(manual.goldPerSecond)).toBe(true)
      const expected = auto.goldPerSecond.times(chunkMs / 1000).times(OFFLINE_EFFICIENCY)
      expect(report!.gold.toNumber()).toBeCloseTo(expected.toNumber(), 9)
      // И это строго меньше того же шага по идеальной игре.
      expect(report!.gold.lt(manual.goldPerSecond.times(chunkMs / 1000))).toBe(true)
    }
  })

  it('час оффлайна заметно беднее часа реальной игры на автокасте', () => {
    // Разрыв между режимами — то, ради чего игрок держит вкладку открытой.
    // При прежних девяти десятых «зайти вечером» и «играть весь вечер»
    // приносили почти одно и то же, и играть было незачем. Проверяем, что
    // разрыв есть и что он примерно тот, который назван игроку в модалке.
    const HOUR = 3_600_000
    for (const seed of [777, 4242]) {
      const rng = createRng(seed)
      let sim = createInitialState(seed)
      for (let t = 0; t < HOUR; t += STEP_MS) sim = tick(sim, STEP_MS, rng, () => {})
      const { report } = applyOfflineProgress(createInitialState(seed), HOUR)
      const share = report!.gold.div(sim.gold).toNumber()
      expect(share, `сид ${seed}`).toBeLessThan(0.5)
      // И не ноль: оффлайн остаётся осмысленным, иначе его незачем считать.
      expect(share, `сид ${seed}`).toBeGreaterThan(0.05)
    }
    // Час тика плюс оценка в два прохода — под параллельными воркерами быстрого
    // набора тест стоит около пяти секунд; запас, чтобы не падать по таймауту.
  }, 20_000)
})
