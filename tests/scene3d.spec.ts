import { expect, test, type Page } from '@playwright/test'
import { openSettings, sectionTab } from './screen.js'

// Поведение боевой сцены в живом браузере. Пиксели здесь не сравниваются
// (см. screenshots.spec.ts, почему их сравнивать нельзя) — проверяется то,
// что от сцены требуется по существу: она рисуется, она полностью
// останавливается в текстовом режиме, освобождает ресурсы
// и она не роняет игру, когда WebGL не дают.

const SCENE_READY = '[data-scene="ready"]'

/** Число из отладочного оверлея: он показывает то же, что renderer.info. */
async function probe(page: Page, label: string): Promise<number> {
  const text = await page.locator(`text=/^${label}: /`).innerText()
  return Number(text.split(': ')[1])
}

async function openGame(page: Page, query = ''): Promise<string[]> {
  // Трёхмерная сцена больше не рисует бой по умолчанию: она осталась в коде
  // до удаления и грузится только за ?scene=3d — весь этот файл про неё.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  await page.goto(`?debug=1&state=rich&scene=3d${query}`)
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
  // Сравниваем ОТНОСИТЕЛЬНО, а не с фиксированным числом: сколько геометрий
  // в сцене, зависит от обстановки зоны, от того, что попало в кадр, и от
  // того, доехали ли модели. Проверяемое утверждение — «с флагом их ровно
  // на две больше», поэтому обе замера делаются в одинаковом состоянии:
  // после загрузки обеих моделей.
  const settled = async () => {
    await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
    await expect(page.locator('text=/hero-knight: \\d+ клипов/')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('text=/monster-skeleton: \\d+ клипов/')).toBeVisible({
      timeout: 30_000,
    })
    await page.waitForTimeout(1500)
  }

  await openGame(page)
  await settled()
  const plain = await probe(page, 'geometries')

  await openGame(page, '&helpers=1')
  await settled()
  expect(await probe(page, 'geometries')).toBe(plain + 2)
})

test('в текстовом режиме сцены нет вовсе, а не «на паузе»', async ({ page }) => {
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })

  await openSettings(page)
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

  await openSettings(page)
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

test('двадцать смен зоны не растят память видеокарты', async ({ page }) => {
  // Двадцать пересборок обстановки под ПРОГРАММНЫМ растеризатором — работа
  // на полминуты: замер показал 24 с на этой машине и больше тридцати на
  // раннере. Стандартных тридцати секунд тесту не хватает по существу,
  // а не из-за подвисания, поэтому срок задан явно.
  test.setTimeout(120_000)
  // ГЛАВНАЯ проверка обстановки зон. Three.js не освобождает память GPU сам:
  // забытый dispose() при смене зоны — самая частая и коварная утечка,
  // на десктопе незаметная, на телефоне роняющая игру.
  //
  // Меряем ВОЗВРАТ В ТУ ЖЕ ЗОНУ: у зон разное число пропсов, и сравнивать
  // «был в лугу — стал в каменоломне» бессмысленно. Одна и та же обстановка
  // на экране обязана стоить той же памяти, сколько бы раз её ни пересобрали.
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  await sectionTab(page, 'Мир').click()

  // Зоны теперь КАРТА: узлы подряд, и переход идёт в два шага — выбрать узел,
  // потом «Отправиться» в карточке. Берём два ОТКРЫТЫХ узла (у закрытого
  // кнопки нет вовсе) и ходим между ними туда-обратно.
  const nodes = page.locator('.map .node:not(.locked)')
  const count = await nodes.count()
  expect(count, 'нужно хотя бы две доступные зоны').toBeGreaterThan(1)
  const names = await nodes.locator('.name').allInnerTexts()
  const [first, second] = names

  async function goTo(zone: string): Promise<void> {
    await nodes.filter({ hasText: zone }).first().click()
    const button = page.locator('.detail button:has-text("Отправиться")')
    if ((await button.count()) > 0) await button.first().click()
  }

  // Прогрев: побывать в обеих зонах, вернуться в первую и запомнить.
  await goTo(second)
  await page.waitForTimeout(200)
  await goTo(first)
  await page.waitForTimeout(1500)
  const before = await probe(page, 'geometries')

  for (let i = 0; i < 20; i += 1) {
    await goTo(i % 2 === 0 ? second : first)
    await page.waitForTimeout(90)
  }
  // Заканчиваем ровно там же, где начали.
  await goTo(first)
  await page.waitForTimeout(1500)
  const after = await probe(page, 'geometries')

  console.log(`geometries: было ${before}, стало ${after}`)
  expect(after, `было ${before}, стало ${after}`).toBeLessThanOrEqual(before + 1)
})

test('модели встают на место коробок и играют клип покоя', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  // Оверлей показывает, что реально лежит в файле, — по нему и проверяем.
  await expect(page.locator('text=/hero-knight: \\d+ клипов/')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('text=/monster-skeleton: \\d+ клипов/')).toBeVisible()
  // И что маппинг состояний ведёт на реальные клипы, а не на прочерки.
  const mapped = await page.locator('.map').first().innerText()
  expect(mapped).toContain('idle=Idle')
  expect(mapped).not.toContain('—')
  expect(errors).toEqual([])
})

test('модель не загрузилась — игра идёт на коробках, а не падает', async ({ page }) => {
  // Файл может не доехать: сеть, кеш, чужой прокси. Сцена обязана
  // остаться играбельной, а причина — попасть в оверлей.
  await page.route('**/models/*.glb', (route) => route.abort())
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  await expect(page.locator('.error').first()).toContainText('модель не загрузилась', {
    timeout: 30_000,
  })
  // Сцена продолжает рисоваться, страница жива.
  await expect(page.locator('canvas')).toBeVisible()
  expect(errors).toEqual([])
})

test('модель скачивается один раз, а не на каждый респаун моба', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/models/')) requests.push(r.url())
  })
  await openGame(page)
  await expect(page.locator(SCENE_READY)).toBeAttached({ timeout: 30_000 })
  await expect(page.locator('text=/monster-skeleton: \\d+ клипов/')).toBeVisible({
    timeout: 30_000,
  })
  await page.waitForTimeout(3000)
  // Ровно два файла: герой и моб. Ни одного повтора.
  expect(requests.filter((u) => u.endsWith('.glb')).length).toBe(2)
})
