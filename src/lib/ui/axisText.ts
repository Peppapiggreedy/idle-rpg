// ДВЕ ОСИ АПГРЕЙДА СЛОВАМИ И ЧИСЛАМИ. Один модуль на всю игру.
//
// Осей две (`data/upgrade.ts`), и показываются они в двух местах: в окне
// сравнения под курсором и в подсказке куклы при перетаскивании. Числа там
// обязаны совпадать до знака — иначе игрок читает два разных ответа на один
// вопрос, — поэтому и форматирование, и названия лежат здесь, а не двумя
// копиями в компонентах.
//
// Знак у обеих осей значит одно и то же: плюс — лучше. У выживания это
// СНИЖЕНИЕ цены боя, и переворот знака сделан в логике (`compareAxes`), а не
// здесь: слой текста не должен знать, какая ось считается наоборот.
import { UPGRADE_AXES, type UpgradeAxis } from '../data/upgrade'

export const AXIS_NAME: Record<UpgradeAxis, string> = {
  damage: 'Урон',
  survival: 'Выживание',
}

/**
 * Доля словами. `null` — ось не посчиталась (нечего сравнивать),
 * бесконечность — слот был пуст, и прирост считать не от чего.
 */
export function axisShare(value: number | null): string {
  if (value === null) return '—'
  if (!Number.isFinite(value)) return 'с нуля'
  if (Math.abs(value) < 0.0005) return 'без изменений'
  return `${value > 0 ? '+' : '−'}${(Math.abs(value) * 100).toFixed(1).replace('.', ',')} %`
}

export interface AxisRow {
  axis: UpgradeAxis
  name: string
  text: string
  value: number | null
  /** Ось, по которой ставится метка при текущем приоритете, — жирнее. */
  marked: boolean
}

/** ОБЕ оси всегда: приоритет решает, что подсветить, а не что показать. */
export function axisRows(
  axes: Record<UpgradeAxis, number | null>,
  marked: readonly UpgradeAxis[],
): AxisRow[] {
  return UPGRADE_AXES.map((axis) => ({
    axis,
    name: AXIS_NAME[axis],
    text: axisShare(axes[axis]),
    value: axes[axis],
    marked: marked.includes(axis),
  }))
}
