import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { applyModifiers, ensureStats, type StatModifier } from './stats'
import {
  availablePoints,
  canResetTalents,
  earnedPoints,
  investTalent,
  rankOf,
  resetCost,
  resetTalents,
  reviveMultiplier,
  spentInBranch,
  spentPoints,
  talentFlags,
  talentModifiers,
  talentStatus,
} from './talents'
import { useAbility } from './abilities'
import { WEAPONS } from '../data/items'
import {
  BRANCHES,
  TALENTS,
  TALENT_BY_ID,
  talentsInBranch,
  type BranchId,
  type TalentDef,
} from '../data/talents'
import {
  REVIVE_DELAY_MS,
  TALENT_FIRST_LEVEL,
  TALENT_RESET_BASE_COST,
  TALENT_RESET_COST_GROWTH,
} from '../data/balance'

const EDGE = TALENT_BY_ID['honed-edge'] // ярость, ряд 1, до 5 рангов
const EYE = TALENT_BY_ID['keen-eye'] // ярость, ряд 2, нужно 5 очков в ветке
const RUPTURE = TALENT_BY_ID['rupture'] // ярость, последний ряд, флаг
const HIDE = TALENT_BY_ID['thick-hide'] // стойкость, ряд 1
const RETURN = TALENT_BY_ID['swift-return'] // стойкость, последний ряд, флаг

function hero(level: number, patch: Partial<GameState> = {}): GameState {
  return ensureStats({
    ...createInitialState(1),
    level: new Decimal(level),
    statsDirty: true,
    ...patch,
  })
}

// Вкладывает очки подряд; вернёт состояние после всех удачных вложений.
function invest(state: GameState, talentId: string, times: number): GameState {
  for (let i = 0; i < times; i++) state = investTalent(state, talentId)
  return state
}

/**
 * Вкладывает ветку целиком, по рядам сверху вниз. Списком id это делать
 * нельзя: ветки растут, и тест ломался бы от каждого нового таланта.
 */
function fillBranch(state: GameState, branch: BranchId): GameState {
  let next = state
  for (const talent of talentsInBranch(branch)) {
    next = invest(next, talent.id, talent.maxRank)
  }
  return next
}

describe('данные дерева', () => {
  it('три ветки по 5-6 талантов, ряды идут подряд и не повторяются', () => {
    // Ветки — это СТИЛИ игры, а не три способа поднять один и тот же урон:
    // урон, живучесть, автономность. Их ровно три, и все три полноценные.
    expect(BRANCHES).toHaveLength(3)
    for (const branch of BRANCHES) {
      const talents = talentsInBranch(branch.id)
      expect(talents.length, branch.id).toBeGreaterThanOrEqual(5)
      expect(talents.length, branch.id).toBeLessThanOrEqual(6)
      expect(talents.map((t) => t.row)).toEqual(talents.map((_, i) => i + 1))
    }
    expect(TALENTS.length).toBe(BRANCHES.reduce((n, b) => n + talentsInBranch(b.id).length, 0))
  })

  it('требование по ветке растёт вместе с рядом и достижимо', () => {
    for (const branch of BRANCHES) {
      const talents = talentsInBranch(branch.id)
      let reachable = 0
      for (const talent of talents) {
        expect(talent.requiredPointsInBranch).toBeGreaterThanOrEqual(0)
        // К моменту, когда ряд открывается, столько очков реально можно вложить.
        expect(talent.requiredPointsInBranch).toBeLessThanOrEqual(reachable)
        reachable += talent.maxRank
      }
    }
  })

  it('первый ряд открыт сразу, у каждого таланта есть эффект', () => {
    for (const branch of BRANCHES) {
      expect(talentsInBranch(branch.id)[0].requiredPointsInBranch).toBe(0)
    }
    for (const talent of TALENTS) {
      expect(talent.maxRank).toBeGreaterThan(0)
      if (talent.effect.kind === 'modifiers') expect(talent.effect.mods.length).toBeGreaterThan(0)
      else expect(talent.effect.flag).toBeTruthy()
    }
  })
})

describe('очки талантов', () => {
  it(`первое очко на ${TALENT_FIRST_LEVEL} уровне, дальше по одному`, () => {
    expect(earnedPoints(new Decimal(TALENT_FIRST_LEVEL - 1))).toBe(0)
    expect(earnedPoints(new Decimal(TALENT_FIRST_LEVEL))).toBe(1)
    expect(earnedPoints(new Decimal(TALENT_FIRST_LEVEL + 7))).toBe(8)
    expect(earnedPoints(new Decimal(1))).toBe(0)
  })

  it('доступные очки — заработанные минус вложенные', () => {
    const s = hero(TALENT_FIRST_LEVEL + 4) // 5 очков
    expect(availablePoints(s)).toBe(5)
    const after = invest(s, EDGE.id, 2)
    expect(spentPoints(after.talents)).toBe(2)
    expect(availablePoints(after)).toBe(3)
  })

  it('уровень растёт — очки капают', () => {
    let s = hero(TALENT_FIRST_LEVEL - 1)
    expect(availablePoints(s)).toBe(0)
    s = ensureStats({ ...s, level: s.level.plus(3), statsDirty: true })
    expect(availablePoints(s)).toBe(3)
  })
})

describe('правила вложения', () => {
  it('без очков вложить нельзя', () => {
    const s = hero(TALENT_FIRST_LEVEL - 1)
    expect(talentStatus(s, EDGE)).toMatchObject({ canInvest: false, reason: 'no-points' })
    expect(investTalent(s, EDGE.id)).toBe(s)
  })

  it('выше maxRank не поднять — лишние очки остаются целы', () => {
    const s = hero(TALENT_FIRST_LEVEL + 20)
    const maxed = invest(s, EDGE.id, EDGE.maxRank + 3)
    expect(rankOf(maxed.talents, EDGE.id)).toBe(EDGE.maxRank)
    expect(spentPoints(maxed.talents)).toBe(EDGE.maxRank)
    expect(talentStatus(maxed, EDGE)).toMatchObject({ canInvest: false, reason: 'max-rank' })
  })

  it('второй ряд закрыт, пока в ветку не вложено requiredPointsInBranch', () => {
    const s = hero(TALENT_FIRST_LEVEL + 20)
    const status = talentStatus(s, EYE)
    expect(status).toMatchObject({ canInvest: false, reason: 'branch-locked' })
    expect(status.requiredPointsInBranch).toBe(EYE.requiredPointsInBranch)
    expect(investTalent(s, EYE.id)).toBe(s)

    // Вложили ровно сколько нужно — открылось.
    const opened = invest(s, EDGE.id, EYE.requiredPointsInBranch)
    expect(spentInBranch(opened.talents, 'fury')).toBe(EYE.requiredPointsInBranch)
    expect(talentStatus(opened, EYE).canInvest).toBe(true)
  })

  it('очки чужой ветки не открывают ряд', () => {
    const s = invest(hero(TALENT_FIRST_LEVEL + 20), HIDE.id, HIDE.maxRank)
    expect(spentInBranch(s.talents, 'endurance')).toBe(HIDE.maxRank)
    expect(spentInBranch(s.talents, 'fury')).toBe(0)
    expect(talentStatus(s, EYE)).toMatchObject({ canInvest: false, reason: 'branch-locked' })
  })

  it('несуществующий талант ничего не меняет', () => {
    const s = hero(TALENT_FIRST_LEVEL + 5)
    expect(investTalent(s, 'нет-такого-таланта')).toBe(s)
  })
})

describe('эффекты талантов', () => {
  it('модификаторы идут в конвейер статов и множатся на ранг', () => {
    const bare = hero(TALENT_FIRST_LEVEL + 20)
    const one = invest(bare, EDGE.id, 1)
    const three = invest(bare, EDGE.id, 3)
    const ratio = (s: GameState) => s.stats.attackPower.div(bare.stats.attackPower).toNumber()
    // +4% за ранг, аддитивно внутри ступени percent.
    expect(ratio(one)).toBeCloseTo(1.04, 9)
    expect(ratio(three)).toBeCloseTo(1.12, 9)
  })

  it('source модификатора — talent:<id>, как требует раскладка статов', () => {
    const mods = talentModifiers({ [EDGE.id]: 2 })
    expect(mods.length).toBeGreaterThan(0)
    expect(mods.every((m) => m.source === `talent:${EDGE.id}`)).toBe(true)
    expect(mods[0].value.eq(new Decimal(0.04).times(2))).toBe(true)
  })

  it('талант второй ветки поднимает запас здоровья', () => {
    const bare = hero(TALENT_FIRST_LEVEL + 20)
    const tanky = invest(bare, HIDE.id, HIDE.maxRank)
    expect(tanky.stats.maxHp.gt(bare.stats.maxHp)).toBe(true)
  })

  it('флаг поднимается с первого ранга и не раньше', () => {
    const s = hero(TALENT_FIRST_LEVEL + 20)
    expect(talentFlags(s.talents).size).toBe(0)
    expect(talentFlags(fillBranch(s, 'fury').talents).has('quick-strike-bleeds')).toBe(true)
  })

  it('«Рваный выпад» учит Скорый выпад накладывать урон по времени', () => {
    const base = hero(TALENT_FIRST_LEVEL + 20, {
      currentMana: new Decimal(500),
      abilitySettings: manualOnlySettings(),
    })
    // Без таланта у Скорого выпада своего эффекта нет.
    const plain = useAbility(base, 'quick-strike', () => 1, () => {})
    expect(plain.activeEffects).toEqual([])

    const talented = fillBranch(base, 'fury')
    const bleeding = useAbility(talented, 'quick-strike', () => 1, () => {})
    expect(bleeding.activeEffects).toHaveLength(1)
    expect(bleeding.activeEffects[0].abilityId).toBe('quick-strike')
    expect(bleeding.activeEffects[0].damagePerTick.gt(0)).toBe(true)
  })

  it('«Скорое возвращение» вдвое сокращает простой после смерти', () => {
    const s = hero(TALENT_FIRST_LEVEL + 20)
    expect(reviveMultiplier(s.talents)).toBe(1)
    const swift = fillBranch(s, 'endurance')
    expect(reviveMultiplier(swift.talents)).toBe(0.5)

    // Проверяем на живом тике: герой с нулевым HP уходит в простой.
    // Порог привала снят намеренно — тест про воскрешение, а с порогом герой
    // ушёл бы отдыхать и до смерти не дожил.
    // statsDirty обязателен: порог привала входит в конвейер базой стата
    // restThreshold, и без пересчёта герой ушёл бы отдыхать по старому порогу.
    const dying: GameState = ensureStats({
      ...swift,
      restHpThreshold: 0,
      restResourceThreshold: 0,
      statsDirty: true,
      currentHp: new Decimal(0.01),
      monster: { ...swift.monster, damageMin: new Decimal(1e6), damageMax: new Decimal(1e6) },
    })
    let dead = dying
    for (let i = 0; i < 40 && dead.heroState !== 'dead'; i++) {
      dead = tick(dead, STEP_MS, () => 1, () => {})
    }
    expect(dead.heroState).toBe('dead')
    expect(dead.reviveMsLeft).toBeLessThanOrEqual(REVIVE_DELAY_MS * 0.5)
    expect(dead.reviveMsLeft).toBeGreaterThan(REVIVE_DELAY_MS * 0.4)
  })
})

describe('сброс за золото', () => {
  const rich = (patch: Partial<GameState> = {}) =>
    hero(TALENT_FIRST_LEVEL + 20, { gold: new Decimal(1e9), ...patch })

  it('цена первого сброса — базовая, дальше растёт', () => {
    const s = rich()
    expect(resetCost(s).eq(TALENT_RESET_BASE_COST)).toBe(true)
    expect(resetCost({ ...s, talentResets: 1 }).eq(
      TALENT_RESET_BASE_COST.times(TALENT_RESET_COST_GROWTH),
    )).toBe(true)
    expect(resetCost({ ...s, talentResets: 3 }).eq(
      TALENT_RESET_BASE_COST.times(TALENT_RESET_COST_GROWTH.pow(3)),
    )).toBe(true)
  })

  it('сброс обнуляет ранги, списывает золото и растит счётчик', () => {
    const invested = invest(rich(), EDGE.id, 3)
    const before = invested.gold
    const after = resetTalents(invested)
    expect(spentPoints(after.talents)).toBe(0)
    expect(availablePoints(after)).toBe(earnedPoints(after.level))
    expect(before.minus(after.gold).eq(resetCost(invested))).toBe(true)
    expect(after.talentResets).toBe(1)
    // Второй сброс дороже первого.
    expect(resetCost(after).gt(resetCost(invested))).toBe(true)
  })

  it('сбрасывать нечего или нечем — состояние не меняется', () => {
    const nothingSpent = rich()
    expect(canResetTalents(nothingSpent)).toBe(false)
    expect(resetTalents(nothingSpent)).toBe(nothingSpent)

    const poor = invest(hero(TALENT_FIRST_LEVEL + 20, { gold: new Decimal(0) }), EDGE.id, 1)
    expect(canResetTalents(poor)).toBe(false)
    expect(resetTalents(poor)).toBe(poor)
  })

  it('после сброса статы возвращаются к исходным', () => {
    const bare = rich()
    const invested = invest(bare, EDGE.id, 5)
    expect(invested.stats.attackPower.gt(bare.stats.attackPower)).toBe(true)
    const after = resetTalents(invested)
    expect(after.stats.attackPower.eq(bare.stats.attackPower)).toBe(true)
  })
})

describe('порядок причин отказа', () => {
  it('закрытая ветка объясняется раньше нехватки очков', () => {
    // Очков нет И ветка закрыта — игроку важнее узнать про ветку.
    const s = hero(TALENT_FIRST_LEVEL - 1)
    expect(talentStatus(s, EYE as TalentDef).reason).toBe('branch-locked')
  })

  it('потолок ранга объясняется раньше нехватки очков', () => {
    const s = invest(hero(TALENT_FIRST_LEVEL + 4), EDGE.id, 5)
    expect(availablePoints(s)).toBe(0)
    expect(talentStatus(s, EDGE).reason).toBe('max-rank')
  })
})

describe('ускорение: талант и предмет неразличимы', () => {
  // Правило: талант на скорость выдаёт модификатор haste, и НИКОГДА — плоскую
  // прибавку к weaponSpeed. Иначе один талант увёл бы скорость оружия в ноль
  // или в минус, а swingTime = weaponSpeed / (1 + haste) — в бесконечность.
  // Ускорение в долях: 0.1 — это «+10% скорости», а не «+10% от haste»
  // (haste стартует с нуля, и процентный модификатор от нуля даст ноль).
  const weapon = WEAPONS[2] // Крушитель, 3.4 c — на медленном разница виднее
  const weaponBase: StatModifier[] = [
    { stat: 'weaponSpeed', kind: 'base', value: weapon.weaponSpeed, source: 'equipment:mainHand' },
  ]
  const hasteMod = (source: string): StatModifier => ({
    stat: 'haste',
    kind: 'flat',
    value: new Decimal(0.1),
    source,
  })

  it('талант на +10% haste даёт ровно тот же swingTime, что и предмет на +10% haste', () => {
    // Оба модификатора отличаются ТОЛЬКО источником: конвейер про источник не
    // знает, поэтому и результат обязан быть побитово одинаковым.
    const fromTalent = applyModifiers([...weaponBase, hasteMod('talent:test-haste')])
    const fromItem = applyModifiers([...weaponBase, hasteMod('equipment:trinket')])
    expect(fromTalent.swingTime).toBe(fromItem.swingTime)
    expect(fromTalent.haste).toBe(0.1)
    expect(fromTalent.swingTime).toBeCloseTo(3.4 / 1.1, 12)
  })

  it('ускорение складывается аддитивно и не может обнулить время замаха', () => {
    const both = applyModifiers([
      ...weaponBase,
      hasteMod('talent:test-haste'),
      hasteMod('equipment:trinket'),
    ])
    expect(both.haste).toBeCloseTo(0.2, 12)
    expect(both.swingTime).toBeCloseTo(3.4 / 1.2, 12)
    // Сколько бы ускорения ни навесили, замах остаётся положительным.
    const absurd = applyModifiers([
      ...weaponBase,
      { stat: 'haste', kind: 'flat', value: new Decimal(1000), source: 'talent:test-haste' },
    ])
    expect(absurd.swingTime).toBeGreaterThan(0)
  })

  it('ни один талант дерева не трогает weaponSpeed', () => {
    // Защита правила на данных: талант может ускорять героя только через haste.
    for (const talent of TALENTS) {
      const mods = talentModifiers({ [talent.id]: talent.maxRank })
      expect(mods.filter((m) => m.stat === 'weaponSpeed')).toEqual([])
    }
  })
})
