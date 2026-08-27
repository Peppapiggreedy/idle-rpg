import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import BalancePage from './lib/ui/BalancePage.svelte'
import ShowcasePage from './lib/ui/ShowcasePage.svelte'
import { debugRoute, presetName } from './lib/ui/route'
import { loadPreset } from './lib/ui/preset'
import { initGame, persistNow, startGameLoop } from './lib/stores/game'

const target = document.getElementById('app')!
const route = debugRoute()
const preset = presetName()

// Готовность страницы для съёмки: Playwright ждёт этот атрибут, а не таймаут.
const markReady = (kind: string) => document.documentElement.setAttribute('data-ready', kind)

function startGame(): void {
  initGame()
  mount(App, { target })
  startGameLoop()
  // Сохраняемся, когда вкладка уходит в фон: на мобильных это надёжнее beforeunload.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistNow()
  })
  markReady('game')
}

// Отладочные страницы под ?debug=1 монтируются вместо игры, и игровой цикл
// на них не запускается вовсе: ни прибор, ни витрина не должны фармить
// за игрока и трогать его сейв.
if (route === 'balance') {
  mount(BalancePage, { target })
  markReady('balance')
} else if (route === 'ui') {
  mount(ShowcasePage, { target })
  markReady('ui')
} else if (preset) {
  // Режим съёмки: заранее заданное состояние, без цикла и без сейва.
  // Неизвестное имя пресета — не повод показать пустой экран: играем обычно.
  loadPreset(preset).then((loaded) => {
    if (!loaded) return startGame()
    mount(App, { target })
    markReady('preset')
  })
} else {
  startGame()
}
