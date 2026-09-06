// ОТКУДА БЕРЁТСЯ РЕЦЕПТ — СЛОВАМИ. Логика отдаёт источник структурой
// (`RecipeSource` в data/recipes.ts), слово подставляется здесь: то же
// правило, что у причин отказа экипировки и умений.
//
// НЕИЗВЕСТНЫЙ РЕЦЕПТ ВИДЕН В КНИГЕ И ПОДПИСАН ИСТОЧНИКОМ. Это осознанное
// исключение из «закрыто значит не видно» — то же, что у запертой кнопки
// умения: список рецептов и есть обещание, ради которого идут в подземелье.
// Спрятать его значило бы спрятать причину туда идти, а показать серым без
// подписи — заменить обещание загадкой.
import { DUNGEON_BY_ID } from '../data/dungeons'
import { bandForLevel } from '../data/bands'
import { masteryRank } from '../data/mastery'
import { masteryToKnow, recipeLevel, type RecipeDef } from '../data/recipes'

/** Имя босса по id внутри данжа. Чужой id — пусто, а не выдуманное имя. */
function bossName(dungeonId: string, bossId: string): string {
  return DUNGEON_BY_ID[dungeonId]?.bosses.find((b) => b.id === bossId)?.name ?? ''
}

/**
 * Одна строка о том, где рецепт лежит.
 *
 * Она называет МЕСТО, а не шанс: «падает с Утопшего короля» — это адрес, по
 * которому можно пойти. Проценты мирового рецепта здесь не пишутся намеренно —
 * идти за ним всё равно некуда, он находится сам.
 */
export function recipeSourceText(recipe: RecipeDef): string {
  const source = recipe.source
  switch (source.kind) {
    case 'basic':
      return 'Известен с самого начала'
    case 'mastery': {
      const need = masteryToKnow(recipe)
      if (need <= 0) return 'Первый рецепт ремесла — известен сразу'
      return `Придёт с опытом: мастерство ${need} (${masteryRank(need).name})`
    }
    case 'boss': {
      const dungeon = DUNGEON_BY_ID[source.dungeonId]
      const boss = bossName(source.dungeonId, source.bossId)
      if (!dungeon) return 'Роняет босс подземелья'
      // ИМЯ БОССА СТОИТ В ИМЕНИТЕЛЬНОМ, и фраза построена под него: «падает с
      // Утопший король» — не по-русски, а склонять имена из данных нечем.
      return boss ? `Роняет ${boss} · ${dungeon.name}` : `Роняет последний босс · ${dungeon.name}`
    }
    case 'world': {
      const band = bandForLevel(recipeLevel(recipe))
      return `Редкая находка с мобов ${band.minLevel}–${band.maxLevel} уровня`
    }
    case 'temple':
      return 'Награда Храма испытаний'
  }
}

/**
 * Короткая пометка для кнопки: почему собрать нельзя.
 *
 * Код отказа один на все источники (`unknown`), а слово РАЗНОЕ: «ещё не по
 * руке» — это про умение, «рубеж не взят» — про храм, «не найден» — про
 * находку. Одно слово на три причины отправляло бы игрока не туда.
 */
export function unknownRecipeText(recipe: RecipeDef): string {
  if (recipe.source.kind === 'mastery') return 'Ещё не по руке'
  if (recipe.source.kind === 'temple') return 'Рубеж храма не взят'
  return 'Рецепт не найден'
}
