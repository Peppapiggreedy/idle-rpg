// Материалы профессий — данные. Отдельный от лута пул: они падают своим
// броском и в свою сумку, поэтому не конкурируют с предметами за место и не
// сдвигают шансы редкости.
//
// Привязка к зонам — часть контента, а не украшение: материал из дальней
// зоны нужен рецептам, которые в ней и осмысленны. Ссылки «материал → зона»
// проверяет content:check — вместе с тем, что ни одна зона не осталась без
// материалов вовсе: зона, где ничего не падает, выглядит сломанной.
import type { IconName } from '../ui/icons/manifest'

export interface MaterialDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Зоны, где материал падает. Пустой список — только если задан `award`. */
  zoneIds: string[]
  /** Вес в рулетке материалов внутри зоны. Ноль — только если задан `award`. */
  weight: number
  /**
   * НАГРАДА, А НЕ ДОБЫЧА. Материал бывает двух происхождений: падает в зонах
   * (zoneIds + weight) либо выдаётся за достижение. Без этого поля проверка
   * достижимости требовала бы зону — и была бы права: материал ниоткуда это
   * мёртвый рецепт. Поле называет ВТОРОЙ законный источник, а не отключает
   * проверку: она просто спрашивает про него.
   */
  award?: 'temple-clear'
}

export const MATERIALS: MaterialDef[] = [
  // Токен полной зачистки храма: в зонах не падает и падать не должен.
  // Ждёт преквеста рейда — до тех пор просто лежит в мешке отметкой о том,
  // что храм пройден целиком.
  {
    id: 'trial-token',
    name: 'Обетный знак',
    icon: 'temple-wave',
    zoneIds: [],
    weight: 0,
    award: 'temple-clear',
  },
  {
    id: 'meadow-herb',
    name: 'Луговой сбор',
    icon: 'material-herb',
    zoneIds: ['shepherds-meadow', 'hollow-quarry', 'rusted-furrows', 'wormwood-rise'],
    weight: 10,
  },
  {
    id: 'lean-meat',
    name: 'Постное мясо',
    icon: 'material-meat',
    zoneIds: ['shepherds-meadow', 'mirefen-hollows', 'flooded-tier', 'root-vaults'],
    weight: 10,
  },
  {
    id: 'quarry-ore',
    name: 'Каменоломная руда',
    icon: 'material-ore',
    zoneIds: ['hollow-quarry', 'rusted-furrows', 'mine-collapse', 'windswept-pass', 'emery-stack'],
    weight: 8,
  },
  {
    id: 'bog-hide',
    name: 'Топкая шкура',
    icon: 'material-hide',
    zoneIds: ['mirefen-hollows', 'glasswaste', 'flooded-tier', 'mold-horizon', 'hollow-dell'],
    weight: 8,
  },
  {
    id: 'ember-shard',
    name: 'Тлеющий осколок',
    icon: 'material-shard',
    zoneIds: ['glasswaste', 'ashen-ridge', 'ashen-terrace', 'sulfur-springs', 'mute-bluff'],
    weight: 6,
  },
  {
    id: 'rime-salt',
    name: 'Стылая соль',
    icon: 'material-salt',
    zoneIds: ['salt-pit', 'rimeback-ridge', 'ashen-terrace', 'frozen-crookwood'],
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
