// БАЛАНСНЫЙ ОТПЕЧАТОК. У тика есть golden; у матрицы баланса не было ничего,
// и это дыра сама по себе, безотносительно скорости: любая правка внутри
// модели боя могла тихо сдвинуть числа контрактов, оставшись внутри допусков.
//
// Под BALANCE_DUMP=<каталог> тесты не только утверждают, но и ЗАПИСЫВАЮТ
// каждую посчитанную величину. Сравнивает дампы `npm run balance:diff`.
//
// КЛЮЧ СТРОИТСЯ ИЗ ДАННЫХ, А НЕ ИЗ ИМЕНИ ТЕСТА: `цена-боя/warden/зона-03`,
// а не «Страж: цена боя по зонам #7». Иначе разбиение цикла на it.each
// переименовало бы все ключи разом — и отпечаток перестал бы проверять
// ровно ту стадию, ради которой он заведён.
import { afterAll } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { Decimal } from '../numbers'

/**
 * ЗНАЧАЩИХ цифр, а не знаков после запятой, и это не придирка: величины
 * матрицы идут от вероятности смерти (1e-3) до золота за путь (1e9).
 * Шесть знаков после запятой у первой отрезали бы половину числа, у второй
 * записали бы шум последнего бита. Двенадцать значащих — с запасом ловят
 * любую правку баланса (они двигают числа на проценты) и на четыре порядка
 * выше шума double.
 */
export const DUMP_DIGITS = 12

const target = process.env.BALANCE_DUMP ?? ''
export const DUMPING = target !== ''

const values = new Map<string, string>()
let flushes = 0

function encode(value: number | Decimal): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
    if (value === 0) return '0'
    return value.toPrecision(DUMP_DIGITS)
  }
  // Decimal держит порядки за пределами double, поэтому через toNumber его
  // писать нельзя: 1e400 стал бы Infinity и все такие величины совпали бы.
  if (value.eq(0)) return '0'
  return value.toExponential(DUMP_DIGITS - 1)
}

/**
 * Записать величину в отпечаток и вернуть её же — чтобы вызов оборачивался
 * прямо в утверждение: `expect(dump('ключ', x)).toBeGreaterThan(0)`.
 * Так записывается ИМЕННО ТО, что тест сравнивает с ожиданием, а не его копия.
 */
export function dump<T extends number | Decimal>(key: string, value: T): T {
  if (!DUMPING) return value
  const encoded = encode(value)
  const seen = values.get(key)
  if (seen !== undefined && seen !== encoded) {
    throw new Error(`отпечаток: ключ «${key}» записан дважды: ${seen} и ${encoded}`)
  }
  values.set(key, encoded)
  return value
}

/** То же для набора величин с общей приставкой. */
export function dumpAll(prefix: string, entries: Record<string, number | Decimal>): void {
  if (!DUMPING) return
  for (const [name, value] of Object.entries(entries)) dump(`${prefix}/${name}`, value)
}

/**
 * Каждый воркер пишет СВОЙ кусок: раскладка тестов по потокам — не свойство
 * игры, и от неё отпечаток зависеть не должен. Сливает куски скрипт сравнения.
 */
export function flushDump(): void {
  if (!DUMPING || values.size === 0) return
  mkdirSync(target, { recursive: true })
  const sorted = Object.fromEntries([...values.entries()].sort(([a], [b]) => (a < b ? -1 : 1)))
  writeFileSync(`${target}/part-${process.pid}-${flushes}.json`, JSON.stringify(sorted, null, 2))
  flushes += 1
  values.clear()
}

// ДВА СПОСОБА СБРОСА, и оба нужны. `afterAll` закрывает обычный прогон
// (isolate: true — модуль свой у каждого файла). При `isolate: false` модуль
// вычисляется РАЗ НА ВОРКЕР, и хук зарегистрируется только от первого файла —
// остаток забирает выход процесса. Сброс идемпотентен: карта очищается.
try {
  afterAll(flushDump)
} catch {
  // Вне фазы сбора тестов хук зарегистрировать нельзя — тогда хватит выхода.
}
process.on('exit', flushDump)
