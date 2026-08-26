// Сохранение и загрузка. Формат сейва версионируется; Decimal сериализуется
// строкой через toString(). localStorage и часы инжектируются, чтобы логика
// тестировалась в node без браузера.
import { Decimal } from './numbers'
import { applyXp, xpToNextLevel } from './formulas'
import { RESPAWN_DELAY_MS, createInitialState, spawnMonster, type GameState } from './tick'
import { FIRST_MONSTER } from '../data/monsters'

export const SAVE_KEY = 'idle-rpg-save'
export const SAVE_VERSION = 1
export const AUTOSAVE_INTERVAL_MS = 15_000
// Потолок оффлайн-прогресса: больше 8 часов отсутствия не оплачивается.
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000
// Короче минуты отсутствия — награду начисляем, но модалку не показываем.
export const OFFLINE_MODAL_MIN_MS = 60_000

// Формат сейва v1. Все Decimal — строки.
export interface SavePayloadV1 {
  version: 1
  lastTimestamp: number
  gold: string
  level: string
  currentXp: string
  baseDamage: string
  upgrades: Record<string, string>
  totalTicks: string
  playtimeMs: string
}

export interface SaveStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface SaveDeps {
  storage?: SaveStorage
  now?: () => number
}

function defaultStorage(): SaveStorage {
  return globalThis.localStorage
}

// new Decimal('мусор') даёт NaN, а не исключение — проверяем поля руками.
function parseDec(value: unknown, fallback: string): Decimal {
  try {
    const d = new Decimal(String(value))
    if (Number.isFinite(d.mantissa) && Number.isFinite(d.exponent)) return d
  } catch {
    /* парсинг не удался — берём fallback */
  }
  return new Decimal(fallback)
}

export function payloadFromState(state: GameState, lastTimestamp: number): SavePayloadV1 {
  const upgrades: Record<string, string> = {}
  for (const [id, owned] of Object.entries(state.upgrades)) upgrades[id] = owned.toString()
  return {
    version: 1,
    lastTimestamp,
    gold: state.gold.toString(),
    level: state.level.toString(),
    currentXp: state.currentXp.toString(),
    baseDamage: state.baseDamage.toString(),
    upgrades,
    totalTicks: state.totalTicks.toString(),
    playtimeMs: state.playtimeMs.toString(),
  }
}

// Восстанавливает состояние поверх дефолтов: новые поля будущих версий
// автоматически получают значения из createInitialState. Моб и лог — свежие.
export function stateFromPayload(p: SavePayloadV1): GameState {
  const level = Decimal.max(parseDec(p.level, '1'), new Decimal(1))
  const upgrades: Record<string, Decimal> = {}
  for (const [id, owned] of Object.entries(p.upgrades ?? {})) upgrades[id] = parseDec(owned, '0')
  return {
    ...createInitialState(),
    gold: parseDec(p.gold, '0'),
    level,
    currentXp: parseDec(p.currentXp, '0'),
    xpToNext: xpToNextLevel(level),
    baseDamage: parseDec(p.baseDamage, '10'),
    upgrades,
    totalTicks: parseDec(p.totalTicks, '0'),
    playtimeMs: parseDec(p.playtimeMs, '0'),
    monster: spawnMonster(FIRST_MONSTER),
  }
}

// Цепочка миграций: MIGRATIONS[v] переводит формат v в v+1.
// v0 — «доверсионный» формат (без поля version): переносим известные поля.
type RawSave = Record<string, unknown>
const MIGRATIONS: Record<number, (raw: RawSave) => RawSave> = {
  0: (raw) => ({
    version: 1,
    lastTimestamp: typeof raw.lastTimestamp === 'number' ? raw.lastTimestamp : 0,
    gold: String(raw.gold ?? '0'),
    level: String(raw.level ?? '1'),
    currentXp: String(raw.currentXp ?? raw.xp ?? '0'),
    baseDamage: String(raw.baseDamage ?? raw.damagePerSecond ?? '10'),
    upgrades: typeof raw.upgrades === 'object' && raw.upgrades !== null ? raw.upgrades : {},
    totalTicks: String(raw.totalTicks ?? '0'),
    playtimeMs: String(raw.playtimeMs ?? '0'),
  }),
}

// null = сейв непригоден (не объект или из более новой версии игры).
export function migrateSave(raw: unknown): SavePayloadV1 | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  let data = raw as RawSave
  let version = typeof data.version === 'number' ? data.version : 0
  if (version > SAVE_VERSION) return null
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) return null
    data = step(data)
    version = typeof data.version === 'number' ? data.version : version + 1
  }
  return data as unknown as SavePayloadV1
}

export interface OfflineReport {
  elapsedMs: number
  kills: Decimal
  gold: Decimal
  xp: Decimal
}

// Оффлайн-прогресс одним агрегатом, без проигрывания тиков: время убийства
// одного моба = maxHp/dps + пауза респауна; убийств = floor(время / цикл).
export function applyOfflineProgress(
  state: GameState,
  elapsedMs: number,
): { state: GameState; report: OfflineReport | null } {
  const cappedMs = Math.min(elapsedMs, OFFLINE_CAP_MS)
  if (cappedMs <= 0) return { state, report: null }
  const { maxHp, goldReward, xpReward } = state.monster
  const killCycleSec = maxHp.div(state.baseDamage).plus(RESPAWN_DELAY_MS / 1000)
  const kills = new Decimal(cappedMs).div(1000).div(killCycleSec).floor()
  if (kills.lte(0)) return { state, report: null }
  const gold = goldReward.times(kills)
  const xp = xpReward.times(kills)
  const leveled = applyXp(state.level, state.currentXp, xp)
  return {
    state: {
      ...state,
      gold: state.gold.plus(gold),
      level: leveled.level,
      currentXp: leveled.currentXp,
      xpToNext: leveled.xpToNext,
    },
    report: { elapsedMs: cappedMs, kills, gold, xp },
  }
}

export function saveGame(state: GameState, deps: SaveDeps = {}): void {
  const storage = deps.storage ?? defaultStorage()
  const now = deps.now ?? Date.now
  storage.setItem(SAVE_KEY, JSON.stringify(payloadFromState(state, now())))
}

export type LoadResult =
  | { kind: 'fresh' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; state: GameState; offline: OfflineReport | null }

export function loadGame(deps: SaveDeps = {}): LoadResult {
  const storage = deps.storage ?? defaultStorage()
  const now = deps.now ?? Date.now
  const raw = storage.getItem(SAVE_KEY)
  if (raw === null) return { kind: 'fresh' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      kind: 'error',
      message: 'Сохранение повреждено и не читается — игра начата заново. Прости!',
    }
  }
  const payload = migrateSave(parsed)
  if (payload === null) {
    return {
      kind: 'error',
      message:
        'Сохранение не удалось прочитать (возможно, оно из более новой версии игры) — игра начата заново.',
    }
  }

  let state = stateFromPayload(payload)
  // Отрицательная разница (часы перевели назад) — ничего не начисляем;
  // lastTimestamp обновится ближайшим сохранением.
  const elapsedMs = now() - payload.lastTimestamp
  let offline: OfflineReport | null = null
  if (elapsedMs > 0) ({ state, report: offline } = applyOfflineProgress(state, elapsedMs))
  return { kind: 'loaded', state, offline }
}

// base64 для экспорта/импорта: btoa в браузере, Buffer в node (для тестов).
// Buffer берём через globalThis, чтобы не тянуть типы node в браузерный код.
interface BufferLike {
  from(s: string, enc: string): { toString(enc: string): string }
}
function nodeBuffer(): BufferLike {
  return (globalThis as Record<string, unknown>).Buffer as BufferLike
}
function toBase64(s: string): string {
  if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)))
  return nodeBuffer().from(s, 'utf8').toString('base64')
}
function fromBase64(s: string): string {
  if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)))
  return nodeBuffer().from(s, 'base64').toString('utf8')
}

export function encodeSaveString(state: GameState, now: () => number = Date.now): string {
  return toBase64(JSON.stringify(payloadFromState(state, now())))
}

// Понимает base64 от экспорта и, на всякий случай, голый JSON.
export function decodeSaveString(input: string): SavePayloadV1 | null {
  const attempts = [
    () => JSON.parse(fromBase64(input.trim())),
    () => JSON.parse(input.trim()),
  ]
  for (const attempt of attempts) {
    try {
      const payload = migrateSave(attempt())
      if (payload) return payload
    } catch {
      /* пробуем следующий вариант */
    }
  }
  return null
}
