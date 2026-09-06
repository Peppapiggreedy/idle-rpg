// ДОГОН ОФФЛАЙНА ПО ЧАСТЯМ: ТА ЖЕ АРИФМЕТИКА, ДРУГОЕ ВРЕМЯ.
//
// Замер аудита: двенадцать часов простоя считались 664 мс ОДНИМ синхронным
// блоком, и приходился он ровно на открытие вкладки — момент, когда игрок
// ждёт экрана. Внутри догон уже шёл шагами по `OFFLINE_CHUNK_MS`, но шаги
// крутились в одном цикле без выхода в событийный цикл, и браузеру нечем было
// ни нарисовать кадр, ни ответить на нажатие.
//
// ГЛАВНЫЙ ИНВАРИАНТ ПРАВКИ И ЕДИНСТВЕННОЕ, РАДИ ЧЕГО НАПИСАН ЭТОТ ФАЙЛ:
// результат покадрового догона обязан совпасть с результатом догона одним
// куском ДО ПОСЛЕДНЕГО ЧИСЛА. Разрезание — про то, КОГДА считается, а не про
// то, ЧТО получается. Разошлось — значит разрезали неправильно, и чинить надо
// разрезание, а не ожидание.
//
// Golden отсюда не двигается по построению: если совпадение держится, ему
// двигаться не с чего. Этот файл и есть проверка того, что оно держится.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createRng } from './rng'
import { createInitialState, type GameState } from './tick'
import { ensureStats } from './stats'
import { applyOfflineProgress, startOfflineProgress, type OfflineReport } from './save'
import { OFFLINE_CHUNK_MIN } from '../data/balance'

const HOUR = 3_600_000
const CHUNK_MS = OFFLINE_CHUNK_MIN * 60 * 1000

/** Герой, которому есть что накопить: не первый уровень и в своей зоне. */
function hero(level: number): GameState {
  return ensureStats({
    ...createInitialState(12345),
    level: new Decimal(level),
    statsDirty: true,
  })
}

/**
 * Отпечаток итога. Сравнивать целые состояния бессмысленно — в них лежат
 * функции и Decimal, — а вот числа, ради которых догон и существует,
 * сравнивать обязательно, и все сразу.
 */
function fingerprint(result: { state: GameState; report: OfflineReport | null }) {
  const { state, report } = result
  return {
    gold: state.gold.toString(),
    level: state.level.toString(),
    currentXp: state.currentXp.toString(),
    itemSeq: state.itemSeq,
    inventory: state.inventory.map((i) => `${i.id}:${i.name}:${i.rarity}:${i.level}`),
    materials: JSON.stringify(state.materials),
    // ЛОГ — ТОЖЕ ЧАСТЬ ИТОГА, и попал он сюда не из осторожности. Разрезая
    // догон, я потерял строку, которая обрезает лог обратно, и покадровый
    // путь совпадал с одним куском ровно потому, что ОБА писали в лог сотню
    // находок. Поймал это старый тест (`offline-loot.test.ts`), а не этот:
    // инвариант «часть == целое» слеп к тому, что сломано в обоих путях
    // сразу. Отпечаток обязан называть всё, что догон меняет.
    combatLog: state.combatLog.map((e) => e.type),
    report: report && {
      elapsedMs: report.elapsedMs,
      kills: report.kills.toString(),
      gold: report.gold.toString(),
      xp: report.xp.toString(),
      zoneId: report.zoneId,
      loot: {
        ...report.loot,
        soldGold: report.loot.soldGold.toString(),
      },
    },
  }
}

/** Покадровый догон: по `perFrame` шагов за раз, как это делает стор. */
function chunked(state: GameState, elapsedMs: number, perFrame: number) {
  const run = startOfflineProgress(state, elapsedMs, createRng(state.rngSeed ^ 0x9e3779b9))
  let frames = 0
  while (!run.done()) {
    run.step(perFrame)
    frames += 1
    // Сторож от бесконечного цикла: шагов за восемь часов меньше пятисот.
    expect(frames, 'догон не сходится: шаг не двигает остаток').toBeLessThan(10_000)
  }
  return { result: run.finish(), frames }
}

/** Догон одним куском тем же потоком случайности. */
function whole(state: GameState, elapsedMs: number) {
  return applyOfflineProgress(state, elapsedMs, createRng(state.rngSeed ^ 0x9e3779b9))
}

describe('догон по частям совпадает с догоном одним куском', () => {
  // Пять длительностей, названных в задаче: час, шесть, двенадцать, сутки и
  // год. Последние две проверяют ещё и потолок восьми часов — за ним догон
  // обязан считать одно и то же независимо от того, сколько игрока не было.
  const SPANS: ReadonlyArray<readonly [string, number]> = [
    ['час', HOUR],
    ['шесть часов', 6 * HOUR],
    ['двенадцать часов', 12 * HOUR],
    ['сутки', 24 * HOUR],
    ['год', 365 * 24 * HOUR],
  ]

  for (const [name, elapsedMs] of SPANS) {
    it(`${name}: до последнего числа`, () => {
      const start = hero(30)
      const one = fingerprint(whole(start, elapsedMs))
      const many = fingerprint(chunked(start, elapsedMs, 1).result)
      expect(many).toEqual(one)
    })
  }

  it('раскладка по кадрам на итог не влияет вовсе', () => {
    // Один шаг за кадр, семь, сто — числа обязаны совпасть все три раза.
    // Если бы совпадали только «одинаковые» раскладки, это означало бы, что
    // шаг зависит от того, сколько шагов сделано до него.
    const start = hero(30)
    const one = fingerprint(whole(start, 12 * HOUR))
    for (const perFrame of [1, 7, 100]) {
      expect(fingerprint(chunked(start, 12 * HOUR, perFrame).result), `по ${perFrame}`).toEqual(one)
    }
  })

  it('на разных уровнях героя — тоже', () => {
    // Уровень меняет темп, а рост уровня ВНУТРИ догона пересчитывает статы:
    // это единственное место, где шаг зависит от предыдущих, и проверить его
    // надо там, где рост случается.
    for (const level of [1, 15, 55, 95]) {
      const start = hero(level)
      expect(
        fingerprint(chunked(start, 8 * HOUR, 3).result),
        `уровень ${level}`,
      ).toEqual(fingerprint(whole(start, 8 * HOUR)))
    }
  })
})

describe('догон отчитывается о ходе, а не молчит', () => {
  it('доля растёт от нуля к единице и не перескакивает', () => {
    const run = startOfflineProgress(hero(30), 8 * HOUR)
    expect(run.progress()).toBe(0)
    let prev = 0
    while (!run.done()) {
      run.step(10)
      const now = run.progress()
      expect(now, 'доля пошла назад').toBeGreaterThanOrEqual(prev)
      expect(now).toBeLessThanOrEqual(1)
      prev = now
    }
    expect(run.progress()).toBe(1)
  })

  it('шагов за восемь часов больше сотни — есть что разрезать', () => {
    // Число здесь не ради числа: если бы шагов было три, разрезание по кадрам
    // не давало бы браузеру ничего, и правка была бы украшением.
    const { frames } = chunked(hero(30), 8 * HOUR, 1)
    expect(frames).toBeGreaterThan(100)
    expect(frames).toBeCloseTo((8 * HOUR) / CHUNK_MS, -1)
  })

  it('считать нечего — догон готов сразу и ничего не насчитал', () => {
    const start = hero(30)
    const run = startOfflineProgress(start, 0)
    expect(run.done()).toBe(true)
    expect(run.progress()).toBe(1)
    expect(run.finish().report).toBeNull()
  })
})
