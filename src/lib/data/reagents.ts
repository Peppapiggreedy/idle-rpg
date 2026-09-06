// РЕАГЕНТЫ — ВСЁ, ЧТО ЛОЖИТСЯ В МЕШОК И ИДЁТ В РЕЦЕПТ.
//
// Раньше их было два разных типа в двух файлах: «материал» падал в зонах по
// рулетке весов, «реагент» ронял последний босс данжа. Разница настоящая, но
// она в ИСТОЧНИКЕ, а не в сущности: в мешке они лежат вместе, в рецепте
// стоят рядом, на полке ремесла показываются одной сеткой. Два типа означали
// две схемы, две проверки целостности и два места, куда смотреть, — поэтому
// тип теперь ОДИН, а источник назван полем `role`.
//
// ТРИ РОЛИ, И РОЛЬ — ПОЛЕ В ДАННЫХ, А НЕ ДОГАДКА ПО НАЗВАНИЮ:
//
//   `common`  — падает с мобов зон СВОЕЙ ПОЛОСЫ. Часто, дёшево, основа
//               рецепта. Вес рулетки сравнивается только внутри полосы.
//   `boss`    — падает ТОЛЬКО с боссов подземелий и за храм. Редко. Это
//               гейт лучшей вещи полосы: без подземелья её не собрать,
//               сколько ни фарми зону.
//   `crafted` — не выпадает ВООБЩЕ, собирается из обычных отдельным
//               рецептом. Два передела вместо одного.
//
// У КАЖДОГО РЕАГЕНТА РОВНО ОДНА ПОЛОСА (`band`), и общий реагент выпадает
// только в её зонах. До этого материал был приписан к списку зон вручную:
// каменоломная руда падала в пяти зонах с шестого уровня по восьмидесятый,
// стылая соль — в четырёх через всю карту. Снаружи это читалось как «дропы
// разбросаны хаотично», и починить перетасовкой списков нельзя — списки и
// были болезнью. Полоса решает это по построению: у реагента одно место в
// мире, и оно видно в данных одним словом.
//
// Полосы берутся ТЕ ЖЕ, что расчерчены для фонов сцены (`data/bands.ts`).
// Второй разметки уровней в игре быть не должно.
//
// ПРО МЕШОК. Реагенты лежат в `state.materials` — ключ сейва, который старше
// этого файла. Переименовывать его значило бы завести миграцию ради слова;
// поле входа рецепта по той же причине осталось `materialId`. Граница
// осознанная: «реагент» — это СУЩНОСТЬ, `materials` — место, где считаются
// её штуки.
import type { IconName } from '../ui/icons/manifest'
import type { BandId } from './bands'
import { BAND_IDS, bandById, bandDepth } from './bands'
import type { DungeonDifficulty } from './dungeons'

export type ReagentRole = 'common' | 'boss' | 'crafted'

/** Откуда падает боссовый реагент. Ролям `common` и `crafted` не положен. */
export type ReagentSource =
  | { kind: 'dungeon'; tier: number; difficulty: DungeonDifficulty }
  | { kind: 'temple-clear' }

export interface ReagentDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  role: ReagentRole
  /** Ровно одна полоса уровней. Для `common` — где падает; для `boss` —
   *  полоса подземелья; для `crafted` — где осмысленны рецепты с ним. */
  band: BandId
  /** Вес в рулетке своей полосы. Только у `common`, и только у него. */
  weight?: number
  /** Только у `boss`: какой именно босс роняет. */
  source?: ReagentSource
}

// ---------------------------------------------------------------------------
// Обычные: по два-три на полосу, и хотя бы один на каждой
// ---------------------------------------------------------------------------
//
// Шесть первых id — прежние материалы зон. Полоса каждому досталась ТА, где
// он мельче всего падал и раньше: `recipeLevel` считает вход по мельчайшей
// зоне, где он есть, и смена полосы сдвинула бы цену рецептов, которых эта
// стадия не касается. Совпадение проверено по каждому: луговой сбор и
// постное мясо начинались на Пастушьем лугу, руда — в Полой каменоломне,
// шкура — в Топких лощинах, осколок — в Стеклянной пустоши, соль — в
// Соляном провале.
const COMMON: ReagentDef[] = [
  // --- Полоса 1-10 ---
  { id: 'meadow-herb', name: 'Луговой сбор', icon: 'material-herb', role: 'common', band: 'meadow', weight: 10 },
  { id: 'lean-meat', name: 'Постное мясо', icon: 'material-meat', role: 'common', band: 'meadow', weight: 10 },
  { id: 'quarry-ore', name: 'Каменоломная руда', icon: 'material-ore', role: 'common', band: 'meadow', weight: 8 },

  // --- Полоса 11-20 ---
  { id: 'bog-hide', name: 'Топкая шкура', icon: 'material-hide', role: 'common', band: 'furrows', weight: 10 },
  { id: 'furrow-rust', name: 'Бороздовая ржавь', icon: 'reagent-furrow-rust', role: 'common', band: 'furrows', weight: 6 },

  // --- Полоса 21-30 ---
  { id: 'ember-shard', name: 'Тлеющий осколок', icon: 'material-shard', role: 'common', band: 'glass', weight: 10 },
  { id: 'glass-sliver', name: 'Стеклянная заноза', icon: 'reagent-glass-sliver', role: 'common', band: 'glass', weight: 6 },

  // --- Полоса 31-40 ---
  { id: 'shaft-iron', name: 'Штольневое железо', icon: 'reagent-shaft-iron', role: 'common', band: 'mines', weight: 10 },
  { id: 'root-fibre', name: 'Корневое волокно', icon: 'reagent-root-fibre', role: 'common', band: 'mines', weight: 6 },

  // --- Полоса 41-50 ---
  { id: 'tier-scale', name: 'Ярусная чешуя', icon: 'reagent-tier-scale', role: 'common', band: 'flood', weight: 10 },
  { id: 'mould-cap', name: 'Плесневая шляпка', icon: 'reagent-mould-cap', role: 'common', band: 'flood', weight: 6 },

  // --- Полоса 51-60 ---
  { id: 'sulfur-crust', name: 'Серная корка', icon: 'reagent-sulfur-crust', role: 'common', band: 'sulfur', weight: 10 },
  { id: 'terrace-slag', name: 'Террасный шлак', icon: 'reagent-terrace-slag', role: 'common', band: 'sulfur', weight: 6 },

  // --- Полоса 61-70 ---
  { id: 'pass-flint', name: 'Перевальный кремень', icon: 'reagent-pass-flint', role: 'common', band: 'pass', weight: 10 },
  { id: 'wormwood-resin', name: 'Полынная смолка', icon: 'reagent-wormwood-resin', role: 'common', band: 'pass', weight: 6 },

  // --- Полоса 71-80 ---
  { id: 'rime-salt', name: 'Стылая соль', icon: 'material-salt', role: 'common', band: 'salt', weight: 10 },
  { id: 'emery-grit', name: 'Наждачная крупа', icon: 'reagent-emery-grit', role: 'common', band: 'salt', weight: 6 },

  // --- Полоса 81-90 ---
  { id: 'crookwood-knot', name: 'Криволесный узел', icon: 'reagent-crookwood-knot', role: 'common', band: 'rime', weight: 10 },
  { id: 'hoar-quartz', name: 'Инеевый кварц', icon: 'reagent-hoar-quartz', role: 'common', band: 'rime', weight: 6 },

  // --- Полоса 91-100 ---
  { id: 'dell-bloom', name: 'Падевый налёт', icon: 'reagent-dell-bloom', role: 'common', band: 'dell', weight: 10 },
  { id: 'bluff-obsidian', name: 'Кручёный обсидиан', icon: 'reagent-bluff-obsidian', role: 'common', band: 'dell', weight: 6 },
]

// ---------------------------------------------------------------------------
// Боссовые: по одному на подземелье каждой сложности плюс храм
// ---------------------------------------------------------------------------
//
// ПОЛОСА БОССОВОГО РЕАГЕНТА ВЫВЕДЕНА ИЗ ЛЕСТНИЦЫ, А НЕ НАЗНАЧЕНА. Подземелье
// тира T стоит наверху полосы T+1: первое (Затонувший курган) — в Топких
// лощинах, 16-20, полоса `furrows`; восьмое — в Мёрзлом криволесье, 86-90,
// полоса `rime`. Отсюда таблица ниже: тир 1 → вторая полоса, тир 8 → девятая.
//
// Первая полоса боссового реагента не имеет вовсе: подземелий там ещё нет.
// Десятая получает его от ХРАМА — по правилу «боссовый падает с боссов
// подземелий и за храм», и другого источника у неё быть не может: за храмом
// в игре ничего нет.
const BOSS_BAND_BY_TIER: Record<number, BandId> = {
  1: 'furrows',
  2: 'glass',
  3: 'mines',
  4: 'flood',
  5: 'sulfur',
  6: 'pass',
  7: 'salt',
  8: 'rime',
}

function boss(
  id: string,
  name: string,
  icon: IconName,
  tier: number,
  difficulty: DungeonDifficulty,
): ReagentDef {
  return { id, name, icon, role: 'boss', band: BOSS_BAND_BY_TIER[tier], source: { kind: 'dungeon', tier, difficulty } }
}

const BOSS: ReagentDef[] = [
  // --- Обычные подземелья: по одному на тир ---
  boss('reagent-silt-clot', 'Тинный сгусток', 'reagent-silt-clot', 1, 'normal'),
  boss('reagent-drift-sinter', 'Штольневый спёк', 'reagent-drift-sinter', 2, 'normal'),
  boss('reagent-sediment-core', 'Осадочное ядро', 'reagent-sediment-core', 3, 'normal'),
  boss('reagent-sulfur-growth', 'Серный нарост', 'reagent-sulfur-growth', 4, 'normal'),
  boss('reagent-wind-glass', 'Ветровое стекло', 'reagent-wind-glass', 5, 'normal'),
  boss('reagent-brine-crystal', 'Рассольный кристалл', 'reagent-brine-crystal', 6, 'normal'),
  boss('reagent-rime-vein', 'Стылая жила', 'reagent-rime-vein', 7, 'normal'),
  boss('reagent-mute-shard', 'Немой обломок', 'reagent-mute-shard', 8, 'normal'),

  // --- Героические: тоже по одному на тир, и только они открывают
  // легендарные рецепты. Ходить приходится во все восемь героик, а не в
  // самую выгодную: рецепт просит конкретный реагент, а не «любой». ---
  boss('reagent-drowned-whorl', 'Утопшая завитень', 'reagent-drowned-whorl', 1, 'heroic'),
  boss('reagent-drift-charge', 'Штольневый запал', 'reagent-drift-charge', 2, 'heroic'),
  boss('reagent-bottom-tear', 'Донная слеза', 'reagent-bottom-tear', 3, 'heroic'),
  boss('reagent-seething-coal', 'Кипящий уголь', 'reagent-seething-coal', 4, 'heroic'),
  boss('reagent-booming-whirl', 'Гулкий вихрь', 'reagent-booming-whirl', 5, 'heroic'),
  boss('reagent-brine-druse', 'Рассольная друза', 'reagent-brine-druse', 6, 'heroic'),
  boss('reagent-rime-core', 'Стылое ядро', 'reagent-rime-core', 7, 'heroic'),
  boss('reagent-mute-stone', 'Немой камень', 'reagent-mute-stone', 8, 'heroic'),

  // --- Храм: единственный источник верхней полосы ---
  // Обетный знак был «материалом с наградой вместо зоны» — исключением,
  // которое проверка достижимости обходила отдельным полем `award`. Роль
  // `boss` описывает его точнее: он и есть отметка о том, что закрытый
  // контент пройден до конца, только контент здесь не подземелье, а храм.
  {
    id: 'trial-token',
    name: 'Обетный знак',
    icon: 'temple-wave',
    role: 'boss',
    band: 'dell',
    source: { kind: 'temple-clear' },
  },
]

export const REAGENTS: ReagentDef[] = [...COMMON, ...BOSS]

export const REAGENT_BY_ID: Record<string, ReagentDef> = Object.fromEntries(
  REAGENTS.map((r) => [r.id, r]),
)

/** Реагент тира и сложности; нет такого — ошибка целостности, не игры. */
export function reagentOf(tier: number, difficulty: DungeonDifficulty): ReagentDef | null {
  return (
    REAGENTS.find(
      (r) =>
        r.source?.kind === 'dungeon' &&
        r.source.tier === tier &&
        r.source.difficulty === difficulty,
    ) ?? null
  )
}

/**
 * Обычные реагенты полосы — тот самый пул, из которого моб роняет добычу.
 * Порядок совпадает с порядком в списке: рулетка детерминирована.
 *
 * СЧИТАЕТСЯ ОДИН РАЗ НА ЗАГРУЗКЕ, а не на каждый бросок. Это не
 * преждевременная оптимизация: пул спрашивают НА КАЖДОЕ УБИЙСТВО, и фильтр
 * по всему списку реагентов создавал бы там новый массив тридцать восемь раз
 * подряд. Прежний код фильтровал семь материалов и был незаметен; после
 * переезда на полосы список вырос впятеро, и тик стал заметно дороже —
 * контрактный тест «оффлайн не выгоднее живой игры» начал падать ПО СРОКУ.
 */
const COMMON_BY_BAND: Record<BandId, ReagentDef[]> = Object.fromEntries(
  BAND_IDS.map((band) => [band, REAGENTS.filter((r) => r.role === 'common' && r.band === band)]),
) as Record<BandId, ReagentDef[]>

export function commonReagentsInBand(band: BandId): ReagentDef[] {
  return COMMON_BY_BAND[band] ?? []
}

/**
 * Зоны, где реагент падает. У обычного — обе зоны его полосы; у боссового и
 * промежуточного зон нет вовсе, и это не дырка, а их определение.
 *
 * Функция нужна `recipeLevel`: цена рецепта считается по тому, насколько
 * глубоко надо зайти за самым труднодоступным входом.
 */
export function reagentBandLevels(id: string): { min: number; max: number } | null {
  const reagent = REAGENT_BY_ID[id]
  if (!reagent || reagent.role !== 'common') return null
  const band = bandById(reagent.band)
  return { min: band.minLevel, max: band.maxLevel }
}

/** Глубина полосы реагента; нет такого реагента — null. */
export function reagentDepth(id: string): number | null {
  const reagent = REAGENT_BY_ID[id]
  return reagent ? bandDepth(reagent.band) : null
}
