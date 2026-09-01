import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openHeroDrawer, sectionTab } from './screen.js'

// Снимки трёх заранее заданных состояний игры в трёх ширинах плюс витрина.
// Состояние приходит из ?state=<пресет> — это обычный сейв из
// src/lib/game/__fixtures__/presets, прокрученный на фиксированное число
// тиков. Игровой цикл при этом не запускается, поэтому кадр не «уезжает».
//
// Режимов съёмки ДВА:
//
//   1. ИНТЕРФЕЙС (?scene=off) — весь экран из DOM, боевая сцена заменена
//      текстовой панелью. Снимки разделов не зависят от сцены.
//   2. СЦЕНА (без scene=off) — тот же экран с двумерной боевой сценой.
//      Она рисуется обычными элементами и векторными спрайтами, поэтому
//      воспроизводима до пикселя и СРАВНИВАЕТСЯ с эталоном так же, как
//      интерфейс. Растеризатор здесь тот же, что у остальной страницы,
//      и своих пикселей у сцены нет.
//
// Отдельно снимаются ПОЗЫ сцены (?pose=): застывший пик каждого эффекта —
// покой, замах, попадание, крит, лечение, привал. Это эталоны на сами
// эффекты, а не только на раскладку.
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

// Режим 2: со сценой. Ждём готовность сцены — атрибут ставит она сама,
// когда фон и герой загрузились, — иначе в снимок уехала бы пустая площадка.
for (const preset of PRESETS) {
  for (const width of SCENE_WIDTHS) {
    test(`сцена: ${preset} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await openPreset(page, preset, false)
      await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 30_000 })
      const name = `scene-${preset}-${width}`
      expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
    })
  }
}

// Позы сцены: по одному эталону на эффект. Снимаются на пресете rich —
// там герой в снаряжении и числа урона не однозначные. Это эталоны на сами
// эффекты: пока они зелёные, сцена цела.
const SCENE_POSES = ['idle', 'swing', 'hit', 'crit', 'heal', 'rest'] as const
for (const pose of SCENE_POSES) {
  test(`сцена-поза: ${pose}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`?debug=1&state=rich&pose=${pose}`)
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 30_000 })
    // Поза действительно применилась: сцена помечает себя ею.
    await expect(page.locator(`[data-pose="${pose}"]`)).toBeAttached()
    const name = `scene-pose-${pose}-1280`
    expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
  })
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
  // Крутим до САМОГО низа, а не на фиксированные четыре тысячи пикселей:
  // страница растёт вместе с игрой, и колесо на постоянное число once
  // уже переставало доезжать до конца — тест тогда мерил не полосу вкладок,
  // а то, сколько содержимого успело накопиться выше.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(200)
  const after = await nav.boundingBox()
  expect(Math.round(after!.y)).toBe(Math.round(before!.y))
  // И под полосой не прячется последняя панель раздела. Берём именно панели:
  // на десктопе они разложены по колонкам-обёрткам, а на мобильном обёртки
  // растворены в `display: contents` — своей рамки у такого элемента нет,
  // и замер по нему ничего бы не значил.
  const panels = page.locator('main .section > .col > *, main .section > *:not(.col)')
  const box = await panels.last().boundingBox()
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
  // Экипировка живёт в выдвижке «Герой», а не во вкладке: без неё слотов
  // на странице нет вовсе.
  await openHeroDrawer(page)
  const offhand = page.locator('.slot', { hasText: 'Левая рука' }).first()
  await expect(offhand).toContainText('Занята двуручным')
})

// ГЛАВНОЕ ТРЕБОВАНИЕ ПРАВКИ КАРТОЧКИ: при наведении она не меняет ни высоту,
// ни содержимое, и ни одна кнопка не сдвигается ни на пиксель. Раньше
// сравнение раскрывалось ВНУТРИ карточки, и «Продать» с «Распылить» уезжали
// из-под курсора ровно тогда, когда игрок к ним тянулся. Картинка такое не
// ловит — это измерение, а не вид.
test('карточка предмета при наведении не двигает свои кнопки', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPreset(page, 'rich', true)
  await sectionTab(page, 'Сумка').click()
  const card = page.locator('.slot').filter({ has: page.locator('button', { hasText: 'Продать' }) }).first()
  await expect(card).toBeVisible()
  // Карточку СНАЧАЛА докручиваем целиком в окно, а уже потом меряем. Иначе
  // hover() докрутит её сам — и «сдвиг кнопки» окажется прокруткой страницы
  // на те пиксели, на которые карточка не влезала. Координаты boundingBox
  // считаются от окна, а не от документа, и меряют не то, что заявлено.
  await card.scrollIntoViewIfNeeded()
  const sell = card.locator('button', { hasText: 'Продать' })
  const before = await sell.boundingBox()
  const cardBefore = await card.boundingBox()

  await card.hover()
  // Окно сравнения появилось — значит наведение сработало, и тест меряет
  // именно тот случай, ради которого написан.
  await expect(page.locator('[data-item-compare]')).toBeVisible()

  const after = await sell.boundingBox()
  const cardAfter = await card.boundingBox()
  expect(after?.y).toBeCloseTo(before?.y ?? -1, 0)
  expect(after?.x).toBeCloseTo(before?.x ?? -1, 0)
  expect(cardAfter?.height).toBeCloseTo(cardBefore?.height ?? -1, 0)

  // И окно НЕ ЛОВИТ МЫШЬ: кнопка под ним обязана нажиматься.
  const box = page.locator('[data-item-compare]')
  await expect(box).toHaveCSS('pointer-events', 'none')
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
  await openHeroDrawer(page)
  expect(await capture(page, 'drawer-hero-1280')).toMatchSnapshot('drawer-hero-1280.png')
})

test('витрина интерфейса', async ({ page }) => {
  await page.goto('ui?debug=1')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'ui')
  expect(await capture(page, 'showcase-1280')).toMatchSnapshot('showcase-1280.png')
})
