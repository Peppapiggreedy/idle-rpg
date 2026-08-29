import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { xpToNextLevel } from './formulas'
import { expectedSwingDamage } from './combat'
import { emptyEquipment, createInitialState, type GameState } from './tick'
import { zoneRate } from './zones'
import { SAFE_ZONE, zoneMonsterVariants } from '../data/zones'
import {
  OFFLINE_CAP_MS,
  SAVE_KEY,
  applyOfflineProgress,
  clearSave,
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
    removeItem: (k) => void data.delete(k),
  }
}

function richState(): GameState {
  return {
    ...createInitialState(),
    gold: new Decimal('125000000'),
    level: new Decimal(42),
    currentXp: new Decimal(1500),
    xpToNext: xpToNextLevel(new Decimal(42)),
    upgrades: { 'weapon-sharpening': new Decimal(54) },
    totalTicks: new Decimal(100000),
    playtimeMs: new Decimal(10_000_000),
    inventory: [
      {
        id: 'item-0',
        name: 'Звёздный Оберег',
        rarity: 'epic',
        slot: 'trinket',
        mods: [
          { stat: 'attackPower', kind: 'flat', value: new Decimal(8), source: 'equipment:trinket' },
        ],
      },
    ],
    equipment: {
      ...emptyEquipment(),
      mainHand: {
        id: 'item-1',
        name: 'Верный Полуторник',
        rarity: 'rare',
        slot: 'mainHand',
        hands: 1,
        mods: [
          { stat: 'weaponSpeed', kind: 'base', value: new Decimal(2.2), source: 'equipment:mainHand' },
          { stat: 'weaponDamageMin', kind: 'base', value: new Decimal(44), source: 'equipment:mainHand' },
          { stat: 'weaponDamageMax', kind: 'base', value: new Decimal(88), source: 'equipment:mainHand' },
        ],
      },
    },
    autoEquip: false,
    itemSeq: 2,
  }
}

const HOUR = 60 * 60 * 1000

// Доля времени, которую герой в стартовой зоне жив: потолок роста награды.
function zoneUptime(state: GameState): number {
  return zoneRate(state, SAFE_ZONE).uptime
}

describe('стирание сейва', () => {
  // «Начать заново» обязано именно СТЕРЕТЬ: переписанный пустым сейв — это
  // по-прежнему сейв, и загрузка сочтёт игру начатой. В игре на этом ломался
  // выбор класса: после «сброса» он не возвращался никогда.
  it('после clearSave загрузка видит чистое место, а не свежий сейв', () => {
    const storage = makeStorage()
    saveGame(richState(), { storage, now: () => 1000 })
    expect(loadGame({ storage, now: () => 1000 }).kind).toBe('loaded')

    clearSave({ storage })
    expect(storage.data.has(SAVE_KEY)).toBe(false)
    expect(loadGame({ storage, now: () => 1000 }).kind).toBe('fresh')
  })

  it('стирать нечего — не падает', () => {
    const storage = makeStorage()
    expect(() => clearSave({ storage })).not.toThrow()
  })
})

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
    // v1 хранил 12 dps = 10 базовых + 2 заточки; средний удар: 20 + 2*2 = 24
    expect(expectedSwingDamage(s.stats).toNumber()).toBe(24)
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
    expect(item.name).toBe('Звёздный Оберег')
    expect(item.rarity).toBe('epic')
    expect(item.slot).toBe('trinket')
    expect(item.mods[0].value.toNumber()).toBe(8)
    expect(result.state.itemSeq).toBe(2)
  })

  it('надетая экипировка переживает сохранение и продолжает задавать базу боя', () => {
    const storage = makeStorage()
    saveGame(richState(), { storage, now: () => 0 })
    const result = loadGame({ storage, now: () => 0 })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    const weapon = result.state.equipment.mainHand
    expect(weapon?.name).toBe('Верный Полуторник')
    // Три base-модификатора оружия снова задают базу конвейера статов.
    expect(result.state.stats.weaponSpeed).toBeCloseTo(2.2, 9)
    expect(result.state.stats.weaponDamageMin.toNumber()).toBe(44)
    expect(result.state.stats.weaponDamageMax.toNumber()).toBe(88)
    expect(result.state.autoEquip).toBe(false)
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
  })

  it('награда растёт со временем отсутствия, но не быстрее линейного', () => {
    const base = createInitialState()
    const hour = applyOfflineProgress(base, HOUR).report!
    const fourHours = applyOfflineProgress(base, 4 * HOUR).report!
    expect(fourHours.gold.gt(hour.gold)).toBe(true)
    // Не меньше линейного: за четыре часа герой набирает уровни, а с ними
    // живучесть, так что темп может только вырасти. И не больше потолка —
    // идеального фарма без единой смерти. Épsilon — на округления Decimal.
    const linear = hour.gold.times(4)
    expect(fourHours.gold.gte(linear.times(0.999))).toBe(true)
    expect(fourHours.gold.lte(linear.div(zoneUptime(base)).times(1.001))).toBe(true)
  })

  it('золото и опыт согласованы с наградами мобов зоны', () => {
    const base = createInitialState()
    const { state, report } = applyOfflineProgress(base, HOUR)
    expect(report).not.toBeNull()
    // Всё начисленное золото попало в состояние.
    expect(state.gold.minus(base.gold).eq(report!.gold)).toBe(true)
    // Золота за убийство — между самым бедным и самым богатым мобом зоны.
    const rewards = zoneMonsterVariants(SAFE_ZONE).map((m) => m.goldReward)
    const goldPerKill = report!.gold.div(report!.kills)
    expect(goldPerKill.gte(rewards.reduce((a, b) => (a.lt(b) ? a : b)))).toBe(true)
    expect(goldPerKill.lte(rewards.reduce((a, b) => (a.gt(b) ? a : b)))).toBe(true)
    expect(report!.xp.gt(0)).toBe(true)
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
