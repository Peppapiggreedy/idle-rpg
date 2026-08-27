// Загрузка пресета состояния для съёмки скриншотов: ?debug=1&state=<имя>.
// Пресеты — обычные сейвы из src/lib/game/__fixtures__/presets, поэтому
// читаются той же цепочкой миграций и тем же stateFromPayload, что и живой
// сейв игрока. Отдельного пути загрузки у режима съёмки нет.
import { migrateSave, stateFromPayload } from '../game/save'
import { applyScreenshotState } from '../stores/game'

// Vite соберёт каждый пресет в отдельный чанк: в основной бандл игры они
// не попадают и грузятся только когда в адресе есть ?state=.
const PRESETS = import.meta.glob('../game/__fixtures__/presets/*.json')

/**
 * Ставит пресет в стор. Возвращает false, если такого пресета нет — тогда
 * вызывающий запускает обычную игру, а не показывает пустой экран.
 */
export async function loadPreset(name: string): Promise<boolean> {
  const key = `../game/__fixtures__/presets/${name}.json`
  const load = PRESETS[key]
  if (!load) return false
  const raw = ((await load()) as { default: unknown }).default
  const payload = migrateSave(raw)
  if (!payload) return false
  applyScreenshotState(stateFromPayload(payload))
  return true
}
