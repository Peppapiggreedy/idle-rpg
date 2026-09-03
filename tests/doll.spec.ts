import { expect, test, type Locator, type Page } from '@playwright/test'
import { openMenu } from './screen.js'

// КУКЛА И ТРИ ПУТИ НАДЕТЬ НАХОДКУ. Проверяется каждый путь по отдельности:
// они делают одно и то же, но ломаются порознь — перетаскивание живёт на
// dataTransfer, нажатие на состоянии несомого, долгое нажатие на таймере.
//
// Пресет rich: сумка полна находок, надето двуручное. Живой игры нет —
// состояние не меняется под ногами теста.

async function openDoll(page: Page, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  // «Герой» открывает куклу И сумку рядом — иначе перетаскивать неоткуда.
  await openMenu(page, 'Герой')
}

const doll = (page: Page) => page.locator('section', { hasText: 'Экипировка' }).first()
const bag = (page: Page) => page.locator('section', { hasText: 'Инвентарь' }).first()
const bagCards = (page: Page) => bag(page).locator('.grid > .slot.filled')
const targets = (page: Page) => doll(page).locator('.slot[data-drop="target"]')

/**
 * Берёт в руку первую находку, которую МОЖНО надеть прямо сейчас, и
 * возвращает её карточку вместе с именем. Перебор нужен: в пресете надето
 * двуручное, и половина находок просится во вторую руку, где их не примут.
 *
 * Имя нужно потому, что СЧИТАТЬ КАРТОЧКИ БЕСПОЛЕЗНО: слоты пресета заняты,
 * и надевание меняет вещь местами со снятой — в сумке остаётся столько же.
 * Первый заход теста мерил именно это и был зелёным на неработающем коде.
 */
async function carryFitting(page: Page): Promise<{ card: Locator; name: string }> {
  const cards = bagCards(page)
  const count = await cards.count()
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i)
    const name = (await card.locator('.name').innerText()).trim()
    await card.click()
    const target = targets(page)
    const fits = (await target.count()) === 1 && (await target.locator('[data-deny]').count()) === 0
    // Тёзка среди надетого сделал бы проверку «имя переехало» бессмысленной.
    const worn = await doll(page).locator('.slot .name').allInnerTexts()
    if (fits && !worn.includes(name)) return { card, name }
    // Не подошла — кладём обратно тем же нажатием и пробуем следующую.
    await card.click()
  }
  throw new Error('в сумке пресета нет ни одной вещи, которую можно надеть')
}

test('нажал вещь → подсветился слот → нажал слот: вещь надета', async ({ page }) => {
  await openDoll(page)
  const { name } = await carryFitting(page)

  // ПОДСВЕЧЕН РОВНО ОДИН слот, остальные притушены: у находки слот один —
  // тот, в который её бросил лут.
  await expect(targets(page)).toHaveCount(1)
  expect(await doll(page).locator('.slot[data-drop="dim"]').count()).toBeGreaterThan(0)
  // И видно, что вещь в руке.
  await expect(page.locator('[data-carrying]')).toBeVisible()

  await targets(page).click()

  // Вещь переехала в слот, и рука снова пуста.
  await expect(page.locator('[data-carrying]')).toHaveCount(0)
  await expect(doll(page).locator('.slot .name', { hasText: name })).toHaveCount(1)
})

test('наведение на подсвеченный слот показывает ОБЕ оси', async ({ page }) => {
  // Числа те же, что в окне сравнения: считает их одна `compareItem`, а
  // строки собирает общий `axisText.ts`. Проверяем, что показаны ОБЕ оси —
  // приоритет решает, что подсветить, а не что показать.
  await openDoll(page)
  await carryFitting(page)
  await targets(page).hover()
  const axes = page.locator('[data-axes]')
  await expect(axes).toBeVisible()
  await expect(axes).toContainText('Урон')
  await expect(axes).toContainText('Выживание')
  await expect(axes).toContainText(/\d|с нуля|без изменений/)
})

test('перетаскивание из сумки на слот надевает вещь', async ({ page }) => {
  await openDoll(page)
  const { card, name } = await carryFitting(page)
  // Запоминаем НОМЕР слота, пока вещь в руке: отпустив её, подсветку мы
  // погасим, и локатор по [data-drop=target] искать станет нечего.
  const index = await doll(page)
    .locator('.slot')
    .evaluateAll((els) => els.findIndex((el) => (el as HTMLElement).dataset.drop === 'target'))
  expect(index).toBeGreaterThanOrEqual(0)
  // Кладём обратно: путь перетаскивания обязан работать сам по себе.
  await card.click()
  await expect(page.locator('[data-carrying]')).toHaveCount(0)

  await card.dragTo(doll(page).locator('.slot').nth(index))
  await expect(doll(page).locator('.slot .name', { hasText: name })).toHaveCount(1)
})

test('долгое нажатие на находке надевает её сразу', async ({ page }) => {
  await openDoll(page)
  const { card, name } = await carryFitting(page)
  await card.click()

  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 8)
  await page.mouse.down()
  // Держим дольше порога из данных (LONG_PRESS_MS = 500 мс).
  await page.waitForTimeout(900)
  await page.mouse.up()

  await expect(doll(page).locator('.slot .name', { hasText: name })).toHaveCount(1)
})

test('двойной щелчок по надетому снимает его', async ({ page }) => {
  await openDoll(page)
  const before = await bagCards(page).count()
  await doll(page).locator('.slot.filled').first().dblclick()
  await expect(bagCards(page)).toHaveCount(before + 1)
})

test('с клавиатуры: кольцо фокуса видно, Enter кладёт вещь в слот', async ({ page }) => {
  await openDoll(page)
  const { name } = await carryFitting(page)

  // Кольцо фокуса ВИДНО. Фокус доводим КЛАВИШЕЙ, а не вызовом focus():
  // :focus-visible от программного фокуса на невводимом элементе не
  // срабатывает, и проверка мерила бы не то.
  await doll(page).locator('.slot').first().focus()
  // Внутри ячейки есть свои кнопки («Снять»), и Tab проходит через них:
  // идём до ближайшей СЛЕДУЮЩЕЙ ячейки, а не «на один Tab и ладно».
  let focused = { cls: '', shadow: 'none' }
  for (let i = 0; i < 20 && !focused.cls.includes('slot'); i += 1) {
    await page.keyboard.press('Tab')
    focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return { cls: el.className, shadow: getComputedStyle(el).boxShadow }
    })
  }
  expect(focused.cls, 'Tab не довёл фокус ни до одной ячейки').toContain('slot')
  expect(focused.shadow, 'у ячейки в фокусе нет видимого кольца').not.toBe('none')

  await targets(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-carrying]')).toHaveCount(0)
  await expect(doll(page).locator('.slot .name', { hasText: name })).toHaveCount(1)
})

test('Esc роняет вещь из руки, а меню не закрывает', async ({ page }) => {
  // Порядок «сперва вещь, потом меню»: одно нажатие не должно и ронять
  // находку, и закрывать экран, на котором её выбирали.
  await openDoll(page)
  await carryFitting(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-carrying]')).toHaveCount(0)
  await expect(doll(page)).toBeVisible()
  // Второе нажатие закрывает меню — руки уже пусты.
  await page.keyboard.press('Escape')
  await expect(page.locator('.pane > *')).toHaveCount(0)
})

test('отказ виден СТРОКОЙ до попытки, а не после', async ({ page }) => {
  // В пресете rich надето двуручное, поэтому вещь во вторую руку получает
  // код occupied-by-two-handed. Слот при этом ПОДСВЕЧЕН: он подходит вещи,
  // просто занят, — и разницу игрок обязан прочитать словами.
  await openDoll(page)
  const cards = bagCards(page)
  const count = await cards.count()
  let text: string | null = null
  for (let i = 0; i < count && text === null; i += 1) {
    await cards.nth(i).click()
    const denies = doll(page).locator('.slot[data-drop="target"] [data-deny]')
    if ((await denies.count()) > 0) text = await denies.first().innerText()
    else await cards.nth(i).click()
  }
  expect(text, 'ни одна вещь пресета не попросилась в занятый слот').not.toBeNull()
  expect(text).toContain('двуручным')
})

test('надетое, брошенное в сумку, снимается', async ({ page }) => {
  await openDoll(page)
  const before = await bagCards(page).count()
  await doll(page).locator('.slot.filled').first().dragTo(bag(page).locator('.grid').first())
  await expect(bagCards(page)).toHaveCount(before + 1)
})
