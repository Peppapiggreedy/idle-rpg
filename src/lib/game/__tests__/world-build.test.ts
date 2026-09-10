// КОНТРАКТЫ МИРА МЕРЯЮТСЯ БЕЗ ТАЛАНТОВ, И ЭТО СТОРОЖ, А НЕ ПОЖЕЛАНИЕ.
//
// Правило: темп боя, цена боя, смертность, доминирование зон, кран золота и
// разрыв уровней — про МИР. Талант к ним отношения не имеет, и герой, на
// котором они меряются, не должен нести ни одного очка (`REFERENCE_BUILD` в
// data/balance.ts).
//
// ЗАЧЕМ СТОРОЖ, ЕСЛИ СЕГОДНЯ ТАЛАНТОВ ТАМ И ТАК НЕТ. Затем, что они там БЫЛИ
// В ИМПОРТАХ: пять файлов контрактов и общая прелюдия тащили `branchPoints`,
// `pureBranchTalents`, `BRANCHES` и `BranchStyle`, ни разу их не вызывая, —
// хвост от разрезания одного большого `balance.test.ts`. Проверка типов это
// не ловит (`noUnusedLocals` стоит только в tsconfig.node/tests, а src идёт
// через tsconfig.app), то есть первая же правка могла дописать вызов, и
// контракт мира начал бы падать от таланта — молча и законно с точки зрения
// всех остальных проверок.
//
// Сторож дешёвый: он читает исходники, а не гоняет прогон, и потому живёт в
// быстром наборе.
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { CONTRACT_SEED } from './balance-shared'
import { REFERENCE_BUILD } from '../../data/balance'

const TESTS_DIR = new URL('.', import.meta.url).pathname

/**
 * ФАЙЛЫ КОНТРАКТОВ МИРА — СПИСКОМ, А НЕ ПО МАСКЕ. Маска `balance-*` захватила
 * бы и `balance-talents*`, и `balance-key-choices`, которым таланты положены
 * по определению: они про ветки, а не про мир. Список короткий, и каждая
 * строка объясняет, ЧТО именно этот файл держит.
 */
export const WORLD_CONTRACT_FILES: Record<string, string> = {
  'balance-pacing.test.ts': 'темп боя и цена боя по всем зонам',
  'balance-model.test.ts': 'модель против тика, интервал решений, доля привалов',
  'balance-zones.test.ts': 'доминирующая зона, скорость десятого уровня, смертность',
  'balance-style.test.ts': 'нормализация связок оружия',
  'balance-progress.test.ts': 'монотонность прогресса по зонам',
  'balance-shared.ts': 'общая прелюдия всех перечисленных',
  'gold.test.ts': 'кран золота и модель дохода',
  'level-gap.test.ts': 'штраф за отставание и множитель урона по разрыву уровней',
}

/**
 * ЧЕМ СТРОЯТ БИЛД С ТАЛАНТАМИ. Список закрытый: это все входы в дерево,
 * которыми пользуются прогоны. `TALENTS` и `TalentDef` сюда НЕ входят —
 * читать данные дерева контракту мира никто не запрещает (например, чтобы
 * назвать ветку в таблице); запрещено СТРОИТЬ героя с очками.
 */
const TALENT_BUILDERS = [
  'pureBranchTalents',
  'fillBranchRanks',
  'pathRanks',
  'pathsOf',
  'branchPoints',
  'BRANCH_PATHS',
]

/** Комментарии не в счёт: запрет про код, а не про объяснения рядом с ним. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Замечания вида «файл:строка — имя — почему нельзя». Пустой массив — чисто. */
export function findTalentBuilders(file: string, source: string): string[] {
  const out: string[] = []
  const code = stripComments(source)
  code.split('\n').forEach((line, index) => {
    for (const name of TALENT_BUILDERS) {
      if (!new RegExp(`\\b${name}\\b`).test(line)) continue
      out.push(
        `${file}:${index + 1} — ${name} — контракт мира меряется на эталонной сборке без талантов`,
      )
    }
  })
  return out
}

describe('контракты мира не знают о талантах', () => {
  it('ни один файл контрактов мира не строит билд с очками', () => {
    const found: string[] = []
    for (const file of Object.keys(WORLD_CONTRACT_FILES)) {
      const path = `${TESTS_DIR}${file}`
      const source = existsSync(path) ? readFileSync(path, 'utf8') : readFileSync(`${TESTS_DIR}../${file}`, 'utf8')
      found.push(...findTalentBuilders(file, source))
    }
    expect(found).toEqual([])
  })

  it('в списке нет мёртвых записей: каждый названный файл существует', () => {
    for (const file of Object.keys(WORLD_CONTRACT_FILES)) {
      const here = existsSync(`${TESTS_DIR}${file}`)
      const nearby = existsSync(`${TESTS_DIR}../${file}`)
      expect(here || nearby, `${file} — файла нет, запись в списке мёртвая`).toBe(true)
    }
  })

  // ПРОВЕРКА ПРОВЕРЕНА НА БИТОМ ОБРАЗЦЕ. Сторож, который никогда не срабатывал,
  // не отличим от сторожа, который не работает.
  it('ловит билд с талантами на заведомо битом образце', () => {
    const broken = [
      "import { pureBranchTalents } from '../simulate'",
      'const state = buildSimState({ ...referenceBuild(31), talents: pureBranchTalents(branch.id, 22) })',
    ].join('\n')
    const found = findTalentBuilders('образец.test.ts', broken)
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('pureBranchTalents')
  })

  it('не срабатывает на упоминании талантов в комментарии', () => {
    const clean = [
      '// таланты меряет branches.test.ts: pureBranchTalents тут не нужен',
      '/* pathRanks строит сборку ветки — в контрактах мира этого нет */',
      "const zone = intendedZone(31)",
    ].join('\n')
    expect(findTalentBuilders('образец.test.ts', clean)).toEqual([])
  })
})

/**
 * ТЕЛО `referenceBuild` — ОТ ЗАГОЛОВКА ДО ПАРНОЙ СКОБКИ. Читать его нужно
 * целиком: правило не «где-то в файле упоминается запись», а «сборку строит
 * именно она и именно из записи».
 */
export function referenceBuildBody(source: string): string {
  const head = source.indexOf('export function referenceBuild(')
  if (head < 0) return ''
  let depth = 0
  for (let i = source.indexOf('{', head); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(head, i + 1)
    }
  }
  return ''
}

/**
 * ЗАПИСЬ ОБЯЗАНА БЫТЬ ПРОЧИТАНА, А НЕ ПРОСТО ЛЕЖАТЬ РЯДОМ. Поля можно было
 * оставить умолчаниями `buildSimState` — поведение то же самое, — и тогда
 * `REFERENCE_BUILD` стала бы украшением: её правка ничего не меняла бы, а
 * читалась бы как источник правды.
 */
export function findReferenceLeaks(body: string): string[] {
  const out: string[] = []
  const code = stripComments(body)
  if (!code) return ['referenceBuild — функции нет вовсе, читать нечего']
  for (const field of ['talents', 'autocast']) {
    if (!new RegExp(`REFERENCE_BUILD\\.${field}\\b`).test(code)) {
      out.push(`referenceBuild — поле ${field} не из REFERENCE_BUILD: запись перестала быть источником правды`)
    }
  }
  for (const name of TALENT_BUILDERS) {
    if (new RegExp(`\\b${name}\\b`).test(code)) {
      out.push(`referenceBuild — ${name} — эталонная сборка мира не строится деревом`)
    }
  }
  return out
}

describe('эталонную сборку строит запись, а не умолчания', () => {
  // ЗАЧЕМ ЭТО ЧИТАЕТСЯ ИСХОДНИКОМ, А НЕ ВЫЗОВОМ. Вызов `referenceBuild`
  // строит эталонное прохождение класса — 109 секунд на класс (замер, стадия
  // 1 в docs/CHECKS.md). Такое утверждение сначала и стояло в
  // `balance-pacing.test.ts` и упало по сроку в 120 секунд на трёх классах:
  // проверка ценой в пять минут матрицы дороже того, что она стережёт.
  it('referenceBuild берёт таланты и ротацию из записи', () => {
    const source = readFileSync(`${TESTS_DIR}../simulate.ts`, 'utf8')
    expect(findReferenceLeaks(referenceBuildBody(source))).toEqual([])
  })

  it('ловит сборку, собранную умолчаниями, и сборку с деревом', () => {
    const defaults = [
      'export function referenceBuild(level: number, classId = DEFAULT_CLASS.id): SimBuild {',
      '  return { classId, level, gearLevel: row.gearLevel, gear: row.gear }',
      '}',
    ].join('\n')
    expect(findReferenceLeaks(referenceBuildBody(defaults))).toHaveLength(2)

    const tree = [
      'export function referenceBuild(level: number, classId = DEFAULT_CLASS.id): SimBuild {',
      '  return { classId, level, talents: pathRanks(path, 61), autocast: REFERENCE_BUILD.autocast }',
      '}',
    ].join('\n')
    const found = findReferenceLeaks(referenceBuildBody(tree))
    expect(found.some((f) => f.includes('talents'))).toBe(true)
    expect(found.some((f) => f.includes('pathRanks'))).toBe(true)
  })
})

describe('запись эталонной сборки', () => {
  it('несёт НОЛЬ очков талантов', () => {
    expect(Object.keys(REFERENCE_BUILD.talents)).toEqual([])
  })

  it('сид контракта берётся из записи, а не заводится в тестах заново', () => {
    expect(CONTRACT_SEED).toBe(REFERENCE_BUILD.seed)
  })

  it('ротация — четвёрка по умолчанию класса с автокастом', () => {
    expect(REFERENCE_BUILD.autocast).toBe('all')
  })
})
