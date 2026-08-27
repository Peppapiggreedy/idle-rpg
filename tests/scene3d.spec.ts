import { expect, test, type Page } from '@playwright/test'

// Поведение боевой сцены в живом браузере. Пиксели здесь не сравниваются
// (см. screenshots.spec.ts, почему их сравнивать нельзя) — проверяется то,
// что от сцены требуется по существу: она рисуется, она полностью
// останавливается в текстовом режиме, освобождает ресурсы
// и она не роняет игру, когда WebGL не дают.

const SCENE_READY = '[data-scene="ready"]'

async function openGame(page: Page, query = ''): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`?debug=1&state=rich${query}`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  return errors
}

test('сцена рисует первый кадр и молчит в консоли', async ({ page }) => {
  const errors = await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  await expect(page.locator('canvas')).toBeVisible()
  expect(errors).toEqual([])
})

test('?helpers=1 добавляет оси и сетку, без него их нет', async ({ page }) => {
  // Считаем по отладочному оверлею: он показывает то же, что renderer.info,
  // и не требует лезть внутрь сцены из теста.
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  const plain = page.locator('text=/^geometries: /')
  await expect(plain).toHaveText('geometries: 3')

  await openGame(page, '&helpers=1')
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  await expect(page.locator('text=/^geometries: /')).toHaveText('geometries: 5')
})

test('в текстовом режиме сцены нет вовсе, а не «на паузе»', async ({ page }) => {
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })

  await page.locator('nav[aria-label="Разделы"] button').nth(4).click()
  await page.getByRole('button', { name: 'Всегда текст' }).click()
  // Не «остановленный рендерер», а отсутствие холста: контекст WebGL
  // отдан браузеру целиком.
  await expect(page.locator('canvas')).toHaveCount(0)

  await page.getByRole('button', { name: 'Всегда сцена' }).click()
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
})

test('в текстовом режиме цикл рендера действительно встал', async ({ page }) => {
  // Проверяем не «нет холста», а что requestAnimationFrame перестал
  // вызываться: остановка должна быть настоящей, иначе сцена продолжит
  // жечь батарею телефона из-под текстового режима. В режиме ?state=
  // игровой цикл не запускается, поэтому единственный, кто здесь просит
  // кадры, — сцена.
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number }
    w.__frames = 0
    const original = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb: FrameRequestCallback) =>
      original((t) => {
        w.__frames += 1
        cb(t)
      })
  })
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })

  const frames = () => page.evaluate(() => (window as unknown as { __frames: number }).__frames)
  const running = await frames()
  await page.waitForTimeout(400)
  expect(await frames(), 'сцена должна просить кадры, пока она на экране').toBeGreaterThan(
    running,
  )

  await page.locator('nav[aria-label="Разделы"] button').nth(4).click()
  await page.getByRole('button', { name: 'Всегда текст' }).click()
  await expect(page.locator('canvas')).toHaveCount(0)
  // Даём долететь уже назначенному кадру и замеряем.
  await page.waitForTimeout(200)
  const stopped = await frames()
  await page.waitForTimeout(600)
  expect(await frames(), 'после выключения сцены кадры не запрашиваются').toBe(stopped)
})

test('без WebGL игра идёт текстом, а не падает', async ({ page }) => {
  // Убираем WebGL целиком, ещё до загрузки приложения.
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    const original = proto.getContext as (...a: unknown[]) => unknown
    proto.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      if (String(id).includes('webgl')) return null
      return original.call(this, id, ...rest)
    }
  })
  const errors = await openGame(page)
  await expect(page.locator('canvas')).toHaveCount(0)
  // Игра осталась играбельной: боевая панель на месте сцены.
  await expect(page.locator('main')).toContainText('Урон в секунду')
  expect(errors).toEqual([])
})

test('если контекст не дали в последний момент — понятное сообщение', async ({ page }) => {
  // Проверка проходит (WebGL «есть»), а рендереру контекст уже не достаётся:
  // так ведёт себя браузер, у которого кончился лимит живых контекстов.
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    const original = proto.getContext as (...a: unknown[]) => unknown
    let webglRequests = 0
    proto.getContext = function (this: HTMLCanvasElement, id: string, ...rest: unknown[]) {
      if (String(id).includes('webgl')) {
        webglRequests += 1
        // Первый запрос — проверка доступности из stores/ui.ts, её пропускаем.
        if (webglRequests > 1) return null
      }
      return original.call(this, id, ...rest)
    }
  })
  await openGame(page)
  await expect(page.locator('main')).toContainText('Не удалось запустить 3D-сцену')
  // И играть по-прежнему можно.
  await expect(page.locator('main')).toContainText('Урон в секунду')
})
