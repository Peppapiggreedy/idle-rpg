// ВЕТКИ МЕРЯЮТСЯ ОТНОШЕНИЯМИ К ЯКОРЮ, А НЕ АБСОЛЮТНЫМ ОКНОМ.
//
// Прибор отвечает ровно на два вопроса, и оба про ВЕТКУ, а не про мир:
//   А. «НЕ ОТСТОЙ»  — ветка, залитая до венца, окупает шестьдесят уровней
//      игры: по СВОЕЙ оси она не меньше `BRANCH_BANDS.overAnchor` якоря.
//   Б. «НЕ В РАЗЫ»  — внутри класса лучшая ветка не сильнее худшей больше
//      чем в `BRANCH_BANDS.spread` раз, и ни одна не выше потолка над якорем.
//
// ЯКОРЬ — ТОТ ЖЕ ГЕРОЙ БЕЗ ЕДИНОГО ОЧКА, И ОН СВОЙ У КАЖДОГО КЛАССА. Задание
// ночи называло девятнадцать сборок (18 путей + якорь), но якорь обязан быть
// классовым: отношение ветки Псаря к якорю Стража мерило бы разницу КЛАССОВ,
// а не цену ветки. Отсюда двадцать одна сборка: 9 веток × 2 пути + 3 якоря.
//
// ПОЧЕМУ ДВА ПУТИ НА ВЕТКУ. На ключевых этажах (5, 9, 13) стоит взаимо-
// исключающая пара, и `BRANCH_PATHS` объявляет по два пути, берущих
// ПРОТИВОПОЛОЖНЫХ ключевых. Венцы различаются сильно — один занимает слот
// умения, — поэтому мерить надо оба, иначе половина дерева не измерена ничем.
//
// ОСЬ БЕРЁТСЯ ИЗ ОПРЕДЕЛЕНИЯ СТИЛЯ, А НЕ ПРИДУМЫВАЕТСЯ ЗДЕСЬ. `BranchStyle`
// в data/talents.ts говорит прямо: «урон бьёт сильнее, выносливость реже
// умирает, автономность реже стоит». Отсюда три меры и ни одной лишней:
//   damage    — убийств в час в СВОЕЙ зоне;
//   survival  — убийств в час там, где ЯКОРЬ ГИБНЕТ (глубина калибруется);
//   autonomy  — во сколько раз срезан ПРОСТОЙ (доля времени на привалах).
//
// ЦЕНА. Пятнадцать минут игрового времени на прогон, точка — медиана трёх
// сидов (замер стадии 1, docs/CHECKS.md); замер команды целиком — 185 секунд.
//
// ФАЙЛ ПОКА НЕ В CI, И ЭТО НЕ НЕДОСМОТР. Первое же чтение прибора нашло
// настоящую поломку дерева: путь «Бдение · Клеймо» у ГОТОВОГО класса срезает
// простой в 1.111 раза при ленте 1.2 — то есть ветка автономности, взятая
// через свой ключевой этаж, автономности почти не даёт (и убивает при этом
// медленнее якоря: 272 против 328 в час). Чинится это правкой дерева, а
// ночь «проверок по цене ошибки» балансных чисел не трогает НИ ОДНОГО.
// Поэтому прибор живёт своей командой `npm run test:branches`, а его
// позеленение — условие приёмки следующей ночи, той, что дерево пересобирает.
// Подгонять ленту под сегодняшнее дерево нельзя: лента, выведенная из шума
// прибора, — это и есть то, ради чего он заведён.
import { describe, expect, it } from 'vitest'
import { BRANCHES, pathRanks, pathsOf, type BranchStyle, type TalentPath } from '../../data/talents'
import { CLASSES } from '../../data/classes'
import { ZONES } from '../../data/zones'
import { BALANCE_PRESET, simulate, type SimBuild } from '../simulate'
import { intendedZone } from '../zones'
import { BRANCH_BANDS, TALENT_FIRST_LEVEL } from '../../data/balance'
import { classIt } from './class-set'
import { dump } from './dump'

const LEVEL = BALANCE_PRESET.branchDownLevel
const HOURS = BALANCE_PRESET.branchProbeHours
const SEEDS = BALANCE_PRESET.branchProbeSeeds
/**
 * Очков к этому уровню: `branchPoints` из simulate.ts, но без импорта прогона.
 *
 * ПЛЮС ЧЕТЫРЕ, И ЭТО НЕ ПОДГОНКА. Порог венца — 60 очков, но заливка идёт ПО
 * ПОРЯДКУ ПУТИ и после каждой покупки начинает с головы списка: на 61 очке
 * венец берёт один путь из восемнадцати, на 65 — все (замер записан в
 * CLAUDE.md, раздел «Таланты»). Прибор мерил «ветку до венца» на 61 и этого
 * не видел; пока венцы были правками чисел, разница читалась как проценты.
 *
 * С ВЕНЦОМ-УМЕНИЕМ ОНА ПЕРЕСТАЛА БЫТЬ ПРОЦЕНТАМИ. Путь «Взрыв» держит в
 * четвёрке «Отголосок» — умение, ВЫДАННОЕ венцом; без венца это пустой слот,
 * и ветка мерилась в 0.95 якоря, то есть ХУЖЕ героя без единого очка. Прибор
 * обязан мерить сборку, которую он же и описывает.
 */
const POINTS = LEVEL - TALENT_FIRST_LEVEL + 5

const ownZone = intendedZone(LEVEL)
const ownIndex = ZONES.findIndex((z) => z.id === ownZone.id)

function probeBuild(classId: string, path: TalentPath | null): SimBuild {
  return {
    classId,
    level: LEVEL,
    // СНАРЯЖЕНИЕ ОДИНАКОВОЕ У ВСЕХ СБОРОК, и берётся оно простым правилом, а
    // не эталонным прохождением (`referenceBuild`). Прибор мерит ОТНОШЕНИЯ:
    // одинаковая экипировка у ветки и якоря сокращается в дроби, а вот
    // `pacingTable` стоила бы 109 секунд на класс — больше, чем весь прибор.
    gearLevel: LEVEL,
    gear: 'average',
    talents: path ? pathRanks(path, POINTS) : {},
    // ЧЕТВЁРКА ПУТИ — ЧАСТЬ СБОРКИ. Талант, правящий умение вне ряда, не
    // делает ничего: путь «Взрыв», сыгранный четвёркой по умолчанию, тратит
    // одиннадцать очков в пустоту, и мерили бы мы тогда не ветку.
    autocast: path?.abilities ?? 'all',
  }
}

interface Sample {
  kills: number
  rest: number
  deaths: number
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Замер: медиана трёх сидов, по каждой величине отдельно. */
function probe(build: SimBuild, zoneId: string, seeds: readonly number[] = SEEDS): Sample {
  const runs = seeds.map((seed) => simulate({ hours: HOURS, zoneId, build, seed, freezeLevel: true }))
  return {
    kills: median(runs.map((r) => r.killsPerHour.toNumber())),
    rest: median(runs.map((r) => r.restShare)),
    deaths: median(runs.map((r) => r.deathsPerHour)),
  }
}

/**
 * СМЕРТЕЛЬНАЯ ГЛУБИНА КАЛИБРУЕТСЯ, А НЕ НАЗНАЧАЕТСЯ. Мельчайшая зона выше
 * своей, где ЯКОРЬ гибнет чаще `deadlyDeathsPerHour`. Ищется одним сидом:
 * различить «гибнет 60 раз в час» и «не гибнет вовсе» одного прогона хватает
 * с огромным запасом, а тройка сидов утроила бы цену калибровки.
 */
function deadlyZone(anchor: SimBuild): { zone: (typeof ZONES)[number]; belts: number; deaths: number } {
  let last = { zone: ZONES[Math.min(ownIndex + 1, ZONES.length - 1)], belts: 1, deaths: 0 }
  for (let belts = 1; belts <= BRANCH_BANDS.deadlyMaxBelts; belts += 1) {
    const index = ownIndex + belts
    if (index >= ZONES.length) break
    const zone = ZONES[index]
    const deaths = simulate({ hours: HOURS, zoneId: zone.id, build: anchor, seed: SEEDS[0], freezeLevel: true })
      .deathsPerHour
    last = { zone, belts, deaths }
    if (deaths >= BRANCH_BANDS.deadlyDeathsPerHour) break
  }
  return last
}

interface Row {
  id: string
  label: string
  classId: string
  branchId: string | null
  style: BranchStyle | null
  build: SimBuild
  own: Sample
  deep: Sample | null
}

/**
 * ОСЬ — ФУНКЦИЯ ОТ СТРОКИ И ЯКОРЯ, а не поле строки: у автономности числитель
 * и знаменатель стоят наоборот (простой — «меньше лучше»), и разворачивать
 * знак в каждой точке показа мы уже пробовали в осях апгрейда.
 */
const AXIS: Record<BranchStyle, { name: string; ratio: (row: Row, anchor: Row) => number }> = {
  damage: {
    name: 'убийств/ч дома',
    ratio: (row, anchor) => row.own.kills / anchor.own.kills,
  },
  survival: {
    name: 'убийств/ч там, где якорь гибнет',
    ratio: (row, anchor) => (row.deep?.kills ?? 0) / (anchor.deep?.kills ?? 1),
  },
  autonomy: {
    name: 'во сколько срезан простой',
    ratio: (row, anchor) =>
      Math.max(anchor.own.rest, BRANCH_BANDS.restFloor) / Math.max(row.own.rest, BRANCH_BANDS.restFloor),
  },
}

/** Живучесть меряется в смертельной зоне; она же нужна и якорю для дроби. */
const needsDeep = (style: BranchStyle | null): boolean => style === 'survival' || style === null

const rows: Row[] = []
const deadly = new Map<string, ReturnType<typeof deadlyZone>>()

for (const cls of CLASSES) {
  const anchorBuild = probeBuild(cls.id, null)
  const где = deadlyZone(anchorBuild)
  deadly.set(cls.id, где)
  const заготовки: Array<{ id: string; label: string; branchId: string | null; style: BranchStyle | null; build: SimBuild }> = [
    { id: `anchor-${cls.id}`, label: `${cls.name}: якорь (без талантов)`, branchId: null, style: null, build: anchorBuild },
  ]
  for (const branch of BRANCHES.filter((b) => b.classId === cls.id)) {
    for (const path of pathsOf(branch.id)) {
      заготовки.push({
        id: path.id,
        label: `${cls.name}: ${branch.name} · ${path.name}`,
        branchId: branch.id,
        style: branch.style,
        build: probeBuild(cls.id, path),
      })
    }
  }
  for (const з of заготовки) {
    rows.push({
      ...з,
      classId: cls.id,
      own: probe(з.build, ownZone.id),
      deep: needsDeep(з.style) ? probe(з.build, где.zone.id) : null,
    })
  }
}

const anchorOf = (classId: string): Row => rows.find((r) => r.classId === classId && r.branchId === null)!
const ratioOf = (row: Row): number => AXIS[row.style!].ratio(row, anchorOf(row.classId))

// Таблица печатается ВСЕГДА, а не только при падении: половина ценности этой
// проверки — в том, что таблицу видно.
// eslint-disable-next-line no-console
const log = (line: string) => console.log(line)

log(`ВЕТКИ: уровень ${LEVEL}, очков ${POINTS}, зона «${ownZone.name}», ${HOURS * 60} мин × ${SEEDS.length} сида (медиана)`)
for (const cls of CLASSES) {
  const d = deadly.get(cls.id)!
  log(`  ${cls.name}: смертельная зона «${d.zone.name}» (+${d.belts} пояса, якорь гибнет ${d.deaths.toFixed(0)} раз/ч)`)
}
log('сборка                                 убийств/ч  привал%   глубина: убийств/ч  смертей/ч   к якорю')
for (const row of rows) {
  const axis = row.style ? AXIS[row.style] : null
  const ratio = axis ? ratioOf(row) : 1
  log(
    `${row.label.padEnd(38)} ${row.own.kills.toFixed(0).padStart(9)} ${(row.own.rest * 100).toFixed(1).padStart(8)} ` +
      `${(row.deep ? row.deep.kills.toFixed(0) : '—').padStart(19)} ${(row.deep ? row.deep.deaths.toFixed(0) : '—').padStart(10)}   ` +
      `${ratio.toFixed(3)} ${axis ? `(${axis.name})` : '(якорь)'}`,
  )
}

describe('ветки: не отстой', () => {
  for (const cls of CLASSES) {
    const cit = classIt(cls)
    for (const row of rows.filter((r) => r.classId === cls.id && r.style !== null)) {
      cit(`${row.label} — ${AXIS[row.style!].name} ≥ ${BRANCH_BANDS.overAnchor} якоря`, () => {
        const ratio = dump(`branches/${row.classId}/${row.id}/over-anchor`, ratioOf(row))
        expect(ratio).toBeGreaterThanOrEqual(BRANCH_BANDS.overAnchor)
      })
    }
  }
})

describe('ветки: не в разы', () => {
  // ОБА ВОПРОСА ЭТОГО РАЗДЕЛА — ПРО СИЛУ, И МЕРИТСЯ СИЛА ОДНОЙ ВАЛЮТОЙ:
  // убийствами в час в СВОЕЙ зоне. Осевые отношения сюда не годятся, и это
  // выяснилось замером: «Экономия» срезает простой в 2.54 раза — и по осевой
  // ленте пробивает потолок «не круче якоря в 2.5 раза», хотя простоя у
  // якоря 17.8 %, то есть вся эта победа стоит +13 % пропускной способности.
  // Ось отвечает на вопрос «выполняет ли ветка своё обещание», потолок — на
  // вопрос «не стала ли сборка в разы сильнее»; это разные вопросы, и мерить
  // их одним числом нельзя.
  const power = (row: Row): number => row.own.kills / anchorOf(row.classId).own.kills

  for (const cls of CLASSES) {
    const cit = classIt(cls)
    const own = rows.filter((r) => r.classId === cls.id && r.branchId !== null)
    // ВЕТКУ ПРЕДСТАВЛЯЕТ ЛУЧШИЙ ИЗ ДВУХ ЕЁ ПУТЕЙ: игрок выберет лучший, и
    // сравнивать надо то, что он выберет, а не среднее по путям.
    const byBranch = [...new Set(own.map((r) => r.branchId!))].map((id) =>
      Math.max(...own.filter((r) => r.branchId === id).map(power)),
    )

    cit(`${cls.name}: лучшая ветка не сильнее худшей в ${BRANCH_BANDS.spread} раза`, () => {
      const spread = dump(`branches/${cls.id}/spread`, Math.max(...byBranch) / Math.min(...byBranch))
      expect(spread).toBeLessThanOrEqual(BRANCH_BANDS.spread)
    })

    cit(`${cls.name}: ни одна сборка не выше ${BRANCH_BANDS.ceiling} якоря`, () => {
      const top = dump(`branches/${cls.id}/ceiling`, Math.max(...own.map(power)))
      expect(top).toBeLessThanOrEqual(BRANCH_BANDS.ceiling)
    })
  }
})

describe('прибор', () => {
  it('меряет ВСЕ ветки ВСЕМИ путями и каждый класс своим якорем', () => {
    // ПУТЕЙ У ВЕТКИ СТОЛЬКО, СКОЛЬКО ИХ ОБЪЯВЛЕНО. Здесь стояло «ровно два», и
    // это было верно ровно пока венец был один на две клетки. У Гнева венцов
    // четыре — четыре разных механизма, — и путей столько же: венец берётся
    // один на сборку, а талант вне путей не измерен ничем.
    expect(rows.filter((r) => r.branchId === null)).toHaveLength(CLASSES.length)
    const declared = BRANCHES.reduce((n, b) => n + pathsOf(b.id).length, 0)
    expect(rows.filter((r) => r.branchId !== null)).toHaveLength(declared)
    for (const branch of BRANCHES) {
      const paths = pathsOf(branch.id).length
      expect(paths, `${branch.id}: путей меньше двух — выбора нет`).toBeGreaterThanOrEqual(2)
      expect(rows.filter((r) => r.branchId === branch.id), branch.id).toHaveLength(paths)
    }
  })

  it('ось берётся из поля style, и у каждой ветки она есть', () => {
    for (const branch of BRANCHES) {
      expect(AXIS[branch.style], `${branch.id}: стиль ${branch.style} без оси`).toBeDefined()
    }
  })

  it('сборка ветки действительно залита до венца', () => {
    for (const row of rows.filter((r) => r.branchId !== null)) {
      const spent = Object.values(row.build.talents ?? {}).reduce((n, r) => n + r, 0)
      expect(spent, `${row.label}: вложено ${spent} из ${POINTS}`).toBeGreaterThan(POINTS - 5)
    }
  })

  // ЖИВУЧЕСТЬ МЕРЯЕТСЯ ТАМ, ГДЕ УМИРАЮТ, И ЭТО ПРОВЕРЯЕТСЯ, А НЕ
  // ПОДРАЗУМЕВАЕТСЯ. Замер ночи: на +2 пояса не гибнет никто (0.0 смертей в
  // час у всех трёх якорей), и ось живучести там мерила ровно ничего.
  it('смертельная зона действительно смертельна для якоря', () => {
    for (const cls of CLASSES) {
      const d = deadly.get(cls.id)!
      expect(d.deaths, `${cls.name}: зона «${d.zone.name}» безопасна, живучесть в ней не видна`).toBeGreaterThanOrEqual(
        BRANCH_BANDS.deadlyDeathsPerHour,
      )
    }
  })
})
