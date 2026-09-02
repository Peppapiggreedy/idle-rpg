// Помощники контракта веток талантов. Вынесены, потому что два его теста
// разъехались по разным файлам: «три чистых билда» строит таблицу лучших
// зон настоящим тиком (826 с из 2968 с всей матрицы) и обязан идти один.
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

export const { branchHours, branchLevel, branchSpreadLimit, branchRestShareMax, weaponSeeds } =
  BALANCE_PRESET
export const points = branchPoints(branchLevel)
// Название стиля берётся ИЗ ДАННЫХ ветки, а не из таблицы по id: веток
// шесть, и таблица разъехалась бы с деревом при первой же правке.
export const STYLE_NAMES_RU: Record<BranchStyle, string> = {
  damage: 'урон',
  survival: 'живучесть',
  autonomy: 'автономность',
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
// Ветка играется ГЕРОЕМ СВОЕГО КЛАССА: дерево привязано к классу, и
// прогнать ветку изувера на страже значило бы прогнать её впустую —
// конвейер статов чужие ранги игнорирует.
export function runBranch(branch: BranchDef, zoneId: string): SimResult[] {
  return sampleSeeds(weaponSeeds).map((seed) =>
    simulate({
      hours: sampleHours(branchHours),
      zoneId,
      seed,
      freezeLevel: true,
      build: {
        ...referenceBuild(branchLevel, branch.classId),
        classId: branch.classId,
        talents: pureBranchTalents(branch.id, points),
      },
    }),
  )
}

export const mean = (runs: SimResult[]) =>
  runs.reduce((sum, r) => sum.plus(r.goldPerHour), new Decimal(0)).div(runs.length)
export const avg = (runs: SimResult[], pick: (r: SimResult) => number) =>
  runs.reduce((sum, r) => sum + pick(r), 0) / runs.length

/** Самая глубокая ОТКРЫТАЯ зона, которую ветка тянет: без смертей и без
 *  просиживания. Вход по уровню обязателен: «какую зону тянет билд» в живой
 *  игре упирается в travelToZone, и мерить закрытые значит мерить не игру. */
export function bestZone(branch: BranchDef): { zoneId: string; runs: SimResult[] } {
  for (let i = ZONE_SET.length - 1; i >= 0; i -= 1) {
    const opener = dungeonOpening(ZONE_SET[i].id)
    if (opener && branchLevel < opener.unlockRequirement) continue
    const runs = runBranch(branch, ZONE_SET[i].id)
    const deaths = avg(runs, (r) => r.deathsPerHour)
    const rest = avg(runs, (r) => r.restShare)
    if (deaths === 0 && rest <= branchRestShareMax) return { zoneId: ZONE_SET[i].id, runs }
  }
  return { zoneId: ZONE_SET[0].id, runs: runBranch(branch, ZONE_SET[0].id) }
}

// Таблица строится ОДИН раз на все классы: ветка играет свою лучшую зону,
// это десятки часов тика. Каждый класс потом читает свои строки.
export type BranchRow = { branch: BranchDef; zoneId: string; runs: SimResult[] }
let branchRows: BranchRow[] | null = null
export const branchTable = (): BranchRow[] => {
  if (branchRows) return branchRows
  header(
    `Чистые билды по веткам, герой ${branchLevel} уровня в средней экипировке, ` +
      `${branchHours} ч на сид. Каждая ветка играет самую глубокую зону, которую тянет.`,
    'ветка            стиль          зона                 золота/ч   отклонение   простой',
  )
  const branches = BRANCHES.filter((b) => CLASS_SET.some((c) => c.id === b.classId))
  const rows = branches.map((branch) => ({ branch, ...bestZone(branch) }))
  // Зона в ключ не входит намеренно: она ИСХОД замера (какую ветка тянет),
  // а не его вход — иначе смена лучшей зоны переименовывала бы строку.
  const gold = rows.map((r) =>
    dump(
      `balance/talents/best-zone/level-${String(branchLevel).padStart(3, '0')}/branch-${r.branch.id}/gold-per-hour`,
      mean(r.runs).toNumber(),
    ),
  )
  const average = gold.reduce((a, b) => a + b, 0) / gold.length
  rows.forEach((row, i) => {
    const idle = avg(row.runs, (r) => r.restShare + (1 - r.uptime))
    log(
      `${`${row.branch.classId}/${row.branch.name}`.padEnd(24)} ` +
        `${STYLE_NAMES_RU[row.branch.style].padEnd(14)} ` +
        `${(ZONE_BY_ID[row.zoneId]?.name ?? row.zoneId).padEnd(20)} ${gold[i].toFixed(0).padStart(8)}   ` +
        `${(((gold[i] - average) / average >= 0 ? '+' : '') + pct((gold[i] - average) / average)).padStart(10)}   ` +
        `${pct(idle).padStart(7)}`,
    )
  })
  branchRows = rows
  return rows
}

// Разброс считается ВНУТРИ КЛАССА: ветки одного класса — это выбор игрока
// между собой, а страж против изувера — другой вопрос, и меряется он
// таблицей темпа, а не здесь.
