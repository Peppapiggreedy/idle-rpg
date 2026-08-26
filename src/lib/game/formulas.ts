// Игровые формулы. Каждая — с пояснением, что считает и почему.
import { Decimal } from './numbers'
import type { UpgradeDef } from '../types'

// Погрешность pow (считается через exp/ln) может дать 79.999999 вместо 80 —
// добавляем крошечный относительный эпсилон перед округлением вниз.
function floorSafe(d: Decimal): Decimal {
  return d.times(1 + 1e-9).floor()
}

// Цена следующей покупки: baseCost * costGrowth^owned — каждая покупка дорожает
// на 15%, чтобы рост урона требовал экспоненциально больше золота. Целое золото.
export function upgradeCost(def: UpgradeDef, owned: Decimal): Decimal {
  return floorSafe(def.baseCost.times(Decimal.pow(def.costGrowth, owned)))
}

// Кривая опыта: 10 * level^1.5 — степенная, уровни замедляются, но не встают колом.
export function xpToNextLevel(level: Decimal): Decimal {
  return floorSafe(new Decimal(10).times(level.pow(1.5)))
}

// Предохранитель applyXp: столько уровней за один вызов хватит на любой честный
// геймплей (~1e13 опыта разом); излишек опыта останется и докрутится в следующих тиках.
export const MAX_LEVELUPS_PER_CALL = 100_000

export interface XpResult {
  level: Decimal
  currentXp: Decimal
  xpToNext: Decimal
}

// Начисляет опыт с переносом остатка. За один вызов может подняться много
// уровней; каждый шаг цикла строго уменьшает опыт минимум на 10 — цикл конечен.
export function applyXp(level: Decimal, currentXp: Decimal, gained: Decimal): XpResult {
  let lvl = level
  let xp = currentXp.plus(gained)
  let need = xpToNextLevel(lvl)
  let levelUps = 0
  while (xp.gte(need) && need.gt(0) && levelUps < MAX_LEVELUPS_PER_CALL) {
    xp = xp.minus(need)
    lvl = lvl.plus(1)
    need = xpToNextLevel(lvl)
    levelUps += 1
  }
  return { level: lvl, currentXp: xp, xpToNext: need }
}
