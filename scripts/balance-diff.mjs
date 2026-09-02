#!/usr/bin/env node
// Сверка балансного отпечатка с эталоном.
//
// Каждый воркер пишет свой кусок в каталог дампа (см. game/__tests__/dump.ts),
// потому что раскладка тестов по потокам — не свойство игры. Здесь куски
// сливаются в один отпечаток и сравниваются с docs/balance-baseline.json.
//
//   node scripts/balance-diff.mjs                  сверить с эталоном
//   node scripts/balance-diff.mjs --write          записать эталон из дампа
//   node scripts/balance-diff.mjs --allow-subset   для прогона выборкой:
//       ключей меньше — это охват, а не потеря; лишних быть по-прежнему нельзя
//   node scripts/balance-diff.mjs --dir <каталог> --baseline <файл>
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const dir = value('--dir', '.balance-dump')
const baselinePath = value('--baseline', 'docs/balance-baseline.json')

if (!existsSync(dir)) {
  console.error(`Дампа нет: каталог ${dir} не найден. Сперва \`npm run balance:dump\`.`)
  process.exit(2)
}

// Слияние. Величины пишутся строка за строкой в values.jsonl всеми воркерами
// сразу (см. game/__tests__/dump.ts): сброс по хуку при снятой изоляции терял
// почти весь отпечаток молча. Один ключ с ДВУМЯ значениями в одном прогоне —
// это недетерминированность, и молчать о ней нельзя.
const fresh = new Map()
const conflicts = []
const lines = []
const file = join(dir, 'values.jsonl')
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) if (line) lines.push(line)
}
// Старый формат кусками — чтобы уметь читать дампы, снятые до этой правки.
for (const part of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(join(dir, part), 'utf8')))) {
    lines.push(JSON.stringify([k, v]))
  }
}
for (const line of lines) {
  const [key, val] = JSON.parse(line)
  const seen = fresh.get(key)
  if (seen !== undefined && seen !== val) conflicts.push({ key, a: seen, b: val })
  fresh.set(key, val)
}

console.log(`Дамп: ${lines.length} записей, ${fresh.size} различных величин.`)
if (conflicts.length > 0) {
  console.error(`\nОДИН КЛЮЧ — ДВА ЗНАЧЕНИЯ В ОДНОМ ПРОГОНЕ (${conflicts.length}):`)
  for (const c of conflicts.slice(0, 40)) console.error(`  ${c.key}: ${c.a} и ${c.b}`)
  process.exit(1)
}

const sorted = Object.fromEntries([...fresh.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))

if (flag('--write')) {
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`)
  console.log(`Эталон записан: ${baselinePath}, ${fresh.size} величин.`)
  process.exit(0)
}

if (!existsSync(baselinePath)) {
  console.error(`Эталона нет: ${baselinePath}. Записать — \`--write\`.`)
  process.exit(2)
}
const base = JSON.parse(readFileSync(baselinePath, 'utf8'))

const changed = []
const missing = []
const extra = []
for (const [key, val] of Object.entries(base)) {
  if (!fresh.has(key)) missing.push(key)
  else if (fresh.get(key) !== val) changed.push({ key, was: val, now: fresh.get(key) })
}
for (const key of fresh.keys()) if (!(key in base)) extra.push(key)

const report = (title, list, render) => {
  if (list.length === 0) return
  console.error(`\n${title} (${list.length}):`)
  for (const item of list.slice(0, 60)) console.error(`  ${render(item)}`)
  if (list.length > 60) console.error(`  … и ещё ${list.length - 60}`)
}

report('РАСХОЖДЕНИЯ', changed, (c) => `${c.key}: было ${c.was}, стало ${c.now}`)
report('ПОТЕРЯНЫ (есть в эталоне, нет в дампе)', missing, (k) => k)
report('ЛИШНИЕ (нет в эталоне)', extra, (k) => k)

const subsetOk = flag('--allow-subset') && missing.length > 0 && changed.length === 0 && extra.length === 0
if (changed.length === 0 && extra.length === 0 && (missing.length === 0 || flag('--allow-subset'))) {
  const checked = Object.keys(base).length - missing.length
  console.log(
    subsetOk
      ? `\nОТПЕЧАТОК СОВПАЛ на ${checked} из ${Object.keys(base).length} величин (выборка: остальные не считались).`
      : `\nОТПЕЧАТОК СОВПАЛ ПОБИТОВО: ${checked} величин.`,
  )
  process.exit(0)
}
console.error('\nОТПЕЧАТОК НЕ СОВПАЛ.')
process.exit(1)
