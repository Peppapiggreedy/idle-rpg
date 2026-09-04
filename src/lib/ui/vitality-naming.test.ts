// ОДНО СЛОВО — ОДИН СМЫСЛ: «выносливость» это характеристика, «живучесть» ось.
//
// До этой правки «Живучесть» означала в игре две разные вещи одновременно:
// четвёртую базовую характеристику (StatId 'vitality', растит запас здоровья)
// и вторую ось апгрейда (survival, сколько урона герой держит за схватку).
// Обе стояли в ОДНОЙ карточке героя — плиткой сверху и строкой в списке, —
// и игрок читал два разных числа как одно.
//
// Сторож держит развод обоих слов и с обеих сторон: характеристика нигде не
// зовётся живучестью, ось нигде не зовётся выносливостью. Односторонняя
// проверка пропустила бы обратный съезд, а он тут ровно так же вероятен.
//
// Приём тот же, что в game/__tests__/rules.test.ts и ui/kit/kit.test.ts —
// обход исходников. И так же обязательно: КАЖДАЯ ПРОВЕРКА ПРОВЕРЕНА НА
// ЗАВЕДОМО БИТОМ ОБРАЗЦЕ. Сторож, которому нечего сказать, зелёный ровно так
// же, как сторож, который перестал работать.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { statNames } from './statFormat'
import { AXIS_NAME } from './axisText'

const UI_DIR = new URL('./', import.meta.url)

/**
 * ГДЕ СЛОВО «ЖИВУЧЕСТЬ» ЗАКОННО — и почему именно там. Список поимённый: он
 * же документация о том, что ось называется так намеренно, а не по недосмотру.
 */
const AXIS_SITES: Record<string, string> = {
  'axisText.ts': 'единственный на игру модуль названий осей: survival = Живучесть',
  'InventoryPanel.svelte': 'положение переключателя приоритета апгрейда — та же ось',
  'StatsPanel.svelte': 'плитка и строка карточки героя показывают axes.survival',
}

/** Файлы интерфейса: .ts и .svelte, без тестов и без вложенных папок. */
function uiSources(): Array<readonly [string, string]> {
  return readdirSync(UI_DIR)
    .filter((f) => f.endsWith('.ts') || f.endsWith('.svelte'))
    .filter((f) => !f.endsWith('.d.ts') && !f.endsWith('.test.ts'))
    .map((f) => [f, readFileSync(new URL(f, UI_DIR), 'utf8')] as const)
}

/**
 * ОСЬ ЛИ ЭТО. Слово стоит в разметке (`<span>Живучесть</span>`), а имя оси —
 * строкой рядом (`axes.survival`), поэтому смотреть надо ОКРЕСТНОСТЬ, а не
 * саму строку. Окно в две строки в обе стороны: больше — и проверка начнёт
 * оправдывать соседа через полкомпонента.
 */
function nearAxis(source: string, line: number): boolean {
  const lines = stripNonPlayerText(source).split('\n')
  const from = Math.max(0, line - 1 - 2)
  const window = lines.slice(from, line - 1 + 3).join(' ')
  return /survival|axes\./.test(window)
}

/**
 * Комментарии — не текст для игрока. Режем блочные, строчные и `<!-- -->`,
 * сохраняя переводы строк: номер строки в отчёте обязан остаться настоящим.
 */
export function stripNonPlayerText(source: string): string {
  const keepLines = (block: string) => '\n'.repeat((block.match(/\n/g) ?? []).length)
  const noHtml = source.replace(/<!--[\s\S]*?-->/g, keepLines)
  const noBlocks = noHtml.replace(/\/\*[\s\S]*?\*\//g, keepLines)
  return noBlocks
    .split('\n')
    .map((line) => {
      let quote: string | null = null
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i]
        if (quote) {
          if (ch === '\\') i += 1
          else if (ch === quote) quote = null
        } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
        else if (ch === '/' && line[i + 1] === '/') return line.slice(0, i)
      }
      return line
    })
    .join('\n')
}

/** Строки с искомым корнем: номер строки и сама строка. */
export function hits(source: string, root: RegExp): Array<readonly [number, string]> {
  return stripNonPlayerText(source)
    .split('\n')
    .map((line, i) => [i + 1, line.trim()] as const)
    .filter(([, line]) => root.test(line))
}

const ЖИВУЧ = /живуч/i
const ВЫНОСЛИВ = /выносли/i

describe('характеристика — выносливость, ось — живучесть', () => {
  it('реестр имён характеристик называет vitality выносливостью', () => {
    expect(statNames('warden').vitality).toBe('Выносливость')
  })

  it('модуль названий осей по-прежнему называет survival живучестью', () => {
    // Ось НЕ переименовывалась: она и есть «сколько герой держит».
    expect(AXIS_NAME.survival).toBe('Живучесть')
  })

  it('во всех реестрах падежей vitality — выносливость, и ни в одном не живучесть', () => {
    // Реестров четыре, лежат они в разных файлах и разъезжались уже дважды.
    // Здесь они сверяются по исходнику: импортировать константу из .svelte
    // нельзя, а разъехаться они могут ровно так же.
    const registries = [
      'statFormat.ts',
      'ItemMods.svelte',
      'TalentPanel.svelte',
      'potionText.ts',
      'StatsPanel.svelte',
    ]
    for (const name of registries) {
      const source = readFileSync(new URL(name, UI_DIR), 'utf8')
      const lines = stripNonPlayerText(source)
        .split('\n')
        .filter((l) => /\bvitality:\s*'/.test(l))
      expect(lines.length, `${name}: подпись vitality обязана быть`).toBeGreaterThan(0)
      for (const line of lines) {
        expect(ВЫНОСЛИВ.test(line), `${name}: «${line.trim()}» — ждали выносливость`).toBe(true)
        expect(ЖИВУЧ.test(line), `${name}: «${line.trim()}» всё ещё живучесть`).toBe(false)
      }
    }
  })

  it('слова «живучесть» в интерфейсе не осталось нигде, кроме оси', () => {
    // Файл из списка НЕ пропускается целиком: в StatsPanel ось и
    // характеристика соседствуют, и слепой пропуск файла узаконил бы возврат
    // старого имени в соседнюю строку. Каждое вхождение обязано доказать,
    // что оно про ось, — соседством с `survival`/`axes.`.
    const strays: string[] = []
    for (const [name, source] of uiSources()) {
      for (const [line, text] of hits(source, ЖИВУЧ)) {
        if (AXIS_SITES[name] && nearAxis(source, line)) continue
        strays.push(`${name}:${line} ${text}`)
      }
    }
    expect(strays, 'характеристика где-то ещё зовётся живучестью').toEqual([])
  })

  it('ось нигде не названа выносливостью — развод держится в обе стороны', () => {
    const strays: string[] = []
    for (const name of Object.keys(AXIS_SITES)) {
      const source = readFileSync(new URL(name, UI_DIR), 'utf8')
      // В этих файлах ось и характеристика соседствуют (StatsPanel), поэтому
      // ищем не «выносливость вообще», а её рядом с осью.
      for (const [line, text] of hits(source, /выносли/i)) {
        if (/survival|axes\./.test(text)) strays.push(`${name}:${line} ${text}`)
      }
    }
    expect(strays, 'ось где-то названа выносливостью').toEqual([])
  })

  // ЗАВЕДОМО БИТЫЕ ОБРАЗЦЫ. Без них сторож нельзя отличить от заглушки.
  it('сторож ловит характеристику, названную живучестью', () => {
    const broken = `const NAMES = {\n  vitality: 'живучесть',\n}\n`
    const lines = stripNonPlayerText(broken)
      .split('\n')
      .filter((l) => /\bvitality:\s*'/.test(l))
    expect(lines).toHaveLength(1)
    expect(ЖИВУЧ.test(lines[0])).toBe(true)
    expect(ВЫНОСЛИВ.test(lines[0])).toBe(false)
  })

  it('сторож не считает нарушением слово в комментарии', () => {
    const fine = `// живучесть — это ось, а не характеристика\nconst x = 1\n`
    expect(hits(fine, ЖИВУЧ)).toEqual([])
    const svelte = `<!-- живучесть в разметочном комментарии -->\n<b>ок</b>\n`
    expect(hits(svelte, ЖИВУЧ)).toEqual([])
  })

  it('сторож видит слово в разметке, а не только в кавычках', () => {
    const markup = `<span class="tile-name">Живучесть</span>\n`
    expect(hits(markup, ЖИВУЧ)).toHaveLength(1)
  })

  it('соседство с осью проверяется окном, и вне окна не оправдывает', () => {
    const near = `<span>{axes.survival}</span>\n<span>Живучесть</span>\n`
    expect(nearAxis(near, 2)).toBe(true)
    const far = ['const x = axes.survival', '', '', '', '', '<span>Живучесть</span>'].join('\n')
    expect(nearAxis(far, 6)).toBe(false)
  })
})
