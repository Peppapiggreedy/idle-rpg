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
import { ZONES, ZONE_BY_ID, zoneMonsterVariants, type Zone } from '../../data/zones'
import { ONE_HANDED, WEAPONS } from '../../data/items'
import { BRANCHES } from '../../data/talents'
import { CLASSES } from '../../data/classes'
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
function hitsPerKill(zone: Zone, level: number, weaponLevel: number): number {
  const state = buildSimState(
    { level, weapon: { templateId: 'crusher', bare: true, level: weaponLevel }, autocast: 'none' },
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
      `Эталонный герой ${zoneLevel} уровня (вещи ${zoneBuild.gearLevel} уровня, средняя ` +
        `редкость), автокаст включён, ${zoneHours} часов в каждой зоне.`,
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
      `Эталонный герой ${LEVEL} уровня (вещи ${build.gearLevel} уровня), уровень заморожен, ` +
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
    // Считаем ТОЛЬКО по открытым зонам: закрытая зона игроку недоступна, и
    // «лучшая» среди недоступных — не выбор, а арифметика.
    const winners: string[] = []
    for (const level of LEVELS) {
      const open = ZONES.filter((z) => z.unlockRequirement <= level)
      const gold = ZONES.map((zone) =>
        zone.unlockRequirement > level
          ? new Decimal(0)
          : simulate({
              hours: 1,
              zoneId: zone.id,
              freezeLevel: true,
              build: referenceBuild(level),
            }).goldPerHour,
      )
      let best = 0
      gold.forEach((g, i) => {
        if (ZONES[i].unlockRequirement <= level && g.gt(gold[best])) best = i
      })
      expect(open.length, `на ${level} уровне не открыто ни одной зоны`).toBeGreaterThan(0)
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
  it('десятый уровень берётся за 15-25 минут у того, кто идёт по лестнице', () => {
    header('Свежий герой в стартовом комплекте, от первого уровня.', 'поведение                    ур.10   за 2 часа   зона в конце')
    // Два крайних игрока: один так и остался на стартовом лугу, другой
    // переезжает в лучшую зону, как только она открывается.
    //
    // ТРЕБОВАНИЕ РАЗНОЕ, и это следствие новой кривой. Стоимость уровня
    // считается по награде зоны, ПОДХОДЯЩЕЙ ПО УРОВНЮ (см. xpToNextLevel):
    // кривая привязана к реальной награде, а не к отдельному допущению.
    // Значит тот, кто остался на старте, бьёт мобов дешевле расчётных и
    // растёт медленнее — это цена решения сидеть на месте, а не поломка.
    // Контракт «первые девять уровней за 15-25 минут» — про того, кто идёт.
    const results: Record<string, number> = {}
    for (const travel of ['stay', 'best'] as const) {
      const result = simulate({ hours: 2, zoneId: ZONES[0].id, travel })
      const seconds = result.levelReachedAtSec[10]
      results[travel] = seconds
      const label = travel === 'stay' ? 'фармит стартовую зону' : 'переезжает по мере открытия'
      log(
        `${label.padEnd(28)} ${(seconds / 60).toFixed(1).padStart(5)}м ${String(result.finalLevel).padStart(11)}   ${result.zoneId}`,
      )
    }
    for (const travel of ['stay', 'best'] as const) {
      expect(results[travel], travel).toBeGreaterThanOrEqual(15 * 60)
      expect(results[travel], travel).toBeLessThanOrEqual(25 * 60)
    }
    // На первых уровнях оба стиля дают ОДНО И ТО ЖЕ, и это не совпадение:
    // «лучшая зона» выбирается по опыту в час, а стартовый луг для новичка
    // ещё и есть лучшая — соседняя полоса мобов тяжелее ровно настолько,
    // насколько богаче. Выбор становится настоящим позже, когда герой
    // перерастает свою полосу. Здесь важно, что игра не наказывает ни за
    // осторожность, ни за спешку в первые двадцать минут.
    expect(Math.abs(results.stay - results.best)).toBeLessThan(5 * 60)
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
  const WEAPON_LEVEL = BALANCE_PRESET.weaponLevel
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

  /** Средний урон АВТОАТАКИ: им щит и платит за живучесть. */
  function meanAuto(runs: SimResult[]): Decimal {
    return runs.reduce((sum, r) => sum.plus(r.autoDamage), new Decimal(0)).div(runs.length)
  }

  function runStyle(style: SimStyle, autocast: 'none' | 'all' = 'none'): SimResult[] {
    return weaponSeeds.map((seed) =>
      simulate({
        hours: weaponHours,
        zoneId: weaponZoneId,
        seed,
        freezeLevel: true,
        // Привалы выключены: измерение про УДАР, а не про то, кто чаще
        // садится отдыхать. С ними разброс мерил бы живучесть связки.
        build: { ...weaponBuild, ...styleBuild(style, true, WEAPON_LEVEL), autocast, restThreshold: 0 },
      }),
    )
  }

  it(`равный урон оружия в секунду — итог в пределах ${pct(weaponSpreadLimit)}`, () => {
    const zone = ZONES.find((z) => z.id === weaponZoneId)!
    header(
      `Голые связки ${WEAPON_LEVEL} уровня, герой ${LEVEL} уровня, ${zone.name}, ` +
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
      `Разброс ${pct(spread)} при ${hitsPerKill(zone, LEVEL, WEAPON_LEVEL).toFixed(1)} замахах двуручника на моба.`,
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
          build: { ...stressBuild, ...styleBuild(style, true, BALANCE_PRESET.stressWeaponLevel), autocast: 'none' },
        }),
      )
    const dual = stress('dual')
    const shield = stress('shield')
    // Простой — доля времени вне боя: привалы плюс смерти. Щит обязан
    // уменьшать её, иначе он был бы бесплатным и выбора стиля не было бы.
    const idle = (runs: SimResult[]) =>
      runs.reduce((sum, r) => sum + r.restShare + (1 - r.uptime), 0) / runs.length
    header(
      `Герой ${stressBuild.level} уровня со связкой ${BALANCE_PRESET.stressWeaponLevel} уровня в зоне ` +
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
    // А вот золото со щитом теперь может оказаться и БОЛЬШЕ, и это не сбой
    // баланса, а следствие шага 35: привал переехал между боями, и в тяжёлой
    // зоне живучесть напрямую превращается во время под мобами. Платит щит
    // именно УРОНОМ — это и проверяется отдельно, ниже и выше по файлу.
    const damageLoss = 1 - meanAuto(shield).div(meanAuto(dual)).toNumber()
    log(`Щит стоит ${pct(damageLoss)} урона автоатаки.`)
    expect(damageLoss).toBeGreaterThan(0.15)
  }, 300_000)

  it('перебой: чем короче бой, тем сильнее расходится итог', () => {
    // Инвариант выше держится не везде: он про урон, который ДОШЁЛ до моба.
    // Когда моб умирает с одного замаха, лишний урон крупного удара пропадает,
    // и частая связка выигрывает просто числом замахов. Таблица показывает
    // границу, за которой выбор стиля перестаёт быть равным.
    header(
      'Голые связки, только автоатака, 1 час на клетку. Разброс против длины боя.',
      'зона                 ур. оружия   замахов/моб   разброс   лучшее',
    )
    const cases = [
      { zone: 'hollow-quarry', level: 12, weaponLevel: 3 },
      { zone: 'mirefen-hollows', level: 20, weaponLevel: 8 },
      { zone: 'ashen-ridge', level: 40, weaponLevel: 28 },
      { zone: weaponZoneId, level: LEVEL, weaponLevel: WEAPON_LEVEL },
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
                ...styleBuild(style, true, c.weaponLevel),
                autocast: 'none',
                restThreshold: 0,
              },
            }),
          ),
        ),
      )
      const spread = spreadOf(gold)
      const numbers = gold.map((g) => g.toNumber())
      const best = STYLE_NAMES[paired[numbers.indexOf(Math.max(...numbers))]]
      log(
        `${zone.name.padEnd(20)} ${String(c.level).padStart(3)} ${String(c.weaponLevel).padStart(8)} ` +
          `${hitsPerKill(zone, c.level, c.weaponLevel).toFixed(1).padStart(12)} ${pct(spread).padStart(9)}   ${best}`,
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
    // В пределах десятой доли: точное равенство ломает перебой добивающего
    // удара, а он к формуле умений отношения не имеет.
    expect(Math.abs(ratio - speedRatio) / speedRatio).toBeLessThan(0.1)
  }, 300_000)
})

// ---------------------------------------------------------------------------
// Ветки талантов
// ---------------------------------------------------------------------------
describe('ветки талантов', () => {
  const { branchHours, branchLevel, branchSpreadLimit, branchRestShareMax, weaponSeeds } =
    BALANCE_PRESET
  const points = branchPoints(branchLevel)
  const BRANCH_KIND: Record<string, string> = {
    fury: 'урон',
    endurance: 'живучесть',
    composure: 'автономность',
  }

  // ЧЕМ МЕРИТЬ. Взять «урон в секунду» напрямую нельзя: ветка живучести не
  // добавляет к удару ни единицы, и по этому числу она всегда проигрывала бы
  // втрое — не потому, что она плохая, а потому, что прибор мерит не то.
  //
  // Мерить в ОДНОЙ зоне тоже нельзя, и это тоньше. Живучесть окупается не
  // тем, что герой бьёт сильнее, а тем, что он держится ГЛУБЖЕ: зона на
  // ступень ниже платит в rewardMultiplier раз меньше кому угодно. Поэтому
  // каждая ветка играет СВОЮ лучшую зону — самую глубокую, где она ещё не
  // умирает и не просиживает на привалах больше четверти времени. Ровно так
  // и играет живой игрок.
  function runBranch(branch: string, zoneId: string): SimResult[] {
    return weaponSeeds.map((seed) =>
      simulate({
        hours: branchHours,
        zoneId,
        seed,
        freezeLevel: true,
        build: {
          ...referenceBuild(branchLevel),
          talents: pureBranchTalents(branch as never, points),
        },
      }),
    )
  }

  const mean = (runs: SimResult[]) =>
    runs.reduce((sum, r) => sum.plus(r.goldPerHour), new Decimal(0)).div(runs.length)
  const avg = (runs: SimResult[], pick: (r: SimResult) => number) =>
    runs.reduce((sum, r) => sum + pick(r), 0) / runs.length

  /** Самая глубокая ОТКРЫТАЯ зона, которую ветка тянет: без смертей и без
   *  просиживания. Вход по уровню обязателен: «какую зону тянет билд» в живой
   *  игре упирается в travelToZone, и мерить закрытые значит мерить не игру. */
  function bestZone(branch: string): { zoneId: string; runs: SimResult[] } {
    for (let i = ZONES.length - 1; i >= 0; i -= 1) {
      if (ZONES[i].unlockRequirement > branchLevel) continue
      const runs = runBranch(branch, ZONES[i].id)
      const deaths = avg(runs, (r) => r.deathsPerHour)
      const rest = avg(runs, (r) => r.restShare)
      if (deaths === 0 && rest <= branchRestShareMax) return { zoneId: ZONES[i].id, runs }
    }
    return { zoneId: ZONES[0].id, runs: runBranch(branch, ZONES[0].id) }
  }

  it(`три чистых билда на ${points} очках сходятся в пределах ${pct(branchSpreadLimit)}`, () => {
    header(
      `Чистые билды по веткам, герой ${branchLevel} уровня в средней экипировке, ` +
        `${branchHours} ч на сид. Каждая ветка играет самую глубокую зону, которую тянет.`,
      'ветка            стиль          зона                 золота/ч   отклонение   простой',
    )
    const rows = BRANCHES.map((branch) => ({ branch, ...bestZone(branch.id) }))
    const gold = rows.map((r) => mean(r.runs).toNumber())
    const average = gold.reduce((a, b) => a + b, 0) / gold.length
    rows.forEach((row, i) => {
      const idle = avg(row.runs, (r) => r.restShare + (1 - r.uptime))
      log(
        `${row.branch.name.padEnd(16)} ${BRANCH_KIND[row.branch.id].padEnd(14)} ` +
          `${(ZONE_BY_ID[row.zoneId]?.name ?? row.zoneId).padEnd(20)} ${gold[i].toFixed(0).padStart(8)}   ` +
          `${(((gold[i] - average) / average >= 0 ? '+' : '') + pct((gold[i] - average) / average)).padStart(10)}   ` +
          `${pct(idle).padStart(7)}`,
      )
    })
    const spread = spreadOf(rows.map((r) => mean(r.runs)))
    log(`Разброс ${pct(spread)} при потолке ${pct(branchSpreadLimit)}.`)
    // Ветка, отставшая сильнее этого, — ловушка: игрок вложил очки и получил
    // меньше, чем если бы вложил куда угодно ещё. Сброс стоит золота, так что
    // ошибка выбора наказывает дважды.
    expect(spread).toBeLessThanOrEqual(branchSpreadLimit)
  }, 600_000)

  it('ветки различаются СТИЛЕМ, а не только числом', () => {
    // Итог сопоставим, а путь разный — иначе выбор ветки декоративен.
    // Сравниваем В ОДНОЙ зоне: здесь важно не «сколько», а «чем».
    const zone = intendedZone(branchLevel).id
    const fury = runBranch('fury', zone)
    const endurance = runBranch('endurance', zone)
    const composure = runBranch('composure', zone)
    const damage = (runs: SimResult[]) =>
      avg(runs, (r) => r.autoDamage.plus(r.abilityDamage).div(r.hours).toNumber())
    log(
      `В зоне ${ZONE_BY_ID[zone].name}. Урон/ч: ярость ${damage(fury).toFixed(0)}, ` +
        `стойкость ${damage(endurance).toFixed(0)}, самообладание ${damage(composure).toFixed(0)}.`,
    )
    log(
      `Доля простоя: ярость ${pct(avg(fury, (r) => r.restShare))}, ` +
        `стойкость ${pct(avg(endurance, (r) => r.restShare))}, ` +
        `самообладание ${pct(avg(composure, (r) => r.restShare))}.`,
    )
    // Ярость бьёт сильнее всех — это её обещание.
    expect(damage(fury)).toBeGreaterThan(damage(endurance))
    expect(damage(fury)).toBeGreaterThan(damage(composure))
    // Стойкость меньше всех простаивает — это её обещание.
    expect(avg(endurance, (r) => r.restShare)).toBeLessThanOrEqual(
      avg(fury, (r) => r.restShare) + 1e-9,
    )
  }, 600_000)
})

// ---------------------------------------------------------------------------
// Телеметрия: как часто игре есть что предложить
// ---------------------------------------------------------------------------
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
  const rows = CLASSES.flatMap((hero) =>
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

  it(`интервал решений ${decisionMinSec}-${decisionMaxSec} с на большей части прогрессии`, () => {
    header(
      `Эталонный герой в подходящей зоне, ${telemetryHours} ч на строку. ` +
        'Решение — находка выше обычной, очко таланта, открывшаяся зона.',
      'класс          ур.   зона                 интервал   привалов/ч   простой   смертей/ч',
    )
    let inWindow = 0
    for (const row of rows) {
      const gap = row.result.decisionIntervalSec
      const mark = gap !== null && gap >= decisionMinSec && gap <= decisionMaxSec ? '✓' : ' '
      if (mark === '✓') inWindow += 1
      log(
        `${row.hero.name.padEnd(14)} ${String(row.level).padStart(3)}   ` +
          `${row.zone.name.padEnd(20)} ${(gap?.toFixed(0) ?? '—').padStart(6)}с${mark}  ` +
          `${row.result.restsPerHour.toFixed(1).padStart(10)}   ` +
          `${pct(row.result.restShare).padStart(7)}   ` +
          `${row.result.deathsPerHour.toFixed(2).padStart(9)}`,
      )
      // ПОТОЛОК ТРЕВОГИ. Реже раза в три минуты — это уже не idle, а пустой
      // экран: игрок открывает вкладку и не находит, что нажать.
      expect(gap ?? Number.POSITIVE_INFINITY, `${row.hero.id}, ур. ${row.level}`).toBeLessThanOrEqual(
        decisionAlertSec,
      )
    }
    log(`В окне ${inWindow} из ${rows.length} строк (${pct(inWindow / rows.length)}).`)
    // «На большей части»: края прогрессии выпадают законно — на первом уровне
    // решений больше обычного, на последнем меньше.
    expect(inWindow / rows.length).toBeGreaterThanOrEqual(0.6)
  }, 600_000)

  it(`на привалах уходит не больше ${pct(restShareMax)} времени`, () => {
    // Привал — пауза, а не занятие. Четверть времени на костре ещё читается
    // как ритм; больше — как налог на то, что герой вообще дерётся.
    for (const row of rows) {
      expect(row.result.restShare, `${row.hero.id}, ур. ${row.level}`).toBeLessThanOrEqual(
        restShareMax,
      )
    }
  }, 600_000)
})

// ---------------------------------------------------------------------------
// Контракт темпа боя
// ---------------------------------------------------------------------------
// Числа коридора живут в data/balance.ts; здесь только проверки. Таблица
// печатается целиком — контракт нужен глазами не меньше, чем зелёной галкой.
describe('контракт темпа боя', () => {
  const rows = pacingTable()

  // Контракт держится для КАЖДОГО класса, а не только для дефолтного: класс
  // меняет ресурс, умения и стартовые статы, то есть ровно те числа, из
  // которых складывается длина боя.
  describe.each(CLASSES.map((c) => [c.name, c.id] as const))('%s', (_name, classId) => {
    const classRows = pacingTable({ classId })

    it(`моб актуальной зоны живёт ${TTK_TARGET_MIN}-${TTK_TARGET_MAX} секунд`, () => {
      const ttks = classRows.map((r) => currentCell(r).ttk.avg)
      log(
        `${classId}: TTK ${Math.min(...ttks).toFixed(1)}-${Math.max(...ttks).toFixed(1)} с, ` +
          `разброс ${pct(ttkDrift(classRows))}, до ${classRows[classRows.length - 1].level} уровня ` +
          `за ${(classRows[classRows.length - 1].atSec / 60).toFixed(0)} мин.`,
      )
      for (const row of classRows) {
        const { ttk: t, zoneId } = currentCell(row)
        const where = `${classId}, ур. ${row.level}, ${zoneId}`
        expect(t.avg, where).toBeGreaterThanOrEqual(TTK_TARGET_MIN)
        expect(t.avg, where).toBeLessThanOrEqual(TTK_TARGET_MAX)
      }
    })

    it(`разброс TTK по уровням ≤ ${pct(TTK_DRIFT_MAX)}`, () => {
      expect(ttkDrift(classRows)).toBeLessThanOrEqual(TTK_DRIFT_MAX)
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
    expect(rows[rows.length - 1].level).toBeGreaterThanOrEqual(PACING_MAX_LEVEL)
    expect(rows[0].level).toBe(1)
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
    expect(both.length, 'полного выбора нет ни на одном уровне').toBeGreaterThan(0)
    const first = both[0]
    const last = both[both.length - 1]
    log(
      `Полный выбор из трёх положений: уровни ${first}-${last} ` +
        `(${both.length} из ${rows.length} снятых, ${pct(both.length / rows.length)}).`,
    )
    // Кусок сплошной: дырка внутри означала бы, что на каком-то уровне выбор
    // пропал и вернулся — это не край лестницы, это ошибка в числах.
    const inside = rows.filter((r) => r.level >= first && r.level <= last)
    expect(both.length).toBe(inside.length)
    // И он не крошечный: треть прохождения — минимум, ниже которого «выбор»
    // становится случайным совпадением на паре уровней.
    expect(both.length / rows.length).toBeGreaterThanOrEqual(0.3)
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
    expect(lucky).toBeLessThan(average)
  })
})
