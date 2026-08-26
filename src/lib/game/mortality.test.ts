import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, spawnMonster, tick, type GameState } from './tick'
import { estimateCombatRate } from './combat'
import { applyOfflineProgress } from './save'
import type { MonsterTemplate } from '../types'

const NO_LUCK = () => 1 // без критов и без дропа

function run(state: GameState, ms: number): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, NO_LUCK)
  return state
}

// Смертельный моб: два удара по 60 убивают героя со 100 hp за 2 секунды.
const BRUTE: MonsterTemplate = {
  id: 'test-brute',
  name: 'Свирепый секач',
  maxHp: new Decimal(1000),
  goldReward: new Decimal(5),
  xpReward: new Decimal(3),
  damage: new Decimal(60),
  attackSpeed: 1,
}

function inZone(template: MonsterTemplate): GameState {
  return { ...createInitialState(1), monster: spawnMonster(template) }
}

describe('ответные удары моба', () => {
  it('моб бьёт по своему свинг-таймеру, герой теряет HP', () => {
    // Хлюпень: 4 урона каждые 1.6 c; реген в бою 1/с.
    let s = run(createInitialState(1), 1600)
    // До удара HP на капе (реген в потолок не копится); удар на 1.6 c: -4,
    // затем реген того же тика +0.1 -> 96.1.
    expect(s.currentHp.toNumber()).toBeCloseTo(96.1, 6)
    expect(s.combatLog.some((e) => e.type === 'hurt')).toBe(true)
  })

  it('мана постоянно регенерирует до капа', () => {
    let s = { ...createInitialState(1), currentMana: new Decimal(0) }
    s = run(s, 10_000)
    expect(s.currentMana.toNumber()).toBeCloseTo(20, 6) // 2/с * 10 c
    s = run(s, 60_000)
    expect(s.currentMana.eq(s.stats.maxMana)).toBe(true) // кап
  })
})

describe('смерть и воскрешение', () => {
  it('currentHp <= 0 -> состояние dead, награды не капают', () => {
    let s = run(inZone(BRUTE), 2000) // два удара по 60
    expect(s.heroState).toBe('dead')
    expect(s.currentHp.toNumber()).toBe(0)
    expect(s.combatLog.some((e) => e.type === 'death')).toBe(true)
    const goldAtDeath = s.gold
    s = run(s, 10_000) // мёртвый не фармит
    expect(s.gold.eq(goldAtDeath)).toBe(true)
    expect(s.heroState).toBe('dead')
  })

  it('через 30 игровых секунд — полный HP и свежий моб стартовой зоны', () => {
    let s = run(inZone(BRUTE), 2000)
    expect(s.heroState).toBe('dead')
    s = run(s, 30_000)
    expect(s.heroState).toBe('alive')
    expect(s.currentHp.eq(s.stats.maxHp)).toBe(true)
    expect(s.monster.id).toBe('meadow-squelcher') // «последняя зона» = стартовая
    expect(s.monster.currentHp.eq(s.monster.maxHp)).toBe(true)
    expect(s.combatLog.some((e) => e.type === 'revive')).toBe(true)
  })
})

describe('оффлайн моделирует цикл фарм -> смерть -> воскрешение', () => {
  it('в смертельной зоне uptime мал и оффлайн-награда режется пропорционально', () => {
    const deadly = inZone(BRUTE)
    const rate = estimateCombatRate(deadly)
    expect(rate.uptime).toBeLessThan(0.15)
    expect(rate.timeToDeathSec).not.toBeNull()

    const HOURS8 = 8 * 3_600_000
    const { report } = applyOfflineProgress(deadly, HOURS8)
    // Идеальный непрерывный фарм: цикл = ceil(1000/20) * 2 c + 0.3 c
    const idealKills = Math.floor((8 * 3600) / (50 * 2 + 0.3))
    expect(report!.kills.toNumber()).toBeLessThan(idealKills * 0.2)
    expect(report!.kills.toNumber()).toBeGreaterThan(0)
  })

  it('в стартовой зоне герой тоже смертен: uptime < 1 учтён в оффлайне', () => {
    const rate = estimateCombatRate(createInitialState(1))
    expect(rate.uptime).toBeGreaterThan(0.8)
    expect(rate.uptime).toBeLessThan(1)
  })

  it('мёртвый герой сперва досиживает воскрешение из оффлайн-времени', () => {
    let s = run(inZone(BRUTE), 2000)
    expect(s.heroState).toBe('dead')
    const { state: after, report } = applyOfflineProgress(s, 3_600_000)
    expect(after.heroState).toBe('alive')
    expect(report).not.toBeNull() // остаток часа отфармлен
  })
})
