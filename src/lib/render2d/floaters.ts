// Очередь всплывающих чисел двумерной сцены.
//
// Ни одной строки про DOM: сюда приходят события, наружу уходит список
// живых чисел с долей прожитого. Благодаря этому бюджет, срок жизни и
// раскладка по цветам проверяются в node.

import { FLOATER_LIFE_MS, FLOATER_LIMIT } from '../data/render'

/** К кому привязано число: над чьей головой оно всплывает. */
export type FloaterAnchor = 'hero' | 'monster'

/** Смысл числа — от него цвет и размер. Тот же словарь, что у семантики токенов. */
export type FloaterKind = 'damage' | 'crit' | 'ability' | 'player-damage' | 'heal'

export interface Floater {
  id: number
  anchor: FloaterAnchor
  kind: FloaterKind
  text: string
  bornAt: number
  /** Разброс по горизонтали, −1..1 — иначе одинаковые числа лягут стопкой. */
  drift: number
}

export interface FloaterQueue {
  /** Ставит число в очередь. Возвращает false, если бюджет исчерпан. */
  push(f: Omit<Floater, 'id'>): boolean
  /** Убирает отжившие; возвращает список живых на момент now. */
  alive(now: number): Floater[]
  /** Сколько сейчас висит. */
  size(): number
  clear(): void
}

export function createFloaterQueue(
  limit: number = FLOATER_LIMIT,
  lifeMs: number = FLOATER_LIFE_MS,
): FloaterQueue {
  let items: Floater[] = []
  let seq = 0

  return {
    push(f) {
      // Бюджет держим ОТБРАСЫВАНИЕМ НОВЫХ, а не вытеснением старых: иначе
      // при сотне событий за кадр на экране каждый кадр полностью новый
      // набор чисел, и не прочитать ни одного.
      if (items.length >= limit) return false
      seq += 1
      items.push({ ...f, id: seq })
      return true
    },
    alive(now) {
      items = items.filter((i) => now - i.bornAt < lifeMs)
      return items
    },
    size() {
      return items.length
    },
    clear() {
      items = []
    },
  }
}

/** Доля прожитого 0..1: по ней число поднимается и тает. */
export function floaterProgress(f: Floater, now: number, lifeMs: number = FLOATER_LIFE_MS): number {
  if (lifeMs <= 0) return 1
  return Math.max(0, Math.min(1, (now - f.bornAt) / lifeMs))
}

/**
 * Вид числа по удару: по герою — красное, крит — крупное и жёлтое,
 * умение — цвета опыта, остальное — обычный урон.
 */
export function floaterKind(targetIsHero: boolean, isCrit: boolean, ability: string | null): FloaterKind {
  if (targetIsHero) return 'player-damage'
  if (isCrit) return 'crit'
  return ability ? 'ability' : 'damage'
}
