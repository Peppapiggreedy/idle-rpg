import { describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import {
  MENU_IDS,
  MENU_SIDE,
  MENU_UNLOCK_LEVEL,
  clearTalentDraft,
  closeMenu,
  forgetTalentPoint,
  isTextMode,
  menuUnlocked,
  menusOn,
  noteTalentPoint,
  sanitizeUiSettings,
  setMenu,
  talentDraft,
  toggleMenu,
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

// ЧЕРНОВИК ЗАХОДА В ДЕРЕВО ТАЛАНТОВ.
//
// Очко, вложенное ПОКА ЭКРАН ОТКРЫТ, снимается бесплатно; всё остальное —
// платным сбросом. Значит, кто-то обязан помнить границу захода, и это не
// сейв: «сколько я успел вложить, пока смотрю на дерево» — типичное «где я
// сейчас», рядом с открытым меню и несомой вещью.
//
// САМОЕ ВАЖНОЕ ЗДЕСЬ — ЧТО ЧЕРНОВИК ЧИСТИТСЯ ВСЕМИ ТРЕМЯ ПУТЯМИ ЗАКРЫТИЯ.
// Забыть один — значит раздать бесплатный сброс: закрыл меню тем путём,
// про который забыли, открыл снова, и все прежние очки опять «этого захода».
describe('черновик талантов: заход в дерево', () => {
  it('очки копятся по таланту и снимаются по одному', () => {
    clearTalentDraft()
    noteTalentPoint('а')
    noteTalentPoint('а')
    noteTalentPoint('б')
    expect(get(talentDraft)).toEqual({ а: 2, б: 1 })

    forgetTalentPoint('а')
    expect(get(talentDraft)).toEqual({ а: 1, б: 1 })
    // Дошло до нуля — запись уходит совсем: ноль и отсутствие должны быть
    // одним состоянием, иначе черновик начнёт врать про «этот заход».
    forgetTalentPoint('а')
    expect(get(talentDraft)).toEqual({ б: 1 })
    forgetTalentPoint('б')
    expect(get(talentDraft)).toEqual({})
    // Снятие того, чего нет, ничего не портит.
    forgetTalentPoint('нет-такого')
    expect(get(talentDraft)).toEqual({})
  })

  it('ВСЕ ТРИ ПУТИ ЗАКРЫТИЯ чистят черновик', () => {
    // Esc и повторное нажатие своей кнопки закрывают через closeMenu и
    // toggleMenu, чужая кнопка — через setMenu. Пути разные, правило одно.
    const ways: Array<[string, () => void]> = [
      ['закрытие', () => closeMenu()],
      ['повторное нажатие', () => toggleMenu('talents')],
      ['другое меню', () => setMenu('hero')],
    ]
    for (const [name, close] of ways) {
      setMenu('talents')
      noteTalentPoint('а')
      expect(get(talentDraft), name).toEqual({ а: 1 })
      close()
      expect(get(talentDraft), name).toEqual({})
    }
    closeMenu()
  })

  it('переходы ВНУТРИ дерева черновик не трогают', () => {
    // Открыть «Таланты» поверх «Талантов» — это не новый заход: игрок никуда
    // не уходил, и снимать у него право на отмену не за что.
    setMenu('talents')
    clearTalentDraft()
    noteTalentPoint('а')
    setMenu('talents')
    expect(get(talentDraft)).toEqual({ а: 1 })
    closeMenu()
  })
})
