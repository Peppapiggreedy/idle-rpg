import { expect, test, type Page } from '@playwright/test'
import { openMenu } from './screen.js'

// МЕНЮ КРАФТА: РАЗДЕЛЫ ПО КАТЕГОРИЯМ, А НЕ ОДИН СПИСОК.
//
// Проверяется не вид (вид держат эталоны снимков), а свойства: заголовок
// считает содержимое, развёрнуто то, где есть что собрать, сворачивание
// прячет ровно свой раздел, а выбор игрока переживает перезагрузку. Каждое
// ломается порознь — поэтому и тесты порознь.

async function openCraft(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await openMenu(page, 'Крафт')
}

const folds = (page: Page) => page.locator('[data-fold]')

/** Заголовки разделов с разобранным счётчиком и состоянием. */
async function readFolds(page: Page) {
  const rows: { key: string; ready: number; total: number; open: boolean }[] = []
  const count = await folds(page).count()
  for (let i = 0; i < count; i += 1) {
    const fold = folds(page).nth(i)
    const text = (await fold.innerText()).replace(/\s+/g, ' ')
    const match = text.match(/(\d+) из (\d+) доступно/)
    expect(match, `заголовок «${text}» без счётчика`).not.toBeNull()
    rows.push({
      key: (await fold.getAttribute('data-fold'))!,
      ready: Number(match![1]),
      total: Number(match![2]),
      open: (await fold.getAttribute('aria-expanded')) === 'true',
    })
  }
  return rows
}

test('счётчик заголовка совпадает с числом рецептов внутри', async ({ page }) => {
  await openCraft(page)
  const rows = await readFolds(page)
  expect(rows.length).toBeGreaterThan(1)
  for (const row of rows) {
    // ПУСТОЙ РАЗДЕЛ НЕ ПОКАЗЫВАЕТСЯ ВОВСЕ: заголовок без содержимого обещает
    // то, чего за ним нет.
    expect(row.total, `раздел ${row.key} пуст`).toBeGreaterThan(0)
    expect(row.ready).toBeLessThanOrEqual(row.total)
    if (!row.open) continue
    const body = page.locator(`[data-fold-body="${row.key}"] > li`)
    expect(await body.count(), `раздел ${row.key}`).toBe(row.total)
  }
})

test('развёрнуто ровно то, где есть что собрать прямо сейчас', async ({ page }) => {
  await openCraft(page)
  const rows = await readFolds(page)
  // Обе стороны правила обязаны быть представлены, иначе тест ничего не
  // различает: на «позднем» пресете есть и то, что собирается, и то, что нет.
  expect(rows.some((r) => r.ready > 0)).toBe(true)
  expect(rows.some((r) => r.ready === 0)).toBe(true)
  for (const row of rows) {
    expect(row.open, `раздел ${row.key}: ${row.ready} из ${row.total}`).toBe(row.ready > 0)
  }
})

test('раздел сворачивается и разворачивается, и прячет ТОЛЬКО себя', async ({ page }) => {
  await openCraft(page)
  const rows = await readFolds(page)
  const key = rows.find((r) => r.open)!.key
  const fold = page.locator(`[data-fold="${key}"]`)
  const bodies = await page.locator('[data-fold-body]').count()

  await fold.click()
  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator(`[data-fold-body="${key}"]`)).toHaveCount(0)
  // Соседи на месте: свернулся ровно один раздел.
  expect(await page.locator('[data-fold-body]').count()).toBe(bodies - 1)

  await fold.click()
  await expect(page.locator(`[data-fold-body="${key}"]`)).toHaveCount(1)
})

test('свёрнутый раздел ПЕРЕЖИВАЕТ перезагрузку', async ({ page }) => {
  await openCraft(page)
  const rows = await readFolds(page)
  const open = rows.find((r) => r.open)!.key
  const shut = rows.find((r) => !r.open)!.key
  await page.locator(`[data-fold="${open}"]`).click()
  // И обратный случай: развёрнутое руками тоже обязано пережить перезагрузку.
  await page.locator(`[data-fold="${shut}"]`).click()

  // Настройка машины, а не сейв: она лежит в своём ключе localStorage. Без
  // этого сворачивание не экономит ничего — раздел разворачивался бы обратно
  // при каждом заходе.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await openMenu(page, 'Крафт')
  await expect(page.locator(`[data-fold="${open}"]`)).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator(`[data-fold="${shut}"]`)).toHaveAttribute('aria-expanded', 'true')
})
