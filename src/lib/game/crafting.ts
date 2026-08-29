// Профессии: материалы, рецепты, крафт. Чистые операции над состоянием.
//
// Уровней у профессий нет: рецепт либо собирается из того, что есть, либо
// нет. Отказ — отдельный КОД, текст причины рендерит UI (правило проекта).
import { Decimal } from './numbers'
import { MATERIAL_BY_ID, materialsInZone, type MaterialDef } from '../data/materials'
import {
  FOOD_BY_ID,
  RECIPE_BY_ID,
  type ItemOutput,
  type RecipeDef,
} from '../data/recipes'
import { RARITY_BY_ID } from '../data/rarity'
import { ARMOR_NOUNS, SHIELD_BY_ID, WEAPON_BY_ID } from '../data/items'
import { INVENTORY_SIZE, MATERIAL_DROP_CHANCE } from '../data/balance'
import { armorMods, shieldMods, weaponMods } from './loot'
import { pushEvent, type GameState } from './state'
import type { Rng } from './rng'
import type { Item } from '../types'

/** Сколько единиц материала у героя. Отсутствие — ноль, а не undefined. */
export function materialCount(state: GameState, id: string): Decimal {
  return state.materials[id] ?? new Decimal(0)
}

/**
 * Бросок материала с убитого моба. Пул СВОЙ, отдельный от лута: материалы не
 * занимают слот в сумке и не сдвигают шансы редкости предметов.
 *
 * Порядок бросков фиксирован: шанс -> материал из пула зоны.
 */
export function rollMaterial(zoneId: string, rng: Rng): MaterialDef | null {
  if (rng() >= MATERIAL_DROP_CHANCE) return null
  const pool = materialsInZone(zoneId)
  if (pool.length === 0) return null
  const total = pool.reduce((sum, m) => sum + m.weight, 0)
  let roll = rng() * total
  for (const material of pool) {
    roll -= material.weight
    if (roll < 0) return material
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
export type CraftBlockReason = 'materials' | 'inventory-full'

export interface RecipeStatus {
  recipe: RecipeDef
  canCraft: boolean
  reason: CraftBlockReason | null
  /** Чего и сколько не хватает. Пусто — материалов достаточно. */
  missing: Array<{ materialId: string; need: number; have: Decimal }>
}

export function recipeStatus(state: GameState, recipe: RecipeDef): RecipeStatus {
  const missing = recipe.inputs
    .map((input) => ({
      materialId: input.materialId,
      need: input.count,
      have: materialCount(state, input.materialId),
    }))
    .filter((row) => row.have.lt(row.need))
  if (missing.length > 0) return { recipe, canCraft: false, reason: 'materials', missing }
  // Предмет должен куда-то лечь; еда места не занимает.
  if (recipe.output.kind === 'item' && state.inventory.length >= INVENTORY_SIZE) {
    return { recipe, canCraft: false, reason: 'inventory-full', missing }
  }
  return { recipe, canCraft: true, reason: null, missing }
}

/** Предмет из рецепта. Модификаторы строят ТЕ ЖЕ функции, что и для лута. */
export function craftedItem(output: ItemOutput, seq: number): Item | null {
  const rarity = RARITY_BY_ID[output.rarity]
  const id = `craft-${seq}`
  if (output.slot === 'mainHand' || output.slot === 'offHand') {
    if (output.templateId && SHIELD_BY_ID[output.templateId]) {
      const template = SHIELD_BY_ID[output.templateId]
      return {
        id,
        name: `${output.adjective} ${template.noun}`,
        rarity: rarity.id,
        slot: output.slot,
        level: output.level,
        mods: shieldMods(template, rarity, output.level),
      }
    }
    const template = output.templateId ? WEAPON_BY_ID[output.templateId] : undefined
    if (!template) return null
    return {
      id,
      name: `${output.adjective} ${template.noun}`,
      rarity: rarity.id,
      slot: output.slot,
      level: output.level,
      hands: template.hands,
      mods: weaponMods(template, rarity, output.slot, output.level),
    }
  }
  // Атрибут кованой брони обязан быть назван в рецепте — это держит
  // content:check; без него рецепт не собирается, а не куёт что-то молча.
  if (!output.attribute) return null
  const nouns = ARMOR_NOUNS[output.slot]
  return {
    id,
    name: `${output.adjective} ${nouns[0]}`,
    rarity: rarity.id,
    slot: output.slot,
    level: output.level,
    mods: armorMods(output.slot, rarity, output.level, output.attribute),
  }
}

/** Собрать рецепт. Нельзя — состояние не меняется вовсе. */
export function craft(state: GameState, recipeId: string): GameState {
  const recipe = RECIPE_BY_ID[recipeId]
  if (!recipe) return state
  const status = recipeStatus(state, recipe)
  if (!status.canCraft) return state
  const materials = { ...state.materials }
  for (const input of recipe.inputs) {
    materials[input.materialId] = materialCount(state, input.materialId).minus(input.count)
  }
  if (recipe.output.kind === 'food') {
    // Еда — такой же счётчик, как материал: одна порция расходуется привалом.
    const id = recipe.output.id
    return {
      ...state,
      materials: { ...materials, [id]: (materials[id] ?? new Decimal(0)).plus(1) },
      combatLog: pushEvent(state.combatLog, { type: 'craft', recipeId: recipe.id }),
    }
  }
  const item = craftedItem(recipe.output, state.itemSeq)
  if (!item) return state
  return {
    ...state,
    materials,
    inventory: [...state.inventory, item],
    itemSeq: state.itemSeq + 1,
    combatLog: pushEvent(state.combatLog, { type: 'craft', recipeId: recipe.id }),
  }
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

export { MATERIAL_BY_ID }
