// Эффект нового уровня двумерной сцены: вспышка и номер над героем.
//
// Как и у всплывающих чисел, ни одной строки про DOM: сюда приходят пачки
// событий лога, наружу уходит живой эффект с долей прожитого. Так срок
// жизни и то, что эффект вообще взводится, проверяются в node.
//
// О смене уровня сцена узнаёт из того, что уже есть: логика кладёт в лог
// событие `levelup` с новым уровнем, и шина отдаёт его слушателям пачкой за
// тик. Слот ОДИН: если за тик пришло несколько уровней (ускорение), виден
// итоговый, а не стопка одинаковых вспышек.

import { LEVEL_UP_MS } from '../data/render'
import { formatNumber } from '../game'
import type { CombatEvent } from '../types'

export interface LevelUpBurst {
  /** Номер нового уровня уже строкой: Decimal в разметку не уедет. */
  level: string
  bornAt: number
}

export interface LevelUpView {
  level: string
  /** Доля прожитого 0..1: по ней вспышка расходится, а номер поднимается и тает. */
  life: number
}

export interface LevelUpTracker {
  /** Пачка событий лога; возвращает true, если в ней был новый уровень. */
  push(events: readonly CombatEvent[], now: number): boolean
  /** Живой эффект на момент now; null — срок вышел или уровня не было. */
  alive(now: number): LevelUpView | null
  clear(): void
}

/** Доля прожитого 0..1; нулевой срок — сразу прожито. */
export function levelUpProgress(
  burst: LevelUpBurst,
  now: number,
  lifeMs: number = LEVEL_UP_MS,
): number {
  if (lifeMs <= 0) return 1
  return Math.max(0, Math.min(1, (now - burst.bornAt) / lifeMs))
}

export function createLevelUpTracker(lifeMs: number = LEVEL_UP_MS): LevelUpTracker {
  let burst: LevelUpBurst | null = null

  return {
    push(events, now) {
      let found = false
      for (const event of events) {
        if (event.type !== 'levelup') continue
        // Тот же formatNumber, что и у остальных чисел интерфейса.
        burst = { level: formatNumber(event.level), bornAt: now }
        found = true
      }
      return found
    },
    alive(now) {
      if (burst === null) return null
      const life = levelUpProgress(burst, now, lifeMs)
      if (life >= 1) {
        burst = null
        return null
      }
      return { level: burst.level, life }
    },
    clear() {
      burst = null
    },
  }
}
