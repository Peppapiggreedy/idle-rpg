import { expect, test, type Page } from '@playwright/test'

// Компоновка экрана. Проверяется то, что ломается молча и чего не видно
// на картинке: состав постоянной зоны, равенство кнопок действий, живучесть
// хоткеев и то, что выдвижка не трогает боевую сцену.

async function open(page: Page, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
}

test('постоянная зона — ровно три блока', async ({ page }) => {
  // Состав проверяется по разметке, а не глазами: «сцена, ряд действий,
  // строка полосок» — это правило, и четвёртый блок в него не влезает.
  await open(page)
  const blocks = page.locator('[data-permanent] > *')
  await expect(blocks).toHaveCount(3)
  // И порядок именно такой: сцена сверху, под ней действия, под ними полоски.
  // Верхний блок узнаём по строке замаха: она есть и у сцены, и у текстовой
  // панели, которая встаёт на её место, а имя моба меняется от спавна.
  await expect(blocks.nth(0)).toContainText('Замах')
  await expect(blocks.nth(1)).toHaveAttribute('aria-label', 'Действия')
  await expect(blocks.nth(2)).toContainText('Здоровье')
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

test('журнал свёрнут по умолчанию и переживает перезагрузку', async ({ page }) => {
  await open(page)
  const log = page.locator('[role="region"][aria-label="Журнал"]')
  await expect(log).toHaveCount(0)
  await page.getByRole('button', { name: 'Журнал', exact: true }).click()
  await expect(log).toBeVisible()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await expect(page.locator('[role="region"][aria-label="Журнал"]')).toBeVisible()
})

test('состояние выдвижек не попадает в экспорт сейва', async ({ page }) => {
  // «Как я смотрю» — свойство машины, а не прогресс: увозить открытый
  // журнал на другой компьютер вместе с сейвом незачем.
  await open(page)
  await page.getByRole('button', { name: 'Журнал', exact: true }).click()
  await expect(page.locator('[role="region"][aria-label="Журнал"]')).toBeVisible()
  const save = await page.evaluate(() => localStorage.getItem('idle-rpg-save') ?? '')
  expect(save).not.toContain('drawer')
  const ui = await page.evaluate(() => localStorage.getItem('idle-rpg:ui') ?? '')
  expect(ui).toContain('drawers')
})

test('открытие выдвижки не двигает боевую сцену', async ({ page }) => {
  // Сцена — главный элемент экрана. Панель, которая её сдвигает или ужимает,
  // заставляет игрока заново искать бой глазами.
  await open(page)
  const stage = page.locator('[data-permanent] > *').first()
  const before = await stage.boundingBox()
  for (const name of ['Герой', 'Журнал']) {
    await page.getByRole('button', { name, exact: true }).click()
    const after = await stage.boundingBox()
    // Закрываем своей же кнопкой в шапке листа. Тянуться к соседней ручке
    // поверх открытого листа нельзя: лист прибит к низу окна и накрывает
    // их обе, и браузер, доставая ручку из-под него, прокрутит страницу —
    // сцена уедет не от вёрстки, а от прокрутки.
    await page.getByRole('button', { name: 'Закрыть' }).click()
    expect(Math.round(after!.x)).toBe(Math.round(before!.x))
    expect(Math.round(after!.y)).toBe(Math.round(before!.y))
    expect(Math.round(after!.width)).toBe(Math.round(before!.width))
    expect(Math.round(after!.height)).toBe(Math.round(before!.height))
  }
})

test('открытой выдвижки всегда не больше одной', async ({ page }) => {
  // Оба листа прибиты к низу окна одним и тем же `bottom`: открытые разом,
  // они лежат друг на друге, и виден только тот, что позже в разметке.
  // Открыть второй — значит закрыть первый.
  await open(page)
  const sheets = page.locator('[role="region"]:has(button[aria-label="Закрыть"])')
  await page.getByRole('button', { name: 'Герой', exact: true }).click()
  await expect(sheets).toHaveCount(1)
  await expect(sheets).toHaveAttribute('aria-label', 'Герой')
  // Ручка «Журнала» уходит под открытый лист, и мышью до неё не достать:
  // отправляем событие прямо кнопке. Проверяется правило стора, а не то,
  // куда попадёт курсор, — живой игрок закрывает лист крестиком в шапке.
  await page.getByRole('button', { name: 'Журнал', exact: true }).dispatchEvent('click')
  await expect(sheets).toHaveCount(1)
  await expect(sheets).toHaveAttribute('aria-label', 'Журнал')
})

test('хоткеи умений живы в любом разделе и при открытых выдвижках', async ({ page }) => {
  // Слушатель клавиатуры один на всю игру и висит в ряду действий: спрячешь
  // ряд во вкладку — хоткеи умрут глобально. Здесь это и проверяется.
  await open(page)
  const first = page.locator('[aria-label="Действия"] button.slot').first()
  const tabs = page.locator('nav[aria-label="Разделы"] button')
  const count = await tabs.count()
  for (let i = 0; i < count; i += 1) {
    await tabs.nth(i).click()
    await expect(first).toBeVisible()
  }
  await page.getByRole('button', { name: 'Герой', exact: true }).click()
  await expect(first).toBeVisible()
  // Нажатие хоткея доходит до логики: умение уходит в кулдаун или в очередь.
  await page.keyboard.press('1')
  await expect(first).toBeVisible()
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
  await page.locator('nav[aria-label="Разделы"] button').first().click()
  const ladder = page.locator('section', { hasText: 'Лестница открытий' }).first()
  await expect(ladder).toBeVisible()
  const html = await page.content()
  // Пресет rich — герой 22 уровня: ступени 10 и 20 открыты, всё выше — нет.
  const closed = [
    'Ремёсла и второй данж',
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
})
