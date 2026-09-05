// ШЕСТЬ ПУТЕЙ ВМЕСТО ТРЁХ: ВЗАИМОИСКЛЮЧЕНИЕ ДЕЛИТ КАЖДУЮ ВЕТКУ НАДВОЕ.
//
// На ключевых этажах 5, 9 и 13 стоят по два таланта, и берётся один. У
// каждой ветки два ЯВНЫХ пути (`BRANCH_PATHS`), и путь — это сборка: порядок
// покупки, свои три ключевых и четвёрка умений, под которую собран. Прибор
// строит все шесть, перебирает для каждой все 330 четвёрок и печатает
// профиль. Если два пути одной ветки дают одну лучшую четвёрку И один
// профиль — ключевые различаются только величиной, и пара обязана быть
// переделана: ветка, где ключевой выбор формален, хуже ветки без выбора —
// она обещает и не даёт.
//
// Полный перебор четвёрок на шесть сборок: файл живёт в дорогом наборе.
import { describe, expect, it } from 'vitest'
import { branchPoints, buildSimState, referenceBuild } from '../simulate'
import { ensureStats } from '../stats'
import { estimateCombatRate } from '../combat'
import { axesOf } from '../equipment'
import { abilitiesOf, rotationOf } from '../state'
import { PLAN, rotationRate } from '../rotation'
import { ABILITY_SLOTS, LEVEL_CAP } from '../../data/balance'
import { DEFAULT_CLASS } from '../../data/classes'
import { ZONES } from '../../data/zones'
import {
  BRANCHES,
  CONCEPT_ROWS,
  pathRanks,
  pathsOf,
  talentsInBranch,
  type BranchId,
  type TalentPath,
} from '../../data/talents'
import { dump } from './dump'
import type { GameState } from '../state'

function combos<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (xs.length < k) return []
  const [head, ...rest] = xs
  return [...combos(rest, k - 1).map((c) => [head, ...c]), ...combos(rest, k)]
}

const zoneFor = (level: number) =>
  ZONES.find((z) => level >= z.monsterLevelRange.min && level <= z.monsterLevelRange.max) ?? ZONES[0]

const slotsOf = (ids: readonly string[]) => [...ids, null, null, null, null].slice(0, ABILITY_SLOTS)

const sameSet = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join('|') === [...b].sort().join('|')

interface BuildRow {
  branch: BranchId
  path: TalentPath
  /** Взятый ключевой на каждом ключевом этаже; «—» — ни одного. */
  keys: string[]
  /** Лучшая четвёрка полным перебором. */
  four: string[]
  /** Совпала ли лучшая четвёрка с той, под которую путь собран. */
  fourAsDesigned: boolean
  killsPerSecond: number
  damage: number
  survival: number
  /** Доля автоатаки в уроне лучшей четвёрки: кровь против всплесков. */
  autoShare: number
  /** Доля урона ПО ВРЕМЕНИ (тики эффектов) в уроне умений: кровь буквально. */
  dotShare: number
  /** Доля времени в бою (без привалов и смертей): ветка пауз видна здесь. */
  uptime: number
}

function measure(branch: BranchId, path: TalentPath): BuildRow {
  const ranks = pathRanks(path, branchPoints(LEVEL_CAP))
  const base = buildSimState(referenceBuild(LEVEL_CAP, DEFAULT_CLASS.id), zoneFor(LEVEL_CAP).id, 7)
  const talented: GameState = ensureStats({ ...base, talents: ranks, statsDirty: true })
  const rows = combos(abilitiesOf(DEFAULT_CLASS.id), ABILITY_SLOTS)
    .map((combo) => {
      const ids = combo.map((a) => a.id)
      return {
        ids,
        rate: estimateCombatRate({ ...talented, abilitySlots: slotsOf(ids) }, 'auto').killsPerSecond.toNumber(),
      }
    })
    .sort((a, b) => b.rate - a.rate)
  const best = rows[0]
  const bestState = { ...talented, abilitySlots: slotsOf(best.ids) }
  const axes = axesOf(bestState)
  const rate = estimateCombatRate(bestState, 'auto')
  const total = rate.autoDamagePerSecond.plus(rate.abilityDamagePerSecond).plus(rate.procDamagePerSecond)
  // Состав урона умений: сколько несут тики эффектов против самих ударов.
  // Та же ротация, что внутри оценки, — второй модели здесь нет.
  const rot = rotationRate(bestState.stats, rotationOf(bestState), PLAN.auto)
  let abilityAll = 0
  let dotAll = 0
  for (const cast of rot.casts) {
    abilityAll += cast.totalDamage.toNumber() * cast.castsPerSecond
    dotAll += cast.totalDamage.minus(cast.hitDamage).toNumber() * cast.castsPerSecond
  }
  const keys = CONCEPT_ROWS.map(
    (row) =>
      talentsInBranch(branch)
        .filter((t) => t.row === row)
        .find((t) => (ranks[t.id] ?? 0) > 0)?.id ?? '—',
  )
  return {
    branch,
    path,
    keys,
    four: best.ids,
    fourAsDesigned: path.abilities ? sameSet(best.ids, path.abilities) : false,
    killsPerSecond: best.rate,
    damage: axes.damage.toNumber(),
    survival: axes.survival.toNumber(),
    autoShare: total.gt(0) ? rate.autoDamagePerSecond.div(total).toNumber() : 0,
    dotShare: abilityAll > 0 ? dotAll / abilityAll : 0,
    uptime: rate.uptime,
  }
}

/** Заметное различие профиля: хотя бы одна ось ушла дальше, чем на эту долю. */
const AXIS_GAP = 0.05
/**
 * Заметное различие СОСТАВА: доля автоатаки, доля урона по времени или аптайм
 * разошлись на столько пунктов. Два пути Гнева сходятся по темпу до долей
 * процента — ключевые там и должны быть сопоставимы по силе, — но один бьёт
 * кровью, другой всплесками, и различие живёт в составе урона, а не в сумме.
 */
const SHARE_GAP = 0.03

const gap = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y)

/** Чем два профиля различаются — и различаются ли заметно. */
function compare(a: BuildRow, b: BuildRow) {
  const dmgGap = gap(a.damage, b.damage)
  const survGap = gap(a.survival, b.survival)
  // ТЕМП С АПТАЙМОМ. Две оси игрока по построению не видят пауз: ось урона —
  // чистая пропускная способность без привалов, ось живучести — запас за
  // схватку. Ветка Бдения ВСЯ про паузы, и по двум осям её стороны совпадут
  // всегда. `killsPerSecond` модели считает цикл привала и видит их.
  const paceGap = gap(a.killsPerSecond, b.killsPerSecond)
  const shareGap = Math.abs(a.autoShare - b.autoShare)
  const dotGap = Math.abs(a.dotShare - b.dotShare)
  const uptimeGap = Math.abs(a.uptime - b.uptime)
  const sameFour = sameSet(a.four, b.four)
  const differs =
    !sameFour ||
    dmgGap > AXIS_GAP ||
    survGap > AXIS_GAP ||
    paceGap > AXIS_GAP ||
    shareGap > SHARE_GAP ||
    dotGap > SHARE_GAP ||
    uptimeGap > SHARE_GAP
  const text =
    `урон ±${(dmgGap * 100).toFixed(1)} %, живучесть ±${(survGap * 100).toFixed(1)} %, ` +
    `темп ±${(paceGap * 100).toFixed(1)} %, автоатака ±${(shareGap * 100).toFixed(1)} п.п., ` +
    `по времени ±${(dotGap * 100).toFixed(1)} п.п., аптайм ±${(uptimeGap * 100).toFixed(1)} п.п.`
  return { sameFour, dmgGap, survGap, paceGap, shareGap, dotGap, uptimeGap, differs, text }
}

describe('шесть путей: выбор на ключевых этажах — настоящий', () => {
  const own = BRANCHES.filter((b) => b.classId === DEFAULT_CLASS.id)
  const table: BuildRow[] = []

  it('шесть путей посчитаны, и два пути одной ветки различаются', () => {
    // Таблица печатается ДО проверок: упавший тест обязан показать, что
    // именно совпало, а не отправлять читать код прибора.
    for (const branch of own) {
      for (const path of pathsOf(branch.id)) table.push(measure(branch.id, path))
    }
    // eslint-disable-next-line no-console
    console.table(
      table.map((r) => ({
        ветка: r.branch,
        путь: r.path.name,
        ключевые: r.keys.join(' · '),
        'лучшая четвёрка': r.four.join(' + '),
        'как заявлено': r.fourAsDesigned ? 'да' : 'НЕТ',
        'уб/с': r.killsPerSecond.toFixed(4),
        урон: r.damage.toFixed(1),
        живучесть: r.survival.toFixed(0),
        'автоатака %': (r.autoShare * 100).toFixed(1),
        'по времени %': (r.dotShare * 100).toFixed(1),
        'аптайм %': (r.uptime * 100).toFixed(1),
      })),
    )
    for (const r of table) {
      const key = `talents/${r.branch}/path-${r.path.id}`
      dump(`${key}/kills-per-second`, r.killsPerSecond)
      dump(`${key}/damage`, r.damage)
      dump(`${key}/survival`, r.survival)
      dump(`${key}/auto-share`, r.autoShare)
      dump(`${key}/dot-share`, r.dotShare)
      dump(`${key}/uptime`, r.uptime)
      dump(`${key}/four-as-designed`, r.fourAsDesigned ? 1 : 0)
      // КАЖДЫЙ ПУТЬ БЕРЁТ ОДИН КЛЮЧ НА КАЖДОМ КЛЮЧЕВОМ ЭТАЖЕ — иначе путь
      // измеряет не выбор, а его отсутствие.
      expect(r.keys, `${r.path.name}: ключевые этажи`).not.toContain('—')
    }
    for (const branch of own) {
      const [a, b] = table.filter((r) => r.branch === branch.id)
      const c = compare(a, b)
      dump(`talents/${branch.id}/paths/four-differ`, c.sameFour ? 0 : 1)
      dump(`talents/${branch.id}/paths/damage-gap`, c.dmgGap)
      dump(`talents/${branch.id}/paths/survival-gap`, c.survGap)
      dump(`talents/${branch.id}/paths/pace-gap`, c.paceGap)
      dump(`talents/${branch.id}/paths/auto-share-gap`, c.shareGap)
      dump(`talents/${branch.id}/paths/dot-share-gap`, c.dotGap)
      dump(`talents/${branch.id}/paths/uptime-gap`, c.uptimeGap)
      // ЖЁСТКО: либо четвёрка другая, либо профиль ушёл заметно.
      expect(
        c.differs,
        `${branch.name}: «${a.path.name}» и «${b.path.name}» дают ту же четвёрку и тот же ` +
          `профиль (${c.text}) — ключевые различаются только величиной`,
      ).toBe(true)
    }
  }, 1_800_000)

  it('Бдение против Гнева: расхождение веток — только запись, не контракт', () => {
    // ЗАПИСЬ, А НЕ ПАДЕНИЕ. Вопрос ночи: разошлись ли ветки ПО РОДУ, а не
    // только по силе, — Бдение про паузы и экономию, Гнев про урон. Если
    // профили совпадают, это записывается в отчёт, и чинить это ночью
    // нельзя: разводить ветки — это баланс.
    if (table.length === 0) {
      for (const branch of own) {
        for (const path of pathsOf(branch.id)) table.push(measure(branch.id, path))
      }
    }
    const wrath = table.filter((r) => r.branch === 'warden-wrath')
    const vigil = table.filter((r) => r.branch === 'warden-vigil')
    for (const w of wrath) {
      for (const v of vigil) {
        const c = compare(w, v)
        // eslint-disable-next-line no-console
        console.log(
          `Гнев «${w.path.name}» против Бдения «${v.path.name}»: ${c.differs ? 'разошлись' : 'СОВПАЛИ'} — ` +
            `${c.text}; четвёрка ${c.sameFour ? 'та же' : 'другая'}`,
        )
        dump(`talents/vigil-vs-wrath/${w.path.id}/${v.path.id}/pace-gap`, c.paceGap)
        dump(`talents/vigil-vs-wrath/${w.path.id}/${v.path.id}/uptime-gap`, c.uptimeGap)
        dump(`talents/vigil-vs-wrath/${w.path.id}/${v.path.id}/four-differ`, c.sameFour ? 0 : 1)
      }
    }
    expect(wrath.length).toBe(2)
    expect(vigil.length).toBe(2)
  }, 1_800_000)
})
