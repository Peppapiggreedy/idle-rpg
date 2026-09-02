// Общая прелюдия балансной матрицы. Вынесена из balance.test.ts, когда тот
// был разрезан на файлы: профиль показал, что 87 % времени матрицы лежит
// в одном файле, а раннер раскладывает по ядрам ФАЙЛЫ, а не тесты.
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

/** Сид контракта цены боя: контракт обязан быть воспроизводимым до числа. */
export const CONTRACT_SEED = 4242

/**
 * БЫСТРЫЙ РЕЖИМ ПРОГОНА: `BALANCE_SAMPLE=1`.
 *
 * Сужается ОХВАТ, а не строгость. Пороги, сравнения и сами ассерты — те же
 * самые до буквы: коридор темпа, отсутствие доминирующей зоны, привал короче
 * боя, разброс веток. Меняется только то, СКОЛЬКО клеток матрицы прогоняется:
 * три зоны вместо двадцати, два уровня вместо пяти, один класс вместо двух,
 * меньше игровых часов на клетку.
 *
 * Зачем: полная матрица стоит одиннадцать минут и держит на себе 89% времени
 * всего набора юнит-тестов. Столько ждать после каждой правки нельзя, а не
 * гонять баланс вовсе — значит узнать о сломанной кривой из игры.
 *
 * Полная матрица никуда не делась: `npm run test:balance` гоняет её целиком,
 * и она же идёт ночью и на каждом PR, который трогает `data/` или `game/`.
 */
export const SAMPLE = process.env.BALANCE_SAMPLE === '1'

/** Представительная выборка зон: начало лестницы, середина и конец. Именно
 *  начало и конец, а не соседи: между ними разница максимальная, и монотонность
 *  с «нет доминирующей зоны» на них проверяются строже, а не слабее. */
export const ZONE_SET: Zone[] = SAMPLE
  ? [ZONES[0], ZONES[Math.floor(ZONES.length / 2)], ZONES[ZONES.length - 1]]
  : ZONES

/** Классы: в выборке один. Дерево привязано к классу, поэтому вместе с ним
 *  сужается и набор веток — иначе ветки чужого класса прогонялись бы впустую. */
// Готовые классы первыми, превью следом; выборка — только основной класс.
// Контракты превью-класса некритичны: см. `class-set.ts`.
export const CLASS_SET = contractClasses(SAMPLE)

/** Часы игрового времени на клетку матрицы. Вчетверо меньше в выборке. */
export const sampleHours = (full: number) => (SAMPLE ? Math.max(1, Math.round(full / 4)) : full)

/** Сиды: в выборке половина. Меньше двух брать нельзя — среднее по одному
 *  прогону это уже не среднее, а один бросок, и порог начнёт мигать. */
export const sampleSeeds = (seeds: readonly number[]) =>
  SAMPLE ? seeds.slice(0, Math.max(2, Math.ceil(seeds.length / 2))) : [...seeds]

// Таблицы печатаются в вывод теста: прогон баланса нужен глазами, а не только
// зелёной галкой. Числа крупные, поэтому раскладываем по колонкам.
export const log = (line: string) => console.log(line)
export const num = (d: Decimal, width = 9) => d.toFixed(0).padStart(width)
export const pct = (x: number) => `${(x * 100).toFixed(1)}%`
export const ttk = (x: number) => (Number.isFinite(x) ? (x >= 1000 ? x.toFixed(0) : x.toFixed(1)) : '∞')

export function header(title: string, columns: string) {
  log('')
  log(title)
  log(columns)
  log('-'.repeat(columns.length))
}

export function row(r: SimResult, name: string): string {
  const next =
    r.secondsToNextLevel === null ? '     —' : `${(r.secondsToNextLevel / 60).toFixed(1)}м`.padStart(6)
  return (
    `${name.padEnd(20)} ${num(r.killsPerHour, 8)} ${num(r.goldPerHour)} ${num(r.xpPerHour)} ` +
    `${r.deathsPerHour.toFixed(1).padStart(8)} ${next} ${String(r.finalLevel).padStart(6)}`
  )
}

export const COLUMNS =
  'зона                 убийств/ч   золота/ч    опыта/ч смертей/ч  до ур.  итог'

// Сколько замахов самого медленного оружия держит средний моб зоны. От этого
// числа зависит доля перебоя: чем короче бой, тем больше урона уходит мимо.
// Герой берётся ЦЕЛИКОМ, с бронёй сборки: сила и ловкость с вещей входят в
// замах, и голый герой насчитал бы на треть больше ударов, чем бьёт настоящий.
export function hitsPerKill(zone: Zone, build: SimBuild, weaponLevel: number): number {
  const state = buildSimState(
    { ...build, ...styleBuild('twoHanded', true, weaponLevel), autocast: 'none' },
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
