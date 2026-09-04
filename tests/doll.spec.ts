import { expect, test, type Locator, type Page } from '@playwright/test'
import { openMenu } from './screen.js'

// КУКЛА И ТРИ ПУТИ НАДЕТЬ НАХОДКУ. Проверяется каждый путь по отдельности:
// они делают одно и то же, но ломаются порознь — перетаскивание живёт на
// dataTransfer, нажатие на состоянии несомого, долгое нажатие на таймере.
//
// Пресет rich: сумка полна находок, надето двуручное. Живой игры нет —
// состояние не меняется под ногами теста.

async function openDoll(page: Page, width = 1280): Promise<void> {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('?debug=1&state=rich&scene=off')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  // «Герой» открывает куклу И сумку рядом — иначе перетаскивать неоткуда.
  await openMenu(page, 'Герой')
}

const doll = (page: Page) => page.locator('section', { hasText: 'Экипировка' }).first()
const bag = (page: Page) => page.locator('section', { hasText: 'Инвентарь' }).first()
const bagCards = (page: Page) => bag(page).locator('.grid > .slot.filled')
const targets = (page: Page) => doll(page).locator('.slot[data-drop="target"]')

/**
 * Имена надетого. Кукла — тоже СЕТКА ЗНАЧКОВ: текста в ячейке больше нет,
 * и имя живёт в подписи, по которой ячейку находит и читалка с экрана.
 * Подпись вида «Правая рука: Клинок зари» — берём всё после двоеточия.
 */
async function wornNames(page: Page): Promise<string[]> {
  const labels = await doll(page)
    .locator('.slot')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? ''))
  return labels.map((label) => label.slice(label.indexOf(':') + 1).trim())
}

/**
 * Берёт в руку первую находку, которую МОЖНО надеть прямо сейчас, и
 * возвращает её карточку вместе с именем. Перебор нужен: в пресете надето
 * двуручное, и половина находок просится во вторую руку, где их не примут.
 *
 * Имя нужно потому, что СЧИТАТЬ КАРТОЧКИ БЕСПОЛЕЗНО: слоты пресета заняты,
 * и надевание меняет вещь местами со снятой — в сумке остаётся столько же.
 * Первый заход теста мерил именно это и был зелёным на неработающем коде.
 *
 * Берётся имя ИЗ ПОДПИСИ ЯЧЕЙКИ, а не из её текста: сумка — сетка значков, и
 * текста в ячейке больше нет вовсе. Подпись при этом не украшение — по ней
 * ячейку находит и читалка с экрана.
 */
async function carryFitting(page: Page): Promise<{ card: Locator; name: string }> {
  const cards = bagCards(page)
  const count = await cards.count()
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i)
    const name = ((await card.getAttribute('aria-label')) ?? '').split(':')[0].trim()
    await card.click()
    const target = targets(page)
    // Отказ живёт СТРОКОЙ ПОД КУКЛОЙ, а не в ячейке: в квадрат со значком
    // предложение не помещается. Значит и искать его надо по всей кукле.
    const fits = (await target.count()) === 1 && (await doll(page).locator('[data-deny]').count()) === 0
    // Тёзка среди надетого сделал бы проверку «имя переехало» бессмысленной.
    const worn = await wornNames(page)
    if (fits && !worn.includes(name)) return { card, name }
    // Не подошла — кладём обратно тем же нажатием и пробуем следующую.
    await card.click()
  }
  throw new Error('в сумке пресета нет ни одной вещи, которую можно надеть')
}

test('нажал вещь → подсветился слот → нажал слот: вещь надета', async ({ page }) => {
  await openDoll(page)
  const { name } = await carryFitting(page)

  // ПОДСВЕЧЕН РОВНО ОДИН слот, остальные притушены: у находки слот один —
  // тот, в который её бросил лут.
  await expect(targets(page)).toHaveCount(1)
  expect(await doll(page).locator('.slot[data-drop="dim"]').count()).toBeGreaterThan(0)
  // И видно, что вещь в руке.
  await expect(page.locator('[data-carrying]')).toBeVisible()

  await targets(page).click()

  // Вещь переехала в слот, и рука снова пуста.
  await expect(page.locator('[data-carrying]')).toHaveCount(0)
  await expect.poll(() => wornNames(page)).toContain(name)
})

test('наведение на подсвеченный слот показывает ОБЕ оси', async ({ page }) => {
  // Числа те же, что в окне сравнения: считает их одна `compareItem`, а
  // строки собирает общий `axisText.ts`. Проверяем, что показаны ОБЕ оси —
  // приоритет решает, что подсветить, а не что показать.
  await openDoll(page)
  await carryFitting(page)
  await targets(page).hover()
  const axes = page.locator('[data-axes]')
  await expect(axes).toBeVisible()
  await expect(axes).toContainText('Урон')
  await expect(axes).toContainText('Живучесть')
  await expect(axes).toContainText(/\d|с нуля|без изменений/)
})

test('перетаскивание из сумки на слот надевает вещь', async ({ page }) => {
  await openDoll(page)
  const { card, name } = await carryFitting(page)
  // Запоминаем НОМЕР слота, пока вещь в руке: отпустив её, подсветку мы
  // погасим, и локатор по [data-drop=target] искать станет нечего.
  const index = await doll(page)
    .locator('.slot')
    .evaluateAll((els) => els.findIndex((el) => (el as HTMLElement).dataset.drop === 'target'))
  expect(index).toBeGreaterThanOrEqual(0)
  // Кладём обратно: путь перетаскивания обязан работать сам по себе.
  await card.click()
  await expect(page.locator('[data-carrying]')).toHaveCount(0)

  await card.dragTo(doll(page).locator('.slot').nth(index))
  await expect.poll(() => wornNames(page)).toContain(name)
})

test('долгое нажатие на находке надевает её сразу', async ({ page }) => {
  await openDoll(page)
  const { card, name } = await carryFitting(page)
  await card.click()

  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 8)
  await page.mouse.down()
  // Держим дольше порога из данных (LONG_PRESS_MS = 500 мс).
  await page.waitForTimeout(900)
  await page.mouse.up()

  await expect.poll(() => wornNames(page)).toContain(name)
})

test('двойной щелчок по надетому снимает его', async ({ page }) => {
  await openDoll(page)
  const before = await bagCards(page).count()
  await doll(page).locator('.slot.filled').first().dblclick()
  await expect(bagCards(page)).toHaveCount(before + 1)
})

test('с клавиатуры: кольцо фокуса видно, Enter кладёт вещь в слот', async ({ page }) => {
  await openDoll(page)
  const { name } = await carryFitting(page)

  // Кольцо фокуса ВИДНО. Фокус доводим КЛАВИШЕЙ, а не вызовом focus():
  // :focus-visible от программного фокуса на невводимом элементе не
  // срабатывает, и проверка мерила бы не то.
  await doll(page).locator('.slot').first().focus()
  // Кнопок в ячейке больше нет, но Tab всё равно ведём до ближайшей
  // СЛЕДУЮЩЕЙ ячейки, а не «на один Tab и ладно»: порядок обхода — дело
  // раскладки, и завязываться на «ровно один шаг» тест не должен.
  let focused = { cls: '', shadow: 'none' }
  for (let i = 0; i < 20 && !focused.cls.includes('slot'); i += 1) {
    await page.keyboard.press('Tab')
    focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      return { cls: el.className, shadow: getComputedStyle(el).boxShadow }
    })
  }
  expect(focused.cls, 'Tab не довёл фокус ни до одной ячейки').toContain('slot')
  expect(focused.shadow, 'у ячейки в фокусе нет видимого кольца').not.toBe('none')

  await targets(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-carrying]')).toHaveCount(0)
  await expect.poll(() => wornNames(page)).toContain(name)
})

test('Esc роняет вещь из руки, а меню не закрывает', async ({ page }) => {
  // Порядок «сперва вещь, потом меню»: одно нажатие не должно и ронять
  // находку, и закрывать экран, на котором её выбирали.
  await openDoll(page)
  await carryFitting(page)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-carrying]')).toHaveCount(0)
  await expect(doll(page)).toBeVisible()
  // Второе нажатие закрывает меню — руки уже пусты.
  await page.keyboard.press('Escape')
  await expect(page.locator('.pane > *')).toHaveCount(0)
})

test('отказ виден СТРОКОЙ до попытки, а не после', async ({ page }) => {
  // В пресете rich надето двуручное, поэтому вещь во вторую руку получает
  // код occupied-by-two-handed. Слот при этом ПОДСВЕЧЕН: он подходит вещи,
  // просто занят, — и разницу игрок обязан прочитать словами.
  await openDoll(page)
  const cards = bagCards(page)
  const count = await cards.count()
  let text: string | null = null
  for (let i = 0; i < count && text === null; i += 1) {
    await cards.nth(i).click()
    const denies = doll(page).locator('[data-deny]')
    // Слот при этом ОСТАЁТСЯ ПОДСВЕЧЕННЫМ: он подходит вещи, просто занят.
    if ((await denies.count()) > 0 && (await targets(page).count()) === 1) {
      text = await denies.first().innerText()
    }
    else await cards.nth(i).click()
  }
  expect(text, 'ни одна вещь пресета не попросилась в занятый слот').not.toBeNull()
  expect(text).toContain('двуручным')
})

test('надетое, брошенное в сумку, снимается', async ({ page }) => {
  await openDoll(page)
  const before = await bagCards(page).count()
  await doll(page).locator('.slot.filled').first().dragTo(bag(page).locator('.grid').first())
  await expect(bagCards(page)).toHaveCount(before + 1)
})

test('сумка — сетка ЗНАЧКОВ: в ячейке нет ни имени, ни списка статов', async ({ page }) => {
  // Ради этого стадия и затевалась. Полтора десятка карточек со списком
  // модификаторов не помещались ни на телефон, ни в ширину меню, и находку
  // приходилось искать чтением. Теперь в ячейке значок, уровень и метка
  // апгрейда — всё остальное показывается ВЫБРАННОЙ вещью.
  await openDoll(page)
  const card = bagCards(page).first()
  await expect(card.locator('.name')).toHaveCount(0)
  // Значок один. Считаем ВНУТРИ содержимого ячейки: в углу с недавних пор
  // стоит кнопка продажи, и её монета — тоже svg, но она не про вещь.
  await expect(card.locator('.content > svg')).toHaveCount(1)
  // Ячейка квадратная: сетка значков обязана оставаться сеткой.
  const box = (await card.boundingBox())!
  expect(Math.abs(box.width - box.height)).toBeLessThan(2)
})

test('нажатие показывает карточку выбранного, нажатие мимо — убирает', async ({ page }) => {
  await openDoll(page)
  const { name } = await carryFitting(page)
  const chosen = page.locator('[data-chosen]')
  await expect(chosen).toBeVisible()
  await expect(chosen).toContainText(name)
  // Действия над находкой живут ЗДЕСЬ, а не в ячейке: на телефоне это
  // единственное место, куда можно попасть пальцем.
  await expect(chosen.getByRole('button', { name: /Продать/ })).toBeVisible()

  // Нажатие мимо сетки снимает выбор — и вместе с ним подсветку слотов.
  await page.locator('h2, h3').first().click({ force: true })
  await expect(chosen).toHaveCount(0)
  await expect(targets(page)).toHaveCount(0)
})

test('кнопок «Надеть» и «Снять» нет ни в сумке, ни на кукле', async ({ page }) => {
  // Каждая из них была ЧЕТВЁРТЫМ способом сделать то же самое: надеть можно
  // тремя жестами, снять — тремя, и все шесть проверены тестами выше.
  await openDoll(page)
  await carryFitting(page)
  await expect(page.getByRole('button', { name: 'Надеть' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Снять' })).toHaveCount(0)
})

// --- КУКЛА КАК ФИГУРА -----------------------------------------------------

/** Ячейка слота по подписи: «Голова: …», «Грудь: …». */
const cell = (page: Page, slot: string) =>
  doll(page).locator(`.slot[aria-label^="${slot}:"]`).first()

test('кукла — сетка ЗНАЧКОВ: в ячейке нет ни имени, ни списка статов', async ({ page }) => {
  // Ради этого правка и затевалась. Семь карточек с полным описанием вещи
  // занимали весь экран «Героя», и сумка уезжала под сгиб: игрок выбирал
  // находку, прокручивал вверх и целился в слот по памяти.
  await openDoll(page)
  const head = cell(page, 'Правая рука')
  await expect(head.locator('.name')).toHaveCount(0)
  await expect(head.locator('svg')).toHaveCount(1)
  // Ячейка квадратная: сетка значков обязана оставаться сеткой.
  const box = (await head.boundingBox())!
  expect(Math.abs(box.width - box.height)).toBeLessThan(2)
})

test('слоты стоят анатомически: голова сверху, руки в нижнем ряду рядом', async ({ page }) => {
  // Раскладка лежит ДАННЫМИ (`SLOT_CELL`), и проверяется она тем, что видно:
  // голова над грудью, грудь над ногами, талисман сбоку от головы, обе руки
  // в одном ряду. Сетка `auto-fill` раскладывала их в строку по порядку
  // объявления — фигурой это не было ни на одной ширине.
  await openDoll(page)
  const box = async (slot: string) => (await cell(page, slot).boundingBox())!
  const [head, chest, legs, trinket, right, left] = await Promise.all([
    box('Голова'),
    box('Грудь'),
    box('Ноги'),
    box('Талисман'),
    box('Правая рука'),
    box('Левая рука'),
  ])
  expect(head.y).toBeLessThan(chest.y)
  expect(chest.y).toBeLessThan(legs.y)
  expect(legs.y).toBeLessThan(right.y)
  // Талисман — сбоку от головы, в её ряду.
  expect(Math.round(trinket.y)).toBe(Math.round(head.y))
  expect(trinket.x).toBeGreaterThan(head.x)
  // Обе руки — в одном ряду и соседями.
  expect(Math.round(left.y)).toBe(Math.round(right.y))
  expect(left.x).toBeGreaterThan(right.x)
})

test('двуручное занимает ОБЕ руки: половинки сомкнуты и объяснены словами', async ({ page }) => {
  // Пустой слот и ЗАНЯТЫЙ слот — разные вещи. В пресете rich надето
  // двуручное, поэтому левая рука не пуста, а занята: она берёт цвет того
  // самого оружия и смыкается с его половиной в один широкий блок.
  await openDoll(page)
  const left = cell(page, 'Левая рука')
  await expect(left).toHaveAttribute('aria-label', /занята двуручным/)
  // Половинки стоят ВПЛОТНУЮ — между ними нет зазора сетки.
  const right = (await cell(page, 'Правая рука').boundingBox())!
  const gap = (await left.boundingBox())!.x - (right.x + right.width)
  expect(Math.abs(gap)).toBeLessThan(2)
  // И это сказано словами: цвет ничего не называет, а пальцем окно
  // описания не открыть.
  await expect(doll(page).locator('[data-two-handed]')).toContainText('обе руки')
})

test('наведение на надетое показывает описание — и называет ХВАТ', async ({ page }) => {
  // Описание ушло из ячейки, но не из игры: оно приходит окном у курсора,
  // как в сумке приходит сравнение. Хват там обязателен — разница между
  // одноручным и двуручным это вся сборка целиком.
  await openDoll(page)
  await cell(page, 'Правая рука').hover()
  const tip = page.locator('[data-item-tip]')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('двуручное')
  // Окно НЕ ЛОВИТ МЫШЬ: под ним сама ячейка, и с неё обязано сниматься.
  await expect(tip).toHaveCSS('pointer-events', 'none')
})

test('окно сравнения находки называет хват оружия', async ({ page }) => {
  // Маусовер на оружие в сумке говорил редкость, уровень и все статы — и
  // молчал о главном: одноручное оно или двуручное.
  await openDoll(page)
  const cards = bagCards(page)
  const count = await cards.count()
  let word: string | null = null
  for (let i = 0; i < count && word === null; i += 1) {
    const label = (await cards.nth(i).getAttribute('aria-label')) ?? ''
    const match = label.match(/(Одноручное|Двуручное)/)
    if (!match) continue
    word = match[1]
    await cards.nth(i).hover()
  }
  expect(word, 'в сумке пресета нет ни одного оружия').not.toBeNull()
  await expect(page.locator('[data-item-compare]')).toContainText(word!)
})

test('продать находку можно прямо со значка — кнопкой в его углу', async ({ page }) => {
  // Разобрать полную сумку через карточку выбранного — это выбрать вещь,
  // отвести взгляд вниз, прицелиться в кнопку и вернуться к сетке, и так
  // полтора десятка раз. Кнопка стоит на самом значке, справа снизу.
  await openDoll(page)
  const card = bagCards(page).first()
  const sell = card.getByRole('button', { name: /^Продать/ })
  await expect(sell).toBeVisible()

  // СПРАВА СНИЗУ, а не где придётся: угол значка — единственное место, где
  // кнопка не спорит ни с уровнем вещи, ни с меткой апгрейда.
  const cardBox = (await card.boundingBox())!
  const sellBox = (await sell.boundingBox())!
  expect(sellBox.x + sellBox.width / 2).toBeGreaterThan(cardBox.x + cardBox.width / 2)
  expect(sellBox.y + sellBox.height / 2).toBeGreaterThan(cardBox.y + cardBox.height / 2)

  const before = await bagCards(page).count()
  await sell.click()
  await expect(bagCards(page)).toHaveCount(before - 1)
})
