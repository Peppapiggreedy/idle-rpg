import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { initGame, persistNow, startGameLoop } from './lib/stores/game'

initGame()

const app = mount(App, {
  target: document.getElementById('app')!,
})

startGameLoop()

// Сохраняемся, когда вкладка уходит в фон: на мобильных это надёжнее beforeunload.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistNow()
})

export default app
