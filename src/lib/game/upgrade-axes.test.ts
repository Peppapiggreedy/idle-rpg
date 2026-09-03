// ДВЕ ОСИ АПГРЕЙДА И ПРИОРИТЕТ ИГРОКА.
//
// Мера «лучше» была одна — убийств в секунду, — и живучесть входила в неё
// ТОЛЬКО через аптайм. В зоне, где герой не гибнет, аптайм равен единице:
// панцирь не двигал оценку вовсе, двуручное всегда обгоняло связку со щитом,
// а защитные ветки талантов отставали в полтора раза. Здесь проверяется, что
// вторая ось появилась, что переключатель ею управляет и что находку нельзя
// потерять молча ни при каком его положении.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, monsterFromTemplate, type GameState } from './state'
import { ensureStats } from './stats'
import { betterOnAnyAxis, compareItem, isUpgrade, upgradeShare } from './equipment'
import { stashLoot, sellPrice } from './loot'
import { INVENTORY_SIZE } from '../data/balance'
import { zoneForMonsterLevel, representativeMonster } from '../data/zones'
import { averageGear, unlockedByLevel } from './simulate'
import { UPGRADE_PRIORITIES, DEFAULT_UPGRADE_PRIORITY } from '../data/upgrade'
import type { Item } from '../types'
import type { StatId } from './stats'

/** Герой своей полосы, одетый чуть хуже своего уровня: обе оси ему не всё равно. */
function hero(level = 25, gear = level - 8): GameState {
  const zone = zoneForMonsterLevel(level)
  const state = ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(level),
    equipment: averageGear(gear),
    currentZoneId: zone.id,
    unlockedZoneIds: unlockedByLevel(level),
    statsDirty: true,
  })
  return {
    ...state,
    monster: monsterFromTemplate(representativeMonster(zone)),
    currentHp: state.stats.maxHp,
    currentMana: state.stats.maxMana,
  }
}

/** Вещь с одним статом: ровно то, что нужно, чтобы двигать одну ось. */
function oneStat(slot: Item['slot'], stat: StatId, value: number, id = 'test-item'): Item {
  return {
    id,
    name: 'пробник',
    rarity: 'common',
    slot,
    level: 20,
    mods: [{ stat, kind: 'flat', value: new Decimal(value), source: `equipment:${slot}` }],
  } as unknown as Item
}

describe('две оси апгрейда', () => {
  it('живучесть двигает выживание, а сила — урон', () => {
    const state = hero()
    const armor = compareItem(state, oneStat('chest', 'vitality', 300))
    const blade = compareItem(state, oneStat('chest', 'strength', 300))
    // Панцирь: цена боя падает. По старой единственной мере он мог не
    // двигать ничего вовсе — за этим ось и заведена.
    expect(armor.axes.survival!).toBeGreaterThan(0)
    // Сила: урон растёт.
    expect(blade.axes.damage!).toBeGreaterThan(0)
  })

  it('обе оси приходят в сравнении ВСЕГДА, при любом приоритете', () => {
    // Приоритет решает, что подсветить, а не что показать: игрок, выбравший
    // урон, обязан видеть и вторую строку.
    for (const priority of UPGRADE_PRIORITIES) {
      const cmp = compareItem({ ...hero(), upgradePriority: priority }, oneStat('chest', 'vitality', 300))
      expect(cmp.axes.damage, priority).not.toBeUndefined()
      expect(cmp.axes.survival, priority).not.toBeUndefined()
      expect(cmp.markedAxes.length, priority).toBeGreaterThan(0)
    }
  })

  it('приоритет решает, что считать апгрейдом', () => {
    const state = hero()
    // Вещь, которая ТОЛЬКО защищает: живучесть без грамма урона. Слот занят
    // средней бронёй, поэтому по урону она проигрывает — атрибуты уходят.
    const armor = oneStat('chest', 'vitality', 300)
    const byDamage = compareItem({ ...state, upgradePriority: 'damage' }, armor)
    const bySurvival = compareItem({ ...state, upgradePriority: 'survival' }, armor)
    const byBalance = compareItem({ ...state, upgradePriority: 'balance' }, armor)
    expect(bySurvival.isUpgrade, 'по выживанию — апгрейд').toBe(true)
    expect(byBalance.isUpgrade, 'по балансу — апгрейд').toBe(true)
    // По урону вердикт совпадает со знаком своей оси, каким бы он ни был:
    // тест проверяет ПРАВИЛО, а не заранее известное число.
    expect(byDamage.isUpgrade).toBe((byDamage.axes.damage ?? 0) > 0)
  })

  it('«баланс» считает лишним только то, что хуже по ОБЕИМ осям', () => {
    const state = hero()
    // Заведомо мусорная вещь: один стат в мелком числе на занятый слот.
    const junk = oneStat('chest', 'vitality', 0.0001)
    const cmp = compareItem({ ...state, upgradePriority: 'balance' }, junk)
    const worseOnBoth = (cmp.axes.damage ?? 0) <= 0 && (cmp.axes.survival ?? 0) <= 0
    expect(cmp.isUpgrade).toBe(!worseOnBoth)
  })
})

describe('пустой слот — ноль по обеим осям', () => {
  it('любая вещь в пустой слот — апгрейд, и обе оси названы числом', () => {
    const state = hero()
    const bare = { ...state, equipment: { ...state.equipment, trinket: null } }
    const item = oneStat('trinket', 'vitality', 40, 'test-trinket')
    const cmp = compareItem(bare, item)
    expect(cmp.currentItem).toBeNull()
    expect(cmp.isUpgrade, 'вещь на голое место — апгрейд').toBe(true)
    expect(upgradeShare(bare, item)).not.toBeNull()
    // Числа настоящие, а не «0 %»: цена боя от первой в жизни вещи падает.
    expect(cmp.axes.survival!).toBeGreaterThan(0)
  })

  it('вещь для ПУСТОГО слота не уходит в золото при полной сумке', () => {
    // Отдельная проверка, потому что молча потерянная находка — самая
    // дорогая из возможных ошибок разбора: игрок её просто не увидит.
    const base = hero()
    const filler = Array.from({ length: INVENTORY_SIZE }, (_, i) =>
      oneStat('chest', 'vitality', 1, `junk-${i}`),
    )
    const state: GameState = {
      ...base,
      equipment: { ...base.equipment, trinket: null },
      inventory: filler,
    }
    const item = oneStat('trinket', 'vitality', 40, 'test-trinket')
    const next = stashLoot(state, item)
    expect(next.inventory.map((i) => i.id)).toContain('test-trinket')
  })
})

describe('железное правило сумки', () => {
  it('вещь, лучшая хоть по одной оси, не продаётся при ЛЮБОМ приоритете', () => {
    const base = hero()
    // Панцирь-переросток: по выживанию заведомо лучше среднего.
    const armor = oneStat('chest', 'vitality', 400, 'test-armor')
    expect(betterOnAnyAxis(base, armor), 'предпосылка: вещь лучше хоть по одной оси').toBe(true)
    const filler = Array.from({ length: INVENTORY_SIZE }, (_, i) =>
      oneStat('hands', 'vitality', 1, `junk-${i}`),
    )
    for (const priority of UPGRADE_PRIORITIES) {
      const state: GameState = { ...base, upgradePriority: priority, inventory: filler }
      const next = stashLoot(state, armor)
      expect(next.inventory.map((i) => i.id), priority).toContain('test-armor')
    }
  })

  it('вещь, не лучшая ни по одной оси, при полной сумке уходит в золото', () => {
    // Обратная сторона того же правила: без неё сумка забилась бы мусором
    // и находки перестали бы доходить до игрока.
    const base = hero()
    const junk = oneStat('chest', 'vitality', 0.0001, 'test-junk')
    expect(betterOnAnyAxis(base, junk), 'предпосылка: вещь не лучше ни по чему').toBe(false)
    const filler = Array.from({ length: INVENTORY_SIZE }, (_, i) =>
      oneStat('chest', 'vitality', 300, `good-${i}`),
    )
    const state: GameState = { ...base, inventory: filler }
    const next = stashLoot(state, junk)
    expect(next.inventory.map((i) => i.id)).not.toContain('test-junk')
    expect(next.gold.gt(base.gold), 'за неё заплачено золотом').toBe(true)
    expect(next.gold.minus(base.gold).eq(sellPrice(junk))).toBe(true)
  })
})

describe('приоритет — настройка игрока', () => {
  it('по умолчанию баланс', () => {
    expect(createInitialState(1, 'warden').upgradePriority).toBe(DEFAULT_UPGRADE_PRIORITY)
    expect(DEFAULT_UPGRADE_PRIORITY).toBe('balance')
  })

  it('isUpgrade без приоритета берёт его из состояния', () => {
    const state = hero()
    const armor = oneStat('chest', 'vitality', 300)
    expect(isUpgrade({ ...state, upgradePriority: 'survival' }, armor)).toBe(
      isUpgrade(state, armor, 'survival'),
    )
    expect(isUpgrade({ ...state, upgradePriority: 'damage' }, armor)).toBe(
      isUpgrade(state, armor, 'damage'),
    )
  })
})
