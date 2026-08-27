// Маршруты страницы. Их ровно два: сама игра и отладочный прогон баланса.
// Полноценный роутер под две страницы заводить незачем.

/**
 * Открыт ли прогон баланса. Требуется ?debug=1 — без него страницы нет вовсе.
 * Понимаем два адреса: чистый путь `/idle-rpg/balance?debug=1` (его отдаёт
 * GitHub Pages через 404.html, см. vite.config.ts) и хеш `?debug=1#/balance`,
 * который работает вообще на любом статическом хостинге.
 */
export function isBalanceRoute(location: Location = window.location): boolean {
  if (new URLSearchParams(location.search).get('debug') !== '1') return false
  const path = location.pathname.replace(/\/+$/, '')
  return path.endsWith('/balance') || location.hash.replace(/\/+$/, '') === '#/balance'
}
