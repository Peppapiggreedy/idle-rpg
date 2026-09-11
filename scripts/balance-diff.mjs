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
//   node scripts/balance-diff.mjs --only-class <id>
//       правка ТАЛАНТОВ одного класса: расхождения в ключах этого класса
//       законны, а в ключах мира и чужих классов — нет
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

// ---------------------------------------------------------------------------
// ЧЕЙ КЛЮЧ: МИРА ИЛИ КЛАССА
// ---------------------------------------------------------------------------
//
// Отпечаток целиком — это «изменилось хоть что-то», и на правку одного
// таланта он отвечает так же, как на правку урона мобов: красным списком.
// Читать его при этом приходится глазами, а решать — «это законно или нет».
//
// Разделение делает ответ проверяемым. Правка дерева ОДНОГО класса обязана
// двигать ключи ТОЛЬКО этого класса: мир (мобы, зоны, золото, разрыв
// уровней) талантом не меряется вовсе — он считается на эталонной сборке без
// единого очка (`REFERENCE_BUILD`), — а чужой класс дерева не читает.
//
// СПИСОК КЛАССОВ БЕРЁТСЯ ИЗ САМОГО ОТПЕЧАТКА, а не переписывается сюда:
// ключи вида `.../class-<id>/...` его и объявляют. Второй список классов в
// скрипте разъехался бы с data/classes.ts на первом же новом классе.
const classIds = new Set()
for (const key of [...Object.keys(base), ...fresh.keys()]) {
  for (const seg of key.split('/')) {
    const m = /^class-(.+)$/.exec(seg)
    if (m) classIds.add(m[1])
  }
}

// КОРОТКИЕ ИМЕНА ВЕТОК — ТОЖЕ ИЗ ОТПЕЧАТКА, И ЭТО ВТОРАЯ ПОЛОВИНА ТОГО ЖЕ
// ПРИНЦИПА. Ключ `talents/warden-wrath/...` объявляет ветку полным именем, а
// ключ сравнения пар — коротким: `talents/vigil-vs-wrath/wrath-bleed/...`.
// Слова `warden` в нём нет вовсе, и шестнадцать ключей СТРАЖА читались как
// ключи МИРА: правка одной ветки Стража выглядела как «уехало что-то ещё».
//
// Пары собираются из полных имён: увидели `warden-wrath` — значит `wrath`
// принадлежит `warden`. Второй список веток в скрипте разъехался бы с
// data/talents.ts на первой же новой ветке.
const branchOwner = new Map()
for (const key of [...Object.keys(base), ...fresh.keys()]) {
  for (const seg of key.split('/')) {
    const at = seg.indexOf('-')
    if (at <= 0) continue
    const head = seg.slice(0, at)
    const tail = seg.slice(at + 1)
    if (classIds.has(head) && tail && !tail.includes('-')) branchOwner.set(tail, head)
  }
}

/**
 * Класс ключа или null, если ключ про мир.
 *
 * СРАВНИВАЮТСЯ СЛОВА, А НЕ НАЧАЛА СТРОК. Имя класса появляется в ключе
 * четырьмя способами — `warden`, `class-warden`, `warden-bulwark` (ветка) и
 * `branch-houndmaster-chase`, — и правило «сегмент начинается с имени»
 * последний вид пропускало: три ключа Псаря читались как ключи мира. Разбор
 * по обоим разделителям ловит все четыре и не может ошибиться в другую
 * сторону: `wormwood-rise` не содержит слова `warden`.
 */
const classOf = (key) => {
  const words = new Set(key.split(/[/-]/))
  for (const id of classIds) if (words.has(id)) return id
  // Имени класса в ключе нет — ищем КОРОТКОЕ ИМЯ ВЕТКИ. Если оно называет
  // ветку известного класса, ключ принадлежит этому классу, а не миру.
  for (const word of words) {
    const owner = branchOwner.get(word)
    if (owner) return owner
  }
  return null
}

const groupName = (id) => (id === null ? 'МИР' : `КЛАСС ${id}`)
const groupsOf = (keys) => {
  const out = new Map()
  for (const key of keys) {
    const id = classOf(key)
    out.set(id, [...(out.get(id) ?? []), key])
  }
  return out
}

const report = (title, list, render) => {
  if (list.length === 0) return
  const keyOf = (item) => (typeof item === 'string' ? item : item.key)
  const groups = groupsOf(list.map(keyOf))
  const summary = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, keys]) => `${groupName(id)}: ${keys.length}`)
    .join(', ')
  console.error(`\n${title} (${list.length}) — ${summary}:`)
  const ordered = [...list].sort((a, b) => {
    const ga = classOf(keyOf(a)) ?? ''
    const gb = classOf(keyOf(b)) ?? ''
    return ga < gb ? -1 : ga > gb ? 1 : keyOf(a) < keyOf(b) ? -1 : 1
  })
  let shown = null
  for (const item of ordered.slice(0, 60)) {
    const id = classOf(keyOf(item))
    if (id !== shown) {
      console.error(`  — ${groupName(id)} —`)
      shown = id
    }
    console.error(`  ${render(item)}`)
  }
  if (list.length > 60) console.error(`  … и ещё ${list.length - 60}`)
}

report('РАСХОЖДЕНИЯ', changed, (c) => `${c.key}: было ${c.was}, стало ${c.now}`)
report('ПОТЕРЯНЫ (есть в эталоне, нет в дампе)', missing, (k) => k)
report('ЛИШНИЕ (нет в эталоне)', extra, (k) => k)

// ПРАВИЛО ПРАВКИ ДЕРЕВА. Без флага разделение — справка; с флагом это
// проверка: тронул таланты класса — и всё, что уехало, обязано быть его.
const onlyClass = value('--only-class', null)
if (onlyClass) {
  if (!classIds.has(onlyClass)) {
    console.error(`\nВ отпечатке нет класса «${onlyClass}». Есть: ${[...classIds].join(', ')}.`)
    process.exit(2)
  }
  const touched = [...changed.map((c) => c.key), ...missing, ...extra]
  const foreign = touched.filter((k) => classOf(k) !== onlyClass)
  if (foreign.length > 0) {
    console.error(
      `\nПРАВКА ТАЛАНТОВ «${onlyClass}» СДВИНУЛА ЧУЖИЕ КЛЮЧИ (${foreign.length}). ` +
        'Мир меряется на сборке без очков, а чужой класс дерева не читает — ' +
        'значит уехало что-то ещё:',
    )
    for (const key of foreign.slice(0, 40)) console.error(`  ${groupName(classOf(key))}  ${key}`)
    if (foreign.length > 40) console.error(`  … и ещё ${foreign.length - 40}`)
    process.exit(1)
  }
  console.log(
    `\nПРАВКА ТАЛАНТОВ «${onlyClass}»: сдвинулись только его ключи (${touched.length}).`,
  )
  process.exit(0)
}

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
