// Настройки интерфейса: раздел, текстовый режим, лимит кадров, громкости.
//
// Живут ОТДЕЛЬНО от игрового сейва и намеренно: это настройки конкретной
// машины, а не прогресс. Утащить их вместе с экспортом сейва на другой
// компьютер значило бы принести туда лимит кадров слабого ноутбука и
// текстовый режим машины без WebGL. Поэтому свой ключ в localStorage,
// своя версия и никакого влияния на формат сейва.
import { get, readonly, writable } from 'svelte/store'
import { SOUND_DEFAULT_VOLUMES } from '../data/balance'

export const UI_SETTINGS_KEY = 'idle-rpg:ui'

// Разделы интерфейса. Порядок задаёт порядок вкладок.
//
// «Персонажа» среди них НЕТ намеренно: к статам и экипировке обращаются
// постоянно, а вкладка — это место, куда уходишь надолго. Они переехали
// в выдвижку «Герой», которая открывается поверх нижней части экрана
// и не трогает боевую сцену.
export type SectionId = 'progress' | 'bag' | 'world' | 'settings'

export const SECTION_IDS: SectionId[] = ['progress', 'bag', 'world', 'settings']

/**
 * Выдвижки поверх нижней части экрана: «Герой» (статы и экипировка) и
 * «Журнал» (лог боя). Журнал свёрнут по умолчанию — лента событий полезна,
 * когда её спросили, а постоянно занимать ею экран не за что.
 */
export type DrawerId = 'hero' | 'log'

export const DRAWER_IDS: DrawerId[] = ['hero', 'log']

/**
 * Текстовый режим. 'auto' — включается сам, если WebGL недоступен;
 * 'on' / 'off' — явный выбор игрока, он сильнее автоопределения.
 */
export type TextModeSetting = 'auto' | 'on' | 'off'

/** Ограничение частоты кадров; null — без ограничения. */
export type FpsLimit = number | null

// 60 / 30 / 15 и по умолчанию 30. Тридцать — не компромисс, а осознанный
// выбор: сцена и так рисуется не чаще тридцати кадров (показывать в ней
// нечего, что требовало бы шестидесяти), а телефон за лишние кадры платит
// нагревом и батареей. Шестьдесят оставлены для тех, кто хочет плавности,
// пятнадцать — для слабых машин.
export const FPS_LIMITS: FpsLimit[] = [60, 30, 15]

/** Громкости: общая и по категориям звука. Доли 0..1. */
export type VolumeId = 'master' | 'combat' | 'loot' | 'ui'

export const VOLUME_IDS: VolumeId[] = ['master', 'combat', 'loot', 'ui']

export interface UiSettings {
  textMode: TextModeSetting
  fpsLimit: FpsLimit
  // Громкость — свойство машины и наушников, а не прогресс: место ей здесь,
  // а не в сейве. Экспорт сейва не должен увозить на чужой компьютер
  // выключенный звук.
  volumes: Record<VolumeId, number>
  // Открытые выдвижки — тоже «как я смотрю», а не прогресс: место им здесь,
  // рядом с текстовым режимом, а не в сейве.
  drawers: Record<DrawerId, boolean>
}

const DEFAULTS: UiSettings = {
  textMode: 'auto',
  fpsLimit: 30,
  volumes: { ...SOUND_DEFAULT_VOLUMES },
  drawers: { hero: false, log: false },
}

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

// Сцена может не завестись и после успешной проверки выше: контекст WebGL
// дают не всегда (старый драйвер, политика браузера, исчерпанный лимит
// контекстов), да и чанк с three может не доехать. Это факт машины
// текущего запуска, а не настройка, поэтому в localStorage он не пишется:
// на следующей загрузке игра снова попробует показать сцену.
const sceneFailed = writable(false)
export const sceneUnavailable = readonly(sceneFailed)

/**
 * Слой 3D сообщает, что сцены не будет. ЕДИНСТВЕННАЯ запись, которую он
 * делает наружу, и та в настройки интерфейса, а не в состояние игры:
 * без неё игрок остался бы смотреть на чёрный прямоугольник.
 */
export function reportSceneFailure(): void {
  sceneFailed.set(true)
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
  // Громкость принимаем только числом из 0..1: мусор из localStorage не
  // должен ни оглушить, ни выключить звук навсегда.
  const volumes = { ...DEFAULTS.volumes }
  const raw2 = (data as { volumes?: unknown }).volumes
  if (typeof raw2 === 'object' && raw2 !== null) {
    for (const id of VOLUME_IDS) {
      const value = (raw2 as Record<string, unknown>)[id]
      if (typeof value === 'number' && Number.isFinite(value)) {
        volumes[id] = Math.min(1, Math.max(0, value))
      }
    }
  }
  // Выдвижки принимаем только булевыми: мусор в localStorage не должен
  // оставить игрока с наполовину открытой панелью.
  const drawers = { ...DEFAULTS.drawers }
  const rawDrawers = (data as { drawers?: unknown }).drawers
  if (typeof rawDrawers === 'object' && rawDrawers !== null) {
    let taken = false
    for (const id of DRAWER_IDS) {
      const value = (rawDrawers as Record<string, unknown>)[id]
      // Открытая может быть только одна: листы прибиты к низу окна одним
      // и тем же `bottom` и, открытые разом, лежат друг на друге. Запись
      // с двумя открытыми — это либо правка руками, либо настройки старой
      // сборки; берём первую и закрываем вторую.
      if (typeof value === 'boolean' && value && !taken) {
        drawers[id] = true
        taken = true
      }
    }
  }
  return { textMode, fpsLimit, volumes, drawers }
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

export function setDrawer(id: DrawerId, open: boolean): void {
  settings.update((s) => {
    if (s.drawers[id] === open) return s
    // Открытая выдвижка ЗАКРЫВАЕТ вторую. Обе прибиты к низу окна одним и
    // тем же `bottom` — открытые разом, они просто лежали друг на друге,
    // и виден был только тот лист, что позже в разметке.
    const drawers = open
      ? (Object.fromEntries(DRAWER_IDS.map((x) => [x, x === id])) as Record<DrawerId, boolean>)
      : { ...s.drawers, [id]: false }
    const next = { ...s, drawers }
    persist(next)
    return next
  })
}

export function toggleDrawer(id: DrawerId): void {
  setDrawer(id, !get(settings).drawers[id])
}

export function setVolume(id: VolumeId, value: number): void {
  const clamped = Math.min(1, Math.max(0, value))
  settings.update((s) => {
    const next = { ...s, volumes: { ...s.volumes, [id]: clamped } }
    persist(next)
    return next
  })
}

// --- Жест игрока -------------------------------------------------------

// Звук молчит до первого жеста. Это не только требование браузеров: игра,
// которая начинает шуметь сама, — это игра, которую закрывают. Флаг живёт
// в памяти и в localStorage не пишется: «я уже кликал» — свойство ЭТОЙ
// вкладки, а не машины.
const gestured = writable(false)
export const soundUnlocked = readonly(gestured)

export function reportUserGesture(): void {
  if (!get(gestured)) gestured.set(true)
}

// --- Активный раздел ---------------------------------------------------

// Раздел в localStorage не пишем: это «где я был», а не настройка. После
// перезагрузки игрок хочет видеть бой, а не вкладку настроек.
const section = writable<SectionId>('progress')
export const activeSection = readonly(section)

export function setSection(id: SectionId): void {
  section.set(id)
}
