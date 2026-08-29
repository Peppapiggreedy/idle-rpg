import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import {
  createInitialState,
  manualOnlySettings,
  monsterFromTemplate,
  tick,
  type GameState,
} from './tick'
import { estimateCombatRate } from './combat'
import { applyOfflineProgress } from './save'
import { zoneRate } from './zones'
import { ensureStats } from './stats'
import { COMMON, MONSTER_BASE, buildMonster } from '../data/monsters'
import { WEAPON_SHARPENING } from '../data/upgrades'
import { SAFE_ZONE, ZONES, ZONE_BY_ID } from '../data/zones'
import { PACING_MAX_LEVEL } from './simulate'
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
  level: 1,
  maxHp: new Decimal(1000),
  goldReward: new Decimal(5),
  xpReward: new Decimal(3),
  damageMin: new Decimal(60),
  damageMax: new Decimal(60),
  swingTime: 1,
}

// Автокаст выключен: тесты про смертность героя, а не про умения.
function inZone(template: MonsterTemplate): GameState {
  return {
    ...createInitialState(1),
    abilitySettings: manualOnlySettings(),
    monster: monsterFromTemplate(template),
  }
}

describe('ответные удары моба', () => {
  it('моб бьёт по своему свинг-таймеру, герой теряет HP', () => {
    // Явный моб: спавн в зоне случаен. Числа берём из данных, а не повторяем:
    // обычный моб 1 уровня бьёт ровно на MONSTER_BASE.damage раз в COMMON.swingTime.
    const squelcher = buildMonster(
      { id: 'test-squelcher', name: 'Хлюпень', role: COMMON },
      1,
      new Decimal(1),
    )
    const state = inZone(squelcher)
    let s = run(state, COMMON.swingTime * 1000)
    // До удара HP на капе (реген в потолок не копится); удар на полном свинге,
    // затем реген того же тика.
    const regenPerStep = state.stats.hpRegen.times(STEP_MS / 1000)
    const expected = state.stats.maxHp.minus(MONSTER_BASE.damage).plus(regenPerStep)
    expect(s.currentHp.toNumber()).toBeCloseTo(expected.toNumber(), 6)
    expect(s.combatLog.some((e) => e.type === 'hurt')).toBe(true)
  })

  it('мана постоянно регенерирует до капа', () => {
    // Автокаст выключен: тест про реген маны, а не про её трату.
    let s = {
      ...createInitialState(1),
      abilitySettings: manualOnlySettings(),
      currentMana: new Decimal(0),
    }
    s = run(s, 10_000)
    // Реген упирается в кап: за 10 c набегает min(реген * 10, maxMana).
    expect(s.currentMana.toNumber()).toBeCloseTo(
      Math.min(s.stats.manaRegen.times(10).toNumber(), s.stats.maxMana.toNumber()),
      6,
    )
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

  it('через 30 игровых секунд — полный HP и свежий моб безопасной зоны', () => {
    // Герой не успел никого убить, lastSurvivedZoneId пуст -> откат в безопасную.
    let s = run(inZone(BRUTE), 2000)
    expect(s.heroState).toBe('dead')
    s = run(s, 30_000)
    expect(s.heroState).toBe('alive')
    expect(s.currentHp.eq(s.stats.maxHp)).toBe(true)
    expect(s.currentZoneId).toBe(SAFE_ZONE.id)
    expect(SAFE_ZONE.monsterPool.map((a) => a.id)).toContain(s.monster.id)
    expect(s.monster.currentHp.eq(s.monster.maxHp)).toBe(true)
    expect(s.combatLog.some((e) => e.type === 'revive')).toBe(true)
  })

  it('смерть возвращает в последнюю зону, где герой выживал', () => {
    // Герой убил кого-то в каменоломне -> она и становится точкой отката,
    // даже если умер он позже в другом месте.
    let s: GameState = {
      ...inZone(BRUTE),
      currentZoneId: 'ashen-ridge',
      lastSurvivedZoneId: 'hollow-quarry',
    }
    s = run(s, 2000)
    expect(s.heroState).toBe('dead')
    s = run(s, 30_000)
    expect(s.currentZoneId).toBe('hollow-quarry')
    expect(ZONE_BY_ID['hollow-quarry'].monsterPool.map((a) => a.id)).toContain(s.monster.id)
  })
})

describe('оффлайн моделирует цикл фарм -> смерть -> воскрешение', () => {
  it('перед одним смертельным мобом uptime мал, время до смерти конечно', () => {
    const rate = estimateCombatRate(inZone(BRUTE))
    expect(rate.uptime).toBeLessThan(0.15)
    expect(rate.timeToDeathSec).not.toBeNull()
  })

  it('смертность режет оффлайн-награду в той же зоне', () => {
    const HOURS8 = 8 * 3_600_000
    // Зона глубоко за пределами новичка: на лестнице из двадцати ступеней
    // «пепельный гребень» — уже середина, и новичок там просто мало живёт,
    // а нужна разница между «почти не живёт» и «живёт спокойно».
    // Зона глубокая, но не край мира: ветеран здесь БЕЗ ЭКИПИРОВКИ, а на
    // двадцатиступенчатой лестнице последние зоны голым уровнем не тянутся.
    const RIDGE = ZONES[ZONES.length - 8]
    // Одна и та же зона, одни и те же награды за моба — разница только в том,
    // сколько времени герой в ней жив.
    const rookie: GameState = { ...createInitialState(1), currentZoneId: RIDGE.id }
    const veteran: GameState = ensureStats({
      ...rookie,
      level: new Decimal(PACING_MAX_LEVEL),
      upgrades: { [WEAPON_SHARPENING.id]: new Decimal(400) },
      statsDirty: true,
    })
    const rookieUptime = zoneRate(rookie, RIDGE).uptime
    expect(rookieUptime).toBeLessThan(0.25)
    expect(zoneRate(veteran, RIDGE).uptime).toBeGreaterThan(0.9)

    const weak = applyOfflineProgress(rookie, HOURS8).report
    const strong = applyOfflineProgress(veteran, HOURS8).report
    expect(weak!.kills.toNumber()).toBeGreaterThan(0) // что-то приносит
    expect(weak!.gold.lt(strong!.gold.times(0.5))).toBe(true)
  })

  it('в стартовой зоне герой тоже смертен: uptime < 1 учтён в оффлайне', () => {
    // Без умений герой в стартовой зоне тает: uptime строго между 0 и 1.
    const rate = zoneRate(
      { ...createInitialState(1), abilitySettings: manualOnlySettings() },
      SAFE_ZONE,
    )
    expect(rate.uptime).toBeGreaterThan(0.5)
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
