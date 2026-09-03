import { expect, test, type Page } from '@playwright/test'

// Компоновка экрана. Проверяется то, что ломается молча и чего не видно
// на картинке: состав постоянной зоны, равенство кнопок действий, живучесть
// хоткеев и правила семи меню: одно за раз, Esc и повторное нажатие
// закрывают, ряд действий жив при любом открытом меню.

async function open(page: Page, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
}

test('постоянная зона — ровно четыре блока', async ({ page }) => {
  // Состав проверяется по разметке, а не глазами: «сцена, ряд действий,
  // полоски героя, порог привала» — это правило, и пятый блок в него не
  // влезает.
  //
  // БЛОКОВ СТАЛО ЧЕТЫРЕ, а не три: порог привала переехал сюда из раздела
  // «Мир». Он отвечает на вопрос «когда мне уходить отдыхать» и стоит рядом
  // с полоской здоровья, а не в разделе про зоны, куда за ним надо идти.
  await open(page)
  const blocks = page.locator('[data-permanent] > *')
  await expect(blocks).toHaveCount(4)
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
  await page.locator('nav[aria-label^="Меню"] button', { hasText: 'Таланты' }).first().click()
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
