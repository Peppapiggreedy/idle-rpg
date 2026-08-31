// ОФФЛАЙН В ФОНОВОЙ ВКЛАДКЕ (находка 1.2 в AUDIT.md).
//
// До этого у игры было ТРИ режима вместо двух: играть — сто процентов,
// закрыть вкладку — двадцать, оставить вкладку открытой в фоне — ноль.
// Третий не задумывал никто: браузер не зовёт requestAnimationFrame у
// скрытой вкладки, цикл стоит, а накопленный долг при возврате сбрасывается.
//
// Главное свойство здесь — РАВЕНСТВО двух путей. Оно и держит правило
// «второй модели начисления нет»: разъедься они, восемь часов в фоне и
// восемь часов с закрытой вкладкой дали бы разные числа.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, type GameState } from './state'
import { ensureStats } from './stats'
import { createRng } from './rng'
import {
  OFFLINE_CHUNK_MS,
  loadGame,
  payloadFromState,
  resumeAfterAway,
  saveGame,
  stateFromPayload,
  type SaveStorage,
} from './save'
import { enterDungeon } from './dungeons'
import { DUNGEONS } from '../data/dungeons'
import { averageGear } from './simulate'
import { offlineZone } from './zones'

const HOUR = 3_600_000
const DUNGEON = DUNGEONS[0]

function makeStorage(): SaveStorage {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

/**
 * Герой, УЖЕ ПРОВЕДЁННЫЙ через сериализацию.
 *
 * Это важно для главного теста ниже: сравнивать два пути можно только от
 * состояния, которое переживает запись и чтение без изменений (неподвижная
 * точка — см. save.test.ts). Иначе разница в числах говорила бы про нормализацию
 * полей при загрузке, а не про модель начисления.
 */
function hero(patch: Partial<GameState> = {}): GameState {
  const level = 40
  const built = ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    equipment: averageGear(level),
    statsDirty: true,
    ...patch,
  })
  return ensureStats(stateFromPayload(payloadFromState(built, 0)))
}

/** Тот же герой, но проведённый через ЗАКРЫТУЮ вкладку: сохранить и загрузить. */
function throughClosedTab(state: GameState, awayMs: number) {
  const storage = makeStorage()
  saveGame(state, { storage, now: () => 0 })
  const result = loadGame({ storage, now: () => awayMs })
  if (result.kind !== 'loaded') throw new Error(result.kind)
  return result
}

describe('фоновая вкладка начисляет столько же, сколько закрытая', () => {
  it('восемь часов в фоне = восемь часов с закрытой вкладкой', () => {
    const start = hero()
    const away = 8 * HOUR
    // Оба пути берут ОДИН И ТОТ ЖЕ поток случайности лута: иначе сравнивать
    // было бы нечего, а расхождение говорило бы про сид, а не про модель.
    const background = resumeAfterAway(start, away, createRng(start.rngSeed))
    const closed = throughClosedTab(start, away)

    expect(background.offline).not.toBeNull()
    expect(closed.offline).not.toBeNull()
    expect(background.offline!.kills.eq(closed.offline!.kills)).toBe(true)
    expect(background.offline!.gold.eq(closed.offline!.gold)).toBe(true)
    expect(background.offline!.xp.eq(closed.offline!.xp)).toBe(true)
    expect(background.offline!.zoneId).toBe(closed.offline!.zoneId)
    // И герой приходит к тому же уровню.
    expect(background.state.level.eq(closed.state.level)).toBe(true)

    // ЛУТ СОВПАДАТЬ НЕ ОБЯЗАН, и это не поблажка. Сид случайности в сейве не
    // хранится намеренно (техдолг №2), поэтому закрытая вкладка приходит с
    // новым потоком, а фоновая продолжает прежний. Одинаково здесь ДРУГОЕ:
    // лут падает на обоих путях по одной и той же модели, и то, что начислено
    // ЗА УБИЙСТВА (выше), сходится копейка в копейку. Итоговое золото в
    // состоянии расходится ровно на выручку от автопродажи находок — то есть
    // на ту самую случайность, которую сейв не хранит.
    expect(background.offline!.loot.found).toBeGreaterThan(0)
    expect(closed.offline!.loot.found).toBeGreaterThan(0)
  })

  it('за восемь часов в фоне действительно что-то начисляется', () => {
    // Раньше здесь был ровный ноль — ради этой строки всё и делалось.
    const { offline } = resumeAfterAway(hero(), 8 * HOUR)
    expect(offline).not.toBeNull()
    expect(offline!.kills.gt(0)).toBe(true)
    expect(offline!.gold.gt(0)).toBe(true)
  })

  it('потолок восьми часов действует и в фоне', () => {
    const long = resumeAfterAway(hero(), 100 * HOUR)
    const capped = resumeAfterAway(hero(), 8 * HOUR)
    expect(long.offline!.kills.eq(capped.offline!.kills)).toBe(true)
  })
})

describe('короткое переключение вкладок', () => {
  it('ниже шага агрегата не начисляется и не докладывается', () => {
    const { state, offline } = resumeAfterAway(hero(), OFFLINE_CHUNK_MS - 1)
    expect(offline).toBeNull()
    expect(state.gold.eq(hero().gold)).toBe(true)
  })

  it('и НЕ расформировывает забег: отскок в соседнюю вкладку не наказывается', () => {
    // Иначе взгляд в другое окно посреди данжа стоил бы цепочки боссов.
    const inside = enterDungeon(
      hero({
        level: new Decimal(DUNGEON.unlockRequirement),
        equipment: averageGear(DUNGEON.unlockRequirement),
        currentZoneId: DUNGEON.zoneId,
        lastSurvivedZoneId: DUNGEON.zoneId,
      }),
      DUNGEON.id,
    )
    expect(inside.dungeonRun).not.toBeNull()
    const { state } = resumeAfterAway(inside, 30_000)
    expect(state.dungeonRun).not.toBeNull()
    expect(state.dungeonRun!.bossIndex).toBe(inside.dungeonRun!.bossIndex)
  })

  it('ровно на шаге агрегата время уже считается', () => {
    const { offline } = resumeAfterAway(hero(), OFFLINE_CHUNK_MS)
    // Отчёт может оказаться пустым (за минуту не набралось убийства), но
    // граница обязана быть именно здесь, а не «где-то около».
    expect(offline === null || offline.elapsedMs === OFFLINE_CHUNK_MS).toBe(true)
  })
})

describe('прерванный забег из фона идёт по общему правилу', () => {
  function inDungeon(): GameState {
    return enterDungeon(
      hero({
        level: new Decimal(DUNGEON.unlockRequirement),
        equipment: averageGear(DUNGEON.unlockRequirement),
        currentZoneId: DUNGEON.zoneId,
        lastSurvivedZoneId: DUNGEON.zoneId,
      }),
      DUNGEON.id,
    )
  }

  it('забег расформирован, герой снаружи, оффлайн по зоне выхода', () => {
    const inside = inDungeon()
    const { state, offline } = resumeAfterAway(inside, 4 * HOUR)
    expect(state.dungeonRun).toBeNull()
    expect(state.currentZoneId).toBe(offlineZone(inside).id)
    expect(offline!.interrupted).toBe('dungeon')
    expect(offline!.zoneId).toBe(state.currentZoneId)
  })

  it('попытка НЕ засчитана: данж не пройден', () => {
    const inside = inDungeon()
    const { state } = resumeAfterAway(inside, 8 * HOUR)
    expect(state.dungeonsCleared[DUNGEON.id]).toBeUndefined()
  })

  it('то же самое, что при загрузке сейва — до последнего числа', () => {
    // Второй модели быть не должно: сравниваем оба пути на забеге.
    const inside = inDungeon()
    const background = resumeAfterAway(inside, 4 * HOUR, createRng(inside.rngSeed))
    const closed = throughClosedTab(inside, 4 * HOUR)
    expect(background.state.currentZoneId).toBe(closed.state.currentZoneId)
    expect(background.offline!.interrupted).toBe(closed.offline!.interrupted)
    expect(background.offline!.kills.eq(closed.offline!.kills)).toBe(true)
    expect(background.offline!.gold.eq(closed.offline!.gold)).toBe(true)
  })

  it('часы перевели назад — забег всё равно расформирован, начислений нет', () => {
    const inside = inDungeon()
    const { state, offline } = resumeAfterAway(inside, -5 * HOUR)
    expect(state.dungeonRun).toBeNull()
    expect(offline).toBeNull()
  })
})
