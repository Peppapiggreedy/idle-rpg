// Сохранение и загрузка. Формат сейва версионируется; Decimal сериализуется
// строкой через toString(). localStorage и часы инжектируются, чтобы логика
// тестировалась в node без браузера.
import { Decimal } from './numbers'
import { RARITY_BY_ID } from '../data/rarity'
import type { Item, Rarity } from '../types'
import { applyXp, xpToNextLevel } from './formulas'
import {
  createInitialState,
  abilitiesOf,
  defaultAbilitySettings,
  emptyEquipment,
  monsterFromTemplate,
  spawnMonster,
  type AbilitySettings,
  type Equipment,
  type GameState,
} from './state'
import { createRng } from './rng'
import { ensureStats, STAT_IDS, type ModifierKind, type StatId, type StatModifier } from './stats'
import { SLOT_IDS, type SlotId } from '../data/slots'
import {
  AUTOSAVE_INTERVAL_S,
  GCD_MS,
  REGEN_DELAY_S,
  REGEN_TICK_S,
  REST_HP_THRESHOLD_DEFAULT,
  REST_RESOURCE_THRESHOLD_DEFAULT,
  LEGACY_V3_SWING_TIME_S,
  OFFLINE_CAP_HOURS,
  OFFLINE_CHUNK_MIN,
  OFFLINE_EFFICIENCY,
} from '../data/balance'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { DEFAULT_CLASS, classById } from '../data/classes'
import { MATERIAL_BY_ID } from '../data/materials'
import { FOOD_BY_ID } from '../data/recipes'
import { TALENTS } from '../data/talents'
import { DUNGEONS, DUNGEON_BY_ID, buildBoss } from '../data/dungeons'
import { currentBoss } from './dungeons'
import type { DungeonRun } from '../types'
import { rankOf } from './talents'
import { FALLBACK_ITEM_NAME } from '../data/loot'
import { SAFE_ZONE, ZONE_BY_ID } from '../data/zones'
import { currentZone, zoneRate } from './zones'

export const SAVE_KEY = 'idle-rpg-save'
export const SAVE_VERSION = 17
export const AUTOSAVE_INTERVAL_MS = AUTOSAVE_INTERVAL_S * 1000
// Потолок оффлайн-прогресса: дольше отсутствовать можно, но не оплачивается.
export const OFFLINE_CAP_MS = OFFLINE_CAP_HOURS * 60 * 60 * 1000
// Короче минуты отсутствия — награду начисляем, но модалку не показываем.
export const OFFLINE_MODAL_MIN_MS = 60_000
// Шаг, которым идёт оффлайн-агрегат.
export const OFFLINE_CHUNK_MS = OFFLINE_CHUNK_MIN * 60_000

// Актуальный формат сейва (v12). Все Decimal — строки. Прямых полей урона
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
  /** Сколько рук занимает оружие. Нет поля — предмет не оружие. */
  hands?: number
  mods: SavedModifier[]
}

export interface SavedAbilitySetting {
  autocast: boolean
  priority: number
  /** Резерв маны, доля 0..1. Настройка игрока — значит, часть прогресса. */
  reserve: number
}

export interface SavedDungeonRun {
  dungeonId: string
  bossIndex: number
  fightMs: number
}

export interface SavePayloadV17 {
  version: 17
  /** Материалы и готовая еда: id -> количество строкой (величина растущая). */
  materials: Record<string, string>
  /** Порция еды, уже потраченная на текущий привал. */
  restSpeedupSource: string | null
  /** Класс героя. Выбирается один раз при новой игре и не меняется. */
  classId: string
  lastTimestamp: number
  gold: string
  level: string
  currentXp: string
  currentHp: string
  currentMana: string
  // Привал сохраняется как СОСТОЯНИЕ, но не как отсчёт: перезагрузка не
  // должна ни красть уже отсиженное, ни давать его даром. Герой просыпается
  // отдохнувшим — это честнее обеих альтернатив.
  heroState: 'alive' | 'dead' | 'resting'
  restHpThreshold: number
  restResourceThreshold: number
  reviveMsLeft: number
  upgrades: Record<string, string>
  // Таланты: id -> ранг (обычные числа, не Decimal — рангов единицы).
  talents: Record<string, number>
  talentResets: number
  inventory: SavedItem[]
  equipment: Record<string, SavedItem | null>
  autoEquip: boolean
  currentZoneId: string
  lastSurvivedZoneId: string | null
  // Забег по данжу переживает перезагрузку, но не смерть внутри.
  dungeonRun: SavedDungeonRun | null
  dungeonsCleared: Record<string, boolean>
  // Умения: мана уже была, добавились кулдауны и глобальный кулдаун.
  // Очередь onNextSwing и наложенные эффекты НЕ сохраняются: они висели на
  // мобе, а моб при загрузке спавнится заново.
  gcdMsLeft: number
  abilityCooldownsMs: Record<string, number>
  // Правило задержки регенерации: сколько ещё ждать до старта восстановления.
  // Сохраняется, чтобы перезагрузка не обнуляла паузу — иначе выход и вход
  // стали бы способом мгновенно запустить реген.
  regenDelayMsLeft: number
  // Настройки автокаста: галка и приоритет по каждому умению.
  abilitySettings: Record<string, SavedAbilitySetting>
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
    ...(item.hands ? { hands: item.hands } : {}),
    mods: item.mods.map((m) => ({
      stat: m.stat,
      kind: m.kind,
      value: m.value.toString(),
      source: m.source,
    })),
  }
}

export function payloadFromState(state: GameState, lastTimestamp: number): SavePayloadV17 {
  const upgrades: Record<string, string> = {}
  for (const [id, owned] of Object.entries(state.upgrades)) upgrades[id] = owned.toString()
  const equipment: Record<string, SavedItem | null> = {}
  for (const slot of SLOT_IDS) {
    const item = state.equipment[slot]
    equipment[slot] = item ? savedFromItem(item) : null
  }
  // Кулдауны нулевой длины в сейв не пишем — это мусор, а не прогресс.
  const abilityCooldownsMs: Record<string, number> = {}
  for (const [id, left] of Object.entries(state.abilityCooldownsMs)) {
    if (left > 0 && id in ABILITY_BY_ID) abilityCooldownsMs[id] = left
  }
  const abilitySettings: Record<string, SavedAbilitySetting> = {}
  for (const ability of ABILITIES) {
    const setting = state.abilitySettings[ability.id]
    if (setting) abilitySettings[ability.id] = { ...setting }
  }
  // Нулевые ранги в сейв не пишем — это мусор, а не прогресс.
  const talents: Record<string, number> = {}
  for (const talent of TALENTS) {
    const rank = rankOf(state.talents, talent.id)
    if (rank > 0) talents[talent.id] = rank
  }
  // Пишем только реально пройденные данжи — false в сейве это мусор.
  const dungeonsCleared: Record<string, boolean> = {}
  for (const dungeon of DUNGEONS) {
    if (state.dungeonsCleared[dungeon.id] === true) dungeonsCleared[dungeon.id] = true
  }
  return {
    version: 17,
    classId: state.classId,
    materials: Object.fromEntries(
      Object.entries(state.materials)
        .filter(([, count]) => count.gt(0))
        .map(([id, count]) => [id, count.toString()]),
    ),
    restSpeedupSource: state.restSpeedupSource,
    lastTimestamp,
    inventory: state.inventory.map(savedFromItem),
    equipment,
    autoEquip: state.autoEquip,
    currentZoneId: state.currentZoneId,
    lastSurvivedZoneId: state.lastSurvivedZoneId,
    dungeonRun: state.dungeonRun ? { ...state.dungeonRun } : null,
    dungeonsCleared,
    gcdMsLeft: Math.max(0, state.gcdMsLeft),
    abilityCooldownsMs,
    regenDelayMsLeft: Math.max(0, state.regenDelayMsLeft),
    restHpThreshold: state.restHpThreshold,
    restResourceThreshold: state.restResourceThreshold,
    abilitySettings,
    itemSeq: state.itemSeq,
    gold: state.gold.toString(),
    level: state.level.toString(),
    currentXp: state.currentXp.toString(),
    currentHp: state.currentHp.toString(),
    currentMana: state.currentMana.toString(),
    heroState: state.heroState,
    reviveMsLeft: state.reviveMsLeft,
    upgrades,
    talents,
    talentResets: Math.max(0, Math.floor(state.talentResets)),
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

/**
 * Материалы из сейва: чужие id и мусорные числа отбрасываем, иначе рецепт
 * собрался бы из того, чего в игре нет.
 */
function materialsFromSaved(raw: unknown): Record<string, Decimal> {
  const result: Record<string, Decimal> = {}
  if (typeof raw !== 'object' || raw === null) return result
  for (const [id, count] of Object.entries(raw as Record<string, unknown>)) {
    if (!(id in MATERIAL_BY_ID) && !(id in FOOD_BY_ID)) continue
    const value = parseDec(count, '0')
    if (value.gt(0)) result[id] = value.floor()
  }
  return result
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
  // Двуручность — свойство предмета, а не слота: без неё связка рук
  // рассыпалась бы, и двуручное молча уживалось бы со щитом.
  const hands = raw.hands === 2 ? 2 : raw.hands === 1 ? 1 : undefined
  return {
    id: typeof raw.id === 'string' ? raw.id : `item-restored-${index}`,
    name: typeof raw.name === 'string' ? raw.name : FALLBACK_ITEM_NAME,
    rarity,
    slot,
    ...(hands ? { hands } : {}),
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
  // Правило связки рук держится и на загрузке: правленый руками сейв не должен
  // давать двуручное вместе со щитом. Побеждает правая рука — она задаёт бой.
  if (equipment.mainHand?.hands === 2) equipment.offHand = null
  return equipment
}

// Восстанавливает состояние поверх дефолтов: новые поля будущих версий
// автоматически получают значения из createInitialState. Моб и лог — свежие.
// Зона из сейва: неизвестный id (переименовали, откатили версию) деградирует
// до безопасной, чтобы герой не застрял в несуществующей зоне.
function zoneIdFromSaved(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw in ZONE_BY_ID ? raw : fallback
}

// Кулдауны из сейва: чужие id и мусорные числа отбрасываем, иначе умение
// из будущей версии заперло бы кнопку навсегда.
function cooldownsFromSaved(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null) return result
  for (const [id, left] of Object.entries(raw as Record<string, unknown>)) {
    if (!(id in ABILITY_BY_ID)) continue
    const max = ABILITY_BY_ID[id].cooldownSec * 1000
    if (typeof left === 'number' && Number.isFinite(left) && left > 0) {
      result[id] = Math.min(left, max)
    }
  }
  return result
}

function msFromSaved(raw: unknown, max: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(raw, max) : 0
}

// Настройки автокаста из сейва: чужие умения игнорируем, пропущенные
// добираем дефолтами — иначе новое умение осталось бы без настройки.
function abilitySettingsFromSaved(raw: unknown, classId: string): AbilitySettings {
  // Настройки — ТОЛЬКО по умениям своего класса: чужие в сейве означают
  // правку руками, и пускать их в ротацию нельзя.
  const settings = defaultAbilitySettings(classId)
  if (typeof raw !== 'object' || raw === null) return settings
  const saved = raw as Record<string, unknown>
  for (const ability of abilitiesOf(classId)) {
    const entry = saved[ability.id]
    if (typeof entry !== 'object' || entry === null) continue
    const { autocast, priority, reserve } = entry as Record<string, unknown>
    settings[ability.id] = {
      autocast: typeof autocast === 'boolean' ? autocast : settings[ability.id].autocast,
      priority:
        typeof priority === 'number' && Number.isFinite(priority)
          ? priority
          : settings[ability.id].priority,
      // Резерв появился позже галки и приоритета: в старом сейве его нет,
      // и ноль — то самое поведение, к которому игрок привык.
      reserve:
        typeof reserve === 'number' && Number.isFinite(reserve)
          ? Math.min(1, Math.max(0, reserve))
          : settings[ability.id].reserve,
    }
  }
  return settings
}

// Ранги из сейва: чужие id отбрасываем, свои режем по maxRank — иначе
// подправленный сейв дал бы талант выше потолка.
function talentsFromSaved(raw: unknown): Record<string, number> {
  const ranks: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null) return ranks
  const saved = raw as Record<string, unknown>
  for (const talent of TALENTS) {
    const rank = rankOf({ [talent.id]: Number(saved[talent.id]) }, talent.id)
    if (rank > 0) ranks[talent.id] = rank
  }
  return ranks
}

// Забег из сейва: чужой данж или индекс за пределами цепочки — забега нет.
// Лучше выйти наружу, чем застрять перед несуществующим боссом.
function dungeonRunFromSaved(raw: unknown): DungeonRun | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { dungeonId, bossIndex, fightMs } = raw as Record<string, unknown>
  if (typeof dungeonId !== 'string') return null
  const dungeon = DUNGEON_BY_ID[dungeonId]
  if (!dungeon) return null
  if (typeof bossIndex !== 'number' || !Number.isInteger(bossIndex)) return null
  if (bossIndex < 0 || bossIndex >= dungeon.bosses.length) return null
  return {
    dungeonId,
    bossIndex,
    fightMs: typeof fightMs === 'number' && Number.isFinite(fightMs) && fightMs > 0 ? fightMs : 0,
  }
}

function clearedFromSaved(raw: unknown): Record<string, boolean> {
  const cleared: Record<string, boolean> = {}
  if (typeof raw !== 'object' || raw === null) return cleared
  const saved = raw as Record<string, unknown>
  for (const dungeon of DUNGEONS) {
    if (saved[dungeon.id] === true) cleared[dungeon.id] = true
  }
  return cleared
}

export function stateFromPayload(p: SavePayloadV17): GameState {
  const level = Decimal.max(parseDec(p.level, '1'), new Decimal(1))
  const upgrades: Record<string, Decimal> = {}
  for (const [id, owned] of Object.entries(p.upgrades ?? {})) upgrades[id] = parseDec(owned, '0')
  // Класс восстанавливается ПЕРВЫМ: от него зависят стартовые статы, набор
  // умений и стартовая экипировка, поверх которых кладётся всё сохранённое.
  // Неизвестный класс (переименовали, откатили версию) деградирует до
  // дефолтного, а не оставляет героя без ресурса и без кнопок.
  const hero = classById(p.classId)
  const restored: GameState = {
    ...createInitialState(undefined, hero.id),
    classId: hero.id,
    gold: parseDec(p.gold, '0'),
    level,
    currentXp: parseDec(p.currentXp, '0'),
    xpToNext: xpToNextLevel(level),
    upgrades,
    talents: talentsFromSaved(p.talents),
    talentResets:
      typeof p.talentResets === 'number' && Number.isFinite(p.talentResets) && p.talentResets > 0
        ? Math.floor(p.talentResets)
        : 0,
    totalTicks: parseDec(p.totalTicks, '0'),
    playtimeMs: parseDec(p.playtimeMs, '0'),
    inventory: Array.isArray(p.inventory) ? p.inventory.map(itemFromSaved) : [],
    materials: materialsFromSaved(p.materials),
    // Порция, потраченная на прерванный привал, не возвращается: перезагрузка
    // не должна становиться способом сэкономить еду.
    restSpeedupSource:
      typeof p.restSpeedupSource === 'string' && p.restSpeedupSource in FOOD_BY_ID
        ? p.restSpeedupSource
        : null,
    equipment: equipmentFromSaved(p.equipment),
    autoEquip: typeof p.autoEquip === 'boolean' ? p.autoEquip : true,
    dungeonRun: dungeonRunFromSaved(p.dungeonRun),
    dungeonsCleared: clearedFromSaved(p.dungeonsCleared),
    currentZoneId: zoneIdFromSaved(p.currentZoneId, SAFE_ZONE.id),
    lastSurvivedZoneId:
      p.lastSurvivedZoneId === null || p.lastSurvivedZoneId === undefined
        ? null
        : zoneIdFromSaved(p.lastSurvivedZoneId, SAFE_ZONE.id),
    gcdMsLeft: msFromSaved(p.gcdMsLeft, GCD_MS),
    regenDelayMsLeft: msFromSaved(p.regenDelayMsLeft, REGEN_DELAY_S * 1000),
    // Таймер порции при загрузке взводится заново: доли секунды, которые
    // мана «недокапала», прогрессом не считаются.
    regenTickMsLeft: REGEN_TICK_S * 1000,
    abilityCooldownsMs: cooldownsFromSaved(p.abilityCooldownsMs),
    abilitySettings: abilitySettingsFromSaved(p.abilitySettings, hero.id),
    // Очередь и эффекты были на прежнем мобе — при загрузке начинаем чисто.
    queuedAbilityId: null,
    activeEffects: [],
    autocastReadyMs: {},
    itemSeq: typeof p.itemSeq === 'number' ? p.itemSeq : 0,
  }
  // Моб не сохраняется: спавним свежего из восстановленной зоны. Поток
  // случайности берём от сида состояния — загрузка остаётся детерминированной.
  // Внутри данжа перед героем стоит босс цепочки, а не моб зоны. HP боссу
  // возвращаем полное: бой начинается заново, зато и ярость сброшена.
  const boss = currentBoss(restored)
  restored.monster = boss
    ? monsterFromTemplate(buildBoss(boss))
    : spawnMonster(currentZone(restored), createRng(restored.rngSeed))
  // Статы — производные: после загрузки источников пересчитываем конвейером.
  const withStats = ensureStats({ ...restored, statsDirty: true })
  // Ресурсы героя: сохранённые значения с капом по пересчитанным статам;
  // отсутствие/мусор в поле (сейв старой версии) означает полный запас.
  const currentHp = Decimal.min(parseDec(p.currentHp, withStats.stats.maxHp.toString()), withStats.stats.maxHp)
  const currentMana = Decimal.min(parseDec(p.currentMana, withStats.stats.maxMana.toString()), withStats.stats.maxMana)
  const dead = p.heroState === 'dead'
  // Порог привала — настройка игрока, а не прогресс: мусор в поле означает
  // значение по умолчанию, а не потерю сейва.
  const share = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : fallback
  return {
    ...withStats,
    currentHp: dead ? new Decimal(0) : currentHp,
    currentMana,
    heroState: dead ? 'dead' : 'alive',
    reviveMsLeft: dead && typeof p.reviveMsLeft === 'number' && p.reviveMsLeft > 0 ? p.reviveMsLeft : dead ? 1 : 0,
    // Привал не досиживается через перезагрузку: герой просыпается на ногах.
    restMsLeft: 0,
    restTotalMs: 0,
    restHpThreshold: share(p.restHpThreshold, REST_HP_THRESHOLD_DEFAULT),
    restResourceThreshold: share(p.restResourceThreshold, REST_RESOURCE_THRESHOLD_DEFAULT),
    restSpeedupSource: null,
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

// Старый предмет знал один слот руки — 'weapon'. Слотов стало два, и у оружия
// появилось поле hands. Всё сохранённое оружие строилось с одним и тем же
// отношением «урон/скорость», то есть было ОДНОРУЧНЫМ по нынешним меркам:
// поэтому hands: 1, и вторая рука у старого героя остаётся свободной.
function handItemV14toV15(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const old = raw as RawSave
  if (old.slot !== 'weapon') return raw
  return { ...old, slot: 'mainHand', hands: 1 }
}

const MIGRATIONS: Record<number, (raw: RawSave) => RawSave> = {
  // 16 -> 17: появились профессии. Мешок материалов у старого героя пуст —
  // собирать он начнёт с ближайшего убитого моба. Прогресс не затронут.
  16: (raw) => ({ ...raw, version: 17, materials: {}, restSpeedupSource: null }),
  // 15 -> 16: появились классы. Все прежние герои — Стражи: ресурс маны,
  // правило задержки и те же три умения, что у них и были. Прогресс не
  // теряется: класс дописывается полем, всё остальное остаётся как есть.
  15: (raw) => ({ ...raw, version: 16, classId: DEFAULT_CLASS.id }),
  // 14 -> 15: рук стало две. Слот 'weapon' переименован в 'mainHand', левая
  // рука пуста — надеть в неё что-то игрок решит сам. Прогресс не теряется:
  // модификаторы предмета не меняются вовсе, меняется только имя слота.
  14: (raw) => {
    const equipment =
      typeof raw.equipment === 'object' && raw.equipment !== null
        ? ({ ...raw.equipment } as RawSave)
        : {}
    const weapon = equipment.weapon
    delete equipment.weapon
    return {
      ...raw,
      version: 17,
      inventory: Array.isArray(raw.inventory) ? raw.inventory.map(handItemV14toV15) : [],
      equipment: {
        ...equipment,
        mainHand: weapon ? handItemV14toV15(weapon) : null,
        offHand: null,
      },
    }
  },
  // 13 -> 14: появился привал. Старый герой получает порог по умолчанию: до
  // сих пор его единственной паузой была смерть, и теперь он будет уходить
  // отдыхать, не дожидаясь её.
  13: (raw) => ({
    ...raw,
    version: 14,
    restHpThreshold: REST_HP_THRESHOLD_DEFAULT,
    restResourceThreshold: REST_RESOURCE_THRESHOLD_DEFAULT,
  }),
  // 12 -> 13: правило задержки регенерации. У каждого умения появился резерв
  // маны, а у героя — пауза до старта восстановления. Старый герой просыпается
  // с нулевым резервом (жать всегда — ровно то поведение, к которому он
  // привык) и с уже идущей регенерацией.
  12: (raw) => ({ ...raw, version: 13, regenDelayMsLeft: 0 }),
  // 11 -> 12: появился данж. Старый сейв просыпается снаружи и без
  // достижений — цепочку ещё предстоит пройти.
  11: (raw) => ({ ...raw, version: 12, dungeonRun: null, dungeonsCleared: {} }),
  // 10 -> 11: появилось дерево талантов. Очки начисляются от уровня, так что
  // старый герой сразу получит все заработанные — вкладывать их ему самому.
  10: (raw) => ({ ...raw, version: 11, talents: {}, talentResets: 0 }),
  // 9 -> 10: появился автокаст. Старый сейв получает настройки по умолчанию:
  // все умения включены, приоритет — порядок из данных.
  9: (raw) => ({ ...raw, version: 10, abilitySettings: defaultAbilitySettings() }),
  // 8 -> 9: появились активные умения. Старый сейв просыпается с готовыми
  // умениями: кулдаунов не было — значит их и нет.
  8: (raw) => ({ ...raw, version: 9, gcdMsLeft: 0, abilityCooldownsMs: {} }),
  // 7 -> 8: появились зоны. Старый сейв просыпается в безопасной зоне, где
  // ещё ничего не доказано: lastSurvivedZoneId пуст, смерть вернёт туда же.
  7: (raw) => ({
    ...raw,
    version: 8,
    currentZoneId: SAFE_ZONE.id,
    lastSurvivedZoneId: null,
  }),
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
export function migrateSave(raw: unknown): SavePayloadV17 | null {
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
  return data as unknown as SavePayloadV17
}

export interface OfflineReport {
  elapsedMs: number
  kills: Decimal
  gold: Decimal
  xp: Decimal
}

// Оффлайн-прогресс одним агрегатом, без проигрывания тиков. Темп боя берётся
// из zoneRate, а тот зовёт estimateCombatRate — ту же функцию, что и онлайн,
// чтобы формула боя не жила в двух местах.
export function applyOfflineProgress(
  state: GameState,
  elapsedMs: number,
): { state: GameState; report: OfflineReport | null } {
  let cappedMs = Math.min(elapsedMs, OFFLINE_CAP_MS)
  if (cappedMs <= 0) return { state, report: null }
  // В данже оффлайна нет: цепочка боссов — активный контент, сама она себя
  // не проходит. Забег ждёт героя ровно там, где он его оставил.
  if (state.dungeonRun) return { state, report: null }
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
  // Оффлайн считаем по темпу ТЕКУЩЕЙ ЗОНЫ, а не по мобу, который случайно
  // стоял перед героем в момент выхода: за восемь часов он перебьёт весь пул.
  // Формула боя та же (zoneRate зовёт estimateCombatRate), своей у оффлайна нет.
  //
  // ЖЕЛЕЗНОЕ ПРАВИЛО: оффлайн <= автокаст <= ручная игра. Считаем по модели
  // АВТОКАСТА (та же задержка реакции и те же приоритеты, что в бою) и ещё
  // умножаем на OFFLINE_EFFICIENCY. По идеальной игре оффлайн не считается
  // никогда — иначе выгоднее было бы закрыть вкладку.
  //
  // Идём шагами по OFFLINE_CHUNK_MS: набранные уровни повышают живучесть, а
  // значит и темп следующего шага. Темп пересчитываем только при смене уровня —
  // внутри одного уровня он неизменен.
  const zone = currentZone(state)
  let s = state
  let rate = zoneRate(s, zone, 'auto')
  let rateLevel = s.level
  let kills = new Decimal(0)
  let gold = new Decimal(0)
  let xp = new Decimal(0)
  for (let left = cappedMs; left > 0; left -= OFFLINE_CHUNK_MS) {
    const seconds = new Decimal(Math.min(OFFLINE_CHUNK_MS, left)).div(1000)
    if (!rateLevel.eq(s.level)) {
      rate = zoneRate(s, zone, 'auto')
      rateLevel = s.level
    }
    const chunkXp = rate.xpPerSecond.times(seconds).times(OFFLINE_EFFICIENCY)
    kills = kills.plus(rate.killsPerSecond.times(seconds).times(OFFLINE_EFFICIENCY))
    gold = gold.plus(rate.goldPerSecond.times(seconds).times(OFFLINE_EFFICIENCY))
    xp = xp.plus(chunkXp)
    const leveled = applyXp(s.level, s.currentXp, chunkXp)
    s = {
      ...s,
      level: leveled.level,
      currentXp: leveled.currentXp,
      xpToNext: leveled.xpToNext,
      // Уровень — источник статов: следующий шаг должен считаться по новым.
      statsDirty: s.statsDirty || leveled.level.gt(s.level),
    }
    if (s.statsDirty) s = ensureStats(s)
  }
  // Дробные убийства копим по шагам и округляем один раз, в самом конце.
  kills = kills.floor()
  if (kills.lte(0)) return { state, report: null }
  return {
    state: { ...s, gold: s.gold.plus(gold) },
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
export function decodeSaveString(input: string): SavePayloadV17 | null {
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
