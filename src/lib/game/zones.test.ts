import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createRng } from './rng'
import { GOLD_SOURCE_SHARE } from '../data/balance'
import { createInitialState, spawnMonster, type GameState } from './state'
import { ensureStats } from './stats'
import {
  currentZone,
  forecastZone,
  isZoneUnlocked,
  retreatZone,
  travelStatus,
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
import {
  EARLY_HP_DISCOUNT,
  MONSTER_BASE,
  MONSTER_GROWTH,
  SPAWN_LEVEL_SPREAD,
  buildMonster,
  COMMON,
  RUNT,
  BRUTE,
} from '../data/monsters'
import { PACING_MAX_LEVEL, averageGear, unlockedByLevel } from './simulate'
import { INITIAL_ZONE_IDS } from '../data/dungeons'
import { LEVEL_CAP } from '../data/balance'

const QUARRY = ZONE_BY_ID['hollow-quarry']
const RIDGE = ZONE_BY_ID['ashen-ridge']
// Последняя ступень лестницы: до неё новичку не дожить ни при каком раскладе.
const LAST = ZONES[ZONES.length - 1]

function heroAt(level: number, gearLevel: number): GameState {
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    equipment: averageGear(gearLevel),
    // Зоны открывают ДАНЖИ: герой этого уровня прошёл те, что были по пути.
    unlockedZoneIds: unlockedByLevel(level),
    statsDirty: true,
  })
}

describe('данные зон', () => {
  it('ровно одна безопасная зона, и она открыта с начала игры', () => {
    const safe = ZONES.filter((z) => z.isSafe)
    expect(safe).toHaveLength(1)
    // «Открыта с начала» = её не открывает ни один данж. Иначе вернуться
    // после смерти было бы некуда, пока данж не пройден.
    expect(INITIAL_ZONE_IDS).toContain(safe[0].id)
    expect(SAFE_ZONE.id).toBe(safe[0].id)
  })

  it('зоны идут по возрастанию уровня мобов и награды', () => {
    for (let i = 1; i < ZONES.length; i++) {
      const prev = ZONES[i - 1]
      const zone = ZONES[i]
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
    // HP И УРОН — со скидкой ранней полосы: у героя пока одна кнопка из трёх
    // и одно белое оружие при шести пустых слотах.
    expect(m.maxHp.eq(MONSTER_BASE.maxHp.times(EARLY_HP_DISCOUNT[0].mult))).toBe(true)
    expect(m.damageMin.eq(MONSTER_BASE.damage.times(EARLY_HP_DISCOUNT[0].damageMult))).toBe(true)
    // ЗОЛОТО — ТОЛЬКО СВОЯ ДОЛЯ КРАНА: вторую забирает цена находки, упавшей
    // с этого же моба (ITEM_SELL_BASE в data/loot.ts). Опыт делить не с кем,
    // он равен базе целиком.
    expect(
      m.goldReward.eq(MONSTER_BASE.goldReward.times(GOLD_SOURCE_SHARE.monsters)),
    ).toBe(true)
    expect(m.xpReward.eq(MONSTER_BASE.xpReward)).toBe(true)
  })

  it('скидка HP ранних полос заканчивается вместе с набором кнопок', () => {
    // За пределами полос скидки hpScale — та же прямая, что и всегда.
    const at = (level: number) =>
      buildMonster({ id: 'x', name: 'x', role: COMMON }, level, new Decimal(1)).maxHp
    const line = (level: number) =>
      MONSTER_BASE.maxHp.times(MONSTER_GROWTH.hpPerLevel.times(level - 1).plus(1))
    expect(at(5).lt(line(5))).toBe(true) // полоса одной кнопки
    expect(at(8).lt(line(8))).toBe(true) // полоса двух кнопок
    expect(at(8).gt(at(5))).toBe(true) // но скидка тает, а не прыгает вниз
    expect(at(11).eq(line(11))).toBe(true) // полный набор — чистая прямая
  })

  it('с уровнем растут и hp, и урон, и награда', () => {
    // Уровни взяты ВЫШЕ ранних полос: там на числа наложена скидка
    // (EARLY_HP_DISCOUNT), и она не ставка роста, а отдельный механизм —
    // пара «1 против 10» мерила бы её, а не отношение ставок.
    const low = buildMonster({ id: 'x', name: 'x', role: COMMON }, 11, new Decimal(1))
    const high = buildMonster({ id: 'x', name: 'x', role: COMMON }, 30, new Decimal(1))
    expect(high.maxHp.gt(low.maxHp)).toBe(true)
    expect(high.damageMin.gt(low.damageMin)).toBe(true)
    expect(high.goldReward.gt(low.goldReward)).toBe(true)
    // Урон растёт БЫСТРЕЕ hp — и это ставка контракта темпа, а не случайность.
    // HP догоняет прокачку урона героя, а тот растёт линейно от уровня вещей,
    // так что расти быстро hp нельзя: бой начнёт растягиваться. Урону такой
    // привязки нет, зато есть своя: регенерация героя в бою растёт с уровнем,
    // и урон обязан её обгонять — иначе «сунуться в дальнюю зону» перестаёт
    // убивать.
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

  it('роли отличают мелочь от здоровяка РИТМОМ, а не третьей полоской HP', () => {
    // Полоса зоны — пять уровней мобов, и уровень внутри неё уже даёт разброс
    // HP. Второй такой же разброс от ролей ронял бы мелочь с нижнего края под
    // пол темпа, поэтому у мелочи и обычного здоровье ОДНО, а различает их
    // частота удара и урон. Здоровяк тяжелее — но не вдвое.
    const at = (role: typeof COMMON) => buildMonster({ id: 'x', name: 'x', role }, 3, new Decimal(1))
    expect(at(RUNT).maxHp.eq(at(COMMON).maxHp)).toBe(true)
    expect(at(BRUTE).maxHp.gt(at(COMMON).maxHp)).toBe(true)
    expect(at(RUNT).swingTime).toBeLessThan(at(COMMON).swingTime)
    expect(at(COMMON).swingTime).toBeLessThan(at(BRUTE).swingTime)
    expect(at(RUNT).damageMax.lt(at(COMMON).damageMax)).toBe(true)
    expect(at(BRUTE).damageMax.gt(at(COMMON).damageMax)).toBe(true)
  })
})

describe('спавн из пула зоны', () => {
  it('за 1000 спавнов встречаются все три моба пула', () => {
    const rng = createRng(4242)
    expect(QUARRY.monsterPool).toHaveLength(3)
    const seen = new Set<string>()
    // Уровень героя внутри полосы: пул от него не зависит, но подпись
    // функции требует его назвать.
    const level = QUARRY.monsterLevelRange.min
    for (let i = 0; i < 1000; i++) seen.add(spawnMonster(QUARRY, rng, level).id)
    expect(seen).toEqual(new Set(QUARRY.monsterPool.map((a) => a.id)))
  })

  it('уровень моба всегда внутри диапазона зоны', () => {
    // ГРАНИЦЫ ПОЛОСЫ СИЛЬНЕЕ РАСПРЕДЕЛЕНИЯ, и проверяется это на героях
    // ЛЮБОГО уровня: и на тех, кто пришёл в зону раньше времени, и на тех,
    // кто вернулся в неё через полсотни уровней.
    const rng = createRng(7)
    for (const zone of ZONES) {
      const { min, max } = zone.monsterLevelRange
      for (const heroLevel of [1, min - 1, min, max, max + 1, LEVEL_CAP]) {
        for (let i = 0; i < 100; i++) {
          const m = spawnMonster(zone, rng, heroLevel)
          expect(m.level, `${zone.id} при герое ${heroLevel}`).toBeGreaterThanOrEqual(min)
          expect(m.level, `${zone.id} при герое ${heroLevel}`).toBeLessThanOrEqual(max)
        }
      }
    }
  })

  it('уровень моба жмётся к уровню героя, а не размазан по полосе', () => {
    // 70 % ровно уровень героя, по 10 % на ±1, по 5 % на ±2 — распределение
    // лежит в данных (SPAWN_LEVEL_SPREAD), здесь проверяется, что спавн ему
    // следует. Зона взята широкая, герой стоит в её середине: у краёв
    // распределение обрезается границами, и доли там другие по построению.
    const zone = ZONES.find((z) => z.monsterLevelRange.max - z.monsterLevelRange.min >= 4)!
    const heroLevel = Math.round(
      (zone.monsterLevelRange.min + zone.monsterLevelRange.max) / 2,
    )
    const rng = createRng(20260904)
    const counts = new Map<number, number>()
    const N = 20_000
    for (let i = 0; i < N; i++) {
      const m = spawnMonster(zone, rng, heroLevel)
      counts.set(m.level, (counts.get(m.level) ?? 0) + 1)
    }
    for (const { offset, weight } of SPAWN_LEVEL_SPREAD) {
      const share = (counts.get(heroLevel + offset) ?? 0) / N
      // Допуск — три процентных пункта: двадцать тысяч бросков дают
      // стандартное отклонение доли меньше половины пункта.
      expect(Math.abs(share - weight), `смещение ${offset}`).toBeLessThan(0.03)
    }
  })

  it('спавн даёт моба с полным здоровьем и нулевым замахом', () => {
    const m = spawnMonster(SAFE_ZONE, createRng(1), 1)
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
    const s = { ...heroAt(9, 1), swingProgress: 0.4, respawnMsLeft: 200 }
    expect(isZoneUnlocked(s, QUARRY)).toBe(true)
    const after = travelToZone(s, QUARRY.id, createRng(1))
    expect(after.currentZoneId).toBe(QUARRY.id)
    expect(QUARRY.monsterPool.map((a) => a.id)).toContain(after.monster.id)
    expect(after.swingProgress).toBe(0)
    expect(after.respawnMsLeft).toBe(0)
    expect(after.combatLog[1]).toMatchObject({ type: 'zone', reason: 'travel' })
  })

  it('несуществующая зона и переход в самого себя ничего не меняют', () => {
    const s = heroAt(20, 1)
    expect(travelToZone(s, 'нет-такой-зоны', createRng(1))).toBe(s)
    expect(travelToZone(s, s.currentZoneId, createRng(1))).toBe(s)
  })

  it('каждый отказ переезда — своим кодом, и код совпадает с делом', () => {
    const s = heroAt(20, 1)
    expect(travelStatus(s, QUARRY.id)).toEqual({ canTravel: true, reason: null })
    expect(travelStatus(s, 'нет-такой-зоны').reason).toBe('unknown')
    expect(travelStatus(s, s.currentZoneId).reason).toBe('same-zone')
    expect(travelStatus(s, LAST.id).reason).toBe('locked')
    const dead = { ...s, heroState: 'dead' as const }
    expect(travelStatus(dead, QUARRY.id).reason).toBe('dead')
    expect(travelToZone(dead, QUARRY.id, createRng(1))).toBe(dead)
  })

  it('из данжа переезд закрыт: иначе моб зоны засчитался бы за босса цепочки', () => {
    // Цепочка двигается по паузе респауна (advanceDungeon), и раньше переезд
    // посреди забега оставлял dungeonRun висеть — убийство обычного моба
    // открывало следующего босса. Ворота закрываются здесь, кодом.
    const s = heroAt(20, 1)
    const inside = {
      ...s,
      dungeonRun: { dungeonId: 'x', difficulty: 'normal' as const, bossIndex: 0, fightMs: 0 },
    }
    expect(travelStatus(inside, QUARRY.id).reason).toBe('in-dungeon')
    expect(travelToZone(inside, QUARRY.id, createRng(1))).toBe(inside)
    expect(inside.dungeonRun.bossIndex).toBe(0)
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
    const rookie = heroAt(1, 1)
    expect(forecastZone(rookie, SAFE_ZONE).verdict).not.toBe('hopeless')
    const far = forecastZone(rookie, LAST)
    expect(far.verdict).toBe('hopeless')
    expect(far.unlocked).toBe(false)
    // Разрыв в уровнях считается, а не берётся из текста в данных.
    expect(far.levelGap).toBe(averageMonsterLevel(LAST) - 1)
  })

  it('прокачка превращает смертельную зону в безопасную', () => {
    const before = forecastZone(heroAt(4, 3), QUARRY)
    const after = forecastZone(heroAt(16, 18), QUARRY)
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
