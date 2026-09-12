// ФОРМА ВЕТКИ ЧИТАЕТСЯ ИЗ ДАННЫХ, А НЕ ИЗ ЧИСЛА В КОМПОНЕНТЕ.
//
// Сторож по ИСХОДНИКАМ, а не по отрисовке, и это не лень: панель умеет
// рисовать только то наполнение, которое сегодня лежит в данных, а правило
// нужно на любое. Пока форма была одной на всех, «13» и «5» стояли в панели
// литералами и читались как закон мира; теперь у веток две разных формы, и
// литерал был бы не просто некрасивым — он был бы НЕВЕРНЫМ для одной из них.
//
// ПРОВЕРЯЕТСЯ В ОБЕ СТОРОНЫ: мало убедиться, что чисел нет, — надо ещё
// убедиться, что панель действительно берёт форму у ветки. Иначе правило
// выполнялось бы само собой на пустом компоненте.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BRANCHES,
  BRANCH_BY_ID,
  branchCapacity,
  branchDepth,
  keyRowsOf,
  talentsInBranch,
} from '../data/talents'

const PANEL = readFileSync(new URL('./TalentPanel.svelte', import.meta.url), 'utf8')
/** Только скрипт компонента: в стилях числа — это пиксели и доли, а не форма. */
const SCRIPT = PANEL.slice(PANEL.indexOf('<script'), PANEL.indexOf('<style'))

describe('панель дерева не знает формы ветки наизусть', () => {
  it('в панели нет ни старого числа этажей, ни старого шага', () => {
    // Ищем именно ЧИСЛА в коде, а не в тексте для игрока: `13` и `5` как
    // самостоятельные литералы. Слова с цифрами (`space-1`, `text-xs`) не в
    // счёт — они в стилях, которые сюда не попадают.
    for (const literal of [' 13', '=13', '(13', ' 5)', 'BRANCH_ROWS', 'BRANCH_ROW_STEP', 'CONCEPT_ROWS']) {
      expect(SCRIPT.includes(literal), `панель держит «${literal}» — форма должна приходить из данных`).toBe(false)
    }
  })

  it('панель берёт форму и ключевые этажи у ветки', () => {
    // Обратная сторона: числа убраны не выбрасыванием, а заменой на данные.
    expect(SCRIPT).toContain('keyRowsOf')
    expect(SCRIPT).toContain('rowRequirement')
    expect(SCRIPT).toContain('rowHeroLevel')
    expect(SCRIPT).toContain('--cols: {branch.cols}')
  })
})

describe('форма ветки — данные', () => {
  it('у каждой ветки объявлены этажи, шаг и ширина', () => {
    for (const branch of BRANCHES) {
      expect(branch.rows, branch.id).toBeGreaterThanOrEqual(2)
      expect(branch.step, branch.id).toBeGreaterThan(0)
      expect(branch.cols, branch.id).toBeGreaterThanOrEqual(1)
      expect(branch.cols, branch.id).toBeLessThanOrEqual(5)
    }
  })

  it('у каждой ветки СВОЯ запись формы — иначе она снова станет константой', () => {
    // Числа у всех девяти совпали, и это правильное состояние, а не потеря
    // свойства: свойство здесь в том, что форма ЗАПИСАНА У ВЕТКИ и её можно
    // сменить одной строкой, не трогая остальные восемь.
    const src = readFileSync(new URL('../data/talents.ts', import.meta.url), 'utf8')
    expect(src.includes('...LADDER')).toBe(false)
    expect((src.match(/rows: \d+, step: \d+, cols: \d+/g) ?? []).length).toBe(BRANCHES.length)
  })

  it('ВСЕ ДЕВЯТЬ на семи этажах по десять очков и пяти столбцах', () => {
    // Смешанного состояния больше нет: ночь восьми веток довела до общей формы
    // все ветки до одной. Глубина при этом та же шестьдесят, что и у прежних
    // тринадцати этажей, — переезд сменил РИТМ, а не цену ветки.
    for (const branch of BRANCHES) {
      expect([branch.rows, branch.step, branch.cols], branch.id).toEqual([7, 10, 5])
      expect(branchDepth(branch.id), branch.id).toBe(60)
    }
  })

  it('ёмкость Гнева — в окне 94–110 при глубине 60', () => {
    // Ёмкость выше глубины всегда: дефицит и делает выбор выбором. Окно —
    // не украшение: ветка на 115 очках вмещала почти всё, что герой заработал
    // за игру, и «выбор» сводился к порядку покупки.
    //
    // ПОТОЛОК ПОДНЯТ СО 104 ДО 110, И ЭТО РЕШЕНИЕ, А НЕ ПОДГОНКА. «Память
    // клинка» — двадцать седьмой узел ветки, пять рангов, и ёмкость с ним
    // 106. Верхняя граница стоит там, где «выбор сводится к порядку покупки»:
    // при 91 очке за игру и ёмкости 110 герой берёт пять восьмых ветки, то
    // есть треть узлов остаётся за бортом. Отсечка 104 никакого смысла, кроме
    // «столько было вчера», не несла.
    const capacity = branchCapacity('warden-wrath')
    expect(capacity).toBeGreaterThanOrEqual(94)
    expect(capacity).toBeLessThanOrEqual(110)
    expect(capacity).toBeGreaterThan(branchDepth('warden-wrath'))
  })

  it('ключевые этажи Гнева — третий, пятый и седьмой', () => {
    // Пороги 20, 40 и 60 очков, то есть уровни героя 30, 50 и 70: три
    // майлстоуна прокачки. Номера этажей сменились с 5/9/13, а ПОРОГИ — нет.
    expect(keyRowsOf('warden-wrath')).toEqual([3, 5, 7])
  })

  it('на ключевом этаже пара стоит РЯДОМ с обычными узлами', () => {
    // Это и есть разница между «этаж — выбор» и «этаж — пара». В семиэтажной
    // ветке ряд широкий, и пара занимает две клетки из пяти; остальные три —
    // обычные многоранговые таланты, и запрещать им модификаторы нельзя.
    const row = keyRowsOf('warden-wrath')[0]
    const onRow = talentsInBranch('warden-wrath').filter((t) => t.row === row)
    const pair = onRow.filter((t) => t.exclusiveGroup)
    const plain = onRow.filter((t) => !t.exclusiveGroup)
    expect(pair).toHaveLength(2)
    expect(plain.length).toBeGreaterThan(0)
    expect(plain.some((t) => t.effect.kind === 'modifiers')).toBe(true)
  })
})

