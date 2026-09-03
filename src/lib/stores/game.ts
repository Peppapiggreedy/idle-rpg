// Единственный мост между игровой логикой и UI: компоненты читают эти store
// и вызывают экшены, цикл и экшены пишут в состояние.
import { get, readonly, writable } from 'svelte/store'
import { createGameLoop, STEP_MS, type GameLoop, type LoopMetrics } from '../game/loop'
import { createInitialState, pushEvent, spawnMonster, type GameState } from '../game/state'
import { finishRest, restProgress } from '../game/rest'
import { tick } from '../game/tick'
import { ensureStats } from '../game/stats'
import { createRng, type Rng } from '../game/rng'
import { xpToNextLevel } from '../game/formulas'
import { Decimal } from '../game/numbers'
import { applyOfflineProgress } from '../game/save'
import { sellItem } from '../game/loot'
import type { UpgradePriority } from '../data/upgrade'
import { craft as craftAction } from '../game/crafting'
import { recordDecision, resetTelemetry } from './telemetry'
import { equipItem, unequipItem } from '../game/equipment'
import { currentZone, travelToZone as travelAction } from '../game/zones'
import { useAbility as useAbilityAction } from '../game/abilities'
import { abilitiesByPriority } from '../game/rotation'
import { investTalent as investTalentAction, resetTalents as resetTalentsAction } from '../game/talents'
import { drinkPotion as drinkPotionAction } from '../game/potions'
import { disenchantItem, enchantItem } from '../game/enchanting'
import {
  enterDungeon as enterDungeonAction,
  leaveDungeon as leaveDungeonAction,
  type DungeonDifficulty,
} from '../game/dungeons'
import { enterTemple as enterTempleAction, leaveTemple as leaveTempleAction } from '../game/temple'
import { emit as emitAttack, emitLog, freshEvents } from '../game/events'
import type { SlotId } from '../data/slots'
import {
  AUTOSAVE_INTERVAL_MS,
  OFFLINE_MODAL_MIN_MS,
  backupRawSave,
  clearSave,
  decodeSaveString,
  encodeSaveString,
  loadGame,
  readBackupSave,
  resumeAfterAway,
  saveGame,
  stateFromPayload,
  type LoadErrorReason,
  type OfflineReport,
  type SaveWriteError,
} from '../game/save'
import { classById } from '../data/classes'

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
  | 'save-unsupported-version'
  | 'save-storage-unavailable'
  | 'save-load-failed'
  // Записать не удалось. Это САМОЕ важное уведомление в списке: игра идёт,
  // выглядит здоровой и молча ничего не сохраняет.
  | 'save-write-failed'
  | 'save-quota-exceeded'
  | 'import-invalid'
  | 'import-success'

/** Код отказа загрузки -> уведомление. Своего текста у стора нет. */
const LOAD_NOTICE: Record<LoadErrorReason, NoticeCode> = {
  corrupt: 'save-corrupted',
  'newer-version': 'save-newer-version',
  'unsupported-version': 'save-unsupported-version',
  'storage-unavailable': 'save-storage-unavailable',
}

/** Код отказа записи -> уведомление. */
const WRITE_NOTICE: Record<SaveWriteError, NoticeCode> = {
  'storage-unavailable': 'save-storage-unavailable',
  'quota-exceeded': 'save-quota-exceeded',
  'write-failed': 'save-write-failed',
}
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

// Есть ли уже начатая игра. Пока её нет, показывается выбор класса: класс
// выбирается ОДИН раз и не меняется никогда, поэтому спрашивать надо до того,
// как накопился прогресс, а не после.
const started = writable(false)
export const gameStarted = readonly(started)

// Режим съёмки: состояние подставлено снаружи и к сейву игрока отношения не
// имеет. Пока флаг поднят, не пишем НИЧЕГО: иначе достаточно открыть ссылку
// со снимком и нажать «Экспорт сейва» (он сохраняет заодно), чтобы пресет
// лёг поверх настоящего героя. Флаг односторонний — режим съёмки живёт до
// перезагрузки страницы.
let screenshotMode = false

/**
 * Сохраняет игру немедленно (автосейв, visibilitychange, экспорт).
 *
 * ДО ВЫБОРА КЛАССА НЕ ПИШЕТ НИЧЕГО, и это не мелочь: сейв, записанный за
 * спиной у выбора, ставит в него класс по умолчанию, а следующая загрузка
 * такой сейв находит, поднимает `started` — и выбор больше не появляется
 * никогда. Игрок остаётся Стражем навсегда, ничего не выбрав.
 *
 * Проверка стоит именно ЗДЕСЬ, в одной точке, а не у каждого вызывающего:
 * сохраняются автосейв в цикле, уход вкладки в фон и отладочные экшены — и
 * достаточно забыть один из них, чтобы вернуть ту же поломку.
 *
 * Про отказ записи говорит ОДИН РАЗ за сессию (флаг ниже). Автосейв идёт раз
 * в несколько секунд: без этого одинаковые сообщения завалили бы экран, и
 * игрок закрыл бы их не читая — то есть остался бы так же не предупреждён.
 */
let writeFailureReported = false

export function persistNow(): void {
  if (!get(started) || screenshotMode) return
  const result = saveGame(get(state))
  if (result.kind === 'ok') return
  // РАНЬШЕ ЗДЕСЬ БЫЛ ПУСТОЙ catch. Игра три часа шла, ничего не сохраняя, и
  // игрок узнавал об этом, закрыв вкладку: следующий заход начинался с
  // первого уровня, без единого намёка на причину.
  if (writeFailureReported) return
  writeFailureReported = true
  notice.set(WRITE_NOTICE[result.reason])
}

/**
 * ЧАСЫ СТОРА. Инжектируются, потому что иначе оффлайн в фоне нечем проверить:
 * тест не может подождать восемь часов. Тот же приём уже применён в loadGame.
 */
let clock: () => number = () => Date.now()
export function setClockForTests(fn: () => number): void {
  clock = fn
}

/** Когда вкладка ушла в фон; null — она на виду. */
let hiddenAtMs: number | null = null

/**
 * Вкладка ушла в фон. Запоминаем отметку времени и сохраняемся: на мобильных
 * это надёжнее beforeunload, а отметка нужна, чтобы досчитать пропущенное.
 */
export function handleTabHidden(): void {
  hiddenAtMs = clock()
  persistNow()
}

/**
 * Вкладка вернулась. Пропущенное время досчитывается ТЕМ ЖЕ путём, что и при
 * загрузке страницы: `resumeAfterAway` внутри зовёт `resumeOutside` и
 * `applyOfflineProgress`, и второй модели начисления не существует.
 *
 * Раньше этого не было вовсе: цикл при скрытой вкладке стоит, накопленный
 * долг сбрасывается, и восемь часов в соседней вкладке давали РОВНО НОЛЬ —
 * при том, что те же восемь часов с закрытой вкладкой давали пятую часть
 * живой игры. Выйти из игры было выгоднее, чем оставить её открытой.
 */
export function handleTabVisible(): void {
  const since = hiddenAtMs
  hiddenAtMs = null
  if (since === null || !get(started) || screenshotMode) return
  const elapsedMs = clock() - since
  const { state: next, offline: report } = resumeAfterAway(get(state), elapsedMs, rng())
  state.set(next)
  // Порог модалки тот же, что и при загрузке: короткий отскок во вкладку не
  // должен выбрасывать окно возврата на пол-экрана.
  if (report && report.elapsedMs >= OFFLINE_MODAL_MIN_MS) offline.set(report)
  if (report) persistNow()
}

/** Начать новую игру выбранным классом. Работает только до первого сейва. */
export function startNewGame(classId: string): void {
  if (get(started)) return
  state.set(createInitialState(undefined, classId))
  started.set(true)
  persistNow()
  sessionStart.set(0)
}

/** Загружает сейв до старта цикла; битый сейв не роняет игру. */
export function initGame(): void {
  try {
    const result = loadGame()
    if (result.kind === 'loaded') {
      state.set(result.state)
      started.set(true)
      if (result.offline && result.offline.elapsedMs >= OFFLINE_MODAL_MIN_MS) {
        offline.set(result.offline)
      }
    } else if (result.kind === 'error') {
      // КАЖДАЯ ПРИЧИНА СВОИМ ТЕКСТОМ. Раньше всё, кроме нечитаемой строки,
      // объявлялось сейвом «из более новой версии», и игрок с испорченным
      // сохранением ждал деплоя, которого для него не будет.
      notice.set(LOAD_NOTICE[result.reason])
    }
  } catch {
    notice.set('save-load-failed')
  }
  // Пока класс не выбран, сейва не создаём: иначе первый же заход записал бы
  // Стража, и выбор превратился бы в формальность.
  if (get(started)) {
    // Фиксируем свежий lastTimestamp (в т.ч. после перевода часов назад).
    persistNow()
    sessionStart.set(get(state).playtimeMs.toNumber())
  }
}

/** Запускает единственный игровой цикл. Повторный вызов ничего не делает. */
export function startGameLoop(): void {
  if (loop) return
  // Единственный на игру поток случайности; создаётся один раз из сида состояния.
  const stream = rng()
  loop = createGameLoop({
    step: (dtMs) => {
      // Пока класс не выбран, игра НЕ ИДЁТ. Раньше цикл крутился под
      // выбором: герой по умолчанию дрался, копил лог, находил вещи и
      // отправлял всё это в автосейв — то есть в сейв, который потом
      // и отменял выбор. Замершая сцена за непрозрачной шторкой никому
      // не видна, а вот её последствия были видны навсегда.
      if (!get(started)) return
      state.update((s) => {
        const next = tick(s, dtMs, stream)
        // События лога уходят НА ШИНУ, а не кому-то напрямую: звук и лента —
        // равноправные подписчики, и ни один из них логике не известен.
        emitLog(freshEvents(next.combatLog, s.combatLog[0] ?? null))
        return next
      })
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

/** Продажа предмета из инвентаря по клику из UI. */
export function sellInventoryItem(itemId: string): void {
  state.update((s) => sellItem(s, itemId))
}

/** Надеть предмет из инвентаря; снятое возвращается в инвентарь. */
export function equipInventoryItem(itemId: string): void {
  recordDecision('equip')
  state.update((s) => equipItem(s, itemId))
}

/** Снять предмет из слота в инвентарь; при полном инвентаре ничего не делает. */
export function unequipSlot(slot: SlotId): void {
  recordDecision('equip')
  state.update((s) => unequipItem(s, slot))
}


/** Переход в зону по клику. В закрытую зону экшен не пустит — состояние как было. */
export function travelToZone(zoneId: string): void {
  recordDecision('zone')
  state.update((s) => travelAction(s, zoneId, rng()))
}

/** Вход в данж по кнопке. Недоступный данж состояние не меняет. */
export function enterDungeonRun(
  dungeonId: string,
  difficulty: DungeonDifficulty = 'normal',
): void {
  // Сложность НИГДЕ не запоминается: это разовое решение при входе, а не
  // настройка. Кнопка передаёт её прямо сюда, и второго состояния для неё нет.
  state.update((s) => enterDungeonAction(s, dungeonId, difficulty))
}

/** Вход в храм испытаний. Кулдауна больше нет — часы храму не нужны. */
export function enterTempleRun(): void {
  recordDecision('temple')
  state.update((s) => enterTempleAction(s))
}

/**
 * Добровольный выход из храма. Это ЗАВЕРШЕНИЕ забега с результатом, как и
 * смерть: этажи выше рекорда оплачиваются, рекорд поднимается. Не
 * засчитывается только БРОШЕННЫЙ забег — закрытая вкладка.
 */
export function leaveTempleRun(): void {
  state.update((s) => leaveTempleAction(s, rng(), false, true))
}

/** Добровольный выход из данжа: цепочка сбрасывается. */
export function leaveDungeonRun(): void {
  state.update((s) => leaveDungeonAction(s, rng(), false))
}

/** Вложить очко в талант. Недоступный талант состояние не меняет. */
export function investTalentPoint(talentId: string): void {
  recordDecision('talent')
  state.update((s) => investTalentAction(s, talentId))
}

/** Сброс талантов за золото; при нехватке золота ничего не делает. */
export function resetTalentTree(): void {
  state.update((s) => resetTalentsAction(s))
}

/** Галка «использовать автоматически» у умения. */
/** Порог ухода на привал по HP. 0 — не уходить: герой будет фармить до смерти. */
export function setRestHpThreshold(share: number): void {
  recordDecision('rest-threshold')
  // statsDirty: порог входит в конвейер базой стата restThreshold —
  // без пересчёта талант на порог увидел бы старое значение.
  state.update((s) =>
    ensureStats({ ...s, restHpThreshold: Math.min(1, Math.max(0, share)), statsDirty: true }),
  )
}

/** Собрать рецепт. Не хватает материалов или места — состояние не меняется. */
export function craftRecipe(recipeId: string): void {
  recordDecision('craft')
  state.update((s) => craftAction(s, recipeId))
}

/**
 * Выпить зелье (клик или хоткей). Недоступная склянка состояние не меняет;
 * причину показывает potionStatus, текст к ней рендерит UI.
 *
 * Экшен ОДИН и только здесь: автокаста у зелий нет и не будет — вся разница
 * между ручной игрой и предоставленным самому себе героем держится на том,
 * что эту кнопку жмёт человек.
 */
/** Распылить предмет из сумки в пыль. Надетый и запертое уровнем — как было. */
export function disenchantInventoryItem(itemId: string): void {
  recordDecision('enchant')
  state.update((s) => disenchantItem(s, itemId))
}

/**
 * Наложить зачарование. Подтверждение «старое исчезнет» спрашивает UI до
 * вызова: логика молча делает то, о чём попросили, и переспрашивать в сторе
 * ей нечем — там нет ни диалогов, ни текста.
 */
export function enchantInventoryItem(itemId: string, enchantId: string): void {
  recordDecision('enchant')
  state.update((s) => enchantItem(s, itemId, enchantId))
}

export function drinkPotion(outputId: string): void {
  recordDecision('potion')
  state.update((s) => drinkPotionAction(s, outputId))
}

/**
 * Прервать привал руками. Восстановление частичное — ровно та доля, которую
 * герой успел отсидеть. Бесплатным прерывание быть не должно: иначе порог
 * перестаёт что-либо значить, а привал превращается в кнопку «полный запас».
 */
export function interruptRest(): void {
  state.update((s) => {
    if (s.heroState !== 'resting') return s
    const done = finishRest(s, restProgress(s))
    return { ...done, combatLog: pushEvent(done.combatLog, { type: 'rest-end', interrupted: true }) }
  })
}

/** Резерв маны умения: не жать автокастом, если после траты останется меньше. */
export function setAbilityReserve(abilityId: string, reserve: number): void {
  recordDecision('autocast')
  state.update((s) => {
    const setting = s.abilitySettings[abilityId]
    if (!setting) return s
    const clamped = Math.min(1, Math.max(0, reserve))
    return {
      ...s,
      abilitySettings: { ...s.abilitySettings, [abilityId]: { ...setting, reserve: clamped } },
    }
  })
}

/**
 * ЧТО СЧИТАТЬ АПГРЕЙДОМ: урон, выживание или баланс. Настройка игрока —
 * решает и метку на находке, и что уйдёт в золото при полной сумке. Правила
 * положений лежат в данных (`data/upgrade.ts`), здесь только запись выбора.
 */
export function setUpgradePriority(value: UpgradePriority): void {
  // Решение того же рода, что и надевание: игрок говорит игре, что считать
  // улучшением, и от этого меняется, во что герой оденется дальше.
  recordDecision('equip')
  state.update((s) => ({ ...s, upgradePriority: value }))
}

/** Беречь ли ману под лечение: боевые умения автокаста оставляют цену одного лечения. */
export function setHoldManaForHeal(value: boolean): void {
  recordDecision('autocast')
  state.update((s) => ({ ...s, holdManaForHeal: value }))
}

export function setAbilityAutocast(abilityId: string, autocast: boolean): void {
  recordDecision('autocast')
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
  recordDecision('autocast')
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

/**
 * Прежнее сохранение из запасного ключа — строкой, готовой к копированию.
 * `null` — копии нет. Её показывает экран уведомления: пока игрок не начал
 * заново, это единственный оставшийся след его прогресса.
 */
export function backupSaveString(): string | null {
  return readBackupSave()
}

/** Кого показывает строка сейва: этим подписан вопрос перед заменой. */
export interface SavePreview {
  level: number
  className: string
}

function previewOf(s: GameState): SavePreview {
  return { level: Math.floor(s.level.toNumber()), className: classById(s.classId).name }
}

/** Кто сейчас — для левой половины вопроса «заменить ЭТОГО на ТОГО?». */
export function currentSavePreview(): SavePreview | null {
  return get(started) ? previewOf(get(state)) : null
}

/**
 * Кого принесла строка. `null` — строка не читается.
 *
 * Разбор идёт ДО замены и отдельно от неё: раньше «Импорт сейва» открывал
 * window.prompt и сразу заменял героя, ничего не спросив и не назвав. Самое
 * разрушительное действие в игре не задавало ни одного вопроса.
 */
export function previewSaveString(input: string): SavePreview | null {
  const payload = decodeSaveString(input)
  return payload ? previewOf(stateFromPayload(payload)) : null
}

/** Импорт строки сейва; true — успех. Состояние заменяется и сохраняется. */
export function importSaveString(input: string): boolean {
  const payload = decodeSaveString(input)
  if (!payload) {
    notice.set('import-invalid')
    return false
  }
  // ПРЕЖНИЙ ГЕРОЙ УХОДИТ В ЗАПАСНОЙ КЛЮЧ, и только потом его затирают.
  // Импорт — второй способ потерять всё без следа: строку из заметок
  // недельной давности видно только после того, как своя уже пропала.
  if (get(started)) backupRawSave(encodeSaveString(get(state)))
  state.set(stateFromPayload(payload))
  // Импортированный сейв — это НАЧАТАЯ игра: класс в нём уже выбран. Без
  // этой строки импорт до выбора класса оставил бы поверх чужого героя
  // шторку выбора, а сам сейв не сохранился бы (persistNow молчит до старта).
  started.set(true)
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
  screenshotMode = true
  const stream = createRng(SCREENSHOT_SEED)
  let s = seeded
  for (let i = 0; i < SCREENSHOT_TICKS; i++) s = tick(s, STEP_MS, stream, emitAttack)
  state.set(s)
  // Пресет — это НАЧАТАЯ игра: класс в нём уже выбран. Без этой строки поверх
  // снимка встаёт выбор класса и закрывает собой всё, что снимают.
  started.set(true)
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

/**
 * «Стереть сейв и начать заново» — буквально. Сейв СТИРАЕТСЯ, а не
 * переписывается свежим: переписанный остаётся сейвом, следующая загрузка
 * считает игру начатой, и выбор класса не возвращается. Именно так кнопка и
 * ломалась — «сброс» молча оставлял игрока тем же классом навсегда.
 *
 * Флаг начатой игры снимается тоже: заново — значит с выбора класса.
 */
/**
 * ОТЛАДКА: сброс рекорда храма. Кулдауна больше нет, сбрасывать нечего —
 * а вот пройти храм заново, чтобы посмотреть награды за этажи, надо уметь.
 * Кнопка рисуется только при ?debug=1, в simulate.ts и golden-тесте не
 * участвует вовсе.
 */
export function debugResetTempleRecord(): void {
  state.update((s) => ({ ...s, templeBestWave: 0, templeCleared: false }))
  persistNow()
}

export function debugResetSave(): void {
  try {
    clearSave()
  } catch {
    /* нет localStorage — стирать нечего */
  }
  screenshotMode = false
  // «Заново» — значит и предупреждение об отказе записи заново: иначе
  // следующая сессия узнала бы о сломанном хранилище молча.
  writeFailureReported = false
  hiddenAtMs = null
  started.set(false)
  state.set(createInitialState())
  offline.set(null)
  notice.set(null)
  sessionStart.set(0)
  // Наблюдение за интервалом решений — про ЭТУ игру. Заново — значит и оно.
  resetTelemetry()
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
