// КНИГА РЕЦЕПТОВ: что герой ЗНАЕТ, а не что он может себе позволить.
//
// До этого модуля знание было производной уровня: дорос — знаешь всё. Рецепт
// не был добычей вовсе, и оттого ремесло не было местом, куда возвращаются:
// открывать в нём было нечего.
//
// ЗНАНИЕ И ВОЗМОЖНОСТЬ — РАЗНЫЕ ВЕЩИ, И ПУТАТЬ ИХ НЕЛЬЗЯ. «Знаю, но нет
// реагентов» — это цель на вечер. «Не знаю» — это причина сходить в
// подземелье. Обе причины отказа отдельными кодами, и обе видны игроку до
// нажатия.
//
// ХРАНИТСЯ НЕ ВСЁ. Знание, которое ВЫВОДИТСЯ, в сейве не лежит: ступень
// мастерства считается из самого мастерства, храмовая награда — из рекорда по
// волнам (`data/temple.ts`), простой рецепт известен всегда. В сейв попадают
// только те два источника, у которых нет другого следа: боссовый рецепт и
// мировая находка. То же правило, что у доступных очков талантов, — второй
// счётчик того же самого разъезжается с первым на первой правке.
import {
  RECIPE_BY_ID,
  bossRecipe,
  masteryToKnow,
  worldRecipesInBand,
  type ProfessionId,
  type RecipeDef,
} from '../data/recipes'
import { recipeUnlocked } from '../data/temple'
import { zoneBand } from '../data/zones'
import type { GameState } from './state'
import type { Rng } from './rng'

/** Мастерство героя в профессии. Отсутствие — ноль, а не undefined. */
export function masteryOf(state: GameState, profession: ProfessionId): number {
  return state.mastery[profession] ?? 0
}

/**
 * Знает ли герой рецепт.
 *
 * Ветвление идёт ПО ВИДУ ИСТОЧНИКА — полю данных, — а не по id рецепта:
 * новый рецепт получает источник строкой в данных и работает сам.
 */
export function recipeKnown(state: GameState, recipe: RecipeDef): boolean {
  const source = recipe.source
  if (source.kind === 'basic') return true
  if (source.kind === 'mastery') return masteryOf(state, recipe.profession) >= masteryToKnow(recipe)
  // Храм считает сам: рубеж волн и флаг зачистки живут в data/temple.ts, и
  // второй копии этого правила здесь быть не должно.
  if (source.kind === 'temple') {
    return recipeUnlocked(recipe.id, state.templeBestWave, state.templeCleared)
  }
  return state.knownRecipeIds[recipe.id] === true
}

/**
 * Выучить рецепт. ИДЕМПОТЕНТНО: известный рецепт возвращает то же состояние,
 * и это не крайний случай, а обычный — боссовый рецепт падает со стопроцентной
 * вероятностью, то есть второй заход в подземелье приходит сюда всегда.
 */
export function learnRecipe(state: GameState, recipeId: string): GameState {
  const recipe = RECIPE_BY_ID[recipeId]
  if (!recipe) return state
  if (recipeKnown(state, recipe)) return state
  return { ...state, knownRecipeIds: { ...state.knownRecipeIds, [recipeId]: true } }
}

/**
 * Рецепт, который роняет этот босс, ЕСЛИ он ещё не выучен.
 *
 * Возврат null означает «выдавать нечего», и у него две причины: у босса
 * рецепта нет вовсе или он уже известен. Разницы между ними снаружи нет
 * намеренно — повторный заход обязан пройти МОЛЧА, отдав только реагент.
 */
export function bossRecipeToLearn(
  state: GameState,
  dungeonId: string,
  bossId: string,
): RecipeDef | null {
  const recipe = bossRecipe(dungeonId, bossId)
  if (!recipe || recipeKnown(state, recipe)) return null
  return recipe
}

/** Мировые рецепты полосы, которых герой ещё не знает. */
export function worldRecipesToLearn(state: GameState, zoneId: string): RecipeDef[] {
  const band = zoneBand(zoneId)
  if (!band) return []
  return worldRecipesInBand(band).filter((recipe) => !recipeKnown(state, recipe))
}

/**
 * Бросок мирового рецепта с убитого моба.
 *
 * БРОСКА НЕ ДЕЛАЕТСЯ ВОВСЕ, ЕСЛИ УЧИТЬ НЕЧЕГО, и это не оптимизация. Лишний
 * вызов rng сдвинул бы поток случайности там, где ничего не может выпасть, —
 * то же правило, по которому гарантированный реагент босса не бросает кубик
 * (см. rollBossReagent).
 */
export function rollWorldRecipe(
  state: GameState,
  zoneId: string,
  chance: number,
  rng: Rng,
): RecipeDef | null {
  const pool = worldRecipesToLearn(state, zoneId)
  if (pool.length === 0) return null
  if (rng() >= chance) return null
  // Второй бросок — только внутри попадания: на полосе может лежать несколько
  // ненайденных рецептов, и порядок находки не должен зависеть от их порядка
  // в файле данных.
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))]
}
