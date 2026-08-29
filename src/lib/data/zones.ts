// Зоны — данные. Никакой логики выбора или проверок здесь нет: логика читает
// эти поля и сама решает, что игроку доступно и насколько это опасно.
import type { IconName } from '../ui/icons/manifest'
import { Decimal } from '../game/numbers'
import {
  BRUTE,
  COMMON,
  RUNT,
  buildMonster,
  type MonsterArchetype,
  type MonsterRole,
} from './monsters'
import type { MonsterTemplate } from '../types'
import {
  ASHEN_SCENE,
  BLUFF_SCENE,
  COLLAPSE_SCENE,
  CROOKWOOD_SCENE,
  DELL_SCENE,
  EMERY_SCENE,
  FLOODED_SCENE,
  FURROWS_SCENE,
  GLASSWASTE_SCENE,
  MEADOW_SCENE,
  MIREFEN_SCENE,
  MOLD_SCENE,
  PASS_SCENE,
  QUARRY_SCENE,
  RIMEBACK_SCENE,
  ROOTS_SCENE,
  SALTPIT_SCENE,
  SULFUR_SCENE,
  TERRACE_SCENE,
  WORMWOOD_SCENE,
  type SceneConfig,
} from './scenery'

export interface Zone {
  id: string
  name: string
  /** Иконка. Тип выведен из реестра: опечатка — ошибка проверки типов. */
  icon: IconName
  // Уровни мобов зоны: конкретный моб получает случайный уровень из диапазона.
  monsterLevelRange: { min: number; max: number }
  monsterPool: MonsterArchetype[]
  rewardMultiplier: Decimal // множитель золота и опыта поверх уровня моба
  unlockRequirement: number // уровень персонажа, с которого зона открыта
  isSafe: boolean // стартовая зона: сюда возвращают, когда возвращаться некуда
  /** Как выглядит место: туман, свет, площадка и расстановка пропсов.
   *  Поле ОБЯЗАТЕЛЬНОЕ — новая зона без вида не соберётся. */
  scene: SceneConfig
}

// Лестница зон. Двадцать ступеней по ПЯТЬ уровней мобов: 1-5, 6-10, ... 96-100.
// Полосы идут подряд, без пропусков и без нахлёстов, — на любом уровне мобов
// есть ровно одна зона, и «дырок в мире» не бывает. Проверяется данными
// (data/__tests__/integrity.test.ts), а не договорённостью.
//
// Уровни мобов и требования по уровню героя — ЧАСТЬ КОНТРАКТА ТЕМПА (PACING
// в data/balance.ts), а не украшение:
//
//   * ширина полосы задана: пять уровней. Значит ступенька HP между соседними
//     зонами тоже задана, и подгонять под неё можно только ОДНО — с какого
//     уровня героя зона становится его;
//   * unlockRequirement — это границы «правления» зоны, то есть отрезок
//     уровней, на котором она актуальна. Сила героя приходит с ВЕЩАМИ уровня
//     его зоны, поэтому отношение сил внутри правления почти постоянно, и
//     правления — чистый темп игры: три уровня на зону, ровным шагом.
//
// Уровень моба намеренно не равен уровню героя: это ярлык сложности, а не
// возраст противника. Менять эти числа врозь нельзя — контракт темпа
// проверяет их вместе (game/__tests__/balance.test.ts).
//
// rewardMultiplier растёт на 6% за ступень. Это единственная ЭКСПОНЕНТА в
// наградах: уровень моба добавляет их линейно, а экспоненту держит зона —
// именно она оплачивает геометрически дорожающие заточки.
export const ZONES: Zone[] = [
  {
    id: 'shepherds-meadow',
    scene: MEADOW_SCENE,
    icon: 'zone-shepherds-meadow',
    name: 'Пастуший луг',
    monsterLevelRange: { min: 1, max: 5 },
    monsterPool: [
      { id: 'meadow-squelcher', name: 'Луговой хлюпень', role: COMMON },
      { id: 'pasture-tick', name: 'Пастуший клещ', role: RUNT },
      { id: 'straw-lumberer', name: 'Соломенный шатун', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.0),
    unlockRequirement: 1,
    isSafe: true,
  },
  {
    id: 'hollow-quarry',
    scene: QUARRY_SCENE,
    icon: 'zone-hollow-quarry',
    name: 'Полая каменоломня',
    monsterLevelRange: { min: 6, max: 10 },
    monsterPool: [
      { id: 'stone-gnawer', name: 'Каменный грызун', role: RUNT },
      { id: 'dust-digger', name: 'Пылевой копач', role: COMMON },
      { id: 'rumbling-caver', name: 'Гулкий обвальщик', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.06),
    unlockRequirement: 4,
    isSafe: false,
  },
  {
    id: 'rusted-furrows',
    scene: FURROWS_SCENE,
    icon: 'zone-rusted-furrows',
    name: 'Ржавые борозды',
    monsterLevelRange: { min: 11, max: 15 },
    monsterPool: [
      { id: 'rust-chewer', name: 'Ржавый жевун', role: RUNT },
      { id: 'furrow-stalker', name: 'Бороздовый шатун', role: COMMON },
      { id: 'clay-heaver', name: 'Глиняный вздымщик', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.124),
    unlockRequirement: 7,
    isSafe: false,
  },
  {
    id: 'mirefen-hollows',
    scene: MIREFEN_SCENE,
    icon: 'zone-mirefen-hollows',
    name: 'Топкие лощины',
    monsterLevelRange: { min: 16, max: 20 },
    monsterPool: [
      { id: 'silt-crawler', name: 'Тинный ползун', role: RUNT },
      { id: 'rotfang', name: 'Гнилозуб', role: COMMON },
      { id: 'bog-drifter', name: 'Топляк', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.191),
    unlockRequirement: 10,
    isSafe: false,
  },
  {
    id: 'glasswaste',
    scene: GLASSWASTE_SCENE,
    icon: 'zone-glasswaste',
    name: 'Стеклянная пустошь',
    monsterLevelRange: { min: 21, max: 25 },
    monsterPool: [
      { id: 'shard-skitter', name: 'Осколочник', role: RUNT },
      { id: 'pane-walker', name: 'Стеклоход', role: COMMON },
      { id: 'prism-lurker', name: 'Призменный залёгший', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.262),
    unlockRequirement: 13,
    isSafe: false,
  },
  {
    id: 'ashen-ridge',
    scene: ASHEN_SCENE,
    icon: 'zone-ashen-ridge',
    name: 'Пепельный гребень',
    monsterLevelRange: { min: 26, max: 30 },
    monsterPool: [
      { id: 'ember-stinger', name: 'Уголёк-жалун', role: RUNT },
      { id: 'ash-walker', name: 'Пепельный ходок', role: COMMON },
      { id: 'flint-colossus', name: 'Кремнёвый исполин', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.338),
    unlockRequirement: 16,
    isSafe: false,
  },
  {
    id: 'mine-collapse',
    scene: COLLAPSE_SCENE,
    icon: 'zone-mine-collapse',
    name: 'Обвал старой шахты',
    monsterLevelRange: { min: 31, max: 35 },
    monsterPool: [
      { id: 'scree-nibbler', name: 'Осыпной грызун', role: RUNT },
      { id: 'shaft-lurcher', name: 'Штольневый бродяга', role: COMMON },
      { id: 'beam-breaker', name: 'Крепёжный ломщик', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.419),
    unlockRequirement: 19,
    isSafe: false,
  },
  {
    id: 'root-vaults',
    scene: ROOTS_SCENE,
    icon: 'zone-root-vaults',
    name: 'Корневые своды',
    monsterLevelRange: { min: 36, max: 40 },
    monsterPool: [
      { id: 'root-borer', name: 'Корневой точильщик', role: RUNT },
      { id: 'marsh-puffer', name: 'Мочажный пыхтун', role: COMMON },
      { id: 'bole-oaf', name: 'Комлевый увалень', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.504),
    unlockRequirement: 22,
    isSafe: false,
  },
  {
    id: 'flooded-tier',
    scene: FLOODED_SCENE,
    icon: 'zone-flooded-tier',
    name: 'Затопленный ярус',
    monsterLevelRange: { min: 41, max: 45 },
    monsterPool: [
      { id: 'brack-nipper', name: 'Солоноватый кусач', role: RUNT },
      { id: 'tide-wader', name: 'Приливный бродник', role: COMMON },
      { id: 'column-clinger', name: 'Колонный держун', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.594),
    unlockRequirement: 25,
    isSafe: false,
  },
  {
    id: 'mold-horizon',
    scene: MOLD_SCENE,
    icon: 'zone-mold-horizon',
    name: 'Плесневый горизонт',
    monsterLevelRange: { min: 46, max: 50 },
    monsterPool: [
      { id: 'punkwood-midge', name: 'Трухлявый мокрец', role: RUNT },
      { id: 'damp-bracket', name: 'Сырой трутовик', role: COMMON },
      { id: 'rot-uproot', name: 'Гнилой выворотень', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.689),
    unlockRequirement: 28,
    isSafe: false,
  },
  {
    id: 'sulfur-springs',
    scene: SULFUR_SCENE,
    icon: 'zone-sulfur-springs',
    name: 'Серные ключи',
    monsterLevelRange: { min: 51, max: 55 },
    monsterPool: [
      { id: 'steam-hisser', name: 'Паровой шипун', role: RUNT },
      { id: 'sulfur-fumer', name: 'Серный чадун', role: COMMON },
      { id: 'mud-bruiser', name: 'Грязевой бугай', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.791),
    unlockRequirement: 31,
    isSafe: false,
  },
  {
    id: 'ashen-terrace',
    scene: TERRACE_SCENE,
    icon: 'zone-ashen-terrace',
    name: 'Пепельная терраса',
    monsterLevelRange: { min: 56, max: 60 },
    monsterPool: [
      { id: 'cinder-flit', name: 'Искровой порхун', role: RUNT },
      { id: 'terrace-strider', name: 'Террасный ходун', role: COMMON },
      { id: 'slag-bearer', name: 'Шлаковый носитель', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.898),
    unlockRequirement: 34,
    isSafe: false,
  },
  {
    id: 'windswept-pass',
    scene: PASS_SCENE,
    icon: 'zone-windswept-pass',
    name: 'Продувной перевал',
    monsterLevelRange: { min: 61, max: 65 },
    monsterPool: [
      { id: 'ledge-hopper', name: 'Уступный прыгун', role: RUNT },
      { id: 'pass-cutter', name: 'Перевальный секач', role: COMMON },
      { id: 'weathered-hunch', name: 'Обветренный горбач', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.012),
    unlockRequirement: 37,
    isSafe: false,
  },
  {
    id: 'wormwood-rise',
    scene: WORMWOOD_SCENE,
    icon: 'zone-wormwood-rise',
    name: 'Полынный увал',
    monsterLevelRange: { min: 66, max: 70 },
    monsterPool: [
      { id: 'wormwood-chirper', name: 'Полынный стрекун', role: RUNT },
      { id: 'dust-scraper', name: 'Пыльный скребун', role: COMMON },
      { id: 'drywind-crag', name: 'Суховейный кряжень', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.133),
    unlockRequirement: 40,
    isSafe: false,
  },
  {
    id: 'salt-pit',
    scene: SALTPIT_SCENE,
    icon: 'zone-salt-pit',
    name: 'Соляной провал',
    monsterLevelRange: { min: 71, max: 75 },
    monsterPool: [
      { id: 'brine-gnat', name: 'Рассольный гнус', role: RUNT },
      { id: 'salt-treader', name: 'Соляной ступальщик', role: COMMON },
      { id: 'crust-hauler', name: 'Корковый тягач', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.261),
    unlockRequirement: 43,
    isSafe: false,
  },
  {
    id: 'emery-stack',
    scene: EMERY_SCENE,
    icon: 'zone-emery-stack',
    name: 'Наждачный останец',
    monsterLevelRange: { min: 76, max: 80 },
    monsterPool: [
      { id: 'whirl-flaker', name: 'Вихревой шелушень', role: RUNT },
      { id: 'emery-creaker', name: 'Наждачный скрипун', role: COMMON },
      { id: 'weathered-boulderer', name: 'Заветренный глыбарь', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.397),
    unlockRequirement: 46,
    isSafe: false,
  },
  {
    id: 'rimeback-ridge',
    scene: RIMEBACK_SCENE,
    icon: 'zone-rimeback-ridge',
    name: 'Стылая гряда',
    monsterLevelRange: { min: 81, max: 85 },
    monsterPool: [
      { id: 'frost-nibbler', name: 'Изморозный грызун', role: RUNT },
      { id: 'rime-walker', name: 'Стылый ходок', role: COMMON },
      { id: 'glacier-brute', name: 'Ледниковый громила', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.54),
    unlockRequirement: 49,
    isSafe: false,
  },
  {
    id: 'frozen-crookwood',
    scene: CROOKWOOD_SCENE,
    icon: 'zone-frozen-crookwood',
    name: 'Мёрзлое криволесье',
    monsterLevelRange: { min: 86, max: 90 },
    monsterPool: [
      { id: 'needle-snapper', name: 'Иглистый щёлкун', role: RUNT },
      { id: 'brittle-breaker', name: 'Хрусткий ломыш', role: COMMON },
      { id: 'frozen-snag', name: 'Мёрзлый коряжник', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.693),
    unlockRequirement: 52,
    isSafe: false,
  },
  {
    id: 'hollow-dell',
    scene: DELL_SCENE,
    icon: 'zone-hollow-dell',
    name: 'Порожняя падь',
    monsterLevelRange: { min: 91, max: 95 },
    monsterPool: [
      { id: 'tussock-rustler', name: 'Ковыльный шелестень', role: RUNT },
      { id: 'hollow-wheezer', name: 'Западинный сипун', role: COMMON },
      { id: 'drift-slab', name: 'Наносный горбыль', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.854),
    unlockRequirement: 55,
    isSafe: false,
  },
  {
    id: 'mute-bluff',
    scene: BLUFF_SCENE,
    icon: 'zone-mute-bluff',
    name: 'Немая круча',
    monsterLevelRange: { min: 96, max: 100 },
    monsterPool: [
      { id: 'crevice-scraper', name: 'Щелевой скрёбыш', role: RUNT },
      { id: 'verge-patroller', name: 'Кромочный обходчик', role: COMMON },
      { id: 'craggy-idol', name: 'Кряжистый истукан', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(3.026),
    unlockRequirement: 58,
    isSafe: false,
  },
]

export const ZONE_BY_ID: Record<string, Zone> = Object.fromEntries(
  ZONES.map((z) => [z.id, z]),
)

// Зона, куда возвращают, когда возвращаться больше некуда. Первая безопасная
// в списке — контракт данных: хотя бы одна зона обязана быть isSafe.
export const SAFE_ZONE: Zone = ZONES.find((z) => z.isSafe) ?? ZONES[0]

// Середина диапазона уровней — по ней считается прогноз опасности зоны.
export function averageMonsterLevel(zone: Zone): number {
  return (zone.monsterLevelRange.min + zone.monsterLevelRange.max) / 2
}

/**
 * Куда игра ведёт героя на этом уровне: САМАЯ ДАЛЬНЯЯ открытая зона.
 *
 * Живёт в ДАННЫХ, а не в game/zones.ts, чтобы ею могли пользоваться и
 * данные, и логика без кольца импортов. Логика зон переиспользует её под
 * именем `intendedZone`, второй копии правила нет.
 */
export function zoneForLevel(level: number): Zone {
  let intended = SAFE_ZONE
  for (const zone of ZONES) if (level >= zone.unlockRequirement) intended = zone
  return intended
}

/**
 * Зона ПО СВОЕМУ УРОВНЮ: та, чья полоса мобов накрывает этот уровень.
 *
 * Это НЕ то же самое, что самая дальняя открытая (`zoneForLevel`), и разница
 * принципиальная. Зоны открываются быстрее, чем герой успевает в них
 * выживать: на девятом уровне открыта уже полоса 11–15, но драться герою
 * по силам с мобами 6–10. По этой функции считается кривая опыта — стоимость
 * уровня должна опираться на награду мобов, которых герой РЕАЛЬНО бьёт.
 * Возьми здесь самую дальнюю открытую — и кривая потребовала бы впятеро
 * больше убийств, чем игрок способен набрать.
 */
export function zoneForMonsterLevel(level: number): Zone {
  const target = Math.max(1, Math.floor(level))
  for (const zone of ZONES) {
    if (target >= zone.monsterLevelRange.min && target <= zone.monsterLevelRange.max) return zone
  }
  // За краем лестницы — последняя зона: дальше мобов не бывает.
  return ZONES[ZONES.length - 1]
}

// Усреднённая роль пула — нужна ровно для одной вещи: показать игроку,
// сколько ударов «типичного» моба зоны он держит.
function averageRole(zone: Zone): MonsterRole {
  const n = zone.monsterPool.length
  const sum = (pick: (r: MonsterRole) => Decimal) =>
    zone.monsterPool.reduce((acc, a) => acc.plus(pick(a.role)), new Decimal(0)).div(n)
  return {
    hpMult: sum((r) => r.hpMult),
    damageMult: sum((r) => r.damageMult),
    goldMult: sum((r) => r.goldMult),
    xpMult: sum((r) => r.xpMult),
    swingTime: zone.monsterPool.reduce((acc, a) => acc + a.role.swingTime, 0) / n,
  }
}

/** «Типичный моб зоны»: детерминированный, без rng — для показа в UI. */
export function representativeMonster(zone: Zone): MonsterTemplate {
  const archetype: MonsterArchetype = {
    id: `${zone.id}-average`,
    name: zone.name,
    role: averageRole(zone),
  }
  return buildMonster(archetype, averageMonsterLevel(zone), zone.rewardMultiplier)
}

// ВСЕ мобы, которых спавн может выдать в зоне: пул × диапазон уровней.
// spawnMonster берёт из этого множества равновероятно, поэтому усреднение по
// нему — точная оценка темпа зоны, а не «средний моб» (hp входит в темп
// нелинейно, через округление числа ударов вверх).
export function zoneMonsterVariants(zone: Zone): MonsterTemplate[] {
  const variants: MonsterTemplate[] = []
  const { min, max } = zone.monsterLevelRange
  for (let level = min; level <= max; level++) {
    for (const archetype of zone.monsterPool) {
      variants.push(buildMonster(archetype, level, zone.rewardMultiplier))
    }
  }
  return variants
}
