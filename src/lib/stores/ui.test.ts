import { describe, expect, it } from 'vitest'
import {
  MENU_IDS,
  MENU_SIDE,
  MENU_UNLOCK_LEVEL,
  isTextMode,
  menuUnlocked,
  menusOn,
  sanitizeUiSettings,
  type UiSettings,
} from './ui'
import { CRAFT_UNLOCK_LEVEL, SOUND_DEFAULT_VOLUMES, TALENT_FIRST_LEVEL } from '../data/balance'

describe('настройки интерфейса: разбор сохранённого', () => {
  it('пустое и мусорное значение дают настройки по умолчанию', () => {
    for (const raw of [null, undefined, 42, 'строка', [], {}]) {
      expect(sanitizeUiSettings(raw)).toEqual({
        textMode: 'auto',
        volumes: SOUND_DEFAULT_VOLUMES,
      })
    }
  })

  it('известные значения проходят как есть', () => {
    expect(sanitizeUiSettings({ textMode: 'on' })).toEqual({
      textMode: 'on',
      volumes: SOUND_DEFAULT_VOLUMES,
    })
    expect(sanitizeUiSettings({ textMode: 'off' })).toEqual({
      textMode: 'off',
      volumes: SOUND_DEFAULT_VOLUMES,
    })
  })

  it('лимит кадров из настроек прежних сборок выбрасывается, остальное читается', () => {
    // Лимита кадров больше нет: после удаления трёхмерного слоя он резал
    // только игровой цикл. В localStorage у старых игроков он ещё лежит —
    // запись обязана читаться, а лишний ключ не должен прорасти в настройки.
    const settings = sanitizeUiSettings({ textMode: 'on', fpsLimit: 30 })
    expect(settings.textMode).toBe('on')
    expect('fpsLimit' in settings).toBe(false)
  })

  it('неизвестный режим отображения откатывается к автоопределению', () => {
    expect(sanitizeUiSettings({ textMode: 'graphics' }).textMode).toBe('auto')
  })

  it('громкость из мусора не оглушает и не выключает звук навсегда', () => {
    // Настройки лежат в localStorage, куда мог залезть кто угодно.
    const loud = sanitizeUiSettings({ volumes: { master: 12, combat: -3, ui: 'громко' } })
    expect(loud.volumes.master).toBe(1)
    expect(loud.volumes.combat).toBe(0)
    expect(loud.volumes.ui).toBe(SOUND_DEFAULT_VOLUMES.ui)
    expect(sanitizeUiSettings({}).volumes).toEqual(SOUND_DEFAULT_VOLUMES)
  })
})

describe('текстовый режим', () => {
  const settings = (textMode: UiSettings['textMode']): UiSettings => ({
    textMode,
    volumes: { ...SOUND_DEFAULT_VOLUMES },
  })

  it('явный выбор игрока решает: «всегда текст» — текст, «всегда сцена» — сцена', () => {
    expect(isTextMode(settings('on'))).toBe(true)
    expect(isTextMode(settings('off'))).toBe(false)
  })

  it('«как получится» — сцена: двумерной сцене не нужно ничего сверх страницы', () => {
    // Тест идёт в node: ни document, ни графики. Двумерной сцене это
    // безразлично — она рисуется обычными элементами, автоопределения нет.
    expect(isTextMode(settings('auto'))).toBe(false)
  })
})

describe('меню', () => {
  it('меню восемь: семь кнопок в столбцах и автокаст в ряду действий', () => {
    // Было четыре раздела и две выдвижки — два разных паттерна на одну
    // задачу. Стало семь одинаковых кнопок в двух столбцах плюс автокаст:
    // он настраивает ряд умений и стоит вплотную к нему, а не в столбце.
    expect(MENU_IDS).toEqual([
      'hero',
      'bag',
      'world',
      'talents',
      'craft',
      'log',
      'settings',
      'autocast',
    ])
    expect(new Set(MENU_IDS).size).toBe(MENU_IDS.length)
  })

  it('СЛЕВА — ГДЕ МЕНЯЕШЬ, СПРАВА — ГДЕ ЧИТАЕШЬ', () => {
    // Правило записано данными, а не расстановкой в разметке: иначе
    // следующая кнопка встанет наугад. Журнал и настройки героя не
    // меняют — они справа; всё остальное меняет.
    expect(menusOn('left')).toEqual(['hero', 'bag', 'world', 'talents', 'craft'])
    expect(menusOn('right')).toEqual(['log', 'settings'])
  })

  it('у каждого меню есть сторона, и лишних сторон нет', () => {
    for (const id of MENU_IDS) expect(MENU_SIDE[id]).toMatch(/^(left|right|row)$/)
    expect(Object.keys(MENU_SIDE).sort()).toEqual([...MENU_IDS].sort())
    // Сторона `row` ровно одна: это исключение, а не третий столбец.
    expect(MENU_IDS.filter((id) => MENU_SIDE[id] === 'row')).toEqual(['autocast'])
  })

  it('ЗАКРЫТОЕ НЕ ВИДНО ВОВСЕ — и это про сами кнопки, а не только панели', () => {
    // Игрок первого уровня видел «Таланты» и «Крафт» и открывал пустоту.
    // Порог — тот же, по которому механика открывается на самом деле.
    expect(menusOn('left', 1)).toEqual(['hero', 'bag', 'world'])
    expect(menusOn('left', TALENT_FIRST_LEVEL)).toEqual(['hero', 'bag', 'world', 'talents'])
    expect(menusOn('left', CRAFT_UNLOCK_LEVEL)).toEqual([
      'hero',
      'bag',
      'world',
      'talents',
      'craft',
    ])
    // Справа порогов нет: журнал и настройки осмысленны с первой секунды.
    expect(menusOn('right', 1)).toEqual(['log', 'settings'])
    // И автокаст тоже: одно умение у героя есть с первого уровня.
    expect(menuUnlocked('autocast', 1)).toBe(true)
  })

  it('порог кнопки берётся из данных, а не пишется числом', () => {
    // Иначе он разъедется с порогом самой механики, и кнопка начнёт врать
    // молча — ровно так, как врал «0 шанс блока».
    expect(MENU_UNLOCK_LEVEL.talents).toBe(TALENT_FIRST_LEVEL)
    expect(MENU_UNLOCK_LEVEL.craft).toBe(CRAFT_UNLOCK_LEVEL)
    // У остальных порога нет вовсе — их видно сразу.
    const gated = Object.keys(MENU_UNLOCK_LEVEL).sort()
    expect(gated).toEqual(['craft', 'talents'])
  })

  it('открытое меню не хранится в настройках машины', () => {
    // «Где я сейчас» — не настройка: после перезагрузки игрок хочет видеть
    // бой, а не вкладку настроек. Ключ прежних выдвижек из localStorage
    // отбрасывается сам — собирается новый объект, а не чинится старый.
    const settings = sanitizeUiSettings({ textMode: 'on', drawers: { hero: true, log: true } })
    expect('drawers' in settings).toBe(false)
    expect(settings.textMode).toBe('on')
  })
})
