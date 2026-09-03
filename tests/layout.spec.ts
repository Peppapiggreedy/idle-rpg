import { expect, test, type Page } from '@playwright/test'
import { SCENE_MINI_MAX_PX, SCENE_MINI_MIN_PX } from '../src/lib/data/render.js'

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

// СЦЕНА УЕЗЖАЕТ В УГОЛ. Открытое меню занимает основную площадь, но бой не
// прекращается, и прятать его нельзя: сцена видна ВСЕГДА. Ниже проверяется
// и то, что она уехала, и то, что она осталась.

test('открытое меню уводит сцену в правый нижний угол', async ({ page }) => {
  await open(page, 1280)
  const stage = page.locator('.stage')
  const wide = await stage.boundingBox()
  await menuButton(page, 'Мир').click()
  const corner = await stage.boundingBox()

  // Она стала уже — и не уже минимума из данных: ниже него силуэты
  // сливаются, а табличка с именем моба не помещается в строку.
  expect(corner!.width).toBeLessThan(wide!.width)
  expect(corner!.width).toBeGreaterThanOrEqual(SCENE_MINI_MIN_PX)
  expect(corner!.width).toBeLessThanOrEqual(SCENE_MINI_MAX_PX)

  // И стоит именно в правом нижнем углу окна, а не «где-то правее».
  const win = page.viewportSize()!
  expect(corner!.x + corner!.width).toBeGreaterThan(win.width * 0.7)
  expect(corner!.y + corner!.height).toBeGreaterThan(win.height * 0.7)

  // Закрыли меню — сцена вернулась во всю ширину.
  await menuButton(page, 'Мир').click()
  const back = await stage.boundingBox()
  expect(Math.round(back!.width)).toBe(Math.round(wide!.width))
})

test('в углу нет ни тряски, ни сдвигов, ни выпадов', async ({ page }) => {
  // Сокращённый набор эффектов держится ОБНУЛЁННЫМИ РУЧКАМИ ДВИЖЕНИЯ, а не
  // выключением каждого эффекта по отдельности: замах, выпад и отброс
  // считаются от этих трёх величин. Поэтому и проверять надо их.
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
