import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { xpToNextLevel } from './formulas'
import { expectedSwingDamage } from './combat'
import { emptyEquipment, createInitialState, type GameState } from './tick'
import { zoneRate } from './zones'
import { SAFE_ZONE, zoneMonsterVariants } from '../data/zones'
import {
  MIGRATIONS,
  OFFLINE_CAP_MS,
  SAVE_BACKUP_KEY,
  SAVE_KEY,
  SAVE_VERSION,
  applyOfflineProgress,
  clearSave,
  decodeSaveString,
  encodeSaveString,
  loadGame,
  payloadFromState,
  readBackupSave,
  readSave,
  saveGame,
  stateFromPayload,
  type LoadErrorReason,
  type SaveStorage,
} from './save'
import { ensureStats } from './stats'
import { TEMPLE } from '../data/temple'

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
    totalTicks: new Decimal(100000),
    playtimeMs: new Decimal(10_000_000),
    inventory: [
      {
        id: 'item-0',
        name: 'Звёздный Оберег',
        rarity: 'epic',
        slot: 'trinket',
        level: 9,
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
        level: 12,
        grip: 'one',
        mods: [
          { stat: 'weaponSpeed', kind: 'base', value: new Decimal(2.2), source: 'equipment:mainHand' },
          { stat: 'weaponDamageMin', kind: 'base', value: new Decimal(44), source: 'equipment:mainHand' },
          { stat: 'weaponDamageMax', kind: 'base', value: new Decimal(88), source: 'equipment:mainHand' },
        ],
      },
    },
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

// ЭТОТ БЛОК ПОЯВИЛСЯ ИЗ ПОЛОМКИ (находка 2.1 в AUDIT.md). Игра штамповала
// свои сейвы номером 20 при SAVE_VERSION = 21, поэтому миграция 20→21
// прокручивалась на КАЖДОЙ загрузке и стирала флаг полной зачистки храма.
// Ни один тест этого не замечал: проверялась версия только у РЕЗУЛЬТАТА
// миграции, где она уже 21 по определению.
describe('версия сейва', () => {
  it('игра пишет сейв ТЕКУЩЕЙ версии', () => {
    // Одна строка, которой не было. Она и есть весь тест на эту поломку.
    expect(payloadFromState(richState(), 0).version).toBe(SAVE_VERSION)
  })

  it('сериализация — неподвижная точка: запись, чтение, запись дают то же', () => {
    // Загрузка не имеет права ничего менять в сейве. Если меняет — значит,
    // на нём срабатывает миграция, а срабатывать ей уже не на чем.
    const once = payloadFromState(richState(), 0)
    const twice = payloadFromState(ensureStats(stateFromPayload(once)), 0)
    expect(twice).toEqual(once)
  })

  it('свежий сейв не прогоняется через миграцию: флаг зачистки храма цел', () => {
    const storage = makeStorage()
    const cleared: GameState = ensureStats({
      ...richState(),
      templeBestWave: TEMPLE.floors,
      templeCleared: true,
      statsDirty: true,
    })
    saveGame(cleared, { storage, now: () => 0 })
    const result = loadGame({ storage, now: () => 0 })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    // Раньше здесь было false: миграция 20→21 сбрасывала флаг на каждой
    // загрузке, и уникальный рецепт «Венец испытаний» пропадал навсегда —
    // повторная зачистка не помогала, потому что рекорд уже на потолке.
    expect(result.state.templeCleared).toBe(true)
    expect(result.state.templeBestWave).toBe(TEMPLE.floors)
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
    // Абсолютное число опыта миграция v19 пересчитала под новую кривую;
    // сохраняется ДОЛЯ пройденного уровня — полоска стоит там же, где стояла.
    // Старая кривая: 40 * 5^1.5 = 447 опыта на уровень, из них пройдено 3.
    expect(s.currentXp.div(s.xpToNext).toNumber()).toBeCloseTo(3 / 447, 2)
    // v1 хранил 12 dps = 10 базовых + 2 заточки. Заточку снесла миграция v18;
    // остались база и сила с уровней: 10 + (70 + 4 силы * 2) * 2 / 14.
    expect(expectedSwingDamage(s.stats).toNumber()).toBeCloseTo(10 + ((70 + 8) * 2) / 14, 9)
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
    // Уровень предмета — часть его силы и обязан переживать сейв.
    expect(item.level).toBe(9)
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
    // Доля пройденного уровня сохранена: старая кривая давала 40 * 3^1.5 = 207.
    expect(result.state.currentXp.div(result.state.xpToNext).toNumber()).toBeCloseTo(7 / 207, 2)
    expect(result.state.xpToNext.eq(xpToNextLevel(new Decimal(3)))).toBe(true)
  })

  it('повреждённая строка не роняет игру: понятная ошибка и чистый старт', () => {
    const storage = makeStorage()
    storage.setItem(SAVE_KEY, 'это не json {{{')
    const result = loadGame({ storage })
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.reason).toBe('corrupt')
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

  it('награда растёт со временем отсутствия — быстрее линейного, но не взрывом', () => {
    const base = createInitialState()
    const hour = applyOfflineProgress(base, HOUR).report!
    const fourHours = applyOfflineProgress(base, 4 * HOUR).report!
    expect(fourHours.gold.gt(hour.gold)).toBe(true)
    // НЕ МЕНЬШЕ линейного: за четыре часа герой набирает уровни, а с ними
    // атрибуты, — темп следующего шага может только вырасти. Эпсилон — на
    // округления Decimal.
    const linear = hour.gold.times(4)
    expect(fourHours.gold.gte(linear.times(0.999))).toBe(true)
    // И не взрывом: рост от уровней ограничен, восемь часов оффлайна не
    // должны стоить как неделя игры.
    expect(fourHours.gold.lte(linear.times(4))).toBe(true)
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

// ПРОГРЕСС НЕЛЬЗЯ ПОТЕРЯТЬ МОЛЧА (находки 2.2, 2.3, 2.4 в AUDIT.md).
//
// Три способа потерять всё разом опирались на одно и то же: отказ хранилища
// глушился пустым catch, причины отказа загрузки были схлопнуты в одну, а
// копии прежнего сейва не делал никто.
describe('отказ хранилища виден, а не проглатывается', () => {
  it('setItem бросает — saveGame отдаёт код, а не исключение', () => {
    const storage: SaveStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('write failed')
      },
      removeItem: () => {},
    }
    const result = saveGame(richState(), { storage, now: () => 0 })
    expect(result).toEqual({ kind: 'error', reason: 'write-failed' })
  })

  it('переполнение квоты отличается от прочих отказов', () => {
    // Браузеры сообщают о нём по-разному, поэтому смотрим на имя, а не на класс.
    const quota = Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    const storage: SaveStorage = {
      getItem: () => null,
      setItem: () => {
        throw quota
      },
      removeItem: () => {},
    }
    const result = saveGame(richState(), { storage, now: () => 0 })
    expect(result).toEqual({ kind: 'error', reason: 'quota-exceeded' })
  })

  it('хранилище бросает на самом ДОСТУПЕ — игра не падает, а отказывает кодом', () => {
    // Safari с запретом cookie и данных сайтов: бросает обращение к свойству,
    // ещё до всякой записи. Раньше это исключение улетало из saveGame наружу.
    const hostile: SaveStorage = {
      get getItem(): never {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('SecurityError')
      },
      removeItem: () => {},
    } as unknown as SaveStorage
    expect(() => saveGame(richState(), { storage: hostile, now: () => 0 })).not.toThrow()
    expect(saveGame(richState(), { storage: hostile, now: () => 0 }).kind).toBe('error')
  })

  it('удачная запись отвечает ok', () => {
    const storage = makeStorage()
    expect(saveGame(richState(), { storage, now: () => 0 })).toEqual({ kind: 'ok' })
  })
})

describe('причина отказа загрузки называется своим кодом', () => {
  // Раньше всё, кроме нечитаемой строки, объявлялось сейвом «из более новой
  // версии»: игрок с испорченным сохранением ждал деплоя, которого не будет.
  const cases: Array<[string, unknown, LoadErrorReason]> = [
    ['версия из будущего', { version: 99, gold: '1' }, 'newer-version'],
    ['версия дробная', { version: 7.5, gold: '1' }, 'corrupt'],
    ['версия отрицательная', { version: -1, gold: '1' }, 'corrupt'],
    ['версия строкой', { version: '12', gold: '1' }, 'corrupt'],
    ['массив', [], 'corrupt'],
    ['число', 42, 'corrupt'],
    ['null', null, 'corrupt'],
    ['пустой объект', {}, 'corrupt'],
    ['посторонний объект без версии', { hello: 'world' }, 'corrupt'],
  ]
  it.each(cases)('%s -> %s', (_label, raw, reason) => {
    const result = readSave(raw)
    expect(result.kind).toBe('error')
    if (result.kind !== 'error') return
    expect(result.reason).toBe(reason)
  })

  it('версия внутри диапазона, но без шага миграции — свой код', () => {
    // Формат из ветки, которая до релиза не дожила. Это не «игра обновилась»
    // и не мусор: игроку об этом надо сказать иначе.
    const gap = Number(Object.keys(MIGRATIONS).at(-1)) + 0 // существующий шаг
    expect(MIGRATIONS[gap]).toBeDefined()
    const saved = MIGRATIONS[gap]
    delete (MIGRATIONS as Record<number, unknown>)[gap]
    try {
      const result = readSave({ version: gap, gold: '1' })
      expect(result.kind).toBe('error')
      if (result.kind !== 'error') return
      expect(result.reason).toBe('unsupported-version')
    } finally {
      ;(MIGRATIONS as Record<number, unknown>)[gap] = saved
    }
  })

  it('ДОВЕРСИОННЫЙ сейв по-прежнему читается: версии нет, но форма его', () => {
    // Обратная сторона проверки выше. Самая первая сборка писала сейв без
    // поля version, и такие сохранения настоящие — объявить их мусором
    // значило бы отнять прогресс у самых старых игроков.
    const result = readSave({ gold: '150', level: '4', xp: '11', damagePerSecond: '13' })
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.payload.version).toBe(SAVE_VERSION)
  })
})

describe('запасная копия прежнего сохранения', () => {
  it('отказ загрузки кладёт исходную строку под запасной ключ', () => {
    const storage = makeStorage()
    storage.setItem(SAVE_KEY, 'это не json {{{')
    expect(storage.data.get(SAVE_BACKUP_KEY)).toBeUndefined()
    const result = loadGame({ storage })
    expect(result.kind).toBe('error')
    // Копия сделана ДО того, как игрок увидит выбор класса и затрёт сейв.
    expect(storage.data.get(SAVE_BACKUP_KEY)).toBe('это не json {{{')
    expect(readBackupSave({ storage })).toBe('это не json {{{')
  })

  it('сейв из будущей версии тоже сохраняется, а не пропадает', () => {
    const storage = makeStorage()
    const raw = JSON.stringify({ version: 99, gold: '1' })
    storage.setItem(SAVE_KEY, raw)
    loadGame({ storage })
    expect(readBackupSave({ storage })).toBe(raw)
  })

  it('удачная загрузка копию не делает: терять нечего', () => {
    const storage = makeStorage()
    saveGame(richState(), { storage, now: () => 0 })
    loadGame({ storage, now: () => 0 })
    expect(readBackupSave({ storage })).toBeNull()
  })

  it('копия переживает перезапись сейва', () => {
    const storage = makeStorage()
    storage.setItem(SAVE_KEY, 'мусор')
    loadGame({ storage })
    saveGame(richState(), { storage, now: () => 0 })
    expect(readBackupSave({ storage })).toBe('мусор')
  })
})
