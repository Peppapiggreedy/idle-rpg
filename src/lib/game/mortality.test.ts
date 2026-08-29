import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import {
  createInitialState,
  emptyEquipment,
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
import { SAFE_ZONE, ZONES, ZONE_BY_ID } from '../data/zones'
import { PACING_MAX_LEVEL, averageGear } from './simulate'
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

// Автокаст выключен, экипировка снята: тесты про смертность героя, а не про
// умения и не про стартовый комплект. Со щитом и бронёй новобранца свирепый
// секач перестал бы убивать за две секунды — и мерили бы мы уже не смерть.
function inZone(template: MonsterTemplate): GameState {
  const bare = createInitialState(1)
  return ensureStats({
    ...bare,
    abilitySettings: manualOnlySettings(),
    equipment: emptyEquipment(),
    monster: monsterFromTemplate(template),
    statsDirty: true,
  })
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
    // Одна и та же зона, одни и те же награды за моба — разница только
    // в том, сколько времени герой в ней жив.
    const zone = ZONES[2]
    const rookie: GameState = { ...createInitialState(1), currentZoneId: zone.id }
    const veteran: GameState = ensureStats({
      ...rookie,
      level: new Decimal(PACING_MAX_LEVEL),
      // Ветеран одет по своей глубине: сила теперь на вещах.
      equipment: averageGear(83),
      statsDirty: true,
    })
    expect(zoneRate(rookie, zone).uptime).toBeLessThan(0.95)
    expect(zoneRate(veteran, zone).uptime).toBe(1)

    const weak = applyOfflineProgress(rookie, HOURS8).report
    const strong = applyOfflineProgress(veteran, HOURS8).report
    expect(weak!.kills.toNumber()).toBeGreaterThan(0) // что-то приносит
    expect(weak!.gold.lt(strong!.gold.times(0.5))).toBe(true)
  })

  it('из зоны не по зубам новичок не приносит НИЧЕГО', () => {
    // Привал теперь между боями, и это меняет цену ошибки: в глубокой зоне
    // герой не доживает даже до первого убийства, а значит и отдохнуть ему
    // не с чего. Оффлайн обязан честно вернуть пустоту, а не «немножко».
    const HOURS8 = 8 * 3_600_000
    const deep = ZONES[ZONES.length - 8]
    const rookie: GameState = { ...createInitialState(1), currentZoneId: deep.id }
    expect(zoneRate(rookie, deep).uptime).toBe(0)
    expect(applyOfflineProgress(rookie, HOURS8).report).toBeNull()
  })

  it('на ступень выше своей новичок тает: uptime < 1 учтён в оффлайне', () => {
    // Стартовую зону одетый новобранец проходит спокойно — так и задумано.
    // Через пару ступеней он ещё выживает, но уже умирает: uptime строго
    // между нулём и единицей, и оффлайн обязан это видеть.
    const rookie = { ...createInitialState(1), abilitySettings: manualOnlySettings() }
    expect(zoneRate(rookie, SAFE_ZONE).uptime).toBe(1)
    const rate = zoneRate(rookie, ZONES[2])
    expect(rate.uptime).toBeGreaterThan(0.3)
    expect(rate.uptime).toBeLessThan(1)
  })

  it('мёртвый герой сперва досиживает воскрешение из оффлайн-времени', () => {
    // Герой одет (иначе после воскрешения он и дальше ничего не наберёт),
    // но лежит мёртвым: проверяется именно учёт времени на воскрешение.
    const s: GameState = {
      ...createInitialState(1),
      heroState: 'dead',
      reviveMsLeft: 30_000,
      currentHp: new Decimal(0),
    }
    expect(s.heroState).toBe('dead')
    const { state: after, report } = applyOfflineProgress(s, 3_600_000)
    expect(after.heroState).toBe('alive')
    expect(report).not.toBeNull() // остаток часа отфармлен
  })
})
