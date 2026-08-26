// Шина событий боя: логика только эмитит, UI только подписывается.
// Позже на неё сядут всплывающие числа урона.
import type { AttackEvent } from '../types'

type Handler = (event: AttackEvent) => void

const handlers = new Set<Handler>()

/** Подписка на события; возвращает функцию отписки. */
export function subscribe(handler: Handler): () => void {
  handlers.add(handler)
  return () => handlers.delete(handler)
}

export function emit(event: AttackEvent): void {
  for (const handler of handlers) handler(event)
}
