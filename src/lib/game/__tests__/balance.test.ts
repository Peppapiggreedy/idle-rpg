// Прогон баланса: гоняет настоящий конвейер тика часами игрового времени и
// печатает таблицы, по которым видно, во что превращается баланс на практике.
// Проверки фиксируют свойства, ради которых зоны и оружие вообще существуют:
// прогресс монотонный, доминирующей зоны нет, прокачка не мгновенная,
// подходящая зона не убивает, а выбор оружия не схлопывается.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { expectedSwingDamage } from '../combat'
import { estimateTtk } from '../combat'
import {
  AVERAGE_WEAPON,
  BALANCE_PRESET,
  buildSimState,
  currentCell,
  pacingTable,
  referenceBuild,
  simulate,
  spreadOf,
  ttkDrift,
  PACING_MAX_LEVEL,
  type SimResult,
} from '../simulate'
import { intendedZone, type ZoneStanding } from '../zones'
import {
  TTK_AHEAD_MIN,
  TTK_BEHIND_MAX,
  TTK_DRIFT_MAX,
  TTK_HARD_CEILING,
  TTK_HARD_FLOOR,
  TTK_TARGET_MAX,
  TTK_TARGET_MIN,
} from '../../data/balance'
import { ZONES, zoneMonsterVariants, type Zone } from '../../data/zones'
import { WEAPONS, WEAPON_BY_ID } from '../../data/items'
import { ABILITY_BY_ID } from '../../data/abilities'

// Таблицы печатаются в вывод теста: прогон баланса нужен глазами, а не только
// зелёной галкой. Числа крупные, поэтому раскладываем по колонкам.
const log = (line: string) => console.log(line)
const num = (d: Decimal, width = 9) => d.toFixed(0).padStart(width)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const ttk = (x: number) => (Number.isFinite(x) ? (x >= 1000 ? x.toFixed(0) : x.toFixed(1)) : '∞')

function header(title: string, columns: string) {
  log('')
  log(title)
  log(columns)
  log('-'.repeat(columns.length))
}

function row(r: SimResult, name: string): string {
  const next =
    r.secondsToNextLevel === null ? '     —' : `${(r.secondsToNextLevel / 60).toFixed(1)}м`.padStart(6)
  return (
    `${name.padEnd(20)} ${num(r.killsPerHour, 8)} ${num(r.goldPerHour)} ${num(r.xpPerHour)} ` +
    `${r.deathsPerHour.toFixed(1).padStart(8)} ${next} ${String(r.finalLevel).padStart(6)}`
  )
}

const COLUMNS =
  'зона                 убийств/ч   золота/ч    опыта/ч смертей/ч  до ур.  итог'

// Сколько замахов самого медленного оружия держит средний моб зоны. От этого
// числа зависит доля перебоя: чем короче бой, тем больше урона уходит мимо.
function hitsPerKill(zone: Zone, level: number, sharpening: number): number {
  const state = buildSimState(
    { level, sharpening, weapon: { templateId: 'crusher', bare: true }, autocast: 'none' },
    zone.id,
    1,
  )
  const swing = expectedSwingDamage(state.stats)
  const variants = zoneMonsterVariants(zone)
  const avgHp = variants
    .reduce((sum, v) => sum.plus(v.maxHp), new Decimal(0))
    .div(variants.length)
  return avgHp.div(swing).toNumber()
}

describe('прогон баланса: таблица зон', () => {
  it('печатает таблицу зон', () => {
    const { zoneHours, zoneLevel } = BALANCE_PRESET
    const zoneBuild = referenceBuild(zoneLevel)
    header(
      `Эталонный герой ${zoneLevel} уровня (${zoneBuild.sharpening} заточек, средняя ` +
        `экипировка), автокаст включён, ${zoneHours} часов в каждой зоне.`,
      COLUMNS,
    )
    for (const zone of ZONES) {
      const result = simulate({ hours: zoneHours, zoneId: zone.id, build: zoneBuild })
      log(row(result, zone.name))
      // Прогон обязан быть осмысленным: в открытой по уровню зоне герой хоть
      // что-то приносит, иначе таблица меряет пустоту.
      expect(result.killsPerHour.gt(0)).toBe(true)
    }
  }, 300_000)
})

describe('прогресс монотонный', () => {
  // Уровень заморожен: за восемь часов свободного прогона герой уходит на
  // десятки уровней вперёд, и строки таблицы перестают быть сравнимыми.
  const LEVEL = PACING_MAX_LEVEL

  it('в более сложной зоне при достаточном уровне золота и опыта в час строго больше', () => {
    const build = referenceBuild(LEVEL)
    header(
      `Эталонный герой ${LEVEL} уровня (${build.sharpening} заточек), уровень заморожен, ` +
        '4 часа на зону.',
      COLUMNS,
    )
    const results = ZONES.map((zone) => {
      const result = simulate({ hours: 4, zoneId: zone.id, freezeLevel: true, build })
      log(row(result, zone.name))
      return result
    })

    for (let i = 1; i < results.length; i++) {
      expect(results[i].goldPerHour.gt(results[i - 1].goldPerHour)).toBe(true)
      expect(results[i].xpPerHour.gt(results[i - 1].xpPerHour)).toBe(true)
    }
  }, 300_000)
})

describe('нет доминирующей зоны', () => {
  const LEVELS = [1, 5, 10, 16, PACING_MAX_LEVEL]

  it('ни одна зона не лучше всех остальных на всех уровнях персонажа', () => {
    header(
      'Золота в час по зонам и уровням (уровень заморожен, 1 час на клетку).',
      `уровень   ${ZONES.map((z) => z.name.padStart(18)).join(' ')}   лучшая`,
    )
    // Кто выигрывает на каждом уровне. Зона-доминант — та, что выиграла везде.
    const winners: string[] = []
    for (const level of LEVELS) {
      const gold = ZONES.map((zone) =>
        simulate({
          hours: 1,
          zoneId: zone.id,
          freezeLevel: true,
          build: referenceBuild(level),
        }).goldPerHour,
      )
      let best = 0
      gold.forEach((g, i) => {
        if (g.gt(gold[best])) best = i
      })
      winners.push(ZONES[best].id)
      log(
        `${String(level).padStart(7)}   ${gold.map((g) => num(g, 18)).join(' ')}   ${ZONES[best].name}`,
      )
    }
    const unique = new Set(winners)
    log(`Лучшая зона меняется ${unique.size} раз(а) за ${LEVELS.length} уровней.`)
    expect(unique.size).toBeGreaterThan(1)
  }, 300_000)
})

describe('темп прокачки', () => {
  it('десятый уровень с нуля берётся за 20-60 минут игрового времени', () => {
    header('Свежий герой без снаряжения, от первого уровня.', 'поведение                    ур.10   за 2 часа   зона в конце')
    // Два крайних игрока: один так и остался на стартовом лугу, другой
    // переезжает в лучшую зону, как только она открывается. Требование должно
    // выполняться для обоих — иначе оно про стиль игры, а не про темп.
    for (const travel of ['stay', 'best'] as const) {
      const result = simulate({ hours: 2, zoneId: ZONES[0].id, travel })
      const seconds = result.levelReachedAtSec[10]
      const label = travel === 'stay' ? 'фармит стартовую зону' : 'переезжает по мере открытия'
      log(
        `${label.padEnd(28)} ${(seconds / 60).toFixed(1).padStart(5)}м ${String(result.finalLevel).padStart(11)}   ${result.zoneId}`,
      )
      expect(seconds).toBeGreaterThanOrEqual(20 * 60)
      expect(seconds).toBeLessThanOrEqual(60 * 60)
    }
  }, 300_000)
})

describe('смертность в подходящей зоне', () => {
  // «Подходящая» — та, где герой дожил до КОНЦА её правления: от порога входа
  // до уровня, на котором открывается следующая зона. Уровень моба уровню
  // героя не равен (это ярлык сложности), поэтому сравнивать их напрямую
  // нельзя — берём именно правление.
  const reignEnd = (index: number) =>
    index + 1 < ZONES.length ? ZONES[index + 1].unlockRequirement - 1 : PACING_MAX_LEVEL

  it('смертей в час близко к нулю', () => {
    header('Герой на последнем уровне правления зоны, 1 час на зону.', 'зона                 мобы     уровень героя   смертей/ч')
    for (const [index, zone] of ZONES.entries()) {
      const level = reignEnd(index)
      const result = simulate({
        hours: 1,
        zoneId: zone.id,
        freezeLevel: true,
        build: referenceBuild(level),
      })
      log(
        `${zone.name.padEnd(20)} ${`${zone.monsterLevelRange.min}-${zone.monsterLevelRange.max}`.padEnd(8)} ${String(level).padStart(13)}   ${result.deathsPerHour.toFixed(1).padStart(9)}`,
      )
      expect(result.deathsPerHour).toBe(0)
    }
  }, 300_000)
})

describe('скорость оружия', () => {
  // Все три оружия построены с одним отношением (средний урон / weaponSpeed),
  // то есть с одинаковым уроном оружия в секунду. Берём их ГОЛЫМИ — без
  // побочных статов шаблона (крит у кинжала, сила атаки у двуручника):
  // проверяем нормализацию скорости, а не бонусы конкретной модели.
  const { weaponBuild, weaponHours, weaponZoneId, weaponSpreadLimit } = BALANCE_PRESET
  const LEVEL = weaponBuild.level!
  const SHARPENING = weaponBuild.sharpening!

  function goldFor(templateId: string, autocast: 'none' | 'all') {
    return simulate({
      hours: weaponHours,
      zoneId: weaponZoneId,
      freezeLevel: true,
      build: { ...weaponBuild, weapon: { templateId, bare: true }, autocast },
    })
  }

  it(`равный урон оружия в секунду — итог в пределах ${pct(weaponSpreadLimit)}`, () => {
    const zone = ZONES.find((z) => z.id === weaponZoneId)!
    header(
      `Голое оружие, герой ${LEVEL} уровня (${SHARPENING} заточек), ${zone.name}, ` +
        `${weaponHours} ч, только автоатака.`,
      'оружие               скорость   золота/ч   отклонение',
    )
    const results = WEAPONS.map((w) => goldFor(w.id, 'none'))
    const gold = results.map((r) => r.goldPerHour.toNumber())
    const mean = gold.reduce((a, b) => a + b, 0) / gold.length
    WEAPONS.forEach((w, i) => {
      log(
        `${w.noun.padEnd(20)} ${w.weaponSpeed.toFixed(1).padStart(8)}с ${gold[i].toFixed(0).padStart(10)}   ${((gold[i] - mean) / mean >= 0 ? '+' : '') + pct((gold[i] - mean) / mean)}`,
      )
    })
    const spread = spreadOf(results.map((r) => r.goldPerHour))
    log(
      `Разброс ${pct(spread)} при ${hitsPerKill(zone, LEVEL, SHARPENING).toFixed(1)} замахах двуручника на моба.`,
    )
    expect(spread).toBeLessThanOrEqual(weaponSpreadLimit)
  }, 300_000)

  it('перебой: чем короче бой, тем сильнее расходится итог', () => {
    // Инвариант выше держится не везде: он про урон, который ДОШЁЛ до моба.
    // Когда моб умирает с одного замаха, лишний урон крупного удара пропадает,
    // и быстрое оружие выигрывает просто числом замахов в секунду. Таблица
    // показывает границу, за которой выбор оружия перестаёт быть равным.
    header(
      'Голое оружие, только автоатака, 1 час на клетку. Разброс против длины боя.',
      'зона                 ур. заточек  замахов/моб   разброс   лучшее',
    )
    const cases = [
      { zone: 'hollow-quarry', level: 12, sharpening: 5 },
      { zone: 'mirefen-hollows', level: 20, sharpening: 20 },
      { zone: 'ashen-ridge', level: 40, sharpening: 200 },
      { zone: weaponZoneId, level: LEVEL, sharpening: SHARPENING },
    ]
    for (const c of cases) {
      const zone = ZONES.find((z) => z.id === c.zone)!
      const gold = WEAPONS.map((w) =>
        simulate({
          hours: 1,
          zoneId: c.zone,
          freezeLevel: true,
          build: {
            level: c.level,
            sharpening: c.sharpening,
            weapon: { templateId: w.id, bare: true },
            autocast: 'none',
          },
        }).goldPerHour,
      )
      const spread = spreadOf(gold)
      const numbers = gold.map((g) => g.toNumber())
      const best = WEAPONS[numbers.indexOf(Math.max(...numbers))].noun
      log(
        `${zone.name.padEnd(20)} ${String(c.level).padStart(3)} ${String(c.sharpening).padStart(8)} ` +
          `${hitsPerKill(zone, c.level, c.sharpening).toFixed(1).padStart(12)} ${pct(spread).padStart(9)}   ${best}`,
      )
    }
  }, 300_000)

  it('урон за ману: медленное оружие тем и окупается', () => {
    // Умение «на следующий удар» стоит фиксированную ману и бьёт долей ЗАМАХА.
    // Замах медленного оружия крупнее ровно во столько раз, во сколько оно
    // медленнее, — значит и урона за ту же ману выходит во столько же раз больше.
    const onNextSwing = [...BALANCE_PRESET.manaAbilities]
    header(
      `Только умения «на следующий удар» (${onNextSwing.map((id) => ABILITY_BY_ID[id].name).join(', ')}), ` +
        `${ZONES.find((z) => z.id === weaponZoneId)!.name}, ${weaponHours} ч.`,
      'оружие               скорость   урон умений      мана   урон за ману',
    )
    const rows = ['fang', 'crusher'].map((templateId) => {
      const result = simulate({
        hours: weaponHours,
        zoneId: weaponZoneId,
        freezeLevel: true,
        build: { ...weaponBuild, weapon: { templateId, bare: true }, autocast: onNextSwing },
      })
      const template = WEAPON_BY_ID[templateId]
      log(
        `${template.noun.padEnd(20)} ${template.weaponSpeed.toFixed(1).padStart(8)}с ` +
          `${num(result.abilityDamage, 13)} ${num(result.manaSpent)} ${num(result.damagePerMana!, 14)}`,
      )
      return { template, result }
    })

    const [fast, slow] = rows
    const ratio = slow.result.damagePerMana!.div(fast.result.damagePerMana!).toNumber()
    const speedRatio = slow.template.weaponSpeed.div(fast.template.weaponSpeed).toNumber()
    log(`Урон за ману выше в ${ratio.toFixed(2)} раза при разнице скоростей в ${speedRatio.toFixed(2)} раза.`)
    // Медленное оружие обязано выигрывать по урону за ману, и ровно во столько
    // раз, во сколько оно медленнее: доля замаха — это и есть вся формула.
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeCloseTo(speedRatio, 1)
  }, 300_000)
})

// ---------------------------------------------------------------------------
// Контракт темпа боя
// ---------------------------------------------------------------------------
// Числа коридора живут в data/balance.ts; здесь только проверки. Таблица
// печатается целиком — контракт нужен глазами не меньше, чем зелёной галкой.
describe('контракт темпа боя', () => {
  const rows = pacingTable()
  const cellsWith = (standing: ZoneStanding) =>
    rows.flatMap((r) => r.cells.filter((c) => c.standing === standing).map((c) => ({ row: r, c })))

  it('печатает время убийства по зонам и уровням', () => {
    const columns =
      'ур.  ' +
      ZONES.map((z) => `${z.name.slice(0, 9)} ${z.monsterLevelRange.min}-${z.monsterLevelRange.max}`.padStart(18)).join('') +
      '  заточек  смертей   минут'
    header(
      'Эталонное прохождение: герой в СРЕДНЕЙ по рулетке экипировке, всё золото ' +
        'в заточку, переезд по мере открытия зон.\n' +
        '* актуальная зона, < отстающая, > опережающая. В скобках — самый быстрый и самый долгий моб зоны.',
      columns,
    )
    for (const r of rows) {
      const cells = r.cells.map((c) => {
        const mark = c.standing === 'current' ? '*' : c.standing === 'behind' ? '<' : c.standing === 'ahead' ? '>' : ' '
        return `${mark}${ttk(c.ttk.avg)} (${ttk(c.ttk.min)}-${ttk(c.ttk.max)})`.padStart(18)
      })
      log(
        `${String(r.level).padStart(3)}  ${cells.join('')}  ${String(r.sharpening).padStart(7)}  ` +
          `${String(r.deaths).padStart(7)}  ${(r.atSec / 60).toFixed(1).padStart(6)}`,
      )
    }
    log(`Разброс TTK по уровням: ${pct(ttkDrift(rows))} при потолке ${pct(TTK_DRIFT_MAX)}.`)
    expect(rows.length).toBe(PACING_MAX_LEVEL)
  }, 300_000)

  it(`в актуальной зоне моб живёт ${TTK_TARGET_MIN}-${TTK_TARGET_MAX} секунд на ВСЕХ уровнях`, () => {
    for (const row of rows) {
      const { ttk: t, zoneId } = currentCell(row)
      const where = `ур. ${row.level}, ${zoneId}`
      expect(t.avg, where).toBeGreaterThanOrEqual(TTK_TARGET_MIN)
      expect(t.avg, where).toBeLessThanOrEqual(TTK_TARGET_MAX)
    }
  })

  it(`ни один моб актуальной зоны не умирает быстрее ${TTK_HARD_FLOOR} секунд`, () => {
    // Ниже этого бой перестаёт быть событием: игрок не успевает ни прочитать
    // имя моба, ни нажать умение.
    for (const row of rows) {
      const { ttk: t, zoneId } = currentCell(row)
      expect(t.min, `ур. ${row.level}, ${zoneId}`).toBeGreaterThanOrEqual(TTK_HARD_FLOOR)
    }
  })

  it(`ни один моб актуальной зоны не живёт дольше ${TTK_HARD_CEILING} секунд`, () => {
    for (const row of rows) {
      const { ttk: t, zoneId } = currentCell(row)
      expect(t.max, `ур. ${row.level}, ${zoneId}`).toBeLessThanOrEqual(TTK_HARD_CEILING)
    }
  })

  it(`отстающая зона проходится с ходу: не дольше ${TTK_BEHIND_MAX} секунд на моба`, () => {
    const cells = cellsWith('behind')
    // Пустая проверка — не проверка: если классификация перестала кого-то
    // относить к отстающим, контракт молча выродился бы в ничто.
    expect(cells.length, 'ни одна зона не оказалась отстающей').toBeGreaterThan(0)
    for (const { row, c } of cells) {
      expect(c.ttk.avg, `ур. ${row.level}, ${c.zoneId}`).toBeLessThanOrEqual(TTK_BEHIND_MAX)
    }
  })

  it(`опережающая зона видна сразу: не быстрее ${TTK_AHEAD_MIN} секунд на моба`, () => {
    const cells = cellsWith('ahead')
    expect(cells.length, 'ни одна зона не оказалась опережающей').toBeGreaterThan(0)
    for (const { row, c } of cells) {
      expect(c.ttk.avg, `ур. ${row.level}, ${c.zoneId}`).toBeGreaterThanOrEqual(TTK_AHEAD_MIN)
    }
  })

  it(`темп не сжимается с прогрессом: разброс TTK по уровням ≤ ${pct(TTK_DRIFT_MAX)}`, () => {
    // Главная проверка контракта. Без неё коридор 8-15 выполнялся бы «в
    // среднем»: первый уровень у потолка, последний у пола — и бой к концу
    // игры проходился бы вдвое быстрее, чем в начале.
    expect(ttkDrift(rows)).toBeLessThanOrEqual(TTK_DRIFT_MAX)
  })

  it('везение ускоряет бой, а не задаёт коридор', () => {
    // Смысл коридора: он держится на СРЕДНЕЙ экипировке. Редкая находка
    // обязана давать преимущество — иначе лут не нужен.
    const level = PACING_MAX_LEVEL
    const zone = intendedZone(level)
    const build = { level, sharpening: rows[rows.length - 1].sharpening }
    const average = estimateTtk(buildSimState({ ...build, gear: 'average' }, zone.id, 1), zone)
    const lucky = estimateTtk(
      buildSimState(
        { ...build, gear: 'average', weapon: { templateId: AVERAGE_WEAPON.id, rarity: 'epic' } },
        zone.id,
        1,
      ),
      zone,
    )
    log(`Средняя экипировка ${average.toFixed(1)}с против эпического оружия ${lucky.toFixed(1)}с.`)
    expect(lucky).toBeLessThan(average)
  })
})
