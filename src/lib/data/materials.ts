// Материалы профессий — данные. Отдельный от лута пул: они падают своим
// броском и в свою сумку, поэтому не конкурируют с предметами за место и не
// сдвигают шансы редкости.
//
// Привязка к зонам — часть контента, а не украшение: материал из дальней
// зоны нужен рецептам, которые в ней и осмысленны. Ссылки «материал → зона»
// проверяет content:check.
import type { IconName } from '../ui/icons/manifest'

export interface MaterialDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Зоны, где материал падает. Пустой список означал бы недостижимый контент. */
  zoneIds: string[]
  /** Вес в рулетке материалов внутри зоны. */
  weight: number
}

export const MATERIALS: MaterialDef[] = [
  {
    id: 'meadow-herb',
    name: 'Луговой сбор',
    icon: 'material-herb',
    zoneIds: ['shepherds-meadow', 'hollow-quarry', 'rusted-furrows'],
    weight: 10,
  },
  {
    id: 'lean-meat',
    name: 'Постное мясо',
    icon: 'material-meat',
    zoneIds: ['shepherds-meadow', 'mirefen-hollows', 'flooded-tier'],
    weight: 10,
  },
  {
    id: 'quarry-ore',
    name: 'Каменоломная руда',
    icon: 'material-ore',
    zoneIds: ['hollow-quarry', 'rusted-furrows', 'mine-collapse'],
    weight: 8,
  },
  {
    id: 'bog-hide',
    name: 'Топкая шкура',
    icon: 'material-hide',
    zoneIds: ['mirefen-hollows', 'glasswaste', 'flooded-tier'],
    weight: 8,
  },
  {
    id: 'ember-shard',
    name: 'Тлеющий осколок',
    icon: 'material-shard',
    zoneIds: ['glasswaste', 'ashen-ridge', 'ashen-terrace'],
    weight: 6,
  },
  {
    id: 'rime-salt',
    name: 'Стылая соль',
    icon: 'material-salt',
    zoneIds: ['salt-pit', 'rimeback-ridge', 'ashen-terrace'],
    weight: 5,
  },
]

export const MATERIAL_BY_ID: Record<string, MaterialDef> = Object.fromEntries(
  MATERIALS.map((m) => [m.id, m]),
)

/** Материалы, которые падают в этой зоне. Пусто — зона без материалов. */
export function materialsInZone(zoneId: string): MaterialDef[] {
  return MATERIALS.filter((m) => m.zoneIds.includes(zoneId))
}
