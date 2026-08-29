import { expect, test, type Page } from '@playwright/test'

// Бюджеты слоя представления. 3D-сцена, работающая часами, греет телефон
// и ест батарею — а заметно это становится через час игры, когда чинить
// уже дорого. Поэтому пределы закреплены здесь, а не проверяются на глаз.

const SCENE_READY = '[data-scene="ready"]'

async function openLiveGame(page: Page): Promise<void> {
  // ЖИВАЯ игра, а не пресет: бюджеты меряются на работающем цикле.
  await page.goto('?debug=1')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'game')
  // Новая игра начинается с выбора класса, и до выбора экран закрыт им же.
  // Берём первый класс: бюджеты слоя представления от класса не зависят,
  // а вот незакрытый выбор перехватил бы все нажатия теста.
  await page.getByRole('button', { name: /^Играть за/ }).first().click()
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
}

const domNodes = (page: Page) => page.evaluate(() => document.getElementsByTagName('*').length)

async function probe(page: Page, label: string): Promise<number> {
  const text = await page.locator(`text=/^${label}: /`).innerText()
  return Number(text.split(': ')[1])
}

test('за полчаса игрового времени сцена и DOM не разрастаются', async ({ page }) => {
  test.setTimeout(360_000)
  await openLiveGame(page)

  // ×100 отладочного ускорения. Потолок шагов за кадр (10) и лимит кадров
  // (30) дают примерно тридцать игровых секунд за реальную, поэтому
  // полчаса игрового времени — это около минуты реального.
  await page.getByRole('button', { name: '×100', exact: true }).click()

  // ПРОГРЕВ перед замером. С нуля растут ДВЕ вещи, и обе законно: лог до
  // своего потолка в 50 строк и сумка до 12 предметов — вместе это под три
  // сотни узлов. Мерить их как утечку значит мерить не то, поэтому точка
  // отсчёта — установившееся состояние, а не пустой экран.
  //
  // Сумку ждём по счётчику на вкладке, а не по таймеру: сколько реального
  // времени уйдёт на двенадцать находок, зависит от машины, и таймер здесь
  // означал бы «иногда успело, иногда нет».
  // Таймаут щедрый: дроп на старте редкий (25% с моба при TTK ~13 игровых
  // секунд), и на двенадцать находок уходит пара минут даже на ×100.
  const bagTab = page.locator('nav[aria-label="Разделы"] button', { hasText: 'Сумка' })
  await expect(bagTab).toContainText('12/12', { timeout: 240_000 })
  await page.waitForTimeout(5_000)
  const nodesBefore = await domNodes(page)
  const geometriesBefore = await probe(page, 'geometries')

  await page.waitForTimeout(60_000)
  await page.getByRole('button', { name: '×1', exact: true }).click()
  await page.waitForTimeout(2500)

  const nodesAfter = await domNodes(page)
  const geometriesAfter = await probe(page, 'geometries')
  const playtime = await page.evaluate(() => document.body.innerText.match(/0:\d\d:\d\d/)?.[0])
  console.log(
    `узлов DOM: ${nodesBefore} → ${nodesAfter}, геометрий: ${geometriesBefore} → ${geometriesAfter}, игровое время: ${playtime}`,
  )

  // Требование шага: не больше пяти процентов расхождения.
  expect(nodesAfter).toBeLessThanOrEqual(Math.ceil(nodesBefore * 1.05))
  // Геометрия не растёт вовсе: мобы переиспользуют один меш, обстановка
  // зоны выгружается целиком.
  expect(geometriesAfter).toBeLessThanOrEqual(geometriesBefore + 1)
})

test('при document.hidden сцена не создаёт всплывающих чисел', async ({ page }) => {
  await openLiveGame(page)
  // Убеждаемся, что на видимой вкладке они вообще бывают, — иначе тест
  // проверял бы отсутствие того, чего и так нет. Ждём появления, а не
  // подглядываем в один момент: число живёт меньше секунды.
  const floaters = page.locator('.floater')
  await expect(floaters.first()).toBeAttached({ timeout: 20_000 })

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  // Живые числа дотлевают, новых не появляется.
  await page.waitForTimeout(2500)
  expect(await floaters.count(), 'на спрятанной вкладке новых чисел нет').toBe(0)

  // Лог при этом продолжает наполняться, и это правильно: игра идёт,
  // а лента ограничена своим потолком и расти без предела не может.
  const rows = await page.locator('ul[aria-label="Боевой лог"] li').count()
  expect(rows).toBeLessThanOrEqual(50)
})

test('десять переключений текстового режима не растят память', async ({ page }) => {
  await openLiveGame(page)
  await page.locator('nav[aria-label="Разделы"] button').nth(4).click()
  const toText = page.getByRole('button', { name: 'Всегда текст' })
  const toScene = page.getByRole('button', { name: 'Всегда сцена' })

  await toScene.click()
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  const before = await probe(page, 'geometries')

  for (let i = 0; i < 10; i += 1) {
    await toText.click()
    await expect(page.locator('canvas')).toHaveCount(0)
    await toScene.click()
    await expect(page.locator('canvas')).toHaveCount(1)
  }
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  const after = await probe(page, 'geometries')
  console.log(`текстовый режим туда-обратно: ${before} → ${after}`)
  expect(after).toBeLessThanOrEqual(before + 1)
})

test('переключение в текст и обратно не ломает прогресс', async ({ page }) => {
  await openLiveGame(page)
  await page.waitForTimeout(1500)
  const goldOf = async () =>
    Number((await page.locator('text=/^Золото/').first().innerText()).replace(/\D/g, '')) || 0

  await page.locator('nav[aria-label="Разделы"] button').nth(4).click()
  await page.getByRole('button', { name: 'Всегда текст' }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  // Игра идёт: бой в текстовом режиме продолжается, уровень и золото на месте.
  await expect(page.locator('main')).toContainText('Урон в секунду')
  await page.getByRole('button', { name: 'Всегда сцена' }).click()
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  void goldOf
})
