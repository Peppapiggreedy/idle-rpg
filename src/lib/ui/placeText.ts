// ГДЕ ГЕРОЙ СЕЙЧАС — одной строкой над сценой.
//
// Зачем это вообще. Сцена показывает бой, полоски показывают числа, а
// НАЗВАНИЕ МЕСТА не показывал никто: игрок видел скелета на фоне камней и
// не знал, Пастуший это луг или Соляной провал. Заголовок отвечает на первый
// вопрос, который задают, посмотрев на экран.
//
// Строка собирается ИЗ ДАННЫХ места, и это главное правило файла. Новая зона
// в `data/zones.ts` обязана появиться в заголовке сама, без правки компонента,
// — ровно как новый данж или будущий рейд. Поэтому здесь нет ни одного
// `if (зона === '...')`: только чтение полей.
import { activeDungeon, currentZone } from '../game'
import { TEMPLE_BY_ID } from '../data/temple'
import type { GameState } from '../game'

export interface PlaceTitle {
  /** Название места: зоны, данжа, храма. */
  name: string
  /**
   * Уточнение справа от названия: полоса уровней у зоны, номер боя у данжа,
   * этаж у храма. Пусто — уточнять нечего.
   */
  detail: string
  /**
   * Как уточнение примыкает к названию. У зоны это полоса уровней и она
   * читается скобками — «Пастуший луг (1–5)»; у забега это место в цепочке
   * и оно читается продолжением фразы — «Курган Плача, бой 2 из 3».
   */
  join: 'parens' | 'comma'
}

/**
 * Заголовок текущего места.
 *
 * Порядок проверок — от самого узкого к самому широкому: забег важнее зоны,
 * потому что герой физически внутри него, а `currentZoneId` при этом
 * продолжает указывать на зону входа.
 */
export function placeTitle(state: GameState): PlaceTitle {
  const temple = state.templeRun ? TEMPLE_BY_ID[state.templeRun.templeId] : null
  if (temple && state.templeRun) {
    return { name: temple.name, detail: `этаж ${state.templeRun.wave}`, join: 'comma' }
  }

  const dungeon = activeDungeon(state)
  if (dungeon && state.dungeonRun) {
    const total = dungeon.bosses.length
    return {
      name: dungeon.name,
      detail: `бой ${state.dungeonRun.bossIndex + 1} из ${total}`,
      join: 'comma',
    }
  }

  const zone = currentZone(state)
  const { min, max } = zone.monsterLevelRange
  return { name: zone.name, detail: `${min}–${max}`, join: 'parens' }
}

/** Та же строка целиком — для подписи экрана для читалки и для тестов. */
export function placeTitleText(state: GameState): string {
  const { name, detail, join } = placeTitle(state)
  if (!detail) return name
  return join === 'parens' ? `${name} (${detail})` : `${name}, ${detail}`
}
