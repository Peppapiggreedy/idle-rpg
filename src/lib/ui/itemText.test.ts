import { describe, expect, it } from 'vitest'
import { itemSlotLabel } from './itemText'

describe('подпись предмета', () => {
  it('одноручное называется хватом, а не рукой, в которую упало', () => {
    expect(itemSlotLabel({ slot: 'offHand', grip: 'one' })).toBe('Одноручное')
    expect(itemSlotLabel({ slot: 'mainHand', grip: 'one' })).toBe('Одноручное')
  })

  it('двуручное называется двуручным', () => {
    expect(itemSlotLabel({ slot: 'mainHand', grip: 'two' })).toBe('Двуручное')
  })

  it('щит называется левой рукой: он и правда носится только там', () => {
    expect(itemSlotLabel({ slot: 'offHand', grip: 'shield' })).toBe('Левая рука')
  })

  it('у брони хвата нет, и подпись остаётся позиционной', () => {
    expect(itemSlotLabel({ slot: 'head' })).toBe('Голова')
    expect(itemSlotLabel({ slot: 'trinket' })).toBe('Талисман')
  })
})
