// Фикстуры реальных сейвов всех версий формата: миграции обязаны привести
// каждую к текущей версии, не потеряв прогресс.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { createInitialState, type GameState } from '../tick'
import {
  SAVE_KEY,
  SAVE_VERSION,
  decodeSaveString,
  encodeSaveString,
  loadGame,
  migrateSave,
  stateFromPayload,
  type SaveStorage,
} from '../save'

function fixture(name: string): string {
  return readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), 'utf8')
}

function storageWith(raw: string): SaveStorage {
  const data = new Map<string, string>([[SAVE_KEY, raw]])
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) }
}

function loadFixture(name: string): GameState {
  const result = loadGame({ storage: storageWith(fixture(name)), now: () => 0 })
  expect(result.kind).toBe('loaded')
  if (result.kind !== 'loaded') throw new Error('unreachable')
  return result.state
}

describe('фикстуры сейвов', () => {
  it.each([
    ['save-v0.json'],
    ['save-v1.json'],
    ['save-v2.json'],
  ])('%s мигрирует до текущей версии', (name) => {
    const payload = migrateSave(JSON.parse(fixture(name)))
    expect(payload).not.toBeNull()
    expect(payload!.version).toBe(SAVE_VERSION)
  })

  it('save-v0: доверсионные поля (xp, damagePerSecond) не потеряны', () => {
    const s = loadFixture('save-v0.json')
    expect(s.gold.toNumber()).toBe(150)
    expect(s.level.toNumber()).toBe(4)
    expect(s.currentXp.toNumber()).toBe(11)
    expect(s.baseDamage.toNumber()).toBe(13)
  })

  it('save-v1: прогресс и апгрейды не потеряны, инвентарь пуст', () => {
    const s = loadFixture('save-v1.json')
    expect(s.gold.toNumber()).toBe(77)
    expect(s.level.toNumber()).toBe(5)
    expect(s.currentXp.toNumber()).toBe(3)
    expect(s.baseDamage.toNumber()).toBe(12)
    expect(s.upgrades['weapon-sharpening'].toNumber()).toBe(2)
    expect(s.inventory).toEqual([])
  })

  it('save-v2: инвентарь и счётчики не потеряны', () => {
    const s = loadFixture('save-v2.json')
    expect(s.gold.toNumber()).toBe(500)
    expect(s.level.toNumber()).toBe(9)
    expect(s.upgrades['weapon-sharpening'].toNumber()).toBe(11)
    expect(s.inventory.length).toBe(2)
    expect(s.inventory[0].name).toBe('Звёздный Палаш')
    expect(s.inventory[0].rarity).toBe('epic')
    expect(s.inventory[0].statBonus.toNumber()).toBe(8)
    expect(s.itemSeq).toBe(2)
    expect(s.totalTicks.toNumber()).toBe(5000)
  })
})

describe('экспорт -> импорт', () => {
  it('восстанавливает то же состояние', () => {
    const original: GameState = {
      ...createInitialState(1),
      gold: new Decimal('1.5e30'),
      level: new Decimal(77),
      currentXp: new Decimal(123),
      baseDamage: new Decimal(88),
      upgrades: { 'weapon-sharpening': new Decimal(67) },
      inventory: [
        { id: 'item-9', name: 'Сумрачный Бердыш', rarity: 'legendary', statBonus: new Decimal(16) },
      ],
      itemSeq: 10,
    }
    const payload = decodeSaveString(encodeSaveString(original, () => 0))
    expect(payload).not.toBeNull()
    const restored = stateFromPayload(payload!)
    expect(restored.gold.eq(original.gold)).toBe(true)
    expect(restored.level.eq(original.level)).toBe(true)
    expect(restored.currentXp.eq(original.currentXp)).toBe(true)
    expect(restored.baseDamage.eq(original.baseDamage)).toBe(true)
    expect(restored.upgrades['weapon-sharpening'].eq(new Decimal(67))).toBe(true)
    expect(restored.inventory).toHaveLength(1)
    expect(restored.inventory[0]).toMatchObject({ id: 'item-9', rarity: 'legendary' })
    expect(restored.itemSeq).toBe(10)
  })
})
