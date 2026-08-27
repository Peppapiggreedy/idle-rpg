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
