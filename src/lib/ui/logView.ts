// Лента боевого лога: что именно показать игроку.
//
// В состоянии игры лежит короткий хвост событий (COMBAT_LOG_SIZE) — ровно
// столько, сколько нужно логике. Растить его ради показа нельзя: он попадёт
// и в golden-снимок, и в сейв, а это уже изменение игры ради картинки.
// Поэтому историю набирает САМА лента, здесь, из того, что видит.
//
// Второе, что здесь решается, — мельтешение. При быстром бое (сильный герой,
// отладочное ускорение) одинаковые удары идут десятками в секунду, и в этой
// каше не видно ни лута, ни смерти. Поэтому подряд идущие однотипные события
// сворачиваются в одну строку со счётчиком.

import { LOG_AGGREGATE_THRESHOLD, LOG_VIEW_SIZE } from '../data/balance'
// Диф хвоста лога живёт на шине: им же кормится звук, и второй копии быть не должно.
import { freshEvents } from '../game/events'

export { freshEvents }
import { Decimal } from '../game'
import type { CombatEvent } from '../types'

/** Типы, которые имеет смысл сворачивать: их бывает много и они однообразны. */
const AGGREGATABLE: CombatEvent['type'][] = ['hit', 'effect', 'hurt', 'block']

export interface LogRow {
  /** Ключ для #each: свой у каждой строки и стабильный, пока строка живёт. */
  id: number
  event: CombatEvent
  /** Сколько событий свёрнуто в эту строку; 1 — обычная строка. */
  count: number
  /** Суммарный урон свёрнутых событий; null — событие не про урон. */
  total: Decimal | null
}

export interface LogView {
  rows: LogRow[]
  /** Последнее увиденное событие: по нему находим, что появилось нового. */
  seen: CombatEvent | null
  nextId: number
}

export function emptyLogView(): LogView {
  return { rows: [], seen: null, nextId: 1 }
}

function damageOf(event: CombatEvent): Decimal | null {
  if (event.type === 'hit' || event.type === 'effect' || event.type === 'hurt') return event.damage
  // У блока показываем прошедший урон: он и есть потеря HP.
  if (event.type === 'block') return event.damage
  if (event.type === 'ability') return event.damage
  return null
}

/** Добавляет новые события в ленту, сворачивая однотипные подряд идущие. */
export function pushEvents(view: LogView, tail: readonly CombatEvent[]): LogView {
  const fresh = freshEvents(tail, view.seen)
  if (fresh.length === 0) return view

  const rows = [...view.rows]
  let nextId = view.nextId

  for (const event of fresh) {
    const head = rows[0]
    const mergeable =
      head !== undefined &&
      head.event.type === event.type &&
      AGGREGATABLE.includes(event.type)
    if (mergeable) {
      const damage = damageOf(event)
      rows[0] = {
        ...head,
        count: head.count + 1,
        total: damage ? (head.total ?? new Decimal(0)).plus(damage) : head.total,
      }
    } else {
      nextId += 1
      rows.unshift({ id: nextId, event, count: 1, total: damageOf(event) })
    }
  }

  return { rows: rows.slice(0, LOG_VIEW_SIZE), seen: tail[0] ?? view.seen, nextId }
}

/** Показывать ли строку свёрнутой: до порога читать интереснее по одному. */
export function isAggregated(row: LogRow): boolean {
  return row.count >= LOG_AGGREGATE_THRESHOLD
}

/** Группы для фильтра ленты. */
export const LOG_FILTERS = {
  all: { label: 'Всё', types: null },
  damage: { label: 'Урон', types: ['hit', 'ability', 'effect', 'hurt', 'block'] },
  loot: { label: 'Добыча', types: ['kill', 'loot', 'autosell', 'loot-swap', 'levelup'] },
  events: {
    label: 'События',
    types: ['spawn', 'death', 'revive', 'zone', 'boss', 'dungeon-exit', 'dungeon-clear', 'enrage'],
  },
} as const satisfies Record<string, { label: string; types: CombatEvent['type'][] | null }>

export type LogFilterId = keyof typeof LOG_FILTERS

export function filterRows(rows: LogRow[], filter: LogFilterId): LogRow[] {
  const types = LOG_FILTERS[filter].types
  if (!types) return rows
  return rows.filter((r) => (types as readonly string[]).includes(r.event.type))
}
