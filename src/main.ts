import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import BalancePage from './lib/ui/BalancePage.svelte'
import { isBalanceRoute } from './lib/ui/route'
import { initGame, persistNow, startGameLoop } from './lib/stores/game'

const target = document.getElementById('app')!

// Прогон баланса — отдельная страница под ?debug=1. Игровой цикл на ней не
// запускается вовсе: прибор не должен фармить за игрока и трогать его сейв.
if (isBalanceRoute()) {
  mount(BalancePage, { target })
} else {
  initGame()
  mount(App, { target })
  startGameLoop()
  // Сохраняемся, когда вкладка уходит в фон: на мобильных это надёжнее beforeunload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow()
  })
}
