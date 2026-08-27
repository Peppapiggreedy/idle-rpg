import { describe, expect, it } from 'vitest'
import { LOG_AGGREGATE_THRESHOLD, LOG_VIEW_SIZE } from '../data/balance'
import { Decimal } from '../game'
import type { CombatEvent } from '../types'
import {
  emptyLogView,
  filterRows,
  freshEvents,
  isAggregated,
  pushEvents,
} from './logView'

const hit = (n: number): CombatEvent => ({ type: 'hit', damage: new Decimal(n), isCrit: false })
const spawn = (name: string): CombatEvent => ({ type: 'spawn', monsterName: name })

/** Хвост состояния: новые ВПЕРЁД, обрезан до COMBAT_LOG_SIZE. */
function tail(events: CombatEvent[], size = 8): CombatEvent[] {
  return [...events].reverse().slice(0, size)
}

describe('что в хвосте нового', () => {
  it('первый заход берёт весь хвост', () => {
    const t = tail([hit(1), hit(2)])
    expect(freshEvents(t, null)).toEqual([hit(1), hit(2)])
  })

  it('берёт только то, что появилось после прежней головы', () => {
    // Идентичность объектов — не случайность: addLog в состоянии переносит
    // ТЕ ЖЕ ссылки, а не копии. Поэтому и хвост в тесте строится из тех же.
    const a = hit(1)
    const b = hit(2)
    const c = hit(3)
    expect(freshEvents(tail([a, b, c]), b)).toEqual([c])
    expect(freshEvents(tail([a, b, c]), c)).toEqual([])
  })

  it('после загрузки сейва события другие — берётся весь хвост', () => {
    // Объекты в логе после загрузки новые, прежняя голова в них не найдётся.
    // Показать пропущенное всё равно неоткуда, поэтому берём что есть.
    const before = hit(1)
    const afterLoad = tail([hit(1), hit(2)])
    expect(freshEvents(afterLoad, before).length).toBe(2)
  })

  it('если прежняя голова уже выпала из хвоста — берёт весь хвост', () => {
    // Событий пришло больше, чем длина хвоста: то, что мы пропустили,
    // показать всё равно неоткуда, и притворяться нечем.
    const first = tail([hit(1)])
    const later = tail(Array.from({ length: 20 }, (_, i) => hit(i + 100)))
    expect(freshEvents(later, first[0]).length).toBe(8)
  })

  it('ничего нового — ничего не возвращает', () => {
    const t = tail([hit(1), hit(2)])
    expect(freshEvents(t, t[0])).toEqual([])
  })
})

describe('лента лога', () => {
  it('однотипные подряд сворачиваются в одну строку с суммой', () => {
    let view = emptyLogView()
    view = pushEvents(view, tail([hit(10), hit(20), hit(30)]))
    expect(view.rows.length).toBe(1)
    expect(view.rows[0].count).toBe(3)
    expect(view.rows[0].total?.toNumber()).toBe(60)
  })

  it('разнотипные не сливаются', () => {
    let view = emptyLogView()
    view = pushEvents(view, tail([hit(10), spawn('Моб'), hit(20)]))
    expect(view.rows.map((r) => r.event.type)).toEqual(['hit', 'spawn', 'hit'])
  })

  it('порог решает, показывать счётчиком или по одному', () => {
    let view = emptyLogView()
    view = pushEvents(view, tail(Array.from({ length: LOG_AGGREGATE_THRESHOLD - 1 }, () => hit(5))))
    expect(isAggregated(view.rows[0])).toBe(false)
    view = pushEvents(view, tail([...Array.from({ length: LOG_AGGREGATE_THRESHOLD }, () => hit(5))]))
    expect(isAggregated(view.rows[0])).toBe(true)
  })

  it('при 500 событиях в секунду длина ленты не превышает потолка', () => {
    // Требование шага: лента не должна расти без предела при быстром бое.
    let view = emptyLogView()
    for (let i = 0; i < 500; i += 1) {
      // Чередуем типы, чтобы свёртка НЕ помогала: проверяем именно потолок.
      view = pushEvents(view, tail([i % 2 === 0 ? hit(i) : spawn(`Моб ${i}`)]))
      expect(view.rows.length).toBeLessThanOrEqual(LOG_VIEW_SIZE)
    }
    expect(view.rows.length).toBe(LOG_VIEW_SIZE)
  })

  it('новое идёт наверх', () => {
    let view = emptyLogView()
    view = pushEvents(view, tail([spawn('Первый')]))
    view = pushEvents(view, tail([spawn('Первый'), spawn('Второй')]))
    expect((view.rows[0].event as { monsterName: string }).monsterName).toBe('Второй')
  })

  it('ключи строк не повторяются — иначе список перепутает строки', () => {
    let view = emptyLogView()
    for (let i = 0; i < 120; i += 1) view = pushEvents(view, tail([spawn(`Моб ${i}`)]))
    expect(new Set(view.rows.map((r) => r.id)).size).toBe(view.rows.length)
  })
})

describe('фильтр ленты', () => {
  it('«всё» ничего не прячет, остальные оставляют свои типы', () => {
    let view = emptyLogView()
    view = pushEvents(view, tail([hit(1), spawn('Моб'), { type: 'levelup', level: new Decimal(2) }]))
    expect(filterRows(view.rows, 'all').length).toBe(3)
    expect(filterRows(view.rows, 'damage').map((r) => r.event.type)).toEqual(['hit'])
    expect(filterRows(view.rows, 'loot').map((r) => r.event.type)).toEqual(['levelup'])
    expect(filterRows(view.rows, 'events').map((r) => r.event.type)).toEqual(['spawn'])
  })
})
