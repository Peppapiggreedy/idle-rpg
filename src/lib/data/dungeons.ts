// Данж — данные, и он ШАБЛОН, а не восемь рукописных наборов чисел.
//
// ПОЧЕМУ ШАБЛОН. Данжей восемь, боссов двадцать четыре, у каждого пять чисел
// плюс отметка ярости — сто сорок четыре числа, выставленных руками. Такой
// набор не сходится ни с чем: подвинули рост урона мобов — и половина
// цепочек перестала проходиться, а заметить это можно только прогоном
// каждой. Поэтому числа боссов ВЫВОДЯТСЯ, ровно как числа моба выводятся из
// его уровня (data/monsters.ts): руками задан ТИР данжа, а формула
// разворачивает его в цепочку. Поправка в формуле чинит все восемь сразу.
//
// Данж описывается ПАРАМЕТРАМИ (DungeonSpec): тир, уровень входа, зона
// входа, тир лут-пула, реагент и ключ интерьера. Всё остальное — вывод.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import { buildMonster, COMMON, type MonsterRole } from './monsters'
import { DUNGEON_SCENES, type DungeonSceneKey, type SceneConfig } from './scenery'
import { ZONES, zoneForMonsterLevel } from './zones'
import type { SlotId } from './slots'
import { BOSS_ABILITY_BY_ID, HEROIC } from './heroic'
import { reagentOf } from './reagents'
import type { MonsterTemplate, Rarity } from '../types'

// Лут-пул босса: какие слоты падают и какого качества НЕ НИЖЕ.
export interface BossLoot {
  slots: SlotId[]
  minRarity: Rarity
}

export interface BossDef {
  id: string
  name: string
  level: number
  // Во сколько раз босс крепче и злее обычного моба своего уровня.
  hpMult: Decimal
  damageMult: Decimal
  swingTime: number
  goldMult: Decimal
  xpMult: Decimal
  // Через сколько игровых секунд боя начинается ярость.
  enrageAfterSec: number
  loot: BossLoot
  // Реагент, который этот босс роняет ГАРАНТИРОВАННО, помимо лут-пула.
  // Не null только у последнего босса цепочки: реагент — отметка о том,
  // что данж пройден до конца, а не награда за первую же схватку.
  reagentId: string | null
  /** Дополнительная способность героики. null — обычная версия босса. */
  abilityId: string | null
}

export interface DungeonDef {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  /** Ступень лестницы данжей, 1..8. Уникален: по нему выводятся числа. */
  tier: number
  /** Сложность этого разворота шаблона. */
  difficulty: DungeonDifficulty
  /** Тир лут-пула: пригождается и проверке целостности, и UI. */
  lootTier: LootTier
  zoneId: string // из какой зоны вход
  unlockRequirement: number // уровень персонажа
  /**
   * КАКИЕ ЗОНЫ ОТКРЫВАЕТ ПЕРВОЕ ПРОХОЖДЕНИЕ. Ровно две у каждого данжа —
   * так двадцать зон и раскладываются: четыре стартовых плюс восемь данжей
   * по две. Без остатка, и это не совпадение, а условие ритма «десять
   * уровней зоны — данж — десять уровней».
   *
   * Список лежит ЗДЕСЬ, а не в зоне, по той же причине, по какой вход в данж
   * лежит здесь же: у зоны нет своего мнения о том, кто её открывает, а у
   * данжа есть — он ради этого и стоит на лестнице.
   */
  opensZoneIds: string[]
  /** Реагент тира: его роняет последний босс цепочки. */
  reagentId: string
  /** Ключ интерьера. Держится рядом с самим конфигом ради проверки данных:
   *  «обстановки key нет в DUNGEON_SCENES» читается, а сравнение объектов — нет. */
  scenery: DungeonSceneKey
  /** Как выглядит место. Интерьеров четыре на восемь данжей — см. scenery.ts. */
  scene: SceneConfig
  bosses: BossDef[] // порядок фиксирован: цепочка идёт сверху вниз
}

/**
 * СКОЛЬКО ЭКИПИРОВКИ НУЖНО, ЧТОБЫ ВЗЯТЬ ДАНЖ ТИРА T.
 *
 * Данж — жёсткие ворота: не прошёл, значит дальше не идёшь, зоны не открылись.
 * Но жёсткость обязана РАСТИ, а не стоять стеной с самого начала: первый данж
 * берётся примерно шестьюдесятью процентами доступной экипировки, последний
 * требует девяноста пяти. Между ними ровный шаг в пять процентов на тир.
 *
 * «Доля доступной экипировки» — это уровень вещей относительно верхнего моба
 * зоны входа: вещи такого уровня в этой зоне и падают. Восемьдесят процентов
 * на тире пятом значит «вещи 48 уровня при мобах до 60».
 *
 * Число проверяется В ОБЕ СТОРОНЫ (game/__tests__/dungeon-ladder.test.ts):
 * с этой долей цепочка проходится, с долей на пятнадцать пунктов меньше —
 * нет. Односторонняя проверка пропустила бы данж, который проходится вообще
 * всегда, — то есть перестал быть воротами.
 */
// ЛЕСТНИЦА СТАЛА ВЫШЕ И УЖЕ: было 0.55 + 0.05×тир (60% на первом данже, 95%
// на восьмом), стало 0.80 + 0.02×тир (82% и 96%). Это не ужесточение ради
// ужесточения, а следствие контракта босса: если схватка стоит около 80%
// запаса ХОРОШО ОДЕТОГО героя, то герой в шести десятых от той же экипировки
// в неё просто не проходит — ему не хватает ни запаса, ни урона. Замер по
// развёртке долей (см. таблицу требовательности в dungeon-ladder.test.ts):
// перелом лежит на 80% у первого тира и на 88-90% у восьмого.
//
// Разброс между первым и восьмым сузился с тридцати пяти пунктов до
// четырнадцати, и это честная цена одинаковой цены боя на всех тирах.
// Захотим широкую лестницу обратно — придётся вернуть рост урона по тирам
// (TIER_GROWTH.damage) и сделать первого босса заметно мягче восьмого; тогда
// «около 80%» станет средним по лестнице, а не правилом каждой схватки.
export const GEAR_SHARE_BASE = 0.8
export const GEAR_SHARE_PER_TIER = 0.02
/** На сколько пунктов ниже доли данж обязан НЕ проходиться. */
export const GEAR_SHARE_MARGIN = 0.15

export function requiredGearShare(tier: number): number {
  return GEAR_SHARE_BASE + GEAR_SHARE_PER_TIER * tier
}

// Ярость: каждые enrageStepSec урон растёт на enrageGrowth от исходного.
// Это проверка на урон в секунду — не успеваешь, босс дожимает.
export const ENRAGE_STEP_SEC = 10
export const ENRAGE_GROWTH = 0.5

// ---------------------------------------------------------------------------
// Формула цепочки
// ---------------------------------------------------------------------------

/**
 * Место в цепочке. Три ступени одинаковы во ВСЕХ данжах — тир двигает их
 * целиком, а не переставляет местами.
 *
 * Числа подобраны под одно правило и проверяются им же
 * (game/__tests__/dungeon-ladder.test.ts):
 * ОБЫЧНЫЕ УДАРЫ ГЕРОЙ ПЕРЕЖИВАЕТ, ДОГОНЯЕТ ЯРОСТЬ. То есть герой уровня
 * входа в средней экипировке своей зоны проходит все три схватки подряд,
 * не умерев (внутри данжа привала нет — цепочка идёт без перерыва), но
 * запаса у него к концу остаётся треть, а не девять десятых. Кто отстал по
 * урону в секунду — не укладывается в enrageAfterSec, и дальше его добивает
 * ярость, а не сами удары.
 */
interface ChainStep {
  hpMult: number
  damageMult: number
  goldMult: number
  xpMult: number
  swingTime: number
  enrageAfterSec: number
  /** Слоты лут-пула. Качество задаёт тир лут-пула данжа, а не эта строка. */
  slots: SlotId[]
}

// КОНТРАКТ БОССА: ОДНА СХВАТКА СТОИТ ОКОЛО 80% ЗАПАСА героя, хорошо одетого
// для своего уровня. Числа подобраны прогоном настоящего тика и держатся
// тестом; замер по всем восьми данжам и обоим классам — 69-89%, в среднем 79.
//
// МЕЖДУ БОССАМИ ЕСТЬ ПРИВАЛ, и без него контракт был бы невозможен: три
// схватки по восемьдесят процентов на одном запасе не пережил бы никто.
// Каждая ступень цепочки начинается с полной полоски — значит и мерить её
// надо схваткой, а не цепочкой целиком.
//
// ПОЧЕМУ УРОН ПАДАЕТ ОТ ПЕРВОГО БОССА К ТРЕТЬЕМУ (1.48 -> 0.99 -> 0.76). Это
// не «третий слабее» — это арифметика равной цены. Запас HP растёт по цепочке
// (3.6 -> 6.0), то есть схватка становится в 1.7 раза длиннее, а бьёт босс
// всё это время. Чтобы цена схватки осталась той же, урон в секунду обязан
// упасть ровно во столько же. Опасность третьего босса растёт не силой удара,
// а ДЛИНОЙ боя: отметка ярости у него ближе к пределу (tightness в тестах),
// и проверка на урон в секунду там жёстче.
//
// Множитель считается от урона ОБЫЧНОГО моба того же уровня. У первого босса
// он выше единицы — босс злее рядового противника и за удар тоже; у третьего
// ниже, и это ровно то же самое равенство цены.
const CHAIN: readonly ChainStep[] = [
  {
    hpMult: 3.6,
    damageMult: 1.48,
    goldMult: 12,
    xpMult: 10,
    swingTime: 2.4,
    enrageAfterSec: 50,
    slots: ['chest', 'hands'],
  },
  {
    hpMult: 4.6,
    damageMult: 0.99,
    goldMult: 20,
    xpMult: 16,
    swingTime: 2.0,
    enrageAfterSec: 64,
    slots: ['head', 'legs'],
  },
  {
    hpMult: 6.0,
    damageMult: 0.76,
    goldMult: 34,
    xpMult: 27,
    swingTime: 1.8,
    enrageAfterSec: 82,
    slots: ['mainHand', 'trinket'],
  },
]

/**
 * Что тир добавляет поверх ступени цепочки. Ставки МАЛЕНЬКИЕ, и это не
 * робость: главный рост сложности несёт УРОВЕНЬ босса, а он привязан к
 * полосе мобов, на которой герой этого уровня и дерётся. Тир добавляет
 * только то, чего уровень не даёт, — поправку на то, что сила героя после
 * шестидесятого растёт уже не вещами (зон дальше нет), а одними атрибутами.
 */
export const TIER_GROWTH = {
  hp: 1.03,
  // ЗДЕСЬ БЫЛА ЕДИНИЦА, и это было верно, пока данж не был ВОРОТАМИ. Теперь
  // он ими стал: не прошёл — две зоны не открылись, дальше идти некуда. А
  // ворота обязаны становиться требовательнее, иначе восьмой данж отличался
  // бы от первого только уровнем боссов, то есть ничем: сила героя растёт
  // ровно так же.
  //
  // Ставка подобрана ЗАМЕРОМ и держится тестом в обе стороны: первый данж
  // берётся шестьюдесятью процентами доступной экипировки, восьмой требует
  // девяноста пяти (requiredGearShare). До правки все восемь требовали
  // около девяноста — то есть требовательность не росла вовсе, а первый
  // данж стоял стеной ровно там, где игрок только начинает собирать вещи.
  //
  // Растёт именно УРОН, а не HP, и это не вкус. Запас героя тает как
  // «входящий минус регенерация»: прибавка к урону бьёт по разности, то есть
  // сильнее собственной величины, а прибавка к HP только растягивает бой,
  // давая регенерации больше времени. Ставка на HP давала кривую, идущую
  // в ОБРАТНУЮ сторону — замер показал требование, падающее от тира к тиру.
  // ЕДИНИЦА — возврат к исходному. По ходу этой правки ставка успела побывать
  // и 1.04, и 1.07: ею догоняли ворота, пока боссы почти не били. С привалом
  // между схватками цену боя держит сам урон босса, а тир поднимает требование
  // к экипировке (requiredGearShare) и уровень боссов. Добавлять сверху ещё и
  // урон значило бы считать одно и то же дважды.
  damage: 1.0,
  reward: 1.12,
  // Ярость подступает с тиром раньше: единственная ставка НИЖЕ единицы.
  // Ставка ПОЛОГАЯ (0.99, а не 0.97): у восьмого тира она множится семь раз,
  // и крутая срезала бы отметку почти на четверть — цепочка переставала бы
  // проходиться героем своего уровня входа, то есть тем, для кого дверь
  // и открылась. Проверку урона в секунду держит сама отметка, а не её спад.
  enrage: 0.99,
}

/**
 * Сложность забега. Это ПАРАМЕТР ШАБЛОНА рядом с тиром, а не отдельная
 * сущность: один и тот же DungeonSpec разворачивается в две цепочки.
 */
export type DungeonDifficulty = 'normal' | 'heroic'
export const DUNGEON_DIFFICULTIES: readonly DungeonDifficulty[] = ['normal', 'heroic']

/** Тир лут-пула: с какого качества начинается цепочка находок данжа.
 *  Третий тир — героический: эпик там пол, а не потолок. */
export type LootTier = 1 | 2 | 3

// Качество растёт от первого босса к третьему ВНУТРИ цепочки, а тир пула
// поднимает всю тройку разом. Второй тир — данжи второй половины лестницы:
// эпик там уже обычная находка, и порог обязан ехать следом.
const LOOT_FLOORS: Record<LootTier, readonly Rarity[]> = {
  1: ['uncommon', 'rare', 'epic'],
  2: ['rare', 'epic', 'legendary'],
  3: ['epic', 'legendary', 'legendary'],
}

/** Множитель тира: единица на первом, дальше степень ставки. */
function tierScale(rate: number, tier: number): number {
  return Math.pow(rate, tier - 1)
}

/**
 * Уровень босса. Берётся НЕ от зоны входа, а от полосы мобов, КОТОРАЯ ПО
 * СИЛАМ герою уровня входа (`zoneForMonsterLevel`), плюс шаг за место
 * в цепочке.
 *
 * Разница принципиальна, и оба соседних варианта неверны. «Зона, где дверь» —
 * это про место на карте, а не про силу противника: дверь первого данжа
 * стоит в Топких лощинах, но открывается на двадцатом. А «самая дальняя
 * ОТКРЫТАЯ зона» уводит в другую крайность: зоны открываются
 * заметно быстрее, чем герой начинает в них выживать, и на двадцатом уровне
 * это дало бы боссов тридцать пятого — данж стал бы непроходим на своём же
 * уровне входа. По силам герою полоса СВОЕГО уровня, от неё и считаем.
 */
function bossLevel(unlockRequirement: number, index: number): number {
  return zoneForMonsterLevel(unlockRequirement).monsterLevelRange.max + index
}

// ---------------------------------------------------------------------------
// Восемь данжей: только параметры
// ---------------------------------------------------------------------------

/** Всё, что у данжа задано руками. Остальное считает buildDungeon. */
export interface DungeonSpec {
  tier: number
  id: string
  name: string
  icon: IconName
  zoneId: string
  unlockRequirement: number
  /** Какие две зоны открывает первое прохождение. См. DungeonDef. */
  opensZoneIds: string[]
  lootTier: LootTier
  reagentId: string
  scenery: DungeonSceneKey
  /** Три босса цепочки: только id и имя — числа приходят из формулы. */
  bosses: readonly { id: string; name: string }[]
}

// Один данж на десяток уровней: 20, 30, ... 90. Зоны входа разнесены по
// всей лестнице, а не свалены в последнюю: дверь стоит там, где по лору
// стоит, а сила боссов приходит от тира.
export const DUNGEON_SPECS: readonly DungeonSpec[] = [
  {
    tier: 1,
    id: 'sunken-barrow',
    name: 'Затонувший курган',
    icon: 'dungeon-sunken-barrow',
    zoneId: 'mirefen-hollows',
    unlockRequirement: 20,
    opensZoneIds: ['glasswaste', 'ashen-ridge'],
    lootTier: 1,
    reagentId: 'reagent-silt-clot',
    scenery: 'cistern',
    bosses: [
      { id: 'barrow-warden', name: 'Страж кургана' },
      { id: 'silt-matron', name: 'Тинная матрона' },
      { id: 'drowned-king', name: 'Утопший король' },
    ],
  },
  {
    tier: 2,
    id: 'ninth-drift',
    name: 'Девятая штольня',
    icon: 'dungeon-ninth-drift',
    zoneId: 'ashen-ridge',
    unlockRequirement: 30,
    opensZoneIds: ['mine-collapse', 'root-vaults'],
    lootTier: 1,
    reagentId: 'reagent-drift-sinter',
    scenery: 'vault',
    bosses: [
      { id: 'collapse-shorer', name: 'Крепильщик обвала' },
      { id: 'foreman-crag', name: 'Штейгер Кряж' },
      { id: 'ninth-master', name: 'Хозяин Девятой' },
    ],
  },
  {
    tier: 3,
    id: 'tier-cisterns',
    name: 'Ярусные цистерны',
    icon: 'dungeon-tier-cisterns',
    zoneId: 'root-vaults',
    unlockRequirement: 40,
    opensZoneIds: ['flooded-tier', 'mold-horizon'],
    lootTier: 1,
    reagentId: 'reagent-sediment-core',
    scenery: 'cistern',
    bosses: [
      { id: 'bottom-keeper', name: 'Донный смотритель' },
      { id: 'sluice-warden', name: 'Ключарь шлюзов' },
      { id: 'stillwater-lord', name: 'Владыка стоячей воды' },
    ],
  },
  {
    tier: 4,
    id: 'boiling-adits',
    name: 'Кипящие штольни',
    icon: 'dungeon-boiling-adits',
    zoneId: 'mold-horizon',
    unlockRequirement: 50,
    opensZoneIds: ['sulfur-springs', 'ashen-terrace'],
    lootTier: 1,
    reagentId: 'reagent-sulfur-growth',
    scenery: 'forge',
    bosses: [
      { id: 'steam-scalder', name: 'Парильщик' },
      { id: 'sulfur-bittern', name: 'Серная выпь' },
      { id: 'cauldron-elder', name: 'Котельный старшой' },
    ],
  },
  {
    tier: 5,
    id: 'wind-galleries',
    name: 'Ветровые галереи',
    icon: 'dungeon-wind-galleries',
    zoneId: 'ashen-terrace',
    unlockRequirement: 60,
    opensZoneIds: ['windswept-pass', 'wormwood-rise'],
    lootTier: 2,
    reagentId: 'reagent-wind-glass',
    scenery: 'rime',
    bosses: [
      { id: 'wall-draught', name: 'Стенной сквозняк' },
      { id: 'pass-whistler', name: 'Свистун перевала' },
      { id: 'booming-herald', name: 'Гулкий предвестник' },
    ],
  },
  {
    tier: 6,
    id: 'salt-womb',
    name: 'Соляная утроба',
    icon: 'dungeon-salt-womb',
    zoneId: 'wormwood-rise',
    unlockRequirement: 70,
    opensZoneIds: ['salt-pit', 'emery-stack'],
    lootTier: 2,
    reagentId: 'reagent-brine-crystal',
    scenery: 'vault',
    bosses: [
      { id: 'brine-cleg', name: 'Рассольный слепень' },
      { id: 'crust-keyman', name: 'Корковый ключник' },
      { id: 'brine-pillar', name: 'Столп рассола' },
    ],
  },
  {
    tier: 7,
    id: 'rime-catacombs',
    name: 'Стылые катакомбы',
    icon: 'dungeon-rime-catacombs',
    // Полоса 81-85: вход открывается ровно на её пороге, как у всех
    // остальных данжей лестницы (см. инвариант в content:check).
    zoneId: 'emery-stack',
    unlockRequirement: 80,
    opensZoneIds: ['rimeback-ridge', 'frozen-crookwood'],
    lootTier: 2,
    reagentId: 'reagent-rime-vein',
    scenery: 'rime',
    bosses: [
      { id: 'rime-acolyte', name: 'Изморозный служка' },
      { id: 'brittle-overseer', name: 'Хрусткий надзиратель' },
      { id: 'glaze-colossus', name: 'Наледный исполин' },
    ],
  },
  {
    tier: 8,
    id: 'bluff-hollow',
    name: 'Полость под кручей',
    icon: 'dungeon-bluff-hollow',
    // Полоса 91-95, а не 96-100: вход на пороге своей зоны.
    zoneId: 'frozen-crookwood',
    unlockRequirement: 90,
    opensZoneIds: ['hollow-dell', 'mute-bluff'],
    lootTier: 2,
    reagentId: 'reagent-mute-shard',
    scenery: 'vault',
    bosses: [
      { id: 'verge-gatekeeper', name: 'Кромочный привратник' },
      { id: 'mute-bellringer', name: 'Немой звонарь' },
      { id: 'bluff-frame', name: 'Костяк кручи' },
    ],
  },
]

/**
 * Ключ достижения. Обычная версия оставляет ключом ГОЛЫЙ id — так уже лежат
 * все существующие сейвы, и миграция им не нужна. Героика дописывает суффикс:
 * это отдельное достижение и отдельный бонус к опыту.
 */
export function clearKey(dungeonId: string, difficulty: DungeonDifficulty): string {
  return difficulty === 'heroic' ? `${dungeonId}:heroic` : dungeonId
}

/** Развернуть параметры данжа в описание с числами боссов заданной сложности. */
export function buildDungeon(
  spec: DungeonSpec,
  difficulty: DungeonDifficulty = 'normal',
): DungeonDef {
  const heroic = difficulty === 'heroic'
  const lootTier = heroic ? HEROIC.lootTier : spec.lootTier
  const floors = LOOT_FLOORS[lootTier]
  // Уровень входа у героики один на все восемь — от него же считается и
  // уровень боссов, той же формулой bossLevel. Своей формулы у героики нет.
  const unlockRequirement = heroic ? HEROIC.unlockRequirement : spec.unlockRequirement
  // Реагент: обычный из спеки, героический — по тиру из data/reagents.ts.
  const reagentId = heroic ? (reagentOf(spec.tier, 'heroic')?.id ?? spec.reagentId) : spec.reagentId
  const hp = tierScale(TIER_GROWTH.hp, spec.tier) * (heroic ? HEROIC.hpMult : 1)
  const damage = tierScale(TIER_GROWTH.damage, spec.tier) * (heroic ? HEROIC.damageMult : 1)
  const reward = tierScale(TIER_GROWTH.reward, spec.tier) * (heroic ? HEROIC.rewardMult : 1)
  const enrage = tierScale(TIER_GROWTH.enrage, spec.tier) * (heroic ? HEROIC.enrageShare : 1)
  const last = spec.bosses.length - 1
  return {
    id: spec.id,
    name: spec.name,
    icon: spec.icon,
    tier: spec.tier,
    difficulty,
    lootTier,
    zoneId: spec.zoneId,
    unlockRequirement,
    // ЗОНЫ ОТКРЫВАЕТ ТОЛЬКО ОБЫЧНАЯ ВЕРСИЯ. Героика — второй проход по той же
    // лестнице, и открывать ей уже нечего: к моменту, когда она доступна,
    // все двадцать зон давно открыты обычными прохождениями.
    opensZoneIds: heroic ? [] : spec.opensZoneIds,
    reagentId,
    scenery: spec.scenery,
    scene: DUNGEON_SCENES[spec.scenery],
    bosses: spec.bosses.map((boss, index) => {
      const step = CHAIN[Math.min(index, CHAIN.length - 1)]
      return {
        id: boss.id,
        name: boss.name,
        level: bossLevel(unlockRequirement, index),
        hpMult: new Decimal(step.hpMult * hp),
        damageMult: new Decimal(step.damageMult * damage),
        goldMult: new Decimal(step.goldMult * reward),
        xpMult: new Decimal(step.xpMult * reward),
        swingTime: step.swingTime,
        enrageAfterSec: Math.round(step.enrageAfterSec * enrage),
        loot: {
          slots: [...step.slots],
          minRarity: floors[Math.min(index, floors.length - 1)],
        },
        // Реагент — только за последнего: он и есть отметка «пройдено».
        reagentId: index === last ? reagentId : null,
        // Способность приходит от МЕСТА в цепочке: три ступени одинаковы во
        // всех восьми данжах, значит и добавка к ним одна и та же.
        abilityId: heroic
          ? (HEROIC.abilityIds[Math.min(index, HEROIC.abilityIds.length - 1)] ?? null)
          : null,
      }
    }),
  }
}

export const DUNGEONS: DungeonDef[] = DUNGEON_SPECS.map((s) => buildDungeon(s, 'normal'))
export const HEROIC_DUNGEONS: DungeonDef[] = DUNGEON_SPECS.map((s) => buildDungeon(s, 'heroic'))
/** Обе лестницы подряд: по ним считаются достижения и бонус к опыту. */
export const ALL_DUNGEONS: DungeonDef[] = [...DUNGEONS, ...HEROIC_DUNGEONS]

/** Самый глубокий тир лестницы. По нему растут реагенты, реликвии и проки:
 *  добавили девятый данж — всё, что считается от тира, продолжилось само. */
export const MAX_DUNGEON_TIER = DUNGEONS.reduce((max, d) => Math.max(max, d.tier), 0)

/**
 * Зоны, открытые С НАЧАЛА ИГРЫ: те, которые не открывает ни один данж.
 *
 * Выводится, а не перечисляется. Список руками разъехался бы с `opensZoneIds`
 * при первой же правке лестницы, и «зона, в которую нельзя попасть никогда»
 * появилась бы молча. Здесь же она невозможна по построению, а число
 * стартовых зон (четыре) держит проверка контента.
 */
export const INITIAL_ZONE_IDS: readonly string[] = (() => {
  const opened = new Set(DUNGEONS.flatMap((d) => d.opensZoneIds))
  return ZONES.filter((z) => !opened.has(z.id)).map((z) => z.id)
})()

/** Какой данж открывает эту зону; null — она открыта с начала игры. */
export function dungeonOpening(zoneId: string): DungeonDef | null {
  return DUNGEONS.find((d) => d.opensZoneIds.includes(zoneId)) ?? null
}

export const DUNGEON_BY_ID: Record<string, DungeonDef> = Object.fromEntries(
  DUNGEONS.map((d) => [d.id, d]),
)
const HEROIC_BY_ID: Record<string, DungeonDef> = Object.fromEntries(
  HEROIC_DUNGEONS.map((d) => [d.id, d]),
)

/** Данж нужной сложности. Ровно один способ добраться до чисел героики. */
export function dungeonView(
  id: string,
  difficulty: DungeonDifficulty = 'normal',
): DungeonDef | null {
  return (difficulty === 'heroic' ? HEROIC_BY_ID[id] : DUNGEON_BY_ID[id]) ?? null
}

// Награда за первое полное прохождение — постоянный бонус к опыту.
// У героики он свой и крупнее: и проход дороже, и лестница вторая.
export const DUNGEON_CLEAR_XP_BONUS = new Decimal(0.05)
export const HEROIC_CLEAR_XP_BONUS = new Decimal(HEROIC.clearXpBonus)

// Реэкспорт: способности боссов приезжают вместе с данжем, чтобы UI и логика
// не искали их в двух местах.
export { BOSS_ABILITIES, BOSS_ABILITY_BY_ID, HEROIC } from './heroic'
export type { BossAbilityDef, BossAbilityEffect, HeroicSpec } from './heroic'

/** Шаблон босса: та же buildMonster, что и у обычных мобов, но с ролью босса. */
export function buildBoss(boss: BossDef): MonsterTemplate {
  const role: MonsterRole = {
    hpMult: COMMON.hpMult.times(boss.hpMult),
    damageMult: COMMON.damageMult.times(boss.damageMult),
    goldMult: COMMON.goldMult.times(boss.goldMult),
    xpMult: COMMON.xpMult.times(boss.xpMult),
    swingTime: boss.swingTime,
  }
  return buildMonster({ id: boss.id, name: boss.name, role }, boss.level, new Decimal(1))
}
