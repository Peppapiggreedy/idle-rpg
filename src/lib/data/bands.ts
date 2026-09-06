// ПОЛОСЫ УРОВНЕЙ — ОДНА РАЗМЕТКА НА ВСЮ ИГРУ.
//
// Десять полос по десять уровней, по две зоны в каждой. Разметка не новая:
// ровно по ней уже нарезаны фоны боевой сцены (`BACKGROUND_BANDS` в
// `data/sprites.ts`). Раньше она жила ТАМ, среди картинок, и это работало,
// пока полосами пользовались только картинки. Реагентам нужна та же
// разметка, а второй разметки уровней в игре быть не должно — поэтому
// определение переехало сюда, в нейтральное место, а `sprites.ts` навешивает
// на неё пути к фонам.
//
// Границы заданы ЯВНО, а не выведены из «десять уровней подряд»: полоса —
// это решение о содержимом (какие зоны в неё попали, что в ней падает), и
// формула, которая молча переставит границу при смене потолка уровней,
// сделала бы это решение невидимым.

/** Полоса уровней: id и границы включительно. */
export interface LevelBand {
  id: string
  minLevel: number
  maxLevel: number
}

/**
 * САМА РАЗМЕТКА. Порядок значим: полосы идут снизу вверх, и по индексу
 * считается «полоса глубже другой».
 */
export const LEVEL_BANDS = [
  { id: 'meadow', minLevel: 1, maxLevel: 10 },
  { id: 'furrows', minLevel: 11, maxLevel: 20 },
  { id: 'glass', minLevel: 21, maxLevel: 30 },
  { id: 'mines', minLevel: 31, maxLevel: 40 },
  { id: 'flood', minLevel: 41, maxLevel: 50 },
  { id: 'sulfur', minLevel: 51, maxLevel: 60 },
  { id: 'pass', minLevel: 61, maxLevel: 70 },
  { id: 'salt', minLevel: 71, maxLevel: 80 },
  { id: 'rime', minLevel: 81, maxLevel: 90 },
  { id: 'dell', minLevel: 91, maxLevel: 100 },
] as const satisfies readonly LevelBand[]

/**
 * Идентификатор полосы. Тип ВЫВЕДЕН из самой разметки, поэтому опечатка в
 * поле `band` любого файла `data/` — ошибка проверки типов, а не пустая
 * полка на экране. Тот же приём, что у `IconName`.
 */
export type BandId = (typeof LEVEL_BANDS)[number]['id']

export const BAND_IDS: readonly BandId[] = LEVEL_BANDS.map((b) => b.id)

const BAND_BY_ID = Object.fromEntries(LEVEL_BANDS.map((b) => [b.id, b])) as Record<
  BandId,
  (typeof LEVEL_BANDS)[number]
>

export function bandById(id: BandId): (typeof LEVEL_BANDS)[number] {
  return BAND_BY_ID[id]
}

/**
 * Полоса по уровню. Полосы сплошные от первого уровня до потолка, но края
 * тянутся за границы: уровень вне разметки получает ближайшую полосу, а не
 * падение. Это тот же приём, что у `backgroundForLevel`, и по той же
 * причине — данные не должны ронять игру из-за числа, которого не ждали.
 */
export function bandForLevel(level: number): (typeof LEVEL_BANDS)[number] {
  const safe = Number.isFinite(level) ? level : 1
  const found = LEVEL_BANDS.find((b) => safe >= b.minLevel && safe <= b.maxLevel)
  if (found) return found
  return safe < LEVEL_BANDS[0].minLevel ? LEVEL_BANDS[0] : LEVEL_BANDS[LEVEL_BANDS.length - 1]
}

/** Насколько полоса глубока: 0 — самая мелкая. Нужен сравнениям «не выше». */
export function bandDepth(id: BandId): number {
  return LEVEL_BANDS.findIndex((b) => b.id === id)
}
