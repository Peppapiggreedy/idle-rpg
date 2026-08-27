import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// Снимки трёх заранее заданных состояний игры в трёх ширинах плюс витрина.
// Состояние приходит из ?state=<пресет> — это обычный сейв из
// src/lib/game/__fixtures__/presets, прокрученный на фиксированное число
// тиков. Игровой цикл при этом не запускается, поэтому кадр не «уезжает».

const PRESETS = ['fresh', 'mid', 'rich'] as const
// Телефон, планшет, десктоп. 720px — единственный брейкпоинт игры, поэтому
// 390 и 768 стоят по разные его стороны, а 1280 показывает две колонки шире.
const WIDTHS = [390, 768, 1280] as const

// Свежий комплект снимков кладём рядом с отчётом — его забирает CI как
// артефакт. Он появляется независимо от того, сошлись эталоны или нет:
// «посмотреть игру до merge» не должно зависеть от результата сравнения.
const CURRENT_DIR = join('test-results', 'current')

async function capture(page: Page, name: string): Promise<Buffer> {
  // Свой шрифт лежит рядом с игрой, но дождаться его всё равно надо: иначе
  // первый кадр нарисуется запасным начертанием и эталон не сойдётся.
  await page.evaluate(() => document.fonts.ready)
  const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' })
  const file = join(CURRENT_DIR, `${name}.png`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, shot)
  return shot
}

for (const preset of PRESETS) {
  for (const width of WIDTHS) {
    const name = `${preset}-${width}`
    test(`игра: ${preset} @ ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(`?debug=1&state=${preset}`)
      // Приложение само помечает готовность, когда состояние применено
      // и смонтировано, — ждём факт, а не таймаут.
      await expect(page.locator('html')).toHaveAttribute('data-ready', 'preset')
      expect(await capture(page, name)).toMatchSnapshot(`${name}.png`)
    })
  }
}

test('витрина интерфейса', async ({ page }) => {
  await page.goto('ui?debug=1')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'ui')
  expect(await capture(page, 'showcase-1280')).toMatchSnapshot('showcase-1280.png')
})
