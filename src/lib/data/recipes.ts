// Рецепты профессий — данные. Уровней у профессий НЕТ намеренно: прокачка
// профессии — это второй счётчик, который надо гриндить, а гриндить в этой
// игре уже есть что. Рецепт либо доступен, либо нет — по материалам.
//
// Две профессии, и обе решают РАЗНЫЕ задачи:
//   кулинария  — сокращает привал (даёт restSpeedupSource на одну отсидку);
//   кузнечное  — даёт предмет уровня хорошей находки СВОЕЙ зоны, а не лучше:
//                крафт — это подстраховка от невезения, а не обход лута.
import type { IconName } from '../ui/icons/manifest'
import type { SlotId } from './slots'
import type { AttributeId } from './items'
import type { Rarity } from '../types'

export type ProfessionId = 'cooking' | 'smithing'

export interface ProfessionDef {
  id: ProfessionId
  name: string
  icon: IconName
  /** Одна строка о том, зачем она нужна. */
  tagline: string
}

export const PROFESSIONS: ProfessionDef[] = [
  {
    id: 'cooking',
    name: 'Кулинария',
    icon: 'profession-cooking',
    tagline: 'Порция еды вдвое сокращает один привал. Без неё привал просто дольше.',
  },
  {
    id: 'smithing',
    name: 'Кузнечное дело',
    icon: 'profession-smithing',
    tagline: 'Предмет уровня хорошей находки своей зоны — на случай, если не везёт.',
  },
]

export interface RecipeInput {
  materialId: string
  count: number
}

/** Еда: расходуется на один привал и сокращает его. */
export interface FoodOutput {
  kind: 'food'
  /** Id порции: он же ложится в restSpeedupSource. */
  id: string
  name: string
  icon: IconName
}

/** Предмет: собирается ТЕМИ ЖЕ правилами, что и лут, — своего пути у крафта нет. */
export interface ItemOutput {
  kind: 'item'
  slot: SlotId
  rarity: Rarity
  /** Уровень кованого предмета — уровень мобов зоны, чьи материалы он просит.
   *  «Предмет уровня хорошей находки своей зоны»: тир и уровень как у дропа,
   *  который в тех местах и падает, — сравнимый, а не строго лучший. */
  level: number
  /** Шаблон оружия или щита; для брони не нужен. */
  templateId?: string
  /** Главный атрибут кованой брони. У дропа он случайный, у рецепта — данные:
   *  кузнец куёт то, что обещал. Для оружия и щита не нужен — атрибуты там
   *  из шаблона. */
  attribute?: AttributeId
  /** Прилагательное в имени: «Кованый Панцирь». */
  adjective: string
}

export interface RecipeDef {
  id: string
  name: string
  icon: IconName
  profession: ProfessionId
  inputs: RecipeInput[]
  output: FoodOutput | ItemOutput
}

export const RECIPES: RecipeDef[] = [
  // --- Кулинария ---
  {
    id: 'herb-broth',
    name: 'Травяной отвар',
    icon: 'recipe-broth',
    profession: 'cooking',
    inputs: [{ materialId: 'meadow-herb', count: 3 }],
    output: { kind: 'food', id: 'food:herb-broth', name: 'Травяной отвар', icon: 'recipe-broth' },
  },
  {
    id: 'hearty-stew',
    name: 'Сытная похлёбка',
    icon: 'recipe-stew',
    profession: 'cooking',
    inputs: [
      { materialId: 'lean-meat', count: 2 },
      { materialId: 'meadow-herb', count: 2 },
    ],
    output: { kind: 'food', id: 'food:hearty-stew', name: 'Сытная похлёбка', icon: 'recipe-stew' },
  },
  {
    id: 'salted-jerky',
    name: 'Солёная вяленина',
    icon: 'recipe-jerky',
    profession: 'cooking',
    inputs: [
      { materialId: 'lean-meat', count: 3 },
      { materialId: 'rime-salt', count: 1 },
    ],
    output: { kind: 'food', id: 'food:salted-jerky', name: 'Солёная вяленина', icon: 'recipe-jerky' },
  },

  // --- Кузнечное дело: по рецепту на слот брони и один на руку ---
  {
    id: 'forged-helm',
    name: 'Кованый шлем',
    icon: 'slot-head',
    profession: 'smithing',
    inputs: [
      { materialId: 'quarry-ore', count: 4 },
      { materialId: 'bog-hide', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'head',
      rarity: 'uncommon',
      level: 13,
      attribute: 'intellect',
      adjective: 'Кованый',
    },
  },
  {
    id: 'forged-cuirass',
    name: 'Кованый панцирь',
    icon: 'slot-chest',
    profession: 'smithing',
    inputs: [
      { materialId: 'quarry-ore', count: 6 },
      { materialId: 'bog-hide', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'chest',
      rarity: 'uncommon',
      level: 13,
      attribute: 'vitality',
      adjective: 'Кованый',
    },
  },
  {
    id: 'forged-greaves',
    name: 'Кованые поножи',
    icon: 'slot-legs',
    profession: 'smithing',
    inputs: [
      { materialId: 'quarry-ore', count: 5 },
      { materialId: 'ember-shard', count: 1 },
    ],
    output: {
      kind: 'item',
      slot: 'legs',
      rarity: 'uncommon',
      level: 23,
      attribute: 'strength',
      adjective: 'Кованый',
    },
  },
  {
    id: 'forged-fang',
    name: 'Кованый змеезуб',
    icon: 'slot-weapon',
    profession: 'smithing',
    inputs: [
      { materialId: 'quarry-ore', count: 6 },
      { materialId: 'ember-shard', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'mainHand',
      rarity: 'uncommon',
      level: 23,
      templateId: 'fang',
      adjective: 'Кованый',
    },
  },
  {
    id: 'forged-bulwark',
    name: 'Кованый заслон',
    icon: 'slot-offhand',
    profession: 'smithing',
    inputs: [
      { materialId: 'quarry-ore', count: 5 },
      { materialId: 'rime-salt', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'offHand',
      rarity: 'uncommon',
      level: 58,
      templateId: 'bulwark',
      adjective: 'Кованый',
    },
  },
]

export const RECIPE_BY_ID: Record<string, RecipeDef> = Object.fromEntries(
  RECIPES.map((r) => [r.id, r]),
)

export function recipesOf(profession: ProfessionId): RecipeDef[] {
  return RECIPES.filter((r) => r.profession === profession)
}

/** Все id еды: по ним привал ищет, чем себя сократить. */
export const FOOD_IDS: string[] = RECIPES.filter(
  (r): r is RecipeDef & { output: FoodOutput } => r.output.kind === 'food',
).map((r) => r.output.id)

export const FOOD_BY_ID: Record<string, FoodOutput> = Object.fromEntries(
  RECIPES.filter((r): r is RecipeDef & { output: FoodOutput } => r.output.kind === 'food').map(
    (r) => [r.output.id, r.output],
  ),
)

/** Сколько ЕДИНИЦ материалов стоит рецепт — для проверки соразмерности. */
export function recipeCost(recipe: RecipeDef): number {
  return recipe.inputs.reduce((sum, i) => sum + i.count, 0)
}

