// Профессии: материалы, рецепты, крафт. Чистые операции над состоянием.
//
// Уровней у профессий нет: рецепт либо собирается из того, что есть, либо
// нет. Отказ — отдельный КОД, текст причины рендерит UI (правило проекта).
import { Decimal } from './numbers'
import { craftToll, recipeUnlockLevel } from '../data/recipes'
import { masteryOf, recipeKnown } from './recipeBook'
import { recipeUnlocked } from '../data/temple'
import {
  FOOD_BY_ID,
  RECIPE_BY_ID,
  type ItemOutput,
  type RecipeDef,
} from '../data/recipes'
import { RARITY_BY_ID } from '../data/rarity'
import { ARMOR_NOUNS, SHIELD_BY_ID, WEAPON_BY_ID } from '../data/items'
import { MATERIAL_DROP_CHANCE, REAGENT_DROP_CHANCE } from '../data/balance'
import { zoneBand } from '../data/zones'
import { inventorySize } from './upgrades'
import { REAGENT_BY_ID, commonReagentsInBand, type ReagentDef } from '../data/reagents'
import {
  MASTERY_MAX,
  MASTERY_PER_CRAFT,
  hasMastery,
  masteryCeilingForLevel,
} from '../data/mastery'
import { recipeLevel } from '../data/recipes'
import type { DungeonDef } from '../data/dungeons'
import { armorMods, shieldMods, weaponMods } from './loot'
import { pushEvent, type GameState } from './state'
import type { Rng } from './rng'
import { advanceQuests } from './quests'
import type { CombatEvent, Item } from '../types'

/** Сколько единиц материала у героя. Отсутствие — ноль, а не undefined. */
export function materialCount(state: GameState, id: string): Decimal {
  return state.materials[id] ?? new Decimal(0)
}

/**
 * Бросок реагента с убитого моба. Пул СВОЙ, отдельный от лута: реагенты не
 * занимают слот в сумке и не сдвигают шансы редкости предметов.
 *
 * ПУЛ БЕРЁТСЯ ПО ПОЛОСЕ, А НЕ ПО СПИСКУ ЗОН. Раньше у каждого материала был
 * свой рукописный список зон, и списки расползались через всю карту: руда
 * падала с шестого уровня по восьмидесятый, соль — в четырёх зонах врозь.
 * Теперь у реагента ровно одна полоса (`data/reagents.ts`), а зона знает свою
 * полосу по уровню мобов — списков не осталось вовсе.
 *
 * Порядок бросков фиксирован: шанс -> реагент из пула полосы. Веса
 * сравниваются ТОЛЬКО внутри полосы, поэтому «частый» и «редкий» значат одно
 * и то же на любой глубине.
 */
export function rollZoneReagent(zoneId: string, rng: Rng): ReagentDef | null {
  if (rng() >= MATERIAL_DROP_CHANCE) return null
  const band = zoneBand(zoneId)
  if (!band) return null
  const pool = commonReagentsInBand(band)
  if (pool.length === 0) return null
  const total = pool.reduce((sum, m) => sum + (m.weight ?? 0), 0)
  let roll = rng() * total
  for (const reagent of pool) {
    roll -= reagent.weight ?? 0
    if (roll < 0) return reagent
  }
  return pool[pool.length - 1]
}

export function addMaterial(state: GameState, id: string, count = 1): GameState {
  return {
    ...state,
    materials: { ...state.materials, [id]: materialCount(state, id).plus(count) },
  }
}

/** Почему рецепт не собрать. null — собирается. */
export type CraftBlockReason =
  | 'level'
  | 'unknown'
  | 'locked'
  | 'materials'
  | 'gold'
  | 'inventory-full'

export interface RecipeStatus {
  recipe: RecipeDef
  canCraft: boolean
  reason: CraftBlockReason | null
  /** Чего и сколько не хватает. Пусто — материалов достаточно. */
  missing: Array<{ materialId: string; need: number; have: Decimal }>
  /** Пошлина золотом: сколько стоит нажать «сделать». Считает data/recipes.ts. */
  toll: Decimal
  /** Сколько золота не хватает до пошлины. Ноль — хватает. */
  tollShort: Decimal
}

export function recipeStatus(state: GameState, recipe: RecipeDef): RecipeStatus {
  const missing = recipe.inputs
    .map((input) => ({
      materialId: input.materialId,
      need: input.count,
      have: materialCount(state, input.materialId),
    }))
    .filter((row) => row.have.lt(row.need))
  const toll = craftToll(recipe)
  const tollShort = Decimal.max(toll.minus(state.gold), new Decimal(0))
  const blocked = (reason: CraftBlockReason, rows = missing): RecipeStatus => ({
    recipe,
    canCraft: false,
    reason,
    missing: rows,
    toll,
    tollShort,
  })
  // Уровень — первым: эта причина не лечится ни материалами, ни местом в сумке.
  if (state.level.lt(recipeUnlockLevel(recipe))) return blocked('level')
  // ЗНАНИЕ — ВТОРЫМ, и это не то же самое, что уровень. «Не знаю рецепта»
  // лечится походом за ним, а не ожиданием: игра обязана назвать причину до
  // нажатия, а не после. Слово подставляет UI по источнику из данных.
  if (!recipeKnown(state, recipe)) return blocked('unknown', [])
  // Рецепт-награда храма заперт, пока рекорд по волнам не дорос до рубежа.
  // Правило живёт в данных (recipeUnlocked): списка «выданных наград» в
  // состоянии нет, открывает их сам рекорд.
  if (!recipeUnlocked(recipe.id, state.templeBestWave, state.templeCleared)) {
    return blocked('locked', [])
  }
  if (missing.length > 0) return blocked('materials')
  // ЗОЛОТО ПОСЛЕ МАТЕРИАЛОВ и до места в сумке. Порядок не случаен: материалы
  // копятся сами, пока герой в зоне, а золото игрок тратит и на другое —
  // «не хватает золота» это решение, а не ожидание, и показывать его надо
  // тогда, когда всё остальное уже есть.
  if (tollShort.gt(0)) return blocked('gold')
  // Предмет должен куда-то лечь; еда места не занимает.
  if (recipe.output.kind === 'item' && state.inventory.length >= inventorySize(state)) {
    return blocked('inventory-full')
  }
  return { recipe, canCraft: true, reason: null, missing, toll, tollShort }
}

/** Предмет из рецепта. Модификаторы строят ТЕ ЖЕ функции, что и для лута. */
export function craftedItem(output: ItemOutput, seq: number): Item | null {
  const rarity = RARITY_BY_ID[output.rarity]
  const id = `craft-${seq}`
  // Прок — ссылка, а не копия чисел: см. комментарий у Item.procId.
  const proc = output.procId ? { procId: output.procId } : {}
  // У уникальной вещи имя СОБСТВЕННОЕ, а не «Кованый X»: её планируют заранее
  // и знают по имени.
  const named = (fallbackNoun: string) =>
    output.name ?? `${output.adjective ?? ''} ${fallbackNoun}`.trim()
  if (output.slot === 'mainHand' || output.slot === 'offHand') {
    if (output.templateId && SHIELD_BY_ID[output.templateId]) {
      const template = SHIELD_BY_ID[output.templateId]
      return {
        id,
        name: named(template.noun),
        rarity: rarity.id,
        slot: output.slot,
        level: output.level,
        grip: template.grip,
        mods: shieldMods(template, rarity, output.level),
        ...proc,
      }
    }
    const template = output.templateId ? WEAPON_BY_ID[output.templateId] : undefined
    if (!template) return null
    return {
      id,
      name: named(template.noun),
      rarity: rarity.id,
      slot: output.slot,
      level: output.level,
      grip: template.grip,
      mods: weaponMods(template, rarity, output.slot, output.level),
      ...proc,
    }
  }
  // Атрибут кованой брони обязан быть назван в рецепте — это держит
  // content:check; без него рецепт не собирается, а не куёт что-то молча.
  if (!output.attribute) return null
  const nouns = ARMOR_NOUNS[output.slot]
  return {
    id,
    name: named(nouns[0]),
    rarity: rarity.id,
    slot: output.slot,
    level: output.level,
    mods: armorMods(output.slot, rarity, output.level, output.attribute),
    ...proc,
  }
}

/**
 * Реагент с убитого босса.
 *
 * ПОСЛЕДНИЙ босс цепочки роняет его ВСЕГДА — это и есть награда за то, что
 * цепочку прошли целиком, а не бросили на середине. Остальные — с шансом.
 * Для гарантии бросок НЕ делается вовсе: у неё нет случайности, а лишний
 * вызов rng сдвинул бы поток и сломал воспроизводимость прогонов.
 */
export function rollBossReagent(
  dungeon: DungeonDef,
  bossIndex: number,
  rng: Rng,
): ReagentDef | null {
  const reagent = REAGENT_BY_ID[dungeon.reagentId]
  if (!reagent) return null
  const last = bossIndex >= dungeon.bosses.length - 1
  if (!last && rng() >= REAGENT_DROP_CHANCE) return null
  return reagent
}

/** Собрать рецепт. Нельзя — состояние не меняется вовсе. */
/**
 * Сколько мастерства даст ЭТОТ крафт: полную прибавку или ноль.
 *
 * Ноль бывает по двум причинам, и обе осмысленны для игрока. Профессия без
 * мастерства (кулинария, реликварий) шкалы не имеет вовсе. Рецепт ниже
 * своего потолка — «этому я уже научился»: чтобы расти дальше, надо перейти
 * к следующему тиру, а не молотить самый дешёвый рецепт.
 *
 * Прибавка ПОЛНАЯ ИЛИ НИКАКАЯ, без затухания у границы: дробное мастерство
 * читалось бы как проценты процентов, а ступень — вещь пороговая.
 */
export function masteryGain(state: GameState, recipe: RecipeDef): number {
  if (!hasMastery(recipe.profession)) return 0
  const have = masteryOf(state, recipe.profession)
  if (have >= masteryCeilingForLevel(recipeLevel(recipe))) return 0
  return Math.min(MASTERY_PER_CRAFT, MASTERY_MAX - have)
}

/** Новое мастерство после крафта. Профессия без шкалы остаётся как была. */
function withMastery(state: GameState, recipe: RecipeDef): GameState['mastery'] {
  const gain = masteryGain(state, recipe)
  if (gain <= 0) return state.mastery
  return { ...state.mastery, [recipe.profession]: masteryOf(state, recipe.profession) + gain }
}

export function craft(state: GameState, recipeId: string): GameState {
  const recipe = RECIPE_BY_ID[recipeId]
  if (!recipe) return state
  const status = recipeStatus(state, recipe)
  if (!status.canCraft) return state
  const materials = { ...state.materials }
  for (const input of recipe.inputs) {
    materials[input.materialId] = materialCount(state, input.materialId).minus(input.count)
  }
  // Пошлина списывается ОДИН раз и здесь: у обеих веток ниже она общая.
  const gold = state.gold.minus(status.toll)
  // МАСТЕРСТВО СЧИТАЕТСЯ ОТ СОСТОЯНИЯ ДО КРАФТА, и это важно: иначе прибавка
  // сравнивалась бы с потолком, который она сама только что подвинула.
  const mastery = withMastery(state, recipe)
  const event: CombatEvent = { type: 'craft', recipeId: recipe.id }
  if (
    recipe.output.kind === 'food' ||
    recipe.output.kind === 'potion' ||
    recipe.output.kind === 'reagent'
  ) {
    // Еда, зелья и промежуточные реагенты — такие же счётчики, как добыча:
    // одна порция расходуется привалом, одна склянка — глотком, крица —
    // следующим рецептом. Места в сумке ни одно из трёх не занимает, поэтому
    // и проверки на inventory-full у них нет.
    const id = recipe.output.id
    return advanceQuests(
      {
        ...state,
        gold,
        mastery,
        materials: { ...materials, [id]: (materials[id] ?? new Decimal(0)).plus(1) },
        combatLog: pushEvent(state.combatLog, event),
      },
      [event],
    )
  }
  const item = craftedItem(recipe.output, state.itemSeq)
  if (!item) return state
  // Крафт — экшен МЕЖДУ тиками, и его событие тик уже не увидит: на входе
  // в следующий тик оно лежит головой лога. Поэтому задание двигаем здесь же,
  // тем же событием, которое уходит в ленту.
  return advanceQuests(
    {
      ...state,
      gold,
      mastery,
      materials,
      inventory: [...state.inventory, item],
      itemSeq: state.itemSeq + 1,
      combatLog: pushEvent(state.combatLog, event),
    },
    [event],
  )
}

/**
 * Порция еды на привал, если есть. Берётся ПЕРВАЯ доступная из данных —
 * еда одинаково сокращает привал, и выбирать игроку тут нечего.
 */
export function takeFood(state: GameState): { state: GameState; foodId: string | null } {
  for (const foodId of Object.keys(FOOD_BY_ID)) {
    if (materialCount(state, foodId).gte(1)) {
      return {
        state: {
          ...state,
          materials: { ...state.materials, [foodId]: materialCount(state, foodId).minus(1) },
        },
        foodId,
      }
    }
  }
  return { state, foodId: null }
}

// Мастерство читается ОДНОЙ функцией на игру (game/recipeBook.ts): её же
// спрашивает книга рецептов, когда решает, дорос ли герой до ступени.
// Здесь она пере-экспортирована, потому что для вызывающего «мастерство» —
// часть ремесла, а не отдельная тема.
export { masteryOf }
export { REAGENT_BY_ID }
