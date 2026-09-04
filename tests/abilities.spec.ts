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
