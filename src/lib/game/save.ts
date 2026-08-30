// Сохранение и загрузка. Формат сейва версионируется; Decimal сериализуется
// строкой через toString(). localStorage и часы инжектируются, чтобы логика
// тестировалась в node без браузера.
import { Decimal } from './numbers'
import { RARITY_BY_ID, type RarityDef } from '../data/rarity'
import type { Item, Rarity } from '../types'
import { applyXp, xpToNextLevel } from './formulas'
import {
  createInitialState,
  abilitiesOf,
  defaultAbilitySettings,
  emptyEquipment,
  spawnMonster,
  type AbilitySettings,
  type Equipment,
  type GameState,
  type ActivePotion,
} from './state'
import { createRng, randomSeed } from './rng'
import { TEMPLE_BY_ID } from '../data/temple'
import { advancePotions, gatherHerbs } from './potions'
import { ENCHANT_BY_ID } from '../data/enchants'
import { PROC_BY_ID } from '../data/procs'
import { ensureStats, STAT_IDS, type ModifierKind, type StatId, type StatModifier } from './stats'
import { SLOT_IDS, type SlotId } from '../data/slots'
import type { Grip } from '../data/items'
import {
  INVENTORY_SIZE,
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
  itemLevelScale,
  LEVEL_CAP,
} from '../data/balance'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { DEFAULT_CLASS, classById } from '../data/classes'
import { MATERIAL_BY_ID } from '../data/materials'
import { FOOD_BY_ID, POTION_RECIPE_BY_ID, isBagId } from '../data/recipes'
import { BRANCHES, talentsInBranch, talentsOfClass } from '../data/talents'
import {
  ALL_DUNGEONS,
  DUNGEON_BY_ID,
  clearKey,
  dungeonView,
  type DungeonDifficulty,
} from '../data/dungeons'
import { leaveDungeon } from './dungeons'
import { QUEST_CHAIN } from '../data/quests'
import type { DungeonRun, QuestProgress, TempleRun } from '../types'
import { rankOf } from './talents'
import { FALLBACK_ITEM_NAME, ITEM_BASE_SELL_PRICE } from '../data/loot'
import { SAFE_ZONE, ZONE_BY_ID } from '../data/zones'
import { currentZone, offlineZone, zoneRate } from './zones'
import { isUpgradeValue, lootValue, rollLoot, stashLoot, type LootValueCache } from './loot'
import { averageMonsterLevel } from '../data/zones'
import { leaveTemple } from './temple'
import type { Rng } from './rng'

export const SAVE_KEY = 'idle-rpg-save'
/**
 * Сдвиг сида для потока лута в оффлайне. Нужен, чтобы этот поток не совпадал
 * с потоком спавна моба при загрузке: оба заводятся от одного сида состояния,
 * и без сдвига «какой моб стоит перед героем» и «что выпало за ночь» были бы
 * связаны одним и тем же первым броском.
 */
const OFFLINE_LOOT_SALT = 0x9e37_79b9
/** Все хваты одним списком: сейв принимает только их. */
const GRIPS: Grip[] = ['one', 'two', 'shield']

export const SAVE_VERSION = 20
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
  /** Уровень предмета: с какого моба упал, от него растёт сила. */
  level: number
  /** ХВАТ: 'one' | 'two' | 'shield'. Нет поля — предмет не идёт в руки. */
  grip?: string
  /** Наложенное зачарование. Нет поля — предмет не зачарован. */
  enchantId?: string
  /** Прок вещи. Нет поля — прока нет. */
  procId?: string
  mods: SavedModifier[]
}

export interface SavedAbilitySetting {
  autocast: boolean
  priority: number
  /** Резерв маны, доля 0..1. Настройка игрока — значит, часть прогресса. */
  reserve: number
}

export interface SavedTempleRun {
  templeId: string
  wave: number
  day: number
  seed: number
  level: number
}

export interface SavedDungeonRun {
  dungeonId: string
  /** Сложность забега: обычная и героическая — разные числа одной цепочки. */
  difficulty: DungeonDifficulty
  bossIndex: number
  fightMs: number
}

export interface SavePayloadV20 {
  version: 20
  /** Мешок: материалы, травы, еда и склянки — id -> количество строкой. */
  materials: Record<string, string>
  /** Пыль зачарования: величина растущая, поэтому строкой. */
  enchantDust: string
  /** Идентификатор игры: из него и из даты считается сид забега по храму.
   *  Терять его нельзя — вместе с ним поменялся бы и поток волн. */
  saveId: number
  /** Забег по храму переживает перезагрузку, но не смерть внутри. */
  templeRun: SavedTempleRun | null
  templeBestWave: number
  /** Отметка последней попытки, реальное время. Часы назад её не отменяют. */
  templeLastRunAtMs: number
  /** Внутренние кулдауны проков: id прока -> сколько мс осталось. */
  procCooldownsMs: Record<string, number>
  /** Действующие зелья. Переживают перезагрузку: склянка выпита и оплачена
   *  травами, отнимать её за F5 нельзя. Оффлайн их дожигает. */
  activePotions: Array<{ recipeId: string; msLeft: number }>
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
  // Таланты: id -> ранг (обычные числа, не Decimal — рангов единицы).
  talents: Record<string, number>
  talentResets: number
  inventory: SavedItem[]
  equipment: Record<string, SavedItem | null>
  currentZoneId: string
  lastSurvivedZoneId: string | null
  // Забег по данжу переживает перезагрузку, но не смерть внутри.
  dungeonRun: SavedDungeonRun | null
  dungeonsCleared: Record<string, boolean>
  /** Цепочка преквестов: сданные задания и счётчик текущего. */
  questProgress: { done: Record<string, boolean>; counter: number }
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
  removeItem(key: string): void
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
    level: item.level,
    ...(item.grip ? { grip: item.grip } : {}),
    ...(item.enchantId ? { enchantId: item.enchantId } : {}),
    ...(item.procId ? { procId: item.procId } : {}),
    mods: item.mods.map((m) => ({
      stat: m.stat,
      kind: m.kind,
      value: m.value.toString(),
      source: m.source,
    })),
  }
}

export function payloadFromState(state: GameState, lastTimestamp: number): SavePayloadV20 {
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
  // Нулевые ранги в сейв не пишем — это мусор, а не прогресс. Дерево берётся
  // ПО КЛАССУ: чужих веток у героя нет, и увозить их в сейве незачем.
  const talents: Record<string, number> = {}
  for (const talent of talentsOfClass(state.classId)) {
    const rank = rankOf(state.talents, talent.id)
    if (rank > 0) talents[talent.id] = rank
  }
  // Чужой id задания в сейве — мусор, а не прогресс: то же правило, что
  // и у пройденных данжей.
  const questsDone: Record<string, boolean> = {}
  for (const quest of QUEST_CHAIN.quests) {
    if (state.questProgress.done[quest.id] === true) questsDone[quest.id] = true
  }
  // Пишем только реально пройденные данжи — false в сейве это мусор.
  const dungeonsCleared: Record<string, boolean> = {}
  for (const dungeon of ALL_DUNGEONS) {
    const key = clearKey(dungeon.id, dungeon.difficulty)
    if (state.dungeonsCleared[key] === true) dungeonsCleared[key] = true
  }
  return {
    version: 20,
    classId: state.classId,
    materials: Object.fromEntries(
      Object.entries(state.materials)
        .filter(([, count]) => count.gt(0))
        .map(([id, count]) => [id, count.toString()]),
    ),
    // Нулевые и чужие зелья в сейв не пишем — это мусор, а не прогресс.
    activePotions: state.activePotions
      .filter((p) => p.msLeft > 0 && p.recipeId in POTION_RECIPE_BY_ID)
      .map((p) => ({ recipeId: p.recipeId, msLeft: Math.max(0, p.msLeft) })),
    enchantDust: state.enchantDust.floor().toString(),
    saveId: state.saveId >>> 0,
    templeRun: state.templeRun ? { ...state.templeRun } : null,
    templeBestWave: Math.max(0, Math.floor(state.templeBestWave)),
    templeLastRunAtMs: Math.max(0, state.templeLastRunAtMs),
    // Нулевой кулдаун — мусор, а не прогресс: полная готовность это отсутствие
    // записи, ровно как у зарядов умений.
    procCooldownsMs: Object.fromEntries(
      Object.entries(state.procCooldownsMs).filter(([id, left]) => left > 0 && id in PROC_BY_ID),
    ),
    restSpeedupSource: state.restSpeedupSource,
    lastTimestamp,
    inventory: state.inventory.map(savedFromItem),
    equipment,
    currentZoneId: state.currentZoneId,
    lastSurvivedZoneId: state.lastSurvivedZoneId,
    dungeonRun: state.dungeonRun ? { ...state.dungeonRun } : null,
    dungeonsCleared,
    questProgress: {
      done: questsDone,
      counter: Math.max(0, Math.floor(state.questProgress.counter)),
    },
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
    // Своими считаются материалы, травы, еда и склянки — всё, что вообще
    // может лежать в мешке. Забытый вид молча пропал бы при загрузке.
    if (!(id in MATERIAL_BY_ID) && !isBagId(id)) continue
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
  // Хват — свойство предмета, а не слота: без него связка рук рассыпалась бы,
  // и двуручное молча уживалось бы со щитом. Чужое значение отбрасываем —
  // предмет останется носимым, а правила хвата просто не про него.
  const grip = GRIPS.includes(raw.grip as Grip) ? (raw.grip as Grip) : undefined
  // Уровень предмета из сейва принимаем только конечным числом не меньше 1:
  // мусор деградирует до первого уровня, а не до NaN в силе вещи.
  const level = Number.isFinite(raw.level) && raw.level >= 1 ? Math.floor(raw.level) : 1
  // Зачарование из сейва: чужой id (переименовали, откатили версию) и
  // зачарование не для этого слота отбрасываем. Иначе правленый руками сейв
  // повесил бы руну оружия на талисман и подменил базу боя.
  const enchant = typeof raw.enchantId === 'string' ? ENCHANT_BY_ID[raw.enchantId] : undefined
  const enchantId = enchant && enchant.slots.includes(slot) ? enchant.id : undefined
  // Прок принимаем только СВОЙ: неизвестный молча отбрасывается, а предмет
  // остаётся носимым — терять из-за переименования вещь целиком нельзя.
  const procId = typeof raw.procId === 'string' && raw.procId in PROC_BY_ID ? raw.procId : undefined
  return {
    id: typeof raw.id === 'string' ? raw.id : `item-restored-${index}`,
    name: typeof raw.name === 'string' ? raw.name : FALLBACK_ITEM_NAME,
    rarity,
    slot,
    level,
    ...(grip ? { grip } : {}),
    ...(enchantId ? { enchantId } : {}),
    ...(procId ? { procId } : {}),
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
  if (equipment.mainHand?.grip === 'two') equipment.offHand = null
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
// Ранги ЧУЖИХ веток отбрасываются: дерево привязано к классу, и правленый
// руками сейв не должен выдать герою чужой стиль.
function talentsFromSaved(raw: unknown, classId: string): Record<string, number> {
  const ranks: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null) return ranks
  const saved = raw as Record<string, unknown>
  for (const talent of talentsOfClass(classId)) {
    const rank = rankOf({ [talent.id]: Number(saved[talent.id]) }, talent.id)
    if (rank > 0) ranks[talent.id] = rank
  }
  return ranks
}

/**
 * КАРТА СООТВЕТСТВИЯ старого дерева новому.
 *
 * Старое дерево было общим на оба класса, новое — своё у каждого. Поэтому
 * карта двухступенчатая: талант -> его новое имя у КАЖДОГО класса. Где
 * соответствия нет (у Гнева нет левой руки, изуверу чужды мана и её пауза),
 * стоит пусто — очки вернутся свободными, а не потеряются.
 */
const LEGACY_TALENT_MAP: Record<string, Record<string, string>> = {
  // Ярость -> Гнев / Резня
  'honed-edge': { warden: 'wrath-honed-edge', reaver: 'carnage-bloodlust' },
  'keen-eye': { warden: 'wrath-keen-eye', reaver: 'carnage-predator-eye' },
  'savage-blows': { warden: 'wrath-savage-blows', reaver: 'carnage-ferocity' },
  frenzy: { warden: 'wrath-frenzy', reaver: 'carnage-drive' },
  // Левая рука есть только у Резни: Гнев растёт одноручным со щитом.
  'offhand-mastery': { reaver: 'carnage-offhand' },
  rupture: { warden: 'wrath-rupture', reaver: 'carnage-bleeding-wound' },
  // Стойкость -> Оплот / Жилы
  'thick-hide': { warden: 'bulwark-thick-hide', reaver: 'sinew-beast-hide' },
  'second-wind': { warden: 'bulwark-battle-breath', reaver: 'sinew-knitting' },
  'shield-wall': { warden: 'bulwark-shield-wall', reaver: 'sinew-forearm-guard' },
  'bulwark-training': { warden: 'bulwark-training', reaver: 'sinew-heavy-riposte' },
  'iron-skin': { warden: 'bulwark-iron-skin', reaver: 'sinew-tanned-hide' },
  'swift-return': { warden: 'bulwark-swift-return', reaver: 'sinew-not-finished' },
  // Самообладание -> Бдение / Чутьё
  'steady-breath': { warden: 'vigil-steady-breath' },
  'clear-mind': { warden: 'vigil-clear-mind' },
  'deep-well': { warden: 'vigil-deep-well', reaver: 'instinct-rage-capacity' },
  'quick-camp': { warden: 'vigil-quick-camp', reaver: 'instinct-short-rest' },
  'field-medicine': { warden: 'vigil-field-medicine', reaver: 'instinct-beast-sense' },
  'unbroken-focus': { warden: 'vigil-unbroken-focus', reaver: 'instinct-never-cooling' },
}

/**
 * Ранги старого дерева -> ранги нового.
 *
 * ДВА ПРОХОДА, и второй важнее первого. Сперва перенос по карте, потом
 * проверка ЗАКОННОСТИ: этажи в новом дереве стоят по 5 очков, а в старом
 * шли по 3, поэтому честно перенесённый ранг может оказаться на этаже, до
 * которого игрок не дотягивается. Такой ранг НЕ записывается — и очко
 * возвращается само: доступные очки это заработанные минус вложенные,
 * отдельного счётчика нет.
 */
function talentsV18toV19(raw: unknown, classId: string): Record<string, number> {
  const mapped: Record<string, number> = {}
  if (typeof raw === 'object' && raw !== null) {
    for (const [oldId, value] of Object.entries(raw as Record<string, unknown>)) {
      const newId = LEGACY_TALENT_MAP[oldId]?.[classId]
      const rank = Number(value)
      if (!newId || !Number.isFinite(rank) || rank <= 0) continue
      mapped[newId] = Math.floor(rank)
    }
  }
  const kept: Record<string, number> = {}
  for (const branch of BRANCHES) {
    if (branch.classId !== classId) continue
    let spent = 0
    for (const talent of talentsInBranch(branch.id)) {
      const rank = Math.min(mapped[talent.id] ?? 0, talent.maxRank)
      if (rank <= 0) continue
      // Этаж ещё не открыт тем, что удержано выше, — перенести нельзя.
      if (spent < talent.requiredPointsInBranch) continue
      kept[talent.id] = rank
      spent += rank
    }
  }
  return kept
}

// Зелья из сейва: чужой рецепт и мусорное время отбрасываем, своё режем по
// длительности — иначе правленый сейв дал бы вечную склянку.
function potionsFromSaved(raw: unknown): ActivePotion[] {
  if (!Array.isArray(raw)) return []
  const potions: ActivePotion[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const { recipeId, msLeft } = entry as Record<string, unknown>
    if (typeof recipeId !== 'string' || seen.has(recipeId)) continue
    const recipe = POTION_RECIPE_BY_ID[recipeId]
    if (!recipe) continue
    if (typeof msLeft !== 'number' || !Number.isFinite(msLeft) || msLeft <= 0) continue
    seen.add(recipeId)
    potions.push({ recipeId, msLeft: Math.min(msLeft, recipe.output.durationSec * 1000) })
  }
  return potions
}

// Внутренние кулдауны проков из сейва: чужие id отбрасываем, свои режем по
// длительности — иначе правленый сейв запер бы прок навсегда.
function procCooldownsFromSaved(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {}
  if (typeof raw !== 'object' || raw === null) return result
  for (const [id, left] of Object.entries(raw as Record<string, unknown>)) {
    const proc = PROC_BY_ID[id]
    if (!proc) continue
    if (typeof left !== 'number' || !Number.isFinite(left) || left <= 0) continue
    result[id] = Math.min(left, proc.internalCooldownMs)
  }
  return result
}

// Прогресс заданий из сейва: чужие id отбрасываем, счётчик режем по нулю —
// правленый руками сейв не должен закрывать задание, которого нет в игре.
function questsFromSaved(raw: unknown): QuestProgress {
  const progress: QuestProgress = { done: {}, counter: 0 }
  if (typeof raw !== 'object' || raw === null) return progress
  const saved = raw as { done?: unknown; counter?: unknown }
  const done =
    typeof saved.done === 'object' && saved.done !== null
      ? (saved.done as Record<string, unknown>)
      : {}
  for (const quest of QUEST_CHAIN.quests) {
    if (done[quest.id] === true) progress.done[quest.id] = true
  }
  if (typeof saved.counter === 'number' && Number.isFinite(saved.counter) && saved.counter > 0) {
    progress.counter = Math.floor(saved.counter)
  }
  return progress
}

// Забег по храму из сейва: чужой храм или мусорная волна — забега нет.
// Лучше выйти наружу, чем застрять в волне, которой не бывает.
function templeRunFromSaved(raw: unknown): TempleRun | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { templeId, wave, day, seed, level } = raw as Record<string, unknown>
  if (typeof templeId !== 'string' || !TEMPLE_BY_ID[templeId]) return null
  const int = (v: unknown, min: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : null
  const w = int(wave, 1)
  const d = int(day, 0)
  const sd = int(seed, 0)
  const lvl = int(level, 1)
  if (w === null || d === null || sd === null || lvl === null) return null
  return { templeId, wave: w, day: d, seed: sd, level: lvl }
}

// Забег из сейва: чужой данж или индекс за пределами цепочки — забега нет.
// Лучше выйти наружу, чем застрять перед несуществующим боссом.
function dungeonRunFromSaved(raw: unknown): DungeonRun | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { dungeonId, difficulty, bossIndex, fightMs } = raw as Record<string, unknown>
  if (typeof dungeonId !== 'string') return null
  // Мусорная сложность деградирует до обычной, а не выкидывает героя наружу:
  // потерять забег хуже, чем пройти его на ступень легче. Сейвы прошлых
  // версий поля не знают вовсе — и это ровно тот же случай.
  const mode: DungeonDifficulty = difficulty === 'heroic' ? 'heroic' : 'normal'
  const dungeon = dungeonView(dungeonId, mode)
  if (!dungeon) return null
  if (typeof bossIndex !== 'number' || !Number.isInteger(bossIndex)) return null
  if (bossIndex < 0 || bossIndex >= dungeon.bosses.length) return null
  return {
    dungeonId,
    difficulty: mode,
    bossIndex,
    fightMs: typeof fightMs === 'number' && Number.isFinite(fightMs) && fightMs > 0 ? fightMs : 0,
  }
}

// Ключи двух видов: голый id обычной версии (так лежат все старые сейвы) и
// '<id>:heroic'. Формат поля не менялся, значит и миграция ему не нужна.
function clearedFromSaved(raw: unknown): Record<string, boolean> {
  const cleared: Record<string, boolean> = {}
  if (typeof raw !== 'object' || raw === null) return cleared
  const saved = raw as Record<string, unknown>
  for (const dungeon of ALL_DUNGEONS) {
    const key = clearKey(dungeon.id, dungeon.difficulty)
    if (saved[key] === true) cleared[key] = true
  }
  return cleared
}

export function stateFromPayload(p: SavePayloadV20): GameState {
  const level = Decimal.max(parseDec(p.level, '1'), new Decimal(1))

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
    talents: talentsFromSaved(p.talents, hero.id),
    activePotions: potionsFromSaved(p.activePotions),
    // Мусор и отсутствие поля означают ноль, а не потерю сейва: v19 в этой
    // же ветке писался ещё без пыли, и такие сейвы обязаны читаться.
    enchantDust: parseDec(p.enchantDust, '0').floor(),
    procCooldownsMs: procCooldownsFromSaved(p.procCooldownsMs),
    // Сейв без saveId — из версии до храма: заводим новый, поток волн у него
    // всё равно ещё не начинался.
    saveId:
      typeof p.saveId === 'number' && Number.isFinite(p.saveId) ? p.saveId >>> 0 : randomSeed(),
    templeRun: templeRunFromSaved(p.templeRun),
    templeBestWave:
      typeof p.templeBestWave === 'number' && p.templeBestWave > 0
        ? Math.floor(p.templeBestWave)
        : 0,
    templeLastRunAtMs:
      typeof p.templeLastRunAtMs === 'number' && p.templeLastRunAtMs > 0
        ? Math.floor(p.templeLastRunAtMs)
        : 0,
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
    dungeonRun: dungeonRunFromSaved(p.dungeonRun),
    dungeonsCleared: clearedFromSaved(p.dungeonsCleared),
    questProgress: questsFromSaved(p.questProgress),
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
  // Статы — производные: после загрузки источников пересчитываем конвейером.
  // Считаем их ДО расформирования забега: выбор зоны для выхода смотрит на
  // прогноз, а прогноз без пересчитанных статов был бы прогнозом чужого героя.
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
  const loaded: GameState = {
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
  // Поток случайности берём от сида состояния — загрузка детерминированна.
  return resumeOutside(loaded, createRng(loaded.rngSeed))
}

/** Что за забег оборвался: код для UI, текст рендерит он же. */
export type InterruptedRun = 'dungeon' | 'temple'

/** Был ли в сейве незакрытый забег. Читается ДО загрузки — она его снимет. */
export function interruptedRunOf(p: SavePayloadV20): InterruptedRun | null {
  if (dungeonRunFromSaved(p.dungeonRun)) return 'dungeon'
  if (templeRunFromSaved(p.templeRun)) return 'temple'
  return null
}

/**
 * ЗАБЕГ НЕ ПЕРЕЖИВАЕТ ЗАГРУЗКУ СЕЙВА. Общее правило для всего закрытого
 * контента — данжа, храма и будущего рейда, — и держится оно здесь, в одной
 * точке, а не по ветке на каждую активность.
 *
 * Прерванный забег расформировывается: прогресс цепочки сброшен, лут за уже
 * убитых боссов остаётся, герой выходит наружу в подходящую по уровню зону
 * (offlineZone), и оффлайн начисляется ПО НЕЙ. Раньше закрытая внутри данжа
 * вкладка не приносила вообще ничего — наказание за невнимательность, а не
 * правило игры.
 *
 * Два свойства РАЗНЫЕ, и путать их нельзя: оффлайн начисляется, но сама
 * попытка НЕ продолжается и НЕ засчитывается — цепочку придётся начинать
 * заново. Иначе закрытая вкладка проходила бы данжи за игрока.
 *
 * Забега не было — просто спавним свежего моба зоны: моб в сейве не хранится.
 */
export function resumeOutside(state: GameState, rng: Rng): GameState {
  // Зона выхода считается ДО выхода: leave* берёт её из currentZoneId, и так
  // на весь выход приходится ровно один бросок спавна, а не два.
  if (state.dungeonRun) {
    return leaveDungeon({ ...state, currentZoneId: offlineZone(state).id }, rng, false)
  }
  if (state.templeRun) {
    return leaveTemple({ ...state, currentZoneId: offlineZone(state).id }, rng, false)
  }
  return { ...state, monster: spawnMonster(currentZone(state), rng) }
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

/**
 * Миграции сейва. КАЖДАЯ поднимает ровно на ОДНУ версию: цепочка гоняется в
 * цикле, и шаг через ступеньку молча пропускает всё, что лежало между ними.
 * Экспортируется ради теста, который это и стережёт, — однажды 14-я миграция
 * прыгнула сразу на 17 и лишила старых героев и класса, и мешка материалов.
 */
// Кривая опыта до v19: `40 * L^1.5`. Заморожена здесь навсегда — миграция
// обязана уметь прочитать сейв ТОЙ игры, а не текущей. Живая кривая теперь
// задаётся таблицей убийств (data/balance.ts) и с этой формулой не связана.
const LEGACY_V18_XP_BASE = 40
const LEGACY_V18_XP_EXPONENT = 1.5
function legacyXpToNext(level: number): number {
  return Math.floor(LEGACY_V18_XP_BASE * Math.pow(level, LEGACY_V18_XP_EXPONENT) * (1 + 1e-9))
}

/**
 * ХВАТ ПРЕДМЕТА ИЗ СЕЙВА 19-й ВЕРСИИ. Поля `grip` там нет: оружие несло
 * `hands: 1 | 2`, а щит не нёс ничего вовсе — и от брони отличался только
 * тем, что лежал во второй руке.
 *
 * Различаем по МОДИФИКАТОРАМ, а не по слоту: слот в правленом руками сейве
 * может быть любым, а базовая скорость оружия и базовый шанс блока — это то,
 * чем предмет ЯВЛЯЕТСЯ. Ровно поэтому щит, лежавший в главной руке, будет
 * опознан как щит и расформирован, а не тихо станет «одноручным».
 */
function gripV19toV20(raw: unknown): Grip | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const item = raw as RawSave
  const mods = Array.isArray(item.mods) ? (item.mods as RawSave[]) : []
  const hasBase = (stat: string) =>
    mods.some((m) => m?.stat === stat && m?.kind === 'base')
  if (hasBase('weaponSpeed')) return item.hands === 2 ? 'two' : 'one'
  if (hasBase('blockChance') || hasBase('blockValue')) return 'shield'
  return undefined
}

/** Цена продажи по сохранённым полям: до состояния игры ещё далеко. */
function savedSellPrice(raw: unknown): number {
  const item = (raw ?? {}) as RawSave
  const rarity = RARITY_BY_ID[item.rarity as Rarity] as RarityDef | undefined
  return ITEM_BASE_SELL_PRICE.times(rarity ? rarity.sellMult : 1).toNumber()
}

export const MIGRATIONS: Record<number, (raw: RawSave) => RawSave> = {
  // 19 -> 20: у предмета появился ХВАТ, и правила рук стали обязательными.
  //
  // Раньше «двуручность» жила отдельным полем hands, а щит не был отмечен
  // никак: он опознавался по слоту, в котором лежал. Незаконные связки такой
  // формат просто не описывал — и сейв мог их содержать. Здесь они и
  // расформировываются: двуручное вместе с занятой второй рукой, щит в
  // главной руке, двуручное во второй.
  //
  // Снятое уходит В СУМКУ. Не влезло — по действующему правилу вытеснения
  // уходит в золото самый дешёвый из претендентов. Полной мерой ценности
  // (`lootValue`) здесь воспользоваться нельзя: она считает темп боя, а
  // состояния игры до миграции ещё не существует, — поэтому берётся её же
  // тай-брейк, цена продажи.
  19: (raw) => {
    const withGrip = (item: unknown): unknown => {
      if (typeof item !== 'object' || item === null) return item
      const grip = gripV19toV20(item)
      const next = { ...(item as RawSave) }
      delete next.hands
      return grip ? { ...next, grip } : next
    }
    const inventory = (Array.isArray(raw.inventory) ? raw.inventory : []).map(withGrip)
    const equipment: Record<string, unknown> = {}
    const rawEquipment = (raw.equipment ?? {}) as Record<string, unknown>
    for (const slot of SLOT_IDS) equipment[slot] = withGrip(rawEquipment[slot] ?? null)

    // Расформирование. Каждое правило снимает РОВНО ОДИН предмет, и правила
    // не пересекаются: щит не бывает двуручным.
    const removed: unknown[] = []
    const gripOf = (item: unknown) =>
      item && typeof item === 'object' ? (item as RawSave).grip : undefined
    const drop = (slot: string) => {
      if (!equipment[slot]) return
      removed.push(equipment[slot])
      equipment[slot] = null
    }
    if (gripOf(equipment.mainHand) === 'shield') drop('mainHand')
    if (gripOf(equipment.offHand) === 'two') drop('offHand')
    if (gripOf(equipment.mainHand) === 'two') drop('offHand')

    let gold = new Decimal(String(raw.gold ?? '0'))
    for (const item of removed) {
      if (inventory.length < INVENTORY_SIZE) {
        inventory.push(item)
        continue
      }
      // Сумка полна: самый дешёвый из сумки и снятого уходит в золото.
      let worstIndex = -1
      let worstPrice = savedSellPrice(item)
      inventory.forEach((candidate, index) => {
        const price = savedSellPrice(candidate)
        if (price < worstPrice) {
          worstPrice = price
          worstIndex = index
        }
      })
      if (worstIndex === -1) {
        gold = gold.plus(savedSellPrice(item))
        continue
      }
      gold = gold.plus(savedSellPrice(inventory[worstIndex]))
      inventory[worstIndex] = item
    }
    return { ...raw, version: 20, gold: gold.toString(), inventory, equipment }
  },
  // 18 -> 19: игра стала КОНЕЧНОЙ. Появился потолок сотого уровня, кривая
  // опыта переехала с формулы на таблицу убийств, а автонадевание снесено —
  // предметы надевает игрок.
  //
  // Уровень и опыт пересчитываются так, чтобы сохранилась ДОЛЯ пройденного
  // уровня: полоска после обновления стоит там же, где стояла. Абсолютное
  // число опыта переносить нельзя — оно считалось по другой кривой и на
  // новой значило бы другое место на полоске.
  18: (raw) => {
    const next: RawSave = { ...raw, version: 19 }
    delete next.autoEquip
    const rawLevel = Number(raw.level)
    const level = Number.isFinite(rawLevel) ? Math.max(1, Math.floor(rawLevel)) : 1
    const capped = Math.min(level, LEVEL_CAP)
    const oldNeed = legacyXpToNext(level)
    const rawXp = Number(raw.currentXp)
    const share = oldNeed > 0 && Number.isFinite(rawXp) ? Math.min(1, Math.max(0, rawXp / oldNeed)) : 0
    const newNeed = xpToNextLevel(new Decimal(capped))
    next.level = String(capped)
    // На потолке копить нечего: опыт обнуляется вместе с полоской.
    next.currentXp = capped >= LEVEL_CAP ? '0' : newNeed.times(share).floor().toString()
    // Дерево переехало на класс и на глубину в 61 очко. Ранги переносим
    // картой соответствия, непереносимое возвращается свободными очками —
    // прогресс не теряется ни на очко.
    const classId = typeof raw.classId === 'string' ? raw.classId : DEFAULT_CLASS.id
    next.talents = talentsV18toV19(raw.talents, classId)
    return next
  },
  // 16 -> 17: появились профессии. Мешок материалов у старого героя пуст —
  // собирать он начнёт с ближайшего убитого моба. Прогресс не затронут.
  // 17 -> 18: заточка снесена, у предметов появился уровень. Прогресс героя
  // НЕ теряется, хотя счётчик покупок исчезает: сила переезжает в вещи —
  // каждый предмет получает уровень мобов зоны, где герой фармит, а его
  // ЧИСЛА домножаются на масштаб этого уровня, ровно как у тамошней находки.
  // Голый ярлык уровня без домножения оставил бы ветерана со старыми слабыми
  // вещами и без заточки — то есть ограбил бы его.
  //
  // Домножается то же, что растёт у честного дропа: base-урон и сила блока,
  // плюс любые плоские прибавки. Скорости, шансы и проценты не трогаются.
  17: (raw) => {
    const zone = ZONE_BY_ID[String(raw.currentZoneId)]
    const heroLevel = Number(raw.level)
    const fallback = Number.isFinite(heroLevel) ? Math.max(1, Math.floor(heroLevel)) : 1
    const itemLevel = zone
      ? Math.round((zone.monsterLevelRange.min + zone.monsterLevelRange.max) / 2)
      : fallback
    const scale = itemLevelScale(itemLevel)
    const SCALED_BASE = new Set([
      'weaponDamageMin',
      'weaponDamageMax',
      'offhandDamageMin',
      'offhandDamageMax',
      'blockValue',
    ])
    const scaleMod = (mod: unknown): unknown => {
      if (typeof mod !== 'object' || mod === null) return mod
      const m = mod as { kind?: unknown; stat?: unknown; value?: unknown }
      const grows =
        m.kind === 'flat' || (m.kind === 'base' && SCALED_BASE.has(String(m.stat)))
      if (!grows) return mod
      return { ...m, value: parseDec(m.value, '0').times(scale).toString() }
    }
    const withLevel = (item: unknown): unknown => {
      if (typeof item !== 'object' || item === null) return item
      const it = item as { mods?: unknown }
      return {
        ...it,
        level: itemLevel,
        mods: Array.isArray(it.mods) ? it.mods.map(scaleMod) : it.mods,
      }
    }
    const equipment =
      typeof raw.equipment === 'object' && raw.equipment !== null
        ? Object.fromEntries(
            Object.entries(raw.equipment).map(([slot, item]) => [slot, withLevel(item)]),
          )
        : raw.equipment
    const { upgrades: _upgrades, ...rest } = raw
    return {
      ...rest,
      version: 18,
      inventory: Array.isArray(raw.inventory) ? raw.inventory.map(withLevel) : [],
      equipment,
    }
  },
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
      version: 15,
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
export function migrateSave(raw: unknown): SavePayloadV20 | null {
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
  return data as unknown as SavePayloadV20
}

export interface OfflineReport {
  elapsedMs: number
  kills: Decimal
  gold: Decimal
  xp: Decimal
  /** Зона, по которой считался оффлайн. Название подставляет UI. */
  zoneId: string
  /** Забег оборвался закрытой вкладкой и расформирован; null — забега не было. */
  interrupted: InterruptedRun | null
  /** Добыча: что выпало, что осталось, что ушло в золото. */
  loot: OfflineLoot
}

/**
 * Итог добычи за оффлайн. Числа, а не список предметов: за восемь часов
 * находок бывают сотни, и вываливать их модалкой некуда — сумка и так
 * покажет всё, что в ней осталось.
 */
export interface OfflineLoot {
  /** Сколько предметов выпало всего. */
  found: number
  /** Сколько из них легло в сумку (остальное ушло в золото). */
  kept: number
  /** Сколько найденного лучше надетого. */
  upgrades: number
  /** Прирост лучшей находки долей (0.074 — «+7.4%»); 0 — апгрейдов нет. */
  bestGain: number
  /** Сколько находок ушло в золото и на сколько. */
  sold: number
  soldGold: Decimal
  /** Сколько чего выпало по редкости — модалка красит иконки этим. */
  byRarity: Record<Rarity, number>
}

const emptyLoot = (): OfflineLoot => ({
  found: 0,
  kept: 0,
  upgrades: 0,
  bestGain: 0,
  sold: 0,
  soldGold: new Decimal(0),
  byRarity: { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 },
})

// Оффлайн-прогресс одним агрегатом, без проигрывания тиков. Темп боя берётся
// из zoneRate, а тот зовёт estimateCombatRate — ту же функцию, что и онлайн,
// чтобы формула боя не жила в двух местах.
export function applyOfflineProgress(
  state: GameState,
  elapsedMs: number,
  // Поток случайности лута. Свой, а не общий с симуляцией: оффлайн считается
  // при загрузке, и вычерпывать из него ход игры нельзя. Сид — из состояния,
  // поэтому загрузка остаётся детерминированной.
  rng: Rng = createRng(state.rngSeed ^ OFFLINE_LOOT_SALT),
): { state: GameState; report: OfflineReport | null } {
  let cappedMs = Math.min(elapsedMs, OFFLINE_CAP_MS)
  if (cappedMs <= 0) return { state, report: null }
  // Активного забега здесь уже быть не может: его снимает resumeOutside при
  // загрузке сейва. Проверка оставлена сторожем для прямых вызовов — считать
  // оффлайн по боссу нельзя, цепочка сама себя не проходит.
  if (state.dungeonRun || state.templeRun) return { state, report: null }
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
  // ЛУТ. Своей модели дропа у оффлайна нет: внутри шага по числу убийств
  // крутится ТА ЖЕ rollLoot и ТА ЖЕ stashLoot, что и в тике. Отдельного
  // коэффициента у лута тоже нет — число убийств уже урезано на
  // OFFLINE_EFFICIENCY, и лут наследует это сам.
  //
  // Уровень находки берётся по СРЕДНЕМУ мобу зоны: весь агрегат усреднён по
  // пулу, и брать сюда уровень одного случайного моба значило бы смешать две
  // разные модели.
  const loot = emptyLoot()
  const itemLevel = Math.round(averageMonsterLevel(zone))
  // Дробные убийства копятся между шагами: бросков ровно столько, сколько
  // целых убийств, и итог сходится с числом в отчёте.
  let killDebt = 0
  // Кеш ценности живёт РОВНО СТОЛЬКО, сколько неизменны статы, а не один шаг.
  // Шагов за восемь часов четыреста восемьдесят, и кеш на шаг означал бы
  // переоценку всей сумки в каждом — двадцать четыре прогона конвейера и
  // estimateCombatRate на первую же находку. Замер: 947 мс против 176 мс.
  let cache: LootValueCache = new Map()
  // Лог оффлайн не пишет — ни здесь, ни в склянках. Сотня находок вытеснила
  // бы из лога весь бой, к которому игрок возвращается.
  const logBefore = s.combatLog
  for (let left = cappedMs; left > 0; left -= OFFLINE_CHUNK_MS) {
    const seconds = new Decimal(Math.min(OFFLINE_CHUNK_MS, left)).div(1000)
    if (!rateLevel.eq(s.level)) {
      rate = zoneRate(s, zone, 'auto')
      rateLevel = s.level
    }
    const chunkXp = rate.xpPerSecond.times(seconds).times(OFFLINE_EFFICIENCY)
    const chunkKills = rate.killsPerSecond.times(seconds).times(OFFLINE_EFFICIENCY)
    kills = kills.plus(chunkKills)
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
    if (s.statsDirty) {
      s = ensureStats(s)
      // Статы поехали — прежние оценки больше не про этого героя.
      cache = new Map()
    }
    killDebt += chunkKills.toNumber()
    const rolls = Math.floor(killDebt)
    killDebt -= rolls
    for (let i = 0; i < rolls; i += 1) {
      const item = rollLoot(rng, s.itemSeq, itemLevel)
      if (!item) continue
      loot.found += 1
      loot.byRarity[item.rarity] += 1
      const value = lootValue(s, item, cache)
      if (isUpgradeValue(value)) {
        loot.upgrades += 1
        // Бесконечность бывает, когда без предмета герой не убивает вовсе;
        // как «прирост в процентах» её показывать нечем.
        if (Number.isFinite(value)) loot.bestGain = Math.max(loot.bestGain, value - 1)
      }
      s = stashLoot({ ...s, itemSeq: s.itemSeq + 1 }, item, cache)
      // Что именно сделала политика сумки — видно по событию, которое она
      // положила в лог. Своей копии правил здесь нет.
      const event = s.combatLog[0]
      if (event?.type === 'autosell') {
        loot.sold += 1
        loot.soldGold = loot.soldGold.plus(event.gold)
      } else if (event?.type === 'loot-swap') {
        loot.kept += 1
        loot.sold += 1
        loot.soldGold = loot.soldGold.plus(event.gold)
        // Вытесненный предмет исчез из сумки — его оценка больше не нужна.
        cache.delete(event.dropped.id)
      } else {
        loot.kept += 1
      }
    }
  }
  s = { ...s, combatLog: logBefore }
  // Травы набегают ВРЕМЕНЕМ, поэтому оффлайн срезает их одним вызовом, тем
  // же куском игрового времени и с тем же урезанием. Отдельной модели у сбора
  // нет — иначе оффлайн и онлайн разошлись бы молча.
  s = gatherHerbs(s, cappedMs * OFFLINE_EFFICIENCY)
  // Склянки ДОЖИГАЮТСЯ полным временем, без урезания: придержать зелье,
  // закрыв вкладку, нельзя. Событий в лог оффлайн не пишет.
  s = advancePotions(s, cappedMs, false)
  // Дробные убийства копим по шагам и округляем один раз, в самом конце.
  kills = kills.floor()
  if (kills.lte(0)) return { state: s, report: null }
  return {
    // Золото автопродажи уже лежит в s.gold: его туда положила stashLoot.
    // Здесь прибавляется только заработок за убийства.
    state: { ...s, gold: s.gold.plus(gold) },
    report: { elapsedMs: cappedMs, kills, gold, xp, zoneId: zone.id, interrupted: null, loot },
  }
}

export function saveGame(state: GameState, deps: SaveDeps = {}): void {
  const storage = deps.storage ?? defaultStorage()
  const now = deps.now ?? Date.now
  storage.setItem(SAVE_KEY, JSON.stringify(payloadFromState(state, now())))
}

/**
 * Стирает сейв. Именно СТИРАЕТ, а не перезаписывает пустым: перезаписанный
 * сейв — это по-прежнему сейв, и следующая загрузка сочтёт игру начатой.
 * Для «начать заново» разница принципиальная — с ней возвращается выбор
 * класса, без неё игрок молча остаётся тем, кем был.
 */
export function clearSave(deps: SaveDeps = {}): void {
  const storage = deps.storage ?? defaultStorage()
  storage.removeItem(SAVE_KEY)
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

  // Читаем ДО загрузки: она расформирует забег, и по состоянию его уже не видно.
  const interrupted = interruptedRunOf(payload)
  let state = stateFromPayload(payload)
  // Отрицательная разница (часы перевели назад) — ничего не начисляем;
  // lastTimestamp обновится ближайшим сохранением.
  const elapsedMs = now() - payload.lastTimestamp
  let offline: OfflineReport | null = null
  if (elapsedMs > 0) ({ state, report: offline } = applyOfflineProgress(state, elapsedMs))
  // Про оборванный забег модалка обязана сказать вслух: молча пропавшая
  // цепочка боссов читается как потеря прогресса, а не как правило.
  if (offline) offline = { ...offline, interrupted }
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
export function decodeSaveString(input: string): SavePayloadV20 | null {
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
