// Настройки интерфейса: раздел, текстовый режим, громкости, выдвижки.
//
// Живут ОТДЕЛЬНО от игрового сейва и намеренно: это настройки конкретной
// машины, а не прогресс. Утащить их вместе с экспортом сейва на другой
// компьютер значило бы принести туда текстовый режим чужого экрана и
// выключенный звук чужих наушников. Поэтому свой ключ в localStorage,
// своя версия и никакого влияния на формат сейва.
import { get, readonly, writable } from 'svelte/store'
import { SOUND_DEFAULT_VOLUMES } from '../data/balance'
import type { SlotId } from '../data/slots'

export const UI_SETTINGS_KEY = 'idle-rpg:ui'

// МЕНЮ ИНТЕРФЕЙСА — ОДИН ПАТТЕРН НА ВСЁ. Раньше их было два: разделы
// (вкладки внизу) и выдвижки поверх нижней части экрана. Два способа
// показать панель означали два способа её закрыть, два места, где искать
// нужное, и вечный вопрос, куда класть следующее.
//
// СЛЕВА — ГДЕ МЕНЯЕШЬ, СПРАВА — ГДЕ ЧИТАЕШЬ. Правило разделения записано
// ДАННЫМИ (`MENU_SIDE`), а не расстановкой в разметке: иначе следующая
// кнопка встанет наугад. Журнал и настройки героя не меняют — они справа;
// всё остальное меняет.
export type MenuId = 'hero' | 'bag' | 'world' | 'talents' | 'craft' | 'log' | 'settings'

/** Порядок — порядок кнопок в столбце. */
export const MENU_IDS: MenuId[] = ['hero', 'bag', 'world', 'talents', 'craft', 'log', 'settings']

export type MenuSide = 'left' | 'right'

export const MENU_SIDE: Record<MenuId, MenuSide> = {
  hero: 'left',
  bag: 'left',
  world: 'left',
  talents: 'left',
  craft: 'left',
  log: 'right',
  settings: 'right',
}

export const menusOn = (side: MenuSide): MenuId[] =>
  MENU_IDS.filter((id) => MENU_SIDE[id] === side)

/**
 * Текстовый режим. 'auto' — сцена (двумерная рисуется обычными элементами
 * и заводится везде); 'on' / 'off' — явный выбор игрока.
 */
export type TextModeSetting = 'auto' | 'on' | 'off'

/** Громкости: общая и по категориям звука. Доли 0..1. */
export type VolumeId = 'master' | 'combat' | 'loot' | 'ui'

export const VOLUME_IDS: VolumeId[] = ['master', 'combat', 'loot', 'ui']

export interface UiSettings {
  textMode: TextModeSetting
  // Громкость — свойство машины и наушников, а не прогресс: место ей здесь,
  // а не в сейве. Экспорт сейва не должен увозить на чужой компьютер
  // выключенный звук.
  volumes: Record<VolumeId, number>
}

const DEFAULTS: UiSettings = {
  textMode: 'auto',
  volumes: { ...SOUND_DEFAULT_VOLUMES },
}

// --- Хранилище ---------------------------------------------------------

/** Разбор сохранённых настроек. Экспортируется ради теста: мусор из
 *  localStorage не должен ни оглушить игрока, ни спрятать половину панели.
 *  Лишние ключи — например `fpsLimit` из настроек прежних сборок — здесь
 *  же и отбрасываются: собирается новый объект, а не чинится старый. */
export function sanitizeUiSettings(raw: unknown): UiSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS }
  const data = raw as Partial<UiSettings>
  const textMode: TextModeSetting =
    data.textMode === 'on' || data.textMode === 'off' || data.textMode === 'auto'
      ? data.textMode
      : DEFAULTS.textMode
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
  // Ключа `drawers` здесь больше нет, и старая запись с ним отбрасывается
  // сама: собирается новый объект, а не чинится прежний. Открытое меню —
  // это «где я сейчас», а не настройка машины, и в localStorage ему не место.
  return { textMode, volumes }
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

/**
 * Текстовый режим прямо сейчас: только явный выбор игрока. Двумерной сцене
 * не нужно ничего сверх обычных элементов страницы, поэтому «как получится»
 * означает сцену — автоопределения больше нет.
 */
export function isTextMode(value: UiSettings = get(settings)): boolean {
  return value.textMode === 'on'
}

export function setTextMode(mode: TextModeSetting): void {
  settings.update((s) => {
    const next = { ...s, textMode: mode }
    persist(next)
    return next
  })
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

// --- Открытое меню -----------------------------------------------------

// ОДНО МЕНЮ ЗА РАЗ, и это единственное состояние экрана. Открытие второго
// закрывает первое само — не потому, что панели налезали бы друг на друга,
// а потому, что меню занимает основную площадь и делить её не с чем.
//
// В localStorage не пишем: это «где я сейчас», а не настройка. После
// перезагрузки игрок хочет видеть бой, а не вкладку настроек.
const menu = writable<MenuId | null>(null)
export const openMenu = readonly(menu)

export function setMenu(id: MenuId | null): void {
  menu.set(id)
}

/** Повторное нажатие той же кнопки закрывает меню. */
export function toggleMenu(id: MenuId): void {
  menu.update((current) => (current === id ? null : id))
}

export function closeMenu(): void {
  menu.set(null)
}

// --- Что игрок сейчас несёт --------------------------------------------

// ПЕРЕТАСКИВАНИЕ — ЭТО СОСТОЯНИЕ ЭКРАНА, А НЕ ИГРЫ. В сейве ему делать
// нечего: «я держу клинок над курткой» переживать перезагрузку не должно.
// Поэтому оно живёт здесь, рядом с открытым меню, и по тем же правилам.
//
// Источников ровно два: находка в сумке и надетая вещь. Третьего быть не
// может — предметы больше нигде не лежат.
export type Carry = { from: 'bag'; itemId: string } | { from: 'slot'; slot: SlotId }

export const sameCarry = (a: Carry | null, b: Carry | null): boolean => {
  if (a === null || b === null) return a === b
  if (a.from === 'bag' && b.from === 'bag') return a.itemId === b.itemId
  if (a.from === 'slot' && b.from === 'slot') return a.slot === b.slot
  return false
}

const carried = writable<Carry | null>(null)
export const carriedItem = readonly(carried)

export function takeItem(next: Carry): void {
  carried.set(next)
}

/** Повторное нажатие по той же вещи кладёт её обратно. */
export function toggleCarried(next: Carry): void {
  carried.update((current) => (sameCarry(current, next) ? null : next))
}

export function releaseItem(): void {
  carried.set(null)
}
