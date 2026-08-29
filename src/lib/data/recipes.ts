// Рецепты профессий — данные. Уровней у профессий НЕТ намеренно: прокачка
// профессии — это второй счётчик, который надо гриндить, а гриндить в этой
// игре уже есть что. Рецепт либо доступен, либо нет — по материалам.
//
// Две профессии, и обе решают РАЗНЫЕ задачи:
//   кулинария  — сокращает привал (даёт restSpeedupSource на одну отсидку);
//   кузнечное  — даёт предмет уровня хорошей находки СВОЕЙ зоны, а не лучше:
//                крафт — это подстраховка от невезения, а не обход лута.
import { Decimal } from '../game/numbers'
import type { StatModifier } from '../game/stats'
import { HERB_BY_ID } from './herbs'
import type { IconName } from '../ui/icons/manifest'
import type { SlotId } from './slots'
import { ARMOR_ATTRIBUTES, type AttributeId } from './items'
import { DUNGEONS } from './dungeons'
import { procIdOf, relicTier } from './procs'
import { LEVEL_CAP, UNIQUE_RECIPE_LEVEL } from './balance'
import type { Rarity } from '../types'

export type ProfessionId = 'cooking' | 'smithing' | 'herbalism' | 'relics'

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
  {
    id: 'relics',
    name: 'Реликварий',
    icon: 'profession-relics',
    tagline: 'Известная вещь без единого броска: что обещано в рецепте, то и выйдет.',
  },
  {
    id: 'herbalism',
    name: 'Травничество',
    icon: 'profession-herbalism',
    tagline:
      'Травы срезаются сами, пока герой в зоне. Склянка действует только ' +
      'у того, кто её выпил: сам себя герой не поит.',
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
  /** Прилагательное в имени: «Кованый Панцирь». Не задано — имя берётся
   *  целиком из `name`: у уникальной вещи имя собственное, а не «Кованый X». */
  adjective?: string
  /** Готовое имя вещи. Задано — оно и есть имя, прилагательное не нужно. */
  name?: string
  /** Прок вещи (data/procs.ts). Сама механика живёт в game/combat.ts,
   *  предмет только называет id: так один прок нельзя описать дважды
   *  по-разному, а внутренний кулдаун у него один на всю игру. */
  procId?: string
}

/** Модификатор зелья БЕЗ source: source проставляется как 'potion:<id>'. */
export type PotionModifier = Omit<StatModifier, 'source'>

/** Длительность склянки, секунд. Одна на все три: аптайм считается от неё,
 *  и разная длительность превратила бы «держать зелье» в упражнение по
 *  таймерам, а не в решение, какое зелье держать. */
export const POTION_DURATION_SEC = 180

/** Зелье: расходуется глотком и на POTION_DURATION_SEC поднимает статы. */
export interface PotionOutput {
  kind: 'potion'
  /** Id склянки: он же ложится в мешок и он же — source модификаторов.
   *  Обязан быть `potion:<id рецепта>`, это держит content:check. */
  id: string
  name: string
  icon: IconName
  durationSec: number
  /** Что склянка делает — модификаторы конвейера статов, без source. */
  mods: PotionModifier[]
}

export interface RecipeDef {
  id: string
  name: string
  icon: IconName
  profession: ProfessionId
  /** С какого уровня рецепт доступен. Не задан — с первого. */
  unlockLevel?: number
  inputs: RecipeInput[]
  output: FoodOutput | ItemOutput | PotionOutput
}

const CRAFT_RECIPES: RecipeDef[] = [
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
  // --- Травничество: три склянки, три разных ответа на «чего не хватает» ---
  //
  // Числа держит контракт шага 34: ручная игра С зельями к автокасту БЕЗ них
  // обязана лечь в 1.4..1.6 (game/__tests__/potions.test.ts). Прибавок три,
  // а не одна, намеренно: зелье должно ощутимо менять бой, но ни одна из
  // трёх сама по себе не переворачивает билд.
  {
    id: 'fury-draught',
    name: 'Настой ярости',
    icon: 'potion-fury',
    profession: 'herbalism',
    inputs: [
      { materialId: 'bitterleaf', count: 2 },
      { materialId: 'emberroot', count: 1 },
    ],
    output: {
      kind: 'potion',
      id: 'potion:fury-draught',
      name: 'Настой ярости',
      icon: 'potion-fury',
      durationSec: POTION_DURATION_SEC,
      mods: [
        { stat: 'attackPower', kind: 'percent', value: new Decimal(0.3) },
        // Ускорение ВСЕГДА flat по haste и никогда прибавкой к weaponSpeed:
        // то же правило, что и у талантов (см. CLAUDE.md).
        { stat: 'haste', kind: 'flat', value: new Decimal(0.1) },
        { stat: 'critChance', kind: 'flat', value: new Decimal(0.05) },
      ],
    },
  },
  {
    id: 'windroot-draught',
    name: 'Настой ветрокорня',
    icon: 'potion-wind',
    profession: 'herbalism',
    inputs: [
      { materialId: 'emberroot', count: 2 },
      { materialId: 'hoarbloom', count: 1 },
    ],
    output: {
      kind: 'potion',
      id: 'potion:windroot-draught',
      name: 'Настой ветрокорня',
      icon: 'potion-wind',
      durationSec: POTION_DURATION_SEC,
      // Не «то же самое, но слабее»: ускорение плюс восстановление ресурса
      // разгоняет РОТАЦИЮ, а не удар, и на классе с дорогими умениями
      // выигрывает у ярости. Выбор между ними — про билд, а не про цифру.
      mods: [
        { stat: 'haste', kind: 'flat', value: new Decimal(0.18) },
        { stat: 'manaRegen', kind: 'percent', value: new Decimal(0.25) },
      ],
    },
  },
  {
    id: 'stonebloom-draught',
    name: 'Настой стылоцвета',
    icon: 'potion-stone',
    profession: 'herbalism',
    inputs: [
      { materialId: 'hoarbloom', count: 2 },
      { materialId: 'bitterleaf', count: 1 },
    ],
    output: {
      kind: 'potion',
      id: 'potion:stonebloom-draught',
      name: 'Настой стылоцвета',
      icon: 'potion-stone',
      durationSec: POTION_DURATION_SEC,
      // Это зелье поднимает не урон, а АПТАЙМ: больше запаса и меньше
      // входящего — значит дольше между привалами. В зоне не по силам оно
      // приносит больше ярости, и это законный ответ на «тут больно».
      mods: [
        { stat: 'maxHp', kind: 'percent', value: new Decimal(0.25) },
        { stat: 'damageReduction', kind: 'flat', value: new Decimal(0.05) },
        { stat: 'hpRegen', kind: 'percent', value: new Decimal(0.5) },
      ],
    },
  },
  // --- Легендарные уникумы на реагентах ГЕРОИКИ ---
  //
  // Открываются на сотом: это последняя вещь, которую можно сделать руками, и
  // добывается она только вторым проходом по лестнице. Реагенты просятся из
  // РАЗНЫХ героик — одной любимой не обойтись, надо пройти всю лестницу.
  {
    id: 'relic-fang',
    name: 'Реликтовый змеезуб',
    icon: 'recipe-relic-blade',
    profession: 'smithing',
    unlockLevel: LEVEL_CAP,
    inputs: [
      { materialId: 'reagent-mute-stone', count: 2 },
      { materialId: 'reagent-seething-coal', count: 3 },
      { materialId: 'ember-shard', count: 8 },
    ],
    output: {
      kind: 'item',
      slot: 'mainHand',
      rarity: 'legendary',
      level: 100,
      templateId: 'fang',
      adjective: 'Реликтовый',
    },
  },
  {
    id: 'relic-cuirass',
    name: 'Реликтовый панцирь',
    icon: 'recipe-relic-plate',
    profession: 'smithing',
    unlockLevel: LEVEL_CAP,
    inputs: [
      { materialId: 'reagent-rime-core', count: 2 },
      { materialId: 'reagent-brine-druse', count: 3 },
      { materialId: 'quarry-ore', count: 10 },
    ],
    output: {
      kind: 'item',
      slot: 'chest',
      rarity: 'legendary',
      level: 100,
      attribute: 'vitality',
      adjective: 'Реликтовый',
    },
  },
  {
    id: 'relic-charm',
    name: 'Реликтовый оберег',
    icon: 'recipe-relic-charm',
    profession: 'smithing',
    unlockLevel: LEVEL_CAP,
    inputs: [
      { materialId: 'reagent-drowned-whorl', count: 2 },
      { materialId: 'reagent-booming-whirl', count: 2 },
      { materialId: 'reagent-bottom-tear', count: 2 },
      { materialId: 'reagent-drift-charge', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'trinket',
      rarity: 'legendary',
      level: 100,
      attribute: 'agility',
      adjective: 'Реликтовый',
    },
  },
  // --- Награды Храма испытаний: открываются рубежами волн, а не материалами ---
  // Материалы у них обычные, дальних зон: рубеж отпирает рецепт, а собирать
  // его всё равно из того, что падает. Уровень предмета — уровень мобов той
  // полосы, куда игрок к этому времени добрался.
  {
    id: 'trial-bracer',
    name: 'Храмовый наруч',
    icon: 'slot-hands',
    profession: 'smithing',
    inputs: [
      { materialId: 'rime-salt', count: 4 },
      { materialId: 'bog-hide', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'hands',
      rarity: 'rare',
      level: 72,
      attribute: 'agility',
      adjective: 'Храмовый',
    },
  },
  {
    id: 'trial-helm',
    name: 'Храмовый шлем',
    icon: 'slot-head',
    profession: 'smithing',
    inputs: [
      { materialId: 'rime-salt', count: 6 },
      { materialId: 'ember-shard', count: 4 },
    ],
    output: {
      kind: 'item',
      slot: 'head',
      rarity: 'epic',
      level: 80,
      attribute: 'vitality',
      adjective: 'Храмовый',
    },
  },
  {
    id: 'trial-charm',
    name: 'Храмовый амулет',
    icon: 'slot-trinket',
    profession: 'smithing',
    inputs: [
      { materialId: 'ember-shard', count: 8 },
      { materialId: 'rime-salt', count: 8 },
    ],
    output: {
      kind: 'item',
      slot: 'trinket',
      rarity: 'legendary',
      level: 90,
      attribute: 'strength',
      adjective: 'Храмовый',
    },
  },
]

/**
 * Уникальные рецепты — ВЫВОДЯТСЯ ИЗ ТИРА данжа: добавили девятый данж, и
 * девятая реликвия появилась сама.
 *
 * Уровень реликвии растёт со ступенью, но начинается с уровня открытия
 * рецепта. Ровнять его по уровню боссов данжа нельзя — реликвия первого тира
 * вышла бы двадцатого уровня, а крафтить её открывают на шестидесятом, и она
 * была бы мёртвым контентом с первого дня.
 */
export const RELIC_LEVEL_BASE = UNIQUE_RECIPE_LEVEL
export const RELIC_LEVEL_STEP = 5
/** Сколько реагентов стоит реликвия: около пяти полных прохождений. */
export const RELIC_REAGENT_COST = 5

export const UNIQUE_RECIPES: RecipeDef[] = DUNGEONS.map((dungeon) => {
  const relic = relicTier(dungeon.tier)
  const tier = Math.max(1, Math.floor(dungeon.tier || 1))
  return {
    id: `relic-${dungeon.id}`,
    name: relic.name,
    icon: relic.icon,
    profession: 'relics' as const,
    unlockLevel: UNIQUE_RECIPE_LEVEL,
    inputs: [{ materialId: dungeon.reagentId, count: RELIC_REAGENT_COST }],
    output: {
      kind: 'item' as const,
      slot: 'trinket' as const,
      rarity: 'legendary' as const,
      level: RELIC_LEVEL_BASE + (tier - 1) * RELIC_LEVEL_STEP,
      // Главный атрибут тоже от тира: четыре атрибута по кругу — так лестница
      // реликвий не оказывается восемью вещами под один билд.
      attribute: ARMOR_ATTRIBUTES[(tier - 1) % ARMOR_ATTRIBUTES.length],
      name: relic.name,
      procId: procIdOf(dungeon.id),
    },
  }
})

export const RECIPES: RecipeDef[] = [...CRAFT_RECIPES, ...UNIQUE_RECIPES]

export const RECIPE_BY_ID: Record<string, RecipeDef> = Object.fromEntries(
  RECIPES.map((r) => [r.id, r]),
)

/** Уровень открытия рецепта. Одно место, где живёт умолчание. */
export function recipeUnlockLevel(recipe: RecipeDef): number {
  return recipe.unlockLevel ?? 1
}

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

/** Префикс source у модификаторов зелий: по нему их видно и в раскладке
 *  статов, и там, где модель боя обязана их ВЫЧИСТИТЬ (режим 'auto'). */
export const POTION_SOURCE_PREFIX = 'potion:'

export function potionSource(recipeId: string): string {
  return `${POTION_SOURCE_PREFIX}${recipeId}`
}

export type PotionRecipe = RecipeDef & { output: PotionOutput }

/** Рецепты зелий В ПОРЯДКЕ ДАННЫХ: он же — приоритет модели ручной игры
 *  (первое, что герой может сварить здесь, она и считает выпитым). */
export const POTION_RECIPES: PotionRecipe[] = RECIPES.filter(
  (r): r is PotionRecipe => r.output.kind === 'potion',
)

export const POTION_RECIPE_BY_ID: Record<string, PotionRecipe> = Object.fromEntries(
  POTION_RECIPES.map((r) => [r.id, r]),
)

/** По id склянки из мешка — её рецепт. Ровно так зелье и находят при глотке. */
export const POTION_RECIPE_BY_OUTPUT: Record<string, PotionRecipe> = Object.fromEntries(
  POTION_RECIPES.map((r) => [r.output.id, r]),
)

export const POTION_BY_ID: Record<string, PotionOutput> = Object.fromEntries(
  POTION_RECIPES.map((r) => [r.output.id, r.output]),
)

/**
 * Модификаторы действующих зелий для конвейера статов. Живут В ДАННЫХ, как и
 * talentModifiers: логика знает только «действует склянка с таким id», а что
 * именно она делает, записано здесь. Ни одного `if (зелье === '...')`.
 *
 * `share` — доля силы: единица у реально выпитого зелья и POTION_TARGET_UPTIME
 * у модели ручной игры (зелье действует не всё время). Урезание ЛИНЕЙНОЕ —
 * это среднее стата по времени, и для flat/percent оно точное.
 */
export function potionModifiers(
  active: ReadonlyArray<{ recipeId: string }>,
  share = 1,
): StatModifier[] {
  const mods: StatModifier[] = []
  for (const { recipeId } of active) {
    const recipe = POTION_RECIPE_BY_ID[recipeId]
    if (!recipe) continue
    for (const mod of recipe.output.mods) {
      mods.push({
        ...mod,
        value: share === 1 ? mod.value : mod.value.times(share),
        source: potionSource(recipeId),
      })
    }
  }
  return mods
}

/** Все id, которые могут лежать в мешке помимо материалов: еда и склянки.
 *  По нему сейв отличает свой мусор от чужого. */
export function isBagId(id: string): boolean {
  return id in FOOD_BY_ID || id in POTION_BY_ID || id in HERB_BY_ID
}



