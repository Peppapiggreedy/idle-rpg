import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { startGameLoop } from './lib/stores/game'

const app = mount(App, {
  target: document.getElementById('app')!,
})

startGameLoop()

export default app
