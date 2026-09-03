import { expect, test, type Page } from '@playwright/test'
import { openMenu, visibleFraction } from './screen.js'

/** Селектор пузыря первой кнопки умений — для замера настоящей видимости. */
const ABILITY_BUBBLE = '[aria-label="Действия"] .host [role="tooltip"]'

// Подсказка — единственный способ объяснить число, не занимая им экран.
// Здесь проверяется то, что ломается молча: на телефоне нет наведения,
// открытую подсказку нечем закрыть, а у края экрана её не прочитать.

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
}

/**
 * То же, но СО СЦЕНОЙ — то есть так, как игру видит игрок.
 *
 * Все проверки подсказки раньше шли с `scene=off`, и именно поэтому дважды
 * «починенная» подсказка умения оставалась невидимой: её срезал ряд действий
 * (`overflow-x: auto`), а поверх ещё и рисовался холст сцены.
 */
async function openWithScene(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await page.waitForTimeout(1200)
}

/** Наведение настоящей мышью: hover() отказывается работать с disabled. */
async function hoverAbility(page: Page): Promise<void> {
  const btn = page.locator('[aria-label="Действия"] button.slot').first()
  const box = await btn.boundingBox()
  if (!box) throw new Error('кнопка умения не на экране')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForTimeout(250)
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
  await openMenu(page, 'Сумка')

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

// ПОДСКАЗКА УМЕНИЯ ВИДНА НА САМОМ ДЕЛЕ.
//
// Эти проверки появились из поломки, дожившей до третьего захода. Подсказка
// была написана правильно и «работала»: DOM на месте, `visibility: visible`,
// прямоугольник ненулевой — а игрок не видел ничего. Пузырь висел `absolute`
// внутри ряда действий, у которого `overflow-x: auto` ради прокрутки иконок
// на узком экране, и срезался целиком; поверх него ещё и рисовался холст.
//
// `toBeVisible()` такой элемент считает видимым, поэтому шесть тестов на
// подсказку были зелёными. Меряем не «есть ли в DOM», а сколько его точек
// попадают в саму подсказку при hit-тесте браузера.
test('подсказка умения ВИДНА при наведении, а не только есть в DOM', async ({ page }) => {
  await openWithScene(page, 1280)
  expect(await visibleFraction(page, ABILITY_BUBBLE), 'до наведения').toBeLessThan(0.05)
  await hoverAbility(page)
  expect(await visibleFraction(page, ABILITY_BUBBLE), 'после наведения').toBeGreaterThan(0.95)
})

test('подсказка умения не срезается рядом действий и не уходит под сцену', async ({ page }) => {
  // Тот же замер на узком экране: там ряд действий прокручивается, и клип
  // у него настоящий, а не теоретический.
  await openWithScene(page, 390)
  const btn = page.locator('[aria-label="Действия"] button.slot').first()
  const box = await btn.boundingBox()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForTimeout(250)
  expect(await visibleFraction(page, ABILITY_BUBBLE)).toBeGreaterThan(0.95)
})

test('в подсказке умения есть посчитанный урон, а не формула', async ({ page }) => {
  await openWithScene(page, 1280)
  await hoverAbility(page)
  const text = await page.locator(ABILITY_BUBBLE).first().innerText()
  expect(text.length).toBeGreaterThan(20)
  // Конкретное число, а не только проценты.
  expect(text).toMatch(/Урон:.*≈\s*[\d.,KMB]+/)
})
