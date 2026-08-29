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

export interface ReagentDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Тир данжа, чей последний босс его роняет. Уникален и совпадает с тиром. */
  tier: number
}

// По одному на данж, по возрастанию тира. Порядок здесь — порядок игры.
export const REAGENTS: ReagentDef[] = [
  { id: 'reagent-silt-clot', name: 'Тинный сгусток', icon: 'reagent-silt-clot', tier: 1 },
  { id: 'reagent-drift-sinter', name: 'Штольневый спёк', icon: 'reagent-drift-sinter', tier: 2 },
  { id: 'reagent-sediment-core', name: 'Осадочное ядро', icon: 'reagent-sediment-core', tier: 3 },
  { id: 'reagent-sulfur-growth', name: 'Серный нарост', icon: 'reagent-sulfur-growth', tier: 4 },
  { id: 'reagent-wind-glass', name: 'Ветровое стекло', icon: 'reagent-wind-glass', tier: 5 },
  { id: 'reagent-brine-crystal', name: 'Рассольный кристалл', icon: 'reagent-brine-crystal', tier: 6 },
  { id: 'reagent-rime-vein', name: 'Стылая жила', icon: 'reagent-rime-vein', tier: 7 },
  { id: 'reagent-mute-shard', name: 'Немой обломок', icon: 'reagent-mute-shard', tier: 8 },
]

export const REAGENT_BY_ID: Record<string, ReagentDef> = Object.fromEntries(
  REAGENTS.map((r) => [r.id, r]),
)

/** Реагент тира; нет такого тира — null, и это ошибка целостности, не игры. */
export function reagentOfTier(tier: number): ReagentDef | null {
  return REAGENTS.find((r) => r.tier === tier) ?? null
}
