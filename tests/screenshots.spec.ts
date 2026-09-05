import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { openMenu } from './screen.js'
import { NUMERIC_ELEMENTS, NUMERIC_MATCH } from './numeric-elements.js'
import { SCENE_POSES } from '../src/lib/ui/route.js'

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
// покой, замах, попадание, крит, лечение, привал, новый уровень. Это эталоны
// на сами эффекты, а не только на раскладку.
//
// Отдельно и БЕЗ ДОПУСКА снимаются элементы с числами состояния: порог
// полной страницы пропускает смену цифры в полоске, а отдельный кадр
// элемента — нет (список — tests/numeric-elements.ts).
//
// Все комплекты попадают в test-results/current и, значит, в артефакт.

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

/**
 * Снимок ОДНОГО элемента, а не страницы. Тот же уход курсора и та же папка
 * артефакта, но без растягивания окна: элемент и так в кадре целиком.
 */
async function captureElement(page: Page, selector: string, name: string): Promise<Buffer> {
  await page.evaluate(() => document.fonts.ready)
  await page.mouse.move(0, 0)
  const target = page.locator(selector).first()
  await expect(target).toBeVisible()
  const shot = await target.screenshot({ animations: 'disabled', caret: 'hide' })
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

// ВСЕ ВОСЕМЬ МЕНЮ. Раньше здесь было четыре раздела по индексу вкладки;
// теперь меню открываются по названию кнопки — оно и есть их имя. Семь
// стоят в столбцах, восьмое — «Умения» — в ряду действий, который оно
// настраивает; снимается оно так же, как остальные.
const SECTIONS = [
  { menu: 'Герой', name: 'hero' },
  { menu: 'Сумка', name: 'bag' },
  { menu: 'Мир', name: 'world' },
  { menu: 'Таланты', name: 'talents' },
  { menu: 'Крафт', name: 'craft' },
  { menu: 'Журнал', name: 'log' },
  { menu: 'Настройки', name: 'settings' },
  { menu: 'Умения', name: 'autocast' },
] as const
// Узкий и широкий: между ними лежит единственный брейкпоинт игры.
const SECTION_WIDTHS = [390, 1280] as const

for (const section of SECTIONS) {
  for (const width of SECTION_WIDTHS) {
    const name = `menu-${section.name}-${width}`
    test(`меню: ${section.name} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      // rich — самый насыщенный пресет: в нём есть и лут, и открытые зоны,
      // и вложенные таланты, поэтому разделы не выглядят пустыми.
      await openPreset(page, 'rich', true)
      await openMenu(page, section.menu)
      expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
    })
  }
}

// СЖАТАЯ СЦЕНА, СТРОКА-СВОДКА И КУКЛА ПОД РУКОЙ. Три снимка на то, чего
// раньше не было вовсе: открытое меню сжимает сцену между столбцами кнопок,
// на телефоне вместо неё встаёт одна строка, а кукла при выборе находки
// подсвечивает подходящий слот и тушит остальные. Всё это — состояния, в
// которых игра проводит бо́льшую часть времени разбора добычи, и без своих
// эталонов они ломались бы молча.
test('сцена сжата при открытом меню', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPreset(page, 'rich', false)
  await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 30_000 })
  await openMenu(page, 'Мир')
  const name = 'scene-small-1280'
  expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
})

test('строка-сводка вместо сцены на 390', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 })
  await openPreset(page, 'rich', false)
  await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 30_000 })
  await openMenu(page, 'Мир')
  // Сводка на месте: без неё снимок был бы про что-то другое.
  await expect(page.locator('[data-compact="1"]')).toHaveCount(1)
  const name = 'scene-summary-390'
  expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
})

// ДЕРЕВО С СДЕЛАННЫМ ВЫБОРОМ. Снимок меню на «позднем» пресете показывает
// сетку, но не показывает главного: взятый ключевой узел, запертого выбором
// соседа и набранную стрелку рядом с ненабранной. Для этого свой пресет и
// два снимка — на обеих ширинах, у сетки они разные.
for (const width of SECTION_WIDTHS) {
  test(`дерево талантов с выбранным ключевым @ ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await openPreset(page, 'tree', true)
    await openMenu(page, 'Таланты')
    // Запертый выбором узел на месте: без него снимок был бы про другое.
    await expect(page.locator('[data-talent][data-group-locked]')).toHaveCount(1)
    const name = `talents-tree-${width}`
    expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
  })
}

test('кукла с подсвеченным слотом во время выбора', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPreset(page, 'rich', true)
  await openMenu(page, 'Герой')
  // Берём первую находку, у которой на кукле загорается слот. Перебор
  // детерминирован: пресет фиксирован, порядок карточек тоже.
  //
  // Берём КЛАВИАТУРОЙ, а не нажатием: нажатие по карточке заодно
  // прикрепляет окно сравнения у курсора, и оно легло бы поперёк снимка,
  // закрывая ровно то, ради чего снимок и делается. Клавиатурный путь берёт
  // вещь в руку и ничего не открывает.
  const cards = page
    .locator('section', { hasText: 'Инвентарь' })
    .first()
    .locator('.grid > .slot.filled')
  const doll = page.locator('section', { hasText: 'Экипировка' }).first()
  const count = await cards.count()
  let carried = false
  for (let i = 0; i < count && !carried; i += 1) {
    await cards.nth(i).focus()
    await page.keyboard.press('Enter')
    if ((await doll.locator('.slot[data-drop="target"]').count()) > 0) carried = true
    else await page.keyboard.press('Enter')
  }
  expect(carried, 'ни одна находка пресета не подсветила слот').toBe(true)
  const name = 'doll-carry-1280'
  expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
})

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
// эффекты: пока они зелёные, сцена цела. Список поз — тот же SCENE_POSES,
// который читает `?pose=`: новая поза попадает в эталоны сама, а своей
// копии списка у спеки нет — она уже однажды могла разъехаться с игрой.
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

// ЧИСЛА СОСТОЯНИЯ — ОТДЕЛЬНЫМИ СНИМКАМИ И БЕЗ ДОПУСКА. Порог полной страницы
// (0.001 доли пикселей) пропускает смену цифры в полоске здоровья: цифры —
// сотые доли процента пикселей, и два PR подряд эталоны молча врали.
// Поэтому каждый элемент с числами снимается сам по себе, и там любой
// отличный пиксель — падение. Режим — интерфейс без сцены, как у разделов.
const NUMERIC_PRESETS = ['fresh', 'rich'] as const
for (const element of NUMERIC_ELEMENTS) {
  for (const preset of NUMERIC_PRESETS) {
    const name = `numeric-${element.name}-${preset}-1280`
    test(`числа: ${element.name} @ ${preset}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await openPreset(page, preset, true)
      if (element.menu) await openMenu(page, element.menu)
      expect(await captureElement(page, element.selector, name)).toMatchSnapshot(
        `${name}.png`,
        NUMERIC_MATCH,
      )
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

// Нижняя панель — способ открывать меню на телефоне: если полоса уезжает
// вместе с содержимым, до неё придётся долистывать.
test('на мобильном кнопки меню прибиты к низу экрана', async ({ page }) => {
  const height = 700
  await page.setViewportSize({ width: 390, height })
  await openPreset(page, 'rich', true)
  const nav = page.locator('nav[aria-label="Меню: где меняешь"]')
  const before = await nav.boundingBox()
  expect(Math.round(before!.y + before!.height)).toBe(height)
  // Открываем меню: полосу проверяем на самом длинном содержимом, какое
  // бывает, — с закрытым меню страница коротка, и «не перекрывает» вышло бы
  // правдой само собой.
  await page.locator('nav[aria-label^="Меню"] button', { hasText: 'Мир' }).first().click()
  // Крутим до САМОГО низа, а не на фиксированные четыре тысячи пикселей:
  // страница растёт вместе с игрой, и колесо на постоянное число once
  // уже переставало доезжать до конца — тест тогда мерил не полосу вкладок,
  // а то, сколько содержимого успело накопиться выше.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForTimeout(200)
  const after = await nav.boundingBox()
  expect(Math.round(after!.y)).toBe(Math.round(before!.y))
  // И под полосой не прячется последняя панель открытого меню. Берём именно
  // панели: у самой `.pane` рамка тянется на всю высоту содержимого, и её
  // нижний край ничего не сказал бы про то, видно ли последнюю панель.
  const panels = page.locator('main .pane > *')
  expect(await panels.count()).toBeGreaterThan(0)
  const box = await panels.last().boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(before!.y + 1)
})

// Пустая ячейка и ЗАНЯТАЯ ячейка — разные вещи, и разницу видно только на
// живой странице. Кукла стала сеткой значков, и слова из ячейки ушли: занятую
// руку теперь называет подпись ячейки и строка под куклой, а показывает —
// сцепка половинок. Картинка ни того, ни другого не ловит: разница в
// нескольких словах мелкого текста и в паре пикселей зазора.
test('левая рука под двуручным объясняет, почему она пуста', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  // В пресете rich надето двуручное: пресет лежит в репозитории и не меняется
  // сам по себе, поэтому проверять можно прямо по нему.
  await openPreset(page, 'rich', true)
  // Экипировка живёт в меню «Герой»: без него слотов на странице нет вовсе.
  await openMenu(page, 'Герой')
  const doll = page.locator('section', { hasText: 'Экипировка' }).first()
  await expect(doll.locator('.slot[aria-label^="Левая рука:"]')).toHaveAttribute(
    'aria-label',
    /занята двуручным/,
  )
  await expect(doll.locator('[data-two-handed]')).toContainText('обе руки')
})

// ГЛАВНОЕ ТРЕБОВАНИЕ ПРАВКИ КАРТОЧКИ: при наведении она не меняет ни высоту,
// ни содержимое, и ни одна кнопка не сдвигается ни на пиксель. Раньше
// сравнение раскрывалось ВНУТРИ карточки, и «Продать» с «Распылить» уезжали
// из-под курсора ровно тогда, когда игрок к ним тянулся. Картинка такое не
// ловит — это измерение, а не вид.
test('ячейка сумки при наведении не меняет ни размер, ни место', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await openPreset(page, 'rich', true)
  await openMenu(page, 'Сумка')
  const card = page.locator('.grid > .slot.filled').first()
  await expect(card).toBeVisible()
  // Ячейку СНАЧАЛА докручиваем целиком в окно, а уже потом меряем. Иначе
  // hover() докрутит её сам — и «сдвиг» окажется прокруткой страницы на те
  // пиксели, на которые ячейка не влезала. Координаты boundingBox считаются
  // от окна, а не от документа, и меряют не то, что заявлено.
  await card.scrollIntoViewIfNeeded()
  const before = await card.boundingBox()

  await card.hover()
  // Окно сравнения появилось — значит наведение сработало, и тест меряет
  // именно тот случай, ради которого написан.
  await expect(page.locator('[data-item-compare]')).toBeVisible()

  const after = await card.boundingBox()
  expect(after?.y).toBeCloseTo(before?.y ?? -1, 0)
  expect(after?.x).toBeCloseTo(before?.x ?? -1, 0)
  expect(after?.height).toBeCloseTo(before?.height ?? -1, 0)

  // И окно НЕ ЛОВИТ МЫШЬ: то, что под ним, обязано нажиматься.
  const box = page.locator('[data-item-compare]')
  await expect(box).toHaveCSS('pointer-events', 'none')
})

test('кнопки меню держат 44px на нажатие', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 })
  await openPreset(page, 'rich', true)
  // Пресет rich — 32 уровень: открыты все семь кнопок столбцов. На первом
  // уровне их пять, и это не поломка, а лестница открытий.
  const tabs = page.locator('nav[aria-label^="Меню"] button')
  const count = await tabs.count()
  expect(count).toBe(7)
  for (let i = 0; i < count; i += 1) {
    const box = await tabs.nth(i).boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  }
  // Восьмая кнопка — «Умения» в ряду действий — та же область нажатия.
  const auto = page.locator('[data-permanent] button', { hasText: 'Умения' }).first()
  expect((await auto.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
})

test('витрина интерфейса', async ({ page }) => {
  await page.goto('ui?debug=1')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'ui')
  expect(await capture(page, 'showcase-1280')).toMatchSnapshot('showcase-1280.png')
})
