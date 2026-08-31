import { expect, test, type Page } from '@playwright/test'
import { sectionTab } from './screen.js'

// Подсказка — единственный способ объяснить число, не занимая им экран.
// Здесь проверяется то, что ломается молча: на телефоне нет наведения,
// открытую подсказку нечем закрыть, а у края экрана её не прочитать.

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
}

/** Кнопка ряда действий: она обёрнута в подсказку и есть в любом разделе. */
function ability(page: Page, last = false) {
  const all = page.locator('[aria-label="Действия"] button.slot')
  return last ? all.last() : all.first()
}

/**
 * Тап пальцем по координатам кнопки.
 *
 * Именно так, а не locator.click(): кнопка умения бывает выключена
 * (кулдаун, не хватает маны), и Playwright такую кнопку кликать
 * отказывается. Живой палец при этом попадает по обёртке подсказки —
 * disabled-кнопка не берёт указатель, — и подсказка открывается.
 * Это и есть проверяемое поведение: узнать ПОЧЕМУ нельзя нажать нужно
 * ровно тогда, когда нажать нельзя.
 */
/** Пузырь ИМЕННО этой кнопки: подсказок на экране много, и .first()
 *  попадает в чужую (в боевой панели они идут раньше по разметке). */
function bubbleOf(target: ReturnType<typeof ability>) {
  return target.locator('xpath=following-sibling::*[@role="tooltip"]')
}

async function tap(page: Page, target: ReturnType<typeof ability>): Promise<void> {
  const box = await target.boundingBox()
  if (!box) throw new Error('кнопка не на экране')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

test('на мобильном подсказка открывается НАЖАТИЕМ', async ({ page }) => {
  // Наведения на телефоне нет вовсе: подсказка только по hover там
  // не существует.
  await open(page, 390)
  const bubble = bubbleOf(ability(page))
  await expect(bubble).toBeHidden()
  await tap(page, ability(page))
  await expect(bubble).toBeVisible()
})

test('закрывается по Esc', async ({ page }) => {
  await open(page, 390)
  const bubble = bubbleOf(ability(page))
  await tap(page, ability(page))
  await expect(bubble).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bubble).toBeHidden()
})

test('закрывается кликом вне', async ({ page }) => {
  await open(page, 390)
  const bubble = bubbleOf(ability(page))
  await tap(page, ability(page))
  await expect(bubble).toBeVisible()
  await page.locator('h2').first().click({ force: true })
  await expect(bubble).toBeHidden()
})

test('на 390px подсказка не вылезает за края окна', async ({ page }) => {
  await open(page, 390)
  // Берём САМУЮ ПРАВУЮ кнопку умения: именно у неё пузырь уезжал за край.
  await tap(page, ability(page, true))
  const bubble = bubbleOf(ability(page, true))
  await expect(bubble).toBeVisible()
  const box = await bubble.boundingBox()
  expect(box!.x, 'левый край').toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width, 'правый край').toBeLessThanOrEqual(390)
})

test('у верхнего края экрана подсказка переворачивается вниз', async ({ page }) => {
  // Низкое окно и кнопка, прокрученная к самому верху: пузырю над ней места
  // нет, и без переворота длинное описание умения уезжает за верх экрана.
  await page.setViewportSize({ width: 390, height: 480 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await ability(page).evaluate((el) => el.scrollIntoView({ block: 'start' }))
  await tap(page, ability(page))
  const bubble = bubbleOf(ability(page))
  await expect(bubble).toBeVisible()
  const box = await bubble.boundingBox()
  expect(box!.y, 'верхний край').toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height, 'нижний край').toBeLessThanOrEqual(480)
})

test('подсказка умения показывает посчитанное число, а не формулу', async ({ page }) => {
  await open(page, 1280)
  await tap(page, ability(page))
  const bubble = bubbleOf(ability(page))
  await expect(bubble).toBeVisible()
  const text = await bubble.innerText()
  // В подсказке обязано быть конкретное число урона, а не только проценты.
  expect(text).toMatch(/Урон:.*≈\s*[\d.,KMB]+/)
})

// СРАВНЕНИЕ ПРЕДМЕТОВ НЕ ЗАСТРЕВАЕТ (находка 4.2 в AUDIT.md).
//
// Игрок кликал по иконке (карточка выглядит нажимаемой) — окно сравнения
// прикреплялось. Жал «Надеть»: предмет уходил в слот, окно исчезало вместе
// с ним, а флаг прикрепления оставался поднятым. Дальше наведение на ЛЮБОЙ
// другой предмет не показывало ничего, и подсказки, что нужен Esc, не было
// нигде на экране.
test('после действия над предметом сравнение снова работает при наведении', async ({ page }) => {
  await open(page, 1280)
  await sectionTab(page, 'Сумка').click()

  const cards = page
    .locator('.slot')
    .filter({ has: page.locator('button', { hasText: 'Продать' }) })
  await expect(cards.first()).toBeVisible()
  const compare = page.locator('[data-item-compare]')

  // Наведение показывает окно.
  await cards.first().hover()
  await expect(compare).toBeVisible()

  // Клик по иконке ПРИКРЕПЛЯЕТ его — именно с этого и начинался тупик.
  await cards.first().click()
  await expect(compare).toBeVisible()

  // Действие над предметом снимает прикрепление.
  await cards.first().locator('button', { hasText: 'Продать' }).click()

  // ГЛАВНОЕ: наведение снова живое. Уводим курсор совсем в сторону — окно
  // обязано пропасть, значит оно следует за мышью, а не приколото.
  await page.mouse.move(2, 2)
  await expect(compare).toHaveCount(0)

  // И на другой карточке появляется снова. Раньше здесь была тишина до
  // самого Esc, и ни одной подсказки, что нажимать именно его.
  await cards.nth(1).hover()
  await expect(compare).toBeVisible()
})
