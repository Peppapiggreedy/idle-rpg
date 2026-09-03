// ШТРАФ ОПЫТА ЗА ОТСТАВАНИЕ. Проверяется три вещи, и третья — главная:
// граница считается по уровню КОНКРЕТНОГО МОБА, штраф бьёт ТОЛЬКО по опыту,
// и одно и то же правило действует в бою, в прогнозе и в оффлайне.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { ensureStats } from './stats'
import { forecastZone, zoneRate } from './zones'
import { applyOfflineProgress } from './save'
import { XP_GAP_PENALTY, xpGapShare } from '../data/balance'
import {
  ZONES,
  ZONE_BY_ID,
  averageMonsterLevel,
  spawnLevelWeights,
  zoneForMonsterLevel,
} from '../data/zones'
import { averageGear } from './simulate'

const NO_LUCK = () => 1

function heroAt(level: number, zoneId: string, gearLevel = level): GameState {
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    equipment: averageGear(gearLevel),
    currentZoneId: zoneId,
    abilitySettings: manualOnlySettings(),
    // Порог привала снят: тест про опыт, а не про отдых.
    restHpThreshold: 0,
    statsDirty: true,
  })
}

function run(state: GameState, ms: number): GameState {
  for (let t = 0; t < ms; t += STEP_MS) state = tick(state, STEP_MS, NO_LUCK, () => {})
  return state
}

// Стартовая зона и герой, который её перерос ровно настолько, чтобы попасть
// в нужную ступень штрафа. Числа берутся из данных: подвинут границы —
// подвинутся и тесты, а не начнут врать.
const START = zoneForMonsterLevel(1)
const [FULL, HALF] = XP_GAP_PENALTY

describe('доля опыта за разрыв уровней', () => {
  it('ступени берутся из данных, границы включающие', () => {
    // Моб 10 уровня: герой 15 ещё в первой ступени, 16 — уже во второй.
    expect(xpGapShare(10 + FULL.maxGap, 10)).toBe(FULL.share)
    expect(xpGapShare(10 + FULL.maxGap + 1, 10)).toBe(HALF.share)
    expect(xpGapShare(10 + HALF.maxGap, 10)).toBe(HALF.share)
    expect(xpGapShare(10 + HALF.maxGap + 1, 10)).toBe(0)
  })

  it('за мобов ВЫШЕ себя опыт не режут', () => {
    // Отрицательный разрыв — герой полез наверх. Штрафовать за это нечем.
    expect(xpGapShare(10, 40)).toBe(FULL.share)
    expect(xpGapShare(10, 10)).toBe(FULL.share)
  })

  it('таблица ступеней монотонна и лежит в 0..1', () => {
    // Порядок важен: xpGapShare берёт ПЕРВУЮ подходящую ступень.
    for (let i = 0; i < XP_GAP_PENALTY.length; i += 1) {
      const step = XP_GAP_PENALTY[i]
      expect(step.share).toBeGreaterThanOrEqual(0)
      expect(step.share).toBeLessThanOrEqual(1)
      if (i === 0) continue
      const prev = XP_GAP_PENALTY[i - 1]
      expect(step.maxGap).toBeGreaterThan(prev.maxGap)
      expect(step.share).toBeLessThanOrEqual(prev.share)
    }
    // Последняя ступень обязана накрывать любой разрыв, иначе у функции
    // появился бы уровень героя, на котором она не знает, что вернуть.
    expect(XP_GAP_PENALTY[XP_GAP_PENALTY.length - 1].maxGap).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('штраф считается по уровню моба, а не зоны', () => {
  it('в одной зоне у разных мобов доля разная', () => {
    // Зона накрывает пять уровней мобов. Ставим героя так, чтобы граница
    // штрафа прошла ВНУТРИ полосы: нижний край уже отстал, верхний ещё нет.
    const zone = ZONES.find((z) => z.monsterLevelRange.max - z.monsterLevelRange.min >= 4)!
    const level = zone.monsterLevelRange.max + FULL.maxGap
    expect(xpGapShare(level, zone.monsterLevelRange.max)).toBe(FULL.share)
    expect(xpGapShare(level, zone.monsterLevelRange.min)).toBe(HALF.share)
    // Именно поэтому штраф нельзя считать по зоне: одно число на полосу
    // соврало бы половине её мобов.
  })
})

describe('штраф бьёт только по опыту', () => {
  it('в отставшей зоне золото прежнее, а опыта нет', () => {
    const behind = heroAt(START.monsterLevelRange.max + HALF.maxGap + 1, START.id)
    const rate = zoneRate(behind, START)
    expect(rate.killsPerSecond.gt(0)).toBe(true)
    expect(rate.goldPerSecond.gt(0)).toBe(true)
    expect(rate.xpPerSecond.eq(0)).toBe(true)
  })

  it('в бою за убийство идёт золото, но не опыт', () => {
    const level = START.monsterLevelRange.max + HALF.maxGap + 1
    const before = heroAt(level, START.id)
    const after = run(before, 120_000)
    expect(after.gold.gt(before.gold)).toBe(true)
    expect(after.currentXp.eq(before.currentXp)).toBe(true)
    expect(after.level.eq(before.level)).toBe(true)
    // Убийства при этом БЫЛИ — иначе тест доказывал бы только, что герой
    // никого не бил.
    expect(after.combatLog.some((e) => e.type === 'kill')).toBe(true)
  })

  it('лог, прокачка и таблица ступеней дают одно и то же число', () => {
    // Уровень выбран так, чтобы стартовая зона платила ЧАСТЬ награды: не ноль
    // (иначе тест зеленел бы на выключенном опыте) и не полную (иначе он не
    // заметил бы, что множитель не доехал). Ловим первое убийство шагами:
    // лог держит последние события, и за минуту оно бы уехало.
    const level = HALF.maxGap
    let s = heroAt(level, START.id)
    let checked = false
    for (let t = 0; t < 60_000 && !checked; t += STEP_MS) {
      const before = s
      s = tick(s, STEP_MS, NO_LUCK, () => {})
      const event = s.combatLog.find((e) => e.type === 'kill')
      if (event?.type !== 'kill') continue
      const share = xpGapShare(level, before.monster.level)
      expect(share).toBe(HALF.share)
      // Награда моба, умноженная на долю из таблицы, — и ровно это число
      // ушло и в лог, и в прокачку.
      expect(event.xp.eq(before.monster.xpReward.times(share))).toBe(true)
      expect(s.currentXp.minus(before.currentXp).eq(event.xp)).toBe(true)
      expect(event.xp.gt(0)).toBe(true)
      expect(event.xp.lt(before.monster.xpReward)).toBe(true)
      checked = true
    }
    expect(checked).toBe(true)
  })
})

// СПАВН ВОКРУГ УРОВНЯ ГЕРОЯ НЕ РАЗМЫВАЕТ ШТРАФ. Мобы прижимаются к уровню
// героя (SPAWN_LEVEL_SPREAD), а значит отставшая зона выдаёт их с ВЕРХНЕЙ
// границы полосы — самый мягкий разрыв, какой она вообще может дать. Если бы
// клампа не было или полоса поехала, отставшая зона начала бы платить опыт
// дольше положенного, и заметить это можно только так: считая долю по тому
// самому распределению, по которому спавнит игра.
describe('штраф переживает спавн вокруг героя', () => {
  // Средняя доля опыта за бой в зоне: по тем мобам, которых спавн реально
  // выдаёт этому герою, с их вероятностями.
  const shareIn = (zone: (typeof ZONES)[number], hero: number) =>
    spawnLevelWeights(zone, hero).reduce((sum, w) => sum + w.weight * xpGapShare(hero, w.level), 0)

  it('зона перестаёт платить опыт ровно на «верх полосы + 11»', () => {
    for (const zone of ZONES) {
      const top = zone.monsterLevelRange.max
      // На последней ступени полной таблицы доля ещё больше нуля...
      expect(shareIn(zone, top + HALF.maxGap), zone.name).toBeGreaterThan(0)
      // ...а следующим уровнем — уже ноль, без промежуточного «почти ноль».
      expect(shareIn(zone, top + HALF.maxGap + 1), zone.name).toBe(0)
    }
  })

  it('доля не растёт с уровнем героя ни в одной зоне', () => {
    for (const zone of ZONES) {
      let prev = 1
      for (let hero = 1; hero <= zone.monsterLevelRange.max + HALF.maxGap + 5; hero += 1) {
        const share = shareIn(zone, hero)
        expect(share, `${zone.name}, ур. ${hero}`).toBeLessThanOrEqual(prev)
        prev = share
      }
    }
  })
})

describe('прогноз и оффлайн знают про штраф', () => {
  it('прогноз отдаёт долю опыта одной из ступеней', () => {
    const shares = new Set(XP_GAP_PENALTY.map((s) => s.share))
    const hero = heroAt(30, START.id)
    for (const zone of ZONES) {
      const f = forecastZone(hero, zone)
      expect(shares.has(f.xpShare)).toBe(true)
      // Доля обязана сходиться с разрывом, который прогноз показывает рядом:
      // два числа в одной строке интерфейса — об одном и том же.
      expect(f.xpShare).toBe(xpGapShare(30, averageMonsterLevel(zone)))
    }
  })

  it('доля падает по мере того, как герой перерастает зону', () => {
    const at = (level: number) => forecastZone(heroAt(level, START.id), START).xpShare
    expect(at(START.monsterLevelRange.min)).toBe(FULL.share)
    expect(at(90)).toBe(0)
    // Между краями доля не растёт ни на одном уровне.
    let prev = 1
    for (let level = 1; level <= 90; level += 1) {
      const share = at(level)
      expect(share).toBeLessThanOrEqual(prev)
      prev = share
    }
  })

  it('оффлайн в отставшей зоне приносит золото, но не опыт', () => {
    const level = START.monsterLevelRange.max + HALF.maxGap + 1
    const hero = heroAt(level, START.id)
    const { state, report } = applyOfflineProgress(hero, 4 * 3_600_000)
    expect(report).not.toBeNull()
    expect(report!.gold.gt(0)).toBe(true)
    expect(report!.xp.eq(0)).toBe(true)
    expect(state.level.eq(hero.level)).toBe(true)
  })

  it('оффлайн в своей зоне опыт по-прежнему приносит', () => {
    // Контрольный: без него предыдущий тест доказывал бы лишь то, что
    // оффлайн не работает вовсе.
    const zone = ZONE_BY_ID['hollow-quarry']
    const hero = heroAt(zone.monsterLevelRange.max, zone.id)
    const { report } = applyOfflineProgress(hero, 4 * 3_600_000)
    expect(report).not.toBeNull()
    expect(report!.xp.gt(0)).toBe(true)
  })
})
