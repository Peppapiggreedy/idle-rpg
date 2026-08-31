// Сборка звукового слоя: движок, проигрыватель и подписки.
//
// Единственное место, где звук встречается с интерфейсом. Игровая логика
// сюда не смотрит и о существовании этого файла не знает.
import { get } from 'svelte/store'
import { simSpeed } from '../stores/game'
import { isTextMode, reportUserGesture, soundUnlocked, uiSettings } from '../stores/ui'
import { WebAudioEngine } from './engine'
import { listenToGame, SoundPlayer, type AudioGate } from './manager'
import { createRng } from '../game/rng'

export { isAudible, cueForEvent, SoundPlayer, listenToGame } from './manager'
export type { AudioGate, SoundEngine } from './manager'
export { emptyMixer, planCue, duckFactor } from './mixer'
export type { CuePlan, MixerState } from './mixer'
export { WebAudioEngine, DEFAULT_VOLUMES } from './engine'

let engine: WebAudioEngine | null = null
let player: SoundPlayer | null = null
let stop: (() => void) | null = null

// Сид звука фиксирован и СВОЙ: поток симуляции вычерпывать нельзя — ход игры
// стал бы зависеть от того, включён ли звук. Тот же довод, что у пропсов сцены.
const SOUND_SEED = 90210

function gate(): AudioGate {
  const settings = get(uiSettings)
  return {
    unlocked: get(soundUnlocked) && (engine?.unlocked ?? false),
    enabled: settings.volumes.master > 0,
    hidden: typeof document !== 'undefined' && document.hidden,
    speed: get(simSpeed),
    textMode: isTextMode(settings),
  }
}

/** Поднимает звуковой слой. Повторный вызов ничего не делает. */
export function startAudio(base = ''): void {
  if (player) return
  engine = new WebAudioEngine(base)
  const rng = createRng(SOUND_SEED)
  player = new SoundPlayer({
    engine,
    gate,
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    rng,
  })
  stop = listenToGame(player)
  // Громкости едут в движок сразу: контекста ещё нет, он их запомнит.
  uiSettings.subscribe((s) => engine?.setVolumes({ ...s.volumes }))
}

/**
 * Жест игрока: только отсюда появляется звук. Вешается на первый клик и
 * первое нажатие клавиши и снимается сам.
 */
export function unlockAudioOnGesture(): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => {
    reportUserGesture()
    void engine?.unlock()
    detach()
  }
  const detach = () => {
    window.removeEventListener('pointerdown', handler)
    window.removeEventListener('keydown', handler)
  }
  window.addEventListener('pointerdown', handler, { once: true })
  window.addEventListener('keydown', handler, { once: true })
  return detach
}

/**
 * ВОЗВРАЩАЕТ ЗВУК ПОСЛЕ ПЕРЕРЫВА.
 *
 * Слушатель жеста висит с `{ once: true }` и отписывается после первого
 * касания — звать `resume()` больше некому. А контекст на iOS останавливают
 * блокировка экрана, звонок и переключение приложений. Без этого обработчика
 * звук пропадал до перезагрузки страницы.
 *
 * Жест игрока к этому моменту уже был, поэтому браузер `resume()` разрешает.
 */
export function resumeAudioOnVisible(): () => void {
  if (typeof document === 'undefined') return () => {}
  const onVisible = () => {
    if (document.visibilityState === 'visible') void engine?.unlock()
  }
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
}

/** Звук интерфейса. UI зовёт его сам: событий боя у кнопки нет. */
export function playUiSound(id: 'ui-click' | 'ui-toggle' | 'ui-deny'): void {
  player?.ui(id)
}

/**
 * Щелчки интерфейса одним слушателем на документ.
 *
 * Не в примитивах `ui/kit/`: они не знают ни про состояние, ни про звук, и
 * тащить туда импорт звукового слоя значило бы сломать это правило ради
 * щелчка. Делегирование даёт то же самое и ничего не ломает.
 */
export function attachUiSounds(): () => void {
  if (typeof document === 'undefined') return () => {}
  const onClick = (event: Event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest) return
    if (target.closest('button, [role="button"], a')) playUiSound('ui-click')
  }
  const onChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null
    if (target?.type === 'checkbox' || target?.type === 'radio') playUiSound('ui-toggle')
  }
  document.addEventListener('click', onClick)
  document.addEventListener('change', onChange)
  return () => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('change', onChange)
  }
}

export function stopAudio(): void {
  stop?.()
  stop = null
  engine?.dispose()
  engine = null
  player = null
}
