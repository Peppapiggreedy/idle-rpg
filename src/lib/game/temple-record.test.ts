// ХРАМ: РЕКОРД ВМЕСТО КУЛДАУНА.
//
// Главное, что здесь проверяется, — ДВА РАЗНЫХ ПУТИ завершения забега:
// смерть засчитывается, брошенный забег нет. Если бы смерть шла по второй
// ветке, погибнуть стало бы не дороже, чем закрыть вкладку, и риск смерти
// вместе с привалом между боями потерял бы смысл.
import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { createInitialState, monsterFromTemplate, type GameState } from './state'
import { ensureStats } from './stats'
import {
  advanceTemple,
  clearTempleWave,
  enterTemple,
  finishTempleRun,
  leaveTemple,
  templeStatus,
} from './temple'
import { recipeUnlocked } from '../data/temple'
import { TEMPLE, buildTempleMonster, floorReward } from '../data/temple'
import { materialCount } from './crafting'
import { createRng } from './rng'
import { averageGear } from './simulate'

const RNG = createRng(1)

function atTemple(patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(TEMPLE.unlockRequirement),
    equipment: averageGear(TEMPLE.unlockRequirement),
    currentZoneId: TEMPLE.zoneId,
    lastSurvivedZoneId: TEMPLE.zoneId,
    statsDirty: true,
    ...patch,
  })
}

/** Забег, доведённый до `floor` включительно: этажи отмечаются по одному. */
function runTo(state: GameState, floor: number): GameState {
  let s = enterTemple(state)
  for (let i = 1; i <= floor; i += 1) {
    s = clearTempleWave(s)
    if (i < floor) s = advanceTemple(s)
  }
  return s
}

describe('кулдауна нет', () => {
  it('в храм можно зайти сразу же после выхода', () => {
    const first = leaveTemple(runTo(atTemple(), 2), RNG, false)
    expect(first.templeRun).toBeNull()
    // Никакого «приходи завтра»: вход открыт снова, и это не дыра, а замысел.
    expect(templeStatus(first)).toMatchObject({ canEnter: true, reason: null })
  })

  it('статус не знает кода «кулдаун» вовсе', () => {
    const status = templeStatus(atTemple())
    expect(status.reason).toBeNull()
    expect(Object.keys(status)).not.toContain('msToNextAttempt')
  })
})

describe('платят только этажи выше рекорда', () => {
  it('рекорд 0, забег до 3 — платят этажи 1..3', () => {
    const before = atTemple()
    const { state, outcome } = finishTempleRun(runTo(before, 3))
    expect(outcome.reached).toBe(3)
    expect(outcome.paidFrom).toBe(1)
    expect(outcome.paidTo).toBe(3)
    const expected = [1, 2, 3].map((f) => floorReward(TEMPLE, f))
    expect(outcome.dust).toBe(expected.reduce((sum, r) => sum + r.dust, 0))
    expect(state.templeBestWave).toBe(3)
    expect(state.enchantDust.minus(before.enchantDust).toNumber()).toBe(outcome.dust)
    expect(state.gold.gt(before.gold)).toBe(true)
  })

  it('рекорд 3, забег до 6 — платят только 4..6', () => {
    const before = atTemple({ templeBestWave: 3 })
    const { state, outcome } = finishTempleRun(runTo(before, 6))
    expect(outcome.paidFrom).toBe(4)
    expect(outcome.paidTo).toBe(6)
    expect(outcome.dust).toBe([4, 5, 6].reduce((sum, f) => sum + floorReward(TEMPLE, f).dust, 0))
    expect(state.templeBestWave).toBe(6)
  })

  it('рекорд 6, забег до 2 — награды нет, рекорд не падает', () => {
    const before = atTemple({ templeBestWave: 6 })
    const { state, outcome } = finishTempleRun(runTo(before, 2))
    expect(outcome.dust).toBe(0)
    expect(outcome.gold.eq(0)).toBe(true)
    expect(state.templeBestWave).toBe(6)
    expect(state.enchantDust.eq(before.enchantDust)).toBe(true)
    expect(state.gold.eq(before.gold)).toBe(true)
  })

  it('ФАРМ ЗАКРЫТ: тот же забег второй раз не платит ничего', () => {
    // Кулдауна нет, значит заходить можно бесконечно — и это безопасно
    // ровно потому, что рекорд нельзя побить дважды. Выходим ЧЕРЕЗ
    // leaveTemple: она и платит, и закрывает забег, иначе второй заход
    // просто продолжил бы первый.
    const first = leaveTemple(runTo(atTemple(), 5), RNG, false, true)
    expect(first.templeBestWave).toBe(5)
    const second = leaveTemple(runTo(first, 5), RNG, false, true)
    expect(second.templeBestWave).toBe(5)
    expect(second.enchantDust.eq(first.enchantDust)).toBe(true)
    expect(second.gold.eq(first.gold)).toBe(true)
  })
})

describe('смерть засчитывается, прерывание — нет', () => {
  it('смерть завершает забег С РЕЗУЛЬТАТОМ', () => {
    // Герой прошёл два этажа и умер на третьем. Третий не считается —
    // его отмечает смерть БОЙЦА, а не героя; первые два оплачены.
    const inside = runTo(atTemple(), 2)
    const onThird = advanceTemple(inside)
    expect(onThird.templeRun?.wave).toBe(3)
    const out = leaveTemple(onThird, RNG, true, true)
    expect(out.templeRun).toBeNull()
    expect(out.templeBestWave).toBe(2)
    expect(out.enchantDust.gt(inside.enchantDust)).toBe(true)
  })

  it('брошенный забег не платит и не двигает рекорд', () => {
    const inside = runTo(atTemple(), 4)
    const out = leaveTemple(inside, RNG, false, false)
    expect(out.templeRun).toBeNull()
    expect(out.templeBestWave).toBe(0)
    expect(out.enchantDust.eq(inside.enchantDust)).toBe(true)
    expect(out.gold.eq(inside.gold)).toBe(true)
  })

  it('добровольный выход засчитывается, как и смерть', () => {
    // Выход — это КОНЕЦ ПОПЫТКИ, а не побег из неё: этажи уже пройдены.
    const inside = runTo(atTemple(), 4)
    const out = leaveTemple(inside, RNG, false, true)
    expect(out.templeBestWave).toBe(4)
    expect(out.enchantDust.gt(inside.enchantDust)).toBe(true)
  })
})

describe('полная зачистка', () => {
  it('даёт токен и уникальный рецепт РОВНО ОДИН РАЗ', () => {
    const before = atTemple({ templeBestWave: TEMPLE.floors - 1 })
    const first = finishTempleRun(runTo(before, TEMPLE.floors))
    expect(first.outcome.fullClear).toBe(true)
    expect(first.state.templeCleared).toBe(true)
    expect(materialCount(first.state, TEMPLE.clearReward.materialId).toNumber()).toBe(1)
    // Уникальный рецепт открывается ФЛАГОМ зачистки, а не рекордом.
    expect(recipeUnlocked(TEMPLE.clearReward.recipeId, 0, false)).toBe(false)
    expect(recipeUnlocked(TEMPLE.clearReward.recipeId, first.state.templeBestWave, true)).toBe(true)

    // Повторная зачистка НЕ дублирует: токена по-прежнему один.
    const again = finishTempleRun(runTo(first.state, TEMPLE.floors))
    expect(again.outcome.fullClear).toBe(false)
    expect(materialCount(again.state, TEMPLE.clearReward.materialId).toNumber()).toBe(1)
  })

  it('вход остаётся открытым, но помечен «награды исчерпаны»', () => {
    const done = atTemple({ templeBestWave: TEMPLE.floors, templeCleared: true })
    const status = templeStatus(done)
    expect(status.canEnter).toBe(true)
    expect(status.exhausted).toBe(true)
    expect(status.nextReward).toBeNull()
  })

  it('пока рекорд не на потолке, награда за следующий этаж названа', () => {
    const status = templeStatus(atTemple({ templeBestWave: 4 }))
    expect(status.exhausted).toBe(false)
    expect(status.nextReward).toMatchObject({ floor: 5 })
    expect(status.nextReward!.dust).toBe(floorReward(TEMPLE, 5).dust)
  })
})

describe('награда за храм — этажи, а не мобы', () => {
  it('бойцы храма не дают ни опыта, ни золота', () => {
    // Замер до правки: храм на семидесятом уровне давал в полтора раза
    // больше опыта в час, чем подходящая зона, и убийств тоже больше —
    // то есть и бросков лута. Кулдауна нет, значит это стало бы лучшей
    // фермой в игре.
    for (const floor of [1, 5, TEMPLE.floors]) {
      const fighter = buildTempleMonster(TEMPLE, TEMPLE.ladder[0], 70, floor)
      expect(fighter.xpReward.eq(0), `этаж ${floor}`).toBe(true)
      expect(fighter.goldReward.eq(0), `этаж ${floor}`).toBe(true)
    }
  })

  it('но тяжелеть этажи не перестали', () => {
    const first = buildTempleMonster(TEMPLE, TEMPLE.ladder[0], 70, 1)
    const last = buildTempleMonster(TEMPLE, TEMPLE.ladder[0], 70, TEMPLE.floors)
    expect(last.maxHp.gt(first.maxHp)).toBe(true)
    expect(last.damageMax.gt(first.damageMax)).toBe(true)
  })

  it('внутри храма лут не падает', async () => {
    const { tick } = await import('./tick')
    const inside = enterTemple(atTemple())
    let s: GameState = { ...inside, monster: monsterFromTemplate(buildTempleMonster(TEMPLE, TEMPLE.ladder[0], 70, 1)) }
    const before = s.inventory.length
    // Щедрый бросок: если бы лут падал, он бы упал.
    for (let t = 0; t < 60_000; t += 100) s = tick(s, 100, () => 0, () => {})
    expect(s.inventory.length).toBe(before)
  })
})
