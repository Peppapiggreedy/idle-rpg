import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { INVENTORY_SIZE, rollLoot, rollRarity, rollSlot, sellItem, sellPrice } from './loot'
import { equipItem } from './equipment'
import { SLOT_IDS } from '../data/slots'
import { createInitialState, tick, type GameState } from './tick'
import { STEP_MS } from './loop'
import { DROP_CHANCE } from '../data/loot'
import { RARITIES } from '../data/rarity'
import type { Item } from '../types'

// rng из заготовленной последовательности значений.
function seqRng(values: number[]) {
  let i = 0
  return () => values[Math.min(i++, values.length - 1)]
}

describe('rollRarity', () => {
  it('края рулетки: 0 — common, почти 1 — legendary', () => {
    expect(rollRarity(() => 0).id).toBe('common')
    expect(rollRarity(() => 0.999999).id).toBe('legendary')
  })

  it('распределение уважает веса (сеточная проверка без случайности)', () => {
    const total = RARITIES.reduce((s, r) => s + r.weight, 0)
    const counts: Record<string, number> = {}
    for (let i = 0; i < total; i++) {
      const id = rollRarity(() => (i + 0.5) / total).id
      counts[id] = (counts[id] ?? 0) + 1
    }
    for (const r of RARITIES) expect(counts[r.id]).toBe(r.weight)
  })
})

describe('rollLoot', () => {
  it('дроп не выпадает, если бросок выше шанса', () => {
    expect(rollLoot(() => DROP_CHANCE, 0)).toBeNull()
  })

  it('оружие задаёт базу боя тремя модификаторами kind base', () => {
    // Броски: шанс, редкость (почти 1 = legendary), слот (0 = оружие),
    // прилагательное, модель оружия.
    const item = rollLoot(seqRng([0, 0.999999, 0, 0, 0]), 7)
    expect(item).not.toBeNull()
    expect(item!.id).toBe('item-7')
    expect(item!.rarity).toBe('legendary')
    expect(item!.slot).toBe('weapon')
    expect(item!.name).toBe('Щербатый Змеезуб')
    const base = item!.mods.filter((m) => m.kind === 'base')
    expect(base.map((m) => m.stat).sort()).toEqual([
      'weaponDamageMax',
      'weaponDamageMin',
      'weaponSpeed',
    ])
    expect(base.every((m) => m.source === 'equipment:weapon')).toBe(true)
    const by = (stat: string) => base.find((m) => m.stat === stat)!.value.toNumber()
    expect(by('weaponSpeed')).toBeCloseTo(1.4, 9)
    expect(by('weaponDamageMin')).toBe(112) // 7 * bonusMult 16
    expect(by('weaponDamageMax')).toBe(224) // 14 * bonusMult 16
  })

  it('броня даёт обычные модификаторы, без base', () => {
    // Слот 0.25 попадает в отрезок головы (вес оружия 20 из 100).
    const item = rollLoot(seqRng([0, 0, 0.25, 0, 0]), 1)
    expect(item!.slot).toBe('head')
    expect(item!.name).toBe('Щербатый Шлем')
    expect(item!.mods.some((m) => m.kind === 'base')).toBe(false)
    expect(item!.mods.every((m) => m.source === 'equipment:head')).toBe(true)
    const ap = item!.mods.find((m) => m.stat === 'attackPower')!
    expect(ap.value.toNumber()).toBe(7) // база 7 * bonusMult 1
  })
})

describe('rollSlot', () => {
  it('края рулетки: 0 — оружие, почти 1 — последний слот', () => {
    expect(rollSlot(() => 0)).toBe('weapon')
    expect(rollSlot(() => 0.999999)).toBe(SLOT_IDS[SLOT_IDS.length - 1])
  })
})

// Сид фиксирован: без него spawnMonster выдаёт случайного моба зоны, и тест
// становится плавающим — длина боя зависит от того, кто попался.
describe('дроп в бою', () => {
  function untilLoot(state: GameState, rng: () => number): GameState {
    // Бой обычного моба стартовой зоны идёт около десяти секунд (контракт
    // темпа), поэтому крутим щедрый запас тиков и выходим по первому же луту.
    for (let i = 0; i < 1200; i++) {
      state = tick(state, STEP_MS, rng)
      if (state.combatLog.some((e) => e.type === 'loot')) break
    }
    return state
  }

  it('с моба падает предмет и попадает в инвентарь с записью в лог', () => {
    // Автонадевание выключено: проверяем путь «дроп -> инвентарь».
    const s = untilLoot({ ...createInitialState(1), autoEquip: false }, () => 0)
    expect(s.inventory.length).toBe(1)
    expect(s.combatLog.some((e) => e.type === 'loot')).toBe(true)
  })

  it('с включённым автонадеванием предмет сразу уходит в слот', () => {
    // rng 0 -> слот оружия: безоружный герой обязан счесть его апгрейдом.
    const s = untilLoot(createInitialState(1), () => 0)
    expect(s.equipment.weapon).not.toBeNull()
    expect(s.inventory).toEqual([]) // из инвентаря предмет ушёл на героя
    expect(s.stats.weaponSpeed).toBeCloseTo(1.4, 9) // база боя от оружия
  })

  it('автонадевание не трогает предмет, который хуже надетого', () => {
    const s = untilLoot(createInitialState(1), () => 0)
    const equipped = s.equipment.weapon!
    // Второй такой же дроп не лучше первого — остаётся в инвентаре.
    const after = untilLoot({ ...s, combatLog: [] }, () => 0)
    expect(after.equipment.weapon?.id).toBe(equipped.id)
    expect(after.inventory.length).toBe(1)
  })

  it('при полном инвентаре предмет не падает', () => {
    const full: Item[] = Array.from({ length: INVENTORY_SIZE }, (_, i) => ({
      id: `item-${i}`,
      name: 'Ржавый Хват',
      rarity: 'common',
      slot: 'hands',
      mods: [
        { stat: 'attackPower', kind: 'flat', value: new Decimal(1), source: 'equipment:hands' },
      ],
    }))
    let s: GameState = { ...createInitialState(1), inventory: full, itemSeq: INVENTORY_SIZE }
    for (let i = 0; i < 40; i++) s = tick(s, STEP_MS, () => 0)
    expect(s.inventory.length).toBe(INVENTORY_SIZE)
  })
})

describe('продажа', () => {
  const item: Item = {
    id: 'item-1',
    name: 'Верный Оберег',
    rarity: 'rare',
    slot: 'trinket',
    mods: [
      { stat: 'attackPower', kind: 'flat', value: new Decimal(4), source: 'equipment:trinket' },
    ],
  }

  it('превращает предмет в золото по цене тира', () => {
    const s: GameState = { ...createInitialState(1), inventory: [item] }
    const after = sellItem(s, 'item-1')
    expect(after.inventory.length).toBe(0)
    // база 5 * sellMult(rare) 5 = 25 золота
    expect(after.gold.minus(s.gold).toNumber()).toBe(25)
    expect(sellPrice(item).toNumber()).toBe(25)
  })

  it('надетый предмет продать нельзя — сперва снять', () => {
    const s: GameState = { ...createInitialState(1), inventory: [item] }
    const equipped = equipItem(s, 'item-1')
    expect(equipped.equipment.trinket?.id).toBe('item-1')
    const after = sellItem(equipped, 'item-1')
    expect(after).toBe(equipped) // золото не начислено, предмет на месте
    expect(after.equipment.trinket?.id).toBe('item-1')
  })

  it('несуществующий id — состояние не меняется', () => {
    const s: GameState = { ...createInitialState(1), inventory: [item] }
    expect(sellItem(s, 'нет-такого')).toBe(s)
  })
})
