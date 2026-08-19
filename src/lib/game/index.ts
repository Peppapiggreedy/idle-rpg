// Игровая логика: тики, бой, формулы, сохранение.
import Decimal from 'break_infinity.js'

// Форматирует большое число для отображения в интерфейсе.
export function formatNumber(value: Decimal): string {
  if (value.lt(1000)) return value.toFixed(0)
  if (value.lt(1e6)) return value.toNumber().toLocaleString('ru-RU')
  return value.toExponential(2).replace('e+', 'e')
}
