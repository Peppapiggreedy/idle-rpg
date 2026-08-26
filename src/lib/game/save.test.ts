import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { xpToNextLevel } from './formulas'
import { createInitialState, RESPAWN_DELAY_MS, type GameState } from './tick'
import {
  OFFLINE_CAP_MS,
  SAVE_KEY,
  applyOfflineProgress,
  decodeSaveString,
  encodeSaveString,
  loadGame,
  saveGame,
  type SaveStorage,
} from './save'

function makeStorage(): SaveStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

function richState(): GameState {
  return {
    ...createInitialState(),
    gold: new Decimal('125000000'),
    level: new Decimal(42),
    currentXp: new Decimal(1500),
    xpToNext: xpToNextLevel(new Decimal(42)),
    baseDamage: new Decimal(64),
    upgrades: { 'weapon-sharpening': new Decimal(54) },
    totalTicks: new Decimal(100000),
    playtimeMs: new Decimal(10_000_000),
    inventory: [
      { id: 'item-0', name: 'Звёздный Палаш', rarity: 'epic', statBonus: new Decimal(8) },
    ],
    itemSeq: 1,
  }
}

const HOUR = 60 * 60 * 1000

describe('save/load', () => {
  it('сохранение и загрузка не теряют состояние', () => {
    const storage = makeStorage()
    const t0 = 1_000_000_000_000
    saveGame(richState(), { storage, now: () => t0 })
    const result = loadGame({ storage, now: () => t0 }) // время не прошло
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    const s = result.state
    expect(s.gold.toString()).toBe('125000000')
    expect(s.level.toNumber()).toBe(42)
    expect(s.currentXp.toNumber()).toBe(1500)
    expect(s.xpToNext.eq(xpToNextLevel(new Decimal(42)))).toBe(true)
    expect(s.baseDamage.toNumber()).toBe(64)
    expect(s.upgrades['weapon-sharpening'].toNumber()).toBe(54)
    expect(result.offline).toBeNull()
    // Моб после загрузки свежий и с полным HP.
    expect(s.monster.currentHp.eq(s.monster.maxHp)).toBe(true)
  })

  it('сейв версии 1 (без инвентаря) мигрирует без потери прогресса', () => {
    const storage = makeStorage()
    // Ровно такой JSON писала версия игры с форматом сейва v1.
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        version: 1,
        lastTimestamp: 1000,
        gold: '77',
        level: '5',
        currentXp: '3',
        baseDamage: '12',
        upgrades: { 'weapon-sharpening': '2' },
        totalTicks: '10',
        playtimeMs: '1000',
      }),
    )
    const result = loadGame({ storage, now: () => 1000 })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    const s = result.state
    expect(s.gold.toNumber()).toBe(77)
    expect(s.level.toNumber()).toBe(5)
    expect(s.currentXp.toNumber()).toBe(3)
    expect(s.baseDamage.toNumber()).toBe(12)
    expect(s.upgrades['weapon-sharpening'].toNumber()).toBe(2)
    expect(s.inventory).toEqual([])
    expect(s.itemSeq).toBe(0)
  })

  it('инвентарь переживает сохранение и загрузку', () => {
    const storage = makeStorage()
    saveGame(richState(), { storage, now: () => 0 })
    const result = loadGame({ storage, now: () => 0 })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    const item = result.state.inventory[0]
    expect(item.name).toBe('Звёздный Палаш')
    expect(item.rarity).toBe('epic')
    expect(item.statBonus.toNumber()).toBe(8)
    expect(result.state.itemSeq).toBe(1)
  })

  it('сейв прошлой версии (v0, без поля version) мигрирует без потери прогресса', () => {
    const storage = makeStorage()
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({ gold: '50', level: '3', currentXp: '7', lastTimestamp: 500 }),
    )
    const result = loadGame({ storage, now: () => 500 })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    expect(result.state.gold.toNumber()).toBe(50)
    expect(result.state.level.toNumber()).toBe(3)
    expect(result.state.currentXp.toNumber()).toBe(7)
    expect(result.state.xpToNext.eq(xpToNextLevel(new Decimal(3)))).toBe(true)
  })

  it('повреждённая строка не роняет игру: понятная ошибка и чистый старт', () => {
    const storage = makeStorage()
    storage.setItem(SAVE_KEY, 'это не json {{{')
    const result = loadGame({ storage })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.reason).toBe('corrupted')
  })

  it('сейв из будущей версии не загружается, но и не роняет игру', () => {
    const storage = makeStorage()
    storage.setItem(SAVE_KEY, JSON.stringify({ version: 99, gold: '1' }))
    const result = loadGame({ storage })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.reason).toBe('newer-version')
  })

  it('пустое хранилище — свежий старт без ошибок', () => {
    expect(loadGame({ storage: makeStorage() }).kind).toBe('fresh')
  })
})

describe('оффлайн-прогресс', () => {
  it('100 часов отсутствия дают награду ровно за 8', () => {
    const base = createInitialState()
    const after100h = applyOfflineProgress(base, 100 * HOUR)
    const after8h = applyOfflineProgress(base, 8 * HOUR)
    expect(after100h.report).not.toBeNull()
    expect(after100h.report!.kills.eq(after8h.report!.kills)).toBe(true)
    expect(after100h.state.gold.eq(after8h.state.gold)).toBe(true)
    expect(after100h.report!.elapsedMs).toBe(OFFLINE_CAP_MS)
    // Контроль формулы: цикл убийства = 30hp/10dps + 0.3с респаун = 3.3с.
    const cycleSec = 30 / 10 + RESPAWN_DELAY_MS / 1000
    expect(after8h.report!.kills.toNumber()).toBe(Math.floor((8 * 3600) / cycleSec))
  })

  it('награда считается агрегатом: золото = убийства * награда моба', () => {
    const base = createInitialState()
    const { state, report } = applyOfflineProgress(base, HOUR)
    expect(report).not.toBeNull()
    expect(state.gold.eq(report!.kills.times(base.monster.goldReward))).toBe(true)
    expect(report!.xp.eq(report!.kills.times(base.monster.xpReward))).toBe(true)
  })

  it('loadGame начисляет оффлайн-награду за прошедшее время', () => {
    const storage = makeStorage()
    const t0 = 1_000_000_000_000
    saveGame(createInitialState(), { storage, now: () => t0 })
    const result = loadGame({ storage, now: () => t0 + HOUR })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    expect(result.offline).not.toBeNull()
    expect(result.offline!.kills.gt(0)).toBe(true)
    expect(result.state.gold.eq(result.offline!.gold)).toBe(true)
  })

  it('отрицательная разница времени (часы назад) не начисляет ничего', () => {
    const storage = makeStorage()
    saveGame(richState(), { storage, now: () => 1_000_000 })
    const result = loadGame({ storage, now: () => 500_000 }) // «раньше», чем сейв
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    expect(result.offline).toBeNull()
    expect(result.state.gold.toString()).toBe('125000000')
  })
})

describe('экспорт/импорт', () => {
  it('строка экспорта декодируется в тот же сейв', () => {
    const s = richState()
    const encoded = encodeSaveString(s, () => 42)
    const payload = decodeSaveString(encoded)
    expect(payload).not.toBeNull()
    expect(payload!.gold).toBe('125000000')
    expect(payload!.level).toBe('42')
    expect(payload!.lastTimestamp).toBe(42)
  })

  it('мусорная строка импорта даёт null, а не исключение', () => {
    expect(decodeSaveString('абракадабра')).toBeNull()
    expect(decodeSaveString('')).toBeNull()
  })
})
