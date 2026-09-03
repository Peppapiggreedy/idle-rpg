// ОЧЕРЕДЬ ВСПЫШЕК НАХОДОК. Чистая, потому что её надо проверять тестом:
// компонент вокруг неё — три строки разметки и таймер.
//
// Правило одно: N находок подряд дают РОВНО N показов, и каждый снимается
// сам по времени. Ни один показ не зависит от того, коснулся его игрок или
// нет, — вспышка ничего не перехватывает (pointer-events: none) и коснуться
// её в принципе нельзя.
import type { CombatEvent, Item } from '../types'
import { RARITY_BY_ID } from '../data/rarity'

export interface RevealQueue {
  /** Что показывается сейчас; null — ничего. */
  current: { item: Item; key: number } | null
  /** Ждут своей очереди, в порядке появления. */
  pending: Item[]
  /** Номер показа: по нему разметка перезапускает появление. */
  key: number
}

export function emptyRevealQueue(): RevealQueue {
  return { current: null, pending: [], key: 0 }
}

/** Достойна ли находка вспышки — решают данные редкости, а не этот файл. */
function worthy(event: CombatEvent): event is CombatEvent & { type: 'loot'; item: Item } {
  return event.type === 'loot' && RARITY_BY_ID[event.item.rarity].reveal
}

/**
 * Поставить в очередь находки из свежих событий.
 *
 * Пачку НЕ схлопываем: две легендарки в один тик — это две находки, и
 * показать надо обе. Прежняя вспышка брала из пачки только последнюю.
 */
export function enqueueReveals(queue: RevealQueue, fresh: readonly CombatEvent[]): RevealQueue {
  const items = fresh.filter(worthy).map((e) => e.item)
  if (items.length === 0) return queue
  const next: RevealQueue = { ...queue, pending: [...queue.pending, ...items] }
  return next.current ? next : showNext(next)
}

/**
 * Снять текущую и показать следующую. Зовётся по таймеру показа: очередь
 * движется временем, а не действиями игрока.
 */
export function showNext(queue: RevealQueue): RevealQueue {
  const [head, ...rest] = queue.pending
  if (!head) return { ...queue, current: null, pending: [] }
  return { current: { item: head, key: queue.key + 1 }, pending: rest, key: queue.key + 1 }
}
