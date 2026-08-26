import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { INVENTORY_SIZE, rollLoot, rollRarity, sellItem, sellPrice } from './loot'
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

  it('генерирует предмет с именем из шаблонов и бонусом по тиру', () => {
    // Броски: шанс дропа, редкость (почти 1 = legendary), прилагательное, существительное.
    const item = rollLoot(seqRng([0, 0.999999, 0, 0]), 7)
    expect(item).not.toBeNull()
    expect(item!.id).toBe('item-7')
    expect(item!.rarity).toBe('legendary')
    expect(item!.name).toBe('Щербатый Клинок')
    expect(item!.statBonus.toNumber()).toBe(16) // база 1 * bonusMult 16
  })
})

describe('дроп в бою', () => {
  function killOneMonster(state: GameState, rng: () => number): GameState {
    // 30 hp при 10 dps: 30 тиков до смерти
    for (let i = 0; i < 31 && state.inventory.length === 0; i++) state = tick(state, STEP_MS, rng)
    return state
  }

  it('с моба падает предмет и попадает в инвентарь с записью в лог', () => {
    const s = killOneMonster(createInitialState(), () => 0)
    expect(s.inventory.length).toBe(1)
    expect(s.combatLog.some((l) => l.startsWith('Выпало:'))).toBe(true)
  })

  it('при полном инвентаре предмет не падает', () => {
    const full: Item[] = Array.from({ length: INVENTORY_SIZE }, (_, i) => ({
      id: `item-${i}`,
      name: 'Ржавый Тесак',
      rarity: 'common',
      statBonus: new Decimal(1),
    }))
    let s: GameState = { ...createInitialState(), inventory: full, itemSeq: INVENTORY_SIZE }
    for (let i = 0; i < 40; i++) s = tick(s, STEP_MS, () => 0)
    expect(s.inventory.length).toBe(INVENTORY_SIZE)
  })
})

describe('продажа', () => {
  const item: Item = { id: 'item-1', name: 'Верный Молот', rarity: 'rare', statBonus: new Decimal(4) }

  it('превращает предмет в золото по цене тира', () => {
    const s: GameState = { ...createInitialState(), inventory: [item] }
    const after = sellItem(s, 'item-1')
    expect(after.inventory.length).toBe(0)
    // база 5 * sellMult(rare) 5 = 25 золота
    expect(after.gold.minus(s.gold).toNumber()).toBe(25)
    expect(sellPrice(item).toNumber()).toBe(25)
  })

  it('несуществующий id — состояние не меняется', () => {
    const s: GameState = { ...createInitialState(), inventory: [item] }
    expect(sellItem(s, 'нет-такого')).toBe(s)
  })
})
