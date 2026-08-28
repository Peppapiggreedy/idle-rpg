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
  COLLAPSE_SCENE,
  FLOODED_SCENE,
  FURROWS_SCENE,
  GLASSWASTE_SCENE,
  MEADOW_SCENE,
  MIREFEN_SCENE,
  QUARRY_SCENE,
  RIMEBACK_SCENE,
  SALTPIT_SCENE,
  TERRACE_SCENE,
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

// Лестница зон. Уровни мобов и требования по уровню героя — ЧАСТЬ КОНТРАКТА
// ТЕМПА (PACING в data/balance.ts), а не украшение:
//
//   * расстояние между СРЕДНИМИ уровнями мобов соседних зон задаёт ступеньку
//     HP, а она обязана совпасть с тем, насколько герой усилился, пока
//     фармил предыдущую зону. Отсюда неровные промежутки 7 / 7 / 5: рост
//     героя от заточек с уровнями замедляется, и ступеньки идут следом;
//   * unlockRequirement — это границы «правления» зоны, то есть длина отрезка
//     уровней, на котором она актуальна. Их и подбирали так, чтобы за это
//     правление герой усиливался ровно на одну ступеньку.
//
// Уровень моба намеренно не равен уровню героя: это ярлык сложности, а не
// возраст противника. Менять эти числа врозь нельзя — контракт темпа
// проверяет их вместе (game/__tests__/balance.test.ts).
export const ZONES: Zone[] = [
  {
    id: 'shepherds-meadow',
    scene: MEADOW_SCENE,
    icon: 'zone-shepherds-meadow',
    name: 'Пастуший луг',
    monsterLevelRange: { min: 1, max: 3 },
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
    monsterLevelRange: { min: 2, max: 4 },
    monsterPool: [
      { id: 'stone-gnawer', name: 'Каменный грызун', role: RUNT },
      { id: 'dust-digger', name: 'Пылевой копач', role: COMMON },
      { id: 'rumbling-caver', name: 'Гулкий обвальщик', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.15),
    unlockRequirement: 3,
    isSafe: false,
  },
  {
    id: 'rusted-furrows',
    scene: FURROWS_SCENE,
    icon: 'zone-rusted-furrows',
    name: 'Ржавые борозды',
    monsterLevelRange: { min: 5, max: 7 },
    monsterPool: [
      { id: 'rust-chewer', name: 'Ржавый жевун', role: RUNT },
      { id: 'furrow-stalker', name: 'Бороздовый шатун', role: COMMON },
      { id: 'clay-heaver', name: 'Глиняный вздымщик', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.32),
    unlockRequirement: 5,
    isSafe: false,
  },
  {
    id: 'mirefen-hollows',
    scene: MIREFEN_SCENE,
    icon: 'zone-mirefen-hollows',
    name: 'Топкие лощины',
    monsterLevelRange: { min: 9, max: 11 },
    monsterPool: [
      { id: 'silt-crawler', name: 'Тинный ползун', role: RUNT },
      { id: 'rotfang', name: 'Гнилозуб', role: COMMON },
      { id: 'bog-drifter', name: 'Топляк', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.52),
    unlockRequirement: 7,
    isSafe: false,
  },
  {
    id: 'glasswaste',
    scene: GLASSWASTE_SCENE,
    icon: 'zone-glasswaste',
    name: 'Стеклянная пустошь',
    monsterLevelRange: { min: 14, max: 16 },
    monsterPool: [
      { id: 'shard-skitter', name: 'Осколочник', role: RUNT },
      { id: 'pane-walker', name: 'Стеклоход', role: COMMON },
      { id: 'prism-lurker', name: 'Призменный залёгший', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(1.75),
    unlockRequirement: 9,
    isSafe: false,
  },
  {
    id: 'ashen-ridge',
    scene: ASHEN_SCENE,
    icon: 'zone-ashen-ridge',
    name: 'Пепельный гребень',
    monsterLevelRange: { min: 22, max: 24 },
    monsterPool: [
      { id: 'ember-stinger', name: 'Уголёк-жалун', role: RUNT },
      { id: 'ash-walker', name: 'Пепельный ходок', role: COMMON },
      { id: 'flint-colossus', name: 'Кремнёвый исполин', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.01),
    unlockRequirement: 12,
    isSafe: false,
  },
  {
    id: 'mine-collapse',
    scene: COLLAPSE_SCENE,
    icon: 'zone-mine-collapse',
    name: 'Обвал старой шахты',
    monsterLevelRange: { min: 32, max: 34 },
    monsterPool: [
      { id: 'scree-nibbler', name: 'Осыпной грызун', role: RUNT },
      { id: 'shaft-lurcher', name: 'Штольневый бродяга', role: COMMON },
      { id: 'beam-breaker', name: 'Крепёжный ломщик', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.31),
    unlockRequirement: 16,
    isSafe: false,
  },
  {
    id: 'flooded-tier',
    scene: FLOODED_SCENE,
    icon: 'zone-flooded-tier',
    name: 'Затопленный ярус',
    monsterLevelRange: { min: 44, max: 46 },
    monsterPool: [
      { id: 'brack-nipper', name: 'Солоноватый кусач', role: RUNT },
      { id: 'tide-wader', name: 'Приливный бродник', role: COMMON },
      { id: 'column-clinger', name: 'Колонный держун', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(2.66),
    unlockRequirement: 21,
    isSafe: false,
  },
  {
    id: 'ashen-terrace',
    scene: TERRACE_SCENE,
    icon: 'zone-ashen-terrace',
    name: 'Пепельная терраса',
    monsterLevelRange: { min: 58, max: 60 },
    monsterPool: [
      { id: 'cinder-flit', name: 'Искровой порхун', role: RUNT },
      { id: 'terrace-strider', name: 'Террасный ходун', role: COMMON },
      { id: 'slag-bearer', name: 'Шлаковый носитель', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(3.06),
    unlockRequirement: 28,
    isSafe: false,
  },
  {
    id: 'salt-pit',
    scene: SALTPIT_SCENE,
    icon: 'zone-salt-pit',
    name: 'Соляной провал',
    monsterLevelRange: { min: 71, max: 73 },
    monsterPool: [
      { id: 'brine-gnat', name: 'Рассольный гнус', role: RUNT },
      { id: 'salt-treader', name: 'Соляной ступальщик', role: COMMON },
      { id: 'crust-hauler', name: 'Корковый тягач', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(3.52),
    unlockRequirement: 36,
    isSafe: false,
  },
  {
    id: 'rimeback-ridge',
    scene: RIMEBACK_SCENE,
    icon: 'zone-rimeback-ridge',
    name: 'Стылая гряда',
    monsterLevelRange: { min: 83, max: 85 },
    monsterPool: [
      { id: 'frost-nibbler', name: 'Изморозный грызун', role: RUNT },
      { id: 'rime-walker', name: 'Стылый ходок', role: COMMON },
      { id: 'glacier-brute', name: 'Ледниковый громила', role: BRUTE },
    ],
    rewardMultiplier: new Decimal(4.05),
    unlockRequirement: 46,
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
