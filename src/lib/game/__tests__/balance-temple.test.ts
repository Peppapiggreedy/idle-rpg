// ХРАМ: КРИВАЯ СЛОЖНОСТИ И НАЧИСЛЕНИЕ НАГРАД.
//
// Две вещи, и вторая дороже первой. Кривая — решение владельца о том, как
// глубоко заходит герой своего уровня. Начисление — цепочка, которая ДО ЭТОЙ
// НОЧИ БЫЛА РАЗОРВАНА: шаг `applyTempleWave` был написан, но в конвейер тика
// не попал, `run.cleared` оставался нулём при любой глубине, и игрок,
// дошедший до четырнадцатого этажа, не получал ничего.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { tick, type GameState } from '../tick'
import { ensureStats } from '../stats'
import { STEP_MS } from '../loop'
import { createRng } from '../rng'
import {
  clearTempleWave,
  enterTemple,
  finishTempleRun,
  pendingTempleReward,
} from '../temple'
import { TEMPLE, floorReward, templeFloorLevel } from '../../data/temple'
import { buildSimState, referenceBuild } from '../simulate'
import { zoneForMonsterLevel } from '../../data/zones'
import { DUNGEONS, GEAR_SHARE_MARGIN, requiredGearShare } from '../../data/dungeons'
import { LEVEL_CAP } from '../../data/balance'
import { dump } from './dump'

/**
 * «ХОРОШО ОДЕТЫЙ» — ТА ЖЕ ДОЛЯ, ЧТО В КОНТРАКТЕ ВОРОТ ДАНЖЕЙ: доля от
 * верхнего моба своей зоны, требуемая последним пройденным данжем. Своей
 * меры «одет как надо» у храма нет и заводить её нельзя — разъехались бы.
 */
function gearShareFor(level: number): number {
  const tier = DUNGEONS.filter((d) => d.unlockRequirement <= level).reduce(
    (max, d) => Math.max(max, d.tier),
    1,
  )
  return requiredGearShare(tier)
}

function hero(level: number, share: number): GameState {
  const zone = zoneForMonsterLevel(level)
  const gearLevel = Math.max(1, Math.round(zone.monsterLevelRange.max * share))
  const state = buildSimState({ ...referenceBuild(level), level, gearLevel }, TEMPLE.zoneId, 4242)
  return ensureStats({ ...state, statsDirty: true })
}

/** До какого этажа доходит забег. Настоящий тик, а не модель. */
function floorsReached(level: number, share: number, seed: number): number {
  let s = enterTemple(hero(level, share))
  expect(s.templeRun, `вход в храм на ${level} уровне`).not.toBeNull()
  const rng = createRng(seed)
  for (let i = 0; i < 400_000 && s.templeRun; i += 1) {
    s = tick(s, STEP_MS, rng, () => {})
    if (s.heroState === 'dead') break
  }
  return s.templeRun ? finishTempleRun(s).outcome.reached : s.templeBestWave
}

/** Медиана по трём сидам: одна неудачная волна — невезение, а не кривая. */
function medianFloors(level: number, share: number): number {
  const runs = [4242, 7, 1234].map((seed) => floorsReached(level, share, seed))
  return [...runs].sort((a, b) => a - b)[1]
}

describe('кривая сложности храма', () => {
  it('уровень этажа задан ФОРМУЛОЙ и растёт до потолка мира', () => {
    // Двадцати рукописных наборов быть не должно: этаж — абсолютная ступень.
    for (let floor = 2; floor <= TEMPLE.floors; floor += 1) {
      expect(templeFloorLevel(floor), `этаж ${floor}`).toBeGreaterThanOrEqual(
        templeFloorLevel(floor - 1),
      )
    }
    expect(templeFloorLevel(TEMPLE.floors)).toBe(LEVEL_CAP)
    // И не выше потолка: мобов сто первого уровня в игре нет.
    for (let floor = 1; floor <= TEMPLE.floors; floor += 1) {
      expect(templeFloorLevel(floor), `этаж ${floor}`).toBeLessThanOrEqual(LEVEL_CAP)
    }
  })

  // РЕШЕНИЕ ВЛАДЕЛЬЦА О КРИВОЙ: 70 → примерно 5 этажей, 90 → примерно 15,
  // 100 → все двадцать. Допуск ±1 этаж: глубина зависит от рулетки волн, и
  // требовать точного числа значило бы ловить невезение, а не кривую.
  const POINTS = [
    { level: 70, floors: 5 },
    { level: 90, floors: 15 },
    { level: 100, floors: TEMPLE.floors },
  ] as const

  it.each(POINTS.map((p) => [p.level, p.floors] as const))(
    'хорошо одетый %i уровень доходит примерно до %i этажа',
    (level, expected) => {
      const share = gearShareFor(level)
      const reached = dump(`temple/level-${String(level).padStart(3, '0')}/floors`, medianFloors(level, share))
      // eslint-disable-next-line no-console
      console.log(`храм: ур.${level}, доля снаряжения ${(share * 100).toFixed(0)}% → ${reached} этажей`)
      expect(reached).toBeGreaterThanOrEqual(expected - 1)
      expect(reached).toBeLessThanOrEqual(expected + 1)
    },
    120_000,
  )

  it.each(POINTS.filter((p) => p.level < LEVEL_CAP).map((p) => [p.level] as const))(
    'ТА ЖЕ ТОЧКА С ДРУГОЙ СТОРОНЫ: недоодетый %i уровень заходит МЕЛЬЧЕ',
    (level) => {
      // ОДНОСТОРОННЯЯ ПРОВЕРКА НЕ ОТЛИЧИЛА БЫ КРИВУЮ ОТ ЛЕСЕНКИ, которую
      // проходят при любом снаряжении. Сравниваются ДВА ЗАМЕРА ОДНОГО
      // ПРОГОНА, а не замер с константой: глубина шумит на ±1 от рулетки
      // волн, и требовать «меньше пяти» значило бы ловить невезение.
      //
      // ОТСТАВАНИЕ БЕРЁТСЯ ВДВОЕ БОЛЬШЕ, ЧЕМ У ВОРОТ ДАНЖЕЙ, и это замер, а
      // не осторожность. Внизу лестницы этажи стоят НИЖЕ собственного уровня
      // героя (первый этаж — 68-й уровень при герое 70), и стеной там служит
      // разрыв уровней, а не качество вещей: одного запаса ворот хватало
      // ровно на один этаж разницы, то есть на шум. На двойном запасе разрыв
      // измерен и устойчив: 70 → 5 против 3-4, 90 → 15 против 7-9.
      const dressed = medianFloors(level, gearShareFor(level))
      const behind = medianFloors(level, gearShareFor(level) - GEAR_SHARE_MARGIN * 2)
      // eslint-disable-next-line no-console
      console.log(`храм: ур.${level} одет → ${dressed} этажей, недоодет → ${behind}`)
      expect(behind).toBeLessThan(dressed)
    },
    120_000,
  )
})

describe('начисление за забег', () => {
  /** Забег, доведённый до заданного этажа: волны отмечаются как пройденные. */
  function runTo(state: GameState, floor: number): GameState {
    let s = enterTemple(state)
    for (let wave = 1; wave <= floor; wave += 1) {
      s = { ...s, templeRun: { ...s.templeRun!, wave } }
      // Боец волны погиб — отмечаем этаж ровно тем же шагом, что и тик.
      if (wave < floor) s = clearTempleWave(s)
    }
    return s
  }

  it('ТОТ САМЫЙ СЛУЧАЙ: рекорд 0, смерть на 14 этаже → платят 1-13, рекорд 13', () => {
    const base = { ...hero(90, gearShareFor(90)), templeBestWave: 0 }
    // Дошёл до четырнадцатого и на нём погиб: тринадцать под ним пройдены,
    // четырнадцатый — нет (этаж отмечает смерть БОЙЦА, а не героя).
    const s = runTo(base, 14)
    expect(s.templeRun!.cleared).toBe(13)

    const { state: after, outcome } = finishTempleRun(s)
    expect(outcome.reached).toBe(13)
    expect(outcome.paidFrom).toBe(1)
    expect(outcome.paidTo).toBe(13)
    expect(after.templeBestWave).toBe(13)

    // Сумма — ровно по этажам 1..13, ни одним больше.
    let dust = 0
    let gold = new Decimal(0)
    for (let floor = 1; floor <= 13; floor += 1) {
      dust += floorReward(TEMPLE, floor).dust
      gold = gold.plus(floorReward(TEMPLE, floor).gold)
    }
    expect(outcome.dust).toBe(dust)
    expect(outcome.gold.eq(gold)).toBe(true)
    expect(after.enchantDust.minus(base.enchantDust).eq(dust)).toBe(true)
    expect(after.gold.minus(base.gold).eq(gold)).toBe(true)
    // Рубежи 5 и 10 взяты по дороге, рубеж 15 — нет.
    expect(outcome.recipeIds).toEqual(
      TEMPLE.milestones.filter((m) => m.wave <= 13).map((m) => m.recipeId),
    )
    expect(outcome.fullClear).toBe(false)
  })

  it('копилка забега видна ДО его конца и совпадает с итогом', () => {
    // HUD показывает её игроку; второй арифметики «сколько уже заработано»
    // не заведено — иначе экран и начисление разошлись бы.
    const base = { ...hero(90, gearShareFor(90)), templeBestWave: 0 }
    const s = runTo(base, 14)
    const pending = pendingTempleReward(s)
    const { outcome } = finishTempleRun(s)
    expect(pending.from).toBe(outcome.paidFrom)
    expect(pending.to).toBe(outcome.paidTo)
    expect(pending.dust).toBe(outcome.dust)
    expect(pending.gold.eq(outcome.gold)).toBe(true)
    expect(pending.floors).toBe(13)
  })

  it('второй забег той же глубины не платит ничего: рекорд не побить дважды', () => {
    const base = { ...hero(90, gearShareFor(90)), templeBestWave: 13 }
    const { state: after, outcome } = finishTempleRun(runTo(base, 14))
    expect(outcome.dust).toBe(0)
    expect(outcome.gold.eq(0)).toBe(true)
    expect(after.gold.eq(base.gold)).toBe(true)
    expect(pendingTempleReward(runTo(base, 14)).floors).toBe(0)
  })

  it('ЖИВОЙ ТИК доводит забег до награды, а не только рукописный', () => {
    // Тот самый разрыв: шаг applyTempleWave не стоял в конвейере, и
    // `cleared` оставался нулём при любой глубине. Проверяется НАСТОЯЩИМ
    // тиком, потому что рукописный вызов clearTempleWave поломку не видел.
    let s = enterTemple({ ...hero(90, gearShareFor(90)), templeBestWave: 0 })
    const rng = createRng(4242)
    for (let i = 0; i < 400_000 && s.templeRun; i += 1) {
      s = tick(s, STEP_MS, rng, () => {})
      if (s.heroState === 'dead') break
    }
    const cleared = s.templeRun ? s.templeRun.cleared : s.templeBestWave
    expect(cleared, 'забег обязан засчитать хоть один этаж').toBeGreaterThan(0)
    if (s.templeRun) {
      const { outcome } = finishTempleRun(s)
      expect(outcome.dust).toBeGreaterThan(0)
      expect(outcome.gold.gt(0)).toBe(true)
    }
  })
})
