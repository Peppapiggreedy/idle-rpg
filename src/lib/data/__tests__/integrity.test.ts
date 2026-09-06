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
import { readdirSync } from 'node:fs'
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

  it('НИ ОДИН файл data/ не проходит мимо решения: покрыт или назван исключением', () => {
    // СТОРОЖ НА САМ СПИСОК ПОКРЫТИЯ. Список ниже ведётся руками, и это его
    // единственная слабость: `data/upgrades.ts` не дописали в него при
    // появлении, и семь покупок с id, name и icon прожили мимо проверки всю
    // свою жизнь — дубликат id и ссылка на несуществующий значок не роняли
    // ничего. Заметить такое чтением списка нельзя: в нём видно то, что есть,
    // а не то, чего нет.
    //
    // Поэтому решение теперь ОБЯЗАТЕЛЬНО для каждого файла: он либо покрыт
    // схемой, либо стоит в исключениях С ПРИЧИНОЙ. Новый файл не проходит
    // молча ни туда, ни сюда — тест назовёт его по имени.
    const covered = new Set(SCHEMAS.map((s) => s.file))
    // Почему файл не нуждается в схеме — по одной строке на каждый.
    const NO_ENTITIES: Record<string, string> = {
      'data/balance.ts': 'числа баланса, а не сущности с id; их диапазоны проверяет BALANCE_SCHEMA',
      'data/bands.ts':
        'разметка уровней: десять полос с границами, сущностей с id не заводит. ' +
        'Сплошность полос и то, что каждая обитаема, проверяют схемы фонов и реагентов',
      'data/loot.ts': 'правила рулетки: веса и цены, сущностей с id не заводит',
      'data/monsters.ts': 'архетипы и формула масштаба; мобы приезжают внутрь зон и проверяются с ними',
      'data/render.ts': 'длительности и размеры сцены — не контент',
      'data/slots.ts': 'слоты проверяются как часть экипировки (SLOT_IDS в схемах вещей)',
      'data/stats.ts': 'имена статов — не контент',
      'data/upgrade.ts': 'правила двух осей апгрейда, а не список сущностей',
    }
    const files = readdirSync('src/lib/data')
      .filter((f) => f.endsWith('.ts'))
      .map((f) => `data/${f}`)
    for (const file of files) {
      expect(
        covered.has(file) || file in NO_ENTITIES,
        `${file} не покрыт схемой и не назван исключением — добавь схему в schema.ts ` +
          'или строку с причиной в NO_ENTITIES',
      ).toBe(true)
    }
    // И обратно: исключение, которое обзавелось схемой, из списка уходит —
    // иначе он копит мёртвые строки, как всякий список без обратной проверки.
    for (const file of Object.keys(NO_ENTITIES)) {
      expect(covered.has(file), `${file} уже покрыт схемой — убери его из NO_ENTITIES`).toBe(false)
      expect(files, `${file} в NO_ENTITIES, но такого файла нет`).toContain(file)
    }
  })

  it('проверены все типы данных, у которых есть свой файл в data/', () => {
    // Новый тип данных без схемы — это дыра, о которой никто не узнает.
    // Список ниже держится руками намеренно: добавил файл с сущностями —
    // добавь схему и допиши сюда.
    //
    // Файлов data/ больше, чем строк здесь, и это правильно: monsters.ts,
    // slots.ts и loot.ts не заводят собственных сущностей с id — их
    // содержимое приезжает внутрь зон и слотов и проверяется вместе с ними
    // (роли мобов, веса рулетки), а stats.ts и render.ts вообще не контент.
    const covered = SCHEMAS.map((s) => s.file)
    for (const file of [
      'data/abilities.ts',
      'data/classes.ts',
      'data/reagents.ts',
      'data/herbs.ts',
      'data/enchants.ts',
      'data/procs.ts',
      'data/boons.ts',
      'data/heroic.ts',
      'data/temple.ts',
      'data/quests.ts',
      'data/progression.ts',
      'data/mastery.ts',
      'data/recipes.ts',
      'data/dungeons.ts',
      'data/items.ts',
      'data/rarity.ts',
      'data/sounds.ts',
      'data/sprites.ts',
      'data/talents.ts',
      'data/upgrades.ts',
      'data/zones.ts',
    ]) {
      expect(covered, `${file} без схемы`).toContain(file)
    }
    // Файла мало: в одном файле живёт несколько ТИПОВ сущностей (в items.ts —
    // оружие и щиты), и новый тип рядом со старым проскочил бы незамеченным.
    const kinds = SCHEMAS.map((s) => s.kind)
    for (const kind of [
      'умение',
      'ветка талантов',
      'талант',
      'зона',
      'данж',
      'оружие',
      'щит',
      'звук',
      'класс',
      'трава',
      'зачарование',
      'прок',
      'способность босса',
      'храм',
      'задание',
      'ступень лестницы',
      'реагент',
      'рецепт',
      'редкость',
      'спрайт',
      'фон',
    ]) {
      expect(kinds, `тип «${kind}» без схемы`).toContain(kind)
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
      const withoutPath = issues.filter((i) => !/[\w-]+\/[\w-]+\.(ts|svg)/.test(i.message))
      expect(withoutPath.map((i) => i.message), broken.title).toEqual([])
    }
  })
})

describe('потолок уровней', () => {
  it('ровно на потолке — законно: ступень рейда стоит именно там', () => {
    // Граница НЕСТРОГАЯ, и это не мелочь: сотый уровень — последний, до него
    // доходят, и контент на нём открывается. Проверить это отдельной битой
    // фикстурой нельзя (она обязана давать замечание), поэтому смотрим на
    // ЖИВЫЕ данные: ступень рейда стоит ровно на LEVEL_CAP, и замечаний по
    // ним нет ни одного — значит, нестрогость работает.
    const content = realContent()
    const top = content.progression.filter((s) => s.level === content.balance.levelCap)
    expect(top.length, 'ни одна ступень не стоит на потолке — проверять нечего').toBeGreaterThan(0)
    expect(checkContent(content)).toEqual([])
  })

  it('запас до потолка нулевой — об этом стоит помнить, планируя рейд', () => {
    const content = realContent()
    const highest = Math.max(...content.progression.map((s) => s.level))
    expect(highest).toBe(content.balance.levelCap)
  })
})
