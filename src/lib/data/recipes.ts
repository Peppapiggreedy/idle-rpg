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
import { reagentBandLevels } from './reagents'
import { ZONE_BY_ID, representativeMonster, zoneForMonsterLevel } from './zones'
import type { IconName } from '../ui/icons/manifest'
import type { SlotId } from './slots'
import { ARMOR_ATTRIBUTES, type AttributeId } from './items'
import { DUNGEONS } from './dungeons'
import { DROP_CHANCE, averageItemSellPrice } from './loot'
import { procIdOf, relicTier } from './procs'
import { CRAFT_UNLOCK_LEVEL, LEVEL_CAP, POTION_UNLOCK_LEVEL, UNIQUE_RECIPE_LEVEL } from './balance'
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

/**
 * ПОШЛИНА КРАФТА: сколько ЗОЛОТА стоит нажать «сделать», помимо материалов.
 *
 * Зачем она вообще. До неё крафт не стоил золота вовсе, и золото в игре
 * тратилось ровно на одно — сброс талантов. Кран льёт, слива нет; к
 * пятидесятому уровню счётчик становится украшением, а «накопить» перестаёт
 * быть решением.
 *
 * ПОШЛИНА СЧИТАЕТСЯ ДОЛЕЙ ЧАСОВОГО ДОХОДА, а не числом. Числом её пришлось бы
 * держать в двух местах — в цене и в кривой золота, — и они разъехались бы на
 * первой же правке баланса. Доля не разъезжается: поедет доход, поедут и цены,
 * и «сколько это в часах игры» останется тем же.
 *
 * Часовой доход берётся ТАМ ЖЕ, где кривая опыта берёт цену уровня: награда
 * типичного моба зоны, куда игра ведёт героя, помноженная на убийства в час.
 * Второй модели дохода в игре нет.
 */
export const CRAFT_TOLL_HOURS: Record<'food' | 'potion' | 'item' | 'unique', number> = {
  // Еда — расходник на один привал, и её жгут пачками: втрое дешевле склянки.
  food: 0.125,
  // Склянка меняет бой на три минуты. Тридцать семь процентов часа — это
  // «одна склянка за полчаса фарма»: держать её постоянно нельзя, а взять
  // с собой в данж и на храм — можно.
  potion: 0.375,
  // Кованая вещь — подстраховка от невезения, а не обход лута. Час игры:
  // дороже любого расходника и заметно дешевле уникума.
  item: 1,
  // Уникум с проком планируют заранее и делают раз. Два часа дохода.
  unique: 2,
}

/** Убийств в час у героя в своей зоне. Замер по всем уровням и обоим
 *  классам дал 282..369 — берём 300. */
export const KILLS_PER_HOUR = 300

/**
 * Уровень рецепта: насколько глубоко надо зайти, чтобы его собрать.
 *
 * У кованой вещи он записан прямо (`output.level` — уровень находки, которую
 * она заменяет). У расходников его нет, и брать его неоткуда, кроме как из
 * ВХОДОВ: рецепт стоит ровно столько, сколько стоит добраться до самого
 * глубокого его материала.
 */
export function recipeLevel(recipe: RecipeDef): number {
  if (recipe.output.kind === 'item') return recipe.output.level
  // САМЫЙ ГЛУБОКИЙ ИЗ САМЫХ МЕЛКИХ, а не просто самый глубокий. Материал падает
  // в НЕСКОЛЬКИХ зонах, и брать по нему максимум значит считать, что за
  // луговой травой ходят на девяностый уровень: травяной отвар получал бы
  // цену в сорок тысяч, будучи доступным с первого уровня. Каждый вход стоит
  // столько, сколько стоит МЕЛЧАЙШАЯ зона, где он есть; а рецепт — столько,
  // сколько стоит самый труднодоступный из его входов.
  let level = recipe.unlockLevel ?? 1
  for (const input of recipe.inputs) {
    const shallowest = inputShallowestLevel(input.materialId)
    if (shallowest !== null) level = Math.max(level, shallowest)
  }
  return level
}

/**
 * Насколько глубоко надо зайти за одним входом. У реагента это ВЕРХ ЕГО
 * ПОЛОСЫ — обе зоны полосы роняют его одинаково, и мельчайшая из них ровно
 * одна. У травы по-прежнему список зон: трава срезается временем и растёт в
 * нескольких полосах сразу (полосы ей раздаёт стадия травничества).
 *
 * Боссовые и промежуточные реагенты зон не имеют вовсе — по ним цена не
 * считается, её задаёт `unlockLevel` рецепта.
 */
function inputShallowestLevel(materialId: string): number | null {
  const band = reagentBandLevels(materialId)
  if (band) return band.max
  let shallowest = Number.POSITIVE_INFINITY
  for (const zoneId of HERB_BY_ID[materialId]?.zoneIds ?? []) {
    const zone = ZONE_BY_ID[zoneId]
    if (zone) shallowest = Math.min(shallowest, zone.monsterLevelRange.max)
  }
  return Number.isFinite(shallowest) ? shallowest : null
}

/**
 * Часовой доход золота на этом уровне. ДВА СЛАГАЕМЫХ, а не одно: то, что
 * платит типичный моб своей зоны, и то, что приносит продажа упавшего с него.
 *
 * Второе слагаемое появилось вместе с ценой находки по уровню
 * (`ITEM_SELL_BASE`). Без него модель считала бы лишь `GOLD_SOURCE_SHARE.monsters`
 * от настоящего дохода — то есть пошлина крафта и лестница покупок разом
 * подешевели бы втрое, а тесты этого не заметили бы: они сравнивают модель с
 * прогоном, и прогон упал бы вместе с ней.
 */
export function goldPerHourAt(level: number): Decimal {
  // ОДИН И ТОТ ЖЕ МОБ В ОБОИХ СЛАГАЕМЫХ. Находка падает С НЕГО и несёт ЕГО
  // уровень, а не уровень героя: считать мобу середину полосы, а находке
  // край, значило бы складывать двух разных мобов. На глубине разница
  // копеечная, у первой зоны — четверть дохода.
  const typical = representativeMonster(zoneForMonsterLevel(level))
  const fromLoot = averageItemSellPrice(typical.level).times(DROP_CHANCE)
  return typical.goldReward.plus(fromLoot).times(KILLS_PER_HOUR)
}

/** Сколько золота стоит собрать рецепт. Ноль не бывает: бесплатный слив — не слив. */
export function craftToll(recipe: RecipeDef): Decimal {
  const kind =
    recipe.output.kind === 'item'
      ? recipe.output.procId
        ? 'unique'
        : 'item'
      : // ПЕРЕДЕЛ ПЛАТИТ КАК ЕДА, а не как вещь. Он не даёт ничего надеваемого
        // — только следующий шаг к вещи, — и пошлина вещи, взятая дважды за
        // один предмет, сделала бы двухпередельный путь просто дороже.
        recipe.output.kind === 'reagent'
        ? 'food'
        : recipe.output.kind
  return goldPerHourAt(recipeLevel(recipe)).times(CRAFT_TOLL_HOURS[kind]).ceil()
}

/**
 * ПРОМЕЖУТОЧНЫЙ РЕАГЕНТ НА ВЫХОДЕ. Третий вид выхода рядом с едой и
 * склянкой: в сумку не ложится, места не занимает, а ложится в тот же мешок,
 * что и добыча. Своего пути у него нет — тот же `craft`, та же пошлина.
 */
export interface ReagentOutput {
  kind: 'reagent'
  /** Id реагента из `data/reagents.ts`, роль которого обязана быть `crafted`. */
  id: string
}

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
  output: FoodOutput | ItemOutput | PotionOutput | ReagentOutput
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

  // --- КУЗНЕЧНОЕ ДЕЛО: ЛЕСТНИЦА БЕЗ ДЫР ---
  //
  // Было 13, 13, 23, 23, 58 — и тридцать пять уровней молчания в середине.
  // Стало по вещи на КАЖДУЮ полосу: рецепт есть везде, куда игрок приходит,
  // и держит это `content:check` правилом, а не вниманием.
  //
  // СЛОТЫ ИДУТ ПО ОЧЕРЕДИ. На соседних полосах они разные — иначе три шлема
  // подряд, и адресность («чиню тот слот, где не повезло») не работает: за
  // невезучие поножи предлагали бы третью голову.
  //
  // УРОВЕНЬ ВЕЩИ — ВЕРХ ЕЁ ПОЛОСЫ, и `unlockLevel` равен ему же. Рецепт
  // становится осмысленным тогда, когда игрок полосу уже прошёл и знает,
  // чего ему не хватает; открытый раньше, он обещал бы то, на что нет
  // реагентов. Сила при этом равна ХОРОШЕЙ НАХОДКЕ той же полосы, не выше —
  // ценность крафта в адресности, а не в силе (таблица в docs/CRAFT.md).
  {
    id: 'forged-helm',
    name: 'Кованый шлем',
    icon: 'slot-head',
    profession: 'smithing',
    unlockLevel: 10,
    inputs: [
      { materialId: 'quarry-ore', count: 5 },
    ],
    output: {
      kind: 'item',
      slot: 'head',
      rarity: 'uncommon',
      level: 10,
      attribute: 'intellect',
      adjective: 'Кованый',
    },
  },
  {
    id: 'forged-cuirass',
    name: 'Бороздовый панцирь',
    icon: 'slot-chest',
    profession: 'smithing',
    unlockLevel: 20,
    inputs: [
      { materialId: 'bog-hide', count: 5 },
      { materialId: 'furrow-rust', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'chest',
      rarity: 'uncommon',
      level: 20,
      attribute: 'vitality',
      adjective: 'Бороздовый',
    },
  },
  {
    id: 'forged-fang',
    name: 'Стеклёный змеезуб',
    icon: 'slot-weapon',
    profession: 'smithing',
    unlockLevel: 30,
    inputs: [
      { materialId: 'ember-shard', count: 5 },
      { materialId: 'glass-sliver', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'mainHand',
      rarity: 'uncommon',
      level: 30,
      templateId: 'fang',
      adjective: 'Стеклёный',
    },
  },
  {
    id: 'forged-greaves',
    name: 'Штольневые поножи',
    icon: 'slot-legs',
    profession: 'smithing',
    unlockLevel: 40,
    inputs: [
      { materialId: 'shaft-iron', count: 5 },
      { materialId: 'root-fibre', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'legs',
      rarity: 'uncommon',
      level: 40,
      attribute: 'strength',
      adjective: 'Штольневый',
    },
  },
  {
    id: 'forged-bulwark',
    name: 'Ярусный заслон',
    icon: 'slot-offhand',
    profession: 'smithing',
    unlockLevel: 50,
    inputs: [
      { materialId: 'tier-scale', count: 5 },
      { materialId: 'mould-cap', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'offHand',
      rarity: 'uncommon',
      level: 50,
      templateId: 'bulwark',
      adjective: 'Ярусный',
    },
  },
  {
    id: 'forged-gauntlets',
    name: 'Серные рукавицы',
    icon: 'slot-hands',
    profession: 'smithing',
    unlockLevel: 60,
    inputs: [
      { materialId: 'terrace-slag', count: 5 },
      { materialId: 'sulfur-crust', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'hands',
      rarity: 'uncommon',
      level: 60,
      attribute: 'agility',
      adjective: 'Серный',
    },
  },
  {
    id: 'forged-charm',
    name: 'Перевальный оберег',
    icon: 'slot-trinket',
    profession: 'smithing',
    unlockLevel: 70,
    inputs: [
      { materialId: 'pass-flint', count: 5 },
      { materialId: 'wormwood-resin', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'trinket',
      rarity: 'uncommon',
      level: 70,
      attribute: 'agility',
      adjective: 'Перевальный',
    },
  },
  {
    id: 'forged-crown',
    name: 'Соляной венец',
    icon: 'slot-head',
    profession: 'smithing',
    unlockLevel: 80,
    inputs: [
      { materialId: 'emery-grit', count: 5 },
      { materialId: 'rime-salt', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'head',
      rarity: 'uncommon',
      level: 80,
      attribute: 'intellect',
      adjective: 'Соляной',
    },
  },
  {
    id: 'forged-carapace',
    name: 'Стылый панцирь',
    icon: 'slot-chest',
    profession: 'smithing',
    unlockLevel: 90,
    inputs: [
      { materialId: 'crookwood-knot', count: 5 },
      { materialId: 'hoar-quartz', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'chest',
      rarity: 'uncommon',
      level: 90,
      attribute: 'vitality',
      adjective: 'Стылый',
    },
  },
  {
    id: 'forged-cleaver',
    name: 'Падевый тесак',
    icon: 'slot-weapon',
    profession: 'smithing',
    unlockLevel: 100,
    inputs: [
      { materialId: 'bluff-obsidian', count: 5 },
      { materialId: 'dell-bloom', count: 3 },
    ],
    output: {
      kind: 'item',
      slot: 'mainHand',
      rarity: 'uncommon',
      level: 100,
      templateId: 'crusher',
      adjective: 'Падевый',
    },
  },

  // --- ПРОМЕЖУТОЧНЫЕ: ДВА ПЕРЕДЕЛА ВМЕСТО ОДНОГО ---
  //
  // С середины лестницы у каждой полосы есть свой передел: обычные реагенты
  // сплавляются в крицу или слиток, и уже он идёт в лучшую вещь полосы.
  // Смысл не в лишнем нажатии, а в том, что путь к лучшей вещи становится
  // ДЛИННЕЕ И ВИДНЕЕ: игрок заранее знает, сколько руды за ним стоит, и
  // копит осмысленно. Ниже середины передела нет намеренно — там ремесло
  // ещё учится, и второй шаг был бы налогом на новичка.
  {
    id: 'smelt-flood-billet',
    name: 'Ярусная крица',
    icon: 'reagent-flood-billet',
    profession: 'smithing',
    unlockLevel: 50,
    inputs: [
      { materialId: 'tier-scale', count: 6 },
      { materialId: 'mould-cap', count: 4 },
    ],
    output: { kind: 'reagent', id: 'flood-billet' },
  },
  {
    id: 'smelt-sulfur-billet',
    name: 'Серный слиток',
    icon: 'reagent-sulfur-billet',
    profession: 'smithing',
    unlockLevel: 60,
    inputs: [
      { materialId: 'terrace-slag', count: 6 },
      { materialId: 'sulfur-crust', count: 4 },
    ],
    output: { kind: 'reagent', id: 'sulfur-billet' },
  },
  {
    id: 'smelt-pass-billet',
    name: 'Перевальный слиток',
    icon: 'reagent-pass-billet',
    profession: 'smithing',
    unlockLevel: 70,
    inputs: [
      { materialId: 'pass-flint', count: 6 },
      { materialId: 'wormwood-resin', count: 4 },
    ],
    output: { kind: 'reagent', id: 'pass-billet' },
  },
  {
    id: 'smelt-salt-billet',
    name: 'Соляная крица',
    icon: 'reagent-salt-billet',
    profession: 'smithing',
    unlockLevel: 80,
    inputs: [
      { materialId: 'emery-grit', count: 6 },
      { materialId: 'rime-salt', count: 4 },
    ],
    output: { kind: 'reagent', id: 'salt-billet' },
  },
  {
    id: 'smelt-rime-billet',
    name: 'Стылый слиток',
    icon: 'reagent-rime-billet',
    profession: 'smithing',
    unlockLevel: 90,
    inputs: [
      { materialId: 'crookwood-knot', count: 6 },
      { materialId: 'hoar-quartz', count: 4 },
    ],
    output: { kind: 'reagent', id: 'rime-billet' },
  },
  {
    id: 'smelt-dell-billet',
    name: 'Падевая крица',
    icon: 'reagent-dell-billet',
    profession: 'smithing',
    unlockLevel: 100,
    inputs: [
      { materialId: 'bluff-obsidian', count: 6 },
      { materialId: 'dell-bloom', count: 4 },
    ],
    output: { kind: 'reagent', id: 'dell-billet' },
  },

  // --- ЛУЧШАЯ ВЕЩЬ ПОЛОСЫ: БЕЗ ПОДЗЕМЕЛЬЯ НЕ СОБРАТЬ ---
  //
  // Каждая просит БОССОВЫЙ реагент своей полосы, а с середины лестницы — ещё
  // и промежуточный. Это и есть гейт: сколько ни фарми зону, лучшую вещь
  // полосы она не даст. Редкость на ступень выше обычной вещи той же полосы,
  // и это по-прежнему «хорошая находка», а не сверх неё.
  {
    id: 'silt-greaves',
    name: 'Тинные поножи',
    icon: 'slot-legs',
    profession: 'smithing',
    unlockLevel: 20,
    inputs: [
      { materialId: 'reagent-silt-clot', count: 2 },
      { materialId: 'bog-hide', count: 6 },
    ],
    output: {
      kind: 'item',
      slot: 'legs',
      rarity: 'rare',
      level: 20,
      attribute: 'vitality',
      name: 'Тинные поножи',
    },
  },
  {
    id: 'sinter-gloves',
    name: 'Спёковые рукавицы',
    icon: 'slot-hands',
    profession: 'smithing',
    unlockLevel: 30,
    inputs: [
      { materialId: 'reagent-drift-sinter', count: 2 },
      { materialId: 'ember-shard', count: 6 },
    ],
    output: {
      kind: 'item',
      slot: 'hands',
      rarity: 'rare',
      level: 30,
      attribute: 'agility',
      name: 'Спёковые рукавицы',
    },
  },
  {
    id: 'sediment-charm',
    name: 'Осадочный оберег',
    icon: 'slot-trinket',
    profession: 'smithing',
    unlockLevel: 40,
    inputs: [
      { materialId: 'reagent-sediment-core', count: 2 },
      { materialId: 'shaft-iron', count: 6 },
    ],
    output: {
      kind: 'item',
      slot: 'trinket',
      rarity: 'rare',
      level: 40,
      attribute: 'intellect',
      name: 'Осадочный оберег',
    },
  },
  {
    id: 'growth-helm',
    name: 'Наростный шлем',
    icon: 'slot-head',
    profession: 'smithing',
    unlockLevel: 50,
    inputs: [
      { materialId: 'reagent-sulfur-growth', count: 2 },
      { materialId: 'flood-billet', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'head',
      rarity: 'rare',
      level: 50,
      attribute: 'strength',
      name: 'Наростный шлем',
    },
  },
  {
    id: 'windglass-mail',
    name: 'Ветровой панцирь',
    icon: 'slot-chest',
    profession: 'smithing',
    unlockLevel: 60,
    inputs: [
      { materialId: 'reagent-wind-glass', count: 2 },
      { materialId: 'sulfur-billet', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'chest',
      rarity: 'rare',
      level: 60,
      attribute: 'vitality',
      name: 'Ветровой панцирь',
    },
  },
  {
    id: 'brine-blade',
    name: 'Рассольный клинок',
    icon: 'slot-weapon',
    profession: 'smithing',
    unlockLevel: 70,
    inputs: [
      { materialId: 'reagent-brine-crystal', count: 2 },
      { materialId: 'pass-billet', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'mainHand',
      rarity: 'rare',
      level: 70,
      templateId: 'bastard',
      name: 'Рассольный клинок',
    },
  },
  {
    id: 'vein-bulwark',
    name: 'Жильный заслон',
    icon: 'slot-offhand',
    profession: 'smithing',
    unlockLevel: 80,
    inputs: [
      { materialId: 'reagent-rime-vein', count: 2 },
      { materialId: 'salt-billet', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'offHand',
      rarity: 'rare',
      level: 80,
      templateId: 'bulwark',
      name: 'Жильный заслон',
    },
  },
  {
    id: 'mute-gloves',
    name: 'Немые рукавицы',
    icon: 'slot-hands',
    profession: 'smithing',
    unlockLevel: 90,
    inputs: [
      { materialId: 'reagent-mute-shard', count: 2 },
      { materialId: 'rime-billet', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'hands',
      rarity: 'rare',
      level: 90,
      attribute: 'strength',
      name: 'Немые рукавицы',
    },
  },
  {
    id: 'votive-bulwark',
    name: 'Обетный заслон',
    icon: 'slot-offhand',
    profession: 'smithing',
    unlockLevel: 100,
    inputs: [
      { materialId: 'trial-token', count: 2 },
      { materialId: 'dell-billet', count: 2 },
    ],
    output: {
      kind: 'item',
      slot: 'offHand',
      rarity: 'rare',
      level: 100,
      templateId: 'bulwark',
      name: 'Обетный заслон',
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
  // Награда за ПОЛНУЮ зачистку храма. Открывается не рубежом волн, а флагом
  // зачистки (см. recipeUnlocked), и просит тот самый токен, который за
  // зачистку и выдан: рецепт нельзя собрать, не пройдя храм целиком.
  {
    id: 'trial-crown',
    name: 'Венец испытаний',
    icon: 'slot-head',
    profession: 'smithing',
    inputs: [
      { materialId: 'trial-token', count: 1 },
      { materialId: 'rime-salt', count: 12 },
    ],
    output: {
      kind: 'item',
      slot: 'head',
      rarity: 'legendary',
      level: 100,
      attribute: 'vitality',
      adjective: 'Венечный',
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
/**
 * УРОВЕНЬ ПРОФЕССИИ — ПОЛ ДЛЯ ВСЕХ ЕЁ РЕЦЕПТОВ. Раньше рецепт без своего
 * `unlockLevel` был открыт с первого уровня, и вся кузня с кулинарией
 * работали у героя, которому лестница открытий обещает ремёсла на
 * тридцатом. Обещание, которое игрок уже видел, — не обещание.
 *
 * Живёт таблицей в данных, а не условием в коде: новая профессия получает
 * свой порог строкой, и `Record<ProfessionId, …>` заставит про неё решить.
 */
export const PROFESSION_UNLOCK_LEVEL: Record<ProfessionId, number> = {
  cooking: CRAFT_UNLOCK_LEVEL,
  smithing: CRAFT_UNLOCK_LEVEL,
  // Реликварий — уникальные рецепты, у них свой порог и он выше.
  relics: UNIQUE_RECIPE_LEVEL,
  herbalism: POTION_UNLOCK_LEVEL,
}

/** Уровень доступа к рецепту: свой, если задан, иначе порог его профессии. */
export function recipeUnlockLevel(recipe: RecipeDef): number {
  return Math.max(recipe.unlockLevel ?? 1, PROFESSION_UNLOCK_LEVEL[recipe.profession])
}

/** Открыта ли профессия герою этого уровня. */
export function professionUnlocked(profession: ProfessionId, level: number): boolean {
  return level >= PROFESSION_UNLOCK_LEVEL[profession]
}

export function recipesOf(profession: ProfessionId): RecipeDef[] {
  return RECIPES.filter((r) => r.profession === profession)
}

export const FOOD_BY_ID: Record<string, FoodOutput> = Object.fromEntries(
  RECIPES.filter((r): r is RecipeDef & { output: FoodOutput } => r.output.kind === 'food').map(
    (r) => [r.output.id, r.output],
  ),
)


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



