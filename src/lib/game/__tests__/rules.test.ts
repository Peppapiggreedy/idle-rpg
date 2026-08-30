// ЧЕТЫРЕ ПРАВИЛА CLAUDE.md, ЗА КОТОРЫМИ НЕ СТОЯЛО НИЧЕГО.
//
// Ревизия (AUDIT.md) насчитала двенадцать правил, которые не уронит ни один
// прогон. Четыре из них закрываются одним обходом исходников `src/lib/game`,
// и одно из четырёх CLAUDE.md прямо обещает: «держится grep-тестом по
// src/lib/game». Теста не существовало, а правило было уже нарушено.
//
// Образец такой проверки в проекте есть — `ui/kit/kit.test.ts` читает
// исходники компонентов и ловит hex-литералы и отступы числом. Здесь тот же
// приём, и так же обязательно: каждая проверка проверена НА ЗАВЕДОМО БИТОМ
// ОБРАЗЦЕ. Сторож, который перестал работать, зелёный ровно так же, как
// сторож, которому нечего сказать.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ZONES } from '../../data/zones'
import { ABILITIES } from '../../data/abilities'
import { TALENTS } from '../../data/talents'
import { CLASSES } from '../../data/classes'
import { ALL_DUNGEONS } from '../../data/dungeons'
import { RARITIES } from '../../data/rarity'
import { SLOT_IDS } from '../../data/slots'
import { MATERIALS } from '../../data/materials'
import { HERBS } from '../../data/herbs'
import { ENCHANTS } from '../../data/enchants'
import { PROCS } from '../../data/procs'
import { RECIPES } from '../../data/recipes'
import { STAT_IDS } from '../stats'

const GAME_DIR = new URL('../', import.meta.url)

/** Исходники логики: только .ts, без тестов и без папок. */
function sources(): Array<readonly [string, string]> {
  return readdirSync(GAME_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .map((f) => [f, readFileSync(new URL(f, GAME_DIR), 'utf8')] as const)
}

/** Комментарии — не код: в них живут и числа, и кириллица, и это правильно. */
function stripComments(source: string): string {
  // Блочные — целиком, строчные — до конца строки, но ТОЛЬКО вне кавычек:
  // наивная резка по `//` испортила бы строку с адресом внутри.
  // Номера строк обязаны сохраниться: блочный комментарий заменяем на
  // столько же переводов строки, а не выбрасываем.
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    '\n'.repeat((block.match(/\n/g) ?? []).length),
  )
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

// ---------------------------------------------------------------------------
// Правило 1. Случайность только через rng.ts
// ---------------------------------------------------------------------------

export function findMathRandom(file: string, source: string): string[] {
  if (file === 'rng.ts') return [] // сам генератор — единственное законное место
  return stripComments(source).includes('Math.random')
    ? [`${file}: Math.random — случайность идёт только через createRng (game/rng.ts)`]
    : []
}

// ---------------------------------------------------------------------------
// Правило 2. В game/ нет текста для игрока
// ---------------------------------------------------------------------------

export function findPlayerText(file: string, source: string): string[] {
  const out: string[] = []
  const code = stripComments(source)
  for (const m of code.matchAll(/['"`]([^'"`\n]*[а-яА-ЯёЁ][^'"`\n]*)['"`]/g)) {
    out.push(`${file}: строка «${m[1].slice(0, 50)}» — текст для игрока рендерит UI, а не логика`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Правило 3. Весь баланс живёт в data/
// ---------------------------------------------------------------------------

/**
 * ТЕХНИЧЕСКИЕ константы: у каждой записана причина, по которой она НЕ баланс.
 * Список ведётся руками намеренно — новое число обязано пройти этот разговор,
 * а не проскочить под общее правило.
 */
export const TECHNICAL_CONSTANTS: Record<string, string> = {
  'rest.ts:UNLUCKY_Z':
    'z-оценка 95-го процентиля нормального распределения — константа статистики, не игры',
  'save.ts:LEGACY_V18_XP_BASE':
    'число СТАРОГО формата сейва: миграция обязана считать теми числами, которыми сейв записан',
  'save.ts:LEGACY_V18_XP_EXPONENT':
    'то же самое: подставить сюда сегодняшний баланс значит испортить старый сейв',
  'tick.ts:MAX_REGEN_TICKS_PER_STEP':
    'предохранитель от зависания на огромном dt — свойство цикла, а не баланса',
}

export function findBalanceNumbers(file: string, source: string): string[] {
  const out: string[] = []
  const code = stripComments(source)
  for (const line of code.split('\n')) {
    const m = line.trim().match(/^const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*[\w<>]+\s*)?=\s*(-?[\d_.]+)\s*$/)
    if (!m) continue
    const key = `${file}:${m[1]}`
    if (key in TECHNICAL_CONSTANTS) continue
    out.push(`${key} = ${m[2]} — игровое число живёт в src/lib/data, а не в логике`)
  }
  return out
}

// ---------------------------------------------------------------------------
// Правило 4. Никаких ветвлений по конкретному id
// ---------------------------------------------------------------------------

/**
 * Идентификаторы КОНТЕНТА. Именно они не имеют права попадать в условия:
 * появится новая зона, талант или предмет — логика об этом знать не должна.
 *
 * Теги размеченных объединений (`kind`, `type`, `grip`) сюда НЕ входят, и это
 * не поблажка: CLAUDE.md прямо называет флаг с payload'ом тем механизмом,
 * которым поведение и включается. Ветвление по `mod.kind === 'flat'` — это
 * разбор формы данных, а не знание о конкретной сущности.
 */
export function contentIds(): Set<string> {
  return new Set<string>([
    ...ZONES.map((z) => z.id),
    ...ABILITIES.map((a) => a.id),
    ...TALENTS.map((t) => t.id),
    ...CLASSES.map((c) => c.id),
    ...ALL_DUNGEONS.map((d) => d.id),
    ...RARITIES.map((r) => r.id),
    ...SLOT_IDS,
    ...MATERIALS.map((m) => m.id),
    ...HERBS.map((h) => h.id),
    ...ENCHANTS.map((e) => e.id),
    ...PROCS.map((p) => p.id),
    ...RECIPES.map((r) => r.id),
    // Статы — тоже контент: именно ветка по «vitality» в разыгрывании брони
    // и была вторым известным нарушением этого правила.
    ...STAT_IDS,
  ])
}

/**
 * ИСКЛЮЧЕНИЯ с причиной. Пустой список был бы честнее, но неправдой: правила
 * ДВУХ РУК по своей природе говорят про две конкретные руки, и обойтись без
 * их имён нельзя — слот при этом остаётся данными для всего остального.
 */
export const ID_BRANCH_ALLOWED: Record<string, string> = {
  // ПРАВИЛА ДВУХ РУК по своей природе говорят про две конкретные руки:
  // «двуручное занимает обе», «щит — только во вторую», «левая бьёт слабее».
  // Обойтись без их имён нельзя, и слотом здесь работает не «какой-то слот из
  // данных», а сторона тела. Для всего остального слоты остаются данными:
  // ни один другой слот в этот список не попадает и попасть не должен.
  'crafting.ts:mainHand': 'рецепт кладёт базу боя только в руки',
  'crafting.ts:offHand': 'рецепт кладёт базу боя только в руки',
  'equipment.ts:mainHand': 'правила хвата: двуручное занимает обе руки',
  'equipment.ts:offHand': 'правила хвата: щит и вторая рука',
  'loot.ts:mainHand': 'в правую падает любое оружие, в левую — одноручное или щит',
  'loot.ts:offHand': 'в правую падает любое оружие, в левую — одноручное или щит',
  'state.ts:mainHand': 'сборка базы боя из надетого: у рук она своя',
  'state.ts:offHand': 'сборка базы боя из надетого: у рук она своя',
  'simulate.ts:mainHand': 'прибор собирает связку рук по заданию прогона',
  'simulate.ts:offHand': 'прибор собирает связку рук по заданию прогона',
  // Прогон СЧИТАЕТ РЕШЕНИЯ ИГРОКА: «находка выше обычной» — это порог
  // внимания, а не поведение игры. Числа отсюда в игру не попадают.
  'simulate.ts:common': 'счётчик решений в измерительном приборе, не поведение игры',
}

export function findIdBranches(file: string, source: string, ids: Set<string>): string[] {
  const out: string[] = []
  const code = stripComments(source)
  const lines = code.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    for (const m of lines[i].matchAll(/[!=]==\s*['"]([^'"]+)['"]|['"]([^'"]+)['"]\s*[!=]==/g)) {
      const value = m[1] ?? m[2]
      if (!ids.has(value)) continue
      const key = `${file}:${value}`
      if (key in ID_BRANCH_ALLOWED) continue
      out.push(`${file}:${i + 1}: сравнение с id «${value}» — поведение включается флагом из данных`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------

function allIssues(): string[] {
  const ids = contentIds()
  return sources().flatMap(([file, src]) => [
    ...findMathRandom(file, src),
    ...findPlayerText(file, src),
    ...findBalanceNumbers(file, src),
    ...findIdBranches(file, src, ids),
  ])
}

describe('четыре правила CLAUDE.md держатся прогоном', () => {
  it('в src/lib/game нет ни одного нарушения', () => {
    const issues = allIssues()
    // Список печатается целиком: упавший тест обязан сразу говорить, что
    // чинить, а не отправлять читать проверку.
    expect(issues, `\n${issues.join('\n')}\n`).toEqual([])
  })

  it('проверка вообще смотрит на файлы, а не на пустоту', () => {
    // Сторож, которому нечего проверять, зелёный так же, как рабочий.
    expect(sources().length).toBeGreaterThan(20)
    expect(sources().some(([f]) => f === 'combat.ts')).toBe(true)
  })
})

// КАЖДАЯ ПРОВЕРКА ПРОВЕРЕНА НА БИТОМ ОБРАЗЦЕ. Без этого нельзя утверждать,
// что она вообще срабатывает: тест, который не может упасть, ревизия нашла
// в этом же проекте (см. AUDIT.md, находка 6.1).
describe('проверки ловят заведомо битый код', () => {
  it('Math.random в логике', () => {
    expect(findMathRandom('combat.ts', 'const r = Math.random()')).toHaveLength(1)
    // А в самом генераторе — законно.
    expect(findMathRandom('rng.ts', 'const r = Math.random()')).toHaveLength(0)
    // В комментарии — не нарушение: там о нём как раз и пишут.
    expect(findMathRandom('combat.ts', '// Math.random тут запрещён')).toHaveLength(0)
  })

  it('текст для игрока в логике', () => {
    expect(findPlayerText('tick.ts', "const msg = 'Герой погиб'")).toHaveLength(1)
    // Комментарии по-русски — норма проекта, а не нарушение.
    expect(findPlayerText('tick.ts', '// Герой погиб — считаем воскрешение')).toHaveLength(0)
  })

  it('балансное число в логике', () => {
    expect(findBalanceNumbers('loot.ts', 'const SHIELD_SHARE = 0.4')).toHaveLength(1)
    // Техническая константа из списка — с объяснением, почему она не баланс.
    expect(findBalanceNumbers('rest.ts', 'const UNLUCKY_Z = 1.645')).toHaveLength(0)
  })

  it('ветвление по конкретному id', () => {
    const ids = contentIds()
    expect(findIdBranches('loot.ts', "if (primary === 'vitality') return []", ids)).toHaveLength(1)
    expect(findIdBranches('talents.ts', "if (id === 'wrath-frenzy') return 1", ids)).toHaveLength(1)
    expect(findIdBranches('zones.ts', "if (zone.id === 'shepherds-meadow') return 0", ids))
      .toHaveLength(1)
    // Тег размеченного объединения — это НЕ id контента: именно так правило
    // и предписывает включать поведение.
    expect(findIdBranches('stats.ts', "if (mod.kind === 'flat') return 1", ids)).toHaveLength(0)
    expect(findIdBranches('abilities.ts', "if (a.type === 'instant') return 1", ids)).toHaveLength(0)
    // Разрешённое исключение с причиной молчит.
    expect(findIdBranches('equipment.ts', "if (slot === 'mainHand') return 1", ids)).toHaveLength(0)
    // Но то же самое в другом файле — уже нарушение: список точечный.
    expect(findIdBranches('tick.ts', "if (slot === 'mainHand') return 1", ids)).toHaveLength(1)
  })

  it('у каждого исключения есть причина, а не пустая строка', () => {
    for (const [key, why] of Object.entries({ ...ID_BRANCH_ALLOWED, ...TECHNICAL_CONSTANTS })) {
      expect(why.length, key).toBeGreaterThan(20)
    }
  })
})
