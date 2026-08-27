import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import BalancePage from './lib/ui/BalancePage.svelte'
import ShowcasePage from './lib/ui/ShowcasePage.svelte'
import { debugRoute } from './lib/ui/route'
import { initGame, persistNow, startGameLoop } from './lib/stores/game'

const target = document.getElementById('app')!
const route = debugRoute()

// Отладочные страницы под ?debug=1 монтируются вместо игры, и игровой цикл
// на них не запускается вовсе: ни прибор, ни витрина не должны фармить
// за игрока и трогать его сейв.
if (route === 'balance') {
  mount(BalancePage, { target })
} else if (route === 'ui') {
  mount(ShowcasePage, { target })
} else {
  initGame()
  mount(App, { target })
  startGameLoop()
  // Сохраняемся, когда вкладка уходит в фон: на мобильных это надёжнее beforeunload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow()
  })
}
