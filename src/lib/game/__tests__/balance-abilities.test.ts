// ВЫБОР ЧЕТВЁРКИ: не пустой, не однозначный и не подорожавший.
//
// Одиннадцать умений — это одиннадцать умений только если каждое где-то
// нужно. Здесь перебираются четвёрки на нескольких срезах и проверяются три
// свойства сразу:
//   1. набор НЕ ПОДОРОЖАЛ — лучшая четвёрка держится в коридоре бюджета;
//   2. набор НЕ ПУСТ — каждое умение входит хотя бы в одну выигравшую;
//   3. набор НЕ ОДНОЗНАЧЕН — четвёрка для рядового моба и для босса разные.
//
// Перебор полный: C(11,4) = 330 сочетаний на срез. Это дорого, поэтому файл
// живёт в дорогом наборе (`balance-*.test.ts`), а не в быстром.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { branchPoints, buildSimState, referenceBuild } from '../simulate'
import { ensureStats } from '../stats'
import { BRANCHES, pathRanks, pathsOf, type BranchId } from '../../data/talents'
import { estimateCombatRate } from '../combat'
import { abilitiesOf } from '../state'
import { ABILITY_SLOTS, AUTOCAST_MAX_LOSS, LEVEL_CAP, POWER_BUDGET } from '../../data/balance'
import { DEFAULT_CLASS } from '../../data/classes'
import { ZONES } from '../../data/zones'
import { dump } from './dump'
import type { GameState } from '../state'

/** Прежняя четвёрка Стража: ею играли до этой задачи, она и есть бюджет. */
const OLD_FOUR = ['quick-strike', 'rending-wound', 'mend-wounds', 'shattering-blow']

/** Все сочетания по k — перебор полный, без эвристик: срезов немного. */
function combos<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (xs.length < k) return []
  const [head, ...rest] = xs
  return [...combos(rest, k - 1).map((c) => [head, ...c]), ...combos(rest, k)]
}

function zoneFor(level: number) {
  return (
    ZONES.find((z) => level >= z.monsterLevelRange.min && level <= z.monsterLevelRange.max) ??
    ZONES[0]
  )
}

function slotsOf(ids: readonly string[]): (string | null)[] {
  return [...ids, null, null, null, null].slice(0, ABILITY_SLOTS)
}

interface Slice {
  name: string
  level: number
  /** Цель: рядовая (как в зоне) или длинная, как босс. */
  target: 'trash' | 'boss'
}

/**
 * ЦЕЛЬ-БОСС — ЭТО ДЛИННЫЙ БОЙ, и только он. Своего боссового состояния здесь
 * не собирается: важно ровно одно свойство — цель живёт долго и бьёт больно,
 * потому что именно на нём окупаются клеймо и стойка.
 */
function withTarget(state: GameState, target: Slice['target']): GameState {
  if (target === 'trash') return state
  return {
    ...state,
    monster: {
      ...state.monster,
      // Числа подобраны так, чтобы бой был ДЛИННЫМ, но проходимым: при
      // 30-кратном запасе и 1.8-кратном уроне герой не выживал ни в одной
      // четвёрке, кроме чисто защитной, темп убийств обращался в ноль, и срез
      // мерил не «что взять на босса», а «кто вообще доживёт».
      maxHp: state.monster.maxHp.times(10),
      currentHp: state.monster.maxHp.times(10),
      damageMin: state.monster.damageMin.times(1.25),
      damageMax: state.monster.damageMax.times(1.25),
    },
  }
}

interface Ranked {
  ids: string[]
  rate: number
}

function rank(slice: Slice): Ranked[] {
  const base = withTarget(
    buildSimState(referenceBuild(slice.level, DEFAULT_CLASS.id), zoneFor(slice.level).id, 7),
    slice.target,
  )
  const open = abilitiesOf(DEFAULT_CLASS.id).filter((a) => a.unlockLevel <= slice.level)
  const rows = combos(open, Math.min(ABILITY_SLOTS, open.length)).map((combo) => ({
    ids: combo.map((a) => a.id),
    rate: estimateCombatRate({ ...base, abilitySlots: slotsOf(combo.map((a) => a.id)) }, 'auto')
      .killsPerSecond.toNumber(),
  }))
  return rows.sort((a, b) => b.rate - a.rate)
}

function rateOf(slice: Slice, ids: readonly string[]): number {
  const base = withTarget(
    buildSimState(referenceBuild(slice.level, DEFAULT_CLASS.id), zoneFor(slice.level).id, 7),
    slice.target,
  )
  return estimateCombatRate({ ...base, abilitySlots: slotsOf(ids) }, 'auto').killsPerSecond.toNumber()
}

const SLICES: Slice[] = [
  { name: 'ур.10, рядовой', level: 10, target: 'trash' },
  { name: 'ур.15, рядовой', level: 15, target: 'trash' },
  { name: 'ур.20, рядовой', level: 20, target: 'trash' },
  { name: 'ур.20, босс', level: 20, target: 'boss' },
]

describe('набор умений: перераспределение, а не прибавка', () => {
  it('лучшая четвёрка держится в коридоре бюджета', () => {
    const corridor = POWER_BUDGET.multipliers.abilities
    const rows = SLICES.filter((s) => s.target === 'trash').map((slice) => {
      const best = rank(slice)[0]
      const old = rateOf(slice, OLD_FOUR.filter((id) =>
        abilitiesOf(DEFAULT_CLASS.id).some(
          (a) => a.id === id && a.unlockLevel <= slice.level,
        ),
      ))
      const mult = dump(
        `abilities/${DEFAULT_CLASS.id}/level-${String(slice.level).padStart(3, '0')}/best-four-over-old/value`,
        best.rate / old,
      )
      return {
        срез: slice.name,
        'лучшая четвёрка': best.ids.join(' + '),
        множитель: Number(mult.toFixed(3)),
        коридор: `${corridor.min}–${corridor.max}`,
        'в коридоре': mult >= corridor.min && mult <= corridor.max ? 'да' : 'НЕТ',
      }
    })
    // eslint-disable-next-line no-console
    console.table(rows)
    for (const row of rows) {
      expect(row.множитель, `${row.срез}: набор подорожал`).toBeLessThanOrEqual(corridor.max)
      expect(row.множитель, `${row.срез}: набор обесценился`).toBeGreaterThanOrEqual(corridor.min)
    }
  }, 600_000)

  it('НИ ОДНО умение не остаётся невостребованным', () => {
    // Жёсткий тест стадии 6. Умение, не вошедшее ни в одну выигравшую
    // четвёрку ни на одном срезе, — украшение, и чинить надо УМЕНИЕ, а не
    // тест: подгонять порог под результат здесь нельзя.
    //
    // «Выигравшая» — не только первая: игрок выбирает из верхушки, и
    // четвёрка, отстающая на проценты, — такой же законный выбор.
    const TOP = 5
    const used = new Set<string>()
    const table: Array<Record<string, string>> = []
    for (const slice of SLICES) {
      const top = rank(slice).slice(0, TOP)
      for (const row of top) for (const id of row.ids) used.add(id)
      table.push({ срез: slice.name, 'лучшая четвёрка': top[0].ids.join(' + ') })
    }
    // eslint-disable-next-line no-console
    console.table(table)
    const all = abilitiesOf(DEFAULT_CLASS.id).map((a) => a.id)
    const idle = all.filter((id) => !used.has(id))
    // eslint-disable-next-line no-console
    console.log(`умений в наборе: ${all.length}, невостребованных: ${idle.join(', ') || 'нет'}`)
    expect(idle, 'умение не вошло ни в одну верхнюю четвёрку ни на одном срезе').toEqual([])
  }, 900_000)

  it('четвёрка для рядового и для босса РАЗЛИЧАЮТСЯ', () => {
    // Если совпали — ситуативные умения не работают, и менять четвёрку перед
    // данжем незачем.
    const trash = rank({ name: 'ур.20, рядовой', level: 20, target: 'trash' })[0]
    const boss = rank({ name: 'ур.20, босс', level: 20, target: 'boss' })[0]
    // eslint-disable-next-line no-console
    console.log(`трэш: ${trash.ids.join(' + ')}`)
    // eslint-disable-next-line no-console
    console.log(`босс:  ${boss.ids.join(' + ')}`)
    const same = trash.ids.filter((id) => boss.ids.includes(id))
    expect(same.length, 'четвёрки совпали целиком').toBeLessThan(ABILITY_SLOTS)
  }, 600_000)

  it('ОТЧЁТ: сколько умений обязательны', () => {
    // Не тест, а число в отчёт: обязательное умение фактически отнимает один
    // слот из четырёх. Одно — нормально, три — значит выбора нет.
    const tops = SLICES.map((slice) => rank(slice)[0].ids)
    const all = abilitiesOf(DEFAULT_CLASS.id).map((a) => a.id)
    const mandatory = all.filter((id) => tops.every((four) => four.includes(id)))
    // eslint-disable-next-line no-console
    console.log(`обязательных умений: ${mandatory.length} (${mandatory.join(', ') || 'нет'})`)
    expect(
      dump(`abilities/${DEFAULT_CLASS.id}/mandatory/count`, new Decimal(mandatory.length)).toNumber(),
      'обязательных больше трёх — выбора нет',
    ).toBeLessThan(ABILITY_SLOTS)
  }, 900_000)
})

// ЖЕЛЕЗНОЕ ПРАВИЛО НА КАЖДОЙ ДОПУСТИМОЙ ЧЕТВЁРКЕ, а не на той, что стоит по
// умолчанию. Умение, которое автокаст не умеет применять разумно, — плохое
// умение в идл-игре, даже если в руках оно сильное; и вылезет это ровно на
// той четвёрке, которую никто не проверял.
describe('автокаст и оффлайн держатся на ЛЮБОЙ четвёрке', () => {
  const LEVEL = 20
  const allFours = (): Array<{ ids: string[]; state: GameState }> => {
    const base = buildSimState(
      referenceBuild(LEVEL, DEFAULT_CLASS.id),
      zoneFor(LEVEL).id,
      7,
    )
    return combos(abilitiesOf(DEFAULT_CLASS.id), ABILITY_SLOTS).map((combo) => ({
      ids: combo.map((a) => a.id),
      state: { ...base, abilitySlots: slotsOf(combo.map((a) => a.id)) },
    }))
  }

  it('оффлайн <= автокаст <= ручная игра', () => {
    let worst = { ids: [] as string[], gap: 0 }
    for (const four of allFours()) {
      const auto = estimateCombatRate(four.state, 'auto')
      const manual = estimateCombatRate(four.state, 'manual')
      expect(
        auto.damagePerSecond.lte(manual.damagePerSecond.times(1 + 1e-9)),
        `авто обгоняет руку на ${four.ids.join('+')}`,
      ).toBe(true)
      expect(
        auto.killsPerSecond.lte(manual.killsPerSecond.times(1 + 1e-9)),
        `убийств: авто обгоняет руку на ${four.ids.join('+')}`,
      ).toBe(true)
      const gap = 1 - auto.damagePerSecond.div(manual.damagePerSecond).toNumber()
      if (gap > worst.gap) worst = { ids: four.ids, gap }
    }
    // eslint-disable-next-line no-console
    console.log(
      `худшее отставание авто: ${(worst.gap * 100).toFixed(1)}% на ${worst.ids.join(' + ')}` +
        ` (потолок ${(AUTOCAST_MAX_LOSS * 100).toFixed(0)}%)`,
    )
    expect(
      dump(`abilities/${DEFAULT_CLASS.id}/autocast/worst-gap`, new Decimal(worst.gap)).toNumber(),
      `отставание автокаста выше потолка на ${worst.ids.join(' + ')}`,
    ).toBeLessThanOrEqual(AUTOCAST_MAX_LOSS + 1e-9)
  }, 900_000)
})

// ТРИ ВЕТКИ — ЭТО ТРИ РАЗНЫХ ГЕРОЯ ИЛИ ТРИ ЛЕСТНИЦЫ, ТРЕТЬЕГО НЕ ДАНО.
//
// Ветка, наполненная талантами про умения, обязана менять ОТВЕТ на вопрос
// «какую четвёрку взять». Если у всех трёх специализаций лучшая четвёрка
// одна и та же, значит таланты не трогают выбор — а он единственный рычаг
// игрока над ротацией, и вся переделка была косметикой.
//
// Перебор полный: C(11,4) = 330 сочетаний на ветку, три ветки, сотый уровень.
describe('специализации играют РАЗНЫМ набором', () => {
  const LEVEL = LEVEL_CAP
  const POINTS = branchPoints(LEVEL)

  /** Лучшая четвёрка для героя, вложившего очки в одну ветку по её пути. */
  function bestFour(branch: BranchId, pathIndex = 0): { ids: string[]; rate: number } {
    const path = pathsOf(branch)[pathIndex]
    const base = buildSimState(referenceBuild(LEVEL, DEFAULT_CLASS.id), zoneFor(LEVEL).id, 7)
    const talented: GameState = ensureStats({
      ...base,
      talents: pathRanks(path, POINTS),
      statsDirty: true,
    })
    const rows = combos(abilitiesOf(DEFAULT_CLASS.id), ABILITY_SLOTS).map((combo) => {
      const ids = combo.map((a) => a.id)
      return {
        ids,
        rate: estimateCombatRate({ ...talented, abilitySlots: slotsOf(ids) }, 'auto')
          .killsPerSecond.toNumber(),
      }
    })
    rows.sort((a, b) => b.rate - a.rate)
    return rows[0]
  }

  it('лучшая четвёрка РАЗЛИЧАЕТСЯ у трёх веток', () => {
    const own = BRANCHES.filter((b) => b.classId === DEFAULT_CLASS.id)
    const best = own.map((b) => ({ branch: b, ...bestFour(b.id) }))
    // eslint-disable-next-line no-console
    console.table(
      best.map((row) => ({
        ветка: row.branch.name,
        четвёрка: row.ids.join(' + '),
        'убийств/с': row.rate.toFixed(4),
      })),
    )
    const keys = best.map((row) => [...row.ids].sort().join('|'))
    // ВСЕ ТРИ ОДИНАКОВЫ — ПРОВАЛ. Две могут совпасть: у Гнева и Бдения обе
    // ставки на урон, и лучший набор у них имеет право быть общим.
    expect(new Set(keys).size, `все три ветки играют ${keys[0]}`).toBeGreaterThan(1)
  }, 900_000)

  it('оба пути ветки ЖИЗНЕСПОСОБНЫ, а не один настоящий и один для вида', () => {
    // Второй путь имеет смысл, только если он не проигрывает первому вчистую.
    // Порог мягкий: пути и должны различаться, вопрос лишь в том, что разница
    // — это ВЫБОР, а не ошибка.
    for (const branch of BRANCHES.filter((b) => b.classId === DEFAULT_CLASS.id)) {
      const paths = pathsOf(branch.id)
      expect(paths.length, branch.id).toBeGreaterThanOrEqual(2)
      const rates = paths.map((_, i) => bestFour(branch.id, i).rate)
      const [first, ...rest] = rates
      for (const [i, rate] of rest.entries()) {
        const share = rate / first
        // eslint-disable-next-line no-console
        console.log(
          `${branch.name}: путь «${paths[i + 1].name}» даёт ${(share * 100).toFixed(1)} % от «${paths[0].name}»`,
        )
        expect(share, `${branch.id}: путь «${paths[i + 1].name}» безнадёжен`).toBeGreaterThan(0.75)
      }
    }
  }, 900_000)
})
