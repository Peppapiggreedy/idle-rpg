import { expect, test, type Page } from '@playwright/test'
import { openMenu } from './screen.js'

// ЭКРАН ТАЛАНТОВ: ДЕРЕВО, А НЕ СПИСОК.
//
// Ветка — сетка в четыре столбца: узел размером в палец со значком и рангом,
// порог этажа один раз слева, стрелка прямой линией от опоры к зависимому,
// описание — только в подсказке у узла. Проверяется не вид (вид держат
// эталоны снимков), а СВОЙСТВА — каждое ломается порознь, поэтому и тесты
// порознь.

async function openTree(page: Page, state = 'rich'): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`?debug=1&state=${state}&scene=off`)
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
  await openMenu(page, 'Таланты')
}

const floors = (page: Page) => page.locator('[data-floor]')
const talents = (page: Page) => page.locator('[data-talent]')
const tip = (page: Page) => page.locator('[data-talent-tip]')
/** Цена сброса — по ней и видно, тронут ли счётчик платных сбросов. */
const resetButton = (page: Page) => page.locator('button', { hasText: 'Сбросить таланты' })

/**
 * ФОРМА ВЕТКИ — ДАННЫЕ, И ЧИСЛАМ ЕЙ В ТЕСТЕ НЕ МЕСТО. Здесь стояло «13
 * этажей», «6 ключевых узлов» и ранг «0/6» — и все три были верны ровно до
 * первой ветки другой формы. Гнев переехал на семь этажей по десять очков,
 * остальные восемь остались тринадцатью по пять, и СМЕШАННОЕ СОСТОЯНИЕ
 * ЗАКОННО: тест обязан проверять СВОЙСТВА раскладки, а не сегодняшнюю форму
 * первой ветки.
 *
 * Ожидания читаются С САМОЙ СТРАНИЦЫ, а не импортом из `src/lib/data`:
 * проект тестов собирается с `moduleResolution: nodenext`, и импорт данных
 * потянул бы за собой требование расширений во всём их графе. Потолок ранга
 * берётся из узла, шаг этажей — из подписей порогов.
 */
async function maxRankOf(node: ReturnType<typeof talents>): Promise<string> {
  const text = (await node.locator('[data-rank]').innerText()).trim()
  const max = text.split('/')[1]
  expect(max, `ранг узла читается как «есть/потолок», а пришло «${text}»`).toMatch(/^\d+$/)
  return max
}

test('ветка разложена по этажам, и порог подписан ОДИН РАЗ НА РЯД', async ({ page }) => {
  await openTree(page)
  const rows = await floors(page).count()
  // Этажей у ветки может быть семь, может тринадцать — но их всегда больше
  // одного, иначе «лестница» не лестница.
  expect(rows).toBeGreaterThan(1)

  const gates: number[] = []
  for (let i = 0; i < rows; i += 1) {
    const floor = floors(page).nth(i)
    // Ровно один порог на этаж: два значило бы, что этаж не этаж.
    await expect(floor.locator('.gate')).toHaveCount(1)
    // ПУСТЫХ МЕСТ В РЯДУ НЕТ: этаж без таланта — дырка в дереве.
    expect(await floor.locator('[data-talent]').count()).toBeGreaterThanOrEqual(1)
    // ЧИТАЕТСЯ `.gate-points`, А НЕ `.gate`: в подписи порога ДВА числа —
    // очки и уровень героя, — и `innerText` всего блока даёт «0\nс ур. 10».
    // Прежняя строка сравнивала весь блок с голым числом и не падала только
    // потому, что до неё не доходило: тест обрывался на счёте этажей выше.
    gates.push(Number((await floor.locator('.gate-points').innerText()).trim()))
  }

  // ПОРОГИ — РОВНАЯ ЛЕСТНИЦА ОТ НУЛЯ ОДНИМ ШАГОМ. Это и есть свойство: первый
  // этаж бесплатен, шаг постоянный и положительный, а его величину задаёт
  // ветка. Число «5» тут стояло в тексте и врало про Гнев, у которого шаг 10.
  expect(gates[0]).toBe(0)
  const step = gates[1]
  expect(step).toBeGreaterThan(0)
  for (let i = 0; i < rows; i += 1) expect(gates[i], `этаж ${i + 1}`).toBe(i * step)
})

test('узел — квадрат в палец: ранг на нём, описания нет', async ({ page }) => {
  await openTree(page)
  const ranks = await talents(page).locator('[data-rank]').allInnerTexts()
  expect(ranks.length).toBe(await talents(page).count())
  for (const rank of ranks) expect(rank.trim()).toMatch(/^\d+\/\d+$/)
  // На богатом пресете очки вложены, и хотя бы один талант стоит полным.
  expect(
    ranks.some((r) => {
      const [have, max] = r.trim().split('/')
      return have === max && have !== '0'
    }),
  ).toBe(true)
  // ОБЛАСТЬ НАЖАТИЯ НЕ МЕНЬШЕ 44 ПИКСЕЛЕЙ, и в узле нет текста, кроме ранга:
  // всё остальное — в подсказке.
  const first = talents(page).first()
  const box = await first.boundingBox()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect((await first.innerText()).trim()).toMatch(/^\d+\/\d+$/)
})

test('ключевые узлы крупнее обычных', async ({ page }) => {
  await openTree(page)
  const key = await page.locator('[data-talent][data-key]').first().boundingBox()
  const plain = await page.locator('[data-talent]:not([data-key])').first().boundingBox()
  expect(key!.width).toBeGreaterThan(plain!.width)

  // КЛЮЧЕВОЙ УЗЕЛ НИКОГДА НЕ ОДИН НА ЭТАЖЕ — иначе это не выбор, а ступенька,
  // и крупный значок обещает решение, которого нет. Считать их общее число
  // нельзя: оно зависит от формы ветки (у Гнева три ключевых этажа и восемь
  // узлов, у лестницы — три и шесть).
  const rows = await floors(page).count()
  let keyRows = 0
  for (let i = 0; i < rows; i += 1) {
    const onFloor = await floors(page).nth(i).locator('[data-talent][data-key]').count()
    if (onFloor === 0) continue
    keyRows += 1
    expect(onFloor, `этаж ${i + 1}: ключевой узел один`).toBeGreaterThanOrEqual(2)
  }
  expect(keyRows, 'ни одного ключевого этажа').toBeGreaterThan(0)
})

test('подсказка открывается наведением и НАЗЫВАЕТ причину отказа', async ({ page }) => {
  await openTree(page)
  await expect(tip(page)).toHaveCount(0)
  // Запертый узел: его причина — предложение для человека, а не код.
  const locked = page.locator('[data-talent][data-state="locked"]').first()
  await locked.hover()
  await expect(tip(page)).toHaveCount(1)
  const reason = await tip(page).locator('[data-reason]').innerText()
  expect(reason.trim().length).toBeGreaterThan(8)
  expect(reason).not.toMatch(/branch-locked|no-points|max-rank|needs-talent|group-taken/)
  // Уход курсора закрывает: подсказка не прилипает.
  await page.mouse.move(5, 5)
  await expect(tip(page)).toHaveCount(0)
})

test('Esc закрывает подсказку, а не меню; второе Esc — меню', async ({ page }) => {
  await openTree(page)
  await talents(page).first().hover()
  await expect(tip(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(tip(page)).toHaveCount(0)
  await expect(page.locator('[data-branch]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-branch]')).toHaveCount(0)
})

test('стрелки нарисованы линиями и тусклы, пока опора не набрана', async ({ page }) => {
  await openTree(page)
  const arrows = page.locator('[data-arrow]')
  expect(await arrows.count()).toBeGreaterThan(0)
  // Хотя бы одна стрелка не набрана (тускла) — иначе тест не отличил бы
  // «тускла» от «всегда яркая».
  expect(await page.locator('[data-arrow]:not([data-met])').count()).toBeGreaterThan(0)
  // Стрелка стоит В СТОЛБЦЕ зависимого: прямая линия, а не диагональ.
  const id = await arrows.first().getAttribute('data-arrow')
  const to = await page.locator(`[data-talent="${id}"]`).boundingBox()
  const line = await arrows.first().boundingBox()
  const center = (b: { x: number; width: number }) => b.x + b.width / 2
  expect(Math.abs(center(to!) - center(line!))).toBeLessThan(2)
})

test('шапка ветки говорит, сколько очков до следующего ключевого', async ({ page }) => {
  await openTree(page, 'mid')
  const head = page.locator('[data-next-key]')
  await expect(head).toHaveCount(1)
  await expect(head).toContainText('до следующего ключевого')
})

test('ветки переключаются вкладками, и вложенное видно в каждой', async ({ page }) => {
  await openTree(page)
  const tabs = page.locator('[data-branch-tabs] .tab')
  expect(await tabs.count()).toBe(3)
  const spent = await tabs.locator('.spent').allInnerTexts()
  expect(spent.length).toBe(3)
  expect(spent.map((s) => Number(s.trim())).some((n) => n > 0)).toBe(true)

  const first = await page.locator('[data-branch]').getAttribute('data-branch')
  await tabs.nth(1).click()
  await expect(page.locator('[data-branch]')).not.toHaveAttribute('data-branch', first ?? '')
  // Открыта РОВНО ОДНА ветка.
  await expect(page.locator('[data-branch]')).toHaveCount(1)
})

test('ЛКМ вкладывает, ПКМ снимает вложенное В ЭТОТ ЗАХОД бесплатно', async ({ page }) => {
  // Середина игры: десятый уровень, первое очко пришло и ещё не потрачено —
  // ровно тот момент, ради которого экран и открывают.
  await openTree(page, 'mid')
  const priceBefore = await resetButton(page).innerText()
  const first = talents(page).first()
  const max = await maxRankOf(first)
  await expect(first.locator('[data-rank]')).toHaveText(`0/${max}`)

  await first.click()
  await expect(first.locator('[data-rank]')).toHaveText(`1/${max}`)
  // НАЖАТИЕ ГАСИТ ПОДСКАЗКУ: она не прилипает к узлу, который только что нажали.
  await expect(tip(page)).toHaveCount(0)

  await first.click({ button: 'right' })
  await expect(first.locator('[data-rank]')).toHaveText(`0/${max}`)
  // СЧЁТЧИК ПЛАТНЫХ СБРОСОВ НЕ ТРОНУТ: цена следующего сброса та же.
  expect(await resetButton(page).innerText()).toBe(priceBefore)
  await expect(page.locator('text=свободных очков')).toHaveCount(1)
})

test('закрыл экран — ПКМ больше не снимает', async ({ page }) => {
  // Граница захода — не удобство, а цена: раздать сброс бесплатно значит
  // обесценить и сам сброс, и решение, которое игрок уже принял.
  await openTree(page, 'mid')
  const first = talents(page).first()
  const max = await maxRankOf(first)
  await first.click()
  await expect(first.locator('[data-rank]')).toHaveText(`1/${max}`)

  await page.keyboard.press('Escape')
  await openMenu(page, 'Таланты')
  const again = talents(page).first()
  await again.click({ button: 'right' })
  await expect(again.locator('[data-rank]')).toHaveText(`1/${max}`)
  // Нажатие погасило подсказку; курсор всё ещё над узлом, поэтому сперва
  // уводим его — иначе наведения не случится.
  await page.mouse.move(5, 5)
  await again.hover()
  await expect(tip(page)).toContainText('только сбросом')
})

test('запертый выбором узел назван и заперт', async ({ page }) => {
  // Пресет «дерево» собран так, что на ключевом этаже взят один узел из
  // группы — значит сосед по ней заперт выбором. Какой это этаж, решает
  // форма ветки; `presets.test.ts` держит само наличие взятой группы.
  await openTree(page, 'tree')
  const barred = page.locator('[data-talent][data-group-locked]')
  expect(await barred.count()).toBeGreaterThan(0)
  await barred.first().hover()
  await expect(tip(page).locator('[data-reason]')).toContainText('вместе не берутся')
})

test.describe('тач-экран', () => {
  test.use({ hasTouch: true })

  test('первое нажатие показывает подсказку, второе — вкладывает', async ({ page }) => {
    await openTree(page, 'mid')
    const first = talents(page).first()
    const max = await maxRankOf(first)
    await expect(first.locator('[data-rank]')).toHaveText(`0/${max}`)
    await first.tap()
    await expect(tip(page)).toHaveCount(1)
    await expect(first.locator('[data-rank]')).toHaveText(`0/${max}`)
    await first.tap()
    await expect(first.locator('[data-rank]')).toHaveText(`1/${max}`)
    await expect(tip(page)).toHaveCount(0)
  })
})
