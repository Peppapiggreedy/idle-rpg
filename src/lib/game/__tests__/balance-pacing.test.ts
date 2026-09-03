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

describe('контракт темпа боя', () => {
  // ОДИН вызов на класс. `pacingTable` — это шестьдесят игровых часов
  // настоящего тика, и до кеша их прогонялось три штуки: общая таблица плюс
  // по таблице на класс, — при том что у общей класс ДЕФОЛТНЫЙ, то есть один
  // из тех же двух. Считалось одно и то же дважды.
  const pacingCache = new Map<string, PacingRow[]>()
  const pacing = (classId: string = DEFAULT_CLASS.id): PacingRow[] => {
    const cached = pacingCache.get(classId)
    if (cached) return cached
    const built = pacingTable({ classId })
    pacingCache.set(classId, built)
    return built
  }
  const rows = pacing()

  // Контракт держится для КАЖДОГО класса, а не только для дефолтного: класс
  // меняет ресурс, умения и стартовые статы, то есть ровно те числа, из
  // которых складывается длина боя.
  describe.each(CLASS_SET)('$name', (cls) => {
    const classId = cls.id
    const classRows = pacing(classId)
    const cit = classIt(cls)

    cit(`моб актуальной зоны живёт ${TTK_TARGET_MIN}-${TTK_TARGET_MAX} секунд`, () => {
      const ttks = classRows.map((r) => currentCell(r).ttk.avg)
      log(
        `${classId}: TTK ${Math.min(...ttks).toFixed(1)}-${Math.max(...ttks).toFixed(1)} с, ` +
          `разброс ${pct(ttkDrift(classRows))}, до ${classRows[classRows.length - 1].level} уровня ` +
          `за ${(classRows[classRows.length - 1].atSec / 60).toFixed(0)} мин.`,
      )
      for (const row of classRows) {
        const { ttk: t, zoneId } = currentCell(row)
        const where = `${classId}, ур. ${row.level}, ${zoneId}`
        expect(
          dump(
            `balance/pacing/class-${classId}/level-${String(row.level).padStart(3, '0')}/current-zone/ttk-avg`,
            t.avg,
          ),
          where,
        ).toBeGreaterThanOrEqual(TTK_TARGET_MIN)
        expect(
          dump(
            `balance/pacing/class-${classId}/level-${String(row.level).padStart(3, '0')}/current-zone/ttk-avg`,
            t.avg,
          ),
          where,
        ).toBeLessThanOrEqual(TTK_TARGET_MAX)
      }
    })

    cit(`разброс TTK по уровням ≤ ${pct(TTK_DRIFT_MAX)}`, () => {
      expect(
        dump(`balance/pacing/class-${classId}/ttk-drift`, ttkDrift(classRows)),
      ).toBeLessThanOrEqual(TTK_DRIFT_MAX)
    })
  }, 300_000)

  const cellsWith = (standing: ZoneStanding) =>
    rows.flatMap((r) => r.cells.filter((c) => c.standing === standing).map((c) => ({ row: r, c })))

  it('печатает время убийства по зонам и уровням', () => {
    const columns =
      'ур.  ' +
      ZONES.map((z) => `${z.name.slice(0, 9)} ${z.monsterLevelRange.min}-${z.monsterLevelRange.max}`.padStart(18)).join('') +
      '  ур.вещей  смертей   минут'
    header(
      'Эталонное прохождение: герой в СРЕДНЕЙ по рулетке экипировке, всё золото ' +
        'в вещи своей зоны, переезд по мере открытия зон.\n' +
        '* актуальная зона, < отстающая, > опережающая. В скобках — самый быстрый и самый долгий моб зоны.',
      columns,
    )
    for (const r of rows) {
      const cells = r.cells.map((c) => {
        const mark = c.standing === 'current' ? '*' : c.standing === 'behind' ? '<' : c.standing === 'ahead' ? '>' : ' '
        return `${mark}${ttk(c.ttk.avg)} (${ttk(c.ttk.min)}-${ttk(c.ttk.max)})`.padStart(18)
      })
      log(
        `${String(r.level).padStart(3)}  ${cells.join('')}  ${String(r.gearLevel).padStart(8)}  ` +
          `${String(r.deaths).padStart(7)}  ${(r.atSec / 60).toFixed(1).padStart(6)}`,
      )
    }
    log(`Разброс TTK по уровням: ${pct(ttkDrift(rows))} при потолке ${pct(TTK_DRIFT_MAX)}.`)
    // Строк меньше, чем уровней, и это нормально: ближе к концу опыта за бой
    // хватает на несколько уровней разом, и снимок делается на взятом уровне,
    // а не на каждом по счёту. Важно, что прохождение ДОШЛО до конца лестницы.
    expect(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/final-level`, rows[rows.length - 1].level),
    ).toBeGreaterThanOrEqual(PACING_MAX_LEVEL)
    expect(dump(`balance/pacing/class-${DEFAULT_CLASS.id}/first-level`, rows[0].level)).toBe(1)
  }, 300_000)

  it(`в актуальной зоне моб живёт ${TTK_TARGET_MIN}-${TTK_TARGET_MAX} секунд на ВСЕХ уровнях`, () => {
    for (const row of rows) {
      const { ttk: t, zoneId } = currentCell(row)
      const where = `ур. ${row.level}, ${zoneId}`
      expect(
        dump(
          `balance/pacing/class-${DEFAULT_CLASS.id}/level-${String(row.level).padStart(3, '0')}/current-zone/ttk-avg`,
          t.avg,
        ),
        where,
      ).toBeGreaterThanOrEqual(TTK_TARGET_MIN)
      expect(
        dump(
          `balance/pacing/class-${DEFAULT_CLASS.id}/level-${String(row.level).padStart(3, '0')}/current-zone/ttk-avg`,
          t.avg,
        ),
        where,
      ).toBeLessThanOrEqual(TTK_TARGET_MAX)
    }
  })

  it(`ни один моб актуальной зоны не умирает быстрее ${TTK_HARD_FLOOR} секунд`, () => {
    // Ниже этого бой перестаёт быть событием: игрок не успевает ни прочитать
    // имя моба, ни нажать умение.
    for (const row of rows) {
      const { ttk: t, zoneId } = currentCell(row)
      expect(
        dump(
          `balance/pacing/class-${DEFAULT_CLASS.id}/level-${String(row.level).padStart(3, '0')}/current-zone/ttk-min`,
          t.min,
        ),
        `ур. ${row.level}, ${zoneId}`,
      ).toBeGreaterThanOrEqual(TTK_HARD_FLOOR)
    }
  })

  it(`ни один моб актуальной зоны не живёт дольше ${TTK_HARD_CEILING} секунд`, () => {
    for (const row of rows) {
      const { ttk: t, zoneId } = currentCell(row)
      expect(
        dump(
          `balance/pacing/class-${DEFAULT_CLASS.id}/level-${String(row.level).padStart(3, '0')}/current-zone/ttk-max`,
          t.max,
        ),
        `ур. ${row.level}, ${zoneId}`,
      ).toBeLessThanOrEqual(TTK_HARD_CEILING)
    }
  })

  it(`отстающая зона проходится с ходу: не дольше ${TTK_BEHIND_MAX} секунд на моба`, () => {
    const cells = cellsWith('behind')
    // Пустая проверка — не проверка: если классификация перестала кого-то
    // относить к отстающим, контракт молча выродился бы в ничто.
    expect(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/behind-cells`, cells.length),
      'ни одна зона не оказалась отстающей',
    ).toBeGreaterThan(0)
    for (const { row, c } of cells) {
      expect(
        dump(
          `balance/pacing/class-${DEFAULT_CLASS.id}/level-${String(row.level).padStart(3, '0')}/zone-${c.zoneId}/ttk-avg`,
          c.ttk.avg,
        ),
        `ур. ${row.level}, ${c.zoneId}`,
      ).toBeLessThanOrEqual(TTK_BEHIND_MAX)
    }
  })

  it(`опережающая зона видна сразу: не быстрее ${TTK_AHEAD_MIN} секунд на моба`, () => {
    const cells = cellsWith('ahead')
    expect(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/ahead-cells`, cells.length),
      'ни одна зона не оказалась опережающей',
    ).toBeGreaterThan(0)
    for (const { row, c } of cells) {
      expect(
        dump(
          `balance/pacing/class-${DEFAULT_CLASS.id}/level-${String(row.level).padStart(3, '0')}/zone-${c.zoneId}/ttk-avg`,
          c.ttk.avg,
        ),
        `ур. ${row.level}, ${c.zoneId}`,
      ).toBeGreaterThanOrEqual(TTK_AHEAD_MIN)
    }
  })

  it(`темп не сжимается с прогрессом: разброс TTK по уровням ≤ ${pct(TTK_DRIFT_MAX)}`, () => {
    // Главная проверка контракта. Без неё коридор 8-15 выполнялся бы «в
    // среднем»: первый уровень у потолка, последний у пола — и бой к концу
    // игры проходился бы вдвое быстрее, чем в начале.
    expect(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/ttk-drift`, ttkDrift(rows)),
    ).toBeLessThanOrEqual(TTK_DRIFT_MAX)
  })

  it('у каждого уровня есть и «полегче», и «потяжелее» — выбор, а не коридор', () => {
    // Смысл одиннадцати ступеней вместо четырёх: выбор из трёх зон вместо
    // единственной. Отстающая — куда можно сходить за лутом с ходу;
    // опережающая — цель, до которой ещё расти.
    //
    // КРАЯ ЛЕСТНИЦЫ — законное исключение, и его надо назвать вслух: у
    // новичка нет зоны ниже стартовой, а у героя, добравшегося до последней,
    // нет зоны выше. Поэтому проверяем три вещи: актуальная зона есть ВСЕГДА;
    // пустоты не бывает нигде (хоть одно из двух положений есть на каждом
    // уровне); а полный выбор из трёх идёт СПЛОШНЫМ куском в середине.
    const has = (row: (typeof rows)[number], standing: ZoneStanding) =>
      row.cells.some((c) => c.standing === standing)
    const both: number[] = []
    for (const row of rows) {
      expect(has(row, 'current'), `ур. ${row.level}: нет актуальной зоны`).toBe(true)
      expect(
        has(row, 'behind') || has(row, 'ahead'),
        `ур. ${row.level}: ни отстающей, ни опережающей`,
      ).toBe(true)
      if (has(row, 'behind') && has(row, 'ahead')) both.push(row.level)
    }
    expect(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/full-choice-levels`, both.length),
      'полного выбора нет ни на одном уровне',
    ).toBeGreaterThan(0)
    const first = both[0]
    const last = both[both.length - 1]
    log(
      `Полный выбор из трёх положений: уровни ${first}-${last} ` +
        `(${both.length} из ${rows.length} снятых, ${pct(both.length / rows.length)}).`,
    )
    // Кусок сплошной: дырка внутри означала бы, что на каком-то уровне выбор
    // пропал и вернулся — это не край лестницы, это ошибка в числах.
    const inside = rows.filter((r) => r.level >= first && r.level <= last)
    expect(dump(`balance/pacing/class-${DEFAULT_CLASS.id}/full-choice-levels`, both.length)).toBe(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/full-choice-span-levels`, inside.length),
    )
    // И он не крошечный: треть прохождения — минимум, ниже которого «выбор»
    // становится случайным совпадением на паре уровней.
    expect(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/full-choice-share`, both.length / rows.length),
    ).toBeGreaterThanOrEqual(0.3)
  })

  it(`привал короче боя: ${REST_DURATION_S} с против медианного TTK актуальной зоны`, () => {
    // Контракт привала. Если отсидка длиннее убийства моба, пауза перестаёт
    // быть паузой и становится основным занятием: игрок смотрит на костёр
    // дольше, чем на бой. Медиана, а не среднее — один разросшийся уровень
    // не должен разрешать длинный привал на всех остальных.
    const current = rows.map((r) => currentCell(r).ttk.avg).sort((a, b) => a - b)
    const median = current[Math.floor(current.length / 2)]
    log(
      `Привал ${REST_DURATION_S} с при медианном TTK ${median.toFixed(1)} с ` +
        `(от ${current[0].toFixed(1)} до ${current[current.length - 1].toFixed(1)}).`,
    )
    expect(REST_DURATION_S).toBeLessThanOrEqual(
      dump(`balance/pacing/class-${DEFAULT_CLASS.id}/current-zone-ttk-median`, median),
    )
  })

  // -------------------------------------------------------------------------
  // КОНТРАКТ ЦЕНЫ БОЯ — второй контракт на ту же схватку. Темп задаёт её
  // ДЛИНУ (здоровье моба), цена — её СТОИМОСТЬ (урон моба). Ручки разные,
  // и правится каждая своим числом.
  //
  //   Герой уровня L в актуальном для L снаряжении теряет 20-25%
  //   максимального здоровья за один бой с МЕДИАННЫМ мобом своей зоны.
  //   Нетто, с учётом регенерации.
  //
  // ЧЕГО КОНТРАКТ НЕ ЗНАЧИТ: «урон моба = 22% запаса героя». Так живучесть и
  // броня стали бы украшением — сколько их ни набирай, доля та же. Контракт
  // ставится на ЭТАЛОННОМ герое, а дальше числа расходятся сами. Проверяются
  // ОБА расхождения: односторонняя проверка не отличила бы верную
  // реализацию от подмены.
  // -------------------------------------------------------------------------
  describe('контракт цены боя', () => {
    const TARGET_MIN = FIGHT_COST_TARGET.min
    const TARGET_MAX = FIGHT_COST_TARGET.max
    // Допуск ±2 пункта — не послабление, а разрешение измерения. Цена боя это
    // `урон × ЦЕЛОЕ число ударов ÷ запас`: один лишний удар из шести-восьми
    // двигает долю на два-три пункта, а какой именно выпадет — решает длина
    // боя внутри коридора 8-15 секунд. Уже коридора темпа цена быть не может.
    const TOLERANCE = 2
    // ЖЁСТКАЯ граница: за неё не выходит ни одна точка, и промахов такого
    // размера контракт не прощает вовсе.
    const HARD_TOLERANCE = 4
    // И РОВНО ОДИН ПРОМАХ НА КЛАСС в пределах жёсткой границы. Не «широкий
    // допуск», а поимённо посчитанное исключение: сейчас это Изувер на
    // полосе мобов 6-10 (16.3%), и почему его нельзя вылечить множителем
    // полосы — написано в data/monsters.ts рядом с самим множителем.
    // Появится второй промах — тест упадёт, и это правильно.
    const OUTLIERS_ALLOWED = 1

    /**
     * Доля запаса, теряемая за ОДИН бой (без паузы респауна), в процентах.
     * `net` — после лечения умением, иначе валовая: счёт моба до того, как
     * герой оплатил его маной.
     */
    const lossShareOf = (state: GameState, zone: Zone, net: boolean): number => {
      const facing = { ...state, monster: monsterFromTemplate(representativeMonster(zone)) }
      const rate = estimateCombatRate(facing)
      if (rate.idealKillsPerSecond.lte(0)) return Number.POSITIVE_INFINITY
      const cycleSec = new Decimal(1).div(rate.idealKillsPerSecond)
      return (net ? rate.hpLossPerSecond : rate.grossHpLossPerSecond)
        .times(cycleSec)
        // Пауза респауна к бою не относится: за неё платит не схватка.
        .plus(facing.stats.hpRegenOutOfCombat.times(RESPAWN_DELAY_MS / 1000))
        .div(facing.stats.maxHp)
        .toNumber() * 100
    }
    // ВАЛОВАЯ цена — то, что снимает моб, до лечения умением: лечение
    // оплачивается маной и меняет не счёт, а то, чем он покрыт. На ней и
    // стоит контракт.
    const lossShare = (state: GameState, zone: Zone): number => lossShareOf(state, zone, false)

    // Меряется ВХОД в зону: уровень, с которого игра в неё приводит. Внутри
    // зоны доля падает сама — герой растёт пять уровней, мобы стоят на месте.
    const entries = ZONES.map((zone) => ({ zone, level: zone.monsterLevelRange.min }))

    const stateFor = (level: number, classId: string, gearDelta: number): GameState => {
      const zone = intendedZone(level)
      const base = referenceBuild(level, classId)
      if (gearDelta === 0) return buildSimState(base, zone.id, CONTRACT_SEED)
      // Стартовый комплект деталями не двигается: хуже него только голый
      // герой, лучше — первый же средний комплект своей полосы.
      if (base.gear === 'starting') {
        const build =
          gearDelta < 0
            ? { ...base, gear: 'none' as const }
            : {
                ...base,
                gear: 'average' as const,
                gearLevel: Math.max(1, Math.round(averageMonsterLevel(zone))),
              }
        return buildSimState(build, zone.id, CONTRACT_SEED)
      }
      // Отклонение ДОЛЕЙ, а не пунктами: пять уровней вещей на девяностом
      // уровне — это пять процентов, а на десятом — половина силы.
      const gearLevel = Math.max(1, Math.round((base.gearLevel ?? 1) * (gearDelta < 0 ? 0.6 : 1.5)))
      return buildSimState({ ...base, gearLevel }, zone.id, CONTRACT_SEED)
    }

    describe.each(CLASS_SET)('$name', (cls) => {
      const classId = cls.id
      const cit = classIt(cls)

      cit(`эталон теряет ${TARGET_MIN}-${TARGET_MAX}% запаса за бой (допуск ${TOLERANCE} п.п., промахов не больше ${OUTLIERS_ALLOWED})`, () => {
        const shares = entries.map(({ zone, level }) => ({
          zone: zone.id,
          level,
          // gear-reference/-worse/-better — три состояния снаряжения одной и той
          // же точки лестницы; уровень здесь — уровень ВХОДА в зону.
          share: dump(
            `balance/fight-cost/class-${classId}/zone-${zone.id}/level-${String(level).padStart(3, '0')}/gear-reference/loss-share-gross`,
            lossShare(stateFor(level, classId, 0), zone),
          ),
        }))
        log(
          `${classId}: цена боя ${Math.min(...shares.map((r) => r.share)).toFixed(1)}-` +
            `${Math.max(...shares.map((r) => r.share)).toFixed(1)}%, ` +
            `в среднем ${(shares.reduce((a, r) => a + r.share, 0) / shares.length).toFixed(1)}%.`,
        )
        for (const { zone, level, share } of shares) {
          const where = `${classId}, ур. ${level}, ${zone}`
          expect(share, where).toBeGreaterThan(TARGET_MIN - HARD_TOLERANCE)
          expect(share, where).toBeLessThan(TARGET_MAX + HARD_TOLERANCE)
        }
        const outliers = shares.filter(
          (r) => r.share < TARGET_MIN - TOLERANCE || r.share > TARGET_MAX + TOLERANCE,
        )
        expect(
          dump(`balance/fight-cost/class-${classId}/outliers`, outliers.length),
          `${classId}: промахи — ${outliers.map((r) => `${r.zone} ${r.share.toFixed(1)}%`).join(', ')}`,
        ).toBeLessThanOrEqual(OUTLIERS_ALLOWED)
        // И СРЕДНЕЕ ПОПАДАЕТ В КОРИДОР БЕЗ ДОПУСКА. Допуск разрешён каждой
        // отдельной точке, но не смещению всей кривой: иначе контракт можно
        // было бы выполнить, стоя на два пункта ниже пола во всех двадцати
        // зонах сразу.
        const mean = dump(
          `balance/fight-cost/class-${classId}/loss-share-gross-mean`,
          shares.reduce((a, r) => a + r.share, 0) / shares.length,
        )
        expect(mean).toBeGreaterThanOrEqual(TARGET_MIN)
        expect(mean).toBeLessThanOrEqual(TARGET_MAX)
      })

      // ВТОРОЕ ЧИСЛО ТОЙ ЖЕ СХВАТКИ — цена НЕТТО, после лечения умением.
      // Проверяется здесь только то, что и должно быть железным: лечение
      // цену не поднимает. Коридор нетто (FIGHT_COST_NET_TARGET) — мягкий,
      // он зависит от запаса маны и настроек автокаста, то есть от решений
      // игрока; выход за него ПЕЧАТАЕТСЯ предупреждением и попадает в отчёт
      // ночи, но прогон не роняет — иначе данные мобов пришлось бы крутить
      // ради чужой ручки.
      cit('цена боя нетто: лечение не поднимает счёт, коридор — предупреждением', () => {
        const rows = entries.map(({ zone, level }) => {
          const state = stateFor(level, classId, 0)
          return {
            zone: zone.id,
            level,
            gross: dump(
              `balance/fight-cost/class-${classId}/zone-${zone.id}/level-${String(level).padStart(3, '0')}/gear-reference/loss-share-gross`,
              lossShareOf(state, zone, false),
            ),
            net: dump(
              `balance/fight-cost/class-${classId}/zone-${zone.id}/level-${String(level).padStart(3, '0')}/gear-reference/loss-share-net`,
              lossShareOf(state, zone, true),
            ),
          }
        })
        const mean = dump(
          `balance/fight-cost/class-${classId}/loss-share-net-mean`,
          rows.reduce((a, r) => a + r.net, 0) / rows.length,
        )
        log(
          `${classId}: цена боя нетто ${Math.min(...rows.map((r) => r.net)).toFixed(1)}-` +
            `${Math.max(...rows.map((r) => r.net)).toFixed(1)}%, в среднем ${mean.toFixed(1)}% ` +
            `(валовая в среднем ${(rows.reduce((a, r) => a + r.gross, 0) / rows.length).toFixed(1)}%).`,
        )
        for (const row of rows) {
          expect(row.net, `${classId}, ур. ${row.level}, ${row.zone}`).toBeLessThanOrEqual(
            row.gross + 1e-9,
          )
        }
        // У КЛАССА БЕЗ ЛЕЧЕНИЯ нетто равно валовой по построению, и мягкий
        // коридор к нему не относится: его цену держит контракт выше. Иначе
        // предупреждение висело бы вечно и перестало значить что-либо.
        const healer = ABILITIES.some(
          (a) => a.heal && classById(classId).abilityIds.includes(a.id),
        )
        if (!healer) {
          log(`${classId}: лечения у класса нет — нетто равно валовой, коридор не применяется.`)
        } else if (mean < FIGHT_COST_NET_TARGET.min || mean > FIGHT_COST_NET_TARGET.max) {
          // eslint-disable-next-line no-console
          console.warn(
            `[предупреждение] ${classId}: средняя цена боя нетто ${mean.toFixed(1)}% вне ` +
              `мягкого коридора ${FIGHT_COST_NET_TARGET.min}-${FIGHT_COST_NET_TARGET.max}%.`,
          )
        }
      })

      cit('снаряжение ЛУЧШЕ эталона теряет меньше, ХУЖЕ эталона — больше', () => {
        // ОБА отклонения в одном тесте и на каждой ступени лестницы. Проверь
        // только одно — и «урон моба = доля запаса героя» прошла бы: там обе
        // стороны дают ровно ту же долю, что эталон.
        for (const { zone, level } of entries) {
          const where = `${classId}, ур. ${level}, ${zone.id}`
          const worse = dump(
            `balance/fight-cost/class-${classId}/zone-${zone.id}/level-${String(level).padStart(3, '0')}/gear-worse/loss-share-gross`,
            lossShare(stateFor(level, classId, -1), zone),
          )
          const reference = dump(
            `balance/fight-cost/class-${classId}/zone-${zone.id}/level-${String(level).padStart(3, '0')}/gear-reference/loss-share-gross`,
            lossShare(stateFor(level, classId, 0), zone),
          )
          const better = dump(
            `balance/fight-cost/class-${classId}/zone-${zone.id}/level-${String(level).padStart(3, '0')}/gear-better/loss-share-gross`,
            lossShare(stateFor(level, classId, 1), zone),
          )
          expect(worse, `хуже эталона: ${where}`).toBeGreaterThan(reference)
          expect(better, `лучше эталона: ${where}`).toBeLessThan(reference)
        }
      })
    }, 300_000)

    it('печатает цену боя по зонам', () => {
      const rowsOut = entries.map(({ zone, level }) => {
        const out: Record<string, string | number> = { 'ур.': level, зона: zone.name }
        for (const cls of CLASS_SET) {
          out[`${cls.name}: хуже`] = lossShare(stateFor(level, cls.id, -1), zone).toFixed(1)
          out[`${cls.name}: эталон`] = lossShare(stateFor(level, cls.id, 0), zone).toFixed(1)
          out[`${cls.name}: лучше`] = lossShare(stateFor(level, cls.id, 1), zone).toFixed(1)
        }
        return out
      })
      console.table(rowsOut)
      expect(rowsOut).toHaveLength(ZONES.length)
    }, 300_000)
  })

  it('везение ускоряет бой, а не задаёт коридор', () => {
    // Смысл коридора: он держится на СРЕДНЕЙ экипировке. Редкая находка
    // обязана давать преимущество — иначе лут не нужен.
    const level = PACING_MAX_LEVEL
    const zone = intendedZone(level)
    const build = { level, gearLevel: rows[rows.length - 1].gearLevel }
    const average = estimateTtk(buildSimState({ ...build, gear: 'average' }, zone.id, 1), zone)
    const lucky = estimateTtk(
      buildSimState(
        {
          ...build,
          gear: 'average',
          // Эпик ТОГО ЖЕ уровня вещей: везение — это редкость находки, а не
          // прыжок через десять зон.
          weapon: { templateId: AVERAGE_WEAPON.id, rarity: 'epic', level: build.gearLevel },
        },
        zone.id,
        1,
      ),
      zone,
    )
    log(`Средняя экипировка ${average.toFixed(1)}с против эпического оружия ${lucky.toFixed(1)}с.`)
    expect(
      dump(
        `balance/lucky-drop/level-${String(level).padStart(3, '0')}/weapon-epic/ttk-sec`,
        lucky,
      ),
    ).toBeLessThan(
      dump(
        `balance/lucky-drop/level-${String(level).padStart(3, '0')}/weapon-average/ttk-sec`,
        average,
      ),
    )
  })
})
