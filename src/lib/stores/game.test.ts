import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  applyScreenshotState,
  backupSaveString,
  currentSavePreview,
  debugResetSave,
  dismissNotice,
  exportSaveString,
  gameStarted,
  gameState,
  importSaveString,
  initGame,
  persistNow,
  previewSaveString,
  saveNotice,
  startNewGame,
} from './game'
import { createInitialState } from '../game/state'
import { SAVE_BACKUP_KEY, SAVE_KEY } from '../game/save'

// Стор пишет в globalThis.localStorage, которого в node нет. Подсовываем свой:
// проверять надо именно то, ЧТО попадает в хранилище и когда.
const data = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, v),
  removeItem: (k: string) => void data.delete(k),
}

beforeEach(() => {
  data.clear()
  // Стор — модульный синглтон, и флаг «игра начата» живёт между тестами.
  // Сброс возвращает его в исходное состояние — заодно проверяя сам сброс.
  ;(globalThis as unknown as { localStorage: typeof fakeStorage }).localStorage = fakeStorage
  debugResetSave()
})

describe('выбор класса', () => {
  // САМАЯ ДОРОГАЯ ПОЛОМКА ЭТОГО МЕСТА: сейв, записанный за спиной у выбора,
  // ставит в него класс по умолчанию — и следующая загрузка находит сейв,
  // считает игру начатой и больше никогда ничего не спрашивает. Игрок
  // остаётся Стражем навсегда, ничего не выбрав.
  it('до выбора класса сейв не пишется вовсе', () => {
    expect(get(gameStarted)).toBe(false)
    persistNow()
    persistNow()
    expect(data.has(SAVE_KEY)).toBe(false)
  })

  it('выбор класса начинает игру и сохраняет ИМЕННО выбранный класс', () => {
    startNewGame('reaver')
    expect(get(gameStarted)).toBe(true)
    expect(get(gameState).classId).toBe('reaver')
    expect(data.get(SAVE_KEY)).toContain('reaver')
  })

  it('после выбора сейв пишется как обычно', () => {
    startNewGame('warden')
    data.delete(SAVE_KEY)
    persistNow()
    expect(data.has(SAVE_KEY)).toBe(true)
  })

  // Перезагрузка страницы: сейва нет — значит выбор ещё впереди.
  it('без сейва загрузка не считает игру начатой', () => {
    initGame()
    expect(get(gameStarted)).toBe(false)
    expect(data.has(SAVE_KEY)).toBe(false)
  })

  it('с сейвом загрузка игру начинает и выбор не показывает', () => {
    startNewGame('reaver')
    debugResetSaveKeepingStorage()
    initGame()
    expect(get(gameStarted)).toBe(true)
    expect(get(gameState).classId).toBe('reaver')
  })
})

/** Снимает флаг начатой игры, не трогая хранилище: так выглядит перезагрузка. */
function debugResetSaveKeepingStorage(): void {
  const saved = data.get(SAVE_KEY)
  debugResetSave()
  if (saved !== undefined) data.set(SAVE_KEY, saved)
}

describe('сброс сейва', () => {
  // Кнопка обещает «стереть сейв и начать заново». Она СТИРАЛА не сейв, а
  // прогресс: записывала поверх свежего Стража и оставляла игру начатой.
  // После такого «сброса» выбор класса не возвращался никогда.
  it('стирает сейв, а не переписывает его', () => {
    startNewGame('reaver')
    expect(data.has(SAVE_KEY)).toBe(true)
    debugResetSave()
    expect(data.has(SAVE_KEY)).toBe(false)
  })

  it('возвращает выбор класса', () => {
    startNewGame('reaver')
    debugResetSave()
    expect(get(gameStarted)).toBe(false)
    // И следующая загрузка тоже: стирать надо так, чтобы пережило перезагрузку.
    initGame()
    expect(get(gameStarted)).toBe(false)
  })

  it('после сброса можно выбрать ДРУГОЙ класс', () => {
    startNewGame('reaver')
    debugResetSave()
    startNewGame('warden')
    expect(get(gameState).classId).toBe('warden')
  })
})

describe('режим съёмки', () => {
  // Пресет — это НАЧАТАЯ игра, а не пустой профиль: класс в нём уже выбран.
  // Без этого поверх снимка вставал выбор класса и накрывал собой всё —
  // и снимок, и нажатия. Тест держит именно это, потому что вручную такое
  // видно только глазами на картинке.
  it('пресет считается начатой игрой, выбор класса поверх не встаёт', () => {
    expect(get(gameStarted)).toBe(false)
    applyScreenshotState(createInitialState())
    expect(get(gameStarted)).toBe(true)
  })

  it('прокручивает тики: лог боя не пуст', () => {
    applyScreenshotState(createInitialState())
    expect(get(gameState).combatLog.length).toBeGreaterThan(0)
  })

  // Снимок не должен оставлять следов в хранилище игрока — даже если из него
  // нажать то, что обычно сохраняет. «Экспорт сейва» сохраняет заодно, и без
  // этого запрета ссылка со снимком клала пресет поверх настоящего героя.
  it('сейв игрока не трогает, что из него ни жми', () => {
    applyScreenshotState(createInitialState())
    persistNow()
    exportSaveString()
    expect(data.has(SAVE_KEY)).toBe(false)
  })
})

// ПРОГРЕСС НЕЛЬЗЯ ПОТЕРЯТЬ МОЛЧА (находки 2.2, 4.1 в AUDIT.md).
describe('отказ записи виден игроку', () => {
  function breakStorage(setItem: () => never) {
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem,
      removeItem: (k: string) => void data.delete(k),
    }
  }

  it('игра идёт, сохранить не может — уведомление поднимается', () => {
    startNewGame('warden')
    expect(get(saveNotice)).toBeNull()
    breakStorage(() => {
      throw new Error('write failed')
    })
    persistNow()
    // Раньше здесь был пустой catch: игра три часа шла, ничего не сохраняя,
    // и игрок узнавал об этом, вернувшись к первому уровню.
    expect(get(saveNotice)).toBe('save-write-failed')
  })

  it('переполнение квоты называется своим кодом', () => {
    startNewGame('warden')
    breakStorage(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    })
    persistNow()
    expect(get(saveNotice)).toBe('save-quota-exceeded')
  })

  it('говорит ОДИН РАЗ за сессию, а не на каждый автосейв', () => {
    // Автосейв идёт раз в несколько секунд. Одинаковые сообщения подряд
    // игрок закрывает не читая — то есть остаётся так же не предупреждён.
    startNewGame('warden')
    breakStorage(() => {
      throw new Error('write failed')
    })
    persistNow()
    dismissNotice()
    persistNow()
    persistNow()
    expect(get(saveNotice)).toBeNull()
  })

  it('исключение наружу не выходит', () => {
    startNewGame('warden')
    breakStorage(() => {
      throw new Error('SecurityError')
    })
    expect(() => persistNow()).not.toThrow()
  })
})

describe('импорт сейва', () => {
  it('строку читает ДО замены: мусор не трогает героя', () => {
    startNewGame('reaver')
    const before = get(gameState).classId
    expect(previewSaveString('это не сейв')).toBeNull()
    expect(importSaveString('это не сейв')).toBe(false)
    expect(get(gameState).classId).toBe(before)
    expect(get(saveNotice)).toBe('import-invalid')
  })

  it('называет обоих героев до замены', () => {
    startNewGame('warden')
    const mine = currentSavePreview()
    expect(mine).toMatchObject({ level: 1 })
    // Строка чужого героя разбирается, но НИЧЕГО не меняет.
    const other = exportSaveString()
    expect(previewSaveString(other)).toMatchObject({ level: 1 })
    expect(get(gameState).classId).toBe('warden')
  })

  it('кладёт прежнего героя в запасную копию ДО замены', () => {
    startNewGame('warden')
    const mine = exportSaveString()
    debugResetSave()
    startNewGame('reaver')
    expect(backupSaveString()).toBeNull()
    // Импортируем чужого — своего обязаны сохранить.
    expect(importSaveString(mine)).toBe(true)
    expect(get(gameState).classId).toBe('warden')
    const saved = backupSaveString()
    expect(saved).not.toBeNull()
    // И копия — это именно прежний герой, а не тот, кого только что загрузили.
    expect(previewSaveString(saved!)).not.toBeNull()
    expect(data.has(SAVE_BACKUP_KEY)).toBe(true)
  })
})
