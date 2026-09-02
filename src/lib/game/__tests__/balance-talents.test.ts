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
import { branchHours, branchLevel, branchSpreadLimit, branchRestShareMax, weaponSeeds, points, STYLE_NAMES_RU, runBranch, mean, avg, bestZone, branchTable } from './balance-talents-shared'

describe('ветки талантов', () => {
  for (const cls of CLASS_SET) {
    classIt(cls)(
      `${cls.name}: три чистых билда на ${points} очках сходятся в пределах ${pct(branchSpreadLimit)}`,
      () => {
        const own = branchTable().filter((r) => r.branch.classId === cls.id)
        const spread = spreadOf(own.map((r) => mean(r.runs)))
        log(`${cls.name}: разброс ${pct(spread)} при потолке ${pct(branchSpreadLimit)}.`)
        // Ветка, отставшая сильнее этого, — ловушка: игрок вложил очки и получил
        // меньше, чем если бы вложил куда угодно ещё. Сброс стоит золота, так что
        // ошибка выбора наказывает дважды.
        expect(
          dump(
            `balance/talents/best-zone/level-${String(branchLevel).padStart(3, '0')}/class-${cls.id}/points-${String(points).padStart(3, '0')}/gold-spread`,
            spread,
          ),
          cls.id,
        ).toBeLessThanOrEqual(branchSpreadLimit)
      },
      // Три полных билда на эталоне: ~800 с на одном ядре после двухпроходной оценки.
      1_200_000,
    )
  }
})
