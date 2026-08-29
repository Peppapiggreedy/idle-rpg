// Реагенты данжей — данные. Отдельный от материалов зон тип, и это не
// формальность: материал ПАДАЕТ В ЗОНЕ по рулетке весов, а реагент роняет
// ГАРАНТИРОВАННО последний босс своего данжа. У них разные источники, разные
// проверки целостности («материал без зоны недостижим» реагенту прямо вредна)
// и разный смысл для игрока: материал — расходник, реагент — отметка о том,
// что цепочка боссов пройдена до конца.
//
// Лежат реагенты в ТОМ ЖЕ мешке материалов (state.materials): второй мешок
// был бы вторым местом, куда надо смотреть, и вторым набором правил сейва.
import type { IconName } from '../ui/icons/manifest'
import type { DungeonDifficulty } from './dungeons'

export interface ReagentDef {
  id: string
  name: string
  icon: IconName
  /** Тир данжа, чей последний босс его роняет. */
  tier: number
  /** С какой сложности он падает. Пара (тир, сложность) уникальна: героика
   *  роняет СВОЙ реагент, иначе она не отличалась бы от обычной версии
   *  ничем, кроме чисел, и ходить в неё было бы незачем. */
  difficulty: DungeonDifficulty
}

export const REAGENTS: ReagentDef[] = [
  // --- Обычные: по одному на тир ---
  { id: 'reagent-silt-clot', name: 'Тинный сгусток', icon: 'reagent-silt-clot', tier: 1, difficulty: 'normal' },
  { id: 'reagent-drift-sinter', name: 'Штольневый спёк', icon: 'reagent-drift-sinter', tier: 2, difficulty: 'normal' },
  { id: 'reagent-sediment-core', name: 'Осадочное ядро', icon: 'reagent-sediment-core', tier: 3, difficulty: 'normal' },
  { id: 'reagent-sulfur-growth', name: 'Серный нарост', icon: 'reagent-sulfur-growth', tier: 4, difficulty: 'normal' },
  { id: 'reagent-wind-glass', name: 'Ветровое стекло', icon: 'reagent-wind-glass', tier: 5, difficulty: 'normal' },
  { id: 'reagent-brine-crystal', name: 'Рассольный кристалл', icon: 'reagent-brine-crystal', tier: 6, difficulty: 'normal' },
  { id: 'reagent-rime-vein', name: 'Стылая жила', icon: 'reagent-rime-vein', tier: 7, difficulty: 'normal' },
  { id: 'reagent-mute-shard', name: 'Немой обломок', icon: 'reagent-mute-shard', tier: 8, difficulty: 'normal' },

  // --- Героические: тоже по одному на тир, и только они открывают
  // легендарные рецепты. Ходить приходится во все восемь героик, а не в
  // самую выгодную: рецепт просит конкретный реагент, а не «любой». ---
  { id: 'reagent-drowned-whorl', name: 'Утопшая завитень', icon: 'reagent-drowned-whorl', tier: 1, difficulty: 'heroic' },
  { id: 'reagent-drift-charge', name: 'Штольневый запал', icon: 'reagent-drift-charge', tier: 2, difficulty: 'heroic' },
  { id: 'reagent-bottom-tear', name: 'Донная слеза', icon: 'reagent-bottom-tear', tier: 3, difficulty: 'heroic' },
  { id: 'reagent-seething-coal', name: 'Кипящий уголь', icon: 'reagent-seething-coal', tier: 4, difficulty: 'heroic' },
  { id: 'reagent-booming-whirl', name: 'Гулкий вихрь', icon: 'reagent-booming-whirl', tier: 5, difficulty: 'heroic' },
  { id: 'reagent-brine-druse', name: 'Рассольная друза', icon: 'reagent-brine-druse', tier: 6, difficulty: 'heroic' },
  { id: 'reagent-rime-core', name: 'Стылое ядро', icon: 'reagent-rime-core', tier: 7, difficulty: 'heroic' },
  { id: 'reagent-mute-stone', name: 'Немой камень', icon: 'reagent-mute-stone', tier: 8, difficulty: 'heroic' },
]

export const REAGENT_BY_ID: Record<string, ReagentDef> = Object.fromEntries(
  REAGENTS.map((r) => [r.id, r]),
)

/** Реагент тира и сложности; нет такого — ошибка целостности, не игры. */
export function reagentOf(tier: number, difficulty: DungeonDifficulty): ReagentDef | null {
  return REAGENTS.find((r) => r.tier === tier && r.difficulty === difficulty) ?? null
}

/** Старое имя оставлено ради вызовов, которым сложность не важна. */
export function reagentOfTier(tier: number): ReagentDef | null {
  return reagentOf(tier, 'normal')
}

