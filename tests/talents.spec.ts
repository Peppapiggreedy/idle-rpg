import { expect, test, type Page } from '@playwright/test'
import { openMenu } from './screen.js'

// ЭКРАН ТАЛАНТОВ: ЭТАЖ — РЯД, А НЕ СТРОКА СПИСКА.
//
// Пока на этаже стоял один талант, «этаж» и «талант» были одним и тем же, и
// панель рисовала столбик. С альтернативами это разные вещи, и разъезжаются
// они молча: порог у ряда ОБЩИЙ, и подписанный у каждой клетки он читался бы
// как три разных порога на одном этаже.
//
// Проверяется не вид, а СВОЙСТВА — каждое ломается порознь, поэтому и тесты
// порознь.

async function openTree(page: Page, state = 'rich'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`?debug=1&state=${state}&scene=off`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await openMenu(page, 'Таланты')
}

const floors = (page: Page) => page.locator('[data-floor]')
const talents = (page: Page) => page.locator('[data-talent]')
/** Цена сброса — по ней и видно, тронут ли счётчик платных сбросов. */
const resetButton = (page: Page) => page.locator('button', { hasText: 'Сбросить таланты' })

test('ветка разложена по этажам, и порог подписан ОДИН РАЗ НА РЯД', async ({ page }) => {
  await openTree(page)
  const rows = await floors(page).count()
  expect(rows).toBe(13)

  for (let i = 0; i < rows; i += 1) {
    const floor = floors(page).nth(i)
    // Ровно один порог на этаж: два значило бы, что этаж не этаж.
    await expect(floor.locator('.gate')).toHaveCount(1)
    // ПУСТЫХ МЕСТ В РЯДУ НЕТ: этаж без таланта — дырка в дереве.
    expect(await floor.locator('[data-talent]').count()).toBeGreaterThanOrEqual(1)
    // Порог этажа — шаг ветки, умноженный на номер этажа сверху.
    await expect(floor.locator('.gate')).toHaveText(String(i * 5))
  }
})

test('у каждого таланта видны ранг и потолок', async ({ page }) => {
  await openTree(page)
  const ranks = await talents(page).locator('[data-rank]').allInnerTexts()
  expect(ranks.length).toBe(await talents(page).count())
  for (const rank of ranks) expect(rank.trim()).toMatch(/^\d+\/\d+$/)
  // На богатом пресете очки вложены, и хотя бы один талант стоит полным.
  expect(ranks.some((r) => {
    const [have, max] = r.trim().split('/')
    return have === max && have !== '0'
  })).toBe(true)
})

test('недоступный талант НАЗЫВАЕТ причину, а не молчит', async ({ page }) => {
  await openTree(page)
  const reasons = await talents(page).locator('[data-reason]').allInnerTexts()
  expect(reasons.length).toBeGreaterThan(0)
  // Причина — предложение для человека, а не код из логики.
  for (const reason of reasons) {
    expect(reason.trim().length).toBeGreaterThan(8)
    expect(reason).not.toMatch(/branch-locked|no-points|max-rank|needs-talent/)
  }
})

test('ветки переключаются вкладками, и вложенное видно в каждой', async ({ page }) => {
  await openTree(page)
  const tabs = page.locator('[data-branch-tabs] .tab')
  expect(await tabs.count()).toBe(3)
  // Выбор ветки — главное решение игрока, и делать его вслепую нельзя:
  // сколько вложено, видно у каждой вкладки, не переключаясь.
  const spent = await tabs.locator('.spent').allInnerTexts()
  expect(spent.length).toBe(3)
  expect(spent.map((s) => Number(s.trim())).some((n) => n > 0)).toBe(true)

  const first = await page.locator('[data-branch]').getAttribute('data-branch')
  await tabs.nth(1).click()
  await expect(page.locator('[data-branch]')).not.toHaveAttribute('data-branch', first ?? '')
  // Открыта РОВНО ОДНА ветка: три дерева по тридцать узлов рядом не
  // помещаются ни на одном экране.
  await expect(page.locator('[data-branch]')).toHaveCount(1)
})

test('вложенное В ЭТОТ ЗАХОД снимается бесплатно', async ({ page }) => {
  // Середина игры: десятый уровень, первое очко пришло и ещё не потрачено —
  // ровно тот момент, ради которого экран и открывают.
  await openTree(page, 'mid')
  const priceBefore = await resetButton(page).innerText()
  const free = page.locator('[data-branch-tabs]').locator('..').locator('..')

  const first = talents(page).first()
  await expect(first.locator('[data-rank]')).toHaveText('0/6')
  // Пока ничего не вложено, снимать нечего — и кнопки нет вовсе.
  await expect(first.locator('button', { hasText: 'Снять' })).toHaveCount(0)

  await first.locator('button', { hasText: 'Вложить' }).click()
  await expect(first.locator('[data-rank]')).toHaveText('1/6')
  await expect(first.locator('button', { hasText: 'Снять' })).toHaveCount(1)

  await first.locator('button', { hasText: 'Снять' }).click()
  await expect(first.locator('[data-rank]')).toHaveText('0/6')
  // СЧЁТЧИК ПЛАТНЫХ СБРОСОВ НЕ ТРОНУТ: цена следующего сброса та же.
  // Иначе бесплатная отмена дорожала бы сброс, то есть была бы не
  // бесплатной, а с отложенной ценой.
  expect(await resetButton(page).innerText()).toBe(priceBefore)
  expect(await free.innerText()).toContain('свободных очков')
})

test('закрыл экран — снимать больше нечего', async ({ page }) => {
  // Граница захода — не удобство, а цена: раздать сброс бесплатно значит
  // обесценить и сам сброс, и решение, которое игрок уже принял.
  await openTree(page, 'mid')
  const first = talents(page).first()
  await first.locator('button', { hasText: 'Вложить' }).click()
  await expect(first.locator('button', { hasText: 'Снять' })).toHaveCount(1)

  await page.keyboard.press('Escape')
  await openMenu(page, 'Таланты')
  const again = talents(page).first()
  await expect(again.locator('[data-rank]')).toHaveText('1/6')
  await expect(again.locator('button', { hasText: 'Снять' })).toHaveCount(0)
})
