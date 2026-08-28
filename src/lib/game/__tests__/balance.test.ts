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
  branchPoints,
  pureBranchTalents,
  simulate,
  spreadOf,
  styleBuild,
  ttkDrift,
  PACING_MAX_LEVEL,
  SIM_STYLES,
  type SimResult,
  type SimStyle,
} from '../simulate'
import { intendedZone, type ZoneStanding } from '../zones'
import {
  REST_DURATION_S,
  TTK_AHEAD_MIN,
  TTK_BEHIND_MAX,
  TTK_DRIFT_MAX,
  TTK_HARD_CEILING,
  TTK_HARD_FLOOR,
  TTK_TARGET_MAX,
  TTK_TARGET_MIN,
} from '../../data/balance'
import { ZONES, zoneMonsterVariants, type Zone } from '../../data/zones'
import { ONE_HANDED, WEAPONS } from '../../data/items'
import { BRANCHES } from '../../data/talents'
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

describe('стиль боя', () => {
  // Инвариант нормализации из итерации 2 пережил вторую руку, но мерится
  // теперь на СВЯЗКАХ: два одноручных и одно двуручное построены с равным
  // уроном оружия в секунду (11.25), одноручное со щитом — с меньшим (7.5),
  // и эта разница есть ПЛАТА за блок, а не перекос. Связки берём ГОЛЫМИ —
  // без побочных статов шаблонов: проверяем нормализацию, а не бонусы модели.
  const { weaponBuild, weaponHours, weaponSeeds, weaponZoneId, weaponSpreadLimit } = BALANCE_PRESET
  const LEVEL = weaponBuild.level!
  const SHARPENING = weaponBuild.sharpening!
  // Названия стилей — текст, поэтому живут здесь, а не в game/simulate.ts.
  const STYLE_NAMES: Record<SimStyle, string> = {
    twoHanded: 'двуручное',
    dual: 'два одноручных',
    shield: 'одноручное и щит',
  }

  // Средний итог по нескольким сидам. Один сид меряет не нормализацию, а
  // удачу спавна: разброс скачет до шести процентов, не меняя ни строчки кода.
  function meanGold(runs: SimResult[]): Decimal {
    return runs.reduce((sum, r) => sum.plus(r.goldPerHour), new Decimal(0)).div(runs.length)
  }

  function runStyle(style: SimStyle, autocast: 'none' | 'all' = 'none'): SimResult[] {
    return weaponSeeds.map((seed) =>
      simulate({
        hours: weaponHours,
        zoneId: weaponZoneId,
        seed,
        freezeLevel: true,
        build: { ...weaponBuild, ...styleBuild(style, true), autocast },
      }),
    )
  }

  it(`равный урон оружия в секунду — итог в пределах ${pct(weaponSpreadLimit)}`, () => {
    const zone = ZONES.find((z) => z.id === weaponZoneId)!
    header(
      `Голые связки, герой ${LEVEL} уровня (${SHARPENING} заточек), ${zone.name}, ` +
        `${weaponHours} ч, только автоатака.`,
      'стиль                 золота/ч   отклонение   привалов/ч',
    )
    const results = SIM_STYLES.map((style) => ({ style, runs: runStyle(style) }))
    // Равными обязаны быть только связки, ЗАНИМАЮЩИЕ ОБЕ РУКИ. Щит в этот
    // набор не входит намеренно: у него меньше урона по построению.
    const paired = results.filter((r) => r.style !== 'shield')
    const gold = paired.map((r) => meanGold(r.runs).toNumber())
    const mean = gold.reduce((a, b) => a + b, 0) / gold.length
    for (const { style, runs } of results) {
      const g = meanGold(runs).toNumber()
      const rests = runs.reduce((sum, r) => sum + r.restsPerHour, 0) / runs.length
      const dev = style === 'shield' ? '' : ((g - mean) / mean >= 0 ? '+' : '') + pct((g - mean) / mean)
      log(
        `${STYLE_NAMES[style].padEnd(21)} ${g.toFixed(0).padStart(9)}   ${dev.padStart(10)}   ` +
          `${rests.toFixed(1).padStart(10)}`,
      )
    }
    const spread = spreadOf(paired.map((r) => meanGold(r.runs)))
    log(
      `Разброс ${pct(spread)} при ${hitsPerKill(zone, LEVEL, SHARPENING).toFixed(1)} замахах двуручника на моба.`,
    )
    expect(spread).toBeLessThanOrEqual(weaponSpreadLimit)
  }, 300_000)

  it('щит платит уроном за живучесть — и то, и другое видно', () => {
    // Обещание стиля: меньше урона, меньше потерь HP. Если бы щит не отнимал
    // урона, он был бы бесплатным, и выбора стиля не существовало бы.
    const { stressBuild, stressZoneId } = BALANCE_PRESET
    const stress = (style: SimStyle): SimResult[] =>
      weaponSeeds.map((seed) =>
        simulate({
          hours: weaponHours,
          zoneId: stressZoneId,
          seed,
          freezeLevel: true,
          build: { ...stressBuild, ...styleBuild(style, true), autocast: 'none' },
        }),
      )
    const dual = stress('dual')
    const shield = stress('shield')
    // Простой — доля времени вне боя: привалы плюс смерти. Щит обязан
    // уменьшать её, иначе он был бы бесплатным и выбора стиля не было бы.
    const idle = (runs: SimResult[]) =>
      runs.reduce((sum, r) => sum + r.restShare + (1 - r.uptime), 0) / runs.length
    header(
      `Герой ${stressBuild.level} уровня (${stressBuild.sharpening} заточек) в зоне ` +
        `${ZONES.find((z) => z.id === stressZoneId)!.name} — не по себе. ${weaponHours} ч.`,
      'стиль                 золота/ч   простой',
    )
    for (const [style, runs] of [
      ['dual', dual],
      ['shield', shield],
    ] as const) {
      log(`${STYLE_NAMES[style].padEnd(21)} ${meanGold(runs).toFixed(0).padStart(9)}   ${pct(idle(runs)).padStart(7)}`)
    }
    // Простой обязан заметно упасть, а не просто «не вырасти»: щит покупает
    // живучесть, и покупка должна быть видна.
    expect(idle(shield)).toBeLessThan(idle(dual) * 0.9)
    expect(meanGold(shield).lt(meanGold(dual))).toBe(true)
  }, 300_000)

  it('перебой: чем короче бой, тем сильнее расходится итог', () => {
    // Инвариант выше держится не везде: он про урон, который ДОШЁЛ до моба.
    // Когда моб умирает с одного замаха, лишний урон крупного удара пропадает,
    // и частая связка выигрывает просто числом замахов. Таблица показывает
    // границу, за которой выбор стиля перестаёт быть равным.
    header(
      'Голые связки, только автоатака, 1 час на клетку. Разброс против длины боя.',
      'зона                 ур. заточек  замахов/моб   разброс   лучшее',
    )
    const cases = [
      { zone: 'hollow-quarry', level: 12, sharpening: 5 },
      { zone: 'mirefen-hollows', level: 20, sharpening: 20 },
      { zone: 'ashen-ridge', level: 40, sharpening: 200 },
      { zone: weaponZoneId, level: LEVEL, sharpening: SHARPENING },
    ]
    const paired = SIM_STYLES.filter((style) => style !== 'shield')
    for (const c of cases) {
      const zone = ZONES.find((z) => z.id === c.zone)!
      const gold = paired.map((style) =>
        meanGold(
          weaponSeeds.map((seed) =>
            simulate({
              hours: 1,
              zoneId: c.zone,
              seed,
              freezeLevel: true,
              build: {
                level: c.level,
                sharpening: c.sharpening,
                ...styleBuild(style, true),
                autocast: 'none',
              },
            }),
          ),
        ),
      )
      const spread = spreadOf(gold)
      const numbers = gold.map((g) => g.toNumber())
      const best = STYLE_NAMES[paired[numbers.indexOf(Math.max(...numbers))]]
      log(
        `${zone.name.padEnd(20)} ${String(c.level).padStart(3)} ${String(c.sharpening).padStart(8)} ` +
          `${hitsPerKill(zone, c.level, c.sharpening).toFixed(1).padStart(12)} ${pct(spread).padStart(9)}   ${best}`,
      )
    }
  }, 300_000)

  it('урон за ману: медленное оружие тем и окупается', () => {
    // Умение «на следующий удар» стоит фиксированную ману и бьёт долей ЗАМАХА.
    // Замах медленного оружия крупнее ровно во столько раз, во сколько оно
    // медленнее, — значит и урона за ту же ману выходит во столько же раз
    // больше. Сравниваем ОДНОРУЧНЫЕ: у них одинаковый урон оружия в секунду,
    // и разница между ними — ровно скорость. Двуручное выигрывает ещё больше,
    // но там к скорости примешан его собственный, вдвое больший замах.
    const onNextSwing = [...BALANCE_PRESET.manaAbilities]
    header(
      `Только умения «на следующий удар» (${onNextSwing.map((id) => ABILITY_BY_ID[id].name).join(', ')}), ` +
        `${ZONES.find((z) => z.id === weaponZoneId)!.name}, ${weaponHours} ч.`,
      'оружие               скорость   урон умений      мана   урон за ману',
    )
    const sorted = [...ONE_HANDED].sort(
      (a, b) => a.weaponSpeed.toNumber() - b.weaponSpeed.toNumber(),
    )
    const rows = [sorted[0], sorted[sorted.length - 1]].map((template) => {
      const result = simulate({
        hours: weaponHours,
        zoneId: weaponZoneId,
        freezeLevel: true,
        build: {
          ...weaponBuild,
          weapon: { templateId: template.id, bare: true },
          offhand: null,
          autocast: onNextSwing,
        },
      })
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
// Ветки талантов
// ---------------------------------------------------------------------------
describe('ветки талантов', () => {
  const { branchHours, branchLevel, branchSpreadLimit, weaponSeeds } = BALANCE_PRESET
  const points = branchPoints(branchLevel)
  const zone = intendedZone(branchLevel)
  const BRANCH_KIND: Record<string, string> = {
    fury: 'урон',
    endurance: 'живучесть',
    composure: 'автономность',
  }

  // ЧЕМ МЕРИТЬ. Взять «урон в секунду» напрямую нельзя: ветка живучести не
  // добавляет к удару ни единицы, и по этому числу она всегда проигрывала бы
  // втрое — не потому, что она плохая, а потому, что прибор мерит не то.
  // Мерим ИТОГ за час: он учитывает и урон, и то, сколько времени герой
  // провёл в бою, а не на привале и не мёртвым. Это и есть «сколько стоит
  // ветка» с точки зрения игрока.
  function runBranch(branch: string) {
    return weaponSeeds.map((seed) =>
      simulate({
        hours: branchHours,
        zoneId: zone.id,
        seed,
        freezeLevel: true,
        build: {
          ...referenceBuild(branchLevel),
          talents: pureBranchTalents(branch as never, points),
        },
      }),
    )
  }

  it(`три чистых билда на ${points} очках сходятся в пределах ${pct(branchSpreadLimit)}`, () => {
    header(
      `Чистые билды по веткам, герой ${branchLevel} уровня в средней экипировке, ` +
        `${zone.name}, ${branchHours} ч на сид.`,
      'ветка            стиль          золота/ч   отклонение   привалов/ч   смертей/ч',
    )
    const rows = BRANCHES.map((branch) => ({ branch, runs: runBranch(branch.id) }))
    const mean = (runs: SimResult[]) =>
      runs.reduce((sum, r) => sum.plus(r.goldPerHour), new Decimal(0)).div(runs.length)
    const gold = rows.map((r) => mean(r.runs).toNumber())
    const avg = gold.reduce((a, b) => a + b, 0) / gold.length
    rows.forEach((row, i) => {
      const rests = row.runs.reduce((sum, r) => sum + r.restsPerHour, 0) / row.runs.length
      const deaths = row.runs.reduce((sum, r) => sum + r.deathsPerHour, 0) / row.runs.length
      log(
        `${row.branch.name.padEnd(16)} ${BRANCH_KIND[row.branch.id].padEnd(14)} ` +
          `${gold[i].toFixed(0).padStart(8)}   ` +
          `${(((gold[i] - avg) / avg >= 0 ? '+' : '') + pct((gold[i] - avg) / avg)).padStart(10)}   ` +
          `${rests.toFixed(1).padStart(10)}   ${deaths.toFixed(2).padStart(9)}`,
      )
    })
    const spread = spreadOf(rows.map((r) => mean(r.runs)))
    log(`Разброс ${pct(spread)} при потолке ${pct(branchSpreadLimit)}.`)
    // Ветка, отставшая сильнее этого, — ловушка: игрок вложил очки и получил
    // меньше, чем если бы вложил куда угодно ещё. Сброс стоит золота, так что
    // ошибка выбора наказывает дважды.
    expect(spread).toBeLessThanOrEqual(branchSpreadLimit)
  }, 300_000)

  it('ветки различаются СТИЛЕМ, а не только числом', () => {
    // Итог сопоставим, а путь разный — иначе выбор ветки декоративен.
    // Ярость обязана бить сильнее, стойкость — реже останавливаться на
    // смерть, самообладание — реже и короче отдыхать.
    const fury = runBranch('fury')
    const endurance = runBranch('endurance')
    const composure = runBranch('composure')
    const avg = (runs: SimResult[], pick: (r: SimResult) => number) =>
      runs.reduce((sum, r) => sum + pick(r), 0) / runs.length
    const damage = (runs: SimResult[]) =>
      avg(runs, (r) => r.autoDamage.plus(r.abilityDamage).div(r.hours).toNumber())
    log(
      `Урон/ч: ярость ${damage(fury).toFixed(0)}, стойкость ${damage(endurance).toFixed(0)}, ` +
        `самообладание ${damage(composure).toFixed(0)}.`,
    )
    log(
      `Доля простоя: ярость ${pct(avg(fury, (r) => r.restShare))}, ` +
        `стойкость ${pct(avg(endurance, (r) => r.restShare))}, ` +
        `самообладание ${pct(avg(composure, (r) => r.restShare))}.`,
    )
    expect(damage(fury)).toBeGreaterThan(damage(endurance))
    expect(damage(fury)).toBeGreaterThan(damage(composure))
    // Самообладание платит за это временем в бою, а не уроном за удар.
    expect(avg(composure, (r) => r.restShare)).toBeLessThanOrEqual(
      avg(fury, (r) => r.restShare) + 1e-9,
    )
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
    expect(REST_DURATION_S).toBeLessThanOrEqual(median)
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
