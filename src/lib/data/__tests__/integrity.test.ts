// Целостность контента: добавление зоны, таланта или модели не должно
// требовать веры в собственную внимательность.
//
// Проверка одна (schema.ts) и прогоняется дважды: по живым данным — она
// обязана молчать, и по заведомо битой фикстуре — она обязана ругаться, да
// ещё и понятным текстом. Второе не менее важно первого: сторож, который
// перестал работать, зелёный ровно так же, как сторож, которому нечего
// сказать.
//
// Тот же файл запускает `npm run content:check`.
import { describe, expect, it } from 'vitest'
import { brokenCases } from './__fixtures__/broken'
import { realContent } from './content'
import { checkContent, formatIssues, SCHEMAS } from './schema'

describe('целостность контента', () => {
  it('в живых данных нет ни одного замечания', () => {
    const issues = checkContent(realContent())
    // Список замечаний печатается целиком: упавший тест обязан сразу говорить,
    // что чинить, а не отправлять читать проверку.
    expect(issues, `\n${formatIssues(issues)}\n`).toEqual([])
  })

  it('проверены все типы данных, у которых есть свой файл в data/', () => {
    // Новый тип данных без схемы — это дыра, о которой никто не узнает.
    // Список ниже держится руками намеренно: добавил файл с сущностями —
    // добавь схему и допиши сюда.
    //
    // Файлов data/ больше, чем строк здесь, и это правильно: monsters.ts,
    // scenery.ts, slots.ts и loot.ts не заводят собственных сущностей с id —
    // их содержимое приезжает внутрь зон и слотов и проверяется вместе с ними
    // (роли мобов, конфиг сцены, веса рулетки), а stats.ts и render.ts вообще
    // не контент.
    const covered = SCHEMAS.map((s) => s.file)
    for (const file of [
      'data/abilities.ts',
      'data/assets.ts',
      'data/dungeons.ts',
      'data/items.ts',
      'data/rarity.ts',
      'data/talents.ts',
      'data/upgrades.ts',
      'data/zones.ts',
    ]) {
      expect(covered, `${file} без схемы`).toContain(file)
    }
  })
})

describe('проверка ловит битые данные', () => {
  const cases = brokenCases()

  it('образцов поломок хватает, чтобы говорить о покрытии', () => {
    expect(cases.length).toBeGreaterThanOrEqual(15)
  })

  it.each(cases.map((c) => [c.title, c] as const))('%s', (_title, broken) => {
    const issues = checkContent(broken.content)
    expect(issues.length, 'проверка промолчала на битых данных').toBeGreaterThan(0)

    const texts = issues.map((i) => `${i.where}: ${i.message}`)
    const dump = `\n${formatIssues(issues)}\n`
    // Ищем ОДНО замечание, в котором сошлось всё ожидаемое: иначе тест
    // проходил бы по обрывкам из разных строк.
    const matched = texts.find((text) =>
      broken.expect.every((part) =>
        typeof part === 'string' ? text.includes(part) : part.test(text),
      ),
    )
    expect(matched, `ожидалось замечание про ${broken.expect.join(' + ')}${dump}`).toBeTruthy()
  })

  it('текст замечания читаемый: без undefined, [object Object] и пустых мест', () => {
    // Ради этого всё и затевалось. «undefined is not an object» не говорит
    // ни какую сущность чинить, ни в каком файле.
    for (const broken of cases) {
      for (const issue of checkContent(broken.content)) {
        const text = `${issue.where}: ${issue.message}`
        expect(text, broken.title).not.toContain('undefined')
        expect(text, broken.title).not.toContain('[object Object]')
        expect(text, broken.title).not.toContain('NaN')
        // Замечание обязано называть сущность и быть предложением, а не кодом.
        expect(issue.where.trim().length, broken.title).toBeGreaterThan(0)
        expect(issue.message.trim().length, broken.title).toBeGreaterThan(20)
      }
    }
  })

  it('каждое замечание показывает, в какой файл идти чинить', () => {
    // Проверяем на живом наборе поломок: путь к файлу есть либо в самом
    // замечании, либо в имени сущности — иначе чинить придётся поиском.
    for (const broken of cases) {
      const issues = checkContent(broken.content)
      const withoutPath = issues.filter((i) => !/[\w-]+\/[\w-]+\.(ts|svg)|public\/models/.test(i.message))
      expect(withoutPath.map((i) => i.message), broken.title).toEqual([])
    }
  })
})
