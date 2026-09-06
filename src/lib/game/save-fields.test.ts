// БИТОЕ ПОЛЕ, А НЕ БИТЫЙ СЕЙВ.
//
// Защита от испорченного КОНВЕРТА в игре была и работает: не объект, не тот
// объект, версия из будущего — всё это ловится и уводит на явный отказ с
// копией. Дыра была ровно на шаг глубже: конверт целый, версия своя, а внутри
// поля мусор. Такой сейв читался УСПЕШНО — каждое поле приводилось умолчанием
// молча, — игра запускалась, и ближайшее автосохранение затирало оригинал.
//
// Замер аудита на герое 13 уровня: `level: "абв"` давал героя 4 уровня (после
// оффлайна), `unlockedZoneIds: []` забирал все зоны, несуществующий класс
// принимался. Ни одного слова игроку и ни одной копии.
//
// Тесты ниже — та самая таблица из девяти видов порчи, только исполняемая.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './tick'
import { tick } from './tick'
import { createRng } from './rng'
import {
  SAVE_BACKUP_KEY,
  SAVE_KEY,
  loadGame,
  payloadFromState,
  unreadableFields,
  type SaveFieldCode,
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

/** Живой герой, которому есть что терять. */
function hero(): GameState {
  const base = createInitialState(1)
  return {
    ...base,
    level: new Decimal(13),
    gold: new Decimal(4200),
    currentXp: new Decimal(310),
  }
}

/** Сейв героя с одним испорченным полем. */
function savedWith(patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(payloadFromState(hero(), 0) as unknown as Record<string, unknown>), ...patch }
}

/** Загрузить такой сейв из хранилища и отдать и результат, и хранилище. */
function load(patch: Record<string, unknown>) {
  const storage = makeStorage()
  storage.setItem(SAVE_KEY, JSON.stringify(savedWith(patch)))
  const result = loadGame({ storage, now: () => 0 })
  return { result, storage }
}

describe('битое поле сейва не крадёт прогресс молча', () => {
  // ДЕВЯТЬ ВИДОВ ПОРЧИ ИЗ ЗАМЕРА АУДИТА. Каждый обязан быть НАЗВАН, а не
  // проглочен; какое именно поле — часть проверки, иначе «что-то не так»
  // вернулось бы под другим именем.
  const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, SaveFieldCode]> = [
    ['уровень строкой-мусором', { level: 'абв' }, 'level'],
    ['уровень нулём', { level: '0' }, 'level'],
    ['уровень выше потолка игры', { level: '1e9' }, 'level'],
    ['золото не числом', { gold: 'abc' }, 'gold'],
    ['опыт как NaN', { currentXp: 'NaN' }, 'currentXp'],
    ['пыль отрицательная', { enchantDust: '-5' }, 'enchantDust'],
    ['несуществующий класс', { classId: 'нет-такого' }, 'classId'],
    ['ранг несуществующего таланта', { talents: { 'нет-такого': 1 } }, 'talents'],
    ['список зон массивом вместо объекта', { unlockedZoneIds: [] }, 'unlockedZoneIds'],
    ['открыта несуществующая зона', { unlockedZoneIds: { 'нет-такой': true } }, 'unlockedZoneIds'],
  ]

  for (const [name, patch, code] of CASES) {
    it(`${name} — назван кодом «${code}», а не проглочен`, () => {
      const { result } = load(patch)
      expect(result.kind).toBe('loaded')
      if (result.kind !== 'loaded') return
      expect(result.unreadable).toContain(code)
    })
  }

  it('копия делается при подозрительном чтении, а не только при отказе', () => {
    // Главное во всей стадии: разбор лишь НАЗЫВАЕТ потерю, вернуть прогресс
    // может только копия. Без неё автосохранение затрёт оригинал за секунды.
    const { storage } = load({ level: 'абв' })
    expect(storage.data.has(SAVE_BACKUP_KEY)).toBe(true)
    const backup = JSON.parse(storage.data.get(SAVE_BACKUP_KEY) as string)
    expect(backup.level).toBe('абв')
  })

  it('здоровый сейв читается молча и копии не плодит', () => {
    // Обратная сторона: проверка, которая срабатывает всегда, — это шум, и
    // через неделю её перестают читать.
    const storage = makeStorage()
    storage.setItem(SAVE_KEY, JSON.stringify(payloadFromState(hero(), 0)))
    const result = loadGame({ storage, now: () => 0 })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    expect(result.unreadable).toEqual([])
    expect(storage.data.has(SAVE_BACKUP_KEY)).toBe(false)
  })

  it('ОТСУТСТВУЮЩЕЕ поле — не порча: сейв прошлой версии обязан читаться', () => {
    // Мягкое чтение заведено ради миграций и остаётся. Отличать «поля нет»
    // от «поле есть, но мусор» — весь смысл разбора; спутать их значило бы
    // объявить испорченным каждый старый сейв.
    const payload = savedWith({})
    for (const key of ['enchantDust', 'talents', 'materials', 'inventory']) delete payload[key]
    expect(unreadableFields(payload as never)).toEqual([])
  })

  it('сообщение называет ВСЕ непрочитанные поля, а не первое', () => {
    const { result } = load({ level: 'абв', gold: 'abc', unlockedZoneIds: [] })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    expect([...result.unreadable].sort()).toEqual(['gold', 'level', 'unlockedZoneIds'])
  })

  it('NaN по-прежнему никуда не протекает — сто тиков после загрузки', () => {
    // Хорошая новость аудита, которую правка обязана сохранить: мягкое чтение
    // не пускает NaN в состояние. Разбор полей НАЗЫВАЕТ порчу, но не меняет
    // того, что читается, — и это надо было проверить, а не предположить.
    const { result } = load({ gold: 'NaN', currentXp: 'NaN', level: 'NaN' })
    expect(result.kind).toBe('loaded')
    if (result.kind !== 'loaded') return
    let s = result.state
    const rng = createRng(7)
    for (let i = 0; i < 100; i += 1) s = tick(s, 100, rng)
    for (const [name, value] of [
      ['золото', s.gold],
      ['опыт', s.currentXp],
      ['уровень', s.level],
      ['здоровье', s.currentHp],
    ] as ReadonlyArray<readonly [string, Decimal]>) {
      expect(Number.isFinite(value.toNumber()), `${name} стало NaN`).toBe(true)
    }
  })
})
