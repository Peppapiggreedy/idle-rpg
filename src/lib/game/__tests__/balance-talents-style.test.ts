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
      `${cls.name}: ветки различаются СТИЛЕМ, а не только числом`,
      () => {
        const zone = intendedZone(branchLevel).id
        // Урон за час БОЯ, а не за час прогона. Делить на все часы теперь нельзя:
        // с ценой боя в четверть запаса герой треть времени сидит на привале, и
        // «урона в час» мерило бы ещё и то, чья ветка реже отдыхает. Обещание
        // ветки урона — БИТЬ сильнее, и меряться оно должно временем под ударом.
        const damage = (runs: SimResult[]) =>
          avg(runs, (r) =>
            r.autoDamage
              .plus(r.abilityDamage)
              .div(r.hours * Math.max(1e-9, 1 - r.restShare))
              .toNumber(),
          )
        const byStyle = new Map<BranchStyle, SimResult[]>()
        for (const branch of BRANCHES.filter((b) => b.classId === cls.id)) {
          byStyle.set(branch.style, runBranch(branch, zone))
        }
        const damageRuns = byStyle.get('damage')!
        const survivalRuns = byStyle.get('survival')!
        const autonomyRuns = byStyle.get('autonomy')!
        log(
          `${cls.name} в зоне ${ZONE_BY_ID[zone].name}. Урон/ч: ` +
            `урон ${damage(damageRuns).toFixed(0)}, ` +
            `живучесть ${damage(survivalRuns).toFixed(0)}, ` +
            `автономность ${damage(autonomyRuns).toFixed(0)}.`,
        )
        log(
          `Доля простоя: урон ${pct(avg(damageRuns, (r) => r.restShare))}, ` +
            `живучесть ${pct(avg(survivalRuns, (r) => r.restShare))}, ` +
            `автономность ${pct(avg(autonomyRuns, (r) => r.restShare))}.`,
        )
        // Ветка урона бьёт сильнее всех — это её обещание.
        expect(
          dump(
            `balance/talents/same-zone/level-${String(branchLevel).padStart(3, '0')}/class-${cls.id}/style-damage/damage-per-combat-hour`,
            damage(damageRuns),
          ),
          cls.id,
        ).toBeGreaterThan(
          dump(
            `balance/talents/same-zone/level-${String(branchLevel).padStart(3, '0')}/class-${cls.id}/style-survival/damage-per-combat-hour`,
            damage(survivalRuns),
          ),
        )
        expect(
          dump(
            `balance/talents/same-zone/level-${String(branchLevel).padStart(3, '0')}/class-${cls.id}/style-damage/damage-per-combat-hour`,
            damage(damageRuns),
          ),
          cls.id,
        ).toBeGreaterThan(
          dump(
            `balance/talents/same-zone/level-${String(branchLevel).padStart(3, '0')}/class-${cls.id}/style-autonomy/damage-per-combat-hour`,
            damage(autonomyRuns),
          ),
        )
        // Ветка живучести меньше всех простаивает — это её обещание.
        expect(
          dump(
            `balance/talents/same-zone/level-${String(branchLevel).padStart(3, '0')}/class-${cls.id}/style-survival/rest-share`,
            avg(survivalRuns, (r) => r.restShare),
          ),
          cls.id,
        ).toBeLessThanOrEqual(
          dump(
            `balance/talents/same-zone/level-${String(branchLevel).padStart(3, '0')}/class-${cls.id}/style-damage/rest-share`,
            avg(damageRuns, (r) => r.restShare),
          ) + 1e-9,
        )
      },
      900_000,
    )
  }
})
