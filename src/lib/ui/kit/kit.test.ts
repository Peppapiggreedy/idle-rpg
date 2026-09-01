import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { RARITIES } from '../../data/rarity'
import { rarityName, rarityStyle } from './rarity'

const UI_DIR = new URL('../', import.meta.url)
const KIT_DIR = new URL('./', import.meta.url)

function read(dir: URL, file: string): string {
  return readFileSync(new URL(file, dir), 'utf8')
}

function svelteFiles(dir: URL): string[] {
  return readdirSync(dir).filter((f) => f.endsWith('.svelte'))
}

describe('мост к цветам редкостей', () => {
  it('цвет берётся из данных, а не из второй копии', () => {
    for (const rarity of RARITIES) {
      expect(rarityStyle(rarity.id)).toBe(`--rarity-color: ${rarity.color}`)
      expect(rarityName(rarity.id)).toBe(rarity.name)
    }
  })

  it('в токенах нет ни одного цвета редкости', () => {
    const tokens = read(UI_DIR, 'tokens.css')
    for (const rarity of RARITIES) {
      expect(tokens.toLowerCase()).not.toContain(rarity.color.toLowerCase())
    }
  })
})

describe('дизайн-система: компоненты живут на токенах', () => {
  // Правило PR: в компонентах не осталось ни hex-литералов, ни магических
  // отступов. Тест держит его на будущее — иначе первый же новый компонент
  // принесёт свой цвет, и единственный источник перестанет быть единственным.
  const HEX = /#[0-9a-fA-F]{3,8}\b/
  const RGB = /rgba?\(/
  const SPACING = /(?:^|[\s;{])(?:margin|padding|gap|row-gap|column-gap)[a-z-]*:\s*[^;]*\d/

  const files = [
    ...svelteFiles(UI_DIR).map((f) => [`ui/${f}`, read(UI_DIR, f)] as const),
    ...svelteFiles(KIT_DIR).map((f) => [`ui/kit/${f}`, read(KIT_DIR, f)] as const),
  ]

  // Стили лежат в блоке <style> — разметку и скрипт не проверяем: там
  // законно встречаются и числа, и шестнадцатеричные литералы данных.
  function styleOf(source: string): string {
    const match = source.match(/<style>([\s\S]*?)<\/style>/)
    return match ? match[1] : ''
  }

  it.each(files)('%s: без hex и rgb в стилях', (_name, source) => {
    const style = styleOf(source)
    expect(HEX.test(style)).toBe(false)
    expect(RGB.test(style)).toBe(false)
  })

  // Каждая часть значения обязана быть либо величиной из шкалы, либо нулём,
  // либо ключевым словом раскладки: `margin: 0 auto` — это центрирование,
  // а не отступ, и шкала тут ни при чём.
  const ALLOWED = /^(0|auto|inherit|initial|unset|var\(--space-\d\))$/

  it.each(files)('%s: отступы только из шкалы', (_name, source) => {
    const offenders = styleOf(source)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => SPACING.test(line))
      .filter((line) => {
        const value = line.slice(line.indexOf(':') + 1).replace(/;$/, '').trim()
        // var(--space-N) содержит пробелы только между частями значения.
        return !value.split(/\s+/).every((part) => ALLOWED.test(part))
      })
    expect(offenders).toEqual([])
  })
})

// ОБЩАЯ ЗАДЕРЖКА ПОКАЗЫВАЕТСЯ ТАМ, ГДЕ НУЖНА, И ТЕМ ЖЕ ЯЗЫКОМ.
//
// Она жила в двух местах сразу: тонкой полоской у полоски замаха (которая
// про оружие, а не про умения) и такой же полоской внизу иконки. Ни там, ни
// там она не читалась как «кнопку пока нельзя». Теперь язык один — заливка
// иконки снизу вверх, как у обычного кулдауна умения.
describe('общая задержка', () => {
  it('у полоски замаха её нет вовсе', () => {
    const swing = read(UI_DIR, 'SwingIndicator.svelte')
    expect(swing).not.toContain('gcd')
    expect(swing).not.toContain('GCD_MS')
  })

  it('на иконке умения она — заливка по высоте, а не полоска по ширине', () => {
    const bar = read(UI_DIR, 'ActionBar.svelte')
    expect(bar).toMatch(/class="gcd"\s+style="height:/)
    expect(bar).not.toMatch(/class="gcd"\s+style="width:/)
  })
})
