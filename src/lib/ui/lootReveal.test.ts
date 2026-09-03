import { describe, expect, it } from 'vitest'
import { emptyRevealQueue, enqueueReveals, showNext } from './lootReveal'
import type { CombatEvent, Item } from '../types'
import { Decimal } from '../game'

const item = (name: string, rarity: Item['rarity']): Item => ({
  id: name,
  name,
  slot: 'head',
  rarity,
  level: 1,
  mods: [],
  templateId: 'test',
  grip: null,
  procId: null,
  enchantId: null,
  value: new Decimal(1),
} as unknown as Item)

const loot = (name: string, rarity: Item['rarity']): CombatEvent =>
  ({ type: 'loot', item: item(name, rarity) }) as CombatEvent

describe('очередь вспышек находок', () => {
  it('вспышку получают только тиры, у которых она есть в данных', () => {
    const q = enqueueReveals(emptyRevealQueue(), [loot('обычный', 'common'), loot('редкий', 'rare')])
    expect(q.current).toBeNull()
    expect(q.pending).toEqual([])
  })

  it('N находок подряд дают ровно N показов, и все снимаются сами', () => {
    const names = ['первая', 'вторая', 'третья', 'четвёртая']
    let q = enqueueReveals(
      emptyRevealQueue(),
      names.map((n) => loot(n, 'epic')),
    )
    const shown: string[] = []
    // Двигает очередь ТОЛЬКО время: игрок вспышку коснуться не может.
    while (q.current) {
      shown.push(q.current.item.name)
      q = showNext(q)
    }
    expect(shown).toEqual(names)
    expect(q.pending).toEqual([])
  })

  it('пачка из одного тика не схлопывается: две легендарки — две вспышки', () => {
    let q = enqueueReveals(emptyRevealQueue(), [loot('а', 'legendary'), loot('б', 'legendary')])
    expect(q.current?.item.name).toBe('а')
    q = showNext(q)
    expect(q.current?.item.name).toBe('б')
  })

  it('у каждого показа свой номер — иначе разметка не перезапустит появление', () => {
    let q = enqueueReveals(emptyRevealQueue(), [loot('а', 'epic'), loot('б', 'epic')])
    const first = q.current!.key
    q = showNext(q)
    expect(q.current!.key).toBeGreaterThan(first)
  })

  it('новая находка во время показа встаёт в очередь, а не вытесняет текущую', () => {
    let q = enqueueReveals(emptyRevealQueue(), [loot('идёт', 'epic')])
    q = enqueueReveals(q, [loot('пришла', 'epic')])
    expect(q.current?.item.name).toBe('идёт')
    expect(q.pending.map((i) => i.name)).toEqual(['пришла'])
  })
})
