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
 * Выключена ли боевая сцена (`?scene=off`). Нужен для съёмки интерфейса:
 * сцена рисуется WebGL, а в headless-браузере он идёт через программный
 * растеризатор — результат от прогона к прогону не совпадает до пикселя.
 * Снимки интерфейса делаются без сцены и потому сравнимы с эталоном.
 *
 * В отличие от ?state= этот параметр НЕ требует ?debug=1: он ничего не
 * подменяет в игре, а только убирает картинку — пусть остаётся способом
 * открыть игру там, где WebGL мешает.
 */
export function isSceneDisabled(location: Location = window.location): boolean {
  return new URLSearchParams(location.search).get('scene') === 'off'
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
