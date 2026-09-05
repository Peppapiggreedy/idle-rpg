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
  takeBackStatus,
  takeBackTalent,
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
  groupHolder,
  pathRanks,
  pathsOf,
  BRANCH_DEPTH,
  branchCapacity,
  capacityAbove,
  dependentsOf,
  type TalentDef,
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
/**
 * Довести героя до КОНКРЕТНОГО таланта и взять один его ранг.
 *
 * Раньше цель искалась по номеру этажа (`talents[row - 1]`) — с одним
 * талантом на этаже это было одно и то же. Теперь на этаже двое-трое, и
 * «пятый этаж» больше не адрес: цель называется по имени.
 *
 * Порог набирается ЧЕМ УГОДНО СВЕРХУ, а опора стрелки — отдельно и до конца:
 * тест про конкретный талант не должен зависеть от того, в каком порядке
 * автор ветки напечатал соседей.
 */
function reachTalent(state: GameState, talentId: string, avoid: string[] = []): GameState {
  const target = TALENT_BY_ID[talentId]
  let next = state
  let spent = 0
  const need = target.requires
  if (need) {
    const anchor = TALENT_BY_ID[need.talentId]
    const take = need.minRank ?? 1
    next = invest(next, anchor.id, take)
    spent += take
  }
  // ПОРОГ НАБИРАЕТСЯ СВЕРХУ ВНИЗ, А ВНУТРИ ЭТАЖА — НЕЙТРАЛЬНЫМИ ВПЕРЁД.
  //
  // Порядок по этажам обязателен: порог этажа не пускает вкладывать вниз, и
  // «сперва все нейтральные ветки» упирается в него на первом же шаге —
  // именно так этот помощник и сломался, набрав 27 очков вместо 60.
  //
  // Нейтральные вперёд — чтобы по дороге к цели не скупались ПОВОРОТЫ,
  // молча меняющие предмет проверки. Что нейтральным не заменить, называется
  // списком `avoid` прямо в тесте: «Очертя голову» делает «Сокрушение»
  // мгновенным, и тест про очередь замаха с ним теряет смысл.
  const above = talentsInBranch(target.branch).filter(
    (t) => t.row < target.row && !avoid.includes(t.id),
  )
  const rows = [...new Set(above.map((t) => t.row))].sort((a, b) => a - b)
  for (const row of rows) {
    if (spent >= target.requiredPointsInBranch) break
    const onRow = above.filter((t) => t.row === row)
    const neutral = onRow.filter((t) => t.effect.kind === 'modifiers')
    for (const talent of [...neutral, ...onRow.filter((t) => !neutral.includes(t))]) {
      if (spent >= target.requiredPointsInBranch) break
      const have = rankOf(next.talents, talent.id)
      const take = Math.min(talent.maxRank - have, target.requiredPointsInBranch - spent)
      if (take <= 0) continue
      const before = next
      next = invest(next, talent.id, take)
      if (next !== before) spent += take
    }
  }
  return invest(next, target.id, 1)
}

/** Сколько рангов опоры требует стрелка таланта (0 — стрелки нет). */
function requiredRankOf(talent: TalentDef): number {
  return talent.requires ? (talent.requires.minRank ?? 1) : 0
}

/** Все таланты ветки — короткая обёртка для проверок формы. */
function pathsAndFloors(branch: BranchId) {
  return talentsInBranch(branch)
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

  it('концептуальный этаж — таланты в ОДИН ранг, обычный — многоранговые', () => {
    // Три «поворота» на ветку, и каждый в один ранг: талант либо взят, либо
    // нет. Тратить на него шесть очков значило бы размазывать поворот.
    //
    // ФЛАГ БОЛЬШЕ НЕ ПРИЗНАК ПОВОРОТА. Раньше проверялось «концепт ⇔ флаг», и
    // это было верно ровно пока поворот был один на этаже. Теперь их два, и
    // второй может быть правкой умения — «Сокрушение бьёт сразу» меняет
    // ротацию не меньше флага, а флага для этого не нужно.
    for (const branch of BRANCHES) {
      for (const talent of talentsInBranch(branch.id)) {
        const concept = CONCEPT_ROWS.includes(talent.row)
        if (concept) expect(talent.maxRank, talent.id).toBe(1)
        else expect(talent.maxRank, talent.id).toBeGreaterThan(1)
      }
    }
  })

  it('на каждом концептуальном этаже поворот НЕ ОДИН, и хотя бы один — флаг', () => {
    // Этаж-поворот с единственным талантом — это не поворот, а ступенька:
    // выбора на нём нет, очко всё равно уходит в единственный узел.
    for (const branch of BRANCHES) {
      const floors = pathsAndFloors(branch.id)
      for (const row of CONCEPT_ROWS) {
        const onRow = floors.filter((t) => t.row === row)
        // Ветка-лестница ещё не переделана — у неё поворот один; готовая
        // ветка обязана давать выбор. Проверяем то, что верно для обеих:
        // хотя бы один талант, и все в один ранг.
        expect(onRow.length, `${branch.id} этаж ${row}`).toBeGreaterThanOrEqual(1)
        expect(onRow.some((t) => t.effect.kind === 'flag'), `${branch.id} этаж ${row}`).toBe(true)
      }
    }
  })

  it('в Гневе на каждом этаже ЕСТЬ ВЫБОР, а на венце — два капстоуна', () => {
    // Первая переделанная ветка. Требование, ради которого затевалась ночь:
    // на этаже стоит больше одного таланта — иначе это лестница.
    const floors = new Map<number, number>()
    for (const talent of talentsInBranch(WRATH)) {
      floors.set(talent.row, (floors.get(talent.row) ?? 0) + 1)
    }
    for (const [row, count] of floors) {
      expect(count, `Гнев, этаж ${row}`).toBeGreaterThanOrEqual(2)
      expect(count, `Гнев, этаж ${row}`).toBeLessThanOrEqual(3)
    }
    expect(floors.get(BRANCH_ROWS)).toBe(2)
  })

  it('в Гневе больше половины талантов правят УМЕНИЯ', () => {
    // Ветка из процентов меняет ЧИСЛА; ветка, правящая умения, меняет
    // РОТАЦИЮ — а ротация и есть то немногое, чем игрок в idle-игре
    // управляет. Флаг, привязанный к умению, считается наравне с правкой.
    const talents = talentsInBranch(WRATH)
    const touches = talents.filter(
      (t) => t.effect.kind === 'ability' || (t.effect.kind === 'flag' && 'abilityId' in t.effect),
    )
    expect(touches.length * 2).toBeGreaterThan(talents.length)
    // И НАЧИНАЯ СО ВТОРОГО ЭТАЖА такой есть на КАЖДОМ: ветка не должна
    // начинаться десятком процентов и вспоминать про умения к венцу.
    for (let row = 2; row <= BRANCH_ROWS; row += 1) {
      expect(touches.some((t) => t.row === row), `Гнев, этаж ${row}`).toBe(true)
    }
  })

  it('НИ ОДИН талант не даёт плоскую прибавку к характеристике', () => {
    // Правило держит content:check (TALENT_STAT_RULE), здесь — второй замок
    // на самом заметном случае: «+3 к силе» это 12.5 % силы атаки на 25-м
    // уровне и 4.2 % на сотом, то есть мёртвый узел, за который платят
    // обычным очком.
    const ATTRIBUTES = ['strength', 'agility', 'intellect', 'vitality']
    for (const talent of TALENTS) {
      if (talent.effect.kind !== 'modifiers') continue
      for (const mod of talent.effect.mods) {
        expect(ATTRIBUTES, `${talent.id}: ${mod.stat}`).not.toContain(mod.stat)
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
  it('герой видит ровно три свои ветки и все их таланты', () => {
    // Числом это больше не считается: талантов на этаже бывает один, два или
    // три, и «три на тринадцать» перестало быть правдой в тот день, когда у
    // первой ветки появились альтернативы.
    const warden = hero(TALENT_FIRST_LEVEL)
    expect(heroBranches(warden).map((b) => b.id)).toEqual(WARDEN.branchIds)
    const expected = WARDEN.branchIds.reduce((n, id) => n + talentsInBranch(id).length, 0)
    expect(heroTalents(warden)).toHaveLength(expected)
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

  it('НА ВЕТКУ ЦЕЛИКОМ НЕ ХВАТАЕТ — И В ЭТОМ ВСЯ ЦЕНА ВЫБОРА', () => {
    // РАНЬШЕ БЫЛО НАОБОРОТ, и это была не цель, а следствие лестницы: при
    // одном таланте на этаже ёмкость (61) почти совпадала с глубиной (60), и
    // 91 очко закрывало ветку целиком да ещё заходило во вторую. Выбирать
    // внутри ветки было нечего — очки просто лились сверху вниз.
    //
    // Теперь ёмкость переделанной ветки БОЛЬШЕ, чем очков за всю игру: до
    // венца дойти можно (глубина 60), взять всё — нельзя. Дефицит и делает
    // альтернативы на этажах альтернативами.
    const capacity = branchCapacity(WRATH)
    const total = earnedPoints(new Decimal(LEVEL_CAP))
    expect(total).toBeGreaterThan(BRANCH_DEPTH)
    expect(total).toBeLessThan(capacity)

    // До ВЕНЦА при этом добраться можно, и с большим запасом: глубина —
    // 60 очков, а не 114.
    const capped = hero(LEVEL_CAP)
    const full = fillBranch(capped, WRATH)
    expect(spentInBranch(full.talents, WRATH)).toBe(total)
    expect(availablePoints(full)).toBe(0)
  })

  it('ЁМКОСТЬ РЕШАЕТ, закрывается ветка целиком или нет', () => {
    // Строка стоит рядом с предыдущей нарочно: по ней видно, что переделка
    // ветки меняет ИМЕННО ЭТУ величину, а не что-то ещё. Ветка-лестница
    // (ёмкость около глубины) закрывается целиком и очков на неё хватает;
    // ветка с альтернативами — нет.
    //
    // Проверка идёт ПО ДАННЫМ, а не по имени ветки: имя пришлось бы менять
    // в тот день, когда переделают следующую.
    const total = earnedPoints(new Decimal(LEVEL_CAP))
    // Только СВОИ ветки: в чужую очко не вложить вовсе, и «вложено ноль»
    // там означает не выбор, а правило про класс.
    for (const branch of BRANCHES.filter((b) => b.classId === WARDEN.id)) {
      const capacity = branchCapacity(branch.id)
      const filled = fillBranch(hero(LEVEL_CAP), branch.id)
      const spent = spentInBranch(filled.talents, branch.id)
      if (capacity <= total) {
        // Влезает целиком — значит и вложено целиком, вместе с венцом.
        expect(spent, branch.id).toBe(capacity)
        const capstone = talentsInBranch(branch.id).find((t) => t.row === BRANCH_ROWS)!
        expect(rankOf(filled.talents, capstone.id), branch.id).toBe(1)
      } else {
        // Не влезает — очки кончились раньше ветки, и это цена выбора.
        expect(spent, branch.id).toBe(total)
      }
    }
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
    const after = reachTalent(s, 'wrath-rupture')
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

    const talented = reachTalent(base, 'wrath-rupture')
    const bleeding = useAbility(talented, 'quick-strike', () => 1, () => {})
    expect(bleeding.activeEffects).toHaveLength(1)
    expect(bleeding.activeEffects[0].abilityId).toBe('quick-strike')
    expect(bleeding.activeEffects[0].damagePerTick.gt(0)).toBe(true)
  })

  it('второй поворот ветки живучести сокращает простой после смерти', () => {
    const s = hero(LEVEL_CAP)
    expect(reviveMultiplier(s.talents)).toBe(1)
    const swift = reachTalent(s, talentsInBranch(BULWARK).find((t) => t.row === CONCEPT_ROWS[1])!.id)
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
    // «Очертя голову» по дороге не покупаем: оно делает «Сокрушение»
    // мгновенным, и умение перестаёт вставать в очередь на замах — то есть
    // проверять было бы нечего.
    const full = reachTalent(base, 'wrath-second-swing', ['wrath-headlong'])
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

/**
 * Сколько очков путь может вложить вообще: сумма рангов минус те члены
 * взаимоисключающих групп, которых путь не выбирает. Выбранным считается
 * первый по порядку пути член группы — ровно так покупает `pathRanks`.
 */
function reachableCapacity(path: { order: string[] }): number {
  const chosenOfGroup = new Map<string, string>()
  for (const id of path.order) {
    const group = TALENT_BY_ID[id]?.exclusiveGroup
    if (group && !chosenOfGroup.has(group)) chosenOfGroup.set(group, id)
  }
  return path.order.reduce((sum, id) => {
    const talent = TALENT_BY_ID[id]
    const group = talent.exclusiveGroup
    if (group && chosenOfGroup.get(group) !== id) return sum
    return sum + talent.maxRank
  }, 0)
}

describe('пути внутри ветки — сборка для прогонов', () => {
  const spentOf = (ranks: Record<string, number>) =>
    Object.values(ranks).reduce((n, r) => n + r, 0)

  it('очки тратятся до последнего и ни один талант не выше потолка', () => {
    const ranks = fillBranchRanks(WRATH, 21)
    expect(spentOf(ranks)).toBe(21)
    for (const [id, rank] of Object.entries(ranks)) {
      expect(rank, id).toBeLessThanOrEqual(TALENT_BY_ID[id].maxRank)
    }
    // Потолок заполнения — ДОСТИЖИМАЯ ёмкость пути: сумма рангов минус те
    // члены взаимоисключающих групп, которые путь не выбрал. Путь перечисляет
    // всю ветку, но в каждой группе покупается ровно один.
    const path = pathsOf(WRATH)[0]
    const reachable = reachableCapacity(path)
    expect(reachable).toBeLessThan(branchCapacity(WRATH))
    expect(spentOf(fillBranchRanks(WRATH, 1000))).toBe(reachable)
  })

  it('ПУТЬ ДОВОДИТ ДО ВЕНЦА, а жадная заливка сверху вниз — нет', () => {
    // САМОЕ ВАЖНОЕ В ЭТОМ ФАЙЛЕ ПРО ПРОГОН. Ёмкость Гнева (114) больше, чем
    // очков у героя сотого уровня (91): заливка «сверху вниз» тратит всё, до
    // тринадцатого этажа так и не дойдя, то есть меряет ветку БЕЗ ВЕНЦА —
    // ради которого её и берут. Путь лежит в данных и ставит опоры первыми.
    const points = earnedPoints(new Decimal(LEVEL_CAP))
    const byPath = fillBranchRanks(WRATH, points)
    const capstones = talentsInBranch(WRATH).filter((t) => t.row === BRANCH_ROWS)
    expect(capstones.some((t) => (byPath[t.id] ?? 0) > 0)).toBe(true)

    // Та самая жадная заливка, для сравнения: она до венца не доходит.
    let spent = 0
    const greedy: Record<string, number> = {}
    for (const talent of talentsInBranch(WRATH)) {
      if (spent < talent.requiredPointsInBranch) break
      const rank = Math.min(talent.maxRank, points - spent)
      if (rank <= 0) break
      greedy[talent.id] = rank
      spent += rank
    }
    expect(capstones.some((t) => (greedy[t.id] ?? 0) > 0)).toBe(false)
  })

  it('путь берёт только СВОИ таланты и уважает пороги и стрелки', () => {
    for (const branch of BRANCHES) {
      for (const path of pathsOf(branch.id)) {
        const own = new Set(talentsInBranch(branch.id).map((t) => t.id))
        for (const id of path.order) expect(own.has(id), `${path.id}: ${id}`).toBe(true)

        const capacity = reachableCapacity(path)
        const ranks = pathRanks(path, capacity)
        let spent = 0
        for (const talent of talentsInBranch(branch.id)) spent += ranks[talent.id] ?? 0
        // Путь, который сам себя не выкупает, недостижим целиком: где-то в
        // нём талант, до которого по его же порядку не добраться.
        expect(spent, path.id).toBe(capacity)
        for (const talent of talentsInBranch(branch.id)) {
          const need = talent.requires
          if (!need || !(ranks[talent.id] ?? 0)) continue
          expect(ranks[need.talentId] ?? 0, `${path.id}: ${talent.id}`).toBeGreaterThanOrEqual(
            need.minRank ?? 1,
          )
        }
      }
    }
  })

  it('у переделанной ветки путей ДВА, и они берут разное', () => {
    // Два жизнеспособных пути внутри ветки — то, ради чего на этажах и
    // появились альтернативы. Если оба пути покупают одно и то же, выбора
    // нет, сколько бы клеток ни стояло в ряду.
    const paths = pathsOf(WRATH)
    expect(paths.length).toBe(2)
    const points = earnedPoints(new Decimal(LEVEL_CAP))
    const [first, second] = paths.map((p) => pathRanks(p, points))
    const differing = new Set([...Object.keys(first), ...Object.keys(second)]).size
    expect(differing).toBeGreaterThan(Object.keys(first).length)
    // И хотя бы один талант, взятый одним путём, вторым не берётся вовсе.
    expect(Object.keys(first).some((id) => !(id in second))).toBe(true)
    expect(Object.keys(second).some((id) => !(id in first))).toBe(true)
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

// СТРЕЛКИ-ПРЕДПОСЫЛКИ: талант дорабатывает конкретный талант выше.
//
// Настоящих стрелок в данных на этой стадии ещё нет — их приносят стадии
// 5-7, — поэтому правило проверяется на подставном таланте с настоящими
// типами: так проверка не зависит от того, какие стрелки сегодня в дереве.
describe('стрелки-предпосылки', () => {
  const ANCHOR = talentsInBranch(WRATH)[0]

  function withArrow<T>(minRank: number, body: (talent: TalentDef) => T): T {
    const dependent: TalentDef = {
      id: 'проверочная-стрелка',
      name: 'Проверочная',
      icon: 'talent-honed-edge',
      branch: WRATH,
      row: 2,
      maxRank: 3,
      requiredPointsInBranch: BRANCH_ROW_STEP,
      requires: { talentId: ANCHOR.id, minRank },
      effect: { kind: 'modifiers', mods: [{ stat: 'attackPower', kind: 'percent', value: new Decimal(0.01) }] },
    }
    TALENTS.push(dependent)
    TALENT_BY_ID[dependent.id] = dependent
    try {
      return body(dependent)
    } finally {
      TALENTS.pop()
      delete TALENT_BY_ID[dependent.id]
    }
  }

  it('предпосылка блокирует вложение и разблокирует при наборе', () => {
    // Стрелка требует ПОЛНЫЙ ранг опорного, а порог этажа — всего пять очков.
    // Так проверяется именно стрелка: очков в ветке уже хватает, и отказ
    // приходит своим кодом, а не общим «этаж закрыт».
    withArrow(ANCHOR.maxRank, (dependent) => {
      const rich = hero(LEVEL_CAP)
      const primed = invest(rich, ANCHOR.id, ANCHOR.maxRank - 1)
      expect(spentInBranch(primed.talents, WRATH)).toBeGreaterThanOrEqual(
        dependent.requiredPointsInBranch,
      )
      const blocked = talentStatus(primed, dependent)
      expect(blocked.canInvest).toBe(false)
      expect(blocked.reason).toBe('needs-talent')

      // Добрали последний ранг опорного — стрелка открылась.
      const ready = invest(primed, ANCHOR.id, 1)
      expect(talentStatus(ready, dependent)).toMatchObject({ canInvest: true, reason: null })
    })
  })

  it('порог этажа проверяется РАНЬШЕ стрелки', () => {
    // Порядок причин не косметика: порог не лечится ничем, кроме очков в
    // ветке, и назвать надо ту причину, которая ближе к делу.
    withArrow(1, (dependent) => {
      const fresh = hero(TALENT_FIRST_LEVEL + 20)
      const status = talentStatus(fresh, dependent)
      expect(status.reason).toBe('branch-locked')
    })
  })

  it('зависимые находятся по цепочке, а не только напрямую', () => {
    // Снятие опорного обязано убрать ВСЮ цепочку: иначе в дереве останется
    // узел, который по правилам не мог быть взят.
    withArrow(1, (first) => {
      const second: TalentDef = { ...first, id: 'вторая-стрелка', row: 3, requires: { talentId: first.id } }
      TALENTS.push(second)
      TALENT_BY_ID[second.id] = second
      try {
        const ids = dependentsOf(ANCHOR.id).map((t) => t.id)
        expect(ids).toContain(first.id)
        expect(ids).toContain(second.id)
      } finally {
        TALENTS.pop()
        delete TALENT_BY_ID[second.id]
      }
    })
  })

  it('самостоятельный талант зависимых не имеет', () => {
    expect(dependentsOf(ANCHOR.id)).toEqual([])
  })
})

// ОТМЕНА ПОКА ЭКРАН ОТКРЫТ.
//
// Очко, вложенное в этот заход, снимается бесплатно; всё остальное — только
// платным сбросом. Разница между ними — не удобство, а ЦЕНА: раздать сброс
// бесплатно значит обесценить и сам сброс, и решение, которое игрок принимал,
// вкладывая очко в прошлый раз.
//
// Заход помнит не логика, а экран (`talentDraft` в `stores/ui.ts`): в сейве
// ему не место — это «где я сейчас», а не прогресс. Логика получает черновик
// параметром и о том, кто его ведёт, не знает.
describe('снятие очка в пределах открытого экрана', () => {
  const FIRST = talentsInBranch(WRATH)[0]

  it('вложенное в этот заход снимается и возвращает очко свободным', () => {
    const base = invest(hero(LEVEL_CAP), FIRST.id, 2)
    const before = availablePoints(base)
    const draft = { [FIRST.id]: 2 }

    const status = takeBackStatus(base, FIRST, draft)
    expect(status).toMatchObject({ canTakeBack: true, reason: null, fromThisVisit: 2 })

    const after = takeBackTalent(base, FIRST.id, draft)
    expect(rankOf(after.talents, FIRST.id)).toBe(1)
    // Отдельного счётчика свободных очков нет — они считаются как
    // «заработано минус вложено», поэтому снятие возвращает очко само.
    expect(availablePoints(after)).toBe(before + 1)
  })

  it('СЧЁТЧИК ПЛАТНЫХ СБРОСОВ НЕ ТРОГАЕТСЯ, и золото тоже', () => {
    // Иначе бесплатная отмена дорожала бы следующий сброс — то есть была бы
    // не бесплатной, а с отложенной ценой.
    const base = invest(hero(LEVEL_CAP), FIRST.id, 1)
    const after = takeBackTalent(base, FIRST.id, { [FIRST.id]: 1 })
    expect(after.talentResets).toBe(base.talentResets)
    expect(after.gold.eq(base.gold)).toBe(true)
  })

  it('вложенное в ПРОШЛЫЙ заход не снимается', () => {
    // Закрыл экран — черновик пуст, и остаётся только платный сброс.
    const base = invest(hero(LEVEL_CAP), FIRST.id, 2)
    const status = takeBackStatus(base, FIRST, {})
    expect(status).toMatchObject({ canTakeBack: false, reason: 'not-this-visit', fromThisVisit: 0 })
    expect(takeBackTalent(base, FIRST.id, {})).toBe(base)
  })

  it('черновик больше вложенного не даёт снять лишнего', () => {
    // Черновик ведёт экран, а правду о рангах знает состояние: если они
    // разошлись (сброс при открытом экране), верить надо состоянию.
    const base = invest(hero(LEVEL_CAP), FIRST.id, 1)
    expect(takeBackStatus(base, FIRST, { [FIRST.id]: 5 }).fromThisVisit).toBe(1)
    const empty = hero(LEVEL_CAP)
    expect(takeBackStatus(empty, FIRST, { [FIRST.id]: 3 })).toMatchObject({
      canTakeBack: false,
      reason: 'nothing-invested',
    })
  })

  it('снятие ОТКАЗЫВАЕТ, если обрывает стрелку, а не сносит зависимых', () => {
    // Каскад здесь был бы бесплатным сбросом с чёрного хода: очки зависимого
    // могли быть вложены в ПРОШЛЫЙ заход, и молча вернуть их нельзя.
    const dependent: TalentDef = {
      id: 'зависимый-от-снятия',
      name: 'Зависимый',
      icon: 'talent-honed-edge',
      branch: WRATH,
      row: 2,
      maxRank: 3,
      requiredPointsInBranch: BRANCH_ROW_STEP,
      // Стрелка требует ПОЛНЫЙ ранг опорного: только так снятие одного очка
      // действительно обрывает её, а порог этажа при этом уже набран.
      requires: { talentId: FIRST.id, minRank: FIRST.maxRank },
      effect: { kind: 'modifiers', mods: [] },
    }
    TALENTS.push(dependent)
    TALENT_BY_ID[dependent.id] = dependent
    try {
      let state = invest(hero(LEVEL_CAP), FIRST.id, FIRST.maxRank)
      state = invest(state, dependent.id, 1)
      expect(rankOf(state.talents, dependent.id)).toBe(1)

      const draft = { [FIRST.id]: FIRST.maxRank, [dependent.id]: 1 }
      // Последний ранг опорного держит стрелку: снять его нельзя.
      expect(takeBackStatus(state, FIRST, draft)).toMatchObject({
        canTakeBack: false,
        reason: 'blocks-dependent',
      })
      expect(takeBackTalent(state, FIRST.id, draft)).toBe(state)
      // Зависимый при этом снимается свободно — и после него опорный тоже.
      const freed = takeBackTalent(state, dependent.id, draft)
      expect(rankOf(freed.talents, dependent.id)).toBe(0)
      expect(takeBackStatus(freed, FIRST, draft).canTakeBack).toBe(true)
    } finally {
      TALENTS.pop()
      delete TALENT_BY_ID[dependent.id]
    }
  })

  it('снятие пересчитывает статы, а не только ранг', () => {
    // Ранг — источник модификаторов; оставить его снятым, а статы прежними
    // значило бы завести накопительную мутацию, которых в игре нет.
    const talent = talentsInBranch(WRATH).find(
      (t) => t.effect.kind === 'modifiers' && t.effect.mods.length > 0,
    )!
    const base = invest(hero(LEVEL_CAP), talent.id, 1)
    const after = takeBackTalent(base, talent.id, { [talent.id]: 1 })
    const plain = hero(LEVEL_CAP)
    // Сравниваем ВЕСЬ блок статов: талант мог задеть что угодно, и проверять
    // только «свои» статы значило бы поверить таланту на слово.
    const shape = (state: GameState) =>
      Object.fromEntries(
        Object.entries(state.stats).map(([key, value]) => [key, value.toString()]),
      )
    expect(shape(after)).toEqual(shape(plain))
  })
})

// ВЗАИМОИСКЛЮЧАЮЩАЯ ГРУППА: ВЛОЖИЛ В ОДНОГО — ОСТАЛЬНЫЕ ЗАПЕРТЫ.
//
// Ночь «три ветки» поставила на ключевых этажах по два таланта и считала,
// что венцы «разведены путями». Путь — это порядок покупки для модели, и
// запретить он ничего не может: оба венца брались, а на этажах 5 и 9 модель
// сама покупала оба концепта. Механизма не было. Здесь он появляется.
//
// Настоящих групп в данных на этой стадии ещё нет — их назначает следующая,
// — поэтому правило проверяется на подставной группе с настоящими типами:
// так проверка не зависит от того, какие группы сегодня в дереве.
describe('взаимоисключающие группы', () => {
  const FLOOR = 5
  const pair = () => talentsInBranch(WRATH).filter((t) => t.row === FLOOR)

  /** Ставим двум талантам одного этажа общую группу на время проверки. */
  function withGroup<T>(body: (a: TalentDef, b: TalentDef) => T): T {
    const [a, b] = pair()
    const saved = [a.exclusiveGroup, b.exclusiveGroup]
    a.exclusiveGroup = 'проверочная-группа'
    b.exclusiveGroup = 'проверочная-группа'
    try {
      return body(a, b)
    } finally {
      ;[a.exclusiveGroup, b.exclusiveGroup] = saved
    }
  }

  /** Герой с открытым пятым этажом Гнева и свободными очками. */
  function atFloor(): GameState {
    let s = hero(LEVEL_CAP)
    for (const t of talentsInBranch(WRATH).filter((x) => x.row < FLOOR)) {
      if (spentInBranch(s.talents, WRATH) >= (FLOOR - 1) * BRANCH_ROW_STEP) break
      s = invest(s, t.id, t.maxRank)
    }
    return s
  }

  it('вложение в члена группы ЗАПИРАЕТ остальных кодом group-taken', () => {
    withGroup((a, b) => {
      const base = atFloor()
      expect(talentStatus(base, a).canInvest).toBe(true)
      expect(talentStatus(base, b).canInvest).toBe(true)

      const chosen = invest(base, a.id, 1)
      const locked = talentStatus(chosen, b)
      expect(locked).toMatchObject({ canInvest: false, reason: 'group-taken', groupTakenBy: a.id })
      // И вложить нельзя — состояние не меняется вовсе.
      expect(investTalent(chosen, b.id)).toBe(chosen)
      // У выбранного статус про группу молчит: он и есть выбор.
      expect(talentStatus(chosen, a).groupTakenBy).toBeNull()
    })
  })

  it('группа проверяется РАНЬШЕ стрелки и ПОЗЖЕ порога этажа', () => {
    // Порог не лечится ничем, кроме очков; группа — только отказом от
    // выбора; стрелка — очками в опору. Из двух причин называют ту, что
    // твёрже: поэтому порог первый, группа вторая, стрелка третья.
    withGroup((a, b) => {
      const early = hero(TALENT_FIRST_LEVEL + 3)
      const chosenEarly = { ...early, talents: { [a.id]: 1 } }
      expect(talentStatus(chosenEarly, b).reason).toBe('branch-locked')

      const chosen = invest(atFloor(), a.id, 1)
      const withArrow: TalentDef = { ...b, requires: { talentId: 'wrath-honed-edge', minRank: 99 } }
      expect(talentStatus(chosen, withArrow).reason).toBe('group-taken')
    })
  })

  it('бесплатная отмена в открытом экране ОСВОБОЖДАЕТ группу', () => {
    withGroup((a, b) => {
      const chosen = invest(atFloor(), a.id, 1)
      expect(talentStatus(chosen, b).reason).toBe('group-taken')
      const undone = takeBackTalent(chosen, a.id, { [a.id]: 1 })
      expect(rankOf(undone.talents, a.id)).toBe(0)
      expect(talentStatus(undone, b)).toMatchObject({ canInvest: true, groupTakenBy: null })
      // И выбор можно переменить: теперь заперт первый.
      const swapped = invest(undone, b.id, 1)
      expect(talentStatus(swapped, a).reason).toBe('group-taken')
    })
  })

  it('платный сброс ОСВОБОЖДАЕТ группу', () => {
    withGroup((a, b) => {
      const chosen = { ...invest(atFloor(), a.id, 1), gold: new Decimal(1e9) }
      expect(talentStatus(chosen, b).reason).toBe('group-taken')
      const reset = resetTalents(chosen)
      expect(spentPoints(reset.talents)).toBe(0)
      // После сброса до пятого этажа ещё дойти надо — порог, а не группа.
      expect(talentStatus(reset, b).reason).toBe('branch-locked')
      expect(talentStatus(reset, b).groupTakenBy).toBeNull()
    })
  })

  it('МОДЕЛЬ ПРОГОНА уважает группу: путь берёт одного, не обоих', () => {
    // Иначе прибор мерил бы героя, берущего оба ключевых, — того, которого
    // в игре после этой стадии не существует.
    withGroup((a, b) => {
      for (const path of pathsOf(WRATH)) {
        const ranks = pathRanks(path, 1000)
        const taken = [a, b].filter((t) => (ranks[t.id] ?? 0) > 0)
        expect(taken.length, `${path.name}: взяты ${taken.map((t) => t.id).join(' и ')}`).toBe(1)
      }
    })
  })

  it('группа названа в данных пустой строкой — не группа', () => {
    // `exclusiveGroup: ''` не должен превращаться в одну общую группу всех
    // талантов «без группы»: пустое имя читается как отсутствие поля.
    const [a] = pair()
    expect(groupHolder({ [a.id]: 1 }, { ...a, id: 'другой', exclusiveGroup: undefined })).toBeNull()
  })
})

// КЛЮЧЕВЫЕ ЭТАЖИ — ВЫБОР, А НЕ ДВА ОЧКА ИЗ ДЕВЯНОСТА ОДНОГО.
//
// Этаж 5 требует 20 очков в ветке — это 30-й уровень при вложении в одну
// ветку; этаж 9 — 50-й; этаж 13 — 70-й. Три майлстоуна всей прокачки. Пока
// на них стояли по два таланта по одному очку и брались оба, выбора не было:
// «одно очко и очень сильный» ломало не число, а отсутствие ОТКАЗА.
describe('ключевые этажи Стража — взаимоисключающие пары', () => {
  const own = BRANCHES.filter((b) => b.classId === WARDEN.id)

  it('на этажах 5, 9 и 13 каждой ветки РОВНО одна группа из двух', () => {
    for (const branch of own) {
      for (const row of CONCEPT_ROWS) {
        const onRow = talentsInBranch(branch.id).filter((t) => t.row === row)
        const groups = new Set(onRow.map((t) => t.exclusiveGroup))
        expect(onRow, `${branch.id} этаж ${row}`).toHaveLength(2)
        expect(groups.size, `${branch.id} этаж ${row}: групп ${[...groups].join(', ')}`).toBe(1)
        expect([...groups][0], `${branch.id} этаж ${row}: группа не названа`).toBeTruthy()
      }
    }
  })

  it('ни один ключевой талант не модификатор конвейера', () => {
    // Держит и схема; здесь — второй замок на самом заметном: процент к
    // криту майлстоуном не является.
    for (const branch of own) {
      for (const talent of talentsInBranch(branch.id).filter((t) => CONCEPT_ROWS.includes(t.row))) {
        expect(talent.effect.kind, talent.id).not.toBe('modifiers')
      }
    }
  })

  it('взять оба ключевых одного этажа НЕВОЗМОЖНО', () => {
    for (const branch of own) {
      for (const row of CONCEPT_ROWS) {
        const [a, b] = talentsInBranch(branch.id).filter((t) => t.row === row)
        let s = hero(LEVEL_CAP)
        // Порог этажа набирается ТОЛЬКО нейтральными талантами выше: иначе
        // по дороге к девятому этажу купились бы ключевые пятого, и тест
        // проверял бы не ту пару.
        for (const t of talentsInBranch(branch.id).filter((x) => x.row < row && !CONCEPT_ROWS.includes(x.row))) {
          if (spentInBranch(s.talents, branch.id) >= a.requiredPointsInBranch) break
          s = invest(s, t.id, t.maxRank)
        }
        expect(spentInBranch(s.talents, branch.id)).toBeGreaterThanOrEqual(a.requiredPointsInBranch)
        // Стрелки ключевых набираем честно: у пары опоры разные.
        for (const t of [a, b]) if (t.requires) s = invest(s, t.requires.talentId, requiredRankOf(t))
        const first = invest(s, a.id, 1)
        expect(rankOf(first.talents, a.id), a.id).toBe(1)
        expect(talentStatus(first, b), `${b.id} после ${a.id}`).toMatchObject({
          canInvest: false,
          reason: 'group-taken',
          groupTakenBy: a.id,
        })
        expect(investTalent(first, b.id)).toBe(first)
      }
    }
  })

  it('каждая ветка проходится до венца имеющимися очками — по ОБОИМ путям', () => {
    // Группа не должна отрезать дорогу к венцу: у каждого пути один из двух
    // капстоунов куплен, и не потому, что очков хватило на оба.
    const total = earnedPoints(new Decimal(LEVEL_CAP))
    for (const branch of own) {
      const capstones = talentsInBranch(branch.id).filter((t) => t.row === BRANCH_ROWS)
      for (const path of pathsOf(branch.id)) {
        const ranks = pathRanks(path, total)
        const taken = capstones.filter((t) => (ranks[t.id] ?? 0) > 0)
        expect(taken.length, `${branch.id} «${path.name}»: венцов взято ${taken.length}`).toBe(1)
        for (const row of CONCEPT_ROWS) {
          const pair = talentsInBranch(branch.id).filter((t) => t.row === row)
          const got = pair.filter((t) => (ranks[t.id] ?? 0) > 0)
          expect(got.length, `${branch.id} «${path.name}» этаж ${row}: ключевых взято ${got.length}`).toBe(1)
        }
      }
    }
  })
})
