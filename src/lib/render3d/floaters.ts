// Очередь всплывающих чисел и их проекция на экран.
//
// Ни одной строки three: сюда приходят уже нормализованные координаты,
// а наружу уходят пиксели. Благодаря этому вся арифметика — бюджет,
// срок жизни, отсечение того, что за камерой, — проверяется в node,
// где никакого WebGL нет.

import { FLOATER_LIFE_MS, FLOATER_LIMIT } from '../data/render'

/** К кому привязано число: над чьей головой оно всплывает. */
export type FloaterAnchor = 'hero' | 'monster'

/** Смысл числа — от него цвет и размер. Тот же словарь, что у семантики токенов. */
export type FloaterKind = 'damage' | 'crit' | 'ability' | 'player-damage' | 'heal' | 'xp' | 'gold'

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

/** Точка на экране в пикселях; visible === false — рисовать нельзя. */
export interface ScreenPoint {
  x: number
  y: number
  visible: boolean
}

/**
 * Нормализованные координаты устройства (−1..1 по осям, z вне [−1, 1]
 * означает «за камерой или за дальней плоскостью») в пиксели холста.
 *
 * Отсечение по z обязательно: у Vector3.project точка ЗА камерой даёт
 * зеркальные координаты в кадре, и полоска здоровья мирно поехала бы
 * по экрану, будучи за спиной.
 */
export function projectToScreen(
  ndc: { x: number; y: number; z: number },
  width: number,
  height: number,
): ScreenPoint {
  const visible =
    Number.isFinite(ndc.x) &&
    Number.isFinite(ndc.y) &&
    ndc.z >= -1 &&
    ndc.z <= 1 &&
    ndc.x >= -1.5 &&
    ndc.x <= 1.5 &&
    ndc.y >= -1.5 &&
    ndc.y <= 1.5
  return {
    x: ((ndc.x + 1) / 2) * width,
    y: ((1 - ndc.y) / 2) * height,
    visible,
  }
}

/** Доля прожитого 0..1 — по ней UI гасит и поднимает число. */
export function floaterProgress(f: Floater, now: number, lifeMs: number = FLOATER_LIFE_MS): number {
  if (lifeMs <= 0) return 1
  return Math.max(0, Math.min(1, (now - f.bornAt) / lifeMs))
}
