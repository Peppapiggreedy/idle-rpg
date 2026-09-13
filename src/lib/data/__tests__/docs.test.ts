// ДОКУМЕНТАЦИЯ СВЕРЯЕТСЯ С КОДОМ ПО ЗАКРЫТОМУ СПИСКУ ЧИСЕЛ.
//
// Проза не проверяется — это невозможно и не нужно. Проверяется ТАБЛИЦА
// СВЕРЯЕМЫХ ЧИСЕЛ: каждое число в ней обязано совпасть с константой кода, и
// сообщение об ошибке называет три вещи — какое число, в каком файле, с какой
// константой разошлось. Без этих трёх «документация врёт» не чинится, а
// пересказывается.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CLASSES } from '../classes'
import { DOC_FACTS, DOC_FACTS_FILE, DOC_FACTS_HEADING, type DocFact } from './docs-facts'

const ROOT = new URL('../../../../', import.meta.url)
const read = (file: string) => readFileSync(new URL(file, ROOT), 'utf8')

/**
 * Числа из таблицы документа: `| строка | 42 |`. Берётся РОВНО тот раздел,
 * что назван в списке, — таблиц в документе много, и чужая не должна попасть
 * под сверку.
 */
export function factsInDoc(text: string, heading: string): Map<string, number> {
  const start = text.indexOf(heading)
  if (start < 0) return new Map()
  const rest = text.slice(start + heading.length)
  const end = rest.search(/^## /m)
  const section = end < 0 ? rest : rest.slice(0, end)
  const out = new Map<string, number>()
  for (const line of section.split('\n')) {
    const m = /^\|\s*([^|]+?)\s*\|\s*([0-9]+)\s*\|/.exec(line)
    if (m) out.set(m[1].trim(), Number(m[2]))
  }
  return out
}

describe('документация сверяется с кодом', () => {
  const text = read(DOC_FACTS_FILE)
  const claimed = factsInDoc(text, DOC_FACTS_HEADING)

  it(`в ${DOC_FACTS_FILE} есть раздел «${DOC_FACTS_HEADING}» с таблицей`, () => {
    expect(
      claimed.size,
      `раздел «${DOC_FACTS_HEADING}» в ${DOC_FACTS_FILE} не найден или пуст`,
    ).toBeGreaterThan(0)
  })

  it.each(DOC_FACTS.map((f) => [f.label, f] as const))(
    '«%s» совпадает с кодом',
    (label, fact: DocFact) => {
      const actual = fact.actual()
      const value = claimed.get(label)
      expect(
        value,
        `в ${DOC_FACTS_FILE}, раздел «${DOC_FACTS_HEADING}», нет строки «${label}» — ` +
          `а она обязана быть: число берётся из ${fact.constant} и сейчас равно ${actual}`,
      ).toBeDefined()
      expect(
        value,
        `${DOC_FACTS_FILE}: «${label}» = ${value}, а ${fact.constant} = ${actual}`,
      ).toBe(actual)
    },
  )

  it('лишних строк в таблице нет — каждая сверяется', () => {
    const known = new Set(DOC_FACTS.map((f) => f.label))
    const extra = [...claimed.keys()].filter((k) => !known.has(k))
    expect(
      extra,
      `в таблице ${DOC_FACTS_FILE} есть строки, которых нет в DOC_FACTS: ${extra.join(', ')}. ` +
        'Число в документации без строки в списке никем не сторожится.',
    ).toEqual([])
  })

  it('умений поровну у всех классов — иначе одного числа в таблице мало', () => {
    const counts = CLASSES.map((c) => c.abilityIds.length)
    expect(new Set(counts).size, `умений по классам: ${counts.join(' / ')}`).toBe(1)
  })

  /**
   * БИТЫЙ ОБРАЗЕЦ. Сторож, который не падает на заведомо неверном числе, —
   * это не сторож. Подменяем число в тексте и требуем, чтобы разбор увидел
   * именно подменённое.
   */
  it('нарочно испорченное число ловится', () => {
    const fact = DOC_FACTS[0]
    const actual = fact.actual()
    const broken = text.replace(
      new RegExp(`(\\|\\s*${fact.label}\\s*\\|\\s*)${actual}(\\s*\\|)`),
      `$1${actual + 1}$2`,
    )
    expect(broken, 'подмена не удалась — строка в документе не найдена').not.toBe(text)
    expect(factsInDoc(broken, DOC_FACTS_HEADING).get(fact.label)).toBe(actual + 1)
  })
})
