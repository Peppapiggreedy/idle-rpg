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
  createInitialState,
  defaultAbilitySettings,
  manualOnlySettings,
  spawnMonster,
  emptyEquipment,
  type AbilitySettings,
  type Equipment,
  type GameState,
} from './state'
import { ensureStats } from './stats'
import { tick } from './tick'
import { armorMods, shieldMods, weaponMods } from './loot'
import { estimateZoneTtk, type TtkEstimate } from './combat'
import { buyUpgrade } from './upgrades'
import {
  intendedZone,
  travelToZone,
  zoneById,
  isZoneUnlocked,
  zoneRate,
  zoneStanding,
  type ZoneStanding,
} from './zones'
import { UPGRADES, WEAPON_SHARPENING } from '../data/upgrades'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { AVERAGE_RARITY, RARITY_BY_ID } from '../data/rarity'
import { ARMOR_NOUNS, ONE_HANDED, SHIELDS, WEAPONS, WEAPON_BY_ID } from '../data/items'
import { SLOT_IDS, type SlotId } from '../data/slots'
import { ZONES } from '../data/zones'
import { BRANCHES, talentsInBranch, type BranchId } from '../data/talents'
import { TALENT_FIRST_LEVEL } from '../data/balance'
import type { AttackEvent, Item, Rarity } from '../types'

/** Оружие для прогона. `bare` снимает побочные статы шаблона и оставляет
 *  только три модификатора базы боя — так проверяется чистая нормализация
 *  скорости, без вклада крита и силы атаки конкретной модели. */
export interface SimWeapon {
  templateId: string
  rarity?: Rarity
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
export function styleBuild(style: SimStyle, bare = false): Pick<SimBuild, 'weapon' | 'offhand'> {
  const one = ONE_HANDED[0].id
  const two = (WEAPONS.find((w) => w.hands === 2) ?? WEAPONS[0]).id
  if (style === 'twoHanded') return { weapon: { templateId: two, bare }, offhand: null }
  if (style === 'dual') {
    return { weapon: { templateId: one, bare }, offhand: { templateId: one, bare } }
  }
  return { weapon: { templateId: one, bare }, offhand: 'shield' }
}

/** Кто именно бежит прогон. Всё, что влияет на статы, — источниками, как в
 *  игре: уровень, купленные заточки, надетое оружие, ранги талантов. */
export interface SimBuild {
  level?: number
  sharpening?: number // сколько раз куплена заточка оружия
  weapon?: SimWeapon | null // null — голые кулаки (UNARMED из баланса)
  /** Что во второй руке. Не задан — рука пуста. */
  offhand?: SimWeapon | 'shield' | null
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
  // Таблица зон: герой, которому открыты все четыре зоны. Сам билд не задаём
  // руками — берём эталонный (referenceBuild): «уровень × десять заточек» было
  // выдумкой, а с ценой апгрейда внутри контракта темпа такой герой в игре
  // не встречается.
  zoneHours: 8,
  zoneLevel: 16,
  // Сравнение оружия: бой должен длиться полтора десятка замахов, иначе
  // сравнение меряет перебой добивающего удара, а не нормализацию скорости.
  // Заточек НАМЕРЕННО меньше эталона: чем слабее герой, тем длиннее бой и
  // тем меньше в итоге доля перебоя.
  weaponHours: 4,
  weaponZoneId: 'ashen-ridge',
  weaponBuild: { level: 22, sharpening: 10 } as SimBuild,
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
  stressBuild: { level: 8, sharpening: 0 } as SimBuild,
  stressZoneId: 'ashen-ridge',
  // Ветки талантов: сколько очков вкладывать в ЧИСТЫЙ билд, на каком уровне
  // и в какой зоне их сравнивать. Уровень взят так, чтобы очков хватило на
  // полную ветку, а зона — актуальная для этого уровня.
  branchLevel: 30,
  branchHours: 4,
  /** Потолок расхождения итога между тремя чистыми билдами. */
  branchSpreadLimit: 0.25,
  /** Доля времени на привалах, выше которой зона считается неподъёмной. */
  branchRestShareMax: 0.25,
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
  sharpening: number
  currentZoneId: string
  cells: PacingCell[]
}

// Кеш эталонного прохождения: оно детерминировано, а стоит целого прогона.
let pacingCache: PacingRow[] | null = null

/**
 * Герой, каким его описывает контракт темпа, на заданном уровне: столько
 * заточек, сколько он к этому уровню успел купить, и средняя экипировка.
 *
 * Нужен всем таблицам прогона: «уровень × десять заточек» было удобной
 * выдумкой, но с ценой апгрейда, которая теперь часть контракта, такой герой
 * в игре не встречается — и мерить им зоны значит мерить не ту игру.
 * Уровень выше эталонного отдаёт последнюю известную строку.
 */
export function referenceBuild(level: number): SimBuild {
  pacingCache ??= pacingTable()
  const row = pacingCache.find((r) => r.level === level) ?? pacingCache[pacingCache.length - 1]
  return { level, sharpening: row.sharpening, gear: 'average' }
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
 * конвейером тика от первого уровня: покупает заточку, как только хватает
 * золота, надевает то, что выпало, и переезжает в новую зону, как только она
 * открылась. На каждом взятом уровне снимается состояние — по нему и считается
 * время убийства во всех зонах сразу.
 *
 * Лут случаен, поэтому сид ЗАКРЕПЛЁН: контракт обязан быть воспроизводимым.
 */
export function pacingTable(options: { seed?: number; hours?: number } = {}): PacingRow[] {
  const seed = options.seed ?? BALANCE_PRESET.pacingSeed
  const hours = options.hours ?? BALANCE_PRESET.pacingHours
  const rng = createRng(seed)
  // Экипировка эталонного героя — СРЕДНЯЯ по рулетке, во всех слотах.
  // Коридор темпа держится именно на ней: редкость множит прибавку предмета
  // от 1 до 16 раз, и если бы эталон был голым, коридор описывал бы игру,
  // в которую никто не играет. Везение остаётся преимуществом — герой в
  // редком и легендарном бьёт быстрее коридора, и это ровно то, ради чего
  // лут в игре есть.
  //
  // Автонадевание выключено: случайная находка подменила бы эталон на
  // середине прохождения, и кривая перестала бы быть кривой.
  let state = buildSimState({ gear: 'average' }, ZONES[0].id, seed)
  const rows: PacingRow[] = []
  let deaths = 0

  const snapshot = (level: number, atSec: number) => {
    rows.push({
      level,
      atSec,
      deaths,
      sharpening: (state.upgrades[WEAPON_SHARPENING.id] ?? new Decimal(0)).toNumber(),
      currentZoneId: intendedZone(level).id,
      cells: ZONES.map((zone) => ({
        zoneId: zone.id,
        standing: zoneStanding(state, zone),
        ttk: estimateZoneTtk(state, zone),
      })),
    })
  }

  // Всё золото уходит в заточку: копить его в этой игре не на что.
  const spend = (input: GameState): GameState => {
    let next = input
    for (const def of UPGRADES) {
      for (;;) {
        const bought = buyUpgrade(next, def)
        if (bought === next) break
        next = bought
      }
    }
    return next
  }

  snapshot(1, 0)
  const steps = Math.round((hours * 3600 * 1000) / STEP_MS)
  for (let step = 1; step <= steps; step++) {
    const prev = state
    state = tick(prev, STEP_MS, rng, () => {})
    if (prev.heroState === 'alive' && state.heroState === 'dead') deaths += 1
    // Покупки не на каждый тик: игрок не сидит с пальцем на кнопке, а конвейер
    // пересчитывает статы на каждой покупке.
    if (step % PACING_BUY_EVERY === 0) state = spend(state)
    if (state.level.gt(prev.level)) {
      state = spend(state)
      const level = state.level.toNumber()
      const zone = intendedZone(level)
      if (zone.id !== state.currentZoneId) state = travelToZone(state, zone.id, rng)
      if (level > rows[rows.length - 1].level) snapshot(level, (step * STEP_MS) / 1000)
      if (level >= PACING_MAX_LEVEL) break
    }
  }
  return rows
}

/** Раз в сколько тиков эталонный герой заходит в магазин. */
const PACING_BUY_EVERY = 10

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
  const mods = weaponMods(template, rarity, slot)
  return {
    id: `sim-weapon-${slot}-${template.id}`,
    name: template.noun,
    rarity: rarity.id,
    slot,
    hands: template.hands,
    // Голое оружие — только база боя: скорость и диапазон урона.
    mods: weapon.bare ? mods.filter((m) => m.kind === 'base') : mods,
  }
}

/** Щит для прогона: берём первый из данных, второго пока и нет. */
export function simShieldItem(rarity: Rarity = 'common'): Item {
  const template = SHIELDS[0]
  return {
    id: 'sim-shield',
    name: template.noun,
    rarity,
    slot: 'offHand',
    mods: shieldMods(template, RARITY_BY_ID[rarity]),
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

/** Полный комплект средней по рулетке экипировки. */
export function averageGear(): Equipment {
  const gear = {} as Record<SlotId, Item | null>
  for (const slot of SLOT_IDS) {
    if (slot === 'mainHand') {
      gear.mainHand = {
        id: 'sim-gear-mainHand',
        name: AVERAGE_WEAPON.noun,
        rarity: AVERAGE_RARITY.id,
        slot,
        hands: AVERAGE_WEAPON.hands,
        mods: weaponMods(AVERAGE_WEAPON, AVERAGE_RARITY, 'mainHand'),
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
              mods: shieldMods(SHIELDS[0], AVERAGE_RARITY),
            }
      continue
    }
    gear[slot] = {
      id: `sim-gear-${slot}`,
      name: ARMOR_NOUNS[slot][0],
      rarity: AVERAGE_RARITY.id,
      slot,
      mods: armorMods(slot, AVERAGE_RARITY),
    }
  }
  return gear as Equipment
}

/**
 * Снаряжение прогона. Правила связки те же, что в игре: двуручное оставляет
 * левую руку пустой, одноручное пускает туда щит или второй клинок.
 */
function buildEquipment(build: SimBuild, weapon: Item | null): Equipment {
  const base = build.gear === 'average' ? averageGear() : emptyEquipment()
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

function settingsFor(autocast: SimBuild['autocast']): AbilitySettings {
  if (autocast === undefined || autocast === 'all') return defaultAbilitySettings()
  if (autocast === 'none') return manualOnlySettings()
  const settings = manualOnlySettings()
  autocast.forEach((id, index) => {
    if (settings[id]) settings[id] = { ...settings[id], autocast: true, priority: index }
  })
  // Невыбранные умения уходят в конец списка приоритетов.
  ABILITIES.filter((a) => !autocast.includes(a.id)).forEach((a, index) => {
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
  const base = createInitialState(seed)
  const state: GameState = {
    ...base,
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    upgrades: build.sharpening
      ? { 'weapon-sharpening': new Decimal(build.sharpening) }
      : {},
    talents: { ...(build.talents ?? {}) },
    equipment: buildEquipment(build, weapon),
    abilitySettings: settingsFor(build.autocast),
    // Прогон меряет ЗАДАННЫЙ билд: автонадевание подменило бы его на середине.
    autoEquip: false,
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
  const { hours, zoneId, build = {}, seed = 12345, travel = 'stay', freezeLevel = false } = options
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
    // Каст виден по кулдауну: он тоже только убывает, а вверх его ставит
    // только применение умения (см. payFor в abilities.ts).
    for (const ability of ABILITIES) {
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
    uptime: 1 - deadMs / (seconds * 1000),
    autoDamage,
    abilityDamage,
    manaSpent,
    casts,
    damagePerMana: manaSpent.lte(0) ? null : abilityDamage.div(manaSpent),
    levelReachedAtSec,
  }
}
