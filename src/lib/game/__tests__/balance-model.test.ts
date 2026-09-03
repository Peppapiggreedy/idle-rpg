// Прогон баланса: гоняет настоящий конвейер тика часами игрового времени и
// печатает таблицы, по которым видно, во что превращается баланс на практике.
// Проверки фиксируют свойства, ради которых зоны и оружие вообще существуют:
// прогресс монотонный, доминирующей зоны нет, прокачка не мгновенная,
// подходящая зона не убивает, а выбор оружия не схлопывается.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { expectedSwingDamage } from '../combat'
import { estimateCombatRate, estimateTtk } from '../combat'
import { dungeonOpening } from '../../data/dungeons'
import {
  AVERAGE_WEAPON,
  BALANCE_PRESET,
  buildSimState,
  unlockedByLevel,
  currentCell,
  pacingTable,
  referenceBuild,
  branchPoints,
  pureBranchTalents,
  simulate,
  spreadOf,
  styleBuild,
  ttkDrift,
  PACING_MAX_LEVEL,
  SIM_STYLES,
  type PacingRow,
  type SimBuild,
  type SimResult,
  type SimStyle,
} from '../simulate'
import { forecastZone, intendedZone, type ZoneStanding } from '../zones'
import {
  FIGHT_COST_NET_TARGET,
  FIGHT_COST_TARGET,
  RESPAWN_DELAY_MS,
  REST_DURATION_S,
  TTK_AHEAD_MIN,
  TTK_BEHIND_MAX,
  TTK_DRIFT_MAX,
  TTK_HARD_CEILING,
  TTK_HARD_FLOOR,
  TTK_TARGET_MAX,
  TTK_TARGET_MIN,
} from '../../data/balance'
import {
  averageMonsterLevel,
  representativeMonster,
  ZONES,
  ZONE_BY_ID,
  zoneMonsterVariants,
  type Zone,
} from '../../data/zones'
import { ONE_HANDED, WEAPONS } from '../../data/items'
import { BRANCHES, type BranchDef, type BranchStyle } from '../../data/talents'
import { DEFAULT_CLASS, classById } from '../../data/classes'
import { classIt, contractClasses } from './class-set'
import { dump } from './dump'
import { ABILITIES, ABILITY_BY_ID } from '../../data/abilities'
import { monsterFromTemplate, type GameState } from '../state'
import { CONTRACT_SEED, SAMPLE, ZONE_SET, CLASS_SET, sampleHours, sampleSeeds, log, num, pct, ttk, header, row, COLUMNS, hitsPerKill } from './balance-shared'

describe('оценка сходится с прогоном при любом крите', () => {
  // ДЕВЯТЬ ЗАМЕРОВ: три уровня × три крита. Модель обязана сходиться с
  // настоящим прогоном тика не только на природном крите эталонного героя
  // (там она была откалибрована и сходилась в 5 %), но и без крита вовсе, и
  // с +25 п.п. сверху: до стадии «крит в потоке» три строки одного уровня
  // давали ОДИН прогноз при разнице настоящего темпа в 29 % (AUDIT.md, 1.1).
  // Сравнивается ровно то, что видит игрок: `forecastZone` по пулу зоны против
  // `simulate` с замороженным уровнем в той же зоне, тем же билдом.
  const LEVELS = SAMPLE ? [55] : [25, 55, 85]
  const TOLERANCE = 0.1
  const HOURS = sampleHours(4)
  const variants = (natural: number) =>
    [
      { name: 'без крита', mods: [critMod(-natural)] },
      { name: 'свой', mods: [] },
      { name: '+25 п.п.', mods: [critMod(0.25)] },
    ] as const
  const critMod = (value: number) =>
    ({ stat: 'critChance', kind: 'flat', value: new Decimal(value), source: 'equipment:mainHand' }) as const

  it(`девять замеров уровень × крит расходятся не больше чем на ${TOLERANCE * 100} %`, () => {
    header(
      `Оценка против прогона, ${HOURS} ч на клетку, уровень заморожен.`,
      'уровень  крит          оценка уб/ч   прогон уб/ч   расхождение',
    )
    for (const level of LEVELS) {
      const zone = intendedZone(level)
      const base = referenceBuild(level)
      const natural = buildSimState(base, zone.id, CONTRACT_SEED).stats.critChance
      for (const variant of variants(natural)) {
        const build: SimBuild = { ...base, extraMods: [...variant.mods] }
        const state = buildSimState(build, zone.id, CONTRACT_SEED)
        // Клетку различает ВАРИАНТ КРИТА, а не строка таблицы: natural —
        // свой крит (модификаторов нет), zero — срезанный, plus25 — с добавкой.
        const estimate = dump(
          `balance/model-vs-tick/level-${String(level).padStart(3, '0')}/crit-${
            variant.mods.length === 0 ? 'natural' : state.stats.critChance > natural ? 'plus25' : 'zero'
          }/model-kills-per-hour`,
          forecastZone(state, zone).killsPerHour.toNumber(),
        )
        const actual = dump(
          `balance/model-vs-tick/level-${String(level).padStart(3, '0')}/crit-${
            variant.mods.length === 0 ? 'natural' : state.stats.critChance > natural ? 'plus25' : 'zero'
          }/tick-kills-per-hour`,
          simulate({
            hours: HOURS,
            zoneId: zone.id,
            freezeLevel: true,
            build,
            seed: CONTRACT_SEED,
          }).killsPerHour.toNumber(),
        )
        const diff = (estimate - actual) / actual
        log(
          `${String(level).padStart(7)}  ${`${variant.name} (${(state.stats.critChance * 100).toFixed(0)}%)`.padEnd(13)} ${estimate.toFixed(1).padStart(12)} ${actual.toFixed(1).padStart(13)}   ${(diff * 100).toFixed(1).padStart(6)}%`,
        )
        expect(
          dump(
            `balance/model-vs-tick/level-${String(level).padStart(3, '0')}/crit-${
              variant.mods.length === 0 ? 'natural' : state.stats.critChance > natural ? 'plus25' : 'zero'
            }/rel-diff-abs`,
            Math.abs(diff),
          ),
          `ур. ${level}, ${variant.name}`,
        ).toBeLessThanOrEqual(TOLERANCE)
      }
    }
  }, 900_000)
})

describe('интервал решений', () => {
  const {
    decisionMinSec,
    decisionMaxSec,
    decisionAlertSec,
    telemetryHours,
    telemetryLevels,
    restShareMax,
  } = BALANCE_PRESET

  // Что считается решением — в simulate.ts: находка выше обычной, очко
  // таланта, открывшаяся зона. Мерим в подходящей по уровню зоне: игрок
  // в ней и сидит, и «сколько раз в час игра спросила» — это про неё.
  const rows = CLASS_SET.flatMap((hero) =>
    telemetryLevels.map((level) => {
      const zone = intendedZone(level)
      const result = simulate({
        hours: telemetryHours,
        zoneId: zone.id,
        seed: BALANCE_PRESET.pacingSeed,
        bag: 'sell',
        build: referenceBuild(level, hero.id),
      })
      return { hero, level, zone, result }
    }),
  )

  it('печатает интервал решений по классам и уровням', () => {
    header(
      `Эталонный герой в подходящей зоне, ${telemetryHours} ч на строку. ` +
        'Решение — находка выше обычной, очко таланта, открывшаяся зона.',
      'класс          ур.   зона                 интервал   привалов/ч   простой   смертей/ч',
    )
    for (const row of rows) {
      const gap = row.result.decisionIntervalSec
      const mark = gap !== null && gap >= decisionMinSec && gap <= decisionMaxSec ? '✓' : ' '
      log(
        `${row.hero.name.padEnd(14)} ${String(row.level).padStart(3)}   ` +
          `${row.zone.name.padEnd(20)} ${(gap?.toFixed(0) ?? '—').padStart(6)}с${mark}  ` +
          `${row.result.restsPerHour.toFixed(1).padStart(10)}   ` +
          `${pct(row.result.restShare).padStart(7)}   ` +
          `${row.result.deathsPerHour.toFixed(2).padStart(9)}`,
      )
    }
    expect(rows.length).toBe(CLASS_SET.length * telemetryLevels.length)
  })

  for (const cls of CLASS_SET) {
    const own = rows.filter((row) => row.hero.id === cls.id)

    classIt(cls)(
      `${cls.name}: интервал решений ${decisionMinSec}-${decisionMaxSec} с на большей части прогрессии`,
      () => {
        let inWindow = 0
        for (const row of own) {
          const gap = row.result.decisionIntervalSec
          if (gap !== null && gap >= decisionMinSec && gap <= decisionMaxSec) inWindow += 1
          // ПОТОЛОК ТРЕВОГИ. Реже раза в три минуты — это уже не idle, а пустой
          // экран: игрок открывает вкладку и не находит, что нажать.
          expect(
            dump(
              `balance/telemetry/class-${row.hero.id}/level-${String(row.level).padStart(3, '0')}/decision-interval-sec`,
              gap ?? Number.POSITIVE_INFINITY,
            ),
            `${row.hero.id}, ур. ${row.level}`,
          ).toBeLessThanOrEqual(decisionAlertSec)
        }
        log(`${cls.name}: в окне ${inWindow} из ${own.length} строк (${pct(inWindow / own.length)}).`)
        // «На большей части»: края прогрессии выпадают законно — на первом уровне
        // решений больше обычного, на последнем меньше.
        expect(
          dump(`balance/telemetry/class-${cls.id}/decision-in-window-share`, inWindow / own.length),
        ).toBeGreaterThanOrEqual(0.6)
      },
      600_000,
    )

    classIt(cls)(
      `${cls.name}: на привалах уходит не больше ${pct(restShareMax)} времени`,
      () => {
        // Привал — пауза, а не занятие. Четверть времени на костре ещё читается
        // как ритм; больше — как налог на то, что герой вообще дерётся.
        for (const row of own) {
          expect(
            dump(
              `balance/telemetry/class-${row.hero.id}/level-${String(row.level).padStart(3, '0')}/rest-share`,
              row.result.restShare,
            ),
            `${row.hero.id}, ур. ${row.level}`,
          ).toBeLessThanOrEqual(restShareMax)
        }
      },
      600_000,
    )
  }
})
