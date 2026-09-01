// Маршруты страницы. Их три: сама игра и две отладочные — прогон баланса
// и витрина примитивов. Полноценный роутер под такое заводить незачем.

/** Отладочные страницы; ключ — сегмент адреса. */
export type DebugRoute = 'balance' | 'ui'

const DEBUG_ROUTES: DebugRoute[] = ['balance', 'ui']

/**
 * Какая отладочная страница открыта; null — обычная игра.
 * Требуется ?debug=1 — без него отладочных страниц не существует.
 * Понимаем два адреса: чистый путь `/idle-rpg/ui?debug=1` (его отдаёт
 * GitHub Pages через 404.html, см. vite.config.ts) и хеш `?debug=1#/ui`,
 * который работает вообще на любом статическом хостинге.
 */
export function debugRoute(location: Location = window.location): DebugRoute | null {
  if (new URLSearchParams(location.search).get('debug') !== '1') return null
  const path = location.pathname.replace(/\/+$/, '')
  const hash = location.hash.replace(/\/+$/, '')
  return (
    DEBUG_ROUTES.find((route) => path.endsWith(`/${route}`) || hash === `#/${route}`) ?? null
  )
}

/** Совместимость с прежним вызовом: открыт ли прогон баланса. */
export function isBalanceRoute(location: Location = window.location): boolean {
  return debugRoute(location) === 'balance'
}

/**
 * Имя пресета состояния для съёмки скриншотов; null — обычная игра.
 * Требует ?debug=1: подсунуть постороннему игроку чужое состояние по ссылке
 * нельзя. Имя ограничено строгим набором символов — оно идёт в путь импорта.
 */
export function presetName(location: Location = window.location): string | null {
  const params = new URLSearchParams(location.search)
  if (params.get('debug') !== '1') return null
  const name = params.get('state')
  return name && /^[a-z0-9-]+$/.test(name) ? name : null
}

/** Открыт ли режим съёмки: по нему прячется отладочная обвязка. */
export function isScreenshotMode(location: Location = window.location): boolean {
  return presetName(location) !== null
}

/**
 * Выключена ли боевая сцена (`?scene=off`): на её месте боевая панель,
 * игра идёт текстом. Нужен для съёмки интерфейса — снимки разделов делаются
 * без сцены, чтобы эталон не зависел от неё, — и как способ открыть игру
 * там, где картинка мешает.
 *
 * В отличие от ?state= этот параметр НЕ требует ?debug=1: он ничего не
 * подменяет в игре, а только убирает картинку.
 */
export function isSceneDisabled(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).get('scene') === 'off'
}

/**
 * Включена ли ПРЕЖНЯЯ трёхмерная сцена (`?scene=3d`). По умолчанию бой
 * рисует двумерная сцена; трёхмерный слой остаётся в коде до его удаления
 * и грузится только по этому флагу — в основной путь он не входит.
 */
export function isScene3d(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).get('scene') === '3d'
}

/**
 * Позы сцены для съёмки эталонов: покой, замах, попадание, крит, лечение,
 * привал. Каждая — застывший пик соответствующего эффекта, чтобы эталон
 * держал не только раскладку, но и сам эффект.
 */
export const SCENE_POSES = ['idle', 'swing', 'hit', 'crit', 'heal', 'rest'] as const
export type ScenePose = (typeof SCENE_POSES)[number]

/**
 * Поза сцены для снимка (`?pose=`); null — сцена живёт по состоянию.
 * Работает ТОЛЬКО вместе с пресетом (`?debug=1&state=`): в живой игре
 * застывшая поза была бы ложью о бое.
 */
export function screenshotPose(location: Location = window.location): ScenePose | null {
  if (presetName(location) === null) return null
  const pose = new URLSearchParams(location.search).get('pose')
  return (SCENE_POSES as readonly string[]).includes(pose ?? '') ? (pose as ScenePose) : null
}

/** Открыт ли отладочный режим (`?debug=1`). */
export function isDebugMode(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).get('debug') === '1'
}

/**
 * Показывать ли в сцене оси и сетку (`?helpers=1`).
 * Флаг ОТДЕЛЬНЫЙ от ?debug=1 нарочно: числа отладочного оверлея смотрят
 * на производительность, а оси и сетка — на раскладку, и включать их
 * хочется по отдельности. Ни то, ни другое ничего в игре не меняет.
 */
export function showsSceneHelpers(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).get('helpers') === '1'
}
