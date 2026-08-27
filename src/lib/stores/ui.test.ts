import { describe, expect, it } from 'vitest'
import {
  FPS_LIMITS,
  SECTION_IDS,
  isTextMode,
  sanitizeUiSettings,
  type UiSettings,
} from './ui'

describe('настройки интерфейса: разбор сохранённого', () => {
  it('пустое и мусорное значение дают настройки по умолчанию', () => {
    for (const raw of [null, undefined, 42, 'строка', [], {}]) {
      expect(sanitizeUiSettings(raw)).toEqual({ textMode: 'auto', fpsLimit: 30 })
    }
  })

  it('известные значения проходят как есть', () => {
    expect(sanitizeUiSettings({ textMode: 'on', fpsLimit: 30 })).toEqual({
      textMode: 'on',
      fpsLimit: 30,
    })
    expect(sanitizeUiSettings({ textMode: 'off', fpsLimit: 60 })).toEqual({
      textMode: 'off',
      fpsLimit: 60,
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
})

describe('текстовый режим', () => {
  const settings = (textMode: UiSettings['textMode']): UiSettings => ({
    textMode,
    fpsLimit: null,
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
    expect(SECTION_IDS).toEqual(['character', 'progress', 'bag', 'world', 'settings'])
    expect(new Set(SECTION_IDS).size).toBe(SECTION_IDS.length)
  })
})
