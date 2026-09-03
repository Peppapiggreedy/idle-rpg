// Общие локаторы экрана для браузерных тестов.
//
// Живут отдельно потому, что уже один раз разъехались: разделов стало
// четыре вместо пяти, характеристики уехали в выдвижку, а кнопки умений
// сменили класс — и половина браузерных тестов искала на странице то,
// чего там больше нет. Локатор, записанный один раз, чинится тоже один раз.
import { expect, type Page } from '@playwright/test'

export async function openSettings(page: Page): Promise<void> {
  await openMenu(page, 'Настройки')
}

/** Кнопки ряда действий: умения и зелья — квадраты одного ряда под сценой. */
export function actionButtons(page: Page) {
  return page.locator('[aria-label="Действия"] button.slot')
}

/** Открыть меню по названию кнопки. Меню семь, паттерн один. */
export async function openMenu(page: Page, name: string): Promise<void> {
  await page.locator('nav[aria-label^="Меню"] button', { hasText: name }).first().click()
  await expect(page.locator('.pane > *').first()).toBeVisible()
}

/**
 * ДОЛЯ ЭЛЕМЕНТА, КОТОРУЮ ИГРОК ВИДИТ НА САМОМ ДЕЛЕ.
 *
 * Обычная проверка `toBeVisible()` здесь бесполезна, и это доказано делом:
 * подсказка умения была срезана прокручиваемым предком до последнего
 * пикселя, а Playwright считал её видимой — `getBoundingClientRect` отдаёт
 * неурезанный прямоугольник, `visibility` остаётся `visible`. Шесть тестов
 * на подсказку были зелёными, пока игрок не видел ничего.
 *
 * Мерить клипы и наложения самому — значит переписать пол-CSS и ошибиться.
 * Поэтому спрашиваем сам браузер: бьём сеткой точек по прямоугольнику
 * элемента и считаем, в скольких из них попадание приходится на него самого.
 * Это ловит и обрезание предком, и перекрытие холстом сцены, и уход
 * за границу окна — то есть ровно то, из-за чего подсказки не было видно.
 *
 * `pointer-events` на время замера включается: у подсказки он выключен
 * намеренно, иначе она перехватывала бы нажатия кнопок под собой.
 */
export async function visibleFraction(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null
    if (!el) return 0
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return 0
    const prev = el.style.pointerEvents
    el.style.pointerEvents = 'auto'
    const STEPS = 7
    let hit = 0
    let total = 0
    for (let i = 0; i < STEPS; i += 1) {
      for (let j = 0; j < STEPS; j += 1) {
        const x = r.left + (r.width * (i + 0.5)) / STEPS
        const y = r.top + (r.height * (j + 0.5)) / STEPS
        total += 1
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue
        const top = document.elementFromPoint(x, y)
        if (top && (top === el || el.contains(top))) hit += 1
      }
    }
    el.style.pointerEvents = prev
    return hit / total
  }, selector)
}
