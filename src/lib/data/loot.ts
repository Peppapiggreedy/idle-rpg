// Шаблоны генерации предметов. Все названия оригинальные; существительные
// нарочно мужского рода, чтобы прилагательные согласовывались без склонений.
import { Decimal } from '../game/numbers'

export const LOOT_ADJECTIVES = [
  'Щербатый',
  'Ржавый',
  'Пастуший',
  'Закалённый',
  'Гремящий',
  'Сумрачный',
  'Звёздный',
  'Верный',
] as const

export const LOOT_NOUNS = [
  'Клинок',
  'Тесак',
  'Молот',
  'Серп',
  'Посох',
  'Палаш',
  'Кастет',
  'Бердыш',
] as const

// Шанс, что с убитого моба выпадет предмет.
export const DROP_CHANCE = 0.25
// Базовая прибавка к урону предмета common-тира; тиры множат её на bonusMult.
export const ITEM_BASE_BONUS = new Decimal(1)
// Базовая цена продажи common-предмета; тиры множат её на sellMult.
export const ITEM_BASE_SELL_PRICE = new Decimal(5)
