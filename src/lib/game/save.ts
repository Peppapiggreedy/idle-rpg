// Сохранение и загрузка. Формат сейва версионируется; Decimal сериализуется
// строкой через toString(). localStorage и часы инжектируются, чтобы логика
// тестировалась в node без браузера.
import { Decimal } from './numbers'
import { RARITY_BY_ID } from '../data/rarity'
import type { Item, Rarity } from '../types'
import { applyXp, xpToNextLevel } from './formulas'
import { createInitialState, emptyEquipment, spawnMonster, type Equipment, type GameState } from './state'
import { ensureStats, STAT_IDS, type ModifierKind, type StatId, type StatModifier } from './stats'
import { SLOT_IDS, type SlotId } from '../data/slots'
import { AUTOSAVE_INTERVAL_S, LEGACY_V3_SWING_TIME_S, OFFLINE_CAP_HOURS } from '../data/balance'
import { estimateCombatRate } from './combat'
import { FALLBACK_ITEM_NAME } from '../data/loot'
import { FIRST_MONSTER } from '../data/monsters'

export const SAVE_KEY = 'idle-rpg-save'
export const SAVE_VERSION = 7
export const AUTOSAVE_INTERVAL_MS = AUTOSAVE_INTERVAL_S * 1000
// Потолок оффлайн-прогресса: дольше отсутствовать можно, но не оплачивается.
export const OFFLINE_CAP_MS = OFFLINE_CAP_HOURS * 60 * 60 * 1000
// Короче минуты отсутствия — награду начисляем, но модалку не показываем.
export const OFFLINE_MODAL_MIN_MS = 60_000

// Актуальный формат сейва (v7). Все Decimal — строки. Прямых полей урона
// и скорости атаки в формате НЕТ: статы — производные от счётчиков покупок
// и надетой экипировки, пересчитываются конвейером stats.ts.
export interface SavedModifier {
  stat: string
  kind: string
  value: string
  source: string
}

export interface SavedItem {
  id: string
  name: string
  rarity: string
  slot: string
  mods: SavedModifier[]
}

export interface SavePayloadV7 {
  version: 7
  lastTimestamp: number
  gold: string
  level: string
  currentXp: string
  currentHp: string
  currentMana: string
  heroState: 'alive' | 'dead'
  reviveMsLeft: number
  upgrades: Record<string, string>
  inventory: SavedItem[]
  equipment: Record<string, SavedItem | null>
  autoEquip: boolean
  itemSeq: number
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

function savedFromItem(item: Item): SavedItem {
  return {
    id: item.id,
    name: item.name,
    rarity: item.rarity,
    slot: item.slot,
    mods: item.mods.map((m) => ({
      stat: m.stat,
      kind: m.kind,
      value: m.value.toString(),
      source: m.source,
    })),
  }
}

export function payloadFromState(state: GameState, lastTimestamp: number): SavePayloadV7 {
  const upgrades: Record<string, string> = {}
  for (const [id, owned] of Object.entries(state.upgrades)) upgrades[id] = owned.toString()
  const equipment: Record<string, SavedItem | null> = {}
  for (const slot of SLOT_IDS) {
    const item = state.equipment[slot]
    equipment[slot] = item ? savedFromItem(item) : null
  }
  return {
    version: 7,
    lastTimestamp,
    inventory: state.inventory.map(savedFromItem),
    equipment,
    autoEquip: state.autoEquip,
    itemSeq: state.itemSeq,
    gold: state.gold.toString(),
    level: state.level.toString(),
    currentXp: state.currentXp.toString(),
    currentHp: state.currentHp.toString(),
    currentMana: state.currentMana.toString(),
    heroState: state.heroState,
    reviveMsLeft: state.reviveMsLeft,
    upgrades,
    totalTicks: state.totalTicks.toString(),
    playtimeMs: state.playtimeMs.toString(),
  }
}

const MODIFIER_KINDS: ModifierKind[] = ['base', 'flat', 'percent', 'multiplier']

// Модификатор из сейва: неизвестный стат или kind — мусор, такой модификатор
// выбрасываем, иначе он молча испортит конвейер статов.
function modifierFromSaved(raw: SavedModifier): StatModifier | null {
  if (typeof raw !== 'object' || raw === null) return null
  if (!STAT_IDS.includes(raw.stat as StatId)) return null
  if (!MODIFIER_KINDS.includes(raw.kind as ModifierKind)) return null
  return {
    stat: raw.stat as StatId,
    kind: raw.kind as ModifierKind,
    value: parseDec(raw.value, '0'),
    source: typeof raw.source === 'string' ? raw.source : 'equipment',
  }
}

function itemFromSaved(raw: SavedItem, index: number): Item {
  // Неизвестная редкость (например, из будущей версии) деградирует до common.
  const rarity: Rarity = raw.rarity in RARITY_BY_ID ? (raw.rarity as Rarity) : 'common'
  // Неизвестный слот деградирует до талисмана: слот без base-модификаторов,
  // предмет останется носимым и ничего не сломает в бою.
  const slot: SlotId = SLOT_IDS.includes(raw.slot as SlotId) ? (raw.slot as SlotId) : 'trinket'
  const mods = Array.isArray(raw.mods)
    ? raw.mods.map(modifierFromSaved).filter((m): m is StatModifier => m !== null)
    : []
  return {
    id: typeof raw.id === 'string' ? raw.id : `item-restored-${index}`,
    name: typeof raw.name === 'string' ? raw.name : FALLBACK_ITEM_NAME,
    rarity,
    slot,
    mods,
  }
}

// Экипировка из сейва: предмет обязан лежать в СВОЁМ слоте, иначе оружие могло
// бы задать базу боя из слота брони. Чужой предмет просто не надевается.
function equipmentFromSaved(raw: Record<string, SavedItem | null> | undefined): Equipment {
  const equipment = emptyEquipment()
  if (typeof raw !== 'object' || raw === null) return equipment
  SLOT_IDS.forEach((slot, index) => {
    const saved = raw[slot]
    if (!saved) return
    const item = itemFromSaved(saved, index)
    if (item.slot === slot) equipment[slot] = item
  })
  return equipment
}

// Восстанавливает состояние поверх дефолтов: новые поля будущих версий
// автоматически получают значения из createInitialState. Моб и лог — свежие.
export function stateFromPayload(p: SavePayloadV7): GameState {
  const level = Decimal.max(parseDec(p.level, '1'), new Decimal(1))
  const upgrades: Record<string, Decimal> = {}
  for (const [id, owned] of Object.entries(p.upgrades ?? {})) upgrades[id] = parseDec(owned, '0')
  const restored: GameState = {
    ...createInitialState(),
    gold: parseDec(p.gold, '0'),
    level,
    currentXp: parseDec(p.currentXp, '0'),
    xpToNext: xpToNextLevel(level),
    upgrades,
    totalTicks: parseDec(p.totalTicks, '0'),
    playtimeMs: parseDec(p.playtimeMs, '0'),
    inventory: Array.isArray(p.inventory) ? p.inventory.map(itemFromSaved) : [],
    equipment: equipmentFromSaved(p.equipment),
    autoEquip: typeof p.autoEquip === 'boolean' ? p.autoEquip : true,
    itemSeq: typeof p.itemSeq === 'number' ? p.itemSeq : 0,
    monster: spawnMonster(FIRST_MONSTER),
  }
  // Статы — производные: после загрузки источников пересчитываем конвейером.
  const withStats = ensureStats({ ...restored, statsDirty: true })
  // Ресурсы героя: сохранённые значения с капом по пересчитанным статам;
  // отсутствие/мусор в поле (сейв старой версии) означает полный запас.
  const currentHp = Decimal.min(parseDec(p.currentHp, withStats.stats.maxHp.toString()), withStats.stats.maxHp)
  const currentMana = Decimal.min(parseDec(p.currentMana, withStats.stats.maxMana.toString()), withStats.stats.maxMana)
  const dead = p.heroState === 'dead'
  return {
    ...withStats,
    currentHp: dead ? new Decimal(0) : currentHp,
    currentMana,
    heroState: dead ? 'dead' : 'alive',
    reviveMsLeft: dead && typeof p.reviveMsLeft === 'number' && p.reviveMsLeft > 0 ? p.reviveMsLeft : dead ? 1 : 0,
  }
}

// Цепочка миграций: MIGRATIONS[v] переводит формат v в v+1.
// v0 — «доверсионный» формат (без поля version): переносим известные поля.
type RawSave = Record<string, unknown>
// Историческое имя поля формата v3. Стат с тех пор разделён на weaponSpeed
// и haste, но ключ в уже сохранённых JSON остался прежним — читаем как есть.
const LEGACY_V3_SPEED_FIELD = 'attackSpeed'

// Старый предмет (до экипировки) не имел ни слота, ни модификаторов — только
// statBonus, прибавку к силе атаки. Слот выбираем 'trinket': он без
// base-модификаторов, поэтому предмет не подменит базу боя.
function itemV6toV7(raw: unknown): RawSave {
  const old = (typeof raw === 'object' && raw !== null ? raw : {}) as RawSave
  return {
    id: old.id,
    name: old.name,
    rarity: old.rarity,
    slot: 'trinket',
    mods: [
      {
        stat: 'attackPower',
        kind: 'flat',
        value: parseDec(old.statBonus, '1').toString(),
        source: 'equipment:trinket',
      },
    ],
  }
}

const MIGRATIONS: Record<number, (raw: RawSave) => RawSave> = {
  // 6 -> 7: появилась экипировка. У предметов вместо statBonus теперь slot и
  // mods в формате конвейера статов; сама экипировка пустая — старые предметы
  // остаются в инвентаре, игрок наденет их сам.
  6: (raw) => ({
    ...raw,
    version: 7,
    inventory: Array.isArray(raw.inventory) ? raw.inventory.map(itemV6toV7) : [],
    equipment: {},
    autoEquip: true,
  }),
  // 5 -> 6: сменилась МОДЕЛЬ урона (диапазон оружия + сила атаки через
  // AP_NORMALIZATION), но набор полей формата не изменился: урон и раньше был
  // производным от счётчика покупок. Миграция-тождество — версия лишь помечает,
  // что сейв записан кодом с новой боевой формулой; пересчёт статов при загрузке
  // даёт прежний эффективный урон в секунду (есть тест).
  5: (raw) => ({ ...raw, version: 6 }),
  // 4 -> 5: у героя появились HP/мана и смертность; старый сейв просыпается
  // живым с полным запасом (поля добавит stateFromPayload по дефолтам).
  4: (raw) => ({ ...raw, version: 5, heroState: 'alive', reviveMsLeft: 0 }),
  // 3 -> 4: урон стал производным от счётчика покупок (конвейер статов),
  // прямые поля урона и скорости из формата удалены. Для честного сейва
  // пересчёт даёт то же значение, что хранилось.
  3: (raw) => {
    const next: RawSave = { ...raw, version: 4 }
    delete next.damagePerSwing
    delete next[LEGACY_V3_SPEED_FIELD]
    return next
  },
  // 2 -> 3: бой перешёл на дискретные удары. baseDamage был уроном в секунду;
  // урон за удар = dps * время замаха, чтобы урон в секунду не изменился.
  2: (raw) => ({
    ...raw,
    version: 3,
    damagePerSwing: parseDec(raw.baseDamage, '10').times(LEGACY_V3_SWING_TIME_S).toString(),
    [LEGACY_V3_SPEED_FIELD]: LEGACY_V3_SWING_TIME_S,
  }),
  // 1 -> 2: появились инвентарь и счётчик id предметов.
  1: (raw) => ({
    ...raw,
    version: 2,
    inventory: [],
    itemSeq: 0,
  }),
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
export function migrateSave(raw: unknown): SavePayloadV7 | null {
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
  return data as unknown as SavePayloadV7
}

export interface OfflineReport {
  elapsedMs: number
  kills: Decimal
  gold: Decimal
  xp: Decimal
}

// Оффлайн-прогресс одним агрегатом, без проигрывания тиков. Темп боя берётся
// из estimateCombatRate — той же функции, что и в онлайне, чтобы формула боя
// не жила в двух местах.
export function applyOfflineProgress(
  state: GameState,
  elapsedMs: number,
): { state: GameState; report: OfflineReport | null } {
  let cappedMs = Math.min(elapsedMs, OFFLINE_CAP_MS)
  if (cappedMs <= 0) return { state, report: null }
  // Герой ушёл в оффлайн мёртвым: сперва тратим время на воскрешение.
  if (state.heroState === 'dead') {
    const reviveMs = Math.min(state.reviveMsLeft, cappedMs)
    cappedMs -= reviveMs
    state = {
      ...state,
      reviveMsLeft: state.reviveMsLeft - reviveMs,
      ...(state.reviveMsLeft - reviveMs <= 0
        ? { heroState: 'alive' as const, reviveMsLeft: 0, currentHp: state.stats.maxHp }
        : {}),
    }
    if (state.heroState === 'dead' || cappedMs <= 0)
      return { state, report: null }
  }
  const { goldReward, xpReward } = state.monster
  const kills = estimateCombatRate(state).killsPerSecond.times(cappedMs).div(1000).floor()
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

// Причины отказа загрузки; текст для игрока по коду рендерит UI.
export type LoadErrorReason = 'corrupted' | 'newer-version'

export type LoadResult =
  | { kind: 'fresh' }
  | { kind: 'error'; reason: LoadErrorReason }
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
    return { kind: 'error', reason: 'corrupted' }
  }
  const payload = migrateSave(parsed)
  if (payload === null) return { kind: 'error', reason: 'newer-version' }

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
export function decodeSaveString(input: string): SavePayloadV7 | null {
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
