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
import { appendFileSync, mkdirSync } from 'node:fs'
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

// Карта нужна не для записи, а чтобы поймать один ключ с двумя значениями.
const values = new Map<string, string>()
let ready = false

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
  record(key, encoded)
  return value
}

/** То же для набора величин с общей приставкой. */
export function dumpAll(prefix: string, entries: Record<string, number | Decimal>): void {
  if (!DUMPING) return
  for (const [name, value] of Object.entries(entries)) dump(`${prefix}/${name}`, value)
}

/**
 * ЗАПИСЬ СРАЗУ, СТРОКА НА ВЕЛИЧИНУ, А НЕ СБРОС В КОНЦЕ.
 *
 * Сброс по хуку `afterAll` уже подвёл: при `isolate: false` модуль живёт ОДИН
 * НА ВОРКЕР, хук регистрируется только от первого собранного файла, а
 * `process.on('exit')` в рабочем ПОТОКЕ не срабатывает вовсе. Прогон прошёл
 * зелёным, а в отпечатке оказалось 118 величин из 1853 — и это молчаливая
 * потеря: сверять было бы не с чем, но выглядело бы как «всё сошлось».
 *
 * Дозапись строки в общий файл от хуков не зависит вообще. Все воркеры пишут
 * в ОДИН файл: строка короче 4 КБ, а `appendFileSync` открывает с O_APPEND,
 * так что дозапись атомарна и строки не рвут друг друга.
 */
function record(key: string, encoded: string): void {
  if (!ready) {
    mkdirSync(target, { recursive: true })
    ready = true
  }
  appendFileSync(`${target}/values.jsonl`, `${JSON.stringify([key, encoded])}\n`)
}
