// Цвета сцены берутся из ui/tokens.css, а не заводятся заново.
//
// Правило проекта: tokens.css — единственный источник визуальных величин.
// Для WebGL это правило соблюсти можно ровно одним способом — прочитать
// вычисленные значения кастомных свойств со страницы. Иначе у игры появился
// бы второй набор цветов, который разъедется с первым при первой же правке
// палитры и никто этого не заметит: тест токенов смотрит в CSS, а не в three.

/** Какие токены нужны сцене и чем подменяются, если их не прочитать. */
export const SCENE_TOKENS = {
  ground: '--c-surface-raised',
  fog: '--c-bg',
  hero: '--c-accent',
  monster: '--c-damage',
  light: '--c-text',
} as const

export type SceneColorId = keyof typeof SCENE_TOKENS

/**
 * Запасные значения. Нужны там, где CSS не прочитать вовсе, — например,
 * в тесте под node. Это НЕ второй набор палитры: на живой странице они
 * никогда не применяются, и в сцене всегда те же цвета, что в интерфейсе.
 */
const FALLBACK: Record<SceneColorId, number> = {
  ground: 0x232833,
  fog: 0x14161a,
  hero: 0x2fcfe0,
  monster: 0xe05555,
  light: 0xe8eaf0,
}

/** `#rrggbb` или `#rgb` -> число для THREE.Color; null, если это не хекс. */
export function parseHexColor(value: string): number | null {
  const text = value.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text)
  if (short) {
    const [, r, g, b] = short
    return Number.parseInt(`${r}${r}${g}${g}${b}${b}`, 16)
  }
  const long = /^#([0-9a-f]{6})$/i.exec(text)
  return long ? Number.parseInt(long[1], 16) : null
}

/**
 * Палитра сцены со страницы. Читается ОДИН раз при создании сцены: тема
 * в игре одна и на лету не меняется, а getComputedStyle на каждый кадр
 * стоил бы пересчёта стилей 30 раз в секунду.
 */
export function readScenePalette(
  root: Element | null = typeof document === 'undefined' ? null : document.documentElement,
): Record<SceneColorId, number> {
  const result = { ...FALLBACK }
  if (!root || typeof getComputedStyle !== 'function') return result
  const style = getComputedStyle(root)
  for (const id of Object.keys(SCENE_TOKENS) as SceneColorId[]) {
    const parsed = parseHexColor(style.getPropertyValue(SCENE_TOKENS[id]))
    if (parsed !== null) result[id] = parsed
  }
  return result
}
