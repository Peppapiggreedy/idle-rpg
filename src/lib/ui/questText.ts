// Тексты условий заданий. Логика их не знает: она отдаёт цель с id и числами,
// а слова живут здесь — то же правило, что у причин отказа умений и талантов.
import { DUNGEON_BY_ID } from '../data/dungeons'
import { RECIPE_BY_ID } from '../data/recipes'
import { ZONE_BY_ID } from '../data/zones'
import type { QuestGoal } from '../data/quests'

function monsterName(zoneId: string, monsterId: string): string {
  return ZONE_BY_ID[zoneId]?.monsterPool.find((a) => a.id === monsterId)?.name ?? monsterId
}

/** Условие цели одной строкой. */
export function goalText(goal: QuestGoal): string {
  switch (goal.kind) {
    case 'kill':
      return (
        `Одолеть ${goal.count} — «${monsterName(goal.zoneId, goal.monsterId)}», ` +
        `зона «${ZONE_BY_ID[goal.zoneId]?.name ?? goal.zoneId}»`
      )
    case 'dungeon':
      return `Пройти данж «${DUNGEON_BY_ID[goal.dungeonId]?.name ?? goal.dungeonId}» целиком`
    case 'craft':
      return `Сковать: ${RECIPE_BY_ID[goal.recipeId]?.name ?? goal.recipeId} — ${goal.count} шт.`
    case 'level':
      return `Достичь ${goal.level} уровня`
  }
}

/** Прогресс: «7 / 25» или «92 / 100 уровень». */
export function progressText(goal: QuestGoal, progress: number, target: number): string {
  return goal.kind === 'level' ? `${progress} / ${target} уровень` : `${progress} / ${target}`
}
