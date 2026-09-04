import { expect, test, type Page } from '@playwright/test'
import { SCENE_MINI_MAX_PX, SCENE_MINI_MIN_PX } from '../src/lib/data/render.js'

// Компоновка экрана. Проверяется то, что ломается молча и чего не видно
// на картинке: состав постоянной зоны, равенство кнопок действий, живучесть
// хоткеев и правила восьми меню: одно за раз, Esc и повторное нажатие
// закрывают, ряд действий жив при любом открытом меню.

async function open(page: Page, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
}

test('постоянная зона — ровно шесть ячеек, и каждая названа', async ({ page }) => {
  // Состав проверяется по разметке, а не глазами: седьмая ячейка в правило
  // не влезает. Ячеек шесть, потому что зона — ОДНА СЕТКА на три полосы:
  //   1. столбец меню · сцена · столбец меню
  //   2. «Автокаст» · ряд действий с порогом привала
  //   3. полоски героя во всю ширину
  await open(page)
  await expect(page.locator('[data-permanent] > *')).toHaveCount(6)
  for (const selector of [
    'nav[aria-label="Меню: где меняешь"]',
    '.stage',
    'nav[aria-label="Меню: где читаешь"]',
    '.autocast',
    '.controls',
    '.vitals',
  ]) {
    await expect(
      page.locator(`[data-permanent] > ${selector}`),
      `ячейки ${selector} нет прямо в постоянной зоне`,
    ).toHaveCount(1)
  }
})

test('кнопки меню стоят ПО БОКАМ сцены, а не под зоной', async ({ page }) => {
  // Сцена — главный элемент экрана, и кнопки вокруг неё читаются как рамка
  // вокруг главного. Те же кнопки, отодвинутые под полоски героя, читались
  // как ещё один ряд среди прочих.
  await open(page)
  const stage = (await page.locator('.stage').boundingBox())!
  const left = (await page.locator('nav[aria-label="Меню: где меняешь"]').boundingBox())!
  const right = (await page.locator('nav[aria-label="Меню: где читаешь"]').boundingBox())!
  // Слева от сцены и справа от неё — по горизонтали, а не над и под.
  expect(left.x + left.width).toBeLessThanOrEqual(stage.x + 1)
  expect(right.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1)
  // И по вертикали столбцы начинаются вместе со сценой, а не после неё.
  expect(Math.abs(left.y - stage.y)).toBeLessThan(stage.height / 2)
  expect(Math.abs(right.y - stage.y)).toBeLessThan(stage.height / 2)
})

test('«Автокаст» стоит под левым столбцом, слева от ряда умений', async ({ page }) => {
  // Автокаст — не действие, а переключатель того, КТО действия жмёт, и
  // разведены они местом, а не чертой внутри одного ряда. Колонка у него
  // общая со столбцом меню: обе стоят в одной сетке, поэтому совпадают
  // сами, без подбора чисел.
  await open(page)
  const auto = (await page.locator('.autocast').boundingBox())!
  const nav = (await page.locator('nav[aria-label="Меню: где меняешь"]').boundingBox())!
  const acts = (await page.locator('[aria-label="Действия"]').boundingBox())!
  expect(Math.round(auto.x)).toBe(Math.round(nav.x))
  expect(Math.round(auto.width)).toBe(Math.round(nav.width))
  // Ряд умений — справа от него и на той же полосе.
  expect(acts.x).toBeGreaterThan(auto.x + auto.width - 1)
  expect(Math.abs(acts.y - auto.y)).toBeLessThan(auto.height)
  // И в самом ряду автокаста больше нет: там только действия.
  await expect(page.locator('[aria-label="Действия"] [aria-label="Автокаст"]')).toHaveCount(0)
})

test('порог привала стоит на одной полосе с рядом умений', async ({ page }) => {
  await open(page)
  const acts = (await page.locator('[aria-label="Действия"]').boundingBox())!
  const rest = (await page.locator('.rest').first().boundingBox())!
  expect(rest.x).toBeGreaterThan(acts.x + acts.width - 1)
  expect(Math.abs(rest.y - acts.y)).toBeLessThan(acts.height)
})

test('кнопки ряда действий одного размера', async ({ page }) => {
  // Ряд читается как ряд, только пока ячейки одинаковы: глаз ищет кнопку
  // по месту, а разъезжающиеся по ширине подписи заставляют читать.
  await open(page)
  const slots = page.locator('[aria-label="Действия"] button.slot')
  const count = await slots.count()
  expect(count).toBeGreaterThan(0)
  const boxes = []
  for (let i = 0; i < count; i += 1) boxes.push(await slots.nth(i).boundingBox())
  for (const box of boxes) {
    expect(Math.round(box!.width)).toBe(Math.round(boxes[0]!.width))
    expect(Math.round(box!.height)).toBe(Math.round(boxes[0]!.height))
    // И не меньше области нажатия: в бою по ним жмут не глядя.
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
})

// СЕМЬ МЕНЮ ВМЕСТО ЧЕТЫРЁХ РАЗДЕЛОВ И ДВУХ ВЫДВИЖЕК. Раньше на одну задачу
// было два паттерна: вкладки внизу и листы поверх низа экрана. Тесты ниже
// держат новое правило: одно меню за раз, повторное нажатие и Esc закрывают,
// а ряд умений живёт при любом открытом меню.
const MENUS = ['Герой', 'Сумка', 'Мир', 'Таланты', 'Крафт', 'Журнал', 'Настройки']

const menuButton = (page: Page, name: string) =>
  page.locator('nav[aria-label^="Меню"] button', { hasText: name }).first()

test('кнопок меню семь, и они разложены по двум столбцам', async ({ page }) => {
  await open(page)
  await expect(page.locator('nav[aria-label^="Меню"] button')).toHaveCount(MENUS.length)
  // СЛЕВА — ГДЕ МЕНЯЕШЬ, СПРАВА — ГДЕ ЧИТАЕШЬ.
  await expect(page.locator('nav[aria-label="Меню: где меняешь"] button')).toHaveCount(5)
  await expect(page.locator('nav[aria-label="Меню: где читаешь"] button')).toHaveCount(2)
})

test('открытого меню по умолчанию нет, и оно не переживает перезагрузку', async ({ page }) => {
  // «Где я сейчас» — не настройка машины: после перезагрузки игрок хочет
  // видеть бой, а не вкладку, на которой закрыл вчера.
  await open(page)
  await expect(page.locator('.pane > *')).toHaveCount(0)
  await menuButton(page, 'Журнал').click()
  await expect(page.locator('.pane > *').first()).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await expect(page.locator('.pane > *')).toHaveCount(0)
})

test('открытое меню не попадает ни в сейв, ни в настройки машины', async ({ page }) => {
  await open(page)
  await menuButton(page, 'Журнал').click()
  await expect(page.locator('.pane > *').first()).toBeVisible()
  const save = await page.evaluate(() => localStorage.getItem('idle-rpg-save') ?? '')
  expect(save).not.toContain('menu')
  const ui = await page.evaluate(() => localStorage.getItem('idle-rpg:ui') ?? '')
  expect(ui).not.toContain('drawers')
  expect(ui).not.toContain('menu')
})

test('открытое меню всегда одно, а повторное нажатие и Esc закрывают', async ({ page }) => {
  await open(page)
  await menuButton(page, 'Герой').click()
  await expect(menuButton(page, 'Герой')).toHaveAttribute('aria-pressed', 'true')
  // Открытие второго закрывает первое.
  await menuButton(page, 'Мир').click()
  await expect(menuButton(page, 'Герой')).toHaveAttribute('aria-pressed', 'false')
  await expect(menuButton(page, 'Мир')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('nav[aria-label^="Меню"] button[aria-pressed="true"]')).toHaveCount(1)
  // Повторное нажатие той же кнопки закрывает.
  await menuButton(page, 'Мир').click()
  await expect(page.locator('.pane > *')).toHaveCount(0)
  // Esc закрывает открытое.
  await menuButton(page, 'Настройки').click()
  await expect(page.locator('.pane > *').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.pane > *')).toHaveCount(0)
})

test('«Герой» открывает куклу И сумку, «Сумка» — только сумку', async ({ page }) => {
  // Исключение осознанное: иначе перетаскивать предмет из сумки на слот
  // некуда — два меню одновременно не открываются.
  await open(page)
  await menuButton(page, 'Герой').click()
  await expect(page.locator('.pane').getByText('Экипировка', { exact: true })).toBeVisible()
  await expect(page.locator('.pane').getByText('Инвентарь', { exact: true })).toBeVisible()
  await menuButton(page, 'Сумка').click()
  await expect(page.locator('.pane').getByText('Инвентарь', { exact: true })).toBeVisible()
  await expect(page.locator('.pane').getByText('Экипировка', { exact: true })).toHaveCount(0)
})

test('хоткеи умений живы при КАЖДОМ открытом меню', async ({ page }) => {
  // Слушатель клавиатуры один на всю игру и висит в ряду действий: спрячешь
  // ряд под меню — хоткеи умрут глобально. Проверяется по случаю на меню,
  // а не «на одном и ладно».
  await open(page)
  const first = page.locator('[aria-label="Действия"] button.slot').first()
  for (const name of MENUS) {
    await menuButton(page, name).click()
    await expect(first, `ряд действий пропал при открытом меню «${name}»`).toBeVisible()
    await page.keyboard.press('1')
    await expect(first).toBeVisible()
  }
})

test('на мобильном ряд действий скроллится, а не жмёт кнопки', async ({ page }) => {
  await open(page, 320)
  const slots = page.locator('[aria-label="Действия"] button.slot')
  const box = await slots.first().boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  const overflow = await page.evaluate(() => {
    const el = document.documentElement
    return el.scrollWidth - el.clientWidth
  })
  expect(overflow).toBeLessThanOrEqual(0)
})

// ЛЕСТНИЦА ОТКРЫТИЙ. Интрига держится не на стилях, а на том, что названия
// будущих ступеней вообще не попадают в разметку: спрятанное через CSS живёт
// ровно до первого открытия инспектора.
test('названий закрытых ступеней нет в разметке страницы', async ({ page }) => {
  await open(page)
  // Лестница открытий живёт в «Мире»: она про то, что откроется дальше В
  // МИРЕ, и стоит рядом с картой зон, а не в талантах.
  await page.locator('nav[aria-label^="Меню"] button', { hasText: 'Мир' }).first().click()
  const ladder = page.locator('section', { hasText: 'Лестница открытий' }).first()
  await expect(ladder).toBeVisible()
  const html = await page.content()
  // Пресет rich — герой 32 уровня (порог ремёсел плюс два): ступени 10, 20 и
  // 30 открыты, всё выше — нет. Уровень пресета поднят вместе с лестницей
  // открытий: на 22 поздний пресет перестал показывать ремёсла вовсе.
  const closed = [
    'Травничество и третий данж',
    'Зачарование и четвёртый данж',
    'Уникальные рецепты и пятый данж',
    'Храм испытаний и шестой данж',
    'Преквесты и седьмой данж',
    'Героический режим и восьмой данж',
    'Рейд',
  ]
  for (const name of closed) {
    expect(html, `название закрытой ступени «${name}» попало в разметку`).not.toContain(name)
  }
  // А открытые — на месте, иначе тест проходил бы и на пустой панели.
  expect(html).toContain('Дерево талантов')
  expect(html).toContain('Первый данж')
  expect(html).toContain('Ремёсла и второй данж')
})

// ЗАГОЛОВОК МЕСТА над сценой: игрок должен видеть, где он находится.
test('над сценой видно название места и полосу уровней', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  const place = page.locator('.place')
  await expect(place).toBeVisible()
  // Название и полоса уровней вида «(26–30)».
  await expect(place).toContainText(/\(\d+–\d+\)/)
  expect((await place.innerText()).length).toBeGreaterThan(5)
})

test('на 320px заголовок места в одну строку и не перекрывает сцену', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  const place = page.locator('.place')
  const box = await place.boundingBox()
  const line = await place.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight))
  // Высота в пределах одной строки: перенос удвоил бы её.
  expect(box!.height).toBeLessThan(line * 1.8)
  // И заголовок стоит НАД сценой, а не поверх неё.
  const stage = await page.locator('.stage > :nth-child(2)').boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(stage!.y + 1)
})

// ГКД живёт на иконках умений, а не у полоски замаха: полоска про оружие,
// задержка про умения, и на одной шкале они читались как одно.
test('общей задержки нет рядом с полоской замаха', async ({ page }) => {
  // Полоска замаха — про ОРУЖИЕ, общая задержка — про УМЕНИЯ. На одной шкале
  // они читались как одно, и игрок ждал удара, глядя на задержку.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await expect(page.locator('.swing')).toBeVisible()
  await expect(page.locator('.swing .gcd')).toHaveCount(0)
})

// ЦЕНА ВИДНА ДО НАЖАТИЯ. У крафта появилась пошлина золотом, и половина
// смысла этой правки в том, что игрок видит цену ЗАРАНЕЕ: цена, о которой
// узнаёшь после клика, — не цена, а сюрприз.
test('пошлина крафта видна в карточке рецепта, а кнопка заперта нехваткой', async ({ page }) => {
  await open(page, 1280)
  await page.locator('nav[aria-label^="Меню"] button', { hasText: 'Крафт' }).first().click()
  const recipe = page.locator('.recipe').first()
  await expect(recipe).toBeVisible()
  // Строка пошлины есть и в ней есть число.
  const toll = recipe.locator('.toll')
  await expect(toll).toBeVisible()
  await expect(toll).toContainText('Пошлина')
  await expect(toll).toContainText(/\d/)
  // Кнопка либо зовёт собрать, либо НАЗЫВАЕТ причину — молчаливого «нельзя»
  // не бывает. Какая именно причина, зависит от пресета, поэтому проверяется
  // сам факт названной причины.
  const button = recipe.getByRole('button')
  await expect(button).toHaveText(/Собрать|Не хватает|Сумка полна|откроется|рубежа/i)
})

// СЦЕНА УЕЗЖАЕТ В УГОЛ. Открытое меню занимает основную площадь, но бой не
// прекращается, и прятать его нельзя: сцена видна ВСЕГДА. Ниже проверяется
// и то, что она уехала, и то, что она осталась.

test('открытое меню сжимает сцену НА МЕСТЕ, между столбцами кнопок', async ({ page }) => {
  // Углом это было, пока кнопки стояли под всей зоной: сцена уходила из
  // потока и ничего за собой не оставляла. Теперь кнопки стоят по её бокам,
  // и уведи сцену из потока — между столбцами останется дыра, а сами
  // столбцы разъедутся по краям пустой полосы.
  await open(page, 1280)
  const stage = page.locator('.stage')
  const wide = await stage.boundingBox()
  await menuButton(page, 'Мир').click()
  const small = await stage.boundingBox()

  // Стала уже — и не уже минимума из данных: ниже него силуэты сливаются,
  // а табличка с именем моба не помещается в строку.
  expect(small!.width).toBeLessThan(wide!.width)
  expect(small!.width).toBeGreaterThanOrEqual(SCENE_MINI_MIN_PX)
  expect(small!.width).toBeLessThanOrEqual(SCENE_MINI_MAX_PX)

  // Осталась НА МЕСТЕ: верх тот же, столбцы кнопок по-прежнему по бокам.
  expect(Math.round(small!.y)).toBe(Math.round(wide!.y))
  const left = (await page.locator('nav[aria-label="Меню: где меняешь"]').boundingBox())!
  const right = (await page.locator('nav[aria-label="Меню: где читаешь"]').boundingBox())!
  expect(left.x + left.width).toBeLessThanOrEqual(small!.x + 1)
  expect(right.x).toBeGreaterThan(small!.x + small!.width)

  // А меню легло НИЖЕ постоянной зоны, во всю ширину.
  const zone = (await page.locator('[data-permanent]').boundingBox())!
  const pane = (await page.locator('.pane').boundingBox())!
  expect(pane.y).toBeGreaterThanOrEqual(zone.y + zone.height - 1)

  // Закрыли меню — сцена вернулась во всю ширину.
  await menuButton(page, 'Мир').click()
  const back = await stage.boundingBox()
  expect(Math.round(back!.width)).toBe(Math.round(wide!.width))
})

test('в уменьшенной сцене нет ни тряски, ни сдвигов, ни выпадов', async ({ page }) => {
  // Сокращённый набор эффектов держится ОБНУЛЁННЫМИ РУЧКАМИ ДВИЖЕНИЯ, а не
  // выключением каждого эффекта по отдельности: замах, выпад и отброс
  // считаются от этих трёх величин. Поэтому и проверять надо их. В узкой
  // сцене тряска читается как дрожь, а стопка чисел закрывает обоих бойцов.
  //
  // Открываем СО СЦЕНОЙ, а не с `scene=off`: без неё проверять нечего —
  // на месте сцены стоит текстовая панель.
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('?debug=1&state=rich')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await menuButton(page, 'Мир').click()
  const motion = await page.locator('[data-phase]').evaluate((el) => {
    const style = getComputedStyle(el)
    return ['--lean', '--lunge', '--kick'].map((name) => style.getPropertyValue(name).trim())
  })
  for (const value of motion) expect(parseFloat(value)).toBe(0)
})

test('на 390px открытое меню оставляет строку-сводку, а не сцену', async ({ page }) => {
  // Треть от 390 — это 130 пикселей: угла на телефоне не бывает. Вместо
  // сцены встаёт одна строка, и она тот же вид, что несёт текстовый режим.
  await open(page, 390)
  for (const name of MENUS) {
    await menuButton(page, name).click()
    // Сцена или сводка — что-то из двух в разметке есть ВСЕГДА.
    const summary = page.locator('[data-compact="1"]')
    await expect(summary, `меню «${name}»: сводки нет`).toHaveCount(1)
    // Имя моба и его здоровье числом — то, ради чего сводка и заведена.
    await expect(summary).toContainText(/\d+\s*ур\./)
    await expect(summary).toContainText(/\d/)
    // И одна строка: высота в пределах полутора строк ряда действий.
    const box = await summary.boundingBox()
    expect(box!.height, `меню «${name}»: сводка в две строки`).toBeLessThan(64)
    // По горизонтали не вылезает ничего.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow, `меню «${name}»: страница шире экрана`).toBeLessThanOrEqual(0)
  }
})

test('без открытого меню сцена на месте и на телефоне, и на десктопе', async ({ page }) => {
  // Обратная сторона той же проверки: сводка ЗАМЕНЯЕТ сцену только под
  // открытым меню. Иначе «сцена видна всегда» превратилось бы в «сцена
  // видна, пока не тронешь ни одной кнопки».
  for (const width of [390, 1280]) {
    await open(page, width)
    await expect(page.locator('[data-compact="1"]')).toHaveCount(0)
    await expect(page.locator('.battle')).toHaveCount(1)
  }
})

// КАЖДАЯ КНОПКА СОДЕРЖИТ ТО, ЧТО ОБЕЩАЕТ. Общая беда прежней раскладки:
// кнопка называлась одним, а внутри лежало другое, и появлялась она раньше,
// чем ей было что показать.

test('«Автокаст» ОТКРЫВАЕТ настройки ротации, а не переключает её', async ({ page }) => {
  await open(page)
  const button = page.locator('[data-permanent] button', { hasText: 'Автокаст' }).first()
  await expect(page.locator('.pane > *')).toHaveCount(0)
  await button.click()

  // Внутри: общий выключатель, список умений с приоритетом и «беречь ману».
  const pane = page.locator('.pane')
  await expect(pane.locator('[data-autocast-master]')).toBeVisible()
  await expect(pane.getByText('Использовать автоматически').first()).toBeVisible()
  await expect(pane.getByText('Беречь', { exact: false }).first()).toBeVisible()

  // Ведёт себя как остальные меню: повторное нажатие и Esc закрывают.
  await button.click()
  await expect(page.locator('.pane > *')).toHaveCount(0)
  await button.click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.pane > *')).toHaveCount(0)
})

test('открытие другого меню закрывает автокаст, и наоборот', async ({ page }) => {
  // Одно меню за раз — правило общее, и автокаст из него не выпадает.
  await open(page)
  await page.locator('[data-permanent] button', { hasText: 'Автокаст' }).first().click()
  await menuButton(page, 'Мир').click()
  await expect(page.locator('.pane').getByText('Лестница открытий')).toBeVisible()
  await expect(page.locator('.pane').locator('[data-autocast-master]')).toHaveCount(0)
})

test('«Таланты» — только три ветки: ни умений, ни лестницы', async ({ page }) => {
  await open(page)
  await menuButton(page, 'Таланты').click()
  const pane = page.locator('.pane')
  await expect(pane.locator('section', { hasText: 'Таланты' }).first()).toBeVisible()
  await expect(pane.locator('[data-autocast-master]')).toHaveCount(0)
  await expect(pane.getByText('Лестница открытий')).toHaveCount(0)
})

test('«Мир» содержит лестницу открытий', async ({ page }) => {
  await open(page)
  await menuButton(page, 'Мир').click()
  await expect(page.locator('.pane').getByText('Лестница открытий')).toBeVisible()
})

test('кнопки меню не видны раньше, чем им есть что показать', async ({ page }) => {
  // «Закрытое не видно вовсе» было записано про панели, но не применено к
  // самим кнопкам: игрок первого уровня открывал пустоту.
  const names = async () =>
    (await page.locator('nav[aria-label^="Меню"] button').allInnerTexts()).join(' ')

  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('?debug=1&state=fresh&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  const atOne = await names()
  expect(atOne, 'на первом уровне «Таланты» показывать нечего').not.toContain('Таланты')
  expect(atOne, 'на первом уровне «Крафт» показывать нечего').not.toContain('Крафт')
  // А то, что осмысленно с первой секунды, на месте.
  for (const name of ['Герой', 'Сумка', 'Мир', 'Журнал', 'Настройки']) {
    expect(atOne, `кнопка «${name}» должна быть видна сразу`).toContain(name)
  }
  await expect(page.locator('[data-permanent] button', { hasText: 'Автокаст' })).toHaveCount(1)

  // Десятый уровень — порог талантов: кнопка появилась, крафта ещё нет.
  await page.goto('?debug=1&state=mid&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  const atTen = await names()
  expect(atTen).toContain('Таланты')
  expect(atTen).not.toContain('Крафт')

  // Тридцать второй — обе на месте.
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  const atThirty = await names()
  expect(atThirty).toContain('Таланты')
  expect(atThirty).toContain('Крафт')
})

test('карточка героя: два числа крупно, остальное под «Деталями»', async ({ page }) => {
  await open(page)
  await menuButton(page, 'Герой').click()
  const summary = page.locator('[data-hero-summary]')
  await expect(summary).toBeVisible()
  // Ровно две плитки: одно число врёт, трёх никто не читает.
  await expect(summary.locator('.tile')).toHaveCount(2)
  await expect(summary).toContainText('Урон в секунду')

  // Детали свёрнуты по умолчанию и раскрываются кнопкой.
  const details = page.locator('.pane').getByText('Время замаха')
  await expect(details).toHaveCount(0)
  await page.locator('.pane').getByRole('button', { name: 'Детали' }).click()
  await expect(details.first()).toBeVisible()
  await page.locator('.pane').getByRole('button', { name: 'Свернуть детали' }).click()
  await expect(details).toHaveCount(0)
})
