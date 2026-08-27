// Единственный мост между игровой логикой и UI: компоненты читают эти store
// и вызывают экшены, цикл и экшены пишут в состояние.
import { get, readonly, writable } from 'svelte/store'
import { createGameLoop, STEP_MS, type GameLoop, type LoopMetrics } from '../game/loop'
import { createInitialState, spawnMonster, type GameState } from '../game/state'
import { tick } from '../game/tick'
import { createRng, type Rng } from '../game/rng'
import { buyUpgrade } from '../game/upgrades'
import { xpToNextLevel } from '../game/formulas'
import { Decimal } from '../game/numbers'
import { applyOfflineProgress } from '../game/save'
import { sellItem } from '../game/loot'
import { equipItem, setAutoEquip, unequipItem } from '../game/equipment'
import { currentZone, travelToZone as travelAction } from '../game/zones'
import { useAbility as useAbilityAction } from '../game/abilities'
import { abilitiesByPriority } from '../game/rotation'
import { investTalent as investTalentAction, resetTalents as resetTalentsAction } from '../game/talents'
import {
  enterDungeon as enterDungeonAction,
  leaveDungeon as leaveDungeonAction,
} from '../game/dungeons'
import { emit as emitAttack } from '../game/events'
import type { SlotId } from '../data/slots'
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
// Тот же поток случайности, что и у цикла: экшены вне тика (переход в зону)
// берут броски отсюда, а не из Math.random.
let actionRng: Rng | null = null

function rng(): Rng {
  if (!actionRng) actionRng = createRng(get(state).rngSeed)
  return actionRng
}

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
  const stream = rng()
  loop = createGameLoop({
    step: (dtMs) => {
      state.update((s) => tick(s, dtMs, stream))
      // Счётчик копит applyAutosaveCounter внутри тика; стор сохраняет и сбрасывает.
      if (get(state).msSinceAutosave >= AUTOSAVE_INTERVAL_MS) {
        persistNow()
        state.update((s) => ({ ...s, msSinceAutosave: 0 }))
      }
    },
    onMetrics: (m) => metrics.set(m),
  })
  loop.setSpeed(get(simSpeedStore))
  loop.setFpsLimit(fpsLimit)
  loop.start()
}

/** Дебаг: множитель игрового времени (1/10/100). */
export function setSimulationSpeed(multiplier: number): void {
  simSpeedStore.set(multiplier)
  loop?.setSpeed(multiplier)
}

/**
 * Потолок частоты кадров из настроек. Игровое время не трогает: цикл
 * пропускает кадр, не сдвигая точку отсчёта, и накопленное приходит
 * следующим кадром (см. loop.ts). Запоминаем и на случай, если цикл ещё
 * не запущен, — применим при старте.
 */
let fpsLimit: number | null = null

export function applyFpsLimit(limit: number | null): void {
  fpsLimit = limit
  loop?.setFpsLimit(limit)
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

/** Надеть предмет из инвентаря; снятое возвращается в инвентарь. */
export function equipInventoryItem(itemId: string): void {
  state.update((s) => equipItem(s, itemId))
}

/** Снять предмет из слота в инвентарь; при полном инвентаре ничего не делает. */
export function unequipSlot(slot: SlotId): void {
  state.update((s) => unequipItem(s, slot))
}

/** Галочка «надевать автоматически, если лучше». */
export function toggleAutoEquip(enabled: boolean): void {
  state.update((s) => setAutoEquip(s, enabled))
}

/** Переход в зону по клику. В закрытую зону экшен не пустит — состояние как было. */
export function travelToZone(zoneId: string): void {
  state.update((s) => travelAction(s, zoneId, rng()))
}

/** Вход в данж по кнопке. Недоступный данж состояние не меняет. */
export function enterDungeonRun(dungeonId: string): void {
  state.update((s) => enterDungeonAction(s, dungeonId))
}

/** Добровольный выход из данжа: цепочка сбрасывается. */
export function leaveDungeonRun(): void {
  state.update((s) => leaveDungeonAction(s, rng(), false))
}

/** Вложить очко в талант. Недоступный талант состояние не меняет. */
export function investTalentPoint(talentId: string): void {
  state.update((s) => investTalentAction(s, talentId))
}

/** Сброс талантов за золото; при нехватке золота ничего не делает. */
export function resetTalentTree(): void {
  state.update((s) => resetTalentsAction(s))
}

/** Галка «использовать автоматически» у умения. */
export function setAbilityAutocast(abilityId: string, autocast: boolean): void {
  state.update((s) => {
    const setting = s.abilitySettings[abilityId]
    if (!setting) return s
    return {
      ...s,
      abilitySettings: { ...s.abilitySettings, [abilityId]: { ...setting, autocast } },
    }
  })
}

/** Стрелки вверх/вниз: меняет умение приоритетом с соседом по списку. */
export function moveAbilityPriority(abilityId: string, direction: -1 | 1): void {
  state.update((s) => {
    const order = abilitiesByPriority(s.abilitySettings, false)
    const index = order.findIndex((a) => a.id === abilityId)
    const target = index + direction
    if (index === -1 || target < 0 || target >= order.length) return s
    const swapped = [...order]
    ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]
    // Приоритеты переписываем по новому порядку: 0, 1, 2… без дыр.
    const abilitySettings = { ...s.abilitySettings }
    swapped.forEach((ability, priority) => {
      abilitySettings[ability.id] = { ...abilitySettings[ability.id], priority }
    })
    return { ...s, abilitySettings }
  })
}

/**
 * Нажатие на умение (клик или хоткей). Недоступное умение состояние не меняет;
 * причину показывает abilityStatus, текст к ней рендерит панель умений.
 */
export function activateAbility(abilityId: string): void {
  state.update((s) => useAbilityAction(s, abilityId, rng(), emitAttack))
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

// ---------- Режим съёмки скриншотов (?debug=1&state=<пресет>) ----------

// Сколько тиков проигрываем поверх пресета перед съёмкой. Ноль дал бы пустой
// лог боя и нетронутые полоски — снимок выглядел бы как сломанная игра.
// Число входит в определение снимка: поменяешь его — поменяются эталоны.
export const SCREENSHOT_TICKS = 200

// Сид потока случайности для съёмки. Он нужен ЯВНО: сейв сид не хранит
// (см. rngSeed в state.ts), поэтому stateFromPayload выдаёт каждый раз новый —
// и моб, и все броски за 200 тиков получались бы разными при каждой загрузке,
// а вместе с ними ехала бы и высота страницы.
export const SCREENSHOT_SEED = 20_260_827

/**
 * Ставит заранее заданное состояние и прокручивает фиксированное число тиков.
 * Игровой цикл НЕ запускается и сейв НЕ трогается: снимок обязан быть
 * воспроизводимым до пикселя, а живой цикл и localStorage этому мешают.
 */
export function applyScreenshotState(preset: GameState): void {
  // Сид пришиваем к состоянию и заново спавним моба: только так и первый
  // противник, и вся дальнейшая цепочка бросков одинаковы от прогона к прогону.
  const seeded: GameState = {
    ...preset,
    rngSeed: SCREENSHOT_SEED,
    monster: spawnMonster(currentZone(preset), createRng(SCREENSHOT_SEED)),
  }
  const stream = createRng(SCREENSHOT_SEED)
  let s = seeded
  for (let i = 0; i < SCREENSHOT_TICKS; i++) s = tick(s, STEP_MS, stream, emitAttack)
  state.set(s)
  sessionStart.set(s.playtimeMs.toNumber())
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
      swingProgress: 1,
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
