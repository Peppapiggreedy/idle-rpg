import { describe, expect, it } from 'vitest'
import { isBalanceRoute } from './route'

// Подделка Location: тест не поднимает браузер, а маршрут — чистая функция.
function loc(url: string): Location {
  const parsed = new URL(url)
  return { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash } as Location
}

describe('маршрут прогона баланса', () => {
  it('без ?debug=1 страницы нет ни по пути, ни по хешу', () => {
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/balance'))).toBe(false)
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/#/balance'))).toBe(false)
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/balance?debug=0'))).toBe(false)
  })

  it('открывается и чистым путём, и хешем', () => {
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/balance?debug=1'))).toBe(true)
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/balance/?debug=1'))).toBe(true)
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/?debug=1#/balance'))).toBe(true)
  })

  it('сама игра под ?debug=1 остаётся игрой', () => {
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/?debug=1'))).toBe(false)
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/?debug=1#/talents'))).toBe(false)
    // Похожий, но другой путь не считается.
    expect(isBalanceRoute(loc('https://x.dev/idle-rpg/rebalance?debug=1'))).toBe(false)
  })
})
