// Игровые формулы. Каждая — с пояснением, что считает и почему.
import { Decimal } from './numbers'
import { LEVEL_CAP, killsToNextLevel } from '../data/balance'
import { representativeMonster, zoneForMonsterLevel } from '../data/zones'

/**
 * Сколько опыта стоит следующий уровень.
 *
 * Кривая задана ТАБЛИЦЕЙ УБИЙСТВ (`KILLS_PER_LEVEL`), а число опыта из неё
 * выводится: сколько убийств × сколько опыта даёт типичный моб зоны,
 * чья полоса мобов накрывает этот уровень (`zoneForMonsterLevel`) — то есть
 * тех, кого герой реально бьёт, а не тех, чья зона уже открыта. Так кривая привязана к РЕАЛЬНОЙ награде —
 * поправили опыт мобов или множитель зоны, и стоимость уровня поехала следом.
 * Формула вида `база × L^степень` жила бы отдельной жизнью и рядом с
 * изменившейся наградой начала бы врать молча.
 *
 * На потолке возвращается ноль: расти дальше некуда, и полоска опыта
 * в интерфейсе сменяется словами (см. VitalsBar).
 */
export function xpToNextLevel(level: Decimal): Decimal {
  const lvl = level.toNumber()
  if (lvl >= LEVEL_CAP) return new Decimal(0)
  const zone = zoneForMonsterLevel(lvl)
  const perKill = representativeMonster(zone).xpReward
  return perKill.times(killsToNextLevel(lvl)).floor()
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
// уровней; каждый шаг цикла строго уменьшает опыт — цикл конечен.
//
// НА ПОТОЛКЕ ОПЫТ НЕ КОПИТСЯ. Не «копится, но не тратится»: висящий счётчик,
// который уже ни на что не влияет, — это обещание уровня, которого не будет.
// Поэтому и уровень, и накопленный опыт замирают, а `xpToNext` равен нулю.
export function applyXp(level: Decimal, currentXp: Decimal, gained: Decimal): XpResult {
  if (level.gte(LEVEL_CAP)) {
    return { level: new Decimal(LEVEL_CAP), currentXp: new Decimal(0), xpToNext: new Decimal(0) }
  }
  let lvl = level
  let xp = currentXp.plus(gained)
  let need = xpToNextLevel(lvl)
  let levelUps = 0
  while (xp.gte(need) && need.gt(0) && levelUps < MAX_LEVELUPS_PER_CALL) {
    xp = xp.minus(need)
    lvl = lvl.plus(1)
    if (lvl.gte(LEVEL_CAP)) {
      return { level: new Decimal(LEVEL_CAP), currentXp: new Decimal(0), xpToNext: new Decimal(0) }
    }
    need = xpToNextLevel(lvl)
    levelUps += 1
  }
  return { level: lvl, currentXp: xp, xpToNext: need }
}
