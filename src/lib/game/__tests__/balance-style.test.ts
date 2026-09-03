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
        // ПРИВАЛ ВКЛЮЧЁН, ПОРОГ ОБЫЧНЫЙ. Раньше здесь стоял ноль: «измерение
        // про удар, а не про то, кто чаще отдыхает». Пока мобы почти не били,
        // ноль означал «простоя нет вовсе». Теперь бой стоит четверти запаса,
        // и ноль означает уже не «без привалов», а «до смерти» — прогон
        // начинал мерить, кому из связок повезло умереть попозже, и разброс
        // подскочил до 10%. Обе парные связки одинаково защищены (щита нет
        // ни у одной), поэтому привал у них общий и из сравнения выпадает —
        // а смерть выпадает вовсе.
        build: { ...weaponBuild, ...styleBuild(style, true, WEAPON_LEVEL), autocast },
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
      const g = dump(
        `balance/style/normalisation/zone-${weaponZoneId}/weapon-level-${String(WEAPON_LEVEL).padStart(3, '0')}/style-${style.toLowerCase()}/gold-per-hour`,
        meanGold(runs).toNumber(),
      )
      const rests = runs.reduce((sum, r) => sum + r.restsPerHour, 0) / runs.length
      const dev = style === 'shield' ? '' : ((g - mean) / mean >= 0 ? '+' : '') + pct((g - mean) / mean)
      log(
        `${STYLE_NAMES[style].padEnd(21)} ${g.toFixed(0).padStart(9)}   ${dev.padStart(10)}   ` +
          `${rests.toFixed(1).padStart(10)}`,
      )
    }
    const spread = spreadOf(paired.map((r) => meanGold(r.runs)))
    log(
      `Разброс ${pct(spread)} при ${hitsPerKill(zone, weaponBuild, WEAPON_LEVEL).toFixed(1)} замахах двуручника на моба.`,
    )
    expect(
      dump(
        `balance/style/normalisation/zone-${weaponZoneId}/weapon-level-${String(WEAPON_LEVEL).padStart(3, '0')}/paired-gold-spread`,
        spread,
      ),
    ).toBeLessThanOrEqual(weaponSpreadLimit)
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
    // МЕРИТСЯ ПРИВАЛ, А НЕ ВЕСЬ ПРОСТОЙ, и разница принципиальна. Простой —
    // это привалы ПЛЮС смерти, и в зоне не по себе вторая половина говорит не
    // о живучести, а об уроне: щит бьёт вдвое слабее, схватка тянется вдвое
    // дольше, и герой не доживает до конца. Замер: со щитом привал 13.6% и
    // смерти 10.9% при 52 убийствах в час, с двумя клинками привал 17.9% и
    // смерти 13.4% при 65 убийствах.
    //
    // ЖИВУЧЕСТЬ ВИДНА ИМЕННО В ПРИВАЛЕ: щит смягчает удар, значит HP тает
    // медленнее, значит отдыхать приходится реже. А то, что за это заплачено
    // уроном, проверяется отдельно — по урону в секунду, ниже.
    const idle = (runs: SimResult[]) =>
      runs.reduce((sum, r) => sum + r.restShare, 0) / runs.length
    header(
      `Герой ${stressBuild.level} уровня со связкой ${BALANCE_PRESET.stressWeaponLevel} уровня в зоне ` +
        `${ZONES.find((z) => z.id === stressZoneId)!.name} — не по себе. ${weaponHours} ч.`,
      'стиль                 золота/ч    привал   смерти',
    )
    for (const [style, runs] of [
      ['dual', dual],
      ['shield', shield],
    ] as const) {
      log(`${STYLE_NAMES[style].padEnd(21)} ${meanGold(runs).toFixed(0).padStart(9)}   ${pct(idle(runs)).padStart(7)}   ${pct(runs.reduce((a, r) => a + 1 - r.uptime, 0) / runs.length).padStart(7)}`)
    }
    // Привал обязан заметно упасть, а не просто «не вырасти»: щит покупает
    // живучесть, и покупка должна быть видна.
    expect(
      dump(
        `balance/style/shield-cost/zone-${stressZoneId}/weapon-level-${String(BALANCE_PRESET.stressWeaponLevel).padStart(3, '0')}/style-shield/rest-share`,
        idle(shield),
      ),
    ).toBeLessThan(
      dump(
        `balance/style/shield-cost/zone-${stressZoneId}/weapon-level-${String(BALANCE_PRESET.stressWeaponLevel).padStart(3, '0')}/style-dual/rest-share`,
        idle(dual),
      ) * 0.9,
    )
    // А вот золото со щитом теперь может оказаться и БОЛЬШЕ, и это не сбой
    // баланса, а следствие шага 35: привал переехал между боями, и в тяжёлой
    // зоне живучесть напрямую превращается во время под мобами. Платит щит
    // именно УРОНОМ — это и проверяется отдельно, ниже и выше по файлу.
    // Урон нормируется на ВРЕМЯ ПОД МОБАМИ, а не берётся суммой за прогон:
    // щит поднимает живучесть, а значит и время в бою, и суммарный урон со
    // щитом может оказаться больше при заметно меньшем уроне в секунду.
    // Сравнивать суммы значило бы мерить живучесть под видом урона.
    const autoRate = (runs: SimResult[]): Decimal =>
      runs
        .reduce(
          (sum, r) => sum.plus(r.autoDamage.div(Math.max(r.uptime - r.restShare, 1e-9))),
          new Decimal(0),
        )
        .div(runs.length)
    const damageLoss =
      1 -
      dump(
        `balance/style/shield-cost/zone-${stressZoneId}/weapon-level-${String(BALANCE_PRESET.stressWeaponLevel).padStart(3, '0')}/style-shield/auto-damage-per-combat-sec`,
        autoRate(shield),
      )
        .div(
          dump(
            `balance/style/shield-cost/zone-${stressZoneId}/weapon-level-${String(BALANCE_PRESET.stressWeaponLevel).padStart(3, '0')}/style-dual/auto-damage-per-combat-sec`,
            autoRate(dual),
          ),
        )
        .toNumber()
    log(`Щит стоит ${pct(damageLoss)} урона автоатаки в секунду боя.`)
    expect(
      dump(
        `balance/style/shield-cost/zone-${stressZoneId}/weapon-level-${String(BALANCE_PRESET.stressWeaponLevel).padStart(3, '0')}/auto-damage-loss-share`,
        damageLoss,
      ),
    ).toBeGreaterThan(0.15)
  }, 300_000)

  it('перебой: чем короче бой, тем сильнее расходится итог', () => {
    // Инвариант выше держится не везде: он про урон, который ДОШЁЛ до моба.
    // Когда моб умирает с одного замаха, лишний урон крупного удара пропадает,
    // и частая связка выигрывает просто числом замахов. Таблица показывает
    // границу, за которой выбор стиля перестаёт быть равным.
    //
    // ГЕРОЙ ОДИН И ТОТ ЖЕ — эталон замера нормализации, — а длину боя задают
    // зона и уровень оружия. Раньше каждая клетка брала голого героя своего
    // уровня в своей зоне с порогом привала ноль: при цене боя в 13-20%
    // запаса такой герой в своей зоне не выживает, и вместо разброса таблица
    // печатала бесконечность. Здесь же герой всюду выше мобов и не гибнет,
    // так что разброс мерит перебой, а не то, кому повезло умереть позже.
    // Замер (4 сида): 18.8 замаха — 0.4%, 10.4 — 4.8%, 5.0 — 11%, 3.5 — 13%,
    // 1.8 — 26%, 1.3 — 31%; лучшей всюду выходит пара клинков.
    header(
      `Голые связки, герой ${LEVEL} уровня в броне ${weaponBuild.gearLevel} уровня, только автоатака, ` +
        `1 час на клетку. Разброс против длины боя.`,
      'зона                 ур. оружия   замахов/моб   разброс   лучшее',
    )
    const cases = [
      { zone: weaponZoneId, weaponLevel: WEAPON_LEVEL },
      { zone: weaponZoneId, weaponLevel: 35 },
      { zone: 'ashen-ridge', weaponLevel: 81 },
      { zone: 'mirefen-hollows', weaponLevel: 81 },
      { zone: 'hollow-quarry', weaponLevel: 81 },
      { zone: 'shepherds-meadow', weaponLevel: 20 },
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
              build: { ...weaponBuild, ...styleBuild(style, true, c.weaponLevel), autocast: 'none' },
            }),
          ),
        ),
      )
      const spread = dump(
        `balance/style/overkill/zone-${c.zone}/weapon-level-${String(c.weaponLevel).padStart(3, '0')}/paired-gold-spread`,
        spreadOf(gold),
      )
      const numbers = gold.map((g) => g.toNumber())
      const best = STYLE_NAMES[paired[numbers.indexOf(Math.max(...numbers))]]
      log(
        `${zone.name.padEnd(20)} ${String(c.weaponLevel).padStart(10)} ` +
          `${hitsPerKill(zone, weaponBuild, c.weaponLevel).toFixed(1).padStart(13)} ${pct(spread).padStart(9)}   ${best}`,
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
          `${num(result.abilityDamage, 13)} ${num(result.manaSpent)} ${num(
            dump(
              `balance/style/damage-per-mana/zone-${weaponZoneId}/weapon-${template.id}/damage-per-mana`,
              result.damagePerMana!,
            ),
            14,
          )}`,
      )
      return { template, result }
    })

    const [fast, slow] = rows
    const ratio = dump(
      `balance/style/damage-per-mana/zone-${weaponZoneId}/slow-${slow.template.id}-over-fast-${fast.template.id}/damage-per-mana-ratio`,
      slow.result.damagePerMana!.div(fast.result.damagePerMana!).toNumber(),
    )
    const speedRatio = dump(
      `balance/style/damage-per-mana/zone-${weaponZoneId}/slow-${slow.template.id}-over-fast-${fast.template.id}/speed-ratio`,
      slow.template.weaponSpeed.div(fast.template.weaponSpeed).toNumber(),
    )
    log(`Урон за ману выше в ${ratio.toFixed(2)} раза при разнице скоростей в ${speedRatio.toFixed(2)} раза.`)
    // Медленное оружие обязано выигрывать по урону за ману, и ровно во столько
    // раз, во сколько оно медленнее: доля замаха — это и есть вся формула.
    expect(ratio).toBeGreaterThan(1)
    // В пределах десятой доли: точное равенство ломает перебой добивающего
    // удара, а он к формуле умений отношения не имеет.
    expect(
      dump(
        `balance/style/damage-per-mana/zone-${weaponZoneId}/slow-${slow.template.id}-over-fast-${fast.template.id}/ratio-vs-speed-rel-diff`,
        Math.abs(ratio - speedRatio) / speedRatio,
      ),
    ).toBeLessThan(0.1)
  }, 300_000)
})
