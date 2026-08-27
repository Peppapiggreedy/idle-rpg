import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { RESPAWN_DELAY_MS, createInitialState, spawnMonster, tick, type GameState } from './tick'
import { applyModifiers } from './stats'
import type { MonsterTemplate } from '../types'

const DUMMY: MonsterTemplate = {
  id: 'training-dummy',
  name: 'Тренировочное чучело',
  maxHp: new Decimal(100),
  goldReward: new Decimal(5),
  xpReward: new Decimal(3),
  damageMin: new Decimal(0), // мирный: не бьёт в ответ, тесты боя героя чистые
  damageMax: new Decimal(0),
  swingTime: 1,
}

// rng = 1 никогда не критует и не дропает лут — тесты детерминированы.
const NO_LUCK = () => 1

// Точный урон за удар задаём base-модификаторами — ровно так, как это будет
// делать оружие: сила атаки 0 и вырожденный диапазон min = max. Бросок урона
// тогда детерминирован и НЕ расходует rng, в потоке остаётся только бросок крита —
// поэтому тесты механики тика не зависят от разброса урона.
function stateWith(damagePerSwing: number, template: MonsterTemplate): GameState {
  const stats = applyModifiers([
    { stat: 'attackPower', kind: 'base', value: new Decimal(0), source: 'test:fixture' },
    { stat: 'weaponDamageMin', kind: 'base', value: new Decimal(damagePerSwing), source: 'test:fixture' },
    { stat: 'weaponDamageMax', kind: 'base', value: new Decimal(damagePerSwing), source: 'test:fixture' },
  ])
  return {
    ...createInitialState(1),
    stats,
    statsDirty: false,
    monster: spawnMonster(template),
    combatLog: [],
  }
}

function run(state: GameState, ms: number, rng: () => number = NO_LUCK): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, rng)
  return state
}

describe('дискретные удары', () => {
  it('удар происходит раз в swingTime, а не каждый тик', () => {
    let s = stateWith(20, DUMMY)
    s = run(s, 1900) // 1.9 c — замах ещё не полный
    expect(s.monster.currentHp.toNumber()).toBe(100)
    s = run(s, 100) // ровно 2.0 c — первый удар
    expect(s.monster.currentHp.toNumber()).toBe(80)
    expect(s.combatLog[0]).toMatchObject({ type: 'hit', isCrit: false })
  })

  it('таймер сбрасывается с переносом остатка: медленный тик не теряет время', () => {
    // Один жирный тик в 2.5 c: удар + 0.5 c уже в замахе следующего.
    let s = stateWith(20, DUMMY)
    s = tick(s, 2500, NO_LUCK)
    expect(s.monster.currentHp.toNumber()).toBe(80)
    expect(s.swingProgress).toBeCloseTo(0.25, 9) // 0.5 c из 2.0 c замаха
    // Ещё 1.5 c — второй удар ровно вовремя (2.0 c после первого).
    s = tick(s, 1500, NO_LUCK)
    expect(s.monster.currentHp.toNumber()).toBe(60)
  })

  it('урон за удар 20 против 100 hp: 5 ударов, одно убийство за 10 секунд', () => {
    let s = stateWith(20, DUMMY)
    s = run(s, 10_000)
    expect(s.gold.toNumber()).toBe(5) // ровно одна награда
    expect(s.currentXp.toNumber()).toBe(3)
    expect(s.monster.currentHp.toNumber()).toBe(0)
    expect(s.respawnMsLeft).toBe(RESPAWN_DELAY_MS)
  })

  it('крит умножает урон и помечается в событии', () => {
    // rng = 0 всегда критует (0 < 0.05).
    let s = stateWith(20, DUMMY)
    s = run(s, 2000, () => 0)
    expect(s.monster.currentHp.toNumber()).toBe(100 - 40) // 20 * critMultiplier 2
    const hit = s.combatLog.find((e) => e.type === 'hit')
    expect(hit).toMatchObject({ isCrit: true })
  })

  it('во время респауна замах стоит: новый моб получает первый удар через полный swingTime', () => {
    let s = stateWith(200, { ...DUMMY, maxHp: new Decimal(100) }) // смерть с одного удара
    s = run(s, 2000) // удар на 2.0 c -> убил
    expect(s.gold.toNumber()).toBe(5)
    s = run(s, RESPAWN_DELAY_MS) // респаун
    expect(s.monster.currentHp.eq(s.monster.maxHp)).toBe(true)
    s = run(s, 1900) // 1.9 c замаха — удара ещё нет
    expect(s.monster.currentHp.eq(s.monster.maxHp)).toBe(true)
    s = run(s, 100) // полный замах — удар
    expect(s.monster.currentHp.toNumber()).toBe(0)
  })

  it('события удара уходят в шину через emitAttack', () => {
    const seen: string[] = []
    let s = stateWith(20, DUMMY)
    for (let t = 0; t < 4000; t += STEP_MS) {
      s = tick(s, STEP_MS, NO_LUCK, (e) => seen.push(`${e.sourceId}->${e.targetId}:${e.amount}`))
    }
    expect(seen.length).toBe(2) // 4 секунды = 2 удара
    expect(seen[0]).toBe('hero->training-dummy:20')
  })
})
