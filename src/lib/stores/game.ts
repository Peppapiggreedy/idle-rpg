// Единственный мост между игровой логикой и UI: компоненты читают эти store
// и вызывают экшены, цикл и экшены пишут в состояние.
import { get, readonly, writable } from 'svelte/store'
import { createGameLoop, type GameLoop, type LoopMetrics } from '../game/loop'
import { createInitialState, tick, type GameState } from '../game/tick'
import { buyUpgrade } from '../game/upgrades'
import { sellItem } from '../game/loot'
import {
  AUTOSAVE_INTERVAL_MS,
  OFFLINE_MODAL_MIN_MS,
  decodeSaveString,
  encodeSaveString,
  loadGame,
  saveGame,
  stateFromPayload,
  type OfflineReport,
} from '../game/save'
import type { UpgradeDef } from '../types'

const state = writable<GameState>(createInitialState())
export const gameState = readonly(state)

const metrics = writable<LoopMetrics>({ fps: 0, tps: 0 })
export const loopMetrics = readonly(metrics)

// Итоги оффлайн-прогресса для модалки «Пока тебя не было»; null — модалка скрыта.
const offline = writable<OfflineReport | null>(null)
export const offlineReport = readonly(offline)
export function dismissOfflineReport(): void {
  offline.set(null)
}

// Короткие уведомления игроку (ошибка сейва, итог импорта); null — баннер скрыт.
const notice = writable<string | null>(null)
export const saveNotice = readonly(notice)
export function dismissNotice(): void {
  notice.set(null)
}

let loop: GameLoop | null = null
let msSinceSave = 0

/** Сохраняет игру немедленно (автосейв, visibilitychange, экспорт). */
export function persistNow(): void {
  try {
    saveGame(get(state))
  } catch {
    /* нет localStorage (приватный режим и т.п.) — игра просто живёт без сейва */
  }
}

/** Загружает сейв до старта цикла; битый сейв не роняет игру. */
export function initGame(): void {
  try {
    const result = loadGame()
    if (result.kind === 'loaded') {
      state.set(result.state)
      if (result.offline && result.offline.elapsedMs >= OFFLINE_MODAL_MIN_MS) {
        offline.set(result.offline)
      }
    } else if (result.kind === 'error') {
      notice.set(result.message)
    }
  } catch {
    notice.set('Не удалось загрузить сохранение — игра начата заново.')
  }
  // Фиксируем свежий lastTimestamp (в т.ч. после перевода часов назад).
  persistNow()
}

/** Запускает единственный игровой цикл. Повторный вызов ничего не делает. */
export function startGameLoop(): void {
  if (loop) return
  loop = createGameLoop({
    step: (dtMs) => {
      state.update((s) => tick(s, dtMs))
      // Автосейв на игровом времени: каждые 15 секунд симуляции.
      msSinceSave += dtMs
      if (msSinceSave >= AUTOSAVE_INTERVAL_MS) {
        msSinceSave = 0
        persistNow()
      }
    },
    onMetrics: (m) => metrics.set(m),
  })
  loop.start()
}

export function stopGameLoop(): void {
  loop?.stop()
  loop = null
}

/** Покупка апгрейда по клику из UI; при нехватке золота ничего не меняет. */
export function purchaseUpgrade(def: UpgradeDef): void {
  state.update((s) => buyUpgrade(s, def))
}

/** Продажа предмета из инвентаря по клику из UI. */
export function sellInventoryItem(itemId: string): void {
  state.update((s) => sellItem(s, itemId))
}

/** Строка экспорта (base64) текущего состояния; заодно сохраняет игру. */
export function exportSaveString(): string {
  persistNow()
  return encodeSaveString(get(state))
}

/** Импорт строки сейва; true — успех. Состояние заменяется и сохраняется. */
export function importSaveString(input: string): boolean {
  const payload = decodeSaveString(input)
  if (!payload) {
    notice.set('Не удалось прочитать строку сейва — проверь, что скопирована целиком.')
    return false
  }
  state.set(stateFromPayload(payload))
  persistNow()
  notice.set('Сейв импортирован.')
  return true
}
