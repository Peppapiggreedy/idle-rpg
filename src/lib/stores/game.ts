// Единственный мост между игровой логикой и UI: компоненты читают эти store
// и вызывают экшены, цикл и экшены пишут в состояние.
import { get, readonly, writable } from 'svelte/store'
import { createGameLoop, type GameLoop, type LoopMetrics } from '../game/loop'
import { createInitialState, type GameState } from '../game/state'
import { tick } from '../game/tick'
import { createRng } from '../game/rng'
import { buyUpgrade } from '../game/upgrades'
import { xpToNextLevel } from '../game/formulas'
import { Decimal } from '../game/numbers'
import { applyOfflineProgress } from '../game/save'
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

// Короткие уведомления игроку кодами; текст по коду рендерит NoticeBar.
export type NoticeCode =
  | 'save-corrupted'
  | 'save-newer-version'
  | 'save-load-failed'
  | 'import-invalid'
  | 'import-success'
const notice = writable<NoticeCode | null>(null)
export const saveNotice = readonly(notice)
export function dismissNotice(): void {
  notice.set(null)
}

// Множитель скорости симуляции (дебаг-панель); применяется к игровому времени.
const simSpeedStore = writable(1)
export const simSpeed = readonly(simSpeedStore)

// Игровое время на момент старта сессии — для показателя «время сессии» в дебаге.
const sessionStart = writable(0)
export const sessionStartPlaytimeMs = readonly(sessionStart)

let loop: GameLoop | null = null

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
      notice.set(result.reason === 'corrupted' ? 'save-corrupted' : 'save-newer-version')
    }
  } catch {
    notice.set('save-load-failed')
  }
  // Фиксируем свежий lastTimestamp (в т.ч. после перевода часов назад).
  persistNow()
  sessionStart.set(get(state).playtimeMs.toNumber())
}

/** Запускает единственный игровой цикл. Повторный вызов ничего не делает. */
export function startGameLoop(): void {
  if (loop) return
  // Единственный на игру поток случайности; создаётся один раз из сида состояния.
  const rng = createRng(get(state).rngSeed)
  loop = createGameLoop({
    step: (dtMs) => {
      state.update((s) => tick(s, dtMs, rng))
      // Счётчик копит applyAutosaveCounter внутри тика; стор сохраняет и сбрасывает.
      if (get(state).msSinceAutosave >= AUTOSAVE_INTERVAL_MS) {
        persistNow()
        state.update((s) => ({ ...s, msSinceAutosave: 0 }))
      }
    },
    onMetrics: (m) => metrics.set(m),
  })
  loop.setSpeed(get(simSpeedStore))
  loop.start()
}

/** Дебаг: множитель игрового времени (1/10/100). */
export function setSimulationSpeed(multiplier: number): void {
  simSpeedStore.set(multiplier)
  loop?.setSpeed(multiplier)
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
    notice.set('import-invalid')
    return false
  }
  state.set(stateFromPayload(payload))
  persistNow()
  notice.set('import-success')
  return true
}

// ---------- Дебаг-экшены (панель ?debug=1) ----------

export function debugAddLevel(): void {
  state.update((s) => {
    const level = s.level.plus(1)
    return { ...s, level, currentXp: new Decimal(0), xpToNext: xpToNextLevel(level) }
  })
}

export function debugAddGold(amount: number): void {
  state.update((s) => ({ ...s, gold: s.gold.plus(amount) }))
}

/** Убийство текущего моба честно, через конвейер: hp почти ноль + готовый
 * замах — следующий тик добивает, награды/лут/события идут обычным путём. */
export function debugKillMonster(): void {
  state.update((s) => {
    if (s.respawnMsLeft > 0) return s
    return {
      ...s,
      monster: { ...s.monster, currentHp: Decimal.min(s.monster.currentHp, new Decimal(0.01)) },
      swingTimerMs: s.stats.attackSpeed * 1000,
    }
  })
}

export function debugResetSave(): void {
  state.set(createInitialState())
  offline.set(null)
  sessionStart.set(0)
  persistNow()
}

/** Симуляция оффлайна тем же кодом, что и настоящая загрузка (с потолком 8 ч). */
export function debugSimulateOffline(hours: number): void {
  if (!Number.isFinite(hours) || hours <= 0) return
  state.update((s) => {
    const { state: next, report } = applyOfflineProgress(s, hours * 3_600_000)
    if (report) offline.set(report)
    return next
  })
  persistNow()
}
