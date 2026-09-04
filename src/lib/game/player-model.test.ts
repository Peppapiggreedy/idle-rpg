// МОДЕЛЬ ИГРОКА В ПРОГОНЕ: подо что она одевается и куда идёт.
//
// Это прибор, а не игра: в игре предметы надевает человек. Но прибор обязан
// моделировать человека верно, иначе он мерит не ту игру. Один такой промах
// уже стоил отката целой стадии: оценка находки шла по темпу В ТЕКУЩЕЙ зоне,
// а текущая — заведомо безопасная (туда пустил `playerZoneId`), и живучесть
// там не стоит ничего. Герой приходил на десятый уровень с тремя сотнями HP
// и застревал.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, monsterFromTemplate, type GameState } from './state'
import type { Item } from '../types'
import { ensureStats } from './stats'
import { compareItem } from './equipment'
import { estimateCombatRate } from './combat'
import { SAFE_ZONE, ZONES, zoneForMonsterLevel } from '../data/zones'
import { SHIELDS } from '../data/items'
import { RARITY_BY_ID } from '../data/rarity'
import { shieldMods } from './loot'
import type { StatId } from './stats'
import type { SlotId } from '../data/slots'
import {
  averageGear,
  equipUpgrades,
  playerZoneId,
  reachableZones,
  unlockedByLevel,
} from './simulate'

/** Панцирь с одной живучестью — вещь, которая в мелкой зоне не стоит ничего. */
function vitalityChest(vitality: number): Item {
  return {
    id: 'test-vitality-chest',
    templateId: 'plate-chest',
    name: 'панцирь',
    icon: 'slot-chest',
    slot: 'chest',
    rarity: 'common',
    level: 25,
    mods: [{ stat: 'vitality', kind: 'flat', value: new Decimal(vitality), source: 'test' }],
  } as unknown as Item
}

/**
 * Герой 25 уровня, отставший по снаряжению: в своей полосе теряет аптайм,
 * в мелкой не теряет почти ничего. Ровно тот, у кого «живучесть здесь не
 * нужна, а там нужна».
 */
function laggard(zoneId: string): GameState {
  return ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(25),
    equipment: averageGear(17),
    currentZoneId: zoneId,
    unlockedZoneIds: unlockedByLevel(25),
    statsDirty: true,
  })
}

const SHALLOW = zoneForMonsterLevel(13)
const OWN = zoneForMonsterLevel(25)

/** Вещь с одним статом — чтобы проверять, что ось на него отзывается. */
function statItem(stat: StatId, value: number): Item {
  return {
    id: `test-${stat}-trinket`,
    templateId: 'plate-chest',
    name: 'подвеска',
    icon: 'slot-trinket',
    slot: 'trinket',
    rarity: 'common',
    level: 25,
    mods: [{ stat, kind: 'flat', value: new Decimal(value), source: 'test' }],
  } as unknown as Item
}

/** Тот же герой с ПУСТЫМИ слотами: сравнение «ничего → вещь», без обмена. */
function withEmpty(state: GameState, ...slots: SlotId[]): GameState {
  const equipment = { ...state.equipment }
  for (const slot of slots) equipment[slot] = null
  return ensureStats({ ...state, equipment, statsDirty: true })
}

/** Щит своего уровня — тем же shieldMods, что и настоящая находка. */
function shieldItem(): Item {
  return {
    id: 'test-shield',
    templateId: SHIELDS[0].id,
    name: SHIELDS[0].noun,
    icon: 'slot-offhand',
    slot: 'offHand',
    grip: 'shield',
    rarity: 'common',
    level: 25,
    mods: shieldMods(SHIELDS[0], RARITY_BY_ID.common, 25),
  } as unknown as Item
}

describe('оценка находки не зависит от зоны', () => {
  // РАНЬШЕ ЗДЕСЬ БЫЛО ОБРАТНОЕ СВОЙСТВО, и оно стоило прибору костыля.
  // Оси считались по ТЕКУЩЕЙ зоне: в мелкой аптайм равен единице, цена боя
  // почти ноль, и панцирь не двигал ни одну ось. Модель приходилось водить
  // за руку — оценивать находку по зоне, КУДА герой собирается (`aimZoneId`).
  //
  // Обе оси теперь считаются против ЭТАЛОННОГО противника уровня героя, и
  // зоны в них нет вовсе. Значит и свойство ровно обратное: один и тот же
  // герой с одной и той же находкой обязан получить ОДИН И ТОТ ЖЕ ответ, где
  // бы он ни стоял. Это не украшение: пока ответ зависел от зоны, вещь
  // читалась как находка на одном шаге пути и как хлам на следующем.
  it('одна и та же вещь оценивается одинаково в мелкой зоне и в своей', () => {
    const item = vitalityChest(200)
    const shallow = compareItem(laggard(SHALLOW.id), item)
    const own = compareItem(laggard(OWN.id), item)
    expect(shallow.axes.damage).toBeCloseTo(own.axes.damage!, 12)
    expect(shallow.axes.survival).toBeCloseTo(own.axes.survival!, 12)
    expect(shallow.isUpgrade).toBe(own.isUpgrade)
  })

  it('и в БЕЗОПАСНОЙ зоне тоже: там прежняя мера молчала', () => {
    // Самый тяжёлый случай прежней меры: в безопасной зоне герой не гибнет и
    // не тает, аптайм единица, цена боя около нуля — снижать нечего, и игра
    // говорила «не апгрейд» про панцирь.
    const item = vitalityChest(200)
    const safe = compareItem(laggard(SAFE_ZONE.id), item)
    const own = compareItem(laggard(OWN.id), item)
    expect(safe.axes.survival!, 'живучесть растёт и в безопасной зоне').toBeGreaterThan(0)
    expect(safe.axes.survival).toBeCloseTo(own.axes.survival!, 12)
  })

  it('щит в безопасной зоне поднимает живучесть', () => {
    // ТО ЖЕ САМОЕ ПРО ЩИТ, и это отдельный случай: щит снимает урон ПЛОСКИМ
    // числом, поэтому в долю он превращается только против конкретного удара.
    // Против эталонного противника такой удар есть всегда — а прежняя мера
    // (цена боя) в безопасной зоне была около нуля, и снижать было нечего.
    const bare = withEmpty(laggard(SAFE_ZONE.id), 'offHand')
    const cmp = compareItem(bare, shieldItem())
    expect(cmp.axes.survival!, 'щит поднимает живучесть').toBeGreaterThan(0)
  })

  it('мана и интеллект живучесть НЕ двигают', () => {
    // Живучесть — это сколько герой держит САМ. Всё, что оплачивается маной
    // (лечащее умение, зелья), в неё не входит: считать её дважды значило бы
    // обещать игроку запас, которого нет, когда мана кончилась.
    //
    // Слот ПУСТОЙ намеренно: сравнение «ничего → вещь», а не обмен одной
    // подвески на другую — иначе тест мерил бы, что снялось, а не что надето.
    const hero = withEmpty(laggard(OWN.id), 'trinket')
    const brainy = compareItem(hero, statItem('intellect', 500))
    expect(brainy.axes.survival ?? 0, 'интеллект живучесть не двигает').toBe(0)
    const manaful = compareItem(hero, statItem('maxMana', 500))
    expect(manaful.axes.survival ?? 0, 'запас маны живучесть не двигает').toBe(0)
    // А живучесть — двигает, иначе тест проверял бы, что ось всегда молчит.
    const tough = compareItem(hero, statItem('vitality', 200))
    expect(tough.axes.survival!, 'живучесть двигает ось').toBeGreaterThan(0)
  })

  it('ось урона не двигают ни броня, ни живучесть, ни запас', () => {
    // ОБРАТНАЯ ПОЛОВИНА ТОГО ЖЕ СВОЙСТВА. Оси обязаны быть независимыми, а до
    // этой стадии они были СВЯЗАНЫ ЗАДОМ НАПЕРЁД: `damagePerSecond` знает про
    // цикл привала (привал наливает ману), и панцирь ронял «урон в секунду» на
    // 4 % — вещь, которая урона не трогала вовсе.
    const hero = withEmpty(laggard(OWN.id), 'trinket')
    for (const stat of ['armor', 'vitality', 'maxHp'] as const) {
      expect(compareItem(hero, statItem(stat, 100)).axes.damage ?? 0, stat).toBe(0)
    }
    // И наоборот: сила атаки двигает урон и не двигает живучесть.
    const sharp = compareItem(hero, statItem('attackPower', 100))
    expect(sharp.axes.damage!, 'сила атаки двигает урон').toBeGreaterThan(0)
    expect(sharp.axes.survival ?? 0, 'сила атаки живучесть не двигает').toBe(0)
  })

  it('ось живучести монотонна: больше запаса — больше живучести', () => {
    const hero = withEmpty(laggard(OWN.id), 'trinket')
    let previous = 0
    for (const value of [10, 50, 100, 200, 400, 800]) {
      const share = compareItem(hero, statItem('vitality', value)).axes.survival!
      expect(share, `живучесть ${value}`).toBeGreaterThan(previous)
      previous = share
    }
  })

  it('ось урона монотонна: больше силы атаки — больше урона', () => {
    const hero = withEmpty(laggard(OWN.id), 'trinket')
    let previous = 0
    for (const value of [10, 50, 100, 200, 400, 800]) {
      const share = compareItem(hero, statItem('attackPower', value)).axes.damage!
      expect(share, `сила атаки ${value}`).toBeGreaterThan(previous)
      previous = share
    }
  })

  it('приоритет «урон» по-прежнему отличает панцирь от клинка', () => {
    // Переключатель никуда не делся: при «уроне» чистая живучесть апгрейдом
    // не считается, при «балансе» — считается. Зона на это не влияет.
    const item = vitalityChest(200)
    const damageOnly = (s: GameState) => ({ ...s, upgradePriority: 'damage' as const })
    expect(compareItem(damageOnly(laggard(SHALLOW.id)), item).isUpgrade).toBe(false)
    expect(compareItem(damageOnly(laggard(OWN.id)), item).isUpgrade).toBe(false)
    expect(compareItem(laggard(OWN.id), item).isUpgrade, 'при «балансе» — апгрейд').toBe(true)
  })
})

describe('модель игрока идёт по лестнице', () => {
  it('переезд идёт по лестнице, а не «куда глаза глядят»', () => {
    for (const level of [10, 25, 55, 85]) {
      const state = ensureStats({
        ...createInitialState(1, 'warden'),
        level: new Decimal(level),
        equipment: averageGear(Math.max(1, level - 6)),
        currentZoneId: zoneForMonsterLevel(Math.max(1, level - 10)).id,
        unlockedZoneIds: unlockedByLevel(level),
        statsDirty: true,
      })
      const ladder = reachableZones(state, level).map((z) => z.id)
      expect(ladder, `уровень ${level}: лестница не пуста`).not.toHaveLength(0)
      expect(ladder, `уровень ${level}: переезд на той же лестнице`).toContain(
        playerZoneId(state, level),
      )
    }
  })

  it('глубже своей полосы прибор не заглядывает: полосы открывает данж', () => {
    const level = 25
    const own = zoneForMonsterLevel(level)
    const state = ensureStats({
      ...createInitialState(1, 'warden'),
      level: new Decimal(level),
      equipment: averageGear(level),
      currentZoneId: own.id,
      unlockedZoneIds: unlockedByLevel(level),
      statsDirty: true,
    })
    const deeper = ZONES.filter((z) => z.monsterLevelRange.min > own.monsterLevelRange.max)
    expect(deeper.map((z) => z.id)).not.toContain(playerZoneId(state, level))
  })
})
