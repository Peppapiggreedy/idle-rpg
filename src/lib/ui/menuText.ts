// Подписи и иконки семи меню. Весь текст для игрока живёт в ui/, поэтому
// здесь, а не в сторе: стор знает только идентификаторы и стороны.
import type { MenuId } from '../stores/ui'
import type { IconName } from './icons/manifest'

export interface MenuLook {
  title: string
  icon: IconName
}

export const MENU_LOOK: Record<MenuId, MenuLook> = {
  hero: { title: 'Герой', icon: 'stat-strength' },
  bag: { title: 'Сумка', icon: 'slot-chest' },
  world: { title: 'Мир', icon: 'zone-shepherds-meadow' },
  talents: { title: 'Таланты', icon: 'talent-honed-edge' },
  craft: { title: 'Крафт', icon: 'profession-smithing' },
  log: { title: 'Журнал', icon: 'log' },
  settings: { title: 'Настройки', icon: 'stat-swingTime' },
  autocast: { title: 'Автокаст', icon: 'autocast-on' },
}
