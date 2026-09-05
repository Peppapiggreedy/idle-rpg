import { describe, expect, it } from 'vitest'
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createInitialState, manualOnlySettings, tick, type GameState } from './tick'
import { applyModifiers, ensureStats, type StatModifier } from './stats'
import {
  availablePoints,
  canResetTalents,
  resetStatus,
  earnedPoints,
  heroBranches,
  heroTalents,
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
import {
  ABILITY_BY_ID,
  abilityStatus,
  chargesLeft,
  consumeQueuedAbility,
  maxCharges,
  useAbility,
} from './abilities'
import { WEAPONS } from '../data/items'
import { CLASSES, classById } from '../data/classes'
import {
  BRANCHES,
  BRANCH_DEPTH,
  branchCapacity,
  capacityAbove,
  BRANCH_ROWS,
  BRANCH_ROW_STEP,
  CONCEPT_ROWS,
  TALENTS,
  TALENT_BY_ID,
  fillBranchRanks,
  talentsInBranch,
  type BranchId,
} from '../data/talents'
import {
  LEVEL_CAP,
  REVIVE_DELAY_MS,
  TALENT_FIRST_LEVEL,
  TALENT_RESET_BASE_COST,
  TALENT_RESET_COST_GROWTH,
} from '../data/balance'

// Дерево у каждого класса своё, поэтому опорные таланты берутся ПО КЛАССУ,
// а не по общему списку: страж не видит веток изувера и наоборот.
const WARDEN = classById('warden')
const WRATH: BranchId = 'warden-wrath'
const BULWARK: BranchId = 'warden-bulwark'
const EDGE = TALENT_BY_ID['wrath-honed-edge'] // Гнев, ряд 1
const EYE = TALENT_BY_ID['wrath-keen-eye'] // Гнев, ряд 2, нужно 5 очков в ветке
const HIDE = TALENT_BY_ID['bulwark-thick-hide'] // Оплот, ряд 1

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
 * Доводит ветку до КОНКРЕТНОГО этажа: вкладывает ровно столько, сколько этот
 * этаж требует, и берёт сам талант. Заполнять ветку подряд для этого нельзя —
 * этажи требуют по 5 очков, а вмещают по 6, и «21-е очко» при заполнении
 * подряд уходит в четвёртый этаж, а не в пятый.
 */
function reachRow(state: GameState, branch: BranchId, row: number): GameState {
  const talents = talentsInBranch(branch)
  const target = talents[row - 1]
  let next = state
  let spent = 0
  for (const talent of talents.slice(0, row - 1)) {
    const take = Math.min(talent.maxRank, target.requiredPointsInBranch - spent)
    if (take <= 0) break
    next = invest(next, talent.id, take)
    spent += take
  }
  return invest(next, target.id, 1)
}

/**
 * Вкладывает ветку до нужной глубины, по рядам сверху вниз. Списком id это
 * делать нельзя: ветки растут, и тест ломался бы от каждого нового таланта.
 */
function fillBranch(state: GameState, branch: BranchId, points = 1000): GameState {
  let next = state
  let left = points
  for (const talent of talentsInBranch(branch)) {
    const take = Math.min(left, talent.maxRank)
    next = invest(next, talent.id, take)
    left -= take
    if (left <= 0) break
  }
  return next
}

describe('данные дерева', () => {
  it('шесть веток — по три на класс, и ни одной общей', () => {
    // Ветка — это СТИЛЬ РОСТА конкретного класса, а не три способа поднять
    // один и тот же урон. У каждого класса свои урон, живучесть, автономность.
    expect(BRANCHES).toHaveLength(CLASSES.length * 3)
    for (const cls of CLASSES) {
      const own = BRANCHES.filter((b) => b.classId === cls.id)
      expect(own.map((b) => b.style), cls.id).toEqual(['damage', 'survival', 'autonomy'])
      // ClassDef перечисляет ровно свои ветки и в том же порядке.
      expect(cls.branchIds).toEqual(own.map((b) => b.id))
    }
  })

  // ГЛУБИНА И ЁМКОСТЬ — РАЗНЫЕ ВЕЛИЧИНЫ, И У КАЖДОЙ СВОЁ ИМЯ.
  //
  // Пока на этаже стоял один талант, они почти совпадали (60 и 61) и жили
  // одной константой. С двумя-тремя талантами на этаже ёмкость уходит вдвое
  // выше глубины, и всякое место, где смыслы перепутаны, ломается ТИХО.
  it('глубина ветки — 60 очков и от наполнения не зависит', () => {
    // Глубина задана ФОРМОЙ: тринадцатый этаж требует 5 × 12.
    expect(BRANCH_DEPTH).toBe(60)
    expect(BRANCH_DEPTH).toBe((BRANCH_ROWS - 1) * BRANCH_ROW_STEP)
    for (const branch of BRANCHES) {
      const talents = talentsInBranch(branch.id)
      const lastRow = Math.max(...talents.map((t) => t.row))
      expect(lastRow, branch.id).toBe(BRANCH_ROWS)
      const capstones = talents.filter((t) => t.row === BRANCH_ROWS)
      for (const c of capstones) expect(c.requiredPointsInBranch, c.id).toBe(BRANCH_DEPTH)
    }
  })

  it('ёмкость ветки — сумма рангов, и она НЕ равна глубине', () => {
    for (const branch of BRANCHES) {
      const talents = talentsInBranch(branch.id)
      const sum = talents.reduce((n, t) => n + t.maxRank, 0)
      expect(branchCapacity(branch.id), branch.id).toBe(sum)
      // Ёмкость обязана быть НЕ МЕНЬШЕ глубины, иначе до венца не добраться.
      expect(branchCapacity(branch.id), branch.id).toBeGreaterThanOrEqual(BRANCH_DEPTH)
    }
  })

  it('каждый этаж достижим: порог не больше того, что помещается выше', () => {
    // Настоящий инвариант формы. Раньше его держала таблица BRANCH_RANKS —
    // но таблица знала ранги ПО ЭТАЖУ, а с альтернативами ранг принадлежит
    // таланту, и проверять надо ёмкость этажей выше, а не строку таблицы.
    for (const branch of BRANCHES) {
      for (const talent of talentsInBranch(branch.id)) {
        expect(
          talent.requiredPointsInBranch,
          `${talent.id}: порог выше того, что помещается над ним`,
        ).toBeLessThanOrEqual(capacityAbove(branch.id, talent.row))
      }
    }
  })

  it('этажи идут подряд с первого, требование растёт шагом', () => {
    for (const branch of BRANCHES) {
      const talents = talentsInBranch(branch.id)
      const rows = [...new Set(talents.map((t) => t.row))].sort((a, b) => a - b)
      expect(rows, branch.id).toEqual(Array.from({ length: BRANCH_ROWS }, (_, i) => i + 1))
      for (const talent of talents) {
        expect(talent.requiredPointsInBranch, talent.id).toBe((talent.row - 1) * BRANCH_ROW_STEP)
      }
    }
  })

  it('концептуальные таланты стоят на своих этажах и все — флаги', () => {
    // Три «поворота» на ветку, и каждый в один ранг: талант либо взят, либо
    // нет. Тратить на него шесть очков значило бы размазывать поворот.
    for (const branch of BRANCHES) {
      const talents = talentsInBranch(branch.id)
      for (const talent of talents) {
        const concept = CONCEPT_ROWS.includes(talent.row)
        expect(talent.effect.kind === 'flag', `${talent.id} на этаже ${talent.row}`).toBe(concept)
        if (concept) expect(talent.maxRank, talent.id).toBe(1)
      }
    }
  })

  it('у каждого класса свой набор флагов, и стили совпадают', () => {
    // Два класса растут по-разному, но проверяются ОДНИМ набором поворотов:
    // ни одного «если класс такой-то» ни в данных, ни в логике.
    const flagsOf = (classId: string) =>
      BRANCHES.filter((b) => b.classId === classId).map((b) =>
        talentsInBranch(b.id)
          .filter((t) => t.effect.kind === 'flag')
          .map((t) => (t.effect.kind === 'flag' ? t.effect.flag : ''))
          .join(','),
      )
    expect(flagsOf('warden')).toEqual(flagsOf('reaver'))
  })

  it('первый ряд открыт сразу, у каждого таланта есть эффект', () => {
    for (const branch of BRANCHES) {
      expect(talentsInBranch(branch.id)[0].requiredPointsInBranch).toBe(0)
    }
    for (const talent of TALENTS) {
      expect(talent.maxRank).toBeGreaterThan(0)
      if (talent.effect.kind === 'modifiers') expect(talent.effect.mods.length).toBeGreaterThan(0)
      else if (talent.effect.kind === 'ability') expect(talent.effect.tune.length).toBeGreaterThan(0)
      else expect(talent.effect.flag).toBeTruthy()
    }
  })

  it('требование этажа достижимо тем, что лежит выше', () => {
    for (const branch of BRANCHES) {
      let reachable = 0
      for (const talent of talentsInBranch(branch.id)) {
        expect(talent.requiredPointsInBranch, talent.id).toBeLessThanOrEqual(reachable)
        reachable += talent.maxRank
      }
    }
  })
})

describe('дерево привязано к классу', () => {
  it('герой видит ровно три свои ветки и 39 своих талантов', () => {
    const warden = hero(TALENT_FIRST_LEVEL)
    expect(heroBranches(warden).map((b) => b.id)).toEqual(WARDEN.branchIds)
    expect(heroTalents(warden)).toHaveLength(3 * BRANCH_ROWS)
    expect(heroTalents(warden).every((t) => WARDEN.branchIds.includes(t.branch))).toBe(true)
  })

  it('в ветку чужого класса очко не вложить, и статов она не даёт', () => {
    // Это защита от правленого руками сейва: в своём дереве чужих веток нет.
    const warden = hero(TALENT_FIRST_LEVEL + 20)
    const alien = talentsInBranch('reaver-carnage')[0]
    expect(talentStatus(warden, alien)).toMatchObject({
      canInvest: false,
      reason: 'other-class',
    })
    expect(investTalent(warden, alien.id)).toBe(warden)
    // И даже если ранг всё-таки попал в состояние, конвейер его игнорирует.
    expect(talentModifiers({ [alien.id]: alien.maxRank }, 'warden')).toEqual([])
    expect(talentModifiers({ [alien.id]: alien.maxRank }, 'reaver').length).toBeGreaterThan(0)
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

  it('за весь путь хватает на одну ветку целиком и на заход во вторую', () => {
    // Это и есть цена выбора: ОДНА ветка закрывается целиком, на вторую
    // остаётся заход до середины, а на третью не остаётся ничего. Хватило бы
    // на две ветки — капстоуны перестали бы быть выбором.
    // МЕРИТСЯ ЁМКОСТЬ, А НЕ ГЛУБИНА: «ветка целиком» — это все её ранги,
    // а глубина лишь говорит, сколько нужно ДО венца. Раньше числа почти
    // совпадали и жили одной константой; теперь их два.
    const capacity = branchCapacity(WRATH)
    const total = earnedPoints(new Decimal(LEVEL_CAP))
    expect(total).toBeGreaterThan(BRANCH_DEPTH)
    expect(total).toBeLessThan(capacity * 2)

    const capped = hero(LEVEL_CAP)
    const full = fillBranch(capped, WRATH)
    expect(spentInBranch(full.talents, WRATH)).toBe(Math.min(capacity, total))
    // И капстоун взят: последний этаж — это то, ради чего ветка добивается.
    const capstone = talentsInBranch(WRATH).find((t) => t.row === BRANCH_ROWS)!
    expect(rankOf(full.talents, capstone.id)).toBe(1)

    // Остаток уходит во вторую ветку — и до её капстоуна не дотягивает.
    const both = fillBranch(full, BULWARK, availablePoints(full))
    expect(availablePoints(both)).toBe(0)
    expect(spentInBranch(both.talents, BULWARK)).toBe(total - Math.min(capacity, total))
    const secondCapstone = talentsInBranch(BULWARK).find((t) => t.row === BRANCH_ROWS)!
    expect(rankOf(both.talents, secondCapstone.id)).toBe(0)
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
    expect(spentInBranch(opened.talents, WRATH)).toBe(EYE.requiredPointsInBranch)
    expect(talentStatus(opened, EYE).canInvest).toBe(true)
  })

  it('очки чужой ветки не открывают ряд', () => {
    const s = invest(hero(TALENT_FIRST_LEVEL + 20), HIDE.id, HIDE.maxRank)
    expect(spentInBranch(s.talents, BULWARK)).toBe(HIDE.maxRank)
    expect(spentInBranch(s.talents, WRATH)).toBe(0)
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
    const step = one.stats.attackPower.div(bare.stats.attackPower).minus(1).toNumber()
    expect(step).toBeGreaterThan(0)
    // Аддитивно внутри ступени percent: три ранга — ровно три шага.
    expect(ratio(three)).toBeCloseTo(1 + step * 3, 9)
  })

  it('source модификатора — talent:<id>, как требует раскладка статов', () => {
    const mods = talentModifiers({ [EDGE.id]: 2 }, 'warden')
    expect(mods.length).toBeGreaterThan(0)
    expect(mods.every((m) => m.source === `talent:${EDGE.id}`)).toBe(true)
  })

  it('талант второй ветки поднимает запас здоровья', () => {
    const bare = hero(TALENT_FIRST_LEVEL + 20)
    const tanky = invest(bare, HIDE.id, HIDE.maxRank)
    expect(tanky.stats.maxHp.gt(bare.stats.maxHp)).toBe(true)
  })

  it('флаг поднимается с первого ранга и не раньше', () => {
    const s = hero(LEVEL_CAP)
    expect(talentFlags(s.talents).size).toBe(0)
    // Первый поворот — пятый этаж, и он требует 20 очков в ветке.
    const before = fillBranch(s, WRATH, 20)
    expect(talentFlags(before.talents).size).toBe(0)
    const after = reachRow(s, WRATH, CONCEPT_ROWS[0])
    expect(talentFlags(after.talents).has('ability-learns-effect')).toBe(true)
  })

  it('первый поворот учит умение накладывать урон по времени', () => {
    const base = hero(LEVEL_CAP, {
      currentMana: new Decimal(500),
      abilitySettings: manualOnlySettings(),
    })
    // Без таланта у Скорого выпада своего эффекта нет.
    const plain = useAbility(base, 'quick-strike', () => 1, () => {})
    expect(plain.activeEffects).toEqual([])

    const talented = reachRow(base, WRATH, CONCEPT_ROWS[0])
    const bleeding = useAbility(talented, 'quick-strike', () => 1, () => {})
    expect(bleeding.activeEffects).toHaveLength(1)
    expect(bleeding.activeEffects[0].abilityId).toBe('quick-strike')
    expect(bleeding.activeEffects[0].damagePerTick.gt(0)).toBe(true)
  })

  it('второй поворот ветки живучести сокращает простой после смерти', () => {
    const s = hero(LEVEL_CAP)
    expect(reviveMultiplier(s.talents)).toBe(1)
    const swift = reachRow(s, BULWARK, CONCEPT_ROWS[1])
    expect(reviveMultiplier(swift.talents)).toBeLessThan(1)

    // Проверяем на живом тике: герой с нулевым HP уходит в простой.
    // Порог привала снят намеренно — тест про воскрешение, а с порогом герой
    // ушёл бы отдыхать и до смерти не дожил. statsDirty обязателен: порог
    // входит в конвейер базой стата restThreshold.
    const dying: GameState = ensureStats({
      ...swift,
      restHpThreshold: 0,
      statsDirty: true,
      currentHp: new Decimal(0.01),
      monster: { ...swift.monster, damageMin: new Decimal(1e9), damageMax: new Decimal(1e9) },
    })
    let dead = dying
    for (let i = 0; i < 40 && dead.heroState !== 'dead'; i++) {
      dead = tick(dead, STEP_MS, () => 1, () => {})
    }
    expect(dead.heroState).toBe('dead')
    const expected = REVIVE_DELAY_MS * reviveMultiplier(swift.talents)
    expect(dead.reviveMsLeft).toBeLessThanOrEqual(expected)
    expect(dead.reviveMsLeft).toBeGreaterThan(expected * 0.8)
    // Лог называет УРЕЗАННЫЙ срок, а не константу: иначе талант куплен,
    // а строка в логе по-прежнему обещает тридцать секунд.
    expect(dead.combatLog).toContainEqual({ type: 'death', reviveMs: expected })
  })

  it('капстоун ветки урона даёт умению второй заряд', () => {
    // ДВА удара подряд, пока откат первого ещё идёт: это и есть «заряды
    // копятся по одному», а не «кулдаун снят». Умение стоит в очереди на
    // замах, поэтому проверяется через consumeQueuedAbility — тем же путём,
    // которым его применяет бой.
    const tough = hero(LEVEL_CAP)
    // Моб с огромным запасом: на сотом уровне обычный падает с первого удара,
    // и второй заряд было бы некуда девать.
    const base: GameState = {
      ...tough,
      currentMana: new Decimal(1e6),
      abilitySettings: manualOnlySettings(),
      monster: { ...tough.monster, maxHp: new Decimal(1e12), currentHp: new Decimal(1e12) },
    }
    const full = reachRow(base, WRATH, CONCEPT_ROWS[2])
    const charged = TALENT_BY_ID['wrath-second-swing']
    expect(rankOf(full.talents, charged.id)).toBe(1)
    const ability = ABILITY_BY_ID['shattering-blow']
    expect(maxCharges(full, ability)).toBe(2)

    const queued = useAbility(full, ability.id, () => 1, () => {})
    expect(queued.queuedAbilityId).toBe(ability.id)
    const once = consumeQueuedAbility(queued, () => 1, () => {})!
    expect(once).not.toBeNull()
    expect(once.abilityCooldownsMs[ability.id]).toBeGreaterThan(0)
    expect(chargesLeft(once, ability)).toBe(1)

    // Откат идёт, а умение всё равно доступно: остался второй заряд.
    expect(abilityStatus(once, ability).usable).toBe(true)
    const queuedAgain = useAbility(once, ability.id, () => 1, () => {})
    const twice = consumeQueuedAbility(queuedAgain, () => 1, () => {})!
    expect(twice.monster.currentHp.lt(once.monster.currentHp)).toBe(true)
    expect(chargesLeft(twice, ability)).toBe(0)
    // А третьего нет: зарядов было два.
    expect(abilityStatus(twice, ability)).toMatchObject({ usable: false, reason: 'cooldown' })
  })
})

describe('fillBranchRanks — заполнение ветки для прогонов', () => {
  it('раскладывает очки по этажам сверху вниз и не превышает потолок', () => {
    const ranks = fillBranchRanks(WRATH, 21)
    const total = Object.values(ranks).reduce((n, r) => n + r, 0)
    expect(total).toBe(21)
    for (const [id, rank] of Object.entries(ranks)) {
      expect(rank, id).toBeLessThanOrEqual(TALENT_BY_ID[id].maxRank)
    }
    // Потолок заполнения — ЁМКОСТЬ ветки: больше в неё не влезает.
    expect(Object.values(fillBranchRanks(WRATH, 1000)).reduce((n, r) => n + r, 0)).toBe(
      branchCapacity(WRATH),
    )
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
    expect(resetStatus(nothingSpent).reason).toBe('nothing-spent')
    expect(resetTalents(nothingSpent)).toBe(nothingSpent)

    const poor = invest(hero(TALENT_FIRST_LEVEL + 20, { gold: new Decimal(0) }), EDGE.id, 1)
    expect(canResetTalents(poor)).toBe(false)
    expect(resetStatus(poor).reason).toBe('gold')
    expect(resetTalents(poor)).toBe(poor)

    // Есть что и чем — кода отказа нет, цена та же, что списывает сброс.
    const ok = resetStatus(invest(rich(), EDGE.id, 1))
    expect(ok).toMatchObject({ canReset: true, reason: null })
    expect(ok.cost.eq(resetCost(rich()))).toBe(true)
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
    expect(talentStatus(s, EYE).reason).toBe('branch-locked')
  })

  it('потолок ранга объясняется раньше нехватки очков', () => {
    const s = invest(hero(TALENT_FIRST_LEVEL + 5), EDGE.id, EDGE.maxRank)
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
      const branch = BRANCHES.find((b) => b.id === talent.branch)!
      const mods = talentModifiers({ [talent.id]: talent.maxRank }, branch.classId)
      expect(mods.filter((m) => m.stat === 'weaponSpeed')).toEqual([])
    }
  })
})
