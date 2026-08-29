// Телеметрия интервала решений. ЛОКАЛЬНАЯ и только локальная: ничего никуда
// не уходит, никакого идентификатора, никакой сети. Это прибор для того, кто
// делает игру, а не сбор данных об игроке.
//
// ЗАЧЕМ. Idle-игра ломается тихо: она продолжает работать, а игроку нечего
// решать. Заметить это на глаз нельзя — экран живой, цифры растут. Поэтому
// меряем ровно одно число: сколько проходит между РЕШЕНИЯМИ игрока. Слишком
// часто — игра дёргает; слишком редко — экран, на который незачем смотреть.
import { get, readonly, writable } from 'svelte/store'
import { DECISION_ALERT_SEC, DECISION_MAX_SEC, DECISION_MIN_SEC } from '../data/balance'

/**
 * Что считается решением. Список ЗАКРЫТЫЙ и совпадает с тем, что считает
 * прогон баланса: смена зоны, надевание, очко таланта, порог привала,
 * приоритет и резерв автокаста.
 */
export type DecisionKind =
  | 'zone'
  | 'equip'
  | 'talent'
  | 'rest-threshold'
  | 'autocast'
  | 'craft'
  // Глоток зелья — решение игрока: автокаста у зелий нет, и интервал решений
  // обязан его засчитывать, иначе прогон покажет пустой экран там, где игрок
  // как раз занят.
  | 'potion'
  // Распыление и зачарование — такое же решение, как крафт и надевание.
  | 'enchant'

export interface TelemetrySnapshot {
  /** Сколько решений записано за сессию. */
  count: number
  /** Секунд с прошлого решения. null — решений ещё не было. */
  sinceLastSec: number | null
  /** Медианный интервал между решениями, секунд. null — интервалов нет. */
  medianSec: number | null
  /** Медиана вне окна: игре стоит показать это тому, кто её делает. */
  alert: boolean
}

const MAX_SAMPLES = 200

// Отметки времени решений. Живут в памяти вкладки: это наблюдение за
// СЕССИЕЙ, а не архив. В localStorage не пишутся намеренно — привычка
// сохранять всё и есть то, как безобидный счётчик превращается в слежку.
let stamps: number[] = []

const snapshot = writable<TelemetrySnapshot>({
  count: 0,
  sinceLastSec: null,
  medianSec: null,
  alert: false,
})

export const telemetry = readonly(snapshot)

/** Медиана, а не среднее: один длинный перерыв не должен красить всю сессию. */
export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Интервалы между соседними отметками, секунд. */
export function gapsOf(marks: number[]): number[] {
  const gaps: number[] = []
  for (let i = 1; i < marks.length; i += 1) gaps.push((marks[i] - marks[i - 1]) / 1000)
  return gaps
}

/** Вне окна ли медиана. Порог тревоги отдельный: он про пустой экран. */
export function isAlert(medianSec: number | null): boolean {
  if (medianSec === null) return false
  return medianSec > DECISION_ALERT_SEC
}

/** Записать решение. Зовут экшены стора — ни одна из них не знает, зачем. */
export function recordDecision(_kind: DecisionKind, now = Date.now()): void {
  stamps = [...stamps, now].slice(-MAX_SAMPLES)
  const median = medianOf(gapsOf(stamps))
  snapshot.set({
    count: stamps.length,
    sinceLastSec: 0,
    medianSec: median,
    alert: isAlert(median),
  })
}

/** Обновить «сколько прошло с прошлого решения». Зовёт отладочный оверлей. */
export function refreshTelemetry(now = Date.now()): void {
  const last = stamps[stamps.length - 1]
  if (last === undefined) return
  snapshot.set({ ...get(snapshot), sinceLastSec: (now - last) / 1000 })
}

/** Окно, в котором интервал считается здоровым. Показывает отладка. */
export const DECISION_WINDOW = { min: DECISION_MIN_SEC, max: DECISION_MAX_SEC }

/** Сброс — для тестов и для «начать заново». */
export function resetTelemetry(): void {
  stamps = []
  snapshot.set({ count: 0, sinceLastSec: null, medianSec: null, alert: false })
}
