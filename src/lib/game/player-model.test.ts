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
import { ZONES, ZONE_BY_ID, representativeMonster, zoneForMonsterLevel } from '../data/zones'
import {
  aimZoneId,
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

/**
 * Сколько живучести нужно, чтобы панцирь ОКУПАЛСЯ ПО УРОНУ в целевой зоне и
 * не окупался в мелкой. Число НЕ ЗАШИТО: любая правка баланса его двигает,
 * а свойство остаётся. Нет такого числа вовсе — свойство пропало, и тест
 * обязан упасть, а не молча проверять пустоту.
 *
 * МЕРИТСЯ ПО ОСИ УРОНА, а не по метке «апгрейд», и это следствие двух осей.
 * Пока мера была одна, «апгрейд» и «окупается по урону» значили одно и то
 * же; теперь панцирь — апгрейд в любой зоне, потому что цену боя он снижает
 * везде. Свойство третьей ночи от этого никуда не делось: оно про то, что
 * ЖИВУЧЕСТЬ ПЛАТИТ УРОНОМ ТОЛЬКО ТАМ, ГДЕ ГЕРОЙ ТЕРЯЕТ АПТАЙМ, — и меряется
 * теперь на той оси, о которой оно и было.
 */
function flippingVitality(): number {
  const shallow = laggard(SHALLOW.id)
  const own = laggard(OWN.id)
  for (const v of [25, 50, 100, 200, 400, 800]) {
    const item = vitalityChest(v)
    const here = compareItem(shallow, item).axes.damage ?? 0
    const there = compareItem(own, item).axes.damage ?? 0
    if (there > 0 && here <= 0) return v
  }
  throw new Error('нет живучести, которая окупается по урону в целевой зоне и не окупается в мелкой')
}

describe('модель игрока одевается под зону, куда идёт', () => {
  it('живучесть окупается уроном только в целевой зоне', () => {
    const vitality = flippingVitality()
    const item = vitalityChest(vitality)
    const shallow = compareItem(laggard(SHALLOW.id), item)
    const own = compareItem(laggard(OWN.id), item)

    // Свойство третьей ночи: в мелкой зоне герой не теряет аптайма и без
    // панциря, поэтому запас там уроном НЕ окупается; в своей полосе — да.
    expect(shallow.axes.damage!, 'мелкая зона: запас уроном не окупается').toBeLessThanOrEqual(0)
    expect(own.axes.damage!, 'целевая зона: запас окупается уроном').toBeGreaterThan(0)

    // Свойство ЧЕТВЁРТОЙ ночи: цену боя панцирь снижает В ОБЕИХ зонах, и
    // именно поэтому он апгрейд и там, и там. Раньше мера была одна, и в
    // мелкой зоне игра говорила про панцирь «не апгрейд» — то есть молчала
    // ровно о том, что он и делает.
    expect(shallow.axes.survival!, 'мелкая зона: цена боя падает').toBeGreaterThan(0)
    expect(own.axes.survival!, 'целевая зона: цена боя падает').toBeGreaterThan(0)
    expect(shallow.isUpgrade && own.isUpgrade, 'при «балансе» апгрейд в обеих зонах').toBe(true)

    // А при приоритете «урон» остаётся ровно прежний вердикт: панцирь не
    // апгрейд в мелкой зоне и апгрейд в целевой. Переключатель этим и
    // ценен — он возвращает игроку старое поведение, если тот его хочет.
    const damageOnly = (s: GameState) => ({ ...s, upgradePriority: 'damage' as const })
    expect(compareItem(damageOnly(laggard(SHALLOW.id)), item).isUpgrade).toBe(false)
    expect(compareItem(damageOnly(laggard(OWN.id)), item).isUpgrade).toBe(true)
  })

  it('модель одевается под зону, куда идёт, а не где стоит', () => {
    // Панцирь настолько тяжёлый, что в мелкой зоне ОСЛАБЛЯЕТ героя по урону:
    // модель с приоритетом «урон» наденет его только глядя на целевую зону.
    const vitality = flippingVitality()
    const base = { ...laggard(SHALLOW.id), inventory: [vitalityChest(vitality)] }
    const state = { ...base, upgradePriority: 'damage' as const }
    const here = equipUpgrades(state)
    expect(here.equipment.chest?.id, 'мелкая зона: панцирь не должен надеться').not.toBe(
      'test-vitality-chest',
    )
    // Та же вещь, тот же герой, другая точка отсчёта — зона, куда он идёт.
    const ahead = equipUpgrades(state, OWN.id)
    expect(ahead.equipment.chest?.id, 'целевая зона: панцирь надет').toBe('test-vitality-chest')
    expect(ahead.stats.maxHp.gt(state.stats.maxHp)).toBe(true)
  })

  // ЗДЕСЬ СТОЯЛ ТРЕТИЙ ТЕСТ — «прибавка запаса в глубокой зоне стоит дороже,
  // чем в мелкой» — и он оказался НЕПРАВДОЙ на мелких прибавках. Замер: запас
  // ×1.05 в своей полосе даёт 0.999 темпа, в мелкой 1.001. Причина известна и
  // измерена ещё второй ночью: привал наливает ману досуха, поэтому лишний
  // запас РЕЖЕ отправляет героя на привал и оставляет его с меньшим числом
  // кастов. На больших прибавках выигрыш аптайма перекрывает эту потерю, на
  // мелких — нет. Значит правка стадии не про «живучесть всегда дороже
  // глубже», а про то, что РЕШЕНИЕ переворачивается — это и проверяет тест
  // выше. Ложное свойство в наборе хуже отсутствующего.

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
