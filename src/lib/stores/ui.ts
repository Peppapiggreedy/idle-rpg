// Настройки интерфейса: раздел, текстовый режим, лимит кадров.
//
// Живут ОТДЕЛЬНО от игрового сейва и намеренно: это настройки конкретной
// машины, а не прогресс. Утащить их вместе с экспортом сейва на другой
// компьютер значило бы принести туда лимит кадров слабого ноутбука и
// текстовый режим машины без WebGL. Поэтому свой ключ в localStorage,
// своя версия и никакого влияния на формат сейва.
import { get, readonly, writable } from 'svelte/store'

export const UI_SETTINGS_KEY = 'idle-rpg:ui'

/** Разделы интерфейса. Порядок задаёт порядок вкладок. */
export type SectionId = 'character' | 'progress' | 'bag' | 'world' | 'settings'

export const SECTION_IDS: SectionId[] = [
  'character',
  'progress',
  'bag',
  'world',
  'settings',
]

/**
 * Текстовый режим. 'auto' — включается сам, если WebGL недоступен;
 * 'on' / 'off' — явный выбор игрока, он сильнее автоопределения.
 */
export type TextModeSetting = 'auto' | 'on' | 'off'

/** Ограничение частоты кадров; null — без ограничения. */
export type FpsLimit = number | null

export const FPS_LIMITS: FpsLimit[] = [30, 60, null]

export interface UiSettings {
  textMode: TextModeSetting
  fpsLimit: FpsLimit
}

const DEFAULTS: UiSettings = { textMode: 'auto', fpsLimit: null }

// --- Доступность WebGL -------------------------------------------------

let webglChecked = false
let webglOk = true

/**
 * Есть ли в браузере WebGL. Проверяем ОДИН раз и запоминаем: создавать
 * контексты на каждый рендер нельзя — их число в браузере ограничено.
 * Контекст сразу отпускаем, чтобы не занимать слот у настоящей сцены.
 */
export function hasWebgl(): boolean {
  if (webglChecked) return webglOk
  webglChecked = true
  try {
    const canvas = document.createElement('canvas')
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl')
    webglOk = gl !== null
    // Освобождаем контекст сразу: их в браузере конечное число.
    const lose = (gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')
    lose?.loseContext()
  } catch {
    webglOk = false
  }
  return webglOk
}

// --- Хранилище ---------------------------------------------------------

/** Разбор сохранённых настроек. Экспортируется ради теста: мусор из
 *  localStorage не должен превращаться в один кадр в секунду. */
export function sanitizeUiSettings(raw: unknown): UiSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const data = raw as Partial<UiSettings>
  const textMode: TextModeSetting =
    data.textMode === 'on' || data.textMode === 'off' || data.textMode === 'auto'
      ? data.textMode
      : DEFAULTS.textMode
  // Лимит принимаем только из известного списка: мусор из localStorage
  // не должен превратиться в единицу кадров в секунду.
  const fpsLimit: FpsLimit =
    data.fpsLimit === null || FPS_LIMITS.includes(data.fpsLimit ?? null)
      ? (data.fpsLimit ?? null)
      : DEFAULTS.fpsLimit
  return { textMode, fpsLimit }
}

function load(): UiSettings {
  try {
    const raw = globalThis.localStorage?.getItem(UI_SETTINGS_KEY)
    return raw ? sanitizeUiSettings(JSON.parse(raw)) : { ...DEFAULTS }
  } catch {
    // Приватный режим или битый json — играем с настройками по умолчанию.
    return { ...DEFAULTS }
  }
}

const settings = writable<UiSettings>(load())
export const uiSettings = readonly(settings)

function persist(next: UiSettings): void {
  try {
    globalThis.localStorage?.setItem(UI_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    /* нет localStorage — настройки живут до перезагрузки */
  }
}

/** Текстовый режим прямо сейчас: явный выбор игрока либо автоопределение. */
export function isTextMode(value: UiSettings = get(settings)): boolean {
  if (value.textMode === 'on') return true
  if (value.textMode === 'off') return false
  return !hasWebgl()
}

export function setTextMode(mode: TextModeSetting): void {
  settings.update((s) => {
    const next = { ...s, textMode: mode }
    persist(next)
    return next
  })
}

export function setFpsLimit(limit: FpsLimit): void {
  settings.update((s) => {
    const next = { ...s, fpsLimit: limit }
    persist(next)
    return next
  })
}

// --- Активный раздел ---------------------------------------------------

// Раздел в localStorage не пишем: это «где я был», а не настройка. После
// перезагрузки игрок хочет видеть бой, а не вкладку настроек.
const section = writable<SectionId>('character')
export const activeSection = readonly(section)

export function setSection(id: SectionId): void {
  section.set(id)
}
