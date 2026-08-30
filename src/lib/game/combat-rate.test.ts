import { describe, expect, it } from 'vitest'
import { estimateCombatRate } from './combat'
import {
  createInitialState,
  emptyEquipment,
  manualOnlySettings,
  monsterFromTemplate,
  type GameState,
} from './state'
import { ensureStats } from './stats'
import { isUpgrade } from './equipment'
import { sellItem, stashLoot } from './loot'
import { forecastZone, intendedZone } from './zones'
import { buildSimState, referenceBuild } from './simulate'
import type { Item } from '../types'
import { COMMON, buildMonster } from '../data/monsters'
import { ABILITY_BY_ID } from '../data/abilities'
import { Decimal } from './numbers'
import { tick } from './tick'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { applyOfflineProgress } from './save'
import {
  AP_NORMALIZATION,
  INVENTORY_SIZE,
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
    //
    // УДАР ЗДЕСЬ — С КРИТОМ, и это суть находки 1.1: раньше число ударов на
    // убийство считалось по урону БЕЗ крита, поэтому killsPerSecond от крита
    // не зависел вовсе. Крит-предмет показывал «без изменений», а при полной
    // сумке игра его продавала. Модель и её ручная проверка обязаны брать
    // один и тот же удар.
    const avgHit = avgSwing.times(crit)
    const perKill = Decimal.max(
      squelcher.maxHp.div(avgHit).ceil().times(avgHit),
      squelcher.maxHp.plus(avgHit.div(2)),
    )
    const hits = Decimal.max(perKill.div(avgHit).ceil(), new Decimal(1)).toNumber()
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

    // ЦИКЛ ФАРМА СЧИТАЕТСЯ ПО БОЯМ ЦЕЛИКОМ. Привал теперь между схватками,
    // поэтому модель квантует потери боями: сколько боёв герой выдерживает
    // до порога, на каком у него кончается здоровье — и что раньше.
    // Баланс сошёлся в плюс — герой не тает вовсе, и цикл бесконечен.
    if (lossPerSec.lte(0)) {
      expect(rate.uptime).toBe(1)
      expect(rate.killsPerSecond.toNumber()).toBeCloseTo(1 / cycleSec, 8)
      return
    }
    const loss = lossPerSec.times(cycleSec).toNumber()
    const hp = stats.maxHp.toNumber()
    const kDeath = Math.ceil(hp / loss)
    const kRest = Math.floor((hp * (1 - stats.restThreshold)) / loss) + 1
    const dies = kDeath <= kRest
    const kills = dies ? Math.max(0, kDeath - 1) : Math.max(1, kRest)
    const total = dies
      ? kills * cycleSec + cycleSec + REVIVE_DELAY_MS / 1000
      : kills * cycleSec + stats.restDuration
    const uptime = (kills * cycleSec) / total
    expect(rate.uptime).toBeCloseTo(uptime, 8)
    expect(rate.killsPerSecond.toNumber()).toBeCloseTo((1 / cycleSec) * uptime, 8)
  })

  // ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ. Оффлайн — это НЕ «столько же, но со скидкой»:
  // урезается и опыт, поэтому герой оффлайн ещё и растёт медленнее, а с ним
  // медленнее становится и темп. Сложением одного множителя это не
  // описывается — зато описывается ровно так, как сказано игроку в модалке
  // возврата: час оффлайна даёт примерно столько же, сколько
  // OFFLINE_EFFICIENCY часа живой игры. Сравниваем именно с этим.
  //
  // Бюджет расхождения — 15%, и это осознанно: оффлайн-агрегат усредняет
  // темп по пулу зоны и считает смертность по СРЕДНЕЙ потере HP, тогда как
  // в бою запас HP переносится из схватки в схватку. Точнее одним агрегатом
  // не выйдет — только проигрыванием тиков. Порог держит модель честной:
  // уедет формула боя или темп зоны — тест упадёт.
  it('час оффлайна равен OFFLINE_EFFICIENCY часа живой игры', () => {
    const HOUR_MS = 3_600_000
    for (const seed of [777, 4242]) {
      // Живая игра ровно на ту долю часа, которую обещает оффлайн.
      const rng = createRng(seed)
      let sim = createInitialState(seed)
      for (let t = 0; t < HOUR_MS * OFFLINE_EFFICIENCY; t += STEP_MS) {
        sim = tick(sim, STEP_MS, rng, () => {})
      }
      // Сравниваем ЗОЛОТО, а не убийства: в зоне пул из трёх мобов с разной
      // наградой, поэтому «убийства» нельзя восстановить делением на награду.
      const { report, state } = applyOfflineProgress(createInitialState(seed), HOUR_MS)
      const relDiff = Math.abs(report!.gold.toNumber() - sim.gold.toNumber()) / sim.gold.toNumber()
      expect(relDiff, `сид ${seed}`).toBeLessThanOrEqual(0.15)
      // И уровень набирается тот же: урезание касается темпа, а не кривой.
      expect(state.level.toNumber(), `сид ${seed}`).toBe(sim.level.toNumber())
    }
  })

  it('оффлайн НИКОГДА не выгоднее той же живой игры', () => {
    // Железное правило: оффлайн <= автокаст <= ручная игра. Час отсутствия
    // обязан быть беднее часа за экраном — иначе выгоднее закрыть вкладку.
    const HOUR_MS = 3_600_000
    const rng = createRng(777)
    let sim = createInitialState(777)
    for (let t = 0; t < HOUR_MS; t += STEP_MS) sim = tick(sim, STEP_MS, rng, () => {})
    const { report } = applyOfflineProgress(createInitialState(777), HOUR_MS)
    expect(report!.gold.lt(sim.gold)).toBe(true)
  })

  it('запертые уровнем умения в модель темпа не входят', () => {
    const monster = monsterFromTemplate(
      buildMonster({ id: 'test-dummy', name: 'Чучело', role: COMMON }, 1, new Decimal(1)),
    )
    // Герой первого уровня: открыто только первое умение класса.
    const novice = { ...createInitialState(5), monster }
    // Тот же герой, но запертых умений в настройках нет вовсе. Для модели
    // это обязано быть ОДНО И ТО ЖЕ состояние: запертое не жмёт ни автокаст,
    // ни рука, и модель, считающая его урон, завышала бы прогноз и оффлайн.
    const stripped = {
      ...novice,
      abilitySettings: Object.fromEntries(
        Object.entries(novice.abilitySettings).filter(
          ([id]) => ABILITY_BY_ID[id].unlockLevel <= 1,
        ),
      ),
    }
    expect(estimateCombatRate(novice).damagePerSecond.toNumber()).toBeCloseTo(
      estimateCombatRate(stripped).damagePerSecond.toNumber(),
      9,
    )
    expect(estimateCombatRate(novice, 'manual').damagePerSecond.toNumber()).toBeCloseTo(
      estimateCombatRate(stripped, 'manual').damagePerSecond.toNumber(),
      9,
    )
  })
})

// КРИТ ДОХОДИТ ДО ИТОГА БОЯ (находка 1.1 в AUDIT.md).
//
// Число ударов на убийство считалось по урону БЕЗ крита, поэтому
// killsPerSecond от крита не зависел вовсе — а это единственная мера «лучше»
// во всей игре: сравнение предметов, значок «Апгрейд», автопродажа при полной
// сумке, прогноз зоны и оффлайн-агрегат.
//
// Точность оценки проверялась одним тестом на ПЕРВОМ уровне и на природном
// крите — ровно в той точке, где модель откалибрована. Поэтому ошибка и
// дожила до ревизии.
describe('крит виден темпу убийств, а не только урону в секунду', () => {
  const dummy = () =>
    monsterFromTemplate(
      buildMonster({ id: 'test-dummy', name: 'Чучело', role: COMMON }, 1, new Decimal(1)),
    )

  /** Герой с заданным критом; всё остальное неизменно. */
  function withCrit(flat: number): GameState {
    const base = ensureStats({
      ...createInitialState(1),
      equipment: emptyEquipment(),
      monster: dummy(),
      statsDirty: true,
    })
    if (flat === 0) return base
    return ensureStats({
      ...base,
      equipment: {
        ...base.equipment,
        trinket: {
          id: 'crit',
          name: 'талисман',
          rarity: 'common',
          slot: 'trinket',
          level: 1,
          mods: [
            { stat: 'critChance', kind: 'flat', value: new Decimal(flat), source: 'equipment:trinket' },
          ],
        },
      },
      statsDirty: true,
    })
  }

  it('два предмета с равным уроном оружия, но разным критом дают РАЗНЫЙ темп', () => {
    const plain = estimateCombatRate(withCrit(0))
    const critty = estimateCombatRate(withCrit(0.25))
    // Раньше эти два числа совпадали до последнего знака.
    expect(critty.killsPerSecond.gt(plain.killsPerSecond)).toBe(true)
    // И урон оружия при этом тот же: разница именно в крите.
    expect(withCrit(0).stats.weaponDamageMax.eq(withCrit(0.25).stats.weaponDamageMax)).toBe(true)
  })

  it('темп растёт монотонно вместе с критом', () => {
    let prev = new Decimal(0)
    for (const crit of [0, 0.05, 0.1, 0.2, 0.35, 0.5]) {
      const k = estimateCombatRate(withCrit(crit)).killsPerSecond
      expect(k.gte(prev), `крит ${crit}`).toBe(true)
      prev = k
    }
  })

  it('предмет с критом помечается апгрейдом и НЕ продаётся из полной сумки', () => {
    // Худшая половина находки: при полной сумке stashLoot спрашивал ту же
    // оценку, видел «не апгрейд» и продавал вещь за гроши — при том, что
    // рядом в коде написано, что потерять апгрейд из-за полной сумки нельзя.
    const hero = withCrit(0)
    const critItem: Item = {
      id: 'crit-find',
      name: 'талисман крита',
      rarity: 'rare',
      slot: 'trinket',
      level: 1,
      mods: [
        { stat: 'critChance', kind: 'flat', value: new Decimal(0.25), source: 'equipment:trinket' },
      ],
    }
    expect(isUpgrade(hero, critItem)).toBe(true)

    const junk = (i: number): Item => ({
      id: `junk-${i}`,
      name: 'хлам',
      rarity: 'common',
      slot: 'trinket',
      level: 1,
      mods: [],
    })
    const full = {
      ...hero,
      inventory: Array.from({ length: INVENTORY_SIZE }, (_, i) => junk(i)),
    }
    const after = stashLoot(full, critItem)
    expect(after.inventory.some((i) => i.id === 'crit-find')).toBe(true)
    expect(after.inventory.length).toBe(INVENTORY_SIZE)
  })
})

describe('оценка сходится с настоящим прогоном на разных уровнях и критах', () => {
  // Таблица, которой не было. Раньше точность мерилась в одной точке —
  // первый уровень, природный крит, — и ошибка в 28 % жила незамеченной.
  const HOURS = 2
  const SEED = 4242

  function run(state: GameState, hours: number): number {
    const rng = createRng(SEED)
    let s = state
    const frozen = { level: s.level, currentXp: s.currentXp, xpToNext: s.xpToNext }
    let kills = 0
    const steps = Math.round((hours * 3600 * 1000) / STEP_MS)
    for (let i = 0; i < steps; i += 1) {
      const prev = s
      s = tick(prev, STEP_MS, rng)
      if (prev.respawnMsLeft <= 0 && s.respawnMsLeft > 0) kills += 1
      s = { ...s, ...frozen }
      if (s.inventory.length >= INVENTORY_SIZE) s = sellItem(s, s.inventory[0].id)
    }
    return kills / hours
  }

  const cases: Array<[number, string, number]> = [
    [25, 'крит выключен', -1],
    [25, 'крит свой', 0],
    [25, 'крит +25 п.п.', 0.25],
    [55, 'крит выключен', -1],
    [55, 'крит свой', 0],
    [55, 'крит +25 п.п.', 0.25],
    [85, 'крит выключен', -1],
    [85, 'крит свой', 0],
    [85, 'крит +25 п.п.', 0.25],
  ]

  it.each(cases)('уровень %s, %s', (level, _label, critShift) => {
    const zone = intendedZone(level)
    const base = ensureStats({ ...buildSimState(referenceBuild(level), zone.id, SEED), statsDirty: true })
    const shift = critShift === -1 ? -base.stats.critChance : critShift
    const state = ensureStats({
      ...base,
      equipment: {
        ...base.equipment,
        trinket: {
          id: 'probe',
          name: 'проверочный талисман',
          rarity: 'common',
          slot: 'trinket',
          level: 1,
          mods: [
            { stat: 'critChance', kind: 'flat', value: new Decimal(shift), source: 'equipment:trinket' },
          ],
        },
      },
      statsDirty: true,
    })
    const predicted = forecastZone(state, zone).killsPerHour.toNumber()
    const actual = run(state, HOURS)
    const drift = Math.abs(predicted - actual) / actual
    expect(
      drift,
      `прогноз ${predicted.toFixed(1)} против прогона ${actual.toFixed(1)} уб/ч`,
    ).toBeLessThan(0.1)
  }, 120_000)
})
