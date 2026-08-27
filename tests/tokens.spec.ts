import { expect, test } from '@playwright/test'

// Точный снимок дизайн-токенов. Нужен потому, что картинка цвет не стережёт:
// цветной текст занимает сотые доли процента пикселей страницы, и порог,
// который ловил бы смену цвета и при этом переживал чужое сглаживание шрифта,
// подобрать нельзя (замеры — в playwright.config.ts). Здесь же сравнение
// точное: любое изменение значения токена видно построчно, вместе со старым
// и новым значением.
test('значения токенов совпадают с эталоном', async ({ page }) => {
  await page.goto('ui?debug=1')
  await expect(page.locator('html')).toHaveAttribute('data-ready', 'ui')

  const tokens = await page.evaluate(() => {
    // Имена берём из самих правил :root, а не из списка в тесте: добавили
    // токен — он попадает в эталон сам, и забыть его нельзя.
    const names = new Set<string>()
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList
      try {
        rules = sheet.cssRules
      } catch {
        continue // чужой origin — у игры таких таблиц нет, но пусть не падает
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue
        if (!rule.selectorText.split(',').some((part) => part.trim() === ':root')) continue
        for (const prop of Array.from(rule.style)) {
          if (prop.startsWith('--')) names.add(prop)
        }
      }
    }
    const computed = getComputedStyle(document.documentElement)
    return [...names]
      .sort()
      .map((name) => `${name}: ${computed.getPropertyValue(name).trim()}`)
  })

  // Токенов должно быть много: пустой список означал бы, что стили не
  // доехали, а тест при этом «прошёл бы».
  expect(tokens.length).toBeGreaterThan(30)
  expect(tokens.join('\n') + '\n').toMatchSnapshot('tokens.txt')
})
