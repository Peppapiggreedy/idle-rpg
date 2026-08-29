// Общие локаторы экрана для браузерных тестов.
//
// Живут отдельно потому, что уже один раз разъехались: разделов стало
// четыре вместо пяти, характеристики уехали в выдвижку, а кнопки умений
// сменили класс — и половина браузерных тестов искала на странице то,
// чего там больше нет. Локатор, записанный один раз, чинится тоже один раз.
import { expect, type Page } from '@playwright/test'

/** Вкладка раздела ПО ПОДПИСИ, а не по номеру: номер молча уезжает,
 *  когда разделов становится больше или меньше. */
export function sectionTab(page: Page, name: string) {
  return page.locator('nav[aria-label="Разделы"] button', { hasText: name })
}

export async function openSettings(page: Page): Promise<void> {
  await sectionTab(page, 'Настройки').click()
}

/** Кнопки ряда действий: умения и зелья — квадраты одного ряда под сценой. */
export function actionButtons(page: Page) {
  return page.locator('[aria-label="Действия"] button.slot')
}

/** Выдвижка «Герой»: характеристики и экипировка живут в ней, а не во вкладке. */
export async function openHeroDrawer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Герой', exact: true }).click()
  await expect(page.locator('[role="region"][aria-label="Герой"]')).toBeVisible()
}
