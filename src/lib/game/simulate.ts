// Прогон баланса без UI. Своей модели боя здесь НЕТ: симуляция крутит тот же
// самый конвейер `tick`, что и живая игра, поэтому цифры прогона и цифры на
// экране разойтись не могут. Всё, что делает этот модуль сверх тика, —
// собирает билд героя из описания и считает наблюдаемые метрики снаружи,
// не заглядывая внутрь шагов конвейера.
//
// Текста для игрока тут нет: наружу идут только числа и id.
import { Decimal } from './numbers'
import { STEP_MS } from './loop'
import { createRng } from './rng'
import { xpToNextLevel } from './formulas'
import {
  abilitiesOf,
  createInitialState,
  defaultAbilitySettings,
  manualOnlySettings,
  spawnMonster,
  emptyEquipment,
  startingEquipment,
  type AbilitySettings,
  type Equipment,
  type GameState,
} from './state'
import { ensureStats } from './stats'
import { tick } from './tick'
import { averageArmorMods, sellItem, sellPrice, shieldMods, weaponMods } from './loot'
import { upgradeShare } from './equipment'
import { estimateZoneTtk, type TtkEstimate } from './combat'

import {
  intendedZone,
  travelToZone,
  zoneById,
  isZoneUnlocked,
  zoneRate,
  zoneStanding,
  type ZoneStanding,
} from './zones'
import { INVENTORY_SIZE } from '../data/balance'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { AVERAGE_RARITY, RARITY_BY_ID } from '../data/rarity'
import { ARMOR_NOUNS, ONE_HANDED, SHIELDS, WEAPONS, WEAPON_BY_ID } from '../data/items'
import { SLOT_IDS, type SlotId } from '../data/slots'
import { ZONES, averageMonsterLevel } from '../data/zones'
import { BRANCHES, talentsInBranch, type BranchId } from '../data/talents'
import { CLASSES, DEFAULT_CLASS, classById } from '../data/classes'
import { TALENT_FIRST_LEVEL } from '../data/balance'
import type { AttackEvent, Item, Rarity } from '../types'

/** Оружие для прогона. `bare` снимает побочные статы шаблона и оставляет
 *  только три модификатора базы боя — так проверяется чистая нормализация
 *  скорости, без вклада крита и силы атаки конкретной модели. */
export interface SimWeapon {
  templateId: string
  rarity?: Rarity
  /** Уровень предмета; не задан — первый. */
  level?: number
  bare?: boolean
}

/**
 * Стиль боя связки. Прогон сравнивает именно СВЯЗКИ: инвариант нормализации
 * с итерации 2 теперь про них, а не про отдельный предмет.
 */
export type SimStyle = 'twoHanded' | 'shield' | 'dual'

export const SIM_STYLES: readonly SimStyle[] = ['twoHanded', 'dual', 'shield'] as const

/**
 * Связка стиля из ДАННЫХ, а не из списка id в тесте: добавили оружие —
 * прогон подхватит его сам. `bare` снимает побочные статы шаблона: инвариант
 * нормализации скорости — про базу боя, а не про крит кинжала.
 */
export function styleBuild(
  style: SimStyle,
  bare = false,
  level = 1,
): Pick<SimBuild, 'weapon' | 'offhand'> {
  const one = ONE_HANDED[0].id
  const two = (WEAPONS.find((w) => w.hands === 2) ?? WEAPONS[0]).id
  if (style === 'twoHanded') return { weapon: { templateId: two, bare, level }, offhand: null }
  if (style === 'dual') {
    return { weapon: { templateId: one, bare, level }, offhand: { templateId: one, bare, level } }
  }
  return { weapon: { templateId: one, bare, level }, offhand: 'shield' }
}

/** Кто именно бежит прогон. Всё, что влияет на статы, — источниками, как в
 *  игре: уровень, надетые вещи и их уровень, ранги талантов. */
export interface SimBuild {
  /** Класс героя. Не задан — дефолтный, как у старого сейва. */
  classId?: string
  level?: number
  /** Уровень вещей средней экипировки (см. gear): во что одет герой. */
  gearLevel?: number
  weapon?: SimWeapon | null // null — голые кулаки (UNARMED из баланса)
  /** Что во второй руке. Не задан — рука пуста. */
  offhand?: SimWeapon | 'shield' | null
  /**
   * Порог привала. Не задан — как у свежего героя. Ноль выключает привалы
   * совсем: измерения, которые про УДАР (нормализация скорости оружия),
   * иначе мерили бы ещё и то, кто чаще садится отдыхать.
   */
  restThreshold?: number
  // Экипировка эталонного героя. 'average' — все слоты заняты СРЕДНИМ по
  // рулетке предметом (см. AVERAGE_RARITY): это не «повезло» и не «не
  // повезло», а то, во что игрок одет обычно. 'none' — голый герой.
  gear?: 'none' | 'average'
  talents?: Record<string, number>
  // Какие умения жмёт автокаст: 'all' — все, 'none' — ни одного (только
  // автоатака), список id — только они, в порядке приоритета.
  autocast?: 'all' | 'none' | string[]
}

export interface SimOptions {
  hours: number
  zoneId: string
  build?: SimBuild
  seed?: number
  // 'stay' — герой всю дорогу фармит заданную зону (так строится таблица),
  // 'best' — на каждом уровне переезжает в лучшую по опыту ОТКРЫТУЮ зону,
  // то есть ведёт себя как игрок, который следит за прокачкой.
  travel?: 'stay' | 'best'
  /**
   * Что герой делает с полной сумкой. 'keep' — ничего (по умолчанию: прогон
   * мерит билд, а не уборку). 'sell' — продаёт самое дешёвое, как живой
   * игрок: без этого дроп после двенадцатой находки прекращается совсем, и
   * мерить частоту находок стало бы нечем.
   */
  bag?: 'keep' | 'sell'
  // Держать героя на стартовом уровне: опыт копится и попадает в метрики, но
  // уровень не растёт. Нужно для СРАВНЕНИЯ зон: за час свободного прогона
  // герой уходит на два десятка уровней вперёд, и строка «уровень 1» на самом
  // деле мерит уровни 1..30 — сравнивать такие строки между собой нечем.
  freezeLevel?: boolean
}

export interface SimResult {
  hours: number
  zoneId: string // зона, где прогон закончился (при travel: 'best' может отличаться)
  startZoneId: string
  killsPerHour: Decimal
  goldPerHour: Decimal
  xpPerHour: Decimal
  deathsPerHour: number
  // Сколько игровых секунд ещё копить до следующего уровня по темпу прогона;
  // null — темп нулевой, уровень не придёт никогда.
  secondsToNextLevel: number | null
  startLevel: Decimal
  finalLevel: Decimal
  kills: Decimal
  gold: Decimal
  xp: Decimal
  deaths: number
  // Привалы: сколько раз герой уходил отдыхать и какую долю времени просидел.
  // Меряются снаружи, как и всё остальное: уход виден по переходу в 'resting'.
  rests: number
  restsPerHour: number
  restShare: number
  /**
   * ТОЧКИ РЕШЕНИЯ: сколько раз за прогон игре было что предложить.
   *
   * Считается по наблюдаемым событиям, как и всё остальное: выпал предмет
   * (надеть, оставить, продать), пришло очко таланта, открылась зона.
   * Настройки привала и автокаста сюда не входят: их пересматривают, а не
   * «получают», и снаружи этот момент не виден.
   */
  decisions: number
  /** Из них — на находки; остальное уровни и зоны. */
  dropDecisions: number
  /** Секунд между решениями. Пусто — решений не было вовсе. */
  decisionIntervalSec: number | null
  // Доля игрового времени, которую герой прожил живым: 1 — не умирал вовсе.
  uptime: number
  // Урон, разложенный по источнику: автоатака и умения (вместе с их эффектами).
  autoDamage: Decimal
  abilityDamage: Decimal
  manaSpent: Decimal
  casts: number
  // Урон умений за единицу потраченной маны; null — умения не применялись.
  damagePerMana: Decimal | null
  // На какой игровой секунде впервые взят уровень: ключ — номер уровня.
  levelReachedAtSec: Record<number, number>
}

// Пресет таблицы прогона: одними и теми же числами пользуются тест баланса
// (game/__tests__/balance.test.ts) и страница /balance, чтобы «та же таблица»
// была той же буквально, а не похожей.
export const BALANCE_PRESET = {
  // Таблица зон: сам билд не задаём руками — берём эталонный (referenceBuild),
  // то есть снятый с настоящего прохождения, а не выдуманный.
  zoneHours: 8,
  zoneLevel: 16,
  // Сравнение оружия: бой должен длиться полтора десятка замахов, иначе
  // сравнение меряет перебой добивающего удара, а не нормализацию скорости.
  // Оружие НАМЕРЕННО слабее брони (18 уровень против 81): чем меньше доля
  // оружия в убийстве, тем длиннее бой — а мерим мы именно оружие. Зона
  // глубокая по той же причине: прибор, а не сюжет.
  weaponHours: 4,
  weaponZoneId: 'ashen-terrace',
  // Связки меряются с ОБЩЕЙ средней бронёй: реген живёт на живучести вещей,
  // и совсем голый герой умирал бы в зоне замера, меряя смертность, а не удар.
  // Броня одна на все стили, поэтому нормализацию она не трогает.
  weaponBuild: { level: 22, gear: 'average', gearLevel: 81 } as SimBuild,
  /** Уровень голых связок в замерах стилей: под стать зоне замера. */
  weaponLevel: 18,
  // Урон за ману считается по умениям «на следующий удар».
  manaAbilities: ['rending-wound', 'shattering-blow'],
  // Порог расхождения итога между связками с равным уроном оружия в секунду.
  weaponSpreadLimit: 0.03,
  // Сравнение стилей идёт по СРЕДНЕМУ нескольких сидов. Один сид даёт разброс
  // до шести процентов на пустом месте: спавн выдаёт разные пулы мобов, и
  // измерялась бы удача, а не нормализация.
  weaponSeeds: [11, 22, 33, 44],
  // Плата за щит проверяется ПОД ДАВЛЕНИЕМ: слабый герой в зоне не по себе.
  // Там, где герой не теряет HP вовсе, живучесть измерить нечем — и щит
  // выглядел бы чистым проигрышем.
  stressBuild: { level: 8, gear: 'average', gearLevel: 8 } as SimBuild,
  /** Уровень связки в стресс-замере щита: герой всё равно не по себе. */
  stressWeaponLevel: 8,
  stressZoneId: 'ashen-ridge',
  // Ветки талантов: сколько очков вкладывать в ЧИСТЫЙ билд, на каком уровне
  // и в какой зоне их сравнивать. Уровень взят так, чтобы очков хватило на
  // полную ветку, а зона — актуальная для этого уровня.
  branchLevel: 31,
  branchHours: 4,
  /** Потолок расхождения итога между тремя чистыми билдами. */
  branchSpreadLimit: 0.25,
  /** Доля времени на привалах, выше которой зона считается неподъёмной. */
  branchRestShareMax: 0.25,
  /** Окно интервала решений, секунд, и порог тревоги отладочного оверлея. */
  decisionMinSec: 40,
  decisionMaxSec: 90,
  decisionAlertSec: 180,
  /** Уровни, на которых меряются решения и привалы. */
  telemetryLevels: [1, 5, 10, 16, 25, 40] as number[],
  telemetryHours: 1,
  /** Потолок доли времени на привалах в подходящей по уровню зоне. */
  restShareMax: 0.25,
  /** Классы, по которым идёт прогон: контракт темпа держится для КАЖДОГО. */
  classIds: CLASSES.map((c) => c.id),
  // Контракт темпа: сид эталонного прохождения и его потолок по времени.
  pacingSeed: 4242,
  pacingHours: 60,
} as const

// ---------------------------------------------------------------------------
// Контракт темпа боя
// ---------------------------------------------------------------------------

/**
 * До какого уровня меряется темп.
 *
 * Считается по УРОВНЮ ГЕРОЯ, а не по уровню мобов последней зоны: таблица —
 * это прохождение, её строки нумерует герой. Раньше они совпадали случайно,
 * на лестнице из четырёх зон; на одиннадцати уровни мобов сжаты, и таблица
 * обрывалась бы раньше, чем открывается последняя зона.
 */
export const PACING_TAIL_LEVELS = 4
export const PACING_MAX_LEVEL =
  ZONES[ZONES.length - 1].unlockRequirement + PACING_TAIL_LEVELS

export interface PacingCell {
  zoneId: string
  standing: ZoneStanding
  ttk: TtkEstimate
}

export interface PacingRow {
  level: number
  /** Игровых секунд от начала прохождения до этого уровня. */
  atSec: number
  /** Смертей за всё прохождение к этому уровню. */
  deaths: number
  /** Уровень вещей героя на этой строке: во что он одет по своей зоне. */
  gearLevel: number
  currentZoneId: string
  cells: PacingCell[]
}

// Кеш эталонного прохождения: оно детерминировано, а стоит целого прогона.
// Ключ — класс: контракт темпа считается для каждого отдельно.
const pacingCache = new Map<string, PacingRow[]>()

/**
 * Герой, каким его описывает контракт темпа, на заданном уровне: средняя
 * экипировка того уровня вещей, какой он к этому уровню носит.
 *
 * Нужен всем таблицам прогона: выдуманный билд мерил бы не ту игру, а этот
 * снят с эталонного прохождения. Уровень выше эталонного отдаёт последнюю
 * известную строку.
 */
export function referenceBuild(level: number, classId: string = DEFAULT_CLASS.id): SimBuild {
  let rows = pacingCache.get(classId)
  if (!rows) {
    rows = pacingTable({ classId })
    pacingCache.set(classId, rows)
  }
  const row = rows.find((r) => r.level === level) ?? rows[rows.length - 1]
  return { classId, level, gearLevel: row.gearLevel, gear: 'average' }
}

/**
 * ЧИСТЫЙ билд ветки: все её таланты по максимуму, в остальные — ни очка.
 *
 * Ранги считаются из ДАННЫХ дерева, а не перечисляются здесь: добавили талант —
 * прогон подхватит его сам, и сравнение веток не устареет молча.
 */
export function pureBranchTalents(branch: BranchId, points: number): Record<string, number> {
  const ranks: Record<string, number> = {}
  let spent = 0
  for (const talent of talentsInBranch(branch)) {
    if (spent < talent.requiredPointsInBranch) break
    const rank = Math.min(talent.maxRank, points - spent)
    if (rank <= 0) break
    ranks[talent.id] = rank
    spent += rank
  }
  return ranks
}

/** Сколько очков есть у героя этого уровня. */
export function branchPoints(level: number): number {
  return Math.max(0, level - TALENT_FIRST_LEVEL + 1)
}

/** TTK по актуальной зоне — та самая строка, на которой держится коридор. */
export function currentCell(row: PacingRow): PacingCell {
  return row.cells.find((c) => c.standing === 'current') ?? row.cells[0]
}

/** Разброс между минимальным и максимальным TTK по уровням, доля от минимума. */
export function ttkDrift(rows: PacingRow[]): number {
  const values = rows.map((r) => currentCell(r).ttk.avg)
  const min = Math.min(...values)
  if (!(min > 0)) return Number.POSITIVE_INFINITY
  return (Math.max(...values) - min) / min
}

/**
 * ЭТАЛОННОЕ ПРОХОЖДЕНИЕ: герой, который просто играет.
 *
 * Никакого выдуманного «билда N уровня» здесь нет — это была бы отдельная
 * модель прогрессии, и контракт мерил бы её, а не игру. Герой идёт настоящим
 * конвейером тика от первого уровня: переезжает в новую зону, как только она
 * открылась, и переодевается в средние вещи её уровня — так выглядит игрок,
 * который носит то, что вокруг падает. На каждом взятом уровне снимается
 * состояние — по нему и считается время убийства во всех зонах сразу.
 *
 * Лут случаен, поэтому сид ЗАКРЕПЛЁН: контракт обязан быть воспроизводимым.
 */
export function pacingTable(
  options: { seed?: number; hours?: number; classId?: string } = {},
): PacingRow[] {
  const seed = options.seed ?? BALANCE_PRESET.pacingSeed
  const hours = options.hours ?? BALANCE_PRESET.pacingHours
  const classId = options.classId ?? DEFAULT_CLASS.id
  const rng = createRng(seed)
  // Экипировка эталонного героя — СРЕДНЯЯ по рулетке, во всех слотах, и
  // УРОВНЯ ЕГО ЗОНЫ: с заменой заточки на вещи именно находки двигают силу,
  // и герой, который «просто играет», носит то, что падает вокруг. Редкость
  // средняя: везение остаётся преимуществом — герой в редком и легендарном
  // бьёт быстрее коридора, и это ровно то, ради чего лут в игре есть.
  //
  // Автонадевание выключено: переодевание идёт РУКАМИ на смене зоны, чтобы
  // кривая оставалась кривой эталона, а не удачи конкретного прогона.
  const gearFor = (level: number): number =>
    Math.round(averageMonsterLevel(intendedZone(level)))
  let gearLevel = gearFor(1)
  let state = buildSimState({ gear: 'average', gearLevel, classId }, ZONES[0].id, seed)
  const rows: PacingRow[] = []
  let deaths = 0

  const snapshot = (level: number, atSec: number) => {
    rows.push({
      level,
      atSec,
      deaths,
      gearLevel,
      currentZoneId: intendedZone(level).id,
      cells: ZONES.map((zone) => ({
        zoneId: zone.id,
        standing: zoneStanding(state, zone),
        ttk: estimateZoneTtk(state, zone),
      })),
    })
  }

  snapshot(1, 0)
  const steps = Math.round((hours * 3600 * 1000) / STEP_MS)
  for (let step = 1; step <= steps; step++) {
    const prev = state
    state = tick(prev, STEP_MS, rng, () => {})
    if (prev.heroState === 'alive' && state.heroState === 'dead') deaths += 1
    if (state.level.gt(prev.level)) {
      const level = state.level.toNumber()
      const zone = intendedZone(level)
      if (zone.id !== state.currentZoneId) state = travelToZone(state, zone.id, rng)
      // Переодевание на новую ступень: средние вещи уровня СВОЕЙ зоны.
      const nextGear = gearFor(level)
      if (nextGear !== gearLevel) {
        gearLevel = nextGear
        state = ensureStats({
          ...state,
          equipment: averageGear(gearLevel),
          statsDirty: true,
        })
      }
      if (level > rows[rows.length - 1].level) snapshot(level, (step * STEP_MS) / 1000)
      if (level >= PACING_MAX_LEVEL) break
    }
  }
  return rows
}

/** Разброс между лучшим и худшим результатом — доля от худшего. */
export function spreadOf(values: Decimal[]): number {
  const numbers = values.map((v) => v.toNumber())
  const min = Math.min(...numbers)
  if (min <= 0) return Number.POSITIVE_INFINITY
  return (Math.max(...numbers) - min) / min
}

/** Предмет-оружие из шаблона данных. Модификаторы строит та же `weaponMods`,
 *  что и лут, — второй копии правил «оружие задаёт базу боя» не существует. */
export function simWeaponItem(weapon: SimWeapon, slot: 'mainHand' | 'offHand' = 'mainHand'): Item {
  const template = WEAPON_BY_ID[weapon.templateId]
  if (!template) throw new Error(`unknown weapon template: ${weapon.templateId}`)
  const rarity = RARITY_BY_ID[weapon.rarity ?? 'common']
  const level = weapon.level ?? 1
  const mods = weaponMods(template, rarity, slot, level)
  return {
    id: `sim-weapon-${slot}-${template.id}`,
    name: template.noun,
    rarity: rarity.id,
    slot,
    level,
    hands: template.hands,
    // Голое оружие — только база боя: скорость и диапазон урона.
    mods: weapon.bare ? mods.filter((m) => m.kind === 'base') : mods,
  }
}

/** Щит для прогона: берём первый из данных, второго пока и нет. */
export function simShieldItem(rarity: Rarity = 'common', level = 1): Item {
  const template = SHIELDS[0]
  return {
    id: 'sim-shield',
    name: template.noun,
    rarity,
    slot: 'offHand',
    level,
    mods: shieldMods(template, RARITY_BY_ID[rarity], level),
  }
}

/**
 * Оружие «среднего» героя. Три шаблона по построению дают ОДИНАКОВЫЙ урон
 * оружия в секунду (это отдельный инвариант баланса со своим тестом), поэтому
 * выбор между ними на темп не влияет; берём среднее по скорости — чтобы в
 * таблице стояло что-то одно и понятное.
 */
export const AVERAGE_WEAPON = [...ONE_HANDED].sort((a, b) =>
  a.weaponSpeed.minus(b.weaponSpeed).toNumber(),
)[Math.floor(ONE_HANDED.length / 2)]

/** Полный комплект средней по рулетке экипировки заданного уровня вещей. */
export function averageGear(level = 1): Equipment {
  const gear = {} as Record<SlotId, Item | null>
  for (const slot of SLOT_IDS) {
    if (slot === 'mainHand') {
      gear.mainHand = {
        id: 'sim-gear-mainHand',
        name: AVERAGE_WEAPON.noun,
        rarity: AVERAGE_RARITY.id,
        slot,
        level,
        hands: AVERAGE_WEAPON.hands,
        mods: weaponMods(AVERAGE_WEAPON, AVERAGE_RARITY, 'mainHand', level),
      }
      continue
    }
    if (slot === 'offHand') {
      // Средний герой носит щит: одноручное со щитом — самая обычная связка,
      // и коридор темпа держится именно на ней.
      gear.offHand =
        AVERAGE_WEAPON.hands === 2
          ? null
          : {
              id: 'sim-gear-offHand',
              name: SHIELDS[0].noun,
              rarity: AVERAGE_RARITY.id,
              slot,
              level,
              mods: shieldMods(SHIELDS[0], AVERAGE_RARITY, level),
            }
      continue
    }
    gear[slot] = {
      id: `sim-gear-${slot}`,
      name: ARMOR_NOUNS[slot][0],
      rarity: AVERAGE_RARITY.id,
      slot,
      level,
      // Матожидание случайного главного атрибута, а не чей-то конкретный
      // бросок: эталон меряет среднюю броню, а не везение.
      mods: averageArmorMods(slot, AVERAGE_RARITY, level),
    }
  }
  return gear as Equipment
}

/**
 * Снаряжение прогона. Правила связки те же, что в игре: двуручное оставляет
 * левую руку пустой, одноручное пускает туда щит или второй клинок.
 */
function buildEquipment(build: SimBuild, weapon: Item | null): Equipment {
  // ЧТО ЗНАЧИТ «ПО УМОЛЧАНИЮ». Прибор обязан мерить ту игру, в которую играют:
  // свежий герой в игре одет в стартовый комплект класса, а не гол. Раньше
  // разницы не было — автонадевание одевало его в первые же минуты, — но
  // автонадевания больше нет, и голый герой в прогоне мерил бы игру, которой
  // не существует. 'none' по-прежнему раздевает явно: измерения про чистую
  // формулу удара этого и хотят.
  const base =
    build.gear === 'average'
      ? averageGear(build.gearLevel ?? 1)
      : build.gear === 'none'
        ? emptyEquipment()
        : startingEquipment(classById(build.classId))
  const equipment: Equipment = { ...base }
  if (weapon) {
    equipment.mainHand = weapon
    if (weapon.hands === 2) equipment.offHand = null
  }
  if (build.offhand === null) equipment.offHand = null
  else if (build.offhand === 'shield') equipment.offHand = simShieldItem()
  else if (build.offhand) equipment.offHand = simWeaponItem(build.offhand, 'offHand')
  // Двуручное в правой руке несовместимо со второй: правило одно и то же
  // и для игры, и для прогона.
  if (equipment.mainHand?.hands === 2) equipment.offHand = null
  return equipment
}

function settingsFor(autocast: SimBuild['autocast'], classId: string): AbilitySettings {
  if (autocast === undefined || autocast === 'all') return defaultAbilitySettings(classId)
  if (autocast === 'none') return manualOnlySettings(classId)
  const settings = manualOnlySettings(classId)
  autocast.forEach((id, index) => {
    if (settings[id]) settings[id] = { ...settings[id], autocast: true, priority: index }
  })
  // Невыбранные умения уходят в конец списка приоритетов.
  ABILITIES.filter((a) => settings[a.id] && !autocast.includes(a.id)).forEach((a, index) => {
    settings[a.id] = { ...settings[a.id], autocast: false, priority: autocast.length + index }
  })
  return settings
}

/** Стартовое состояние прогона: билд разложен по тем же источникам статов,
 *  что и в живой игре, поэтому конвейер считает его обычным путём. */
export function buildSimState(build: SimBuild, zoneId: string, seed: number): GameState {
  const zone = zoneById(zoneId)
  const level = new Decimal(build.level ?? 1)
  const weapon = build.weapon === null ? null : build.weapon ? simWeaponItem(build.weapon) : null
  const base = createInitialState(seed, build.classId ?? DEFAULT_CLASS.id)
  const state: GameState = {
    ...base,
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    talents: { ...(build.talents ?? {}) },
    equipment: buildEquipment(build, weapon),
    abilitySettings: settingsFor(build.autocast, base.classId),
    // Прогон меряет ЗАДАННЫЙ билд: автонадевание подменило бы его на середине.
    restHpThreshold: build.restThreshold ?? base.restHpThreshold,
    currentZoneId: zone.id,
    // Смерть отбрасывает в последнюю зону, где герой выживал. Ставим её сразу:
    // иначе первая же смерть увела бы прогон в безопасную зону и он мерил бы
    // не ту зону, которую просили.
    lastSurvivedZoneId: zone.id,
    monster: spawnMonster(zone, createRng(seed)),
    statsDirty: true,
  }
  const ready = ensureStats(state)
  return { ...ready, currentHp: ready.stats.maxHp, currentMana: ready.stats.maxMana }
}

// Совокупный опыт от первого уровня: сумма пройденных порогов плюс остаток.
// Нужен, потому что при повышении уровня currentXp обнуляется, и разностью
// по состоянию опыт за прогон не посчитать.
export function totalXpEarned(level: Decimal, currentXp: Decimal): Decimal {
  let sum = currentXp
  const levels = level.toNumber()
  for (let l = 1; l < levels; l++) sum = sum.plus(xpToNextLevel(new Decimal(l)))
  return sum
}

// Лучшая по опыту ОТКРЫТАЯ зона: тот же zoneRate, которым игра считает прогноз.
function bestZoneId(state: GameState): string {
  let best = state.currentZoneId
  let bestXp = new Decimal(-1)
  for (const zone of ZONES) {
    if (!isZoneUnlocked(state, zone)) continue
    const xp = zoneRate(state, zone, 'auto').xpPerSecond
    if (xp.gt(bestXp)) {
      bestXp = xp
      best = zone.id
    }
  }
  return best
}

/**
 * N игровых часов настоящим конвейером тика. Возвращает метрики темпа.
 *
 * Зона задаётся напрямую, БЕЗ проверки unlockRequirement: это измерительный
 * прибор, и «что будет, если сунуться раньше времени» — законный вопрос.
 * Правило входа живёт в `travelToZone` и продолжает работать в игре.
 */
export function simulate(options: SimOptions): SimResult {
  const {
    hours,
    zoneId,
    build = {},
    seed = 12345,
    travel = 'stay',
    freezeLevel = false,
    bag = 'keep',
  } = options
  const rng = createRng(seed)
  let state = buildSimState(build, zoneId, seed)
  const startLevel = state.level
  const startGold = state.gold
  const frozen = { level: state.level, currentXp: state.currentXp, xpToNext: state.xpToNext }

  let xp = new Decimal(0)
  let kills = new Decimal(0)
  let deaths = 0
  let deadMs = 0
  let rests = 0
  let restingMs = 0
  let decisions = 0
  let dropDecisions = 0
  let openZones = ZONES.filter((z) => z.unlockRequirement <= state.level.toNumber()).length
  let talentPoints = branchPoints(state.level.toNumber())
  let autoDamage = new Decimal(0)
  let abilityDamage = new Decimal(0)
  let manaSpent = new Decimal(0)
  let casts = 0
  const levelReachedAtSec: Record<number, number> = {}

  // Урон копим прямо из шины ударов тика: это те же события, что рисуют
  // цифры на экране, — отдельного учёта урона симуляция не заводит.
  const collect = (event: AttackEvent) => {
    if (event.targetId === 'hero') return
    if (event.abilityId === null) autoDamage = autoDamage.plus(event.amount)
    else abilityDamage = abilityDamage.plus(event.amount)
  }

  const steps = Math.round((hours * 3600 * 1000) / STEP_MS)
  for (let step = 1; step <= steps; step++) {
    const prev = state
    state = tick(prev, STEP_MS, rng, collect)

    // Опыт копим потиково: при повышении уровня currentXp обнуляется, поэтому
    // разность по концам прогона его не увидит. Пока уровень тот же — растёт
    // только остаток; на самом уровне считаем через совокупный опыт.
    xp = xp.plus(
      state.level.eq(prev.level)
        ? state.currentXp.minus(prev.currentXp)
        : totalXpEarned(state.level, state.currentXp).minus(
            totalXpEarned(prev.level, prev.currentXp),
          ),
    )

    // Убийство видно снаружи по взведённому таймеру респауна: во время
    // отсчёта он только убывает, вверх его двигает ровно смерть моба.
    if (prev.respawnMsLeft <= 0 && state.respawnMsLeft > 0) kills = kills.plus(1)
    if (prev.heroState === 'alive' && state.heroState === 'dead') deaths += 1
    if (state.heroState === 'dead') deadMs += STEP_MS
    // Привал виден снаружи так же, как убийство: по переходу состояния.
    if (prev.heroState !== 'resting' && state.heroState === 'resting') rests += 1
    if (state.heroState === 'resting') restingMs += STEP_MS
    // Точки решения по находкам. Решение — это находка, над которой игрок
    // ОСТАНАВЛИВАЕТСЯ: либо она лучше надетого (её надо надеть — автонадевания
    // больше нет, и это теперь главный вид решения), либо она выше обычной
    // редкости и её стоит хотя бы рассмотреть. Обычный хлам, который не
    // апгрейд, игрок продаёт не глядя, и решением он не является.
    // Материалы не считаются вовсе — они складываются в мешок сами.
    //
    // Считаем ДО уборки сумки: продажа в том же шаге обнулила бы разницу,
    // и находка перестала бы считаться решением.
    for (let i = prev.inventory.length; i < state.inventory.length; i += 1) {
      const found = state.inventory[i]
      if (!found) continue
      if (found.rarity !== 'common' || upgradeShare(state, found) !== null) {
        decisions += 1
        dropDecisions += 1
      }
    }
    // Полная сумка: живой игрок продаёт самое дешёвое и освобождает место.
    // Без этого дроп после двенадцатой находки прекращается совсем.
    if (bag === 'sell' && state.inventory.length >= INVENTORY_SIZE) {
      const cheapest = state.inventory.reduce((min, item) =>
        sellPrice(item).lt(sellPrice(min)) ? item : min,
      )
      state = sellItem(state, cheapest.id)
    }
    if (state.level.gt(prev.level)) {
      const level = state.level.toNumber()
      const zonesNow = ZONES.filter((z) => z.unlockRequirement <= level).length
      const pointsNow = branchPoints(level)
      decisions += zonesNow - openZones + Math.max(0, pointsNow - talentPoints)
      openZones = zonesNow
      talentPoints = pointsNow
    }
    // Каст виден по кулдауну: он тоже только убывает, а вверх его ставит
    // только применение умения (см. payFor в abilities.ts).
    for (const ability of abilitiesOf(state.classId)) {
      const before = prev.abilityCooldownsMs[ability.id] ?? 0
      const after = state.abilityCooldownsMs[ability.id] ?? 0
      if (after > before) {
        casts += 1
        manaSpent = manaSpent.plus(ABILITY_BY_ID[ability.id].manaCost)
      }
    }
    if (state.level.gt(prev.level)) {
      const level = state.level.toNumber()
      if (levelReachedAtSec[level] === undefined) {
        levelReachedAtSec[level] = (step * STEP_MS) / 1000
      }
      if (travel === 'best') state = travelToZone(state, bestZoneId(state), rng)
      // Откат уровня делаем ПОСЛЕ учёта опыта: метрики видят настоящий темп,
      // а статы героя остаются теми, про которые спросили. statsDirty уже
      // взведён шагом уровня — следующий тик пересчитает конвейер обратно.
      if (freezeLevel) state = { ...state, ...frozen, statsDirty: true }
    }
  }

  const seconds = hours * 3600
  const gold = state.gold.minus(startGold)
  const xpPerSecond = xp.div(seconds)
  const remaining = state.xpToNext.minus(state.currentXp)
  return {
    hours,
    zoneId: state.currentZoneId,
    startZoneId: zoneId,
    killsPerHour: kills.div(hours),
    goldPerHour: gold.div(hours),
    xpPerHour: xp.div(hours),
    deathsPerHour: deaths / hours,
    secondsToNextLevel: xpPerSecond.lte(0) ? null : remaining.div(xpPerSecond).toNumber(),
    startLevel,
    finalLevel: state.level,
    kills,
    gold,
    xp,
    deaths,
    rests,
    restsPerHour: rests / hours,
    restShare: restingMs / (seconds * 1000),
    decisions,
    dropDecisions,
    decisionIntervalSec: decisions > 0 ? seconds / decisions : null,
    uptime: 1 - deadMs / (seconds * 1000),
    autoDamage,
    abilityDamage,
    manaSpent,
    casts,
    damagePerMana: manaSpent.lte(0) ? null : abilityDamage.div(manaSpent),
    levelReachedAtSec,
  }
}
