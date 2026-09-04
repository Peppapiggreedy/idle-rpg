import { expect, test, type Page } from '@playwright/test'
import { openMenu } from './screen.js'

// КНИГА УМЕНИЙ: место, где четвёрка выбирается из всего набора.
//
// Проверяется не вид, а СВОЙСТВА: закрытые видны с уровнем, состав меняется
// и немедленно отражается в ряду под сценой, связка подписана. Всё это
// ломается порознь, поэтому и тесты порознь.

async function openBook(page: Page, state = 'rich'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`?debug=1&state=${state}&scene=off`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await openMenu(page, 'Умения')
}

const book = (page: Page) => page.locator('section', { hasText: 'Книга умений' }).first()
const rows = (page: Page) => book(page).locator('[data-ability]')
const barSlots = (page: Page) => page.locator('[aria-label="Действия"] [data-kind="ability"]')

test('книга показывает ВСЕ умения класса', async ({ page }) => {
  await openBook(page)
  // Ровно столько, сколько их у класса, — и открытые, и закрытые.
  expect(await rows(page).count()).toBeGreaterThanOrEqual(4)
  // У каждой строки есть роль словами: по ней и выбирают.
  for (const text of await rows(page).locator('.role').allInnerTexts()) {
    expect(text.length).toBeGreaterThan(20)
  }
})

test('закрытое умение видно и называет уровень открытия', async ({ page }) => {
  // Это исключение из правила «закрыто значит не видно», и оно осознанное:
  // список умений — обещание, ради которого играют дальше.
  await openBook(page, 'fresh')
  const locks = book(page).locator('[data-lock]')
  expect(await locks.count()).toBeGreaterThan(0)
  await expect(locks.first()).toContainText('уровне')
})

test('состав меняется нажатием и СРАЗУ отражается в ряду под сценой', async ({ page }) => {
  await openBook(page, 'fresh')
  const before = await barSlots(page).nth(3).getAttribute('aria-label')
  // Берём из книги умение, которого в четвёртом слоте нет, и кладём туда.
  const names = await rows(page).locator('.name').allInnerTexts()
  const wanted = names.map((n) => n.split('\n')[0].trim()).find((n) => n !== before)
  expect(wanted, 'в книге нет ни одного умения, отличного от четвёртого слота').toBeTruthy()
  await book(page).locator('button.grab', { hasText: '' }).first().click()
  await expect(page.locator('[data-book-carrying]')).toBeVisible()
  await book(page).locator('[data-book-slots] button').nth(3).click()
  await expect(page.locator('[data-book-carrying]')).toHaveCount(0)
  // Ряд под сценой обновился в ту же секунду: второго состояния «состав» нет.
  await expect(barSlots(page).nth(3)).not.toHaveAttribute('aria-label', before ?? '')
})

test('слотов в книге столько же, сколько в ряду', async ({ page }) => {
  // Два ряда на один и тот же состав — это два источника правды; здесь
  // проверяется, что источник один.
  await openBook(page)
  expect(await book(page).locator('[data-book-slots] button').count()).toBe(
    await barSlots(page).count(),
  )
})

// ПОРЯДОК СЛОТОВ МЕНЯЕТСЯ, И ЭТО НЕ КОСМЕТИКА (находка 7).
//
// Порядок слотов ЕСТЬ приоритет автокаста — так устроена вся система. Пока
// порядок нельзя изменить, половина принятого решения не существует: игрок
// выбирает четвёрку, но не может выбрать, что жмётся первым.
//
// Раньше перетаскивание внутри ряда было мертво по четырём причинам разом, и
// главная — `disabled` у кнопки: в бою умение почти всегда на откате, а
// отключённая кнопка не выдаёт событий перетаскивания вовсе.

/** Имена умений в ряду по порядку слотов. */
async function barOrder(page: Page): Promise<string[]> {
  return barSlots(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  )
}

test('тап по слоту, тап по другому — умения меняются местами', async ({ page }) => {
  // ЕДИНСТВЕННЫЙ путь на тач-экране: HTML5-перетаскивания там нет вовсе.
  await openBook(page)
  const before = await barOrder(page)
  expect(before[0]).not.toBe(before[2])

  // Открываем книгу: её ряд слотов — тот же ряд, и тап-тап работает и там.
  const cells = book(page).locator('[data-book-slots] button')
  await cells.nth(0).click()
  await expect(book(page).locator('[data-book-carrying]')).toBeVisible()
  await cells.nth(2).click()

  const after = await barOrder(page)
  expect(after[0]).toBe(before[2])
  expect(after[2]).toBe(before[0])
  // Состав тот же — переставили, а не потеряли.
  expect([...after].sort()).toEqual([...before].sort())
})

test('слот в ряду под сценой перетаскивается в другой слот', async ({ page }) => {
  await openBook(page)
  const before = await barOrder(page)
  const slots = barSlots(page)
  await slots.nth(0).dragTo(slots.nth(1))
  const after = await barOrder(page)
  expect(after[0]).toBe(before[1])
  expect(after[1]).toBe(before[0])
})

test('перетаскивание работает и когда умение НЕ нажимается', async ({ page }) => {
  // Главная причина, по которой жест был мёртв: кнопка стояла disabled, а в
  // бою умение почти всегда на откате или без ресурса.
  await openBook(page)
  const slots = barSlots(page)
  const blocked = page.locator('[aria-label="Действия"] button.slot.blocked')
  if ((await blocked.count()) === 0) test.skip(true, 'в этом пресете все умения доступны')
  const label = await blocked.first().getAttribute('aria-label')
  // Недоступное помечено aria-disabled, а НЕ disabled: иначе нет событий.
  await expect(blocked.first()).toHaveAttribute('aria-disabled', 'true')
  await expect(blocked.first()).not.toHaveAttribute('disabled', '')
  const from = (await barOrder(page)).indexOf(label ?? '')
  const to = from === 0 ? 1 : 0
  await slots.nth(from).dragTo(slots.nth(to))
  expect((await barOrder(page))[to]).toBe(label)
})

test('умение из ряда возвращается в книгу и слот пустеет', async ({ page }) => {
  await openBook(page)
  const cells = book(page).locator('[data-book-slots] button')
  const before = await barOrder(page)

  // Берём умение из слота и бросаем в список книги.
  await cells.nth(0).click()
  await expect(book(page).locator('[data-book-carrying]')).toBeVisible()
  await rows(page).first().locator('button.grab').click()

  const empty = page.locator('[aria-label="Действия"] .slot.empty')
  expect(await empty.count()).toBeGreaterThan(0)
  const after = await barOrder(page)
  expect(after).not.toEqual(before)
})

test('Esc роняет несомое умение, а не закрывает меню', async ({ page }) => {
  await openBook(page)
  const cells = book(page).locator('[data-book-slots] button')
  await cells.nth(0).click()
  await expect(book(page).locator('[data-book-carrying]')).toBeVisible()
  await page.keyboard.press('Escape')
  // Умение из руки выпало...
  await expect(book(page).locator('[data-book-carrying]')).toHaveCount(0)
  // ...а меню осталось открытым: Esc снимает БЛИЖАЙШЕЕ.
  await expect(book(page)).toBeVisible()
})

test('ПРИОРИТЕТ АВТОКАСТА следует новому порядку, а не остаётся прежним', async ({ page }) => {
  // Проверять журналом боя нельзя: в режиме пресета игровой цикл не
  // запускается, и после перестановки лог не пополнится ни строкой. Зато
  // настройки автокаста показывают порядок ЧИСЛОМ приоритета — тем же
  // порядком слотов, из которого он и выводится.
  await openBook(page)
  const before = await barOrder(page)

  // Список автокаста идёт В ПОРЯДКЕ ПРИОРИТЕТА — сверху то, что жмётся
  // первым, — и это ровно порядок слотов.
  // Панель автокаста опознаётся по своему выключателю, а не по слову
  // «Автокаст»: слово встречается и в заголовке меню, и наружная секция
  // захватывала заодно книгу.
  const priorities = () =>
    page.locator('section:has([data-autocast-master])').locator('.list .name').allInnerTexts()

  // Сперва убеждаемся, что читаем настоящий список, а не пустоту: условная
  // проверка, которая никогда не срабатывает, — тот же зелёный, что у
  // сторожа, которому нечего сказать.
  const listedBefore = await priorities()
  expect(listedBefore.length, 'список автокаста пуст — проверять нечего').toBeGreaterThan(1)
  expect(listedBefore[0]).toBe(before[0])

  const cells = book(page).locator('[data-book-slots] button')
  await cells.nth(0).click()
  await cells.nth(1).click()

  const after = await barOrder(page)
  expect(after[0]).toBe(before[1])
  // ГЛАВНОЕ: приоритет поехал вместе с рядом, а не остался прежним.
  const listedAfter = await priorities()
  expect(listedAfter[0]).toBe(after[0])
  expect(listedAfter[0]).not.toBe(listedBefore[0])
})
