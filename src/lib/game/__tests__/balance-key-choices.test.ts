// ШЕСТЬ СБОРОК ВМЕСТО ТРЁХ: ВЗАИМОИСКЛЮЧЕНИЕ ДЕЛИТ КАЖДУЮ ВЕТКУ НАДВОЕ.
//
// На ключевых этажах 5, 9 и 13 стоят по два таланта, и берётся один. Если
// сборка «сторона А на всех трёх» и сборка «сторона Б на всех трёх» дают
// одинаковую лучшую четвёрку И одинаковый профиль по осям — ключевые
// различаются только величиной, и пара обязана быть переделана: ветка, где
// ключевой выбор формален, хуже ветки без выбора — она обещает и не даёт.
//
// Полный перебор четвёрок (C(11,4) = 330) на шесть сборок: файл живёт в
// дорогом наборе, а не в быстром.
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
  TALENT_BY_ID,
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

/** Ключевые таланты ветки: по этажам, в порядке данных. */
function keyPairs(branch: BranchId) {
  return CONCEPT_ROWS.map((row) => talentsInBranch(branch).filter((t) => t.row === row))
}

/**
 * Сборка «сторона N на всех ключевых этажах». Строится из ПЕРВОГО пути
 * ветки: из его порядка выбрасываются ключевые таланты другой стороны, а
 * выбранная сторона ставится первой — чтобы очков на неё точно хватило.
 * Всё остальное покупается как в пути.
 */
function sideBuild(branch: BranchId, side: number): { path: TalentPath; ranks: Record<string, number> } {
  const pairs = keyPairs(branch)
  const chosen = pairs.map((pair) => pair[Math.min(side, pair.length - 1)].id)
  const others = new Set(pairs.flat().map((t) => t.id).filter((id) => !chosen.includes(id)))
  const base = pathsOf(branch)[0]
  // ОПОРЫ СТРЕЛОК ИДУТ ПЕРЕД КЛЮЧЕВЫМИ. Венец со стрелкой недостижим, пока
  // опора не набрана, а опора в общем порядке пути может стоять в хвосте — и
  // очки кончатся раньше. Первый замер так и вышел: «Несдвигаемый» и оба
  // ключевых Бдения со стрелками остались невзятыми.
  const anchored: string[] = []
  const pull = (id: string) => {
    const need = TALENT_BY_ID[id]?.requires
    if (need) pull(need.talentId)
    if (!anchored.includes(id)) anchored.push(id)
  }
  for (const id of chosen) pull(id)
  const order = [...anchored, ...base.order.filter((id) => !anchored.includes(id) && !others.has(id))]
  const path: TalentPath = { id: `${base.id}:сторона-${side}`, name: `сторона ${side}`, order, abilities: base.abilities }
  return { path, ranks: pathRanks(path, branchPoints(LEVEL_CAP)) }
}

interface BuildRow {
  branch: string
  side: number
  keys: string[]
  four: string[]
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

function measure(branch: BranchId, side: number): BuildRow {
  const { ranks } = sideBuild(branch, side)
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
  const keys = keyPairs(branch).map((pair) => pair.find((t) => (ranks[t.id] ?? 0) > 0)?.id ?? '—')
  return {
    branch,
    side,
    keys,
    four: best.ids,
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
 * Заметное различие СОСТАВА: доля автоатаки или аптайм разошлись на столько
 * пунктов. Две сборки Гнева сходятся по темпу до долей процента — ключевые
 * там и должны быть сопоставимы по силе, — но одна бьёт кровью, другая
 * всплесками, и различие живёт в составе урона, а не в его сумме.
 */
const SHARE_GAP = 0.03

describe('шесть сборок: выбор на ключевых этажах — настоящий', () => {
  const own = BRANCHES.filter((b) => b.classId === DEFAULT_CLASS.id)
  const table: BuildRow[] = []

  it('шесть сборок посчитаны и различаются внутри ветки', () => {
    // Таблица печатается ДО проверок: упавший тест обязан показать, что
    // именно совпало, а не отправлять читать код прибора.
    for (const branch of own) table.push(measure(branch.id, 0), measure(branch.id, 1))
    // eslint-disable-next-line no-console
    console.table(
      table.map((r) => ({
        ветка: r.branch,
        сторона: r.side,
        ключевые: r.keys.join(' · '),
        четвёрка: r.four.join(' + '),
        'уб/с': r.killsPerSecond.toFixed(4),
        урон: r.damage.toFixed(1),
        живучесть: r.survival.toFixed(0),
        'автоатака %': (r.autoShare * 100).toFixed(1),
        'по времени %': (r.dotShare * 100).toFixed(1),
        'аптайм %': (r.uptime * 100).toFixed(1),
      })),
    )
    for (const branch of own) {
      const a = table.find((r) => r.branch === branch.id && r.side === 0)!
      const b = table.find((r) => r.branch === branch.id && r.side === 1)!
      const sameFour = [...a.four].sort().join('|') === [...b.four].sort().join('|')
      const gap = (x: number, y: number) => Math.abs(x - y) / Math.max(x, y)
      const dmgGap = gap(a.damage, b.damage)
      const survGap = gap(a.survival, b.survival)
      // ТРЕТЬЕ ИЗМЕРЕНИЕ — ТЕМП С АПТАЙМОМ. Две оси игрока по построению не
      // видят пауз: ось урона — чистая пропускная способность без привалов,
      // ось живучести — запас за схватку. Ветка Бдения ВСЯ про паузы, и по
      // двум осям её стороны совпадут всегда, сколько бы они ни различались
      // в игре. `killsPerSecond` модели считает цикл привала и видит их.
      const paceGap = gap(a.killsPerSecond, b.killsPerSecond)
      // ЧЕТВЁРТОЕ И ПЯТОЕ — СОСТАВ. Гнев делится на кровь и всплески при
      // равной сумме урона: разница — в том, ЧТО бьёт, и её видно только по
      // доле автоатаки. Аптайм — то же для Бдения.
      const shareGap = Math.abs(a.autoShare - b.autoShare)
      const dotGap = Math.abs(a.dotShare - b.dotShare)
      const uptimeGap = Math.abs(a.uptime - b.uptime)
      const profileDiffers =
        dmgGap > AXIS_GAP ||
        survGap > AXIS_GAP ||
        paceGap > AXIS_GAP ||
        shareGap > SHARE_GAP ||
        dotGap > SHARE_GAP ||
        uptimeGap > SHARE_GAP
      dump(`talents/${branch.id}/sides/four-differ`, sameFour ? 0 : 1)
      dump(`talents/${branch.id}/sides/damage-gap`, dmgGap)
      dump(`talents/${branch.id}/sides/survival-gap`, survGap)
      dump(`talents/${branch.id}/sides/pace-gap`, paceGap)
      dump(`talents/${branch.id}/sides/auto-share-gap`, shareGap)
      dump(`talents/${branch.id}/sides/dot-share-gap`, dotGap)
      dump(`talents/${branch.id}/sides/uptime-gap`, uptimeGap)
      // ЖЁСТКО: либо четвёрка другая, либо профиль ушёл заметно.
      expect(
        !sameFour || profileDiffers,
        `${branch.name}: обе стороны дают ту же четвёрку и тот же профиль ` +
          `(урон ±${(dmgGap * 100).toFixed(1)} %, живучесть ±${(survGap * 100).toFixed(1)} %, ` +
          `темп ±${(paceGap * 100).toFixed(1)} %, автоатака ±${(shareGap * 100).toFixed(1)} п.п., ` +
          `по времени ±${(dotGap * 100).toFixed(1)} п.п., аптайм ±${(uptimeGap * 100).toFixed(1)} п.п.) ` +
          '— ключевые различаются только величиной',
      ).toBe(true)
    }
  }, 1_800_000)
})
