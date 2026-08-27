// Собирает один inline-спрайт из иконок game-icons.net.
//
// Зачем скрипт, а не «положить файлы рядом»: у game-icons каждый файл —
// самостоятельная картинка с ЧЁРНОЙ ПОДЛОЖКОЙ и белой фигурой. В интерфейсе
// нужна не картинка, а фигура, которая красится currentColor: тогда одна
// иконка работает и на кнопке, и в цвете редкости, и в приглушённом тексте.
// Скрипт снимает подложку, переводит фигуру на currentColor и складывает всё
// в <symbol>. Результат коммитится, поэтому сборка игры от сети не зависит.
//
// Запуск: npm run icons:build (нужен склонированный репозиторий game-icons).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const SOURCE = process.env.GAME_ICONS_DIR ?? '/home/user/game-icons/icons'
const OUT = join(root, 'src/lib/ui/icons/sprite.svg')

// Реестр читаем как текст: тянуть сюда TypeScript ради одного объекта незачем.
const manifestSrc = readFileSync(join(root, 'src/lib/ui/icons/manifest.ts'), 'utf8')
const entries = [...manifestSrc.matchAll(/^\s*'?([\w-]+)'?:\s*\{\s*file:\s*'([^']+)'/gm)].map(
  ([, name, file]) => ({ name, file }),
)
if (entries.length === 0) throw new Error('в манифесте не найдено ни одной иконки')

/** Чёрная подложка game-icons: полноразмерный прямоугольник первым path. */
const BACKDROP = /<path d="M0 0h512v512H0z"\s*\/>/g

function symbolFor({ name, file }) {
  const raw = readFileSync(join(SOURCE, file), 'utf8')
  const body = raw
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(BACKDROP, '')
    // Белая фигура становится текущим цветом текста. Другого fill у этих
    // иконок нет — если появится, он останется как есть, и это будет видно.
    .replace(/fill="#fff"/g, 'fill="currentColor"')
    .trim()
  if (body.includes('#fff') || body.includes('M0 0h512v512H0z')) {
    throw new Error(`иконка ${name}: подложка или белая заливка не снялись`)
  }
  return `<symbol id="icon-${name}" viewBox="0 0 512 512">${body}</symbol>`
}

const symbols = entries.map(symbolFor)
const sprite = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:none">${symbols.join(
  '',
)}</svg>\n`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, sprite)
console.log(`иконок собрано: ${entries.length}, размер: ${(sprite.length / 1024).toFixed(1)} КБ`)
