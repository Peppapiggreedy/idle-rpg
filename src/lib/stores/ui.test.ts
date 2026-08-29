import { describe, expect, it } from 'vitest'
import {
  FPS_LIMITS,
  SECTION_IDS,
  isTextMode,
  sanitizeUiSettings,
  type UiSettings,
} from './ui'
import { SOUND_DEFAULT_VOLUMES } from '../data/balance'

describe('настройки интерфейса: разбор сохранённого', () => {
  it('пустое и мусорное значение дают настройки по умолчанию', () => {
    for (const raw of [null, undefined, 42, 'строка', [], {}]) {
      expect(sanitizeUiSettings(raw)).toEqual({
        textMode: 'auto',
        fpsLimit: 30,
        volumes: SOUND_DEFAULT_VOLUMES,
        drawers: { hero: false, log: false },
      })
    }
  })

  it('известные значения проходят как есть', () => {
    expect(sanitizeUiSettings({ textMode: 'on', fpsLimit: 30 })).toEqual({
      textMode: 'on',
      fpsLimit: 30,
      volumes: SOUND_DEFAULT_VOLUMES,
      drawers: { hero: false, log: false },
    })
    expect(sanitizeUiSettings({ textMode: 'off', fpsLimit: 60 })).toEqual({
      textMode: 'off',
      fpsLimit: 60,
      volumes: SOUND_DEFAULT_VOLUMES,
      drawers: { hero: false, log: false },
    })
    // null допустим: так записаны настройки, сохранённые до появления
    // значения по умолчанию 30. Терять их из-за смены списка нельзя.
    expect(sanitizeUiSettings({ textMode: 'auto', fpsLimit: null }).fpsLimit).toBeNull()
  })

  it('лимит кадров принимается ТОЛЬКО из известного списка', () => {
    // Иначе подправленный руками localStorage мог бы выставить один кадр
    // в секунду — и игра выглядела бы сломанной без единой ошибки.
    for (const bad of [1, 0, -30, 9999, '60', Number.NaN, Infinity]) {
      expect(sanitizeUiSettings({ fpsLimit: bad }).fpsLimit).toBe(30)
    }
    for (const good of FPS_LIMITS) {
      expect(sanitizeUiSettings({ fpsLimit: good }).fpsLimit).toBe(good)
    }
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
    fpsLimit: null,
    volumes: { ...SOUND_DEFAULT_VOLUMES },
    drawers: { hero: false, log: false },
  })

  it('явный выбор игрока сильнее автоопределения', () => {
    // 'on' и 'off' обязаны работать одинаково независимо от того, есть
    // в браузере WebGL или нет.
    expect(isTextMode(settings('on'))).toBe(true)
    expect(isTextMode(settings('off'))).toBe(false)
  })

  it('в среде без WebGL «как получится» означает текст', () => {
    // Тест идёт в node: document нет, значит и WebGL нет — ровно тот случай,
    // ради которого текстовый режим и делался.
    expect(isTextMode(settings('auto'))).toBe(true)
  })
})

describe('разделы', () => {
  it('порядок вкладок фиксирован и без повторов', () => {
    // «Персонажа» среди вкладок нет: статы и экипировка живут в выдвижке
    // «Герой», к ним обращаются постоянно, а вкладка — про «уйти надолго».
    expect(SECTION_IDS).toEqual(['progress', 'bag', 'world', 'settings'])
    expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length)
  })
})

describe('выдвижки', () => {
  it('журнал свёрнут по умолчанию', () => {
    // Лента событий полезна, когда её спросили; постоянно занимать ею
    // экран не за что.
    expect(sanitizeUiSettings({}).drawers).toEqual({ hero: false, log: false })
  })

  it('состояние выдвижек переживает перезагрузку и чинится от мусора', () => {
    expect(sanitizeUiSettings({ drawers: { hero: false, log: true } }).drawers).toEqual({
      hero: false,
      log: true,
    })
    // Мусор в localStorage не должен оставить наполовину открытую панель.
    const junk = sanitizeUiSettings({ drawers: { hero: 'да', log: 1 } })
    expect(junk.drawers).toEqual({ hero: false, log: false })
  })

  it('открытой может быть только одна', () => {
    // Оба листа прибиты к низу окна одним и тем же `bottom`: открытые
    // разом, они лежат друг на друге, и виден только тот, что позже
    // в разметке. Запись с двумя открытыми приходит из старой сборки
    // или из правки localStorage руками — вторую закрываем.
    expect(sanitizeUiSettings({ drawers: { hero: true, log: true } }).drawers).toEqual({
      hero: true,
      log: false,
    })
  })
})
