import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createRng } from './rng'
import { createInitialState, spawnMonster, type GameState } from './state'
import { ensureStats } from './stats'
import {
  currentZone,
  forecastZone,
  isZoneUnlocked,
  retreatZone,
  travelToZone,
  zoneRate,
} from './zones'
import {
  SAFE_ZONE,
  ZONES,
  ZONE_BY_ID,
  averageMonsterLevel,
  representativeMonster,
} from '../data/zones'
import { MONSTER_BASE, buildMonster, COMMON, RUNT, BRUTE } from '../data/monsters'
import { PACING_MAX_LEVEL } from './simulate'
import { WEAPON_SHARPENING } from '../data/upgrades'

const QUARRY = ZONE_BY_ID['hollow-quarry']
const RIDGE = ZONE_BY_ID['ashen-ridge']
// Последняя ступень лестницы: до неё новичку не дожить ни при каком раскладе.
const LAST = ZONES[ZONES.length - 1]

function heroAt(level: number, sharpenings: number): GameState {
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    upgrades: { [WEAPON_SHARPENING.id]: new Decimal(sharpenings) },
    statsDirty: true,
  })
}

describe('данные зон', () => {
  it('ровно одна безопасная зона, и она открыта с первого уровня', () => {
    const safe = ZONES.filter((z) => z.isSafe)
    expect(safe).toHaveLength(1)
    expect(safe[0].unlockRequirement).toBe(1)
    expect(SAFE_ZONE.id).toBe(safe[0].id)
  })

  it('зоны идут по возрастанию требования, уровня мобов и награды', () => {
    for (let i = 1; i < ZONES.length; i++) {
      const prev = ZONES[i - 1]
      const zone = ZONES[i]
      expect(zone.unlockRequirement).toBeGreaterThan(prev.unlockRequirement)
      // Растёт СРЕДНИЙ уровень пула, а полосы соседних зон могут и
      // перекрываться — так у каждого уровня героя есть и «полегче», и
      // «потяжелее», а не одна ступень на всю игру.
      expect(averageMonsterLevel(zone)).toBeGreaterThan(averageMonsterLevel(prev))
      expect(zone.rewardMultiplier.gt(prev.rewardMultiplier)).toBe(true)
    }
  })

  it('у каждой зоны непустой пул и корректный диапазон уровней', () => {
    for (const zone of ZONES) {
      expect(zone.monsterPool.length).toBeGreaterThan(0)
      expect(zone.monsterLevelRange.min).toBeGreaterThanOrEqual(1)
      expect(zone.monsterLevelRange.max).toBeGreaterThanOrEqual(zone.monsterLevelRange.min)
    }
  })
})

describe('масштаб мобов от уровня', () => {
  it('моб 1 уровня с обычной ролью равен базовым числам', () => {
    const m = buildMonster({ id: 'x', name: 'x', role: COMMON }, 1, new Decimal(1))
    expect(m.maxHp.eq(MONSTER_BASE.maxHp)).toBe(true)
    expect(m.damageMin.eq(MONSTER_BASE.damage)).toBe(true)
    expect(m.goldReward.eq(MONSTER_BASE.goldReward)).toBe(true)
    expect(m.xpReward.eq(MONSTER_BASE.xpReward)).toBe(true)
  })

  it('с уровнем растут и hp, и урон, и награда', () => {
    const low = buildMonster({ id: 'x', name: 'x', role: COMMON }, 1, new Decimal(1))
    const high = buildMonster({ id: 'x', name: 'x', role: COMMON }, 10, new Decimal(1))
    expect(high.maxHp.gt(low.maxHp)).toBe(true)
    expect(high.damageMin.gt(low.damageMin)).toBe(true)
    expect(high.goldReward.gt(low.goldReward)).toBe(true)
    // Урон растёт БЫСТРЕЕ hp — и это ставка контракта темпа, а не случайность.
    // HP догоняет прокачку урона героя, а она от заточек почти линейна, так что
    // расти быстро hp нельзя: бой начнёт растягиваться. Урону такой привязки
    // нет, зато есть своя: регенерация героя в бою растёт с уровнем, и урон
    // обязан её обгонять — иначе «сунуться в дальнюю зону» перестаёт убивать.
    expect(high.damageMin.div(low.damageMin).gt(high.maxHp.div(low.maxHp))).toBe(true)
  })

  it('множитель зоны умножает награду, но не трогает hp и урон', () => {
    const plain = buildMonster({ id: 'x', name: 'x', role: COMMON }, 5, new Decimal(1))
    const rich = buildMonster({ id: 'x', name: 'x', role: COMMON }, 5, new Decimal(3))
    expect(rich.goldReward.div(plain.goldReward).toNumber()).toBeCloseTo(3, 9)
    expect(rich.xpReward.div(plain.xpReward).toNumber()).toBeCloseTo(3, 9)
    expect(rich.maxHp.eq(plain.maxHp)).toBe(true)
    expect(rich.damageMax.eq(plain.damageMax)).toBe(true)
  })

  it('роли отличают мелочь от здоровяка', () => {
    const at = (role: typeof COMMON) => buildMonster({ id: 'x', name: 'x', role }, 3, new Decimal(1))
    expect(at(RUNT).maxHp.lt(at(COMMON).maxHp)).toBe(true)
    expect(at(BRUTE).maxHp.gt(at(COMMON).maxHp)).toBe(true)
    expect(at(RUNT).swingTime).toBeLessThan(at(BRUTE).swingTime)
  })
})

describe('спавн из пула зоны', () => {
  it('за 1000 спавнов встречаются все три моба пула', () => {
    const rng = createRng(4242)
    expect(QUARRY.monsterPool).toHaveLength(3)
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(spawnMonster(QUARRY, rng).id)
    expect(seen).toEqual(new Set(QUARRY.monsterPool.map((a) => a.id)))
  })

  it('уровень моба всегда внутри диапазона зоны', () => {
    const rng = createRng(7)
    for (const zone of ZONES) {
      for (let i = 0; i < 200; i++) {
        const m = spawnMonster(zone, rng)
        expect(m.level).toBeGreaterThanOrEqual(zone.monsterLevelRange.min)
        expect(m.level).toBeLessThanOrEqual(zone.monsterLevelRange.max)
      }
    }
  })

  it('спавн даёт моба с полным здоровьем и нулевым замахом', () => {
    const m = spawnMonster(SAFE_ZONE, createRng(1))
    expect(m.currentHp.eq(m.maxHp)).toBe(true)
    expect(m.swingProgress).toBe(0)
  })
})

describe('доступ к зонам', () => {
  it('в закрытую зону войти нельзя — состояние не меняется', () => {
    const s = createInitialState(1) // 1 уровень
    expect(isZoneUnlocked(s, RIDGE)).toBe(false)
    expect(travelToZone(s, RIDGE.id, createRng(1))).toBe(s)
    expect(s.currentZoneId).toBe(SAFE_ZONE.id)
  })

  it('в открытую зону войти можно: моб оттуда, замах сброшен', () => {
    const s = { ...heroAt(9, 0), swingProgress: 0.4, respawnMsLeft: 200 }
    expect(isZoneUnlocked(s, QUARRY)).toBe(true)
    const after = travelToZone(s, QUARRY.id, createRng(1))
    expect(after.currentZoneId).toBe(QUARRY.id)
    expect(QUARRY.monsterPool.map((a) => a.id)).toContain(after.monster.id)
    expect(after.swingProgress).toBe(0)
    expect(after.respawnMsLeft).toBe(0)
    expect(after.combatLog[1]).toMatchObject({ type: 'zone', reason: 'travel' })
  })

  it('несуществующая зона и переход в самого себя ничего не меняют', () => {
    const s = heroAt(20, 0)
    expect(travelToZone(s, 'нет-такой-зоны', createRng(1))).toBe(s)
    expect(travelToZone(s, s.currentZoneId, createRng(1))).toBe(s)
  })

  it('откат после смерти: последняя выжитая зона, иначе безопасная', () => {
    const fresh = createInitialState(1)
    expect(retreatZone(fresh).id).toBe(SAFE_ZONE.id)
    expect(retreatZone({ ...fresh, lastSurvivedZoneId: QUARRY.id }).id).toBe(QUARRY.id)
    // Зона из будущей версии игры не должна запирать героя в пустоте.
    expect(retreatZone({ ...fresh, lastSurvivedZoneId: 'исчезнувшая' }).id).toBe(SAFE_ZONE.id)
  })

  it('убийство отмечает зону как выжитую', () => {
    const s = createInitialState(1)
    expect(s.lastSurvivedZoneId).toBeNull()
  })
})

describe('честный прогноз опасности', () => {
  it('новичок в стартовой зоне выживает, в дальней — нет', () => {
    const rookie = heroAt(1, 0)
    expect(forecastZone(rookie, SAFE_ZONE).verdict).not.toBe('hopeless')
    const far = forecastZone(rookie, LAST)
    expect(far.verdict).toBe('hopeless')
    expect(far.unlocked).toBe(false)
    // Разрыв в уровнях считается, а не берётся из текста в данных.
    expect(far.levelGap).toBe(averageMonsterLevel(LAST) - 1)
  })

  it('прокачка превращает смертельную зону в безопасную', () => {
    const before = forecastZone(heroAt(4, 15), QUARRY)
    const after = forecastZone(heroAt(16, 120), QUARRY)
    expect(after.uptime).toBeGreaterThanOrEqual(before.uptime)
    expect(after.killsPerHour.gt(before.killsPerHour)).toBe(true)
    expect(after.verdict).toBe('safe')
  })

  it('каждая зона в свой срок становится безопасной — мёртвого контента нет', () => {
    // Ветеран — герой конца лестницы: до последних зон он и должен дорасти.
    const veteran = heroAt(PACING_MAX_LEVEL, 400)
    for (const zone of ZONES) {
      const f = forecastZone(veteran, zone)
      expect(f.unlocked).toBe(true)
      expect(f.verdict).not.toBe('hopeless')
      expect(f.goldPerHour.gt(0)).toBe(true)
    }
  })

  it('дальняя зона платит больше, когда герой её тянет', () => {
    const veteran = heroAt(PACING_MAX_LEVEL, 400)
    const near = forecastZone(veteran, SAFE_ZONE)
    const far = forecastZone(veteran, RIDGE)
    expect(far.goldPerHour.gt(near.goldPerHour)).toBe(true)
  })

  it('прогноз усредняет весь пул, а не одного удачного моба', () => {
    const hero = heroAt(4, 15)
    const rate = zoneRate(hero, QUARRY)
    const typical = representativeMonster(QUARRY)
    // Награда за секунду лежит между самым бедным и самым богатым мобом зоны.
    const rewardAt = (level: number) =>
      QUARRY.monsterPool.map((a) => buildMonster(a, level, QUARRY.rewardMultiplier).goldReward)
    const cheapest = rewardAt(QUARRY.monsterLevelRange.min).reduce((a, b) => (a.lt(b) ? a : b))
    const priciest = rewardAt(QUARRY.monsterLevelRange.max).reduce((a, b) => (a.gt(b) ? a : b))
    const goldPerKill = rate.goldPerSecond.div(rate.killsPerSecond)
    expect(goldPerKill.gte(cheapest)).toBe(true)
    expect(goldPerKill.lte(priciest)).toBe(true)
    expect(typical.level).toBe(averageMonsterLevel(QUARRY))
  })
})

describe('зона в состоянии', () => {
  it('свежая игра начинается в безопасной зоне', () => {
    const s = createInitialState(1)
    expect(currentZone(s).id).toBe(SAFE_ZONE.id)
    expect(SAFE_ZONE.monsterPool.map((a) => a.id)).toContain(s.monster.id)
  })
})
