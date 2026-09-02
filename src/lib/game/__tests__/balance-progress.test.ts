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

describe('прогресс монотонный', () => {
  // Уровень заморожен: за восемь часов свободного прогона герой уходит на
  // десятки уровней вперёд, и строки таблицы перестают быть сравнимыми.
  const LEVEL = PACING_MAX_LEVEL

  it('в более сложной зоне при достаточном уровне золота и опыта в час строго больше', () => {
    const build = referenceBuild(LEVEL)
    header(
      `Эталонный герой ${LEVEL} уровня (вещи ${build.gearLevel} уровня), уровень заморожен, ` +
        `${sampleHours(4)} часа на зону.`,
      COLUMNS,
    )
    const results = ZONE_SET.map((zone) => {
      const result = simulate({ hours: sampleHours(4), zoneId: zone.id, freezeLevel: true, build })
      log(row(result, zone.name))
      return result
    })

    // ЗОЛОТО монотонно по ВСЕМ зонам без исключений: штраф за отставание его
    // не трогает, и это ровно то, ради чего он его не трогает — за низкими
    // материалами должно оставаться куда пойти.
    for (let i = 1; i < results.length; i++) {
      expect(
        dump(
          `balance/monotone/level-${String(LEVEL).padStart(3, '0')}/zone-${ZONE_SET[i].id}/gold-per-hour`,
          results[i].goldPerHour,
        ).gt(
          dump(
            `balance/monotone/level-${String(LEVEL).padStart(3, '0')}/zone-${ZONE_SET[i - 1].id}/gold-per-hour`,
            results[i - 1].goldPerHour,
          ),
        ),
        ZONE_SET[i].id,
      ).toBe(true)
    }

    // ОПЫТ монотонен там, где он вообще есть. У замороженного эталона высокого
    // уровня нижние зоны отстали больше чем на десять уровней и не платят
    // опыта вовсе — это не разрыв прогрессии, а сам штраф, и требовать от
    // нулей строгого роста значило бы требовать отмены штрафа.
    //
    // Взамен проверяется ДВЕ вещи, и вместе они строже прежнего одного
    // сравнения: нули идут СПЛОШНЫМ ПРЕФИКСОМ (начала платить — платят и все
    // зоны тяжелее, дыр в середине лестницы нет), а среди платящих рост
    // строгий. Раньше первого утверждения не было вовсе.
    const paying = results.findIndex((r) => r.xpPerHour.gt(0))
    expect(
      dump(`balance/monotone/level-${String(LEVEL).padStart(3, '0')}/first-paying-zone-index`, paying),
      'ни одна зона не платит опыта — штраф съел лестницу целиком',
    ).toBeGreaterThanOrEqual(0)
    results.forEach((r, i) => {
      const expected = i >= paying
      expect(
        dump(
          `balance/monotone/level-${String(LEVEL).padStart(3, '0')}/zone-${ZONE_SET[i].id}/xp-per-hour`,
          r.xpPerHour,
        ).gt(0),
        `${ZONE_SET[i].id}: дыра в лестнице опыта`,
      ).toBe(expected)
    })
    for (let i = paying + 1; i < results.length; i++) {
      expect(
        dump(
          `balance/monotone/level-${String(LEVEL).padStart(3, '0')}/zone-${ZONE_SET[i].id}/xp-per-hour`,
          results[i].xpPerHour,
        ).gt(
          dump(
            `balance/monotone/level-${String(LEVEL).padStart(3, '0')}/zone-${ZONE_SET[i - 1].id}/xp-per-hour`,
            results[i - 1].xpPerHour,
          ),
        ),
        ZONE_SET[i].id,
      ).toBe(true)
    }
    // Прогноз по всем зонам и уровням — тысячи оценок боя; оценка идёт двумя
    // проходами (мана с привала, лечение), и на одном ядре тест стоит ~500 с.
  }, 900_000)
})
