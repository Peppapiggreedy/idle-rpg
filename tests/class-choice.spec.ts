import { expect, test, type Page } from '@playwright/test'
import { actionButtons } from './screen.js'

// Выбор класса — единственное необратимое решение в игре, и ломается оно
// не в компоненте, а в жизненном цикле страницы: кто и когда успел записать
// сейв. Отсюда проверки именно здесь, на живой странице с настоящим
// localStorage: в юнит-тесте нет ни перезагрузки, ни ухода вкладки в фон.
const SAVE_KEY = 'idle-rpg-save'

const picker = (page: Page) => page.getByRole('heading', { name: 'С кем ты играешь' })
const savedRaw = (page: Page) => page.evaluate((k) => localStorage.getItem(k), SAVE_KEY)

/** Класс героя подписан в строке полосок: отдельного заголовка с классом
 *  и уровнем на экране больше нет — он занимал строку над самой сценой. */
const heroClass = (page: Page, name: string) =>
  page.locator('.vitals .klass').filter({ hasText: name })

async function openFresh(page: Page): Promise<void> {
  await page.goto('?debug=1')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'game')
}

test('до выбора класса сейв не появляется', async ({ page }) => {
  await openFresh(page)
  await expect(picker(page)).toBeVisible()

  // Автосейв ходит раз в 15 игровых секунд, а уход вкладки в фон сохраняет
  // сразу. Проверяем ОБА писателя: любой из них, сработав до выбора, записал
  // бы класс по умолчанию — и следующая загрузка сочла бы игру начатой.
  await page.waitForTimeout(20_000)
  expect(await savedRaw(page), 'автосейв не должен был сработать').toBeNull()

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(500)
  expect(await savedRaw(page), 'уход в фон не должен был сохранить').toBeNull()

  // И самое главное: после перезагрузки выбор по-прежнему на месте.
  await page.reload()
  await expect(picker(page)).toBeVisible()
})

// Шторка поверх смонтированной игры — не то же самое, что отсутствие игры.
// Под шторкой оставались живыми глобальные хоткеи умений (слушатель висит на
// window, и inert его не гасит), Tab уходил на невидимые кнопки, а сцена
// рисовала бой герою, которого ещё не выбрали.
test('до выбора класса игры нет вовсе, а не «спрятана»', async ({ page }) => {
  await openFresh(page)
  await expect(picker(page)).toBeVisible()

  expect(await actionButtons(page).count(), 'кнопок умений быть не должно').toBe(0)
  expect(await page.locator('canvas').count(), 'сцены быть не должно').toBe(0)
  expect(await page.locator('nav[aria-label="Разделы"]').count(), 'вкладок быть не должно').toBe(0)

  // Хоткей умения ничего не находит и ничего не делает.
  await page.keyboard.press('1')
  await expect(picker(page)).toBeVisible()

  // Всё это появляется ровно после выбора.
  await page.getByRole('button', { name: 'Играть за стража' }).click()
  await expect(actionButtons(page).first()).toBeVisible()
})

test('выбранный класс переживает перезагрузку', async ({ page }) => {
  await openFresh(page)
  await page.getByRole('button', { name: 'Играть за изувера' }).click()
  await expect(picker(page)).toBeHidden()
  await expect(heroClass(page, 'Изувер')).toBeVisible()

  await page.reload()
  await expect(picker(page)).toBeHidden()
  await expect(heroClass(page, 'Изувер')).toBeVisible()
})

test('сброс сейва возвращает выбор класса', async ({ page }) => {
  page.on('dialog', (d) => void d.accept())
  await openFresh(page)
  await page.getByRole('button', { name: 'Играть за изувера' }).click()
  await expect(picker(page)).toBeHidden()

  await page.getByRole('button', { name: 'сброс сейва' }).click()
  await expect(picker(page)).toBeVisible()
  expect(await savedRaw(page), 'сейв должен быть стёрт, а не переписан').toBeNull()

  // Стёрто по-настоящему: перезагрузка не воскрешает прежнего героя.
  await page.reload()
  await expect(picker(page)).toBeVisible()

  // И теперь можно выбрать другой класс.
  await page.getByRole('button', { name: 'Играть за стража' }).click()
  await expect(heroClass(page, 'Страж')).toBeVisible()
})
