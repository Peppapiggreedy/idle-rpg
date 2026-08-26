import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import {
  COMBAT_LOG_SIZE,
  RESPAWN_DELAY_MS,
  createInitialState,
  spawnMonster,
  tick,
  type GameState,
} from './tick'
import type { MonsterTemplate } from '../types'

const DUMMY: MonsterTemplate = {
  id: 'training-dummy',
  name: 'Тренировочное чучело',
  maxHp: new Decimal(100),
  goldReward: new Decimal(5),
  xpReward: new Decimal(3),
}

function stateWith(dps: number, template: MonsterTemplate): GameState {
  return {
    ...createInitialState(),
    damagePerSecond: new Decimal(dps),
    monster: spawnMonster(template),
    combatLog: [],
  }
}

function run(state: GameState, ms: number): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS)
  return state
}

describe('боевой tick', () => {
  it('dps 10 против 100 hp: за 10 секунд ровно одно убийство', () => {
    let s = stateWith(10, DUMMY)
    s = run(s, 10_000)
    // Ровно одна выдача награды — значит ровно одна смерть моба.
    expect(s.gold.toNumber()).toBe(5)
    expect(s.xp.toNumber()).toBe(3)
    expect(s.monster.currentHp.toNumber()).toBe(0)
    expect(s.respawnMsLeft).toBe(RESPAWN_DELAY_MS)
  })

  it('урон пропорционален dt: за один тик 100 мс снимается dps/10', () => {
    let s = stateWith(10, DUMMY)
    s = tick(s, STEP_MS)
    expect(s.monster.currentHp.toNumber()).toBe(99)
  })

  it('через 300 мс после смерти спавнится новый моб с полным HP', () => {
    let s = stateWith(10, DUMMY)
    s = run(s, 10_000) // убили
    s = run(s, RESPAWN_DELAY_MS) // 3 тика ожидания респауна
    expect(s.monster.currentHp.eq(s.monster.maxHp)).toBe(true)
    expect(s.respawnMsLeft).toBe(0)
    expect(s.combatLog[0]).toContain('Появился')
    // Награда не начислялась повторно.
    expect(s.gold.toNumber()).toBe(5)
  })

  it('во время ожидания респауна награды не капают', () => {
    let s = stateWith(10, DUMMY)
    s = run(s, 10_000)
    s = tick(s, STEP_MS) // 1-й тик ожидания
    expect(s.gold.toNumber()).toBe(5)
    expect(s.monster.currentHp.toNumber()).toBe(0)
  })

  it('лог боя не длиннее пяти событий', () => {
    // Быстрый dps против хилого моба — много смертей подряд.
    let s = stateWith(1000, { ...DUMMY, maxHp: new Decimal(10) })
    s = run(s, 30_000)
    expect(s.combatLog.length).toBeLessThanOrEqual(COMBAT_LOG_SIZE)
    expect(s.gold.gt(5)).toBe(true) // убийств было много
  })
})
