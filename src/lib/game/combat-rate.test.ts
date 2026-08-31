import { describe, expect, it } from 'vitest'
import { estimateCombatRate } from './combat'
import { createInitialState, manualOnlySettings, monsterFromTemplate } from './state'
import { COMMON, buildMonster } from '../data/monsters'
import { ABILITY_BY_ID } from '../data/abilities'
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
      // РАЗНИЦА В ОДИН УРОВЕНЬ ЗАКОННА, и это следствие того же бюджета в 15%:
      // граница уровня иногда попадает внутрь него, и агрегат оказывается по
      // одну её сторону, а тик — по другую. Требовать точного совпадения
      // значило бы требовать от агрегата совпадения с точностью до убийства,
      // которой у него нет по построению.
      expect(
        Math.abs(state.level.toNumber() - sim.level.toNumber()),
        `сид ${seed}`,
      ).toBeLessThanOrEqual(1)
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
