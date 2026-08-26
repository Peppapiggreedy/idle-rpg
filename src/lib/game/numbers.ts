// Тонкая обёртка над break_infinity.js: единственная точка импорта Decimal
// для игровой логики + форматирование чисел для интерфейса.
import Decimal from 'break_infinity.js'

export { Decimal }

const SUFFIXES = ['', 'K', 'M', 'B', 'T']

// Экспоненциальная запись вида "1.00e15" (без плюса после e).
function toExponential(d: Decimal): string {
  return d.toExponential(2).replace('e+', 'e')
}

// Читаемый вид числа: до 1000 — целое, дальше 1.23K / 4.56M / 7.89B / 1.00T,
// от 1e15 — экспонента 1.00e15.
export function formatNumber(d: Decimal): string {
  if (d.sign() < 0) return '-' + formatNumber(d.abs())
  if (d.lt(1000)) return d.toFixed(0)
  const exp = Math.floor(d.log10())
  if (exp >= 15) return toExponential(d)
  let tier = Math.floor(exp / 3)
  let scaled = d.div(Decimal.pow(10, tier * 3))
  // toFixed(2) на границе округлил бы 999.996K до "1000.00K" — поднимаем разряд.
  if (scaled.gte(999.995)) {
    tier += 1
    scaled = d.div(Decimal.pow(10, tier * 3))
  }
  if (tier >= SUFFIXES.length) return toExponential(d)
  return scaled.toFixed(2) + SUFFIXES[tier]
}
