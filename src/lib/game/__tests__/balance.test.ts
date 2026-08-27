// Прогон баланса: гоняет настоящий конвейер тика часами игрового времени и
// печатает таблицы, по которым видно, во что превращается баланс на практике.
// Проверки фиксируют свойства, ради которых зоны и оружие вообще существуют:
// прогресс монотонный, доминирующей зоны нет, прокачка не мгновенная,
// подходящая зона не убивает, а выбор оружия не схлопывается.
import { describe, expect, it } from 'vitest'
import { Decimal } from '../numbers'
import { expectedSwingDamage } from '../combat'
import { BALANCE_PRESET, buildSimState, simulate, spreadOf, type SimResult } from '../simulate'
import { ZONES, zoneMonsterVariants, type Zone } from '../../data/zones'
import { WEAPONS, WEAPON_BY_ID } from '../../data/items'
import { ABILITY_BY_ID } from '../../data/abilities'

// Таблицы печатаются в вывод теста: прогон баланса нужен глазами, а не только
// зелёной галкой. Числа крупные, поэтому раскладываем по колонкам.
const log = (line: string) => console.log(line)
const num = (d: Decimal, width = 9) => d.toFixed(0).padStart(width)
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

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
    const { zoneHours, zoneBuild } = BALANCE_PRESET
    header(
      `Герой ${zoneBuild.level} уровня, ${zoneBuild.sharpening} заточек, автокаст включён, ` +
        `${zoneHours} часов в каждой зоне.`,
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
  const LEVEL = 24
  const SHARPENING = 240

  it('в более сложной зоне при достаточном уровне золота и опыта в час строго больше', () => {
    header(
      `Герой ${LEVEL} уровня (${SHARPENING} заточек), уровень заморожен, 4 часа на зону.`,
      COLUMNS,
    )
    const results = ZONES.map((zone) => {
      const result = simulate({
        hours: 4,
        zoneId: zone.id,
        freezeLevel: true,
        build: { level: LEVEL, sharpening: SHARPENING },
      })
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
  const LEVELS = [1, 5, 10, 16, 24]

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
          build: { level, sharpening: level * 10 },
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
  // «Подходящая» — та, где герой дорос до САМОГО СИЛЬНОГО моба зоны, а не
  // только до порога входа: порог пускает в зону, где мобы ещё выше уровнем.
  it('смертей в час близко к нулю', () => {
    header('Уровень героя равен верхней границе уровня мобов зоны, 1 час на зону.', 'зона                 мобы     уровень героя   смертей/ч')
    for (const zone of ZONES) {
      const level = zone.monsterLevelRange.max
      const result = simulate({
        hours: 1,
        zoneId: zone.id,
        freezeLevel: true,
        build: { level, sharpening: level * 10 },
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
