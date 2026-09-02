// ЭТОТ ФАЙЛ — ЧАСТЬ ДОРОГОГО НАБОРА (`npm run test:balance`), а не быстрого.
// Он строит эталонное прохождение на оба класса и считает прогноз по каждой
// из двадцати зон на девяти уровнях — это минута с лишним, то есть вдвое
// больше, чем весь быстрый набор обязан занимать целиком. Быстрый набор
// ловит опечатки и поломки, дорогой — кривые; этот тест про кривую.
// ГЕРОЙ НЕ ПЕРЕПРЫГИВАЕТ ЗОНЫ.
//
// Замер до правки: эталонный герой ТРИДЦАТОГО уровня выживал в последней зоне
// игры, где мобы 96-100. Обгон рос с +10 на пятом уровне до +70 на тридцатом
// и ниже нуля не опускался нигде — то есть «зона по уровню» держалась не на
// правиле, а на том, что глубоко фармить невыгодно.
//
// Лечится это штрафом за РАЗРЫВ УРОВНЕЙ, а не ставкой роста урона: всё в игре
// растёт линейно, а у линейных функций отношение соседних зон от ставки не
// зависит и с уровнем стремится к единице. Резкой отсечки линейная кривая не
// даёт ни при каком числе — это показано отдельным тестом ниже.
import { describe, expect, it } from 'vitest'
import { buildSimState, referenceBuild } from './simulate'
import { forecastZone } from './zones'
import { estimateZoneTtk } from './combat'
import {
  LEVEL_GAP_FREE,
  LEVEL_GAP_DAMAGE_PER_LEVEL,
  TTK_TARGET_MIN,
  levelGapDamageMult,
} from '../data/balance'
import { MONSTER_GROWTH } from '../data/monsters'
import { ZONES, averageMonsterLevel, zoneForMonsterLevel } from '../data/zones'
import { classIt, contractClasses } from './__tests__/class-set'

const SAMPLE = process.env.BALANCE_SAMPLE === '1'
/** Готовые классы — контракт, превью — предупреждение (см. class-set.ts). */
const CLASS_SET = contractClasses(SAMPLE)

/** Уровни таблицы: десятками, как просили в задании. */
const LEVELS = [10, 20, 30, 40, 50, 60, 70, 80, 90]

/** Насколько глубже своей зоны герой забирается, в уровнях мобов. */
function overrun(level: number, classId: string): { risky: number; solid: number } {
  const build = referenceBuild(level, classId)
  const own = averageMonsterLevel(zoneForMonsterLevel(level) ?? ZONES[0])
  let risky = -Infinity
  let solid = -Infinity
  for (const zone of ZONES) {
    const state = buildSimState(build, zone.id, 1)
    const forecast = forecastZone(state, zone)
    const gap = averageMonsterLevel(zone) - own
    // «Не гибнет» — вердикт safe или risky. hopeless ХУЖЕ deadly: там герой
    // не добивает даже одного моба.
    if (forecast.verdict === 'safe' || forecast.verdict === 'risky') {
      risky = Math.max(risky, gap)
    }
    if (forecast.uptime >= 0.9) solid = Math.max(solid, gap)
  }
  return { risky, solid }
}

describe('штраф за разрыв уровней', () => {
  it('внутри своей зоны штрафа нет ни у кого', () => {
    // Полоса зоны — пять уровней мобов, и бесплатный разрыв ровно такой же.
    // Иначе штраф попадал бы по герою, который стоит там, где ему и место.
    for (let gap = -10; gap <= LEVEL_GAP_FREE; gap += 1) {
      expect(levelGapDamageMult(50, 50 + gap), `разрыв ${gap}`).toBe(1)
    }
  })

  it('за каждый уровень сверх бесплатных моб бьёт больнее', () => {
    expect(levelGapDamageMult(50, 50 + LEVEL_GAP_FREE + 1)).toBeCloseTo(
      1 + LEVEL_GAP_DAMAGE_PER_LEVEL,
      9,
    )
    expect(levelGapDamageMult(50, 50 + LEVEL_GAP_FREE + 10)).toBeCloseTo(
      1 + LEVEL_GAP_DAMAGE_PER_LEVEL * 10,
      9,
    )
    // Отставший моб бьёт как обычно: штраф односторонний.
    expect(levelGapDamageMult(50, 20)).toBe(1)
  })

  it('ЛИНЕЙНАЯ СТАВКА УРОНА РЕЗКОЙ ОТСЕЧКИ НЕ ДАЁТ — ни при каком числе', () => {
    // Почему штраф вообще понадобился, одной арифметикой. Отношение урона
    // соседних зон при линейном росте: (1 + r*(L+4)) / (1 + r*(L-1)). При
    // любой ставке r оно с уровнем стремится к единице, а запас прочности
    // героя в своей зоне двукратный — то есть подъём на одну зону ему
    // ничего не стоит, сколько ставку ни поднимай.
    const ratio = (r: number, level: number) => (1 + r * (level + 4)) / (1 + r * (level - 1))
    const current = MONSTER_GROWTH.damagePerLevel.toNumber()
    for (const r of [current, current * 3, current * 10]) {
      expect(ratio(r, 50), `ставка ${r}`).toBeLessThan(1.15)
    }
    // А штраф за разрыв даёт скачок сразу: одна зона глубже — уже другой бой.
    expect(levelGapDamageMult(50, 60)).toBeGreaterThan(1.5)
  })
})

describe('обгон зон: до +5 уверенно, до +10 с риском, глубже никак', () => {
  // Таблица печатается целиком: контракт нужен глазами не меньше, чем галкой.
  const rows = CLASS_SET.flatMap((cls) =>
    LEVELS.map((level) => ({ cls, level, ...overrun(level, cls.id) })),
  )

  it('печатает таблицу обгона', () => {
    const lines = rows.map(
      (r) =>
        `${r.cls.name.padEnd(7)} ур.${String(r.level).padStart(3)}  ` +
        `уверенно +${r.solid.toFixed(0).padStart(2)}   с риском +${r.risky.toFixed(0).padStart(2)}`,
    )
    // eslint-disable-next-line no-console
    console.log('\nОБГОН ЗОН\n' + lines.join('\n'))
    expect(rows).toHaveLength(CLASS_SET.length * LEVELS.length)
  })

  for (const row of rows) {
    const cit = classIt(row.cls)
    const label = `${row.cls.name} ур.${row.level}`

    cit(`${label}: уверенно не глубже +5`, () => {
      expect(row.solid).toBeLessThanOrEqual(LEVEL_GAP_FREE)
    })

    cit(`${label}: даже с риском не глубже +10`, () => {
      expect(row.risky).toBeLessThanOrEqual(LEVEL_GAP_FREE * 2)
    })
  }

  for (const cls of CLASS_SET) {
    classIt(cls)(`${cls.name}: своя зона по-прежнему в коридоре темпа`, () => {
      // Штраф не должен задеть тех, кто стоит где положено: внутри своей зоны
      // разрыв бесплатен, и время убийства обязано остаться прежним.
      for (const level of LEVELS) {
        const own = zoneForMonsterLevel(level) ?? ZONES[0]
        const state = buildSimState(referenceBuild(level, cls.id), own.id, 1)
        const ttk = estimateZoneTtk(state, own).avg
        expect(ttk, `${cls.id} ур.${level}`).toBeGreaterThanOrEqual(TTK_TARGET_MIN)
      }
    })
  }
})
