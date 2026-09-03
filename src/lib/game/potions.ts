
// ============================================================================
// Травничество: сбор трав временем, зелья, их отсчёт и место в модели боя.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Зелье — единственная сила в игре, которую нельзя
// автоматизировать. Из этого берётся весь разрыв между ручной игрой и героем,
// предоставленным самому себе, поэтому правило «зелья входят в модель
// 'manual' и не входят ни в 'auto', ни в оффлайн» живёт ЗДЕСЬ, в одном
// месте, а не растекается по combat.ts и save.ts.
//
// Текста для игрока здесь нет: наружу идут коды причин и числа.
import { Decimal } from './numbers'
import { herbsInZone } from '../data/herbs'
import {
  POTION_RECIPES,
  POTION_RECIPE_BY_OUTPUT,
  POTION_SOURCE_PREFIX,
  potionModifiers,
  type PotionRecipe,
} from '../data/recipes'
import {
  POTION_REFRESH_SHARE,
  POTION_TARGET_UPTIME,
  POTION_UNLOCK_LEVEL,
} from '../data/balance'
import { applyModifiers, collectModifiers, ensureStats, type StatBlock } from './stats'
import { pushEvent, type ActivePotion, type GameState } from './state'

// ---------------------------------------------------------------------------
// Сбор трав
// ---------------------------------------------------------------------------

/**
 * Сбор трав за отрезок игрового времени.
 *
 * Травы набегают ВРЕМЕНЕМ, а не с убитого моба: это ресурс МЕСТА. Поэтому
 * функция не смотрит ни на убийство, ни на бой — и, что важнее, не берёт
 * НИ ОДНОГО броска из rng: воспроизводимость прогонов с сидом не задета,
 * и golden от появления травничества не шевелится.
 *
 * Остаток пучка копится долей в `herbProgress` — так же, как прогресс замаха
 * копится долей: на медленном шаге ничего не теряется, а на жирном (возврат
 * из оффлайна одним куском) всё приходит целиком.
 */
export function gatherHerbs(state: GameState, dtMs: number): GameState {
  if (dtMs <= 0) return state
  // ТРАВНИЧЕСТВО ОТКРЫВАЕТСЯ ЦЕЛИКОМ И СРАЗУ. Порог тот же, что у зелий:
  // собирать то, что некуда деть, — это счётчик, который растёт и ничего не
  // обещает. Трава и растёт только с зон этого уровня (data/herbs.ts), но
  // правило стоит и здесь: зону выбирает игрок, и герой тридцатого уровня,
  // забредший в сорок первую, травником от этого не становится.
  if (state.level.lt(POTION_UNLOCK_LEVEL)) return state
  // Мёртвый не собирает, и в данже трав нет: там подземелье, а не поляна.
  if (state.heroState === 'dead' || state.dungeonRun) return state
  const growing = herbsInZone(state.currentZoneId)
  if (growing.length === 0) return state
  const minutes = dtMs / 60_000
  const herbProgress: Record<string, number> = { ...state.herbProgress }
  let materials = state.materials
  for (const herb of growing) {
    const progress = (herbProgress[herb.id] ?? 0) + herb.perMinute * minutes
    const bundles = Math.floor(progress)
    herbProgress[herb.id] = progress - bundles
    if (bundles > 0) {
      materials = {
        ...materials,
        [herb.id]: (materials[herb.id] ?? new Decimal(0)).plus(bundles),
      }
    }
  }
  // В боевой лог сбор НЕ пишется намеренно: это фон, а не событие. Лента боя
  // не должна шуршать травой, вытесняя из восьми строк удары и находки.
  return { ...state, materials, herbProgress }
}

// ---------------------------------------------------------------------------
// Склянки: состояние кнопки
// ---------------------------------------------------------------------------

/** Сколько склянок этого зелья лежит в мешке. */
export function potionCount(state: GameState, outputId: string): Decimal {
  return state.materials[outputId] ?? new Decimal(0)
}

/** Действующее зелье этого рецепта; null — не действует. */
export function activePotion(state: GameState, recipeId: string): ActivePotion | null {
  return state.activePotions.find((p) => p.recipeId === recipeId) ?? null
}

/** Доля оставшейся длительности, 0..1 — по ней UI рисует заливку кнопки. */
export function potionFraction(recipe: PotionRecipe, potion: ActivePotion | null): number {
  const total = recipe.output.durationSec * 1000
  if (!potion || total <= 0) return 0
  return Math.min(1, Math.max(0, potion.msLeft / total))
}

/** Почему склянку не выпить. Каждый случай — свой код, текст рендерит UI. */
export type PotionBlockReason = 'locked' | 'dead' | 'empty' | 'active'

export interface PotionSlot {
  recipe: PotionRecipe
  /** Склянок в мешке. Мешок весь в Decimal — и склянки тоже. */
  count: Decimal
  usable: boolean
  active: boolean
  msLeft: number
  fraction: number
  reason: PotionBlockReason | null
}

/**
 * Состояние одной склянки. Порядок проверок фиксирован — от него зависит,
 * какую причину увидит игрок: сперва то, что не лечится ожиданием.
 */
export function potionStatus(state: GameState, recipe: PotionRecipe): PotionSlot {
  const potion = activePotion(state, recipe.id)
  const base = {
    recipe,
    count: potionCount(state, recipe.output.id),
    active: potion !== null,
    msLeft: potion?.msLeft ?? 0,
    fraction: potionFraction(recipe, potion),
  }
  const blocked = (reason: PotionBlockReason): PotionSlot => ({ ...base, usable: false, reason })
  if (state.level.lt(POTION_UNLOCK_LEVEL)) return blocked('locked')
  if (state.heroState === 'dead') return blocked('dead')
  // Обновлять зелье можно, но только под конец действия: без окна одно лишнее
  // нажатие сжигало бы склянку за секунды, а без обновления вовсе аптайм
  // упирался бы в реакцию игрока, а не в его решение.
  if (potion && potion.msLeft > recipe.output.durationSec * 1000 * POTION_REFRESH_SHARE) {
    return blocked('active')
  }
  if (base.count.lt(1)) return blocked('empty')
  return { ...base, usable: true, reason: null }
}

/**
 * Что показать в ряду действий.
 *
 * До уровня открытия ряд НЕ трогаем вовсе: три мёртвые кнопки с замком у
 * героя, которому до них тридцать уровней, — это не подсказка, а мусор.
 * Как только зелья открылись (или склянка каким-то путём уже в мешке),
 * слоты появляются все и стоят на своих местах постоянно: кнопка, которая
 * прыгает по ряду, стоит игроку промаха.
 */
export function potionSlots(state: GameState): PotionSlot[] {
  const unlocked = state.level.gte(POTION_UNLOCK_LEVEL)
  return POTION_RECIPES.map((recipe) => potionStatus(state, recipe)).filter(
    (slot) => unlocked || slot.active || slot.count.gt(0),
  )
}

// ---------------------------------------------------------------------------
// Глоток и отсчёт
// ---------------------------------------------------------------------------

/**
 * Выпить зелье. ТОЛЬКО руками и только онлайн: ни автокаст, ни оффлайн сюда
 * не заглядывают — в этом весь смысл зелий. Недоступная склянка состояние не
 * меняет вовсе; причину показывает potionStatus, текст рендерит UI.
 */
export function drinkPotion(state: GameState, outputId: string): GameState {
  const recipe = POTION_RECIPE_BY_OUTPUT[outputId]
  if (!recipe) return state
  if (!potionStatus(state, recipe).usable) return state
  // Повторный глоток ОБНОВЛЯЕТ отсчёт, а не кладёт второе такое же зелье:
  // складывать длительность значило бы копить её впрок и превращать
  // травничество в кладовку.
  const activePotions: ActivePotion[] = [
    ...state.activePotions.filter((p) => p.recipeId !== recipe.id),
    { recipeId: recipe.id, msLeft: recipe.output.durationSec * 1000 },
  ]
  return ensureStats({
    ...state,
    materials: { ...state.materials, [outputId]: potionCount(state, outputId).minus(1) },
    activePotions,
    // Зелье — источник статов: пересчитываем сразу, иначе первый удар после
    // глотка прошёл бы по старым числам.
    statsDirty: true,
    combatLog: pushEvent(state.combatLog, { type: 'potion', recipeId: recipe.id }),
  })
}

/**
 * Отсчёт длительностей. Идёт ИГРОВЫМ временем — тем же dtMs, что кулдауны:
 * множитель скорости из отладочной панели ускоряет и его.
 *
 * `log` — писать ли в ленту. Онлайн окончание зелья это событие: игрок обязан
 * узнать, что бьёт уже слабее. В оффлайне склянка выдыхается молча.
 */
export function advancePotions(state: GameState, dtMs: number, log = true): GameState {
  if (state.activePotions.length === 0) return state
  const kept: ActivePotion[] = []
  const expired: string[] = []
  for (const potion of state.activePotions) {
    const msLeft = potion.msLeft - dtMs
    if (msLeft > 0) kept.push({ ...potion, msLeft })
    else expired.push(potion.recipeId)
  }
  if (expired.length === 0) return { ...state, activePotions: kept }
  let combatLog = state.combatLog
  if (log) {
    for (const recipeId of expired) {
      combatLog = pushEvent(combatLog, { type: 'potion-expired', recipeId })
    }
  }
  // Снятое зелье — тот же источник статов: пересчитываем сразу, чтобы
  // истёкшая склянка не била ещё один тик по старым числам.
  return ensureStats({ ...state, activePotions: kept, combatLog, statsDirty: true })
}

// ---------------------------------------------------------------------------
// Зелья и модель боя
// ---------------------------------------------------------------------------

/**
 * Кеш «статов без зелий» по объекту StatBlock, а не по состоянию.
 *
 * Оценка зон клонирует состояние на КАЖДОГО моба пула (facing()), но конвейер
 * при этом не пересчитывается, и все клоны делят один и тот же объект статов —
 * а значит и один и тот же набор модификаторов. Без кеша прогноз мира гонял
 * бы applyModifiers шестьсот раз подряд.
 */
const POTION_FREE_STATS = new WeakMap<StatBlock, StatBlock>()

function potionFreeModifiers(state: GameState) {
  return collectModifiers(state).filter((m) => !m.source.startsWith(POTION_SOURCE_PREFIX))
}

/**
 * Статы БЕЗ зелий: то, что герой выдаёт, когда его никто не поит.
 *
 * По ним считается режим 'auto', а значит и оффлайн. Вычищать зелья надо
 * именно ЗДЕСЬ, а не «просто не добавлять»: если игрок выпил склянку и закрыл
 * вкладку, её прибавка сидит в state.stats — и без этой чистки уехала бы
 * в оффлайн-агрегат, сломав правило «оффлайн <= автокаст <= ручная игра».
 */
export function statsWithoutPotions(state: GameState): StatBlock {
  if (state.activePotions.length === 0) return state.stats
  const cached = POTION_FREE_STATS.get(state.stats)
  if (cached) return cached
  const clean = applyModifiers(potionFreeModifiers(state))
  POTION_FREE_STATS.set(state.stats, clean)
  return clean
}

/**
 * Какое зелье модель ручной игры считает выпитым.
 *
 * Выбор ДАННЫМИ, а не веткой по id: берётся первый по порядку рецепт
 * травничества, все травы которого растут в ТЕКУЩЕЙ зоне. Отсюда же и
 * контракт снабжения: «запаса трав с подходящей по уровню зоны хватает».
 * Сунулся в зону, где нужное не растёт, — модель зелья не считает, и это
 * честно: варить их там не из чего.
 */
export function plannedPotion(state: GameState): PotionRecipe | null {
  if (state.level.lt(POTION_UNLOCK_LEVEL)) return null
  const growing = new Set(herbsInZone(state.currentZoneId).map((h) => h.id))
  return POTION_RECIPES.find((r) => r.inputs.every((i) => growing.has(i.materialId))) ?? null
}

/**
 * Статы модели РУЧНОЙ игры: без зелий плюс приоритетное зелье, урезанное
 * целевым аптаймом. Урезание линейное — это среднее стата по времени.
 *
 * Берётся ПЛАНОВОЕ зелье, а не то, что действует прямо сейчас: оценка — это
 * прогноз «что выйдет, если играть руками», и он не должен мигать от того,
 * успел игрок отпить секунду назад или нет.
 */
export function statsWithPotionPlan(state: GameState): StatBlock {
  const recipe = plannedPotion(state)
  if (!recipe) return statsWithoutPotions(state)
  return applyModifiers([
    ...potionFreeModifiers(state),
    ...potionModifiers([{ recipeId: recipe.id }], POTION_TARGET_UPTIME),
  ])
}

// ---------------------------------------------------------------------------
// Снабжение: потянет ли зона обещанный аптайм
// ---------------------------------------------------------------------------

export interface PotionSupply {
  recipeId: string
  /** Пучков в минуту, которых требует целевой аптайм. */
  needPerMinute: Record<string, number>
  /** Пучков в минуту, которые даёт зона. */
  gotPerMinute: Record<string, number>
  /** Во сколько раз снабжение перекрывает нужду. 1 и выше — потянет. */
  share: number
}

/**
 * Сходится ли снабжение зельем в этой зоне. Числа наружу, вердикт — на
 * совести вызывающего (тест баланса и панель ремёсел). Своей «оценки
 * достаточности» логика не выносит: это данные, а не мнение.
 */
export function potionSupply(
  state: GameState,
  recipe: PotionRecipe,
  zoneId: string = state.currentZoneId,
): PotionSupply {
  // Склянок в минуту, чтобы зелье действовало POTION_TARGET_UPTIME времени.
  const potionsPerMinute = (60 / recipe.output.durationSec) * POTION_TARGET_UPTIME
  const gotPerMinute: Record<string, number> = {}
  for (const herb of herbsInZone(zoneId)) gotPerMinute[herb.id] = herb.perMinute
  const needPerMinute: Record<string, number> = {}
  let share = Number.POSITIVE_INFINITY
  for (const input of recipe.inputs) {
    const need = potionsPerMinute * input.count
    needPerMinute[input.materialId] = need
    share = Math.min(share, need > 0 ? (gotPerMinute[input.materialId] ?? 0) / need : share)
  }
  return { recipeId: recipe.id, needPerMinute, gotPerMinute, share }
}


