// Тиры редкости. ЕДИНСТВЕННОЕ место, где определены цвета и веса редкостей —
// UI и логика берут их только отсюда.
import { Decimal } from '../game/numbers'
import type { Rarity } from '../types'

export interface RarityDef {
  id: Rarity
  name: string
  // Вес рулетки дропа (служебное число генератора, не игровая величина).
  weight: number
  // Цвет тира для подсветки в UI.
  color: string
  // ВТОРОЕ кодирование тира — звук. Цвет требует смотреть на экран, а игра
  // идёт в фоне: тир должно быть слышно. Id кью из data/sounds.ts.
  sound: string
  // Показывать ли отдельную вспышку находки. Только верхние тиры: событие,
  // которое случается каждую минуту, событием быть перестаёт.
  reveal: boolean
  /**
   * Множитель прибавки к урону относительно базовой.
   *
   * ЛЕСТНИЦА ЗДЕСЬ ПОЛОГАЯ, И ЭТО ГЛАВНОЕ ЧИСЛО ЛУТА. Раньше она шла
   * удвоением (1-2-4-8-16), и это ломало всю игру, хотя ни один отдельный
   * тест не падал: эталонный герой прогона одет в СРЕДНЕЕ по рулетке (1.8),
   * а живой игрок за пять тысяч убийств собирает ЛУЧШЕЕ В КАЖДЫЙ СЛОТ, то
   * есть шестнадцать. Разрыв в девять раз не догоняет ничто: сила мобов
   * растёт линейно по уровню (MONSTER_GROWTH), сила вещи — линейно по её
   * уровню, а редкость сидит сверху множителем, которому в лестнице мобов
   * не отвечает ничего. Прогон полного пути показал ровно это: время
   * убийства падало с двадцати секунд на втором уровне до полутора на
   * сотом. Пологая лестница держит разрыв «лучшее против среднего» вдвое,
   * и коридор темпа переживает весь путь.
   *
   * Ценность редкости при этом никуда не делась — она уехала в sellMult
   * и в то, что верхние тиры дают ЛУЧШИЙ атрибут, а не больше урона.
   */
  bonusMult: Decimal
  // Множитель цены продажи относительно базовой.
  sellMult: Decimal
}

export const RARITIES: RarityDef[] = [
  { id: 'common',    name: 'Обычный',      weight: 100, color: '#9e9e9e', sound: 'loot-common',    reveal: false, bonusMult: new Decimal(1),    sellMult: new Decimal(1) },
  { id: 'uncommon',  name: 'Необычный',    weight: 40,  color: '#4caf50', sound: 'loot-uncommon',  reveal: false, bonusMult: new Decimal(1.25), sellMult: new Decimal(2) },
  { id: 'rare',      name: 'Редкий',       weight: 15,  color: '#2196f3', sound: 'loot-rare',      reveal: false, bonusMult: new Decimal(1.55), sellMult: new Decimal(5) },
  { id: 'epic',      name: 'Эпический',    weight: 4,   color: '#9c27b0', sound: 'loot-epic',      reveal: true,  bonusMult: new Decimal(1.9),  sellMult: new Decimal(12) },
  { id: 'legendary', name: 'Легендарный',  weight: 1,   color: '#ff9800', sound: 'loot-legendary', reveal: true,  bonusMult: new Decimal(2.3),  sellMult: new Decimal(30) },
]

export const RARITY_BY_ID = Object.fromEntries(RARITIES.map((r) => [r.id, r])) as Record<
  Rarity,
  RarityDef
>

/**
 * Ожидаемая прибавка предмета по рулетке дропа: Σ(вес × bonusMult) / Σвес.
 *
 * Это и есть «средняя экипировка» — не выбранный руками тир, а то, что
 * рулетка выдаёт в среднем. Считается ИЗ ТЕХ ЖЕ весов, по которым падает
 * лут: поправишь веса — среднее поедет следом, и контракт темпа это увидит.
 */
export const EXPECTED_BONUS_MULT: Decimal = RARITIES.reduce(
  (sum, r) => sum.plus(r.bonusMult.times(r.weight)),
  new Decimal(0),
).div(RARITIES.reduce((sum, r) => sum + r.weight, 0))

/**
 * Синтетический тир «средний предмет». Настоящим тиром не является и в лут
 * не попадает: он нужен эталонным сборкам прогона, чтобы «герой в средней
 * экипировке» был ОДНОЙ воспроизводимой кривой, а не разбросом от обычного
 * до легендарного.
 */
export const AVERAGE_RARITY: RarityDef = {
  ...RARITIES[0],
  bonusMult: EXPECTED_BONUS_MULT,
}

/**
 * Сколько находок В ОДИН СЛОТ игрок видит, пока идёт по своей полосе уровней.
 *
 * Оценка сверху вниз, из чисел самой игры: полоса — это пять уровней, уровень
 * стоит несколько десятков убийств (`KILLS_PER_LEVEL`), с четверти убийств
 * падает предмет (`DROP_CHANCE`), а слотов семь. Получается около десятка
 * находок в каждый слот — и НАДЕВАЕТ игрок из них лучшую, а не среднюю.
 */
export const DROPS_PER_SLOT_PER_BAND = 9

/**
 * Ожидаемая прибавка ЛУЧШЕЙ из `DROPS_PER_SLOT_PER_BAND` находок.
 *
 * ЗАЧЕМ ОТДЕЛЬНОЕ ЧИСЛО. «Средняя экипировка» из одного броска (`AVERAGE_RARITY`)
 * описывает не игрока, а первую попавшуюся вещь: живой игрок за полосу видит
 * десяток находок в слот и носит ЛУЧШУЮ. Разница между «одним броском» и
 * «лучшим из десяти» — это ровно то, из-за чего прогон полного пути и таблица
 * темпа мерили разных героев, и коридор темпа держался только на бумаге.
 *
 * Считается по тем же весам, что и лут: P(max ≤ тир) = (доля тиров не выше)^N,
 * дальше разность соседних — вероятность, что лучшая находка ровно этого тира.
 */
export const TYPICAL_BONUS_MULT: Decimal = (() => {
  const total = RARITIES.reduce((sum, r) => sum + r.weight, 0)
  let below = 0
  let previous = 0
  let expected = new Decimal(0)
  for (const rarity of RARITIES) {
    below += rarity.weight
    const atMost = Math.pow(below / total, DROPS_PER_SLOT_PER_BAND)
    expected = expected.plus(rarity.bonusMult.times(atMost - previous))
    previous = atMost
  }
  return expected
})()

/**
 * Синтетический тир «во что игрок ОБЫЧНО одет». Им одевается эталонный герой
 * прогона: контракт темпа обязан описывать того, кто играет, а не того, кому
 * достался ровно средний бросок.
 */
export const TYPICAL_RARITY: RarityDef = {
  ...RARITIES[0],
  bonusMult: TYPICAL_BONUS_MULT,
}
