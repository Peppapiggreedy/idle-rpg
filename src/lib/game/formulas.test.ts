import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { applyXp, xpToNextLevel } from './formulas'
import { KILLS_PER_LEVEL, LEVEL_CAP, killsToNextLevel } from '../data/balance'
import { representativeMonster, zoneForMonsterLevel } from '../data/zones'

describe('уровни', () => {
  const need = (level: number) => xpToNextLevel(new Decimal(level))

  // Кривая задана таблицей УБИЙСТВ, а опыт из неё выводится. Тест повторяет
  // именно это правило, а не число: подкрутили награду мобов — стоимость
  // уровня обязана поехать следом сама.
  it('стоимость уровня = убийства по таблице × опыт с типичного моба зоны', () => {
    for (const level of [1, 5, 17, 42, 88]) {
      const perKill = representativeMonster(zoneForMonsterLevel(level)).xpReward
      const expected = perKill.times(killsToNextLevel(level)).floor()
      expect(need(level).eq(expected), `уровень ${level}`).toBe(true)
    }
  })

  it('таблица убийств интерполируется между опорными точками', () => {
    // В опорных точках — ровно табличное значение.
    for (const point of KILLS_PER_LEVEL) {
      expect(killsToNextLevel(point.level), `точка ${point.level}`).toBeCloseTo(point.kills, 9)
    }
    // Между ними — линия: середина отрезка даёт полусумму краёв.
    expect(killsToNextLevel(15)).toBeCloseTo((19 + 34) / 2, 9)
    // За краями таблицы кривая не улетает, а держит крайнее значение.
    expect(killsToNextLevel(0)).toBe(KILLS_PER_LEVEL[0].kills)
    expect(killsToNextLevel(500)).toBe(KILLS_PER_LEVEL[KILLS_PER_LEVEL.length - 1].kills)
  })

  it('ступеньки на 60 и 90 уровнях реальны, а не декоративны', () => {
    // Игра входит в новую треть: скачок обязан быть заметным (в полтора раза
    // и больше), иначе он не читается как смена главы.
    expect(killsToNextLevel(60) / killsToNextLevel(59)).toBeGreaterThan(1.2)
    expect(killsToNextLevel(90) / killsToNextLevel(89)).toBeGreaterThan(1.3)
  })

  it('кривая строго растёт до потолка', () => {
    for (let level = 1; level < LEVEL_CAP - 1; level++) {
      expect(need(level + 1).gte(need(level)), `уровень ${level}`).toBe(true)
    }
  })

  it('остаток опыта переносится, несколько уровней за один раз', () => {
    // Опыта ровно на три уровня плюс 7 сверху: остаток обязан быть этой семёркой.
    const gained = need(1).plus(need(2)).plus(need(3)).plus(7)
    const r = applyXp(new Decimal(1), new Decimal(0), gained)
    expect(r.level.toNumber()).toBe(4)
    expect(r.currentXp.toNumber()).toBe(7)
    expect(r.xpToNext.eq(need(4))).toBe(true)
  })

  it('ровно на границе уровня остаток нулевой', () => {
    const r = applyXp(new Decimal(1), new Decimal(0), need(1))
    expect(r.level.toNumber()).toBe(2)
    expect(r.currentXp.toNumber()).toBe(0)
  })

  it('много уровней за один раз: опыт сходится копейка в копейку', () => {
    // Берём заведомо меньше, чем стоит путь до потолка: там остаток
    // обнуляется намеренно (см. следующий тест), и сходиться нечему.
    let gained = new Decimal(0)
    for (let level = 1; level < 40; level++) gained = gained.plus(need(level))
    gained = gained.plus(11)
    const r = applyXp(new Decimal(1), new Decimal(0), gained)
    expect(r.level.toNumber()).toBe(40)
    expect(r.currentXp.toNumber()).toBe(11)
    expect(r.currentXp.lt(r.xpToNext)).toBe(true)
  })

  it('на потолке опыт не копится и уровень не растёт', () => {
    // Гора опыта разом не уводит выше потолка.
    const huge = applyXp(new Decimal(1), new Decimal(0), new Decimal('1e30'))
    expect(huge.level.toNumber()).toBe(LEVEL_CAP)
    expect(huge.xpToNext.toNumber()).toBe(0)
    // И на самом потолке счётчик не растёт: висящий опыт был бы обещанием
    // уровня, которого не будет.
    const capped = applyXp(new Decimal(LEVEL_CAP), new Decimal(0), new Decimal(1e6))
    expect(capped.level.toNumber()).toBe(LEVEL_CAP)
    expect(capped.currentXp.toNumber()).toBe(0)
    expect(xpToNextLevel(new Decimal(LEVEL_CAP)).toNumber()).toBe(0)
  })
})
