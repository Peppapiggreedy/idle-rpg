import { describe, expect, it } from 'vitest'
import { createInitialState, ensureStats, type GameState } from '../game'
import { inventorySize } from '../game/upgrades'
import { SLOT_IDS, type SlotId } from '../data/slots'
import { EQUIP_BLOCK_TEXT, UNEQUIP_BLOCK_TEXT } from './itemText'
import { bagOutcome, slotOutcome } from './dropTarget'
import type { Carry } from '../stores/ui'
import type { Grip } from '../data/items'
import type { Item, Rarity } from '../types'

// ТРИ ПУТИ НАДЕТЬ ВЕЩЬ ЗОВУТ ОДНУ ФУНКЦИЮ, и проверяется здесь именно она.
// Тесты путей — в `tests/doll.spec.ts` (живая страница); тесты правил —
// здесь, потому что до половины отказов на живой странице не добраться:
// щит в главной руке лут не выдаёт, и ждать его от рулетки было бы не
// проверкой, а гаданием.

let seq = 0
function item(patch: Partial<Item> = {}): Item {
  seq += 1
  return {
    id: `test-${seq}`,
    name: 'Пробная вещь',
    rarity: 'common' as Rarity,
    slot: 'chest' as SlotId,
    level: 10,
    mods: [],
    ...patch,
  }
}

const weapon = (grip: Grip, slot: SlotId = 'mainHand') =>
  item({ grip, slot, name: `Оружие (${grip})` })

function withBag(items: Item[]): GameState {
  return ensureStats({ ...createInitialState(1), inventory: items, statsDirty: true })
}

const carryBag = (i: Item): Carry => ({ from: 'bag', itemId: i.id })

describe('куда можно положить несомое', () => {
  it('ничего не несём — ни один слот не отзывается', () => {
    const state = withBag([])
    for (const slot of SLOT_IDS) {
      expect(slotOutcome(state, null, slot)).toEqual({ fits: false, allowed: false, reason: null })
    }
    expect(bagOutcome(state, null).fits).toBe(false)
  })

  it('подходит РОВНО ОДИН слот — тот, в который вещь бросил лут', () => {
    const helmet = item({ slot: 'head' })
    const state = withBag([helmet])
    const fitting = SLOT_IDS.filter((s) => slotOutcome(state, carryBag(helmet), s).fits)
    expect(fitting).toEqual(['head'])
    expect(slotOutcome(state, carryBag(helmet), 'head').allowed).toBe(true)
  })

  it('своей вещи в сумке нет — не отзывается ничего', () => {
    // Вещь могли продать, распылить или надеть, пока её «несли».
    const ghost = item({ slot: 'head' })
    const state = withBag([])
    expect(slotOutcome(state, carryBag(ghost), 'head').fits).toBe(false)
  })
})

describe('каждый код отказа доезжает до куклы', () => {
  it('shield-offhand-only: щит просят в главную руку', () => {
    // Такой щит лут не выдаёт, но правило существует — и если оно однажды
    // сработает, игрок обязан прочитать причину, а не увидеть мёртвый слот.
    const shield = weapon('shield', 'mainHand')
    const state = withBag([shield])
    const out = slotOutcome(state, carryBag(shield), 'mainHand')
    expect(out.fits).toBe(true)
    expect(out.allowed).toBe(false)
    expect(out.reason).toBe('shield-offhand-only')
    expect(EQUIP_BLOCK_TEXT[out.reason!]).toBeTruthy()
  })

  it('occupied-by-two-handed: во вторую руку при надетом двуручном', () => {
    const twoHander = weapon('two')
    const offhand = weapon('one', 'offHand')
    const state = ensureStats({
      ...withBag([offhand]),
      equipment: { ...createInitialState(1).equipment, mainHand: twoHander, offHand: null },
      statsDirty: true,
    })
    const out = slotOutcome(state, carryBag(offhand), 'offHand')
    expect(out.fits).toBe(true)
    expect(out.allowed).toBe(false)
    expect(out.reason).toBe('occupied-by-two-handed')
    expect(EQUIP_BLOCK_TEXT[out.reason!]).toBeTruthy()
  })

  it('two-handed-needs-both: снятому некуда лечь', () => {
    // Двуручное освобождает вторую руку, снятое уходит в сумку — а сумка
    // полна. Набиваем её ровно до размера, который у ЭТОГО героя.
    const twoHander = weapon('two')
    const base = createInitialState(1)
    const size = inventorySize(base)
    const filler = Array.from({ length: size - 1 }, () => item())
    const state = ensureStats({
      ...base,
      inventory: [twoHander, ...filler],
      equipment: { ...base.equipment, mainHand: weapon('one'), offHand: weapon('one', 'offHand') },
      statsDirty: true,
    })
    const out = slotOutcome(state, carryBag(twoHander), 'mainHand')
    expect(out.fits).toBe(true)
    expect(out.allowed).toBe(false)
    expect(out.reason).toBe('two-handed-needs-both')
    expect(EQUIP_BLOCK_TEXT[out.reason!]).toBeTruthy()
  })

  it('inventory-full: надетое бросают в полную сумку', () => {
    const base = createInitialState(1)
    const size = inventorySize(base)
    const state = ensureStats({
      ...base,
      inventory: Array.from({ length: size }, () => item()),
      equipment: { ...base.equipment, chest: item({ slot: 'chest' }) },
      statsDirty: true,
    })
    const out = bagOutcome(state, { from: 'slot', slot: 'chest' })
    expect(out.fits).toBe(true)
    expect(out.allowed).toBe(false)
    expect(out.reason).toBe('inventory-full')
    expect(UNEQUIP_BLOCK_TEXT[out.reason!]).toBeTruthy()
  })

  it('empty-slot: тащить из пустого слота нечего', () => {
    const state = withBag([])
    const out = bagOutcome(state, { from: 'slot', slot: 'head' })
    expect(out.allowed).toBe(false)
    expect(out.reason).toBe('empty-slot')
    expect(UNEQUIP_BLOCK_TEXT[out.reason!]).toBeTruthy()
  })

  it('у КАЖДОГО кода есть строка для игрока', () => {
    // Кода без слов быть не может: молчаливое «нельзя» читается как поломка.
    for (const text of Object.values(EQUIP_BLOCK_TEXT)) expect(text.length).toBeGreaterThan(10)
    for (const text of Object.values(UNEQUIP_BLOCK_TEXT)) expect(text.length).toBeGreaterThan(5)
  })
})

describe('снятие перетаскиванием', () => {
  it('надетое в сумку — можно, находка в сумку — не действие', () => {
    const base = createInitialState(1)
    const found = item({ slot: 'head' })
    const state = ensureStats({
      ...base,
      inventory: [found],
      equipment: { ...base.equipment, chest: item({ slot: 'chest' }) },
      statsDirty: true,
    })
    expect(bagOutcome(state, { from: 'slot', slot: 'chest' })).toEqual({
      fits: true,
      allowed: true,
      reason: null,
    })
    expect(bagOutcome(state, carryBag(found)).fits).toBe(false)
  })

  it('надетое на другой слот куклы не кладётся: игра менять слоты не умеет', () => {
    const base = createInitialState(1)
    const state = ensureStats({
      ...base,
      equipment: { ...base.equipment, chest: item({ slot: 'chest' }) },
      statsDirty: true,
    })
    for (const slot of SLOT_IDS) {
      expect(slotOutcome(state, { from: 'slot', slot: 'chest' }, slot).fits).toBe(false)
    }
  })
})
