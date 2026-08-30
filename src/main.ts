import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import BalancePage from './lib/ui/BalancePage.svelte'
import ShowcasePage from './lib/ui/ShowcasePage.svelte'
import { debugRoute, presetName } from './lib/ui/route'
import { loadPreset } from './lib/ui/preset'
import {
  applyFpsLimit,
  handleTabHidden,
  handleTabVisible,
  initGame,
  startGameLoop,
} from './lib/stores/game'
import {
  attachUiSounds,
  resumeAudioOnVisible,
  startAudio,
  unlockAudioOnGesture,
} from './lib/audio'
import { uiSettings } from './lib/stores/ui'

const target = document.getElementById('app')!
const route = debugRoute()
const preset = presetName()

// Готовность страницы для съёмки: Playwright ждёт этот атрибут, а не таймаут.
const markReady = (kind: string) => document.documentElement.setAttribute('data-ready', kind)

function startGame(): void {
  initGame()
  mount(App, { target })
  // Настройки экрана и игровой цикл сводятся здесь, в точке входа: сам
  // стор настроек про цикл не знает, а цикл — про настройки.
  uiSettings.subscribe((s) => applyFpsLimit(s.fpsLimit))
  // Звук поднимается вместе с игрой, но МОЛЧИТ до первого жеста игрока.
  // Тот же довод, что и у настроек: игра, которая начинает шуметь сама, —
  // это игра, которую закрывают.
  startAudio(import.meta.env.BASE_URL)
  unlockAudioOnGesture()
  // Звук возвращается после блокировки экрана и переключения приложений.
  resumeAudioOnVisible()
  attachUiSounds()
  startGameLoop()
  // Уход в фон и возврат из фона — ОБА события, а не одно.
  //
  // Раньше здесь был только уход: сохраниться (на мобильных это надёжнее
  // beforeunload). Возврата не было вовсе, а цикл при скрытой вкладке стоит и
  // накопленное время выбрасывает, — поэтому восемь часов в соседней вкладке
  // давали ровно ноль, тогда как те же восемь часов с ЗАКРЫТОЙ вкладкой
  // давали пятую часть живой игры. Выйти из игры было выгоднее, чем оставить
  // её открытой; в idle-игре это худшее, что можно построить.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') handleTabHidden()
    else handleTabVisible()
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
