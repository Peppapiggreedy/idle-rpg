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
import { createInitialState, type GameState } from './state'
import type { Item } from '../types'
import { ensureStats } from './stats'
import { ZONES, zoneForMonsterLevel } from '../data/zones'
import {
  aimZoneId,
  averageGear,
  equipUpgrades,
  playerZoneId,
  reachableZones,
  unlockedByLevel,
} from './simulate'

/** Панцирь с одной живучестью — вещь, которая в мелкой зоне не стоит ничего. */
function vitalityChest(): Item {
  return {
    id: 'test-vitality-chest',
    templateId: 'plate-chest',
    name: 'панцирь',
    icon: 'slot-chest',
    slot: 'chest',
    rarity: 'common',
    level: 25,
    mods: [{ stat: 'vitality', kind: 'flat', value: new Decimal(200), source: 'test' }],
  } as unknown as Item
}

/**
 * Герой 25 уровня в вещах 9 уровня: отстал по снаряжению ровно настолько,
 * чтобы в своей полосе терять аптайм, а в мелкой не терять почти ничего.
 * Числа подобраны замером и держатся вместе: слабее вещи — и мелкая зона
 * тоже начнёт бить, сильнее — и своя перестанет.
 */
function laggard(zoneId: string): GameState {
  const state = ensureStats({
    ...createInitialState(1, 'warden'),
    level: new Decimal(25),
    equipment: averageGear(9),
    currentZoneId: zoneId,
    unlockedZoneIds: unlockedByLevel(25),
    statsDirty: true,
  })
  return { ...state, inventory: [vitalityChest()] }
}

const SHALLOW = zoneForMonsterLevel(13)
const OWN = zoneForMonsterLevel(25)

describe('модель игрока одевается под зону, куда идёт', () => {
  it('в мелкой зоне живучесть не апгрейд, в целевой — апгрейд', () => {
    const state = laggard(SHALLOW.id)
    // Оценка «здесь и сейчас»: в мелкой зоне герой не гибнет и без панциря,
    // а слот занят вещью с атрибутами — значит живучесть проигрывает.
    const here = equipUpgrades(state)
    expect(here.equipment.chest?.id, 'мелкая зона: панцирь не должен надеться').not.toBe(
      'test-vitality-chest',
    )
    // Та же вещь, тот же герой, другая точка отсчёта — зона, куда он идёт.
    const ahead = equipUpgrades(state, OWN.id)
    expect(ahead.equipment.chest?.id, 'целевая зона: панцирь надет').toBe('test-vitality-chest')
    expect(ahead.stats.maxHp.gt(state.stats.maxHp)).toBe(true)
  })

  it('вещи и переезд смотрят в ОДНУ лестницу', () => {
    // Разъедься эти два решения, и герой одевался бы под одну зону, а шёл
    // в другую — ровно тот случай, который стадия и чинит.
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
      expect(ladder, `уровень ${level}: цель на лестнице`).toContain(aimZoneId(state, level))
      expect(ladder, `уровень ${level}: переезд на той же лестнице`).toContain(
        playerZoneId(state, level),
      )
      // Цель — СЛЕДУЮЩАЯ ступень за текущей, а не «куда глаза глядят».
      const here = ladder.indexOf(state.currentZoneId)
      expect(aimZoneId(state, level), `уровень ${level}`).toBe(
        ladder[here + 1] ?? state.currentZoneId,
      )
    }
  })

  it('на последней ступени лестницы цель — она сама', () => {
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
    expect(aimZoneId(state, level)).toBe(own.id)
    // И глубже своей полосы прибор не заглядывает: полосы открывает данж.
    const deeper = ZONES.filter((z) => z.monsterLevelRange.min > own.monsterLevelRange.max)
    expect(deeper.map((z) => z.id)).not.toContain(aimZoneId(state, level))
  })
})
