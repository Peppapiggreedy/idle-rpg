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
  defaultAbilitySlots,
  fillAbilitySlots,
  manualOnlySettings,
  monsterFromTemplate,
  spawnMonster,
  emptyEquipment,
  startingEquipment,
  type AbilitySettings,
  type Equipment,
  type GameState,
  type AbilitySlots,
} from './state'
import { ensureStats, type StatModifier } from './stats'
import { tick } from './tick'
import { averageArmorMods, sellItem, sellPrice, shieldMods, weaponMods } from './loot'
import { zoneSafety } from './rest'
import { equipItem, equipmentWith, upgradeShare } from './equipment'
import { estimateCombatRate, estimateZoneTtk, type TtkEstimate } from './combat'

import {
  intendedZone,
  travelToZone,
  zoneById,
  isZoneUnlocked,
  zoneRate,
  zoneStanding,
  type ZoneStanding,
} from './zones'
import { LEVEL_CAP, xpGapShare, RUN_PLAYER_DEATH_TOLERANCE_PER_HOUR } from '../data/balance'
import { inventorySize } from './upgrades'
import { ABILITIES, ABILITY_BY_ID } from '../data/abilities'
import { RARITY_BY_ID, TYPICAL_RARITY } from '../data/rarity'
import { ARMOR_NOUNS, ONE_HANDED, SHIELDS, WEAPONS, WEAPON_BY_ID } from '../data/items'
import { SLOT_IDS, type SlotId } from '../data/slots'
import {
  SAFE_ZONE,
  ZONES,
  averageMonsterLevel,
  zoneForMonsterLevel,
  type Zone,
} from '../data/zones'
import { buildMonster } from '../data/monsters'
import { BRANCHES, talentsInBranch, type BranchId } from '../data/talents'
import { DUNGEONS } from '../data/dungeons'
import { DEFAULT_CLASS, classById } from '../data/classes'
import { ABILITY_SLOTS, TALENT_FIRST_LEVEL } from '../data/balance'
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
  const two = (WEAPONS.find((w) => w.grip === 'two') ?? WEAPONS[0]).id
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
  // рулетке предметом (см. TYPICAL_RARITY): это не «повезло» и не «не
  // повезло», а то, во что игрок одет обычно. 'none' — голый герой.
  // 'starting' — СТАРТОВЫЙ комплект класса, то есть одно белое оружие при
  // шести пустых слотах: так игра встречает нового игрока, и первые полосы
  // меряются именно этим героем.
  gear?: 'none' | 'average' | 'starting'
  talents?: Record<string, number>
  // Какие умения жмёт автокаст: 'all' — все, 'none' — ни одного (только
  // автоатака), список id — только они, в порядке приоритета.
  autocast?: 'all' | 'none' | string[]
  /**
   * Дополнительные модификаторы статов, надетые на оружие в правой руке —
   * ИСТОЧНИКОМ, как в игре, а не правкой чисел в блоке. Так замеры «тот же
   * герой, но с +25 п.п. крита» и «тот же герой без крита вовсе» идут через
   * конвейер статов, и тик с оценкой видят одно и то же.
   */
  extraMods?: StatModifier[]
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

/** Во сколько встанет сумка, если продать её целиком. */
function bagValue(state: GameState): Decimal {
  return state.inventory.reduce((sum, item) => sum.plus(sellPrice(item)), new Decimal(0))
}

export interface SimResult {
  hours: number
  zoneId: string // зона, где прогон закончился (при travel: 'best' может отличаться)
  startZoneId: string
  killsPerHour: Decimal
  /** Золото, дошедшее до кошелька: продажи и награда мобов. */
  goldPerHour: Decimal
  /**
   * Насколько подорожала сумка: непроданные находки — это ОТЛОЖЕННОЕ ЗОЛОТО,
   * а не потерянное. Сумка — буфер на дюжину мест, и в установившемся режиме
   * каждая новая находка вытесняет одну старую в продажу; за один час буфер
   * ещё наполняется, и без этого слагаемого прогон недосчитывался бы того,
   * что игрок держит в руках.
   */
  lootHeld: Decimal
  /**
   * КРАН ЗОЛОТА ЦЕЛИКОМ: кошелёк плюс подорожание сумки. Именно это число
   * описывает модель `goldPerHourAt`, и именно по нему сверяются контракты
   * дохода — `goldPerHour` без сумки мерил бы скорость наполнения буфера.
   */
  incomePerHour: Decimal
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
  // Сравнение оружия: бой должен длиться два с лишком десятка замахов, иначе
  // сравнение меряет перебой добивающего удара, а не нормализацию скорости.
  // Оружие НАМЕРЕННО слабее брони (10 уровень против 81): чем меньше доля
  // оружия в убийстве, тем длиннее бой — а мерим мы именно оружие.
  weaponHours: 4,
  // ЗОНА ЗАМЕРА — ДАЛЕКО НИЖЕ ГЕРОЯ (мобы 31-35 против 58 уровня), и это
  // условие выживания, а не удобство. Цена боя по контракту — 13-20% запаса
  // за медианного моба своей зоны при бое в 8-15 секунд; бой в 26 замахов
  // в СВОЕЙ зоне стоит все сто и больше. Замер: в зоне под уровень героя
  // все три связки любого уровня давали 0 убийств и 49 смертей в час, и тест
  // проходил лишь потому, что погибшего героя переселяла модель игрока.
  // Ниже героя мобы бьют по той же ставке, но запаса хватает на 26 ударов, а
  // золото за отставание не штрафуется — сравнивать есть что.
  weaponZoneId: 'mine-collapse',
  // Связки меряются с ОБЩЕЙ средней бронёй: реген живёт на выносливости вещей,
  // и совсем голый герой умирал бы в зоне замера, меряя смертность, а не удар.
  // Броня одна на все стили, поэтому нормализацию она не трогает.
  weaponBuild: { level: 58, gear: 'average', gearLevel: 81 } as SimBuild,
  /**
   * Уровень голых связок в замерах стилей. Подобран по длине боя ПРИ НУЛЕ
   * СМЕРТЕЙ у всех трёх связок — второе условие тут главное: мёртвый герой
   * меряет не удар, а везение.
   *
   * БЫЛО 10 (18.8 замаха двуручника на убийство). С появлением брони бой на
   * этом уровне стал смертельным: урон мобов поднят вдвое с лишним, связки
   * без щита смягчают меньше эталона, и минутная схватка перестала
   * переживаться — замер дал 4.9 смерти в час у двуручного против 0.3 у двух
   * одноручных, а разброс итога подскочил до 12.5 % при потолке 5. Разброс
   * при этом мерил СМЕРТНОСТЬ: медленное оружие бьёт теми же числами, но
   * реже, и длина его схватки гуляет сильнее — на минутном бою эта разница
   * стала стоить жизни.
   *
   * 35 даёт 10.4 замаха на убийство — по-прежнему длинный бой, в котором
   * перебой добивающего удара не решает ничего, — и ноль смертей у всех трёх
   * связок. Замер разброса на нём: 2.5 %.
   */
  weaponLevel: 35,
  // Урон за ману считается по умениям «на следующий удар».
  manaAbilities: ['rending-wound', 'shattering-blow'],
  // Порог расхождения итога между связками с равным уроном оружия в секунду.
  //
  // 0.06 вместо прежних 0.03, и лишние три пункта — цена ПРИВАЛА, а не
  // послабление нормализации. Пока бой стоил пары HP, герой не отдыхал вовсе,
  // и итог был чистым уроном. Теперь между боями стоит пауза фиксированной
  // длины, а цикл фарма квантуется ЦЕЛЫМИ боями: связки с разной длиной
  // замаха попадают в разное число боёв на привал и в разную долю прерванного
  // замаха. Сам удар нормализован по-прежнему — это проверяет отдельный тест
  // на expectedSwingDamage, куда привал не входит.
  //
  // ТРЕТИЙ ПУНКТ ДОБАВИЛА БРОНЯ, точнее поднятый под неё урон мобов. Шум
  // этого теста — квантование привалом, и он растёт ровно с ЧАСТОТОЙ
  // привалов: было 63.6 против 66.0 в час (разброс 3-4 %), стало 78.2 против
  // 73.8 (разброс 5.0 %). Порог поднят на ту же величину, на какую вырос шум,
  // а не «чтобы прошло».
  weaponSpreadLimit: 0.06,
  // Сравнение стилей идёт по СРЕДНЕМУ нескольких сидов. Один сид даёт разброс
  // до шести процентов на пустом месте: спавн выдаёт разные пулы мобов, и
  // измерялась бы удача, а не нормализация.
  weaponSeeds: [11, 22, 33, 44],
  // Плата за щит проверяется ПОД ДАВЛЕНИЕМ: герой в зоне, где бой стоит
  // заметно больше эталона. Там, где герой не теряет HP вовсе, живучесть
  // измерить нечем — и щит выглядел бы чистым проигрышем.
  // Давление идёт от ГОЛЫХ СВЯЗОК, а не от недоодетости: у голого оружия нет
  // побочных статов, бой вдвое длиннее эталонного — и моб успевает снять
  // вдвое больше. Недоодетость при цене боя 13-20% давит слишком сильно:
  // замер на 28 уровне против мобов 26-30 — вещи 8..24 дают 0 убийств,
  // вещи 28 — 23 убийства и 43 смерти в час. Вещи 34 (шестью выше мобов):
  // два клинка — 65 убийств и 13 смертей, щит — 52 и 11; плата за щит 27%
  // урона. Разрыва уровней здесь нет намеренно: разрыв — отдельный механизм,
  // и мешать его в замер щита значило бы мерить штраф, а не щит.
  stressBuild: { level: 28, gear: 'average', gearLevel: 34 } as SimBuild,
  /** Уровень связки в стресс-замере щита: тот же, что у брони. */
  stressWeaponLevel: 34,
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
  /**
   * Окно интервала решений, секунд, и порог тревоги отладочного оверлея.
   *
   * Нижняя граница 35, а не 40: враги стали бить на пятнадцать процентов
   * слабее, бой в стартовых полосах пошёл быстрее, и решения там приходят
   * раз в 35-39 секунд. Это не «слишком часто» — это первые уровни, где
   * находок и очков талантов и правда много; окно расширено ровно на то,
   * что показал замер, а не «с запасом».
   *
   * Верхняя граница 110, а не 90, и это ЧЕСТНОСТЬ МЕРЫ, а не послабление.
   * Решение — это находка, которую игра называет апгрейдом. Раньше значок
   * сравнивал вещь с тем мобом, что стоит перед героем: против одной роли
   * находка была лучше, против другой хуже, и любая из трёх ролей, сказавшая
   * «да», делала обычную вещь решением. Замер: на 25 уровне 41% серых находок
   * шли в решения, при сравнении со средним по пулу зоны — 4%. Значок теперь
   * считает по среднему мобу зоны и не мигает по ходу боя; решений стало
   * ровно столько, сколько их видит игрок, — раз в 40-107 секунд по уровням.
   */
  decisionMinSec: 35,
  decisionMaxSec: 110,
  decisionAlertSec: 180,
  /** Уровни, на которых меряются решения и привалы. */
  telemetryLevels: [1, 5, 10, 16, 25, 40] as number[],
  // Три часа на строку, а не один: решений в час 30-90, и час даёт ±18%
  // пуассоновского шума — строка на границе окна выпадала бы из него от сида.
  telemetryHours: 3,
  /** Потолок доли времени на привалах в подходящей по уровню зоне. */
  restShareMax: 0.25,
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
// Лестницу задают ДАНЖИ: последний из них открывает последние две зоны, и
// прохождение кончается там же. Раньше здесь стоял `unlockRequirement`
// последней зоны — число, которое шло тройками при полосах по пять, из-за
// чего таблица обрывалась на 62 уровне при потолке в сто.
export const PACING_MAX_LEVEL =
  DUNGEONS[DUNGEONS.length - 1].unlockRequirement + PACING_TAIL_LEVELS

/**
 * ЗОНЫ, ОТКРЫТЫЕ ГЕРОЮ ПРОГОНА К ЭТОМУ УРОВНЮ.
 *
 * Зоны теперь открывают данжи, а не уровень, и прибору нужна модель того,
 * кто их проходит. Модель простая и честная: герой делает данж, когда тот
 * открывается, — он же «просто играет», а данж стоит ровно на его пути.
 * Без этого прогон навсегда застрял бы в четырёх стартовых зонах и мерил бы
 * игру, которой нет.
 *
 * ПРОХОДИМОСТЬ САМИХ ДАНЖЕЙ ЗДЕСЬ НЕ ПРОВЕРЯЕТСЯ, и это правильное
 * разделение: её держит отдельный прогон цепочки боссов
 * (game/__tests__/dungeon-ladder.test.ts), причём в обе стороны — с
 * положенной долей экипировки данж проходится, с меньшей нет.
 */
export function unlockedByLevel(level: number): Record<string, boolean> {
  const unlocked: Record<string, boolean> = {}
  for (const dungeon of DUNGEONS) {
    // СТРОГО ВЫШЕ, а не «не ниже»: данж проходят, ДОСТИГНУВ его уровня, и
    // на самом этом уровне он ещё впереди. Ровно так ложится и ритм: на
    // двадцатом герой идёт в первый данж, на двадцать первом у него открыты
    // две новые зоны — те, куда двадцать первый уровень его и ведёт.
    if (level <= dungeon.unlockRequirement) continue
    for (const zoneId of dungeon.opensZoneIds) unlocked[zoneId] = true
  }
  return unlocked
}

/** Сколько зон герою уже открыто. Считается по тем же правилам, что и вход. */
function openZoneCount(state: GameState): number {
  return ZONES.filter((zone) => isZoneUnlocked(state, zone)).length
}

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
  /**
   * ЧЕМ одет: первую зону герой проходит в стартовом комплекте (одно белое
   * оружие), дальше — в средних вещах своей зоны. Без этого поля строка
   * первой полосы читалась бы как «полный средний комплект первого уровня»,
   * то есть как герой, которого в игре не существует.
   */
  gear: 'starting' | 'average'
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
  return { classId, level, gearLevel: row.gearLevel, gear: row.gear }
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
  //
  // НО НЕ С ПЕРВОЙ СЕКУНДЫ. Раньше эталон был одет в полный средний комплект
  // уже на первом уровне, и это было почти правдой: игра сама дарила полный
  // комплект. Теперь она даёт одно белое оружие, и такой эталон описывал бы
  // героя, которого не существует, — против мобов стартовой зоны он быстрее
  // настоящего почти вдвое (28 секунд на моба против 15). Поэтому первую
  // зону герой проходит в СТАРТОВОМ комплекте и одевается на первом переезде.
  //
  // Сколько находок у игрока к этому моменту, считается из чисел самой игры:
  // убийства на уровень (KILLS_PER_LEVEL) × шанс дропа (DROP_CHANCE) ÷ число
  // слотов. По одной находке на слот набирается к седьмому уровню, а вторая
  // зона открывается на четвёртом — то есть эталон всё ещё чуть оптимистичен
  // на уровнях 4-6. Это вход в правку кривой и лестницы зон, а не то, что
  // чинится подбором числа здесь.
  const gearFor = (level: number): number =>
    Math.round(averageMonsterLevel(intendedZone(level)))
  // Первая полоса — В СТАРТОВОМ КОМПЛЕКТЕ, то есть в одном белом оружии.
  // Полный средний комплект приходит на FIRST_GEARED_LEVEL, когда игра
  // действительно выдала по находке на слот (см. константу).
  let gearLevel = 1
  let gearKind: 'starting' | 'average' = 'starting'
  let state = buildSimState({ gear: 'starting', classId }, ZONES[0].id, seed)
  const rows: PacingRow[] = []
  let deaths = 0

  const snapshot = (level: number, atSec: number) => {
    rows.push({
      level,
      atSec,
      deaths,
      gearLevel,
      gear: gearKind,
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
    // ПОСЛЕ ВОСКРЕШЕНИЯ ИГРОК ВОЗВРАЩАЕТСЯ НА ЛЕСТНИЦУ. Смерть отбрасывает в
    // безопасную зону, а её мобы отстают от героя на десяток уровней — опыта
    // там ноль. Без этой строки прогон вставал намертво: одна смерть на
    // шестнадцатом уровне, и дальше двадцать семь тысяч убийств без единого
    // очка опыта. Раньше её не требовалось, потому что смертей не было вовсе.
    //
    // Возвращается он НА СВОЮ СТУПЕНЬ лестницы, а не туда, куда пошёл бы
    // живой игрок: эталонный прогон — прибор, который мерит именно свою
    // полосу в своём снаряжении. Отступление после смерти подменило бы
    // измеряемую зону на соседнюю.
    if (prev.heroState === 'dead' && state.heroState === 'alive') {
      const back = intendedZone(state.level.toNumber()).id
      if (back !== state.currentZoneId) state = travelToZone(state, back, rng)
    }
    if (state.level.gt(prev.level)) {
      const level = state.level.toNumber()
      // Данж делается, когда открывается: он и открывает следующие зоны.
      state = { ...state, unlockedZoneIds: unlockedByLevel(level) }
      const zone = intendedZone(level)
      if (zone.id !== state.currentZoneId) state = travelToZone(state, zone.id, rng)
      // Переодевание на новую ступень: средние вещи уровня СВОЕЙ зоны.
      // Пока герой в ПЕРВОЙ зоне — он в стартовом комплекте: игра выдала ему
      // одно белое оружие, и надеть он ещё ничего не успел.
      const nextGear = zone.id === ZONES[0].id ? 1 : gearFor(level)
      if (nextGear !== gearLevel) {
        gearLevel = nextGear
        gearKind = 'average'
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
    grip: template.grip,
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
    grip: template.grip,
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
        rarity: TYPICAL_RARITY.id,
        slot,
        level,
        grip: AVERAGE_WEAPON.grip,
        mods: weaponMods(AVERAGE_WEAPON, TYPICAL_RARITY, 'mainHand', level),
      }
      continue
    }
    if (slot === 'offHand') {
      // Средний герой носит щит: одноручное со щитом — самая обычная связка,
      // и коридор темпа держится именно на ней.
      gear.offHand =
        AVERAGE_WEAPON.grip === 'two'
          ? null
          : {
              id: 'sim-gear-offHand',
              name: SHIELDS[0].noun,
              rarity: TYPICAL_RARITY.id,
              slot,
              level,
              grip: SHIELDS[0].grip,
              mods: shieldMods(SHIELDS[0], TYPICAL_RARITY, level),
            }
      continue
    }
    gear[slot] = {
      id: `sim-gear-${slot}`,
      name: ARMOR_NOUNS[slot][0],
      rarity: TYPICAL_RARITY.id,
      slot,
      level,
      // Матожидание случайного главного атрибута, а не чей-то конкретный
      // бросок: эталон меряет среднюю броню, а не везение.
      mods: averageArmorMods(slot, TYPICAL_RARITY, level),
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
    if (weapon.grip === 'two') equipment.offHand = null
  }
  if (build.offhand === null) equipment.offHand = null
  else if (build.offhand === 'shield') equipment.offHand = simShieldItem()
  else if (build.offhand) equipment.offHand = simWeaponItem(build.offhand, 'offHand')
  // Двуручное в правой руке несовместимо со второй: правило одно и то же
  // и для игры, и для прогона.
  if (equipment.mainHand?.grip === 'two') equipment.offHand = null
  if (build.extraMods?.length) {
    // Ошибка прибора, а не текст для игрока: билд без оружия просит невозможного.
    if (!equipment.mainHand) throw new Error('extraMods without mainHand')
    equipment.mainHand = {
      ...equipment.mainHand,
      mods: [...equipment.mainHand.mods, ...build.extraMods],
    }
  }
  return equipment
}

/**
 * ЧЕТВЁРКА И ГАЛКИ ПРОГОНА. Список `autocast` задаёт И СОСТАВ, И ПОРЯДОК:
 * порядок слотов — это приоритет, и задать его иначе нельзя. Что не попало
 * в список, доезжает в свободные слоты выключенным — так прибор меряет
 * ровно ту ротацию, которую просили, но кнопки в ряду у героя те же.
 */
function loadoutFor(
  autocast: SimBuild['autocast'],
  classId: string,
): { slots: AbilitySlots; settings: AbilitySettings } {
  if (autocast === undefined || autocast === 'all') {
    return { slots: defaultAbilitySlots(classId), settings: defaultAbilitySettings(classId) }
  }
  if (autocast === 'none') {
    return { slots: defaultAbilitySlots(classId), settings: manualOnlySettings(classId) }
  }
  const settings = manualOnlySettings(classId)
  for (const id of autocast) {
    if (settings[id]) settings[id] = { ...settings[id], autocast: true }
  }
  // Названные — в начало ряда и в заданном порядке; остальное доезжает следом
  // в пустые слоты, если они ещё есть.
  const slots: AbilitySlots = new Array(ABILITY_SLOTS).fill(null)
  autocast.slice(0, ABILITY_SLOTS).forEach((id, index) => {
    if (settings[id]) slots[index] = id
  })
  return { slots: fillAbilitySlots(slots, classId), settings }
}

/** Стартовое состояние прогона: билд разложен по тем же источникам статов,
 *  что и в живой игре, поэтому конвейер считает его обычным путём. */
export function buildSimState(build: SimBuild, zoneId: string, seed: number): GameState {
  const zone = zoneById(zoneId)
  const level = new Decimal(build.level ?? 1)
  const weapon = build.weapon === null ? null : build.weapon ? simWeaponItem(build.weapon) : null
  // saveId ИДЁТ ОТ СИДА, а не по умолчанию: по умолчанию он берётся из
  // `randomSeed()`, то есть из часов, — и всё, что от него зависит, перестаёт
  // быть воспроизводимым. Зависит от него ВОЛНА ХРАМА (`templeSeed(saveId,
  // wave)` в game/temple.ts), и замер глубины забега честно выдавал на одном
  // и том же коммите то 18 этажей, то 20: прибор мерил часы. Прогон обязан
  // быть повторяемым, иначе контракт на нём не поставишь.
  const base = createInitialState(seed, build.classId ?? DEFAULT_CLASS.id, seed)
  const loadout = loadoutFor(build.autocast, base.classId)
  const state: GameState = {
    ...base,
    level,
    currentXp: new Decimal(0),
    xpToNext: xpToNextLevel(level),
    talents: { ...(build.talents ?? {}) },
    // Зоны открывают ДАНЖИ, поэтому герою прогона они и проставляются: он
    // делает данж, когда тот открывается (см. unlockedByLevel). Без этого
    // прибор мерил бы героя, запертого в четырёх стартовых зонах.
    unlockedZoneIds: unlockedByLevel(level.toNumber()),
    equipment: buildEquipment(build, weapon),
    abilitySlots: loadout.slots,
    abilitySettings: loadout.settings,
    // Прогон меряет ЗАДАННЫЙ билд: автонадевание подменило бы его на середине.
    restHpThreshold: build.restThreshold ?? base.restHpThreshold,
    currentZoneId: zone.id,
    // Смерть отбрасывает в последнюю зону, где герой выживал. Ставим её сразу:
    // иначе первая же смерть увела бы прогон в безопасную зону и он мерил бы
    // не ту зону, которую просили.
    lastSurvivedZoneId: zone.id,
    monster: spawnMonster(zone, createRng(seed), base.level.toNumber()),
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

/**
 * УБИЙСТВО, УВИДЕННОЕ СНАРУЖИ. Основной признак прежний — взведённый таймер
 * респауна; добавлен второй, и без него счётчик врал.
 *
 * Почему одного мало. Решение об отдыхе принимается ПОСЛЕ убийства и ДО
 * applyRespawn (см. порядок конвейера в tick.ts), и уход на привал обнуляет
 * respawnMsLeft: таймер за последнего перед привалом моба не взводится
 * никогда. Пока бой стоил пары HP и привалов не было, счётчик совпадал с
 * правдой; теперь на привал герой уходит после каждого второго-третьего
 * убийства, и прогон недосчитывался почти сорока процентов.
 *
 * Уход на привал — сам по себе признак убийства: applyRestCheck срабатывает
 * только когда моб уже мёртв. Поэтому второе слагаемое ровно одно.
 */
function killObserved(prev: GameState, next: GameState): boolean {
  if (prev.respawnMsLeft <= 0 && next.respawnMsLeft > 0) return true
  return prev.heroState === 'alive' && next.heroState === 'resting'
}

// Лучшая по опыту ОТКРЫТАЯ зона: тот же zoneRate, которым игра считает прогноз.
/**
 * Куда идёт МОДЕЛЬ ИГРОКА: в свою полосу, но не глубже, чем он выживает.
 *
 * Раньше здесь стоял безусловный переезд в свою полосу, и это было верно,
 * пока мобы почти не били: умереть на своей ступени было нельзя. Теперь бой
 * стоит четверти запаса, а к шестому уровню у героя две-три находки на семь
 * слотов — и своя полоса убивает его раньше, чем он её оденет. Живой игрок
 * в такой ситуации не идёт вперёд: игра прямо говорит ему «смертельно»
 * (вердикт зоны), и он остаётся дофармливать предыдущую.
 *
 * Модель делает ровно это: берёт САМУЮ ГЛУБОКУЮ открытую зону не глубже
 * своей, в которой прогноз не находит смерти. Если таких нет — безопасную.
 */

/**
 * Лестница, по которой идёт модель игрока: открытые зоны не глубже своей
 * полосы, от мелкой к глубокой. ОДИН список на два решения — куда переезжать
 * и подо что одеваться. Разъедься они, и герой одевался бы под одну зону,
 * а шёл в другую.
 */
export function reachableZones(state: GameState, level: number): Zone[] {
  const own = zoneForMonsterLevel(level)
  return ZONES.filter(
    (zone) =>
      isZoneUnlocked(state, zone) && zone.monsterLevelRange.max <= own.monsterLevelRange.max,
  )
}

/**
 * ЗОНЫ, ПОД КОТОРУЮ ГЕРОЙ ОДЕВАЕТСЯ, БОЛЬШЕ НЕТ, и это стоит записать, потому
 * что она здесь была.
 *
 * `aimZoneId` возвращала следующую ступень лестницы, и `equipUpgrades` мерила
 * находки по ней, а не по текущей зоне. Костыль был нужен ровно потому, что
 * мера «лучше» смотрела в зону: в безопасной зоне аптайм равен единице, цена
 * боя почти ноль, и нагрудник проигрывал любой тряпке с силой атаки — герой
 * приходил на десятый уровень с 309 HP в семи вещах без единой выносливости.
 *
 * Теперь обе оси считаются против ЭТАЛОННОГО противника уровня героя и от
 * зоны не зависят вовсе (`axesOf` в game/equipment.ts). Смотреть вперёд стало
 * нечем и незачем: живучесть стоит одинаково в любой зоне, потому что мерится
 * не «сколько я тут гибну», а «сколько урона я держу».
 */

export function playerZoneId(state: GameState, level: number): string {
  const reachable = reachableZones(state, level)
  const alive = reachable.filter((zone) => {
    const rate = zoneRate(state, zone)
    return !rate.dies && rate.deathsPerHour < RUN_PLAYER_DEATH_TOLERANCE_PER_HOUR
  })
  // ДВА УСЛОВИЯ, и второе — запас на невезение. Модель не находит смерти по
  // СРЕДНЕЙ потере HP и потому оптимистична: с одним этим условием прогон
  // ложился полтора раза в час при контракте «путь идёт без смертей».
  // Поэтому рядом стоит проверка по ХУДШЕМУ бою зоны: с полного запаса герой
  // обязан его пережить. Это слабее метки «по силам» (там порога привала
  // должно хватать на худший бой) — с ней герой не выходил бы из безопасных
  // зон вовсе и терял опыт на отставших мобах.
  //
  // НО ОСТОРОЖНОСТЬ НЕ СТОИТ ОПЫТА. Запас на невезение держит героя в зоне
  // ниже своей ровно до тех пор, пока та платит полный опыт. Как только её
  // средний моб отстал (XP_GAP_PENALTY режет вдвое), живой игрок не сидит
  // на половине опыта ради страховки — он идёт вперёд с риском. Без этой
  // оговорки страж в стартовом комплекте досиживал на лугу до двенадцатого
  // уровня и тратил на путь на триста убийств больше таблицы.
  for (let i = alive.length - 1; i >= 0; i -= 1) {
    const zone = alive[i]
    if (zoneSafety(state, zone).worstFight.gte(state.stats.maxHp)) continue
    if (xpGapShare(level, averageMonsterLevel(zone)) < 1) break
    return zone.id
  }
  // Запаса нет ни в одной зоне с полным опытом — самая глубокая, где герой
  // хотя бы не гибнет по прогнозу.
  return alive.length > 0 ? alive[alive.length - 1].id : SAFE_ZONE.id
}

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
  const startBag = bagValue(state)
  const frozen = { level: state.level, currentXp: state.currentXp, xpToNext: state.xpToNext }

  let xp = new Decimal(0)
  let kills = new Decimal(0)
  let deaths = 0
  let deadMs = 0
  let rests = 0
  let restingMs = 0
  let decisions = 0
  let dropDecisions = 0
  // Открытые зоны считаются по ПРОЙДЕННЫМ ДАНЖАМ: уровень их больше не
  // открывает. В прогоне данжи не проходятся, поэтому число не меняется —
  // и «решение о переезде» из телеметрии честно пропадает вместе с ними.
  let openZones = openZoneCount(state)
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
    if (killObserved(prev, state)) kills = kills.plus(1)
    if (prev.heroState === 'alive' && state.heroState === 'dead') deaths += 1
    // ПОСЛЕ ВОСКРЕШЕНИЯ ИГРОК ВОЗВРАЩАЕТСЯ НА ЛЕСТНИЦУ. Смерть отбрасывает в
    // безопасную зону, а её мобы отстают от героя на десяток уровней — опыта
    // там ноль. Без этой строки прогон вставал намертво: одна смерть на
    // шестнадцатом уровне, и дальше двадцать семь тысяч убийств без единого
    // очка опыта. Раньше её не требовалось, потому что смертей не было вовсе.
    //
    // Возвращается он В ИЗМЕРЯЕМУЮ ЗОНУ, а не туда, куда отступил бы живой
    // игрок. Это прибор: строка таблицы «зона X» обязана мерить зону X даже
    // для билда, который в ней гибнет, — иначе гибнущий стиль после смерти
    // уходил бы в зону ниже и в сравнении стилей мерилась бы другая зона.
    if (prev.heroState === 'dead' && state.heroState === 'alive') {
      const back = travel === 'best' ? bestZoneId(state) : zoneId
      if (back !== state.currentZoneId) state = travelToZone(state, back, rng)
    }
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
    if (bag === 'sell' && state.inventory.length >= inventorySize(state)) {
      const cheapest = state.inventory.reduce((min, item) =>
        sellPrice(item).lt(sellPrice(min)) ? item : min,
      )
      state = sellItem(state, cheapest.id)
    }
    if (state.level.gt(prev.level)) {
      const level = state.level.toNumber()
      const zonesNow = openZoneCount(state)
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
  const lootHeld = bagValue(state).minus(startBag)
  const xpPerSecond = xp.div(seconds)
  const remaining = state.xpToNext.minus(state.currentXp)
  return {
    hours,
    zoneId: state.currentZoneId,
    startZoneId: zoneId,
    killsPerHour: kills.div(hours),
    goldPerHour: gold.div(hours),
    lootHeld,
    incomePerHour: gold.plus(lootHeld).div(hours),
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

// ---------------------------------------------------------------------------
// Прогон полного пути: от первого уровня до потолка
// ---------------------------------------------------------------------------

/**
 * МОДЕЛЬ ИГРОКА, КОТОРЫЙ РАЗБИРАЕТ ДОБЫЧУ.
 *
 * Автонадевания в игре больше нет — предметы надевает человек. Значит прибор
 * обязан этого человека МОДЕЛИРОВАТЬ: без него герой прошёл бы сто уровней
 * в стартовом комплекте, и все замеры оказались бы про другую игру.
 *
 * Политика простая и намеренно не умная: увидел в сумке вещь лучше надетой
 * по тому же `estimateCombatRate`, которым игроку рисуется метка «Апгрейд
 * +12%», — надел. Ни планирования, ни придерживания вещей «на потом».
 *
 * ЖИВЁТ ОНА ЗДЕСЬ, В ПРИБОРЕ, И НИКОГДА НЕ ПЕРЕЕЗЖАЕТ В ИГРУ. Это две разные
 * вещи: в игре решение принимает человек, и отнимать его — значит вернуть
 * автонадевание через заднюю дверь.
 */
/**
 * ОДНО ЧИСЛО, ПО КОТОРОМУ ПРИБОР РЕШАЕТ, — темп убийств против трёх ролей той
 * зоны, где герой стоит. Это МОДЕЛЬ (`estimateCombatRate`), а не оси игрока:
 * в ней и урон, и аптайм, значит и живучесть, и она даёт ОДИН ответ там, где
 * две оси дают два.
 *
 * Три роли, а не одна: цикл фарма квантуется целыми боями, и на единственном
 * противнике мелкая прибавка к живучести перекидывает число боёв до привала с
 * двух на три, давая скачок темпа на треть.
 */
function modelRate(state: GameState): Decimal {
  const zone = zoneById(state.currentZoneId)
  const level = Math.round(averageMonsterLevel(zone))
  let sum = new Decimal(0)
  for (const archetype of zone.monsterPool) {
    const monster = monsterFromTemplate(buildMonster(archetype, level, zone.rewardMultiplier))
    sum = sum.plus(estimateCombatRate({ ...state, monster }).killsPerSecond)
  }
  return sum.div(zone.monsterPool.length)
}

/** Состояние с надетой вещью — без изменения сумки: только для оценки. */
function withItem(state: GameState, item: Item): GameState {
  return ensureStats({
    ...state,
    equipment: equipmentWith(state.equipment, item).equipment,
    statsDirty: true,
  })
}

export function equipUpgrades(state: GameState): GameState {
  // ПРИОРИТЕТ У МОДЕЛИ ТОТ ЖЕ, ЧТО У ИГРОКА, и берётся он из состояния —
  // отдельного правила для прогона нет и заводить его нельзя. Герой прогона
  // строится теми же `createInitialState`/`buildSimState`, а там умолчание
  // «баланс»: модель считает апгрейдом то, что лучше хоть по одной оси,
  // ровно как игра скажет игроку.
  //
  // ОТСЮДА СЛЕДУЕТ, что порядок «лучше» — ЧАСТИЧНЫЙ: вещь, выменивающая
  // урон на живучесть, и вещь обратная обе считаются апгрейдами друг над
  // другом, и модель может их переставлять. Замер полного пути это
  // выдерживает (11.6 ч против 11.0, уровень 100 достигнут), а перебор
  // ограничен сверху числом слотов на один проход — но знать про это надо.
  let next = state
  // По одному предмету за проход: надевание меняет статы, и следующая вещь
  // сравнивается уже с новым набором.
  for (let guard = 0; guard < SLOT_IDS.length + 1; guard += 1) {
    // ЗОНЫ ЗДЕСЬ БОЛЬШЕ НЕТ, И ЭТО НЕ УПРОЩЕНИЕ. Раньше оценка шла против зоны,
    // КУДА герой собирается (`aimZoneId`), потому что мера «лучше» смотрела
    // на текущую зону: в безопасной зоне живучесть не стоила ничего, и модель
    // не надевала брони вовсе. Костыль лечил не ту болезнь — теперь обе оси
    // считаются против ЭТАЛОННОГО противника уровня героя и от зоны не
    // зависят вовсе (см. axesOf в game/equipment.ts), и подменять зону нечем
    // и незачем.
    // ЧЕМ РЕШАЕТ ПРИБОР — НЕ ТЕМ, ЧТО ЧИТАЕТ ИГРОК, и это не двоемыслие, а та
    // самая граница из data/upgrade.ts. Игроку показываются ДВЕ ОСИ: они
    // просты, не зависят от зоны и отвечают на вопрос «в чём эта вещь лучше».
    // Приборy же нужен ОДИН ответ на вопрос «что надеть», а из двух чисел
    // одного ответа не выходит: вещь, меняющая урон на живучесть, лучше по
    // одной оси и хуже по другой, и «лучше хотя бы по одной» разрешает
    // перекладывать броню на урон и обратно бесконечно. Замер: прогон полного
    // пути дал 5.8 смерти в час при контракте «путь идёт без смертей».
    //
    // Одно число, которое такой ответ даёт, в игре уже есть — МОДЕЛЬ:
    // `killsPerSecond` из `estimateCombatRate` против мобов той зоны, где
    // герой стоит. В ней и урон, и аптайм, то есть и живучесть, — ровно то,
    // чем меряются прогноз зоны, оффлайн и все контракты.
    const rank = (candidate: GameState) => modelRate(candidate)
    const before = rank(next)
    const candidates = next.inventory
      .map((item) => ({ item, share: upgradeShare(next, item) }))
      .filter((c): c is { item: Item; share: number } => c.share !== null)
      .map((c) => ({ item: c.item, gain: rank(withItem(next, c.item)).minus(before).toNumber() }))
      .filter((c) => c.gain > 0)
      .sort((a, b) => b.gain - a.gain)
    // ОТКАЗ ПО ОДНОЙ ВЕЩИ — НЕ КОНЕЦ РАЗБОРА. Раньше проход брал ровно
    // лучшего кандидата и, получив отказ, возвращался ни с чем — навсегда,
    // потому что на следующей находке повторялось то же самое.
    //
    // Ловится это только длинным путём, и прогон его поймал: с ПОЛНОЙ сумкой
    // двуручное надеть нельзя (снимаются две руки, а место освобождается
    // одно — код `two-handed-needs-both`), и как только лучшим апгрейдом
    // становилось двуручное, герой замирал в тех вещах, что на нём были.
    // В прогоне он так и шёл с 30 по 80 уровень в вещах 24 уровня: время
    // убийства выросло с 11 секунд до 25, а путь — с 11 часов до тридцати.
    //
    // Живой игрок в этом месте просто надевает второе по списку (или продаёт
    // лишнее), поэтому модель игрока и обязана перебирать список дальше.
    let moved = false
    for (const candidate of candidates) {
      const after = equipItem(next, candidate.item.id)
      if (after === next) continue
      next = after
      moved = true
      break
    }
    if (!moved) return next
  }
  return next
}

/** Строка таблицы полного пути: один уровень героя. */
export interface RunLevelRow {
  level: number
  kills: number
  seconds: number
  zoneId: string
}

export interface RunResult {
  classId: string
  /** Уровень, на котором прогон закончился: при успехе — потолок. */
  finalLevel: number
  reachedCap: boolean
  totalKills: number
  totalHours: number
  levels: RunLevelRow[]
  /** Часы по полосам игры: 1-9 / 10-59 / 60-89 / 90-100. */
  bandHours: Record<string, number>
  restShare: number
  deathsPerHour: number
  goldPerHour: Decimal
  xpPerHour: Decimal
  decisionIntervalSec: number | null
}

/** Границы полос, по которым печатаются часы. Те же, что в дизайн-документе. */
export const RUN_BANDS: ReadonlyArray<{ label: string; from: number; to: number }> = [
  { label: '1-9', from: 1, to: 9 },
  { label: '10-59', from: 10, to: 59 },
  { label: '60-89', from: 60, to: 89 },
  { label: '90-100', from: 90, to: LEVEL_CAP },
]

export interface RunOptions {
  classId?: string
  /** Предохранитель: сколько игровых часов максимум крутить. */
  maxHours?: number
  seed?: number
}

/**
 * Полный путь 1..100 настоящим конвейером тика.
 *
 * Своей модели боя здесь нет — крутится тот же `tick`. Сверх него прибор
 * делает ровно две вещи, которых в игре нет: переезжает в лучшую открытую
 * зону при повышении уровня и надевает найденные апгрейды (см. equipUpgrades).
 * И то и другое — МОДЕЛЬ ИГРОКА, а не правило игры.
 */
export function simulateRun(options: RunOptions = {}): RunResult {
  const { classId = DEFAULT_CLASS.id, maxHours = 40, seed = 4242 } = options
  const rng = createRng(seed)
  let state = buildSimState({ classId, level: 1 }, ZONES[0].id, seed)

  const levels: RunLevelRow[] = []
  let levelKills = 0
  let levelStartSec = 0
  let totalKills = 0
  let deaths = 0
  let restingMs = 0
  let decisions = 0
  let openZones = openZoneCount(state)
  let talentPoints = branchPoints(1)
  const startGold = state.gold
  let xpTotal = new Decimal(0)

  const steps = Math.round((maxHours * 3600 * 1000) / STEP_MS)
  let step = 0
  for (; step < steps; step += 1) {
    const prev = state
    state = tick(prev, STEP_MS, rng, () => {})
    const sec = ((step + 1) * STEP_MS) / 1000

    if (killObserved(prev, state)) {
      levelKills += 1
      totalKills += 1
    }
    if (prev.heroState === 'alive' && state.heroState === 'dead') deaths += 1
    // ПОСЛЕ ВОСКРЕШЕНИЯ ИГРОК ВОЗВРАЩАЕТСЯ НА ЛЕСТНИЦУ. Смерть отбрасывает в
    // безопасную зону, а её мобы отстают от героя на десяток уровней — опыта
    // там ноль. Без этой строки прогон вставал намертво: одна смерть на
    // шестнадцатом уровне, и дальше двадцать семь тысяч убийств без единого
    // очка опыта. Раньше её не требовалось, потому что смертей не было вовсе.
    if (prev.heroState === 'dead' && state.heroState === 'alive') {
      const back = playerZoneId(state, state.level.toNumber())
      if (back !== state.currentZoneId) state = travelToZone(state, back, rng)
    }
    if (state.heroState === 'resting') restingMs += STEP_MS
    xpTotal = xpTotal.plus(
      state.level.eq(prev.level)
        ? state.currentXp.minus(prev.currentXp)
        : totalXpEarned(state.level, state.currentXp).minus(
            totalXpEarned(prev.level, prev.currentXp),
          ),
    )
    // Решения игрока: находка выше обычной либо апгрейд — ровно та мера,
    // которой пользуется таблица интервала решений.
    for (let i = prev.inventory.length; i < state.inventory.length; i += 1) {
      const found = state.inventory[i]
      if (!found) continue
      if (found.rarity !== 'common' || upgradeShare(state, found) !== null) decisions += 1
    }

    // Игрок разбирает сумку: надевает всё, что лучше надетого. Но заглядывает
    // он туда, только когда в ней ЧТО-ТО ИЗМЕНИЛОСЬ: разбирать неизменившуюся
    // сумку каждый тик — это не только не про игру, но и минуты машинного
    // времени на прогон, потому что каждая примерка гоняет оценку боя.
    if (state.inventory !== prev.inventory) {
      state = equipUpgrades(state)
    }

    if (state.level.gt(prev.level)) {
      const reached = state.level.toNumber()
      levels.push({
        level: prev.level.toNumber(),
        kills: levelKills,
        seconds: sec - levelStartSec,
        zoneId: prev.currentZoneId,
      })
      levelKills = 0
      levelStartSec = sec
      // Данж делается, когда открывается: без этого зоны не открылись бы
      // никогда и прогон застрял бы в стартовой четвёрке.
      state = { ...state, unlockedZoneIds: unlockedByLevel(reached) }
      const zonesNow = openZoneCount(state)
      const pointsNow = branchPoints(reached)
      decisions += zonesNow - openZones + Math.max(0, pointsNow - talentPoints)
      openZones = zonesNow
      talentPoints = pointsNow
      // Куда переезжает МОДЕЛЬ ИГРОКА: в свою полосу, но не глубже, чем он
      // выживает (playerZoneId). Не в «лучшую по опыту в час» — та выбирает
      // зону, где мобы падают с одного удара, и прогон превращался бы в
      // мясорубку с временем убийства полторы секунды вместо коридора 8-15.
      state = travelToZone(state, playerZoneId(state, reached), rng)
      if (reached >= LEVEL_CAP) break
    }
  }

  const seconds = ((step + 1) * STEP_MS) / 1000
  const hours = seconds / 3600
  const bandHours: Record<string, number> = {}
  for (const band of RUN_BANDS) {
    bandHours[band.label] =
      levels
        .filter((r) => r.level >= band.from && r.level <= band.to)
        .reduce((sum, r) => sum + r.seconds, 0) / 3600
  }

  return {
    classId,
    finalLevel: state.level.toNumber(),
    reachedCap: state.level.gte(LEVEL_CAP),
    totalKills,
    totalHours: hours,
    levels,
    bandHours,
    restShare: restingMs / (seconds * 1000),
    deathsPerHour: deaths / hours,
    goldPerHour: state.gold.minus(startGold).div(hours),
    xpPerHour: xpTotal.div(hours),
    decisionIntervalSec: decisions > 0 ? seconds / decisions : null,
  }
}
