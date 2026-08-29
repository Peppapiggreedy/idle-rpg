// Шина событий: логика только эмитит, слушатели только подписываются.
//
// Каналов ДВА. `attack` — удары, из них рисуются всплывающие цифры. `log` —
// события боевого лога (находка, смерть, уровень, блок): из них строится
// лента и звук. Логика ни про ленту, ни про звук не знает.
import type { AttackEvent, CombatEvent } from '../types'

type Handler = (event: AttackEvent) => void
type LogHandler = (events: readonly CombatEvent[]) => void

const handlers = new Set<Handler>()
const logHandlers = new Set<LogHandler>()

/** Подписка на удары; возвращает функцию отписки. */
export function subscribe(handler: Handler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function emit(event: AttackEvent): void {
  for (const handler of handlers) handler(event)
}

/** Подписка на события лога; возвращает функцию отписки. */
export function subscribeLog(handler: LogHandler): () => void {
  logHandlers.add(handler)
  return () => logHandlers.delete(handler)
}

/** Пачкой, а не по одному: за тик их приходит несколько, и слушателю важен
 *  порядок внутри пачки, а не отдельные вызовы. */
export function emitLog(events: readonly CombatEvent[]): void {
  if (events.length === 0) return
  for (const handler of logHandlers) handler(events)
}

/**
 * Что в хвосте лога появилось нового с прошлого раза.
 *
 * Хвост идёт НОВЫМИ ВПЕРЁД и обрезан, поэтому «новое» — это всё до первой
 * встречи прежней головы. Если прежней головы там уже нет (событий пришло
 * больше, чем длина хвоста), новым считается весь хвост: то, что мы
 * пропустили, показать всё равно неоткуда.
 */
export function freshEvents(
  tail: readonly CombatEvent[],
  seen: CombatEvent | null,
): CombatEvent[] {
  if (!seen) return [...tail].reverse()
  const index = tail.indexOf(seen)
  const fresh = index === -1 ? [...tail] : tail.slice(0, index)
  return fresh.reverse()
}
