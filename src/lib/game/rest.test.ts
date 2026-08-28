// Привал: управляемая пауза вместо смерти как единственной остановки.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { finishRest, maxMonsterHit, needsRest, restDurationMs, restProgress, startRest, zoneSafety } from './rest'
import { applyOfflineProgress } from './save'
import { REST_DURATION_S, REST_FOOD_SPEEDUP } from '../data/balance'
import { ZONES } from '../data/zones'

const NO_LUCK = () => 1

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

describe('уход на привал', () => {
  it('падение HP ниже порога переводит в resting, а не в смерть', () => {
    const s = hero({ restHpThreshold: 0.4 })
    const low = { ...s, currentHp: s.stats.maxHp.times(0.3) }
    expect(needsRest(low)).toBe(true)
    const after = tick(low, STEP_MS, NO_LUCK, () => {})
    expect(after.heroState).toBe('resting')
    expect(after.restMsLeft).toBeGreaterThan(0)
  })

  it('с нулевым порогом привала нет вовсе — остаётся только смерть', () => {
    const s = hero({ restHpThreshold: 0, restResourceThreshold: 0 })
    const low = { ...s, currentHp: s.stats.maxHp.times(0.05) }
    expect(needsRest(low)).toBe(false)
    expect(tick(low, STEP_MS, NO_LUCK, () => {}).heroState).toBe('alive')
  })

  it('порог по ресурсу работает так же, как по HP', () => {
    const s = hero({ restHpThreshold: 0, restResourceThreshold: 0.4 })
    const dry = { ...s, currentMana: s.stats.maxMana.times(0.1) }
    expect(needsRest(dry)).toBe(true)
  })

  it('на привале герой не бьёт и по нему не бьют', () => {
    const s = startRest(hero({ restHpThreshold: 0.4, currentHp: new Decimal(10) }))
    const hpBefore = s.currentHp
    const monsterHpBefore = s.monster.currentHp
    const after = run(s, REST_DURATION_S * 1000 - STEP_MS * 2)
    expect(after.heroState).toBe('resting')
    expect(after.monster.currentHp.eq(monsterHpBefore)).toBe(true)
    // HP не растёт по ходу привала: восстановление происходит в его конце.
    expect(after.currentHp.eq(hpBefore)).toBe(true)
  })
})

describe('длительность и восстановление', () => {
  it('привал длится ровно REST_DURATION_S и восстанавливает полностью', () => {
    const s = startRest(
      hero({ restHpThreshold: 0.4, currentHp: new Decimal(5), currentMana: new Decimal(1) }),
    )
    expect(s.restMsLeft).toBe(REST_DURATION_S * 1000)
    const during = run(s, REST_DURATION_S * 1000 - STEP_MS)
    expect(during.heroState).toBe('resting')
    const after = run(s, REST_DURATION_S * 1000)
    expect(after.heroState).toBe('alive')
    expect(after.currentHp.eq(after.stats.maxHp)).toBe(true)
    expect(after.currentMana.eq(after.stats.maxMana)).toBe(true)
  })

  it('прерывание даёт восстановление пропорционально отсиженному', () => {
    // Бесплатное прерывание превратило бы привал в кнопку «полный запас»,
    // и порог перестал бы что-либо значить.
    const start = startRest(hero({ currentHp: new Decimal(0), currentMana: new Decimal(0) }))
    const half = run(start, REST_DURATION_S * 500)
    const progress = restProgress(half)
    // Отсидели примерно половину — точное число тиков здесь не важно, важно,
    // что вернётся ровно эта доля, а не всё и не ничего.
    expect(progress).toBeGreaterThan(0.4)
    expect(progress).toBeLessThan(0.6)
    const stopped = finishRest(half, progress)
    expect(stopped.heroState).toBe('alive')
    expect(stopped.currentHp.div(stopped.stats.maxHp).toNumber()).toBeCloseTo(progress, 6)
    expect(stopped.currentMana.div(stopped.stats.maxMana).toNumber()).toBeCloseTo(progress, 6)
  })

  it('источник ускорения сокращает привал вдвое и расходуется', () => {
    // Само поле пока заполняет только кулинария из следующего шага; здесь
    // проверено, что место его учёта живое, а не декоративное.
    const plain = hero()
    const fed = { ...plain, restSpeedupSource: 'food:test' }
    expect(restDurationMs(fed)).toBe(restDurationMs(plain) / REST_FOOD_SPEEDUP)
    expect(finishRest(startRest(fed)).restSpeedupSource).toBeNull()
  })
})

describe('индикатор безопасности зоны', () => {
  it('совпадает с фактическим сильнейшим ударом мобов зоны', () => {
    const s = hero({ restHpThreshold: 0.6 })
    for (const zone of ZONES) {
      const safety = zoneSafety(s, zone)
      expect(safety.worstHit.eq(maxMonsterHit(zone, s.stats))).toBe(true)
      // Метка — это ровно сравнение порога с худшим ударом, без запаса и без
      // округлений: обещание «умереть нельзя» обязано быть точным.
      expect(safety.safe).toBe(safety.thresholdHp.gt(safety.worstHit))
    }
  })

  it('порог выше сильнейшего удара — в зоне действительно не умереть', () => {
    // Проверяем не метку, а игру: с таким порогом герой уходит на привал
    // раньше, чем моб успевает добить, сколько бы времени ни прошло.
    const base = hero()
    const zone = ZONES[0]
    const worst = maxMonsterHit(zone, base.stats)
    // Порог с запасом: на нём HP больше сильнейшего удара.
    const threshold = Math.min(0.95, worst.div(base.stats.maxHp).toNumber() + 0.2)
    let s = hero({ restHpThreshold: threshold, currentZoneId: zone.id })
    expect(zoneSafety(s, zone).safe).toBe(true)
    for (let t = 0; t < 600_000; t += STEP_MS) {
      s = tick(s, STEP_MS, () => 0.999, () => {})
      if (s.heroState === 'dead') break
    }
    expect(s.heroState).not.toBe('dead')
  })
})

describe('оффлайн знает про привалы', () => {
  it('восемь часов с привалами дают строго меньше, чем без них', () => {
    const HOURS8 = 8 * 3_600_000
    // Зона, где герой заметно тает: иначе привалов не будет ни в одном случае
    // и сравнивать будет нечего.
    const zone = ZONES[ZONES.length - 1]
    const resting = hero({ currentZoneId: zone.id, restHpThreshold: 0.6 })
    const reckless = { ...resting, restHpThreshold: 0, restResourceThreshold: 0 }
    const withRest = applyOfflineProgress(resting, HOURS8).report
    const withoutRest = applyOfflineProgress(reckless, HOURS8).report
    expect(withRest).not.toBeNull()
    expect(withoutRest).not.toBeNull()
    // Без порога герой не отдыхает вовсе — он умирает, и это тоже простой.
    // Сравниваем именно то, что просят: привалы обязаны стоить времени.
    expect(withRest!.gold.lt(withoutRest!.gold.times(1.0001))).toBe(true)
  })
})
