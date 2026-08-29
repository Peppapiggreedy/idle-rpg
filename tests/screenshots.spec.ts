import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Снимки трёх заранее заданных состояний игры в трёх ширинах плюс витрина.
// Состояние приходит из ?state=<пресет> — это обычный сейв из
// src/lib/game/__fixtures__/presets, прокрученный на фиксированное число
// тиков. Игровой цикл при этом не запускается, поэтому кадр не «уезжает».
//
// Режимов съёмки ДВА, и разница между ними принципиальная:
//
//   1. ИНТЕРФЕЙС (?scene=off) — весь экран из DOM, боевая сцена заменена
//      текстовой панелью. Он воспроизводим до пикселя, поэтому сравнивается
//      с эталонами из tests/screenshots и падает при расхождении.
//   2. СЦЕНА (без scene=off) — тот же экран, но с боевой сценой на three.
//      Сцену рисует WebGL, а в headless-браузере он идёт через программный
//      растеризатор: та же сборка на другой машине даёт другие пиксели.
//      Сравнивать такое с эталоном — значит держать вечно красный тест,
//      поэтому эти снимки только сохраняются и уезжают артефактом в PR.
//
// Оба комплекта попадают в test-results/current и, значит, в артефакт.

const PRESETS = ['fresh', 'mid', 'rich'] as const
// Телефон, планшет, десктоп. 720px — единственный брейкпоинт игры, поэтому
// 390 и 768 стоят по разные его стороны, а 1280 показывает две колонки шире.
const WIDTHS = [390, 768, 1280] as const
// Сцене хватает двух ширин: у неё ровно две пропорции — 4:3 на мобильном
// и 16:9 на десктопе, и 768 показал бы ту же 16:9, что и 1280.
const SCENE_WIDTHS = [390, 1280] as const

// Свежий комплект снимков кладём рядом с отчётом — его забирает CI как
// артефакт. Он появляется независимо от того, сошлись эталоны или нет:
// «посмотреть игру до merge» не должно зависеть от результата сравнения.
const CURRENT_DIR = join('test-results', 'current')

async function capture(page: Page, name: string): Promise<Buffer> {
  // Свой шрифт лежит рядом с игрой, но дождаться его всё равно надо: иначе
  // первый кадр нарисуется запасным начертанием и эталон не сойдётся.
  await page.evaluate(() => document.fonts.ready)
  // Уводим курсор в угол. Клик по вкладке оставляет его там, где была
  // вкладка, а на мобильном она прибита к низу окна: стоит растянуть окно —
  // и курсор оказывается посреди сумки, над ячейкой предмета. Ячейка
  // раскрывает сравнение с надетым, страница вырастает на сотню пикселей,
  // и снимок расходится с эталоном через раз. Снимок должен показывать
  // экран в покое, а не под курсором.
  await page.mouse.move(0, 0)
  // Растягиваем окно под всю страницу ПЕРЕД съёмкой. Без этого нижняя панель
  // вкладок (на мобильном она position: fixed) рисуется там, где была в первом
  // экране, — то есть поперёк содержимого в середине снимка. Снимок остаётся
  // воспроизводимым, но выглядит как сломанная вёрстка, а смотрят на него
  // именно затем, чтобы поймать сломанную вёрстку.
  //
  // Подгоняем в цикле, а не одним замером: растягивание окна само способно
  // изменить высоту страницы, и один замер оставил бы снимок зависящим от
  // того, что попало под первый обмер.
  const size = page.viewportSize()
  if (size) {
    for (let i = 0; i < 4; i += 1) {
      const full = await page.evaluate(() => document.documentElement.scrollHeight)
      const current = page.viewportSize()
      if (!current || full === current.height) break
      await page.setViewportSize({ width: size.width, height: full })
    }
  }
  const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' })
  if (size) await page.setViewportSize(size)
  const file = join(CURRENT_DIR, `${name}.png`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, shot)
  return shot
}

/** Приложение само помечает готовность, когда состояние применено
 * и смонтировано, — ждём факт, а не таймаут. */
async function openPreset(page: Page, preset: string, sceneOff: boolean): Promise<void> {
  await page.goto(`?debug=1&state=${preset}${sceneOff ? '&scene=off' : ''}`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
}

// Режим 1: интерфейс без сцены — эталонный.
for (const preset of PRESETS) {
  for (const width of WIDTHS) {
    const name = `${preset}-${width}`
    test(`интерфейс: ${preset} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openPreset(page, preset, true)
      expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
    })
  }
}

// Все четыре раздела. Индекс — позиция вкладки в SECTION_IDS; берём именно
// индекс, потому что подпись «Сумки» несёт счётчик и меняется с пресетом.
const SECTIONS = [
  { index: 0, name: 'progress' },
  { index: 1, name: 'bag' },
  { index: 2, name: 'world' },
  { index: 3, name: 'settings' },
] as const
// Узкий и широкий: между ними лежит единственный брейкпоинт игры.
const SECTION_WIDTHS = [390, 1280] as const

for (const section of SECTIONS) {
  for (const width of SECTION_WIDTHS) {
    const name = `section-${section.name}-${width}`
    test(`раздел: ${section.name} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      // rich — самый насыщенный пресет: в нём есть и лут, и открытые зоны,
      // и вложенные таланты, поэтому разделы не выглядят пустыми.
      await openPreset(page, 'rich', true)
      await page.locator('nav[aria-label="Разделы"] button').nth(section.index).click()
      expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
    })
  }
}

// Режим 2: со сценой — без сравнения, только на посмотреть.
for (const preset of PRESETS) {
  for (const width of SCENE_WIDTHS) {
    test(`сцена: ${preset} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openPreset(page, preset, false)
      // Ждём ПЕРВЫЙ нарисованный кадр: three приезжает отдельным чанком,
      // и без этого в артефакт уехал бы пустой холст. Атрибут ставит сама
      // сцена, поэтому ждём факт, а не таймаут.
      await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 30_000 })
      // Никакого toMatchSnapshot: снимок только сохраняется в артефакт.
      // Проверяем ровно одно — что экран со сценой вообще собрался.
      const shot = await capture(page, `scene-${preset}-${width}`)
      expect(shot.byteLength).toBeGreaterThan(0)
    })
  }
}

// Требование к мобильному экрану проверяем измерением, а не глазами: на
// снимке страницы во всю высоту горизонтальное переполнение не видно вовсе.
test('на узком экране ничего не вылезает по горизонтали', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  for (const preset of PRESETS) {
    await openPreset(page, preset, true)
    // clientWidth уже без полосы прокрутки — сравнивать надо именно с ним.
    const overflow = await page.evaluate(() => {
      const el = document.documentElement
      return el.scrollWidth - el.clientWidth
    })
    expect(overflow, `пресет ${preset}`).toBeLessThanOrEqual(0)
  }
})

// Нижние вкладки — способ переключать разделы на телефоне: если полоса
// уезжает вместе с содержимым, до неё придётся долистывать.
test('на мобильном вкладки прибиты к низу экрана', async ({ page }) => {
  const height = 700
  await page.setViewportSize({ width: 390, height })
  await openPreset(page, 'rich', true)
  const nav = page.locator('nav[aria-label="Разделы"]')
  const before = await nav.boundingBox()
  expect(Math.round(before!.y + before!.height)).toBe(height)
  await page.mouse.wheel(0, 4000)
  await page.waitForTimeout(200)
  const after = await nav.boundingBox()
  expect(Math.round(after!.y)).toBe(Math.round(before!.y))
  // И под полосой не прячется низ раздела. Меряем сам раздел, а не его
  // последнего ребёнка: на десктопе панели разложены по колонкам-обёрткам,
  // а на мобильном обёртки растворены в `display: contents` — у такого
  // элемента своей рамки нет, и замер по нему ничего бы не значил.
  const box = await page.locator('main .section').boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(before!.y + 1)
})

// Пустая ячейка и ЗАНЯТАЯ ячейка — разные вещи, и разницу видно только на
// живой странице: «пусто» рисует примитив, а текст про двуручное приходит
// пропом. Однажды он приходил детьми — и не рисовался вовсе, потому что
// пустая ячейка детей не показывает. Картинка такое не ловит: разница в
// нескольких словах мелкого текста.
test('левая рука под двуручным объясняет, почему она пуста', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  // В пресете rich надето двуручное: пресет лежит в репозитории и не меняется
  // сам по себе, поэтому проверять можно прямо по нему.
  await openPreset(page, 'rich', true)
  const offhand = page.locator('.slot', { hasText: 'Левая рука' }).first()
  await expect(offhand).toContainText('Занята двуручным')
})

test('вкладки разделов держат 44px на нажатие', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openPreset(page, 'rich', true)
  const tabs = page.locator('nav[aria-label="Разделы"] button')
  const count = await tabs.count()
  expect(count).toBe(4)
  for (let i = 0; i < count; i += 1) {
    const box = await tabs.nth(i).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
})

// Характеристики и экипировка уехали из вкладок в выдвижку «Герой», и без
// отдельного снимка они выпали бы из визуальной проверки целиком.
test('выдвижка героя', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPreset(page, 'rich', true)
  await page.getByRole('button', { name: 'Герой', exact: true }).click()
  expect(await capture(page, 'drawer-hero-1280')).toMatchSnapshot('drawer-hero-1280.png')
})

test('витрина интерфейса', async ({ page }) => {
  await page.goto('ui?debug=1')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'ui')
  expect(await capture(page, 'showcase-1280')).toMatchSnapshot('showcase-1280.png')
})
